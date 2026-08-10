interface ConsoleAPI {
  windowMinimize: () => void;
  windowMaximize: () => void;
  windowClose: () => void;
  loadLocale: (lang: string) => Promise<Record<string, string> | null>;
  setLanguage: (lang: string) => void;
  getConsoleHistory: () => Promise<any[]>;
  saveConsoleLog: (logContent: string) => Promise<{ success: boolean; canceled?: boolean; path?: string; error?: string }>;
  onConsoleLog: (callback: (data: any) => void) => () => void;
}

const api = (window as unknown as { electronAPI?: ConsoleAPI }).electronAPI;

/* ===== I18N ===== */

let currentLang = 'ru';
let dict: Record<string, string> = {};

function tr(key: string, params?: Record<string, string | number>): string {
  let text = dict[key] || key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.split(`{${k}}`).join(String(v));
    }
  }
  return text;
}

function t(key: string, params?: Record<string, string | number>): string {
  return tr(key, params);
}

function applyStaticI18n(): void {
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (!key) return;
    if (el.querySelector('*')) {
      el.childNodes.forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) node.textContent = tr(key);
      });
    } else {
      el.textContent = tr(key);
    }
  });
  document.querySelectorAll<HTMLInputElement>('[data-i18n-ph]').forEach(el => {
    el.placeholder = tr(el.getAttribute('data-i18n-ph') || '');
  });
  document.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach(el => {
    el.title = tr(el.getAttribute('data-i18n-title') || '');
  });
}

async function setLang(lang: string): Promise<void> {
  let json: Record<string, string> | null = null;
  if (api?.loadLocale) {
    try {
      json = await api.loadLocale(lang);
    } catch { /* fall through */ }
  }
  if (!json) {
    try {
      const res = await fetch(`locales/${lang}.json`);
      if (res.ok) json = await res.json();
    } catch { /* fall through */ }
  }
  if (!json && lang !== 'ru') {
    await setLang('ru');
    return;
  }
  if (json) dict = json;
  currentLang = json ? lang : 'ru';
  api?.setLanguage?.(currentLang);
  applyStaticI18n();
}

/* ===== LOG ===== */

interface LogLine {
  text: string;
  cls: string;
}

const MAX_ENTRIES = 2000;

const lines: LogLine[] = [];
let filter = 'all';
let search = '';
let autoscroll = true;

const body = document.getElementById('console-body') as HTMLElement;
const statusEl = document.getElementById('console-status') as HTMLElement;

function classifyLogLine(line: string): string {
  if (/(error|fail(ed)?|crash|exception|ошиб|упал|xatа|ҡата)/i.test(line)) return 'error';
  if (/(warn(ing)?|предупрежд|аваз|ескерту)/i.test(line)) return 'warn';
  return '';
}

function renderBody(): void {
  body.innerHTML = '';
  const q = search.toLowerCase();
  for (const line of lines) {
    if (filter === 'error' && line.cls !== 'error') continue;
    if (q && !line.text.toLowerCase().includes(q)) continue;
    const div = document.createElement('div');
    div.textContent = line.text;
    if (line.cls) div.classList.add('log-' + line.cls);
    body.appendChild(div);
  }
  if (autoscroll) body.scrollTop = body.scrollHeight;
}

function addLine(text: string): void {
  const time = new Date().toLocaleTimeString();
  const lineText = `[${time}] ${text}`;
  lines.push({ text: lineText, cls: classifyLogLine(lineText) });
  if (lines.length > MAX_ENTRIES) lines.shift();
  if (filter !== 'all' || (search && !lineText.toLowerCase().includes(search.toLowerCase()))) {
    renderBody();
    return;
  }
  const div = document.createElement('div');
  div.textContent = lineText;
  if (lines[lines.length - 1].cls) div.classList.add('log-' + lines[lines.length - 1].cls);
  body.appendChild(div);
  if (body.childElementCount > 500) body.removeChild(body.firstChild as ChildNode);
  if (autoscroll) body.scrollTop = body.scrollHeight;
}

function msgOf(data: any): string {
  return data?.key ? t(data.key, data.params) : (data?.message || '');
}

function handleProgress(data: any): void {
  if (!data) return;
  switch (data.kind) {
    case 'info':
    case 'debug':
    case 'log':
    case 'close':
      addLine(msgOf(data));
      break;
    case 'launching':
      addLine(t('status.minecraftStarted'));
      break;
    case 'crash':
      addLine(t('log.error', { msg: msgOf(data) }));
      break;
    case 'error':
      addLine(msgOf(data));
      break;
  }
}

/* ===== FEEDBACK ===== */

let statusTimer: ReturnType<typeof setTimeout> | null = null;

function showStatus(text: string): void {
  statusEl.textContent = text;
  statusEl.classList.remove('hidden');
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = setTimeout(() => statusEl.classList.add('hidden'), 3000);
}

function fullLogText(): string {
  return lines.map(l => l.text).join('\n');
}

/* ===== ACTIONS ===== */

document.getElementById('btn-min')?.addEventListener('click', () => api?.windowMinimize());
document.getElementById('btn-max')?.addEventListener('click', () => api?.windowMaximize());
document.getElementById('btn-close')?.addEventListener('click', () => api?.windowClose());

document.getElementById('console-search')?.addEventListener('input', (e) => {
  search = (e.target as HTMLInputElement).value;
  renderBody();
});

document.querySelectorAll<HTMLElement>('.console-filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll<HTMLElement>('.console-filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    filter = btn.dataset.consoleFilter || 'all';
    renderBody();
  });
});

document.getElementById('console-clear')?.addEventListener('click', () => {
  lines.length = 0;
  body.innerHTML = '';
});

document.getElementById('console-autoscroll')?.addEventListener('change', (e) => {
  autoscroll = (e.target as HTMLInputElement).checked;
  if (autoscroll) body.scrollTop = body.scrollHeight;
});

document.getElementById('console-copy')?.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(fullLogText());
    showStatus(t('console.copied'));
  } catch {
    showStatus(t('console.copyError'));
  }
});

document.getElementById('console-save')?.addEventListener('click', async () => {
  if (!api?.saveConsoleLog) return;
  const res = await api.saveConsoleLog(fullLogText());
  if (res.success) {
    showStatus(t('console.saved'));
  } else if (!res.canceled) {
    showStatus(t('console.saveError'));
  }
});

/* ===== INIT ===== */

void (async () => {
  await setLang(localStorage.getItem('Undefined Client-language') || 'ru');
  if (api?.getConsoleHistory) {
    try {
      const history = await api.getConsoleHistory();
      for (const data of history) handleProgress(data);
    } catch { /* ignore */ }
  }
  api?.onConsoleLog((data) => handleProgress(data));
  if (autoscroll) body.scrollTop = body.scrollHeight;
})();
