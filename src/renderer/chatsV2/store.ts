// Состояние чатов v2: данные мастера, кэши бесед/профилей/игр, загрузчики и планировщик перерисовки.
import type {
  ChatsApi,
  ConvKey,
  Dm,
  FriendUser,
  FriendsData,
  GameInfo,
  InboxInvite,
  IpcResult,
  Member,
  ChannelOverwrite,
  Message,
  Mutual,
  Profile,
  Reaction,
  Room,
  RoomDetail,
  TextChannel,
  UserLite,
  View,
  VoiceChannel,
} from './types';
import { resolveChannelPerm } from './channelPerms';
import { sameId, setMasterBase } from './util';

// ===== Регионы перерисовки =====

export type Region = 'rail' | 'sidebar' | 'main' | 'aside' | 'feed' | 'header' | 'voice' | 'badge' | 'composer' | 'layout';

type Renderer = (regions: Set<Region>) => void;

let renderer: Renderer | null = null;
const dirty = new Set<Region>();
let rafId = 0;

export function setRenderer(fn: Renderer): void {
  renderer = fn;
}

/** Отложенная перерисовка: несколько invalidate за кадр → один проход. */
export function invalidate(...regions: Region[]): void {
  for (const r of regions) dirty.add(r);
  if (rafId) return;
  rafId = requestAnimationFrame(() => {
    rafId = 0;
    const set = new Set(dirty);
    dirty.clear();
    renderer?.(set);
    window.dispatchEvent(new CustomEvent('gs-mail-changed'));
  });
}

export const ALL: Region[] = ['rail', 'sidebar', 'main', 'aside', 'badge', 'voice'];

// ===== Состояние =====

export type Conv = {
  list: Message[];
  hasMore: boolean;
  loading: boolean;
  loaded: boolean;
  /** id первого непрочитанного на момент открытия — для разделителя «Новые» */
  unreadFrom: number | null;
};

const LS_RAIL_ORDER = 'cv2.railOrder';
const LS_COLLAPSED = 'cv2.collapsedCats';
const LS_PROFILE = 'cv2.profileOpen';
const LS_MEMBERS = 'cv2.membersOpen';
const LS_LAST_CH = 'cv2.lastChannel';
const LS_MUTED = 'cv2.mutedConvs';
const LS_CH_PREFS = 'cv2.chPrefs';

export type NotifyLevel = 'all' | 'mentions' | 'none';

type ChPrefs = {
  fav: string[];
  pinned: string[];
  /** site id канала → момент включения звука. 0 — пока пользователь сам не включит. */
  mutedUntil: Record<string, number>;
  notify: Record<string, NotifyLevel>;
  hiddenCats: string[];
  showAll: string[];
  hideMuted: string[];
  roomNotify: Record<string, NotifyLevel>;
};

function readChPrefs(): ChPrefs {
  const raw = lsGet<Partial<ChPrefs>>(LS_CH_PREFS, {});
  return {
    fav: Array.isArray(raw.fav) ? raw.fav : [],
    pinned: Array.isArray(raw.pinned) ? raw.pinned : [],
    mutedUntil: raw.mutedUntil && typeof raw.mutedUntil === 'object' ? raw.mutedUntil : {},
    notify: raw.notify && typeof raw.notify === 'object' ? raw.notify : {},
    hiddenCats: Array.isArray(raw.hiddenCats) ? raw.hiddenCats : [],
    showAll: Array.isArray(raw.showAll) ? raw.showAll : [],
    hideMuted: Array.isArray(raw.hideMuted) ? raw.hideMuted : [],
    roomNotify: raw.roomNotify && typeof raw.roomNotify === 'object' ? raw.roomNotify : {},
  };
}

function lsGet<T>(key: string, def: T): T {
  try {
    const v = localStorage.getItem(key);
    return v == null ? def : (JSON.parse(v) as T);
  } catch {
    return def;
  }
}

export function lsSet(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* квота */
  }
}

export const S = {
  api: {} as ChatsApi,
  me: { id: null as number | null, username: '', avatar: '', color: '#303030', admin: false, key: '' },
  /** Стабильный id сайта (UUID) для числового id UI. Сравнение оффера голоса только по нему. */
  userKeys: new Map<number, string>(),
  wsStatus: 'offline',
  booted: false,
  loadError: '',
  view: { kind: 'friends', tab: 'online' } as View,
  rooms: [] as Room[],
  dms: [] as Dm[],
  friends: { friends: [], incoming: [], outgoing: [], blocked: [] } as FriendsData,
  inbox: [] as InboxInvite[],
  users: new Map<number, UserLite>(),
  online: new Set<number>(),
  games: new Map<number, string>(),
  details: new Map<number, RoomDetail>(),
  members: new Map<number, Member[]>(),
  convs: new Map<ConvKey, Conv>(),
  typing: new Map<ConvKey, Map<number, number>>(),
  profiles: new Map<number, Profile>(),
  mutuals: new Map<number, Mutual>(),
  gameInfo: new Map<string, GameInfo | undefined>(),
  /** Непрочитанные текстовых каналов: channelId → {u, m} */
  chUnread: new Map<number, { u: number; m: number }>(),
  /** Где сейчас голос пользователей (из vc_joined/vc_left и detail): channelId → userIds */
  voiceMembers: new Map<number, number[]>(),
  /** Комната каждого голосового канала (для vc_* событий без room_id) */
  voiceRoom: new Map<number, number>(),
  /** Файлы в процессе загрузки — показываются в конце ленты своей беседы */
  uploads: new Map<string, { key: ConvKey; name: string; size: number }>(),
  ui: {
    profileOpen: lsGet<boolean>(LS_PROFILE, true),
    membersOpen: lsGet<boolean>(LS_MEMBERS, true),
    friendsQuery: '',
    sidebarQuery: '',
    collapsed: new Set<string>(lsGet<string[]>(LS_COLLAPSED, [])),
    railOrder: lsGet<number[]>(LS_RAIL_ORDER, []),
    lastChannel: lsGet<Record<string, number>>(LS_LAST_CH, {}),
    /** Правая панель вместо профиля/участников: результаты поиска или закрепы */
    asidePanel: null as null | { kind: 'search' | 'pins'; query: string; results: Message[]; loading: boolean },
    replyTo: null as null | { key: ConvKey; msg: Message },
    editing: null as null | { key: ConvKey; id: number | string },
    drafts: new Map<ConvKey, string>(),
    addFriendStatus: null as null | { ok: boolean; text: string },
    mobileSidebar: false,
    /** Узкая раскладка: профиль/участники не открываются сами, а выезжают оверлеем по кнопке */
    compact: false,
    asideOverlay: false,
    /** site_id серверов, для которых не играть звук уведомления */
    mutedConvs: new Set<string>(lsGet<string[]>(LS_MUTED, [])),
    chPrefs: readChPrefs(),
  },
};

function saveChPrefs(): void {
  lsSet(LS_CH_PREFS, S.ui.chPrefs);
}

function mentionsMe(body: string): boolean {
  const name = (S.me.username || '').trim().toLowerCase();
  if (!name || !body) return false;
  return body.toLowerCase().includes(`@${name}`);
}

export function isConvSoundMuted(siteId: string): boolean {
  return Boolean(siteId) && S.ui.mutedConvs.has(siteId);
}

/** Переключает заглушку звука сервера. true — звук выключен. */
export function toggleConvSoundMute(siteId: string): boolean {
  if (!siteId) return false;
  if (S.ui.mutedConvs.has(siteId)) S.ui.mutedConvs.delete(siteId);
  else S.ui.mutedConvs.add(siteId);
  S.ui.chPrefs.roomNotify[siteId] = S.ui.mutedConvs.has(siteId) ? 'none' : 'all';
  lsSet(LS_MUTED, [...S.ui.mutedConvs]);
  saveChPrefs();
  return S.ui.mutedConvs.has(siteId);
}

export function roomNotify(siteId: string): NotifyLevel {
  if (!siteId) return 'all';
  return S.ui.chPrefs.roomNotify[siteId] || (S.ui.mutedConvs.has(siteId) ? 'none' : 'all');
}

export function setRoomNotify(siteId: string, level: NotifyLevel): void {
  if (!siteId) return;
  S.ui.chPrefs.roomNotify[siteId] = level;
  if (level === 'none') S.ui.mutedConvs.add(siteId);
  else S.ui.mutedConvs.delete(siteId);
  lsSet(LS_MUTED, [...S.ui.mutedConvs]);
  saveChPrefs();
}

function keyOn(list: string[], id: string): boolean {
  return Boolean(id) && list.includes(id);
}

function toggleKey(list: string[], id: string): boolean {
  if (!id) return false;
  const i = list.indexOf(id);
  if (i >= 0) list.splice(i, 1);
  else list.push(id);
  saveChPrefs();
  return list.includes(id);
}

export function isFavChannel(siteId: string): boolean {
  return keyOn(S.ui.chPrefs.fav, siteId);
}

export function toggleFavChannel(siteId: string): boolean {
  return toggleKey(S.ui.chPrefs.fav, siteId);
}

export function isPinnedChannel(siteId: string): boolean {
  return keyOn(S.ui.chPrefs.pinned, siteId);
}

export function togglePinnedChannel(siteId: string): boolean {
  return toggleKey(S.ui.chPrefs.pinned, siteId);
}

export function isChannelMuted(siteId: string): boolean {
  if (!siteId) return false;
  const until = S.ui.chPrefs.mutedUntil[siteId];
  if (until == null) return false;
  if (until === 0 || until > Date.now()) return true;
  delete S.ui.chPrefs.mutedUntil[siteId];
  saveChPrefs();
  return false;
}

/** ms = 0 — заглушить, пока пользователь сам не включит звук. */
export function muteChannel(siteId: string, ms: number): void {
  if (!siteId) return;
  S.ui.chPrefs.mutedUntil[siteId] = ms > 0 ? Date.now() + ms : 0;
  saveChPrefs();
}

export function unmuteChannel(siteId: string): void {
  if (!siteId) return;
  delete S.ui.chPrefs.mutedUntil[siteId];
  saveChPrefs();
}

export function channelNotify(siteId: string): NotifyLevel {
  if (!siteId) return 'all';
  return S.ui.chPrefs.notify[siteId] || 'all';
}

export function setChannelNotify(siteId: string, level: NotifyLevel): void {
  if (!siteId) return;
  if (level === 'all') delete S.ui.chPrefs.notify[siteId];
  else S.ui.chPrefs.notify[siteId] = level;
  saveChPrefs();
}

export function isCatHidden(siteId: string): boolean {
  return keyOn(S.ui.chPrefs.hiddenCats, siteId);
}

export function toggleCatHidden(siteId: string): boolean {
  return toggleKey(S.ui.chPrefs.hiddenCats, siteId);
}

export function showAllChannels(roomSiteId: string): boolean {
  return keyOn(S.ui.chPrefs.showAll, roomSiteId);
}

export function toggleShowAllChannels(roomSiteId: string): boolean {
  return toggleKey(S.ui.chPrefs.showAll, roomSiteId);
}

export function hideMutedChannels(roomSiteId: string): boolean {
  return keyOn(S.ui.chPrefs.hideMuted, roomSiteId);
}

export function toggleHideMutedChannels(roomSiteId: string): boolean {
  return toggleKey(S.ui.chPrefs.hideMuted, roomSiteId);
}

/** Звук сообщения: заглушка сервера, режим «только упоминания» и заглушка канала. */
export function shouldPlayMessageSound(convSiteId: string, channelSiteId: string, body: string): boolean {
  if (isConvSoundMuted(convSiteId) || roomNotify(convSiteId) === 'none') return false;
  if (roomNotify(convSiteId) === 'mentions' && !mentionsMe(body)) return false;
  if (!channelSiteId) return true;
  if (isChannelMuted(channelSiteId)) return false;
  const level = channelNotify(channelSiteId);
  if (level === 'none') return false;
  if (level === 'mentions' && !mentionsMe(body)) return false;
  return true;
}

/** Правая панель всегда в потоке и сужает чат, в том числе в узком окне. */
export function profileShown(): boolean {
  return S.ui.profileOpen;
}

export function membersShown(): boolean {
  return S.ui.membersOpen;
}

export function saveUi(): void {
  lsSet(LS_PROFILE, S.ui.profileOpen);
  lsSet(LS_MEMBERS, S.ui.membersOpen);
  lsSet(LS_COLLAPSED, [...S.ui.collapsed]);
  lsSet(LS_RAIL_ORDER, S.ui.railOrder);
  lsSet(LS_LAST_CH, S.ui.lastChannel);
}

// ===== Ответы IPC =====

export class ApiError extends Error {}

export function unwrap<T = any>(res: IpcResult<T> | T | null | undefined, fallback = 'Ошибка запроса'): T {
  const r = res as IpcResult<T> | null | undefined;
  if (!r) throw new ApiError(fallback);
  if (typeof r === 'object' && 'ok' in r && r.ok === false) throw new ApiError(String(r.error || fallback));
  if (typeof r === 'object' && 'data' in r && r.data !== undefined) return r.data as T;
  return r as T;
}

export function errText(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e || 'Ошибка');
  if (raw === 'channel_locked') return 'Системный канал нельзя удалить';
  return raw;
}

// ===== Справочник пользователей =====

export function rememberUser(u: Partial<UserLite> & { id?: number | null; user_id?: number | null }): void {
  const id = Number(u.id ?? u.user_id);
  if (!id || !u.username) return;
  const prev = S.users.get(id);
  S.users.set(id, {
    id,
    username: u.username,
    // Пустой ответ профиля не должен стирать уже обрезанную голову
    avatar_url: u.avatar_url || prev?.avatar_url || null,
    avatar_color: u.avatar_color ?? prev?.avatar_color ?? null,
    bot: Boolean(u.bot || prev?.bot),
  });
}

export function userOf(id: number | null | undefined): UserLite {
  const n = Number(id);
  if (S.me.id != null && n === S.me.id) {
    return { id: n, username: S.me.username || 'Вы', avatar_url: S.me.avatar, avatar_color: S.me.color };
  }
  return S.users.get(n) || { id: n, username: `Пользователь ${n || ''}`.trim(), avatar_url: null, avatar_color: null };
}

export function isOnline(id: number): boolean {
  const n = Number(id);
  if (S.users.get(n)?.bot) return true;
  return S.online.has(n);
}

export function isFriend(id: number): boolean {
  return S.friends.friends.some((f) => f.id === id);
}

export function relationTo(id: number): Mutual['relation'] {
  if (S.friends.blocked.some((f) => f.id === id)) return 'blocked';
  if (isFriend(id)) return 'friend';
  if (S.friends.incoming.some((f) => f.id === id)) return 'incoming';
  if (S.friends.outgoing.some((f) => f.id === id)) return 'outgoing';
  return 'none';
}

// ===== Ключи бесед =====

export const dmKey = (peerId: number): ConvKey => `dm:${peerId}`;
export const chKey = (channelId: number): ConvKey => `ch:${channelId}`;

export function conv(key: ConvKey): Conv {
  let c = S.convs.get(key);
  if (!c) {
    c = { list: [], hasMore: true, loading: false, loaded: false, unreadFrom: null };
    S.convs.set(key, c);
  }
  return c;
}

export function groupChannelId(roomId: number): number | null {
  const d = S.details.get(roomId);
  if (!d) return null;
  return d.default_channel_id ?? d.text_channels?.[0]?.id ?? null;
}

export function groupVoiceId(roomId: number): number | null {
  return S.details.get(roomId)?.voice_channels?.[0]?.id ?? null;
}

/** Ключ беседы активного представления (null — нет ленты сообщений). */
export function activeKey(): ConvKey | null {
  const v = S.view;
  if (v.kind === 'dm') return dmKey(v.peerId);
  if (v.kind === 'group') {
    const ch = groupChannelId(v.roomId);
    return ch ? chKey(ch) : null;
  }
  if (v.kind === 'server' && v.channelId) return chKey(v.channelId);
  return null;
}

export function servers(): Room[] {
  return S.rooms.filter((r) => r.kind !== 'group');
}

export function groups(): Room[] {
  return S.rooms.filter((r) => r.kind === 'group');
}

export function roomById(id: number | null | undefined): Room | undefined {
  return S.rooms.find((r) => sameId(r.id, id));
}

export function allTextChannels(d: RoomDetail | undefined): TextChannel[] {
  if (!d) return [];
  const map = new Map<number, TextChannel>();
  for (const c of d.text_channels || []) map.set(c.id, c);
  for (const cat of d.categories || []) for (const c of cat.text_channels || []) if (!map.has(c.id)) map.set(c.id, c);
  return [...map.values()];
}

export function allVoiceChannels(d: RoomDetail | undefined): VoiceChannel[] {
  if (!d) return [];
  const map = new Map<number, VoiceChannel>();
  for (const c of d.voice_channels || []) map.set(c.id, c);
  for (const cat of d.categories || []) for (const c of cat.voice_channels || []) if (!map.has(c.id)) map.set(c.id, c);
  return [...map.values()];
}

export function findChannel(channelId: number): { room: number; ch: TextChannel } | null {
  for (const [rid, d] of S.details) {
    const ch = allTextChannels(d).find((c) => c.id === channelId);
    if (ch) return { room: rid, ch };
  }
  return null;
}

export function isRoomOwner(roomId: number): boolean {
  const d = S.details.get(roomId);
  const r = roomById(roomId);
  return S.me.id != null && (sameId(d?.creator_id, S.me.id) || sameId(r?.creator_id, S.me.id));
}

/** Права администратора сервера (владелец или роль с administrator/manage_*). */
export function canManage(
  roomId: number,
  perm:
    | 'manage_channels'
    | 'manage_roles'
    | 'kick_members'
    | 'ban_members'
    | 'manage_messages'
    | 'create_invite'
    | 'mute_members'
    | 'view_audit_log'
    | 'manage_nicknames' = 'manage_channels',
): boolean {
  if (S.me.admin || isRoomOwner(roomId)) return true;
  const d = S.details.get(roomId);
  const me = S.members.get(roomId)?.find((m) => sameId(m.user_id, S.me.id));
  if (me?.site_role === 'owner' || me?.site_role === 'admin') return true;
  if (!d || !me) return perm === 'create_invite';
  const roles = (d.roles || []).filter((r) => me.role_ids?.includes(r.id));
  if (perm === 'create_invite' && !roles.length) return true;
  return roles.some((r) => r.permissions?.administrator || r.permissions?.[perm]);
}

/** Право внутри канала: роли сервера и переопределения канала. */
export function channelAllows(
  roomId: number,
  channel: { overwrites?: ChannelOverwrite[]; channel_kind?: string } | null | undefined,
  perm: string,
): boolean {
  if (!channel) return true;
  const admin = Boolean(S.me.admin) || isRoomOwner(roomId);
  const me = S.members.get(roomId)?.find((m) => sameId(m.user_id, S.me.id));
  const siteAdmin = me?.site_role === 'owner' || me?.site_role === 'admin';
  const roles = (S.details.get(roomId)?.roles || []).filter((r) => me?.role_ids?.includes(r.id));
  return resolveChannelPerm({
    admin: admin || siteAdmin,
    rolePerms: roles.map((r) => r.permissions || {}),
    roleIds: roles.map((r) => r.id),
    memberId: Number(S.me.id) || 0,
    overwrites: channel.overwrites || [],
    perm,
    channelKind: channel.channel_kind,
  });
}

/** Порядок каналов и групп: только владелец или роль с правом администратора. */
export function canReorder(roomId: number): boolean {
  if (S.me.admin || isRoomOwner(roomId)) return true;
  const me = S.members.get(roomId)?.find((m) => sameId(m.user_id, S.me.id));
  if (me?.site_role === 'owner' || me?.site_role === 'admin') return true;
  const d = S.details.get(roomId);
  if (!d || !me) return false;
  const roles = (d.roles || []).filter((r) => me.role_ids?.includes(r.id));
  return roles.some((r) => !!r.permissions?.administrator);
}

// ===== Реакции =====

/** Живые события присылают сырой список {user_id, emoji} — считаем "me" относительно себя. */
export function aggReactions(raw: unknown, fallback?: unknown): Reaction[] {
  if (Array.isArray(raw) && raw.length && typeof raw[0] === 'object' && raw[0] && 'user_id' in (raw[0] as object)) {
    const map = new Map<string, Reaction>();
    for (const r of raw as Array<{ user_id: number; emoji: string }>) {
      const cur = map.get(r.emoji) || { emoji: r.emoji, count: 0, me: false };
      cur.count += 1;
      if (sameId(r.user_id, S.me.id)) cur.me = true;
      map.set(r.emoji, cur);
    }
    return [...map.values()];
  }
  if (Array.isArray(raw)) return raw as Reaction[];
  return Array.isArray(fallback) ? (fallback as Reaction[]) : [];
}

export function normMsg(m: Record<string, any>): Message {
  const msg: Message = {
    id: m.id ?? m.message_id,
    sender_id: m.sender_id != null ? Number(m.sender_id) : null,
    sender_username: String(m.sender_username ?? '?'),
    sender_avatar_url: m.sender_avatar_url ?? m.sender_avatar_abs ?? null,
    sender_avatar_color: m.sender_avatar_color ?? null,
    receiver_id: m.receiver_id != null ? Number(m.receiver_id) : null,
    room_id: m.room_id != null ? Number(m.room_id) : null,
    channel_id: m.channel_id != null ? Number(m.channel_id) : null,
    text: String(m.text ?? ''),
    created_at: String(m.created_at ?? new Date().toISOString()),
    edited_at: m.edited_at ?? null,
    attachment_url: m.attachment_url ?? m.file_url ?? null,
    attachment_name: m.attachment_name ?? m.file_name ?? null,
    attachment_size: m.attachment_size ?? null,
    attachment_mime: m.attachment_mime ?? null,
    attachment_preview: m.attachment_preview ?? null,
    reply_to_id: m.reply_to_id ?? m.reply_to?.id ?? null,
    reply_to: m.reply_to ?? null,
    reactions: aggReactions(m.reactions, m.reactions_agg),
    is_pinned: Boolean(m.is_pinned),
    kind: m.kind || undefined,
    meta: m.meta && typeof m.meta === 'object' ? m.meta : null,
    is_system: Boolean(m.is_system),
    as_channel_post: Boolean(m.as_channel_post),
    channel_kind: m.channel_kind,
    mentioned_user_ids: Array.isArray(m.mentioned_user_ids) ? m.mentioned_user_ids.map(Number) : [],
  };
  if (msg.sender_id) {
    rememberUser({ id: msg.sender_id, username: msg.sender_username, avatar_url: msg.sender_avatar_url, avatar_color: msg.sender_avatar_color });
  }
  return msg;
}

// ===== Загрузчики =====

export async function loadEndpoints(): Promise<void> {
  try {
    const ep = await S.api.cloudEndpoints?.();
    setMasterBase(ep?.masterUrl || ep?.url);
  } catch {
    /* необязательно */
  }
}

export async function loadMe(): Promise<void> {
  try {
    const res = await S.api.cloudProfileMe?.();
    if (res?.masterUrl) setMasterBase(String(res.masterUrl));
    const p = res?.profile || res?.data || res;
    if (p?.username) S.me.username = String(p.username);
    if (p?.avatar_abs || p?.avatar_url) S.me.avatar = String(p.avatar_abs || p.avatar_url);
    if (p?.avatar_color) S.me.color = String(p.avatar_color);
    if (p?.id && S.me.id == null) S.me.id = Number(p.id);
  } catch {
    /* профиль подтянется позже */
  }
}

export async function loadLists(): Promise<void> {
  const [roomsRes, dmRes] = await Promise.all([
    Promise.resolve()
      .then(() => S.api.cloudRooms?.() ?? null)
      .catch((e) => {
        console.warn('[chatsV2] rooms', errText(e));
        return null;
      }),
    Promise.resolve()
      .then(() => S.api.cloudDmList?.() ?? null)
      .catch((e) => {
        console.warn('[chatsV2] dms', errText(e));
        return null;
      }),
  ]);
  if (roomsRes?.ok && Array.isArray(roomsRes.rooms)) {
    S.rooms = (roomsRes.rooms as Room[]).map((r) => ({ ...r, kind: r.kind === 'group' ? 'group' : 'server' }));
    for (const r of S.rooms) for (const m of r.members || []) rememberUser({ id: m.user_id, username: m.username });
  }
  if (dmRes?.ok && Array.isArray(dmRes.dms)) {
    if (dmRes.masterUrl) setMasterBase(String(dmRes.masterUrl));
    S.dms = dmRes.dms as Dm[];
    for (const d of S.dms) {
      rememberUser({ id: d.peer_id, username: d.peer_username, avatar_url: d.peer_avatar_url, avatar_color: d.peer_avatar_color });
    }
  }
  S.loadError = !roomsRes?.ok && !dmRes?.ok ? String(roomsRes?.error || dmRes?.error || 'Не удалось загрузить чаты') : '';
}

export async function loadFriends(): Promise<void> {
  try {
    const d = unwrap<FriendsData>(await S.api.cloudFriends?.());
    S.friends = {
      friends: d.friends || [],
      incoming: d.incoming || [],
      outgoing: d.outgoing || [],
      blocked: d.blocked || [],
    };
    for (const list of Object.values(S.friends)) for (const f of list as FriendUser[]) rememberUser(f);
    for (const f of S.friends.friends) {
      if (f.is_online || f.bot || S.users.get(f.id)?.bot) S.online.add(f.id);
      else S.online.delete(f.id);
      if (f.voice) {
        S.voiceRoom.set(f.voice.channel_id, f.voice.room_id);
        S.voiceMembers.set(f.voice.channel_id, f.voice.member_ids);
      }
    }
  } catch (e) {
    console.warn('[chatsV2] friends', errText(e));
  }
}

export async function loadInbox(): Promise<void> {
  try {
    const d = unwrap<{ invites: InboxInvite[] }>(await S.api.cloudInbox?.());
    S.inbox = Array.isArray(d.invites) ? d.invites : [];
  } catch (e) {
    console.warn('[chatsV2] inbox', errText(e));
  }
}

export async function loadDetail(roomId: number): Promise<RoomDetail | null> {
  try {
    const d = unwrap<RoomDetail>(await S.api.cloudRoomDetail?.(roomId));
    S.details.set(roomId, d);
    for (const c of allTextChannels(d)) S.chUnread.set(c.id, { u: Number(c.unread_count) || 0, m: Number(c.mention_count) || 0 });
    for (const v of allVoiceChannels(d)) {
      S.voiceRoom.set(v.id, roomId);
      if (Array.isArray(v.member_ids)) S.voiceMembers.set(v.id, v.member_ids.map(Number));
    }
    return d;
  } catch (e) {
    console.warn('[chatsV2] detail', errText(e));
    return null;
  }
}

export async function loadMembers(roomId: number): Promise<void> {
  try {
    const list = unwrap<Member[]>(await S.api.cloudRoomMembersV2?.(roomId));
    if (!Array.isArray(list)) return;
    S.members.set(
      roomId,
      list.map((m) => ({ ...m, user_id: Number(m.user_id ?? (m as any).id) })),
    );
    for (const m of list) {
      rememberUser({ id: Number(m.user_id ?? (m as any).id), username: m.username, avatar_url: m.avatar_url, avatar_color: m.avatar_color });
      const uid = Number(m.user_id);
      if (m.is_online || S.users.get(uid)?.bot) S.online.add(uid);
      else S.online.delete(uid);
    }
  } catch (e) {
    console.warn('[chatsV2] members', errText(e));
  }
}

const PAGE = 50;

/** Загрузить историю беседы; older — догрузка вверх. */
export async function loadHistory(key: ConvKey, older = false): Promise<number> {
  const c = conv(key);
  if (c.loading || (older && !c.hasMore)) return 0;
  c.loading = true;
  const [kind, idStr] = key.split(':');
  const id = Number(idStr);
  const firstId = older ? c.list.find((m) => !m.pending && typeof m.id === 'number')?.id : undefined;
  try {
    let raw: unknown[] = [];
    if (kind === 'dm') {
      const res = await S.api.cloudDmHistory?.(id, PAGE, firstId as number | undefined);
      raw = unwrap<{ messages: unknown[] }>(res).messages || [];
    } else {
      const found = findChannel(id);
      const roomId = found?.room ?? (S.view.kind !== 'friends' && S.view.kind !== 'invites' && 'roomId' in S.view ? S.view.roomId : 0);
      const res = await S.api.cloudChannelHistory?.(roomId, id, PAGE, firstId as number | undefined);
      raw = unwrap<{ messages: unknown[] }>(res).messages || [];
    }
    const msgs = (raw as Record<string, any>[]).map(normMsg);
    if (older) {
      const known = new Set(c.list.map((m) => String(m.id)));
      c.list = [...msgs.filter((m) => !known.has(String(m.id))), ...c.list];
    } else {
      const pending = c.list.filter((m) => m.pending);
      c.list = [...msgs, ...pending];
    }
    c.hasMore = msgs.length >= PAGE;
    c.loaded = true;
    return msgs.length;
  } catch (e) {
    console.warn('[chatsV2] history', key, errText(e));
    c.loaded = true;
    return 0;
  } finally {
    c.loading = false;
  }
}

export async function getProfile(uid: number, force = false): Promise<Profile | null> {
  if (!force && S.profiles.has(uid)) return S.profiles.get(uid)!;
  try {
    const res = await S.api.cloudProfileUser?.(uid);
    if (res?.masterUrl) setMasterBase(String(res.masterUrl));
    const p = (res?.profile || unwrap(res)) as Profile;
    if (p?.id) {
      S.profiles.set(uid, p);
      rememberUser({ id: p.id, username: p.username, avatar_url: p.avatar_url, avatar_color: p.avatar_color });
      return p;
    }
  } catch (e) {
    console.warn('[chatsV2] profile', errText(e));
  }
  return null;
}

export async function getMutual(uid: number, force = false): Promise<Mutual | null> {
  if (!force && S.mutuals.has(uid)) return S.mutuals.get(uid)!;
  try {
    const m = unwrap<Mutual>(await S.api.cloudUserMutual?.(uid));
    S.mutuals.set(uid, m);
    return m;
  } catch {
    return null;
  }
}

/** Иконка игры по названию (кэш; undefined — ещё грузится). */
export function gameIcon(name: string | null | undefined): string | null {
  const key = String(name || '').trim();
  if (!key) return null;
  const k = key.toLowerCase();
  if (S.gameInfo.has(k)) return S.gameInfo.get(k)?.icon ?? null;
  S.gameInfo.set(k, undefined);
  void (async () => {
    try {
      const d = unwrap<{ game: GameInfo }>(await S.api.cloudGameLookup?.(key));
      S.gameInfo.set(k, d.game ?? null);
    } catch {
      S.gameInfo.set(k, null);
    }
    invalidate('main', 'sidebar', 'aside');
  })();
  return null;
}

export function myGame(uid: number): string | null {
  return S.games.get(uid) || null;
}

/** Общий счётчик для бейджа «Домой» и вкладки «Чаты». */
export function homeBadgeCount(): number {
  const dmUnread = S.dms.filter((d) => (d.unread_count || 0) > 0).length;
  const groupUnread = groups().filter((g) => (g.unread_count || 0) > 0).length;
  return S.friends.incoming.length + S.inbox.length + dmUnread + groupUnread;
}

export function totalUnread(): number {
  let n = 0;
  for (const d of S.dms) n += Number(d.unread_count) || 0;
  for (const r of S.rooms) n += Number(r.mention_count) || (r.kind === 'group' ? Number(r.unread_count) || 0 : 0);
  return n + S.friends.incoming.length + S.inbox.length;
}
