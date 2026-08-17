// ===== UI вложений агента (как @ в Cursor): контекст + возможности ИИ =====

import {
  Boxes,
  ChevronLeft,
  ChevronRight,
  FileArchive,
  FileText,
  Globe,
  Image,
  Layers,
  Package,
  ScrollText,
  Search,
  Sparkles,
  Stethoscope,
  Terminal,
  TriangleAlert,
  X,
  type IconNode,
} from './attach-icons';
import type { AiUiHost } from './types';

export type AiAttachKind =
  | 'build'
  | 'mod'
  | 'resourcepack'
  | 'shader'
  | 'datapack'
  | 'file'
  | 'crash'
  | 'log'
  | 'web'
  | 'commands'
  | 'diagnose';

export type AiAttachment = {
  id: string;
  kind: AiAttachKind;
  label: string;
  detail?: string;
  buildId?: string;
  filename?: string;
  path?: string;
  /** URL иконки сборки (для badge / списка) */
  iconSrc?: string;
  iconBg?: string;
  /** Текстовое содержимое (логи/файлы), уже усечённое */
  text?: string;
};

export type AiAttachBuild = {
  id: string;
  name: string;
  gameVersion: string;
  loader: string;
  iconSrc?: string;
  iconBg?: string;
};

type AttachView =
  | { mode: 'root' }
  | { mode: 'builds'; purpose: 'attach' | 'pick-for-content'; contentKind: AiAttachKind }
  | {
      mode: 'content';
      buildId: string;
      buildName: string;
      contentKind: AiAttachKind;
      items: { filename: string; title?: string }[];
    }
  | { mode: 'loading'; label: string };

type AttachHost = AiUiHost & {
  getBuilds: () => AiAttachBuild[];
  getSessionBuildId: () => string | null;
  scanBuildContent: (buildId: string) => Promise<{
    mods: { filename: string; name?: string }[];
    resourcepacks: { filename: string; name?: string }[];
    shaders: { filename: string; name?: string }[];
    datapacks: { filename: string; name?: string }[];
  } | null>;
  pickFiles: () => Promise<string[]>;
  readAttachFile: (filePath: string) => Promise<{ name: string; path: string; text?: string; error?: string } | null>;
  getCrashLog: (buildId: string) => Promise<string | null>;
  getLatestLog: (buildId: string) => Promise<string | null>;
  closeOtherPopovers: () => void;
  onAttachmentsChange: (items: AiAttachment[]) => void;
};

const MAX_ATTACH = 12;
const MAX_TEXT_CHARS = 12_000;

const CAPABILITY_KINDS: AiAttachKind[] = ['web', 'commands', 'diagnose'];

let host: AttachHost | null = null;
let attachments: AiAttachment[] = [];
let view: AttachView = { mode: 'root' };
let filterQuery = '';
let menuBound = false;
let viewAnimDir: 'forward' | 'back' = 'forward';

function uid(): string {
  return `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function esc(s: string): string {
  return host ? host.escapeHtml(s) : s;
}

function t(key: string, params?: Record<string, string | number>): string {
  return host?.t(key, params) || key;
}

function kindLabel(kind: AiAttachKind): string {
  const map: Record<AiAttachKind, string> = {
    build: 'ai.attach.kind.build',
    mod: 'ai.attach.kind.mod',
    resourcepack: 'ai.attach.kind.resourcepack',
    shader: 'ai.attach.kind.shader',
    datapack: 'ai.attach.kind.datapack',
    file: 'ai.attach.kind.file',
    crash: 'ai.attach.kind.crash',
    log: 'ai.attach.kind.log',
    web: 'ai.attach.kind.web',
    commands: 'ai.attach.kind.commands',
    diagnose: 'ai.attach.kind.diagnose',
  };
  return t(map[kind]);
}

function isCapability(kind: AiAttachKind): boolean {
  return CAPABILITY_KINDS.includes(kind);
}

/** Lucide IconNode → SVG-строка */
function lucideSvg(icon: IconNode, size = 15, cls = 'ai-attach-ico'): string {
  const body = icon
    .map(([tag, attrs]) => {
      const a = Object.entries(attrs)
        .map(([k, v]) => `${k}="${String(v).replace(/"/g, '&quot;')}"`)
        .join(' ');
      return `<${tag} ${a}/>`;
    })
    .join('');
  return `<svg class="${cls}" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

function kindLucide(kind: AiAttachKind): IconNode {
  switch (kind) {
    case 'build':
      return Boxes;
    case 'mod':
      return Package;
    case 'resourcepack':
      return Image;
    case 'shader':
      return Sparkles;
    case 'datapack':
      return Layers;
    case 'file':
      return FileText;
    case 'crash':
      return TriangleAlert;
    case 'log':
      return ScrollText;
    case 'web':
      return Globe;
    case 'commands':
      return Terminal;
    case 'diagnose':
      return Stethoscope;
    default:
      return FileArchive;
  }
}

function kindIcon(kind: AiAttachKind, size = 15): string {
  return lucideSvg(kindLucide(kind), size);
}

function chevronSvg(dir: 'right' | 'left' = 'right'): string {
  return lucideSvg(dir === 'left' ? ChevronLeft : ChevronRight, 16, 'ai-attach-menu__chev');
}

function buildThumbHtml(opts: { iconSrc?: string; iconBg?: string; size?: 'sm' | 'md' }): string {
  const cls = opts.size === 'sm' ? 'ai-attach-thumb ai-attach-thumb--sm' : 'ai-attach-thumb';
  // Своя иконка или newBuild.png; цветной iconBg больше не используем как заглушку
  const src = opts.iconSrc || '../../assets/InstancesIcons/newBuild.png';
  return `<img class="${cls}" src="${esc(src)}" alt="" draggable="false">`;
}

export function getAiAttachments(): readonly AiAttachment[] {
  return attachments;
}

export function clearAiAttachments(): void {
  attachments = [];
  host?.onAttachmentsChange(attachments);
  renderAiAttachChips();
}

function pushAttachment(item: AiAttachment): void {
  if (attachments.length >= MAX_ATTACH) return;
  const dup = attachments.some((a) => {
    if (a.kind !== item.kind) return false;
    if (isCapability(item.kind)) return true;
    if (item.kind === 'build') return a.buildId === item.buildId;
    if (item.kind === 'file') return a.path === item.path;
    if (item.kind === 'crash' || item.kind === 'log') return a.buildId === item.buildId && a.kind === item.kind;
    return a.buildId === item.buildId && a.filename === item.filename;
  });
  if (dup) return;
  attachments = [...attachments, item];
  host?.onAttachmentsChange(attachments);
  renderAiAttachChips();
}

export function removeAiAttachment(id: string): void {
  attachments = attachments.filter((a) => a.id !== id);
  host?.onAttachmentsChange(attachments);
  renderAiAttachChips();
}

function hasCapability(kind: AiAttachKind): boolean {
  return attachments.some((a) => a.kind === kind);
}

function toggleCapability(kind: 'web' | 'commands' | 'diagnose'): void {
  const existing = attachments.find((a) => a.kind === kind);
  if (existing) {
    removeAiAttachment(existing.id);
    return;
  }
  pushAttachment({
    id: uid(),
    kind,
    label: kindLabel(kind),
    detail: t(`ai.attach.${kind}Hint`),
  });
}

const ATTACH_WIRE_HEADER = '### Вложения пользователя';

/** Подписи kind из локалей (en/ru), сохранённые в wire-промпте */
const CONTENT_KIND_BY_LABEL: Record<string, AiAttachKind> = {
  Мод: 'mod',
  Mod: 'mod',
  РП: 'resourcepack',
  RP: 'resourcepack',
  Шейдер: 'shader',
  Shader: 'shader',
  ДП: 'datapack',
  DP: 'datapack',
};

const LOG_KIND_BY_LABEL: Record<string, AiAttachKind> = {
  Crash: 'crash',
  Лог: 'log',
  Log: 'log',
};

function niceAttachFileLabel(filename: string): string {
  return (filename.replace(/\.disabled$/i, '').replace(/\.(jar|zip)$/i, '') || filename).trim();
}

function pathBasename(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || p;
}

/** Текст для вставки в user-prompt перед отправкой. */
export function formatAiAttachmentsPrompt(items: readonly AiAttachment[]): string {
  if (!items.length) return '';
  const blocks: string[] = [ATTACH_WIRE_HEADER];
  for (const a of items) {
    if (a.kind === 'web') {
      blocks.push(
        '- Возможность: поиск в интернете ВКЛЮЧЕНА. Обязательно вызывай tool `web_search` для актуальных фактов и внешних ссылок; при необходимости читай страницу через `fetch_url`. Не утверждай, что нет доступа к интернету или нет tool поиска. Не выдумывай URL — бери их только из результатов tools.',
      );
      continue;
    }
    if (a.kind === 'commands') {
      blocks.push(
        '- Возможность: команды — давай готовые команды Minecraft / лаунчера / shell там, где это уместно.',
      );
      continue;
    }
    if (a.kind === 'diagnose') {
      blocks.push(
        '- Возможность: глубокая диагностика — системно разбирай логи, конфликты модов и настройки Java.',
      );
      continue;
    }
    if (a.kind === 'build') {
      blocks.push(
        `- Сборка: «${a.label}» (id=${a.buildId || '?'}${a.detail ? `, ${a.detail}` : ''}). Используй select_build / tools с этим buildId.`,
      );
      continue;
    }
    if (a.kind === 'mod' || a.kind === 'resourcepack' || a.kind === 'shader' || a.kind === 'datapack') {
      blocks.push(
        `- ${kindLabel(a.kind)}: \`${a.filename || a.label}\` в сборке id=${a.buildId || '?'}${a.detail ? ` (${a.detail})` : ''}.`,
      );
      continue;
    }
    if (a.kind === 'file') {
      blocks.push(`- Файл: ${a.path || a.label}`);
      if (a.text) blocks.push('```\n' + a.text.slice(0, MAX_TEXT_CHARS) + '\n```');
      continue;
    }
    if (a.kind === 'crash' || a.kind === 'log') {
      blocks.push(`- ${kindLabel(a.kind)} сборки id=${a.buildId || '?'}:`);
      if (a.text) blocks.push('```\n' + a.text.slice(0, MAX_TEXT_CHARS) + '\n```');
      else blocks.push('  (пусто — прочитай через get_crash_report / get_latest_log)');
    }
  }
  return blocks.join('\n');
}

// ===== Разбор сохранённого wire-блока вложений =====

/** Восстановить badge-данные и видимый текст пользователя из сохранённого wire-промпта. */
export function parseAiAttachmentsPrompt(wire: string): {
  text: string;
  attachments: AiAttachment[];
} {
  const raw = String(wire || '');
  const headerIdx = raw.indexOf(ATTACH_WIRE_HEADER);
  if (headerIdx < 0) return { text: raw, attachments: [] };

  const before = raw.slice(0, headerIdx).trim();
  const lines = raw.slice(headerIdx + ATTACH_WIRE_HEADER.length).split('\n');
  let i = lines[0] === '' ? 1 : 0;
  const attachments: AiAttachment[] = [];
  let attachEnd = i;

  const readFence = (start: number): { text?: string; next: number } => {
    if (lines[start] !== '```') return { next: start };
    let j = start + 1;
    const body: string[] = [];
    while (j < lines.length && lines[j] !== '```') {
      body.push(lines[j]);
      j += 1;
    }
    if (j < lines.length && lines[j] === '```') j += 1;
    return { text: body.join('\n'), next: j };
  };

  while (i < lines.length) {
    const line = lines[i];
    if (line === '') {
      let k = i + 1;
      while (k < lines.length && lines[k] === '') k += 1;
      if (k >= lines.length || !lines[k].startsWith('- ')) {
        attachEnd = i;
        break;
      }
      i += 1;
      continue;
    }
    if (!line.startsWith('- ')) {
      attachEnd = i;
      break;
    }

    if (line.startsWith('- Возможность: поиск в интернете')) {
      attachments.push({ id: uid(), kind: 'web', label: kindLabel('web') });
      i += 1;
      attachEnd = i;
      continue;
    }
    if (line.startsWith('- Возможность: команды')) {
      attachments.push({ id: uid(), kind: 'commands', label: kindLabel('commands') });
      i += 1;
      attachEnd = i;
      continue;
    }
    if (line.startsWith('- Возможность: глубокая диагностика')) {
      attachments.push({ id: uid(), kind: 'diagnose', label: kindLabel('diagnose') });
      i += 1;
      attachEnd = i;
      continue;
    }

    const buildMatch = line.match(/^- Сборка: «(.+?)» \(id=([^,)]+)(?:,\s*(.+?))?\)\./);
    if (buildMatch) {
      attachments.push({
        id: uid(),
        kind: 'build',
        label: buildMatch[1],
        buildId: buildMatch[2] === '?' ? undefined : buildMatch[2],
        detail: buildMatch[3],
      });
      i += 1;
      attachEnd = i;
      continue;
    }

    const contentMatch = line.match(
      /^- (.+?): `([^`]+)` в сборке id=([^\s(]+)(?:\s*\(([^)]*)\))?\.?\s*$/,
    );
    if (contentMatch) {
      const kind = CONTENT_KIND_BY_LABEL[contentMatch[1]];
      if (kind) {
        const filename = contentMatch[2];
        attachments.push({
          id: uid(),
          kind,
          label: niceAttachFileLabel(filename),
          filename,
          buildId: contentMatch[3] === '?' ? undefined : contentMatch[3],
          detail: contentMatch[4] || undefined,
        });
        i += 1;
        attachEnd = i;
        continue;
      }
    }

    if (line.startsWith('- Файл: ')) {
      const filePath = line.slice('- Файл: '.length).trim();
      i += 1;
      const fence = readFence(i);
      i = fence.next;
      attachments.push({
        id: uid(),
        kind: 'file',
        label: pathBasename(filePath),
        path: filePath,
        detail: filePath,
        text: fence.text,
      });
      attachEnd = i;
      continue;
    }

    const logMatch = line.match(/^- (.+?) сборки id=([^:]+):\s*$/);
    if (logMatch) {
      const kind = LOG_KIND_BY_LABEL[logMatch[1]];
      if (kind) {
        const buildId = logMatch[2].trim() === '?' ? undefined : logMatch[2].trim();
        i += 1;
        let text: string | undefined;
        if (lines[i] === '```') {
          const fence = readFence(i);
          text = fence.text;
          i = fence.next;
        } else if ((lines[i] || '').trim() === '(пусто — прочитай через get_crash_report / get_latest_log)') {
          i += 1;
        }
        attachments.push({
          id: uid(),
          kind,
          label: buildId || kindLabel(kind),
          buildId,
          detail: kind === 'crash' ? kindLabel('crash') : 'latest.log',
          text,
        });
        attachEnd = i;
        continue;
      }
    }

    attachEnd = i;
    break;
  }

  if (i >= lines.length) attachEnd = lines.length;
  const userPart = lines.slice(attachEnd).join('\n').replace(/^\n+/, '').trim();
  const text = [before, userPart].filter(Boolean).join('\n\n');
  return { text, attachments };
}

function badgeHtml(a: AiAttachment, removable: boolean): string {
  const title = a.detail || a.label;
  const x = removable
    ? `<span class="ai-attach-badge__x" aria-hidden="true">${lucideSvg(X, 12, 'ai-attach-badge__xico')}</span>`
    : '';
  const tag = removable ? 'button' : 'span';
  const typeAttr = removable ? ' type="button"' : '';
  const data = removable ? ` data-attach-id="${esc(a.id)}"` : '';
  const text = isCapability(a.kind)
    ? `<span class="ai-attach-badge__label">${esc(a.label)}</span>`
    : `<span class="ai-attach-badge__kind">${esc(kindLabel(a.kind))}</span>
       <span class="ai-attach-badge__label">${esc(a.label)}</span>`;
  const useBuildThumb =
    (a.kind === 'build' || a.kind === 'crash' || a.kind === 'log') && (a.iconSrc || a.iconBg);
  const ico = useBuildThumb
    ? buildThumbHtml({ iconSrc: a.iconSrc, iconBg: a.iconBg, size: 'sm' })
    : `<span class="ai-attach-badge__ico">${kindIcon(a.kind, 14)}</span>`;
  return `<${tag}${typeAttr} class="ai-attach-badge ai-attach-badge--${esc(a.kind)}"${data} title="${esc(title)}">
    ${ico}
    <span class="ai-attach-badge__text">${text}</span>
    ${x}
  </${tag}>`;
}

/** HTML badge-ряда для пузыря сообщения */
export function renderAiAttachBadgesHtml(items: readonly AiAttachment[]): string {
  if (!items.length) return '';
  return `<div class="ai-attach-badges ai-attach-badges--msg">${items.map((a) => badgeHtml(a, false)).join('')}</div>`;
}

export function renderAiAttachChips(): void {
  const root = document.getElementById('ai-attach-chips');
  if (!root) return;
  if (!attachments.length) {
    root.innerHTML = '';
    root.hidden = true;
    return;
  }
  root.hidden = false;
  root.innerHTML = `<div class="ai-attach-badges">${attachments.map((a) => badgeHtml(a, true)).join('')}</div>`;
}

function setAttachMenuOpen(open: boolean): void {
  const menu = document.getElementById('ai-attach-menu');
  const btn = document.getElementById('ai-attach');
  if (!menu || !btn) return;
  if (open) {
    view = { mode: 'root' };
    filterQuery = '';
    viewAnimDir = 'forward';
    renderAttachMenuBody();
    menu.classList.remove('hidden');
    requestAnimationFrame(() => menu.classList.add('is-open'));
    btn.setAttribute('aria-expanded', 'true');
  } else if (menu.classList.contains('is-open') || !menu.classList.contains('hidden')) {
    menu.classList.remove('is-open');
    btn.setAttribute('aria-expanded', 'false');
    window.setTimeout(() => {
      if (!menu.classList.contains('is-open')) menu.classList.add('hidden');
    }, 180);
  }
}

export function closeAiAttachMenu(): void {
  setAttachMenuOpen(false);
}

export function toggleAiAttachMenu(): void {
  const menu = document.getElementById('ai-attach-menu');
  if (!menu) return;
  setAttachMenuOpen(!menu.classList.contains('is-open'));
}

function rowBtn(opts: {
  id: string;
  kind: AiAttachKind;
  title: string;
  hint?: string;
  disabled?: boolean;
  toggle?: boolean;
  active?: boolean;
  index?: number;
}): string {
  const i = opts.index ?? 0;
  const state = opts.toggle
    ? opts.active
      ? ' is-active'
      : ''
    : opts.disabled
      ? ' is-disabled'
      : '';
  const trailing = opts.toggle
    ? `<span class="ai-attach-menu__check${opts.active ? ' is-on' : ''}" aria-hidden="true"></span>`
    : `<span class="ai-attach-menu__trail">${chevronSvg('right')}</span>`;
  return `<button type="button" class="ai-attach-menu__row${state}" style="--i:${i}" data-attach-action="${esc(opts.id)}" ${opts.disabled ? 'disabled' : ''}>
    <span class="ai-attach-menu__ico ai-attach-badge--${esc(opts.kind)}">${kindIcon(opts.kind, 16)}</span>
    <span class="ai-attach-menu__row-main">
      <span class="ai-attach-menu__row-title">${esc(opts.title)}</span>
      ${opts.hint ? `<span class="ai-attach-menu__row-hint">${esc(opts.hint)}</span>` : ''}
    </span>
    ${trailing}
  </button>`;
}

function sectionLabel(text: string): string {
  return `<div class="ai-attach-menu__section">${esc(text)}</div>`;
}

function matchQuery(text: string, q: string): boolean {
  return !q || text.toLowerCase().includes(q);
}

function renderAttachMenuBody(): void {
  const menu = document.getElementById('ai-attach-menu');
  if (!menu || !host) return;
  const anim = viewAnimDir === 'back' ? 'is-slide-back' : 'is-slide-fwd';

  if (view.mode === 'loading') {
    menu.innerHTML = `
      <div class="ai-attach-menu__panel ${anim}">
        <div class="ai-attach-menu__head">
          <div class="ai-attach-menu__title">${esc(t('ai.attach.title'))}</div>
        </div>
        <div class="ai-attach-menu__empty ai-attach-menu__empty--load">
          <span class="ai-attach-menu__spinner" aria-hidden="true"></span>
          ${esc(view.label)}
        </div>
      </div>`;
    return;
  }

  if (view.mode === 'root') {
    const hasBuild = Boolean(host.getSessionBuildId());
    const q = filterQuery.trim().toLowerCase();
    const ctxAll: Array<{ id: string; kind: AiAttachKind; title: string; hint?: string; disabled?: boolean }> = [
      { id: 'build', kind: 'build', title: t('ai.attach.addBuild'), hint: t('ai.attach.addBuildHint') },
      {
        id: 'mod',
        kind: 'mod',
        title: t('ai.attach.addMod'),
        hint: hasBuild ? t('ai.attach.fromContextBuild') : t('ai.attach.pickBuildFirst'),
      },
      { id: 'resourcepack', kind: 'resourcepack', title: t('ai.attach.addResourcepack'), hint: t('ai.attach.addResourcepackHint') },
      { id: 'shader', kind: 'shader', title: t('ai.attach.addShader'), hint: t('ai.attach.addShaderHint') },
      { id: 'datapack', kind: 'datapack', title: t('ai.attach.addDatapack'), hint: t('ai.attach.addDatapackHint') },
      { id: 'file', kind: 'file', title: t('ai.attach.addFile'), hint: t('ai.attach.addFileHint') },
      { id: 'crash', kind: 'crash', title: t('ai.attach.addCrash'), hint: t('ai.attach.addCrashHint'), disabled: !hasBuild },
      { id: 'log', kind: 'log', title: t('ai.attach.addLog'), hint: t('ai.attach.addLogHint'), disabled: !hasBuild },
    ];
    const ctxRows = ctxAll.filter((r) => matchQuery(`${r.title} ${r.hint || ''}`, q));

    const capAll: Array<{ id: 'web' | 'commands' | 'diagnose'; kind: AiAttachKind; title: string; hint: string }> = [
      { id: 'web', kind: 'web', title: t('ai.attach.addWeb'), hint: t('ai.attach.webHint') },
      { id: 'commands', kind: 'commands', title: t('ai.attach.addCommands'), hint: t('ai.attach.commandsHint') },
      { id: 'diagnose', kind: 'diagnose', title: t('ai.attach.addDiagnose'), hint: t('ai.attach.diagnoseHint') },
    ];
    const capRows = capAll.filter((r) => matchQuery(`${r.title} ${r.hint}`, q));

    let i = 0;
    menu.innerHTML = `
      <div class="ai-attach-menu__panel ${anim}">
        <div class="ai-attach-menu__head">
          <div class="ai-attach-menu__title">${esc(t('ai.attach.title'))}</div>
        </div>
        <div class="ai-attach-menu__search-wrap">
          <span class="ai-attach-menu__search-ico" aria-hidden="true">${lucideSvg(Search, 14)}</span>
          <input type="search" class="ai-attach-menu__search" id="ai-attach-search" placeholder="${esc(t('ai.attach.search'))}" value="${esc(filterQuery)}" autocomplete="off">
        </div>
        <div class="ai-attach-menu__list">
          ${ctxRows.length ? sectionLabel(t('ai.attach.sectionContext')) : ''}
          ${ctxRows.map((r) => rowBtn({ ...r, index: i++ })).join('')}
          ${capRows.length ? sectionLabel(t('ai.attach.sectionSkills')) : ''}
          ${capRows
            .map((r) =>
              rowBtn({
                id: r.id,
                kind: r.kind,
                title: r.title,
                hint: r.hint,
                toggle: true,
                active: hasCapability(r.kind),
                index: i++,
              }),
            )
            .join('')}
          ${!ctxRows.length && !capRows.length ? `<div class="ai-attach-menu__empty">${esc(t('ai.attach.emptySearch'))}</div>` : ''}
        </div>
        <div class="ai-attach-menu__foot">${esc(t('ai.attach.foot', { n: attachments.length, max: MAX_ATTACH }))}</div>
      </div>`;
    bindSearch();
    return;
  }

  if (view.mode === 'builds') {
    const q = filterQuery.trim().toLowerCase();
    const builds = host
      .getBuilds()
      .filter((b) => !q || b.name.toLowerCase().includes(q) || b.id.toLowerCase().includes(q));
    menu.innerHTML = `
      <div class="ai-attach-menu__panel ${anim}">
        <div class="ai-attach-menu__head">
          <button type="button" class="ai-attach-menu__back" data-attach-action="back" aria-label="Back">${chevronSvg('left')}</button>
          <div class="ai-attach-menu__title">${esc(t('ai.attach.pickBuild'))}</div>
        </div>
        <div class="ai-attach-menu__search-wrap">
          <input type="search" class="ai-attach-menu__search" id="ai-attach-search" placeholder="${esc(t('ai.attach.search'))}" value="${esc(filterQuery)}" autocomplete="off">
        </div>
        <div class="ai-attach-menu__list">
          ${
            builds.length
              ? builds
                  .map(
                    (b, idx) => `<button type="button" class="ai-attach-menu__row" style="--i:${idx}" data-attach-build="${esc(b.id)}">
              ${buildThumbHtml({ iconSrc: b.iconSrc, iconBg: b.iconBg })}
              <span class="ai-attach-menu__row-main">
                <span class="ai-attach-menu__row-title">${esc(b.name)}</span>
                <span class="ai-attach-menu__row-hint">${esc([b.gameVersion, b.loader].filter(Boolean).join(' · '))}</span>
              </span>
              <span class="ai-attach-menu__trail">${chevronSvg('right')}</span>
            </button>`,
                  )
                  .join('')
              : `<div class="ai-attach-menu__empty">${esc(t('ai.attach.emptyBuilds'))}</div>`
          }
        </div>
      </div>`;
    bindSearch();
    return;
  }

  if (view.mode === 'content') {
    const q = filterQuery.trim().toLowerCase();
    const contentBuildId = view.buildId;
    const contentKind = view.contentKind;
    const contentBuildName = view.buildName;
    const items = view.items.filter(
      (it) => !q || it.filename.toLowerCase().includes(q) || (it.title || '').toLowerCase().includes(q),
    );
    menu.innerHTML = `
      <div class="ai-attach-menu__panel ${anim}">
        <div class="ai-attach-menu__head">
          <button type="button" class="ai-attach-menu__back" data-attach-action="back-content" aria-label="Back">${chevronSvg('left')}</button>
          <div class="ai-attach-menu__title">${esc(contentBuildName)} · ${esc(kindLabel(contentKind))}</div>
        </div>
        <div class="ai-attach-menu__search-wrap">
          <input type="search" class="ai-attach-menu__search" id="ai-attach-search" placeholder="${esc(t('ai.attach.search'))}" value="${esc(filterQuery)}" autocomplete="off">
        </div>
        <div class="ai-attach-menu__list">
          ${
            items.length
              ? items
                  .map(
                    (it, idx) => `<button type="button" class="ai-attach-menu__row" style="--i:${idx}" data-attach-file="${esc(it.filename)}" data-attach-build="${esc(contentBuildId)}" data-attach-kind="${esc(contentKind)}">
              <span class="ai-attach-menu__ico ai-attach-badge--${esc(contentKind)}">${kindIcon(contentKind)}</span>
              <span class="ai-attach-menu__row-main">
                <span class="ai-attach-menu__row-title">${esc((it.title || it.filename).replace(/\.disabled$/i, '').replace(/\.(jar|zip)$/i, ''))}</span>
                <span class="ai-attach-menu__row-hint">${esc(it.filename)}</span>
              </span>
            </button>`,
                  )
                  .join('')
              : `<div class="ai-attach-menu__empty">${esc(t('ai.attach.emptyContent'))}</div>`
          }
        </div>
      </div>`;
    bindSearch();
  }
}

function bindSearch(): void {
  const input = document.getElementById('ai-attach-search') as HTMLInputElement | null;
  if (!input) return;
  input.focus();
  input.addEventListener('input', () => {
    filterQuery = input.value || '';
    renderAttachMenuBody();
    const again = document.getElementById('ai-attach-search') as HTMLInputElement | null;
    if (again) {
      const pos = filterQuery.length;
      again.focus();
      again.setSelectionRange(pos, pos);
    }
  });
}

async function openContentPicker(buildId: string, contentKind: AiAttachKind): Promise<void> {
  if (!host) return;
  const build = host.getBuilds().find((b) => b.id === buildId);
  viewAnimDir = 'forward';
  view = { mode: 'loading', label: t('ai.attach.loading') };
  renderAttachMenuBody();
  const scanned = await host.scanBuildContent(buildId);
  const key =
    contentKind === 'mod'
      ? 'mods'
      : contentKind === 'resourcepack'
        ? 'resourcepacks'
        : contentKind === 'shader'
          ? 'shaders'
          : 'datapacks';
  const raw = scanned?.[key] || [];
  view = {
    mode: 'content',
    buildId,
    buildName: build?.name || buildId,
    contentKind,
    items: raw.map((x) => ({ filename: x.filename, title: x.name })),
  };
  filterQuery = '';
  viewAnimDir = 'forward';
  renderAttachMenuBody();
}

async function attachLog(kind: 'crash' | 'log'): Promise<void> {
  if (!host) return;
  const buildId = host.getSessionBuildId();
  if (!buildId) return;
  const build = host.getBuilds().find((b) => b.id === buildId);
  view = { mode: 'loading', label: t('ai.attach.loading') };
  renderAttachMenuBody();
  const text =
    kind === 'crash' ? await host.getCrashLog(buildId) : await host.getLatestLog(buildId);
  pushAttachment({
    id: uid(),
    kind,
    label: build?.name || buildId,
    detail: kind === 'crash' ? t('ai.attach.kind.crash') : 'latest.log',
    buildId,
    iconSrc: build?.iconSrc,
    iconBg: build?.iconBg,
    text: text ? text.slice(-MAX_TEXT_CHARS) : undefined,
  });
  setAttachMenuOpen(false);
}

async function attachFilesFromDisk(): Promise<void> {
  if (!host) return;
  const paths = await host.pickFiles();
  if (!paths.length) return;
  for (const p of paths.slice(0, MAX_ATTACH - attachments.length)) {
    const read = await host.readAttachFile(p);
    if (!read || read.error) continue;
    pushAttachment({
      id: uid(),
      kind: 'file',
      label: read.name,
      path: read.path,
      detail: read.path,
      text: read.text,
    });
  }
  setAttachMenuOpen(false);
}

function onMenuClick(e: Event): void {
  const target = e.target as HTMLElement;
  const back = target.closest<HTMLElement>('[data-attach-action="back"], [data-attach-action="back-content"]');
  if (back) {
    const action = back.getAttribute('data-attach-action');
    viewAnimDir = 'back';
    if (action === 'back-content' && view.mode === 'content') {
      view = { mode: 'builds', purpose: 'pick-for-content', contentKind: view.contentKind };
    } else {
      view = { mode: 'root' };
    }
    filterQuery = '';
    renderAttachMenuBody();
    return;
  }

  const buildBtn = target.closest<HTMLElement>('[data-attach-build]');
  if (buildBtn?.dataset.attachBuild) {
    const buildId = buildBtn.dataset.attachBuild;
    const file = buildBtn.dataset.attachFile;
    const kind = buildBtn.dataset.attachKind as AiAttachKind | undefined;
    if (file && kind && view.mode === 'content') {
      const build = host?.getBuilds().find((b) => b.id === buildId);
      const nice = (file.replace(/\.disabled$/i, '').replace(/\.(jar|zip)$/i, '') || file).trim();
      pushAttachment({
        id: uid(),
        kind,
        label: nice,
        filename: file,
        buildId,
        detail: build?.name,
      });
      setAttachMenuOpen(false);
      return;
    }
    if (view.mode === 'builds') {
      if (view.purpose === 'attach') {
        const b = host?.getBuilds().find((x) => x.id === buildId);
        if (b) {
          pushAttachment({
            id: uid(),
            kind: 'build',
            label: b.name,
            buildId: b.id,
            detail: [b.gameVersion, b.loader].filter(Boolean).join(' · '),
            iconSrc: b.iconSrc,
            iconBg: b.iconBg,
          });
        }
        setAttachMenuOpen(false);
      } else {
        viewAnimDir = 'forward';
        void openContentPicker(buildId, view.contentKind);
      }
    }
    return;
  }

  const actionBtn = target.closest<HTMLElement>('[data-attach-action]');
  const action = actionBtn?.dataset.attachAction;
  if (!action || !host) return;

  if (action === 'web' || action === 'commands' || action === 'diagnose') {
    toggleCapability(action);
    const on = hasCapability(action);
    actionBtn.classList.toggle('is-active', on);
    actionBtn.querySelector('.ai-attach-menu__check')?.classList.toggle('is-on', on);
    const foot = document.querySelector('.ai-attach-menu__foot');
    if (foot) foot.textContent = t('ai.attach.foot', { n: String(attachments.length), max: String(MAX_ATTACH) });
    return;
  }
  if (action === 'build') {
    viewAnimDir = 'forward';
    view = { mode: 'builds', purpose: 'attach', contentKind: 'build' };
    filterQuery = '';
    renderAttachMenuBody();
    return;
  }
  if (action === 'mod' || action === 'resourcepack' || action === 'shader' || action === 'datapack') {
    viewAnimDir = 'forward';
    const sid = host.getSessionBuildId();
    if (sid) void openContentPicker(sid, action);
    else {
      view = { mode: 'builds', purpose: 'pick-for-content', contentKind: action };
      filterQuery = '';
      renderAttachMenuBody();
    }
    return;
  }
  if (action === 'file') {
    void attachFilesFromDisk();
    return;
  }
  if (action === 'crash') {
    void attachLog('crash');
    return;
  }
  if (action === 'log') {
    void attachLog('log');
  }
}

function onChipsClick(e: Event): void {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('.ai-attach-badge[data-attach-id]');
  if (!btn?.dataset.attachId) return;
  removeAiAttachment(btn.dataset.attachId);
}

export function initAiAttachUi(h: AttachHost): void {
  host = h;
  renderAiAttachChips();
  if (menuBound) return;
  menuBound = true;
  document.getElementById('ai-attach-menu')?.addEventListener('click', (e) => {
    e.stopPropagation();
    onMenuClick(e);
  });
  document.getElementById('ai-attach-chips')?.addEventListener('click', onChipsClick);
  document.getElementById('ai-attach')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = document.getElementById('ai-attach-menu');
    const willOpen = !menu?.classList.contains('is-open');
    if (willOpen) host?.closeOtherPopovers();
    toggleAiAttachMenu();
  });
}
