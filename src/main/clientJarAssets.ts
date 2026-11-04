import { app, ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import AdmZip from 'adm-zip';
import { getInstancesDir, getDefaultMinecraftDir, getLauncherDataDir } from './paths';
import { catalogIcons, loadCommandCatalog } from './commandCatalog';

const BLOCK_PREFIX = 'assets/minecraft/textures/block/';

/** Кандидаты пути к client jar для строки версии (26.2, 1.21.6, …). */
export function findClientJar(gameVersion: string): string | null {
  const ver = String(gameVersion || '').trim();
  if (!ver || ver === 'latest_release' || ver === 'latest_snapshot') return null;

  const root = getInstancesDir();
  const mcDir = getDefaultMinecraftDir();
  const candidates: string[] = [
    path.join(root, 'versions', ver, `${ver}.jar`),
    path.join(mcDir, 'versions', ver, `${ver}.jar`),
  ];

  try {
    for (const id of fs.readdirSync(root)) {
      if (id === 'versions' || id === 'bin' || id === 'assets') continue;
      candidates.push(path.join(root, id, 'versions', ver, `${ver}.jar`));
    }
  } catch { /* нет instances dir */ }

  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).size > 1_000_000) return c;
    } catch { /* */ }
  }
  return null;
}

function textureCacheDir(gameVersion: string, jarPath: string): string {
  const hash = crypto.createHash('sha1').update(jarPath).update(String(fs.statSync(jarPath).mtimeMs)).digest('hex').slice(0, 10);
  let userData: string;
  try {
    userData = app.getPath('userData');
  } catch {
    userData = getLauncherDataDir();
  }
  return path.join(userData, 'cache', 'block-textures', `${gameVersion}-${hash}`);
}

export interface BlockTextureMap {
  ok: boolean;
  jarPath?: string;
  /** Имя текстуры без пути (stone, oak_leaves) → data URL PNG */
  textures: Record<string, string>;
  count: number;
  error?: string;
}

/**
 * Достаёт PNG блоков из jar. Кэширует распакованные файлы на диск,
 * в IPC отдаёт data URL (удобно для customTextures мешера).
 */
export function extractBlockTextures(gameVersion: string, jarPathHint?: string): BlockTextureMap {
  const jarPath = (jarPathHint && fs.existsSync(jarPathHint) ? jarPathHint : null)
    || findClientJar(gameVersion);
  if (!jarPath) {
    return { ok: false, textures: {}, count: 0, error: `Jar версии ${gameVersion} не найден` };
  }

  try {
    const cache = textureCacheDir(gameVersion, jarPath);
    const metaPath = path.join(cache, '_meta.json');
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as { names: string[] };
      const textures: Record<string, string> = {};
      for (const name of meta.names || []) {
        const file = path.join(cache, `${name}.png`);
        if (!fs.existsSync(file)) continue;
        textures[name] = `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
      }
      if (Object.keys(textures).length > 0) {
        return { ok: true, jarPath, textures, count: Object.keys(textures).length };
      }
    }

    fs.mkdirSync(cache, { recursive: true });
    const zip = new AdmZip(jarPath);
    const textures: Record<string, string> = {};
    const names: string[] = [];

    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      const n = entry.entryName.replace(/\\/g, '/');
      if (!n.startsWith(BLOCK_PREFIX) || !n.endsWith('.png')) continue;
      // Без анимаций *_n.png / *_s.png иногда нужны — берём все простые PNG.
      if (n.includes('/')) {
        const base = n.slice(BLOCK_PREFIX.length);
        if (base.includes('/')) continue; // только корень block/
        const name = base.replace(/\.png$/i, '');
        if (!name || name.includes('.')) continue;
        const data = entry.getData();
        fs.writeFileSync(path.join(cache, `${name}.png`), data);
        textures[name] = `data:image/png;base64,${data.toString('base64')}`;
        names.push(name);
      }
    }

    fs.writeFileSync(metaPath, JSON.stringify({ jarPath, names, ts: Date.now() }));
    return { ok: true, jarPath, textures, count: names.length };
  } catch (e: any) {
    return { ok: false, textures: {}, count: 0, error: e?.message || String(e), jarPath };
  }
}

function collectClientJars(): Array<{ version: string; jarPath: string }> {
  const roots = [path.join(getInstancesDir(), 'versions'), path.join(getDefaultMinecraftDir(), 'versions')];
  try {
    for (const id of fs.readdirSync(getInstancesDir())) {
      roots.push(path.join(getInstancesDir(), id, 'versions'));
    }
  } catch { /* каталога сборок нет */ }
  const found: Array<{ version: string; jarPath: string }> = [];
  for (const root of roots) {
    let versions: string[] = [];
    try { versions = fs.readdirSync(root); } catch { continue; }
    for (const version of versions) {
      const jarPath = path.join(root, version, `${version}.jar`);
      try {
        if (fs.statSync(jarPath).size > 1_000_000) found.push({ version, jarPath });
      } catch { /* нет jar */ }
    }
  }
  return found;
}

export function findNearestClientJar(preferred: string): { version: string; jarPath: string } | null {
  const exact = findClientJar(preferred);
  if (exact) return { version: preferred || path.basename(exact, '.jar'), jarPath: exact };
  const jars = collectClientJars();
  if (!jars.length) return null;
  jars.sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }));
  return jars[jars.length - 1];
}

export function registerClientJarIpc(): void {
  ipcMain.handle('world:find-client-jar', (_e, gameVersion: string) => findClientJar(String(gameVersion || '')));
  ipcMain.handle('world:block-textures', (_e, gameVersion: string, jarPath?: string) =>
    extractBlockTextures(String(gameVersion || ''), typeof jarPath === 'string' ? jarPath : undefined));
  ipcMain.handle('command-catalog:get', (_e, gameVersion: string) => {
    const jar = findNearestClientJar(String(gameVersion || ''));
    if (!jar) return { ok: false, version: gameVersion, error: 'Клиентский jar не найден', items: [], blocks: [], entities: [], effects: [], enchantments: [], biomes: [], structures: [], particles: [], attributes: [], features: [], damageTypes: [] };
    try {
      return loadCommandCatalog(jar.jarPath, jar.version);
    } catch (err) {
      return { ok: false, version: gameVersion, error: err instanceof Error ? err.message : String(err), items: [], blocks: [], entities: [], effects: [], enchantments: [], biomes: [], structures: [], particles: [], attributes: [], features: [], damageTypes: [] };
    }
  });
  ipcMain.handle('command-catalog:icons', (_e, gameVersion: string, ids: string[]) => {
    const jar = findNearestClientJar(String(gameVersion || ''));
    if (!jar) return {};
    try {
      return catalogIcons(jar.jarPath, jar.version, Array.isArray(ids) ? ids.slice(0, 64) : []);
    } catch {
      return {};
    }
  });
}
