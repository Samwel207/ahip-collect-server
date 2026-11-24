// AHIP Manage server — dashboard, user management, email invitations and mobile login.
//
//   FHIR_URL  FHIR server base URL   (default http://localhost:8089/fhir)
//   PORT      port to listen on      (default 8090)
//   DATA_DIR  where users/settings are stored (default ./data)
//
// Run: node server.js   — no dependencies.
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const mailer = require("./mailer");
const { createForms } = require("./lib/forms");
const { createAi } = require("./lib/ai");
const { createApiKeys } = require("./lib/apikeys");

const FHIR_URL = new URL((process.env.FHIR_URL || "http://localhost:8089/fhir").replace(/\/+$/, ""));
const PORT = Number(process.env.PORT || 8090);
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");

const SESSION_HOURS = 12;
const INVITE_DAYS = 7;
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

// ---------------------------------------------------------------- storage

fs.mkdirSync(DATA_DIR, { recursive: true });

function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(name, value) {
  const file = path.join(DATA_DIR, name);
  fs.writeFileSync(file + ".tmp", JSON.stringify(value, null, 2));
  fs.renameSync(file + ".tmp", file);
}

let users = readJson("users.json", []);

// Pick up accounts added on the server PC with tools/create-admin.js (no restart needed).
let usersFileTime = 0;
try { usersFileTime = fs.statSync(path.join(DATA_DIR, "users.json")).mtimeMs; } catch { /* no file yet */ }
fs.watchFile(path.join(DATA_DIR, "users.json"), { interval: 2000 }, (current) => {
  if (current.mtimeMs && current.mtimeMs !== usersFileTime) {
    usersFileTime = current.mtimeMs;
    users = readJson("users.json", users);
  }
});
let settings = readJson("settings.json", { publicUrl: "", smtp: {} });
let blockedDevices = readJson("blocked-devices.json", []);
const saveUsers = () => {
  writeJson("users.json", users);
  try { usersFileTime = fs.statSync(path.join(DATA_DIR, "users.json")).mtimeMs; } catch { /* ignore */ }
};
const saveSettings = () => writeJson("settings.json", settings);
const saveBlockedDevices = () => writeJson("blocked-devices.json", blockedDevices);
const isBlockedDevice = (id) => !!id && blockedDevices.some((d) => d.id === id);

// ---------------------------------------------------------------- crypto helpers

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

function checkPassword(password, stored) {
  if (!stored) return false;
  const [, saltHex, hashHex] = stored.split("$");
  const expected = Buffer.from(hashHex, "hex");
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const newToken = () => crypto.randomBytes(32).toString("base64url");

// ---------------------------------------------------------------- validation

const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
const EMAIL_RE = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;
const PHONE_RE = /^(\+?255|0)[0-9]{9}$/;

function cleanText(value, max = 120) {
  return String(value ?? "").replace(/[\r\n\t]+/g, " ").trim().slice(0, max);
}

function validateProfile(body, { requireAll = true } = {}) {
  const errors = [];
  const out = {};
  if (requireAll || body.name !== undefined) {
    out.name = cleanText(body.name);
    if (out.name.length < 2) errors.push("Full name is required.");
  }
  if (requireAll || body.email !== undefined) {
    out.email = cleanText(body.email, 254).toLowerCase();
    if (!EMAIL_RE.test(out.email)) errors.push("Enter a valid email address.");
  }
  if (requireAll || body.phone !== undefined) {
    out.phone = cleanText(body.phone, 20).replace(/[\s-]/g, "");
    if (!PHONE_RE.test(out.phone)) errors.push("Enter a valid Tanzanian phone number, e.g. +255712345678.");
  }
  if (requireAll || body.role !== undefined) {
    out.role = ROLES.includes(body.role) ? body.role : "collector";
  }
  return { errors, values: out };
}

/**
 * Roles: admin = everything in AHIP Manage; supervisor = home page (submitted data, charts, AI) and
 * the Forms designer only; collector = phone app and AHIP Collect Web, no AHIP Manage.
 */
const ROLES = ["collector", "supervisor", "admin"];
const MANAGE_ROLES = new Set(["admin", "supervisor"]);

function validatePassword(password) {
  if (typeof password !== "string" || password.length < 8) return "Password must be at least 8 characters.";
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return "Password must contain letters and numbers.";
  return null;
}

/** What clients may see about a user — never hashes or tokens. */
function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    phone: user.phone,
    email: user.email,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt || null,
    signOutRequestedAt: user.signOutRequestedAt || null,
    apiKey: user.apiKey ? { hint: user.apiKey.hint, createdAt: user.apiKey.createdAt, lastUsedAt: user.apiKey.lastUsedAt } : null,
    device: user.device || null,
    invite: user.invite
      ? { sentAt: user.invite.sentAt, expiresAt: user.invite.expiresAt, emailed: !!user.invite.emailed }
      : null,
  };
}

// ---------------------------------------------------------------- phones (one per account)

/** Device details sent by the AHIP Data Collect app; all optional except the id. */
function readDevice(input) {
  const d = input && typeof input === "object" ? input : {};
  const id = cleanText(d.id, 128);
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(id)) return null;
  return {
    id,
    name: cleanText(d.name, 80),
    manufacturer: cleanText(d.manufacturer, 60),
    model: cleanText(d.model, 60),
    android: cleanText(d.android, 20),
    appVersion: cleanText(d.appVersion, 40),
  };
}

function deviceLabel(d) {
  const model = [d.manufacturer, d.model].filter(Boolean).join(" ");
  return [...new Set([d.name, model].filter(Boolean))].join(", ") || "another phone";
}

// ---------------------------------------------------------------- sessions & rate limiting

/**
 * Sign-ins (AHIP Manage and AHIP Collect Web), kept in DATA_DIR/sessions.json so a server restart does
 * not sign everyone out. Only a SHA-256 hash of each token is stored.
 */
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");
const tokenHash = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");
const sessions = (() => {
  const map = new Map();
  try {
    for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf8")))) if (v.expiresAt > Date.now()) map.set(k, v);
  } catch { /* first start */ }
  let timer = null;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        for (const [k, v] of map) if (v.expiresAt < Date.now()) map.delete(k);
        fs.writeFileSync(SESSIONS_FILE + ".tmp", JSON.stringify(Object.fromEntries(map)), { mode: 0o600 });
        fs.renameSync(SESSIONS_FILE + ".tmp", SESSIONS_FILE);
      } catch (e) { console.error("Sessions:", e.message); }
    }, 300);
  };
  return {
    get: (t) => map.get(tokenHash(t)),
    set: (t, v) => { map.set(tokenHash(t), v); save(); },
    delete: (t) => { map.delete(tokenHash(t)); save(); },
  };
})();

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach((part) => {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function currentUser(req) {
  const token = parseCookies(req).ahip_session;
  const session = token && sessions.get(token);
  if (!session || session.kind === "collect") return null; // web-collection sessions never open AHIP Manage
  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  const user = users.find((u) => u.id === session.userId);
  return user && user.status === "active" ? user : null;
}

function startSession(res, user) {
  const token = newToken();
  sessions.set(token, { userId: user.id, expiresAt: Date.now() + SESSION_HOURS * 3600 * 1000 });
  res.setHeader(
    "Set-Cookie",
    `ahip_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}`,
  );
}

/** AI questions: up to AI_PER_WINDOW per person per 15 minutes (only to stop runaway use). */
const AI_PER_WINDOW = 60;
const aiUse = new Map(); // userId -> [timestamps]
function aiAllowed(userId) {
  const recent = (aiUse.get(userId) || []).filter((t) => Date.now() - t < FAILURE_WINDOW_MS);
  if (recent.length >= AI_PER_WINDOW) { aiUse.set(userId, recent); return false; }
  recent.push(Date.now());
  aiUse.set(userId, recent);
  return true;
}

const failures = new Map(); // key -> [timestamps]
function tooManyFailures(key) {
  const recent = (failures.get(key) || []).filter((t) => Date.now() - t < FAILURE_WINDOW_MS);
  failures.set(key, recent);
  return recent.length >= MAX_FAILURES;
}
const recordFailure = (key) => failures.set(key, [...(failures.get(key) || []), Date.now()]);

// ---------------------------------------------------------------- HTTP helpers

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 64 * 1024) {
        reject(new Error("Request too large"));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

// ---------------------------------------------------------------- invitations

function inviteLink(token) {
  const base = (settings.publicUrl || `http://localhost:${PORT}`).replace(/\/+$/, "");
  return `${base}/invite.html?token=${encodeURIComponent(token)}`;
}

async function issueInvite(user, invitedBy) {
  const token = newToken();
  user.invite = {
    tokenHash: sha256(token),
    sentAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + INVITE_DAYS * 86400000).toISOString(),
    emailed: false,
  };
  user.updatedAt = new Date().toISOString();
  saveUsers();

  const link = inviteLink(token);
  let emailError = null;
  if (mailer.isConfigured(settings.smtp)) {
    try {
      await mailer.send(settings.smtp, {
        to: user.email,
        subject: "Your AHIP Collect account invitation",
        text: inviteText(user, link, invitedBy),
        html: inviteHtml(user, link, invitedBy),
      });
      user.invite.emailed = true;
      saveUsers();
    } catch (error) {
      emailError = error.message;
    }
  } else {
    emailError = "Email is not set up yet (Settings → Email).";
  }
  return { link, emailed: user.invite.emailed, emailError };
}

function inviteText(user, link, invitedBy) {
  return [
    `Hello ${user.name},`,
    "",
    `${invitedBy?.name || "An AHIP administrator"} has invited you to collect data with AHIP Collect (Afya-Tek Phase III).`,
    "",
    `Your username: ${user.username}`,
    "",
    "Open this link to choose your password (connect to the office Wi-Fi first):",
    link,
    "",
    `The link expires in ${INVITE_DAYS} days. Then sign in to the AHIP Data Collect app with your username and password.`,
  ].join("\r\n");
}

function inviteHtml(user, link, invitedBy) {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  return `<!doctype html><html><body style="margin:0;background:#f4f6fb;font-family:Segoe UI,Arial,sans-serif;color:#10183a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden">
<tr><td style="background:#14246b;color:#fff;padding:18px 24px;font-size:20px;font-weight:700">AHIP Collect</td></tr>
<tr><td style="height:4px;background:#1e9b2e"></td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.5">
<p>Hello ${esc(user.name)},</p>
<p>${esc(invitedBy?.name || "An AHIP administrator")} has invited you to collect data with <b>AHIP Collect</b> (Afya-Tek Phase III).</p>
<p>Your username: <b>${esc(user.username)}</b></p>
<p style="margin:24px 0"><a href="${esc(link)}" style="background:#6f1a78;color:#fff;text-decoration:none;padding:12px 22px;border-radius:24px;font-weight:600">Choose your password</a></p>
<p style="font-size:13px;color:#4b5470">Connect to the office Wi-Fi before opening the link. It expires in ${INVITE_DAYS} days.<br>
If the button does not work, copy this address into your browser:<br>${esc(link)}</p>
<p>Then sign in to the <b>AHIP Data Collect</b> app with your username and password.</p>
</td></tr></table></td></tr></table></body></html>`;
}

function findInvite(token) {
  if (!token) return null;
  const hash = sha256(token);
  const user = users.find((u) => u.invite && u.invite.tokenHash === hash);
  if (!user || user.status === "deactivated" || new Date(user.invite.expiresAt) < new Date()) return null;
  return user;
}

// ---------------------------------------------------------------- API routes

async function handleApi(req, res, url) {
  const route = `${req.method} ${url.pathname}`;
  const me = currentUser(req);
  const isAdmin = me && me.role === "admin";
  const ip = req.socket.remoteAddress || "";

  // --- public
  if (route === "GET /api/session") {
    return sendJson(res, 200, { setupRequired: users.length === 0, user: me ? publicUser(me) : null });
  }

  if (route === "POST /api/setup") {
    // Administrators are never created from the web (anyone on the network could reach it).
    // Use the command on the server PC: docker exec -it ahip-dashboard node tools/create-admin.js
    return sendError(res, 403, "Creating administrators from the web is disabled. Use the create-admin command on the server PC.");
  }

  if (route === "POST /api/login") {
    const body = await readBody(req);
    const username = cleanText(body.username, 32).toLowerCase();
    const key = `web:${ip}:${username}`;
    if (tooManyFailures(key)) return sendError(res, 429, "Too many attempts. Wait 15 minutes and try again.");
    const user = users.find((u) => u.username === username);
    if (!user || user.status !== "active" || !MANAGE_ROLES.has(user.role) || !checkPassword(String(body.password || ""), user.passwordHash)) {
      recordFailure(key);
      return sendError(res, 401, "Wrong username or password, or this account cannot use the dashboard.");
    }
    user.lastLoginAt = new Date().toISOString();
    saveUsers();
    startSession(res, user);
    return sendJson(res, 200, { user: publicUser(user) });
  }

  if (route === "POST /api/logout") {
    const token = parseCookies(req).ahip_session;
    if (token) sessions.delete(token);
    res.setHeader("Set-Cookie", "ahip_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
    return sendJson(res, 200, { ok: true });
  }

  if (route === "GET /api/invite") {
    const user = findInvite(url.searchParams.get("token"));
    if (!user) return sendError(res, 404, "This invitation link is invalid or has expired. Ask your administrator to send a new one.");
    return sendJson(res, 200, { name: user.name, username: user.username, email: user.email });
  }

  if (route === "POST /api/invite") {
    const body = await readBody(req);
    const user = findInvite(body.token);
    if (!user) return sendError(res, 404, "This invitation link is invalid or has expired. Ask your administrator to send a new one.");
    const passwordError = validatePassword(body.password);
    if (passwordError) return sendError(res, 400, passwordError);
    user.passwordHash = hashPassword(body.password);
    user.status = "active";
    user.invite = null;
    user.activatedAt = user.updatedAt = new Date().toISOString();
    saveUsers();
    return sendJson(res, 200, { username: user.username });
  }

  // Phone app sign-in (AHIP Data Collect). Only activated accounts may sign in.
  if (route === "POST /api/mobile/login") {
    const body = await readBody(req);
    const username = cleanText(body.username, 32).toLowerCase();
    const key = `mobile:${ip}:${username}`;
    if (tooManyFailures(key)) return sendError(res, 429, "Too many attempts. Wait 15 minutes and try again.");
    const user = users.find((u) => u.username === username);
    if (!user || user.status !== "active" || !checkPassword(String(body.password || ""), user.passwordHash)) {
      recordFailure(key);
      return sendError(res, 401, "Wrong username or password.");
    }
    const device = readDevice(body.device);
    if (!device) return sendError(res, 400, "Please update the AHIP Data Collect app.");
    if (isBlockedDevice(device.id)) {
      return sendJson(res, 403, {
        error: "This phone has been blocked from using AHIP Collect. Contact your administrator.",
        code: "DEVICE_BLOCKED",
      });
    }
    // One phone per account: the first sign-in links the phone; other phones are refused until an
    // administrator resets the device. Checked only after the password, so it reveals nothing.
    if (user.device && user.device.id !== device.id) {
      return sendJson(res, 403, {
        error: `This account is linked to another phone (${deviceLabel(user.device)}). Ask your administrator to reset the device.`,
        code: "DEVICE_LOCKED",
      });
    }
    const now = new Date().toISOString();
    user.device = { ...device, linkedAt: user.device?.linkedAt || now, lastSeenAt: now };
    user.lastLoginAt = now;
    delete user.signOutRequestedAt; // signed in again with the password after "Reset app sign-in"
    saveUsers();
    return sendJson(res, 200, { username: user.username, name: user.name, phone: user.phone, email: user.email });
  }

  // Phone app: a collector creates a personal API key to share their own data (password needed).
  if (route === "POST /api/mobile/api-key") {
    const body = await readBody(req);
    const username = cleanText(body.username, 32).toLowerCase();
    const key = `apikey:${ip}:${username}`;
    if (tooManyFailures(key)) return sendError(res, 429, "Too many attempts. Wait 15 minutes and try again.");
    const user = users.find((u) => u.username === username);
    if (!user || user.status !== "active" || !checkPassword(String(body.password || ""), user.passwordHash)) {
      recordFailure(key);
      return sendError(res, 401, "Wrong username or password.");
    }
    const apiKey = apiKeys.issue(user);
    saveUsers();
    const base = `http://${req.headers.host || "localhost:" + PORT}`;
    return sendJson(res, 200, {
      apiKey,
      jsonUrl: `${base}/api/v1/my-submissions`,
      csvUrl: `${base}/api/v1/my-submissions.csv`,
      howTo: "Send the key in the header 'X-API-Key' (or add ?api_key=KEY to the link). Creating a new key stops the old one.",
    });
  }

  // Phone app AI assistant: answers only from the signed-in collector's own submissions, and only
  // from the phone linked to the account.
  if (route === "POST /api/mobile/ai") {
    const body = JSON.parse((await readRaw(req, 256 * 1024)).toString("utf8") || "{}");
    const username = cleanText(body.username, 32).toLowerCase();
    const user = users.find((u) => u.username === username);
    const deviceId = cleanText(body.deviceId, 128);
    if (!user || user.status !== "active" || !user.device || user.device.id !== deviceId || isBlockedDevice(deviceId)) {
      return sendError(res, 403, "The AI assistant is only available on your own linked phone.");
    }
    if (!aiAllowed(user.id)) return sendError(res, 429, "Too many questions in a short time. Wait a few minutes and try again.");
    try {
      const ids = await ai.idsForCollector(username);
      const answer = await ai.ask({
        question: body.question,
        history: Array.isArray(body.history) ? body.history : [],
        view: { ids, description: `Only the submissions of data collector ${user.name || username}` },
        audience: "collector",
      });
      return sendJson(res, 200, answer);
    } catch (error) {
      return sendJson(res, error.status || 500, { error: error.message || "The AI assistant failed." });
    }
  }

  // Data shared with an API key: only the key owner's own submissions (JSON or CSV).
  if (req.method === "GET" && /^\/api\/v1\/my-submissions(\.csv|\.json)?$/.test(url.pathname)) {
    const owner = apiKeys.findUser(users, apiKeys.keyFrom(req, url));
    if (!owner || owner.status !== "active") return sendError(res, 401, "Missing or invalid API key.");
    if (tooManyFailures(`apiuse:${owner.id}`)) return sendError(res, 429, "Too many requests. Try again later.");
    recordFailure(`apiuse:${owner.id}`); // simple rate limit: at most MAX_FAILURES calls per 15 minutes
    owner.apiKey.lastUsedAt = new Date().toISOString();
    saveUsers();
    try {
      const rows = await apiKeys.submissionsFor(owner.username, { media: url.searchParams.get("media") === "1" });
      if (url.pathname.endsWith(".csv")) {
        res.writeHead(200, {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="ahip-${owner.username}-submissions.csv"`,
          "Cache-Control": "no-store",
        });
        return res.end("﻿" + apiKeys.toCsv(rows));
      }
      return sendJson(res, 200, { collector: owner.username, name: owner.name, count: rows.length, generated: new Date().toISOString(), submissions: rows });
    } catch (error) {
      return sendError(res, 502, `Could not read the data: ${error.message}`);
    }
  }

  // Phone app check that a signed-in account is still allowed (deactivated / unknown → sign out).
  if (route === "POST /api/mobile/status") {
    const body = await readBody(req);
    const username = cleanText(body.username, 32).toLowerCase();
    const user = users.find((u) => u.username === username);
    const deviceId = cleanText(body.deviceId, 128);
    const deviceOk = !user?.device || !deviceId || user.device.id === deviceId;
    const blocked = isBlockedDevice(deviceId);
    const signedOut = !!user?.signOutRequestedAt;
    const active = !!user && user.status === "active" && deviceOk && !blocked && !signedOut;
    if (active && user.device && deviceId === user.device.id) {
      user.device.lastSeenAt = new Date().toISOString();
      saveUsers();
    }
    const reason = blocked
      ? "device-blocked"
      : !user || user.status !== "active" ? "inactive"
      : !deviceOk ? "other-device"
      : signedOut ? "signed-out" : null;
    return sendJson(res, 200, { active, reason });
  }

  // --- AHIP Collect Web (browser data collection for iPhones): its own sign-in and session
  if (url.pathname.startsWith("/api/collect/")) return handleCollect(req, res, url, route, ip);

  // --- signed in to AHIP Manage: administrators and supervisors
  if (!me) return sendError(res, 401, "Sign in required.");
  if (!MANAGE_ROLES.has(me.role)) return sendError(res, 403, "This account cannot use AHIP Manage.");

  // --- Forms: design the tool questions (published to the FHIR server; phones get them on Sync)
  if (url.pathname.startsWith("/api/forms")) return handleForms(req, res, url, me);

  // --- AI assistant (Gemini): questions about the data, help with form design
  if (route === "GET /api/ai/status") return sendJson(res, 200, ai.status());
  if (route === "POST /api/ai/ask") {
    try {
      const body = JSON.parse((await readRaw(req, 4 * 1024 * 1024)).toString("utf8") || "{}");
      return sendJson(res, 200, await ai.ask(body));
    } catch (error) {
      console.error("AI:", error.message);
      return sendJson(res, error.status || 500, { error: error.message || "The AI assistant failed." });
    }
  }

  // Supervisors only need names for the charts and tables (no contact details, phones or keys).
  if (route === "GET /api/users" && !isAdmin) {
    return sendJson(res, 200, { users: users.map((u) => ({ username: u.username, name: u.name, role: u.role })) });
  }

  // --- administrators only below (users, phones, settings, API keys)
  if (!isAdmin) return sendError(res, 403, "Administrators only.");

  if (route === "GET /api/users") {
    return sendJson(res, 200, { users: users.map(publicUser) });
  }

  if (route === "POST /api/users") {
    const body = await readBody(req);
    const { errors, values } = validateProfile(body);
    const username = cleanText(body.username, 32).toLowerCase();
    if (!USERNAME_RE.test(username)) errors.push("Username: 3–32 lowercase letters, numbers, dot, dash or underscore.");
    if (users.some((u) => u.username === username)) errors.push("That username is already taken.");
    if (users.some((u) => u.email === values.email)) errors.push("A user with that email already exists.");
    if (errors.length) return sendError(res, 400, errors.join(" "));
    const now = new Date().toISOString();
    const user = { id: crypto.randomUUID(), username, ...values, status: "invited", passwordHash: null, createdAt: now, updatedAt: now };
    users.push(user);
    saveUsers();
    const invite = await issueInvite(user, me);
    return sendJson(res, 201, { user: publicUser(user), ...invite });
  }

  const userMatch = url.pathname.match(/^\/api\/users\/([0-9a-f-]{36})(\/invite|\/reset-device|\/reset-signin|\/revoke-api-key)?$/);
  if (userMatch) {
    const user = users.find((u) => u.id === userMatch[1]);
    if (!user) return sendError(res, 404, "User not found.");

    // Signs the user out of the phone app: the next time the app connects it forgets the PIN and
    // saved password, and only a username + password sign-in (which clears this) lets them back in.
    if (req.method === "POST" && userMatch[2] === "/revoke-api-key") {
      apiKeys.revoke(user);
      user.updatedAt = new Date().toISOString();
      saveUsers();
      return sendJson(res, 200, { user: publicUser(user) });
    }

    if (req.method === "POST" && userMatch[2] === "/reset-signin") {
      user.signOutRequestedAt = user.updatedAt = new Date().toISOString();
      saveUsers();
      return sendJson(res, 200, { user: publicUser(user) });
    }

    if (req.method === "POST" && userMatch[2] === "/reset-device") {
      user.device = null;
      user.updatedAt = new Date().toISOString();
      saveUsers();
      return sendJson(res, 200, { user: publicUser(user) });
    }

    if (req.method === "POST" && userMatch[2] === "/invite") {
      if (user.status === "deactivated") return sendError(res, 400, "Reactivate the user before inviting them again.");
      const invite = await issueInvite(user, me);
      if (user.status === "active") {
        // A new invite on an active account is a password reset: the old password stops working.
        user.status = "invited";
        user.passwordHash = null;
        saveUsers();
      }
      return sendJson(res, 200, { user: publicUser(user), ...invite });
    }

    if (req.method === "PATCH" && !userMatch[2]) {
      const body = await readBody(req);
      const { errors, values } = validateProfile(body, { requireAll: false });
      if (values.email && users.some((u) => u.id !== user.id && u.email === values.email)) errors.push("A user with that email already exists.");
      if (body.status !== undefined && !["active", "deactivated"].includes(body.status)) errors.push("Unknown status.");
      if (user.id === me.id && (body.status === "deactivated" || (values.role && values.role !== "admin"))) errors.push("You cannot deactivate or demote your own account.");
      if (errors.length) return sendError(res, 400, errors.join(" "));
      Object.assign(user, values);
      if (body.status === "deactivated") user.status = "deactivated";
      if (body.status === "active" && user.status === "deactivated") user.status = user.passwordHash ? "active" : "invited";
      user.updatedAt = new Date().toISOString();
      saveUsers();
      return sendJson(res, 200, { user: publicUser(user) });
    }
  }

  // --- blocked phones: a blocked phone cannot use the app with any account
  if (route === "GET /api/devices/blocked") {
    return sendJson(res, 200, { devices: blockedDevices });
  }

  if (route === "POST /api/devices/block") {
    const body = await readBody(req);
    const user = users.find((u) => u.id === body.userId);
    if (!user || !user.device) return sendError(res, 400, "That user has no linked phone to block.");
    const device = user.device;
    if (!isBlockedDevice(device.id)) {
      blockedDevices.push({
        id: device.id,
        name: device.name,
        manufacturer: device.manufacturer,
        model: device.model,
        lastUser: { username: user.username, name: user.name },
        reason: cleanText(body.reason, 200),
        blockedAt: new Date().toISOString(),
        blockedBy: me.name,
      });
      saveBlockedDevices();
    }
    // Free the account so the user can be given another phone if appropriate.
    user.device = null;
    user.updatedAt = new Date().toISOString();
    saveUsers();
    return sendJson(res, 200, { devices: blockedDevices });
  }

  if (route === "POST /api/devices/unblock") {
    const body = await readBody(req);
    blockedDevices = blockedDevices.filter((d) => d.id !== String(body.id || ""));
    saveBlockedDevices();
    return sendJson(res, 200, { devices: blockedDevices });
  }

  if (route === "GET /api/settings") {
    const smtp = settings.smtp || {};
    return sendJson(res, 200, {
      publicUrl: settings.publicUrl || "",
      smtp: { host: smtp.host || "", port: smtp.port || 465, security: smtp.security || "ssl", user: smtp.user || "", from: smtp.from || "", fromName: smtp.fromName || "AHIP Collect", hasPassword: !!smtp.pass },
    });
  }

  if (route === "PUT /api/settings") {
    const body = await readBody(req);
    const smtpIn = body.smtp || {};
    const publicUrl = cleanText(body.publicUrl, 200).replace(/\/+$/, "");
    if (publicUrl && !/^https?:\/\/[^\s/]+(:\d+)?$/.test(publicUrl)) return sendError(res, 400, "Dashboard address must look like http://192.168.1.10:8090");
    settings = {
      publicUrl,
      smtp: {
        host: cleanText(smtpIn.host, 200),
        port: Number(smtpIn.port) || 465,
        security: smtpIn.security === "starttls" ? "starttls" : "ssl",
        user: cleanText(smtpIn.user, 254),
        pass: smtpIn.pass ? String(smtpIn.pass) : settings.smtp?.pass || "",
        from: cleanText(smtpIn.from, 254),
        fromName: cleanText(smtpIn.fromName, 80) || "AHIP Collect",
      },
    };
    saveSettings();
    return sendJson(res, 200, { ok: true });
  }

  if (route === "POST /api/settings/test-email") {
    const body = await readBody(req);
    const to = cleanText(body.to, 254);
    if (!EMAIL_RE.test(to)) return sendError(res, 400, "Enter a valid email address to send the test to.");
    if (!mailer.isConfigured(settings.smtp)) return sendError(res, 400, "Save the email settings first.");
    try {
      await mailer.send(settings.smtp, {
        to,
        subject: "AHIP Collect — test email",
        text: "Email from AHIP Manage is working. Invitations will be sent from this address.",
        html: "<p>Email from <b>AHIP Manage</b> is working. Invitations will be sent from this address.</p>",
      });
      return sendJson(res, 200, { ok: true });
    } catch (error) {
      return sendError(res, 502, `Sending failed: ${error.message}`);
    }
  }

  return sendError(res, 404, "Not found.");
}

// ---------------------------------------------------------------- Forms (admins)

const forms = createForms({ fhirUrl: FHIR_URL, dataDir: DATA_DIR });
const ai = createAi({ fhirUrl: FHIR_URL });
const apiKeys = createApiKeys({ fhirUrl: FHIR_URL });

// Keep the "Name of CPP" dropdown up to date with every CPP submitted (every 30 minutes).
const refreshCpps = () =>
  forms.refreshCppList().then(
    (r) => r.updated.length && console.log(`CPP list: ${r.cpps} CPPs, updated ${r.updated.join(", ")}`),
    (e) => console.error("CPP list:", e.message),
  );
// Give the six original tools their shared tool number (once), then keep the CPP list fresh.
const startForms = (attempt = 1) =>
  forms.ensureRegistry().then(
    (n) => { if (n) console.log(`Forms: numbered ${n} original tool(s)`); refreshCpps(); },
    (e) => { console.error("Forms registry:", e.message); if (attempt < 20) setTimeout(() => startForms(attempt + 1), 30000); },
  );
setTimeout(startForms, 15000);
setInterval(refreshCpps, 30 * 60 * 1000);

/** Reads a raw request body (uploaded Excel file) up to maxBytes. */
function readRaw(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error("The file is too large."), { status: 413 }));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const sendXlsx = (res, name, buffer) => {
  res.writeHead(200, {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="${name}"`,
    "Cache-Control": "no-store",
  });
  res.end(buffer);
};

async function handleForms(req, res, url, me) {
  const route = `${req.method} ${url.pathname}`;
  try {
    if (route === "GET /api/forms") return sendJson(res, 200, { forms: await forms.list() });
    if (route === "GET /api/forms/template.xlsx") return sendXlsx(res, "AHIP-form-template.xlsx", forms.template());
    if (route === "POST /api/forms/refresh-cpp-list") return sendJson(res, 200, await forms.refreshCppList(me.name));
    if (route === "POST /api/forms") {
      const body = JSON.parse((await readRaw(req, 64 * 1024)).toString("utf8") || "{}");
      return sendJson(res, 201, { form: await forms.create(body, me.name) });
    }

    const m = url.pathname.match(/^\/api\/forms\/([a-z0-9-]{1,64})(\/[a-z.]+)?$/);
    if (!m) return sendError(res, 404, "Not found.");
    const [, id, action = ""] = m;

    if (req.method === "GET" && !action) return sendJson(res, 200, { form: await forms.get(id) });
    if (req.method === "PUT" && !action) {
      const body = JSON.parse((await readRaw(req, 8 * 1024 * 1024)).toString("utf8") || "{}");
      const saved = await forms.publish(id, body.form, me.name, cleanText(body.note, 200) || "Published");
      return sendJson(res, 200, { form: saved });
    }
    if (req.method === "POST" && action === "/validate") {
      const body = JSON.parse((await readRaw(req, 8 * 1024 * 1024)).toString("utf8") || "{}");
      return sendJson(res, 200, { errors: forms.validate(body.form, id) });
    }
    if (req.method === "GET" && action === "/history") return sendJson(res, 200, { versions: forms.history(id) });
    if (req.method === "POST" && action === "/delete") return sendJson(res, 200, await forms.removeForm(id, me.name));
    if (req.method === "POST" && action === "/archive") {
      const body = JSON.parse((await readRaw(req, 4 * 1024)).toString("utf8") || "{}");
      return sendJson(res, 200, { form: await forms.setArchived(id, body.archived !== false, me.name) });
    }
    if (req.method === "POST" && action === "/restore") {
      const body = JSON.parse((await readRaw(req, 64 * 1024)).toString("utf8") || "{}");
      return sendJson(res, 200, { form: await forms.restore(id, String(body.file || ""), me.name) });
    }
    if (req.method === "GET" && action === "/export.xlsx") return sendXlsx(res, `${id}.xlsx`, await forms.exportExcel(id));
    if (req.method === "POST" && action === "/import") {
      const buffer = await readRaw(req, 5 * 1024 * 1024);
      return sendJson(res, 200, await forms.importExcel(id, buffer, url.searchParams.get("mode")));
    }
    return sendError(res, 404, "Not found.");
  } catch (error) {
    return sendJson(res, error.status || 400, { error: error.message || "Could not process the form.", errors: error.errors });
  }
}

// ---------------------------------------------------------------- AHIP Collect Web

const COLLECTOR_TAG = "urn:ahip:data-collector";

/** The signed-in web data collector (cookie ahip_collect), or null. */
function collectUser(req) {
  const token = parseCookies(req).ahip_collect;
  const session = token && sessions.get(token);
  if (!session || session.kind !== "collect") return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  const user = users.find((u) => u.id === session.userId);
  return user && user.status === "active" && !isBlockedUser(user) ? user : null;
}
const isBlockedUser = (user) => !!user.signOutRequestedAt;

/** Writes one resource to the FHIR server (used only for web submissions). */
function fhirPut(resourcePath, resource) {
  const target = new URL(FHIR_URL.href.replace(/\/$/, "") + resourcePath);
  const payload = Buffer.from(JSON.stringify(resource));
  const lib = target.protocol === "https:" ? require("https") : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(target, {
      method: "PUT",
      timeout: 60000,
      headers: { Accept: "application/fhir+json", "Content-Type": "application/fhir+json", "Content-Length": payload.length },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* not JSON */ }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(json);
        else reject(new Error(json?.issue?.[0]?.diagnostics || `FHIR server error ${res.statusCode}`));
      });
    });
    req.on("timeout", () => req.destroy(new Error("FHIR server timed out")));
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

const WEB_ID_RE = /^web-[a-z0-9-]{8,60}$/;
const KEEP_RESPONSE_EXT = new Set(["urn:ahip:quiz-seconds", "urn:ahip:quiz-timed-out"]);

async function handleCollect(req, res, url, route, ip) {
  try {
    if (route === "POST /api/collect/login") {
      const body = await readBody(req);
      const username = cleanText(body.username, 32).toLowerCase();
      const key = `collect:${ip}:${username}`;
      if (tooManyFailures(key)) return sendError(res, 429, "Too many attempts. Wait 15 minutes and try again.");
      const user = users.find((u) => u.username === username);
      if (!user || user.status !== "active" || !checkPassword(String(body.password || ""), user.passwordHash)) {
        recordFailure(key);
        return sendError(res, 401, "Wrong username or password.");
      }
      const token = newToken();
      sessions.set(token, { userId: user.id, kind: "collect", expiresAt: Date.now() + SESSION_HOURS * 3600 * 1000 });
      res.setHeader("Set-Cookie", `ahip_collect=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}`);
      user.lastLoginAt = new Date().toISOString();
      saveUsers();
      return sendJson(res, 200, { user: { username: user.username, name: user.name } });
    }
    if (route === "POST /api/collect/logout") {
      const token = parseCookies(req).ahip_collect;
      if (token) sessions.delete(token);
      res.setHeader("Set-Cookie", "ahip_collect=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
      return sendJson(res, 200, { ok: true });
    }

    const me = collectUser(req);
    if (!me) return sendError(res, 401, "Sign in required.");

    if (route === "GET /api/collect/session") return sendJson(res, 200, { user: { username: me.username, name: me.name }, server: req.headers.host || "" });

    if (route === "GET /api/collect/forms") {
      const list = (await forms.allForms()).filter((q) => q.status !== "retired");
      return sendJson(res, 200, { forms: list });
    }

    if (route === "GET /api/collect/mine") {
      const mine = await apiKeys.submissionsFor(me.username);
      return sendJson(res, 200, {
        submissions: mine.map(({ id, tool, formId, site, assessment, submitted }) => ({ id, tool, formId, site, assessment, submitted })),
      });
    }

    // AI assistant, as in the phone app: answers only from this collector's own submissions.
    if (route === "POST /api/collect/ai") {
      const body = JSON.parse((await readRaw(req, 256 * 1024)).toString("utf8") || "{}");
      if (!aiAllowed(me.id)) return sendError(res, 429, "Too many questions in a short time. Wait a few minutes and try again.");
      const ids = await ai.idsForCollector(me.username);
      const answer = await ai.ask({
        question: body.question,
        history: Array.isArray(body.history) ? body.history.slice(-12) : [],
        view: { ids, description: `Only the submissions of data collector ${me.name || me.username}` },
        audience: "collector",
      });
      return sendJson(res, 200, answer);
    }

    // "Share my data (API key)", as in the phone app: the password is asked again.
    if (route === "POST /api/collect/api-key") {
      const body = await readBody(req);
      const key = `apikey:${ip}:${me.username}`;
      if (tooManyFailures(key)) return sendError(res, 429, "Too many attempts. Wait 15 minutes and try again.");
      if (!checkPassword(String(body.password || ""), me.passwordHash)) {
        recordFailure(key);
        return sendError(res, 401, "Wrong password.");
      }
      const apiKey = apiKeys.issue(me);
      saveUsers();
      const proto = req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
      const base = `${proto}://${req.headers.host || "localhost:" + PORT}`;
      return sendJson(res, 200, { apiKey, jsonUrl: `${base}/api/v1/my-submissions`, csvUrl: `${base}/api/v1/my-submissions.csv` });
    }

    if (route === "POST /api/collect/submit") {
      const body = JSON.parse((await readRaw(req, 40 * 1024 * 1024)).toString("utf8") || "{}");
      const r = body.response || {};
      const id = String(body.id || "");
      if (!WEB_ID_RE.test(id)) return sendError(res, 400, "Bad submission id.");
      const formId = String(r.questionnaire || "").replace(/^Questionnaire\//, "");
      const form = (await forms.allForms()).find((q) => q.id === formId && q.status !== "retired");
      if (r.resourceType !== "QuestionnaireResponse" || !form) return sendError(res, 400, "Unknown form.");
      if (!Array.isArray(r.item) || !r.item.length) return sendError(res, 400, "The submission has no answers.");
      const authored = Date.parse(r.authored) ? new Date(r.authored).toISOString() : new Date().toISOString();
      const clean = {
        resourceType: "QuestionnaireResponse",
        id,
        meta: {
          tag: [
            { system: COLLECTOR_TAG, code: me.username, display: me.username },
            { system: "https://smartregister.org/app-version", code: "ahip-collect-web", display: "Application Version" },
          ],
        },
        questionnaire: `Questionnaire/${form.id}`,
        status: "completed",
        authored,
        item: r.item,
      };
      const ext = (r.extension || []).filter((e) => KEEP_RESPONSE_EXT.has(e.url));
      if (ext.length) clean.extension = ext;
      await fhirPut(`/QuestionnaireResponse/${id}`, clean);
      return sendJson(res, 200, { ok: true, id });
    }
    return sendError(res, 404, "Not found.");
  } catch (error) {
    console.error("Collect web:", error.message);
    return sendError(res, error.status || 500, error.message || "Could not process the request.");
  }
}

// ---------------------------------------------------------------- FHIR proxy (admins, read-only)

function proxyFhir(req, res) {
  const me = currentUser(req);
  if (!me || !MANAGE_ROLES.has(me.role)) return sendError(res, 401, "Sign in required.");
  if (req.method !== "GET" && req.method !== "HEAD") return sendError(res, 405, "Read-only.");

  const incoming = new URL(req.url, "http://dashboard");
  const target = new URL(FHIR_URL.href);
  target.pathname = FHIR_URL.pathname + incoming.pathname.replace(/^\/fhir/, "");
  target.search = incoming.search;

  const upstream = http.request(
    target,
    { method: req.method, headers: { Accept: "application/fhir+json" }, timeout: 30000 },
    (up) => {
      res.writeHead(up.statusCode || 502, {
        "Content-Type": up.headers["content-type"] || "application/fhir+json",
        "Cache-Control": "no-store",
      });
      up.pipe(res);
    },
  );
  upstream.on("timeout", () => upstream.destroy(new Error("FHIR server timed out")));
  upstream.on("error", (err) => sendError(res, 502, `FHIR server unavailable: ${err.message}`));
  upstream.end();
}

// ---------------------------------------------------------------- static files

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, "http://dashboard").pathname);
  const page = urlPath === "/" ? "index.html" : urlPath === "/collect" || urlPath === "/collect/" ? "collect.html" : urlPath;
  const file = path.normalize(path.join(PUBLIC_DIR, page));
  if (!file.startsWith(PUBLIC_DIR)) return sendError(res, 403, "Forbidden");
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Not found");
    }
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
    });
    res.end(data);
  });
}

// ---------------------------------------------------------------- server

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://dashboard");
    try {
      if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
      if (url.pathname === "/fhir" || url.pathname.startsWith("/fhir/")) return proxyFhir(req, res);
      return serveStatic(req, res);
    } catch (error) {
      console.error(error);
      if (!res.headersSent) sendError(res, 400, error.message || "Bad request");
    }
  })
  .listen(PORT, "0.0.0.0", () => {
    console.log(`AHIP Manage on http://localhost:${PORT}  (FHIR: ${FHIR_URL.href}, data: ${DATA_DIR})`);
  });
