// AHIP Manage header buttons on every page: "Sync" (load the latest data again) and the
// light / dark appearance switch. Loaded in <head> so the saved theme applies before the page draws.
(function () {
  "use strict";
  const KEY = "ahip-manage-theme";
  const read = () => { try { return localStorage.getItem(KEY) || "system"; } catch { return "system"; } };
  const apply = (mode) => {
    if (mode === "light" || mode === "dark") document.documentElement.setAttribute("data-theme", mode);
    else document.documentElement.removeAttribute("data-theme");
  };
  apply(read());

  const isDark = () => {
    const t = document.documentElement.getAttribute("data-theme");
    return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  };

  function addButtons() {
    const bar = document.querySelector(".topbar .refresh");
    if (!bar || bar.querySelector(".theme-btn")) return;

    const sync = document.createElement("button");
    sync.type = "button";
    sync.className = "btn ghost-on-dark sync-btn";
    sync.title = "Get the latest data and forms from the server";
    sync.innerHTML = '<span aria-hidden="true">⟳</span> Sync';
    sync.addEventListener("click", async () => {
      sync.disabled = true;
      sync.classList.add("spinning");
      try {
        // Pages that can reload in place listen for this; others reload the page.
        const handled = !window.dispatchEvent(new CustomEvent("ahip:sync", { cancelable: true }));
        if (handled && window.AHIP_SYNC) await window.AHIP_SYNC();
        else if (!handled) location.reload();
      } finally {
        sync.disabled = false;
        sync.classList.remove("spinning");
      }
    });

    const theme = document.createElement("button");
    theme.type = "button";
    theme.className = "btn ghost-on-dark theme-btn";
    const label = () => {
      theme.textContent = isDark() ? "☀ Light" : "☾ Dark";
      theme.title = isDark() ? "Switch to the light appearance" : "Switch to the dark appearance";
    };
    theme.addEventListener("click", () => {
      const next = isDark() ? "light" : "dark";
      try { localStorage.setItem(KEY, next); } catch { /* private window */ }
      apply(next);
      label();
      window.dispatchEvent(new CustomEvent("ahip:theme", { detail: next }));
    });
    label();
    bar.prepend(sync, theme);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", addButtons);
  else addButtons();
})();
