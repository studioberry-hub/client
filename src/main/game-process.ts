// ===== Детект живого Minecraft (java/javaw) после рестарта лаунчера =====

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const INSTANCE_BASE = 'UClient';

export type RunningGameMarker = {
  buildId: string;
  name?: string;
  gameVersion?: string;
  loader?: string;
  startedAt: number;
  pid?: number | null;
};

export type DetectedGame = RunningGameMarker & {
  pid: number;
  instanceRoot: string;
};

let adoptedWatchTimer: ReturnType<typeof setInterval> | null = null;
let adoptedPid: number | null = null;
let adoptedBuildId: string | null = null;

function markerPath(appDataDir: string): string {
  return path.join(appDataDir, 'running-game.json');
}

export function sanitizeBuildId(buildId: string): string {
  return String(buildId || '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-]/g, '');
}

/** Корень инстанса — тот же алгоритм, что getInstanceRoot в launcher.ts */
export function instanceRootFor(buildId: string): string {
  const sanitized = sanitizeBuildId(buildId);
  let appData: string;
  if (process.platform === 'win32') {
    appData = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
  } else if (process.platform === 'darwin') {
    appData = path.join(process.env.HOME || '', 'Library', 'Application Support');
  } else {
    appData = process.env.HOME || '';
  }
  const prefix = process.platform === 'darwin' ? '' : '.';
  return path.join(appData, prefix + INSTANCE_BASE.toLowerCase(), sanitized);
}

export function saveRunningGameMarker(appDataDir: string, marker: RunningGameMarker): void {
  try {
    if (!fs.existsSync(appDataDir)) fs.mkdirSync(appDataDir, { recursive: true });
    fs.writeFileSync(markerPath(appDataDir), JSON.stringify(marker), 'utf8');
  } catch {
    /* ignore */
  }
}

export function loadRunningGameMarker(appDataDir: string): RunningGameMarker | null {
  try {
    const raw = fs.readFileSync(markerPath(appDataDir), 'utf8');
    const data = JSON.parse(raw) as RunningGameMarker;
    if (!data?.buildId) return null;
    return data;
  } catch {
    return null;
  }
}

export function clearRunningGameMarker(appDataDir: string): void {
  try {
    const p = markerPath(appDataDir);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {
    /* ignore */
  }
}

function normalizePathForMatch(p: string): string {
  return path
    .resolve(String(p || ''))
    .replace(/\\/g, '/')
    .toLowerCase();
}

type JavaProc = { pid: number; cmd: string };

async function listJavaProcesses(): Promise<JavaProc[]> {
  if (process.platform === 'win32') {
    const script =
      "Get-CimInstance Win32_Process -Filter \"Name='java.exe' OR Name='javaw.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress";
    try {
      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', script],
        { encoding: 'utf8', timeout: 20000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      );
      const trimmed = String(stdout || '').trim();
      if (!trimmed) return [];
      const parsed = JSON.parse(trimmed) as
        | { ProcessId?: number; CommandLine?: string }
        | Array<{ ProcessId?: number; CommandLine?: string }>;
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      return rows
        .map((r) => ({
          pid: Number(r.ProcessId),
          cmd: String(r.CommandLine || ''),
        }))
        .filter((r) => Number.isInteger(r.pid) && r.pid > 0 && r.cmd);
    } catch {
      return [];
    }
  }

  try {
    const { stdout } = await execFileAsync('ps', ['-ax', '-o', 'pid=,args='], {
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return String(stdout || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const m = line.match(/^(\d+)\s+(.*)$/);
        if (!m) return null;
        const cmd = m[2];
        if (!/\bjava(?:w)?\b/i.test(cmd)) return null;
        return { pid: Number(m[1]), cmd };
      })
      .filter((x): x is JavaProc => Boolean(x));
  } catch {
    return [];
  }
}

function cmdMatchesInstance(cmd: string, instanceRoot: string): boolean {
  const needle = normalizePathForMatch(instanceRoot);
  if (!needle) return false;
  const hay = String(cmd || '').replace(/\\/g, '/').toLowerCase();
  if (hay.includes(needle)) return true;
  // Запас: только хвост `.uclient/<slug>`
  const parts = needle.split('/');
  const slug = parts[parts.length - 1];
  const parent = parts[parts.length - 2];
  if (slug && parent && hay.includes(`${parent}/${slug}`)) return true;
  return false;
}

export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Найти java-процесс Minecraft для конкретной сборки */
export async function findJavaForBuild(buildId: string): Promise<DetectedGame | null> {
  const slug = sanitizeBuildId(buildId);
  if (!slug) return null;
  const instanceRoot = instanceRootFor(slug);
  const procs = await listJavaProcesses();
  const hit = procs.find((p) => cmdMatchesInstance(p.cmd, instanceRoot));
  if (!hit) return null;
  return {
    buildId: slug,
    pid: hit.pid,
    instanceRoot,
    startedAt: Date.now(),
  };
}

/**
 * Ищем живую игру: сначала по маркеру, затем по списку сборок
 * (cmdline содержит путь инстанса %APPDATA%\.uclient\<id>).
 */
export async function detectRunningMinecraft(opts: {
  appDataDir: string;
  builds: Array<{ id: string; name?: string; gameVersion?: string; loader?: string }>;
}): Promise<DetectedGame | null> {
  const marker = loadRunningGameMarker(opts.appDataDir);
  const candidates: Array<{ id: string; name?: string; gameVersion?: string; loader?: string }> = [];
  if (marker?.buildId) {
    candidates.push({
      id: marker.buildId,
      name: marker.name,
      gameVersion: marker.gameVersion,
      loader: marker.loader,
    });
  }
  for (const b of opts.builds || []) {
    if (!b?.id) continue;
    if (candidates.some((c) => sanitizeBuildId(c.id) === sanitizeBuildId(b.id))) continue;
    candidates.push(b);
  }

  const procs = await listJavaProcesses();
  if (!procs.length) return null;

  for (const c of candidates) {
    const slug = sanitizeBuildId(c.id);
    const instanceRoot = instanceRootFor(slug);
    const hit = procs.find((p) => cmdMatchesInstance(p.cmd, instanceRoot));
    if (!hit) continue;
    const detected: DetectedGame = {
      buildId: slug,
      name: c.name || marker?.name,
      gameVersion: c.gameVersion || marker?.gameVersion,
      loader: c.loader || marker?.loader,
      pid: hit.pid,
      instanceRoot,
      startedAt: marker?.startedAt && sanitizeBuildId(marker.buildId) === slug ? marker.startedAt : Date.now(),
    };
    saveRunningGameMarker(opts.appDataDir, {
      buildId: detected.buildId,
      name: detected.name,
      gameVersion: detected.gameVersion,
      loader: detected.loader,
      startedAt: detected.startedAt,
      pid: detected.pid,
    });
    return detected;
  }
  return null;
}

export function stopAdoptedGameWatch(): void {
  if (adoptedWatchTimer) {
    clearInterval(adoptedWatchTimer);
    adoptedWatchTimer = null;
  }
  adoptedPid = null;
  adoptedBuildId = null;
}

/** Поллинг: когда java умер — onExit */
export function startAdoptedGameWatch(
  game: DetectedGame,
  onExit: (info: { buildId: string; code: number | null }) => void,
): void {
  stopAdoptedGameWatch();
  adoptedPid = game.pid;
  adoptedBuildId = game.buildId;
  adoptedWatchTimer = setInterval(() => {
    if (adoptedPid == null) return;
    if (isPidAlive(adoptedPid)) return;
    const buildId = adoptedBuildId || game.buildId;
    stopAdoptedGameWatch();
    onExit({ buildId, code: 0 });
  }, 2000);
}

export function getAdoptedWatch(): { buildId: string; pid: number } | null {
  if (adoptedPid == null || !adoptedBuildId) return null;
  return { buildId: adoptedBuildId, pid: adoptedPid };
}
