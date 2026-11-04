// Назначение: голосовые сообщения в стиле Telegram — play + waveform + seek.

/** Inline SVG — без зависимости от относительных путей img. */
const ICO_PLAY = `<svg class="gs-voice-play__ico" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M0 1.61803C0 0.724419 0.724419 0 1.61803 0C1.86923 0 2.11697 0.058484 2.34164 0.17082L15.1056 6.55279C15.6537 6.82687 16 7.38713 16 8C16 8.61287 15.6537 9.17313 15.1056 9.44721L2.34164 15.8292C2.11697 15.9415 1.86923 16 1.61803 16C0.724418 16 0 15.2756 0 14.382V1.61803Z" fill="currentColor"/></svg>`;

const ICO_PAUSE = `<svg class="gs-voice-play__ico" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="1" width="4" height="16" rx="2" fill="currentColor"/><rect x="11" width="4" height="16" rx="2" fill="currentColor"/></svg>`;

const players = new Map<string, HTMLAudioElement>();
const waveforms = new Map<string, Float32Array>();

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

/** Переключение play/pause — те же path, что в assets/icons/chats. */
function setPlayIcon(btn: HTMLElement, playing: boolean): void {
  btn.classList.toggle('is-playing', playing);
  btn.setAttribute('aria-label', playing ? 'Пауза' : 'Воспроизвести');
  btn.innerHTML = playing ? ICO_PAUSE : ICO_PLAY;
}

function drawWaveform(uid: string, progress: number): void {
  const canvas = document.getElementById(`gs-vwc-${uid}`) as HTMLCanvasElement | null;
  if (!canvas) return;
  const bars = waveforms.get(uid);
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.offsetWidth || 180;
  const H = 28;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ef4444';
  const muted = 'rgba(255,255,255,0.22)';

  if (!bars) {
    const N = 42;
    const bw = 2;
    const gap = 2;
    const total = N * (bw + gap) - gap;
    const ox = Math.max(0, (W - total) / 2);
    for (let i = 0; i < N; i++) {
      const h = H * 0.22 + Math.sin(i * 0.55) * H * 0.18 + (i % 5) * 0.8;
      const x = ox + i * (bw + gap);
      ctx.fillStyle = muted;
      ctx.beginPath();
      ctx.roundRect(x, (H - h) / 2, bw, h, 1);
      ctx.fill();
    }
    return;
  }

  const N = bars.length;
  const slot = W / N;
  const bw = Math.max(2, Math.floor(slot * 0.55));
  const gap = Math.max(1, slot - bw);
  const totalW = N * (bw + gap) - gap;
  const ox = Math.max(0, (W - totalW) / 2);

  for (let i = 0; i < N; i++) {
    const h = Math.max(3, bars[i] * (H - 4));
    const x = ox + i * (bw + gap);
    ctx.fillStyle = i / N <= progress ? accent : muted;
    ctx.beginPath();
    ctx.roundRect(x, (H - h) / 2, bw, h, 1);
    ctx.fill();
  }
}

async function initWaveform(uid: string, url: string): Promise<void> {
  if (waveforms.has(uid)) {
    drawWaveform(uid, 0);
    return;
  }
  drawWaveform(uid, 0);
  try {
    const resp = await fetch(url);
    const arrayBuf = await resp.arrayBuffer();
    const audioCtx = new OfflineAudioContext(1, 1, 44100);
    const decoded = await audioCtx.decodeAudioData(arrayBuf.slice(0));
    const raw = decoded.getChannelData(0);
    const BARS = 56;
    const step = Math.max(1, Math.floor(raw.length / BARS));
    const bars = new Float32Array(BARS);
    for (let i = 0; i < BARS; i++) {
      let sum = 0;
      for (let j = 0; j < step; j++) sum += Math.abs(raw[i * step + j] || 0);
      bars[i] = sum / step;
    }
    const maxV = Math.max(...bars, 0.001);
    for (let i = 0; i < BARS; i++) bars[i] /= maxV;
    waveforms.set(uid, bars);
    drawWaveform(uid, 0);

    const timeEl = document.getElementById(`gs-vtime-${uid}`);
    if (timeEl && !timeEl.dataset.locked) {
      timeEl.textContent = fmtTime(decoded.duration);
    }
  } catch {
    /* оставляем placeholder bars */
  }
}

function stopOthers(exceptUid: string): void {
  for (const [uid, aud] of players) {
    if (uid === exceptUid) continue;
    aud.pause();
    const btn = document.querySelector(`.gs-voice-play[data-uid="${uid}"]`) as HTMLElement | null;
    if (btn) setPlayIcon(btn, false);
    drawWaveform(uid, aud.duration ? aud.currentTime / aud.duration : 0);
  }
}

function ensureAudio(uid: string, url: string): HTMLAudioElement {
  let aud = players.get(uid);
  if (aud) return aud;
  aud = new Audio(url);
  aud.preload = 'metadata';
  players.set(uid, aud);

  aud.addEventListener('loadedmetadata', () => {
    const timeEl = document.getElementById(`gs-vtime-${uid}`);
    if (timeEl && !aud!.paused) return;
    if (timeEl) {
      timeEl.textContent = fmtTime(aud!.duration);
      timeEl.dataset.locked = '1';
    }
  });

  aud.addEventListener('timeupdate', () => {
    const pct = aud!.duration ? aud!.currentTime / aud!.duration : 0;
    drawWaveform(uid, pct);
    const timeEl = document.getElementById(`gs-vtime-${uid}`);
    if (timeEl) {
      timeEl.textContent = aud!.paused
        ? fmtTime(aud!.duration || 0)
        : fmtTime(aud!.currentTime);
    }
  });

  aud.addEventListener('ended', () => {
    const btn = document.querySelector(`.gs-voice-play[data-uid="${uid}"]`) as HTMLElement | null;
    if (btn) setPlayIcon(btn, false);
    drawWaveform(uid, 0);
    const timeEl = document.getElementById(`gs-vtime-${uid}`);
    if (timeEl) timeEl.textContent = fmtTime(aud!.duration || 0);
  });

  return aud;
}

function handlePlay(btn: HTMLElement): void {
  const uid = btn.getAttribute('data-uid') || '';
  const url = btn.getAttribute('data-url') || '';
  if (!uid || !url) return;
  const aud = ensureAudio(uid, url);
  if (aud.paused) {
    stopOthers(uid);
    void aud.play().then(() => setPlayIcon(btn, true)).catch(() => setPlayIcon(btn, false));
  } else {
    aud.pause();
    setPlayIcon(btn, false);
  }
}

function handleSeek(canvas: HTMLCanvasElement, ev: MouseEvent): void {
  const uid = canvas.getAttribute('data-uid') || '';
  const url = canvas.getAttribute('data-url') || '';
  if (!uid || !url) return;
  const aud = ensureAudio(uid, url);
  const rect = canvas.getBoundingClientRect();
  const pct = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
  const seek = () => {
    if (aud.duration) {
      aud.currentTime = pct * aud.duration;
      drawWaveform(uid, pct);
    }
  };
  if (aud.readyState >= 1) seek();
  else aud.addEventListener('loadedmetadata', seek, { once: true });
}

/** HTML голосового сообщения (Telegram-like). */
export function voiceMessageHtml(url: string, sizeBytes?: number | null): string {
  const uid = `v${Math.random().toString(36).slice(2, 10)}`;
  const size =
    sizeBytes != null && Number.isFinite(Number(sizeBytes)) && Number(sizeBytes) > 0
      ? formatBytes(Number(sizeBytes))
      : '';
  return `<div class="gs-voice-msg" data-audio-uid="${uid}">
    <button type="button" class="gs-voice-play" data-uid="${uid}" data-url="${escapeAttr(url)}" aria-label="Воспроизвести">
      ${ICO_PLAY}
    </button>
    <div class="gs-voice-body">
      <canvas class="gs-voice-wave" id="gs-vwc-${uid}" data-uid="${uid}" data-url="${escapeAttr(url)}" height="28"></canvas>
      <div class="gs-voice-meta">
        <span class="gs-voice-time" id="gs-vtime-${uid}">0:00</span>
        ${size ? `<span class="gs-voice-size">${escapeAttr(size)}</span>` : ''}
      </div>
    </div>
  </div>`;
}

function escapeAttr(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Привязать play/seek и декод waveform после renderMessages. */
export function bindVoicePlayers(root: HTMLElement): void {
  root.querySelectorAll('.gs-voice-play').forEach((el) => {
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      handlePlay(el as HTMLElement);
    });
  });
  root.querySelectorAll('.gs-voice-wave').forEach((el) => {
    const canvas = el as HTMLCanvasElement;
    const uid = canvas.getAttribute('data-uid') || '';
    const url = canvas.getAttribute('data-url') || '';
    canvas.addEventListener('click', (ev) => {
      ev.stopPropagation();
      handleSeek(canvas, ev as MouseEvent);
    });
    if (uid && url) void initWaveform(uid, url);
  });
}
