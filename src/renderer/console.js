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
  var lines = [];
  var filter = "all";
  var search = "";
  var autoscroll = true;
  var body = document.getElementById("console-body");
  var statusEl = document.getElementById("console-status");
  function classifyLogLine(line) {
    if (/(error|fail(ed)?|crash|exception|ошиб|упал|xatа|ҡата)/i.test(line))
      return "error";
    if (/(warn(ing)?|предупрежд|аваз|ескерту)/i.test(line))
      return "warn";
    return "";
  }
  function renderBody() {
    body.innerHTML = "";
    const q = search.toLowerCase();
    for (const line of lines) {
      if (filter === "error" && line.cls !== "error")
        continue;
      if (q && !line.text.toLowerCase().includes(q))
        continue;
      const div = document.createElement("div");
      div.textContent = line.text;
      if (line.cls)
        div.classList.add("log-" + line.cls);
      body.appendChild(div);
    }
    if (autoscroll)
      body.scrollTop = body.scrollHeight;
  }
  function addLine(text) {
    const time = (/* @__PURE__ */ new Date()).toLocaleTimeString();
    const lineText = `[${time}] ${text}`;
    lines.push({ text: lineText, cls: classifyLogLine(lineText) });
    if (lines.length > MAX_ENTRIES)
      lines.shift();
    if (filter !== "all" || search && !lineText.toLowerCase().includes(search.toLowerCase())) {
      renderBody();
      return;
    }
    const div = document.createElement("div");
    div.textContent = lineText;
    if (lines[lines.length - 1].cls)
      div.classList.add("log-" + lines[lines.length - 1].cls);
    body.appendChild(div);
    if (body.childElementCount > 500)
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
      case "close":
        addLine(msgOf(data));
        break;
      case "launching":
        addLine(t("status.minecraftStarted"));
        break;
      case "crash":
        addLine(t("log.error", { msg: msgOf(data) }));
        break;
      case "error":
        addLine(msgOf(data));
        break;
    }
  }
  var statusTimer = null;
  function showStatus(text) {
    statusEl.textContent = text;
    statusEl.classList.remove("hidden");
    if (statusTimer)
      clearTimeout(statusTimer);
    statusTimer = setTimeout(() => statusEl.classList.add("hidden"), 3e3);
  }
  function fullLogText() {
    return lines.map((l) => l.text).join("\n");
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
    lines.length = 0;
    body.innerHTML = "";
  });
  document.getElementById("console-autoscroll")?.addEventListener("change", (e) => {
    autoscroll = e.target.checked;
    if (autoscroll)
      body.scrollTop = body.scrollHeight;
  });
  document.getElementById("console-copy")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(fullLogText());
      showStatus(t("console.copied"));
    } catch {
      showStatus(t("console.copyError"));
    }
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
  void (async () => {
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
