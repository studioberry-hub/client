// ===== UI хода агента: план, tools, статус, stop, skeleton, действия =====

import type { AiAgentStatus, AiPlanStep } from './types';

type PlanStepStatus = AiPlanStep['status'];

type ToolCollapsibleOpts = {
  label: string;
  detail?: string;
  status?: 'pending' | 'running' | 'done' | 'error';
};

type MessageActionsOpts = {
  onCopy?: (text: string) => void;
  onRetry?: () => void;
  copyLabel?: string;
  retryLabel?: string;
};

const STATUS_I18N: Record<Exclude<AiAgentStatus, 'idle'>, string> = {
  thinking: 'ai.status.thinking',
  tool: 'ai.status.tool',
  confirm: 'ai.status.confirm',
  streaming: 'ai.status.streaming',
};

const STATUS_FALLBACK: Record<Exclude<AiAgentStatus, 'idle'>, string> = {
  thinking: 'Думаю…',
  tool: 'Инструмент…',
  confirm: 'Подтверждение…',
  streaming: 'Печатает…',
};

const PLAN_ICON: Record<PlanStepStatus, string> = {
  pending: '○',
  running: '◉',
  done: '✓',
  error: '!',
};

let stopCallback: (() => void) | null = null;
let stopBound = false;
let skeletonTimer: ReturnType<typeof setTimeout> | null = null;
let skeletonEl: HTMLElement | null = null;

const planRoots = new WeakMap<HTMLElement, HTMLElement>();

// ===== Вспомогательные =====

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function ensureStopListener(): void {
  if (stopBound) return;
  const btn = document.getElementById('ai-stop');
  if (!btn) return;
  stopBound = true;
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    stopCallback?.();
  });
}

function planStepIcon(status: PlanStepStatus): string {
  return PLAN_ICON[status] || PLAN_ICON.pending;
}

function formatDetail(detail: string | undefined): string {
  if (!detail) return '';
  const trimmed = detail.trim();
  if (!trimmed) return '';
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return trimmed.length > 4000 ? `${trimmed.slice(0, 4000)}…` : trimmed;
  }
}

function bubblePlainText(bubbleEl: HTMLElement): string {
  const md = bubbleEl.querySelector('.ai-md, .ai-stream__md, .ai-stream__text');
  if (md?.textContent) return md.textContent;
  const clone = bubbleEl.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.ai-msg__actions, .ai-stream__caret').forEach((n) => n.remove());
  return (clone.textContent || '').trim();
}

// ===== План (checklist) =====

/** Монтирует чеклист плана агента в host. */
export function mountAiPlan(host: HTMLElement, steps: AiPlanStep[]): HTMLElement {
  let root = planRoots.get(host);
  if (!root) {
    root = document.createElement('div');
    root.className = 'ai-plan';
    root.innerHTML = `<div class="ai-plan__title" data-i18n="ai.plan.title">План</div>
      <ul class="ai-plan__list"></ul>`;
    host.appendChild(root);
    planRoots.set(host, root);
  }

  const list = root.querySelector('.ai-plan__list');
  if (!list) return root;

  list.innerHTML = steps
    .map(
      (s) => `<li class="ai-plan__step is-${esc(s.status)}" data-plan-id="${esc(s.id)}">
        <span class="ai-plan__icon" aria-hidden="true">${planStepIcon(s.status)}</span>
        <span class="ai-plan__label">${esc(s.label)}</span>
      </li>`,
    )
    .join('');

  return root;
}

/** Обновляет статус шага плана по id (ищет в документе). */
export function updateAiPlanStep(id: string, status: PlanStepStatus): void {
  document.querySelectorAll<HTMLElement>('.ai-plan__step[data-plan-id]').forEach((step) => {
    if (step.getAttribute('data-plan-id') !== id) return;
    step.classList.remove('is-pending', 'is-running', 'is-done', 'is-error');
    step.classList.add(`is-${status}`);
    const icon = step.querySelector('.ai-plan__icon');
    if (icon) icon.textContent = planStepIcon(status);
  });
}

// ===== Collapsible tool rows =====

/** Оборачивает строку tool в summary + раскрываемые детали. */
export function wrapAiToolCollapsible(
  el: HTMLElement,
  opts: ToolCollapsibleOpts,
): HTMLElement {
  const status = opts.status || 'done';
  const existing = el.classList.contains('ai-tool') ? el : el.querySelector('.ai-tool');
  const toolRow = (existing as HTMLElement) || el;

  let wrap = toolRow.closest('.ai-tool-collapsible') as HTMLElement | null;
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'ai-tool-collapsible';
    const parent = toolRow.parentElement;
    if (parent) {
      parent.insertBefore(wrap, toolRow);
      wrap.appendChild(toolRow);
    } else {
      wrap.appendChild(toolRow);
    }
  }

  wrap.classList.remove('is-pending', 'is-running', 'is-done', 'is-error');
  wrap.classList.add(`is-${status}`);

  toolRow.classList.remove('is-pending', 'is-running', 'is-done', 'is-error');
  toolRow.classList.add(`is-${status}`, 'ai-tool--summary');

  let labelEl = toolRow.querySelector('.ai-tool__label');
  if (!labelEl) {
    labelEl = document.createElement('span');
    labelEl.className = 'ai-tool__label';
    toolRow.appendChild(labelEl);
  }
  labelEl.textContent = opts.label;

  let details = wrap.querySelector<HTMLElement>('.ai-tool__details');
  if (!details) {
    details = document.createElement('pre');
    details.className = 'ai-tool__details';
    details.hidden = true;
    wrap.appendChild(details);
  }

  const formatted = formatDetail(opts.detail);
  details.textContent = formatted;
  wrap.classList.toggle('has-detail', Boolean(formatted));

  let toggle = wrap.querySelector<HTMLButtonElement>('.ai-tool__toggle');
  if (!toggle) {
    toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'ai-tool__toggle';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.title = 'Details';
    toggle.innerHTML = '<span class="ai-tool__chevron" aria-hidden="true"></span>';
    toolRow.appendChild(toggle);
    toggle.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const open = wrap!.classList.toggle('is-open');
      toggle!.setAttribute('aria-expanded', open ? 'true' : 'false');
      const panel = wrap!.querySelector<HTMLElement>('.ai-tool__details');
      if (panel) panel.hidden = !open;
    });
  }

  toggle.hidden = !formatted;
  if (!formatted) {
    wrap.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
    details.hidden = true;
  } else {
    details.hidden = !wrap.classList.contains('is-open');
  }

  return wrap;
}

// ===== Группировка раунда =====

/** Создаёт контейнер раунда агента внутри host. */
export function beginAiRound(host: HTMLElement): HTMLElement {
  const round = document.createElement('div');
  round.className = 'ai-round is-active';
  round.setAttribute('data-ai-round', '1');
  host.appendChild(round);
  return round;
}

/** Завершает раунд (убирает active-состояние). */
export function endAiRound(container: HTMLElement): void {
  container.classList.remove('is-active');
  container.classList.add('is-ended');
}

// ===== Статус в titlebar =====

/** Гарантирует наличие #ai-stage-status рядом с #ai-stage-title. */
export function ensureAiStageStatus(): HTMLElement | null {
  let el = document.getElementById('ai-stage-status');
  if (el) return el;
  const title = document.getElementById('ai-stage-title');
  const bar = title?.parentElement || document.getElementById('ai-chat-title');
  if (!bar || !title) return null;
  el = document.createElement('span');
  el.id = 'ai-stage-status';
  el.className = 'ai-stage-status';
  el.hidden = true;
  title.insertAdjacentElement('afterend', el);
  return el;
}

/** Обновляет статус агента в titlebar. */
export function setAiAgentStatus(status: AiAgentStatus, label?: string): void {
  const el = ensureAiStageStatus();
  if (!el) return;

  el.classList.remove(
    'is-idle',
    'is-thinking',
    'is-tool',
    'is-confirm',
    'is-streaming',
  );
  el.classList.add(`is-${status}`);

  if (status === 'idle') {
    el.hidden = true;
    el.textContent = '';
    el.removeAttribute('data-i18n');
    return;
  }

  el.hidden = false;
  const key = STATUS_I18N[status];
  if (label) {
    el.textContent = label;
    el.removeAttribute('data-i18n');
  } else {
    el.setAttribute('data-i18n', key);
    el.textContent = STATUS_FALLBACK[status];
  }
}

// ===== Stop =====

/** Показывает/скрывает кнопку остановки. */
export function setAiStopVisible(visible: boolean): void {
  ensureStopListener();
  const btn = document.getElementById('ai-stop') as HTMLButtonElement | null;
  if (!btn) return;
  btn.hidden = !visible;
  btn.classList.toggle('hidden', !visible);
}

/** Подписка на нажатие Stop. */
export function onAiStop(cb: () => void): void {
  stopCallback = cb;
  ensureStopListener();
}

// ===== Skeleton =====

/** Показывает skeleton в сообщениях, если ожидание > 400 мс. */
export function showAiSkeleton(host?: HTMLElement | null): void {
  hideAiSkeleton();
  const root =
    host ||
    document.getElementById('ai-messages') ||
    document.querySelector('.ai-stage__body');
  if (!root) return;

  skeletonTimer = setTimeout(() => {
    skeletonTimer = null;
    if (skeletonEl?.isConnected) return;
    const el = document.createElement('div');
    el.className = 'ai-skeleton';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = `
      <div class="ai-skeleton__line ai-skeleton__line--lg"></div>
      <div class="ai-skeleton__line"></div>
      <div class="ai-skeleton__line ai-skeleton__line--sm"></div>`;
    root.appendChild(el);
    skeletonEl = el;
  }, 400);
}

/** Скрывает skeleton и отменяет отложенный показ. */
export function hideAiSkeleton(): void {
  if (skeletonTimer != null) {
    clearTimeout(skeletonTimer);
    skeletonTimer = null;
  }
  skeletonEl?.remove();
  skeletonEl = null;
  document.querySelectorAll('.ai-skeleton').forEach((n) => n.remove());
}

// ===== Действия у ответа ассистента =====

const ICON_COPY =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M3.5 10.5V3.5A1 1 0 0 1 4.5 2.5h7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
const ICON_RETRY =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.2-3.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M13 3.5V7h-3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** Иконки Copy / Retry внутри пузыря ассистента. */
export function attachAiMessageActions(
  msgEl: HTMLElement,
  opts: MessageActionsOpts,
): HTMLElement {
  const host = msgEl.classList.contains('ai-msg__bubble')
    ? msgEl
    : (msgEl.querySelector('.ai-msg__bubble') as HTMLElement | null) || msgEl;
  host.querySelector('.ai-msg__actions')?.remove();

  const actions = document.createElement('div');
  actions.className = 'ai-msg__actions';

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'ai-msg__action';
  copyBtn.setAttribute('data-i18n-title', 'ai.copy');
  copyBtn.title = opts.copyLabel || 'Копировать';
  copyBtn.setAttribute('aria-label', opts.copyLabel || 'Копировать');
  copyBtn.innerHTML = ICON_COPY;
  copyBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    const text = bubblePlainText(msgEl);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
    opts.onCopy?.(text);
  });

  const retryBtn = document.createElement('button');
  retryBtn.type = 'button';
  retryBtn.className = 'ai-msg__action';
  retryBtn.setAttribute('data-i18n-title', 'ai.retry');
  retryBtn.title = opts.retryLabel || 'Повторить';
  retryBtn.setAttribute('aria-label', opts.retryLabel || 'Повторить');
  retryBtn.innerHTML = ICON_RETRY;
  retryBtn.addEventListener('click', (e) => {
    e.preventDefault();
    opts.onRetry?.();
  });
  if (!opts.onRetry) retryBtn.hidden = true;

  actions.append(copyBtn, retryBtn);
  host.appendChild(actions);
  return actions;
}
