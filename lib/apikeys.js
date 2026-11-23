// Personal API keys: a data collector creates one in the phone app (after confirming their
// password) to share their OWN submitted data with other tools (Excel / Power BI, scripts).
// Only a hash of the key is stored; the key itself is shown once.
"use strict";

const crypto = require("crypto");
const http = require("http");
const https = require("https");

const COLLECTOR_TAG = "urn:ahip:data-collector";
const hash = (key) => crypto.createHash("sha256").update(key).digest("hex");

function createApiKeys({ fhirUrl }) {
  /** New key for the user (replaces any earlier one). Returns the key once. */
  function issue(user) {
    const key = `ahip_${crypto.randomBytes(24).toString("base64url")}`;
    user.apiKey = { hash: hash(key), hint: key.slice(-4), createdAt: new Date().toISOString(), lastUsedAt: null };
    return key;
  }

  const revoke = (user) => { user.apiKey = null; };

  function findUser(users, key) {
    if (!key || !/^ahip_[\w-]{20,}$/.test(key)) return null;
    const h = hash(key);
    return users.find((u) => u.apiKey && crypto.timingSafeEqual(Buffer.from(u.apiKey.hash), Buffer.from(h))) || null;
  }

  /** Key from "Authorization: Bearer …", "X-API-Key" or ?api_key=. */
  const keyFrom = (req, url) =>
    (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim() ||
    String(req.headers["x-api-key"] || "").trim() ||
    url.searchParams.get("api_key") || "";

  function fhirGet(path) {
    const target = new URL(fhirUrl.href.replace(/\/$/, "") + path);
    const lib = target.protocol === "https:" ? https : http;
    return new Promise((resolve, reject) => {
      lib.get(target, { headers: { Accept: "application/fhir+json" }, timeout: 60000 }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch (e) { reject(e); } });
      }).on("error", reject).on("timeout", function () { this.destroy(new Error("FHIR server timed out")); });
    });
  }

  async function fetchAll(path) {
    const out = [];
    let next = path;
    for (let i = 0; next && i < 50; i++) {
      const bundle = await fhirGet(next);
      (bundle.entry || []).forEach((e) => e.resource && out.push(e.resource));
      const link = (bundle.link || []).find((l) => l.relation === "next")?.url;
      next = link ? new URL(link).pathname.replace(/^.*?\/fhir/, "") + new URL(link).search : null;
    }
    return out;
  }

  const answerText = (a) => {
    if (a.valueCoding) return a.valueCoding.display || a.valueCoding.code;
    if (a.valueAttachment) return `[${a.valueAttachment.contentType || "file"}] ${a.valueAttachment.title || ""}`.trim();
    for (const k of ["valueString", "valueInteger", "valueDecimal", "valueDate", "valueDateTime", "valueTime", "valueBoolean"]) {
      if (a[k] !== undefined) return a[k];
    }
    return null;
  };

  /** The collector's own completed submissions, simplified (question text -> answer). */
  async function submissionsFor(username, { media = false } = {}) {
    const [forms, responses] = await Promise.all([
      fetchAll("/Questionnaire?identifier=urn%3Aahip%3Atool%7C&_count=200"),
      fetchAll(`/QuestionnaireResponse?status=completed&_tag=${encodeURIComponent(`${COLLECTOR_TAG}|${username}`)}&_count=200&_sort=-_lastUpdated`),
    ]);
    const formById = new Map(forms.map((f) => [`Questionnaire/${f.id}`, f]));
    return responses.map((r) => {
      const form = formById.get((r.questionnaire || "").split("|")[0]);
      const questions = new Map();
      const index = (items) => (items || []).forEach((i) => { questions.set(i.linkId, `${i.prefix ? i.prefix + " " : ""}${i.text || i.linkId}`); index(i.item); });
      index(form?.item);
      const answers = {};
      const files = [];
      const walk = (items) => (items || []).forEach((i) => {
        (i.answer || []).forEach((a) => {
          if (a.valueAttachment && media) files.push({ question: questions.get(i.linkId) || i.linkId, contentType: a.valueAttachment.contentType, title: a.valueAttachment.title, data: a.valueAttachment.data });
          const v = answerText(a);
          if (v !== null && !/^ahip-(study|assessment)$/.test(i.linkId)) {
            const label = questions.get(i.linkId) || i.linkId;
            answers[label] = answers[label] !== undefined ? `${answers[label]}; ${v}` : v;
          }
          walk(a.item);
        });
        walk(i.item);
      });
      walk(r.item);
      return {
        id: r.id,
        tool: form?.title || r.questionnaire,
        submitted: r.authored || r.meta?.lastUpdated,
        answers,
        ...(media ? { files } : {}),
      };
    });
  }

  function toCsv(rows) {
    const cols = ["id", "tool", "submitted", ...new Set(rows.flatMap((r) => Object.keys(r.answers)))];
    const cell = (v) => {
      const s = v === undefined || v === null ? "" : String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [cols.map(cell).join(","), ...rows.map((r) => cols.map((c) => cell(c in r ? r[c] : r.answers[c])).join(","))].join("\r\n");
  }

  return { issue, revoke, findUser, keyFrom, submissionsFor, toCsv };
}

module.exports = { createApiKeys };
