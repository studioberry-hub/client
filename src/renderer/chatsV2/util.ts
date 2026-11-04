// Утилиты чатов v2: экранирование, URL ассетов мастера, время, markdown-разметка, аватары.

import { marked } from 'marked';

// ===== Строки и HTML =====

/** Метка бота: иконка вместо текстового бейджа «Бот». */
export function botBadge(): string {
  return '<img class="cv2-bot" src="../../assets/newchatV2/Bot.svg" width="16" height="16" alt="" title="Бот" draggable="false">';
}

/** Заливка ползунка: доля значения между min и max, как у дорожки плеера. */
export function syncRange(el: HTMLInputElement): void {
  const min = Number(el.min) || 0;
  const max = Number(el.max) || 100;
  const val = Number(el.value);
  const pct = max === min ? 0 : Math.min(100, Math.max(0, ((val - min) / (max - min)) * 100));
  el.style.setProperty('--cv2-pct', `${pct}%`);
}

export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function initials(name: string): string {
  const parts = String(name || '?').trim().split(/[\s_.-]+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

export function fmtSize(bytes: number | null | undefined): string {
  const b = Number(bytes) || 0;
  if (b < 1024) return `${b} Б`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} КБ`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} МБ`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} ГБ`;
}

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number): (...a: A) => void {
  let t: number | null = null;
  return (...a: A) => {
    if (t != null) window.clearTimeout(t);
    t = window.setTimeout(() => {
      t = null;
      fn(...a);
    }, ms);
  };
}

export function sameId(a: unknown, b: unknown): boolean {
  return a != null && b != null && String(a) === String(b);
}

// ===== URL ассетов мастера =====

let masterBase = '';

export function setMasterBase(url: string | null | undefined): void {
  const v = String(url || '').replace(/\/$/, '');
  if (v) masterBase = v;
}

/** Абсолютный URL для относительных путей мастера (/users/avatars/…, /rooms/files/…). */
export function assetUrl(pathOrUrl: string | null | undefined): string {
  if (!pathOrUrl) return '';
  let raw = String(pathOrUrl).trim();
  if (!raw) return '';
  if (/^(https?:|data:|blob:)/i.test(raw)) return raw;
  // Попавшие из кэша file:// и Windows-пути — берём только имя файла аватара
  if (/^file:/i.test(raw) || /^\/?[A-Za-z]:[\\/]/.test(raw)) {
    const name = raw.replace(/\\/g, '/').split('/').pop() || '';
    return name && masterBase ? `${masterBase}/users/avatars/${name}` : '';
  }
  if (!masterBase) return '';
  if (!raw.includes('/') && /\.(webp|png|jpe?g|gif)(\?|$)/i.test(raw)) return `${masterBase}/users/avatars/${raw}`;
  if (!raw.startsWith('/')) raw = '/' + raw;
  return masterBase + raw;
}

// ===== Время =====

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function parseTime(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  let s = String(iso);
  // SQLite datetime('now') без зоны — это UTC
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(s)) s = s.replace(' ', 'T') + 'Z';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function hm(d: Date): string {
  return `${d.getHours()}:${pad(d.getMinutes())}`;
}

/** Дата в шапке сообщения строго как в референсе: 04.10.2026 5:17. */
export function fmtMsgTime(iso: string | null | undefined): string {
  const d = parseTime(iso);
  if (!d) return '';
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${hm(d)}`;
}

export function fmtFullTime(iso: string | null | undefined): string {
  const d = parseTime(iso);
  if (!d) return '';
  return d.toLocaleString('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function fmtDayDivider(d: Date): string {
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function fmtDate(iso: string | null | undefined): string {
  const d = parseTime(iso);
  if (!d) return '';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ===== Разметка текста сообщений =====

export type MentionResolver = (id: number) => string | null;

const MD_TAGS = new Set(['p', 'br', 'b', 'i', 'u', 'strong', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'a', 'pre', 'code', 'blockquote', 'hr', 'span', 'del', 's']);

/** Тот же принцип, что у постов: marked + белый список тегов. Ссылки только http(s). */
function sanitizeChatHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, (tag) => {
      const name = tag.match(/<\/?(\w+)/)?.[1]?.toLowerCase();
      if (!name || !MD_TAGS.has(name)) return '';
      if (tag.startsWith('</')) return `</${name}>`;
      if (name === 'a') {
        const href = (tag.match(/href\s*=\s*"([^"]*)"/i)?.[1] || '').replace(/&amp;/g, '&');
        if (!/^https?:\/\//i.test(href)) return '';
        return `<a class="cv2-link" data-act="open-url" data-href="${esc(href)}">`;
      }
      if (name === 'pre') return '<pre class="cv2-code-block">';
      if (name === 'code') return '<code class="cv2-code">';
      if (name === 'blockquote') return '<blockquote class="cv2-quote">';
      return `<${name}>`;
    });
}

function mentionize(
  text: string,
  opts: { myName?: string; mention?: MentionResolver; userByName?: (name: string) => number | null; channelAt?: (name: string) => string },
): string {
  return text
    .replace(/&lt;@(\d+)&gt;/g, (_m, id: string) => {
      const name = opts.mention?.(Number(id));
      return `<span class="cv2-mention" data-act="user" data-uid="${id}">@${esc(name || 'пользователь')}</span>`;
    })
    .replace(/(^|\s)@(everyone|here|[A-Za-z0-9_\u0400-\u04FF.-]{2,32})/g, (_m, pre: string, name: string) => {
      const me = Boolean(opts.myName && name.toLowerCase() === opts.myName.toLowerCase());
      const special = name === 'everyone' || name === 'here';
      const uid = special ? null : opts.userByName?.(name);
      const cls = special || me ? 'cv2-mention is-me' : 'cv2-mention';
      if (uid) return `${pre}<span class="${cls}" data-act="user" data-uid="${uid}">@${esc(name)}</span>`;
      return `${pre}<span class="${cls}">@${esc(name)}</span>`;
    })
    .replace(/(^|\s)#([A-Za-z0-9_\u0400-\u04FF.-]{1,60})/g, (full, pre: string, name: string) => {
      const html = opts.channelAt?.(name);
      return html ? `${pre}${html}` : full;
    });
}

/** Заголовки, жирный, списки и ссылки — через marked, как в ленте постов. */
export function formatText(
  raw: string,
  opts: { myName?: string; mention?: MentionResolver; userByName?: (name: string) => number | null; channelAt?: (name: string) => string } = {},
): string {
  const text = String(raw ?? '');
  let html = '';
  try {
    html = marked.parse(text, { async: false, breaks: true, gfm: true }) as string;
  } catch {
    html = esc(text).replace(/\n/g, '<br>');
  }
  html = sanitizeChatHtml(html);
  html = html.replace(/>([^<]*)</g, (_m, chunk: string) => `>${mentionize(chunk, opts)}<`);
  return html;
}

const EMOJI_ONLY_RE = /^(?:\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic}|\p{Emoji_Modifier})*\s*){1,27}$/u;

export function isEmojiOnly(text: string): boolean {
  const t = String(text || '').trim();
  return t.length > 0 && t.length <= 60 && EMOJI_ONLY_RE.test(t);
}

export function plainPreview(text: string | null | undefined, max = 80): string {
  const t = String(text || '')
    .replace(/```[\s\S]*?```/g, '[код]')
    .replace(/<@(\d+)>/g, '@упоминание')
    .replace(/[*_~|`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

// ===== Аватары =====

export type AvatarOpts = {
  size?: number;
  status?: 'online' | 'offline' | 'none';
  /** Цвет обводки точки статуса — фон под аватаром */
  ring?: string;
  game?: string | null;
  gameIcon?: string | null;
  speaking?: boolean;
  cls?: string;
  /** Инициалы в заглушке (серверы); у людей заглушка — пустой серый круг, как в референсе */
  letters?: boolean;
};

export function avatarHtml(name: string, url: string | null | undefined, color: string | null | undefined, o: AvatarOpts = {}): string {
  const size = o.size ?? 32;
  const src = assetUrl(url);
  // Без своего цвета тон заглушки берётся из контекста (--cv2-ava-fb): сайдбар, лента, карточки различаются
  const bg = color ? `;--ava-bg:${esc(color)}` : '';
  const inner = src
    ? `<img src="${esc(src)}" alt="" draggable="false" loading="lazy" onerror="this.remove()">`
    : '';
  const letters = o.letters ? `<span class="cv2-ava__txt" style="font-size:${Math.round(size * 0.38)}px">${esc(initials(name))}</span>` : '';
  const dot =
    o.status && o.status !== 'none'
      ? `<span class="cv2-ava__dot is-${o.status}" style="--ring:${o.ring || 'var(--cv2-bg-side)'}"></span>`
      : '';
  const game = o.gameIcon
    ? `<span class="cv2-ava__game" style="--ring:${o.ring || 'var(--cv2-bg-side)'}"><img src="${esc(o.gameIcon)}" alt="" onerror="this.parentElement.remove()"></span>`
    : '';
  return `<span class="cv2-ava ${o.speaking ? 'is-speaking' : ''} ${o.cls || ''}" style="--s:${size}px${bg}">${letters}${inner}${dot}${game}</span>`;
}

/** Цвет иконки группы по id (как в референсе: бирюзовый, фиолетовый и т.д.). */
const GROUP_COLORS = ['#438A9A', '#AC2AB8', '#D46A3D', '#3D7FD4', '#3DAA6E', '#C2445A', '#8A6BD4'];

export function groupColor(id: number): string {
  return GROUP_COLORS[Math.abs(Number(id) || 0) % GROUP_COLORS.length]!;
}

export function isImageName(name: string | null | undefined): boolean {
  return /\.(png|jpe?g|gif|webp|bmp|avif)(\?|$)/i.test(String(name || ''));
}

export function isVideoName(name: string | null | undefined): boolean {
  return /\.(mp4|webm|mov)(\?|$)/i.test(String(name || ''));
}

export function isAudioName(name: string | null | undefined): boolean {
  return /\.(mp3|ogg|wav|m4a|opus|weba)(\?|$)/i.test(String(name || ''));
}

export function copyText(text: string): void {
  const value = String(text || '');
  if (!value) return;
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
    } catch {
      /* буфер недоступен */
    }
    ta.remove();
  };
  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(value).catch(() => fallback());
    return;
  }
  fallback();
}
