import { app, BrowserWindow, ipcMain, shell, dialog, protocol, net } from 'electron';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { initLauncher, addProgressSink } from './launcher';
import { setApiBase, getApiBase } from '../shared/apiBase';
import {
  DEEP_LINK_SCHEME,
  findDeepLinkInArgv,
  parseDeepLink,
  resolveDeepLinkTarget,
  validateInstallPayload,
  type DeepLinkPayload,
} from './deepLink';
import { registerInstanceShareIpc } from './instanceShare';

// ===== Ленивая загрузка модуля просмотра мира =====
// worldViewer тянет prismarine-nbt (~100 мс на require), а нужен только при
// открытии окна мира или запросе списка миров. Подключаем при первом обращении
// и дорегистрируем IPC отложенно, чтобы не задерживать создание главного окна.
type WorldViewerModule = typeof import('./worldViewer');
let worldViewerModule: WorldViewerModule | null = null;
let worldViewerIpcReady = false;

function worldViewer(): WorldViewerModule {
  if (!worldViewerModule) worldViewerModule = require('./worldViewer') as WorldViewerModule;
  return worldViewerModule;
}

function ensureWorldViewerIpc(): void {
  if (worldViewerIpcReady) return;
  worldViewerIpcReady = true;
  worldViewer().registerWorldViewerIpc();
}

// ===== Кастомная схема для окна просмотра мира (PoC minecraft-renderer) =====
// WASM-мешер грузит модуль по абсолютному пути '/wasm_mesher_bg.wasm'; под file://
// такой путь не резолвится. Схема app:// делает окно обычным origin'ом, поэтому
// абсолютные пути и 'self' в CSP работают. Регистрация обязана произойти до app.whenReady.
// Главного окна это не касается — оно по-прежнему грузится через loadFile.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
  },
]);

const REPO_OWNER = 'studioberry-hub';
const REPO_NAME = 'client';
const UPDATE_ASSET = 'latest-windows-amd64.zip';
// ===== Базовый адрес нашего API =====
// Один адрес на все обращения к сайту лаунчера: новости, каталог, прокси CDN.
// UC_NEWS_API_BASE оставлен ради совместимости с уже настроенными окружениями.
setApiBase(process.env.UC_API_BASE || process.env.UC_NEWS_API_BASE);

function parseVersion(v: string): { nums: number[]; pre: boolean } {
  const s = String(v || '').trim().replace(/^v/i, '');
  const m = s.match(/^\d+(?:\.\d+)*/);
  const nums = m ? m[0].split('.').map(Number) : [];
  const pre = /(?:^|[-.])(alpha|beta|rc|pre|dev)\b/i.test(s);
  return { nums, pre };
}

function isNewerVersion(latest: string, current: string): boolean {
  const l = parseVersion(latest);
  const c = parseVersion(current);
  const len = Math.max(l.nums.length, c.nums.length);
  for (let i = 0; i < len; i++) {
    const a = l.nums[i] ?? 0;
    const b = c.nums[i] ?? 0;
    if (a !== b) return a > b;
  }
  if (l.pre !== c.pre) return c.pre;
  return false;
}

let mainWindow: BrowserWindow | null = null;
let consoleWindow: BrowserWindow | null = null;
let consoleLive = false;
const consoleLogHistory: any[] = [];

addProgressSink((data) => {
  consoleLogHistory.push(data);
  if (consoleLogHistory.length > 2000) consoleLogHistory.splice(0, consoleLogHistory.length - 2000);
  if (consoleLive && consoleWindow && !consoleWindow.isDestroyed()) {
    consoleWindow.webContents.send('launcher:progress', data);
  }
});

function createConsoleWindow(): void {
  if (consoleWindow && !consoleWindow.isDestroyed()) {
    consoleWindow.focus();
    return;
  }
  consoleLive = false;
  consoleWindow = new BrowserWindow({
    width: 900,
    height: 620,
    minWidth: 560,
    minHeight: 400,
    frame: false,
    transparent: false,
    backgroundColor: '#2A2A2A',
    show: false,
    icon: path.join(__dirname, '../../assets/icons/logo-40.svg'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  consoleWindow.loadFile(path.join(__dirname, '../../src/renderer/console.html'));

  consoleWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  consoleWindow.once('ready-to-show', () => {
    consoleWindow?.show();
  });

  consoleWindow.on('closed', () => {
    consoleWindow = null;
  });
}

// ===== Окно просмотра мира =====

let worldWindow: BrowserWindow | null = null;

/** Корень кастомного протокола: рядом лежат world.html, world.js, воркеры и wasm. */
const worldRoot = () => path.join(__dirname, '../../src/renderer/world');

function registerWorldProtocol(): void {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    const rel = decodeURIComponent(pathname).replace(/^[\\/]+/, '');
    const file = path.join(worldRoot(), rel);
    // Защита от выхода за пределы корня протокола.
    if (!file.startsWith(worldRoot())) {
      return new Response('Forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(file).toString());
  });
}

/** Путь к миру из аргументов запуска: `--world=<путь>` или `--world-path=<путь>`. */
function worldPathFromArgv(): string {
  for (const arg of process.argv) {
    const m = /^--world(?:-path)?=(.+)$/.exec(arg);
    if (m) return m[1].replace(/^"|"$/g, '');
  }
  return '';
}

/** Путь для автоматического скриншота окна мира: `--world-shot=<файл>`. */
function worldShotFromArgv(): string {
  for (const arg of process.argv) {
    const m = /^--world-shot=(.+)$/.exec(arg);
    if (m) return path.resolve(m[1].replace(/^"|"$/g, ''));
  }
  return '';
}

function createWorldWindow(worldPath = ''): void {
  if (worldWindow && !worldWindow.isDestroyed()) {
    worldWindow.focus();
    return;
  }
  ensureWorldViewerIpc();
  worldWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#101216',
    show: false,
    title: 'Undefined Client — просмотр мира',
    icon: path.join(__dirname, '../../assets/icons/logo-40.svg'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/world-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Путь к миру передаётся окну аргументом процесса рендерера, а не через URL:
      // так его видно в preload до загрузки документа.
      additionalArguments: [
        `--world-path=${encodeURIComponent(worldPath)}`,
        `--world-shot=${encodeURIComponent(worldShotFromArgv())}`,
      ],
    },
  });

  worldWindow.loadURL('app://local/world.html');

  // Лог окна мира дублируется в stdout процесса: окно диагностическое, и без этого
  // не видно ни ошибок мешера, ни статистики загрузки при запуске из консоли.
  worldWindow.webContents.on('console-message', (_event, _level, message) => {
    if (message.startsWith('[world')) console.log(message);
  });

  worldWindow.once('ready-to-show', () => {
    worldWindow?.show();
    if (process.argv.includes('--dev')) {
      worldWindow?.webContents.openDevTools({ mode: 'detach' });
    }
  });

  worldWindow.on('closed', () => {
    worldWindow = null;
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1028,
    height: 710,
    minWidth: 1028,
    minHeight: 710,
    frame: false,
    transparent: false,
    backgroundColor: '#2A2A2A',
    show: false,
    icon: path.join(__dirname, '../../assets/icons/logo-40.svg'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../../src/renderer/index.html'));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    if (process.argv.includes('--dev')) {
      mainWindow?.webContents.openDevTools({ mode: 'detach' });
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  initLauncher(mainWindow);
  ensureInstanceShareIpc();
}

// ===== Шаринг сборок =====

let instanceShareIpcReady = false;

function ensureInstanceShareIpc(): void {
  if (instanceShareIpcReady) return;
  instanceShareIpcReady = true;
  registerInstanceShareIpc(() => mainWindow);
}

// ===== Deep link uclient:// =====

/**
 * Ссылка, пришедшая до готовности рендерера (холодный старт). Рендерер забирает
 * её сам через `deeplink:consume`, когда UI уже собран.
 */
let pendingDeepLink: DeepLinkPayload | null = null;
let deepLinkRendererReady = false;

/**
 * Регистрация схемы на уровне ОС. В dev процесс запущен как `electron .`, поэтому
 * системе нужно передать путь к electron.exe и путь к проекту — иначе схема
 * укажет на сам electron.exe без аргументов. В установленной версии схему
 * прописывает Python-инсталлятор (`installer/installer.py`) в ветку
 * `HKCU\Software\Classes\uclient` — установка идёт per-user, поэтому куст
 * пользовательский. Этот вызов лишь подстраховывает: если запись в реестр при
 * установке не удалась (например, по правам), приложение восстановит её само.
 */
function registerDeepLinkScheme(): void {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME, process.execPath, [path.resolve(process.argv[1])]);
    }
    return;
  }
  app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);
}

function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.show();
  mainWindow.focus();
}

/**
 * Единая точка приёма ссылки: и для второго экземпляра, и для холодного старта,
 * и для macOS `open-url`. Отклонённая ссылка не приводит к падению и до
 * интерфейса не доходит — сообщать пользователю о чужой ссылке нечего.
 */
function handleDeepLink(raw: string): void {
  const parsed = parseDeepLink(raw);
  if (!parsed.ok) {
    console.log(`[deeplink] ссылка отклонена (${parsed.reason})`);
    return;
  }
  focusMainWindow();
  pendingDeepLink = parsed.payload;
  if (!deepLinkRendererReady || !mainWindow || mainWindow.isDestroyed()) return;
  pendingDeepLink = null;
  // Канал общий: рендерер смотрит на payload.action.
  mainWindow.webContents.send('deeplink:open', parsed.payload);
}

// Рендерер сообщает о готовности и одновременно забирает ссылку холодного старта.
ipcMain.handle('deeplink:consume', () => {
  deepLinkRendererReady = true;
  const payload = pendingDeepLink;
  pendingDeepLink = null;
  return payload;
});

// Данные приходят из рендерера, поэтому валидируются заново.
ipcMain.handle('deeplink:resolve', async (_event, payload: unknown) => {
  const checked = validateInstallPayload(payload);
  if (!checked.ok || checked.payload.action !== 'install') return { ok: false, code: 'bad_link' };
  return resolveDeepLinkTarget(checked.payload);
});

// macOS отдаёт ссылку событием; на Windows обработчик просто не срабатывает.
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

// Второй экземпляр держал бы лок профиля Chromium: первое обращение рендерера
// к localStorage в таком случае блокируется на ~6 секунд. Поэтому повторный
// запуск не поднимает окно, а передаёт фокус уже работающему.
const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) {
  app.quit();
}

app.on('second-instance', (_event, argv) => {
  if (!mainWindow) return;
  // На Windows ссылка запущенному приложению приезжает аргументом второго экземпляра.
  const link = findDeepLinkInArgv(argv);
  if (link) {
    handleDeepLink(link);
    return;
  }
  focusMainWindow();
});

app.whenReady().then(() => {
  if (!hasInstanceLock) return;

  registerWorldProtocol();
  registerDeepLinkScheme();
  createWindow();

  // Холодный старт по ссылке: ОС передаёт её в аргументах процесса. Задача
  // складывается в очередь и уходит рендереру, когда тот сообщит о готовности.
  const startupDeepLink = findDeepLinkInArgv(process.argv);
  if (startupDeepLink) handleDeepLink(startupDeepLink);

  // IPC окна мира регистрируется после показа главного окна: раньше он никому
  // не нужен, а его модуль тяжёлый.
  setTimeout(ensureWorldViewerIpc, 3000);

  // Окно мира открывается автоматически по флагу запуска:
  //   electron . --world                     — первый найденный мир в инстансах сборок
  //   electron . --world=<путь к папке мира>  — конкретный мир
  const worldArg = worldPathFromArgv();
  if (worldArg || process.argv.some((a) => a === '--world' || a.startsWith('--world='))) {
    createWorldWindow(worldArg);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Если модуль так и не понадобился, грузить его ради закрытия сессий незачем.
  worldViewerModule?.closeAllWorldSessions();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.on('window:minimize', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});

ipcMain.on('window:maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  if (win.isMaximized()) {
    win.unmaximize();
  } else {
    win.maximize();
  }
});

ipcMain.on('window:close', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});

ipcMain.handle('console:open', () => {
  createConsoleWindow();
});

ipcMain.handle('world:open', (_event, worldPath?: string) => {
  createWorldWindow(typeof worldPath === 'string' ? worldPath : '');
});

/** Список миров во всех инстансах — нужен окну выбора и автоподбору при `--world`. */
ipcMain.handle('world:list', () => worldViewer().listAllWorlds());

// Завершение автоматического прогона окна мира (снят скриншот, отчёт в логе).
ipcMain.handle('worldview:finish', () => {
  if (process.argv.includes('--world-exit')) {
    worldViewerModule?.closeAllWorldSessions();
    app.quit();
  }
});

ipcMain.handle('console:history', () => {
  consoleLive = true;
  return consoleLogHistory;
});

ipcMain.handle('console:save-log', async (_event, logContent: string) => {
  if (typeof logContent !== 'string') return { success: false, error: 'invalid content' };
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const res = await dialog.showSaveDialog({
      title: 'Undefined Client',
      defaultPath: `console-log-${stamp}.txt`,
      filters: [{ name: 'Text', extensions: ['txt'] }],
    });
    if (res.canceled || !res.filePath) return { success: false, canceled: true };
    fs.writeFileSync(res.filePath, logContent, 'utf-8');
    return { success: true, path: res.filePath };
  } catch (e: any) {
    return { success: false, error: e?.message || String(e) };
  }
});

ipcMain.handle('shell:openExternal', async (_event, url: string) => {
  if (typeof url === 'string' && (url.startsWith('https:') || url.startsWith('http:'))) {
    await shell.openExternal(url);
  }
});

ipcMain.handle('shell:openPath', async (_event, dirPath: string) => {
  if (typeof dirPath === 'string') {
    await shell.openPath(dirPath);
  }
});

ipcMain.handle('updates:current', () => app.getVersion());

ipcMain.handle('locale:load', async (_event, lang: string) => {
  if (typeof lang !== 'string' || !/^[a-z-]+$/.test(lang)) return null;
  const file = path.join(__dirname, '../../src/renderer/locales', `${lang}.json`);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
});

ipcMain.handle('updates:check', async () => {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`,
      {
        headers: {
          'User-Agent': 'Undefined-Client',
          'Accept': 'application/vnd.github+json',
        },
      },
    );
    if (!res.ok) return { error: `GitHub API ${res.status}` };
    const release = await res.json();
    const latest = String(release.tag_name || '');
    const current = app.getVersion();
    const assets: any[] = release.assets || [];
    const asset = assets.find((a: any) => a.name === UPDATE_ASSET)
      ?? assets.find((a: any) => String(a.name || '').toLowerCase().endsWith('.zip'));
    return {
      current,
      latest,
      updateAvailable: !!latest && isNewerVersion(latest, current),
      assetName: asset ? asset.name : null,
    };
  } catch (e: any) {
    return { error: e?.message || 'Network error' };
  }
});

ipcMain.handle('updates:launch', () => {
  try {
    const updater = path.join(path.dirname(app.getPath('exe')), 'updater.exe');
    if (!fs.existsSync(updater)) {
      return { success: false, error: 'updater.exe not found' };
    }
    const child = spawn(updater, [], { detached: true, stdio: 'ignore' });
    child.unref();
    setTimeout(() => app.quit(), 300);
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e?.message };
  }
});

// ===== Новости с сайта лаунчера =====

function newsApiLang(lang: unknown): 'ru' | 'en' {
  return lang === 'en' ? 'en' : 'ru';
}

ipcMain.handle('news:list', async (_event, lang?: string, limit?: number) => {
  const apiLang = newsApiLang(lang);
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  try {
    const res = await fetch(`${getApiBase()}/api/news?lang=${apiLang}&limit=${safeLimit}`, {
      headers: { 'User-Agent': 'Undefined-Client', Accept: 'application/json' },
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const data = await res.json();
    return { posts: Array.isArray(data.posts) ? data.posts : [], lang: apiLang };
  } catch (e: any) {
    return { error: e?.message || 'Network error' };
  }
});

ipcMain.handle('news:get', async (_event, id: string, lang?: string) => {
  if (typeof id !== 'string' || !id.trim()) return { error: 'invalid id' };
  const apiLang = newsApiLang(lang);
  try {
    const res = await fetch(
      `${getApiBase()}/api/news/${encodeURIComponent(id)}?lang=${apiLang}`,
      { headers: { 'User-Agent': 'Undefined-Client', Accept: 'application/json' } },
    );
    if (res.status === 404) return { error: 'not_found' };
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const data = await res.json();
    return { post: data.post || null, lang: apiLang };
  } catch (e: any) {
    return { error: e?.message || 'Network error' };
  }
});
