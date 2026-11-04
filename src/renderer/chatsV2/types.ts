// Типы данных чатов v2: сущности мастера, состояние представления и контракт API preload.

// ===== Сущности мастера =====

export type IpcResult<T = unknown> = { ok?: boolean; data?: T; error?: string; status?: number } & Record<string, unknown>;

export type UserLite = {
  id: number;
  username: string;
  avatar_url?: string | null;
  avatar_color?: string | null;
  /** Системный бот: всегда в сети, в интерфейсе с бейджем «Бот» */
  bot?: boolean;
};

export type VoicePresence = {
  room_id: number;
  room_name: string;
  room_kind: string;
  channel_id: number;
  channel_name: string;
  member_ids: number[];
};

export type FriendActivity = {
  playing?: boolean;
  hosting?: boolean;
  build?: string | null;
  version?: string | null;
  server?: string | null;
  serverName?: string | null;
  serverHost?: string | null;
};

export type FriendUser = UserLite & {
  is_online?: boolean;
  game?: string | null;
  voice?: VoicePresence | null;
  since?: string | null;
  requested_at?: string | null;
  /** Текущая игра и открытый мир (activity с сайта) */
  activity?: FriendActivity | null;
};

export type FriendsData = {
  friends: FriendUser[];
  incoming: FriendUser[];
  outgoing: FriendUser[];
  blocked: FriendUser[];
};

export type Reaction = { emoji: string; count: number; me: boolean };

export type Message = {
  id: number | string;
  sender_id: number | null;
  sender_username: string;
  sender_avatar_url?: string | null;
  sender_avatar_color?: string | null;
  receiver_id?: number | null;
  room_id?: number | null;
  channel_id?: number | null;
  text: string;
  created_at: string;
  edited_at?: string | null;
  attachment_url?: string | null;
  attachment_name?: string | null;
  attachment_size?: number | null;
  /** image/gif и прочие типы с сервера. Нужен, чтобы GIF рисовался картинкой, даже если в имени нет расширения. */
  attachment_mime?: string | null;
  /** Локальный blob: на время отправки, чтобы анимация была видна до ответа сервера. */
  attachment_preview?: string | null;
  reply_to_id?: number | null;
  reply_to?: {
    id: number;
    sender_id?: number | null;
    sender_username?: string;
    text?: string;
    sender_avatar_url?: string | null;
    sender_avatar_color?: string | null;
  } | null;
  reactions?: Reaction[];
  is_pinned?: boolean;
  kind?: string;
  meta?: Record<string, unknown> | null;
  is_system?: boolean;
  as_channel_post?: boolean;
  channel_kind?: string;
  mentioned_user_ids?: number[];
  /** Локальное сообщение до эха сервера */
  pending?: boolean;
  failed?: boolean;
};

export type RoomMemberLite = { user_id: number; username: string; is_online?: boolean };

export type Room = {
  id: number;
  name: string;
  kind: 'server' | 'group';
  site_id?: string;
  custom_name?: boolean;
  description?: string | null;
  is_global?: boolean;
  creator_id?: number | null;
  members_total?: number;
  members_online?: number;
  members?: RoomMemberLite[];
  avatar_url?: string | null;
  banner_url?: string | null;
  avatar_color?: string | null;
  last_message?: { text?: string | null; sender_username?: string | null; created_at?: string | null } | null;
  unread_count?: number;
  mention_count?: number;
};

export type Dm = {
  peer_id: number;
  peer_username: string;
  peer_avatar_url?: string | null;
  peer_avatar_color?: string | null;
  last_message?: { text?: string | null; sender_username?: string | null; created_at?: string | null } | null;
  unread_count?: number;
  mention_count?: number;
};

/** Переопределение права канала: 0 — @everyone. */
export type ChannelOverwrite = {
  target_id: number;
  target_type: 'role' | 'member';
  allow: Record<string, boolean>;
  deny: Record<string, boolean>;
};

export type TextChannel = {
  id: number;
  name: string;
  topic?: string | null;
  category_id?: number | null;
  position?: number;
  unread_count?: number;
  mention_count?: number;
  banner_url?: string | null;
  slowmode_seconds?: number;
  channel_kind?: string;
  is_default?: boolean;
  is_nsfw?: boolean;
  overwrites?: ChannelOverwrite[];
  /** UUID канала на сайте. Локальные настройки меню ключуются им. */
  site_id?: string;
};

export type VoiceChannel = {
  id: number;
  room_id?: number;
  name: string;
  category_id?: number | null;
  position?: number;
  user_limit?: number;
  bitrate?: number;
  member_ids?: number[];
  overwrites?: ChannelOverwrite[];
  /** Системный голосовой канал сервера: перенос разрешён, удаление нет. */
  is_default?: boolean;
  site_id?: string;
};

export type Category = {
  id: number | null;
  name: string;
  position?: number;
  text_channels?: TextChannel[];
  voice_channels?: VoiceChannel[];
  site_id?: string;
};

export type Role = {
  id: number;
  name: string;
  color?: string;
  position?: number;
  permissions?: Record<string, boolean>;
};

export type RoomDetail = {
  id: number;
  name: string;
  kind?: string;
  description?: string | null;
  creator_id?: number | null;
  avatar_url?: string | null;
  banner_url?: string | null;
  avatar_color?: string | null;
  roles?: Role[];
  categories?: Category[];
  text_channels?: TextChannel[];
  voice_channels?: VoiceChannel[];
  default_channel_id?: number | null;
  members_total?: number;
  members_online?: number;
  settings?: {
    verification_level?: number;
    explicit_filter?: 'disabled' | 'members' | 'all';
    notify_default?: 'all' | 'mentions';
    system_channel_id?: number | null;
    rules_channel_id?: number | null;
  };
};

export type Member = {
  user_id: number;
  username: string;
  nickname?: string | null;
  display_name?: string | null;
  is_online?: boolean;
  avatar_url?: string | null;
  avatar_color?: string | null;
  role_ids?: number[];
  /** owner | admin | member с сайта, не путать с ролями вкладки «Роли» */
  site_role?: string;
};

export type InboxInvite = {
  id: number;
  created_at?: string | null;
  inviter: FriendUser | null;
  room: {
    id: number;
    name: string;
    description?: string | null;
    avatar_url?: string | null;
    avatar_color?: string | null;
    members_total: number;
    members_online: number;
  };
};

export type Profile = {
  id: number;
  username: string;
  avatar_url?: string | null;
  avatar_abs?: string | null;
  avatar_color?: string | null;
  bio?: string | null;
  registered_at?: string | null;
  badges?: Array<{ slug: string; label: string; color: string; text_color: string }>;
  steam_id?: string | null;
  steam_persona?: string | null;
  steam_avatar?: string | null;
  steam_url?: string | null;
  steam_online?: boolean | number | null;
  steam_state_message?: string | null;
  steam_games_count?: number | null;
  steam_current_game?: string | null;
  steam_current_appid?: string | null;
  steam_games?: Array<{ name: string; appid?: string | null; hours?: number | null }>;
};

export type Mutual = {
  servers: Array<{ id: number; name: string; avatar_url?: string | null; avatar_color?: string | null }>;
  friends: FriendUser[];
  relation: 'none' | 'friend' | 'incoming' | 'outgoing' | 'blocked';
};

export type GameInfo = { name: string; appid: string; icon: string; header: string } | null;

// ===== Представление =====

export type FriendsTab = 'online' | 'all' | 'pending' | 'blocked' | 'add';

export type View =
  | { kind: 'friends'; tab: FriendsTab }
  | { kind: 'worlds' }
  | { kind: 'invites' }
  | { kind: 'dm'; peerId: number }
  | { kind: 'group'; roomId: number }
  | { kind: 'server'; roomId: number; channelId: number | null; voiceId: number | null };

/** Ключ беседы для кэша сообщений: dm:<peer> | ch:<channelId> */
export type ConvKey = string;

export type ChatsController = {
  refresh: () => Promise<void>;
  setUserId: (id: number | null) => void;
  setPlatformAdmin: (admin: boolean) => void;
  setOnlineIds: (ids: Set<number>) => void;
  setPresenceStatus: (status: string) => void;
  setUserGames: (games: Map<number, string>) => void;
  setMyAvatar: (url: string, color?: string) => void;
  patchRoomAvatar: (roomId: number, url: string) => void;
  openDm?: (peerId: number) => Promise<void> | void;
  openServer?: (roomId: number, channelId?: number) => Promise<void> | void;
  openGroup?: (roomId: number) => Promise<void> | void;
  /** Короткие строки для главной: личные, группы и серверы. */
  homeRows?: () => HomeChatPreview[];
};

export type HomeChatPreview = {
  kind: 'dm' | 'group' | 'server';
  id: number;
  title: string;
  sub: string;
  unread: number;
  avatarUrl: string | null;
  color: string | null;
};

type Fn<A extends unknown[] = any[]> = (...args: A) => Promise<any>;

/** Контракт window.api, нужный чатам (подмножество preload). */
export type ChatsApi = {
  cloudRooms?: Fn<[]>;
  cloudDmList?: Fn<[]>;
  cloudEndpoints?: Fn<[]>;
  cloudProfileMe?: Fn<[]>;
  cloudProfileUser?: Fn<[number]>;
  cloudWsSend?: Fn<[Record<string, unknown>]>;
  onCloudWsMessage?: (cb: (data: any) => void) => (() => void) | void;
  cloudCreateRoom?: Fn<[string, string[]?, string?]>;
  cloudUpdateRoom?: Fn<[number, { name?: string; description?: string }]>;
  cloudLeaveRoom?: Fn<[number]>;
  cloudDeleteRoom?: Fn<[number]>;
  cloudRoomDetail?: Fn<[number]>;
  cloudRoomMembersV2?: Fn<[number]>;
  cloudUploadRoomAvatar?: Fn<[number, Uint8Array, string]>;
  cloudUploadRoomBanner?: Fn<[number, Uint8Array, string]>;
  cloudUploadChannelBanner?: Fn<[number, number, Uint8Array, string]>;
  cloudStickers?: Fn<[]>;
  cloudMyStickers?: Fn<[]>;
  cloudStickerCatalog?: Fn<[]>;
  cloudStickerPack?: Fn<[string, boolean]>;
  cloudCreateCategory?: Fn<[number, Record<string, unknown>]>;
  cloudUpdateCategory?: Fn<[number, number, Record<string, unknown>]>;
  cloudDeleteCategory?: Fn<[number, number]>;
  cloudCreateTextChannel?: Fn<[number, Record<string, unknown>]>;
  cloudUpdateTextChannel?: Fn<[number, number, Record<string, unknown>]>;
  cloudDeleteTextChannel?: Fn<[number, number]>;
  cloudCreateVoiceChannel?: Fn<[number, Record<string, unknown>]>;
  cloudUpdateVoiceChannel?: Fn<[number, number, Record<string, unknown>]>;
  cloudDeleteVoiceChannel?: Fn<[number, number]>;
  cloudJoinVoiceChannel?: Fn<[number]>;
  cloudLeaveVoiceChannel?: Fn<[number]>;
  cloudListRoles?: Fn<[number]>;
  cloudCreateRole?: Fn<[number, Record<string, unknown>]>;
  cloudUpdateRole?: Fn<[number, number, Record<string, unknown>]>;
  cloudDeleteRole?: Fn<[number, number]>;
  cloudAssignRole?: Fn<[number, number, number]>;
  cloudRemoveRole?: Fn<[number, number, number]>;
  cloudListBans?: Fn<[number]>;
  cloudBanUser?: Fn<[number, number, string?, boolean?]>;
  cloudUnbanUser?: Fn<[number, number]>;
  cloudKickMember?: Fn<[number, number]>;
  cloudListInvites?: Fn<[number]>;
  cloudCreateInvite?: Fn<[number, { max_uses?: number; expires_at?: string | null }?]>;
  cloudDeleteInvite?: Fn<[number, number]>;
  cloudListMutes?: Fn<[number]>;
  cloudUnmuteUser?: Fn<[number, number]>;
  cloudMuteUser?: Fn<[number, number, string?, number?]>;
  cloudSetMemberNickname?: Fn<[number, number, string | null]>;
  cloudTransferRoom?: Fn<[number, number]>;
  cloudRoomSettings?: Fn<[number]>;
  cloudUpdateRoomSettings?: Fn<[number, Record<string, unknown>]>;
  cloudRoomAudit?: Fn<[number]>;
  chatOpenWindow?: (target: { kind: 'dm' | 'server' | 'group'; id: number; channelId?: number; title?: string; avatar?: string | null; color?: string | null }) => Promise<unknown>;
  cloudGetInvite?: Fn<[string]>;
  cloudJoinInvite?: Fn<[string]>;
  cloudAckChannel?: Fn<[number, number, number?]>;
  cloudAckDm?: Fn<[number, number?]>;
  cloudDmHistory?: Fn<[number, number?, number?]>;
  cloudChannelHistory?: Fn<[number, number, number?, number?]>;
  cloudChannelPins?: Fn<[number, number]>;
  cloudChannelSearch?: Fn<[number, number, string]>;
  cloudRtcConfig?: Fn<[]>;
  cloudUploadRoomFile?: Fn<[number, Uint8Array, string, string?]>;
  cloudUploadDmFile?: Fn<[Uint8Array, string, string?]>;
  cloudFriends?: Fn<[]>;
  cloudFriendRequest?: Fn<[{ username?: string; user_id?: number }]>;
  cloudReport?: Fn<[Record<string, unknown>]>;
  cloudFriendAccept?: Fn<[number]>;
  cloudFriendRemove?: Fn<[number]>;
  cloudFriendBlock?: Fn<[number]>;
  cloudFriendUnblock?: Fn<[number]>;
  cloudUserMutual?: Fn<[number]>;
  cloudInbox?: Fn<[]>;
  cloudInboxAccept?: Fn<[number]>;
  cloudInboxDecline?: Fn<[number]>;
  cloudInviteUserToRoom?: Fn<[number, number]>;
  cloudGroupCreate?: Fn<[number[], string?]>;
  cloudGroupAdd?: Fn<[number, number[]]>;
  cloudGroupRemove?: Fn<[number, number]>;
  cloudGroupRename?: Fn<[number, string]>;
  cloudGameLookup?: Fn<[string]>;
  cloudDmPins?: Fn<[number]>;
  cloudDmSearch?: Fn<[number, string]>;
  openExternal?: (url: string) => unknown;
  openUserProfile?: (userId: number) => void;
};
