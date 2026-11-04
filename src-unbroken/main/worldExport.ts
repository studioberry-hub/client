// Экспорт мира через Minecraft Web Exporter (Arcus) для версий новее live-мешера.
//
// Бинарь кэшируется в userData/tools/minecraft-web-exporter/. Результат экспорта —
// в userData/world-previews/<hash>/. После экспорта открывается окно со статикой
// viewer'а (если лежит рядом) либо проводник с папкой экспорта.

import { app, BrowserWindow, ipcMain, shell } from 'electron';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import * as https from 'https';
import * as http from 'http';
import * as os from 'os';

const EXPORTER_REPO = 'Arcus92/minecraft-web-exporter';
const VIEWER_REPO = 'Arcus92/minecraft-web-viewer';
const VIEWER_ZIP_URL =
  'https://github.com/Arcus92/minecraft-web-viewer/releases/download/v0.2.0-PREVIEW/minecraft-web-viewer-v0.2.0-PREVIEW-14.x.zip';

function toolsRoot(): string {
  return path.join(app.getPath('userData'), 'tools', 'minecraft-web-exporter');
}

function previewsRoot(): string {
  return path.join(app.getPath('userData'), 'world-previews');
}

function viewerRoot(): string {
  return path.join(app.getPath('userData'), 'tools', 'minecraft-web-viewer');
}

function copyRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyRecursive(from, to);
    else fs.copyFileSync(from, to);
  }
}

function findIndexHtml(dir: string): string | null {
  const direct = path.join(dir, 'index.html');
  if (fs.existsSync(direct)) return direct;
  const queue = [dir];
  let depth = 0;
  while (queue.length && depth < 4) {
    const next: string[] = [];
    for (const cur of queue) {
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const nested = path.join(cur, entry.name);
        const index = path.join(nested, 'index.html');
        if (fs.existsSync(index)) return index;
        next.push(nested);
      }
    }
    queue.length = 0;
    queue.push(...next);
    depth += 1;
  }
  return null;
}

/** Скачивает и распаковывает Minecraft Web Viewer рядом с tools. */
export async function ensureWorldViewer(onProgress?: (msg: string) => void): Promise<{ ok: boolean; dir?: string; error?: string }> {
  const existing = findIndexHtml(viewerRoot());
  if (existing) return { ok: true, dir: path.dirname(existing) };

  try {
    const dir = viewerRoot();
    fs.mkdirSync(dir, { recursive: true });
    onProgress?.('Скачивание Minecraft Web Viewer…');
    // Сначала пробуем latest release API, иначе фиксированный PREVIEW zip.
    let zipUrl = VIEWER_ZIP_URL;
    try {
      const api = await httpGet(`https://api.github.com/repos/${VIEWER_REPO}/releases/latest`);
      if (api.status === 200) {
        const release = JSON.parse(api.body.toString('utf8'));
        const assets: Array<{ name: string; browser_download_url: string }> = release.assets ?? [];
        const asset = assets.find((a) => /\.zip$/i.test(a.name));
        if (asset) zipUrl = asset.browser_download_url;
      }
    } catch { /* fallback URL */ }

    const archive = path.join(dir, 'viewer.zip');
    await downloadToFile(zipUrl, archive, onProgress);
    onProgress?.('Распаковка viewer…');
    if (process.platform === 'win32') {
      await new Promise<void>((resolve, reject) => {
        const ps = spawn('powershell.exe', [
          '-NoProfile', '-Command',
          `Expand-Archive -LiteralPath '${archive.replace(/'/g, "''")}' -DestinationPath '${dir.replace(/'/g, "''")}' -Force`,
        ], { windowsHide: true });
        ps.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Expand-Archive: ${code}`))));
        ps.on('error', reject);
      });
    } else {
      return { ok: false, error: 'Автоустановка viewer на этой ОС пока не поддерживается.' };
    }

    const index = findIndexHtml(dir);
    if (!index) return { ok: false, error: 'Viewer скачан, но index.html не найден' };
    return { ok: true, dir: path.dirname(index) };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

function exporterExePath(): string {
  const dir = toolsRoot();
  if (process.platform === 'win32') {
    const candidates = [
      path.join(dir, 'MinecraftWebExporter.exe'),
      path.join(dir, 'MinecraftWebExporter', 'MinecraftWebExporter.exe'),
    ];
    for (const c of candidates) if (fs.existsSync(c)) return c;
    return candidates[0];
  }
  const unix = path.join(dir, 'MinecraftWebExporter');
  return unix;
}

function worldExportHash(worldPath: string): string {
  return crypto.createHash('sha1').update(path.resolve(worldPath)).digest('hex').slice(0, 12);
}

function httpGet(url: string): Promise<{ status: number; body: Buffer; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, { headers: { 'User-Agent': 'UndefinedClient' } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpGet(res.headers.location).then(resolve, reject);
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode ?? 0,
        body: Buffer.concat(chunks),
        headers: res.headers,
      }));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function downloadToFile(url: string, dest: string, onProgress?: (msg: string) => void): Promise<void> {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  onProgress?.(`Скачивание ${path.basename(dest)}…`);
  const res = await httpGet(url);
  if (res.status !== 200) throw new Error(`HTTP ${res.status} для ${url}`);
  fs.writeFileSync(dest, res.body);
}

/** Ставит win-x64 self-contained релиз exporter'а, если exe ещё нет. */
export async function ensureWorldExporter(onProgress?: (msg: string) => void): Promise<{ ok: boolean; exe?: string; error?: string }> {
  const exe = exporterExePath();
  if (fs.existsSync(exe)) return { ok: true, exe };

  try {
    onProgress?.('Запрос релизов Minecraft Web Exporter…');
    const api = await httpGet(`https://api.github.com/repos/${EXPORTER_REPO}/releases/latest`);
    if (api.status !== 200) throw new Error(`GitHub API: HTTP ${api.status}`);
    const release = JSON.parse(api.body.toString('utf8'));
    const assets: Array<{ name: string; browser_download_url: string }> = release.assets ?? [];
    const asset = assets.find((a) => /win-x64|windows|win64/i.test(a.name) && /\.(zip|exe)$/i.test(a.name))
      ?? assets.find((a) => /\.zip$/i.test(a.name));
    if (!asset) {
      return {
        ok: false,
        error: 'В релизе exporter нет win-x64 ассета. Положите MinecraftWebExporter.exe в tools вручную.',
      };
    }

    const dir = toolsRoot();
    fs.mkdirSync(dir, { recursive: true });
    const archive = path.join(dir, asset.name);
    await downloadToFile(asset.browser_download_url, archive, onProgress);

    if (/\.exe$/i.test(asset.name)) {
      fs.renameSync(archive, exe);
    } else {
      onProgress?.('Распаковка exporter…');
      // Простая распаковка через PowerShell на Windows (без доп. зависимостей).
      if (process.platform === 'win32') {
        await new Promise<void>((resolve, reject) => {
          const ps = spawn('powershell.exe', [
            '-NoProfile', '-Command',
            `Expand-Archive -LiteralPath '${archive.replace(/'/g, "''")}' -DestinationPath '${dir.replace(/'/g, "''")}' -Force`,
          ], { windowsHide: true });
          ps.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Expand-Archive: ${code}`))));
          ps.on('error', reject);
        });
      } else {
        return { ok: false, error: 'Автоустановка exporter на этой ОС пока не поддерживается.' };
      }
    }

    const found = exporterExePath();
    if (!fs.existsSync(found)) {
      return { ok: false, error: 'Exporter скачан, но exe не найден — проверьте папку tools.' };
    }
    return { ok: true, exe: found };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

export interface ExportWorldResult {
  ok: boolean;
  outDir?: string;
  error?: string;
  log?: string;
}

/**
 * Запускает экспорт мира.
 * @param minecraftVersion строка версии или путь к jar (аргумент -m exporter'а)
 */
export async function exportWorldForPreview(
  worldPath: string,
  minecraftVersion: string,
  onProgress?: (msg: string) => void,
): Promise<ExportWorldResult> {
  const ensured = await ensureWorldExporter(onProgress);
  if (!ensured.ok || !ensured.exe) return { ok: false, error: ensured.error };

  const outDir = path.join(previewsRoot(), worldExportHash(worldPath));
  fs.mkdirSync(outDir, { recursive: true });

  // Exporter лучше кормить путём к jar (версии 26.x часто нет в его манифесте).
  let minecraftArg = minecraftVersion;
  try {
    const { findClientJar } = require('./clientJarAssets') as typeof import('./clientJarAssets');
    const jar = findClientJar(minecraftVersion);
    if (jar) {
      minecraftArg = jar;
      onProgress?.(`Jar клиента: ${path.basename(jar)}`);
    }
  } catch { /* jar необязателен */ }

  onProgress?.('Экспорт чанков (это может занять несколько минут)…');
  const args = [
    '-m', minecraftArg,
    '-w', worldPath,
    '-o', outDir,
    '-t', String(Math.max(2, Math.min(8, os.cpus()?.length || 4))),
  ];

  const logChunks: string[] = [];
  const code = await new Promise<number>((resolve, reject) => {
    const child = spawn(ensured.exe!, args, { windowsHide: true });
    child.stdout?.on('data', (d) => {
      const t = d.toString();
      logChunks.push(t);
      onProgress?.(t.trim().slice(0, 120) || 'Экспорт…');
    });
    child.stderr?.on('data', (d) => {
      const t = d.toString();
      logChunks.push(t);
      onProgress?.(t.trim().slice(0, 120) || 'Экспорт…');
    });
    child.on('error', reject);
    child.on('exit', (c) => resolve(c ?? 1));
  });

  if (code !== 0) {
    return {
      ok: false,
      error: `Exporter завершился с кодом ${code}`,
      log: logChunks.join('').slice(-4000),
      outDir,
    };
  }

  return { ok: true, outDir, log: logChunks.join('').slice(-2000) };
}

/** Собирает папку «viewer + экспорт» и открывает её в BrowserWindow. */
export async function openExportPreview(
  outDir: string,
  onProgress?: (msg: string) => void,
): Promise<{ ok: boolean; error?: string }> {
  if (!fs.existsSync(outDir)) return { ok: false, error: 'Папка экспорта не найдена' };

  const ensured = await ensureWorldViewer(onProgress);
  if (!ensured.ok || !ensured.dir) {
    // Fallback: открыть папку экспорта в проводнике.
    await shell.openPath(outDir);
    return { ok: false, error: ensured.error || 'Viewer недоступен — открыта папка экспорта' };
  }

  const viewDir = path.join(previewsRoot(), `${path.basename(outDir)}-view`);
  try {
    fs.rmSync(viewDir, { recursive: true, force: true });
  } catch { /* */ }
  onProgress?.('Сборка окна предпросмотра…');
  copyRecursive(ensured.dir, viewDir);
  copyRecursive(outDir, viewDir);

  const index = findIndexHtml(viewDir);
  if (!index) {
    await shell.openPath(outDir);
    return { ok: false, error: 'index.html viewer не найден после сборки' };
  }

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Undefined Client — экспорт мира',
    backgroundColor: '#101216',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  await win.loadFile(index);
  return { ok: true };
}

export function registerWorldExportIpc(): void {
  ipcMain.handle('world:ensure-exporter', async (event) => {
    const send = (msg: string) => {
      try { event.sender.send('world:export-progress', msg); } catch { /* окно закрыто */ }
    };
    return ensureWorldExporter(send);
  });

  ipcMain.handle('world:ensure-viewer', async (event) => {
    const send = (msg: string) => {
      try { event.sender.send('world:export-progress', msg); } catch { /* */ }
    };
    return ensureWorldViewer(send);
  });

  ipcMain.handle('world:export', async (event, worldPath: string, minecraftVersion: string) => {
    const send = (msg: string) => {
      try { event.sender.send('world:export-progress', msg); } catch { /* */ }
    };
    return exportWorldForPreview(String(worldPath || ''), String(minecraftVersion || '1.21.6'), send);
  });

  ipcMain.handle('world:open-export', async (event, outDir: string) => {
    const send = (msg: string) => {
      try { event.sender.send('world:export-progress', msg); } catch { /* */ }
    };
    return openExportPreview(String(outDir || ''), send);
  });
}
