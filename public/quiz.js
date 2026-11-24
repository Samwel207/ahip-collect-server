// AHIP quizzes: one scoring rule for the Forms designer preview, the dashboard and the server.
// A quiz is a form with the extension urn:ahip:quiz ({"timeLimitMinutes": 20}); each scored question
// has urn:ahip:quiz-key ({"correct": ["code" | "value", ...], "points": 1}).
// The phone app scores the same way (AhipQuiz.kt).
(function (root) {
  "use strict";
  const QUIZ = "urn:ahip:quiz";
  const KEY = "urn:ahip:quiz-key";
  const SECONDS = "urn:ahip:quiz-seconds";
  const TIMED_OUT = "urn:ahip:quiz-timed-out";

  const parse = (s) => { try { return JSON.parse(s || "{}") || {}; } catch { return {}; } };
  const extOf = (x, url) => (x?.extension || []).find((e) => e.url === url);
  const settings = (q) => (extOf(q, QUIZ) ? { timeLimitMinutes: 0, ...parse(extOf(q, QUIZ).valueString) } : null);
  const keyOf = (item) => (extOf(item, KEY) ? { correct: [], points: 1, ...parse(extOf(item, KEY).valueString) } : null);

  /** linkId -> answer values (option codes, text, numbers) of a QuestionnaireResponse. */
  function answersOf(response) {
    const m = new Map();
    const walk = (items) => (items || []).forEach((i) => {
      (i.answer || []).forEach((a) => {
        const v = a.valueCoding ? a.valueCoding.code
          : a.valueString ?? a.valueInteger ?? a.valueDecimal ?? a.valueBoolean ?? a.valueDate ?? a.valueTime;
        if (v !== undefined) { if (!m.has(i.linkId)) m.set(i.linkId, []); m.get(i.linkId).push(v); }
        walk(a.item);
      });
      walk(i.item);
    });
    walk(response?.item);
    return m;
  }

  const norm = (s) => String(s).trim().toLowerCase().replace(/\s+/g, " ");

  /** Choice: exactly the correct option(s). Number: equal. Text: equal to one accepted answer (any case). */
  function isCorrect(item, key, given) {
    const correct = (key.correct || []).map(String).filter((c) => c !== "");
    const values = (given || []).filter((v) => v !== "" && v != null);
    if (!correct.length || !values.length) return false;
    if (item.type === "choice" || item.type === "open-choice") {
      const g = new Set(values.map(String));
      return g.size === correct.length && correct.every((c) => g.has(c));
    }
    if (item.type === "integer" || item.type === "decimal") return values.some((v) => correct.some((c) => Number(c) === Number(v)));
    return values.some((v) => correct.some((c) => norm(c) === norm(v)));
  }

  /** Score from a linkId -> values map; null when the form is not a quiz or has no answer key. */
  function scoreAnswers(questionnaire, answers) {
    const s = settings(questionnaire);
    if (!s || s.scored === false) return null; // a time limit alone is not a scored quiz
    let points = 0, total = 0, right = 0, count = 0;
    const walk = (items) => (items || []).forEach((i) => {
      const k = keyOf(i);
      if (k && (k.correct || []).length) {
        const p = Number(k.points) > 0 ? Number(k.points) : 1;
        total += p;
        count++;
        if (isCorrect(i, k, answers.get(i.linkId))) { points += p; right++; }
      }
      walk(i.item);
    });
    walk(questionnaire.item);
    if (!count) return null;
    return { points, total, right, count, percent: total ? Math.round((points / total) * 100) : 0 };
  }

  function score(questionnaire, response) {
    const result = scoreAnswers(questionnaire, answersOf(response));
    if (!result) return null;
    result.seconds = extOf(response, SECONDS)?.valueInteger ?? null;
    result.timedOut = extOf(response, TIMED_OUT)?.valueBoolean === true;
    return result;
  }

  const api = { QUIZ, KEY, SECONDS, TIMED_OUT, settings, keyOf, answersOf, isCorrect, scoreAnswers, score };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AHIP_QUIZ = api;
})(typeof window !== "undefined" ? window : globalThis);
