// ===== Локальный импорт .mrpack / .zip (Modrinth, CurseForge, инстанс) =====
// Для ручного импорта: распаковать ВСЁ содержимое, смержить overrides,
// докачать недостающие файлы из индекса и определить контент на диске.
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as zlib from 'zlib';
import { execFileSync } from 'child_process';
import {
  downloadModrinthFile,
  runWithConcurrency,
  PROXY_MAX_CONCURRENT_DOWNLOADS,
} from './modrinthDownload';
import { catalogCfFileUrl } from '../shared/apiBase';

export type ModpackFormat = 'modrinth' | 'curseforge' | 'instance' | 'unknown';

export type ModpackInspect = {
  format: ModpackFormat;
  name: string;
  gameVersion: string;
  loader: string;
  loaderVersion: string;
  fileCount: number;
  hasOverrides: boolean;
  archiveName: string;
};

export type ImportContentItem = {
  name: string;
  filename: string;
  enabled: boolean;
  version?: string;
};

export type ImportModpackResult = {
  success: boolean;
  error?: string;
  build?: any;
  inspect?: ModpackInspect;
  downloaded?: number;
  skipped?: number;
  /** Файлы, которые не удалось распаковать (кириллица / MAX_PATH и т.п.) */
  extractSkipped?: string[];
  incomplete?: boolean;
  content?: {
    mods: ImportContentItem[];
    resourcePacks: ImportContentItem[];
    shaders: ImportContentItem[];
    dataPacks: ImportContentItem[];
  };
};

type ProgressFn = (data: any) => void;

const DEP_LOADER_MAP: Record<string, string> = {
  'fabric-loader': 'fabric',
  'quilt-loader': 'quilt',
  forge: 'forge',
  neoforge: 'neoforge',
};

const LOADER_DEP_KEYS: Record<string, string> = {
  fabric: 'fabric-loader',
  quilt: 'quilt-loader',
  forge: 'forge',
  neoforge: 'neoforge',
};

const BUILD_COLORS = ['#7BD4B7', '#FF6B6B', '#4ECDC4', '#FFD93D', '#70ADDF', '#C084FC', '#FB923C', '#F472B6'];

/** Каталоги/файлы игрового контента, которые переносим как есть. */
const CONTENT_NAMES = new Set([
  'mods',
  'resourcepacks',
  'shaderpacks',
  'datapacks',
  'config',
  'defaultconfigs',
  'kubejs',
  'scripts',
  'schematics',
  'shaderpacks',
  'options.txt',
  'optionsof.txt',
  'servers.dat',
  'servers.dat_old',
  'config',
]);

/**
 * Читаем Central Directory ZIP без полной распаковки.
 * Expand-Archive на кириллице/длинных путях (saves) падает — для превью он запрещён.
 */
function readZipCentralDirectory(zipPath: string): Array<{
  name: string;
  method: number;
  compSize: number;
  uncompSize: number;
  localOffset: number;
}> {
  const fd = fs.openSync(zipPath, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    if (size < 22) return [];
    const tailSize = Math.min(65536 + 22, size);
    const tail = Buffer.alloc(tailSize);
    fs.readSync(fd, tail, 0, tailSize, size - tailSize);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) return [];
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdOffset = tail.readUInt32LE(eocd + 16);
    const totalEntriesOnDisk = tail.readUInt16LE(eocd + 10);
    // ZIP64: в паках с большими saves смещения часто 0xFFFFFFFF
    if (cdOffset === 0xFFFFFFFF || cdSize === 0xFFFFFFFF || totalEntriesOnDisk === 0xFFFF) {
      for (let i = eocd - 20; i >= 0; i--) {
        if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x06 && tail[i + 3] === 0x07) {
          const zip64EocdOffset = Number(tail.readBigUInt64LE(i + 8));
          if (zip64EocdOffset >= 0 && zip64EocdOffset + 56 <= size) {
            const z64 = Buffer.alloc(56);
            fs.readSync(fd, z64, 0, 56, zip64EocdOffset);
            if (z64.readUInt32LE(0) === 0x06064b50) {
              cdSize = Number(z64.readBigUInt64LE(40));
              cdOffset = Number(z64.readBigUInt64LE(48));
            }
          }
          break;
        }
      }
    }
    if (cdSize <= 0 || cdOffset < 0 || cdOffset + cdSize > size) return [];
    const cd = Buffer.alloc(cdSize);
    fs.readSync(fd, cd, 0, cdSize, cdOffset);
    const entries: Array<{ name: string; method: number; compSize: number; uncompSize: number; localOffset: number }> = [];
    let off = 0;
    while (off + 46 <= cd.length) {
      if (cd.readUInt32LE(off) !== 0x02014b50) break;
      const flags = cd.readUInt16LE(off + 8);
      const method = cd.readUInt16LE(off + 10);
      const compSize = cd.readUInt32LE(off + 20);
      const uncompSize = cd.readUInt32LE(off + 24);
      const nameLen = cd.readUInt16LE(off + 28);
      const extraLen = cd.readUInt16LE(off + 30);
      const commentLen = cd.readUInt16LE(off + 32);
      const localOffset = cd.readUInt32LE(off + 42);
      const nameBuf = cd.subarray(off + 46, off + 46 + nameLen);
      const name = decodeZipName(nameBuf, flags).replace(/\\/g, '/');
      entries.push({ name, method, compSize, uncompSize, localOffset });
      off += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  } finally {
    fs.closeSync(fd);
  }
}

function readZipEntryData(
  zipPath: string,
  entry: { method: number; compSize: number; localOffset: number },
): Buffer | null {
  const fd = fs.openSync(zipPath, 'r');
  try {
    const lh = Buffer.alloc(30);
    fs.readSync(fd, lh, 0, 30, entry.localOffset);
    if (lh.readUInt32LE(0) !== 0x04034b50) return null;
    const nameLen = lh.readUInt16LE(26);
    const extraLen = lh.readUInt16LE(28);
    const dataStart = entry.localOffset + 30 + nameLen + extraLen;
    const compressed = Buffer.alloc(entry.compSize);
    if (entry.compSize > 0) fs.readSync(fd, compressed, 0, entry.compSize, dataStart);
    if (entry.method === 0) return compressed;
    if (entry.method === 8) return zlib.inflateRawSync(compressed);
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

function decodeZipName(nameBuf: Buffer, flags: number): string {
  // Bit 11 — UTF-8 (общий флаг ZIP)
  if (flags & 0x800) return nameBuf.toString('utf8');
  const asUtf8 = nameBuf.toString('utf8');
  if (!/\uFFFD/.test(asUtf8)) {
    try {
      if (Buffer.from(asUtf8, 'utf8').equals(nameBuf)) return asUtf8;
    } catch { /* fall through */ }
  }
  // Без UTF-8 flag Windows-архивы часто в CP1251/OEM — latin1 сохраняет байты лучше, чем битый utf8
  return nameBuf.toString('latin1');
}

function isCriticalExtractPath(name: string): boolean {
  const n = name.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
  const base = n.split('/').pop() || '';
  return (
    base === 'modrinth.index.json'
    || base === 'manifest.json'
    || base === 'mmc-pack.json'
    || base === 'minecraftinstance.json'
    || base === 'instance.cfg'
    || /(^|\/)overrides\/saves\//i.test(n)
    || /(^|\/)saves\/.+\/level\.dat$/i.test(n)
  );
}

function winLongPath(p: string): string {
  if (process.platform !== 'win32') return p;
  const resolved = path.resolve(p);
  if (resolved.startsWith('\\\\?\\')) return resolved;
  if (resolved.startsWith('\\\\')) return `\\\\?\\UNC\\${resolved.slice(2)}`;
  return `\\\\?\\${resolved}`;
}

/** Fallback: поэлементная распаковка ZIP с long-path на Windows. */
function extractArchiveNode(zipPath: string, destDir: string): { skipped: string[] } {
  const entries = readZipCentralDirectory(zipPath);
  const skipped: string[] = [];
  fs.mkdirSync(winLongPath(destDir), { recursive: true });
  for (const entry of entries) {
    const name = entry.name.replace(/\\/g, '/');
    if (!name || name.endsWith('/')) {
      try { fs.mkdirSync(winLongPath(path.join(destDir, name)), { recursive: true }); } catch { /* skip */ }
      continue;
    }
    const target = path.join(destDir, ...name.split('/').filter(Boolean));
    try {
      const data = readZipEntryData(zipPath, entry);
      if (!data) {
        skipped.push(name);
        continue;
      }
      fs.mkdirSync(winLongPath(path.dirname(target)), { recursive: true });
      fs.writeFileSync(winLongPath(target), data);
    } catch {
      skipped.push(name);
    }
  }
  return { skipped };
}

function extractLooksOk(dest: string): boolean {
  return (
    fs.existsSync(path.join(dest, 'modrinth.index.json'))
    || fs.existsSync(path.join(dest, 'manifest.json'))
    || fs.existsSync(path.join(dest, 'mmc-pack.json'))
    || fs.existsSync(path.join(dest, 'minecraftinstance.json'))
    || fs.existsSync(path.join(dest, 'instance.cfg'))
    || fs.existsSync(path.join(dest, 'mods'))
    || fs.existsSync(path.join(dest, 'overrides'))
    || findPackRoot(dest) !== dest
  );
}

/** Распаковка: tar, иначе Node ZIP. Expand-Archive не используем. */
export function extractArchive(archivePath: string, destDir: string): { skipped: string[] } {
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  const src = path.resolve(archivePath);
  const dest = path.resolve(destDir);
  try {
    execFileSync('tar', ['-xf', src, '-C', dest], {
      timeout: 300_000,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (extractLooksOk(dest)) return { skipped: [] };
  } catch {
    /* fallback */
  }
  const { skipped } = extractArchiveNode(src, dest);
  if (!extractLooksOk(dest)) {
    throw new Error('extract_failed');
  }
  const critical = skipped.filter(isCriticalExtractPath);
  if (critical.length) {
    const err = new Error('extract_incomplete') as Error & { skipped?: string[] };
    err.skipped = skipped;
    throw err;
  }
  return { skipped };
}

function mergeDirs(src: string, dest: string, skipped?: string[]): void {
  const srcLong = winLongPath(src);
  if (!fs.existsSync(srcLong) && !fs.existsSync(src)) return;
  const listDir = fs.existsSync(srcLong) ? srcLong : src;
  fs.mkdirSync(winLongPath(dest), { recursive: true });
  for (const entry of fs.readdirSync(listDir)) {
    const s = path.join(src, entry);
    const d = path.join(dest, entry);
    try {
      const st = fs.statSync(winLongPath(s));
      if (st.isDirectory()) mergeDirs(s, d, skipped);
      else {
        fs.mkdirSync(winLongPath(path.dirname(d)), { recursive: true });
        fs.copyFileSync(winLongPath(s), winLongPath(d));
      }
    } catch (e) {
      skipped?.push(d);
      console.warn('[import] merge skip', d, e instanceof Error ? e.message : e);
    }
  }
}

/** Счётчик миров (папки с level.dat). */
function countWorlds(savesDir: string): number {
  const dir = fs.existsSync(winLongPath(savesDir)) ? winLongPath(savesDir) : savesDir;
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const level = path.join(savesDir, e.name, 'level.dat');
      if (fs.existsSync(winLongPath(level)) || fs.existsSync(level)) n++;
    }
  } catch { /* ignore */ }
  return n;
}

/**
 * Ручной импорт: вытаскиваем overrides/* из ZIP сразу в корень инстанса
 * (saves, config, options.txt, …) с long-path — tar часто теряет кириллицу.
 */
function extractOverridesToInstance(zipPath: string, instanceDir: string): { files: number; worlds: number; skipped: string[] } {
  const entries = readZipCentralDirectory(zipPath);
  let files = 0;
  const skipped: string[] = [];
  for (const entry of entries) {
    const name = entry.name.replace(/\\/g, '/');
    const m = name.match(/^(?:\.\/)?(?:[^/]+\/)*(overrides|client-overrides|server-overrides)\/(.*)$/i);
    if (!m) continue;
    const rest = m[2] || '';
    if (!rest) continue;
    if (rest.endsWith('/')) {
      try { fs.mkdirSync(winLongPath(path.join(instanceDir, rest)), { recursive: true }); } catch { /* skip */ }
      continue;
    }
    const target = path.join(instanceDir, ...rest.split('/').filter(Boolean));
    try {
      // Уже есть (из tar) — не перезаписываем, кроме пустых
      if (fs.existsSync(winLongPath(target))) {
        try {
          if (fs.statSync(winLongPath(target)).size > 0) { files++; continue; }
        } catch { /* rewrite */ }
      }
      const data = readZipEntryData(zipPath, entry);
      if (!data) {
        skipped.push(rest);
        continue;
      }
      fs.mkdirSync(winLongPath(path.dirname(target)), { recursive: true });
      fs.writeFileSync(winLongPath(target), data);
      files++;
    } catch (e) {
      skipped.push(rest);
      console.warn('[import] override skip', rest, e instanceof Error ? e.message : e);
    }
  }
  return { files, worlds: countWorlds(path.join(instanceDir, 'saves')), skipped };
}

function countFiles(dir: string): number {
  let c = 0;
  try {
    for (const e of fs.readdirSync(dir)) {
      const p = path.join(dir, e);
      c += fs.statSync(p).isDirectory() ? countFiles(p) : 1;
    }
  } catch { /* ignore */ }
  return c;
}

function countByExt(dir: string, exts: string[]): number {
  let c = 0;
  try {
    for (const e of fs.readdirSync(dir)) {
      const p = path.join(dir, e);
      if (fs.statSync(p).isDirectory()) c += countByExt(p, exts);
      else if (exts.some((x) => e.toLowerCase().endsWith(x))) c += 1;
    }
  } catch { /* ignore */ }
  return c;
}

function resolveSafePath(root: string, rel: string): string | null {
  const target = path.resolve(root, String(rel).replace(/\\/g, '/'));
  const base = path.resolve(root);
  if (target !== base && !target.startsWith(base + path.sep)) return null;
  return target;
}

function parseLoaderId(raw: string): { loader: string; loaderVersion: string } {
  const id = String(raw || '');
  const m = id.match(/^(fabric|quilt|forge|neoforge)[-:](.+)$/i);
  if (m) return { loader: m[1].toLowerCase(), loaderVersion: m[2] };
  return { loader: 'vanilla', loaderVersion: '' };
}

function readJson(filePath: string): any | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

/** Ищем корень пака: index/manifest могут оказаться во вложенных папках после unzip. */
function findPackRoot(dir: string, maxDepth = 4): string {
  const markers = [
    'modrinth.index.json',
    'manifest.json',
    'mmc-pack.json',
    'minecraftinstance.json',
    'instance.cfg',
    'pack.toml',
  ];
  const hasMarker = (d: string) => markers.some((m) => fs.existsSync(path.join(d, m)));
  if (hasMarker(dir)) return dir;

  // BFS по каталогам (пропускаем overrides и служебное)
  type Node = { dir: string; depth: number };
  const queue: Node[] = [{ dir, depth: 0 }];
  const skipName = /^(overrides|client-overrides|server-overrides|mods|resourcepacks|shaderpacks|datapacks|config|saves|libraries|\.minecraft)$/i;

  while (queue.length) {
    const { dir: cur, depth } = queue.shift()!;
    if (depth >= maxDepth) continue;
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }

    for (const e of entries) {
      if (!e.isDirectory() || skipName.test(e.name) || e.name.startsWith('.')) continue;
      const sub = path.join(cur, e.name);
      if (hasMarker(sub)) return sub;
      queue.push({ dir: sub, depth: depth + 1 });
    }
  }

  // Один каталог-обёртка без маркера
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory() && !/^\./.test(e.name) && !skipName.test(e.name));
    const files = entries.filter((e) => e.isFile());
    if (dirs.length === 1 && files.length === 0) {
      return findPackRoot(path.join(dir, dirs[0].name), maxDepth - 1);
    }
  } catch { /* ignore */ }
  return dir;
}

/** Поднимаем содержимое packRoot в instanceDir, если оно во вложенной папке. */
function promotePackRoot(instanceDir: string, packRoot: string): void {
  if (path.resolve(packRoot) === path.resolve(instanceDir)) return;
  mergeDirs(packRoot, instanceDir);
  try { fs.rmSync(packRoot, { recursive: true, force: true }); } catch { /* ignore */ }
}

function mergeOverrideDirs(instanceDir: string, sendProgress: ProgressFn): number {
  let total = 0;
  const names = ['overrides', 'client-overrides', 'server-overrides'];
  // + overrides из manifest (имя может отличаться) — вызывающий добавит отдельно
  for (const overrideDir of names) {
    const src = path.join(instanceDir, overrideDir);
    if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) continue;
    const n = countFiles(src);
    mergeDirs(src, instanceDir);
    try { fs.rmSync(src, { recursive: true, force: true }); } catch { /* ignore */ }
    total += n;
  }
  if (total > 0) {
    sendProgress({ kind: 'status', key: 'smp.overridesCopied', params: { n: total } });
  }
  return total;
}

function listContentItems(dir: string, exts: string[], allowDirs = false): ImportContentItem[] {
  if (!fs.existsSync(dir)) return [];
  const out: ImportContentItem[] = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const disabled = item.name.toLowerCase().endsWith('.disabled');
    const rawName = disabled ? item.name.slice(0, -'.disabled'.length) : item.name;
    const ext = path.extname(rawName).toLowerCase();
    if (item.isFile() && exts.includes(ext)) {
      let name = rawName.replace(/\.[^.]+$/i, '');
      let version = '';
      const verMatch = name.match(/[-_](\d+(?:\.\d+)*)/);
      if (verMatch) {
        version = verMatch[1];
        name = name.slice(0, verMatch.index).replace(/[-_]+$/, '') || name;
      }
      out.push({ name, filename: item.name, enabled: !disabled, version });
    } else if (item.isDirectory() && allowDirs) {
      out.push({ name: item.name, filename: item.name, enabled: true });
    }
  }
  return out;
}

function inventoryContent(root: string): ImportModpackResult['content'] {
  return {
    mods: listContentItems(path.join(root, 'mods'), ['.jar', '.litemod']),
    resourcePacks: listContentItems(path.join(root, 'resourcepacks'), ['.zip'], true),
    shaders: listContentItems(path.join(root, 'shaderpacks'), ['.zip'], true),
    dataPacks: listContentItems(path.join(root, 'datapacks'), ['.zip'], true),
  };
}

function parseInstanceCfg(filePath: string): { name?: string; gameVersion?: string } {
  try {
    const text = fs.readFileSync(filePath, 'utf-8');
    const out: { name?: string; gameVersion?: string } = {};
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^([^=]+)=(.*)$/);
      if (!m) continue;
      const key = m[1].trim().toLowerCase();
      const val = m[2].trim();
      if (key === 'name' && val) out.name = val;
      if ((key === 'intendedversion' || key === 'minecraftversion') && val) out.gameVersion = val;
    }
    return out;
  } catch {
    return {};
  }
}

function detectFromDir(dir: string, archiveName: string): ModpackInspect {
  const indexPath = path.join(dir, 'modrinth.index.json');
  const manifestPath = path.join(dir, 'manifest.json');
  const mmcPath = path.join(dir, 'mmc-pack.json');
  const cfInstancePath = path.join(dir, 'minecraftinstance.json');
  const instanceCfgPath = path.join(dir, 'instance.cfg');
  const packTomlPath = path.join(dir, 'pack.toml');
  const fallbackName = archiveName.replace(/\.(mrpack|zip)$/i, '');

  if (fs.existsSync(indexPath)) {
    const index = readJson(indexPath) || {};
    const deps = index.dependencies || {};
    const gameVersion = String(deps.minecraft || '');
    const depKey = Object.keys(deps).find((k) => k !== 'minecraft') || '';
    const loader = DEP_LOADER_MAP[depKey] || (depKey ? depKey : 'vanilla');
    const loaderVersion = depKey ? String(deps[depKey] || '') : '';
    const files = Array.isArray(index.files) ? index.files.length : 0;
    const hasOverrides =
      fs.existsSync(path.join(dir, 'overrides'))
      || fs.existsSync(path.join(dir, 'client-overrides'))
      || fs.existsSync(path.join(dir, 'server-overrides'));
    const onDisk = countByExt(path.join(dir, 'mods'), ['.jar', '.litemod'])
      + (hasOverrides ? countByExt(path.join(dir, 'overrides', 'mods'), ['.jar', '.litemod']) : 0);
    return {
      format: 'modrinth',
      name: String(index.name || fallbackName),
      gameVersion,
      loader,
      loaderVersion,
      fileCount: Math.max(files, onDisk),
      hasOverrides,
      archiveName,
    };
  }

  if (fs.existsSync(manifestPath)) {
    const manifest = readJson(manifestPath) || {};
    // CurseForge export иногда кладёт minecraftinstance рядом — всё равно CF-формат
    const mc = manifest.minecraft || {};
    const gameVersion = String(mc.version || '');
    const loaders = Array.isArray(mc.modLoaders) ? mc.modLoaders : [];
    const primary = loaders.find((l: any) => l?.primary) || loaders[0];
    const parsed = parseLoaderId(primary?.id || '');
    const files = Array.isArray(manifest.files) ? manifest.files.length : 0;
    const overrideName = String(manifest.overrides || 'overrides');
    return {
      format: 'curseforge',
      name: String(manifest.name || fallbackName),
      gameVersion,
      loader: parsed.loader,
      loaderVersion: parsed.loaderVersion,
      fileCount: files || countByExt(path.join(dir, overrideName, 'mods'), ['.jar', '.litemod']),
      hasOverrides: fs.existsSync(path.join(dir, overrideName)),
      archiveName,
    };
  }

  if (fs.existsSync(cfInstancePath)) {
    const inst = readJson(cfInstancePath) || {};
    const base = inst.baseModLoader || {};
    const loaderName = String(base.name || base.forgeVersion || '');
    const parsed = parseLoaderId(loaderName.includes('-') ? loaderName : `forge-${loaderName}`);
    const mcVer = String(base.minecraftVersion || inst.gameVersion || '');
    const addons = Array.isArray(inst.installedAddons) ? inst.installedAddons.length : 0;
    const modsDir = ['mods', path.join('minecraft', 'mods')]
      .map((p) => path.join(dir, p))
      .find((p) => fs.existsSync(p));
    return {
      format: addons > 0 && !modsDir ? 'curseforge' : 'instance',
      name: String(inst.name || fallbackName),
      gameVersion: mcVer,
      loader: parsed.loader || 'vanilla',
      loaderVersion: parsed.loaderVersion,
      fileCount: modsDir ? countByExt(modsDir, ['.jar', '.litemod']) : addons,
      hasOverrides: false,
      archiveName,
    };
  }

  if (fs.existsSync(mmcPath)) {
    const mmc = readJson(mmcPath) || {};
    const comps = Array.isArray(mmc.components) ? mmc.components : [];
    const mc = comps.find((c: any) => c?.uid === 'net.minecraft');
    const fabric = comps.find((c: any) => String(c?.uid || '').includes('fabric-loader'));
    const quilt = comps.find((c: any) => String(c?.uid || '').includes('quilt-loader'));
    const forge = comps.find((c: any) => String(c?.uid || '').includes('minecraftforge') || String(c?.uid || '') === 'net.minecraftforge');
    const neo = comps.find((c: any) => String(c?.uid || '').includes('neoforge'));
    let loader = 'vanilla';
    let loaderVersion = '';
    if (fabric) { loader = 'fabric'; loaderVersion = String(fabric.version || ''); }
    else if (quilt) { loader = 'quilt'; loaderVersion = String(quilt.version || ''); }
    else if (neo) { loader = 'neoforge'; loaderVersion = String(neo.version || ''); }
    else if (forge) { loader = 'forge'; loaderVersion = String(forge.version || ''); }
    const cfg = fs.existsSync(instanceCfgPath) ? parseInstanceCfg(instanceCfgPath) : {};
    const modsDir = fs.existsSync(path.join(dir, 'minecraft', 'mods'))
      ? path.join(dir, 'minecraft', 'mods')
      : path.join(dir, 'mods');
    return {
      format: 'instance',
      name: cfg.name || fallbackName,
      gameVersion: String(mc?.version || cfg.gameVersion || ''),
      loader,
      loaderVersion,
      fileCount: countByExt(modsDir, ['.jar', '.litemod']),
      hasOverrides: false,
      archiveName,
    };
  }

  if (fs.existsSync(instanceCfgPath)) {
    const cfg = parseInstanceCfg(instanceCfgPath);
    const modsDir = ['mods', path.join('minecraft', 'mods'), path.join('.minecraft', 'mods')]
      .map((p) => path.join(dir, p))
      .find((p) => fs.existsSync(p));
    return {
      format: 'instance',
      name: cfg.name || fallbackName,
      gameVersion: cfg.gameVersion || '',
      loader: 'vanilla',
      loaderVersion: '',
      fileCount: modsDir ? countByExt(modsDir, ['.jar', '.litemod']) : 0,
      hasOverrides: false,
      archiveName,
    };
  }

  if (fs.existsSync(packTomlPath)) {
    // packwiz: минимальный разбор без TOML-парсера
    try {
      const text = fs.readFileSync(packTomlPath, 'utf-8');
      const name = (text.match(/^\s*name\s*=\s*"([^"]+)"/m) || [])[1] || fallbackName;
      const gameVersion = (text.match(/^\s*minecraft\s*=\s*"([^"]+)"/m) || [])[1] || '';
      let loader = 'vanilla';
      let loaderVersion = '';
      for (const key of ['fabric', 'quilt', 'forge', 'neoforge'] as const) {
        const m = text.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"`, 'm'));
        if (m) { loader = key === 'fabric' ? 'fabric' : key; loaderVersion = m[1]; break; }
      }
      return {
        format: 'instance',
        name,
        gameVersion,
        loader,
        loaderVersion,
        fileCount: countByExt(path.join(dir, 'mods'), ['.jar', '.litemod']),
        hasOverrides: false,
        archiveName,
      };
    } catch { /* fallthrough */ }
  }

  const modsDir = ['mods', path.join('minecraft', 'mods'), path.join('.minecraft', 'mods')]
    .map((p) => path.join(dir, p))
    .find((p) => fs.existsSync(p));
  if (modsDir || [...CONTENT_NAMES].some((n) => fs.existsSync(path.join(dir, n)))) {
    return {
      format: 'instance',
      name: fallbackName,
      gameVersion: '',
      loader: 'vanilla',
      loaderVersion: '',
      fileCount: modsDir ? countByExt(modsDir, ['.jar', '.litemod']) : 0,
      hasOverrides: false,
      archiveName,
    };
  }

  return {
    format: 'unknown',
    name: fallbackName,
    gameVersion: '',
    loader: 'vanilla',
    loaderVersion: '',
    fileCount: 0,
    hasOverrides: false,
    archiveName,
  };
}

/** Превью без полной распаковки: читаем index/manifest из ZIP напрямую. */
export function inspectLocalModpack(archivePath: string): ModpackInspect {
  const archiveName = path.basename(archivePath);
  const fallback: ModpackInspect = {
    format: 'unknown',
    name: archiveName.replace(/\.(mrpack|zip)$/i, ''),
    gameVersion: '',
    loader: 'vanilla',
    loaderVersion: '',
    fileCount: 0,
    hasOverrides: false,
    archiveName,
  };

  let entries: ReturnType<typeof readZipCentralDirectory> = [];
  try {
    entries = readZipCentralDirectory(archivePath);
  } catch {
    return fallback;
  }
  if (!entries.length) return fallback;

  const norm = (n: string) => n.replace(/\\/g, '/').replace(/^\.\//, '');
  const names = entries.map((e) => norm(e.name));
  const hasOverrides = names.some((n) =>
    /(^|\/)(overrides|client-overrides|server-overrides)(\/|$)/i.test(n),
  );
  const jarInArchive = names.filter((n) =>
    /(^|\/)mods\/[^/]+\.(jar|litemod)$/i.test(n) || /(^|\/)overrides\/mods\/[^/]+\.(jar|litemod)$/i.test(n),
  ).length;

  const indexEntry = entries.find((e) => /(^|\/)modrinth\.index\.json$/i.test(norm(e.name)));
  if (indexEntry) {
    const buf = readZipEntryData(archivePath, indexEntry);
    const index = buf ? (() => { try { return JSON.parse(buf.toString('utf8')); } catch { return null; } })() : null;
    const deps = index?.dependencies || {};
    const gameVersion = String(deps.minecraft || '');
    const depKey = Object.keys(deps).find((k) => k !== 'minecraft') || '';
    const loader = DEP_LOADER_MAP[depKey] || (depKey ? depKey : 'vanilla');
    const loaderVersion = depKey ? String(deps[depKey] || '') : '';
    const files = Array.isArray(index?.files) ? index.files.length : 0;
    return {
      format: 'modrinth',
      name: String(index?.name || fallback.name),
      gameVersion,
      loader,
      loaderVersion,
      fileCount: Math.max(files, jarInArchive),
      hasOverrides,
      archiveName,
    };
  }

  const manifestEntry = entries.find((e) => /(^|\/)manifest\.json$/i.test(norm(e.name)));
  if (manifestEntry) {
    const buf = readZipEntryData(archivePath, manifestEntry);
    const manifest = buf ? (() => { try { return JSON.parse(buf.toString('utf8')); } catch { return null; } })() : null;
    const mc = manifest?.minecraft || {};
    const gameVersion = String(mc.version || '');
    const loaders = Array.isArray(mc.modLoaders) ? mc.modLoaders : [];
    const primary = loaders.find((l: any) => l?.primary) || loaders[0];
    const parsed = parseLoaderId(primary?.id || '');
    const files = Array.isArray(manifest?.files) ? manifest.files.length : 0;
    return {
      format: 'curseforge',
      name: String(manifest?.name || fallback.name),
      gameVersion,
      loader: parsed.loader,
      loaderVersion: parsed.loaderVersion,
      fileCount: Math.max(files, jarInArchive),
      hasOverrides,
      archiveName,
    };
  }

  const mmcEntry = entries.find((e) => /(^|\/)mmc-pack\.json$/i.test(norm(e.name)));
  const cfInstEntry = entries.find((e) => /(^|\/)minecraftinstance\.json$/i.test(norm(e.name)));
  const cfgEntry = entries.find((e) => /(^|\/)instance\.cfg$/i.test(norm(e.name)));

  if (cfInstEntry && !mmcEntry) {
    const buf = readZipEntryData(archivePath, cfInstEntry);
    const inst = buf ? (() => { try { return JSON.parse(buf.toString('utf8')); } catch { return null; } })() : null;
    const base = inst?.baseModLoader || {};
    const loaderName = String(base.name || '');
    const parsed = parseLoaderId(loaderName.includes('-') ? loaderName : loaderName ? `forge-${loaderName}` : '');
    return {
      format: jarInArchive > 0 ? 'instance' : 'curseforge',
      name: String(inst?.name || fallback.name),
      gameVersion: String(base.minecraftVersion || inst?.gameVersion || ''),
      loader: parsed.loader || 'vanilla',
      loaderVersion: parsed.loaderVersion,
      fileCount: Math.max(
        jarInArchive,
        Array.isArray(inst?.installedAddons) ? inst.installedAddons.length : 0,
      ),
      hasOverrides,
      archiveName,
    };
  }

  if (mmcEntry || jarInArchive > 0 || cfgEntry) {
    let gameVersion = '';
    let loader = 'vanilla';
    let loaderVersion = '';
    let name = fallback.name;
    if (mmcEntry) {
      const buf = readZipEntryData(archivePath, mmcEntry);
      const mmc = buf ? (() => { try { return JSON.parse(buf.toString('utf8')); } catch { return null; } })() : null;
      const comps = Array.isArray(mmc?.components) ? mmc.components : [];
      const mc = comps.find((c: any) => c?.uid === 'net.minecraft');
      const fabric = comps.find((c: any) => String(c?.uid || '').includes('fabric-loader'));
      const quilt = comps.find((c: any) => String(c?.uid || '').includes('quilt-loader'));
      const forge = comps.find((c: any) => String(c?.uid || '').includes('minecraftforge'));
      const neo = comps.find((c: any) => String(c?.uid || '').includes('neoforge'));
      gameVersion = String(mc?.version || '');
      if (fabric) { loader = 'fabric'; loaderVersion = String(fabric.version || ''); }
      else if (quilt) { loader = 'quilt'; loaderVersion = String(quilt.version || ''); }
      else if (neo) { loader = 'neoforge'; loaderVersion = String(neo.version || ''); }
      else if (forge) { loader = 'forge'; loaderVersion = String(forge.version || ''); }
    }
    if (cfgEntry) {
      const buf = readZipEntryData(archivePath, cfgEntry);
      if (buf) {
        const text = buf.toString('utf8');
        const nm = (text.match(/^name=(.*)$/im) || [])[1];
        const ver = (text.match(/^IntendedVersion=(.*)$/im) || text.match(/^MinecraftVersion=(.*)$/im) || [])[1];
        if (nm?.trim()) name = nm.trim();
        if (ver?.trim() && !gameVersion) gameVersion = ver.trim();
      }
    }
    return {
      format: 'instance',
      name,
      gameVersion,
      loader,
      loaderVersion,
      fileCount: jarInArchive,
      hasOverrides,
      archiveName,
    };
  }

  return { ...fallback, hasOverrides, fileCount: jarInArchive };
}

function forgeCdnUrl(fileId: number, fileName: string): string {
  const n = Math.floor(fileId / 1000);
  const m = fileId % 1000;
  return `https://mediafilez.forgecdn.net/files/${n}/${m}/${encodeURIComponent(fileName)}`;
}

/** Метаданные файла CF через наш каталог (ключ API на сервере). */
async function resolveCurseFileViaCatalog(
  projectId: number,
  fileId: number,
): Promise<{ filename: string; url: string; size?: number; sha1?: string } | null> {
  try {
    const res = await fetch(catalogCfFileUrl(`cf:${projectId}`, fileId), {
      headers: { 'User-Agent': 'Undefined-Client', Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json() as {
      file?: { filename?: string; url?: string; size?: number; hashes?: { sha1?: string } };
      name?: string;
    };
    const file = data?.file;
    if (!file?.url) return null;
    return {
      filename: String(file.filename || data.name || `${fileId}.jar`),
      url: String(file.url),
      size: file.size,
      sha1: file.hashes?.sha1,
    };
  } catch {
    return null;
  }
}

async function resolveCurseFileName(projectId: number, fileId: number): Promise<string | null> {
  const via = await resolveCurseFileViaCatalog(projectId, fileId);
  if (via?.filename) return via.filename;
  const urls = [
    `https://api.curse.tools/v1/cf/mods/${projectId}/files/${fileId}`,
    `https://www.curseforge.com/api/v1/mods/${projectId}/files/${fileId}`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Undefined-Client' } });
      if (!res.ok) continue;
      const data = await res.json() as any;
      const name = data?.data?.fileName || data?.fileName || data?.data?.displayName;
      if (name) return String(name);
    } catch { /* try next */ }
  }
  return null;
}

function shouldInstallModrinthFile(entry: any): boolean {
  const env = entry?.env;
  if (!env || typeof env !== 'object') return true;
  const client = String(env.client || '').toLowerCase();
  // client: unsupported — серверный файл, клиенту не нужен
  if (client === 'unsupported') return false;
  return true;
}

export type ImportLocalOptions = {
  archivePath: string;
  appDataDir: string;
  getInstanceRoot: (buildId: string) => string;
  sendProgress: ProgressFn;
  resolveJavaPath?: (gameVersion: string) => Promise<string | undefined>;
  defaultLoaderVersions?: Record<string, string>;
};

export async function importLocalModpack(opts: ImportLocalOptions): Promise<ImportModpackResult> {
  const { archivePath, appDataDir, getInstanceRoot, sendProgress, resolveJavaPath, defaultLoaderVersions } = opts;
  if (!archivePath || !fs.existsSync(archivePath)) {
    return { success: false, error: 'file_not_found' };
  }
  if (!/\.(mrpack|zip)$/i.test(archivePath)) {
    return { success: false, error: 'unsupported_format' };
  }

  const archiveName = path.basename(archivePath);
  const buildId = crypto.randomUUID();
  const instanceDir = getInstanceRoot(buildId);
  fs.mkdirSync(instanceDir, { recursive: true });

  sendProgress({ type: 'start', filename: archiveName, size: fs.statSync(archivePath).size });
  sendProgress({ kind: 'status', key: 'import.extracting' });

  const zipPath = path.join(instanceDir, `pack-${crypto.randomBytes(4).toString('hex')}.zip`);
  let extractSkipped: string[] = [];
  try {
    fs.copyFileSync(archivePath, zipPath);
    const extracted = extractArchive(zipPath, instanceDir);
    extractSkipped = extracted.skipped || [];
  } catch (e: any) {
    const skippedList = Array.isArray(e?.skipped) ? e.skipped as string[] : [];
    try { fs.rmSync(instanceDir, { recursive: true, force: true }); } catch { /* ignore */ }
    return {
      success: false,
      error: e?.message || 'extract_failed',
      extractSkipped: skippedList,
    };
  }

  if (extractSkipped.length) {
    sendProgress({
      kind: 'status',
      key: 'smp.packFileErr',
      params: {
        i: extractSkipped.length,
        n: extractSkipped.length,
        file: path.basename(extractSkipped[0] || ''),
        msg: `extract_skipped:${extractSkipped.length}`,
      },
    });
  }

  // Вложенный корень архива → в корень инстанса
  const packRoot = findPackRoot(instanceDir);
  promotePackRoot(instanceDir, packRoot);

  let inspect = detectFromDir(instanceDir, archiveName);
  sendProgress({
    kind: 'status',
    key: 'import.detected',
    params: {
      name: inspect.name,
      version: inspect.gameVersion || '—',
      loader: inspect.loader,
      n: inspect.fileCount,
    },
  });

  let downloaded = 0;
  let skipped = 0;
  const mergeSkipped: string[] = [];

  // Overrides (saves/config/options/…) — отдельно из ZIP с long-path, затем merge с диска
  sendProgress({ kind: 'status', key: 'import.overrides' });
  try {
    const ov = extractOverridesToInstance(zipPath, instanceDir);
    if (ov.skipped?.length) extractSkipped.push(...ov.skipped);
    if (ov.files > 0) {
      sendProgress({
        kind: 'status',
        key: 'import.overridesDone',
        params: { n: ov.files, worlds: ov.worlds },
      });
    }
  } catch (e) {
    console.warn('[import] extractOverridesToInstance', e);
  }

  if (inspect.format === 'curseforge') {
    const manifest = readJson(path.join(instanceDir, 'manifest.json')) || {};
    const overrideName = String(manifest.overrides || 'overrides');
    if (overrideName && !/^(overrides|client-overrides|server-overrides)$/i.test(overrideName)) {
      const ovDir = path.join(instanceDir, overrideName);
      if (fs.existsSync(ovDir) || fs.existsSync(winLongPath(ovDir))) {
        const n = countFiles(ovDir);
        mergeDirs(ovDir, instanceDir, mergeSkipped);
        try { fs.rmSync(winLongPath(ovDir), { recursive: true, force: true }); } catch {
          try { fs.rmSync(ovDir, { recursive: true, force: true }); } catch { /* ignore */ }
        }
        if (n > 0) sendProgress({ kind: 'status', key: 'smp.overridesCopied', params: { n } });
      }
    }
  }
  mergeOverrideDirs(instanceDir, sendProgress);

  // Архив больше не нужен
  try { fs.unlinkSync(zipPath); } catch { /* ignore */ }

  // ===== Modrinth: докачка недостающих файлов из индекса =====
  if (inspect.format === 'modrinth') {
    const index = readJson(path.join(instanceDir, 'modrinth.index.json')) || {};
    const indexFiles = (Array.isArray(index.files) ? index.files : []).filter(shouldInstallModrinthFile);
    if (indexFiles.length) {
      sendProgress({ kind: 'status', key: 'smp.downloadingPackFiles', params: { n: indexFiles.length } });
      let done = 0;
      await runWithConcurrency(indexFiles, PROXY_MAX_CONCURRENT_DOWNLOADS, async (entry: any) => {
        if (!entry?.path) {
          const i = ++done;
          skipped++;
          sendProgress({ kind: 'status', key: 'smp.packFile', params: { i, n: indexFiles.length, file: '—', size: '0' } });
          return;
        }
        const targetPath = resolveSafePath(instanceDir, entry.path);
        if (!targetPath) {
          const i = ++done;
          skipped++;
          sendProgress({ kind: 'status', key: 'smp.packFile', params: { i, n: indexFiles.length, file: path.basename(String(entry.path)), size: '0' } });
          return;
        }

        // Уже лежит в архиве / overrides — не качаем повторно
        if (fs.existsSync(targetPath) && fs.statSync(targetPath).size > 0) {
          const i = ++done;
          downloaded++;
          sendProgress({
            kind: 'status',
            key: 'smp.packFile',
            params: { i, n: indexFiles.length, file: path.basename(entry.path), size: '0' },
          });
          return;
        }

        const dlUrl = entry?.downloads?.[0];
        if (!dlUrl) {
          const i = ++done;
          skipped++;
          sendProgress({ kind: 'status', key: 'smp.packFile', params: { i, n: indexFiles.length, file: path.basename(entry.path), size: '0' } });
          return;
        }

        const name = path.basename(entry.path);
        try {
          fs.mkdirSync(path.dirname(targetPath), { recursive: true });
          const { bytes } = await downloadModrinthFile(dlUrl, targetPath, {
            reason: 'modpack',
            sha1: entry.hashes?.sha1,
            expectedSize: Number(entry.fileSize) || 0,
            onProgress: (received, total) => {
              const percent = total > 0 ? Math.round((received / total) * 100) : 0;
              sendProgress({
                type: 'progress',
                percent,
                received,
                total,
                filename: `${name} (${done + 1}/${indexFiles.length})`,
              });
            },
          });
          const i = ++done;
          downloaded++;
          sendProgress({
            kind: 'status',
            key: 'smp.packFile',
            params: { i, n: indexFiles.length, file: name, size: (bytes / 1024 / 1024).toFixed(1) },
          });
        } catch (err) {
          const i = ++done;
          skipped++;
          const errMsg = err instanceof Error ? err.message : String(err);
          sendProgress({ kind: 'status', key: 'smp.packFileErr', params: { i, n: indexFiles.length, file: name, msg: errMsg } });
        }
      });
    }

    const deps = index.dependencies || {};
    if (deps.minecraft) inspect.gameVersion = String(deps.minecraft);
    const depKey = Object.keys(deps).find((k) => k !== 'minecraft');
    if (depKey) {
      inspect.loader = DEP_LOADER_MAP[depKey] || inspect.loader;
      inspect.loaderVersion = String(deps[depKey] || inspect.loaderVersion);
    }
  }

  // ===== CurseForge: докачка модов через каталог сайта =====
  if (inspect.format === 'curseforge') {
    const manifest = readJson(path.join(instanceDir, 'manifest.json')) || {};
    const files = Array.isArray(manifest.files) ? manifest.files : [];
    if (files.length) {
      sendProgress({ kind: 'status', key: 'import.cfDownloading', params: { n: files.length } });
      const modsDir = path.join(instanceDir, 'mods');
      fs.mkdirSync(modsDir, { recursive: true });
      let done = 0;
      await runWithConcurrency(files, PROXY_MAX_CONCURRENT_DOWNLOADS, async (entry: any) => {
        const projectId = Number(entry.projectID || entry.projectId);
        const fileId = Number(entry.fileID || entry.fileId);
        if (!projectId || !fileId) {
          skipped++;
          const i = ++done;
          sendProgress({ kind: 'status', key: 'smp.packFile', params: { i, n: files.length, file: '—', size: '0' } });
          return;
        }
        try {
          const meta = await resolveCurseFileViaCatalog(projectId, fileId);
          const fileName = meta?.filename
            || (await resolveCurseFileName(projectId, fileId))
            || `${fileId}.jar`;
          const dest = path.join(modsDir, path.basename(fileName));
          if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
            downloaded++;
            const i = ++done;
            sendProgress({ kind: 'status', key: 'smp.packFile', params: { i, n: files.length, file: fileName, size: '0' } });
            return;
          }

          if (meta?.url) {
            await downloadModrinthFile(meta.url, dest, {
              reason: 'modpack',
              expectedSize: meta.size,
              sha1: meta.sha1,
            });
          } else {
            // Запасной путь: прямой forgecdn (часто режется DPI)
            const url = forgeCdnUrl(fileId, fileName);
            await downloadModrinthFile(url, dest, { reason: 'modpack' });
          }
          downloaded++;
          const i = ++done;
          sendProgress({
            kind: 'status',
            key: 'smp.packFile',
            params: {
              i,
              n: files.length,
              file: fileName,
              size: meta?.size ? (meta.size / 1024 / 1024).toFixed(1) : '?',
            },
          });
        } catch (err) {
          skipped++;
          const i = ++done;
          const msg = err instanceof Error ? err.message : String(err);
          sendProgress({ kind: 'status', key: 'smp.packFileErr', params: { i, n: files.length, file: String(fileId), msg } });
        }
      });
    }
  }

  // ===== Инстанс / MultiMC / Prism =====
  if (inspect.format === 'instance' || inspect.format === 'unknown') {
    for (const nestedName of ['minecraft', '.minecraft']) {
      const nested = path.join(instanceDir, nestedName);
      if (fs.existsSync(nested) && fs.statSync(nested).isDirectory()) {
        mergeDirs(nested, instanceDir);
        try { fs.rmSync(winLongPath(nested), { recursive: true, force: true }); } catch {
          try { fs.rmSync(nested, { recursive: true, force: true }); } catch { /* ignore */ }
        }
      }
    }
    // Повторно смержить overrides, если они были внутри minecraft/
    mergeOverrideDirs(instanceDir, sendProgress);
  }

  // Гарантируем стандартные каталоги контента
  for (const d of ['mods', 'resourcepacks', 'shaderpacks', 'datapacks', 'config', 'saves', 'screenshots']) {
    fs.mkdirSync(winLongPath(path.join(instanceDir, d)), { recursive: true });
  }

  const worldsCount = countWorlds(path.join(instanceDir, 'saves'));
  if (worldsCount > 0) {
    sendProgress({ kind: 'status', key: 'import.worldsReady', params: { n: worldsCount } });
  }

  if (!inspect.loaderVersion && inspect.loader !== 'vanilla') {
    inspect.loaderVersion = defaultLoaderVersions?.[inspect.loader] || '';
  }
  if (!inspect.loaderVersion && inspect.format === 'modrinth') {
    const index = readJson(path.join(instanceDir, 'modrinth.index.json')) || {};
    const key = LOADER_DEP_KEYS[inspect.loader];
    if (key && index.dependencies?.[key]) inspect.loaderVersion = String(index.dependencies[key]);
  }

  // Перескан после всех копий/докачек
  const after = detectFromDir(instanceDir, archiveName);
  inspect = {
    ...after,
    name: inspect.name || after.name,
    gameVersion: inspect.gameVersion || after.gameVersion,
    loader: inspect.loader !== 'vanilla' ? inspect.loader : (after.loader || inspect.loader),
    loaderVersion: inspect.loaderVersion || after.loaderVersion,
  };
  const content = inventoryContent(instanceDir)!;
  inspect.fileCount = content.mods.length;
  inspect.hasOverrides = inspect.hasOverrides || countFiles(path.join(instanceDir, 'config')) > 0;

  sendProgress({
    kind: 'status',
    key: 'import.contentReady',
    params: {
      mods: content.mods.length,
      rp: content.resourcePacks.length,
      shaders: content.shaders.length,
      dp: content.dataPacks.length,
    },
  });

  let javaPath = '';
  if (inspect.gameVersion && resolveJavaPath) {
    try { javaPath = (await resolveJavaPath(inspect.gameVersion)) || ''; } catch { /* ignore */ }
  }

  const build = {
    id: buildId,
    name: inspect.name || archiveName.replace(/\.(mrpack|zip)$/i, ''),
    gameVersion: inspect.gameVersion || 'latest_release',
    loader: inspect.loader || 'vanilla',
    loaderVersion: inspect.loaderVersion || '',
    iconBg: BUILD_COLORS[Math.floor(Math.random() * BUILD_COLORS.length)],
    createdAt: Date.now(),
    javaPath,
    mods: content.mods,
    resourcePacks: content.resourcePacks,
    shaders: content.shaders,
    dataPacks: content.dataPacks,
  };

  const buildsPath = path.join(appDataDir, 'builds.json');
  let builds: any[] = [];
  try {
    if (fs.existsSync(buildsPath)) builds = JSON.parse(fs.readFileSync(buildsPath, 'utf-8'));
  } catch { builds = []; }
  if (!Array.isArray(builds)) builds = [];
  builds.push(build);
  fs.mkdirSync(path.dirname(buildsPath), { recursive: true });
  fs.writeFileSync(buildsPath, JSON.stringify(builds, null, 2), 'utf-8');

  sendProgress({
    type: 'done',
    filename: archiveName,
    filePath: instanceDir,
    buildCreated: true,
    build,
  });

  return {
    success: true,
    build,
    inspect,
    downloaded,
    skipped: skipped + extractSkipped.length + mergeSkipped.length,
    extractSkipped: extractSkipped.length || mergeSkipped.length
      ? [...extractSkipped, ...mergeSkipped]
      : undefined,
    incomplete: extractSkipped.length > 0 || mergeSkipped.length > 0 || skipped > 0,
    content,
  };
}
