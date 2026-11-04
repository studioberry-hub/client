// Делегированные обработчики чатов v2: клики по data-act, контекстные меню по data-ctx, композер, прокрутка, горячие клавиши.
import { IC, IMG, VCI, assetMask, channelMark, menuIcon } from './icons';
import {
  chatLocalBuilds,
  closeMyLanWorld,
  createBuildShareLink,
  inviteLanFriends,
  openMyLanWorld,
  openSharedBuild,
  openSharedCard,
  pickCatalogShare,
  playSharedWorld,
} from '../messenger/ui';
import { worldByUser } from './worlds';
import {
  S,
  allTextChannels,
  allVoiceChannels,
  canManage,
  channelAllows,
  channelNotify,
  conv,
  errText,
  hideMutedChannels,
  invalidate,
  isCatHidden,
  isChannelMuted,
  isFavChannel,
  isFriend,
  isPinnedChannel,
  isRoomOwner,
  loadDetail,
  loadFriends,
  loadHistory,
  loadInbox,
  loadLists,
  loadMembers,
  muteChannel,
  relationTo,
  roomById,
  roomNotify,
  saveUi,
  setChannelNotify,
  setRoomNotify,
  showAllChannels,
  toggleCatHidden,
  toggleFavChannel,
  toggleHideMutedChannels,
  togglePinnedChannel,
  toggleShowAllChannels,
  unmuteChannel,
  unwrap,
  userOf,
  type NotifyLevel,
} from './store';
import {
  C,
  DEV,
  V,
  callAccept,
  callDecline,
  callHangup,
  callStart,
  listDevices,
  setInputDevice,
  setOutputDevice,
  setUserVolume,
  toggleDeafen,
  toggleMute,
  userVolume,
  vcJoin,
  vcLeave,
} from './rtc';
import { bindChannelDrag } from './channelDrag';
import { closeMenu, confirmDialog, openEmojiPicker, openMenu, openModal, promptDialog, QUICK_REACTIONS, toast, type MenuItem } from './overlays';
import { openImageViewer } from '../image-viewer';
import { openVideoViewer } from '../video-player';
import { openStickerPicker } from './stickers';
import { playGsSound } from './sounds';
import { copyText, debounce, esc, sameId, syncRange } from './util';
import {
  ack,
  deleteMessage,
  discard,
  editMessage,
  groupCall,
  loadAsideList,
  loadOlder,
  msgById,
  openChannel,
  openDm,
  openFriends,
  openGroup,
  openInvites,
  openWorlds,
  openServer,
  openVoice,
  openVoiceRoom,
  pinMessage,
  react,
  retry,
  sendText,
  uploadAndSend,
  wsSend,
} from './nav';
import { feedCtx, feedEl, flashMessage, scrollFeedBottom, updateJump } from './views/chat';
import { closeUserPopout, openUserPopout } from './views/aside';
import { setDmHidden } from './views/sidebar';
import {
  audioSettingsModal,
  banDialog,
  channelModal,
  createServerModal,
  forwardModal,
  groupPickerModal,
  inviteModal,
  joinServerModal,
  mutualModal,
  quickSwitcher,
  serverSettingsModal,
} from './views/modals';
import type { Category, ConvKey, FriendsTab, Message, TextChannel, View, VoiceChannel } from './types';

// ===== Домашняя вкладка помнит последнюю беседу =====

let lastHome: View = { kind: 'friends', tab: 'online' };

export function rememberHome(v: View): void {
  if (v.kind === 'friends' || v.kind === 'worlds' || v.kind === 'invites' || v.kind === 'dm' || v.kind === 'group') lastHome = v;
}

function openHome(): void {
  const v = lastHome;
  if (v.kind === 'dm') void openDm(v.peerId);
  else if (v.kind === 'group' && roomById(v.roomId)) void openGroup(v.roomId);
  else if (v.kind === 'invites') openInvites();
  else if (v.kind === 'worlds') openWorlds();
  else openFriends(v.kind === 'friends' ? v.tab : 'online');
}

// ===== Композер =====

function composerEl(): HTMLTextAreaElement | null {
  return document.querySelector<HTMLTextAreaElement>('#cv2-root [data-input="composer"]');
}

export function autosize(ta: HTMLTextAreaElement): void {
  ta.style.height = 'auto';
  ta.style.height = `${Math.min(ta.scrollHeight, Math.round(window.innerHeight * 0.5))}px`;
}

function insertAtCaret(ta: HTMLTextAreaElement, text: string): void {
  const s = ta.selectionStart ?? ta.value.length;
  const e = ta.selectionEnd ?? s;
  ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
  const pos = s + text.length;
  ta.setSelectionRange(pos, pos);
  ta.focus();
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

export function focusComposer(): void {
  const ta = composerEl();
  if (!ta || ta.disabled) return;
  ta.focus();
  const n = ta.value.length;
  ta.setSelectionRange(n, n);
}

let lastTypingAt = 0;

function sendTyping(key: ConvKey): void {
  const now = Date.now();
  if (now - lastTypingAt < 3000) return;
  lastTypingAt = now;
  const [kind, idStr] = key.split(':');
  const id = Number(idStr);
  if (kind === 'dm') void wsSend({ type: 'typing', receiver_id: id });
  else {
    const v = S.view;
    const roomId = v.kind === 'server' || v.kind === 'group' ? v.roomId : null;
    if (roomId) void wsSend({ type: 'typing', room_id: roomId, channel_id: id });
  }
}

async function submitComposer(ta: HTMLTextAreaElement): Promise<void> {
  const ctx = feedCtx();
  if (!ctx || ctx.readOnly) return;
  const text = ta.value;
  if (!text.trim()) return;
  if (ctx.kind === 'channel' && ctx.roomId && /@(everyone|here)\b/i.test(text)) {
    const mentioned = allTextChannels(S.details.get(ctx.roomId)).find((c) => c.id === Number(ctx.key.split(':')[1]));
    if (mentioned && !channelAllows(ctx.roomId, mentioned, 'mention_everyone')) {
      toast('Нет права упоминать @everyone и @here в этом канале', 'error');
      ta.value = text;
      return;
    }
  }
  if (text.length > 4000) {
    toast('Сообщение длиннее 4000 символов', 'error');
    return;
  }
  ta.value = '';
  autosize(ta);
  lastTypingAt = 0;
  playGsSound('send');
  const hadReply = Boolean(S.ui.replyTo);
  await sendText(ctx.key, text);
  if (hadReply) invalidate('composer');
}

// ===== Подсказки @упоминаний =====

type Suggest = { items: Array<{ id: number | string; name: string; html: string; token: string }>; sel: number; start: number; title: string };
let suggest: Suggest | null = null;

function mentionCandidates(): Array<{ id: number | string; name: string }> {
  const v = S.view;
  if (v.kind === 'dm') return [{ id: v.peerId, name: userOf(v.peerId).username }];
  if (v.kind === 'group' || v.kind === 'server') {
    const list: Array<{ id: number | string; name: string }> = (S.members.get(v.roomId) || []).map((m) => ({ id: m.user_id, name: userOf(m.user_id).username || m.username }));
    if (v.kind === 'server' && canManage(v.roomId, 'manage_messages')) list.push({ id: 'everyone', name: 'everyone' }, { id: 'here', name: 'here' });
    return list.filter((x) => !sameId(x.id, S.me.id));
  }
  return [];
}

function paintSuggest(): void {
  const box = document.querySelector<HTMLElement>('#cv2-root [data-suggest]');
  if (!box) return;
  if (!suggest || !suggest.items.length) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  box.hidden = false;
  box.innerHTML = `<div class="cv2-suggest__title">${esc(suggest.title)}</div>${suggest.items
    .map((it, i) => `<button type="button" class="cv2-suggest__item ${i === suggest!.sel ? 'is-sel' : ''}" data-suggest-i="${i}">${it.html}<span>${esc(it.name)}</span></button>`)
    .join('')}`;
}

function updateSuggest(ta: HTMLTextAreaElement): void {
  const caret = ta.selectionStart ?? ta.value.length;
  const before = ta.value.slice(0, caret);
  const hash = before.match(/(^|\s)#([A-Za-z0-9_\u0400-\u04FF.-]{0,40})$/);
  if (hash && S.view.kind === 'server') {
    const q = hash[2]!.toLowerCase();
    const d = S.details.get(S.view.roomId);
    const rows = [
      ...allTextChannels(d).map((c) => ({ id: c.id, name: c.name, kind: c.channel_kind || 'text' })),
      ...allVoiceChannels(d).map((c) => ({ id: c.id, name: c.name, kind: 'voice' })),
    ].filter((c) => !q || c.name.toLowerCase().includes(q)).slice(0, 12);
    suggest = rows.length
      ? {
          title: 'Каналы',
          sel: 0,
          start: caret - hash[2]!.length - 1,
          items: rows.map((c) => ({ id: c.id, name: c.name, token: `#${c.name}`, html: channelMark(c.kind, 16) })),
        }
      : null;
    paintSuggest();
    return;
  }
  const m = before.match(/(^|\s)@([\w\u0400-\u04FF.-]{0,32})$/);
  if (!m) {
    suggest = null;
    paintSuggest();
    return;
  }
  const q = m[2]!.toLowerCase();
  const items = mentionCandidates()
    .filter((c) => c.name.toLowerCase().startsWith(q) || (q.length > 1 && c.name.toLowerCase().includes(q)))
    .slice(0, 8)
    .map((c) => {
      const u = typeof c.id === 'number' ? userOf(c.id) : null;
      return {
        ...c,
        token: `@${c.name}`,
        html: u ? `<span class="cv2-suggest__ava" style="--ava-bg:${esc(u.avatar_color || '#303030')}">${esc(u.username.slice(0, 1).toUpperCase())}</span>` : `<span class="cv2-suggest__ava is-at">@</span>`,
      };
    });
  suggest = items.length ? { title: 'Участники', items, sel: 0, start: caret - m[2]!.length - 1 } : null;
  paintSuggest();
}

function applySuggest(ta: HTMLTextAreaElement, i: number): void {
  const it = suggest?.items[i];
  if (!it || !suggest) return;
  const caret = ta.selectionStart ?? ta.value.length;
  ta.value = `${ta.value.slice(0, suggest.start)}${it.token} ${ta.value.slice(caret)}`;
  const pos = suggest.start + it.token.length + 1;
  ta.setSelectionRange(pos, pos);
  suggest = null;
  paintSuggest();
  ta.focus();
}

// ===== Правка сообщений =====

function startEdit(key: ConvKey, id: number | string): void {
  S.ui.editing = { key, id };
  invalidate('feed');
}

export function focusEditBox(): void {
  const ta = document.querySelector<HTMLTextAreaElement>('#cv2-root [data-input="edit"]');
  if (!ta || document.activeElement === ta) return;
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
  autosize(ta);
}

async function saveEdit(): Promise<void> {
  const ed = S.ui.editing;
  const ta = document.querySelector<HTMLTextAreaElement>('#cv2-root [data-input="edit"]');
  if (!ed || !ta) return;
  const text = ta.value.trim();
  S.ui.editing = null;
  if (!text) {
    invalidate('feed');
    const m = msgById(ed.key, ed.id);
    if (m && (await confirmDialog('Удалить сообщение', 'Вы уверены, что хотите удалить это сообщение?', 'Удалить'))) await deleteMessage(ed.key, ed.id);
    return;
  }
  await editMessage(ed.key, ed.id, text);
  invalidate('feed');
  focusComposer();
}

function cancelEdit(): void {
  S.ui.editing = null;
  invalidate('feed');
  focusComposer();
}

// ===== Переход к сообщению =====

async function jumpTo(id: number | string): Promise<void> {
  if (flashMessage(id)) return;
  const ctx = feedCtx();
  if (!ctx) return;
  // Догружаем историю вверх, пока не найдём (до 10 страниц)
  for (let i = 0; i < 10; i++) {
    const c = conv(ctx.key);
    if (c.list.some((m) => sameId(m.id, id))) break;
    if (!c.hasMore) break;
    await loadHistory(ctx.key, true);
  }
  if (!conv(ctx.key).list.some((m) => sameId(m.id, id))) {
    toast('Сообщение не найдено — возможно, оно удалено', 'error');
    return;
  }
  invalidate('feed');
  window.setTimeout(() => flashMessage(id), 60);
}

// ===== Меню =====

function canDelete(m: Message): boolean {
  if (sameId(m.sender_id, S.me.id)) return true;
  const ctx = feedCtx();
  return Boolean(ctx && ctx.kind !== 'dm' && ctx.moderator);
}

async function reportContent(body: Record<string, unknown>): Promise<void> {
  const reason = await promptDialog('Сообщить о нарушении', 'Что нарушает правила?', '', {
    placeholder: 'Спам, оскорбления, опасный контент',
    ok: 'Отправить',
    max: 500,
  });
  if (!reason?.trim()) return;
  try {
    unwrap(await S.api.cloudReport?.({ ...body, reason: reason.trim() }));
    toast('Жалоба отправлена', 'success');
  } catch (err) {
    toast(errText(err), 'error');
  }
}

function msgMenu(key: ConvKey, m: Message): MenuItem[] {
  const ctx = feedCtx();
  const mine = sameId(m.sender_id, S.me.id);
  const canPin = !ctx || ctx.kind !== 'channel' || ctx.moderator;
  const items: MenuItem[] = [
    {
      html: `<div class="cv2-menu__reacts">${QUICK_REACTIONS.map((e) => `<button type="button" data-e="${e}">${e}</button>`).join('')}</div>`,
      onMount: (el) =>
        el.querySelectorAll<HTMLElement>('[data-e]').forEach((b) =>
          b.addEventListener('click', () => {
            closeMenu();
            void react(key, m.id, b.dataset.e!);
          }),
        ),
    },
    'sep',
  ];
  if (mine && !m.is_system) items.push({ label: 'Изменить сообщение', icon: IMG.edit(16), onClick: () => startEdit(key, m.id) });
  if (canPin) items.push({ label: m.is_pinned ? 'Открепить сообщение' : 'Закрепить сообщение', icon: IMG.pin(16), onClick: () => void pinMessage(key, m.id, !m.is_pinned) });
  if (!ctx?.readOnly) {
    items.push({
      label: 'Ответить',
      icon: IMG.reply(16),
      onClick: () => {
        S.ui.replyTo = { key, msg: m };
        invalidate('composer');
      },
    });
  }
  items.push(
    { label: 'Переслать', icon: IMG.forward(16), onClick: () => forwardModal(m) },
    { label: 'Копировать текст', icon: IMG.copy(16), onClick: () => copyText(m.text) },
  );
  if (canDelete(m)) {
    items.push('sep', {
      label: 'Удалить сообщение',
      icon: IMG.delete(16),
      danger: true,
      onClick: async () => {
        if (await confirmDialog('Удалить сообщение', 'Вы уверены, что хотите удалить это сообщение? Отменить это действие нельзя.', 'Удалить')) await deleteMessage(key, m.id);
      },
    });
  }
  items.push('sep', { label: 'Копировать ID сообщения', icon: IMG.copyid(16), onClick: () => copyText(String(m.id)) });
  if (!mine && !m.is_system) {
    items.push({
      label: 'Сообщить о нарушении',
      danger: true,
      onClick: () =>
        void reportContent({
          target_type: 'message',
          target_id: m.id,
          message_id: m.id,
          room_id: ctx && ctx.kind !== 'dm' ? ctx.roomId : undefined,
        }),
    });
  }
  return items;
}

function userMenu(uid: number, opts: { roomId?: number; voice?: boolean } = {}): MenuItem[] {
  const me = sameId(uid, S.me.id);
  const items: MenuItem[] = [{ label: 'Профиль', icon: IMG.people(16), onClick: () => S.api.openUserProfile?.(uid) }];
  if (!me) {
    items.push(
      { label: 'Написать', icon: IC.chat(16), onClick: () => void openDm(uid) },
      { label: 'Позвонить', icon: IMG.call(16), onClick: () => void openDm(uid).then(() => callStart(uid)) },
    );
  }
  if (opts.voice && !me) {
    items.push('sep', {
      html: `<div class="cv2-menu__vol"><span>Громкость пользователя</span><input type="range" min="0" max="100" value="${Math.round(userVolume(uid) * 100)}" class="cv2-range"></div>`,
      onMount: (el) => {
        const r = el.querySelector('input') as HTMLInputElement;
        syncRange(r);
        r.addEventListener('input', () => {
          syncRange(r);
          setUserVolume(uid, Number(r.value) / 100);
        });
      },
    });
  }
  if (!me) {
    const rel = relationTo(uid);
    items.push('sep');
    if (rel === 'friend') items.push({ label: 'Удалить из друзей', danger: true, onClick: () => void removeFriend(uid) });
    else if (rel === 'none') items.push({ label: 'Добавить в друзья', icon: IMG.addUser(16), onClick: () => void friendAction('add', uid) });
    else if (rel === 'incoming') items.push({ label: 'Принять заявку', icon: IC.check(16), onClick: () => void friendAction('accept', uid) });
    else if (rel === 'outgoing') items.push({ label: 'Отменить заявку', onClick: () => void friendAction('decline', uid) });
    items.push(
      rel === 'blocked'
        ? { label: 'Разблокировать', onClick: () => void friendAction('unblock', uid) }
        : { label: 'Заблокировать', danger: true, onClick: () => void blockUser(uid) },
    );
  }
  const roomId = opts.roomId;
  if (roomId && !me) {
    const room = roomById(roomId);
    const mod: MenuItem[] = [];
    if (opts.voice && V.channelId && canManage(roomId, 'kick_members')) {
      mod.push(
        { label: V.serverMuted.has(uid) ? 'Включить микрофон на сервере' : 'Отключить микрофон на сервере', onClick: () => void wsSend({ type: 'vc_server_mute', voice_channel_id: V.channelId, target_id: uid, enabled: !V.serverMuted.has(uid) }) },
        { label: 'Отключить от канала', danger: true, onClick: () => void wsSend({ type: 'vc_force_disconnect', voice_channel_id: V.channelId, target_id: uid }) },
      );
    }
    if (room?.kind === 'group') {
      if (isRoomOwner(roomId)) mod.push({ label: 'Удалить из группы', danger: true, onClick: () => void removeFromGroup(roomId, uid) });
    } else {
      if (canManage(roomId, 'kick_members')) mod.push({ label: `Выгнать ${userOf(uid).username}`, danger: true, onClick: () => void kick(roomId, uid) });
      if (canManage(roomId, 'mute_members') || canManage(roomId, 'kick_members')) {
        mod.push({
          label: `Тайм-аут на час`,
          onClick: () => {
            void S.api.cloudMuteUser?.(roomId, uid, 'timeout 1h', 60).then(() => toast('Тайм-аут на час', 'success')).catch((e) => toast(errText(e), 'error'));
          },
        });
      }
      if (canManage(roomId, 'ban_members')) mod.push({ label: `Забанить ${userOf(uid).username}`, danger: true, onClick: () => banDialog(roomId, uid) });
    }
    if (mod.length) items.push('sep', ...mod);
  }
  if (!me) {
    items.push({
      label: 'Сообщить о нарушении',
      danger: true,
      onClick: () => void reportContent({ target_type: 'user', target_id: uid, room_id: opts.roomId }),
    });
  }
  items.push('sep', { label: 'Копировать ID пользователя', icon: IC.at(16), onClick: () => copyText(String(uid)) });
  return items;
}

function notifyHint(level: NotifyLevel, muted = false): string {
  if (muted) return 'Заглушён';
  if (level === 'mentions') return 'Только @упоминания';
  if (level === 'none') return 'Ничего';
  return 'Все сообщения';
}

function notifyItems(current: NotifyLevel, set: (level: NotifyLevel) => void): MenuItem[] {
  const row = (level: NotifyLevel, label: string): MenuItem => ({
    label,
    checked: current === level,
    onClick: () => set(level),
  });
  return [row('all', 'Все сообщения'), row('mentions', 'Только @упоминания'), row('none', 'Ничего')];
}

function serverMenu(roomId: number): MenuItem[] {
  const owner = isRoomOwner(roomId);
  const admin = canManage(roomId) || canManage(roomId, 'manage_roles') || canManage(roomId, 'ban_members');
  const siteId = roomById(roomId)?.site_id || '';
  const level = roomNotify(siteId);
  const items: MenuItem[] = [{ label: 'Пригласить на сервер', icon: IMG.addUser(18), onClick: () => inviteModal(roomId) }];
  if (admin) {
    items.push({ label: 'Настройки сервера', icon: menuIcon('settings'), onClick: () => serverSettingsModal(roomId) });
  }
  if (canManage(roomId)) {
    items.push(
      'sep',
      { label: 'Создать канал', icon: menuIcon('addChannel'), onClick: () => channelModal({ kind: 'text', roomId }) },
      { label: 'Создать категорию', icon: menuIcon('addCategory'), onClick: () => channelModal({ kind: 'category', roomId }) },
    );
  }
  items.push(
    'sep',
    {
      label: 'Показать все каналы',
      icon: IC.eye(18),
      checked: showAllChannels(siteId),
      onClick: () => {
        toggleShowAllChannels(siteId);
        invalidate('sidebar');
      },
    },
    {
      label: 'Параметры уведомлений',
      icon: menuIcon('notifications'),
      hint: notifyHint(level),
      sub: notifyItems(level, (next) => {
        setRoomNotify(siteId, next);
        toast(next === 'none' ? 'Уведомления сервера отключены' : next === 'mentions' ? 'Только упоминания' : 'Уведомления сервера включены');
        invalidate('sidebar');
      }),
    },
    { label: 'Изменить никнейм', icon: menuIcon('editNickname'), onClick: () => void editServerNick(roomId) },
    {
      label: 'Скрыть заглушённые каналы',
      icon: menuIcon('turnOffNotifications'),
      checked: hideMutedChannels(siteId),
      onClick: () => {
        toggleHideMutedChannels(siteId);
        invalidate('sidebar');
      },
    },
    'sep',
    { label: 'Отметить как прочитанное', icon: menuIcon('markAsRead'), onClick: () => markServerRead(roomId) },
  );
  if (!owner) items.push('sep', { label: 'Покинуть сервер', icon: IC.logout(18), danger: true, onClick: () => void leaveServer(roomId) });
  items.push(
    { label: 'Сообщить о нарушении', icon: assetMask('MenuIcons/report', 18), danger: true, onClick: () => void reportContent({ target_type: 'room', target_id: roomId, room_id: roomId }) },
    'sep',
    { label: 'Копировать ID сервера', icon: IMG.copyid(18), onClick: () => copyText(siteId || String(roomId)) },
  );
  return items;
}

async function editServerNick(roomId: number): Promise<void> {
  if (S.me.id == null) return;
  const me = S.members.get(roomId)?.find((m) => sameId(m.user_id, S.me.id));
  const name = await promptDialog('Никнейм на сервере', 'Никнейм', me?.nickname || '', {
    placeholder: S.me.username || 'Никнейм',
    max: 32,
    sub: 'Пустое поле вернёт обычное имя.',
  });
  if (name == null) return;
  try {
    unwrap(await S.api.cloudSetMemberNickname?.(roomId, S.me.id, name.trim() || null));
    await loadMembers(roomId);
    invalidate('sidebar', 'aside');
    toast('Никнейм обновлён');
  } catch (err) {
    toast(errText(err), 'error');
  }
}

// ===== Селекторы устройств ввода и вывода =====

let devOpenFor: HTMLElement | null = null;
let devToggleOff = false;

// Повторный клик по открытому селектору закрывает меню: mousedown закрывает его раньше click,
// поэтому запоминаем, что нажали именно на «свой» селектор при открытом меню
document.addEventListener(
  'mousedown',
  (e) => {
    const b = (e.target as HTMLElement | null)?.closest?.('[data-act="dev-menu"]');
    devToggleOff = Boolean(b && b === devOpenFor && document.querySelector('.cv2-menu.is-on'));
  },
  true,
);

async function deviceMenu(anchor: HTMLElement, kind: 'in' | 'out'): Promise<void> {
  if (devToggleOff) {
    devToggleOff = false;
    return;
  }
  const { inputs, outputs } = await listDevices();
  // «default»/«communications» — псевдоустройства Chromium, их роль выполняет пункт «По умолчанию»
  const list = (kind === 'in' ? inputs : outputs).filter((d) => d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications');
  const current = kind === 'in' ? DEV.input : DEV.output;
  const pick = (id: string) => void (kind === 'in' ? setInputDevice(id) : setOutputDevice(id)).then(() => invalidate('sidebar', 'main'));
  const items: MenuItem[] = [
    { header: kind === 'in' ? 'Устройство ввода' : 'Устройство вывода' },
    { label: 'По умолчанию', checked: !current || !list.some((d) => d.deviceId === current), onClick: () => pick('') },
    ...list.map((d, i): MenuItem => ({
      label: d.label || (kind === 'in' ? `Микрофон ${i + 1}` : `Динамики ${i + 1}`),
      checked: d.deviceId === current,
      onClick: () => pick(d.deviceId),
    })),
    'sep',
    { label: 'Настройки голоса', icon: IC.gear(16), onClick: () => audioSettingsModal() },
  ];
  openMenu(items, anchor, { side: 'top', align: 'start' });
  devOpenFor = anchor;
  anchor.setAttribute('aria-expanded', 'true');
  // Меню закрывается разными путями (выбор, Esc, клик мимо) — снимаем состояние селектора по факту закрытия
  const mo = new MutationObserver(() => {
    if (document.querySelector('.cv2-menu.is-on')) return;
    mo.disconnect();
    anchor.removeAttribute('aria-expanded');
    if (devOpenFor === anchor) devOpenFor = null;
  });
  // Класс is-on меню ставит в rAF — наблюдение начинаем после него, иначе меню сочтётся закрытым
  requestAnimationFrame(() => mo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] }));
}

function markServerRead(roomId: number): void {
  for (const c of allTextChannels(S.details.get(roomId))) {
    if ((S.chUnread.get(c.id)?.u || 0) > 0) void S.api.cloudAckChannel?.(roomId, c.id);
    S.chUnread.set(c.id, { u: 0, m: 0 });
  }
  const r = roomById(roomId);
  if (r) {
    r.unread_count = 0;
    r.mention_count = 0;
  }
  invalidate('rail', 'sidebar', 'badge');
}

// ===== Операции соцграфа =====

async function friendAction(kind: 'add' | 'accept' | 'decline' | 'unblock', uid: number): Promise<void> {
  try {
    if (kind === 'add') unwrap(await S.api.cloudFriendRequest?.({ user_id: uid }));
    else if (kind === 'accept') unwrap(await S.api.cloudFriendAccept?.(uid));
    else if (kind === 'decline') unwrap(await S.api.cloudFriendRemove?.(uid));
    else unwrap(await S.api.cloudFriendUnblock?.(uid));
    if (kind === 'add') toast('Заявка в друзья отправлена', 'success');
    await loadFriends();
    S.mutuals.delete(uid);
    invalidate('main', 'sidebar', 'aside', 'badge', 'rail');
  } catch (e) {
    toast(errText(e), 'error');
  }
}

async function removeFriend(uid: number): Promise<void> {
  const name = esc(userOf(uid).username);
  if (!(await confirmDialog(`Удалить «${name}»`, `Вы уверены, что хотите удалить <b>${name}</b> из друзей?`, 'Удалить из друзей'))) return;
  await friendAction('decline', uid);
}

async function blockUser(uid: number): Promise<void> {
  const name = esc(userOf(uid).username);
  if (!(await confirmDialog(`Заблокировать ${name}?`, 'Пользователь не сможет писать вам и звонить, а также будет удалён из друзей.', 'Заблокировать'))) return;
  try {
    unwrap(await S.api.cloudFriendBlock?.(uid));
    await loadFriends();
    invalidate('main', 'sidebar', 'aside', 'badge');
  } catch (e) {
    toast(errText(e), 'error');
  }
}

async function kick(roomId: number, uid: number): Promise<void> {
  if (!(await confirmDialog('Выгнать участника', `Выгнать <b>${esc(userOf(uid).username)}</b> с сервера?`, 'Выгнать'))) return;
  try {
    unwrap(await S.api.cloudKickMember?.(roomId, uid));
    S.members.set(roomId, (S.members.get(roomId) || []).filter((m) => m.user_id !== uid));
    invalidate('aside');
  } catch (e) {
    toast(errText(e), 'error');
  }
}

async function removeFromGroup(roomId: number, uid: number): Promise<void> {
  try {
    unwrap(await S.api.cloudGroupRemove?.(roomId, uid));
    S.members.set(roomId, (S.members.get(roomId) || []).filter((m) => m.user_id !== uid));
    await loadLists();
    invalidate('aside', 'sidebar', 'main');
  } catch (e) {
    toast(errText(e), 'error');
  }
}

async function leaveServer(roomId: number): Promise<void> {
  const r = roomById(roomId);
  const isGroup = r?.kind === 'group';
  const name = esc(r?.name || '');
  const ok = await confirmDialog(
    isGroup ? `Покинуть «${name}»` : `Покинуть «${name}»`,
    isGroup ? 'Вы больше не будете видеть сообщения группы, пока вас не добавят снова.' : `Вы уверены, что хотите покинуть <b>${name}</b>? Вернуться можно только по приглашению.`,
    isGroup ? 'Покинуть группу' : 'Покинуть сервер',
  );
  if (!ok) return;
  try {
    if (sameId(V.roomId, roomId)) await vcLeave();
    unwrap(await S.api.cloudLeaveRoom?.(roomId));
    await loadLists();
    const v = S.view;
    if ((v.kind === 'server' || v.kind === 'group') && v.roomId === roomId) openFriends();
    invalidate('rail', 'sidebar', 'main', 'badge');
  } catch (e) {
    toast(errText(e), 'error');
  }
}

// ===== Клики =====

function num(el: HTMLElement, key: string): number {
  return Number(el.dataset[key]) || 0;
}

function currentKey(): ConvKey | null {
  return feedCtx()?.key ?? null;
}

/** Ctrl/Cmd+клик открывает сервер или личный чат в отдельном окне, как в Telegram. */
function openInWindow(
  e: MouseEvent,
  target: { kind: 'dm' | 'server' | 'group'; id: number; channelId?: number; title?: string; avatar?: string | null; color?: string | null },
): boolean {
  if (!(e.ctrlKey || e.metaKey) || !target.id) return false;
  if (document.body.classList.contains('gs-chat-popout')) return false;
  e.preventDefault();
  void S.api.chatOpenWindow?.(target);
  return true;
}

async function onAct(el: HTMLElement, e: MouseEvent): Promise<void> {
  const act = el.dataset.act!;
  const key = currentKey();
  const mid = el.dataset.mid;
  switch (act) {
    // --- навигация
    case 'open-home':
      return openHome();
    case 'open-friends':
      return openFriends(S.view.kind === 'friends' ? S.view.tab : 'online');
    case 'open-invites':
      return openInvites();
    case 'open-worlds':
      return openWorlds();
    case 'world-join': {
      const world = worldByUser(num(el, 'uid'));
      if (!world?.serverHost) {
        toast('Мир уже закрыт', 'error');
        return;
      }
      const host = world.serverHost;
      const cut = host.lastIndexOf(':');
      const ip = cut > 0 ? host.slice(0, cut) : host;
      const port = cut > 0 ? Number(host.slice(cut + 1)) : 25565;
      const relay = !/^(10\.|192\.168\.|127\.|localhost|172\.(1[6-9]|2\d|3[0-1])\.)/i.test(ip);
      void playSharedWorld(
        {
          mode: relay ? 'relay' : 'direct',
          publicHost: relay ? ip : null,
          publicPort: relay ? port : null,
          host: relay ? null : ip,
          port: relay ? null : port,
          serverName: world.serverName,
          buildName: world.build,
          gameVersion: world.version,
          sessionId: world.sessionId || null,
          from: { id: world.siteId, username: world.username },
        },
        { id: world.siteId, username: world.username },
      );
      return;
    }
    case 'world-copy':
      if (el.dataset.href) {
        try {
          await navigator.clipboard.writeText(el.dataset.href);
          toast('Адрес скопирован', 'success', 1600);
        } catch {
          toast('Не удалось скопировать', 'error');
        }
      }
      return;
    case 'friends-tab':
      return openFriends(el.dataset.tab as FriendsTab);
    case 'open-dm':
      closeUserPopout();
      if (openInWindow(e, { kind: 'dm', id: num(el, 'peer'), title: userOf(num(el, 'peer')).username, avatar: userOf(num(el, 'peer')).avatar_url, color: userOf(num(el, 'peer')).avatar_color })) return;
      return openDm(num(el, 'peer'));
    case 'open-group':
      if (openInWindow(e, { kind: 'group', id: num(el, 'room'), title: roomById(num(el, 'room'))?.name, avatar: roomById(num(el, 'room'))?.avatar_url, color: roomById(num(el, 'room'))?.avatar_color })) return;
      return openGroup(num(el, 'room'));
    case 'open-server':
      if (openInWindow(e, { kind: 'server', id: num(el, 'room'), title: roomById(num(el, 'room'))?.name, avatar: roomById(num(el, 'room'))?.avatar_url, color: roomById(num(el, 'room'))?.avatar_color })) return;
      return openServer(num(el, 'room'));
    case 'open-channel':
      if (openInWindow(e, { kind: 'server', id: num(el, 'room'), channelId: num(el, 'ch'), title: roomById(num(el, 'room'))?.name, avatar: roomById(num(el, 'room'))?.avatar_url, color: roomById(num(el, 'room'))?.avatar_color })) return;
      return openChannel(num(el, 'room'), num(el, 'ch'));
    case 'open-voice':
      return openVoice(num(el, 'room'), num(el, 'vc'));
    case 'open-voice-room':
      return openVoiceRoom(num(el, 'room'), num(el, 'vc'));
    case 'quick-switch':
      return quickSwitcher();
    case 'join-server':
      return joinServerModal();
    case 'create-server':
      return createServerModal();
    case 'about':
      document.getElementById('gs-msgr-holospeak-about-btn')?.click();
      return;
    case 'toggle-sidebar':
      S.ui.mobileSidebar = !S.ui.mobileSidebar;
      invalidate('layout');
      return;

    // --- сайдбар
    case 'hide-dm': {
      e.stopPropagation();
      const peer = num(el, 'peer');
      setDmHidden(peer, true);
      if (S.view.kind === 'dm' && S.view.peerId === peer) openFriends();
      invalidate('sidebar', 'rail');
      return;
    }
    case 'leave-group':
      e.stopPropagation();
      return leaveServer(num(el, 'room'));
    case 'toggle-cat': {
      const k = String(el.dataset.key);
      if (S.ui.collapsed.has(k)) S.ui.collapsed.delete(k);
      else S.ui.collapsed.add(k);
      saveUi();
      invalidate('sidebar');
      return;
    }
    case 'server-menu':
      openMenu(serverMenu(num(el, 'room')), el, { align: 'start' });
      return;
    case 'server-invite':
      e.stopPropagation();
      inviteModal(num(el, 'room'));
      return;
    case 'create-channel':
      e.stopPropagation();
      return channelModal({ kind: 'text', roomId: num(el, 'room'), catId: num(el, 'cat') || null });
    case 'channel-settings': {
      e.stopPropagation();
      const roomId = num(el, 'room');
      const ch = allTextChannels(S.details.get(roomId)).find((c) => c.id === num(el, 'ch'));
      if (ch) channelModal({ kind: 'text', roomId, ch });
      return;
    }
    case 'voice-settings': {
      e.stopPropagation();
      const roomId = num(el, 'room');
      const ch = allVoiceChannels(S.details.get(roomId)).find((c) => c.id === num(el, 'vc'));
      if (ch) channelModal({ kind: 'voice', roomId, ch });
      return;
    }

    // --- друзья и приглашения
    case 'friend-accept':
      e.stopPropagation();
      return friendAction('accept', num(el, 'uid'));
    case 'friend-decline':
      e.stopPropagation();
      return friendAction('decline', num(el, 'uid'));
    case 'friend-unblock':
      e.stopPropagation();
      return friendAction('unblock', num(el, 'uid'));
    case 'friend-add':
      return friendAction('add', num(el, 'uid'));
    case 'friend-more':
      e.stopPropagation();
      openMenu(userMenu(num(el, 'uid')), el, { align: 'end' });
      return;
    case 'invite-accept': {
      el.setAttribute('disabled', '');
      try {
        const d = unwrap<{ room_id?: number }>(await S.api.cloudInboxAccept?.(num(el, 'id')));
        await Promise.all([loadLists(), loadInbox()]);
        if (d?.room_id) await openServer(Number(d.room_id));
        toast('Добро пожаловать на сервер!', 'success');
      } catch (err) {
        el.removeAttribute('disabled');
        toast(errText(err), 'error');
      }
      invalidate('rail', 'sidebar', 'main', 'badge');
      return;
    }
    case 'invite-decline':
      try {
        unwrap(await S.api.cloudInboxDecline?.(num(el, 'id')));
        S.inbox = S.inbox.filter((i) => i.id !== num(el, 'id'));
      } catch (err) {
        toast(errText(err), 'error');
      }
      invalidate('main', 'sidebar', 'badge', 'rail');
      return;

    // --- группы
    case 'create-group':
      return groupPickerModal({ mode: 'create', preselect: el.dataset.peer ? [num(el, 'peer')] : [] });
    case 'group-add':
      return groupPickerModal({ mode: 'add', roomId: num(el, 'room') });
    case 'group-rename':
      return renameGroup(num(el, 'room'));
    case 'group-call':
      return groupCall(num(el, 'room'));

    // --- голос и звонки
    case 'vc-join': {
      const roomId = num(el, 'room');
      const vcId = num(el, 'vc');
      const voice = allVoiceChannels(S.details.get(roomId)).find((c) => c.id === vcId);
      if (voice && !channelAllows(roomId, voice, 'connect')) {
        toast('Нет права подключаться к этому каналу', 'error');
        return;
      }
      await vcJoin(vcId, roomId);
      return;
    }
    case 'vc-leave':
      return vcLeave();
    case 'vc-ping':
      toast(V.pingMs == null ? 'Пинг ещё измеряется' : `Пинг: ${V.pingMs} мс`);
      return;
    case 'call-start':
      return callStart(num(el, 'peer'));
    case 'call-hangup':
      return callHangup();
    case 'call-accept': {
      const peer = C.peerId;
      await callAccept();
      if (peer && !(S.view.kind === 'dm' && S.view.peerId === peer)) await openDm(peer);
      return;
    }
    case 'call-decline':
      return callDecline();
    case 'toggle-mute':
      return toggleMute();
    case 'toggle-deafen':
      return toggleDeafen();
    case 'audio-settings':
      return audioSettingsModal();
    case 'dev-menu':
      e.stopPropagation();
      return deviceMenu(el, el.dataset.kind === 'out' ? 'out' : 'in');

    // --- правая панель
    case 'toggle-profile':
    case 'toggle-members': {
      S.ui.asidePanel = null;
      if (act === 'toggle-profile') S.ui.profileOpen = !S.ui.profileOpen;
      else S.ui.membersOpen = !S.ui.membersOpen;
      saveUi();
      invalidate('aside', 'header');
      return;
    }
    case 'toggle-pins':
      if (S.ui.asidePanel?.kind === 'pins') {
        S.ui.asidePanel = null;
        invalidate('aside', 'header');
        return;
      }
      return loadAsideList('pins');
    case 'aside-close':
      S.ui.asidePanel = null;
      invalidate('aside', 'header');
      return;
    case 'user': {
      const uid = num(el, 'uid');
      if (uid) openUserPopout(uid, el, { x: e.clientX, y: e.clientY });
      return;
    }
    case 'full-profile':
      closeUserPopout();
      S.api.openUserProfile?.(num(el, 'uid'));
      return;
    case 'mutual-servers':
      return mutualModal(num(el, 'uid'), 'servers');
    case 'mutual-friends':
      return mutualModal(num(el, 'uid'), 'friends');
    case 'open-url':
    case 'download':
      if (el.dataset.href) void S.api.openExternal?.(el.dataset.href);
      return;
    case 'attach-menu': {
      const menu = el.parentElement?.querySelector('.cv2-plus__menu');
      const open = !menu?.classList.contains('is-open');
      document.querySelectorAll('.cv2-plus__menu.is-open').forEach((n) => n.classList.remove('is-open'));
      menu?.classList.toggle('is-open', open);
      el.setAttribute('aria-expanded', open ? 'true' : 'false');
      return;
    }
    case 'share-build':
      closePlusMenus();
      void pickBuildAndSend();
      return;
    case 'share-server':
      closePlusMenus();
      void pickShareAndSend('server');
      return;
    case 'share-mod':
      closePlusMenus();
      void pickShareAndSend('mod');
      return;
    case 'world-open': {
      const ok = await openMyLanWorld();
      if (ok) invalidate('main', 'sidebar');
      return;
    }
    case 'world-close':
      await closeMyLanWorld();
      invalidate('main', 'sidebar');
      return;
    case 'world-invite':
      openWorldInviteModal();
      return;
    case 'world-token-join': {
      const raw = el.dataset.token || '';
      try {
        const meta = JSON.parse(decodeURIComponent(raw)) as Record<string, unknown>;
        const from = meta.from as { id?: string; username?: string } | undefined;
        void playSharedWorld(meta, from?.id ? { id: String(from.id), username: String(from.username || '') } : undefined);
      } catch {
        toast('Карточка мира повреждена', 'error');
      }
      return;
    }
    case 'open-share': {
      const raw = el.dataset.id || '';
      const sep = raw.indexOf(':');
      const kind = sep > 0 ? raw.slice(0, sep) : '';
      const id = sep > 0 ? raw.slice(sep + 1) : '';
      if (kind === 'build') openSharedBuild(id);
      else if (kind === 'post' || kind === 'mod' || kind === 'server') openSharedCard(kind, id);
      return;
    }
    case 'invite-copy':
      if (el.dataset.href) {
        try {
          await navigator.clipboard.writeText(el.dataset.href);
          toast('Адрес скопирован', 'success', 1600);
        } catch {
          toast('Не удалось скопировать', 'error');
        }
      }
      return;
    case 'invite-join': {
      const key = feedCtx()?.key;
      const msg = key ? conv(key).list.find((m) => sameId(m.id, el.dataset.mid)) : undefined;
      if (!msg?.meta) {
        toast('Приглашение не найдено', 'error');
        return;
      }
      void playSharedWorld(msg.meta, { id: '', username: msg.sender_username || '' });
      return;
    }

    // --- лента
    case 'jump':
      if (mid) await jumpTo(mid);
      return;
    case 'jump-bottom':
      return scrollFeedBottom();
    case 'spoiler':
      el.classList.add('is-revealed');
      return;
    case 'lightbox': {
      const nodes = Array.from(document.querySelectorAll<HTMLElement>('#cv2-feed [data-act="lightbox"]'));
      const list = (nodes.length ? nodes : [el]).map((n) => ({ src: n.dataset.src || '', alt: n.dataset.name || '' }));
      openImageViewer(list, Math.max(0, nodes.indexOf(el)), 'chat');
      return;
    }
    case 'video': {
      const nodes = Array.from(document.querySelectorAll<HTMLElement>('#cv2-feed [data-act="video"]'));
      const list = (nodes.length ? nodes : [el]).map((n) => ({ src: n.dataset.src || '', alt: n.dataset.name || '' }));
      openVideoViewer(list, Math.max(0, nodes.indexOf(el)), 'chat');
      return;
    }
    case 'react':
      if (feedCtx()?.noReact) {
        toast('Нет права ставить реакции в этом канале', 'error');
        return;
      }
      if (key && mid) await react(key, mid, String(el.dataset.emoji));
      return;
    case 'react-pick':
      if (feedCtx()?.noReact) {
        toast('Нет права ставить реакции в этом канале', 'error');
        return;
      }
      if (key && mid) openEmojiPicker(el, (emoji) => void react(key, mid, emoji), { side: 'left' });
      return;
    case 'msg-reply': {
      const m = key && mid ? msgById(key, mid) : undefined;
      if (!m || !key) return;
      S.ui.replyTo = { key, msg: m };
      invalidate('composer');
      return;
    }
    case 'reply-cancel':
      S.ui.replyTo = null;
      invalidate('composer');
      return;
    case 'msg-edit':
      if (key && mid) startEdit(key, mid);
      return;
    case 'edit-save':
      return saveEdit();
    case 'edit-cancel':
      return cancelEdit();
    case 'msg-pin': {
      const m = key && mid ? msgById(key, mid) : undefined;
      if (m && key) {
        await pinMessage(key, m.id, !m.is_pinned);
        toast(m.is_pinned ? 'Сообщение откреплено' : 'Сообщение закреплено', 'success', 1800);
      }
      return;
    }
    case 'msg-unpin':
      e.stopPropagation();
      if (key && mid) await pinMessage(key, mid, false);
      return;
    case 'msg-forward': {
      const m = key && mid ? msgById(key, mid) : undefined;
      if (m) forwardModal(m);
      return;
    }
    case 'msg-more': {
      const m = key && mid ? msgById(key, mid) : undefined;
      if (m && key) openMenu(msgMenu(key, m), el, { align: 'end' });
      return;
    }
    case 'msg-retry':
      if (key && mid) await retry(key, mid);
      return;
    case 'msg-discard':
      if (key && mid) discard(key, mid);
      return;

    // --- композер
    case 'attach':
      if (feedCtx()?.noFiles) {
        toast('Нет права прикреплять файлы в этом канале', 'error');
        return;
      }
      closePlusMenus();
      document.querySelector<HTMLInputElement>('#cv2-root [data-input="file"]')?.click();
      return;
    case 'emoji': {
      const ta = composerEl();
      if (ta) openEmojiPicker(el, (emoji) => insertAtCaret(ta, emoji), { keepOpen: true });
      return;
    }
    case 'link': {
      const ta = composerEl();
      if (!ta || ta.disabled) return;
      const start = ta.selectionStart ?? ta.value.length;
      const end = ta.selectionEnd ?? start;
      const selected = ta.value.slice(start, end).trim() || 'ссылка';
      const chunk = `[${selected}](https://)`;
      ta.value = ta.value.slice(0, start) + chunk + ta.value.slice(end);
      const urlStart = start + selected.length + 3;
      ta.setSelectionRange(urlStart, urlStart + 'https://'.length);
      ta.focus();
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    case 'sticker':
      void openStickerPicker(el);
      return;
    case 'voice':
      void toggleVoice(el);
      return;
    default:
  }
}

// ===== Контекстные меню =====

function muteChannelItems(siteId: string): MenuItem[] {
  if (!siteId) return [{ label: 'Недоступно', disabled: true }];
  if (isChannelMuted(siteId)) {
    return [
      {
        label: 'Включить уведомления',
        onClick: () => {
          unmuteChannel(siteId);
          toast('Уведомления канала включены');
          invalidate('sidebar');
        },
      },
    ];
  }
  const pick = (ms: number, label: string): MenuItem => ({
    label,
    onClick: () => {
      muteChannel(siteId, ms);
      toast('Канал заглушён');
      invalidate('sidebar');
    },
  });
  return [pick(15 * 60e3, 'На 15 минут'), pick(3600e3, 'На 1 час'), pick(3 * 3600e3, 'На 3 часа'), pick(8 * 3600e3, 'На 8 часов'), pick(24 * 3600e3, 'На 24 часа'), pick(0, 'Пока не включу')];
}

async function copyServerLink(roomId: number): Promise<void> {
  try {
    const exp = new Date(Date.now() + 7 * 864e5).toISOString();
    const inv = unwrap<any>(await S.api.cloudCreateInvite?.(roomId, { expires_at: exp }));
    const text = String(inv?.url || inv?.code || '');
    if (!text) throw new Error('Не удалось создать ссылку');
    copyText(text);
    toast('Ссылка скопирована');
  } catch (err) {
    toast(errText(err), 'error');
  }
}

async function moveChannel(roomId: number, kind: 'text' | 'voice', id: number, categoryId: number | null, position: number): Promise<void> {
  const body = { category_id: categoryId, position };
  if (kind === 'voice') unwrap(await S.api.cloudUpdateVoiceChannel?.(roomId, id, body));
  else unwrap(await S.api.cloudUpdateTextChannel?.(roomId, id, body));
  await loadDetail(roomId);
  invalidate('sidebar');
}

function moveChannelItems(roomId: number, kind: 'text' | 'voice', id: number, categoryId: number | null, position: number): MenuItem[] {
  const cats = (S.details.get(roomId)?.categories || []).filter((c): c is Category & { id: number } => c.id != null);
  const go = (catId: number | null) => {
    void moveChannel(roomId, kind, id, catId, position).catch((err) => toast(errText(err), 'error'));
  };
  return [
    { label: 'Без категории', checked: categoryId == null, onClick: () => go(null) },
    ...cats.map((c): MenuItem => ({ label: c.name, checked: c.id === categoryId, onClick: () => go(c.id) })),
  ];
}

async function cloneListedChannel(roomId: number, kind: 'text' | 'voice', ch: TextChannel | VoiceChannel): Promise<void> {
  if (kind === 'voice') {
    const voice = ch as VoiceChannel;
    unwrap(await S.api.cloudCreateVoiceChannel?.(roomId, { name: `${voice.name} 2`, user_limit: voice.user_limit || 0, category_id: voice.category_id ?? null }));
  } else {
    const text = ch as TextChannel;
    unwrap(
      await S.api.cloudCreateTextChannel?.(roomId, {
        name: `${text.name}-2`,
        topic: text.topic || '',
        slowmode_seconds: text.slowmode_seconds || 0,
        channel_kind: text.channel_kind || 'text',
        category_id: text.category_id ?? null,
      }),
    );
  }
  await loadDetail(roomId);
  invalidate('sidebar');
  toast('Канал клонирован');
}

async function deleteListedChannel(roomId: number, kind: 'text' | 'voice', ch: TextChannel | VoiceChannel): Promise<void> {
  if (ch.is_default) {
    toast('Системный канал нельзя удалить', 'error');
    return;
  }
  if (!(await confirmDialog('Удалить канал', `Канал «${esc(ch.name)}» и его история будут удалены без возможности восстановления.`, 'Удалить канал'))) return;
  if (kind === 'voice') unwrap(await S.api.cloudDeleteVoiceChannel?.(roomId, ch.id));
  else unwrap(await S.api.cloudDeleteTextChannel?.(roomId, ch.id));
  await loadDetail(roomId);
  const v = S.view;
  if (v.kind === 'server' && (v.channelId === ch.id || v.voiceId === ch.id)) openServer(roomId);
  invalidate('sidebar', 'main');
}

function listedChannelMenu(roomId: number, kind: 'text' | 'voice', ch: TextChannel | VoiceChannel): MenuItem[] {
  const siteId = ch.site_id || '';
  const admin = canManage(roomId);
  const fav = isFavChannel(siteId);
  const pinned = isPinnedChannel(siteId);
  const level = channelNotify(siteId);
  const muted = isChannelMuted(siteId);
  const cat = ch.category_id != null ? S.details.get(roomId)?.categories?.find((c) => c.id === ch.category_id) : undefined;
  const items: MenuItem[] = [];
  if (kind === 'voice') {
    const joined = sameId(V.channelId, ch.id);
    items.push(
      joined
        ? { label: 'Отключиться', icon: IC.phoneOff(18), danger: true, onClick: () => void vcLeave() }
        : { label: 'Подключиться', icon: IC.speaker(18), onClick: () => void openVoice(roomId, ch.id) },
    );
  } else {
    items.push({
      label: 'Пометить как прочитанное',
      icon: IC.check(18),
      onClick: () => {
        S.chUnread.set(ch.id, { u: 0, m: 0 });
        void S.api.cloudAckChannel?.(roomId, ch.id);
        invalidate('sidebar', 'rail');
      },
    });
  }
  items.push(
    {
      label: fav ? 'Убрать из избранного' : 'Добавить в избранное',
      icon: IC.star(18),
      onClick: () => {
        const on = toggleFavChannel(siteId);
        toast(on ? 'Канал в избранном' : 'Канал убран из избранного');
        invalidate('sidebar');
      },
    },
    { label: 'Пригласить на канал', icon: IMG.addUser(18), onClick: () => inviteModal(roomId) },
    {
      label: pinned ? 'Открепить канал' : 'Закрепить канал вверху',
      icon: IMG.pin(18),
      onClick: () => {
        const on = togglePinnedChannel(siteId);
        toast(on ? 'Канал закреплён' : 'Канал откреплён');
        invalidate('sidebar');
      },
    },
  );
  if (!admin && cat?.site_id) {
    const hidden = isCatHidden(cat.site_id);
    items.push({
      label: hidden ? 'Подписаться на категорию' : 'Отписаться от категории каналов',
      icon: hidden ? IC.eye(18) : IC.eyeOff(18),
      onClick: () => {
        const off = toggleCatHidden(cat.site_id || '');
        toast(off ? 'Категория скрыта' : 'Категория снова в списке');
        invalidate('sidebar');
      },
    });
  }
  items.push(
    { label: 'Копировать ссылку', icon: IC.link(18), onClick: () => void copyServerLink(roomId) },
    'sep',
    { label: 'Заглушить канал', icon: VCI.soundOff(18), sub: muteChannelItems(siteId) },
    {
      label: 'Параметры уведомлений',
      icon: IC.bell(18),
      hint: notifyHint(level, muted),
      sub: notifyItems(level, (next) => {
        setChannelNotify(siteId, next);
        toast('Параметры уведомлений сохранены');
      }),
    },
  );
  if (admin) {
    items.push(
      'sep',
      { label: 'Переместить…', icon: IMG.forward(18), sub: moveChannelItems(roomId, kind, ch.id, ch.category_id ?? null, ch.position || 0) },
      'sep',
      {
        label: 'Настроить канал',
        icon: IC.gear(18),
        onClick: () => channelModal(kind === 'voice' ? { kind: 'voice', roomId, ch: ch as VoiceChannel } : { kind: 'text', roomId, ch: ch as TextChannel }),
      },
      {
        label: 'Клонировать канал',
        icon: IMG.copy(18),
        onClick: () => void cloneListedChannel(roomId, kind, ch).catch((err) => toast(errText(err), 'error')),
      },
    );
    if (!ch.is_default) {
      items.push({
        label: 'Удалить канал',
        icon: IC.trash(18),
        danger: true,
        onClick: () => void deleteListedChannel(roomId, kind, ch).catch((err) => toast(errText(err), 'error')),
      });
    }
  }
  items.push('sep', { label: 'Копировать ID канала', icon: IMG.copyid(18), onClick: () => copyText(siteId || String(ch.id)) });
  return items;
}

function onContext(e: MouseEvent): void {
  const t = e.target as HTMLElement;
  // В полях ввода оставляем системное меню (копировать/вставить)
  if (t.closest('input, textarea')) return;
  const el = t.closest<HTMLElement>('[data-ctx], [data-rail-id]');
  if (!el) return;
  e.preventDefault();
  const at = { x: e.clientX, y: e.clientY };
  if (el.dataset.railId) {
    openMenu(serverMenu(Number(el.dataset.railId)), at);
    return;
  }
  const kind = el.dataset.ctx;
  const v = S.view;
  const roomId = v.kind === 'server' || v.kind === 'group' ? v.roomId : undefined;
  if (kind === 'msg') {
    const key = currentKey();
    const m = key && el.dataset.mid ? msgById(key, el.dataset.mid) : undefined;
    if (m && key && !m.pending) openMenu(msgMenu(key, m), at);
    return;
  }
  if (kind === 'dm') {
    const peer = Number(el.dataset.peer);
    const items = userMenu(peer);
    items.splice(3, 0, 'sep', {
      label: 'Отметить как прочитанное',
      icon: IC.check(16),
      onClick: () => ack(`dm:${peer}`),
    }, {
      label: 'Закрыть ЛС',
      icon: IC.close(16),
      onClick: () => {
        setDmHidden(peer, true);
        if (S.view.kind === 'dm' && S.view.peerId === peer) openFriends();
        invalidate('sidebar', 'rail');
      },
    });
    openMenu(items, at);
    return;
  }
  if (kind === 'friend' || kind === 'member') {
    openMenu(userMenu(Number(el.dataset.uid), { roomId: kind === 'member' ? Number(el.dataset.room) || roomId : undefined }), at);
    return;
  }
  if (kind === 'voice-user') {
    openMenu(userMenu(Number(el.dataset.uid), { roomId: V.roomId || roomId, voice: true }), at);
    return;
  }
  if (kind === 'group') {
    const gid = Number(el.dataset.room);
    const owner = isRoomOwner(gid);
    openMenu(
      [
        { label: 'Отметить как прочитанное', icon: IC.check(16), onClick: () => markServerRead(gid) },
        { label: 'Изменить название', icon: IMG.edit(16), onClick: () => void renameGroup(gid) },
        ...(owner ? [{ label: 'Добавить друзей', icon: IMG.addUser(16), onClick: () => groupPickerModal({ mode: 'add', roomId: gid }) }] : []),
        'sep',
        { label: 'Покинуть группу', icon: IC.logout(16), danger: true, onClick: () => void leaveServer(gid) },
      ],
      at,
    );
    return;
  }
  if (kind === 'channel' && roomId) {
    const ch = allTextChannels(S.details.get(roomId)).find((c) => c.id === Number(el.dataset.ch));
    if (!ch) return;
    openMenu(listedChannelMenu(roomId, 'text', ch), at);
    return;
  }
  if (kind === 'voice' && roomId) {
    const ch = allVoiceChannels(S.details.get(roomId)).find((c) => c.id === Number(el.dataset.vc));
    if (!ch) return;
    openMenu(listedChannelMenu(roomId, 'voice', ch), at);
    return;
  }
  if (kind === 'category' && roomId) {
    const catId = Number(el.dataset.cat);
    const cat = S.details.get(roomId)?.categories?.find((c) => c.id === catId);
    const k = String(el.dataset.key);
    const items: MenuItem[] = [
      {
        label: 'Свернуть категорию',
        checked: S.ui.collapsed.has(k),
        onClick: () => {
          if (S.ui.collapsed.has(k)) S.ui.collapsed.delete(k);
          else S.ui.collapsed.add(k);
          saveUi();
          invalidate('sidebar');
        },
      },
    ];
    if (canManage(roomId)) {
      items.push(
        'sep',
        { label: 'Создать текстовый канал', icon: channelMark('text', 16), onClick: () => channelModal({ kind: 'text', roomId, catId }) },
        { label: 'Создать голосовой канал', icon: channelMark('voice', 16), onClick: () => channelModal({ kind: 'voice', roomId, catId }) },
        ...(cat ? [{ label: 'Настроить категорию', icon: IC.gear(16), onClick: () => channelModal({ kind: 'category', roomId, cat: { id: catId, name: cat.name } }) }] : []),
      );
    }
    openMenu(items, at);
  }
}

async function renameGroup(roomId: number): Promise<void> {
  const r = roomById(roomId);
  const name = await promptDialog('Название группы', 'Название', r?.custom_name ? r.name : '', { placeholder: r?.name, max: 60, sub: 'Оставьте пустым, чтобы показывать имена участников.' });
  if (name == null) return;
  try {
    unwrap(await S.api.cloudGroupRename?.(roomId, name));
    await loadLists();
    invalidate('sidebar', 'main', 'rail');
  } catch (err) {
    toast(errText(err), 'error');
  }
}

// ===== Поля ввода =====

const saveDraft = debounce((key: ConvKey, v: string) => {
  if (v) S.ui.drafts.set(key, v);
  else S.ui.drafts.delete(key);
}, 200);

const runSearch = debounce((q: string) => {
  if (q.trim().length >= 2) void loadAsideList('search', q.trim());
}, 400);

function onInput(e: Event): void {
  const t = e.target as HTMLElement;
  const name = (t as HTMLElement).dataset.input;
  if (!name) return;
  if (name === 'composer') {
    const ta = t as HTMLTextAreaElement;
    autosize(ta);
    const key = currentKey();
    if (key) {
      saveDraft(key, ta.value);
      if (ta.value.trim()) sendTyping(key);
    }
    updateSuggest(ta);
    return;
  }
  if (name === 'edit') {
    autosize(t as HTMLTextAreaElement);
    return;
  }
  if (name === 'friends-q') {
    S.ui.friendsQuery = (t as HTMLInputElement).value;
    const pos = (t as HTMLInputElement).selectionStart;
    invalidate('main');
    // После перерисовки возвращаем фокус в поле поиска
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const inp = document.querySelector<HTMLInputElement>('#cv2-root [data-input="friends-q"]');
        if (inp && document.activeElement !== inp) {
          inp.focus();
          if (pos != null) inp.setSelectionRange(pos, pos);
        }
      }),
    );
    return;
  }
  if (name === 'add-friend') {
    const btn = document.querySelector<HTMLButtonElement>('#cv2-root [data-add-friend-btn]');
    if (btn) btn.disabled = !(t as HTMLInputElement).value.trim();
    if (S.ui.addFriendStatus) {
      S.ui.addFriendStatus = null;
      t.closest('.cv2-addfriend__box')?.classList.remove('is-ok', 'is-err');
      document.querySelector('#cv2-root .cv2-addfriend__status')?.remove();
    }
    return;
  }
  if (name === 'chat-search') {
    const q = (t as HTMLInputElement).value;
    if (!q.trim() && S.ui.asidePanel?.kind === 'search') {
      S.ui.asidePanel = null;
      invalidate('aside');
      return;
    }
    runSearch(q);
  }
}

async function onSubmit(e: Event): Promise<void> {
  const form = e.target as HTMLFormElement;
  const kind = form.dataset.form;
  if (!kind) return;
  e.preventDefault();
  if (kind === 'add-friend') {
    const inp = form.querySelector<HTMLInputElement>('[data-input="add-friend"]');
    const name = (inp?.value.trim() || '').replace(/^@/, '');
    if (!name) return;
    try {
      unwrap(await S.api.cloudFriendRequest?.(/^\d+$/.test(name) ? { user_id: Number(name) } : { username: name }));
      await loadFriends();
      const accepted = isFriend(S.friends.friends.find((f) => f.username.toLowerCase() === name.toLowerCase())?.id || 0);
      S.ui.addFriendStatus = { ok: true, text: accepted ? `Готово! Вы теперь друзья с ${name}.` : `Готово! Вы отправили заявку в друзья пользователю ${name}.` };
    } catch (err) {
      S.ui.addFriendStatus = { ok: false, text: errText(err) };
    }
    invalidate('main', 'badge');
    return;
  }
  if (kind === 'join-code') {
    const code = form.querySelector<HTMLInputElement>('[data-input="join-code"]')?.value.trim();
    if (code) joinServerModal(code);
  }
}

function onKey(e: KeyboardEvent): void {
  const t = e.target as HTMLElement;
  const name = t.dataset?.input;
  if (name === 'composer') {
    const ta = t as HTMLTextAreaElement;
    if (suggest) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        suggest.sel = (suggest.sel + (e.key === 'ArrowDown' ? 1 : -1) + suggest.items.length) % suggest.items.length;
        paintSuggest();
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        applySuggest(ta, suggest.sel);
        return;
      }
      if (e.key === 'Escape') {
        suggest = null;
        paintSuggest();
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      void submitComposer(ta);
      return;
    }
    if (e.key === 'Escape' && S.ui.replyTo) {
      S.ui.replyTo = null;
      invalidate('composer');
      return;
    }
    // Стрелка вверх в пустом поле — правка последнего своего сообщения, как в Discord
    if (e.key === 'ArrowUp' && !ta.value) {
      const key = currentKey();
      if (!key) return;
      const list = conv(key).list;
      for (let i = list.length - 1; i >= 0; i--) {
        const m = list[i]!;
        if (sameId(m.sender_id, S.me.id) && !m.pending && !m.is_system) {
          e.preventDefault();
          startEdit(key, m.id);
          return;
        }
      }
    }
    return;
  }
  if (name === 'edit') {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void saveEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancelEdit();
    }
    return;
  }
  if (name === 'chat-search' && e.key === 'Enter') {
    e.preventDefault();
    const q = (t as HTMLInputElement).value.trim();
    if (q) void loadAsideList('search', q);
    return;
  }
  if (name === 'chat-search' && e.key === 'Escape') {
    (t as HTMLInputElement).value = '';
    S.ui.asidePanel = null;
    invalidate('aside', 'header');
    return;
  }
  if ((e.key === 'Enter' || e.key === ' ') && t.getAttribute('role') === 'button' && t.dataset.act) {
    e.preventDefault();
    t.click();
  }
}

// ===== Файлы =====

function filesFrom(list: FileList | null | undefined): File[] {
  return list ? Array.from(list) : [];
}

let voiceRec: MediaRecorder | null = null;

async function toggleVoice(btn: HTMLElement): Promise<void> {
  const ctx = feedCtx();
  if (!ctx || ctx.readOnly) return;
  if (voiceRec) {
    if (voiceRec.state !== 'inactive') voiceRec.stop();
    return;
  }
  const box = btn.closest<HTMLElement>('.cv2-composer');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks: BlobPart[] = [];
    const rec = new MediaRecorder(stream);
    voiceRec = rec;
    box?.classList.add('is-recording');
    btn.classList.add('is-on');
    rec.ondataavailable = (ev) => {
      if (ev.data.size) chunks.push(ev.data);
    };
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      voiceRec = null;
      box?.classList.remove('is-recording');
      btn.classList.remove('is-on');
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
      if (blob.size < 800) {
        toast('Слишком короткая запись', 'error', 1600);
        return;
      }
      const file = new File([blob], `voice_${Date.now()}.webm`, { type: blob.type || 'audio/webm' });
      void uploadAndSend(ctx.key, [file], '');
    };
    rec.start();
  } catch {
    voiceRec = null;
    box?.classList.remove('is-recording');
    toast('Нет доступа к микрофону', 'error');
  }
}

function sendFiles(files: File[]): void {
  const ctx = feedCtx();
  if (!ctx || ctx.readOnly || !files.length) return;
  const ta = composerEl();
  const caption = ta?.value || '';
  if (ta) {
    ta.value = '';
    autosize(ta);
  }
  void uploadAndSend(ctx.key, files, caption);
}

// ===== Привязка =====

function closePlusMenus(): void {
  document.querySelectorAll('.cv2-plus__menu.is-open').forEach((n) => n.classList.remove('is-open'));
  document.querySelectorAll<HTMLElement>('[data-act="attach-menu"]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
}

async function pickBuildAndSend(): Promise<void> {
  const key = currentKey();
  const builds = chatLocalBuilds();
  if (!key) return;
  if (!builds.length) {
    toast('Локальных сборок нет', 'error');
    return;
  }
  openModal({
    title: 'Отправить сборку',
    sub: 'В чат уйдёт карточка, не ссылка текстом',
    width: 420,
    body: `<div class="cv2-picks">${builds
      .map(
        (b) =>
          `<button type="button" class="cv2-sharepick" data-build="${esc(b.id)}"><b>${esc(b.name)}</b><span>${esc(b.meta)}</span></button>`,
      )
      .join('')}</div>`,
    actions: [{ label: 'Отмена', kind: 'ghost' }],
    onMount: (box, close) => {
      box.querySelectorAll<HTMLButtonElement>('[data-build]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.build || '';
          const name = builds.find((b) => b.id === id)?.name || 'Сборка';
          close();
          void (async () => {
            toast('Готовим карточку сборки…');
            const res = await createBuildShareLink(id);
            if (!res.ok || !res.id) {
              toast('Не удалось подготовить сборку', 'error');
              return;
            }
            await sendText(key, `#ucard:build:${res.id}:${encodeURIComponent(res.name || name)}`);
          })();
        });
      });
    },
  });
}

async function pickShareAndSend(kind: 'mod' | 'server'): Promise<void> {
  const key = currentKey();
  if (!key) return;
  const hit = await pickCatalogShare(kind);
  if (!hit) return;
  if (kind === 'mod') await sendText(key, `#ucard:mod:${hit.id}:${encodeURIComponent(hit.title)}`);
  else await sendText(key, `#ucard:server:${encodeURIComponent(hit.id)}:${encodeURIComponent(hit.title)}`);
}

function openWorldInviteModal(): void {
  const friends = S.friends.friends
    .map((f) => ({ id: f.id, site: S.userKeys.get(f.id) || '', name: userOf(f.id).username || f.username }))
    .filter((f) => f.site);
  if (!friends.length) {
    toast('Список друзей пуст', 'error');
    return;
  }
  const send = async (ids: string[]) => {
    const n = await inviteLanFriends(ids);
    if (n) invalidate('sidebar');
    return n > 0;
  };
  openModal({
    title: 'Пригласить друзей',
    sub: 'Карточка мира придёт в личные сообщения. Остальные увидят мир на экране «Миры по сети».',
    width: 420,
    body: `<div class="cv2-checks">${friends
      .map(
        (f) =>
          `<label class="cv2-friend"><input type="checkbox" data-site="${esc(f.site)}" checked><span>${esc(f.name)}</span></label>`,
      )
      .join('')}</div>`,
    actions: [
      { label: 'Отмена', kind: 'ghost' },
      {
        label: 'Выбранных',
        kind: 'primary',
        onClick: async (box) => {
          const ids = Array.from(box.querySelectorAll<HTMLInputElement>('input[data-site]:checked')).map((el) => el.dataset.site || '');
          if (!ids.length) {
            toast('Отметьте хотя бы одного друга', 'error');
            return false;
          }
          return send(ids);
        },
      },
      {
        label: 'Всех',
        kind: 'primary',
        onClick: () => send(friends.map((f) => f.site)),
      },
    ],
  });
}

export function bindActions(root: HTMLElement): void {
  const onClick = (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    if (!t.closest('.cv2-plus')) closePlusMenus();
    const sug = t.closest<HTMLElement>('[data-suggest-i]');
    if (sug) {
      const ta = composerEl();
      if (ta) applySuggest(ta, Number(sug.dataset.suggestI));
      return;
    }
    const el = t.closest<HTMLElement>('[data-act]');
    const link = t.closest<HTMLAnchorElement>('a[data-href]');
    if (link && (!el || !link.contains(el))) {
      e.preventDefault();
      void S.api.openExternal?.(String(link.dataset.href));
      return;
    }
    if (!el || (el as HTMLButtonElement).disabled) return;
    void onAct(el, e).catch((err) => toast(errText(err), 'error'));
  };
  root.addEventListener('click', onClick);
  bindChannelDrag(root);
  // Действия внутри всплывающей карточки пользователя (она живёт в слое оверлеев)
  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (!t.closest('.cv2-popout') || root.contains(t)) return;
    onClick(e);
  });
  root.addEventListener('contextmenu', onContext);
  root.addEventListener('input', onInput);
  root.addEventListener('keydown', onKey);
  root.addEventListener('submit', (e) => void onSubmit(e));
  root.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.input !== 'file') return;
    sendFiles(filesFrom(t.files));
    t.value = '';
  });
  root.addEventListener('paste', (e) => {
    const t = e.target as HTMLElement;
    if (t.dataset.input !== 'composer') return;
    const files = filesFrom(e.clipboardData?.files);
    if (files.length) {
      e.preventDefault();
      sendFiles(files);
    }
  });

  // Перетаскивание файлов в беседу
  let dragDepth = 0;
  const hasFiles = (e: DragEvent) => Boolean(e.dataTransfer && [...e.dataTransfer.types].includes('Files'));
  root.addEventListener('dragenter', (e) => {
    if (!hasFiles(e) || !feedCtx()) return;
    dragDepth++;
    root.querySelector('.cv2-chat')?.classList.add('is-dropping');
  });
  root.addEventListener('dragover', (e) => {
    if (hasFiles(e) && feedCtx()) e.preventDefault();
  });
  root.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) root.querySelector('.cv2-chat')?.classList.remove('is-dropping');
  });
  root.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    root.querySelector('.cv2-chat')?.classList.remove('is-dropping');
    sendFiles(filesFrom(e.dataTransfer?.files));
  });

  // Прокрутка ленты: догрузка истории, кнопка «к последним», прочтение
  root.addEventListener(
    'scroll',
    (e) => {
      const el = e.target as HTMLElement;
      if (el.id !== 'cv2-feed') return;
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      el.dataset.stick = nearBottom ? '1' : '0';
      if (el.scrollTop < 400) void loadOlder();
      updateJump(el);
      closeUserPopout();
    },
    true,
  );

  // Глобальные горячие клавиши, пока открыта вкладка чатов
  document.addEventListener('keydown', (e) => {
    if (!root.isConnected || root.offsetParent === null) return;
    if (document.querySelector('[data-cv2-modal]')) return;
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K' || e.key === 'л' || e.key === 'Л')) {
      e.preventDefault();
      quickSwitcher();
      return;
    }
    const t = e.target as HTMLElement;
    const typing = t.closest('input, textarea, select, [contenteditable]');
    if (e.key === 'Escape' && !typing) {
      if (S.ui.asidePanel) {
        S.ui.asidePanel = null;
        invalidate('aside', 'header');
      } else if (S.ui.mobileSidebar) {
        S.ui.mobileSidebar = false;
        invalidate('layout');
      }
      return;
    }
    // Печать с любого места фокусирует поле сообщения
    if (!typing && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && feedCtx()) {
      const ta = composerEl();
      if (ta && !ta.disabled) ta.focus();
    }
  });
}

export { feedEl };
