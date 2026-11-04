// ===== Социальная лента: Стена + новости лаунчера (newsRemaster) =====

import { getApiBase, skinImageUrl, DEFAULT_ACCOUNT_SKIN_URL } from '../shared/apiBase';

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
  resolveNewsCoverUrl?: (url: string | null | undefined) => string;
  messengerRequest: (payload: {
    method?: string;
    path: string;
    body?: unknown;
    query?: Record<string, string | number | undefined>;
  }) => Promise<{ ok: boolean; data?: any; error?: string; code?: string }>;
  listNewsOfficial: () => Promise<
    Array<{ id: string; title: string; summary?: string; cover?: string; date?: string }>
  >;
  openOfficialNews: (id: string) => void;
  listConversationsForRepost?: () => Promise<Array<{ id: string; title: string }>>;
  openUserProfile?: (username: string) => Promise<void>;
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
  attachments?: Array<{ id: string; url: string }>;
  reactions?: { counts: Record<string, number>; mine: string[] };
  repostCount?: number;
  commentCount?: number;
  repostOf?: FeedPost | null;
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
  like: '../../assets/icons/like.svg',
  likeActive: '../../assets/icons/like-active.svg',
  comment: '../../assets/icons/comment.svg',
  repost: '../../assets/icons/repost.svg',
  verify: '../../assets/icons/verify.svg',
};

const CLAN_FALLBACK_AVATAR = '../../assets/icons/undefinedacc.svg';

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
    return `${base.replace(/\/client$/, '')}${u}`;
  }
  if (u.startsWith('/')) return `${base}${u}`;
  return u;
}

// ===== Аватары (Ely: кроп головы со скина, MSA: mc-heads) =====
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

function elySkinSource(opts: AvatarOpts): string {
  const skin = toHttps(String(opts.skinUrl || '').trim());
  if (skin) return skinImageUrl(skin) || skin;
  // skinsystem/{nick}.png часто 404 — дефолтная текстура, как в мессенджере
  return skinImageUrl(DEFAULT_ACCOUNT_SKIN_URL) || DEFAULT_ACCOUNT_SKIN_URL;
}

function cropSkinHead(skinUrl: string, size = 64): Promise<string | null> {
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
      const url = cropped || skinSrc;
      avatarCache.set(key, url);
      return url;
    })
    .finally(() => {
      avatarInflight.delete(key);
    });
  avatarInflight.set(key, task);
  void task.then((url) => applyAvatarInDom(key, url));
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

  // Ely: mc-heads не знает UUID → Steve; кропаем голову с текстуры
  if (isElyAvatar(merged)) {
    const src = elySkinSource(merged);
    if (key) ensureAvatarCrop(key, src);
    return (key && avatarCache.get(key)) || src;
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
function avatarImgBits(opts: AvatarOpts): { src: string; attr: string } {
  const key = avatarKey(opts);
  const src = resolveAvatar(opts);
  const attr = key && host ? ` data-sf-avatar="${host.escapeHtml(key)}"` : '';
  return { src, attr };
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
    };
  }
  if (post.author?.type === 'launcher') {
    const bits = avatarImgBits({ username: 'MHF_Question' });
    return {
      name: 'Undefined Client',
      avatar: bits.src,
      avatarAttr: bits.attr,
      verified: true,
      isClan: false,
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
  };
}

function likeCount(post: FeedPost): number {
  const c = post.reactions?.counts || {};
  return Number(c['❤️'] || 0) + Number(c['👍'] || 0) + Number(c['🔥'] || 0);
}

function likedMine(post: FeedPost): boolean {
  const mine = post.reactions?.mine || [];
  return mine.includes('❤️') || mine.includes('👍') || mine.includes('🔥');
}

/** Карусель вложений: точки снизу, круглые стрелки слева/справа */
function renderMediaCarousel(
  attachments: Array<{ id?: string; url: string }> | undefined,
  opts?: { className?: string; zoom?: boolean },
): string {
  if (!host) return '';
  const list = (attachments || []).filter((a) => String(a?.url || '').trim());
  if (!list.length) return '';
  const wrapClass = opts?.className || 'sf-post__media';
  const slides = list
    .map((a) => {
      const src = absMedia(a.url);
      const zoom = opts?.zoom
        ? ` data-sf-zoom="${host!.escapeHtml(src)}"`
        : '';
      return `<div class="sf-carousel__slide"><img src="${host!.escapeHtml(src)}" alt="" loading="lazy"${zoom}></div>`;
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

function renderQuote(post: FeedPost): string {
  if (!host || !post.repostOf) return '';
  const q = post.repostOf;
  const who = authorBits(q);
  const body = host.renderMarkdown(q.bodyMd || '');
  const media = (q.attachments || [])
    .slice(0, 1)
    .map((a) => `<div class="sf-quote__media"><img src="${host!.escapeHtml(absMedia(a.url))}" alt=""></div>`)
    .join('');
  return `<div class="sf-quote" data-sf-expand="${host.escapeHtml(q.id)}">
    <div class="sf-quote__head">
      <img class="sf-quote__avatar" src="${host.escapeHtml(who.avatar)}"${who.avatarAttr} alt="">
      <span class="sf-quote__name">${host.escapeHtml(who.name)}${verifiedHtml(who.verified)}</span>
      <span class="sf-quote__time">${host.escapeHtml(timeAgo(q.createdAt))}</span>
    </div>
    <div class="sf-quote__body">${body}</div>
    ${media}
  </div>`;
}

function renderPostCard(post: FeedPost): string {
  if (!host) return '';
  const who = authorBits(post);
  const htmlBody = host.renderMarkdown(post.bodyMd || '');
  const plainLen = String(post.bodyMd || '').length;
  const clamp = plainLen > 420;
  const media = renderMediaCarousel(post.attachments, { zoom: true });
  const likes = likeCount(post);
  const liked = likedMine(post);
  const comments = Number(post.commentCount || 0);
  const reposts = Number(post.repostCount || 0);
  const hasText = Boolean(String(post.bodyMd || '').trim());

  const likeSrc = liked ? ICON.likeActive : ICON.like;
  const timeLabel = `${timeAgo(post.createdAt)}${post.repostOf ? ' · репост' : ''}`;

  return `<article class="sf-post" data-post-id="${host.escapeHtml(post.id)}">
    <div class="sf-post__head">
      <div class="sf-post__avatar-wrap">
        <img class="sf-post__avatar${who.isClan ? ' is-clan' : ''}" src="${host.escapeHtml(who.avatar)}"${who.avatarAttr} alt="" loading="lazy">
      </div>
      <div class="sf-post__who">
        <div class="sf-post__name-row">
          <span class="sf-post__name">${host.escapeHtml(who.name)}</span>
          ${verifiedHtml(who.verified)}
        </div>
        <span class="sf-post__time">${host.escapeHtml(timeLabel)}</span>
      </div>
      <div class="sf-post__menu-wrap">
        <button type="button" class="sf-post__menu" data-sf-menu="${host.escapeHtml(post.id)}" aria-label="Меню" aria-haspopup="true">${MENU_SVG}</button>
        <div class="sf-post__dropdown hidden" data-sf-dropdown="${host.escapeHtml(post.id)}" role="menu">
          <button type="button" data-sf-expand="${host.escapeHtml(post.id)}" role="menuitem">${host.escapeHtml(host.t('news.openPost') || 'Открыть')}</button>
          ${
            post.canDelete
              ? `<button type="button" class="is-danger" data-sf-delete="${host.escapeHtml(post.id)}" role="menuitem">${host.escapeHtml(host.t('news.deletePost') || 'Удалить')}</button>`
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
      <button type="button" class="sf-act${liked ? ' is-on' : ''}" data-sf-react="${host.escapeHtml(post.id)}" data-emoji="❤️" aria-label="Лайк">
        <img class="sf-act__img" src="${likeSrc}" width="16" height="16" alt="">
        <span class="sf-act__count">${likes}</span>
      </button>
      <button type="button" class="sf-act" data-sf-expand="${host.escapeHtml(post.id)}" aria-label="Комментарии">
        <img class="sf-act__img" src="${ICON.comment}" width="16" height="16" alt="">
        <span class="sf-act__count">${comments}</span>
      </button>
      <button type="button" class="sf-act${reposts ? '' : ' is-muted'}" data-sf-repost="${host.escapeHtml(post.id)}" aria-label="Репост">
        <img class="sf-act__img" src="${ICON.repost}" width="16" height="16" alt="">
        <span class="sf-act__count">${reposts}</span>
      </button>
    </div>
  </article>`;
}

function setNewsView(view: 'community' | 'official'): void {
  newsView = view;
  const page = $('news-page');
  const feed = $('sf-community-list');
  const official = $('sf-official-news');
  page?.setAttribute('data-nr-view', view);
  document.querySelector('.nr-wall__left')?.setAttribute('aria-hidden', view === 'official' ? 'true' : 'false');
  document.querySelectorAll('.nr-type-switch__btn').forEach((btn) => {
    const on = btn.getAttribute('data-nr-view') === view;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  feed?.classList.toggle('hidden', view !== 'community');
  official?.classList.toggle('hidden', view !== 'official');
  if (official) official.setAttribute('aria-hidden', view === 'official' ? 'false' : 'true');
  if (view === 'official') {
    void showOfficialNews(false);
  } else {
    void loadCommunity();
  }
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
    .map((src, i) => `<img class="news-composer__preview" src="${src}" data-rm="${i}" alt="">`)
    .join('');
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
    el.src = bits.src;
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

async function loadCommunity(): Promise<void> {
  if (!host) return;
  const res = await host.messengerRequest({
    path: '/social/feed',
    query: { channel: 'community', limit: 40 },
  });
  communityPosts = res.ok ? res.data?.posts || [] : [];
  const list = $('sf-community-list');
  if (!list) return;
  if (!communityPosts.length) {
    list.innerHTML = `<div class="sf-empty">${host.escapeHtml(host.t('news.feedEmpty') || 'Пока тихо. Напиши первый пост.')}</div>`;
    return;
  }
  list.innerHTML = communityPosts.map(renderPostCard).join('');
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
        <img class="sf-pm-comment__avatar" src="${host.escapeHtml(av.src)}"${av.attr} alt="">
        <div class="sf-pm-comment__meta">
          <div class="sf-pm-comment__name">${host.escapeHtml(name)}${verifiedHtml(Boolean(c.author?.verified))}</div>
          <div class="sf-pm-comment__time">${host.escapeHtml(timeAgo(c.createdAt))}${replyHint}</div>
        </div>
        <div class="sf-pm-comment__actions">
          <button type="button" class="sf-pm-comment__reply" data-sf-reply="${host.escapeHtml(c.id)}" data-sf-reply-name="${host.escapeHtml(name)}">${host.escapeHtml(host.t('news.reply') || 'Ответить')}</button>
          ${menu}
        </div>
      </div>
      <div class="sf-pm-comment__body mod-details-body">${host.renderMarkdown(c.bodyMd || '')}</div>
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
    avatar.src = who.avatar;
    avatar.classList.toggle('is-clan', Boolean(who.isClan));
    if (who.avatarAttr) {
      const m = who.avatarAttr.match(/data-sf-avatar="([^"]*)"/);
      if (m?.[1]) avatar.setAttribute('data-sf-avatar', m[1]);
      else avatar.removeAttribute('data-sf-avatar');
    } else {
      avatar.removeAttribute('data-sf-avatar');
    }
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
    commentAvatar.src = bits.src;
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
        ${String(post.bodyMd || '').trim() ? `<div class="sf-pm__text mod-details-body">${host.renderMarkdown(post.bodyMd || '')}</div>` : ''}
        ${post.repostOf ? renderQuote({ ...post, id: post.id }) : ''}
        ${renderMediaCarousel(post.attachments, { className: 'sf-pm__media', zoom: true })}
        ${renderPostModalActions(post)}
        <div class="sf-pm__divider"></div>
        <div class="sf-pm__comments-title">${host.escapeHtml(host.t('news.comments') || 'Комментарии')}</div>
        <div class="sf-pm__composer-inline">
          <img class="sf-pm__composer-avatar" id="sf-comment-avatar-inline" alt="">
          <div class="sf-pm__composer-box">
            <div id="sf-comment-reply-hint" class="sf-pm-reply-hint hidden"></div>
            <textarea id="sf-comment-input" rows="2" maxlength="2000" placeholder="Написать комментарий…" data-i18n-placeholder="news.commentPlaceholder"></textarea>
            <button type="button" class="sf-pm__send" id="sf-comment-send" aria-label="Отправить">${SEND_SVG}</button>
          </div>
        </div>
        <div id="sf-comments-list" class="sf-pm__comments"><div class="sf-empty sf-pm-empty">…</div></div>
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
      inlineAv.src = bits.src;
      const key = avatarKey({
        skinUrl: acc?.skinUrl,
        uuid: acc?.uuid,
        username: acc?.username || acc?.name,
        provider: accountProvider(acc),
      });
      if (key) inlineAv.setAttribute('data-sf-avatar', key);
    }
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
  if (!res.ok) {
    box.innerHTML = `<div class="sf-empty sf-pm-empty">${host.escapeHtml(res.error || 'Не удалось загрузить комментарии')}</div>`;
    return;
  }
  box.innerHTML = renderCommentsHtml(res.data?.comments || []);
}

async function sendComment(): Promise<void> {
  if (!host || !activePostId) return;
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
    host.showToast(res.error || 'Не удалось отправить');
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
  syncAccountAvatars();
  void refreshClansSelect();
  host.openModal('modal-sf-compose');
  queueMicrotask(() => ($('sf-composer-input') as HTMLTextAreaElement | null)?.focus());
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

function closeAllPostMenus(): void {
  document.querySelectorAll('.sf-post__dropdown').forEach((el) => el.classList.add('hidden'));
  document.querySelectorAll('.sf-post__menu.is-open').forEach((el) => el.classList.remove('is-open'));
}

function closeAllCommentMenus(): void {
  document.querySelectorAll('.sf-pm-comment__dropdown').forEach((el) => el.classList.add('hidden'));
  document.querySelectorAll('.sf-pm-comment__menu.is-open').forEach((el) => el.classList.remove('is-open'));
}

async function deletePost(postId: string): Promise<void> {
  if (!host || !postId) return;
  const ok = window.confirm(host.t('news.deleteConfirm') || 'Удалить этот пост?');
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
  const ok = window.confirm(host.t('news.deleteCommentConfirm') || 'Удалить этот комментарий?');
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
  const input = $('sf-composer-input') as HTMLTextAreaElement | null;
  const text = String(input?.value || '').trim();
  if (!text) {
    host.showToast('Напиши текст поста');
    return;
  }
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
  if (!res.ok) {
    host.showToast(res.error || 'Не удалось опубликовать');
    return;
  }
  if (input) input.value = '';
  pendingJpegs = [];
  renderComposerPreviews();
  host.closeModal('modal-sf-compose');
  host.showToast('Пост опубликован');
  await loadCommunity();
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
      <img class="sf-mention-card__avatar" src="${host.escapeHtml(av.src)}"${av.attr} alt="">
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

function bindUi(): void {
  if (bound) return;
  bound = true;

  document.getElementById('sf-new-post-btn')?.addEventListener('click', () => openComposeModal());
  document.getElementById('sf-notifications-btn')?.addEventListener('click', () => {
    host?.showToast(host.t('news.notificationsSoon') || 'Уведомления скоро появятся');
  });
  document.getElementById('sf-wall-type')?.addEventListener('click', () => {
    if (newsView === 'community') void loadSocialFeed(true);
    else void showOfficialNews(true);
  });
  document.getElementById('news-refresh-btn')?.addEventListener('click', () => {
    if (newsView === 'community') void loadSocialFeed(true);
    else void showOfficialNews(true);
  });
  document.querySelectorAll('.nr-type-switch__btn[data-nr-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const view = (btn.getAttribute('data-nr-view') || 'community') as 'community' | 'official';
      setNewsView(view);
    });
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
    void updateMentionSuggest(composerInput);
  });
  composerInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') $('sf-mention-suggest')?.classList.add('hidden');
  });
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
  document.getElementById('modal-sf-compose-close')?.addEventListener('click', () => {
    host?.closeModal('modal-sf-compose');
  });
  document.getElementById('sf-composer-publish')?.addEventListener('click', () => void publishPost());
  document.getElementById('sf-create-clan')?.addEventListener('click', () => openClanModal());
  document.getElementById('sf-composer-photo')?.addEventListener('click', () => {
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

  document.getElementById('modal-sf-post-close')?.addEventListener('click', () => {
    host?.closeModal('modal-sf-post');
  });
  document.getElementById('modal-sf-post')?.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
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
    if (t.closest('[data-sf-menu]') || t.closest('[data-sf-dropdown]')) return;
    if (t.closest('[data-sf-cmenu]') || t.closest('[data-sf-cdropdown]')) return;
    closeAllPostMenus();
    closeAllCommentMenus();
  });

  document.getElementById('sf-community-list')?.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-sf-carousel-prev], [data-sf-carousel-next], [data-sf-carousel-dot]')) return;

    const menuBtn = t.closest('[data-sf-menu]') as HTMLElement | null;
    if (menuBtn) {
      e.preventDefault();
      e.stopPropagation();
      const id = menuBtn.getAttribute('data-sf-menu') || '';
      const drop = document.querySelector(
        `[data-sf-dropdown="${String(id).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`,
      );
      const wasOpen = drop && !drop.classList.contains('hidden');
      closeAllPostMenus();
      if (!wasOpen && drop) {
        drop.classList.remove('hidden');
        menuBtn.classList.add('is-open');
      }
      return;
    }

    const del = t.closest('[data-sf-delete]') as HTMLElement | null;
    if (del) {
      e.preventDefault();
      e.stopPropagation();
      void deletePost(del.getAttribute('data-sf-delete') || '');
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

    // Клик по карточке поста (не по кнопкам) — модалка с комментариями
    const card = t.closest('.sf-post') as HTMLElement | null;
    if (card?.dataset.postId) {
      void openPostModal(card.dataset.postId);
    }
  });
}

export async function loadSocialFeed(force = false): Promise<void> {
  if (!host) return;
  bindUi();
  syncAccountAvatars();
  await refreshClansSelect();
  if (newsView === 'official') {
    await showOfficialNews(force);
  } else {
    await loadCommunity();
  }
  void force;
}

export function initSocialFeed(h: SocialHost): void {
  host = h;
}

export async function fetchUserSocialPosts(userId: string): Promise<FeedPost[]> {
  if (!host || !userId) return [];
  const res = await host.messengerRequest({
    path: `/social/users/${encodeURIComponent(userId)}/posts`,
    query: { limit: 20 },
  });
  return res.ok ? res.data?.posts || [] : [];
}

export function renderUserPostsHtml(posts: FeedPost[]): string {
  if (!posts.length) return `<div class="sf-empty">Постов пока нет</div>`;
  return posts.map(renderPostCard).join('');
}
