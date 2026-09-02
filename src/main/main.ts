import { app, BrowserWindow, ipcMain, shell, dialog, protocol, net, WebContentsView } from 'electron';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { initLauncher, addProgressSink } from './launcher';
import { setApiBase, getApiBase, releaseLatestUrl } from '../shared/apiBase';
import { registerMessengerIpc, getMessengerSessionToken } from './messenger-api';
import { registerGameRelayIpc, setMessengerTokenProvider, stopGameRelayOnQuit } from './game-relay';
import {
  DEEP_LINK_SCHEME,
  findDeepLinkInArgv,
  parseDeepLink,
  resolveDeepLinkTarget,
  validateInstallPayload,
  type DeepLinkPayload,
} from './deepLink';
import { registerInstanceShareIpc } from './instanceShare';
import { registerInstanceExportIpc } from './exportInstance';
import { listAiToolSchemas, registerAiToolIpc } from './ai-tools';

// ===== GPU / DirectX (ANGLE) до app.ready =====
// На Windows Chromium рисует WebGL через ANGLE→D3D11 — стабильный путь для
// суперсэмплинга и композитинга skinviewengine. Обязательно до whenReady().
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('use-angle', 'd3d11');
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
}

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
/** Последний акцент из рендерера — для консоли при открытии */
let lastAccentColor = '';
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
    if (lastAccentColor) {
      consoleWindow.webContents.send('theme:changed', lastAccentColor);
    }
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
    icon: path.join(__dirname, '../../assets/icons/Icon.svg'),
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
    if (lastAccentColor && consoleWindow && !consoleWindow.isDestroyed()) {
      consoleWindow.webContents.send('theme:changed', lastAccentColor);
    }
  });

  consoleWindow.on('closed', () => {
    consoleWindow = null;
  });
}

// ===== Просмотр мира (модалка в главном окне через WebContentsView) =====
// Отдельный webContents нужен: app://, wasm-воркеры, world-preload и свой CSP.
// WebContentsView рисуется поверх HTML в заданных bounds — «дырка» модалки.

let worldView: WebContentsView | null = null;
/** Путь мира, для которого создан текущий view (additionalArguments только при create). */
let worldViewPath = '';
/** Ожидает attach из рендерера после открытия chrome-модалки (CLI / гонка). */
let pendingWorldPath = '';

/** Корень кастомного протокола: рядом лежат world.html, world.js, воркеры и wasm. */
const worldRoot = () => path.join(__dirname, '../../src/renderer/world');

function registerWorldProtocol(): void {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    const rel = decodeURIComponent(pathname).replace(/^[\\/]+/, '');
    // Частые «пустые» запросы браузера — не шумим ERR_FILE_NOT_FOUND.
    if (!rel || rel === 'favicon.ico') {
      return new Response(null, { status: 204 });
    }

    const rootDir = path.resolve(worldRoot());
    // Шрифты ников / UI окна мира: app://local/fonts/... → assets/fonts/...
    const file = rel.startsWith('fonts/')
      ? path.resolve(path.join(__dirname, '../../assets', rel))
      : path.resolve(path.join(rootDir, rel));

    const assetsRoot = path.resolve(path.join(__dirname, '../../assets'));
    const allowed =
      file.startsWith(rootDir + path.sep) || file === rootDir
      || ((rel.startsWith('fonts/')) && (file.startsWith(assetsRoot + path.sep) || file === assetsRoot));
    if (!allowed) {
      return new Response('Forbidden', { status: 403 });
    }
    if (!fs.existsSync(file)) {
      return new Response(`Not found: ${rel}`, { status: 404 });
    }
    // Явный MIME для wasm: иначе instantiateStreaming падает и идёт медленный fallback.
    if (rel.endsWith('.wasm')) {
      const buf = fs.readFileSync(file);
      return new Response(buf, {
        status: 200,
        headers: {
          'Content-Type': 'application/wasm',
          'Content-Length': String(buf.byteLength),
        },
      });
    }
    if (rel.endsWith('.ttf') || rel.endsWith('.otf') || rel.endsWith('.woff2') || rel.endsWith('.woff')) {
      const buf = fs.readFileSync(file);
      const mime = rel.endsWith('.woff2') ? 'font/woff2'
        : rel.endsWith('.woff') ? 'font/woff'
        : rel.endsWith('.otf') ? 'font/otf'
        : 'font/ttf';
      return new Response(buf, {
        status: 200,
        headers: {
          'Content-Type': mime,
          'Content-Length': String(buf.byteLength),
        },
      });
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

type WorldViewBounds = { x: number; y: number; width: number; height: number };

function normalizeBounds(b: Partial<WorldViewBounds> | null | undefined): WorldViewBounds | null {
  if (!b) return null;
  const x = Math.round(Number(b.x) || 0);
  const y = Math.round(Number(b.y) || 0);
  const width = Math.max(1, Math.round(Number(b.width) || 0));
  const height = Math.max(1, Math.round(Number(b.height) || 0));
  if (!width || !height) return null;
  return { x, y, width, height };
}

function defaultWorldBounds(): WorldViewBounds {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { x: 24, y: 72, width: 980, height: 600 };
  }
  const [cw, ch] = mainWindow.getContentSize();
  const pad = 24;
  const header = 56;
  return {
    x: pad,
    y: pad + header,
    width: Math.max(1, cw - pad * 2),
    height: Math.max(1, ch - pad * 2 - header),
  };
}

function destroyWorldView(): void {
  if (!worldView) return;
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.contentView.removeChildView(worldView); } catch { /* */ }
  }
  try {
    if (!worldView.webContents.isDestroyed()) worldView.webContents.close();
  } catch { /* */ }
  worldView = null;
  worldViewPath = '';
}

/**
 * Встраивает просмотр мира в главное окно на заданный прямоугольник (DIP).
 * Путь мира — только через additionalArguments, поэтому при смене пути view пересоздаётся.
 */
function attachWorldView(worldPath: string, bounds?: WorldViewBounds | null): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  ensureWorldViewerIpc();
  const rect = normalizeBounds(bounds) || defaultWorldBounds();
  pendingWorldPath = worldPath;

  if (worldView && worldViewPath === worldPath) {
    worldView.setBounds(rect);
    try { worldView.webContents.focus(); } catch { /* */ }
    return;
  }

  destroyWorldView();
  worldViewPath = worldPath;
  worldView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, '../preload/world-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      additionalArguments: [
        `--world-path=${encodeURIComponent(worldPath)}`,
        `--world-shot=${encodeURIComponent(worldShotFromArgv())}`,
        '--world-embed=1',
      ],
    },
  });
  // Непрозрачный фон + скругление всей карточки (host = вся модалка).
  worldView.setBackgroundColor('#101216');
  try { worldView.setBorderRadius(12); } catch { /* */ }
  mainWindow.contentView.addChildView(worldView);
  worldView.setBounds(rect);
  worldView.webContents.loadURL('app://local/world.html');
  worldView.webContents.once('did-finish-load', () => {
    // После загрузки ещё раз выровнять bounds — layout модалки мог уточниться.
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('world:request-bounds-sync');
    }
  });
  worldView.webContents.on('console-message', (_event, _level, message) => {
    if (message.startsWith('[world')) console.log(message);
  });
  worldView.webContents.on('destroyed', () => {
    if (worldViewPath === worldPath) {
      worldView = null;
      worldViewPath = '';
    }
  });
  if (process.argv.includes('--dev')) {
    worldView.webContents.openDevTools({ mode: 'detach' });
  }
}

/** Просит рендерер открыть chrome-модалку; bounds придут через world:attach. */
function requestWorldModal(worldPath = ''): void {
  pendingWorldPath = worldPath;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('world:modal-open', { worldPath });
}

function createWorldWindow(worldPath = ''): void {
  // Совместимость CLI `--world`: сначала главное окно, затем модалка.
  requestWorldModal(worldPath);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 1100,
    minHeight: 800,
    frame: false,
    transparent: false,
    backgroundColor: '#2A2A2A',
    show: false,
    icon: path.join(__dirname, '../../assets/icons/Icon.svg'),
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
    destroyWorldView();
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
  registerInstanceExportIpc(() => mainWindow);
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

  // Просмотр мира по флагу запуска — модалка в главном окне после ready-to-show:
  //   electron . --world                     — первый найденный мир в инстансах сборок
  //   electron . --world=<путь к папке мира>  — конкретный мир
  const worldArg = worldPathFromArgv();
  if (worldArg || process.argv.some((a) => a === '--world' || a.startsWith('--world='))) {
    const openCliWorld = () => requestWorldModal(worldArg);
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isVisible()) openCliWorld();
      else mainWindow.once('ready-to-show', () => setTimeout(openCliWorld, 200));
    }
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
  stopGameRelayOnQuit();
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

/** Проброс смены акцента в окно консоли */
ipcMain.on('theme:changed', (_event, accent: unknown) => {
  const color = String(accent || '').trim();
  if (!color) return;
  lastAccentColor = color;
  if (!consoleWindow || consoleWindow.isDestroyed()) return;
  consoleWindow.webContents.send('theme:changed', color);
});

ipcMain.handle('console:append', (_event, message: unknown) => {
  const text = String(message ?? '').trim();
  if (!text) return { ok: false };
  const data = { kind: 'info', message: text };
  consoleLogHistory.push(data);
  if (consoleLogHistory.length > 2000) consoleLogHistory.splice(0, consoleLogHistory.length - 2000);
  if (consoleLive && consoleWindow && !consoleWindow.isDestroyed()) {
    consoleWindow.webContents.send('launcher:progress', data);
  }
  return { ok: true };
});

ipcMain.handle('world:open', (_event, worldPath?: string, profile?: { username?: string; uuid?: string; skinDataUrl?: string }, bounds?: WorldViewBounds) => {
  try {
    const { setWorldPreviewProfile } = require('./worldViewer') as typeof import('./worldViewer');
    if (profile && typeof profile === 'object') {
      setWorldPreviewProfile({
        username: String(profile.username || 'Player'),
        uuid: profile.uuid ? String(profile.uuid) : undefined,
        skinDataUrl: typeof profile.skinDataUrl === 'string' ? profile.skinDataUrl : undefined,
      });
    }
  } catch { /* */ }
  const pathStr = typeof worldPath === 'string' ? worldPath : '';
  pendingWorldPath = pathStr;
  const rect = normalizeBounds(bounds);
  if (rect && mainWindow && !mainWindow.isDestroyed()) {
    attachWorldView(pathStr, rect);
    return { ok: true, embedded: true };
  }
  // Bounds ещё нет — просим рендерер открыть модалку и вызвать world:attach.
  requestWorldModal(pathStr);
  return { ok: true, embedded: true, pending: true };
});

ipcMain.handle('world:attach', (_event, bounds?: WorldViewBounds) => {
  const pathStr = pendingWorldPath || worldViewPath || '';
  attachWorldView(pathStr, normalizeBounds(bounds));
  return { ok: true };
});

ipcMain.handle('world:set-bounds', (_event, bounds?: WorldViewBounds) => {
  if (!worldView) return { ok: false };
  const rect = normalizeBounds(bounds);
  if (rect) worldView.setBounds(rect);
  return { ok: true };
});

ipcMain.handle('world:close', () => {
  destroyWorldView();
  pendingWorldPath = '';
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('world:modal-closed');
  }
  return { ok: true };
});

try {
  require('./worldExport').registerWorldExportIpc();
  require('./clientJarAssets').registerClientJarIpc();
} catch (e) {
  console.warn('[worldExport] IPC не зарегистрирован:', e);
}

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

// ===== Вложения AI: выбор файлов + безопасное чтение текста =====
ipcMain.handle('dialog:pickFiles', async () => {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  const result = await dialog.showOpenDialog(win!, {
    title: 'Прикрепить к агенту',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Text / configs / logs', extensions: ['txt', 'log', 'json', 'md', 'cfg', 'properties', 'toml', 'yml', 'yaml', 'snbt'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (result.canceled) return [] as string[];
  return result.filePaths.slice(0, 12);
});

ipcMain.handle('ai:readAttachFile', async (_event, filePath: string) => {
  const raw = String(filePath || '').trim();
  if (!raw) return { error: 'empty_path' };
  const resolved = path.resolve(raw);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    return { error: 'not_found', path: resolved, name: path.basename(resolved) };
  }
  const name = path.basename(resolved);
  const ext = path.extname(resolved).toLowerCase().replace(/^\./, '');
  const textExt = new Set(['txt', 'log', 'json', 'md', 'cfg', 'properties', 'toml', 'yml', 'yaml', 'snbt', 'css', 'js', 'ts', 'xml', 'csv']);
  const stat = fs.statSync(resolved);
  if (stat.size > 2 * 1024 * 1024) {
    return { name, path: resolved, error: 'too_large' };
  }
  if (!textExt.has(ext)) {
    return { name, path: resolved };
  }
  try {
    const buf = fs.readFileSync(resolved);
    // Отсекаем явный бинарник
    if (buf.includes(0)) return { name, path: resolved };
    const text = buf.toString('utf-8').slice(0, 40_000);
    return { name, path: resolved, text };
  } catch (e: any) {
    return { name, path: resolved, error: e?.message || 'read_failed' };
  }
});

ipcMain.handle('shell:openPath', async (_event, dirPath: string) => {
  if (typeof dirPath !== 'string' || !dirPath.trim()) return 'invalid_path';
  // Пустая строка = успех (API Electron)
  return shell.openPath(dirPath);
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
  const current = app.getVersion();

  // ===== Сначала зеркало на сайте =====
  try {
    const res = await fetch(releaseLatestUrl(), {
      headers: {
        'User-Agent': 'Undefined-Client',
        Accept: 'application/json',
      },
    });
    if (res.ok) {
      const info: any = await res.json();
      const latest = String(info.tag || info.version || '');
      const assetName =
        info.zipFilename ||
        (info.zipDirectAvailable || info.zipGithubUrl ? UPDATE_ASSET : null);
      if (latest) {
        return {
          current,
          latest,
          updateAvailable: isNewerVersion(latest, current),
          assetName,
          source: 'site',
        };
      }
    }
  } catch {
    /* fallback на GitHub */
  }

  // ===== Fallback: GitHub Releases =====
  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`,
      {
        headers: {
          'User-Agent': 'Undefined-Client',
          Accept: 'application/vnd.github+json',
        },
      },
    );
    if (!res.ok) return { error: `GitHub API ${res.status}` };
    const release = await res.json();
    const latest = String(release.tag_name || '');
    const assets: any[] = release.assets || [];
    const asset = assets.find((a: any) => a.name === UPDATE_ASSET)
      ?? assets.find((a: any) => String(a.name || '').toLowerCase().endsWith('.zip'));
    return {
      current,
      latest,
      updateAvailable: !!latest && isNewerVersion(latest, current),
      assetName: asset ? asset.name : null,
      source: 'github',
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

// ===== AI-агент через сайт (прокси Timeweb + MCP tools на клиенте) =====

registerAiToolIpc();
registerMessengerIpc();
setMessengerTokenProvider(() => getMessengerSessionToken());
registerGameRelayIpc();

ipcMain.handle('ai:status', async () => {
  try {
    const token = getMessengerSessionToken();
    const headers: Record<string, string> = {
      'User-Agent': 'Undefined-Client',
      Accept: 'application/json',
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${getApiBase()}/api/ai/status`, { headers });
    if (!res.ok) return { configured: false, access: false, error: `HTTP ${res.status}` };
    return await res.json();
  } catch (e: any) {
    return { configured: false, access: false, error: e?.message || 'Network error' };
  }
});

ipcMain.handle('ai:chat', async (_event, payload: any) => {
  const messages = Array.isArray(payload) ? payload : payload?.messages;
  const enableTools = Array.isArray(payload) ? true : payload?.tools !== false;
  const context = Array.isArray(payload) ? null : payload?.context || null;
  if (!Array.isArray(messages) || !messages.length) {
    return { error: 'empty_messages' };
  }

  // Жёсткий потолок на main: клиент уже сжимает историю, здесь страховка от раздувания
  const mapped = messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant' || m.role === 'tool'))
    .slice(-48)
    .map((m) => {
      if (m.role === 'tool') {
        return {
          role: 'tool',
          tool_call_id: String(m.tool_call_id || ''),
          content: String(m.content || '').slice(0, 4000),
        };
      }
      const msg: any = {
        role: m.role,
        content: m.content == null ? null : String(m.content).slice(0, 8000),
      };
      if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
        msg.tool_calls = m.tool_calls;
      }
      return msg;
    })
    .filter((m) => {
      if (m.role === 'tool') return Boolean(m.tool_call_id && m.content?.trim());
      if (m.role === 'assistant' && m.tool_calls?.length) return true;
      return Boolean(String(m.content || '').trim());
    });
  // slice(-120) мог отрезать assistant с tool_calls, оставив «осиротевшие» tool
  const safe: any[] = [];
  let pending = new Set<string>();
  const flushPending = (reason: string) => {
    for (const id of pending) {
      safe.push({ role: 'tool', tool_call_id: id, content: JSON.stringify({ error: reason }) });
    }
    pending = new Set();
  };
  for (const m of mapped) {
    if (m.role === 'user') {
      flushPending('interrupted');
      safe.push(m);
      continue;
    }
    if (m.role === 'assistant') {
      flushPending('interrupted');
      const tcs = Array.isArray(m.tool_calls) ? m.tool_calls.filter((tc: any) => tc?.id) : [];
      if (tcs.length) {
        safe.push({ ...m, tool_calls: tcs, content: m.content == null || m.content === '' ? null : m.content });
        pending = new Set(tcs.map((tc: any) => String(tc.id)));
      } else if (String(m.content || '').trim()) {
        safe.push({ role: 'assistant', content: String(m.content) });
      }
      continue;
    }
    if (m.role === 'tool') {
      const id = String(m.tool_call_id || '');
      if (!id || !pending.has(id)) continue;
      pending.delete(id);
      safe.push(m);
    }
  }
  flushPending('incomplete');
  if (!safe.length) return { error: 'empty_messages' };

  try {
    const body: any = { messages: safe };
    if (enableTools) body.tools = listAiToolSchemas({ compact: true });
    if (context && typeof context === 'object') {
      body.context = {
        buildId: context.buildId ? String(context.buildId).slice(0, 80) : undefined,
        buildName: context.buildName ? String(context.buildName).slice(0, 120) : undefined,
      };
    }

    const token = getMessengerSessionToken();
    const res = await fetch(`${getApiBase()}/api/ai/chat`, {
      method: 'POST',
      headers: {
        'User-Agent': 'Undefined-Client',
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const code = data?.code || (res.status === 403 ? 'access_denied' : undefined);
      return {
        error: data?.error || `HTTP ${res.status}`,
        code,
        reason: data?.reason,
      };
    }
    return {
      reply: String(data.reply || ''),
      model: data.model || null,
      toolsEnabled: Boolean(data.toolsEnabled),
      toolCalls: Array.isArray(data.toolCalls) ? data.toolCalls : [],
    };
  } catch (e: any) {
    return { error: e?.message || 'Network error' };
  }
});
