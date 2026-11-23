// XLSForm (Kobo / ODK Excel layout) <-> FHIR Questionnaire sections for AHIP tools.
//
// Only the "question sections" of a tool are imported / exported. The fixed parts of every tool
// (Section 1 identification, the interview recording page and the photos page) are kept as they
// are and edited in AHIP Manage > Forms.
"use strict";

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
const GRID = "urn:ahip:grid"; // marks a group shown as a table / grid of rows sharing one scale
const PHONE_REGEX = "^(\\+?255|0)[0-9]{9}$";

const SYSTEM_PAGES = new Set(["interview_recording", "photos"]);

const control = (code) => ({ url: ITEM_CONTROL, valueCodeableConcept: { coding: [{ system: CONTROL_SYS, code }] } });
const controlOf = (item) =>
  (item.extension || []).find((e) => e.url === ITEM_CONTROL)?.valueCodeableConcept?.coding?.[0]?.code;

const slug = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48)
    .replace(/_+$/g, "") || "item";

const isYes = (v) => /^(yes|true|1|y)$/i.test(String(v || "").trim());

// ---------------------------------------------------------------- import

/** Converts an XLSForm workbook (from readWorkbook) to question sections (FHIR page groups). */
/**
 * knownItems: linkId -> item of the fixed parts of the tool (Section 1 etc.), so imported names do
 * not clash with them and "relevant" rules may refer to them.
 */
function xlsformToSections(sheets, { knownItems = new Map() } = {}) {
  const warnings = [];
  const sheet = (name) => {
    const key = Object.keys(sheets).find((k) => k.trim().toLowerCase() === name);
    return key ? sheets[key] : null;
  };
  const survey = sheet("survey");
  if (!survey || !survey.length) throw new Error('The Excel file has no "survey" sheet.');
  const table = (rows) => {
    const header = (rows[0] || []).map((h) => String(h || "").trim().toLowerCase());
    const col = (...names) => {
      for (const n of names) {
        const exact = header.indexOf(n);
        if (exact >= 0) return exact;
        const prefixed = header.findIndex((h) => h.startsWith(n + "::"));
        if (prefixed >= 0) return prefixed;
      }
      return -1;
    };
    return { header, col, rows: rows.slice(1).map((r, i) => ({ cells: r, line: i + 2 })) };
  };

  const s = table(survey);
  const c = s.col;
  const iType = c("type");
  const iName = c("name");
  const iLabel = c("label");
  if (iType < 0 || iLabel < 0) throw new Error('The "survey" sheet needs at least the columns: type, name, label.');
  const iHint = c("hint");
  const iRequired = c("required");
  const iRelevant = c("relevant");
  const iAppearance = c("appearance");
  const iConstraint = c("constraint");
  const iNumber = c("number");
  const iAudio = c("audio");
  const iParameters = c("parameters");

  const choiceLists = new Map();
  const choices = sheet("choices");
  if (choices) {
    const t = table(choices);
    const iList = t.col("list_name", "list name");
    const iChoiceName = t.col("name");
    const iChoiceLabel = t.col("label");
    for (const { cells } of t.rows) {
      const list = String(cells[iList] || "").trim();
      if (!list) continue;
      const label = String(cells[iChoiceLabel] || "").trim();
      const name = String(cells[iChoiceName] || "").trim() || slug(label);
      if (!choiceLists.has(list)) choiceLists.set(list, []);
      choiceLists.get(list).push({ code: name, display: label || name });
    }
  }

  const ids = new Set(knownItems.keys());
  const uniqueId = (wanted, line) => {
    let id = slug(wanted);
    if (ids.has(id)) {
      let n = 2;
      while (ids.has(`${id}_${n}`)) n++;
      warnings.push(`Row ${line}: name "${wanted}" is already used, saved as "${id}_${n}".`);
      id = `${id}_${n}`;
    }
    ids.add(id);
    return id;
  };

  const sections = [];
  let current = null; // current section page
  const stack = []; // open nested groups (grid / field-list)
  const byName = new Map(); // xlsform name -> item (for relevant)
  const pendingRelevant = [];
  let autoNumber = 0;

  const container = () => (stack.length ? stack[stack.length - 1].item : ensureSection());
  function ensureSection() {
    if (!current) {
      current = newSection("Questions");
      sections.push(current);
    }
    return current.item ? current : current;
  }
  function newSection(title, name, line = 0) {
    return { linkId: uniqueId(name || `section_${slug(title)}`, line), text: title, type: "group", extension: [control("page")], item: [] };
  }

  for (const { cells, line } of s.rows) {
    const rawType = String(cells[iType] || "").trim();
    if (!rawType) continue;
    const [type, listName] = rawType.split(/\s+/);
    const name = String(cells[iName] || "").trim();
    const label = String(cells[iLabel] || "").trim();
    const appearance = String(cells[iAppearance] || "").trim().toLowerCase();
    const hint = iHint >= 0 ? String(cells[iHint] || "").trim() : "";
    const required = iRequired >= 0 && isYes(cells[iRequired]);
    const relevant = iRelevant >= 0 ? String(cells[iRelevant] || "").trim() : "";
    const number = iNumber >= 0 ? String(cells[iNumber] || "").trim() : "";

    if (type === "begin_group" || type === "begin group" || type === "begin_repeat" || type === "begin repeat") {
      if (type.includes("repeat")) warnings.push(`Row ${line}: repeat groups are not supported; the questions are added once.`);
      const isTable = /table-list|field-list|grid/.test(appearance);
      if (!stack.length && !isTable) {
        current = newSection(label || name || "Section", name, line);
        sections.push(current);
        stack.push({ item: current, section: true, line });
      } else {
        const group = { linkId: uniqueId(name || label, line), text: label, type: "group", item: [] };
        if (isTable) group.extension = [{ url: GRID, valueBoolean: true }];
        if (number) group.prefix = number.endsWith(".") ? number : `${number}.`;
        if (required) group.required = true;
        container().item.push(group);
        stack.push({ item: group, section: false, line });
        if (name) byName.set(name, group);
        if (relevant) pendingRelevant.push({ item: group, relevant, line });
      }
      continue;
    }
    if (type === "end_group" || type === "end group" || type === "end_repeat" || type === "end repeat") {
      const closed = stack.pop();
      if (closed?.section) current = null;
      continue;
    }

    const parent = container();
    const id = () => uniqueId(name || label, line);
    let items = [];
    const base = (fhirType) => {
      const item = { linkId: id(), text: label || name, type: fhirType };
      if (required) item.required = true;
      return item;
    };

    switch (type) {
      case "text": {
        const item = base(/multiline|multi-line/.test(appearance) ? "text" : "string");
        items.push(item);
        if (iAudio >= 0 && isYes(cells[iAudio])) items.push(audioItem(`${item.linkId}_audio`, "Audio recording of the answer (optional)", 5));
        break;
      }
      case "integer":
      case "decimal": {
        const item = base(type);
        const range = parseRange(iConstraint >= 0 ? cells[iConstraint] : "");
        item.extension = [];
        if (range.min != null) item.extension.push({ url: MIN_VALUE, [type === "integer" ? "valueInteger" : "valueDecimal"]: range.min });
        if (range.max != null) item.extension.push({ url: MAX_VALUE, [type === "integer" ? "valueInteger" : "valueDecimal"]: range.max });
        if (!item.extension.length) delete item.extension;
        items.push(item);
        break;
      }
      case "date":
      case "time":
      case "datetime":
      case "dateTime":
        items.push(base(type === "datetime" ? "dateTime" : type));
        break;
      case "phone":
      case "phonenumber_input": {
        const item = base("string");
        item.extension = [{ url: REGEX, valueString: PHONE_REGEX }];
        items.push(item);
        break;
      }
      case "select_one":
      case "select_multiple": {
        const list = choiceLists.get(listName || "");
        if (!list || !list.length) {
          warnings.push(`Row ${line}: choice list "${listName}" was not found in the "choices" sheet; question skipped.`);
          continue;
        }
        const item = base("choice");
        item.answerOption = list.map((o) => ({ valueCoding: { system: SYS, code: o.code, display: o.display } }));
        if (type === "select_multiple") {
          item.repeats = true;
          item.extension = [control("check-box")];
        } else {
          const dropdown = /minimal|autocomplete|dropdown/.test(appearance) || (list.length > 9 && !/likert/.test(appearance));
          item.extension = [control(dropdown ? "drop-down" : "radio-button")];
        }
        items.push(item);
        if (list.some((o) => o.code === "other")) {
          items.push({
            linkId: uniqueId(`${item.linkId}_other`, line),
            text: "Other — please specify",
            type: "string",
            enableWhen: [{ question: item.linkId, operator: "=", answerCoding: { system: SYS, code: "other" } }],
          });
        }
        break;
      }
      case "note":
        items.push({ linkId: id(), text: label, type: "display" });
        break;
      case "geopoint": {
        const linkId = id();
        const coord = (axis) => ({
          linkId: `${linkId}_${axis}`,
          text: axis === "latitude" ? "Latitude" : "Longitude",
          type: "decimal",
          extension: [{ url: GPS, valueString: axis }],
        });
        items.push({ linkId, text: label || "GPS reading", type: "group", extension: [control("location-widget")], item: [coord("latitude"), coord("longitude")] });
        break;
      }
      case "image":
      case "photo": {
        const item = base("attachment");
        item.extension = [
          { url: MIME_TYPE, valueCode: "image/jpeg" },
          { url: MIME_TYPE, valueCode: "image/png" },
          { url: MAX_SIZE, valueDecimal: 10 * 1024 * 1024 },
        ];
        items.push(item);
        break;
      }
      case "audio": {
        const minutes = Number(/max[-_]?minutes\s*=\s*(\d+)/i.exec(iParameters >= 0 ? cells[iParameters] : "")?.[1]) || 5;
        const item = audioItem(id(), label || "Audio recording", minutes);
        if (required) item.required = true;
        items.push(item);
        break;
      }
      case "calculate":
      case "hidden":
      case "start":
      case "end":
      case "today":
      case "deviceid":
      case "username":
      case "audit":
        warnings.push(`Row ${line}: "${type}" is not used by AHIP Collect and was skipped.`);
        continue;
      default:
        warnings.push(`Row ${line}: question type "${rawType}" is not supported; question skipped.`);
        continue;
    }

    const main = items[0];
    if (main.type !== "display" && main.type !== "group") {
      if (number) main.prefix = number.endsWith(".") ? number : `${number}.`;
    }
    if (hint) main.item = [...(main.item || []), { linkId: `${main.linkId}_hint`, text: hint, type: "display", extension: [control("flyover")] }];
    if (name) byName.set(name, main);
    if (relevant) pendingRelevant.push({ item: main, relevant, line, also: items.slice(1).filter((i) => i.type === "attachment") });
    parent.item.push(...items);
  }

  // relevant: ${q} = 'x', ${q} != 'x', selected(${q}, 'x'), combined with "and" / "or".
  for (const { item, relevant, line, also = [] } of pendingRelevant) {
    const parsed = parseRelevant(relevant, byName, knownItems);
    if (!parsed) {
      warnings.push(`Row ${line}: the "relevant" rule "${relevant}" is too complex; the question is always shown.`);
      continue;
    }
    for (const target of [item, ...also]) {
      target.enableWhen = parsed.conditions;
      if (parsed.conditions.length > 1) target.enableBehavior = parsed.behavior;
    }
  }

  // Number questions automatically when the sheet has no "number" column.
  if (iNumber < 0) {
    const walk = (list) =>
      list.forEach((it) => {
        if (it.type === "group" && controlOf(it) !== "location-widget" && !(it.extension || []).some((e) => e.url === GRID)) return walk(it.item || []);
        if (it.type === "group") {
          it.prefix = `${++autoNumber}.`;
          return;
        }
        if (it.type !== "display" && !/_other$|_audio$/.test(it.linkId)) it.prefix = `${++autoNumber}.`;
      });
    sections.forEach((sec) => walk(sec.item));
  }

  const empty = sections.filter((sec) => !sec.item.length);
  empty.forEach((sec) => warnings.push(`Section "${sec.text}" has no questions and was left out.`));
  return { sections: sections.filter((sec) => sec.item.length), warnings };
}

function audioItem(linkId, text, minutes) {
  return {
    linkId,
    text,
    type: "attachment",
    extension: [
      control("audio-recorder"),
      { url: MIME_TYPE, valueCode: "audio/mp4" },
      { url: MAX_SIZE, valueDecimal: Math.max(15, minutes) * 1024 * 1024 },
      { url: AUDIO_MAX, valueInteger: minutes },
    ],
  };
}

function parseRange(constraint) {
  const text = String(constraint || "");
  const min = /\.\s*>=?\s*(-?\d+(?:\.\d+)?)/.exec(text)?.[1];
  const max = /\.\s*<=?\s*(-?\d+(?:\.\d+)?)/.exec(text)?.[1];
  return { min: min != null ? Number(min) : null, max: max != null ? Number(max) : null };
}

function parseRelevant(expression, byName, knownItems = new Map()) {
  const text = expression.trim();
  const behavior = /\sor\s/i.test(text) ? "any" : "all";
  if (/\sor\s/i.test(text) && /\sand\s/i.test(text)) return null;
  const parts = text.split(/\s+(?:and|or)\s+/i);
  const conditions = [];
  for (const part of parts) {
    let m = /^\$\{([^}]+)\}\s*(!?=)\s*'([^']*)'$/.exec(part.trim()) || /^selected\(\s*\$\{([^}]+)\}\s*,\s*'([^']*)'\s*\)$/.exec(part.trim());
    if (!m) return null;
    const [question, operator, code] = m.length === 4 ? [m[1], m[2], m[3]] : [m[1], "=", m[2]];
    const target = byName.get(question) || knownItems.get(question);
    if (!target) return null;
    const system = (target.answerOption || []).find((o) => o.valueCoding?.code === code)?.valueCoding?.system || SYS;
    conditions.push({ question: target.linkId, operator, answerCoding: { system, code } });
  }
  return { conditions, behavior };
}

// ---------------------------------------------------------------- export

/** The editable question sections of a Questionnaire as an XLSForm workbook definition. */
function sectionsToXlsform(questionnaire) {
  const survey = [["type", "name", "label", "required", "relevant", "appearance", "hint", "number", "constraint", "audio", "parameters"]];
  const choiceRows = [["list_name", "name", "label"]];
  const lists = new Map();
  const byLinkId = new Map();
  const walkIndex = (items) => (items || []).forEach((i) => { byLinkId.set(i.linkId, i); walkIndex(i.item); });
  walkIndex(questionnaire.item);

  const listFor = (item) => {
    const key = JSON.stringify(item.answerOption.map((o) => [o.valueCoding?.code, o.valueCoding?.display]));
    if (!lists.has(key)) {
      const name = `list_${lists.size + 1}`;
      lists.set(key, name);
      item.answerOption.forEach((o) => choiceRows.push([name, o.valueCoding?.code || "", o.valueCoding?.display || ""]));
    }
    return lists.get(key);
  };
  const relevantOf = (item) =>
    (item.enableWhen || [])
      .map((w) => {
        const code = w.answerCoding?.code;
        if (code == null) return null;
        const target = byLinkId.get(w.question);
        return target?.repeats ? `selected(\${${w.question}}, '${code}')` : `\${${w.question}} ${w.operator === "!=" ? "!=" : "="} '${code}'`;
      })
      .filter(Boolean)
      .join(item.enableBehavior === "any" ? " or " : " and ");

  const row = (item, extra = {}) => {
    const hint = (item.item || []).find((c) => c.type === "display" && controlOf(c) === "flyover")?.text || "";
    const range = (item.extension || []).reduce((acc, e) => {
      if (e.url === MIN_VALUE) acc.push(`. >= ${e.valueInteger ?? e.valueDecimal}`);
      if (e.url === MAX_VALUE) acc.push(`. <= ${e.valueInteger ?? e.valueDecimal}`);
      return acc;
    }, []);
    return [
      extra.type,
      item.linkId,
      item.text || "",
      item.required ? "yes" : "",
      relevantOf(item),
      extra.appearance || "",
      hint,
      (item.prefix || "").replace(/\.$/, ""),
      range.join(" and "),
      extra.audio ? "yes" : "",
      extra.parameters || "",
    ];
  };

  const walk = (items) => {
    for (let i = 0; i < (items || []).length; i++) {
      const item = items[i];
      const ctl = controlOf(item);
      if (/_audio$/.test(item.linkId) || /_hint$/.test(item.linkId)) continue; // written with their question
      if (/_other$/.test(item.linkId) && item.enableWhen?.[0]?.answerCoding?.code === "other") continue; // re-created from "other"
      const hasAudio = items[i + 1]?.linkId === `${item.linkId}_audio`;
      switch (item.type) {
        case "group":
          if (ctl === "location-widget") survey.push(row(item, { type: "geopoint" }));
          else {
            const grid = (item.extension || []).some((e) => e.url === GRID);
            survey.push(row(item, { type: "begin_group", appearance: grid ? "table-list" : "field-list" }));
            walk(item.item);
            survey.push(["end_group", "", "", "", "", "", "", "", "", "", ""]);
          }
          break;
        case "choice":
          survey.push(row(item, {
            type: `${item.repeats ? "select_multiple" : "select_one"} ${listFor(item)}`,
            appearance: ctl === "drop-down" ? "minimal" : "",
          }));
          break;
        case "string": {
          const phone = (item.extension || []).some((e) => e.url === REGEX);
          survey.push(row(item, { type: phone ? "phone" : "text", audio: hasAudio }));
          break;
        }
        case "text":
          survey.push(row(item, { type: "text", appearance: "multiline", audio: hasAudio }));
          break;
        case "attachment":
          if (ctl === "audio-recorder") {
            const minutes = (item.extension || []).find((e) => e.url === AUDIO_MAX)?.valueInteger;
            survey.push(row(item, { type: "audio", parameters: minutes ? `max-minutes=${minutes}` : "" }));
          } else survey.push(row(item, { type: "image" }));
          break;
        case "display":
          survey.push(row(item, { type: "note" }));
          break;
        default:
          survey.push(row(item, { type: item.type === "dateTime" ? "datetime" : item.type }));
      }
    }
  };

  editableSections(questionnaire).forEach((page) => {
    survey.push(["begin_group", page.linkId, page.text || "", "", "", "", "", "", "", "", ""]);
    walk(page.item);
    survey.push(["end_group", "", "", "", "", "", "", "", "", "", ""]);
  });
  return {
    survey: { rows: survey, widths: [24, 26, 60, 10, 30, 14, 30, 8, 18, 8, 16] },
    choices: { rows: choiceRows, widths: [16, 26, 50] },
    guide: guideSheet(),
  };
}

/** Pages a designer may change; Section 1 (index 0), the interview page and photos are fixed. */
function editableSections(questionnaire) {
  return (questionnaire.item || []).filter((page, index) => index > 0 && !SYSTEM_PAGES.has(page.linkId));
}

/**
 * Replaces (or appends to) the editable sections of a Questionnaire with imported ones. The fixed
 * pages keep their place: Section 1, then the interview recording page, sections, photos last.
 */
function mergeSections(questionnaire, sections, mode) {
  const pages = questionnaire.item || [];
  const first = pages[0];
  const interview = pages.find((p) => p.linkId === "interview_recording");
  const photos = pages.find((p) => p.linkId === "photos");
  const current = editableSections(questionnaire);
  const middle = mode === "append" ? [...current, ...sections] : sections;
  questionnaire.item = [first, interview, ...middle, photos].filter(Boolean);
  return questionnaire;
}

// ---------------------------------------------------------------- template

function guideSheet() {
  const rows = [
    ["Topic", "How to"],
    ["1. Sheets", 'Fill the "survey" sheet (one row per question) and the "choices" sheet (answer options). Keep the column names in row 1.'],
    ["2. Sections", 'Start a section with type "begin_group" and its title in "label"; end it with "end_group". Each section becomes one page in the app.'],
    ["3. Question types", "text (short answer) · text + appearance multiline (paragraph) · integer · decimal · date · time · phone · select_one LIST (one answer) · select_multiple LIST (checkboxes) · note (instruction text) · geopoint (GPS) · image (photo) · audio (recording)."],
    ["4. Answer options", 'For select_one / select_multiple write the list name after a space, e.g. "select_one yes_no", and put the options in "choices" with the same list_name. A choice named "other" adds an "Other — please specify" box.'],
    ["5. Dropdown / Likert", 'appearance "minimal" shows a dropdown. For a Likert scale use select_one with a list such as agree5 (1 Strongly disagree … 5 Strongly agree).'],
    ["6. Table / grid", 'Put several select_one questions that share one list between "begin_group" (appearance "table-list") and "end_group": they show as one table of rows with the same scale.'],
    ["7. Required", 'Write "yes" in "required" for questions that must be answered.'],
    ["8. Show only if", "relevant: ${question_name} = 'option_name' (or !=), or selected(${question_name}, 'option_name') for checkboxes. Combine with and / or."],
    ["9. Numbers", 'Optional "number" column (e.g. 12) shows "12." before the question. Leave the column out to number questions automatically.'],
    ["10. Extras", 'audio = yes adds a voice recorder under a text question. For type audio, parameters "max-minutes=10" sets the longest recording. constraint ". >= 0 and . <= 100" limits numbers.'],
    ["11. Upload", "AHIP Manage > Forms > choose the tool > Upload Excel. Check the preview, then Publish. Phones get the new questions at their next Sync."],
    ["Fixed parts", "Section 1 (site, region, council, GPS, interviewer), the interview recording page and the photos page are part of every tool and are not in this file. Edit Section 1 in AHIP Manage."],
  ];
  return { rows, widths: [20, 120] };
}

function templateWorkbook() {
  const survey = [
    ["type", "name", "label", "required", "relevant", "appearance", "hint", "number", "constraint", "audio", "parameters"],
    ["begin_group", "services", "Section 2: Services and Screening"],
    ["select_one yes_no", "screening", "Does this CPP provide any health screening services?", "yes", "", "", "", "1"],
    ["select_multiple services", "screening_types", "Which screening services are provided? (Select all that apply)", "yes", "${screening} = 'yes'", "", "", "2"],
    ["integer", "referrals_30d", "How many clients were referred in the last 30 days?", "yes", "", "", "Count all referrals, written or verbal", "3", ". >= 0 and . <= 10000"],
    ["select_one method", "referral_method", "What method is mainly used to refer clients?", "yes", "", "minimal", "", "4"],
    ["text", "challenges", "What are the main challenges you face? (open-ended)", "", "", "multiline", "", "5", "", "yes"],
    ["date", "last_training", "Date of last training", "", "", "", "", "6"],
    ["end_group"],
    ["begin_group", "readiness", "Section 3: Digital Readiness"],
    ["note", "scale_note", "Rate each statement: 1 = Strongly disagree … 5 = Strongly agree."],
    ["begin_group", "readiness_grid", "Readiness statements", "", "", "table-list"],
    ["select_one agree5", "willing", "I am willing to use the platform.", "yes", "", "", "", "7"],
    ["select_one agree5", "confident", "I am confident I can learn the platform.", "yes", "", "", "", "8"],
    ["end_group"],
    ["phone", "contact_phone", "Phone number of the respondent (+255)", "", "", "", "", "9"],
    ["audio", "comments_audio", "Record any extra comments (optional)", "", "", "", "", "", "", "", "max-minutes=5"],
    ["end_group"],
  ];
  const choices = [
    ["list_name", "name", "label"],
    ["yes_no", "yes", "Yes"],
    ["yes_no", "no", "No"],
    ["services", "tb", "TB symptom screening"],
    ["services", "hiv", "HIV risk assessment"],
    ["services", "ncd", "NCDs screening"],
    ["services", "other", "Other (specify)"],
    ["method", "written", "Written referral note"],
    ["method", "phone", "Phone call"],
    ["method", "digital", "Digital platform"],
    ["agree5", "1", "1 - Strongly disagree"],
    ["agree5", "2", "2 - Disagree"],
    ["agree5", "3", "3 - Neutral"],
    ["agree5", "4", "4 - Agree"],
    ["agree5", "5", "5 - Strongly agree"],
  ];
  return {
    survey: { rows: survey, widths: [24, 20, 60, 10, 26, 14, 30, 8, 22, 8, 16] },
    choices: { rows: choices, widths: [16, 16, 40] },
    guide: guideSheet(),
  };
}

module.exports = { xlsformToSections, sectionsToXlsform, mergeSections, editableSections, templateWorkbook, slug, SYSTEM_PAGES, GRID };
