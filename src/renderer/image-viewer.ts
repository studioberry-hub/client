// Единый просмотр изображений: чаты, посты, новости, скриншоты и галерея модов.
// Кнопка внешней ссылки есть только у внешнего контента каталога (страница мода).

import { isVideoViewerOpen } from './video-player';

export type ImageViewerItem = {
  src: string;
  alt?: string;
  /** Оригинальный http(s)-адрес. Пусто — кнопку ссылки не показываем. */
  externalUrl?: string | null;
  /** Запасной адрес, если основной кадр не загрузился. */
  fallbackSrc?: string | null;
  /** Полный кадр после превью (скриншоты сборки). */
  loadFull?: () => Promise<string | null>;
};

const ICON = '../../assets/icons/imageViewerPanel';
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.25;
const SLIDE_MS = 240;
const DISMISS_MS = 200;

type ZoomEase = 'step' | 'wheel' | 'none';
type Phase = 'closed' | 'opening' | 'open' | 'closing';

type Frame = {
  box: HTMLElement;
  img: HTMLImageElement;
};

type Els = {
  root: HTMLElement;
  stage: HTMLElement;
  countCur: HTMLElement;
  countRest: HTMLElement;
  prev: HTMLButtonElement;
  next: HTMLButtonElement;
  zoomOut: HTMLButtonElement;
  zoomIn: HTMLButtonElement;
  zoomLabel: HTMLButtonElement;
  link: HTMLButtonElement;
  sepBeforeClose: HTMLElement;
};

let els: Els | null = null;
let frames: [Frame, Frame] | null = null;
/** Кадр, который сейчас на экране (или въезжает). */
let current: Frame | null = null;
let spare: Frame | null = null;
let items: ImageViewerItem[] = [];
let index = 0;
let scale = 1;
let panX = 0;
let panY = 0;
let loadGen = 0;
let slideGen = 0;
let sliding = false;
let viewerSource = '';
let phase: Phase = 'closed';
let dismissTimer = 0;
let drag: { x: number; y: number; panX: number; panY: number; moved: boolean } | null = null;
let suppressClick = false;

function iconHtml(file: string): string {
  return `<img src="${ICON}/${file}" alt="" width="16" height="16" draggable="false">`;
}

/** http(s) адрес; у прокси каталога забираем исходный URL картинки. */
function httpUrlOf(src: string): string | null {
  const text = String(src || '').trim();
  if (!text || text.startsWith('data:') || text.startsWith('blob:')) return null;
  try {
    const u = new URL(text, window.location.href);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.pathname.includes('/api/catalog/image')) {
      const inner = u.searchParams.get('url');
      if (inner && /^https?:\/\//i.test(inner)) return inner;
    }
    return u.href;
  } catch {
    return null;
  }
}

function onKey(e: KeyboardEvent): void {
  // Пока открыт видеоплеер, клавиши принадлежат ему.
  if (isVideoViewerOpen()) return;
  if (phase === 'closed') return;
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopImmediatePropagation();
    closeImageViewer();
    return;
  }
  if (phase !== 'open' && phase !== 'opening') return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
    e.stopImmediatePropagation();
    step(e.key === 'ArrowLeft' ? -1 : 1);
  }
}

function onDismissEnd(e: TransitionEvent): void {
  if (!els || e.target !== els.root || e.propertyName !== 'opacity') return;
  finishDismiss();
}

function ensure(): Els {
  if (els && frames && current && spare) return els;
  const root = document.createElement('div');
  root.id = 'image-viewer';
  root.className = 'iv-overlay';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-hidden', 'false');
  root.setAttribute('aria-label', 'Просмотр изображения');
  root.innerHTML = `
    <div class="iv-stage" data-iv="stage">
      <div class="iv-frame is-current" data-iv="frame">
        <img class="iv-img" alt="" draggable="false">
      </div>
      <div class="iv-frame" data-iv="frame">
        <img class="iv-img" alt="" draggable="false">
      </div>
    </div>
    <div class="iv-panel" data-iv="panel" role="toolbar" aria-label="Панель просмотра">
      <button type="button" class="iv-panel__btn" data-iv="prev" aria-label="Назад">${iconHtml('back.svg')}</button>
      <span class="iv-panel__count" data-iv="count"><span class="iv-panel__count-cur" data-iv="count-cur">1</span><span class="iv-panel__count-rest" data-iv="count-rest">&nbsp;/&nbsp;1</span></span>
      <button type="button" class="iv-panel__btn" data-iv="next" aria-label="Вперёд">${iconHtml('next.svg')}</button>
      <span class="iv-panel__sep" aria-hidden="true"></span>
      <button type="button" class="iv-panel__btn" data-iv="zoom-out" aria-label="Уменьшить">${iconHtml('scaleDown.svg')}</button>
      <button type="button" class="iv-panel__pct" data-iv="zoom-label" aria-label="Сбросить масштаб">100%</button>
      <button type="button" class="iv-panel__btn" data-iv="zoom-in" aria-label="Увеличить">${iconHtml('scaleIn.svg')}</button>
      <span class="iv-panel__sep" aria-hidden="true"></span>
      <button type="button" class="iv-panel__btn" data-iv="link" aria-label="Открыть ссылку">${iconHtml('openBrowser.svg')}</button>
      <span class="iv-panel__sep" data-iv="sep-before-close" aria-hidden="true"></span>
      <button type="button" class="iv-panel__btn" data-iv="close" aria-label="Закрыть">${iconHtml('close.svg')}</button>
    </div>
  `;
  document.body.appendChild(root);

  const q = <T extends Element>(sel: string) => root.querySelector(sel) as T;
  const boxes = root.querySelectorAll<HTMLElement>('[data-iv="frame"]');
  const pair: [Frame, Frame] = [
    { box: boxes[0], img: boxes[0].querySelector('img') as HTMLImageElement },
    { box: boxes[1], img: boxes[1].querySelector('img') as HTMLImageElement },
  ];
  pair[1].box.style.transform = 'translateX(100%)';

  const built: Els = {
    root,
    stage: q('[data-iv="stage"]'),
    countCur: q('[data-iv="count-cur"]'),
    countRest: q('[data-iv="count-rest"]'),
    prev: q('[data-iv="prev"]'),
    next: q('[data-iv="next"]'),
    zoomOut: q('[data-iv="zoom-out"]'),
    zoomIn: q('[data-iv="zoom-in"]'),
    zoomLabel: q('[data-iv="zoom-label"]'),
    link: q('[data-iv="link"]'),
    sepBeforeClose: q('[data-iv="sep-before-close"]'),
  };

  built.prev.addEventListener('click', () => step(-1));
  built.next.addEventListener('click', () => step(1));
  built.zoomOut.addEventListener('click', () => setZoom(scale - ZOOM_STEP, undefined, 'step'));
  built.zoomIn.addEventListener('click', () => setZoom(scale + ZOOM_STEP, undefined, 'step'));
  built.zoomLabel.addEventListener('click', () => resetZoom());
  built.link.addEventListener('click', () => openCurrentLink());
  root.querySelector('[data-iv="close"]')?.addEventListener('click', () => closeImageViewer());

  // Клик по тёмному фону мимо картинки и панели закрывает экран.
  root.addEventListener('click', (e) => {
    if (phase === 'closing') return;
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    const t = e.target as HTMLElement;
    if (t === root || t === built.stage || t.classList.contains('iv-frame')) closeImageViewer();
  });

  built.stage.addEventListener('dblclick', (e) => {
    if (e.target !== current?.img) return;
    e.preventDefault();
    e.stopPropagation();
    resetZoom();
  });

  built.stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || scale <= 1 || !current) return;
    if (e.target !== current.img) return;
    e.preventDefault();
    drag = { x: e.clientX, y: e.clientY, panX, panY, moved: false };
    current.img.setPointerCapture(e.pointerId);
    applyTransform('none');
  });
  built.stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    panX = drag.panX + dx;
    panY = drag.panY + dy;
    applyTransform('none');
  });
  const endDrag = () => {
    if (drag?.moved) suppressClick = true;
    drag = null;
    applyTransform('none');
  };
  built.stage.addEventListener('pointerup', endDrag);
  built.stage.addEventListener('pointercancel', endDrag);

  root.addEventListener(
    'wheel',
    (e) => {
      if (phase === 'closing' || phase === 'closed') return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      setZoom(scale * factor, { x: e.clientX, y: e.clientY }, 'wheel');
    },
    { passive: false },
  );

  document.addEventListener('keydown', onKey, true);

  frames = pair;
  current = pair[0];
  spare = pair[1];
  els = built;
  return built;
}

function activeImg(): HTMLImageElement | null {
  return current?.img || null;
}

function isGifView(item: ImageViewerItem | undefined): boolean {
  const alt = String(item?.alt || '');
  const src = String(item?.src || '');
  return /\.gif(\?|#|$)/i.test(alt) || /\.gif(\?|#|$)/i.test(src) || /^data:image\/gif/i.test(src);
}

function applyTransform(ease: ZoomEase): void {
  const img = activeImg();
  if (!img) return;
  // transform на <img> замораживает GIF. В масштабе 1× кадры должны играть.
  const gifStill = isGifView(items[index]) && scale === 1 && panX === 0 && panY === 0 && !drag;
  if (gifStill) {
    const had = Boolean(img.style.transform) && img.style.transform !== 'none';
    img.classList.remove('is-wheel');
    img.classList.add('is-instant');
    img.style.transform = 'none';
    img.style.cursor = 'zoom-in';
    if (had && img.src) {
      const src = img.src;
      img.removeAttribute('src');
      img.src = src;
    }
    return;
  }
  const instant = ease === 'none' || Boolean(drag);
  // Снятие is-instant и новая цель в одном кадре не анимируются — нужен reflow.
  if (!instant && img.classList.contains('is-instant')) {
    img.classList.remove('is-instant');
    img.classList.toggle('is-wheel', ease === 'wheel');
    void img.offsetWidth;
  } else {
    img.classList.toggle('is-instant', instant);
    img.classList.toggle('is-wheel', ease === 'wheel' && !instant);
  }
  img.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
  img.style.cursor = scale > 1 ? (drag ? 'grabbing' : 'grab') : 'zoom-in';
}

function updateChrome(): void {
  if (!els) return;
  const total = Math.max(items.length, 1);
  const item = items[index];
  els.countCur.textContent = String(index + 1);
  // Обычный пробел в начале flex-элемента схлопывается: было «2/ 4».
  els.countRest.textContent = `\u00A0/\u00A0${total}`;
  const single = items.length < 2;
  els.prev.disabled = single;
  els.next.disabled = single;
  els.zoomOut.disabled = scale <= ZOOM_MIN + 0.001;
  els.zoomIn.disabled = scale >= ZOOM_MAX - 0.001;
  els.zoomLabel.textContent = `${Math.round(scale * 100)}%`;
  const link = String(item?.externalUrl || '').trim();
  const showLink = /^https?:\/\//i.test(link);
  els.link.hidden = !showLink;
  els.sepBeforeClose.hidden = !showLink;
  if (showLink) els.link.title = link;
}

function resetZoom(): void {
  if (phase === 'closing') return;
  scale = 1;
  panX = 0;
  panY = 0;
  applyTransform('step');
  updateChrome();
}

function setZoom(next: number, client: { x: number; y: number } | undefined, ease: ZoomEase): void {
  if (phase === 'closing' || !current) return;
  const prev = scale;
  const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
  if (Math.abs(clamped - prev) < 0.001) return;
  if (client) {
    const rect = current.img.getBoundingClientRect();
    const vx = client.x - (rect.left + rect.width / 2);
    const vy = client.y - (rect.top + rect.height / 2);
    const ratio = clamped / prev;
    panX += vx * (1 - ratio);
    panY += vy * (1 - ratio);
  }
  scale = clamped;
  if (Math.abs(scale - 1) < 0.001) {
    scale = 1;
    panX = 0;
    panY = 0;
  }
  applyTransform(ease);
  updateChrome();
}

function openCurrentLink(): void {
  const url = String(items[index]?.externalUrl || '').trim();
  if (!/^https?:\/\//i.test(url)) return;
  const api = (window as unknown as { electronAPI?: { openExternal?: (u: string) => Promise<void> } }).electronAPI;
  void api?.openExternal?.(url);
}

function clearImg(img: HTMLImageElement): void {
  img.onload = null;
  img.onerror = null;
  img.removeAttribute('src');
  img.classList.remove('is-loading');
  img.dataset.load = '';
}

/** Кладёт кадр в img. Предыдущая подгрузка этого img больше не применяется. */
function loadInto(img: HTMLImageElement, item: ImageViewerItem): void {
  const token = ++loadGen;
  img.dataset.load = String(token);
  const still = () => img.dataset.load === String(token);
  img.alt = item.alt || '';
  img.classList.add('is-loading');
  const finish = () => {
    if (!still()) return;
    img.classList.remove('is-loading');
  };
  img.onload = finish;
  img.onerror = () => {
    if (!still()) return;
    const fallback = String(item.fallbackSrc || '').trim();
    if (fallback && img.getAttribute('src') !== fallback) {
      img.src = fallback;
      return;
    }
    finish();
  };
  const src = String(item.src || '').trim();
  if (src) img.src = src;
  else img.removeAttribute('src');
  if (item.loadFull) {
    void item.loadFull().then((full) => {
      if (!still()) return;
      const next = String(full || '').trim();
      if (!next || next === img.src) {
        if (!src) finish();
        return;
      }
      img.classList.add('is-loading');
      img.src = next;
    }).catch(() => {
      if (still() && !src) finish();
    });
  } else if (!src) {
    finish();
  }
}

/** Обрывает текущий перелёт и оставляет въезжающий кадр на месте. */
function finishSlideImmediate(): void {
  if (!sliding || !current || !spare) return;
  slideGen += 1;
  sliding = false;
  current.box.classList.remove('is-slide');
  spare.box.classList.remove('is-slide');
  void current.box.offsetWidth;
  current.box.style.transform = 'translateX(0)';
  spare.box.style.transform = 'translateX(100%)';
  clearImg(spare.img);
  current.box.classList.add('is-current');
  spare.box.classList.remove('is-current');
  current.img.classList.remove('is-instant');
}

function beginSlide(next: number, dir: -1 | 1): void {
  if (!current || !spare) return;
  finishSlideImmediate();
  const from = current;
  const to = spare;
  current = to;
  spare = from;
  index = next;
  scale = 1;
  panX = 0;
  panY = 0;
  drag = null;

  to.box.classList.add('is-current');
  from.box.classList.remove('is-current');
  to.img.classList.add('is-instant');
  to.img.classList.remove('is-wheel');
  to.img.style.transform = isGifView(items[index]) ? 'none' : 'translate(0px, 0px) scale(1)';
  // Старт без transition, иначе оба кадра прыгнут, а не поедут.
  from.box.classList.remove('is-slide');
  to.box.classList.remove('is-slide');
  from.box.style.transform = 'translateX(0)';
  to.box.style.transform = `translateX(${dir * 100}%)`;
  loadInto(to.img, items[index]);
  updateChrome();
  void to.box.offsetWidth;

  const gen = ++slideGen;
  sliding = true;
  from.box.classList.add('is-slide');
  to.box.classList.add('is-slide');
  from.box.style.transform = `translateX(${-dir * 100}%)`;
  to.box.style.transform = 'translateX(0)';

  let settled = false;
  const end = () => {
    if (settled || gen !== slideGen) return;
    settled = true;
    sliding = false;
    from.box.classList.remove('is-slide');
    to.box.classList.remove('is-slide');
    void from.box.offsetWidth;
    from.box.style.transform = 'translateX(100%)';
    clearImg(from.img);
    to.img.classList.remove('is-instant');
  };
  const onEnd = (e: TransitionEvent) => {
    if (e.target !== to.box || e.propertyName !== 'transform') return;
    to.box.removeEventListener('transitionend', onEnd);
    end();
  };
  to.box.addEventListener('transitionend', onEnd);
  window.setTimeout(() => {
    to.box.removeEventListener('transitionend', onEnd);
    end();
  }, SLIDE_MS + 80);
}

function showSlide(nextIndex: number, dir: -1 | 0 | 1): void {
  if (!current || !items.length) return;
  const total = items.length;
  const next = ((nextIndex % total) + total) % total;
  if (dir !== 0 && total > 1) {
    beginSlide(next, dir);
    return;
  }
  finishSlideImmediate();
  index = next;
  scale = 1;
  panX = 0;
  panY = 0;
  drag = null;
  applyTransform('none');
  loadInto(current.img, items[index]);
  updateChrome();
}

function step(delta: number): void {
  if (items.length < 2 || phase === 'closing' || phase === 'closed') return;
  showSlide(index + delta, delta < 0 ? -1 : 1);
}

function playOpen(): void {
  if (!els) return;
  phase = 'opening';
  els.root.classList.remove('is-shown');
  void els.root.offsetWidth;
  requestAnimationFrame(() => {
    if (!els || phase !== 'opening') return;
    els.root.classList.add('is-shown');
    phase = 'open';
  });
}

function abortDismiss(): void {
  if (dismissTimer) {
    window.clearTimeout(dismissTimer);
    dismissTimer = 0;
  }
  els?.root.removeEventListener('transitionend', onDismissEnd);
}

/** Снимает оверлей, кадры и клавиатуру после анимации ухода. */
function destroyViewer(): void {
  abortDismiss();
  slideGen += 1;
  sliding = false;
  document.removeEventListener('keydown', onKey, true);
  if (frames) {
    clearImg(frames[0].img);
    clearImg(frames[1].img);
  }
  els?.root.remove();
  els = null;
  frames = null;
  current = null;
  spare = null;
  items = [];
  index = 0;
  scale = 1;
  panX = 0;
  panY = 0;
  viewerSource = '';
  drag = null;
  phase = 'closed';
}

function finishDismiss(): void {
  if (phase !== 'closing') return;
  destroyViewer();
}

export function isImageViewerOpen(): boolean {
  return phase !== 'closed';
}

/** source — чтобы закрыть экран вместе с модалкой мода или вкладкой скриншотов. */
export function openImageViewer(list: ImageViewerItem[], start = 0, source = ''): void {
  const clean = (list || []).filter((it) => it && (String(it.src || '').trim() || it.loadFull));
  if (!clean.length) return;
  const wasClosing = phase === 'closing';
  if (wasClosing) abortDismiss();
  const ui = ensure();
  items = clean;
  viewerSource = source;
  showSlide(start, 0);
  if (wasClosing || phase === 'closed') {
    playOpen();
    return;
  }
  if (phase === 'opening') return;
  ui.root.classList.add('is-shown');
  phase = 'open';
}

/** Без source закрывает всегда. С source — только если экран открыт из этого контекста. */
export function closeImageViewer(source?: string): void {
  if (phase === 'closed' || phase === 'closing') return;
  if (!els) return;
  if (source && viewerSource !== source) return;
  phase = 'closing';
  drag = null;
  finishSlideImmediate();
  els.root.classList.remove('is-shown');
  const dur = getComputedStyle(els.root).transitionDuration || '';
  // При выключенных анимациях transition не стреляет — снимаем сразу.
  if (dur === '0s' || dur === '0ms') {
    destroyViewer();
    return;
  }
  els.root.addEventListener('transitionend', onDismissEnd);
  dismissTimer = window.setTimeout(finishDismiss, DISMISS_MS + 80);
}

/**
 * Клики по уже отрисованным <img> открывают этот экран.
 * external — показать кнопку оригинального URL (каталог / страница мода).
 */
export function bindZoomableImages(
  container: HTMLElement,
  opts?: { external?: boolean; includeLinked?: boolean; source?: string },
): void {
  const external = Boolean(opts?.external);
  const includeLinked = Boolean(opts?.includeLinked);
  const source = opts?.source || '';
  const imgs = Array.from(container.querySelectorAll('img')).filter((img) => {
    if (img.dataset.ivBound === '1') return false;
    if (!includeLinked && img.closest('a[href]')) return false;
    return Boolean((img.getAttribute('src') || '').trim());
  });
  for (const img of imgs) {
    img.dataset.ivBound = '1';
    img.classList.add('iv-zoomable');
    img.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const batch = imgs.map((el) => {
        const src = el.currentSrc || el.src;
        return {
          src,
          alt: el.alt || '',
          externalUrl: external ? httpUrlOf(src) : null,
        };
      }).filter((it) => it.src);
      const at = Math.max(0, imgs.indexOf(img));
      openImageViewer(batch, at, source);
    });
  }
}
