// AHIP Collect Web settings, and the "photo / voice note on chosen questions" extras.
// The phone app adds exactly the same extra questions (AhipQuestionExtras.kt), so the data looks the
// same on the server whichever app collected it:
//   <linkId>__photo      attachment (photo) for that question
//   <linkId>__audio      attachment (voice note, up to 5 minutes)
//   <linkId>__rec_label  short text: what the voice note is about
// Each extra carries the extension urn:ahip:extra-for = <linkId> and the question's own conditions.
(function (root) {
  "use strict";
  const EXTRA_FOR = "urn:ahip:extra-for";
  const ITEM_CONTROL = "http://hl7.org/fhir/StructureDefinition/questionnaire-itemControl";
  const HIDDEN = "http://hl7.org/fhir/StructureDefinition/questionnaire-hidden";
  const MIME = "http://hl7.org/fhir/StructureDefinition/mimeType";
  const MAX_SIZE = "http://hl7.org/fhir/StructureDefinition/maxSize";
  const AUDIO_MAX = "https://smartregister.org/audio-max-duration-minutes";
  const FIXED = new Set(["ahip-study", "ahip-assessment"]);

  const ext = (x, url) => (x?.extension || []).find((e) => e.url === url);
  const control = (i) => ext(i, ITEM_CONTROL)?.valueCodeableConcept?.coding?.[0]?.code;
  const extraFor = (i) => ext(i, EXTRA_FOR)?.valueString || null;
  const isSpecialGroup = (i) => i.type === "group" && !!(ext(i, "urn:ahip:grid") || ext(i, "urn:ahip:table"));

  const defaults = () => ({ theme: "system", translate: false, lang: "sw", extras: {} });
  const key = (user) => `ahip_web_settings:${user || "-"}`;

  function applyTheme(theme) {
    try { localStorage.setItem("ahip_web_theme", theme); } catch { /* blocked */ }
    const dark = theme === "dark" || (theme === "system" && root.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", dark ? "#18276f" : "#14246b");
  }

  function load(user) {
    let s = defaults();
    try { s = { ...s, ...JSON.parse(localStorage.getItem(key(user)) || "{}") }; } catch { /* default */ }
    if (!s.extras || typeof s.extras !== "object") s.extras = {};
    applyTheme(s.theme);
    return s;
  }

  function save(user, s) {
    try { localStorage.setItem(key(user), JSON.stringify(s)); } catch { /* blocked */ }
    applyTheme(s.theme);
  }

  if (root.matchMedia) {
    matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
      let t = "system";
      try { t = localStorage.getItem("ahip_web_theme") || "system"; } catch { /* blocked */ }
      if (t === "system") applyTheme("system");
    });
  }

  /** Questions that can get a photo / voice note, with their section (page) title. */
  function questions(form) {
    const out = [];
    const walk = (items, section) => (items || []).forEach((i) => {
      if (extraFor(i) || ext(i, HIDDEN)?.valueBoolean === true || FIXED.has(i.linkId)) return;
      if (i.type === "group") {
        if (control(i) === "location-widget") return;
        if (isSpecialGroup(i)) return out.push({ linkId: i.linkId, text: i.text || i.linkId, prefix: i.prefix || "", section });
        return walk(i.item, section);
      }
      if (i.type === "display" || i.type === "attachment") return;
      out.push({ linkId: i.linkId, text: i.text || i.linkId, prefix: i.prefix || "", section });
    });
    (form.item || []).forEach((page) => (page.type === "group" ? walk(page.item, page.text || "") : walk([page], "")));
    return out;
  }

  const short = (t) => { const s = String(t || "").replace(/\s+/g, " ").trim(); return s.length > 70 ? `${s.slice(0, 69)}…` : s; };

  function extrasFor(item, { photo, voice }) {
    const mark = { url: EXTRA_FOR, valueString: item.linkId };
    const when = item.enableWhen ? { enableWhen: JSON.parse(JSON.stringify(item.enableWhen)), ...(item.enableBehavior ? { enableBehavior: item.enableBehavior } : {}) } : {};
    const label = short(`${item.prefix ? item.prefix + " " : ""}${item.text || item.linkId}`);
    const out = [];
    if (photo) {
      out.push({
        linkId: `${item.linkId}__photo`, type: "attachment", text: `📷 Photo: ${label}`, ...when,
        extension: [mark, { url: MIME, valueCode: "image/jpeg" }, { url: MIME, valueCode: "image/png" }, { url: MAX_SIZE, valueDecimal: 10485760 }],
      });
    }
    if (voice) {
      out.push({
        linkId: `${item.linkId}__audio`, type: "attachment", text: `🎤 Voice note: ${label}`, ...when,
        extension: [mark,
          { url: ITEM_CONTROL, valueCodeableConcept: { coding: [{ system: "http://hl7.org/fhir/questionnaire-item-control", code: "audio-recorder" }] } },
          { url: MIME, valueCode: "audio/mp4" }, { url: MAX_SIZE, valueDecimal: 15728640 }, { url: AUDIO_MAX, valueInteger: 5 }],
      });
      out.push({ linkId: `${item.linkId}__rec_label`, type: "string", text: "Label for the voice note (short text)", maxLength: 80, ...when, extension: [mark] });
    }
    return out;
  }

  /**
   * The form with the extras chosen in Settings, plus any extras a draft already has answers for
   * (so a draft never loses a photo or voice note when the setting is changed later).
   */
  function apply(form, settings, answers) {
    const chosen = (settings?.extras || {})[form.id] || {};
    const has = (id) => !!answers && typeof answers.get === "function" && (answers.get(id) || []).length > 0;
    const want = (i) => ({
      photo: !!chosen[i.linkId]?.photo || has(`${i.linkId}__photo`),
      voice: !!chosen[i.linkId]?.voice || has(`${i.linkId}__audio`) || has(`${i.linkId}__rec_label`),
    });
    const eligible = new Set(questions(form).map((q) => q.linkId));
    let changed = false;
    const copy = JSON.parse(JSON.stringify(form));
    const walk = (items) => {
      for (let n = 0; n < items.length; n++) {
        const i = items[n];
        if (i.item && !isSpecialGroup(i)) walk(i.item);
        if (!eligible.has(i.linkId)) continue;
        const w = want(i);
        if (!w.photo && !w.voice) continue;
        const add = extrasFor(i, w).filter((x) => !items.some((y) => y.linkId === x.linkId));
        items.splice(n + 1, 0, ...add);
        n += add.length;
        changed = changed || add.length > 0;
      }
    };
    walk(copy.item || []);
    return changed ? copy : form;
  }

  root.AHIP_EXTRAS = { EXTRA_FOR, defaults, load, save, applyTheme, questions, apply, extraFor };
})(window);
