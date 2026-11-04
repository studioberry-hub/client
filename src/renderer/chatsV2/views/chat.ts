// Экран беседы: шапка (ЛС/группа/канал), лента, композер и управление прокруткой/патчами ленты.
import { IC, IMG, channelMark, composerIcon } from '../icons';
import { bindVoicePlayers } from '../voicePlayer';
import { destroyStickers, mountStickers } from '../stickers';
import {
  S,
  allTextChannels,
  allVoiceChannels,
  channelAllows,
  conv,
  groupVoiceId,
  isOnline,
  isRoomOwner,
  membersShown,
  profileShown,
  roomById,
  userOf,
} from '../store';
import { C, V } from '../rtc';
import { botBadge, esc, sameId } from '../util';
import { groupIcon, statusLine, userAvatar } from './sidebar';
import { appendHtml, msgHtml, renderFeed, tintReactions, typingHtml, type FeedCtx } from './messages';
import type { ConvKey, Message, TextChannel } from '../types';

// ===== Контекст беседы =====

export function feedCtx(): FeedCtx | null {
  const v = S.view;
  if (v.kind === 'dm') {
    return { key: `dm:${v.peerId}`, kind: 'dm', roomId: null, moderator: true, readOnly: false, title: userOf(v.peerId).username, peerId: v.peerId };
  }
  if (v.kind === 'group') {
    const d = S.details.get(v.roomId);
    const ch = d?.default_channel_id ?? d?.text_channels?.[0]?.id;
    if (!ch) return null;
    return { key: `ch:${ch}`, kind: 'group', roomId: v.roomId, moderator: isRoomOwner(v.roomId), readOnly: false, title: roomById(v.roomId)?.name || 'Группа' };
  }
  if (v.kind === 'server' && v.channelId && !v.voiceId) {
    const ch = allTextChannels(S.details.get(v.roomId)).find((c) => c.id === v.channelId);
    return {
      key: `ch:${v.channelId}`,
      kind: 'channel',
      roomId: v.roomId,
      moderator: Boolean(ch && channelAllows(v.roomId, ch, 'manage_messages')),
      readOnly: !ch || !channelAllows(v.roomId, ch, 'send_messages'),
      noFiles: !ch || !channelAllows(v.roomId, ch, 'attach_files'),
      noReact: !ch || !channelAllows(v.roomId, ch, 'add_reactions'),
      noVoice: !ch || !channelAllows(v.roomId, ch, 'send_voice_messages'),
      title: ch?.name || 'канал',
    };
  }
  return null;
}

export function activeChannel(): TextChannel | undefined {
  const v = S.view;
  if (v.kind !== 'server' || !v.channelId) return undefined;
  return allTextChannels(S.details.get(v.roomId)).find((c) => c.id === v.channelId);
}

// ===== Шапки =====

function headSearch(): string {
  return `<label class="cv2-hsearch">
    ${IC.search(16)}
    <input type="search" data-input="chat-search" placeholder="Поиск в чате" value="${esc(S.ui.asidePanel?.kind === 'search' ? S.ui.asidePanel.query : '')}" autocomplete="off">
  </label>`;
}

function pinsBtn(): string {
  const on = S.ui.asidePanel?.kind === 'pins';
  return `<button type="button" class="cv2-ibtn ${on ? 'is-on' : ''}" data-act="toggle-pins" data-tip="Закреплённые сообщения" data-tip-side="bottom">${IMG.pin(16)}</button>`;
}

export function renderDmHead(peerId: number): string {
  const u = userOf(peerId);
  const inCall = C.phase && sameId(C.peerId, peerId);
  const profileOn = profileShown() && !S.ui.asidePanel;
  return `<div class="cv2-head__title">
      <button type="button" class="cv2-head__user" data-act="user" data-uid="${peerId}">
        ${userAvatar(peerId, 32, 'var(--cv2-bg-main)', false)}
        <span class="cv2-head__who"><span class="cv2-head__uname">${esc(u.username)}${u.bot ? botBadge() : ''}</span><span class="cv2-head__status">${esc(statusLine(peerId))}</span></span>
      </button>
    </div>
    <div class="cv2-head__tools">
      <button type="button" class="cv2-ibtn ${inCall ? 'is-live' : ''}" data-act="${inCall ? 'call-hangup' : 'call-start'}" data-peer="${peerId}" data-tip="${inCall ? 'Завершить звонок' : 'Начать голосовой звонок'}" data-tip-side="bottom">${inCall ? IC.phoneOff(16) : IMG.call(16)}</button>
      ${pinsBtn()}
      <button type="button" class="cv2-ibtn" data-act="create-group" data-peer="${peerId}" data-tip="Добавить друзей в беседу" data-tip-side="bottom">${IMG.addUser(16)}</button>
      <button type="button" class="cv2-ibtn is-toggle ${profileOn ? 'is-on' : ''}" data-act="toggle-profile" data-tip="${profileOn ? 'Скрыть профиль' : 'Показать профиль'}" data-tip-side="bottom">${IMG.people(16)}</button>
      ${headSearch()}
    </div>`;
}

export function renderGroupHead(roomId: number): string {
  const g = roomById(roomId);
  const total = g?.members_total || g?.members?.length || 0;
  const vc = groupVoiceId(roomId);
  const inVoice = vc != null && sameId(V.channelId, vc);
  const membersOn = membersShown() && !S.ui.asidePanel;
  return `<div class="cv2-head__title">
      ${g ? groupIcon(g, 32) : ''}
      <span class="cv2-head__who">
        <button type="button" class="cv2-head__uname is-editable" data-act="group-rename" data-room="${roomId}" data-tip="Изменить название" data-tip-side="bottom">${esc(g?.name || 'Группа')}</button>
        <span class="cv2-head__status">${total} участник${total % 10 === 1 && total % 100 !== 11 ? '' : total % 10 >= 2 && total % 10 <= 4 && (total % 100 < 10 || total % 100 >= 20) ? 'а' : 'ов'}</span>
      </span>
    </div>
    <div class="cv2-head__tools">
      <button type="button" class="cv2-ibtn ${inVoice ? 'is-live' : ''}" data-act="${inVoice ? 'vc-leave' : 'group-call'}" data-room="${roomId}" data-tip="${inVoice ? 'Покинуть звонок' : 'Начать групповой звонок'}" data-tip-side="bottom">${inVoice ? IC.phoneOff(16) : IMG.call(16)}</button>
      ${pinsBtn()}
      <button type="button" class="cv2-ibtn" data-act="group-add" data-room="${roomId}" data-tip="Добавить друзей" data-tip-side="bottom">${IMG.addUser(16)}</button>
      <button type="button" class="cv2-ibtn is-toggle ${membersOn ? 'is-on' : ''}" data-act="toggle-members" data-tip="Список участников" data-tip-side="bottom">${IMG.people(16)}</button>
      ${headSearch()}
    </div>`;
}

export function renderChannelHead(roomId: number, channelId: number): string {
  const ch = allTextChannels(S.details.get(roomId)).find((c) => c.id === channelId);
  const membersOn = membersShown() && !S.ui.asidePanel;
  const ico = channelMark(ch?.channel_kind, 18);
  return `<div class="cv2-head__title">
      <span class="cv2-head__ico is-ch">${ico}</span>
      <span class="cv2-head__name">${esc(ch?.name || 'канал')}</span>
      ${ch?.topic ? `<span class="cv2-head__divider"></span><span class="cv2-head__topic" data-tip="${esc(ch.topic)}" data-tip-side="bottom">${esc(ch.topic)}</span>` : ''}
    </div>
    <div class="cv2-head__tools">
      ${pinsBtn()}
      <button type="button" class="cv2-ibtn is-toggle ${membersOn ? 'is-on' : ''}" data-act="toggle-members" data-tip="Список участников" data-tip-side="bottom">${IMG.people(16)}</button>
      ${headSearch()}
    </div>`;
}

export function renderVoiceHead(roomId: number, vcId: number): string {
  const ch = allVoiceChannels(S.details.get(roomId)).find((c) => c.id === vcId);
  return `<div class="cv2-head__title">
      <span class="cv2-head__ico is-ch">${channelMark('voice', 18)}</span>
      <span class="cv2-head__name">${esc(ch?.name || 'Голосовой канал')}</span>
    </div>
    <div class="cv2-head__tools"></div>`;
}

// ===== Композер =====

function placeholder(ctx: FeedCtx): string {
  if (ctx.readOnly) return 'У вас нет прав на отправку сообщений в этом канале';
  if (ctx.kind === 'dm') return `Написать @${userOf(ctx.peerId).username}`;
  if (ctx.kind === 'group') return `Написать в ${ctx.title}`;
  return `Написать в #${ctx.title}`;
}

export function renderComposer(ctx: FeedCtx): string {
  const reply = S.ui.replyTo && S.ui.replyTo.key === ctx.key ? S.ui.replyTo.msg : null;
  const draft = S.ui.drafts.get(ctx.key) || '';
  const blocked = ctx.kind === 'dm' && S.friends.blocked.some((b) => b.id === ctx.peerId);
  if (blocked) {
    return `<div class="cv2-composer is-blocked"><div class="cv2-composer__blocked">Вы заблокировали этого пользователя. <a data-act="friend-unblock" data-uid="${ctx.peerId}">Разблокировать</a></div></div>`;
  }
  return `<div class="cv2-composer ${ctx.readOnly ? 'is-readonly' : ''}">
    <div class="cv2-suggest" data-suggest hidden></div>
    ${
      reply
        ? `<div class="cv2-replybar"><span>Ответ <b>${esc(userOf(reply.sender_id).username || reply.sender_username)}</b></span><button type="button" class="cv2-replybar__x" data-act="reply-cancel" data-tip="Отменить">${IC.close(12)}</button></div>`
        : ''
    }
    <div class="cv2-composer__box ${reply ? 'has-reply' : ''}">
      <div class="cv2-plus">
        <button type="button" class="cv2-composer__btn is-plus" data-act="attach-menu" data-tip="Вложение" aria-haspopup="menu" aria-expanded="false" ${ctx.readOnly || ctx.noFiles ? 'disabled' : ''}>${composerIcon('addFile')}</button>
        <div class="cv2-plus__menu" role="menu">
          <button type="button" class="cv2-plus__row" data-act="share-build" role="menuitem"><span class="cv2-plus__ico">${IC.gamepad(16)}</span><span>Сборка</span></button>
          <button type="button" class="cv2-plus__row" data-act="share-server" role="menuitem"><span class="cv2-plus__ico">${IMG.explore(16)}</span><span>Сервер</span></button>
          <button type="button" class="cv2-plus__row" data-act="share-mod" role="menuitem"><span class="cv2-plus__ico">${IMG.newServer(16)}</span><span>Мод</span></button>
          <button type="button" class="cv2-plus__row" data-act="attach" role="menuitem"><span class="cv2-plus__ico">${IMG.addFile(16)}</span><span>Файл</span></button>
        </div>
      </div>
      <textarea class="cv2-composer__input" data-input="composer" rows="1" maxlength="4000" placeholder="${esc(placeholder(ctx))}" ${ctx.readOnly ? 'disabled' : ''}>${esc(draft)}</textarea>
      <button type="button" class="cv2-composer__btn" data-act="voice" data-tip="Голосовое сообщение" ${ctx.readOnly || ctx.noVoice ? 'disabled' : ''}>${composerIcon('microphone')}</button>
      <button type="button" class="cv2-composer__btn" data-act="sticker" data-tip="Стикеры" ${ctx.readOnly ? 'disabled' : ''}>${composerIcon('sticker')}</button>
      <button type="button" class="cv2-composer__btn is-emoji" data-act="emoji" data-tip="Эмодзи" ${ctx.readOnly ? 'disabled' : ''}>${composerIcon('emoji')}</button>
      <button type="button" class="cv2-composer__btn" data-act="link" data-tip="Ссылка [текст](url)" ${ctx.readOnly ? 'disabled' : ''}>${composerIcon('link')}</button>
    </div>
    <div class="cv2-typing" data-typing>${typingHtml(ctx.key)}</div>
    <input type="file" data-input="file" multiple hidden>
  </div>`;
}

// ===== Лента в DOM =====

const scrollMem = new Map<ConvKey, number | 'bottom'>();
let lastKey: ConvKey | null = null;

export function feedEl(): HTMLElement | null {
  return document.getElementById('cv2-feed');
}

function nearBottom(el: HTMLElement, px = 120): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < px;
}

export function rememberScroll(): void {
  const el = feedEl();
  if (!el || !lastKey) return;
  scrollMem.set(lastKey, nearBottom(el, 40) ? 'bottom' : el.scrollTop);
}

/** Полная перерисовка ленты; restore — восстановить позицию беседы или прижать к низу. */
export function paintFeed(ctx: FeedCtx, mode: 'restore' | 'keep' | 'bottom' = 'restore'): void {
  const el = feedEl();
  if (!el) return;
  const wasBottom = nearBottom(el, 40);
  // Якорь — первое видимое сообщение: позиция сохраняется и при догрузке сверху, и при правках
  let anchorId = '';
  let anchorOffset = 0;
  if (mode === 'keep' && !wasBottom) {
    const top = el.getBoundingClientRect().top;
    for (const node of Array.from(el.querySelectorAll<HTMLElement>('.cv2-msg[data-mid]'))) {
      const r = node.getBoundingClientRect();
      if (r.bottom > top) {
        anchorId = node.dataset.mid || '';
        anchorOffset = r.top - top;
        break;
      }
    }
  }
  destroyStickers(el);
  el.innerHTML = renderFeed(ctx);
  el.dataset.key = ctx.key;
  if (mode === 'bottom' || (mode === 'keep' && wasBottom)) {
    el.scrollTop = el.scrollHeight;
  } else if (mode === 'keep') {
    const node = anchorId ? el.querySelector<HTMLElement>(`.cv2-msg[data-mid="${CSS.escape(anchorId)}"]`) : null;
    if (node) el.scrollTop += node.getBoundingClientRect().top - el.getBoundingClientRect().top - anchorOffset;
  } else {
    const mem = scrollMem.get(ctx.key);
    el.scrollTop = mem == null || mem === 'bottom' ? el.scrollHeight : mem;
  }
  lastKey = ctx.key;
  // Картинки догружаются после вставки — держим низ, если были внизу
  el.querySelectorAll('img').forEach((img) => {
    if ((img as HTMLImageElement).complete) return;
    img.addEventListener('load', () => {
      if (el.dataset.stick === '1') el.scrollTop = el.scrollHeight;
    }, { once: true });
  });
  el.dataset.stick = nearBottom(el, 40) ? '1' : '0';
  updateJump(el);
  decorateFeed(el);
}

function decorateFeed(root: ParentNode): void {
  const el = root instanceof HTMLElement ? root : null;
  if (!el) return;
  bindVoicePlayers(el);
  tintReactions(el);
  mountStickers(el);
}

export function appendToFeed(ctx: FeedCtx, m: Message): void {
  const el = feedEl();
  if (!el || el.dataset.key !== ctx.key) return;
  const list = conv(ctx.key).list;
  const idx = list.indexOf(m);
  const prev = idx > 0 ? list[idx - 1] : undefined;
  const stick = nearBottom(el, 160) || sameId(m.sender_id, S.me.id);
  el.insertAdjacentHTML('beforeend', appendHtml(ctx, m, prev));
  const fresh = el.lastElementChild;
  if (fresh) decorateFeed(fresh);
  if (stick) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  else bumpUnseen(el);
}

/** Перерисовать одно сообщение на месте (реакции, правка, пин). */
export function patchInFeed(ctx: FeedCtx, id: number | string): void {
  const el = feedEl();
  if (!el || el.dataset.key !== ctx.key) return;
  const list = conv(ctx.key).list;
  const i = list.findIndex((m) => sameId(m.id, id));
  const node = el.querySelector(`.cv2-msg[data-mid="${CSS.escape(String(id))}"]`);
  if (i < 0 || !node) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = msgHtml(list[i]!, list[i - 1], ctx);
  const fresh = tmp.firstElementChild;
  if (fresh) {
    node.replaceWith(fresh);
    decorateFeed(fresh);
  }
}

export function removeFromFeed(ctx: FeedCtx, id: number | string): void {
  const el = feedEl();
  if (!el || el.dataset.key !== ctx.key) return;
  const node = el.querySelector(`.cv2-msg[data-mid="${CSS.escape(String(id))}"]`) as HTMLElement | null;
  if (!node) return;
  node.classList.add('is-removing');
  window.setTimeout(() => paintFeed(ctx, 'keep'), 180);
}

let unseen = 0;

function bumpUnseen(el: HTMLElement): void {
  unseen += 1;
  updateJump(el);
}

export function updateJump(el = feedEl()): void {
  const btn = document.querySelector<HTMLElement>('[data-jump-bottom]');
  if (!el || !btn) return;
  const far = !nearBottom(el, 300);
  if (!far) unseen = 0;
  btn.classList.toggle('is-on', far);
  const label = btn.querySelector('[data-jump-label]');
  if (label) label.textContent = unseen ? `Новых сообщений: ${unseen}` : 'Вы просматриваете старые сообщения';
}

export function scrollFeedBottom(): void {
  const el = feedEl();
  if (!el) return;
  unseen = 0;
  el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
}

export function flashMessage(id: number | string): boolean {
  const el = feedEl();
  const node = el?.querySelector(`.cv2-msg[data-mid="${CSS.escape(String(id))}"]`) as HTMLElement | null;
  if (!node) return false;
  node.scrollIntoView({ behavior: 'smooth', block: 'center' });
  node.classList.remove('is-flash');
  void node.offsetWidth;
  node.classList.add('is-flash');
  return true;
}

export function paintTyping(key: ConvKey): void {
  const el = document.querySelector<HTMLElement>('[data-typing]');
  if (el && feedCtx()?.key === key) el.innerHTML = typingHtml(key);
}

export function chatShell(ctx: FeedCtx, aside: string): string {
  return `<div class="cv2-chat ${aside ? 'has-aside' : ''}">
    <div class="cv2-chat__col">
      <div class="cv2-chat__call" id="cv2-call"></div>
      <div class="cv2-chat__drop"><div class="cv2-chat__drop-in">${IC.file(40)}<b>Перетащите файлы сюда</b><span>Они будут отправлены в беседу</span></div></div>
      <div class="cv2-feed" id="cv2-feed" data-key="${esc(ctx.key)}"></div>
      <button type="button" class="cv2-jump" data-jump-bottom data-act="jump-bottom"><span data-jump-label>Вы просматриваете старые сообщения</span><span class="cv2-jump__go">Перейти к последним ${IC.arrowDown(12)}</span></button>
      ${renderComposer(ctx)}
    </div>
    <aside class="cv2-aside ${aside ? 'is-open' : ''}" id="cv2-aside">${aside}</aside>
  </div>`;
}

export function isPeerOnline(peerId: number): boolean {
  return isOnline(peerId);
}
