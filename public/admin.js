// AHIP Manage — navigation, user management (email invitations) and settings.
"use strict";

(() => {
  const $ = (id) => document.getElementById(id);
  let users = [];
  let me = null;
  let emailReady = false;
  let editing = null; // user being edited, or null when inviting

  async function api(method, url, body) {
    const response = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (response.status === 401) {
      location.replace("/login.html");
      throw new Error("Signed out");
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }

  // ---------- navigation

  const VIEWS = { data: "viewData", users: "viewUsers", settings: "viewSettings" };
  function showView() {
    const name = VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : "data";
    Object.entries(VIEWS).forEach(([key, id]) => ($(id).hidden = key !== name));
    document.querySelectorAll(".tabs a").forEach((a) => a.setAttribute("aria-current", a.dataset.view === name ? "page" : "false"));
    if (name === "users") {
      loadUsers();
      loadBlocked();
    }
    if (name === "settings") loadSettings();
  }
  window.addEventListener("hashchange", showView);

  $("logoutBtn").addEventListener("click", async () => {
    await fetch("/api/logout", { method: "POST" }).catch(() => {});
    location.replace("/login.html");
  });

  // ---------- users

  const STATUS = { active: "Active", invited: "Invited", deactivated: "Blocked" };
  const ROLE = { collector: "Data collector", admin: "Administrator" };
  const when = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—");

  async function loadUsers() {
    try {
      const [list, settings] = await Promise.all([api("GET", "/api/users"), api("GET", "/api/settings")]);
      users = list.users;
      emailReady = !!(settings.smtp.host && settings.smtp.user && settings.smtp.hasPassword && settings.smtp.from);
      renderUsers();
    } catch (error) {
      $("userRows").replaceChildren(messageRow(error.message));
    }
  }

  function messageRow(text) {
    const tr = document.createElement("tr");
    tr.className = "empty-row";
    const td = tr.insertCell();
    td.colSpan = 10;
    td.textContent = text;
    return tr;
  }

  function actionButton(label, handler, danger, disabled) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `btn ghost small${danger ? " danger" : ""}`;
    b.textContent = label;
    if (disabled) {
      b.disabled = true;
      b.title = "Waiting for the user's phone to connect; clears when they sign in with their password.";
    }
    b.addEventListener("click", handler);
    return b;
  }

  function renderUsers() {
    $("emailWarning").hidden = emailReady;
    $("userCount").textContent = `(${users.length})`;
    const counts = window.AHIP?.submissionsByUsername() || new Map();
    const body = $("userRows");
    body.replaceChildren();
    if (!users.length) body.appendChild(messageRow("No users yet."));
    const order = { active: 0, invited: 1, deactivated: 2 };
    [...users]
      .sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name))
      .forEach((user) => {
        const tr = body.insertRow();
        [user.name, user.username, user.phone, user.email, ROLE[user.role]].forEach((v) => (tr.insertCell().textContent = v));
        const status = tr.insertCell();
        const pill = document.createElement("span");
        pill.className = `status ${user.status}`;
        pill.textContent = STATUS[user.status];
        status.appendChild(pill);
        if (user.status === "invited" && user.invite) {
          const sub = document.createElement("div");
          sub.className = "hint";
          sub.textContent = user.invite.emailed ? `Emailed ${when(user.invite.sentAt)}` : "Not emailed — share the link";
          status.appendChild(sub);
        }
        if (user.apiKey) {
          const sub = document.createElement("div");
          sub.className = "hint";
          sub.textContent = `API key …${user.apiKey.hint} · ${user.apiKey.lastUsedAt ? "used " + when(user.apiKey.lastUsedAt) : "not used yet"}`;
          status.appendChild(sub);
        }
        tr.insertCell().appendChild(deviceCell(user.device));
        tr.insertCell().textContent = (counts.get(user.username) || 0).toLocaleString();
        tr.insertCell().textContent = when(user.lastLoginAt);
        const actions = tr.insertCell();
        actions.className = "actions";
        actions.appendChild(actionButton("Edit", () => openUserForm(user)));
        if (user.status === "invited") actions.appendChild(actionButton("Resend invite", () => sendInvite(user)));
        if (user.status === "active") {
          actions.appendChild(actionButton("Reset password", () => {
            if (confirm(`Reset ${user.name}'s password? Their current password stops working and they get a new invitation to choose one.`)) sendInvite(user);
          }));
        }
        if (user.status === "active") {
          actions.appendChild(user.signOutRequestedAt
            ? actionButton("Sign-in reset pending", () => {}, false, true)
            : actionButton("Reset app sign-in", () => {
              if (confirm(`Reset ${user.name}'s app sign-in? The next time their phone connects to the office Wi-Fi, the app signs them out and they must sign in again with their username and password (their PIN is cleared). Their saved and submitted data is kept.`)) resetSignIn(user);
            }));
        }
        if (user.apiKey) {
          actions.appendChild(actionButton("Revoke API key", async () => {
            if (!confirm(`Revoke ${user.name}'s API key? Tools using it stop getting their data; they can create a new key in the app.`)) return;
            try {
              await api("POST", `/api/users/${user.id}/revoke-api-key`);
              await loadUsers();
            } catch (error) {
              alert(error.message);
            }
          }, true));
        }
        if (user.device) {
          actions.appendChild(actionButton("Reset device", () => {
            if (confirm(`Unlink ${user.name}'s phone? Their next sign-in links whichever phone they use, and the current phone is signed out when it next connects.`)) resetDevice(user);
          }));
          actions.appendChild(actionButton("Block phone", () => blockPhone(user), true));
        }
        if (user.id !== me?.id) {
          actions.appendChild(user.status === "deactivated"
            ? actionButton("Unblock user", () => setStatus(user, "active"))
            : actionButton("Block user", () => {
              if (confirm(`Block ${user.name}? Their username and password stop working on every phone. Their submitted data is kept.`)) setStatus(user, "deactivated");
            }, true));
        }
      });
  }

  // ---------- blocked phones

  async function blockPhone(user) {
    const d = user.device;
    const label = d.name || [d.manufacturer, d.model].filter(Boolean).join(" ") || "this phone";
    const reason = prompt(
      `Block "${label}"? It will not be able to use AHIP Collect with ANY account, and it is unlinked from ${user.name}.\n\nReason (optional, e.g. lost or stolen):`,
      "",
    );
    if (reason === null) return; // cancelled
    try {
      const result = await api("POST", "/api/devices/block", { userId: user.id, reason });
      renderBlocked(result.devices);
      await loadUsers();
    } catch (error) {
      alert(error.message);
    }
  }

  async function loadBlocked() {
    try {
      renderBlocked((await api("GET", "/api/devices/blocked")).devices);
    } catch (error) {
      $("blockedRows").replaceChildren(messageRow(error.message));
    }
  }

  function renderBlocked(devices) {
    $("blockedCount").textContent = `(${devices.length})`;
    const body = $("blockedRows");
    body.replaceChildren();
    if (!devices.length) {
      const tr = messageRow("No blocked phones.");
      tr.cells[0].colSpan = 6;
      body.appendChild(tr);
      return;
    }
    devices.forEach((d) => {
      const tr = body.insertRow();
      const model = [d.manufacturer, d.model].filter(Boolean).join(" ");
      [
        d.name || model || "Phone",
        model,
        d.lastUser ? `${d.lastUser.name} (${d.lastUser.username})` : "—",
        `${when(d.blockedAt)}${d.blockedBy ? ` by ${d.blockedBy}` : ""}`,
        d.reason || "—",
      ].forEach((v) => (tr.insertCell().textContent = v));
      tr.insertCell().appendChild(actionButton("Unblock", async () => {
        if (!confirm(`Unblock "${d.name || model}"? It can be used with AHIP Collect again.`)) return;
        try {
          renderBlocked((await api("POST", "/api/devices/unblock", { id: d.id })).devices);
        } catch (error) {
          alert(error.message);
        }
      }));
    });
  }

  function deviceCell(device) {
    const box = document.createElement("div");
    box.className = "device";
    if (!device) {
      box.className = "device none";
      box.textContent = "Not linked yet";
      return box;
    }
    const name = document.createElement("strong");
    const model = [device.manufacturer, device.model].filter(Boolean).join(" ");
    name.textContent = device.name || model || "Phone";
    const details = document.createElement("div");
    details.className = "hint";
    details.textContent = [
      device.name && model && device.name !== model ? model : "",
      device.android ? `Android ${device.android}` : "",
      device.appVersion ? `App ${device.appVersion}` : "",
    ].filter(Boolean).join(" · ");
    const seen = document.createElement("div");
    seen.className = "hint";
    seen.textContent = `Last seen ${when(device.lastSeenAt)}`;
    box.append(name, details, seen);
    return box;
  }

  async function resetSignIn(user) {
    try {
      await api("POST", `/api/users/${user.id}/reset-signin`);
      await loadUsers();
    } catch (error) {
      alert(error.message);
    }
  }

  async function resetDevice(user) {
    try {
      await api("POST", `/api/users/${user.id}/reset-device`);
      await loadUsers();
    } catch (error) {
      alert(error.message);
    }
  }

  async function setStatus(user, status) {
    try {
      await api("PATCH", `/api/users/${user.id}`, { status });
      await loadUsers();
    } catch (error) {
      alert(error.message);
    }
  }

  async function sendInvite(user) {
    try {
      const result = await api("POST", `/api/users/${user.id}/invite`);
      openUserForm(null);
      showInviteResult(result);
      await loadUsers();
    } catch (error) {
      alert(error.message);
    }
  }

  // ---------- invite / edit drawer

  const form = $("userForm");

  function openUserForm(user) {
    editing = user;
    form.reset();
    $("userFormError").hidden = true;
    $("inviteResult").hidden = true;
    form.hidden = false;
    form.username.disabled = !!user;
    $("userDrawerTitle").textContent = user ? `Edit ${user.name}` : "Invite user";
    $("userDrawerSub").textContent = user ? "Update contact details or role." : "They will get an email to choose their password.";
    form.querySelector("button[type=submit]").textContent = user ? "Save changes" : "Send invitation";
    if (user) ["name", "username", "phone", "email", "role"].forEach((f) => (form[f].value = user[f]));
    $("userDrawer").hidden = false;
    form.name.focus();
  }

  function closeUserForm() {
    $("userDrawer").hidden = true;
  }

  function showInviteResult(result) {
    form.hidden = true;
    $("userDrawerTitle").textContent = "Invitation ready";
    $("userDrawerSub").textContent = result.user ? `${result.user.name} (${result.user.username})` : "";
    $("inviteResultText").textContent = result.emailed
      ? `Invitation emailed to ${result.user.email}.`
      : `The email was not sent: ${result.emailError} Share the link below instead.`;
    $("inviteResultText").className = result.emailed ? "ok-text" : "form-error";
    $("inviteLink").value = result.link;
    $("inviteResult").hidden = false;
    $("userDrawer").hidden = false;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    $("userFormError").hidden = true;
    const values = Object.fromEntries(new FormData(form).entries());
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      if (editing) {
        delete values.username;
        await api("PATCH", `/api/users/${editing.id}`, values);
        closeUserForm();
      } else {
        showInviteResult(await api("POST", "/api/users", values));
      }
      await loadUsers();
    } catch (error) {
      $("userFormError").textContent = error.message;
      $("userFormError").hidden = false;
    } finally {
      button.disabled = false;
    }
  });

  $("addUserBtn").addEventListener("click", () => openUserForm(null));
  document.querySelectorAll("[data-close-user]").forEach((n) => n.addEventListener("click", closeUserForm));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("userDrawer").hidden) closeUserForm(); });
  $("copyLinkBtn").addEventListener("click", async () => {
    $("inviteLink").select();
    try {
      await navigator.clipboard.writeText($("inviteLink").value);
    } catch {
      document.execCommand("copy");
    }
    $("copyLinkBtn").textContent = "Copied";
    setTimeout(() => ($("copyLinkBtn").textContent = "Copy link"), 1500);
  });

  // ---------- settings

  const settingsForm = $("settingsForm");

  async function loadSettings() {
    try {
      const s = await api("GET", "/api/settings");
      ["host", "port", "security", "user", "from", "fromName"].forEach((f) => (settingsForm[f].value = s.smtp[f] ?? ""));
      settingsForm.pass.value = "";
      settingsForm.pass.placeholder = s.smtp.hasPassword ? "(saved — leave empty to keep)" : "";
      const here = /^(localhost|127\.)/.test(location.hostname) ? "" : location.origin;
      settingsForm.publicUrl.value = s.publicUrl || here;
    } catch (error) {
      $("settingsMsg").textContent = error.message;
    }
  }

  settingsForm.security.addEventListener("change", () => {
    settingsForm.port.value = settingsForm.security.value === "starttls" ? 587 : 465;
  });

  settingsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const v = Object.fromEntries(new FormData(settingsForm).entries());
    $("settingsMsg").textContent = "Saving…";
    try {
      await api("PUT", "/api/settings", {
        publicUrl: v.publicUrl,
        smtp: { host: v.host, port: v.port, security: v.security, user: v.user, pass: v.pass, from: v.from, fromName: v.fromName },
      });
      $("settingsMsg").textContent = "Saved.";
      await loadSettings();
    } catch (error) {
      $("settingsMsg").textContent = error.message;
    }
  });

  $("testEmailForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    $("testMsg").textContent = "Sending…";
    try {
      await api("POST", "/api/settings/test-email", { to: event.target.to.value });
      $("testMsg").textContent = "Sent. Check the inbox (and spam folder).";
    } catch (error) {
      $("testMsg").textContent = error.message;
    }
  });

  window.addEventListener("ahip:session", (e) => {
    me = e.detail;
    showView();
  });
})();
