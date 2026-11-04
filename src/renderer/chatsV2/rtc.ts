// WebRTC-движок чатов v2: голосовые каналы (mesh, протокол vc_*) и личные звонки (call_*).
// Без разметки UI — только состояние, аудио-элементы и сигналинг через WS мастера.
import { S, allVoiceChannels, channelAllows, getProfile, invalidate, errText, rememberUser, unwrap } from './store';
import { playGsSound, startCallRing, stopCallRing } from './sounds';
import { sameId } from './util';

type WsSend = (p: Record<string, unknown>) => Promise<unknown>;
type Notify = (text: string, kind?: 'info' | 'error') => void;

let wsSend: WsSend = async () => undefined;
let notify: Notify = () => undefined;

export function rtcInit(send: WsSend, toast: Notify): void {
  wsSend = send;
  notify = toast;
}

// ===== Настройки устройств и громкости =====

const LS_IN = 'cv2.audioIn';
const LS_OUT = 'cv2.audioOut';
const LS_VOL = 'cv2.userVolume';

export const DEV = {
  input: localStorage.getItem(LS_IN) || '',
  output: localStorage.getItem(LS_OUT) || '',
  volumes: ((): Record<string, number> => {
    try {
      return JSON.parse(localStorage.getItem(LS_VOL) || '{}') as Record<string, number>;
    } catch {
      return {};
    }
  })(),
};

export async function listDevices(): Promise<{ inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[] }> {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    return { inputs: all.filter((d) => d.kind === 'audioinput'), outputs: all.filter((d) => d.kind === 'audiooutput') };
  } catch {
    return { inputs: [], outputs: [] };
  }
}

export async function setInputDevice(id: string): Promise<void> {
  DEV.input = id;
  localStorage.setItem(LS_IN, id);
  // Подменяем трек на лету во всех соединениях
  if (!localStream) return;
  const old = localStream;
  localStream = null;
  const fresh = await ensureMic();
  const track = fresh.getAudioTracks()[0];
  for (const pc of allPcs()) {
    for (const sender of pc.getSenders()) if (sender.track?.kind === 'audio' && track) await sender.replaceTrack(track);
  }
  old.getTracks().forEach((t) => t.stop());
  applyMuteToTracks();
  startVad();
}

export async function setOutputDevice(id: string): Promise<void> {
  DEV.output = id;
  localStorage.setItem(LS_OUT, id);
  for (const el of Array.from(audioRoot().querySelectorAll('audio'))) await sinkTo(el as HTMLAudioElement);
}

export function setUserVolume(uid: number, vol: number): void {
  DEV.volumes[String(uid)] = Math.max(0, Math.min(1, vol));
  localStorage.setItem(LS_VOL, JSON.stringify(DEV.volumes));
  const el = document.getElementById(`cv2-audio-${uid}`) as HTMLAudioElement | null;
  if (el) el.volume = DEV.volumes[String(uid)]!;
}

export function userVolume(uid: number): number {
  const v = DEV.volumes[String(uid)];
  return typeof v === 'number' ? v : 1;
}

// ===== Общее состояние =====

export const V = {
  channelId: null as number | null,
  roomId: null as number | null,
  canSpeak: true,
  muted: false,
  deafened: false,
  connecting: false,
  speaking: new Set<number>(),
  selfMuted: new Set<number>(),
  selfDeafened: new Set<number>(),
  serverMuted: new Set<number>(),
  joinedAt: 0,
  /** RTT выбранной пары ICE, миллисекунды. null — ещё нет статистики. */
  pingMs: null as number | null,
};

export type CallPhase = 'outgoing' | 'incoming' | 'connecting' | 'active';

export const C = {
  peerId: null as number | null,
  phase: null as CallPhase | null,
  startedAt: 0,
  remoteSpeaking: false,
  peerMuted: false,
};

let localStream: MediaStream | null = null;
let ice: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
let iceLoaded = false;
const peers = new Map<number, RTCPeerConnection>();
const pendingIce = new Map<number, RTCIceCandidateInit[]>();
let callPc: RTCPeerConnection | null = null;
let callIce: RTCIceCandidateInit[] = [];
let ringTimer: number | null = null;

function allPcs(): RTCPeerConnection[] {
  return [...peers.values(), ...(callPc ? [callPc] : [])];
}

let lastRtcAt = 0;
let lastProbeAt = 0;
const offerRetryAt = new Map<number, number>();

type RttRow = RTCStats & {
  currentRoundTripTime?: number;
  roundTripTime?: number;
  state?: string;
  nominated?: boolean;
  selected?: boolean;
  selectedCandidatePairId?: string;
};

/** RTT выбранной ICE-пары или remote-inbound, в миллисекундах. */
function rttFromStats(stats: RTCStatsReport): number | null {
  let selectedId = '';
  stats.forEach((report) => {
    const row = report as RttRow;
    if (row.type === 'transport' && row.selectedCandidatePairId) selectedId = String(row.selectedCandidatePairId);
  });
  let best: number | null = null;
  const take = (sec?: number) => {
    if (typeof sec !== 'number' || !(sec > 0)) return;
    const ms = Math.round(sec * 1000);
    if (ms > 0 && (best == null || ms < best)) best = ms;
  };
  stats.forEach((report) => {
    const row = report as RttRow;
    if (row.type === 'candidate-pair') {
      const live = row.id === selectedId || row.selected || row.nominated || row.state === 'succeeded';
      if (!live) return;
      take(row.currentRoundTripTime);
      return;
    }
    if (row.type === 'remote-inbound-rtp') take(row.roundTripTime);
  });
  return best;
}

/** Серверный RTT из pong, если голосового RTT ещё нет (один в канале). */
export function noteServerPing(ms: number): void {
  if (!V.channelId && C.phase !== 'active' && C.phase !== 'connecting') return;
  if (!(ms > 0)) return;
  if (Date.now() - lastRtcAt < 2500) return;
  V.pingMs = Math.round(ms);
}

/** Пинг голосового канала: RTT медиа, иначе ping/pong до мастера. */
export async function sampleVoicePing(): Promise<void> {
  const inVoice = Boolean(V.channelId) || C.phase === 'active' || C.phase === 'connecting';
  if (!inVoice) {
    V.pingMs = null;
    lastRtcAt = 0;
    return;
  }
  let best: number | null = null;
  for (const pc of allPcs()) {
    try {
      const ms = rttFromStats(await pc.getStats());
      if (ms != null && (best == null || ms < best)) best = ms;
    } catch {
      /* статистика недоступна, пока соединение не поднято */
    }
  }
  if (V.channelId) nudgeVoicePeers();
  if (best != null) {
    lastRtcAt = Date.now();
    V.pingMs = best;
    return;
  }
  const now = performance.now();
  if (now - lastProbeAt < 3000) return;
  lastProbeAt = now;
  try {
    const sent = (await wsSend({ type: 'ping' })) as { ms?: number } | null;
    const ms = Number(sent?.ms);
    if (ms > 0) noteServerPing(ms);
  } catch {
    /* мастер недоступен — оставляем последнее значение */
  }
}

/** Если оффер потерялся, участник с меньшим id шлёт его снова. */
function nudgeVoicePeers(): void {
  if (!V.channelId) return;
  const now = Date.now();
  for (const uid of channelMembers(V.channelId)) {
    if (sameId(uid, S.me.id) || !shouldOffer(uid)) continue;
    const pc = peers.get(uid);
    const stuck = !pc || pc.connectionState === 'failed' || pc.connectionState === 'disconnected' || (pc.connectionState === 'new' && !pc.remoteDescription);
    if (!stuck) continue;
    if (now - (offerRetryAt.get(uid) || 0) < 4000) continue;
    offerRetryAt.set(uid, now);
    if (pc) dropPeer(uid);
    void createPeer(uid, true);
  }
}

function audioRoot(): HTMLElement {
  let el = document.getElementById('cv2-audio');
  if (!el) {
    el = document.createElement('div');
    el.id = 'cv2-audio';
    // hidden/display:none глушит <audio> в Chromium — уводим за экран, не скрывая воспроизведение
    el.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none';
    document.body.appendChild(el);
  }
  return el;
}

function asSdp(raw: unknown): RTCSessionDescriptionInit | null {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object') return null;
  const o = value as Record<string, unknown>;
  const sdp = typeof o.sdp === 'string' ? o.sdp : '';
  const type = o.type === 'offer' || o.type === 'answer' || o.type === 'pranswer' ? o.type : '';
  if (!sdp || !type) return null;
  return { type, sdp };
}

function asIce(raw: unknown): RTCIceCandidateInit | null {
  if (typeof raw === 'string') {
    try {
      return asIce(JSON.parse(raw));
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.candidate && typeof o.candidate === 'object') return asIce(o.candidate);
  const candidate = typeof o.candidate === 'string' ? o.candidate : '';
  if (!candidate) return null;
  return {
    candidate,
    sdpMid: o.sdpMid == null ? null : String(o.sdpMid),
    sdpMLineIndex: o.sdpMLineIndex == null ? null : Number(o.sdpMLineIndex),
  };
}

/** Имя и аватар собеседника: из сигнала, из списка ЛС, затем из профиля. */
function rememberCallPeer(id: number, msg?: Record<string, any>): void {
  const fromSignal = String(msg?.username || msg?.caller_name || '').trim();
  if (fromSignal && !fromSignal.startsWith('Пользователь')) {
    rememberUser({
      id,
      username: fromSignal,
      avatar_url: msg?.avatar_url ?? null,
      avatar_color: msg?.avatar_color ?? null,
    });
  }
  const dm = S.dms.find((d) => sameId(d.peer_id, id));
  if (dm?.peer_username) {
    rememberUser({
      id,
      username: dm.peer_username,
      avatar_url: dm.peer_avatar_url,
      avatar_color: dm.peer_avatar_color,
    });
  }
}

async function ensureCallPeer(id: number, msg?: Record<string, any>): Promise<void> {
  rememberCallPeer(id, msg);
  const known = S.users.get(id);
  if (known?.username && known.avatar_url) return;
  await getProfile(id);
  invalidate('voice', 'main', 'sidebar', 'header');
}

async function sinkTo(el: HTMLAudioElement): Promise<void> {
  const a = el as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
  if (typeof a.setSinkId !== 'function') return;
  try {
    await a.setSinkId(DEV.output || '');
  } catch {
    /* устройство пропало — остаёмся на системном */
  }
}

let iceAt = 0;

/** Конфиг запрашивается заново: пароль TURN живёт час, кэш на всё окно его протухает. */
async function loadIce(force = false): Promise<void> {
  if (!force && iceLoaded && Date.now() - iceAt < 4 * 60 * 1000) return;
  try {
    const res = await S.api.cloudRtcConfig?.();
    const list = res?.data?.iceServers || res?.iceServers;
    if (Array.isArray(list) && list.length) {
      ice = { iceServers: list as RTCIceServer[] };
      iceLoaded = true;
      iceAt = Date.now();
    }
  } catch {
    /* только STUN */
  }
}

async function ensureMic(): Promise<MediaStream> {
  if (localStream) return localStream;
  const audio: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  if (DEV.input) audio.deviceId = { exact: DEV.input };
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
  } catch {
    if (!DEV.input) throw new Error('Нет доступа к микрофону');
    // Сохранённый микрофон отключён — берём системный
    DEV.input = '';
    localStorage.removeItem(LS_IN);
    localStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
  }
  applyMuteToTracks();
  return localStream;
}

function applyMuteToTracks(): void {
  const off = V.muted || V.deafened || (V.channelId != null && !V.canSpeak);
  localStream?.getAudioTracks().forEach((t) => {
    t.enabled = !off;
  });
}

function releaseMic(): void {
  stopVad();
  localStream?.getTracks().forEach((t) => t.stop());
  localStream = null;
}

function iceJson(c: RTCIceCandidate): RTCIceCandidateInit {
  // RTCIceCandidate через IPC сериализуется в {} — передаём примитивы
  return { candidate: String(c.candidate || ''), sdpMid: c.sdpMid ?? '0', sdpMLineIndex: Number(c.sdpMLineIndex ?? 0) };
}

function sdpJson(d: RTCSessionDescriptionInit): RTCSessionDescriptionInit {
  return { type: d.type, sdp: d.sdp };
}

async function attachAudio(uid: number, stream: MediaStream): Promise<void> {
  let el = document.getElementById(`cv2-audio-${uid}`) as HTMLAudioElement | null;
  if (!el) {
    el = document.createElement('audio');
    el.id = `cv2-audio-${uid}`;
    el.autoplay = true;
    audioRoot().appendChild(el);
  }
  el.srcObject = stream;
  el.muted = V.deafened;
  el.volume = userVolume(uid);
  await sinkTo(el);
  const play = () => void el?.play().catch(() => undefined);
  stream.getAudioTracks().forEach((t) => {
    t.onunmute = play;
  });
  play();
}

function dropAudio(uid: number): void {
  document.getElementById(`cv2-audio-${uid}`)?.remove();
}

// ===== Детектор речи (локальный) =====

let vad: { ctx: AudioContext; raf: number; last: boolean } | null = null;

function stopVad(): void {
  if (!vad) return;
  cancelAnimationFrame(vad.raf);
  void vad.ctx.close().catch(() => undefined);
  vad = null;
}

function setMySpeaking(on: boolean): void {
  const me = S.me.id;
  if (me == null) return;
  if (on === V.speaking.has(me)) return;
  if (on) V.speaking.add(me);
  else V.speaking.delete(me);
  paintSpeaking();
  if (V.channelId) void wsSend({ type: 'vc_speaking', voice_channel_id: V.channelId, speaking: on });
}

function startVad(): void {
  stopVad();
  if (!localStream) return;
  let ctx: AudioContext;
  try {
    ctx = new AudioContext();
  } catch {
    return;
  }
  const src = ctx.createMediaStreamSource(localStream);
  const an = ctx.createAnalyser();
  an.fftSize = 512;
  an.smoothingTimeConstant = 0.3;
  src.connect(an);
  const buf = new Uint8Array(an.fftSize);
  const state = { ctx, raf: 0, last: false };
  vad = state;
  let quietFrames = 0;
  const tick = () => {
    if (vad !== state) return;
    an.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i]! - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / buf.length);
    const live = !V.muted && !V.deafened && (V.channelId == null || V.canSpeak);
    // Гистерезис: включаем сразу, выключаем после ~250 мс тишины
    let on = state.last;
    if (live && rms > 0.04) {
      on = true;
      quietFrames = 0;
    } else if (++quietFrames > 15) on = false;
    if (on !== state.last) {
      state.last = on;
      // В личке channelId пустой, но кольцо «говорит» нужно и там
      if (V.channelId || C.phase) setMySpeaking(on);
    }
    state.raf = requestAnimationFrame(tick);
  };
  void ctx.resume().catch(() => undefined);
  state.raf = requestAnimationFrame(tick);
}

/** Точечное обновление колец «говорит» без полной перерисовки. */
export function paintSpeaking(): void {
  document.querySelectorAll<HTMLElement>('[data-speak-uid]').forEach((el) => {
    const uid = Number(el.dataset.speakUid);
    const on = V.speaking.has(uid) || (C.phase === 'active' && sameId(uid, C.peerId) && C.remoteSpeaking);
    el.classList.toggle('is-speaking', on);
  });
}

// ===== Голосовые каналы =====

export function channelMembers(channelId: number): number[] {
  return S.voiceMembers.get(channelId) || [];
}

function setChannelMembers(channelId: number, ids: number[]): void {
  S.voiceMembers.set(channelId, [...new Set(ids.map(Number).filter(Boolean))]);
}

/** Оффер шлёт клиент с меньшим UUID. Локальные числа id на двух окнах не совпадают. */
function shouldOffer(otherId: number): boolean {
  const mine = S.me.key;
  const theirs = S.userKeys.get(Number(otherId)) || '';
  if (mine && theirs && mine !== theirs) return mine < theirs;
  return Number(S.me.id) < Number(otherId);
}

function dropPeer(uid: number): void {
  const pc = peers.get(uid);
  pendingIce.delete(uid);
  if (pc) {
    try {
      pc.close();
    } catch {
      /* уже закрыт */
    }
  }
  peers.delete(uid);
  dropAudio(uid);
  V.speaking.delete(uid);
}

async function createPeer(uid: number, offerer: boolean): Promise<RTCPeerConnection | null> {
  if (peers.has(uid)) return peers.get(uid)!;
  if (sameId(uid, S.me.id) || !V.channelId) return null;
  const stream = await ensureMic();
  const pc = new RTCPeerConnection(ice);
  peers.set(uid, pc);
  stream.getTracks().forEach((t) => pc.addTrack(t, stream));
  pc.onicecandidate = (e) => {
    if (!e.candidate || !V.channelId) return;
    void wsSend({ type: 'vc_ice', voice_channel_id: V.channelId, target_id: uid, to_id: uid, candidate: iceJson(e.candidate) });
  };
  pc.ontrack = (e) => {
    void attachAudio(uid, e.streams[0] || new MediaStream([e.track]));
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed') {
      // Переподключение: оффер всегда делает участник с меньшим id
      dropPeer(uid);
      if (shouldOffer(uid) && V.channelId) void createPeer(uid, true);
    }
  };
  if (offerer) {
    const offer = await pc.createOffer({ offerToReceiveAudio: true });
    await pc.setLocalDescription(offer);
    void wsSend({ type: 'vc_offer', voice_channel_id: V.channelId, target_id: uid, to_id: uid, sdp: sdpJson(offer) });
  }
  return pc;
}

async function flushPeerIce(uid: number): Promise<void> {
  const pc = peers.get(uid);
  const q = pendingIce.get(uid);
  if (!pc || !q?.length || !pc.remoteDescription) return;
  pendingIce.delete(uid);
  for (const c of q) await pc.addIceCandidate(c).catch(() => undefined);
}

export async function vcJoin(channelId: number, roomId: number): Promise<boolean> {
  if (sameId(V.channelId, channelId)) return true;
  const voice = allVoiceChannels(S.details.get(roomId)).find((c) => c.id === channelId);
  if (voice && !channelAllows(roomId, voice, 'connect')) {
    notify('Нет права подключаться к этому каналу', 'error');
    return false;
  }
  if (C.phase) await callHangup();
  if (V.channelId) await vcLeave(false);
  V.connecting = true;
  invalidate('voice', 'sidebar', 'main');
  await loadIce(true);
  try {
    await ensureMic();
  } catch (e) {
    V.connecting = false;
    notify('Нет доступа к микрофону: ' + errText(e), 'error');
    invalidate('voice', 'sidebar', 'main');
    return false;
  }
  try {
    const r = unwrap<{ can_speak?: boolean }>(await S.api.cloudJoinVoiceChannel?.(channelId), 'Не удалось подключиться');
    V.canSpeak = r?.can_speak !== false;
  } catch (e) {
    V.connecting = false;
    releaseMic();
    notify(errText(e), 'error');
    invalidate('voice', 'sidebar', 'main');
    return false;
  }
  V.channelId = channelId;
  V.roomId = roomId;
  if (voice && !channelAllows(roomId, voice, 'speak')) {
    V.canSpeak = false;
    V.muted = true;
  }
  V.joinedAt = Date.now();
  V.connecting = false;
  S.voiceRoom.set(channelId, roomId);
  if (S.me.id) setChannelMembers(channelId, [...channelMembers(channelId), S.me.id]);
  if (!V.canSpeak) V.muted = true;
  applyMuteToTracks();
  await wsSend({ type: 'vc_join', voice_channel_id: channelId, room_id: roomId });
  publishState();
  playGsSound('connect');
  startVad();
  invalidate('voice', 'sidebar', 'main');
  return true;
}

export async function vcLeave(sound = true): Promise<void> {
  const ch = V.channelId;
  if (!ch) return;
  setMySpeaking(false);
  for (const uid of [...peers.keys()]) dropPeer(uid);
  releaseMic();
  V.channelId = null;
  V.roomId = null;
  V.speaking.clear();
  if (S.me.id) setChannelMembers(ch, channelMembers(ch).filter((id) => id !== S.me.id));
  await wsSend({ type: 'vc_leave', voice_channel_id: ch }).catch(() => undefined);
  void S.api.cloudLeaveVoiceChannel?.(ch);
  if (sound) playGsSound('hangup');
  invalidate('voice', 'sidebar', 'main');
}

function publishState(): void {
  const me = S.me.id;
  if (me != null) {
    if (V.muted || V.deafened) V.selfMuted.add(me);
    else V.selfMuted.delete(me);
    if (V.deafened) V.selfDeafened.add(me);
    else V.selfDeafened.delete(me);
  }
  if (V.channelId) void wsSend({ type: 'vc_state', voice_channel_id: V.channelId, muted: V.muted, deafened: V.deafened });
}

export function toggleMute(): void {
  if (V.channelId && !V.canSpeak && V.muted) {
    notify('Нет права говорить на этом сервере', 'error');
    return;
  }
  // Как в Discord: снятие мута при оглушении снимает и оглушение
  if (V.muted && V.deafened) V.deafened = false;
  V.muted = !V.muted;
  applyMuteToTracks();
  for (const el of Array.from(audioRoot().querySelectorAll('audio'))) (el as HTMLAudioElement).muted = V.deafened;
  if (V.muted) setMySpeaking(false);
  publishState();
  invalidate('voice', 'sidebar', 'main');
}

export function toggleDeafen(): void {
  V.deafened = !V.deafened;
  applyMuteToTracks();
  for (const el of Array.from(audioRoot().querySelectorAll('audio'))) (el as HTMLAudioElement).muted = V.deafened;
  if (V.deafened) setMySpeaking(false);
  publishState();
  invalidate('voice', 'sidebar', 'main');
}

/** События vc_* — часть рассылается всем (vc_joined/vc_left), часть только участникам канала. */
export async function handleVc(msg: Record<string, any>): Promise<void> {
  const type = String(msg.type);
  const ch = Number(msg.voice_channel_id) || 0;
  const from = Number(msg.from_id ?? msg.user_id) || 0;
  if (msg.room_id && ch) S.voiceRoom.set(ch, Number(msg.room_id));

  if (type === 'vc_joined') {
    const ids = Array.isArray(msg.members) ? msg.members.map((m: any) => Number(m.user_id ?? m.id)) : [];
    for (const m of msg.members || []) {
      const uid = Number(m.user_id ?? m.id);
      if (m.self_muted) V.selfMuted.add(uid);
      else if (!sameId(uid, S.me.id)) V.selfMuted.delete(uid);
      if (m.self_deafened) V.selfDeafened.add(uid);
      else if (!sameId(uid, S.me.id)) V.selfDeafened.delete(uid);
      if (m.server_muted) V.serverMuted.add(uid);
      else V.serverMuted.delete(uid);
    }
    // Пользователь в каждый момент только в одном канале — убираем его из остальных
    for (const [cid, list] of S.voiceMembers) if (cid !== ch && list.includes(from)) setChannelMembers(cid, list.filter((x) => x !== from));
    setChannelMembers(ch, ids.length ? ids : [...channelMembers(ch), from]);
    if (sameId(ch, V.channelId)) {
      for (const uid of channelMembers(ch)) {
        if (!sameId(uid, S.me.id) && shouldOffer(uid)) await createPeer(uid, true);
      }
      if (!sameId(from, S.me.id)) playGsSound('connect');
    }
    invalidate('sidebar', 'voice', 'main', 'aside');
    return;
  }

  if (type === 'vc_left') {
    if (ch) setChannelMembers(ch, channelMembers(ch).filter((x) => x !== from));
    else for (const [cid, list] of S.voiceMembers) setChannelMembers(cid, list.filter((x) => x !== from));
    V.selfMuted.delete(from);
    V.selfDeafened.delete(from);
    V.speaking.delete(from);
    if (sameId(ch, V.channelId) || (!ch && peers.has(from))) {
      dropPeer(from);
      if (!sameId(from, S.me.id)) playGsSound('hangup');
    }
    invalidate('sidebar', 'voice', 'main', 'aside');
    return;
  }

  if (type === 'vc_state') {
    if (msg.muted) V.selfMuted.add(from);
    else V.selfMuted.delete(from);
    if (msg.deafened) V.selfDeafened.add(from);
    else V.selfDeafened.delete(from);
    invalidate('sidebar', 'voice', 'main');
    return;
  }

  if (type === 'vc_server_muted') {
    const uid = Number(msg.user_id);
    if (msg.enabled) V.serverMuted.add(uid);
    else V.serverMuted.delete(uid);
    if (sameId(uid, S.me.id)) {
      V.canSpeak = !msg.enabled;
      V.muted = Boolean(msg.enabled) || V.muted;
      applyMuteToTracks();
    }
    invalidate('sidebar', 'voice', 'main');
    return;
  }

  if (type === 'vc_force_disconnected') {
    await vcLeave();
    notify(String(msg.reason || 'Вас отключили от голосового канала'), 'error');
    return;
  }

  if (type === 'vc_moved') {
    const roomId = Number(msg.room_id) || V.roomId || 0;
    await vcLeave(false);
    if (ch && roomId) await vcJoin(ch, roomId);
    return;
  }

  if (type === 'vc_speaking') {
    if (!sameId(ch, V.channelId) || sameId(from, S.me.id)) return;
    if (msg.speaking) V.speaking.add(from);
    else V.speaking.delete(from);
    paintSpeaking();
    return;
  }

  if (!V.channelId || (ch && !sameId(ch, V.channelId))) return;

  if (type === 'vc_offer' && msg.sdp) {
    const prev = peers.get(from);
    if (prev && (prev.connectionState === 'failed' || prev.connectionState === 'disconnected' || prev.connectionState === 'closed')) {
      dropPeer(from);
    }
    const pc = await createPeer(from, false);
    if (!pc) return;
    const remote = asSdp(msg.sdp);
    if (!remote) return;
    await pc.setRemoteDescription(remote);
    await flushPeerIce(from);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    void wsSend({ type: 'vc_answer', voice_channel_id: V.channelId, target_id: from, to_id: from, sdp: sdpJson(answer) });
    return;
  }
  if (type === 'vc_answer' && msg.sdp) {
    const pc = peers.get(from);
    if (!pc) return;
    const remote = asSdp(msg.sdp);
    if (!remote) return;
    await pc.setRemoteDescription(remote);
    await flushPeerIce(from);
    return;
  }
  if (type === 'vc_ice' && msg.candidate) {
    const iceCand = asIce(msg.candidate);
    if (!iceCand) return;
    const pc = peers.get(from);
    if (!pc || !pc.remoteDescription) {
      const q = pendingIce.get(from) || [];
      q.push(iceCand);
      pendingIce.set(from, q);
      return;
    }
    await pc.addIceCandidate(iceCand).catch(() => undefined);
  }
}

// ===== Личные звонки =====

let remoteVad: { ctx: AudioContext; raf: number } | null = null;

function watchRemote(stream: MediaStream): void {
  stopRemoteVad();
  try {
    const ctx = new AudioContext();
    void ctx.resume().catch(() => undefined);
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Uint8Array(an.fftSize);
    const st = { ctx, raf: 0 };
    remoteVad = st;
    let quiet = 0;
    const tick = () => {
      if (remoteVad !== st) return;
      an.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += ((buf[i]! - 128) / 128) ** 2;
      const loud = Math.sqrt(sum / buf.length) > 0.035;
      let on = C.remoteSpeaking;
      if (loud) {
        on = true;
        quiet = 0;
      } else if (++quiet > 15) on = false;
      if (on !== C.remoteSpeaking) {
        C.remoteSpeaking = on;
        paintSpeaking();
      }
      st.raf = requestAnimationFrame(tick);
    };
    st.raf = requestAnimationFrame(tick);
  } catch {
    /* без индикатора речи */
  }
}

function stopRemoteVad(): void {
  if (!remoteVad) return;
  cancelAnimationFrame(remoteVad.raf);
  void remoteVad.ctx.close().catch(() => undefined);
  remoteVad = null;
}

function newCallPc(peerId: number): RTCPeerConnection {
  const pc = new RTCPeerConnection(ice);
  callPc = pc;
  callIce = [];
  localStream?.getTracks().forEach((t) => pc.addTrack(t, localStream!));
  pc.onicecandidate = (e) => {
    if (e.candidate) void wsSend({ type: 'call_ice', to_id: peerId, target_id: peerId, candidate: iceJson(e.candidate) });
  };
  pc.ontrack = (e) => {
    const stream = e.streams[0] || new MediaStream([e.track]);
    void attachAudio(peerId, stream);
    watchRemote(stream);
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') {
      const audio = document.getElementById(`cv2-audio-${peerId}`) as HTMLAudioElement | null;
      void audio?.play().catch(() => undefined);
      if (C.phase !== 'active') {
        C.phase = 'active';
        C.startedAt = Date.now();
        invalidate('voice', 'main', 'sidebar');
      }
    }
    if (pc.connectionState === 'failed') {
      notify('Соединение со звонком потеряно', 'error');
      void callHangup();
    }
  };
  return pc;
}

function clearRingTimer(): void {
  if (ringTimer != null) window.clearTimeout(ringTimer);
  ringTimer = null;
}

function resetCall(sound: 'hangup' | 'reject' | null): void {
  const had = C.phase != null;
  clearRingTimer();
  stopCallRing();
  stopRemoteVad();
  try {
    callPc?.close();
  } catch {
    /* уже закрыт */
  }
  callPc = null;
  callIce = [];
  if (C.peerId) dropAudio(C.peerId);
  if (!V.channelId) releaseMic();
  C.peerId = null;
  C.phase = null;
  C.startedAt = 0;
  C.remoteSpeaking = false;
  if (had && sound) playGsSound(sound);
  invalidate('voice', 'main', 'sidebar', 'header');
}

export async function callStart(peerId: number): Promise<void> {
  if (C.phase) {
    if (sameId(C.peerId, peerId)) return;
    await callHangup();
  }
  if (V.channelId) await vcLeave(false);
  await loadIce(true);
  try {
    await ensureMic();
  } catch (e) {
    notify('Нет доступа к микрофону: ' + errText(e), 'error');
    return;
  }
  // Глушение с голосового канала оставляло микрофон и чужой звук выключенными
  if (V.deafened) V.deafened = false;
  applyMuteToTracks();
  C.peerId = peerId;
  C.phase = 'outgoing';
  void ensureCallPeer(peerId);
  startVad();
  await wsSend({ type: 'call_ring', to_id: peerId, target_id: peerId, caller_name: S.me.username });
  startCallRing('outgoing');
  // Без ответа 45 секунд — сбрасываем как Discord
  ringTimer = window.setTimeout(() => {
    if (C.phase === 'outgoing') {
      notify('Нет ответа');
      void callHangup();
    }
  }, 45000);
  invalidate('voice', 'main', 'sidebar', 'header');
}

export async function callAccept(): Promise<void> {
  if (C.phase !== 'incoming' || !C.peerId) return;
  const peerId = C.peerId;
  if (V.channelId) await vcLeave(false);
  clearRingTimer();
  stopCallRing();
  await loadIce(true);
  try {
    await ensureMic();
  } catch (e) {
    notify('Нет доступа к микрофону: ' + errText(e), 'error');
    await callDecline();
    return;
  }
  if (V.deafened) V.deafened = false;
  applyMuteToTracks();
  C.phase = 'connecting';
  newCallPc(peerId);
  startVad();
  await wsSend({ type: 'call_answer', to_id: peerId, target_id: peerId });
  invalidate('voice', 'main', 'sidebar', 'header');
}

export async function callDecline(): Promise<void> {
  if (!C.peerId) return;
  await wsSend({ type: 'call_reject', to_id: C.peerId, target_id: C.peerId }).catch(() => undefined);
  resetCall('reject');
}

export async function callHangup(): Promise<void> {
  if (!C.peerId) return;
  await wsSend({ type: 'call_hangup', to_id: C.peerId, target_id: C.peerId }).catch(() => undefined);
  resetCall('hangup');
}

export function callToggleMute(): void {
  V.muted = !V.muted;
  applyMuteToTracks();
  invalidate('voice', 'main');
}

export async function handleCall(msg: Record<string, any>): Promise<void> {
  const type = String(msg.type);
  const from = Number(msg.from_id ?? msg.user_id) || 0;
  if (!from) return;

  if (type === 'call_ring') {
    if (C.phase) {
      // Уже в звонке — занято
      if (!sameId(C.peerId, from)) void wsSend({ type: 'call_reject', to_id: from, target_id: from, reason: 'busy' });
      return;
    }
    C.peerId = from;
    C.phase = 'incoming';
    void ensureCallPeer(from, msg);
    startCallRing('incoming');
    ringTimer = window.setTimeout(() => {
      if (C.phase === 'incoming') resetCall(null);
    }, 45000);
    invalidate('voice', 'main', 'sidebar', 'header');
    return;
  }
  if (!sameId(from, C.peerId)) return;

  if (type === 'call_reject') {
    notify(msg.reason === 'busy' ? 'Пользователь сейчас в другом звонке' : msg.reason === 'blocked' ? 'Не удалось позвонить' : 'Звонок отклонён');
    resetCall('reject');
    return;
  }
  if (type === 'call_hangup') {
    resetCall('hangup');
    return;
  }
  if (type === 'call_answer' && C.phase === 'outgoing') {
    clearRingTimer();
    stopCallRing();
    C.phase = 'connecting';
    const pc = newCallPc(from);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await wsSend({ type: 'call_sdp_offer', to_id: from, target_id: from, sdp: sdpJson(offer) });
    invalidate('voice', 'main', 'sidebar', 'header');
    return;
  }
  if (type === 'call_sdp_offer' && msg.sdp) {
    // Отвечает только окно, которое приняло вызов. Иначе второе окно шлёт свой answer и глушит разговор.
    if (!callPc || C.phase !== 'connecting') {
      if (C.phase === 'incoming') resetCall(null);
      return;
    }
    const desc = asSdp(msg.sdp);
    if (!desc) return;
    try {
      await callPc.setRemoteDescription(desc);
      for (const c of callIce.splice(0)) await callPc.addIceCandidate(c).catch(() => undefined);
      const answer = await callPc.createAnswer();
      await callPc.setLocalDescription(answer);
      await wsSend({ type: 'call_sdp_answer', to_id: from, target_id: from, sdp: sdpJson(answer) });
    } catch (e) {
      notify('Не удалось ответить на звонок: ' + errText(e), 'error');
    }
    return;
  }
  if (type === 'call_sdp_answer' && msg.sdp && callPc) {
    const desc = asSdp(msg.sdp);
    if (!desc) return;
    try {
      await callPc.setRemoteDescription(desc);
      for (const c of callIce.splice(0)) await callPc.addIceCandidate(c).catch(() => undefined);
    } catch (e) {
      notify('Не удалось соединить звонок: ' + errText(e), 'error');
    }
    return;
  }
  if (type === 'call_ice' && msg.candidate) {
    const iceCand = asIce(msg.candidate);
    if (!iceCand) return;
    if (!callPc || !callPc.remoteDescription) {
      callIce.push(iceCand);
      return;
    }
    await callPc.addIceCandidate(iceCand).catch(() => undefined);
  }
}

/** Выход из всего голосового при логауте/закрытии. */
export async function rtcShutdown(): Promise<void> {
  if (C.phase) await callHangup();
  if (V.channelId) await vcLeave(false);
}
