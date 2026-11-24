// "Translate questions" in the phone app and AHIP Collect Web: the texts of a form in Kiswahili
// (or English), made once with Gemini and kept in DATA_DIR/translations so every collector gets
// them instantly afterwards (and the AI quota is not used again). Only form texts are sent to
// Gemini, never answers.
"use strict";

const fs = require("fs");
const path = require("path");

const LANGS = { sw: "Kiswahili (Swahili, as used in Tanzania)", en: "English" };
const BATCH = 40; // texts per Gemini request
const PARALLEL = 4; // requests at the same time

function createTranslator({ ai, dataDir, getForm }) {
  const dir = path.join(dataDir, "translations");
  const memory = {}; // lang -> { source text -> translation }

  function load(lang) {
    if (memory[lang]) return memory[lang];
    try { memory[lang] = JSON.parse(fs.readFileSync(path.join(dir, `${lang}.json`), "utf8")) || {}; } catch { memory[lang] = {}; }
    return memory[lang];
  }

  function save(lang) {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${lang}.json`);
    fs.writeFileSync(file + ".tmp", JSON.stringify(memory[lang], null, 1));
    fs.renameSync(file + ".tmp", file);
  }

  /** Question texts (and answer options) of a form, as { linkId, text, options: [{code, text}] }. */
  function textsOf(form) {
    const out = [];
    const walk = (items) => (items || []).forEach((i) => {
      const options = (i.answerOption || [])
        .map((o) => o.valueCoding ? { code: o.valueCoding.code, text: o.valueCoding.display || o.valueCoding.code } : o.valueString ? { code: o.valueString, text: o.valueString } : null)
        .filter((o) => o && o.text);
      if ((i.text && i.text.trim()) || options.length) out.push({ linkId: i.linkId, text: (i.text || "").trim(), options });
      walk(i.item);
    });
    walk(form.item);
    return out;
  }

  async function translateMissing(lang, sources, allowed) {
    const mem = load(lang);
    const todo = [...new Set(sources)].filter((s) => s && mem[s] === undefined);
    if (!todo.length) return;
    if (!allowed()) throw Object.assign(new Error("Too many translations in a short time. Wait a few minutes and try again."), { status: 429 });
    const chunks = [];
    for (let start = 0; start < todo.length; start += BATCH) chunks.push(todo.slice(start, start + BATCH));
    const system = [
      `Translate each text of a health research questionnaire (Afya-Tek study, Tanzania: community pharmacies (ADDO/CPP), health facilities, clients) into ${LANGS[lang]}.`,
      "Keep the meaning exact and the wording short and natural for a field interviewer. Keep numbers, units, codes, place names, brand names and abbreviations (CPP, ADDO, AHIP, TZS) unchanged.",
      "The input is a JSON object of numbered texts. Answer with JSON only: an object with the same keys, each value the translated text.",
    ].join("\n");
    let failed = 0;
    const one = async (chunk) => {
      try {
        const { answer } = await ai.generate({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: JSON.stringify(Object.fromEntries(chunk.map((t, n) => [String(n), t]))) }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 16384, responseMimeType: "application/json" },
        });
        let out = null;
        try { out = JSON.parse(answer.replace(/^```(json)?|```$/g, "").trim()); } catch { /* incomplete */ }
        chunk.forEach((t, n) => {
          const v = out && typeof out === "object" ? out[String(n)] : null;
          if (typeof v === "string" && v.trim()) mem[t] = v.trim(); else failed++;
        });
      } catch (e) {
        failed += chunk.length;
        if (e.status === 502) throw e; // the key was refused
      }
    };
    // A few requests at a time: faster for long forms, gentle on the quota.
    for (let n = 0; n < chunks.length; n += PARALLEL) await Promise.all(chunks.slice(n, n + PARALLEL).map(one));
    save(lang);
    if (failed === todo.length) throw Object.assign(new Error("The AI translator is busy or offline. Please try again in a minute."), { status: 503 });
  }

  /** { lang, texts: { linkId: text }, options: { linkId: { code: text } } } for one form. */
  async function forForm(formId, lang, allowed = () => true) {
    if (!LANGS[lang]) throw Object.assign(new Error("Choose Kiswahili (sw) or English (en)."), { status: 400 });
    if (!/^[A-Za-z0-9.-]{1,64}$/.test(formId || "")) throw Object.assign(new Error("Unknown form."), { status: 400 });
    const form = await getForm(formId).catch(() => null);
    if (!form) throw Object.assign(new Error("Unknown form."), { status: 404 });
    const items = textsOf(form);
    await translateMissing(lang, items.flatMap((i) => [i.text, ...i.options.map((o) => o.text)]), allowed);
    const mem = load(lang);
    const texts = {};
    const options = {};
    items.forEach((i) => {
      if (i.text) texts[i.linkId] = mem[i.text] || i.text;
      if (i.options.length) options[i.linkId] = Object.fromEntries(i.options.map((o) => [o.code, mem[o.text] || o.text]));
    });
    const missing = items.some((i) => (i.text && mem[i.text] === undefined) || i.options.some((o) => mem[o.text] === undefined));
    return { lang, formId, version: form.meta?.versionId || null, complete: !missing, texts, options };
  }

  return { forForm };
}

module.exports = { createTranslator };
