// AHIP Manage > Forms: read, check, publish and version the AHIP tool forms (FHIR Questionnaires).
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const { readWorkbook, writeWorkbook } = require("./xlsx");
const X = require("./xlsform");

/**
 * Every AHIP form carries the identifier urn:ahip:tool|<number>; phones, the dashboard and the AI
 * find the forms by it. These six built-in tools are also known by id (older app versions).
 */
const TOOL_SYSTEM = "urn:ahip:tool";
const TARGET_EXT = "urn:ahip:tool-target";
const MINUTES_EXT = "urn:ahip:tool-minutes";
const TOOL_IDS = [
  "ahip-t1-cpp-provider",
  "ahip-t2-healthcare-worker",
  "ahip-t3-exit-client",
  "ahip-t4-routine-indicators",
  "ahip-t5-cpp-digital-sustainability",
  "ahip-t6-facility-digital-sustainability",
];

const ITEM_TYPES = new Set([
  "group", "display", "boolean", "decimal", "integer", "date", "dateTime", "time", "string", "text",
  "url", "choice", "open-choice", "attachment", "reference", "quantity",
]);

function createForms({ fhirUrl, dataDir }) {
  const historyDir = path.join(dataDir, "form-history");

  function fhir(method, pathAndQuery, body) {
    const target = new URL(fhirUrl.href.replace(/\/$/, "") + pathAndQuery);
    const lib = target.protocol === "https:" ? https : http;
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    return new Promise((resolve, reject) => {
      const req = lib.request(
        target,
        {
          method,
          timeout: 30000,
          headers: {
            Accept: "application/fhir+json",
            ...(payload ? { "Content-Type": "application/fhir+json", "Content-Length": payload.length } : {}),
          },
        },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            let json = null;
            try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
            if (res.statusCode >= 200 && res.statusCode < 300) resolve(json);
            else reject(Object.assign(new Error(res.statusCode === 404 || res.statusCode === 410 ? "Unknown form." : json?.issue?.[0]?.diagnostics || `FHIR server error ${res.statusCode}`), { status: res.statusCode === 410 ? 404 : res.statusCode }));
          });
        },
      );
      req.on("timeout", () => req.destroy(new Error("FHIR server timed out")));
      req.on("error", (e) => reject(new Error(`FHIR server unavailable: ${e.message}`)));
      if (payload) req.write(payload);
      req.end();
    });
  }

  const walk = (items, fn, parent = null) =>
    (items || []).forEach((item) => {
      fn(item, parent);
      walk(item.item, fn, item);
    });

  const toolNumber = (q) =>
    Number((q?.identifier || []).find((i) => i.system === TOOL_SYSTEM)?.value) || TOOL_IDS.indexOf(q?.id) + 1 || null;
  const extValue = (q, url) => (q.extension || []).find((e) => e.url === url);

  function summary(q) {
    let questions = 0;
    let numbered = 0;
    walk(q.item, (i) => {
      if (i.type !== "group" && i.type !== "display") questions++;
      if (i.prefix) numbered++;
    });
    return {
      id: q.id,
      title: q.title || q.name || q.id,
      description: q.description || "",
      version: q.meta?.versionId || "",
      lastUpdated: q.meta?.lastUpdated || null,
      sections: (q.item || []).length,
      questions: numbered || questions,
      number: toolNumber(q),
      target: extValue(q, TARGET_EXT)?.valueString || "",
      minutes: extValue(q, MINUTES_EXT)?.valueInteger || null,
      archived: q.status === "retired",
      builtIn: TOOL_IDS.includes(q.id),
    };
  }

  /** Every AHIP form (archived ones too), in tool-number order. */
  async function allForms() {
    const [tagged, builtIn] = await Promise.all([
      fhir("GET", `/Questionnaire?identifier=${encodeURIComponent(TOOL_SYSTEM + "|")}&_count=200`),
      fhir("GET", `/Questionnaire?_id=${TOOL_IDS.join(",")}&_count=50`),
    ]);
    const byId = new Map();
    [...(builtIn?.entry || []), ...(tagged?.entry || [])].forEach((e) => byId.set(e.resource.id, e.resource));
    return [...byId.values()].filter(toolNumber).sort((a, b) => toolNumber(a) - toolNumber(b));
  }

  async function list() {
    return (await allForms()).map(summary);
  }

  const checkId = (id) => {
    if (!/^ahip-[a-z0-9-]{2,60}$/.test(String(id))) throw Object.assign(new Error("Unknown form."), { status: 404 });
  };

  /** Gives the built-in tools their urn:ahip:tool number (once), so every form is found the same way. */
  async function ensureRegistry() {
    const bundle = await fhir("GET", `/Questionnaire?_id=${TOOL_IDS.join(",")}&_count=50`);
    let updated = 0;
    for (const { resource: q } of bundle?.entry || []) {
      if ((q.identifier || []).some((i) => i.system === TOOL_SYSTEM)) continue;
      const clean = { ...q, identifier: [...(q.identifier || []), { system: TOOL_SYSTEM, value: String(TOOL_IDS.indexOf(q.id) + 1) }] };
      delete clean.meta;
      await fhir("PUT", `/Questionnaire/${encodeURIComponent(q.id)}`, clean);
      updated++;
    }
    return updated;
  }

  async function get(id) {
    checkId(id);
    return fhir("GET", `/Questionnaire/${encodeURIComponent(id)}`);
  }

  /** Problems that would break the form on the phone; empty when it can be published. */
  function validate(q, id) {
    const errors = [];
    if (q?.resourceType !== "Questionnaire") return ["This is not a form (Questionnaire)."];
    if (q.id !== id) errors.push("The form id does not match.");
    if (!String(q.title || "").trim()) errors.push("The form has no title.");
    if (!Array.isArray(q.item) || !q.item.length) errors.push("The form has no sections.");
    const byId = new Map();
    walk(q.item, (item) => {
      if (!item.linkId) errors.push(`A question has no name ("${(item.text || "").slice(0, 40)}").`);
      else if (byId.has(item.linkId)) errors.push(`Two questions use the name "${item.linkId}".`);
      byId.set(item.linkId, item);
      if (!ITEM_TYPES.has(item.type)) errors.push(`"${item.text || item.linkId}": unknown type "${item.type}".`);
      if (item.type !== "group" && item.type !== "display" && !String(item.text || "").trim()) errors.push(`Question "${item.linkId}" has no text.`);
      if ((item.type === "choice" || item.type === "open-choice") && !(item.answerOption || []).length)
        errors.push(`"${item.text || item.linkId}" has no answer options.`);
      if (item.type === "group" && !(item.item || []).length) errors.push(`Section / group "${item.text || item.linkId}" is empty.`);
      const codes = new Set();
      (item.answerOption || []).forEach((o) => {
        const code = o.valueCoding?.code;
        if (!code) errors.push(`"${item.text || item.linkId}" has an option without a value.`);
        else if (codes.has(code)) errors.push(`"${item.text || item.linkId}" has two options with the value "${code}".`);
        codes.add(code);
      });
    });
    walk(q.item, (item) => {
      (item.enableWhen || []).forEach((w) => {
        const target = byId.get(w.question);
        if (!target) errors.push(`"${item.text || item.linkId}" depends on a question that no longer exists ("${w.question}").`);
        else if (target === item) errors.push(`"${item.text || item.linkId}" cannot depend on its own answer.`);
        else if (w.answerCoding && !(target.answerOption || []).some((o) => o.valueCoding?.code === w.answerCoding.code))
          errors.push(`"${item.text || item.linkId}" depends on an option that no longer exists ("${w.answerCoding.code}" in "${target.text || target.linkId}").`);
      });
    });
    const quizExt = (q.extension || []).find((e) => e.url === "urn:ahip:quiz");
    if (quizExt) {
      let keys = 0;
      walk(q.item, (item) => { if ((item.extension || []).some((e) => e.url === "urn:ahip:quiz-key")) keys++; });
      if (!keys) errors.push("This form is a quiz but no question has an answer key yet (open a question and set its correct answer).");
    }
    for (const fixed of ["ahip-study", "ahip-assessment", "collection_mode"]) {
      if (!byId.has(fixed)) errors.push(`The fixed field "${fixed}" is missing; it is needed by the app.`);
    }
    for (const fixed of ["interview_recording", "photos"]) {
      if (!q.item?.some((p) => p.linkId === fixed)) errors.push(`The fixed page "${fixed}" is missing.`);
    }
    return [...new Set(errors)];
  }

  // Items of the first page that every new blank form keeps (the app and the dashboard use them).
  const BLANK_KEEP = new Set([
    "ahip-study", "ahip-assessment", "collection_mode", "region", "region_other", "council", "council_other",
    "gps", "interviewer", "collection_date",
  ]);
  const slugify = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/g, "");

  /**
   * Creates a new tool. "copy" duplicates an existing tool with all its questions; "blank" keeps
   * only the first page's standard fields (study, region, council, GPS...) and the recording and
   * photo pages, plus one empty section to start from.
   */
  async function create({ title, target, minutes, from, mode }, who) {
    title = String(title || "").replace(/\s+/g, " ").trim().slice(0, 120);
    if (title.length < 3) throw Object.assign(new Error("Give the new form a title (at least 3 characters)."), { status: 400 });
    const forms = await allForms();
    const source = forms.find((q) => q.id === from) || forms.find((q) => q.status !== "retired") || forms[0];
    if (!source) throw Object.assign(new Error("No form to start from."), { status: 400 });
    const number = Math.max(0, ...forms.map(toolNumber)) + 1;
    const id = `ahip-t${number}-${slugify(title) || "form"}`.slice(0, 60).replace(/-+$/, "");
    const q = JSON.parse(JSON.stringify(source));
    delete q.meta;
    delete q.url;
    delete q.version;
    q.id = id;
    q.name = id.replace(/-/g, "_");
    q.title = `Tool ${number}: ${title}`;
    q.status = "active";
    q.description = `${title}.`;
    q.identifier = [{ system: TOOL_SYSTEM, value: String(number) }];
    q.extension = (q.extension || []).filter((e) => e.url !== TARGET_EXT && e.url !== MINUTES_EXT);
    if (String(target || "").trim()) q.extension.push({ url: TARGET_EXT, valueString: String(target).trim().slice(0, 120) });
    const mins = Math.round(Number(minutes));
    if (mins > 0 && mins <= 600) q.extension.push({ url: MINUTES_EXT, valueInteger: mins });
    if (!q.extension.length) delete q.extension;
    if (mode !== "copy") {
      const first = q.item[0];
      first.text = "General information";
      first.item = (first.item || []).filter((i) => BLANK_KEEP.has(i.linkId));
      const fixed = q.item.filter((p) => X.SYSTEM_PAGES.has(p.linkId));
      const section = {
        linkId: "section_1",
        text: "Section 1",
        type: "group",
        extension: [{ url: "http://hl7.org/fhir/StructureDefinition/questionnaire-itemControl", valueCodeableConcept: { coding: [{ system: "http://hl7.org/fhir/questionnaire-item-control", code: "page" }] } }],
        item: [{ linkId: "question_1", prefix: "1.", text: "Untitled question", type: "string", required: true }],
      };
      q.item = [first, ...fixed.filter((p) => p.linkId !== "photos"), section, ...fixed.filter((p) => p.linkId === "photos")];
    }
    const errors = validate(q, id);
    if (errors.length) throw Object.assign(new Error(errors.join("\n")), { status: 400, errors });
    q.date = new Date().toISOString();
    const saved = await fhir("PUT", `/Questionnaire/${encodeURIComponent(id)}`, q);
    snapshot(saved, who, mode === "copy" ? `Created as a copy of ${source.title}` : "Created (blank)");
    return summary(saved);
  }

  /** Archived forms disappear from the phones at their next Sync; their submissions are kept. */
  async function setArchived(id, archived, who) {
    if (TOOL_IDS.includes(id) && archived) throw Object.assign(new Error("The six original tools cannot be archived."), { status: 400 });
    const q = await get(id);
    q.status = archived ? "retired" : "active";
    return publish(id, q, who, archived ? "Archived" : "Brought back from the archive");
  }

  function snapshot(q, who, note) {
    const dir = path.join(historyDir, q.id);
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.writeFileSync(path.join(dir, `${stamp}.json`), JSON.stringify({ savedAt: new Date().toISOString(), by: who, note, form: q }));
  }

  async function publish(id, q, who, note = "Published") {
    checkId(id);
    const errors = validate(q, id);
    if (errors.length) throw Object.assign(new Error(errors.join("\n")), { status: 400, errors });
    // Keep the version that was live, so it can be restored.
    try {
      snapshot(await get(id), who, "Before: " + note);
    } catch { /* first publish */ }
    const clean = { ...q };
    delete clean.meta;
    // Keep the tool number: phones and the dashboard find the form by it.
    const number = toolNumber(q) || toolNumber(await get(id).catch(() => null));
    if (!number) throw Object.assign(new Error("This form has no tool number."), { status: 400 });
    clean.identifier = [...(q.identifier || []).filter((i) => i.system !== TOOL_SYSTEM), { system: TOOL_SYSTEM, value: String(number) }];
    clean.status = clean.status || "active";
    clean.date = new Date().toISOString();
    const saved = await fhir("PUT", `/Questionnaire/${encodeURIComponent(id)}`, clean);
    return summary(saved);
  }

  function history(id) {
    checkId(id);
    const dir = path.join(historyDir, id);
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse()
      .slice(0, 50)
      .map((file) => {
        const entry = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
        return { file, savedAt: entry.savedAt, by: entry.by, note: entry.note, ...summary(entry.form) };
      });
  }

  async function restore(id, file, who) {
    checkId(id);
    if (!/^[\w-]+\.json$/.test(file)) throw Object.assign(new Error("Unknown version."), { status: 400 });
    const full = path.join(historyDir, id, file);
    if (!fs.existsSync(full)) throw Object.assign(new Error("Unknown version."), { status: 404 });
    const { form } = JSON.parse(fs.readFileSync(full, "utf8"));
    return publish(id, form, who, `Restored version of ${file.slice(0, 10)}`);
  }

  function fixedItems(q) {
    const known = new Map();
    const fixedPages = (q.item || []).filter((p, i) => i === 0 || X.SYSTEM_PAGES.has(p.linkId));
    walk(fixedPages, (item) => known.set(item.linkId, item));
    return known;
  }

  /** Converts an uploaded XLSForm and returns the resulting form (not yet published). */
  async function importExcel(id, buffer, mode) {
    const q = await get(id);
    const sheets = readWorkbook(buffer);
    const { sections, warnings } = X.xlsformToSections(sheets, { knownItems: fixedItems(q) });
    if (!sections.length) throw Object.assign(new Error("No questions were found in the Excel file."), { status: 400 });
    const merged = X.mergeSections(JSON.parse(JSON.stringify(q)), sections, mode === "append" ? "append" : "replace");
    return { form: merged, warnings, errors: validate(merged, id) };
  }

  async function exportExcel(id) {
    return writeWorkbook(X.sectionsToXlsform(await get(id)));
  }

  const template = () => writeWorkbook(X.templateWorkbook());

  // ---------------------------------------------------------------- CPP name list

  const CPP_TOOLS = ["ahip-t1-cpp-provider", "ahip-t3-exit-client", "ahip-t5-cpp-digital-sustainability"];
  const CPP_SYSTEM = "urn:ahip:cpp";
  const NEW_CPP = "New CPP (not in the list)";

  /** Every CPP name submitted so far (chosen from the list or typed as a new CPP). */
  async function submittedCppNames() {
    const names = new Map();
    let next = "/QuestionnaireResponse?status=completed&_count=200&_elements=item";
    for (let i = 0; next && i < 50; i++) {
      const bundle = await fhir("GET", next);
      (bundle.entry || []).forEach((e) => walk(e.resource?.item, (item) => {
        if (item.linkId !== "cpp_name" && item.linkId !== "cpp_name_other") return;
        (item.answer || []).forEach((a) => {
          const name = String(a.valueString ?? (a.valueCoding?.code === "other" ? "" : a.valueCoding?.display) ?? "").trim().replace(/\s+/g, " ");
          if (name && !names.has(name.toLowerCase())) names.set(name.toLowerCase(), name);
        });
      }));
      const link = (bundle.link || []).find((l) => l.relation === "next")?.url;
      next = link ? new URL(link).pathname.replace(/^.*?\/fhir/, "") + new URL(link).search : null;
    }
    return [...names.values()].sort((a, b) => a.localeCompare(b));
  }

  /**
   * Makes "Name of CPP" a dropdown of the CPPs already submitted, with "New CPP (not in the
   * list)" opening a box to type the name. Publishes only the tools whose list changed.
   */
  // Same JSON whatever the key order (the FHIR server returns fields in its own order).
  const canonical = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));

  async function refreshCppList(who = "AHIP Manage") {
    const names = await submittedCppNames();
    const changed = [];
    const withCpp = (await allForms()).filter((f) => f.status !== "retired" && JSON.stringify(f.item || []).includes('"linkId":"cpp_name"'));
    for (const id of new Set([...CPP_TOOLS, ...withCpp.map((f) => f.id)])) {
      const q = await get(id).catch(() => null);
      if (!q) continue;
      let parent = null;
      let item = null;
      walk(q.item, (i, p) => { if (i.linkId === "cpp_name") { item = i; parent = p; } });
      if (!item || !parent) continue;
      const before = canonical([item, (parent.item || []).find((i) => i.linkId === "cpp_name_other")]);
      const existing = new Map((item.answerOption || []).map((o) => [o.valueCoding?.display, o.valueCoding?.code]));
      const used = new Set();
      const code = (name) => {
        let c = existing.get(name) || X.slug(name);
        for (let n = 2; used.has(c) || c === "other"; n++) c = `${X.slug(name)}_${n}`;
        used.add(c);
        return c;
      };
      item.type = "choice";
      item.answerOption = [
        ...names.map((name) => ({ valueCoding: { system: CPP_SYSTEM, code: code(name), display: name } })),
        { valueCoding: { system: CPP_SYSTEM, code: "other", display: NEW_CPP } },
      ];
      item.extension = [
        { url: "http://hl7.org/fhir/StructureDefinition/questionnaire-itemControl", valueCodeableConcept: { coding: [{ system: "http://hl7.org/fhir/questionnaire-item-control", code: "drop-down" }] } },
      ];
      const typed = {
        linkId: "cpp_name_other",
        text: "Name of the new CPP",
        type: "string",
        required: !!item.required,
        enableWhen: [{ question: "cpp_name", operator: "=", answerCoding: { system: CPP_SYSTEM, code: "other" } }],
      };
      const at = parent.item.findIndex((i) => i.linkId === "cpp_name_other");
      if (at >= 0) parent.item[at] = typed;
      else parent.item.splice(parent.item.indexOf(item) + 1, 0, typed);
      if (canonical([item, typed]) !== before) {
        await publish(id, q, who, `CPP list updated (${names.length} CPPs)`);
        changed.push(id);
      }
    }
    return { cpps: names.length, updated: changed };
  }

  return { list, allForms, get, validate, publish, create, setArchived, ensureRegistry, history, restore, importExcel, exportExcel, template, refreshCppList, TOOL_IDS, TOOL_SYSTEM };
}

module.exports = { createForms };
