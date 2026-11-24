// AHIP Manage dashboard — reads AHIP Collect submissions (FHIR QuestionnaireResponses) through
// the dashboard server's read-only /fhir proxy. All data text is inserted with textContent.
"use strict";

// The six original tools; new tools made in AHIP Manage > Forms are added at load time.
const BUILT_IN_TOOLS = [
  { n: 1, id: "ahip-t1-cpp-provider", title: "CPP Provider Assessment", short: "CPP Provider" },
  { n: 2, id: "ahip-t2-healthcare-worker", title: "Healthcare Worker Assessment", short: "Healthcare Worker" },
  { n: 3, id: "ahip-t3-exit-client", title: "CPP Exit Client Assessment", short: "CPP Exit Client" },
  { n: 4, id: "ahip-t4-routine-indicators", title: "High-Level Routine Indicators", short: "Routine Indicators" },
  { n: 5, id: "ahip-t5-cpp-digital-sustainability", title: "CPP Digital Sustainability (Kibaha)", short: "CPP Digital (Kibaha)" },
  { n: 6, id: "ahip-t6-facility-digital-sustainability", title: "Facility Digital Sustainability (Kibaha)", short: "Facility Digital (Kibaha)" },
];
let TOOLS = BUILT_IN_TOOLS;
const TOOL_SYSTEM = "urn:ahip:tool";
const toolOf = (n) => TOOLS.find((t) => String(t.n) === String(n));

/** Every AHIP form (by its urn:ahip:tool number), with the short names of the original six kept. */
function toolsFrom(questionnaires) {
  const list = questionnaires.map((q) => {
    const n = Number((q.identifier || []).find((i) => i.system === TOOL_SYSTEM)?.value) ||
      BUILT_IN_TOOLS.find((t) => t.id === q.id)?.n;
    if (!n) return null;
    const known = BUILT_IN_TOOLS.find((t) => t.id === q.id);
    const title = known?.title || String(q.title || q.id).replace(/^Tools*d+s*[:.-]s*/i, "");
    return { n, id: q.id, title, short: known?.short || (title.length > 26 ? title.slice(0, 25) + "…" : title), archived: q.status === "retired", quiz: !!window.AHIP_QUIZ.settings(q) };
  }).filter(Boolean);
  return list.length ? list.sort((a, b) => a.n - b.n) : BUILT_IN_TOOLS;
}

const ASSESSMENTS = {
  "baseline-2025": "Baseline (2025)",
  "midline-2026": "Midline (2026)",
  "endline-2027": "Endline (2027)",
  "rapid-adhoc": "Rapid (Ad-hoc)",
};
const COLLECTOR_TAG = "urn:ahip:data-collector";
const COLLECTOR_NAME_IDS = ["interviewer", "assessor", "collector"];
const SITE_IDS = ["cpp_name_other", "cpp_name", "facility_name"];
const PAGE_SIZE = 25;
const REFRESH_MS = 60000;
const DAY = 86400000;

const $ = (id) => document.getElementById(id);
const state = {
  forms: new Map(), // questionnaire id -> { tool, items: [{linkId, text, prefix, section}] }
  userNames: new Map(), // username -> full name, from AHIP Manage users
  rows: [],
  filtered: [],
  page: 0,
  search: "",
};

// ---------- Data loading ----------

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/fhir+json" } });
  if (response.status === 401) {
    location.replace("/login.html");
    throw new Error("Signed out");
  }
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json();
}

/** Follows FHIR bundle paging; "next" links point at the FHIR server, so re-route via /fhir. */
async function fetchAll(firstUrl) {
  const resources = [];
  let url = firstUrl;
  for (let guard = 0; url && guard < 200; guard++) {
    const bundle = await fetchJson(url);
    (bundle.entry || []).forEach((e) => e.resource && resources.push(e.resource));
    const next = (bundle.link || []).find((l) => l.relation === "next");
    url = next ? "/fhir" + new URL(next.url).search : null;
  }
  return resources;
}

function indexQuestionnaire(questionnaire, tool) {
  const items = [];
  const walk = (list, section) => {
    for (const item of list || []) {
      const isPage = item.type === "group" && (item.extension || []).some((e) =>
        (e.valueCodeableConcept?.coding || []).some((c) => c.code === "page"));
      const hidden = (item.extension || []).some((e) => /questionnaire-hidden$/.test(e.url) && e.valueBoolean);
      if (item.type === "group") {
        if (item.prefix) items.push({ linkId: item.linkId, text: item.text, prefix: item.prefix, section, heading: true });
        walk(item.item, isPage ? item.text : section);
      } else if (item.type !== "display" && !hidden) {
        items.push({ linkId: item.linkId, text: item.text || item.linkId, prefix: item.prefix || "", section });
        walk(item.item, section);
      }
    }
  };
  walk(questionnaire.item, "");
  return { tool, items };
}

function answerText(answer) {
  if (!answer) return "";
  if (answer.valueCoding) return answer.valueCoding.display || answer.valueCoding.code || "";
  if (answer.valueBoolean !== undefined) return answer.valueBoolean ? "Yes" : "No";
  for (const key of ["valueString", "valueInteger", "valueDecimal", "valueDate", "valueDateTime", "valueTime", "valueUri"]) {
    if (answer[key] !== undefined) return String(answer[key]);
  }
  if (answer.valueQuantity) return `${answer.valueQuantity.value ?? ""} ${answer.valueQuantity.unit ?? ""}`.trim();
  if (answer.valueAttachment) return answer.valueAttachment.title || "(attachment)";
  return "";
}

function flattenAnswers(response) {
  const map = new Map();
  const walk = (items) => {
    for (const item of items || []) {
      if (item.answer && item.answer.length) {
        map.set(item.linkId, item.answer.map(answerText).filter(Boolean));
        item.answer.forEach((a) => walk(a.item));
      }
      walk(item.item);
    }
  };
  walk(response.item);
  return map;
}

/** Photos and audio recordings in a response: linkId -> attachments. */
function collectMedia(response) {
  const media = new Map();
  const walk = (items) => {
    for (const item of items || []) {
      for (const answer of item.answer || []) {
        const a = answer.valueAttachment;
        if (a && a.data && /^(image|audio)\//.test(a.contentType || "")) {
          if (!media.has(item.linkId)) media.set(item.linkId, []);
          media.get(item.linkId).push(a);
        }
        walk(answer.item);
      }
      walk(item.item);
    }
  };
  walk(response.item);
  return media;
}

function toRow(response) {
  const toolId = (response.questionnaire || "").split("/").pop().split("|")[0];
  const tool = TOOLS.find((t) => t.id === toolId);
  if (!tool || response.status !== "completed") return null;
  const answers = flattenAnswers(response);
  const first = (ids) => {
    for (const id of ids) {
      const value = answers.get(id)?.[0];
      if (value) return value;
    }
    return "";
  };
  const tag = (response.meta?.tag || []).find((t) => t.system === COLLECTOR_TAG);
  const typedName = first(COLLECTOR_NAME_IDS);
  const assessmentCode = first(["ahip-assessment"]);
  const authored = response.authored || response.meta?.lastUpdated;
  return {
    id: response.id,
    tool,
    authored: authored ? new Date(authored) : null,
    collector: (tag?.code && state.userNames.get(tag.code)) || tag?.code || typedName || "Unknown",
    username: tag?.code || "",
    collectorName: typedName,
    // "Other (not in list)" carries the typed name in region_other / council_other.
    region: first(["region_other", "region"]) || "Not recorded",
    council: first(["council_other", "council"]) || "Not recorded",
    site: first(SITE_IDS) || (tool.n === 4 ? first(["council_other", "council"]) : "") || "—",
    assessment: ASSESSMENTS[assessmentCode] || assessmentCode || "—",
    gps: answers.get("gps_latitude") && answers.get("gps_longitude")
      ? `${answers.get("gps_latitude")[0]}, ${answers.get("gps_longitude")[0]}` : "",
    answers,
    media: collectMedia(response),
    quiz: tool.quiz ? window.AHIP_QUIZ.score(state.raw?.get(tool.id), response) : null,
  };
}

async function load() {
  const content = $("content");
  content.classList.add("loading");
  try {
    const ids = BUILT_IN_TOOLS.map((t) => t.id).join(",");
    const [numbered, builtIn, responses, people] = await Promise.all([
      fetchAll("/fhir/Questionnaire?identifier=urn%3Aahip%3Atool%7C&_count=200"),
      fetchAll(`/fhir/Questionnaire?_id=${ids}&_count=50`),
      fetchAll("/fhir/QuestionnaireResponse?_count=200&_sort=-_lastUpdated"),
      fetchJson("/api/users").catch(() => ({ users: [] })),
    ]);
    const questionnaires = [...new Map([...builtIn, ...numbered].map((q) => [q.id, q])).values()];
    TOOLS = toolsFrom(questionnaires);
    state.raw = new Map(questionnaires.map((q) => [q.id, q]));
    state.userNames = new Map((people.users || []).map((u) => [u.username, u.name]));
    state.forms = new Map(questionnaires.map((q) => [q.id, indexQuestionnaire(q, TOOLS.find((t) => t.id === q.id))]));
    state.rows = responses.map(toRow).filter(Boolean).sort((a, b) => (b.authored || 0) - (a.authored || 0));
    $("error").hidden = true;
    $("updated").textContent = `Updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    buildFilterOptions();
    render();
  } catch (error) {
    const box = $("error");
    box.textContent = `Could not load data from the AHIP FHIR server. Is Docker running? (${error.message})`;
    box.hidden = false;
    $("updated").textContent = "Not updated";
  } finally {
    content.classList.remove("loading");
  }
}

// ---------- Filters ----------

const FILTERS = [
  { el: "fTool", all: "All tools", key: (r) => String(r.tool.n), label: (v) => `Tool ${v}: ${toolOf(v)?.title || ""}` },
  { el: "fAssessment", all: "All assessments", key: (r) => r.assessment },
  { el: "fRegion", all: "All regions", key: (r) => r.region },
  { el: "fCouncil", all: "All councils", key: (r) => r.council, dependsOn: "fRegion" },
  { el: "fCollector", all: "All collectors", key: (r) => r.collector },
];

function setOptions(select, allLabel, values, labelFn) {
  const current = select.value;
  select.replaceChildren(new Option(allLabel, ""));
  values.forEach((v) => select.add(new Option(labelFn ? labelFn(v) : v, v)));
  select.value = values.includes(current) ? current : "";
}

function buildFilterOptions() {
  for (const f of FILTERS) {
    let source = state.rows;
    if (f.dependsOn === "fRegion" && $("fRegion").value) source = source.filter((r) => r.region === $("fRegion").value);
    let values = [...new Set(source.map(f.key))];
    values = f.el === "fTool" ? TOOLS.filter((t) => !t.archived || state.rows.some((r) => r.tool === t)).map((t) => String(t.n)) : values.sort((a, b) => a.localeCompare(b));
    setOptions($(f.el), f.all, values, f.label);
  }
}

function dateFloor() {
  const value = $("fDate").value;
  if (value === "all") return null;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return value === "today" ? start : new Date(start.getTime() - (Number(value) - 1) * DAY);
}

function applyFilters() {
  const floor = dateFloor();
  const q = state.search.trim().toLowerCase();
  state.filtered = state.rows.filter((r) => {
    if (floor && (!r.authored || r.authored < floor)) return false;
    for (const f of FILTERS) {
      const v = $(f.el).value;
      if (v && f.key(r) !== v) return false;
    }
    if (q && ![r.site, r.collector, r.collectorName, r.council, r.region, r.tool.title].join(" ").toLowerCase().includes(q)) return false;
    return true;
  });
}

// ---------- Rendering ----------

function render() {
  applyFilters();
  renderTiles();
  const rows = state.filtered;
  barChart($("cTool"), TOOLS.filter((t) => !t.archived || rows.some((r) => r.tool === t)).map((t) => ({ label: `T${t.n} · ${t.short}`, value: rows.filter((r) => r.tool === t).length })), "Tool");
  timeChart($("cTime"), rows);
  barChart($("cCouncil"), countBy(rows, (r) => r.council), "Council");
  barChart($("cCollector"), topN(countBy(rows, (r) => r.collector), 10), "Data collector");
  renderQuizChart(rows);
  state.page = Math.min(state.page, Math.max(0, Math.ceil(rows.length / PAGE_SIZE) - 1));
  renderTable();
  const toolChosen = !!$("fTool").value;
  $("exportHint").textContent = toolChosen
    ? "Export includes every question of the selected tool as its own column."
    : "Tip: choose a tool in the filters to export every question as its own column.";
}

/** Average quiz score (%) per data collector, shown when the filtered rows include quiz submissions. */
function renderQuizChart(rows) {
  const scored = rows.filter((r) => r.quiz);
  $("quizCard").hidden = !scored.length;
  if (!scored.length) return;
  const by = new Map();
  scored.forEach((r) => { const a = by.get(r.collector) || []; a.push(r.quiz.percent); by.set(r.collector, a); });
  const data = [...by.entries()].map(([label, list]) => ({ label, value: Math.round(list.reduce((s, v) => s + v, 0) / list.length) }))
    .sort((a, b) => b.value - a.value).slice(0, 12);
  barChart($("cQuiz"), data, "Data collector");
  const all = Math.round(scored.reduce((s, r) => s + r.quiz.percent, 0) / scored.length);
  const timedOut = scored.filter((r) => r.quiz.timedOut).length;
  $("quizNote").textContent = `${scored.length} quiz submission${scored.length === 1 ? "" : "s"} · average ${all}%${timedOut ? ` · ${timedOut} ran out of time` : ""}`;
}

function renderTiles() {
  const rows = state.filtered;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const weekStart = new Date(today.getTime() - 6 * DAY);
  $("tTotal").textContent = fmt(rows.length);
  $("tTotalSub").textContent = rows.length === state.rows.length ? "all submissions" : `of ${fmt(state.rows.length)} in total`;
  $("tToday").textContent = fmt(rows.filter((r) => r.authored && r.authored >= today).length);
  $("tWeek").textContent = fmt(rows.filter((r) => r.authored && r.authored >= weekStart).length);
  $("tCollectors").textContent = fmt(new Set(rows.map((r) => r.collector)).size);
  $("tCouncils").textContent = fmt(new Set(rows.map((r) => r.council).filter((c) => c !== "Not recorded")).size);
}

const fmt = (n) => n.toLocaleString();

function countBy(rows, keyFn) {
  const counts = new Map();
  rows.forEach((r) => counts.set(keyFn(r), (counts.get(keyFn(r)) || 0) + 1));
  return [...counts].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

function topN(list, n) {
  if (list.length <= n) return list;
  const rest = list.slice(n - 1).reduce((s, d) => s + d.value, 0);
  return [...list.slice(0, n - 1), { label: "Other", value: rest }];
}

// ---------- Charts (plain SVG) ----------

const SVG = "http://www.w3.org/2000/svg";
function el(name, attrs = {}, text) {
  const node = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Bar with a 4px rounded data end and a square baseline end. */
function barPath(x, y, w, h, horizontal) {
  const r = Math.min(4, horizontal ? w : h, horizontal ? h / 2 : w / 2);
  if (horizontal) {
    return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
  }
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function niceMax(v) {
  if (v <= 5) return Math.max(1, v);
  const pow = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * pow).find((m) => m >= v);
}

function tableView(headers, rows) {
  const details = document.createElement("details");
  details.className = "table-view";
  const summary = document.createElement("summary");
  summary.textContent = "Table view";
  const table = document.createElement("table");
  const head = table.createTHead().insertRow();
  headers.forEach((h) => { const th = document.createElement("th"); th.textContent = h; head.appendChild(th); });
  const body = table.createTBody();
  rows.forEach((cells) => { const tr = body.insertRow(); cells.forEach((c) => (tr.insertCell().textContent = c)); });
  details.append(summary, table);
  return details;
}

function barChart(container, data, categoryName) {
  container.replaceChildren();
  if (!data.length || data.every((d) => d.value === 0) && categoryName !== "Tool") {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No submissions for these filters";
    container.appendChild(empty);
    return;
  }
  const width = 560, labelW = 230, valueW = 40, rowH = 32, barH = 18, top = 4;
  const height = top + data.length * rowH;
  const max = niceMax(Math.max(...data.map((d) => d.value)));
  const plotW = width - labelW - valueW;
  const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": `Submissions by ${categoryName.toLowerCase()}` });
  svg.appendChild(el("line", { x1: labelW, x2: labelW, y1: 0, y2: height, class: "baseline" }));
  data.forEach((d, i) => {
    const y = top + i * rowH;
    const label = d.label.length > 34 ? d.label.slice(0, 33) + "…" : d.label;
    svg.appendChild(el("text", { x: labelW - 8, y: y + rowH / 2 + 4, "text-anchor": "end", class: "label-text" }, label));
    const w = d.value ? Math.max(2, (d.value / max) * plotW) : 0;
    const hit = el("rect", { x: 0, y, width, height: rowH, class: "hit", tabindex: 0 });
    hit.setAttribute("aria-label", `${d.label}: ${d.value}`);
    svg.appendChild(hit);
    svg.appendChild(el("path", { d: barPath(labelW, y + (rowH - barH) / 2, w, barH, true), class: "mark" }));
    svg.appendChild(el("text", { x: labelW + w + 6, y: y + rowH / 2 + 4, class: "value-text" }, fmt(d.value)));
    attachTooltip(hit, d.label, d.value);
  });
  container.append(svg, tableView([categoryName, "Submissions"], data.map((d) => [d.label, fmt(d.value)])));
}

function timeChart(container, rows) {
  container.replaceChildren();
  const dated = rows.filter((r) => r.authored);
  if (!dated.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No submissions for these filters";
    container.appendChild(empty);
    return;
  }
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const floor = dateFloor();
  const earliest = new Date(Math.min(...dated.map((r) => r.authored))); earliest.setHours(0, 0, 0, 0);
  let start = floor || earliest;
  if ((today - start) / DAY < 6) start = new Date(today.getTime() - 6 * DAY); // show at least a week
  const days = Math.round((today - start) / DAY) + 1;
  const weekly = days > 60;
  const bucketDays = weekly ? 7 : 1;
  const buckets = [];
  for (let t = start.getTime(); t <= today.getTime(); t += bucketDays * DAY) buckets.push({ start: new Date(t), value: 0 });
  dated.forEach((r) => {
    const i = Math.floor((r.authored - start) / (bucketDays * DAY));
    if (i >= 0 && i < buckets.length) buckets[i].value++;
  });
  const fmtDay = (d) => d.toLocaleDateString([], { day: "numeric", month: "short" });
  const labelOf = (b) => (weekly ? `Week of ${fmtDay(b.start)}` : b.start.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" }));

  const width = 560, height = 220, left = 36, right = 8, top = 10, bottom = 28;
  const plotW = width - left - right, plotH = height - top - bottom;
  const max = niceMax(Math.max(...buckets.map((b) => b.value)));
  const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "Submissions over time" });
  const ticks = max <= 5 ? max : 4;
  for (let i = 0; i <= ticks; i++) {
    const v = (max / ticks) * i, y = top + plotH - (v / max) * plotH;
    svg.appendChild(el("line", { x1: left, x2: width - right, y1: y, y2: y, class: i ? "gridline" : "baseline" }));
    svg.appendChild(el("text", { x: left - 6, y: y + 4, "text-anchor": "end", class: "axis-text" }, fmt(Math.round(v * 10) / 10)));
  }
  // Line chart: one 2px line through the daily (or weekly) totals, a soft area under it, points
  // when there are few enough to read, and a crosshair + tooltip on hover / keyboard focus.
  const slot = plotW / buckets.length;
  const labelEvery = Math.ceil(buckets.length / 7);
  const xOf = (i) => left + i * slot + slot / 2;
  const yOf = (v) => top + plotH - (v / max) * plotH;
  const points = buckets.map((b, i) => [xOf(i), yOf(b.value)]);
  const line = points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  const base = top + plotH;
  svg.appendChild(el("path", { d: `${line}L${points[points.length - 1][0].toFixed(1)},${base}L${points[0][0].toFixed(1)},${base}Z`, class: "trend-area" }));
  svg.appendChild(el("path", { d: line, class: "trend-line" }));
  const showDots = buckets.length <= 31;
  buckets.forEach((b, i) => {
    const [x, y] = points[i];
    const hit = el("rect", { x: left + i * slot, y: top, width: slot, height: plotH, class: "hit", tabindex: 0 });
    hit.setAttribute("aria-label", `${labelOf(b)}: ${b.value}`);
    svg.appendChild(hit);
    svg.appendChild(el("line", { x1: x, x2: x, y1: top, y2: base, class: "crosshair" }));
    svg.appendChild(el("circle", { cx: x, cy: y, r: 4, class: `trend-dot${showDots ? "" : " quiet"}` }));
    attachTooltip(hit, labelOf(b), b.value);
    if (i % labelEvery === 0 || i === buckets.length - 1) {
      svg.appendChild(el("text", { x, y: height - 8, "text-anchor": "middle", class: "axis-text" }, fmtDay(b.start)));
    }
  });
  // Direct label on the latest point only (never a number on every point).
  const last = buckets[buckets.length - 1];
  const [lx, ly] = points[points.length - 1];
  svg.appendChild(el("text", { x: lx - 8, y: ly < top + 24 ? ly + 18 : ly - 10, "text-anchor": "end", class: "value-text" }, `${fmt(last.value)} ${weekly ? "this week" : "today"}`));
  container.append(svg, tableView([weekly ? "Week starting" : "Day", "Submissions"],
    buckets.filter((b) => b.value).map((b) => [labelOf(b), fmt(b.value)])));
}

function attachTooltip(target, label, value) {
  const tip = $("tooltip");
  const show = (x, y) => {
    const strong = document.createElement("strong");
    strong.textContent = `${fmt(value)} submission${value === 1 ? "" : "s"}`;
    const key = document.createElement("span");
    key.className = "key";
    const text = document.createElement("span");
    text.textContent = label;
    tip.replaceChildren(strong, key, text);
    tip.hidden = false;
    const pad = 14, w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = `${Math.min(x + pad, window.innerWidth - w - 8)}px`;
    tip.style.top = `${Math.max(8, y - h - pad)}px`;
  };
  const mark = () => target.nextSibling;
  target.addEventListener("pointermove", (e) => show(e.clientX, e.clientY));
  target.addEventListener("pointerleave", () => (tip.hidden = true));
  target.addEventListener("focus", () => {
    const box = target.getBoundingClientRect();
    show(box.left + box.width / 2, box.top + 8);
    mark()?.classList.add("active");
  });
  target.addEventListener("blur", () => { tip.hidden = true; mark()?.classList.remove("active"); });
}

// ---------- Table & detail ----------

function renderTable() {
  const rows = state.filtered;
  const body = $("rows");
  body.replaceChildren();
  $("rowCount").textContent = `(${fmt(rows.length)})`;
  const pageRows = rows.slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE);
  if (!pageRows.length) {
    const tr = body.insertRow();
    tr.className = "empty-row";
    const td = tr.insertCell();
    td.colSpan = 7;
    td.textContent = state.rows.length ? "No submissions match these filters." : "No submissions yet. Submitted AHIP Collect assessments appear here after the phone syncs.";
  }
  for (const r of pageRows) {
    const tr = body.insertRow();
    tr.tabIndex = 0;
    tr.insertCell().textContent = r.authored ? r.authored.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—";
    const toolCell = tr.insertCell();
    const chip = document.createElement("span");
    chip.className = `tool-chip${r.tool.n % 2 ? "" : " even"}`;
    chip.textContent = `T${r.tool.n}`;
    toolCell.append(chip, document.createTextNode(r.tool.title));
    if (r.quiz) {
      const score = document.createElement("span");
      score.className = `score-chip${r.quiz.percent >= 50 ? "" : " low"}`;
      score.textContent = `${r.quiz.points}/${r.quiz.total} · ${r.quiz.percent}%`;
      score.title = r.quiz.timedOut ? "Time ran out" : "Quiz score";
      toolCell.append(score);
    }
    [r.site, r.region, r.council, r.collector, r.assessment].forEach((v) => (tr.insertCell().textContent = v));
    tr.addEventListener("click", () => openDetail(r));
    tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(r); } });
  }
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  $("pageInfo").textContent = `Page ${state.page + 1} of ${pages}`;
  $("prevPage").disabled = state.page === 0;
  $("nextPage").disabled = state.page >= pages - 1;
}

let lastFocus = null;
function openDetail(row) {
  lastFocus = document.activeElement;
  $("drawerTitle").textContent = `Tool ${row.tool.n}: ${row.tool.title}`;
  $("drawerMeta").textContent = [
    row.site,
    row.authored ? row.authored.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "",
    `Collector: ${row.collector}${row.collectorName && row.collectorName !== row.collector ? ` (${row.collectorName})` : ""}`,
    row.assessment,
    row.gps ? `GPS ${row.gps}` : "",
    row.quiz ? `Quiz score ${row.quiz.points}/${row.quiz.total} (${row.quiz.percent}%, ${row.quiz.right} of ${row.quiz.count} correct)${row.quiz.seconds != null ? ` in ${Math.floor(row.quiz.seconds / 60)}:${String(row.quiz.seconds % 60).padStart(2, "0")}` : ""}${row.quiz.timedOut ? ", time ran out" : ""}` : "",
  ].filter(Boolean).join(" · ");
  const body = $("drawerBody");
  body.replaceChildren();
  const form = state.forms.get(row.tool.id);
  let section = null;
  const items = form ? form.items : [...row.answers.keys()].map((linkId) => ({ linkId, text: linkId, prefix: "", section: "" }));
  for (const item of items) {
    if (item.heading) {
      const h = document.createElement("div");
      h.className = "qa";
      const q = document.createElement("div");
      q.className = "q";
      q.textContent = `${item.prefix} ${item.text}`.trim();
      q.style.fontWeight = "600";
      h.appendChild(q);
      body.appendChild(h);
      continue;
    }
    const values = row.answers.get(item.linkId);
    if (!values && /_other$/.test(item.linkId)) continue; // "please specify" only matters when answered
    if (item.section !== section) {
      section = item.section;
      if (section) {
        const title = document.createElement("div");
        title.className = "section-title";
        title.textContent = section;
        body.appendChild(title);
      }
    }
    const qa = document.createElement("div");
    qa.className = `qa${values ? "" : " unanswered"}`;
    const q = document.createElement("div");
    q.className = "q";
    q.textContent = `${item.prefix} ${item.text}`.trim();
    const a = document.createElement("div");
    a.className = "a";
    a.textContent = values ? values.join("\n") : "Not answered / skipped";
    for (const file of row.media.get(item.linkId) || []) a.appendChild(mediaPreview(file));
    qa.append(q, a);
    body.appendChild(qa);
  }
  $("drawer").hidden = false;
  document.querySelector("#drawer .drawer-head .btn").focus();
}

/** A photo (click to enlarge) or an audio player, with a download link. */
function mediaPreview(file) {
  const url = `data:${file.contentType};base64,${file.data}`;
  const box = document.createElement("div");
  box.className = "media";
  if (file.contentType.startsWith("image/")) {
    const img = document.createElement("img");
    img.src = url;
    img.alt = file.title || "Photo";
    img.loading = "lazy";
    img.title = "Click to enlarge";
    img.addEventListener("click", () => img.classList.toggle("big"));
    box.appendChild(img);
  } else {
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.preload = "none";
    audio.src = url;
    box.appendChild(audio);
  }
  const link = document.createElement("a");
  link.href = url;
  link.download = file.title || (file.contentType.startsWith("image/") ? "photo.jpg" : "recording.m4a");
  link.textContent = `Download (${Math.max(1, Math.round((file.size || file.data.length * 0.75) / 1024))} KB)`;
  box.appendChild(link);
  return box;
}

function closeDetail() {
  $("drawer").hidden = true;
  lastFocus?.focus();
}

// ---------- CSV export ----------

function csvCell(value) {
  const s = String(value ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportCsv() {
  const rows = state.filtered;
  const base = ["Submitted", "Tool", "Site", "Region", "Council", "Data collector", "Collector name", "Assessment", "GPS", "Response ID"];
  const baseValues = (r) => [r.authored ? r.authored.toISOString() : "", `Tool ${r.tool.n}: ${r.tool.title}`, r.site, r.region,
    r.council, r.collector, r.collectorName, r.assessment, r.gps, r.id];
  const toolNumber = $("fTool").value;
  let header = base, line = baseValues;
  if (rows.some((r) => r.quiz)) {
    const plain = line;
    header = [...header, "Quiz points", "Quiz total", "Quiz %", "Quiz seconds", "Time ran out"];
    line = (r) => [...plain(r), r.quiz?.points ?? "", r.quiz?.total ?? "", r.quiz?.percent ?? "", r.quiz?.seconds ?? "", r.quiz ? (r.quiz.timedOut ? "yes" : "no") : ""];
  }
  const withQuiz = line;
  if (toolNumber) {
    const form = state.forms.get(toolOf(toolNumber)?.id);
    const questions = (form?.items || []).filter((i) => !i.heading);
    header = [...header, ...questions.map((i) => `${i.prefix} ${i.text}`.trim())];
    line = (r) => [...withQuiz(r), ...questions.map((i) => (r.answers.get(i.linkId) || []).join("; "))];
  }
  const csv = [header, ...rows.map(line)].map((cells) => cells.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  link.href = URL.createObjectURL(blob);
  link.download = toolNumber ? `ahip_tool${toolNumber}_${stamp}.csv` : `ahip_submissions_${stamp}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

// ---------- Wiring ----------

["fDate", "fTool", "fAssessment", "fCouncil", "fCollector"].forEach((id) =>
  $(id).addEventListener("change", () => { state.page = 0; render(); }));
$("fRegion").addEventListener("change", () => { state.page = 0; buildFilterOptions(); render(); });
$("resetBtn").addEventListener("click", () => {
  document.querySelectorAll(".filters select").forEach((s) => (s.value = s.id === "fDate" ? "all" : ""));
  $("search").value = "";
  state.search = "";
  state.page = 0;
  buildFilterOptions();
  render();
});
$("search").addEventListener("input", (e) => { state.search = e.target.value; state.page = 0; render(); });
$("prevPage").addEventListener("click", () => { state.page--; renderTable(); });
$("nextPage").addEventListener("click", () => { state.page++; renderTable(); });
$("exportBtn").addEventListener("click", exportCsv);
$("refreshBtn").addEventListener("click", load);
document.querySelectorAll("[data-close]").forEach((n) => n.addEventListener("click", closeDetail));
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("drawer").hidden) closeDetail(); });

/** Submissions per username, for the Users page. */
function submissionsByUsername() {
  const counts = new Map();
  state.rows.forEach((r) => r.username && counts.set(r.username, (counts.get(r.username) || 0) + 1));
  return counts;
}
/** What the page currently shows, for the AI assistant: the filtered submissions and filters. */
function currentView() {
  const filters = ["fDate", "fTool", "fAssessment", "fRegion", "fCouncil", "fCollector"]
    .map((id) => $(id))
    .filter((s) => s && s.value && !(s.id === "fDate" && s.value === "all"))
    .map((s) => s.options[s.selectedIndex]?.text)
    .filter(Boolean);
  return {
    ids: state.filtered.map((r) => r.id),
    description: filters.length ? filters.join(" · ") : "All submissions (no filters)",
  };
}

window.AHIP = { load, submissionsByUsername, currentView };

async function boot() {
  const session = await fetch("/api/session").then((r) => r.json()).catch(() => ({}));
  if (!session.user || !["admin", "supervisor"].includes(session.user.role)) {
    location.replace("/login.html");
    return;
  }
  $("me").textContent = `Signed in as ${session.user.name}${session.user.role === "supervisor" ? " (Supervisor)" : ""}`;
  window.dispatchEvent(new CustomEvent("ahip:session", { detail: session.user }));
  await load();
  setInterval(() => {
    if ($("drawer").hidden && !document.hidden && !$("viewData").hidden) load();
  }, REFRESH_MS);
}
boot();
