"use strict";

const $ = (id) => document.getElementById(id);

function showMessage(text) {
  $("message").textContent = text;
  $("message").hidden = !text;
}

async function post(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function formValues(form) {
  return Object.fromEntries(new FormData(form).entries());
}

async function start() {
  const session = await fetch("/api/session").then((r) => r.json());
  if (session.user && ["admin", "supervisor"].includes(session.user.role)) {
    location.replace("/");
    return;
  }
  if (session.setupRequired) {
    // Administrators are created only on the server PC (tools/create-admin.js), never here.
    $("title").textContent = "AHIP Manage is not set up yet";
    $("noAdmin").hidden = false;
  } else {
    $("loginForm").hidden = false;
  }
}

$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage("");
  const button = event.target.querySelector("button");
  button.disabled = true;
  try {
    await post("/api/login", formValues(event.target));
    location.replace("/");
  } catch (error) {
    showMessage(error.message);
  } finally {
    button.disabled = false;
  }
});


start().catch(() => showMessage("Cannot reach AHIP Manage. Try again in a moment."));
