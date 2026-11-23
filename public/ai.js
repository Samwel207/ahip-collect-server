// AHIP Manage AI assistant: a floating "AI" button on every admin page that opens a chat panel.
// Questions go to /api/ai/ask (the server adds a summary of the submitted data and calls Gemini).
"use strict";

(function () {
  const page = location.pathname.endsWith("forms.html") ? "forms" : "data";
  const SUGGESTIONS = {
    data: [
      "Summarise the submissions so far",
      "Which councils and tools are behind?",
      "Find data-quality problems",
      "What do respondents say in the open-ended answers?",
      "Compare the Likert answers between tools",
    ],
    forms: [
      "Review this form: unclear or missing questions?",
      "Suggest 3 questions about referral feedback",
      "Turn the agreement questions into a grid",
      "Which questions should be required?",
    ],
  };
  const STORE = `ahip-ai-${page}`;
  let history = [];
  try { history = JSON.parse(sessionStorage.getItem(STORE) || "[]"); } catch { history = []; }

  const h = (tag, attrs = {}, ...children) => {
    const n = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (v == null || v === false) return;
      if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else n.setAttribute(k, v);
    });
    children.flat().forEach((c) => c != null && c !== false && n.append(c instanceof Node ? c : document.createTextNode(String(c))));
    return n;
  };

  // ---------------------------------------------------------------- small, safe markdown

  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s) =>
    esc(s)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");

  function markdown(text) {
    const lines = text.replace(/\r/g, "").split("\n");
    let html = "";
    let list = null;
    const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] || "")) {
        closeList();
        const cells = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => inline(c.trim()));
        html += `<div class="ai-table"><table><thead><tr>${cells(line).map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>`;
        i += 2;
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
          html += `<tr>${cells(lines[i]).map((c) => `<td>${c}</td>`).join("")}</tr>`;
          i++;
        }
        i--;
        html += "</tbody></table></div>";
        continue;
      }
      const heading = /^(#{1,4})\s+(.*)$/.exec(line);
      const bullet = /^(\s*)[*-]\s+(.*)$/.exec(line);
      const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
      if (heading) { closeList(); html += `<h4>${inline(heading[2])}</h4>`; }
      else if (bullet) {
        if (list !== "ul") { closeList(); html += "<ul>"; list = "ul"; }
        html += `<li${bullet[1].length >= 2 ? ' class="sub"' : ""}>${inline(bullet[2])}</li>`;
      } else if (numbered) {
        if (list !== "ol") { closeList(); html += "<ol>"; list = "ol"; }
        html += `<li>${inline(numbered[1])}</li>`;
      } else if (!line.trim()) closeList();
      else { closeList(); html += `<p>${inline(line)}</p>`; }
    }
    closeList();
    return html;
  }

  // ---------------------------------------------------------------- UI

  const fab = h("button", { type: "button", class: "ai-fab", "aria-label": "Open the AI assistant", title: "AI assistant" },
    h("span", { class: "ai-spark", "aria-hidden": "true", text: "✦" }), h("span", { text: "AI" }));
  const messages = h("div", { class: "ai-messages", "aria-live": "polite" });
  const input = h("textarea", { class: "ai-input", rows: 2, placeholder: page === "forms" ? "Ask about this form, or ask for question ideas…" : "Ask about your data… e.g. Which councils have the most referrals?", "aria-label": "Question for the AI assistant" });
  const send = h("button", { type: "button", class: "btn primary ai-send", text: "Ask" });
  const status = h("p", { class: "ai-note" });
  const panel = h("section", { class: "ai-panel", hidden: true, role: "dialog", "aria-label": "AI assistant" },
    h("header", { class: "ai-head" },
      h("div", {}, h("h2", {}, h("span", { class: "ai-spark", text: "✦ " }), "AHIP AI assistant"),
        h("p", { text: page === "forms" ? "Help with designing this form, using your data" : "Answers from your submitted data" })),
      h("div", { class: "ai-head-actions" },
        h("button", { type: "button", class: "btn ghost-on-dark small", onclick: clear, text: "New chat" }),
        h("button", { type: "button", class: "btn ghost-on-dark small", onclick: () => toggle(false), "aria-label": "Close", text: "✕" }))),
    messages,
    h("div", { class: "ai-compose" }, input, send),
    status);
  document.body.append(fab, panel);

  function toggle(open) {
    panel.hidden = !open;
    fab.hidden = open;
    if (open) { render(); input.focus(); }
  }

  function bubble(m) {
    const body = h("div", { class: "ai-text" });
    if (m.role === "model") body.innerHTML = markdown(m.text);
    else body.textContent = m.text;
    return h("div", { class: `ai-msg ${m.role === "model" ? "bot" : m.role === "error" ? "err" : "me"}` }, body,
      m.meta && h("div", { class: "ai-meta", text: m.meta }));
  }

  function render() {
    messages.replaceChildren();
    if (!history.length) {
      messages.append(
        h("div", { class: "ai-welcome" },
          h("p", { text: page === "forms"
            ? "I can review the form you are editing, suggest questions and answer options, and check them against the answers already collected."
            : "Ask anything about the submissions: totals, comparisons between councils or tools, trends, open-ended answers, data-quality problems." }),
          h("div", { class: "ai-chips" }, SUGGESTIONS[page].map((s) => h("button", { type: "button", class: "ai-chip", text: s, onclick: () => ask(s) })))));
    }
    history.forEach((m) => messages.append(bubble(m)));
    messages.scrollTop = messages.scrollHeight;
  }

  function save() {
    try { sessionStorage.setItem(STORE, JSON.stringify(history.slice(-20))); } catch { /* private mode */ }
  }

  function clear() {
    history = [];
    save();
    render();
  }

  async function ask(text) {
    const question = (text ?? input.value).trim();
    if (!question || send.disabled) return;
    input.value = "";
    const prior = history.filter((m) => m.role === "user" || m.role === "model").map(({ role, text }) => ({ role, text }));
    history.push({ role: "user", text: question });
    render();
    const thinking = h("div", { class: "ai-msg bot thinking" }, h("span", { class: "dot" }), h("span", { class: "dot" }), h("span", { class: "dot" }), " Analysing your data…");
    messages.append(thinking);
    messages.scrollTop = messages.scrollHeight;
    send.disabled = true;
    try {
      const form = page === "forms" && window.AHIP_FORMS?.currentForm ? window.AHIP_FORMS.currentForm() : null;
      const view = page === "data" && window.AHIP?.currentView ? window.AHIP.currentView() : null;
      const res = await fetch("/api/ai/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, history: prior, page, form, view }),
      });
      if (res.status === 401) return location.replace("/login.html");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Error ${res.status}`);
      history.push({ role: "model", text: json.answer, meta: `Based on ${json.submissions} submissions${view ? " · " + view.description : ""} · ${json.model}` });
    } catch (e) {
      history.push({ role: "error", text: e.message });
    } finally {
      send.disabled = false;
      save();
      render();
    }
  }

  fab.addEventListener("click", () => toggle(true));

  // Other parts of the page can open the assistant with a question (insights card, charts).
  window.AHIP_AI = { ask: (q) => { toggle(true); ask(q); } };

  if (page === "data") {
    const viewText = document.getElementById("aiViewText");
    const refreshView = () => {
      const v = window.AHIP?.currentView?.();
      if (viewText && v) viewText.textContent = `${v.description} (${v.ids.length} submissions)`;
    };
    document.querySelectorAll(".filters select, #resetBtn").forEach((el) => el.addEventListener("change", () => setTimeout(refreshView, 50)));
    document.getElementById("resetBtn")?.addEventListener("click", () => setTimeout(refreshView, 50));
    setInterval(refreshView, 3000);
    document.getElementById("aiAnalyseBtn")?.addEventListener("click", () =>
      window.AHIP_AI.ask("Analyse this view: give the key findings (numbers per tool, council and collector, the main answers and anything unusual) and 3 practical recommendations."));
    document.querySelectorAll(".ai-insights [data-ai]").forEach((b) => b.addEventListener("click", () => window.AHIP_AI.ask(b.dataset.ai)));
    document.querySelectorAll(".charts .card > h2").forEach((h2) => {
      const title = h2.textContent.trim();
      h2.append(h("button", { type: "button", class: "ai-ask-chart", title: "Ask the AI about this chart", onclick: () =>
        window.AHIP_AI.ask(`Explain the chart "${title}" for this view: main pattern, highest and lowest, anything unusual, and what it means for the team.`) }, "✦ Ask AI"));
    });
  }
  send.addEventListener("click", () => ask());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel.hidden) toggle(false); });

  fetch("/api/ai/status")
    .then((r) => (r.ok ? r.json() : null))
    .then((s) => {
      if (!s) { fab.hidden = true; return; } // not an admin
      status.textContent = s.configured
        ? "Sent to Google Gemini: summaries of the answers. Photos, audio, GPS, phone numbers and interviewer names are not sent. Check important numbers before using them."
        : "Not set up yet: add GEMINI_API_KEY to android/local.properties and restart the dashboard.";
      if (!s.configured) { input.disabled = true; send.disabled = true; }
    })
    .catch(() => {});
})();
