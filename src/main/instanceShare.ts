// Назначение: создание, загрузка и импорт пользовательских шаров сборок
// (настройки + моды/паки, без миров) через API uprojects.site.

import { BrowserWindow, ipcMain } from 'electron';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { getApiBase } from '../shared/apiBase';
import {
  INSTANCE_SHARE_SCHEMA,
  SHARE_ID_RE,
  instanceShareApiCollectionUrl,
  instanceShareApiFileUrl,
  instanceShareApiItemUrl,
  instanceSharePageUrl,
  type InstanceShareCreateBody,
  type InstanceShareFile,
  type InstanceShareManifest,
  type ShareContentType,
} from '../shared/instanceShare';
import { downloadModrinthFile, runWithConcurrency, PROXY_MAX_CONCURRENT_DOWNLOADS } from './modrinthDownload';
import { getInstanceRoot } from './launcher';

// ===== Лимиты =====

const MAX_FILES = 400;
const MAX_FILE_BYTES = 120 * 1024 * 1024;
/** Суммарный размер файлов, которые придётся залить на наш сервер. */
const MAX_HOSTED_BYTES = 250 * 1024 * 1024;
const API_TIMEOUT_MS = 60_000;
const UPLOAD_TIMEOUT_MS = 10 * 60_000;
const USER_AGENT = 'Undefined-Client';

const CONTENT_DIRS: { contentType: ShareContentType; sub: string; exts: string[] }[] = [
  { contentType: 'mod', sub: 'mods', exts: ['.jar', '.litemod'] },
  { contentType: 'resourcepack', sub: 'resourcepacks', exts: ['.zip'] },
  { contentType: 'shader', sub: 'shaderpacks', exts: ['.zip'] },
  { contentType: 'datapack', sub: 'datapacks', exts: ['.zip'] },
];

const INSTALL_SUBDIRS: Record<ShareContentType, string> = {
  mod: 'mods',
  resourcepack: 'resourcepacks',
  shader: 'shaderpacks',
  datapack: 'datapacks',
};

// ===== Типы локального скана =====

interface LocalShareFile {
  fileId: string;
  contentType: ShareContentType;
  filename: string;
  enabled: boolean;
  name: string;
  version: string;
  sha1: string;
  size: number;
  fullPath: string;
  projectId?: string;
  versionId?: string;
  hosted: boolean;
}

function sendProgress(win: BrowserWindow | null, data: Record<string, unknown>): void {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('instance-share:progress', data);
}

function randomFileId(): string {
  return crypto.randomBytes(8).toString('hex');
}

function sha1File(filePath: string): Promise<{ sha1: string; size: number }> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1');
    const stream = fs.createReadStream(filePath);
    let size = 0;
    stream.on('data', (chunk: string | Buffer) => {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      size += buf.length;
      hash.update(buf);
    });
    stream.on('error', reject);
    stream.on('end', () => resolve({ sha1: hash.digest('hex'), size }));
  });
}

function displayNameFromFilename(filename: string): { name: string; version: string } {
  let name = filename.replace(/\.[^.]+(?:\.disabled)?$/i, '');
  let version = '';
  const verMatch = name.match(/-(\d+(?:\.\d+)*)/);
  if (verMatch) {
    version = verMatch[1];
    name = name.replace(/-?\d+(?:\.\d+)*$/, '').trim();
  }
  return { name, version };
}

async function lookupModrinthByHash(
  sha1: string,
): Promise<{ projectId: string; versionId: string } | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(
      `https://api.modrinth.com/v2/version_file/${sha1}?algorithm=sha1`,
      { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: ctrl.signal },
    );
    if (!res.ok) return null;
    const data = await res.json() as { id?: string; project_id?: string };
    if (!data?.id || !data?.project_id) return null;
    return { projectId: String(data.project_id), versionId: String(data.id) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function listContentFiles(instanceRoot: string): Omit<LocalShareFile, 'sha1' | 'size' | 'projectId' | 'versionId' | 'hosted'>[] {
  const out: Omit<LocalShareFile, 'sha1' | 'size' | 'projectId' | 'versionId' | 'hosted'>[] = [];
  for (const dir of CONTENT_DIRS) {
    const folder = path.join(instanceRoot, dir.sub);
    if (!fs.existsSync(folder)) continue;
    for (const item of fs.readdirSync(folder, { withFileTypes: true })) {
      if (!item.isFile()) continue;
      const lower = item.name.toLowerCase();
      const base = lower.endsWith('.disabled') ? lower.slice(0, -9) : lower;
      const ext = path.extname(base);
      if (!dir.exts.includes(ext)) continue;
      const fullPath = path.join(folder, item.name);
      const enabled = !lower.endsWith('.disabled');
      const { name, version } = displayNameFromFilename(item.name);
      out.push({
        fileId: randomFileId(),
        contentType: dir.contentType,
        filename: item.name,
        enabled,
        name,
        version,
        fullPath,
      });
    }
  }
  return out;
}

async function collectShareFiles(
  buildId: string,
  win: BrowserWindow | null,
): Promise<{ files: LocalShareFile[]; error?: string }> {
  const root = getInstanceRoot(buildId);
  if (!fs.existsSync(root)) return { files: [], error: 'instance_missing' };

  const listed = listContentFiles(root);
  if (listed.length > MAX_FILES) return { files: [], error: 'too_many_files' };

  const files: LocalShareFile[] = [];
  let hostedBytes = 0;
  let done = 0;

  for (const item of listed) {
    let st: fs.Stats;
    try {
      st = fs.statSync(item.fullPath);
    } catch {
      continue;
    }
    if (st.size > MAX_FILE_BYTES) return { files: [], error: 'file_too_large' };

    sendProgress(win, {
      phase: 'hash',
      current: done + 1,
      total: listed.length,
      filename: item.filename,
    });

    const { sha1, size } = await sha1File(item.fullPath);
    const mr = await lookupModrinthByHash(sha1);
    const hosted = !mr;
    if (hosted) {
      hostedBytes += size;
      if (hostedBytes > MAX_HOSTED_BYTES) return { files: [], error: 'hosted_too_large' };
    }

    files.push({
      ...item,
      sha1,
      size,
      projectId: mr?.projectId,
      versionId: mr?.versionId,
      hosted,
    });
    done += 1;
  }

  return { files };
}

function buildsPath(): string {
  return path.join(process.env.APPDATA || process.cwd(), '.Undefined Client', 'builds.json');
}

function readBuilds(): any[] {
  try {
    const p = buildsPath();
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch { /* ignore */ }
  return [];
}

function writeBuilds(builds: any[]): void {
  const p = buildsPath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(builds, null, 2), 'utf-8');
}

function resolveIconForUpload(icon: string | undefined): {
  preset?: string;
  modrinthUrl?: string;
  buffer?: Buffer;
  mime?: string;
} {
  if (!icon) return {};
  if (icon.startsWith('preset:')) return { preset: icon };
  if (icon.startsWith('modrinth:')) return { modrinthUrl: icon.slice(9) };
  if (icon.startsWith('data:')) {
    const m = icon.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return {};
    return { buffer: Buffer.from(m[2], 'base64'), mime: m[1] };
  }
  try {
    if (fs.existsSync(icon) && fs.statSync(icon).isFile()) {
      const ext = path.extname(icon).toLowerCase();
      const mime = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'application/octet-stream';
      return { buffer: fs.readFileSync(icon), mime };
    }
  } catch { /* ignore */ }
  return {};
}

function toManifestFiles(files: LocalShareFile[]): InstanceShareFile[] {
  return files.map((f) => ({
    fileId: f.fileId,
    contentType: f.contentType,
    filename: f.filename,
    enabled: f.enabled,
    name: f.name,
    version: f.version || undefined,
    sha1: f.sha1,
    size: f.size,
    projectId: f.projectId,
    versionId: f.versionId,
    hosted: f.hosted || undefined,
  }));
}

function countFiles(files: InstanceShareFile[]) {
  return {
    mods: files.filter((f) => f.contentType === 'mod').length,
    resourcePacks: files.filter((f) => f.contentType === 'resourcepack').length,
    shaders: files.filter((f) => f.contentType === 'shader').length,
    dataPacks: files.filter((f) => f.contentType === 'datapack').length,
  };
}

async function uploadShare(
  body: InstanceShareCreateBody,
  localFiles: LocalShareFile[],
  icon: ReturnType<typeof resolveIconForUpload>,
  win: BrowserWindow | null,
): Promise<{ ok: true; id: string; url: string; manifest: InstanceShareManifest } | { ok: false; error: string }> {
  const form = new FormData();
  form.append('manifest', JSON.stringify(body));

  if (icon.buffer) {
    form.append(
      'icon',
      new Blob([new Uint8Array(icon.buffer)], { type: icon.mime || 'image/png' }),
      'icon.png',
    );
  }

  const hosted = localFiles.filter((f) => f.hosted);
  let uploaded = 0;
  for (const f of hosted) {
    const buf = await fs.promises.readFile(f.fullPath);
    form.append(
      `file_${f.fileId}`,
      new Blob([new Uint8Array(buf)], { type: 'application/octet-stream' }),
      f.filename,
    );
    uploaded += 1;
    sendProgress(win, {
      phase: 'upload',
      current: uploaded,
      total: hosted.length,
      filename: f.filename,
    });
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(instanceShareApiCollectionUrl(), {
      method: 'POST',
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      body: form,
      signal: ctrl.signal,
    });
    if (res.status === 404) return { ok: false, error: 'api_missing' };
    if (!res.ok) {
      let detail = '';
      try { detail = await res.text(); } catch { /* ignore */ }
      return { ok: false, error: `upload_failed:${res.status}${detail ? `:${detail.slice(0, 120)}` : ''}` };
    }
    const data = await res.json() as { id?: string; url?: string; manifest?: InstanceShareManifest };
    const id = String(data?.id || '');
    if (!SHARE_ID_RE.test(id)) return { ok: false, error: 'bad_response' };
    // Ссылку для пользователя строим от текущего apiBase (локальный стенд / прод).
    const url = instanceSharePageUrl(id);
    const manifest = data.manifest && data.manifest.id
      ? data.manifest
      : { ...body, id, createdAt: new Date().toISOString(), iconUrl: undefined };
    return { ok: true, id, url, manifest };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/abort/i.test(msg)) return { ok: false, error: 'timeout' };
    return { ok: false, error: 'network' };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchManifest(id: string): Promise<
  { ok: true; manifest: InstanceShareManifest } | { ok: false; error: string }
> {
  if (!SHARE_ID_RE.test(id)) return { ok: false, error: 'bad_id' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(instanceShareApiItemUrl(id), {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (res.status === 404) return { ok: false, error: 'not_found' };
    if (!res.ok) return { ok: false, error: 'network' };
    const manifest = await res.json() as InstanceShareManifest;
    if (!manifest || manifest.schemaVersion !== INSTANCE_SHARE_SCHEMA || !Array.isArray(manifest.files)) {
      return { ok: false, error: 'bad_manifest' };
    }
    return { ok: true, manifest };
  } catch {
    return { ok: false, error: 'network' };
  } finally {
    clearTimeout(timer);
  }
}

async function downloadHostedFile(
  shareId: string,
  file: InstanceShareFile,
  destPath: string,
  onProgress?: (received: number, total: number) => void,
): Promise<void> {
  const url = instanceShareApiFileUrl(shareId, file.fileId);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Hosted download failed: ${res.status}`);
    const total = Number(res.headers.get('content-length')) || file.size || 0;
    const tmp = destPath + '.part';
    await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
    const fh = await fs.promises.open(tmp, 'w');
    const hash = crypto.createHash('sha1');
    try {
      if (!res.body) throw new Error('Empty body');
      const reader = res.body.getReader();
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const buf = Buffer.from(value);
        hash.update(buf);
        await fh.write(buf);
        received += buf.length;
        onProgress?.(received, total);
      }
    } finally {
      await fh.close();
    }
    const digest = hash.digest('hex');
    if (file.sha1 && digest !== file.sha1) {
      try { await fs.promises.unlink(tmp); } catch { /* ignore */ }
      throw new Error('sha1_mismatch');
    }
    await fs.promises.rename(tmp, destPath);
  } finally {
    clearTimeout(timer);
  }
}

async function importShare(
  id: string,
  win: BrowserWindow | null,
): Promise<{ ok: true; build: any } | { ok: false; error: string }> {
  const loaded = await fetchManifest(id);
  if (!loaded.ok) return loaded;
  const manifest = loaded.manifest;

  const buildId = crypto.randomUUID();
  let icon: string | undefined;
  if (manifest.iconPreset) icon = manifest.iconPreset;
  else if (manifest.iconUrl) {
    const abs = manifest.iconUrl.startsWith('http')
      ? manifest.iconUrl
      : new URL(manifest.iconUrl, getApiBase()).toString();
    icon = abs.startsWith('https://cdn.modrinth.com') || abs.includes('modrinth')
      ? `modrinth:${abs}`
      : abs;
  }

  const build = {
    id: buildId,
    name: String(manifest.name || 'Shared build').slice(0, 80),
    gameVersion: String(manifest.gameVersion || ''),
    loader: String(manifest.loader || 'vanilla'),
    loaderVersion: String(manifest.loaderVersion || ''),
    iconBg: String(manifest.iconBg || '#4A90D9'),
    icon,
    jvmArgs: manifest.jvmArgs,
    mcArgs: manifest.mcArgs,
    memory: manifest.memory,
    window: manifest.window,
    playtime: 0,
  };

  const builds = readBuilds();
  builds.push(build);
  writeBuilds(builds);

  const files = manifest.files || [];
  const total = files.length;
  let current = 0;
  const errors: string[] = [];

  await runWithConcurrency(files, PROXY_MAX_CONCURRENT_DOWNLOADS, async (file) => {
    current += 1;
    sendProgress(win, {
      phase: 'import',
      current,
      total,
      filename: file.filename,
    });

    const sub = INSTALL_SUBDIRS[file.contentType] || 'mods';
    const destDir = path.join(getInstanceRoot(buildId), sub);
    await fs.promises.mkdir(destDir, { recursive: true });
    const destPath = path.join(destDir, path.basename(file.filename));

    try {
      if (file.projectId && file.versionId && !file.hosted) {
        const verRes = await fetch(`https://api.modrinth.com/v2/version/${file.versionId}`, {
          headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        });
        if (!verRes.ok) throw new Error('version_fetch');
        const version = await verRes.json() as { files?: { url?: string; filename?: string; size?: number; hashes?: { sha1?: string }; primary?: boolean }[] };
        const primary = version.files?.find((f) => f.primary) || version.files?.[0];
        if (!primary?.url) throw new Error('no_file_url');
        const target = path.join(destDir, path.basename(primary.filename || file.filename));
        await downloadModrinthFile(primary.url, target, {
          reason: 'modpack',
          expectedSize: primary.size,
          sha1: primary.hashes?.sha1 || file.sha1,
        });
        // Отключённые моды: переименовать в .disabled
        if (!file.enabled && !target.toLowerCase().endsWith('.disabled')) {
          await fs.promises.rename(target, `${target}.disabled`);
        }
        return;
      }
      if (file.hosted || file.fileId) {
        await downloadHostedFile(id, file, destPath);
        return;
      }
      throw new Error('unresolvable_file');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${file.filename}: ${msg}`);
    }
  });

  if (errors.length && errors.length === files.length) {
    return { ok: false, error: `import_failed:${errors[0]}` };
  }

  return { ok: true, build };
}

export function registerInstanceShareIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('instance-share:create', async (_event, buildId: string, opts?: { authorName?: string }) => {
    const win = getWindow();
    try {
      const builds = readBuilds();
      const build = builds.find((b: any) => b.id === buildId);
      if (!build) return { ok: false, error: 'build_not_found' };

      sendProgress(win, { phase: 'prepare', current: 0, total: 0 });
      const collected = await collectShareFiles(buildId, win);
      if (collected.error) return { ok: false, error: collected.error };

      const manifestFiles = toManifestFiles(collected.files);
      const iconInfo = resolveIconForUpload(build.icon);
      const body: InstanceShareCreateBody = {
        schemaVersion: INSTANCE_SHARE_SCHEMA,
        name: String(build.name || 'Build'),
        iconBg: build.iconBg,
        iconPreset: iconInfo.preset,
        gameVersion: String(build.gameVersion || ''),
        loader: String(build.loader || 'vanilla'),
        loaderVersion: String(build.loaderVersion || ''),
        jvmArgs: build.jvmArgs,
        mcArgs: build.mcArgs,
        memory: build.memory,
        window: build.window,
        counts: countFiles(manifestFiles),
        files: manifestFiles,
        authorName: String(opts?.authorName || 'Undefined Client').slice(0, 64),
      };

      if (iconInfo.modrinthUrl) body.iconUrl = iconInfo.modrinthUrl;

      sendProgress(win, { phase: 'upload', current: 0, total: collected.files.filter((f) => f.hosted).length });
      const uploaded = await uploadShare(body, collected.files, iconInfo, win);
      if (!uploaded.ok) return uploaded;
      sendProgress(win, { phase: 'done', id: uploaded.id, url: uploaded.url });
      return {
        ok: true,
        id: uploaded.id,
        url: uploaded.url,
        deepLink: `uclient://import-instance?id=${encodeURIComponent(uploaded.id)}`,
        counts: body.counts,
        hostedFiles: collected.files.filter((f) => f.hosted).length,
        modrinthFiles: collected.files.filter((f) => !f.hosted).length,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }
  });

  ipcMain.handle('instance-share:get', async (_event, id: string) => {
    return fetchManifest(String(id || ''));
  });

  ipcMain.handle('instance-share:import', async (_event, id: string) => {
    const win = getWindow();
    try {
      sendProgress(win, { phase: 'fetch', current: 0, total: 0 });
      const result = await importShare(String(id || ''), win);
      if (result.ok) sendProgress(win, { phase: 'done', buildId: result.build.id });
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }
  });
}
