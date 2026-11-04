// Свои серверы: процесс Java на этом ПК, плагины, консоль и публичный адрес через реле.

import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import AdmZip from 'adm-zip';
import { execFile, spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'child_process';
import * as os from 'os';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { catalogFileUrl, getApiBase, isCatalogCdnUrl } from '../shared/apiBase';
import { armDownloads, downloadModrinthFile } from './modrinthDownload';
import { getLauncherDataDir } from './paths';
import { relayOwnerBuildId, releaseHostedAddress, reserveHostedAddress, setRelayDropHandler, startTunnel, stopTunnel } from './game-relay';
import { mapTcpPort, unmapTcpPort } from './portMap';

type Software = string;
type RunStatus = 'stopped' | 'installing' | 'starting' | 'running' | 'stopping' | 'error';

interface HostedServer {
  id: string;
  name: string;
  software: Software;
  gameVersion: string;
  port: number;
  memoryMb: number;
  memoryMin: number;
  javaPath: string;
  jvmArgs: string;
  motd: string;
  maxPlayers: number;
  gamemode: string;
  difficulty: string;
  viewDistance: number;
  simulationDistance: number;
  levelName: string;
  onlineMode: boolean;
  pvp: boolean;
  whiteList: boolean;
  allowFlight: boolean;
  spawnMonsters: boolean;
  forceGamemode: boolean;
  commandBlocks: boolean;
  spawnProtection: number;
  publicRelay: boolean;
  eulaAccepted: boolean;
  whitelistNames: string;
  hardcore: boolean;
  allowNether: boolean;
  generateStructures: boolean;
  levelSeed: string;
  levelType: string;
  spawnAnimals: boolean;
  spawnNpcs: boolean;
  enforceWhitelist: boolean;
  playerIdleTimeout: number;
  hideOnlinePlayers: boolean;
  enableStatus: boolean;
  createdAt: number;
  /** Постоянный адрес вида nick.uprojects.site. Живёт, пока сервер не удалён. */
  publicHost: string;
  publicPort: number;
  publicSlug: string;
  listingDesc: string;
  listingVisible: boolean;
  listingShots: string[];
}

interface Runtime {
  status: RunStatus;
  error: string;
  publicHost: string;
  publicPort: number;
  relayError: string;
  directHost: string;
  directPort: number;
  directError: string;
  cpuPercent: number;
  ramUsedMb: number;
}

const RESERVED_PORT = 25565;
const CORE_IDS = [
  'vanilla', 'paper', 'purpur', 'folia', 'leaves', 'leaf', 'pufferfish', 'fabric', 'quilt',
  'spigot', 'bukkit', 'mohist', 'sponge', 'velocity', 'waterfall', 'bungeecord',
  'canvas', 'arclight', 'youer', 'banner', 'divinemc',
];
const GAMEMODES = ['survival', 'creative', 'adventure', 'spectator'];
const DIFFICULTIES = ['peaceful', 'easy', 'normal', 'hard'];

const procs = new Map<string, ChildProcessWithoutNullStreams>();
const logs = new Map<string, string[]>();
const runtime = new Map<string, Runtime>();
const relayLocks = new Map<string, Promise<void>>();
const relayRetries = new Map<string, number>();
const relayRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const relayOpening = new Set<string>();
const versionCache = new Map<string, { at: number; versions: string[] }>();

function emptyRuntime(): Runtime {
  return {
    status: 'stopped',
    error: '',
    publicHost: '',
    publicPort: 0,
    relayError: '',
    directHost: '',
    directPort: 0,
    directError: '',
    cpuPercent: 0,
    ramUsedMb: 0,
  };
}

// ===== Нагрузка процесса Java =====

const cpuPrev = new Map<number, { at: number; cpu: number }>();
let usageTimer: ReturnType<typeof setInterval> | null = null;
let usageChild: ChildProcessWithoutNullStreams | null = null;
let usageKey = '';

function logicalCpus(): number {
  return Math.max(1, os.cpus().length);
}

function serverIdByPid(pid: number): string {
  for (const [id, proc] of procs) {
    if (proc.pid === pid) return id;
  }
  return '';
}

function applyUsage(id: string, pid: number, ramBytes: number, cpuSec: number): void {
  const now = Date.now();
  const prev = cpuPrev.get(pid);
  let cpu = 0;
  if (prev && cpuSec >= prev.cpu) {
    const dt = (now - prev.at) / 1000;
    if (dt > 0.2) cpu = Math.max(0, Math.min(100, ((cpuSec - prev.cpu) / dt / logicalCpus()) * 100));
  }
  cpuPrev.set(pid, { at: now, cpu: cpuSec });
  const run = runtime.get(id);
  if (!run) return;
  const cpuPercent = Math.round(cpu);
  const ramMb = Math.max(0, Math.round(ramBytes / 1048576));
  run.cpuPercent = cpuPercent;
  run.ramUsedMb = ramMb;
  send('hosted-servers:usage', { id, cpuPercent, ramUsedMb: ramMb });
}

function readProcUsage(pid: number): { ramBytes: number; cpuSec: number } | null {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
    const end = stat.lastIndexOf(')');
    const parts = stat.slice(end + 2).trim().split(/\s+/);
    const ticks = Number(parts[11]) + Number(parts[12]);
    const rssKb = Number((status.match(/VmRSS:\s+(\d+)/) || [])[1] || 0);
    if (!Number.isFinite(ticks) || !Number.isFinite(rssKb)) return null;
    return { ramBytes: rssKb * 1024, cpuSec: ticks / 100 };
  } catch {
    return null;
  }
}

function sampleUsageLinux(): void {
  for (const [id, proc] of procs) {
    const pid = proc.pid;
    if (!pid) continue;
    const row = readProcUsage(pid);
    if (!row) continue;
    applyUsage(id, pid, row.ramBytes, row.cpuSec);
  }
}

function usageWatchScript(pids: number[]): string {
  // InvariantCulture: иначе ru-RU пишет «1,5», и разбор в JS отбрасывает замер целиком.
  return [
    "$OutputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false",
    "$ErrorActionPreference = 'SilentlyContinue'",
    '$ci = [cultureinfo]::InvariantCulture',
    `$ids = @(${pids.join(',')})`,
    'while ($true) {',
    '  foreach ($id in $ids) {',
    '    $p = Get-Process -Id $id',
    '    $cpu = 0.0',
    '    $ws = [int64]0',
    '    if ($p) { $ws = [int64]$p.WorkingSet64; if ($null -ne $p.CPU) { $cpu = [double]$p.CPU } }',
    "    [Console]::Out.WriteLine(('{0}|{1}|{2}' -f $id, $ws, ($cpu.ToString($ci))))",
    '    [Console]::Out.Flush()',
    '  }',
    '  Start-Sleep -Milliseconds 1000',
    '}',
  ].join('\n');
}

function startUsageWatch(pids: number[]): void {
  const script = usageWatchScript(pids);
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
  usageChild = child;
  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buf += chunk.replace(/\0/g, '');
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() || '';
    for (const line of lines) {
      const match = /^(\d+)\|(\d+)\|([0-9.]+)$/.exec(line.trim());
      if (!match) continue;
      const pid = Number(match[1]);
      const id = serverIdByPid(pid);
      if (!id) continue;
      applyUsage(id, pid, Number(match[2]), Number(match[3]));
    }
  });
  child.on('exit', () => {
    if (usageChild !== child) return;
    usageChild = null;
    usageKey = '';
    if (procs.size) setTimeout(() => ensureUsageTimer(), 1500);
  });
}

function ensureUsageTimer(): void {
  const pids = [...procs.values()].map((proc) => proc.pid || 0).filter((pid) => pid > 0).sort((a, b) => a - b);
  if (!pids.length) {
    stopUsageTimer();
    return;
  }
  const key = pids.join(',');
  if (process.platform !== 'win32') {
    if (!usageTimer) usageTimer = setInterval(sampleUsageLinux, 1000);
    sampleUsageLinux();
    return;
  }
  if (usageChild && usageKey === key && usageChild.exitCode == null) return;
  const prev = usageChild;
  usageKey = key;
  startUsageWatch(pids);
  if (prev) prev.kill();
}

function stopUsageTimer(): void {
  if (procs.size) return;
  if (usageTimer) clearInterval(usageTimer);
  usageTimer = null;
  usageKey = '';
  const child = usageChild;
  usageChild = null;
  if (child) child.kill();
  cpuPrev.clear();
}

function rootDir(): string {
  return path.join(getLauncherDataDir(), 'hosted-servers');
}

function storeFile(): string {
  return path.join(rootDir(), 'servers.json');
}

function serverDir(id: string): string {
  return path.join(rootDir(), id);
}

function clamp(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function asSoftware(value: unknown): Software {
  const v = String(value || '');
  return CORE_IDS.includes(v) ? v : 'paper';
}

function nextFreePort(list: HostedServer[], exceptId = ''): number {
  const used = new Set(list.filter((row) => row.id !== exceptId).map((row) => row.port));
  used.add(RESERVED_PORT);
  for (let port = 25566; port <= 26000; port += 1) {
    if (!used.has(port)) return port;
  }
  return 25566;
}

function normalize(raw: Partial<HostedServer> | null | undefined, prev?: HostedServer): HostedServer {
  const base = prev || {
    id: '',
    name: 'Мой сервер',
    software: 'paper' as Software,
    gameVersion: '1.21.4',
    port: 25566,
    memoryMb: 2048,
    memoryMin: 512,
    javaPath: '',
    jvmArgs: '',
    motd: 'Сервер Undefined Client',
    maxPlayers: 20,
    gamemode: 'survival',
    difficulty: 'normal',
    viewDistance: 10,
    simulationDistance: 10,
    levelName: 'world',
    onlineMode: false,
    pvp: true,
    whiteList: false,
    allowFlight: false,
    spawnMonsters: true,
    forceGamemode: false,
    commandBlocks: false,
    spawnProtection: 16,
    publicRelay: true,
    eulaAccepted: false,
    whitelistNames: '',
    hardcore: false,
    allowNether: true,
    generateStructures: true,
    levelSeed: '',
    levelType: 'minecraft:normal',
    spawnAnimals: true,
    spawnNpcs: true,
    enforceWhitelist: false,
    playerIdleTimeout: 0,
    hideOnlinePlayers: false,
    enableStatus: true,
    createdAt: Date.now(),
    publicHost: '',
    publicPort: 0,
    publicSlug: '',
    listingDesc: '',
    listingVisible: false,
    listingShots: [],
  };
  const gamemode = String(raw?.gamemode || base.gamemode);
  const difficulty = String(raw?.difficulty || base.difficulty);
  const level = String(raw?.levelName || base.levelName).replace(/[^\w.-]+/g, '').slice(0, 32);
  return {
    id: prev?.id || String(raw?.id || base.id),
    name: String(raw?.name || base.name).trim().slice(0, 48) || 'Мой сервер',
    software: asSoftware(raw?.software ?? base.software),
    gameVersion: String(raw?.gameVersion || base.gameVersion).trim().slice(0, 32) || '1.21.4',
    port: (() => {
      const value = clamp(Number(raw?.port ?? base.port), 1, 65535, 25566);
      return value === RESERVED_PORT ? 25566 : value;
    })(),
    memoryMb: clamp(Number(raw?.memoryMb ?? base.memoryMb), 512, 32768, 2048),
    memoryMin: clamp(Number(raw?.memoryMin ?? base.memoryMin), 256, 32768, 512),
    javaPath: String(raw?.javaPath ?? base.javaPath).trim().slice(0, 500),
    jvmArgs: String(raw?.jvmArgs ?? base.jvmArgs).replace(/[\r\n]/g, ' ').trim().slice(0, 500),
    motd: String(raw?.motd ?? base.motd).replace(/[\r\n=]/g, ' ').slice(0, 59),
    maxPlayers: clamp(Number(raw?.maxPlayers ?? base.maxPlayers), 1, 1000, 20),
    gamemode: GAMEMODES.includes(gamemode) ? gamemode : 'survival',
    difficulty: DIFFICULTIES.includes(difficulty) ? difficulty : 'normal',
    viewDistance: clamp(Number(raw?.viewDistance ?? base.viewDistance), 3, 32, 10),
    simulationDistance: clamp(Number(raw?.simulationDistance ?? base.simulationDistance), 3, 32, 10),
    levelName: level || 'world',
    onlineMode: Boolean(raw?.onlineMode ?? base.onlineMode),
    pvp: Boolean(raw?.pvp ?? base.pvp),
    whiteList: Boolean(raw?.whiteList ?? base.whiteList),
    allowFlight: Boolean(raw?.allowFlight ?? base.allowFlight),
    spawnMonsters: Boolean(raw?.spawnMonsters ?? base.spawnMonsters),
    forceGamemode: Boolean(raw?.forceGamemode ?? base.forceGamemode),
    commandBlocks: Boolean(raw?.commandBlocks ?? base.commandBlocks),
    spawnProtection: clamp(Number(raw?.spawnProtection ?? base.spawnProtection), 0, 64, 16),
    publicRelay: Boolean(raw?.publicRelay ?? base.publicRelay),
    eulaAccepted: Boolean(raw?.eulaAccepted ?? base.eulaAccepted),
    whitelistNames: String(raw?.whitelistNames ?? base.whitelistNames).slice(0, 4000),
    hardcore: Boolean(raw?.hardcore ?? base.hardcore),
    allowNether: Boolean(raw?.allowNether ?? base.allowNether),
    generateStructures: Boolean(raw?.generateStructures ?? base.generateStructures),
    levelSeed: String(raw?.levelSeed ?? base.levelSeed).replace(/[\r\n=]/g, '').slice(0, 64),
    levelType: String(raw?.levelType ?? base.levelType).slice(0, 64) || 'minecraft:normal',
    spawnAnimals: Boolean(raw?.spawnAnimals ?? base.spawnAnimals),
    spawnNpcs: Boolean(raw?.spawnNpcs ?? base.spawnNpcs),
    enforceWhitelist: Boolean(raw?.enforceWhitelist ?? base.enforceWhitelist),
    playerIdleTimeout: clamp(Number(raw?.playerIdleTimeout ?? base.playerIdleTimeout), 0, 1440, 0),
    hideOnlinePlayers: Boolean(raw?.hideOnlinePlayers ?? base.hideOnlinePlayers),
    enableStatus: Boolean(raw?.enableStatus ?? base.enableStatus),
    createdAt: Number(prev?.createdAt || raw?.createdAt || base.createdAt) || Date.now(),
    publicHost: String(raw?.publicHost ?? base.publicHost).trim().toLowerCase().slice(0, 253),
    publicPort: clamp(Number(raw?.publicPort ?? base.publicPort), 0, 65535, 0),
    publicSlug: String(raw?.publicSlug ?? base.publicSlug).trim().toLowerCase().slice(0, 63),
    listingDesc: String(raw?.listingDesc ?? base.listingDesc).slice(0, 2000),
    listingVisible: Boolean(raw?.listingVisible ?? base.listingVisible),
    listingShots: (Array.isArray(raw?.listingShots) ? raw.listingShots : base.listingShots)
      .filter((item): item is string => typeof item === 'string' && item.startsWith('data:image/'))
      .slice(0, 5)
      .map((item) => item.slice(0, 500_000)),
  };
}

function loadAll(): HostedServer[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(storeFile(), 'utf8'));
    if (!Array.isArray(parsed)) return [];
    const rows = parsed.map((row) => normalize(row)).filter((row) => row.id);
    const used = new Set<number>([RESERVED_PORT]);
    let changed = false;
    const fixed = rows.map((row) => {
      if (row.port !== RESERVED_PORT && !used.has(row.port)) {
        used.add(row.port);
        return row;
      }
      let port = 25566;
      while (used.has(port)) port += 1;
      used.add(port);
      changed = true;
      return { ...row, port };
    });
    if (changed) saveAll(fixed);
    return fixed;
  } catch {
    return [];
  }
}

function saveAll(list: HostedServer[]): void {
  fs.mkdirSync(rootDir(), { recursive: true });
  fs.writeFileSync(storeFile(), JSON.stringify(list, null, 2), 'utf8');
}

function coreReady(id: string): boolean {
  try {
    return fs.statSync(path.join(serverDir(id), 'server.jar')).size > 500_000;
  } catch {
    return false;
  }
}

function javaMajorFor(version: string): number {
  const parts = version.split('.').map((n) => parseInt(n, 10));
  if (parts.some((n) => Number.isNaN(n))) return 21;
  if (parts[0] > 1) return 25;
  const minor = parts[1] || 0;
  const patch = parts[2] || 0;
  if (minor >= 21 || (minor === 20 && patch >= 5)) return 21;
  if (minor >= 18) return 17;
  if (minor >= 17) return 16;
  return 8;
}

function javaBinaryName(): string {
  return process.platform === 'win32' ? 'java.exe' : 'java';
}

function managedJavas(): Array<{ major: number; exe: string }> {
  const tools = path.join(getLauncherDataDir(), 'tools');
  const bin = javaBinaryName();
  let names: string[] = [];
  try {
    names = fs.readdirSync(tools);
  } catch {
    return [];
  }
  const found: Array<{ major: number; exe: string }> = [];
  for (const name of names) {
    const match = name.match(/^java(\d+)$/);
    if (!match) continue;
    const exe = path.join(tools, name, 'bin', bin);
    if (fs.existsSync(exe)) found.push({ major: Number(match[1]), exe });
  }
  return found;
}

function pathJava(): { major: number; exe: string } | null {
  const bin = javaBinaryName();
  const res = spawnSync(bin, ['-version'], { encoding: 'utf8', timeout: 4000, windowsHide: true });
  const text = `${res.stdout || ''}\n${res.stderr || ''}`;
  const match = text.match(/version\s+"(\d+)(?:\.(\d+))?/);
  if (!match) return null;
  const major = match[1] === '1' ? parseInt(match[2] || '8', 10) : parseInt(match[1], 10);
  if (!major) return null;
  return { major, exe: bin };
}

function resolveJavaExe(server: HostedServer): string {
  const pinned = server.javaPath.trim();
  if (pinned && (pinned === 'java' || pinned === 'java.exe' || fs.existsSync(pinned))) return pinned;
  const need = javaMajorFor(server.gameVersion);
  const managed = managedJavas().filter((row) => row.major >= need).sort((a, b) => a.major - b.major);
  if (managed[0]) return managed[0].exe;
  const fromPath = pathJava();
  if (fromPath && fromPath.major >= need) return fromPath.exe;
  return '';
}

function send(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function pushLog(id: string, line: string): void {
  const clean = line.replace(/\x1b\[[0-9;]*m/g, '').replace(/\r/g, '').trimEnd();
  if (!clean) return;
  const buf = logs.get(id) || [];
  buf.push(clean);
  if (buf.length > 500) buf.splice(0, buf.length - 500);
  logs.set(id, buf);
  send('hosted-servers:log', { id, line: clean });
}

function patchRuntime(id: string, patch: Partial<Runtime>): void {
  const next = { ...(runtime.get(id) || emptyRuntime()), ...patch };
  runtime.set(id, next);
  const server = loadAll().find((row) => row.id === id);
  send('hosted-servers:state', server ? viewOf(server) : { id, ...next });
}

function iconDataOf(id: string): string {
  try {
    const buf = fs.readFileSync(path.join(serverDir(id), 'server-icon.png'));
    if (buf.length > 512_000) return '';
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch {
    return '';
  }
}

function viewOf(server: HostedServer) {
  const run = runtime.get(server.id) || emptyRuntime();
  return {
    ...server,
    ...run,
    publicHost: server.publicHost,
    publicPort: server.publicPort,
    publicSlug: server.publicSlug,
    coreReady: coreReady(server.id),
    javaNeed: javaMajorFor(server.gameVersion),
    javaResolved: resolveJavaExe(server),
    iconData: iconDataOf(server.id),
  };
}

function accountNickname(): string {
  try {
    const active = JSON.parse(fs.readFileSync(path.join(getLauncherDataDir(), 'active-account.json'), 'utf8'));
    const accounts = JSON.parse(fs.readFileSync(path.join(getLauncherDataDir(), 'accounts.json'), 'utf8'));
    const uuid = String(active?.uuid || '');
    const row = Array.isArray(accounts)
      ? accounts.find((item) => item?.uuid === uuid) || accounts[0]
      : null;
    return String(row?.name || '').trim();
  } catch {
    return '';
  }
}

async function ensurePublicAddress(server: HostedServer): Promise<HostedServer> {
  if (server.publicHost && server.publicPort > 0) return server;
  const reserved = await reserveHostedAddress(server.id, accountNickname() || server.name);
  if (!reserved.ok || !reserved.publicHost || !reserved.publicPort) return server;
  const list = loadAll();
  const index = list.findIndex((row) => row.id === server.id);
  if (index < 0) return server;
  const next = {
    ...list[index],
    publicHost: reserved.publicHost,
    publicPort: reserved.publicPort,
    publicSlug: reserved.publicSlug || '',
  };
  list[index] = next;
  saveAll(list);
  return next;
}

// Прямое соединение с CDN часто замирает после первых десятков килобайт и не рвётся.
// Тогда файл .part больше не растёт. Повтор идёт через наш сервер, до которого CDN доступен.
const DOWNLOAD_STALL_MS = 8_000;
const DOWNLOAD_HEADERS_MS = 20_000;
const MIN_JAR_BYTES = 500_000;
const MAX_JAR_BYTES = 250 * 1024 * 1024;

const CORE_DOWNLOAD_HOSTS = new Set([
  'api.papermc.io',
  'fill.papermc.io',
  'fill-data.papermc.io',
  'api.purpurmc.org',
  'api.leavesmc.org',
  'api.leafmc.one',
  'piston-meta.mojang.com',
  'piston-data.mojang.com',
  'launchermeta.mojang.com',
  'launcher.mojang.com',
  'meta.fabricmc.net',
  'maven.fabricmc.net',
  'meta.quiltmc.org',
  'maven.quiltmc.org',
  'download.getbukkit.org',
  'cdn.getbukkit.org',
  'ci.md-5.net',
  'mohistmc.com',
  'api.mohistmc.com',
  'ci.pufferfish.host',
  'github.com',
  'api.github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'github-releases.githubusercontent.com',
  'codeload.github.com',
]);

interface DownloadHooks {
  onProgress?: (loaded: number, total: number) => void;
  onProxy?: () => void;
  onResume?: () => void;
}

function coreDownloadHost(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && CORE_DOWNLOAD_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

function coreProxyUrl(raw: string): string {
  const base = getApiBase().replace(/\/+$/, '');
  return `${base}/api/core-jar?url=${encodeURIComponent(raw)}`;
}

function downloadStatus(err: unknown): number {
  return Number((err as { status?: number })?.status || 0);
}

function httpError(message: string, status: number): Error {
  const error = new Error(message);
  (error as { status?: number }).status = status;
  return error;
}

async function streamBody(url: string, dest: string, onProgress?: (loaded: number, total: number) => void): Promise<number> {
  const controller = new AbortController();
  const headerTimer = setTimeout(() => controller.abort(), DOWNLOAD_HEADERS_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': 'UndefinedClient', Accept: '*/*' },
      redirect: 'follow',
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) throw new Error('Сервер ядра не ответил');
    throw err;
  } finally {
    clearTimeout(headerTimer);
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    throw httpError(`Не удалось скачать ядро (HTTP ${response.status})`, response.status);
  }
  const type = response.headers.get('content-type') || '';
  if (/json|html|text\/plain/i.test(type) && !/java-archive|octet-stream|zip/i.test(type)) {
    const text = await response.text();
    throw httpError(text.replace(/\s+/g, ' ').slice(0, 180) || `Сервер отдал ${type}`, response.status);
  }
  const total = Number(response.headers.get('content-length') || 0);
  if (total > MAX_JAR_BYTES) throw new Error('Файл ядра слишком большой');
  let received = 0;
  let lastByte = Date.now();
  const stall = setInterval(() => {
    if (Date.now() - lastByte >= DOWNLOAD_STALL_MS) controller.abort();
  }, 1000);
  const meter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      received += chunk.length;
      lastByte = Date.now();
      onProgress?.(received, total);
      cb(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(response.body as import('stream/web').ReadableStream), meter, fs.createWriteStream(dest));
  } catch (err) {
    if (controller.signal.aborted && total > received) {
      const stalled = new Error('Скачивание остановилось');
      (stalled as { stalled?: boolean; total?: number }).stalled = true;
      (stalled as { total?: number }).total = total;
      throw stalled;
    }
    if (controller.signal.aborted) throw new Error('Сервер ядра не ответил');
    throw err;
  } finally {
    clearInterval(stall);
  }
  return total;
}

async function readRange(url: string, start: number, end: number): Promise<Buffer> {
  const controller = new AbortController();
  let lastByte = Date.now();
  const stall = setInterval(() => {
    if (Date.now() - lastByte >= DOWNLOAD_STALL_MS) controller.abort();
  }, 500);
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'UndefinedClient',
        Accept: '*/*',
        Range: `bytes=${start}-${end}`,
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (response.status !== 206 || !response.body) {
      await response.body?.cancel().catch(() => undefined);
      const error = httpError(
        response.status === 200 ? 'Сервер не отдаёт файл частями' : `Не удалось скачать ядро (HTTP ${response.status})`,
        response.status === 200 ? 0 : response.status,
      );
      if (response.status === 200) (error as { noRange?: boolean }).noRange = true;
      throw error;
    }
    const expected = end - start + 1;
    const parts: Buffer[] = [];
    let got = 0;
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      lastByte = Date.now();
      got += value.byteLength;
      parts.push(Buffer.from(value));
      if (got >= expected) break;
    }
    if (got !== expected) throw new Error('Скачивание остановилось');
    return Buffer.concat(parts);
  } finally {
    clearInterval(stall);
  }
}

async function resumeByRange(
  url: string,
  dest: string,
  total: number,
  onProgress?: (loaded: number, total: number) => void,
): Promise<void> {
  const have = fs.statSync(dest).size;
  let chunk = have < 64 * 1024 ? 16 * 1024 : 256 * 1024;
  let tinyFails = 0;
  let okStreak = 0;
  while (fs.statSync(dest).size < total) {
    const offset = fs.statSync(dest).size;
    const end = Math.min(total - 1, offset + chunk - 1);
    try {
      const buf = await readRange(url, offset, end);
      fs.appendFileSync(dest, buf);
      tinyFails = 0;
      okStreak += 1;
      if (okStreak >= 4 && chunk < 256 * 1024) {
        chunk = Math.min(256 * 1024, chunk * 2);
        okStreak = 0;
      }
      onProgress?.(fs.statSync(dest).size, total);
    } catch (err) {
      if ((err as { noRange?: boolean }).noRange) throw new Error('Скачивание остановилось');
      const status = downloadStatus(err);
      if (status >= 400 && status < 500 && status !== 408 && status !== 429) throw err;
      okStreak = 0;
      if (chunk <= 8 * 1024) {
        tinyFails += 1;
        if (tinyFails >= 3) throw new Error('Скачивание остановилось');
      } else {
        chunk = Math.max(8 * 1024, Math.floor(chunk / 2));
      }
    }
  }
}

function assertJar(dest: string, total: number): void {
  const size = fs.statSync(dest).size;
  if (total > 0 && size !== total) throw new Error(`Загрузка оборвана: получено ${size} из ${total} байт`);
  if (size < MIN_JAR_BYTES) throw new Error('Файл ядра скачался неполностью');
  const magic = Buffer.alloc(2);
  const fd = fs.openSync(dest, 'r');
  try {
    fs.readSync(fd, magic, 0, 2, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (magic.toString() !== 'PK') throw new Error('Скачанный файл не является jar');
}

async function downloadOnce(url: string, dest: string, hooks: DownloadHooks = {}): Promise<void> {
  let total = 0;
  let stalled = false;
  try {
    total = await streamBody(url, dest, hooks.onProgress);
  } catch (err) {
    if ((err as { stalled?: boolean }).stalled) {
      stalled = true;
      total = Number((err as { total?: number }).total || 0);
    } else {
      throw err;
    }
  }
  let size = 0;
  try {
    size = fs.statSync(dest).size;
  } catch {
    size = 0;
  }
  if (stalled) {
    // Почти пустой файл значит, что канал мёртвый с самого начала.
    // Докачивать его кусками с того же адреса только держит прогресс на нуле.
    if (!(total > size && size >= 256 * 1024)) throw new Error('Скачивание остановилось');
    hooks.onResume?.();
    await resumeByRange(url, dest, total, hooks.onProgress);
  }
  assertJar(dest, total);
}

async function downloadTo(urls: string | string[], dest: string, hooks: DownloadHooks = {}): Promise<void> {
  const list = (Array.isArray(urls) ? urls : [urls]).filter(Boolean);
  let last: Error | null = null;
  for (const urlStr of list) {
    const attempts: Array<{ url: string; viaProxy: boolean }> = [{ url: urlStr, viaProxy: false }];
    if (isCatalogCdnUrl(urlStr)) attempts.push({ url: catalogFileUrl(urlStr, 'standalone'), viaProxy: true });
    else if (coreDownloadHost(urlStr)) attempts.push({ url: coreProxyUrl(urlStr), viaProxy: true });
    let missing = false;
    for (const attempt of attempts) {
      if (attempt.viaProxy) hooks.onProxy?.();
      try {
        await downloadOnce(attempt.url, dest, hooks);
        return;
      } catch (err) {
        last = err instanceof Error ? err : new Error(String(err));
        try {
          fs.rmSync(dest, { force: true });
        } catch {
          /* временный файл уже удалён */
        }
        const status = downloadStatus(err);
        if (status === 404) {
          missing = true;
          break;
        }
        if (status >= 400 && status < 500 && status !== 408 && status !== 429) throw last;
      }
    }
    if (missing) continue;
  }
  throw last || new Error('Не удалось скачать файл');
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'UndefinedClient', Accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const FILL_PROJECTS: Record<string, string> = {
  paper: 'paper',
  folia: 'folia',
  velocity: 'velocity',
  waterfall: 'waterfall',
};
const LEAVES_API = 'https://api.leavesmc.org/v2/projects/leaves';
const LEAF_API = 'https://api.leafmc.one/v2/projects/leaf';
const FILL_API = 'https://fill.papermc.io/v3/projects';

async function vanillaVersions(): Promise<string[]> {
  const data = await getJson('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
  return Array.isArray(data?.versions)
    ? data.versions.filter((row: { type?: string }) => row.type === 'release').map((row: { id: string }) => row.id)
    : [];
}

async function listVersions(software: Software): Promise<string[]> {
  const cached = versionCache.get(software);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.versions;
  let versions: string[] = [];
  if (FILL_PROJECTS[software]) {
    const data = await getJson(`${FILL_API}/${FILL_PROJECTS[software]}`);
    versions = flattenFillVersions(data);
  } else if (software === 'leaves') {
    const data = await getJson(LEAVES_API);
    versions = Array.isArray(data?.versions) ? data.versions.slice().reverse() : [];
  } else if (software === 'leaf') {
    const data = await getJson(LEAF_API);
    versions = Array.isArray(data?.versions) ? data.versions.slice().reverse() : [];
  } else if (software === 'purpur') {
    const data = await getJson('https://api.purpurmc.org/v2/purpur');
    versions = Array.isArray(data?.versions) ? data.versions.slice().reverse() : [];
  } else if (software === 'fabric' || software === 'sponge') {
    const data = await getJson('https://meta.fabricmc.net/v2/versions/game');
    versions = Array.isArray(data)
      ? data.filter((row: { stable?: boolean }) => row.stable !== false).map((row: { version: string }) => row.version)
      : [];
  } else if (software === 'quilt') {
    const data = await getJson('https://meta.quiltmc.org/v3/versions/game');
    versions = Array.isArray(data)
      ? data.filter((row: { stable?: boolean }) => row.stable !== false).map((row: { version: string }) => row.version)
      : [];
  } else if (software === 'bungeecord') {
    versions = ['latest'];
  } else {
    versions = await vanillaVersions();
  }
  versions = versions.filter(Boolean).slice(0, 40);
  versionCache.set(software, { at: Date.now(), versions });
  return versions;
}

function flattenFillVersions(data: any): string[] {
  const groups = data?.versions;
  if (Array.isArray(groups)) return groups.map((row: unknown) => String(row || '')).filter(Boolean);
  if (!groups || typeof groups !== 'object') return [];
  const out: string[] = [];
  for (const list of Object.values(groups)) {
    if (!Array.isArray(list)) continue;
    for (const row of list) {
      const version = String(row || '');
      if (version && !out.includes(version)) out.push(version);
    }
  }
  return out;
}

async function fillJar(project: string, version: string): Promise<string> {
  const data = await getJson(`${FILL_API}/${project}/versions/${encodeURIComponent(version)}/builds`);
  const builds = Array.isArray(data) ? data : [];
  const stable = builds.filter((row: { channel?: string }) => String(row?.channel || '').toUpperCase() === 'STABLE');
  const pick = (stable.length ? stable : builds)[0];
  const url = pick?.downloads?.['server:default']?.url;
  if (!url) throw new Error(`Для этой версии нет сборки ${project}`);
  return String(url);
}

async function paperJar(api: string, version: string, label: string): Promise<string> {
  const data = await getJson(`${api}/versions/${encodeURIComponent(version)}/builds`);
  const builds = Array.isArray(data?.builds) ? data.builds : [];
  const stable = builds.filter((row: { channel?: string }) => {
    const channel = String(row?.channel || 'default').toLowerCase();
    return channel === 'default' || channel === 'stable';
  });
  const pool = stable.length ? stable : builds;
  const pick = pool[pool.length - 1];
  const file = pick?.downloads?.application || pick?.downloads?.primary;
  const name = file?.name;
  const build = pick?.build;
  if (!name || build == null) throw new Error(`Для этой версии нет сборки ${label}`);
  return `${api}/versions/${encodeURIComponent(version)}/builds/${build}/downloads/${encodeURIComponent(name)}`;
}

// api.leafmc.one стоит за Cloudflare: заголовки приходят, тело в РФ замирает на нуле.
// Тот же jar публикуется в релизах GitHub, до него канал обычно живой.
async function leafJarUrls(version: string): Promise<string[]> {
  const apiUrl = await paperJar(LEAF_API, version, 'leaf');
  const match = apiUrl.match(/\/downloads\/([^/?#]+)$/);
  if (!match) return [apiUrl];
  const file = match[1];
  const github = `https://github.com/Winds-Studio/Leaf/releases/download/ver-${encodeURIComponent(version)}/${file}`;
  return [github, apiUrl];
}

async function resolveJarUrl(server: HostedServer): Promise<string> {
  const version = server.gameVersion;
  if (FILL_PROJECTS[server.software]) return fillJar(FILL_PROJECTS[server.software], version);
  if (server.software === 'leaves') return paperJar(LEAVES_API, version, 'leaves');
  if (server.software === 'leaf') return (await leafJarUrls(version))[0];
  if (server.software === 'purpur') {
    return `https://api.purpurmc.org/v2/purpur/${encodeURIComponent(version)}/latest/download`;
  }
  if (server.software === 'vanilla' || server.software === 'sponge') {
    const manifest = await getJson('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
    const hit = (manifest?.versions || []).find((row: { id?: string }) => row.id === version);
    if (!hit?.url) throw new Error('Этой версии нет в манифесте Mojang');
    const meta = await getJson(hit.url);
    const url = meta?.downloads?.server?.url;
    if (!url) throw new Error('У этой версии нет server.jar');
    return String(url);
  }
  if (server.software === 'fabric') {
    const loaders = await getJson('https://meta.fabricmc.net/v2/versions/loader');
    const installers = await getJson('https://meta.fabricmc.net/v2/versions/installer');
    const loader = Array.isArray(loaders) ? loaders.find((row: { stable?: boolean }) => row.stable !== false)?.version : '';
    const installer = Array.isArray(installers) ? installers[0]?.version : '';
    if (!loader || !installer) throw new Error('Не удалось получить версии Fabric');
    return `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(version)}/${encodeURIComponent(loader)}/${encodeURIComponent(installer)}/server/jar`;
  }
  if (server.software === 'quilt') {
    const loaders = await getJson('https://meta.quiltmc.org/v3/versions/loader');
    const loader = Array.isArray(loaders) ? (loaders.find((row: { stable?: boolean }) => row.stable !== false) || loaders[0])?.version : '';
    if (!loader) throw new Error('Не удалось получить версии Quilt');
    return `https://meta.quiltmc.org/v3/versions/loader/${encodeURIComponent(version)}/${encodeURIComponent(loader)}/server/jar`;
  }
  if (server.software === 'spigot') return `https://download.getbukkit.org/spigot/spigot-${encodeURIComponent(version)}.jar`;
  if (server.software === 'bukkit') return `https://download.getbukkit.org/craftbukkit/craftbukkit-${encodeURIComponent(version)}.jar`;
  if (server.software === 'bungeecord') {
    return 'https://ci.md-5.net/job/BungeeCord/lastSuccessfulBuild/artifact/bootstrap/target/BungeeCord.jar';
  }
  if (server.software === 'mohist') return `https://mohistmc.com/api/${encodeURIComponent(version)}/latest/download`;
  if (server.software === 'pufferfish') {
    const branch = version.startsWith('1.') ? version.split('.').slice(0, 2).join('.') : version;
    return `https://ci.pufferfish.host/job/Pufferfish-${encodeURIComponent(branch)}/lastSuccessfulBuild/artifact/pufferfish-server/build/libs/pufferfish-paperclip.jar`;
  }
  if (server.software === 'canvas') return `https://github.com/CraftCanvasMC/Canvas/releases/latest/download/canvas-${encodeURIComponent(version)}.jar`;
  if (server.software === 'arclight') return `https://github.com/IzzelAliz/Arclight/releases/latest/download/arclight-${encodeURIComponent(version)}.jar`;
  if (server.software === 'youer') return `https://github.com/MohistMC/Youer/releases/latest/download/youer-${encodeURIComponent(version)}.jar`;
  if (server.software === 'banner') return `https://github.com/MohistMC/Banner/releases/latest/download/banner-${encodeURIComponent(version)}.jar`;
  if (server.software === 'divinemc') return `https://github.com/DivineMC/DivineMC/releases/latest/download/divinemc-${encodeURIComponent(version)}.jar`;
  throw new Error('Для этого ядра нет прямой ссылки');
}

async function installCore(server: HostedServer): Promise<void> {
  if (procs.has(server.id)) throw new Error('Остановите сервер перед сменой ядра');
  patchRuntime(server.id, { status: 'installing', error: '' });
  const dir = serverDir(server.id);
  fs.mkdirSync(dir, { recursive: true });
  const part = path.join(dir, 'server.jar.part');
  const dest = path.join(dir, 'server.jar');
  try {
    pushLog(server.id, `Скачиваю ${server.software} ${server.gameVersion}…`);
    const urls = server.software === 'leaf' ? await leafJarUrls(server.gameVersion) : [await resolveJarUrl(server)];
    let lastLog = 0;
    await downloadTo(urls, part, {
      onResume: () => pushLog(server.id, 'Соединение замирает, качаю файл частями…'),
      onProxy: () => pushLog(server.id, 'Прямое скачивание оборвалось, качаю через сервер лаунчера…'),
      onProgress: (loaded, total) => {
        const now = Date.now();
        if (now - lastLog < 1500) return;
        lastLog = now;
        const mb = (value: number) => `${(value / 1048576).toFixed(1)} МБ`;
        pushLog(server.id, total > 0 ? `Скачано ${mb(loaded)} из ${mb(total)}` : `Скачано ${mb(loaded)}`);
      },
    });
    fs.renameSync(part, dest);
    if (!coreReady(server.id)) throw new Error('Файл ядра скачался неполностью');
    pushLog(server.id, 'Ядро готово.');
    patchRuntime(server.id, { status: 'stopped', error: '' });
  } catch (err) {
    try {
      fs.rmSync(part, { force: true });
    } catch {
      /* нет временного файла */
    }
    const message = err instanceof Error ? err.message : String(err);
    pushLog(server.id, message);
    patchRuntime(server.id, { status: 'error', error: message });
    throw err;
  }
}

function writeProperties(server: HostedServer): void {
  const file = path.join(serverDir(server.id), 'server.properties');
  const patch: Record<string, string> = {
    'server-port': String(server.port),
    motd: server.motd,
    'max-players': String(server.maxPlayers),
    gamemode: server.gamemode,
    difficulty: server.difficulty,
    'view-distance': String(server.viewDistance),
    'simulation-distance': String(server.simulationDistance),
    'level-name': server.levelName,
    'online-mode': String(server.onlineMode),
    pvp: String(server.pvp),
    'white-list': String(server.whiteList),
    'allow-flight': String(server.allowFlight),
    'spawn-monsters': String(server.spawnMonsters),
    'force-gamemode': String(server.forceGamemode),
    'enable-command-block': String(server.commandBlocks),
    'spawn-protection': String(server.spawnProtection),
    hardcore: String(server.hardcore),
    'allow-nether': String(server.allowNether),
    'generate-structures': String(server.generateStructures),
    'level-seed': server.levelSeed,
    'level-type': server.levelType,
    'spawn-animals': String(server.spawnAnimals),
    'spawn-npcs': String(server.spawnNpcs),
    'enforce-whitelist': String(server.enforceWhitelist),
    'player-idle-timeout': String(server.playerIdleTimeout),
    'hide-online-players': String(server.hideOnlinePlayers),
    'enable-status': String(server.enableStatus),
    'enable-query': 'false',
  };
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    text = '';
  }
  const seen = new Set<string>();
  const out = text.split(/\r?\n/).map((line) => {
    const match = line.match(/^([^#=\s][^=]*)=(.*)$/);
    if (!match) return line;
    const key = match[1].trim();
    if (patch[key] === undefined) return line;
    seen.add(key);
    return `${key}=${patch[key]}`;
  });
  for (const [key, value] of Object.entries(patch)) {
    if (!seen.has(key)) out.push(`${key}=${value}`);
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  fs.writeFileSync(file, `${out.join('\n')}\n`, 'utf8');
}

function offlineUuid(name: string): string {
  const hash = crypto.createHash('md5').update(`OfflinePlayer:${name}`).digest();
  hash[6] = (hash[6] & 0x0f) | 0x30;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function writeWhitelist(server: HostedServer): void {
  const names = server.whitelistNames
    .split(/[\s,;]+/)
    .map((name) => name.trim())
    .filter(Boolean)
    .slice(0, 200);
  const rows = names.map((name) => ({ uuid: offlineUuid(name), name }));
  fs.writeFileSync(path.join(serverDir(server.id), 'whitelist.json'), JSON.stringify(rows, null, 2), 'utf8');
}

function relayBuildId(id: string): string {
  return `hosted:${id}`;
}

async function openDirect(server: HostedServer): Promise<void> {
  const mapped = await mapTcpPort(server.port);
  if (!procs.has(server.id)) {
    await unmapTcpPort();
    return;
  }
  if (!mapped) {
    pushLog(server.id, 'Роутер не открыл прямой порт. Снаружи остаётся реле: пинг выше, и часть VPN до него не доходит.');
    patchRuntime(server.id, { directHost: '', directPort: 0, directError: 'Роутер не открыл порт' });
    return;
  }
  pushLog(server.id, `Прямой адрес: ${mapped.host}:${mapped.port}. Пинг как до вашего интернета, без реле.`);
  patchRuntime(server.id, { directHost: mapped.host, directPort: mapped.port, directError: '' });
}

function clearRelayRetry(id: string): void {
  const timer = relayRetryTimers.get(id);
  if (timer) clearTimeout(timer);
  relayRetryTimers.delete(id);
}

function scheduleRelayReconnect(id: string): void {
  if (relayRetryTimers.has(id) || relayOpening.has(id)) return;
  if (!procs.has(id)) return;
  const attempt = (relayRetries.get(id) || 0) + 1;
  relayRetries.set(id, attempt);
  const delay = Math.min(30000, 2000 * 2 ** Math.min(attempt - 1, 4));
  const timer = setTimeout(() => {
    relayRetryTimers.delete(id);
    if (!procs.has(id)) return;
    if (relayOwnerBuildId() === relayBuildId(id)) {
      relayRetries.set(id, 0);
      return;
    }
    const fresh = loadAll().find((row) => row.id === id);
    if (!fresh?.publicRelay) return;
    pushLog(id, 'Реле оборвалось, поднимаю адрес заново…');
    void openRelay(fresh).finally(() => {
      if (!procs.has(id)) return;
      if (relayOwnerBuildId() === relayBuildId(id)) {
        relayRetries.set(id, 0);
        return;
      }
      scheduleRelayReconnect(id);
    });
  }, delay);
  relayRetryTimers.set(id, timer);
}

async function openRelay(server: HostedServer): Promise<void> {
  const prev = relayLocks.get(server.id) || Promise.resolve();
  const next = prev
    .catch(() => undefined)
    .then(async () => {
      if (!procs.has(server.id)) return;
      relayOpening.add(server.id);
      try {
      const ready = await ensurePublicAddress(server);
      if (!ready.publicHost || !ready.publicPort) {
        const message = 'Постоянный адрес не выдан: войдите в аккаунт лаунчера.';
        pushLog(server.id, message);
        patchRuntime(server.id, { relayError: message });
        return;
      }
      const res = await startTunnel(ready.port, {
        buildId: relayBuildId(ready.id),
        buildName: ready.name,
        gameVersion: ready.gameVersion,
        loader: ready.software,
        serverName: ready.name,
        serverId: ready.id,
      });
      if (!res.ok || !res.session) {
        const message = res.code === 'no_messenger_session'
          ? 'Публичный адрес не выдан: войдите в мессенджер лаунчера.'
          : `Реле не поднялось: ${res.error || res.code || 'ошибка'}`;
        pushLog(ready.id, message);
        patchRuntime(ready.id, { relayError: message });
        return;
      }
      relayRetries.set(ready.id, 0);
      clearRelayRetry(ready.id);
      const address = `${ready.publicHost}:${ready.publicPort}`;
      pushLog(ready.id, `Публичный адрес: ${address}`);
      patchRuntime(ready.id, { relayError: '' });
      send('hosted-servers:state', viewOf(ready));
      } finally {
        relayOpening.delete(server.id);
      }
    });
  relayLocks.set(server.id, next);
  await next;
}

function attachProcess(server: HostedServer, proc: ChildProcessWithoutNullStreams): void {
  let announced = false;
  const take = (chunk: string) => {
    for (const line of chunk.split(/\n/)) {
      if (!line.trim()) continue;
      pushLog(server.id, line);
      if (!announced && /Done \(/i.test(line)) {
        announced = true;
        patchRuntime(server.id, { status: 'running', error: '' });
        void openDirect(server);
        if (server.publicRelay) {
          void openRelay(server).finally(() => {
            if (procs.has(server.id) && relayOwnerBuildId() !== relayBuildId(server.id)) {
              scheduleRelayReconnect(server.id);
            }
          });
        }
      }
      if (/You need to agree to the EULA/i.test(line)) {
        patchRuntime(server.id, { status: 'error', error: 'Примите EULA в настройках сервера' });
      }
    }
  };
  proc.stdout.setEncoding('utf8');
  proc.stderr.setEncoding('utf8');
  proc.stdout.on('data', take);
  proc.stderr.on('data', take);
  proc.on('exit', (code) => {
    procs.delete(server.id);
    cpuPrev.delete(proc.pid || 0);
    clearRelayRetry(server.id);
    relayRetries.delete(server.id);
    stopUsageTimer();
    const current = runtime.get(server.id);
    const stopping = current?.status === 'stopping';
    patchRuntime(server.id, {
      status: stopping || code === 0 ? 'stopped' : 'error',
      error: stopping || code === 0 ? '' : `Процесс завершился с кодом ${code ?? '?'}`,
      publicHost: '',
      publicPort: 0,
      directHost: '',
      directPort: 0,
      directError: '',
    });
    void unmapTcpPort();
    if (relayOwnerBuildId() === relayBuildId(server.id)) {
      void stopTunnel({ destroyRemote: true, clearPersist: true });
    }
  });
}

function splitJvmArgs(text: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) out.push(match[1] ?? match[2]);
  return out;
}

async function startServer(id: string): Promise<void> {
  const server = loadAll().find((row) => row.id === id);
  if (!server) throw new Error('Сервер не найден');
  if (procs.has(id)) return;
  const other = [...procs.keys()][0];
  if (other && other !== id) throw new Error('Уже запущен другой свой сервер. Остановите его.');
  if (server.port === RESERVED_PORT) throw new Error('Порт 25565 зарезервирован и недоступен');
  if (!server.eulaAccepted) throw new Error('Примите EULA Mojang в настройках сервера');
  const dir = serverDir(id);
  fs.mkdirSync(path.join(dir, 'plugins'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'mods'), { recursive: true });
  if (!coreReady(id)) await installCore(server);
  writeProperties(server);
  writeWhitelist(server);
  fs.writeFileSync(path.join(dir, 'eula.txt'), 'eula=true\n', 'utf8');
  const java = resolveJavaExe(server);
  if (!java) {
    const need = javaMajorFor(server.gameVersion);
    throw new Error(`Для ${server.gameVersion} нужна Java ${need} или новее. Выберите её в настройках сервера.`);
  }
  // На Linux скачанная Java иногда остаётся без бита исполнения, и spawn падает с EACCES.
  if (process.platform !== 'win32' && java !== 'java' && fs.existsSync(java)) {
    try { fs.chmodSync(java, 0o755); } catch { /* spawn сам сообщит, если запуск запрещён */ }
  }
  patchRuntime(id, { status: 'starting', error: '', relayError: '', publicHost: '', publicPort: 0, directHost: '', directPort: 0, directError: '' });
  pushLog(id, `Запуск: ${java}`);
  const userArgs = splitJvmArgs(server.jvmArgs).filter((arg) => !/^-Xms/i.test(arg) && !/^-Xmx/i.test(arg));
  const jvmArgs = [
    `-Xms${Math.min(server.memoryMin, server.memoryMb)}M`,
    `-Xmx${server.memoryMb}M`,
    ...userArgs,
    '-Dfile.encoding=UTF-8',
  ];
  if (process.platform !== 'win32') jvmArgs.push('-Djava.awt.headless=true');
  jvmArgs.push('-jar', 'server.jar', '--nogui');
  let proc: ChildProcessWithoutNullStreams;
  try {
    proc = spawn(
      java,
      jvmArgs,
      { cwd: dir, windowsHide: true },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    patchRuntime(id, { status: 'error', error: message });
    throw err;
  }
  procs.set(id, proc);
  ensureUsageTimer();
  proc.on('error', (err) => {
    procs.delete(id);
    stopUsageTimer();
    const message = /ENOENT/i.test(err.message)
      ? 'Java не найдена. Запустите любую сборку один раз, чтобы лаунчер скачал среду.'
      : err.message;
    pushLog(id, message);
    patchRuntime(id, { status: 'error', error: message });
  });
  attachProcess(server, proc);
}

async function stopServer(id: string): Promise<void> {
  const proc = procs.get(id);
  if (!proc) {
    patchRuntime(id, { status: 'stopped', publicHost: '', publicPort: 0, directHost: '', directPort: 0, directError: '' });
    void unmapTcpPort();
    return;
  }
  patchRuntime(id, { status: 'stopping' });
  pushLog(id, 'Остановка…');
  try {
    proc.stdin.write('stop\n');
  } catch {
    /* stdin уже закрыт */
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 12000);
    proc.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  if (procs.get(id) === proc) {
    try {
      proc.kill();
    } catch {
      /* процесс уже вышел */
    }
  }
  if (relayOwnerBuildId() === relayBuildId(id)) {
    await stopTunnel({ destroyRemote: true, clearPersist: true });
  }
}

function pluginAlreadyOnDisk(dir: string, base: string): boolean {
  const want = base.toLowerCase();
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return false;
  }
  return names.some((name) => {
    const lower = name.toLowerCase();
    return lower === want || lower === `${want}.disabled`;
  });
}

function pluginFileName(filename: string, href: string): string {
  const clean = (value: string) => path.basename(value.split('?')[0] || '').replace(/[^\w.\-]+/g, '_').replace(/^\.+/, '');
  let base = clean(filename);
  if (!/\.(jar|zip)$/i.test(base)) {
    try {
      base = clean(new URL(href).pathname) || base;
    } catch {
      /* имя из ссылки не разобрать */
    }
  }
  if (!/\.(jar|zip)$/i.test(base)) base = `${base || 'plugin'}.jar`;
  return base.slice(0, 120);
}

const HOSTED_TEXT_RE = /\.(txt|cfg|conf|config|properties|json|json5|toml|ya?ml|ini|snbt|xml)$/i;

function assertPluginArchive(dest: string): void {
  const size = fs.statSync(dest).size;
  if (size < 64) throw new Error('Файл скачался пустым');
  const magic = Buffer.alloc(2);
  const fd = fs.openSync(dest, 'r');
  try {
    fs.readSync(fd, magic, 0, 2, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (magic.toString() !== 'PK') throw new Error('Скачанный файл не является jar');
}

function contentDir(id: string): string {
  const server = loadAll().find((row) => row.id === id);
  const mods = ['fabric', 'quilt', 'sponge', 'canvas', 'arclight', 'youer', 'banner', 'divinemc'];
  if (server && mods.includes(server.software)) return path.join(serverDir(id), 'mods');
  if (server?.software === 'vanilla') return path.join(serverDir(id), server.levelName || 'world', 'datapacks');
  return path.join(serverDir(id), 'plugins');
}

function safeChild(id: string, rel: string): string {
  const root = path.resolve(serverDir(id));
  const target = path.resolve(root, rel || '.');
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error('Неверный путь');
  return target;
}

function unquoteYaml(value: string): string {
  const text = value.trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) return text.slice(1, -1);
  return text;
}

function pluginCommandsFromYaml(text: string): Array<{ name: string; description: string; usage: string; aliases: string[] }> {
  const lines = text.split(/\r?\n/);
  let inCommands = false;
  let nameIndent = -1;
  const out: Array<{ name: string; description: string; usage: string; aliases: string[] }> = [];
  let current: { name: string; description: string; usage: string; aliases: string[] } | null = null;
  for (const raw of lines) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const indent = raw.match(/^ */)?.[0].length ?? 0;
    const body = raw.trim();
    if (!inCommands) {
      if (indent === 0 && body === 'commands:') inCommands = true;
      continue;
    }
    if (indent === 0) break;
    if (nameIndent < 0) nameIndent = indent;
    if (indent === nameIndent && body.endsWith(':')) {
      current = { name: unquoteYaml(body.slice(0, -1)), description: '', usage: '', aliases: [] };
      if (current.name) out.push(current);
      continue;
    }
    if (!current || indent <= nameIndent) continue;
    const description = body.match(/^description:\s*(.*)$/);
    const usage = body.match(/^usage:\s*(.*)$/);
    const aliases = body.match(/^aliases:\s*(.*)$/);
    if (description) current.description = unquoteYaml(description[1]);
    if (usage) current.usage = unquoteYaml(usage[1]);
    if (aliases) {
      current.aliases = aliases[1].replace(/^\[|\]$/g, '').split(/[,\s]+/).map((part) => unquoteYaml(part)).filter(Boolean);
    }
  }
  return out;
}

function commandsInJar(file: string): Array<{ name: string; description: string; usage: string; aliases: string[] }> {
  try {
    const zip = new AdmZip(file);
    const entry = zip.getEntry('plugin.yml') || zip.getEntry('paper-plugin.yml');
    if (!entry) return [];
    return pluginCommandsFromYaml(entry.getData().toString('utf8'));
  } catch {
    return [];
  }
}

function listPlugins(id: string): Array<{ name: string; enabled: boolean; size: number; commands: Array<{ name: string; description: string; usage: string; aliases: string[] }> }> {
  const dir = contentDir(id);
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => /\.(jar|zip)(\.disabled)?$/i.test(name))
      .map((name) => {
        const enabled = !name.endsWith('.disabled');
        const file = path.join(dir, name);
        const size = fs.statSync(file).size;
        return {
          name: enabled ? name : name.replace(/\.disabled$/, ''),
          enabled,
          size,
          commands: enabled ? commandsInJar(file) : [],
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export function stopHostedServersOnQuit(): void {
  for (const [id, proc] of procs) {
    try {
      proc.kill();
    } catch {
      /* уже завершился */
    }
    procs.delete(id);
    if (relayOwnerBuildId() === relayBuildId(id)) {
      void stopTunnel({ destroyRemote: true, clearPersist: true });
    }
  }
  stopUsageTimer();
}

export function registerHostedServersIpc(): void {
  fs.mkdirSync(rootDir(), { recursive: true });
  setRelayDropHandler((buildId) => {
    if (!buildId.startsWith('hosted:')) return;
    const id = buildId.slice('hosted:'.length);
    if (!procs.has(id)) return;
    scheduleRelayReconnect(id);
  });
  setInterval(() => {
    for (const id of procs.keys()) {
      const run = runtime.get(id);
      if (run?.status !== 'running') continue;
      if (relayOwnerBuildId() === relayBuildId(id)) continue;
      scheduleRelayReconnect(id);
    }
  }, 15000);

  ipcMain.handle('hosted-servers:list', async () => {
    const list = loadAll();
    const next: HostedServer[] = [];
    let changed = false;
    for (const row of list) {
      if (row.publicHost && row.publicPort > 0) {
        next.push(row);
        continue;
      }
      const reserved = await ensurePublicAddress(row);
      changed = changed || reserved.publicHost !== row.publicHost;
      next.push(reserved.publicHost ? reserved : row);
    }
    if (changed) saveAll(next);
    return next.map(viewOf);
  });

  ipcMain.handle('hosted-servers:create', async () => {
    const server = normalize({}, undefined);
    server.id = `hs${crypto.randomBytes(5).toString('hex')}`;
    server.createdAt = Date.now();
    const list = loadAll();
    server.port = nextFreePort(list);
    list.unshift(server);
    saveAll(list);
    fs.mkdirSync(path.join(serverDir(server.id), 'plugins'), { recursive: true });
    const ready = await ensurePublicAddress(server);
    return viewOf(ready);
  });

  ipcMain.handle('hosted-servers:update', (_e, id: string, patch: Partial<HostedServer>) => {
    const list = loadAll();
    const index = list.findIndex((row) => row.id === String(id || ''));
    if (index < 0) return { ok: false, error: 'Сервер не найден' };
    if (Number(patch?.port) === RESERVED_PORT) {
      return { ok: false, error: 'Порт 25565 зарезервирован и недоступен' };
    }
    const next = normalize(patch, list[index]);
    if (list.some((row) => row.id !== next.id && row.port === next.port)) {
      return { ok: false, error: 'Этот порт уже занят другим своим сервером' };
    }
    list[index] = next;
    saveAll(list);
    send('hosted-servers:state', viewOf(list[index]));
    return { ok: true, server: viewOf(list[index]) };
  });

  ipcMain.handle('hosted-servers:delete', async (_e, id: string) => {
    const safe = String(id || '');
    if (procs.has(safe)) await stopServer(safe);
    await releaseHostedAddress(safe);
    const list = loadAll().filter((row) => row.id !== safe);
    saveAll(list);
    logs.delete(safe);
    runtime.delete(safe);
    try {
      fs.rmSync(serverDir(safe), { recursive: true, force: true });
    } catch {
      /* каталог уже удалён */
    }
    return { ok: true };
  });

  ipcMain.handle('hosted-servers:start', async (_e, id: string) => {
    try {
      await startServer(String(id || ''));
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      patchRuntime(String(id || ''), { status: 'error', error: message });
      return { ok: false, error: message };
    }
  });

  ipcMain.handle('hosted-servers:stop', async (_e, id: string) => {
    await stopServer(String(id || ''));
    return { ok: true };
  });

  ipcMain.handle('hosted-servers:command', (_e, id: string, command: string) => {
    const proc = procs.get(String(id || ''));
    const text = String(command || '').replace(/[\r\n]+/g, ' ').trim();
    if (!proc || !text) return { ok: false, error: 'Сервер не запущен' };
    proc.stdin.write(`${text}\n`);
    pushLog(String(id), `> ${text}`);
    return { ok: true };
  });

  ipcMain.handle('hosted-servers:log', (_e, id: string) => logs.get(String(id || '')) || []);

  ipcMain.handle('hosted-servers:plugins', (_e, id: string) => listPlugins(String(id || '')));

  ipcMain.handle('hosted-servers:plugin-add', async (_e, id: string) => {
    const safe = String(id || '');
    const dir = contentDir(safe);
    fs.mkdirSync(dir, { recursive: true });
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const opts = {
      title: 'Плагин или мод',
      filters: [{ name: 'Jar', extensions: ['jar'] }],
      properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>,
    };
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (result.canceled) return { ok: true, plugins: listPlugins(safe) };
    for (const file of result.filePaths) {
      const base = path.basename(file);
      if (!base.toLowerCase().endsWith('.jar')) continue;
      fs.copyFileSync(file, path.join(dir, base));
    }
    return { ok: true, plugins: listPlugins(safe) };
  });

  ipcMain.handle('hosted-servers:plugin-toggle', (_e, id: string, name: string) => {
    const safeName = path.basename(String(name || ''));
    const dir = contentDir(String(id || ''));
    const enabled = path.join(dir, safeName);
    const disabled = path.join(dir, `${safeName}.disabled`);
    if (fs.existsSync(enabled)) fs.renameSync(enabled, disabled);
    else if (fs.existsSync(disabled)) fs.renameSync(disabled, enabled);
    return listPlugins(String(id || ''));
  });

  ipcMain.handle('hosted-servers:plugin-remove', (_e, id: string, name: string) => {
    const safeName = path.basename(String(name || ''));
    const dir = contentDir(String(id || ''));
    fs.rmSync(path.join(dir, safeName), { force: true });
    fs.rmSync(path.join(dir, `${safeName}.disabled`), { force: true });
    return listPlugins(String(id || ''));
  });

  ipcMain.handle('hosted-servers:versions', async (_e, software: string) => {
    try {
      const versions = await listVersions(asSoftware(software));
      return { ok: true, versions };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), versions: [] as string[] };
    }
  });

  ipcMain.handle('hosted-servers:install-core', async (_e, id: string) => {
    const server = loadAll().find((row) => row.id === String(id || ''));
    if (!server) return { ok: false, error: 'Сервер не найден' };
    try {
      await installCore(server);
      return { ok: true, server: viewOf(server) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('hosted-servers:open-dir', async (_e, id: string) => {
    const dir = serverDir(String(id || ''));
    fs.mkdirSync(dir, { recursive: true });
    await shell.openPath(dir);
    return { ok: true };
  });

  ipcMain.handle('hosted-servers:set-icon', (_e, id: string, dataUrl: string) => {
    const match = String(dataUrl || '').match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
    if (!match) return { ok: false, error: 'Нужна картинка PNG' };
    const buf = Buffer.from(match[1], 'base64');
    if (!buf.length || buf.length > 512_000) return { ok: false, error: 'Слишком большой файл' };
    const dir = serverDir(String(id || ''));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'server-icon.png'), buf);
    const server = loadAll().find((row) => row.id === String(id || ''));
    return { ok: true, server: server ? viewOf(server) : null };
  });

  ipcMain.handle('hosted-servers:files', (_e, id: string, rel: string) => {
    try {
      const dir = safeChild(String(id || ''), String(rel || ''));
      const entries = fs.readdirSync(dir, { withFileTypes: true }).map((entry) => ({
        name: entry.name,
        dir: entry.isDirectory(),
        size: entry.isDirectory() ? 0 : fs.statSync(path.join(dir, entry.name)).size,
      }));
      entries.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
      return { ok: true, entries };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), entries: [] };
    }
  });

  ipcMain.handle('hosted-servers:file-import', async (_e, id: string, rel: string) => {
    try {
      const dir = safeChild(String(id || ''), String(rel || ''));
      fs.mkdirSync(dir, { recursive: true });
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      const opts = {
        title: 'Файл сервера',
        properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>,
      };
      const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      if (result.canceled) return { ok: true };
      for (const file of result.filePaths) {
        fs.copyFileSync(file, path.join(dir, path.basename(file)));
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('hosted-servers:file-delete', (_e, id: string, rel: string) => {
    try {
      const target = safeChild(String(id || ''), String(rel || ''));
      const root = path.resolve(serverDir(String(id || '')));
      if (target === root) return { ok: false, error: 'Нельзя удалить корень сервера' };
      fs.rmSync(target, { recursive: true, force: true });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('hosted-servers:file-transfer', (_e, id: string, mode: string, rels: string[], destRel: string) => {
    try {
      const dest = safeChild(String(id || ''), String(destRel || ''));
      fs.mkdirSync(dest, { recursive: true });
      const list = Array.isArray(rels) ? rels.map((item) => String(item || '')).filter(Boolean) : [];
      for (const rel of list) {
        const src = safeChild(String(id || ''), rel);
        const name = path.basename(src);
        const target = path.join(dest, name);
        const srcResolved = path.resolve(src);
        const targetResolved = path.resolve(target);
        if (targetResolved === srcResolved || targetResolved.startsWith(srcResolved + path.sep)) continue;
        if (mode === 'move') fs.renameSync(src, target);
        else fs.cpSync(src, target, { recursive: true });
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('hosted-servers:install-url', async (_e, id: string, url: string, filename: string) => {
    return installPluginFromUrl(String(id || ''), String(url || ''), String(filename || ''));
  });
}

async function installPluginFromUrl(id: string, url: string, filename: string): Promise<unknown> {
  const href = String(url || '');
  if (!/^https:\/\//i.test(href)) return { ok: false, error: 'Нужна ссылка https' };
  const base = pluginFileName(filename, href);
  const dir = contentDir(id);
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, base);
  const taskId = `plugin-${id}-${base}`;
  if (pluginAlreadyOnDisk(dir, base)) return { ok: true, already: true };
  const report = (received: number, total: number) => {
    send('hosted-servers:plugin-progress', { id: taskId, filename: base, received, total });
  };
  try {
    armDownloads();
    await downloadModrinthFile(href, dest, { reason: 'standalone', onProgress: report });
    assertPluginArchive(dest);
    send('hosted-servers:plugin-progress', { id: taskId, filename: base, received: 1, total: 1, done: true });
    return { ok: true, plugins: listPlugins(id) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (pluginAlreadyOnDisk(dir, base) && /EPERM|EEXIST|EBUSY|EACCES/i.test(message)) {
      send('hosted-servers:plugin-progress', { id: taskId, filename: base, clear: true });
      return { ok: true, already: true };
    }
    try {
      fs.rmSync(dest, { force: true });
    } catch {
      /* частичный файл уже удалён */
    }
    send('hosted-servers:plugin-progress', { id: taskId, filename: base, error: message });
    return { ok: false, error: message };
  }
}

function findHostedConfigs(id: string, query: string): string[] {
  const needle = query.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const skip = new Set(['libraries', 'versions', 'cache', 'logs', '.cache', 'crash-reports']);
  const found: string[] = [];
  const walk = (dir: string, rel: string, depth: number) => {
    if (depth > 5 || found.length >= 60) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= 60 || skip.has(entry.name)) continue;
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), child, depth + 1);
        continue;
      }
      if (!HOSTED_TEXT_RE.test(entry.name)) continue;
      const flat = child.toLowerCase().replace(/[^a-z0-9]+/g, '');
      if (!needle || flat.includes(needle)) found.push(child);
    }
  };
  for (const rel of ['plugins', 'config', 'mods']) walk(path.join(serverDir(id), rel), rel, 0);
  return found;
}

function agentServerView(server: HostedServer) {
  const view = viewOf(server);
  return {
    id: view.id,
    name: view.name,
    software: view.software,
    gameVersion: view.gameVersion,
    port: view.port,
    memoryMb: view.memoryMb,
    motd: view.motd,
    maxPlayers: view.maxPlayers,
    gamemode: view.gamemode,
    difficulty: view.difficulty,
    onlineMode: view.onlineMode,
    eulaAccepted: view.eulaAccepted,
    publicHost: view.publicHost,
    publicPort: view.publicPort,
    status: view.status,
    error: view.error,
    coreReady: view.coreReady,
    levelName: view.levelName,
  };
}

function readHostedText(id: string, rel: string): { ok: boolean; text?: string; error?: string } {
  try {
    const target = safeChild(id, rel);
    const stat = fs.statSync(target);
    if (!stat.isFile()) return { ok: false, error: 'Это папка' };
    if (!HOSTED_TEXT_RE.test(target)) return { ok: false, error: 'Можно читать только текстовые конфиги' };
    if (stat.size > 256_000) return { ok: false, error: 'Файл слишком большой' };
    return { ok: true, text: fs.readFileSync(target, 'utf8') };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function writeHostedText(id: string, rel: string, text: string): { ok: boolean; error?: string } {
  try {
    if (!HOSTED_TEXT_RE.test(rel)) return { ok: false, error: 'Можно писать только текстовые конфиги' };
    if (text.length > 256_000) return { ok: false, error: 'Текст слишком большой' };
    const target = safeChild(id, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text, 'utf8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Действия агента над своими серверами. UI получает те же события состояния, что и вкладка. */
export async function agentHostedAction(action: string, payload: Record<string, unknown> = {}): Promise<unknown> {
  if (typeof payload.software === 'string') payload.software = payload.software.toLowerCase();
  const id = String(payload.id || '');
  if (action === 'list') {
    return { ok: true, servers: loadAll().map(agentServerView) };
  }
  if (action === 'create') {
    const server = normalize(payload, undefined);
    server.id = `hs${crypto.randomBytes(5).toString('hex')}`;
    server.createdAt = Date.now();
    const list = loadAll();
    server.port = nextFreePort(list);
    list.unshift(server);
    saveAll(list);
    fs.mkdirSync(path.join(serverDir(server.id), 'plugins'), { recursive: true });
    const ready = await ensurePublicAddress(server);
    return { ok: true, server: agentServerView(ready) };
  }
  if (action === 'update') {
    const list = loadAll();
    const index = list.findIndex((row) => row.id === id);
    if (index < 0) return { ok: false, error: 'Сервер не найден' };
    const next = normalize(payload, list[index]);
    if (list.some((row) => row.id !== next.id && row.port === next.port)) {
      return { ok: false, error: 'Этот порт уже занят другим своим сервером' };
    }
    list[index] = next;
    saveAll(list);
    send('hosted-servers:state', viewOf(list[index]));
    return { ok: true, server: agentServerView(list[index]) };
  }
  if (action === 'start') {
    try {
      await startServer(id);
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      patchRuntime(id, { status: 'error', error: message });
      return { ok: false, error: message };
    }
  }
  if (action === 'stop') {
    await stopServer(id);
    return { ok: true };
  }
  if (action === 'restart') {
    await stopServer(id);
    const deadline = Date.now() + 4000;
    while (procs.has(id) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    if (procs.has(id)) {
      try {
        procs.get(id)?.kill();
      } catch {
        /* процесс уже вышел */
      }
      procs.delete(id);
    }
    try {
      await startServer(id);
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  }
  if (action === 'command') {
    const proc = procs.get(id);
    const text = String(payload.command || '').replace(/[\r\n]+/g, ' ').trim();
    if (!proc || !text) return { ok: false, error: 'Сервер не запущен' };
    proc.stdin.write(`${text}\n`);
    pushLog(id, `> ${text}`);
    return { ok: true };
  }
  if (action === 'log') {
    const lines = logs.get(id) || [];
    return { ok: true, lines: lines.slice(-80) };
  }
  if (action === 'plugins') return { ok: true, plugins: listPlugins(id) };
  if (action === 'plugin-toggle') {
    const safeName = path.basename(String(payload.name || ''));
    const dir = contentDir(id);
    const enabled = path.join(dir, safeName);
    const disabled = path.join(dir, `${safeName}.disabled`);
    if (fs.existsSync(enabled)) fs.renameSync(enabled, disabled);
    else if (fs.existsSync(disabled)) fs.renameSync(disabled, enabled);
    else return { ok: false, error: 'Плагин не найден' };
    return { ok: true, plugins: listPlugins(id) };
  }
  if (action === 'install-url') {
    return installPluginFromUrl(id, String(payload.url || ''), String(payload.filename || ''));
  }
  if (action === 'versions') {
    try {
      const versions = await listVersions(asSoftware(String(payload.software || 'paper')));
      return { ok: true, versions };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), versions: [] };
    }
  }
  if (action === 'install-core') {
    const server = loadAll().find((row) => row.id === id);
    if (!server) return { ok: false, error: 'Сервер не найден' };
    try {
      await installCore(server);
      return { ok: true, server: agentServerView(server) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
  if (action === 'files') {
    try {
      const dir = safeChild(id, String(payload.path || ''));
      const entries = fs.readdirSync(dir, { withFileTypes: true }).map((entry) => ({
        name: entry.name,
        dir: entry.isDirectory(),
        size: entry.isDirectory() ? 0 : fs.statSync(path.join(dir, entry.name)).size,
      }));
      entries.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
      return { ok: true, entries };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), entries: [] };
    }
  }
  if (action === 'find-files') return { ok: true, files: findHostedConfigs(id, String(payload.query || '')) };
  if (action === 'read-file') return readHostedText(id, String(payload.path || ''));
  if (action === 'write-file') return writeHostedText(id, String(payload.path || ''), String(payload.text ?? ''));
  return { ok: false, error: 'unknown_action' };
}
