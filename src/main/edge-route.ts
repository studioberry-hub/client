// Сайт один, входов два. Москва с части VPN не отвечает, Германия отдаёт тот же сайт.
// Лаунчер берёт тот вход, который реально установил соединение.

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { API_EDGE_EU, API_EDGE_MSK, getApiBase, setApiBase } from '../shared/apiBase';

export const EDGE_MSK = API_EDGE_MSK;
export const EDGE_EU = API_EDGE_EU;

type Edge = { id: 'msk' | 'eu'; base: string };

const EDGES: Edge[] = [
  { id: 'msk', base: EDGE_MSK },
  { id: 'eu', base: EDGE_EU },
];

const PROBE_MS = 1500;

function preferencePath(): string {
  return path.join(app.getPath('userData'), 'edge.json');
}

function readPreference(): string | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(preferencePath(), 'utf8'));
    return EDGES.some((edge) => edge.id === parsed?.id) ? String(parsed.id) : null;
  } catch {
    return null;
  }
}

function writePreference(id: string): void {
  try {
    fs.writeFileSync(preferencePath(), JSON.stringify({ id, at: Date.now() }));
  } catch {
    /* выбор входа не обязан переживать ошибку диска */
  }
}

async function probe(base: string): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_MS);
  const started = Date.now();
  try {
    // Проверяем сам сайт, не реле: здоровье реле бывает быстрым, пока API молчит.
    const res = await fetch(`${base}/api/news?lang=ru&limit=1`, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { 'x-uc-no-failover': '1' },
    });
    if (!res.ok) return null;
    await res.body?.cancel();
    return Date.now() - started;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** База реле, на котором уже выдан адрес. Чужой край этой брони не видит. */
export function apiBaseForRelayHost(host: string | null | undefined): string {
  const name = String(host || '').trim().toLowerCase();
  if (name === 'eu.uprojects.site' || name.endsWith('.eu.uprojects.site')) return EDGE_EU;
  return EDGE_MSK;
}

const listeners = new Set<(base: string) => void>();
let pinned = false;
let watchTimer: ReturnType<typeof setInterval> | null = null;
let failStreak = 0;

export function isEdgePinned(): boolean {
  return pinned;
}

export function onEdgeChange(fn: (base: string) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Переключает вход сайта. Повтор того же адреса окна не беспокоит. */
export function adoptEdge(base: string, reason: string): boolean {
  if (pinned) return false;
  const next = EDGES.find((edge) => edge.base === String(base || '').trim().replace(/\/+$/, ''));
  if (!next) return false;
  const changed = getApiBase() !== next.base;
  process.env.UC_API_BASE = next.base;
  setApiBase(next.base);
  writePreference(next.id);
  failStreak = 0;
  if (!changed) return false;
  console.log(`[edge] ${next.id} (${reason})`);
  for (const fn of listeners) fn(next.base);
  return true;
}

/**
 * До окна выбирает вход, который отвечает. Если живы оба, берётся быстрый.
 * Явный UC_API_BASE не трогаем.
 */
export async function selectEdge(): Promise<string> {
  const forced = String(process.env.UC_API_BASE || process.env.UC_NEWS_API_BASE || '').trim();
  if (forced && forced !== EDGE_MSK && forced !== EDGE_EU) {
    pinned = true;
    setApiBase(forced);
    return forced;
  }

  const preferred = readPreference();
  const initial = EDGES.find((edge) => edge.id === preferred) || EDGES[0];
  adoptEdge(initial.base, 'сохранённый вход');

  // Окно не ждёт медленный край. Если оба успели за короткий бюджет — берём быстрый сразу.
  const choose = chooseFasterEdge(preferred);
  await Promise.race([
    choose,
    new Promise<void>((resolve) => setTimeout(resolve, 400)),
  ]);
  return getApiBase();
}

async function chooseFasterEdge(preferred: string | null): Promise<void> {
  const measured = await Promise.all(
    EDGES.map(async (edge) => ({ edge, ms: await probe(edge.base) })),
  );
  const alive = measured.filter((row): row is { edge: Edge; ms: number } => row.ms != null);
  let chosen = EDGES.find((edge) => edge.id === preferred) || EDGES[0];
  if (alive.length === 1) {
    chosen = alive[0].edge;
  } else if (alive.length > 1) {
    alive.sort((a, b) => a.ms - b.ms);
    const best = alive[0];
    const previous = alive.find((row) => row.edge.id === preferred);
    chosen = previous && previous.ms - best.ms <= 40 ? previous.edge : best.edge;
  } else {
    return;
  }
  const note = alive.map((row) => `${row.edge.id}=${row.ms}ms`).join(' ');
  adoptEdge(chosen.base, note);
}

/** Если выбранный вход перестал отвечать, сайт переходит на второй. */
export function startEdgeWatch(): void {
  if (pinned || watchTimer) return;
  watchTimer = setInterval(() => {
    void checkEdge();
  }, 20000);
}

async function checkEdge(): Promise<void> {
  if (pinned) return;
  const current = EDGES.find((edge) => edge.base === getApiBase()) || EDGES[0];
  const other = EDGES.find((edge) => edge.id !== current.id) || EDGES[1];
  const ms = await probe(current.base);
  if (ms != null) {
    failStreak = 0;
    return;
  }
  failStreak += 1;
  if (failStreak < 2) return;
  const alt = await probe(other.base);
  if (alt == null) return;
  adoptEdge(other.base, `${current.id} недоступен, ${other.id}=${alt}ms`);
}
