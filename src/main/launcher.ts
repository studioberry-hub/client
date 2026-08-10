import type { Config } from 'eml-lib';
import { BrowserWindow, ipcMain, dialog, nativeImage } from 'electron';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import * as zlib from 'zlib';
import { execSync } from 'child_process';
import {
  downloadModrinthFile,
  runWithConcurrency,
  PROXY_MAX_CONCURRENT_DOWNLOADS,
} from './modrinthDownload';
import { skinImageUrl, skinProfileUrl } from '../shared/apiBase';

// ===== Ленивая загрузка тяжёлых зависимостей =====
// require этих пакетов стоит заметного времени (discord-rpc ~200 мс,
// prismarine-nbt ~100 мс, minecraft-server-util ~20 мс) и раньше выполнялся при
// импорте модуля, то есть до создания окна. На старте ни один из них не нужен:
// Discord RPC подключается отложенно, NBT читается при открытии списков миров и
// серверов, пинг — по запросу вкладки серверов.
let rpcModule: typeof import('discord-rpc') | null = null;
function rpcLib(): typeof import('discord-rpc') {
  if (!rpcModule) rpcModule = require('discord-rpc') as typeof import('discord-rpc');
  return rpcModule;
}

let nbtModule: typeof import('prismarine-nbt') | null = null;
function nbtLib(): typeof import('prismarine-nbt') {
  if (!nbtModule) nbtModule = require('prismarine-nbt') as typeof import('prismarine-nbt');
  return nbtModule;
}

let msuModule: typeof import('minecraft-server-util') | null = null;
function msuLib(): typeof import('minecraft-server-util') {
  if (!msuModule) msuModule = require('minecraft-server-util') as typeof import('minecraft-server-util');
  return msuModule;
}

type ProgressSink = (data: any) => void;
const progressSinks: ProgressSink[] = [];

export function addProgressSink(sink: ProgressSink): void {
  progressSinks.push(sink);
}

let launcherInstance: any = null;
let launchInProgress = false;
let discordClient: any = null;
let discordConnectPromise: Promise<void> | null = null;
let discordRpcEnabled = true;
let currentUiScreen = 'home';
let currentAccountInfo: { name: string; avatar: string } | null = null;

function logPhase(name: string): void {
  console.log(`[phase] ${name} @ ${new Date().toISOString().slice(11, 23)}`);
}

const DISCORD_CLIENT_ID = '1532393186591375390'; // Undefined Client Discord App
const DISCORD_LARGE_IMAGE = 'logo'; // ключ арта, загруженного в Rich Presence приложения
let rpcLang: string = 'ru';
let currentPresence: { name: string; gameVersion: string; loader: string } | null = null;
// Начало отсчёта времени в презенсе. Обновляется только при смене сборки, иначе
// каждый переход по вкладкам сбрасывал бы таймер «в игре» на ноль.
let presenceStartedAt = Date.now();

/* ===== Ely.by OAuth2 ===== */
const ELY_CLIENT_ID = 'uclient';
const ELY_CLIENT_SECRET = 'KPapApmB4JpjLQ63b_LzZ_PVrGKNEJeu8mGe1NZHxAQpGssI039iZmvZjnmAxZX3';
const ELY_REDIRECT_URI = 'http://127.0.0.1:29123/oauth2/ely';
const ELY_AUTHORIZE_URL = 'https://account.ely.by/oauth2/v1';
const ELY_TOKEN_URL = 'https://account.ely.by/api/oauth2/v1/token';
const ELY_INFO_URL = 'https://account.ely.by/api/account/v1/info';
const ELY_AUTH_SERVER = 'https://authserver.ely.by';
const ELY_SCOPES = 'account_info offline_access minecraft_server_session';

const RPC_TEXT: Record<string, { tg: string; vanilla: string; build: string; screens: Record<string, string> }> = {
  ru: {
    tg: 'Перейти в Telegram проекта',
    vanilla: 'Ванилла',
    build: 'Сборка',
    screens: { home: 'В главной', builds: 'В сборках', mods: 'В каталоге модов', servers: 'На серверах', skins: 'В скинах', settings: 'В настройках', about: 'О программе', console: 'В логе загрузки' },
  },
  en: {
    tg: 'Project Telegram',
    vanilla: 'Vanilla',
    build: 'Build',
    screens: { home: 'On the main screen', builds: 'In builds', mods: 'In the mod catalog', servers: 'On servers', skins: 'In skins', settings: 'In settings', about: 'About the program', console: 'In the launch log' },
  },
  tt: {
    tg: "Проект Telegram'ына күчү",
    vanilla: 'Ванилла',
    build: 'Сборка',
    screens: { home: 'Баш биттә', builds: 'Сборкаларда', mods: 'Модлар каталогында', servers: 'Серверларда', skins: 'Скиннарда', settings: 'Көйләнмәләрдә', about: 'Программа турында', console: 'Йөкләү журналында' },
  },
  kk: {
    tg: 'Жобаның Telegram-ына өту',
    vanilla: 'Ванилла',
    build: 'Жинақ',
    screens: { home: 'Бас бетте', builds: 'Жинақтарда', mods: 'Модтар каталогында', servers: 'Серверлерде', skins: 'Скиндерде', settings: 'Баптауларда', about: 'Бағдарлама туралы', console: 'Жүктеу журналында' },
  },
  uk: {
    tg: 'Перейти у Telegram проєкту',
    vanilla: 'Ванілла',
    build: 'Збірка',
    screens: { home: 'На головній', builds: 'У збірках', mods: 'У каталозі модів', servers: 'На серверах', skins: 'У скінах', settings: 'У налаштуваннях', about: 'Про програму', console: 'У лозі завантаження' },
  },
};

/**
 * Подключение к Discord. Промис кэшируется, чтобы его могли дождаться те, кому
 * нужен готовый клиент. Неудачная попытка не запоминается: Discord мог быть ещё
 * не запущен, и следующий запрос презенса обязан попробовать снова.
 */
function initDiscordRPC(): Promise<void> {
  if (!discordConnectPromise) discordConnectPromise = connectDiscordRPC();
  return discordConnectPromise;
}

async function connectDiscordRPC(): Promise<void> {
  if (discordClient) return;
  try {
    discordClient = new (rpcLib().Client)({ transport: 'ipc' });
    discordClient.on('ready', () => {
      console.log('Discord RPC connected');
      sendDiscordPresence();
    });
    discordClient.on('disconnected', () => {
      discordClient = null;
      discordConnectPromise = null;
    });
    await discordClient.login({ clientId: DISCORD_CLIENT_ID });
  } catch (err) {
    console.log('Discord RPC connection failed:', err);
    discordClient = null;
    discordConnectPromise = null;
  }
}

function sendDiscordPresence(): void {
  if (!discordClient || !discordClient.user) return;
  const rpcText = RPC_TEXT[rpcLang] || RPC_TEXT.ru;
  const accountName = currentAccountInfo?.name;
  // discord-rpc берёт поля картинок с верхнего уровня объекта (largeImageKey,
  // largeImageText, smallImageKey, smallImageText) и полностью игнорирует
  // вложенный assets. Ключ большой картинки задаём всегда: подпись без самой
  // картинки даёт невалидную активность, и Discord её не отображает.
  const presence: any = {
    details: accountName || 'Undefined Client',
    largeImageKey: DISCORD_LARGE_IMAGE,
    largeImageText: 'Undefined Client',
    startTimestamp: presenceStartedAt,
    buttons: [{ label: rpcText.tg, url: 'https://t.me/undefinedlauncher' }],
  };
  if (currentAccountInfo?.avatar) {
    presence.smallImageKey = currentAccountInfo.avatar;
    presence.smallImageText = accountName;
  }
  if (currentPresence) {
    const loaderLabel = currentPresence.loader === 'vanilla' ? rpcText.vanilla : currentPresence.loader.charAt(0).toUpperCase() + currentPresence.loader.slice(1);
    presence.state = currentPresence.name;
    presence.largeImageText = `${currentPresence.gameVersion} - ${loaderLabel}`;
  } else {
    presence.state = rpcText.screens[currentUiScreen] || rpcText.screens.home;
  }
  discordClient.setActivity(presence, process.pid)
    .then(() => console.log('Discord presence set'))
    .catch((e: any) => console.log('Discord setActivity error:', e));
}

function setDiscordPresence(build: { name: string; gameVersion: string; loader: string } | null): void {
  if ((currentPresence?.name ?? null) !== (build?.name ?? null)) presenceStartedAt = Date.now();
  currentPresence = build;
  if (discordClient?.user) {
    sendDiscordPresence();
    return;
  }
  // Игра могла стартовать раньше, чем поднялось отложенное соединение с Discord.
  // Дожидаемся подключения и только потом отправляем презенс, иначе название
  // сборки просто не дойдёт до Discord.
  if (discordRpcEnabled) void initDiscordRPC().then(() => sendDiscordPresence());
}

const LOADER_VERSIONS: Record<string, string> = {
  fabric: '0.16.10',
  forge: '52.0.16',
  neoforge: '21.4.77-beta',
  quilt: '0.28.0',
};

async function loadEML(): Promise<typeof import('eml-lib')> {
  return eval('import("eml-lib")') as Promise<typeof import('eml-lib')>;
}

let downloaderPatched = false;
let skipServerDownloads = false;

function usesQuickPlay(gameVersion: string): boolean {
  if (gameVersion.startsWith('1.20') || gameVersion.startsWith('1.21')) return true;
  const hidden = /^(2[3-9]|post)/.test(gameVersion); // snapshot 23w14a+ era
  if (hidden) return true;
  return false;
}

/**
 * Патч применяется один раз; промис кэшируется, чтобы запуск игры мог его
 * дождаться, даже если патч ещё выполняется после отложенного старта.
 */
let downloaderPatchPromise: Promise<void> | null = null;
function ensureDownloaderPatched(): Promise<void> {
  if (!downloaderPatchPromise) downloaderPatchPromise = patchDownloaderVerification();
  return downloaderPatchPromise;
}

async function patchDownloaderVerification(): Promise<void> {
  if (downloaderPatched) return;
  downloaderPatched = true;
  try {
    const mod = await (eval('import("eml-lib/lib/utils/downloader.js")') as Promise<any>);
    const Downloader = mod?.default || mod?.Downloader;
    if (!Downloader || !Downloader.prototype) return;
    const orig = Downloader.prototype.getFilesToDownload;
    if (typeof orig !== 'function') return;

    Downloader.prototype.getFilesToDownload = async function (files: any[]) {
      if (skipServerDownloads) return [];
      const dest = String(this.dest || '');
      const cachePath = path.join(dest, 'eml-verify-cache.json');
      let cache: Record<string, { mtime: number; size: number; sha1: string }> = {};
      try {
        if (fs.existsSync(cachePath)) cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      } catch {}

      const results: any[] = [];
      const queue = [...files];
      let idx = 0;
      const workerCount = 8;
      const workers = Array.from({ length: workerCount }, async () => {
        while (idx < queue.length) {
          const file = queue[idx++];
          if (!file) continue;
          const filePath = path.join(dest, file.path || '', file.name || '');
          const relative = path.relative(dest, filePath);
          const isSafe = relative && !relative.startsWith('..') && !path.isAbsolute(relative);
          if (!isSafe) {
            this.emit('download_error', { filename: file.name, type: file.type, message: 'Unsafe file path detected, skipping.' });
            continue;
          }
          if (file.type === 'FOLDER') {
            try { await fs.promises.access(filePath); } catch { await fs.promises.mkdir(filePath, { recursive: true }); }
            continue;
          }
          let needsDownload = false;
          try {
            await fs.promises.access(filePath);
            const stat = await fs.promises.stat(filePath);
            const key = relative.replace(/\\/g, '/');
            let sha1 = '';
            const entry = cache[key];
            if (file.sha1) {
              if (entry && entry.size === stat.size && entry.mtime === stat.mtimeMs) {
                sha1 = entry.sha1;
              } else {
                sha1 = await getFileSha1(filePath);
                cache[key] = { mtime: stat.mtimeMs, size: stat.size, sha1 };
              }
              if (sha1 !== file.sha1) needsDownload = true;
            }
          } catch { needsDownload = true; }
          if (needsDownload && file.url) results.push(file);
        }
      });
      await Promise.all(workers);
      try { fs.writeFileSync(cachePath, JSON.stringify(cache)); } catch {}
      return results;
    };
  } catch { /* patch failed, fall back to original behaviour */ }
}

function getFileSha1(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (d) => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

const manifestCacheDir = path.join(process.env.APPDATA || process.cwd(), '.Undefined Client', 'manifest-cache');
const MANIFEST_CACHE_TTL = 30 * 60 * 1000;

async function fetchJsonCached(url: string, ttlMs: number = MANIFEST_CACHE_TTL): Promise<any> {
  const key = crypto.createHash('sha1').update(url).digest('hex') + '.json';
  const file = path.join(manifestCacheDir, key);
  try {
    if (fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < ttlMs) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch {}
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  try {
    if (!fs.existsSync(manifestCacheDir)) fs.mkdirSync(manifestCacheDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data));
  } catch {}
  return data;
}

let emlCachePatched = false;

async function patchEMLCache(): Promise<void> {
  if (emlCachePatched) return;
  emlCachePatched = true;
  try {
    const [manifestsMod, filesMod] = await Promise.all([
      eval('import("eml-lib/lib/utils/manifests.js")') as Promise<any>,
      eval('import("eml-lib/lib/launcher/filesmanager.js")') as Promise<any>,
    ]);
    const Manifests = manifestsMod?.default || manifestsMod?.Manifests;
    if (Manifests && Manifests.prototype) {
      const origUrl = Manifests.prototype.getMinecraftManifestUrl;
      if (typeof origUrl === 'function') {
        Manifests.prototype.getMinecraftManifestUrl = async function (minecraftVersion: string) {
          try {
            const data = await fetchJsonCached('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
            const resolved = minecraftVersion === 'latest_release'
              ? data.latest?.release
              : minecraftVersion === 'latest_snapshot' ? data.latest?.snapshot : minecraftVersion || 'latest_release';
            const entry = data.versions?.find((v: any) => v.id === resolved);
            if (entry?.url) return entry.url;
          } catch {}
          return origUrl.call(this, minecraftVersion);
        };
      }
      const origManifest = Manifests.prototype.getMinecraftManifest;
      if (typeof origManifest === 'function') {
        Manifests.prototype.getMinecraftManifest = async function (config: any, loader: any) {
          try {
            const url = await this.getMinecraftManifestUrl(config.minecraft.version ?? loader?.minecraftVersion);
            return await fetchJsonCached(url, 12 * 60 * 60 * 1000);
          } catch {}
          return origManifest.call(this, config, loader);
        };
      }
    }
    const FilesManager = filesMod?.default || filesMod?.FilesManager;
    if (FilesManager && FilesManager.prototype && typeof FilesManager.prototype.getAssets === 'function') {
      const origGetAssets = FilesManager.prototype.getAssets;
      FilesManager.prototype.getAssets = async function () {
        try {
          const localFile = path.join(String(this.config?.root || ''), 'assets', 'indexes', `${this.manifest?.assets ?? ''}.json`);
          if (fs.existsSync(localFile)) {
            const data = JSON.parse(fs.readFileSync(localFile, 'utf8'));
            const assets: any[] = [];
            Object.values(data.objects || {}).forEach((asset: any) => {
              assets.push({
                name: asset.hash,
                path: path.join('assets', 'objects', asset.hash.substring(0, 2), '/'),
                url: `https://resources.download.minecraft.net/${asset.hash.substring(0, 2)}/${asset.hash}`,
                sha1: asset.hash,
                size: asset.size,
                type: 'ASSET',
              });
            });
            return { assets, files: [{ name: `${this.manifest.assets}.json`, path: path.join('assets', 'indexes', '/'), url: '', type: 'OTHER' }, ...assets] };
          }
        } catch {}
        return origGetAssets.call(this);
      };
      const origGetJava = FilesManager.prototype.getJava;
      if (typeof origGetJava === 'function') {
        FilesManager.prototype.getJava = async function () {
          if (String(this.config?.java?.install) === 'manual') {
            return { java: [], files: [] };
          }
          return origGetJava.call(this);
        };
      }
      const origExtractNatives = FilesManager.prototype.extractNatives;
      if (typeof origExtractNatives === 'function') {
        FilesManager.prototype.extractNatives = async function (libraries: any[]) {
          try {
            const natives = (libraries || []).filter((lib: any) => lib.type === 'NATIVE');
            const nativesFolder = path.join(String(this.config?.root || ''), 'bin', String(this.manifest?.id ?? ''));
            const marker = path.join(nativesFolder, '.native-cache.json');
            if (natives.length > 0 && fs.existsSync(marker) && fs.existsSync(nativesFolder)) {
              const entry: Record<string, any> = {};
              try { Object.assign(entry, JSON.parse(fs.readFileSync(marker, 'utf8'))); } catch {}
              const hit = natives.every((lib: any) => {
                const zipPath = path.join(String(this.config?.root || ''), lib.path || '', lib.name || '');
                let st;
                try { st = fs.statSync(zipPath); } catch { return false; }
                return entry[path.relative(String(this.config?.root || ''), zipPath)] === st.mtimeMs;
              });
              const anyFile = fs.readdirSync(nativesFolder).some((f: string) => f.endsWith('.dll') || f.endsWith('.so') || f.endsWith('.dylib') || f === '.native-cache.json');
              if (hit) return { files: [] };
            }
          } catch {}
          const result = await origExtractNatives.call(this, libraries);
          try {
            const natives = (libraries || []).filter((lib: any) => lib.type === 'NATIVE');
            if (natives.length > 0) {
              const nativesFolder = path.join(String(this.config?.root || ''), 'bin', String(this.manifest?.id ?? ''));
              if (fs.existsSync(nativesFolder)) {
                const marker: Record<string, any> = {};
                natives.forEach((lib: any) => {
                  const zipPath = path.join(String(this.config?.root || ''), lib.path || '', lib.name || '');
                  try { marker[path.relative(String(this.config?.root || ''), zipPath)] = fs.statSync(zipPath).mtimeMs; } catch {}
                });
                fs.writeFileSync(path.join(nativesFolder, '.native-cache.json'), JSON.stringify(marker));
              }
            }
          } catch {}
          return result;
        };
      }
    }
  } catch { /* patch failed, fall back to original behaviour */ }
}

const INSTANCE_BASE = 'UClient';

/** Корень изолированного инстанса сборки: %APPDATA%\.uclient\<buildId-sanitized>. */
export function getInstanceRoot(buildId: string): string {
  const sanitized = buildId.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '');
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

/** Каталог всех инстансов (родитель папок сборок). */
export function getInstancesDir(): string {
  return path.dirname(getInstanceRoot('x'));
}

export function initLauncher(mainWindow: BrowserWindow): void {
  const appDataDir = path.join(process.env.APPDATA || process.cwd(), '.Undefined Client');

  // Подключение к Discord и патч загрузчика уводим с пути запуска: первый тянет
  // discord-rpc (~200 мс на require), второй — модуль eml-lib. На старте окна
  // ни то, ни другое не нужно, а запуск игры дожидается патча явно.
  setTimeout(() => {
    void ensureDownloaderPatched();
    void initDiscordRPC();
  }, 2000);

  function readJSON(filePath: string): any[] {
    try {
      if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      }
    } catch {}
    return [];
  }

  function writeJSON(filePath: string, data: any): void {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch {}
  }

  function mergeDirs(src: string, dest: string): void {
    try {
      if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
      for (const entry of fs.readdirSync(src)) {
        const s = path.join(src, entry);
        const d = path.join(dest, entry);
        if (fs.statSync(s).isDirectory()) {
          mergeDirs(s, d);
        } else {
          if (!fs.existsSync(path.dirname(d))) fs.mkdirSync(path.dirname(d), { recursive: true });
          fs.copyFileSync(s, d);
        }
      }
    } catch {}
  }

  function countFiles(dir: string): number {
    let c = 0;
    try {
      for (const e of fs.readdirSync(dir)) {
        const p = path.join(dir, e);
        c += fs.statSync(p).isDirectory() ? countFiles(p) : 1;
      }
    } catch {}
    return c;
  }

  /* ===== MODRINTH ===== */

  ipcMain.handle('modrinth:search', async (_event, query: string, type: string, offset: number = 0, limit: number = 20, opts?: { categories?: string[]; loaders?: string[]; version?: string; index?: string }) => {
    const params = new URLSearchParams();
    if (query) params.set('query', query);
    const facets: string[][] = [];
    if (type) facets.push([`project_type:${type}`]);
    if (opts?.categories?.length) facets.push(opts.categories.map(c => `categories:${c}`));
    if (opts?.loaders?.length) facets.push(opts.loaders.map(l => `categories:${l}`));
    if (opts?.version) facets.push([`versions:${opts.version}`]);
    if (facets.length) params.set('facets', JSON.stringify(facets));
    if (opts?.index) params.set('index', opts.index);
    params.set('limit', String(limit));
    params.set('offset', String(offset));
    const url = `https://api.modrinth.com/v2/search?${params.toString()}`;
    try {
      const res = await fetch(url);
      if (!res.ok) return { error: `Modrinth API ${res.status}` };
      const data = await res.json();
      return { hits: data.hits || [], total_hits: data.total_hits || 0 };
    } catch (e: any) {
      return { error: e?.message || 'Network error' };
    }
  });

  ipcMain.handle('modrinth:project', async (_event, projectId: string) => {
    try {
      const res = await fetch(`https://api.modrinth.com/v2/project/${projectId}`);
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  });

  ipcMain.handle('modrinth:versions', async (_event, projectId: string) => {
    try {
      const res = await fetch(`https://api.modrinth.com/v2/project/${projectId}/version`);
      if (!res.ok) return [];
      return await res.json();
    } catch { return []; }
  });

  ipcMain.handle('modrinth:download', async (_event, projectId: string, versionId?: string) => {
    try {
      const [projectRes, verRes] = await Promise.all([
        fetch(`https://api.modrinth.com/v2/project/${projectId}`),
        versionId
          ? fetch(`https://api.modrinth.com/v2/version/${versionId}`)
          : fetch(`https://api.modrinth.com/v2/project/${projectId}/version`),
      ]);
      if (!verRes.ok) return { success: false, error: 'Version fetch failed' };

      const project = projectRes.ok ? await projectRes.json() : null;
      const version = versionId
        ? await verRes.json()
        : ((await verRes.json()) as any[])[0];
      if (!version) return { success: false, error: 'Version not found' };
      const file = version.files?.[0];
      if (!file?.url) return { success: false, error: 'No file URL' };

      mainWindow.webContents.send('launcher:download-progress', {
        type: 'start', filename: file.filename, size: file.size || 0
      });

      const isModpack = project?.project_type === 'modpack';
      const reportProgress = (received: number, total: number) => {
        const percent = total > 0 ? Math.round((received / total) * 100) : 0;
        mainWindow.webContents.send('launcher:download-progress', {
          type: 'progress', percent, received, total, filename: file.filename
        });
      };

      if (isModpack) {
        const buildId = crypto.randomUUID();
        const instanceDir = getInstanceRoot(buildId);
        if (!fs.existsSync(instanceDir)) fs.mkdirSync(instanceDir, { recursive: true });
        // Архив сразу пишем под именем .zip: Expand-Archive не понимает .mrpack.
        const zipPath = path.join(instanceDir, file.filename).replace(/\.mrpack$/i, '.zip');
        try {
          await downloadModrinthFile(file.url, zipPath, {
            reason: 'modpack',
            expectedSize: file.size,
            sha1: file.hashes?.sha1,
            onProgress: reportProgress,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { success: false, error: `Download failed: ${message}` };
        }

        // Extract .mrpack (renamed to .zip)
        try {
          execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${instanceDir}' -Force"`, { timeout: 30000 });
        } catch {
          return { success: false, error: 'Failed to extract modpack archive' };
        }
        // Remove the archive after extraction
        try { fs.unlinkSync(zipPath); } catch {}

        // Parse modrinth.index.json
        let indexData: any = {};
        const indexPath = path.join(instanceDir, 'modrinth.index.json');
        if (fs.existsSync(indexPath)) {
          try {
            indexData = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
          } catch {}
        }

        // Merge overrides/ and client-overrides/ into instance root
        let mergedCount = 0;
        for (const overrideDir of ['overrides', 'client-overrides']) {
          const src = path.join(instanceDir, overrideDir);
          if (fs.existsSync(src) && fs.statSync(src).isDirectory()) {
            const files = countFiles(src);
            mergeDirs(src, instanceDir);
            mergedCount += files;
            try { fs.rmSync(src, { recursive: true, force: true }); } catch {}
          }
        }
        if (mergedCount > 0) {
          mainWindow.webContents.send('launcher:download-progress', { kind: 'status', key: 'smp.overridesCopied', params: { n: mergedCount } });
        }

        // ===== Загрузка файлов из modrinth.index.json =====
        // Каждый файл идёт через наш прокси с резервным прямым доступом к CDN.
        // Параллелизм ограничен лимитом прокси (4 загрузки на IP): выше — и
        // сервер начнёт отвечать 503 на собственные же запросы лаунчера.
        const indexFiles = indexData.files;
        if (Array.isArray(indexFiles) && indexFiles.length > 0) {
          mainWindow.webContents.send('launcher:download-progress', { kind: 'status', key: 'smp.downloadingPackFiles', params: { n: indexFiles.length } });
          const totalFiles = indexFiles.length;
          // Порядковый номер в логе считаем по факту завершения: при
          // параллельной загрузке индекс в массиве уже ничего не значит.
          let doneCount = 0;

          await runWithConcurrency(indexFiles, PROXY_MAX_CONCURRENT_DOWNLOADS, async (entry: any) => {
            const dlUrl = entry?.downloads?.[0];
            if (!dlUrl || !entry.path) return;
            // Пути внутри .mrpack — недоверенный ввод: архив мог собрать кто
            // угодно, а `../` вывел бы запись за пределы инстанса.
            const targetPath = path.resolve(instanceDir, String(entry.path).replace(/\\/g, '/'));
            const root = path.resolve(instanceDir);
            if (targetPath !== root && !targetPath.startsWith(root + path.sep)) {
              console.log(`Пропущен файл модпака с недопустимым путём: ${entry.path}`);
              return;
            }
            if (fs.existsSync(targetPath)) return;

            const name = path.basename(entry.path);
            try {
              const { bytes } = await downloadModrinthFile(dlUrl, targetPath, {
                reason: 'modpack',
                sha1: entry.hashes?.sha1,
                expectedSize: Number(entry.fileSize) || 0,
              });
              const i = ++doneCount;
              const size = (bytes / 1024 / 1024).toFixed(1);
              console.log(`[${i}/${totalFiles}] ${name} (${size} МБ)`);
              mainWindow.webContents.send('launcher:download-progress', { kind: 'status', key: 'smp.packFile', params: { i, n: totalFiles, file: name, size } });
            } catch (err) {
              const i = ++doneCount;
              const errMsg = err instanceof Error ? (err.name === 'AbortError' ? 'timeout' : err.message) : String(err);
              console.log(`[${i}/${totalFiles}] ${name} — ${errMsg}`);
              mainWindow.webContents.send('launcher:download-progress', { kind: 'status', key: 'smp.packFileErr', params: { i, n: totalFiles, file: name, msg: errMsg } });
            }
          });
        }

        const gameVersion = indexData.dependencies?.minecraft || version.game_versions?.[0] || 'latest_release';
        const depLoaderMap: Record<string, string> = { 'fabric-loader': 'fabric', 'quilt-loader': 'quilt', 'forge': 'forge', 'neoforge': 'neoforge' };
        let loader = version.loaders?.[0];
        if (!loader || loader === 'vanilla') {
          const depKey = Object.keys(indexData.dependencies || {}).find(k => k !== 'minecraft');
          loader = depLoaderMap[depKey || ''] || depKey || 'vanilla';
        }
        const loaderDeps: Record<string, string> = { fabric: 'fabric-loader', quilt: 'quilt-loader', forge: 'forge', neoforge: 'neoforge' };
        const depKey = loaderDeps[loader];
        const loaderVersion = (depKey && indexData.dependencies?.[depKey]) || LOADER_VERSIONS[loader] || '';
        const buildColors = ['#7BD4B7', '#FF6B6B', '#4ECDC4', '#FFD93D', '#70ADDF', '#C084FC', '#FB923C', '#F472B6'];
        let autoJavaPath: string | undefined;
        try {
          const javaVer = await resolveJavaVersion(gameVersion);
          autoJavaPath = bestRuntimeFor(javaVer, detectJavaRuntimes());
        } catch {}
        const build = {
          id: buildId,
          name: project?.title || file.filename.replace(/\.mrpack$/i, ''),
          gameVersion,
          loader,
          loaderVersion,
          iconBg: buildColors[Math.floor(Math.random() * buildColors.length)],
          icon: project?.icon_url ? 'modrinth:' + project.icon_url : undefined,
          createdAt: Date.now(),
          javaPath: autoJavaPath || '',
        };

        const buildsPath = path.join(appDataDir, 'builds.json');
        const builds = readJSON(buildsPath);
        builds.push(build);
        writeJSON(buildsPath, builds);

        mainWindow.webContents.send('launcher:download-progress', {
          type: 'done', filename: file.filename, filePath: instanceDir, buildCreated: true, build
        });

        return { success: true, filename: file.filename, buildCreated: true, build };
      }

      const downloadsDir = path.join(appDataDir, 'mods');
      if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir, { recursive: true });
      const filePath = path.join(downloadsDir, file.filename);
      try {
        await downloadModrinthFile(file.url, filePath, {
          reason: 'standalone',
          expectedSize: file.size,
          sha1: file.hashes?.sha1,
          onProgress: reportProgress,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: `Download failed: ${message}` };
      }

      mainWindow.webContents.send('launcher:download-progress', {
        type: 'done', filename: file.filename, filePath
      });

      return { success: true, filename: file.filename };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      mainWindow.webContents.send('launcher:download-progress', { type: 'error', message });
      return { success: false, error: message };
    }
  });

  ipcMain.handle('modrinth:resolve-project-by-name', async (_event, name: string) => {
    try {
      const res = await fetch(`https://api.modrinth.com/v2/search?query=${encodeURIComponent(name)}&limit=1&facets=[["project_type:mod"]]`);
      if (!res.ok) return null;
      const data = await res.json();
      if (data.hits?.[0]) {
        return {
          projectId: data.hits[0].project_id,
          iconUrl: data.hits[0].icon_url || '',
          title: data.hits[0].title,
          description: data.hits[0].description || '',
        };
      }
    } catch {}
    return null;
  });

  /* ===== SERVERS (direct ping via minecraft-server-util) ===== */

  const serverStatusCache = new Map<string, { at: number; data: any }>();
  const serverStatusInFlight = new Map<string, Promise<any>>();
  const STATUS_TTL_ONLINE = 5 * 60 * 1000;
  const STATUS_TTL_OFFLINE = 15 * 1000;

  ipcMain.handle('servers:status', async (_event, address: string) => {
    const raw = String(address || '').trim().replace(/\s+/g, '');
    if (!raw) return { online: false, error: 'empty' };
    const parsed = msuLib().parseAddress(raw, 25565) || { host: raw, port: 25565 };
    const host = parsed.host;
    const port = parsed.port;
    const cacheKey = `${host}:${port}`;
    const cached = serverStatusCache.get(cacheKey);
    if (cached) {
      const ttl = cached.data?.online ? STATUS_TTL_ONLINE : STATUS_TTL_OFFLINE;
      if (Date.now() - cached.at < ttl) return cached.data;
    }
    const inflight = serverStatusInFlight.get(cacheKey);
    if (inflight) return inflight;
    const promise = (async () => {
      try {
        const res = await msuLib().status(host, port, { timeout: 4000, enableSRV: true });
        const data = {
          online: true,
          players: { online: res.players.online, max: res.players.max },
          version: res.version.name.split('\n')[0] || '',
          motd: { clean: [res.motd.clean].filter(Boolean) },
          icon: res.favicon || null,
          latency: res.roundTripLatency,
        };
        serverStatusCache.set(cacheKey, { at: Date.now(), data });
        return data;
      } catch (e: any) {
        const data = { online: false, error: e?.message || 'unreachable' };
        serverStatusCache.set(cacheKey, { at: Date.now(), data });
        return data;
      }
    })();
    serverStatusInFlight.set(cacheKey, promise);
    try { return await promise; }
    finally { serverStatusInFlight.delete(cacheKey); }
  });

  /* ===== SERVERS catalog (scrape mineserv.top) ===== */

  const catalogCache = { at: 0, data: [] as any[], refreshing: false };

  const MINESERV_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
  const CATALOG_TTL_MS = 60 * 1000;
  const SCRAPE_MAX_PAGES = 50;
  const SCRAPE_CONCURRENCY = 5;

  function stripHtmlTags(s: string): string {
    return s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
  }

  function normalizeAddr(raw: string): { host: string; port: number } | null {
    const trimmed = raw.trim().replace(/^mc:\/\//i, '');
    if (!trimmed) return null;
    const parsed = msuLib().parseAddress(trimmed, 25565);
    if (!parsed) return null;
    return { host: parsed.host, port: parsed.port };
  }

  function parseMineServRows(html: string): any[] {
    const out: any[] = [];
    const rowRe = /<tr[^>]*class="project-item-row"[\s\S]*?<\/tr>/g;
    let m: RegExpExecArray | null;
    while ((m = rowRe.exec(html)) !== null) {
      const row = m[0];
      const nameMatch = /itemprop="name" class="medium black--text">([^<]+)<\/span>/.exec(row);
      const linkMatch = /itemprop="url"><div class="project-item-row__title_desc"/.exec(row) || /<a href="\/([^"]+)" itemprop="url"/.exec(row);
      const addrMatch = /clipboard-copy[^>]*>\s*<span class="flex middle-xs">([^<]+)<\/span>/.exec(row);
      const onlineMatch = /project-item-row__online[\s\S]*?<span class="(?:green|red|grey)--text regular">\s*([\s\S]*?)\s*<\/span>/.exec(row);
      const ptsMatch = /points-count\.svg[\s\S]*?<span class="black--text regular">\s*([\d\s]+)\s*<\/span>/.exec(row);

      const rawAddr = addrMatch ? addrMatch[1].trim() : '';
      if (!rawAddr) continue;
      const addr = normalizeAddr(rawAddr);
      if (!addr || !/^[a-z0-9.-]+$/i.test(addr.host)) continue;
      const { host, port } = addr;

      const versions: string[] = [];
      const versionRe = /class="blue--text">([\d.]+)<\/a>/g;
      let vm: RegExpExecArray | null;
      while ((vm = versionRe.exec(row)) !== null) {
        const v = vm[1].trim();
        if (v && !versions.includes(v)) versions.push(v);
      }
      versionRe.lastIndex = 0;

      const name = nameMatch ? stripHtmlTags(nameMatch[1]) : (host.split('.')[0] || host);
      const points = ptsMatch
        ? parseInt(ptsMatch[1].replace(/\s+/g, ''), 10) || 0
        : 0;

      out.push({
        id: `${host}:${port}`,
        name,
        ip: host,
        port,
        desc: '',
        icon: '',
        link: linkMatch ? '/' + (linkMatch[1] || '') : '',
        versions,
        points,
      });
    }
    return out;
  }

  function pageCountFromHtml(html: string): number {
    let max = 1;
    const re = /\?p=(\d+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
    return max;
  }

  async function refreshCatalog(): Promise<any[]> {
    const all: any[] = [];
    try {
      const first = await fetch('https://mineserv.top/', {
        headers: { 'User-Agent': MINESERV_UA, 'Accept-Language': 'ru,en;q=0.8' },
        signal: AbortSignal.timeout(8000),
      });
      let totalPages = 1;
      if (first.ok) {
        const text = await first.text();
        totalPages = Math.min(pageCountFromHtml(text), SCRAPE_MAX_PAGES);
        if (text.length > 0) all.push(...parseMineServRows(text));
      }
      let next = 2;
      let active = 0;
      const pool: Promise<void>[] = [];
      const pump = (): void => {
        while (active < SCRAPE_CONCURRENCY && next <= totalPages) {
          const p = next++;
          active++;
          const task = (async () => {
            const url = `https://mineserv.top/?p=${p}`;
            try {
              const res = await fetch(url, {
                headers: { 'User-Agent': MINESERV_UA, 'Accept-Language': 'ru,en;q=0.8' },
                signal: AbortSignal.timeout(5000),
              });
              if (!res.ok) return;
              const t = await res.text();
              if (t.length > 0) all.push(...parseMineServRows(t));
            } catch { /* skip page */ }
          })().finally(() => { active--; pump(); });
          pool.push(task);
        }
      };
      pump();
      await Promise.all(pool);
    } catch { /* keep cache */ }
    const seen = new Set<string>();
    const deduped = all.filter(s => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });
    if (deduped.length > 0) {
      catalogCache.at = Date.now();
      catalogCache.data = deduped;
    }
    return deduped.length > 0 ? deduped : catalogCache.data;
  }

  ipcMain.handle('servers:catalog', async () => {
    if (catalogCache.data.length > 0 && Date.now() - catalogCache.at < CATALOG_TTL_MS) {
      return catalogCache.data;
    }
    if (catalogCache.refreshing) {
      return catalogCache.data;
    }
    catalogCache.refreshing = true;
    try {
      const fresh = await refreshCatalog();
      return fresh.length > 0 ? fresh : catalogCache.data;
    } finally {
      catalogCache.refreshing = false;
    }
  });

  const catalogTimer = setInterval(() => {
    if (catalogCache.refreshing) return;
    catalogCache.refreshing = true;
    void refreshCatalog().finally(() => { catalogCache.refreshing = false; });
  }, 5 * 60 * 1000);
  catalogTimer.unref?.();

  /** Типы контента, для которых известна папка внутри инстанса. */
  const INSTALL_SUBDIRS: Record<string, string> = {
    mod: 'mods',
    resourcepack: 'resourcepacks',
    shader: 'shaderpacks',
    datapack: 'datapacks',
  };

  ipcMain.handle('launcher:install-mod', async (_event, buildId: string, projectId: string, versionId?: string, contentType?: string) => {
    try {
      const [projectRes, verRes] = await Promise.all([
        fetch(`https://api.modrinth.com/v2/project/${projectId}`),
        versionId
          ? fetch(`https://api.modrinth.com/v2/version/${versionId}`)
          : fetch(`https://api.modrinth.com/v2/project/${projectId}/version`),
      ]);
      if (!verRes.ok) return { success: false, error: 'Version fetch failed' };
      const project = projectRes.ok ? await projectRes.json() : null;
      const version = versionId
        ? await verRes.json()
        : ((await verRes.json()) as any[])[0];
      if (!version) return { success: false, error: 'Version not found' };
      const file = version.files?.[0];
      if (!file?.url) return { success: false, error: 'No file URL' };

      mainWindow.webContents.send('launcher:download-progress', {
        type: 'start', filename: file.filename, size: file.size || 0,
      });

      // Тип из вызова важнее типа проекта: Modrinth отдаёт дата-пакам
      // project_type='mod', и без подсказки они легли бы в mods вместо datapacks.
      const projectType = (contentType && INSTALL_SUBDIRS[contentType])
        ? contentType
        : (project?.project_type || 'mod');
      const subDir = INSTALL_SUBDIRS[projectType] || 'mods';
      const instanceDir = getInstanceRoot(buildId);
      const targetDir = path.join(instanceDir, subDir);
      if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
      const filePath = path.join(targetDir, file.filename);

      try {
        await downloadModrinthFile(file.url, filePath, {
          reason: 'standalone',
          expectedSize: file.size,
          sha1: file.hashes?.sha1,
          onProgress: (received, total) => {
            const percent = total > 0 ? Math.round((received / total) * 100) : 0;
            mainWindow.webContents.send('launcher:download-progress', {
              type: 'progress', percent, received, total, filename: file.filename,
            });
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: `Download failed: ${message}` };
      }

      let modName = file.filename.replace(/\.(jar|zip|disabled)$/i, '');
      let modVer = '';

      const fabricData = readZipEntry(filePath, 'fabric.mod.json');
      if (fabricData) {
        const json = tryParseJson(fabricData);
        if (json) { modName = json.name || json.id || modName; modVer = json.version || modVer; }
      }
      if (!modVer) {
        const quiltData = readZipEntry(filePath, 'quilt.mod.json');
        if (quiltData) {
          const json = tryParseJson(quiltData);
          if (json) {
            const ql = json.quilt_loader;
            if (ql) { modName = ql.metadata?.name || ql.id || modName; modVer = ql.version || modVer; }
          }
        }
      }

      mainWindow.webContents.send('launcher:download-progress', {
        type: 'done', filename: file.filename, filePath,
      });

      return {
        success: true, name: modName, version: modVer, filename: file.filename,
        projectId: project?.id || projectId,
        iconUrl: project?.icon_url || '',
        description: project?.description || '',
        contentType: projectType,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      mainWindow.webContents.send('launcher:download-progress', { type: 'error', message });
      return { success: false, error: message };
    }
  });

  /* ===== AUTH ===== */

  async function elyOAuthAuthorize(mainWindow: BrowserWindow): Promise<string | null> {
    const state = crypto.randomBytes(16).toString('hex');
    const params = new URLSearchParams({
      client_id: ELY_CLIENT_ID,
      redirect_uri: ELY_REDIRECT_URI,
      response_type: 'code',
      scope: ELY_SCOPES,
      state,
    });

    let server: http.Server | null = null;
    let authWindow: BrowserWindow | null = null;
    let codePromise: Promise<string | null>;
    let resolveCode: (value: string | null) => void = () => {};
    codePromise = new Promise<string | null>((resolve) => { resolveCode = resolve; });

    server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url || '/', ELY_REDIRECT_URI);
        if (url.searchParams.get('state') !== state) {
          res.writeHead(400);
          res.end('Invalid state');
          return;
        }
        const error = url.searchParams.get('error');
        const code = error ? null : url.searchParams.get('code');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>Undefined Client</title></head><body style="background:#0d1421;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center"><div><h2>Авторизация завершена</h2><p>Окно можно закрыть</p></div></body></html>');
        setTimeout(() => { try { server?.close(); } catch {} }, 300);
        resolveCode(code);
      } catch {
        res.writeHead(500);
        res.end('error');
      }
    });

    try {
      await new Promise<void>((resolve, reject) => {
        server?.on('error', reject);
        server?.listen(29123, '127.0.0.1', resolve);
      });
    } catch {
      return null;
    }

    authWindow = new BrowserWindow({
      parent: mainWindow,
      modal: true,
      width: 700,
      height: 760,
      resizable: false,
      minimizable: false,
      center: true,
      webPreferences: { devTools: false },
    });
    authWindow.setMenu(null);
    authWindow.on('close', () => resolveCode(null));
    await authWindow.loadURL(`${ELY_AUTHORIZE_URL}?${params.toString()}`).catch(() => resolveCode(null));

    const timeout = new Promise<null>((resolve) => setTimeout(() => {
      resolveCode(null);
      resolve(null);
    }, 5 * 60 * 1000));

    const result = await Promise.race([codePromise, timeout]);
    try { authWindow.destroy(); } catch {}
    try { server.close(); } catch {}
    return result;
  }

  ipcMain.handle('launcher:auth:ely', async () => {
    try {
      const code = await elyOAuthAuthorize(mainWindow);
      if (!code) return null;

      const tokenRes = await fetch(ELY_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: ELY_CLIENT_ID,
          client_secret: ELY_CLIENT_SECRET,
          redirect_uri: ELY_REDIRECT_URI,
          grant_type: 'authorization_code',
          code,
        }).toString(),
      });
      if (!tokenRes.ok) {
        console.error('[ely] token exchange failed:', tokenRes.status, await tokenRes.text());
        return null;
      }
      const token = await tokenRes.json();
      const accessToken: string = token.access_token;
      if (!accessToken) return null;

      const infoRes = await fetch(ELY_INFO_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!infoRes.ok) {
        console.error('[ely] account info failed:', infoRes.status, await infoRes.text());
        return null;
      }
      const info = await infoRes.json();

      let skinUrl: string | null = null;
      skinUrl = await getElyWornSkinUrl(info.username);
      if (!skinUrl) {
        try {
          const texRes = await fetch(`https://skinsystem.ely.by/textures/${encodeURIComponent(info.username)}`);
          if (texRes.ok) {
            const textures = await texRes.json();
            skinUrl = textures?.SKIN?.url || null;
          }
        } catch {}
      }

      return {
        name: info.username,
        username: info.username,
        uuid: info.uuid,
        accessToken,
        clientToken: '',
        refreshToken: token.refresh_token || undefined,
        userProperties: {},
        skinUrl,
        meta: { type: 'yggdrasil', url: ELY_AUTH_SERVER, online: true },
      };
    } catch (err) {
      console.error('[ely] auth error:', err);
      return null;
    }
  });

  ipcMain.handle('launcher:auth:microsoft', async () => {
    const eml = await loadEML();
    const account = await new eml.MicrosoftAuth(mainWindow).auth();
    return account;
  });

  ipcMain.handle('launcher:auth:offline', async (_event, username: string) => {
    const eml = await loadEML();
    const account = await new eml.CrackAuth().auth(username || 'Player');
    return account;
  });

  ipcMain.handle('launcher:auth:refresh', async (_event, account: any) => {
    if (account?.meta?.type === 'msa') {
      const eml = await loadEML();
      try {
        const refreshed = await new eml.MicrosoftAuth(mainWindow).refresh(account);
        return refreshed;
      } catch {
        return null;
      }
    }
    if (account?.meta?.type === 'yggdrasil' && account?.refreshToken) {
      try {
        const res = await fetch(ELY_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: ELY_CLIENT_ID,
            client_secret: ELY_CLIENT_SECRET,
            grant_type: 'refresh_token',
            refresh_token: account.refreshToken,
            scope: ELY_SCOPES,
          }).toString(),
        });
        if (!res.ok) return null;
        const token = await res.json();
        return {
          ...account,
          accessToken: token.access_token || account.accessToken,
          refreshToken: token.refresh_token || account.refreshToken,
        };
      } catch {
        return null;
      }
    }
    return account;
  });

  /* ===== ACCOUNTS ===== */

  const accountsPath = path.join(appDataDir, 'accounts.json');

  ipcMain.handle('launcher:account:save', async (_event, account: any) => {
    const accounts = readJSON(accountsPath);
    const idx = accounts.findIndex((a: any) => a.uuid === account.uuid);
    if (idx !== -1) accounts[idx] = account;
    else accounts.push(account);
    writeJSON(accountsPath, accounts);
    return true;
  });

  ipcMain.handle('launcher:account:load', async () => {
    return readJSON(accountsPath);
  });

  ipcMain.handle('launcher:account:remove', async (_event, uuid: string) => {
    const accounts = readJSON(accountsPath).filter((a: any) => a.uuid !== uuid);
    writeJSON(accountsPath, accounts);
    return true;
  });

  /* ===== BUILDS ===== */

  const buildsPath = path.join(appDataDir, 'builds.json');

  ipcMain.handle('launcher:build:save', async (_event, build: any) => {
    const builds = readJSON(buildsPath);
    const idx = builds.findIndex((b: any) => b.id === build.id);
    if (idx !== -1) builds[idx] = build;
    else builds.push(build);
    writeJSON(buildsPath, builds);
    return true;
  });

  ipcMain.handle('launcher:build:load', async () => {
    return readJSON(buildsPath);
  });

  ipcMain.handle('launcher:build:remove', async (_event, id: string) => {
    const builds = readJSON(buildsPath).filter((b: any) => b.id !== id);
    writeJSON(buildsPath, builds);
    return true;
  });

  // ===== Иконки сборок из assets/InstancesIcons =====
  ipcMain.handle('launcher:instance-icons:list', async () => {
    const dir = path.join(__dirname, '../../assets/InstancesIcons');
    try {
      if (!fs.existsSync(dir)) return [];
      return fs
        .readdirSync(dir)
        .filter((name) => /\.(png|jpe?g|webp|gif)$/i.test(name))
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    } catch (err) {
      console.error('[instance-icons] list failed', err);
      return [];
    }
  });

  /* ===== SERVERS ===== */

  const serversPath = path.join(appDataDir, 'servers.json');

  ipcMain.handle('launcher:server:save', async (_event, server: any) => {
    const servers = readJSON(serversPath);
    const idx = servers.findIndex((s: any) => s.id === server.id);
    if (idx !== -1) servers[idx] = server;
    else servers.push(server);
    writeJSON(serversPath, servers);
    return true;
  });

  ipcMain.handle('launcher:server:load', async () => {
    return readJSON(serversPath);
  });

  ipcMain.handle('launcher:server:remove', async (_event, id: string) => {
    const servers = readJSON(serversPath).filter((s: any) => s.id !== id);
    writeJSON(serversPath, servers);
    return true;
  });

  /* ===== SKINS ===== */

  const elyWornSkinCache = new Map<string, { url: string | null; ts: number }>();

  async function getElyWornSkinUrl(nickname: string, force = false): Promise<string | null> {
    const cached = elyWornSkinCache.get(nickname);
    if (!force && cached && Date.now() - cached.ts < 60 * 1000) return cached.url;
    let url: string | null = null;
    try {
      const res = await fetch(`https://skinsystem.ely.by/textures/${encodeURIComponent(nickname)}`);
      if (!res.ok) return null;
      const data = await res.json();
      url = data?.SKIN?.url || null;
    } catch (err) {
      console.error('[ely] worn skin fetch error:', err);
    }
    elyWornSkinCache.set(nickname, { url, ts: Date.now() });
    return url;
  }

  ipcMain.handle('launcher:ely:wornSkin', async (_event, nickname: string, force = false) => {
    return getElyWornSkinUrl(nickname, force);
  });

  // ===== Прокси скинов =====
  // Профиль Mojang и текстуры скинов фильтруются у российских провайдеров, но
  // и наш сервер может быть недоступен, поэтому схема та же, что у загрузки
  // файлов каталога: основной путь — прокси, резервный — прямой адрес.

  /** Ожидание ответа: и профиль, и картинка скина мелкие, тянуться не должны. */
  const SKIN_TIMEOUT_MS = 10000;

  /** Первый успешный ответ из списка адресов; порядок задаёт приоритет. */
  async function fetchFirstOk(urls: string[]): Promise<Response | null> {
    for (const url of urls) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(SKIN_TIMEOUT_MS) });
        if (res.ok) return res;
        await res.body?.cancel().catch(() => {});
      } catch {
        // Сеть или тайм-аут — пробуем следующий адрес
      }
    }
    return null;
  }

  ipcMain.handle('launcher:skin:get', async (_event, uuid: string, serverUrl?: string) => {
    try {
      const clean = uuid.replace(/-/g, '');
      // Свой сервер аутентификации (Ely.by) проксировать не нужно и нечем:
      // прокси знает только Mojang, а сам Ely.by у провайдеров не фильтруется.
      const urls = serverUrl
        ? [`${serverUrl}/session/profile/${uuid}`]
        : [skinProfileUrl(clean), `https://sessionserver.mojang.com/session/minecraft/profile/${clean}`];
      const res = await fetchFirstOk(urls);
      if (!res) return null;
      const data = await res.json();
      const textures = JSON.parse(atob(data.properties?.[0]?.value || ''));
      return {
        skinUrl: textures.textures?.SKIN?.url || null,
        capeUrl: textures.textures?.CAPE?.url || null,
      };
    } catch {
      return null;
    }
  });

  ipcMain.handle('launcher:skin:fetch', async (_event, url: string) => {
    try {
      // Сначала ПРЯМОЙ textures.minecraft.net — прокси однажды отдавал чужую
      // текстуру плаща (Migrator сохранялся как классический Mojang).
      const direct = String(url || '').replace(/^http:\/\//i, 'https://');
      const proxied = skinImageUrl(direct);
      const urls =
        proxied && proxied !== direct ? [direct, proxied] : [direct];
      const res = await fetchFirstOk(urls);
      if (!res) return null;
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length < 32 || buffer[0] !== 0x89 || buffer[1] !== 0x50) {
        console.warn('[cosmetics] skin fetch: не PNG', direct.slice(0, 80));
        return null;
      }
      return buffer.toString('base64');
    } catch {
      return null;
    }
  });

  const skinsDir = path.join(appDataDir, 'skins');

  ipcMain.handle('launcher:skin:save', async (_event, skin: {
    id: string;
    name: string;
    dataUrl: string;
    /** Владелец косметики (uuid без дефисов) — у каждого аккаунта свой набор */
    accountId?: string;
    /** Официальный id плаща Microsoft Profile API */
    mojangCapeId?: string;
  }) => {
    try {
      if (!fs.existsSync(skinsDir)) fs.mkdirSync(skinsDir, { recursive: true });
      const metaPath = path.join(skinsDir, 'skins.json');
      const skins = readJSON(metaPath);
      const entry: { id: string; name: string; accountId?: string; mojangCapeId?: string } = {
        id: skin.id,
        name: skin.name,
      };
      if (skin.accountId) entry.accountId = String(skin.accountId);
      if (skin.mojangCapeId) entry.mojangCapeId = String(skin.mojangCapeId);
      const idx = skins.findIndex((s: any) => s.id === skin.id);
      if (idx !== -1) skins[idx] = { ...skins[idx], ...entry };
      else skins.push(entry);
      writeJSON(metaPath, skins);
      const base64 = skin.dataUrl.replace(/^data:image\/png;base64,/, '');
      fs.writeFileSync(path.join(skinsDir, `${skin.id}.png`), Buffer.from(base64, 'base64'));
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('launcher:skin:load', async () => {
    try {
      const metaPath = path.join(skinsDir, 'skins.json');
      const skins = readJSON(metaPath);
      return skins.map((s: any) => {
        const pngPath = path.join(skinsDir, `${s.id}.png`);
        if (fs.existsSync(pngPath)) {
          const data = fs.readFileSync(pngPath);
          return { ...s, dataUrl: `data:image/png;base64,${data.toString('base64')}` };
        }
        return s;
      });
    } catch {
      return [];
    }
  });

  ipcMain.handle('launcher:skin:remove', async (_event, id: string) => {
    try {
      const metaPath = path.join(skinsDir, 'skins.json');
      const skins = readJSON(metaPath).filter((s: any) => s.id !== id);
      writeJSON(metaPath, skins);
      const pngPath = path.join(skinsDir, `${id}.png`);
      if (fs.existsSync(pngPath)) fs.unlinkSync(pngPath);
      return true;
    } catch {
      return false;
    }
  });

  // ===== Применение скина/плаща в аккаунт и инстанс =====

  /**
   * Эталонные sha256 текстур (как в textures.minecraft.net/texture/<hash>).
   * Если локальный PNG не совпадает — файл битый (прокси подменил текстуру).
   */
  const KNOWN_CAPE_SHA256: Record<string, string> = {
    '5af20372-79e0-4e1f-80f8-6bd8e3135995':
      '2340c0e03dd24a11b15a8b33c2a7e9e32abb2051b2481d0ba7defd635ca7a933', // Migrator
  };

  function sha256Hex(buf: Buffer): string {
    return crypto.createHash('sha256').update(buf).digest('hex');
  }

  function purgeCorruptCapePngs(): void {
    try {
      for (const [mojangId, expect] of Object.entries(KNOWN_CAPE_SHA256)) {
        const pngPath = path.join(skinsDir, `cape-msa-${mojangId}.png`);
        if (!fs.existsSync(pngPath)) continue;
        const got = sha256Hex(fs.readFileSync(pngPath));
        if (got !== expect) {
          console.warn('[cosmetics] удаляю битый PNG плаща', mojangId, { got, expect });
          fs.unlinkSync(pngPath);
        }
      }
    } catch { /* ignore */ }
  }
  purgeCorruptCapePngs();

  /** PNG из data URL или файла skins/ */
  function resolveSkinPng(dataUrlOrId: string | null | undefined): Buffer | null {
    if (!dataUrlOrId) return null;
    if (dataUrlOrId.startsWith('data:image')) {
      const b64 = dataUrlOrId.replace(/^data:image\/png;base64,/, '');
      return Buffer.from(b64, 'base64');
    }
    const pngPath = path.join(skinsDir, `${dataUrlOrId}.png`);
    if (!fs.existsSync(pngPath)) return null;
    const buf = fs.readFileSync(pngPath);
    // cape-msa-{uuid} — проверить эталон, если есть
    if (dataUrlOrId.startsWith('cape-msa-')) {
      const mojangId = dataUrlOrId.slice('cape-msa-'.length);
      const expect = KNOWN_CAPE_SHA256[mojangId];
      if (expect && sha256Hex(buf) !== expect) {
        console.warn('[cosmetics] битый PNG плаща, игнор', mojangId);
        try { fs.unlinkSync(pngPath); } catch { /* ignore */ }
        return null;
      }
    }
    return buf;
  }

  /**
   * Загрузка скина на Ely.by через сайт API (/skins/upload + /skins/wear).
   * Mojang-эндпоинт authserver.ely.by/minecraft/profile/skins не реализован
   * (отдаёт HTML личного кабинета) — eml-lib.updateSkin для Ely не работает.
   */
  async function uploadSkinToEly(
    account: any,
    skinPng: Buffer,
    variant: 'classic' | 'slim',
  ): Promise<{ ok: boolean; error?: string; openWeb?: boolean }> {
    const token = String(account?.accessToken || '');
    if (!token) {
      return { ok: false, error: 'no_token', openWeb: true };
    }

    const fileBlob = new Blob([Uint8Array.from(skinPng)], { type: 'image/png' });

    const tryUpload = async (url: string, headers: Record<string, string>, extraFields?: Record<string, string>) => {
      const form = new FormData();
      form.append('file', fileBlob, 'skin.png');
      form.append('is_slim', variant === 'slim' ? '1' : '0');
      if (extraFields) {
        for (const [k, v] of Object.entries(extraFields)) form.append(k, v);
      }
      const uploadRes = await fetch(url, { method: 'POST', headers, body: form });
      const raw = await uploadRes.text();
      let data: any = null;
      try { data = raw ? JSON.parse(raw) : null; } catch { /* HTML / не JSON */ }
      return { uploadRes, raw, data };
    };

    try {
      // 1) Bearer (если сайт когда‑либо примет OAuth-токен аккаунта)
      let { uploadRes, raw, data } = await tryUpload(
        'https://ely.by/skins/upload',
        { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      );

      // 2) access_token в теле — запасной вариант для старых ручек
      if (!uploadRes.ok) {
        const second = await tryUpload(
          'https://ely.by/skins/upload',
          { Accept: 'application/json' },
          { access_token: token },
        );
        uploadRes = second.uploadRes;
        raw = second.raw;
        data = second.data;
      }

      if (!uploadRes.ok) {
        console.warn('[ely] skin upload failed', uploadRes.status, raw.slice(0, 300));
        // OAuth лаунчера ≠ сессия сайта ely.by — смена скина только в браузере
        return {
          ok: false,
          error: data?.error || data?.text || `HTTP ${uploadRes.status}`,
          openWeb: true,
        };
      }

      const skinId = data?.skin?.id || data?.id || data?.skinId;
      if (skinId) {
        try {
          await fetch('https://ely.by/skins/wear', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/json',
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({ skinId: String(skinId), access_token: token }).toString(),
          });
        } catch (wearErr) {
          console.warn('[ely] skin wear failed', wearErr);
        }
      }

      // Сбросить кэш надетого скина
      const nick = account?.username || account?.name;
      if (nick) elyWornSkinCache.delete(String(nick));

      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message, openWeb: true };
    }
  }

  /**
   * Локальный id → Mojang capeId.
   * Актуальный: `cape-msa-{mojangId}`. Legacy: `cape-msa-{uuid8}-{mojangId}`.
   * Нельзя отрезать «первые 8 hex» вслепую — это ломает сам UUID плаща.
   */
  function mojangCapeIdFromLocalId(localId: string, accountUuid?: string): string {
    const prefix = 'cape-msa-';
    if (!localId.startsWith(prefix)) return localId;
    const rest = localId.slice(prefix.length);
    const short = String(accountUuid || '').replace(/-/g, '').toLowerCase().slice(0, 8);
    if (short && rest.toLowerCase().startsWith(`${short}-`)) {
      return rest.slice(short.length + 1);
    }
    return rest;
  }

  // Антиспам Microsoft Profile API (иначе HTTP 429).
  // Важно: mojangCapeId в meta — только ПОДТВЕРЖДЁННЫЙ (успешный PUT или sync ACTIVE).
  // desiredMojangCapeId — выбор пользователя (LocalSkin), его нельзя использовать для skip.
  const msaCapeSwitchMemory = new Map<string, { capeId: string; ts: number }>();
  const MSA_CAPE_COOLDOWN_MS = 90_000;

  function activeCosmeticsMetaPath(): string {
    return path.join(appDataDir, 'active-cosmetics', 'meta.json');
  }

  function readActiveCosmeticsMetaRaw(): any {
    try {
      return readJSON(activeCosmeticsMetaPath()) || {};
    } catch {
      return {};
    }
  }

  /**
   * Раньше после 429/PUT без проверки в mojangCapeId писали желаемый id → skip навсегда.
   * confirmed только из GET /profile (ACTIVE).
   */
  function migrateCapeMetaIfNeeded(): void {
    const meta = readActiveCosmeticsMetaRaw();
    if (meta?.capeMetaV3 && meta?.skinMetaV2) return;
    try {
      const activeDir = path.join(appDataDir, 'active-cosmetics');
      fs.mkdirSync(activeDir, { recursive: true });
      const next: any = { ...meta };
      if (!meta?.capeMetaV2) {
        next.desiredMojangCapeId = meta.desiredMojangCapeId ?? meta.mojangCapeId ?? null;
        next.capeMetaV2 = true;
      }
      if (!meta?.capeMetaV3) {
        // PUT 200 ≠ ACTIVE на аккаунте — сбрасываем ложный confirmed
        next.desiredMojangCapeId = meta.desiredMojangCapeId ?? meta.mojangCapeId ?? null;
        next.mojangCapeId = null;
        next.profileActiveCapeId = null;
        next.capeMetaV3 = true;
        msaCapeSwitchMemory.clear();
        console.log('[cosmetics] migrated cape meta v3 (confirmed only via profile GET)');
      }
      if (!meta?.skinMetaV2) {
        next.desiredSkinId = meta.desiredSkinId ?? meta.skinId ?? null;
        next.uploadedSkinId = null;
        next.uploadedVariant = null;
        next.skinMetaV2 = true;
        console.log('[cosmetics] migrated skin meta v2 (reset untrusted uploadedSkinId)');
      }
      writeJSON(activeCosmeticsMetaPath(), next);
    } catch { /* ignore */ }
  }

  function readActiveCosmeticsMeta(): any {
    migrateCapeMetaIfNeeded();
    return readActiveCosmeticsMetaRaw();
  }

  function patchActiveCosmeticsMeta(patch: Record<string, unknown>): void {
    try {
      migrateCapeMetaIfNeeded();
      const activeDir = path.join(appDataDir, 'active-cosmetics');
      fs.mkdirSync(activeDir, { recursive: true });
      writeJSON(activeCosmeticsMetaPath(), { ...readActiveCosmeticsMetaRaw(), ...patch });
    } catch { /* ignore */ }
  }

  /**
   * Запомнить плащ только после GET /profile (реальный ACTIVE).
   * HTTP 200 на PUT сам по себе не доказательство — из‑за этого «Migrator» skip, а в игре другой плащ.
   */
  function confirmMsaCapeId(accountUuid: string, mojangCapeId: string | null): void {
    const id = mojangCapeId ? String(mojangCapeId) : '';
    if (id) msaCapeSwitchMemory.set(String(accountUuid || ''), { capeId: id, ts: Date.now() });
    else msaCapeSwitchMemory.delete(String(accountUuid || ''));
    patchActiveCosmeticsMeta({
      mojangCapeId: id || null,
      profileActiveCapeId: id || null,
      capeSwitchedAt: id ? Date.now() : readActiveCosmeticsMeta().capeSwitchedAt || 0,
      capeRateLimitedAt: 0,
    });
  }

  /** ACTIVE cape id с профиля Microsoft (один GET). */
  async function fetchProfileActiveCapeId(account: any): Promise<string | null> {
    const profile = await fetchMicrosoftProfileCosmetics(account);
    const active = (profile.capes || []).find((c) => c.state === 'active');
    return active?.id ? String(active.id) : null;
  }

  /**
   * PUT active cape.
   * force (клик) — всегда PUT, без skip по «confirmed».
   * Без force — skip только если GET/sync уже видел этот id как profileActiveCapeId.
   * После PUT подтверждаем вторым GET; иначе не ставим confirmed (чтобы не залипать).
   */
  async function switchMsaCape(
    account: any,
    mojangCapeId: string,
    opts?: { force?: boolean },
  ): Promise<{
    account?: any;
    skipped?: boolean;
    rateLimited?: boolean;
    applied?: boolean;
    actualCapeId?: string | null;
    error?: string;
  }> {
    const uuid = String(account?.uuid || '');
    const meta = readActiveCosmeticsMeta();
    const profileActive = String(meta?.profileActiveCapeId || meta?.mojangCapeId || '');
    const lastRateLimited = Number(meta?.capeRateLimitedAt || 0);

    // Клик пользователя — не skip; запуск — skip только по подтверждённому ACTIVE с профиля
    if (!opts?.force && profileActive && profileActive === mojangCapeId) {
      console.log('[cosmetics] MSA cape switch skipped (profile ACTIVE)', mojangCapeId);
      return { skipped: true, actualCapeId: profileActive };
    }
    if (lastRateLimited && Date.now() - lastRateLimited < MSA_CAPE_COOLDOWN_MS) {
      console.log('[cosmetics] MSA cape switch skipped (post-429 cooldown)', mojangCapeId);
      return { rateLimited: true };
    }

    let acc = account;
    if (!acc?.accessToken) throw new Error('no_access_token');

    const putOnce = (token: string) =>
      fetch('https://api.minecraftservices.com/minecraft/profile/capes/active', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ capeId: mojangCapeId }),
      });

    console.log('[cosmetics] MSA cape PUT', {
      mojangCapeId,
      force: !!opts?.force,
      profileActive,
    });
    let put = await putOnce(acc.accessToken);
    if (put.status === 401) {
      const eml = await loadEML();
      try {
        const refreshed = await new eml.MicrosoftAuth(mainWindow).refresh(acc);
        if (refreshed?.accessToken) {
          acc = refreshed;
          put = await putOnce(acc.accessToken);
        }
      } catch (e) {
        console.warn('[cosmetics] MSA token refresh before cape switch failed', e);
      }
    }

    if (put.status === 429) {
      console.warn('[cosmetics] MSA cape switch rate-limited (429)');
      patchActiveCosmeticsMeta({
        desiredMojangCapeId: mojangCapeId,
        capeRateLimitedAt: Date.now(),
      });
      return { rateLimited: true, account: acc !== account ? acc : undefined };
    }
    if (!put.ok) {
      const errorText = await put.text();
      throw new Error(`cape switch HTTP ${put.status}: ${errorText.slice(0, 240)}`);
    }

    patchActiveCosmeticsMeta({
      desiredMojangCapeId: mojangCapeId,
      lastPutCapeId: mojangCapeId,
      lastPutAt: Date.now(),
    });

    // Проверяем реальный ACTIVE — иначе снова получим «skip Migrator», а в игре другой плащ
    let actual: string | null = null;
    try {
      actual = await fetchProfileActiveCapeId(acc);
    } catch (e) {
      console.warn('[cosmetics] cape verify GET failed (не ставим confirmed):', e);
    }

    if (actual && actual === mojangCapeId) {
      confirmMsaCapeId(uuid, actual);
      console.log('[cosmetics] MSA cape PUT verified ACTIVE', actual);
      return { applied: true, actualCapeId: actual, account: acc !== account ? acc : undefined };
    }

    if (actual && actual !== mojangCapeId) {
      confirmMsaCapeId(uuid, actual);
      console.warn('[cosmetics] MSA cape PUT ok, but ACTIVE is different', {
        requested: mojangCapeId,
        actual,
      });
      return {
        applied: false,
        actualCapeId: actual,
        error: 'cape_mismatch',
        account: acc !== account ? acc : undefined,
      };
    }

    // GET не удался — не подтверждаем, следующий force снова сделает PUT
    console.warn('[cosmetics] MSA cape PUT ok, ACTIVE not verified');
    return {
      applied: true,
      actualCapeId: null,
      account: acc !== account ? acc : undefined,
    };
  }

  /**
   * Загрузка скина на MSA / Ely (yggdrasil).
   * Кастомный плащ через официальный API недоступен — его кладём в CustomSkinLoader.
   */
  async function uploadSkinToAccount(
    account: any,
    skinPng: Buffer,
    variant: 'classic' | 'slim',
  ): Promise<{ ok: boolean; error?: string; openWeb?: boolean }> {
    const type = account?.meta?.type || account?.type;
    if (type !== 'msa' && type !== 'yggdrasil') {
      return { ok: false, error: 'offline' };
    }
    // Ely: отдельный путь — не через eml-lib (ломаный Mojang endpoint)
    if (type === 'yggdrasil') {
      return uploadSkinToEly(account, skinPng, variant);
    }
    try {
      const eml = await loadEML();
      // File/Blob — FormData upload в eml-lib (URL string уйдёт как remote, Mojang его не примет)
      const file = new File([Uint8Array.from(skinPng)], 'skin.png', { type: 'image/png' });
      await new eml.Skin(account).updateSkin(file, variant);
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  }

  /** Имена файлов LocalSkin: точный ник CSL + sanitized на случай спецсимволов */
  function localSkinFileNames(username: string): string[] {
    const raw = String(username || 'Player').trim() || 'Player';
    const safe = raw.replace(/[^\w.\-]/g, '_');
    return raw === safe ? [raw] : [raw, safe];
  }

  /**
   * Локальные текстуры + конфиг CustomSkinLoader.
   * Официальный MSA-плащ тоже кладём в LocalSkin (актуальный PNG выбора) —
   * MojangAPI/session часто отдаёт кэш или чужую текстуру; CSL 15 ещё и
   * дописывает cape в loadlist сам.
   */
  function writeLocalCosmetics(
    instanceDir: string,
    username: string,
    skinPng: Buffer | null,
    capePng: Buffer | null,
    accountType: string = 'offline',
    opts?: { useLocalCape?: boolean },
  ): void {
    const useLocalCape = opts?.useLocalCape !== false && !!capePng;
    const names = localSkinFileNames(username);
    const cslRoot = path.join(instanceDir, 'CustomSkinLoader');
    const skinDir = path.join(cslRoot, 'LocalSkin', 'skins');
    const capeDir = path.join(cslRoot, 'LocalSkin', 'capes');
    fs.mkdirSync(skinDir, { recursive: true });
    fs.mkdirSync(capeDir, { recursive: true });

    for (const fileName of names) {
      const skinPath = path.join(skinDir, `${fileName}.png`);
      const capePath = path.join(capeDir, `${fileName}.png`);
      if (skinPng) {
        fs.writeFileSync(skinPath, skinPng);
      } else if (accountType === 'msa' && fs.existsSync(skinPath)) {
        // Не затираем локальный скин пустым вызовом cleanup
      }
      if (useLocalCape && capePng) {
        fs.writeFileSync(capePath, capePng);
      } else if (fs.existsSync(capePath)) {
        try { fs.unlinkSync(capePath); } catch { /* ignore */ }
      }
    }

    const loadlist: any[] = [];
    if (skinPng || useLocalCape || accountType !== 'msa') {
      const localEntry: any = {
        name: 'LocalSkin',
        type: 'Legacy',
        checkPNG: false,
        skin: 'LocalSkin/skins/{USERNAME}.png',
        model: 'auto',
      };
      if (useLocalCape) {
        localEntry.cape = 'LocalSkin/capes/{USERNAME}.png';
      }
      loadlist.push(localEntry);
    }
    if (accountType === 'msa') {
      loadlist.push({
        name: 'Mojang',
        type: 'MojangAPI',
        apiRoot: 'https://api.mojang.com/',
        sessionRoot: 'https://sessionserver.mojang.com/',
      });
    } else if (accountType === 'yggdrasil') {
      loadlist.push({
        name: 'ElyBy',
        type: 'Legacy',
        skin: 'http://skinsystem.ely.by/skins/{USERNAME}.png',
        cape: 'http://skinsystem.ely.by/cloaks/{USERNAME}.png',
      });
    }
    if (loadlist.length === 0) {
      loadlist.push({
        name: 'LocalSkin',
        type: 'Legacy',
        checkPNG: false,
        skin: 'LocalSkin/skins/{USERNAME}.png',
        model: 'auto',
      });
    }

    const cfgPath = path.join(cslRoot, 'CustomSkinLoader.json');
    // Полный конфиг CSL 15: иначе мод сам дописывает cape/elytra и кэш
    fs.writeFileSync(
      cfgPath,
      JSON.stringify(
        {
          version: '14.25',
          buildNumber: 0,
          loadlist,
          enableTransparentSkin: true,
          forceLoadAllTextures: false,
          enableCape: true,
          threadPoolSize: 8,
          enableLogStdOut: false,
          cacheExpiry: 1,
          forceUpdateSkull: false,
          enableLocalProfileCache: false,
          enableCacheAutoClean: true,
          forceDisableCache: true,
        },
        null,
        2,
      ),
      'utf8',
    );

    // Полный сброс кэша CSL — иначе красный Mojang остаётся вместо Founder's
    try {
      const cacheRoot = path.join(cslRoot, 'caches');
      if (fs.existsSync(cacheRoot)) {
        fs.rmSync(cacheRoot, { recursive: true, force: true });
      }
    } catch { /* ignore */ }

    neutralizeConflictingCapeMods(instanceDir);
  }

  /**
   * Fabulously Optimized и др. тянут cape-provider (Cosmetica / OptiFine / minecraftcapes).
   * Он рисует плащ ПОВЕРХ CSL — поэтому в игре «Mojang Studios», хотя LocalSkin = Founder's.
   * Отключаем оверлеи, чтобы работали LocalSkin и ACTIVE с Microsoft.
   */
  function neutralizeConflictingCapeMods(instanceDir: string): void {
    try {
      const cfgDir = path.join(instanceDir, 'config', 'cape-provider');
      fs.mkdirSync(cfgDir, { recursive: true });
      writeJSON(path.join(cfgDir, 'config.json'), {
        activeProviderIds: [],
        useDefaultProvider: false,
        onlyLoadForSelf: true,
        enableElytraTexture: false,
        animatedCapesHandling: 'OFF',
        remoteCustomProviders: [],
        loadProvidersFromMods: false,
        loadSimpleLocalProvidersFromFilesystem: false,
        activateExternalProvidersOnInitialLoad: false,
        knownAutoActivatingProviderIdsFirstTimeMissing: {},
      });
      const rootCape = path.join(cfgDir, 'cape.png');
      if (fs.existsSync(rootCape)) {
        try {
          fs.renameSync(rootCape, `${rootCape}.disabled-by-uclient`);
        } catch { /* ignore */ }
      }
      console.log('[cosmetics] cape-provider config neutralized');
    } catch (err) {
      console.warn('[cosmetics] cape-provider config neutralize failed:', err);
    }

    // Конфиг модпак может откатить — jar надёжнее выключить
    try {
      const modsDir = path.join(instanceDir, 'mods');
      if (!fs.existsSync(modsDir)) return;
      for (const name of fs.readdirSync(modsDir)) {
        if (!/^cape-provider/i.test(name) || !name.endsWith('.jar')) continue;
        const from = path.join(modsDir, name);
        const to = path.join(modsDir, `${name}.disabled-by-uclient`);
        if (fs.existsSync(to)) {
          try { fs.unlinkSync(from); } catch { /* already disabled */ }
          continue;
        }
        fs.renameSync(from, to);
        console.log('[cosmetics] disabled conflicting mod:', name);
      }
    } catch (err) {
      console.warn('[cosmetics] cape-provider jar disable failed:', err);
    }
  }

  function cslCacheDir(): string {
    const dir = path.join(appDataDir, 'cache', 'customskinloader');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  /** Скопировать кэшированный CSL jar в mods инстанса (синхронно, перед стартом MC). */
  function copyCachedCslJarToInstance(instanceDir: string): boolean {
    const modsDir = path.join(instanceDir, 'mods');
    fs.mkdirSync(modsDir, { recursive: true });
    if (fs.readdirSync(modsDir).some((f) => /customskinloader/i.test(f))) return true;
    const cache = cslCacheDir();
    const cached = fs.existsSync(cache)
      ? fs.readdirSync(cache).find((f) => /customskinloader/i.test(f) && f.endsWith('.jar'))
      : undefined;
    if (!cached) return false;
    try {
      fs.copyFileSync(path.join(cache, cached), path.join(modsDir, cached));
      console.log('[cosmetics] CSL jar restored from cache →', cached);
      return true;
    } catch (err) {
      console.warn('[cosmetics] CSL cache copy failed:', err);
      return false;
    }
  }

  /** Поставить CustomSkinLoader из Modrinth (+ кэш), если ещё нет */
  async function ensureCustomSkinLoader(
    instanceDir: string,
    loader: string,
    mcVersion: string,
  ): Promise<boolean> {
    const modsDir = path.join(instanceDir, 'mods');
    fs.mkdirSync(modsDir, { recursive: true });
    if (fs.readdirSync(modsDir).some((f) => /customskinloader/i.test(f))) return true;
    if (copyCachedCslJarToInstance(instanceDir)) return true;

    const loaderKey = (loader || 'fabric').toLowerCase();
    if (loaderKey === 'vanilla') {
      console.log('[cosmetics] CSL skipped (vanilla — только upload на аккаунт)');
      return false;
    }

    const fetchVersions = async (gameVer?: string): Promise<any[]> => {
      const params = new URLSearchParams();
      params.set('loaders', JSON.stringify([loaderKey]));
      if (gameVer) params.set('game_versions', JSON.stringify([gameVer]));
      const qs = params.toString();
      const headers = { 'User-Agent': 'UndefinedClient/cosmetics' };
      let verRes = await fetch(
        `https://api.modrinth.com/v2/project/customskinloader/version?${qs}`,
        { headers },
      );
      if (!verRes.ok) {
        verRes = await fetch(
          `https://api.modrinth.com/v2/project/idDyhF5z/version?${qs}`,
          { headers },
        );
      }
      if (!verRes.ok) return [];
      const versions = (await verRes.json()) as any[];
      return Array.isArray(versions) ? versions : [];
    };

    try {
      let versions = await fetchVersions(mcVersion);
      if (!versions.length) {
        console.warn('[cosmetics] CSL: нет версии для', loaderKey, mcVersion, '— fallback без game_versions');
        versions = await fetchVersions();
      }
      const version = versions[0];
      const file = version?.files?.find((f: any) => f.primary) || version?.files?.[0];
      if (!file?.url) {
        console.warn('[cosmetics] CSL: пустой список файлов Modrinth');
        return false;
      }

      const cacheDest = path.join(cslCacheDir(), file.filename);
      if (!fs.existsSync(cacheDest)) {
        await downloadModrinthFile(file.url, cacheDest, {
          reason: 'standalone',
          expectedSize: file.size,
          sha1: file.hashes?.sha1,
        });
      }
      const dest = path.join(modsDir, file.filename);
      fs.copyFileSync(cacheDest, dest);
      const ok = fs.existsSync(dest);
      console.log('[cosmetics] CSL installed', { dest, ok, ver: version?.version_number });
      return ok;
    } catch (err) {
      console.warn('[cosmetics] CustomSkinLoader install failed:', err);
      return false;
    }
  }

  /** Записать LocalSkin (+ CSL) во все известные сборки — клик в UI без buildId */
  async function mirrorLocalCosmeticsToBuilds(
    username: string,
    skinPng: Buffer | null,
    capePng: Buffer | null,
    accountType: string,
    prefer?: {
      buildId?: string;
      loader?: string;
      gameVersion?: string;
      useLocalCape?: boolean;
    },
  ): Promise<{ local: boolean; csl: boolean }> {
    let local = false;
    let csl = false;
    const builds = readJSON(buildsPath) || [];
    const seen = new Set<string>();
    const useLocalCape = prefer?.useLocalCape !== false;

    const targets: { id: string; loader: string; gameVersion: string }[] = [];
    if (prefer?.buildId) {
      targets.push({
        id: String(prefer.buildId),
        loader: prefer.loader || 'fabric',
        gameVersion: prefer.gameVersion || '1.20.1',
      });
    }
    for (const b of builds) {
      if (!b?.id) continue;
      targets.push({
        id: String(b.id),
        loader: String(b.loader || 'fabric'),
        gameVersion: String(b.gameVersion || '1.20.1'),
      });
    }

    for (const t of targets) {
      const buildId = t.id.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '');
      if (!buildId || seen.has(buildId)) continue;
      seen.add(buildId);
      const instanceDir = getInstanceRoot(buildId);
      if (!fs.existsSync(instanceDir) && prefer?.buildId !== t.id && prefer?.buildId !== buildId) {
        continue;
      }
      try {
        fs.mkdirSync(instanceDir, { recursive: true });
        writeLocalCosmetics(instanceDir, username, skinPng, capePng, accountType, {
          useLocalCape,
        });
        local = true;
        if (String(t.loader).toLowerCase() !== 'vanilla') {
          if (await ensureCustomSkinLoader(instanceDir, t.loader, t.gameVersion)) csl = true;
        }
      } catch (err) {
        console.warn('[cosmetics] mirror to build failed', buildId, err);
      }
    }
    return { local, csl };
  }

  /**
   * Применить активный скин/плащ: upload на аккаунт + LocalSkin в инстансе.
   * cosmetics: { skinId?, capeId?, skinDataUrl?, capeDataUrl?, variant?, buildId?, loader?, gameVersion? }
   */
  async function applyCosmetics(account: any, cosmetics: any): Promise<{
    success: boolean;
    uploaded?: boolean;
    capeSwitched?: boolean;
    local?: boolean;
    csl?: boolean;
    error?: string;
    rateLimited?: boolean;
    openWeb?: string;
  }> {
    const skinPng =
      resolveSkinPng(cosmetics?.skinDataUrl) || resolveSkinPng(cosmetics?.skinId);
    const capePngRaw =
      resolveSkinPng(cosmetics?.capeDataUrl) || resolveSkinPng(cosmetics?.capeId);
    const variant: 'classic' | 'slim' =
      cosmetics?.variant === 'slim' ? 'slim' : 'classic';
    const username = account?.name || account?.username || 'Player';
    const accType = account?.meta?.type || account?.type;
    const localCapeId = String(cosmetics?.capeId || '');
    const isOfficialMsaCape = localCapeId.startsWith('cape-msa-');
    const hideCape = cosmetics?.hideCape === true || cosmetics?.capeId === '';
    // Официальный MSA тоже в LocalSkin — актуальный PNG выбора (не кэш MojangAPI)
    const useLocalCape = !hideCape && !!capePngRaw && !!localCapeId;
    const capePng = useLocalCape ? capePngRaw : null;

    let uploaded = false;
    let capeSwitched = false;
    let uploadError: string | undefined;
    let openWeb: string | undefined;

    // LocalSkin/CSL во все сборки (или в указанный buildId) — до upload, чтобы 429 не ломал игру
    let local = false;
    let csl = false;
    if (skinPng || capePng || (accType === 'msa' && (isOfficialMsaCape || hideCape))) {
      const mirrored = await mirrorLocalCosmeticsToBuilds(
        username,
        skinPng,
        capePng,
        accType,
        {
          buildId: cosmetics?.buildId ? String(cosmetics.buildId) : undefined,
          loader: cosmetics?.loader,
          gameVersion: cosmetics?.gameVersion,
          useLocalCape,
        },
      );
      local = mirrored.local;
      csl = mirrored.csl;
    } else if (cosmetics?.buildId) {
      // Только конфиг loadlist (MSA без ElyBy), PNG не трогаем
      const instanceDir = getInstanceRoot(String(cosmetics.buildId));
      fs.mkdirSync(instanceDir, { recursive: true });
      writeLocalCosmetics(instanceDir, username, null, null, accType, { useLocalCape: false });
      local = true;
      if (String(cosmetics.loader || 'vanilla').toLowerCase() !== 'vanilla') {
        csl = await ensureCustomSkinLoader(
          instanceDir,
          cosmetics.loader || 'fabric',
          cosmetics.gameVersion || '1.20.1',
        );
      }
    }

    const prevMeta = readActiveCosmeticsMeta();
    // Skip upload только если этот скин УЖЕ успешно залит (не путать с desired skinId)
    const sameSkin =
      !cosmetics?.forceSkinUpload
      && !!cosmetics?.skinId
      && prevMeta?.uploadedSkinId === cosmetics.skinId
      && prevMeta?.uploadedVariant === variant;

    if (skinPng && !sameSkin) {
      const up = await uploadSkinToAccount(account, skinPng, variant);
      uploaded = up.ok;
      if (!up.ok && up.error !== 'offline') {
        if (/429|too many/i.test(String(up.error))) {
          uploadError = 'rate_limited';
        } else {
          uploadError = up.error;
        }
      }
      if (!up.ok && up.openWeb) openWeb = 'https://ely.by/skins';
      if (up.ok && cosmetics?.skinId) {
        patchActiveCosmeticsMeta({
          uploadedSkinId: cosmetics.skinId,
          uploadedVariant: variant,
        });
      }
    } else if (sameSkin) {
      console.log('[cosmetics] skin upload skipped (confirmed uploaded)', cosmetics?.skinId);
    }

    if (accType === 'msa') {
      try {
        if (isOfficialMsaCape) {
          const mojangId = String(
            cosmetics?.mojangCapeId
            || mojangCapeIdFromLocalId(localCapeId, account?.uuid),
          ).trim();
          console.log('[cosmetics] MSA cape switch', {
            localCapeId,
            mojangId,
            useLocalCape,
            hasCapePng: !!capePng,
          });
          if (mojangId) {
            const metaNow = readActiveCosmeticsMeta();
            const profileActive = String(metaNow?.profileActiveCapeId || '');
            // На запуске форсируем PUT, если выбор UI ≠ реальный ACTIVE с профиля
            const needForce =
              cosmetics?.forceCapeSwitch === true
              || !profileActive
              || profileActive !== mojangId;
            const sw = await switchMsaCape(account, mojangId, { force: needForce });
            if (sw.account) account = sw.account;
            if (sw.rateLimited) {
              uploadError = uploadError || 'rate_limited';
            } else if (sw.error === 'cape_mismatch') {
              uploadError = uploadError || 'cape_mismatch';
              console.warn('[cosmetics] cape mismatch after PUT', sw.actualCapeId);
            } else if (sw.applied || sw.skipped) {
              capeSwitched = true;
            }
          }
        } else if (cosmetics?.hideCape === true || cosmetics?.capeId === '') {
          const eml = await loadEML();
          await new eml.Skin(account).hideCape();
          confirmMsaCapeId(String(account?.uuid || ''), null);
          capeSwitched = true;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn('[cosmetics] MSA cape switch failed:', message, 'localId=', localCapeId);
        uploadError = uploadError || message;
      }
    }

    // Кэш активного комплекта (на случай запуска без dataUrl).
    // mojangCapeId здесь НЕ пишем из выбора UI — только desired*; confirmed обновляет switchMsaCape/sync.
    try {
      const activeDir = path.join(appDataDir, 'active-cosmetics');
      fs.mkdirSync(activeDir, { recursive: true });
      if (skinPng) fs.writeFileSync(path.join(activeDir, 'skin.png'), skinPng);
      // Кэш превью: для официального MSA тоже сохраняем PNG (UI), но не в LocalSkin
      if (capePngRaw) fs.writeFileSync(path.join(activeDir, 'cape.png'), capePngRaw);
      else if (fs.existsSync(path.join(activeDir, 'cape.png'))) {
        fs.unlinkSync(path.join(activeDir, 'cape.png'));
      }
      const prev = readActiveCosmeticsMeta();
      const desiredMojang =
        cosmetics?.mojangCapeId
        || (isOfficialMsaCape
          ? mojangCapeIdFromLocalId(localCapeId, account?.uuid)
          : null)
        || prev?.desiredMojangCapeId
        || null;
      writeJSON(path.join(activeDir, 'meta.json'), {
        ...prev,
        variant,
        skinId: cosmetics?.skinId || null,
        desiredSkinId: cosmetics?.skinId || prev?.desiredSkinId || null,
        // confirmed upload — только после ok (patch выше); здесь не затираем
        uploadedSkinId: prev?.uploadedSkinId ?? null,
        uploadedVariant: prev?.uploadedVariant ?? null,
        capeId: cosmetics?.capeId || null,
        desiredMojangCapeId: desiredMojang,
        // confirmed ACTIVE — не затирать желаемым id (баг «плащ не применяется»)
        mojangCapeId: prev?.mojangCapeId ?? null,
        username,
        skinMetaV2: true,
        capeMetaV2: true,
      });
    } catch {
      /* ignore */
    }

    return {
      success: uploaded || capeSwitched || local || !!skinPng,
      uploaded,
      capeSwitched,
      local,
      csl,
      // 429 не фатален, если LocalSkin+CSL реально готовы; иначе оставляем ошибку
      error: uploadError === 'rate_limited' && local && csl ? undefined : uploadError,
      rateLimited: uploadError === 'rate_limited' || undefined,
      openWeb,
    };
  }

  ipcMain.handle('launcher:cosmetics:apply', async (_event, payload: any) => {
    try {
      return await applyCosmetics(payload?.account, payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  });

  /**
   * Прямой запрос Microsoft Profile — полный список owned capes.
   * Session-profile Mojang отдаёт только НАДЕТЫЙ плащ — из‑за него в UI был один.
   */
  async function fetchMicrosoftProfileCosmetics(account: any): Promise<{
    skins: { id: string; url: string; state: string; variant: string }[];
    capes: { id: string; url: string; state: string; alias: string }[];
  }> {
    const req = await fetch('https://api.minecraftservices.com/minecraft/profile', {
      headers: { Authorization: `Bearer ${account.accessToken}` },
    });
    if (!req.ok) {
      const errorText = await req.text();
      throw new Error(`Microsoft profile HTTP ${req.status}: ${errorText.slice(0, 200)}`);
    }
    const data = await req.json();
    const skins = (data?.skins || []).map((skin: any) => ({
      id: String(skin.id),
      url: String(skin.url),
      state: String(skin.state || '').toLowerCase() === 'active' ? 'active' : 'inactive',
      variant: String(skin.variant || '').toUpperCase() === 'SLIM' ? 'slim' : 'classic',
    }));
    const capes = (data?.capes || []).map((cape: any) => ({
      id: String(cape.id),
      url: String(cape.url),
      state: String(cape.state || '').toLowerCase() === 'active' ? 'active' : 'inactive',
      alias: String(cape.alias || cape.id || 'cape'),
    }));
    return { skins, capes };
  }

  /** Все скины/плащи профиля MSA (полный список) и Ely */
  ipcMain.handle('launcher:cosmetics:listProfile', async (_event, account: any) => {
    try {
      let acc = account;
      const type = acc?.meta?.type || acc?.type;
      if (type !== 'msa' && type !== 'yggdrasil') {
        return { success: false, error: 'unsupported', skins: [], capes: [] };
      }

      // Протухший MSA-токен — обновить и повторить
      if (type === 'msa') {
        const withConfirmed = async (profileAcc: any) => {
          const profile = await fetchMicrosoftProfileCosmetics(profileAcc);
          const activeCape = (profile.capes || []).find((c) => c.state === 'active');
          // Снять «яд» meta: confirmed = реальный ACTIVE с аккаунта
          confirmMsaCapeId(String(profileAcc?.uuid || ''), activeCape?.id || null);
          return profile;
        };
        try {
          return {
            success: true,
            ...(await withConfirmed(acc)),
          };
        } catch (firstErr) {
          const eml = await loadEML();
          try {
            const refreshed = await new eml.MicrosoftAuth(mainWindow).refresh(acc);
            if (refreshed?.accessToken) {
              acc = refreshed;
              return {
                success: true,
                account: refreshed,
                ...(await withConfirmed(acc)),
              };
            }
          } catch {
            /* fall through */
          }
          const message = firstErr instanceof Error ? firstErr.message : String(firstErr);
          return { success: false, error: message, skins: [], capes: [] };
        }
      }

      // Ely: полный каталог плащей API не отдаёт — только текущие текстуры
      const eml = await loadEML();
      const skinApi = new eml.Skin(acc);
      await skinApi.reload();
      const skins = await skinApi.getSkins(false);
      const capes = await skinApi.getCapes(false);
      return { success: true, skins, capes };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message, skins: [], capes: [] };
    }
  });

  /**
   * Переключить официальный плащ MSA (capeId) или скрыть (null).
   * Кастомный PNG через это API надеть нельзя.
   */
  ipcMain.handle(
    'launcher:cosmetics:switchCape',
    async (_event, account: any, capeId: string | null) => {
      try {
        const type = account?.meta?.type || account?.type;
        if (type !== 'msa') {
          return { success: false, error: 'msa_only' };
        }
        let acc = account;
        if (capeId) {
          const mojangId = capeId.startsWith('cape-msa-')
            ? mojangCapeIdFromLocalId(capeId, acc?.uuid)
            : capeId;
          if (!mojangId) {
            return { success: false, error: 'invalid_cape_id' };
          }
          const sw = await switchMsaCape(acc, mojangId, { force: true });
          if (sw.account) acc = sw.account;
          if (sw.rateLimited) {
            return { success: false, error: 'rate_limited', account: sw.account };
          }
          if (sw.error === 'cape_mismatch') {
            return {
              success: false,
              error: 'cape_mismatch',
              actualCapeId: sw.actualCapeId,
              account: sw.account,
            };
          }
          if (!sw.applied && !sw.skipped) {
            return {
              success: false,
              error: sw.error || 'cape_not_applied',
              account: sw.account,
            };
          }
          return {
            success: true,
            applied: !!sw.applied,
            skipped: !!sw.skipped,
            actualCapeId: sw.actualCapeId,
            account: acc !== account ? acc : undefined,
          };
        }
        const eml = await loadEML();
        await new eml.Skin(acc).hideCape();
        confirmMsaCapeId(String(acc?.uuid || ''), null);
        // Без GET /profile — экономим лимит Microsoft API
        return { success: true, applied: true, account: acc !== account ? acc : undefined };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn('[cosmetics] switchCape IPC failed:', message);
        return { success: false, error: message };
      }
    },
  );

  /* ===== VERSIONS ===== */

  ipcMain.handle('launcher:versions:list', async () => {
    try {
      const res = await fetch('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json');
      if (!res.ok) return [];
      const data = await res.json();
      return data.versions || [];
    } catch {
      return [];
    }
  });

  /* ===== LOADER VERSIONS ===== */

  function compareSemver(a: string, b: string): number {
    const pa = a.split(/[^0-9]/).filter(Boolean).map(Number);
    const pb = b.split(/[^0-9]/).filter(Boolean).map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const na = pa[i] || 0;
      const nb = pb[i] || 0;
      if (na !== nb) return na - nb;
    }
    return a.localeCompare(b);
  }

  const mojangManifestCache: { ts: number; release: string; snapshot: string } = { ts: 0, release: '', snapshot: '' };

  async function resolveMcVersion(mcVersion: string): Promise<string> {
    if (mcVersion !== 'latest_release' && mcVersion !== 'latest_snapshot') return mcVersion;
    const now = Date.now();
    if (!mojangManifestCache.release || now - mojangManifestCache.ts > 10 * 60 * 1000) {
      const res = await fetch('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json');
      if (!res.ok) return '';
      const data = await res.json();
      mojangManifestCache.release = data.latest?.release || '';
      mojangManifestCache.snapshot = data.latest?.snapshot || '';
      mojangManifestCache.ts = now;
    }
    return mcVersion === 'latest_snapshot' ? mojangManifestCache.snapshot : mojangManifestCache.release;
  }

  ipcMain.handle('launcher:loader:versions', async (_event, loader: string, mcVersion: string) => {
    try {
      const mc = await resolveMcVersion(mcVersion);
      if (!mc) return [];
      if (loader === 'fabric' || loader === 'quilt') {
        const url = loader === 'fabric'
          ? `https://meta.fabricmc.net/v2/versions/loader/${mc}`
          : `https://meta.quiltmc.org/v3/versions/loader/${mc}`;
        const res = await fetch(url);
        if (!res.ok) return [];
        const data = await res.json();
        const versions = (data as any[]).map(v => v.loader?.version).filter(Boolean);
        return versions.sort((a: string, b: string) => compareSemver(b, a));
      }
      if (loader === 'forge') {
        const res = await fetch('https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml');
        if (!res.ok) return [];
        const text = await res.text();
        const match = text.match(/<version>([^<]+)<\/version>/g);
        if (!match) return [];
        const versions = match.map(v => v.replace(/<\/?version>/g, '')).filter(v => v.startsWith(mc + '-'));
        return versions.sort((a: string, b: string) => compareSemver(b, a));
      }
      if (loader === 'neoforge') {
        const parts = mc.split('.');
        const prefix = parts.length >= 3 ? parts[1] + '.' + parts[2] : parts[1] + '.0';
        const res = await fetch('https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml');
        if (!res.ok) return [];
        const text = await res.text();
        const match = text.match(/<version>([^<]+)<\/version>/g);
        if (!match) return [];
        const versions = match.map(v => v.replace(/<\/?version>/g, '')).filter(v => v.startsWith(prefix));
        return versions.sort((a: string, b: string) => compareSemver(b, a));
      }
      return [];
    } catch {
      return [];
    }
  });

  /* ===== LAUNCH ===== */

  function formatBytes(bytes: number): string {
    if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(2) + ' GB';
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(2) + ' MB';
    if (bytes >= 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return bytes + ' B';
  }

  let lastProgressSent: Record<string, number> = {};
  const PROGRESS_THROTTLE: Record<string, number> = { download: 100, log: 50, debug: 50 };

  function sendProgress(data: any): void {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const throttle = PROGRESS_THROTTLE[data.kind];
      if (throttle) {
        const now = Date.now();
        if (now - (lastProgressSent[data.kind] || 0) < throttle) return;
        lastProgressSent[data.kind] = now;
      }
      mainWindow.webContents.send('launcher:progress', data);
    }
    for (const sink of progressSinks) {
      try { sink(data); } catch { /* ignore */ }
    }
  }

  async function resolveJavaVersion(gameVersion: string): Promise<number> {
    const staticMapping: Record<string, number> = {
      'latest_release': 25,
      'latest_snapshot': 25,
    };
    try {
      const manifest = await fetchJsonCached('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json');
      const resolveId = staticMapping[gameVersion]
        ? (gameVersion === 'latest_release' ? manifest.latest?.release : gameVersion === 'latest_snapshot' ? manifest.latest?.snapshot : '')
        : gameVersion;
      const entry = manifest.versions?.find((v: any) => v.id === resolveId);
      if (entry?.url) {
        const verData = await fetchJsonCached(entry.url);
        const majorVersion = verData.javaVersion?.majorVersion;
        if (typeof majorVersion === 'number' && majorVersion >= 8) return majorVersion;
      }
    } catch {}
    if (staticMapping[gameVersion]) return staticMapping[gameVersion];
    // Fallback heuristic
    const parts = gameVersion.split('.').map(Number);
    if (parts.some(isNaN)) return 21;
    if (parts[0] > 1) return 25;
    if (parts[0] === 1 && parts[1] >= 22) return 21;
    if (parts[0] === 1 && parts[1] >= 21) return 21;
    if (parts[0] === 1 && parts[1] >= 18) return 17;
    if (parts[0] === 1 && parts[1] >= 17) return 16;
    return 8;
  }

  const JAVA_MANAGED_VERSIONS = [8, 11, 16, 17, 21, 24, 25];

  function javaToolsDir(): string {
    return path.join(appDataDir, 'tools');
  }

  async function ensureJava(javaVer: number, onProgress?: (data: { status: 'download' | 'extract' | 'done'; ver: number }) => void): Promise<string> {
    const toolsDir = javaToolsDir();
    const javaDir = path.join(toolsDir, `java${javaVer}`);
    const javaExe = path.join(javaDir, 'bin', 'java.exe');
    if (fs.existsSync(javaExe)) {
      if (onProgress) onProgress({ status: 'done', ver: javaVer });
      return javaExe;
    }

    if (onProgress) onProgress({ status: 'download', ver: javaVer });

    const arch = process.arch === 'x64' ? 'x64' : 'x86';
    const downloadUrls = [
      `https://api.adoptium.net/v3/binary/latest/${javaVer}/ga/windows/${arch}/jdk/hotspot/normal/eclipse`,
      `https://api.adoptium.net/v3/binary/latest/${javaVer}/ga/windows/${arch}/jdk/hotspot/normal/eclipse?project=jdk`,
      `https://api.azul.com/zulu/download/community/v1.0/bundles/latest/binary/?java_version=${javaVer}&os=windows&arch=${arch === 'x64' ? 'x86_64' : 'x86'}&ext=zip&javafx=false&community=true`,
    ];

    const reportJavaProgress = (receivedNow: number, totalBytes: number, speed?: number) => {
      sendProgress({
        kind: 'download',
        key: 'smp.downloadJava',
        params: { ver: javaVer },
        total: { size: totalBytes, amount: 1 },
        downloaded: { size: receivedNow, amount: 0 },
        speed,
      });
    };

    let buffer: Buffer | null = null;
    for (const url of downloadUrls) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(600000) });
        if (!res.ok) continue;
        const totalBytes = Number(res.headers.get('content-length') || 0);
        const reader = res.body?.getReader();
        if (!reader) {
          buffer = Buffer.from(await res.arrayBuffer());
          break;
        }
        const chunks: Uint8Array[] = [];
        let received = 0;
        let lastSpeed = 0;
        let lastSample = Date.now();
        if (totalBytes > 0) reportJavaProgress(0, totalBytes);
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) chunks.push(value);
          received += value.length;
          const now = Date.now();
          if (now - lastSample >= 150) {
            const dt = (now - lastSample) / 1000;
            const speed = dt > 0 ? (received - lastSpeed) / dt : 0;
            lastSpeed = received;
            lastSample = now;
            reportJavaProgress(received, totalBytes, speed);
          }
        }
        buffer = Buffer.concat(chunks);
        reportJavaProgress(received, totalBytes);
        break;
      } catch {}
    }

    if (!buffer) throw new Error(`Failed to download Java ${javaVer}`);

    if (!fs.existsSync(toolsDir)) fs.mkdirSync(toolsDir, { recursive: true });
    const zipPath = path.join(toolsDir, `java${javaVer}.zip`);
    fs.writeFileSync(zipPath, buffer);

    if (onProgress) onProgress({ status: 'extract', ver: javaVer });
    else sendProgress({ kind: 'status', key: 'smp.extractJava', params: { ver: javaVer } });
    execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${toolsDir}' -Force"`, { timeout: 60000 });
    try { fs.unlinkSync(zipPath); } catch {}

    const entries = fs.readdirSync(toolsDir);
    const jdkDir = entries.find(e => e.startsWith('jdk-') || e.startsWith(`jdk${javaVer}`) || e.startsWith(`zulu`));
    if (jdkDir) {
      const extractedExe = path.join(toolsDir, jdkDir, 'bin', 'java.exe');
      if (fs.existsSync(extractedExe)) {
        try { fs.renameSync(path.join(toolsDir, jdkDir), javaDir); } catch {}
      }
    }

    if (!fs.existsSync(javaExe)) throw new Error(`Java ${javaVer} not found after extraction`);
    return javaExe;
  }

  let javaRuntimesCache: { at: number; result: { name: string; path: string; version: number }[] } | null = null;
  const JAVA_RUNTIMES_CACHE_TTL = 10000;

  function invalidateJavaRuntimesCache(): void {
    javaRuntimesCache = null;
  }

  function detectJavaRuntimes(): { name: string; path: string; version: number }[] {
    if (javaRuntimesCache && Date.now() - javaRuntimesCache.at < JAVA_RUNTIMES_CACHE_TTL) {
      return javaRuntimesCache.result;
    }
    const found: { name: string; path: string; version: number }[] = [];
    const roots: string[] = [
      process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'Java') : '',
      process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'Eclipse Adoptium') : '',
      process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'Microsoft') : '',
      process.env['ProgramFiles(x86)'] ? path.join(process.env['ProgramFiles(x86)'], 'Java') : '',
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs') : '',
      javaToolsDir(),
    ];
    const seen = new Set<string>();
    const tryDir = (dir: string): void => {
      const javaExe = path.join(dir, 'bin', 'java.exe');
      if (!fs.existsSync(javaExe) || seen.has(javaExe)) return;
      seen.add(javaExe);
      let version = 0;
      try {
        const out = execSync(`"${javaExe}" -version 2>&1`, { encoding: 'utf8', timeout: 8000 });
        const m = out.match(/version\s+"(\d+)(?:\.(\d+))?/);
        if (m) version = m[1] === '1' ? parseInt(m[2] || '8', 10) : parseInt(m[1], 10);
      } catch {}
      if (version === 0) {
        const m = path.basename(dir).match(/(\d{1,2})(?:\.\d+)*/);
        if (m) version = parseInt(m[1], 10);
      }
      if (version > 0) found.push({ name: path.basename(dir), path: javaExe, version });
    };
    for (const root of roots) {
      if (!root || !fs.existsSync(root)) continue;
      let dirs: string[] = [];
      try {
        dirs = fs.readdirSync(root, { withFileTypes: true })
          .filter(d => d.isDirectory())
          .map(d => path.join(root, d.name));
      } catch { continue; }
      for (const dir of dirs) tryDir(dir);
    }
    found.sort((a, b) => a.version - b.version);
    javaRuntimesCache = { at: Date.now(), result: found };
    return found;
  }

  function listJavaVersions(): { version: number; installed: boolean; managed: boolean; path: string | null; systemPaths: string[] }[] {
    const runtimes = detectJavaRuntimes();
    return JAVA_MANAGED_VERSIONS.map(version => {
      const managedExe = path.join(javaToolsDir(), `java${version}`, 'bin', 'java.exe');
      const managed = fs.existsSync(managedExe);
      const systemPaths = runtimes.filter(j => j.version === version && j.path !== managedExe).map(j => j.path);
      const installed = managed || systemPaths.length > 0;
      return { version, installed, managed, path: managed ? managedExe : (systemPaths[0] || null), systemPaths };
    });
  }

  function removeManagedJava(version: number): { success: boolean; error?: string } {
    const javaDir = path.join(javaToolsDir(), `java${version}`);
    if (!fs.existsSync(javaDir)) return { success: true };
    try {
      fs.rmSync(javaDir, { recursive: true, force: true });
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  function bestRuntimeFor(javaVer: number, runtimes: { name: string; path: string; version: number }[]): string | undefined {
    if (runtimes.length === 0) return undefined;
    const exact = runtimes.find(j => j.version === javaVer);
    if (exact) return exact.path;
    const atLeast = runtimes.filter(j => j.version >= javaVer);
    if (atLeast.length > 0) {
      return atLeast.reduce((a, b) => (a.version < b.version ? a : b)).path;
    }
    return undefined;
  }

  function readZipEntry(zipPath: string, entryName: string): Buffer | null {
    try {
      const buf = fs.readFileSync(zipPath);
      // Find EOCD (End of Central Directory Record)
      let eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4B, 0x05, 0x06]));
      if (eocd < 0) return null;
      const cdOffset = buf.readUInt32LE(eocd + 16);
      const cdEntries = buf.readUInt16LE(eocd + 10);
      // Search central directory for the entry
      let pos = cdOffset;
      const entryNameLower = entryName.replace(/\//g, '\\').toLowerCase();
      for (let i = 0; i < cdEntries; i++) {
        if (buf.readUInt32LE(pos) !== 0x02014B50) break;
        const nameLen = buf.readUInt16LE(pos + 28);
        const extraLen = buf.readUInt16LE(pos + 30);
        const commentLen = buf.readUInt16LE(pos + 32);
        const localOffset = buf.readUInt32LE(pos + 42);
        const name = buf.toString('utf8', pos + 46, pos + 46 + nameLen).replace(/\//g, '\\').toLowerCase();
        if (name === entryNameLower) {
          // Read from local file header
          let lPos = localOffset;
          if (buf.readUInt32LE(lPos) !== 0x04034B50) return null;
          const compMethod = buf.readUInt16LE(lPos + 8);
          const compSize = buf.readUInt32LE(lPos + 18);
          const uncompSize = buf.readUInt32LE(lPos + 22);
          const lNameLen = buf.readUInt16LE(lPos + 26);
          const lExtraLen = buf.readUInt16LE(lPos + 28);
          const dataStart = lPos + 30 + lNameLen + lExtraLen;
          const data = buf.subarray(dataStart, dataStart + compSize);
          if (compMethod === 0) return data;
          if (compMethod === 8) return zlib.inflateRawSync(data);
          return null;
        }
        pos += 46 + nameLen + extraLen + commentLen;
      }
    } catch {}
    return null;
  }

  function tryParseJson(buf: Buffer | null): any {
    if (!buf) return null;
    try { return JSON.parse(buf.toString('utf-8')); } catch { return null; }
  }

  function readFabricModInfo(jarPath: string): { name: string; version: string; id?: string; description?: string } | null {
    const data = readZipEntry(jarPath, 'fabric.mod.json');
    if (!data) return null;
    const json = tryParseJson(data);
    if (!json) return null;
    return { name: json.name || json.id || '', version: json.version || '', id: json.id || undefined, description: json.description || undefined };
  }

  function readQuiltModInfo(jarPath: string): { name: string; version: string; id?: string; description?: string } | null {
    const data = readZipEntry(jarPath, 'quilt.mod.json');
    if (!data) return null;
    const json = tryParseJson(data);
    if (!json) return null;
    const ql = json['quilt_loader'];
    if (ql) return { name: ql.metadata?.name || ql.id || '', version: ql.version || '', id: ql.id || undefined, description: ql.metadata?.description || undefined };
    return { name: json.name || json.id || '', version: json.version || '', id: json.id || undefined, description: json.description || undefined };
  }

  function readForgeModInfo(jarPath: string): { name: string; version: string; id?: string; description?: string } | null {
    // Try META-INF/neoforge.mods.toml first, then META-INF/mods.toml
    for (const p of ['META-INF/neoforge.mods.toml', 'META-INF/mods.toml']) {
      const data = readZipEntry(jarPath, p);
      if (!data) continue;
      const toml = data.toString('utf-8');
      // Simple TOML parser for mod metadata
      const modIdMatch = toml.match(/modId\s*=\s*["']([^"']+)["']/i);
      const nameMatch = toml.match(/\[\[mods\]\][\s\S]*?(?:modId|name)\s*=\s*["']([^"']+)["']/);
      const verMatch = toml.match(/version\s*=\s*["']([^"']+)["']/i);
      const descMatch = toml.match(/description\s*=\s*["']([^"']+)["']/i);
      let name = nameMatch?.[1] || modIdMatch?.[1] || '';
      // Try to get display name
      const displayNameMatch = toml.match(/displayName\s*=\s*["']([^"']+)["']/i);
      if (displayNameMatch) name = displayNameMatch[1];
      return { name, version: verMatch?.[1] || '', id: modIdMatch?.[1] || undefined, description: descMatch?.[1] || undefined };
    }
    return null;
  }

  function readPackMcmeta(fileOrDir: string): { name: string; description: string } | null {
    try {
      const stat = fs.statSync(fileOrDir);
      let data: Buffer | null = null;
      if (stat.isFile()) {
        data = readZipEntry(fileOrDir, 'pack.mcmeta');
      } else if (stat.isDirectory()) {
        const metaPath = path.join(fileOrDir, 'pack.mcmeta');
        if (fs.existsSync(metaPath)) data = fs.readFileSync(metaPath);
      }
      if (!data) return null;
      const json = tryParseJson(data);
      if (!json?.pack) return null;
      const desc = json.pack.description;
      return {
        name: json.pack.name || json.pack.title || path.basename(fileOrDir).replace(/\.(zip|jar)$/i, ''),
        description: typeof desc === 'string' ? desc : desc?.text || '',
      };
    } catch { return null; }
  }

  function scanFolder(dir: string, ext: string[], contentType: string): any[] {
    if (!fs.existsSync(dir)) return [];
    const results: any[] = [];
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      const extLower = path.extname(item.name).toLowerCase();
      if (item.isFile() && ext.includes(extLower)) {
        let name = item.name.replace(/\.[^.]+(?:\.disabled)?$/i, '');
        let version = '';
        const verMatch = name.match(/-(\d+(?:\.\d+)*)/);
        if (verMatch) { version = verMatch[1]; name = name.replace(/-?\d+(?:\.\d+)*$/, '').trim(); }
        const disabled = item.name.toLowerCase().endsWith('.disabled');
        let id = '';
        let description = '';
        if (contentType === 'mod') {
          const info = readFabricModInfo(fullPath) || readQuiltModInfo(fullPath) || readForgeModInfo(fullPath);
          if (info) { name = info.name; version = info.version; description = info.description || ''; id = info.id || ''; }
        }
        if (!description) {
          const mcmeta = readPackMcmeta(fullPath);
          if (mcmeta) description = mcmeta.description || '';
        }
        results.push({ name, filename: item.name, enabled: !disabled, version, id, description, contentType, fullPath });
      } else if (item.isDirectory() && contentType !== 'mod') {
        const mcmeta = readPackMcmeta(fullPath);
        results.push({
          name: mcmeta?.name || item.name,
          filename: item.name,
          enabled: true,
          version: '',
          description: mcmeta?.description || '',
          contentType,
          fullPath,
        });
      }
    }
    return results;
  }

  const CACHE_FILE = '.uclient-cache.json';

  function loadCache(instanceRoot: string): Record<string, any> {
    const cachePath = path.join(instanceRoot, CACHE_FILE);
    try {
      if (fs.existsSync(cachePath)) {
        return JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      }
    } catch {}
    return {};
  }

  function saveCache(instanceRoot: string, cache: Record<string, any>): void {
    try {
      const cachePath = path.join(instanceRoot, CACHE_FILE);
      const tmpPath = cachePath + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(cache));
      fs.renameSync(tmpPath, cachePath);
    } catch {}
  }

  async function enrichWithModrinth(item: any, projectType: string, cache: Record<string, any>): Promise<any> {
    if (!item.name) return delete item.fullPath, item;
    try {
      let projectId = '';
      let iconUrl = '';
      let description = '';
      let hash = '';

      if (item.fullPath) {
        try {
          const stat = fs.statSync(item.fullPath);
          if (stat.isFile()) {
            const buf = await fs.promises.readFile(item.fullPath);
            hash = crypto.createHash('sha1').update(buf).digest('hex');
          }
        } catch {}
      }

      // Check cache by filename + hash
      const cachedEntry = cache[item.filename];
      if (cachedEntry && cachedEntry.hash === hash && cachedEntry.projectId) {
        item.projectId = cachedEntry.projectId;
        item.iconUrl = cachedEntry.iconUrl || '';
        if (!item.description) item.description = cachedEntry.description || '';
        return delete item.fullPath, item;
      }

      // Cache miss — fetch from Modrinth

      // Strategy 1: Hash-based lookup
      if (hash) {
        try {
          const hashRes = await fetch(`https://api.modrinth.com/v2/version_file/${hash}?algorithm=sha1`);
          if (hashRes.ok) {
            const versionInfo = await hashRes.json();
            if (versionInfo.project_id) {
              projectId = versionInfo.project_id;
              const projRes = await fetch(`https://api.modrinth.com/v2/project/${projectId}`);
              if (projRes.ok) {
                const proj = await projRes.json();
                iconUrl = proj.icon_url || '';
                description = proj.description || '';
              }
            }
          }
        } catch {}
      }

      // Strategy 2: Direct lookup by mod id (slug)
      if (!projectId && item.id && projectType === 'mod') {
        try {
          const directRes = await fetch(`https://api.modrinth.com/v2/project/${encodeURIComponent(item.id)}`);
          if (directRes.ok) {
            const proj = await directRes.json();
            projectId = proj.id || '';
            iconUrl = proj.icon_url || '';
            description = proj.description || '';
          }
        } catch {}
      }

      // Strategy 3: Search by name
      if (!projectId) {
        try {
          const facets = JSON.stringify([[`project_type:${projectType}`]]);
          const res = await fetch(`https://api.modrinth.com/v2/search?query=${encodeURIComponent(item.name)}&limit=1&facets=[${facets}]`);
          if (res.ok) {
            const data = await res.json();
            if (data.hits?.[0]) {
              projectId = data.hits[0].project_id;
              iconUrl = data.hits[0].icon_url || '';
              description = data.hits[0].description || '';
            }
          }
        } catch {}
      }

      if (projectId) {
        item.projectId = projectId;
        item.iconUrl = iconUrl;
        if (!item.description) item.description = description;
        // Save to cache
        cache[item.filename] = {
          projectId,
          iconUrl: iconUrl || '',
          description: item.description || '',
          hash: hash || '',
          cachedAt: new Date().toISOString(),
        };
      } else if (hash) {
        // Remember that this file has no match (avoid re-fetching)
        cache[item.filename] = { projectId: '', iconUrl: '', description: '', hash, cachedAt: new Date().toISOString() };
      }
    } catch (e) {
      console.warn(`Failed to enrich ${item.filename}:`, e);
    }
    delete item.fullPath;
    return item;
  }

  ipcMain.handle('launcher:scan-instance', async (_event, buildId: string) => {
    const root = getInstanceRoot(buildId);
    const cache = loadCache(root);
    const result: Record<string, any[]> = { mods: [], resourcepacks: [], shaders: [], datapacks: [] };
    if (!fs.existsSync(root)) return result;
    result.mods = scanFolder(path.join(root, 'mods'), ['.jar', '.litemod'], 'mod');
    result.resourcepacks = scanFolder(path.join(root, 'resourcepacks'), ['.zip'], 'resourcepack');
    result.shaders = scanFolder(path.join(root, 'shaderpacks'), ['.zip'], 'shader');
    result.datapacks = scanFolder(path.join(root, 'datapacks'), ['.zip'], 'datapack');
    const allItems = [...result.mods, ...result.resourcepacks, ...result.shaders, ...result.datapacks];
    await Promise.all(allItems.map(item => enrichWithModrinth(item, item.contentType, cache)));
    saveCache(root, cache);
    return result;
  });

  ipcMain.handle('launcher:get-instance-path', async (_event, buildId: string) => {
    return getInstanceRoot(buildId);
  });

  function safeSubPath(instanceRoot: string, sub: string, name: string): string | null {
    const base = path.resolve(path.join(instanceRoot, sub));
    const target = path.resolve(path.join(base, name));
    if (target !== base && !target.startsWith(base + path.sep)) return null;
    return target;
  }

  ipcMain.handle('launcher:list-screenshots', async (_event, buildId: string) => {
    const dir = path.join(getInstanceRoot(buildId), 'screenshots');
    if (!fs.existsSync(dir)) return [];
    const shots: any[] = [];
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!item.isFile() || !/\.png$/i.test(item.name)) continue;
      const full = path.join(dir, item.name);
      let thumb = '';
      try {
        const img = nativeImage.createFromPath(full);
        if (!img.isEmpty()) {
          const size = img.getSize();
          const w = size.width > 320 ? Math.max(1, Math.round((320 * size.height) / size.width)) : size.width;
          thumb = img.resize({ width: w, quality: 'good' }).toDataURL();
        }
      } catch { /* skip thumbnail */ }
      let stat: fs.Stats | null = null;
      try { stat = fs.statSync(full); } catch { /* skip */ }
      if (!stat) continue;
      shots.push({ name: item.name, size: stat.size, modified: stat.mtimeMs, thumb });
    }
    shots.sort((a, b) => b.modified - a.modified);
    return shots;
  });

  function folderSize(dir: string, maxBytes = 4 * 1024 * 1024 * 1024): number {
    let total = 0;
    try {
      for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        if (total > maxBytes) return total;
        const full = path.join(dir, item.name);
        if (item.isDirectory()) {
          total += folderSize(full, maxBytes - total);
        } else if (item.isFile()) {
          try { total += fs.statSync(full).size; } catch { /* skip */ }
        }
      }
    } catch { /* skip */ }
    return total;
  }

  function nbtValue(tag: any): any {
    if (tag == null) return undefined;
    if (typeof tag === 'object' && tag !== null && 'value' in tag) return tag.value;
    return tag;
  }

  function worldIconDataUrl(buffer: Buffer): string {
    const img = nativeImage.createFromBuffer(buffer);
    if (img.isEmpty()) return '';
    const size = img.getSize();
    const w = size.width > 128 ? Math.max(1, Math.round((128 * size.height) / size.width)) : size.width;
    return img.resize({ width: w, quality: 'good' }).toDataURL();
  }

  ipcMain.handle('launcher:list-worlds', async (_event, buildId: string) => {
    const dir = path.join(getInstanceRoot(buildId), 'saves');
    if (!fs.existsSync(dir)) return [];
    const worlds: any[] = [];
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!item.isDirectory()) continue;
      const wdir = path.join(dir, item.name);
      const datPath = path.join(wdir, 'level.dat');
      if (!fs.existsSync(datPath)) continue;
      const entry: any = { folder: item.name, name: item.name, icon: '', lastPlayed: 0, gameType: 0, hardcore: false, difficulty: 0, version: '', size: 0 };
      try {
        const buf = fs.readFileSync(datPath);
        const { parsed } = await nbtLib().parse(buf);
        const data: any = parsed?.value?.Data?.value || {};
        const levelName = nbtValue(data.LevelName);
        if (typeof levelName === 'string' && levelName) entry.name = levelName;
        const iconTag = nbtValue(data.icon);
        if (Array.isArray(iconTag) && iconTag.length > 0 && iconTag.length < 512 * 1024) {
          try { entry.icon = worldIconDataUrl(Buffer.from(iconTag)); } catch { /* no icon */ }
        }
        if (!entry.icon) {
          const diskIcon = path.join(wdir, 'icon.png');
          try {
            if (fs.existsSync(diskIcon)) entry.icon = worldIconDataUrl(fs.readFileSync(diskIcon));
          } catch { /* no icon */ }
        }
        const lastPlayed = nbtValue(data.LastPlayed);
        if (typeof lastPlayed === 'bigint') entry.lastPlayed = Number(lastPlayed);
        else if (typeof lastPlayed === 'number') entry.lastPlayed = lastPlayed;
        else if (Array.isArray(lastPlayed) && lastPlayed.length === 2) {
          entry.lastPlayed = Number(lastPlayed[0]) * 4294967296 + Number(lastPlayed[1]);
        }
        const gameType = nbtValue(data.GameType);
        if (typeof gameType === 'number') entry.gameType = gameType;
        const hardcore = nbtValue(data.hardcore);
        entry.hardcore = hardcore === true || hardcore === 1;
        const difficulty = nbtValue(data.Difficulty);
        if (typeof difficulty === 'number') entry.difficulty = difficulty;
        const verName = nbtValue((data.Version as any)?.Name);
        if (typeof verName === 'string') entry.version = verName;
        entry.size = folderSize(wdir);
      } catch (e) {
        console.warn(`Failed to parse world ${item.name}:`, e);
      }
      worlds.push(entry);
    }
    worlds.sort((a, b) => b.lastPlayed - a.lastPlayed);
    return worlds;
  });

  ipcMain.handle('launcher:delete-instance-files', async (_event, buildId: string, sub: string, names: string[]) => {
    if (!['screenshots', 'saves'].includes(sub) || !Array.isArray(names)) {
      return { success: false, error: 'invalid request' };
    }
    const instanceRoot = getInstanceRoot(buildId);
    let deleted = 0;
    for (const name of names) {
      const target = safeSubPath(instanceRoot, sub, name);
      if (!target) continue;
      try { fs.rmSync(target, { recursive: true, force: true }); deleted++; } catch { /* skip */ }
    }
    return { success: true, deleted };
  });

  ipcMain.handle('launcher:save-instance-files', async (_event, buildId: string, sub: string, names: string[]) => {
    if (!['screenshots', 'saves'].includes(sub) || !Array.isArray(names)) {
      return { success: false, error: 'invalid request' };
    }
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'], title: 'Выберите папку для сохранения' });
    if (result.canceled || !result.filePaths[0]) return { success: false, canceled: true };
    const outDir = result.filePaths[0];
    const instanceRoot = getInstanceRoot(buildId);
    let saved = 0;
    for (const name of names) {
      const src = safeSubPath(instanceRoot, sub, name);
      if (!src) continue;
      try { fs.cpSync(src, path.join(outDir, name), { recursive: true }); saved++; } catch { /* skip */ }
    }
    return { success: true, saved };
  });

  ipcMain.handle('launcher:save-log', async (_event, buildId: string, logContent: string) => {
    try {
      const instanceDir = getInstanceRoot(buildId);
      if (!fs.existsSync(instanceDir)) fs.mkdirSync(instanceDir, { recursive: true });
      const logPath = path.join(instanceDir, 'crash-log.txt');
      fs.writeFileSync(logPath, logContent, 'utf-8');
      return { success: true, path: logPath };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  });

  ipcMain.handle('launcher:java:detect', () => detectJavaRuntimes());

  ipcMain.handle('launcher:java:list', () => listJavaVersions());

  ipcMain.handle('launcher:java:install', async (_event, version: number) => {
    if (!JAVA_MANAGED_VERSIONS.includes(Number(version))) {
      return { success: false, error: 'Unsupported Java version' };
    }
    try {
      const javaExe = await ensureJava(Number(version), (data) => {
        mainWindow?.webContents.send('launcher:java-progress', { version: Number(version), ...data });
      });
      invalidateJavaRuntimesCache();
      return { success: true, path: javaExe };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  });

  ipcMain.handle('launcher:java:remove', (_event, version: number) => {
    if (!JAVA_MANAGED_VERSIONS.includes(Number(version))) {
      return { success: false, error: 'Unsupported Java version' };
    }
    const result = removeManagedJava(Number(version));
    if (result.success) {
      invalidateJavaRuntimesCache();
      mainWindow?.webContents.send('launcher:java-progress', { version: Number(version), status: 'removed' });
    }
    return result;
  });

  ipcMain.handle('launcher:java:resolve', async (_event, gameVersion: string) => {
    try {
      const ver = await resolveJavaVersion(gameVersion);
      return { success: true, version: ver };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('launcher:crash-report', async (_event, buildId: string) => {
    try {
      if (typeof buildId !== 'string' || !/^[a-z0-9-]+$/i.test(buildId)) return null;
      const crashDir = path.join(INSTANCE_BASE, buildId, 'crash-reports');
      if (!fs.existsSync(crashDir)) return null;
      const files = fs.readdirSync(crashDir).filter(f => f.endsWith('.txt')).sort((a, b) => {
        try {
          return fs.statSync(path.join(crashDir, b)).mtimeMs - fs.statSync(path.join(crashDir, a)).mtimeMs;
        } catch { return 0; }
      });
      if (files.length === 0) return null;
      return fs.readFileSync(path.join(crashDir, files[0]), 'utf-8').slice(0, 16000);
    } catch { return null; }
  });

  ipcMain.on('launcher:set-language', (_event, lang: string) => {
    rpcLang = RPC_TEXT[lang] ? lang : 'ru';
    sendDiscordPresence();
  });

  ipcMain.on('launcher:presence', (_event, data: { screen?: string; account?: { name: string; avatar: string } | null }) => {
    if (typeof data?.screen === 'string') currentUiScreen = data.screen;
    if (data && data.account !== undefined) currentAccountInfo = data.account;
    sendDiscordPresence();
  });

  ipcMain.handle('launcher:launch', async (_event, config: any) => {
    if (launchInProgress) {
      return { success: false, error: 'Launch already in progress', errorKey: 'smp.alreadyRunning' };
    }
    launchInProgress = true;
    try {
      return await runLaunch(config);
    } catch (err) {
      // Без этого сброса любой сбой до старта игры навсегда оставлял бы флаг
      // взведённым, и все следующие запуски отвечали бы «уже запускается».
      launchInProgress = false;
      skipServerDownloads = false;
      const message = err instanceof Error ? err.message : String(err);
      sendProgress({ kind: 'error', key: 'smp.genericError', params: { msg: message } });
      return { success: false, error: message };
    }
  });

  async function runLaunch(config: any): Promise<{ success: boolean; error?: string; errorKey?: string }> {
    logPhase('launch start');
    skipServerDownloads = !!(config?.server && config.server.ip);
    await ensureDownloaderPatched();
    void patchEMLCache();

    const eml = await loadEML();
    let account: any;

    if (config?.account?.meta?.type === 'msa' || config?.account?.meta?.type === 'yggdrasil') {
      account = config.account;
    } else {
      const name = config?.account?.name || config?.account?.username || 'Player';
      account = await new eml.CrackAuth().auth(name);
    }

    const instanceRoot = config.buildId ? getInstanceRoot(config.buildId) : appDataDir;
    if (!fs.existsSync(instanceRoot)) fs.mkdirSync(instanceRoot, { recursive: true });

    // ===== Активный скин/плащ → аккаунт + CustomSkinLoader =====
    const cos = config.cosmetics;
    const accTypeLaunch = account?.meta?.type || account?.type || '';
    const launchLoader = config.minecraft?.loader?.loader || 'vanilla';
    const launchGameVersion = config.minecraft?.version || 'latest_release';
    const launchUsername = account?.name || account?.username || 'Player';
    // PNG держим в памяти — перед spawn снова положим в инстанс (модпак мог затереть)
    let launchSkinPng: Buffer | null =
      resolveSkinPng(cos?.skinDataUrl) || resolveSkinPng(cos?.skinId);
    let launchCapePng: Buffer | null =
      resolveSkinPng(cos?.capeDataUrl) || resolveSkinPng(cos?.capeId);
    if (!launchSkinPng) {
      const cachedSkin = path.join(appDataDir, 'active-cosmetics', 'skin.png');
      if (fs.existsSync(cachedSkin)) launchSkinPng = fs.readFileSync(cachedSkin);
    }
    if (!launchCapePng) {
      const cachedCape = path.join(appDataDir, 'active-cosmetics', 'cape.png');
      if (fs.existsSync(cachedCape)) launchCapePng = fs.readFileSync(cachedCape);
    }
    const launchCapeId = String(cos?.capeId || '');
    const launchOfficialMsaCape = launchCapeId.startsWith('cape-msa-');
    const launchHideCape = cos?.capeId === '' || cos?.hideCape === true;
    const launchUseLocalCape = !launchHideCape && !!launchCapePng && !!launchCapeId;
    const launchCapeForLocal = launchUseLocalCape ? launchCapePng : null;

    if (cos && (cos.skinId || cos.skinDataUrl || cos.capeId || cos.capeDataUrl || launchSkinPng)) {
      try {
        sendProgress({ kind: 'status', key: 'smp.applyingCosmetics' });
        await applyCosmetics(account, {
          ...cos,
          skinDataUrl: cos?.skinDataUrl,
          capeDataUrl: cos?.capeDataUrl,
          buildId: config.buildId,
          loader: launchLoader,
          gameVersion: launchGameVersion,
          account,
        });
      } catch (err) {
        console.warn('[cosmetics] apply on launch failed:', err);
      }
    } else if (config.buildId && accTypeLaunch === 'msa') {
      // Без payload: переписать loadlist без ElyBy, сохранив уже лежащие LocalSkin PNG
      try {
        const instanceDir = getInstanceRoot(String(config.buildId));
        const names = localSkinFileNames(launchUsername);
        let skinBuf: Buffer | null = launchSkinPng;
        for (const n of names) {
          const skinPath = path.join(instanceDir, 'CustomSkinLoader', 'LocalSkin', 'skins', `${n}.png`);
          if (!skinBuf && fs.existsSync(skinPath)) skinBuf = fs.readFileSync(skinPath);
        }
        writeLocalCosmetics(instanceDir, launchUsername, skinBuf, null, 'msa', {
          useLocalCape: false,
        });
        if (String(launchLoader).toLowerCase() !== 'vanilla') {
          await ensureCustomSkinLoader(instanceDir, launchLoader, launchGameVersion);
        }
      } catch (err) {
        console.warn('[cosmetics] MSA CSL cleanup failed:', err);
      }
    }

    /** Перед spawn — LocalSkin + jar CSL (после download модпака). */
    const restoreCosmeticsBeforeSpawn = (): void => {
      if (!config.buildId) return;
      try {
        const instanceDir = getInstanceRoot(String(config.buildId));
        if (launchSkinPng || launchCapeForLocal || accTypeLaunch === 'msa' || accTypeLaunch === 'yggdrasil') {
          writeLocalCosmetics(
            instanceDir,
            launchUsername,
            launchSkinPng,
            launchCapeForLocal,
            accTypeLaunch || 'offline',
            { useLocalCape: launchUseLocalCape },
          );
        }
        if (String(launchLoader).toLowerCase() !== 'vanilla') {
          copyCachedCslJarToInstance(instanceDir);
        }
        neutralizeConflictingCapeMods(instanceDir);
        console.log('[cosmetics] restored LocalSkin/CSL before spawn', {
          buildId: config.buildId,
          hasSkin: !!launchSkinPng,
          hasCape: !!launchCapeForLocal,
          useLocalCape: launchUseLocalCape,
          officialMsaCape: launchOfficialMsaCape,
        });
      } catch (err) {
        console.warn('[cosmetics] restore before spawn failed:', err);
      }
    };

    const mcConfig: any = config.minecraft || { version: 'latest_release' };
    if (mcConfig.loader && mcConfig.loader.loader !== 'vanilla' && !mcConfig.loader.version) {
      mcConfig.loader.version = LOADER_VERSIONS[mcConfig.loader.loader] || undefined;
    }
    if (config.modpackUrl) {
      mcConfig.modpackUrl = config.modpackUrl;
    }
    if (config.mcArgs && Array.isArray(config.mcArgs)) {
      mcConfig.args = config.mcArgs;
    }
    if (config.server && config.server.ip) {
      const ip = String(config.server.ip).trim();
      const port = Number(config.server.port) || 25565;
      if (ip) {
        const gameVer = mcConfig.version || 'latest_release';
        if (usesQuickPlay(gameVer)) {
          mcConfig.args = [...(mcConfig.args || []), '--quickPlayMultiplayer', `${ip}:${port}`];
        } else {
          mcConfig.args = [...(mcConfig.args || []), '--server', ip, '--port', String(port)];
        }
        addServerToGameList(instanceRoot, ip, port, config.server.name);
      }
    }

    const gameVersion = mcConfig.version || 'latest_release';
    let javaPath: string;
    try {
      const javaVer = await resolveJavaVersion(gameVersion);
      const runtimes = detectJavaRuntimes();
      const installed = bestRuntimeFor(javaVer, runtimes);
      const explicitJava = config.javaPath && typeof config.javaPath === 'string'
        ? (fs.existsSync(config.javaPath) ? config.javaPath : '')
        : '';
      let usableExplicit = '';
      if (explicitJava) {
        try {
          const out = execSync(`"${explicitJava}" -version 2>&1`, { encoding: 'utf8', timeout: 8000 });
          const m = out.match(/version\s+"(\d+)(?:\.(\d+))?/);
          const ver = m ? (m[1] === '1' ? parseInt(m[2] || '8', 10) : parseInt(m[1], 10)) : 0;
          if (ver >= javaVer) usableExplicit = explicitJava;
        } catch {}
      }
      javaPath = usableExplicit || installed || await ensureJava(javaVer);
    } catch {
      sendProgress({ kind: 'error', key: 'smp.javaDownloadFailed' });
      launchInProgress = false;
      skipServerDownloads = false;
      return { success: false, error: 'Java download failed', errorKey: 'smp.javaDownloadFailed' };
    }

    const javaConfig: any = { install: 'manual', absolutePath: javaPath };
    if (config.jvmArgs && Array.isArray(config.jvmArgs)) {
      javaConfig.args = config.jvmArgs;
    }

    launcherInstance = new eml.Launcher({
      root: INSTANCE_BASE,
      profile: config.buildId ? { slug: config.buildId } : undefined,
      storage: 'isolated',
      account,
      minecraft: mcConfig,
      memory: config.memory || { min: 1024, max: 2048 },
      window: config.window || { width: 854, height: 480, fullscreen: false },
      java: javaConfig,
      // CSL/LocalSkin не из модпака — не удалять, если cleaning когда‑нибудь включат
      cleaning: {
        enabled: false,
        ignored: [
          'crash-reports/',
          'logs/',
          'resourcepacks/',
          'resources/',
          'saves/',
          'shaderpacks/',
          'options.txt',
          'optionsof.txt',
          'CustomSkinLoader/',
          'mods/CustomSkinLoader',
        ],
      },
    });

    // После download/clean — вернуть скин до spawn (emit синхронный)
    launcherInstance.on('launch_clean', () => {
      restoreCosmeticsBeforeSpawn();
    });
    launcherInstance.on('launch_launch', () => {
      restoreCosmeticsBeforeSpawn();
    });

    // ===== Discord RPC =====
    discordRpcEnabled = config.discordRpc !== false;
    if (!discordRpcEnabled) {
      if (discordClient) {
        try { discordClient.destroy(); } catch {}
        discordClient = null;
      }
      discordConnectPromise = null;
    } else {
      void initDiscordRPC();
    }
    // Презенс нужен и для входа на сервер без сборки — тогда показываем имя сервера.
    const presenceName = config.buildName || config.server?.name || config.server?.ip || '';
    const buildInfo = (config.buildId || config.server?.ip)
      ? {
          name: presenceName || RPC_TEXT[rpcLang]?.build || RPC_TEXT.ru.build,
          gameVersion: mcConfig.version || '?',
          loader: config.minecraft?.loader?.loader || 'vanilla',
        }
      : null;

    launcherInstance.on('launch_compute_download', () => {
      logPhase('compute');
      sendProgress({ kind: 'status', key: 'smp.computingFiles' });
    });

    launcherInstance.on('launch_download', (total: any) => {
      logPhase('download start');
      console.log(`[launch] files_to_download=${total.total?.amount} size=${total.total?.size}`);
      sendProgress({ kind: 'status', key: 'smp.downloadingMc', params: { n: total.total.amount } });
    });

    launcherInstance.on('download_progress', (p: any) => {
      const fileInfo = p.total?.amount ? `${p.downloaded.amount}/${p.total.amount}` : '';
      const sizeInfo = p.total?.size ? `${formatBytes(p.downloaded.size)}/${formatBytes(p.total.size)}` : formatBytes(p.downloaded.size);
      sendProgress({
        kind: 'download',
        message: [p.type, fileInfo, sizeInfo].filter(Boolean).join(' · '),
        total: p.total,
        downloaded: p.downloaded,
        speed: p.speed,
      });
    });

    launcherInstance.on('download_error', (err: any) => {
      sendProgress({ kind: 'error', key: 'smp.downloadFailed', params: { file: err.filename, msg: err.message } });
    });

    launcherInstance.on('download_end', (p: any) => {
      sendProgress({ kind: 'info', key: 'smp.downloadDone', params: { n: p.downloaded.amount, size: formatBytes(p.downloaded.size) } });
    });

    launcherInstance.on('launch_install_loader', (loader: any) => {
      logPhase('install loader');
      sendProgress({ kind: 'status', key: 'smp.installingLoader', params: { loader: loader.type, ver: loader.minecraftVersion } });
    });

    launcherInstance.on('launch_copy_assets', () => {
      logPhase('copy assets');
      sendProgress({ kind: 'status', key: 'smp.copyingAssets' });
    });

    launcherInstance.on('copy_progress', (p: any) => {
      sendProgress({ kind: 'copy', key: 'smp.copying', params: { file: p.filename } });
    });

    launcherInstance.on('copy_end', (p: any) => {
      sendProgress({ kind: 'info', key: 'smp.copyDone' });
    });

    launcherInstance.on('launch_extract_natives', () => {
      logPhase('extract natives');
      sendProgress({ kind: 'status', key: 'smp.extractingNatives' });
    });

    launcherInstance.on('extract_progress', (p: any) => {
      sendProgress({ kind: 'extract', key: 'smp.extracting', params: { file: p.filename } });
    });

    launcherInstance.on('extract_end', (p: any) => {
      sendProgress({ kind: 'info', key: 'smp.extractDone' });
    });

    launcherInstance.on('launch_patch_loader', () => {
      logPhase('patch loader');
      sendProgress({ kind: 'status', key: 'smp.patchingLoader' });
    });

    launcherInstance.on('patch_progress', (p: any) => {
      sendProgress({ kind: 'patch', key: 'smp.patching', params: { file: p.filename } });
    });

    launcherInstance.on('patch_end', (p: any) => {
      sendProgress({ kind: 'info', key: 'smp.patchDone' });
    });

    launcherInstance.on('launch_check_java', () => {
      logPhase('check java');
      sendProgress({ kind: 'status', key: 'smp.checkingJava' });
    });

    launcherInstance.on('java_info', (info: any) => {
      sendProgress({ kind: 'info', key: 'smp.javaInfo', params: { ver: info.version, arch: info.arch } });
    });

    launcherInstance.on('launch_clean', () => {
      sendProgress({ kind: 'status', key: 'smp.cleaningDir' });
    });

    launcherInstance.on('clean_progress', (p: any) => {
      sendProgress({ kind: 'clean', key: 'smp.cleaning', params: { file: p.filename } });
    });

    launcherInstance.on('clean_end', (p: any) => {
      sendProgress({ kind: 'info', key: 'smp.cleanDone', params: { n: p.amount } });
    });

    launcherInstance.on('launch_launch', (resolved: any) => {
      logPhase('launching MC');
      sendProgress({ kind: 'launching', key: 'smp.launchingMc', data: resolved });
      if (buildInfo) setDiscordPresence(buildInfo);
    });

    launcherInstance.on('launch_data', (data: string) => {
      sendProgress({ kind: 'log', message: data });
    });

    launcherInstance.on('launch_debug', (data: string) => {
      sendProgress({ kind: 'debug', message: data });
    });

    launcherInstance.on('launch_close', (code: number | null) => {
      sendProgress({ kind: 'close', key: 'smp.closed', params: { code }, code });
      launcherInstance = null;
      launchInProgress = false;
      skipServerDownloads = false;
      setDiscordPresence(null);
    });

    launcherInstance.on('launch_crash', (crash: any) => {
      sendProgress({ kind: 'crash', key: 'smp.crashed', params: { code: crash.code }, data: crash });
      launcherInstance = null;
      launchInProgress = false;
      skipServerDownloads = false;
      setDiscordPresence(null);
    });

    try {
      logPhase('eml launch()');
      const result = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
        let settled = false;
        const done = (value: { ok: boolean; error?: string }): void => {
          if (settled) return;
          settled = true;
          resolve(value);
        };
        const onLaunch = (): void => done({ ok: true });
        launcherInstance.on?.('launch_launch', onLaunch);
        Promise.resolve(launcherInstance.launch())
          .then(() => done({ ok: true }))
          .catch((err: any) => {
            const message = err instanceof Error ? err.message : String(err);
            sendProgress({ kind: 'error', key: 'smp.genericError', params: { msg: message } });
            done({ ok: false, error: message });
          });
      });
      if (!result.ok) {
        launcherInstance = null;
        launchInProgress = false;
        skipServerDownloads = false;
        return { success: false, error: result.error };
      }
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendProgress({ kind: 'error', key: 'smp.genericError', params: { msg: message } });
      launcherInstance = null;
      launchInProgress = false;
      skipServerDownloads = false;
      return { success: false, error: message };
    }
  }

  // Watchers for instance directories
  const instanceWatchers = new Map<string, { watchers: fs.FSWatcher[]; timer: any }>();

  function addServerToGameList(instanceRoot: string, ip: string, port: number, name?: string): void {
    try {
      const addrStr = `${ip}${port && port !== 25565 ? ':' + port : ''}`;
      const serversPath = path.join(instanceRoot, 'servers.dat');
      let servers: any[] = [];
      if (fs.existsSync(serversPath)) {
        try {
          const buf = fs.readFileSync(serversPath);
          const parsed = nbtLib().parseUncompressed(buf) as any;
          const list = parsed?.value?.servers;
          if (list?.type === 'list' && Array.isArray(list.value?.value)) {
            servers = list.value.value;
          }
        } catch { servers = []; }
      }
      const already = servers.some((s: any) => {
        const sv = s.value || s;
        const ipVal = sv.ip?.value ?? sv.ip;
        return String(ipVal).replace(/:25565$/, '') === ip.replace(/:25565$/, '');
      });
      if (already) return;

      const entry: any = {
        preventsChatReports: { type: 'byte', value: 0 },
        hidden: { type: 'byte', value: 0 },
        ip: { type: 'string', value: addrStr },
        name: { type: 'string', value: (name && name.trim().length > 0 ? name.trim() : ip) },
      };
      servers.push(entry);

      const listTag: any = {
        type: 'list',
        value: { type: 'compound', value: servers },
      };
      const rootCompound: any = { type: 'compound', name: '', value: { servers: listTag } };
      const out = nbtLib().writeUncompressed(rootCompound);
      if (out && out.length > 0) {
        fs.writeFileSync(serversPath, out);
      }
    } catch (err) {
      console.warn('[add-server-to-list] failed', err);
    }
  }

  function scanAndNotify(buildId: string): void {
    const root = getInstanceRoot(buildId);
    if (!fs.existsSync(root)) return;
    const cache = loadCache(root);
    const result: Record<string, any[]> = { mods: [], resourcepacks: [], shaders: [], datapacks: [] };
    result.mods = scanFolder(path.join(root, 'mods'), ['.jar', '.litemod'], 'mod');
    result.resourcepacks = scanFolder(path.join(root, 'resourcepacks'), ['.zip'], 'resourcepack');
    result.shaders = scanFolder(path.join(root, 'shaderpacks'), ['.zip'], 'shader');
    result.datapacks = scanFolder(path.join(root, 'datapacks'), ['.zip'], 'datapack');
    const allItems = [...result.mods, ...result.resourcepacks, ...result.shaders, ...result.datapacks];
    Promise.all(allItems.map(item => enrichWithModrinth(item, item.contentType, cache))).then(() => {
      saveCache(root, cache);
      mainWindow.webContents.send('launcher:instance-changed', buildId, result);
    });
  }

  ipcMain.handle('launcher:watch-instance', async (_event, buildId: string) => {
    if (instanceWatchers.has(buildId)) return;
    const root = getInstanceRoot(buildId);
    if (!fs.existsSync(root)) return;
    const subDirs = ['mods', 'resourcepacks', 'shaderpacks', 'datapacks'];
    const watchers: fs.FSWatcher[] = [];
    let debounceTimer: any = null;
    for (const sub of subDirs) {
      const dirPath = path.join(root, sub);
      if (!fs.existsSync(dirPath)) continue;
      try {
        const w = fs.watch(dirPath, (eventType, filename) => {
          if (!filename) return;
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => scanAndNotify(buildId), 500);
        });
        watchers.push(w);
      } catch {}
    }
    instanceWatchers.set(buildId, { watchers, timer: debounceTimer });
  });

  ipcMain.handle('launcher:unwatch-instance', async (_event, buildId: string) => {
    const entry = instanceWatchers.get(buildId);
    if (!entry) return;
    for (const w of entry.watchers) {
      try { w.close(); } catch {}
    }
    if (entry.timer) clearTimeout(entry.timer);
    instanceWatchers.delete(buildId);
  });
}
