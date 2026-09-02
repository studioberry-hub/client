// ===== UI MC Messenger: диалоги, группы, reply, профиль, SSE =====

import { createSkinAnimation, locatorColorFromUuid, SkinViewEngine } from 'skinviewengine';
import { getApiBase, skinImageUrl, DEFAULT_ACCOUNT_SKIN_URL } from '../../shared/apiBase';

export type MessengerActivity = {
  build?: string | null;
  version?: string | null;
  loader?: string | null;
  server?: string | null;
  serverName?: string | null;
  serverHost?: string | null;
  playing?: boolean;
  /** Хост открыл мир для друзей (не гость на чужом сервере) */
  hosting?: boolean;
  at?: number | null;
};

export type MessengerUser = {
  id: string;
  provider: 'msa' | 'ely' | string;
  uuid: string;
  username: string;
  skinUrl?: string | null;
  lastSeenAt?: number | null;
  /** online | busy | dnd | offline */
  presenceStatus?: string | null;
  activity?: MessengerActivity | null;
  favoriteBuild?: string | null;
  favoriteBuildCount?: number | null;
  lastBuild?: string | null;
  lastBuildMeta?: string | null;
  lastServer?: string | null;
  lastServerMeta?: string | null;
  createdAt?: number | null;
  sharedChats?: number | null;
  role?: string;
  blockedByMe?: boolean;
  /** none | outgoing | incoming | friends */
  friendship?: string;
  /** Когда участник последний раз прочитал чат */
  lastReadAt?: number | null;
  /** Мут модератора в группе (until=null — навсегда) */
  mute?: { until: number | null } | null;
};

export type MessengerLauncherStats = {
  favoriteBuild?: string | null;
  favoriteBuildCount?: number | null;
  lastBuild?: string | null;
  lastBuildMeta?: string | null;
  lastServer?: string | null;
  lastServerMeta?: string | null;
};

export type MessengerAttachment = {
  id: string;
  name: string;
  mime: string;
  size: number;
};

export type MessengerMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  kind?: string;
  meta?: Record<string, unknown> | null;
  createdAt: number;
  replyToId?: string | null;
  replyTo?: {
    id: string;
    senderId: string;
    body: string;
    deleted?: boolean;
    attachment?: MessengerAttachment | null;
  } | null;
  attachment?: MessengerAttachment | null;
  deleted?: boolean;
  reactions?: { emoji: string; count: number; me?: boolean }[];
};

export type MessengerConversation = {
  id: string;
  type: 'dm' | 'group';
  title: string;
  /** Официальный «Чат проекта» — всегда сверху, нельзя выйти/удалить */
  isProject?: boolean;
  /** DM с ботом Undefined Studio — выше Чата проекта */
  isBotDm?: boolean;
  description?: string | null;
  rules?: string | null;
  avatarUrl?: string | null;
  /** Обложка группы (левая панель профиля), отдельно от аватара */
  coverUrl?: string | null;
  groupBuildName?: string | null;
  groupBuildShareId?: string | null;
  groupBuildMeta?: string | null;
  peer?: MessengerUser | null;
  members?: MessengerUser[];
  myRole?: string | null;
  memberCount?: number;
  onlineCount?: number;
  pinnedMessageId?: string | null;
  pinnedMessage?: MessengerMessage | null;
  /** Мут модератора для текущего пользователя */
  myMute?: { until: number | null } | null;
  lastMessage?: MessengerMessage | null;
  unreadCount?: number;
  updatedAt?: number;
};

export type MessengerPendingFile = {
  name: string;
  mime: string;
  size: number;
  dataBase64: string;
};

export type MessengerHost = {
  t: (key: string, vars?: Record<string, string | number>) => string;
  escapeHtml: (s: string) => string;
  getAccount: () => any;
  openModal?: (id: string) => void;
  closeModal?: (id: string) => void;
  /** Открыть вкладку настроек лаунчера (например updates) */
  openSettingsTab?: (tab: string) => void;
  /** Markdown → безопасный HTML (как в новостях) */
  renderMarkdown?: (md: string) => string;
  getLauncherStats?: () => MessengerLauncherStats;
  /** Иконка сборки по имени (локальный каталог лаунчера) */
  resolveBuildIcon?: (name: string | null | undefined) => string | null;
  /** Иконка сервера по имени/адресу */
  resolveServerIcon?: (name: string | null | undefined) => string | null;
  /** Локальные сборки лаунчера для выбора «сборки группы» */
  listLocalBuilds?: () => { id: string; name: string; meta: string }[];
  /** Открыть импорт шаринга по id */
  openInstanceShare?: (shareId: string) => void | Promise<void>;
  /** Создать шаринг сборки → { id, url } */
  createInstanceShare?: (buildId: string) => Promise<{
    ok: boolean;
    id?: string;
    url?: string;
    error?: string;
  }>;
  /** Перейти к сборке по имени (если есть локально) */
  focusBuildByName?: (name: string) => void;
  /** Запуск на сервер (picker сборки / join) */
  launchJoinServer?: (
    server: { ip: string; port: number; name?: string },
    hint?: { buildName?: string | null; gameVersion?: string | null },
  ) => void | Promise<void>;
  /** Текущая запущенная сборка (для шаринга LAN) */
  getRunningBuild?: () => {
    id: string;
    name: string;
    gameVersion?: string;
    loader?: string;
  } | null;
  /** Короткий статус/тост (опционально) */
  updateStatus?: (text: string) => void;
  /** Плавающий тост без записи в баннер главной */
  showToast?: (text: string) => void;
  api: {
    messengerSession?: (account: any) => Promise<any>;
    messengerLogout?: () => Promise<any>;
    messengerRequest?: (payload: {
      method?: string;
      path: string;
      body?: unknown;
      query?: Record<string, string | number | undefined>;
    }) => Promise<any>;
    messengerPickFiles?: (opts?: { media?: boolean }) => Promise<string[]>;
    messengerReadFile?: (filePath: string) => Promise<{
      ok: boolean;
      name?: string;
      path?: string;
      size?: number;
      mime?: string;
      dataBase64?: string;
      error?: string;
    }>;
    messengerDownloadAttachment?: (payload: {
      messageId: string;
      fileName?: string;
    }) => Promise<{ ok: boolean; path?: string; error?: string }>;
    messengerOpenLocalFile?: (filePath: string) => Promise<{ ok: boolean; error?: string }>;
    gameRelayWatchLan?: (buildId: string) => Promise<any>;
    gameRelayStopWatch?: () => Promise<any>;
    gameRelayGetLanPort?: (buildId?: string) => Promise<{ port: number | null }>;
    gameRelayStart?: (
      localPort: number,
      meta?: {
        buildId?: string;
        buildName?: string;
        gameVersion?: string;
        loader?: string;
        serverName?: string;
      } | null,
    ) => Promise<any>;
    gameRelayStop?: () => Promise<any>;
    gameRelayRestore?: () => Promise<any>;
    gameRelayStatus?: () => Promise<any>;
    gameRelayJoinSession?: (sessionId: string) => Promise<any>;
    onGameRelayLanPort?: (cb: (data: { buildId: string; port: number | null }) => void) => () => void;
    onGameRelayTunnel?: (cb: (data: Record<string, unknown>) => void) => () => void;
  };
  refreshAccount?: () => Promise<any>;
};

const ONLINE_MS = 2 * 60 * 1000;
const POLL_FALLBACK_MS = 20000;
const AVATAR_SIZE = 64;
/** Разрешённые эмодзи реакций (серверный whitelist) */
const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '👀'] as const;

let host: MessengerHost | null = null;
let inited = false;
let me: MessengerUser | null = null;
let sessionToken: string | null = null;
let conversations: MessengerConversation[] = [];
let activeId: string | null = null;
let messages: MessengerMessage[] = [];
/** Есть ли ещё более старые сообщения на сервере */
let messagesHasMore = true;
let messagesLoadingOlder = false;
let replyTo: MessengerMessage | null = null;
/** Кто сейчас печатает в активном чате (userId → untilTs) */
const typingPeers = new Map<string, { name: string; until: number }>();
let typingSendTimer: ReturnType<typeof setTimeout> | null = null;
let typingUiTimer: ReturnType<typeof setInterval> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let searchTimer: ReturnType<typeof setTimeout> | null = null;
let groupSearchTimer: ReturnType<typeof setTimeout> | null = null;
let stream: EventSource | null = null;
/** Токен, с которым открыт текущий SSE — чтобы не рвать коннект при смене вкладки. */
let streamToken: string | null = null;
let busy = false;
let profileViewer: SkinViewEngine | null = null;
let profileSkinLoaded: string | null = null;
/** DM-профиль, открытый в модалке — для live presence/activity */
let openProfileUser: MessengerUser | null = null;
/** Файлы, выбранные к отправке (до сабмита) */
let pendingFiles: MessengerPendingFile[] = [];
/** Вкладка сайдбара: чаты / друзья / миры / блоки */
let railTab: 'chats' | 'friends' | 'worlds' | 'blocked' | 'users' = 'chats';
let friendsBundle: {
  friends: MessengerUser[];
  incoming: MessengerUser[];
  outgoing: MessengerUser[];
} = { friends: [], incoming: [], outgoing: [] };
let directoryUsers: MessengerUser[] = [];
let directoryTotal = 0;
let blockedUsers: MessengerUser[] = [];
/** Ручной статус присутствия текущего пользователя */
let myPresenceStatus: 'online' | 'busy' | 'dnd' | 'offline' = 'online';
/** Ключ аккаунта, к которому привязана текущая сессия мессенджера */
let boundAccountKey: string | null = null;
/** Последний детект LAN-порта Open to LAN */
let lastDetectedLanPort: number | null = null;
/** Активная relay-сессия хоста */
let hostRelaySession: {
  sessionId: string;
  publicHost: string;
  publicPort: number;
  localPort: number;
  buildId?: string | null;
  buildName?: string | null;
  gameVersion?: string | null;
  loader?: string | null;
} | null = null;
/** Последний входящий game_invite (для кнопки Join) */
let lastGameInvite: {
  mode: 'relay' | 'direct';
  sessionId?: string | null;
  host?: string | null;
  port?: number | null;
  publicHost?: string | null;
  publicPort?: number | null;
  buildName?: string | null;
  gameVersion?: string | null;
  loader?: string | null;
  serverName?: string | null;
  shareId?: string | null;
  shareUrl?: string | null;
  from: { id: string; username: string };
  ts: number;
} | null = null;
let unsubLanPort: (() => void) | null = null;
let unsubTunnel: (() => void) | null = null;
const avatarCache = new Map<string, string>();
const avatarInflight = new Map<string, Promise<string>>();
const MSGR_CACHE_PREFIX = 'msgr-cache-v1:';
const MSGR_PRESENCE_PREFIX = 'msgr-presence-v1:';
const MSGR_PREFS_PREFIX = 'msgr-prefs-v1:';

type MsgrMuteUntil = number | null; // null = навсегда, number = unix ms
type MsgrPrefs = {
  /** id чата → до когда заглушен (null = навсегда) */
  mutedUntil: Record<string, MsgrMuteUntil>;
  pinned: string[];
};

function loadMsgrPrefs(): MsgrPrefs {
  const key = boundAccountKey || accountCacheKey();
  if (!key) return { mutedUntil: {}, pinned: [] };
  try {
    const raw = localStorage.getItem(MSGR_PREFS_PREFIX + key);
    if (!raw) return { mutedUntil: {}, pinned: [] };
    const parsed = JSON.parse(raw);
    const mutedUntil: Record<string, MsgrMuteUntil> = {};
    if (parsed?.mutedUntil && typeof parsed.mutedUntil === 'object') {
      for (const [id, v] of Object.entries(parsed.mutedUntil)) {
        mutedUntil[String(id)] = v == null ? null : Number(v);
      }
    } else if (Array.isArray(parsed?.muted)) {
      // Миграция старого формата muted: string[]
      for (const id of parsed.muted) mutedUntil[String(id)] = null;
    }
    return {
      mutedUntil,
      pinned: Array.isArray(parsed?.pinned) ? parsed.pinned.map(String) : [],
    };
  } catch {
    return { mutedUntil: {}, pinned: [] };
  }
}

function saveMsgrPrefs(prefs: MsgrPrefs): void {
  const key = boundAccountKey || accountCacheKey();
  if (!key) return;
  try {
    localStorage.setItem(MSGR_PREFS_PREFIX + key, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

function pruneExpiredMutes(prefs: MsgrPrefs): MsgrPrefs {
  const now = Date.now();
  let changed = false;
  for (const [id, until] of Object.entries(prefs.mutedUntil)) {
    if (until != null && until <= now) {
      delete prefs.mutedUntil[id];
      changed = true;
    }
  }
  if (changed) saveMsgrPrefs(prefs);
  return prefs;
}

function isConvMuted(id: string): boolean {
  const prefs = pruneExpiredMutes(loadMsgrPrefs());
  if (!(id in prefs.mutedUntil)) return false;
  const until = prefs.mutedUntil[id];
  if (until == null) return true;
  return until > Date.now();
}

function getMuteUntil(id: string): MsgrMuteUntil | undefined {
  const prefs = pruneExpiredMutes(loadMsgrPrefs());
  if (!(id in prefs.mutedUntil)) return undefined;
  return prefs.mutedUntil[id];
}

function setConvMute(id: string, until: MsgrMuteUntil): void {
  const prefs = loadMsgrPrefs();
  prefs.mutedUntil[id] = until;
  saveMsgrPrefs(prefs);
}

function clearConvMute(id: string): void {
  const prefs = loadMsgrPrefs();
  delete prefs.mutedUntil[id];
  saveMsgrPrefs(prefs);
}

function isConvPinned(id: string): boolean {
  return loadMsgrPrefs().pinned.includes(id);
}

function toggleConvPin(id: string): boolean {
  const prefs = loadMsgrPrefs();
  const i = prefs.pinned.indexOf(id);
  if (i >= 0) prefs.pinned.splice(i, 1);
  else prefs.pinned.unshift(id);
  saveMsgrPrefs(prefs);
  return prefs.pinned.includes(id);
}

const MUTE_DURATIONS: { key: string; ms: number | null }[] = [
  { key: 'msgr.mute1h', ms: 3600000 },
  { key: 'msgr.mute2h', ms: 7200000 },
  { key: 'msgr.mute1w', ms: 7 * 86400000 },
  { key: 'msgr.muteForever', ms: null },
];

function formatMuteUntilLabel(until: MsgrMuteUntil): string {
  if (until == null) return host?.t('msgr.muteUntilForever') || '';
  const d = new Date(until);
  const pad = (n: number) => String(n).padStart(2, '0');
  return host?.t('msgr.muteUntilAt', {
    d: `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
  }) || '';
}

/** Снять заглушение чата */
function unmuteConversation(convId: string, onDone?: () => void): void {
  clearConvMute(convId);
  toast(host?.t('msgr.unmutedOk') || '');
  renderConversationList();
  onDone?.();
}

/**
 * Меню сроков заглушения.
 * Открываем через setTimeout: иначе тот же click на document сразу вызовет hideCtx.
 */
function openMuteMenu(convId: string, x: number, y: number, onDone?: () => void): void {
  if (!host) return;
  if (isConvMuted(convId)) {
    unmuteConversation(convId, onDone);
    return;
  }
  window.setTimeout(() => {
    if (!host) return;
    showCtx(
      x,
      y,
      MUTE_DURATIONS.map((d) => ({
        label: host!.t(d.key),
        action: () => {
          setConvMute(convId, d.ms == null ? null : Date.now() + d.ms);
          toast(host!.t('msgr.mutedOk'));
          renderConversationList();
          onDone?.();
        },
      })),
    );
  }, 0);
}

async function hideOrLeaveConversation(conv: MessengerConversation): Promise<void> {
  if (conv.isProject) return;
  const id = conv.id;
  if (conv.type === 'group' && conv.myRole === 'owner') {
    await req(`/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } else if (conv.type === 'group' && me) {
    await req(`/conversations/${encodeURIComponent(id)}/members/${encodeURIComponent(me.id)}`, {
      method: 'DELETE',
    });
  } else {
    await req(`/conversations/${encodeURIComponent(id)}/hide`, { method: 'POST', body: {} });
  }
  if (activeId === id) {
    activeId = null;
    messages = [];
    renderMessages();
    renderPeerHeader();
  }
  await loadConversations();
}

function chatActionItems(conv: MessengerConversation): { label: string; action: () => void; danger?: boolean }[] {
  if (!host) return [];
  const items: { label: string; action: () => void; danger?: boolean }[] = [
    {
      label: host.t('msgr.actionOpenProfile'),
      action: () => {
        void openConversation(conv.id).then(() => openProfileModal());
      },
    },
    {
      label: host.t(isConvMuted(conv.id) ? 'msgr.actionUnmute' : 'msgr.actionMute'),
      action: () => {
        openMuteMenu(conv.id, lastCtxPos.x, lastCtxPos.y, () => renderPeerHeader());
      },
    },
    {
      label: host.t(isConvPinned(conv.id) ? 'msgr.actionUnpin' : 'msgr.actionPin'),
      action: () => {
        const pinned = toggleConvPin(conv.id);
        toast(host!.t(pinned ? 'msgr.pinnedOk' : 'msgr.unpinnedOk'));
        renderConversationList();
      },
    },
    {
      label: host.t(conv.type === 'group' ? 'msgr.actionCopyGroupName' : 'msgr.actionCopyUsername'),
      action: () => {
        void navigator.clipboard.writeText(conv.title).then(
          () => toast(host!.t('msgr.copied')),
          () => toast(host!.t('msgr.copyFailed')),
        );
      },
    },
  ];
  if (conv.type === 'group') {
    items.push({
      label: host.t('msgr.profileTabMembers'),
      action: () => {
        void openConversation(conv.id).then(() =>
          openProfileModal().then(() => setProfilePanelTab('members', false)),
        );
      },
    });
  }
  if (!conv.isProject) {
    items.push({
      label:
        conv.type === 'group'
          ? conv.myRole === 'owner'
            ? host.t('msgr.actionDeleteGroup')
            : host.t('msgr.actionLeave')
          : host.t('msgr.actionDeleteChat'),
      danger: true,
      action: () => void hideOrLeaveConversation(conv),
    });
  }
  return items;
}

function parseShareId(raw: string): string | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(s) || /^[0-9a-f-]{20,}$/i.test(s)) return s;
  try {
    if (s.startsWith('uclient://')) {
      const q = s.split('?')[1] || '';
      const id = new URLSearchParams(q).get('id');
      return id ? decodeURIComponent(id) : null;
    }
    const u = new URL(s);
    const fromQuery = u.searchParams.get('id');
    if (fromQuery) return fromQuery;
    const m = u.pathname.match(/\/(?:import-instance|share|instance-share)\/([^/]+)/i);
    if (m?.[1]) return decodeURIComponent(m[1]);
  } catch {
    /* ignore */
  }
  return null;
}

const PROFILE_FRAME = { fillY: 0.58, maxFillX: 0.7, offsetY: -0.1 };
/** Fallback, если CSS-переменная не прочиталась */
const PROFILE_BG_FALLBACK = 0x202020;
/** Мягкий, но яркий свет онлайн-профиля */
const PROFILE_LIGHT_ONLINE = {
  keyIntensity: 1.25,
  ambientIntensity: 0.72,
  fillIntensity: 0.62,
  shadowIntensity: 0.2,
  shadowRadius: 12,
};
/** Оффлайн: заметно темнее key/fill/ambient на персонаже */
const PROFILE_LIGHT_OFFLINE = {
  keyIntensity: 0.28,
  ambientIntensity: 0.2,
  fillIntensity: 0.14,
  shadowIntensity: 0.1,
  shadowRadius: 12,
};
/** Hemi/rim вне LightSettings — совпадают с product-visuals при online */
const PROFILE_HEMI_ONLINE = 0.72;
const PROFILE_RIM_ONLINE = 0.3;
const PROFILE_HEMI_OFFLINE = 0.22;
const PROFILE_RIM_OFFLINE = 0.06;
const DEFAULT_BUILD_ICON = '../../assets/InstancesIcons/newBuild.png';
const DEFAULT_SERVER_ICON = '../../assets/icons/serverIcon.png';
const ICON_ELY = '../../assets/icons/elyby.svg';
const ICON_MS = '../../assets/icons/microsoft.svg';
const ICON_JOINED = '../../assets/icons/userregistered.svg';
const ICON_UACC = '../../assets/icons/undefinedacc.svg';
/** Канонический скин системного бота Undefined Studio */
const PROJECT_BOT_SKIN_URL = 'https://s.namemc.com/i/d1d81be1a4cf9aa3.png';
const PROJECT_BOT_UACC_ID = 'uacc_id1';
const LOCAL_FILE_KEY = 'msgr-local-files';

function $(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function isProjectBotUser(user?: { id?: string; provider?: string } | null): boolean {
  if (!user) return false;
  return user.provider === 'bot' || String(user.id || '').startsWith('bot:');
}

function providerLabel(provider: string): string {
  if (provider === 'bot') return host?.t('msgr.botBadge') || 'BOT';
  return provider === 'ely' ? 'Ely.by' : 'MS';
}

/** Полное имя провайдера для карточки «тип аккаунта» */
function providerLabelFull(provider: string): string {
  if (provider === 'bot') return host?.t('msgr.botAccountType') || 'Undefined ID';
  return provider === 'ely' ? 'Ely.by' : 'Microsoft';
}

function providerIconUrl(provider: string): string {
  if (provider === 'bot') return ICON_UACC;
  return provider === 'ely' ? ICON_ELY : ICON_MS;
}

function providerClass(provider: string): string {
  if (provider === 'bot') return 'msgr-badge--bot';
  return provider === 'ely' ? 'msgr-badge--ely' : 'msgr-badge--ms';
}

function readLocalFileMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(LOCAL_FILE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocalFileMap(map: Record<string, string>): void {
  try {
    localStorage.setItem(LOCAL_FILE_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

function getLocalFilePath(messageId: string): string | null {
  const p = readLocalFileMap()[messageId];
  return p ? String(p) : null;
}

function setLocalFilePath(messageId: string, filePath: string): void {
  const map = readLocalFileMap();
  map[messageId] = filePath;
  writeLocalFileMap(map);
}

function formatFileSize(bytes: number): string {
  if (!bytes || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImageAttachment(att: { mime?: string; name?: string } | null | undefined): boolean {
  if (!att) return false;
  if (/^image\//i.test(String(att.mime || ''))) return true;
  return /\.(png|jpe?g|gif|webp|bmp)$/i.test(String(att.name || ''));
}

function isVideoAttachment(att: { mime?: string; name?: string } | null | undefined): boolean {
  if (!att) return false;
  if (/^video\//i.test(String(att.mime || ''))) return true;
  return /\.(mp4|webm|mov|mkv|avi)$/i.test(String(att.name || ''));
}

function isMediaAttachment(att: { mime?: string; name?: string } | null | undefined): boolean {
  return isImageAttachment(att) || isVideoAttachment(att);
}

/** URL вложения с токеном сессии (для <img>/<video>) */
function attachmentMediaUrl(messageId: string): string {
  if (!sessionToken) return '';
  return `${getApiBase()}/api/messenger/messages/${encodeURIComponent(messageId)}/attachment?token=${encodeURIComponent(sessionToken)}`;
}

function formatMediaTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

let mediaViewerZoom = 1;
let mediaViewerKind: 'image' | 'video' | null = null;

function setMediaViewerZoom(z: number): void {
  mediaViewerZoom = Math.min(4, Math.max(0.25, z));
  const img = $('msgr-media-img') as HTMLImageElement | null;
  const label = $('msgr-media-zoom-label');
  if (img) img.style.transform = `scale(${mediaViewerZoom})`;
  if (label) label.textContent = `${Math.round(mediaViewerZoom * 100)}%`;
}

function closeMediaViewer(): void {
  const overlay = $('modal-msgr-media');
  const img = $('msgr-media-img') as HTMLImageElement | null;
  const video = $('msgr-media-video') as HTMLVideoElement | null;
  const barPhoto = $('msgr-media-bar-photo');
  const barVideo = $('msgr-media-bar-video');
  if (video) {
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.hidden = true;
  }
  if (img) {
    img.removeAttribute('src');
    img.hidden = true;
    img.style.transform = '';
  }
  if (barPhoto) barPhoto.hidden = true;
  if (barVideo) barVideo.hidden = true;
  mediaViewerKind = null;
  mediaViewerZoom = 1;
  closeOverlay('modal-msgr-media');
  overlay?.setAttribute('aria-hidden', 'true');
}

function openMediaViewer(messageId: string, kind: 'image' | 'video'): void {
  if (!host || !sessionToken) return;
  const url = attachmentMediaUrl(messageId);
  if (!url) return;
  const overlay = $('modal-msgr-media');
  const img = $('msgr-media-img') as HTMLImageElement | null;
  const video = $('msgr-media-video') as HTMLVideoElement | null;
  const barPhoto = $('msgr-media-bar-photo');
  const barVideo = $('msgr-media-bar-video');
  const playBtn = $('msgr-media-play');
  mediaViewerKind = kind;
  openOverlay('modal-msgr-media');
  overlay?.setAttribute('aria-hidden', 'false');
  if (kind === 'image') {
    if (video) {
      video.pause();
      video.hidden = true;
      video.removeAttribute('src');
    }
    if (barVideo) barVideo.hidden = true;
    if (barPhoto) barPhoto.hidden = false;
    if (img) {
      img.hidden = false;
      img.src = url;
      setMediaViewerZoom(1);
    }
  } else {
    if (img) {
      img.hidden = true;
      img.removeAttribute('src');
    }
    if (barPhoto) barPhoto.hidden = true;
    if (barVideo) barVideo.hidden = false;
    if (video) {
      video.hidden = false;
      video.src = url;
      void video.play().catch(() => undefined);
    }
    if (playBtn) {
      playBtn.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 12 12" fill="none" aria-hidden="true"><rect x="2.5" y="2" width="2.5" height="8" rx="0.5" fill="currentColor"/><rect x="7" y="2" width="2.5" height="8" rx="0.5" fill="currentColor"/></svg>';
    }
  }
}

function renderAttachmentBlock(m: MessengerMessage): string {
  if (m.deleted || !m.attachment || !host) return '';
  const att = m.attachment;
  if (isImageAttachment(att)) {
    const url = attachmentMediaUrl(m.id);
    return `<button type="button" class="msgr-media msgr-media--image" data-msgr-media="image" data-msg-id="${host.escapeHtml(m.id)}">
      <img class="msgr-media__thumb" src="${host.escapeHtml(url)}" alt="${host.escapeHtml(att.name)}" loading="lazy">
    </button>`;
  }
  if (isVideoAttachment(att)) {
    const url = attachmentMediaUrl(m.id);
    return `<button type="button" class="msgr-media msgr-media--video" data-msgr-media="video" data-msg-id="${host.escapeHtml(m.id)}">
      <video class="msgr-media__thumb" src="${host.escapeHtml(url)}" muted preload="metadata" playsinline></video>
      <span class="msgr-media__play" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 12 12" fill="none"><path d="M3 1.5v9l7-4.5L3 1.5z" fill="currentColor"/></svg>
      </span>
    </button>`;
  }
  const localPath = getLocalFilePath(m.id);
  return `<div class="msgr-file" data-msg-id="${host.escapeHtml(m.id)}">
    <div class="msgr-file__meta">
      <div class="msgr-file__name">${host.escapeHtml(att.name)}</div>
      <div class="msgr-file__size">${host.escapeHtml(formatFileSize(att.size))}</div>
    </div>
    <button type="button" class="msgr-file__btn" data-file-act="${localPath ? 'open' : 'download'}">
      ${host.escapeHtml(host.t(localPath ? 'msgr.fileOpen' : 'msgr.fileDownload'))}
    </button>
  </div>`;
}

let toastHintTimer: ReturnType<typeof setTimeout> | null = null;

/** Человекочитаемая ошибка relay/join */
function relayErrMsg(code?: string | null, fallback?: string | null): string {
  const raw = String(code || fallback || '').trim();
  if (!raw) return host?.t('msgr.err.unknown') || 'Error';
  const key = `msgr.err.${raw}`;
  const translated = host?.t(key) || key;
  if (translated !== key) return translated;
  return host?.t('msgr.err.generic', { msg: raw }) || raw;
}

function toast(msg: string): void {
  if (host?.showToast) {
    host.showToast(msg);
  } else {
    // Fallback: только локальный hint, без записи в баннер главной
    const hint = $('msgr-rail-hint');
    if (hint) {
      hint.hidden = false;
      hint.textContent = msg;
      if (toastHintTimer) clearTimeout(toastHintTimer);
      toastHintTimer = setTimeout(() => {
        hint.hidden = true;
        hint.textContent = '';
        toastHintTimer = null;
      }, 5000);
    }
  }
}

function parseHostPort(raw: string): { ip: string; port: number } | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  // [ipv6]:port
  const v6 = s.match(/^\[([^\]]+)\]:(\d{1,5})$/);
  if (v6) {
    const port = Number(v6[2]);
    if (port >= 1 && port <= 65535) return { ip: v6[1], port };
    return null;
  }
  const idx = s.lastIndexOf(':');
  if (idx <= 0) return { ip: s, port: 25565 };
  const ip = s.slice(0, idx).trim();
  const port = Number(s.slice(idx + 1));
  if (!ip || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { ip, port };
}

async function copyText(text: string): Promise<boolean> {
  const value = String(text || '').trim();
  if (!value) return false;
  try {
    await navigator.clipboard.writeText(value);
    toast(host?.t('msgr.shareCopied') || 'Copied');
    return true;
  } catch {
    toast(value);
    return false;
  }
}

function inviteAddress(inv: NonNullable<typeof lastGameInvite>): string {
  if (inv.mode === 'relay' && inv.publicHost && inv.publicPort) {
    return `${inv.publicHost}:${inv.publicPort}`;
  }
  if (inv.host) return `${inv.host}${inv.port ? `:${inv.port}` : ''}`;
  return '';
}

async function resolveInviteAddress(inv: NonNullable<typeof lastGameInvite>): Promise<{
  ip: string;
  port: number;
  name?: string;
} | null> {
  if (inv.mode === 'direct') {
    if (inv.host && inv.port) return { ip: inv.host, port: Number(inv.port), name: inv.serverName || undefined };
    return null;
  }
  if (inv.publicHost && inv.publicPort) {
    return {
      ip: inv.publicHost,
      port: Number(inv.publicPort),
      name: inv.serverName || shareLanServerName(inv.from?.username) || 'Friends world',
    };
  }
  if (inv.sessionId && host?.api.gameRelayJoinSession) {
    const res = await host.api.gameRelayJoinSession(inv.sessionId);
    if (!res?.ok) {
      toast(host.t('msgr.joinFailed', { msg: relayErrMsg(res?.code, res?.error) }));
      return null;
    }
    return {
      ip: String(res.publicHost),
      port: Number(res.publicPort),
      name: inv.serverName || shareLanServerName(inv.from?.username) || 'Friends world',
    };
  }
  return null;
}

async function joinFromInvite(inv: NonNullable<typeof lastGameInvite>): Promise<void> {
  if (!host?.launchJoinServer) {
    toast(host?.t('msgr.joinUnavailable') || 'Join unavailable');
    return;
  }
  const builds = host.listLocalBuilds?.() || [];
  const hasBuild =
    !inv.buildName ||
    builds.some((b) => b.name.toLowerCase() === String(inv.buildName).toLowerCase());
  if (!hasBuild && inv.shareId && host.openInstanceShare) {
    toast(host.t('msgr.joinBuildHint', { name: inv.buildName || '' }));
    await host.openInstanceShare(inv.shareId);
    return;
  }
  const addr = await resolveInviteAddress(inv);
  if (!addr) {
    toast(host.t('msgr.joinFailed', { msg: relayErrMsg('address') }));
    return;
  }
  if (inv.buildName) {
    toast(host.t('msgr.joinBuildHint', { name: inv.buildName }));
  }
  await host.launchJoinServer(addr, {
    buildName: inv.buildName,
    gameVersion: inv.gameVersion,
  });
}

function inviteFromMeta(meta: Record<string, unknown> | null | undefined, fallbackFrom?: { id: string; username: string }): NonNullable<typeof lastGameInvite> | null {
  if (!meta || typeof meta !== 'object') return null;
  const mode = meta.mode === 'direct' ? 'direct' : meta.mode === 'relay' ? 'relay' : null;
  if (!mode) return null;
  const fromRaw = (meta.from as { id?: string; username?: string } | undefined) || fallbackFrom;
  if (!fromRaw?.id) return null;
  return {
    mode,
    sessionId: meta.sessionId != null ? String(meta.sessionId) : null,
    host: meta.host != null ? String(meta.host) : null,
    port: meta.port != null ? Number(meta.port) : null,
    publicHost: meta.publicHost != null ? String(meta.publicHost) : null,
    publicPort: meta.publicPort != null ? Number(meta.publicPort) : null,
    buildName: meta.buildName != null ? String(meta.buildName) : null,
    gameVersion: meta.gameVersion != null ? String(meta.gameVersion) : null,
    loader: meta.loader != null ? String(meta.loader) : null,
    serverName: meta.serverName != null ? String(meta.serverName) : null,
    shareId: meta.shareId != null ? String(meta.shareId) : null,
    shareUrl: meta.shareUrl != null ? String(meta.shareUrl) : null,
    from: { id: String(fromRaw.id), username: String(fromRaw.username || '') },
    ts: Number(meta.ts) || Date.now(),
  };
}

function renderInviteCardHtml(inv: NonNullable<typeof lastGameInvite>, msgId?: string): string {
  if (!host) return '';
  const addr = inviteAddress(inv);
  const metaLine = [inv.buildName, inv.serverName].filter(Boolean).join(' · ');
  const idAttr = msgId ? ` data-msg-id="${host.escapeHtml(msgId)}"` : '';
  const addrAttr = addr ? ` data-invite-addr="${host.escapeHtml(addr)}"` : '';
  const getBuild =
    inv.shareId
      ? `<button type="button" class="msgr-invite-card__btn" data-invite-act="build"${idAttr}>${host.escapeHtml(host.t('msgr.joinGetBuild'))}</button>`
      : '';
  const copyBtn = addr
    ? `<button type="button" class="msgr-invite-card__btn" data-invite-act="copy"${idAttr}${addrAttr}>${host.escapeHtml(host.t('msgr.worldsCopyIp'))}</button>`
    : '';
  return `<div class="msgr-invite-card" data-invite-card${idAttr}>
    <div class="msgr-invite-card__title">${host.escapeHtml(host.t('msgr.joinInviteCard'))}</div>
    <div class="msgr-invite-card__meta">${host.escapeHtml(metaLine || host.t('msgr.joinInviteHint'))}</div>
    ${addr ? `<div class="msgr-invite-card__addr">${host.escapeHtml(addr)}</div>` : ''}
    <div class="msgr-invite-card__actions">
      <button type="button" class="msgr-invite-card__btn msgr-invite-card__btn--primary" data-invite-act="join"${idAttr}>${host.escapeHtml(host.t('msgr.joinPlay'))}</button>
      ${copyBtn}
      ${getBuild}
    </div>
  </div>`;
}

/** Панель хоста: игра запущена или уже шарится */
function shouldShowHostPanel(): boolean {
  if (hostRelaySession) return true;
  return Boolean(host?.getRunningBuild?.()?.id);
}

/** Панель хоста: чеклист Open to LAN → шаринг */
function renderHostPanelHtml(): string {
  if (!host || !shouldShowHostPanel()) return '';
  if (hostRelaySession) {
    const addr = `${hostRelaySession.publicHost}:${hostRelaySession.publicPort}`;
    return `<div class="msgr-share-panel" id="msgr-share-panel">
      <div class="msgr-share-panel__label">${host.escapeHtml(host.t('msgr.sharePanelTitle'))}</div>
      <div class="msgr-share-panel__status">${host.escapeHtml(host.t('msgr.shareOkNone'))}</div>
      <button type="button" class="msgr-share-addr" id="msgr-share-addr" data-share-addr="${host.escapeHtml(addr)}" title="${host.escapeHtml(host.t('msgr.shareCopyAddr'))}">${host.escapeHtml(addr)}</button>
      <div class="msgr-share-panel__row">
        <button type="button" class="msgr-rail-btn msgr-rail-btn--ghost" id="msgr-share-copy" data-share-addr="${host.escapeHtml(addr)}">${host.escapeHtml(host.t('msgr.shareCopyAddr'))}</button>
        <button type="button" class="msgr-rail-btn msgr-rail-btn--ghost" id="msgr-share-stop">${host.escapeHtml(host.t('msgr.shareStop'))}</button>
      </div>
    </div>`;
  }

  const running = Boolean(host.getRunningBuild?.()?.id);
  const lanReady = Boolean(lastDetectedLanPort);
  const step1 = running ? 'is-done' : 'is-active';
  const step2 = !running ? '' : lanReady ? 'is-done' : 'is-active';
  const step3 = running && lanReady ? 'is-active' : '';

  const steps = `<ol class="msgr-share-steps" aria-label="${host.escapeHtml(host.t('msgr.sharePanelTitle'))}">
    <li class="${step1}" data-step="1">${host.escapeHtml(host.t('msgr.shareStepGame'))}</li>
    <li class="${step2}" data-step="2">${host.escapeHtml(host.t('msgr.shareStepLan'))}</li>
    <li class="${step3}" data-step="3">${host.escapeHtml(host.t('msgr.shareStepShare'))}</li>
  </ol>`;

  if (lanReady) {
    return `<div class="msgr-share-panel" id="msgr-share-panel">
      <div class="msgr-share-panel__label">${host.escapeHtml(host.t('msgr.sharePanelTitle'))}</div>
      ${steps}
      <div class="msgr-share-panel__status">${host.escapeHtml(host.t('msgr.shareHostHint'))}</div>
      <button type="button" class="msgr-rail-btn" id="msgr-share-lan">${host.escapeHtml(host.t('msgr.shareLan'))}</button>
    </div>`;
  }

  return `<div class="msgr-share-panel" id="msgr-share-panel">
    <div class="msgr-share-panel__label">${host.escapeHtml(host.t('msgr.sharePanelTitle'))}</div>
    ${steps}
    <div class="msgr-share-panel__status">${host.escapeHtml(host.t(running ? 'msgr.shareNeedLan' : 'msgr.shareNeedGame'))}</div>
    <button type="button" class="msgr-rail-btn msgr-rail-btn--ghost" id="msgr-share-rescan">${host.escapeHtml(host.t('msgr.shareRescanLan'))}</button>
  </div>`;
}

function updateSharePanel(): void {
  // Панель встроена во вкладку «Миры» — перерисовываем список
  if (railTab === 'worlds') renderWorldsList();
}

function renderWorldsList(): void {
  const list = $('msgr-worlds-list');
  if (!list || !host) return;
  const worlds = friendsBundle.friends.filter(
    (u) => u.activity?.playing && u.activity?.hosting && u.activity?.serverHost,
  );
  const hostPanel = renderHostPanelHtml();
  const head = `<div class="msgr-friends-head"><div class="msgr-friends-title">${host.escapeHtml(host.t('msgr.worldsTitle'))}</div></div>`;
  const emptyOrList = worlds.length
    ? worlds
        .map((u) => {
          ensureAvatar(u);
          const a = u.activity!;
          const addr = String(a.serverHost || '');
          const meta = [a.build, a.server].filter(Boolean).join(' · ');
          return `<div class="msgr-world-item" data-world-user="${host!.escapeHtml(u.id)}">
            <span class="msgr-avatar ${presenceClass(u)}">${avatarImgHtml(u, 36, u.username.slice(0, 1))}</span>
            <span class="msgr-world-item__body">
              <span class="msgr-world-item__name">${host!.escapeHtml(u.username)}</span>
              <span class="msgr-world-item__meta">${host!.escapeHtml(meta || addr)}</span>
              ${addr ? `<span class="msgr-world-item__addr">${host!.escapeHtml(addr)}</span>` : ''}
            </span>
            <span class="msgr-world-item__actions">
              <button type="button" class="msgr-world-item__btn msgr-world-item__btn--primary" data-world-act="join" data-world-user="${host!.escapeHtml(u.id)}">${host!.escapeHtml(host!.t('msgr.worldsJoin'))}</button>
              ${
                addr
                  ? `<button type="button" class="msgr-world-item__btn" data-world-act="copy" data-world-addr="${host!.escapeHtml(addr)}">${host!.escapeHtml(host!.t('msgr.worldsCopyIp'))}</button>`
                  : ''
              }
            </span>
          </div>`;
        })
        .join('')
    : `<div class="msgr-empty-list">${host.escapeHtml(host.t('msgr.worldsEmpty'))}</div>`;
  list.innerHTML = `${hostPanel}${head}${emptyOrList}`;
}

async function joinFriendWorld(userId: string): Promise<void> {
  const user = friendsBundle.friends.find((u) => u.id === userId);
  if (!user?.activity?.hosting || !user.activity?.serverHost || !host) return;
  const parsed = parseHostPort(String(user.activity.serverHost));
  if (!parsed) {
    toast(host.t('msgr.joinFailed', { msg: relayErrMsg('address') }));
    return;
  }
  // Если есть свежий invite от этого друга — используем relay sessionId
  if (lastGameInvite && lastGameInvite.from.id === userId) {
    await joinFromInvite(lastGameInvite);
    return;
  }
  await host.launchJoinServer?.(
    { ip: parsed.ip, port: parsed.port, name: user.activity.serverName || shareLanServerName(user.username) },
    { buildName: user.activity.build, gameVersion: user.activity.version },
  );
}

/** Ник текущего аккаунта для имени шаринга */
function hostDisplayNick(): string {
  const a = host?.getAccount?.();
  return String(a?.username || a?.name || '').trim();
}

/** «Мир игрока Nickname» */
function shareLanServerName(nick?: string | null): string {
  const name = String(nick || hostDisplayNick()).trim() || 'Player';
  return host?.t('msgr.shareLanLabel', { name }) || `Мир игрока ${name}`;
}

/** Отправить ссылку на шаринг сборки в активный чат */
async function shareBuildFromChat(): Promise<void> {
  if (!host || !activeId) return;
  const builds = host.listLocalBuilds?.() || [];
  if (!builds.length) {
    toast(host.t('msgr.attachBuildEmpty'));
    return;
  }
  const items = builds.slice(0, 24).map((b) => ({
    label: b.name,
    action: () => {
      void (async () => {
        toast(host!.t('msgr.attachBuildPreparing'));
        const res = await host!.createInstanceShare?.(b.id);
        if (!res?.ok || !res.url) {
          toast(host!.t('msgr.attachBuildFailed'));
          return;
        }
        const body = host!.t('msgr.attachBuildBody', { name: b.name, url: res.url });
        await sendMessage(body);
      })();
    },
  }));
  const btn = $('msgr-attach');
  const r = btn?.getBoundingClientRect();
  showCtx(r?.left || 120, (r?.bottom || 160) + 4, items);
}

/** Пригласить в LAN-мир из композера */
async function shareWorldFromChat(): Promise<void> {
  if (!host) return;
  if (hostRelaySession) {
    toast(host.t('msgr.shareAlreadyOn'));
    setRailTab('worlds');
    return;
  }
  await shareLanWithFriends();
}

async function shareLanWithFriends(): Promise<void> {
  if (!host) return;
  const running = host.getRunningBuild?.();
  if (!running?.id) {
    toast(host.t('msgr.shareNeedGame'));
    return;
  }
  if (!host.api.gameRelayWatchLan || !host.api.gameRelayStart) {
    toast(host.t('msgr.joinUnavailable'));
    return;
  }
  await host.api.gameRelayWatchLan(running.id);
  let port = lastDetectedLanPort;
  if (!port) {
    const got = await host.api.gameRelayGetLanPort?.(running.id);
    port = got?.port || null;
  }
  if (port) lastDetectedLanPort = port;
  if (!port) {
    toast(host.t('msgr.shareNeedLan'));
    updateSharePanel();
    return;
  }
  toast(host.t('msgr.shareStarting'));
  const worldName = shareLanServerName();
  const started = await host.api.gameRelayStart(port, {
    buildId: running.id,
    buildName: running.name,
    gameVersion: running.gameVersion,
    loader: running.loader,
    serverName: worldName,
  });
  if (!started?.ok || !started.session) {
    toast(host.t('msgr.shareFailed', { msg: relayErrMsg(started?.code, started?.error) }));
    return;
  }
  const session = started.session as {
    sessionId: string;
    publicHost: string;
    publicPort: number;
    localPort: number;
  };
  hostRelaySession = {
    sessionId: session.sessionId,
    publicHost: session.publicHost,
    publicPort: session.publicPort,
    localPort: session.localPort,
    buildId: running.id,
    buildName: running.name,
    gameVersion: running.gameVersion,
    loader: running.loader,
  };
  updateSharePanel();

  let shareId: string | undefined;
  let shareUrl: string | undefined;
  if (host.createInstanceShare) {
    toast(host.t('msgr.shareCreatingPack'));
    try {
      const share = await host.createInstanceShare(running.id);
      if (share?.ok && share.id) {
        shareId = share.id;
        shareUrl = share.url;
      }
    } catch {
      /* шаринг сборки опционален */
    }
  }

  const inviteRes = await req('/game-invites', {
    method: 'POST',
    body: {
      mode: 'relay',
      sessionId: session.sessionId,
      publicHost: session.publicHost,
      publicPort: session.publicPort,
      buildName: running.name,
      gameVersion: running.gameVersion,
      loader: running.loader,
      serverName: worldName,
      shareId,
      shareUrl,
    },
  });
  if (!inviteRes?.ok) {
    toast(host.t('msgr.shareFailed', { msg: relayErrMsg(inviteRes?.code, inviteRes?.error) }));
    return;
  }
  await loadConversations();
  const recipients = Number(inviteRes.data?.recipients);
  if (Number.isFinite(recipients) && recipients > 0) {
    toast(host.t('msgr.shareOk', { n: String(recipients) }));
  } else {
    toast(host.t('msgr.shareOkNone'));
  }
  updateSharePanel();
}

async function stopHostRelayShare(): Promise<void> {
  const sessionId = hostRelaySession?.sessionId;
  hostRelaySession = null;
  try {
    await host?.api.gameRelayStop?.();
  } catch {
    /* ignore */
  }
  if (sessionId) {
    await req('/game-invites/end', { method: 'POST', body: { sessionId } });
  }
  updateSharePanel();
  toast(host?.t('msgr.shareStopped') || 'Share stopped');
}

/** Следим за LAN, пока игра запущена — панель хоста появляется только после Open to LAN */
async function ensureLanWatch(): Promise<void> {
  const running = host?.getRunningBuild?.();
  if (!running?.id) {
    // После рестарта лаунчера MC может жить без tracked runningBuild —
    // не сбрасываем hostRelaySession (его гасит stop / game stopped / tunnel off).
    if (!hostRelaySession) lastDetectedLanPort = null;
    return;
  }
  if (!host?.api.gameRelayWatchLan) return;
  try {
    await host.api.gameRelayWatchLan(running.id);
    const got = await host.api.gameRelayGetLanPort?.(running.id);
    lastDetectedLanPort = got?.port || null;
  } catch {
    /* ignore */
  }
}

/** Игра снова «наша» (запуск или adopt) — LAN watch + попытка restore relay */
export async function notifyMessengerGameRunning(): Promise<void> {
  await ensureLanWatch();
  updateSharePanel();
  if (!hostRelaySession) {
    await syncHostRelayFromMain();
  }
  updateSharePanel();
}

function applyHostTunnelState(data: Record<string, unknown>): void {
  if (!data?.active) {
    hostRelaySession = null;
    updateSharePanel();
    return;
  }
  hostRelaySession = {
    sessionId: String(data.sessionId || ''),
    publicHost: String(data.publicHost || ''),
    publicPort: Number(data.publicPort) || 0,
    localPort: Number(data.localPort) || 0,
    buildId: data.buildId != null ? String(data.buildId) : null,
    buildName: data.buildName != null ? String(data.buildName) : null,
    gameVersion: data.gameVersion != null ? String(data.gameVersion) : null,
    loader: data.loader != null ? String(data.loader) : null,
  };
  if (hostRelaySession.localPort) lastDetectedLanPort = hostRelaySession.localPort;
  updateSharePanel();
  if (data.restored) {
    void refreshHostingAfterRestore(hostRelaySession);
    toast(host?.t('msgr.shareRestored') || 'Share restored');
  }
}

/** Обновить hosting в activity без повторной рассылки invite в чаты */
async function refreshHostingAfterRestore(
  session: NonNullable<typeof hostRelaySession>,
): Promise<void> {
  const addr = `${session.publicHost}:${session.publicPort}`;
  if (!addr || addr === ':0') return;
  await req('/activity', {
    method: 'POST',
    body: {
      playing: true,
      hosting: true,
      buildName: session.buildName || undefined,
      gameVersion: session.gameVersion || undefined,
      loader: session.loader || undefined,
      serverName: shareLanServerName(),
      serverHost: addr,
    },
  });
}

/** Подтянуть уже восстановленный туннель, если событие пришло до подписки UI */
async function syncHostRelayFromMain(): Promise<void> {
  if (!host?.api.gameRelayStatus) return;
  try {
    const st = await host.api.gameRelayStatus();
    const tunnel = st?.tunnel;
    if (tunnel?.active && tunnel.publicHost && tunnel.publicPort) {
      applyHostTunnelState({
        active: true,
        restored: false,
        sessionId: tunnel.sessionId,
        publicHost: tunnel.publicHost,
        publicPort: tunnel.publicPort,
        localPort: tunnel.localPort,
        buildId: tunnel.buildId || st?.buildId,
        buildName: tunnel.buildName,
      });
      return;
    }
    // Main ещё не успел — пробуем restore сами
    if (host.api.gameRelayRestore && !hostRelaySession) {
      const restored = await host.api.gameRelayRestore();
      if (restored?.ok && restored.restored && restored.session) {
        applyHostTunnelState({
          active: true,
          restored: true,
          sessionId: restored.session.sessionId,
          publicHost: restored.session.publicHost,
          publicPort: restored.session.publicPort,
          localPort: restored.session.localPort,
          buildId: restored.meta?.buildId,
          buildName: restored.meta?.buildName,
          gameVersion: restored.meta?.gameVersion,
          loader: restored.meta?.loader,
        });
      }
    }
  } catch {
    /* ignore */
  }
}

function bindGameRelayEvents(): void {
  unsubLanPort?.();
  unsubTunnel?.();
  unsubLanPort = host?.api.onGameRelayLanPort?.((data) => {
    lastDetectedLanPort = data.port != null && Number(data.port) > 0 ? Number(data.port) : null;
    updateSharePanel();
  }) || null;
  unsubTunnel =
    host?.api.onGameRelayTunnel?.((data) => {
      applyHostTunnelState(data);
    }) || null;
  void syncHostRelayFromMain();
}

// ===== Звуки чата =====
const MSGR_SOUND = {
  message: '../../assets/sounds/message.mp3',
  send: '../../assets/sounds/send.mp3',
} as const;

function playMsgrSound(kind: keyof typeof MSGR_SOUND): void {
  try {
    const audio = new Audio(MSGR_SOUND[kind]);
    audio.volume = 0.85;
    void audio.play().catch(() => {
      /* автоплей/фокус — молча */
    });
  } catch {
    /* ignore */
  }
}

function accountCacheKey(account?: any): string | null {
  const a = account || host?.getAccount?.();
  const type = String(a?.meta?.type || a?.type || '').toLowerCase();
  const provider = type === 'yggdrasil' || type === 'ely' ? 'ely' : type === 'msa' || type === 'microsoft' ? 'msa' : '';
  const uuid = String(a?.uuid || '')
    .replace(/-/g, '')
    .toLowerCase();
  if (!provider || !uuid) return null;
  return `${provider}:${uuid}`;
}

function normalizePresenceStatus(raw?: string | null): 'online' | 'busy' | 'dnd' | 'offline' {
  const s = String(raw || 'online').trim().toLowerCase();
  if (s === 'busy' || s === 'dnd' || s === 'offline' || s === 'online') return s;
  return 'online';
}

/** Эффективный статус: ручной offline всегда offline; иначе с учётом lastSeen */
function resolvePresence(user?: {
  lastSeenAt?: number | null;
  presenceStatus?: string | null;
  id?: string;
  provider?: string;
} | null): 'online' | 'busy' | 'dnd' | 'offline' {
  if (isProjectBotUser(user)) return 'online';
  const manual = normalizePresenceStatus(user?.presenceStatus);
  if (manual === 'offline') return 'offline';
  if (!user?.lastSeenAt || Date.now() - Number(user.lastSeenAt) >= ONLINE_MS) return 'offline';
  return manual;
}

function presenceClass(user?: {
  lastSeenAt?: number | null;
  presenceStatus?: string | null;
  id?: string;
  provider?: string;
} | null): string {
  return `is-${resolvePresence(user)}`;
}

function isOnline(user?: {
  lastSeenAt?: number | null;
  presenceStatus?: string | null;
  id?: string;
  provider?: string;
} | null): boolean {
  const p = resolvePresence(user);
  return p === 'online' || p === 'busy' || p === 'dnd';
}

function persistAccountCache(): void {
  const key = boundAccountKey || accountCacheKey();
  if (!key) return;
  try {
    const messagesByConv: Record<string, MessengerMessage[]> = {};
    if (activeId && messages.length) messagesByConv[activeId] = messages;
    localStorage.setItem(
      MSGR_CACHE_PREFIX + key,
      JSON.stringify({
        conversations,
        messagesByConv,
        activeId,
        presenceStatus: myPresenceStatus,
        savedAt: Date.now(),
      }),
    );
    localStorage.setItem(MSGR_PRESENCE_PREFIX + key, myPresenceStatus);
  } catch {
    /* ignore quota */
  }
}

function restoreAccountCache(key: string | null): void {
  conversations = [];
  messages = [];
  activeId = null;
  friendsBundle = { friends: [], incoming: [], outgoing: [] };
  blockedUsers = [];
  directoryUsers = [];
  directoryTotal = 0;
  pendingFiles = [];
  replyTo = null;
  if (!key) return;
  try {
    const raw = localStorage.getItem(MSGR_CACHE_PREFIX + key);
    const presenceRaw = localStorage.getItem(MSGR_PRESENCE_PREFIX + key);
    if (presenceRaw) myPresenceStatus = normalizePresenceStatus(presenceRaw);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.conversations)) conversations = parsed.conversations;
    if (parsed?.activeId && parsed?.messagesByConv?.[parsed.activeId]) {
      activeId = String(parsed.activeId);
      messages = Array.isArray(parsed.messagesByConv[parsed.activeId])
        ? parsed.messagesByConv[parsed.activeId]
        : [];
    }
    if (parsed?.presenceStatus) myPresenceStatus = normalizePresenceStatus(parsed.presenceStatus);
  } catch {
    /* ignore */
  }
}

function cropSkinHead(skinUrl: string, size = AVATAR_SIZE): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.imageSmoothingEnabled = false;
        const scale = img.width / 64;
        const h = 8 * scale;
        ctx.drawImage(img, 8 * scale, 8 * scale, h, h, 0, 0, size, size);
        ctx.drawImage(img, 40 * scale, 8 * scale, h, h, 0, 0, size, size);
        resolve(canvas.toDataURL('image/png'));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = skinUrl;
  });
}

function rawSkinUrl(user: MessengerUser): string {
  const toHttps = (u: string) => String(u || '').replace(/^http:\/\//i, 'https://');
  if (user.provider === 'ely') {
    // Без своего скина — дефолтная текстура (skinsystem/{nick}.png часто 404)
    const candidate = user.skinUrl ? toHttps(user.skinUrl) : DEFAULT_ACCOUNT_SKIN_URL;
    return skinImageUrl(candidate) || candidate;
  }
  if (user.skinUrl) {
    const https = toHttps(user.skinUrl);
    return skinImageUrl(https) || https;
  }
  const uuid = String(user.uuid || '').replace(/-/g, '');
  if (uuid) {
    return (
      skinImageUrl(`https://mc-heads.net/avatar/${uuid}/64`) ||
      `${getApiBase()}/api/skin/image?url=${encodeURIComponent(`https://mc-heads.net/avatar/${uuid}/64`)}`
    );
  }
  return skinImageUrl(DEFAULT_ACCOUNT_SKIN_URL) || DEFAULT_ACCOUNT_SKIN_URL;
}

/** Полная текстура скина для SkinViewEngine (не аватар-голова). */
function fullSkinTextureUrl(user: MessengerUser): string {
  if (isProjectBotUser(user)) {
    return skinImageUrl(PROJECT_BOT_SKIN_URL) || PROJECT_BOT_SKIN_URL;
  }
  const toHttps = (u: string) => String(u || '').replace(/^http:\/\//i, 'https://');
  if (user.provider === 'ely') {
    const candidate = user.skinUrl ? toHttps(user.skinUrl) : DEFAULT_ACCOUNT_SKIN_URL;
    return skinImageUrl(candidate) || candidate;
  }
  if (user.skinUrl && /textures\.minecraft\.net|skin/i.test(user.skinUrl)) {
    const https = toHttps(user.skinUrl);
    return skinImageUrl(https) || https;
  }
  const uuid = String(user.uuid || '').replace(/-/g, '');
  if (uuid) {
    return (
      skinImageUrl(`https://mc-heads.net/skin/${uuid}`) ||
      `${getApiBase()}/api/skin/image?url=${encodeURIComponent(`https://mc-heads.net/skin/${uuid}`)}`
    );
  }
  return rawSkinUrl(user);
}

function openOverlay(id: string): void {
  if (host?.openModal) host.openModal(id);
  else $(id)?.classList.remove('hidden');
}

function closeOverlay(id: string): void {
  if (host?.closeModal) host.closeModal(id);
  else $(id)?.classList.add('hidden');
}

function avatarUrlSync(user?: MessengerUser | null): string {
  if (!user) return '';
  const cached = avatarCache.get(user.id);
  if (cached) return cached;
  // Кастомный аватар бота (не голова со скина)
  if (isProjectBotUser(user) && user.skinUrl) {
    return resolveMsgrMediaUrl(user.skinUrl);
  }
  if (user.provider === 'msa') {
    const uuid = String(user.uuid || '').replace(/-/g, '');
    if (uuid) {
      return (
        skinImageUrl(`https://mc-heads.net/avatar/${uuid}/48`) ||
        `${getApiBase()}/api/skin/image?url=${encodeURIComponent(`https://mc-heads.net/avatar/${uuid}/48`)}`
      );
    }
  }
  return '';
}

function ensureAvatar(user: MessengerUser): void {
  if (!user?.id) return;
  // Аватар бота — загруженный файл из настроек (skin_url), не кроп скина NameMC
  if (isProjectBotUser(user)) {
    const url = user.skinUrl ? resolveMsgrMediaUrl(user.skinUrl) : '';
    if (url && avatarCache.get(user.id) !== url) {
      avatarCache.set(user.id, url);
      applyAvatarsInDom(user.id);
    }
    return;
  }
  if (avatarCache.has(user.id) || avatarInflight.has(user.id)) return;
  const raw = rawSkinUrl(user);
  if (!raw) return;
  const task = (async () => {
    if (
      user.provider === 'ely' ||
      /\.png(\?|$)/i.test(raw) ||
      raw.includes('skinsystem.ely.by') ||
      raw.includes('textures.minecraft.net')
    ) {
      const cropped = await cropSkinHead(raw);
      if (cropped) {
        avatarCache.set(user.id, cropped);
        return cropped;
      }
    }
    if (user.provider === 'msa') {
      const url = avatarUrlSync(user);
      if (url) avatarCache.set(user.id, url);
      return url;
    }
    avatarCache.set(user.id, raw);
    return raw;
  })().finally(() => {
    avatarInflight.delete(user.id);
  });
  avatarInflight.set(user.id, task);
  void task.then(() => {
    applyAvatarsInDom(user.id);
  });
}

function applyAvatarsInDom(userId: string): void {
  const url = avatarCache.get(userId);
  if (!url) return;
  document.querySelectorAll('[data-msgr-user]').forEach((el) => {
    if (el.getAttribute('data-msgr-user') !== userId) return;
    if (el instanceof HTMLImageElement) {
      if (el.getAttribute('src') !== url) el.src = url;
      return;
    }
    // Fallback-буква → картинка после асинхронной нарезки головы
    const img = document.createElement('img');
    img.setAttribute('data-msgr-user', userId);
    img.src = url;
    img.alt = '';
    const w = Number(el.getAttribute('data-size') || el.getAttribute('width') || 32) || 32;
    img.width = w;
    img.height = w;
    el.replaceWith(img);
  });
}

function avatarImgHtml(user: MessengerUser | null | undefined, size: number, fallbackLetter: string): string {
  if (!user) {
    return `<span class="msgr-avatar__fallback">${host!.escapeHtml(fallbackLetter)}</span>`;
  }
  ensureAvatar(user);
  const url = avatarCache.get(user.id) || avatarUrlSync(user);
  const idAttr = host!.escapeHtml(user.id);
  if (url) {
    return `<img data-msgr-user="${idAttr}" src="${host!.escapeHtml(url)}" alt="" width="${size}" height="${size}">`;
  }
  // data-msgr-user нужен, чтобы applyAvatarsInDom заменил placeholder после загрузки
  return `<span class="msgr-avatar__fallback" data-msgr-user="${idAttr}" data-size="${size}">${host!.escapeHtml(fallbackLetter)}</span>`;
}

function groupAvatarHtml(conv: MessengerConversation, size: number): string {
  const letter = host!.escapeHtml((conv.title || '?').slice(0, 1));
  if (conv.avatarUrl) {
    const url = resolveMsgrMediaUrl(conv.avatarUrl, conv.updatedAt);
    // При 404/битом файле — буква вместо «сломанной» картинки браузера
    return `<img class="msgr-avatar__photo" src="${host!.escapeHtml(url)}" alt="" width="${size}" height="${size}" data-fallback="${letter}" onerror="var s=document.createElement('span');s.className='msgr-avatar__fallback';s.textContent=this.getAttribute('data-fallback')||'?';this.replaceWith(s)">`;
  }
  return `<span class="msgr-avatar__fallback">${letter}</span>`;
}

/** URL медиа мессенджера; cacheBust ломает HTTP-кэш при той же пути к файлу */
function resolveMsgrMediaUrl(raw: string, cacheBust?: string | number | null): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  let url =
    s.startsWith('http://') || s.startsWith('https://') || s.startsWith('data:')
      ? s
      : `${getApiBase()}${s.startsWith('/') ? '' : '/'}${s}`;
  if (cacheBust != null && String(cacheBust) !== '') {
    const sep = url.includes('?') ? '&' : '?';
    url += `${sep}v=${encodeURIComponent(String(cacheBust))}`;
  }
  return url;
}

/** Режим левой панели профиля: скин / обложка / скрыта */
function setProfileSkinPanel(
  mode: 'dm' | 'cover' | 'hidden',
  coverUrl?: string | null,
  cacheBust?: string | number | null,
): void {
  const skin = $('msgr-profile-skin');
  const canvas = $('msgr-profile-canvas') as HTMLCanvasElement | null;
  const fallback = $('msgr-profile-skin-fallback');
  const win = document.querySelector('.msgr-profile-window');
  win?.classList.toggle('is-no-skin', mode === 'hidden');
  if (skin) skin.hidden = mode === 'hidden';
  if (mode === 'hidden') {
    disposeProfileViewer();
    if (canvas) canvas.hidden = true;
    if (fallback) {
      fallback.hidden = true;
      fallback.innerHTML = '';
    }
    return;
  }
  if (mode === 'cover') {
    disposeProfileViewer();
    if (canvas) canvas.hidden = true;
    if (fallback) {
      const url = coverUrl ? resolveMsgrMediaUrl(coverUrl, cacheBust) : '';
      if (!url) {
        fallback.hidden = true;
        fallback.innerHTML = '';
        return;
      }
      fallback.hidden = false;
      fallback.innerHTML = `<img class="msgr-profile__cover" src="${host!.escapeHtml(url)}" alt="">`;
    }
    return;
  }
  // dm — canvas/fallback дальше настраивает ensureProfileViewer
  if (skin) skin.hidden = false;
}

/**
 * Кадрирование обложки: только масштаб и положение в рамке панели профиля (~300×680).
 * Возвращает JPEG data URL или null при отмене.
 */
function openCoverCropEditor(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = $('modal-msgr-cover');
    const frame = $('msgr-cover-frame');
    const img = $('msgr-cover-img') as HTMLImageElement | null;
    const zoomEl = $('msgr-cover-zoom') as HTMLInputElement | null;
    const ok = $('modal-msgr-cover-ok');
    const cancel = $('modal-msgr-cover-cancel');
    const closeBtn = $('modal-msgr-cover-close');
    if (!overlay || !frame || !img || !zoomEl || !ok || !cancel) {
      resolve(null);
      return;
    }

    let baseScale = 1;
    let zoom = 1;
    let offsetX = 0;
    let offsetY = 0;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let nw = 0;
    let nh = 0;
    let ready = false;

    const frameW = () => frame.clientWidth || 220;
    const frameH = () => frame.clientHeight || 410;

    const syncZoomProgress = () => {
      const min = Number(zoomEl.min) || 100;
      const max = Number(zoomEl.max) || 300;
      const val = Number(zoomEl.value) || min;
      const pct = ((val - min) / (max - min)) * 100;
      zoomEl.style.setProperty('--range-progress', `${pct}%`);
    };

    const clampOffsets = () => {
      const fw = frameW();
      const fh = frameH();
      const scale = baseScale * zoom;
      const dw = nw * scale;
      const dh = nh * scale;
      const minX = Math.min(0, fw - dw);
      const minY = Math.min(0, fh - dh);
      offsetX = Math.min(0, Math.max(minX, offsetX));
      offsetY = Math.min(0, Math.max(minY, offsetY));
    };

    const applyTransform = () => {
      clampOffsets();
      const scale = baseScale * zoom;
      img.style.width = `${nw * scale}px`;
      img.style.height = `${nh * scale}px`;
      img.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
    };

    const fitCover = () => {
      const fw = frameW();
      const fh = frameH();
      baseScale = Math.max(fw / nw, fh / nh);
      zoom = 1;
      zoomEl.value = '100';
      syncZoomProgress();
      const dw = nw * baseScale;
      const dh = nh * baseScale;
      offsetX = (fw - dw) / 2;
      offsetY = (fh - dh) / 2;
      applyTransform();
    };

    const exportDataUrl = (): string => {
      if (!ready || !img.complete || nw < 1 || nh < 1) return '';
      const fw = frameW();
      const fh = frameH();
      const scale = baseScale * zoom;
      const outW = 600;
      const outH = Math.round((outW * fh) / fw);
      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d');
      if (!ctx) return '';
      const sx = -offsetX / scale;
      const sy = -offsetY / scale;
      const sw = fw / scale;
      const sh = fh / scale;
      try {
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
      } catch {
        return '';
      }
      // JPEG компактнее для обложки (лимит API 2 МБ)
      return canvas.toDataURL('image/jpeg', 0.88);
    };

    const finish = (value: string | null) => {
      closeOverlay('modal-msgr-cover');
      overlay.setAttribute('aria-hidden', 'true');
      img.removeAttribute('src');
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      closeBtn?.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onBackdrop);
      frame.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      frame.removeEventListener('wheel', onWheel);
      zoomEl.removeEventListener('input', onZoomInput);
      resolve(value);
    };

    const onOk = () => {
      const dataUrl = exportDataUrl();
      if (!dataUrl) {
        toast(host?.t('msgr.coverFailed', { msg: 'image' }) || 'Cover export failed');
        return;
      }
      finish(dataUrl);
    };
    const onCancel = () => finish(null);
    const onBackdrop = (e: Event) => {
      if (e.target === overlay) onCancel();
    };
    const onZoomInput = () => {
      const next = Math.max(1, Number(zoomEl.value) / 100);
      const fw = frameW();
      const fh = frameH();
      const cx = fw / 2;
      const cy = fh / 2;
      const prev = zoom;
      const imgX = (cx - offsetX) / (baseScale * prev);
      const imgY = (cy - offsetY) / (baseScale * prev);
      zoom = next;
      offsetX = cx - imgX * baseScale * zoom;
      offsetY = cy - imgY * baseScale * zoom;
      syncZoomProgress();
      applyTransform();
    };
    const onPointerDown = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      frame.classList.add('is-dragging');
      frame.setPointerCapture?.(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      offsetX += e.clientX - lastX;
      offsetY += e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      applyTransform();
    };
    const onPointerUp = () => {
      dragging = false;
      frame.classList.remove('is-dragging');
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -5 : 5;
      const next = Math.min(300, Math.max(100, Number(zoomEl.value) + delta));
      zoomEl.value = String(next);
      onZoomInput();
    };

    img.onload = () => {
      nw = img.naturalWidth || 1;
      nh = img.naturalHeight || 1;
      ready = true;
      fitCover();
    };
    img.onerror = () => {
      ready = false;
      toast(host?.t('msgr.coverFailed', { msg: 'load' }) || 'Cover load failed');
      finish(null);
    };

    // data: уже разрешён CSP (blob: мог блокироваться)
    const reader = new FileReader();
    reader.onload = () => {
      img.src = String(reader.result || '');
    };
    reader.onerror = () => {
      toast(host?.t('msgr.coverFailed', { msg: 'read' }) || 'Cover read failed');
      finish(null);
    };
    reader.readAsDataURL(file);

    zoomEl.value = '100';
    syncZoomProgress();
    openOverlay('modal-msgr-cover');
    overlay.setAttribute('aria-hidden', 'false');

    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    closeBtn?.addEventListener('click', onCancel);
    overlay.addEventListener('click', onBackdrop);
    frame.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    frame.addEventListener('wheel', onWheel, { passive: false });
    zoomEl.addEventListener('input', onZoomInput);
  });
}

function formatMsgTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatLastSeen(ts?: number | null): string {
  if (!ts) return host?.t('msgr.lastSeenUnknown') || '';
  const diff = Date.now() - Number(ts);
  if (diff < ONLINE_MS) return host?.t('msgr.online') || 'Online';
  if (diff < 3600000) {
    const m = Math.max(1, Math.floor(diff / 60000));
    return host?.t('msgr.lastSeenMinutes', { n: m }) || `${m}m`;
  }
  if (diff < 86400000) {
    const h = Math.floor(diff / 3600000);
    return host?.t('msgr.lastSeenHours', { n: h }) || `${h}h`;
  }
  return formatMsgTime(Number(ts));
}

function activityLine(user?: MessengerUser | null): string {
  const a = user?.activity;
  if (!a?.playing || !a.build) return '';
  const parts = [a.build];
  if (a.version) parts.push(String(a.version));
  if (a.loader && a.loader !== 'vanilla') parts.push(String(a.loader));
  if (a.server) parts.push(String(a.server));
  return parts.join(' · ');
}

function previewText(conv: MessengerConversation): string {
  const last = conv.lastMessage;
  if (!last) return host?.t('msgr.noMessages') || '';
  if (last.deleted) return host?.t('msgr.messageDeleted') || '';
  const mine = me && last.senderId === me.id;
  const prefix = mine ? `${host?.t('msgr.you') || 'You'}: ` : '';
  if (last.kind === 'game_invite') {
    return prefix + (host?.t('msgr.invitePreview') || 'Invite');
  }
  return prefix + last.body;
}

async function req(
  path: string,
  opts: { method?: string; body?: unknown; query?: Record<string, string | number | undefined> } = {},
): Promise<any> {
  const api = host?.api;
  if (!api?.messengerRequest) return { ok: false, code: 'unavailable' };
  return api.messengerRequest({ path, method: opts.method, body: opts.body, query: opts.query });
}

function setGate(mode: 'loading' | 'need-account' | 'error' | 'ready', errorText?: string): void {
  const gate = $('msgr-gate');
  const shell = $('msgr-shell');
  const retry = $('msgr-retry');
  if (!gate || !shell) return;
  const title = gate.querySelector('.msgr-gate__title');
  const hint = gate.querySelector('.msgr-gate__hint');
  const spinner = gate.querySelector('.msgr-gate__spinner');

  if (mode === 'ready' || mode === 'loading') {
    gate.hidden = true;
    gate.classList.remove('is-loading', 'is-blocking');
    shell.hidden = false;
    shell.classList.remove('is-dimmed');
    if (retry) retry.classList.add('hidden');
    return;
  }

  shell.hidden = true;
  shell.classList.remove('is-dimmed');
  gate.hidden = false;
  gate.classList.remove('is-loading');
  gate.classList.add('is-blocking');
  if (spinner) (spinner as HTMLElement).hidden = true;
  if (!host) return;
  if (mode === 'need-account') {
    if (title) title.textContent = host.t('msgr.needAccount');
    if (hint) hint.textContent = host.t('msgr.needAccountHint');
  } else {
    if (title) title.textContent = host.t('msgr.error');
    if (hint) hint.textContent = errorText || host.t('msgr.errorHint');
  }
  if (retry) retry.classList.remove('hidden');
  conversations = [];
  updateMessengerTabBadge();
}

function renderPresence(state: 'online' | 'connecting' | 'offline' | 'busy' | 'dnd' = 'online'): void {
  const el = $('msgr-presence');
  if (!el || !host) return;
  const effective =
    state === 'connecting'
      ? 'connecting'
      : state === 'offline'
        ? 'offline'
        : myPresenceStatus === 'offline'
          ? 'offline'
          : myPresenceStatus === 'busy'
            ? 'busy'
            : myPresenceStatus === 'dnd'
              ? 'dnd'
              : state === 'online'
                ? 'online'
                : 'offline';
  el.className = `msgr-presence is-${effective}`;
  el.setAttribute('aria-expanded', 'false');
  const labelKey =
    effective === 'connecting'
      ? 'msgr.connectingShort'
      : effective === 'busy'
        ? 'msgr.statusBusy'
        : effective === 'dnd'
          ? 'msgr.statusDnd'
          : effective === 'offline'
            ? 'msgr.statusOffline'
            : 'msgr.statusOnline';
  if (effective === 'connecting') {
    el.innerHTML = `<span class="msgr-presence__dot is-pulse"></span><span class="msgr-presence__label">${host.escapeHtml(host.t(labelKey))}</span>`;
    return;
  }
  el.innerHTML = `<span class="msgr-presence__dot is-${effective}"></span><span class="msgr-presence__label">${host.escapeHtml(host.t(labelKey))}</span>`;
}

function setPresenceMenuOpen(open: boolean): void {
  const menu = $('msgr-presence-menu');
  const btn = $('msgr-presence');
  if (!menu || !btn) return;
  menu.classList.toggle('hidden', !open);
  menu.setAttribute('aria-hidden', open ? 'false' : 'true');
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

async function setMyPresenceStatus(status: 'online' | 'busy' | 'dnd' | 'offline'): Promise<void> {
  myPresenceStatus = status;
  const key = boundAccountKey || accountCacheKey();
  if (key) {
    try {
      localStorage.setItem(MSGR_PRESENCE_PREFIX + key, status);
    } catch {
      /* ignore */
    }
  }
  renderPresence(status === 'offline' ? 'offline' : 'online');
  setPresenceMenuOpen(false);
  if (!sessionToken) return;
  const res = await req('/presence', { method: 'POST', body: { status } });
  if (res?.ok && res.data?.user) {
    me = { ...me!, ...res.data.user, presenceStatus: status };
  } else if (!res?.ok) {
    toast(host?.t('msgr.presenceFailed', { msg: res?.error || '' }) || 'Presence failed');
  }
  persistAccountCache();
}

function updateMessengerTabBadge(): void {
  const badge = $('msgr-tab-badge');
  if (!badge) return;
  const total = conversations.reduce((sum, c) => sum + (Number(c.unreadCount) || 0), 0);
  if (total <= 0) {
    badge.hidden = true;
    badge.setAttribute('aria-hidden', 'true');
    badge.textContent = '0';
    return;
  }
  badge.hidden = false;
  badge.setAttribute('aria-hidden', 'false');
  badge.textContent = total > 99 ? '99+' : String(total);
}

function renderConversationList(): void {
  const list = $('msgr-chat-list');
  if (!list || !host) return;
  updateMessengerTabBadge();
  if (!conversations.length) {
    list.innerHTML = `<div class="msgr-empty-list">${host.escapeHtml(host.t('msgr.emptyChats'))}</div>`;
    return;
  }
  const prefs = pruneExpiredMutes(loadMsgrPrefs());
  const ordered = [...conversations].sort((a, b) => {
    const aBot = a.isBotDm ? 0 : 1;
    const bBot = b.isBotDm ? 0 : 1;
    if (aBot !== bBot) return aBot - bBot;
    const aProj = a.isProject ? 0 : 1;
    const bProj = b.isProject ? 0 : 1;
    if (aProj !== bProj) return aProj - bProj;
    const ap = prefs.pinned.includes(a.id) ? 0 : 1;
    const bp = prefs.pinned.includes(b.id) ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0);
  });
  list.innerHTML = ordered
    .map((c) => {
      const user = c.type === 'dm' ? c.peer : null;
      if (user) ensureAvatar(user);
      const title = host!.escapeHtml(
        c.isProject ? host!.t('msgr.projectChat') : c.title || 'Chat',
      );
      const preview = host!.escapeHtml(previewText(c));
      const badge = c.isProject
        ? `<span class="msgr-badge msgr-badge--project">${host!.escapeHtml(host!.t('msgr.projectChatBadge'))}</span>`
        : user
          ? `<span class="msgr-badge ${providerClass(user.provider)}">${host!.escapeHtml(providerLabel(user.provider))}</span>`
          : `<span class="msgr-badge msgr-badge--group">${host!.escapeHtml(host!.t('msgr.group'))}</span>`;
      const online = user ? presenceClass(user) : '';
      const active = c.id === activeId ? 'is-active' : '';
      const projectCls = c.isProject ? ' msgr-chat-item--project' : '';
      const unread =
        c.unreadCount && c.id !== activeId ? `<span class="msgr-unread">${c.unreadCount}</span>` : '';
      const marks =
        (prefs.pinned.includes(c.id) ? `<span class="msgr-chat-mark is-pinned" title="${host!.escapeHtml(host!.t('msgr.actionPin'))}" aria-hidden="true"></span>` : '') +
        (isConvMuted(c.id)
          ? `<span class="msgr-chat-mark is-muted" data-mute-id="${host!.escapeHtml(c.id)}" title="${host!.escapeHtml(host!.t('msgr.actionMuted'))}" aria-hidden="true"></span>`
          : '');
      const av =
        c.type === 'group'
          ? groupAvatarHtml(c, 40)
          : avatarImgHtml(user || undefined, 40, (c.title || '?').slice(0, 1));
      return `
        <button type="button" class="msgr-chat-item${projectCls} ${active}" data-id="${host!.escapeHtml(c.id)}">
          <span class="msgr-avatar ${online}">${av}</span>
          <span class="msgr-chat-item__body">
            <span class="msgr-chat-item__top">
              <span class="msgr-chat-item__name">${marks}${title}</span>
              ${badge}
              ${unread}
            </span>
            <span class="msgr-chat-item__preview">${preview}</span>
          </span>
        </button>`;
    })
    .join('');
}

function friendRowHtml(user: MessengerUser, kind: 'friend' | 'incoming' | 'outgoing' | 'blocked'): string {
  ensureAvatar(user);
  const online = presenceClass(user);
  const actions =
    kind === 'incoming'
      ? `<button type="button" class="msgr-mini-btn" data-friend-act="accept" data-user-id="${host!.escapeHtml(user.id)}">${host!.escapeHtml(host!.t('msgr.friendAccept'))}</button>
         <button type="button" class="msgr-mini-btn" data-friend-act="decline" data-user-id="${host!.escapeHtml(user.id)}">${host!.escapeHtml(host!.t('msgr.friendDecline'))}</button>`
      : kind === 'outgoing'
        ? `<button type="button" class="msgr-mini-btn" data-friend-act="cancel" data-user-id="${host!.escapeHtml(user.id)}">${host!.escapeHtml(host!.t('msgr.friendCancel'))}</button>`
        : kind === 'blocked'
          ? `<button type="button" class="msgr-mini-btn" data-friend-act="unblock" data-user-id="${host!.escapeHtml(user.id)}">${host!.escapeHtml(host!.t('msgr.actionUnblock'))}</button>`
          : `<button type="button" class="msgr-mini-btn" data-friend-act="write" data-user-id="${host!.escapeHtml(user.id)}">${host!.escapeHtml(host!.t('msgr.actionWrite'))}</button>
             <button type="button" class="msgr-mini-btn" data-friend-act="profile" data-user-id="${host!.escapeHtml(user.id)}">${host!.escapeHtml(host!.t('msgr.actionOpenProfile'))}</button>`;
  return `<div class="msgr-friend-item" data-user-id="${host!.escapeHtml(user.id)}">
    <span class="msgr-avatar ${online}">${avatarImgHtml(user, 36, user.username.slice(0, 1))}</span>
    <span class="msgr-friend-item__body">
      <span class="msgr-friend-item__name">${host!.escapeHtml(user.username)}</span>
      <span class="msgr-badge ${providerClass(user.provider)}">${host!.escapeHtml(providerLabel(user.provider))}</span>
    </span>
    <span class="msgr-friend-item__actions">${actions}</span>
  </div>`;
}

function renderFriendsList(): void {
  const list = $('msgr-friends-list');
  if (!list || !host) return;
  if (railTab === 'blocked') {
    list.innerHTML = `
      <div class="msgr-friends-head">
        <button type="button" class="msgr-mini-btn" data-friend-act="back-friends">${host.escapeHtml(host.t('msgr.backToFriends'))}</button>
        <div class="msgr-friends-title">${host.escapeHtml(host.t('msgr.blockedTitle'))}</div>
      </div>
      ${
        blockedUsers.length
          ? blockedUsers.map((u) => friendRowHtml(u, 'blocked')).join('')
          : `<div class="msgr-empty-list">${host.escapeHtml(host.t('msgr.blockedEmpty'))}</div>`
      }`;
    return;
  }
  const parts: string[] = [];
  parts.push(`<div class="msgr-friends-head">
    <div class="msgr-friends-title">${host.escapeHtml(host.t('msgr.tabFriends'))}</div>
    <button type="button" class="msgr-mini-btn" data-friend-act="show-blocked">${host.escapeHtml(host.t('msgr.blockedTitle'))}</button>
  </div>`);
  if (friendsBundle.incoming.length) {
    parts.push(`<div class="msgr-friends-section">${host.escapeHtml(host.t('msgr.friendIncoming'))}</div>`);
    parts.push(friendsBundle.incoming.map((u) => friendRowHtml(u, 'incoming')).join(''));
  }
  if (friendsBundle.outgoing.length) {
    parts.push(`<div class="msgr-friends-section">${host.escapeHtml(host.t('msgr.friendOutgoing'))}</div>`);
    parts.push(friendsBundle.outgoing.map((u) => friendRowHtml(u, 'outgoing')).join(''));
  }
  parts.push(`<div class="msgr-friends-section">${host.escapeHtml(host.t('msgr.friendsList'))}</div>`);
  if (friendsBundle.friends.length) {
    parts.push(friendsBundle.friends.map((u) => friendRowHtml(u, 'friend')).join(''));
  } else {
    parts.push(`<div class="msgr-empty-list">${host.escapeHtml(host.t('msgr.friendsEmpty'))}</div>`);
  }
  list.innerHTML = parts.join('');
}

function renderUsersDirectory(opts?: { failed?: boolean }): void {
  const list = $('msgr-users-list');
  if (!list || !host) return;
  const count =
    directoryTotal > 0
      ? `<div class="msgr-friends-section">${host.escapeHtml(host.t('msgr.browseUsersCount', { n: String(directoryTotal) }))}</div>`
      : '';
  const body = opts?.failed
    ? `<div class="msgr-empty-list">${host.escapeHtml(host.t('msgr.browseUsersFailed'))}</div>`
    : directoryUsers.length
      ? directoryUsers.map((u) => friendRowHtml(u, 'friend')).join('')
      : `<div class="msgr-empty-list">${host.escapeHtml(host.t('msgr.browseUsersEmpty'))}</div>`;
  list.innerHTML = `
    <div class="msgr-friends-head">
      <button type="button" class="msgr-mini-btn" data-user-dir-act="back-chats">${host.escapeHtml(host.t('msgr.backToChats'))}</button>
      <div class="msgr-friends-title">${host.escapeHtml(host.t('msgr.browseUsersTitle'))}</div>
    </div>
    ${count}
    ${body}`;
}

async function refreshUsersDirectory(): Promise<void> {
  const res = await req('/users/directory', { query: { limit: 200, offset: 0 } });
  if (!res?.ok) {
    directoryUsers = [];
    directoryTotal = 0;
    renderUsersDirectory({ failed: true });
    return;
  }
  directoryUsers = Array.isArray(res.data?.users) ? res.data.users : [];
  directoryTotal = Number(res.data?.total || directoryUsers.length) || 0;
  renderUsersDirectory();
}

function setRailTab(tab: 'chats' | 'friends' | 'worlds' | 'blocked' | 'users'): void {
  const next = tab === 'blocked' ? 'blocked' : tab;
  const prev = railTab;
  railTab = next;
  const chatsList = $('msgr-chat-list');
  const friendsList = $('msgr-friends-list');
  const worldsList = $('msgr-worlds-list');
  const usersList = $('msgr-users-list');
  const pages = $('msgr-rail-pages');
  const tabs = $('msgr-rail-tabs');
  const newGroup = $('msgr-new-group');
  const browseUsers = $('msgr-browse-users');
  const tabChats = $('msgr-tab-chats');
  const tabFriends = $('msgr-tab-friends');
  const tabWorlds = $('msgr-tab-worlds');
  const showChats = railTab === 'chats';
  const showFriends = railTab === 'friends' || railTab === 'blocked';
  const showWorlds = railTab === 'worlds';
  const showUsers = railTab === 'users';
  const dir =
    prev === 'chats' && !showChats ? 'left' : prev !== 'chats' && showChats ? 'right' : showChats ? 'right' : 'left';
  if (pages) pages.setAttribute('data-dir', dir);
  if (tabs) {
    tabs.setAttribute(
      'data-active',
      showChats || showUsers ? 'chats' : showWorlds ? 'worlds' : 'friends',
    );
  }
  if (chatsList) {
    chatsList.hidden = false;
    chatsList.classList.toggle('is-active', showChats);
  }
  if (friendsList) {
    friendsList.hidden = false;
    friendsList.classList.toggle('is-active', showFriends);
  }
  if (worldsList) {
    worldsList.hidden = false;
    worldsList.classList.toggle('is-active', showWorlds);
  }
  if (usersList) {
    usersList.hidden = false;
    usersList.classList.toggle('is-active', showUsers);
  }
  if (newGroup) newGroup.hidden = !showChats;
  if (browseUsers) browseUsers.hidden = !showChats;
  tabChats?.classList.toggle('is-active', showChats);
  tabFriends?.classList.toggle('is-active', showFriends);
  tabWorlds?.classList.toggle('is-active', showWorlds);
  tabChats?.setAttribute('aria-selected', showChats ? 'true' : 'false');
  tabFriends?.setAttribute('aria-selected', showFriends ? 'true' : 'false');
  tabWorlds?.setAttribute('aria-selected', showWorlds ? 'true' : 'false');
  if (showChats) renderConversationList();
  else if (showWorlds) void refreshWorldsRail();
  else if (showUsers) void refreshUsersDirectory();
  else void refreshFriendsRail();
}

async function refreshWorldsRail(): Promise<void> {
  const res = await req('/friends');
  if (res?.ok) {
    friendsBundle = {
      friends: Array.isArray(res.data?.friends) ? res.data.friends : [],
      incoming: Array.isArray(res.data?.incoming) ? res.data.incoming : [],
      outgoing: Array.isArray(res.data?.outgoing) ? res.data.outgoing : [],
    };
  }
  renderWorldsList();
}

type ProfilePanelTab = 'info' | 'members' | 'media';
const PROFILE_TAB_ORDER: ProfilePanelTab[] = ['info', 'members', 'media'];
let profilePanelTab: ProfilePanelTab = 'info';

/** Групповой статус: онлайн + участники */
function groupOnlineMembersLabel(conv: MessengerConversation): string {
  if (!host) return '';
  const members = conv.memberCount ?? conv.members?.length ?? 0;
  const online = conv.onlineCount ?? 0;
  return host.t('msgr.onlineAndMembers', { online, members });
}

/** Блокировка композера при модераторском муте */
function applyComposerMuteState(): void {
  if (!host) return;
  const input = $('msgr-input') as HTMLTextAreaElement | null;
  const send = $('msgr-send') as HTMLButtonElement | null;
  const attach = $('msgr-attach') as HTMLButtonElement | null;
  const conv = conversations.find((c) => c.id === activeId) || null;
  const mute = conv?.myMute;
  const muted = Boolean(mute);
  if (input) {
    input.disabled = muted;
    if (muted) {
      if (mute!.until == null) {
        input.placeholder = host.t('msgr.mutedForever');
      } else {
        const n = Math.max(1, Math.ceil((mute!.until - Date.now()) / 60_000));
        input.placeholder = host.t('msgr.mutedForMinutes', { n });
      }
    } else {
      input.placeholder = host.t('msgr.placeholder');
    }
  }
  if (send) send.disabled = muted;
  if (attach) {
    attach.disabled = muted;
    if (muted) setAttachMenuOpen(false);
  }
}

/** Панель закреплённого сообщения над лентой */
function renderPinBar(): void {
  const bar = $('msgr-pin-bar');
  const label = $('msgr-pin-bar-label');
  const text = $('msgr-pin-bar-text');
  const unpin = $('msgr-pin-bar-unpin');
  if (!bar || !host) return;
  const conv = conversations.find((c) => c.id === activeId) || null;
  const pin = conv?.pinnedMessage;
  if (!conv || !pin || pin.deleted) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  if (label) label.textContent = host.t('msgr.pinnedMessage');
  if (text) {
    text.textContent = pin.attachment
      ? pin.attachment.name
      : String(pin.body || '').slice(0, 120) || '…';
  }
  const canMod = conv.myRole === 'owner' || conv.myRole === 'admin';
  if (unpin) unpin.hidden = !canMod;
}

function scrollToMessageId(msgId: string): void {
  const thread = $('msgr-messages');
  if (!thread) return;
  const row = Array.from(thread.querySelectorAll('[data-msg-id]')).find(
    (el) => el.getAttribute('data-msg-id') === msgId,
  ) as HTMLElement | undefined;
  if (!row) return;
  row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  row.classList.add('is-flash');
  window.setTimeout(() => row.classList.remove('is-flash'), 1200);
}

async function clearPinnedMessage(): Promise<void> {
  if (!activeId) return;
  const res = await req(`/conversations/${encodeURIComponent(activeId)}`, {
    method: 'PATCH',
    body: { clearPinned: true },
  });
  if (res?.ok && res.data?.conversation) {
    const idx = conversations.findIndex((c) => c.id === activeId);
    if (idx >= 0) conversations[idx] = res.data.conversation;
    renderPinBar();
    renderConversationList();
  }
}

async function pinMessage(msgId: string): Promise<void> {
  if (!activeId) return;
  const res = await req(`/conversations/${encodeURIComponent(activeId)}`, {
    method: 'PATCH',
    body: { pinnedMessageId: msgId },
  });
  if (res?.ok && res.data?.conversation) {
    const idx = conversations.findIndex((c) => c.id === activeId);
    if (idx >= 0) conversations[idx] = res.data.conversation;
    renderPinBar();
    toast(host?.t('msgr.pinnedOk') || '');
  }
}

/** Переключить реакцию на сообщении */
async function toggleReaction(msgId: string, emoji: string): Promise<void> {
  if (!activeId || !(REACTION_EMOJIS as readonly string[]).includes(emoji)) return;
  const msg = messages.find((m) => m.id === msgId);
  const mine = Boolean(msg?.reactions?.some((r) => r.emoji === emoji && r.me));
  const path = `/conversations/${encodeURIComponent(activeId)}/messages/${encodeURIComponent(msgId)}/reactions`;
  const res = await req(path, {
    method: mine ? 'DELETE' : 'POST',
    body: { emoji },
  });
  if (res?.ok && res.data?.message) upsertIncomingMessage(res.data.message);
}

function renderReactionsHtml(m: MessengerMessage): string {
  if (m.deleted || !m.reactions?.length || !host) return '';
  const chips = m.reactions
    .map(
      (r) =>
        `<button type="button" class="msgr-react-chip${r.me ? ' is-me' : ''}" data-react-emoji="${host!.escapeHtml(r.emoji)}" data-msg-id="${host!.escapeHtml(m.id)}" title="${host!.escapeHtml(host!.t('msgr.react'))}">${host!.escapeHtml(r.emoji)}<span>${r.count}</span></button>`,
    )
    .join('');
  return `<div class="msgr-react-row">${chips}</div>`;
}

function setProfilePanelTab(tab: ProfilePanelTab, animate = true): void {
  const prev = profilePanelTab;
  profilePanelTab = tab;
  const tabs = $('msgr-profile-tabs');
  const pages = $('msgr-profile-pages');
  const info = $('msgr-profile-info');
  const membersPage = $('msgr-profile-members-page');
  const mediaPage = $('msgr-profile-media');
  const tabInfo = $('msgr-profile-tab-info');
  const tabMembers = $('msgr-profile-tab-members');
  const tabMedia = $('msgr-profile-tab-media');
  if (animate && pages) {
    const pi = PROFILE_TAB_ORDER.indexOf(prev);
    const ti = PROFILE_TAB_ORDER.indexOf(tab);
    pages.setAttribute('data-dir', ti >= pi ? 'left' : 'right');
  }
  if (tabs) tabs.setAttribute('data-active', tab);
  if (info) {
    info.hidden = false;
    info.classList.toggle('is-active', tab === 'info');
  }
  if (membersPage) {
    membersPage.hidden = false;
    membersPage.classList.toggle('is-active', tab === 'members');
  }
  if (mediaPage) {
    mediaPage.hidden = false;
    mediaPage.classList.toggle('is-active', tab === 'media');
  }
  tabInfo?.classList.toggle('is-active', tab === 'info');
  tabMembers?.classList.toggle('is-active', tab === 'members');
  tabMedia?.classList.toggle('is-active', tab === 'media');
  tabInfo?.setAttribute('aria-selected', tab === 'info' ? 'true' : 'false');
  tabMembers?.setAttribute('aria-selected', tab === 'members' ? 'true' : 'false');
  tabMedia?.setAttribute('aria-selected', tab === 'media' ? 'true' : 'false');
  if (tab === 'media') void loadProfileMedia();
}

async function loadProfileMedia(): Promise<void> {
  const grid = $('msgr-profile-media-grid');
  if (!grid || !host || !activeId) return;
  grid.innerHTML = '';
  const res = await req(`/conversations/${encodeURIComponent(activeId)}/media`, {
    query: { limit: 60 },
  });
  const items: MessengerMessage[] = Array.isArray(res?.data?.items) ? res.data.items : [];
  if (!items.length) {
    grid.innerHTML = `<div class="msgr-profile__media-empty">${host.escapeHtml(host.t('msgr.mediaEmpty'))}</div>`;
    return;
  }
  grid.innerHTML = items
    .map((m) => {
      if (!m.attachment) return '';
      const kind = isVideoAttachment(m.attachment) ? 'video' : 'image';
      const url = attachmentMediaUrl(m.id);
      if (kind === 'video') {
        return `<button type="button" class="msgr-profile__media-item" data-msgr-media="video" data-msg-id="${host!.escapeHtml(m.id)}">
          <video src="${host!.escapeHtml(url)}" muted preload="metadata" playsinline></video>
        </button>`;
      }
      return `<button type="button" class="msgr-profile__media-item" data-msgr-media="image" data-msg-id="${host!.escapeHtml(m.id)}">
        <img src="${host!.escapeHtml(url)}" alt="" loading="lazy">
      </button>`;
    })
    .filter(Boolean)
    .join('');
}

function setProfileTabsVisible(visible: boolean): void {
  const tabs = $('msgr-profile-tabs');
  if (tabs) tabs.hidden = !visible;
  if (!visible) setProfilePanelTab('info', false);
}

async function refreshFriendsRail(): Promise<void> {
  if (railTab === 'blocked') {
    const res = await req('/users/blocked');
    blockedUsers = res?.ok && Array.isArray(res.data?.users) ? res.data.users : [];
    renderFriendsList();
    return;
  }
  const res = await req('/friends');
  if (res?.ok) {
    friendsBundle = {
      friends: Array.isArray(res.data?.friends) ? res.data.friends : [],
      incoming: Array.isArray(res.data?.incoming) ? res.data.incoming : [],
      outgoing: Array.isArray(res.data?.outgoing) ? res.data.outgoing : [],
    };
  }
  renderFriendsList();
}

async function openProfileByUserId(userId: string): Promise<void> {
  await openProfileModal({ userId });
}

function renderPeerHeader(): void {
  const nameEl = $('msgr-peer-name');
  const metaEl = $('msgr-peer-meta');
  const avEl = $('msgr-peer-avatar');
  const empty = $('msgr-stage-empty');
  const thread = $('msgr-thread');
  const composer = $('msgr-composer-bar');
  const head = $('msgr-stage-head');
  const headRow = $('msgr-stage-head-row');
  const moreBtn = $('msgr-stage-more');
  if (!host) return;
  const conv = conversations.find((c) => c.id === activeId) || null;
  if (!conv) {
    if (nameEl) nameEl.textContent = host.t('msgr.selectChat');
    if (metaEl) metaEl.textContent = '';
    if (avEl) {
      avEl.className = 'msgr-avatar';
      avEl.innerHTML = '';
    }
    if (empty) empty.hidden = false;
    if (thread) thread.hidden = true;
    if (composer) composer.hidden = true;
    if (head) head.classList.remove('is-clickable');
    if (headRow) headRow.hidden = true;
    if (moreBtn) moreBtn.hidden = true;
    applyComposerMuteState();
    renderPinBar();
    return;
  }
  if (empty) empty.hidden = true;
  if (thread) thread.hidden = false;
  if (composer) composer.hidden = false;
  if (head) head.classList.add('is-clickable');
  if (headRow) headRow.hidden = false;
  if (moreBtn) {
    moreBtn.hidden = false;
    moreBtn.title = host.t('msgr.moreActions');
  }
  if (nameEl) nameEl.textContent = conv.isProject ? host.t('msgr.projectChat') : conv.title;
  const peer = conv.peer;
  if (metaEl) {
    if (conv.type === 'group') {
      const groupBadge = conv.isProject
        ? `<span class="msgr-badge msgr-badge--project">${host.escapeHtml(host.t('msgr.projectChatBadge'))}</span>`
        : `<span class="msgr-badge msgr-badge--group">${host.escapeHtml(host.t('msgr.group'))}</span>`;
      metaEl.innerHTML = `${groupBadge}
        <span class="msgr-peer-status">${host.escapeHtml(groupOnlineMembersLabel(conv))}</span>`;
    } else if (peer) {
      const act = activityLine(peer);
      const p = resolvePresence(peer);
      const status = act
        ? host.t('msgr.playing', { detail: act })
        : p === 'busy'
          ? host.t('msgr.statusBusy')
          : p === 'dnd'
            ? host.t('msgr.statusDnd')
            : p === 'offline'
              ? host.t('msgr.statusOffline')
              : formatLastSeen(peer.lastSeenAt);
      metaEl.innerHTML = `<span class="msgr-badge ${providerClass(peer.provider)}">${host.escapeHtml(providerLabel(peer.provider))}</span>
        <span class="msgr-peer-status">${host.escapeHtml(status)}</span>`;
    } else {
      metaEl.textContent = '';
    }
  }
  if (avEl) {
    const online = peer ? presenceClass(peer) : '';
    avEl.className = `msgr-avatar ${online}`;
    avEl.innerHTML =
      conv.type === 'group'
        ? groupAvatarHtml(conv, 36)
        : avatarImgHtml(peer || undefined, 36, (conv.title || '?').slice(0, 1));
  }
  applyComposerMuteState();
  renderPinBar();
}

function renderReplyBar(): void {
  const bar = $('msgr-reply-bar');
  const label = $('msgr-reply-label');
  const text = $('msgr-reply-text');
  if (!bar || !host) return;
  if (!replyTo) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  const conv = conversations.find((c) => c.id === activeId);
  const name =
    conv?.members?.find((u) => u.id === replyTo!.senderId)?.username ||
    (replyTo.senderId === me?.id ? host.t('msgr.you') : '');
  if (label) label.textContent = host.t('msgr.replyTo', { name });
  if (text) text.textContent = replyTo.deleted ? host.t('msgr.messageDeleted') : replyTo.body;
}

function setReplyTo(msg: MessengerMessage | null): void {
  replyTo = msg;
  renderReplyBar();
}

function isMessagesNearBottom(thread: HTMLElement, thresholdPx = 96): boolean {
  return thread.scrollHeight - thread.scrollTop - thread.clientHeight <= thresholdPx;
}

/** В DOM уже есть пузыри текущего activeId (кеш мог восстановиться до появления me). */
function isMessagesThreadPainted(): boolean {
  const thread = $('msgr-messages');
  if (!thread) return false;
  if (!messages.length) return true;
  return Boolean(thread.querySelector('[data-msg-id]'));
}

/** lastReadAt собеседника (DM) или null в группах */
function peerLastReadAt(conv: MessengerConversation | undefined): number | null {
  if (!conv || conv.type !== 'dm' || !me) return null;
  const peer =
    conv.peer ||
    conv.members?.find((m) => m.id !== me!.id) ||
    null;
  const ts = peer?.lastReadAt;
  return typeof ts === 'number' && ts > 0 ? ts : null;
}

function readReceiptHtml(m: MessengerMessage, conv: MessengerConversation | undefined): string {
  if (!host || !me || m.senderId !== me.id || m.deleted) return '';
  const peerRead = peerLastReadAt(conv);
  const seen = peerRead != null && m.createdAt <= peerRead;
  const label = seen ? host.t('msgr.read') : host.t('msgr.sent');
  const cls = seen ? 'msgr-bubble__read is-read' : 'msgr-bubble__read is-sent';
  return `<span class="${cls}" title="${host.escapeHtml(label)}">${seen ? '✓✓' : '✓'}</span>`;
}

function clearTypingState(): void {
  typingPeers.clear();
  renderTypingIndicator();
}

function renderTypingIndicator(): void {
  const el = $('msgr-typing');
  if (!el || !host) return;
  const now = Date.now();
  for (const [id, info] of [...typingPeers.entries()]) {
    if (info.until < now) typingPeers.delete(id);
  }
  if (!activeId || typingPeers.size === 0) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  const names = [...typingPeers.values()].map((v) => v.name).filter(Boolean);
  el.hidden = false;
  if (names.length === 1) {
    el.textContent = host.t('msgr.typingOne', { name: names[0] });
  } else if (names.length === 2) {
    el.textContent = host.t('msgr.typingTwo', { a: names[0], b: names[1] });
  } else {
    el.textContent = host.t('msgr.typingMany', { n: names.length });
  }
}

function notePeerTyping(payload: { conversationId?: string; userId?: string; username?: string }): void {
  if (!payload?.conversationId || payload.conversationId !== activeId) return;
  if (!payload.userId || payload.userId === me?.id) return;
  typingPeers.set(payload.userId, {
    name: String(payload.username || host?.t('msgr.someone') || '…'),
    until: Date.now() + 3500,
  });
  renderTypingIndicator();
  if (!typingUiTimer) {
    typingUiTimer = setInterval(() => renderTypingIndicator(), 800);
  }
}

function sendTypingPulse(): void {
  if (!activeId || !sessionToken) return;
  void req(`/conversations/${encodeURIComponent(activeId)}/typing`, {
    method: 'POST',
    body: {},
  });
}

function scheduleTypingPulse(): void {
  if (typingSendTimer) return;
  typingSendTimer = setTimeout(() => {
    typingSendTimer = null;
    sendTypingPulse();
  }, 900);
}

async function loadOlderMessages(): Promise<void> {
  if (!activeId || messagesLoadingOlder || !messagesHasMore || !messages.length) return;
  const before = messages[0]?.createdAt;
  if (!before) return;
  messagesLoadingOlder = true;
  const thread = $('msgr-messages');
  const prevHeight = thread?.scrollHeight || 0;
  const prevTop = thread?.scrollTop || 0;
  try {
    const res = await req(`/conversations/${encodeURIComponent(activeId)}/messages`, {
      query: { limit: 50, before: String(before) },
    });
    if (!res?.ok) return;
    const older: MessengerMessage[] = Array.isArray(res.data?.messages) ? res.data.messages : [];
    if (older.length < 50) messagesHasMore = false;
    if (!older.length) return;
    const seen = new Set(messages.map((m) => m.id));
    const add = older.filter((m) => m?.id && !seen.has(m.id));
    if (!add.length) {
      messagesHasMore = false;
      return;
    }
    messages = [...add, ...messages];
    renderMessages({ forceScrollBottom: false });
    if (thread) {
      thread.scrollTop = Math.max(0, thread.scrollHeight - prevHeight + prevTop);
    }
  } finally {
    messagesLoadingOlder = false;
  }
}

function renderMessages(opts?: { forceScrollBottom?: boolean }): void {
  const thread = $('msgr-messages');
  // me может ещё не быть (восстановление кеша до messengerSession) — всё равно рисуем ленту
  if (!thread || !host) return;
  const conv = conversations.find((c) => c.id === activeId);
  const stickBottom = Boolean(opts?.forceScrollBottom) || isMessagesNearBottom(thread);
  const savedScrollTop = thread.scrollTop;
  thread.innerHTML = messages
    .map((m) => {
      const mine = Boolean(me?.id && m.senderId === me.id);
      const senderUser = conv?.members?.find((u) => u.id === m.senderId) || null;
      const sender =
        senderUser?.username || (mine ? (me!.username || '') : '');
      const isBot =
        senderUser?.provider === 'bot' || String(m.senderId || '').startsWith('bot:');
      if (isBot && !m.deleted) {
        return renderBotPostHtml(m, senderUser, sender, conv);
      }
      const showName = conv?.type === 'group' && !mine;
      const reply = m.replyTo
        ? `<button type="button" class="msgr-bubble__reply" data-reply-to="${host!.escapeHtml(m.replyTo.id || '')}">
            <div class="msgr-bubble__reply-name">${host!.escapeHtml(
              conv?.members?.find((u) => u.id === m.replyTo!.senderId)?.username || '',
            )}</div>
            <div class="msgr-bubble__reply-text">${host!.escapeHtml(
              m.replyTo.deleted
                ? host!.t('msgr.messageDeleted')
                : m.replyTo.attachment
                  ? m.replyTo.attachment.name
                  : m.replyTo.body,
            )}</div>
          </button>`
        : '';
      const fileBlock = renderAttachmentBlock(m);
      const invite =
        !m.deleted && m.kind === 'game_invite'
          ? inviteFromMeta(m.meta as Record<string, unknown> | null, {
              id: m.senderId,
              username: sender,
            })
          : null;
      const inviteBlock = invite ? renderInviteCardHtml(invite, m.id) : '';
      const updateBlock =
        !m.deleted && m.kind === 'client_update'
          ? `<button type="button" class="stngs-btn ghost msgr-update-btn" data-msgr-open-updates>${host!.escapeHtml(host!.t('msgr.updateClient'))}</button>`
          : '';
      const textBody =
        m.deleted
          ? `<div class="msgr-bubble__text is-deleted">${host!.escapeHtml(host!.t('msgr.messageDeleted'))}</div>`
          : invite
            ? ''
            : m.body && (!m.attachment || m.body !== m.attachment.name)
              ? `<div class="msgr-bubble__text">${host!.escapeHtml(m.body)}</div>`
              : '';
      const reactions = renderReactionsHtml(m);
      return `
        <div class="msgr-bubble-row ${mine ? 'is-mine' : 'is-theirs'}" data-msg-id="${host!.escapeHtml(m.id)}">
          <div class="msgr-bubble ${m.deleted ? 'is-deleted' : ''}${m.attachment && isMediaAttachment(m.attachment) ? ' has-media' : ''}${invite ? ' has-invite' : ''}">
            ${showName ? `<div class="msgr-bubble__name">${host!.escapeHtml(sender)}</div>` : ''}
            ${reply}
            ${inviteBlock}
            ${updateBlock}
            ${textBody}
            ${fileBlock}
            <div class="msgr-bubble__meta">
              <span>${host!.escapeHtml(formatMsgTime(m.createdAt))}</span>
              ${readReceiptHtml(m, conv)}
            </div>
            ${reactions}
          </div>
        </div>`;
    })
    .join('');
  if (stickBottom) thread.scrollTop = thread.scrollHeight;
  else thread.scrollTop = savedScrollTop;
}

/** Сообщение бота: без пузыря — аватар, имя, бейдж БОТ, Markdown */
function renderBotPostHtml(
  m: MessengerMessage,
  senderUser: MessengerUser | null | undefined,
  senderName: string,
  conv: MessengerConversation | undefined,
): string {
  if (!host) return '';
  if (senderUser) ensureAvatar(senderUser);
  const name = senderName || host.t('msgr.botDefaultName');
  const av = avatarImgHtml(senderUser, 28, name.slice(0, 1));
  const reply = m.replyTo
    ? `<div class="msgr-bot-post__quote">
        <div class="msgr-bot-post__quote-name">${host.escapeHtml(
          conv?.members?.find((u) => u.id === m.replyTo!.senderId)?.username || '',
        )}</div>
        <div class="msgr-bot-post__quote-text">${host.escapeHtml(
          m.replyTo.deleted
            ? host.t('msgr.messageDeleted')
            : m.replyTo.attachment
              ? m.replyTo.attachment.name
              : m.replyTo.body,
        )}</div>
      </div>`
    : '';
  const updateBlock =
    m.kind === 'client_update'
      ? `<button type="button" class="stngs-btn ghost msgr-update-btn" data-msgr-open-updates>${host.escapeHtml(host.t('msgr.updateClient'))}</button>`
      : '';
  const buttons = Array.isArray((m.meta as any)?.buttons) ? ((m.meta as any).buttons as { id?: string; label?: string }[]) : [];
  const keyboardBlock =
    !m.deleted && (m.kind === 'bot_keyboard' || buttons.length)
      ? `<div class="msgr-bot-keyboard">${buttons
          .filter((b) => b && b.id && b.label)
          .map(
            (b) =>
              `<button type="button" class="msgr-bot-keyboard__btn" data-bot-btn="${host!.escapeHtml(String(b.id))}" data-bot-msg="${host!.escapeHtml(m.id)}">${host!.escapeHtml(String(b.label))}</button>`,
          )
          .join('')}</div>`
      : '';
  const bodyRaw = m.body && (!m.attachment || m.body !== m.attachment.name) ? m.body : '';
  const bodyHtml = bodyRaw
    ? host.renderMarkdown
      ? `<div class="msgr-bot-post__md ai-md">${host.renderMarkdown(bodyRaw)}</div>`
      : `<div class="msgr-bot-post__md">${host.escapeHtml(bodyRaw)}</div>`
    : '';
  const fileBlock = renderAttachmentBlock(m);
  const reactions = renderReactionsHtml(m);
  return `
    <div class="msgr-bubble-row is-bot is-theirs" data-msg-id="${host.escapeHtml(m.id)}">
      <article class="msgr-bot-post">
        <header class="msgr-bot-post__head">
          <span class="msgr-avatar msgr-bot-post__avatar">${av}</span>
          <span class="msgr-bot-post__name">${host.escapeHtml(name)}</span>
          <span class="msgr-badge msgr-badge--bot">${host.escapeHtml(host.t('msgr.botBadge'))}</span>
        </header>
        <div class="msgr-bot-post__content">
          ${reply}
          ${bodyHtml}
          ${fileBlock}
          ${updateBlock}
          ${keyboardBlock}
          <div class="msgr-bot-post__meta">
            <span>${host.escapeHtml(formatMsgTime(m.createdAt))}</span>
          </div>
          ${reactions}
        </div>
      </article>
    </div>`;
}

function renderPendingFiles(): void {
  const chips = $('msgr-attach-chips');
  if (!chips || !host) return;
  if (!pendingFiles.length) {
    chips.hidden = true;
    chips.innerHTML = '';
    return;
  }
  chips.hidden = false;
  chips.innerHTML = `<div class="ai-attach-badges">${pendingFiles
    .map((f, i) => {
      const media = isMediaAttachment(f);
      const thumb =
        media && isImageAttachment(f)
          ? `<span class="ai-attach-thumb" style="background-image:url('data:${host!.escapeHtml(f.mime)};base64,${f.dataBase64}')"></span>`
          : media && isVideoAttachment(f)
            ? `<span class="ai-attach-menu__ico ai-attach-badge--media" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" stroke-width="2"/><path d="M10 9l6 3-6 3V9z" fill="currentColor"/></svg></span>`
            : '';
      return `<button type="button" class="ai-attach-badge ${media ? 'ai-attach-badge--media' : 'ai-attach-badge--file'}" data-pending-idx="${i}">
          ${thumb}
          <span class="ai-attach-badge__text">
            <span class="ai-attach-badge__label">${host!.escapeHtml(f.name)}</span>
            <span class="ai-attach-badge__kind">${host!.escapeHtml(formatFileSize(f.size))}</span>
          </span>
          <span class="ai-attach-badge__x" aria-hidden="true">×</span>
        </button>`;
    })
    .join('')}</div>`;
}

function setAttachMenuOpen(open: boolean): void {
  const menu = $('msgr-attach-menu');
  const btn = $('msgr-attach');
  if (!menu || !btn) return;
  menu.classList.toggle('hidden', !open);
  menu.classList.toggle('is-open', open);
  menu.setAttribute('aria-hidden', open ? 'false' : 'true');
  btn.classList.toggle('is-open', open);
}

async function pickMessengerFiles(opts?: { media?: boolean }): Promise<void> {
  if (!host?.api.messengerPickFiles || !host.api.messengerReadFile) {
    toast(host?.t('msgr.attachUnavailable') || 'Attach unavailable');
    return;
  }
  const paths = await host.api.messengerPickFiles(opts?.media ? { media: true } : undefined);
  if (!paths?.length) return;
  for (const p of paths) {
    if (pendingFiles.length >= 5) break;
    const read = await host.api.messengerReadFile(p);
    if (!read?.ok || !read.dataBase64 || !read.name) {
      toast(host.t('msgr.attachFailed', { msg: read?.error || 'error' }));
      continue;
    }
    if (opts?.media && !isMediaAttachment({ mime: read.mime, name: read.name })) {
      toast(host.t('msgr.attachFailed', { msg: 'media' }));
      continue;
    }
    pendingFiles.push({
      name: read.name,
      mime: read.mime || 'application/octet-stream',
      size: read.size || 0,
      dataBase64: read.dataBase64,
    });
  }
  renderPendingFiles();
  setAttachMenuOpen(false);
}

async function handleFileAction(messageId: string, act: string): Promise<void> {
  if (!host) return;
  const msg = messages.find((m) => m.id === messageId);
  if (!msg?.attachment) return;
  if (act === 'open') {
    const local = getLocalFilePath(messageId);
    if (!local || !host.api.messengerOpenLocalFile) return;
    const res = await host.api.messengerOpenLocalFile(local);
    if (!res?.ok) toast(host.t('msgr.fileOpenFailed', { msg: res?.error || '' }));
    return;
  }
  if (act === 'download') {
    if (!host.api.messengerDownloadAttachment) {
      toast(host.t('msgr.attachUnavailable'));
      return;
    }
    const res = await host.api.messengerDownloadAttachment({
      messageId,
      fileName: msg.attachment.name,
    });
    if (!res?.ok || !res.path) {
      if (res?.error !== 'canceled') {
        toast(host.t('msgr.fileDownloadFailed', { msg: res?.error || '' }));
      }
      return;
    }
    setLocalFilePath(messageId, res.path);
    toast(host.t('msgr.fileSaved'));
    renderMessages();
  }
}

function upsertIncomingMessage(message: MessengerMessage): void {
  if (!message?.id) return;
  const idx = messages.findIndex((m) => m.id === message.id);
  const isNew = idx < 0;
  if (idx >= 0) {
    messages[idx] = message;
  } else {
    messages = [...messages, message];
  }
  // Свои новые сообщения — к низу; чужие/правки — только если уже у низа
  const forceBottom = isNew && Boolean(me?.id && message.senderId === me.id);
  renderMessages({ forceScrollBottom: forceBottom });
}

function applyActivityToUsers(userId: string, data: any): void {
  const patch = (u?: MessengerUser | null) => {
    if (!u || u.id !== userId) return u;
    return {
      ...u,
      lastSeenAt: data.lastSeenAt ?? u.lastSeenAt,
      presenceStatus: data.presenceStatus ?? u.presenceStatus,
      activity: data.activity ?? u.activity,
      favoriteBuild: data.favoriteBuild ?? u.favoriteBuild,
    };
  };
  conversations = conversations.map((c) => ({
    ...c,
    peer: patch(c.peer) || c.peer,
    members: c.members?.map((m) => patch(m) || m),
  }));
  if (me?.id === userId) me = patch(me) || me;
  friendsBundle = {
    friends: friendsBundle.friends.map((u) => patch(u) || u!),
    incoming: friendsBundle.incoming.map((u) => patch(u) || u!),
    outgoing: friendsBundle.outgoing.map((u) => patch(u) || u!),
  };
  blockedUsers = blockedUsers.map((u) => patch(u) || u!);
  if (openProfileUser?.id === userId) {
    openProfileUser = patch(openProfileUser) || openProfileUser;
  }
  renderConversationList();
  renderPeerHeader();
  if (railTab === 'friends' || railTab === 'blocked') renderFriendsList();
  if (railTab === 'worlds') renderWorldsList();
  syncOpenProfilePresence();
}

/** Обновить статус/свет/карточки в уже открытой карточке профиля */
function syncOpenProfilePresence(): void {
  if (!host || !openProfileUser) return;
  const overlay = $('modal-msgr-profile');
  if (!overlay || overlay.classList.contains('hidden') || overlay.getAttribute('aria-hidden') === 'true') {
    return;
  }
  const profile = openProfileUser;
  const online = isOnline(profile);
  const statusEl = $('msgr-profile-status');
  if (statusEl) {
    const p = resolvePresence(profile);
    statusEl.className = `msgr-profile__status ${online ? 'is-online' : ''}`;
    if (!online) {
      statusEl.textContent = formatLastSeen(profile.lastSeenAt);
    } else if (p === 'busy') {
      statusEl.innerHTML = `<span class="msgr-profile__status-dot"></span>${host.escapeHtml(host.t('msgr.statusBusy'))}`;
    } else if (p === 'dnd') {
      statusEl.innerHTML = `<span class="msgr-profile__status-dot"></span>${host.escapeHtml(host.t('msgr.statusDnd'))}`;
    } else {
      statusEl.innerHTML = `<span class="msgr-profile__status-dot"></span>${host.escapeHtml(host.t('msgr.online'))}`;
    }
  }

  const lastSeenCard = document.querySelector(
    '#msgr-profile-rows [data-profile-card="lastSeen"]',
  ) as HTMLElement | null;
  if (lastSeenCard) {
    const title = lastSeenCard.querySelector('.msgr-profile-card__title');
    const icon = lastSeenCard.querySelector('.msgr-profile-card__icon');
    if (title) title.textContent = formatLastSeen(profile.lastSeenAt);
    if (icon && !icon.querySelector('img')) icon.textContent = online ? 'ON' : 'OFF';
  }

  const a = profile.activity;
  const playingCard = document.querySelector(
    '#msgr-profile-rows [data-profile-card="playing"]',
  ) as HTMLElement | null;
  if (playingCard) {
    const playingTitle = a?.playing && a.build ? a.build : host.t('msgr.profileIdle');
    const playingSub =
      a?.playing && a.build ? [a.version, a.loader, a.server].filter(Boolean).join(' · ') : '';
    const title = playingCard.querySelector('.msgr-profile-card__title');
    const sub = playingCard.querySelector('.msgr-profile-card__sub') as HTMLElement | null;
    if (title) title.textContent = playingTitle;
    if (sub) {
      if (playingSub) {
        sub.textContent = playingSub;
        sub.hidden = false;
      } else {
        sub.textContent = '';
        sub.hidden = true;
      }
    } else if (playingSub) {
      const meta = playingCard.querySelector('.msgr-profile-card__meta');
      if (meta) {
        const el = document.createElement('div');
        el.className = 'msgr-profile-card__sub';
        el.textContent = playingSub;
        meta.appendChild(el);
      }
    }
  }

  applyProfilePresenceMood(online);
}

async function loadConversations(): Promise<void> {
  const res = await req('/conversations');
  if (!res?.ok) return;
  conversations = Array.isArray(res.data?.conversations) ? res.data.conversations : [];
  renderConversationList();
  renderPeerHeader();
  applyComposerMuteState();
  renderPinBar();
  persistAccountCache();
}

async function loadMessages(conversationId: string, opts?: { forceScrollBottom?: boolean }): Promise<void> {
  const res = await req(`/conversations/${encodeURIComponent(conversationId)}/messages`, {
    query: { limit: 80 },
  });
  if (!res?.ok) return;
  const next: MessengerMessage[] = Array.isArray(res.data?.messages) ? res.data.messages : [];
  // Поллинг не должен перерисовывать идентичную ленту (иначе сбивает просмотр истории).
  // Но если DOM пуст (ранний render без me / гейт loading) — обязательно нарисовать.
  const painted = isMessagesThreadPainted();
  const unchanged =
    painted &&
    !opts?.forceScrollBottom &&
    next.length === messages.length &&
    next.every((m, i) => {
      const cur = messages[i];
      if (!cur || cur.id !== m.id) return false;
      if (Boolean(cur.deleted) !== Boolean(m.deleted)) return false;
      if (cur.body !== m.body) return false;
      if ((cur.attachment?.id || '') !== (m.attachment?.id || '')) return false;
      return JSON.stringify(cur.reactions || null) === JSON.stringify(m.reactions || null);
    });
  messages = next;
  messagesHasMore = next.length >= 80;
  if (!unchanged) {
    renderMessages({
      forceScrollBottom: opts?.forceScrollBottom || !painted,
    });
  }
  persistAccountCache();
  await req(`/conversations/${encodeURIComponent(conversationId)}/read`, { method: 'POST', body: {} });
}

async function openConversation(id: string): Promise<void> {
  activeId = id;
  setReplyTo(null);
  clearTypingState();
  messagesHasMore = true;
  pendingFiles = [];
  renderPendingFiles();
  setAttachMenuOpen(false);
  renderConversationList();
  renderPeerHeader();
  applyComposerMuteState();
  renderPinBar();
  messages = [];
  renderMessages({ forceScrollBottom: true });
  await loadMessages(id, { forceScrollBottom: true });
  const res = await req('/conversations');
  if (res?.ok) {
    conversations = Array.isArray(res.data?.conversations) ? res.data.conversations : [];
    renderConversationList();
    renderPeerHeader();
    applyComposerMuteState();
    renderPinBar();
  }
}

async function sendMessage(text: string): Promise<void> {
  if (!activeId || busy) return;
  const conv = conversations.find((c) => c.id === activeId);
  if (conv?.myMute) return;
  const body = text.trim();
  const files = [...pendingFiles];
  if (!body && !files.length) return;
  busy = true;
  let sentOk = false;
  try {
    if (files.length) {
      for (const file of files) {
        const payload: Record<string, unknown> = {
          body: body && files.indexOf(file) === 0 ? body : '',
          attachment: {
            name: file.name,
            mime: file.mime,
            dataBase64: file.dataBase64,
          },
        };
        if (replyTo?.id && files.indexOf(file) === 0) payload.replyToId = replyTo.id;
        const res = await req(`/conversations/${encodeURIComponent(activeId)}/messages`, {
          method: 'POST',
          body: payload,
        });
        if (!res?.ok) {
          toast(host?.t('msgr.sendFailed', { msg: res?.error || res?.code || '' }) || 'Send failed');
          break;
        }
        sentOk = true;
        if (res.data?.message) upsertIncomingMessage(res.data.message);
      }
      pendingFiles = [];
      renderPendingFiles();
      setReplyTo(null);
      await loadConversations();
      if (sentOk) playMsgrSound('send');
      return;
    }
    const payload: Record<string, unknown> = { body };
    if (replyTo?.id) payload.replyToId = replyTo.id;
    const res = await req(`/conversations/${encodeURIComponent(activeId)}/messages`, {
      method: 'POST',
      body: payload,
    });
    if (res?.ok && res.data?.message) {
      setReplyTo(null);
      upsertIncomingMessage(res.data.message);
      await loadConversations();
      playMsgrSound('send');
    } else if (!res?.ok) {
      toast(host?.t('msgr.sendFailed', { msg: res?.error || res?.code || '' }) || 'Send failed');
    }
  } finally {
    busy = false;
  }
}

async function deleteMessage(msgId: string): Promise<void> {
  if (!activeId) return;
  const res = await req(
    `/conversations/${encodeURIComponent(activeId)}/messages/${encodeURIComponent(msgId)}`,
    { method: 'DELETE' },
  );
  if (res?.ok && res.data?.message) {
    upsertIncomingMessage(res.data.message);
    await loadConversations();
  }
}

function hideCtx(): void {
  const ctx = $('msgr-ctx');
  if (ctx) {
    ctx.classList.add('hidden');
    ctx.innerHTML = '';
  }
}

/** Свернуть открытый чат (пустой stage, чат остаётся в списке) */
function collapseActiveChat(): void {
  if (!activeId) return;
  activeId = null;
  messages = [];
  setReplyTo(null);
  pendingFiles = [];
  renderPendingFiles();
  setAttachMenuOpen(false);
  hideCtx();
  renderMessages();
  renderPeerHeader();
  renderConversationList();
  persistAccountCache();
}

function isMessengerTabActive(): boolean {
  return Boolean($('tab-messenger')?.classList.contains('active'));
}

function isMsgrOverlayVisible(id: string): boolean {
  const el = $(id);
  if (!el || el.classList.contains('hidden')) return false;
  return el.getAttribute('aria-hidden') !== 'true';
}

let lastCtxPos = { x: 40, y: 80 };

function showCtx(x: number, y: number, items: { label: string; action: () => void; danger?: boolean }[]): void {
  const ctx = $('msgr-ctx');
  if (!ctx || !host) return;
  lastCtxPos = { x, y };
  ctx.innerHTML = items
    .map(
      (it, i) =>
        `<button type="button" class="msgr-ctx__item ${it.danger ? 'is-danger' : ''}" data-i="${i}">${host!.escapeHtml(it.label)}</button>`,
    )
    .join('');
  ctx.classList.remove('hidden');
  const rect = ctx.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - rect.width - 8);
  const top = Math.min(y, window.innerHeight - rect.height - 8);
  ctx.style.left = `${Math.max(8, left)}px`;
  ctx.style.top = `${Math.max(8, top)}px`;
  ctx.querySelectorAll('.msgr-ctx__item').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const i = Number((btn as HTMLElement).dataset.i);
      hideCtx();
      items[i]?.action();
    });
  });
}

function renderSearchResults(users: MessengerUser[], opts?: { query?: string; failed?: boolean }): void {
  const box = $('msgr-search-results');
  if (!box || !host) return;
  const query = String(opts?.query || '').trim();
  if (!query) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  box.hidden = false;
  if (opts?.failed) {
    box.innerHTML = `<div class="msgr-search-empty">${host.escapeHtml(host.t('msgr.searchFailed'))}</div>`;
    return;
  }
  if (!users.length) {
    box.innerHTML = `<div class="msgr-search-empty">${host.escapeHtml(host.t('msgr.searchEmpty'))}</div>`;
    return;
  }
  box.innerHTML = users
    .map((u) => {
      ensureAvatar(u);
      return `
        <button type="button" class="msgr-search-hit" data-user-id="${host!.escapeHtml(u.id)}">
          <span class="msgr-avatar">${avatarImgHtml(u, 32, u.username.slice(0, 1))}</span>
          <span class="msgr-search-hit__meta">
            <span class="msgr-search-hit__name">${host!.escapeHtml(u.username)}</span>
            <span class="msgr-badge ${providerClass(u.provider)}">${host!.escapeHtml(providerLabel(u.provider))}</span>
          </span>
        </button>`;
    })
    .join('');
}

async function runSearch(q: string): Promise<void> {
  const query = q.trim();
  if (query.length < 2) {
    renderSearchResults([], { query: '' });
    return;
  }
  const res = await req('/users/search', { query: { q: query, limit: 20 } });
  if (!res?.ok) {
    renderSearchResults([], { query, failed: true });
    return;
  }
  const users = Array.isArray(res.data?.users) ? res.data.users : [];
  renderSearchResults(users, { query });
}

async function startDm(userId: string): Promise<void> {
  const res = await req('/conversations/dm', { method: 'POST', body: { userId } });
  renderSearchResults([], { query: '' });
  const input = $('msgr-search') as HTMLInputElement | null;
  if (input) input.value = '';
  if (res?.ok && res.data?.conversation?.id) {
    setRailTab('chats');
    await loadConversations();
    await openConversation(res.data.conversation.id);
  } else if (!res?.ok) {
    toast(host?.t('msgr.dmFailed', { msg: res?.error || res?.code || '' }) || 'DM failed');
  }
}

async function sendBotCallback(conversationId: string, buttonId: string, messageId: string): Promise<void> {
  const res = await req('/bot/callback', {
    method: 'POST',
    body: { conversationId, buttonId, messageId },
  });
  if (!res?.ok) {
    toast(res?.error || host?.t('msgr.errorHint') || 'Error');
    return;
  }
  if (res.data?.message) {
    await loadMessages(conversationId, { forceScrollBottom: true });
  }
  await loadConversations();
}

/** Открыть DM с ботом (заявка на UAgent и меню) */
export async function openAssistantBotDm(): Promise<boolean> {
  await ensureMessengerTab(true);
  await loadConversations();
  let bot = conversations.find((c) => c.isBotDm);
  if (!bot) {
    // listConversations на сервере создаёт DM — перезагрузка
    await loadConversations();
    bot = conversations.find((c) => c.isBotDm);
  }
  if (!bot && conversations.length) {
    // fallback: peer bot:project
    bot = conversations.find(
      (c) => c.type === 'dm' && (c.peer?.id === 'bot:project' || c.peer?.provider === 'bot'),
    );
  }
  if (!bot) return false;
  setRailTab('chats');
  await openConversation(bot.id);
  return true;
}

async function createGroup(): Promise<void> {
  if (!host) return;
  const result = await askGroupCreate();
  if (!result?.title) return;
  const res = await req('/conversations/group', {
    method: 'POST',
    body: { title: result.title, memberIds: result.memberIds },
  });
  if (res?.ok && res.data?.conversation?.id) {
    await loadConversations();
    await openConversation(res.data.conversation.id);
  } else {
    window.alert(res?.error || host.t('msgr.errorHint'));
  }
}

function askGroupCreate(): Promise<{ title: string; memberIds: string[] } | null> {
  return new Promise((resolve) => {
    const overlay = $('modal-msgr-group');
    const input = $('modal-msgr-group-input') as HTMLInputElement | null;
    const search = $('modal-msgr-group-search') as HTMLInputElement | null;
    const pickedEl = $('modal-msgr-group-picked');
    const resultsEl = $('modal-msgr-group-results');
    const ok = $('modal-msgr-group-ok');
    const cancel = $('modal-msgr-group-cancel');
    const closeBtn = $('modal-msgr-group-close');
    if (!overlay || !input || !ok || !cancel) {
      resolve(null);
      return;
    }
    const picked = new Map<string, MessengerUser>();
    input.value = '';
    if (search) search.value = '';
    if (pickedEl) pickedEl.innerHTML = '';
    if (resultsEl) resultsEl.innerHTML = '';
    openOverlay('modal-msgr-group');
    setTimeout(() => input.focus(), 30);

    const renderPicked = () => {
      if (!pickedEl || !host) return;
      pickedEl.innerHTML = [...picked.values()]
        .map(
          (u) =>
            `<button type="button" class="msgr-chip" data-id="${host!.escapeHtml(u.id)}">${host!.escapeHtml(u.username)} ×</button>`,
        )
        .join('');
    };

    const finish = (value: { title: string; memberIds: string[] } | null) => {
      closeOverlay('modal-msgr-group');
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      closeBtn?.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onBackdrop);
      input.removeEventListener('keydown', onKey);
      search?.removeEventListener('input', onSearch);
      pickedEl?.removeEventListener('click', onPickedClick);
      resultsEl?.removeEventListener('click', onResultClick);
      resolve(value);
    };
    const onOk = () => {
      const v = input.value.trim().slice(0, 64);
      if (!v) return;
      finish({ title: v, memberIds: [...picked.keys()] });
    };
    const onCancel = () => finish(null);
    const onBackdrop = (e: Event) => {
      if (e.target === overlay) onCancel();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onOk();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    const onSearch = () => {
      if (groupSearchTimer) clearTimeout(groupSearchTimer);
      groupSearchTimer = setTimeout(async () => {
        const q = search?.value.trim() || '';
        if (q.length < 2 || !resultsEl || !host) {
          if (resultsEl) resultsEl.innerHTML = '';
          return;
        }
        const res = await req('/users/search', { query: { q, limit: 12 } });
        const users: MessengerUser[] = Array.isArray(res?.data?.users) ? res.data.users : [];
        resultsEl.innerHTML = users
          .filter((u) => !picked.has(u.id))
          .map(
            (u) =>
              `<button type="button" class="msgr-search-hit" data-user-id="${host!.escapeHtml(u.id)}" data-name="${host!.escapeHtml(u.username)}" data-provider="${host!.escapeHtml(u.provider)}">
                <span class="msgr-search-hit__name">${host!.escapeHtml(u.username)}</span>
                <span class="msgr-badge ${providerClass(u.provider)}">${host!.escapeHtml(providerLabel(u.provider))}</span>
              </button>`,
          )
          .join('');
      }, 250);
    };
    const onPickedClick = (e: Event) => {
      const btn = (e.target as HTMLElement).closest('.msgr-chip') as HTMLElement | null;
      const id = btn?.getAttribute('data-id');
      if (id) {
        picked.delete(id);
        renderPicked();
      }
    };
    const onResultClick = (e: Event) => {
      const btn = (e.target as HTMLElement).closest('.msgr-search-hit') as HTMLElement | null;
      const id = btn?.getAttribute('data-user-id');
      const name = btn?.getAttribute('data-name') || '';
      const provider = btn?.getAttribute('data-provider') || 'msa';
      if (!id) return;
      picked.set(id, { id, username: name, provider, uuid: '' });
      renderPicked();
      if (search) search.value = '';
      if (resultsEl) resultsEl.innerHTML = '';
    };

    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    closeBtn?.addEventListener('click', onCancel);
    overlay.addEventListener('click', onBackdrop);
    input.addEventListener('keydown', onKey);
    search?.addEventListener('input', onSearch);
    pickedEl?.addEventListener('click', onPickedClick);
    resultsEl?.addEventListener('click', onResultClick);
  });
}

function readModalBgHex(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--bg-base').trim();
  const m = raw.match(/^#([0-9a-f]{6})$/i);
  if (m) return parseInt(m[1], 16);
  return PROFILE_BG_FALLBACK;
}

function disposeProfileViewer(): void {
  if (profileViewer && !profileViewer.disposed) {
    try {
      profileViewer.dispose();
    } catch {
      /* ignore */
    }
  }
  profileViewer = null;
  profileSkinLoaded = null;
}

function fitProfileViewer(): void {
  if (!profileViewer || profileViewer.disposed) return;
  const canvas = $('msgr-profile-canvas') as HTMLCanvasElement | null;
  if (!canvas) return;
  const w = canvas.clientWidth || 280;
  const h = canvas.clientHeight || 420;
  if (w < 2 || h < 2) return;
  profileViewer.setSize(w, h);
  profileViewer.fitPlayerToFrame(PROFILE_FRAME);
}

function applyProfilePresenceMood(online: boolean): void {
  if (!profileViewer || profileViewer.disposed) return;
  profileViewer.setAnimation(createSkinAnimation(online ? 'idle' : 'sleep'));
  profileViewer.setCursorFollow(online);
  if (!online) profileViewer.setCursorAim(0, 0);
  // Не вызываем resetLighting — студийный key снова сделает блики резкими
  profileViewer.applyLightSettings(online ? PROFILE_LIGHT_ONLINE : PROFILE_LIGHT_OFFLINE);
  // Hemi/rim не в LightSettings — отдельно гасим при оффлайне
  profileViewer.lighting.hemi.intensity = online ? PROFILE_HEMI_ONLINE : PROFILE_HEMI_OFFLINE;
  profileViewer.lighting.rim.intensity = online ? PROFILE_RIM_ONLINE : PROFILE_RIM_OFFLINE;
}

async function ensureProfileViewer(
  skinUrl: string | null,
  online = true,
  locatorUuid?: string | null,
): Promise<void> {
  const canvas = $('msgr-profile-canvas') as HTMLCanvasElement | null;
  const fallback = $('msgr-profile-skin-fallback');
  if (!canvas) return;
  if (!skinUrl) {
    disposeProfileViewer();
    canvas.hidden = true;
    if (fallback) fallback.hidden = false;
    return;
  }
  canvas.hidden = false;
  if (fallback) fallback.hidden = true;
  try {
    if (!profileViewer || profileViewer.disposed) {
      // PostFX нужен против чёрных швов; transparent его отключает —
      // вместо этого плоский UI-фон через setUiFlatBackground.
      profileViewer = new SkinViewEngine(canvas, {
        autoDetectModel: true,
        idleAnimation: true,
        enableControls: true,
        antialias: true,
        transparent: false,
        presentation: 'full',
        enableEffects: true,
        autoResize: false,
      });
      profileViewer.controls.enableZoom = false;
      profileViewer.setUiFlatBackground(readModalBgHex());
      profileSkinLoaded = null;
      if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(() => fitProfileViewer()).observe(
          canvas.parentElement || canvas,
        );
      }
    }
    if (profileSkinLoaded !== skinUrl) {
      await profileViewer.setSkin(skinUrl);
      profileSkinLoaded = skinUrl;
    }
    profileViewer.setLocatorUuid(locatorUuid ?? null);
    applyProfilePresenceMood(online);
    requestAnimationFrame(() => {
      profileViewer?.setUiFlatBackground(readModalBgHex());
      // После UI-flat — снова mood, чтобы оффлайн-dim не перетёрся
      applyProfilePresenceMood(online);
      fitProfileViewer();
      profileViewer?.start();
    });
  } catch (e) {
    console.warn('[msgr] profile skin failed', e);
    disposeProfileViewer();
    canvas.hidden = true;
    if (fallback) {
      fallback.hidden = false;
      fallback.innerHTML = '';
    }
  }
}

function formatJoined(ts?: number | null): string {
  if (!ts) return host?.t('msgr.profileNoData') || '—';
  const d = new Date(Number(ts));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

function shortUuid(uuid?: string): string {
  const hex = String(uuid || '').replace(/-/g, '');
  if (hex.length < 8) return uuid || '—';
  return `${hex.slice(0, 8)}…`;
}

function profileCardIconHtml(opts?: {
  iconUrl?: string | null;
  iconText?: string;
  title?: string;
  /** Размер иконки в px (для img) */
  iconSize?: number;
  /** Сплошной цвет (Locator Bar swatch) */
  iconColor?: string | null;
}): string {
  const color = opts?.iconColor?.trim();
  if (color) {
    return `<div class="msgr-profile-card__icon msgr-profile-card__icon--locator" style="--locator-color:${host!.escapeHtml(color)}"></div>`;
  }
  const url = opts?.iconUrl?.trim();
  const size = opts?.iconSize && opts.iconSize > 0 ? opts.iconSize : null;
  if (url) {
    const sizeAttr = size ? ` width="${size}" height="${size}"` : '';
    const sizeClass = size ? ` msgr-profile-card__icon--${size}` : '';
    return `<div class="msgr-profile-card__icon${sizeClass}"><img src="${host!.escapeHtml(url)}" alt=""${sizeAttr}></div>`;
  }
  const initials = (opts?.iconText || opts?.title || '?').slice(0, 2).toUpperCase();
  return `<div class="msgr-profile-card__icon">${host!.escapeHtml(initials)}</div>`;
}

function profileCardHtml(
  label: string,
  title: string,
  sub?: string,
  opts?: {
    iconUrl?: string | null;
    iconText?: string;
    iconSize?: number;
    iconColor?: string | null;
    clickAct?: string;
    cardKey?: string;
  },
): string {
  const click = opts?.clickAct
    ? ` data-card-act="${host!.escapeHtml(opts.clickAct)}" role="button" tabindex="0"`
    : '';
  const clickClass = opts?.clickAct ? ' is-clickable' : '';
  const key = opts?.cardKey ? ` data-profile-card="${host!.escapeHtml(opts.cardKey)}"` : '';
  return `<div class="msgr-profile-card${clickClass}"${click}${key}>
    ${profileCardIconHtml({
      iconUrl: opts?.iconUrl,
      iconText: opts?.iconText,
      title,
      iconSize: opts?.iconSize,
      iconColor: opts?.iconColor,
    })}
    <div class="msgr-profile-card__meta">
      <div class="msgr-profile-card__label">${host!.escapeHtml(label)}</div>
      <div class="msgr-profile-card__title">${host!.escapeHtml(title)}</div>
      ${sub ? `<div class="msgr-profile-card__sub">${host!.escapeHtml(sub)}</div>` : ''}
    </div>
  </div>`;
}

type ProfileMenuItem = { act: string; label: string; danger?: boolean };

function setProfileMoreMenuOpen(open: boolean): void {
  const menu = $('msgr-profile-more-menu');
  const btn = $('msgr-profile-more');
  if (!menu || !btn) return;
  if (open) {
    menu.classList.remove('hidden');
    requestAnimationFrame(() => menu.classList.add('is-open'));
    btn.setAttribute('aria-expanded', 'true');
  } else if (menu.classList.contains('is-open') || !menu.classList.contains('hidden')) {
    menu.classList.remove('is-open');
    btn.setAttribute('aria-expanded', 'false');
    window.setTimeout(() => {
      if (!menu.classList.contains('is-open')) menu.classList.add('hidden');
    }, 160);
  }
}

function renderProfileActionsBar(primaryHtml: string, menuItems: ProfileMenuItem[]): string {
  const items = menuItems
    .map(
      (it) =>
        `<button type="button" class="msgr-profile__more-item${it.danger ? ' is-danger' : ''}" role="menuitem" data-act="${host!.escapeHtml(it.act)}">${host!.escapeHtml(it.label)}</button>`,
    )
    .join('');
  return `
    ${primaryHtml}
    <div class="msgr-profile__more-wrap">
      <button type="button" class="msgr-profile__more-btn" id="msgr-profile-more" aria-haspopup="menu" aria-expanded="false" title="${host!.escapeHtml(host!.t('msgr.moreActions'))}">
        <span aria-hidden="true">···</span>
      </button>
      <div class="msgr-profile__more-menu hidden" id="msgr-profile-more-menu" role="menu" aria-hidden="true">${items}</div>
    </div>`;
}

function bindProfileActionsBar(
  actionsEl: HTMLElement,
  onAct: (act: string) => void | Promise<void>,
): void {
  actionsEl.onclick = (e) => {
    const moreBtn = (e.target as HTMLElement).closest('#msgr-profile-more') as HTMLElement | null;
    if (moreBtn) {
      e.preventDefault();
      e.stopPropagation();
      const menu = $('msgr-profile-more-menu');
      const open = menu?.classList.contains('is-open');
      setProfileMoreMenuOpen(!open);
      return;
    }
    const btn = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    const act = btn?.getAttribute('data-act');
    if (!act) return;
    setProfileMoreMenuOpen(false);
    void onAct(act);
  };
}

function resolveBuildCardIcon(name: string | null | undefined, hasRealName: boolean): string | null {
  if (!hasRealName || !name) return null;
  return host?.resolveBuildIcon?.(name) || DEFAULT_BUILD_ICON;
}

function resolveServerCardIcon(name: string | null | undefined, hasRealName: boolean): string | null {
  if (!hasRealName || !name) return null;
  return host?.resolveServerIcon?.(name) || DEFAULT_SERVER_ICON;
}

function askPromptText(opts: {
  title: string;
  sub?: string;
  value?: string;
  okLabel?: string;
  placeholder?: string;
  searchUsers?: boolean;
  pickBuild?: boolean;
  maxLength?: number;
  /** Многострочный Markdown / длинный текст */
  multiline?: boolean;
  /** Выделить текст в поле (для копирования ссылки) */
  selectAll?: boolean;
}): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = $('modal-msgr-prompt');
    const titleEl = $('modal-msgr-prompt-title');
    const subEl = $('modal-msgr-prompt-sub');
    const input = $('modal-msgr-prompt-input') as HTMLInputElement | null;
    const textarea = $('modal-msgr-prompt-textarea') as HTMLTextAreaElement | null;
    const resultsEl = $('modal-msgr-prompt-results');
    const ok = $('modal-msgr-prompt-ok');
    const cancel = $('modal-msgr-prompt-cancel');
    const closeBtn = $('modal-msgr-prompt-close');
    const win = overlay?.querySelector('.modal-msgr-prompt') as HTMLElement | null;
    const field = opts.multiline ? textarea : input;
    if (!overlay || !field || !ok || !cancel || !input) {
      resolve(null);
      return;
    }
    if (titleEl) titleEl.textContent = opts.title;
    if (subEl) subEl.textContent = opts.sub || '';
    if (ok) ok.textContent = opts.okLabel || host?.t('btn.save') || 'OK';
    const maxLen =
      opts.maxLength ||
      (opts.multiline ? 12000 : opts.searchUsers ? 32 : opts.pickBuild ? 200 : 64);
    input.hidden = Boolean(opts.multiline);
    if (textarea) {
      textarea.hidden = !opts.multiline;
      textarea.maxLength = maxLen;
      textarea.value = opts.multiline ? opts.value || '' : '';
      textarea.placeholder = opts.multiline ? opts.placeholder || '' : '';
    }
    input.value = opts.multiline ? '' : opts.value || '';
    input.placeholder = opts.multiline ? '' : opts.placeholder || '';
    input.readOnly = Boolean(opts.selectAll) && !opts.multiline;
    input.maxLength = maxLen;
    win?.classList.toggle('is-multiline', Boolean(opts.multiline));
    if (resultsEl) {
      resultsEl.hidden = !(opts.searchUsers || opts.pickBuild);
      resultsEl.innerHTML = '';
    }
    openOverlay('modal-msgr-prompt');
    setTimeout(() => {
      field.focus();
      if (opts.selectAll && !opts.multiline && 'select' in field) {
        (field as HTMLInputElement).select();
      }
    }, 40);

    let pickedUserId: string | null = null;
    let pickedBuildId: string | null = null;
    let searchTimerLocal: ReturnType<typeof setTimeout> | null = null;

    const renderBuildHits = (q: string) => {
      if (!resultsEl || !host) return;
      const builds = host.listLocalBuilds?.() || [];
      const qq = q.trim().toLowerCase();
      const hits = builds
        .filter((b) => !qq || b.name.toLowerCase().includes(qq) || b.meta.toLowerCase().includes(qq))
        .slice(0, 12);
      resultsEl.hidden = false;
      resultsEl.innerHTML = hits.length
        ? hits
            .map(
              (b) =>
                `<button type="button" class="msgr-search-hit" data-build-id="${host!.escapeHtml(b.id)}">
                  <span class="msgr-search-hit__name">${host!.escapeHtml(b.name)}</span>
                  <span class="msgr-search-hit__sub">${host!.escapeHtml(b.meta)}</span>
                </button>`,
            )
            .join('')
        : `<div class="msgr-empty-list">${host.escapeHtml(host.t('msgr.noLocalBuilds'))}</div>`;
    };

    const finish = (value: string | null) => {
      closeOverlay('modal-msgr-prompt');
      input.readOnly = false;
      input.hidden = false;
      if (textarea) textarea.hidden = true;
      win?.classList.remove('is-multiline');
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      closeBtn?.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onBackdrop);
      field.removeEventListener('keydown', onKey);
      field.removeEventListener('input', onInput);
      resultsEl?.removeEventListener('click', onResultClick);
      if (searchTimerLocal) clearTimeout(searchTimerLocal);
      resolve(value);
    };
    const onOk = () => {
      if (opts.searchUsers) {
        finish(pickedUserId);
        return;
      }
      if (opts.pickBuild) {
        finish(pickedBuildId || input.value.trim() || null);
        return;
      }
      const v = field.value.trim().slice(0, maxLen);
      // Пустые правила разрешены (очистка)
      if (opts.multiline) {
        finish(v);
        return;
      }
      finish(v || null);
    };
    const onCancel = () => finish(null);
    const onBackdrop = (e: Event) => {
      if (e.target === overlay) onCancel();
    };
    const onKey = (e: Event) => {
      const ke = e as KeyboardEvent;
      if (ke.key === 'Escape') {
        e.preventDefault();
        onCancel();
        return;
      }
      if (ke.key === 'Enter') {
        if (opts.multiline) {
          // Enter — новая строка; Ctrl/Cmd+Enter — сохранить
          if (ke.ctrlKey || ke.metaKey) {
            e.preventDefault();
            onOk();
          }
          return;
        }
        e.preventDefault();
        onOk();
      }
    };
    const onInput = () => {
      pickedUserId = null;
      pickedBuildId = null;
      if (opts.pickBuild) {
        renderBuildHits(input.value);
        return;
      }
      if (!opts.searchUsers || !resultsEl || !host) return;
      if (searchTimerLocal) clearTimeout(searchTimerLocal);
      searchTimerLocal = setTimeout(async () => {
        const q = input.value.trim();
        if (q.length < 2) {
          resultsEl.innerHTML = '';
          return;
        }
        const res = await req('/users/search', { query: { q, limit: 8 } });
        const users: MessengerUser[] = Array.isArray(res?.data?.users) ? res.data.users : [];
        resultsEl.hidden = false;
        resultsEl.innerHTML = users
          .map(
            (u) =>
              `<button type="button" class="msgr-search-hit" data-user-id="${host!.escapeHtml(u.id)}">
                <span class="msgr-search-hit__name">${host!.escapeHtml(u.username)}</span>
                <span class="msgr-badge ${providerClass(u.provider)}">${host!.escapeHtml(providerLabel(u.provider))}</span>
              </button>`,
          )
          .join('');
      }, 250);
    };
    const onResultClick = (e: Event) => {
      const btn = (e.target as HTMLElement).closest('.msgr-search-hit') as HTMLElement | null;
      if (!btn) return;
      const buildId = btn.getAttribute('data-build-id');
      if (buildId) {
        pickedBuildId = buildId;
        const name = btn.querySelector('.msgr-search-hit__name')?.textContent || '';
        input.value = name;
        finish(buildId);
        return;
      }
      const id = btn.getAttribute('data-user-id');
      if (!id) return;
      pickedUserId = id;
      const name = btn.querySelector('.msgr-search-hit__name')?.textContent || '';
      input.value = name;
      finish(id);
    };

    if (opts.pickBuild) renderBuildHits('');

    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    closeBtn?.addEventListener('click', onCancel);
    overlay.addEventListener('click', onBackdrop);
    field.addEventListener('keydown', onKey);
    field.addEventListener('input', onInput);
    resultsEl?.addEventListener('click', onResultClick);
  });
}

function closeProfileModal(): void {
  setProfileMoreMenuOpen(false);
  openProfileUser = null;
  disposeProfileViewer();
  closeOverlay('modal-msgr-profile');
  const overlay = $('modal-msgr-profile');
  overlay?.setAttribute('aria-hidden', 'true');
}

async function fillDmProfile(
  profile: MessengerUser,
  conv: MessengerConversation | null,
  els: {
    titleEl: HTMLElement;
    badgesEl: HTMLElement;
    statusEl: HTMLElement;
    avatarEl: HTMLElement;
    rowsEl: HTMLElement;
    membersEl: HTMLElement;
    actionsEl: HTMLElement;
    fallback: HTMLElement | null;
  },
): Promise<void> {
  if (!host) return;
  openProfileUser = profile;
  const { titleEl, badgesEl, statusEl, avatarEl, rowsEl, membersEl, actionsEl, fallback } = els;
  const isBot = isProjectBotUser(profile);
  const badgeProvider = isBot ? 'bot' : profile.provider;
  titleEl.textContent = profile.username;
  badgesEl.innerHTML = `<span class="msgr-badge ${providerClass(badgeProvider)}">${host.escapeHtml(providerLabel(badgeProvider))}</span>`;
  avatarEl.innerHTML = avatarImgHtml(profile, 44, profile.username.slice(0, 1));
  const online = isBot ? true : isOnline(profile);
  const p = isBot ? 'online' : resolvePresence(profile);
  statusEl.className = `msgr-profile__status ${online ? 'is-online' : ''}`;
  if (!online) {
    statusEl.textContent = formatLastSeen(profile.lastSeenAt);
  } else if (p === 'busy') {
    statusEl.innerHTML = `<span class="msgr-profile__status-dot"></span>${host.escapeHtml(host.t('msgr.statusBusy'))}`;
  } else if (p === 'dnd') {
    statusEl.innerHTML = `<span class="msgr-profile__status-dot"></span>${host.escapeHtml(host.t('msgr.statusDnd'))}`;
  } else {
    statusEl.innerHTML = `<span class="msgr-profile__status-dot"></span>${host.escapeHtml(host.t('msgr.online'))}`;
  }

  if (isBot) {
    const locator = locatorColorFromUuid(profile.uuid);
    const locatorHex = locator ? `#${locator.renderedHex.toUpperCase()}` : '';
    const locatorCard = locator
      ? profileCardHtml(host.t('msgr.profileLocatorBar'), locatorHex, host.t('msgr.profileLocatorBarSub'), {
          iconColor: locatorHex,
          clickAct: 'copy-locator-color',
          cardKey: 'locator',
        })
      : '';
    rowsEl.innerHTML =
      `<div class="msgr-profile-bot-banner">
        <div class="msgr-profile-bot-banner__title">${host.escapeHtml(host.t('msgr.botProfileTitle'))}</div>
        <div class="msgr-profile-bot-banner__text">${host.escapeHtml(host.t('msgr.botProfileDesc'))}</div>
      </div>` +
      profileCardHtml(host.t('msgr.profileLastSeen'), host.t('msgr.online'), host.t('msgr.botAlwaysOnline'), {
        iconText: 'ON',
        cardKey: 'lastSeen',
      }) +
      locatorCard +
      `<div class="msgr-profile__cards-row">` +
      profileCardHtml(host.t('msgr.profileAccountType'), host.t('msgr.botAccountType'), PROJECT_BOT_UACC_ID, {
        iconUrl: ICON_UACC,
        iconSize: 24,
      }) +
      profileCardHtml(
        host.t('msgr.profileJoined'),
        formatJoined(profile.createdAt),
        profile.sharedChats != null
          ? host.t('msgr.profileShared', { n: String(profile.sharedChats) })
          : undefined,
        { iconUrl: ICON_JOINED, iconSize: 30 },
      ) +
      `</div>`;

    rowsEl.onclick = async (e) => {
      const card = (e.target as HTMLElement).closest('[data-card-act]') as HTMLElement | null;
      const act = card?.getAttribute('data-card-act');
      if (act === 'copy-locator-color' && locatorHex) {
        try {
          await navigator.clipboard.writeText(locatorHex);
          toast(host!.t('msgr.profileLocatorCopied', { color: locatorHex }));
        } catch {
          /* ignore */
        }
      }
    };

    membersEl.hidden = false;
    membersEl.innerHTML = '';
    setProfileTabsVisible(false);
    setProfileSkinPanel('dm');
    if (fallback) fallback.textContent = profile.username.slice(0, 1).toUpperCase();
    await ensureProfileViewer(fullSkinTextureUrl(profile), true, profile.uuid);

    actionsEl.innerHTML = '';
    actionsEl.hidden = true;
    return;
  }

  const a = profile.activity;
  const playingTitle = a?.playing && a.build ? a.build : host.t('msgr.profileIdle');
  const playingSub =
    a?.playing && a.build ? [a.version, a.loader, a.server].filter(Boolean).join(' · ') : '';
  const favRaw = profile.favoriteBuild || null;
  const fav = favRaw || host.t('msgr.profileNoFavorite');
  const favSub =
    favRaw && profile.favoriteBuildCount
      ? host.t('msgr.profileFavoriteCount', { n: String(profile.favoriteBuildCount) })
      : undefined;
  const lastBuildRaw = profile.lastBuild || (!a?.playing && a?.build) || null;
  const lastBuild = lastBuildRaw || host.t('msgr.profileNoData');
  const lastBuildSub = profile.lastBuildMeta || undefined;
  const lastServerRaw = profile.lastServer || (!a?.playing && a?.server) || null;
  const lastServer = lastServerRaw || host.t('msgr.profileNoServer');
  const lastServerSub = profile.lastServerMeta || undefined;
  const accountTitle = providerLabelFull(profile.provider);
  const accountSub = shortUuid(profile.uuid);
  const playingIcon = a?.playing && a.build ? resolveBuildCardIcon(a.build, true) : null;
  const locator = locatorColorFromUuid(profile.uuid);
  const locatorHex = locator ? `#${locator.renderedHex.toUpperCase()}` : '';
  const locatorCard = locator
    ? profileCardHtml(host.t('msgr.profileLocatorBar'), locatorHex, host.t('msgr.profileLocatorBarSub'), {
        iconColor: locatorHex,
        clickAct: 'copy-locator-color',
        cardKey: 'locator',
      })
    : '';
  rowsEl.innerHTML =
    profileCardHtml(host.t('msgr.profileLastSeen'), formatLastSeen(profile.lastSeenAt), undefined, {
      iconText: online ? 'ON' : 'OFF',
      cardKey: 'lastSeen',
    }) +
    profileCardHtml(host.t('msgr.profilePlayingNow'), playingTitle, playingSub || undefined, {
      iconUrl: playingIcon,
      iconText: playingTitle,
      cardKey: 'playing',
    }) +
    profileCardHtml(host.t('msgr.profileLastBuild'), String(lastBuild), lastBuildSub, {
      iconUrl: resolveBuildCardIcon(String(lastBuildRaw || ''), Boolean(lastBuildRaw)),
      iconText: String(lastBuild),
    }) +
    profileCardHtml(host.t('msgr.profileLastServer'), String(lastServer), lastServerSub, {
      iconUrl: resolveServerCardIcon(String(lastServerRaw || ''), Boolean(lastServerRaw)),
      iconText: String(lastServer),
    }) +
    profileCardHtml(host.t('msgr.profileFavorite'), fav, favSub, {
      iconUrl: resolveBuildCardIcon(favRaw, Boolean(favRaw)),
      iconText: fav,
    }) +
    locatorCard +
    `<div class="msgr-profile__cards-row">` +
    profileCardHtml(host.t('msgr.profileAccountType'), accountTitle, accountSub, {
      iconUrl: providerIconUrl(profile.provider),
      iconSize: 24,
    }) +
    profileCardHtml(
      host.t('msgr.profileJoined'),
      formatJoined(profile.createdAt),
      profile.sharedChats != null
        ? host.t('msgr.profileShared', { n: String(profile.sharedChats) })
        : undefined,
      { iconUrl: ICON_JOINED, iconSize: 30 },
    ) +
    `</div>`;

  rowsEl.onclick = async (e) => {
    const card = (e.target as HTMLElement).closest('[data-card-act]') as HTMLElement | null;
    const act = card?.getAttribute('data-card-act');
    if (act === 'copy-locator-color' && locatorHex) {
      try {
        await navigator.clipboard.writeText(locatorHex);
        toast(host!.t('msgr.profileLocatorCopied', { color: locatorHex }));
      } catch {
        /* ignore */
      }
    }
  };

  membersEl.hidden = false;
  membersEl.innerHTML = '';
  setProfileTabsVisible(false);
  setProfileSkinPanel('dm');
  if (fallback) fallback.textContent = profile.username.slice(0, 1).toUpperCase();
  await ensureProfileViewer(fullSkinTextureUrl(profile), online, profile.uuid);

  const blocked = Boolean(profile.blockedByMe);
  const fs = String(profile.friendship || 'none');
  const canJoin =
    fs === 'friends' &&
    Boolean(
      (profile.activity?.playing && profile.activity?.hosting && profile.activity?.serverHost) ||
        (lastGameInvite && lastGameInvite.from.id === profile.id),
    );
  const menuItems: ProfileMenuItem[] = [];
  if (!blocked) {
    if (fs === 'friends') menuItems.push({ act: 'unfriend', label: host.t('msgr.friendRemove') });
    else if (fs === 'outgoing') menuItems.push({ act: 'cancel-friend', label: host.t('msgr.friendCancel') });
    else if (fs === 'incoming') {
      menuItems.push({ act: 'accept-friend', label: host.t('msgr.friendAccept') });
      menuItems.push({ act: 'decline-friend', label: host.t('msgr.friendDecline') });
    } else menuItems.push({ act: 'add-friend', label: host.t('msgr.friendAdd') });
  }
  menuItems.push({ act: 'copy-name', label: host.t('msgr.actionCopyUsername') });
  if (conv) {
    menuItems.push({
      act: 'mute',
      label: host.t(isConvMuted(conv.id) ? 'msgr.actionUnmute' : 'msgr.actionMute'),
    });
    if (isConvMuted(conv.id)) {
      const until = getMuteUntil(conv.id);
      if (until !== undefined) {
        menuItems.push({ act: 'mute-info', label: formatMuteUntilLabel(until) });
      }
    }
    menuItems.push({
      act: 'pin',
      label: host.t(isConvPinned(conv.id) ? 'msgr.actionUnpin' : 'msgr.actionPin'),
    });
  }
  menuItems.push({
    act: 'block',
    label: host.t(blocked ? 'msgr.actionUnblock' : 'msgr.actionBlock'),
  });
  if (conv) menuItems.push({ act: 'hide', label: host.t('msgr.actionDeleteChat'), danger: true });

  const primaryBtns = [
    canJoin
      ? `<button type="button" class="stngs-btn primary" data-act="join-game">${host.escapeHtml(host.t('msgr.joinPlay'))}</button>`
      : '',
    `<button type="button" class="stngs-btn ${canJoin ? 'ghost' : 'primary'}" data-act="write">${host.escapeHtml(host.t('msgr.actionWrite'))}</button>`,
  ]
    .filter(Boolean)
    .join('');

  actionsEl.hidden = false;
  actionsEl.innerHTML = renderProfileActionsBar(primaryBtns, menuItems);

  bindProfileActionsBar(actionsEl, async (act) => {
    if (act === 'join-game') {
      const fromInvite =
        lastGameInvite && lastGameInvite.from.id === profile.id ? lastGameInvite : null;
      if (fromInvite) {
        await joinFromInvite(fromInvite);
        return;
      }
      const hostPort = parseHostPort(String(profile.activity?.serverHost || ''));
      if (!hostPort || !host?.launchJoinServer) {
        toast(host!.t('msgr.joinFailed', { msg: relayErrMsg('address') }));
        return;
      }
      if (profile.activity?.build) {
        toast(host!.t('msgr.joinBuildHint', { name: profile.activity.build }));
      }
      await host.launchJoinServer(
        {
          ip: hostPort.ip,
          port: hostPort.port,
          name: profile.activity?.serverName || profile.username,
        },
        { buildName: profile.activity?.build, gameVersion: profile.activity?.version },
      );
      return;
    }
    if (act === 'write') {
      closeProfileModal();
      await startDm(profile.id);
      return;
    }
    if (act === 'copy-name') {
      try {
        await navigator.clipboard.writeText(profile.username);
        toast(host!.t('msgr.copied'));
      } catch {
        toast(host!.t('msgr.copyFailed'));
      }
      return;
    }
    if (act === 'mute-info') return;
    if (act === 'mute' && conv) {
      const btn = actionsEl.querySelector('[data-act="mute"]') as HTMLElement | null;
      const r = btn?.getBoundingClientRect();
      openMuteMenu(conv.id, r ? r.left : 40, r ? r.bottom + 4 : 80, () => void openProfileModal());
      return;
    }
    if (act === 'pin' && conv) {
      const pinned = toggleConvPin(conv.id);
      toast(host!.t(pinned ? 'msgr.pinnedOk' : 'msgr.unpinnedOk'));
      renderConversationList();
      void openProfileModal();
      return;
    }
    if (act === 'add-friend') {
      const res = await req(`/friends/${encodeURIComponent(profile.id)}/request`, { method: 'POST', body: {} });
      if (!res?.ok) {
        toast(host!.t('msgr.friendFailed', { msg: res?.error || res?.code || '' }));
        return;
      }
      toast(host!.t(res.data?.status === 'friends' ? 'msgr.friendAcceptedOk' : 'msgr.friendRequestOk'));
      closeProfileModal();
      void refreshFriendsRail();
      return;
    }
    if (act === 'accept-friend') {
      const res = await req(`/friends/${encodeURIComponent(profile.id)}/accept`, { method: 'POST', body: {} });
      if (!res?.ok) {
        toast(host!.t('msgr.friendFailed', { msg: res?.error || res?.code || '' }));
        return;
      }
      toast(host!.t('msgr.friendAcceptedOk'));
      closeProfileModal();
      void refreshFriendsRail();
      return;
    }
    if (act === 'decline-friend' || act === 'cancel-friend' || act === 'unfriend') {
      const path =
        act === 'unfriend' || act === 'cancel-friend'
          ? `/friends/${encodeURIComponent(profile.id)}`
          : `/friends/${encodeURIComponent(profile.id)}/decline`;
      const method = act === 'decline-friend' ? 'POST' : 'DELETE';
      const res = await req(path, { method, body: method === 'POST' ? {} : undefined });
      if (!res?.ok) {
        toast(host!.t('msgr.friendFailed', { msg: res?.error || res?.code || '' }));
        return;
      }
      toast(host!.t(act === 'unfriend' ? 'msgr.friendRemovedOk' : 'msgr.friendDeclinedOk'));
      closeProfileModal();
      void refreshFriendsRail();
      return;
    }
    if (act === 'block') {
      const res = await req(`/users/${encodeURIComponent(profile.id)}/block`, {
        method: blocked ? 'DELETE' : 'POST',
        body: {},
      });
      if (!res?.ok) {
        toast(host!.t(blocked ? 'msgr.unblockFailed' : 'msgr.blockFailed', { msg: res?.error || res?.code || '' }));
        return;
      }
      closeProfileModal();
      if (!blocked) {
        if (conv) {
          await req(`/conversations/${encodeURIComponent(conv.id)}/hide`, { method: 'POST', body: {} });
          if (activeId === conv.id) {
            activeId = null;
            messages = [];
            pendingFiles = [];
            renderPendingFiles();
            setReplyTo(null);
          }
        }
        toast(host!.t('msgr.blockedOk'));
      } else {
        toast(host!.t('msgr.unblockedOk'));
      }
      await loadConversations();
      renderPeerHeader();
      renderMessages();
      void refreshFriendsRail();
      return;
    }
    if (act === 'hide' && conv) {
      await req(`/conversations/${encodeURIComponent(conv.id)}/hide`, { method: 'POST', body: {} });
      closeProfileModal();
      activeId = null;
      messages = [];
      await loadConversations();
      renderPeerHeader();
      renderMessages();
    }
  });
}

async function openProfileModal(opts?: { userId?: string }): Promise<void> {
  const conv = conversations.find((c) => c.id === activeId);
  if (!host) return;
  const overlay = $('modal-msgr-profile');
  const titleEl = $('msgr-profile-title');
  const badgesEl = $('msgr-profile-badges');
  const statusEl = $('msgr-profile-status');
  const avatarEl = $('msgr-profile-avatar');
  const rowsEl = $('msgr-profile-rows');
  const membersEl = $('msgr-profile-members');
  const actionsEl = $('msgr-profile-actions');
  const fallback = $('msgr-profile-skin-fallback');
  if (!overlay || !titleEl || !badgesEl || !rowsEl || !actionsEl || !membersEl || !statusEl || !avatarEl) return;

  // Профиль пользователя без открытого чата (друзья / поиск)
  if (opts?.userId) {
    openOverlay('modal-msgr-profile');
    overlay.setAttribute('aria-hidden', 'false');
    const res = await req(`/users/${encodeURIComponent(opts.userId)}/profile`);
    if (!res?.ok || !res.data?.profile) {
      closeProfileModal();
      toast(host.t('msgr.profileLoadFailed'));
      return;
    }
    const profile: MessengerUser = res.data.profile;
    const dmConv = conversations.find((c) => c.type === 'dm' && c.peer?.id === profile.id) || null;
    await fillDmProfile(profile, dmConv, {
      titleEl,
      badgesEl,
      statusEl,
      avatarEl,
      rowsEl,
      membersEl,
      actionsEl,
      fallback,
    });
    return;
  }

  if (!conv) return;

  openOverlay('modal-msgr-profile');
  overlay.setAttribute('aria-hidden', 'false');

  if (conv.type === 'dm' && conv.peer) {
    const res = await req(`/users/${encodeURIComponent(conv.peer.id)}/profile`);
    const profile: MessengerUser = res?.ok ? res.data.profile : conv.peer;
    await fillDmProfile(profile, conv, {
      titleEl,
      badgesEl,
      statusEl,
      avatarEl,
      rowsEl,
      membersEl,
      actionsEl,
      fallback,
    });
    return;
  }

  // Группа
  openProfileUser = null;
  const projectTitle = conv.isProject ? host.t('msgr.projectChat') : conv.title;
  titleEl.textContent = projectTitle;
  badgesEl.innerHTML = conv.isProject
    ? `<span class="msgr-badge msgr-badge--project">${host.escapeHtml(host.t('msgr.projectChatBadge'))}</span>`
    : `<span class="msgr-badge msgr-badge--group">${host.escapeHtml(host.t('msgr.group'))}</span>`;
  avatarEl.innerHTML = groupAvatarHtml(conv, 44);
  statusEl.className = 'msgr-profile__status';
  statusEl.textContent = groupOnlineMembersLabel(conv);

  const aboutCard = profileCardHtml(
    host.t('msgr.profileAbout'),
    conv.description || host.t('msgr.profileNoAbout'),
    conv.myRole || 'member',
    { iconText: projectTitle },
  );
  const rulesMd = conv.rules?.trim() || '';
  const rulesBody = rulesMd
    ? host.renderMarkdown
      ? host.renderMarkdown(rulesMd)
      : host.escapeHtml(rulesMd)
    : host.escapeHtml(host.t('msgr.profileNoRules'));
  const rulesCard = `<div class="msgr-profile-card msgr-profile-card--rules">
    <div class="msgr-profile-card__meta msgr-profile-card__meta--wide">
      <div class="msgr-profile-card__label">${host.escapeHtml(host.t('msgr.profileRules'))}</div>
      <div class="msgr-md ai-md">${rulesBody}</div>
    </div>
  </div>`;
  const buildName = conv.groupBuildName || '';
  const buildCard = buildName
    ? profileCardHtml(host.t('msgr.profileGroupBuild'), buildName, conv.groupBuildMeta || undefined, {
        iconUrl: resolveBuildCardIcon(buildName, true),
        iconText: buildName,
        clickAct: 'open-group-build',
      })
    : '';
  rowsEl.innerHTML = aboutCard + rulesCard + buildCard;
  rowsEl.onclick = (e) => {
    const card = (e.target as HTMLElement).closest('[data-card-act]') as HTMLElement | null;
    const act = card?.getAttribute('data-card-act');
    if (act === 'open-group-build') {
      const shareId = conv.groupBuildShareId;
      if (shareId && host?.openInstanceShare) {
        closeProfileModal();
        void host.openInstanceShare(shareId);
        return;
      }
      if (buildName && host?.focusBuildByName) {
        closeProfileModal();
        host.focusBuildByName(buildName);
        return;
      }
      toast(host?.t('msgr.groupBuildOpenFailed') || '');
    }
  };

  if (conv.coverUrl) {
    setProfileSkinPanel('cover', conv.coverUrl, conv.updatedAt);
  } else {
    setProfileSkinPanel('hidden');
  }
  setProfileTabsVisible(true);
  setProfilePanelTab('info', false);
  const canMod = conv.myRole === 'owner' || conv.myRole === 'admin';
  const isOwner = conv.myRole === 'owner';
  membersEl.hidden = false;
  membersEl.innerHTML = (conv.members || [])
    .map((m) => {
      ensureAvatar(m);
      const menuItems: string[] = [];
      if (isOwner && m.id !== me?.id && m.role !== 'owner') {
        if (m.role === 'admin') {
          menuItems.push(
            `<button type="button" data-role="member" data-uid="${host!.escapeHtml(m.id)}">${host!.escapeHtml(host!.t('msgr.actionDemote'))}</button>`,
          );
        } else {
          menuItems.push(
            `<button type="button" data-role="admin" data-uid="${host!.escapeHtml(m.id)}">${host!.escapeHtml(host!.t('msgr.actionPromote'))}</button>`,
          );
        }
      }
      if (canMod && m.id !== me?.id && m.role !== 'owner') {
        menuItems.push(
          `<button type="button" class="is-danger" data-kick="${host!.escapeHtml(m.id)}">${host!.escapeHtml(host!.t('msgr.actionKick'))}</button>`,
        );
        if (m.mute) {
          menuItems.push(
            `<button type="button" data-unmute="${host!.escapeHtml(m.id)}">${host!.escapeHtml(host!.t('msgr.actionUnmuteMember'))}</button>`,
          );
        } else {
          menuItems.push(
            `<button type="button" data-mute-member="${host!.escapeHtml(m.id)}" data-mute-min="15">${host!.escapeHtml(host!.t('msgr.actionMuteMember'))}: ${host!.escapeHtml(host!.t('msgr.mute15m'))}</button>`,
            `<button type="button" data-mute-member="${host!.escapeHtml(m.id)}" data-mute-min="60">${host!.escapeHtml(host!.t('msgr.actionMuteMember'))}: ${host!.escapeHtml(host!.t('msgr.mute1h'))}</button>`,
            `<button type="button" data-mute-member="${host!.escapeHtml(m.id)}" data-mute-min="1440">${host!.escapeHtml(host!.t('msgr.actionMuteMember'))}: ${host!.escapeHtml(host!.t('msgr.mute24h'))}</button>`,
            `<button type="button" data-mute-member="${host!.escapeHtml(m.id)}" data-mute-forever="1">${host!.escapeHtml(host!.t('msgr.actionMuteMember'))}: ${host!.escapeHtml(host!.t('msgr.muteForever'))}</button>`,
          );
        }
      }
      const more = menuItems.length
        ? `<div class="msgr-profile__member-more">
            <button type="button" class="msgr-profile__member-more-btn" data-member-more aria-label="${host!.escapeHtml(host!.t('msgr.moreActions'))}">···</button>
            <div class="msgr-profile__member-menu" role="menu">${menuItems.join('')}</div>
          </div>`
        : '';
      return `<div class="msgr-profile__member is-clickable" data-user-id="${host!.escapeHtml(m.id)}">
        <span class="msgr-avatar">${avatarImgHtml(m, 32, m.username.slice(0, 1))}</span>
        <span class="msgr-profile__member-body">
          <span class="msgr-profile__member-name">${host!.escapeHtml(m.username)}</span>
          <span class="msgr-profile__member-meta">
            <span class="msgr-badge ${providerClass(m.provider)}">${host!.escapeHtml(providerLabel(m.provider))}</span>
            <span class="msgr-profile__member-role">${host!.escapeHtml(m.role || 'member')}</span>
          </span>
        </span>
        ${more}
      </div>`;
    })
    .join('');
  // Догрузить уже закэшированные аватарки (и дождаться in-flight)
  for (const m of conv.members || []) {
    if (avatarCache.has(m.id)) applyAvatarsInDom(m.id);
    else if (avatarInflight.has(m.id)) void avatarInflight.get(m.id)?.then(() => applyAvatarsInDom(m.id));
  }
  membersEl.onclick = async (e) => {
    const moreBtn = (e.target as HTMLElement).closest('[data-member-more]') as HTMLElement | null;
    if (moreBtn) {
      e.preventDefault();
      e.stopPropagation();
      const wrap = moreBtn.closest('.msgr-profile__member-more');
      const open = wrap?.classList.contains('is-open');
      membersEl.querySelectorAll('.msgr-profile__member-more.is-open').forEach((el) => {
        el.classList.remove('is-open');
      });
      if (!open) wrap?.classList.add('is-open');
      return;
    }
    const roleBtn = (e.target as HTMLElement).closest('[data-role]') as HTMLElement | null;
    const role = roleBtn?.getAttribute('data-role');
    const roleUid = roleBtn?.getAttribute('data-uid');
    if (role && roleUid) {
      const res = await req(
        `/conversations/${encodeURIComponent(conv.id)}/members/${encodeURIComponent(roleUid)}`,
        { method: 'PATCH', body: { role } },
      );
      if (!res?.ok) toast(host!.t('msgr.roleFailed', { msg: res?.error || '' }));
      await loadConversations();
      void openProfileModal().then(() => setProfilePanelTab('members', false));
      return;
    }
    const btn = (e.target as HTMLElement).closest('[data-kick]') as HTMLElement | null;
    const uid = btn?.getAttribute('data-kick');
    if (uid) {
      await req(`/conversations/${encodeURIComponent(conv.id)}/members/${encodeURIComponent(uid)}`, {
        method: 'DELETE',
      });
      await loadConversations();
      void openProfileModal().then(() => setProfilePanelTab('members', false));
      return;
    }
    const unmuteBtn = (e.target as HTMLElement).closest('[data-unmute]') as HTMLElement | null;
    const unmuteUid = unmuteBtn?.getAttribute('data-unmute');
    if (unmuteUid) {
      await req(
        `/conversations/${encodeURIComponent(conv.id)}/members/${encodeURIComponent(unmuteUid)}/mute`,
        { method: 'DELETE', body: {} },
      );
      await loadConversations();
      void openProfileModal().then(() => setProfilePanelTab('members', false));
      return;
    }
    const muteBtn = (e.target as HTMLElement).closest('[data-mute-member]') as HTMLElement | null;
    const muteUid = muteBtn?.getAttribute('data-mute-member');
    if (muteUid) {
      const forever = muteBtn?.getAttribute('data-mute-forever') === '1';
      const minutes = Number(muteBtn?.getAttribute('data-mute-min') || 60);
      await req(
        `/conversations/${encodeURIComponent(conv.id)}/members/${encodeURIComponent(muteUid)}/mute`,
        {
          method: 'POST',
          body: forever ? { forever: true } : { minutes },
        },
      );
      await loadConversations();
      void openProfileModal().then(() => setProfilePanelTab('members', false));
      return;
    }
    // Клик по участнику → его карточка (без close: иначе closeModal через 120мс снова скроет окно)
    if ((e.target as HTMLElement).closest('.msgr-profile__member-menu')) return;
    const row = (e.target as HTMLElement).closest('.msgr-profile__member[data-user-id]') as HTMLElement | null;
    const userId = row?.getAttribute('data-user-id');
    if (!userId) return;
    e.preventDefault();
    e.stopPropagation();
    void openProfileModal({ userId });
  };

  const menuItems: ProfileMenuItem[] = [];
  if (canMod) {
    if (!conv.isProject) {
      menuItems.push({ act: 'rename', label: host.t('msgr.actionRename') });
    }
    menuItems.push({ act: 'description', label: host.t('msgr.actionDescription') });
    menuItems.push({
      act: 'group-build',
      label: host.t(conv.groupBuildName ? 'msgr.actionGroupBuildChange' : 'msgr.actionGroupBuild'),
    });
    if (conv.groupBuildName) {
      menuItems.push({ act: 'group-build-remove', label: host.t('msgr.actionGroupBuildRemove') });
    }
    menuItems.push({
      act: 'avatar',
      label: host.t(conv.avatarUrl ? 'msgr.actionAvatarChange' : 'msgr.actionAvatar'),
    });
    if (conv.avatarUrl) {
      menuItems.push({ act: 'avatar-remove', label: host.t('msgr.actionAvatarRemove') });
    }
    menuItems.push({
      act: 'cover',
      label: host.t(conv.coverUrl ? 'msgr.actionCoverChange' : 'msgr.actionCover'),
    });
    if (conv.coverUrl) {
      menuItems.push({ act: 'cover-remove', label: host.t('msgr.actionCoverRemove') });
    }
    menuItems.push({ act: 'add', label: host.t('msgr.actionAddMembers') });
    menuItems.push({ act: 'invite-link', label: host.t('msgr.actionInviteLink') });
    menuItems.push({ act: 'rules', label: host.t('msgr.actionRules') });
    if (conv.isProject) {
      menuItems.push({ act: 'bot-toggle', label: host.t('msgr.botToggle') });
      menuItems.push({ act: 'bot-name', label: host.t('msgr.botName') });
      menuItems.push({ act: 'bot-avatar', label: host.t('msgr.botAvatar') });
      menuItems.push({ act: 'bot-broadcast', label: host.t('msgr.botBroadcast') });
      menuItems.push({ act: 'bot-command', label: host.t('msgr.botAddCommand') });
      menuItems.push({ act: 'bot-schedule', label: host.t('msgr.botAddSchedule') });
    }
  }
  menuItems.push({
    act: 'mute',
    label: host.t(isConvMuted(conv.id) ? 'msgr.actionUnmute' : 'msgr.actionMute'),
  });
  if (conv && isConvMuted(conv.id)) {
    const until = getMuteUntil(conv.id);
    if (until !== undefined) {
      menuItems.push({
        act: 'mute-info',
        label: formatMuteUntilLabel(until),
      });
    }
  }
  menuItems.push({
    act: 'pin',
    label: host.t(isConvPinned(conv.id) ? 'msgr.actionUnpin' : 'msgr.actionPin'),
  });
  menuItems.push({ act: 'copy-title', label: host.t('msgr.actionCopyGroupName') });
  if (conv.myRole === 'owner' && !conv.isProject) {
    menuItems.push({ act: 'delete', label: host.t('msgr.actionDeleteGroup'), danger: true });
  }

  const leaveBtn = conv.isProject
    ? ''
    : `<button type="button" class="stngs-btn danger" data-act="leave">${host.escapeHtml(host.t('msgr.actionLeave'))}</button>`;
  actionsEl.hidden = false;
  actionsEl.innerHTML = renderProfileActionsBar(leaveBtn, menuItems);

  bindProfileActionsBar(actionsEl, async (act) => {
    if (act === 'rename') {
      const title = await askPromptText({
        title: host!.t('msgr.groupTitlePrompt'),
        sub: host!.t('msgr.actionRename'),
        value: conv.title,
        okLabel: host!.t('btn.save'),
      });
      if (!title?.trim()) return;
      await req(`/conversations/${encodeURIComponent(conv.id)}`, {
        method: 'PATCH',
        body: { title: title.trim() },
      });
      await loadConversations();
      void openProfileModal();
      return;
    }
    if (act === 'description') {
      const description = await askPromptText({
        title: host!.t('msgr.actionDescription'),
        sub: host!.t('msgr.descriptionHint'),
        value: conv.description || '',
        placeholder: host!.t('msgr.descriptionHint'),
        okLabel: host!.t('btn.save'),
        maxLength: 280,
      });
      if (description == null) return;
      await req(`/conversations/${encodeURIComponent(conv.id)}`, {
        method: 'PATCH',
        body: { description },
      });
      await loadConversations();
      void openProfileModal();
      return;
    }
    if (act === 'rules') {
      const rules = await askPromptText({
        title: host!.t('msgr.actionRules'),
        sub: host!.t('msgr.rulesMarkdownHint'),
        value: conv.rules || '',
        placeholder: host!.t('msgr.rulesMarkdownPlaceholder'),
        okLabel: host!.t('btn.save'),
        maxLength: 12000,
        multiline: true,
      });
      if (rules == null) return;
      await req(`/conversations/${encodeURIComponent(conv.id)}`, {
        method: 'PATCH',
        body: { rules },
      });
      await loadConversations();
      void openProfileModal();
      return;
    }
    // ===== Управление ботом «Чата проекта» =====
    if (act === 'bot-toggle' || act === 'bot-name' || act === 'bot-avatar' || act === 'bot-broadcast' || act === 'bot-command' || act === 'bot-schedule') {
      try {
        if (act === 'bot-toggle') {
          const cur = await req(`/conversations/${encodeURIComponent(conv.id)}/bot`);
          const enabled = Boolean(cur?.data?.bot?.enabled);
          const res = await req(`/conversations/${encodeURIComponent(conv.id)}/bot`, {
            method: 'PATCH',
            body: { enabled: !enabled },
          });
          toast(host!.t(res?.ok ? 'msgr.botOk' : 'msgr.botFailed', { msg: res?.error || '' }));
          return;
        }
        if (act === 'bot-name') {
          const cur = await req(`/conversations/${encodeURIComponent(conv.id)}/bot`);
          const name = await askPromptText({
            title: host!.t('msgr.botName'),
            value: String(cur?.data?.bot?.displayName || ''),
            okLabel: host!.t('btn.save'),
            maxLength: 64,
          });
          if (!name?.trim()) return;
          const res = await req(`/conversations/${encodeURIComponent(conv.id)}/bot`, {
            method: 'PATCH',
            body: { displayName: name.trim() },
          });
          toast(host!.t(res?.ok ? 'msgr.botOk' : 'msgr.botFailed', { msg: res?.error || '' }));
          return;
        }
        if (act === 'bot-avatar') {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/png,image/jpeg,image/webp';
          input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = async () => {
              const res = await req(`/conversations/${encodeURIComponent(conv.id)}/bot`, {
                method: 'PATCH',
                body: { avatarDataUrl: String(reader.result || '') },
              });
              if (res?.ok) {
                const botId = 'bot:project';
                avatarCache.delete(botId);
                avatarInflight.delete(botId);
                const avatarUrl = res.data?.bot?.avatarUrl as string | null | undefined;
                if (avatarUrl) {
                  for (const c of conversations) {
                    const member = c.members?.find((u) => u.id === botId);
                    if (member) member.skinUrl = avatarUrl;
                    if (c.peer?.id === botId) c.peer.skinUrl = avatarUrl;
                  }
                  avatarCache.set(botId, resolveMsgrMediaUrl(avatarUrl, Date.now()));
                  applyAvatarsInDom(botId);
                }
                toast(host!.t('msgr.botOk'));
              } else {
                toast(host!.t('msgr.botFailed', { msg: res?.error || '' }));
              }
            };
            reader.readAsDataURL(file);
          };
          input.click();
          return;
        }
        if (act === 'bot-broadcast') {
          const body = await askPromptText({
            title: host!.t('msgr.botBroadcast'),
            placeholder: host!.t('msgr.botBroadcastHint'),
            okLabel: host!.t('msgr.botBroadcast'),
            maxLength: 2000,
          });
          if (!body?.trim()) return;
          const res = await req(`/conversations/${encodeURIComponent(conv.id)}/bot/broadcast`, {
            method: 'POST',
            body: { body: body.trim() },
          });
          if (res?.ok && res.data?.message) {
            if (activeId === conv.id) upsertIncomingMessage(res.data.message);
            toast(host!.t('msgr.botOk'));
          } else {
            toast(host!.t('msgr.botFailed', { msg: res?.error || '' }));
          }
          return;
        }
        if (act === 'bot-command') {
          const name = await askPromptText({
            title: host!.t('msgr.botAddCommand'),
            sub: host!.t('msgr.botCommandName'),
            placeholder: 'help',
            okLabel: host!.t('btn.save'),
            maxLength: 32,
          });
          if (!name?.trim()) return;
          const response = await askPromptText({
            title: host!.t('msgr.botAddCommand'),
            sub: host!.t('msgr.botCommandResponse'),
            okLabel: host!.t('btn.save'),
            maxLength: 2000,
          });
          if (response == null) return;
          const res = await req(`/conversations/${encodeURIComponent(conv.id)}/bot/commands`, {
            method: 'POST',
            body: { name: name.trim().replace(/^\//, ''), response },
          });
          toast(host!.t(res?.ok ? 'msgr.botOk' : 'msgr.botFailed', { msg: res?.error || '' }));
          return;
        }
        if (act === 'bot-schedule') {
          const time = await askPromptText({
            title: host!.t('msgr.botAddSchedule'),
            sub: host!.t('msgr.botScheduleTime'),
            placeholder: '09:00',
            okLabel: 'OK',
            maxLength: 5,
          });
          if (!time?.trim() || !/^\d{1,2}:\d{2}$/.test(time.trim())) {
            toast(host!.t('msgr.botFailed', { msg: 'HH:MM' }));
            return;
          }
          const body = await askPromptText({
            title: host!.t('msgr.botAddSchedule'),
            sub: host!.t('msgr.botScheduleBody'),
            okLabel: host!.t('btn.save'),
            maxLength: 2000,
          });
          if (!body?.trim()) return;
          const hhmm = time.trim().replace(/^(\d):/, '0$1:');
          const res = await req(`/conversations/${encodeURIComponent(conv.id)}/bot/schedules`, {
            method: 'POST',
            body: { time: hhmm, body: body.trim() },
          });
          toast(host!.t(res?.ok ? 'msgr.botOk' : 'msgr.botFailed', { msg: res?.error || '' }));
          return;
        }
      } catch (e: any) {
        toast(host!.t('msgr.botFailed', { msg: e?.message || 'error' }));
      }
      return;
    }
    if (act === 'group-build') {
      const mode = await askPromptText({
        title: host!.t('msgr.actionGroupBuild'),
        sub: host!.t('msgr.groupBuildHint'),
        placeholder: host!.t('msgr.groupBuildPlaceholder'),
        okLabel: host!.t('btn.save'),
        pickBuild: true,
        maxLength: 200,
      });
      if (!mode) return;
      // Локальная сборка по id
      const local = (host!.listLocalBuilds?.() || []).find((b) => b.id === mode);
      if (local) {
        toast(host!.t('msgr.groupBuildSharing'));
        const share = await host!.createInstanceShare?.(local.id);
        if (!share?.ok || !share.id) {
          toast(host!.t('msgr.groupBuildFailed', { msg: share?.error || '' }));
          return;
        }
        await req(`/conversations/${encodeURIComponent(conv.id)}`, {
          method: 'PATCH',
          body: {
            groupBuildName: local.name,
            groupBuildShareId: share.id,
            groupBuildMeta: local.meta,
          },
        });
        await loadConversations();
        void openProfileModal();
        return;
      }
      // Ссылка / id шаринга
      const shareId = parseShareId(mode);
      if (!shareId) {
        toast(host!.t('msgr.groupBuildInvalid'));
        return;
      }
      await req(`/conversations/${encodeURIComponent(conv.id)}`, {
        method: 'PATCH',
        body: {
          groupBuildName: mode.slice(0, 64),
          groupBuildShareId: shareId,
          groupBuildMeta: '',
        },
      });
      await loadConversations();
      void openProfileModal();
      return;
    }
    if (act === 'group-build-remove') {
      await req(`/conversations/${encodeURIComponent(conv.id)}`, {
        method: 'PATCH',
        body: { clearGroupBuild: true },
      });
      await loadConversations();
      void openProfileModal();
      return;
    }
    if (act === 'avatar') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/png,image/jpeg,image/webp';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async () => {
          const res = await req(`/conversations/${encodeURIComponent(conv.id)}`, {
            method: 'PATCH',
            body: { avatarDataUrl: String(reader.result || '') },
          });
          if (!res?.ok) {
            toast(host!.t('msgr.avatarFailed', { msg: res?.error || res?.code || '' }));
            return;
          }
          await loadConversations();
          void openProfileModal();
        };
        reader.readAsDataURL(file);
      };
      input.click();
      return;
    }
    if (act === 'avatar-remove') {
      const res = await req(`/conversations/${encodeURIComponent(conv.id)}`, {
        method: 'PATCH',
        body: { avatarUrl: '' },
      });
      if (!res?.ok) {
        toast(host!.t('msgr.avatarFailed', { msg: res?.error || res?.code || '' }));
        return;
      }
      await loadConversations();
      void openProfileModal();
      return;
    }
    if (act === 'cover') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/png,image/jpeg,image/webp';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        const dataUrl = await openCoverCropEditor(file);
        if (!dataUrl) return;
        const res = await req(`/conversations/${encodeURIComponent(conv.id)}`, {
          method: 'PATCH',
          body: { coverDataUrl: dataUrl },
        });
        if (!res?.ok) {
          toast(host!.t('msgr.coverFailed', { msg: res?.error || res?.code || '' }));
          return;
        }
        await loadConversations();
        void openProfileModal();
      };
      input.click();
      return;
    }
    if (act === 'cover-remove') {
      const res = await req(`/conversations/${encodeURIComponent(conv.id)}`, {
        method: 'PATCH',
        body: { coverUrl: '' },
      });
      if (!res?.ok) {
        toast(host!.t('msgr.coverFailed', { msg: res?.error || res?.code || '' }));
        return;
      }
      await loadConversations();
      void openProfileModal();
      return;
    }
    if (act === 'add') {
      const userId = await askPromptText({
        title: host!.t('msgr.actionAddMembers'),
        sub: host!.t('msgr.addMembersSearch'),
        placeholder: host!.t('msgr.addMembersSearch'),
        okLabel: host!.t('msgr.actionAddMembers'),
        searchUsers: true,
      });
      if (!userId) return;
      await req(`/conversations/${encodeURIComponent(conv.id)}/members`, {
        method: 'POST',
        body: { memberIds: [userId] },
      });
      await loadConversations();
      void openProfileModal();
      return;
    }
    if (act === 'invite-link') {
      try {
        const res = await req(`/conversations/${encodeURIComponent(conv.id)}/invites`, {
          method: 'POST',
          body: {},
        });
        if (!res?.ok || !res.data?.invite?.token) {
          toast(host!.t('msgr.inviteCreateFailed', { msg: res?.error || res?.code || 'error' }));
          return;
        }
        const pageUrl = `${getApiBase()}/groupInvite/${encodeURIComponent(String(res.data.invite.token))}`;
        // После await жест пользователя теряется — clipboard часто молча падает.
        // Показываем ссылку в модалке; копирование по кнопке OK (новый жест).
        const confirmed = await askPromptText({
          title: host!.t('msgr.actionInviteLink'),
          sub: host!.t('msgr.inviteLinkHint'),
          value: pageUrl,
          okLabel: host!.t('msgr.inviteCopy'),
          maxLength: 400,
          selectAll: true,
        });
        if (!confirmed) return;
        try {
          await navigator.clipboard.writeText(pageUrl);
          toast(host!.t('msgr.inviteCopied'));
        } catch {
          toast(host!.t('msgr.copyFailed'));
        }
      } catch (e: any) {
        toast(host!.t('msgr.inviteCreateFailed', { msg: e?.message || 'error' }));
      }
      return;
    }
    if (act === 'mute-info') return;
    if (act === 'mute') {
      const btn = actionsEl.querySelector('[data-act="mute"]') as HTMLElement | null;
      const r = btn?.getBoundingClientRect();
      openMuteMenu(conv.id, r ? r.left : 40, r ? r.bottom + 4 : 80, () => void openProfileModal());
      return;
    }
    if (act === 'pin') {
      const pinned = toggleConvPin(conv.id);
      toast(host!.t(pinned ? 'msgr.pinnedOk' : 'msgr.unpinnedOk'));
      renderConversationList();
      void openProfileModal();
      return;
    }
    if (act === 'copy-title') {
      try {
        await navigator.clipboard.writeText(conv.title);
        toast(host!.t('msgr.copied'));
      } catch {
        toast(host!.t('msgr.copyFailed'));
      }
      return;
    }
    if (act === 'leave' && me) {
      if (conv.isProject) return;
      await req(`/conversations/${encodeURIComponent(conv.id)}/members/${encodeURIComponent(me.id)}`, {
        method: 'DELETE',
      });
      closeProfileModal();
      activeId = null;
      messages = [];
      await loadConversations();
      renderPeerHeader();
      renderMessages();
      return;
    }
    if (act === 'delete') {
      if (conv.isProject) return;
      await req(`/conversations/${encodeURIComponent(conv.id)}`, { method: 'DELETE' });
      closeProfileModal();
      activeId = null;
      messages = [];
      await loadConversations();
      renderPeerHeader();
      renderMessages();
    }
  });
}

function onRealtimePayload(eventName: string, data: any): void {
  if (eventName === 'message' && data?.message) {
    const msg = data.message as MessengerMessage;
    const mine = Boolean(me?.id && msg.senderId === me.id);
    if (!mine && myPresenceStatus !== 'dnd' && !isConvMuted(String(msg.conversationId || ''))) {
      playMsgrSound('message');
    }
    if (msg.conversationId === activeId) {
      upsertIncomingMessage(msg);
      void req(`/conversations/${encodeURIComponent(msg.conversationId)}/read`, {
        method: 'POST',
        body: {},
      });
    }
    void loadConversations();
    return;
  }
  if (eventName === 'message_deleted' && data?.message) {
    const msg = data.message as MessengerMessage;
    if (msg.conversationId === activeId) upsertIncomingMessage(msg);
    void loadConversations();
    return;
  }
  if (eventName === 'reaction' && data?.message) {
    const msg = data.message as MessengerMessage;
    if (msg.conversationId === activeId) upsertIncomingMessage(msg);
    return;
  }
  if (
    (eventName === 'member_muted' || eventName === 'member_unmuted') &&
    data?.conversationId
  ) {
    if (data.conversation) {
      const idx = conversations.findIndex((c) => c.id === data.conversationId);
      if (idx >= 0) conversations[idx] = data.conversation;
      else void loadConversations();
    } else {
      void loadConversations();
    }
    if (data.conversationId === activeId) {
      applyComposerMuteState();
      renderPeerHeader();
      const overlay = $('modal-msgr-profile');
      if (overlay && !overlay.classList.contains('hidden')) {
        void openProfileModal().then(() => setProfilePanelTab(profilePanelTab, false));
      }
    } else {
      renderConversationList();
    }
    return;
  }
  if (eventName === 'friend') {
    if (railTab !== 'chats') void refreshFriendsRail();
    if (data?.type === 'request' && data?.from?.username) {
      toast(host?.t('msgr.friendIncomingToast', { name: data.from.username }) || 'Friend request');
    } else if (data?.type === 'accepted' && data?.from?.username) {
      toast(host?.t('msgr.friendAcceptedToast', { name: data.from.username }) || 'Friend accepted');
    }
    return;
  }
  if (eventName === 'presence' && data?.userId) {
    applyActivityToUsers(data.userId, data);
    if (me?.id === data.userId && data.presenceStatus) {
      myPresenceStatus = normalizePresenceStatus(data.presenceStatus);
      renderPresence(myPresenceStatus === 'offline' ? 'offline' : 'online');
    }
    return;
  }
  if (eventName === 'activity' && data?.userId) {
    applyActivityToUsers(data.userId, data);
    if (railTab === 'worlds') renderWorldsList();
    return;
  }
  if (eventName === 'typing') {
    notePeerTyping(data || {});
    return;
  }
  if (eventName === 'game_invite' && data?.from?.id) {
    lastGameInvite = {
      mode: data.mode === 'direct' ? 'direct' : 'relay',
      sessionId: data.sessionId || null,
      host: data.host || null,
      port: data.port != null ? Number(data.port) : null,
      publicHost: data.publicHost || null,
      publicPort: data.publicPort != null ? Number(data.publicPort) : null,
      buildName: data.buildName || null,
      gameVersion: data.gameVersion || null,
      loader: data.loader || null,
      serverName: data.serverName || null,
      shareId: data.shareId || null,
      shareUrl: data.shareUrl || null,
      from: { id: String(data.from.id), username: String(data.from.username || '') },
      ts: Number(data.ts) || Date.now(),
    };
    // Сразу отражаем мир друга во вкладке «Миры» (не ждём отдельный activity)
    const inviteHost =
      lastGameInvite.mode === 'relay' && lastGameInvite.publicHost && lastGameInvite.publicPort
        ? `${lastGameInvite.publicHost}:${lastGameInvite.publicPort}`
        : lastGameInvite.host
          ? `${lastGameInvite.host}${lastGameInvite.port ? `:${lastGameInvite.port}` : ''}`
          : null;
    applyActivityToUsers(lastGameInvite.from.id, {
      userId: lastGameInvite.from.id,
      activity: {
        playing: true,
        hosting: true,
        build: lastGameInvite.buildName,
        version: lastGameInvite.gameVersion,
        loader: lastGameInvite.loader,
        server: lastGameInvite.serverName,
        serverHost: inviteHost,
        at: lastGameInvite.ts,
      },
    });
    if (railTab === 'worlds') renderWorldsList();
    void loadConversations();
    // Без баннера: только чат + вкладка «Миры»
    return;
  }
  if (eventName === 'game_invite_ended') {
    if (data?.from?.id) {
      applyActivityToUsers(data.from.id, {
        userId: data.from.id,
        activity: {
          playing: true,
          hosting: false,
          build: friendsBundle.friends.find((u) => u.id === data.from.id)?.activity?.build || null,
          version: friendsBundle.friends.find((u) => u.id === data.from.id)?.activity?.version || null,
          loader: friendsBundle.friends.find((u) => u.id === data.from.id)?.activity?.loader || null,
          server: null,
          serverHost: null,
          at: Date.now(),
        },
      });
      if (railTab === 'worlds') renderWorldsList();
    }
    if (lastGameInvite && data?.from?.id && lastGameInvite.from.id === data.from.id) {
      lastGameInvite = null;
    }
    return;
  }
  if (
    eventName === 'conversation' ||
    eventName === 'conversation_updated' ||
    eventName === 'member_changed' ||
    eventName === 'read'
  ) {
    if (data?.deleted || data?.left) {
      if (activeId === data.conversationId) {
        activeId = null;
        messages = [];
        renderMessages();
      }
    }
    if (data?.conversation && data.conversationId) {
      const idx = conversations.findIndex((c) => c.id === data.conversationId);
      if (idx >= 0) conversations[idx] = data.conversation;
    }
    void loadConversations().then(() => {
      applyComposerMuteState();
      renderPinBar();
      // Обновляем галочки «прочитано» без сброса скролла
      if (activeId && (eventName === 'read' || eventName === 'conversation_updated')) {
        renderMessages();
      }
    });
  }
}

function disconnectStream(): void {
  if (stream) {
    stream.close();
    stream = null;
  }
  streamToken = null;
}

function isStreamAlive(): boolean {
  return Boolean(stream && stream.readyState !== EventSource.CLOSED);
}

function connectStream(token: string): void {
  if (!token) {
    disconnectStream();
    return;
  }
  // Тот же токен и живой SSE — не пересоздаём (иначе «переподключение» при каждом заходе во вкладку)
  if (streamToken === token && isStreamAlive()) return;

  disconnectStream();
  streamToken = token;
  const url = `${getApiBase()}/api/messenger/stream?token=${encodeURIComponent(token)}`;
  try {
    stream = new EventSource(url);
  } catch {
    streamToken = null;
    return;
  }
  const handle = (eventName: string) => (ev: MessageEvent) => {
    try {
      const data = JSON.parse(String(ev.data || '{}'));
      onRealtimePayload(eventName, data);
    } catch {
      /* ignore */
    }
  };
  stream.addEventListener('message', handle('message'));
  stream.addEventListener('message_deleted', handle('message_deleted'));
  stream.addEventListener('conversation', handle('conversation'));
  stream.addEventListener('conversation_updated', handle('conversation_updated'));
  stream.addEventListener('member_changed', handle('member_changed'));
  stream.addEventListener('member_muted', handle('member_muted'));
  stream.addEventListener('member_unmuted', handle('member_unmuted'));
  stream.addEventListener('reaction', handle('reaction'));
  stream.addEventListener('activity', handle('activity'));
  stream.addEventListener('presence', handle('presence'));
  stream.addEventListener('read', handle('read'));
  stream.addEventListener('friend', handle('friend'));
  stream.addEventListener('game_invite', handle('game_invite'));
  stream.addEventListener('game_invite_ended', handle('game_invite_ended'));
  stream.addEventListener('typing', handle('typing'));
  stream.onerror = () => {
    /* EventSource переподключится сам */
  };
}

function bindUi(): void {
  const list = $('msgr-chat-list');
  list?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.msgr-chat-item') as HTMLElement | null;
    const id = btn?.getAttribute('data-id');
    if (id) void openConversation(id);
  });
  list?.addEventListener('contextmenu', (e) => {
    const btn = (e.target as HTMLElement).closest('.msgr-chat-item') as HTMLElement | null;
    const id = btn?.getAttribute('data-id');
    if (!id || !host) return;
    e.preventDefault();
    const conv = conversations.find((c) => c.id === id);
    if (!conv) return;
    showCtx(e.clientX, e.clientY, chatActionItems(conv));
  });

  $('msgr-stage-head')?.addEventListener('click', () => {
    if (activeId) void openProfileModal();
  });
  $('msgr-stage-head')?.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter' && activeId) void openProfileModal();
  });
  $('msgr-stage-more')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const conv = conversations.find((c) => c.id === activeId);
    if (!conv || !host) return;
    const btn = e.currentTarget as HTMLElement;
    const r = btn.getBoundingClientRect();
    showCtx(r.left, r.bottom + 4, chatActionItems(conv));
  });
  $('msgr-profile-close')?.addEventListener('click', closeProfileModal);
  $('modal-msgr-profile')?.addEventListener('click', (e) => {
    if (e.target === $('modal-msgr-profile')) closeProfileModal();
  });
  $('msgr-reply-clear')?.addEventListener('click', () => setReplyTo(null));

  $('msgr-pin-bar-main')?.addEventListener('click', () => {
    const conv = conversations.find((c) => c.id === activeId);
    const id = conv?.pinnedMessageId || conv?.pinnedMessage?.id;
    if (id) scrollToMessageId(id);
  });
  $('msgr-pin-bar-unpin')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    void clearPinnedMessage();
  });

  const messagesEl = $('msgr-messages');
  messagesEl?.addEventListener('scroll', () => {
    if (!messagesEl || messagesLoadingOlder || !messagesHasMore) return;
    if (messagesEl.scrollTop <= 48) void loadOlderMessages();
  });
  messagesEl?.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-msgr-open-updates]')) {
      e.preventDefault();
      host?.openSettingsTab?.('updates');
      return;
    }
    const botBtn = (e.target as HTMLElement).closest('[data-bot-btn]') as HTMLElement | null;
    if (botBtn) {
      e.preventDefault();
      const buttonId = botBtn.getAttribute('data-bot-btn') || '';
      const messageId = botBtn.getAttribute('data-bot-msg') || '';
      if (buttonId && activeId) void sendBotCallback(activeId, buttonId, messageId);
      return;
    }
    const replyBtn = (e.target as HTMLElement).closest('[data-reply-to]') as HTMLElement | null;
    const replyId = replyBtn?.getAttribute('data-reply-to');
    if (replyId) {
      e.preventDefault();
      scrollToMessageId(replyId);
      return;
    }
    const reactBtn = (e.target as HTMLElement).closest('[data-react-emoji]') as HTMLElement | null;
    const emoji = reactBtn?.getAttribute('data-react-emoji');
    const reactMsgId = reactBtn?.getAttribute('data-msg-id');
    if (emoji && reactMsgId) {
      e.preventDefault();
      void toggleReaction(reactMsgId, emoji);
    }
  });
  messagesEl?.addEventListener('contextmenu', (e) => {
    const row = (e.target as HTMLElement).closest('.msgr-bubble-row') as HTMLElement | null;
    const msgId = row?.getAttribute('data-msg-id');
    if (!msgId || !host) return;
    e.preventDefault();
    const msg = messages.find((m) => m.id === msgId);
    if (!msg || msg.deleted) return;
    const conv = conversations.find((c) => c.id === activeId);
    const canDelete =
      msg.senderId === me?.id ||
      (conv?.type === 'group' && (conv.myRole === 'owner' || conv.myRole === 'admin'));
    const items: { label: string; action: () => void; danger?: boolean }[] = [
      {
        label: host.t('msgr.actionReply'),
        action: () => setReplyTo(msg),
      },
      {
        label: host.t('msgr.actionCopyMessage'),
        action: () => {
          void navigator.clipboard.writeText(msg.body || '').then(
            () => toast(host!.t('msgr.copied')),
            () => toast(host!.t('msgr.copyFailed')),
          );
        },
      },
    ];
    // Быстрые реакции в контекстном меню
    for (const emoji of REACTION_EMOJIS) {
      items.push({
        label: `${host.t('msgr.react')} ${emoji}`,
        action: () => void toggleReaction(msg.id, emoji),
      });
    }
    if (conv?.type === 'group' && msg.senderId && msg.senderId !== me?.id) {
      items.push({
        label: host.t('msgr.actionOpenProfile'),
        action: () => void openProfileByUserId(msg.senderId),
      });
    }
    if (conv && (conv.myRole === 'owner' || conv.myRole === 'admin')) {
      const isPinned = conv.pinnedMessageId === msg.id;
      items.push({
        label: host.t(isPinned ? 'msgr.unpinMessage' : 'msgr.pinMessage'),
        action: () => void (isPinned ? clearPinnedMessage() : pinMessage(msg.id)),
      });
    }
    if (canDelete) {
      items.push({
        label: host.t('msgr.actionDeleteMessage'),
        danger: true,
        action: () => void deleteMessage(msg.id),
      });
    }
    showCtx(e.clientX, e.clientY, items);
  });

  document.addEventListener('click', (e) => {
    const wrap = $('msgr-profile-more')?.closest('.msgr-profile__more-wrap');
    if (wrap && wrap.contains(e.target as Node)) return;
    setProfileMoreMenuOpen(false);
    document.querySelectorAll('.msgr-profile__member-more.is-open').forEach((el) => {
      el.classList.remove('is-open');
    });
  });
  document.addEventListener('click', (e) => {
    const ctx = $('msgr-ctx');
    if (ctx && !ctx.contains(e.target as Node)) hideCtx();
  });

  const search = $('msgr-search') as HTMLInputElement | null;
  search?.addEventListener('input', () => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void runSearch(search.value), 250);
  });

  const results = $('msgr-search-results');
  results?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.msgr-search-hit') as HTMLElement | null;
    const id = btn?.getAttribute('data-user-id');
    if (id) void startDm(id);
  });

  const form = $('msgr-form') as HTMLFormElement | null;
  const input = $('msgr-input') as HTMLTextAreaElement | null;
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!input) return;
    const text = input.value;
    input.value = '';
    input.style.height = '';
    void sendMessage(text);
  });
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form?.requestSubmit();
    }
  });
  input?.addEventListener('input', () => {
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(160, input.scrollHeight)}px`;
    if (input.value.trim()) scheduleTypingPulse();
  });

  $('msgr-new-group')?.addEventListener('click', () => void createGroup());
  $('msgr-browse-users')?.addEventListener('click', () => setRailTab('users'));
  $('msgr-retry')?.addEventListener('click', () => void ensureMessengerTab(true));

  $('msgr-tab-chats')?.addEventListener('click', () => setRailTab('chats'));
  $('msgr-tab-friends')?.addEventListener('click', () => setRailTab('friends'));
  $('msgr-tab-worlds')?.addEventListener('click', () => {
    setRailTab('worlds');
    void ensureLanWatch().then(() => renderWorldsList());
  });
  $('msgr-profile-tab-info')?.addEventListener('click', () => setProfilePanelTab('info'));
  $('msgr-profile-tab-members')?.addEventListener('click', () => setProfilePanelTab('members'));
  $('msgr-profile-tab-media')?.addEventListener('click', () => setProfilePanelTab('media'));
  $('msgr-profile-media-grid')?.addEventListener('click', (e) => {
    const mediaBtn = (e.target as HTMLElement).closest('[data-msgr-media]') as HTMLElement | null;
    const mediaKind = mediaBtn?.getAttribute('data-msgr-media');
    const mediaMsgId = mediaBtn?.getAttribute('data-msg-id');
    if (mediaMsgId && (mediaKind === 'image' || mediaKind === 'video')) {
      e.preventDefault();
      openMediaViewer(mediaMsgId, mediaKind);
    }
  });
  // Начальное положение pill у «Чаты»
  $('msgr-rail-tabs')?.setAttribute('data-active', 'chats');
  $('msgr-rail-pages')?.setAttribute('data-dir', 'right');
  $('msgr-chat-list')?.classList.add('is-active');
  const friendsInit = $('msgr-friends-list');
  if (friendsInit) {
    friendsInit.hidden = false;
    friendsInit.classList.remove('is-active');
  }
  const worldsInit = $('msgr-worlds-list');
  if (worldsInit) {
    worldsInit.hidden = false;
    worldsInit.classList.remove('is-active');
  }
  const usersInit = $('msgr-users-list');
  if (usersInit) {
    usersInit.hidden = false;
    usersInit.classList.remove('is-active');
  }

  // Делегирование: панель хоста и список миров перерисовываются динамически
  $('msgr-worlds-list')?.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('#msgr-share-lan')) {
      void shareLanWithFriends();
      return;
    }
    if (t.closest('#msgr-share-rescan')) {
      void ensureLanWatch().then(() => {
        updateSharePanel();
        if (lastDetectedLanPort) {
          toast(host?.t('msgr.lanPortFound', { port: String(lastDetectedLanPort) }) || '');
        } else {
          toast(host?.t('msgr.shareNeedLan') || '');
        }
      });
      return;
    }
    if (t.closest('#msgr-share-stop')) {
      void stopHostRelayShare();
      return;
    }
    const copyHost = t.closest('#msgr-share-copy, #msgr-share-addr') as HTMLElement | null;
    if (copyHost) {
      const addr =
        copyHost.getAttribute('data-share-addr') ||
        (hostRelaySession ? `${hostRelaySession.publicHost}:${hostRelaySession.publicPort}` : '');
      void copyText(addr);
      return;
    }
    const actBtn = t.closest('[data-world-act]') as HTMLElement | null;
    if (!actBtn) return;
    const act = actBtn.getAttribute('data-world-act');
    if (act === 'copy') {
      void copyText(actBtn.getAttribute('data-world-addr') || '');
      return;
    }
    if (act === 'join') {
      const userId = actBtn.getAttribute('data-world-user') || '';
      if (userId) void joinFriendWorld(userId);
    }
  });

  $('msgr-presence')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if ($('msgr-presence')?.classList.contains('is-connecting')) return;
    const menu = $('msgr-presence-menu');
    setPresenceMenuOpen(!!menu?.classList.contains('hidden'));
  });
  $('msgr-presence-menu')?.addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest('[data-presence]') as HTMLElement | null;
    const status = item?.getAttribute('data-presence');
    if (status === 'online' || status === 'busy' || status === 'dnd' || status === 'offline') {
      void setMyPresenceStatus(status);
    }
  });
  document.addEventListener('click', (e) => {
    const wrap = $('msgr-presence')?.closest('.msgr-presence-wrap');
    if (wrap && wrap.contains(e.target as Node)) return;
    setPresenceMenuOpen(false);
  });

  $('msgr-friends-list')?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-friend-act]') as HTMLElement | null;
    const act = btn?.getAttribute('data-friend-act');
    const userId = btn?.getAttribute('data-user-id') || '';
    if (!act) return;
    void (async () => {
      if (act === 'show-blocked') {
        railTab = 'blocked';
        await refreshFriendsRail();
        return;
      }
      if (act === 'back-friends') {
        setRailTab('friends');
        return;
      }
      if (act === 'write' && userId) {
        await startDm(userId);
        return;
      }
      if (act === 'profile' && userId) {
        await openProfileByUserId(userId);
        return;
      }
      if (act === 'accept' && userId) {
        const res = await req(`/friends/${encodeURIComponent(userId)}/accept`, { method: 'POST', body: {} });
        if (res?.ok) toast(host!.t('msgr.friendAcceptedOk'));
        else toast(host!.t('msgr.friendFailed', { msg: res?.error || '' }));
        await refreshFriendsRail();
        return;
      }
      if ((act === 'decline' || act === 'cancel') && userId) {
        const res =
          act === 'decline'
            ? await req(`/friends/${encodeURIComponent(userId)}/decline`, { method: 'POST', body: {} })
            : await req(`/friends/${encodeURIComponent(userId)}`, { method: 'DELETE' });
        if (res?.ok) toast(host!.t('msgr.friendDeclinedOk'));
        else toast(host!.t('msgr.friendFailed', { msg: res?.error || '' }));
        await refreshFriendsRail();
        return;
      }
      if (act === 'unblock' && userId) {
        const res = await req(`/users/${encodeURIComponent(userId)}/block`, { method: 'DELETE', body: {} });
        if (res?.ok) toast(host!.t('msgr.unblockedOk'));
        else toast(host!.t('msgr.unblockFailed', { msg: res?.error || '' }));
        await refreshFriendsRail();
      }
    })();
  });

  $('msgr-users-list')?.addEventListener('click', (e) => {
    const dirBtn = (e.target as HTMLElement).closest('[data-user-dir-act]') as HTMLElement | null;
    const dirAct = dirBtn?.getAttribute('data-user-dir-act');
    if (dirAct === 'back-chats') {
      setRailTab('chats');
      return;
    }
    const btn = (e.target as HTMLElement).closest('[data-friend-act]') as HTMLElement | null;
    const act = btn?.getAttribute('data-friend-act');
    const userId = btn?.getAttribute('data-user-id') || '';
    if (!act || !userId) return;
    void (async () => {
      if (act === 'write') await startDm(userId);
      else if (act === 'profile') await openProfileByUserId(userId);
    })();
  });

  // ===== Вложения: меню «+», чипы, скачивание / открытие =====
  const attachBtn = $('msgr-attach');
  attachBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const menu = $('msgr-attach-menu');
    const open = menu?.classList.contains('is-open');
    setAttachMenuOpen(!open);
  });
  $('msgr-attach-menu')?.addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest('[data-msgr-attach]') as HTMLElement | null;
    const kind = item?.getAttribute('data-msgr-attach');
    if (kind === 'file') void pickMessengerFiles();
    if (kind === 'media') void pickMessengerFiles({ media: true });
    if (kind === 'build') {
      setAttachMenuOpen(false);
      void shareBuildFromChat();
    }
    if (kind === 'world') {
      setAttachMenuOpen(false);
      void shareWorldFromChat();
    }
  });
  $('msgr-attach-chips')?.addEventListener('click', (e) => {
    const chip = (e.target as HTMLElement).closest('[data-pending-idx]') as HTMLElement | null;
    const idx = Number(chip?.getAttribute('data-pending-idx'));
    if (!Number.isFinite(idx) || idx < 0) return;
    pendingFiles.splice(idx, 1);
    renderPendingFiles();
  });
  messagesEl?.addEventListener('click', (e) => {
    const inviteAct = (e.target as HTMLElement).closest('[data-invite-act]') as HTMLElement | null;
    if (inviteAct) {
      e.preventDefault();
      e.stopPropagation();
      const act = inviteAct.getAttribute('data-invite-act');
      const msgId = inviteAct.getAttribute('data-msg-id') || '';
      const msg = messages.find((m) => m.id === msgId);
      const inv =
        inviteFromMeta(msg?.meta as Record<string, unknown> | null, {
          id: msg?.senderId || '',
          username: '',
        }) || lastGameInvite;
      if (!inv) return;
      if (act === 'copy') {
        void copyText(inviteAct.getAttribute('data-invite-addr') || inviteAddress(inv));
        return;
      }
      if (act === 'join') void joinFromInvite(inv);
      if (act === 'build' && inv.shareId && host?.openInstanceShare) {
        void host.openInstanceShare(inv.shareId);
      }
      return;
    }
    const mediaBtn = (e.target as HTMLElement).closest('[data-msgr-media]') as HTMLElement | null;
    const mediaKind = mediaBtn?.getAttribute('data-msgr-media');
    const mediaMsgId = mediaBtn?.getAttribute('data-msg-id');
    if (mediaMsgId && (mediaKind === 'image' || mediaKind === 'video')) {
      e.preventDefault();
      openMediaViewer(mediaMsgId, mediaKind);
      return;
    }
    const btn = (e.target as HTMLElement).closest('[data-file-act]') as HTMLElement | null;
    const file = btn?.closest('.msgr-file') as HTMLElement | null;
    const msgId = file?.getAttribute('data-msg-id');
    const act = btn?.getAttribute('data-file-act');
    if (msgId && act) void handleFileAction(msgId, act);
  });

  // ===== Просмотр фото/видео =====
  $('msgr-media-close')?.addEventListener('click', closeMediaViewer);
  $('modal-msgr-media')?.addEventListener('click', (e) => {
    if (e.target === $('modal-msgr-media')) closeMediaViewer();
  });
  $('msgr-media-zoom-in')?.addEventListener('click', () => setMediaViewerZoom(mediaViewerZoom + 0.25));
  $('msgr-media-zoom-out')?.addEventListener('click', () => setMediaViewerZoom(mediaViewerZoom - 0.25));
  $('msgr-media-zoom-reset')?.addEventListener('click', () => setMediaViewerZoom(1));
  $('msgr-media-stage')?.addEventListener(
    'wheel',
    (e) => {
      if (mediaViewerKind !== 'image') return;
      e.preventDefault();
      const dy = (e as WheelEvent).deltaY;
      setMediaViewerZoom(mediaViewerZoom + (dy < 0 ? 0.1 : -0.1));
    },
    { passive: false },
  );
  const mediaVideo = $('msgr-media-video') as HTMLVideoElement | null;
  const mediaSeek = $('msgr-media-seek') as HTMLInputElement | null;
  const mediaTime = $('msgr-media-time');
  const mediaPlay = $('msgr-media-play');
  const mediaMute = $('msgr-media-mute');
  const syncVideoUi = () => {
    if (!mediaVideo) return;
    if (mediaSeek && mediaVideo.duration) {
      mediaSeek.value = String(Math.round((mediaVideo.currentTime / mediaVideo.duration) * 1000));
    }
    if (mediaTime) {
      mediaTime.textContent = `${formatMediaTime(mediaVideo.currentTime)} / ${formatMediaTime(mediaVideo.duration || 0)}`;
    }
    if (mediaPlay) {
      mediaPlay.innerHTML = mediaVideo.paused
        ? '<svg width="14" height="14" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M3 1.5v9l7-4.5L3 1.5z" fill="currentColor"/></svg>'
        : '<svg width="14" height="14" viewBox="0 0 12 12" fill="none" aria-hidden="true"><rect x="2.5" y="2" width="2.5" height="8" rx="0.5" fill="currentColor"/><rect x="7" y="2" width="2.5" height="8" rx="0.5" fill="currentColor"/></svg>';
    }
  };
  mediaVideo?.addEventListener('timeupdate', syncVideoUi);
  mediaVideo?.addEventListener('loadedmetadata', syncVideoUi);
  mediaVideo?.addEventListener('play', syncVideoUi);
  mediaVideo?.addEventListener('pause', syncVideoUi);
  mediaPlay?.addEventListener('click', () => {
    if (!mediaVideo) return;
    if (mediaVideo.paused) void mediaVideo.play();
    else mediaVideo.pause();
  });
  mediaSeek?.addEventListener('input', () => {
    if (!mediaVideo || !mediaVideo.duration) return;
    mediaVideo.currentTime = (Number(mediaSeek.value) / 1000) * mediaVideo.duration;
  });
  mediaMute?.addEventListener('click', () => {
    if (!mediaVideo) return;
    mediaVideo.muted = !mediaVideo.muted;
    mediaMute.classList.toggle('is-muted', mediaVideo.muted);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!isMessengerTabActive()) return;

    // Слоями: медиа → профиль → инвайт → контекст/меню → ответ → свернуть чат
    if (isMsgrOverlayVisible('modal-msgr-media')) {
      e.preventDefault();
      closeMediaViewer();
      return;
    }
    if (isMsgrOverlayVisible('modal-msgr-profile')) {
      e.preventDefault();
      closeProfileModal();
      return;
    }
    if (isMsgrOverlayVisible('modal-msgr-invite')) {
      e.preventDefault();
      closeGroupInviteModal();
      return;
    }

    const ctx = $('msgr-ctx');
    if (ctx && !ctx.classList.contains('hidden')) {
      e.preventDefault();
      hideCtx();
      return;
    }

    const attachMenu = $('msgr-attach-menu');
    if (attachMenu && !attachMenu.classList.contains('hidden')) {
      e.preventDefault();
      setAttachMenuOpen(false);
      return;
    }

    const presenceMenu = $('msgr-presence-menu');
    if (presenceMenu && !presenceMenu.classList.contains('hidden')) {
      e.preventDefault();
      setPresenceMenuOpen(false);
      return;
    }

    if (replyTo) {
      e.preventDefault();
      setReplyTo(null);
      return;
    }

    if (activeId) {
      e.preventDefault();
      collapseActiveChat();
    }
  });
  document.addEventListener('click', (e) => {
    const wrap = $('msgr-attach')?.closest('.msgr-attach-wrap') || $('msgr-attach')?.closest('.ai-attach-wrap');
    if (wrap && wrap.contains(e.target as Node)) return;
    setAttachMenuOpen(false);
  });

  $('msgr-invite-close')?.addEventListener('click', closeGroupInviteModal);
  $('msgr-invite-decline')?.addEventListener('click', closeGroupInviteModal);
  $('msgr-invite-join')?.addEventListener('click', () => void acceptGroupInvite());
  $('modal-msgr-invite')?.addEventListener('click', (e) => {
    if (e.target === $('modal-msgr-invite')) closeGroupInviteModal();
  });
}

function startPolling(): void {
  stopPolling();
  pollTimer = setInterval(() => {
    if (document.hidden) return;
    void loadConversations();
    if (activeId) void loadMessages(activeId);
    void ensureLanWatch().then(() => {
      if (railTab === 'worlds') renderWorldsList();
      else updateSharePanel();
    });
    if (railTab === 'worlds') void refreshWorldsRail();
  }, POLL_FALLBACK_MS);
}

function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

let inviteJoinToken: string | null = null;

function closeGroupInviteModal(): void {
  inviteJoinToken = null;
  closeOverlay('modal-msgr-invite');
  $('modal-msgr-invite')?.setAttribute('aria-hidden', 'true');
}

/** Открыть модалку приглашения в группу по токену (deep link / браузер → клиент). */
export async function openGroupInviteModal(token: string): Promise<void> {
  if (!host) return;
  const clean = String(token || '').trim();
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(clean)) {
    toast(host.t('msgr.inviteInvalid'));
    return;
  }
  if (!sessionToken) {
    await ensureMessengerTab(true);
  }
  if (!sessionToken) {
    toast(host.t('msgr.inviteNeedAccount'));
    return;
  }
  inviteJoinToken = clean;
  const titleEl = $('msgr-invite-title');
  const bodyEl = $('msgr-invite-body');
  const avatarEl = $('msgr-invite-avatar');
  const joinBtn = $('msgr-invite-join') as HTMLButtonElement | null;
  if (titleEl) titleEl.textContent = '…';
  if (bodyEl) bodyEl.textContent = host.t('msgr.inviteLoading');
  if (avatarEl) avatarEl.innerHTML = '';
  if (joinBtn) joinBtn.disabled = true;
  openOverlay('modal-msgr-invite');
  $('modal-msgr-invite')?.setAttribute('aria-hidden', 'false');

  const res = await req(`/invites/${encodeURIComponent(clean)}`);
  if (!res?.ok || !res.data?.invite) {
    if (titleEl) titleEl.textContent = host.t('msgr.inviteInvalid');
    if (bodyEl) bodyEl.textContent = host.t('msgr.inviteInvalidHint');
    return;
  }
  const inv = res.data.invite as {
    title: string;
    avatarUrl?: string | null;
    alreadyMember?: boolean;
    inviter?: { username?: string } | null;
    conversationId?: string;
  };
  if (titleEl) titleEl.textContent = inv.title || host.t('msgr.group');
  const nick = inv.inviter?.username || host.t('msgr.inviteSomeone');
  if (bodyEl) bodyEl.textContent = host.t('msgr.inviteBody', { name: nick });
  if (avatarEl) {
    if (inv.avatarUrl) {
      avatarEl.innerHTML = `<img class="msgr-avatar__photo" src="${host.escapeHtml(resolveMsgrMediaUrl(inv.avatarUrl))}" alt="">`;
    } else {
      avatarEl.innerHTML = `<span class="msgr-avatar__fallback">${host.escapeHtml((inv.title || '?').slice(0, 1))}</span>`;
    }
  }
  if (inv.alreadyMember && inv.conversationId) {
    if (joinBtn) {
      joinBtn.disabled = false;
      joinBtn.textContent = host.t('msgr.inviteOpenChat');
    }
    inviteJoinToken = `open:${inv.conversationId}`;
    return;
  }
  if (joinBtn) {
    joinBtn.disabled = false;
    joinBtn.textContent = host.t('msgr.inviteJoin');
  }
}

async function acceptGroupInvite(): Promise<void> {
  if (!host || !inviteJoinToken) return;
  if (inviteJoinToken.startsWith('open:')) {
    const id = inviteJoinToken.slice(5);
    closeGroupInviteModal();
    await openConversation(id);
    return;
  }
  const token = inviteJoinToken;
  const joinBtn = $('msgr-invite-join') as HTMLButtonElement | null;
  if (joinBtn) joinBtn.disabled = true;
  const res = await req(`/invites/${encodeURIComponent(token)}/join`, { method: 'POST', body: {} });
  if (!res?.ok || !res.data?.conversation) {
    toast(host.t('msgr.inviteJoinFailed', { msg: res?.error || res?.code || '' }));
    if (joinBtn) joinBtn.disabled = false;
    return;
  }
  const conv = res.data.conversation as MessengerConversation;
  closeGroupInviteModal();
  toast(host.t('msgr.inviteJoinedOk'));
  await loadConversations();
  await openConversation(conv.id);
}

export async function ensureMessengerTab(force = false): Promise<void> {
  if (!host) return;
  if (!inited) {
    bindUi();
    bindGameRelayEvents();
    inited = true;
  }

  const account = host.getAccount();
  const type = String(account?.meta?.type || account?.type || '').toLowerCase();
  const nextKey = accountCacheKey(account);
  if (type !== 'msa' && type !== 'yggdrasil') {
    persistAccountCache();
    me = null;
    sessionToken = null;
    boundAccountKey = null;
    disconnectStream();
    stopPolling();
    conversations = [];
    messages = [];
    activeId = null;
    updateMessengerTabBadge();
    setGate('need-account');
    return;
  }

  // Смена аккаунта: сохраняем кеш предыдущего и поднимаем кеш нового
  if (boundAccountKey && nextKey && boundAccountKey !== nextKey) {
    persistAccountCache();
    disconnectStream();
    stopPolling();
    await host.api.messengerLogout?.();
    sessionToken = null;
    me = null;
    restoreAccountCache(nextKey);
    boundAccountKey = nextKey;
    renderConversationList();
    renderPeerHeader();
    renderMessages();
    updateMessengerTabBadge();
  } else if (!boundAccountKey && nextKey) {
    restoreAccountCache(nextKey);
    boundAccountKey = nextKey;
    renderConversationList();
    renderPeerHeader();
    renderMessages();
    updateMessengerTabBadge();
  }

  // Уже в сети для этого аккаунта — не рвём SSE и не мигаем «Подключение…»
  const sameAccount = Boolean(boundAccountKey && nextKey && boundAccountKey === nextKey);
  if (
    !force &&
    sameAccount &&
    sessionToken &&
    me &&
    isStreamAlive()
  ) {
    setGate('ready');
    renderPresence(myPresenceStatus === 'offline' ? 'offline' : 'online');
    if (!pollTimer) startPolling();
    void loadConversations();
    if (activeId) {
      void loadMessages(activeId, { forceScrollBottom: !isMessagesThreadPainted() });
      renderPeerHeader();
    } else {
      renderPeerHeader();
    }
    updateSharePanel();
    return;
  }

  setGate('loading');
  renderPresence('connecting');
  if (host.refreshAccount) {
    try {
      await host.refreshAccount();
    } catch {
      /* ignore */
    }
  }
  const fresh = host.getAccount();
  if (!host.api.messengerSession) {
    setGate('error', host.t('msgr.errorHint'));
    return;
  }
  const session = await host.api.messengerSession(fresh);
  if (!session?.ok) {
    setGate(
      session?.code === 'account_required' ? 'need-account' : 'error',
      session?.error || host.t('msgr.errorHint'),
    );
    return;
  }
  me = session.user as MessengerUser;
  if (me?.presenceStatus) myPresenceStatus = normalizePresenceStatus(me.presenceStatus);
  sessionToken = String(session.token || '');
  boundAccountKey = accountCacheKey(fresh) || nextKey;
  setGate('ready');
  renderPresence(myPresenceStatus === 'offline' ? 'offline' : 'online');
  // Синхронизируем ручной статус на сервер (после кеша / смены аккаунта)
  if (sessionToken && myPresenceStatus) {
    void req('/presence', { method: 'POST', body: { status: myPresenceStatus } });
  }
  if (sessionToken) connectStream(sessionToken);
  await syncLauncherStats();
  await loadConversations();
  if (activeId) {
    // После сессии me появился — если лента ещё не в DOM, нарисовать и прокрутить вниз
    await loadMessages(activeId, { forceScrollBottom: true });
    renderPeerHeader();
  } else {
    renderPeerHeader();
  }
  updateSharePanel();
  startPolling();
}

/** Вызывать при смене аккаунта лаунчера — переключает сессию и кеш чатов */
export async function notifyMessengerAccountChanged(): Promise<void> {
  if (!host) return;
  if (!inited) {
    // Ещё не открывали мессенджер — всё равно сбросим IPC-сессию под новый аккаунт
    await host.api.messengerLogout?.();
    return;
  }
  await ensureMessengerTab(true);
}

async function syncLauncherStats(): Promise<void> {
  const stats = host?.getLauncherStats?.();
  if (!stats) return;
  const body: Record<string, unknown> = {};
  if (stats.favoriteBuild) {
    body.favoriteBuild = stats.favoriteBuild;
    body.favoriteBuildCount = stats.favoriteBuildCount ?? 0;
  }
  if (stats.lastBuild) {
    body.lastBuild = stats.lastBuild;
    body.lastBuildMeta = stats.lastBuildMeta || null;
  }
  if (stats.lastServer) {
    body.lastServer = stats.lastServer;
    body.lastServerMeta = stats.lastServerMeta || null;
  }
  if (!Object.keys(body).length) return;
  await req('/activity', { method: 'POST', body });
}

export function notifyMessengerGameStopped(): void {
  lastDetectedLanPort = null;
  void stopHostRelayShare();
  updateSharePanel();
}

export function initMessenger(h: MessengerHost): void {
  host = h;
}

export function disposeMessenger(): void {
  persistAccountCache();
  stopPolling();
  disconnectStream();
  unsubLanPort?.();
  unsubTunnel?.();
  unsubLanPort = null;
  unsubTunnel = null;
  void stopHostRelayShare();
  hideCtx();
  closeProfileModal();
  disposeProfileViewer();
  conversations = [];
  updateMessengerTabBadge();
}
