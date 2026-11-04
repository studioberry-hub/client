// Мост экрана чатов electron-v2 к API мессенджера сайта: строковые id ↔ числа UI, SSE и сигналинг звонков.

import { getApiBase } from '../../shared/apiBase';
import { cropWornHead, isFinishedHeadUrl, isWornTexture, resolveWornSkinUrl, type SkinLookup } from '../worn-skin';
import { initChats } from './index';
import { S, invalidate, loadDetail, loadLists, loadMembers } from './store';
import { noteActivity, noteInviteEnded } from './worlds';
import { onWs } from './ws';
import type { ChatsApi, ChatsController } from './types';

type Req = (
  path: string,
  opts?: { method?: string; body?: unknown; query?: Record<string, string | number | undefined> },
) => Promise<any>;

type Me = { id: string; username: string; uuid?: string; skinUrl?: string | null };

export type ChatsScreenSession = {
  req: Req;
  token: string;
  me: Me;
  openProfile: (userId: string) => void;
  openExternal?: (url: string) => void;
};

// ===== Строковые id сайта → числа, которые ждёт UI v2 =====

const toNum = new Map<string, number>();
const toStr = new Map<number, string>();
let seq = 1;

function isBotRaw(u: { id?: string; provider?: string } | null | undefined): boolean {
  if (!u) return false;
  return u.provider === 'bot' || String(u.id || '').startsWith('bot:');
}

/** Бот всегда в сети: точка, список и карточка не зависят от lastSeen. */
function noteBot(u: { id?: string; provider?: string; username?: string } | null | undefined): void {
  if (!isBotRaw(u) || !u?.id) return;
  const n = idOf(u.id);
  if (!n) return;
  const prev = S.users.get(n);
  S.users.set(n, {
    id: n,
    username: String(u.username || prev?.username || nameOf(String(u.id))),
    avatar_url: prev?.avatar_url || faces.get(String(u.id)) || null,
    avatar_color: prev?.avatar_color ?? null,
    bot: true,
  });
  S.online.add(n);
}

function idOf(raw: unknown): number {
  const s = String(raw || '').trim();
  if (!s) return 0;
  let n = toNum.get(s);
  if (!n) {
    n = seq++;
    toNum.set(s, n);
    toStr.set(n, s);
    S.userKeys.set(n, s);
  }
  if (s.startsWith('bot:')) {
    const known = S.users.get(n);
    if (known) known.bot = true;
    S.online.add(n);
  }
  return n;
}

function strOf(n: unknown): string {
  return toStr.get(Number(n)) || '';
}

/** Поля канала для PATCH: категория null снимает канал с группы. */
function channelPatch(body: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.topic !== undefined) patch.topic = body.topic;
  if (body.slowmode_seconds !== undefined) patch.slowmode_seconds = body.slowmode_seconds;
  if (body.channel_kind !== undefined) patch.channel_kind = body.channel_kind;
  if (body.user_limit !== undefined) patch.user_limit = body.user_limit;
  if (body.position !== undefined) patch.position = Number(body.position);
  if (body.is_nsfw !== undefined) patch.is_nsfw = Boolean(body.is_nsfw);
  if (body.bitrate !== undefined) patch.bitrate = Number(body.bitrate) || 0;
  if (Array.isArray(body.overwrites)) {
    patch.permission_overwrites = body.overwrites
      .map((row) => {
        const item = row as { target_id?: number; target_type?: string; allow?: Record<string, boolean>; deny?: Record<string, boolean> };
        const target = item.target_id === 0 ? 'everyone' : strOf(item.target_id);
        if (!target) return null;
        return {
          target,
          type: item.target_type === 'member' ? 'member' : 'role',
          allow: item.allow || {},
          deny: item.deny || {},
        };
      })
      .filter(Boolean);
  }
  if ('category_id' in body) {
    if (body.category_id == null || body.category_id === '') patch.categoryId = null;
    else {
      const id = strOf(body.category_id);
      if (id) patch.categoryId = id;
    }
  }
  return patch;
}

const names = new Map<string, string>();
const faces = new Map<string, string>();
const convById = new Map<string, any>();
const peerConv = new Map<string, string>();
const channelConv = new Map<string, string>();
const catsByConv = new Map<string, any[]>();
const generalOf = new Map<string, string>();
const msgMeta = new Map<number, { convId: string; at: number }>();
const files = new Map<string, { name: string; mime: string; b64: string }>();

let listInflight: Promise<any[]> | null = null;

async function loadConversationList(): Promise<any[]> {
  if (listInflight) return listInflight;
  listInflight = (async () => {
    const res = await req('/conversations', { query: { limit: 100 } });
    const data = dataOf(res);
    const raw = data?.conversations ?? data;
    const list = (Array.isArray(raw) ? raw : []) as any[];
    const nextConv = new Map<string, any>();
    const nextPeer = new Map<string, string>();
    for (const c of list) {
      try {
        if (!c?.id) continue;
        nextConv.set(c.id, c);
        for (const m of c.members || []) rememberUser(m);
        if (c.peer) rememberUser(c.peer);
        if ((c.type === 'dm' || c.peer?.id) && c.peer?.id) nextPeer.set(c.peer.id, c.id);
      } catch {
        /* один битый диалог не обнуляет список */
      }
    }
    convById.clear();
    peerConv.clear();
    for (const [id, c] of nextConv) convById.set(id, c);
    for (const [peer, id] of nextPeer) peerConv.set(peer, id);
    return [...nextConv.values()];
  })().finally(() => {
    listInflight = null;
  });
  return listInflight;
}

let req: Req = async () => ({ ok: false, error: 'no_session' });
let token = '';
let meId = '';
let openProfile: (userId: string) => void = () => undefined;
let openExternal: (url: string) => void = (url) => window.open(url, '_blank', 'noopener');
let controller: ChatsController | null = null;
let fileSeq = 0;

function skinLookup(): SkinLookup {
  const api = (window as unknown as {
    electronAPI?: {
      getSkinData?: SkinLookup['getMojangSkin'];
      getElyWornSkin?: SkinLookup['getElyWornSkin'];
    };
  }).electronAPI;
  return { getMojangSkin: api?.getSkinData, getElyWornSkin: api?.getElyWornSkin };
}

function cropHead(textureUrl: string): Promise<string> {
  return cropWornHead(textureUrl, 64);
}

const headQueued = new Set<string>();
let headSlots = 0;
const headWait: Array<() => void> = [];

function withHeadSlot<T>(task: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = () => {
      headSlots += 1;
      task().then(resolve, reject).finally(() => {
        headSlots -= 1;
        const next = headWait.shift();
        if (next) next();
      });
    };
    if (headSlots < 2) run();
    else headWait.push(run);
  });
}

function queueHead(user: { id?: string; provider?: string; uuid?: string; username?: string; skinUrl?: string | null }): void {
  const id = String(user?.id || '');
  if (!id || headQueued.has(id) || faces.has(id)) return;
  headQueued.add(id);
  void (async () => {
    const raw = String(user.skinUrl || '').trim();
    const abs = raw.startsWith('/') ? `${getApiBase()}${raw}` : raw;
    let png = '';
    if (isFinishedHeadUrl(raw)) {
      png = abs;
    } else if (raw) {
      png = await cropHead(raw);
      // Сохранённый URL не лист 64×32/64 — один тихий запрос настоящей текстуры, без пачки Ely.
      if (!png && isWornTexture(raw)) {
        const texture = await withHeadSlot(() =>
          resolveWornSkinUrl(user, { getMojangSkin: skinLookup().getMojangSkin }, { live: true }),
        );
        if (texture && texture !== raw && !isFinishedHeadUrl(texture)) png = await cropHead(texture);
        else if (texture && isFinishedHeadUrl(texture)) png = texture;
      }
      // Не лист и не голова сервиса: картинка как есть (бот, свой файл). Лист уже скропан выше.
      if (!png && (/^(https?:|data:)/i.test(raw) || raw.startsWith('/')) && !isWornTexture(raw)) png = abs;
    } else {
      const texture = await withHeadSlot(() =>
        resolveWornSkinUrl(user, { getMojangSkin: skinLookup().getMojangSkin }),
      );
      if (texture && isFinishedHeadUrl(texture)) png = texture;
      else if (texture) png = await cropHead(texture);
    }
    if (!png) return;
    faces.set(id, png);
    const n = toNum.get(id);
    if (n) {
      const known = S.users.get(n);
      const bot = isBotRaw(user);
      if (known) {
        known.avatar_url = png;
        if (bot) known.bot = true;
      } else S.users.set(n, { id: n, username: user.username || nameOf(id), avatar_url: png, bot: bot || undefined });
      for (const dm of S.dms) if (strOf(dm.peer_id) === id) dm.peer_avatar_url = png;
    }
    if (id === meId) S.me.avatar = png;
    invalidate('rail', 'sidebar', 'feed', 'aside', 'header');
  })();
}

function faceOf(user: { id?: string; uuid?: string; username?: string; skinUrl?: string | null; provider?: string }): string {
  if (user?.id) queueHead(user);
  return (user?.id && faces.get(user.id)) || '';
}

function rememberUser(u: any): void {
  if (!u?.id) return;
  names.set(u.id, String(u.username || names.get(u.id) || 'user'));
  queueHead(u);
  noteBot(u);
}

function nameOf(id: string): string {
  return names.get(id) || 'user';
}

const ONLINE_MS = 2 * 60 * 1000;

/** Как в старом мессенджере: зелёная точка только если человек был в сети недавно. */
function userLive(u: any): boolean {
  if (!u) return false;
  if (isBotRaw(u)) return true;
  const manual = String(u.presenceStatus || '').toLowerCase();
  if (manual === 'offline') return false;
  const seen = Number(u.lastSeenAt);
  if (!Number.isFinite(seen) || seen <= 0 || Date.now() - seen >= ONLINE_MS) return false;
  return true;
}

function iso(ms: unknown): string {
  const n = Number(ms);
  const d = Number.isFinite(n) && n > 0 ? new Date(n) : new Date();
  return d.toISOString();
}

function dataOf(res: any): any {
  if (!res || res.ok === false) {
    const err = new Error(String(res?.error || res?.code || 'Ошибка запроса'));
    throw err;
  }
  return res.data ?? res;
}

function indexChannels(convId: string, channels: any[]): void {
  for (const ch of channels || []) {
    if (!ch?.id) continue;
    channelConv.set(ch.id, convId);
    if (ch.kind === 'text' && ch.slug === 'general') generalOf.set(convId, ch.id);
  }
}

function forgetConv(id: string): void {
  if (id) convById.delete(id);
}

function toRole(r: any): Record<string, unknown> {
  return {
    id: idOf(r.id),
    name: r.name,
    position: Number(r.position) || 0,
    color: r.color || '#99AAB5',
    permissions: r.permissions && typeof r.permissions === 'object' ? r.permissions : {},
  };
}

function indexConv(c: any): void {
  if (!c?.id) return;
  convById.set(c.id, c);
  for (const m of c.members || []) rememberUser(m);
  if (c.peer) rememberUser(c.peer);
  if (c.type === 'dm' && c.peer?.id) peerConv.set(c.peer.id, c.id);
}

function textChannelId(convId: string, channelId: string | null | undefined): number {
  if (channelId) return idOf(channelId);
  const g = generalOf.get(convId);
  return g ? idOf(g) : 0;
}

function toMessage(m: any, convId: string, channelId: string | null): Record<string, unknown> {
  const num = idOf(m.id);
  const at = Number(m.createdAt) || Date.now();
  msgMeta.set(num, { convId, at });
  rememberUser({ id: m.senderId, username: m.senderUsername || nameOf(m.senderId) });
  const reply = m.replyTo;
  const att = m.attachment;
  const attUrl =
    att && token
      ? `${getApiBase()}/api/messenger/messages/${encodeURIComponent(m.id)}/attachment?token=${encodeURIComponent(token)}`
      : null;
  const reactions = Array.isArray(m.reactions)
    ? m.reactions.map((r: any) =>
        r && r.userId
          ? { user_id: idOf(r.userId), emoji: r.emoji }
          : { emoji: r.emoji, count: Number(r.count) || 0, me: Boolean(r.me) },
      )
    : [];
  return {
    id: num,
    sender_id: idOf(m.senderId),
    sender_username: m.senderUsername || nameOf(m.senderId),
    sender_avatar_url: faces.get(m.senderId) || null,
    text: String(m.body || ''),
    created_at: iso(at),
    channel_id: textChannelId(convId, channelId),
    room_id: idOf(convId),
    attachment_url: attUrl,
    attachment_name: att?.name || null,
    attachment_size: att?.size || null,
    attachment_mime: att?.mime || null,
    reply_to_id: reply?.id ? idOf(reply.id) : null,
    reply_to: reply
      ? { id: idOf(reply.id), sender_username: nameOf(reply.senderId), text: String(reply.body || '') }
      : null,
    reactions,
    is_pinned: Boolean(m.pinned),
    edited_at: m.editedAt ? iso(Number(m.editedAt)) : null,
    kind: m.kind || 'text',
    meta: m.meta && typeof m.meta === 'object' ? m.meta : null,
  };
}

function toRoom(c: any): any {
  const last = c.lastMessage;
  return {
    id: idOf(c.id),
    name: c.title || 'Сервер',
    kind: 'server',
    description: c.description || null,
    creator_id: c.createdBy ? idOf(c.createdBy) : null,
    site_id: c.id,
    members_total: (c.members || []).length,
    members_online: (c.members || []).filter((m: any) => userLive(m)).length,
    members: (c.members || []).map((m: any) => ({ user_id: idOf(m.id), username: m.username })),
    avatar_url: c.avatarUrl || null,
    banner_url: c.coverUrl || null,
    unread_count: Number(c.unreadCount) || 0,
    mention_count: 0,
    last_message: last
      ? { text: last.body || '', sender_username: nameOf(last.senderId), created_at: iso(last.createdAt) }
      : null,
  };
}

function toDm(c: any): any | null {
  const peer = c.peer;
  if (!peer?.id) return null;
  rememberUser(peer);
  const last = c.lastMessage;
  return {
    peer_id: idOf(peer.id),
    peer_username: peer.username,
    peer_avatar_url: faceOf(peer),
    unread_count: Number(c.unreadCount) || 0,
    last_message: last
      ? { text: last.body || '', sender_username: nameOf(last.senderId), created_at: iso(last.createdAt) }
      : null,
  };
}

function mapOverwrites(raw: unknown): Array<{ target_id: number; target_type: 'role' | 'member'; allow: Record<string, boolean>; deny: Record<string, boolean> }> {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map((row: any) => {
      const target = String(row?.target || '');
      const id = !target || target === 'everyone' ? 0 : idOf(target);
      return {
        target_id: id,
        target_type: row?.type === 'member' ? ('member' as const) : ('role' as const),
        allow: row?.allow && typeof row.allow === 'object' ? row.allow : {},
        deny: row?.deny && typeof row.deny === 'object' ? row.deny : {},
      };
    })
    .filter((row) => row.target_id === 0 || row.target_id);
}

function toDetail(c: any, channels: any[]): any {
  indexChannels(c.id, channels);
  const text = (channels || []).filter((ch) => ch.kind === 'text');
  const voice = (channels || []).filter((ch) => ch.kind === 'voice');
  const general = text.find((ch) => ch.slug === 'general') || text[0];
  const cats = catsByConv.get(c.id) || [];
  return {
    id: idOf(c.id),
    name: c.title || 'Сервер',
    kind: 'server',
    description: c.description || null,
    creator_id: c.createdBy ? idOf(c.createdBy) : c.myRole === 'owner' ? idOf(meId) : null,
    avatar_url: c.avatarUrl || null,
    banner_url: c.coverUrl || null,
    default_channel_id: general ? idOf(general.id) : null,
    text_channels: text.map((ch: any, i: number) => ({
      id: idOf(ch.id),
      name: ch.name,
      position: ch.position == null ? i : Number(ch.position) || 0,
      is_default: ch.slug === 'general',
      channel_kind: ch.channelKind || 'text',
      topic: ch.topic || null,
      slowmode_seconds: Number(ch.slowmodeSeconds) || 0,
      is_nsfw: Boolean(ch.isNsfw),
      overwrites: mapOverwrites(ch.permissionOverwrites),
      category_id: ch.categoryId ? idOf(ch.categoryId) : null,
      site_id: String(ch.id || ''),
    })),
    voice_channels: voice.map((ch: any, i: number) => ({
      id: idOf(ch.id),
      room_id: idOf(c.id),
      name: ch.name,
      position: ch.position == null ? i : Number(ch.position) || 0,
      user_limit: Number(ch.userLimit) || 0,
      bitrate: Number(ch.bitrate) || 0,
      overwrites: mapOverwrites(ch.permissionOverwrites),
      member_ids: [],
      category_id: ch.categoryId ? idOf(ch.categoryId) : null,
      is_default: ch.slug === 'voice',
      site_id: String(ch.id || ''),
    })),
    categories: cats.map((cat: any, i: number) => ({
      id: idOf(cat.id),
      name: cat.name,
      position: cat.position == null ? i : Number(cat.position) || 0,
      site_id: String(cat.id || ''),
    })),
    roles: (Array.isArray(c.roles) ? c.roles : []).map((r: any) => ({
      id: idOf(r.id),
      name: r.name,
      position: Number(r.position) || 0,
      color: r.color || '#99AAB5',
      permissions: r.permissions && typeof r.permissions === 'object' ? r.permissions : {},
    })),
    members_total: (c.members || []).length,
    settings: c.settings
      ? {
          verification_level: Number(c.settings.verification_level) || 0,
          explicit_filter: c.settings.explicit_filter || 'disabled',
          notify_default: c.settings.notify_default || 'all',
          system_channel_id: c.settings.system_channel_id ? idOf(c.settings.system_channel_id) : null,
          rules_channel_id: c.settings.rules_channel_id ? idOf(c.settings.rules_channel_id) : null,
        }
      : undefined,
  };
}

function toMember(m: any): any {
  rememberUser(m);
  return {
    user_id: idOf(m.id),
    username: m.username,
    is_online: userLive(m),
    avatar_url: faceOf(m),
    role_ids: (Array.isArray(m.roleIds) ? m.roleIds : []).map((id: string) => idOf(id)),
    site_role: m.role || 'member',
    nickname: m.nickname || null,
  };
}

function toFriend(u: any): any {
  rememberUser(u);
  const id = idOf(u.id);
  if (u?.activity) noteActivity(id, String(u.id), String(u.username || ''), u.activity);
  return {
    id,
    username: u.username,
    avatar_url: faceOf(u),
    is_online: userLive(u),
    activity: u.activity || null,
  };
}

function isLocalChannel(id: string): boolean {
  return id.startsWith('local:');
}

/** Если /channels нет на проде или запрос завис — общий и голосовой, без вечного скелета. */
function localChannels(convId: string): any[] {
  catsByConv.set(convId, []);
  const list = [
    { id: `local:${convId}:general`, kind: 'text', name: 'общий', slug: 'general', position: 0 },
    { id: `local:${convId}:voice`, kind: 'voice', name: 'Голосовой', slug: 'voice', position: 1 },
  ];
  indexChannels(convId, list);
  return list;
}

async function channelsOf(convId: string): Promise<any[]> {
  try {
    const res = await Promise.race([
      req(`/conversations/${encodeURIComponent(convId)}/channels`),
      new Promise<never>((_, reject) => {
        window.setTimeout(() => reject(new Error('channels_timeout')), 8000);
      }),
    ]);
    if (!res || res.ok === false) {
      catsByConv.set(convId, []);
      return localChannels(convId);
    }
    catsByConv.set(convId, Array.isArray(res.data?.categories) ? res.data.categories : []);
    const list = (res.data?.channels || []) as any[];
    if (!Array.isArray(list) || !list.length) return localChannels(convId);
    indexChannels(convId, list);
    return list;
  } catch {
    return localChannels(convId);
  }
}

async function convOf(id: string): Promise<any> {
  const cached = convById.get(id);
  if (cached?.members) return cached;
  const res = await req(`/conversations/${encodeURIComponent(id)}`);
  const c = dataOf(res).conversation;
  indexConv(c);
  return c;
}

function bytesToB64(bytes: Uint8Array): string {
  let s = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    s += String.fromCharCode(...bytes.subarray(i, Math.min(i + step, bytes.length)));
  }
  return btoa(s);
}

async function sendMessage(convId: string, body: string, channelId: string | null, replyNum: unknown, attUrl: unknown): Promise<void> {
  const payload: Record<string, unknown> = { body: body || '' };
  // Локальный «общий» не шлём на сервер: старые сообщения группы лежат с channel_id = null.
  if (channelId && !isLocalChannel(channelId)) payload.channelId = channelId;
  const reply = strOf(replyNum);
  if (reply) payload.replyToId = reply;
  const key = String(attUrl || '');
  const file = key.startsWith('mem:') ? files.get(key) : undefined;
  if (file) {
    payload.attachment = { name: file.name, mime: file.mime, dataBase64: file.b64 };
    files.delete(key);
    if (!payload.body) payload.body = file.name;
  }
  const res = await req(`/conversations/${encodeURIComponent(convId)}/messages`, { method: 'POST', body: payload });
  dataOf(res);
}

async function onCloudWsSend(p: Record<string, unknown>): Promise<unknown> {
  const type = String(p.type || '');
  if (type === 'chat_message') {
    const peer = strOf(p.receiver_id);
    let convId = peerConv.get(peer);
    if (!convId && peer) {
      const res = await req('/conversations/dm', { method: 'POST', body: { userId: peer } });
      const c = dataOf(res).conversation;
      indexConv(c);
      convId = c.id;
    }
    if (!convId) throw new Error('Нет диалога');
    await sendMessage(convId, String(p.text || ''), null, p.reply_to_id, p.attachment_url);
    return { ok: true };
  }
  if (type === 'room_message') {
    const convId = strOf(p.room_id);
    const channelId = strOf(p.channel_id);
    if (!convId) throw new Error('Нет сервера');
    await sendMessage(convId, String(p.text || ''), channelId || null, p.reply_to_id, p.attachment_url);
    return { ok: true };
  }
  if (type === 'chat_message_delete' || type === 'room_message_delete') {
    const meta = msgMeta.get(Number(p.message_id));
    if (!meta) return { ok: false, error: 'Сообщение не найдено' };
    const res = await req(
      `/conversations/${encodeURIComponent(meta.convId)}/messages/${encodeURIComponent(strOf(p.message_id))}`,
      { method: 'DELETE' },
    );
    dataOf(res);
    return { ok: true };
  }
  if (type === 'chat_message_react' || type === 'room_message_react') {
    const meta = msgMeta.get(Number(p.message_id));
    if (!meta) return { ok: false };
    const res = await req(
      `/conversations/${encodeURIComponent(meta.convId)}/messages/${encodeURIComponent(strOf(p.message_id))}/reactions`,
      { method: 'POST', body: { emoji: p.emoji } },
    );
    dataOf(res);
    return { ok: true };
  }
  if (type === 'typing') {
    const convId = p.channel_id ? channelConv.get(strOf(p.channel_id)) : peerConv.get(strOf(p.receiver_id || p.from_id));
    if (convId) void req(`/conversations/${encodeURIComponent(convId)}/typing`, { method: 'POST', body: {} });
    return { ok: true };
  }
  if (type === 'vc_join' || type === 'vc_leave') return { ok: true };
  if (type === 'vc_speaking') {
    const channelNum = Number(p.voice_channel_id);
    const channelId = strOf(channelNum);
    const convId = channelConv.get(channelId) || '';
    if (!convId || !channelId) return { ok: false, error: 'Нет голосового канала' };
    const targets = (S.voiceMembers.get(channelNum) || [])
      .map((id) => strOf(id))
      .filter((id) => id && id !== meId);
    await Promise.all(
      targets.map((to) =>
        req(`/conversations/${encodeURIComponent(convId)}/signals`, {
          method: 'POST',
          body: { type: 'vc_speaking', toUserId: to, channelId, speaking: Boolean(p.speaking) },
        }).catch(() => undefined),
      ),
    );
    return { ok: true };
  }
  if (type === 'vc_state') {
    const channelId = strOf(p.voice_channel_id);
    const convId = channelConv.get(channelId);
    if (!convId || !channelId) return { ok: false };
    await req(`/conversations/${encodeURIComponent(convId)}/voice/${encodeURIComponent(channelId)}/state`, {
      method: 'POST',
      body: { muted: Boolean(p.muted), deafened: Boolean(p.deafened) },
    });
    return { ok: true };
  }
  if (type === 'vc_server_mute' || type === 'vc_server_deafen' || type === 'vc_force_disconnect') {
    const channelId = strOf(p.voice_channel_id);
    const convId = channelConv.get(channelId);
    const target = strOf(p.target_id);
    if (!convId || !channelId || !target) return { ok: false, error: 'Нет голосового канала' };
    const action = type === 'vc_force_disconnect' ? 'disconnect' : type === 'vc_server_deafen' ? 'deafen' : 'mute';
    const res = await req(
      `/conversations/${encodeURIComponent(convId)}/voice/${encodeURIComponent(channelId)}/moderate`,
      { method: 'POST', body: { action, userId: target, enabled: p.enabled !== false } },
    );
    dataOf(res);
    return { ok: true };
  }
  if (type.startsWith('call_') || type.startsWith('vc_')) {
    const to = strOf(p.to_id ?? p.target_id);
    let convId = '';
    let channelId: string | null = null;
    if (type.startsWith('vc_')) {
      channelId = strOf(p.voice_channel_id);
      convId = channelConv.get(channelId) || '';
    } else {
      convId = peerConv.get(to) || '';
      if (!convId && to) {
        const res = await req('/conversations/dm', { method: 'POST', body: { userId: to } });
        const c = dataOf(res).conversation;
        indexConv(c);
        convId = c.id;
      }
    }
    if (!convId || !to) return { ok: false, error: 'Нет адресата звонка' };
    const res = await req(`/conversations/${encodeURIComponent(convId)}/signals`, {
      method: 'POST',
      body: {
        type,
        toUserId: to,
        channelId,
        sdp: p.sdp || null,
        candidate: p.candidate || null,
      },
    });
    dataOf(res);
    return { ok: true };
  }
  if (type === 'chat_message_pin' || type === 'room_message_pin') {
    const meta = msgMeta.get(Number(p.message_id));
    if (!meta) return { ok: false, error: 'Сообщение не найдено' };
    const res = await req(
      `/conversations/${encodeURIComponent(meta.convId)}/messages/${encodeURIComponent(strOf(p.message_id))}/pin`,
      { method: 'POST', body: { pinned: p.pinned !== false } },
    );
    const message = dataOf(res).message;
    await onWs({
      type: type === 'chat_message_pin' ? 'chat_message_pinned' : 'room_message_pinned',
      message_id: Number(p.message_id),
      is_pinned: Boolean(message?.pinned),
    });
    return { ok: true };
  }
  if (type === 'ping') {
    const t0 = performance.now();
    const res = await req('/rtc-config');
    if (!res || res.ok === false) return { ok: false };
    return { ok: true, ms: Math.max(1, Math.round(performance.now() - t0)) };
  }
  if (type.endsWith('_edit')) {
    const meta = msgMeta.get(Number(p.message_id));
    if (!meta) return { ok: false, error: 'Сообщение не найдено' };
    const res = await req(
      `/conversations/${encodeURIComponent(meta.convId)}/messages/${encodeURIComponent(strOf(p.message_id))}`,
      { method: 'PATCH', body: { body: p.text } },
    );
    const message = dataOf(res).message;
    await onWs({
      type: type.startsWith('chat_') ? 'chat_message_edited' : 'room_message_edited',
      message_id: Number(p.message_id),
      id: Number(p.message_id),
      text: String(message?.body || p.text || ''),
      edited_at: message?.editedAt ? iso(Number(message.editedAt)) : new Date().toISOString(),
    });
    return { ok: true };
  }
  return { ok: true };
}

function buildApi(): ChatsApi {
  return {
    cloudEndpoints: async () => ({ masterUrl: getApiBase() }),
    cloudProfileMe: async () => ({
      profile: { id: idOf(meId), username: S.me.username, avatar_url: S.me.avatar },
    }),
    cloudRooms: async () => {
      const list = await loadConversationList();
      const rooms: any[] = [];
      for (const c of list) {
        if (!c || c.type === 'dm') continue;
        if (c.type !== 'group' && !c.isProject && c.peer?.id) continue;
        try {
          rooms.push(toRoom(c));
        } catch {
          /* один сервер не обнуляет рельс */
        }
      }
      return { ok: true, rooms };
    },
    cloudDmList: async () => {
      const list = await loadConversationList();
      const dms: any[] = [];
      for (const c of list) {
        const dm = c?.type === 'dm' || (c?.peer?.id && c?.type !== 'group' && !c?.isProject);
        if (!dm) continue;
        try {
          const row = toDm(c);
          if (row) dms.push(row);
        } catch {
          /* один диалог не обнуляет список */
        }
      }
      return { ok: true, dms, masterUrl: getApiBase() };
    },
    cloudFriends: async () => {
      const res = await req('/friends');
      const d = dataOf(res);
      let blocked: any[] = [];
      try {
        const b = await req('/users/blocked');
        blocked = dataOf(b).users || dataOf(b) || [];
        if (!Array.isArray(blocked)) blocked = [];
      } catch {
        blocked = [];
      }
      return {
        friends: (d.friends || []).map(toFriend),
        incoming: (d.incoming || []).map(toFriend),
        outgoing: (d.outgoing || []).map(toFriend),
        blocked: blocked.map(toFriend),
      };
    },
    cloudInbox: async () => ({ invites: [] }),
    cloudRoomDetail: async (roomId: number) => {
      const id = strOf(roomId);
      const [c, channels] = await Promise.all([convOf(id), channelsOf(id)]);
      return toDetail(c, channels);
    },
    cloudRoomMembersV2: async (roomId: number) => {
      const c = await convOf(strOf(roomId));
      return (c.members || []).map(toMember);
    },
    cloudDmHistory: async (peerId: number, limit?: number, before?: number) => {
      const convId = peerConv.get(strOf(peerId));
      if (!convId) return { messages: [] };
      const beforeAt = before ? msgMeta.get(before)?.at : undefined;
      const res = await req(`/conversations/${encodeURIComponent(convId)}/messages`, {
        query: { limit: limit || 50, before: beforeAt },
      });
      const msgs = (dataOf(res).messages || []).map((m: any) => toMessage(m, convId, null));
      return { messages: msgs };
    },
    cloudChannelHistory: async (roomId: number, channelId: number, limit?: number, before?: number) => {
      const convId = strOf(roomId) || channelConv.get(strOf(channelId)) || '';
      const ch = strOf(channelId);
      if (!convId) return { messages: [] };
      const beforeAt = before ? msgMeta.get(before)?.at : undefined;
      const query: Record<string, string | number | undefined> = { limit: limit || 50, before: beforeAt };
      if (ch && !isLocalChannel(ch)) query.channelId = ch;
      const res = await req(`/conversations/${encodeURIComponent(convId)}/messages`, { query });
      const msgs = (dataOf(res).messages || []).map((m: any) => toMessage(m, convId, m.channelId || (isLocalChannel(ch) ? null : ch)));
      return { messages: msgs };
    },
    cloudProfileUser: async (uid: number) => {
      const id = strOf(uid);
      try {
        const res = await req(`/users/${encodeURIComponent(id)}/profile`);
        const u = dataOf(res).user || dataOf(res);
        rememberUser(u);
        return {
          profile: {
            id: uid,
            username: u.username || nameOf(id),
            avatar_url: faceOf(u),
            bio: u.bio || null,
          },
        };
      } catch {
        return { profile: { id: uid, username: nameOf(id), avatar_url: faces.get(id) || null } };
      }
    },
    cloudUserMutual: async (uid: number) => {
      const id = strOf(uid);
      const servers = [...convById.values()]
        .filter((c) => c.type === 'group' && (c.members || []).some((m: any) => m.id === id))
        .map((c) => ({ id: idOf(c.id), name: c.title, avatar_url: c.avatarUrl || null }));
      const friend = [...convById.values()].some((c) => c.type === 'dm' && c.peer?.id === id);
      return { servers, friends: [], relation: friend ? 'friend' : 'none' };
    },
    cloudRtcConfig: async () => {
      const res = await req('/rtc-config');
      return dataOf(res);
    },
    cloudJoinVoiceChannel: async (channelId: number) => {
      const ch = strOf(channelId);
      const convId = channelConv.get(ch);
      if (!convId || !ch) throw new Error('Голосовой канал не найден');
      const res = await req(`/conversations/${encodeURIComponent(convId)}/voice/${encodeURIComponent(ch)}/join`, {
        method: 'POST',
        body: {},
      });
      dataOf(res);
      return { can_speak: true };
    },
    cloudLeaveVoiceChannel: async (channelId: number) => {
      const ch = strOf(channelId);
      const convId = channelConv.get(ch);
      if (!convId || !ch) return { ok: true };
      await req(`/conversations/${encodeURIComponent(convId)}/voice/${encodeURIComponent(ch)}/leave`, {
        method: 'POST',
        body: {},
      });
      return { ok: true };
    },
    cloudWsSend: (p) => onCloudWsSend(p),
    onCloudWsMessage: () => undefined,
    cloudCreateRoom: async (name: string, _members?: string[], desc?: string) => {
      const res = await req('/conversations/group', { method: 'POST', body: { title: name } });
      const c = dataOf(res).conversation;
      indexConv(c);
      if (desc) {
        await req(`/conversations/${encodeURIComponent(c.id)}`, {
          method: 'PATCH',
          body: { description: desc },
        });
      }
      const id = idOf(c.id);
      return { id, room: { id } };
    },
    cloudUpdateRoom: async (roomId: number, patch: { name?: string; description?: string }) => {
      const res = await req(`/conversations/${encodeURIComponent(strOf(roomId))}`, {
        method: 'PATCH',
        body: { title: patch.name, description: patch.description },
      });
      return dataOf(res);
    },
    cloudLeaveRoom: async (roomId: number) => {
      if (!meId) return { ok: false };
      const res = await req(`/conversations/${encodeURIComponent(strOf(roomId))}/members/${encodeURIComponent(meId)}`, {
        method: 'DELETE',
      });
      return dataOf(res);
    },
    cloudDeleteRoom: async (roomId: number) => {
      const res = await req(`/conversations/${encodeURIComponent(strOf(roomId))}`, { method: 'DELETE' });
      return dataOf(res);
    },
    cloudCreateTextChannel: async (roomId: number, body: Record<string, unknown>) => {
      const res = await req(`/conversations/${encodeURIComponent(strOf(roomId))}/channels`, {
        method: 'POST',
        body: {
          name: body.name,
          kind: 'text',
          categoryId: body.category_id ? strOf(body.category_id) : undefined,
          topic: body.topic,
          slowmode_seconds: body.slowmode_seconds,
          channel_kind: body.channel_kind,
        },
      });
      const ch = dataOf(res).channel;
      channelConv.set(ch.id, strOf(roomId));
      return { id: idOf(ch.id), channel: { id: idOf(ch.id) } };
    },
    cloudCreateCategory: async (roomId: number, body: Record<string, unknown>) => {
      const res = await req(`/conversations/${encodeURIComponent(strOf(roomId))}/categories`, {
        method: 'POST',
        body: { name: body.name },
      });
      const cat = dataOf(res).category;
      return { id: idOf(cat.id), category: { id: idOf(cat.id) } };
    },
    cloudUpdateCategory: async (roomId: number, categoryId: number, body: Record<string, unknown>) => {
      const patch: Record<string, unknown> = {};
      if (body.name !== undefined) patch.name = body.name;
      if (body.position !== undefined) patch.position = Number(body.position);
      const res = await req(
        `/conversations/${encodeURIComponent(strOf(roomId))}/categories/${encodeURIComponent(strOf(categoryId))}`,
        { method: 'PATCH', body: patch },
      );
      return dataOf(res);
    },
    cloudDeleteCategory: async (roomId: number, categoryId: number) => {
      const res = await req(
        `/conversations/${encodeURIComponent(strOf(roomId))}/categories/${encodeURIComponent(strOf(categoryId))}`,
        { method: 'DELETE' },
      );
      return dataOf(res);
    },
    cloudCreateVoiceChannel: async (roomId: number, body: Record<string, unknown>) => {
      const res = await req(`/conversations/${encodeURIComponent(strOf(roomId))}/channels`, {
        method: 'POST',
        body: {
          name: body.name,
          kind: 'voice',
          categoryId: body.category_id ? strOf(body.category_id) : undefined,
          user_limit: body.user_limit,
        },
      });
      const ch = dataOf(res).channel;
      channelConv.set(ch.id, strOf(roomId));
      return { id: idOf(ch.id) };
    },
    cloudDeleteTextChannel: async (roomId: number, channelId: number) => {
      const res = await req(
        `/conversations/${encodeURIComponent(strOf(roomId))}/channels/${encodeURIComponent(strOf(channelId))}`,
        { method: 'DELETE' },
      );
      return dataOf(res);
    },
    cloudUpdateTextChannel: async (roomId: number, channelId: number, body: Record<string, unknown>) => {
      const res = await req(
        `/conversations/${encodeURIComponent(strOf(roomId))}/channels/${encodeURIComponent(strOf(channelId))}`,
        { method: 'PATCH', body: channelPatch(body) },
      );
      return dataOf(res);
    },
    cloudUpdateVoiceChannel: async (roomId: number, channelId: number, body: Record<string, unknown>) => {
      const res = await req(
        `/conversations/${encodeURIComponent(strOf(roomId))}/channels/${encodeURIComponent(strOf(channelId))}`,
        { method: 'PATCH', body: channelPatch(body) },
      );
      return dataOf(res);
    },
    cloudDeleteVoiceChannel: async (roomId: number, channelId: number) => {
      const res = await req(
        `/conversations/${encodeURIComponent(strOf(roomId))}/channels/${encodeURIComponent(strOf(channelId))}`,
        { method: 'DELETE' },
      );
      return dataOf(res);
    },
    cloudUploadRoomAvatar: async (roomId: number, bytes: Uint8Array, name: string) => {
      const mime = name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
      const res = await req(`/conversations/${encodeURIComponent(strOf(roomId))}`, {
        method: 'PATCH',
        body: { avatarDataUrl: `data:${mime};base64,${bytesToB64(bytes)}` },
      });
      return dataOf(res);
    },
    cloudUploadRoomBanner: async (roomId: number, bytes: Uint8Array, name: string) => {
      const mime = name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
      const res = await req(`/conversations/${encodeURIComponent(strOf(roomId))}`, {
        method: 'PATCH',
        body: { coverDataUrl: `data:${mime};base64,${bytesToB64(bytes)}` },
      });
      return dataOf(res);
    },
    cloudUploadDmFile: async (bytes: Uint8Array, name: string, mime?: string) => stashFile(bytes, name, mime),
    cloudUploadRoomFile: async (_roomId: number, bytes: Uint8Array, name: string, mime?: string) => stashFile(bytes, name, mime),
    cloudCreateInvite: async (roomId: number, body?: { max_uses?: number; expires_at?: string | null }) => {
      const id = strOf(roomId);
      if (!id) throw new Error('Сервер не найден');
      const res = await req(`/conversations/${encodeURIComponent(id)}/invites`, {
        method: 'POST',
        body: {
          expiresAt: body?.expires_at === undefined ? undefined : body.expires_at,
          maxUses: body?.max_uses || null,
        },
      });
      const d = dataOf(res);
      const code = String(d.invite?.token || d.token || '');
      if (!code) throw new Error('Сервер не вернул код приглашения');
      return {
        id: idOf(code),
        code,
        url: d.deepLink || d.url || '',
        creator_id: d.invite?.inviter?.id ? idOf(d.invite.inviter.id) : undefined,
        uses: 0,
        max_uses: body?.max_uses || null,
        expires_at: d.invite?.expiresAt ? new Date(d.invite.expiresAt).toISOString() : body?.expires_at || null,
      };
    },
    cloudGetInvite: async (code: string) => {
      const res = await req(`/invites/${encodeURIComponent(code)}`);
      return dataOf(res);
    },
    cloudJoinInvite: async (code: string) => {
      const res = await req(`/invites/${encodeURIComponent(code)}/join`, { method: 'POST', body: {} });
      const c = dataOf(res).conversation;
      indexConv(c);
      return { room_id: idOf(c.id) };
    },
    cloudAckDm: async (peerId: number) => {
      const convId = peerConv.get(strOf(peerId));
      if (!convId) return { ok: true };
      await req(`/conversations/${encodeURIComponent(convId)}/read`, { method: 'POST', body: {} });
      return { ok: true };
    },
    cloudAckChannel: async (roomId: number) => {
      const convId = strOf(roomId);
      if (!convId) return { ok: true };
      await req(`/conversations/${encodeURIComponent(convId)}/read`, { method: 'POST', body: {} });
      return { ok: true };
    },
    cloudFriendRequest: async (body: { username?: string; user_id?: number }) => {
      let id = body.user_id ? strOf(body.user_id) : '';
      if (!id && body.username) {
        const res = await req('/users/search', { query: { q: body.username, limit: 5 } });
        const users = dataOf(res).users || [];
        const found = users.find((u: any) => String(u.username).toLowerCase() === body.username!.toLowerCase()) || users[0];
        id = found?.id || '';
      }
      if (!id) throw new Error('Пользователь не найден');
      const res = await req(`/friends/${encodeURIComponent(id)}/request`, { method: 'POST', body: {} });
      return dataOf(res);
    },
    cloudFriendAccept: async (uid: number) => {
      const res = await req(`/friends/${encodeURIComponent(strOf(uid))}/accept`, { method: 'POST', body: {} });
      return dataOf(res);
    },
    cloudFriendRemove: async (uid: number) => {
      const res = await req(`/friends/${encodeURIComponent(strOf(uid))}`, { method: 'DELETE' });
      return dataOf(res);
    },
    cloudKickMember: async (roomId: number, uid: number) => {
      const res = await req(
        `/conversations/${encodeURIComponent(strOf(roomId))}/members/${encodeURIComponent(strOf(uid))}`,
        { method: 'DELETE' },
      );
      return dataOf(res);
    },
    cloudGroupAdd: async (roomId: number, ids: number[]) => {
      const res = await req(`/conversations/${encodeURIComponent(strOf(roomId))}/members`, {
        method: 'POST',
        body: { memberIds: ids.map((id) => strOf(id)).filter(Boolean) },
      });
      return dataOf(res);
    },
    cloudGroupRemove: async (roomId: number, uid: number) => {
      const res = await req(
        `/conversations/${encodeURIComponent(strOf(roomId))}/members/${encodeURIComponent(strOf(uid))}`,
        { method: 'DELETE' },
      );
      return dataOf(res);
    },
    cloudGroupRename: async (roomId: number, name: string) => {
      const res = await req(`/conversations/${encodeURIComponent(strOf(roomId))}`, {
        method: 'PATCH',
        body: { title: name },
      });
      return dataOf(res);
    },
    cloudDmPins: async (peerId: number) => {
      const convId = peerConv.get(strOf(peerId));
      if (!convId) return { messages: [] };
      const res = await req(`/conversations/${encodeURIComponent(convId)}/pins`);
      const msgs = (dataOf(res).messages || []).map((m: any) => toMessage(m, convId, null));
      return { messages: msgs };
    },
    cloudChannelPins: async (roomId: number, channelId: number) => {
      const convId = strOf(roomId) || channelConv.get(strOf(channelId)) || '';
      const ch = strOf(channelId);
      if (!convId) return { messages: [] };
      const res = await req(`/conversations/${encodeURIComponent(convId)}/pins`, {
        query: { channelId: ch && !isLocalChannel(ch) ? ch : undefined },
      });
      const msgs = (dataOf(res).messages || []).map((m: any) => toMessage(m, convId, m.channelId || null));
      return { messages: msgs };
    },
    cloudDmSearch: async (peerId: number, query: string) => {
      const convId = peerConv.get(strOf(peerId));
      if (!convId || !query.trim()) return { messages: [] };
      const res = await req(`/conversations/${encodeURIComponent(convId)}/messages/search`, { query: { q: query } });
      const msgs = (dataOf(res).messages || []).map((m: any) => toMessage(m, convId, null));
      return { messages: msgs };
    },
    cloudChannelSearch: async (roomId: number, channelId: number, query: string) => {
      const convId = strOf(roomId);
      const ch = strOf(channelId);
      if (!convId || !query.trim()) return { messages: [] };
      const res = await req(`/conversations/${encodeURIComponent(convId)}/messages/search`, {
        query: { q: query, channelId: ch && !isLocalChannel(ch) ? ch : undefined },
      });
      const msgs = (dataOf(res).messages || []).map((m: any) => toMessage(m, convId, m.channelId || null));
      return { messages: msgs };
    },
    cloudStickers: async () => {
      const res = await req('/stickers');
      return { stickers: dataOf(res).stickers || [] };
    },
    cloudMyStickers: async () => {
      const res = await req('/stickers/mine');
      return { stickers: dataOf(res).stickers || [] };
    },
    cloudStickerCatalog: async () => {
      const res = await req('/stickers/catalog');
      return { packs: dataOf(res).packs || [] };
    },
    cloudStickerPack: async (pack: string, add: boolean) => {
      const res = await req('/stickers/packs', { method: 'POST', body: { pack, add } });
      return dataOf(res);
    },
    cloudGameLookup: async () => ({ game: null }),
    cloudReport: async (body: Record<string, unknown>) => {
      const res = await req('/reports', {
        method: 'POST',
        body: {
          reason: body.reason,
          target_type: body.target_type,
          target_id: body.target_id != null ? strOf(body.target_id) || String(body.target_id) : null,
          room_id: body.room_id != null ? strOf(body.room_id) : null,
        },
      });
      return dataOf(res);
    },
    cloudListRoles: async (roomId: number) => {
      const id = strOf(roomId);
      if (!id) return [];
      const res = await req(`/conversations/${encodeURIComponent(id)}/roles`);
      return (dataOf(res).roles || []).map(toRole);
    },
    cloudCreateRole: async (roomId: number, body: Record<string, unknown>) => {
      const id = strOf(roomId);
      const res = await req(`/conversations/${encodeURIComponent(id)}/roles`, { method: 'POST', body });
      forgetConv(id);
      return toRole(dataOf(res).role);
    },
    cloudUpdateRole: async (roomId: number, roleId: number, body: Record<string, unknown>) => {
      const id = strOf(roomId);
      const role = strOf(roleId);
      const res = await req(`/conversations/${encodeURIComponent(id)}/roles/${encodeURIComponent(role)}`, {
        method: 'PATCH',
        body,
      });
      forgetConv(id);
      return toRole(dataOf(res).role);
    },
    cloudDeleteRole: async (roomId: number, roleId: number) => {
      const id = strOf(roomId);
      const role = strOf(roleId);
      const res = await req(`/conversations/${encodeURIComponent(id)}/roles/${encodeURIComponent(role)}`, {
        method: 'DELETE',
      });
      forgetConv(id);
      return dataOf(res);
    },
    cloudAssignRole: async (roomId: number, userId: number, roleId: number) => {
      const id = strOf(roomId);
      const user = strOf(userId);
      const role = strOf(roleId);
      if (!id || !user || !role) throw new Error('Не удалось сопоставить участника и роль');
      const res = await req(
        `/conversations/${encodeURIComponent(id)}/members/${encodeURIComponent(user)}/roles`,
        { method: 'POST', body: { roleId: role } },
      );
      forgetConv(id);
      return dataOf(res);
    },
    cloudRemoveRole: async (roomId: number, userId: number, roleId: number) => {
      const id = strOf(roomId);
      const res = await req(
        `/conversations/${encodeURIComponent(id)}/members/${encodeURIComponent(strOf(userId))}/roles/${encodeURIComponent(strOf(roleId))}`,
        { method: 'DELETE' },
      );
      forgetConv(id);
      return dataOf(res);
    },
    cloudListBans: async (roomId: number) => {
      const id = strOf(roomId);
      if (!id) return [];
      const res = await req(`/conversations/${encodeURIComponent(id)}/bans`);
      return (dataOf(res).bans || []).map((b: any) => ({
        ...b,
        user_id: idOf(b.user_id),
        expires_at: b.expires_at ? iso(Number(b.expires_at)) : null,
        is_permanent: Boolean(b.is_permanent),
      }));
    },
    cloudBanUser: async (roomId: number, userId: number, reason?: string, permanent?: boolean) => {
      const res = await req(`/conversations/${encodeURIComponent(strOf(roomId))}/bans`, {
        method: 'POST',
        body: { userId: strOf(userId), reason: reason || '', permanent: permanent !== false },
      });
      return dataOf(res);
    },
    cloudUnbanUser: async (roomId: number, userId: number) => {
      const res = await req(
        `/conversations/${encodeURIComponent(strOf(roomId))}/bans/${encodeURIComponent(strOf(userId))}`,
        { method: 'DELETE' },
      );
      return dataOf(res);
    },
    cloudListMutes: async (roomId: number) => {
      const id = strOf(roomId);
      if (!id) return [];
      const res = await req(`/conversations/${encodeURIComponent(id)}/mutes`);
      return (dataOf(res).mutes || []).map((m: any) => ({
        ...m,
        user_id: idOf(m.user_id),
        expires_at: m.expires_at ? iso(Number(m.expires_at)) : null,
      }));
    },
    cloudUnmuteUser: async (roomId: number, userId: number) => {
      const res = await req(
        `/conversations/${encodeURIComponent(strOf(roomId))}/members/${encodeURIComponent(strOf(userId))}/mute`,
        { method: 'DELETE' },
      );
      return dataOf(res);
    },
    cloudMuteUser: async (roomId: number, userId: number, reason?: string, minutes = 60) => {
      const res = await req(
        `/conversations/${encodeURIComponent(strOf(roomId))}/members/${encodeURIComponent(strOf(userId))}/mute`,
        { method: 'POST', body: { minutes, reason: reason || '' } },
      );
      return dataOf(res);
    },
    cloudSetMemberNickname: async (roomId: number, userId: number, nickname: string | null) => {
      const res = await req(
        `/conversations/${encodeURIComponent(strOf(roomId))}/members/${encodeURIComponent(strOf(userId))}/nickname`,
        { method: 'PATCH', body: { nickname } },
      );
      return dataOf(res);
    },
    cloudRoomSettings: async (roomId: number) => {
      const res = await req(`/conversations/${encodeURIComponent(strOf(roomId))}/settings`);
      return dataOf(res);
    },
    cloudUpdateRoomSettings: async (roomId: number, body: Record<string, unknown>) => {
      const id = strOf(roomId);
      const channelId = (value: unknown) => {
        if (value == null || value === '') return null;
        const raw = strOf(value);
        return raw || null;
      };
      const res = await req(`/conversations/${encodeURIComponent(id)}/settings`, {
        method: 'PATCH',
        body: {
          ...body,
          system_channel_id: channelId(body.system_channel_id),
          rules_channel_id: channelId(body.rules_channel_id),
        },
      });
      const data = dataOf(res);
      // Иначе convOf вернёт беседу до правки, и форма сразу откатится.
      convById.delete(id);
      return data;
    },
    cloudListInvites: async (roomId: number) => {
      const id = strOf(roomId);
      if (!id) return [];
      const res = await req(`/conversations/${encodeURIComponent(id)}/invites`);
      const list = dataOf(res).invites || [];
      return list.map((item: any) => ({
        id: idOf(item.token),
        code: item.token,
        creator_id: item.createdBy ? idOf(item.createdBy) : 0,
        uses: Number(item.uses) || 0,
        max_uses: item.maxUses || null,
        expires_at: item.expiresAt ? new Date(item.expiresAt).toISOString() : null,
      }));
    },
    cloudDeleteInvite: async (roomId: number, inviteId: number) => {
      const id = strOf(roomId);
      const token = strOf(inviteId);
      if (!id || !token) throw new Error('Приглашение не найдено');
      const res = await req(`/conversations/${encodeURIComponent(id)}/invites/${encodeURIComponent(token)}`, {
        method: 'DELETE',
      });
      return dataOf(res);
    },
    cloudRoomAudit: async (roomId: number) => {
      const id = strOf(roomId);
      if (!id) return [];
      const res = await req(`/conversations/${encodeURIComponent(id)}/audit`);
      return (dataOf(res).audit || []).map((row: any) => ({
        ...row,
        created_at: row.created_at ? iso(Number(row.created_at)) : null,
      }));
    },
    openExternal: (url) => openExternal(url),
    openUserProfile: (uid) => {
      const id = strOf(uid);
      if (id) openProfile(id);
    },
  };
}

function stashMime(name: string, mime?: string): string {
  const given = String(mime || '').trim();
  // Пустой type у .gif с проводника иначе уходит как octet-stream, и <img> показывает один кадр.
  if (given === 'image/gif' || /\.gif$/i.test(name)) return 'image/gif';
  return given || 'application/octet-stream';
}

function stashFile(bytes: Uint8Array, name: string, mime?: string): { url: string; url_abs: string } {
  if (bytes.length > 12 * 1024 * 1024) throw new Error('Файл больше 12 МБ');
  const key = `mem:${++fileSeq}`;
  const type = stashMime(name, mime);
  const stored = type === 'image/gif' && !/\.gif$/i.test(name) ? `${name || 'image'}.gif` : name;
  files.set(key, { name: stored, mime: type, b64: bytesToB64(bytes) });
  return { url: key, url_abs: key };
}

async function onLive(eventName: string, data: any): Promise<void> {
  if (!data || typeof data !== 'object') return;
  if (eventName === 'message' && data.message) {
    const convId = String(data.conversationId || data.message.conversationId || '');
    const c = convById.get(convId) || data.conversation;
    if (c) indexConv(c);
    const mine = data.message.senderId === meId;
    if (!c || c.type === 'dm') {
      const peer = c?.peer?.id || (mine ? '' : data.message.senderId);
      const peerId = peer || [...peerConv.entries()].find(([, id]) => id === convId)?.[0] || '';
      await onWs({
        type: 'chat_message',
        ...toMessage(data.message, convId, null),
        receiver_id: idOf(mine ? peerId : meId),
        sender_id: idOf(data.message.senderId),
      });
      return;
    }
    if (!generalOf.has(convId)) {
      try {
        await channelsOf(convId);
      } catch {
        /* канал подтянется с деталями */
      }
    }
    await onWs({
      type: 'room_message',
      ...toMessage(data.message, convId, data.message.channelId || null),
      room_id: idOf(convId),
      sender_id: idOf(data.message.senderId),
    });
    return;
  }
  if (eventName === 'message_deleted' && data.message) {
    const convId = String(data.conversationId || data.message.conversationId || '');
    const c = convById.get(convId);
    const dm = !c || c.type === 'dm';
    const num = idOf(data.message.id);
    const sender = String(data.message.senderId || '');
    let peer = '';
    if (dm) {
      peer = String(c?.peer?.id || '');
      if (!peer) {
        for (const [userId, id] of peerConv) if (id === convId) peer = userId;
      }
    }
    await onWs({
      type: dm ? 'chat_message_deleted' : 'room_message_deleted',
      id: num,
      message_id: num,
      channel_id: dm ? undefined : textChannelId(convId, data.message.channelId),
      sender_id: sender ? idOf(sender) : undefined,
      receiver_id: dm ? idOf(sender === meId ? peer : meId) : undefined,
    });
    return;
  }
  if (eventName === 'reaction' && data.message) {
    const convId = String(data.conversationId || '');
    const c = convById.get(convId);
    const raw = toMessage(data.message, convId, data.message.channelId || null);
    await onWs({
      type: c?.type === 'dm' ? 'chat_message_reaction' : 'room_message_reaction',
      ...raw,
      message_id: raw.id,
    });
    return;
  }
  if (eventName === 'activity' && data?.userId) {
    noteActivity(idOf(data.userId), String(data.userId), String(data.username || nameOf(data.userId)), data.activity);
    return;
  }
  if (eventName === 'game_invite' && data?.from?.id) {
    const host =
      data.publicHost && data.publicPort
        ? `${data.publicHost}:${data.publicPort}`
        : data.host
          ? `${data.host}${data.port ? `:${data.port}` : ''}`
          : '';
    noteActivity(
      idOf(data.from.id),
      String(data.from.id),
      String(data.from.username || ''),
      {
        playing: true,
        hosting: true,
        worldShare: data.worldShare !== false,
        build: data.buildName,
        version: data.gameVersion,
        serverName: data.serverName,
        serverHost: host,
      },
      data.sessionId ? String(data.sessionId) : '',
    );
    return;
  }
  if (eventName === 'game_invite_ended' && data?.from?.id) {
    noteInviteEnded(idOf(data.from.id), data.sessionId ? String(data.sessionId) : '');
    return;
  }
  if (eventName === 'message_edited' && data?.message) {
    const convId = String(data.conversationId || data.message.conversationId || '');
    const c = convById.get(convId);
    const dm = !c || c.type === 'dm';
    await onWs({
      type: dm ? 'chat_message_edited' : 'room_message_edited',
      message_id: idOf(data.message.id),
      id: idOf(data.message.id),
      text: String(data.message.body || ''),
      edited_at: data.message.editedAt ? iso(Number(data.message.editedAt)) : new Date().toISOString(),
    });
    return;
  }
  if (eventName === 'voice_mod') {
    const uid = idOf(data.userId);
    const ch = data.channelId ? idOf(data.channelId) : 0;
    if (data.action === 'disconnect') {
      await onWs({
        type: 'vc_force_disconnected',
        user_id: uid,
        voice_channel_id: ch,
        reason: data.reason || 'Вас отключили от голосового канала',
      });
      return;
    }
    await onWs({
      type: data.action === 'deafen' ? 'vc_server_deafened' : 'vc_server_muted',
      user_id: uid,
      voice_channel_id: ch,
      enabled: data.enabled !== false,
    });
    return;
  }
  if (eventName === 'typing') {
    await onWs({
      type: 'typing',
      from_id: idOf(data.userId),
      from_username: data.username,
      channel_id: data.channelId ? idOf(data.channelId) : undefined,
      receiver_id: data.userId && data.userId !== meId ? idOf(meId) : undefined,
    });
    return;
  }
  if (eventName === 'presence' && data.userId) {
    const uid = idOf(data.userId);
    const live = userLive({ id: data.userId, provider: data.provider, lastSeenAt: data.lastSeenAt, presenceStatus: data.presenceStatus });
    if (live) S.online.add(uid);
    else S.online.delete(uid);
    invalidate('sidebar', 'aside', 'rail');
    return;
  }
  if (eventName === 'signal') {
    await onWs({
      type: data.type,
      from_id: idOf(data.fromUserId),
      user_id: idOf(data.fromUserId),
      to_id: idOf(data.toUserId),
      voice_channel_id: data.channelId ? idOf(data.channelId) : 0,
      room_id: data.conversationId ? idOf(data.conversationId) : 0,
      sdp: data.sdp,
      candidate: data.candidate,
    });
    return;
  }
  if (eventName === 'voice') {
    const members = Array.isArray(data.members) ? data.members : [];
    const base = {
      voice_channel_id: idOf(data.channelId),
      room_id: idOf(data.conversationId),
      from_id: idOf(data.userId),
      user_id: idOf(data.userId),
      muted: Boolean(data.muted),
      deafened: Boolean(data.deafened),
      members: members.map((m: any) => ({
        user_id: idOf(m.userId),
        id: idOf(m.userId),
        self_muted: Boolean(m.muted),
        self_deafened: Boolean(m.deafened),
        server_muted: Boolean(m.serverMuted),
      })),
    };
    const action = String(data.action || '');
    if (action === 'leave') await onWs({ type: 'vc_left', ...base });
    else if (action === 'state') await onWs({ type: 'vc_state', ...base });
    else await onWs({ type: 'vc_joined', ...base });
    return;
  }
  if (eventName === 'channels' || eventName === 'conversation' || eventName === 'conversation_updated' || eventName === 'member_changed') {
    const convId = String(data.conversationId || '');
    await loadLists();
    if (convId) {
      await loadDetail(idOf(convId)).catch(() => undefined);
      await loadMembers(idOf(convId)).catch(() => undefined);
    }
    invalidate('rail', 'sidebar', 'main', 'aside');
  }
}

/** События уже открытого SSE мессенджера. Звонки обрабатывает только экран v2. */
export function feedMessengerEvent(eventName: string, data: any): void {
  if (!controller || S.me.id == null) return;
  void onLive(eventName, data).catch(() => undefined);
}

/** Показать экран v2 после сессии или убрать его без аккаунта. */
export function syncChatsScreen(session: ChatsScreenSession | null): void {
  if (!session?.me?.id) {
    meId = '';
    token = '';
    controller?.setUserId(null);
    return;
  }
  req = session.req;
  token = session.token || '';
  meId = session.me.id;
  openProfile = session.openProfile;
  if (session.openExternal) openExternal = session.openExternal;
  rememberUser(session.me);
  if (!controller) controller = initChats(buildApi());
  S.me.username = session.me.username || '';
  S.me.key = session.me.id;
  S.me.avatar = faceOf(session.me);
  const id = idOf(session.me.id);
  const first = S.me.id == null || !S.booted;
  controller.setUserId(id);
  if (!first) void controller.refresh();
}
