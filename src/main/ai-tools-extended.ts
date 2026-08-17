// Назначение: дополнительные MCP-tools агента UAgent.

import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { app, shell } from 'electron';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { importLocalModpack } from './importModpack';
import { getApiBase, releaseLatestUrl } from '../shared/apiBase';

// ===== Типы =====

type AiToolRisk = 'read' | 'write';

type ToolEntry = {
  risk: AiToolRisk;
  schema: {
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  };
  run: (args: Record<string, unknown>) => Promise<unknown>;
};

type JavaItem = {
  version: number;
  installed: boolean;
  managed: boolean;
  path: string | null;
};

export interface ExtendedDeps {
  asString: (value: unknown, fallback?: string) => string;
  asNumber: (value: unknown, fallback: number) => number;
  asBool: (value: unknown, fallback?: boolean) => boolean;
  getBuilds: () => any[];
  saveBuilds: (builds: any[]) => void;
  findBuild: (buildId: string) => any | null;
  buildSummary: (build: any) => any;
  launcherDataDir: () => string;
  getInstanceRoot: (buildId: string) => string;
  safeJoinInstance: (buildId: string, sub: string, name: string) => string | null;
  ensureInstanceDirs: (buildId: string) => string;
  readJsonArray: (filePath: string) => any[];
  writeJsonArray: (filePath: string, data: any[]) => void;
  listInstalledJava: () => JavaItem[];
  JAVA_MANAGED_VERSIONS: number[];
  installContentDirect: (
    buildId: string,
    projectId: string,
    versionId?: string,
    contentType?: string,
    gameVersion?: string,
    loader?: string,
  ) => Promise<unknown>;
  CONTENT_SUBDIRS: Record<string, string>;
  callRendererAiAction: (
    action: string,
    payload?: Record<string, unknown>,
    timeout?: number,
  ) => Promise<unknown>;
}

// ===== Константы =====

const execFileAsync = promisify(execFile);
const REPO_OWNER = 'studioberry-hub';
const REPO_NAME = 'client';
const UPDATE_ASSET = 'latest-windows-amd64.zip';
const MAX_CONFIG_BYTES = 64 * 1024;
const MAX_SEARCH_TEXT_BYTES = 128 * 1024;
const MAX_WRITE_BYTES = 256 * 1024;
const TEXT_FILE_RE = /\.(txt|cfg|conf|config|properties|json|json5|jsonc|toml|yaml|yml|xml|ini|log|md|snbt)$/i;
const CONTENT_FILE_EXTS: Record<string, string[]> = {
  mods: ['.jar', '.litemod'],
  resourcepacks: ['.zip'],
  shaderpacks: ['.zip'],
  datapacks: ['.zip'],
};
const SERVER_ACTION_TIMEOUT = 180_000;

// ===== Вспомогательные функции =====

function tool(
  name: string,
  risk: AiToolRisk,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
  run: (args: Record<string, unknown>) => Promise<unknown>,
): ToolEntry {
  return {
    risk,
    schema: {
      type: 'function',
      function: {
        name,
        description,
        parameters: {
          type: 'object',
          properties,
          required,
          additionalProperties: false,
        },
      },
    },
    run,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeLang(raw: string): 'ru' | 'en' {
  return String(raw || '').trim().toLowerCase() === 'en' ? 'en' : 'ru';
}

function normalizeContentType(contentType: string, deps: ExtendedDeps): string {
  const raw = String(contentType || 'mod').trim().toLowerCase();
  const map: Record<string, string> = {
    mod: 'mods',
    mods: 'mods',
    resourcepack: 'resourcepacks',
    resourcepacks: 'resourcepacks',
    shader: 'shaderpacks',
    shaders: 'shaderpacks',
    shaderpack: 'shaderpacks',
    shaderpacks: 'shaderpacks',
    datapack: 'datapacks',
    datapacks: 'datapacks',
  };
  return map[raw] || deps.CONTENT_SUBDIRS[raw] || 'mods';
}

function psQuote(value: string): string {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function makeDefaultBackupPath(baseDir: string, buildId: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return path.join(baseDir, 'backups', `${buildId}-${stamp}.zip`);
}

function accountsPath(deps: ExtendedDeps): string {
  return path.join(deps.launcherDataDir(), 'accounts.json');
}

function serversPath(deps: ExtendedDeps): string {
  return path.join(deps.launcherDataDir(), 'servers.json');
}

function normalizeRelativePath(value: string): string {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
}

function ensureBuildOrThrow(deps: ExtendedDeps, buildId: string): any {
  const build = deps.findBuild(buildId);
  if (!build) throw new Error('build_not_found');
  return build;
}

function withBuildUpdate(
  deps: ExtendedDeps,
  buildId: string,
  updater: (build: any) => void,
): any {
  const builds = deps.getBuilds();
  const idx = builds.findIndex((item: any) => item.id === buildId);
  if (idx < 0) throw new Error('build_not_found');
  const build = { ...builds[idx] };
  updater(build);
  builds[idx] = build;
  deps.saveBuilds(builds);
  return build;
}

function getBuildGameVersion(build: any): string {
  return String(build?.gameVersion || build?.version || '').trim();
}

function getBuildLoader(build: any): string {
  return String(build?.loader || 'vanilla').trim().toLowerCase();
}

function requiredJavaForGameVersion(gameVersion: string): { required: number; reason: string } {
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

async function detectJavaVersion(javaPath: string): Promise<number | null> {
  try {
    const { stdout, stderr } = await execFileAsync(javaPath, ['-version'], {
      timeout: 8000,
      windowsHide: true,
      encoding: 'utf8',
    });
    const text = `${stdout || ''}\n${stderr || ''}`;
    const match = text.match(/version\s+"(\d+)(?:\.(\d+))?/i);
    if (!match) return null;
    if (match[1] === '1') return Number(match[2] || 8);
    return Number(match[1] || 0) || null;
  } catch {
    return null;
  }
}

function safeReadBuffer(filePath: string): Buffer {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw new Error('file_not_found');
  return fs.readFileSync(filePath);
}

function readUtf8Limited(filePath: string, maxBytes: number): { text: string; bytes: number; truncated: boolean } {
  const buf = safeReadBuffer(filePath);
  if (buf.includes(0)) throw new Error('binary_file');
  const truncated = buf.byteLength > maxBytes;
  const sliced = truncated ? buf.subarray(0, maxBytes) : buf;
  return { text: sliced.toString('utf-8'), bytes: buf.byteLength, truncated };
}

function listFilesRecursive(
  rootDir: string,
  opts?: { limit?: number; includeDirs?: boolean },
): Array<{ fullPath: string; relPath: string; isDir: boolean; size: number }> {
  const out: Array<{ fullPath: string; relPath: string; isDir: boolean; size: number }> = [];
  const limit = opts?.limit ?? 400;
  if (!fs.existsSync(rootDir)) return out;
  const walk = (dir: string, prefix = ''): void => {
    if (out.length >= limit) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= limit) break;
      const fullPath = path.join(dir, entry.name);
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      let size = 0;
      try {
        size = entry.isDirectory() ? 0 : fs.statSync(fullPath).size;
      } catch {
        size = 0;
      }
      if (entry.isDirectory()) {
        if (opts?.includeDirs) out.push({ fullPath, relPath, isDir: true, size });
        walk(fullPath, relPath);
      } else {
        out.push({ fullPath, relPath, isDir: false, size });
      }
    }
  };
  walk(rootDir);
  return out;
}

function countDirFiles(rootDir: string, exts?: string[]): Array<{ name: string; enabled: boolean; size: number; path: string }> {
  if (!fs.existsSync(rootDir)) return [];
  let names: string[] = [];
  try {
    names = fs.readdirSync(rootDir);
  } catch {
    return [];
  }
  return names
    .filter((name) => {
      const lower = name.toLowerCase();
      if (!exts?.length) return true;
      return exts.some((ext) => lower.endsWith(ext) || lower.endsWith(`${ext}.disabled`));
    })
    .map((name) => {
      const fullPath = path.join(rootDir, name);
      let size = 0;
      try {
        size = fs.statSync(fullPath).size;
      } catch {
        size = 0;
      }
      return {
        name,
        enabled: !name.toLowerCase().endsWith('.disabled'),
        size,
        path: fullPath,
      };
    });
}

function directorySize(rootDir: string): { bytes: number; files: number } {
  let bytes = 0;
  let files = 0;
  if (!fs.existsSync(rootDir)) return { bytes, files };
  const walk = (dir: string): void => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      try {
        if (entry.isDirectory()) {
          walk(fullPath);
        } else {
          const stat = fs.statSync(fullPath);
          bytes += stat.size;
          files += 1;
        }
      } catch {
        /* ignore */
      }
    }
  };
  walk(rootDir);
  return { bytes, files };
}

function parseOptionsText(content: string): Array<{ raw: string; key: string; value: string }> {
  return String(content || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((raw) => {
      const idx = raw.indexOf(':');
      if (idx < 0) return { raw, key: '', value: '' };
      return {
        raw,
        key: raw.slice(0, idx),
        value: raw.slice(idx + 1),
      };
    });
}

function serializeOptions(entries: Array<{ raw: string; key: string; value: string }>): string {
  return entries
    .map((entry) => (entry.key ? `${entry.key}:${entry.value}` : entry.raw))
    .join('\n');
}

function buildConfigPath(deps: ExtendedDeps, buildId: string, relativePath: string): string {
  const rel = normalizeRelativePath(relativePath);
  if (!rel || rel.startsWith('..') || rel.includes('../')) throw new Error('invalid_relative_path');
  const resolved = deps.safeJoinInstance(buildId, 'config', rel);
  if (!resolved) throw new Error('invalid_relative_path');
  return resolved;
}

function normalizeServerInput(ip: string, port: number): { ip: string; port: number } {
  const cleanIp = String(ip || '').trim().replace(/^mc:\/\//i, '');
  const cleanPort = Number.isFinite(port) ? Math.trunc(port) : 25565;
  return {
    ip: cleanIp,
    port: clamp(cleanPort || 25565, 1, 65535),
  };
}

function normalizeConflictKey(name: string): string {
  return String(name || '')
    .toLowerCase()
    .replace(/\.disabled$/i, '')
    .replace(/\.(jar|litemod|zip)$/i, '')
    .replace(/[-_ ]?(fabric|forge|quilt|neoforge|mc\d[\d.]*)$/i, '')
    .replace(/[-_ ]?\d+(?:\.\d+){1,4}([+-][a-z0-9.-]+)?$/i, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function normalizeText(value: string): string {
  return String(value || '').toLowerCase();
}

function pickLinesAround(text: string, query: string): string | null {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const q = normalizeText(query);
  const idx = lines.findIndex((line) => normalizeText(line).includes(q));
  if (idx < 0) return null;
  return lines.slice(Math.max(0, idx - 1), Math.min(lines.length, idx + 2)).join('\n');
}

function relativeInstancePath(root: string, target: string): string {
  return path.relative(root, target).replace(/\\/g, '/');
}

async function sha1File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

async function resolveLatestCompatibleVersion(
  projectId: string,
  gameVersion: string,
  loader: string,
): Promise<any | null> {
  const params = new URLSearchParams();
  if (gameVersion) params.set('game_versions', JSON.stringify([gameVersion]));
  if (loader && loader !== 'vanilla') params.set('loaders', JSON.stringify([loader]));
  const url =
    `https://api.modrinth.com/v2/project/${encodeURIComponent(projectId)}/version` +
    (params.toString() ? `?${params.toString()}` : '');
  const versions = await fetchJson(url, {
    headers: { 'User-Agent': 'Undefined-Client-AI', Accept: 'application/json' },
  });
  return Array.isArray(versions) && versions.length ? versions[0] : null;
}

async function lookupModrinthBySha1(sha1: string): Promise<any | null> {
  try {
    return await fetchJson(
      `https://api.modrinth.com/v2/version_file/${encodeURIComponent(sha1)}?algorithm=sha1`,
      {
        headers: { 'User-Agent': 'Undefined-Client-AI', Accept: 'application/json' },
      },
    );
  } catch {
    return null;
  }
}

async function callBridge(
  deps: ExtendedDeps,
  action: string,
  payload?: Record<string, unknown>,
  timeout = SERVER_ACTION_TIMEOUT,
): Promise<unknown> {
  return deps.callRendererAiAction(action, payload || {}, timeout);
}

function summarizeContent(root: string): Record<string, { count: number; enabled: number; disabled: number }> {
  const sections = ['mods', 'resourcepacks', 'shaderpacks', 'datapacks'];
  const out: Record<string, { count: number; enabled: number; disabled: number }> = {};
  for (const section of sections) {
    const list = countDirFiles(path.join(root, section), CONTENT_FILE_EXTS[section]);
    out[section] = {
      count: list.length,
      enabled: list.filter((item) => item.enabled).length,
      disabled: list.filter((item) => !item.enabled).length,
    };
  }
  return out;
}

function commandTemplates(): Array<{ topic: string; title: string; prompt: string }> {
  return [
    { topic: 'diagnose', title: 'Диагностика сборки', prompt: 'Проверь сборку на проблемы с Java, логами и конфликтами модов.' },
    { topic: 'mods', title: 'Подбор модов', prompt: 'Подбери совместимые моды для моей версии Minecraft и loader.' },
    { topic: 'performance', title: 'Оптимизация', prompt: 'Предложи, как ускорить запуск и повысить FPS в этой сборке.' },
    { topic: 'config', title: 'Настройка конфигов', prompt: 'Измени нужные параметры в config и options.txt для этой сборки.' },
    { topic: 'server', title: 'Подключение к серверу', prompt: 'Подготовь сборку для сервера и проверь совместимость модов.' },
    { topic: 'share', title: 'Шаринг сборки', prompt: 'Подготовь и создай share-ссылку на мою сборку без миров.' },
    { topic: 'java', title: 'Подбор Java', prompt: 'Проверь, какая Java нужна для этой версии Minecraft, и выбери подходящую.' },
  ];
}

// ===== Экспорт набора tools =====

export function getExtendedAiTools(deps: ExtendedDeps): Record<string, ToolEntry> {
  const asString = deps.asString;
  const asNumber = deps.asNumber;
  const asBool = deps.asBool;

  async function recommendJava(build: any): Promise<{
    required: number;
    reason: string;
    installed: JavaItem[];
    recommendedPath: string | null;
  }> {
    const info = requiredJavaForGameVersion(getBuildGameVersion(build));
    const installed = deps.listInstalledJava().filter((item) => item.installed);
    const exact = installed.find((item) => item.version === info.required && item.path);
    const fallback = installed
      .filter((item) => item.version >= info.required && item.path)
      .sort((a, b) => a.version - b.version)[0];
    return {
      required: info.required,
      reason: info.reason,
      installed,
      recommendedPath: (exact?.path || fallback?.path || null),
    };
  }

  return {
    // ===== READ =====

    diagnose_build: tool(
      'diagnose_build',
      'read',
      'Диагностика сборки: структура, Java, логи, контент.',
      { buildId: { type: 'string' } },
      ['buildId'],
      async (args) => {
        const buildId = asString(args.buildId);
        const build = ensureBuildOrThrow(deps, buildId);
        const root = deps.getInstanceRoot(buildId);
        const exists = fs.existsSync(root);
        const content = summarizeContent(root);
        const recommendation = await recommendJava(build);
        const issues: string[] = [];
        const warnings: string[] = [];
        if (!exists) issues.push('instance_missing');
        if (!build.name) issues.push('build_name_missing');
        if (!build.gameVersion) issues.push('game_version_missing');
        if (!build.loader) warnings.push('loader_missing');
        if (!build.javaPath) warnings.push('java_not_pinned');
        if (build.javaPath && !fs.existsSync(build.javaPath)) issues.push('java_path_missing');
        if (!content.mods.count) warnings.push('mods_folder_empty');
        const latestLog = path.join(root, 'logs', 'latest.log');
        const crashDir = path.join(root, 'crash-reports');
        const hasLatestLog = fs.existsSync(latestLog);
        const crashReports = fs.existsSync(crashDir)
          ? fs.readdirSync(crashDir).filter((name) => name.toLowerCase().endsWith('.txt')).length
          : 0;
        if (!hasLatestLog) warnings.push('latest_log_missing');
        if (crashReports > 0) warnings.push('crash_reports_present');
        return {
          build: deps.buildSummary(build),
          instancePath: root,
          instanceExists: exists,
          content,
          logs: {
            latestLog: hasLatestLog,
            crashReports,
          },
          java: {
            configuredPath: build.javaPath || null,
            recommendation,
          },
          issues,
          warnings,
          ok: issues.length === 0,
        };
      },
    ),

    read_config: tool(
      'read_config',
      'read',
      'Прочитать файл из config/ сборки, не больше 64 КБ.',
      {
        buildId: { type: 'string' },
        relativePath: { type: 'string' },
      },
      ['buildId', 'relativePath'],
      async (args) => {
        const buildId = asString(args.buildId);
        ensureBuildOrThrow(deps, buildId);
        const filePath = buildConfigPath(deps, buildId, asString(args.relativePath));
        const data = readUtf8Limited(filePath, MAX_CONFIG_BYTES);
        return {
          buildId,
          relativePath: relativeInstancePath(path.join(deps.getInstanceRoot(buildId), 'config'), filePath),
          bytes: data.bytes,
          truncated: data.truncated,
          content: data.text,
        };
      },
    ),

    read_options: tool(
      'read_options',
      'read',
      'Прочитать options.txt сборки.',
      { buildId: { type: 'string' } },
      ['buildId'],
      async (args) => {
        const buildId = asString(args.buildId);
        ensureBuildOrThrow(deps, buildId);
        const filePath = path.join(deps.getInstanceRoot(buildId), 'options.txt');
        const data = readUtf8Limited(filePath, MAX_CONFIG_BYTES);
        return {
          buildId,
          bytes: data.bytes,
          truncated: data.truncated,
          content: data.text,
          entries: parseOptionsText(data.text).filter((item) => item.key).length,
        };
      },
    ),

    get_options_value: tool(
      'get_options_value',
      'read',
      'Прочитать одно значение из options.txt.',
      {
        buildId: { type: 'string' },
        key: { type: 'string' },
      },
      ['buildId', 'key'],
      async (args) => {
        const buildId = asString(args.buildId);
        const key = asString(args.key);
        ensureBuildOrThrow(deps, buildId);
        const filePath = path.join(deps.getInstanceRoot(buildId), 'options.txt');
        const data = readUtf8Limited(filePath, MAX_CONFIG_BYTES);
        const value = parseOptionsText(data.text).find((item) => item.key === key)?.value ?? null;
        return { buildId, key, value };
      },
    ),

    compare_builds: tool(
      'compare_builds',
      'read',
      'Сравнить две сборки по версиям, Java и контенту.',
      {
        buildIdA: { type: 'string' },
        buildIdB: { type: 'string' },
      },
      ['buildIdA', 'buildIdB'],
      async (args) => {
        const buildIdA = asString(args.buildIdA);
        const buildIdB = asString(args.buildIdB);
        const buildA = ensureBuildOrThrow(deps, buildIdA);
        const buildB = ensureBuildOrThrow(deps, buildIdB);
        const rootA = deps.getInstanceRoot(buildIdA);
        const rootB = deps.getInstanceRoot(buildIdB);
        const modsA = countDirFiles(path.join(rootA, 'mods'), CONTENT_FILE_EXTS.mods).map((item) => item.name);
        const modsB = countDirFiles(path.join(rootB, 'mods'), CONTENT_FILE_EXTS.mods).map((item) => item.name);
        const setA = new Set(modsA);
        const setB = new Set(modsB);
        return {
          buildA: deps.buildSummary(buildA),
          buildB: deps.buildSummary(buildB),
          sameGameVersion: getBuildGameVersion(buildA) === getBuildGameVersion(buildB),
          sameLoader: getBuildLoader(buildA) === getBuildLoader(buildB),
          sameJavaPath: String(buildA.javaPath || '') === String(buildB.javaPath || ''),
          contentA: summarizeContent(rootA),
          contentB: summarizeContent(rootB),
          onlyInA: modsA.filter((name) => !setB.has(name)).slice(0, 80),
          onlyInB: modsB.filter((name) => !setA.has(name)).slice(0, 80),
          commonMods: modsA.filter((name) => setB.has(name)).slice(0, 80),
        };
      },
    ),

    find_mod_conflicts: tool(
      'find_mod_conflicts',
      'read',
      'Найти вероятные дубли и конфликтующие jar в mods.',
      { buildId: { type: 'string' } },
      ['buildId'],
      async (args) => {
        const buildId = asString(args.buildId);
        ensureBuildOrThrow(deps, buildId);
        const modsDir = path.join(deps.getInstanceRoot(buildId), 'mods');
        const mods = countDirFiles(modsDir, CONTENT_FILE_EXTS.mods);
        const groups = new Map<string, typeof mods>();
        for (const mod of mods) {
          const key = normalizeConflictKey(mod.name);
          if (!key) continue;
          const list = groups.get(key) || [];
          list.push(mod);
          groups.set(key, list);
        }
        const conflicts = [...groups.entries()]
          .filter(([, list]) => list.length > 1)
          .map(([key, list]) => ({
            key,
            files: list.map((item) => ({
              name: item.name,
              enabled: item.enabled,
              size: item.size,
            })),
          }))
          .slice(0, 60);
        return {
          buildId,
          conflicts,
          count: conflicts.length,
          note: 'Это эвристика по именам файлов. Для точной диагностики нужен анализ логов запуска.',
        };
      },
    ),

    server_status: tool(
      'server_status',
      'read',
      'Проверить статус Minecraft-сервера по адресу.',
      { address: { type: 'string' } },
      ['address'],
      async (args) => {
        const address = asString(args.address).replace(/\s+/g, '');
        if (!address) return { online: false, error: 'address_required' };
        const msu = require('minecraft-server-util') as {
          parseAddress: (addr: string, port: number) => { host: string; port: number } | null;
          status: (
            host: string,
            port: number,
            opts: { timeout: number; enableSRV: boolean },
          ) => Promise<any>;
        };
        const parsed = msu.parseAddress(address, 25565) || { host: address, port: 25565 };
        const tryPing = async (enableSRV: boolean) =>
          msu.status(parsed.host, parsed.port, { timeout: 5000, enableSRV });
        try {
          let res: any;
          try {
            res = await tryPing(false);
          } catch {
            res = await tryPing(true);
          }
          return {
            address,
            host: parsed.host,
            port: parsed.port,
            online: true,
            players: {
              online: res.players?.online ?? 0,
              max: res.players?.max ?? 0,
            },
            version: res.version?.name?.split('\n')[0] || '',
            motd: res.motd?.clean ? [res.motd.clean].filter(Boolean) : [],
            icon: res.favicon || null,
            latency: res.roundTripLatency ?? null,
          };
        } catch (error: any) {
          return {
            address,
            host: parsed.host,
            port: parsed.port,
            online: false,
            error: error?.message || 'unreachable',
          };
        }
      },
    ),

    check_updates: tool(
      'check_updates',
      'read',
      'Проверить обновления лаунчера на сайте (зеркало) или GitHub.',
      {},
      [],
      async () => {
        const current = app.getVersion();
        try {
          const info = await fetchJson(releaseLatestUrl(), {
            headers: {
              'User-Agent': 'Undefined-Client',
              Accept: 'application/json',
            },
          });
          const latest = String(info.tag || info.version || '');
          if (latest) {
            return {
              current,
              latest,
              assetName: info.zipFilename || UPDATE_ASSET,
              publishedAt: info.publishedAt || null,
              htmlUrl: info.htmlUrl || null,
              source: 'site',
              apiBase: getApiBase(),
              zipDirectAvailable: !!info.zipDirectAvailable,
            };
          }
        } catch {
          /* fallback на GitHub */
        }

        try {
          const release = await fetchJson(
            `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`,
            {
              headers: {
                'User-Agent': 'Undefined-Client',
                Accept: 'application/vnd.github+json',
              },
            },
          );
          const assets = Array.isArray(release.assets) ? release.assets : [];
          const asset =
            assets.find((item: any) => item?.name === UPDATE_ASSET) ||
            assets.find((item: any) => String(item?.name || '').toLowerCase().endsWith('.zip')) ||
            null;
          return {
            current,
            latest: String(release.tag_name || ''),
            assetName: asset?.name || null,
            publishedAt: release.published_at || null,
            htmlUrl: release.html_url || null,
            source: 'github',
            repo: `${REPO_OWNER}/${REPO_NAME}`,
          };
        } catch (error: any) {
          return { error: error?.message || 'update_check_failed', repo: `${REPO_OWNER}/${REPO_NAME}` };
        }
      },
    ),

    list_news: tool(
      'list_news',
      'read',
      'Список новостей сайта лаунчера.',
      {
        lang: { type: 'string' },
        limit: { type: 'number' },
      },
      [],
      async (args) => {
        const lang = normalizeLang(asString(args.lang, 'ru'));
        const limit = clamp(asNumber(args.limit, 12), 1, 100);
        const data = await fetchJson(`${getApiBase()}/api/news?lang=${lang}&limit=${limit}`, {
          headers: { 'User-Agent': 'Undefined-Client', Accept: 'application/json' },
        });
        return {
          lang,
          posts: Array.isArray(data?.posts) ? data.posts : [],
        };
      },
    ),

    get_news: tool(
      'get_news',
      'read',
      'Прочитать одну новость по id.',
      {
        id: { type: 'string' },
        lang: { type: 'string' },
      },
      ['id'],
      async (args) => {
        const id = asString(args.id);
        const lang = normalizeLang(asString(args.lang, 'ru'));
        if (!id) return { error: 'id_required' };
        const data = await fetchJson(
          `${getApiBase()}/api/news/${encodeURIComponent(id)}?lang=${lang}`,
          { headers: { 'User-Agent': 'Undefined-Client', Accept: 'application/json' } },
        );
        return {
          lang,
          post: data?.post || null,
        };
      },
    ),

    get_system_info: tool(
      'get_system_info',
      'read',
      'Сводка по ОС, памяти, версиям и путям лаунчера.',
      {},
      [],
      async () => ({
        platform: process.platform,
        release: os.release(),
        arch: process.arch,
        cpus: os.cpus()?.length || 0,
        cpuModel: os.cpus()?.[0]?.model || null,
        totalMemGb: Number((os.totalmem() / 1024 / 1024 / 1024).toFixed(2)),
        freeMemGb: Number((os.freemem() / 1024 / 1024 / 1024).toFixed(2)),
        appVersion: app.getVersion(),
        electron: process.versions.electron,
        node: process.versions.node,
        chrome: process.versions.chrome,
        launcherDataDir: deps.launcherDataDir(),
        builds: deps.getBuilds().length,
        installedJava: deps.listInstalledJava().filter((item) => item.installed),
      }),
    ),

    search_local_files: tool(
      'search_local_files',
      'read',
      'Поиск по файлам сборки: имена и текст.',
      {
        buildId: { type: 'string' },
        query: { type: 'string' },
        sub: { type: 'string' },
      },
      ['buildId', 'query'],
      async (args) => {
        const buildId = asString(args.buildId);
        const query = asString(args.query);
        const sub = asString(args.sub, '.').trim() || '.';
        ensureBuildOrThrow(deps, buildId);
        if (!query) return { buildId, query, matches: [] };
        const root = deps.getInstanceRoot(buildId);
        const base =
          sub === '.'
            ? root
            : deps.safeJoinInstance(buildId, sub, '') || path.join(root, sub);
        if (!fs.existsSync(base)) return { buildId, query, sub, matches: [] };
        const files = listFilesRecursive(base, { limit: 300 });
        const matches: Array<Record<string, unknown>> = [];
        const q = normalizeText(query);
        for (const item of files) {
          if (matches.length >= 60) break;
          const relPath = relativeInstancePath(root, item.fullPath);
          const filenameHit = normalizeText(item.relPath).includes(q);
          let excerpt: string | null = null;
          if (!item.isDir && TEXT_FILE_RE.test(item.fullPath) && item.size <= MAX_SEARCH_TEXT_BYTES) {
            try {
              const content = fs.readFileSync(item.fullPath, 'utf-8');
              excerpt = pickLinesAround(content, query);
            } catch {
              excerpt = null;
            }
          }
          if (filenameHit || excerpt) {
            matches.push({
              path: relPath,
              filenameHit,
              excerpt,
              size: item.size,
            });
          }
        }
        return { buildId, query, sub, matches, count: matches.length };
      },
    ),

    get_console_tail: tool(
      'get_console_tail',
      'read',
      'Получить хвост консоли лаунчера через renderer.',
      {
        limit: { type: 'number' },
      },
      [],
      async (args) => {
        const limit = clamp(asNumber(args.limit, 80), 10, 500);
        return await callBridge(deps, 'get_console_tail', { limit }, 30_000);
      },
    ),

    get_modrinth_changelog: tool(
      'get_modrinth_changelog',
      'read',
      'Получить changelog версии проекта Modrinth.',
      {
        projectId: { type: 'string' },
        versionId: { type: 'string' },
      },
      ['projectId'],
      async (args) => {
        const projectId = asString(args.projectId);
        const versionId = asString(args.versionId);
        if (!projectId) return { error: 'projectId_required' };
        let version: any;
        if (versionId) {
          version = await fetchJson(`https://api.modrinth.com/v2/version/${encodeURIComponent(versionId)}`, {
            headers: { 'User-Agent': 'Undefined-Client-AI', Accept: 'application/json' },
          });
        } else {
          const list = await fetchJson(
            `https://api.modrinth.com/v2/project/${encodeURIComponent(projectId)}/version`,
            { headers: { 'User-Agent': 'Undefined-Client-AI', Accept: 'application/json' } },
          );
          version = Array.isArray(list) ? list[0] : null;
        }
        if (!version) return { error: 'version_not_found' };
        return {
          projectId,
          versionId: version.id || null,
          versionNumber: version.version_number || null,
          name: version.name || null,
          published: version.date_published || null,
          changelog: version.changelog || '',
        };
      },
    ),

    get_build_disk_usage: tool(
      'get_build_disk_usage',
      'read',
      'Посчитать размер инстанса и его разделов.',
      { buildId: { type: 'string' } },
      ['buildId'],
      async (args) => {
        const buildId = asString(args.buildId);
        ensureBuildOrThrow(deps, buildId);
        const root = deps.getInstanceRoot(buildId);
        const sections = ['mods', 'resourcepacks', 'shaderpacks', 'datapacks', 'config', 'saves', 'logs'];
        const perDir: Record<string, unknown> = {};
        for (const section of sections) {
          perDir[section] = directorySize(path.join(root, section));
        }
        return {
          buildId,
          root,
          total: directorySize(root),
          sections: perDir,
        };
      },
    ),

    validate_java_for_build: tool(
      'validate_java_for_build',
      'read',
      'Проверить Java сборки на существование и совместимость.',
      { buildId: { type: 'string' } },
      ['buildId'],
      async (args) => {
        const buildId = asString(args.buildId);
        const build = ensureBuildOrThrow(deps, buildId);
        const recommendation = await recommendJava(build);
        const configuredPath = asString(build.javaPath);
        if (!configuredPath) {
          return {
            buildId,
            valid: false,
            error: 'java_not_configured',
            recommendation,
          };
        }
        if (!fs.existsSync(configuredPath)) {
          return {
            buildId,
            valid: false,
            error: 'java_path_missing',
            configuredPath,
            recommendation,
          };
        }
        const detectedVersion = await detectJavaVersion(configuredPath);
        const valid = !!detectedVersion && detectedVersion >= recommendation.required;
        return {
          buildId,
          valid,
          configuredPath,
          detectedVersion,
          requiredVersion: recommendation.required,
          recommendation,
        };
      },
    ),

    list_command_templates: tool(
      'list_command_templates',
      'read',
      'Шаблоны запросов для частых задач агента.',
      { topic: { type: 'string' } },
      [],
      async (args) => {
        const topic = asString(args.topic).toLowerCase();
        const items = commandTemplates().filter((item) => !topic || item.topic === topic);
        return { topic: topic || null, items };
      },
    ),

    count_build_content: tool(
      'count_build_content',
      'read',
      'Посчитать контент сборки по разделам.',
      { buildId: { type: 'string' } },
      ['buildId'],
      async (args) => {
        const buildId = asString(args.buildId);
        ensureBuildOrThrow(deps, buildId);
        const root = deps.getInstanceRoot(buildId);
        return {
          buildId,
          counts: summarizeContent(root),
        };
      },
    ),

    recommend_java_for_build: tool(
      'recommend_java_for_build',
      'read',
      'Рекомендовать Java для версии Minecraft этой сборки.',
      { buildId: { type: 'string' } },
      ['buildId'],
      async (args) => {
        const buildId = asString(args.buildId);
        const build = ensureBuildOrThrow(deps, buildId);
        const recommendation = await recommendJava(build);
        return {
          buildId,
          gameVersion: getBuildGameVersion(build),
          loader: getBuildLoader(build),
          requiredVersion: recommendation.required,
          reason: recommendation.reason,
          configuredPath: build.javaPath || null,
          recommendedPath: recommendation.recommendedPath,
          installed: recommendation.installed,
        };
      },
    ),

    list_server_catalog: tool(
      'list_server_catalog',
      'read',
      'Получить каталог серверов через renderer.',
      {},
      [],
      async () => await callBridge(deps, 'list_server_catalog', {}, 60_000),
    ),

    // ===== WRITE =====

    launch_build: tool(
      'launch_build',
      'write',
      'Запустить сборку, при необходимости с адресом сервера.',
      {
        buildId: { type: 'string' },
        serverIp: { type: 'string' },
        serverPort: { type: 'number' },
      },
      ['buildId'],
      async (args) => {
        const buildId = asString(args.buildId);
        const build = ensureBuildOrThrow(deps, buildId);
        const serverIp = asString(args.serverIp);
        const serverPort = clamp(asNumber(args.serverPort, 25565), 1, 65535);
        return await callBridge(
          deps,
          'launch_build',
          {
            buildId,
            serverIp: serverIp || undefined,
            serverPort: serverIp ? serverPort : undefined,
            build: deps.buildSummary(build),
          },
          30_000,
        );
      },
    ),

    install_java: tool(
      'install_java',
      'write',
      'Установить управляемую Java через renderer.',
      { version: { type: 'number' } },
      ['version'],
      async (args) => {
        const version = asNumber(args.version, 0);
        if (!deps.JAVA_MANAGED_VERSIONS.includes(version)) return { error: 'unsupported_java_version' };
        return await callBridge(deps, 'install_java', { version }, 15 * 60_000);
      },
    ),

    remove_java: tool(
      'remove_java',
      'write',
      'Удалить управляемую Java через renderer.',
      { version: { type: 'number' } },
      ['version'],
      async (args) => {
        const version = asNumber(args.version, 0);
        if (!deps.JAVA_MANAGED_VERSIONS.includes(version)) return { error: 'unsupported_java_version' };
        return await callBridge(deps, 'remove_java', { version }, 60_000);
      },
    ),

    set_build_memory: tool(
      'set_build_memory',
      'write',
      'Изменить RAM сборки.',
      {
        buildId: { type: 'string' },
        memoryMax: { type: 'number' },
        memoryMin: { type: 'number' },
      },
      ['buildId', 'memoryMax'],
      async (args) => {
        const buildId = asString(args.buildId);
        const memoryMax = clamp(asNumber(args.memoryMax, 0), 256, 65536);
        const memoryMinRaw = args.memoryMin == null ? 0 : asNumber(args.memoryMin, 0);
        const memoryMin = memoryMinRaw > 0 ? clamp(memoryMinRaw, 128, memoryMax) : Math.max(128, Math.min(memoryMax >> 1, 4096));
        const updated = withBuildUpdate(deps, buildId, (build) => {
          build.memory = { min: memoryMin, max: memoryMax };
        });
        return { ok: true, build: deps.buildSummary(updated) };
      },
    ),

    set_jvm_args: tool(
      'set_jvm_args',
      'write',
      'Изменить строку JVM-аргументов сборки.',
      {
        buildId: { type: 'string' },
        jvmArgs: { type: 'string' },
      },
      ['buildId', 'jvmArgs'],
      async (args) => {
        const buildId = asString(args.buildId);
        const jvmArgs = asString(args.jvmArgs);
        const updated = withBuildUpdate(deps, buildId, (build) => {
          build.jvmArgs = jvmArgs;
        });
        return { ok: true, build: deps.buildSummary(updated) };
      },
    ),

    set_build_window: tool(
      'set_build_window',
      'write',
      'Изменить размер окна или fullscreen у сборки.',
      {
        buildId: { type: 'string' },
        width: { type: 'number' },
        height: { type: 'number' },
        fullscreen: { type: 'boolean' },
      },
      ['buildId'],
      async (args) => {
        const buildId = asString(args.buildId);
        const updated = withBuildUpdate(deps, buildId, (build) => {
          const prev = build.window || { width: 854, height: 480, fullscreen: false };
          build.window = {
            width: args.width == null ? prev.width : clamp(asNumber(args.width, prev.width), 320, 7680),
            height: args.height == null ? prev.height : clamp(asNumber(args.height, prev.height), 240, 4320),
            fullscreen: args.fullscreen == null ? !!prev.fullscreen : asBool(args.fullscreen, !!prev.fullscreen),
          };
        });
        return { ok: true, build: deps.buildSummary(updated) };
      },
    ),

    write_config: tool(
      'write_config',
      'write',
      'Записать текст в файл внутри config/.',
      {
        buildId: { type: 'string' },
        relativePath: { type: 'string' },
        content: { type: 'string' },
      },
      ['buildId', 'relativePath', 'content'],
      async (args) => {
        const buildId = asString(args.buildId);
        ensureBuildOrThrow(deps, buildId);
        deps.ensureInstanceDirs(buildId);
        const content = String(args.content ?? '');
        if (Buffer.byteLength(content, 'utf-8') > MAX_WRITE_BYTES) return { error: 'content_too_large' };
        const filePath = buildConfigPath(deps, buildId, asString(args.relativePath));
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content, 'utf-8');
        return {
          ok: true,
          path: relativeInstancePath(deps.getInstanceRoot(buildId), filePath),
          bytes: Buffer.byteLength(content, 'utf-8'),
        };
      },
    ),

    write_options: tool(
      'write_options',
      'write',
      'Полностью перезаписать options.txt.',
      {
        buildId: { type: 'string' },
        content: { type: 'string' },
      },
      ['buildId', 'content'],
      async (args) => {
        const buildId = asString(args.buildId);
        ensureBuildOrThrow(deps, buildId);
        deps.ensureInstanceDirs(buildId);
        const content = String(args.content ?? '');
        if (Buffer.byteLength(content, 'utf-8') > MAX_WRITE_BYTES) return { error: 'content_too_large' };
        const filePath = path.join(deps.getInstanceRoot(buildId), 'options.txt');
        fs.writeFileSync(filePath, content, 'utf-8');
        return { ok: true, path: 'options.txt', bytes: Buffer.byteLength(content, 'utf-8') };
      },
    ),

    set_options_value: tool(
      'set_options_value',
      'write',
      'Изменить одно значение в options.txt.',
      {
        buildId: { type: 'string' },
        key: { type: 'string' },
        value: { type: 'string' },
      },
      ['buildId', 'key', 'value'],
      async (args) => {
        const buildId = asString(args.buildId);
        const key = asString(args.key);
        const value = String(args.value ?? '');
        ensureBuildOrThrow(deps, buildId);
        deps.ensureInstanceDirs(buildId);
        const filePath = path.join(deps.getInstanceRoot(buildId), 'options.txt');
        const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
        const entries = parseOptionsText(current);
        const idx = entries.findIndex((item) => item.key === key);
        if (idx >= 0) {
          entries[idx] = { raw: `${key}:${value}`, key, value };
        } else {
          entries.push({ raw: `${key}:${value}`, key, value });
        }
        fs.writeFileSync(filePath, serializeOptions(entries), 'utf-8');
        return { ok: true, key, value };
      },
    ),

    import_modpack: tool(
      'import_modpack',
      'write',
      'Импортировать локальный modpack-архив.',
      { archivePath: { type: 'string' } },
      ['archivePath'],
      async (args) => {
        const archivePath = asString(args.archivePath);
        if (!archivePath) return { success: false, error: 'archivePath_required' };
        return await importLocalModpack({
          archivePath,
          appDataDir: deps.launcherDataDir(),
          getInstanceRoot: deps.getInstanceRoot,
          sendProgress: () => undefined,
          resolveJavaPath: async (gameVersion: string) => {
            const info = requiredJavaForGameVersion(gameVersion);
            const runtime = deps
              .listInstalledJava()
              .filter((item) => item.installed && item.path)
              .sort((a, b) => a.version - b.version)
              .find((item) => item.version >= info.required);
            return runtime?.path || undefined;
          },
        });
      },
    ),

    backup_build: tool(
      'backup_build',
      'write',
      'Сделать zip-бэкап контента сборки через PowerShell.',
      {
        buildId: { type: 'string' },
        destinationPath: { type: 'string' },
      },
      ['buildId'],
      async (args) => {
        const buildId = asString(args.buildId);
        ensureBuildOrThrow(deps, buildId);
        const root = deps.ensureInstanceDirs(buildId);
        const destinationPath = asString(args.destinationPath) || makeDefaultBackupPath(deps.launcherDataDir(), buildId);
        fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
        const items = [
          path.join(root, 'mods'),
          path.join(root, 'config'),
          path.join(root, 'resourcepacks'),
          path.join(root, 'shaderpacks'),
          path.join(root, 'datapacks'),
          path.join(root, 'options.txt'),
        ].filter((item) => fs.existsSync(item));
        if (!items.length) return { ok: false, error: 'nothing_to_backup' };
        const command = [
          '$ErrorActionPreference = "Stop"',
          `$dest = ${psQuote(destinationPath)}`,
          'if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Force }',
          `$items = @(${items.map(psQuote).join(', ')})`,
          '$existing = @()',
          'foreach ($item in $items) { if (Test-Path -LiteralPath $item) { $existing += $item } }',
          'if ($existing.Count -eq 0) { throw "nothing_to_backup" }',
          'Compress-Archive -LiteralPath $existing -DestinationPath $dest -Force',
        ].join('; ');
        try {
          await execFileAsync(
            'powershell.exe',
            ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
            { windowsHide: true, timeout: 10 * 60_000 },
          );
          return { ok: true, destinationPath, items: items.map((item) => relativeInstancePath(root, item)) };
        } catch (error: any) {
          return {
            ok: false,
            error: error?.message || 'backup_failed',
            destinationPath,
          };
        }
      },
    ),

    create_instance_share: tool(
      'create_instance_share',
      'write',
      'Создать share-ссылку сборки через renderer.',
      {
        buildId: { type: 'string' },
        authorName: { type: 'string' },
      },
      ['buildId'],
      async (args) => {
        const buildId = asString(args.buildId);
        ensureBuildOrThrow(deps, buildId);
        return await callBridge(
          deps,
          'create_instance_share',
          {
            buildId,
            authorName: asString(args.authorName) || undefined,
          },
          15 * 60_000,
        );
      },
    ),

    import_instance_share: tool(
      'import_instance_share',
      'write',
      'Импортировать shared-сборку по id через renderer.',
      { shareId: { type: 'string' } },
      ['shareId'],
      async (args) => {
        const shareId = asString(args.shareId);
        if (!shareId) return { error: 'shareId_required' };
        return await callBridge(deps, 'import_instance_share', { shareId }, 15 * 60_000);
      },
    ),

    install_mod_bulk: tool(
      'install_mod_bulk',
      'write',
      'Установить до 15 проектов Modrinth в одну сборку.',
      {
        buildId: { type: 'string' },
        projectIds: {
          anyOf: [
            { type: 'array', items: { type: 'string' } },
            { type: 'string' },
          ],
        },
        contentType: { type: 'string' },
      },
      ['buildId', 'projectIds'],
      async (args) => {
        const buildId = asString(args.buildId);
        const build = ensureBuildOrThrow(deps, buildId);
        const contentType = asString(args.contentType, 'mod') || 'mod';
        const rawIds = Array.isArray(args.projectIds)
          ? args.projectIds.map((item) => String(item || '').trim())
          : String(args.projectIds || '')
              .split(',')
              .map((item) => item.trim());
        const projectIds = [...new Set(rawIds.filter(Boolean))].slice(0, 15);
        if (!projectIds.length) return { error: 'projectIds_required' };
        const installed: unknown[] = [];
        const failed: Array<{ projectId: string; error: string }> = [];
        for (const projectId of projectIds) {
          try {
            const result = await deps.installContentDirect(
              buildId,
              projectId,
              undefined,
              contentType,
              getBuildGameVersion(build),
              getBuildLoader(build),
            );
            if (result && typeof result === 'object' && (result as any).success === false) {
              failed.push({ projectId, error: String((result as any).error || 'install_failed') });
            } else {
              installed.push(result);
            }
          } catch (error: any) {
            failed.push({ projectId, error: error?.message || 'install_failed' });
          }
        }
        return {
          buildId,
          requested: projectIds.length,
          installed,
          failed,
        };
      },
    ),

    update_outdated_mods: tool(
      'update_outdated_mods',
      'write',
      'Найти устаревшие моды по sha1 и при желании обновить.',
      {
        buildId: { type: 'string' },
        apply: { type: 'boolean' },
      },
      ['buildId'],
      async (args) => {
        const buildId = asString(args.buildId);
        const build = ensureBuildOrThrow(deps, buildId);
        const apply = asBool(args.apply, false);
        const modsDir = path.join(deps.getInstanceRoot(buildId), 'mods');
        const mods = countDirFiles(modsDir, CONTENT_FILE_EXTS.mods);
        const updates: Array<Record<string, unknown>> = [];
        const unresolved: Array<Record<string, unknown>> = [];
        for (const mod of mods.slice(0, 80)) {
          const sha1 = await sha1File(mod.path).catch(() => '');
          if (!sha1) {
            unresolved.push({ file: mod.name, error: 'sha1_failed' });
            continue;
          }
          const resolved = await lookupModrinthBySha1(sha1);
          if (!resolved?.project_id || !resolved?.id) {
            unresolved.push({ file: mod.name, error: 'not_on_modrinth' });
            continue;
          }
          const latest = await resolveLatestCompatibleVersion(
            String(resolved.project_id),
            getBuildGameVersion(build),
            getBuildLoader(build),
          ).catch(() => null);
          if (!latest?.id || String(latest.id) === String(resolved.id)) continue;
          const row: Record<string, unknown> = {
            file: mod.name,
            projectId: String(resolved.project_id),
            currentVersionId: String(resolved.id),
            latestVersionId: String(latest.id),
            latestVersionNumber: latest.version_number || null,
            updated: false,
          };
          if (apply) {
            const installResult = await deps.installContentDirect(
              buildId,
              String(resolved.project_id),
              String(latest.id),
              'mod',
              getBuildGameVersion(build),
              getBuildLoader(build),
            );
            if (installResult && typeof installResult === 'object' && (installResult as any).success === false) {
              row.error = String((installResult as any).error || 'install_failed');
            } else {
              const newPath = String((installResult as any)?.path || '');
              if (newPath && mod.path !== newPath && fs.existsSync(mod.path)) {
                try {
                  fs.rmSync(mod.path, { force: true });
                } catch {
                  /* ignore */
                }
              }
              if (!mod.enabled && newPath && fs.existsSync(newPath) && !newPath.toLowerCase().endsWith('.disabled')) {
                try {
                  fs.renameSync(newPath, `${newPath}.disabled`);
                } catch {
                  /* ignore */
                }
              }
              row.updated = true;
              row.result = installResult;
            }
          }
          updates.push(row);
        }
        return {
          buildId,
          apply,
          updates,
          unresolved,
          count: updates.length,
        };
      },
    ),

    add_server: tool(
      'add_server',
      'write',
      'Добавить сервер в локальный список.',
      {
        name: { type: 'string' },
        ip: { type: 'string' },
        port: { type: 'number' },
        version: { type: 'string' },
      },
      ['name', 'ip'],
      async (args) => {
        const { ip, port } = normalizeServerInput(asString(args.ip), asNumber(args.port, 25565));
        const name = asString(args.name);
        if (!name || !ip) return { error: 'name_and_ip_required' };
        const servers = deps.readJsonArray(serversPath(deps));
        const server = {
          id: `srv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
          name,
          ip,
          port,
          version: asString(args.version),
        };
        servers.push(server);
        deps.writeJsonArray(serversPath(deps), servers);
        return { ok: true, server };
      },
    ),

    remove_server: tool(
      'remove_server',
      'write',
      'Удалить сервер из локального списка.',
      { id: { type: 'string' } },
      ['id'],
      async (args) => {
        const id = asString(args.id);
        const servers = deps.readJsonArray(serversPath(deps));
        const next = servers.filter((server: any) => server.id !== id);
        if (next.length === servers.length) return { error: 'server_not_found' };
        deps.writeJsonArray(serversPath(deps), next);
        return { ok: true, removed: id };
      },
    ),

    edit_server: tool(
      'edit_server',
      'write',
      'Изменить сервер в локальном списке.',
      {
        id: { type: 'string' },
        name: { type: 'string' },
        ip: { type: 'string' },
        port: { type: 'number' },
        version: { type: 'string' },
      },
      ['id'],
      async (args) => {
        const id = asString(args.id);
        const servers = deps.readJsonArray(serversPath(deps));
        const idx = servers.findIndex((server: any) => server.id === id);
        if (idx < 0) return { error: 'server_not_found' };
        const current = { ...servers[idx] };
        if (args.name != null) current.name = asString(args.name) || current.name;
        if (args.version != null) current.version = asString(args.version);
        if (args.ip != null || args.port != null) {
          const norm = normalizeServerInput(
            args.ip == null ? String(current.ip || '') : asString(args.ip),
            args.port == null ? Number(current.port || 25565) : asNumber(args.port, Number(current.port || 25565)),
          );
          current.ip = norm.ip;
          current.port = norm.port;
        }
        servers[idx] = current;
        deps.writeJsonArray(serversPath(deps), servers);
        return { ok: true, server: current };
      },
    ),

    switch_account: tool(
      'switch_account',
      'write',
      'Переключить текущий аккаунт через renderer.',
      {
        uuid: { type: 'string' },
        username: { type: 'string' },
      },
      [],
      async (args) => {
        const uuid = asString(args.uuid);
        const username = asString(args.username);
        if (!uuid && !username) return { error: 'uuid_or_username_required' };
        const accounts = deps.readJsonArray(accountsPath(deps));
        const match =
          accounts.find((account: any) => uuid && String(account.uuid || '') === uuid) ||
          accounts.find((account: any) => username && String(account.username || account.name || '').toLowerCase() === username.toLowerCase()) ||
          null;
        return await callBridge(
          deps,
          'switch_account',
          {
            uuid: match?.uuid || uuid || undefined,
            username: match?.username || match?.name || username || undefined,
            account: match,
          },
          60_000,
        );
      },
    ),

    open_console: tool(
      'open_console',
      'write',
      'Открыть окно консоли лаунчера.',
      {},
      [],
      async () => await callBridge(deps, 'open_console', {}, 30_000),
    ),

    launch_updater: tool(
      'launch_updater',
      'write',
      'Запустить updater через renderer.',
      {},
      [],
      async () => await callBridge(deps, 'launch_updater', {}, 30_000),
    ),

    disable_all_mods: tool(
      'disable_all_mods',
      'write',
      'Отключить все jar-файлы в mods.',
      { buildId: { type: 'string' } },
      ['buildId'],
      async (args) => {
        const buildId = asString(args.buildId);
        ensureBuildOrThrow(deps, buildId);
        const modsDir = path.join(deps.getInstanceRoot(buildId), 'mods');
        const mods = countDirFiles(modsDir, CONTENT_FILE_EXTS.mods).filter((item) => item.enabled);
        let changed = 0;
        for (const mod of mods) {
          const target = `${mod.path}.disabled`;
          try {
            fs.renameSync(mod.path, target);
            changed += 1;
          } catch {
            /* ignore */
          }
        }
        return { ok: true, changed };
      },
    ),

    enable_all_mods: tool(
      'enable_all_mods',
      'write',
      'Включить все jar.disabled-файлы в mods.',
      { buildId: { type: 'string' } },
      ['buildId'],
      async (args) => {
        const buildId = asString(args.buildId);
        ensureBuildOrThrow(deps, buildId);
        const modsDir = path.join(deps.getInstanceRoot(buildId), 'mods');
        const mods = countDirFiles(modsDir, CONTENT_FILE_EXTS.mods).filter((item) => !item.enabled);
        let changed = 0;
        for (const mod of mods) {
          const target = mod.path.replace(/\.disabled$/i, '');
          try {
            fs.renameSync(mod.path, target);
            changed += 1;
          } catch {
            /* ignore */
          }
        }
        return { ok: true, changed };
      },
    ),

    copy_mods_to_build: tool(
      'copy_mods_to_build',
      'write',
      'Скопировать mods из одной сборки в другую.',
      {
        fromBuildId: { type: 'string' },
        toBuildId: { type: 'string' },
        overwrite: { type: 'boolean' },
      },
      ['fromBuildId', 'toBuildId'],
      async (args) => {
        const fromBuildId = asString(args.fromBuildId);
        const toBuildId = asString(args.toBuildId);
        const overwrite = asBool(args.overwrite, false);
        ensureBuildOrThrow(deps, fromBuildId);
        ensureBuildOrThrow(deps, toBuildId);
        const fromDir = path.join(deps.getInstanceRoot(fromBuildId), 'mods');
        const toDir = path.join(deps.ensureInstanceDirs(toBuildId), 'mods');
        const mods = countDirFiles(fromDir, CONTENT_FILE_EXTS.mods);
        let copied = 0;
        let skipped = 0;
        for (const mod of mods) {
          const dest = path.join(toDir, mod.name);
          if (!overwrite && fs.existsSync(dest)) {
            skipped += 1;
            continue;
          }
          try {
            fs.copyFileSync(mod.path, dest);
            copied += 1;
          } catch {
            skipped += 1;
          }
        }
        return { ok: true, copied, skipped };
      },
    ),

    open_modrinth_project: tool(
      'open_modrinth_project',
      'write',
      'Открыть страницу проекта Modrinth во внешнем браузере.',
      { projectId: { type: 'string' } },
      ['projectId'],
      async (args) => {
        const projectId = asString(args.projectId);
        if (!projectId) return { error: 'projectId_required' };
        const url = `https://modrinth.com/project/${encodeURIComponent(projectId)}`;
        await shell.openExternal(url);
        return { ok: true, url };
      },
    ),

    clear_instance_cache: tool(
      'clear_instance_cache',
      'write',
      'Очистить временные кэши и отчёты инстанса.',
      { buildId: { type: 'string' } },
      ['buildId'],
      async (args) => {
        const buildId = asString(args.buildId);
        ensureBuildOrThrow(deps, buildId);
        const root = deps.getInstanceRoot(buildId);
        const dirs = [
          '.cache',
          '.fabric',
          path.join('shaderpacks', '.cache'),
          'crash-reports',
        ];
        const removed: string[] = [];
        for (const rel of dirs) {
          const full = path.join(root, rel);
          if (!fs.existsSync(full)) continue;
          try {
            fs.rmSync(full, { recursive: true, force: true });
            removed.push(rel.replace(/\\/g, '/'));
          } catch {
            /* ignore */
          }
        }
        try {
          for (const name of fs.readdirSync(root)) {
            if (!/^hs_err_pid\d+\.log$/i.test(name)) continue;
            fs.rmSync(path.join(root, name), { force: true });
            removed.push(name);
          }
        } catch {
          /* ignore */
        }
        return { ok: true, removed };
      },
    ),

    set_java_for_build: tool(
      'set_java_for_build',
      'write',
      'Назначить сборке установленную Java по версии.',
      {
        buildId: { type: 'string' },
        version: { type: 'number' },
      },
      ['buildId', 'version'],
      async (args) => {
        const buildId = asString(args.buildId);
        const version = asNumber(args.version, 0);
        const installed = deps.listInstalledJava().find((item) => item.installed && item.version === version && item.path);
        if (!installed?.path) return { error: 'java_not_installed' };
        const updated = withBuildUpdate(deps, buildId, (build) => {
          build.javaPath = installed.path;
        });
        return { ok: true, build: deps.buildSummary(updated), javaPath: installed.path };
      },
    ),

    rename_build: tool(
      'rename_build',
      'write',
      'Переименовать сборку.',
      {
        buildId: { type: 'string' },
        name: { type: 'string' },
      },
      ['buildId', 'name'],
      async (args) => {
        const buildId = asString(args.buildId);
        const name = asString(args.name);
        if (!name) return { error: 'name_required' };
        const updated = withBuildUpdate(deps, buildId, (build) => {
          build.name = name.slice(0, 80);
        });
        return { ok: true, build: deps.buildSummary(updated) };
      },
    ),
  };
}
