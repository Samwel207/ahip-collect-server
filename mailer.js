// Minimal SMTP client (no dependencies): SSL on 465 or STARTTLS on 587, AUTH LOGIN/PLAIN.
"use strict";

const net = require("net");
const tls = require("tls");
const crypto = require("crypto");

const TIMEOUT_MS = 20000;

function isConfigured(smtp) {
  return !!(smtp && smtp.host && smtp.port && smtp.user && smtp.pass && smtp.from);
}

/** Removes characters that could inject extra mail headers. */
const headerSafe = (s) => String(s ?? "").replace(/[\r\n]+/g, " ").trim();
const encodeWord = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`);
const b64 = (s) => Buffer.from(s, "utf8").toString("base64").replace(/.{76}/g, "$&\r\n");

function buildMessage(smtp, { to, subject, text, html }) {
  const boundary = `ahip-${crypto.randomBytes(12).toString("hex")}`;
  const fromName = headerSafe(smtp.fromName || "AHIP Collect");
  const domain = headerSafe(smtp.from).split("@")[1] || "localhost";
  return [
    `From: ${encodeWord(fromName)} <${headerSafe(smtp.from)}>`,
    `To: <${headerSafe(to)}>`,
    `Subject: ${encodeWord(headerSafe(subject))}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64(text),
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64(html),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

/** Reads SMTP replies line by line; resolves each complete (possibly multi-line) reply. */
function replyReader(socket) {
  let buffer = "";
  let lines = [];
  const waiting = [];
  const ready = [];
  const onData = (chunk) => {
    buffer += chunk.toString("utf8");
    let i;
    while ((i = buffer.indexOf("\r\n")) >= 0) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 2);
      lines.push(line);
      if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) {
        const reply = { code: Number(line.slice(0, 3)), text: lines.join("\n") };
        lines = [];
        const next = waiting.shift();
        next ? next(reply) : ready.push(reply);
      }
    }
  };
  socket.on("data", onData);
  return {
    next: () => new Promise((resolve) => (ready.length ? resolve(ready.shift()) : waiting.push(resolve))),
    detach: () => socket.removeListener("data", onData),
  };
}

function connect(smtp) {
  return new Promise((resolve, reject) => {
    const options = { host: smtp.host, port: Number(smtp.port), servername: smtp.host };
    const socket = smtp.security === "starttls" ? net.connect(options) : tls.connect(options);
    socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error("Mail server timed out")));
    socket.once(smtp.security === "starttls" ? "connect" : "secureConnect", () => resolve(socket));
    socket.once("error", reject);
  });
}

async function send(smtp, mail) {
  if (!isConfigured(smtp)) throw new Error("Email is not configured");
  let socket = await connect(smtp);
  let reader = replyReader(socket);
  const errors = [];
  socket.on("error", (e) => errors.push(e));

  const expect = async (codes, what) => {
    const reply = await reader.next();
    if (errors.length) throw errors[0];
    if (!codes.includes(reply.code)) throw new Error(`${what} failed: ${reply.text.replace(/\s+/g, " ").slice(0, 200)}`);
    return reply;
  };
  const command = async (line, codes, what) => {
    socket.write(line + "\r\n");
    return expect(codes, what);
  };

  try {
    await expect([220], "Connection");
    let ehlo = await command("EHLO ahip-manage", [250], "EHLO");
    if (smtp.security === "starttls") {
      await command("STARTTLS", [220], "STARTTLS");
      reader.detach();
      socket = await new Promise((resolve, reject) => {
        const secure = tls.connect({ socket, servername: smtp.host }, () => resolve(secure));
        secure.once("error", reject);
      });
      socket.on("error", (e) => errors.push(e));
      reader = replyReader(socket);
      ehlo = await command("EHLO ahip-manage", [250], "EHLO");
    }
    if (/AUTH[ =][^\n]*PLAIN/i.test(ehlo.text) && !/AUTH[ =][^\n]*LOGIN/i.test(ehlo.text)) {
      const token = Buffer.from(`\u0000${smtp.user}\u0000${smtp.pass}`, "utf8").toString("base64");
      await command(`AUTH PLAIN ${token}`, [235], "Sign-in");
    } else {
      await command("AUTH LOGIN", [334], "Sign-in");
      await command(Buffer.from(smtp.user, "utf8").toString("base64"), [334], "Sign-in");
      await command(Buffer.from(smtp.pass, "utf8").toString("base64"), [235], "Sign-in (check the username and app password)");
    }
    await command(`MAIL FROM:<${headerSafe(smtp.from)}>`, [250], "Sender");
    await command(`RCPT TO:<${headerSafe(mail.to)}>`, [250, 251], "Recipient");
    await command("DATA", [354], "Message");
    const body = buildMessage(smtp, mail).replace(/\r\n\./g, "\r\n.."); // dot-stuffing
    await command(`${body}\r\n.`, [250], "Message");
    socket.write("QUIT\r\n");
  } finally {
    setTimeout(() => socket.destroy(), 200);
  }
}

module.exports = { isConfigured, send };
