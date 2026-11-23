#!/usr/bin/env node
// Creates an AHIP Manage administrator. For safety this is only possible on the server PC
// (the web page no longer offers it). Run:
//   docker exec -it ahip-dashboard node tools/create-admin.js
// The running server picks up the new account within a few seconds.
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "users.json");
const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
const EMAIL_RE = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;
const PHONE_RE = /^(\+?255|0)[0-9]{9}$/;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
let muted = false;
rl._writeToOutput = (text) => { if (!muted || /\r?\n/.test(text)) rl.output.write(muted ? "\n" : text); };

const lines = rl[Symbol.asyncIterator]();
const ask = async (question, { secret = false } = {}) => {
  rl.output.write(question);
  muted = secret;
  const { value, done } = await lines.next();
  muted = false;
  if (done) throw new Error("input ended");
  return String(value).trim();
};

async function askValid(question, check, options) {
  for (;;) {
    const value = await ask(question, options);
    const problem = check(value);
    if (!problem) return value;
    console.log(`  ${problem}`);
  }
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString("hex")}$${crypto.scryptSync(password, salt, 64).toString("hex")}`;
}

(async () => {
  let users = [];
  try { users = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { /* first account */ }
  console.log(`\nCreate an AHIP Manage administrator (${users.length} account(s) exist).\n`);

  const name = await askValid("Full name: ", (v) => (v.length >= 2 ? null : "Enter the full name."));
  const username = (await askValid("Username: ", (v) =>
    !USERNAME_RE.test(v.toLowerCase()) ? "3–32 lowercase letters, numbers, dot, dash or underscore."
      : users.some((u) => u.username === v.toLowerCase()) ? "That username is already taken." : null)).toLowerCase();
  const email = (await askValid("Email: ", (v) =>
    !EMAIL_RE.test(v) ? "Enter a valid email address."
      : users.some((u) => u.email === v.toLowerCase()) ? "A user with that email already exists." : null)).toLowerCase();
  const phone = (await askValid("Phone (+255…): ", (v) => (PHONE_RE.test(v.replace(/[\s-]/g, "")) ? null : "e.g. +255712345678"))).replace(/[\s-]/g, "");
  let password;
  for (;;) {
    password = await askValid("Password (hidden): ", (v) =>
      v.length < 8 ? "At least 8 characters." : !/[A-Za-z]/.test(v) || !/[0-9]/.test(v) ? "Use letters and numbers." : null, { secret: true });
    if ((await ask("Confirm password: ", { secret: true })) === password) break;
    console.log("  The passwords do not match. Try again.");
  }

  const now = new Date().toISOString();
  users.push({ id: crypto.randomUUID(), username, name, email, phone, role: "admin", status: "active", passwordHash: hashPassword(password), createdAt: now, updatedAt: now });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE + ".tmp", JSON.stringify(users, null, 2));
  fs.renameSync(FILE + ".tmp", FILE);
  console.log(`\nAdministrator "${username}" created. Sign in at AHIP Manage within a few seconds.\n`);
  rl.close();
})().catch((error) => {
  console.error("Could not create the administrator:", error.message);
  process.exit(1);
});
