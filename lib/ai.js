// AHIP Manage AI assistant: answers questions about the submitted data (and helps design forms)
// with Google Gemini. The API key is read from the Android project's local.properties, mounted
// read-only into the container, and is never logged or sent to the browser.
//
// Privacy: the data sent to Gemini is a summary of the submissions. Photos, audio, GPS
// coordinates, phone numbers and interviewer names are left out.
"use strict";

const fs = require("fs");
const http = require("http");
const https = require("https");

const KEY_FILE = process.env.GEMINI_KEY_FILE || "/secrets/local.properties";
// Lite first: fast and within quota; the bigger model is used when the lite one is unavailable.
// More models = fewer "busy" errors: when one is overloaded the next one answers.
const DEFAULT_MODELS = ["gemini-flash-lite-latest", "gemini-flash-latest", "gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-3.5-flash-lite"];
const COOLDOWN_MS = { 404: 24 * 3600 * 1000, 429: 10 * 60 * 1000, 503: 60 * 1000 }; // missing, out of quota, busy
const DATA_CACHE_MS = 90 * 1000;
const cooldown = new Map();
const MAX_TEXT_ANSWERS = 40; // per open-ended question
const MAX_TEXT_LENGTH = 400;
const PRIVATE_IDS = new Set(["interviewer", "interviewee_phone", "gps", "gps_latitude", "gps_longitude", "ahip-study"]);

function readSettings() {
  let text = "";
  try { text = fs.readFileSync(KEY_FILE, "utf8"); } catch { /* not mounted */ }
  const value = (name) => (new RegExp(`^${name}=(.*)$`, "m").exec(text)?.[1] || process.env[name] || "").trim().replace(/^["']|["']$/g, "");
  const model = value("GEMINI_MODEL");
  return { key: value("GEMINI_API_KEY"), models: model ? [model, ...DEFAULT_MODELS.filter((m) => m !== model)] : DEFAULT_MODELS };
}

function createAi({ fhirUrl }) {
  function fhirGet(pathAndQuery) {
    const target = new URL(fhirUrl.href.replace(/\/$/, "") + pathAndQuery);
    const lib = target.protocol === "https:" ? https : http;
    return new Promise((resolve, reject) => {
      lib
        .get(target, { headers: { Accept: "application/fhir+json" }, timeout: 60000 }, (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch (e) { reject(e); }
          });
        })
        .on("error", reject)
        .on("timeout", function () { this.destroy(new Error("FHIR server timed out")); });
    });
  }

  async function fetchAll(path) {
    const out = [];
    let next = path;
    for (let page = 0; next && page < 50; page++) {
      const bundle = await fhirGet(next);
      (bundle.entry || []).forEach((e) => e.resource && out.push(e.resource));
      const link = (bundle.link || []).find((l) => l.relation === "next")?.url;
      next = link ? new URL(link).pathname.replace(/^.*?\/fhir/, "") + new URL(link).search : null;
    }
    return out;
  }

  // ---------------------------------------------------------------- data summary for the model

  const walk = (items, fn) => (items || []).forEach((i) => { fn(i); walk(i.item, fn); (i.answer || []).forEach((a) => walk(a.item, fn)); });

  function answerValue(a) {
    if (a.valueCoding) return a.valueCoding.display || a.valueCoding.code;
    for (const k of ["valueString", "valueInteger", "valueDecimal", "valueDate", "valueDateTime", "valueTime", "valueBoolean"]) {
      if (a[k] !== undefined) return a[k];
    }
    return null;
  }

  /** onlyIds: limit to these submissions (the dashboard view with its filters). */
  /** Forms and submissions, kept for DATA_CACHE_MS so follow-up questions are fast. */
  let cache = null;
  async function loadData() {
    if (cache && Date.now() - cache.at < DATA_CACHE_MS) return cache;
    const [forms, responses] = await Promise.all([
      fetchAll("/Questionnaire?identifier=urn%3Aahip%3Atool%7C&_count=200"),
      fetchAll("/QuestionnaireResponse?status=completed&_count=200"),
    ]);
    // Photos and recordings are never sent to the AI: drop them right away (saves memory).
    walk(responses.flatMap((r) => r.item || []), (i) => (i.answer || []).forEach((a) => { if (a.valueAttachment) a.valueAttachment = { contentType: a.valueAttachment.contentType }; }));
    cache = { at: Date.now(), forms, responses };
    return cache;
  }

  async function summarise(onlyIds = null) {
    const data = await loadData();
    const forms = data.forms;
    const responses = [...data.responses];
    if (onlyIds) {
      const keep = new Set(onlyIds);
      responses.splice(0, responses.length, ...responses.filter((r) => keep.has(r.id)));
    }
    const byForm = new Map(forms.map((f) => [`Questionnaire/${f.id}`, f]));
    const tools = [];
    for (const form of forms) {
      const own = responses.filter((r) => (r.questionnaire || "").split("|")[0] === `Questionnaire/${form.id}`);
      const questions = [];
      const meta = new Map();
      walk(form.item, (i) => meta.set(i.linkId, i));
      walk(form.item, (item) => {
        if (item.type === "group" || item.type === "display" || item.type === "attachment") return;
        if (PRIVATE_IDS.has(item.linkId) || (item.extension || []).some((e) => /regex$/.test(e.url))) return;
        if ((item.extension || []).some((e) => /questionnaire-hidden$/.test(e.url))) return;
        questions.push(item);
      });
      const stats = questions.map((q) => {
        const values = [];
        own.forEach((r) => walk(r.item, (ri) => {
          if (ri.linkId === q.linkId) (ri.answer || []).forEach((a) => { const v = answerValue(a); if (v !== null && v !== "") values.push(v); });
        }));
        const label = `${q.prefix ? q.prefix + " " : ""}${q.text}`;
        const answered = values.length;
        if (q.type === "choice" || q.type === "boolean") {
          const counts = {};
          values.forEach((v) => (counts[v] = (counts[v] || 0) + 1));
          return { q: label, type: q.repeats ? "select all" : "choice", answered, counts };
        }
        if (q.type === "integer" || q.type === "decimal") {
          const nums = values.map(Number).filter((n) => !isNaN(n));
          const sum = nums.reduce((a, b) => a + b, 0);
          return { q: label, type: "number", answered, min: Math.min(...nums), max: Math.max(...nums), mean: nums.length ? +(sum / nums.length).toFixed(2) : null, total: sum };
        }
        if (q.type === "string" || q.type === "text") {
          return { q: label, type: "text", answered, answers: values.slice(0, MAX_TEXT_ANSWERS).map((v) => String(v).slice(0, MAX_TEXT_LENGTH)) };
        }
        return { q: label, type: q.type, answered, examples: values.slice(0, 5) };
      }).filter((s) => s.answered > 0);
      const site = (r, id) => { let v = null; walk(r.item, (i) => { if (i.linkId === id && i.answer?.length) v = answerValue(i.answer[0]); }); return v; };
      tools.push({
        tool: form.title,
        submissions: own.length,
        recorded_as_audio: own.filter((r) => site(r, "collection_mode") === "Record the interview as audio" || site(r, "collection_mode") === "record_the_interview_as_audio").length,
        per_submission: own.map((r) => ({
          date: (r.authored || r.meta?.lastUpdated || "").slice(0, 10),
          collector: (r.meta?.tag || []).find((t) => t.system === "urn:ahip:data-collector")?.code || "unknown",
          region: site(r, "region"),
          council: site(r, "council"),
          site: site(r, "cpp_name_other") || site(r, "cpp_name") || site(r, "facility_name"),
        })),
        questions: stats,
      });
    }
    const unknown = responses.filter((r) => !byForm.has((r.questionnaire || "").split("|")[0])).length;
    return { generated: new Date().toISOString(), total_submissions: responses.length, other_forms_submissions: unknown, tools };
  }

  function formOutline(form) {
    const lines = [];
    const out = (items, depth) => (items || []).forEach((i) => {
      if (/_audio$|_hint$/.test(i.linkId)) return;
      const options = (i.answerOption || []).map((o) => o.valueCoding?.display).filter(Boolean);
      lines.push(`${"  ".repeat(depth)}- [${i.type}${i.repeats ? ", multi" : ""}${i.required ? ", required" : ""}] ${i.prefix || ""} ${i.text || ""}${options.length ? ` {${options.join(" | ")}}` : ""}`);
      out(i.item, depth + 1);
    });
    out(form.item, 0);
    return `Form "${form.title}" (${form.id}):\n${lines.join("\n")}`;
  }

  // ---------------------------------------------------------------- Gemini

  function gemini(model, key, body) {
    const payload = Buffer.from(JSON.stringify(body));
    return new Promise((resolve, reject) => {
      const req = https.request(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        { method: "POST", timeout: 90000, headers: { "Content-Type": "application/json", "Content-Length": payload.length, "x-goog-api-key": key } },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            let json = {};
            try { json = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* ignore */ }
            resolve({ status: res.statusCode, json });
          });
        },
      );
      req.on("timeout", () => req.destroy(new Error("The AI service took too long to answer.")));
      req.on("error", reject);
      req.write(payload);
      req.end();
    });
  }

  const status = () => {
    const { key, models } = readSettings();
    return { configured: !!key, model: models[0] };
  };

  /** Ids of a data collector's own completed submissions. */
  async function idsForCollector(username) {
    const rs = await fetchAll(`/QuestionnaireResponse?status=completed&_tag=${encodeURIComponent(`urn:ahip:data-collector|${username}`)}&_elements=id&_count=200`);
    return rs.map((r) => r.id);
  }

  async function ask({ question, history = [], page = "data", form = null, view = null, audience = "admin" }) {
    const { key, models } = readSettings();
    if (!key) throw Object.assign(new Error("The AI assistant is not set up: add GEMINI_API_KEY to android/local.properties."), { status: 503 });
    const text = String(question || "").trim().slice(0, 4000);
    if (!text) throw Object.assign(new Error("Type a question first."), { status: 400 });

    const ids = view && Array.isArray(view.ids) ? view.ids.map(String).slice(0, 20000) : null;
    const data = await summarise(ids);
    const system = [
      "You are the AHIP Manage assistant for the Afya-Tek Phase III study in Tanzania (AHIP Collect data collection: tools T1–T6 about community pharmaceutical premises (CPPs/ADDOs), health facilities and clients).",
      "Answer the administrator's question using ONLY the data summary below. Be concise and practical: start with the direct answer, then short bullet points, and a small table when comparing groups. Use numbers from the data and say how many submissions they are based on.",
      "If the data is too small or does not contain what is asked, say so plainly and suggest what to collect. Never invent numbers. Do not reveal or guess personal information.",
      "Data collection is in Tanzania; places are regions and councils (district councils). Write in the same language as the question (English or Swahili).",
      audience === "collector" ? "You are talking to a DATA COLLECTOR in the field on a phone, not an administrator. The data below is ONLY their own submissions. Help them check their own work: how many forms per tool and per day, which CPPs/sites they covered, missing or suspicious answers to fix, and what to do next. Keep answers short (under 150 words), simple, friendly, plain text with short bullet lines starting with '- '; no tables." : "",
      page === "forms" && form ? "The administrator is designing a form in AHIP Manage > Forms. When asked to suggest or improve questions, give ready-to-use question wording, the question type (short answer, paragraph, multiple choice, checkboxes, dropdown, Likert scale, grid, number, date, phone, photo, GPS, audio) and the answer options." : "",
      ids ? `The administrator is looking at a filtered view of the dashboard: ${String(view.description || "").slice(0, 300)}. The data below contains only those ${ids.length} submissions; say so when it matters.` : "",
      `DATA SUMMARY (JSON, generated ${data.generated}):\n${JSON.stringify(data)}`,
      page === "forms" && form ? `CURRENT FORM BEING EDITED:\n${formOutline(form)}` : "",
    ].filter(Boolean).join("\n\n");

    const contents = [
      ...history.slice(-8).map((m) => ({ role: m.role === "model" ? "model" : "user", parts: [{ text: String(m.text || "").slice(0, 4000) }] })),
      { role: "user", parts: [{ text }] },
    ];
    const body = { systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: { temperature: 0.3, maxOutputTokens: 1500 } };

    // Models that refused recently (quota 429, busy 503, missing 404) are skipped for a while,
    // so a question goes straight to a model that answers instead of waiting on retries.
    const now = Date.now();
    const ready = models.filter((m) => !(cooldown.get(m) > now));
    const first = ready.length ? ready : models;
    // Every model busy or the network failed: wait a moment and try all of them once more.
    const order = [...first, null, ...models.filter((m) => cooldown.get(m) !== Infinity)];
    let lastError = "The AI service is not available right now.";
    let triedAll = false;
    for (const model of order) {
      if (model === null) { triedAll = true; await new Promise((r) => setTimeout(r, 1500)); continue; }
      if (triedAll && cooldown.get(model) > Date.now() + 2 * 60 * 1000) continue; // out of quota: skip
      let result;
      try {
        result = await gemini(model, key, body);
      } catch (e) {
        lastError = e.message;
        continue;
      }
      if (result.status === 200) {
        const answer = (result.json.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
        if (answer) return { answer, model: result.json.modelVersion || model, submissions: data.total_submissions };
        lastError = "The AI service returned an empty answer.";
        continue;
      }
      lastError = result.json.error?.message || `AI service error ${result.status}`;
      if (result.status === 400 || result.status === 401 || result.status === 403) {
        throw Object.assign(new Error(result.status === 400 ? lastError : "The Gemini API key was refused. Check GEMINI_API_KEY in local.properties."), { status: 502 });
      }
      cooldown.set(model, Date.now() + (COOLDOWN_MS[result.status] || COOLDOWN_MS[503])); // try the next model now
    }
    throw Object.assign(new Error(/demand|overload|unavailable|EAI_AGAIN|ENOTFOUND|ECONN|timed out/i.test(lastError)
      ? "The AI is very busy or the internet is slow right now. Please try again in a minute."
      : lastError), { status: 503 });
  }

  return { ask, status, idsForCollector };
}

module.exports = { createAi };
