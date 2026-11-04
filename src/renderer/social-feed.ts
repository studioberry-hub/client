// ===== Социальная лента: Стена + новости лаунчера (newsRemaster) =====

import { getApiBase, skinImageUrl } from '../shared/apiBase';
import { isWornTexture, resolveWornSkinUrl, wornSkinProxyUrl } from './worn-skin';
import { openImageViewer } from './image-viewer';
import { isDirectVideoUrl, openVideoViewer } from './video-player';

export type SocialHost = {
  t: (key: string, vars?: Record<string, string | number>) => string;
  escapeHtml: (s: string) => string;
  renderMarkdown: (md: string) => string;
  showToast: (msg: string) => void;
  openModal: (id: string) => void;
  closeModal: (id: string) => void;
  getAccount: () => {
    username?: string;
    name?: string;
    uuid?: string;
    skinUrl?: string | null;
    uiAvatarDataUrl?: string | null;
    type?: string;
    meta?: { type?: string };
  } | null;
  resolveAvatarUrl?: (opts: {
    skinUrl?: string | null;
    uuid?: string | null;
    username?: string | null;
    provider?: string | null;
  }) => string;
  getSkinData?: (uuid: string) => Promise<{ skinUrl?: string | null } | null>;
  getElyWornSkin?: (nickname: string, force?: boolean) => Promise<string | null>;
  resolveNewsCoverUrl?: (url: string | null | undefined) => string;
  messengerRequest: (payload: {
    method?: string;
    path: string;
    body?: unknown;
    query?: Record<string, string | number | undefined>;
  }) => Promise<{ ok: boolean; data?: any; error?: string; code?: string }>;
  listNewsOfficial: () => Promise<
    Array<{
      id: string;
      title: string;
      summary?: string;
      content?: string;
      cover?: string;
      media?: Array<{ url?: string; type?: string; alt?: string }>;
      date?: string;
      views?: number;
    }>
  >;
  noteNewsView?: (id: string) => Promise<number | null>;
  openOfficialNews: (id: string) => void;
  listConversationsForRepost?: () => Promise<Array<{ id: string; title: string }>>;
  openUserProfile?: (username: string, userId?: string) => Promise<void>;
  confirm?: (message: string) => Promise<boolean>;
  renderOfficialNews?: (root: HTMLElement) => void;
  loadOfficialNews?: (force?: boolean) => Promise<void>;
};

type FeedPost = {
  id: string;
  bodyMd: string;
  title?: string | null;
  createdAt: number;
  pinned?: boolean;
  canDelete?: boolean;
  canReport?: boolean;
  reported?: boolean;
  attachments?: Array<{ id: string; url: string; mime?: string; type?: string; kind?: string }>;
  reactions?: { counts: Record<string, number>; mine: string[] };
  repostCount?: number;
  commentCount?: number;
  views?: number;
  repostOf?: FeedPost | null;
  officialId?: string;
  author?: {
    type: string;
    user?: {
      id: string;
      username: string;
      uuid?: string | null;
      skinUrl?: string | null;
      verified?: boolean;
      provider?: string | null;
    };
    clan?: { id: string; name: string; iconUrl?: string | null; verified?: boolean };
    name?: string;
  };
};

type FeedComment = {
  id: string;
  bodyMd: string;
  createdAt: number;
  parentId?: string | null;
  replyTo?: { id?: string; username?: string } | null;
  canDelete?: boolean;
  author?: {
    id?: string;
    username?: string;
    uuid?: string | null;
    skinUrl?: string | null;
    verified?: boolean;
    provider?: string | null;
  } | null;
};

type AvatarOpts = {
  skinUrl?: string | null;
  uuid?: string | null;
  username?: string | null;
  provider?: string | null;
};

const ICON = {
  like: '../../assets/icons/newFeedPage/like.svg',
  likeActive: '../../assets/icons/newFeedPage/liked.svg',
  comment: '../../assets/icons/newFeedPage/comment.svg',
  repost: '../../assets/icons/newFeedPage/repost.svg',
  views: '../../assets/icons/newFeedPage/views.svg',
  report: '../../assets/icons/newFeedPage/report.svg',
  favorite: '../../assets/icons/newFeedPage/favorite.svg',
  trending: '../../assets/icons/newFeedPage/tranding.svg',
  hashtag: '../../assets/icons/newFeedPage/recommended.svg',
  who: '../../assets/icons/newFeedPage/who-read.svg',
  verify: '../../assets/icons/verify.svg',
};

const CLAN_FALLBACK_AVATAR = '../../assets/icons/undefinedacc.svg';
const STUDIO_NAME = 'Undefined Studio';
const STUDIO_AVATAR =
  'https://uprojects.site/client/api/messenger/avatars/91c843c7-3252-49d2-93ab-70d314cffbe3.png?v=1790685036005';

const SEND_SVG = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M7 12V2M7 2L3 6M7 2L11 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const MENU_SVG = `<svg width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden="true"><circle cx="10" cy="18" r="2" fill="currentColor"/><circle cx="18" cy="18" r="2" fill="currentColor"/><circle cx="26" cy="18" r="2" fill="currentColor"/></svg>`;

const CAROUSEL_PREV_SVG = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M11 3.5L5.5 9L11 14.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CAROUSEL_NEXT_SVG = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M7 3.5L12.5 9L7 14.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

let host: SocialHost | null = null;
let communityPosts: FeedPost[] = [];
let myClans: Array<{ id: string; name: string }> = [];
let pendingJpegs: string[] = [];
let pendingClanIcon = '';
let bound = false;
let activePostId = '';
let replyParentId = '';
let replyParentName = '';
let repostPostId = '';
let repostTab: 'wall' | 'chats' = 'wall';
let mentionHideTimer: ReturnType<typeof setTimeout> | null = null;
let newsView: 'community' | 'official' = 'community';
type FeedTab = 'recommend' | 'following' | 'articles';
let feedTab: FeedTab = 'recommend';
let popularPeriod: '7' | '30' | 'all' = '7';
let feedQuery = '';
let followingIds: string[] = [];
let followingKnown = false;
let feedReady = false;
let postingBanned = false;
type SuggestUser = {
  id: string;
  username: string;
  followerCount?: number;
  skinUrl?: string | null;
  uuid?: string | null;
  provider?: string | null;
  verified?: boolean;
};
let suggestions: SuggestUser[] = [];

function $(id: string) {
  return document.getElementById(id);
}

function absMedia(url: string | null | undefined): string {
  const u = String(url || '').trim();
  if (!u) return '';
  if (u.startsWith('http://') || u.startsWith('https://') || u.startsWith('data:')) {
    return skinImageUrl(u) || u;
  }
  const base = getApiBase().replace(/\/$/, '');
  if (u.startsWith('/client/')) return `${base.replace(/\/client$/, '')}${u}`;
  // Аватары чатов Messenger
  if (u.startsWith('/api/messenger/')) {
    return `${base}${u}`;
  }
  if (u.startsWith('/')) return `${base}${u}`;
  return u;
}

// ===== Аватары: голова с надетой текстуры Mojang / Ely, не с кэша mc-heads =====
const avatarCache = new Map<string, string>();
const avatarInflight = new Map<string, Promise<string>>();

function toHttps(u: string): string {
  return String(u || '').replace(/^http:\/\//i, 'https://');
}

function avatarKey(opts: AvatarOpts): string {
  const id = String(opts.uuid || '')
    .replace(/-/g, '')
    .toLowerCase();
  if (id.length >= 32) return `u:${id}`;
  const name = String(opts.username || '')
    .trim()
    .toLowerCase();
  if (name) return `n:${name}`;
  const skin = toHttps(String(opts.skinUrl || '').trim());
  if (skin) return `s:${skin}`;
  return '';
}

function isElyAvatar(opts: AvatarOpts): boolean {
  const p = String(opts.provider || '').toLowerCase();
  if (p === 'ely' || p === 'yggdrasil') return true;
  const skin = String(opts.skinUrl || '');
  return /skinsystem\.ely\.by|ely\.by\/storage/i.test(skin);
}

function steveHeadUrl(): string {
  const direct = 'https://mc-heads.net/avatar/MHF_Steve/64';
  return skinImageUrl(direct) || direct;
}

// Повторный запрос с другим query, иначе браузер отдаёт текстуру из кэша без CORS и холст портится.
function corsSkinSrc(url: string): string {
  if (!url || url.startsWith('data:') || url.startsWith('blob:')) return url;
  if (/[?&]sf_cors=1(?:&|$)/.test(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}sf_cors=1`;
}

function cropSkinHead(skinUrl: string, size = 64): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const w = img.naturalWidth || img.width;
        const hImg = img.naturalHeight || img.height;
        if (w < 64 || w % 64 !== 0) {
          resolve(null);
          return;
        }
        const scale = w / 64;
        const rows = hImg / scale;
        if (Math.abs(rows - 64) > 0.5 && Math.abs(rows - 32) > 0.5) {
          resolve(null);
          return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.imageSmoothingEnabled = false;
        const face = 8 * scale;
        ctx.drawImage(img, 8 * scale, 8 * scale, face, face, 0, 0, size, size);
        ctx.drawImage(img, 40 * scale, 8 * scale, face, face, 0, 0, size, size);
        resolve(canvas.toDataURL('image/png'));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = corsSkinSrc(skinUrl);
  });
}

function applyAvatarInDom(key: string, url: string): void {
  if (!key || !url) return;
  document.querySelectorAll('img[data-sf-avatar]').forEach((el) => {
    if (!(el instanceof HTMLImageElement)) return;
    if (el.getAttribute('data-sf-avatar') !== key) return;
    if (el.getAttribute('src') !== url) el.src = url;
  });
}

function ensureAvatarCrop(key: string, skinSrc: string): void {
  if (!key || !skinSrc || avatarCache.has(key) || avatarInflight.has(key)) return;
  const task = cropSkinHead(skinSrc)
    .then((cropped) => {
      const url = cropped || steveHeadUrl();
      avatarCache.set(key, url);
      return url;
    })
    .finally(() => {
      avatarInflight.delete(key);
    });
  avatarInflight.set(key, task);
  void task.then((url) => applyAvatarInDom(key, url));
}

function isLicenseOrEly(opts: AvatarOpts): boolean {
  const p = String(opts.provider || '').toLowerCase();
  if (p === 'msa' || p === 'ely' || p === 'yggdrasil') return true;
  return isElyAvatar(opts);
}

/** Если в профиле нет своей текстуры — спрашиваем Mojang / Ely и кропаем голову. */
function scheduleWornAvatar(key: string, opts: AvatarOpts): void {
  if (!key || avatarCache.has(key) || avatarInflight.has(key)) return;
  const task = resolveWornSkinUrl(opts, {
    getMojangSkin: host?.getSkinData,
    getElyWornSkin: host?.getElyWornSkin,
  })
    .then(async (texture) => {
      if (!texture) return '';
      const src = wornSkinProxyUrl(texture);
      const cropped = await cropSkinHead(src);
      const url = cropped || steveHeadUrl();
      avatarCache.set(key, url);
      return url;
    })
    .finally(() => {
      avatarInflight.delete(key);
    });
  avatarInflight.set(key, task);
  void task.then((url) => {
    if (url) applyAvatarInDom(key, url);
  });
}

function accountProvider(acc: ReturnType<NonNullable<SocialHost['getAccount']>>): string {
  const t = String(acc?.meta?.type || acc?.type || '').toLowerCase();
  if (t === 'yggdrasil' || t === 'ely') return 'ely';
  if (t === 'msa') return 'msa';
  return t;
}

function resolveAvatar(opts: AvatarOpts): string {
  const acc = host?.getAccount?.() || null;
  const selfProvider = accountProvider(acc);
  const aUuid = String(acc?.uuid || '')
    .replace(/-/g, '')
    .toLowerCase();
  const oUuid = String(opts.uuid || '')
    .replace(/-/g, '')
    .toLowerCase();
  const aName = String(acc?.username || acc?.name || '')
    .trim()
    .toLowerCase();
  const oName = String(opts.username || '')
    .trim()
    .toLowerCase();
  const isSelf = Boolean(
    (oUuid && aUuid && oUuid === aUuid) || (oName && aName && oName === aName),
  );

  // Уже нарезанная голова текущего аккаунта
  if (isSelf && acc?.uiAvatarDataUrl) {
    return acc.uiAvatarDataUrl;
  }

  const provider = String(opts.provider || (isSelf ? selfProvider : '') || '').toLowerCase();
  const merged: AvatarOpts = { ...opts, provider };
  const key = avatarKey(merged);

  if (key && avatarCache.has(key)) {
    return avatarCache.get(key)!;
  }

  // Лицензия и Ely: голова с надетой текстуры. mc-heads здесь рисует чужого Steve.
  if (isLicenseOrEly(merged)) {
    const stored = toHttps(String(merged.skinUrl || ''));
    if (isWornTexture(stored)) {
      const src = wornSkinProxyUrl(stored);
      if (key) ensureAvatarCrop(key, src);
      // Пока голова не вырезана, не показываем лист скина целиком.
      return (key && avatarCache.get(key)) || '';
    }
    if (key) scheduleWornAvatar(key, merged);
    return (key && avatarCache.get(key)) || '';
  }

  if (host?.resolveAvatarUrl) {
    const custom = host.resolveAvatarUrl(merged);
    if (custom) return custom;
  }

  if (oUuid.length >= 32) {
    const direct = `https://mc-heads.net/avatar/${oUuid}/64`;
    return skinImageUrl(direct) || direct;
  }
  if (oName) {
    const direct = `https://mc-heads.net/avatar/${encodeURIComponent(oName)}/64`;
    return skinImageUrl(direct) || direct;
  }
  const skin = toHttps(String(opts.skinUrl || '').trim());
  if (skin && !/textures\.minecraft\.net/i.test(skin)) {
    if (/\.png(\?|$)/i.test(skin) && key) {
      const proxied = skinImageUrl(skin) || skin;
      ensureAvatarCrop(key, proxied);
      return avatarCache.get(key) || proxied;
    }
    return skinImageUrl(skin) || skin;
  }
  const fallback = 'https://mc-heads.net/avatar/steve/64';
  return skinImageUrl(fallback) || fallback;
}

/** src + data-sf-avatar для асинхронной подмены после кропа */
const AVATAR_BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** Пока файл не декодирован, на img не ставим адрес: иначе Chromium рисует рамку битой картинки. */
function showAvatar(el: HTMLImageElement, src: string): void {
  const next = String(src || '').trim();
  if (!next || next === AVATAR_BLANK) {
    el.classList.add('msgr-avatar__skeleton');
    if (el.getAttribute('src') !== AVATAR_BLANK) el.src = AVATAR_BLANK;
    delete el.dataset.pendingSrc;
    return;
  }
  if (el.getAttribute('src') === next && !el.classList.contains('msgr-avatar__skeleton')) return;
  if (el.dataset.pendingSrc === next) return;
  el.dataset.pendingSrc = next;
  el.classList.add('msgr-avatar__skeleton');
  const pre = new Image();
  pre.onload = () => {
    if (!el.isConnected || el.dataset.pendingSrc !== next) return;
    el.src = next;
    delete el.dataset.pendingSrc;
    if (pre.naturalWidth > 1) el.classList.remove('msgr-avatar__skeleton');
  };
  pre.onerror = () => {
    if (el.dataset.pendingSrc === next) delete el.dataset.pendingSrc;
    el.classList.add('msgr-avatar__skeleton');
  };
  pre.src = next;
}

/** Шиммер на кадре, пока картинка или ролик не готовы, затем плавное появление. */
function armContentFrames(root: ParentNode): void {
  const frames: Element[] = [];
  if (root instanceof Element && root.classList.contains('uc-frame')) frames.push(root);
  root.querySelectorAll('.uc-frame').forEach((node) => frames.push(node));
  frames.forEach((node) => {
    if (!(node instanceof HTMLElement) || node.classList.contains('is-ready')) return;
    const media = node.querySelector('img, video');
    const done = () => node.classList.add('is-ready');
    if (media instanceof HTMLImageElement && media.complete) {
      done();
      return;
    }
    if (media instanceof HTMLVideoElement && media.readyState >= 2) {
      done();
      return;
    }
    media?.addEventListener('load', done, { once: true });
    media?.addEventListener('loadeddata', done, { once: true });
    media?.addEventListener('error', done, { once: true });
  });
}

function commentSkeletonHtml(): string {
  const row = `<div class="sf-skel__rail-row"><div class="sf-skel__ava"></div><div class="sf-skel__who"><div class="sf-skel__bar sf-skel__bar--name"></div><div class="sf-skel__bar sf-skel__bar--line"></div></div></div>`;
  return `<div class="sf-skel sf-skel--plain" aria-hidden="true">${row}${row}${row}</div>`;
}

function avatarImgBits(opts: AvatarOpts): { src: string; attr: string } {
  const key = avatarKey(opts);
  const url = resolveAvatar(opts);
  const src = url || AVATAR_BLANK;
  const attr = key && host ? ` data-sf-avatar="${host.escapeHtml(key)}"` : '';
  return { src, attr };
}

function formatPostDate(ts: number): string {
  const then = Number(ts || 0);
  if (!then) return '';
  const d = new Date(then);
  if (!Number.isFinite(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${dd}.${mo}.${d.getFullYear()} в ${hh}:${mm}`;
}

function timeAgo(ts: number): string {
  const then = Number(ts || 0);
  if (!then) return '';
  const diff = Math.max(0, Date.now() - then);
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'только что';
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч`;
  const d = new Date(then);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate()
  ) {
    return `вчера в ${hh}:${mm}`;
  }
  if (diff < 7 * 24 * 60 * 60 * 1000) {
    return `${Math.floor(diff / (24 * 60 * 60 * 1000))} д`;
  }
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}

function verifiedHtml(on: boolean): string {
  if (!on) return '';
  return `<img class="sf-post__verified" src="${ICON.verify}" width="18" height="18" alt="" title="Verified" aria-hidden="true">`;
}

function authorBits(post: FeedPost) {
  if (post.author?.type === 'clan' && post.author.clan) {
    const clanIcon = absMedia(post.author.clan.iconUrl);
    return {
      name: post.author.clan.name,
      avatar: clanIcon || CLAN_FALLBACK_AVATAR,
      avatarAttr: '',
      verified: Boolean(post.author.clan.verified),
      isClan: true,
      profile: '',
      userId: '',
    };
  }
  if (post.author?.type === 'launcher') {
    return {
      name: post.author.name || STUDIO_NAME,
      avatar: STUDIO_AVATAR,
      avatarAttr: '',
      verified: true,
      isClan: true,
      profile: '',
      userId: '',
    };
  }
  const u = post.author?.user;
  const bits = avatarImgBits({
    skinUrl: u?.skinUrl,
    uuid: u?.uuid,
    username: u?.username,
    provider: u?.provider,
  });
  return {
    name: u?.username || 'Игрок',
    avatar: bits.src,
    avatarAttr: bits.attr,
    verified: Boolean(u?.verified),
    isClan: false,
    profile: u?.username || '',
    userId: u?.id || '',
  };
}

function profileAttr(name: string | undefined | null, userId?: string | null): string {
  const clean = String(name || '').trim();
  const id = String(userId || '').trim();
  if ((!clean && !id) || !host) return '';
  const nameAttr = clean ? ` data-sf-profile="${host.escapeHtml(clean)}"` : '';
  const idAttr = id ? ` data-sf-user-id="${host.escapeHtml(id)}"` : '';
  return `${nameAttr}${idAttr}`;
}

function likeCount(post: FeedPost): number {
  const c = post.reactions?.counts || {};
  return Number(c['❤️'] || 0) + Number(c['👍'] || 0) + Number(c['🔥'] || 0);
}

function likedMine(post: FeedPost): boolean {
  const mine = post.reactions?.mine || [];
  return mine.includes('❤️') || mine.includes('👍') || mine.includes('🔥');
}

/** Ролик по mime или расширению. Картинки в эту проверку не попадают. */
function mediaIsVideo(a: { url?: string; mime?: string; type?: string; kind?: string }): boolean {
  const tag = String(a.mime || a.type || a.kind || '');
  if (/^video\//i.test(tag) || tag.toLowerCase() === 'video') return true;
  return isDirectVideoUrl(String(a.url || ''));
}

function videoThumbHtml(src: string): string {
  const esc = host!.escapeHtml(src);
  return `<button type="button" class="sf-video-thumb" data-sf-video="${esc}">
    <video src="${esc}" muted preload="metadata" playsinline></video>
    <span class="sf-video-thumb__badge" aria-hidden="true"><img src="../../assets/icons/videoPlayer/play.svg" alt="" width="16" height="16"></span>
  </button>`;
}

/** Карусель вложений: точки снизу, круглые стрелки слева/справа */
function renderMediaCarousel(
  attachments: Array<{ id?: string; url: string; mime?: string; type?: string; kind?: string }> | undefined,
  opts?: { className?: string; zoom?: boolean },
): string {
  if (!host) return '';
  const list = (attachments || []).filter((a) => String(a?.url || '').trim());
  if (!list.length) return '';
  const wrapClass = opts?.className || 'sf-post__media';
  const slides = list
    .map((a) => {
      const src = absMedia(a.url);
      const esc = host!.escapeHtml(src);
      if (mediaIsVideo(a) || mediaIsVideo({ url: src })) {
        return `<div class="sf-carousel__slide uc-frame">${videoThumbHtml(src)}</div>`;
      }
      const zoom = opts?.zoom ? ` data-sf-zoom="${esc}"` : '';
      return `<div class="sf-carousel__slide uc-frame"><img src="${esc}" alt=""${zoom}></div>`;
    })
    .join('');
  const multi = list.length > 1;
  const dots = multi
    ? `<div class="sf-carousel__dots" role="tablist">${list
        .map(
          (_, i) =>
            `<button type="button" class="sf-carousel__dot${i === 0 ? ' is-active' : ''}" data-sf-carousel-dot="${i}" aria-label="Фото ${i + 1}" role="tab"></button>`,
        )
        .join('')}</div>`
    : '';
  const nav = multi
    ? `<button type="button" class="sf-carousel__nav sf-carousel__nav--prev" data-sf-carousel-prev aria-label="Предыдущее фото">${CAROUSEL_PREV_SVG}</button>
       <button type="button" class="sf-carousel__nav sf-carousel__nav--next" data-sf-carousel-next aria-label="Следующее фото">${CAROUSEL_NEXT_SVG}</button>`
    : '';
  return `<div class="${wrapClass}">
    <div class="sf-carousel${multi ? ' is-multi' : ''}" data-sf-carousel data-index="0">
      <div class="sf-carousel__viewport">
        <div class="sf-carousel__track">${slides}</div>
      </div>
      ${nav}
      ${dots}
    </div>
  </div>`;
}

function setCarouselIndex(root: HTMLElement, nextIndex: number): void {
  const slides = root.querySelectorAll('.sf-carousel__slide');
  const n = slides.length;
  if (!n) return;
  const i = ((nextIndex % n) + n) % n;
  root.setAttribute('data-index', String(i));
  const track = root.querySelector('.sf-carousel__track') as HTMLElement | null;
  if (track) track.style.transform = `translateX(-${i * 100}%)`;
  root.querySelectorAll('.sf-carousel__dot').forEach((dot, di) => {
    dot.classList.toggle('is-active', di === i);
  });
}

function handleCarouselClick(t: HTMLElement, e: Event): boolean {
  const root = t.closest('[data-sf-carousel]') as HTMLElement | null;
  if (!root) return false;
  const prev = t.closest('[data-sf-carousel-prev]');
  const next = t.closest('[data-sf-carousel-next]');
  const dot = t.closest('[data-sf-carousel-dot]') as HTMLElement | null;
  if (!prev && !next && !dot) return false;
  e.preventDefault();
  e.stopPropagation();
  const cur = Number(root.getAttribute('data-index') || 0);
  if (prev) setCarouselIndex(root, cur - 1);
  else if (next) setCarouselIndex(root, cur + 1);
  else if (dot) setCarouselIndex(root, Number(dot.getAttribute('data-sf-carousel-dot') || 0));
  return true;
}

// Хештег не должен становиться заголовком Markdown и остаётся кнопкой фильтра.
function renderRich(md: string): string {
  if (!host) return '';
  const prepared = String(md || '').replace(
    /(^|[\s([«"'])#([\p{L}\p{N}_]{1,32})/gu,
    (_, lead: string, tag: string) => `${lead}%%HF%%${tag}%%HE%%`,
  );
  return host.renderMarkdown(prepared).replace(/%%HF%%([\p{L}\p{N}_]{1,32})%%HE%%/gu, (_, tag: string) => {
    const safe = host!.escapeHtml(tag);
    return `<button type="button" class="sf-hashtag" data-sf-tag="#${safe}">#${safe}</button>`;
  });
}

function applyHashtag(raw: string): void {
  const tag = raw.startsWith('#') ? raw : `#${raw}`;
  feedQuery = tag;
  const search = $('sf-feed-search') as HTMLInputElement | null;
  if (search) search.value = tag;
  if (feedTab !== 'recommend') setFeedTab('recommend');
  else paintFeed();
}

function renderQuote(post: FeedPost): string {
  if (!host || !post.repostOf) return '';
  const q = post.repostOf;
  const who = authorBits(q);
  const body = renderRich(q.bodyMd || '');
  const media = (q.attachments || [])
    .slice(0, 1)
    .map((a) => {
      const src = absMedia(a.url);
      const esc = host!.escapeHtml(src);
      if (mediaIsVideo(a) || mediaIsVideo({ url: src })) {
        return `<div class="sf-quote__media uc-frame"><video src="${esc}" muted preload="metadata" playsinline></video></div>`;
      }
      return `<div class="sf-quote__media uc-frame"><img src="${esc}" alt=""></div>`;
    })
    .join('');
  return `<div class="sf-quote" data-sf-expand="${host.escapeHtml(q.id)}">
    <div class="sf-quote__head">
      <img class="sf-quote__avatar msgr-avatar__skeleton" onload="this.classList.remove('msgr-avatar__skeleton')" src="${host.escapeHtml(who.avatar)}"${who.avatarAttr}${profileAttr(who.profile, who.userId)} alt="">
      <span class="sf-quote__name">${host.escapeHtml(who.name)}${verifiedHtml(who.verified)}</span>
      <span class="sf-quote__time">${host.escapeHtml(timeAgo(q.createdAt))}</span>
    </div>
    <div class="sf-quote__body">${body}</div>
    ${media}
  </div>`;
}

function bookmarkSet(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem('sf-bookmarks') || '[]');
    return Array.isArray(raw) ? raw.map(String) : [];
  } catch {
    return [];
  }
}

function isBookmarked(id: string): boolean {
  return bookmarkSet().includes(id);
}

function toggleBookmark(id: string): void {
  const next = bookmarkSet().filter((x) => x !== id);
  if (!isBookmarked(id)) next.push(id);
  localStorage.setItem('sf-bookmarks', JSON.stringify(next));
}

function countLabel(n: number): string {
  return `<span class="sf-act__count">${n}</span>`;
}

function followButtonHtml(post: FeedPost): string {
  if (!host || post.officialId || post.author?.type !== 'user') return '';
  const userId = post.author.user?.id || '';
  // canReport есть только у чужого поста, не у своего и не у студии.
  if (!userId || !post.canReport) return '';
  const on = followingIds.includes(userId);
  return `<button type="button" class="sf-follow${on ? ' is-on' : ''}" data-sf-follow="${host.escapeHtml(userId)}">${on ? 'Отписаться' : 'Подписаться'}</button>`;
}

function paintFollowState(userId: string): void {
  const on = followingIds.includes(userId);
  const safe = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(userId) : userId.replace(/"/g, '');
  document.querySelectorAll(`[data-sf-follow="${safe}"]`).forEach((el) => {
    el.classList.toggle('is-on', on);
    el.textContent = on ? 'Отписаться' : 'Подписаться';
  });
}

const followBusy = new Set<string>();

async function togglePostFollow(userId: string): Promise<void> {
  if (!host || !userId || followBusy.has(userId)) return;
  followBusy.add(userId);
  const on = followingIds.includes(userId);
  try {
    const res = await host.messengerRequest({
      method: on ? 'DELETE' : 'POST',
      path: `/social/users/${encodeURIComponent(userId)}/follow`,
    });
    if (!res.ok) {
      host.showToast('Не удалось изменить подписку');
      return;
    }
    if (on) followingIds = followingIds.filter((id) => id !== userId);
    else if (!followingIds.includes(userId)) followingIds.push(userId);
    followingKnown = true;
    if (followingIds.includes(userId)) suggestions = suggestions.filter((user) => user.id !== userId);
    paintFollowState(userId);
    if (feedTab === 'following') paintFeed();
    paintRail();
  } finally {
    followBusy.delete(userId);
  }
}

function renderPostCard(post: FeedPost): string {
  if (!host) return '';
  const who = authorBits(post);
  const htmlBody = renderRich(post.bodyMd || '');
  const plainLen = String(post.bodyMd || '').length;
  const clamp = plainLen > 420;
  const media = renderMediaCarousel(post.attachments, { zoom: true });
  const likes = likeCount(post);
  const liked = likedMine(post);
  const comments = Number(post.commentCount || 0);
  const reposts = Number(post.repostCount || 0);
  const hasText = Boolean(String(post.bodyMd || '').trim());

  const likeSrc = liked ? ICON.likeActive : ICON.like;
  const timeLabel = `${formatPostDate(post.createdAt)}${post.repostOf ? ' · репост' : ''}`;
  const officialId = post.officialId || '';

  return `<article class="sf-post" data-post-id="${host.escapeHtml(post.id)}"${officialId ? ` data-official-id="${host.escapeHtml(officialId)}"` : ''}>
    <div class="sf-post__head">
      <div class="sf-post__avatar-wrap">
        <img class="sf-post__avatar${who.isClan ? ' is-clan' : ''} msgr-avatar__skeleton" onload="this.classList.remove('msgr-avatar__skeleton')" src="${host.escapeHtml(who.avatar)}"${who.avatarAttr}${profileAttr(who.profile, who.userId)} alt="">
      </div>
      <div class="sf-post__who">
        <div class="sf-post__name-row">
          <span class="sf-post__name">${host.escapeHtml(who.name)}</span>
          ${verifiedHtml(who.verified)}
        </div>
        <span class="sf-post__time">${host.escapeHtml(timeLabel)}</span>
      </div>
      <div class="sf-post__menu-wrap">
        ${followButtonHtml(post)}
        <button type="button" class="sf-post__menu" data-sf-menu="${host.escapeHtml(post.id)}" aria-label="Меню">
          <svg width="14" height="4" viewBox="0 0 14 4" aria-hidden="true"><circle cx="1" cy="2" r="1" fill="currentColor"/><circle cx="7" cy="2" r="1" fill="currentColor"/><circle cx="13" cy="2" r="1" fill="currentColor"/></svg>
        </button>
        <div class="sf-post__dropdown hidden" data-sf-dropdown="${host.escapeHtml(post.id)}" role="menu">
          <button type="button" data-sf-expand="${host.escapeHtml(post.id)}" role="menuitem">Открыть</button>
          ${
            post.canDelete
              ? `<button type="button" class="is-danger" data-sf-delete="${host.escapeHtml(post.id)}" role="menuitem">Удалить</button>`
              : ''
          }
        </div>
      </div>
    </div>
    ${hasText ? `<div class="sf-post__body${clamp ? ' is-clamped' : ''}" data-sf-body="${host.escapeHtml(post.id)}">${htmlBody}</div>` : ''}
    ${clamp ? `<button type="button" class="sf-post__more" data-sf-expand="${host.escapeHtml(post.id)}">Показать пост</button>` : ''}
    ${renderQuote(post)}
    ${media}
    <div class="sf-post__footer">
      ${
        officialId
          ? ''
          : `<button type="button" class="sf-act${liked ? ' is-on' : ''}" data-sf-react="${host.escapeHtml(post.id)}" data-emoji="❤️" aria-label="Лайк">
        <img class="sf-act__img" src="${likeSrc}" width="16" height="16" alt="">
        ${countLabel(likes)}
      </button>
      <button type="button" class="sf-act" data-sf-expand="${host.escapeHtml(post.id)}" aria-label="Комментарии">
        <img class="sf-act__img" src="${ICON.comment}" width="16" height="16" alt="">
        ${countLabel(comments)}
      </button>
      <button type="button" class="sf-act" data-sf-repost="${host.escapeHtml(post.id)}" aria-label="Репост">
        <img class="sf-act__img" src="${ICON.repost}" width="16" height="16" alt="">
        ${countLabel(reposts)}
      </button>`
      }
      <span class="sf-act sf-act--views" aria-hidden="true"><img class="sf-act__img" src="${ICON.views}" width="14" height="14" alt="">${countLabel(Number(post.views || 0))}</span>
      <span class="sf-post__footer-gap"></span>
      ${
        officialId
          ? ''
          : `<span class="sf-flag">
        <button type="button" class="sf-act sf-act--icon" data-sf-flag="${host.escapeHtml(post.id)}" aria-label="Пожаловаться"><img class="sf-act__img" src="${ICON.report}" width="14" height="14" alt=""></button>
        <div class="sf-flag__menu hidden" data-sf-flag-menu="${host.escapeHtml(post.id)}">
          ${
            post.canDelete
              ? `<button type="button" class="is-danger" data-sf-delete="${host.escapeHtml(post.id)}">Удалить</button>`
              : ''
          }
          ${
            post.reported
              ? `<button type="button" disabled>Жалоба отправлена</button>`
              : `<button type="button" data-sf-report-reason="${host.escapeHtml(post.id)}" data-reason="spam">Спам</button>
          <button type="button" data-sf-report-reason="${host.escapeHtml(post.id)}" data-reason="abuse">Оскорбления</button>
          <button type="button" data-sf-report-reason="${host.escapeHtml(post.id)}" data-reason="other">Другое</button>`
          }
        </div>
      </span>`
      }
      <button type="button" class="sf-act sf-act--icon${isBookmarked(post.id) ? ' is-saved' : ''}" data-sf-bookmark="${host.escapeHtml(post.id)}" aria-label="Закладка"><img class="sf-act__img" src="${ICON.favorite}" width="14" height="14" alt=""></button>
    </div>
  </article>`;
}

function setFeedTab(tab: FeedTab): void {
  feedTab = tab;
  $('news-page')?.setAttribute('data-nr-tab', tab);
  document.querySelectorAll('.nr-tabs__btn').forEach((btn) => {
    const on = btn.getAttribute('data-nr-tab') === tab;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  paintFeed();
}

function postPlain(post: FeedPost): string {
  return `${post.title || ''} ${post.bodyMd || ''}`.replace(/[#*_`>\[\]]/g, ' ');
}

function visiblePosts(): FeedPost[] {
  const q = feedQuery.trim().toLowerCase();
  const followed = new Set(followingIds);
  return communityPosts.filter((post) => {
    if (feedTab === 'articles' && !post.officialId) return false;
    if (feedTab === 'following') {
      const id = post.author?.user?.id || '';
      if (!id || !followed.has(id)) return false;
    }
    if (!q) return true;
    const who = authorBits(post).name.toLowerCase();
    return postPlain(post).toLowerCase().includes(q) || who.includes(q);
  });
}

function feedSkeletonHtml(): string {
  const card = (withMedia: boolean) => `<article class="sf-skel" aria-hidden="true">
    <div class="sf-skel__head">
      <div class="sf-skel__ava"></div>
      <div class="sf-skel__who">
        <div class="sf-skel__bar sf-skel__bar--name"></div>
        <div class="sf-skel__bar sf-skel__bar--time"></div>
      </div>
    </div>
    <div class="sf-skel__bar sf-skel__bar--line"></div>
    <div class="sf-skel__bar sf-skel__bar--line sf-skel__bar--short"></div>
    ${withMedia ? '<div class="sf-skel__media"></div>' : ''}
  </article>`;
  return card(true) + card(false) + card(false);
}

function railSkeletonHtml(): string {
  const row = `<div class="sf-skel__rail-row"><div class="sf-skel__ava sf-skel__ava--sm"></div><div class="sf-skel__who"><div class="sf-skel__bar sf-skel__bar--name"></div><div class="sf-skel__bar sf-skel__bar--time"></div></div></div>`;
  return `<section class="nr-card sf-skel-card" aria-hidden="true"><div class="sf-skel__bar sf-skel__bar--head"></div>${row}${row}${row}</section>
    <section class="nr-card sf-skel-card" aria-hidden="true"><div class="sf-skel__bar sf-skel__bar--head"></div><div class="sf-skel__tags"><span></span><span></span><span></span><span></span></div></section>
    <section class="nr-card sf-skel-card" aria-hidden="true"><div class="sf-skel__bar sf-skel__bar--head"></div>${row}${row}${row}</section>`;
}

function paintLoadingBlocks(): void {
  const list = $('sf-community-list');
  const rail = $('sf-rail');
  if (list) list.innerHTML = feedSkeletonHtml();
  if (rail) rail.innerHTML = railSkeletonHtml();
}

function paintFeed(): void {
  closeFloatMenus(true);
  const list = $('sf-community-list');
  if (!list || !host) return;
  if (!feedReady) {
    list.innerHTML = feedSkeletonHtml();
    return;
  }
  const posts = visiblePosts();
  if (!posts.length) {
    const empty =
      feedTab === 'following'
        ? 'В подписках пока пусто. Нажмите «Читать» справа.'
        : feedTab === 'articles'
          ? 'Статей пока нет.'
          : feedQuery
            ? 'Ничего не нашли.'
            : host.t('news.feedEmpty') || 'Пока тихо. Напиши первый пост.';
    list.innerHTML = `<div class="sf-empty">${host.escapeHtml(empty)}</div>`;
    return;
  }
  list.innerHTML = posts.map(renderPostCard).join('');
  armContentFrames(list);
  void noteVisibleViews(posts);
}

function tagCounts(posts: FeedPost[]): Array<[string, number]> {
  const map = new Map<string, number>();
  for (const post of posts) {
    const found = String(post.bodyMd || '').match(/#[\p{L}\p{N}_]{2,32}/gu) || [];
    for (const tag of found) {
      const key = tag.toLowerCase();
      map.set(key, (map.get(key) || 0) + 1);
    }
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
}

function paintRail(): void {
  const rail = $('sf-rail');
  const h = host;
  if (!rail || !h) return;
  if (!feedReady) {
    rail.innerHTML = railSkeletonHtml();
    return;
  }
  const now = Date.now();
  const windowMs = popularPeriod === '7' ? 7 * 86400000 : popularPeriod === '30' ? 30 * 86400000 : 0;
  const popular = communityPosts
    .filter((post) => !windowMs || now - (post.createdAt || 0) <= windowMs)
    .slice()
    .sort((a, b) => likeCount(b) + Number(b.commentCount || 0) - (likeCount(a) + Number(a.commentCount || 0)))
    .slice(0, 5);
  const tags = tagCounts(communityPosts);
  const popHtml = popular.length
    ? `<div class="nr-pop">${popular
        .map((post, i) => {
          const who = authorBits(post);
          const title = (post.title || postPlain(post)).trim().slice(0, 80);
          const likes = likeCount(post);
          return `<button type="button" class="nr-pop__item" data-sf-pop="${h.escapeHtml(post.id)}">
            <span class="nr-pop__n">${i + 1}</span>
            <img class="nr-pop__ava msgr-avatar__skeleton" onload="if(this.naturalWidth>1) this.classList.remove('msgr-avatar__skeleton')" src="${h.escapeHtml(who.avatar)}"${who.avatarAttr}${profileAttr(who.profile, who.userId)} alt="">
            <span><span class="nr-pop__title">${h.escapeHtml(title || who.name)}</span>
            <span class="nr-pop__meta">${h.escapeHtml(who.name)}${likes ? ` · ${likes} лайков` : ''}</span></span>
          </button>`;
        })
        .join('')}</div>`
    : `<div class="nr-card__empty">Пока не нашли</div>`;
  const tagHtml = tags.length
    ? `<div class="nr-tags">${tags
        .map(
          ([tag]) =>
            `<button type="button" data-sf-tag="${h.escapeHtml(tag)}">${h.escapeHtml(tag)}</button>`,
        )
        .join('')}</div>`
    : `<div class="nr-card__empty">Хештегов пока нет</div>`;
  const whoHtml = suggestions.length
    ? `<div class="nr-who">${suggestions
        .map((user) => {
          const av = avatarImgBits({
            skinUrl: user.skinUrl,
            uuid: user.uuid,
            username: user.username,
            provider: user.provider,
          });
          const n = Number(user.followerCount || 0);
          const n10 = n % 10;
          const n100 = n % 100;
          const word =
            n10 === 1 && n100 !== 11
              ? 'подписчик'
              : n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)
                ? 'подписчика'
                : 'подписчиков';
          return `<div class="nr-who__row">
            <img class="nr-who__ava msgr-avatar__skeleton" onload="if(this.naturalWidth>1) this.classList.remove('msgr-avatar__skeleton')" src="${h.escapeHtml(av.src)}"${av.attr}${profileAttr(user.username, user.id)} alt="">
            <span><span class="nr-who__name">${h.escapeHtml(user.username)}</span>
            <span class="nr-who__meta">${n} ${word}</span></span>
            <button type="button" class="nr-who__btn" data-sf-read="${h.escapeHtml(user.id)}">Читать</button>
          </div>`;
        })
        .join('')}</div>`
    : `<div class="nr-card__empty">Пока некого предложить</div>`;
  const periodBtn = (id: '7' | '30' | 'all', label: string) =>
    `<button type="button" data-sf-period="${id}" class="${popularPeriod === id ? 'is-active' : ''}">${label}</button>`;
  rail.innerHTML = `
    <section class="nr-card">
      <div class="nr-card__head"><img class="nr-card__ico" src="${ICON.trending}" width="14" height="14" alt=""><span>Популярное</span><div class="nr-period">${periodBtn('7', '7Д')}${periodBtn('30', '30Д')}${periodBtn('all', 'Всё')}</div></div>
      ${popHtml}
    </section>
    <section class="nr-card">
      <div class="nr-card__head"><img class="nr-card__ico" src="${ICON.hashtag}" width="14" height="14" alt=""><span>Популярные хештеги</span></div>
      ${tagHtml}
    </section>
    <section class="nr-card">
      <div class="nr-card__head"><img class="nr-card__ico" src="${ICON.who}" width="14" height="14" alt=""><span>Кого читать</span></div>
      ${whoHtml}
    </section>`;
}

function setNewsView(view: 'community' | 'official'): void {
  setFeedTab(view === 'official' ? 'articles' : 'recommend');
}

async function showOfficialNews(force: boolean): Promise<void> {
  if (!host) return;
  const root = $('sf-official-news');
  if (!root) return;
  if (host.loadOfficialNews) await host.loadOfficialNews(force);
  host.renderOfficialNews?.(root);
}

async function fileToJpegDataUrl(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const maxW = 1600;
  const scale = Math.min(1, maxW / Math.max(bmp.width, 1));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return canvas.toDataURL('image/jpeg', 0.85);
}

function renderComposerPreviews(): void {
  const box = $('sf-composer-previews');
  if (!box) return;
  box.innerHTML = pendingJpegs
    .map((src, i) => `<img class="sf-compose__preview" src="${src}" data-rm="${i}" alt="">`)
    .join('');
  syncComposeOpen();
}

function syncComposeOpen(): void {
  const box = $('sf-composer');
  if (!box) return;
  // Панель инструментов убрана: выдвижная часть только для превью фото.
  box.classList.toggle('is-open', pendingJpegs.length > 0);
}

function autosizeComposer(): void {
  const input = $('sf-composer-input') as HTMLTextAreaElement | null;
  if (!input) return;
  input.style.height = 'auto';
  input.style.height = `${Math.min(140, Math.max(40, input.scrollHeight))}px`;
  syncComposeOpen();
}

function syncAccountAvatars(): void {
  if (!host) return;
  const acc = host.getAccount();
  const bits = avatarImgBits({
    skinUrl: acc?.skinUrl,
    uuid: acc?.uuid,
    username: acc?.username || acc?.name,
    provider: accountProvider(acc),
  });
  for (const id of ['sf-wall-avatar', 'sf-composer-avatar']) {
    const el = $(id) as HTMLImageElement | null;
    if (!el) continue;
    showAvatar(el, bits.src);
    if (bits.attr) {
      const key = avatarKey({
        skinUrl: acc?.skinUrl,
        uuid: acc?.uuid,
        username: acc?.username || acc?.name,
        provider: accountProvider(acc),
      });
      if (key) el.setAttribute('data-sf-avatar', key);
    }
  }
}

async function refreshClansSelect(): Promise<void> {
  if (!host) return;
  const res = await host.messengerRequest({ path: '/social/clans/mine' });
  myClans = res.ok ? res.data?.clans || [] : [];
  const sel = $('sf-composer-clan') as HTMLSelectElement | null;
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML =
    `<option value="">${host.escapeHtml(host.t('news.postAsSelf') || 'От своего имени')}</option>` +
    myClans
      .map((c) => `<option value="${host!.escapeHtml(c.id)}">${host!.escapeHtml(c.name)}</option>`)
      .join('');
  if (cur) sel.value = cur;
}

function officialBody(item: { title?: string; summary?: string; content?: string }): string {
  const content = String(item.content || '').trim();
  const title = String(item.title || '').trim();
  const summary = String(item.summary || '').trim();
  if (!content) return [title, summary].filter(Boolean).join('\n\n');
  const head = content.replace(/^#+\s*/, '').trimStart();
  if (!title || head.startsWith(title)) return content;
  return `# ${title}\n\n${content}`;
}

function paintViewCount(postId: string, views: number): void {
  const post = communityPosts.find((item) => item.id === postId);
  if (post) post.views = views;
  const safe = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(postId) : postId.replace(/"/g, '');
  document.querySelectorAll(`[data-post-id="${safe}"] .sf-act--views .sf-act__count`).forEach((el) => {
    el.textContent = String(views);
  });
}

const notedSocialViews = new Set<string>();

async function noteOneView(post: FeedPost): Promise<void> {
  if (!host) return;
  if (post.officialId) {
    const views = await host.noteNewsView?.(post.officialId);
    if (typeof views === 'number') paintViewCount(post.id, views);
    return;
  }
  if (notedSocialViews.has(post.id)) return;
  notedSocialViews.add(post.id);
  const res = await host.messengerRequest({
    method: 'POST',
    path: `/social/posts/${encodeURIComponent(post.id)}/view`,
  });
  const views = Number(res.data?.views);
  if (res.ok && Number.isFinite(views)) paintViewCount(post.id, views);
  else notedSocialViews.delete(post.id);
}

function noteVisibleViews(posts: FeedPost[]): void {
  const list = $('sf-community-list');
  if (!list) return;
  const cards = Array.from(list.querySelectorAll<HTMLElement>('.sf-post'));
  if (!cards.length) return;
  if (typeof IntersectionObserver === 'undefined') {
    for (const post of posts) void noteOneView(post);
    return;
  }
  const root = document.getElementById('tab-news');
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const id = (entry.target as HTMLElement).getAttribute('data-post-id') || '';
        const post = posts.find((item) => item.id === id);
        if (post) void noteOneView(post);
        observer.unobserve(entry.target);
      }
    },
    { root, threshold: 0.35 },
  );
  for (const card of cards) observer.observe(card);
}

function newsTime(raw: string | undefined): number {
  const text = String(raw || '').trim();
  if (!text) return 0;
  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) return parsed;
  const num = Number(text);
  return Number.isFinite(num) ? num : 0;
}

async function loadCommunity(): Promise<void> {
  if (!host) return;
  try {
  const [res, official] = await Promise.all([
    host.messengerRequest({
      path: '/social/feed',
      query: { channel: 'community', limit: 40 },
    }),
    host.listNewsOfficial().catch(() => []),
  ]);
  const social: FeedPost[] = res.ok ? res.data?.posts || [] : [];
  followingIds = res.ok && Array.isArray(res.data?.followingIds) ? res.data.followingIds.map(String) : followingIds;
  if (res.ok) followingKnown = true;
  suggestions = res.ok && Array.isArray(res.data?.suggestions) ? res.data.suggestions : [];
  if (res.ok) applyPostingLock(Boolean(res.data?.postingBanned));
  const studioPosts: FeedPost[] = (official || []).map((item) => {
    const attachments: NonNullable<FeedPost['attachments']> = [];
    if (item.cover) attachments.push({ id: `cover-${item.id}`, url: item.cover, mime: 'image/jpeg' });
    for (const media of item.media || []) {
      const url = host?.resolveNewsCoverUrl?.(media.url) || String(media.url || '');
      if (!url || attachments.some((file) => file.url === url)) continue;
      attachments.push({
        id: `media-${item.id}-${attachments.length}`,
        url,
        mime: media.type === 'video' ? 'video/mp4' : 'image/jpeg',
      });
    }
    return {
      id: `news:${item.id}`,
      officialId: item.id,
      title: item.title,
      bodyMd: officialBody(item),
      views: Number(item.views || 0),
      createdAt: newsTime(item.date),
      author: { type: 'launcher', name: STUDIO_NAME },
      attachments,
    };
  });
  communityPosts = [...social, ...studioPosts].sort((a, b) => {
    const pin = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
    if (pin) return pin;
    return (b.createdAt || 0) - (a.createdAt || 0);
  });
  } finally {
    feedReady = true;
    paintFeed();
    paintRail();
  }
}

function renderCommentNode(c: FeedComment, depth: number): string {
  if (!host) return '';
  const name = c.author?.username || 'Игрок';
  const av = avatarImgBits({
    skinUrl: c.author?.skinUrl,
    uuid: c.author?.uuid,
    username: c.author?.username,
    provider: c.author?.provider,
  });
  const replyHint =
    c.replyTo?.username && depth > 0
      ? `<span class="sf-pm-comment__reply-to">· ${host.escapeHtml(host.t('news.replyTo') || 'Ответ пользователю')} ${host.escapeHtml(c.replyTo.username)}</span>`
      : '';
  const children = (c as FeedComment & { children?: FeedComment[] }).children || [];
  const kids =
    children.length > 0
      ? `<div class="sf-pm-thread">${children.map((ch) => renderCommentNode(ch, depth + 1)).join('')}</div>`
      : '';
  const menu = c.canDelete
    ? `<div class="sf-pm-comment__menu-wrap">
        <button type="button" class="sf-pm-comment__menu" data-sf-cmenu="${host.escapeHtml(c.id)}" aria-label="Меню" aria-haspopup="true">${MENU_SVG}</button>
        <div class="sf-pm-comment__dropdown hidden" data-sf-cdropdown="${host.escapeHtml(c.id)}" role="menu">
          <button type="button" class="is-danger" data-sf-cdelete="${host.escapeHtml(c.id)}" role="menuitem">${host.escapeHtml(host.t('news.deleteComment') || 'Удалить')}</button>
        </div>
      </div>`
    : '';
  return `<article class="sf-pm-comment" data-comment-id="${host.escapeHtml(c.id)}" style="--sf-depth:${Math.min(depth, 4)}">
    <div class="sf-pm-comment__card">
      <div class="sf-pm-comment__head">
        <img class="sf-pm-comment__avatar msgr-avatar__skeleton" onload="this.classList.remove('msgr-avatar__skeleton')" src="${host.escapeHtml(av.src)}"${av.attr}${profileAttr(c.author?.username, c.author?.id)} alt="">
        <div class="sf-pm-comment__meta">
          <div class="sf-pm-comment__name">${host.escapeHtml(name)}${verifiedHtml(Boolean(c.author?.verified))}</div>
          <div class="sf-pm-comment__time">${host.escapeHtml(timeAgo(c.createdAt))}${replyHint}</div>
        </div>
        <div class="sf-pm-comment__actions">
          <button type="button" class="sf-pm-comment__reply" data-sf-reply="${host.escapeHtml(c.id)}" data-sf-reply-name="${host.escapeHtml(name)}">${host.escapeHtml(host.t('news.reply') || 'Ответить')}</button>
          ${menu}
        </div>
      </div>
      <div class="sf-pm-comment__body mod-details-body">${renderRich(c.bodyMd || '')}</div>
    </div>
    ${kids}
  </article>`;
}

function buildCommentTree(flat: FeedComment[]): FeedComment[] {
  type Node = FeedComment & { children: FeedComment[] };
  const map = new Map<string, Node>();
  const roots: Node[] = [];
  for (const c of flat) {
    map.set(c.id, { ...c, children: [] });
  }
  for (const c of flat) {
    const node = map.get(c.id)!;
    const parentId = c.parentId || null;
    if (parentId && map.has(parentId)) {
      map.get(parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

function renderCommentsHtml(comments: FeedComment[]): string {
  if (!host) return '';
  if (!comments.length) {
    return `<div class="sf-empty sf-pm-empty">${host.escapeHtml(host.t('news.noComments') || 'Комментариев пока нет')}</div>`;
  }
  return buildCommentTree(comments)
    .map((c) => renderCommentNode(c, 0))
    .join('');
}

function syncCommentComposerHint(): void {
  const hint = $('sf-comment-reply-hint');
  const input = $('sf-comment-input') as HTMLTextAreaElement | null;
  if (!hint) return;
  if (replyParentId && replyParentName) {
    hint.classList.remove('hidden');
    hint.innerHTML = `${host?.escapeHtml(host?.t('news.replyTo') || 'Ответ пользователю') || ''} <b>${host?.escapeHtml(replyParentName) || ''}</b> <button type="button" id="sf-comment-reply-cancel" class="sf-pm-reply-cancel">×</button>`;
    $('sf-comment-reply-cancel')?.addEventListener('click', () => {
      replyParentId = '';
      replyParentName = '';
      syncCommentComposerHint();
    });
  } else {
    hint.classList.add('hidden');
    hint.innerHTML = '';
  }
  if (input) {
    input.placeholder = replyParentId
      ? host?.t('news.replyPlaceholder') || `Ответ для ${replyParentName}…`
      : host?.t('news.commentPlaceholder') || 'Написать комментарий…';
  }
}

function bindPostModalScroll(): void {
  const scroll = $('sf-modal-body');
  const head = $('sf-pm-head');
  if (!scroll || !head) return;
  const onScroll = () => {
    head.classList.toggle('is-scrolled', scroll.scrollTop > 8);
  };
  if (!(scroll as any)._sfScrollBound) {
    scroll.addEventListener('scroll', onScroll, { passive: true });
    (scroll as any)._sfScrollBound = true;
  }
  scroll.scrollTop = 0;
  onScroll();
}

function renderPostModalActions(post: FeedPost): string {
  if (!host) return '';
  const likes = likeCount(post);
  const liked = likedMine(post);
  const reposts = Number(post.repostCount || 0);
  const likeSrc = liked ? ICON.likeActive : ICON.like;
  return `<div class="sf-pm__actions">
    <button type="button" class="sf-act${liked ? ' is-on' : ''}" data-sf-react="${host.escapeHtml(post.id)}" data-emoji="❤️" aria-label="Лайк">
      <img class="sf-act__img" src="${likeSrc}" width="16" height="16" alt="">
      <span class="sf-act__count">${likes}</span>
    </button>
    <button type="button" class="sf-act${reposts ? '' : ' is-muted'}" data-sf-repost="${host.escapeHtml(post.id)}" aria-label="Репост">
      <img class="sf-act__img" src="${ICON.repost}" width="16" height="16" alt="">
      <span class="sf-act__count">${reposts}</span>
    </button>
  </div>`;
}

async function openPostModal(postId: string): Promise<void> {
  const post = communityPosts.find((p) => p.id === postId);
  if (!post || !host) return;
  if (post.officialId) {
    host.openOfficialNews(post.officialId);
    return;
  }
  activePostId = postId;
  replyParentId = '';
  replyParentName = '';
  const who = authorBits(post);
  const title = $('sf-modal-title');
  const sub = $('sf-modal-sub');
  const verified = $('sf-pm-verified');
  const avatar = $('sf-pm-avatar') as HTMLImageElement | null;
  const body = $('sf-modal-body');
  if (title) title.textContent = who.name;
  if (sub) sub.textContent = timeAgo(post.createdAt);
  if (verified) verified.innerHTML = who.verified ? verifiedHtml(true) : '';
  if (avatar) {
    showAvatar(avatar, who.avatar);
    avatar.classList.toggle('is-clan', Boolean(who.isClan));
    if (who.avatarAttr) {
      const m = who.avatarAttr.match(/data-sf-avatar="([^"]*)"/);
      if (m?.[1]) avatar.setAttribute('data-sf-avatar', m[1]);
      else avatar.removeAttribute('data-sf-avatar');
    } else {
      avatar.removeAttribute('data-sf-avatar');
    }
    if (who.profile) avatar.setAttribute('data-sf-profile', who.profile);
    else avatar.removeAttribute('data-sf-profile');
    if (who.userId) avatar.setAttribute('data-sf-user-id', who.userId);
    else avatar.removeAttribute('data-sf-user-id');
  }
  const commentAvatar = $('sf-comment-avatar') as HTMLImageElement | null;
  if (commentAvatar) {
    const acc = host.getAccount();
    const bits = avatarImgBits({
      skinUrl: acc?.skinUrl,
      uuid: acc?.uuid,
      username: acc?.username || acc?.name,
      provider: accountProvider(acc),
    });
    showAvatar(commentAvatar, bits.src);
    const key = avatarKey({
      skinUrl: acc?.skinUrl,
      uuid: acc?.uuid,
      username: acc?.username || acc?.name,
      provider: accountProvider(acc),
    });
    if (key) commentAvatar.setAttribute('data-sf-avatar', key);
  }
  if (body) {
    body.innerHTML = `
      <div class="sf-pm__content">
        ${String(post.bodyMd || '').trim() ? `<div class="sf-pm__text mod-details-body">${renderRich(post.bodyMd || '')}</div>` : ''}
        ${post.repostOf ? renderQuote({ ...post, id: post.id }) : ''}
        ${renderMediaCarousel(post.attachments, { className: 'sf-pm__media', zoom: true })}
        ${renderPostModalActions(post)}
        <div class="sf-pm__divider"></div>
        <div class="sf-pm__comments-title">${host.escapeHtml(host.t('news.comments') || 'Комментарии')}</div>
        ${
          postingBanned
            ? ''
            : `<div class="sf-pm__composer-inline">
          <img class="sf-pm__composer-avatar msgr-avatar__skeleton" id="sf-comment-avatar-inline" alt="" src="${AVATAR_BLANK}">
          <div class="sf-pm__composer-box">
            <div id="sf-comment-reply-hint" class="sf-pm-reply-hint hidden"></div>
            <textarea id="sf-comment-input" rows="2" maxlength="2000" placeholder="Написать комментарий…" data-i18n-placeholder="news.commentPlaceholder"></textarea>
            <button type="button" class="sf-pm__send" id="sf-comment-send" aria-label="Отправить">${SEND_SVG}</button>
          </div>
        </div>`
        }
        <div id="sf-comments-list" class="sf-pm__comments">${commentSkeletonHtml()}</div>
      </div>`;
    const inlineAv = $('sf-comment-avatar-inline') as HTMLImageElement | null;
    if (inlineAv) {
      const acc = host.getAccount();
      const bits = avatarImgBits({
        skinUrl: acc?.skinUrl,
        uuid: acc?.uuid,
        username: acc?.username || acc?.name,
        provider: accountProvider(acc),
      });
      showAvatar(inlineAv, bits.src);
      const key = avatarKey({
        skinUrl: acc?.skinUrl,
        uuid: acc?.uuid,
        username: acc?.username || acc?.name,
        provider: accountProvider(acc),
      });
      if (key) inlineAv.setAttribute('data-sf-avatar', key);
    }
    armContentFrames(body);
    // Обработчики send/reply — делегирование на #modal-sf-post
  }
  syncCommentComposerHint();
  bindPostModalScroll();
  host.openModal('modal-sf-post');
  const res = await host.messengerRequest({
    path: `/social/posts/${encodeURIComponent(postId)}/comments`,
    query: { limit: 120 },
  });
  const box = $('sf-comments-list');
  if (!box) return;
  if (res.ok) applyPostingLock(Boolean(res.data?.postingBanned));
  if (!res.ok) {
    box.innerHTML = `<div class="sf-empty sf-pm-empty">${host.escapeHtml(res.error || 'Не удалось загрузить комментарии')}</div>`;
    return;
  }
  box.innerHTML = renderCommentsHtml(res.data?.comments || []);
}

async function sendComment(): Promise<void> {
  if (!host || !activePostId) return;
  if (postingBanned) {
    host.showToast('Публикация постов и комментариев ограничена');
    applyPostingLock(true);
    return;
  }
  const input = $('sf-comment-input') as HTMLTextAreaElement | null;
  const text = String(input?.value || '').trim();
  if (!text) {
    host.showToast(host.t('news.commentEmpty') || 'Напиши комментарий');
    return;
  }
  const res = await host.messengerRequest({
    method: 'POST',
    path: `/social/posts/${encodeURIComponent(activePostId)}/comments`,
    body: {
      bodyMd: text,
      parentId: replyParentId || undefined,
    },
  });
  if (!res.ok) {
    if (res.code === 'posting_banned') applyPostingLock(true);
    host.showToast(res.code === 'posting_banned' ? 'Публикация постов и комментариев ограничена' : res.error || 'Не удалось отправить');
    return;
  }
  if (input) input.value = '';
  replyParentId = '';
  replyParentName = '';
  syncCommentComposerHint();
  const listRes = await host.messengerRequest({
    path: `/social/posts/${encodeURIComponent(activePostId)}/comments`,
    query: { limit: 120 },
  });
  const box = $('sf-comments-list');
  if (box && listRes.ok) box.innerHTML = renderCommentsHtml(listRes.data?.comments || []);
  await loadCommunity();
}

function openComposeModal(): void {
  if (!host) return;
  if (feedTab !== 'recommend') setFeedTab('recommend');
  syncAccountAvatars();
  const input = $('sf-composer-input') as HTMLTextAreaElement | null;
  input?.focus();
}

function openClanModal(): void {
  if (!host) return;
  const name = $('sf-clan-name') as HTMLInputElement | null;
  const desc = $('sf-clan-desc') as HTMLInputElement | null;
  const preview = $('sf-clan-icon-preview') as HTMLImageElement | null;
  if (name) name.value = '';
  if (desc) desc.value = '';
  pendingClanIcon = '';
  if (preview) {
    preview.removeAttribute('src');
    preview.style.display = 'none';
  }
  host.openModal('modal-sf-clan');
  queueMicrotask(() => name?.focus());
}

async function submitClan(): Promise<void> {
  if (!host) return;
  const name = String(($('sf-clan-name') as HTMLInputElement | null)?.value || '').trim();
  const description = String(($('sf-clan-desc') as HTMLInputElement | null)?.value || '').trim();
  if (!name) {
    host.showToast(host.t('news.clanNameRequired') || 'Укажи название клана');
    return;
  }
  const res = await host.messengerRequest({
    method: 'POST',
    path: '/social/clans',
    body: {
      name,
      description,
      iconDataUrl: pendingClanIcon || undefined,
    },
  });
  if (!res.ok) {
    host.showToast(res.error || 'Не удалось создать клан');
    return;
  }
  // Если иконку выбрали после создания — догружаем отдельно
  const clanId = String(res.data?.clan?.id || '');
  if (clanId && pendingClanIcon && !res.data?.clan?.iconUrl) {
    await host.messengerRequest({
      method: 'POST',
      path: `/social/clans/${encodeURIComponent(clanId)}/icon`,
      body: { iconDataUrl: pendingClanIcon },
    });
  }
  host.closeModal('modal-sf-clan');
  pendingClanIcon = '';
  host.showToast(`Клан «${res.data?.clan?.name || name}» создан`);
  await refreshClansSelect();
  const sel = $('sf-composer-clan') as HTMLSelectElement | null;
  if (sel && clanId) sel.value = clanId;
}

function applyPostingLock(next?: boolean): void {
  if (typeof next === 'boolean') postingBanned = next;
  $('news-page')?.classList.toggle('is-posting-banned', postingBanned);
  $('sf-composer')?.classList.toggle('is-banned', postingBanned);
  if (postingBanned) document.querySelector('.sf-pm__composer-inline')?.remove();
}

type FloatMenuEl = HTMLElement & { _sfHolder?: Comment; _sfCloseTimer?: number };
let floatSeq = 0;

function menuAnchor(menu: HTMLElement): HTMLElement | null {
  const dropId = menu.getAttribute('data-sf-dropdown');
  if (dropId) return document.querySelector(`[data-sf-menu="${CSS.escape(dropId)}"]`);
  const flagId = menu.getAttribute('data-sf-flag-menu');
  if (flagId) return document.querySelector(`[data-sf-flag="${CSS.escape(flagId)}"]`);
  return null;
}

function restoreFloatMenu(menu: FloatMenuEl): void {
  menu.classList.remove('sf-float', 'sf-float--up', 'sf-float--down', 'is-open');
  menu.style.top = '';
  menu.style.left = '';
  menu.style.zIndex = '';
  menu.style.visibility = '';
  const holder = menu._sfHolder;
  if (holder?.parentNode) holder.parentNode.insertBefore(menu, holder);
  holder?.remove();
  menu._sfHolder = undefined;
  menuAnchor(menu)?.classList.remove('is-open');
}

function finishFloatClose(menu: FloatMenuEl): void {
  if (menu.classList.contains('is-open')) return;
  if (menu._sfCloseTimer) {
    window.clearTimeout(menu._sfCloseTimer);
    menu._sfCloseTimer = undefined;
  }
  menu.classList.add('hidden');
  restoreFloatMenu(menu);
}

// Меню выносится в body: колонка ленты обрезает overflow, и верхний пост уходил под поле ввода.
function closeFloatMenus(immediate = false): void {
  document.querySelectorAll('.sf-post__dropdown, .sf-flag__menu').forEach((node) => {
    const menu = node as FloatMenuEl;
    if (menu.classList.contains('hidden') && !menu.classList.contains('sf-float')) return;
    menu.classList.remove('is-open');
    menuAnchor(menu)?.classList.remove('is-open');
    if (immediate || !menu.classList.contains('sf-float')) {
      finishFloatClose(menu);
      return;
    }
    const token = menu.dataset.sfFloatGen || '';
    const done = () => {
      if ((menu.dataset.sfFloatGen || '') !== token) return;
      finishFloatClose(menu);
    };
    const onEnd = (ev: TransitionEvent) => {
      if (ev.propertyName !== 'opacity') return;
      menu.removeEventListener('transitionend', onEnd);
      done();
    };
    menu.addEventListener('transitionend', onEnd);
    if (menu._sfCloseTimer) window.clearTimeout(menu._sfCloseTimer);
    menu._sfCloseTimer = window.setTimeout(() => {
      menu.removeEventListener('transitionend', onEnd);
      done();
    }, 220);
  });
}

function floatMenuZ(): number {
  let z = 10060;
  document.querySelectorAll<HTMLElement>('.modal-overlay, .msgr-ctx, .modal-confirm-overlay').forEach((node) => {
    if (node.classList.contains('hidden')) return;
    const parsed = parseInt(node.style.zIndex || getComputedStyle(node).zIndex, 10);
    if (Number.isFinite(parsed) && parsed < 1_000_000 && parsed + 2 > z) z = parsed + 2;
  });
  return z;
}

function openFloatMenu(menu: HTMLElement, anchor: HTMLElement, preferUp: boolean): void {
  const el = menu as FloatMenuEl;
  el.dataset.sfFloatGen = String(++floatSeq);
  closeFloatMenus(true);
  if (el._sfCloseTimer) {
    window.clearTimeout(el._sfCloseTimer);
    el._sfCloseTimer = undefined;
  }
  if (el.parentElement !== document.body) {
    const holder = document.createComment('sf-menu');
    el.parentElement?.insertBefore(holder, el);
    el._sfHolder = holder;
    document.body.appendChild(el);
  }
  el.classList.remove('hidden');
  el.classList.add('sf-float');
  // Карточка профиля — модалка выше 1500. Меню в body должно рисоваться над ней.
  el.style.zIndex = String(floatMenuZ());
  el.style.visibility = 'hidden';
  const width = el.offsetWidth || 160;
  const height = el.offsetHeight || 40;
  el.style.visibility = '';
  const rect = anchor.getBoundingClientRect();
  const gap = 6;
  const margin = 8;
  const titlebar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--titlebar-height')) || 0;
  const topLimit = Math.max(margin, titlebar + margin);
  let top = preferUp ? rect.top - height - gap : rect.bottom + gap;
  let left = rect.right - width;
  if (top < topLimit) top = topLimit;
  if (top + height > window.innerHeight - margin) top = Math.max(topLimit, window.innerHeight - margin - height);
  if (left < margin) left = margin;
  if (left + width > window.innerWidth - margin) left = Math.max(margin, window.innerWidth - margin - width);
  el.style.top = `${Math.round(top)}px`;
  el.style.left = `${Math.round(left)}px`;
  const opensUp = top + height <= rect.top + 2;
  el.classList.toggle('sf-float--up', opensUp);
  el.classList.toggle('sf-float--down', !opensUp);
  anchor.classList.add('is-open');
  requestAnimationFrame(() => el.classList.add('is-open'));
}

function closeAllPostMenus(): void {
  closeFloatMenus(true);
}

function closeAllCommentMenus(): void {
  document.querySelectorAll('.sf-pm-comment__dropdown').forEach((el) => el.classList.add('hidden'));
  document.querySelectorAll('.sf-pm-comment__menu.is-open').forEach((el) => el.classList.remove('is-open'));
}

async function askConfirm(message: string): Promise<boolean> {
  if (host?.confirm) return host.confirm(message);
  return false;
}

async function deletePost(postId: string): Promise<void> {
  if (!host || !postId) return;
  closeAllPostMenus();
  const ok = await askConfirm(host.t('news.deleteConfirm') || 'Удалить этот пост?');
  if (!ok) return;
  const res = await host.messengerRequest({
    method: 'DELETE',
    path: `/social/posts/${encodeURIComponent(postId)}`,
  });
  if (!res.ok) {
    host.showToast(res.error || 'Не удалось удалить');
    return;
  }
  closeAllPostMenus();
  if (activePostId === postId) host.closeModal('modal-sf-post');
  host.showToast(host.t('news.deleted') || 'Пост удалён');
  await loadCommunity();
}

async function deleteComment(commentId: string): Promise<void> {
  if (!host || !activePostId || !commentId) return;
  closeAllCommentMenus();
  const ok = await askConfirm(host.t('news.deleteCommentConfirm') || 'Удалить этот комментарий?');
  if (!ok) return;
  const res = await host.messengerRequest({
    method: 'DELETE',
    path: `/social/posts/${encodeURIComponent(activePostId)}/comments/${encodeURIComponent(commentId)}`,
  });
  if (!res.ok) {
    host.showToast(res.error || 'Не удалось удалить комментарий');
    return;
  }
  closeAllCommentMenus();
  host.showToast(host.t('news.commentDeleted') || 'Комментарий удалён');
  const listRes = await host.messengerRequest({
    path: `/social/posts/${encodeURIComponent(activePostId)}/comments`,
    query: { limit: 120 },
  });
  const box = $('sf-comments-list');
  if (box && listRes.ok) box.innerHTML = renderCommentsHtml(listRes.data?.comments || []);
  await loadCommunity();
}

async function publishPost(): Promise<void> {
  if (!host) return;
  if (postingBanned) {
    host.showToast('Публикация постов и комментариев ограничена');
    applyPostingLock(true);
    return;
  }
  const input = $('sf-composer-input') as HTMLTextAreaElement | null;
  const text = String(input?.value || '').trim();
  if (!text && !pendingJpegs.length) {
    host.showToast('Напиши текст или добавь фото');
    return;
  }
  const publishBtn = $('sf-composer-publish') as HTMLButtonElement | null;
  if (publishBtn) publishBtn.disabled = true;
  const clanId = ($('sf-composer-clan') as HTMLSelectElement | null)?.value || '';
  const res = await host.messengerRequest({
    method: 'POST',
    path: '/social/posts',
    body: {
      bodyMd: text,
      clanId: clanId || undefined,
      images: pendingJpegs.slice(0, 6),
    },
  });
  if (publishBtn) publishBtn.disabled = false;
  if (!res.ok) {
    if (res.code === 'posting_banned') applyPostingLock(true);
    host.showToast(res.code === 'posting_banned' ? 'Публикация постов и комментариев ограничена' : res.error || 'Не удалось опубликовать');
    return;
  }
  if (input) {
    input.value = '';
    input.style.height = '';
  }
  pendingJpegs = [];
  renderComposerPreviews();
  $('sf-composer')?.classList.remove('is-open');
  const created = res.data?.post as FeedPost | undefined;
  if (created?.id) {
    communityPosts = [created, ...communityPosts.filter((p) => p.id !== created.id)];
    const list = $('sf-community-list');
    if (list) {
      list.innerHTML = communityPosts.map(renderPostCard).join('');
      list.querySelector('.sf-post')?.classList.add('is-fresh');
      list.scrollTop = 0;
    }
  } else {
    await loadCommunity();
  }
}

async function reportPost(postId: string, reason: string): Promise<void> {
  if (!host || !postId) return;
  const res = await host.messengerRequest({
    method: 'POST',
    path: `/social/posts/${encodeURIComponent(postId)}/report`,
    body: { reason },
  });
  closeAllPostMenus();
  if (!res.ok) {
    host.showToast(res.error || 'Не удалось отправить жалобу');
    return;
  }
  const post = communityPosts.find((p) => p.id === postId);
  if (post) post.reported = true;
  host.showToast('Жалоба отправлена');
  const list = $('sf-community-list');
  if (list) list.innerHTML = communityPosts.map(renderPostCard).join('');
}

async function openRepostModal(postId: string): Promise<void> {
  if (!host) return;
  repostPostId = postId;
  repostTab = 'wall';
  const comment = $('sf-repost-comment') as HTMLTextAreaElement | null;
  if (comment) comment.value = '';
  document.querySelectorAll('[data-sf-repost-tab]').forEach((el) => {
    el.classList.toggle('is-active', el.getAttribute('data-sf-repost-tab') === 'wall');
  });
  $('sf-repost-panel-wall')?.classList.remove('hidden');
  $('sf-repost-panel-chats')?.classList.add('hidden');

  const chats = (await host.listConversationsForRepost?.()) || [];
  const box = $('sf-repost-list');
  if (box) {
    box.innerHTML = chats.length
      ? chats
          .slice(0, 24)
          .map(
            (c) => `<label class="sf-repost-item">
        <input type="checkbox" value="${host!.escapeHtml(c.id)}">
        <span>${host!.escapeHtml(c.title)}</span>
      </label>`,
          )
          .join('')
      : `<div class="sf-empty" style="padding:12px 0">${host.escapeHtml(host.t('news.repostNoChats') || 'Нет чатов')}</div>`;
  }
  host.openModal('modal-sf-repost');
}

async function submitRepost(): Promise<void> {
  if (!host || !repostPostId) return;

  if (repostTab === 'wall') {
    const comment = String(($('sf-repost-comment') as HTMLTextAreaElement | null)?.value || '').trim();
    const res = await host.messengerRequest({
      method: 'POST',
      path: '/social/posts',
      body: { bodyMd: comment, repostOfId: repostPostId },
    });
    if (!res.ok) {
      host.showToast(res.error || 'Репост не удался');
      return;
    }
    host.closeModal('modal-sf-repost');
    host.showToast(host.t('news.repostedWall') || 'Репост на стене');
    await loadCommunity();
    return;
  }

  const box = $('sf-repost-list');
  const ids = Array.from(box?.querySelectorAll<HTMLInputElement>('input:checked') || []).map(
    (el) => el.value,
  );
  if (!ids.length) {
    host.showToast(host.t('news.repostPick') || 'Выбери хотя бы один чат');
    return;
  }
  const res = await host.messengerRequest({
    method: 'POST',
    path: `/social/posts/${encodeURIComponent(repostPostId)}/repost`,
    body: { conversationIds: ids },
  });
  if (!res.ok) {
    host.showToast(res.error || 'Репост не удался');
    return;
  }
  host.closeModal('modal-sf-repost');
  host.showToast(`Отправлено в ${res.data?.sent?.length || ids.length} чат(ов)`);
  await loadCommunity();
}

function presenceLabel(status: string): string {
  const s = String(status || '').toLowerCase();
  if (s === 'online') return 'в сети';
  if (s === 'busy' || s === 'dnd') return 'занят';
  return 'не в сети';
}

async function showMentionCard(username: string, clientX: number, clientY: number): Promise<void> {
  if (!host || !username) return;
  const card = $('sf-mention-card');
  if (!card) return;
  if (mentionHideTimer) {
    clearTimeout(mentionHideTimer);
    mentionHideTimer = null;
  }
  const res = await host.messengerRequest({
    path: '/social/users/lookup',
    query: { username },
  });
  if (!res.ok || !res.data?.user) {
    card.classList.add('hidden');
    return;
  }
  const u = res.data.user;
  const av = avatarImgBits({
    skinUrl: u.skinUrl,
    uuid: u.uuid,
    username: u.username,
    provider: u.provider,
  });
  const online = String(u.presenceStatus || '') === 'online';
  card.innerHTML = `
    <div class="sf-mention-card__row">
      <img class="sf-mention-card__avatar msgr-avatar__skeleton" onload="this.classList.remove('msgr-avatar__skeleton')" src="${host.escapeHtml(av.src)}"${av.attr} alt="">
      <div>
        <div class="sf-mention-card__name">${host.escapeHtml(u.username || '')}${verifiedHtml(Boolean(u.verified))}</div>
        <div class="sf-mention-card__status${online ? ' is-online' : ''}">${host.escapeHtml(presenceLabel(u.presenceStatus))}</div>
      </div>
    </div>
    <div class="sf-mention-card__meta">
      <div>Постов: <b>${Number(u.postCount || 0)}</b></div>
      ${u.lastBuild ? `<div>Сборка: <b>${host.escapeHtml(String(u.lastBuild))}</b></div>` : ''}
      ${u.favoriteBuild ? `<div>Любимая: <b>${host.escapeHtml(String(u.favoriteBuild))}</b></div>` : ''}
      ${u.lastServer ? `<div>Сервер: <b>${host.escapeHtml(String(u.lastServer))}</b></div>` : ''}
    </div>`;
  card.classList.remove('hidden');
  const pad = 12;
  const w = card.offsetWidth || 260;
  const h = card.offsetHeight || 120;
  let left = clientX - w / 2;
  let top = clientY - h - 14;
  left = Math.max(pad, Math.min(left, window.innerWidth - w - pad));
  if (top < pad) top = clientY + 18;
  card.style.left = `${left}px`;
  card.style.top = `${top}px`;
}

function hideMentionCardSoon(): void {
  if (mentionHideTimer) clearTimeout(mentionHideTimer);
  mentionHideTimer = setTimeout(() => {
    $('sf-mention-card')?.classList.add('hidden');
  }, 180);
}

async function updateMentionSuggest(textarea: HTMLTextAreaElement): Promise<void> {
  if (!host) return;
  const box = $('sf-mention-suggest');
  if (!box) return;
  const val = textarea.value;
  const caret = textarea.selectionStart ?? val.length;
  const before = val.slice(0, caret);
  const m = before.match(/@([A-Za-z0-9_]{1,32})$/);
  if (!m) {
    box.classList.add('hidden');
    return;
  }
  const q = m[1];
  if (q.length < 2) {
    box.classList.add('hidden');
    return;
  }
  const res = await host.messengerRequest({
    path: '/users/search',
    query: { q, limit: 8 },
  });
  const users = res.ok ? res.data?.users || [] : [];
  if (!users.length) {
    box.classList.add('hidden');
    return;
  }
  box.innerHTML = users
    .map((u: any) => {
      const name = String(u.username || '');
      const av = avatarImgBits({
        skinUrl: u.skinUrl,
        uuid: u.uuid,
        username: name,
        provider: u.provider,
      });
      return `<button type="button" class="sf-mention-suggest__item" data-sf-insert-mention="${host!.escapeHtml(name)}" role="option">
        <img src="${host!.escapeHtml(av.src)}"${av.attr} alt="">
        <span>${host!.escapeHtml(name)}</span>
      </button>`;
    })
    .join('');
  const rect = textarea.getBoundingClientRect();
  box.style.left = `${rect.left}px`;
  box.style.top = `${rect.bottom + 6}px`;
  box.classList.remove('hidden');
}

function insertMention(username: string): void {
  const ta = $('sf-composer-input') as HTMLTextAreaElement | null;
  const box = $('sf-mention-suggest');
  if (!ta) return;
  const val = ta.value;
  const caret = ta.selectionStart ?? val.length;
  const before = val.slice(0, caret);
  const after = val.slice(caret);
  const replaced = before.replace(/@([A-Za-z0-9_]{0,32})$/, `@${username} `);
  ta.value = replaced + after;
  const pos = replaced.length;
  ta.focus();
  ta.setSelectionRange(pos, pos);
  box?.classList.add('hidden');
}

/** Клик по фото поста открывает просмотр картинок, по ролику — видеоплеер. */
function onPostImageClick(e: Event): void {
  const t = e.target as HTMLElement | null;
  if (!t || typeof t.closest !== 'function') return;
  const vid = t.closest('[data-sf-video]') as HTMLElement | null;
  if (vid) {
    e.preventDefault();
    e.stopPropagation();
    const carousel = vid.closest('[data-sf-carousel]');
    const nodes = carousel ? Array.from(carousel.querySelectorAll('[data-sf-video]')) : [vid];
    const batch = nodes
      .map((el) => ({ src: el.getAttribute('data-sf-video') || '' }))
      .filter((it) => it.src);
    if (!batch.length) return;
    // Листание только по роликам этого поста. Один ролик — без галереи.
    openVideoViewer(batch, Math.max(0, nodes.indexOf(vid)));
    return;
  }
  const zoomEl = t.closest('[data-sf-zoom]') as HTMLElement | null;
  if (!zoomEl) return;
  e.preventDefault();
  e.stopPropagation();
  const carousel = zoomEl.closest('[data-sf-carousel]');
  const nodes = carousel
    ? Array.from(carousel.querySelectorAll('[data-sf-zoom]'))
    : [zoomEl];
  const batch = nodes
    .map((el) => ({ src: el.getAttribute('data-sf-zoom') || '' }))
    .filter((it) => it.src);
  if (!batch.length) return;
  openImageViewer(batch, Math.max(0, nodes.indexOf(zoomEl)));
}

function placeNewsRail(): void {
  const page = document.getElementById('news-page');
  const rail = document.getElementById('sf-rail');
  const tab = document.getElementById('tab-news');
  if (!page || !rail) return;
  const rect = page.getBoundingClientRect();
  const shown = Boolean(tab?.classList.contains('active')) && rect.width > 80;
  if (!shown) {
    rail.classList.remove('is-placed');
    return;
  }
  const pad = parseFloat(getComputedStyle(page).paddingRight) || 0;
  const width = rail.offsetWidth || 280;
  rail.style.left = `${Math.round(rect.right - pad - width)}px`;
  rail.classList.add('is-placed');
}

function watchNewsRail(): void {
  placeNewsRail();
  const tab = document.getElementById('tab-news');
  const page = document.getElementById('news-page');
  if (typeof ResizeObserver === 'undefined') {
    window.addEventListener('resize', placeNewsRail);
    return;
  }
  const observer = new ResizeObserver(() => placeNewsRail());
  if (tab) observer.observe(tab);
  if (page) observer.observe(page);
  window.addEventListener('resize', placeNewsRail);
}

function finishDetailsMotion(details: HTMLDetailsElement, body: HTMLElement, opened: boolean): void {
  if (!opened) {
    details.open = false;
    details.classList.remove('is-closing');
  }
  body.style.height = opened ? 'auto' : '';
  body.style.opacity = '';
  details.dataset.sfAnim = '';
}

function watchDetailsMotion(details: HTMLDetailsElement, body: HTMLElement, opened: boolean): void {
  let timer = 0;
  const done = (ev: TransitionEvent) => {
    if (ev.target !== body || ev.propertyName !== 'height') return;
    body.removeEventListener('transitionend', done);
    window.clearTimeout(timer);
    finishDetailsMotion(details, body, opened);
  };
  timer = window.setTimeout(() => {
    body.removeEventListener('transitionend', done);
    finishDetailsMotion(details, body, opened);
  }, 420);
  body.addEventListener('transitionend', done);
}

// Нативный details прячет тело сразу. Высоту анимируем сами и снимаем open только после закрытия.
function bindDetailsMotion(): void {
  document.addEventListener(
    'click',
    (e) => {
      const summary = (e.target as HTMLElement | null)?.closest?.('summary');
      const details = summary?.parentElement as HTMLDetailsElement | null;
      if (!summary || !details || details.tagName !== 'DETAILS' || !details.classList.contains('sf-details')) return;
      if ((e.target as HTMLElement).closest('a, button')) return;
      e.preventDefault();
      e.stopPropagation();
      const body = details.querySelector(':scope > .sf-details__body') as HTMLElement | null;
      if (!body) {
        details.open = !details.open;
        return;
      }
      const reduced =
        window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
        document.documentElement.classList.contains('animations-off');
      if (reduced) {
        details.open = !details.open;
        details.classList.remove('is-closing');
        body.style.height = '';
        body.style.opacity = '';
        details.dataset.sfAnim = '';
        return;
      }
      if (details.dataset.sfAnim === '1') return;
      details.dataset.sfAnim = '1';
      if (details.open) {
        details.classList.add('is-closing');
        body.style.height = `${body.scrollHeight}px`;
        body.style.opacity = '1';
        void body.offsetHeight;
        body.style.height = '0px';
        body.style.opacity = '0';
        watchDetailsMotion(details, body, false);
        return;
      }
      details.classList.remove('is-closing');
      details.open = true;
      body.style.height = '0px';
      body.style.opacity = '0';
      void body.offsetHeight;
      body.style.height = `${body.scrollHeight}px`;
      body.style.opacity = '1';
      watchDetailsMotion(details, body, true);
    },
    true,
  );
}

function bindUi(): void {
  if (bound) return;
  bound = true;
  watchNewsRail();
  bindDetailsMotion();

  document.addEventListener('click', onPostImageClick, true);
  // Аватар игрока открывает карточку, а не пост и не «Читать».
  document.addEventListener(
    'click',
    (e) => {
      const avatar = (e.target as HTMLElement | null)?.closest?.('[data-sf-user-id], [data-sf-profile]') as HTMLElement | null;
      if (!avatar) return;
      const name = (avatar.getAttribute('data-sf-profile') || '').trim();
      const userId = (avatar.getAttribute('data-sf-user-id') || '').trim();
      if (!name && !userId) return;
      e.preventDefault();
      e.stopPropagation();
      void host?.openUserProfile?.(name, userId);
    },
    true,
  );
  document.getElementById('sf-new-post-btn')?.addEventListener('click', () => openComposeModal());
  $('sf-composer')?.addEventListener('submit', (e) => {
    e.preventDefault();
    void publishPost();
  });
  document.getElementById('sf-notifications-btn')?.addEventListener('click', () => {
    host?.showToast(host.t('news.notificationsSoon') || 'Уведомления скоро появятся');
  });
  document.getElementById('news-refresh-btn')?.addEventListener('click', () => {
    void loadSocialFeed(true);
  });
  document.querySelectorAll('.nr-tabs__btn[data-nr-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = (btn.getAttribute('data-nr-tab') || 'recommend') as FeedTab;
      setFeedTab(tab);
    });
  });
  const search = $('sf-feed-search') as HTMLInputElement | null;
  search?.addEventListener('input', () => {
    feedQuery = search.value || '';
    paintFeed();
  });
  $('sf-rail')?.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const period = t.closest('[data-sf-period]') as HTMLElement | null;
    if (period) {
      popularPeriod = (period.getAttribute('data-sf-period') || '7') as '7' | '30' | 'all';
      paintRail();
      return;
    }
    const tag = t.closest('[data-sf-tag]') as HTMLElement | null;
    if (tag) {
      applyHashtag(tag.getAttribute('data-sf-tag') || '');
      return;
    }
    const read = t.closest('[data-sf-read]') as HTMLElement | null;
    if (read) {
      const id = read.getAttribute('data-sf-read') || '';
      void host
        ?.messengerRequest({ method: 'POST', path: `/social/users/${encodeURIComponent(id)}/follow` })
        .then(() => loadCommunity());
      return;
    }
    const pop = t.closest('[data-sf-pop]') as HTMLElement | null;
    if (pop) void openPostModal(pop.getAttribute('data-sf-pop') || '');
  });

  document.querySelectorAll('[data-sf-repost-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = (btn.getAttribute('data-sf-repost-tab') || 'wall') as 'wall' | 'chats';
      repostTab = tab;
      document.querySelectorAll('[data-sf-repost-tab]').forEach((el) => {
        el.classList.toggle('is-active', el === btn);
      });
      $('sf-repost-panel-wall')?.classList.toggle('hidden', tab !== 'wall');
      $('sf-repost-panel-chats')?.classList.toggle('hidden', tab !== 'chats');
    });
  });

  const composerInput = $('sf-composer-input') as HTMLTextAreaElement | null;
  composerInput?.addEventListener('input', () => {
    autosizeComposer();
    void updateMentionSuggest(composerInput);
  });
  composerInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') $('sf-mention-suggest')?.classList.add('hidden');
  });
  document.addEventListener('mousedown', (e) => {
    const box = $('sf-composer');
    if (!box) return;
    const target = e.target as Node | null;
    if (target && box.contains(target)) return;
    if (target && $('sf-mention-suggest')?.contains(target)) return;
    const active = document.activeElement as HTMLElement | null;
    if (active && box.contains(active)) active.blur();
  });
  document.addEventListener(
    'click',
    (e) => {
      const tag = (e.target as HTMLElement).closest('.sf-hashtag') as HTMLElement | null;
      if (!tag) return;
      e.preventDefault();
      e.stopPropagation();
      applyHashtag(tag.getAttribute('data-sf-tag') || '');
    },
    true,
  );
  $('sf-mention-suggest')?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-sf-insert-mention]') as HTMLElement | null;
    if (!btn) return;
    insertMention(btn.getAttribute('data-sf-insert-mention') || '');
  });

  document.addEventListener(
    'mouseover',
    (e) => {
      const mention = (e.target as HTMLElement).closest('.sf-mention') as HTMLElement | null;
      if (!mention) return;
      const name = mention.getAttribute('data-sf-user') || '';
      const ev = e as MouseEvent;
      void showMentionCard(name, ev.clientX, ev.clientY);
    },
    true,
  );
  document.addEventListener(
    'mouseout',
    (e) => {
      const mention = (e.target as HTMLElement).closest('.sf-mention');
      if (mention) hideMentionCardSoon();
    },
    true,
  );
  document.addEventListener('click', (e) => {
    const mention = (e.target as HTMLElement).closest('.sf-mention') as HTMLElement | null;
    if (!mention) return;
    e.preventDefault();
    e.stopPropagation();
    const name = mention.getAttribute('data-sf-user') || '';
    if (!name) return;
    $('sf-mention-card')?.classList.add('hidden');
    void host?.openUserProfile?.(name);
  });
  document.getElementById('sf-composer-plus')?.addEventListener('click', () => {
    $('sf-photo-input')?.click();
  });
  $('sf-photo-input')?.addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files || []).slice(0, 6 - pendingJpegs.length);
    for (const f of files) {
      try {
        pendingJpegs.push(await fileToJpegDataUrl(f));
      } catch {
        host?.showToast('Не удалось сжать фото в JPEG');
      }
    }
    input.value = '';
    renderComposerPreviews();
  });
  $('sf-composer-previews')?.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (!t.matches('img[data-rm]')) return;
    const i = Number(t.getAttribute('data-rm'));
    if (Number.isFinite(i)) {
      pendingJpegs.splice(i, 1);
      renderComposerPreviews();
    }
  });

  document.getElementById('modal-sf-clan-close')?.addEventListener('click', () => {
    host?.closeModal('modal-sf-clan');
  });
  document.getElementById('modal-sf-clan-cancel')?.addEventListener('click', () => {
    host?.closeModal('modal-sf-clan');
  });
  document.getElementById('modal-sf-clan-ok')?.addEventListener('click', () => void submitClan());
  document.getElementById('sf-clan-icon-btn')?.addEventListener('click', () => {
    $('sf-clan-icon-input')?.click();
  });
  $('sf-clan-icon-input')?.addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      pendingClanIcon = await fileToJpegDataUrl(file);
      const preview = $('sf-clan-icon-preview') as HTMLImageElement | null;
      if (preview) {
        preview.src = pendingClanIcon;
        preview.style.display = 'block';
      }
    } catch {
      host?.showToast('Не удалось обработать иконку');
    }
    input.value = '';
  });

  document.getElementById('modal-sf-repost-close')?.addEventListener('click', () => {
    host?.closeModal('modal-sf-repost');
  });
  document.getElementById('modal-sf-repost-cancel')?.addEventListener('click', () => {
    host?.closeModal('modal-sf-repost');
  });
  document.getElementById('modal-sf-repost-ok')?.addEventListener('click', () => void submitRepost());

  document.getElementById('modal-sf-post-close')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    host?.closeModal('modal-sf-post');
  });
  document.getElementById('modal-sf-post')?.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    // Как у остальных модалок: клик по затемнению закрывает окно, клик по карточке — нет.
    if (e.target === e.currentTarget) {
      host?.closeModal('modal-sf-post');
      return;
    }
    if (t.closest('#modal-sf-post-close')) {
      e.preventDefault();
      host?.closeModal('modal-sf-post');
      return;
    }
    if (t.closest('[data-sf-carousel-prev], [data-sf-carousel-next], [data-sf-carousel-dot]')) return;

    const cMenuBtn = t.closest('[data-sf-cmenu]') as HTMLElement | null;
    if (cMenuBtn) {
      e.preventDefault();
      e.stopPropagation();
      const id = cMenuBtn.getAttribute('data-sf-cmenu') || '';
      const drop = document.querySelector(
        `[data-sf-cdropdown="${String(id).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`,
      );
      const wasOpen = drop && !drop.classList.contains('hidden');
      closeAllCommentMenus();
      if (!wasOpen && drop) {
        drop.classList.remove('hidden');
        cMenuBtn.classList.add('is-open');
      }
      return;
    }

    const cDel = t.closest('[data-sf-cdelete]') as HTMLElement | null;
    if (cDel) {
      e.preventDefault();
      e.stopPropagation();
      void deleteComment(cDel.getAttribute('data-sf-cdelete') || '');
      return;
    }

    const reply = t.closest('[data-sf-reply]') as HTMLElement | null;
    if (reply) {
      e.preventDefault();
      e.stopPropagation();
      closeAllCommentMenus();
      replyParentId = reply.getAttribute('data-sf-reply') || '';
      replyParentName = reply.getAttribute('data-sf-reply-name') || '';
      syncCommentComposerHint();
      ($('sf-comment-input') as HTMLTextAreaElement | null)?.focus();
      return;
    }
    if (t.closest('#sf-comment-send') || t.closest('.sf-pm__send')) {
      e.preventDefault();
      void sendComment();
      return;
    }
    const react = t.closest('[data-sf-react]') as HTMLElement | null;
    if (react) {
      e.stopPropagation();
      const id = react.getAttribute('data-sf-react') || '';
      const emoji = react.getAttribute('data-emoji') || '❤️';
      void host
        ?.messengerRequest({
          method: 'POST',
          path: `/social/posts/${encodeURIComponent(id)}/react`,
          body: { emoji },
        })
        .then(async () => {
          await loadCommunity();
          if (activePostId) void openPostModal(activePostId);
        });
      return;
    }
    const repost = t.closest('[data-sf-repost]') as HTMLElement | null;
    if (repost) {
      e.stopPropagation();
      void openRepostModal(repost.getAttribute('data-sf-repost') || '');
      return;
    }
    const expand = t.closest('[data-sf-expand]') as HTMLElement | null;
    if (expand) {
      e.stopPropagation();
      void openPostModal(expand.getAttribute('data-sf-expand') || '');
      return;
    }
    if (!t.closest('[data-sf-cmenu]') && !t.closest('[data-sf-cdropdown]')) {
      closeAllCommentMenus();
    }
  });
  document.getElementById('modal-sf-post')?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    if ((e.target as HTMLElement)?.id !== 'sf-comment-input') return;
    e.preventDefault();
    void sendComment();
  });

  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (handleCarouselClick(t, e)) return;
    if (t.closest('[data-sf-menu], .sf-post__dropdown, [data-sf-flag], .sf-flag__menu, [data-sf-follow]')) return;
    if (t.closest('[data-sf-cmenu], [data-sf-cdropdown]')) return;
    closeFloatMenus(false);
    closeAllCommentMenus();
  });
  document.addEventListener(
    'scroll',
    (e) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest) return;
      if (!target.closest('#tab-news, #sf-community-list, #msgr-profile-feed, #msgr-profile-posts, .sf-pm__scroll')) return;
      closeFloatMenus(true);
    },
    true,
  );

  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (!t.closest('#sf-community-list, #msgr-profile-posts, .sf-post__dropdown, .sf-flag__menu')) return;
    if (t.closest('[data-sf-carousel-prev], [data-sf-carousel-next], [data-sf-carousel-dot]')) return;

    const officialBtn = t.closest('[data-sf-official]') as HTMLElement | null;
    if (officialBtn) {
      e.preventDefault();
      e.stopPropagation();
      host?.openOfficialNews(officialBtn.getAttribute('data-sf-official') || '');
      return;
    }

    const followBtn = t.closest('[data-sf-follow]') as HTMLElement | null;
    if (followBtn) {
      e.preventDefault();
      e.stopPropagation();
      closeFloatMenus(false);
      void togglePostFollow(followBtn.getAttribute('data-sf-follow') || '');
      return;
    }

    const menuBtn = t.closest('[data-sf-menu]') as HTMLElement | null;
    if (menuBtn) {
      e.preventDefault();
      e.stopPropagation();
      const id = menuBtn.getAttribute('data-sf-menu') || '';
      const drop = document.querySelector(`[data-sf-dropdown="${CSS.escape(id)}"]`) as HTMLElement | null;
      const wasOpen = Boolean(drop?.classList.contains('is-open'));
      if (wasOpen) closeFloatMenus(false);
      else if (drop) openFloatMenu(drop, menuBtn, false);
      return;
    }

    const del = t.closest('[data-sf-delete]') as HTMLElement | null;
    if (del) {
      e.preventDefault();
      e.stopPropagation();
      void deletePost(del.getAttribute('data-sf-delete') || '');
      return;
    }

    const reportPick = t.closest('[data-sf-report-reason]') as HTMLElement | null;
    if (reportPick) {
      e.preventDefault();
      e.stopPropagation();
      void reportPost(
        reportPick.getAttribute('data-sf-report-reason') || '',
        reportPick.getAttribute('data-reason') || 'other',
      );
      return;
    }

    const report = t.closest('[data-sf-report]') as HTMLElement | null;
    if (report) {
      e.preventDefault();
      e.stopPropagation();
      const id = report.getAttribute('data-sf-report') || '';
      const drop = report.parentElement;
      if (drop) {
        drop.innerHTML = [
          ['spam', 'Спам'],
          ['abuse', 'Оскорбления'],
          ['other', 'Другое'],
        ]
          .map(
            ([reason, label]) =>
              `<button type="button" data-sf-report-reason="${host!.escapeHtml(id)}" data-reason="${reason}" role="menuitem">${label}</button>`,
          )
          .join('');
      }
      return;
    }

    const flag = t.closest('[data-sf-flag]') as HTMLElement | null;
    if (flag) {
      e.preventDefault();
      e.stopPropagation();
      const id = flag.getAttribute('data-sf-flag') || '';
      const menu = document.querySelector(`[data-sf-flag-menu="${CSS.escape(id)}"]`) as HTMLElement | null;
      const wasOpen = Boolean(menu?.classList.contains('is-open'));
      if (wasOpen) closeFloatMenus(false);
      else if (menu) openFloatMenu(menu, flag, true);
      return;
    }

    const bookmark = t.closest('[data-sf-bookmark]') as HTMLElement | null;
    if (bookmark) {
      e.preventDefault();
      e.stopPropagation();
      const id = bookmark.getAttribute('data-sf-bookmark') || '';
      toggleBookmark(id);
      bookmark.classList.toggle('is-saved', isBookmarked(id));
      return;
    }

    const expand = t.closest('[data-sf-expand]') as HTMLElement | null;
    if (expand) {
      e.stopPropagation();
      closeAllPostMenus();
      void openPostModal(expand.getAttribute('data-sf-expand') || '');
      return;
    }
    const react = t.closest('[data-sf-react]') as HTMLElement | null;
    if (react) {
      e.stopPropagation();
      const id = react.getAttribute('data-sf-react') || '';
      const emoji = react.getAttribute('data-emoji') || '❤️';
      void host
        ?.messengerRequest({
          method: 'POST',
          path: `/social/posts/${encodeURIComponent(id)}/react`,
          body: { emoji },
        })
        .then(() => loadCommunity());
      return;
    }
    const repost = t.closest('[data-sf-repost]') as HTMLElement | null;
    if (repost) {
      e.stopPropagation();
      void openRepostModal(repost.getAttribute('data-sf-repost') || '');
      return;
    }

    if (t.closest('a, summary')) return;
    // Клик по карточке поста (не по кнопкам) — модалка с комментариями
    const card = t.closest('.sf-post') as HTMLElement | null;
    if (card?.dataset.officialId) {
      host?.openOfficialNews(card.dataset.officialId);
      return;
    }
    if (card?.dataset.postId) {
      void openPostModal(card.dataset.postId);
    }
  });
}

export async function loadSocialFeed(force = false): Promise<void> {
  if (!host) return;
  bindUi();
  syncAccountAvatars();
  if (!feedReady) paintLoadingBlocks();
  await refreshClansSelect();
  if (newsView === 'official') setFeedTab('articles');
  await loadCommunity();
  void force;
}

let framesWatching = false;

/** Любой новый кадр с картинкой (лента, модалка, чат, профиль) получает шиммер до загрузки. */
function watchContentFrames(): void {
  if (framesWatching) return;
  framesWatching = true;
  const obs = new MutationObserver((records) => {
    for (const rec of records) {
      rec.addedNodes.forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        const hostNode = node.classList.contains('uc-frame')
          ? node
          : node.closest('.uc-frame') || (node.querySelector('.uc-frame') ? node : null);
        if (hostNode) armContentFrames(hostNode);
      });
    }
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
}

export function initSocialFeed(h: SocialHost): void {
  host = h;
  // Крестик и клик по оверлею должны работать и если пост открыли из чата,
  // не заходя во вкладку «Новости» (loadSocialFeed тоже вызывает bindUi).
  bindUi();
  watchContentFrames();
  if (!feedReady) paintLoadingBlocks();
}

/** Открыть пост сообщества по id, подгрузив его, если его ещё нет в ленте. */
export async function openSocialPost(postId: string): Promise<void> {
  if (!host || !postId) return;
  if (!communityPosts.some((p) => p.id === postId)) {
    const res = await host.messengerRequest({
      path: `/social/posts/${encodeURIComponent(postId)}`,
    });
    const post = (res.data?.post || res.data) as FeedPost | undefined;
    if (!res.ok || !post?.id) {
      host.showToast(host.t('news.openFailed') || 'Не удалось открыть пост');
      return;
    }
    communityPosts.unshift(post);
  }
  await openPostModal(postId);
}

export async function fetchUserSocialPosts(userId: string): Promise<FeedPost[]> {
  if (!host || !userId) return [];
  const postsReq = host.messengerRequest({
    path: `/social/users/${encodeURIComponent(userId)}/posts`,
    query: { limit: 20 },
  });
  const sideReq = followingKnown
    ? null
    : host.messengerRequest({
        path: '/social/feed',
        query: { channel: 'community', limit: 1 },
      });
  const [res, side] = await Promise.all([postsReq, sideReq]);
  if (side?.ok && Array.isArray(side.data?.followingIds)) {
    followingIds = side.data.followingIds.map(String);
    followingKnown = true;
  }
  return res.ok ? res.data?.posts || [] : [];
}

export function renderUserPostsHtml(posts: FeedPost[]): string {
  if (!posts.length) return `<div class="sf-empty">Постов пока нет</div>`;
  return posts.map(renderPostCard).join('');
}
