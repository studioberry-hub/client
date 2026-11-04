// ===== Shell UI агента: контекст-бар, быстрые чипы, empty state =====

import type { AiUiHost } from './types';

/** Сборка для shell UI (моды нужны для подсказок) */
export type AiShellBuild = {
  id: string;
  name: string;
  gameVersion: string;
  loader: string;
  icon?: string;
  mods?: unknown[] | null;
};

let shellHost: AiUiHost | null = null;
let emptyScenariosBound = false;

function setShellHost(host: AiUiHost): void {
  shellHost = host;
}

function promptFromKey(key: string): string {
  return shellHost?.t(key) || key;
}

// ===== Закреплённая полоса контекста =====

export function renderAiContextBar(host: AiUiHost, build: AiShellBuild | null): void {
  setShellHost(host);
  const bar = document.getElementById('ai-context-bar');
  if (!bar) return;

  bar.hidden = false;
  bar.removeAttribute('hidden');

  if (!build) {
    bar.classList.add('is-empty');
    bar.innerHTML = `
      <div class="ai-context-bar__main">
        <span class="ai-context-bar__name">${host.escapeHtml(host.t('ai.noBuild'))}</span>
        <span class="ai-context-bar__meta"></span>
      </div>
      <div class="ai-context-bar__slot" id="ai-context-bar-slot" aria-hidden="true"></div>
    `;
    return;
  }

  bar.classList.remove('is-empty');
  const meta = [build.gameVersion, build.loader].filter(Boolean).join(' · ');
  bar.innerHTML = `
    <div class="ai-context-bar__main">
      <span class="ai-context-bar__name">${host.escapeHtml(build.name)}</span>
      <span class="ai-context-bar__meta">${host.escapeHtml(meta)}</span>
    </div>
    <div class="ai-context-bar__slot" id="ai-context-bar-slot" aria-hidden="true"></div>
  `;
}

/** Быстрые чипы отключены — сценарии остаются в empty state. */
export function renderAiQuickChips(
  host: AiUiHost,
  _opts: { buildId?: string | null },
): void {
  setShellHost(host);
}

// ===== Сценарии пустого состояния =====

const EMPTY_SCENARIOS: { id: string; labelKey: string; promptKey: string }[] = [
  { id: 'crash', labelKey: 'ai.scenario.crash', promptKey: 'ai.prompt.scenario.crash' },
  { id: 'newBuild', labelKey: 'ai.scenario.newBuild', promptKey: 'ai.prompt.scenario.newBuild' },
  { id: 'optimize', labelKey: 'ai.scenario.optimize', promptKey: 'ai.prompt.scenario.optimize' },
  { id: 'findMod', labelKey: 'ai.scenario.findMod', promptKey: 'ai.prompt.scenario.findMod' },
];

export function renderAiEmptyScenarios(host: AiUiHost): void {
  setShellHost(host);
  const root = document.getElementById('ai-empty-scenarios');
  if (!root) return;
  root.innerHTML = EMPTY_SCENARIOS.map((s) => {
    const label = host.t(s.labelKey);
    // Если словарь ещё не загружен — не показываем сырой ключ
    const text = label === s.labelKey ? '' : label;
    return `<button type="button" class="ai-scenario" data-scenario="${s.id}" data-prompt-key="${s.promptKey}" data-i18n="${s.labelKey}">
        <span class="ai-scenario__title">${host.escapeHtml(text)}</span>
      </button>`;
  }).join('');
  bindAiEmptyScenarios(host);
}

export function bindAiEmptyScenarios(host: AiUiHost): void {
  setShellHost(host);
  const root = document.getElementById('ai-empty-scenarios');
  if (!root || emptyScenariosBound) return;
  emptyScenariosBound = true;

  root.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-prompt-key]');
    if (!btn?.dataset.promptKey || !shellHost) return;
    shellHost.sendPrompt(promptFromKey(btn.dataset.promptKey));
  });
}

// ===== Подсказки по контексту сборки =====

export function renderAiContextHints(host: AiUiHost, build: AiShellBuild | null): void {
  setShellHost(host);

  let hint = document.getElementById('ai-context-hint');
  if (!hint) {
    const bar = document.getElementById('ai-context-bar');
    if (bar) {
      hint = document.createElement('div');
      hint.id = 'ai-context-hint';
      hint.className = 'ai-context-hint hidden';
      bar.insertAdjacentElement('afterend', hint);
    }
  }

  const noMods = Boolean(build && !(build.mods && build.mods.length));

  if (hint) {
    if (noMods) {
      hint.textContent = host.t('ai.hint.noMods');
      hint.classList.remove('hidden');
    } else {
      hint.textContent = '';
      hint.classList.add('hidden');
    }
  }
}
