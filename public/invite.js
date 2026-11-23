"use strict";

const $ = (id) => document.getElementById(id);
const token = new URLSearchParams(location.search).get("token") || "";

function showMessage(text) {
  $("message").textContent = text;
  $("message").hidden = !text;
}

async function start() {
  const response = await fetch(`/api/invite?token=${encodeURIComponent(token)}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    $("title").textContent = "Invitation not valid";
    $("lead").textContent = data.error || "This invitation link is invalid or has expired.";
    return;
  }
  $("title").textContent = `Welcome, ${data.name}`;
  $("lead").textContent = "Choose a password to activate your AHIP Collect account.";
  $("username").textContent = data.username;
  $("inviteForm").hidden = false;
}

$("inviteForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage("");
  const values = Object.fromEntries(new FormData(event.target).entries());
  if (values.password !== values.confirm) return showMessage("The passwords do not match.");
  const button = event.target.querySelector("button");
  button.disabled = true;
  try {
    const response = await fetch("/api/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password: values.password }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Could not activate the account.");
    event.target.hidden = true;
    $("title").textContent = "Account activated";
    $("lead").textContent = "";
    $("doneUsername").textContent = data.username;
    $("done").hidden = false;
  } catch (error) {
    showMessage(error.message);
  } finally {
    button.disabled = false;
  }
});

start().catch(() => {
  $("title").textContent = "Cannot reach AHIP";
  $("lead").textContent = "Make sure this phone is connected to the office Wi-Fi, then reload the page.";
});
