// Стикеры чата. Видимые анимации играют; вне экрана плеер снимается, чтобы не грузить интерфейс.
import lottie from 'lottie-web/build/player/lottie_light_canvas';
import { S, activeKey } from './store';
import { sendText } from './nav';
import { assetUrl, esc } from './util';
import { clampToViewport, closeEmojiPicker, closeMenu, layer, openEmojiPicker, openModal, setStickerCloser, setStickerOpener, toast } from './overlays';

type StickerKind = 'lottie' | 'image' | 'video';
type Sticker = { id: number; pack: string; emoji: string; url: string; kind: StickerKind };
type Anim = { destroy: () => void; play: () => void; pause: () => void; goToAndStop: (frame: number, isFrame: boolean) => void; addEventListener: (name: string, cb: () => void) => void; setSubframe?: (flag: boolean) => void; currentFrame: number };

const jsonCache = new Map<string, Promise<unknown>>();
const MAX_LOADS = 3;

let panel: HTMLElement | null = null;
let catalog = new Map<number, Sticker>();
let loading = 0;
const pending: HTMLElement[] = [];

document.addEventListener('visibilitychange', () => {
  const hidden = document.hidden;
  document.querySelectorAll<HTMLElement>('.cv2-sticker[data-want="play"]').forEach((host) => {
    const anim = (host as HTMLElement & { _anim?: Anim })._anim;
    if (anim) {
      if (hidden) anim.pause();
      else anim.play();
    }
    const video = host.querySelector('video');
    if (!video) return;
    if (hidden) video.pause();
    else void video.play().catch(() => undefined);
  });
});

const io = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    const host = entry.target as HTMLElement;
    if (!entry.isIntersecting) {
      host.dataset.want = 'off';
      release(host);
      continue;
    }
    host.dataset.want = 'play';
    apply(host);
  }
}, { rootMargin: '80px' });

function kindOf(url: string, kind?: string): StickerKind {
  if (kind === 'image' || kind === 'video' || kind === 'lottie') return kind;
  if (/\.(webp|png|gif|jpe?g)(\?|$)/i.test(url)) return 'image';
  if (/\.webm(\?|$)/i.test(url)) return 'video';
  return 'lottie';
}

function loadJson(url: string): Promise<unknown> {
  let job = jsonCache.get(url);
  if (!job) {
    job = fetch(url).then((r) => {
      if (!r.ok) throw new Error('sticker');
      return r.json();
    });
    jsonCache.set(url, job);
    if (jsonCache.size > 24) jsonCache.delete(jsonCache.keys().next().value as string);
  }
  return job;
}

function release(host: HTMLElement): void {
  const i = pending.indexOf(host);
  if (i >= 0) pending.splice(i, 1);
  const anim = (host as HTMLElement & { _anim?: Anim })._anim;
  if (anim) {
    anim.destroy();
    delete (host as HTMLElement & { _anim?: Anim })._anim;
  }
  const video = host.querySelector('video');
  if (video) {
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.remove();
  }
}

function paintImage(host: HTMLElement, url: string): void {
  if (host.querySelector('img')) return;
  host.innerHTML = `<img src="${esc(url)}" alt="" draggable="false" loading="lazy" decoding="async">`;
}

function paintVideo(host: HTMLElement, url: string, play: boolean): void {
  let video = host.querySelector('video');
  if (!video) {
    host.innerHTML = `<video muted playsinline loop preload="metadata" src="${esc(url)}"></video>`;
    video = host.querySelector('video');
  }
  if (!video) return;
  if (play) void video.play().catch(() => undefined);
  else video.pause();
}

function kick(): void {
  while (loading < MAX_LOADS && pending.length) {
    const host = pending.shift();
    if (!host || !host.isConnected || host.dataset.want !== 'play' || (host as HTMLElement & { _anim?: Anim })._anim) continue;
    const url = host.dataset.src || '';
    if (!url) continue;
    loading += 1;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      loading -= 1;
      kick();
    };
    void loadJson(url)
      .then((animationData) => {
        if (!host.isConnected || host.dataset.want !== 'play') {
          finish();
          return;
        }
        const anim = lottie.loadAnimation({
          container: host,
          renderer: 'canvas',
          loop: true,
          autoplay: !document.hidden,
          animationData,
          rendererSettings: { dpr: 1, clearCanvas: true } as { clearCanvas: boolean },
        }) as Anim;
        anim.setSubframe?.(false);
        (host as HTMLElement & { _anim?: Anim })._anim = anim;
        anim.addEventListener('DOMLoaded', finish);
        window.setTimeout(finish, 1200);
      })
      .catch(() => finish());
  }
}

function enqueue(host: HTMLElement): void {
  if ((host as HTMLElement & { _anim?: Anim })._anim) return;
  const i = pending.indexOf(host);
  if (i >= 0) pending.splice(i, 1);
  if (host.dataset.want === 'play') pending.unshift(host);
  else pending.push(host);
  kick();
}

function apply(host: HTMLElement): void {
  const url = host.dataset.src || '';
  const kind = kindOf(url, host.dataset.kind);
  const want = host.dataset.want || 'off';
  if (want === 'off' || !url) {
    release(host);
    return;
  }
  if (kind === 'image') {
    paintImage(host, url);
    return;
  }
  if (kind === 'video') {
    paintVideo(host, url, want === 'play');
    return;
  }
  const anim = (host as HTMLElement & { _anim?: Anim })._anim;
  if (anim) {
    anim.play();
    return;
  }
  enqueue(host);
}

export function destroyStickers(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('.cv2-sticker').forEach((el) => {
    io.unobserve(el);
    release(el);
  });
}

let dropPicker: (() => void) | null = null;

export function closeStickerPicker(): void {
  dropPicker?.();
  dropPicker = null;
  if (!panel) return;
  destroyStickers(panel);
  const el = panel;
  panel = null;
  el.classList.remove('is-on');
  window.setTimeout(() => el.remove(), 160);
}

setStickerCloser(closeStickerPicker);

function bindHost(host: HTMLElement, url: string, kind: StickerKind): void {
  host.dataset.src = url;
  host.dataset.kind = kind;
  if (host.dataset.bound === '1') return;
  host.dataset.bound = '1';
  host.dataset.want = 'off';
  io.observe(host);
}

export function mountStickers(root: ParentNode): void {
  const nodes = Array.from(root.querySelectorAll<HTMLElement>('.cv2-sticker[data-sticker]')).filter((el) => el.dataset.bound !== '1');
  if (!nodes.length) return;
  void ensureCatalog().then(() => {
    for (const el of nodes) {
      if (!el.isConnected) continue;
      const id = Number(el.dataset.sticker);
      const known = catalog.get(id);
      const url = known?.url || assetUrl(`/stickers/file/st_${id}.json`);
      bindHost(el, url, kindOf(url, known?.kind));
    }
  });
}

type StickerGroup = { key: string; name: string; stickers: Sticker[] };
type ShopPack = {
  pack: string;
  name: string;
  count: number;
  owned: boolean;
  cover: Sticker | null;
};

let mine: Sticker[] = [];
let stkQuery = '';

function parseStickers(res: any, replace: boolean): Sticker[] {
  const raw = (res?.data?.stickers || res?.stickers || []) as Array<Record<string, unknown>>;
  const list = raw
    .map((s) => {
      const id = Number(s.id);
      const url = assetUrl(String(s.url || ''));
      const kind = kindOf(url, String(s.kind || ''));
      return { id, pack: String(s.pack || ''), emoji: String(s.emoji || ''), url, kind };
    })
    .filter((s) => s.id > 0 && s.url);
  if (replace) catalog = new Map(list.map((s) => [s.id, s]));
  else for (const s of list) catalog.set(s.id, s);
  return list;
}

async function loadStickers(): Promise<Sticker[]> {
  return parseStickers(await S.api.cloudStickers?.(), true);
}

async function loadMine(): Promise<Sticker[]> {
  return parseStickers(await S.api.cloudMyStickers?.(), false);
}

async function ensureCatalog(): Promise<void> {
  if (catalog.size) return;
  await loadStickers();
}

function stickerWord(n: number): string {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return `${n} стикер`;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return `${n} стикера`;
  return `${n} стикеров`;
}

function groupMine(list: Sticker[]): StickerGroup[] {
  const map = new Map<string, Sticker[]>();
  for (const s of list) {
    const bag = map.get(s.pack) || [];
    bag.push(s);
    map.set(s.pack, bag);
  }
  return [...map.entries()]
    .map(([key, stickers]) => ({ key, name: key || 'Без набора', stickers }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

function bindHosts(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('.cv2-sticker[data-src]').forEach((host) => {
    bindHost(host, host.dataset.src || '', kindOf(host.dataset.src || '', host.dataset.kind));
  });
}

const PICKER_SEARCH_ICO = `<svg class="cv2-pop__search-ico" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="4.25" stroke="currentColor" stroke-width="1.6"/><path d="M10.5 10.5L13.5 13.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;

function stickerCell(s: Sticker): string {
  return `<button type="button" class="cv2-stickers__item" data-sticker-id="${s.id}" title="${esc(s.emoji)}"><span class="cv2-sticker is-prev" data-kind="${s.kind}" data-src="${esc(s.url)}"></span></button>`;
}

function paintStickers(error = ''): void {
  const el = panel;
  if (!el) return;
  destroyStickers(el);
  const stage = el.querySelector<HTMLElement>('.cv2-pop__stage');
  const search = el.querySelector<HTMLElement>('.cv2-pop__search');
  const bar = el.querySelector<HTMLElement>('[data-stk-bar]');
  if (!stage) return;
  const hideChrome = () => {
    if (search) search.hidden = true;
    if (bar) {
      bar.hidden = true;
      bar.innerHTML = '';
    }
  };
  if (error && !mine.length) {
    hideChrome();
    stage.innerHTML = `<div class="cv2-pop__empty"><h3>Стикеры недоступны</h3><p>${esc(error)}</p></div>`;
    return;
  }
  if (!mine.length) {
    hideChrome();
    stage.innerHTML = `<div class="cv2-pop__empty">
      <h3>Стикеров нет</h3>
      <p>Добавьте себе стикеры из каталога</p>
      <button type="button" class="stngs-btn primary" data-act="catalog">Перейти в каталог</button>
    </div>`;
    return;
  }
  if (search) search.hidden = false;
  const groups = groupMine(mine);
  const q = stkQuery.trim().toLowerCase();
  const shown = groups
    .map((g) => ({
      ...g,
      stickers: q
        ? g.stickers.filter((s) => s.emoji.toLowerCase().includes(q) || g.name.toLowerCase().includes(q))
        : g.stickers,
    }))
    .filter((g) => g.stickers.length);
  stage.innerHTML = shown.length
    ? shown
        .map(
          (g, i) => `<section class="cv2-stk-sec" id="cv2-stk-${i}">
            <div class="cv2-stk-sec__head">
              <span class="cv2-stk-sec__name">${esc(g.name)}</span>
              <button type="button" class="cv2-stk-sec__x" data-remove-i="${i}" title="Убрать набор" aria-label="Убрать набор"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M1.5 1.5L10.5 10.5M10.5 1.5L1.5 10.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>
            </div>
            <div class="cv2-stickers__row">${g.stickers.map(stickerCell).join('')}</div>
          </section>`,
        )
        .join('')
    : `<div class="cv2-pop__none">Ничего не найдено</div>`;
  stage.querySelectorAll<HTMLElement>('[data-remove-i]').forEach((btn) => {
    const group = shown[Number(btn.dataset.removeI)];
    if (group) btn.dataset.packKey = group.key;
  });
  if (bar) {
    bar.hidden = false;
    bar.innerHTML = `${groups
      .map((g, i) => {
        const cover = g.stickers[0];
        const face = cover
          ? `<span class="cv2-sticker" data-kind="${cover.kind}" data-src="${esc(cover.url)}"></span>`
          : '✦';
        return `<button type="button" class="cv2-pop__railbtn${i === 0 ? ' is-on' : ''}" data-pack-i="${i}" title="${esc(g.name)}">${face}</button>`;
      })
      .join('')}<button type="button" class="cv2-pop__plus" data-act="catalog" title="Каталог" aria-label="Каталог"><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M7 1.5V12.5M1.5 7H12.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>`;
  }
  bindHosts(el);
}

async function removePack(key: string): Promise<void> {
  if (!mine.some((s) => s.pack === key)) return;
  try {
    await S.api.cloudStickerPack?.(key, false);
    mine = await loadMine();
    paintStickers();
    toast('Набор убран');
  } catch (e) {
    toast((e as Error).message || 'Не удалось убрать набор', 'error');
  }
}

export async function openStickerCatalog(): Promise<void> {
  let packs: ShopPack[] = [];
  try {
    const res = await S.api.cloudStickerCatalog?.();
    const raw = (res?.packs || res?.data?.packs || []) as Array<Record<string, unknown>>;
    packs = raw.map((p) => {
      const coverRaw = p.cover as Record<string, unknown> | null;
      let cover: Sticker | null = null;
      if (coverRaw) {
        const url = assetUrl(String(coverRaw.url || ''));
        const id = Number(coverRaw.id);
        if (url && id > 0) {
          cover = {
            id,
            pack: String(p.pack || ''),
            emoji: String(coverRaw.emoji || ''),
            url,
            kind: kindOf(url, String(coverRaw.kind || '')),
          };
        }
      }
      return {
        pack: String(p.pack || ''),
        name: String(p.name || p.pack || 'Без набора'),
        count: Number(p.count) || 0,
        owned: Boolean(p.owned),
        cover,
      };
    });
  } catch (e) {
    toast((e as Error).message || 'Не удалось открыть каталог', 'error');
    return;
  }
  let shopRoot: HTMLElement | null = null;
  openModal({
    title: 'Каталог стикеров',
    sub: 'Наборы с сервера. Добавленные появятся в панели стикеров.',
    width: 560,
    cls: 'cv2-stk-shop',
    body: `<div class="cv2-shop">
      <input class="cv2-shop__find" type="search" placeholder="Поиск наборов" data-shop-find autocomplete="off">
      <div class="cv2-shop__list" data-shop-list></div>
    </div>`,
    onMount(box) {
      shopRoot = box;
      const overlay = box.closest<HTMLElement>('.modal-overlay');
      if (overlay) overlay.style.zIndex = '9500';
      const listEl = box.querySelector<HTMLElement>('[data-shop-list]')!;
      const find = box.querySelector<HTMLInputElement>('[data-shop-find]')!;
      let q = '';
      let busy = false;
      const paint = () => {
        destroyStickers(listEl);
        const query = q.trim().toLowerCase();
        const shown = query ? packs.filter((p) => p.name.toLowerCase().includes(query)) : packs;
        if (!shown.length) {
          listEl.innerHTML = `<div class="cv2-shop__none">${packs.length ? 'Ничего не найдено' : 'На сервере пока нет наборов стикеров'}</div>`;
          return;
        }
        listEl.innerHTML = shown
          .map((p, i) => {
            const face = p.cover
              ? `<span class="cv2-sticker" data-kind="${p.cover.kind}" data-src="${esc(p.cover.url)}"></span>`
              : '✦';
            const action = p.owned
              ? `<button type="button" class="stngs-btn sm" data-shop-i="${i}">Убрать</button>`
              : `<button type="button" class="stngs-btn sm primary" data-shop-i="${i}">Добавить</button>`;
            return `<div class="cv2-shop__row">
              <span class="cv2-shop__cover">${face}</span>
              <div class="cv2-shop__meta">
                <div class="cv2-shop__name">${esc(p.name)}</div>
                <div class="cv2-shop__count">${esc(stickerWord(p.count))}</div>
              </div>
              ${action}
            </div>`;
          })
          .join('');
        listEl.querySelectorAll<HTMLElement>('[data-shop-i]').forEach((btn) => {
          const pack = shown[Number(btn.dataset.shopI)];
          if (pack) btn.dataset.packKey = pack.pack;
        });
        bindHosts(listEl);
      };
      paint();
      find.addEventListener('input', () => {
        q = find.value;
        paint();
      });
      listEl.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-pack-key]');
        if (!btn || busy) return;
        const pack = packs.find((p) => p.pack === (btn.dataset.packKey || ''));
        if (!pack || !S.api.cloudStickerPack) return;
        busy = true;
        btn.disabled = true;
        const next = !pack.owned;
        void S.api
          .cloudStickerPack(pack.pack, next)
          .then(async () => {
            pack.owned = next;
            try {
              mine = await loadMine();
              paintStickers();
            } catch {
              /* набор уже записан, панель обновится при следующем открытии */
            }
            toast(next ? 'Набор добавлен' : 'Набор убран');
          })
          .catch((err: Error) => {
            toast(err?.message || 'Не удалось изменить набор', 'error');
          })
          .finally(() => {
            busy = false;
            if (listEl.isConnected) paint();
          });
      });
    },
    onClose() {
      if (shopRoot) destroyStickers(shopRoot);
      shopRoot = null;
    },
  });
}

export async function openStickerPicker(anchor: HTMLElement): Promise<void> {
  closeStickerPicker();
  closeEmojiPicker();
  closeMenu();
  stkQuery = '';
  const el = document.createElement('div');
  el.className = 'cv2-pop cv2-stickers';
  el.innerHTML = `<div class="cv2-pop__tabs">
      <button type="button" class="cv2-pop__tab" data-pop-tab="emoji">Эмодзи</button>
      <button type="button" class="cv2-pop__tab is-on" data-pop-tab="stickers">Стикеры</button>
    </div>
    <label class="cv2-pop__search" hidden>${PICKER_SEARCH_ICO}<input type="search" placeholder="Поиск" data-stk-find autocomplete="off"></label>
    <div class="cv2-pop__stage"><div class="cv2-pop__empty"><p>Загрузка…</p></div></div>
    <div class="cv2-pop__bar" data-stk-bar hidden></div>`;
  layer().appendChild(el);
  const r = anchor.getBoundingClientRect();
  clampToViewport(el, r.right - el.offsetWidth, r.top - el.offsetHeight - 10);
  panel = el;
  requestAnimationFrame(() => el.classList.add('is-on'));
  const onDown = (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest('.cv2-stickers') || t.closest('.modal-overlay') || anchor.contains(t)) return;
    closeStickerPicker();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    if (document.querySelector('.modal-overlay[data-cv2-modal]')) return;
    closeStickerPicker();
  };
  dropPicker = () => {
    document.removeEventListener('mousedown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
  };
  window.setTimeout(() => document.addEventListener('mousedown', onDown, true), 0);
  document.addEventListener('keydown', onKey, true);
  el.querySelector<HTMLInputElement>('[data-stk-find]')?.addEventListener('input', (e) => {
    stkQuery = (e.target as HTMLInputElement).value;
    paintStickers();
  });
  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-pop-tab="emoji"]')) {
      const ta = anchor.closest('.cv2-composer')?.querySelector('textarea');
      closeStickerPicker();
      if (ta instanceof HTMLTextAreaElement) {
        openEmojiPicker(anchor, (emoji) => {
          const s = ta.selectionStart ?? ta.value.length;
          const end = ta.selectionEnd ?? s;
          ta.value = ta.value.slice(0, s) + emoji + ta.value.slice(end);
          const pos = s + emoji.length;
          ta.setSelectionRange(pos, pos);
          ta.focus();
          ta.dispatchEvent(new Event('input', { bubbles: true }));
        }, { keepOpen: true });
      }
      return;
    }
    if (t.closest('[data-act="catalog"]')) {
      void openStickerCatalog();
      return;
    }
    const removeBtn = t.closest<HTMLElement>('[data-remove-i]');
    if (removeBtn) {
      void removePack(removeBtn.dataset.packKey || '');
      return;
    }
    const rail = t.closest<HTMLElement>('[data-pack-i]');
    if (rail && el.querySelector('[data-stk-bar]')?.contains(rail)) {
      el.querySelector(`#cv2-stk-${rail.dataset.packI}`)?.scrollIntoView({ block: 'start' });
      el.querySelectorAll<HTMLElement>('[data-stk-bar] .cv2-pop__railbtn').forEach((btn) => {
        btn.classList.toggle('is-on', btn === rail);
      });
      return;
    }
    const btn = t.closest<HTMLElement>('[data-sticker-id]');
    if (!btn) return;
    const key = activeKey();
    if (!key) {
      toast('Откройте чат', 'error');
      return;
    }
    void sendText(key, `[[sticker:${btn.dataset.stickerId}]]`);
    closeStickerPicker();
  });

  void ensureCatalog();
  try {
    mine = await loadMine();
    if (panel !== el) return;
    paintStickers();
  } catch (e) {
    if (panel !== el) return;
    mine = [];
    paintStickers((e as Error).message || 'Не удалось загрузить стикеры');
  }
}

setStickerOpener((anchor) => {
  void openStickerPicker(anchor);
});
