// Обработка WS-событий мастера для чатов v2: сообщения, правки, реакции, закрепы, «печатает», соцграф, голос и звонки.
import {
  S,
  activeKey,
  aggReactions,
  allTextChannels,
  allVoiceChannels,
  chKey,
  conv,
  dmKey,
  invalidate,
  loadDetail,
  loadFriends,
  loadInbox,
  loadLists,
  loadMembers,
  normMsg,
  rememberUser,
  roomById,
  shouldPlayMessageSound,
  userOf,
} from './store';
import { callHangup, handleCall, handleVc, noteServerPing, vcLeave } from './rtc';
import { playGsSound } from './sounds';
import { toast } from './overlays';
import { ack, failLastPending, loadAsideList, openFriends, resolvePending } from './nav';
import { setDmHidden } from './views/sidebar';
import { appendToFeed, feedCtx, paintTyping, patchInFeed, removeFromFeed } from './views/chat';
import { refreshUserPopout } from './views/aside';
import { sameId } from './util';
import type { ConvKey, Message } from './types';

// ===== Видимость и звуки =====

let presence = 'online';

export function setPresence(status: string): void {
  presence = status;
}

/** Беседа реально перед глазами: вкладка «Чаты» открыта и окно в фокусе. */
export function isWatching(key: ConvKey): boolean {
  return chatsTabActive() && document.hasFocus() && activeKey() === key;
}

export function chatsTabActive(): boolean {
  // Отдельное окно — это и есть чат, вкладки приложения там нет
  if (document.documentElement.classList.contains('gs-chat-popout') || document.body.classList.contains('gs-chat-popout')) return true;
  const tab = document.getElementById('tab-messenger') || document.getElementById('tab-chats');
  return Boolean(tab && (tab.classList.contains('active') || tab.offsetParent !== null));
}

function sound(): void {
  if (presence === 'dnd' || presence === 'invisible') return;
  playGsSound('message');
}

function chatNotice(stage: string, detail: string): void {
  const text = detail.replace(/\s+/g, ' ').trim().slice(0, 180);
  window.dispatchEvent(new CustomEvent('uclient-task', {
    detail: {
      id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: 'Чат',
      stage,
      detail: text || 'Новое сообщение',
      percent: null,
      tone: 'chat',
      settled: true,
    },
  }));
}

function siteChannelId(raw: any): string {
  const direct = String(raw?.channelId || '');
  if (direct.includes('-')) return direct;
  const n = Number(raw?.channel_id);
  if (!n) return '';
  for (const d of S.details.values()) {
    const hit = [...allTextChannels(d), ...allVoiceChannels(d)].find((c) => c.id === n);
    if (hit?.site_id) return hit.site_id;
  }
  return '';
}

// ===== «Печатает» =====

const TYPING_MS = 8000;

function setTyping(key: ConvKey, uid: number, on: boolean): void {
  let map = S.typing.get(key);
  if (!map) {
    map = new Map();
    S.typing.set(key, map);
  }
  if (on) map.set(uid, Date.now() + TYPING_MS);
  else map.delete(uid);
  paintTyping(key);
  if (on) window.setTimeout(() => paintTyping(key), TYPING_MS + 50);
}

// ===== Новые сообщения =====

function lastOf(m: Message) {
  return { text: m.text, sender_username: m.sender_username, created_at: m.created_at };
}

function deliver(key: ConvKey, m: Message): 'active' | 'background' {
  const c = conv(key);
  const mine = sameId(m.sender_id, S.me.id);
  if (m.sender_id) setTyping(key, m.sender_id, false);
  if (c.loaded) {
    if (c.list.some((x) => sameId(x.id, m.id))) return activeKey() === key ? 'active' : 'background';
    const resolved = mine && resolvePending(key, m);
    const ctx = feedCtx();
    if (resolved) {
      if (ctx?.key === key) invalidate('feed');
    } else {
      c.list.push(m);
      if (ctx?.key === key) appendToFeed(ctx, m);
    }
  }
  return activeKey() === key ? 'active' : 'background';
}

function onDm(raw: Record<string, any>): void {
  const m = normMsg(raw);
  const mine = sameId(m.sender_id, S.me.id);
  const peer = Number(mine ? raw.receiver_id : raw.sender_id);
  if (!peer) return;
  const key = dmKey(peer);
  let d = S.dms.find((x) => x.peer_id === peer);
  if (!d) {
    const u = userOf(peer);
    d = { peer_id: peer, peer_username: mine ? u.username : m.sender_username, peer_avatar_url: mine ? u.avatar_url : m.sender_avatar_url, peer_avatar_color: mine ? u.avatar_color : m.sender_avatar_color, unread_count: 0 };
    S.dms.unshift(d);
  }
  d.last_message = lastOf(m);
  deliver(key, m);
  if (!mine) {
    setDmHidden(peer, false);
    if (isWatching(key)) ack(key);
    else d.unread_count = (d.unread_count || 0) + 1;
  }
  invalidate('rail', 'sidebar', 'badge');
  window.dispatchEvent(new CustomEvent('gs-home-chats'));
}

function onRoom(raw: Record<string, any>): void {
  const roomId = Number(raw.room_id);
  const room = roomById(roomId);
  // Мастер рассылает room_message всем — чужие серверы пропускаем
  if (!room) return;
  const m = normMsg(raw);
  const chId = Number(raw.channel_id);
  if (!chId) return;
  const key = chKey(chId);
  const mine = sameId(m.sender_id, S.me.id);
  room.last_message = lastOf(m);
  deliver(key, m);
  if (!mine && !m.is_system) {
    if (isWatching(key)) ack(key);
    else {
      const mention = Boolean(S.me.id && m.mentioned_user_ids?.includes(S.me.id));
      const un = S.chUnread.get(chId) || { u: 0, m: 0 };
      S.chUnread.set(chId, { u: un.u + 1, m: un.m + (mention ? 1 : 0) });
      room.unread_count = (room.unread_count || 0) + 1;
      if (mention || room.kind === 'group') room.mention_count = (room.mention_count || 0) + (mention ? 1 : 0);
    }
  }
  invalidate('rail', 'sidebar', 'badge');
  window.dispatchEvent(new CustomEvent('gs-home-chats'));
}

// ===== Изменения существующих сообщений =====

/** Ключ беседы по событию: DM — по паре собеседников, канал — по channel_id, иначе ищем по id. */
function keyFor(raw: Record<string, any>, dm: boolean): ConvKey | null {
  const cid = raw.message_id ?? raw.id;
  const holds = (key: ConvKey | null) => Boolean(key && conv(key).list.some((m) => sameId(m.id, cid)));
  if (!dm) {
    const direct = raw.channel_id ? chKey(Number(raw.channel_id)) : null;
    if (holds(direct)) return direct;
    for (const [k, c] of S.convs) if (k.startsWith('ch:') && c.list.some((m) => sameId(m.id, cid))) return k;
    return direct;
  }
  // Своё удаление в личке приходило с receiver = я, и сообщение оставалось в чужой беседе.
  if (raw.sender_id != null && raw.receiver_id != null) {
    const peer = sameId(raw.sender_id, S.me.id) ? Number(raw.receiver_id) : Number(raw.sender_id);
    const key = dmKey(peer);
    if (holds(key)) return key;
  }
  for (const [k, c] of S.convs) if (k.startsWith('dm:') && c.list.some((m) => sameId(m.id, cid))) return k;
  return null;
}

function withMsg(raw: Record<string, any>, dm: boolean, fn: (m: Message, key: ConvKey) => void): void {
  const key = keyFor(raw, dm);
  if (!key) return;
  const id = raw.message_id ?? raw.id;
  const m = conv(key).list.find((x) => sameId(x.id, id));
  if (!m) return;
  fn(m, key);
  const ctx = feedCtx();
  if (ctx?.key === key) patchInFeed(ctx, m.id);
}

function onEdited(raw: Record<string, any>, dm: boolean): void {
  withMsg(raw, dm, (m) => {
    m.text = String(raw.text ?? m.text);
    m.edited_at = raw.edited_at ?? new Date().toISOString();
  });
}

function onDeleted(raw: Record<string, any>, dm: boolean): void {
  const key = keyFor(raw, dm);
  if (!key) return;
  const c = conv(key);
  const id = raw.message_id ?? raw.id;
  if (!c.list.some((m) => sameId(m.id, id))) return;
  c.list = c.list.filter((m) => !sameId(m.id, id));
  const ctx = feedCtx();
  if (ctx?.key === key) removeFromFeed(ctx, id);
  if (S.ui.replyTo && sameId(S.ui.replyTo.msg.id, id)) {
    S.ui.replyTo = null;
    invalidate('main');
  }
}

function onReaction(raw: Record<string, any>, dm: boolean): void {
  withMsg(raw, dm, (m) => {
    m.reactions = aggReactions(raw.reactions, raw.reactions_agg);
  });
}

function onPinned(raw: Record<string, any>, dm: boolean): void {
  withMsg(raw, dm, (m) => {
    m.is_pinned = Boolean(raw.is_pinned);
  });
  if (S.ui.asidePanel?.kind === 'pins') void loadAsideList('pins');
}

// ===== Соцграф =====

async function onFriends(raw: Record<string, any>): Promise<void> {
  const ev = String(raw.event || '');
  if (raw.user) rememberUser(raw.user);
  await loadFriends();
  S.mutuals.clear();
  invalidate('sidebar', 'main', 'aside', 'badge', 'rail');
  refreshUserPopout();
  const name = raw.user?.username || 'Пользователь';
  if (ev === 'request' && !raw.self) {
    sound();
    toast(`${name} хочет добавить вас в друзья`);
    chatNotice(name, 'Хочет добавить вас в друзья');
  } else if (ev === 'accepted' && !raw.self) {
    toast(`${name} принял(а) вашу заявку в друзья`, 'success');
  }
}

async function onInvites(raw: Record<string, any>): Promise<void> {
  const before = S.inbox.length;
  await loadInbox();
  invalidate('sidebar', 'main', 'badge', 'rail');
  if (S.inbox.length > before && raw.event !== 'removed') {
    sound();
    const inv = S.inbox[0];
    const inviteText = inv ? `${inv.inviter?.username || 'Друг'} приглашает вас на «${inv.room.name}»` : 'Новое приглашение на сервер';
    toast(inviteText);
    chatNotice('Приглашение', inviteText);
  }
}

async function onGroup(raw: Record<string, any>): Promise<void> {
  const roomId = Number(raw.room_id);
  const knew = Boolean(roomById(roomId));
  await loadLists();
  const v = S.view;
  // Исключение из группы приходит как «members», но комнаты в списке уже нет
  if (!roomById(roomId)) {
    if (v.kind === 'group' && v.roomId === roomId) openFriends();
  } else if (roomId) {
    await Promise.all([loadDetail(roomId), loadMembers(roomId)]);
    if (!knew && !sameId(roomById(roomId)?.creator_id, S.me.id) && !(v.kind === 'group' && v.roomId === roomId)) {
      sound();
      const groupText = `Вас добавили в группу «${roomById(roomId)?.name || ''}»`;
      toast(groupText);
      chatNotice('Группа', groupText);
    }
  }
  invalidate('rail', 'sidebar', 'main', 'aside', 'badge');
}

// ===== Маршрутизатор =====

export async function onWs(raw: Record<string, any>): Promise<void> {
  const type = String(raw?.type || '');
  if (!type) return;

  if (type.startsWith('vc_')) return handleVc(raw);
  if (type.startsWith('call_')) return handleCall(raw);

  switch (type) {
    case 'chat_message':
      return onDm(raw);
    case 'room_message':
      return onRoom(raw);
    case 'chat_message_edited':
      return onEdited(raw, true);
    case 'room_message_edited':
      return onEdited(raw, false);
    case 'chat_message_deleted':
      return onDeleted(raw, true);
    case 'room_message_deleted':
      return onDeleted(raw, false);
    case 'chat_message_reaction':
      return onReaction(raw, true);
    case 'room_message_reaction':
      return onReaction(raw, false);
    case 'chat_message_pinned':
      return onPinned(raw, true);
    case 'room_message_pinned':
      return onPinned(raw, false);
    case 'typing': {
      const from = Number(raw.from_id);
      if (!from || sameId(from, S.me.id)) return;
      rememberUser({ id: from, username: raw.from_username });
      const key = raw.receiver_id != null ? dmKey(from) : raw.channel_id ? chKey(Number(raw.channel_id)) : null;
      if (key) setTyping(key, from, true);
      return;
    }
    case 'notify_sound': {
      const site = String(raw.conversation_id || raw.conversationId || '');
      const room = raw.room_id != null ? roomById(Number(raw.room_id)) : undefined;
      const convSite = site || room?.site_id || '';
      if (!shouldPlayMessageSound(convSite, siteChannelId(raw), String(raw.body || raw.text || ''))) return;
      const key = raw.source === 'dm' && raw.from_id ? dmKey(Number(raw.from_id)) : raw.channel_id ? chKey(Number(raw.channel_id)) : null;
      if (!key || !isWatching(key)) {
        sound();
        const who = String(raw.from_username || raw.username || 'Сообщение');
        chatNotice(who, String(raw.body || raw.text || ''));
      }
      return;
    }
    case 'friends_update':
      return onFriends(raw);
    case 'invites_update':
      return onInvites(raw);
    case 'group_update':
      return onGroup(raw);
    case 'pong': {
      const ms = Number(raw.ms);
      if (ms > 0) noteServerPing(ms);
      return;
    }
    case 'error': {
      const code = String(raw.code || '');
      if (code === 'chat_history_failed' || code === 'room_history_failed') return;
      const detail = String(raw.detail || 'Ошибка');
      if (code === 'calls_blocked' || detail === 'Звонки заблокированы' || detail === 'Нет доступа к чатам' || detail === 'Сервер заблокирован') {
        void vcLeave(false);
        void callHangup();
      }
      failLastPending();
      toast(detail, 'error', code === 'slowmode' ? 2500 : 4000);
      return;
    }
    default:
  }
}
