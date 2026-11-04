// Каталоги лаунчера. Смена диска и свой путь сборки — только Windows.
import * as fs from 'fs';
import * as path from 'path';

const INSTANCE_BASE = 'uclient';

type InstanceLocationFile = {
  instancesDir?: string;
  overrides?: Record<string, string>;
};

function locationFilePath(): string {
  return path.join(getLauncherDataDir(), 'instance-location.json');
}

function readInstanceLocation(): InstanceLocationFile {
  if (process.platform !== 'win32') return {};
  try {
    const raw = fs.readFileSync(locationFilePath(), 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return {};
    return data as InstanceLocationFile;
  } catch {
    return {};
  }
}

function writeInstanceLocation(data: InstanceLocationFile): void {
  if (process.platform !== 'win32') return;
  const file = locationFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function driveExists(dir: string): boolean {
  if (process.platform !== 'win32') return false;
  const resolved = path.resolve(dir);
  const root = path.parse(resolved).root;
  if (!root) return false;
  try {
    return fs.existsSync(root);
  } catch {
    return false;
  }
}

export function sanitizeBuildId(buildId: string): string {
  return String(buildId || '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-]/g, '');
}

/**
 * Основной каталог пользовательских данных лаунчера:
 * Windows: %APPDATA%\.Undefined Client
 * macOS: ~/Library/Application Support/.Undefined Client
 * Linux: ~/.Undefined Client
 */
export function getLauncherDataDir(): string {
  if (process.platform === 'win32') {
    const base = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
    return path.join(base, '.Undefined Client');
  }
  if (process.platform === 'darwin') {
    return path.join(process.env.HOME || '', 'Library', 'Application Support', '.Undefined Client');
  }
  // Linux: XDG_DATA_HOME или ~/.local/share, с фоллбэком на ~/.Undefined Client
  const xdgData = process.env.XDG_DATA_HOME || path.join(process.env.HOME || '', '.local', 'share');
  return path.join(xdgData, 'undefined-client');
}

/**
 * Каталог инстансов без пользовательского переноса диска.
 * Windows: %APPDATA%\.uclient
 * macOS: ~/Library/Application Support/uclient
 * Linux: ~/.uclient — тот же каталог, куда eml-lib кладёт isolated-инстанс
 */
export function getBuiltinInstancesDir(): string {
  if (process.platform === 'win32') {
    const base = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
    return path.join(base, `.${INSTANCE_BASE}`);
  }
  if (process.platform === 'darwin') {
    return path.join(process.env.HOME || '', 'Library', 'Application Support', INSTANCE_BASE);
  }
  return path.join(process.env.HOME || '', `.${INSTANCE_BASE}`);
}

/**
 * Каталог хранения изолированных инстансов/сборок Minecraft.
 * На Windows может быть перенесён на другой диск.
 */
export function getInstancesDir(): string {
  if (process.platform === 'win32') {
    const custom = String(readInstanceLocation().instancesDir || '').trim();
    if (custom && path.isAbsolute(custom) && driveExists(custom)) return custom;
  }
  return getBuiltinInstancesDir();
}

/**
 * Корень конкретного изолированного инстанса сборки.
 */
export function getInstanceRoot(buildId: string): string {
  const sanitized = sanitizeBuildId(buildId);
  if (process.platform === 'win32') {
    const map = readInstanceLocation().overrides || {};
    const custom = String(map[sanitized] || map[buildId] || '').trim();
    if (custom && path.isAbsolute(custom) && driveExists(custom)) return custom;
  }
  return path.join(getInstancesDir(), sanitized);
}

/** Диски, которые сейчас есть в системе. На Linux не используется. */
export function listWindowsDrives(): Array<{ letter: string; path: string }> {
  if (process.platform !== 'win32') return [];
  const out: Array<{ letter: string; path: string }> = [];
  for (let code = 65; code <= 90; code++) {
    const letter = String.fromCharCode(code);
    const root = `${letter}:\\`;
    try {
      if (fs.existsSync(root)) out.push({ letter, path: root });
    } catch { /* диск недоступен */ }
  }
  return out;
}

/**
 * Новый каталог по умолчанию. Уже созданные сборки закрепляются на старом пути,
 * чтобы смена диска не «потеряла» их папки.
 */
export function setDefaultInstancesDir(dir: string, existingIds: string[]): { ok: boolean; error?: string; path?: string } {
  if (process.platform !== 'win32') return { ok: false, error: 'windows_only' };
  const target = path.resolve(String(dir || '').trim());
  if (!path.isAbsolute(target) || !driveExists(target)) return { ok: false, error: 'drive_missing' };
  const loc = readInstanceLocation();
  const overrides = { ...(loc.overrides || {}) };
  for (const id of existingIds) {
    const key = sanitizeBuildId(id);
    if (!key || overrides[key]) continue;
    overrides[key] = path.join(getInstancesDir(), key);
  }
  try {
    fs.mkdirSync(target, { recursive: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
  writeInstanceLocation({ instancesDir: target, overrides });
  return { ok: true, path: target };
}

export function setInstanceOverride(buildId: string, dir: string): void {
  if (process.platform !== 'win32') return;
  const key = sanitizeBuildId(buildId);
  if (!key) return;
  const loc = readInstanceLocation();
  const overrides = { ...(loc.overrides || {}) };
  overrides[key] = path.resolve(dir);
  writeInstanceLocation({ ...loc, overrides });
}

export function clearInstanceOverride(buildId: string): void {
  if (process.platform !== 'win32') return;
  const key = sanitizeBuildId(buildId);
  if (!key) return;
  const loc = readInstanceLocation();
  const overrides = { ...(loc.overrides || {}) };
  if (!overrides[key] && !overrides[buildId]) return;
  delete overrides[key];
  delete overrides[buildId];
  writeInstanceLocation({ ...loc, overrides });
}

// Общие каталоги eml в корне .uclient. Это кэш клиента, не папки сборок.
const SHARED_INSTANCE_DIR_NAMES = new Set([
  'assets',
  'bin',
  'versions',
  'libraries',
  'natives',
  'runtime',
  'cache',
]);

const INSTANCE_DIR_MARKERS = [
  'mods',
  'saves',
  'config',
  'options.txt',
  '.uclient-cache.json',
  'modrinth.index.json',
  'mmc-pack.json',
  'instance.cfg',
];

// Свежую папку не трогаем при зачистке: установка могла ещё не записать builds.json.
const ORPHAN_FRESH_MS = 90_000;

function instanceParents(): string[] {
  return [...new Set([
    path.resolve(getBuiltinInstancesDir()),
    path.resolve(getInstancesDir()),
  ])];
}

/** Каталог можно удалить, только если это папка одной сборки, а не корень диска и не весь .uclient. */
function safeInstanceFolder(dir: string, key: string): string | null {
  const resolved = path.resolve(String(dir || ''));
  const parsed = path.parse(resolved);
  if (!key || !parsed.root || resolved === parsed.root) return null;
  if (path.basename(resolved).toLowerCase() !== key.toLowerCase()) return null;
  if (SHARED_INSTANCE_DIR_NAMES.has(key.toLowerCase())) return null;
  const parent = path.resolve(path.dirname(resolved));
  if (instanceParents().includes(parent)) return resolved;
  if (process.platform === 'win32') {
    const recorded = String((readInstanceLocation().overrides || {})[key] || '').trim();
    if (recorded && path.resolve(recorded) === resolved) return resolved;
  }
  return null;
}

async function rmInstanceFolder(dir: string): Promise<void> {
  await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}

/** Удаляет папку сборки (стандартный путь и Windows-override) и забывает override. */
export async function deleteBuildInstance(buildId: string): Promise<{ ok: boolean; error?: string }> {
  const key = sanitizeBuildId(buildId);
  if (!key) return { ok: false, error: 'bad_id' };
  const candidates = [
    path.join(getBuiltinInstancesDir(), key),
    path.join(getInstancesDir(), key),
  ];
  if (process.platform === 'win32') {
    const map = readInstanceLocation().overrides || {};
    const custom = String(map[key] || map[buildId] || '').trim();
    if (custom) candidates.push(custom);
  }
  const targets = new Set<string>();
  for (const candidate of candidates) {
    const safe = safeInstanceFolder(candidate, key);
    if (!safe) continue;
    try {
      const st = await fs.promises.stat(safe);
      if (!st.isDirectory()) continue;
    } catch {
      continue;
    }
    targets.add(safe);
  }
  for (const dir of targets) {
    try {
      await rmInstanceFolder(dir);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  }
  clearInstanceOverride(buildId);
  return { ok: true };
}

function isLauncherInstanceSlug(name: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name)
    || /^import-[a-f0-9]+$/i.test(name);
}

async function folderLooksLikeInstance(dir: string): Promise<boolean> {
  for (const marker of INSTANCE_DIR_MARKERS) {
    try {
      await fs.promises.access(path.join(dir, marker));
      return true;
    } catch { /* маркера нет */ }
  }
  return false;
}

/**
 * Удаляет папки сборок, которых уже нет в списке.
 * assets/bin/versions в корне .uclient не трогает.
 */
export async function sweepOrphanInstances(
  keepIds: string[],
  refreshKeepIds?: () => string[],
): Promise<void> {
  const keep = new Set<string>();
  const add = (ids: string[]) => {
    for (const id of ids) {
      const key = sanitizeBuildId(id);
      if (key) keep.add(key);
    }
  };
  add(keepIds);

  for (const parent of instanceParents()) {
    let names: string[] = [];
    try {
      names = await fs.promises.readdir(parent);
    } catch {
      continue;
    }
    for (const name of names) {
      if (refreshKeepIds) add(refreshKeepIds());
      const low = name.toLowerCase();
      if (SHARED_INSTANCE_DIR_NAMES.has(low) || keep.has(low)) continue;
      const full = path.join(parent, name);
      let st: fs.Stats;
      try {
        st = await fs.promises.stat(full);
      } catch {
        continue;
      }
      if (!st.isDirectory()) continue;
      if (Date.now() - st.mtimeMs < ORPHAN_FRESH_MS) continue;
      if (!isLauncherInstanceSlug(name) && !(await folderLooksLikeInstance(full))) continue;
      const safe = safeInstanceFolder(full, name);
      if (!safe) continue;
      try {
        await rmInstanceFolder(safe);
      } catch (err) {
        console.warn('[instances] не удалось удалить папку сборки', safe, err);
      }
    }
  }

  if (process.platform !== 'win32') return;
  if (refreshKeepIds) add(refreshKeepIds());
  const loc = readInstanceLocation();
  const overrides = { ...(loc.overrides || {}) };
  let changed = false;
  for (const [key, dir] of Object.entries(overrides)) {
    if (keep.has(key)) continue;
    const safe = safeInstanceFolder(String(dir || ''), key);
    if (safe) {
      try {
        const st = await fs.promises.stat(safe);
        if (st.isDirectory() && Date.now() - st.mtimeMs < ORPHAN_FRESH_MS) continue;
        if (st.isDirectory()) await rmInstanceFolder(safe);
      } catch { /* папки уже нет */ }
    }
    delete overrides[key];
    changed = true;
  }
  if (changed) writeInstanceLocation({ ...loc, overrides });
}

export function defaultInstanceParentForDrive(letterOrPath: string): string {
  const raw = String(letterOrPath || '').trim();
  if (/^[A-Za-z]:\\?$/.test(raw)) {
    const letter = raw[0].toUpperCase();
    return path.join(`${letter}:\\`, 'Undefined Client', 'instances');
  }
  return path.resolve(raw);
}

/**
 * Стандартный каталог .minecraft (для импорта миров, версий и текстур):
 * Windows: %APPDATA%\.minecraft
 * macOS: ~/Library/Application Support/minecraft
 * Linux: ~/.minecraft
 */
export function getDefaultMinecraftDir(): string {
  if (process.platform === 'win32') {
    const base = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
    return path.join(base, '.minecraft');
  }
  if (process.platform === 'darwin') {
    return path.join(process.env.HOME || '', 'Library', 'Application Support', 'minecraft');
  }
  return path.join(process.env.HOME || '', '.minecraft');
}
