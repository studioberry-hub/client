// Единый видеоплеер: чаты, посты, новости и ролики каталога.
// Панель — шаблон NewVideoPlayerV2. Акцент полосы и ползунка берётся из --accent.
// Кнопка внешней ссылки есть только если у ролика задан внешний URL.

export type VideoViewerItem = {
  src: string;
  alt?: string;
  /** Оригинальный http(s)-адрес. Пусто — кнопку ссылки не показываем. */
  externalUrl?: string | null;
};

const ICON = '../../assets/icons/videoPlayer';
const LINK_ICON = '../../assets/icons/imageViewerPanel/openBrowser.svg';
const DISMISS_MS = 200;
const SEEK_STEP = 5;

type Phase = 'closed' | 'opening' | 'open' | 'closing';

type Els = {
  root: HTMLElement;
  stage: HTMLElement;
  panel: HTMLElement;
  video: HTMLVideoElement;
  play: HTMLButtonElement;
  playIcon: HTMLImageElement;
  seek: HTMLElement;
  seekFill: HTMLElement;
  seekThumb: HTMLElement;
  timeCur: HTMLElement;
  timeDur: HTMLElement;
  vol: HTMLElement;
  volBtn: HTMLButtonElement;
  volIcon: HTMLImageElement;
  volPop: HTMLElement;
  volTrack: HTMLElement;
  volFill: HTMLElement;
  volThumb: HTMLElement;
  link: HTMLButtonElement;
};

let els: Els | null = null;
let items: VideoViewerItem[] = [];
let index = 0;
let viewerSource = '';
let phase: Phase = 'closed';
let dismissTimer = 0;
/** Уровень ползунка. Mute его не обнуляет — звук глушится флагом muted. */
let volume = 1;
/** Последний ненулевой уровень: unmute и клик при нуле возвращают его. */
let savedVolume = 1;
let muted = false;
/** Цель перемотки. В сетевой элемент пишем её только если сервер умеет Range. */
let pendingSeek: number | null = null;
let pendingRatio: number | null = null;
/** Поколение ролика: поздний ответ скачивания не подменяет уже другой src. */
let prepareToken = 0;
let blobUrl: string | null = null;
/** Байты уже скачаны, но src не меняем, пока пользователь не перемотает. */
let stagedBlob: string | null = null;
/**
 * Сервер ответил 206 на Range.
 * Пока флаг выключен, currentTime у http(s) не трогаем: ответ 200 с нуля
 * обнуляет буфер и кадр снова оказывается в начале файла.
 */
let networkSeekOk = false;
type RemoteMode = 'local' | 'probing' | 'ranges' | 'blob' | 'failed';
let remoteMode: RemoteMode = 'local';
let seekAttempts = 0;
/** Последняя запись в currentTime, чтобы progress не слал её снова и снова. */
let lastAssigned = -1;
let seekDrag = false;
let volDrag = false;
let pointerArmed = false;
let suppressClick = false;

function iconHtml(file: string): string {
  return `<img src="${ICON}/${file}" alt="" width="16" height="16" draggable="false">`;
}

/** Прямой файл ролика, а не страница или встраивание. */
export function isDirectVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov|mkv|m4v|ogv|avi)(?:[?#]|$)/i.test(String(url || ''));
}

/** http(s) адрес; у прокси каталога забираем исходный URL. */
function httpUrlOf(src: string): string | null {
  const text = String(src || '').trim();
  if (!text || text.startsWith('data:') || text.startsWith('blob:')) return null;
  try {
    const u = new URL(text, window.location.href);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.pathname.includes('/api/catalog/image') || u.pathname.includes('/api/catalog/file')) {
      const inner = u.searchParams.get('url');
      if (inner && /^https?:\/\//i.test(inner)) return inner;
    }
    return u.href;
  } catch {
    return null;
  }
}

function formatClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const whole = Math.floor(sec);
  const s = whole % 60;
  const m = Math.floor(whole / 60) % 60;
  const h = Math.floor(whole / 3600);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export function isVideoViewerOpen(): boolean {
  return phase !== 'closed';
}

function onKey(e: KeyboardEvent): void {
  if (phase === 'closed') return;
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopImmediatePropagation();
    closeVideoViewer();
    return;
  }
  if (e.key === ' ' || e.code === 'Space') {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (phase === 'open' || phase === 'opening') togglePlay();
    return;
  }
  if (phase !== 'open' && phase !== 'opening') return;
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const dir = e.key === 'ArrowLeft' ? -1 : 1;
  // Листание только если роликов уже несколько. Один ролик — перемотка.
  if (items.length > 1) step(dir);
  else seekBy(dir * SEEK_STEP);
}

function onDismissEnd(e: TransitionEvent): void {
  if (!els || e.target !== els.root || e.propertyName !== 'opacity') return;
  finishDismiss();
}

function paintSeek(ratio: number): void {
  if (!els) return;
  const r = clamp01(ratio);
  els.seekFill.style.width = `${r * 100}%`;
  els.seekThumb.style.left = `${r * 100}%`;
}

function paintTime(current: number, duration: number): void {
  if (!els) return;
  els.timeCur.textContent = formatClock(current);
  // Тот же flex, что у счётчика картинок: обычный пробел перед «/» схлопывается.
  els.timeDur.textContent = `\u00A0/\u00A0${formatClock(duration)}`;
}

function paintVolume(): void {
  if (!els) return;
  const r = clamp01(volume);
  els.volFill.style.height = `${r * 100}%`;
  // Дорожка 72px с отступом 14px внутри попапа; бегунок 12px по центру значения.
  els.volThumb.style.top = `${14 + (1 - r) * 72 - 6}px`;
}

function syncPlayIcon(paused: boolean): void {
  if (!els) return;
  els.playIcon.src = `${ICON}/${paused ? 'play.svg' : 'pause.svg'}`;
  els.play.setAttribute('aria-label', paused ? 'Воспроизведение' : 'Пауза');
}

function syncVolumeIcon(): void {
  if (!els) return;
  const silent = muted || volume <= 0.001;
  els.volIcon.src = `${ICON}/${silent ? 'volumeOff.svg' : 'volume.svg'}`;
  els.volBtn.setAttribute('aria-label', silent ? 'Включить звук' : 'Выключить звук');
  els.volBtn.classList.toggle('is-muted', silent);
}

function applyVolume(): void {
  if (els) {
    els.video.volume = clamp01(volume);
    els.video.muted = muted || volume <= 0.001;
  }
  paintVolume();
  syncVolumeIcon();
}

function setVolume(next: number): void {
  const value = clamp01(next);
  if (value > 0.001) {
    savedVolume = value;
    muted = false;
  } else {
    muted = true;
  }
  volume = value;
  applyVolume();
}

/** Клик по кнопке только глушит звук. Ползунок остаётся на прежнем уровне. */
function toggleMute(): void {
  if (volume <= 0.001) {
    volume = savedVolume > 0.001 ? savedVolume : 1;
    muted = false;
  } else if (muted) {
    muted = false;
  } else {
    savedVolume = volume;
    muted = true;
  }
  applyVolume();
}

function syncLink(): void {
  if (!els) return;
  const url = String(items[index]?.externalUrl || '').trim();
  els.link.hidden = !/^https?:\/\//i.test(url);
}

function openCurrentLink(): void {
  const url = String(items[index]?.externalUrl || '').trim();
  if (!/^https?:\/\//i.test(url)) return;
  const api = (window as unknown as { electronAPI?: { openExternal?: (u: string) => Promise<void> } }).electronAPI;
  void api?.openExternal?.(url);
}

/** Доля по видимой дорожке. null — ширину ещё нельзя мерить, в 0 не сбрасываем. */
function ratioFromX(el: HTMLElement, clientX: number): number | null {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0) return null;
  return clamp01((clientX - rect.left) / rect.width);
}

function seekTrack(): HTMLElement | null {
  return els?.seek.querySelector('.vp-seek__track') as HTMLElement | null;
}

// ===== Перемотка =====
// currentSrc отстаёт от src: после подмены на blob проверка по нему
// всё ещё видела сетевой адрес и не писала currentTime.

function mediaAddress(video: HTMLVideoElement): string {
  return (video.getAttribute('src') || video.src || video.currentSrc || '').trim();
}

function isLocalMedia(video: HTMLVideoElement): boolean {
  const src = mediaAddress(video);
  return src.startsWith('blob:') || src.startsWith('data:') || src.startsWith('file:');
}

function absoluteHttp(src: string): string | null {
  try {
    const u = new URL(src, window.location.href);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.href;
  } catch {
    return null;
  }
}

/** Сеть перематываем только после 206. Иначе currentTime обнуляет ролик. */
function canAssignTime(video: HTMLVideoElement): boolean {
  if (remoteMode === 'local' || isLocalMedia(video)) return true;
  return networkSeekOk && remoteMode === 'ranges';
}

function paintFromVideo(): void {
  const v = els?.video;
  if (!v || seekDrag) return;
  // Пока новый src прячется или seek ещё едет, бегунок не сбрасываем в 0.
  if (v.style.opacity === '0' || v.seeking) return;
  const dur = v.duration;
  paintTime(v.currentTime, dur);
  if (Number.isFinite(dur) && dur > 0) paintSeek(clamp01(v.currentTime / dur));
}

function clearPendingSeek(): void {
  pendingSeek = null;
  pendingRatio = null;
  seekAttempts = 0;
  lastAssigned = -1;
}

function dropBlob(): void {
  if (blobUrl) URL.revokeObjectURL(blobUrl);
  blobUrl = null;
  if (stagedBlob) URL.revokeObjectURL(stagedBlob);
  stagedBlob = null;
}

function openStagedBlob(): void {
  if (!stagedBlob || !els) return;
  const url = stagedBlob;
  stagedBlob = null;
  adoptBlob(url, prepareToken);
}

type SeekBytes = {
  ok: boolean;
  ranges?: boolean;
  tooLarge?: boolean;
  mime?: string;
  data?: unknown;
  error?: string;
};

function bytesOf(data: unknown): Uint8Array | null {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return null;
}

function mimeOf(header: string | undefined, src: string): string {
  const clean = String(header || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (clean.startsWith('video/')) return clean;
  if (/\.webm(?:[?#]|$)/i.test(src)) return 'video/webm';
  if (/\.ogv(?:[?#]|$)/i.test(src)) return 'video/ogg';
  if (/\.mov(?:[?#]|$)/i.test(src)) return 'video/quicktime';
  return 'video/mp4';
}

/** Пишет currentTime, только если источник это переживёт. Иначе бегунок остаётся честным. */
function assignTime(target: number): void {
  const v = els?.video;
  if (!v || !canAssignTime(v)) return;
  const dur = v.duration;
  if (!Number.isFinite(dur) || dur <= 0) return;
  const t = Math.min(Math.max(0, target), Math.max(0, dur - 0.001));
  pendingSeek = t;
  if (Math.abs(v.currentTime - t) < 0.35) {
    seekAttempts = 0;
    if (!seekDrag) {
      pendingSeek = null;
      pendingRatio = null;
      paintFromVideo();
    }
    return;
  }
  if (Math.abs(lastAssigned - t) < 0.05) return;
  lastAssigned = t;
  try {
    v.currentTime = t;
  } catch {
    lastAssigned = -1;
    if (!seekDrag) paintFromVideo();
  }
}

function retryPending(): void {
  if (!els || seekDrag || pendingSeek == null) return;
  if (!canAssignTime(els.video) || els.video.seeking) return;
  assignTime(pendingSeek);
}

function onSeeked(): void {
  const v = els?.video;
  if (!v) return;
  const target = pendingSeek;
  if (target == null) {
    if (!seekDrag) paintFromVideo();
    return;
  }
  if (Math.abs(v.currentTime - target) < 0.45) {
    pendingSeek = null;
    pendingRatio = null;
    seekAttempts = 0;
    if (!seekDrag) paintFromVideo();
    return;
  }
  // Ответ без Range вернул файл с нуля. По этой сети больше не перематываем.
  const jumpedHome = target > 0.75 && v.currentTime < 0.35 && !isLocalMedia(v);
  if (jumpedHome) {
    networkSeekOk = false;
    seekAttempts = 0;
    lastAssigned = -1;
    if (!seekDrag) paintFromVideo();
    const remote = absoluteHttp(items[index]?.src || '');
    if (remote && remoteMode === 'ranges') {
      prepareToken += 1;
      remoteMode = 'blob';
      void prepareRemoteSeek(remote, prepareToken, true);
    }
    return;
  }
  if (seekAttempts < 4 && canAssignTime(v)) {
    seekAttempts += 1;
    lastAssigned = -1;
    assignTime(target);
    return;
  }
  pendingSeek = null;
  pendingRatio = null;
  seekAttempts = 0;
  if (!seekDrag) paintFromVideo();
}

async function prepareInPage(src: string, forceBlob: boolean): Promise<SeekBytes> {
  const headers: Record<string, string> = {};
  if (!forceBlob) headers.Range = 'bytes=0-1';
  const res = await fetch(src, { headers });
  if (!forceBlob && res.status === 206) {
    try {
      await res.body?.cancel();
    } catch {
      /* ignore */
    }
    return { ok: true, ranges: true };
  }
  if (!res.ok && res.status !== 206) return { ok: false, error: String(res.status) };
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > 80 * 1024 * 1024) return { ok: true, tooLarge: true };
  return { ok: true, ranges: false, mime: res.headers.get('content-type') || '', data: buf };
}

async function loadSeekBytes(src: string, forceBlob: boolean): Promise<SeekBytes> {
  const api = (
    window as unknown as {
      electronAPI?: {
        mediaPrepareSeek?: (payload: { url: string; forceBlob?: boolean }) => Promise<SeekBytes>;
      };
    }
  ).electronAPI;
  if (api?.mediaPrepareSeek) return api.mediaPrepareSeek({ url: src, forceBlob });
  return prepareInPage(src, forceBlob);
}

/** Локальная копия: currentTime больше не зависит от заголовков сервера. */
function adoptBlob(url: string, token: number): void {
  const v = els?.video;
  if (!v || token !== prepareToken) {
    URL.revokeObjectURL(url);
    return;
  }
  const keep = pendingSeek != null ? pendingSeek : v.currentTime;
  const paused = v.paused;
  const rate = v.playbackRate;
  if (blobUrl && blobUrl !== url) URL.revokeObjectURL(blobUrl);
  blobUrl = url;
  remoteMode = 'blob';
  networkSeekOk = true;
  lastAssigned = -1;
  seekAttempts = 0;
  // Явная цель (в том числе 0:00) важнее текущего кадра. Без цели продолжаем с того же места.
  if (pendingSeek == null && keep > 0.05) pendingSeek = keep;
  v.pause();
  // Новый src всегда стартует с нуля. Прячем кадр, пока currentTime не встанет на цель.
  v.style.opacity = '0';
  v.src = url;
  v.playbackRate = rate;
  let revealed = false;
  const reveal = () => {
    if (token !== prepareToken || !els) return;
    els.video.style.opacity = '';
  };
  v.addEventListener(
    'error',
    () => {
      reveal();
      if (!seekDrag) paintFromVideo();
    },
    { once: true },
  );
  window.setTimeout(reveal, 4000);
  const resume = () => {
    if (token !== prepareToken || !els) return;
    applyVolume();
    els.video.playbackRate = rate;
    if (pendingSeek != null) assignTime(pendingSeek);
    const finish = () => {
      if (revealed || token !== prepareToken || !els) return;
      revealed = true;
      els.video.style.opacity = '';
      if (!seekDrag) paintFromVideo();
      if (!paused) void els.video.play().catch(() => syncPlayIcon(true));
    };
    if (els.video.seeking) {
      els.video.addEventListener('seeked', finish, { once: true });
      window.setTimeout(finish, 800);
    } else {
      finish();
    }
  };
  if (v.readyState >= 1) resume();
  else v.addEventListener('loadedmetadata', resume, { once: true });
}

async function prepareRemoteSeek(src: string, token: number, forceBlob: boolean): Promise<void> {
  let result: SeekBytes;
  try {
    result = await loadSeekBytes(src, forceBlob);
  } catch {
    result = { ok: false };
  }
  if (token !== prepareToken || !els) return;
  if (!result.ok) {
    if (remoteMode === 'probing' || remoteMode === 'blob') remoteMode = 'failed';
    if (!seekDrag) paintFromVideo();
    return;
  }
  if (result.ranges && !forceBlob) {
    remoteMode = 'ranges';
    networkSeekOk = true;
    const v = els.video;
    if (pendingRatio != null && Number.isFinite(v.duration) && v.duration > 0) {
      pendingSeek = pendingRatio * v.duration;
      pendingRatio = null;
      lastAssigned = -1;
    }
    if (pendingSeek != null) assignTime(pendingSeek);
    else if (!seekDrag) paintFromVideo();
    return;
  }
  const bytes = bytesOf(result.data);
  if (!bytes || result.tooLarge) {
    remoteMode = 'failed';
    if (!seekDrag) paintFromVideo();
    return;
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const url = URL.createObjectURL(new Blob([copy.buffer], { type: mimeOf(result.mime, src) }));
  if (token !== prepareToken || !els) {
    URL.revokeObjectURL(url);
    return;
  }
  if (stagedBlob) URL.revokeObjectURL(stagedBlob);
  stagedBlob = null;
  // Пока перемотки нет, сетевой ролик не трогаем: смена src сама уводит кадр в 0:00.
  if (pendingSeek != null || pendingRatio != null) adoptBlob(url, token);
  else stagedBlob = url;
}

function volumeFromY(el: HTMLElement, clientY: number): number {
  const rect = el.getBoundingClientRect();
  if (rect.height <= 0) return volume;
  return clamp01(1 - (clientY - rect.top) / rect.height);
}

function seekToRatio(ratio: number): void {
  const v = els?.video;
  if (!v) return;
  const r = clamp01(ratio);
  const dur = v.duration;
  // До метаданных время не пишем: браузер обнуляет currentTime.
  if (!Number.isFinite(dur) || dur <= 0) {
    pendingRatio = r;
    if (seekDrag) paintSeek(r);
    openStagedBlob();
    return;
  }
  const target = r * dur;
  if (pendingSeek == null || Math.abs(pendingSeek - target) > 0.2) lastAssigned = -1;
  pendingRatio = null;
  pendingSeek = target;
  seekAttempts = 0;
  if (seekDrag) {
    paintSeek(r);
    paintTime(target, dur);
  }
  if (canAssignTime(v)) assignTime(target);
  else {
    if (!seekDrag) paintFromVideo();
    openStagedBlob();
  }
}

function seekBy(sec: number): void {
  const v = els?.video;
  if (!v || !Number.isFinite(v.duration) || v.duration <= 0) return;
  const base = pendingSeek != null ? pendingSeek : v.currentTime || 0;
  seekToRatio((base + sec) / v.duration);
}

function togglePlay(): void {
  const v = els?.video;
  if (!v || (phase !== 'open' && phase !== 'opening')) return;
  if (v.paused) void v.play().catch(() => syncPlayIcon(true));
  else v.pause();
}

function onPointerMove(e: PointerEvent): void {
  if (!els) return;
  if (seekDrag) {
    const track = seekTrack();
    const ratio = track ? ratioFromX(track, e.clientX) : null;
    if (ratio != null) seekToRatio(ratio);
  }
  if (volDrag) setVolume(volumeFromY(els.volTrack, e.clientY));
}

function endPointer(): void {
  const wasSeek = seekDrag;
  if (seekDrag || volDrag) suppressClick = true;
  seekDrag = false;
  volDrag = false;
  els?.vol.classList.remove('is-pinned');
  if (wasSeek && els) {
    const v = els.video;
    if (pendingSeek != null && canAssignTime(v)) {
      assignTime(pendingSeek);
      if (pendingSeek != null && !v.seeking) paintFromVideo();
    } else {
      paintFromVideo();
      openStagedBlob();
    }
  }
  if (!pointerArmed) return;
  pointerArmed = false;
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', endPointer);
  window.removeEventListener('pointercancel', endPointer);
}

function armPointer(): void {
  if (pointerArmed) return;
  pointerArmed = true;
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', endPointer);
  window.addEventListener('pointercancel', endPointer);
}

function showItem(nextIndex: number): void {
  if (!els || !items.length) return;
  const total = items.length;
  index = ((nextIndex % total) + total) % total;
  const item = items[index];
  const v = els.video;
  clearPendingSeek();
  prepareToken += 1;
  const token = prepareToken;
  const remote = absoluteHttp(item.src);
  remoteMode = remote ? 'probing' : 'local';
  networkSeekOk = !remote;
  v.pause();
  v.style.opacity = '';
  const prevBlob = blobUrl;
  const prevStaged = stagedBlob;
  blobUrl = null;
  stagedBlob = null;
  v.src = item.src;
  if (prevBlob) URL.revokeObjectURL(prevBlob);
  if (prevStaged && prevStaged !== prevBlob) URL.revokeObjectURL(prevStaged);
  if (item.alt) v.setAttribute('aria-label', item.alt);
  else v.removeAttribute('aria-label');
  applyVolume();
  syncLink();
  paintSeek(0);
  paintTime(0, Number.NaN);
  syncPlayIcon(true);
  void v.play().catch(() => syncPlayIcon(true));
  if (remote) void prepareRemoteSeek(remote, token, false);
}

function step(delta: number): void {
  if (items.length < 2 || phase === 'closing' || phase === 'closed') return;
  showItem(index + delta);
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

function silence(video: HTMLVideoElement): void {
  video.pause();
  video.removeAttribute('src');
  video.load();
}

function destroyViewer(): void {
  abortDismiss();
  endPointer();
  document.removeEventListener('keydown', onKey, true);
  prepareToken += 1;
  remoteMode = 'local';
  networkSeekOk = false;
  if (els) {
    const v = els.video;
    v.onplay = null;
    v.onpause = null;
    v.ontimeupdate = null;
    v.onloadedmetadata = null;
    v.onended = null;
    silence(v);
    els.root.remove();
  }
  dropBlob();
  els = null;
  items = [];
  index = 0;
  viewerSource = '';
  phase = 'closed';
  clearPendingSeek();
}

function finishDismiss(): void {
  if (phase !== 'closing') return;
  destroyViewer();
}

function ensure(): Els {
  if (els) return els;
  const root = document.createElement('div');
  root.id = 'video-player';
  root.className = 'vp-overlay';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Просмотр видео');
  root.innerHTML = `
    <div class="vp-stage" data-vp="stage">
      <video class="vp-video" data-vp="video" playsinline preload="auto"></video>
    </div>
    <div class="vp-panel" data-vp="panel" role="toolbar" aria-label="Панель видео">
      <button type="button" class="vp-panel__btn" data-vp="play" aria-label="Воспроизведение">${iconHtml('play.svg')}</button>
      <span class="vp-panel__sep" aria-hidden="true"></span>
      <div class="vp-seek" data-vp="seek">
        <div class="vp-seek__track">
          <div class="vp-seek__fill" data-vp="seek-fill"></div>
          <div class="vp-seek__thumb" data-vp="seek-thumb"></div>
        </div>
      </div>
      <span class="vp-time" data-vp="time"><span data-vp="time-cur">0:00</span><span class="vp-time__dur" data-vp="time-dur">&nbsp;/&nbsp;0:00</span></span>
      <span class="vp-panel__sep" aria-hidden="true"></span>
      <div class="vp-vol" data-vp="vol">
        <button type="button" class="vp-panel__btn" data-vp="volume" aria-label="Выключить звук">${iconHtml('volume.svg')}</button>
        <div class="vp-vol__pop" data-vp="vol-pop">
          <div class="vp-vol__hit" data-vp="vol-hit">
            <div class="vp-vol__track" data-vp="vol-track">
              <div class="vp-vol__fill" data-vp="vol-fill"></div>
            </div>
            <div class="vp-vol__thumb" data-vp="vol-thumb"></div>
          </div>
        </div>
      </div>
      <button type="button" class="vp-panel__btn" data-vp="link" aria-label="Открыть ссылку" hidden><img src="${LINK_ICON}" alt="" width="16" height="16" draggable="false"></button>
      <button type="button" class="vp-panel__btn" data-vp="close" aria-label="Закрыть">${iconHtml('close.svg')}</button>
    </div>
  `;
  document.body.appendChild(root);

  const q = <T extends Element>(sel: string) => root.querySelector(sel) as T;
  const built: Els = {
    root,
    stage: q('[data-vp="stage"]'),
    panel: q('[data-vp="panel"]'),
    video: q('[data-vp="video"]'),
    play: q('[data-vp="play"]'),
    playIcon: q('[data-vp="play"] img'),
    seek: q('[data-vp="seek"]'),
    seekFill: q('[data-vp="seek-fill"]'),
    seekThumb: q('[data-vp="seek-thumb"]'),
    timeCur: q('[data-vp="time-cur"]'),
    timeDur: q('[data-vp="time-dur"]'),
    vol: q('[data-vp="vol"]'),
    volBtn: q('[data-vp="volume"]'),
    volIcon: q('[data-vp="volume"] img'),
    volPop: q('[data-vp="vol-pop"]'),
    volTrack: q('[data-vp="vol-track"]'),
    volFill: q('[data-vp="vol-fill"]'),
    volThumb: q('[data-vp="vol-thumb"]'),
    link: q('[data-vp="link"]'),
  };

  built.play.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePlay();
  });
  built.link.addEventListener('click', (e) => {
    e.stopPropagation();
    openCurrentLink();
  });
  root.querySelector('[data-vp="close"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    closeVideoViewer();
  });
  built.volBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleMute();
  });

  built.video.addEventListener('click', (e) => {
    e.stopPropagation();
    // Клик после перемотки не должен ставить паузу и сбрасывать кадр.
    if (suppressClick || seekDrag) return;
    togglePlay();
  });
  built.video.addEventListener('play', () => syncPlayIcon(false));
  built.video.addEventListener('pause', () => syncPlayIcon(true));
  built.video.addEventListener('ended', () => syncPlayIcon(true));
  built.video.addEventListener('timeupdate', () => {
    if (!els || seekDrag) return;
    paintFromVideo();
  });
  built.video.addEventListener('progress', retryPending);
  built.video.addEventListener('canplay', retryPending);
  built.video.addEventListener('loadeddata', retryPending);
  built.video.addEventListener('seeked', onSeeked);
  built.video.addEventListener('loadedmetadata', () => {
    if (!els) return;
    applyVolume();
    const v = els.video;
    if (pendingRatio != null && Number.isFinite(v.duration) && v.duration > 0) {
      pendingSeek = pendingRatio * v.duration;
      pendingRatio = null;
      lastAssigned = -1;
    }
    if (pendingSeek != null) assignTime(pendingSeek);
    if (!seekDrag) paintFromVideo();
  });

  const onSeekPointer = (e: PointerEvent) => {
    if (e.button !== 0 || phase === 'closing') return;
    e.preventDefault();
    e.stopPropagation();
    seekDrag = true;
    try {
      built.seek.setPointerCapture(e.pointerId);
    } catch {
      /* захват не обязателен */
    }
    const track = built.seek.querySelector('.vp-seek__track') as HTMLElement | null;
    const ratio = track ? ratioFromX(track, e.clientX) : null;
    if (ratio != null) seekToRatio(ratio);
    armPointer();
  };
  built.seek.addEventListener('pointerdown', onSeekPointer);
  // Клик по дорожке не всплывает к ролику и не открывает его заново.
  built.seek.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  built.volPop.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    volDrag = true;
    built.vol.classList.add('is-pinned');
    setVolume(volumeFromY(built.volTrack, e.clientY));
    armPointer();
  });

  // Клик по тёмному фону мимо ролика и панели закрывает плеер.
  root.addEventListener('click', (e) => {
    if (phase === 'closing') return;
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    const t = e.target as Node;
    if (built.panel.contains(t) || t === built.video) return;
    closeVideoViewer();
  });

  document.addEventListener('keydown', onKey, true);
  els = built;
  paintVolume();
  return built;
}

/** source — чтобы закрыть плеер вместе с модалкой новости или страницы мода. */
export function openVideoViewer(list: VideoViewerItem[], start = 0, source = ''): void {
  const clean = (list || []).filter((it) => it && String(it.src || '').trim());
  if (!clean.length) return;
  const wasClosing = phase === 'closing';
  if (wasClosing) abortDismiss();
  const ui = ensure();
  items = clean;
  viewerSource = source;
  ui.vol.classList.remove('is-pinned');
  const reopen = wasClosing || phase === 'closed';
  showItem(start);
  if (reopen) {
    playOpen();
    return;
  }
  if (phase === 'opening') return;
  ui.root.classList.add('is-shown');
  phase = 'open';
}

/** Без source закрывает всегда. С source — только если плеер открыт из этого контекста. */
export function closeVideoViewer(source?: string): void {
  if (phase === 'closed' || phase === 'closing') return;
  if (!els) return;
  if (source && viewerSource !== source) return;
  phase = 'closing';
  endPointer();
  els.vol.classList.remove('is-pinned');
  // Звук обрываем сразу, кадр остаётся до конца анимации.
  els.video.pause();
  els.root.classList.remove('is-shown');
  const dur = getComputedStyle(els.root).transitionDuration || '';
  if (dur === '0s' || dur === '0ms') {
    destroyViewer();
    return;
  }
  els.root.addEventListener('transitionend', onDismissEnd);
  dismissTimer = window.setTimeout(finishDismiss, DISMISS_MS + 80);
}

function videoSrcOf(video: HTMLVideoElement): string {
  const own = (video.getAttribute('src') || video.currentSrc || video.src || '').trim();
  if (own) return own;
  const source = video.querySelector('source');
  return (source?.getAttribute('src') || source?.src || '').trim();
}

/**
 * Уже отрисованные <video> открывают этот плеер, а не играют на месте.
 * external — кнопка оригинального URL (каталог / страница мода).
 */
export function bindPlayableVideos(
  container: HTMLElement,
  opts?: { external?: boolean; source?: string },
): void {
  const external = Boolean(opts?.external);
  const source = opts?.source || '';
  const videos = Array.from(container.querySelectorAll('video')).filter((video) => {
    if (video.dataset.vpBound === '1') return false;
    if (video.id === 'quick-banner-bg') return false;
    if (video.closest('#video-player, .msgr-media, .sf-video-thumb, .sf-quote__media')) return false;
    return Boolean(videoSrcOf(video));
  });
  for (const video of videos) {
    video.dataset.vpBound = '1';
    video.classList.add('vp-inline');
    video.removeAttribute('controls');
    video.controls = false;
    const stopInline = () => {
      if (!video.paused) video.pause();
    };
    video.addEventListener('play', stopInline);
    video.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      stopInline();
      const batch = videos
        .map((el) => {
          const src = videoSrcOf(el);
          return {
            src,
            alt: el.getAttribute('title') || '',
            externalUrl: external ? httpUrlOf(src) : null,
          };
        })
        .filter((it) => it.src);
      if (!batch.length) return;
      openVideoViewer(batch, Math.max(0, videos.indexOf(video)), source);
    });
  }
}
