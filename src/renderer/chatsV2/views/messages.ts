// Лента сообщений: группировка, разделители дат и «Новые», ответы, вложения, реакции, hover-тулбар.
import { IC, IMG, channelMentionMark } from '../icons';
import { S, allTextChannels, allVoiceChannels, conv, userOf } from '../store';
import { cardAddress, worldCardState } from '../worlds';
import {
  assetUrl,
  avatarHtml,
  botBadge,
  esc,
  fmtDayDivider,
  fmtFullTime,
  fmtMsgTime,
  fmtSize,
  formatText,
  hm,
  isAudioName,
  isEmojiOnly,
  isImageName,
  isVideoName,
  parseTime,
  sameDay,
  sameId,
} from '../util';
import type { ConvKey, Message } from '../types';
import { voiceMessageHtml } from '../voicePlayer';

export type FeedCtx = {
  key: ConvKey;
  kind: 'dm' | 'group' | 'channel';
  roomId: number | null;
  /** Можно закреплять/удалять чужие (модератор канала или владелец группы) */
  moderator: boolean;
  /** Новости/правила — писать могут только админы, остальным только чтение */
  readOnly: boolean;
  noFiles?: boolean;
  noReact?: boolean;
  noVoice?: boolean;
  title: string;
  peerId?: number;
};

const GROUP_WINDOW_MS = 7 * 60 * 1000;

/** Цвет подсветки ника: на сервере и в группе — старшая роль, в личке — цвет профиля. */
function nameHoverColor(ctx: FeedCtx, senderId: number | null | undefined, profileColor: string | null | undefined): string {
  const profile = hexColor(profileColor);
  if ((ctx.kind === 'channel' || ctx.kind === 'group') && ctx.roomId && senderId) {
    const member = (S.members.get(ctx.roomId) || []).find((m) => sameId(m.user_id, senderId));
    const roles = (S.details.get(ctx.roomId)?.roles || [])
      .filter((r) => member?.role_ids?.includes(r.id))
      .sort((a, b) => (b.position || 0) - (a.position || 0));
    const role = hexColor(roles[0]?.color);
    if (role && role.toLowerCase() !== '#000000') return role;
  }
  return profile;
}

function hexColor(raw: string | null | undefined): string {
  const c = String(raw || '').trim();
  return /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : '';
}

function isMine(m: Message): boolean {
  return sameId(m.sender_id, S.me.id);
}

function mentionsMe(m: Message): boolean {
  if (isMine(m) || S.me.id == null) return false;
  if (m.mentioned_user_ids?.includes(S.me.id)) return true;
  const t = m.text || '';
  if (/@(everyone|here)\b/i.test(t)) return true;
  if (new RegExp(`<@${S.me.id}>`).test(t)) return true;
  const name = S.me.username;
  return Boolean(name) && new RegExp(`(^|\\s)@${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\b|$)`, 'i').test(t);
}

function startsGroup(m: Message, prev: Message | undefined): boolean {
  if (!prev || prev.is_system || m.is_system) return true;
  if (!sameId(prev.sender_id, m.sender_id) || prev.as_channel_post !== m.as_channel_post) return true;
  if (m.reply_to_id) return true;
  const a = parseTime(prev.created_at);
  const b = parseTime(m.created_at);
  if (!a || !b || !sameDay(a, b)) return true;
  return b.getTime() - a.getTime() > GROUP_WINDOW_MS;
}

function channelPing(roomId: number | null, name: string): string {
  if (!roomId) return '';
  const d = S.details.get(roomId);
  const q = name.toLowerCase();
  const text = allTextChannels(d).find((c) => c.name.toLowerCase() === q);
  if (text) {
    return `<span class="cv2-mention" data-act="open-channel" data-room="${roomId}" data-ch="${text.id}">${channelMentionMark(text.channel_kind, 14)}#${esc(text.name)}</span>`;
  }
  const voice = allVoiceChannels(d).find((c) => c.name.toLowerCase() === q);
  if (voice) {
    return `<span class="cv2-mention" data-act="open-voice-room" data-room="${roomId}" data-vc="${voice.id}">${channelMentionMark('voice', 14)}#${esc(voice.name)}</span>`;
  }
  return '';
}

function mentionName(id: number): string | null {
  return userOf(id).username || null;
}

function userIdByName(name: string): number | null {
  const n = name.toLowerCase();
  if (S.me.username && S.me.username.toLowerCase() === n && S.me.id) return S.me.id;
  for (const list of [S.friends.friends, S.friends.incoming, S.friends.outgoing]) {
    for (const user of list) {
      if (String(user.username || '').toLowerCase() === n && user.id) return user.id;
    }
  }
  for (const members of S.members.values()) {
    for (const member of members) {
      if (String(member.username || '').toLowerCase() === n && member.user_id) return member.user_id;
    }
  }
  return null;
}

// ===== Вложения =====

function isVoiceNote(name: string): boolean {
  return /^voice[_-]/i.test(name);
}

export function stickerToken(text: string | null | undefined): string | null {
  const m = /^\[\[sticker:(\d+)\]\]$/.exec(String(text || '').trim());
  return m ? m[1] : null;
}

function isGifAttachment(m: Message, name: string): boolean {
  return /^image\/gif$/i.test(m.attachment_mime || '') || /\.gif(\?|$)/i.test(name);
}

function attachmentHtml(m: Message): string {
  const shown = m.attachment_preview || m.attachment_url;
  if (!shown) return '';
  const url = assetUrl(shown);
  const name = m.attachment_name || 'файл';
  const mime = m.attachment_mime || '';
  if (isVoiceNote(name)) {
    return voiceMessageHtml(url, null);
  }
  // GIF не леним и не крутим через transform: в Chromium от этого остаётся первый кадр.
  if (isGifAttachment(m, name) || /^image\//i.test(mime) || isImageName(name) || isImageName(m.attachment_url)) {
    const gif = isGifAttachment(m, name);
    return `<div class="cv2-att is-img${gif ? ' is-gif' : ''}"><img src="${esc(url)}" alt="" loading="${gif ? 'eager' : 'lazy'}" data-act="lightbox" data-src="${esc(url)}" data-name="${esc(name)}" onerror="this.closest('.cv2-att').classList.add('is-broken')"></div>`;
  }
  if (isVideoName(name)) {
    return `<button type="button" class="cv2-att is-video" data-act="video" data-src="${esc(url)}" data-name="${esc(name)}"><video src="${esc(url)}" preload="metadata" muted playsinline></video><span class="cv2-att__play" aria-hidden="true"></span></button>`;
  }
  if (isAudioName(name)) {
    return `<div class="cv2-att is-file"><span class="cv2-att__ico">${IC.file(26)}</span><span class="cv2-att__meta"><span class="cv2-att__name">${esc(name)}</span><audio src="${esc(url)}" controls preload="none"></audio></span></div>`;
  }
  return `<div class="cv2-att is-file">
    <span class="cv2-att__ico">${IC.file(28)}</span>
    <span class="cv2-att__meta"><a class="cv2-att__name" data-href="${esc(url)}" href="${esc(url)}">${esc(name)}</a><span class="cv2-att__size">${esc(fmtSize(m.attachment_size))}</span></span>
    <button type="button" class="cv2-ibtn is-sm" data-act="download" data-href="${esc(url)}" data-tip="Скачать">${IC.download(16)}</button>
  </div>`;
}

function reactionsHtml(m: Message): string {
  const list = (m.reactions || []).filter((r) => r.count > 0);
  if (!list.length) return '';
  return `<div class="cv2-reacts">${list
    .map(
      (r) =>
        `<button type="button" class="cv2-react ${r.me ? 'is-me' : ''}" data-act="react" data-emoji="${esc(r.emoji)}" data-mid="${esc(m.id)}"><span class="cv2-react__e">${esc(
          r.emoji,
        )}</span><span class="cv2-react__n">${r.count}</span></button>`,
    )
    .join('')}<button type="button" class="cv2-react is-add" data-act="react-pick" data-mid="${esc(m.id)}" data-tip="Добавить реакцию">${IMG.emoji(14)}</button></div>`;
}

// ===== Тулбар при наведении (как в референсе: ❤ | ✎ 📌 ☺ ↩ ↪ …) =====

function toolbar(m: Message, ctx: FeedCtx): string {
  if (m.pending || m.is_system) return '';
  const mine = isMine(m);
  const canPin = ctx.kind !== 'channel' || ctx.moderator;
  return `<div class="cv2-tools" role="toolbar">
    ${ctx.noReact ? '' : `<button type="button" class="cv2-tool is-heart" data-act="react" data-emoji="❤️" data-mid="${esc(m.id)}" data-tip="Нравится">${IC.heart(16)}</button>`}
    <span class="cv2-tools__sep"></span>
    ${mine ? `<button type="button" class="cv2-tool" data-act="msg-edit" data-mid="${esc(m.id)}" data-tip="Изменить">${IMG.edit(16)}</button>` : ''}
    ${canPin ? `<button type="button" class="cv2-tool" data-act="msg-pin" data-mid="${esc(m.id)}" data-tip="${m.is_pinned ? 'Открепить' : 'Закрепить'}">${IMG.pin(16)}</button>` : ''}
    ${ctx.noReact ? '' : `<button type="button" class="cv2-tool" data-act="react-pick" data-mid="${esc(m.id)}" data-tip="Реакция">${IMG.emoji(16)}</button>`}
    ${ctx.readOnly ? '' : `<button type="button" class="cv2-tool" data-act="msg-reply" data-mid="${esc(m.id)}" data-tip="Ответить">${IMG.reply(16)}</button>`}
    <button type="button" class="cv2-tool" data-act="msg-forward" data-mid="${esc(m.id)}" data-tip="Переслать">${IMG.forward(16)}</button>
    <button type="button" class="cv2-tool" data-act="msg-more" data-mid="${esc(m.id)}" data-tip="Ещё">${IMG.more(16)}</button>
  </div>`;
}

function replyHtml(m: Message): string {
  const r = m.reply_to;
  if (!r && !m.reply_to_id) return '';
  if (!r) return `<div class="cv2-reply is-missing"><span class="cv2-reply__spine"></span><span class="cv2-reply__text">Исходное сообщение удалено</span></div>`;
  const u = r.sender_id ? userOf(r.sender_id) : { username: r.sender_username || '?', avatar_url: r.sender_avatar_url, avatar_color: r.sender_avatar_color };
  const name = r.sender_username || u.username;
  const quote = stickerToken(r.text) ? 'Стикер' : String(r.text || '').replace(/\s+/g, ' ').slice(0, 140);
  // Как в референсе: время ответа стоит в строке цитаты, а не рядом с именем
  return `<div class="cv2-reply" data-act="jump" data-mid="${esc(r.id)}">
    <span class="cv2-reply__spine"></span>
    ${avatarHtml(name, r.sender_avatar_url || u.avatar_url, r.sender_avatar_color || u.avatar_color, { size: 16 })}
    <span class="cv2-reply__name">${esc(name)}</span>
    <span class="cv2-reply__text">${esc(quote) || '<i>Вложение</i>'}</span>
    <span class="cv2-msg__time" data-tip="${esc(fmtFullTime(m.created_at))}">${esc(fmtMsgTime(m.created_at))}</span>
  </div>`;
}

function cardBits(text: string): { clean: string; postId: string; modId: string; modName: string; server: string; serverName: string; buildId: string; buildName: string; world: string } {
  const postId = text.match(/#post:([\w-]+)/)?.[1] || '';
  const modRaw = text.match(/#ucard:mod:([A-Za-z0-9_-]+)(?::(\S+))?/);
  const serverRaw = text.match(/#ucard:server:([^:\s]+)(?::(\S+))?/);
  const buildRaw = text.match(/#ucard:build:([A-Za-z0-9_-]+)(?::(\S+))?/);
  const worldRaw = text.match(/#ucard:world:(\S+)/)?.[1] || '';
  const decode = (raw: string) => {
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  };
  const server = decode(serverRaw?.[1] || '');
  const serverName = decode(serverRaw?.[2] || '') || server;
  const modName = decode(modRaw?.[2] || '');
  const buildName = decode(buildRaw?.[2] || '');
  const clean = text
    .replace(/#post:[\w-]+/g, '')
    .replace(/#ucard:mod:\S+/g, '')
    .replace(/#ucard:server:\S+/g, '')
    .replace(/#ucard:build:\S+/g, '')
    .replace(/#ucard:world:\S+/g, '')
    .trim();
  return { clean, postId, modId: modRaw?.[1] || '', modName, server, serverName, buildId: buildRaw?.[1] || '', buildName, world: worldRaw };
}

function embedCard(kicker: string, title: string, desc: string, id: string): string {
  return `<button type="button" class="cv2-embed" data-act="open-share" data-id="${esc(id)}"><span class="cv2-embed__bar"></span><span class="cv2-embed__main"><span class="cv2-embed__kicker">${esc(kicker)}</span><span class="cv2-embed__title">${esc(title)}</span>${desc ? `<span class="cv2-embed__desc">${esc(desc)}</span>` : ''}</span></button>`;
}

function worldCard(m: Message, token = ''): string {
  let meta = (m.meta || {}) as Record<string, unknown>;
  if (token) {
    try {
      const parsed = JSON.parse(decodeURIComponent(token));
      if (parsed && typeof parsed === 'object') meta = parsed as Record<string, unknown>;
    } catch {
      return '';
    }
  }
  if (meta.mode !== 'relay' && meta.mode !== 'direct') return '';
  const addr = cardAddress(meta);
  const state = worldCardState(m.sender_id, meta);
  const stale = state === 'stale';
  const title = stale ? 'Устаревший адрес мира' : String(meta.serverName || meta.buildName || 'Мир по сети');
  const desc = stale
    ? 'Запросите друга повторно открыть мир по сети'
    : [meta.buildName && meta.serverName ? String(meta.buildName) : '', addr].filter(Boolean).join(' · ');
  const packed = token ? esc(token) : '';
  const join = stale
    ? `<button type="button" class="cv2-btn is-primary is-sm" disabled>Войти</button>`
    : token
      ? `<button type="button" class="cv2-btn is-primary is-sm" data-act="world-token-join" data-token="${packed}">Войти</button>`
      : `<button type="button" class="cv2-btn is-primary is-sm" data-act="invite-join" data-mid="${esc(m.id)}">Войти</button>`;
  const copy = addr
    ? stale
      ? `<button type="button" class="cv2-btn is-sm" disabled>Копировать адрес</button>`
      : `<button type="button" class="cv2-btn is-sm" data-act="invite-copy" data-href="${esc(addr)}">Копировать адрес</button>`
    : '';
  return `<div class="cv2-embed is-world${stale ? ' is-stale' : ''}"><span class="cv2-embed__bar"></span><span class="cv2-embed__main"><span class="cv2-embed__kicker">Мир по сети</span><span class="cv2-embed__title">${esc(title)}</span>${desc ? `<span class="cv2-embed__desc">${esc(desc)}</span>` : ''}<span class="cv2-embed__actions">${join}${copy}</span></span></div>`;
}

function editBox(m: Message): string {
  return `<div class="cv2-edit">
    <textarea class="cv2-edit__input" data-input="edit" rows="1">${esc(m.text)}</textarea>
    <div class="cv2-edit__hint">Escape — <a data-act="edit-cancel">отмена</a> • Enter — <a data-act="edit-save">сохранить</a></div>
  </div>`;
}

export function msgHtml(m: Message, prev: Message | undefined, ctx: FeedCtx, fresh = false): string {
  if (m.is_system) {
    return `<div class="cv2-msg is-system ${fresh ? 'is-new' : ''}" data-mid="${esc(m.id)}">
      <span class="cv2-msg__sysico">${IC.chevronRight(14)}</span>
      <span class="cv2-msg__systext">${formatText(m.text)}</span>
      <span class="cv2-msg__time" data-tip="${esc(fmtFullTime(m.created_at))}">${esc(fmtMsgTime(m.created_at))}</span>
    </div>`;
  }
  const head = startsGroup(m, prev);
  const editing = S.ui.editing && S.ui.editing.key === ctx.key && sameId(S.ui.editing.id, m.id);
  const u = m.sender_id ? userOf(m.sender_id) : null;
  const name = m.as_channel_post ? m.sender_username : u?.username || m.sender_username;
  const avaUrl = m.as_channel_post ? m.sender_avatar_url : u?.avatar_url || m.sender_avatar_url;
  const avaColor = m.as_channel_post ? m.sender_avatar_color : u?.avatar_color || m.sender_avatar_color;
  const nameTint = nameHoverColor(ctx, m.sender_id, avaColor);
  const cards = cardBits(m.text || '');
  const world = m.kind === 'game_invite' ? worldCard(m) : cards.world ? worldCard(m, cards.world) : '';
  const shares = [
    world,
    cards.postId ? embedCard('Пост', 'Запись', cards.clean.slice(0, 160), `post:${cards.postId}`) : '',
    cards.modId ? embedCard('Мод', cards.modName || 'Карточка мода', 'Открыть в каталоге', `mod:${cards.modId}`) : '',
    cards.server ? embedCard('Сервер', cards.serverName || cards.server, cards.server, `server:${cards.server}`) : '',
    cards.buildId ? embedCard('Сборка', cards.buildName || 'Сборка', 'Открыть в лаунчере', `build:${cards.buildId}`) : '',
  ].join('');
  const stickerId = stickerToken(m.text);
  const visible = cards.clean && !(m.attachment_url && m.text === m.attachment_name) && !world;
  const body = editing
    ? editBox(m)
    : stickerId
      ? `<div class="cv2-sticker" data-sticker="${esc(stickerId)}"></div>`
      : `${shares}${
          visible
            ? `<div class="cv2-msg__text ${isEmojiOnly(cards.clean) ? 'is-jumbo' : ''}">${formatText(cards.clean, { myName: S.me.username, mention: mentionName, userByName: userIdByName, channelAt: (name) => channelPing(ctx.roomId, name) })}${
                m.edited_at ? '<span class="cv2-msg__edited" data-tip="Изменено">(изменено)</span>' : ''
              }</div>`
            : ''
        }`;
  const d = parseTime(m.created_at);
  const cls = [
    'cv2-msg',
    head ? 'is-head' : 'is-cont',
    mentionsMe(m) ? 'is-mention' : '',
    m.pending ? 'is-pending' : '',
    m.failed ? 'is-failed' : '',
    editing ? 'is-editing' : '',
    m.is_pinned ? 'is-pinned' : '',
    fresh ? 'is-new' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return `<div class="${cls}" data-mid="${esc(m.id)}" data-ctx="msg">
    ${head ? replyHtml(m) : ''}
    <div class="cv2-msg__row">
      <div class="cv2-msg__gutter">${
        head
          ? `<button type="button" class="cv2-msg__ava" data-act="user" data-uid="${m.sender_id ?? ''}">${avatarHtml(name, avaUrl, avaColor, { size: 40 })}</button>`
          : `<span class="cv2-msg__hm" data-tip="${esc(fmtFullTime(m.created_at))}">${d ? hm(d) : ''}</span>`
      }</div>
      <div class="cv2-msg__main">
        ${
          head
            ? `<div class="cv2-msg__head"><button type="button" class="cv2-msg__name" data-act="user" data-uid="${m.sender_id ?? ''}"${nameTint ? ` style="--name-tint:${esc(nameTint)}"` : ''}>${esc(name)}</button>${
                userOf(m.sender_id).bot ? botBadge() : ''
              }${
                m.as_channel_post ? '<span class="cv2-tag">КАНАЛ</span>' : ''
              }${m.reply_to ? '' : `<span class="cv2-msg__time" data-tip="${esc(fmtFullTime(m.created_at))}">${esc(fmtMsgTime(m.created_at))}</span>`}${
                m.is_pinned ? `<span class="cv2-msg__pin" data-tip="Закреплено">${IC.pin(12)}</span>` : ''
              }</div>`
            : ''
        }
        ${body}
        ${attachmentHtml(m)}
        ${m.failed ? `<div class="cv2-msg__fail">Не отправлено. <a data-act="msg-retry" data-mid="${esc(m.id)}">Повторить</a> · <a data-act="msg-discard" data-mid="${esc(m.id)}">Удалить</a></div>` : ''}
        ${reactionsHtml(m)}
      </div>
    </div>
    ${editing ? '' : toolbar(m, ctx)}
  </div>`;
}

function dayDivider(d: Date): string {
  return `<div class="cv2-divider"><span>${esc(fmtDayDivider(d))}</span></div>`;
}

/** Полная лента беседы (при открытии/догрузке истории). */
export function renderFeed(ctx: FeedCtx): string {
  const c = conv(ctx.key);
  if (!c.loaded && !c.list.length) {
    return `<div class="cv2-feed__skel">${Array.from({ length: 7 }, (_, i) => `<div class="cv2-skel__msg" style="--w:${40 + ((i * 37) % 50)}%"></div>`).join('')}</div>`;
  }
  // В референсе лента без приветственного блока: начало истории — просто пустое место сверху
  const out: string[] = [];
  if (c.hasMore) out.push('<div class="cv2-feed__more" data-feed-more><span class="cv2-spinner"></span></div>');
  let prev: Message | undefined;
  for (const m of c.list) {
    const d = parseTime(m.created_at);
    const pd = prev ? parseTime(prev.created_at) : null;
    let p = prev;
    // Над первым сообщением разделителя нет (как в референсе) — только на смене дня
    if (d && pd && !sameDay(d, pd)) {
      out.push(dayDivider(d));
      p = undefined;
    }
    if (c.unreadFrom != null && sameId(m.id, c.unreadFrom)) {
      out.push('<div class="cv2-divider is-new"><span>Новые</span></div>');
      p = undefined;
    }
    out.push(msgHtml(m, p, ctx));
    prev = m;
  }
  for (const up of S.uploads.values()) {
    if (up.key !== ctx.key) continue;
    out.push(`<div class="cv2-upload">
      <span class="cv2-att__ico">${IC.file(28)}</span>
      <span class="cv2-upload__meta"><span class="cv2-att__name">${esc(/^voice[_-]/i.test(up.name) ? 'Голосовое сообщение' : up.name)}</span><span class="cv2-upload__bar"><i></i></span></span>
      <span class="cv2-att__size">${esc(fmtSize(up.size))}</span>
    </div>`);
  }
  return out.join('');
}

/** HTML одного нового сообщения в конец ленты (с разделителем дня при смене даты). */
export function appendHtml(ctx: FeedCtx, m: Message, prev: Message | undefined): string {
  const d = parseTime(m.created_at);
  const pd = prev ? parseTime(prev.created_at) : null;
  if (d && pd && !sameDay(d, pd)) return dayDivider(d) + msgHtml(m, undefined, ctx, true);
  return msgHtml(m, prev, ctx, true);
}

const tintCache = new Map<string, string>();

/** Средний цвет эмодзи с холста — стекло реакции красится в него. */
export function emojiTint(emoji: string): string {
  const hit = tintCache.get(emoji);
  if (hit) return hit;
  let hex = '#9aa0a6';
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx) {
      ctx.font = '24px "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(emoji, 4, 18);
      const data = ctx.getImageData(0, 0, 32, 32).data;
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3] ?? 0;
        if (a < 48) continue;
        r += data[i] ?? 0;
        g += data[i + 1] ?? 0;
        b += data[i + 2] ?? 0;
        n += 1;
      }
      if (n > 8) {
        const h = (v: number) => Math.round(v / n).toString(16).padStart(2, '0');
        hex = `#${h(r)}${h(g)}${h(b)}`;
      }
    }
  } catch {
    /* холст недоступен — остаётся нейтральный тон */
  }
  tintCache.set(emoji, hex);
  return hex;
}

export function tintReactions(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('.cv2-react[data-emoji]').forEach((btn) => {
    const emoji = btn.dataset.emoji || '';
    if (!emoji) return;
    btn.style.setProperty('--react-tint', emojiTint(emoji));
  });
}

export function typingHtml(key: ConvKey): string {
  const map = S.typing.get(key);
  const now = Date.now();
  const names = map ? [...map.entries()].filter(([, until]) => until > now).map(([uid]) => userOf(uid).username) : [];
  if (!names.length) return '';
  const text =
    names.length === 1
      ? `<b>${esc(names[0])}</b> печатает…`
      : names.length === 2
        ? `<b>${esc(names[0])}</b> и <b>${esc(names[1])}</b> печатают…`
        : 'Несколько человек печатают…';
  return `<span class="cv2-typing__dots"><i></i><i></i><i></i></span><span>${text}</span>`;
}
