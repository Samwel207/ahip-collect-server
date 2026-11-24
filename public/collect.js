// AHIP Collect Web: the AHIP Collect phone app in the browser, so data collectors on iPhones (or any
// phone) can fill and submit the same forms. Forms come from AHIP Manage; answers are saved on the
// phone as drafts (IndexedDB) and sent to the AHIP database through /api/collect/submit.
"use strict";

(() => {
  // ---------------------------------------------------------------- constants
  const ITEM_CONTROL = "http://hl7.org/fhir/StructureDefinition/questionnaire-itemControl";
  const HIDDEN = "http://hl7.org/fhir/StructureDefinition/questionnaire-hidden";
  const MIN_VALUE = "http://hl7.org/fhir/StructureDefinition/minValue";
  const MAX_VALUE = "http://hl7.org/fhir/StructureDefinition/maxValue";
  const REGEX = "http://hl7.org/fhir/StructureDefinition/regex";
  const MIME_TYPE = "http://hl7.org/fhir/StructureDefinition/mimeType";
  const SLIDER_STEP = "http://hl7.org/fhir/StructureDefinition/questionnaire-sliderStepValue";
  const GPS = "https://github.com/google/android-fhir/StructureDefinition/gps-coordinate";
  const AUDIO_MAX = "https://smartregister.org/audio-max-duration-minutes";
  const ALLOW_INCOMPLETE = "https://smartregister.org/allow-incomplete-submission-when";
  const GRID = "urn:ahip:grid";
  const LINEAR = "urn:ahip:linear-scale";
  const TOOL_SYSTEM = "urn:ahip:tool";
  const TARGET_EXT = "urn:ahip:tool-target";
  const MINUTES_EXT = "urn:ahip:tool-minutes";
  const Q = window.AHIP_QUIZ;

  const STUDIES = [
    { id: "afya-tek-phase-3", title: "Afya-Tek Phase III", sub: "AHIP Baseline" },
    { id: "other-studies", title: "Other Studies", sub: "e.g. Midline, Endline", soon: true },
  ];
  const ASSESSMENTS = [
    { id: "baseline-2025", title: "Baseline Assessment", period: "2025" },
    { id: "midline-2026", title: "Midline Assessment", period: "2026", soon: true },
    { id: "endline-2027", title: "Endline Assessment", period: "2027", soon: true },
    { id: "rapid-adhoc", title: "Rapid Assessment", period: "Ad-hoc", soon: true },
  ];
  // The six original tools (as in the phone app); new forms carry their own details.
  const BUILT_IN = {
    "ahip-t1-cpp-provider": ["CPP providers (ADDOs / pharmacies)", 25],
    "ahip-t2-healthcare-worker": ["Healthcare workers at health facilities", 25],
    "ahip-t3-exit-client": ["Clients leaving a CPP", 15],
    "ahip-t4-routine-indicators": ["Council routine (HMIS) data", 30],
    "ahip-t5-cpp-digital-sustainability": ["CPPs in Kibaha", 30],
    "ahip-t6-facility-digital-sustainability": ["Health facilities in Kibaha", 20],
  };

  const $app = document.getElementById("app");
  const state = {
    user: null,
    forms: [],
    study: null,
    assessment: null,
    screen: "loading",
    fill: null, // { id, form, answers: Map, page, startedAt, errors: Set }
    drafts: {},
    outbox: [],
    done: null,
    online: navigator.onLine,
  };
  let timer = null;
  let recorder = null;

  // ---------------------------------------------------------------- small helpers
  const ext = (x, url) => (x?.extension || []).find((e) => e.url === url);
  const control = (i) => ext(i, ITEM_CONTROL)?.valueCodeableConcept?.coding?.[0]?.code;
  const isHidden = (i) => ext(i, HIDDEN)?.valueBoolean === true;
  const isFlyover = (i) => i.type === "display" && control(i) === "flyover";
  const hintOf = (i) => (i.item || []).filter(isFlyover).map((c) => c.text).join(" ");
  const toolNumber = (q) => Number((q.identifier || []).find((x) => x.system === TOOL_SYSTEM)?.value) || 0;
  const toolTitle = (q) => String(q.title || q.id).replace(/^Tool\s*\d+\s*[:.-]\s*/i, "");
  const fmtClock = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  const when = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "");
  const uuid = () => {
    const b = crypto.getRandomValues(new Uint8Array(16)); // randomUUID needs https; this works on http too
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else if (k === "checked" || k === "selected" || k === "disabled" || k === "value") node[k] = v;
      else node.setAttribute(k, v === true ? "" : v);
    }
    children.flat(Infinity).forEach((c) => {
      if (c == null || c === false || c === true) return;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    });
    return node;
  }

  function toast(text, ms = 2600) {
    const t = document.getElementById("toast");
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toast.h);
    toast.h = setTimeout(() => (t.hidden = true), ms);
  }

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(json.error || `Error ${res.status}`), { status: res.status });
    return json;
  }

  // ---------------------------------------------------------------- storage on the phone (IndexedDB)
  const store = (() => {
    let dbp = null;
    const memory = new Map();
    // Never wait more than 2 s for storage (private browsing and some iPhones block it): memory is used instead.
    const open = () => (dbp ||= new Promise((resolve) => {
      setTimeout(() => resolve(null), 2000);
      try {
        const req = indexedDB.open("ahip-collect", 1);
        req.onupgradeneeded = () => req.result.createObjectStore("kv");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch { resolve(null); }
    }));
    const run = async (mode, fn) => {
      const db = await open();
      if (!db) return null;
      return new Promise((resolve) => {
        setTimeout(() => resolve(null), 3000);
        try {
          const tx = db.transaction("kv", mode);
          const r = fn(tx.objectStore("kv"));
          tx.oncomplete = () => resolve(r?.result);
          tx.onerror = () => resolve(null);
        } catch { resolve(null); }
      });
    };
    return {
      async get(key) { const v = await run("readonly", (s) => s.get(key)); return v ?? memory.get(key) ?? null; },
      async set(key, value) { memory.set(key, value); await run("readwrite", (s) => s.put(value, key)); },
    };
  })();
  const userKey = (k) => `${k}:${state.user?.username || "-"}`;
  const saveDrafts = () => store.set(userKey("drafts"), state.drafts);
  const saveOutbox = () => store.set(userKey("outbox"), state.outbox);

  // ---------------------------------------------------------------- navigation
  const BACK = { study: null, assessment: "study", tools: "assessment", summary: "tools", done: "tools", review: "form" };
  function go(screen, { push = true } = {}) {
    if (screen !== "form" && screen !== "review") stopTimer();
    state.screen = screen;
    if (push) history.pushState({ screen }, "");
    render();
    window.scrollTo(0, 0);
  }
  window.addEventListener("popstate", () => goBack(true));
  function goBack(fromBrowser = false) {
    if (recorder) return toast("Stop the recording first.");
    if (state.screen === "form" && state.fill.page > 0) {
      state.fill.page--;
      state.fill.errors.clear();
      autosave();
      if (fromBrowser) history.pushState({ screen: "form" }, "");
      render();
      return window.scrollTo(0, 0);
    }
    if (state.screen === "form") { autosave(true); return go("tools", { push: !fromBrowser }); }
    const back = BACK[state.screen];
    if (back) go(back, { push: !fromBrowser });
    else if (fromBrowser) history.pushState({ screen: state.screen }, "");
  }

  function bar(title, { back = true, right = [] } = {}) {
    return el("header", { class: "bar" },
      back ? el("button", { class: "icon", "aria-label": "Back", onclick: () => goBack() }, "‹") : el("span", { style: "width:8px" }),
      el("h1", { text: title }),
      right);
  }

  function menuButton() {
    return el("button", { class: "icon", "aria-label": "Menu", onclick: (e) => {
      e.stopPropagation();
      const old = document.querySelector(".menu");
      if (old) return old.remove();
      const m = el("div", { class: "menu", role: "menu" },
        el("button", { role: "menuitem", onclick: () => { m.remove(); go("summary"); } }, "📊  My assessment summary"),
        el("button", { role: "menuitem", onclick: async () => { m.remove(); await syncAll(true); } }, "⟳  Sync now"),
        el("button", { role: "menuitem", onclick: async () => { m.remove(); await loadForms(true); render(); } }, "⤓  Get the latest forms"),
        el("button", { role: "menuitem", onclick: () => { m.remove(); signOut(); } }, "⎋  Sign out"));
      document.body.append(m);
      setTimeout(() => document.addEventListener("click", function close(ev) { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener("click", close); } }), 0);
    } }, "⋮");
  }

  // ---------------------------------------------------------------- sign in
  function renderLogin(error = "") {
    const user = el("input", { class: "input", autocomplete: "username", autocapitalize: "none", spellcheck: "false", required: true, value: localStorage.getItem("ahip_web_last_user") || "" });
    const pass = el("input", { class: "input", type: "password", autocomplete: "current-password", required: true });
    const btn = el("button", { class: "btn primary", type: "submit" }, "Sign in");
    const box = el("div", { class: "error-box", role: "alert", hidden: !error, text: error });
    const form = el("form", { class: "form", onsubmit: async (e) => {
      e.preventDefault();
      btn.disabled = true;
      btn.replaceChildren(el("span", { class: "spinner" }), " Signing in…");
      try {
        const { user: u } = await api("POST", "/api/collect/login", { username: user.value.trim(), password: pass.value });
        try { localStorage.setItem("ahip_web_last_user", u.username); localStorage.setItem("ahip_web_user", JSON.stringify(u)); } catch {}
        await startAs(u);
      } catch (err) {
        box.textContent = err.status ? err.message : "The AHIP server could not be reached. Check your internet or Wi-Fi and try again.";
        box.hidden = false;
        btn.disabled = false;
        btn.textContent = "Sign in";
      }
    } },
      el("label", {}, "Username", user),
      el("label", {}, "Password", pass),
      box, btn,
      el("p", { class: "note", text: "Use the same username and password as the AHIP Collect phone app. Ask your administrator if you do not have an account." }));
    $app.replaceChildren(el("main", { class: "welcome" },
      el("img", { class: "logo", src: "ahip_logo.png", alt: "AHIP" }),
      el("h2", { text: "AHIP Collect" }),
      el("p", { class: "tag", text: "Digital Data Collection for Afya-Tek Phase III" }),
      form));
    setTimeout(() => (user.value ? pass : user).focus(), 50);
  }

  async function signOut() {
    if (state.outbox.length && !confirm(`${state.outbox.length} submission(s) have not been sent yet. They stay on this phone and are sent when you sign in again. Sign out?`)) return;
    await api("POST", "/api/collect/logout").catch(() => {});
    try { localStorage.removeItem("ahip_web_user"); } catch {}
    state.user = null;
    renderLogin();
  }

  // ---------------------------------------------------------------- start
  async function startAs(user) {
    state.user = user;
    state.drafts = (await store.get(userKey("drafts"))) || {};
    state.outbox = (await store.get(userKey("outbox"))) || [];
    state.study = localStorage.getItem("ahip_web_study") || null;
    state.assessment = localStorage.getItem("ahip_web_assessment") || null;
    if ((await loadForms(false)) === "signin") return;
    history.replaceState({ screen: "study" }, "");
    go(state.study && state.assessment ? "tools" : "study", { push: false });
    syncAll(false);
  }

  async function loadForms(announce) {
    try {
      const { forms } = await api("GET", "/api/collect/forms");
      state.forms = forms;
      await store.set("forms", forms);
      if (announce) toast("Forms are up to date.");
    } catch (e) {
      if (e.status === 401) { renderLogin("Please sign in again."); return "signin"; }
      state.forms = (await store.get("forms")) || state.forms;
      if (announce) toast("Offline: using the forms saved on this phone.");
    }
  }

  const tools = () => state.forms
    .map((q) => ({
      q,
      number: toolNumber(q),
      title: toolTitle(q),
      target: ext(q, TARGET_EXT)?.valueString || BUILT_IN[q.id]?.[0] || "",
      minutes: ext(q, MINUTES_EXT)?.valueInteger || BUILT_IN[q.id]?.[1] || null,
      quiz: Q.settings(q),
    }))
    .filter((t) => t.number)
    .sort((a, b) => a.number - b.number);

  // ---------------------------------------------------------------- study / assessment
  function renderStudy() {
    let chosen = state.study || STUDIES[0].id;
    const cards = el("div");
    const draw = () => cards.replaceChildren(...STUDIES.map((s) =>
      el("button", { class: `choice-card${chosen === s.id && !s.soon ? " selected" : ""}`, disabled: !!s.soon, onclick: () => { chosen = s.id; draw(); } },
        el("span", { class: "radio-dot" }), el("span", {}, el("div", { class: "t", text: s.title }), el("div", { class: "s", text: `(${s.sub})` })),
        s.soon && el("span", { class: "soon", text: "Coming soon" }))));
    draw();
    $app.replaceChildren(bar("AHIP Collect", { back: false, right: [menuButton()] }),
      el("main", { class: "screen" }, el("h2", { class: "heading", text: "Select Study / Programme" }), cards),
      el("div", { class: "nav" }, el("div", { class: "nav-inner" },
        el("button", { class: "btn primary", onclick: () => { state.study = chosen; try { localStorage.setItem("ahip_web_study", chosen); } catch {} go("assessment"); } }, "Continue"))));
  }

  function renderAssessment() {
    let chosen = state.assessment || ASSESSMENTS[0].id;
    const cards = el("div");
    const draw = () => cards.replaceChildren(...ASSESSMENTS.map((a) =>
      el("button", { class: `choice-card${chosen === a.id && !a.soon ? " selected" : ""}`, disabled: !!a.soon, onclick: () => { chosen = a.id; draw(); } },
        el("span", { class: "radio-dot" }), el("span", {}, el("div", { class: "t", text: `${a.title} (${a.period})` })),
        a.soon && el("span", { class: "soon", text: "Coming soon" }))));
    draw();
    $app.replaceChildren(bar("Afya-Tek Phase III", { right: [menuButton()] }),
      el("main", { class: "screen" }, el("h2", { class: "heading", text: "Select Assessment" }), cards),
      el("div", { class: "nav" }, el("div", { class: "nav-inner" },
        el("button", { class: "btn primary", onclick: () => { state.assessment = chosen; try { localStorage.setItem("ahip_web_assessment", chosen); } catch {} go("tools"); } }, "Continue"))));
  }

  // ---------------------------------------------------------------- tools + drafts
  function renderTools() {
    const list = tools();
    const assessment = ASSESSMENTS.find((a) => a.id === state.assessment) || ASSESSMENTS[0];
    const drafts = Object.values(state.drafts).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const pending = state.outbox.length;
    $app.replaceChildren(bar(`Assessment: ${assessment.title} (${assessment.period})`, { right: [menuButton()] }),
      el("main", { class: "screen" },
        pending > 0 && el("div", { class: "banner" }, el("span", { class: "grow", text: `${pending} submission${pending === 1 ? "" : "s"} waiting to be sent to the AHIP database.` }),
          el("button", { class: "btn small navy", onclick: () => syncAll(true) }, "Send now")),
        !state.forms.length && el("div", { class: "banner" }, "No forms on this phone yet. Connect to the internet and choose “Get the latest forms” in the menu."),
        el("h2", { class: "heading", text: `Assessment Tools (${list.length})` }),
        list.map((t) => el("button", { class: "tool-card", onclick: () => startFill(t.q) },
          el("span", { class: `tile${t.number % 2 ? "" : " even"}`, text: `T${t.number}` }),
          el("span", {},
            el("div", { class: "t" }, `Tool ${t.number}: ${t.title}`, t.quiz && el("span", { class: "badge", text: t.quiz.timeLimitMinutes ? `Quiz · ${t.quiz.timeLimitMinutes} min` : "Quiz" })),
            el("div", { class: "s", text: [t.target, t.minutes ? `about ${t.minutes} min` : ""].filter(Boolean).join(" · ") })),
          el("span", { class: "chev", text: "›" }))),
        drafts.length > 0 && el("div", { class: "section-label", text: `Drafts (${drafts.length})` }),
        drafts.map((d) => {
          const form = state.forms.find((q) => q.id === d.formId);
          const answered = d.answers.filter(([id, a]) => a.length && !/^ahip-(study|assessment)$/.test(id)).length;
          return el("div", { class: "draft-card" },
            el("div", { class: "grow" },
              el("div", { style: "font-weight:700", text: form ? `Tool ${toolNumber(form)}: ${toolTitle(form)}` : d.formId }),
              el("div", { class: "note", text: `${answered} answered · saved ${when(d.updatedAt)}` })),
            el("button", { class: "btn small primary", disabled: !form, onclick: () => resumeFill(d) }, "Continue"),
            el("button", { class: "btn small ghost", "aria-label": "Delete draft", onclick: () => {
              if (!confirm("Delete this draft? Its answers will be lost.")) return;
              delete state.drafts[d.id];
              saveDrafts();
              render();
            } }, "🗑"));
        })));
  }

  // ---------------------------------------------------------------- filling a form
  function startFill(form) {
    const answers = new Map([
      ["ahip-study", [{ valueString: state.study || STUDIES[0].id }]],
      ["ahip-assessment", [{ valueString: state.assessment || ASSESSMENTS[0].id }]],
    ]);
    state.fill = { id: `web-${uuid()}`, form, answers, page: 0, startedAt: Date.now(), errors: new Set() };
    autosave(true);
    go("form");
  }

  function resumeFill(d) {
    const form = state.forms.find((q) => q.id === d.formId);
    state.fill = { id: d.id, form, answers: new Map(d.answers), page: Math.min(d.page || 0, pages(form).length - 1), startedAt: d.startedAt || Date.now(), errors: new Set() };
    go("form");
  }

  let saveTimer = null;
  function autosave(now = false) {
    const f = state.fill;
    if (!f) return;
    clearTimeout(saveTimer);
    const write = () => {
      state.drafts[f.id] = { id: f.id, formId: f.form.id, answers: [...f.answers.entries()], page: f.page, startedAt: f.startedAt, updatedAt: new Date().toISOString() };
      saveDrafts();
    };
    if (now) write(); else saveTimer = setTimeout(write, 700);
  }

  const pages = (form) => (form.item || []).every((i) => i.type === "group")
    ? form.item
    : [{ linkId: "_all", text: toolTitle(form), type: "group", item: form.item }];

  const rawOf = (a) => (a.valueCoding ? a.valueCoding.code
    : a.valueString ?? a.valueInteger ?? a.valueDecimal ?? a.valueBoolean ?? a.valueDate ?? a.valueTime ?? a.valueDateTime ?? (a.valueAttachment ? "attachment" : undefined));
  const valuesOf = (linkId) => (state.fill.answers.get(linkId) || []).map(rawOf).filter((v) => v !== undefined && v !== "");

  function cmp(a, op, b) {
    if (typeof b === "number") a = Number(a);
    switch (op) {
      case "=": return a === b;
      case "!=": return a !== b;
      case ">": return a > b;
      case ">=": return a >= b;
      case "<": return a < b;
      case "<=": return a <= b;
      default: return false;
    }
  }

  function enabled(item) {
    const ws = item.enableWhen || [];
    if (!ws.length) return true;
    const results = ws.map((w) => {
      const values = valuesOf(w.question);
      if (w.operator === "exists") return (values.length > 0) === (w.answerBoolean !== false);
      const target = w.answerCoding ? w.answerCoding.code : w.answerString ?? w.answerInteger ?? w.answerDecimal ?? w.answerBoolean ?? w.answerDate ?? w.answerTime;
      if (w.operator === "!=") return values.every((v) => !cmp(v, "=", target));
      return values.some((v) => cmp(v, w.operator, target));
    });
    return item.enableBehavior === "any" ? results.some(Boolean) : results.every(Boolean);
  }

  const visiblePages = () => pages(state.fill.form).filter(enabled);

  /** "Record the interview as audio" + a recording: the other questions become optional (as on the phone). */
  function incompleteAllowed() {
    const expr = ext(state.fill.form, ALLOW_INCOMPLETE)?.valueExpression?.expression || "";
    const mode = /linkId='([^']+)'\)\.answer\.value\.code\s*=\s*'([^']+)'/.exec(expr);
    const audio = /linkId='([^']+)'\)\.answer\.exists\(\)/.exec(expr);
    if (!mode || !audio) return false;
    return valuesOf(mode[1]).includes(mode[2]) && valuesOf(audio[1]).length > 0;
  }

  function kindOf(i) {
    const ctl = control(i);
    switch (i.type) {
      case "display": return "note";
      case "group": return ctl === "location-widget" ? "gps" : ext(i, GRID) ? "grid" : "group";
      case "choice": case "open-choice":
        if (i.repeats) return "checkboxes";
        if (ctl === "drop-down") return "dropdown";
        return ext(i, LINEAR) ? "linear" : "radio";
      case "boolean": return "boolean";
      case "string": return "short";
      case "text": return "paragraph";
      case "integer": return ctl === "slider" ? "slider" : "integer";
      case "decimal": return "decimal";
      case "date": return "date";
      case "time": return "time";
      case "dateTime": return "datetime";
      case "attachment":
        return ctl === "audio-recorder" || (i.extension || []).some((e) => e.url === MIME_TYPE && String(e.valueCode).startsWith("audio")) ? "audio" : "photo";
      default: return "short";
    }
  }

  /** Problems on one page (required, format, range); a Set of linkIds with a message map. */
  function pageProblems(page) {
    const problems = new Map();
    if (incompleteAllowed()) return problems;
    const walk = (items) => (items || []).forEach((i) => {
      if (!enabled(i) || isHidden(i) || i.type === "display") return;
      const kind = kindOf(i);
      if (kind === "group" || kind === "grid") return walk(i.item);
      if (kind === "gps") return;
      const values = valuesOf(i.linkId);
      if (i.required && !values.length) problems.set(i.linkId, "This question is required.");
      const regex = ext(i, REGEX)?.valueString;
      if (regex && values.length && !new RegExp(regex).test(String(values[0]))) problems.set(i.linkId, "Please check the format of this answer.");
      if ((kind === "integer" || kind === "decimal" || kind === "slider") && values.length) {
        const min = ext(i, MIN_VALUE), max = ext(i, MAX_VALUE);
        const lo = min?.valueInteger ?? min?.valueDecimal, hi = max?.valueInteger ?? max?.valueDecimal;
        const v = Number(values[0]);
        if (lo != null && v < lo) problems.set(i.linkId, `The smallest allowed answer is ${lo}.`);
        if (hi != null && v > hi) problems.set(i.linkId, `The largest allowed answer is ${hi}.`);
      }
    });
    walk(page.item);
    return problems;
  }

  function setAnswer(linkId, answers, redraw = true) {
    const f = state.fill;
    if (answers.length) f.answers.set(linkId, answers); else f.answers.delete(linkId);
    if (f.errors.has(linkId)) { f.errors.delete(linkId); if (!redraw) document.querySelector(`[data-link="${CSS.escape(linkId)}"]`)?.classList.remove("err"); }
    autosave();
    if (redraw) renderPreserveScroll();
  }

  function renderPreserveScroll() {
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
  }

  // ---------------------------------------------------------------- the form screen
  function renderForm() {
    const f = state.fill;
    const list = visiblePages();
    f.page = Math.max(0, Math.min(f.page, list.length - 1));
    const page = list[f.page];
    const last = f.page === list.length - 1;
    const quiz = Q.settings(f.form);
    const right = [];
    if (quiz?.timeLimitMinutes) right.push(el("span", { class: "timer", id: "timer", text: `⏱ ${fmtClock(f.startedAt + quiz.timeLimitMinutes * 60000 - Date.now())}` }));
    const problems = f.problems || new Map();
    const items = el("div");
    renderItems(page.item || [], items, problems);
    $app.replaceChildren(
      bar(`Tool ${toolNumber(f.form)}: ${toolTitle(f.form)}`, { right }),
      el("div", { class: "progress" }, el("span", { style: `width:${((f.page + 1) / list.length) * 100}%` })),
      el("main", { class: "screen" },
        el("div", { class: "page-title" }, el("div", { class: "muted", text: `Page ${f.page + 1} of ${list.length}` }), el("h2", { text: page.text || "" })),
        items),
      el("div", { class: "nav" }, el("div", { class: "nav-inner" },
        el("button", { class: "btn ghost", onclick: () => goBack() }, f.page === 0 ? "Save & exit" : "Back"),
        el("button", { class: "btn primary", onclick: () => next(page, last) }, last ? "Review" : "Next"))));
    startTimer();
  }

  function next(page, last) {
    if (recorder) return toast("Stop the recording first.");
    const problems = pageProblems(page);
    const f = state.fill;
    f.errors = new Set(problems.keys());
    f.problems = problems;
    if (problems.size) {
      renderPreserveScroll();
      document.querySelector(".q.err")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return toast(`${problems.size} question${problems.size === 1 ? " needs" : "s need"} an answer or a check.`);
    }
    f.problems = null;
    autosave(true);
    if (last) return go("review");
    f.page++;
    history.pushState({ screen: "form" }, "");
    render();
    window.scrollTo(0, 0);
  }

  function renderItems(items, container, problems) {
    items.forEach((i) => {
      if (!enabled(i) || isHidden(i) || isFlyover(i)) return;
      container.append(renderItem(i, problems));
    });
  }

  function renderItem(i, problems) {
    const kind = kindOf(i);
    const f = state.fill;
    const err = problems.get(i.linkId) || (f.errors.has(i.linkId) ? "This question is required." : "");
    const card = el("section", { class: `q${err ? " err" : ""}${kind === "note" ? " note" : ""}`, "data-link": i.linkId });
    if (kind === "note") { card.append(el("div", { text: i.text || "" })); return card; }
    card.append(el("div", { class: "label" }, i.prefix ? `${i.prefix} ` : "", i.text || "", i.required ? el("span", { class: "req", text: " *" }) : null));
    const hint = hintOf(i);
    if (hint) card.append(el("p", { class: "hint", text: hint }));
    const answers = f.answers.get(i.linkId) || [];
    const value = answers[0] ? rawOf(answers[0]) : "";
    const opts = (i.answerOption || []).map((o) => o.valueCoding).filter(Boolean);
    const name = `q_${i.linkId}`;

    switch (kind) {
      case "short": {
        const regex = ext(i, REGEX)?.valueString || "";
        const type = /@/.test(regex) ? "email" : /255/.test(regex) ? "tel" : "text";
        card.append(el("input", { class: "input", type, value: value ?? "", maxlength: i.maxLength || null, inputmode: type === "tel" ? "tel" : null, autocomplete: "off", placeholder: "Your answer",
          oninput: (e) => setAnswer(i.linkId, e.target.value.trim() ? [{ valueString: e.target.value }] : [], false),
          onchange: () => renderPreserveScroll() }));
        break;
      }
      case "paragraph":
        card.append(el("textarea", { class: "input", rows: 4, maxlength: i.maxLength || null, placeholder: "Your answer",
          oninput: (e) => setAnswer(i.linkId, e.target.value.trim() ? [{ valueString: e.target.value }] : [], false),
          onchange: () => renderPreserveScroll() }, value ?? ""));
        break;
      case "integer": case "decimal":
        card.append(el("input", { class: "input", type: "number", inputmode: kind === "integer" ? "numeric" : "decimal", step: kind === "integer" ? 1 : "any", value: value ?? "",
          onchange: (e) => {
            const v = e.target.value === "" ? null : Number(e.target.value);
            setAnswer(i.linkId, v == null || Number.isNaN(v) ? [] : [kind === "integer" ? { valueInteger: Math.round(v) } : { valueDecimal: v }]);
          } }));
        break;
      case "slider": {
        const min = ext(i, MIN_VALUE)?.valueInteger ?? 0, max = ext(i, MAX_VALUE)?.valueInteger ?? 10;
        const out = el("b", { text: value === "" ? "–" : String(value) });
        card.append(el("div", { class: "slider-row" }, el("span", { text: String(min) }),
          el("input", { type: "range", min, max, step: ext(i, SLIDER_STEP)?.valueInteger || 1, value: value === "" ? min : value,
            oninput: (e) => { out.textContent = e.target.value; setAnswer(i.linkId, [{ valueInteger: Number(e.target.value) }], false); },
            onchange: () => renderPreserveScroll() }),
          el("span", { text: String(max) }), out));
        break;
      }
      case "date": case "time": case "datetime":
        card.append(el("input", { class: "input", type: kind === "datetime" ? "datetime-local" : kind, value: kind === "datetime" && value ? String(value).slice(0, 16) : value ?? "",
          onchange: (e) => setAnswer(i.linkId, e.target.value ? [kind === "date" ? { valueDate: e.target.value } : kind === "time" ? { valueTime: e.target.value.length === 5 ? `${e.target.value}:00` : e.target.value } : { valueDateTime: new Date(e.target.value).toISOString() }] : []) }));
        break;
      case "boolean":
        card.append(...[["true", "Yes"], ["false", "No"]].map(([v, label]) =>
          el("label", { class: `opt${String(value) === v ? " on" : ""}` }, el("input", { type: "radio", name, checked: String(value) === v, onchange: () => setAnswer(i.linkId, [{ valueBoolean: v === "true" }]) }), label)));
        break;
      case "radio": case "linear": {
        const row = kind === "linear" && opts.length <= 11;
        const wrap = el("div", { class: row ? "opts-row" : "" });
        opts.forEach((o) => wrap.append(el("label", { class: `opt${value === o.code ? " on" : ""}` },
          el("input", { type: "radio", name, checked: value === o.code, onchange: () => setAnswer(i.linkId, [{ valueCoding: { system: o.system, code: o.code, display: o.display } }]) }),
          o.display)));
        card.append(wrap);
        break;
      }
      case "checkboxes": {
        const codes = answers.map(rawOf);
        opts.forEach((o) => card.append(el("label", { class: `opt${codes.includes(o.code) ? " on" : ""}` },
          el("input", { type: "checkbox", checked: codes.includes(o.code), onchange: (e) => {
            const keep = answers.filter((a) => a.valueCoding?.code !== o.code);
            setAnswer(i.linkId, e.target.checked ? [...keep, { valueCoding: { system: o.system, code: o.code, display: o.display } }] : keep);
          } }), o.display)));
        break;
      }
      case "dropdown":
        card.append(el("select", { class: "input", onchange: (e) => {
          const o = opts.find((x) => x.code === e.target.value);
          setAnswer(i.linkId, o ? [{ valueCoding: { system: o.system, code: o.code, display: o.display } }] : []);
        } }, el("option", { value: "" }, "Choose…"), opts.map((o) => el("option", { value: o.code, selected: value === o.code }, o.display))));
        break;
      case "grid": card.append(renderGrid(i, problems)); break;
      case "gps": card.append(renderGps(i)); break;
      case "photo": card.append(renderPhoto(i, answers)); break;
      case "audio": card.append(renderAudio(i, answers)); break;
      case "group": {
        const inner = el("div", { class: "group-items" });
        renderItems(i.item || [], inner, problems);
        card.append(inner);
        break;
      }
      default: break;
    }
    if (err) card.append(el("div", { class: "msg", text: err }));
    return card;
  }

  function renderGrid(group, problems) {
    const rows = (group.item || []).filter((r) => r.type === "choice" && enabled(r));
    const cols = (rows[0]?.answerOption || []).map((o) => o.valueCoding);
    const multi = !!rows[0]?.repeats;
    return el("div", { class: "grid-wrap" }, el("table", { class: "grid" },
      el("thead", {}, el("tr", {}, el("th", {}), cols.map((c) => el("th", { text: c.display })))),
      el("tbody", {}, rows.map((r) => {
        const current = (state.fill.answers.get(r.linkId) || []);
        const codes = current.map(rawOf);
        const bad = problems.has(r.linkId) || state.fill.errors.has(r.linkId);
        return el("tr", { class: bad ? "err" : null, "data-link": r.linkId },
          el("th", {}, r.prefix ? `${r.prefix} ` : "", r.text || "", r.required ? el("span", { class: "req", text: " *" }) : null),
          cols.map((c) => el("td", {}, el("input", { type: multi ? "checkbox" : "radio", name: `g_${r.linkId}`, "aria-label": `${r.text}: ${c.display}`, checked: codes.includes(c.code),
            onchange: (e) => {
              const coding = { valueCoding: { system: c.system, code: c.code, display: c.display } };
              setAnswer(r.linkId, multi ? (e.target.checked ? [...current.filter((a) => a.valueCoding?.code !== c.code), coding] : current.filter((a) => a.valueCoding?.code !== c.code)) : [coding]);
            } }))));
      }))));
  }

  function renderGps(group) {
    const axis = (name) => (group.item || []).find((c) => ext(c, GPS)?.valueString === name || c.linkId.endsWith(`_${name}`));
    const lat = axis("latitude"), lon = axis("longitude");
    const latV = lat && valuesOf(lat.linkId)[0], lonV = lon && valuesOf(lon.linkId)[0];
    const status = el("div", { class: "note" });
    const btn = el("button", { class: "btn navy", type: "button", onclick: () => {
      if (!window.isSecureContext || !navigator.geolocation) {
        status.textContent = "GPS needs the secure (https) address of AHIP Collect. Ask your administrator for it, or skip this question.";
        return;
      }
      btn.disabled = true;
      status.replaceChildren(el("span", { class: "spinner" }), " Getting your location…");
      navigator.geolocation.getCurrentPosition((pos) => {
        if (lat) setAnswer(lat.linkId, [{ valueDecimal: Number(pos.coords.latitude.toFixed(6)) }], false);
        if (lon) setAnswer(lon.linkId, [{ valueDecimal: Number(pos.coords.longitude.toFixed(6)) }], false);
        renderPreserveScroll();
        toast(`Location recorded (±${Math.round(pos.coords.accuracy)} m).`);
      }, (e) => {
        btn.disabled = false;
        status.textContent = e.code === 1 ? "Location permission was refused. Allow location for this site in the phone settings." : "Could not get your location. Go outside or near a window and try again.";
      }, { enableHighAccuracy: true, timeout: 25000, maximumAge: 0 });
    } }, latV != null ? "📍 Record again" : "📍 Record GPS location");
    return el("div", {},
      latV != null && el("p", { class: "gps-ok", text: `✓ ${latV}, ${lonV}` }),
      btn, status);
  }

  function readAsBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(",")[1]);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  /** Photos are made smaller (longest side 1280 px, JPEG) so they upload fast, as on the phone. */
  function shrinkPhoto(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement("canvas");
        c.width = Math.round(img.naturalWidth * scale);
        c.height = Math.round(img.naturalHeight * scale);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        const data = c.toDataURL("image/jpeg", 0.72).split(",")[1];
        resolve({ contentType: "image/jpeg", data, title: "photo.jpg", size: Math.round(data.length * 0.75) });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("This photo could not be read.")); };
      img.src = url;
    });
  }

  function renderPhoto(i, answers) {
    const a = answers[0]?.valueAttachment;
    const input = el("input", { type: "file", accept: "image/*", capture: "environment", hidden: true, onchange: async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        toast("Preparing the photo…");
        setAnswer(i.linkId, [{ valueAttachment: await shrinkPhoto(file) }]);
      } catch (err) { toast(err.message); }
    } });
    return el("div", { class: "media-row" },
      a && el("img", { class: "thumb", alt: "Photo taken", src: `data:${a.contentType};base64,${a.data}` }),
      input,
      el("button", { class: "btn small navy", type: "button", onclick: () => input.click() }, a ? "📷 Retake" : "📷 Take photo"),
      a && el("button", { class: "btn small ghost", type: "button", onclick: () => setAnswer(i.linkId, []) }, "Remove"));
  }

  function renderAudio(i, answers) {
    const a = answers[0]?.valueAttachment;
    const maxMin = ext(i, AUDIO_MAX)?.valueInteger || 5;
    const box = el("div");
    const canRecord = window.isSecureContext && navigator.mediaDevices?.getUserMedia && window.MediaRecorder;
    const fileInput = el("input", { type: "file", accept: "audio/*", hidden: true, onchange: async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 40 * 1048576) return toast("This recording is too large (over 40 MB).");
      setAnswer(i.linkId, [{ valueAttachment: { contentType: file.type || "audio/mp4", data: await readAsBase64(file), title: file.name, size: file.size } }]);
    } });
    if (a) box.append(el("audio", { controls: true, src: `data:${a.contentType};base64,${a.data}` }));
    const row = el("div", { class: "media-row" });
    if (canRecord) {
      row.append(el("button", { class: "btn small navy", type: "button", onclick: () => startRecording(i, box, maxMin) }, a ? "🎙 Record again" : "🎙 Record"));
    } else {
      row.append(fileInput, el("button", { class: "btn small navy", type: "button", onclick: () => fileInput.click() }, "🎙 Add a recording"));
      box.append(el("p", { class: "note", text: "Recording directly needs the secure (https) address of AHIP Collect; here you can attach a recording made with the phone's voice recorder." }));
    }
    if (a) row.append(el("button", { class: "btn small ghost", type: "button", onclick: () => setAnswer(i.linkId, []) }, "Remove"));
    box.append(row, el("p", { class: "note", text: `Up to ${maxMin} minutes.` }));
    return box;
  }

  async function startRecording(i, box, maxMin) {
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { return toast("Microphone permission was refused. Allow the microphone for this site in the phone settings."); }
    const type = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find((t) => MediaRecorder.isTypeSupported?.(t)) || "";
    const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks = [];
    const started = Date.now();
    const clock = el("b", { text: "0:00" });
    const stopBtn = el("button", { class: "btn small primary", type: "button", onclick: () => rec.stop() }, "■ Stop");
    box.replaceChildren(el("div", { class: "rec" }, el("span", { class: "dot" }), "Recording ", clock, stopBtn));
    const tick = setInterval(() => {
      clock.textContent = fmtClock(Date.now() - started);
      if (Date.now() - started >= maxMin * 60000) rec.stop();
    }, 500);
    recorder = rec;
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      clearInterval(tick);
      stream.getTracks().forEach((t) => t.stop());
      recorder = null;
      const blob = new Blob(chunks, { type: (rec.mimeType || type || "audio/mp4").split(";")[0] });
      setAnswer(i.linkId, [{ valueAttachment: { contentType: blob.type, data: await readAsBase64(blob), title: blob.type.includes("mp4") ? "recording.m4a" : "recording.webm", size: blob.size } }]);
      toast("Recording saved.");
    };
    rec.start(1000);
  }

  // ---------------------------------------------------------------- quiz timer
  function startTimer() {
    stopTimer();
    const f = state.fill;
    const quiz = f && Q.settings(f.form);
    if (!quiz?.timeLimitMinutes) return;
    const endsAt = f.startedAt + quiz.timeLimitMinutes * 60000;
    const tick = () => {
      const left = endsAt - Date.now();
      const t = document.getElementById("timer");
      if (t) { t.textContent = `⏱ ${fmtClock(left)}`; t.classList.toggle("low", left < 60000); }
      if (left <= 0) {
        stopTimer();
        if (recorder) recorder.stop();
        toast("Time is up. Your answers are being submitted.", 4000);
        setTimeout(() => submit(true), recorder ? 1500 : 0);
      }
    };
    tick();
    timer = setInterval(tick, 1000);
  }
  function stopTimer() { clearInterval(timer); timer = null; }

  // ---------------------------------------------------------------- review + submit
  function answerText(i) {
    const a = state.fill.answers.get(i.linkId) || [];
    return a.map((x) => x.valueCoding ? x.valueCoding.display || x.valueCoding.code
      : x.valueAttachment ? (x.valueAttachment.contentType || "").startsWith("audio") ? "🎙 recording" : "📷 photo"
      : x.valueBoolean != null ? (x.valueBoolean ? "Yes" : "No")
      : rawOf(x)).join(", ");
  }

  function renderReview() {
    const f = state.fill;
    const list = visiblePages();
    const relaxed = incompleteAllowed();
    let missing = 0;
    const sections = list.map((page, index) => {
      const rows = [];
      const walk = (items) => (items || []).forEach((i) => {
        if (!enabled(i) || isHidden(i) || i.type === "display") return;
        const kind = kindOf(i);
        if (kind === "gps") {
          const v = (i.item || []).map((c) => valuesOf(c.linkId)[0]).filter((x) => x != null);
          rows.push([i, v.length ? v.join(", ") : ""]);
          return;
        }
        if (i.type === "group") return walk(i.item);
        const text = answerText(i);
        if (!text && i.required && !relaxed) missing++;
        rows.push([i, text]);
      });
      walk(page.item);
      return el("section", { class: "review-section" },
        el("h3", { text: page.text || `Page ${index + 1}` }),
        rows.map(([i, text]) => el("div", { class: "review-row" },
          el("div", { class: "grow" },
            el("div", {}, i.prefix ? `${i.prefix} ` : "", i.text || ""),
            el("div", { class: `a${!text && i.required && !relaxed ? " missing" : ""}`, text: text || (i.required && !relaxed ? "Not answered (required)" : "Not answered") })),
          el("button", { class: "link-btn", onclick: () => { f.page = index; f.problems = null; go("form"); setTimeout(() => document.querySelector(`[data-link="${CSS.escape(i.linkId)}"]`)?.scrollIntoView({ block: "center" }), 60); } }, "Edit"))));
    });
    const quiz = Q.settings(f.form);
    $app.replaceChildren(
      bar("Review your answers", { right: quiz?.timeLimitMinutes ? [el("span", { class: "timer", id: "timer" })] : [] }),
      el("main", { class: "screen" },
        el("p", { class: "sub", text: missing ? `${missing} required question${missing === 1 ? " is" : "s are"} not answered. Tap Edit to answer.` : "Check the answers, then submit. Tap Edit to change one." }),
        sections),
      el("div", { class: "nav" }, el("div", { class: "nav-inner" },
        el("button", { class: "btn ghost", onclick: () => goBack() }, "Back"),
        el("button", { class: "btn green", disabled: missing > 0, onclick: () => submit(false) }, "Submit"))));
    startTimer();
  }

  function buildItems(items) {
    const out = [];
    for (const i of items || []) {
      if (!enabled(i) || i.type === "display") continue;
      if (i.type === "group") {
        const kids = buildItems(i.item);
        const node = { linkId: i.linkId, text: i.text };
        if (kids.length) node.item = kids;
        out.push(node);
        continue;
      }
      const node = { linkId: i.linkId };
      if (i.text) node.text = i.text;
      const a = (state.fill.answers.get(i.linkId) || []).filter((x) => rawOf(x) !== undefined && rawOf(x) !== "");
      if (a.length) node.answer = a.map((x) => (x.valueString != null ? { valueString: String(x.valueString).trim() } : x));
      out.push(node);
    }
    return out;
  }

  let submitting = false;
  async function submit(timedOut) {
    const f = state.fill;
    if (!f || submitting) return;
    submitting = true;
    stopTimer();
    const quiz = Q.settings(f.form);
    const response = {
      resourceType: "QuestionnaireResponse",
      questionnaire: `Questionnaire/${f.form.id}`,
      status: "completed",
      authored: new Date().toISOString(),
      item: buildItems(f.form.item),
    };
    if (quiz) {
      response.extension = [{ url: Q.SECONDS, valueInteger: Math.round((Date.now() - f.startedAt) / 1000) }];
      if (timedOut) response.extension.push({ url: Q.TIMED_OUT, valueBoolean: true });
    }
    const flatValues = new Map([...f.answers.entries()].map(([k, a]) => [k, a.map(rawOf)]));
    const count = (pred) => [...f.answers.entries()].filter(([k, a]) => a.length && pred(k, a)).length;
    const done = {
      form: f.form,
      answered: count((k) => !/^ahip-(study|assessment)$/.test(k)),
      photos: count((k, a) => a[0].valueAttachment && !String(a[0].valueAttachment.contentType).startsWith("audio")),
      audio: count((k, a) => a[0].valueAttachment && String(a[0].valueAttachment.contentType).startsWith("audio")),
      gps: [...f.answers.keys()].some((k) => /latitude/.test(k)),
      score: quiz ? Q.scoreAnswers(f.form, flatValues) : null,
      timedOut,
      seconds: quiz ? Math.round((Date.now() - f.startedAt) / 1000) : null,
      sent: false,
    };
    if (done.score) { done.score.timedOut = timedOut; }
    state.outbox.push({ id: f.id, response, formId: f.form.id, savedAt: new Date().toISOString() });
    await saveOutbox();
    delete state.drafts[f.id];
    await saveDrafts();
    state.fill = null;
    state.done = done;
    go("done");
    done.sent = await sendOne(state.outbox[state.outbox.length - 1]);
    submitting = false;
    if (state.screen === "done") render();
  }

  async function sendOne(entry) {
    try {
      await api("POST", "/api/collect/submit", { id: entry.id, response: entry.response });
      state.outbox = state.outbox.filter((x) => x.id !== entry.id);
      await saveOutbox();
      return true;
    } catch (e) {
      if (e.status === 401) toast("Please sign in again to send your submissions.");
      return false;
    }
  }

  async function syncAll(announce) {
    if (!state.user) return;
    const before = state.outbox.length;
    if (!before) { if (announce) toast("Everything is sent. ✓"); return; }
    if (announce) toast("Sending…");
    for (const entry of [...state.outbox]) await sendOne(entry);
    const sent = before - state.outbox.length;
    if (announce || sent) toast(state.outbox.length ? `${sent} sent, ${state.outbox.length} still waiting (no connection?).` : `All ${sent} submission${sent === 1 ? "" : "s"} sent. ✓`);
    if (["tools", "done", "summary"].includes(state.screen)) render();
  }
  window.addEventListener("online", () => syncAll(false));

  function renderDone() {
    const d = state.done;
    const check = (text) => el("div", { class: "check-row" }, el("span", { class: "ok", text: "✓" }), text);
    const s = d.score;
    $app.replaceChildren(bar(`Tool ${toolNumber(d.form)}: ${toolTitle(d.form)}`, { back: false }),
      el("main", { class: "screen done" },
        el("div", { class: "big-icon", text: "☁" }),
        el("h2", { text: "Assessment completed" }),
        s && el("div", { class: `score${s.percent >= 50 ? "" : " low"}` },
          el("div", { style: "font-weight:600", text: "Quiz score" }),
          el("div", { class: "pts", text: `${s.points} / ${s.total}` }),
          el("div", { text: `${s.percent}% · ${s.right} of ${s.count} questions correct` }),
          d.seconds != null && el("div", { class: "note", text: `Time taken: ${fmtClock(d.seconds * 1000)}` }),
          d.timedOut && el("div", { style: "margin-top:6px;font-weight:600", text: "Time ran out: your answers were submitted automatically." })),
        el("div", { style: "text-align:left" },
          check(`${d.answered} question${d.answered === 1 ? "" : "s"} answered`),
          d.photos > 0 && check(`${d.photos} photo${d.photos === 1 ? "" : "s"} attached`),
          d.gps && check("GPS location captured"),
          d.audio > 0 && check(`${d.audio} recording${d.audio === 1 ? "" : "s"} attached`),
          check("Saved on this phone")),
        el("div", { class: `banner${d.sent ? " ok" : ""}`, style: "margin-top:16px" },
          el("span", { class: "grow", text: d.sent ? "✓ Sent to the AHIP database." : submitting ? "Sending to the AHIP database…" : "Not sent yet (no connection). It is safe on this phone and will be sent automatically." }),
          !d.sent && !submitting && el("button", { class: "btn small navy", onclick: () => syncAll(true) }, "Send now"))),
      el("div", { class: "nav" }, el("div", { class: "nav-inner" },
        el("button", { class: "btn primary", onclick: () => go("tools") }, "Back to tools"))));
  }

  // ---------------------------------------------------------------- summary
  async function renderSummary() {
    $app.replaceChildren(bar("My Assessment Summary", { right: [menuButton()] }), el("main", { class: "screen" }, el("p", {}, el("span", { class: "spinner" }), " Loading…")));
    let mine = null;
    try { mine = (await api("GET", "/api/collect/mine")).submissions; } catch { /* offline */ }
    if (state.screen !== "summary") return;
    const byTool = new Map();
    (mine || []).forEach((m) => byTool.set(m.tool, (byTool.get(m.tool) || 0) + 1));
    const today = new Date().toDateString();
    const todayCount = (mine || []).filter((m) => new Date(m.submitted).toDateString() === today).length;
    $app.replaceChildren(bar("My Assessment Summary", { right: [menuButton()] }),
      el("main", { class: "screen" },
        el("h2", { class: "heading", text: state.user?.name || "" }),
        el("p", { class: "sub", text: mine ? "Your submissions in the AHIP database." : "Offline: showing what is on this phone." }),
        el("div", { class: "stats" },
          el("div", { class: "stat" }, el("div", { class: "v", text: mine ? mine.length : "–" }), el("div", { class: "l", text: "Submitted" })),
          el("div", { class: "stat" }, el("div", { class: "v", text: mine ? todayCount : "–" }), el("div", { class: "l", text: "Today" })),
          el("div", { class: "stat" }, el("div", { class: "v", text: state.outbox.length }), el("div", { class: "l", text: "Waiting to send" })),
          el("div", { class: "stat" }, el("div", { class: "v", text: Object.keys(state.drafts).length }), el("div", { class: "l", text: "Drafts" }))),
        mine && el("section", { class: "review-section" }, el("h3", { text: "By tool" }),
          [...byTool.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([tool, n]) => el("div", { class: "row-line" }, el("span", { text: tool }), el("b", { text: n }))),
          !byTool.size && el("p", { class: "note", text: "No submissions yet." })),
        mine && mine.length > 0 && el("p", { class: "note", text: `Last submitted: ${when(mine[0].submitted)}` })));
  }

  // ---------------------------------------------------------------- render + boot
  function render() {
    switch (state.screen) {
      case "study": return renderStudy();
      case "assessment": return renderAssessment();
      case "tools": return renderTools();
      case "form": return renderForm();
      case "review": return renderReview();
      case "done": return renderDone();
      case "summary": return renderSummary();
      default: return renderLogin();
    }
  }

  window.addEventListener("beforeunload", (e) => {
    if (state.fill) autosave(true);
    if (recorder) { e.preventDefault(); e.returnValue = ""; }
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden && state.fill) autosave(true); });

  (async function boot() {
    $app.replaceChildren(el("main", { class: "welcome" }, el("img", { class: "logo", src: "ahip_logo.png", alt: "AHIP" }), el("p", {}, el("span", { class: "spinner" }))));
    try {
      const { user } = await api("GET", "/api/collect/session");
      return startAs(user);
    } catch (e) {
      if (e.status === 401) return renderLogin();
      // Offline: continue with the account and forms saved on this phone.
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem("ahip_web_user") || "null"); } catch {}
      if (saved) { toast("Offline: your answers are kept on this phone and sent later."); return startAs(saved); }
      renderLogin("The AHIP server could not be reached. Check your internet or Wi-Fi.");
    }
  })();
})();
