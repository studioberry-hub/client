// Поиск установленных лаунчеров и импорт их сборок без баз аккаунтов и токенов.
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { createRequire } from 'module';
import { getInstanceRoot, getLauncherDataDir } from './paths';

const nodeRequire = createRequire(__filename);

export type ExternalInstanceInfo = {
  id: string;
  name: string;
  gameVersion: string;
  loader: string;
  loaderVersion: string;
  iconDataUrl?: string;
  gameDir: string;
  sourceDir: string;
  memory?: { min: number; max: number };
  jvmArgs?: string;
  javaPath?: string;
};

export type ExternalLauncherInfo = {
  id: string;
  name: string;
  root: string;
  iconDataUrl?: string;
  instances: ExternalInstanceInfo[];
};

type ProgressFn = (data: any) => void;

const CONTENT_DIRS = [
  'mods',
  'resourcepacks',
  'shaderpacks',
  'datapacks',
  'config',
  'defaultconfigs',
  'saves',
  'kubejs',
  'scripts',
  'schematics',
];

const CONTENT_FILES = ['options.txt', 'optionsof.txt', 'servers.dat', 'servers.dat_old'];

const SKIP_DIR = /^(accounts|libraries|versions|assets|runtime|cache|caches|logs|crash-reports|webcache|natives|meta)$/i;
const SKIP_FILE = /^(accounts\.json|launcher_accounts\.json|launcher_profiles\.json|microsoft_store\.json|usercache\.json)$/i;

function home(): string {
  return process.env.HOME || process.env.USERPROFILE || '';
}

function appData(): string {
  return process.env.APPDATA || path.join(home(), 'AppData', 'Roaming');
}

function xdgData(): string {
  return process.env.XDG_DATA_HOME || path.join(home(), '.local', 'share');
}

function xdgConfig(): string {
  return process.env.XDG_CONFIG_HOME || path.join(home(), '.config');
}

function existsDir(p: string): boolean {
  try {
    return !!p && fs.existsSync(p) && fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function readJson(file: string): any | null {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function readCfg(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const text = fs.readFileSync(file, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([^#=][^=]*)=(.*)$/);
      if (!m) continue;
      out[m[1].trim()] = m[2].trim();
    }
  } catch { /* нет файла */ }
  return out;
}

function iconDataUrl(filePath: string): string | undefined {
  try {
    if (!filePath || !fs.existsSync(filePath)) return undefined;
    const st = fs.statSync(filePath);
    if (!st.isFile() || st.size <= 0 || st.size > 1_200_000) return undefined;
    const ext = path.extname(filePath).toLowerCase();
    const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
      : ext === '.webp' ? 'image/webp'
        : ext === '.gif' ? 'image/gif'
          : ext === '.svg' ? 'image/svg+xml'
            : 'image/png';
    const buf = fs.readFileSync(filePath);
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return undefined;
  }
}

function firstExisting(paths: string[]): string {
  for (const p of paths) {
    if (existsDir(p)) return p;
  }
  return '';
}

/** Каталоги userData XMCL, установленного через appinstaller / MSIX. */
function xmclWindowsPackageDirs(): string[] {
  if (process.platform !== 'win32') return [];
  const local = process.env.LOCALAPPDATA || path.join(home(), 'AppData', 'Local');
  const packages = path.join(local, 'Packages');
  if (!existsDir(packages)) return [];
  const out: string[] = [];
  let names: string[] = [];
  try {
    names = fs.readdirSync(packages);
  } catch {
    return out;
  }
  for (const name of names) {
    if (!/^xmcl_/i.test(name)) continue;
    const data = path.join(packages, name, 'LocalCache', 'Roaming', 'xmcl');
    if (existsDir(data)) out.push(data);
  }
  return out;
}

function candidateRoots(id: string): string[] {
  const h = home();
  const roaming = appData();
  const data = xdgData();
  const cfg = xdgConfig();
  const flatpak = path.join(h, '.var', 'app');
  if (id === 'prism') {
    return [
      path.join(roaming, 'PrismLauncher'),
      path.join(data, 'PrismLauncher'),
      path.join(h, '.local', 'share', 'PrismLauncher'),
      path.join(flatpak, 'org.prismlauncher.PrismLauncher', 'data', 'PrismLauncher'),
      path.join(h, 'Library', 'Application Support', 'PrismLauncher'),
    ];
  }
  if (id === 'pinecone') {
    // ElyPrismLauncher — форк Prism (PineconeMC). Не путать с каталогом PrismLauncher.
    return [
      path.join(roaming, 'ElyPrismLauncher'),
      path.join(roaming, 'PineconeMC'),
      path.join(roaming, 'Pinecone'),
      path.join(data, 'ElyPrismLauncher'),
      path.join(data, 'PineconeMC'),
      path.join(h, '.local', 'share', 'ElyPrismLauncher'),
      path.join(flatpak, 'org.prismlauncher.ElyPrismLauncher', 'data', 'ElyPrismLauncher'),
      path.join(h, 'Library', 'Application Support', 'ElyPrismLauncher'),
    ];
  }
  if (id === 'multimc') {
    return [
      path.join(roaming, 'MultiMC'),
      path.join(data, 'MultiMC'),
      path.join(data, 'multimc'),
      path.join(h, 'MultiMC'),
      path.join(h, '.local', 'share', 'multimc'),
    ];
  }
  if (id === 'modrinth') {
    return [
      path.join(roaming, 'com.modrinth.theseus'),
      path.join(roaming, 'ModrinthApp'),
      path.join(data, 'com.modrinth.theseus'),
      path.join(data, 'ModrinthApp'),
      path.join(flatpak, 'com.modrinth.theseus', 'data', 'com.modrinth.theseus'),
      path.join(h, 'Library', 'Application Support', 'com.modrinth.theseus'),
    ];
  }
  if (id === 'millida') {
    // Tauri-идентификатор net.millida.launcher. Local\Millida Launcher — только exe, не сборки.
    return [
      path.join(roaming, 'net.millida.launcher'),
      path.join(data, 'net.millida.launcher'),
      path.join(h, '.local', 'share', 'net.millida.launcher'),
      path.join(flatpak, 'net.millida.launcher', 'data', 'net.millida.launcher'),
      path.join(roaming, 'millida'),
      path.join(roaming, 'Millida'),
      path.join(roaming, 'com.millida.launcher'),
      path.join(data, 'millida'),
      path.join(cfg, 'millida'),
      path.join(h, '.millida'),
    ];
  }
  if (id === 'curseforge') {
    return [
      path.join(h, 'curseforge', 'minecraft'),
      path.join(roaming, 'CurseForge'),
      path.join(data, 'curseforge'),
      path.join(flatpak, 'com.curseforge.CurseForge', 'data', 'curseforge', 'minecraft'),
      path.join(h, '.curseforge', 'minecraft'),
    ];
  }
  if (id === 'atlauncher') {
    return [
      path.join(roaming, 'ATLauncher'),
      path.join(h, '.atlauncher'),
      path.join(data, 'ATLauncher'),
      path.join(cfg, 'ATLauncher'),
    ];
  }
  if (id === 'xmcl') {
    // AppX кладёт userData в Packages\xmcl_*\LocalCache, а не в %APPDATA%\xmcl.
    return [
      ...xmclWindowsPackageDirs(),
      path.join(roaming, 'xmcl'),
      path.join(roaming, 'XMCL'),
      path.join(roaming, 'x-minecraft-launcher'),
      path.join(data, 'xmcl'),
      path.join(h, '.xmcl'),
      path.join(h, '.minecraftx'),
      path.join(cfg, 'xmcl'),
      path.join(h, 'Library', 'Application Support', 'xmcl'),
    ];
  }
  if (id === 'gdlauncher') {
    return [
      path.join(roaming, 'gdlauncher_next'),
      path.join(roaming, 'gdlauncher'),
      path.join(data, 'gdlauncher_next'),
      path.join(cfg, 'gdlauncher_next'),
      path.join(h, '.gdlauncher'),
    ];
  }
  return [];
}

const LAUNCHERS: Array<{ id: string; name: string }> = [
  { id: 'prism', name: 'Prism Launcher' },
  { id: 'pinecone', name: 'PineconeMC' },
  { id: 'modrinth', name: 'Modrinth App' },
  { id: 'millida', name: 'Millida Launcher' },
  { id: 'curseforge', name: 'CurseForge' },
  { id: 'multimc', name: 'MultiMC' },
  { id: 'atlauncher', name: 'ATLauncher' },
  { id: 'xmcl', name: 'XMCL' },
  { id: 'gdlauncher', name: 'GDLauncher' },
];

function parseLoaderToken(raw: string): { loader: string; loaderVersion: string } {
  const text = String(raw || '').trim();
  const m = text.match(/^(fabric|quilt|forge|neoforge)[-:](.+)$/i);
  if (m) return { loader: m[1].toLowerCase(), loaderVersion: m[2] };
  const low = text.toLowerCase();
  if (low.includes('neoforge')) return { loader: 'neoforge', loaderVersion: '' };
  if (low.includes('fabric')) return { loader: 'fabric', loaderVersion: '' };
  if (low.includes('quilt')) return { loader: 'quilt', loaderVersion: '' };
  if (low.includes('forge')) return { loader: 'forge', loaderVersion: '' };
  return { loader: 'vanilla', loaderVersion: '' };
}

function loaderFromMmc(mmc: any): { loader: string; loaderVersion: string; gameVersion: string } {
  const comps = Array.isArray(mmc?.components) ? mmc.components : [];
  const uidOf = (c: any) => String(c?.uid || '').toLowerCase();
  const mc = comps.find((c: any) => c?.uid === 'net.minecraft');
  // intermediary тоже содержит «fabric», но это не загрузчик.
  const fabric = comps.find((c: any) => uidOf(c) === 'net.fabricmc.fabric-loader' || uidOf(c).endsWith('fabric-loader'));
  const quilt = comps.find((c: any) => uidOf(c).includes('quilt-loader'));
  const neo = comps.find((c: any) => uidOf(c).includes('neoforge') || uidOf(c) === 'net.neoforged');
  const forge = comps.find((c: any) => {
    const uid = uidOf(c);
    return (uid.includes('minecraftforge') || uid === 'net.minecraftforge') && !uid.includes('neoforge');
  });
  let loader = 'vanilla';
  let loaderVersion = '';
  if (fabric) { loader = 'fabric'; loaderVersion = String(fabric.version || ''); }
  else if (quilt) { loader = 'quilt'; loaderVersion = String(quilt.version || ''); }
  else if (neo) { loader = 'neoforge'; loaderVersion = String(neo.version || ''); }
  else if (forge) { loader = 'forge'; loaderVersion = String(forge.version || ''); }
  return { loader, loaderVersion, gameVersion: String(mc?.version || '') };
}

function memoryFromNumbers(minRaw: unknown, maxRaw: unknown): { min: number; max: number } | undefined {
  const min = Number(minRaw);
  const max = Number(maxRaw);
  if (!Number.isFinite(max) || max <= 0) return undefined;
  return { min: Number.isFinite(min) && min > 0 ? min : Math.min(512, max), max };
}

function gameDirOf(instanceDir: string): string {
  const minecraft = path.join(instanceDir, 'minecraft');
  const dot = path.join(instanceDir, '.minecraft');
  if (existsDir(minecraft)) return minecraft;
  if (existsDir(dot)) return dot;
  return instanceDir;
}

function fileExists(p: string): boolean {
  try {
    return !!p && fs.existsSync(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Иконка сборки Prism: icon.png инстанса, затем iconKey в папке icons (часто .webp). */
function findIconFile(dir: string, iconKey?: string, launcherRoot?: string): string {
  const local = [
    path.join(dir, 'icon.png'),
    path.join(dir, 'icon.webp'),
    path.join(dir, 'minecraft', 'icon.png'),
    path.join(dir, '.minecraft', 'icon.png'),
  ];
  for (const p of local) if (fileExists(p)) return p;
  const key = String(iconKey || '').replace(/^:/, '').trim();
  if (!key || !launcherRoot) return '';
  const iconsDir = path.join(launcherRoot, 'icons');
  const candidates: string[] = [];
  if (path.isAbsolute(key)) candidates.push(key);
  else {
    candidates.push(path.join(iconsDir, key));
    if (!path.extname(key)) {
      for (const ext of ['.webp', '.png', '.jpg', '.jpeg', '.svg', '.ico']) {
        candidates.push(path.join(iconsDir, key + ext));
      }
    }
  }
  for (const p of candidates) if (fileExists(p)) return p;
  return '';
}

function pushInstance(list: ExternalInstanceInfo[], item: ExternalInstanceInfo): void {
  if (list.some((x) => path.resolve(x.sourceDir) === path.resolve(item.sourceDir))) return;
  list.push(item);
}

const KNOWN_LOADERS = new Set(['fabric', 'forge', 'neoforge', 'quilt']);

function normalizeLoaderId(raw: string): string {
  const s = String(raw || '').toLowerCase();
  if (!s || s === 'vanilla' || s === 'minecraft' || s === 'none') return '';
  if (s.includes('neoforge')) return 'neoforge';
  if (s.includes('quilt')) return 'quilt';
  if (s.includes('fabric')) return 'fabric';
  if (s.includes('forge')) return 'forge';
  return '';
}

/** Имя файла внутри jar лежит в конце архива, распаковывать мод не нужно. */
function jarDeclaresLoader(filePath: string): string {
  let fd = 0;
  try {
    const st = fs.statSync(filePath);
    if (!st.isFile() || st.size < 64 || st.size > 80_000_000) return '';
    fd = fs.openSync(filePath, 'r');
    const tailLen = Math.min(st.size, 768 * 1024);
    const buf = Buffer.alloc(tailLen);
    fs.readSync(fd, buf, 0, tailLen, st.size - tailLen);
    const text = buf.toString('latin1');
    if (text.includes('quilt.mod.json')) return 'quilt';
    if (text.includes('neoforge.mods.toml')) return 'neoforge';
    if (text.includes('fabric.mod.json')) return 'fabric';
    if (text.includes('mods.toml')) return 'forge';
    return '';
  } catch {
    return '';
  } finally {
    if (fd) {
      try { fs.closeSync(fd); } catch { /* файл уже закрыт */ }
    }
  }
}

function loaderVersionFromName(fileName: string, loader: string): string {
  const text = fileName.toLowerCase();
  if (loader === 'fabric') {
    const m = text.match(/fabric-loader[-_]?(\d+\.\d+\.\d+[^.]*)/);
    if (m) return m[1];
  }
  return '';
}

/** Пустое поле в json не значит vanilla: смотрим каталог игры и моды. */
function inferLoaderFromGameDir(gameDir: string): { loader: string; loaderVersion: string } | null {
  if (!existsDir(gameDir)) return null;
  if (existsDir(path.join(gameDir, '.fabric'))) {
    return { loader: 'fabric', loaderVersion: '' };
  }
  const counts: Record<string, number> = { fabric: 0, quilt: 0, neoforge: 0, forge: 0 };
  let version = '';
  const modsDir = path.join(gameDir, 'mods');
  if (existsDir(modsDir)) {
    let checked = 0;
    for (const name of fs.readdirSync(modsDir)) {
      if (!name.toLowerCase().endsWith('.jar')) continue;
      if (checked >= 40) break;
      checked++;
      const hit = jarDeclaresLoader(path.join(modsDir, name));
      if (!hit || !(hit in counts)) continue;
      counts[hit]++;
      if (!version) version = loaderVersionFromName(name, hit);
      if (counts.fabric >= 2 || counts.quilt >= 1 || counts.neoforge >= 1) break;
    }
  }
  const loader = (['quilt', 'neoforge', 'fabric', 'forge'] as const).find((id) => counts[id] > 0) || '';
  if (!loader) return null;
  return { loader, loaderVersion: version };
}

function confirmLoader(
  current: { loader: string; loaderVersion: string },
  dirs: string[],
): { loader: string; loaderVersion: string } {
  const explicit = normalizeLoaderId(current.loader);
  if (KNOWN_LOADERS.has(explicit)) {
    return { loader: explicit, loaderVersion: current.loaderVersion || '' };
  }
  for (const dir of dirs) {
    const inferred = inferLoaderFromGameDir(dir);
    if (!inferred) continue;
    return {
      loader: inferred.loader,
      loaderVersion: current.loaderVersion || inferred.loaderVersion,
    };
  }
  return { loader: 'vanilla', loaderVersion: '' };
}

function scanPrismLike(root: string, launcherId: string): ExternalInstanceInfo[] {
  const instancesDir = existsDir(path.join(root, 'instances')) ? path.join(root, 'instances') : root;
  const out: ExternalInstanceInfo[] = [];
  let entries: fs.Dirent[] = [];
  try { entries = fs.readdirSync(instancesDir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === '.tmp' || entry.name.startsWith('.')) continue;
    const dir = path.join(instancesDir, entry.name);
    const cfg = readCfg(path.join(dir, 'instance.cfg'));
    const mmc = readJson(path.join(dir, 'mmc-pack.json'));
    if (!Object.keys(cfg).length && !mmc) continue;
    const parsed = loaderFromMmc(mmc || {});
    const mem = memoryFromNumbers(cfg.MinMemAlloc || cfg.MinMemory, cfg.MaxMemAlloc || cfg.MaxMemory);
    const iconKey = cfg.iconKey || cfg.icon || '';
    const confirmed = confirmLoader(parsed, [dir, gameDirOf(dir)]);
    pushInstance(out, {
      id: `${launcherId}:${entry.name}`,
      name: cfg.name || entry.name,
      gameVersion: parsed.gameVersion || cfg.IntendedVersion || cfg.MinecraftVersion || '',
      loader: confirmed.loader,
      loaderVersion: confirmed.loaderVersion,
      iconDataUrl: iconDataUrl(findIconFile(dir, iconKey, root)),
      gameDir: gameDirOf(dir),
      sourceDir: dir,
      memory: cfg.OverrideMemory === 'true' || mem ? mem : mem,
      jvmArgs: cfg.OverrideJavaArgs === 'true' || cfg.JvmArgs ? (cfg.JvmArgs || '') : (cfg.JvmArgs || ''),
      javaPath: cfg.JavaPath || '',
    });
  }
  return out;
}

function loaderField(raw: unknown): { loader: string; loaderVersion: string } {
  if (!raw) return { loader: 'vanilla', loaderVersion: '' };
  if (typeof raw === 'string') return parseLoaderToken(raw);
  if (typeof raw === 'object') {
    const obj = raw as any;
    const loader = String(obj.id || obj.loader || obj.type || obj.name || 'vanilla').toLowerCase();
    const loaderVersion = String(obj.version || obj.loader_version || obj.stable || '');
    const parsed = parseLoaderToken(loader.includes('-') ? loader : `${loader}${loaderVersion ? '-' + loaderVersion : ''}`);
    if (parsed.loader !== 'vanilla') return { loader: parsed.loader, loaderVersion: parsed.loaderVersion || loaderVersion };
    return { loader: loader.replace(/[^a-z]/g, '') || 'vanilla', loaderVersion };
  }
  return { loader: 'vanilla', loaderVersion: '' };
}

function scanProfileDirs(root: string, launcherId: string): ExternalInstanceInfo[] {
  const bases = [path.join(root, 'profiles'), path.join(root, 'instances'), path.join(root, 'Instances'), root]
    .filter((p, i, arr) => existsDir(p) && arr.indexOf(p) === i);
  const out: ExternalInstanceInfo[] = [];
  for (const base of bases) {
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(base, entry.name);
      const profile = readJson(path.join(dir, 'profile.json'))
        || readJson(path.join(dir, 'instance.json'))
        || readJson(path.join(dir, 'minecraftinstance.json'))
        || readJson(path.join(dir, 'config.json'));
      const cfg = readCfg(path.join(dir, 'instance.cfg'));
      const hasGame = existsDir(path.join(dir, 'mods'))
        || existsDir(path.join(dir, 'saves'))
        || existsDir(path.join(dir, 'minecraft'))
        || existsDir(path.join(dir, '.minecraft'));
      if (!profile && !Object.keys(cfg).length && !hasGame) continue;
      if (profile?.manifestType || (profile?.minecraft && profile?.files && profile?.overrides)) continue;
      const baseLoader = profile?.baseModLoader || profile?.modLoader || profile?.loader;
      const parsed = Object.keys(cfg).length && !profile
        ? { loader: '', loaderVersion: '' }
        : loaderField(typeof baseLoader === 'string' ? baseLoader : (baseLoader || profile?.loader));
      const gameVersion = String(
        profile?.game_version
        || profile?.gameVersion
        || profile?.baseModLoader?.minecraftVersion
        || profile?.minecraftVersion
        || cfg.IntendedVersion
        || '',
      );
      const maxMem = profile?.memory?.maximum ?? profile?.memory?.max ?? profile?.maxMemory ?? profile?.ram;
      const minMem = profile?.memory?.minimum ?? profile?.memory?.min ?? profile?.minMemory;
      const jvm = profile?.extra_launch_args || profile?.jvmArgs || profile?.jvm_args || cfg.JvmArgs;
      const jvmArgs = Array.isArray(jvm) ? jvm.join(' ') : String(jvm || '');
      const iconPath = typeof profile?.icon_path === 'string' ? profile.icon_path
        : typeof profile?.icon === 'string' && !profile.icon.startsWith('data:') ? profile.icon : '';
      const resolvedIcon = iconPath
        ? (path.isAbsolute(iconPath) ? iconPath : path.join(dir, iconPath))
        : findIconFile(dir);
      const gameDir = gameDirOf(dir);
      const confirmed = confirmLoader({
        loader: parsed.loader,
        loaderVersion: String(profile?.loader_version || profile?.loaderVersion || parsed.loaderVersion || ''),
      }, [dir, gameDir]);
      pushInstance(out, {
        id: `${launcherId}:${entry.name}`,
        name: String(profile?.name || cfg.name || entry.name),
        gameVersion,
        loader: confirmed.loader,
        loaderVersion: confirmed.loaderVersion,
        iconDataUrl: iconDataUrl(resolvedIcon),
        gameDir,
        sourceDir: dir,
        memory: memoryFromNumbers(minMem, maxMem),
        jvmArgs,
        javaPath: String(profile?.java_path || profile?.javaPath || cfg.JavaPath || ''),
      });
    }
  }
  return out;
}

function millidaKey(name: string): string {
  return String(name || '').toLowerCase().replace(/[^0-9a-zа-яё]+/gi, '');
}

/** Сборки Millida: %APPDATA%/net.millida.launcher/minecraft/profiles. Секреты и vault не читаем. */
function scanMillida(root: string): ExternalInstanceInfo[] {
  const profilesRoot = path.join(root, 'minecraft', 'profiles');
  const catalog = readJson(path.join(root, 'profiles.json'));
  const rows = Array.isArray(catalog) ? catalog : [];
  const out: ExternalInstanceInfo[] = [];
  if (!existsDir(profilesRoot)) return out;
  let entries: fs.Dirent[] = [];
  try { entries = fs.readdirSync(profilesRoot, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(profilesRoot, entry.name);
    const settings = readJson(path.join(dir, 'millida-settings.json')) || {};
    const catalogRow = rows.find((row) => {
      const name = String(row?.name || '');
      return name && (name === settings.name || millidaKey(name) === millidaKey(entry.name) || millidaKey(name) === millidaKey(String(settings.name || '')));
    }) || {};
    const name = String(settings.name || catalogRow.name || entry.name);
    const loaderRaw = String(settings.loader || catalogRow.loader || ((settings.fabric || catalogRow.fabric) ? 'fabric' : ''));
    const loaderVersion = String(settings.loaderVersion || settings.loader_version || catalogRow.loader_version || '');
    const confirmed = confirmLoader({ loader: loaderRaw, loaderVersion }, [dir]);
    const iconRef = String(settings.icon || catalogRow.icon || '');
    let iconFile = '';
    if (iconRef && !/^https?:/i.test(iconRef)) {
      iconFile = path.isAbsolute(iconRef) ? iconRef : path.join(dir, iconRef);
    }
    if (!iconFile || !fs.existsSync(iconFile)) iconFile = findIconFile(dir);
    pushInstance(out, {
      id: `millida:${entry.name}`,
      name,
      gameVersion: String(settings.version || catalogRow.version || ''),
      loader: confirmed.loader,
      loaderVersion: confirmed.loaderVersion,
      iconDataUrl: iconDataUrl(iconFile) || (/^https?:/i.test(iconRef) ? iconRef : undefined),
      gameDir: dir,
      sourceDir: dir,
      memory: memoryFromNumbers(settings.minMemory ?? settings.memory?.min, settings.maxMemory ?? settings.ram ?? settings.memory?.max),
      jvmArgs: String(settings.jvmArgs || settings.jvm_args || ''),
      javaPath: String(settings.javaPath || settings.java_path || ''),
    });
  }
  return out;
}

function resolveModrinthProfileDir(root: string, instancePath: string): string {
  const raw = String(instancePath || '').trim();
  if (raw && path.isAbsolute(raw) && existsDir(raw)) return raw;
  const underProfiles = path.join(root, 'profiles', raw);
  if (existsDir(underProfiles)) return underProfiles;
  const direct = path.join(root, raw);
  if (existsDir(direct)) return direct;
  return underProfiles;
}

type SqlDb = {
  prepare(sql: string): { all(): Array<Record<string, unknown>> };
  close(): void;
};

/** Modrinth App пишет loader в app.db (instance_content_sets), не в profile.json. */
function readModrinthInstances(root: string): ExternalInstanceInfo[] | null {
  const dbPath = path.join(root, 'app.db');
  if (!fs.existsSync(dbPath)) return null;
  let db: SqlDb | null = null;
  try {
    const sqlite = nodeRequire('node:sqlite') as {
      DatabaseSync: new (file: string, opts?: { readOnly?: boolean }) => SqlDb;
    };
    db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
    const rows = db.prepare(`
      SELECT i.path AS path, i.name AS name, i.icon_path AS icon_path,
             s.game_version AS game_version, s.loader AS loader, s.loader_version AS loader_version
      FROM instances i
      LEFT JOIN instance_content_sets s ON s.id = i.applied_content_set_id
    `).all();
    const out: ExternalInstanceInfo[] = [];
    for (const row of rows) {
      const dir = resolveModrinthProfileDir(root, String(row.path || ''));
      if (!existsDir(dir)) continue;
      const confirmed = confirmLoader({
        loader: String(row.loader || ''),
        loaderVersion: String(row.loader_version || ''),
      }, [dir, gameDirOf(dir)]);
      const iconFromDb = String(row.icon_path || '');
      const iconFile = iconFromDb && fs.existsSync(iconFromDb) ? iconFromDb : findIconFile(dir);
      pushInstance(out, {
        id: `modrinth:${path.basename(dir)}`,
        name: String(row.name || path.basename(dir)),
        gameVersion: String(row.game_version || ''),
        loader: confirmed.loader,
        loaderVersion: confirmed.loaderVersion,
        iconDataUrl: iconDataUrl(iconFile),
        gameDir: gameDirOf(dir),
        sourceDir: dir,
      });
    }
    return out;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[launchers] Modrinth app.db не прочитан, смотрим папки профилей:', message);
    return null;
  } finally {
    try { db?.close(); } catch { /* база уже закрыта */ }
  }
}

function scanModrinth(root: string): ExternalInstanceInfo[] {
  const fromDb = readModrinthInstances(root);
  if (fromDb && fromDb.length) return fromDb;
  return scanProfileDirs(root, 'modrinth');
}

function loaderFromXmclRuntime(runtime: any): { loader: string; loaderVersion: string; gameVersion: string } {
  const gameVersion = String(runtime?.minecraft || runtime?.gameVersion || '');
  if (runtime?.fabricLoader) return { loader: 'fabric', loaderVersion: String(runtime.fabricLoader), gameVersion };
  if (runtime?.quiltLoader) return { loader: 'quilt', loaderVersion: String(runtime.quiltLoader), gameVersion };
  if (runtime?.neoForged || runtime?.neoforge) {
    return { loader: 'neoforge', loaderVersion: String(runtime.neoForged || runtime.neoforge), gameVersion };
  }
  if (runtime?.forge) return { loader: 'forge', loaderVersion: String(runtime.forge), gameVersion };
  return { loader: '', loaderVersion: '', gameVersion };
}

/** Файл root в userData XMCL указывает каталог сборок, он может быть вне AppData. */
function xmclGameRoot(userData: string): string {
  try {
    const file = path.join(userData, 'root');
    if (!fileExists(file)) return userData;
    const raw = fs.readFileSync(file, 'utf8').trim().replace(/^["']+|["']+$/g, '');
    if (raw && existsDir(raw)) return raw;
  } catch {
    /* нет файла root — сборки ищем рядом с userData */
  }
  return userData;
}

function addXmclInstanceDir(dirs: Set<string>, raw: string, bases: string[]): void {
  if (!raw) return;
  const candidates = path.isAbsolute(raw)
    ? [raw]
    : bases.flatMap((base) => [path.join(base, 'instances', raw), path.join(base, raw)]);
  for (const abs of candidates) {
    if (!existsDir(abs)) continue;
    dirs.add(path.resolve(abs));
    return;
  }
}

/** XMCL хранит инстансы в instances/ и instance.json с полем runtime. */
function scanXmcl(root: string): ExternalInstanceInfo[] {
  const gameRoot = xmclGameRoot(root);
  const bases = gameRoot === root ? [root] : [gameRoot, root];
  const dirs = new Set<string>();
  const manifest = readJson(path.join(root, 'instances.json')) || readJson(path.join(gameRoot, 'instances.json'));
  const listed = Array.isArray(manifest) ? manifest : (Array.isArray(manifest?.instances) ? manifest.instances : []);
  for (const row of listed) {
    const raw = typeof row === 'string' ? row : String(row?.path || row?.name || '');
    addXmclInstanceDir(dirs, raw, bases);
  }
  for (const base of bases) {
    const instancesDir = path.join(base, 'instances');
    if (!existsDir(instancesDir)) continue;
    for (const name of fs.readdirSync(instancesDir)) {
      const dir = path.join(instancesDir, name);
      if (name.startsWith('.') || !existsDir(dir)) continue;
      dirs.add(path.resolve(dir));
    }
  }
  const out: ExternalInstanceInfo[] = [];
  for (const dir of dirs) {
    const meta = readJson(path.join(dir, 'instance.json'));
    if (!meta) continue;
    const runtime = meta.runtime || {};
    const parsed = loaderFromXmclRuntime(runtime);
    const confirmed = confirmLoader(
      { loader: parsed.loader, loaderVersion: parsed.loaderVersion },
      [dir, gameDirOf(dir)],
    );
    const iconRef = String(meta.icon || '');
    let iconFile = '';
    if (iconRef && !/^https?:/i.test(iconRef)) {
      iconFile = path.isAbsolute(iconRef) ? iconRef : path.join(dir, iconRef);
    }
    if (!fileExists(iconFile)) iconFile = findIconFile(dir);
    pushInstance(out, {
      id: `xmcl:${path.basename(dir)}`,
      name: String(meta.name || path.basename(dir)),
      gameVersion: parsed.gameVersion,
      loader: confirmed.loader,
      loaderVersion: confirmed.loaderVersion,
      iconDataUrl: iconDataUrl(iconFile) || (/^https?:/i.test(iconRef) ? iconRef : undefined),
      gameDir: gameDirOf(dir),
      sourceDir: dir,
    });
  }
  return out;
}

/** Иконка клиента в списке переноса — только наш файл из launchersTransferIcons. */
function bundledLauncherIcon(id: string): string | undefined {
  const dir = path.resolve(__dirname, '../../assets/icons/launchersTransferIcons');
  const names = [id];
  for (const name of names) {
    for (const ext of ['.png', '.webp', '.svg', '.jpg', '.jpeg']) {
      const url = iconDataUrl(path.join(dir, `${name}${ext}`));
      if (url) return url;
    }
  }
  return undefined;
}

function scanLauncher(meta: { id: string; name: string }): ExternalLauncherInfo | null {
  // У XMCL userData и каталог сборок часто в разных местах: берём корень, где есть инстансы.
  if (meta.id === 'xmcl') {
    let found: ExternalLauncherInfo | null = null;
    for (const root of candidateRoots('xmcl')) {
      if (!existsDir(root)) continue;
      const instances = scanXmcl(root);
      if (!instances.length) continue;
      found = {
        id: meta.id,
        name: meta.name,
        root,
        iconDataUrl: bundledLauncherIcon(meta.id),
        instances,
      };
      break;
    }
    return found;
  }
  const root = firstExisting(candidateRoots(meta.id));
  if (!root) return null;
  let instances: ExternalInstanceInfo[] = [];
  if (meta.id === 'prism' || meta.id === 'pinecone' || meta.id === 'multimc') instances = scanPrismLike(root, meta.id);
  else if (meta.id === 'millida') instances = scanMillida(root);
  else if (meta.id === 'modrinth') instances = scanModrinth(root);
  else instances = scanProfileDirs(root, meta.id);
  return {
    id: meta.id,
    name: meta.name,
    root,
    iconDataUrl: bundledLauncherIcon(meta.id),
    instances,
  };
}

export function scanExternalLaunchers(): ExternalLauncherInfo[] {
  const found: ExternalLauncherInfo[] = [];
  for (const meta of LAUNCHERS) {
    try {
      const hit = scanLauncher(meta);
      if (hit) found.push(hit);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[launchers] не удалось прочитать', meta.id, message);
    }
  }
  return found;
}

async function copyEntry(src: string, dest: string, skipped: string[]): Promise<void> {
  let st: fs.Stats;
  try { st = await fs.promises.stat(src); } catch { skipped.push(src); return; }
  if (st.isDirectory()) {
    if (SKIP_DIR.test(path.basename(src))) return;
    await fs.promises.mkdir(dest, { recursive: true });
    const entries = await fs.promises.readdir(src);
    for (const name of entries) {
      if (SKIP_FILE.test(name) || SKIP_DIR.test(name)) continue;
      await copyEntry(path.join(src, name), path.join(dest, name), skipped);
    }
    return;
  }
  if (SKIP_FILE.test(path.basename(src))) return;
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  await fs.promises.copyFile(src, dest);
}

async function copyGameContent(gameDir: string, destRoot: string, sendProgress: ProgressFn): Promise<number> {
  const skipped: string[] = [];
  let copied = 0;
  const jobs: Array<{ src: string; dest: string }> = [];
  for (const name of CONTENT_DIRS) {
    const src = path.join(gameDir, name);
    if (existsDir(src)) jobs.push({ src, dest: path.join(destRoot, name) });
  }
  for (const name of CONTENT_FILES) {
    const src = path.join(gameDir, name);
    if (fs.existsSync(src) && fs.statSync(src).isFile()) jobs.push({ src, dest: path.join(destRoot, name) });
  }
  const icon = path.join(gameDir, 'icon.png');
  if (fs.existsSync(icon)) jobs.push({ src: icon, dest: path.join(destRoot, 'icon.png') });
  let index = 0;
  for (const job of jobs) {
    index++;
    sendProgress({
      type: 'progress',
      percent: Math.round((index / Math.max(jobs.length, 1)) * 100),
      filename: path.basename(job.src),
    });
    await copyEntry(job.src, job.dest, skipped);
    copied++;
  }
  if (skipped.length) {
    sendProgress({ kind: 'status', key: 'import.partialHint', params: { n: skipped.length } });
  }
  return copied;
}

function countJars(dir: string): Array<{ name: string; filename: string; enabled: boolean }> {
  if (!existsDir(dir)) return [];
  const out: Array<{ name: string; filename: string; enabled: boolean }> = [];
  for (const name of fs.readdirSync(dir)) {
    const low = name.toLowerCase();
    if (!low.endsWith('.jar') && !low.endsWith('.jar.disabled') && !low.endsWith('.litemod')) continue;
    const disabled = low.endsWith('.disabled');
    out.push({ name: name.replace(/\.disabled$/i, ''), filename: name, enabled: !disabled });
  }
  return out;
}

export async function importExternalInstances(opts: {
  launcherId: string;
  instanceIds: string[];
  sendProgress: ProgressFn;
}): Promise<{ ok: boolean; imported: any[]; error?: string }> {
  const launchers = scanExternalLaunchers();
  const launcher = launchers.find((l) => l.id === opts.launcherId);
  if (!launcher) return { ok: false, imported: [], error: 'launcher_not_found' };
  const wanted = new Set(opts.instanceIds);
  const picks = launcher.instances.filter((inst) => wanted.has(inst.id));
  if (!picks.length) return { ok: false, imported: [], error: 'instance_not_found' };

  const buildsPath = path.join(getLauncherDataDir(), 'builds.json');
  let builds: any[] = [];
  try {
    if (fs.existsSync(buildsPath)) builds = JSON.parse(fs.readFileSync(buildsPath, 'utf8'));
  } catch { builds = []; }
  if (!Array.isArray(builds)) builds = [];

  const imported: any[] = [];
  let n = 0;
  for (const inst of picks) {
    n++;
    opts.sendProgress({
      type: 'start',
      filename: inst.name,
      size: 0,
    });
    opts.sendProgress({
      kind: 'status',
      key: 'import.externalCopy',
      params: { name: inst.name, i: n, n: picks.length },
    });
    const buildId = `import-${crypto.randomBytes(4).toString('hex')}`;
    const dest = getInstanceRoot(buildId);
    await fs.promises.mkdir(dest, { recursive: true });
    await copyGameContent(inst.gameDir, dest, opts.sendProgress);
    const iconFile = path.join(dest, 'icon.png');
    const build = {
      id: buildId,
      name: inst.name,
      gameVersion: inst.gameVersion || 'latest_release',
      loader: inst.loader || 'vanilla',
      loaderVersion: inst.loaderVersion || '',
      icon: iconDataUrl(iconFile) || inst.iconDataUrl,
      iconBg: '#70ADDF',
      createdAt: Date.now(),
      memory: inst.memory,
      jvmArgs: inst.jvmArgs || '',
      javaPath: inst.javaPath && fs.existsSync(inst.javaPath) ? inst.javaPath : '',
      mods: countJars(path.join(dest, 'mods')),
    };
    builds.push(build);
    imported.push(build);
  }
  fs.mkdirSync(path.dirname(buildsPath), { recursive: true });
  fs.writeFileSync(buildsPath, JSON.stringify(builds, null, 2), 'utf8');
  opts.sendProgress({ type: 'done', filename: launcher.name, buildCreated: true });
  return { ok: true, imported };
}
