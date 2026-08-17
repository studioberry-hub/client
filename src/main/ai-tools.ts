// ===== MCP-инструменты агента лаунчера (исполнение на клиенте) =====
import fs from 'fs';
import path from 'path';
import { BrowserWindow, ipcMain, shell } from 'electron';
import { getInstanceRoot, getInstancesDir } from './launcher';
import { getExtendedAiTools } from './ai-tools-extended';
import { callRendererAiAction } from './ai-action-bridge';
import {
  collectInstalledProjectIds,
  installModWithDependencies,
} from './modDependencies';

export type AiToolRisk = 'read' | 'write';

export type AiToolSchema = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

type ToolEntry = {
  risk: AiToolRisk;
  schema: AiToolSchema;
  run: ToolHandler;
};

const BUILD_COLORS = ['#3b82f6', '#22c55e', '#eab308', '#ef4444', '#a855f7', '#06b6d4', '#f97316'];

const CONTENT_SUBDIRS: Record<string, string> = {
  mod: 'mods',
  mods: 'mods',
  resourcepack: 'resourcepacks',
  resourcepacks: 'resourcepacks',
  shader: 'shaderpacks',
  shaders: 'shaderpacks',
  shaderpack: 'shaderpacks',
  datapack: 'datapacks',
  datapacks: 'datapacks',
};

const OPEN_SUBDIRS = new Set([
  'mods',
  'resourcepacks',
  'shaderpacks',
  'datapacks',
  'saves',
  'screenshots',
  'config',
  'logs',
  '.',
]);

function launcherDataDir(): string {
  return path.join(process.env.APPDATA || process.cwd(), '.Undefined Client');
}

function buildsPath(): string {
  return path.join(launcherDataDir(), 'builds.json');
}

function readJsonArray(filePath: string): any[] {
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function writeJsonArray(filePath: string, data: any[]): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asBool(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 1 || value === '1') return true;
  if (value === 'false' || value === 0 || value === '0') return false;
  return fallback;
}

function getBuilds(): any[] {
  return readJsonArray(buildsPath());
}

function saveBuilds(builds: any[]): void {
  writeJsonArray(buildsPath(), builds);
  // Синхронизация списка сборок в UI после действий агента
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send('launcher:builds-changed');
    } catch {
      /* ignore */
    }
  }
}

function findBuild(buildId: string): any | null {
  return getBuilds().find((b: any) => b.id === buildId) || null;
}

function sanitizeBuildIdPart(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '') || 'build';
}

function makeBuildId(name: string): string {
  return `${sanitizeBuildIdPart(name)}-${Date.now().toString(36)}`;
}

function ensureInstanceDirs(buildId: string): string {
  const root = getInstanceRoot(buildId);
  for (const sub of ['mods', 'resourcepacks', 'shaderpacks', 'datapacks', 'saves', 'screenshots', 'config', 'logs']) {
    const dir = path.join(root, sub);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
  return root;
}

function safeJoinInstance(buildId: string, sub: string, name: string): string | null {
  const root = path.resolve(getInstanceRoot(buildId));
  const base = path.resolve(path.join(root, sub));
  const target = path.resolve(path.join(base, name));
  if (target !== base && !target.startsWith(base + path.sep)) return null;
  return target;
}

function buildSummary(b: any) {
  const id = String(b.id || '');
  return {
    id,
    name: b.name,
    gameVersion: b.gameVersion || b.version,
    loader: b.loader || 'vanilla',
    loaderVersion: b.loaderVersion || null,
    javaPath: b.javaPath || null,
    memory: b.memory || null,
    window: b.window || null,
    jvmArgs: b.jvmArgs || '',
    mcArgs: b.mcArgs || '',
    instancePath: id ? getInstanceRoot(id) : null,
  };
}

// Managed Java: tools/java{N}/bin/java.exe в каталоге данных лаунчера
const JAVA_MANAGED_VERSIONS = [8, 11, 16, 17, 21, 24, 25];

function javaToolsDir(): string {
  return path.join(launcherDataDir(), 'tools');
}

function listInstalledJava(): {
  version: number;
  installed: boolean;
  managed: boolean;
  path: string | null;
}[] {
  const tools = javaToolsDir();
  return JAVA_MANAGED_VERSIONS.map((version) => {
    const managedExe = path.join(tools, `java${version}`, 'bin', 'java.exe');
    const managedAlt = path.join(tools, `java${version}`, 'bin', 'java');
    const managedPath = fs.existsSync(managedExe)
      ? managedExe
      : fs.existsSync(managedAlt)
        ? managedAlt
        : null;
    return {
      version,
      installed: Boolean(managedPath),
      managed: Boolean(managedPath),
      path: managedPath,
    };
  });
}

async function modrinthSearch(opts: {
  query: string;
  type?: string;
  version?: string;
  loader?: string;
  limit: number;
}): Promise<any[]> {
  const params = new URLSearchParams();
  params.set('query', opts.query);
  const facets: string[][] = [[`project_type:${opts.type || 'mod'}`]];
  if (opts.loader) facets.push([`categories:${opts.loader}`]);
  if (opts.version) facets.push([`versions:${opts.version}`]);
  params.set('facets', JSON.stringify(facets));
  params.set('limit', String(opts.limit));
  params.set('offset', '0');

  const res = await fetch(`https://api.modrinth.com/v2/search?${params.toString()}`, {
    headers: { 'User-Agent': 'Undefined-Client-AI', Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Modrinth HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data?.hits) ? data.hits : [];
}

function mapModCard(h: any) {
  return {
    id: h.project_id || h.id,
    slug: h.slug,
    title: h.title,
    description: String(h.description || '').slice(0, 220),
    iconUrl: h.icon_url || null,
    downloads: h.downloads || 0,
    updatedAt: h.date_modified || h.updated || null,
    versions: h.versions || h.game_versions || [],
    loaders: h.loaders || h.categories || [],
    projectType: h.project_type || 'mod',
  };
}

// ===== Веб-поиск / чтение страниц (без API-ключа) =====
const WEB_FETCH_TIMEOUT_MS = 12_000;
const WEB_FETCH_MAX_BYTES = 400_000;
const WEB_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Undefined-Client-AI';

async function fetchTextLimited(
  url: string,
  opts?: { accept?: string; method?: string; body?: string; headers?: Record<string, string> },
): Promise<{ ok: boolean; status: number; text: string; finalUrl: string; contentType: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEB_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: opts?.method || 'GET',
      body: opts?.body,
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': WEB_UA,
        Accept: opts?.accept || 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        ...(opts?.headers || {}),
      },
    });
    const contentType = String(res.headers.get('content-type') || '');
    const buf = Buffer.from(await res.arrayBuffer());
    const sliced = buf.byteLength > WEB_FETCH_MAX_BYTES ? buf.subarray(0, WEB_FETCH_MAX_BYTES) : buf;
    return {
      ok: res.ok,
      status: res.status,
      text: sliced.toString('utf-8'),
      finalUrl: String(res.url || url),
      contentType,
    };
  } finally {
    clearTimeout(timer);
  }
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCharCode(code) : '';
    });
}

function stripHtmlToText(html: string): string {
  let t = String(html || '');
  t = t.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  t = t.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  t = t.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  t = t.replace(/<!--[\s\S]*?-->/g, ' ');
  t = t.replace(/<\/(p|div|br|li|h[1-6]|tr|section|article)>/gi, '\n');
  t = t.replace(/<br\s*\/?>/gi, '\n');
  t = t.replace(/<[^>]+>/g, ' ');
  t = decodeHtmlEntities(t);
  t = t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  t = t.replace(/[ \t]{2,}/g, ' ').trim();
  return t;
}

function unwrapDdgRedirect(href: string): string {
  try {
    const u = new URL(href, 'https://duckduckgo.com');
    const uddg = u.searchParams.get('uddg');
    if (uddg) return decodeURIComponent(uddg);
    return u.href;
  } catch {
    return href;
  }
}

function isHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

type WebHit = { title: string; url: string; snippet: string };

function parseDdgHtmlResults(html: string, limit: number): WebHit[] {
  const hits: WebHit[] = [];
  const seen = new Set<string>();
  // Классическая разметка html.duckduckgo.com
  const re =
    /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|td)>|class="result__snippet"[^>]*>([\s\S]*?)<\/)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && hits.length < limit) {
    const url = unwrapDdgRedirect(decodeHtmlEntities(m[1] || ''));
    if (!isHttpUrl(url) || seen.has(url)) continue;
    const title = stripHtmlToText(m[2] || '').slice(0, 180);
    const snippet = stripHtmlToText(m[3] || m[4] || '').slice(0, 320);
    if (!title) continue;
    seen.add(url);
    hits.push({ title, url, snippet });
  }
  if (hits.length) return hits;

  // Fallback: любые внешние ссылки в результатах
  const loose = /href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = loose.exec(html)) && hits.length < limit) {
    const url = unwrapDdgRedirect(decodeHtmlEntities(m[1] || ''));
    if (!isHttpUrl(url) || /duckduckgo\.com/i.test(url) || seen.has(url)) continue;
    const title = stripHtmlToText(m[2] || '').slice(0, 180);
    if (!title || title.length < 3) continue;
    seen.add(url);
    hits.push({ title, url, snippet: '' });
  }
  return hits;
}

async function duckDuckGoInstant(query: string): Promise<{
  abstract: string;
  abstractUrl: string;
  answer: string;
  related: WebHit[];
}> {
  const url =
    `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}` +
    '&format=json&no_html=1&skip_disambig=1';
  const res = await fetchTextLimited(url, { accept: 'application/json' });
  if (!res.ok) return { abstract: '', abstractUrl: '', answer: '', related: [] };
  let data: any = null;
  try {
    data = JSON.parse(res.text);
  } catch {
    return { abstract: '', abstractUrl: '', answer: '', related: [] };
  }
  const related: WebHit[] = [];
  const topics = Array.isArray(data?.RelatedTopics) ? data.RelatedTopics : [];
  for (const item of topics) {
    if (related.length >= 6) break;
    if (item?.Topics && Array.isArray(item.Topics)) {
      for (const sub of item.Topics) {
        if (related.length >= 6) break;
        if (sub?.FirstURL && sub?.Text) {
          related.push({
            title: String(sub.Text).slice(0, 180),
            url: String(sub.FirstURL),
            snippet: '',
          });
        }
      }
      continue;
    }
    if (item?.FirstURL && item?.Text) {
      related.push({
        title: String(item.Text).slice(0, 180),
        url: String(item.FirstURL),
        snippet: '',
      });
    }
  }
  return {
    abstract: String(data?.AbstractText || '').slice(0, 800),
    abstractUrl: String(data?.AbstractURL || ''),
    answer: String(data?.Answer || '').slice(0, 400),
    related,
  };
}

async function duckDuckGoHtmlSearch(query: string, limit: number): Promise<WebHit[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetchTextLimited(url, {
    accept: 'text/html',
    headers: { 'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8' },
  });
  if (!res.ok) throw new Error(`search HTTP ${res.status}`);
  return parseDdgHtmlResults(res.text, limit);
}

function listDirFiles(dir: string, exts: string[]): { name: string; size: number; enabled: boolean }[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => {
      const lower = n.toLowerCase();
      return exts.some((ext) => lower.endsWith(ext) || lower.endsWith(`${ext}.disabled`));
    })
    .slice(0, 120)
    .map((name) => {
      const full = path.join(dir, name);
      let size = 0;
      try {
        size = fs.statSync(full).size;
      } catch {
        /* ignore */
      }
      return {
        name,
        size,
        enabled: !name.toLowerCase().endsWith('.disabled'),
      };
    });
}

const TOOLS: Record<string, ToolEntry> = {
  list_builds: {
    risk: 'read',
    schema: {
      type: 'function',
      function: {
        name: 'list_builds',
        description: 'Список локальных сборок лаунчера (id, имя, версия MC, loader, путь инстанса .uclient).',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
      },
    },
    run: async () =>
      getBuilds()
        .slice(0, 80)
        .map((b: any) => buildSummary(b)),
  },

  get_build: {
    risk: 'read',
    schema: {
      type: 'function',
      function: {
        name: 'get_build',
        description:
          'Детали сборки по id. instancePath — реальная папка с модами (%APPDATA%\\.uclient\\<id>), не .Undefined Client.',
        parameters: {
          type: 'object',
          properties: { buildId: { type: 'string' } },
          required: ['buildId'],
          additionalProperties: false,
        },
      },
    },
    run: async (args) => {
      const buildId = asString(args.buildId);
      const build = findBuild(buildId);
      if (!build) return { error: 'build_not_found' };
      const root = getInstanceRoot(buildId);
      return {
        ...buildSummary(build),
        instanceExists: fs.existsSync(root),
        note: 'Метаданные сборок в .Undefined Client; файлы игры/модов — в .uclient.',
      };
    },
  },

  get_instance_path: {
    risk: 'read',
    schema: {
      type: 'function',
      function: {
        name: 'get_instance_path',
        description: 'Абсолютный путь инстанса сборки в %APPDATA%\\.uclient\\<sanitized-id>.',
        parameters: {
          type: 'object',
          properties: { buildId: { type: 'string' } },
          required: ['buildId'],
          additionalProperties: false,
        },
      },
    },
    run: async (args) => {
      const buildId = asString(args.buildId);
      if (!buildId) return { error: 'buildId_required' };
      const root = getInstanceRoot(buildId);
      return {
        buildId,
        path: root,
        exists: fs.existsSync(root),
        instancesDir: getInstancesDir(),
      };
    },
  },

  create_build: {
    risk: 'write',
    schema: {
      type: 'function',
      function: {
        name: 'create_build',
        description:
          'Создать новую сборку в лаунчере. Обязательны name и gameVersion; loader: vanilla|fabric|forge|quilt|neoforge.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            gameVersion: { type: 'string' },
            loader: { type: 'string' },
            loaderVersion: { type: 'string' },
            memoryMin: { type: 'number' },
            memoryMax: { type: 'number' },
          },
          required: ['name', 'gameVersion'],
          additionalProperties: false,
        },
      },
    },
    run: async (args) => {
      const name = asString(args.name);
      const gameVersion = asString(args.gameVersion);
      if (!name || !gameVersion) return { error: 'name_and_gameVersion_required' };
      const loader = asString(args.loader, 'vanilla').toLowerCase() || 'vanilla';
      const loaderVersion = asString(args.loaderVersion);
      if (loader !== 'vanilla' && !loaderVersion) {
        return { error: 'loaderVersion_required_for_modded' };
      }
      const id = makeBuildId(name);
      const build: any = {
        id,
        name,
        gameVersion,
        loader,
        loaderVersion,
        iconBg: BUILD_COLORS[Math.floor(Math.random() * BUILD_COLORS.length)],
        mods: [],
        resourcePacks: [],
        shaders: [],
        dataPacks: [],
      };
      const min = asNumber(args.memoryMin, 0);
      const max = asNumber(args.memoryMax, 0);
      if (min || max) build.memory = { min: min || 1024, max: max || 2048 };
      const builds = getBuilds();
      builds.push(build);
      saveBuilds(builds);
      const instancePath = ensureInstanceDirs(id);
      return { ok: true, build: buildSummary(build), instancePath };
    },
  },

  update_build: {
    risk: 'write',
    schema: {
      type: 'function',
      function: {
        name: 'update_build',
        description: 'Обновить поля сборки: имя, версию MC, loader, RAM, Java, JVM/MC args, окно.',
        parameters: {
          type: 'object',
          properties: {
            buildId: { type: 'string' },
            name: { type: 'string' },
            gameVersion: { type: 'string' },
            loader: { type: 'string' },
            loaderVersion: { type: 'string' },
            javaPath: { type: 'string' },
            jvmArgs: { type: 'string' },
            mcArgs: { type: 'string' },
            memoryMin: { type: 'number' },
            memoryMax: { type: 'number' },
            windowWidth: { type: 'number' },
            windowHeight: { type: 'number' },
            fullscreen: { type: 'boolean' },
          },
          required: ['buildId'],
          additionalProperties: false,
        },
      },
    },
    run: async (args) => {
      const buildId = asString(args.buildId);
      const builds = getBuilds();
      const idx = builds.findIndex((b: any) => b.id === buildId);
      if (idx < 0) return { error: 'build_not_found' };
      const b = builds[idx];
      if (args.name != null) b.name = asString(args.name) || b.name;
      if (args.gameVersion != null) b.gameVersion = asString(args.gameVersion) || b.gameVersion;
      if (args.loader != null) b.loader = asString(args.loader) || b.loader;
      if (args.loaderVersion != null) b.loaderVersion = asString(args.loaderVersion);
      if (args.javaPath != null) b.javaPath = asString(args.javaPath);
      if (args.jvmArgs != null) b.jvmArgs = asString(args.jvmArgs);
      if (args.mcArgs != null) b.mcArgs = asString(args.mcArgs);
      if (args.memoryMin != null || args.memoryMax != null) {
        const prev = b.memory || { min: 1024, max: 2048 };
        b.memory = {
          min: args.memoryMin != null ? asNumber(args.memoryMin, prev.min) : prev.min,
          max: args.memoryMax != null ? asNumber(args.memoryMax, prev.max) : prev.max,
        };
      }
      if (args.windowWidth != null || args.windowHeight != null || args.fullscreen != null) {
        const prev = b.window || { width: 854, height: 480, fullscreen: false };
        b.window = {
          width: args.windowWidth != null ? asNumber(args.windowWidth, prev.width) : prev.width,
          height: args.windowHeight != null ? asNumber(args.windowHeight, prev.height) : prev.height,
          fullscreen: args.fullscreen != null ? asBool(args.fullscreen, prev.fullscreen) : prev.fullscreen,
        };
      }
      builds[idx] = b;
      saveBuilds(builds);
      return { ok: true, build: buildSummary(b) };
    },
  },

  delete_build: {
    risk: 'write',
    schema: {
      type: 'function',
      function: {
        name: 'delete_build',
        description:
          'Удалить сборку из лаунчера. deleteFiles=true также удалит папку инстанса в .uclient.',
        parameters: {
          type: 'object',
          properties: {
            buildId: { type: 'string' },
            deleteFiles: { type: 'boolean' },
          },
          required: ['buildId'],
          additionalProperties: false,
        },
      },
    },
    run: async (args) => {
      const buildId = asString(args.buildId);
      if (!buildId) return { error: 'buildId_required' };
      const before = getBuilds();
      const next = before.filter((b: any) => b.id !== buildId);
      if (next.length === before.length) return { error: 'build_not_found' };
      saveBuilds(next);
      let deletedFiles = false;
      if (asBool(args.deleteFiles, false)) {
        const root = getInstanceRoot(buildId);
        if (fs.existsSync(root)) {
          fs.rmSync(root, { recursive: true, force: true });
          deletedFiles = true;
        }
      }
      return { ok: true, deletedFiles };
    },
  },

  duplicate_build: {
    risk: 'write',
    schema: {
      type: 'function',
      function: {
        name: 'duplicate_build',
        description: 'Дублировать сборку (метаданные). copyFiles=true копирует папку инстанса.',
        parameters: {
          type: 'object',
          properties: {
            buildId: { type: 'string' },
            name: { type: 'string' },
            copyFiles: { type: 'boolean' },
          },
          required: ['buildId'],
          additionalProperties: false,
        },
      },
    },
    run: async (args) => {
      const srcId = asString(args.buildId);
      const src = findBuild(srcId);
      if (!src) return { error: 'build_not_found' };
      const name = asString(args.name) || `${src.name} copy`;
      const id = makeBuildId(name);
      const clone = {
        ...JSON.parse(JSON.stringify(src)),
        id,
        name,
        playtime: 0,
      };
      const builds = getBuilds();
      builds.push(clone);
      saveBuilds(builds);
      let copied = false;
      if (asBool(args.copyFiles, false)) {
        const from = getInstanceRoot(srcId);
        const to = getInstanceRoot(id);
        if (fs.existsSync(from)) {
          fs.cpSync(from, to, { recursive: true });
          copied = true;
        } else {
          ensureInstanceDirs(id);
        }
      } else {
        ensureInstanceDirs(id);
      }
      return { ok: true, build: buildSummary(clone), copiedFiles: copied };
    },
  },

  list_java: {
    risk: 'read',
    schema: {
      type: 'function',
      function: {
        name: 'list_java',
        description:
          'Версии Java лаунчера. installed=true — есть в .Undefined Client/tools/java{N}.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
      },
    },
    run: async () => {
      const all = listInstalledJava();
      const installed = all.filter((j) => j.installed);
      return {
        installed,
        available: all,
        toolsDir: javaToolsDir(),
        count: installed.length,
      };
    },
  },

  list_mc_versions: {
    risk: 'read',
    schema: {
      type: 'function',
      function: {
        name: 'list_mc_versions',
        description:
          'Список версий Minecraft (Mojang manifest). type: release|snapshot|all. ' +
          'version — точная проверка id (напр. "1.0"); query — поиск по подстроке. ' +
          'Без version/query возвращаются только свежие версии (limit), старые вроде 1.0 в срез не попадут — для проверки id всегда передавай version.',
        parameters: {
          type: 'object',
          properties: {
            type: { type: 'string' },
            limit: { type: 'number' },
            query: { type: 'string' },
            version: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
    },
    run: async (args) => {
      const res = await fetch('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json', {
        headers: { 'User-Agent': 'Undefined-Client-AI' },
      });
      if (!res.ok) return { error: `manifest HTTP ${res.status}` };
      const data = await res.json();
      const all = Array.isArray(data?.versions) ? data.versions : [];
      const kind = asString(args.type, 'release').toLowerCase();
      const limit = Math.min(80, Math.max(5, asNumber(args.limit, 30)));
      const query = asString(args.query).toLowerCase();
      const checkId = asString(args.version);

      // Точная проверка: есть ли id в полном манифесте (не в укороченном списке)
      if (checkId) {
        const exact = all.find((v: any) => String(v.id) === checkId);
        const q = checkId.toLowerCase();
        const suggestions = all
          .filter((v: any) => {
            const id = String(v.id || '').toLowerCase();
            return id.includes(q) || q.includes(id);
          })
          .slice(0, 12)
          .map((v: any) => ({ id: v.id, type: v.type }));
        return {
          check: checkId,
          exists: Boolean(exact),
          match: exact ? { id: exact.id, type: exact.type } : null,
          suggestions,
          latest: data?.latest || null,
          note: exact
            ? 'Версия есть в манифесте Mojang.'
            : 'Точного id нет. Смотри suggestions — близкие варианты (напр. 1.0 существует как "1.0", не "1.0.0").',
        };
      }

      let versions = all;
      if (kind === 'release' || kind === 'snapshot') {
        versions = versions.filter((v: any) => v.type === kind);
      }
      if (query) {
        versions = versions.filter((v: any) => String(v.id || '').toLowerCase().includes(query));
      }
      return {
        latest: data?.latest || null,
        query: query || null,
        type: kind,
        count: versions.length,
        versions: versions.slice(0, limit).map((v: any) => ({ id: v.id, type: v.type })),
        note: query
          ? null
          : 'Это укороченный список свежих версий. Для проверки конкретного id вызови list_mc_versions с version="…".',
      };
    },
  },

  list_loader_versions: {
    risk: 'read',
    schema: {
      type: 'function',
      function: {
        name: 'list_loader_versions',
        description: 'Версии loader для MC: fabric|quilt|forge|neoforge.',
        parameters: {
          type: 'object',
          properties: {
            loader: { type: 'string' },
            gameVersion: { type: 'string' },
            limit: { type: 'number' },
          },
          required: ['loader', 'gameVersion'],
          additionalProperties: false,
        },
      },
    },
    run: async (args) => {
      const loader = asString(args.loader).toLowerCase();
      const gameVersion = asString(args.gameVersion);
      const limit = Math.min(40, Math.max(3, asNumber(args.limit, 12)));
      if (!loader || !gameVersion) return { error: 'loader_and_gameVersion_required' };

      if (loader === 'fabric') {
        const res = await fetch(
          `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(gameVersion)}`,
          { headers: { 'User-Agent': 'Undefined-Client-AI' } },
        );
        if (!res.ok) return { error: `fabric HTTP ${res.status}` };
        const list = await res.json();
        return {
          loader,
          gameVersion,
          versions: (Array.isArray(list) ? list : [])
            .slice(0, limit)
            .map((x: any) => x?.loader?.version)
            .filter(Boolean),
        };
      }
      if (loader === 'quilt') {
        const res = await fetch(
          `https://meta.quiltmc.org/v3/versions/loader/${encodeURIComponent(gameVersion)}`,
          { headers: { 'User-Agent': 'Undefined-Client-AI' } },
        );
        if (!res.ok) return { error: `quilt HTTP ${res.status}` };
        const list = await res.json();
        return {
          loader,
          gameVersion,
          versions: (Array.isArray(list) ? list : [])
            .slice(0, limit)
            .map((x: any) => x?.loader?.version)
            .filter(Boolean),
        };
      }
      if (loader === 'forge') {
        const res = await fetch('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json', {
          headers: { 'User-Agent': 'Undefined-Client-AI' },
        });
        if (!res.ok) return { error: `forge HTTP ${res.status}` };
        const data = await res.json();
        const promos = data?.promos || {};
        const recommended = promos[`${gameVersion}-recommended`];
        const latest = promos[`${gameVersion}-latest`];
        const versions = [recommended, latest].filter(Boolean);
        return { loader, gameVersion, versions: versions.slice(0, limit), recommended, latest };
      }
      if (loader === 'neoforge') {
        const res = await fetch(
          `https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge`,
          { headers: { 'User-Agent': 'Undefined-Client-AI' } },
        );
        if (!res.ok) return { error: `neoforge HTTP ${res.status}` };
        const data = await res.json();
        const mcMinor = gameVersion.replace(/^1\./, '');
        const versions = (Array.isArray(data?.versions) ? data.versions : [])
          .filter((v: string) => String(v).startsWith(mcMinor) || String(v).includes(gameVersion))
          .reverse()
          .slice(0, limit);
        return { loader, gameVersion, versions };
      }
      return { error: 'unsupported_loader' };
    },
  },

  search_mods: {
    risk: 'read',
    schema: {
      type: 'function',
      function: {
        name: 'search_mods',
        description: 'Поиск модов на Modrinth. Возвращает карточки для UI.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            version: { type: 'string' },
            loader: { type: 'string' },
            limit: { type: 'number' },
          },
          required: ['query'],
          additionalProperties: false,
        },
      },
    },
    run: async (args) => {
      const query = asString(args.query);
      if (!query) return { error: 'query_required', mods: [] };
      const hits = await modrinthSearch({
        query,
        type: 'mod',
        version: asString(args.version) || undefined,
        loader: asString(args.loader) || undefined,
        limit: Math.min(8, Math.max(1, asNumber(args.limit, 5))),
      });
      return { mods: hits.map(mapModCard), ui: 'mod_cards' };
    },
  },

  search_modpacks: {
    risk: 'read',
    schema: {
      type: 'function',
      function: {
        name: 'search_modpacks',
        description: 'Поиск модпаков на Modrinth.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            version: { type: 'string' },
            limit: { type: 'number' },
          },
          required: ['query'],
          additionalProperties: false,
        },
      },
    },
    run: async (args) => {
      const query = asString(args.query);
      if (!query) return { error: 'query_required', mods: [] };
      const hits = await modrinthSearch({
        query,
        type: 'modpack',
        version: asString(args.version) || undefined,
        limit: Math.min(6, Math.max(1, asNumber(args.limit, 4))),
      });
      return { mods: hits.map(mapModCard), ui: 'mod_cards' };
    },
  },

  search_resourcepacks: {
    risk: 'read',
    schema: {
      type: 'function',
      function: {
        name: 'search_resourcepacks',
        description: 'Поиск ресурспаков на Modrinth.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            version: { type: 'string' },
            limit: { type: 'number' },
          },
          required: ['query'],
          additionalProperties: false,
        },
      },
    },
    run: async (args) => {
      const query = asString(args.query);
      if (!query) return { error: 'query_required', mods: [] };
      const hits = await modrinthSearch({
        query,
        type: 'resourcepack',
        version: asString(args.version) || undefined,
        limit: Math.min(6, Math.max(1, asNumber(args.limit, 4))),
      });
      return { mods: hits.map(mapModCard), ui: 'mod_cards' };
    },
  },

  search_shaders: {
    risk: 'read',
    schema: {
      type: 'function',
      function: {
        name: 'search_shaders',
        description: 'Поиск шейдеров на Modrinth.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            version: { type: 'string' },
            limit: { type: 'number' },
          },
          required: ['query'],
          additionalProperties: false,
        },
      },
    },
    run: async (args) => {
      const query = asString(args.query);
      if (!query) return { error: 'query_required', mods: [] };
      const hits = await modrinthSearch({
        query,
        type: 'shader',
        version: asString(args.version) || undefined,
        limit: Math.min(6, Math.max(1, asNumber(args.limit, 4))),
      });
      return { mods: hits.map(mapModCard), ui: 'mod_cards' };
    },
  },

  get_mod: {
    risk: 'read',
    schema: {
      type: 'function',
      function: {
        name: 'get_mod',
        description: 'Карточка/детали проекта Modrinth по id или slug.',
        parameters: {
          type: 'object',
          properties: { projectId: { type: 'string' } },
          required: ['projectId'],
          additionalProperties: false,
        },
      },
    },
    run: async (args) => {
      const projectId = asString(args.projectId);
      if (!projectId) return { error: 'projectId_required' };
      const res = await fetch(`https://api.modrinth.com/v2/project/${encodeURIComponent(projectId)}`, {
        headers: { 'User-Agent': 'Undefined-Client-AI', Accept: 'application/json' },
      });
      if (!res.ok) return { error: `Modrinth HTTP ${res.status}` };
      const p = await res.json();
      const card = mapModCard({
        project_id: p.id,
        slug: p.slug,
        title: p.title,
        description: p.description,
        icon_url: p.icon_url,
        downloads: p.downloads,
        date_modified: p.updated,
        versions: p.game_versions,
        loaders: p.loaders,
        project_type: p.project_type,
      });
      return { mod: card, ui: 'mod_cards', mods: [card] };
    },
  },

  list_build_mods: {
    risk: 'read',
    schema: {
      type: 'function',
      function: {
        name: 'list_build_mods',
        description: 'Список jar в папке mods инстанса (.uclient). Учитывает .disabled.',
        parameters: {
          type: 'object',
          properties: { buildId: { type: 'string' } },
          required: ['buildId'],
          additionalProperties: false,
        },
      },
    },
    run: async (args) => {
      const buildId = asString(args.buildId);
      if (!buildId) return { error: 'buildId_required' };
      const modsDir = path.join(getInstanceRoot(buildId), 'mods');
      const mods = listDirFiles(modsDir, ['.jar', '.litemod']);
      return { mods, count: mods.length, path: modsDir };
    },
  },

  list_build_content: {
    risk: 'read',
    schema: {
      type: 'function',
      function: {
        name: 'list_build_content',
        description: 'Содержимое инстанса: mods, resourcepacks, shaderpacks, datapacks.',
        parameters: {
          type: 'object',
          properties: { buildId: { type: 'string' } },
          required: ['buildId'],
          additionalProperties: false,
        },
      },
    },
    run: async (args) => {
      const buildId = asString(args.buildId);
      if (!buildId) return { error: 'buildId_required' };
      const root = getInstanceRoot(buildId);
      return {
        path: root,
        mods: listDirFiles(path.join(root, 'mods'), ['.jar', '.litemod']),
        resourcepacks: listDirFiles(path.join(root, 'resourcepacks'), ['.zip']),
        shaderpacks: listDirFiles(path.join(root, 'shaderpacks'), ['.zip']),
        datapacks: listDirFiles(path.join(root, 'datapacks'), ['.zip']),
      };
    },
  },

  toggle_mod: {
    risk: 'write',
    schema: {
      type: 'function',
      function: {
        name: 'toggle_mod',
        description: 'Включить/выключить файл в mods/resourcepacks/shaderpacks (суффикс .disabled).',
        parameters: {
          type: 'object',
          properties: {
            buildId: { type: 'string' },
            filename: { type: 'string' },
            enabled: { type: 'boolean' },
            contentType: { type: 'string' },
          },
          required: ['buildId', 'filename'],
          additionalProperties: false,
        },
      },
    },
    run: async (args) => {
      const buildId = asString(args.buildId);
      const filename = asString(args.filename);
      const contentType = asString(args.contentType, 'mod') || 'mod';
      const sub = CONTENT_SUBDIRS[contentType] || 'mods';
      if (!buildId || !filename) return { error: 'buildId_and_filename_required' };
      const dir = path.join(getInstanceRoot(buildId), sub);
      const wantEnabled = args.enabled == null ? null : asBool(args.enabled, true);
      const baseName = filename.replace(/\.disabled$/i, '');
      const enabledPath = path.join(dir, baseName);
      const disabledPath = path.join(dir, `${baseName}.disabled`);
      const currentlyEnabled = fs.existsSync(enabledPath);
      const currentlyDisabled = fs.existsSync(disabledPath);
      if (!currentlyEnabled && !currentlyDisabled) return { error: 'file_not_found' };
      const targetEnabled = wantEnabled == null ? !currentlyEnabled : wantEnabled;
      if (targetEnabled && currentlyDisabled) {
        fs.renameSync(disabledPath, enabledPath);
      } else if (!targetEnabled && currentlyEnabled) {
        fs.renameSync(enabledPath, disabledPath);
      }
      return {
        ok: true,
        filename: targetEnabled ? baseName : `${baseName}.disabled`,
        enabled: targetEnabled,
        path: targetEnabled ? enabledPath : disabledPath,
      };
    },
  },

  remove_build_file: {
    risk: 'write',
    schema: {
      type: 'function',
      function: {
        name: 'remove_build_file',
        description: 'Удалить файл из mods/resourcepacks/shaderpacks/datapacks инстанса.',
        parameters: {
          type: 'object',
          properties: {
            buildId: { type: 'string' },
            filename: { type: 'string' },
            contentType: { type: 'string' },
          },
          required: ['buildId', 'filename'],
          additionalProperties: false,
        },
      },
    },
    run: async (args) => {
      const buildId = asString(args.buildId);
      const filename = asString(args.filename);
      const contentType = asString(args.contentType, 'mod') || 'mod';
      const sub = CONTENT_SUBDIRS[contentType] || 'mods';
      const target = safeJoinInstance(buildId, sub, filename);
      if (!target) return { error: 'invalid_path' };
      if (!fs.existsSync(target)) {
        const alt = safeJoinInstance(buildId, sub, filename.replace(/\.disabled$/i, '') + '.disabled');
        if (alt && fs.existsSync(alt)) {
          fs.rmSync(alt, { force: true });
          return { ok: true, deleted: path.basename(alt) };
        }
        return { error: 'file_not_found' };
      }
      fs.rmSync(target, { force: true });
      return { ok: true, deleted: filename };
    },
  },

  get_crash_report: {
    risk: 'read',
    schema: {
      type: 'function',
      function: {
        name: 'get_crash_report',
        description: 'Последний crash-log / latest.log сборки из .uclient.',
        parameters: {
          type: 'object',
          properties: { buildId: { type: 'string' } },
          required: ['buildId'],
          additionalProperties: false,
        },
      },
    },
    run: async (args) => {
      const buildId = asString(args.buildId);
      if (!buildId) return { error: 'buildId_required' };
      const root = getInstanceRoot(buildId);
      const candidates = [
        path.join(root, 'crash-log.txt'),
        path.join(root, 'logs', 'latest.log'),
      ];
      for (const file of candidates) {
        if (!fs.existsSync(file)) continue;
        const text = fs.readFileSync(file, 'utf-8');
        return { path: file, excerpt: text.slice(-3500) };
      }
      return { error: 'no_crash_log' };
    },
  },

  get_latest_log: {
    risk: 'read',
    schema: {
      type: 'function',
      function: {
        name: 'get_latest_log',
        description: 'Хвост logs/latest.log инстанса.',
        parameters: {
          type: 'object',
          properties: {
            buildId: { type: 'string' },
            chars: { type: 'number' },
          },
          required: ['buildId'],
          additionalProperties: false,
        },
      },
    },
    run: async (args) => {
      const buildId = asString(args.buildId);
      const chars = Math.min(8000, Math.max(500, asNumber(args.chars, 3500)));
      const file = path.join(getInstanceRoot(buildId), 'logs', 'latest.log');
      if (!fs.existsSync(file)) return { error: 'no_log' };
      const text = fs.readFileSync(file, 'utf-8');
      return { path: file, excerpt: text.slice(-chars) };
    },
  },

  clear_logs: {
    risk: 'write',
    schema: {
      type: 'function',
      function: {
        name: 'clear_logs',
        description: 'Очистить logs/ и crash-log.txt инстанса.',
        parameters: {
          type: 'object',
          properties: { buildId: { type: 'string' } },
          required: ['buildId'],
          additionalProperties: false,
        },
      },
    },
    run: async (args) => {
      const buildId = asString(args.buildId);
      const root = getInstanceRoot(buildId);
      let removed = 0;
      const crash = path.join(root, 'crash-log.txt');
      if (fs.existsSync(crash)) {
        fs.rmSync(crash, { force: true });
        removed += 1;
      }
      const logsDir = path.join(root, 'logs');
      if (fs.existsSync(logsDir)) {
        for (const name of fs.readdirSync(logsDir)) {
          try {
            fs.rmSync(path.join(logsDir, name), { force: true });
            removed += 1;
          } catch {
            /* skip */
          }
        }
      }
      return { ok: true, removed };
    },
  },

  open_build_folder: {
    risk: 'write',
    schema: {
      type: 'function',
      function: {
        name: 'open_build_folder',
        description: 'Открыть корень инстанса сборки в проводнике (.uclient).',
        parameters: {
          type: 'object',
          properties: { buildId: { type: 'string' } },
          required: ['buildId'],
          additionalProperties: false,
        },
      },
    },
    run: async (args) => {
      const buildId = asString(args.buildId);
      if (!buildId) return { error: 'buildId_required' };
      const dir = ensureInstanceDirs(buildId);
      await shell.openPath(dir);
      return { ok: true, path: dir };
    },
  },

  open_build_subfolder: {
    risk: 'write',
    schema: {
      type: 'function',
      function: {
        name: 'open_build_subfolder',
        description:
          'Открыть подпапку инстанса: mods|resourcepacks|shaderpacks|datapacks|saves|screenshots|config|logs.',
        parameters: {
          type: 'object',
          properties: {
            buildId: { type: 'string' },
            folder: { type: 'string' },
          },
          required: ['buildId', 'folder'],
          additionalProperties: false,
        },
      },
    },
    run: async (args) => {
      const buildId = asString(args.buildId);
      const folder = asString(args.folder, 'mods').toLowerCase() || 'mods';
      if (!OPEN_SUBDIRS.has(folder)) return { error: 'invalid_folder' };
      const root = ensureInstanceDirs(buildId);
      const dir = folder === '.' ? root : path.join(root, folder);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      await shell.openPath(dir);
      return { ok: true, path: dir };
    },
  },

  open_launcher_data_folder: {
    risk: 'write',
    schema: {
      type: 'function',
      function: {
        name: 'open_launcher_data_folder',
        description:
          'Открыть каталог данных лаунчера (.Undefined Client: builds.json, Java tools). Не путать с .uclient.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
      },
    },
    run: async () => {
      const dir = launcherDataDir();
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      await shell.openPath(dir);
      return { ok: true, path: dir };
    },
  },

  ensure_instance_dirs: {
    risk: 'write',
    schema: {
      type: 'function',
      function: {
        name: 'ensure_instance_dirs',
        description: 'Создать стандартные папки инстанса в .uclient, если их нет.',
        parameters: {
          type: 'object',
          properties: { buildId: { type: 'string' } },
          required: ['buildId'],
          additionalProperties: false,
        },
      },
    },
    run: async (args) => {
      const buildId = asString(args.buildId);
      if (!buildId) return { error: 'buildId_required' };
      if (!findBuild(buildId)) return { error: 'build_not_found' };
      const pathRoot = ensureInstanceDirs(buildId);
      return { ok: true, path: pathRoot };
    },
  },

  select_build: {
    risk: 'read',
    schema: {
      type: 'function',
      function: {
        name: 'select_build',
        description:
          'Выбрать сборку как контекст текущего чата агента. Вызывай, когда пользователь просит переключиться на сборку / работать с другой сборкой. UI лаунчера обновит чип контекста.',
        parameters: {
          type: 'object',
          properties: {
            buildId: { type: 'string', description: 'id сборки из list_builds' },
          },
          required: ['buildId'],
          additionalProperties: false,
        },
      },
    },
    run: async (args) => {
      const buildId = asString(args.buildId);
      const build = findBuild(buildId);
      if (!build) return { success: false, error: 'build_not_found' };
      return { success: true, selected: true, ...buildSummary(build) };
    },
  },

  install_mod: {
    risk: 'write',
    schema: {
      type: 'function',
      function: {
        name: 'install_mod',
        description:
          'Установить проект Modrinth в сборку. Без versionId подбирает файл под gameVersion и loader. Автоматически ставит транзитивные required-зависимости (как Prism), возвращает conflicts/optional/unresolved. contentType: mod|resourcepack|shader|datapack.',
        parameters: {
          type: 'object',
          properties: {
            buildId: { type: 'string' },
            projectId: { type: 'string' },
            versionId: { type: 'string' },
            contentType: { type: 'string' },
            gameVersion: {
              type: 'string',
              description: 'Опционально; по умолчанию версия MC сборки',
            },
            loader: {
              type: 'string',
              description: 'Опционально; по умолчанию loader сборки (fabric/forge/…)',
            },
          },
          required: ['buildId', 'projectId'],
          additionalProperties: false,
        },
      },
    },
    run: async (args) => ({
      deferred: 'install_content',
      buildId: asString(args.buildId),
      projectId: asString(args.projectId),
      versionId: asString(args.versionId) || undefined,
      contentType: asString(args.contentType, 'mod') || 'mod',
      gameVersion: asString(args.gameVersion) || undefined,
      loader: asString(args.loader) || undefined,
    }),
  },

  list_worlds: {
    risk: 'read',
    schema: {
      type: 'function',
      function: {
        name: 'list_worlds',
        description: 'Миры (saves/) инстанса сборки.',
        parameters: {
          type: 'object',
          properties: { buildId: { type: 'string' } },
          required: ['buildId'],
          additionalProperties: false,
        },
      },
    },
    run: async (args) => {
      const buildId = asString(args.buildId);
      const dir = path.join(getInstanceRoot(buildId), 'saves');
      if (!fs.existsSync(dir)) return { worlds: [], path: dir };
      const worlds = fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .filter((d) => fs.existsSync(path.join(dir, d.name, 'level.dat')))
        .slice(0, 40)
        .map((d) => ({ folder: d.name }));
      return { worlds, count: worlds.length, path: dir };
    },
  },

  delete_world: {
    risk: 'write',
    schema: {
      type: 'function',
      function: {
        name: 'delete_world',
        description: 'Удалить мир (папку в saves/) инстанса.',
        parameters: {
          type: 'object',
          properties: {
            buildId: { type: 'string' },
            folder: { type: 'string' },
          },
          required: ['buildId', 'folder'],
          additionalProperties: false,
        },
      },
    },
    run: async (args) => {
      const buildId = asString(args.buildId);
      const folder = asString(args.folder);
      const target = safeJoinInstance(buildId, 'saves', folder);
      if (!target || !fs.existsSync(target)) return { error: 'world_not_found' };
      fs.rmSync(target, { recursive: true, force: true });
      return { ok: true, deleted: folder };
    },
  },

  list_screenshots: {
    risk: 'read',
    schema: {
      type: 'function',
      function: {
        name: 'list_screenshots',
        description: 'Список скриншотов инстанса (имена файлов).',
        parameters: {
          type: 'object',
          properties: { buildId: { type: 'string' } },
          required: ['buildId'],
          additionalProperties: false,
        },
      },
    },
    run: async (args) => {
      const buildId = asString(args.buildId);
      const dir = path.join(getInstanceRoot(buildId), 'screenshots');
      if (!fs.existsSync(dir)) return { screenshots: [], path: dir };
      const screenshots = fs
        .readdirSync(dir)
        .filter((n) => /\.png$/i.test(n))
        .slice(0, 60)
        .map((name) => {
          const full = path.join(dir, name);
          let size = 0;
          let modified = 0;
          try {
            const st = fs.statSync(full);
            size = st.size;
            modified = st.mtimeMs;
          } catch {
            /* ignore */
          }
          return { name, size, modified };
        });
      return { screenshots, count: screenshots.length, path: dir };
    },
  },

  delete_screenshot: {
    risk: 'write',
    schema: {
      type: 'function',
      function: {
        name: 'delete_screenshot',
        description: 'Удалить скриншот из screenshots/ инстанса.',
        parameters: {
          type: 'object',
          properties: {
            buildId: { type: 'string' },
            filename: { type: 'string' },
          },
          required: ['buildId', 'filename'],
          additionalProperties: false,
        },
      },
    },
    run: async (args) => {
      const buildId = asString(args.buildId);
      const filename = asString(args.filename);
      const target = safeJoinInstance(buildId, 'screenshots', filename);
      if (!target || !fs.existsSync(target)) return { error: 'screenshot_not_found' };
      fs.rmSync(target, { force: true });
      return { ok: true, deleted: filename };
    },
  },

  list_configs: {
    risk: 'read',
    schema: {
      type: 'function',
      function: {
        name: 'list_configs',
        description: 'Файлы в config/ инстанса (имена, до 80).',
        parameters: {
          type: 'object',
          properties: { buildId: { type: 'string' } },
          required: ['buildId'],
          additionalProperties: false,
        },
      },
    },
    run: async (args) => {
      const buildId = asString(args.buildId);
      const dir = path.join(getInstanceRoot(buildId), 'config');
      if (!fs.existsSync(dir)) return { files: [], path: dir };
      const files: string[] = [];
      const walk = (d: string, prefix = '') => {
        if (files.length >= 80) return;
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
          if (files.length >= 80) break;
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) walk(path.join(d, entry.name), rel);
          else files.push(rel);
        }
      };
      walk(dir);
      return { files, count: files.length, path: dir };
    },
  },

  list_accounts: {
    risk: 'read',
    schema: {
      type: 'function',
      function: {
        name: 'list_accounts',
        description: 'Список аккаунтов лаунчера (без токенов): username, type.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
      },
    },
    run: async () => {
      const accounts = readJsonArray(path.join(launcherDataDir(), 'accounts.json'));
      return {
        accounts: accounts.slice(0, 30).map((a: any) => ({
          uuid: a.uuid || a.id || null,
          username: a.username || a.name || null,
          type: a.type || a.meta?.type || 'unknown',
        })),
        count: accounts.length,
      };
    },
  },

  list_servers: {
    risk: 'read',
    schema: {
      type: 'function',
      function: {
        name: 'list_servers',
        description: 'Сохранённые серверы лаунчера.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
      },
    },
    run: async () => {
      const servers = readJsonArray(path.join(launcherDataDir(), 'servers.json'));
      return {
        servers: servers.slice(0, 40).map((s: any) => ({
          id: s.id,
          name: s.name,
          ip: s.ip,
          port: s.port || null,
          version: s.version || null,
        })),
        count: servers.length,
      };
    },
  },

  get_launcher_info: {
    risk: 'read',
    schema: {
      type: 'function',
      function: {
        name: 'get_launcher_info',
        description:
          'Сводка лаунчера: сборки, аккаунты, Java, пути .Undefined Client и .uclient.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
      },
    },
    run: async () => {
      const builds = getBuilds();
      const accounts = readJsonArray(path.join(launcherDataDir(), 'accounts.json'));
      return {
        builds: builds.length,
        accounts: accounts.length,
        java: listInstalledJava().filter((j) => j.installed),
        launcherDataDir: launcherDataDir(),
        instancesDir: getInstancesDir(),
        note: 'Метаданные — .Undefined Client; инстансы с модами — .uclient.',
      };
    },
  },

  web_search: {
    risk: 'read',
    schema: {
      type: 'function',
      function: {
        name: 'web_search',
        description:
          'Поиск в интернете (DuckDuckGo). Используй для актуальных фактов, новостей, гайдов и внешних ссылок. ' +
          'Не выдумывай URL — бери их из results. Для модов Modrinth по-прежнему предпочтительны search_mods/get_mod.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Поисковый запрос' },
            limit: { type: 'number', description: 'Число результатов (1–8), по умолчанию 5' },
          },
          required: ['query'],
          additionalProperties: false,
        },
      },
    },
    run: async (args) => {
      const query = asString(args.query);
      if (!query) return { error: 'query_required', results: [] };
      const limit = Math.min(8, Math.max(1, asNumber(args.limit, 5)));
      const instant = await duckDuckGoInstant(query).catch(() => ({
        abstract: '',
        abstractUrl: '',
        answer: '',
        related: [] as WebHit[],
      }));
      let results: WebHit[] = [];
      let source = 'instant';
      try {
        results = await duckDuckGoHtmlSearch(query, limit);
        source = results.length ? 'html+instant' : 'instant';
      } catch (e: any) {
        source = 'instant';
        if (!instant.abstract && !instant.related.length) {
          return {
            error: e?.message || 'search_failed',
            query,
            results: [],
          };
        }
      }
      if (!results.length && instant.related.length) {
        results = instant.related.slice(0, limit);
      }
      if (instant.abstractUrl && instant.abstract && !results.some((r) => r.url === instant.abstractUrl)) {
        results = [
          {
            title: instant.abstract.slice(0, 100) || instant.abstractUrl,
            url: instant.abstractUrl,
            snippet: instant.abstract,
          },
          ...results,
        ].slice(0, limit);
      }
      return {
        query,
        source,
        answer: instant.answer || null,
        abstract: instant.abstract || null,
        abstractUrl: instant.abstractUrl || null,
        results,
        count: results.length,
        note:
          results.length || instant.abstract
            ? 'Опирайся на results/abstract; ссылки только отсюда. Для полного текста страницы — fetch_url.'
            : 'Пусто. Уточни query или попробуй другой формулировкой.',
      };
    },
  },

  fetch_url: {
    risk: 'read',
    schema: {
      type: 'function',
      function: {
        name: 'fetch_url',
        description:
          'Скачать и прочитать текстовое содержимое HTTP(S)-страницы (HTML → текст). ' +
          'Используй после web_search, когда нужен текст конкретной ссылки. Не для бинарников.',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'Полный http(s) URL' },
            maxChars: {
              type: 'number',
              description: 'Максимум символов текста (500–12000), по умолчанию 6000',
            },
          },
          required: ['url'],
          additionalProperties: false,
        },
      },
    },
    run: async (args) => {
      const url = asString(args.url);
      if (!url) return { error: 'url_required' };
      if (!isHttpUrl(url)) return { error: 'only_http_https' };
      const maxChars = Math.min(12_000, Math.max(500, asNumber(args.maxChars, 6000)));
      try {
        const res = await fetchTextLimited(url);
        if (!res.ok) return { error: `HTTP ${res.status}`, url: res.finalUrl };
        const ct = res.contentType.toLowerCase();
        if (
          ct.includes('application/octet-stream') ||
          ct.includes('image/') ||
          ct.includes('audio/') ||
          ct.includes('video/') ||
          ct.includes('application/zip') ||
          ct.includes('application/pdf')
        ) {
          return { error: 'unsupported_content_type', contentType: res.contentType, url: res.finalUrl };
        }
        let text = res.text;
        if (ct.includes('html') || /<html[\s>]/i.test(text) || /<body[\s>]/i.test(text)) {
          text = stripHtmlToText(text);
        } else if (ct.includes('json')) {
          try {
            text = JSON.stringify(JSON.parse(text), null, 2);
          } catch {
            /* raw */
          }
        } else {
          text = text.replace(/\r\n/g, '\n').trim();
        }
        const truncated = text.length > maxChars;
        return {
          url: res.finalUrl,
          contentType: res.contentType || null,
          truncated,
          text: text.slice(0, maxChars),
          chars: Math.min(text.length, maxChars),
        };
      } catch (e: any) {
        const msg = e?.name === 'AbortError' ? 'timeout' : e?.message || 'fetch_failed';
        return { error: msg, url };
      }
    },
  },
};

Object.assign(
  TOOLS,
  getExtendedAiTools({
    asString,
    asNumber,
    asBool,
    getBuilds,
    saveBuilds,
    findBuild,
    buildSummary,
    launcherDataDir,
    getInstanceRoot,
    safeJoinInstance,
    ensureInstanceDirs,
    readJsonArray,
    writeJsonArray,
    listInstalledJava,
    JAVA_MANAGED_VERSIONS,
    installContentDirect,
    CONTENT_SUBDIRS,
    callRendererAiAction,
  }),
);

/** Убирает description у properties — модели хватает имён полей и required. */
function stripParamDescriptions(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripParamDescriptions);
  if (!value || typeof value !== 'object') return value;
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'description' && typeof v === 'string') continue;
    out[k] = stripParamDescriptions(v);
  }
  return out;
}

/** compact=true — короткие description + без описаний параметров (экономия на каждый запрос). */
export function listAiToolSchemas(opts?: { compact?: boolean }): AiToolSchema[] {
  return Object.values(TOOLS).map((t) => {
    if (!opts?.compact) return t.schema;
    const desc = String(t.schema.function.description || '');
    const short = (desc.split(/(?<=[.!?])\s/)[0] || desc).slice(0, 120);
    return {
      type: 'function' as const,
      function: {
        name: t.schema.function.name,
        description: short,
        parameters: stripParamDescriptions(t.schema.function.parameters) as Record<string, unknown>,
      },
    };
  });
}

export function getAiToolRisk(name: string): AiToolRisk | null {
  return TOOLS[name]?.risk || null;
}

function normalizeLoaderId(loader: string): string {
  return String(loader || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

async function installContentDirect(
  buildId: string,
  projectId: string,
  versionId?: string,
  contentType = 'mod',
  gameVersion?: string,
  loader?: string,
): Promise<unknown> {
  const build = findBuild(buildId);
  const targetGame = String(gameVersion || build?.gameVersion || build?.version || '').trim();
  const targetLoader = normalizeLoaderId(String(loader || build?.loader || ''));
  const instanceRoot = getInstanceRoot(buildId);
  const installedIds = collectInstalledProjectIds(instanceRoot, build);
  installedIds.delete(String(projectId));

  const result = await installModWithDependencies({
    instanceRoot,
    projectId,
    versionId,
    contentType,
    gameVersion: targetGame,
    loader: targetLoader,
    installedProjectIds: installedIds,
    // Агент ставит с force: конфликты возвращаем в result, не блокируем
    options: { force: true },
  });

  if (!result.success) {
    return {
      success: false,
      error: result.error,
      gameVersion: targetGame || null,
      loader: targetLoader || null,
      conflicts: result.conflicts || [],
      unresolved: result.unresolved || [],
      hint:
        result.error === 'no_compatible_version'
          ? 'Нет файла Modrinth под версию/loader сборки. Укажи versionId или выбери другой проект.'
          : undefined,
    };
  }

  // Пишем метаданные в builds.json (как UI после installMod)
  if (build) {
    const buildMap: Record<string, string> = {
      mod: 'mods',
      resourcepack: 'resourcePacks',
      shader: 'shaders',
      datapack: 'dataPacks',
    };
    for (const item of result.installed) {
      const key = buildMap[item.contentType] || 'mods';
      if (!Array.isArray(build[key])) build[key] = [];
      const arr = build[key] as any[];
      const idx = arr.findIndex(
        (m: any) =>
          (item.projectId && m.projectId === item.projectId) ||
          (item.filename && m.filename === item.filename),
      );
      const entry = {
        name: item.name,
        enabled: true,
        filename: item.filename,
        version: item.version || '',
        description: item.description || '',
        projectId: item.projectId || '',
        iconUrl: item.iconUrl || '',
      };
      if (idx >= 0) arr[idx] = { ...arr[idx], ...entry };
      else arr.push(entry);
    }
    const all = getBuilds();
    const bi = all.findIndex((b: any) => b.id === buildId);
    if (bi >= 0) {
      all[bi] = build;
      saveBuilds(all);
    }
  }

  return {
    success: true,
    filename: result.filename,
    path: path.join(
      instanceRoot,
      CONTENT_SUBDIRS[result.contentType] || 'mods',
      result.filename,
    ),
    projectId: result.projectId,
    versionNumber: result.version,
    title: result.name,
    contentType: result.contentType,
    instancePath: instanceRoot,
    dependenciesInstalled: result.dependenciesInstalled,
    installed: result.installed,
    optionalSuggested: result.optionalSuggested,
    conflicts: result.conflicts,
    unresolved: result.unresolved,
    alreadySatisfied: result.alreadySatisfied,
  };
}

export async function runAiTool(
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ ok: boolean; risk?: AiToolRisk; result?: unknown; error?: string }> {
  // result заполняется и при ok:false для install_mod (детали no_compatible_version)
  const tool = TOOLS[name];
  if (!tool) return { ok: false, error: `unknown_tool:${name}` };
  try {
    let result = await tool.run(args || {});

    if (
      name === 'install_mod' &&
      result &&
      typeof result === 'object' &&
      (result as any).deferred === 'install_content'
    ) {
      const { buildId, projectId, versionId, contentType, gameVersion, loader } = result as any;
      if (!buildId || !projectId) {
        return { ok: false, risk: tool.risk, error: 'buildId_and_projectId_required' };
      }
      if (!findBuild(buildId)) {
        return { ok: false, risk: tool.risk, error: 'build_not_found' };
      }
      result = await installContentDirect(
        buildId,
        projectId,
        versionId,
        contentType,
        gameVersion,
        loader,
      );
      if (result && typeof result === 'object' && (result as any).success === false) {
        return { ok: false, risk: tool.risk, error: String((result as any).error || 'install_failed'), result };
      }
    }

    return { ok: true, risk: tool.risk, result };
  } catch (e: any) {
    return { ok: false, risk: tool.risk, error: e?.message || 'tool_failed' };
  }
}

export function registerAiToolIpc(): void {
  ipcMain.handle('ai:tools:list', async () => ({
    tools: listAiToolSchemas(),
    names: Object.keys(TOOLS),
  }));

  ipcMain.handle(
    'ai:tools:run',
    async (
      _event,
      name: string,
      args: Record<string, unknown>,
      opts?: { confirmed?: boolean },
    ) => {
      if (typeof name !== 'string' || !name.trim()) {
        return { ok: false, error: 'name_required' };
      }
      const risk = getAiToolRisk(name);
      if (risk === 'write' && !opts?.confirmed) {
        return { ok: false, error: 'confirm_required', risk: 'write' };
      }
      return runAiTool(name.trim(), args && typeof args === 'object' ? args : {});
    },
  );
}
