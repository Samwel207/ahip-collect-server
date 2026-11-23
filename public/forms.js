// AHIP Manage > Forms: a Google-Forms-like editor for the AHIP tool forms (FHIR Questionnaires).
// The form is edited in place as FHIR JSON and published through /api/forms (admins only).
"use strict";

const $ = (id) => document.getElementById(id);
const SYS = "urn:ahip:answer";
const ITEM_CONTROL = "http://hl7.org/fhir/StructureDefinition/questionnaire-itemControl";
const CONTROL_SYS = "http://hl7.org/fhir/questionnaire-item-control";
const MIN_VALUE = "http://hl7.org/fhir/StructureDefinition/minValue";
const MAX_VALUE = "http://hl7.org/fhir/StructureDefinition/maxValue";
const REGEX = "http://hl7.org/fhir/StructureDefinition/regex";
const MIME_TYPE = "http://hl7.org/fhir/StructureDefinition/mimeType";
const MAX_SIZE = "http://hl7.org/fhir/StructureDefinition/maxSize";
const GPS = "https://github.com/google/android-fhir/StructureDefinition/gps-coordinate";
const AUDIO_MAX = "https://smartregister.org/audio-max-duration-minutes";
const GRID = "urn:ahip:grid";
const PHONE_REGEX = "^(\\+?255|0)[0-9]{9}$";
const EMAIL_REGEX = "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$";
const SLIDER_STEP = "http://hl7.org/fhir/StructureDefinition/questionnaire-sliderStepValue";
const HIDDEN = "http://hl7.org/fhir/StructureDefinition/questionnaire-hidden";
const LINEAR = "urn:ahip:linear-scale";
const TOOL_SYSTEM = "urn:ahip:tool";
const TARGET_EXT = "urn:ahip:tool-target";
const MINUTES_EXT = "urn:ahip:tool-minutes";
const Q = window.AHIP_QUIZ;
const QUIZ_KINDS = new Set(["multiple", "checkboxes", "dropdown", "likert", "linear", "integer", "decimal", "slider", "short"]);
const isQuiz = () => !!Q.settings(state.form);

// Items the app depends on: shown with a lock, not editable / removable here.
const LOCKED = new Set([
  "ahip-study", "ahip-assessment", "collection_mode", "region", "region_other", "council", "council_other", "cpp_name", "cpp_name_other",
  "gps", "gps_latitude", "gps_longitude", "interview_recording_note", "interview_audio_1", "interview_audio_2",
  "interview_notes", "photos_note", "photo_1", "photo_2",
]);
const FIXED_PAGES = new Set(["interview_recording", "photos"]);

const TYPES = [
  { kind: "short", label: "Short answer", icon: "▭", group: "Text" },
  { kind: "paragraph", label: "Paragraph (open-ended)", icon: "☰", group: "Text" },
  { kind: "email", label: "Email", icon: "@", group: "Text" },
  { kind: "phone", label: "Phone number", icon: "☏", group: "Text" },
  { kind: "multiple", label: "Multiple choice", icon: "◉", group: "Choice" },
  { kind: "checkboxes", label: "Checkboxes", icon: "☑", group: "Choice" },
  { kind: "dropdown", label: "Dropdown", icon: "▾", group: "Choice" },
  { kind: "linear", label: "Linear scale (1 to 5, 0 to 10…)", icon: "⋯", group: "Scale" },
  { kind: "likert", label: "Likert scale (agree … disagree)", icon: "≋", group: "Scale" },
  { kind: "grid", label: "Multiple choice grid (table)", icon: "▦", group: "Table" },
  { kind: "checkgrid", label: "Checkbox grid (table)", icon: "▤", group: "Table" },
  { kind: "integer", label: "Number (whole)", icon: "#", group: "Number" },
  { kind: "decimal", label: "Number (decimal)", icon: "#.", group: "Number" },
  { kind: "slider", label: "Slider (number)", icon: "⟷", group: "Number" },
  { kind: "date", label: "Date", icon: "📅", group: "Date & time" },
  { kind: "time", label: "Time", icon: "🕒", group: "Date & time" },
  { kind: "photo", label: "Photo", icon: "📷", group: "Media" },
  { kind: "audio", label: "Audio recording", icon: "🎙", group: "Media" },
  { kind: "gps", label: "GPS location", icon: "📍", group: "Media" },
  { kind: "note", label: "Instructions (text only)", icon: "ℹ", group: "Other" },
];
const TYPE_LABEL = Object.fromEntries(TYPES.map((t) => [t.kind, t.label]));
TYPE_LABEL.group = "Group of questions";

const SCALES = {
  agree5: ["1 - Strongly disagree", "2 - Disagree", "3 - Neutral", "4 - Agree", "5 - Strongly agree"],
  agree6: ["1 - Strongly disagree", "2 - Disagree", "3 - Neutral", "4 - Agree", "5 - Strongly agree", "6 - I don't know"],
  freq5: ["Always", "Often", "Sometimes", "Rarely", "Never"],
  satisfy5: ["Very satisfied", "Satisfied", "Neutral", "Dissatisfied", "Very dissatisfied"],
  quality4: ["Excellent", "Good", "Fair", "Poor"],
};
const SCALE_NAMES = {
  agree5: "Agreement 1–5", agree6: "Agreement 1–5 + Don't know", freq5: "Frequency (Always … Never)",
  satisfy5: "Satisfaction (5 levels)", quality4: "Quality (Excellent … Poor)",
};

const state = { tools: [], toolId: null, form: null, original: null, open: new Set(), dirty: false, current: null, drag: null, logic: new Set(), branching: new Set() };

// ------------------------------------------------------------------ helpers

const clone = (x) => JSON.parse(JSON.stringify(x));
const control = (code) => ({ url: ITEM_CONTROL, valueCodeableConcept: { coding: [{ system: CONTROL_SYS, code }] } });
const controlOf = (item) => (item.extension || []).find((e) => e.url === ITEM_CONTROL)?.valueCodeableConcept?.coding?.[0]?.code;
const ext = (item, url) => (item.extension || []).find((e) => e.url === url);
const slug = (s) =>
  String(s || "").toLowerCase().replace(/\(.*?\)/g, " ").replace(/[’'`]/g, "").replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "").slice(0, 40).replace(/_+$/g, "") || "q";

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (k === "text") node.textContent = v;
    else node.setAttribute(k, v === true ? "" : v);
  }
  children.flat(Infinity).forEach((c) => {
    if (c == null || c === false || c === true) return;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  });
  return node;
}

function allItems(items = state.form?.item || [], out = []) {
  items.forEach((i) => { out.push(i); allItems(i.item || [], out); });
  return out;
}

function uniqueLinkId(base) {
  const used = new Set(allItems().map((i) => i.linkId));
  let id = slug(base);
  if (!used.has(id)) return id;
  let n = 2;
  while (used.has(`${id}_${n}`)) n++;
  return `${id}_${n}`;
}

const isHelper = (item, siblings) =>
  /_hint$/.test(item.linkId) && item.type === "display" && controlOf(item) === "flyover" ||
  (/_audio$/.test(item.linkId) && siblings.some((s) => `${s.linkId}_audio` === item.linkId)) ||
  (/_other$/.test(item.linkId) && item.enableWhen?.[0]?.answerCoding?.code === "other" &&
    siblings.some((s) => `${s.linkId}_other` === item.linkId));

function kindOf(item) {
  const ctl = controlOf(item);
  switch (item.type) {
    case "display": return "note";
    case "group":
      if (ctl === "location-widget") return "gps";
      if (ext(item, GRID)) return item.item?.[0]?.repeats ? "checkgrid" : "grid";
      return "group";
    case "choice":
      if (ext(item, LINEAR)) return "linear";
      if (item.repeats) return "checkboxes";
      if (ctl === "drop-down") return "dropdown";
      if ((item.answerOption || []).every((o, i) => o.valueCoding?.code === String(i + 1))) return "likert";
      return "multiple";
    case "string": return ext(item, REGEX)?.valueString === EMAIL_REGEX ? "email" : ext(item, REGEX) ? "phone" : "short";
    case "text": return "paragraph";
    case "integer": return ctl === "slider" ? "slider" : "integer";
    case "decimal": return "decimal";
    case "date": return "date";
    case "time": return "time";
    case "dateTime": return "date";
    case "attachment": return ctl === "audio-recorder" ? "audio" : "photo";
    default: return item.type;
  }
}

function markDirty() {
  state.dirty = JSON.stringify(state.form) !== state.original;
  $("dirtyBadge").hidden = !state.dirty;
  $("publishBtn").disabled = !state.dirty;
  $("discardBtn").disabled = !state.dirty;
}

async function api(method, path, body, raw) {
  const res = await fetch(path, {
    method,
    headers: raw ? { "Content-Type": "application/octet-stream" } : body ? { "Content-Type": "application/json" } : {},
    body: raw || (body ? JSON.stringify(body) : undefined),
  });
  if (res.status === 401) { location.replace("/login.html"); throw new Error("Sign in required."); }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error || `Error ${res.status}`), { errors: json.errors });
  return json;
}

// ------------------------------------------------------------------ new items

function optionsFrom(labels, keep = []) {
  const used = new Set();
  return labels.map((label) => {
    const existing = keep.find((o) => o.valueCoding?.display === label);
    let code = existing?.valueCoding?.code || (/^other\b/i.test(label) ? "other" : slug(label));
    while (used.has(code)) code += "_2";
    used.add(code);
    return { valueCoding: { system: existing?.valueCoding?.system || SYS, code, display: label } };
  });
}

function nextNumber() {
  const nums = allItems().map((i) => parseInt(i.prefix, 10)).filter((n) => !isNaN(n));
  return `${(nums.length ? Math.max(...nums) : 0) + 1}.`;
}

function newItem(kind, text = "") {
  const linkId = uniqueLinkId(text || `q${nextNumber().replace(".", "")}`);
  const q = { linkId, text: text || "New question", type: "string" };
  switch (kind) {
    case "short": break;
    case "paragraph": q.type = "text"; break;
    case "multiple": q.type = "choice"; q.answerOption = optionsFrom(["Yes", "No"]); q.extension = [control("radio-button")]; break;
    case "checkboxes": q.type = "choice"; q.repeats = true; q.answerOption = optionsFrom(["Option 1", "Option 2"]); q.extension = [control("check-box")]; break;
    case "dropdown": q.type = "choice"; q.answerOption = optionsFrom(["Option 1", "Option 2", "Option 3"]); q.extension = [control("drop-down")]; break;
    case "likert":
      q.type = "choice";
      q.answerOption = SCALES.agree5.map((d, i) => ({ valueCoding: { system: SYS, code: String(i + 1), display: d } }));
      q.extension = [control("radio-button")];
      break;
    case "linear":
      q.type = "choice";
      q.text = text || "On a scale of 1 to 5, how …?";
      setLinear(q, 1, 5, "Not at all", "Extremely");
      break;
    case "grid":
    case "checkgrid": {
      q.type = "group";
      q.text = text || (kind === "grid" ? "Rate each statement" : "Tick all that apply for each row");
      q.extension = [{ url: GRID, valueBoolean: true }];
      const columns = kind === "grid"
        ? SCALES.agree5.map((d, i) => ({ valueCoding: { system: SYS, code: String(i + 1), display: d } }))
        : ["Column 1", "Column 2", "Column 3"].map((d, i) => ({ valueCoding: { system: SYS, code: String(i + 1), display: d } }));
      q.item = ["Row 1", "Row 2"].map((s) => gridRow(q, s, columns, kind === "checkgrid"));
      break;
    }
    case "slider":
      q.type = "integer";
      q.extension = [control("slider"), { url: MIN_VALUE, valueInteger: 0 }, { url: MAX_VALUE, valueInteger: 10 }, { url: SLIDER_STEP, valueInteger: 1 }];
      break;
    case "email": q.text = text || "Email address"; q.extension = [{ url: REGEX, valueString: EMAIL_REGEX }]; break;
    case "integer": q.type = "integer"; q.extension = [{ url: MIN_VALUE, valueInteger: 0 }]; break;
    case "decimal": q.type = "decimal"; q.extension = [{ url: MIN_VALUE, valueDecimal: 0 }]; break;
    case "date": q.type = "date"; break;
    case "time": q.type = "time"; break;
    case "phone": q.text = text || "Phone number (+255)"; q.extension = [{ url: REGEX, valueString: PHONE_REGEX }]; break;
    case "photo":
      q.type = "attachment";
      q.text = text || "Photo";
      q.extension = [{ url: MIME_TYPE, valueCode: "image/jpeg" }, { url: MIME_TYPE, valueCode: "image/png" }, { url: MAX_SIZE, valueDecimal: 10485760 }];
      break;
    case "gps": {
      q.type = "group";
      q.text = text || "GPS reading";
      q.extension = [control("location-widget")];
      q.item = ["latitude", "longitude"].map((axis) => ({
        linkId: `${linkId}_${axis}`, text: axis === "latitude" ? "Latitude" : "Longitude", type: "decimal",
        extension: [{ url: GPS, valueString: axis }],
      }));
      break;
    }
    case "audio": q.type = "attachment"; q.text = text || "Audio recording"; q.extension = audioExtensions(5); break;
    case "note": q.type = "display"; q.text = text || "Instructions for the data collector"; break;
  }
  if (!["note", "gps", "audio", "photo"].includes(kind)) q.required = true;
  if (!["note", "gps"].includes(kind)) q.prefix = nextNumber();
  return q;
}

function gridRow(grid, statement, options, repeats = false) {
  const row = {
    linkId: uniqueLinkIdWithin(grid, `${grid.linkId}_${slug(statement)}`),
    text: statement,
    type: "choice",
    required: grid.required !== false,
    answerOption: clone(options),
    extension: [control(repeats ? "check-box" : "radio-button")],
  };
  if (repeats) row.repeats = true;
  return row;
}

/** Linear scale: options low..high saved as their numbers; the end labels show on the first and last point. */
function setLinear(item, low, high, lowLabel, highLabel) {
  item.answerOption = [];
  for (let n = low; n <= high; n++) {
    const label = n === low && lowLabel ? `${n} – ${lowLabel}` : n === high && highLabel ? `${n} – ${highLabel}` : String(n);
    item.answerOption.push({ valueCoding: { system: SYS, code: String(n), display: label } });
  }
  item.extension = [control("radio-button"), { url: LINEAR, valueString: JSON.stringify({ low, high, lowLabel, highLabel }) }];
}

function linearOf(item) {
  try { return JSON.parse(ext(item, LINEAR)?.valueString || "{}"); } catch { return {}; }
}

function uniqueLinkIdWithin(grid, base) {
  const used = new Set([...allItems().map((i) => i.linkId), ...(grid.item || []).map((i) => i.linkId)]);
  let id = slug(base);
  let n = 2;
  while (used.has(id)) id = `${slug(base)}_${n++}`;
  return id;
}

const audioExtensions = (minutes) => [
  control("audio-recorder"),
  { url: MIME_TYPE, valueCode: "audio/mp4" },
  { url: MAX_SIZE, valueDecimal: Math.max(15, minutes) * 1048576 },
  { url: AUDIO_MAX, valueInteger: minutes },
];

// ------------------------------------------------------------------ render: tools

async function loadTools() {
  try {
    state.tools = (await api("GET", "/api/forms")).forms;
  } catch (e) {
    $("toolList").replaceChildren(el("li", { class: "error", text: e.message }));
    return;
  }
  renderTools();
}

function renderTools() {
  const item = (t) => el("li", {},
    el("button", { type: "button", "aria-current": String(t.id === state.toolId), onclick: () => openTool(t.id) },
      el("span", { class: "tool-name", text: t.title }),
      el("span", { class: "hint", text: `${t.questions} questions · ${t.sections} sections${t.lastUpdated ? " · updated " + new Date(t.lastUpdated).toLocaleDateString() : ""}` })));
  const active = state.tools.filter((t) => !t.archived);
  const archived = state.tools.filter((t) => t.archived);
  $("toolList").replaceChildren(...active.map(item),
    ...(archived.length ? [el("li", { class: "list-sub", text: `Archived (${archived.length})` }), ...archived.map((t) => { const li = item(t); li.classList.add("archived"); return li; })] : []));
}

async function openTool(id) {
  if (state.dirty && !confirm("You have unpublished changes. Leave them?")) return;
  state.toolId = id;
  renderTools();
  try {
    const { form } = await api("GET", `/api/forms/${id}`);
    setForm(form);
  } catch (e) {
    alert(e.message);
  }
  try { localStorage.setItem("ahip-forms-tool", id); } catch {}
}

function setForm(form, { dirty = false } = {}) {
  state.form = form;
  if (!dirty) state.original = JSON.stringify(form);
  state.open.clear();
  $("empty").hidden = true;
  $("editor").hidden = false;
  $("formTitle").value = form.title || "";
  $("formDesc").value = form.description || "";
  $("formTarget").value = extOf(form, TARGET_EXT)?.valueString || "";
  $("formMinutes").value = extOf(form, MINUTES_EXT)?.valueInteger || "";
  const quiz = Q.settings(form);
  $("formQuiz").checked = !!quiz;
  $("quizLimitWrap").hidden = !quiz;
  $("formQuizMinutes").value = quiz?.timeLimitMinutes || "";
  const tool = state.tools.find((t) => t.id === form.id);
  $("formMeta").textContent = `Tool ${tool?.number || "?"} · ${form.id} · version ${form.meta?.versionId || "–"}${tool?.lastUpdated ? " · published " + new Date(tool.lastUpdated).toLocaleString() : ""}`;
  $("archiveBtn").hidden = !!tool?.builtIn;
  $("archiveBtn").textContent = tool?.archived ? "Bring back" : "Archive form";
  $("archivedBanner").hidden = !tool?.archived;
  state.current = null;
  $("downloadBtn").href = `/api/forms/${form.id}/export.xlsx`;
  $("exportLink").href = `/api/forms/${form.id}/export.xlsx`;
  $("formErrors").hidden = true;
  render();
  markDirty();
}

// ------------------------------------------------------------------ render: sections & questions

function render() {
  const pages = state.form.item || [];
  $("sections").replaceChildren(...pages.map((page, index) => renderSection(page, index, pages)));
}

function renderSection(page, index, pages) {
  const fixed = index === 0 || FIXED_PAGES.has(page.linkId);
  const movable = !fixed;
  const editable = pages.filter((p, i) => i > 0 && !FIXED_PAGES.has(p.linkId));
  const pos = editable.indexOf(page);
  const logicOpen = state.logic.has(page.linkId);
  const head = el("div", { class: "section-head" },
    el("span", { class: "section-index", text: `Section ${index + 1} of ${pages.length}` }),
    FIXED_PAGES.has(page.linkId)
      ? el("h3", { class: "section-title", text: `🔒 ${page.text}` })
      : el("input", { class: "section-input", value: page.text || "", "aria-label": "Section title", oninput: (e) => { page.text = e.target.value; markDirty(); } }),
    el("div", { class: "row-actions" },
      movable && el("button", { type: "button", class: `icon-btn text-btn${page.enableWhen ? " on" : ""}`, title: "Show this section only when…", onclick: () => { logicOpen ? state.logic.delete(page.linkId) : state.logic.add(page.linkId); render(); } }, "⑂ Logic"),
      movable && el("button", { type: "button", class: "icon-btn", title: "Move section up", disabled: pos <= 0, onclick: () => moveSection(page, -1) }, "↑"),
      movable && el("button", { type: "button", class: "icon-btn", title: "Move section down", disabled: pos === editable.length - 1, onclick: () => moveSection(page, 1) }, "↓"),
      movable && el("button", { type: "button", class: "icon-btn", title: "Duplicate section", onclick: () => duplicateSection(page) }, "⧉"),
      movable && el("button", { type: "button", class: "icon-btn danger", title: "Delete section", onclick: () => deleteSection(page) }, "🗑"),
    ),
  );
  const logicNote = page.enableWhen?.length && !logicOpen &&
    el("p", { class: "logic-note", onclick: () => { state.logic.add(page.linkId); render(); } }, `⑂ Shown only when ${describeConditions(page)}`);
  const logic = logicOpen && conditionEditor(page, { title: "Show this section only when… (otherwise the phone skips it)" });
  const list = el("div", { class: "questions" });
  renderItems(page, list, { locked: FIXED_PAGES.has(page.linkId) });
  const add = !FIXED_PAGES.has(page.linkId) &&
    el("button", { type: "button", class: "btn ghost small add-q", onclick: (e) => showTypeMenu(e.currentTarget, (kind) => addQuestion(page, kind)) }, "+ Question");
  return el("section", { class: `card section${fixed ? " fixed" : ""}`, "data-page": page.linkId }, head, logicNote, logic, list, add);
}

function renderItems(parent, container, { locked = false, depth = 0 } = {}) {
  const items = parent.item || [];
  items.forEach((item, i) => {
    if (item.readOnly && ext(item, HIDDEN)) return;
    if (isHelper(item, items)) return;
    container.append(renderQuestion(item, parent, i, { locked: locked || LOCKED.has(item.linkId), depth }));
  });
}

function renderQuestion(item, parent, index, { locked, depth }) {
  const kind = kindOf(item);
  const open = state.open.has(item.linkId) && !locked;
  const siblings = (parent.item || []).filter((s) => !isHelper(s, parent.item));
  const pos = siblings.indexOf(item);
  const card = el("article", {
    class: `question${open ? " open" : ""}${locked ? " locked" : ""}`,
    style: depth ? `margin-left:${depth * 16}px` : null,
    "data-link": item.linkId,
  });
  if (open) {
    card.append(el("div", { class: "drag-grip", title: "Close", onclick: () => toggle(item) }, "⋯"), renderEditor(item, parent, kind, pos, siblings));
    return card;
  }
  const chips = [
    el("span", { class: "chip", text: `${TYPES.find((t) => t.kind === kind)?.icon || ""} ${TYPE_LABEL[kind] || kind}`.trim() }),
    item.required && el("span", { class: "chip req", text: "Required" }),
    isQuiz() && !locked && QUIZ_KINDS.has(kind) && (Q.keyOf(item)?.correct?.length
      ? el("span", { class: "chip key", text: `✓ ${Q.keyOf(item).points || 1} pt${(Q.keyOf(item).points || 1) == 1 ? "" : "s"}` })
      : el("span", { class: "chip nokey", text: "No answer key" })),
    item.enableWhen?.length > 0 && el("span", { class: "chip cond", title: describeConditions(item), text: "⑂ Conditional" }),
    branchCount(item) > 0 && el("span", { class: "chip cond", text: "⑂ Goes to sections" }),
    hasAudio(item, parent) && el("span", { class: "chip", text: "🎙 voice" }),
    locked && el("span", { class: "chip lock", text: "🔒 used by the app" }),
  ];
  const summary = el("div", { class: "q-summary", onclick: () => { if (!locked) toggle(item, parent); } },
    !locked && el("span", { class: "grip", title: "Drag to move", "aria-hidden": "true" }, "⠿"),
    el("span", { class: "q-num", text: item.prefix || "" }),
    el("div", { class: "q-text" },
      el("div", { text: item.text || "(no text)" }),
      el("div", { class: "chips" }, chips),
      (item.answerOption || []).length > 0 && el("div", { class: "q-options hint", text: item.answerOption.map((o) => o.valueCoding?.display).join(" · ") }),
      (kind === "grid" || kind === "checkgrid") && el("div", { class: "q-options hint", text: `${(item.item || []).length} rows × ${(item.item?.[0]?.answerOption || []).length} columns` }),
    ),
    !locked && el("div", { class: "row-actions", onclick: (e) => e.stopPropagation() },
      el("button", { type: "button", class: "icon-btn", title: "Move up", disabled: pos <= 0, onclick: () => moveItem(parent, item, -1) }, "↑"),
      el("button", { type: "button", class: "icon-btn", title: "Move down", disabled: pos === siblings.length - 1, onclick: () => moveItem(parent, item, 1) }, "↓"),
      el("button", { type: "button", class: "icon-btn", title: "Duplicate", onclick: () => duplicate(parent, item) }, "⧉"),
      el("button", { type: "button", class: "icon-btn danger", title: "Delete", onclick: () => removeItem(parent, item) }, "🗑"),
    ),
  );
  card.append(summary);
  if (!locked) enableDrag(card, parent, item);
  if (kind === "group") {
    const nested = el("div", { class: "nested" });
    renderItems(item, nested, { locked, depth: depth + 1 });
    card.append(nested);
  }
  return card;
}

// ---------------------------------------------------------------- drag & drop (within the same section / group)

function enableDrag(card, parent, item) {
  card.draggable = true;
  card.addEventListener("dragstart", (e) => {
    state.drag = { parent, item };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", item.linkId);
    card.classList.add("dragging");
  });
  card.addEventListener("dragend", () => {
    state.drag = null;
    document.querySelectorAll(".dragging, .drop-before, .drop-after").forEach((n) => n.classList.remove("dragging", "drop-before", "drop-after"));
  });
  card.addEventListener("dragover", (e) => {
    if (!state.drag || state.drag.parent !== parent || state.drag.item === item) return;
    e.preventDefault();
    const r = card.getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    card.classList.toggle("drop-after", after);
    card.classList.toggle("drop-before", !after);
  });
  card.addEventListener("dragleave", () => card.classList.remove("drop-before", "drop-after"));
  card.addEventListener("drop", (e) => {
    e.preventDefault();
    if (!state.drag || state.drag.parent !== parent) return;
    const r = card.getBoundingClientRect();
    moveBlockTo(parent, state.drag.item, item, e.clientY > r.top + r.height / 2);
  });
}

function moveBlockTo(parent, item, target, after) {
  if (item === target) return;
  const block = withHelpers(parent, item);
  const rest = parent.item.filter((s) => !block.includes(s));
  const targetBlock = withHelpers({ item: rest }, target);
  const at = after ? rest.indexOf(targetBlock[targetBlock.length - 1]) + 1 : rest.indexOf(targetBlock[0]);
  rest.splice(at, 0, ...block);
  parent.item = rest;
  markDirty();
  render();
}

function toggle(item, parent) {
  if (state.open.has(item.linkId)) {
    state.open.delete(item.linkId);
    if (state.current?.item === item) state.current = null;
  } else {
    state.open.clear(); // one open card at a time, as in Google Forms
    state.open.add(item.linkId);
    state.current = { item, parent: parent || parentOf(item) };
  }
  render();
}

function parentOf(item) {
  const search = (list, owner) => {
    for (const i of list || []) {
      if (i === item) return owner;
      const found = search(i.item, i);
      if (found) return found;
    }
    return null;
  };
  return search(state.form.item, state.form);
}

// ------------------------------------------------------------------ editor for one question

function field(label, input, hint) {
  return el("label", { class: "field" }, label, input, hint && el("span", { class: "hint", text: hint }));
}

function renderEditor(item, parent, kind, pos, siblings) {
  const box = el("div", { class: "q-editor" });
  const set = (fn) => { fn(); markDirty(); };

  const typeSelect = kind !== "note" && kind !== "group" && el("select", { class: "type-select", "aria-label": "Question type", onchange: (e) => changeType(parent, item, e.target.value) },
    TYPES.filter((t) => compatible(kind, t.kind)).map((t) => el("option", { value: t.kind, selected: t.kind === kind }, `${t.icon}  ${t.label}`)));
  box.append(el("div", { class: "q-top" },
    el("textarea", { class: "q-title-input", rows: 1, placeholder: kind === "note" ? "Instructions" : "Question", "aria-label": "Question text",
      oninput: (e) => { set(() => (item.text = e.target.value)); autoGrow(e.target); } }, item.text || ""),
    typeSelect));
  if (kind !== "note") box.append(el("input", { class: "q-desc-input", value: hintOf(item), placeholder: "Description / help text (optional)", oninput: (e) => set(() => setHint(item, e.target.value)) }));

  if (["multiple", "checkboxes", "dropdown"].includes(kind)) box.append(optionsEditor(item, parent));
  if (kind === "likert") box.append(scaleEditor(item, [item]));
  if (kind === "linear") box.append(linearEditor(item));
  if (kind === "grid" || kind === "checkgrid") box.append(gridEditor(item));
  if (kind === "integer" || kind === "decimal") box.append(rangeEditor(item, kind));
  if (kind === "slider") box.append(sliderEditor(item));
  if (["short", "paragraph", "email", "phone"].includes(kind)) box.append(el("div", { class: "answer-line", text: kind === "paragraph" ? "Long answer text" : kind === "email" ? "name@example.com" : kind === "phone" ? "+255 7XX XXX XXX" : "Short answer text" }));
  if (kind === "audio") {
    const minutes = ext(item, AUDIO_MAX)?.valueInteger || 5;
    box.append(field("Longest recording (minutes)", el("input", { type: "number", min: 1, max: 90, value: minutes, onchange: (e) => set(() => { item.extension = audioExtensions(Math.max(1, Math.min(90, Number(e.target.value) || 5))); }) })));
  }

  if (isQuiz() && QUIZ_KINDS.has(kind)) box.append(answerKeyEditor(item, kind));

  // More options, folded like Google's ⋮ menu (opened when something is set).
  const more = el("details", { class: "q-more", open: !!(item.enableWhen?.length || item.maxLength || state.branching.has(item.linkId)) },
    el("summary", {}, "More options: show only if, answer checks, voice recorder"));
  more.append(conditionEditor(item, { title: "Show this question only when…" }));
  if (["short", "paragraph"].includes(kind)) {
    more.append(lengthEditor(item));
    more.append(el("label", { class: "check" },
      el("input", { type: "checkbox", checked: hasAudio(item, parent), onchange: (e) => set(() => setAudio(parent, item, e.target.checked)) }),
      " Add a voice recorder under this question (the answer can also be recorded)"));
  }
  more.append(el("p", { class: "hint", text: `Data name (column in exports): ${item.linkId}` }));
  box.append(more);

  box.append(el("div", { class: "q-footer" },
    kind !== "note" && el("label", { class: "num-field" }, "No.",
      el("input", { value: (item.prefix || "").replace(/\.$/, ""), size: 4, placeholder: "–", oninput: (e) => set(() => { const v = e.target.value.trim(); if (v) item.prefix = v.endsWith(".") ? v : `${v}.`; else delete item.prefix; }) })),
    el("span", { class: "spacer" }),
    el("button", { type: "button", class: "icon-btn", title: "Move up", disabled: pos <= 0, onclick: () => moveItem(parent, item, -1) }, "↑"),
    el("button", { type: "button", class: "icon-btn", title: "Move down", disabled: pos === siblings.length - 1, onclick: () => moveItem(parent, item, 1) }, "↓"),
    el("button", { type: "button", class: "icon-btn", title: "Duplicate", onclick: () => duplicate(parent, item) }, "⧉"),
    el("button", { type: "button", class: "icon-btn danger", title: "Delete", onclick: () => removeItem(parent, item) }, "🗑"),
    kind !== "note" && kind !== "gps" && el("span", { class: "divider" }),
    kind !== "note" && kind !== "gps" && el("label", { class: "switch" },
      "Required",
      el("input", { type: "checkbox", role: "switch", checked: !!item.required, onchange: (e) => set(() => {
        if (e.target.checked) item.required = true; else delete item.required;
        if (kind === "grid" || kind === "checkgrid") (item.item || []).forEach((r) => (e.target.checked ? (r.required = true) : delete r.required));
      }) }),
      el("span", { class: "slider-track", "aria-hidden": "true" })),
    el("button", { type: "button", class: "btn small primary", onclick: () => toggle(item) }, "Done"),
  ));
  requestAnimationFrame(() => box.querySelectorAll(".q-title-input").forEach(autoGrow));
  return box;
}

/** Quiz: the correct answer(s) and the points for this question. */
function answerKeyEditor(item, kind) {
  const key = Q.keyOf(item) || { correct: [], points: 1 };
  const save = () => {
    item.extension = (item.extension || []).filter((e) => e.url !== Q.KEY);
    if (key.correct.length) item.extension.push({ url: Q.KEY, valueString: JSON.stringify({ correct: key.correct, points: Number(key.points) > 0 ? Number(key.points) : 1 }) });
    if (!item.extension.length) delete item.extension;
    markDirty();
  };
  const box = el("div", { class: "options answer-key" }, el("div", { class: "field-label", text: "✓ Answer key" }));
  if (item.type === "choice") {
    const multi = !!item.repeats;
    box.append(el("div", { class: "option-list" }, (item.answerOption || []).map((o) => {
      const code = o.valueCoding.code;
      return el("label", { class: `key-option${key.correct.includes(code) ? " correct" : ""}` },
        el("input", { type: multi ? "checkbox" : "radio", name: `key_${item.linkId}`, checked: key.correct.includes(code), onchange: (e) => {
          if (multi) key.correct = e.target.checked ? [...new Set([...key.correct, code])] : key.correct.filter((c) => c !== code);
          else key.correct = [code];
          save(); render();
        } }), o.valueCoding.display);
    })), el("p", { class: "hint", text: multi ? "Tick every correct option: the answer scores only when exactly these are chosen." : "Choose the correct option." }));
  } else {
    box.append(field(kind === "short" ? "Accepted answers (separate with ;)" : "Correct number",
      el("input", { value: key.correct.join("; "), placeholder: kind === "short" ? "e.g. Paracetamol; Panadol" : "e.g. 12",
        oninput: (e) => { key.correct = e.target.value.split(";").map((s) => s.trim()).filter(Boolean); save(); } }),
      kind === "short" ? "Upper / lower case and extra spaces are ignored." : null));
  }
  box.append(el("div", { class: "field-row" },
    field("Points", el("input", { type: "number", min: 1, max: 100, value: key.points || 1, class: "num-input",
      oninput: (e) => { key.points = Math.max(1, Math.round(Number(e.target.value) || 1)); save(); } })),
    key.correct.length > 0 && el("button", { type: "button", class: "btn ghost small", onclick: () => { key.correct = []; save(); render(); } }, "Clear answer key")));
  return box;
}

function autoGrow(t) {
  t.style.height = "auto";
  t.style.height = `${t.scrollHeight + 2}px`;
}

function compatible(from, to) {
  const groups = [
    ["short", "paragraph", "phone", "email"],
    ["multiple", "checkboxes", "dropdown", "likert", "linear"],
    ["grid", "checkgrid"],
    ["integer", "decimal", "slider"],
    ["date", "time"],
  ];
  return from === to || groups.some((g) => g.includes(from) && g.includes(to));
}

function changeType(parent, item, kind) {
  const from = kindOf(item);
  if (from === kind) return;
  const keepHint = (item.extension || []).filter((e) => e.url !== ITEM_CONTROL && e.url !== REGEX && e.url !== LINEAR && e.url !== SLIDER_STEP && e.url !== MIN_VALUE && e.url !== MAX_VALUE);
  if (["short", "paragraph", "phone", "email"].includes(kind)) {
    item.type = kind === "paragraph" ? "text" : "string";
    item.extension = [...keepHint];
    if (kind === "phone") item.extension.push({ url: REGEX, valueString: PHONE_REGEX });
    if (kind === "email") item.extension.push({ url: REGEX, valueString: EMAIL_REGEX });
  } else if (kind === "linear") {
    item.type = "choice";
    delete item.repeats;
    setLinear(item, 1, 5, "Not at all", "Extremely");
  } else if (["multiple", "checkboxes", "dropdown", "likert"].includes(kind)) {
    item.type = "choice";
    if (kind === "checkboxes") item.repeats = true; else delete item.repeats;
    item.extension = [control(kind === "checkboxes" ? "check-box" : kind === "dropdown" ? "drop-down" : "radio-button")];
    if (kind === "likert" && from !== "likert") item.answerOption = SCALES.agree5.map((d, i) => ({ valueCoding: { system: SYS, code: String(i + 1), display: d } }));
    if (from === "linear" && kind !== "likert") item.answerOption = optionsFrom(["Option 1", "Option 2"]);
  } else if (kind === "grid" || kind === "checkgrid") {
    (item.item || []).forEach((r) => {
      if (r.type !== "choice") return;
      if (kind === "checkgrid") r.repeats = true; else delete r.repeats;
      r.extension = [control(kind === "checkgrid" ? "check-box" : "radio-button")];
    });
  } else if (["integer", "decimal", "slider"].includes(kind)) {
    const num = (url) => { const e = ext(item, url); return e ? e.valueInteger ?? e.valueDecimal : undefined; };
    const min = num(MIN_VALUE), max = num(MAX_VALUE);
    item.type = kind === "decimal" ? "decimal" : "integer";
    const key = kind === "decimal" ? "valueDecimal" : "valueInteger";
    const round = (v) => (kind === "decimal" ? v : Math.round(v));
    item.extension = [...keepHint];
    if (kind === "slider") {
      item.extension.push(control("slider"), { url: MIN_VALUE, valueInteger: Math.round(min ?? 0) }, { url: MAX_VALUE, valueInteger: Math.round(max ?? 10) }, { url: SLIDER_STEP, valueInteger: 1 });
    } else {
      if (min !== undefined) item.extension.push({ url: MIN_VALUE, [key]: round(min) });
      if (max !== undefined) item.extension.push({ url: MAX_VALUE, [key]: round(max) });
    }
  } else if (kind === "date" || kind === "time") {
    item.type = kind;
  }
  if (item.extension && !item.extension.length) delete item.extension;
  markDirty();
  render();
}

function linearEditor(item) {
  const cfg = { low: 1, high: 5, lowLabel: "", highLabel: "", ...linearOf(item) };
  const apply = () => { setLinear(item, cfg.low, cfg.high, cfg.lowLabel.trim(), cfg.highLabel.trim()); markDirty(); };
  const pick = (values, value, onChange) =>
    el("select", { onchange: (e) => { onChange(Number(e.target.value)); apply(); render(); } }, values.map((v) => el("option", { value: v, selected: v === value }, String(v))));
  const points = el("div", { class: "scale-preview" },
    Array.from({ length: cfg.high - cfg.low + 1 }, (_, i) => el("span", { class: "scale-dot" }, el("b", { text: String(cfg.low + i) }), "○")));
  return el("div", { class: "options" },
    el("div", { class: "field-row" },
      field("From", pick([0, 1], cfg.low, (v) => (cfg.low = v))),
      field("To", pick([2, 3, 4, 5, 6, 7, 8, 9, 10], cfg.high, (v) => (cfg.high = v)))),
    el("div", { class: "field-row" },
      field(`Label for ${cfg.low} (optional)`, el("input", { value: cfg.lowLabel, placeholder: "e.g. Not at all", oninput: (e) => { cfg.lowLabel = e.target.value; apply(); } })),
      field(`Label for ${cfg.high} (optional)`, el("input", { value: cfg.highLabel, placeholder: "e.g. Extremely", oninput: (e) => { cfg.highLabel = e.target.value; apply(); } }))),
    points,
    el("p", { class: "hint", text: "Saved as the number chosen, so answers can be averaged." }));
}

function sliderEditor(item) {
  const get = (url, d) => ext(item, url)?.valueInteger ?? d;
  const put = (url, v) => {
    item.extension = (item.extension || []).filter((e) => e.url !== url);
    item.extension.push({ url, valueInteger: Math.round(Number(v)) });
    markDirty();
  };
  return el("div", { class: "field-row" },
    field("Lowest", el("input", { type: "number", value: get(MIN_VALUE, 0), oninput: (e) => put(MIN_VALUE, e.target.value || 0) })),
    field("Highest", el("input", { type: "number", value: get(MAX_VALUE, 10), oninput: (e) => put(MAX_VALUE, e.target.value || 10) })),
    field("Step", el("input", { type: "number", min: 1, value: get(SLIDER_STEP, 1), oninput: (e) => put(SLIDER_STEP, Math.max(1, Number(e.target.value) || 1)) })));
}

function lengthEditor(item) {
  return field("Maximum characters (optional)", el("input", {
    type: "number", min: 1, max: 5000, value: item.maxLength || "", placeholder: "no limit",
    oninput: (e) => { const v = Math.round(Number(e.target.value)); if (v > 0) item.maxLength = v; else delete item.maxLength; markDirty(); },
  }), "The phone stops the data collector at this length.");
}

function optionsEditor(item, parent) {
  const canBranch = !item.repeats && state.form.item.includes(parent) && sectionsAfter(parent).length > 0;
  const branching = canBranch && (state.branching.has(item.linkId) || branchCount(item) > 0);
  const box = el("div", { class: "options plain" });
  const list = el("div", { class: "option-list" });
  const redraw = () => list.replaceChildren(...(item.answerOption || []).map((o, i) =>
    el("div", { class: "option-row" },
      el("span", { class: "bullet", text: item.repeats ? "☐" : kindOf(item) === "dropdown" ? `${i + 1}.` : "○" }),
      el("input", { value: o.valueCoding?.display || "", "aria-label": `Option ${i + 1}`, oninput: (e) => { o.valueCoding.display = e.target.value; markDirty(); } }),
      branching && el("select", { class: "branch-select", title: "After this answer", onchange: (e) => { setBranch(item, o, state.form.item.find((p) => p.linkId === e.target.value)); markDirty(); render(); } },
        el("option", { value: "" }, "Continue to next section"),
        sectionsAfter(parent).map((p) => el("option", { value: p.linkId, selected: branchTarget(item, o) === p }, `Go to: ${p.text}`))),
      el("button", { type: "button", class: "icon-btn", title: "Move up", disabled: i === 0, onclick: () => { swap(item.answerOption, i, i - 1); redraw(); markDirty(); } }, "↑"),
      el("button", { type: "button", class: "icon-btn danger", title: "Remove option", onclick: () => removeOption(item, parent, i, redraw) }, "✕"),
    ),
  ));
  redraw();
  const otherOn = (item.answerOption || []).some((o) => o.valueCoding?.code === "other");
  box.append(list,
    el("div", { class: "option-add" },
      el("button", { type: "button", class: "btn ghost small", onclick: () => {
        const label = `Option ${(item.answerOption || []).length + 1}`;
        const code = uniqueCode(item, slug(label));
        item.answerOption = [...(item.answerOption || []), { valueCoding: { system: SYS, code, display: label } }];
        if (otherOn) moveOtherLast(item);
        redraw(); markDirty();
      } }, "+ Add option"),
      el("label", { class: "check" }, el("input", { type: "checkbox", checked: otherOn, onchange: (e) => { setOther(parent, item, e.target.checked); render(); markDirty(); } }), " Add “Other — please specify”"),
      el("button", { type: "button", class: "btn ghost small", onclick: () => pasteOptions(item, parent) }, "Paste a list…"),
      canBranch && el("label", { class: "check" }, el("input", { type: "checkbox", checked: branching, onchange: (e) => {
        if (e.target.checked) state.branching.add(item.linkId);
        else { state.branching.delete(item.linkId); (item.answerOption || []).forEach((o) => setBranch(item, o, null)); markDirty(); }
        render();
      } }), " Go to section based on answer"),
    ),
    branching ? el("p", { class: "hint", text: "A section chosen for an answer is shown only to people who give that answer; the phone skips it for everyone else. Sections not chosen for any answer are shown to everyone." }) : "",
    el("p", { class: "hint", text: "Changing the wording of an option keeps earlier answers linked to it. Removing an option means earlier answers with it show as unknown." }),
  );
  return box;
}

function scaleEditor(item, targets) {
  const box = el("div", { class: "options" }, el("div", { class: "field-label", text: "Scale" }));
  const preset = el("select", { onchange: (e) => {
    if (!e.target.value) return;
    const options = SCALES[e.target.value].map((d, i) => ({ valueCoding: { system: SYS, code: String(i + 1), display: d } }));
    targets.forEach((t) => (t.answerOption = clone(options)));
    markDirty(); render();
  } }, el("option", { value: "" }, "Choose a ready-made scale…"), Object.entries(SCALE_NAMES).map(([k, v]) => el("option", { value: k }, v)));
  const labels = el("textarea", { rows: 4, oninput: (e) => {
    const lines = e.target.value.split("\n").map((s) => s.trim()).filter(Boolean);
    const options = lines.map((d, i) => ({ valueCoding: { system: SYS, code: String(i + 1), display: d } }));
    targets.forEach((t) => (t.answerOption = clone(options)));
    markDirty();
  } }, (targets[0].answerOption || []).map((o) => o.valueCoding?.display).join("\n"));
  box.append(field("Ready-made scales", preset), field("Scale points (one per line, in order)", labels, "Saved as 1, 2, 3 … so answers can be averaged."));
  return box;
}

function gridEditor(grid) {
  const rows = grid.item || [];
  const box = el("div", { class: "options" });
  box.append(scaleEditor(grid, rows.length ? rows : [grid]));
  const list = el("div", { class: "option-list" });
  const redraw = () => list.replaceChildren(...rows.map((r, i) =>
    el("div", { class: "option-row" },
      el("span", { class: "bullet", text: `${i + 1}` }),
      el("input", { value: r.text || "", oninput: (e) => { r.text = e.target.value; markDirty(); } }),
      el("input", { class: "num-input", value: (r.prefix || "").replace(/\.$/, ""), placeholder: "No.", title: "Number", oninput: (e) => { const v = e.target.value.trim(); if (v) r.prefix = v.endsWith(".") ? v : `${v}.`; else delete r.prefix; markDirty(); } }),
      el("button", { type: "button", class: "icon-btn", disabled: i === 0, onclick: () => { swap(rows, i, i - 1); redraw(); markDirty(); } }, "↑"),
      el("button", { type: "button", class: "icon-btn danger", disabled: rows.length <= 1, onclick: () => { if (confirm("Remove this statement?")) { rows.splice(i, 1); redraw(); markDirty(); } } }, "✕"),
    )));
  redraw();
  box.append(el("div", { class: "field-label", text: "Statements (rows of the table)" }), list,
    el("button", { type: "button", class: "btn ghost small", onclick: () => {
      rows.push(gridRow(grid, `Statement ${rows.length + 1}`, rows[0]?.answerOption || SCALES.agree5.map((d, i) => ({ valueCoding: { system: SYS, code: String(i + 1), display: d } }))));
      grid.item = rows; redraw(); markDirty();
    } }, "+ Add statement"));
  return box;
}

function rangeEditor(item, kind) {
  const key = kind === "integer" ? "valueInteger" : "valueDecimal";
  const get = (url) => ext(item, url)?.[key] ?? "";
  const put = (url, v) => {
    item.extension = (item.extension || []).filter((e) => e.url !== url);
    if (v !== "" && !isNaN(Number(v))) item.extension.push({ url, [key]: Number(v) });
    if (!item.extension.length) delete item.extension;
    markDirty();
  };
  return el("div", { class: "field-row" },
    field("Smallest allowed", el("input", { type: "number", value: get(MIN_VALUE), oninput: (e) => put(MIN_VALUE, e.target.value) })),
    field("Largest allowed", el("input", { type: "number", value: get(MAX_VALUE), oninput: (e) => put(MAX_VALUE, e.target.value) })));
}

const COND_TYPES = new Set(["choice", "open-choice", "integer", "decimal", "string", "text", "date", "boolean"]);
const OPS = {
  choice: [["=", "is"], ["!=", "is not"], ["exists", "is answered"], ["missing", "is not answered"]],
  number: [["=", "="], ["!=", "≠"], [">", ">"], [">=", "≥"], ["<", "<"], ["<=", "≤"], ["exists", "is answered"], ["missing", "is not answered"]],
  text: [["=", "is exactly"], ["!=", "is not"], ["exists", "is answered"], ["missing", "is not answered"]],
  date: [["=", "is on"], [">", "is after"], ["<", "is before"], ["exists", "is answered"], ["missing", "is not answered"]],
};
const opFamily = (q) => (q?.type === "choice" || q?.type === "open-choice" || q?.type === "boolean" ? "choice" : q?.type === "integer" || q?.type === "decimal" ? "number" : q?.type === "date" ? "date" : "text");
const VALUE_KEYS = ["answerCoding", "answerInteger", "answerDecimal", "answerString", "answerDate", "answerBoolean"];
const condValue = (c) => VALUE_KEYS.map((k) => c[k]).find((v) => v !== undefined);
const condOp = (c) => (c.operator === "exists" ? (c.answerBoolean === false ? "missing" : "exists") : c.operator || "=");

function describeConditions(item) {
  const parts = (item.enableWhen || []).map((c) => {
    const q = allItems().find((x) => x.linkId === c.question);
    const name = q ? `“${(q.prefix ? q.prefix + " " : "") + (q.text || q.linkId)}”`.replace(/\s+/g, " ") : c.question;
    const op = condOp(c);
    if (op === "exists") return `${name} is answered`;
    if (op === "missing") return `${name} is not answered`;
    const v = c.answerCoding ? (q?.answerOption || []).find((o) => o.valueCoding?.code === c.answerCoding.code)?.valueCoding?.display || c.answerCoding.code : condValue(c);
    const label = (OPS[opFamily(q)].find(([k]) => k === op) || [op, op])[1];
    return `${name} ${label} “${v}”`;
  });
  return parts.join(item.enableBehavior === "any" ? " or " : " and ");
}

function conditionEditor(item, { title }) {
  const box = el("div", { class: "options cond-box" }, el("div", { class: "field-label", text: title }));
  const own = new Set(allItems([item]).map((i) => i.linkId));
  const candidates = allItems().filter((q) => COND_TYPES.has(q.type) && !own.has(q.linkId) && !(q.readOnly && ext(q, HIDDEN)));
  const conds = item.enableWhen ? item.enableWhen.map((c) => ({ ...c })) : [];
  const list = el("div");
  const save = () => {
    const valid = conds.filter((c) => c.question && (c.operator === "exists" || condValue(c) !== undefined && condValue(c) !== ""));
    if (valid.length) {
      item.enableWhen = valid.map((c) => ({ ...c }));
      if (valid.length > 1) item.enableBehavior = item.enableBehavior || "all"; else delete item.enableBehavior;
    } else {
      delete item.enableWhen;
      delete item.enableBehavior;
    }
    markDirty();
  };
  const setOp = (c, op, target) => {
    VALUE_KEYS.forEach((k) => delete c[k]);
    if (op === "exists" || op === "missing") { c.operator = "exists"; c.answerBoolean = op === "exists"; return; }
    c.operator = op;
    if (target?.type === "boolean") c.answerBoolean = true;
  };
  const valueInput = (c, target) => {
    const op = condOp(c);
    if (!target || op === "exists" || op === "missing") return null;
    if (target.type === "choice" || target.type === "open-choice") {
      return el("select", { onchange: (e) => {
        const o = (target.answerOption || []).find((x) => x.valueCoding.code === e.target.value);
        delete c.answerCoding;
        if (o) c.answerCoding = { system: o.valueCoding.system || SYS, code: o.valueCoding.code };
        save();
      } }, el("option", { value: "" }, "choose answer…"), (target.answerOption || []).map((o) => el("option", { value: o.valueCoding.code, selected: o.valueCoding.code === c.answerCoding?.code }, o.valueCoding.display)));
    }
    if (target.type === "boolean") {
      return el("select", { onchange: (e) => { c.answerBoolean = e.target.value === "true"; save(); } },
        el("option", { value: "true", selected: c.answerBoolean !== false }, "Yes"), el("option", { value: "false", selected: c.answerBoolean === false }, "No"));
    }
    const key = target.type === "integer" ? "answerInteger" : target.type === "decimal" ? "answerDecimal" : target.type === "date" ? "answerDate" : "answerString";
    return el("input", {
      type: key === "answerDate" ? "date" : key === "answerString" ? "text" : "number", value: c[key] ?? "", placeholder: "value", class: "cond-value",
      oninput: (e) => {
        const raw = e.target.value;
        if (raw === "") delete c[key];
        else c[key] = key === "answerInteger" ? Math.round(Number(raw)) : key === "answerDecimal" ? Number(raw) : raw;
        save();
      },
    });
  };
  const redraw = () => list.replaceChildren(...conds.map((c, i) => {
    const target = candidates.find((q) => q.linkId === c.question);
    return el("div", { class: "cond-row" },
      i > 0 && el("span", { class: "cond-join", text: item.enableBehavior === "any" ? "or" : "and" }),
      el("select", { class: "cond-question", onchange: (e) => { c.question = e.target.value; setOp(c, "=", candidates.find((q) => q.linkId === c.question)); save(); redraw(); } },
        el("option", { value: "" }, "choose a question…"),
        candidates.map((q) => el("option", { value: q.linkId, selected: q.linkId === c.question }, `${q.prefix || ""} ${q.text || q.linkId}`.trim().slice(0, 90)))),
      el("select", { onchange: (e) => { setOp(c, e.target.value, target); save(); redraw(); } },
        OPS[opFamily(target)].map(([k, label]) => el("option", { value: k, selected: k === condOp(c) }, label))),
      valueInput(c, target),
      el("button", { type: "button", class: "icon-btn danger", title: "Remove condition", onclick: () => { conds.splice(i, 1); save(); redraw(); } }, "✕"));
  }));
  redraw();
  box.append(list, el("div", { class: "option-add" },
    el("button", { type: "button", class: "btn ghost small", onclick: () => { conds.push({ question: "", operator: "=" }); redraw(); } }, "+ Add condition"),
    el("select", { onchange: (e) => { item.enableBehavior = e.target.value; markDirty(); redraw(); } },
      el("option", { value: "all", selected: item.enableBehavior !== "any" }, "all conditions must match"),
      el("option", { value: "any", selected: item.enableBehavior === "any" }, "any one condition is enough"))));
  if (!conds.length) box.append(el("p", { class: "hint", text: "No condition: always shown." }));
  return box;
}

// ------------------------------------------------------------------ branching (go to section based on answer)

function sectionsAfter(page) {
  const pages = state.form.item;
  const at = pages.indexOf(page);
  return pages.filter((p, i) => i > at && i > 0 && !FIXED_PAGES.has(p.linkId));
}

const isBranch = (w, item, code) => w.question === item.linkId && w.operator === "=" && w.answerCoding?.code === code;
const branchTarget = (item, option) => state.form.item.find((p) => (p.enableWhen || []).some((w) => isBranch(w, item, option.valueCoding.code)));
const branchCount = (item) => (item.answerOption || []).filter((o) => o.valueCoding && branchTarget(item, o)).length;

function setBranch(item, option, page) {
  state.form.item.forEach((p) => {
    if (!p.enableWhen) return;
    p.enableWhen = p.enableWhen.filter((w) => !isBranch(w, item, option.valueCoding.code));
    if (!p.enableWhen.length) { delete p.enableWhen; delete p.enableBehavior; }
    else if (p.enableWhen.length === 1) delete p.enableBehavior;
  });
  if (!page) return;
  page.enableWhen = [...(page.enableWhen || []), { question: item.linkId, operator: "=", answerCoding: { system: option.valueCoding.system || SYS, code: option.valueCoding.code } }];
  if (page.enableWhen.length > 1) page.enableBehavior = "any";
}

// ------------------------------------------------------------------ item helpers

const swap = (list, a, b) => { [list[a], list[b]] = [list[b], list[a]]; };
const uniqueCode = (item, base) => { const used = new Set((item.answerOption || []).map((o) => o.valueCoding?.code)); let c = base; let n = 2; while (used.has(c)) c = `${base}_${n++}`; return c; };
const hasAudio = (item, parent) => (parent.item || []).some((s) => s.linkId === `${item.linkId}_audio`);
const hintOf = (item) => (item.item || []).find((c) => c.type === "display" && controlOf(c) === "flyover")?.text || "";

function setHint(item, text) {
  const others = (item.item || []).filter((c) => !(c.type === "display" && controlOf(c) === "flyover"));
  item.item = text.trim() ? [...others, { linkId: `${item.linkId}_hint`, text: text.trim(), type: "display", extension: [control("flyover")] }] : others;
  if (!item.item.length) delete item.item;
}

function setAudio(parent, item, on) {
  const list = parent.item;
  const at = list.findIndex((s) => s.linkId === `${item.linkId}_audio`);
  if (on && at < 0) {
    const audio = { linkId: `${item.linkId}_audio`, text: "Audio recording of the answer (optional)", type: "attachment", extension: audioExtensions(5) };
    if (item.enableWhen) { audio.enableWhen = clone(item.enableWhen); if (item.enableBehavior) audio.enableBehavior = item.enableBehavior; }
    list.splice(list.indexOf(item) + 1, 0, audio);
  } else if (!on && at >= 0) list.splice(at, 1);
  render();
}

function setOther(parent, item, on) {
  const has = (item.answerOption || []).some((o) => o.valueCoding?.code === "other");
  if (on && !has) {
    item.answerOption.push({ valueCoding: { system: SYS, code: "other", display: "Other (specify)" } });
    parent.item.splice(parent.item.indexOf(item) + 1, 0, {
      linkId: `${item.linkId}_other`, text: "Other — please specify", type: "string",
      enableWhen: [{ question: item.linkId, operator: "=", answerCoding: { system: SYS, code: "other" } }],
    });
  } else if (!on && has) {
    item.answerOption = item.answerOption.filter((o) => o.valueCoding?.code !== "other");
    parent.item = parent.item.filter((s) => s.linkId !== `${item.linkId}_other`);
  }
}

function moveOtherLast(item) {
  const other = item.answerOption.find((o) => o.valueCoding?.code === "other");
  item.answerOption = [...item.answerOption.filter((o) => o !== other), other];
}

function removeOption(item, parent, index, redraw) {
  const option = item.answerOption[index];
  const users = allItems().filter((q) => (q.enableWhen || []).some((w) => w.question === item.linkId && w.answerCoding?.code === option.valueCoding.code));
  const warn = users.length ? `\n\nThese questions are only shown when this option is chosen and will need a new condition:\n• ${users.map((u) => u.text).join("\n• ")}` : "";
  if (!confirm(`Remove the option "${option.valueCoding.display}"?${warn}`)) return;
  setBranch(item, option, null);
  item.answerOption.splice(index, 1);
  if (option.valueCoding.code === "other") parent.item = parent.item.filter((s) => s.linkId !== `${item.linkId}_other`);
  redraw();
  markDirty();
  if (option.valueCoding.code === "other") render();
}

function pasteOptions(item, parent) {
  const text = prompt("Paste the options, one per line (they replace the current options):", (item.answerOption || []).map((o) => o.valueCoding.display).join("\n"));
  if (text == null) return;
  const lines = text.split("\n").map((s) => s.trim()).filter(Boolean);
  if (!lines.length) return;
  item.answerOption = optionsFrom(lines, item.answerOption || []);
  const hasOther = item.answerOption.some((o) => o.valueCoding.code === "other");
  const helper = parent.item.some((s) => s.linkId === `${item.linkId}_other`);
  if (hasOther && !helper) { item.answerOption = item.answerOption.filter((o) => o.valueCoding.code !== "other"); setOther(parent, item, true); }
  if (!hasOther && helper) parent.item = parent.item.filter((s) => s.linkId !== `${item.linkId}_other`);
  markDirty();
  render();
}

/** The question plus its helper items (other-specify box, voice recorder) that move with it. */
function withHelpers(parent, item) {
  return (parent.item || []).filter((s) => s === item || s.linkId === `${item.linkId}_other` || s.linkId === `${item.linkId}_audio`);
}

function moveItem(parent, item, step) {
  const visible = parent.item.filter((s) => !isHelper(s, parent.item));
  const target = visible[visible.indexOf(item) + step];
  if (!target) return;
  const block = withHelpers(parent, item);
  const rest = parent.item.filter((s) => !block.includes(s));
  const targetBlock = withHelpers({ item: rest }, target);
  const at = rest.indexOf(step < 0 ? targetBlock[0] : targetBlock[targetBlock.length - 1]) + (step < 0 ? 0 : 1);
  rest.splice(at, 0, ...block);
  parent.item = rest;
  markDirty();
  render();
}

function removeItem(parent, item) {
  const ids = new Set(allItems([item]).map((i) => i.linkId));
  const users = allItems().filter((q) => !ids.has(q.linkId) && (q.enableWhen || []).some((w) => ids.has(w.question)));
  const warn = users.length ? `\n\nThese questions depend on it and will always be shown:\n• ${users.map((u) => u.text).join("\n• ")}` : "";
  if (!confirm(`Delete "${item.text}"?${warn}`)) return;
  users.forEach((u) => {
    u.enableWhen = u.enableWhen.filter((w) => !ids.has(w.question));
    if (!u.enableWhen.length) { delete u.enableWhen; delete u.enableBehavior; }
  });
  const block = withHelpers(parent, item);
  parent.item = parent.item.filter((s) => !block.includes(s));
  markDirty();
  render();
}

function duplicate(parent, item) {
  const block = clone(withHelpers(parent, item));
  const rename = (it, from, to) => { it.linkId = it.linkId === from ? to : it.linkId.replace(from, to); (it.item || []).forEach((c) => rename(c, from, to)); };
  const newId = uniqueLinkId(`${item.linkId}_copy`);
  block.forEach((b) => rename(b, item.linkId, newId));
  block.forEach((b) => (b.enableWhen || []).forEach((w) => { if (w.question === item.linkId) w.question = newId; }));
  block[0].text = `${item.text} (copy)`;
  if (block[0].prefix) block[0].prefix = nextNumber();
  const at = parent.item.indexOf(withHelpers(parent, item).pop()) + 1;
  parent.item.splice(at, 0, ...block);
  state.open.add(newId);
  markDirty();
  render();
}

/** Adds a question after the open one (as Google Forms does), or at the end of the section. */
function addQuestion(page, kind, after = null) {
  const item = newItem(kind);
  const parent = after ? parentOf(after) || page : page;
  parent.item = parent.item || [];
  const at = after ? parent.item.indexOf(withHelpers(parent, after).pop()) + 1 : parent.item.length;
  parent.item.splice(at, 0, item);
  state.open.clear();
  state.open.add(item.linkId);
  state.current = { item, parent };
  markDirty();
  render();
  requestAnimationFrame(() => document.querySelector(`[data-link="${CSS.escape(item.linkId)}"] .q-title-input`)?.select());
}

/** Toolbar "+": after the open question, else at the end of the last editable section. */
function addFromToolbar(anchor) {
  const editable = state.form.item.filter((p, i) => i > 0 && !FIXED_PAGES.has(p.linkId));
  const cur = state.current && allItems().includes(state.current.item) && !LOCKED.has(state.current.item.linkId) ? state.current.item : null;
  const page = cur ? state.form.item.find((p) => allItems([p]).includes(cur)) : editable[editable.length - 1];
  if (!page || FIXED_PAGES.has(page.linkId)) return addSection();
  showTypeMenu(anchor, (kind) => addQuestion(page, kind, cur));
}

function addSection() {
  const title = prompt("Section title (shown at the top of the page on the phone):", "New section");
  if (!title) return;
  const page = { linkId: uniqueLinkId(`section_${title}`), text: title, type: "group", extension: [control("page")], item: [] };
  const first = newItem("short");
  page.item.push(first);
  const cur = state.current && state.form.item.find((p) => allItems([p]).includes(state.current.item));
  const photos = state.form.item.findIndex((p) => p.linkId === "photos");
  const at = cur && !FIXED_PAGES.has(cur.linkId) && state.form.item.indexOf(cur) > 0 ? state.form.item.indexOf(cur) + 1 : photos >= 0 ? photos : state.form.item.length;
  state.form.item.splice(at, 0, page);
  state.open.clear();
  state.open.add(first.linkId);
  state.current = { item: first, parent: page };
  markDirty();
  render();
  requestAnimationFrame(() => document.querySelector(`[data-page="${CSS.escape(page.linkId)}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
}

function duplicateSection(page) {
  const copy = clone(page);
  const map = new Map();
  allItems([copy]).forEach((i) => { const id = uniqueLinkId(`${i.linkId}_copy`); map.set(i.linkId, id); i.linkId = id; });
  allItems([copy]).forEach((i) => (i.enableWhen || []).forEach((w) => { if (map.has(w.question)) w.question = map.get(w.question); }));
  // uniqueLinkId only sees the live form, so make the copied ids unique among themselves too.
  const seen = new Set(allItems().map((i) => i.linkId));
  allItems([copy]).forEach((i) => { let id = i.linkId; let n = 2; while (seen.has(id)) id = `${i.linkId}_${n++}`; seen.add(id); i.linkId = id; });
  copy.text = `${page.text} (copy)`;
  state.form.item.splice(state.form.item.indexOf(page) + 1, 0, copy);
  markDirty();
  render();
}

function moveSection(page, step) {
  const pages = state.form.item;
  const editable = pages.filter((p, i) => i > 0 && !FIXED_PAGES.has(p.linkId));
  const other = editable[editable.indexOf(page) + step];
  if (!other) return;
  swap(pages, pages.indexOf(page), pages.indexOf(other));
  markDirty();
  render();
}

function deleteSection(page) {
  if (!confirm(`Delete the section "${page.text}" and its ${(page.item || []).length} questions?`)) return;
  const ids = new Set(allItems([page]).map((i) => i.linkId));
  allItems().forEach((q) => {
    if (ids.has(q.linkId) || !q.enableWhen) return;
    q.enableWhen = q.enableWhen.filter((w) => !ids.has(w.question));
    if (!q.enableWhen.length) { delete q.enableWhen; delete q.enableBehavior; }
  });
  state.form.item = state.form.item.filter((p) => p !== page);
  markDirty();
  render();
}

function renumber() {
  if (!confirm("Number all numbered questions again as 1, 2, 3 … in page order?")) return;
  let n = 0;
  allItems().forEach((i) => { if (i.prefix) i.prefix = `${++n}.`; });
  markDirty();
  render();
}

// ------------------------------------------------------------------ type menu

function showTypeMenu(anchor, onPick) {
  const menu = $("typeMenu");
  const groups = [...new Set(TYPES.map((t) => t.group))];
  menu.replaceChildren(...groups.map((g) => el("div", { class: "type-group" },
    el("div", { class: "type-group-name", text: g }),
    TYPES.filter((t) => t.group === g).map((t) =>
      el("button", { type: "button", role: "menuitem", onclick: () => { menu.hidden = true; onPick(t.kind); } },
        el("span", { class: "type-icon", text: t.icon }), t.label)))));
  const r = anchor.getBoundingClientRect();
  menu.hidden = false;
  const top = Math.min(window.scrollY + r.bottom + 4, window.scrollY + window.innerHeight - menu.offsetHeight - 8);
  menu.style.top = `${Math.max(window.scrollY + 8, top)}px`;
  menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 12))}px`;
  setTimeout(() => document.addEventListener("click", function close(e) {
    if (!menu.contains(e.target)) { menu.hidden = true; document.removeEventListener("click", close); }
  }), 0);
}

// ------------------------------------------------------------------ new form, archive, settings

function openNewForm() {
  $("newFrom").replaceChildren(...state.tools.filter((t) => !t.archived).map((t) => el("option", { value: t.id }, t.title)));
  $("newError").hidden = true;
  $("newTitle").value = "";
  $("newTarget").value = "";
  $("newMinutes").value = "20";
  $("newDialog").hidden = false;
  setTimeout(() => $("newTitle").focus(), 50);
}

async function createForm() {
  if (state.dirty && !confirm("You have unpublished changes in the open form. Leave them?")) return;
  const body = {
    title: $("newTitle").value,
    target: $("newTarget").value,
    minutes: $("newMinutes").value,
    from: $("newFrom").value,
    mode: document.querySelector('input[name="newMode"]:checked').value,
  };
  $("newCreateBtn").disabled = true;
  try {
    const { form } = await api("POST", "/api/forms", body);
    $("newDialog").hidden = true;
    state.dirty = false;
    await loadTools();
    await openTool(form.id);
  } catch (e) {
    $("newError").textContent = e.message;
    $("newError").hidden = false;
  }
  $("newCreateBtn").disabled = false;
}

async function toggleArchive() {
  const tool = state.tools.find((t) => t.id === state.form.id);
  const archived = !tool?.archived;
  const question = archived
    ? "Archive this form? It disappears from the phones at their next Sync. Submissions already made are kept and stay on the dashboard."
    : "Bring this form back? Phones get it again at their next Sync.";
  if (state.dirty) return alert("Publish or discard your changes first.");
  if (!confirm(question)) return;
  try {
    await api("POST", `/api/forms/${state.form.id}/archive`, { archived });
    await loadTools();
    setForm((await api("GET", `/api/forms/${state.form.id}`)).form);
  } catch (e) { alert(e.message); }
}

const extOf = (q, url) => (q.extension || []).find((e) => e.url === url);
function setFormExt(url, key, value) {
  const f = state.form;
  f.extension = (f.extension || []).filter((e) => e.url !== url);
  if (value !== "" && value != null) f.extension.push({ url, [key]: value });
  if (!f.extension.length) delete f.extension;
  markDirty();
}

// ------------------------------------------------------------------ preview (the form as the data collector sees it)

const preview = { page: 0, answers: new Map(), check: true, errors: new Set() };

function openPreview() {
  preview.page = 0;
  preview.answers = new Map();
  preview.errors = new Set();
  preview.done = null;
  clearInterval(preview.timer);
  const limit = Q.settings(state.form)?.timeLimitMinutes || 0;
  preview.endsAt = limit > 0 ? Date.now() + limit * 60000 : null;
  preview.startedAt = Date.now();
  if (preview.endsAt) {
    preview.timer = setInterval(() => {
      if ($("previewDialog").hidden) return clearInterval(preview.timer);
      const clock = document.querySelector(".pv-clock");
      const left = Math.max(0, preview.endsAt - Date.now());
      if (clock) { clock.textContent = `⏱ ${fmtClock(left)}`; clock.classList.toggle("low", left < 60000); }
      if (left <= 0) { clearInterval(preview.timer); pvFinish(true); }
    }, 1000);
  }
  $("previewTitle").textContent = state.form.title || "Preview";
  $("previewDialog").hidden = false;
  renderPreview();
}

const fmtClock = (ms) => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

/** End of the form in the preview: the score for a quiz (as the phone shows it), else a note. */
function pvFinish(timedOut = false) {
  clearInterval(preview.timer);
  const result = Q.scoreAnswers(state.form, preview.answers);
  preview.done = { result, timedOut, seconds: Math.round((Date.now() - preview.startedAt) / 1000) };
  renderPreview();
}

function cmp(a, op, b) {
  if (typeof b === "number") { a = Number(a); }
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

function isEnabled(item) {
  const ws = item.enableWhen || [];
  if (!ws.length) return true;
  const results = ws.map((w) => {
    const values = (preview.answers.get(w.question) || []).filter((v) => v !== "" && v != null);
    if (w.operator === "exists") return (values.length > 0) === (w.answerBoolean !== false);
    const target = w.answerCoding ? w.answerCoding.code : condValue(w);
    if (w.operator === "!=") return values.every((v) => !cmp(v, "=", target));
    return values.some((v) => cmp(v, w.operator, target));
  });
  return item.enableBehavior === "any" ? results.some(Boolean) : results.every(Boolean);
}

function visiblePages() {
  return (state.form.item || []).filter((p) => isEnabled(p));
}

function renderPreview() {
  if (preview.done) return renderPreviewResult();
  const pages = visiblePages();
  preview.page = Math.min(preview.page, pages.length - 1);
  const page = pages[preview.page];
  const body = $("previewBody");
  const fields = el("div", { class: "pv-items" });
  pvItems(page.item || [], fields, page.item || []);
  body.replaceChildren(
    preview.endsAt && el("div", { class: "pv-clock", text: `⏱ ${fmtClock(Math.max(0, preview.endsAt - Date.now()))}` }),
    el("div", { class: "pv-progress" }, el("span", { style: `width:${((preview.page + 1) / pages.length) * 100}%` })),
    el("div", { class: "pv-page-title" }, el("span", { class: "muted", text: `Page ${preview.page + 1} of ${pages.length}` }), el("h3", { text: page.text || "" })),
    fields,
    el("div", { class: "pv-nav" },
      el("button", { type: "button", class: "btn ghost", disabled: preview.page === 0, onclick: () => { preview.page--; preview.errors.clear(); renderPreview(); $("previewBody").scrollTop = 0; } }, "Back"),
      el("label", { class: "check" }, el("input", { type: "checkbox", checked: preview.check, onchange: (e) => (preview.check = e.target.checked) }), " Check required"),
      preview.page < pages.length - 1
        ? el("button", { type: "button", class: "btn primary", onclick: () => pvNext(page) }, "Next")
        : el("button", { type: "button", class: "btn primary", onclick: () => { if (pvValidate(page)) pvFinish(false); } }, "Finish")));
}

function renderPreviewResult() {
  const { result, timedOut, seconds } = preview.done;
  const body = $("previewBody");
  body.replaceChildren(el("div", { class: "pv-card pv-result" },
    timedOut && el("p", { class: "pv-error-text", text: "Time is up: the answers given so far were submitted." }),
    result
      ? [el("div", { class: "pv-score", text: `${result.points} / ${result.total}` }),
        el("div", { class: "pv-percent", text: `${result.percent}% · ${result.right} of ${result.count} questions correct` })]
      : el("p", { text: isQuiz() ? "No question has an answer key yet, so there is no score." : "End of the form. In the app the data collector now reviews and submits." }),
    el("p", { class: "hint", text: `Time taken: ${fmtClock(seconds * 1000)} · Nothing was saved from this preview.` }),
    el("button", { type: "button", class: "btn primary", onclick: openPreview }, "Start again")));
}

function pvValidate(page) {
  preview.errors.clear();
  if (preview.check) {
    const walk = (items) => items.forEach((i) => {
      if (!isEnabled(i) || (i.readOnly && ext(i, HIDDEN))) return;
      const kind = kindOf(i);
      if (i.required && !["group", "grid", "checkgrid", "gps", "photo", "audio", "note"].includes(kind) && !(preview.answers.get(i.linkId) || []).some((v) => v !== "" && v != null)) preview.errors.add(i.linkId);
      if (i.item && kind !== "gps") walk(i.item);
    });
    walk(page.item || []);
  }
  if (preview.errors.size) { renderPreview(); return false; }
  return true;
}

function pvNext(page) {
  if (!pvValidate(page)) return;
  preview.page++;
  renderPreview();
  $("previewBody").scrollTop = 0;
}

function pvSet(linkId, values, redraw = true) {
  preview.answers.set(linkId, values);
  preview.errors.delete(linkId);
  if (redraw) renderPreview();
}

function pvItems(items, container, siblings) {
  items.forEach((item) => {
    if (!isEnabled(item)) return;
    if (item.readOnly && ext(item, HIDDEN)) return;
    if (isHelper(item, siblings) && !/_other$|_audio$/.test(item.linkId)) return;
    container.append(pvItem(item));
  });
}

function pvItem(item) {
  const kind = kindOf(item);
  const values = preview.answers.get(item.linkId) || [];
  const hint = hintOf(item);
  const title = el("div", { class: "pv-q" }, item.prefix ? `${item.prefix} ` : "", item.text || "", item.required && kind !== "note" ? el("span", { class: "req-star", text: " *" }) : null);
  const card = el("div", { class: `pv-card${preview.errors.has(item.linkId) ? " pv-error" : ""}` }, title, hint && el("div", { class: "hint", text: hint }));
  const name = `pv_${item.linkId}`;
  const opts = (item.answerOption || []).map((o) => o.valueCoding);
  switch (kind) {
    case "note": card.classList.add("pv-note"); break;
    case "short": case "email": case "phone":
      card.append(el("input", { class: "pv-input", type: kind === "email" ? "email" : kind === "phone" ? "tel" : "text", value: values[0] || "", maxlength: item.maxLength || null, placeholder: "Your answer",
        oninput: (e) => pvSet(item.linkId, [e.target.value], false), onchange: (e) => pvSet(item.linkId, [e.target.value]) }));
      break;
    case "paragraph":
      card.append(el("textarea", { class: "pv-input", rows: 3, maxlength: item.maxLength || null, placeholder: "Your answer",
        oninput: (e) => pvSet(item.linkId, [e.target.value], false), onchange: (e) => pvSet(item.linkId, [e.target.value]) }, values[0] || ""));
      break;
    case "integer": case "decimal":
      card.append(el("input", { class: "pv-input", type: "number", step: kind === "integer" ? 1 : "any", value: values[0] ?? "", min: ext(item, MIN_VALUE)?.[kind === "integer" ? "valueInteger" : "valueDecimal"], max: ext(item, MAX_VALUE)?.[kind === "integer" ? "valueInteger" : "valueDecimal"],
        onchange: (e) => pvSet(item.linkId, e.target.value === "" ? [] : [Number(e.target.value)]) }));
      break;
    case "slider": {
      const min = ext(item, MIN_VALUE)?.valueInteger ?? 0, max = ext(item, MAX_VALUE)?.valueInteger ?? 10;
      const out = el("b", { text: values[0] ?? "–" });
      card.append(el("div", { class: "pv-slider" }, el("span", { text: String(min) }),
        el("input", { type: "range", min, max, step: ext(item, SLIDER_STEP)?.valueInteger || 1, value: values[0] ?? min,
          oninput: (e) => { out.textContent = e.target.value; pvSet(item.linkId, [Number(e.target.value)], false); }, onchange: (e) => pvSet(item.linkId, [Number(e.target.value)]) }),
        el("span", { text: String(max) }), out));
      break;
    }
    case "date": case "time":
      card.append(el("input", { class: "pv-input short", type: kind, value: values[0] || "", onchange: (e) => pvSet(item.linkId, [e.target.value]) }));
      break;
    case "multiple": case "likert": case "linear":
      card.append(el("div", { class: kind === "linear" ? "pv-choices pv-row" : "pv-choices" }, opts.map((o) =>
        el("label", { class: "pv-choice" }, el("input", { type: "radio", name, checked: values[0] === o.code, onchange: () => pvSet(item.linkId, [o.code]) }), o.display))));
      break;
    case "checkboxes":
      card.append(el("div", { class: "pv-choices" }, opts.map((o) =>
        el("label", { class: "pv-choice" }, el("input", { type: "checkbox", checked: values.includes(o.code), onchange: (e) => pvSet(item.linkId, e.target.checked ? [...values, o.code] : values.filter((v) => v !== o.code)) }), o.display))));
      break;
    case "dropdown":
      card.append(el("select", { class: "pv-input short", onchange: (e) => pvSet(item.linkId, e.target.value ? [e.target.value] : []) },
        el("option", { value: "" }, "Choose"), opts.map((o) => el("option", { value: o.code, selected: values[0] === o.code }, o.display))));
      break;
    case "grid": case "checkgrid": {
      const rows = (item.item || []).filter((r) => r.type === "choice" && isEnabled(r));
      const cols = (rows[0]?.answerOption || []).map((o) => o.valueCoding);
      card.append(el("div", { class: "pv-grid-wrap" }, el("table", { class: "pv-grid" },
        el("thead", {}, el("tr", {}, el("th", {}), cols.map((c) => el("th", { text: c.display })))),
        el("tbody", {}, rows.map((r) => {
          const rv = preview.answers.get(r.linkId) || [];
          return el("tr", { class: preview.errors.has(r.linkId) ? "pv-error" : null }, el("th", { text: `${r.prefix ? r.prefix + " " : ""}${r.text || ""}` }),
            cols.map((c) => el("td", {}, el("input", { type: kind === "grid" ? "radio" : "checkbox", name: `pv_${r.linkId}`, "aria-label": c.display, checked: rv.includes(c.code),
              onchange: (e) => pvSet(r.linkId, kind === "grid" ? [c.code] : e.target.checked ? [...rv, c.code] : rv.filter((v) => v !== c.code)) }))));
        })))));
      break;
    }
    case "photo": card.append(el("button", { type: "button", class: "btn ghost small", disabled: true }, "📷 Take photo (on the phone)")); break;
    case "audio": card.append(el("button", { type: "button", class: "btn ghost small", disabled: true }, "🎙 Record (on the phone)")); break;
    case "gps": card.append(el("button", { type: "button", class: "btn ghost small", disabled: true }, "📍 Record GPS location (on the phone)")); break;
    case "group": {
      const inner = el("div", { class: "pv-items" });
      pvItems(item.item || [], inner, item.item || []);
      card.append(inner);
      break;
    }
    default: break;
  }
  if (preview.errors.has(item.linkId)) card.append(el("div", { class: "pv-error-text", text: "This is a required question" }));
  return card;
}

// ------------------------------------------------------------------ publish, history, upload

async function publish() {
  $("formErrors").hidden = true;
  state.form.title = $("formTitle").value.trim() || state.form.title;
  try {
    const { errors } = await api("POST", `/api/forms/${state.form.id}/validate`, { form: state.form });
    if (errors.length) return showErrors(errors);
  } catch (e) { return showErrors([e.message]); }
  const note = prompt("Publish this version? Phones get it at their next Sync.\n\nShort note about what changed (optional):", "");
  if (note == null) return;
  $("publishBtn").disabled = true;
  try {
    await api("PUT", `/api/forms/${state.form.id}`, { form: state.form, note });
    await loadTools();
    const { form } = await api("GET", `/api/forms/${state.form.id}`);
    setForm(form);
    alert("Published. Phones will get the new questions at their next Sync.");
  } catch (e) {
    showErrors(e.errors || [e.message]);
    markDirty();
  }
}

function showErrors(errors) {
  $("formErrors").replaceChildren(el("b", { text: "Please fix before publishing:" }), el("ul", {}, errors.map((e) => el("li", { text: e }))));
  $("formErrors").hidden = false;
  $("formErrors").scrollIntoView({ behavior: "smooth", block: "center" });
}

async function showHistory() {
  const list = $("historyList");
  list.replaceChildren(el("p", { class: "muted", text: "Loading…" }));
  $("historyDialog").hidden = false;
  try {
    const { versions } = await api("GET", `/api/forms/${state.form.id}/history`);
    if (!versions.length) return list.replaceChildren(el("p", { class: "muted", text: "No earlier versions yet. One is saved every time you publish." }));
    list.replaceChildren(...versions.map((v) =>
      el("div", { class: "history-row" },
        el("div", {},
          el("div", { text: new Date(v.savedAt).toLocaleString() }),
          el("div", { class: "hint", text: `${v.note || ""} · ${v.questions} questions · by ${v.by || "?"}` })),
        el("button", { type: "button", class: "btn ghost small", onclick: async () => {
          if (!confirm("Publish this earlier version again? Phones get it at their next Sync.")) return;
          try {
            await api("POST", `/api/forms/${state.form.id}/restore`, { file: v.file });
            $("historyDialog").hidden = true;
            await loadTools();
            setForm((await api("GET", `/api/forms/${state.form.id}`)).form);
          } catch (e) { alert(e.message); }
        } }, "Restore"))));
  } catch (e) {
    list.replaceChildren(el("p", { class: "error", text: e.message }));
  }
}

async function uploadPreview() {
  const file = $("uploadFile").files[0];
  const out = $("uploadResult");
  if (!file) return out.replaceChildren(el("p", { class: "error", text: "Choose an Excel (.xlsx) file first." }));
  const mode = document.querySelector('input[name="uploadMode"]:checked').value;
  out.replaceChildren(el("p", { class: "muted", text: "Reading the file…" }));
  try {
    const result = await api("POST", `/api/forms/${state.form.id}/import?mode=${mode}`, null, await file.arrayBuffer());
    const sections = result.form.item.filter((p, i) => i > 0 && !FIXED_PAGES.has(p.linkId));
    const count = (items) => items.reduce((n, i) => n + (i.type === "group" ? count(i.item || []) : i.type === "display" ? 0 : 1), 0);
    out.replaceChildren(
      el("h3", { class: "section-title", text: "Preview" }),
      el("ul", { class: "preview-list" }, sections.map((s) => el("li", {}, el("b", { text: s.text }), ` — ${count(s.item || [])} questions`))),
      result.warnings.length ? el("div", { class: "notice" }, el("b", { text: "Notes:" }), el("ul", {}, result.warnings.map((w) => el("li", { text: w })))) : el("p", { class: "ok-text", text: "No problems found in the file." }),
      result.errors.length ? el("div", { class: "error" }, el("b", { text: "Must be fixed:" }), el("ul", {}, result.errors.map((w) => el("li", { text: w })))) : null,
      el("button", { type: "button", class: "btn primary", onclick: () => {
        setForm(result.form, { dirty: true });
        markDirty();
        $("uploadDialog").hidden = true;
        out.replaceChildren();
        alert("Loaded into the editor. Check the questions, then press Publish.");
      } }, "Load into the editor"));
  } catch (e) {
    out.replaceChildren(el("p", { class: "error", text: e.message }));
  }
}

// ------------------------------------------------------------------ boot

async function boot() {
  const session = await fetch("/api/session").then((r) => r.json()).catch(() => ({}));
  if (!session.user || session.user.role !== "admin") return location.replace("/login.html");
  $("me").textContent = `Signed in as ${session.user.name}`;
  await loadTools();
  let saved = null;
  try { saved = localStorage.getItem("ahip-forms-tool"); } catch {}
  if (saved && state.tools.some((t) => t.id === saved)) openTool(saved);
}

$("logoutBtn").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" }).catch(() => {});
  location.replace("/login.html");
});
$("formTitle").addEventListener("input", (e) => { state.form.title = e.target.value; markDirty(); });
$("formDesc").addEventListener("input", (e) => { if (e.target.value.trim()) state.form.description = e.target.value; else delete state.form.description; markDirty(); });
$("formTarget").addEventListener("input", (e) => setFormExt(TARGET_EXT, "valueString", e.target.value.trim()));
$("formMinutes").addEventListener("input", (e) => { const v = Math.round(Number(e.target.value)); setFormExt(MINUTES_EXT, "valueInteger", v > 0 ? v : ""); });
$("newFormBtn").addEventListener("click", openNewForm);
const setQuiz = () => {
  const on = $("formQuiz").checked;
  const minutes = Math.max(0, Math.round(Number($("formQuizMinutes").value) || 0));
  setFormExt(Q.QUIZ, "valueString", on ? JSON.stringify({ timeLimitMinutes: minutes }) : "");
  $("quizLimitWrap").hidden = !on;
};
$("formQuiz").addEventListener("change", () => { setQuiz(); render(); });
$("formQuizMinutes").addEventListener("input", setQuiz);
$("newCreateBtn").addEventListener("click", createForm);
$("archiveBtn").addEventListener("click", toggleArchive);
$("previewBtn").addEventListener("click", openPreview);
$("sideAdd").addEventListener("click", (e) => addFromToolbar(e.currentTarget));
$("sideSection").addEventListener("click", addSection);
$("sidePreview").addEventListener("click", openPreview);
$("sideUpload").addEventListener("click", () => $("uploadBtn").click());
$("publishBtn").addEventListener("click", publish);
$("cppListBtn").addEventListener("click", async () => {
  if (state.dirty && !confirm("You have unpublished changes in the open form. Update the CPP list anyway? (Your changes stay in the editor.)")) return;
  $("cppListBtn").disabled = true;
  try {
    const r = await api("POST", "/api/forms/refresh-cpp-list");
    alert(`CPP list: ${r.cpps} CPPs. ${r.updated.length ? "Updated: " + r.updated.join(", ") : "Already up to date."}`);
    await loadTools();
  } catch (e) { alert(e.message); }
  $("cppListBtn").disabled = false;
});
$("discardBtn").addEventListener("click", () => { if (confirm("Discard all unpublished changes?")) setForm(JSON.parse(state.original)); });
$("renumberBtn").addEventListener("click", renumber);
$("addSectionBtn").addEventListener("click", addSection);
$("historyBtn").addEventListener("click", showHistory);
$("uploadBtn").addEventListener("click", () => { $("uploadResult").replaceChildren(); $("uploadDialog").hidden = false; });
$("uploadPreviewBtn").addEventListener("click", uploadPreview);
document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => b.closest(".drawer").hidden = true));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") document.querySelectorAll(".drawer").forEach((d) => (d.hidden = true)); });
window.addEventListener("beforeunload", (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = ""; } });

// Lets the AI assistant (ai.js) see the form being edited.
window.AHIP_FORMS = { currentForm: () => state.form };

boot();
