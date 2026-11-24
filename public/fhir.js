// FHIR data browser: a read-only, AHIP-branded view of the FHIR server (through the dashboard's
// GET-only /fhir proxy, admins only). Replaces the HAPI test page for day-to-day browsing.
"use strict";

const $ = (id) => document.getElementById(id);

// Resource types shown in the side list, with the columns used for each.
const TYPES = [
  { type: "Questionnaire", label: "Forms (T1–T6)", sort: "title" },
  { type: "QuestionnaireResponse", label: "Submitted forms", sort: "-_lastUpdated" },
  { type: "Binary", label: "Files", sort: "-_lastUpdated" },
  { type: "Location", label: "Places", sort: "-_lastUpdated" },
  { type: "Organization", label: "Organisations", sort: "-_lastUpdated" },
  { type: "Practitioner", label: "Staff", sort: "-_lastUpdated" },
  { type: "Group", label: "Groups", sort: "-_lastUpdated" },
  { type: "Patient", label: "People", sort: "-_lastUpdated" },
];

const COLLECTOR_TAG = "urn:ahip:data-collector";
const state = { type: TYPES[0], links: {}, page: 1, entries: [], current: null };

const fmtDate = (s) => (s ? new Date(s).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "–");
// Questions as the app counts them: numbered items (with a prefix), else every answerable item.
const walkItems = (items = [], out = []) => (items.forEach((it) => { out.push(it); walkItems(it.item, out); }), out);
const countItems = (items) => {
  const all = walkItems(items);
  const numbered = all.filter((it) => it.prefix).length;
  return numbered || all.filter((it) => it.type !== "group" && it.type !== "display").length;
};

// What each type shows: [header, cell(resource) -> text | Node, className]
function columns(type) {
  const updated = ["Last updated", (r) => fmtDate(r.meta?.lastUpdated)];
  const id = ["ID", (r) => r.id, "id"];
  switch (type) {
    case "Questionnaire":
      return [
        ["Title", (r) => r.title || r.name || r.id, "title-cell"],
        id,
        ["Status", (r) => pill(r.status)],
        ["Questions", (r) => countItems(r.item).toLocaleString(), "num"],
        updated,
      ];
    case "QuestionnaireResponse":
      return [
        ["Form", (r) => (r.questionnaire || "").replace(/^.*Questionnaire\//, ""), "title-cell"],
        ["Collector", (r) => r.meta?.tag?.find((t) => t.system === COLLECTOR_TAG)?.code || "–"],
        ["Status", (r) => pill(r.status)],
        ["Submitted", (r) => fmtDate(r.authored || r.meta?.lastUpdated)],
        id,
      ];
    case "Binary":
      return [id, ["Content type", (r) => r.contentType || "–"], ["Size", (r) => sizeOf(r.data), "num"], updated];
    default:
      return [["Name", (r) => displayName(r), "title-cell"], id, updated];
  }
}

function displayName(r) {
  if (typeof r.name === "string") return r.name;
  const n = Array.isArray(r.name) ? r.name[0] : null;
  if (n) return n.text || [...(n.given || []), n.family].filter(Boolean).join(" ") || r.id;
  return r.title || r.id;
}

function sizeOf(base64) {
  if (!base64) return "–";
  const bytes = Math.floor((base64.length * 3) / 4);
  return bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function pill(status) {
  const s = document.createElement("span");
  s.className = `pill ${status || ""}`;
  s.textContent = status || "–";
  return s;
}

async function getJson(path) {
  const res = await fetch(path, { headers: { Accept: "application/fhir+json" } });
  if (res.status === 401) {
    location.replace("/login.html");
    throw new Error("Sign in required.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.issue?.[0]?.diagnostics || body.error || `FHIR server error (${res.status})`);
  return body;
}

// Bundle paging links point at the FHIR server itself; send them through the dashboard proxy.
const viaProxy = (link) => {
  const u = new URL(link);
  return "/fhir" + u.pathname.replace(/^.*?\/fhir/, "") + u.search;
};

// ------------------------------------------------------------------ server + type list

async function loadServer() {
  try {
    const meta = await getJson("/fhir/metadata?_summary=true");
    $("sStatus").textContent = "Online";
    $("serverDot").className = "dot ok";
    $("sSoftware").textContent = [meta.software?.name, meta.software?.version].filter(Boolean).join(" ") || "–";
    $("sVersion").textContent = meta.fhirVersion || "–";
  } catch (error) {
    $("sStatus").textContent = "Not reachable";
    $("serverDot").className = "dot down";
  }
}

function renderTypes() {
  const list = $("typeList");
  list.replaceChildren();
  TYPES.forEach((t) => {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-current", String(t === state.type));
    const name = document.createElement("span");
    name.className = "type-name";
    name.innerHTML = `<span></span><small></small>`;
    name.firstChild.textContent = t.type;
    name.lastChild.textContent = t.label;
    const count = document.createElement("span");
    count.className = "count";
    count.textContent = t.count ?? "…";
    b.append(name, count);
    b.addEventListener("click", () => selectType(t));
    li.appendChild(b);
    list.appendChild(li);
  });
}

async function loadCounts() {
  await Promise.all(
    TYPES.map(async (t) => {
      try {
        t.count = (await getJson(`/fhir/${t.type}?_summary=count`)).total ?? 0;
      } catch {
        t.count = "–";
      }
    }),
  );
  renderTypes();
}

// ------------------------------------------------------------------ resource table

function selectType(t) {
  state.type = t;
  state.page = 1;
  $("search").value = "";
  renderTypes();
  const params = new URLSearchParams({ _count: $("pageSize").value, _sort: t.sort, _total: "accurate" });
  loadPage(`/fhir/${t.type}?${params}`);
  try { localStorage.setItem("ahip-fhir-type", t.type); } catch {}
}

async function loadPage(path) {
  $("error").hidden = true;
  $("listTitle").textContent = state.type.type;
  $("listSub").textContent = "Loading…";
  try {
    const bundle = await getJson(path);
    state.entries = (bundle.entry || []).map((e) => e.resource).filter(Boolean);
    state.links = Object.fromEntries((bundle.link || []).map((l) => [l.relation, l.url]));
    const total = bundle.total ?? state.type.count;
    $("listSub").textContent = `${state.type.label} · ${typeof total === "number" ? total.toLocaleString() : "?"} in total`;
    $("prevBtn").disabled = !state.links.previous && !state.links.prev;
    $("nextBtn").disabled = !state.links.next;
    $("pageInfo").textContent = `Page ${state.page}`;
    renderRows();
  } catch (error) {
    state.entries = [];
    renderRows();
    $("listSub").textContent = "";
    $("error").textContent = error.message;
    $("error").hidden = false;
  }
}

function renderRows() {
  const cols = columns(state.type.type);
  const head = document.createElement("tr");
  cols.forEach(([h, , cls]) => {
    const th = document.createElement("th");
    th.textContent = h;
    if (cls === "num") th.className = "num";
    head.appendChild(th);
  });
  $("thead").replaceChildren(head);

  const filter = $("search").value.trim().toLowerCase();
  const rows = state.entries.filter((r) => !filter || JSON.stringify(r).toLowerCase().includes(filter));
  const body = $("tbody");
  body.replaceChildren();
  if (!rows.length) {
    const tr = body.insertRow();
    const td = tr.insertCell();
    td.colSpan = cols.length;
    td.className = "empty";
    td.textContent = filter ? "Nothing on this page matches the filter." : "No resources of this type yet.";
    return;
  }
  rows.forEach((r) => {
    const tr = body.insertRow();
    tr.tabIndex = 0;
    cols.forEach(([, cell, cls]) => {
      const td = tr.insertCell();
      if (cls) td.className = cls;
      const v = cell(r);
      v instanceof Node ? td.appendChild(v) : (td.textContent = v ?? "–");
    });
    tr.addEventListener("click", () => openResource(r));
    tr.addEventListener("keydown", (e) => e.key === "Enter" && openResource(r));
  });
}

// ------------------------------------------------------------------ detail drawer

function highlight(json) {
  const esc = json.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc.replace(
    /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (m) => {
      const cls = m.startsWith('"') ? (m.endsWith(":") ? "k" : "s") : /true|false|null/.test(m) ? "b" : "n";
      return `<span class="${cls}">${m}</span>`;
    },
  );
}

function openResource(r) {
  state.current = r;
  $("drawerTitle").textContent = r.title || displayName(r);
  $("drawerSub").textContent = `${r.resourceType}/${r.id}`;
  const facts = [
    ["Type", r.resourceType],
    ["ID", r.id],
    ["Version", r.meta?.versionId || "–"],
    ["Last updated", fmtDate(r.meta?.lastUpdated)],
  ];
  if (r.resourceType === "Questionnaire") {
    facts.push(["Questions", countItems(r.item)], ["Sections", (r.item || []).filter((i) => i.type === "group").map((i) => i.text).join(" · ") || "–"]);
  }
  const dl = document.createElement("dl");
  dl.className = "summary";
  facts.forEach(([k, v]) => {
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = k;
    dd.textContent = v;
    dl.append(dt, dd);
  });
  $("summary").replaceChildren(dl);
  $("json").innerHTML = highlight(JSON.stringify(r, null, 2));
  $("drawer").hidden = false;
}

function closeDrawer() {
  $("drawer").hidden = true;
  state.current = null;
}

// ------------------------------------------------------------------ boot

window.addEventListener("ahip:sync", (e) => e.preventDefault());
window.AHIP_SYNC = async () => { loadServer(); loadCounts(); selectType(state.type); };

async function boot() {
  const session = await fetch("/api/session").then((r) => r.json()).catch(() => ({}));
  if (session.user?.role === "supervisor") return location.replace("/");
  if (!session.user || session.user.role !== "admin") {
    location.replace("/login.html");
    return;
  }
  $("me").textContent = `Signed in as ${session.user.name}`;

  let saved = null;
  try { saved = localStorage.getItem("ahip-fhir-type"); } catch {}
  state.type = TYPES.find((t) => t.type === saved) || TYPES[0];

  renderTypes();
  loadServer();
  loadCounts();
  selectType(state.type);
}

$("logoutBtn").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" }).catch(() => {});
  location.replace("/login.html");
});
$("search").addEventListener("input", renderRows);
$("pageSize").addEventListener("change", () => selectType(state.type));
$("reloadBtn").addEventListener("click", () => { loadCounts(); selectType(state.type); });
$("nextBtn").addEventListener("click", () => { state.page++; loadPage(viaProxy(state.links.next)); });
$("prevBtn").addEventListener("click", () => {
  state.page = Math.max(1, state.page - 1);
  loadPage(viaProxy(state.links.previous || state.links.prev));
});
document.querySelectorAll("[data-close]").forEach((el) => el.addEventListener("click", closeDrawer));
document.addEventListener("keydown", (e) => e.key === "Escape" && !$("drawer").hidden && closeDrawer());
$("copyBtn").addEventListener("click", async () => {
  if (!state.current) return;
  try {
    await navigator.clipboard.writeText(JSON.stringify(state.current, null, 2));
    $("copyBtn").textContent = "Copied";
    setTimeout(() => ($("copyBtn").textContent = "Copy JSON"), 1500);
  } catch {
    alert("Copy is not available in this browser.");
  }
});
$("downloadBtn").addEventListener("click", () => {
  if (!state.current) return;
  const blob = new Blob([JSON.stringify(state.current, null, 2)], { type: "application/fhir+json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${state.current.resourceType}-${state.current.id}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

boot();
