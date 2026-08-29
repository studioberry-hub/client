// ===== IPC-прокси MC Messenger к API сайта =====

import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { getApiBase } from '../shared/apiBase';
import { tryRestoreGameRelayShare } from './game-relay';

function tryRestoreShareAfterSession(): void {
  void tryRestoreGameRelayShare()
    .then((res) => {
      if (!res?.ok || !res.restored || !res.session) return;
      const s = res.session;
      const meta = res.meta;
      const nick = String(
        (session?.user as { username?: string; name?: string } | null)?.username ||
          (session?.user as { username?: string; name?: string } | null)?.name ||
          '',
      ).trim();
      const serverName =
        String(meta?.serverName || '').trim() ||
        (nick ? `Мир игрока ${nick}` : 'Friends world');
      // Возобновляем hosting в activity без повторных DM-инвайтов
      pushMessengerActivity({
        playing: true,
        hosting: true,
        buildName: meta?.buildName,
        gameVersion: meta?.gameVersion,
        loader: meta?.loader,
        serverName,
        serverHost: `${s.publicHost}:${s.publicPort}`,
      });
    })
    .catch(() => {
      /* ignore */
    });
}

type MessengerAccount = {
  uuid?: string;
  name?: string;
  username?: string;
  accessToken?: string;
  skinUrl?: string | null;
  meta?: { type?: string };
  type?: string;
};

type MessengerSession = {
  token: string;
  user: Record<string, unknown>;
  accountKey: string;
};

export type MessengerActivityPayload = {
  buildName?: string;
  gameVersion?: string;
  loader?: string;
  serverName?: string;
  serverHost?: string;
  playing?: boolean;
  hosting?: boolean;
};

let session: MessengerSession | null = null;
let activityHeartbeat: ReturnType<typeof setInterval> | null = null;
let lastActivity: MessengerActivityPayload | null = null;

function accountProvider(account: MessengerAccount): 'msa' | 'ely' | null {
  const t = String(account?.meta?.type || account?.type || '')
    .trim()
    .toLowerCase();
  if (t === 'msa' || t === 'microsoft' || t === 'ms') return 'msa';
  if (t === 'yggdrasil' || t === 'ely' || t === 'ely.by') return 'ely';
  return null;
}

function accountKey(account: MessengerAccount): string {
  const provider = accountProvider(account) || 'unknown';
  const uuid = String(account?.uuid || '')
    .replace(/-/g, '')
    .toLowerCase();
  return `${provider}:${uuid}`;
}

async function messengerFetch(
  path: string,
  opts: { method?: string; body?: unknown; token?: string } = {},
): Promise<{ ok: boolean; status: number; data: any }> {
  const method = opts.method || 'GET';
  const headers: Record<string, string> = {
    'User-Agent': 'Undefined-Client',
    Accept: 'application/json',
  };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(`${getApiBase()}/api/messenger${path}`, {
    method,
    headers,
    body,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function postActivityOnce(payload: MessengerActivityPayload): Promise<void> {
  if (!session?.token) return;
  await messengerFetch('/activity', {
    method: 'POST',
    token: session.token,
    body: payload,
  });
}

/** Heartbeat активности в MC Messenger (сборка / версия / сервер). */
export function pushMessengerActivity(payload: MessengerActivityPayload): void {
  lastActivity = payload?.playing === false ? { playing: false } : { ...payload, playing: true };
  if (activityHeartbeat) {
    clearInterval(activityHeartbeat);
    activityHeartbeat = null;
  }
  void postActivityOnce(lastActivity);
  if (lastActivity.playing) {
    activityHeartbeat = setInterval(() => {
      if (!lastActivity?.playing) return;
      void postActivityOnce(lastActivity);
    }, 45000);
  }
}

export function getMessengerSessionToken(): string | null {
  return session?.token || null;
}

export function registerMessengerIpc(): void {
  ipcMain.handle('messenger:session', async (_event, account: MessengerAccount) => {
    try {
      const provider = accountProvider(account);
      if (!provider) {
        return { ok: false, code: 'account_required', error: 'Need Microsoft or Ely.by account' };
      }
      const accessToken = String(account?.accessToken || '').trim();
      if (!accessToken) {
        return { ok: false, code: 'account_required', error: 'Missing access token' };
      }
      const key = accountKey(account);
      if (session?.accountKey === key && session.token) {
        const me = await messengerFetch('/me', { token: session.token });
        if (me.ok) {
          session.user = me.data.user || session.user;
          if (lastActivity?.playing) void postActivityOnce(lastActivity);
          void tryRestoreShareAfterSession();
          return { ok: true, user: session.user, token: session.token, cached: true };
        }
      }
      const res = await messengerFetch('/session', {
        method: 'POST',
        body: {
          provider,
          accessToken,
          skinUrl: account?.skinUrl || null,
        },
      });
      if (!res.ok) {
        session = null;
        return {
          ok: false,
          code: res.data?.code || 'session_failed',
          error: res.data?.error || `HTTP ${res.status}`,
        };
      }
      session = {
        token: String(res.data.token || ''),
        user: res.data.user || {},
        accountKey: key,
      };
      if (!session.token) {
        session = null;
        return { ok: false, code: 'session_failed', error: 'No token' };
      }
      if (lastActivity?.playing) void postActivityOnce(lastActivity);
      void tryRestoreShareAfterSession();
      return { ok: true, user: session.user, token: session.token };
    } catch (e: any) {
      session = null;
      return { ok: false, code: 'network_error', error: e?.message || 'Network error' };
    }
  });

  ipcMain.handle('messenger:logout', async () => {
    session = null;
    return { ok: true };
  });

  ipcMain.handle('messenger:token', async () => {
    return session?.token || null;
  });

  ipcMain.handle(
    'messenger:request',
    async (
      _event,
      payload: { method?: string; path: string; body?: unknown; query?: Record<string, string | number | undefined> },
    ) => {
      try {
        if (!session?.token) {
          return { ok: false, code: 'unauthorized', error: 'No messenger session' };
        }
        let path = String(payload?.path || '');
        if (!path.startsWith('/')) path = `/${path}`;
        if (payload?.query) {
          const qs = new URLSearchParams();
          for (const [k, v] of Object.entries(payload.query)) {
            if (v === undefined || v === null || v === '') continue;
            qs.set(k, String(v));
          }
          const s = qs.toString();
          if (s) path += `?${s}`;
        }
        const res = await messengerFetch(path, {
          method: payload?.method || 'GET',
          body: payload?.body,
          token: session.token,
        });
        if (res.status === 401) session = null;
        if (!res.ok) {
          return {
            ok: false,
            code: res.data?.code || 'request_failed',
            error: res.data?.error || `HTTP ${res.status}`,
            status: res.status,
            data: res.data,
          };
        }
        return { ok: true, data: res.data };
      } catch (e: any) {
        return { ok: false, code: 'network_error', error: e?.message || 'Network error' };
      }
    },
  );

  // ===== Файлы мессенджера: выбор / чтение / сохранение / открытие =====
  ipcMain.handle('messenger:pickFiles', async (_event, opts?: { media?: boolean }) => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    const media = Boolean(opts?.media);
    const result = await dialog.showOpenDialog(win!, {
      title: media ? 'Фото или видео' : 'Прикрепить файл к сообщению',
      properties: ['openFile', 'multiSelections'],
      filters: media
        ? [
            {
              name: 'Фото и видео',
              extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'mp4', 'webm', 'mov', 'mkv'],
            },
          ]
        : [{ name: 'Все файлы', extensions: ['*'] }],
    });
    if (result.canceled) return [] as string[];
    return result.filePaths.slice(0, 5);
  });

  ipcMain.handle('messenger:readFile', async (_event, filePath: string) => {
    const raw = String(filePath || '').trim();
    if (!raw) return { ok: false, error: 'empty_path' };
    const resolved = path.resolve(raw);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      return { ok: false, error: 'not_found', name: path.basename(resolved) };
    }
    const name = path.basename(resolved);
    const stat = fs.statSync(resolved);
    const maxBytes = 12 * 1024 * 1024;
    if (stat.size > maxBytes) {
      return { ok: false, error: 'too_large', name, size: stat.size };
    }
    const buf = fs.readFileSync(resolved);
    const ext = path.extname(name).toLowerCase();
    const mimeGuess =
      ext === '.png'
        ? 'image/png'
        : ext === '.jpg' || ext === '.jpeg'
          ? 'image/jpeg'
          : ext === '.gif'
            ? 'image/gif'
            : ext === '.webp'
              ? 'image/webp'
              : ext === '.bmp'
                ? 'image/bmp'
                : ext === '.mp4'
                  ? 'video/mp4'
                  : ext === '.webm'
                    ? 'video/webm'
                    : ext === '.mov'
                      ? 'video/quicktime'
                      : ext === '.mkv'
                        ? 'video/x-matroska'
                        : ext === '.pdf'
                          ? 'application/pdf'
                          : ext === '.zip'
                            ? 'application/zip'
                            : ext === '.txt' || ext === '.log' || ext === '.md'
                              ? 'text/plain'
                              : 'application/octet-stream';
    return {
      ok: true,
      name,
      path: resolved,
      size: buf.length,
      mime: mimeGuess,
      dataBase64: buf.toString('base64'),
    };
  });

  ipcMain.handle(
    'messenger:downloadAttachment',
    async (
      _event,
      payload: { messageId: string; fileName?: string },
    ) => {
      try {
        if (!session?.token) {
          return { ok: false, error: 'unauthorized' };
        }
        const messageId = String(payload?.messageId || '').trim();
        if (!messageId) return { ok: false, error: 'invalid_id' };
        const suggested = String(payload?.fileName || 'file').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
        const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
        const save = await dialog.showSaveDialog(win!, {
          title: 'Сохранить файл',
          defaultPath: suggested,
        });
        if (save.canceled || !save.filePath) {
          return { ok: false, error: 'canceled' };
        }
        const res = await fetch(
          `${getApiBase()}/api/messenger/messages/${encodeURIComponent(messageId)}/attachment`,
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${session.token}`,
              'User-Agent': 'Undefined-Client',
            },
          },
        );
        if (!res.ok) {
          return { ok: false, error: `HTTP ${res.status}` };
        }
        const ab = await res.arrayBuffer();
        fs.writeFileSync(save.filePath, Buffer.from(ab));
        return { ok: true, path: save.filePath };
      } catch (e: any) {
        return { ok: false, error: e?.message || 'download_failed' };
      }
    },
  );

  ipcMain.handle('messenger:openLocalFile', async (_event, filePath: string) => {
    const raw = String(filePath || '').trim();
    if (!raw) return { ok: false, error: 'invalid_path' };
    const resolved = path.resolve(raw);
    if (!fs.existsSync(resolved)) return { ok: false, error: 'not_found' };
    const err = await shell.openPath(resolved);
    if (err) return { ok: false, error: err };
    return { ok: true };
  });
}
