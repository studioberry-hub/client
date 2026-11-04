// Открытые миры друзей: статус из activity (hosting / serverHost) и событий game_invite.
import { invalidate } from './store';

export type LiveWorld = {
  userId: number;
  siteId: string;
  username: string;
  playing: boolean;
  hosting: boolean;
  worldShare: boolean;
  serverHost: string;
  serverName: string;
  build: string;
  version: string;
  sessionId: string;
};

const byUser = new Map<number, LiveWorld>();
const endedSessions = new Set<string>();
let rev = 0;

function bump(): void {
  rev += 1;
  invalidate('sidebar', 'main', 'feed');
}

export function worldsRev(): number {
  return rev;
}

export function normAddr(raw: string | null | undefined): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

function fromActivity(userId: number, siteId: string, username: string, activity: any, sessionId = ''): LiveWorld | null {
  if (!userId || !activity || typeof activity !== 'object') return null;
  const serverHost = String(activity.serverHost || '').trim();
  const serverName = String(activity.serverName || activity.server || '').trim();
  return {
    userId,
    siteId,
    username: username || 'Игрок',
    playing: Boolean(activity.playing),
    hosting: Boolean(activity.hosting),
    worldShare: activity.worldShare !== false,
    serverHost,
    serverName,
    build: String(activity.build || activity.buildName || '').trim(),
    version: String(activity.version || activity.gameVersion || '').trim(),
    sessionId: sessionId || '',
  };
}

/** Запомнить активность друга. Без объекта activity статус неизвестен — карточки не помечаем. */
export function noteActivity(
  userId: number,
  siteId: string,
  username: string,
  activity: any,
  sessionId = '',
): void {
  if (!userId || activity == null) return;
  const row = fromActivity(userId, siteId, username, activity, sessionId);
  if (!row) return;
  const prev = byUser.get(userId);
  if (prev?.sessionId && !row.sessionId) row.sessionId = prev.sessionId;
  if (prev?.username && prev.username !== 'user' && (row.username === 'Игрок' || row.username === 'user')) {
    row.username = prev.username;
  }
  if (
    prev &&
    prev.hosting === row.hosting &&
    prev.worldShare === row.worldShare &&
    prev.playing === row.playing &&
    prev.serverHost === row.serverHost &&
    prev.serverName === row.serverName &&
    prev.username === row.username &&
    prev.sessionId === row.sessionId
  ) {
    return;
  }
  byUser.set(userId, row);
  bump();
}

export function noteInviteEnded(userId: number, sessionId: string): void {
  if (sessionId) endedSessions.add(sessionId);
  const row = userId ? byUser.get(userId) : undefined;
  if (row) {
    row.hosting = false;
    row.serverHost = '';
    row.serverName = '';
    if (sessionId) row.sessionId = sessionId;
  }
  bump();
}

export function cardAddress(meta: Record<string, unknown> | null | undefined): string {
  if (!meta) return '';
  const host = meta.publicHost || meta.host;
  const port = meta.publicPort || meta.port;
  if (!host) return '';
  return port ? `${host}:${port}` : String(host);
}

/** live — мир ещё открыт, stale — точно закрыт, unknown — статуса нет. */
export function worldCardState(
  senderId: number | null | undefined,
  meta: Record<string, unknown> | null | undefined,
): 'live' | 'stale' | 'unknown' {
  const sessionId = meta?.sessionId != null ? String(meta.sessionId) : '';
  const addr = normAddr(cardAddress(meta));
  const known = senderId ? byUser.get(Number(senderId)) : undefined;
  if (known) {
    if (known.hosting && addr && normAddr(known.serverHost) === addr) return 'live';
    return 'stale';
  }
  if (sessionId && endedSessions.has(sessionId)) return 'stale';
  return 'unknown';
}

/** Миры, которые друзья сейчас держат открытыми. */
export function openFriendWorlds(): LiveWorld[] {
  return [...byUser.values()].filter((w) => w.hosting && w.worldShare && w.serverHost);
}

/** Игроки с тем же адресом в activity (хост и гости). Пусто, если никого не знаем. */
export function playersAt(addr: string): Array<{ userId: number; username: string }> {
  const key = normAddr(addr);
  if (!key) return [];
  const list: Array<{ userId: number; username: string }> = [];
  for (const row of byUser.values()) {
    if (!row.playing && !row.hosting) continue;
    if (normAddr(row.serverHost) !== key) continue;
    if (!row.username) continue;
    list.push({ userId: row.userId, username: row.username });
  }
  list.sort((a, b) => a.username.localeCompare(b.username, 'ru'));
  return list;
}

export function worldByUser(userId: number): LiveWorld | undefined {
  return byUser.get(userId);
}
