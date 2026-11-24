// AHIP Collect Web: the AHIP Collect Android app in the browser (iPhone and any phone), screen by
// screen: welcome, sign in, study, assessment, tools (+ drafts), tool details, the form, review,
// submitted, My Assessment Summary with the AI assistant, Share my data. Same forms (from AHIP
// Manage), same answers format; drafts and unsent submissions stay on the phone (IndexedDB).
"use strict";

(() => {
  // ---------------------------------------------------------------- constants
  const ITEM_CONTROL = "http://hl7.org/fhir/StructureDefinition/questionnaire-itemControl";
  const HIDDEN = "http://hl7.org/fhir/StructureDefinition/questionnaire-hidden";
  const MIN_VALUE = "http://hl7.org/fhir/StructureDefinition/minValue";
  const MAX_VALUE = "http://hl7.org/fhir/StructureDefinition/maxValue";
  const REGEX = "http://hl7.org/fhir/StructureDefinition/regex";
  const MIME_TYPE = "http://hl7.org/fhir/StructureDefinition/mimeType";
  const SLIDER_STEP = "http://hl7.org/fhir/StructureDefinition/questionnaire-sliderStepValue";
  const GPS = "https://github.com/google/android-fhir/StructureDefinition/gps-coordinate";
  const AUDIO_MAX = "https://smartregister.org/audio-max-duration-minutes";
  const ALLOW_INCOMPLETE = "https://smartregister.org/allow-incomplete-submission-when";
  const GRID = "urn:ahip:grid";
  const TABLE = "urn:ahip:table";
  const LINEAR = "urn:ahip:linear-scale";
  const TOOL_SYSTEM = "urn:ahip:tool";
  const TARGET_EXT = "urn:ahip:tool-target";
  const MINUTES_EXT = "urn:ahip:tool-minutes";
  const SITE_IDS = ["cpp_name_other", "cpp_name", "facility_name", "council_other", "council"];
  const Q = window.AHIP_QUIZ;

  const STUDIES = [
    { id: "afya-tek-phase-3", title: "Afya-Tek Phase III", sub: "AHIP Baseline" },
    { id: "other-studies", title: "Other Studies", sub: "e.g. Midline, Endline", soon: true },
  ];
  const ASSESSMENTS = [
    { id: "baseline-2025", title: "Baseline Assessment", period: "2025" },
    { id: "midline-2026", title: "Midline Assessment", period: "2026", soon: true },
    { id: "endline-2027", title: "Endline Assessment", period: "2027", soon: true },
    { id: "rapid-adhoc", title: "Rapid Assessment", period: "Ad-hoc", soon: true },
  ];
  // The six original tools, as in the app's AhipCatalog (target, minutes, icon).
  const BUILT_IN = {
    "ahip-t1-cpp-provider": ["CPP providers (ADDOs / pharmacies)", 25, "store"],
    "ahip-t2-healthcare-worker": ["Healthcare workers at health facilities", 25, "hospital"],
    "ahip-t3-exit-client": ["Clients leaving a CPP", 15, "groups"],
    "ahip-t4-routine-indicators": ["Council routine (HMIS) data", 30, "assessment"],
    "ahip-t5-cpp-digital-sustainability": ["CPPs in Kibaha", 30, "computer"],
    "ahip-t6-facility-digital-sustainability": ["Health facilities in Kibaha", 20, "settings"],
  };
  const AI_QUICK = ["Summarise my work", "What should I check or fix?", "My progress this week", "What should I do next?"];

  // Material icons (24 px paths) used by the app.
  const ICONS = {
    back: "M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z",
    forward: "M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z",
    menu: "M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z",
    close: "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
    check: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z",
    folder: "M9.17 6l2 2H20v10H4V6h5.17M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z",
    chevron: "M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z",
    store: "M18.36 9l.6 3H5.04l.6-3h12.72M20 4H4v2h16V4zm0 3H4l-1 5v2h1v6h10v-6h4v6h2v-6h1v-2l-1-5zM6 18v-4h6v4H6z",
    hospital: "M19 3H5c-1.1 0-1.99.9-1.99 2L3 19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zm-5.5-2h-3v-3.5H7v-3h3.5V7h3v3.5H17v3h-3.5z",
    groups: "M12 12.75c1.63 0 3.07.39 4.24.9 1.08.48 1.76 1.56 1.76 2.73V18H6v-1.61c0-1.18.68-2.26 1.76-2.73 1.17-.52 2.61-.91 4.24-.91zM4 13c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm1.13 1.1c-.37-.06-.74-.1-1.13-.1-.99 0-1.93.21-2.78.58A2.01 2.01 0 0 0 0 16.43V18h4.5v-1.61c0-.83.23-1.61.63-2.29zM20 13c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm4 3.43c0-.81-.48-1.53-1.22-1.85A6.95 6.95 0 0 0 20 14c-.39 0-.76.04-1.13.1.4.68.63 1.46.63 2.29V18H24v-1.57zM12 6c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3z",
    assessment: "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zM7 10h2v7H7zm4-3h2v10h-2zm4 6h2v4h-2z",
    computer: "M20 18c1.1 0 1.99-.9 1.99-2L22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z",
    settings: "M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z",
    description: "M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z",
    help: "M11 18h2v-2h-2v2zm1-16C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-2.21 0-4 1.79-4 4h2c0-1.1.9-2 2-2s2 .9 2 2c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5 0-2.21-1.79-4-4-4z",
    schedule: "M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z",
    upload: "M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z",
    cloudDone: "M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM10 17l-3.5-3.5 1.41-1.41L10 14.17 15.18 9l1.41 1.41L10 17z",
    cloud: "M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM19 18H6c-2.21 0-4-1.79-4-4 0-2.05 1.53-3.76 3.56-3.97l1.07-.11.5-.95C8.08 7.14 9.94 6 12 6c2.62 0 4.88 1.86 5.39 4.43l.3 1.5 1.53.11c1.56.1 2.78 1.41 2.78 2.96 0 1.65-1.35 3-3 3z",
    clipboard: "M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm2 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z",
    today: "M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM7 10h5v5H7z",
    week: "M9 11H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm2-7h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z",
    insights: "M21 8c-1.45 0-2.26 1.44-1.93 2.51l-3.55 3.56c-.3-.09-.74-.09-1.04 0l-2.55-2.55C12.27 10.45 11.46 9 10 9c-1.45 0-2.27 1.44-1.93 2.52l-4.56 4.55C2.44 15.74 1 16.55 1 18c0 1.1.9 2 2 2 1.45 0 2.26-1.44 1.93-2.51l4.55-4.56c.3.09.74.09 1.04 0l2.55 2.55C12.73 16.55 13.54 18 15 18c1.45 0 2.27-1.44 1.93-2.52l3.56-3.55c1.07.33 2.51-.48 2.51-1.93 0-1.1-.9-2-2-2zM15 9l.94-2.07L18 6l-2.06-.93L15 3l-.92 2.07L12 6l2.08.93zM3.5 11L4 9l2-.5L4 8l-.5-2L3 8l-2 .5L3 9z",
    edit: "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 0 0 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z",
    person: "M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z",
    lock: "M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z",
    eye: "M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z",
    eyeOff: "M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46A11.8 11.8 0 0 0 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z",
    error: "M11 15h2v2h-2zm0-8h2v6h-2zm.99-5C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z",
    camera: "M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM9 2L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z",
    mic: "M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z",
    place: "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 0 1 0-5 2.5 2.5 0 0 1 0 5z",
    stop: "M6 6h12v12H6z",
    sparkle: "M19 9l1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12l-5.5-2.5zM19 15l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25L19 15z",
  };
  const SVG_NS = "http://www.w3.org/2000/svg";
  function icon(name, cls = "") {
    const s = document.createElementNS(SVG_NS, "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("class", `i ${cls}`.trim());
    s.setAttribute("aria-hidden", "true");
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", ICONS[name] || ICONS.description);
    s.append(p);
    return s;
  }

  const $app = document.getElementById("app");
  const state = {
    user: null, server: location.host, forms: [], study: null, assessment: null,
    screen: "loading", tool: null, fill: null, drafts: {}, outbox: [], done: null, review: null,
    mine: null, mineOffline: false, chat: [], syncing: false, syncStatus: null,
  };
  let timer = null;
  let recorder = null;

  // ---------------------------------------------------------------- helpers
  const ext = (x, url) => (x?.extension || []).find((e) => e.url === url);
  const control = (i) => ext(i, ITEM_CONTROL)?.valueCodeableConcept?.coding?.[0]?.code;
  const isHidden = (i) => ext(i, HIDDEN)?.valueBoolean === true;
  const isFlyover = (i) => i.type === "display" && control(i) === "flyover";
  const hintOf = (i) => (i.item || []).filter(isFlyover).map((c) => c.text).join(" ");
  const toolNumber = (q) => Number((q.identifier || []).find((x) => x.system === TOOL_SYSTEM)?.value) || 0;
  const toolTitle = (q) => String(q.title || q.id).replace(/^Tool\s*\d+\s*[:.-]\s*/i, "");
  const fmtClock = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  const fmtWhen = (iso) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "");
  const fmtSaved = (iso) => (iso ? new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "–");
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const uuid = () => {
    const b = crypto.getRandomValues(new Uint8Array(16)); // works on http too (randomUUID needs https)
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else if (k === "checked" || k === "selected" || k === "disabled" || k === "value") node[k] = v;
      else node.setAttribute(k, v === true ? "" : v);
    }
    children.flat(Infinity).forEach((c) => {
      if (c == null || c === false || c === true) return;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    });
    return node;
  }

  function toast(text, ms = 2800) {
    const t = document.getElementById("toast");
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toast.h);
    toast.h = setTimeout(() => (t.hidden = true), ms);
  }

  async function api(method, url, body) {
    const res = await fetch(url, {
      method, credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    // Signed out (session expired or the server was reset): back to the sign-in screen; drafts and
    // unsent assessments stay on the phone and come back after signing in.
    if (res.status === 401 && state.user && !url.includes("/login")) {
      state.user = null;
      state.chat = [];
      closeOverlays();
      state.screen = "login";
      renderLogin("Your sign-in has expired. Please log in again; your drafts are kept on this phone.");
    }
    if (!res.ok) throw Object.assign(new Error(json.error || `Error ${res.status}`), { status: res.status });
    return json;
  }

  /** The tool as the app shows it: number, title, target, minutes, icon, colour. */
  function toolOf(q) {
    const b = BUILT_IN[q.id];
    return {
      q, number: toolNumber(q), title: toolTitle(q),
      target: ext(q, TARGET_EXT)?.valueString || b?.[0] || "",
      minutes: ext(q, MINUTES_EXT)?.valueInteger || b?.[1] || 20,
      icon: b?.[2] || "description",
      quiz: Q.settings(q),
    };
  }
  const tools = () => state.forms.map(toolOf).filter((t) => t.number).sort((a, b) => a.number - b.number);
  const tile = (t) => el("span", { class: `tile${t.number % 2 ? "" : " green"}` }, icon(t.icon));

  /** Question count as on the phone: numbered questions, else all answerable ones. */
  function questionCount(q) {
    let numbered = 0, all = 0;
    const walk = (items) => (items || []).forEach((i) => {
      if (i.type !== "group" && i.type !== "display" && !isHidden(i)) all++;
      if (i.prefix) numbered++;
      walk(i.item);
    });
    walk(q.item);
    return numbered || all;
  }

  // ---------------------------------------------------------------- storage on the phone (IndexedDB)
  const store = (() => {
    let dbp = null;
    const memory = new Map();
    const open = () => (dbp ||= new Promise((resolve) => {
      setTimeout(() => resolve(null), 2000); // private browsing may block storage: memory then
      try {
        const req = indexedDB.open("ahip-collect", 1);
        req.onupgradeneeded = () => req.result.createObjectStore("kv");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch { resolve(null); }
    }));
    const run = async (mode, fn) => {
      const db = await open();
      if (!db) return null;
      return new Promise((resolve) => {
        setTimeout(() => resolve(null), 3000);
        try {
          const tx = db.transaction("kv", mode);
          const r = fn(tx.objectStore("kv"));
          tx.oncomplete = () => resolve(r?.result);
          tx.onerror = () => resolve(null);
        } catch { resolve(null); }
      });
    };
    return {
      async get(key) { const v = await run("readonly", (s) => s.get(key)); return v ?? memory.get(key) ?? null; },
      async set(key, value) { memory.set(key, value); await run("readwrite", (s) => s.put(value, key)); },
    };
  })();
  const userKey = (k) => `${k}:${state.user?.username || "-"}`;
  const saveDrafts = () => store.set(userKey("drafts"), state.drafts);
  const saveOutbox = () => store.set(userKey("outbox"), state.outbox);

  // ---------------------------------------------------------------- navigation
  const BACK = { assessment: "study", tools: "assessment", tool: "tools", summary: "study", done: "tools", draftReview: "tools", review: "form", login: "welcome" };
  function go(screen, { push = true } = {}) {
    if (screen !== "form" && screen !== "review") stopTimer();
    closeOverlays();
    state.screen = screen;
    if (push) history.pushState({ screen }, "");
    render();
    window.scrollTo(0, 0);
  }
  window.addEventListener("popstate", () => goBack(true));
  function goBack(fromBrowser = false) {
    if (document.querySelector(".scrim, .chat")) { closeOverlays(); if (fromBrowser) history.pushState({ screen: state.screen }, ""); return; }
    if (recorder) { if (fromBrowser) history.pushState({ screen: state.screen }, ""); return toast("Stop the recording first."); }
    if (state.screen === "form") {
      if (fromBrowser) history.pushState({ screen: "form" }, "");
      if (state.fill.page > 0) { state.fill.page--; state.fill.problems = null; autosave(); render(); return window.scrollTo(0, 0); }
      return confirmLeaveForm();
    }
    const back = BACK[state.screen];
    if (back) go(back, { push: !fromBrowser });
    else if (fromBrowser) history.pushState({ screen: state.screen }, "");
  }
  function closeOverlays() { document.querySelectorAll(".scrim, .chat, .menu").forEach((n) => n.remove()); }

  function bar(title, { back = true, onBack = () => goBack(), right = [], close = false } = {}) {
    return el("header", { class: "bar" },
      back && el("button", { class: "icon-btn back", "aria-label": close ? "Close" : "Back", onclick: onBack }, icon(close ? "close" : "back")),
      el("h1", { text: title }),
      right);
  }
  const bottom = (...buttons) => el("div", { class: "bottom" }, el("div", { class: "bottom-inner" }, buttons));
  const pill = (text, onclick, { cls = "", arrow = true, lead = null, disabled = false } = {}) =>
    el("button", { class: `pill ${cls}`.trim(), onclick, disabled }, lead && icon(lead), text, arrow && !lead && icon("forward"));

  // ---------------------------------------------------------------- menu + dialogs
  function menuButton() {
    return el("button", { class: "icon-btn", "aria-label": "Menu", onclick: (e) => {
      e.stopPropagation();
      if (document.querySelector(".menu")) return closeOverlays();
      const m = el("div", { class: "menu", role: "menu" },
        el("div", { class: "info", text: `Signed in as ${state.user?.name || state.user?.username || ""}` }),
        el("div", { class: "info", text: `Server: ${state.server}` }),
        el("button", { role: "menuitem", onclick: () => { m.remove(); syncAll(true); } }, "Sync data"),
        el("button", { role: "menuitem", onclick: () => { m.remove(); shareDialog(); } }, "Share my data (API key)"),
        el("button", { role: "menuitem", onclick: () => { m.remove(); signOut(); } }, "Log out"));
      document.body.append(m);
      setTimeout(() => document.addEventListener("click", function close(ev) { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener("click", close); } }), 0);
    } }, icon("menu"));
  }

  function dialog(title, body, actions, { row = false } = {}) {
    closeOverlays();
    const scrim = el("div", { class: "scrim", onclick: (e) => { if (e.target === scrim) scrim.remove(); } },
      el("div", { class: "dialog", role: "dialog", "aria-modal": "true" },
        el("h3", { text: title }), body,
        el("div", { class: `actions${row ? " row" : ""}` }, actions.map(([label, fn, cls]) =>
          el("button", { class: cls || "", onclick: () => { if (fn() !== false) scrim.remove(); } }, label)))));
    document.body.append(scrim);
    return scrim;
  }

  function shareDialog() {
    const pass = el("input", { class: "tf", type: "password", placeholder: "Your password", autocomplete: "current-password" });
    const err = el("p", { style: "color:var(--error);font-size:14px", hidden: true });
    const body = el("div", {},
      el("p", { text: "Create a personal API key to share the forms YOU have submitted with another tool (Excel, Power BI or a colleague system). Only your own data can be read with it. Creating a new key stops the old one. Enter your password to continue." }),
      pass, err);
    const d = dialog("Share my data (API key)", body, [["Cancel", () => true], ["Create key", () => {
      api("POST", "/api/collect/api-key", { password: pass.value }).then((r) => {
        d.remove();
        const copy = () => navigator.clipboard?.writeText(r.apiKey).then(() => toast("Key copied."), () => toast("Select the key and copy it."));
        dialog("Share my data (API key)", el("div", {},
          el("p", { text: "Your API key (keep it private; shown only now):" }),
          el("div", { class: "key", text: r.apiKey }),
          el("p", { class: "muted", style: "margin-top:10px;font-size:13px", text: `Data links (send the key in the X-API-Key header, or add ?api_key=KEY): ${r.jsonUrl} · ${r.csvUrl}` })),
        [["Copy key", () => { copy(); return false; }],
          navigator.share ? ["Share…", () => { navigator.share({ title: "My AHIP Collect data", text: `API key: ${r.apiKey}\nJSON: ${r.jsonUrl}\nCSV: ${r.csvUrl}` }).catch(() => {}); return false; }] : null,
          ["Close", () => true]].filter(Boolean), { row: true });
      }, (e) => { err.textContent = e.status ? e.message : "AHIP Manage could not be reached. Check your connection and try again."; err.hidden = false; });
      return false;
    }]], { row: true });
    setTimeout(() => pass.focus(), 50);
  }

  // ---------------------------------------------------------------- welcome + sign in
  function waves() {
    const s = document.createElementNS(SVG_NS, "svg");
    s.setAttribute("class", "waves");
    s.setAttribute("viewBox", "0 0 100 100");
    s.setAttribute("preserveAspectRatio", "none");
    s.innerHTML = '<path d="M0 55 C35 15 65 75 100 30 L100 100 L0 100 Z" fill="#1e9b2e"/><path d="M0 85 C40 45 70 100 100 55 L100 100 L0 100 Z" fill="#6f1a78"/>';
    return s;
  }

  function renderWelcome() {
    $app.replaceChildren(el("main", { class: "welcome" },
      el("div", { class: "spacer" }),
      el("img", { class: "logo", src: "ahip_logo.png", alt: "AHIP" }),
      el("h2", { text: "AHIP Collect" }),
      el("p", { class: "tag", text: "Digital Data Collection for Afya-Tek Phase III" }),
      el("div", { class: "spacer big" }),
      pill("Get Started", () => go("login"), { cls: "purple" })), waves());
  }

  function renderLogin(error = "") {
    const userIn = el("input", { id: "u", autocomplete: "username", autocapitalize: "none", spellcheck: "false", placeholder: " ", value: localStorage.getItem("ahip_web_last_user") || "" });
    const passIn = el("input", { id: "p", type: "password", autocomplete: "current-password", placeholder: " " });
    const eye = el("button", { type: "button", class: "eye", "aria-label": "Show password", onclick: () => {
      passIn.type = passIn.type === "password" ? "text" : "password";
      eye.replaceChildren(icon(passIn.type === "password" ? "eyeOff" : "eye"));
    } }, icon("eyeOff"));
    const errBox = el("div", { class: "login-error", role: "alert", hidden: !error }, icon("error"), el("span", { text: error }));
    const btn = el("button", { class: "pill", type: "submit" }, "Login", icon("forward"));
    const form = el("form", { onsubmit: async (e) => {
      e.preventDefault();
      if (!userIn.value.trim() || !passIn.value) return;
      btn.disabled = true;
      btn.replaceChildren(el("span", { class: "spinner white" }));
      try {
        const { user } = await api("POST", "/api/collect/login", { username: userIn.value.trim(), password: passIn.value });
        try { localStorage.setItem("ahip_web_last_user", user.username); localStorage.setItem("ahip_web_user", JSON.stringify(user)); } catch {}
        await startAs(user);
      } catch (err) {
        errBox.querySelector("span").textContent = err.status ? err.message : "The AHIP server could not be reached. Check your internet or Wi-Fi and try again.";
        errBox.hidden = false;
        btn.disabled = false;
        btn.replaceChildren("Login", icon("forward"));
      }
    } },
      el("div", { class: "field" }, icon("person"), userIn, el("label", { for: "u", text: "Username" })),
      el("div", { class: "field" }, icon("lock"), passIn, el("label", { for: "p", text: "Password" }), eye),
      errBox, btn);
    $app.replaceChildren(el("main", { class: "login-page" },
      el("img", { class: "logo", src: "ahip_logo.png", alt: "AHIP" }),
      el("h2", { text: "AHIP Collect" }),
      el("p", { class: "sub", text: "Digital Data Collection for Afya-Tek Phase III" }),
      el("div", { class: "login-card" },
        el("h3", { text: "Sign In" }),
        el("p", { class: "hint", text: "Use the username and password from your AHIP Manage invitation" }),
        form,
        el("button", { class: "forgot", type: "button", onclick: () => dialog("Forgot password?", el("p", { text: "Ask your AHIP administrator to send you a new invitation email; it lets you choose a new password." }), [["OK", () => true]]) }, "Forgot Password?")),
      el("p", { class: "version", text: "AHIP Collect Web" })), waves());
    setTimeout(() => (userIn.value ? passIn : userIn).focus(), 50);
  }

  async function signOut() {
    if (state.outbox.length && !confirm(`${plural(state.outbox.length, "assessment has", "assessments have")} not been sent yet. They stay on this phone and are sent when you sign in again. Log out?`)) return;
    await api("POST", "/api/collect/logout").catch(() => {});
    try { localStorage.removeItem("ahip_web_user"); } catch {}
    state.user = null;
    state.mine = null;
    state.chat = [];
    go("login");
  }

  async function startAs(user, server) {
    state.user = user;
    if (server) state.server = server;
    state.drafts = (await store.get(userKey("drafts"))) || {};
    state.outbox = (await store.get(userKey("outbox"))) || [];
    state.study = localStorage.getItem("ahip_web_study") || STUDIES[0].id;
    state.assessment = localStorage.getItem("ahip_web_assessment") || ASSESSMENTS[0].id;
    if ((await loadForms(false)) === "signin") return;
    history.replaceState({ screen: "study" }, "");
    go("study", { push: false });
    if (state.outbox.length) syncAll(false);
  }

  async function loadForms(announce) {
    try {
      const { forms } = await api("GET", "/api/collect/forms");
      state.forms = forms;
      await store.set("forms", forms);
      if (announce) toast("Forms are up to date.");
    } catch (e) {
      if (e.status === 401) { state.screen = "login"; renderLogin("Please sign in again."); return "signin"; }
      state.forms = (await store.get("forms")) || state.forms;
    }
    return "ok";
  }

  // ---------------------------------------------------------------- study / assessment
  function renderStudy() {
    let chosen = state.study;
    const list = el("div");
    const draw = () => list.replaceChildren(...STUDIES.map((s) =>
      el("button", { class: `card-select study${chosen === s.id && !s.soon ? " on" : ""}${s.soon ? " soon" : ""}`,
        onclick: () => (s.soon ? toast(`${s.title}: coming soon. Use Baseline for now.`) : ((chosen = s.id), draw())) },
        icon("folder", "folder"),
        el("span", { class: "grow" }, el("div", { class: "t", text: s.title }), el("div", { class: "s", text: `(${s.sub})` })),
        s.soon ? el("span", { class: "chip-soon", text: "Coming soon" }) : chosen === s.id && icon("check", "check"))));
    draw();
    $app.replaceChildren(
      bar("AHIP Collect", { back: false, right: [el("button", { class: "icon-btn", "aria-label": "Open my assessment summary", onclick: () => go("summary") }, icon("insights")), menuButton()] }),
      el("div", { class: "bar-extended" }, el("h2", { text: "Select Study / Programme" })),
      el("main", { class: "screen" }, list),
      bottom(pill("Continue", () => { state.study = chosen; try { localStorage.setItem("ahip_web_study", chosen); } catch {} go("assessment"); })));
  }

  function renderAssessment() {
    let chosen = state.assessment;
    const list = el("div");
    const draw = () => list.replaceChildren(...ASSESSMENTS.map((a) =>
      el("button", { class: `card-select${chosen === a.id && !a.soon ? " on" : ""}${a.soon ? " soon" : ""}`,
        onclick: () => (a.soon ? toast(`${a.title}: coming soon. Use Baseline for now.`) : ((chosen = a.id), draw())) },
        el("span", { class: "radio" }),
        el("span", { class: "grow t", text: `${a.title} (${a.period})` }),
        a.soon && el("span", { class: "chip-soon", text: "Coming soon" }))));
    draw();
    const study = STUDIES.find((s) => s.id === state.study) || STUDIES[0];
    $app.replaceChildren(
      bar(`Study: ${study.title}`),
      el("main", { class: "screen" }, el("h2", { class: "heading", text: "Select Assessment" }), list),
      bottom(pill("Back", () => goBack(), { cls: "outline", arrow: false }),
        pill("Continue", () => { state.assessment = chosen; try { localStorage.setItem("ahip_web_assessment", chosen); } catch {} go("tools"); })));
  }

  // ---------------------------------------------------------------- tools + drafts
  const draftSite = (d) => {
    const m = new Map(d.answers);
    for (const id of SITE_IDS) {
      const a = m.get(id)?.[0];
      const v = a && (a.valueCoding ? a.valueCoding.display : a.valueString);
      if (v && !/^new cpp/i.test(v) && a.valueCoding?.code !== "other") return v;
    }
    return null;
  };
  const answeredCount = (entries) => entries.filter(([id, a]) => a.length && !/^ahip-(study|assessment)$/.test(id)).length;

  function renderTools() {
    const list = tools();
    const assessment = ASSESSMENTS.find((a) => a.id === state.assessment) || ASSESSMENTS[0];
    const drafts = Object.values(state.drafts).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    $app.replaceChildren(
      bar(`Assessment: ${assessment.title} (${assessment.period})`),
      el("main", { class: "screen stack" },
        drafts.length > 0 && el("h2", { class: "heading", text: `Drafts to finish (${drafts.length})` }),
        drafts.map((d) => {
          const form = state.forms.find((q) => q.id === d.formId);
          if (!form) return null;
          const t = toolOf(form);
          const n = answeredCount(d.answers);
          return el("div", { class: "draft", onclick: (e) => { if (!e.target.closest("button")) resumeFill(d); } },
            el("div", { class: "top" }, tile(t),
              el("div", {},
                el("div", { class: "t", text: `Tool ${t.number}: ${t.title}` }),
                el("div", { class: "site", text: draftSite(d) || "No site name yet" }),
                el("div", { class: "when", text: `${plural(n, "answer", "answers")} · saved ${fmtSaved(d.updatedAt)}` }))),
            el("div", { class: "actions" },
              el("button", { class: "text-link", onclick: () => dialog("Delete this draft?", el("p", { text: "The answers saved in this draft will be removed from the phone. This cannot be undone." }),
                [["Cancel", () => true], ["Delete", () => { delete state.drafts[d.id]; saveDrafts(); render(); }, "danger"]], { row: true }) }, "Delete"),
              el("button", { class: "small-pill", onclick: () => { state.review = d.id; go("draftReview"); } }, "Review & edit"),
              el("button", { class: "small-pill solid", onclick: () => resumeFill(d) }, "Continue")));
        }),
        drafts.length > 0 && el("div", { style: "height:6px" }),
        el("h2", { class: "heading", text: `Assessment Tools (${list.length})` }),
        !list.length && el("p", { class: "muted", text: "No forms on this phone yet. Connect to the internet, then choose Sync data in the menu." }),
        list.map((t) => el("button", { class: "tool-row", onclick: () => { state.tool = t.q.id; go("tool"); } },
          tile(t),
          el("span", { class: "grow" },
            el("div", { class: "t" }, `Tool ${t.number}: ${t.title}`, t.quiz && el("span", { class: "badge", text: [t.quiz.scored !== false ? "Quiz" : "Timed", t.quiz.timeLimitMinutes ? `${t.quiz.timeLimitMinutes} min` : ""].filter(Boolean).join(" · ") })),
            el("div", { class: "s", text: `(${plural(questionCount(t.q), "question", "questions")})` })),
          icon("chevron", "chev")))));
  }

  function renderToolDetail() {
    const form = state.forms.find((q) => q.id === state.tool);
    if (!form) return go("tools", { push: false });
    const t = toolOf(form);
    const sections = [];
    (form.item || []).forEach((p) => {
      if (p.text) sections.push(p.text);
      (p.item || []).filter((i) => control(i) === "location-widget").forEach((g) => sections.push(g.text || "GPS reading"));
    });
    $app.replaceChildren(
      bar(`Tool ${t.number}: ${t.title}`),
      el("main", { class: "screen" },
        el("div", { class: "tool-head" }, tile(t), el("h2", { text: `Tool ${t.number}: ${t.title}` })),
        el("div", { class: "fact" }, icon("help"), `Questions: ${questionCount(form)}`),
        el("div", { class: "fact" }, icon("schedule"), `Estimated time: ~${t.minutes} minutes`),
        t.target && el("div", { class: "fact" }, icon("groups"), `Target: ${t.target}`),
        t.quiz?.timeLimitMinutes > 0 && el("div", { class: "fact" }, icon("schedule"), `Time limit: ${t.quiz.timeLimitMinutes} minutes (the answers are submitted when time runs out)`),
        sections.length > 0 && el("div", { class: "sections-title", text: "Sections" }),
        sections.map((s) => el("div", { class: "section-row", text: s }))),
      bottom(pill("Start Assessment", () => startFill(form))));
  }

  // ---------------------------------------------------------------- filling a form
  function startFill(form) {
    const answers = new Map([
      ["ahip-study", [{ valueString: state.study }]],
      ["ahip-assessment", [{ valueString: state.assessment }]],
    ]);
    state.fill = { id: `web-${uuid()}`, form, answers, page: 0, startedAt: Date.now(), problems: null, dirty: false, saved: false };
    go("form");
  }

  function resumeFill(d, page = null) {
    const form = state.forms.find((q) => q.id === d.formId);
    if (!form) return toast("This form is no longer available.");
    state.fill = { id: d.id, form, answers: new Map(d.answers), page: page ?? 0, startedAt: d.startedAt || Date.now(), problems: null, dirty: false, saved: true };
    go("form");
  }

  let saveTimer = null;
  function autosave(now = false) {
    const f = state.fill;
    if (!f || (!f.saved && !f.dirty)) return;
    clearTimeout(saveTimer);
    const write = () => {
      state.drafts[f.id] = { id: f.id, formId: f.form.id, answers: [...f.answers.entries()], page: f.page, startedAt: f.startedAt, updatedAt: new Date().toISOString() };
      f.saved = true;
      saveDrafts();
    };
    if (now) write(); else saveTimer = setTimeout(write, 700);
  }

  function saveDraftAndExit() {
    const f = state.fill;
    f.dirty = true;
    autosave(true);
    state.fill = null;
    toast("Draft saved on this phone. Find it under Drafts to finish.");
    go("tools");
  }

  function confirmLeaveForm() {
    const f = state.fill;
    if (!answeredCount([...f.answers.entries()])) { state.fill = null; return go("tools"); }
    dialog("You have unsaved changes", el("p", { text: "If you leave without saving, all your changes will not be saved" }), [
      ["Save as draft", () => saveDraftAndExit()],
      ["Discard changes", () => { if (!state.drafts[f.id]?.updatedAt || !f.saved) delete state.drafts[f.id]; saveDrafts(); state.fill = null; go("tools"); }],
      ["Cancel", () => true],
    ]);
  }

  const pages = (form) => (form.item || []).every((i) => i.type === "group")
    ? form.item
    : [{ linkId: "_all", text: toolTitle(form), type: "group", item: form.item }];

  const rawOf = (a) => (a.valueCoding ? a.valueCoding.code
    : a.valueString ?? a.valueInteger ?? a.valueDecimal ?? a.valueBoolean ?? a.valueDate ?? a.valueTime ?? a.valueDateTime ?? (a.valueAttachment ? "attachment" : undefined));
  const valuesOf = (linkId, answers = state.fill.answers) => (answers.get(linkId) || []).map(rawOf).filter((v) => v !== undefined && v !== "");

  function cmp(a, op, b) {
    if (typeof b === "number") a = Number(a);
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

  function enabled(item, answers = state.fill.answers) {
    const ws = item.enableWhen || [];
    if (!ws.length) return true;
    const results = ws.map((w) => {
      const values = valuesOf(w.question, answers);
      if (w.operator === "exists") return (values.length > 0) === (w.answerBoolean !== false);
      const target = w.answerCoding ? w.answerCoding.code : w.answerString ?? w.answerInteger ?? w.answerDecimal ?? w.answerBoolean ?? w.answerDate ?? w.answerTime;
      if (w.operator === "!=") return values.every((v) => !cmp(v, "=", target));
      return values.some((v) => cmp(v, w.operator, target));
    });
    return item.enableBehavior === "any" ? results.some(Boolean) : results.every(Boolean);
  }

  const visiblePages = (form = state.fill.form, answers = state.fill.answers) => pages(form).filter((p) => enabled(p, answers));

  /** "Record the interview as audio" + a recording: the other questions become optional (as on the phone). */
  function incompleteAllowed(form = state.fill.form, answers = state.fill.answers) {
    const expr = ext(form, ALLOW_INCOMPLETE)?.valueExpression?.expression || "";
    const mode = /linkId='([^']+)'\)\.answer\.value\.code\s*=\s*'([^']+)'/.exec(expr);
    const audio = /linkId='([^']+)'\)\.answer\.exists\(\)/.exec(expr);
    if (!mode || !audio) return false;
    return valuesOf(mode[1], answers).includes(mode[2]) && valuesOf(audio[1], answers).length > 0;
  }

  function kindOf(i) {
    const ctl = control(i);
    switch (i.type) {
      case "display": return "note";
      case "group": return ctl === "location-widget" ? "gps" : ext(i, TABLE) ? "table" : ext(i, GRID) ? "grid" : "group";
      case "choice": case "open-choice":
        if (i.repeats) return "checkboxes";
        if (ctl === "drop-down") return "dropdown";
        return ext(i, LINEAR) ? "linear" : "radio";
      case "boolean": return "boolean";
      case "string": return "short";
      case "text": return "paragraph";
      case "integer": return ctl === "slider" ? "slider" : "integer";
      case "decimal": return "decimal";
      case "date": return "date";
      case "time": return "time";
      case "dateTime": return "datetime";
      case "attachment":
        return ctl === "audio-recorder" || (i.extension || []).some((e) => e.url === MIME_TYPE && String(e.valueCode).startsWith("audio")) ? "audio" : "photo";
      default: return "short";
    }
  }

  function pageProblems(page) {
    const problems = new Map();
    if (incompleteAllowed()) return problems;
    const walk = (items) => (items || []).forEach((i) => {
      if (!enabled(i) || isHidden(i) || i.type === "display") return;
      const kind = kindOf(i);
      if (kind === "group" || kind === "grid" || kind === "table") return walk(i.item);
      if (kind === "gps") return;
      const values = valuesOf(i.linkId);
      if (i.required && !values.length) problems.set(i.linkId, "Missing answer for required field.");
      const regex = ext(i, REGEX)?.valueString;
      if (regex && values.length && !new RegExp(regex).test(String(values[0]))) problems.set(i.linkId, "The answer doesn't match the expected format.");
      if ((kind === "integer" || kind === "decimal" || kind === "slider") && values.length) {
        const min = ext(i, MIN_VALUE), max = ext(i, MAX_VALUE);
        const lo = min?.valueInteger ?? min?.valueDecimal, hi = max?.valueInteger ?? max?.valueDecimal;
        const v = Number(values[0]);
        if (lo != null && v < lo) problems.set(i.linkId, `Minimum value allowed is: ${lo}`);
        if (hi != null && v > hi) problems.set(i.linkId, `Maximum value allowed is: ${hi}`);
      }
    });
    walk(page.item);
    return problems;
  }

  function setAnswer(linkId, answers, redraw = true) {
    const f = state.fill;
    if (answers.length) f.answers.set(linkId, answers); else f.answers.delete(linkId);
    f.dirty = true;
    if (f.problems?.has(linkId)) { f.problems.delete(linkId); if (!redraw) document.querySelector(`[data-link="${CSS.escape(linkId)}"]`)?.classList.remove("err"); }
    if (f.saved) autosave();
    if (redraw) renderPreserveScroll();
  }

  function renderPreserveScroll() {
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
  }

  // ---------------------------------------------------------------- the form screen (as the Android form)
  function renderForm() {
    const f = state.fill;
    const list = visiblePages();
    f.page = Math.max(0, Math.min(f.page, list.length - 1));
    const page = list[f.page];
    const last = f.page === list.length - 1;
    const quiz = Q.settings(f.form);
    const right = [];
    if (quiz?.timeLimitMinutes) right.push(el("span", { class: "timer", id: "timer", text: `⏱ ${fmtClock(f.startedAt + quiz.timeLimitMinutes * 60000 - Date.now())}` }));
    right.push(el("button", { class: "text-btn", onclick: saveDraftAndExit }, "Save draft"));
    const problems = f.problems || new Map();
    const body = el("div", { class: "form-body" });
    const desc = (page.item || []).find((i) => i.linkId === `${page.linkId}_desc`);
    body.append(el("h2", { class: "page-title", text: page.text || "" }));
    if (desc) body.append(el("p", { class: "page-desc", text: desc.text }));
    renderItems((page.item || []).filter((i) => i !== desc), body, problems);
    $app.replaceChildren(
      bar(`Tool ${toolNumber(f.form)}: ${toolTitle(f.form)}`, { close: true, onBack: () => confirmLeaveForm(), right }),
      el("div", { class: "form-page" },
        el("div", { class: "track" }, el("span", { style: `width:${Math.max(8, ((f.page + 1) / list.length) * 100)}%` })),
        body),
      el("div", { class: "form-nav" }, el("div", { class: "form-nav-inner" },
        f.page > 0 ? el("button", { class: "prev", onclick: () => goBack() }, "Previous") : el("span"),
        el("button", { class: "next", onclick: () => next(page, last) }, last ? "Review" : "Next"))));
    startTimer();
  }

  function next(page, last) {
    if (recorder) return toast("Stop the recording first.");
    const f = state.fill;
    const problems = pageProblems(page);
    f.problems = problems;
    if (problems.size) {
      renderPreserveScroll();
      document.querySelector(".q.err")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    f.problems = null;
    if (f.saved) autosave(true);
    if (last) return go("review");
    f.page++;
    history.pushState({ screen: "form" }, "");
    render();
    window.scrollTo(0, 0);
  }

  function renderItems(items, container, problems) {
    items.forEach((i) => {
      if (!enabled(i) || isHidden(i) || isFlyover(i)) return;
      container.append(renderItem(i, problems));
    });
  }

  const optionClass = (on) => `opt${on ? " on" : ""}`;

  function renderItem(i, problems) {
    const kind = kindOf(i);
    const f = state.fill;
    const err = problems.get(i.linkId) || "";
    const card = el("section", { class: `q${err ? " err" : ""}${kind === "note" ? " note" : ""}`, "data-link": i.linkId });
    if (kind === "note") { card.append(el("div", { text: i.text || "" })); return card; }
    card.append(el("div", { class: "label" }, i.prefix ? `${i.prefix} ` : "", i.text || "", i.required ? " *" : ""));
    const hint = hintOf(i);
    if (hint) card.append(el("p", { class: "hint", text: hint }));
    const answers = f.answers.get(i.linkId) || [];
    const value = answers[0] ? rawOf(answers[0]) : "";
    const opts = (i.answerOption || []).map((o) => o.valueCoding).filter(Boolean);
    const name = `q_${i.linkId}`;
    const coding = (o) => ({ valueCoding: { system: o.system, code: o.code, display: o.display } });

    switch (kind) {
      case "short": {
        const regex = ext(i, REGEX)?.valueString || "";
        const type = /@/.test(regex) ? "email" : /255/.test(regex) ? "tel" : "text";
        card.append(el("input", { class: "tf", type, value: value ?? "", maxlength: i.maxLength || null, inputmode: type === "tel" ? "tel" : null, autocomplete: "off",
          oninput: (e) => setAnswer(i.linkId, e.target.value.trim() ? [{ valueString: e.target.value }] : [], false),
          onchange: () => renderPreserveScroll() }));
        break;
      }
      case "paragraph":
        card.append(el("textarea", { class: "tf", rows: 4, maxlength: i.maxLength || null,
          oninput: (e) => setAnswer(i.linkId, e.target.value.trim() ? [{ valueString: e.target.value }] : [], false),
          onchange: () => renderPreserveScroll() }, value ?? ""));
        break;
      case "integer": case "decimal":
        card.append(el("input", { class: "tf", type: "number", inputmode: kind === "integer" ? "numeric" : "decimal", step: kind === "integer" ? 1 : "any", value: value ?? "",
          onchange: (e) => {
            const v = e.target.value === "" ? null : Number(e.target.value);
            setAnswer(i.linkId, v == null || Number.isNaN(v) ? [] : [kind === "integer" ? { valueInteger: Math.round(v) } : { valueDecimal: v }]);
          } }));
        break;
      case "slider": {
        const min = ext(i, MIN_VALUE)?.valueInteger ?? 0, max = ext(i, MAX_VALUE)?.valueInteger ?? 10;
        const out = el("b", { text: value === "" ? "–" : String(value) });
        card.append(el("div", { class: "slider-row" }, el("span", { text: String(min) }),
          el("input", { type: "range", min, max, step: ext(i, SLIDER_STEP)?.valueInteger || 1, value: value === "" ? min : value,
            oninput: (e) => { out.textContent = e.target.value; setAnswer(i.linkId, [{ valueInteger: Number(e.target.value) }], false); },
            onchange: () => renderPreserveScroll() }),
          el("span", { text: String(max) }), out));
        break;
      }
      case "date": case "time": case "datetime":
        card.append(el("input", { class: "tf", type: kind === "datetime" ? "datetime-local" : kind, value: kind === "datetime" && value ? String(value).slice(0, 16) : value ?? "",
          onchange: (e) => setAnswer(i.linkId, e.target.value ? [kind === "date" ? { valueDate: e.target.value } : kind === "time" ? { valueTime: e.target.value.length === 5 ? `${e.target.value}:00` : e.target.value } : { valueDateTime: new Date(e.target.value).toISOString() }] : []) }));
        break;
      case "boolean":
        [["true", "Yes"], ["false", "No"]].forEach(([v, label]) => card.append(
          el("label", { class: optionClass(String(value) === v) }, el("input", { type: "radio", name, checked: String(value) === v, onchange: () => setAnswer(i.linkId, [{ valueBoolean: v === "true" }]) }), label)));
        break;
      case "radio": case "linear": {
        const wrap = el("div", { class: kind === "linear" && opts.length <= 11 ? "opts-row" : "" });
        opts.forEach((o) => wrap.append(el("label", { class: optionClass(value === o.code) },
          el("input", { type: "radio", name, checked: value === o.code, onchange: () => setAnswer(i.linkId, [coding(o)]) }), o.display)));
        card.append(wrap);
        break;
      }
      case "checkboxes": {
        const codes = answers.map(rawOf);
        opts.forEach((o) => card.append(el("label", { class: optionClass(codes.includes(o.code)) },
          el("input", { type: "checkbox", checked: codes.includes(o.code), onchange: (e) => {
            const keep = answers.filter((a) => a.valueCoding?.code !== o.code);
            setAnswer(i.linkId, e.target.checked ? [...keep, coding(o)] : keep);
          } }), o.display)));
        break;
      }
      case "dropdown":
        card.append(el("select", { class: "tf", onchange: (e) => {
          const o = opts.find((x) => x.code === e.target.value);
          setAnswer(i.linkId, o ? [coding(o)] : []);
        } }, el("option", { value: "" }, ""), opts.map((o) => el("option", { value: o.code, selected: value === o.code }, o.display))));
        break;
      case "grid": card.append(renderGrid(i, problems)); break;
      case "table": card.append(renderTable(i, problems)); break;
      case "gps": card.append(renderGps(i)); break;
      case "photo": card.append(renderPhoto(i, answers)); break;
      case "audio": card.append(renderAudio(i, answers)); break;
      case "group": renderItems(i.item || [], card, problems); break;
      default: break;
    }
    if (err) card.append(el("div", { class: "msg", text: err }));
    return card;
  }

  function renderGrid(group, problems) {
    const rows = (group.item || []).filter((r) => r.type === "choice" && enabled(r));
    const cols = (rows[0]?.answerOption || []).map((o) => o.valueCoding);
    const multi = !!rows[0]?.repeats;
    return el("div", { class: "grid-wrap" }, el("table", { class: "grid" },
      el("thead", {}, el("tr", {}, el("th", {}), cols.map((c) => el("th", { text: c.display })))),
      el("tbody", {}, rows.map((r) => {
        const current = state.fill.answers.get(r.linkId) || [];
        const codes = current.map(rawOf);
        return el("tr", { class: problems.has(r.linkId) ? "err" : null, "data-link": r.linkId },
          el("th", {}, r.prefix ? `${r.prefix} ` : "", r.text || "", r.required ? " *" : ""),
          cols.map((c) => el("td", {}, el("input", { type: multi ? "checkbox" : "radio", name: `g_${r.linkId}`, "aria-label": `${r.text}: ${c.display}`, checked: codes.includes(c.code),
            onchange: (e) => {
              const v = { valueCoding: { system: c.system, code: c.code, display: c.display } };
              setAnswer(r.linkId, multi ? (e.target.checked ? [...current.filter((a) => a.valueCoding?.code !== c.code), v] : current.filter((a) => a.valueCoding?.code !== c.code)) : [v]);
            } }))));
      }))));
  }

  function renderTable(t, problems) {
    let cols = [];
    try { cols = JSON.parse(ext(t, TABLE)?.valueString || "{}").columns || []; } catch {}
    const rows = (t.item || []).filter((r) => r.type === "group" && enabled(r));
    return el("div", { class: "grid-wrap" }, el("table", { class: "grid" },
      el("thead", {}, el("tr", {}, el("th", {}), cols.map((c) => el("th", { text: c.name })))),
      el("tbody", {}, rows.map((r) => el("tr", {}, el("th", { text: r.text || "" }),
        (r.item || []).map((cell) => el("td", {}, el("input", {
          class: `cell${problems.has(cell.linkId) ? " bad" : ""}`, "data-link": cell.linkId, "aria-label": cell.text,
          type: cell.type === "string" ? "text" : "number", inputmode: cell.type === "integer" ? "numeric" : cell.type === "decimal" ? "decimal" : null,
          value: valuesOf(cell.linkId)[0] ?? "",
          onchange: (e) => {
            const raw = e.target.value.trim();
            const n = Number(raw);
            setAnswer(cell.linkId, raw === "" ? [] : cell.type === "string" ? [{ valueString: raw }] : Number.isNaN(n) ? [] : [cell.type === "integer" ? { valueInteger: Math.round(n) } : { valueDecimal: n }], false);
            e.target.classList.remove("bad");
          },
        }))))))));
  }

  function renderGps(group) {
    const axis = (n) => (group.item || []).find((c) => ext(c, GPS)?.valueString === n || c.linkId.endsWith(`_${n}`));
    const lat = axis("latitude"), lon = axis("longitude");
    const latV = lat && valuesOf(lat.linkId)[0], lonV = lon && valuesOf(lon.linkId)[0];
    const status = el("p", { class: "hint", text: "Stand at the premises or facility, then tap the button. Wait a few seconds for the location to appear." });
    const btn = el("button", { class: "outline-btn filled", type: "button", onclick: () => {
      if (!window.isSecureContext || !navigator.geolocation) {
        status.textContent = "GPS needs the secure (https) address of AHIP Collect. Ask your administrator for it, or skip this question.";
        return;
      }
      btn.disabled = true;
      status.replaceChildren(el("span", { class: "spinner" }), " Getting your location…");
      navigator.geolocation.getCurrentPosition((pos) => {
        if (lat) setAnswer(lat.linkId, [{ valueDecimal: Number(pos.coords.latitude.toFixed(6)) }], false);
        if (lon) setAnswer(lon.linkId, [{ valueDecimal: Number(pos.coords.longitude.toFixed(6)) }], false);
        renderPreserveScroll();
        toast(`Location recorded (±${Math.round(pos.coords.accuracy)} m).`);
      }, (e) => {
        btn.disabled = false;
        status.textContent = e.code === 1 ? "Location permission was refused. Allow location for this site in the phone settings." : "Could not get your location. Go outside or near a window and try again.";
      }, { enableHighAccuracy: true, timeout: 25000, maximumAge: 0 });
    } }, icon("place"), latV != null ? "Record GPS Location again" : "Record GPS Location");
    return el("div", {}, status, latV != null && el("p", { class: "gps-ok", text: `✓ Latitude ${latV}, Longitude ${lonV}` }), btn);
  }

  function readAsBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(",")[1]);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  /** Photos are made smaller (longest side 1280 px, JPEG) so they upload fast, as on the phone. */
  function shrinkPhoto(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement("canvas");
        c.width = Math.round(img.naturalWidth * scale);
        c.height = Math.round(img.naturalHeight * scale);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        const data = c.toDataURL("image/jpeg", 0.72).split(",")[1];
        resolve({ contentType: "image/jpeg", data, title: "photo.jpg", size: Math.round(data.length * 0.75) });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("This photo could not be read.")); };
      img.src = url;
    });
  }

  function renderPhoto(i, answers) {
    const a = answers[0]?.valueAttachment;
    const pick = (capture) => {
      const input = el("input", { type: "file", accept: "image/*", capture: capture ? "environment" : null, onchange: async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try { setAnswer(i.linkId, [{ valueAttachment: await shrinkPhoto(file) }]); toast("Photo saved"); } catch (err) { toast(err.message); }
      } });
      input.click();
    };
    return el("div", {},
      a && el("img", { class: "thumb", alt: "Photo", src: `data:${a.contentType};base64,${a.data}`, style: "margin-bottom:10px" }),
      el("div", { class: "media-row" },
        el("button", { class: "outline-btn filled", type: "button", onclick: () => pick(true) }, icon("camera"), a ? "Retake" : "Take photo"),
        el("button", { class: "outline-btn", type: "button", onclick: () => pick(false) }, "Gallery"),
        a && el("button", { class: "outline-btn", type: "button", onclick: () => setAnswer(i.linkId, []) }, "Remove")));
  }

  function renderAudio(i, answers) {
    const a = answers[0]?.valueAttachment;
    const maxMin = ext(i, AUDIO_MAX)?.valueInteger || 5;
    const box = el("div");
    const canRecord = window.isSecureContext && navigator.mediaDevices?.getUserMedia && window.MediaRecorder;
    if (a) box.append(el("audio", { controls: true, src: `data:${a.contentType};base64,${a.data}` }));
    const row = el("div", { class: "media-row" });
    if (canRecord) {
      row.append(el("button", { class: "outline-btn filled", type: "button", onclick: () => startRecording(i, box, maxMin) }, icon("mic"), a ? "Record again" : "Record"));
    } else {
      const input = el("input", { type: "file", accept: "audio/*", hidden: true, onchange: async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 40 * 1048576) return toast("This recording is too large (over 40 MB).");
        setAnswer(i.linkId, [{ valueAttachment: { contentType: file.type || "audio/mp4", data: await readAsBase64(file), title: file.name, size: file.size } }]);
      } });
      row.append(input, el("button", { class: "outline-btn filled", type: "button", onclick: () => input.click() }, icon("mic"), "Add a recording"));
      box.append(el("p", { class: "hint", text: "Recording in the browser needs the secure (https) address of AHIP Collect; here, attach a recording made with the phone's voice recorder." }));
    }
    if (a) row.append(el("button", { class: "outline-btn", type: "button", onclick: () => setAnswer(i.linkId, []) }, "Remove"));
    box.append(row, el("p", { class: "hint", style: "margin-top:8px", text: `Up to ${maxMin} minutes.` }));
    return box;
  }

  async function startRecording(i, box, maxMin) {
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { return toast("Microphone permission was refused. Allow the microphone for this site in the phone settings."); }
    const type = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find((t) => MediaRecorder.isTypeSupported?.(t)) || "";
    const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks = [];
    const started = Date.now();
    const clock = el("b", { text: "0:00" });
    box.replaceChildren(el("div", { class: "rec" }, el("span", { class: "dot" }), "Recording ", clock,
      el("button", { class: "outline-btn filled", type: "button", onclick: () => rec.stop() }, icon("stop"), "Stop")));
    const tick = setInterval(() => {
      clock.textContent = fmtClock(Date.now() - started);
      if (Date.now() - started >= maxMin * 60000) rec.stop();
    }, 500);
    recorder = rec;
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      clearInterval(tick);
      stream.getTracks().forEach((t) => t.stop());
      recorder = null;
      const blob = new Blob(chunks, { type: (rec.mimeType || type || "audio/mp4").split(";")[0] });
      setAnswer(i.linkId, [{ valueAttachment: { contentType: blob.type, data: await readAsBase64(blob), title: blob.type.includes("mp4") ? "recording.m4a" : "recording.webm", size: blob.size } }]);
    };
    rec.start(1000);
  }

  // ---------------------------------------------------------------- quiz / time limit
  function startTimer() {
    stopTimer();
    const f = state.fill;
    const quiz = f && Q.settings(f.form);
    if (!quiz?.timeLimitMinutes) return;
    const endsAt = f.startedAt + quiz.timeLimitMinutes * 60000;
    const tick = () => {
      const left = endsAt - Date.now();
      const t = document.getElementById("timer");
      if (t) { t.textContent = `⏱ ${fmtClock(left)}`; t.classList.toggle("low", left < 60000); }
      if (left <= 0) {
        stopTimer();
        if (recorder) recorder.stop();
        toast("Time is up. Your answers are being submitted.", 4000);
        setTimeout(() => submit(true), recorder ? 1500 : 0);
      }
    };
    tick();
    timer = setInterval(tick, 1000);
  }
  function stopTimer() { clearInterval(timer); timer = null; }

  // ---------------------------------------------------------------- review (draft review + before submit)
  function answerText(i, answers) {
    const a = answers.get(i.linkId) || [];
    return a.map((x) => x.valueCoding ? x.valueCoding.display || x.valueCoding.code
      : x.valueAttachment ? (x.valueAttachment.contentType || "").startsWith("audio") ? "Audio recording" : "Photo"
      : x.valueBoolean != null ? (x.valueBoolean ? "Yes" : "No")
      : rawOf(x)).join(", ");
  }

  /** Every visible question with its answer and the page it is on. */
  function reviewLines(form, answers) {
    const lines = [];
    const relaxed = incompleteAllowed(form, answers);
    visiblePages(form, answers).forEach((page, index) => {
      const walk = (items) => (items || []).forEach((i) => {
        if (!enabled(i, answers) || isHidden(i) || i.type === "display") return;
        const kind = kindOf(i);
        if (kind === "gps") {
          const v = (i.item || []).map((c) => valuesOf(c.linkId, answers)[0]).filter((x) => x != null);
          lines.push({ section: page.text, page: index, item: i, answer: v.length ? v.join(", ") : null, required: false });
          return;
        }
        if (i.type === "group") return walk(i.item);
        const text = answerText(i, answers);
        lines.push({ section: page.text, page: index, item: i, answer: text || null, required: !!i.required && !relaxed });
      });
      walk(page.item);
    });
    return lines;
  }

  function reviewScreen({ title, head, sub, lines, onEdit, bottomBtn }) {
    let onlyMissing = false;
    const list = el("div");
    const draw = () => {
      let last = null;
      const shown = onlyMissing ? lines.filter((l) => !l.answer) : lines;
      list.replaceChildren(...shown.flatMap((l) => {
        const out = [];
        if (l.section && l.section !== last) { last = l.section; out.push(el("div", { class: "rsection", text: l.section })); }
        out.push(el("div", { class: `line${l.answer ? "" : " missing"}` },
          el("div", { class: "grow" },
            el("div", { class: "q-l" }, l.item.prefix ? `${l.item.prefix} ` : "", l.item.text || l.item.linkId, l.required ? " *" : ""),
            el("div", { class: "a", text: l.answer || "Not answered yet" })),
          el("button", { class: "edit-btn", onclick: () => onEdit(l) }, icon("edit"), "Edit")));
        return out;
      }));
    };
    draw();
    const answered = lines.filter((l) => l.answer).length;
    return [
      bar(title),
      el("main", { class: "screen" },
        el("div", { class: "review-head" }, el("div", { class: "t", text: head }), el("div", { class: "s", text: `${sub} · ${answered} of ${lines.length} answered` })),
        el("label", { class: "check-line" }, el("input", { type: "checkbox", onchange: (e) => { onlyMissing = e.target.checked; draw(); } }), "Show only questions not answered yet"),
        list),
      bottomBtn,
    ];
  }

  function renderDraftReview() {
    const d = state.drafts[state.review];
    if (!d) return go("tools", { push: false });
    const form = state.forms.find((q) => q.id === d.formId);
    if (!form) return go("tools", { push: false });
    const t = toolOf(form);
    $app.replaceChildren(...reviewScreen({
      title: "Review draft",
      head: `Tool ${t.number}: ${t.title}`,
      sub: draftSite(d) || "No site name yet",
      lines: reviewLines(form, new Map(d.answers)),
      onEdit: (l) => { resumeFill(d, l.page); setTimeout(() => document.querySelector(`[data-link="${CSS.escape(l.item.linkId)}"]`)?.scrollIntoView({ block: "center" }), 80); },
      bottomBtn: bottom(pill("Continue from the start", () => resumeFill(d), { cls: "purple" })),
    }));
  }

  function renderReview() {
    const f = state.fill;
    const lines = reviewLines(f.form, f.answers);
    const missing = lines.filter((l) => l.required && !l.answer).length;
    const quiz = Q.settings(f.form);
    const screen = reviewScreen({
      title: "Review",
      head: `Tool ${toolNumber(f.form)}: ${toolTitle(f.form)}`,
      sub: draftSite({ answers: [...f.answers.entries()] }) || "No site name yet",
      lines,
      onEdit: (l) => { f.page = l.page; f.problems = null; go("form"); setTimeout(() => document.querySelector(`[data-link="${CSS.escape(l.item.linkId)}"]`)?.scrollIntoView({ block: "center" }), 80); },
      bottomBtn: bottom(pill("Back", () => goBack(), { cls: "outline", arrow: false }), pill("Submit", () => submit(false), { disabled: missing > 0 })),
    });
    if (quiz?.timeLimitMinutes) screen[0].append(el("span", { class: "timer", id: "timer" }));
    if (missing) screen[1].prepend(el("div", { class: "login-error", style: "margin-bottom:12px" }, icon("error"), `${plural(missing, "required question is", "required questions are")} not answered. Tap Edit to answer.`));
    $app.replaceChildren(...screen);
    startTimer();
  }

  // ---------------------------------------------------------------- submit + sync
  function buildItems(items) {
    const out = [];
    for (const i of items || []) {
      if (!enabled(i) || i.type === "display") continue;
      if (i.type === "group") {
        const kids = buildItems(i.item);
        const node = { linkId: i.linkId, text: i.text };
        if (kids.length) node.item = kids;
        out.push(node);
        continue;
      }
      const node = { linkId: i.linkId };
      if (i.text) node.text = i.text;
      const a = (state.fill.answers.get(i.linkId) || []).filter((x) => rawOf(x) !== undefined && rawOf(x) !== "");
      if (a.length) node.answer = a.map((x) => (x.valueString != null ? { valueString: String(x.valueString).trim() } : x));
      out.push(node);
    }
    return out;
  }

  let submitting = false;
  async function submit(timedOut) {
    const f = state.fill;
    if (!f || submitting) return;
    submitting = true;
    stopTimer();
    const quiz = Q.settings(f.form);
    const seconds = Math.round((Date.now() - f.startedAt) / 1000);
    const response = {
      resourceType: "QuestionnaireResponse",
      questionnaire: `Questionnaire/${f.form.id}`,
      status: "completed",
      authored: new Date().toISOString(),
      item: buildItems(f.form.item),
    };
    if (quiz) {
      response.extension = [{ url: Q.SECONDS, valueInteger: seconds }];
      if (timedOut) response.extension.push({ url: Q.TIMED_OUT, valueBoolean: true });
    }
    const entries = [...f.answers.entries()].filter(([, a]) => a.length);
    const isAudio = (a) => String(a[0].valueAttachment?.contentType || "").startsWith("audio");
    const score = quiz ? Q.scoreAnswers(f.form, new Map(entries.map(([k, a]) => [k, a.map(rawOf)]))) : null;
    state.done = {
      form: f.form,
      answered: answeredCount(entries),
      photos: entries.filter(([, a]) => a[0].valueAttachment && !isAudio(a)).length,
      audio: entries.filter(([, a]) => a[0].valueAttachment && isAudio(a)).length,
      gps: entries.some(([k]) => /latitude/.test(k)),
      score: score && { ...score, timedOut, seconds },
    };
    state.outbox.push({ id: f.id, response, formId: f.form.id, site: draftSite({ answers: entries }), assessment: state.assessment, savedAt: new Date().toISOString() });
    await saveOutbox();
    delete state.drafts[f.id];
    await saveDrafts();
    state.fill = null;
    state.syncStatus = null;
    submitting = false;
    go("done");
  }

  async function sendOne(entry) {
    try {
      await api("POST", "/api/collect/submit", { id: entry.id, response: entry.response });
      state.outbox = state.outbox.filter((x) => x.id !== entry.id);
      await saveOutbox();
      return "ok";
    } catch (e) {
      return e.status === 401 ? "signin" : e.status ? "failed" : "offline";
    }
  }

  /** "Sync to AHIP Database": sends every assessment waiting on this phone and refreshes the forms. */
  async function syncAll(announce) {
    if (!state.user || state.syncing) return;
    state.syncing = true;
    state.syncStatus = "running";
    if (["done", "summary"].includes(state.screen)) render();
    let result = "ok";
    for (const entry of [...state.outbox]) {
      const r = await sendOne(entry);
      if (r !== "ok") { result = r; break; }
    }
    if (result === "ok") await loadForms(false);
    state.syncing = false;
    state.syncStatus = result === "ok" ? "ok" : result === "offline" ? "offline" : "failed";
    if (result === "signin") toast("Please log in again to sync.");
    else if (announce) toast(result === "ok" ? "Synced to the AHIP database" : "Sync failed. Your data is safe on this device; try again when you are online.");
    if (result === "ok") { state.mine = null; state.mineOffline = false; }
    if (["done", "summary", "tools"].includes(state.screen)) render();
  }
  window.addEventListener("online", () => state.outbox.length && syncAll(false));

  function statusRow() {
    if (state.syncStatus === "running") return el("div", { class: "status-row" }, el("span", { class: "spinner" }), "Syncing…");
    if (state.syncStatus === "ok") return el("div", { class: "status-row" }, icon("check", "ok"), "Synced to the AHIP database");
    if (state.syncStatus === "offline") return el("div", { class: "status-row" }, icon("error", "bad"), "AHIP server not reachable. Your data is safe on this phone; sync again when you are online.");
    if (state.syncStatus === "failed") return el("div", { class: "status-row" }, icon("error", "bad"), "Sync failed. Your data is safe on this device; try again when you are online.");
    return null;
  }

  function renderDone() {
    const d = state.done;
    const check = (text) => el("div", { class: "check-row" }, icon("check"), text);
    const s = d.score;
    const t = toolOf(d.form);
    $app.replaceChildren(
      bar(`Tool ${t.number}: ${t.title}`, { onBack: () => go("tools") }),
      el("main", { class: "screen" }, el("div", { class: "done" },
        icon("upload", "big"),
        el("h2", { text: "Assessment Completed" }),
        s && el("div", { class: `score${s.percent >= 50 ? "" : " low"}` },
          el("div", { style: "font-weight:600", text: "Quiz score" }),
          el("div", { class: "pts", text: `${s.points} / ${s.total}` }),
          el("div", { text: `${s.percent}% · ${s.right} of ${s.count} questions correct` }),
          el("div", { class: "muted", style: "font-size:13px", text: `Time taken: ${fmtClock(s.seconds * 1000)}` }),
          s.timedOut && el("div", { style: "color:#8a1c1c;font-size:13px", text: "Time ran out: your answers were submitted automatically." })),
        check(plural(d.answered, "question answered", "questions answered")),
        d.photos > 0 && check(`Photos (${d.photos}) attached`),
        d.gps && check("GPS location captured"),
        d.audio > 0 && check(`Audio recordings (${d.audio}) attached`),
        check("Saved on this device"),
        check("Data validated (no errors)"),
        check("Ready to sync"),
        statusRow(),
        el("div", { style: "height:16px" }),
        el("div", { style: "width:100%;display:flex;flex-direction:column;gap:12px" },
          pill(state.syncing ? "Syncing…" : "Sync to AHIP Database", () => syncAll(true), { cls: "purple", lead: "upload", disabled: state.syncing }),
          pill("Save & Exit", () => go("tools"), { cls: "outline", arrow: false })))));
  }

  // ---------------------------------------------------------------- My Assessment Summary + AI
  async function renderSummary() {
    if (!state.mine) {
      $app.replaceChildren(bar("My Assessment Summary"), el("main", { class: "screen" }, el("div", { class: "center" }, el("span", { class: "spinner" }), "Loading…")));
      try { state.mine = (await api("GET", "/api/collect/mine")).submissions; state.mineOffline = false; } catch { state.mine = []; state.mineOffline = true; }
      if (state.screen !== "summary") return;
    }
    const mine = state.mine;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const week = new Date(today.getTime() - 6 * 864e5);
    const when = (m) => new Date(m.submitted);
    const all = tools();
    const counts = new Map(all.map((t) => [t.q.id, 0]));
    mine.forEach((m) => counts.set(m.formId, (counts.get(m.formId) || 0) + 1));
    const max = Math.max(1, ...counts.values());
    const stat = (iconName, cls, value, label, color) => el("div", { class: "stat" },
      el("span", { class: `tile ${cls}`.trim() }, icon(iconName)),
      el("div", {}, el("div", { class: "v", style: `color:${color}`, text: value }), el("div", { class: "l", text: label })));
    const assessmentName = (id) => { const a = ASSESSMENTS.find((x) => x.id === id); return a ? `${a.title} (${a.period})` : id || ""; };
    const recent = [
      ...state.outbox.map((o) => ({ formId: o.formId, site: o.site, assessment: o.assessment, submitted: o.savedAt, synced: false })),
      ...mine.map((m) => ({ ...m, synced: true })),
    ].slice(0, 20);
    $app.replaceChildren(
      bar("My Assessment Summary"),
      el("main", { class: "screen" },
        el("p", { class: "muted", style: "margin:0 0 4px;font-size:17px", text: `Data collector: ${state.user?.name || state.user?.username || ""}` }),
        state.mineOffline && el("p", { class: "muted", text: "Offline: showing what is on this phone." }),
        el("div", { class: "stats" },
          stat("clipboard", "", mine.length, "Total submitted", "var(--navy)"),
          stat("today", "green", mine.filter((m) => when(m) >= today).length, "Today", "var(--green)"),
          stat("week", "purple", mine.filter((m) => when(m) >= week).length, "Last 7 days", "var(--purple)"),
          stat("cloud", "green", state.outbox.length, "Waiting to sync", "var(--green)")),
        el("section", { class: "ai-card" },
          el("h3", {}, icon("sparkle"), "AI assistant"),
          el("p", { text: "Quick analysis of the forms YOU submitted: progress, CPPs covered and answers to check." }),
          el("div", { class: "ai-chips" }, AI_QUICK.map((q) => el("button", { onclick: () => openChat(q) }, q))),
          el("button", { class: "ai-open", onclick: () => openChat() }, "Ask a question")),
        el("section", { class: "sec-card" }, el("h3", { text: "Assessments by tool" }),
          el("div", { class: "sec-body" }, all.map((t) => el("div", { class: "bar-row" }, tile(t),
            el("div", { class: "grow" }, el("div", { class: "name", text: `Tool ${t.number}: ${t.title}` }),
              el("div", { class: "track2" }, el("span", { class: t.number % 2 ? "" : "green", style: `width:${(counts.get(t.q.id) / max) * 100}%` }))),
            el("div", { class: "n", text: counts.get(t.q.id) }))))),
        el("section", { class: "sec-card" }, el("h3", { text: "Recent submissions" }),
          el("div", { class: "sec-body" },
            !recent.length && el("p", { class: "muted", text: "No assessments submitted yet." }),
            recent.map((r) => {
              const form = state.forms.find((q) => q.id === r.formId);
              const t = form ? toolOf(form) : { number: 0, title: r.tool || "", icon: "description" };
              return el("div", { class: "recent" }, tile(t),
                el("div", { class: "grow" },
                  el("div", { class: "t", text: r.site || `Tool ${t.number}: ${t.title}` }),
                  el("div", { class: "s", text: [`Tool ${t.number}`, assessmentName(r.assessment), fmtWhen(r.submitted)].filter(Boolean).join(" · ") })),
                icon(r.synced ? "cloudDone" : "cloud", `cloud${r.synced ? "" : " wait"}`));
            })))),
      bottom(pill(state.syncing ? "Syncing…" : "Sync to AHIP Database", () => syncAll(true), { cls: "purple", lead: "upload", disabled: state.syncing })));
  }

  function openChat(question) {
    closeOverlays();
    const msgs = el("div", { class: "chat-msgs" });
    const input = el("input", { placeholder: "Type a question…", "aria-label": "Type a question", enterkeyhint: "send" });
    const send = el("button", { onclick: () => ask(input.value) }, "Ask");
    const draw = () => {
      msgs.replaceChildren(...(state.chat.length ? state.chat.map((m) => el("div", { class: `bubble ${m.role === "user" ? "me" : m.role === "error" ? "err" : "bot"}`, text: m.text }))
        : [el("div", { class: "chat-empty" }, el("p", { text: "Ask anything about the forms you have submitted (English or Kiswahili), or tap a question:" }),
          el("div", { class: "ai-chips" }, AI_QUICK.map((q) => el("button", { onclick: () => ask(q) }, q))))]));
      msgs.scrollTop = msgs.scrollHeight;
    };
    async function ask(q) {
      q = String(q || "").trim();
      if (!q || send.disabled) return;
      input.value = "";
      const history = state.chat.filter((m) => m.role === "user" || m.role === "model").map(({ role, text }) => ({ role, text }));
      state.chat.push({ role: "user", text: q });
      draw();
      send.disabled = true;
      msgs.append(el("div", { class: "bubble bot" }, el("span", { class: "spinner" }), " Analysing your data…"));
      msgs.scrollTop = msgs.scrollHeight;
      try {
        const r = await api("POST", "/api/collect/ai", { question: q, history });
        state.chat.push({ role: "model", text: String(r.answer || "").replace(/\*\*(.*?)\*\*/g, "$1").replace(/^\s*[*-]\s+/gm, "• ") });
      } catch (e) {
        state.chat.push({ role: "error", text: e.status ? e.message : "The AI needs the AHIP server. Check your internet or Wi-Fi and try again." });
      }
      send.disabled = false;
      draw();
    }
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") ask(input.value); });
    const sheet = el("div", { class: "chat", role: "dialog", "aria-modal": "true" },
      el("div", { class: "chat-head" },
        el("div", { class: "grow" }, el("h3", {}, "✦ AI assistant"), el("small", { text: "Only your own submitted forms" })),
        el("button", { onclick: () => { state.chat = []; draw(); } }, "New"),
        el("button", { "aria-label": "Close", onclick: () => sheet.remove() }, icon("close"))),
      msgs,
      el("div", { class: "chat-input" }, input, send),
      el("div", { class: "chat-note", text: "Uses only your synced forms. Photos, audio, GPS and phone numbers are not sent to the AI." }));
    document.body.append(sheet);
    draw();
    if (question) ask(question); else setTimeout(() => input.focus(), 50);
  }

  // ---------------------------------------------------------------- render + boot
  function render() {
    switch (state.screen) {
      case "welcome": return renderWelcome();
      case "login": return renderLogin();
      case "study": return renderStudy();
      case "assessment": return renderAssessment();
      case "tools": return renderTools();
      case "tool": return renderToolDetail();
      case "form": return renderForm();
      case "review": return renderReview();
      case "draftReview": return renderDraftReview();
      case "done": return renderDone();
      case "summary": return renderSummary();
      default: return renderWelcome();
    }
  }

  window.addEventListener("beforeunload", (e) => {
    if (state.fill?.saved) autosave(true);
    if (recorder) { e.preventDefault(); e.returnValue = ""; }
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden && state.fill?.saved) autosave(true); });

  (async function boot() {
    $app.replaceChildren(el("main", { class: "welcome" }, el("div", { class: "spacer" }), el("img", { class: "logo", src: "ahip_logo.png", alt: "AHIP" }), el("div", { class: "spacer" })));
    try {
      const { user, server } = await api("GET", "/api/collect/session");
      return startAs(user, server);
    } catch (e) {
      if (e.status === 401) { state.screen = "welcome"; history.replaceState({ screen: "welcome" }, ""); return renderWelcome(); }
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem("ahip_web_user") || "null"); } catch {}
      if (saved) { toast("Offline: your answers are kept on this phone and sent later."); return startAs(saved); }
      state.screen = "login";
      renderLogin("The AHIP server could not be reached. Check your internet or Wi-Fi.");
    }
  })();
})();
