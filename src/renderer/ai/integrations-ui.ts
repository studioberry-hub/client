// ===== UI-интеграции агента: краш-цитата, баннер, превью сборки, каталог, бейдж =====
import type { AiUiHost } from './types';

const TOUCHED_STORAGE_KEY = 'uclient-ai-touched-builds';
const CRASH_BANNER_ID = 'ai-crash-banner';

export type AiBuildPreview = {
  id: string;
  name: string;
  gameVersion: string;
  loader: string;
  icon?: string;
};

// ===== Бейдж «затронуто агентом» (sessionStorage) =====

function readTouchedSet(): Set<string> {
  try {
    const raw = sessionStorage.getItem(TOUCHED_STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return new Set();
  }
}

function writeTouchedSet(ids: Set<string>): void {
  try {
    sessionStorage.setItem(TOUCHED_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    /* quota / private mode */
  }
}

/** Пометить сборку как изменённую агентом в этой сессии. */
export function markBuildTouchedByAgent(buildId: string): void {
  const id = String(buildId || '').trim();
  if (!id) return;
  const set = readTouchedSet();
  set.add(id);
  writeTouchedSet(set);
}

export function isBuildTouchedByAgent(buildId: string): boolean {
  const id = String(buildId || '').trim();
  if (!id) return false;
  return readTouchedSet().has(id);
}

// ===== Краш: цитата лога в чате =====

export function appendAiCrashQuote(
  host: AiUiHost,
  opts: { buildName: string; logExcerpt: string },
): HTMLElement | null {
  const root = host.getMessagesRoot();
  if (!root) return null;

  const name = opts.buildName || 'build';
  const excerpt = String(opts.logExcerpt || '').trim() || '—';
  const summary = host.t('ai.crash.quote', { name });

  const wrap = document.createElement('div');
  wrap.className = 'ai-msg ai-msg--system';
  wrap.innerHTML = `
    <div class="ai-msg__bubble">
      <details class="ai-crash-quote">
        <summary class="ai-crash-quote__summary">${host.escapeHtml(summary)}</summary>
        <pre class="ai-crash-quote__body">${host.escapeHtml(excerpt)}</pre>
      </details>
    </div>`;
  root.appendChild(wrap);
  host.scrollToEnd();
  return wrap;
}

// ===== Краш: баннер над композером =====

export function hideAiCrashBanner(): void {
  const el = document.getElementById(CRASH_BANNER_ID);
  if (!el) return;
  el.classList.add('hidden');
  el.innerHTML = '';
}

export function showAiCrashBanner(
  host: AiUiHost,
  opts: { buildId: string; buildName: string },
): void {
  let el = document.getElementById(CRASH_BANNER_ID);
  if (!el) {
    const stage = document.querySelector('.ai-stage');
    if (!stage) return;
    el = document.createElement('div');
    el.id = CRASH_BANNER_ID;
    el.className = 'ai-crash-banner';
    const body = document.getElementById('ai-messages');
    if (body) stage.insertBefore(el, body);
    else stage.appendChild(el);
  }

  const buildId = String(opts.buildId || '');
  const buildName = opts.buildName || buildId || 'build';
  el.classList.remove('hidden');
  el.innerHTML = `
    <div class="ai-crash-banner__text">${host.escapeHtml(host.t('ai.crash.banner', { name: buildName }))}</div>
    <button type="button" class="ai-crash-banner__btn" data-build-id="${host.escapeHtml(buildId)}" data-build-name="${host.escapeHtml(buildName)}">
      ${host.escapeHtml(host.t('ai.crash.continue'))}
    </button>
    <button type="button" class="ai-crash-banner__close" aria-label="Close">×</button>`;

  el.querySelector('.ai-crash-banner__close')?.addEventListener('click', () => hideAiCrashBanner());
  el.querySelector('.ai-crash-banner__btn')?.addEventListener('click', () => {
    const btn = el!.querySelector<HTMLButtonElement>('.ai-crash-banner__btn');
    const name = btn?.dataset.buildName || buildName;
    const id = btn?.dataset.buildId || buildId;
    hideAiCrashBanner();
    host.sendPrompt(
      host.t('crash.agentPrompt', { name }) + (id ? `\n\nbuildId: ${id}` : ''),
    );
  });
}

// ===== Превью сборки в чате =====

export function appendAiBuildPreview(host: AiUiHost, build: AiBuildPreview): HTMLElement | null {
  const root = host.getMessagesRoot();
  if (!root || !build?.id) return null;

  const icon = build.icon
    ? `<img class="ai-build-preview__icon" src="${host.escapeHtml(build.icon)}" alt="">`
    : `<div class="ai-build-preview__icon ai-build-preview__icon--empty" aria-hidden="true"></div>`;
  const meta = [build.gameVersion, build.loader].filter(Boolean).join(' · ');

  const wrap = document.createElement('div');
  wrap.className = 'ai-msg ai-msg--system';
  wrap.innerHTML = `
    <div class="ai-msg__bubble">
      <div class="ai-build-preview" data-build-id="${host.escapeHtml(build.id)}">
        ${icon}
        <div class="ai-build-preview__body">
          <div class="ai-build-preview__label">${host.escapeHtml(host.t('ai.build.preview'))}</div>
          <div class="ai-build-preview__name">${host.escapeHtml(build.name || build.id)}</div>
          ${meta ? `<div class="ai-build-preview__meta">${host.escapeHtml(meta)}</div>` : ''}
        </div>
        <button type="button" class="ai-build-preview__btn" data-build-id="${host.escapeHtml(build.id)}">
          ${host.escapeHtml(host.t('ai.build.openSettings'))}
        </button>
      </div>
    </div>`;

  wrap.querySelector('.ai-build-preview__btn')?.addEventListener('click', () => {
    host.openBuildSettings(build.id);
  });

  root.appendChild(wrap);
  host.scrollToEnd();
  return wrap;
}

// ===== Каталог → агент =====

/** Deep-link из карточки мода: вкладка AI + промпт про проект. */
export function askAgentAboutMod(
  host: AiUiHost,
  projectTitle: string,
  projectId: string,
): void {
  const title = String(projectTitle || '').trim() || projectId;
  const id = String(projectId || '').trim();
  if (!id) return;
  host.switchToAiTab();
  host.sendPrompt(
    `Расскажи про мод «${title}» (Modrinth id: ${id}): совместимость, зависимости и стоит ли ставить в текущую сборку.`,
  );
}
