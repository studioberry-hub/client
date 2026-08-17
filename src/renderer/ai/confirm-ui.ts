// ===== UI подтверждения / отмены действий AI-агента =====
// Подключение в app.ts (runAiToolSafe), вместо window.confirm:
//   import { askAiConfirmInChat } from './ai/confirm-ui';
//   const ok = await askAiConfirmInChat({ host, tool: name, args, risk: 'write' });
// Пакет write-tools за ход: askAiConfirmBatch({ host, items }).
// После успешного обратимого действия: pushAiUndo(...); renderAiUndoChip(host);

import type { AiUiHost, AiUndoAction } from './types';

const AI_UNDO_MAX = 20;
const undoStack: AiUndoAction[] = [];

type TranslateFn = AiUiHost['t'];

// ===== Человекочитаемые описания действий =====

function strArg(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  return typeof v === 'string' ? v.trim() : v != null ? String(v) : '';
}

function boolArg(args: Record<string, unknown>, key: string): boolean | null {
  const v = args[key];
  return typeof v === 'boolean' ? v : null;
}

function resolveBuildLabel(host: AiUiHost | null | undefined, buildId: string): string {
  if (!buildId) return '';
  const build = host?.getBuild?.(buildId);
  return build?.name || buildId;
}

/** Версия Java из пути (…/java8/… → 8). */
function javaVersionFromPath(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  const m =
    s.match(/java[-_]?(\d+(?:\.\d+)*)/i) ||
    s.match(/[/\\](jdk|jre)[-_]?(\d+)/i);
  if (m) {
    const ver = m[1] && /^\d/.test(m[1]) ? m[1] : m[2];
    if (ver) return ver;
  }
  const leaf = s.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || s;
  return leaf.length > 22 ? `${leaf.slice(0, 20)}…` : leaf;
}

/** Короткое имя Java для confirm-карточки. */
function shortJavaLabel(raw: string): string {
  const ver = javaVersionFromPath(raw);
  if (!ver) return '';
  return /^\d/.test(ver) ? `Java ${ver}` : ver;
}

function shortFieldValue(key: string, raw: string): string {
  if (!raw) return '';
  if (key === 'javaPath') return javaVersionFromPath(raw);
  if (key === 'memory') return raw;
  return raw;
}

export function describeAiAction(
  tool: string,
  args: Record<string, unknown>,
  t: TranslateFn,
  host?: AiUiHost | null,
): { title: string; detail: string } {
  const buildId = strArg(args, 'buildId');
  const buildName = resolveBuildLabel(host || null, buildId);
  const buildPart = buildName || buildId;

  switch (tool) {
    case 'update_build': {
      const parts: string[] = [];
      if (args.gameVersion != null) parts.push(`MC ${strArg(args, 'gameVersion')}`);
      if (args.loader != null) parts.push(strArg(args, 'loader'));
      if (args.javaPath != null) parts.push(shortJavaLabel(strArg(args, 'javaPath')));
      if (args.memoryMin != null || args.memoryMax != null) {
        parts.push(`RAM ${args.memoryMin ?? '…'}–${args.memoryMax ?? '…'}`);
      }
      if (args.name != null) parts.push(strArg(args, 'name'));
      return {
        title: t('ai.action.update_build'),
        detail: [buildPart, parts.join(' · ')].filter(Boolean).join(' · '),
      };
    }
    case 'install_mod': {
      const title = strArg(args, 'title') || strArg(args, 'projectId') || strArg(args, 'slug');
      return {
        title: t('ai.action.install_mod'),
        detail: [title, buildPart].filter(Boolean).join(' · '),
      };
    }
    case 'delete_build': {
      const files = boolArg(args, 'deleteFiles');
      return {
        title: t('ai.action.delete_build'),
        detail: [buildPart, files ? t('ai.action.delete_build.files') : ''].filter(Boolean).join(' · '),
      };
    }
    case 'toggle_mod': {
      const file = strArg(args, 'filename');
      const enabled = boolArg(args, 'enabled');
      const state =
        enabled === true
          ? t('ai.action.toggle_mod.on')
          : enabled === false
            ? t('ai.action.toggle_mod.off')
            : t('ai.action.toggle_mod.flip');
      return {
        title: t('ai.action.toggle_mod'),
        detail: [file, state, buildPart].filter(Boolean).join(' · '),
      };
    }
    case 'remove_build_file': {
      return {
        title: t('ai.action.remove_build_file'),
        detail: [strArg(args, 'filename'), buildPart].filter(Boolean).join(' · '),
      };
    }
    case 'select_build': {
      return {
        title: t('ai.action.select_build'),
        detail: buildPart,
      };
    }
    case 'create_build': {
      const name = strArg(args, 'name');
      const ver = strArg(args, 'gameVersion');
      return {
        title: t('ai.action.create_build'),
        detail: [name, ver].filter(Boolean).join(' · '),
      };
    }
    case 'duplicate_build': {
      return {
        title: t('ai.action.duplicate_build'),
        detail: buildPart,
      };
    }
    case 'delete_world': {
      return {
        title: t('ai.action.delete_world'),
        detail: [strArg(args, 'worldName') || strArg(args, 'folder'), buildPart]
          .filter(Boolean)
          .join(' · '),
      };
    }
    case 'delete_screenshot': {
      return {
        title: t('ai.action.delete_screenshot'),
        detail: [strArg(args, 'filename'), buildPart].filter(Boolean).join(' · '),
      };
    }
    case 'clear_logs': {
      return {
        title: t('ai.action.clear_logs'),
        detail: buildPart,
      };
    }
    default: {
      const actionTitle = t(`ai.action.${tool}`);
      const toolTitle = t(`ai.tool.${tool}`);
      const nice =
        actionTitle && actionTitle !== `ai.action.${tool}`
          ? actionTitle
          : toolTitle && toolTitle !== `ai.tool.${tool}`
            ? toolTitle
            : tool;
      return {
        title: t('ai.confirm.title', { tool: nice }),
        detail: buildPart || nice,
      };
    }
  }
}

// ===== Карточки подтверждения в чате =====

/** Нерешённые confirm-карточки, спрятанные при смене чата (сохраняют Promise/listeners) */
const parkedConfirmsBySession = new Map<string, HTMLElement[]>();

function isConfirmPending(el: Element): boolean {
  const body = el.querySelector('.ai-confirm-card');
  if (!body) return false;
  return !body.classList.contains('is-applied') && !body.classList.contains('is-rejected');
}

/** Убрать pending-confirm из DOM в парковку сессии (при clear/смене чата). */
export function parkAiConfirmsFromRoot(root: HTMLElement | null): void {
  if (!root) return;
  root.querySelectorAll('.ai-msg--confirm').forEach((node) => {
    const el = node as HTMLElement;
    if (!isConfirmPending(el)) {
      el.remove();
      return;
    }
    const sid = el.getAttribute('data-session-id') || '';
    if (!sid) {
      el.remove();
      return;
    }
    const list = parkedConfirmsBySession.get(sid) || [];
    list.push(el);
    parkedConfirmsBySession.set(sid, list);
    el.remove();
  });
}

/** Вернуть parked confirm-карточки в ленту активной сессии. */
export function restoreAiConfirmsForSession(sessionId: string, host: AiUiHost): void {
  if (!sessionId) return;
  const list = parkedConfirmsBySession.get(sessionId);
  if (!list?.length) return;
  parkedConfirmsBySession.delete(sessionId);
  const root = host.getMessagesRoot();
  if (!root) return;
  const empty = root.querySelector('#ai-empty');
  if (empty) empty.classList.add('hidden');
  for (const el of list) {
    if (isConfirmPending(el)) root.appendChild(el);
  }
  host.scrollToEnd();
}

function appendConfirmCard(
  host: AiUiHost,
  innerHtml: string,
  sessionId?: string | null,
): HTMLElement | null {
  const root = host.getMessagesRoot();
  if (!root) return null;
  const empty = root.querySelector('#ai-empty');
  if (empty) empty.classList.add('hidden');

  const el = document.createElement('div');
  el.className = 'ai-msg ai-msg--confirm';
  if (sessionId) el.setAttribute('data-session-id', sessionId);
  el.innerHTML = `<div class="ai-msg__bubble">${innerHtml}</div>`;
  root.appendChild(el);
  host.scrollToEnd();
  return el;
}

function markConfirmResolved(card: HTMLElement | null, applied: boolean, host: AiUiHost): void {
  if (!card) return;
  const body = card.querySelector('.ai-confirm-card');
  body?.classList.add(applied ? 'is-applied' : 'is-rejected');
  card.querySelectorAll('button').forEach((btn) => {
    (btn as HTMLButtonElement).disabled = true;
  });
  host.scrollToEnd();
}

export function askAiConfirmInChat(opts: {
  host: AiUiHost;
  tool: string;
  args: Record<string, unknown>;
  risk: string;
  sessionId?: string | null;
}): Promise<boolean> {
  const { host, tool, args } = opts;
  const { title, detail } = describeAiAction(tool, args, host.t, host);
  const esc = host.escapeHtml;

  const card = appendConfirmCard(
    host,
    `<div class="ai-confirm-card" data-tool="${esc(tool)}" data-risk="${esc(opts.risk || 'write')}">
      <div class="ai-confirm-card__title">${esc(title)}</div>
      ${detail ? `<div class="ai-confirm-card__detail">${esc(detail)}</div>` : ''}
      <div class="ai-confirm-card__actions">
        <button type="button" class="ai-confirm-card__btn ai-confirm-card__btn--apply" data-ai-confirm="apply">${esc(host.t('ai.confirm.apply'))}</button>
        <button type="button" class="ai-confirm-card__btn ai-confirm-card__btn--reject" data-ai-confirm="reject">${esc(host.t('ai.confirm.reject'))}</button>
      </div>
    </div>`,
    opts.sessionId,
  );

  return new Promise((resolve) => {
    if (!card) {
      resolve(false);
      return;
    }
    const onClick = (e: Event) => {
      const btn = (e.target as HTMLElement | null)?.closest?.('[data-ai-confirm]') as HTMLElement | null;
      if (!btn || !card.contains(btn)) return;
      const apply = btn.getAttribute('data-ai-confirm') === 'apply';
      card.removeEventListener('click', onClick);
      markConfirmResolved(card, apply, host);
      resolve(apply);
    };
    card.addEventListener('click', onClick);
  });
}

export function askAiConfirmBatch(opts: {
  host: AiUiHost;
  items: Array<{ tool: string; args: Record<string, unknown> }>;
  sessionId?: string | null;
}): Promise<boolean> {
  const { host, items } = opts;
  if (!items.length) return Promise.resolve(true);
  if (items.length === 1) {
    return askAiConfirmInChat({
      host,
      tool: items[0].tool,
      args: items[0].args,
      risk: 'write',
      sessionId: opts.sessionId,
    });
  }

  const esc = host.escapeHtml;
  const listHtml = items
    .map((item) => {
      const d = describeAiAction(item.tool, item.args, host.t, host);
      return `<li class="ai-confirm-card__item">
        <span class="ai-confirm-card__item-title">${esc(d.title)}</span>
        ${d.detail ? `<span class="ai-confirm-card__item-detail">${esc(d.detail)}</span>` : ''}
      </li>`;
    })
    .join('');

  const card = appendConfirmCard(
    host,
    `<div class="ai-confirm-card ai-confirm-card--batch">
      <div class="ai-confirm-card__title">${esc(host.t('ai.confirm.batch', { n: items.length }))}</div>
      <ul class="ai-confirm-card__list">${listHtml}</ul>
      <div class="ai-confirm-card__actions">
        <button type="button" class="ai-confirm-card__btn ai-confirm-card__btn--apply" data-ai-confirm="apply">${esc(host.t('ai.confirm.approveAll'))}</button>
        <button type="button" class="ai-confirm-card__btn ai-confirm-card__btn--reject" data-ai-confirm="reject">${esc(host.t('ai.confirm.rejectAll'))}</button>
      </div>
    </div>`,
    opts.sessionId,
  );

  return new Promise((resolve) => {
    if (!card) {
      resolve(false);
      return;
    }
    const onClick = (e: Event) => {
      const btn = (e.target as HTMLElement | null)?.closest?.('[data-ai-confirm]') as HTMLElement | null;
      if (!btn || !card.contains(btn)) return;
      const apply = btn.getAttribute('data-ai-confirm') === 'apply';
      card.removeEventListener('click', onClick);
      markConfirmResolved(card, apply, host);
      resolve(apply);
    };
    card.addEventListener('click', onClick);
  });
}

// ===== Стек отмены =====

export function pushAiUndo(action: AiUndoAction): void {
  undoStack.push(action);
  while (undoStack.length > AI_UNDO_MAX) undoStack.shift();
}

export function popAiUndo(): AiUndoAction | undefined {
  return undoStack.pop();
}

export function peekAiUndo(): AiUndoAction | undefined {
  return undoStack[undoStack.length - 1];
}

export function getAiUndoStack(): readonly AiUndoAction[] {
  return undoStack;
}

/** Чип отмены в toolbar композера (или в конце #ai-messages, если toolbar нет). */
export function renderAiUndoChip(host: AiUiHost): void {
  const toolbarLeft = document.querySelector('.ai-composer__toolbar-left') as HTMLElement | null;
  const meta = document.querySelector('.ai-composer-meta') as HTMLElement | null;
  const messages = host.getMessagesRoot();
  const mount = toolbarLeft || meta || messages;
  if (!mount) return;

  let chip =
    (document.getElementById('ai-undo-chip') as HTMLButtonElement | null) ||
    (mount.querySelector('.ai-undo-chip') as HTMLButtonElement | null);
  const top = peekAiUndo();

  if (!top) {
    if (chip) {
      chip.classList.add('hidden');
      chip.hidden = true;
      chip.textContent = '';
    }
    return;
  }

  if (!chip) {
    chip = document.createElement('button');
    chip.type = 'button';
    chip.id = 'ai-undo-chip';
    chip.className = 'ai-undo-chip';
    if (toolbarLeft) {
      toolbarLeft.appendChild(chip);
    } else if (meta) {
      const ring = meta.querySelector('#ai-context-ring');
      if (ring) meta.insertBefore(chip, ring);
      else meta.appendChild(chip);
    } else {
      messages!.appendChild(chip);
    }
  }

  if (!chip.dataset.bound) {
    chip.dataset.bound = '1';
    chip.addEventListener('click', async () => {
      const action = popAiUndo();
      renderAiUndoChip(host);
      if (!action) return;
      try {
        await action.revert();
      } catch {
        // Ошибка отката не должна ломать UI
      }
    });
  }

  const label = top.label || host.t('ai.undo');
  chip.textContent = host.t('ai.undo');
  chip.title = label;
  chip.setAttribute('aria-label', label);
  chip.classList.remove('hidden');
  chip.hidden = false;
}

/** Алиас: панель/чип отмены после write-tools. */
export function renderAiUndoBar(host: AiUiHost): void {
  renderAiUndoChip(host);
}

// ===== Diff полей сборки =====

type BuildDiffSnap = {
  gameVersion?: unknown;
  loader?: unknown;
  javaPath?: unknown;
  memory?: unknown;
  memoryMin?: unknown;
  memoryMax?: unknown;
};

function formatMemory(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object') {
    const m = v as { min?: unknown; max?: unknown };
    return `${m.min ?? '…'}–${m.max ?? '…'}`;
  }
  return String(v);
}

function normalizeField(key: string, snap: BuildDiffSnap): string {
  if (key === 'memory') {
    if (snap.memory != null) return formatMemory(snap.memory);
    if (snap.memoryMin != null || snap.memoryMax != null) {
      return `${snap.memoryMin ?? '…'}–${snap.memoryMax ?? '…'}`;
    }
    return '';
  }
  const raw = (snap as Record<string, unknown>)[key];
  return raw == null ? '' : String(raw);
}

const DIFF_FIELD_LABEL: Record<string, string> = {
  gameVersion: 'ai.diff.field.gameVersion',
  loader: 'ai.diff.field.loader',
  javaPath: 'ai.diff.field.java',
  memory: 'ai.diff.field.memory',
};

/** Компактный diff: «Java  25 → 8», без длинных путей. */
export function renderAiBuildDiff(
  before: BuildDiffSnap | null | undefined,
  after: BuildDiffSnap | null | undefined,
  host?: AiUiHost | null,
): HTMLElement {
  const fields = ['gameVersion', 'loader', 'javaPath', 'memory'] as const;
  const t = host?.t || ((k: string) => k);
  const esc = host?.escapeHtml || ((s: string) => s);

  const rows: string[] = [];
  for (const key of fields) {
    const rawA = normalizeField(key, before || {});
    const rawB = normalizeField(key, after || {});
    if (rawA === rawB) continue;
    const a = shortFieldValue(key, rawA) || '—';
    const b = shortFieldValue(key, rawB) || '—';
    const labelKey = DIFF_FIELD_LABEL[key];
    const label = labelKey ? t(labelKey) : key;
    const titleAttr =
      key === 'javaPath' && (rawA || rawB)
        ? ` title="${esc(`${rawA || '—'} → ${rawB || '—'}`)}"`
        : '';
    rows.push(`<div class="ai-diff__row"${titleAttr}>
      <span class="ai-diff__key">${esc(label)}</span>
      <span class="ai-diff__change">
        <span class="ai-diff__before">${esc(a)}</span>
        <span class="ai-diff__arrow" aria-hidden="true">→</span>
        <span class="ai-diff__after">${esc(b)}</span>
      </span>
    </div>`);
  }

  const el = document.createElement('div');
  el.className = 'ai-diff';
  el.innerHTML = rows.length
    ? rows.join('')
    : `<div class="ai-diff__empty">${esc(t('ai.diff.empty'))}</div>`;
  return el;
}
