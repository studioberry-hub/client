// ===== MCP-инструменты агента лаунчера (исполнение на клиенте) =====
import fs from 'fs';
import path from 'path';
import { BrowserWindow, ipcMain, shell } from 'electron';
import { getInstanceRoot, getInstancesDir } from './launcher';
import { deleteBuildInstance, getLauncherDataDir } from './paths';
import { getExtendedAiTools } from './ai-tools-extended';
import { getUAgentMcpTools } from './uagent-mcp';
import { agentHostedAction } from './hostedServers';
import { aroundText, applyTextReplace, fragmentDiff, fsProblem, listEntries, searchFiles, viewText } from './file-view';
import { callRendererAiAction } from './ai-action-bridge';
import {
  collectInstalledProjectIds,
  installModWithDependencies,
} from './modDependencies';
import { listLoaderVersions } from './loaderVersions';

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
  return getLauncherDataDir();
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
  const java = resolveEffectiveJava(b);
  return {
    id,
    name: b.name,
    gameVersion: b.gameVersion || b.version,
    loader: b.loader || 'vanilla',
    loaderVersion: b.loaderVersion || null,
    javaPath: b.javaPath || null,
    java: java,
    memory: b.memory || null,
    window: b.window || null,
    jvmArgs: b.jvmArgs || '',
    mcArgs: b.mcArgs || '',
    instancePath: id ? getInstanceRoot(id) : null,
  };
}

/** Major Java по версии MC — та же логика, что у лаунчера при авто-выборе. */
function requiredJavaMajor(gameVersion: string): { required: number; reason: string } {
  const raw = String(gameVersion || '').trim().toLowerCase();
  if (!raw || raw === 'latest_release' || raw === 'latest_snapshot') {
    return { required: 21, reason: 'Для новых версий Minecraft безопаснее брать Java 21.' };
  }
  const match = raw.match(/^1\.(\d+)(?:\.(\d+))?/);
  if (!match) return { required: 17, reason: 'Версия не распознана, используется безопасная рекомендация Java 17.' };
  const minor = Number(match[1] || 0);
  const patch = Number(match[2] || 0);
  if (minor >= 21) return { required: 21, reason: 'Minecraft 1.21+ рассчитан на Java 21.' };
  if (minor === 20 && patch >= 5) {
    return { required: 21, reason: 'Minecraft 1.20.5+ требует Java 21.' };
  }
  if (minor >= 18) return { required: 17, reason: 'Minecraft 1.18-1.20.4 обычно запускается на Java 17.' };
  if (minor === 17) return { required: 16, reason: 'Minecraft 1.17 требует Java 16.' };
  return { required: 8, reason: 'Для старых версий Minecraft обычно нужна Java 8.' };
}

/**
 * Эффективная Java сборки: pinned path или авто-выбор managed runtime
 * (как при запуске, когда javaPath пустой).
 */
function resolveEffectiveJava(build: any): {
  mode: 'pinned' | 'auto' | 'missing';
  path: string | null;
  requiredMajor: number;
  reason: string;
  selectedMajor: number | null;
} {
  const info = requiredJavaMajor(String(build?.gameVersion || build?.version || ''));
  const pinned = String(build?.javaPath || '').trim();
  if (pinned && fs.existsSync(pinned)) {
    return {
      mode: 'pinned',
      path: pinned,
      requiredMajor: info.required,
      reason: info.reason,
      selectedMajor: null,
    };
  }
  const installed = listInstalledJava().filter((j) => j.installed && j.path);
  const exact = installed.find((j) => j.version === info.required);
  const fallback = installed
    .filter((j) => j.version >= info.required)
    .sort((a, b) => a.version - b.version)[0];
  const pick = exact || fallback || null;
  return {
    mode: pick?.path ? 'auto' : 'missing',
    path: pick?.path || null,
    requiredMajor: info.required,
    reason: info.reason,
    selectedMajor: pick?.version ?? null,
  };
}

function normalizeModQuery(raw: string): string {
  return String(raw || '')
    .toLowerCase()
    .replace(/\.jar$/i, '')
    .replace(/\.disabled$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function findModsByQuery(
  mods: { name: string; size: number; enabled: boolean }[],
  query: string,
): { name: string; size: number; enabled: boolean; score: number }[] {
  const q = normalizeModQuery(query);
  if (!q) return [];
  const tokens = q.split(/\s+/).filter(Boolean);
  const scored = mods
    .map((m) => {
      const base = normalizeModQuery(m.name);
      let score = 0;
      if (base === q) score = 100;
      else if (base.includes(q) || q.includes(base)) score = 80;
      else if (tokens.every((t) => base.includes(t))) score = 60;
      else if (tokens.some((t) => t.length >= 3 && base.includes(t))) score = 35;
      return { ...m, score };
    })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, 12);
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

function parseDdgLite(html: string, limit: number): WebHit[] {
  const hits: WebHit[] = [];
  const seen = new Set<string>();
  const re = /<a[^>]*class=['"]result-link['"][^>]*href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) && hits.length < limit) {
    const url = unwrapDdgRedirect(decodeHtmlEntities(match[1] || ''));
    if (!isHttpUrl(url) || /duckduckgo\.com/i.test(url) || seen.has(url)) continue;
    const title = stripHtmlToText(match[2] || '').slice(0, 180);
    if (!title) continue;
    seen.add(url);
    hits.push({ title, url, snippet: '' });
  }
  return hits;
}

function parseLooseLinks(html: string, limit: number, skip: RegExp): WebHit[] {
  const hits: WebHit[] = [];
  const seen = new Set<string>();
  const re = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) && hits.length < limit) {
    const url = unwrapDdgRedirect(decodeHtmlEntities(match[1] || ''));
    if (!isHttpUrl(url) || skip.test(url) || seen.has(url)) continue;
    const title = stripHtmlToText(match[2] || '').slice(0, 180);
    if (title.length < 3) continue;
    seen.add(url);
    hits.push({ title, url, snippet: '' });
  }
  return hits;
}

async function searchPage(url: string, limit: number, skip: RegExp): Promise<WebHit[]> {
  const res = await fetchTextLimited(url, {
    accept: 'text/html',
    headers: { 'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8' },
  });
  if (!res.ok) throw new Error(`search HTTP ${res.status}`);
  const hits = parseDdgHtmlResults(res.text, limit);
  if (hits.length) return hits;
  const lite = parseDdgLite(res.text, limit);
  if (lite.length) return lite;
  return parseLooseLinks(res.text, limit, skip);
}

async function duckDuckGoHtmlSearch(query: string, limit: number): Promise<WebHit[]> {
  const pages = [
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
    `https://www.mojeek.com/search?q=${encodeURIComponent(query)}`,
  ];
  const settled = await Promise.all(pages.map((url) => searchPage(url, limit, /duckduckgo\.com|mojeek\.com/i).catch(() => [] as WebHit[])));
  const hits = settled.find((rows) => rows.length);
  if (hits?.length) return hits;
  throw new Error('поиск не открылся');
}

async function wikiHits(query: string, limit: number): Promise<WebHit[]> {
  const url = `https://ru.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=${limit}&namespace=0&format=json`;
  const res = await fetchTextLimited(url, { accept: 'application/json' });
  if (!res.ok) return [];
  const data = JSON.parse(res.text);
  const titles: string[] = Array.isArray(data?.[1]) ? data[1] : [];
  const snippets: string[] = Array.isArray(data?.[2]) ? data[2] : [];
  const urls: string[] = Array.isArray(data?.[3]) ? data[3] : [];
  return titles.slice(0, limit).map((title, index) => ({
    title: String(title),
    url: String(urls[index] || ''),
    snippet: String(snippets[index] || '').slice(0, 320),
  })).filter((hit) => isHttpUrl(hit.url));
}

async function catalogHits(query: string, limit: number): Promise<WebHit[]> {
  const hits: WebHit[] = [];
  const pushModrinth = async (type: string) => {
    const rows = await modrinthSearch({ query, type, limit });
    for (const row of rows) {
      const card = mapModCard(row);
      if (!card.slug) continue;
      hits.push({
        title: String(card.title || card.slug),
        url: `https://modrinth.com/${type === 'plugin' ? 'plugin' : 'mod'}/${card.slug}`,
        snippet: [card.description, card.loaders?.slice?.(0, 4)?.join?.(', '), card.versions?.slice?.(-3)?.join?.(', ')].filter(Boolean).join(' · ').slice(0, 320),
      });
    }
  };
  await Promise.all([
    pushModrinth('plugin').catch(() => undefined),
    pushModrinth('mod').catch(() => undefined),
  ]);
  try {
    const res = await fetchTextLimited(`https://hangar.papermc.io/api/v1/projects?q=${encodeURIComponent(query)}&limit=${limit}`, { accept: 'application/json' });
    if (res.ok) {
      const data = JSON.parse(res.text);
      const rows = Array.isArray(data?.result) ? data.result : [];
      for (const row of rows) {
        const owner = row?.namespace?.owner || row?.owner;
        const slug = row?.namespace?.slug || row?.slug;
        if (!owner || !slug) continue;
        hits.push({
          title: String(row?.name || slug),
          url: `https://hangar.papermc.io/${owner}/${slug}`,
          snippet: String(row?.description || '').slice(0, 320),
        });
      }
    }
  } catch {
    /* Hangar необязателен, если ответили другие каталоги */
  }
  try {
    const res = await fetchTextLimited(`https://api.spiget.org/v2/search/resources/${encodeURIComponent(query)}?size=${limit}&field=name&sort=-downloads`, { accept: 'application/json' });
    if (res.ok) {
      const rows = JSON.parse(res.text);
      if (Array.isArray(rows)) {
        for (const row of rows) {
          if (!row?.id || !row?.name) continue;
          hits.push({
            title: String(row.name),
            url: `https://www.spigotmc.org/resources/${row.id}`,
            snippet: String(row.tag || '').replace(/<[^>]+>/g, ' ').slice(0, 320),
          });
        }
      }
    }
  } catch {
    /* Spigot необязателен */
  }
  return hits.slice(0, limit);
}

async function collectWebHits(query: string, limit: number): Promise<{ results: WebHit[]; notes: string[] }> {
  const notes: string[] = [];
  const results: WebHit[] = [];
  const push = (hits: WebHit[]) => {
    for (const hit of hits) {
      if (results.length >= limit || !hit.url || results.some((row) => row.url === hit.url)) continue;
      results.push(hit);
    }
  };
  await Promise.all([
    duckDuckGoHtmlSearch(query, limit).then(push).catch((err: any) => notes.push(String(err?.message || 'поиск не открылся'))),
    wikiHits(query, Math.min(3, limit)).then(push).catch(() => undefined),
    catalogHits(query, limit).then(push).catch(() => undefined),
  ]);
  return { results: results.slice(0, limit), notes };
}

const PLUGIN_GUIDES: Array<{ test: RegExp; file: string; note: string }> = [
  { test: /essentials/i, file: 'plugins/Essentials/config.yml', note: 'EssentialsX. Сначала прочитай config.yml. Меняй только нужные ключи уже существующего файла: chat, homes, tpa, spawn, kits. После правки перезапусти сервер или выполни ess reload, если команда есть. Версия плагина должна поддерживать gameVersion.' },
  { test: /luckperms/i, file: 'plugins/LuckPerms/config.yml', note: 'LuckPerms настраивается командами, не правкой yaml: lp user <ник> permission set <право> true, lp group <группа> parent add <родитель>, lp editor. В config.yml трогай только storage-method, если об этом прямо попросили.' },
  { test: /worldedit/i, file: 'plugins/WorldEdit/config.yml', note: 'WorldEdit. Лимиты блоков лежат в config.yml. Права worldedit.* выдаются через LuckPerms командой lp, а не записью в файл.' },
  { test: /worldguard/i, file: 'plugins/WorldGuard/config.yml', note: 'WorldGuard. Регионы создаются командами /rg define, /rg addmember и /rg flag, пока сервер запущен. regions.yml руками не переписывай.' },
  { test: /coreprotect/i, file: 'plugins/CoreProtect/config.yml', note: 'CoreProtect. В config.yml выбирается sqlite или mysql. Откат делается командой /co rollback, не правкой базы.' },
  { test: /viaversion|viabackwards|viarewind/i, file: 'plugins/ViaVersion/config.yml', note: 'ViaVersion ставится на сервер новее клиента. Обычно конфиг не нужен. Бери сборку, в чьих версиях есть gameVersion сервера.' },
  { test: /geyser/i, file: 'plugins/Geyser-Spigot/config.yml', note: 'Geyser. После первого запуска проверь bedrock.port и auth-type. Порт Bedrock не должен совпадать с Java-портом. Вход без Microsoft-аккаунта требует Floodgate той же линейки.' },
  { test: /floodgate/i, file: 'plugins/floodgate/config.yml', note: 'Floodgate. username-prefix по умолчанию точка. Файл key.pem не перезаписывай.' },
  { test: /placeholderapi|\bpapi\b/i, file: 'plugins/PlaceholderAPI/config.yml', note: 'PlaceholderAPI почти без конфига. Расширения ставятся командами /papi ecloud download <имя> и /papi reload.' },
  { test: /\bspark\b/i, file: 'plugins/spark/config.json', note: 'spark настраивать файлом обычно не нужно. Профиль снимается командами /spark profiler, /spark tps и /spark health.' },
  { test: /voicechat|voice chat/i, file: 'plugins/voicechat/voicechat-server.properties', note: 'Simple Voice Chat. port должен быть свободен. voice_host — публичный адрес для игроков не из локальной сети. Версия мода у игрока должна совпадать с плагином.' },
  { test: /\btab\b|tablist/i, file: 'plugins/TAB/config.yml', note: 'TAB. Шапка и подвал — header и footer в plugins/TAB/config.yml. Найди файл, прочитай его и замени строки через edit_hosted_file. После записи выполни /tab reload, иначе в игре останется старый текст.' },
  { test: /skript/i, file: 'plugins/Skript/scripts', note: 'Skript. Новый скрипт — write_hosted_file в plugins/Skript/scripts/*.sk, правку существующего — edit_hosted_file. Включай командой /sk reload. Не клади .sk прямо в plugins.' },
  { test: /motd|serverlist|miniemotd|advancedserverlist/i, file: 'plugins', note: 'MOTD на Paper ставят Custom MOTD, MiniMOTD или AdvancedServerList. Текст правь в их config.yml после первого запуска, когда файл уже появился.' },
];

function readableDocument(raw: string, contentType: string): string {
  let text = raw;
  const ct = contentType.toLowerCase();
  if (ct.includes('html') || /<html[\s>]/i.test(text) || /<body[\s>]/i.test(text)) {
    text = text.replace(/<(script|style|noscript|svg|nav|footer|header|aside)[\s\S]*?<\/\1>/gi, ' ');
    text = stripHtmlToText(text);
  } else if (ct.includes('json')) {
    try {
      text = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      text = text.replace(/\r\n/g, '\n').trim();
    }
  } else text = text.replace(/\r\n/g, '\n').trim();
  return text;
}

function readableUrls(url: string): string[] {
  const out: string[] = [];
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parsed.hostname === 'github.com' && parts.length >= 4 && parts[2] === 'wiki') {
      const page = decodeURIComponent(parts.slice(3).join('/')) || 'Home';
      out.push(`https://raw.githubusercontent.com/wiki/${parts[0]}/${parts[1]}/${page}.md`);
    }
    if (parsed.hostname === 'github.com' && parts.length >= 5 && parts[2] === 'blob') {
      out.push(`https://raw.githubusercontent.com/${parts[0]}/${parts[1]}/${parts[3]}/${parts.slice(4).join('/')}`);
    }
  } catch {
    /* остаётся исходный адрес */
  }
  out.push(url);
  return out;
}

function pageWindow(text: string, query: string, offset: number, limit: number): { text: string; truncated: boolean; note: string; offset?: number; nextOffset?: number; total?: number; matches?: number } {
  const norm = text.replace(/\r\n/g, '\n').trim();
  const needle = query.trim().toLowerCase();
  if (needle) {
    const windows: string[] = [];
    let from = 0;
    let count = 0;
    while (windows.length < 6) {
      const at = norm.toLowerCase().indexOf(needle, from);
      if (at < 0) break;
      count += 1;
      const start = Math.max(0, at - 320);
      const end = Math.min(norm.length, at + needle.length + 900);
      windows.push(norm.slice(start, end).trim());
      from = at + Math.max(1, needle.length);
    }
    if (!windows.length) {
      return {
        text: '',
        truncated: false,
        matches: 0,
        total: norm.length,
        note: 'Этой строки на странице нет. Смени query или читай документ с offset 0.',
      };
    }
    return {
      text: windows.join('\n\n---\n\n'),
      truncated: false,
      matches: count,
      total: norm.length,
      note: 'Куски страницы вокруг query, не её начало. Если факта нет, уточни query.',
    };
  }
  const start = Math.max(0, Math.min(offset, norm.length));
  const slice = norm.slice(start, start + limit);
  const next = start + slice.length;
  const more = next < norm.length;
  return {
    text: slice,
    truncated: more,
    offset: start,
    nextOffset: more ? next : undefined,
    total: norm.length,
    note: more
      ? `Показаны символы ${start}–${next} из ${norm.length}. Продолжение: тот же url и offset ${next}. Точную строку быстрее найти через query.`
      : 'Страница прочитана до конца.',
  };
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
      const mods = listDirFiles(path.join(root, 'mods'), ['.jar', '.litemod']);
      const java = resolveEffectiveJava(build);
      return {
        ...buildSummary(build),
        instanceExists: fs.existsSync(root),
        modsCount: mods.length,
        modsEnabled: mods.filter((m) => m.enabled).length,
        javaNote:
          java.mode === 'auto'
            ? 'javaPath пустой — лаунчер сам подставит managed Java при запуске (см. java.path).'
            : java.mode === 'pinned'
              ? 'Java закреплена в настройках сборки.'
              : 'Подходящая Java не найдена.',
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
        description: 'Путь папки сборки (моды и миры). Свои серверы здесь не лежат — для них list_hosted_servers.',
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
          'Создать сборку в лаунчере. Достаточно name, gameVersion и loader. Версию загрузчика инструмент подберёт сам.',
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
      const known = new Set(['vanilla', 'fabric', 'forge', 'quilt', 'neoforge']);
      if (!known.has(loader)) return { ok: false, error: 'unknown_loader' };
      let loaderVersion = asString(args.loaderVersion);
      if (loader !== 'vanilla' && !loaderVersion) {
        const listed = await listLoaderVersions(loader, gameVersion);
        loaderVersion = listed.versions?.[0] || '';
        if (!loaderVersion) return { ok: false, error: listed.error || 'Нет версии загрузчика для этой Minecraft' };
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
      let deletedFiles = false;
      if (asBool(args.deleteFiles, false)) {
        const removed = await deleteBuildInstance(buildId);
        if (!removed.ok) return { error: removed.error || 'delete_failed' };
        deletedFiles = true;
      }
      saveBuilds(next);
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
      const listed = await listLoaderVersions(loader, gameVersion);
      return {
        loader,
        gameVersion,
        versions: (listed.versions || []).slice(0, limit),
        unavailable: !!listed.unavailable,
        error: listed.error,
      };
    },
  },

  search_mods: {
    risk: 'read',
    schema: {
      type: 'function',
      function: {
        name: 'search_mods',
        description: 'Поиск модов Modrinth строго под version и loader сборки или сервера. Без них выдача чужая.',
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

  find_mod_in_build: {
    risk: 'read',
    schema: {
      type: 'function',
      function: {
        name: 'find_mod_in_build',
        description:
          'Проверить, есть ли мод уже в mods выбранной сборки (по имени/slug/фрагменту jar). Вызывай ПЕРЕД предложением install_mod или вопросом «установить?».',
        parameters: {
          type: 'object',
          properties: {
            buildId: { type: 'string' },
            query: {
              type: 'string',
              description: 'Название мода, slug Modrinth или фрагмент имени файла',
            },
          },
          required: ['buildId', 'query'],
          additionalProperties: false,
        },
      },
    },
    run: async (args) => {
      const buildId = asString(args.buildId);
      const query = asString(args.query);
      if (!buildId) return { error: 'buildId_required' };
      if (!query) return { error: 'query_required' };
      if (!findBuild(buildId)) return { error: 'build_not_found' };
      const modsDir = path.join(getInstanceRoot(buildId), 'mods');
      const mods = listDirFiles(modsDir, ['.jar', '.litemod']);
      const matches = findModsByQuery(mods, query);
      return {
        buildId,
        query,
        alreadyInstalled: matches.length > 0,
        matches,
        modsTotal: mods.length,
        hint: matches.length
          ? 'Мод уже в сборке — не предлагай установку, сообщи пользователю.'
          : 'Совпадений нет — можно предлагать install_mod.',
      };
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
          'Установить проект Modrinth в сборку. Перед вызовом обязательно find_mod_in_build (или list_build_mods): если мод уже есть — не вызывай. Без versionId подбирает файл под gameVersion и loader. Автозависимости required. contentType: mod|resourcepack|shader|datapack.',
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
        description: 'Текстовые файлы. Если buildId начинается с hs, это файлы своего сервера, включая скрипты. Иначе только config/ сборки; всё дерево — list_instance_files.',
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
        description: 'Серверы для подключения из вкладки «Серверы». Свой сервер на этом ПК — list_hosted_servers, не этот список.',
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
          'Поиск в интернете. Дальше читай страницу через fetch_url: url из results и query со словами, которые ищешь. ' +
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
      const found = await collectWebHits(query, limit);
      const instant = await duckDuckGoInstant(query).catch(() => ({
        abstract: '',
        abstractUrl: '',
        answer: '',
        related: [] as WebHit[],
      }));
      let results = found.results;
      if (!results.length && instant.related.length) results = instant.related.slice(0, limit);
      if (instant.abstractUrl && instant.abstract && !results.some((row) => row.url === instant.abstractUrl)) {
        results = [{ title: instant.abstract.slice(0, 100), url: instant.abstractUrl, snippet: instant.abstract }, ...results].slice(0, limit);
      }
      if (!results.length && !instant.abstract) {
        return { error: found.notes[0] || 'Поиск ничего не вернул. Переформулируй запрос.', query, results: [] };
      }
      return {
        query,
        answer: instant.answer || null,
        abstract: instant.abstract || null,
        abstractUrl: instant.abstractUrl || null,
        results,
        count: results.length,
        note: 'Ссылки только из results. Страницу открывай fetch_url с query: слова, которые ищешь. Без query вернётся начало и nextOffset. Не пиши пользователю сырое fetch failed.',
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
          'Прочитать страницу по http(s). query — слова со страницы, вернётся кусок вокруг них. offset листает дальше, если есть nextOffset.',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'Полный http(s) URL' },
            query: { type: 'string', description: 'Слова, которые нужно найти на странице' },
            offset: { type: 'number', description: 'С какого символа читать, если query пустой' },
          },
          required: ['url'],
          additionalProperties: false,
        },
      },
    },
    run: async (args) => readPublicPage(asString(args.url), {
      query: asString(args.query),
      offset: asNumber(args.offset, 0),
    }),
  },

  lookup_plugin: {
    risk: 'read',
    schema: {
      type: 'function',
      function: {
        name: 'lookup_plugin',
        description:
          'Найти плагин под версию сервера в Paper, Hangar и Spigot и сказать, как его настраивать. Ключи конфига не выдумывай.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            gameVersion: { type: 'string' },
          },
          required: ['query'],
          additionalProperties: false,
        },
      },
    },
    run: async (args) => {
      const query = asString(args.query);
      if (!query) return { error: 'Нужно имя плагина' };
      const gameVersion = asString(args.gameVersion);
      const found = await collectWebHits(`${query} ${gameVersion}`.trim(), 6);
      const guides = PLUGIN_GUIDES.filter((guide) => guide.test.test(query) || found.results.some((hit) => guide.test.test(hit.title))).map((guide) => ({
        file: guide.file,
        note: guide.note,
      }));
      return {
        query,
        gameVersion: gameVersion || null,
        guides,
        results: found.results,
        note: 'Ставь плагин через install_matching_plugin, если versions проекта содержат gameVersion. Потом scan_configs и read_hosted_file. Меняй только ключи, которые уже есть в файле. Если конфига ещё нет, сначала запусти сервер. LuckPerms и регионы WorldGuard настраиваются командами.',
      };
    },
  },

  ask_user_form: {
    risk: 'read',
    schema: {
      type: 'function',
      function: {
        name: 'ask_user_form',
        description:
          'Показать форму, если ник, материал или выбор нельзя узнать инструментом. Версию и файлы так не спрашивай.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            submitLabel: { type: 'string' },
            fields: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  label: { type: 'string' },
                  type: { type: 'string' },
                  options: { type: 'array', items: { type: 'string' } },
                  placeholder: { type: 'string' },
                  required: { type: 'boolean' },
                },
                required: ['id', 'label'],
              },
            },
          },
          required: ['title', 'fields'],
          additionalProperties: false,
        },
      },
    },
    run: async (args) => ({
      ok: false,
      error: 'Форму показывает чат агента. Повтори вызов из интерфейса.',
      title: asString(args.title),
    }),
  },
};

async function readPublicPage(url: string, focus: { query?: string; offset?: number } = {}): Promise<Record<string, unknown>> {
  if (!url) return { error: 'url_required' };
  if (!isHttpUrl(url)) return { error: 'only_http_https' };
  const query = String(focus.query || '').slice(0, 120);
  const offset = Math.max(0, Number(focus.offset) || 0);
  const limit = query ? 7000 : 4500;
  let lastError: any = null;
  for (const candidate of readableUrls(url)) {
    const direct = await fetchTextLimited(candidate).catch((err: any) => err);
    if (!direct?.ok) {
      lastError = lastError || direct;
      continue;
    }
    const ct = String(direct.contentType || '');
    if (/octet-stream|image\/|audio\/|video\/|application\/zip|application\/pdf/i.test(ct)) {
      return { error: 'Это не текстовая страница', contentType: ct, url: direct.finalUrl || candidate };
    }
    const text = readableDocument(direct.text, ct);
    if (text.trim().length < 40) continue;
    const page = pageWindow(text, query, offset, limit);
    return { url: direct.finalUrl || candidate, via: candidate === url ? 'direct' : 'raw', contentType: ct || null, query: query || null, ...page };
  }
  const modrinth = url.match(/modrinth\.com\/(?:plugin|mod|modpack|resourcepack|shader|datapack)\/([^/?#]+)/i);
  if (modrinth) {
    const api = await fetchTextLimited(`https://api.modrinth.com/v2/project/${encodeURIComponent(modrinth[1])}`, { accept: 'application/json' }).catch(() => null);
    if (api?.ok) {
      try {
        const data = JSON.parse(api.text);
        const text = [data?.title, data?.description, data?.body].filter(Boolean).join('\n\n');
        const page = pageWindow(text, query, offset, limit);
        return { url, via: 'modrinth', query: query || null, ...page };
      } catch {
        /* страница каталога без JSON */
      }
    }
  }
  const hangar = url.match(/hangar\.papermc\.io\/([^/]+)\/([^/?#]+)/i);
  if (hangar) {
    const api = await fetchTextLimited(`https://hangar.papermc.io/api/v1/projects/${encodeURIComponent(hangar[1])}/${encodeURIComponent(hangar[2])}`, { accept: 'application/json' }).catch(() => null);
    if (api?.ok) {
      try {
        const data = JSON.parse(api.text);
        const text = [data?.name, data?.description].filter(Boolean).join('\n\n');
        const page = pageWindow(text, query, offset, limit);
        return { url, via: 'hangar', query: query || null, ...page };
      } catch {
        /* страница Hangar без JSON */
      }
    }
  }
  const mirror = await fetchTextLimited(`https://r.jina.ai/${url}`, { accept: 'text/plain' }).catch(() => null);
  if (mirror?.ok && mirror.text.trim()) {
    const page = pageWindow(readableDocument(mirror.text, 'text/plain'), query, offset, limit);
    return { url, via: 'mirror', query: query || null, ...page };
  }
  const reason = lastError?.name === 'AbortError' ? 'timeout' : lastError?.message || `HTTP ${lastError?.status || 0}`;
  return {
    error: /fetch failed/i.test(String(reason)) ? 'Страница не открылась. Возьми другую ссылку из web_search или lookup_plugin.' : reason,
    url,
  };
}

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

Object.assign(TOOLS, getUAgentMcpTools(), getMatchTools());

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

  // Уже стоит (по projectId из метаданных инстанса) — не ставим повторно
  if (installedIds.has(String(projectId))) {
    const mods = listDirFiles(path.join(instanceRoot, 'mods'), ['.jar', '.litemod']);
    return {
      success: true,
      alreadyInstalled: true,
      projectId,
      buildId,
      matches: findModsByQuery(mods, String(projectId)),
      hint: 'Проект уже установлен в этой сборке — установка не нужна.',
    };
  }

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

const HOSTED_CONFIG_TOOLS = new Set([
  'read_config',
  'write_config',
  'list_configs',
  'list_build_content',
  'get_instance_path',
]);

function isHostedServerId(id: string): boolean {
  return /^hs[0-9a-f]{8,}$/i.test(id);
}

function hostedQueryFromPath(rel: string): string {
  const parts = rel.split('/').filter(Boolean);
  const dirs = parts.slice(0, -1).filter((part) => !/^(config|plugins|mods)$/i.test(part));
  return (dirs[dirs.length - 1] || parts[parts.length - 1] || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** id вида hs… — это свой сервер. Конфиг плагина лежит в его папке, не в сборке. */
async function runHostedConfigTool(name: string, id: string, args: Record<string, unknown>): Promise<unknown> {
  if (name === 'list_configs' || name === 'list_build_content' || name === 'get_instance_path') {
    const found = (await agentHostedAction('find-files', { id, query: '' })) as { files?: string[] };
    return {
      ok: true,
      hostedServerId: id,
      files: found.files || [],
      note: 'Это свой сервер, не сборка. Читай и записывай файл через read_config и write_config с этим buildId и relativePath из files.',
    };
  }
  const rel = String(args.relativePath || args.path || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (name === 'read_config') {
    const direct = (await agentHostedAction('read-file', { id, path: rel, offset: args.offset, limit: args.limit })) as { ok?: boolean; body?: string; dir?: boolean; error?: string };
    if (direct.ok && !direct.dir) return { ok: true, hostedServerId: id, relativePath: rel, content: direct.body, ...direct };
    if (direct.dir) return { ...direct, hostedServerId: id };
    const found = (await agentHostedAction('find-files', { id, query: hostedQueryFromPath(rel) })) as { files?: string[] };
    const files = found.files || [];
    if (files.length === 1) {
      const file = (await agentHostedAction('read-file', { id, path: files[0], offset: args.offset, limit: args.limit })) as { ok?: boolean; body?: string; dir?: boolean };
      if (file.ok && !file.dir) {
        return { ok: true, hostedServerId: id, relativePath: files[0], content: file.body, ...file, note: `Файл найден как ${files[0]}` };
      }
    }
    return { ok: false, error: direct.error || 'file_not_found', tried: rel, files, hostedServerId: id };
  }
  const text = String(args.content ?? args.text ?? '');
  let target = rel;
  const existing = (await agentHostedAction('read-file', { id, path: rel })) as { ok?: boolean; error?: string };
  if (existing.error && /не текстовый/i.test(existing.error)) {
    return { ok: false, error: existing.error, hostedServerId: id };
  }
  if (!existing.ok) {
    const concrete = rel.includes('/') || /\.[a-z0-9]{1,16}$/i.test(path.basename(rel));
    if (!concrete) {
      const found = (await agentHostedAction('find-files', { id, query: hostedQueryFromPath(rel) })) as { files?: string[] };
      const files = found.files || [];
      if (files.length !== 1) {
        return { ok: false, error: 'file_not_found', tried: rel, files, hostedServerId: id };
      }
      target = files[0];
    }
  }
  const written = (await agentHostedAction('write-file', { id, path: target, text })) as { ok?: boolean; error?: string; entries?: string[] };
  return written.ok
    ? { ok: true, hostedServerId: id, relativePath: target }
    : { ok: false, error: written.error || 'write_failed', entries: written.entries, hostedServerId: id };
}

function toolResultError(result: unknown): string {
  if (!result || typeof result !== 'object') return '';
  const rec = result as { ok?: boolean; success?: boolean; error?: unknown; build?: unknown; mods?: unknown; versions?: unknown };
  if (rec.ok === false || rec.success === false) return String(rec.error || 'ошибка');
  const err = typeof rec.error === 'string' ? rec.error.trim() : '';
  if (err && rec.ok !== true && rec.success !== true && !rec.build && !rec.mods && !rec.versions) return err;
  return '';
}

async function searchCatalog(
  query: string,
  type: string,
  version: string,
  loaders: string[],
  limit: number,
): Promise<any[]> {
  const params = new URLSearchParams();
  params.set('query', query);
  const facets: string[][] = [[`project_type:${type}`]];
  if (loaders.length) facets.push(loaders.map((loader) => `categories:${loader}`));
  if (version) facets.push([`versions:${version}`]);
  params.set('facets', JSON.stringify(facets));
  params.set('limit', String(limit));
  const res = await fetch(`https://api.modrinth.com/v2/search?${params.toString()}`, {
    headers: { 'User-Agent': 'Undefined-Client-AI', Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Modrinth HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data?.hits) ? data.hits : [];
}

const PAPER_PLUGIN_LOADERS = ['paper', 'purpur', 'spigot', 'bukkit', 'folia'];
const PROXY_LOADERS = new Set(['velocity', 'bungeecord', 'waterfall']);

function catalogForSoftware(software: string): { type: string; loaders: string[]; via: string } {
  const kind = software.toLowerCase();
  if (kind === 'fabric' || kind === 'quilt' || kind === 'forge' || kind === 'neoforge') return { type: 'mod', loaders: [kind], via: kind };
  if (kind === 'vanilla') return { type: 'datapack', loaders: [], via: 'датапаки' };
  if (['sponge', 'canvas', 'arclight', 'youer', 'banner', 'divinemc'].includes(kind)) return { type: 'mod', loaders: ['fabric', 'forge'], via: 'Fabric и Forge' };
  if (PROXY_LOADERS.has(kind)) return { type: 'plugin', loaders: [kind], via: kind };
  // Leaf, Leaves, Purpur, Pufferfish, Folia и Spigot своего каталога не имеют: ставятся Paper-плагины.
  return { type: 'plugin', loaders: PAPER_PLUGIN_LOADERS, via: 'Paper' };
}

function compactPluginName(value: string): string {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function pluginQueryVariants(query: string): string[] {
  const raw = query.trim();
  const spaced = raw
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const out = [raw];
  if (spaced && spaced.toLowerCase() !== raw.toLowerCase()) out.push(spaced);
  const words = spaced.split(' ').filter((word) => word.length > 2);
  if (words.length >= 3) out.push(words.slice(0, -1).join(' '));
  return out;
}

function pluginNameScore(query: string, hit: { title?: string; slug?: string }): number {
  const wanted = compactPluginName(query);
  const title = compactPluginName(hit.title || '');
  const slug = compactPluginName(hit.slug || '');
  if (!wanted || !title && !slug) return 0;
  if (title === wanted || slug === wanted) return 100;
  if (title.startsWith(wanted) || slug.startsWith(wanted) || title.includes(wanted)) return 85;
  return 0;
}

async function modrinthJar(projectId: string, gameVersion: string, loaders: string[]): Promise<{ url: string; filename: string } | null> {
  const params = new URLSearchParams();
  if (gameVersion) params.set('game_versions', JSON.stringify([gameVersion]));
  if (loaders.length) params.set('loaders', JSON.stringify(loaders));
  const res = await fetch(`https://api.modrinth.com/v2/project/${encodeURIComponent(projectId)}/version?${params.toString()}`, {
    headers: { 'User-Agent': 'Undefined-Client-AI', Accept: 'application/json' },
  });
  if (!res.ok) return null;
  const versions = await res.json();
  const list = Array.isArray(versions) ? versions : [];
  const wanted = loaders.map((item) => item.toLowerCase());
  const ranked = list
    .map((version) => {
      const got = (Array.isArray(version?.loaders) ? version.loaders : []).map((item: string) => String(item).toLowerCase());
      return { version, got };
    })
    .filter(({ got }) => {
      if (!got.length) return false;
      if (wanted.length && !got.some((item: string) => wanted.includes(item))) return false;
      if (!wanted.some((item: string) => PROXY_LOADERS.has(item)) && got.every((item: string) => PROXY_LOADERS.has(item))) return false;
      return true;
    })
    .sort((a, b) => Number(b.got.includes('paper')) - Number(a.got.includes('paper')));
  for (const row of ranked) {
    const files = Array.isArray(row.version?.files) ? row.version.files : [];
    const file = files.find((item: { primary?: boolean; url?: string }) => item?.primary && item.url) || files.find((item: { url?: string }) => item?.url);
    if (file?.url) return { url: String(file.url), filename: String(file.filename || '') };
  }
  return null;
}

const INSTANCE_TEXT_BYTES = 1_000_000;
const INSTANCE_BINARY_RE = /\.(jar|zip|gz|tgz|7z|rar|tar|png|jpe?g|gif|webp|bmp|ico|exe|dll|so|dylib|class|nbt|mca|dat|db|sqlite3?|lock|ogg|mp3|wav|flac|bin|pak|litemod|schem|schematic)$/i;

function instanceFilePath(buildId: string, rel: string): string | null {
  if (!findBuild(buildId)) return null;
  const root = path.resolve(getInstanceRoot(buildId));
  const clean = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (clean.split('/').some((part) => part === '..')) return null;
  const target = path.resolve(root, clean || '.');
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return target;
}

function listInstanceDir(buildId: string, rel: string): unknown {
  const dir = instanceFilePath(buildId, rel);
  if (!dir) return { ok: false, error: 'Сборка не найдена' };
  try {
    const listed = listEntries(dir);
    return {
      ok: true,
      path: rel || '',
      entries: listed.entries,
      truncated: listed.truncated,
      note: listed.truncated ? 'Показана только часть папки. Ищи файл через find_instance_files.' : undefined,
    };
  } catch (err) {
    return { ok: false, error: fsProblem(err), entries: [] };
  }
}

function readInstanceText(buildId: string, rel: string, offset = 1, limit = 160): unknown {
  const target = instanceFilePath(buildId, rel);
  if (!target) return { ok: false, error: 'Сборка не найдена' };
  try {
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      const listed = listInstanceDir(buildId, rel) as { entries?: unknown; truncated?: boolean };
      return { ok: true, dir: true, path: rel, entries: listed.entries, truncated: listed.truncated, note: 'Это папка. Читай файл по имени из entries.' };
    }
    if (!stat.isFile()) return { ok: false, error: 'Это не файл' };
    if (INSTANCE_BINARY_RE.test(path.basename(target))) return { ok: false, error: 'Это не текстовый файл' };
    if (stat.size > INSTANCE_TEXT_BYTES) return { ok: false, error: 'Файл слишком большой' };
    const buf = fs.readFileSync(target);
    if (buf.includes(0)) return { ok: false, error: 'Это не текстовый файл' };
    return { ok: true, path: rel, ...viewText(buf.toString('utf8'), offset, limit) };
  } catch (err) {
    return { ok: false, error: fsProblem(err) };
  }
}

function writeInstanceText(buildId: string, rel: string, text: string): unknown {
  const target = instanceFilePath(buildId, rel);
  if (!target || !rel || /[\\/]$/.test(rel)) return { ok: false, error: 'Нужен путь к файлу внутри сборки' };
  if (INSTANCE_BINARY_RE.test(path.basename(rel))) return { ok: false, error: 'Это не текстовый файл' };
  if (text.includes('\0') || Buffer.byteLength(text, 'utf8') > INSTANCE_TEXT_BYTES) return { ok: false, error: 'Текст слишком большой' };
  try {
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
      const listed = listEntries(target);
      return { ok: false, error: 'Это папка. Нужен путь к файлу внутри неё.', entries: listed.entries.map((entry) => entry.name) };
    }
    if (fs.existsSync(target) && fs.statSync(target).isFile()) {
      return {
        ok: false,
        path: rel,
        error: `Файл ${rel} уже есть. Прочитай его и замени фрагмент через edit_instance_file. Целиком существующий файл не переписывается.`,
      };
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text, 'utf8');
    const diff = fragmentDiff('', text);
    return { ok: true, path: rel, created: true, added: diff.added, diff: diff.lines, note: 'Создан новый файл. Уже лежащий конфиг этим вызовом не меняется.' };
  } catch (err) {
    return { ok: false, error: fsProblem(err) };
  }
}

function editInstanceText(buildId: string, rel: string, old: string, next: string): unknown {
  const target = instanceFilePath(buildId, rel);
  if (!target || !rel) return { ok: false, error: 'Нужен путь к файлу внутри сборки' };
  try {
    const stat = fs.statSync(target);
    if (!stat.isFile()) return { ok: false, error: 'Это папка. Нужен путь к файлу.' };
    if (INSTANCE_BINARY_RE.test(path.basename(target))) return { ok: false, error: 'Это не текстовый файл' };
    if (stat.size > INSTANCE_TEXT_BYTES) return { ok: false, error: 'Файл слишком большой' };
    const prev = fs.readFileSync(target, 'utf8');
    const replaced = applyTextReplace(prev, old, next);
    if (!replaced.ok) return { ...replaced, path: rel };
    fs.writeFileSync(target, replaced.text, 'utf8');
    const diff = fragmentDiff(old, next);
    return { ok: true, path: rel, added: diff.added, removed: diff.removed, diff: diff.lines, ...aroundText(replaced.text, next), note: `Записано в ${rel}.` };
  } catch (err) {
    return { ok: false, error: fsProblem(err) };
  }
}

function searchInstance(buildId: string, rel: string, query: string, kind: 'grep' | 'find'): unknown {
  const root = instanceFilePath(buildId, '');
  if (!root) return { ok: false, error: 'Сборка не найдена', matches: [] };
  const start = instanceFilePath(buildId, rel);
  if (!start) return { ok: false, error: 'Неверный путь', matches: [] };
  return searchFiles(root, rel, query, kind);
}

function transferInstanceFile(buildId: string, from: string, to: string, move: boolean): unknown {
  const src = instanceFilePath(buildId, from);
  const dest = instanceFilePath(buildId, to);
  const root = path.resolve(getInstanceRoot(buildId));
  if (!src || !dest || !from || !to || path.resolve(src) === root || path.resolve(dest) === root) {
    return { ok: false, error: 'Нужны путь и назначение внутри сборки' };
  }
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (move) fs.renameSync(src, dest);
    else fs.cpSync(src, dest, { recursive: true });
    return { ok: true, path: from, dest: to };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function getMatchTools(): Record<string, ToolEntry> {
  return {
    install_matching_mod: {
      risk: 'write',
      schema: {
        type: 'function',
        function: {
          name: 'install_matching_mod',
          description: 'Найти в каталоге и поставить мод, ресурс-пак, шейдер или датапак под версию и загрузчик сборки.',
          parameters: {
            type: 'object',
            properties: {
              buildId: { type: 'string' },
              query: { type: 'string' },
              contentType: { type: 'string' },
            },
            required: ['buildId', 'query'],
            additionalProperties: false,
          },
        },
      },
      run: async (args) => {
        const buildId = asString(args.buildId);
        const query = asString(args.query);
        const build = findBuild(buildId);
        if (!build) return { ok: false, error: 'Сборка не найдена' };
        const gameVersion = String(build.gameVersion || build.version || '');
        const loader = String(build.loader || 'vanilla').toLowerCase();
        const contentType = asString(args.contentType, 'mod') || 'mod';
        const type = contentType === 'shader' ? 'shader' : contentType === 'resourcepack' ? 'resourcepack' : contentType === 'datapack' ? 'datapack' : 'mod';
        if (type === 'mod' && (!loader || loader === 'vanilla')) return { ok: false, error: 'У ванильной сборки нет модов. Нужен fabric, forge, quilt или neoforge.' };
        const hits = await searchCatalog(query, type, gameVersion, type === 'mod' ? [loader] : [], 6);
        if (!hits.length) return { ok: false, error: `В каталоге нет «${query}» для ${gameVersion} ${loader}` };
        const errors: string[] = [];
        for (const hit of hits.slice(0, 4)) {
          const projectId = String(hit.project_id || hit.slug || '');
          if (!projectId) continue;
          const installed = await installContentDirect(buildId, projectId, undefined, contentType, gameVersion, loader) as { success?: boolean; error?: string; filename?: string; alreadyInstalled?: boolean };
          if (installed?.success !== false) {
            return { ok: true, title: hit.title, projectId, gameVersion, loader, filename: installed?.filename || null, alreadyInstalled: Boolean(installed?.alreadyInstalled) };
          }
          errors.push(String(installed?.error || hit.title));
        }
        return { ok: false, error: errors[0] || 'Нет совместимого файла', gameVersion, loader };
      },
    },
    install_matching_plugin: {
      risk: 'write',
      schema: {
        type: 'function',
        function: {
          name: 'install_matching_plugin',
          description: 'Найти плагин в каталоге Modrinth и поставить его. Leaf, Purpur, Pufferfish, Folia и Spigot ставят Paper-плагины: своего каталога у этих ядер нет. Слитное имя вроде CustomMOTD находится как Custom MOTD.',
          parameters: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              query: { type: 'string' },
            },
            required: ['id', 'query'],
            additionalProperties: false,
          },
        },
      },
      run: async (args) => {
        const id = asString(args.id);
        const query = asString(args.query);
        const listed = await agentHostedAction('list') as { servers?: Array<{ id?: string; software?: string; gameVersion?: string; name?: string }> };
        const server = (listed?.servers || []).find((row) => row.id === id);
        if (!server) return { ok: false, error: 'Сервер не найден' };
        const software = String(server.software || '');
        const gameVersion = String(server.gameVersion || '');
        const catalog = catalogForSoftware(software);
        const variants = pluginQueryVariants(query);
        let hits: any[] = [];
        for (const variant of variants) {
          hits = await searchCatalog(variant, catalog.type, gameVersion, catalog.loaders, 8);
          if (hits.length) break;
        }
        if (!hits.length) {
          for (const variant of variants) {
            const wider = await searchCatalog(variant, catalog.type, '', catalog.loaders, 8);
            const matched = wider.filter((hit) => !gameVersion || (Array.isArray(hit.versions) && hit.versions.includes(gameVersion)));
            if (matched.length) {
              hits = matched;
              break;
            }
            if (!hits.length) hits = wider;
          }
        }
        const ranked = hits
          .map((hit) => ({ hit, score: Math.max(pluginNameScore(query, hit), pluginNameScore(variants[1] || query, hit)) }))
          .sort((a, b) => b.score - a.score);
        const best = ranked.filter((row) => row.score >= 85);
        const compatible = best.filter((row) => !gameVersion || (Array.isArray(row.hit.versions) && row.hit.versions.includes(gameVersion)));
        const note = software.toLowerCase() === catalog.via.toLowerCase()
          ? ''
          : `${software} не имеет своего каталога и запускает плагины ${catalog.via}.`;
        if (!compatible.length) {
          const suggestions = ranked.slice(0, 4).map((row) => String(row.hit.title || row.hit.slug || '')).filter(Boolean);
          const hint = suggestions.length ? ` Ближайшие в каталоге ${catalog.via}: ${suggestions.join(', ')}. Поставь один из них этим же инструментом, файл вручную не проси.` : '';
          return { ok: false, error: `В каталоге ${catalog.via} нет «${query}» под Minecraft ${gameVersion}. ${note}${hint}`.trim(), suggestions };
        }
        for (const row of compatible.slice(0, 3)) {
          const hit = row.hit;
          const projectId = String(hit.project_id || hit.slug || '');
          const file = await modrinthJar(projectId, gameVersion, catalog.loaders);
          if (!file) continue;
          const installed = await agentHostedAction('install-url', { id, url: file.url, filename: file.filename }) as { ok?: boolean; error?: string; already?: boolean };
          if (installed?.ok !== false) {
            return { ok: true, title: hit.title, projectId, software, gameVersion, filename: file.filename, already: Boolean(installed?.already), catalog: catalog.via, note: note || undefined };
          }
        }
        return { ok: false, error: `У «${query}» нет файла ${catalog.via} под Minecraft ${gameVersion}. ${note}`.trim() };
      },
    },
    list_instance_files: {
      risk: 'read',
      schema: {
        type: 'function',
        function: {
          name: 'list_instance_files',
          description: 'Одна папка сборки. path пустой — корень. Чтобы найти файл по имени, вызови find_instance_files.',
          parameters: {
            type: 'object',
            properties: { buildId: { type: 'string' }, path: { type: 'string' } },
            required: ['buildId'],
            additionalProperties: false,
          },
        },
      },
      run: async (args) => listInstanceDir(asString(args.buildId), asString(args.path)),
    },
    read_instance_file: {
      risk: 'read',
      schema: {
        type: 'function',
        function: {
          name: 'read_instance_file',
          description: 'Окно файла сборки с номерами строк. offset листает дальше. Папка вернёт список.',
          parameters: {
            type: 'object',
            properties: {
              buildId: { type: 'string' },
              path: { type: 'string' },
              offset: { type: 'number' },
              limit: { type: 'number' },
            },
            required: ['buildId', 'path'],
            additionalProperties: false,
          },
        },
      },
      run: async (args) => readInstanceText(asString(args.buildId), asString(args.path), Number(args.offset) || 1, Number(args.limit) || 160),
    },
    edit_instance_file: {
      risk: 'write',
      schema: {
        type: 'function',
        function: {
          name: 'edit_instance_file',
          description: 'Заменить в файле сборки уникальный фрагмент old на new. Номер строки в old не копируй.',
          parameters: {
            type: 'object',
            properties: {
              buildId: { type: 'string' },
              path: { type: 'string' },
              old: { type: 'string' },
              new: { type: 'string' },
            },
            required: ['buildId', 'path', 'old', 'new'],
            additionalProperties: false,
          },
        },
      },
      run: async (args) => editInstanceText(asString(args.buildId), asString(args.path), String(args.old ?? ''), String(args.new ?? '')),
    },
    grep_instance_files: {
      risk: 'read',
      schema: {
        type: 'function',
        function: {
          name: 'grep_instance_files',
          description: 'Найти строку в текстовых файлах сборки: путь, номер строки и текст.',
          parameters: {
            type: 'object',
            properties: { buildId: { type: 'string' }, query: { type: 'string' }, path: { type: 'string' } },
            required: ['buildId', 'query'],
            additionalProperties: false,
          },
        },
      },
      run: async (args) => searchInstance(asString(args.buildId), asString(args.path), asString(args.query), 'grep'),
    },
    find_instance_files: {
      risk: 'read',
      schema: {
        type: 'function',
        function: {
          name: 'find_instance_files',
          description: 'Найти файл сборки по части имени или пути, не обходя папки по одной.',
          parameters: {
            type: 'object',
            properties: { buildId: { type: 'string' }, query: { type: 'string' }, path: { type: 'string' } },
            required: ['buildId', 'query'],
            additionalProperties: false,
          },
        },
      },
      run: async (args) => searchInstance(asString(args.buildId), asString(args.path), asString(args.query), 'find'),
    },
    write_instance_file: {
      risk: 'write',
      schema: {
        type: 'function',
        function: {
          name: 'write_instance_file',
          description: 'Создать новый текстовый файл сборки. Существующий меняй через edit_instance_file.',
          parameters: {
            type: 'object',
            properties: { buildId: { type: 'string' }, path: { type: 'string' }, text: { type: 'string' } },
            required: ['buildId', 'path', 'text'],
            additionalProperties: false,
          },
        },
      },
      run: async (args) => writeInstanceText(asString(args.buildId), asString(args.path), String(args.text ?? '')),
    },
    mkdir_instance: {
      risk: 'write',
      schema: {
        type: 'function',
        function: {
          name: 'mkdir_instance',
          description: 'Создать папку внутри сборки.',
          parameters: {
            type: 'object',
            properties: { buildId: { type: 'string' }, path: { type: 'string' } },
            required: ['buildId', 'path'],
            additionalProperties: false,
          },
        },
      },
      run: async (args) => {
        const rel = asString(args.path);
        const dir = instanceFilePath(asString(args.buildId), rel);
        if (!dir || !rel) return { ok: false, error: 'Нужен путь внутри сборки' };
        fs.mkdirSync(dir, { recursive: true });
        return { ok: true, path: rel };
      },
    },
    copy_instance_file: {
      risk: 'write',
      schema: {
        type: 'function',
        function: {
          name: 'copy_instance_file',
          description: 'Скопировать файл или папку внутри сборки.',
          parameters: {
            type: 'object',
            properties: { buildId: { type: 'string' }, path: { type: 'string' }, dest: { type: 'string' } },
            required: ['buildId', 'path', 'dest'],
            additionalProperties: false,
          },
        },
      },
      run: async (args) => transferInstanceFile(asString(args.buildId), asString(args.path), asString(args.dest), false),
    },
    move_instance_file: {
      risk: 'write',
      schema: {
        type: 'function',
        function: {
          name: 'move_instance_file',
          description: 'Перенести или переименовать файл или папку внутри сборки.',
          parameters: {
            type: 'object',
            properties: { buildId: { type: 'string' }, path: { type: 'string' }, dest: { type: 'string' } },
            required: ['buildId', 'path', 'dest'],
            additionalProperties: false,
          },
        },
      },
      run: async (args) => transferInstanceFile(asString(args.buildId), asString(args.path), asString(args.dest), true),
    },
    delete_instance_file: {
      risk: 'write',
      schema: {
        type: 'function',
        function: {
          name: 'delete_instance_file',
          description: 'Удалить файл или папку внутри сборки. Корень сборки удалять нельзя.',
          parameters: {
            type: 'object',
            properties: { buildId: { type: 'string' }, path: { type: 'string' } },
            required: ['buildId', 'path'],
            additionalProperties: false,
          },
        },
      },
      run: async (args) => {
        const buildId = asString(args.buildId);
        const rel = asString(args.path);
        const target = instanceFilePath(buildId, rel);
        const root = path.resolve(getInstanceRoot(buildId));
        if (!target || !rel || path.resolve(target) === root) return { ok: false, error: 'Нельзя удалить корень сборки' };
        try {
          fs.rmSync(target, { recursive: true, force: false });
          return { ok: true, path: rel };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    },
    delete_hosted_file: {
      risk: 'write',
      schema: {
        type: 'function',
        function: {
          name: 'delete_hosted_file',
          description: 'Удалить файл или папку внутри своего сервера. Корень сервера удалять нельзя.',
          parameters: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              path: { type: 'string' },
            },
            required: ['id', 'path'],
            additionalProperties: false,
          },
        },
      },
      run: async (args) => agentHostedAction('delete-file', { id: asString(args.id), path: asString(args.path) }),
    },
  };
}

export async function runAiTool(
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ ok: boolean; risk?: AiToolRisk; result?: unknown; error?: string }> {
  // result заполняется и при ok:false для install_mod (детали no_compatible_version)
  const tool = TOOLS[name];
  if (!tool) return { ok: false, error: `unknown_tool:${name}` };
  const hostedId = String(args.buildId || args.id || '');
  if (HOSTED_CONFIG_TOOLS.has(name) && isHostedServerId(hostedId)) {
    const result = await runHostedConfigTool(name, hostedId, args || {});
    const failed = Boolean(result && typeof result === 'object' && (result as { ok?: boolean }).ok === false);
    return failed
      ? { ok: false, risk: tool.risk, error: String((result as { error?: string }).error || 'hosted_failed'), result }
      : { ok: true, risk: tool.risk, result };
  }
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

    const failed = toolResultError(result);
    if (failed) return { ok: false, risk: tool.risk, error: failed, result };
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
