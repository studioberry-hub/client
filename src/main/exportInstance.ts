// Назначение: экспорт сборки в ZIP (Prism/другие лаунчеры) и .mrpack (Modrinth App).

import { BrowserWindow, dialog, ipcMain, app } from 'electron';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { getInstanceRoot } from './launcher';

const USER_AGENT = 'Undefined-Client';

/** Каталоги/файлы, которые кладём в экспорт (без библиотек игры и миров). */
const EXPORT_DIRS = [
  'mods',
  'resourcepacks',
  'shaderpacks',
  'datapacks',
  'config',
  'defaultconfigs',
  'kubejs',
  'scripts',
  'schematics',
];
const EXPORT_FILES = ['options.txt', 'optionsof.txt', 'optionsshaders.txt', 'servers.dat'];

const LOADER_UID: Record<string, string> = {
  fabric: 'net.fabricmc.fabric-loader',
  quilt: 'org.quiltmc.quilt-loader',
  forge: 'net.minecraftforge',
  neoforge: 'net.neoforged',
};

const LOADER_DEP_KEY: Record<string, string> = {
  fabric: 'fabric-loader',
  quilt: 'quilt-loader',
  forge: 'forge',
  neoforge: 'neoforge',
};

type ProgressFn = (data: Record<string, unknown>) => void;

function sendProgress(win: BrowserWindow | null, data: Record<string, unknown>): void {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('instance-export:progress', data);
}

function buildsPath(): string {
  return path.join(process.env.APPDATA || process.cwd(), '.Undefined Client', 'builds.json');
}

function readBuild(buildId: string): any | null {
  try {
    const builds = JSON.parse(fs.readFileSync(buildsPath(), 'utf-8'));
    if (!Array.isArray(builds)) return null;
    return builds.find((b: any) => b?.id === buildId) || null;
  } catch {
    return null;
  }
}

function sanitizePackFolderName(name: string): string {
  const cleaned = String(name || 'Instance')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return cleaned || 'Instance';
}

function hashFile(filePath: string): Promise<{ sha1: string; sha512: string; size: number }> {
  return new Promise((resolve, reject) => {
    const sha1 = crypto.createHash('sha1');
    const sha512 = crypto.createHash('sha512');
    const stream = fs.createReadStream(filePath);
    let size = 0;
    stream.on('data', (chunk: string | Buffer) => {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      size += buf.length;
      sha1.update(buf);
      sha512.update(buf);
    });
    stream.on('error', reject);
    stream.on('end', () =>
      resolve({ sha1: sha1.digest('hex'), sha512: sha512.digest('hex'), size }),
    );
  });
}

async function lookupModrinthDownload(
  sha1: string,
): Promise<{ url: string; filename: string } | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(
      `https://api.modrinth.com/v2/version_file/${sha1}?algorithm=sha1`,
      { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: ctrl.signal },
    );
    if (!res.ok) return null;
    const data = await res.json() as {
      files?: { url?: string; filename?: string; primary?: boolean; hashes?: { sha1?: string } }[];
    };
    const primary =
      data.files?.find((f) => f.primary)
      || data.files?.find((f) => f.hashes?.sha1 === sha1)
      || data.files?.[0];
    if (!primary?.url) return null;
    return { url: String(primary.url), filename: String(primary.filename || '') };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Резолв иконки сборки в буфер PNG/JPEG (если возможно). */
function resolveIconBuffer(icon: string | undefined): Buffer | null {
  if (!icon) {
    try {
      const fallback = path.join(app.getAppPath(), 'assets', 'InstancesIcons', 'newBuild.png');
      if (fs.existsSync(fallback)) return fs.readFileSync(fallback);
    } catch { /* ignore */ }
    return null;
  }
  if (icon.startsWith('preset:')) {
    const name = icon.slice(7).replace(/[/\\]/g, '');
    const candidates = [
      path.join(app.getAppPath(), 'assets', 'InstancesIcons', name),
      path.join(process.cwd(), 'assets', 'InstancesIcons', name),
    ];
    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) return fs.readFileSync(p);
      } catch { /* ignore */ }
    }
    return null;
  }
  if (icon.startsWith('data:')) {
    const m = icon.match(/^data:[^;]+;base64,(.+)$/);
    if (!m) return null;
    try {
      return Buffer.from(m[1], 'base64');
    } catch {
      return null;
    }
  }
  if (icon.startsWith('modrinth:')) return null;
  try {
    if (fs.existsSync(icon) && fs.statSync(icon).isFile()) return fs.readFileSync(icon);
  } catch { /* ignore */ }
  return null;
}

function walkFiles(dir: string, base = dir): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full, base));
    else if (entry.isFile()) out.push(path.relative(base, full));
  }
  return out;
}

function collectExportRelPaths(instanceRoot: string): string[] {
  const rels: string[] = [];
  for (const dir of EXPORT_DIRS) {
    const abs = path.join(instanceRoot, dir);
    if (!fs.existsSync(abs)) continue;
    for (const rel of walkFiles(abs)) {
      rels.push(path.join(dir, rel).replace(/\\/g, '/'));
    }
  }
  for (const file of EXPORT_FILES) {
    const abs = path.join(instanceRoot, file);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) rels.push(file);
  }
  return rels;
}

function buildMmcPackJson(build: any): object {
  const components: { uid: string; version: string }[] = [];
  const mc = String(build.gameVersion || '').trim();
  if (mc) components.push({ uid: 'net.minecraft', version: mc });
  const loader = String(build.loader || 'vanilla').toLowerCase();
  const loaderVer = String(build.loaderVersion || '').trim();
  const uid = LOADER_UID[loader];
  if (uid && loaderVer) components.push({ uid, version: loaderVer });
  return { components, formatVersion: 1 };
}

function buildInstanceCfg(build: any): string {
  const lines = [
    'InstanceType=OneSix',
    `name=${String(build.name || 'Instance').replace(/\r?\n/g, ' ')}`,
    'iconKey=icon',
  ];
  if (build.gameVersion) lines.push(`IntendedVersion=${build.gameVersion}`);
  return `${lines.join('\n')}\n`;
}

async function pickSavePath(
  win: BrowserWindow | null,
  defaultName: string,
  filters: Electron.FileFilter[],
): Promise<string | null> {
  const opts: Electron.SaveDialogOptions = {
    title: 'Экспорт сборки',
    defaultPath: defaultName,
    filters,
  };
  const result = win && !win.isDestroyed()
    ? await dialog.showSaveDialog(win, opts)
    : await dialog.showSaveDialog(opts);
  if (result.canceled || !result.filePath) return null;
  return result.filePath;
}

/** ZIP: Prism/MultiMC-совместимый инстанс + контент. */
async function exportZip(
  buildId: string,
  win: BrowserWindow | null,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const build = readBuild(buildId);
  if (!build) return { ok: false, error: 'build_not_found' };
  const root = getInstanceRoot(buildId);
  if (!fs.existsSync(root)) return { ok: false, error: 'instance_missing' };

  const packName = sanitizePackFolderName(build.name);
  const savePath = await pickSavePath(win, `${packName}.zip`, [
    { name: 'ZIP', extensions: ['zip'] },
  ]);
  if (!savePath) return { ok: false, error: 'cancelled' };

  sendProgress(win, { phase: 'prepare', current: 0, total: 0 });
  const rels = collectExportRelPaths(root);
  const zip = new AdmZip();
  const prefix = `${packName}/`;

  zip.addFile(`${prefix}instance.cfg`, Buffer.from(buildInstanceCfg(build), 'utf-8'));
  zip.addFile(`${prefix}mmc-pack.json`, Buffer.from(JSON.stringify(buildMmcPackJson(build), null, 2), 'utf-8'));

  const iconBuf = resolveIconBuffer(build.icon);
  if (iconBuf) zip.addFile(`${prefix}icon.png`, iconBuf);

  let done = 0;
  for (const rel of rels) {
    const abs = path.join(root, ...rel.split('/'));
    try {
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
      const data = fs.readFileSync(abs);
      // Prism: контент в minecraft/
      zip.addFile(`${prefix}minecraft/${rel}`, data);
    } catch {
      /* skip broken file */
    }
    done += 1;
    sendProgress(win, { phase: 'pack', current: done, total: rels.length, filename: rel });
  }

  try {
    zip.writeZip(savePath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `write_failed:${msg}` };
  }
  sendProgress(win, { phase: 'done', path: savePath });
  return { ok: true, path: savePath };
}

/** .mrpack: индекс Modrinth + overrides для локальных файлов. */
async function exportMrpack(
  buildId: string,
  win: BrowserWindow | null,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const build = readBuild(buildId);
  if (!build) return { ok: false, error: 'build_not_found' };
  const root = getInstanceRoot(buildId);
  if (!fs.existsSync(root)) return { ok: false, error: 'instance_missing' };

  const packName = sanitizePackFolderName(build.name);
  const savePath = await pickSavePath(win, `${packName}.mrpack`, [
    { name: 'Modrinth pack', extensions: ['mrpack'] },
    { name: 'ZIP', extensions: ['zip'] },
  ]);
  if (!savePath) return { ok: false, error: 'cancelled' };

  sendProgress(win, { phase: 'prepare', current: 0, total: 0 });
  const rels = collectExportRelPaths(root);
  const zip = new AdmZip();
  const indexFiles: any[] = [];

  let done = 0;
  for (const rel of rels) {
    const abs = path.join(root, ...rel.split('/'));
    try {
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
      const { sha1, sha512, size } = await hashFile(abs);
      sendProgress(win, {
        phase: 'resolve',
        current: done + 1,
        total: rels.length,
        filename: rel,
      });
      const mr = await lookupModrinthDownload(sha1);
      if (mr?.url) {
        indexFiles.push({
          path: rel,
          hashes: { sha1, sha512 },
          downloads: [mr.url],
          fileSize: size,
          env: { client: 'required', server: 'optional' },
        });
      } else {
        // Локальный / CF / кастом — в overrides
        zip.addFile(`overrides/${rel}`, fs.readFileSync(abs));
      }
    } catch {
      /* skip */
    }
    done += 1;
  }

  const deps: Record<string, string> = {};
  if (build.gameVersion) deps.minecraft = String(build.gameVersion);
  const loader = String(build.loader || 'vanilla').toLowerCase();
  const depKey = LOADER_DEP_KEY[loader];
  if (depKey && build.loaderVersion) deps[depKey] = String(build.loaderVersion);

  const index = {
    formatVersion: 1,
    game: 'minecraft',
    versionId: String(build.loaderVersion || build.gameVersion || '1'),
    name: String(build.name || packName),
    summary: `Exported from Undefined Client`,
    files: indexFiles,
    dependencies: deps,
  };
  zip.addFile('modrinth.index.json', Buffer.from(JSON.stringify(index, null, 2), 'utf-8'));

  const iconBuf = resolveIconBuffer(build.icon);
  if (iconBuf) zip.addFile('overrides/icon.png', iconBuf);

  try {
    zip.writeZip(savePath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `write_failed:${msg}` };
  }
  sendProgress(win, { phase: 'done', path: savePath });
  return { ok: true, path: savePath };
}

export function registerInstanceExportIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('instance-export:zip', async (_event, buildId: string) => {
    try {
      return await exportZip(String(buildId || ''), getWindow());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }
  });

  ipcMain.handle('instance-export:mrpack', async (_event, buildId: string) => {
    try {
      return await exportMrpack(String(buildId || ''), getWindow());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }
  });
}
