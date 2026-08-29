"use strict";
var consoleWin = (() => {
  // dist/renderer/console.js
  var api = window.electronAPI;
  var currentLang = "ru";
  var dict = {};
  function tr(key, params) {
    let text = dict[key] || key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.split(`{${k}}`).join(String(v));
      }
    }
    return text;
  }
  function t(key, params) {
    return tr(key, params);
  }
  function applyStaticI18n() {
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (!key)
        return;
      if (el.querySelector("*")) {
        el.childNodes.forEach((node) => {
          if (node.nodeType === Node.TEXT_NODE)
            node.textContent = tr(key);
        });
      } else {
        el.textContent = tr(key);
      }
    });
    document.querySelectorAll("[data-i18n-ph]").forEach((el) => {
      el.placeholder = tr(el.getAttribute("data-i18n-ph") || "");
    });
    document.querySelectorAll("[data-i18n-title]").forEach((el) => {
      el.title = tr(el.getAttribute("data-i18n-title") || "");
    });
  }
  async function setLang(lang) {
    let json = null;
    if (api?.loadLocale) {
      try {
        json = await api.loadLocale(lang);
      } catch {
      }
    }
    if (!json) {
      try {
        const res = await fetch(`locales/${lang}.json`);
        if (res.ok)
          json = await res.json();
      } catch {
      }
    }
    if (!json && lang !== "ru") {
      await setLang("ru");
      return;
    }
    if (json)
      dict = json;
    currentLang = json ? lang : "ru";
    api?.setLanguage?.(currentLang);
    applyStaticI18n();
  }
  var MAX_ENTRIES = 2e3;
  var entries = [];
  var nextEntryId = 1;
  var filter = "all";
  var search = "";
  var autoscroll = true;
  var selectedId = null;
  var body = document.getElementById("console-body");
  var statusEl = document.getElementById("console-status");
  var ICON_WARN = '<svg class="clog-icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="#f0b429" d="M8.87 1.5a1 1 0 0 0-1.74 0L1.2 12.2A1 1 0 0 0 2.07 13.7h11.86a1 1 0 0 0 .87-1.5L8.87 1.5ZM8 5.2a.7.7 0 0 1 .7.7v3.2a.7.7 0 1 1-1.4 0V5.9A.7.7 0 0 1 8 5.2Zm0 6.6a.85.85 0 1 1 0-1.7.85.85 0 0 1 0 1.7Z"/></svg>';
  var ICON_ERROR = '<svg class="clog-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="#ef4444"/><path fill="#fff" d="M5.2 5.2a.7.7 0 0 1 1 0L8 6.99l1.8-1.8a.7.7 0 1 1 1 1L9 8l1.8 1.8a.7.7 0 1 1-1 1L8 9.01l-1.8 1.8a.7.7 0 1 1-1-1L6.99 8 5.2 6.2a.7.7 0 0 1 0-1Z"/></svg>';
  var ICON_RUN = '<svg class="clog-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="#3b82f6"/><path fill="#fff" d="M6.4 4.6a.7.7 0 0 1 1.08-.58l5 3.4a.7.7 0 0 1 0 1.16l-5 3.4A.7.7 0 0 1 6.4 11.4V4.6Z"/></svg>';
  var ICON_DONE = '<svg class="clog-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="#22c55e"/><path fill="#fff" stroke="#fff" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" d="M4.8 8.2 6.9 10.3 11.2 5.8"/></svg>';
  var ICON_EXIT = '<svg class="clog-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="#a855f7"/><path fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" d="M5 8h6M9.2 5.8 11.4 8 9.2 10.2"/></svg>';
  var ICON_COPY = '<img class="clog-copy__icon" src="../../assets/icons/copy.svg" width="14" height="14" alt="" aria-hidden="true">';
  function parseExplicitLevel(text) {
    const bracket = text.match(/\[(?:[^\]/\n]+\/)?(FATAL|SEVERE|ERROR|WARN(?:ING)?|INFO|DEBUG|TRACE|SUCCESS)\]/i);
    const tagged = bracket || text.match(/(?<![A-Za-z])(FATAL|SEVERE|ERROR|WARN(?:ING)?|INFO|DEBUG|TRACE)\s*:/i);
    if (!tagged)
      return null;
    const lvl = tagged[1].toUpperCase();
    if (lvl === "FATAL" || lvl === "SEVERE" || lvl === "ERROR")
      return "error";
    if (lvl === "WARN" || lvl === "WARNING")
      return "warn";
    if (lvl === "SUCCESS")
      return "run";
    return "info";
  }
  function isDoneMessage(text) {
    return /minecraft\s+запущен/i.test(text) || /minecraft\s+started/i.test(text) || /minecraft\s+запущено/i.test(text) || /minecraft\s+іске\s+қосылды/i.test(text) || /minecraft\s+эшләтеп/i.test(text);
  }
  function isExitMessage(text) {
    if (/minecraft\s+(закрыт|закрито|жабылды|ябылды|closed|зэхуэщӀащ)/i.test(text)) {
      const codeMatch = text.match(/код[уа]?\s*[:：]?\s*(-?\d+)/i) || text.match(/code\s*[:：]?\s*(-?\d+)/i);
      if (!codeMatch)
        return true;
      return Number(codeMatch[1]) === 0;
    }
    return false;
  }
  function isRunMessage(text) {
    return /launching\s+minecraft\b/i.test(text) || /\bwith\s+args\b/i.test(text) || /запуск\s+minecraft/i.test(text) || /\bjava\s+command\b/i.test(text) || /\bclasspath\b.*\bjavaw?\b/i.test(text);
  }
  function classifyLogLine(line) {
    const text = String(line || "");
    const explicit = parseExplicitLevel(text);
    if (explicit)
      return explicit;
    if (isDoneMessage(text))
      return "done";
    if (isExitMessage(text))
      return "exit";
    if (isRunMessage(text))
      return "run";
    if (/\b(errors?|failed|failure|crashed|exception|ошибк[аиеу]|упал)\b/i.test(text) || /\bcrash\s+report\b/i.test(text)) {
      return "error";
    }
    if (/\b(warnings?|warn|предупрежд\w*)\b/i.test(text))
      return "warn";
    return "info";
  }
  function levelLabel(level) {
    if (level === "error")
      return t("console.level.error");
    if (level === "warn")
      return t("console.level.warn");
    if (level === "run")
      return t("console.level.run");
    if (level === "done")
      return t("console.level.done");
    if (level === "exit")
      return t("console.level.exit");
    return t("console.level.info");
  }
  function levelIcon(level) {
    if (level === "error")
      return ICON_ERROR;
    if (level === "warn")
      return ICON_WARN;
    if (level === "run")
      return ICON_RUN;
    if (level === "done")
      return ICON_DONE;
    if (level === "exit")
      return ICON_EXIT;
    return "";
  }
  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function formatMessageForDisplay(message) {
    const lines = String(message || "").replace(/\r\n/g, "\n").split("\n");
    if (lines.length <= 1)
      return lines[0] || "";
    const out = [];
    let blankStreak = 0;
    for (let i = 0; i < lines.length; i += 1) {
      let line = lines[i].replace(/\t/g, "  ").replace(/\s+$/g, "");
      if (!line.trim()) {
        blankStreak += 1;
        if (blankStreak <= 1 && out.length > 0)
          out.push("");
        continue;
      }
      blankStreak = 0;
      if (i === 0) {
        out.push(line.trimStart());
        continue;
      }
      const stack = line.match(/^\s*(at\s.+)$/);
      if (stack) {
        out.push(`  ${stack[1]}`);
        continue;
      }
      out.push(line.replace(/^\s+/, (ws) => ws.length > 2 ? "  " : ws));
    }
    return out.join("\n");
  }
  function entryCopyText(entry) {
    return `[${entry.time}] ${levelLabel(entry.level)}: ${entry.message}`;
  }
  function createEntryElement(entry) {
    const el = document.createElement("article");
    const multiline = entry.message.includes("\n");
    el.className = `clog-entry clog-entry--${entry.level}${multiline ? " is-multiline" : ""}${selectedId === entry.id ? " is-selected" : ""}`;
    el.dataset.entryId = String(entry.id);
    el.tabIndex = 0;
    el.setAttribute("role", "listitem");
    el.title = t("console.copyBlockHint");
    const msgHtml = escapeHtml(formatMessageForDisplay(entry.message)).replace(/\n/g, "<br>");
    const icon = levelIcon(entry.level);
    el.innerHTML = `
    <div class="clog-head">
      <div class="clog-lead">
        ${icon}
        <span class="clog-time">${escapeHtml(entry.time)}</span>
      </div>
      <div class="clog-level">${escapeHtml(levelLabel(entry.level))}:</div>
      <button type="button" class="clog-copy" data-clog-copy="${entry.id}" title="${escapeHtml(t("console.copyBlock"))}">
        ${ICON_COPY}
      </button>
    </div>
    <div class="clog-msg">${msgHtml}</div>`;
    return el;
  }
  function entryMatches(entry) {
    if (filter === "error" && entry.level !== "error")
      return false;
    if (search) {
      const hay = `${entry.time} ${entry.message} ${levelLabel(entry.level)}`.toLowerCase();
      if (!hay.includes(search.toLowerCase()))
        return false;
    }
    return true;
  }
  function renderBody() {
    body.innerHTML = "";
    body.setAttribute("role", "list");
    for (const entry of entries) {
      if (!entryMatches(entry))
        continue;
      body.appendChild(createEntryElement(entry));
    }
    if (autoscroll)
      body.scrollTop = body.scrollHeight;
  }
  function addEntry(message, forcedLevel) {
    const time = (/* @__PURE__ */ new Date()).toLocaleTimeString(void 0, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    });
    const level = forcedLevel || classifyLogLine(message);
    const entry = {
      id: nextEntryId++,
      time,
      message: String(message || "").trim() || "\u2014",
      level
    };
    entries.push(entry);
    if (entries.length > MAX_ENTRIES)
      entries.shift();
    if (!entryMatches(entry))
      return;
    if (filter !== "all" || search) {
      renderBody();
      return;
    }
    body.appendChild(createEntryElement(entry));
    while (body.childElementCount > 500)
      body.removeChild(body.firstChild);
    if (autoscroll)
      body.scrollTop = body.scrollHeight;
  }
  function msgOf(data) {
    return data?.key ? t(data.key, data.params) : data?.message || "";
  }
  function handleProgress(data) {
    if (!data)
      return;
    switch (data.kind) {
      case "info":
      case "debug":
      case "log":
        addEntry(msgOf(data), data.kind === "info" ? "info" : void 0);
        break;
      case "close": {
        const code = Number(data?.code ?? data?.params?.code);
        const msg = msgOf(data);
        if (Number.isFinite(code) && code !== 0)
          addEntry(msg, "warn");
        else
          addEntry(msg, "exit");
        break;
      }
      case "launching":
        addEntry(msgOf(data) || t("smp.launchingMc"), "run");
        break;
      case "crash":
        addEntry(t("log.error", { msg: msgOf(data) }), "error");
        break;
      case "error":
        addEntry(msgOf(data), "error");
        break;
      default:
        if (data.message || data.key)
          addEntry(msgOf(data));
        break;
    }
  }
  var statusTimer = null;
  var statusHideTimer = null;
  function showStatus(text, ms = 2200) {
    if (!statusEl)
      return;
    statusEl.hidden = false;
    statusEl.textContent = text;
    statusEl.classList.remove("is-visible");
    void statusEl.offsetWidth;
    statusEl.classList.add("is-visible");
    if (statusTimer)
      clearTimeout(statusTimer);
    if (statusHideTimer)
      clearTimeout(statusHideTimer);
    statusTimer = setTimeout(() => {
      statusEl.classList.remove("is-visible");
      statusHideTimer = setTimeout(() => {
        statusEl.hidden = true;
        statusHideTimer = null;
      }, 220);
      statusTimer = null;
    }, ms);
  }
  function fullLogText() {
    return entries.map((e) => entryCopyText(e)).join("\n");
  }
  async function copyText(text, okKey) {
    try {
      await navigator.clipboard.writeText(text);
      showStatus(t(okKey));
    } catch {
      showStatus(t("console.copyError"));
    }
  }
  function selectEntry(id) {
    selectedId = id;
    body.querySelectorAll(".clog-entry").forEach((el) => {
      el.classList.toggle("is-selected", Number(el.dataset.entryId) === id);
    });
  }
  document.getElementById("btn-min")?.addEventListener("click", () => api?.windowMinimize());
  document.getElementById("btn-max")?.addEventListener("click", () => api?.windowMaximize());
  document.getElementById("btn-close")?.addEventListener("click", () => api?.windowClose());
  document.getElementById("console-search")?.addEventListener("input", (e) => {
    search = e.target.value;
    renderBody();
  });
  document.querySelectorAll(".console-filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".console-filter-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      filter = btn.dataset.consoleFilter || "all";
      renderBody();
    });
  });
  document.getElementById("console-clear")?.addEventListener("click", () => {
    entries.length = 0;
    selectedId = null;
    body.innerHTML = "";
  });
  document.getElementById("console-autoscroll")?.addEventListener("change", (e) => {
    autoscroll = e.target.checked;
    if (autoscroll)
      body.scrollTop = body.scrollHeight;
  });
  document.getElementById("console-copy")?.addEventListener("click", async () => {
    if (selectedId != null) {
      const entry = entries.find((e) => e.id === selectedId);
      if (entry) {
        await copyText(entryCopyText(entry), "console.blockCopied");
        return;
      }
    }
    await copyText(fullLogText(), "console.copied");
  });
  document.getElementById("console-save")?.addEventListener("click", async () => {
    if (!api?.saveConsoleLog)
      return;
    const res = await api.saveConsoleLog(fullLogText());
    if (res.success) {
      showStatus(t("console.saved"));
    } else if (!res.canceled) {
      showStatus(t("console.saveError"));
    }
  });
  body.addEventListener("click", (e) => {
    const target = e.target;
    const copyBtn = target.closest("[data-clog-copy]");
    if (copyBtn) {
      e.stopPropagation();
      const id = Number(copyBtn.getAttribute("data-clog-copy"));
      const entry = entries.find((x) => x.id === id);
      if (entry)
        void copyText(entryCopyText(entry), "console.blockCopied");
      return;
    }
    const entryEl = target.closest(".clog-entry");
    if (!entryEl)
      return;
    selectEntry(Number(entryEl.dataset.entryId));
  });
  body.addEventListener("dblclick", (e) => {
    const entryEl = e.target.closest(".clog-entry");
    if (!entryEl)
      return;
    const id = Number(entryEl.dataset.entryId);
    const entry = entries.find((x) => x.id === id);
    if (entry)
      void copyText(entryCopyText(entry), "console.blockCopied");
  });
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c" && selectedId != null) {
      const sel = window.getSelection();
      if (sel && sel.toString().trim())
        return;
      const entry = entries.find((x) => x.id === selectedId);
      if (entry) {
        e.preventDefault();
        void copyText(entryCopyText(entry), "console.blockCopied");
      }
    }
  });
  var THEME_ACCENTS = {
    "#70ADDF": "ocean",
    "#5b8ed4": "midnight",
    "#a78bfa": "purple",
    "#4ade80": "forest"
  };
  function darkenColor(hex, amount) {
    const r = Math.max(0, parseInt(hex.slice(1, 3), 16) - amount);
    const g = Math.max(0, parseInt(hex.slice(3, 5), 16) - amount);
    const b = Math.max(0, parseInt(hex.slice(5, 7), 16) - amount);
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  }
  function relativeLuminance(r, g, b) {
    const lin = (c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }
  function applyAccent(accent) {
    document.documentElement.style.setProperty("--accent", accent);
    document.documentElement.style.setProperty("--accent-hover", darkenColor(accent, 20));
    const r = parseInt(accent.slice(1, 3), 16);
    const g = parseInt(accent.slice(3, 5), 16);
    const b = parseInt(accent.slice(5, 7), 16);
    document.documentElement.style.setProperty("--accent-rgb", `${r},${g},${b}`);
    const lum = relativeLuminance(r, g, b);
    const onAccent = lum > 0.48 ? "#0d1421" : "#ffffff";
    const onRgb = onAccent === "#ffffff" ? "255,255,255" : "13,20,33";
    document.documentElement.style.setProperty("--on-accent", onAccent);
    document.documentElement.style.setProperty("--on-accent-rgb", onRgb);
    document.documentElement.setAttribute("data-accent-fg", lum > 0.48 ? "dark" : "light");
    const theme = THEME_ACCENTS[accent];
    if (theme)
      document.documentElement.setAttribute("data-theme", theme);
    else
      document.documentElement.removeAttribute("data-theme");
  }
  function loadTheme() {
    const theme = localStorage.getItem("Undefined Client-theme") || "ocean";
    const accent = localStorage.getItem("Undefined Client-accent") || "#70ADDF";
    if (theme !== "custom") {
      const themeAccents = {
        ocean: "#70ADDF",
        midnight: "#5b8ed4",
        purple: "#a78bfa",
        forest: "#4ade80"
      };
      applyAccent(themeAccents[theme] || "#70ADDF");
    } else {
      applyAccent(accent);
    }
  }
  function bindThemeSync() {
    api?.onThemeChanged?.((accent) => {
      const color = String(accent || "").trim();
      if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
        loadTheme();
        return;
      }
      applyAccent(color);
    });
    window.addEventListener("storage", (e) => {
      if (e.key === "Undefined Client-accent" || e.key === "Undefined Client-theme") {
        loadTheme();
      }
    });
  }
  void (async () => {
    loadTheme();
    bindThemeSync();
    await setLang(localStorage.getItem("Undefined Client-language") || "ru");
    if (api?.getConsoleHistory) {
      try {
        const history = await api.getConsoleHistory();
        for (const data of history)
          handleProgress(data);
      } catch {
      }
    }
    api?.onConsoleLog((data) => handleProgress(data));
    if (autoscroll)
      body.scrollTop = body.scrollHeight;
  })();
})();
