// Навигация чатов v2 и операции с беседами: переходы, загрузка данных, прочтение, отправка/загрузка файлов.
import {
  S,
  activeKey,
  allTextChannels,
  allVoiceChannels,
  chKey,
  conv,
  dmKey,
  errText,
  groupChannelId,
  groupVoiceId,
  invalidate,
  loadDetail,
  loadHistory,
  loadMembers,
  normMsg,
  roomById,
  saveUi,
  unwrap,
} from './store';
import { V, vcJoin } from './rtc';
import { toast } from './overlays';
import { setDmHidden } from './views/sidebar';
import { ensureProfile } from './views/aside';
import { feedCtx, rememberScroll, removeFromFeed } from './views/chat';
import { sameId } from './util';
import type { ConvKey, FriendsTab, Message, View } from './types';

// ===== Переходы =====

function go(view: View): void {
  rememberScroll();
  S.view = view;
  S.ui.asidePanel = null;
  S.ui.editing = null;
  S.ui.mobileSidebar = false;
  S.ui.asideOverlay = false;
  invalidate('rail', 'sidebar', 'main', 'aside', 'badge');
}

export function openWorlds(): void {
  go({ kind: 'worlds' });
}

export function openFriends(tab: FriendsTab = 'online'): void {
  if (tab !== 'add') S.ui.addFriendStatus = null;
  go({ kind: 'friends', tab });
}

export function openInvites(): void {
  go({ kind: 'invites' });
}

export async function openDm(peerId: number): Promise<void> {
  if (!peerId || sameId(peerId, S.me.id)) return;
  setDmHidden(peerId, false);
  // Новая беседа появится в списке сразу, не дожидаясь первого сообщения
  if (!S.dms.some((d) => d.peer_id === peerId)) {
    const u = S.users.get(peerId);
    S.dms.unshift({ peer_id: peerId, peer_username: u?.username || `Пользователь ${peerId}`, peer_avatar_url: u?.avatar_url, peer_avatar_color: u?.avatar_color, unread_count: 0 });
  }
  go({ kind: 'dm', peerId });
  ensureProfile(peerId);
  await openConv(dmKey(peerId));
}

export async function openGroup(roomId: number): Promise<void> {
  go({ kind: 'group', roomId });
  if (!S.details.has(roomId)) await loadDetail(roomId);
  void loadMembers(roomId).then(() => invalidate('aside', 'main'));
  invalidate('main', 'header');
  const ch = groupChannelId(roomId);
  if (ch) await openConv(chKey(ch));
}

export async function openServer(roomId: number, channelId?: number): Promise<void> {
  const room = roomById(roomId);
  if (room?.kind === 'group') return openGroup(roomId);
  const cached = S.details.get(roomId);
  const pick = (): number | null => {
    const d = S.details.get(roomId);
    const list = allTextChannels(d);
    if (channelId && list.some((c) => c.id === channelId)) return channelId;
    const last = S.ui.lastChannel[String(roomId)];
    if (last && list.some((c) => c.id === last)) return last;
    return d?.default_channel_id ?? list[0]?.id ?? null;
  };
  go({ kind: 'server', roomId, channelId: cached ? pick() : channelId ?? null, voiceId: null });
  const fresh = loadDetail(roomId);
  if (!cached) await fresh;
  void loadMembers(roomId).then(() => invalidate('aside', 'sidebar'));
  const ch = pick();
  if (S.view.kind === 'server' && S.view.roomId === roomId) {
    S.view.channelId = ch;
    invalidate('sidebar', 'main', 'aside');
  }
  if (ch) await openChannel(roomId, ch);
  void fresh.then(() => invalidate('sidebar'));
}

export async function openChannel(roomId: number, channelId: number): Promise<void> {
  const v = S.view;
  if (!(v.kind === 'server' && v.roomId === roomId && v.channelId === channelId && !v.voiceId)) {
    go({ kind: 'server', roomId, channelId, voiceId: null });
  }
  S.ui.lastChannel[String(roomId)] = channelId;
  saveUi();
  await openConv(chKey(channelId));
}

/** Клик по голосовому каналу: как в Discord — сразу подключает и показывает сцену. */
export async function openVoice(roomId: number, vcId: number, join = true): Promise<void> {
  const v = S.view;
  const prevCh = v.kind === 'server' && v.roomId === roomId ? v.channelId : null;
  go({ kind: 'server', roomId, channelId: prevCh, voiceId: vcId });
  if (join && !sameId(V.channelId, vcId)) await vcJoin(vcId, roomId);
}

export async function openVoiceRoom(roomId: number, vcId: number): Promise<void> {
  const room = roomById(roomId);
  if (room?.kind === 'group') return openGroup(roomId);
  if (!S.details.has(roomId)) await loadDetail(roomId);
  return openVoice(roomId, vcId, false);
}

export async function groupCall(roomId: number): Promise<void> {
  if (!S.details.has(roomId)) await loadDetail(roomId);
  const vc = groupVoiceId(roomId);
  if (!vc) {
    toast('У группы нет голосового канала', 'error');
    return;
  }
  await vcJoin(vc, roomId);
}

// ===== История и прочтение =====

async function openConv(key: ConvKey): Promise<void> {
  const c = conv(key);
  if (!c.loaded) {
    invalidate('feed');
    await loadHistory(key);
  }
  if (activeKey() !== key) return;
  markUnreadFrom(key);
  invalidate('feed');
  ack(key);
}

/** Разделитель «Новые»: первое непрочитанное по счётчику беседы. */
function markUnreadFrom(key: ConvKey): void {
  const c = conv(key);
  const [kind, idStr] = key.split(':');
  const id = Number(idStr);
  let unread = 0;
  if (kind === 'dm') unread = S.dms.find((d) => d.peer_id === id)?.unread_count || 0;
  else unread = S.chUnread.get(id)?.u || 0;
  const real = c.list.filter((m) => !m.pending && !m.is_system);
  c.unreadFrom = unread > 0 && real.length ? Number(real[Math.max(0, real.length - unread)]!.id) : null;
}

function lastRealId(key: ConvKey): number | undefined {
  const list = conv(key).list;
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i]!;
    if (!m.pending && typeof m.id === 'number') return m.id;
  }
  return undefined;
}

/** Отметить беседу прочитанной (локально и на мастере). */
export function ack(key: ConvKey): void {
  const [kind, idStr] = key.split(':');
  const id = Number(idStr);
  const last = lastRealId(key);
  if (kind === 'dm') {
    const d = S.dms.find((x) => x.peer_id === id);
    if (d && (d.unread_count || d.mention_count)) {
      d.unread_count = 0;
      d.mention_count = 0;
      invalidate('rail', 'sidebar', 'badge');
    }
    void S.api.cloudAckDm?.(id, last);
    return;
  }
  const v = S.view;
  const roomId = v.kind === 'server' || v.kind === 'group' ? v.roomId : 0;
  if (!roomId) return;
  const un = S.chUnread.get(id);
  if (un && (un.u || un.m)) S.chUnread.set(id, { u: 0, m: 0 });
  const room = roomById(roomId);
  if (room) {
    if (room.kind === 'group') {
      room.unread_count = 0;
      room.mention_count = 0;
    } else {
      let u = 0;
      let m = 0;
      for (const c of allTextChannels(S.details.get(roomId))) {
        u += S.chUnread.get(c.id)?.u || 0;
        m += S.chUnread.get(c.id)?.m || 0;
      }
      room.unread_count = u;
      room.mention_count = m;
    }
  }
  invalidate('rail', 'sidebar', 'badge');
  void S.api.cloudAckChannel?.(roomId, id, last);
}

export async function loadOlder(): Promise<void> {
  const ctx = feedCtx();
  if (!ctx) return;
  const c = conv(ctx.key);
  if (!c.hasMore || c.loading) return;
  const n = await loadHistory(ctx.key, true);
  if (n >= 0 && feedCtx()?.key === ctx.key) invalidate('feed');
}

// ===== Отправка =====

let tmpSeq = 0;

function wsSend(p: Record<string, unknown>): Promise<unknown> {
  return S.api.cloudWsSend?.(p) ?? Promise.resolve(null);
}

export { wsSend };

type Attachment = { url: string; name: string; size: number; mime?: string; preview?: string };

function payloadFor(key: ConvKey, text: string, replyId: number | null, att?: Attachment): Record<string, unknown> | null {
  const [kind, idStr] = key.split(':');
  const id = Number(idStr);
  const base: Record<string, unknown> = {
    text,
    reply_to_id: replyId,
    ...(att ? { attachment_url: att.url, attachment_name: att.name, attachment_size: att.size } : {}),
  };
  if (kind === 'dm') return { type: 'chat_message', receiver_id: id, ...base };
  const roomId = S.view.kind === 'server' || S.view.kind === 'group' ? S.view.roomId : 0;
  const found = roomId ? roomId : [...S.details.entries()].find(([, d]) => allTextChannels(d).some((c) => c.id === id))?.[0];
  if (!found) return null;
  return { type: 'room_message', room_id: found, channel_id: id, ...base };
}

const pendingTimers = new Map<string, number>();

function trackPending(key: ConvKey, m: Message): void {
  const t = window.setTimeout(() => {
    if (!m.pending) return;
    m.pending = false;
    m.failed = true;
    if (activeKey() === key) invalidate('feed');
  }, 12000);
  pendingTimers.set(String(m.id), t);
}

/** Эхо мастера: заменяем локальное «отправляется» на настоящее сообщение. */
export function resolvePending(key: ConvKey, real: Message): boolean {
  const c = conv(key);
  const i = c.list.findIndex((m) => m.pending && sameId(m.sender_id, real.sender_id) && (m.text === real.text || (m.attachment_name && m.attachment_name === real.attachment_name)));
  if (i < 0) return false;
  const old = c.list[i]!;
  const t = pendingTimers.get(String(old.id));
  if (t) window.clearTimeout(t);
  pendingTimers.delete(String(old.id));
  releasePreview(old);
  c.list[i] = real;
  return true;
}

/** Ошибка без привязки к сообщению: помечаем последнее отправляемое как неотправленное. */
export function failLastPending(): boolean {
  const key = activeKey();
  if (!key) return false;
  const c = conv(key);
  for (let i = c.list.length - 1; i >= 0; i--) {
    const m = c.list[i]!;
    if (m.pending) {
      m.pending = false;
      m.failed = true;
      const t = pendingTimers.get(String(m.id));
      if (t) window.clearTimeout(t);
      invalidate('feed');
      return true;
    }
  }
  return false;
}

export async function sendText(key: ConvKey, raw: string, att?: Attachment): Promise<boolean> {
  const text = raw.replace(/\s+$/, '');
  if (!text.trim() && !att) return false;
  const reply = S.ui.replyTo && S.ui.replyTo.key === key ? S.ui.replyTo.msg : null;
  const payload = payloadFor(key, text, reply ? Number(reply.id) : null, att);
  if (!payload) {
    toast('Беседа ещё загружается', 'error');
    return false;
  }
  const m: Message = {
    id: `tmp-${++tmpSeq}`,
    sender_id: S.me.id,
    sender_username: S.me.username,
    sender_avatar_url: S.me.avatar,
    sender_avatar_color: S.me.color,
    text: text || att?.name || '',
    created_at: new Date().toISOString(),
    attachment_url: att?.url ?? null,
    attachment_name: att?.name ?? null,
    attachment_size: att?.size ?? null,
    attachment_mime: att?.mime ?? null,
    attachment_preview: att?.preview ?? null,
    reply_to_id: reply ? Number(reply.id) : null,
    reply_to: reply ? { id: Number(reply.id), sender_id: reply.sender_id, sender_username: reply.sender_username, text: reply.text } : null,
    reactions: [],
    pending: true,
  };
  conv(key).list.push(m);
  S.ui.replyTo = null;
  S.ui.drafts.delete(key);
  trackPending(key, m);
  invalidate('feed');
  try {
    await wsSend(payload);
  } catch (e) {
    m.pending = false;
    m.failed = true;
    toast(errText(e), 'error');
    invalidate('feed');
  }
  bumpConvOrder(key, m);
  return true;
}

function bumpConvOrder(key: ConvKey, m: Message): void {
  const [kind, idStr] = key.split(':');
  const id = Number(idStr);
  const last = { text: m.text, sender_username: m.sender_username, created_at: m.created_at };
  if (kind === 'dm') {
    const d = S.dms.find((x) => x.peer_id === id);
    if (d) d.last_message = last;
  } else {
    const v = S.view;
    if (v.kind === 'group') {
      const r = roomById(v.roomId);
      if (r) r.last_message = last;
    }
  }
  invalidate('sidebar');
}

export async function retry(key: ConvKey, id: string): Promise<void> {
  const c = conv(key);
  const i = c.list.findIndex((m) => sameId(m.id, id));
  if (i < 0) return;
  const [m] = c.list.splice(i, 1);
  invalidate('feed');
  if (!m) return;
  const att = m.attachment_url ? { url: m.attachment_url, name: m.attachment_name || 'файл', size: Number(m.attachment_size) || 0 } : undefined;
  await sendText(key, m.attachment_url && m.text === m.attachment_name ? '' : m.text, att);
}

export function discard(key: ConvKey, id: string): void {
  const c = conv(key);
  const gone = c.list.find((m) => sameId(m.id, id));
  releasePreview(gone);
  c.list = c.list.filter((m) => !sameId(m.id, id));
  invalidate('feed');
}

function releasePreview(m: Message | undefined): void {
  const url = m?.attachment_preview;
  if (url && url.startsWith('blob:')) URL.revokeObjectURL(url);
}

const MAX_FILE = 25 * 1024 * 1024;

// ===== GIF: байты файла не прогоняем через canvas, иначе остаётся первый кадр =====

function gifMagic(bytes: Uint8Array): boolean {
  if (bytes.length < 6) return false;
  const sig = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!, bytes[4]!, bytes[5]!);
  return sig === 'GIF87a' || sig === 'GIF89a';
}

function gifName(name: string): string {
  if (/\.gif$/i.test(name)) return name;
  const base = name.replace(/\.[^.\\/]+$/, '').trim();
  return `${base || 'image'}.gif`;
}

async function ensureGifFile(file: File): Promise<File> {
  const head = new Uint8Array(await file.slice(0, 6).arrayBuffer());
  const gif = gifMagic(head) || file.type === 'image/gif' || /\.gif$/i.test(file.name);
  if (!gif) return file;
  const name = gifName(file.name || 'image.gif');
  if (file.type === 'image/gif' && name === file.name) return file;
  return new File([file], name, { type: 'image/gif', lastModified: file.lastModified });
}

export async function uploadAndSend(key: ConvKey, files: File[], caption = ''): Promise<void> {
  const [kind] = key.split(':');
  const roomId = S.view.kind === 'server' || S.view.kind === 'group' ? S.view.roomId : 0;
  let first = true;
  for (const raw of files) {
    const f = await ensureGifFile(raw);
    if (f.size > MAX_FILE) {
      toast(`«${f.name}» больше 25 МБ`, 'error');
      continue;
    }
    const id = `up-${++tmpSeq}`;
    S.uploads.set(id, { key, name: f.name, size: f.size });
    invalidate('feed');
    let preview: string | undefined;
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const res = kind === 'dm' ? await S.api.cloudUploadDmFile?.(bytes, f.name, f.type) : await S.api.cloudUploadRoomFile?.(roomId, bytes, f.name, f.type);
      const d = unwrap<any>(res, 'Не удалось загрузить файл');
      const url = String(d?.url_abs || d?.url || d?.file_url || res?.url_abs || res?.url || '');
      if (!url) throw new Error('Мастер не вернул ссылку на файл');
      if (f.type === 'image/gif') preview = URL.createObjectURL(f);
      const sent = await sendText(key, first ? caption : '', { url, name: f.name, size: f.size, mime: f.type || undefined, preview });
      if (!sent && preview) URL.revokeObjectURL(preview);
      if (sent) first = false;
    } catch (e) {
      if (preview) URL.revokeObjectURL(preview);
      toast(`«${f.name}»: ${errText(e)}`, 'error');
    } finally {
      S.uploads.delete(id);
      invalidate('feed');
    }
  }
}

// ===== Действия с сообщениями =====

export function msgById(key: ConvKey, id: number | string): Message | undefined {
  return conv(key).list.find((m) => sameId(m.id, id));
}

export async function react(key: ConvKey, id: number | string, emoji: string): Promise<void> {
  const m = msgById(key, id);
  if (!m || m.pending) return;
  // Оптимистично: мгновенный отклик, мастер пришлёт итог
  const list = (m.reactions || []).map((r) => ({ ...r }));
  const r = list.find((x) => x.emoji === emoji);
  if (r) {
    r.me = !r.me;
    r.count += r.me ? 1 : -1;
  } else list.push({ emoji, count: 1, me: true });
  m.reactions = list.filter((x) => x.count > 0);
  invalidate('feed');
  await wsSend({ type: key.startsWith('dm:') ? 'chat_message_react' : 'room_message_react', message_id: Number(id), emoji });
}

export async function editMessage(key: ConvKey, id: number | string, text: string): Promise<void> {
  const m = msgById(key, id);
  const t = text.trim();
  if (!m || !t || t === m.text) return;
  m.text = t;
  m.edited_at = new Date().toISOString();
  await wsSend({ type: key.startsWith('dm:') ? 'chat_message_edit' : 'room_message_edit', message_id: Number(id), text: t });
}

export async function deleteMessage(key: ConvKey, id: number | string): Promise<void> {
  try {
    const res = await wsSend({ type: key.startsWith('dm:') ? 'chat_message_delete' : 'room_message_delete', message_id: Number(id) });
    if (res && typeof res === 'object' && (res as { ok?: boolean }).ok === false) {
      throw new Error(String((res as { error?: string }).error || 'Не удалось удалить сообщение'));
    }
  } catch (e) {
    toast(errText(e), 'error');
    return;
  }
  const c = conv(key);
  c.list = c.list.filter((m) => !sameId(m.id, id));
  if (S.ui.replyTo && sameId(S.ui.replyTo.msg.id, id)) {
    S.ui.replyTo = null;
    invalidate('composer');
  }
  const ctx = feedCtx();
  if (ctx?.key === key) removeFromFeed(ctx, id);
  else invalidate('feed');
}

export async function pinMessage(key: ConvKey, id: number | string, pinned: boolean): Promise<void> {
  await wsSend({ type: key.startsWith('dm:') ? 'chat_message_pin' : 'room_message_pin', message_id: Number(id), pinned });
}

export async function forwardTo(target: { kind: 'dm'; peerId: number } | { kind: 'channel'; roomId: number; channelId: number }, msg: Message): Promise<boolean> {
  const att = msg.attachment_url ? { attachment_url: msg.attachment_url, attachment_name: msg.attachment_name, attachment_size: msg.attachment_size } : {};
  const author = msg.sender_username || 'сообщение';
  const text = msg.attachment_url && msg.text === msg.attachment_name ? '' : msg.text;
  const quoted = `> ↪ Переслано от ${author}\n${text}`.trim();
  try {
    if (target.kind === 'dm') await wsSend({ type: 'chat_message', receiver_id: target.peerId, text: quoted, ...att });
    else await wsSend({ type: 'room_message', room_id: target.roomId, channel_id: target.channelId, text: quoted, ...att });
    return true;
  } catch {
    return false;
  }
}

// ===== Поиск и закрепы в правой панели =====

export async function loadAsideList(kind: 'search' | 'pins', query = ''): Promise<void> {
  const ctx = feedCtx();
  if (!ctx) return;
  S.ui.asidePanel = { kind, query, results: [], loading: true };
  invalidate('aside', 'header');
  const [k, idStr] = ctx.key.split(':');
  const id = Number(idStr);
  try {
    let raw: unknown;
    if (k === 'dm') raw = kind === 'pins' ? await S.api.cloudDmPins?.(id) : await S.api.cloudDmSearch?.(id, query);
    else raw = kind === 'pins' ? await S.api.cloudChannelPins?.(ctx.roomId || 0, id) : await S.api.cloudChannelSearch?.(ctx.roomId || 0, id, query);
    const d = unwrap<any>(raw);
    const list = Array.isArray(d) ? d : d?.messages || d?.results || d?.pins || [];
    if (S.ui.asidePanel?.kind !== kind || S.ui.asidePanel.query !== query) return;
    S.ui.asidePanel = { kind, query, results: (list as Record<string, any>[]).map(normMsg), loading: false };
  } catch (e) {
    if (S.ui.asidePanel) S.ui.asidePanel = { kind, query, results: [], loading: false };
    toast(errText(e), 'error');
  }
  invalidate('aside');
}

export function voiceChannelName(vcId: number): string {
  for (const d of S.details.values()) {
    const ch = allVoiceChannels(d).find((c) => c.id === vcId);
    if (ch) return ch.name;
  }
  return '';
}
