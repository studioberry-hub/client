// ===== LAN-порт из лога + исходящий туннель к VPS-relay =====

import { ipcMain, BrowserWindow, app } from 'electron';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { getApiBase } from '../shared/apiBase';
import { getInstanceRoot } from './launcher';

const LAN_PORT_RE =
  /(?:Published LAN server on port|Local game hosted on port|Started serving on|Hosting on port|Open(?:ed)? to LAN.*?port|hosting on port)\s*[:=]?\s*(\d{1,5})/i;
// Запасные формулировки + RU «порт: [12345]»
const LAN_PORT_RE_ALT =
  /(?:LAN|local(?:\s+game)?).*?(?:port|порт)\s*[:=]?\s*\[?(\d{1,5})\]?|(?:порт|port)\s*[:=]\s*\[?(\d{1,5})\]?/i;

type RelaySessionInfo = {
  sessionId: string;
  tunnelToken: string;
  publicHost: string;
  publicPort: number;
  tunnelHost: string;
  tunnelPort: number;
  localPort: number;
  expiresAt: number;
};

type ShareMeta = {
  buildId: string;
  buildName?: string;
  gameVersion?: string;
  loader?: string;
  /** Отображаемое имя мира для друзей */
  serverName?: string;
};

type PersistedShare = RelaySessionInfo &
  ShareMeta & {
    savedAt: number;
  };

type ActiveTunnel = {
  session: RelaySessionInfo;
  meta: ShareMeta | null;
  control: net.Socket;
  closed: boolean;
};

let logWatchTimer: ReturnType<typeof setInterval> | null = null;
let logWatchBuildId: string | null = null;
let logWatchOffset = 0;
let lastLanPort: number | null = null;
let activeTunnel: ActiveTunnel | null = null;
let activeMeta: ShareMeta | null = null;
let messengerTokenProvider: (() => string | null) | null = null;
let restoreInFlight: Promise<{
  ok: boolean;
  restored?: boolean;
  code?: string;
  error?: string;
  session?: RelaySessionInfo;
  meta?: ShareMeta | null;
}> | null = null;

export function setMessengerTokenProvider(fn: () => string | null): void {
  messengerTokenProvider = fn;
}

function persistDir(): string {
  // Тот же каталог, что running-game.json — стабильнее, чем Electron userData
  const base =
    process.env.APPDATA ||
    (process.platform === 'darwin'
      ? path.join(process.env.HOME || '', 'Library', 'Application Support')
      : process.env.HOME || '');
  const dir = path.join(base, '.Undefined Client');
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* ignore */
  }
  return dir;
}

function persistPath(): string {
  return path.join(persistDir(), 'game-relay-share.json');
}

function legacyPersistPath(): string {
  try {
    return path.join(app.getPath('userData'), 'game-relay-share.json');
  } catch {
    return '';
  }
}

function loadPersistedShare(): PersistedShare | null {
  const paths = [persistPath(), legacyPersistPath()].filter(Boolean);
  for (const p of paths) {
    try {
      const raw = fs.readFileSync(p, 'utf8');
      const data = JSON.parse(raw) as PersistedShare;
      if (!data?.sessionId || !data?.tunnelToken || !data?.publicHost) continue;
      // Мигрируем в новый путь
      if (p !== persistPath()) {
        try {
          fs.writeFileSync(persistPath(), JSON.stringify(data), 'utf8');
        } catch {
          /* ignore */
        }
      }
      return data;
    } catch {
      /* next */
    }
  }
  return null;
}

function savePersistedShare(session: RelaySessionInfo, meta: ShareMeta | null): void {
  if (!meta?.buildId) return;
  const payload: PersistedShare = {
    ...session,
    buildId: meta.buildId,
    buildName: meta.buildName,
    gameVersion: meta.gameVersion,
    loader: meta.loader,
    serverName: meta.serverName,
    savedAt: Date.now(),
  };
  try {
    fs.writeFileSync(persistPath(), JSON.stringify(payload), 'utf8');
  } catch {
    /* ignore */
  }
}

function clearPersistedShare(): void {
  for (const p of [persistPath(), legacyPersistPath()].filter(Boolean)) {
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
}

function isLocalPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    const timer = setTimeout(() => {
      try {
        sock.destroy();
      } catch {
        /* ignore */
      }
      resolve(false);
    }, 700);
    sock.once('connect', () => {
      clearTimeout(timer);
      try {
        sock.destroy();
      } catch {
        /* ignore */
      }
      resolve(true);
    });
    sock.once('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

function sendToRenderer(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send(channel, payload);
    } catch {
      /* ignore */
    }
  }
}

const LAN_CLOSED_RE =
  /(?:Stopping LAN|LAN server stopped|Closing integrated server|Shutting down integrated server|Stopping server)/i;

function parseLanPortFromChunk(text: string): number | null {
  const primary = [...text.matchAll(new RegExp(LAN_PORT_RE.source, 'gi'))];
  const matches = primary.length
    ? primary
    : [...text.matchAll(new RegExp(LAN_PORT_RE_ALT.source, 'gi'))];
  if (!matches.length) return null;
  const last = matches[matches.length - 1];
  const port = Number(last[1] || last[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return port;
}

function chunkSuggestsLanClosed(text: string): boolean {
  return LAN_CLOSED_RE.test(text);
}

/** Полный проход по latest.log (когда watch ещё не успел поймать порт) */
function scanLanPortNow(buildId: string): number | null {
  const id = String(buildId || '').trim();
  if (!id) return null;
  const logPath = path.join(getInstanceRoot(id), 'logs', 'latest.log');
  try {
    if (!fs.existsSync(logPath)) return null;
    const st = fs.statSync(logPath);
    // До 2 МБ читаем целиком — Open to LAN может быть не в самом хвосте
    const max = 2 * 1024 * 1024;
    let text: string;
    if (st.size <= max) {
      text = fs.readFileSync(logPath, 'utf8');
    } else {
      const fd = fs.openSync(logPath, 'r');
      try {
        const len = Math.min(st.size, max);
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, st.size - len);
        text = buf.toString('utf8');
      } finally {
        fs.closeSync(fd);
      }
    }
    // Если после «Published LAN» в хвосте уже shutdown — порт мёртв для UI
    const port = parseLanPortFromChunk(text);
    if (!port) return null;
    const portIdx = Math.max(
      text.toLowerCase().lastIndexOf('published lan'),
      text.toLowerCase().lastIndexOf('hosted on port'),
      text.toLowerCase().lastIndexOf('serving on'),
    );
    const after = portIdx >= 0 ? text.slice(portIdx) : text.slice(-8 * 1024);
    if (chunkSuggestsLanClosed(after)) return null;
    return port;
  } catch {
    return null;
  }
}

function emitLanPort(buildId: string | null, port: number | null): void {
  sendToRenderer('game-relay:lan-port', { buildId, port });
}

async function setLanPortIfAlive(buildId: string, port: number): Promise<boolean> {
  if (!(await isLocalPortOpen(port))) return false;
  if (lastLanPort !== port) {
    lastLanPort = port;
    emitLanPort(buildId, port);
  } else {
    lastLanPort = port;
  }
  return true;
}

async function clearLanPort(buildId: string | null, reason?: string): Promise<void> {
  if (lastLanPort == null && !reason) return;
  lastLanPort = null;
  emitLanPort(buildId, null);
}

function stopLogWatch(): void {
  if (logWatchTimer) {
    clearInterval(logWatchTimer);
    logWatchTimer = null;
  }
  logWatchBuildId = null;
  logWatchOffset = 0;
}

function startLogWatch(buildId: string): { ok: boolean; error?: string } {
  const id = String(buildId || '').trim();
  if (!id) return { ok: false, error: 'build_required' };
  stopLogWatch();
  logWatchBuildId = id;
  lastLanPort = null;
  const logPath = path.join(getInstanceRoot(id), 'logs', 'latest.log');
  try {
    if (fs.existsSync(logPath)) logWatchOffset = fs.statSync(logPath).size;
  } catch {
    logWatchOffset = 0;
  }

  let verifyTick = 0;
  logWatchTimer = setInterval(() => {
    if (!logWatchBuildId) return;
    const file = path.join(getInstanceRoot(logWatchBuildId), 'logs', 'latest.log');
    try {
      if (!fs.existsSync(file)) return;
      const st = fs.statSync(file);
      // Ротация лога
      if (st.size < logWatchOffset) logWatchOffset = 0;
      if (st.size !== logWatchOffset) {
        const fd = fs.openSync(file, 'r');
        try {
          const len = st.size - logWatchOffset;
          const buf = Buffer.alloc(Math.min(len, 256 * 1024));
          const read = fs.readSync(fd, buf, 0, buf.length, logWatchOffset);
          logWatchOffset += read;
          const chunk = buf.slice(0, read).toString('utf8');
          if (chunkSuggestsLanClosed(chunk)) {
            void clearLanPort(logWatchBuildId, 'log_closed');
          }
          const port = parseLanPortFromChunk(chunk);
          if (port) void setLanPortIfAlive(logWatchBuildId, port);
        } finally {
          fs.closeSync(fd);
        }
      }
      // Раз в ~2 с проверяем, что объявленный LAN-порт ещё слушает
      verifyTick += 1;
      if (verifyTick % 2 === 0 && lastLanPort) {
        const port = lastLanPort;
        void isLocalPortOpen(port).then((ok) => {
          if (!ok && lastLanPort === port) void clearLanPort(logWatchBuildId, 'port_dead');
        });
      }
    } catch {
      /* ignore transient FS errors */
    }
  }, 1000);

  // Стартовый скан: только если порт реально открыт (иначе ложный LAN с прошлого сеанса)
  void (async () => {
    const scanned = scanLanPortNow(id);
    if (scanned) await setLanPortIfAlive(id, scanned);
  })();

  return { ok: true };
}

async function relayFetch(
  relPath: string,
  opts: { method?: string; body?: unknown; token: string },
): Promise<{ ok: boolean; status: number; data: any }> {
  const headers: Record<string, string> = {
    'User-Agent': 'Undefined-Client',
    Accept: 'application/json',
    Authorization: `Bearer ${opts.token}`,
  };
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(`${getApiBase()}/api/relay${relPath}`, {
    method: opts.method || 'GET',
    headers,
    body,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function readSocketLine(socket: net.Socket, timeoutMs = 10000): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('timeout'));
    }, timeoutMs);
    const onData = (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      const idx = buf.indexOf('\n');
      if (idx < 0) return;
      cleanup();
      resolve(buf.slice(0, idx).replace(/\r$/, ''));
    };
    const onErr = (err: Error) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onErr);
      socket.off('close', onClose);
    };
    const onClose = () => {
      cleanup();
      reject(new Error('socket_closed'));
    };
    socket.on('data', onData);
    socket.on('error', onErr);
    socket.on('close', onClose);
  });
}

function attachControlLines(socket: net.Socket, onLine: (line: string) => void): void {
  let buf = '';
  socket.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).replace(/\r$/, '');
      buf = buf.slice(idx + 1);
      onLine(line);
    }
  });
}

function openDataChannel(session: RelaySessionInfo, connId: string): void {
  const dataSock = net.connect({
    host: session.tunnelHost,
    port: session.tunnelPort,
  });
  dataSock.once('connect', async () => {
    try {
      dataSock.write(`DATA ${session.sessionId} ${session.tunnelToken} ${connId}\n`);
      const line = await readSocketLine(dataSock, 10000);
      if (!/^OK\s+DATA/i.test(line)) {
        dataSock.destroy();
        return;
      }
      const local = net.connect({ host: '127.0.0.1', port: session.localPort });
      local.once('connect', () => {
        dataSock.pipe(local);
        local.pipe(dataSock);
      });
      const hang = () => {
        try {
          dataSock.destroy();
        } catch {
          /* ignore */
        }
        try {
          local.destroy();
        } catch {
          /* ignore */
        }
      };
      dataSock.on('error', hang);
      local.on('error', hang);
      dataSock.on('close', hang);
      local.on('close', hang);
    } catch {
      dataSock.destroy();
    }
  });
  dataSock.on('error', () => {
    /* ignore */
  });
}

async function stopTunnel(opts?: { destroyRemote?: boolean; clearPersist?: boolean }): Promise<void> {
  const destroyRemote = opts?.destroyRemote !== false;
  const clearPersist = opts?.clearPersist !== false;
  const current = activeTunnel;
  activeTunnel = null;
  activeMeta = null;
  if (!current) {
    if (clearPersist) clearPersistedShare();
    return;
  }
  current.closed = true;
  try {
    current.control.destroy();
  } catch {
    /* ignore */
  }
  if (destroyRemote) {
    const token = messengerTokenProvider?.();
    if (token && current.session.sessionId) {
      try {
        await relayFetch(`/sessions/${encodeURIComponent(current.session.sessionId)}`, {
          method: 'DELETE',
          token,
        });
      } catch {
        /* ignore */
      }
    }
  }
  if (clearPersist) clearPersistedShare();
  sendToRenderer('game-relay:tunnel', { active: false });
}

function emitTunnelActive(session: RelaySessionInfo, meta: ShareMeta | null, restored = false): void {
  sendToRenderer('game-relay:tunnel', {
    active: true,
    restored,
    publicHost: session.publicHost,
    publicPort: session.publicPort,
    sessionId: session.sessionId,
    localPort: session.localPort,
    buildId: meta?.buildId || null,
    buildName: meta?.buildName || null,
    gameVersion: meta?.gameVersion || null,
    loader: meta?.loader || null,
  });
}

async function attachHostControl(
  session: RelaySessionInfo,
  meta: ShareMeta | null,
  restored = false,
): Promise<{ ok: boolean; error?: string; code?: string; session?: RelaySessionInfo }> {
  const control = net.connect({ host: session.tunnelHost, port: session.tunnelPort });
  try {
    await new Promise<void>((resolve, reject) => {
      control.once('connect', () => resolve());
      control.once('error', reject);
    });
    control.write(`HOST ${session.sessionId} ${session.tunnelToken}\n`);
    const line = await readSocketLine(control, 10000);
    if (!/^OK\s+HOST/i.test(line)) {
      control.destroy();
      return { ok: false, error: 'tunnel_handshake_failed', code: 'tunnel_handshake_failed' };
    }
  } catch (err) {
    control.destroy();
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      code: 'tunnel_connect_failed',
    };
  }

  const tunnel: ActiveTunnel = { session, meta, control, closed: false };
  activeTunnel = tunnel;
  activeMeta = meta;
  attachControlLines(control, (line) => {
    if (tunnel.closed || activeTunnel !== tunnel) return;
    const m = line.trim().match(/^CONNECT\s+(\S+)/i);
    if (m) openDataChannel(session, m[1]);
  });
  control.on('close', () => {
    if (activeTunnel === tunnel) {
      activeTunnel = null;
      // Persist оставляем — лаунчер/сеть могли моргнуть, восстановим при старте
      sendToRenderer('game-relay:tunnel', { active: false, reason: 'control_closed' });
    }
  });
  control.on('error', () => {
    /* close handler справится */
  });

  if (meta?.buildId) savePersistedShare(session, meta);
  emitTunnelActive(session, meta, restored);
  return { ok: true, session };
}

async function startTunnel(
  localPort: number,
  meta?: ShareMeta | null,
): Promise<{
  ok: boolean;
  error?: string;
  code?: string;
  session?: RelaySessionInfo;
}> {
  const token = messengerTokenProvider?.();
  if (!token) return { ok: false, error: 'no_messenger_session', code: 'no_messenger_session' };
  const port = Number(localPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, error: 'invalid_port', code: 'invalid_port' };
  }

  await stopTunnel({ destroyRemote: true, clearPersist: true });

  const created = await relayFetch('/sessions', {
    method: 'POST',
    token,
    body: { localPort: port },
  });
  if (!created.ok) {
    return {
      ok: false,
      error: created.data?.error || 'relay_create_failed',
      code: created.data?.code || 'relay_create_failed',
    };
  }

  const session: RelaySessionInfo = {
    sessionId: String(created.data.sessionId),
    tunnelToken: String(created.data.tunnelToken),
    publicHost: String(created.data.publicHost),
    publicPort: Number(created.data.publicPort),
    tunnelHost: String(created.data.tunnelHost || created.data.publicHost),
    tunnelPort: Number(created.data.tunnelPort),
    localPort: port,
    expiresAt: Number(created.data.expiresAt) || Date.now() + 4 * 3600 * 1000,
  };

  const shareMeta: ShareMeta | null = meta?.buildId
    ? {
        buildId: String(meta.buildId),
        buildName: meta.buildName,
        gameVersion: meta.gameVersion,
        loader: meta.loader,
        serverName: meta.serverName,
      }
    : null;

  const attached = await attachHostControl(session, shareMeta, false);
  if (!attached.ok) {
    try {
      await relayFetch(`/sessions/${encodeURIComponent(session.sessionId)}`, {
        method: 'DELETE',
        token,
      });
    } catch {
      /* ignore */
    }
    clearPersistedShare();
  }
  return attached;
}

/** Восстановить шаринг после рестарта лаунчера, если LAN-мир ещё слушает */
export async function tryRestoreGameRelayShare(): Promise<{
  ok: boolean;
  restored?: boolean;
  code?: string;
  error?: string;
  session?: RelaySessionInfo;
  meta?: ShareMeta | null;
}> {
  if (activeTunnel && !activeTunnel.closed) {
    return {
      ok: true,
      restored: false,
      session: activeTunnel.session,
      meta: activeTunnel.meta,
    };
  }
  if (restoreInFlight) return restoreInFlight;

  restoreInFlight = (async () => {
    const persisted = loadPersistedShare();
    if (!persisted) return { ok: true, restored: false };

    if (Date.now() > Number(persisted.expiresAt || 0)) {
      clearPersistedShare();
      return { ok: false, restored: false, code: 'expired', error: 'session_expired' };
    }

    const token = messengerTokenProvider?.();
    if (!token) return { ok: false, restored: false, code: 'no_messenger_session' };

    // Ищем актуальный LAN-порт в логе сборки
    startLogWatch(persisted.buildId);
    let port = scanLanPortNow(persisted.buildId) || lastLanPort || persisted.localPort;
    if (!(await isLocalPortOpen(port))) {
      const rescanned = scanLanPortNow(persisted.buildId);
      if (rescanned && (await isLocalPortOpen(rescanned))) {
        port = rescanned;
      } else if (await isLocalPortOpen(Number(persisted.localPort))) {
        port = Number(persisted.localPort);
      } else {
        // Не удаляем persist: LAN мог моргнуть, повторим при следующем старте
        return { ok: false, restored: false, code: 'lan_closed', error: 'lan_not_listening' };
      }
    }

    lastLanPort = port;
    const session: RelaySessionInfo = {
      sessionId: persisted.sessionId,
      tunnelToken: persisted.tunnelToken,
      publicHost: persisted.publicHost,
      publicPort: persisted.publicPort,
      tunnelHost: String(persisted.tunnelHost || 'uprojects.site'),
      tunnelPort: Number(persisted.tunnelPort) || 25570,
      localPort: port,
      expiresAt: Number(persisted.expiresAt),
    };
    const meta: ShareMeta = {
      buildId: persisted.buildId,
      buildName: persisted.buildName,
      gameVersion: persisted.gameVersion,
      loader: persisted.loader,
      serverName: persisted.serverName,
    };

    const attached = await attachHostControl(session, meta, true);
    if (!attached.ok) {
      // unauthorized — сессия на VPS мертва; connect_failed можно повторить позже
      if (attached.code === 'tunnel_handshake_failed') clearPersistedShare();
      return {
        ok: false,
        restored: false,
        code: attached.code,
        error: attached.error,
      };
    }
    return { ok: true, restored: true, session, meta };
  })().finally(() => {
    restoreInFlight = null;
  });

  return restoreInFlight;
}

export function registerGameRelayIpc(): void {
  ipcMain.handle('game-relay:watch-lan', (_e, buildId: string) => startLogWatch(buildId));
  ipcMain.handle('game-relay:stop-watch', () => {
    stopLogWatch();
    return { ok: true };
  });
  ipcMain.handle('game-relay:get-lan-port', async (_e, buildId?: string) => {
    const id = buildId ? String(buildId) : logWatchBuildId || '';
    const scanned = id ? scanLanPortNow(id) : lastLanPort;
    const candidate = scanned || lastLanPort;
    if (!candidate) return { port: null };
    if (!(await isLocalPortOpen(candidate))) {
      if (lastLanPort === candidate) lastLanPort = null;
      return { port: null };
    }
    lastLanPort = candidate;
    return { port: candidate };
  });
  ipcMain.handle(
    'game-relay:start',
    async (_e, localPort: number, meta?: ShareMeta | null) => startTunnel(localPort, meta || null),
  );
  ipcMain.handle('game-relay:stop', async () => {
    await stopTunnel({ destroyRemote: true, clearPersist: true });
    return { ok: true };
  });
  ipcMain.handle('game-relay:restore', async () => tryRestoreGameRelayShare());
  ipcMain.handle('game-relay:status', () => ({
    lanPort: lastLanPort,
    watching: Boolean(logWatchBuildId),
    buildId: logWatchBuildId || activeMeta?.buildId || null,
    tunnel: activeTunnel
      ? {
          active: true,
          sessionId: activeTunnel.session.sessionId,
          publicHost: activeTunnel.session.publicHost,
          publicPort: activeTunnel.session.publicPort,
          localPort: activeTunnel.session.localPort,
          buildId: activeTunnel.meta?.buildId || null,
          buildName: activeTunnel.meta?.buildName || null,
        }
      : { active: false },
  }));
  ipcMain.handle(
    'game-relay:join-session',
    async (_e, sessionId: string) => {
      const token = messengerTokenProvider?.();
      if (!token) return { ok: false, code: 'no_messenger_session' };
      const res = await relayFetch(`/sessions/${encodeURIComponent(sessionId)}/join`, {
        method: 'POST',
        token,
      });
      if (!res.ok) {
        return { ok: false, code: res.data?.code || 'join_failed', error: res.data?.error };
      }
      return {
        ok: true,
        publicHost: res.data.publicHost,
        publicPort: res.data.publicPort,
        sessionId: res.data.sessionId,
      };
    },
  );
}

/** При выходе из лаунчера не убиваем VPS-сессию — мир в MC может остаться открытым */
export function stopGameRelayOnQuit(): void {
  stopLogWatch();
  // Soft-stop: обрываем только локальный control, persist + remote session живы
  if (activeTunnel) {
    activeTunnel.closed = true;
    try {
      activeTunnel.control.destroy();
    } catch {
      /* ignore */
    }
    activeTunnel = null;
  }
}
