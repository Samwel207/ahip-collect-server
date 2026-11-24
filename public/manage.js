// AHIP Manage > Manage data (administrators): every form in a table, with Edit, Return to the
// collector and Delete. Each action needs a written reason, which is kept in the form's history
// (extension urn:ahip:change) and shown to the collector when a form is returned.
(function () {
  "use strict";
  const COLLECTOR_TAG = "urn:ahip:data-collector";
  const CHANGE_EXT = "urn:ahip:change";
  const RETURNED_EXT = "urn:ahip:returned";
  const SITE_IDS = ["cpp_name_other", "cpp_name", "facility_name", "council_other", "council"];
  const PAGE = 25;
  const $ = (id) => document.getElementById(id);
  const state = { rows: [], forms: new Map(), names: new Map(), deleted: [], page: 0, loaded: false };

  function el(tag, attrs = {}, ...children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (["value", "checked", "selected", "disabled"].includes(k)) n[k] = v;
      else n.setAttribute(k, v === true ? "" : v);
    }
    children.flat(Infinity).forEach((c) => c != null && c !== false && n.append(c instanceof Node ? c : document.createTextNode(String(c))));
    return n;
  }

  async function getJson(url) {
    const r = await fetch(url, { headers: { Accept: "application/fhir+json" } });
    if (r.status === 401) { location.replace("/login.html"); throw new Error("Signed out"); }
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return r.json();
  }
  async function fetchAll(first) {
    const out = [];
    let url = first;
    for (let g = 0; url && g < 200; g++) {
      const b = await getJson(url);
      (b.entry || []).forEach((e) => e.resource && out.push(e.resource));
      const next = (b.link || []).find((l) => l.relation === "next");
      url = next ? "/fhir" + new URL(next.url).search : null;
    }
    return out;
  }
  async function post(url, body) {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
    return j;
  }

  const ext = (x, url) => (x.extension || []).filter((e) => e.url === url);
  const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
  const answerText = (a) => a.valueCoding ? a.valueCoding.display || a.valueCoding.code
    : a.valueAttachment ? (String(a.valueAttachment.contentType).startsWith("audio") ? "🎤 recording" : "📷 photo")
    : String(a.valueString ?? a.valueInteger ?? a.valueDecimal ?? a.valueBoolean ?? a.valueDate ?? a.valueDateTime ?? a.valueTime ?? "");
  const fmt = (d) => (d ? new Date(d).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—");

  function toRow(r) {
    const formId = String(r.questionnaire || "").replace(/^Questionnaire\//, "").split("|")[0];
    const form = state.forms.get(formId);
    if (!form) return null;
    const answers = new Map();
    const walk = (items) => (items || []).forEach((i) => { if (i.answer?.length && !answers.has(i.linkId)) answers.set(i.linkId, i.answer); walk(i.item); (i.answer || []).forEach((a) => walk(a.item)); });
    walk(r.item);
    const site = SITE_IDS.map((k) => answers.get(k)?.[0]).filter(Boolean).map(answerText).find((v) => v && !/^new cpp/i.test(v)) || "—";
    const tag = (r.meta?.tag || []).find((t) => t.system === COLLECTOR_TAG)?.code || "";
    const history = ext(r, CHANGE_EXT).map((e) => parse(e.valueString)).filter(Boolean);
    const returned = ext(r, RETURNED_EXT).map((e) => parse(e.valueString)).filter(Boolean).pop() || null;
    const status = returned && r.status === "in-progress" ? "Returned"
      : returned && r.status === "completed" ? "Corrected"
      : r.status === "in-progress" ? "Draft"
      : history.some((h) => h.action === "edited") ? "Edited" : "Submitted";
    return {
      id: r.id, resource: r, form, formTitle: form.title || formId, site,
      collector: state.names.get(tag) || tag || "Unknown", status, history, returned,
      date: r.authored || r.meta?.lastUpdated,
    };
  }

  async function load() {
    $("mStatus").textContent = "Loading…";
    try {
      const [forms, responses, people, deleted] = await Promise.all([
        fetchAll("/fhir/Questionnaire?identifier=urn%3Aahip%3Atool%7C&_count=200"),
        fetchAll("/fhir/QuestionnaireResponse?_count=200&_sort=-_lastUpdated"),
        getJson("/api/users").catch(() => ({ users: [] })),
        getJson("/api/data/deleted").catch(() => ({ deleted: [] })),
      ]);
      state.forms = new Map(forms.map((q) => [q.id, q]));
      state.names = new Map((people.users || []).map((u) => [u.username, u.name]));
      state.rows = responses.map(toRow).filter(Boolean).sort((a, b) => String(b.date).localeCompare(String(a.date)));
      state.deleted = deleted.deleted || [];
      state.loaded = true;
      $("mStatus").textContent = `Updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
      render();
    } catch (e) {
      $("mStatus").textContent = `Could not load the data: ${e.message}`;
    }
  }

  function filtered() {
    const q = $("mSearch").value.trim().toLowerCase();
    const st = $("mFilter").value;
    return state.rows.filter((r) => (!st || r.status === st) && (!q || [r.formTitle, r.site, r.collector, r.status, r.id].join(" ").toLowerCase().includes(q)));
  }

  function render() {
    const rows = filtered();
    const pages = Math.max(1, Math.ceil(rows.length / PAGE));
    state.page = Math.min(state.page, pages - 1);
    $("mCount").textContent = `(${rows.length})`;
    const body = $("mRows");
    body.replaceChildren(...(rows.length ? rows.slice(state.page * PAGE, (state.page + 1) * PAGE).map((r) => {
      const last = r.history[r.history.length - 1];
      return el("tr", {},
        el("td", { text: fmt(r.date) }),
        el("td", { text: r.formTitle }),
        el("td", { text: r.site }),
        el("td", { text: r.collector }),
        el("td", {}, el("span", { class: `m-status ${r.status.toLowerCase()}`, text: r.status })),
        el("td", { class: "m-last" }, last ? `${last.action} by ${last.by}: “${last.reason}”` : "—",
          r.history.length > 0 && el("button", { class: "linkish", type: "button", onclick: () => openHistory(r) }, ` History (${r.history.length})`)),
        el("td", { class: "m-actions" },
          el("button", { class: "btn ghost", type: "button", onclick: () => openEdit(r) }, "Edit"),
          el("button", { class: "btn ghost", type: "button", disabled: r.status === "Returned", title: r.status === "Returned" ? "Already with the collector" : "Send back to the data collector to correct", onclick: () => openReason(r, "return") }, "Return"),
          el("button", { class: "btn ghost danger", type: "button", onclick: () => openReason(r, "delete") }, "Delete")));
    }) : [el("tr", {}, el("td", { colspan: 7, class: "muted", text: state.loaded ? "No forms match." : "Loading…" }))]));
    $("mPage").textContent = `Page ${state.page + 1} of ${pages}`;
    $("mPrev").disabled = state.page === 0;
    $("mNext").disabled = state.page >= pages - 1;
    $("mDeletedCount").textContent = `(${state.deleted.length})`;
    $("mDeleted").replaceChildren(...(state.deleted.length ? state.deleted.slice(0, 100).map((d) => el("tr", {},
      el("td", { text: fmt(d.at) }), el("td", { text: state.forms.get(d.form)?.title || d.form }), el("td", { text: state.names.get(d.collector) || d.collector || "—" }),
      el("td", { text: d.by }), el("td", { text: d.reason }))) : [el("tr", {}, el("td", { colspan: 5, class: "muted", text: "No forms deleted." }))]));
  }

  // ---------------------------------------------------------------- dialogs
  function dialog(title, content, actions) {
    const d = el("dialog", { class: "tile-dialog m-dialog" },
      el("div", { class: "tile-dialog-head" }, el("h2", { text: title }), el("button", { class: "icon-btn", type: "button", "aria-label": "Close", onclick: () => d.close() }, "✕")),
      content,
      el("div", { class: "m-dialog-actions" }, actions(() => d.close())));
    d.addEventListener("close", () => d.remove());
    document.body.append(d);
    d.showModal();
    return d;
  }
  const reasonBox = (placeholder) => el("textarea", { class: "m-reason", rows: 3, maxlength: 1000, placeholder, required: true });
  const errorBox = () => el("p", { class: "m-error", role: "alert", hidden: true });
  async function run(button, err, fn) {
    button.disabled = true;
    err.hidden = true;
    try { await fn(); } catch (e) { err.textContent = e.message; err.hidden = false; button.disabled = false; return false; }
    return true;
  }

  function openReason(r, action) {
    const del = action === "delete";
    const reason = reasonBox(del ? "Why is this form deleted? (e.g. duplicate of another submission)" : "What must the collector correct? (e.g. Question 12: the number of clients is too high, please check)");
    const err = errorBox();
    dialog(del ? "Delete this form" : "Return to the data collector",
      el("div", {},
        el("p", { text: `${r.formTitle} · ${r.site} · ${r.collector} · ${fmt(r.date)}` }),
        el("p", { class: "muted", text: del
          ? "The form is removed from the data (a backup copy and your reason are kept in the deleted forms list below)."
          : "The form goes back to the collector as a draft, with your explanation. When they correct and submit it, it shows here as Corrected." }),
        el("label", { class: "m-label" }, del ? "Reason for deleting (required)" : "Explanation for the collector (required)", reason), err),
      (close) => [
        el("button", { class: "btn ghost", type: "button", onclick: close }, "Cancel"),
        el("button", { class: `btn ${del ? "danger-solid" : "primary"}`, type: "button", onclick: async (e) => {
          if (reason.value.trim().length < 3) { err.textContent = "Write the reason first."; err.hidden = false; return reason.focus(); }
          if (await run(e.target, err, () => post(`/api/data/${encodeURIComponent(r.id)}/${action}`, { reason: reason.value.trim() }))) { close(); load(); }
        } }, del ? "Delete form" : "Return to collector"),
      ]);
    setTimeout(() => reason.focus(), 50);
  }

  function openHistory(r) {
    dialog("Change history", el("ol", { class: "m-history" }, r.history.map((h) => el("li", {},
      el("div", { class: "m-h-head", text: `${fmt(h.at)} · ${h.action} by ${h.by}` }),
      el("div", { class: "m-h-reason", text: `“${h.reason}”` }),
      (h.changes || []).length > 0 && el("ul", {}, h.changes.map((c) => el("li", { text: `${c.question}: “${c.from || "—"}” → “${c.to || "—"}”` })))))),
    (close) => [el("button", { class: "btn primary", type: "button", onclick: close }, "Close")]);
  }

  /** Edit the answers (photos and recordings stay as they are). */
  function openEdit(r) {
    const meta = new Map();
    const walkForm = (items) => (items || []).forEach((i) => { meta.set(i.linkId, i); walkForm(i.item); });
    walkForm(r.form.item);
    const fields = [];
    const list = el("div", { class: "m-edit-list" });
    const walk = (items, section) => (items || []).forEach((i) => {
      const q = meta.get(i.linkId);
      if (q?.type === "group" || (!q && i.item && !i.answer)) {
        if (q?.text && q.extension?.some((e) => /itemControl/.test(e.url) && JSON.stringify(e).includes("page"))) list.append(el("h3", { class: "m-sec", text: q.text }));
        return walk(i.item, section);
      }
      const ans = i.answer || [];
      if (ans.some((a) => a.valueAttachment) || q?.type === "attachment") {
        list.append(el("div", { class: "m-field" }, el("div", { class: "m-q", text: `${q?.prefix ? q.prefix + " " : ""}${q?.text || i.text || i.linkId}` }), el("div", { class: "muted", text: ans.length ? ans.map(answerText).join(", ") + " (not editable here)" : "—" })));
      } else if (q && !["display"].includes(q.type)) {
        const input = inputFor(q, ans);
        fields.push({ linkId: i.linkId, read: input.read, original: JSON.stringify(input.read()) });
        list.append(el("label", { class: "m-field" }, el("div", { class: "m-q", text: `${q.prefix ? q.prefix + " " : ""}${q.text || i.linkId}` }), input.node));
      }
      (i.answer || []).forEach((a) => walk(a.item, section));
      if (i.item && q?.type !== "group") walk(i.item, section);
    });
    walk(r.resource.item);
    const reason = reasonBox("Why are these answers changed? (e.g. corrected after calling the collector)");
    const err = errorBox();
    dialog(`Edit: ${r.formTitle}`,
      el("div", {}, el("p", { class: "muted", text: `${r.site} · ${r.collector} · ${fmt(r.date)}. Change the answers, then write the reason. Only questions that were answered or shown on the form can be edited.` }),
        list, el("label", { class: "m-label" }, "Reason for the changes (required)", reason), err),
      (close) => [
        el("button", { class: "btn ghost", type: "button", onclick: close }, "Cancel"),
        el("button", { class: "btn primary", type: "button", onclick: async (e) => {
          const changes = fields.filter((f) => JSON.stringify(f.read()) !== f.original).map((f) => ({ linkId: f.linkId, answer: f.read() }));
          if (!changes.length) { err.textContent = "No answer was changed."; err.hidden = false; return; }
          if (reason.value.trim().length < 3) { err.textContent = "Write the reason for the changes."; err.hidden = false; return reason.focus(); }
          if (await run(e.target, err, () => post(`/api/data/${encodeURIComponent(r.id)}/edit`, { reason: reason.value.trim(), changes }))) { close(); load(); }
        } }, "Save changes"),
      ]);
  }

  function inputFor(q, ans) {
    const options = (q.answerOption || []).map((o) => o.valueCoding).filter(Boolean);
    if ((q.type === "choice" || q.type === "open-choice") && options.length) {
      if (q.repeats) {
        const codes = new Set(ans.map((a) => a.valueCoding?.code));
        const boxes = options.map((o) => ({ o, box: el("input", { type: "checkbox", checked: codes.has(o.code) }) }));
        return { node: el("div", { class: "m-checks" }, boxes.map(({ o, box }) => el("label", {}, box, " ", o.display || o.code))),
          read: () => boxes.filter((b) => b.box.checked).map(({ o }) => ({ valueCoding: { system: o.system, code: o.code, display: o.display } })) };
      }
      const current = ans[0]?.valueCoding?.code || "";
      const sel = el("select", {}, el("option", { value: "" }, "— no answer —"), options.map((o) => el("option", { value: o.code, selected: o.code === current }, o.display || o.code)));
      return { node: sel, read: () => { const o = options.find((x) => x.code === sel.value); return o ? [{ valueCoding: { system: o.system, code: o.code, display: o.display } }] : []; } };
    }
    if (q.type === "boolean") {
      const v = ans[0]?.valueBoolean;
      const sel = el("select", {}, el("option", { value: "" }, "— no answer —"), el("option", { value: "true", selected: v === true }, "Yes"), el("option", { value: "false", selected: v === false }, "No"));
      return { node: sel, read: () => (sel.value ? [{ valueBoolean: sel.value === "true" }] : []) };
    }
    if (q.type === "integer" || q.type === "decimal") {
      const v = ans[0]?.valueInteger ?? ans[0]?.valueDecimal ?? "";
      const inp = el("input", { type: "number", step: q.type === "integer" ? 1 : "any", value: v });
      return { node: inp, read: () => { if (inp.value === "") return []; const n = Number(inp.value); return Number.isNaN(n) ? [] : [q.type === "integer" ? { valueInteger: Math.round(n) } : { valueDecimal: n }]; } };
    }
    if (q.type === "date") {
      const inp = el("input", { type: "date", value: ans[0]?.valueDate || "" });
      return { node: inp, read: () => (inp.value ? [{ valueDate: inp.value }] : []) };
    }
    if (q.type === "time") {
      const inp = el("input", { type: "time", value: String(ans[0]?.valueTime || "").slice(0, 5) });
      return { node: inp, read: () => (inp.value ? [{ valueTime: inp.value }] : []) };
    }
    const text = ans.map(answerText).join(", ");
    const inp = q.type === "text" ? el("textarea", { rows: 3 }, text) : el("input", { type: "text", value: text });
    return { node: inp, read: () => (inp.value.trim() ? [{ valueString: inp.value.trim() }] : []) };
  }

  // ---------------------------------------------------------------- wiring
  $("mSearch").addEventListener("input", () => { state.page = 0; render(); });
  $("mFilter").addEventListener("change", () => { state.page = 0; render(); });
  $("mPrev").addEventListener("click", () => { state.page--; render(); });
  $("mNext").addEventListener("click", () => { state.page++; render(); });
  $("mRefresh").addEventListener("click", load);
  window.AHIP_MANAGE = { load };
})();
