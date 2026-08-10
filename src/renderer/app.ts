import {
  BustPoseAnimation,
  createSkinAnimation,
  DEFAULT_SKIN_DEBUG_OPTIONS,
  SkinModelType,
  SkinViewEngine,
  type ShotPresetId,
  type SkinAnimId,
  type SkinDebugOptions,
} from 'skinviewengine';
import { marked } from 'marked';
import { setApiBase, getApiBase, catalogImageUrl, skinImageUrl } from '../shared/apiBase';

interface NewsPostSummary {
  id: string;
  title: string;
  summary: string;
  cover: string | null;
  publishedAt: string;
  author: string;
  hasEn?: boolean;
}

interface NewsPostFull extends NewsPostSummary {
  content: string;
  contentHtml?: string;
  media?: { url: string; type: string; alt?: string }[];
  updatedAt?: string;
}

// ===== Deep link uclient:// =====
// Задача установки, пришедшая с сайта лаунчера. Валидация выполнена в main —
// сюда попадают только проверенные значения, но `name` всё равно выводим текстом.

interface DeepLinkInstall {
  action: 'install';
  source: 'modrinth';
  type: 'mod' | 'modpack' | 'datapack' | 'resourcepack' | 'shader';
  project: string;
  /** Пустая строка — «последняя подходящая версия». */
  version: string;
  name: string;
  gameVersion: string;
  loader: string;
}

interface DeepLinkImportInstance {
  action: 'import-instance';
  id: string;
}

type DeepLinkPayload = DeepLinkInstall | DeepLinkImportInstance;

interface InstanceShareCounts {
  mods: number;
  resourcePacks: number;
  shaders: number;
  dataPacks: number;
}

interface InstanceShareManifest {
  id: string;
  name: string;
  iconUrl?: string;
  iconBg?: string;
  iconPreset?: string;
  gameVersion: string;
  loader: string;
  loaderVersion: string;
  counts: InstanceShareCounts;
  authorName?: string;
  files?: unknown[];
}

interface DeepLinkVersion {
  id: string;
  name: string;
  versionNumber: string;
  versionType: string;
  gameVersions: string[];
  loaders: string[];
  datePublished: string;
  filename: string;
  size: number;
}

interface DeepLinkProject {
  id: string;
  slug: string;
  title: string;
  description: string;
  iconUrl: string;
  projectType: string;
}

type DeepLinkResolveResult =
  | { ok: true; project: DeepLinkProject; versions: DeepLinkVersion[]; versionId: string }
  | { ok: false; code: string; actualType?: string };

interface ElectronAPI {
  windowMinimize: () => void;
  windowMaximize: () => void;
  windowClose: () => void;
  getPlatformInfo: () => { platform: string; nodeVersion: string };
  launch: (config: any) => Promise<{ success: boolean; error?: string; errorKey?: string }>;
  authOffline: (username: string) => Promise<{ name: string; uuid: string; type: string }>;
  authMicrosoft: () => Promise<{ name: string; uuid: string; type: string }>;
  authEly: () => Promise<any>;
  refreshAccount: (account: any) => Promise<any>;
  saveAccount: (account: any) => Promise<any>;
  loadAccounts: () => Promise<any[]>;
  removeAccount: (uuid: string) => Promise<any>;
  saveBuild: (build: any) => Promise<any>;
  loadBuilds: () => Promise<any[]>;
  removeBuild: (id: string) => Promise<any>;
  /** Имена файлов из assets/InstancesIcons (подхватываются на лету) */
  listInstanceIcons: () => Promise<string[]>;
  saveServer: (server: any) => Promise<any>;
  loadServers: () => Promise<any[]>;
  removeServer: (id: string) => Promise<any>;
  serverStatus: (ip: string) => Promise<any>;
  fetchServerCatalog: () => Promise<any[]>;
  getSkinData: (uuid: string, serverUrl?: string) => Promise<{ skinUrl: string | null; capeUrl: string | null } | null>;
  fetchSkinImage: (url: string) => Promise<string | null>;
  getElyWornSkin: (nickname: string, force?: boolean) => Promise<string | null>;
  saveSkin: (skin: {
    id: string;
    name: string;
    dataUrl: string;
    accountId?: string;
    mojangCapeId?: string;
  }) => Promise<any>;
  loadSkins: () => Promise<any[]>;
  removeSkin: (id: string) => Promise<any>;
  applyCosmetics: (payload: any) => Promise<{
    success: boolean;
    uploaded?: boolean;
    capeSwitched?: boolean;
    local?: boolean;
    csl?: boolean;
    error?: string;
    rateLimited?: boolean;
    /** Открыть страницу смены скина (Ely.by), если API недоступен */
    openWeb?: string;
  }>;
  listProfileCosmetics: (account: any) => Promise<{ success: boolean; skins?: any[]; capes?: any[]; account?: any; error?: string }>;
  switchAccountCape: (account: any, capeId: string | null) => Promise<{ success: boolean; capes?: any[]; error?: string }>;
  getModrinthProjects: (query: string, type: string, offset?: number, limit?: number, opts?: { categories?: string[]; loaders?: string[]; version?: string; index?: string }) => Promise<{ hits?: any[]; total_hits?: number; error?: string }>;
  getModrinthProject: (projectId: string) => Promise<any>;
  getModrinthVersions: (projectId: string) => Promise<any[]>;
  downloadMod: (projectId: string, versionId?: string) => Promise<{ success: boolean; filename?: string; error?: string; buildCreated?: boolean; build?: any }>;
  installMod: (buildId: string, projectId: string, versionId?: string, contentType?: string) => Promise<{ success: boolean; name?: string; version?: string; filename?: string; projectId?: string; iconUrl?: string; description?: string; contentType?: string; error?: string }>;
  resolveProjectByName: (name: string) => Promise<{ projectId: string; iconUrl: string; title: string; description: string } | null>;
  getVersions: () => Promise<any[]>;
  getLoaderVersions: (loader: string, mcVersion: string) => Promise<string[]>;
  detectJava: () => Promise<{ name: string; path: string; version: number }[]>;
  listJavaVersions: () => Promise<{ version: number; installed: boolean; managed: boolean; path: string | null; systemPaths: string[] }[]>;
  installJava: (version: number) => Promise<{ success: boolean; path?: string; error?: string }>;
  removeJava: (version: number) => Promise<{ success: boolean; error?: string }>;
  resolveJavaVersion: (gameVersion: string) => Promise<{ success: boolean; version?: number; error?: string }>;
  onJavaProgress: (callback: (data: any) => void) => () => void;
  getCrashReport: (buildId: string) => Promise<string | null>;
  getAppVersion: () => Promise<string>;
  loadLocale: (lang: string) => Promise<Record<string, string> | null>;
  setLanguage: (lang: string) => void;
  updatePresence: (data: { screen?: string; account?: { name: string; avatar: string } | null }) => void;
  checkForUpdates: () => Promise<{ current: string; latest: string; updateAvailable: boolean; error?: string }>;
  launchUpdater: () => Promise<{ success: boolean; error?: string }>;
  fetchNewsList: (lang?: string, limit?: number) => Promise<{ posts?: NewsPostSummary[]; error?: string }>;
  fetchNewsPost: (id: string, lang?: string) => Promise<{ post?: NewsPostFull | null; error?: string }>;
  consumeDeepLink: () => Promise<DeepLinkPayload | null>;
  resolveDeepLink: (payload: DeepLinkInstall) => Promise<DeepLinkResolveResult>;
  onDeepLink: (callback: (payload: DeepLinkPayload) => void) => () => void;
  createInstanceShare: (buildId: string, opts?: { authorName?: string }) => Promise<{
    ok: boolean;
    id?: string;
    url?: string;
    deepLink?: string;
    counts?: InstanceShareCounts;
    error?: string;
  }>;
  getInstanceShare: (id: string) => Promise<{ ok: boolean; manifest?: InstanceShareManifest; error?: string }>;
  importInstanceShare: (id: string) => Promise<{ ok: boolean; build?: any; error?: string }>;
  onInstanceShareProgress: (callback: (data: any) => void) => () => void;
  onDownloadProgress: (callback: (data: any) => void) => () => void;
  onLauncherStatus: (callback: (data: any) => void) => () => void;
  onLauncherLog: (callback: (data: string) => void) => () => void;
  onLauncherDownload: (callback: (data: any) => void) => () => void;
  onLaunchProgress: (callback: (data: any) => void) => () => void;
  openConsole: () => Promise<void>;
  getConsoleHistory: () => Promise<any[]>;
  saveConsoleLog: (logContent: string) => Promise<{ success: boolean; canceled?: boolean; path?: string; error?: string }>;
  onConsoleLog: (callback: (data: any) => void) => () => void;
  openExternal: (url: string) => Promise<void>;
  openPath: (dirPath: string) => Promise<void>;
  saveLogFile: (buildId: string, logContent: string) => Promise<{ success: boolean; path?: string; error?: string }>;
  getInstancePath: (buildId: string) => Promise<string>;
  listScreenshots: (buildId: string) => Promise<{ name: string; size: number; modified: number; thumb: string }[]>;
  listWorlds: (buildId: string) => Promise<{ name: string; folder: string; icon: string; lastPlayed: number; gameType: number; hardcore: boolean; difficulty: number; version: string; size: number }[]>;
  deleteInstanceFiles: (buildId: string, sub: string, names: string[]) => Promise<{ success: boolean; deleted?: number; error?: string }>;
  saveInstanceFiles: (buildId: string, sub: string, names: string[]) => Promise<{ success: boolean; saved?: number; canceled?: boolean; error?: string }>;
  scanInstance: (buildId: string) => Promise<{ mods: any[]; resourcepacks: any[]; shaders: any[]; datapacks: any[] }>;
  watchInstance: (buildId: string) => Promise<void>;
  unwatchInstance: (buildId: string) => Promise<void>;
  onInstanceChanged: (callback: (buildId: string, data: any) => void) => () => void;
  debugStall: (ms: number) => void;
  /** Базовый адрес нашего API; вычисляется в preload по переменным окружения. */
  apiBase?: string;
}

const api = (window as unknown as { electronAPI?: ElectronAPI }).electronAPI;

// Синхронизируем базовый адрес до первой отрисовки: иконки строятся от него.
setApiBase(api?.apiBase);

const ELY_AUTH_SERVER = 'https://authserver.ely.by';

// ===== Иконки Modrinth =====
// cdn.modrinth.com у части российских провайдеров недоступен, поэтому картинки
// каталога и сборок грузятся через прокси на нашем сервере. Чужие хосты и
// локальные пути catalogImageUrl отдаёт без изменений.

/** Адрес иконки сборки: пресет из ассетов, картинка Modrinth или свой файл. */
function buildIconSrc(icon: string): string {
  if (icon.startsWith('preset:')) return `../../assets/InstancesIcons/${icon.slice(7)}`;
  if (icon.startsWith('modrinth:')) return catalogImageUrl(icon.slice(9));
  return icon;
}

// ===== Иконки сборок (сетка из assets/InstancesIcons) =====
/** Текущий выбор в модалке: preset:… / modrinth:… / data:… / URL */
let pendingBuildIcon: string | undefined;

function setBuildIconPreview(icon: string | undefined): void {
  const preview = document.getElementById('modal-build-icon-preview');
  if (!preview) return;
  if (!icon) {
    preview.innerHTML = '';
    return;
  }
  preview.innerHTML = `<img src="${buildIconSrc(icon)}" style="width:100%;height:100%;object-fit:cover;">`;
}

function bindInstanceIconOpt(el: Element): void {
  el.addEventListener('click', () => {
    document.querySelectorAll('#modal-build .be-icon-opt.selected').forEach((e) => e.classList.remove('selected'));
    el.classList.add('selected');
    const filename = (el as HTMLElement).getAttribute('data-icon') || '';
    pendingBuildIcon = filename ? `preset:${filename}` : undefined;
    setBuildIconPreview(pendingBuildIcon);
    const fileInput = document.getElementById('modal-build-icon-input') as HTMLInputElement | null;
    if (fileInput) fileInput.value = '';
  });
}

/**
 * Заполняет сетку всеми картинками из assets/InstancesIcons.
 * Регистрация в коде не нужна — достаточно положить файл в папку.
 * Вызывается при открытии модалки, чтобы подхватить новые файлы без перезапуска.
 */
async function ensureInstanceIconGrid(): Promise<void> {
  const grid = document.getElementById('modal-build-icon-grid')
    || document.querySelector('#modal-build .be-icon-grid');
  if (!grid) return;

  let files: string[] = [];
  try {
    files = (await api?.listInstanceIcons?.()) || [];
  } catch (err) {
    console.warn('[instance-icons] list failed', err);
  }

  if (!files.length) {
    grid.querySelectorAll('.be-icon-opt').forEach(bindInstanceIconOpt);
    return;
  }

  const selectedName = pendingBuildIcon?.startsWith('preset:')
    ? pendingBuildIcon.slice(7)
    : null;

  grid.innerHTML = '';
  for (const filename of files) {
    const img = document.createElement('img');
    img.src = `../../assets/InstancesIcons/${filename}`;
    img.className = 'be-icon-opt';
    img.setAttribute('data-icon', filename);
    img.loading = 'lazy';
    img.alt = filename.replace(/\.[^.]+$/, '');
    if (selectedName && filename === selectedName) img.classList.add('selected');
    bindInstanceIconOpt(img);
    grid.appendChild(img);
  }
}

/* ===== DEBUG: renderer stall watchdog ===== */

let lastRendererTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const stall = now - lastRendererTick - 500;
  lastRendererTick = now;
  if (stall > 1000) {
    api?.debugStall?.(Math.round(stall));
  }
}, 500);

/* ===== I18N ===== */

let currentLang = 'ru';
let dict: Record<string, string> = {};

function tr(key: string, params?: Record<string, string | number>): string {
  let text = dict[key] || key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.split(`{${k}}`).join(String(v));
    }
  }
  return text;
}

function t(key: string, params?: Record<string, string | number>): string {
  return tr(key, params);
}

function applyStaticI18n(): void {
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (!key) return;
    if (el.querySelector('*')) {
      el.childNodes.forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) node.textContent = tr(key);
      });
    } else {
      el.textContent = tr(key);
    }
  });
  document.querySelectorAll<HTMLInputElement>('[data-i18n-ph]').forEach(el => {
    el.placeholder = tr(el.getAttribute('data-i18n-ph') || '');
  });
  document.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach(el => {
    el.title = tr(el.getAttribute('data-i18n-title') || '');
  });
  document.querySelectorAll<HTMLElement>('[data-i18n-html]').forEach(el => {
    el.innerHTML = tr(el.getAttribute('data-i18n-html') || '');
  });
}

async function setLang(lang: string): Promise<void> {
  const resolvedLang = lang || 'ru';
  if (resolvedLang === currentLang && Object.keys(dict).length > 0) return;

  let json: Record<string, string> | null = null;
  if (api?.loadLocale) {
    try {
      json = await api.loadLocale(resolvedLang);
    } catch { /* fall through */ }
  }
  if (!json) {
    try {
      const res = await fetch(`locales/${resolvedLang}.json`);
      if (res.ok) json = await res.json();
    } catch { /* fall through */ }
  }
  if (!json && resolvedLang !== 'ru') {
    await setLang('ru');
    return;
  }
  if (!json) return;

  const prevNewsLang = newsApiLang();
  dict = json;
  currentLang = resolvedLang;
  api?.setLanguage?.(currentLang);
  applyStaticI18n();
  refreshAllDynamicText();
  void loadNews(newsApiLang() !== prevNewsLang || !newsLoaded);
}

let appVersion: string = '';

function refreshAllDynamicText(): void {
  renderBuilds();
  renderHomeBuilds();
  renderServers();
  renderHomeServers();
  renderSkinsList();
  renderCapesList();
  void renderSavedAccounts();
  applyAccountTypeLabel();
  updateStats();
  updateSidebarCards();
  if (!runningBuild) updateBanner();
  if (modsData.length > 0) renderMods(false);
  renderHomeNews();
  if (newsLoaded) renderNews();
  syncCustomSelects();
  if (ramSlider && ramLabel) ramLabel.textContent = ramSlider.value + t('common.mb');
  const aboutVer = document.getElementById('about-version');
  if (aboutVer && appVersion) aboutVer.textContent = `${t('about.version')} ${appVersion}`;
}

/* ===== TITLEBAR ===== */

document.getElementById('btn-min')?.addEventListener('click', () => api?.windowMinimize());
document.getElementById('btn-max')?.addEventListener('click', () => api?.windowMaximize());
document.getElementById('btn-close')?.addEventListener('click', () => api?.windowClose());

/* ===== TAB SWITCHING ===== */

function switchTab(target: string): void {
  if (!target) return;
  tabs.forEach(t => t.classList.remove('active'));
  tabViews.forEach(v => v.classList.remove('active'));
  const tabBtn = document.querySelector<HTMLElement>(`.tab-btn[data-tab="${target}"]`);
  if (tabBtn) tabBtn.classList.add('active');
  const targetView = document.getElementById(`tab-${target}`);
  if (targetView) targetView.classList.add('active');
  presenceTab = target;
  pushPresence(target);
  setSkinViewerPaused(target !== 'skins');
  syncWallpaper(target);
  if (target === 'skins') void ensureSkinTab();
  if (target === 'mods') void ensureModsCatalog();
  if (target === 'servers') void loadServerCatalog();
  if (target === 'home') renderHomeNews();
  if (target === 'news') void loadNews(false);
}

/** requestIdleCallback с фолбэком: прогрев тяжёлых вкладок в простое после старта. */
function scheduleIdle(fn: () => void, timeout = 2000): void {
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (ric) ric(fn, { timeout });
  else setTimeout(fn, timeout);
}

let presenceTab = 'home';
let presenceScreen = 'home';

let wallpaperStart: (() => void) | null = null;
let wallpaperStop: (() => void) | null = null;

function syncWallpaper(activeTab?: string): void {
  const tab = activeTab ?? presenceTab;
  if (!wallpaperStart || !wallpaperStop) return;
  const visible = tab === 'home' && !document.hidden && document.visibilityState === 'visible';
  if (visible) {
    wallpaperStart();
  } else {
    wallpaperStop();
  }
}

document.addEventListener('visibilitychange', () => {
  if (!wallpaperStart) return;
  setSkinViewerPaused(document.hidden || presenceTab !== 'skins');
  const fn = document.hidden ? wallpaperStop : wallpaperStart;
  if (fn) fn();
});

async function getElyAvatarUrl(acc: any, force = false): Promise<string | null> {
  if (!force && acc?.skinUrl && !acc.skinUrl.includes('textures.minecraft.net')) return acc.skinUrl;
  if (api?.getElyWornSkin) {
    try {
      const url = await api.getElyWornSkin(acc?.username || acc?.name || '', force);
      if (url) {
        if (acc.skinUrl !== url) {
          acc.skinUrl = url;
          if (acc.uuid) await api?.saveAccount?.({ ...acc, name: acc.username });
        }
        return url;
      }
    } catch {}
  }
  return acc?.skinUrl && !acc.skinUrl.includes('textures.minecraft.net') ? acc.skinUrl : null;
}

// ===== Аватарка аккаунта =====
// Голова скина рендерится на mc-heads.net, а этот домен у части российских
// провайдеров недоступен — у лицензионных аккаунтов аватарка просто не
// появлялась. Основной путь теперь наш прокси, прямой адрес остаётся резервом
// на случай, когда недоступен уже наш сервер.

/** Прямой адрес головы скина (без прокси). */
function accountAvatarDirectUrl(acc: any): string {
  if (acc?.meta?.type === 'yggdrasil') {
    return acc?.skinUrl && !acc.skinUrl.includes('textures.minecraft.net')
      ? acc.skinUrl
      : 'https://mc-heads.net/avatar/steve/64';
  }
  const offline = acc?.type === 'crack' || acc?.type === 'offline';
  if (offline) return 'https://mc-heads.net/avatar/steve/64';
  const uuid = String(acc.uuid || '').replace(/-/g, '');
  // mc-heads кэширует голову по uuid — bust по ревизии после смены скина
  const rev = acc?.avatarRev || '';
  const base = `https://mc-heads.net/avatar/${uuid}/64`;
  return rev ? `${base}?t=${encodeURIComponent(String(rev))}` : base;
}

/** Пара «через прокси → напрямую». Резерв пуст, если хост прокси не принимает. */
function accountAvatarSources(acc: any): { primary: string; fallback: string } {
  const direct = accountAvatarDirectUrl(acc);
  const proxied = skinImageUrl(direct);
  return { primary: proxied, fallback: proxied === direct ? '' : direct };
}

/**
 * Резерв для картинки: при ошибке загрузки один раз пробуем прямой адрес,
 * и только если не вышло и он — прячем картинку и показываем заглушку.
 */
function bindImageFallback(img: HTMLImageElement, onGiveUp?: () => void): void {
  img.addEventListener('error', () => {
    const next = img.dataset.fallback || '';
    if (next) {
      img.dataset.fallback = '';
      img.src = next;
      return;
    }
    img.style.display = 'none';
    onGiveUp?.();
  });
}

/** Голова 8×8 (+ overlay) из полной текстуры скина — без зависимости от кэша mc-heads */
function drawSkinHeadAvatar(skinDataUrl: string, size = 32): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(null); return; }
      ctx.imageSmoothingEnabled = false;
      const scale = img.width / 64;
      const h = 8 * scale;
      ctx.drawImage(img, 8 * scale, 8 * scale, h, h, 0, 0, size, size);
      ctx.drawImage(img, 40 * scale, 8 * scale, h, h, 0, 0, size, size);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => resolve(null);
    img.src = skinDataUrl;
  });
}

/** @deprecated используйте drawSkinHeadAvatar */
const drawElyAvatar = drawSkinHeadAvatar;

/** Обновить аватарки текущего аккаунта в UI из текстуры скина */
async function refreshAccountUiAvatar(skinDataUrl: string): Promise<void> {
  if (!skinDataUrl) return;
  const avatar = await drawSkinHeadAvatar(skinDataUrl);
  if (!avatar) return;
  // Кэш для селектора/списка — не ждать upload на Mojang и не брать старый license-skin
  currentAccount = { ...currentAccount, uiAvatarDataUrl: avatar };
  try {
    await api?.saveAccount?.({
      ...currentAccount,
      name: currentAccount.username,
      uiAvatarDataUrl: avatar,
    });
  } catch { /* ignore */ }

  setSkinImage('.account-skin-img', '.account-skin-placeholder', avatar);
  setSkinImage('.account-popup-skin-img', '.account-popup-skin-placeholder', avatar);
  // Строка в списке аккаунтов тоже должна обновиться сразу
  const uuid = String(currentAccount?.uuid || '');
  if (uuid) {
    const rowImg = document.querySelector<HTMLImageElement>(
      `#acc-popup-list .acc-popup-row[data-uuid="${uuid}"] img`,
    );
    if (rowImg) {
      const small = await drawSkinHeadAvatar(skinDataUrl, 32);
      if (small) {
        rowImg.src = small;
        rowImg.style.display = 'block';
        rowImg.dataset.fallback = '';
      }
    }
  }
}

/** Голова аккаунта из реальной текстуры (Mojang / Ely), без кэша mc-heads */
async function resolveAccountHeadAvatar(acc: any): Promise<string | null> {
  if (!acc) return null;
  // Уже отрисованная голова после смены скина в лаунчере
  if (acc.uiAvatarDataUrl && String(acc.uiAvatarDataUrl).startsWith('data:')) {
    return acc.uiAvatarDataUrl;
  }
  if (!api?.fetchSkinImage) return null;
  const type = acc.meta?.type || acc.type;
  const accKey = String(acc.uuid || '').replace(/-/g, '').toLowerCase();
  const isCurrent = accKey && accKey === accountCosmeticsKey();

  // Текущий аккаунт — голова из активного скина в UI (не только license/ely профиля)
  if (isCurrent) {
    const activeId = getActiveSkinId();
    const active = activeId
      ? savedSkins.find((s) => s.id === activeId && s.dataUrl)
      : null;
    if (active?.dataUrl) return drawSkinHeadAvatar(active.dataUrl, 32);
  }

  if (type === 'yggdrasil') {
    const url = await getElyAvatarUrl(acc, true);
    if (!url) return null;
    const b64 = await api.fetchSkinImage(url);
    return b64 ? drawSkinHeadAvatar(`data:image/png;base64,${b64}`, 32) : null;
  }
  if (type === 'msa' && accKey) {
    const local = savedSkins.find((s) => s.id === `license-skin-${accKey}` && s.dataUrl);
    if (local?.dataUrl) return drawSkinHeadAvatar(local.dataUrl, 32);
    if (!api.getSkinData) return null;
    const data = await api.getSkinData(accKey);
    if (!data?.skinUrl) return null;
    const b64 = await api.fetchSkinImage(data.skinUrl);
    return b64 ? drawSkinHeadAvatar(`data:image/png;base64,${b64}`, 32) : null;
  }
  return null;
}

/** Запомнить ревизию скина (для Discord / mc-heads) и обновить presence */
async function bumpAccountAvatarRev(skinHint?: string): Promise<void> {
  const rev = skinHint
    ? String(skinHint).replace(/^.*\//, '').slice(0, 32) || String(Date.now())
    : String(Date.now());
  currentAccount = { ...currentAccount, avatarRev: rev };
  try {
    await api?.saveAccount?.({ ...currentAccount, name: currentAccount.username });
  } catch { /* ignore */ }
  pushPresence();
}

function accountPresence(): { name: string; avatar: string } | null {
  const acc = currentAccount;
  const name = acc.username || '';
  if (!name) return null;
  // Discord тянет картинку своей инфраструктурой, а не с машины пользователя,
  // поэтому здесь нужен прямой адрес: прокси только добавил бы нам нагрузку
  // и лишнюю точку отказа.
  return { name, avatar: accountAvatarDirectUrl(acc) };
}

function pushPresence(screen?: string): void {
  if (screen) presenceScreen = screen;
  api?.updatePresence?.({ screen: presenceScreen, account: accountPresence() });
}

const tabs = document.querySelectorAll<HTMLElement>('.tab-btn');
const tabViews = document.querySelectorAll<HTMLElement>('.tab-view');

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    switchTab(tab.getAttribute('data-tab') || '');
  });
});

document.querySelectorAll<HTMLElement>('.home-section-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    switchTab(btn.getAttribute('data-tab') || '');
  });
});

// Stat card clicks
document.querySelectorAll<HTMLElement>('.stat-card').forEach(card => {
  card.addEventListener('click', () => {
    const target = card.getAttribute('data-stat');
    if (target) switchTab(target);
  });
});

/* ===== ACCOUNT POPUP ===== */

const accountSelector = document.getElementById('account-selector');
const accountPopup = document.getElementById('account-popup')!;
const accountArrow = document.querySelector('.account-arrow');

function openAccountPopup(): void {
  accountPopup.classList.remove('hidden', 'closing');
  if (accountArrow) accountArrow.classList.add('open');
  void accountPopup.offsetWidth;
  accountPopup.classList.add('open');
}

function closeAccountPopup(): void {
  accountPopup.classList.remove('open');
  if (accountArrow) accountArrow.classList.remove('open');
  void accountPopup.offsetWidth;
  accountPopup.classList.add('closing');
  accountPopup.onanimationend = () => {
    accountPopup.classList.remove('closing');
    accountPopup.classList.add('hidden');
    accountPopup.onanimationend = null;
  };
}

accountSelector?.addEventListener('click', (e) => {
  e.stopPropagation();
  if (accountPopup.classList.contains('open')) {
    closeAccountPopup();
  } else {
    openAccountPopup();
  }
});

document.addEventListener('click', () => {
  if (accountPopup.classList.contains('open')) {
    closeAccountPopup();
  }
});

accountPopup.addEventListener('click', (e) => e.stopPropagation());

const accAddBtn = document.getElementById('acc-popup-add');

const accSteps = ['acc-step-pick', 'acc-step-ms', 'acc-step-ely', 'acc-step-offline'];
const accNextBtn = document.getElementById('acc-modal-next') as HTMLButtonElement | null;
const accBackBtn = document.getElementById('acc-modal-back') as HTMLButtonElement | null;
const accOfflineSubmitBtn = document.getElementById('acc-modal-offline-submit') as HTMLButtonElement | null;
const accOfflineInput = document.getElementById('acc-modal-offline-input') as HTMLInputElement | null;

function showAccStep(id: string): void {
  accSteps.forEach(s => document.getElementById(s)?.classList.toggle('hidden', s !== id));
  accNextBtn?.classList.toggle('hidden', id !== 'acc-step-pick');
  accBackBtn?.classList.toggle('hidden', id === 'acc-step-pick');
  accOfflineSubmitBtn?.classList.toggle('hidden', id !== 'acc-step-offline');
}

function getAccSelectedType(): string | null {
  const selected = document.querySelector<HTMLElement>('.acc-modal-card.selected');
  return selected?.getAttribute('data-type') || null;
}

function openModalAccount(): void {
  document.querySelectorAll<HTMLElement>('.acc-modal-card.selected').forEach(el => el.classList.remove('selected'));
  if (accNextBtn) accNextBtn.disabled = true;
  if (accOfflineInput) accOfflineInput.value = '';
  showAccStep('acc-step-pick');
  openModal('modal-account');
}

accAddBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  closeAccountPopup();
  openModalAccount();
});

document.querySelectorAll<HTMLElement>('.acc-modal-card').forEach(card => {
  card.addEventListener('click', () => {
    document.querySelectorAll<HTMLElement>('.acc-modal-card.selected').forEach(el => el.classList.remove('selected'));
    card.classList.add('selected');
    if (accNextBtn) accNextBtn.disabled = false;
  });
});

accNextBtn?.addEventListener('click', async () => {
  const type = getAccSelectedType();
  if (type === 'offline') {
    showAccStep('acc-step-offline');
    accOfflineInput?.focus();
  } else if (type === 'microsoft' && api?.authMicrosoft) {
    showAccStep('acc-step-ms');
    try {
      const typeEl = document.querySelector('.account-type');
      if (typeEl) typeEl.textContent = t('acc.loading');
      const account = await api.authMicrosoft();
      applyAccount(account);
      closeModal('modal-account');
      await api?.saveAccount?.(account);
      renderSavedAccounts();
    } catch {
      updateStatus(t('status.microsoftError'));
      showAccStep('acc-step-pick');
    }
  } else if (type === 'ely' && api?.authEly) {
    showAccStep('acc-step-ely');
    try {
      const typeEl = document.querySelector('.account-type');
      if (typeEl) typeEl.textContent = t('acc.loading');
      const account = await api.authEly();
      if (!account) throw new Error('ely-cancelled');
      applyAccount(account);
      closeModal('modal-account');
      await api?.saveAccount?.(account);
      renderSavedAccounts();
    } catch {
      updateStatus(t('status.elyError'));
      showAccStep('acc-step-pick');
    }
  }
});

accBackBtn?.addEventListener('click', () => {
  showAccStep('acc-step-pick');
  accOfflineInput?.blur();
});

async function submitAccOffline(): Promise<void> {
  const username = accOfflineInput?.value.trim() || '';
  if (username && api?.authOffline) {
    const account = await api.authOffline(username);
    applyAccount(account);
    closeModal('modal-account');
    await api?.saveAccount?.(account);
    renderSavedAccounts();
  }
}

accOfflineSubmitBtn?.addEventListener('click', () => { void submitAccOffline(); });
accOfflineInput?.addEventListener('keydown', (e) => {
  if ((e as KeyboardEvent).key === 'Enter') {
    e.preventDefault();
    void submitAccOffline();
  }
});

document.getElementById('modal-account-close')?.addEventListener('click', () => closeModal('modal-account'));
document.getElementById('modal-account')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeModal('modal-account');
});

/* ===== ACCOUNT REQUIRED MODAL ===== */

async function requireAccount(): Promise<boolean> {
  if (!api?.loadAccounts) return true;
  const accounts = await api.loadAccounts();
  if (accounts.length > 0) return true;
  openModal('modal-acc-req');
  return false;
}

document.getElementById('modal-acc-req-close')?.addEventListener('click', () => closeModal('modal-acc-req'));
document.getElementById('modal-acc-req-later')?.addEventListener('click', () => closeModal('modal-acc-req'));
document.getElementById('modal-acc-req-add')?.addEventListener('click', () => {
  closeModal('modal-acc-req');
  openModalAccount();
});
document.getElementById('modal-acc-req')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeModal('modal-acc-req');
});

function applyAccountTypeLabel(): void {
  const accType = currentAccount.meta?.type || currentAccount.type || 'offline';
  let label: string;
  if (accType === 'yggdrasil') label = t('acc.ely');
  else if (accType === 'msa') label = t('acc.license');
  else if (accType === 'crack' || accType === 'offline') label = t('acc.offline');
  else label = t('acc.license');
  const typeEl = document.querySelector('.account-type');
  if (typeEl) typeEl.textContent = label;
  const popupTypeEl = document.querySelector('.account-popup-current-type');
  if (popupTypeEl) popupTypeEl.textContent = label;
}

function applyAccount(account: any): void {
  const type = account.meta?.type || account.type || 'offline';
  currentAccount = { ...account, username: account.name };
  const nicknameEl = document.querySelector('.account-nickname');
  if (nicknameEl) nicknameEl.textContent = account.name;
  applyAccountTypeLabel();
  const popupNicknameEl = document.querySelector('.account-popup-current-name');
  if (popupNicknameEl) popupNicknameEl.textContent = account.name;

  if (type !== 'crack' && type !== 'offline' && account.uuid) {
    const uuid = account.uuid.replace(/-/g, '');
    const isEly = account.meta?.type === 'yggdrasil';
    const avatar = accountAvatarSources(account);
    setSkinImage('.account-skin-img', '.account-skin-placeholder', avatar.primary, avatar.fallback);
    setSkinImage('.account-popup-skin-img', '.account-popup-skin-placeholder', avatar.primary, avatar.fallback);
    updateNameType(account.name, isEly ? t('acc.ely') : t('acc.license'));
    if (api?.getSkinData) {
      api.getSkinData(uuid, isEly ? ELY_AUTH_SERVER : undefined).then(async data => {
        if (!account.skinUrl && isEly) {
          currentAccount.skinUrl = data?.skinUrl || null;
          if (currentAccount.skinUrl) {
            await api?.saveAccount?.({ ...currentAccount, name: currentAccount.username });
          }
        }
        // MSA: полный список плащей только для этого аккаунта (Profile API)
        if (!isEly && account.meta?.type === 'msa') {
          try {
            await syncLicenseCosmeticsFromProfile({ quiet: true });
          } catch (e) {
            console.warn('sync license cosmetics on login failed', e);
          }
          // Аватар из актуальной текстуры Mojang (mc-heads часто отдаёт старый кэш)
          if (data?.skinUrl && api?.fetchSkinImage) {
            const b64 = await api.fetchSkinImage(data.skinUrl);
            if (b64) {
              await refreshAccountUiAvatar(`data:image/png;base64,${b64}`);
              await bumpAccountAvatarRev(data.skinUrl);
            }
          }
        } else if (isEly && data?.skinUrl && api?.fetchSkinImage) {
          // Ely: только скин аккаунта (ely-skin-*), без «Лицензионный скин»
          const b64 = await api.fetchSkinImage(account.skinUrl || data.skinUrl);
          if (b64) {
            const dataUrl = `data:image/png;base64,${b64}`;
            loadSkinToViewer(dataUrl);
            const skinId = 'ely-skin-' + uuid;
            await saveAccountSkin({ id: skinId, name: t('skins.elySkin'), dataUrl });
            setActiveSkinId(skinId);
            setActiveCapeId(null);
            await loadSkinsList(); // внутри pruneDuplicateProfileSkins
          }
        }
        if (isEly && api?.fetchSkinImage) {
          const elyUrl = await getElyAvatarUrl(currentAccount, true);
          if (elyUrl) {
            const elyB64 = await api.fetchSkinImage(elyUrl);
            if (elyB64) {
              const avatar = await drawElyAvatar(`data:image/png;base64,${elyB64}`);
              if (avatar) {
                setSkinImage('.account-skin-img', '.account-skin-placeholder', avatar);
                setSkinImage('.account-popup-skin-img', '.account-popup-skin-placeholder', avatar);
              }
            }
          }
        }
      });
    }
  } else {
    setSkinImage('.account-skin-img', '.account-skin-placeholder', '');
    setSkinImage('.account-popup-skin-img', '.account-popup-skin-placeholder', '');
    updateNameType(account.name || t('acc.none'), t('acc.offline'));
    void applyOfflineSteveSkin();
  }
  void refreshSkinsUiForAccount();
  pushPresence();
}

/**
 * Фоновое обновление токена аккаунта. Промис живёт, пока обновление не завершится:
 * launchBuild его дожидается, чтобы не уйти в игру со старым access token.
 */
let accountRefreshPromise: Promise<void> | null = null;

async function refreshAccountInBackground(account: any): Promise<void> {
  try {
    const refreshed = await api?.refreshAccount?.(account);
    if (!refreshed) return;
    if (refreshed.name !== account.name || refreshed.uuid !== account.uuid) {
      // Сменились имя/uuid — перерисовываем аккаунт целиком (тянет скин и капу).
      applyAccount(refreshed);
    } else {
      // Обычный случай: поменялись только токены, скин и подписи те же —
      // повторный applyAccount заново качал бы скин с капой, это лишняя работа.
      currentAccount = { ...currentAccount, ...refreshed, username: refreshed.name };
    }
    await api?.saveAccount?.(refreshed);
  } catch { /* оффлайн — остаётся аккаунт из кэша */ }
  finally { accountRefreshPromise = null; }
}

function showNoAccountState(): void {
  const nicknameEl = document.querySelector('.account-nickname');
  if (nicknameEl) nicknameEl.textContent = t('acc.needLogin');
  const typeEl = document.querySelector('.account-type');
  if (typeEl) typeEl.textContent = t('acc.addHint');
  currentAccount = { uuid: '', username: '', type: 'offline' };
  void refreshSkinsUiForAccount();
  void applyOfflineSteveSkin();
  pushPresence();
}

/**
 * Показывает картинку аккаунта с резервным адресом: `fallbackUrl` пробуется
 * один раз, если основной адрес (обычно наш прокси) не загрузился.
 */
function setSkinImage(
  imgSelector: string,
  placeholderSelector: string,
  url: string,
  fallbackUrl = '',
): void {
  const img = document.querySelector<HTMLImageElement>(imgSelector);
  const placeholder = document.querySelector<HTMLElement>(placeholderSelector);
  if (!img || !placeholder) return;
  const wrap = img.closest?.('.account-skin') as HTMLElement | null;
  if (!url) {
    img.style.display = 'none';
    placeholder.style.display = '';
    if (wrap) wrap.classList.remove('loading');
    return;
  }
  if (wrap) wrap.classList.add('loading');
  let pending = fallbackUrl && fallbackUrl !== url ? fallbackUrl : '';
  img.onload = () => {
    img.style.display = '';
    placeholder.style.display = 'none';
    if (wrap) wrap.classList.remove('loading');
  };
  img.onerror = () => {
    if (pending) {
      const next = pending;
      pending = '';
      img.src = next;
      return;
    }
    img.style.display = 'none';
    placeholder.style.display = '';
    if (wrap) wrap.classList.remove('loading');
  };
  img.src = url;
}

/* ===== TYPES ===== */

interface Build {
  id: string;
  name: string;
  gameVersion: string;
  loader: string;
  loaderVersion: string;
  iconBg: string;
  icon?: string;
  jvmArgs?: string;
  mcArgs?: string;
  memory?: { min: number; max: number };
  window?: { width: number; height: number; fullscreen: boolean };
  playtime?: number;
  javaPath?: string;
  mods?: BeFileItem[];
  resourcePacks?: BeFileItem[];
  shaders?: BeFileItem[];
  dataPacks?: BeFileItem[];
}

interface BeFileItem {
  name: string;
  enabled: boolean;
  filename?: string;
  version?: string;
  description?: string;
  projectId?: string;
  iconUrl?: string;
}

interface Server {
  id: string;
  name: string;
  ip: string;
  version: string;
  port?: number;
}

interface Account {
  uuid: string;
  username: string;
  type: string;
  meta?: any;
  skinUrl?: string | null;
  /** Ревизия текстуры — сбрасывает кэш mc-heads в Discord/списке */
  avatarRev?: string;
  /** Локальная голова из активного скина (data URL) — селектор/список без ожидания Mojang */
  uiAvatarDataUrl?: string;
}

let currentAccount: Account = { uuid: '', username: t('common.loading'), type: 'offline' };
let savedBuilds: Build[] = [];
let savedServers: Server[] = [];
let editingBuildId: string | null = null;
let versionsPopulated = false;

let runningBuild: Build | null = null;
let runningBuildStart: number = 0;
let runningBuildTimer: number = 0;
let editingServerId: string | null = null;
const BUILD_COLORS = ['#7BD4B7', '#FF6B6B', '#4ECDC4', '#FFD93D', '#70ADDF', '#C084FC', '#FB923C', '#F472B6'];
let savedSkins: any[] = [];
let savedMods: any[] = [];

function setupDownloadProgress(): void {
  const el = document.getElementById('download-progress');
  const label = document.getElementById('download-progress-label');
  const speedEl = document.getElementById('download-progress-speed');
  const percent = document.getElementById('download-progress-percent');
  const fill = document.getElementById('download-progress-fill');
  const log = document.getElementById('download-progress-log');
  if (!el || !label || !speedEl || !percent || !fill || !log) return;

  if (api?.onDownloadProgress) {
    api.onDownloadProgress((data: any) => {
      if (data.type === 'start') {
        el.classList.remove('hidden');
        label.textContent = `${data.filename || '...'}`;
        speedEl.textContent = '';
        percent.textContent = '0%';
        fill.style.width = '0%';
        log.innerHTML = '';
        downloadStartTime = Date.now();
        downloadPrevReceived = 0;
        downloadPrevTime = downloadStartTime;
        addLogToEl(log, t('log.downloadStart', { file: data.filename, size: formatSizeGlobal(data.size || 0) }));
      } else if (data.type === 'progress') {
        percent.textContent = `${data.percent}%`;
        fill.style.width = `${data.percent}%`;
        label.textContent = `${data.filename || ''}`;
        const now = Date.now();
        const elapsed = (now - downloadPrevTime) / 1000;
        if (elapsed >= 0.5) {
          const bytesPerSec = (data.received - downloadPrevReceived) / elapsed;
          speedEl.textContent = formatSpeedGlobal(bytesPerSec);
          downloadPrevReceived = data.received;
          downloadPrevTime = now;
        }
      } else if (data.type === 'done') {
        percent.textContent = '100%';
        fill.style.width = '100%';
        speedEl.textContent = '';
        if (data.buildCreated) {
          label.textContent = t('log.buildCreatedLabel', { name: data.build.name });
          addLogToEl(log, t('log.buildCreated', { name: data.build.name }));
          savedBuilds.push(data.build);
          renderBuilds();
          updateBanner();
          updateSidebarCards();
        } else {
          label.textContent = t('log.done', { file: data.filename });
          addLogToEl(log, t('log.savedTo', { path: data.filePath }));
        }
        setTimeout(() => el.classList.add('hidden'), 3000);
      } else if (data.type === 'error') {
        label.textContent = t('log.error', { msg: data.message });
        speedEl.textContent = '';
        addLogToEl(log, t('log.error', { msg: data.message }));
        setTimeout(() => el.classList.add('hidden'), 4000);
      } else if (data.kind === 'status') {
        const msg = data.key ? t(data.key, { ...data.params, unit: t('common.mb') }) : data.message;
        addLogToEl(log, msg);
        label.textContent = msg;
        el.classList.remove('hidden');
      }
    });
  }
}

function addLogToEl(logEl: HTMLElement, message: string): void {
  const time = new Date().toLocaleTimeString();
  const entry = document.createElement('div');
  entry.className = 'dp-log-entry';
  entry.textContent = `[${time}] ${message}`;
  logEl.appendChild(entry);
  logEl.scrollTop = logEl.scrollHeight;
}

function classifyLogLine(line: string): string {
  if (/(error|fail(ed)?|crash|exception|ошиб|упал|xatа|ҡата)/i.test(line)) return 'error';
  if (/(warn(ing)?|предупрежд|аваз|ескерту)/i.test(line)) return 'warn';
  return '';
}

function openConsoleLog(): void {
  api?.openConsole?.();
}

document.getElementById('download-progress-log-btn')?.addEventListener('click', openConsoleLog);

/* ── Crash Modal ── */

async function analyzeCrash(logText: string): Promise<string | null> {
  if (!logText) return null;
  let report = '';
  if (runningBuild?.id && api?.getCrashReport) {
    try {
      report = (await api.getCrashReport(runningBuild.id)) || '';
    } catch { /* ignore */ }
  }
  const text = (logText + '\n' + report).toLowerCase();
  const rules: [RegExp, string][] = [
    [/outofmemoryerror|could not reserve enough space for object heap|failed to allocate/i, 'oom'],
    [/modloadingerror|modloadingexception|failed to load mods|found multiple mods|circular dependency/i, 'modconflict'],
    [/nosuchmethoderror|nosuchfielderror|abstractmethoderror|noclassdeffounderror|linkageerror/i, 'conflict'],
    [/unsupported class file major version|class file version/i, 'java'],
    [/access_violation|sigsegv|hs_err|exit code: -805306369/i, 'native'],
  ];
  for (const [re, key] of rules) if (re.test(text)) return key;
  return 'unknown';
}

async function showCrashModal(logs: string[]): Promise<void> {
  const body = document.getElementById('modal-crash-body');
  if (body) body.textContent = logs.join('\n');
  const sub = document.getElementById('modal-crash-sub');
  if (sub && runningBuild) sub.textContent = t('crash.subBuild', { name: runningBuild.name });
  const diag = document.getElementById('modal-crash-diagnosis');
  const diagTitle = document.getElementById('modal-crash-diag-title');
  const diagTip = document.getElementById('modal-crash-diag-tip');
  if (diag && diagTitle && diagTip) {
    const key = logs.length > 0 ? await analyzeCrash(logs.join('\n')) : null;
    if (key) {
      diagTitle.textContent = t(`crash.diag.${key}.title`);
      diagTip.textContent = t(`crash.diag.${key}.tip`);
      diag.classList.remove('hidden');
    } else {
      diag.classList.add('hidden');
    }
  }
  openModal('modal-crash');
}

document.getElementById('modal-crash-close')?.addEventListener('click', () => closeModal('modal-crash'));
document.getElementById('modal-crash')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeModal('modal-crash');
});

document.getElementById('modal-crash-folder')?.addEventListener('click', async () => {
  if (!runningBuild?.id) return;
  if (api?.getInstancePath && api?.openPath) {
    const instanceDir = await api.getInstancePath(runningBuild.id);
    if (instanceDir) await api.openPath(instanceDir);
  }
  closeModal('modal-crash');
});

document.getElementById('modal-crash-log')?.addEventListener('click', async () => {
  if (!runningBuild?.id) return;
  const body = document.getElementById('modal-crash-body');
  const logContent = body?.textContent || '';
  if (api?.saveLogFile) {
    const result = await api.saveLogFile(runningBuild.id, logContent);
    if (result.success && result.path && api?.openPath) {
      await api.openPath(result.path);
    }
  }
  closeModal('modal-crash');
});

document.getElementById('modal-crash-fix')?.addEventListener('click', async () => {
  // Re-run the build - eml-lib will re-download missing/corrupted files
  closeModal('modal-crash');
  if (runningBuild) {
    const build = runningBuild;
    runningBuild = null;
    updateStatus(t('status.fixingBuild', { name: build.name }));
    await launchBuild(build);
  }
});

function formatSpeedGlobal(bytesPerSec: number): string {
  if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
}

function formatSizeGlobal(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatPlaytime(seconds: number = 0): string {
  if (seconds < 0) seconds = 0;
  if (seconds < 60) return t('time.sec', { n: seconds });
  if (seconds < 3600) return t('time.min', { m: Math.floor(seconds / 60), s: seconds % 60 });
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return t('time.hour', { h, m });
}

let downloadStartTime = 0;
let downloadPrevReceived = 0;
let downloadPrevTime = 0;

/* ===== INIT ===== */

const SPLASH_MIN_MS = 600;
const SPLASH_SAFETY_MS = 6000;

let initStartedAt = performance.now();
let splashClosed = false;

function closeSplash(): void {
  if (splashClosed) return;
  splashClosed = true;
  const splash = document.getElementById('splash');
  const content = document.getElementById('splash-content');
  if (content) content.classList.add('fade-out');
  if (splash) splash.classList.add('fade-out');
  setTimeout(() => {
    if (splash) splash.style.display = 'none';
  }, 500);
}

async function init(): Promise<void> {
  await setLang(localStorage.getItem('Undefined Client-language') || 'ru');
  initStartedAt = performance.now();
  setTimeout(closeSplash, SPLASH_SAFETY_MS);

  // Random video wallpaper
  const videoEl = document.getElementById('quick-banner-bg') as HTMLVideoElement;
  if (videoEl) {
    const videos = ['1.mp4','2.mp4','3.mp4','5.mp4','6.mp4','7.mp4','8.mp4'];
    const pick = videos[Math.floor(Math.random() * videos.length)];
    videoEl.src = `../../assets/VideoWallpapers/${pick}`;
    videoEl.play().catch(() => {});
    videoEl.muted = true;
    videoEl.loop = true;
    videoEl.playsInline = true;
    videoEl.pause(); // start paused; resume only when home tab is visible

    // Ambient glow from video colors (low frequency, skipped when not visible)
    const glowCanvas = document.createElement('canvas');
    glowCanvas.width = 8;
    glowCanvas.height = 4;
    const glowCtx = glowCanvas.getContext('2d');
    const banner = document.getElementById('quick-banner');
    let glowTimer: any = null;
    let wallpaperRunning = false;

    function updateGlow() {
      if (!glowCtx || videoEl.readyState < 2 || !wallpaperRunning) return;
      glowCtx.drawImage(videoEl, 0, 0, 8, 4);
      const d = glowCtx.getImageData(0, 0, 8, 4).data;
      let r = 0, g = 0, b = 0, c = 0;
      for (let i = 0; i < d.length; i += 4) {
        const br = (d[i] + d[i+1] + d[i+2]) / 3;
        if (br > 40) { r += d[i] * d[i]; g += d[i+1] * d[i+1]; b += d[i+2] * d[i+2]; c++; }
      }
      if (c > 0 && banner) {
        banner.style.filter = `drop-shadow(0 0 60px rgba(${Math.sqrt(r/c)|0},${Math.sqrt(g/c)|0},${Math.sqrt(b/c)|0},0.2))`;
      }
    }

    function startWallpaper() {
      if (wallpaperRunning) return;
      wallpaperRunning = true;
      void videoEl.play().catch(() => {});
      updateGlow();
      glowTimer = setInterval(updateGlow, 4000);
    }

    function stopWallpaper() {
      if (!wallpaperRunning) return;
      wallpaperRunning = false;
      videoEl.pause();
      if (glowTimer) { clearInterval(glowTimer); glowTimer = null; }
      if (banner) banner.style.filter = '';
    }

    // Will be referenced by syncWallpaper/visibility handlers above
    wallpaperStart = startWallpaper;
    wallpaperStop = stopWallpaper;
    if (presenceTab === 'home' && !document.hidden) startWallpaper();
  }

  if (api?.onLaunchProgress) {
    const el = document.getElementById('download-progress');
    const label = document.getElementById('download-progress-label');
    const speedEl = document.getElementById('download-progress-speed');
    const percent = document.getElementById('download-progress-percent');
    const fill = document.getElementById('download-progress-fill');
    const log = document.getElementById('download-progress-log');
    let crashLogs: string[] = [];

    function pushCrashLog(line: string): void {
      crashLogs.push(line);
      if (crashLogs.length > 500) crashLogs.shift();
    }

    function formatSpeed(bytesPerSec: number): string {
      if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`;
      if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
      return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
    }

function addLog(msg: string): void {
  if (!log) return;
  while (log.childElementCount > 200) log.removeChild(log.firstChild as ChildNode);
  const line = document.createElement('div');
  line.textContent = msg;
  const cls = classifyLogLine(msg);
  if (cls) line.classList.add('log-' + cls);
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

    api.onLaunchProgress((data) => {
      if (!el) return;
      const msg = (d: any): string => (d.key ? t(d.key, d.params) : (d.message || ''));
      switch (data.kind) {
        case 'status':
          if (label) label.textContent = msg(data);
          if (speedEl) speedEl.textContent = '';
          if (percent) percent.textContent = '';
          if (fill) { fill.style.width = '30%'; fill.style.animation = 'progressIndeterminate 1.5s ease-in-out infinite'; }
          el.classList.remove('hidden');
          break;
        case 'download':
          if (el) el.classList.remove('hidden');
          if (label) label.textContent = msg(data);
          if (fill) {
            const sTotal = data.total?.size || 0;
            const sDone = data.downloaded?.size || 0;
            const aTotal = data.total?.amount || 0;
            const aDone = data.downloaded?.amount || 0;
            if (sTotal > 0) {
              const pct = Math.min(100, Math.round((sDone / sTotal) * 100));
              fill.style.animation = 'none';
              fill.style.width = `${pct}%`;
              if (percent) percent.textContent = `${pct}%`;
            } else if (aTotal > 0) {
              const pct = Math.min(100, Math.round((aDone / aTotal) * 100));
              fill.style.animation = 'none';
              fill.style.width = `${pct}%`;
              if (percent) percent.textContent = `${pct}%`;
            } else {
              fill.style.animation = 'progressIndeterminate 1.5s ease-in-out infinite';
              fill.style.width = '30%';
              if (percent) percent.textContent = data.speed ? formatSpeed(data.speed) : '';
            }
          }
          if (speedEl && data.speed) {
            speedEl.textContent = formatSpeed(data.speed);
          }
          break;
        case 'copy':
        case 'extract':
        case 'patch':
        case 'clean':
          if (label) label.textContent = msg(data);
          break;
        case 'info':
        case 'debug':
          pushCrashLog(msg(data));
          addLog(msg(data));
          break;
        case 'launching':
          crashLogs = [];
          addLog(t('status.minecraftStarted'));
          if (runningBuild) {
            runningBuildStart = Date.now();
            startRunningTimer();
            updateStatus(t('status.playing', { name: runningBuild.name }));
            updateBanner();
            updateSidebarCards();
          }
          if (el) el.classList.add('hidden');
          if (fill) fill.style.animation = 'none';
          break;
        case 'log':
          pushCrashLog(msg(data));
          addLog(msg(data));
          break;
        case 'close':
          updateStatus(msg(data));
          if (label) label.textContent = t('status.minecraftClosed');
          if (speedEl) speedEl.textContent = '';
          if (percent) percent.textContent = '';
          if (fill) { fill.style.width = '0%'; fill.style.animation = 'none'; }
          addLog(msg(data));
          stopRunningTimer();
          // If process exited with non-zero code, show crash modal
          if (data.code && data.code !== 0) {
            showCrashModal(crashLogs);
          }
          setTimeout(() => el.classList.add('hidden'), 4000);
          break;
        case 'crash':
          if (label) label.textContent = t('status.minecraftCrashed');
          if (fill) fill.style.animation = 'none';
          addLog(t('log.error', { msg: msg(data) }));
          stopRunningTimer();
          // Show crash modal
          showCrashModal(crashLogs);
          break;
        case 'error':
          if (label) label.textContent = msg(data);
          addLog(msg(data));
          updateStatus(msg(data));
          break;
      }
    });
  }
  if (api?.onLauncherLog) {
    api.onLauncherLog((data) => console.log('[Launcher]', data));
  }

  if (api?.loadAccounts) {
    const saved = await api.loadAccounts();
    if (saved.length > 0) {
      const last = saved[saved.length - 1];
      // Аккаунт из кэша показываем сразу: обновление токена — это сетевая цепочка
      // (для MSA — несколько запросов подряд, порядка 3 с), держать на ней весь
      // старт UI нельзя. Обновление уходит в фон, запуск игры его дожидается.
      applyAccount(last);
      if (last.meta?.type === 'msa' || last.meta?.type === 'yggdrasil') {
        accountRefreshPromise = refreshAccountInBackground(last);
      }
    } else {
      showNoAccountState();
    }
  } else {
    showNoAccountState();
  }
  pushPresence('home');

  await loadBuilds();
  await loadServers();
  renderSavedAccounts();
  loadTheme();
  if (localStorage.getItem('Undefined Client-check-updates-start') !== 'false') {
    void checkForUpdatesUI();
  }
  setupDownloadProgress();
  if (api?.getPlatformInfo) {
    const info = api.getPlatformInfo();
    const aboutPlat = document.getElementById('about-platform');
    if (aboutPlat) aboutPlat.textContent = info.platform || '—';
    const nodeVer = document.getElementById('about-node');
    if (nodeVer) nodeVer.textContent = info.nodeVersion || '--';
    const aboutVer = document.getElementById('about-version');
    if (aboutVer && api?.getAppVersion) {
      api.getAppVersion().then(ver => {
        appVersion = ver;
        aboutVer.textContent = `${t('about.version')} ${ver}`;
      });
    }
  }

  // Eagerly fetch Minecraft versions so the build modal select is ready
  const versionSelect = document.getElementById('modal-build-version') as HTMLSelectElement;
  if (versionSelect && !versionsPopulated && api?.getVersions) {
    versionsPopulated = true;
    api.getVersions().then(versions => {
      if (!versions || !Array.isArray(versions)) return;
      const seen = new Set<string>();
      for (const v of versions) {
        const id = v.id;
        if (seen.has(id)) continue;
        seen.add(id);
        if (['old_alpha', 'old_beta'].includes(v.type)) continue;
        appendBuildVersionOption(id, id + (v.type === 'snapshot' ? t('be.snapshotSuffix') : ''));
      }
      syncBuildVersionUI();
    }).catch(() => {});
  }

  const remaining = SPLASH_MIN_MS - (performance.now() - initStartedAt);
  setTimeout(closeSplash, Math.max(0, remaining));

  // ===== Deep link uclient:// =====
  // Ссылки уже запущенного лаунчера приходят событием, ссылка холодного старта
  // лежит в очереди main и забирается здесь — интерфейс к этому моменту готов,
  // список сборок загружен.
  api?.onDeepLink?.((payload) => void handleDeepLinkPayload(payload));
  if (api?.consumeDeepLink) {
    void api.consumeDeepLink()
      .then(payload => { if (payload) void handleDeepLinkPayload(payload); })
      .catch(() => {});
  }

  // Скрытые вкладки прогреваются в простое, уже после снятия сплэша: к этому
  // моменту GPU-процесс поднят и WebGL-контекст создаётся заметно дешевле.
  scheduleIdle(() => {
    void ensureSkinTab();
    scheduleIdle(() => ensureModsCatalog(), 3000);
  }, 2000);
}

function appendBuildVersionOption(id: string, label: string): void {
  const select = document.getElementById('modal-build-version') as HTMLSelectElement;
  const menu = document.getElementById('modal-build-version-menu');
  if (!select) return;
  const opt = document.createElement('option');
  opt.value = id;
  opt.textContent = label;
  select.appendChild(opt);
  if (menu) {
    const mi = document.createElement('div');
    mi.className = 'stngs-select-opt';
    mi.dataset.value = id;
    mi.textContent = label;
    menu.appendChild(mi);
  }
}

function syncBuildVersionUI(): void {
  const select = document.getElementById('modal-build-version') as HTMLSelectElement;
  const wrap = select?.closest('.stngs-select-wrap');
  if (wrap) syncSelectUI(wrap as HTMLElement);
}

/* ===== BUILDS ===== */

async function loadBuilds(): Promise<void> {
  if (api?.loadBuilds) {
    savedBuilds = await api.loadBuilds();
  }
  renderBuilds();
  renderHomeBuilds();
  updateStats();
  updateSidebarCards();
  updateBanner();
}

function renderBuilds(): void {
  const list = document.getElementById('builds-list');
  if (!list) return;
  if (savedBuilds.length === 0) {
    list.innerHTML = `
      <div class="builds-empty">
        <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
        <div>${t('builds.empty')}</div>
        <button class="action-btn" id="builds-empty-create"><span>${t('builds.add')}</span></button>
      </div>`;
    document.getElementById('builds-empty-create')?.addEventListener('click', () => openModalBuild());
    return;
  }
  list.innerHTML = savedBuilds.map(b => {
    let iconHtml: string;
    if (b.icon) {
      iconHtml = `<img src="${buildIconSrc(b.icon)}" style="width:100%;height:100%;object-fit:cover;">`;
    } else {
      iconHtml = `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M6 4L16 10L6 16V4Z" fill="#1a1a1a"/></svg>`;
    }
    const isRunning = runningBuild?.id === b.id;
    const meta = [b.gameVersion, b.loader, b.loaderVersion].filter(Boolean).join(' • ');
    return `
    <div class="build-card${isRunning ? ' running' : ''}" data-build-id="${b.id}">
      <div class="build-card-icon">${iconHtml}</div>
      <div class="build-card-info">
        <div class="build-card-title">
          ${isRunning ? '<span class="build-running-dot"></span>' : ''}
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${b.name}</span>
        </div>
        <div class="build-card-meta">${meta}</div>
        ${b.playtime ? `<div class="build-card-time">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
          ${formatPlaytime(b.playtime)}
        </div>` : ''}
      </div>
      <div class="build-card-actions">
        <button class="list-row-btn launch-btn" data-build-id="${b.id}"${runningBuild ? ' disabled' : ''}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M0 1.61803C0 0.724419 0.724419 0 1.61803 0C1.86923 0 2.11697 0.058484 2.34164 0.17082L13.1056 5.55279C13.6537 5.82687 14 6.38713 14 7C14 7.61287 13.6537 8.17313 13.1056 8.44721L2.34164 13.8292C2.11697 13.9415 1.86923 14 1.61803 14C0.724419 14 0 13.2756 0 12.382V1.61803Z" fill="currentColor"/></svg>
          ${isRunning ? t('btn.playing') : t('btn.launch')}
        </button>
        <div class="build-card-toolrow">
          <button class="build-card-btn build-share-btn" data-build-id="${b.id}" title="${t('btn.share')}">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M0 11C0 10.4477 0.447715 10 1 10C1.55228 10 2 10.4477 2 11C2 11.5523 2.44772 12 3 12H11C11.5523 12 12 11.5523 12 11C12 10.4477 12.4477 10 13 10C13.5523 10 14 10.4477 14 11C14 12.6569 12.6569 14 11 14H3C1.34315 14 0 12.6569 0 11Z" fill="currentColor"/><path d="M1.47749 6.84591C1.10637 6.45548 1.10656 5.82238 1.47749 5.43183L6.35592 0.292896C6.72714 -0.0976319 7.32887 -0.0976319 7.70008 0.292896L12.571 5.42819C12.9419 5.81874 12.9421 6.45184 12.571 6.84226C12.1998 7.23269 11.598 7.23249 11.2268 6.84226L7.97857 3.41401V8.99999C7.97857 9.55228 7.55299 10 7.028 10C6.50302 10 6.07744 9.55228 6.07744 8.99999V3.41401L2.82165 6.84591C2.45041 7.23614 1.84862 7.23633 1.47749 6.84591Z" fill="currentColor"/></svg>
            ${t('btn.share')}
          </button>
          <button class="build-card-btn build-manage-btn" data-build-id="${b.id}" title="${t('btn.manage')}">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M12.0012 0.31162C11.5857 -0.103873 10.9121 -0.103873 10.4966 0.31162L10.185 0.62324L13.3768 3.81505L13.6884 3.50343C14.1039 3.08794 14.1039 2.41429 13.6884 1.9988L12.0012 0.31162ZM12.3128 4.87899L9.12101 1.68718L4.86527 5.94292L4.01637 9.33853C3.91897 9.72813 4.27187 10.081 4.66147 9.98363L8.05708 9.13473L12.3128 4.87899Z" fill="currentColor"/><path d="M0 3C0 1.34315 1.34315 0 3 0H5C5.55228 0 6 0.447715 6 1C6 1.55228 5.55228 2 5 2H3C2.44772 2 2 2.44772 2 3V11C2 11.5523 2.44772 12 3 12H11C11.5523 12 12 11.5523 12 11V9C12 8.44772 12.4477 8 13 8C13.5523 8 14 8.44772 14 9V11C14 12.6569 12.6569 14 11 14H3C1.34315 14 0 12.6569 0 11V3Z" fill="currentColor"/></svg>
            ${t('btn.manage')}
          </button>
          <button class="build-card-btn danger build-delete-btn" data-build-id="${b.id}" title="${t('btn.delete')}">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 1C4 0.447715 4.44772 0 5 0H9C9.55228 0 10 0.447715 10 1H4Z" fill="currentColor"/><path d="M1 2C1 1.44772 1.44772 1 2 1H12C12.5523 1 13 1.44772 13 2C13 2.55228 12.5523 3 12 3H2C1.44772 3 1 2.55228 1 2Z" fill="currentColor"/><path d="M2.10995 5.09951C2.05108 4.51082 2.51337 4 3.10499 4H10.895C11.4866 4 11.9489 4.51082 11.89 5.0995L11.09 13.0995C11.0389 13.6107 10.6088 14 10.095 14H3.90499C3.39124 14 2.96107 13.6107 2.90995 13.0995L2.10995 5.09951Z" fill="currentColor"/></svg>
          </button>
        </div>
      </div>
    </div>
  `;
  }).join('');

  list.querySelectorAll<HTMLElement>('.launch-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const build = savedBuilds.find(b => b.id === btn.getAttribute('data-build-id'));
      if (build) await launchBuild(build);
    });
  });
  list.querySelectorAll<HTMLElement>('.build-share-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const build = savedBuilds.find(b => b.id === btn.getAttribute('data-build-id'));
      if (build) void openShareModal(build);
    });
  });
  list.querySelectorAll<HTMLElement>('.build-manage-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const build = savedBuilds.find(b => b.id === btn.getAttribute('data-build-id'));
      if (build) openModalBuild(build);
    });
  });
  list.querySelectorAll<HTMLElement>('.build-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-build-id');
      if (id) {
        const build = savedBuilds.find(b => b.id === id);
        if (build && await confirmAction(t('confirm.deleteBuild', { name: build.name }))) {
          if (api?.removeBuild) await api.removeBuild(id);
          await loadBuilds();
        }
      }
    });
  });
}

function renderHomeBuilds(): void {
  const container = document.getElementById('home-builds-list');
  if (!container) return;
  const recent = savedBuilds.slice(-5).reverse();
  if (recent.length === 0) {
    container.innerHTML = '<div style="padding:16px;text-align:center;color:rgba(255,255,255,0.2);font-weight:300;">' + t('builds.none') + '</div>';
    return;
  }
  container.innerHTML = recent.map(b => {
    let iconHtml: string;
    if (b.icon) {
      iconHtml = `<img src="${buildIconSrc(b.icon)}" style="width:100%;height:100%;object-fit:cover;">`;
    } else {
      iconHtml = `<svg width="16" height="16" viewBox="0 0 20 20" fill="none"><path d="M6 4L16 10L6 16V4Z" fill="#1a1a1a"/></svg>`;
    }
    return `<div class="home-row${runningBuild?.id === b.id ? ' running' : ''}" data-build-id="${b.id}">
      <div class="home-row-icon" style="background:rgba(255,255,255,0.1)">${iconHtml}</div>
      <div class="home-row-info">
        <div class="home-row-title">${b.name}</div>
        <div class="home-row-meta">${b.gameVersion} · ${b.loader}${b.playtime ? ' · ' + formatPlaytime(b.playtime) : ''}</div>
      </div>
      <button class="home-row-btn"${runningBuild ? ' disabled' : ''}>${runningBuild?.id === b.id ? t('btn.playing') : t('btn.launch')}</button>
    </div>`;
  }).join('');
  container.querySelectorAll<HTMLElement>('.home-row-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const build = savedBuilds.find(b => b.id === (btn.closest('.home-row') as HTMLElement)?.getAttribute('data-build-id'));
      if (build) await launchBuild(build);
    });
  });
  container.querySelectorAll<HTMLElement>('.home-row').forEach(row => {
    row.addEventListener('click', async () => {
      const build = savedBuilds.find(b => b.id === row.getAttribute('data-build-id'));
      if (build) await launchBuild(build);
    });
  });
}

document.getElementById('add-build-btn')?.addEventListener('click', () => openModalBuild());
document.getElementById('build-form-cancel')?.addEventListener('click', () => closeModalBuildModal());
document.getElementById('build-form-submit')?.addEventListener('click', () => submitModalBuild());

const colors = ['#7BD4B7', '#FF6B6B', '#4ECDC4', '#FFD93D', '#70ADDF', '#C084FC', '#FB923C', '#F472B6'];

function populateLoaderVersions(loader: string, mcVersion: string): void {
  const verInput = document.getElementById('modal-build-loader-ver') as HTMLInputElement;
  const datalist = document.getElementById('modal-loader-versions') as HTMLDataListElement;
  const isVanilla = loader === 'vanilla';
  if (verInput) verInput.disabled = isVanilla;
  if (isVanilla) {
    if (datalist) datalist.innerHTML = '';
    if (verInput) verInput.value = '';
    return;
  }
  if (api?.getLoaderVersions) {
    api.getLoaderVersions(loader, mcVersion).then(versions => {
      const currentLoader = (document.getElementById('modal-build-loader') as HTMLSelectElement)?.value;
      if (currentLoader !== loader) return;
      if (datalist) datalist.innerHTML = (versions || []).map(v => `<option value="${v}">`).join('');
      if (verInput && !verInput.value && versions && versions.length > 0) {
        verInput.value = versions[0];
      }
    }).catch(() => {});
  }
}

let detectedJava: { name: string; path: string; version: number }[] = [];

function populateJavaOptions(): Promise<void> {
  const select = document.getElementById('modal-build-java') as HTMLSelectElement;
  const menu = document.getElementById('modal-build-java-menu');
  if (!select || !menu) return Promise.resolve();
  if (detectedJava.length === 0 && api?.detectJava) {
    return api.detectJava().then(list => {
      detectedJava = list || [];
      appendJavaOptions(select, menu);
    }).catch(() => {
      detectedJava = [];
    });
  }
  appendJavaOptions(select, menu);
  return Promise.resolve();
}

function appendJavaOptions(select: HTMLSelectElement, menu: HTMLElement): void {
  menu.querySelectorAll<HTMLElement>('.stngs-select-opt[data-java-dyn]').forEach(o => o.remove());
  select.querySelectorAll<HTMLOptionElement>('option[data-java-dyn]').forEach(o => o.remove());
  for (const j of detectedJava) {
    const label = `Java ${j.version} · ${j.name}`;
    const opt = document.createElement('option');
    opt.dataset.javaDyn = '1';
    opt.value = j.path;
    opt.textContent = label;
    select.appendChild(opt);
    const item = document.createElement('div');
    item.className = 'stngs-select-opt';
    item.dataset.javaDyn = '1';
    item.dataset.value = j.path;
    item.textContent = label;
    menu.appendChild(item);
  }
}

/* ===== JAVA MANAGER ===== */

interface JavaVersionInfo {
  version: number;
  installed: boolean;
  managed: boolean;
  path: string | null;
  systemPaths: string[];
}

let javaManagerData: JavaVersionInfo[] = [];
let javaBusy: Record<number, boolean> = {};
let javaProgressCleanup: (() => void) | null = null;

function renderJavaManager(list: JavaVersionInfo[]): void {
  const container = document.getElementById('java-manager-list');
  if (!container) return;
  container.innerHTML = list.map(j => {
    const busy = javaBusy[j.version];
    const statusCls = busy ? 'busy' : (j.installed ? 'installed' : 'not-installed');
    const statusText = busy ? t('jm.busy') : (j.installed ? t('jm.installed') : t('jm.notInstalled'));
    const metaParts: string[] = [];
    if (j.installed) metaParts.push(j.managed ? t('jm.managed') : t('jm.system'));
    if (j.systemPaths.length > 0 && j.managed) metaParts.push(t('jm.systemFound', { n: String(j.systemPaths.length) }));
    const pathText = j.installed && j.path ? j.path : '';
    return `
      <div class="list-row" data-java-ver="${j.version}">
        <div class="java-row-badge ${j.installed ? 'installed' : ''}">${j.version}</div>
        <div class="list-row-info">
          <div class="java-row-title">Java ${j.version}</div>
          <div class="list-row-meta">${metaParts.join(' · ') || t('jm.available')}</div>
        </div>
        <div class="java-row-path" title="${pathText}">${pathText}</div>
        <div class="java-row-status ${statusCls}">${statusText}</div>
        <div class="java-row-actions">
          <button class="list-row-btn java-install-btn" data-java-ver="${j.version}" ${j.installed || busy ? 'disabled' : ''}>${t('jm.install')}</button>
          <button class="list-row-btn danger java-remove-btn" data-java-ver="${j.version}" ${!j.managed || busy ? 'disabled' : ''}>${t('jm.remove')}</button>
        </div>
      </div>`;
  }).join('');
}

async function refreshJavaManager(): Promise<void> {
  if (!api?.listJavaVersions) return;
  try {
    javaManagerData = await api.listJavaVersions();
  } catch {
    javaManagerData = [];
  }
  renderJavaManager(javaManagerData);
  detectedJava = [];
}

function initJavaManager(): void {
  const container = document.getElementById('java-manager-list');
  if (!container) return;
  if (javaProgressCleanup) return;
  if (api?.onJavaProgress) {
    javaProgressCleanup = api.onJavaProgress((data: any) => {
      const version = Number(data?.version);
      if (!version) return;
      if (data.status === 'done' || data.status === 'removed') {
        javaBusy[version] = false;
        const dp = document.getElementById('download-progress');
        if (dp) dp.classList.add('hidden');
        void refreshJavaManager();
        return;
      }
      javaBusy[version] = true;
      const statusEl = container.querySelector<HTMLElement>(`.list-row[data-java-ver="${version}"] .java-row-status`);
      if (statusEl) {
        statusEl.className = 'java-row-status busy';
        statusEl.textContent = data.status === 'extract' ? t('jm.extracting') : t('jm.downloading');
      }
    });
  }
  container.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!btn) return;
    const row = btn.closest<HTMLElement>('.list-row');
    if (!row) return;
    const version = Number(row.getAttribute('data-java-ver'));
    if (!version || javaBusy[version]) return;
    if (btn.classList.contains('java-install-btn')) {
      javaBusy[version] = true;
      renderJavaManager(javaManagerData);
      const result = await api?.installJava?.(version);
      javaBusy[version] = false;
      if (!result?.success) updateStatus(result?.error ? String(result.error) : t('jm.installFailed'));
      await refreshJavaManager();
    } else if (btn.classList.contains('java-remove-btn')) {
      if (!await confirmAction(t('jm.removeConfirm', { ver: String(version) }))) return;
      javaBusy[version] = true;
      renderJavaManager(javaManagerData);
      const result = await api?.removeJava?.(version);
      javaBusy[version] = false;
      if (!result?.success) updateStatus(result?.error ? String(result.error) : t('jm.removeFailed'));
      await refreshJavaManager();
    }
  });
}

initJavaManager();

/* ===== BUILD EDITOR: AUTO-SELECT COMPATIBLE JAVA ===== */

let javaAutoApplied = false;
let lastAutoJavaPath = '';
let javaManualChoice = false;

function setJavaAutoHint(text: string, cls: string, visible: boolean): void {
  const hint = document.getElementById('be-java-hint');
  const hintText = document.getElementById('be-java-hint-text');
  if (!hint || !hintText) return;
  hint.classList.toggle('hidden', !visible);
  hint.classList.remove('ok', 'be-java-hint-warn');
  if (cls && visible) hint.classList.add(cls);
  if (visible) hintText.textContent = text;
}

async function autoApplyCompatibleJava(): Promise<void> {
  if (editingBuildId) return;
  if (javaManualChoice) return;
  const javaSelect = document.getElementById('modal-build-java') as HTMLSelectElement;
  const javaCustomRow = document.getElementById('be-java-custom-row');
  if (!javaSelect) return;
  if (javaAutoApplied && javaSelect.value !== lastAutoJavaPath) return;
  const versionSelect = document.getElementById('modal-build-version') as HTMLSelectElement;
  const version = versionSelect?.value || 'latest_release';
  if (!version) return;
  let need = 0;
  try {
    const res = await api?.resolveJavaVersion?.(version);
    need = res?.version || 0;
  } catch { need = 0; }
  const runtime = need > 0 ? detectedJava.find(j => j.version === need) : undefined;
  if (runtime) {
    javaSelect.value = runtime.path;
    lastAutoJavaPath = runtime.path;
    javaAutoApplied = true;
    if (javaCustomRow) javaCustomRow.classList.add('hidden');
    setJavaAutoHint(t('jm.compatibleSelected', { ver: String(need) }), 'ok', true);
  } else {
    javaSelect.value = '';
    lastAutoJavaPath = '';
    javaAutoApplied = true;
    if (javaCustomRow) javaCustomRow.classList.add('hidden');
    setJavaAutoHint(t('jm.compatibleMissing', { ver: String(need) }), need ? 'be-java-hint-warn' : '', true);
  }
  const wrap = javaSelect.closest('.stngs-select-wrap');
  if (wrap) syncSelectUI(wrap as HTMLElement);
}

document.getElementById('modal-build-java')?.addEventListener('change', () => {
  const select = document.getElementById('modal-build-java') as HTMLSelectElement;
  if (!select) return;
  if (select.value !== lastAutoJavaPath) {
    javaManualChoice = true;
    javaAutoApplied = false;
    setJavaAutoHint('', '', false);
  }
});

/* ===== SERVERS ===== */

async function loadServers(): Promise<void> {
  if (api?.loadServers) {
    savedServers = await api.loadServers();
  }
  renderServers();
  renderHomeServers();
  updateStats();
  updateSidebarCards();
}

function renderServers(): void {
  renderServersGrid();
}

/* ===== SERVERS CATALOG ===== */

interface CatalogServerEntry {
  id: string;
  name: string;
  ip: string;
  port?: number;
  country: string;
  region: string;
  modes: string[];
  desc: string;
  versions?: string[];
  points?: number;
  icon?: string;
  fromMineServ?: boolean;
  status?: any;
}

const FALLBACK_SERVER_CATALOG: CatalogServerEntry[] = [
  { id: 'hypixel-na', name: 'Hypixel', ip: 'play.hypixel.net', country: 'US', region: 'north', modes: ['minigames', 'pvp', 'skyblock', 'vanilla'], desc: 'Крупнейшая мини-серверная сеть: BedWars, SkyWars, SkyBlock и многое другое.', },
  { id: 'hypixel-eu', name: 'Hypixel EU', ip: 'mc.hypixel.net', country: 'US', region: 'north', modes: ['minigames', 'pvp'], desc: 'Второй адрес входа в Hypixel Network.', },
  { id: 'cubecraft', name: 'CubeCraft Games', ip: 'play.cubecraft.net', country: 'NL', region: 'europe', modes: ['minigames', 'skyblock'], desc: 'Мини-игры и SkyBlock: EggWars, SkyWars.', },
  { id: 'gommehd', name: 'GommeHD', ip: 'play.gommehd.net', country: 'DE', region: 'europe', modes: ['minigames'], desc: 'Немецкая сеть мини-игр: BedWars, SkyWars, JumpLeague.', },
  { id: 'pika', name: 'PikaNetwork', ip: 'mc.pika-network.net', country: 'DE', region: 'europe', modes: ['pvp', 'skyblock'], desc: 'PvP и SkyBlock с большим онлайном.', },
  { id: 'jartex', name: 'JartexNetwork', ip: 'play.jartexnetwork.com', country: 'EU', region: 'europe', modes: ['pvp', 'skyblock'], desc: 'Prison, BedWars и SkyBlock сеть.', },
  { id: 'craftrise', name: 'CraftRise', ip: 'play.craftrise.com', country: 'TR', region: 'europe', modes: ['pvp'], desc: 'Турецкая PvP сеть.', },
  { id: 'mc4fun', name: 'MC4FUN', ip: 'play.mc4fun.net', country: 'TR', region: 'europe', modes: ['pvp', 'skyblock'], desc: 'Турецкая сеть: PvP, BedWars, Skyblock.', },
  { id: 'nown', name: 'PvMNow', ip: 'play.pvmnow.net', country: 'EU', region: 'europe', modes: ['pvp', 'skyblock'], desc: 'Сеть PvP и SkyBlock мини-серверов.', },
  { id: 'manacube', name: 'ManaCube', ip: 'play.manacube.com', country: 'US', region: 'north', modes: ['minigames', 'pvp', 'skyblock'], desc: 'Огромная сеть: SkyBlock, Prison, BedWars, PvP.', },
  { id: '2b2t', name: '2b2t.org', ip: '2b2t.org', country: 'US', region: 'north', modes: ['anarchy'], desc: 'Легендарный анархичный сервер без правил.', },
  { id: '5b5t', name: '5b5t', ip: '5b5t.net', country: 'US', region: 'north', modes: ['anarchy'], desc: 'Облегчённая анархия с хопперами.', },
  { id: '9b9t', name: '9b9t', ip: '9b9t.org', country: 'US', region: 'north', modes: ['anarchy'], desc: 'Анархичный сервер без карт и правил.', },
  { id: 'constantiam', name: 'Constantiam', ip: 'constantiam.net', country: 'DE', region: 'europe', modes: ['anarchy'], desc: 'Anarchy с открытой регистрацией.', },
  { id: 'maxmine', name: 'MaxMine', ip: 'mc.maxmine.net', country: 'DE', region: 'cis', modes: ['survival', 'skyblock'], desc: 'Русскоязычная сеть: SkyBlock и выживание.', },
  { id: 'funtime', name: 'FunTime', ip: 'mc.funtime.su', country: 'RU', region: 'cis', modes: ['anarchy'], desc: 'Анархичный сервер.', },
  { id: 'minelife', name: 'MineLife', ip: 'mc.minelife.ru', country: 'RU', region: 'cis', modes: ['anarchy'], desc: 'Анархия без защиты.', },
  { id: 'hyperion', name: 'Hyperion', ip: 'mc.hyperion.su', country: 'RU', region: 'cis', modes: ['anarchy'], desc: 'Анархия.', },
  { id: 'lentacheta', name: 'LentaCheta', ip: 'lentacheta.ru', country: 'RU', region: 'cis', modes: ['anarchy'], desc: 'Русский анархичный сервер.', },
  { id: 'wynncraft', name: 'Wynncraft', ip: 'play.wynncraft.com', country: 'US', region: 'north', modes: ['vanilla', 'pvp'], desc: 'Крупнейший MMORPG-сервер поверх ванильного Minecraft.', },
  { id: 'mineplex', name: 'Mineplex', ip: 'play.mineplex.com', country: 'US', region: 'north', modes: ['minigames'], desc: 'Мини-игры.', },
  { id: 'minemen', name: 'MineMen', ip: 'minemen.club', country: 'US', region: 'north', modes: ['pvp'], desc: 'PvP-дуэли и 1v1 арены.', },
  { id: 'ffawe', name: 'FFAWorld', ip: 'ffa.earth', country: 'US', region: 'north', modes: ['pvp'], desc: 'FFA и BedWars-сервер.', },
  { id: 'minesuperior', name: 'MineSuperior', ip: 'mine.minesuperior.com', country: 'US', region: 'north', modes: ['skyblock'], desc: 'SkyBlock-сеть с ивентами.', },
  { id: 'blossom', name: 'BlossomCraft', ip: 'play.blossomcraft.org', country: 'US', region: 'north', modes: ['survival', 'pvp'], desc: 'Survival с защитой по претензиям.', },
  { id: 'purple-p', name: 'Purple Prison', ip: 'play.purpleprison.net', country: 'US', region: 'north', modes: ['survival', 'skyblock'], desc: 'Prison и skyblock.', },
  { id: 'pandahut', name: 'Pandahut', ip: 'play.pandahut.net', country: 'CA', region: 'north', modes: ['survival', 'vanilla'], desc: 'Большой ванильный сервер.', },
  { id: 'cold', name: 'ColdNetwork', ip: 'play.coldnetwork.net', country: 'US', region: 'north', modes: ['skyblock', 'pvp'], desc: 'SkyBlock и PvP.', },
  { id: 'astro', name: 'AstroMC', ip: 'play.astromc.com', country: 'EU', region: 'europe', modes: ['pvp'], desc: 'PvP-сеть.', },
  { id: 'astra', name: 'AstraNetwork', ip: 'play.astra-network.pro', country: 'RU', region: 'cis', modes: ['pvp'], desc: 'PvP сеть.', },
  { id: 'cutegames', name: 'CuteGames', ip: 'play.cutegames.su', country: 'RU', region: 'cis', modes: ['minigames'], desc: 'Мини-игры для всей семьи.', },
  { id: 'vnl', name: 'VanillaCombat', ip: 'play.vanillcombat.xyz', country: 'EU', region: 'europe', modes: ['vanilla', 'pvp'], desc: 'Ванильный комунити-сервер.', },
  { id: 'nem', name: 'NemusMC', ip: 'play.nemusc.com', country: 'IR', region: 'asia', modes: ['survival', 'pvp'], desc: 'Выживание и PvP.', },
  { id: 'lifelig', name: 'LifeSMP', ip: 'play.lifesmp.net', country: 'EU', region: 'europe', modes: ['survival'], desc: 'SMP-выживание с экономикой.', },
  { id: 'praxis', name: 'PraxisMinecraft', ip: 'play.praxismc.com', country: 'US', region: 'north', modes: ['pvp'], desc: 'PvP-мини-игры и дуэли.', },
  { id: 'oxic', name: 'Oxicraft', ip: 'play.oxicraft.net', country: 'EU', region: 'europe', modes: ['skyblock', 'survival'], desc: 'SkyBlock и элементы PvP.', },
  { id: 'hyperc', name: 'HyperCraft', ip: 'mc.hypercraft.net', country: 'DE', region: 'europe', modes: ['survival', 'skyblock'], desc: 'Немецкое выживание и SkyBlock.', },
  { id: 'myth', name: 'MythMC', ip: 'play.mythmc.eu', country: 'NL', region: 'europe', modes: ['pvp', 'skyblock'], desc: 'Сеть PvP и SkyBlock.', },
  { id: 'smpn', name: 'ServerMineNetwork', ip: 'play.servermines.net', country: 'IE', region: 'europe', modes: ['skyblock', 'pvp'], desc: 'SkyBlock, BedWars и PvP.', },
  { id: 'cantina', name: 'Canting Siberia', ip: 'play.cantinarb.com', country: 'RU', region: 'cis', modes: ['vanilla', 'survival'], desc: 'Ванильное выживание.', },
  { id: 'godbr', name: 'MineGodBR', ip: 'play.minegodbr.net', country: 'BR', region: 'south', modes: ['minigames', 'pvp'], desc: 'Бразильская сеть мини-игр.', },
  { id: 'nethergames', name: 'NetherGames', ip: 'play.nethergames.org', country: 'DE', region: 'europe', modes: ['pvp', 'minigames'], desc: 'BedWars, SkyWars и PvP.', },
  { id: 'chunky', name: 'chunkyMC', ip: 'play.chunkymc.net', country: 'SE', region: 'europe', modes: ['survival'], desc: 'Шведское выживание с защитой и магазином.', },
  { id: 'skph', name: 'SkyPack', ip: 'play.skypack.net', country: 'US', region: 'north', modes: ['skyblock'], desc: 'Классический SkyBlock с экономикой.', },
  { id: 'totem', name: 'TotemVerse', ip: 'play.totemverse.net', country: 'EU', region: 'europe', modes: ['survival'], desc: 'Survival-сервер с постройками и экономикой.', },
  { id: 'ledged', name: 'LegacyMC', ip: 'play.legacymc.com', country: 'US', region: 'north', modes: ['pvp'], desc: 'Ностальгический PvP-сервер.', },
  { id: 'vichlu', name: 'VichluSMP', ip: 'play.vichlu.com', country: 'PL', region: 'europe', modes: ['survival', 'vanilla'], desc: 'Польский ванильный survival-сервер.', },
  { id: 'hive', name: 'The Hive', ip: 'play.hivemc.com', country: 'GB', region: 'europe', modes: ['minigames'], desc: 'Мини-игры: BlockParty, Hide and Seek.', },
  { id: 'asur', name: 'AsurarMC', ip: 'play.asurar.com', country: 'IN', region: 'asia', modes: ['survival', 'skyblock'], desc: 'Индийская сеть выживания и SkyBlock.', },
  { id: 'podick', name: 'PodickMC', ip: 'play.podick.net', country: 'US', region: 'north', modes: ['minigames'], desc: 'Разные мини-игры и арены.', },
  { id: 'instant', name: 'InstantMC', ip: 'play.instantmc.net', country: 'AU', region: 'asia', modes: ['pvp'], desc: 'Австралийский PvP-сервер.', },
  { id: 'supper', name: 'SurvivalPlug', ip: 'play.survivalplug.net', country: 'GB', region: 'europe', modes: ['survival'], desc: 'Британское выживание с защитой участков.', },
  { id: 'ploud', name: 'PloudMC', ip: 'play.ploudmc.net', country: 'US', region: 'north', modes: ['vanilla', 'survival'], desc: 'Ванильное выживание домашнего сервера.', },
  { id: 'freedon', name: 'FreedomMC', ip: 'play.freedommc.net', country: 'US', region: 'north', modes: ['survival'], desc: 'Анархо-подобный сервер с флайком.', },
  { id: 'cube-c', name: 'CubeCraft Networks EU', ip: 'eu.play.cubecraft.net', country: 'NL', region: 'europe', modes: ['minigames', 'skyblock'], desc: 'Европейский узел CubeCraft.', },
  { id: 'pvp-legacy', name: 'HopperMC', ip: 'hop.hopperpvp.com', country: 'EU', region: 'europe', modes: ['pvp'], desc: 'Хоппер-арены и дуэли.', },
  { id: 'pixel', name: 'PixelUnion', ip: 'play.pixelunion.net', country: 'DE', region: 'europe', modes: ['skyblock'], desc: 'SkyBlock-сервер с торговлей.', },
  { id: 'van-mini', name: 'VanillaDystopia', ip: 'play.vanilladystopia.com', country: 'US', region: 'north', modes: ['vanilla'], desc: 'Приватный ванильный сервер.', },
  { id: 'weeseed', name: 'StarSeed', ip: 'play.starseed.net', country: 'SE', region: 'europe', modes: ['survival'], desc: 'Скандинавский survival-сервер.', },
  { id: 'ongo', name: 'OngoSheep', ip: 'play.ongosheep.net', country: 'ES', region: 'europe', modes: ['pvp', 'survival'], desc: 'Испанский PvP и выживание.', },
  { id: 'rona', name: 'RonaCraft', ip: 'mc.ronacraft.net', country: 'ID', region: 'asia', modes: ['survival', 'skyblock'], desc: 'Индонезийская сеть выживания.', },
  { id: 'kwind', name: 'KwindMC', ip: 'play.kwindmc.net', country: 'KR', region: 'asia', modes: ['pvp'], desc: 'Корейский PvP-сервер.', },
  { id: 'aer', name: 'Aerielycs', ip: 'play.aerymcs.com', country: 'PH', region: 'asia', modes: ['minigames', 'survival'], desc: 'Филиппинская сеть мини-игр.', },
  { id: 'candor', name: 'CandorMC', ip: 'play.candormc.com', country: 'US', region: 'north', modes: ['pvp'], desc: 'PvP-дуэли и бойцы.', },
  { id: 'fumor', name: 'FumoMC', ip: 'play.fumover.net', country: 'JP', region: 'asia', modes: ['vanilla'], desc: 'Японский ванильный сервер.', },
  { id: 'brato', name: 'Bratopia', ip: 'play.bratopia.net', country: 'BE', region: 'europe', modes: ['survival'], desc: 'Бельгийское survival-сообщество.', },
  { id: 'catcat', name: 'CatCraft', ip: 'play.catcraft.net', country: 'US', region: 'north', modes: ['vanilla', 'survival'], desc: 'Уютный ванильный сервер.', },
  { id: 'zunder', name: 'ZundaMC', ip: 'play.zundamc.net', country: 'ZA', region: 'south', modes: ['survival'], desc: 'Южноафриканский survival-сервер.', },
  { id: 'aurora', name: 'AuroraMC', ip: 'play.ahurora.net', country: 'AR', region: 'south', modes: ['anarchy'], desc: 'Аргентинская анархия.', },
  { id: 'ptide', name: 'EsmeraldaMC', ip: 'm.esmeraldamc.net', country: 'MX', region: 'south', modes: ['pvp', 'skyblock'], desc: 'Мексиканская сеть PvP.', },
  { id: 'gress', name: 'GregTechno', ip: 'play.gregtech.net', country: 'CA', region: 'north', modes: ['vanilla', 'survival'], desc: 'Технологичный выживание.', },
];

const SRV_PAGE_SIZE = 20;
let serverCatalog: CatalogServerEntry[] = [];
let srvCatalogReady = false;
let srvVersionFilter = '';
let srvQuery = '';
let srvCategory = 'all';
let srvSort = 'players';
let srvRegion = 'all';
let srvOnlineOnly = false;
let srvRenderedCount = 0;
let srvOfflineAddrs: Record<string, boolean> = {};
let srvStatusCache: Record<string, any> = {};
let srvRefreshTimer: any = null;
let srvLoading = false;
let srvLoaded = false;

function srvEsc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function srvStatus(ip: string): any {
  return srvStatusCache[ip];
}

function srvKeyOf(host: string, port: number): string {
  return `${host}:${port}`;
}
function srvAddr(e: CatalogServerEntry): string {
  return srvKeyOf(e.ip.toLowerCase().replace(/\.+$/, '').replace(/^mc:\/\//i, ''), Number(e.port) || 25565);
}
function srvAddrText(e: CatalogServerEntry): string {
  return e.port && e.port !== 25565 ? `${e.ip}:${e.port}` : e.ip;
}

function srvOnline(ip: string): boolean {
  return !!srvStatus(ip)?.online && !srvOfflineAddrs[ip];
}

function srvStatusE(e: CatalogServerEntry | undefined): any {
  return e ? (e.status || {}) : {};
}
function srvOnlineE(e: CatalogServerEntry | undefined): boolean {
  return !!srvStatusE(e)?.online && !(e ? srvOfflineAddrs[srvAddr(e)] : false);
}
function srvPlayersE(e: CatalogServerEntry | undefined): number {
  return Math.max(0, Number(srvStatusE(e)?.players?.online) || 0);
}

function refreshServersGridAfterRemoval(): void {
  if (srvCategory === 'mine' || !srvLoaded) return;
  if (srvRefreshTimer) return;
  srvRefreshTimer = setTimeout(() => {
    srvRefreshTimer = null;
    const grid = document.getElementById('servers-grid');
    if (!grid) return;
    const list = serverCatalog.filter(srvMatchesFilters).sort(srvSorted);
    const moreWrap = grid.querySelector('.load-more-wrap');
    const shownCount = grid.querySelectorAll('.srv-card[data-srv-ip]').length;
    if (moreWrap) {
      if (srvRenderedCount >= list.length) {
        moreWrap.remove();
      }
    } else if (shownCount === 0 && list.length > 0) {
      renderServersGrid();
    }
  }, 80);
}

function srvPlayers(ip: string): number {
  return Math.max(0, Number(srvStatus(ip)?.players?.online) || 0);
}

function srvRegionForHost(host: string): string {
  const h = host.toLowerCase();
  if (/\.(ru|su|by|kz|ua|uz|ge|am|az|md|kg|tj|tm)$/.test(h)) return 'cis';
  if (/\.(de|fr|pl|nl|uk|eu|es|it|se|fi|no|dk|cz|be|pt|ro|bg|gr|ch)$/.test(h)) return 'europe';
  if (/\.(jp|kr|in|pk|vn|th|id|ph|my|sg|cn|hk|tw|au|nz)$/.test(h)) return 'asia';
  if (/\.(br|ar|cl|pe|co|mx|ve|uy)$/.test(h)) return 'south';
  return 'north';
}

function srvCountryForHost(host: string): string {
  const m = /\.([a-z]{2})$/.exec(host.toLowerCase());
  return m ? m[1].toUpperCase() : '';
}

function srvModesFromName(name: string, desc: string): string[] {
  const text = (name + ' ' + desc).toLowerCase();
  const out = new Set<string>();
  if (/skyblock|скайблок|sky/i.test(text)) out.add('skyblock');
  if (/pvp|дуэли|бои|arena|battle|дуэль|p-kit/.test(text)) out.add('pvp');
  if (/anarchy|анархия|гриф|анарх/.test(text)) out.add('anarchy');
  if (/minigame|мини-игр|мини игр|bedwars|skywars|eggwars|лаки|bedwar/.test(text)) out.add('minigames');
  if (/survival|выживан|смп|smp|жить|life/.test(text)) out.add('survival');
  if (/vanilla|ванил/.test(text)) out.add('vanilla');
  return Array.from(out);
}

function srvRegionName(region: string): string {
  const map: Record<string, string> = { north: 'north', europe: 'europe', cis: 'cis', south: 'south', asia: 'asia' };
  return t(`servers.region.${map[region] || 'north'}`);
}

async function loadServerCatalog(force = false): Promise<void> {
  if (srvLoaded && !force) return;
  if (srvLoading) return;
  srvLoading = true;
  const grid = document.getElementById('servers-grid');
  if (grid && srvCategory !== 'mine') {
    grid.innerHTML = '<div style="padding:20px;text-align:center;color:rgba(255,255,255,0.3);font-weight:300;">' + t('common.loading') + '</div>';
  }
  const scraped: any[] = (await api?.fetchServerCatalog?.()) || [];
  console.log('[SRV] scraped rows:', scraped.length);
  scraped.forEach((r, idx) => {
    console.log(`[SRV] ${idx}:`, JSON.stringify({
      name: r.name, ip: r.ip, port: r.port, desc: (r.desc || '').slice(0, 60), icon: (r.icon || '').slice(0, 60),
    }));
  });
  serverCatalog = scraped.map(raw => {
    const ip = String(raw.ip || '').trim();
    const port = Number(raw.port) || 25565;
    const host = ip.split(':')[0];
    const name = String(raw.name || host || 'Server');
    const desc = String(raw.desc || raw.description || '');
    const modes = raw.modes && raw.modes.length > 0 ? raw.modes : srvModesFromName(name, desc);
    return {
      id: String(raw.id || `${host}:${port}`),
      name,
      ip: host,
      port,
      country: raw.country || srvCountryForHost(host),
      region: raw.region || srvRegionForHost(host),
      modes,
      desc,
      versions: Array.isArray(raw.versions) ? raw.versions : undefined,
      points: raw.points,
      icon: raw.icon || '',
      fromMineServ: scraped.length > 0 && !raw._fallback,
    };
  });
  const seenAddr = new Set<string>();
  serverCatalog = serverCatalog.filter(e => {
    const a = srvAddr(e).toLowerCase();
    if (seenAddr.has(a)) return false;
    seenAddr.add(a);
    return true;
  });
  srvLoading = false;
  srvLoaded = true;
  const attribution = document.getElementById('servers-attribution');
  if (attribution) attribution.classList.toggle('hidden', scraped.length === 0);
  syncServerVersionSelect();
  refreshServersFiltersUI();
  renderServersGrid();
  pingServersUI(serverCatalog.slice(0, SRV_PAGE_SIZE));
}

function pingServersUI(entries: CatalogServerEntry[]): void {
  const queue = entries.filter(e => e && !e.status).slice();
  if (queue.length === 0) return;
  let i = 0;
  const worker = async (): Promise<void> => {
    while (i < queue.length) {
      const e = queue[i++];
      if (!e || e.status) continue;
      let st: any;
      try { st = (await api?.serverStatus?.(srvAddr(e))) || { online: false }; }
      catch { st = { online: false }; }
      e.status = st;
      updateSrvCardStatus(e);
    }
  };
  void Promise.all(Array.from({ length: 10 }, () => worker()));
}

function updateSrvCardStatus(e: CatalogServerEntry): void {
  const addr = srvAddr(e);
  const card = document.querySelector<HTMLElement>(`.srv-card[data-srv-ip="${CSS.escape(addr)}"]`);
  if (!card) return;
  const st = e.status || {};
  const online = !!st.online;
  if (!online) {
    srvOfflineAddrs[addr] = true;
    card.remove();
    refreshServersGridAfterRemoval();
    return;
  }
  const players = st.players?.online != null ? st.players.online : null;
  const max = st.players?.max != null ? st.players.max : null;
  const version = String(st.version || '').split('\n')[0] || '';
  const statusTxt = online
    ? (players != null ? `${Number(players).toLocaleString()}${max != null ? '/' + Number(max).toLocaleString() : ''}` : t('servers.online'))
    : t('servers.offline');
  const dot = card.querySelector('.srv-dot');
  if (dot) {
    dot.className = 'srv-dot ' + (online ? 'srv-online' : 'srv-offline');
  }
  const txt = card.querySelector('.srv-status-txt');
  if (txt) txt.textContent = statusTxt;
  const verEl = card.querySelector('.srv-version');
  if (verEl) {
    if (version) verEl.textContent = version;
    else verEl.remove();
  }
  const descEl = card.querySelector('.srv-desc');
  if (descEl) {
    const d = Array.isArray(st?.motd?.clean) ? st.motd.clean.join(' ').substring(0, 110) : (e.desc || '');
    descEl.textContent = d;
  }
  const icon = srvServerFavicon(st);
  if (icon) {
    const iconEl = card.querySelector<HTMLElement>('.srv-icon');
    if (iconEl) iconEl.innerHTML = `<img src="${srvEsc(icon)}" alt="">`;
  }
}

function srvServerFavicon(st: any): string {
  const raw = String(st.icon || '');
  if (!raw) return '';
  const lower = raw.toLowerCase();
  if (/^data:image\/png(;|,)/.test(lower)) return raw;
  return '';
}

function srvMatchesFilters(e: CatalogServerEntry): boolean {
  const q = srvQuery.trim().toLowerCase();
  const addr = srvAddr(e);
  if (srvOfflineAddrs[addr]) return false;
  if (q && !(e.name.toLowerCase().includes(q) || addr.toLowerCase().includes(q))) return false;
  if (srvCategory !== 'all' && srvCategory !== 'mine' && !e.modes.includes(srvCategory)) return false;
  if (srvRegion !== 'all' && e.region !== srvRegion) return false;
  if (srvOnlineOnly && !srvOnlineE(e)) return false;
  if (srvVersionFilter) {
    const st = e.status || {};
    const pingVer = String(st.version || '').toLowerCase();
    if (!e.versions?.includes(srvVersionFilter) && !pingVer.includes(srvVersionFilter)) return false;
  }
  return true;
}

function srvSorted(a: CatalogServerEntry, b: CatalogServerEntry): number {
  if (srvSort === 'name') return a.name.localeCompare(b.name);
  if (srvSort === 'online') {
    const d = (srvOnlineE(b) ? 1 : 0) - (srvOnlineE(a) ? 1 : 0);
    if (d !== 0) return d;
    return srvPlayersE(b) - srvPlayersE(a);
  }
  return srvPlayersE(b) - srvPlayersE(a);
}

function srvCardHtml(e: CatalogServerEntry): string {
  const st = e.status || {};
  const online = !!st.online;
  const players = st.players?.online != null ? st.players.online : null;
  const max = st.players?.max != null ? st.players.max : null;
  const version = String(st.version || '').split('\n')[0] || '';
  const desc = Array.isArray(st?.motd?.clean) ? srvEsc(st.motd.clean.join(' ').substring(0, 110)) : srvEsc(e.desc);
  const iconSrc = srvServerFavicon(st);
  const icon = iconSrc ? `<img src="${srvEsc(iconSrc)}" alt="">` : '<img src="../../assets/icons/serverIcon.png" alt="">';
  const saved = savedServers.some(s => s.ip === srvAddr(e));
  const statusTxt = online
    ? (players != null ? `${Number(players).toLocaleString()}${max != null ? '/' + Number(max).toLocaleString() : ''}` : t('servers.online'))
    : t('servers.offline');
  const dotCls = online ? 'srv-online' : 'srv-offline';
  const addrStr = srvAddr(e);
  const badge = e.fromMineServ ? `<span class="srv-badge" title="${srvEsc(t('servers.byMineServ'))}">MineServ</span>` : '';
  return `
  <div class="mod-card srv-card" data-srv-ip="${srvEsc(addrStr)}">
    <div class="mod-card-icon srv-icon">${icon}</div>
    <div class="mod-card-info">
      <div class="mod-card-name srv-name">${srvEsc(e.name)}${badge} <span class="srv-country" title="${srvEsc(srvRegionName(e.region) + ' · ' + e.country)}">${srvEsc(e.country)}</span></div>
      <div class="mod-card-desc srv-desc">${desc}</div>
      <div class="srv-meta">
        <span class="srv-dot ${dotCls}"></span>
        <span class="srv-status-txt">${statusTxt}</span>
        ${version ? `<span class="srv-sep">·</span><span class="srv-version">${srvEsc(version)}</span>` : ''}
      </div>
    </div>
    <div class="mod-card-actions">
      <button class="details-btn srv-info" data-srv-ip="${srvEsc(addrStr)}">${t('servers.details')}</button>
      <button class="details-btn srv-play" data-srv-ip="${srvEsc(addrStr)}">${t('btn.launch')}</button>
      <button class="list-row-btn ${saved ? 'delete-btn srv-unsave' : 'download-btn srv-save'}" data-srv-ip="${srvEsc(addrStr)}">${saved ? t('servers.remove') : t('servers.add')}</button>
    </div>
  </div>`;
}

function renderServersGrid(append = false): void {
  const grid = document.getElementById('servers-grid');
  if (!grid) return;
  if (srvCategory === 'mine') { renderSavedServersGrid(); return; }
  if (!srvLoaded) {
    if (!append && !srvLoading) grid.innerHTML = '<div style="padding:20px;text-align:center;color:rgba(255,255,255,0.3);font-weight:300;">' + t('common.loading') + '</div>';
    return;
  }
  const list = serverCatalog.filter(srvMatchesFilters).sort(srvSorted);
  if (list.length === 0) {
    srvRenderedCount = 0;
    grid.innerHTML = '<div style="padding:20px;text-align:center;color:rgba(255,255,255,0.3);font-weight:300;">' + t('servers.notFound') + '</div>';
    return;
  }
  const slice = append ? list.slice(srvRenderedCount, srvRenderedCount + SRV_PAGE_SIZE) : list.slice(0, SRV_PAGE_SIZE);
  if (!append) srvRenderedCount = 0;
  srvRenderedCount += slice.length;
  const cards = slice.map(srvCardHtml).join('');
  const more = srvRenderedCount < list.length
    ? `<div class="load-more-wrap"><button class="load-more-btn">${t('mods.showMore')}</button></div>`
    : '';
  if (append) {
    const old = grid.querySelector('.load-more-wrap');
    if (old) old.remove();
    grid.insertAdjacentHTML('beforeend', cards + more);
  } else {
    grid.innerHTML = cards + more;
  }
}

function savedServerAddr(s: Server): string {
  const raw = String(s.ip || '').trim();
  const port = Number(s.port) || 25565;
  const host = raw.replace(/^mc:\/\//i, '').replace(/:.*$/, '');
  return srvKeyOf(host, port);
}

async function pingSavedServerStatuses(): Promise<void> {
  const queue = savedServers.map(savedServerAddr).filter(a => a && !srvStatusCache[a]).filter((a, i, arr) => arr.indexOf(a) === i);
  let i = 0;
  const worker = async (): Promise<void> => {
    while (i < queue.length) {
      const addr = queue[i++];
      if (!addr || srvStatusCache[addr]) continue;
      try { srvStatusCache[addr] = (await api?.serverStatus?.(addr)) || { online: false }; }
      catch { srvStatusCache[addr] = { online: false }; }
      if (srvCategory === 'mine') renderSavedServersGrid();
    }
  };
  await Promise.all(Array.from({ length: 6 }, () => worker()));
}

function renderSavedServersGrid(): void {
  const grid = document.getElementById('servers-grid');
  if (!grid) return;
  void pingSavedServerStatuses();
  if (savedServers.length === 0) {
    grid.innerHTML = '<div style="padding:20px;text-align:center;color:rgba(255,255,255,0.3);font-weight:300;">' + t('servers.empty') + '</div>';
    return;
  }
  grid.innerHTML = savedServers.map(s => {
    const addr = savedServerAddr(s);
    const st = srvStatus(addr) || {};
    const online = !!st.online;
    const players = st.players?.online != null ? st.players.online : null;
    const max = st.players?.max != null ? st.players.max : null;
    const version = String(st.version || s.version || '').split('\n')[0] || '';
    const cat = serverCatalog.find(c => srvAddr(c) === addr);
    let icon = srvServerFavicon(st);
    const iconHtml = icon
      ? `<img src="${icon}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;">`
      : `<span>${srvEsc(s.name).charAt(0).toUpperCase()}</span>`;
    const statusTxt = online
      ? (players != null ? `${Number(players).toLocaleString()}${max != null ? '/' + Number(max).toLocaleString() : ''}` : t('servers.online'))
      : t('servers.offline');
    const dotCls = online ? 'srv-online' : 'srv-offline';
    return `
    <div class="mod-card srv-card" data-srv-ip="${srvEsc(addr)}">
      <div class="mod-card-icon srv-icon srv-saved-icon" style="background:${stringToColor(s.name)}">${iconHtml}</div>
      <div class="mod-card-info">
        <div class="mod-card-name srv-name">${srvEsc(s.name)}</div>
        <div class="mod-card-desc srv-desc">${srvEsc(addr)}</div>
        <div class="srv-meta">
          <span class="srv-dot ${dotCls}"></span>
          <span class="srv-status-txt">${statusTxt}</span>
          ${version ? `<span class="srv-sep">·</span><span class="srv-version">${srvEsc(version)}</span>` : ''}
        </div>
      </div>
      <div class="mod-card-actions">
        <button class="details-btn srv-info" data-srv-ip="${srvEsc(addr)}">${t('servers.details')}</button>
        <button class="details-btn srv-play" data-srv-ip="${srvEsc(addr)}">${t('btn.launch')}</button>
        <button class="list-row-btn edit-server-btn srv-edit" data-srv-id="${srvEsc(s.id)}">${t('btn.edit')}</button>
        <button class="list-row-btn delete-btn srv-del" data-srv-id="${srvEsc(s.id)}">${t('btn.delete')}</button>
      </div>
    </div>
`;
  }).join('');
}

function srvRegionNameMap(region: string): string {
  return srvRegionName(region);
}

function openServerInfo(ip: string): void {
  const cat = serverCatalog.find(c => srvAddr(c) === ip);
  const saved = savedServers.find(s => savedServerAddr(s) === ip);
  const name = cat?.name || saved?.name || ip;
  const st = cat?.status || srvStatus(ip) || {};
  const online = !!st.online;
  const players = st.players?.online != null ? st.players.online : null;
  const max = st.players?.max != null ? st.players.max : null;
  const version = String(st.version || '').split('\n')[0] || '';
  const desc = Array.isArray(st.motd?.clean) ? st.motd.clean.join(' ') : (cat?.desc || '');
  const modal = document.getElementById('modal-srv-info');
  if (!modal) return;
  const titleEl = document.getElementById('srv-info-title');
  const subEl = document.getElementById('srv-info-sub');
  const icon = srvServerFavicon(st);
  const iconEl = document.getElementById('srv-info-icon');
  if (titleEl) titleEl.textContent = name;
  if (subEl) subEl.textContent = ip;
  if (iconEl) iconEl.innerHTML = icon ? `<img src="${srvEsc(icon)}" alt="">` : `<span>${srvEsc(name).charAt(0).toUpperCase()}</span>`;
  modal.setAttribute('data-srv-ip', ip);

  const metaStatus = document.getElementById('srv-info-meta-status');
  const metaPlayers = document.getElementById('srv-info-meta-players');
  const metaVersion = document.getElementById('srv-info-meta-version');
  const metaLatency = document.getElementById('srv-info-meta-latency');
  const dot = online ? 'srv-online' : 'srv-offline';
  const statusText = online ? t('servers.online') : t('servers.offline');
  if (metaStatus) {
    metaStatus.innerHTML = `<span class="srv-dot ${dot}"></span><span class="srv-info-status-txt">${srvEsc(statusText)}</span>`;
  }
  if (metaPlayers) {
    if (players != null) {
      const pl = max != null ? `${Number(players).toLocaleString()} / ${Number(max).toLocaleString()}` : Number(players).toLocaleString();
      metaPlayers.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1.5C4.7 1.5 3.2 3.2 3.2 5.5C3.2 7.9 4.8 9.5 7 9.5C9.2 9.5 10.8 7.9 10.8 5.5C10.8 3.2 9.3 1.5 7 1.5ZM1.0 12.5C1.8 10.3 4.1 9 7 9C9.9 9 12.2 10.3 13 12.5" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>${srvEsc(pl)} ${srvEsc(t('servers.dInfoPlayers'))}</span>`;
    }
  }
  if (metaVersion && version) {
    metaVersion.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1L12.5 3.5V10.5L7 13L1.5 10.5V3.5L7 1Z" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>${srvEsc(version)}</span>`;
  }
  if (metaLatency && st.latency != null) {
    metaLatency.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1C4 1 1.5 3.5 1.5 7C1.5 10.5 4 13 7 13C10 13 12.5 10.5 12.5 7C12.5 3.5 10 1 7 1Z" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>${Number(st.latency)} ms</span>`;
  }

  const rows: string[] = [];
  rows.push('<div class="srv-info-group"><div class="srv-info-group-title">' + t('servers.dInfoDesc') + '</div><div class="srv-info-text">' + (desc ? srvEsc(desc) : '—') + '</div></div>');
  if (cat?.region) {
    const country = cat.country ? ' · ' + srvEsc(cat.country) : '';
    rows.push('<div class="srv-info-group"><div class="srv-info-group-title">' + t('servers.dInfoRegion') + '</div><div class="srv-info-text">' + srvEsc(srvRegionNameMap(cat.region)) + country + '</div></div>');
  }
  if (cat?.versions?.length) {
    rows.push('<div class="srv-info-group"><div class="srv-info-group-title">' + t('servers.dInfoVersions') + '</div><div class="srv-info-tags">' + cat.versions.map(v => `<span class="srv-info-tag">${srvEsc(v)}</span>`).join('') + '</div></div>');
  }
  if (cat?.modes?.length) {
    rows.push('<div class="srv-info-group"><div class="srv-info-group-title">' + t('servers.dInfoModes') + '</div><div class="srv-info-tags">' + cat.modes.map(v => `<span class="srv-info-tag">${srvEsc(v)}</span>`).join('') + '</div></div>');
  }
  rows.push('<div class="srv-info-group"><div class="srv-info-group-title">' + t('srv.ip') + '</div><div class="srv-info-text">' + srvEsc(ip) + '</div></div>');
  const body = document.getElementById('srv-info-body');
  if (body) body.innerHTML = rows.join('');
  openModal('modal-srv-info');
}

document.getElementById('modal-srv-info')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeModal('modal-srv-info');
});
document.getElementById('srv-info-close')?.addEventListener('click', () => closeModal('modal-srv-info'));
document.getElementById('srv-info-close2')?.addEventListener('click', () => closeModal('modal-srv-info'));
document.getElementById('srv-info-launch')?.addEventListener('click', () => {
  const modal = document.getElementById('modal-srv-info');
  const ip = modal?.getAttribute('data-srv-ip') || '';
  closeModal('modal-srv-info');
  if (!ip) return;
  void (async () => {
    if (!(await requireAccount())) return;
    const [host, portPart] = ip.split(':');
    const entry = serverCatalog.find(c => srvAddr(c) === ip);
    openServerLaunchPicker(host, parseInt(portPart, 10) || 25565, entry?.name);
  })();
});

document.getElementById('servers-grid')?.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('.srv-play, .srv-save, .srv-unsave, .srv-edit, .srv-del, .srv-info, .load-more-btn');
  if (!btn) return;
  if (btn.classList.contains('load-more-btn')) {
    if (btn.hasAttribute('disabled')) return;
    btn.setAttribute('disabled', '');
    const before = Math.max(0, srvRenderedCount);
    renderServersGrid(true);
    const list = serverCatalog.filter(srvMatchesFilters).sort(srvSorted);
    pingServersUI(list.slice(before, before + SRV_PAGE_SIZE));
    return;
  }
  const ip = btn.getAttribute('data-srv-ip');
  if (btn.classList.contains('srv-info') && ip) {
    openServerInfo(ip);
    return;
  }
  if (btn.classList.contains('srv-play') && ip) {
    void (async () => {
      if (!(await requireAccount())) return;
      const [host, portPart] = ip.split(':');
      const entry = serverCatalog.find(c => srvAddr(c) === ip) || savedServers.find(s => savedServerAddr(s) === ip);
      openServerLaunchPicker(host, parseInt(portPart, 10) || 25565, entry?.name);
    })();
    return;
  }
  if (btn.classList.contains('srv-save') && ip) {
    void (async () => {
      const e = serverCatalog.find(c => srvAddr(c) === ip);
      if (!e || savedServers.some(s => s.ip === ip)) {
        renderServersGrid();
        return;
      }
      const st = e?.status || srvStatus(ip) || {};
      const version = String(st.version || '').split('\n')[0] || '';
      await api?.saveServer?.({ id: Date.now().toString(), name: e.name, ip, port: e.port, version });
      await loadServers();
      if (srvCategory !== 'mine') renderServersGrid();
    })();
    return;
  }
  if (btn.classList.contains('srv-unsave') && ip) {
    void (async () => {
      const existing = savedServers.find(s => s.ip === ip);
      if (existing && await confirmAction(t('confirm.deleteServer', { name: existing.name }))) {
        if (api?.removeServer) await api.removeServer(existing.id);
        await loadServers();
      }
      renderServersGrid();
    })();
    return;
  }
  const id = btn.getAttribute('data-srv-id');
  if (btn.classList.contains('srv-edit') && id) {
    const server = savedServers.find(s => s.id === id);
    if (server) openModalServer(server);
    return;
  }
  if (btn.classList.contains('srv-del') && id) {
    void (async () => {
      const server = savedServers.find(s => s.id === id);
      if (server && await confirmAction(t('confirm.deleteServer', { name: server.name }))) {
        if (api?.removeServer) await api.removeServer(id);
        await loadServers();
      }
      renderServersGrid();
    })();
  }
});

const serversSearchTimer = { id: 0 };

document.getElementById('servers-search-input')?.addEventListener('input', (e) => {
  clearTimeout(serversSearchTimer.id);
  serversSearchTimer.id = window.setTimeout(() => {
    srvQuery = (e.target as HTMLInputElement).value || '';
    if (srvCategory === 'mine') renderServersGrid(); else renderServersGrid();
  }, 350);
});

document.querySelectorAll<HTMLElement>('#servers-categories .category-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#servers-categories .category-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    srvCategory = btn.getAttribute('data-category') || 'all';
    srvRenderedCount = 0;
    if (srvCategory === 'mine') renderSavedServersGrid();
    else renderServersGrid();
  });
});

document.getElementById('servers-sort-select')?.addEventListener('change', (e) => {
  srvSort = (e.target as HTMLSelectElement).value || 'players';
  refreshServersFiltersUI();
  renderServersGrid();
});

document.querySelectorAll<HTMLElement>('#servers-region-chips .mods-chip').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#servers-region-chips .mods-chip').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    srvRegion = btn.getAttribute('data-region') || 'all';
    refreshServersFiltersUI();
    renderServersGrid();
  });
});

document.getElementById('servers-online-chip')?.addEventListener('click', (e) => {
  const btn = e.currentTarget as HTMLElement;
  btn.classList.toggle('active');
  srvOnlineOnly = btn.classList.contains('active');
  refreshServersFiltersUI();
  renderServersGrid();
});

document.getElementById('servers-filters-clear')?.addEventListener('click', () => {
  srvSort = 'players';
  srvRegion = 'all';
  srvOnlineOnly = false;
  srvVersionFilter = '';
  const sortSel = document.getElementById('servers-sort-select') as HTMLSelectElement;
  if (sortSel) sortSel.value = 'players';
  const versionSel = document.getElementById('servers-version-select') as HTMLSelectElement;
  if (versionSel) versionSel.value = '';
  document.querySelectorAll('#servers-region-chips .mods-chip').forEach(chip => {
    chip.classList.toggle('active', chip.getAttribute('data-region') === 'all');
  });
  document.querySelectorAll<HTMLElement>('#servers-online-chip').forEach(chip => chip.classList.remove('active'));
  refreshServersFiltersUI();
  syncSelectUI((document.getElementById('servers-sort-select')?.closest('.stngs-select-wrap')) as HTMLElement);
  syncServerVersionSelect();
  renderServersGrid();
});

function refreshServersFiltersUI(): void {
  const toggle = document.getElementById('servers-filters-toggle');
  const badge = document.getElementById('servers-filters-count');
  const count = (srvRegion !== 'all' ? 1 : 0) + (srvOnlineOnly ? 1 : 0) + (srvSort !== 'players' ? 1 : 0) + (srvVersionFilter ? 1 : 0);
  toggle?.classList.toggle('active', count > 0);
  if (badge) {
    badge.textContent = String(count);
    badge.style.display = count > 0 ? '' : 'none';
  }
}

function syncServerVersionSelect(): void {
  const select = document.getElementById('servers-version-select') as HTMLSelectElement | null;
  if (!select) return;
  const versions = new Set<string>();
  const pingVersions = new Set<string>();
  serverCatalog.forEach(e => {
    (e.versions || []).forEach(v => versions.add(v));
    const st = e.status;
    if (st?.version) {
      const v = String(st.version).split('\n')[0].trim();
      if (v) pingVersions.add(v);
    }
  });
  const all = Array.from(new Set([...versions, ...pingVersions])).sort((a, b) => {
    const fa = a.split('.').map(n => parseInt(n, 10) || 0);
    const fb = b.split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < 3; i++) {
      const d = (fb[i] || 0) - (fa[i] || 0);
      if (d !== 0) return d;
    }
    return 0;
  });
  const current = select.value;
  select.innerHTML = '<option value="" data-i18n="servers.filter.versionAll">' + t('servers.filter.versionAll') + '</option>'
    + all.map(v => `<option value="${srvEsc(v)}">${srvEsc(v)}</option>`).join('');
  const menu = select.closest('.stngs-select-wrap')?.querySelector<HTMLElement>('.stngs-select-menu');
  if (menu) {
    menu.innerHTML = '<div class="stngs-select-opt" data-value="">' + t('servers.filter.versionAll') + '</div>'
      + all.map(v => `<div class="stngs-select-opt" data-value="${srvEsc(v)}">${srvEsc(v)}</div>`).join('');
  }
  if (current && all.includes(current)) select.value = current;
  const wrap = select.closest('.stngs-select-wrap');
  if (wrap) syncSelectUI(wrap as HTMLElement);
}

document.getElementById('servers-version-select')?.addEventListener('change', (e) => {
  srvVersionFilter = (e.target as HTMLSelectElement).value || '';
  srvRenderedCount = 0;
  refreshServersFiltersUI();
  renderServersGrid();
});

const serversFiltersPopup = document.getElementById('servers-filters-popup');
const serversFiltersPop = document.querySelector('.mods-filters-pop');

function openServersFiltersPopup(): void {
  if (!serversFiltersPopup || !serversFiltersPop) return;
  serversFiltersPopup.classList.remove('hidden', 'closing');
  serversFiltersPop.classList.add('open');
  void serversFiltersPopup.offsetWidth;
  serversFiltersPopup.classList.add('open');
}

function closeServersFiltersPopup(): void {
  if (!serversFiltersPopup || !serversFiltersPop) return;
  if (serversFiltersPopup.classList.contains('closing')) return;
  if (!serversFiltersPopup.classList.contains('open')) {
    serversFiltersPopup.classList.add('hidden');
    return;
  }
  serversFiltersPopup.classList.remove('open');
  serversFiltersPop.classList.remove('open');
  void serversFiltersPopup.offsetWidth;
  serversFiltersPopup.classList.add('closing');
  serversFiltersPopup.onanimationend = () => {
    serversFiltersPopup.classList.remove('closing');
    serversFiltersPopup.classList.add('hidden');
    serversFiltersPopup.onanimationend = null;
  };
}

document.getElementById('servers-filters-toggle')?.addEventListener('click', (e) => {
  e.stopPropagation();
  if (serversFiltersPopup?.classList.contains('open')) {
    closeServersFiltersPopup();
  } else {
    openServersFiltersPopup();
  }
});

document.addEventListener('click', (e) => {
  const wrap = document.getElementById('servers-filters-toggle')?.parentElement;
  if (wrap && serversFiltersPopup?.classList.contains('open') && !wrap.contains(e.target as Node)) {
    closeServersFiltersPopup();
  }
});

function renderHomeServers(): void {
  const list = document.getElementById('home-servers-list');
  if (!list) return;
  const recent = savedServers.slice(-5).reverse();
  if (recent.length === 0) {
    list.innerHTML = '<div style="padding:16px;text-align:center;color:rgba(255,255,255,0.2);font-weight:300;">' + t('servers.none') + '</div>';
    return;
  }
  list.innerHTML = recent.map(s => `
    <div class="home-row" data-server-id="${s.id}">
      <div class="home-row-icon" style="background:${stringToColor(s.name)}">
        <span style="color:#1a1a1a;font-size:13px;font-weight:700">${s.name.charAt(0).toUpperCase()}</span>
      </div>
      <div class="home-row-info">
        <div class="home-row-title">${s.name}</div>
        <div class="home-row-meta">${s.version || t('servers.anyVersion')} · ${s.ip}</div>
      </div>
      <button class="home-row-btn">${t('btn.launch')}</button>
    </div>
  `).join('');
  list.querySelectorAll<HTMLElement>('.home-row-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const server = savedServers.find(s => s.id === (btn.closest('.home-row') as HTMLElement)?.getAttribute('data-server-id'));
      if (server) joinServer(server.ip);
    });
  });
  list.querySelectorAll<HTMLElement>('.home-row').forEach(row => {
    row.addEventListener('click', () => {
      const server = savedServers.find(s => s.id === row.getAttribute('data-server-id'));
      if (server) joinServer(server.ip);
    });
  });
}

function stringToColor(str: string): string {
  const colors = ['#4ECDC4', '#FFD93D', '#FF6B6B', '#7BD4B7', '#70ADDF', '#C084FC', '#FB923C'];
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

document.getElementById('add-server-btn')?.addEventListener('click', () => openModalServer());
document.getElementById('server-form-cancel')?.addEventListener('click', () => closeModalServerModal());
document.getElementById('server-form-submit')?.addEventListener('click', () => submitModalServer());

/* ===== SKINS ===== */

// ===== Превью скина (skinviewengine) =====
let skinViewer: SkinViewEngine | null = null;
let skinCanvas = document.getElementById('skin-canvas') as HTMLCanvasElement;

/**
 * Кадрирование основного вьювера.
 * offsetY < 0 — модель ниже центра: запас сверху под .skin-preview-top
 * (объёмный outer поднимает bbox, без сдвига голова лезет под бейджи).
 */
const SKIN_VIEWER_FRAME = { fillY: 0.54, maxFillX: 0.72, offsetY: -0.16 };

/** Кадрирование погрудных мини-превью */
const SKIN_CARD_FRAME = { fillY: 0.96, maxFillX: 0.94, offsetY: 0 };

/** Размер мини-превью в CSS-пикселях — синхронизирован с .skin-card canvas в styles.css */
const PREVIEW_SIZE = { w: 76, h: 84 };

const SKIN_ANIM_IDS: SkinAnimId[] = [
  'idle', 'run', 'wave', 'sneak', 'look', 'cool', 'glide', 'victory', 'sad', 'dance',
];

/** Кадрирование пресетов под скриншот */
const SKIN_SHOT_FRAMES: Record<ShotPresetId, { fillY: number; maxFillX: number; offsetY: number }> = {
  hero: { fillY: 0.56, maxFillX: 0.7, offsetY: -0.16 },
  bust: { fillY: 0.72, maxFillX: 0.55, offsetY: 0.06 },
  back: { fillY: 0.54, maxFillX: 0.72, offsetY: -0.16 },
  discord: { fillY: 0.78, maxFillX: 0.5, offsetY: 0.1 },
};

/** Текущий режим анимации основного вьювера */
let skinAnimMode: SkinAnimId = 'idle';
let skinShotPreset: ShotPresetId | null = null;

/** Пересчёт кадра под текущий размер сцены (ресайз окна, смена скина/плаща) */
function fitSkinViewer(): void {
  if (!skinViewer || skinViewer.disposed || !skinCanvas) return;
  const width = skinCanvas.clientWidth;
  const height = skinCanvas.clientHeight;
  // Скрытая вкладка даёт нулевой размер — кадрировать нечего
  if (width < 2 || height < 2) return;
  skinViewer.setSize(width, height);
  const frame = skinShotPreset ? SKIN_SHOT_FRAMES[skinShotPreset] : SKIN_VIEWER_FRAME;
  skinViewer.fitPlayerToFrame(frame);
}

function initSkinViewer(): void {
  if (!skinCanvas) return;
  try {
    skinViewer = new SkinViewEngine(skinCanvas, {
      autoDetectModel: true,
      idleAnimation: true,
      enableControls: true,
      antialias: true,
      transparent: false,
      presentation: 'full',
    });
    viewerSkinUrl = null;
    viewerCapeUrl = undefined;
    skinViewer.controls.enableZoom = false;
    skinViewer.setCursorFollow(true);
    skinAnimMode = 'idle';
    skinShotPreset = null;
    syncSkinAnimButtons();
    syncSkinPoseButtons();
    bindSkinCursorLook();
    (window as unknown as { __skinViewer?: SkinViewEngine }).__skinViewer = skinViewer;
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => fitSkinViewer()).observe(skinCanvas);
    }
    applySkinViewerDebugSetting();
  } catch (e) {
    console.error('skinviewengine init failed', e);
  }
}

// ===== Отладка вьювера скинов (Mine3D Embedded) =====
const SKIN_VIEWER_DEBUG_KEY = 'Undefined Client-skin-viewer-debug';
const SKIN_DEBUG_OPT_PREFIX = 'Undefined Client-skin-viewer-debug-';
const SKIN_DEBUG_HUD_PREFIX = 'Undefined Client-skin-viewer-debug-hud-';
let skinDebugHudRaf = 0;
let skinDebugOptionsUiReady = false;

type SkinDebugHudSec = 'perf' | 'gpu' | 'render' | 'skin' | 'camera' | 'debug';

interface SkinDebugOptDef {
  key: keyof SkinDebugOptions;
  group: 'overlay' | 'scene' | 'parts' | 'behavior';
}

interface SkinDebugHudDef {
  key: SkinDebugHudSec;
  fallback: boolean;
}

const SKIN_DEBUG_OPT_DEFS: SkinDebugOptDef[] = [
  { key: 'hitbox', group: 'overlay' },
  { key: 'partHitboxes', group: 'overlay' },
  { key: 'axes', group: 'overlay' },
  { key: 'grid', group: 'overlay' },
  { key: 'lightHelper', group: 'overlay' },
  { key: 'shadowCamera', group: 'overlay' },
  { key: 'lookTarget', group: 'overlay' },
  { key: 'wireframe', group: 'overlay' },
  { key: 'floor', group: 'scene' },
  { key: 'ground', group: 'scene' },
  { key: 'contactShadow', group: 'scene' },
  { key: 'atmosphere', group: 'scene' },
  { key: 'particles', group: 'scene' },
  { key: 'postFx', group: 'scene' },
  { key: 'shadows', group: 'scene' },
  { key: 'envMap', group: 'scene' },
  { key: 'head', group: 'parts' },
  { key: 'body', group: 'parts' },
  { key: 'arms', group: 'parts' },
  { key: 'legs', group: 'parts' },
  { key: 'outerLayer', group: 'parts' },
  { key: 'cape', group: 'parts' },
  { key: 'elytra', group: 'parts' },
  { key: 'outerVoxels', group: 'parts' },
  { key: 'pauseAnimation', group: 'behavior' },
  { key: 'freezeCamera', group: 'behavior' },
  { key: 'forceAutoRotate', group: 'behavior' },
  { key: 'flatShading', group: 'behavior' },
];

const SKIN_DEBUG_HUD_DEFS: SkinDebugHudDef[] = [
  { key: 'perf', fallback: true },
  { key: 'gpu', fallback: true },
  { key: 'render', fallback: true },
  { key: 'skin', fallback: true },
  { key: 'camera', fallback: true },
  { key: 'debug', fallback: true },
];

const SKIN_DEBUG_GROUP_TITLE: Record<SkinDebugOptDef['group'] | 'hud', string> = {
  overlay: 'stngs.debugGroupOverlay',
  scene: 'stngs.debugGroupScene',
  parts: 'stngs.debugGroupParts',
  behavior: 'stngs.debugGroupBehavior',
  hud: 'stngs.debugGroupHud',
};

function isSkinViewerDebugEnabled(): boolean {
  return localStorage.getItem(SKIN_VIEWER_DEBUG_KEY) === 'true';
}

function readSkinDebugFlag(key: string, fallback: boolean): boolean {
  const stored = localStorage.getItem(key);
  if (stored === null) return fallback;
  return stored === 'true';
}

function skinDebugOptStorageKey(key: keyof SkinDebugOptions): string {
  return SKIN_DEBUG_OPT_PREFIX + key;
}

function skinDebugHudStorageKey(key: SkinDebugHudSec): string {
  return SKIN_DEBUG_HUD_PREFIX + key;
}

function skinDebugOptInputId(key: keyof SkinDebugOptions): string {
  return 'setting-skin-viewer-debug-' + key;
}

function skinDebugHudInputId(key: SkinDebugHudSec): string {
  return 'setting-skin-viewer-debug-hud-' + key;
}

function readSkinDebugOptions(): SkinDebugOptions {
  const opts = { ...DEFAULT_SKIN_DEBUG_OPTIONS };
  for (const def of SKIN_DEBUG_OPT_DEFS) {
    opts[def.key] = readSkinDebugFlag(
      skinDebugOptStorageKey(def.key),
      DEFAULT_SKIN_DEBUG_OPTIONS[def.key],
    );
  }
  return opts;
}

function ensureSkinDebugOptionsUi(): void {
  const root = document.getElementById('skin-debug-options-root');
  if (!root || skinDebugOptionsUiReady) return;
  skinDebugOptionsUiReady = true;

  const groups: Array<SkinDebugOptDef['group'] | 'hud'> = [
    'overlay',
    'scene',
    'parts',
    'behavior',
    'hud',
  ];

  for (const group of groups) {
    const wrap = document.createElement('div');
    wrap.className = 'stngs-group';
    wrap.innerHTML = `
      <div class="stngs-group-head">
        <div class="stngs-group-title" data-i18n="${SKIN_DEBUG_GROUP_TITLE[group]}"></div>
      </div>
    `;

    if (group === 'hud') {
      for (const def of SKIN_DEBUG_HUD_DEFS) {
        wrap.appendChild(
          buildSkinDebugToggleRow({
            id: skinDebugHudInputId(def.key),
            labelKey: `stngs.debugHud.${def.key}`,
            hintKey: `stngs.debugHud.${def.key}Hint`,
            checked: readSkinDebugFlag(skinDebugHudStorageKey(def.key), def.fallback),
            storageKey: skinDebugHudStorageKey(def.key),
          }),
        );
      }
    } else {
      for (const def of SKIN_DEBUG_OPT_DEFS.filter((d) => d.group === group)) {
        wrap.appendChild(
          buildSkinDebugToggleRow({
            id: skinDebugOptInputId(def.key),
            labelKey: `stngs.debugOpt.${def.key}`,
            hintKey: `stngs.debugOpt.${def.key}Hint`,
            checked: readSkinDebugFlag(
              skinDebugOptStorageKey(def.key),
              DEFAULT_SKIN_DEBUG_OPTIONS[def.key],
            ),
            storageKey: skinDebugOptStorageKey(def.key),
          }),
        );
      }
    }
    root.appendChild(wrap);
  }
  applyStaticI18n();
}

function buildSkinDebugToggleRow(opts: {
  id: string;
  labelKey: string;
  hintKey: string;
  checked: boolean;
  storageKey: string;
}): HTMLElement {
  const row = document.createElement('div');
  row.className = 'stngs-setting-row';
  row.innerHTML = `
    <div class="stngs-setting-label">
      <span data-i18n="${opts.labelKey}">${t(opts.labelKey)}</span>
      <div class="stngs-setting-hint" data-i18n="${opts.hintKey}">${t(opts.hintKey)}</div>
    </div>
    <label class="toggle"><input type="checkbox" id="${opts.id}"><span class="toggle-track"></span></label>
  `;
  const input = row.querySelector('input') as HTMLInputElement;
  input.checked = opts.checked;
  input.addEventListener('change', () => {
    localStorage.setItem(opts.storageKey, String(input.checked));
    applySkinViewerDebugSetting();
  });
  return row;
}

/** Сброс опций отладки движка (не трогает тумблер самой панели) */
function resetSkinViewerDebugDefaults(): void {
  ensureSkinDebugOptionsUi();
  for (const def of SKIN_DEBUG_OPT_DEFS) {
    const value = DEFAULT_SKIN_DEBUG_OPTIONS[def.key];
    localStorage.setItem(skinDebugOptStorageKey(def.key), String(value));
    const el = document.getElementById(skinDebugOptInputId(def.key)) as HTMLInputElement | null;
    if (el) el.checked = value;
  }
  for (const def of SKIN_DEBUG_HUD_DEFS) {
    localStorage.setItem(skinDebugHudStorageKey(def.key), String(def.fallback));
    const el = document.getElementById(skinDebugHudInputId(def.key)) as HTMLInputElement | null;
    if (el) el.checked = def.fallback;
  }
  applySkinViewerDebugSetting();
}

function applySkinViewerDebugSetting(): void {
  ensureSkinDebugOptionsUi();
  const enabled = isSkinViewerDebugEnabled();
  const opts = readSkinDebugOptions();

  const hud = document.getElementById('skin-debug-hud');
  if (hud) {
    hud.classList.toggle('hidden', !enabled);
    hud.setAttribute('aria-hidden', enabled ? 'false' : 'true');
  }

  for (const def of SKIN_DEBUG_OPT_DEFS) {
    const el = document.getElementById(skinDebugOptInputId(def.key)) as HTMLInputElement | null;
    if (el) el.disabled = !enabled;
  }
  for (const def of SKIN_DEBUG_HUD_DEFS) {
    const el = document.getElementById(skinDebugHudInputId(def.key)) as HTMLInputElement | null;
    if (el) el.disabled = !enabled;
    const block = document.querySelector<HTMLElement>(
      `.skin-debug-hud__block[data-debug-hud-sec="${def.key}"]`,
    );
    if (block) {
      const show = enabled && readSkinDebugFlag(skinDebugHudStorageKey(def.key), def.fallback);
      block.classList.toggle('hidden', !show);
    }
  }

  if (skinViewer && !skinViewer.disposed) {
    skinViewer.setDebugOptions(opts);
    skinViewer.setDebugEnabled(enabled);
  }
  if (enabled) startSkinDebugHud();
  else stopSkinDebugHud();
}

function stopSkinDebugHud(): void {
  if (skinDebugHudRaf) {
    cancelAnimationFrame(skinDebugHudRaf);
    skinDebugHudRaf = 0;
  }
}

function startSkinDebugHud(): void {
  stopSkinDebugHud();
  const tick = (): void => {
    if (!isSkinViewerDebugEnabled()) {
      skinDebugHudRaf = 0;
      return;
    }
    updateSkinDebugHud();
    skinDebugHudRaf = requestAnimationFrame(tick);
  };
  skinDebugHudRaf = requestAnimationFrame(tick);
}

function fmtDebugBool(v: boolean): string {
  return v ? 'on' : 'off';
}

function fmtDebugCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function fmtDebugFlags(flags: Array<[string, boolean]>): string {
  return flags
    .filter(([, on]) => on)
    .map(([name]) => name)
    .join(' ') || '—';
}

function updateSkinDebugHud(): void {
  if (!skinViewer || skinViewer.disposed) return;
  const s = skinViewer.getDebugStats();
  const o = s.options;
  const setText = (id: string, value: string): void => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };
  setText('skin-debug-engine', s.engine);
  setText('skin-debug-version', s.engineVersion);
  setText('skin-debug-fps', String(s.fps));
  setText('skin-debug-frame', `${s.frameMs.toFixed(1)} ms`);
  setText('skin-debug-gpu-load', `${s.gpuLoad}%`);
  setText('skin-debug-fps-range', `${s.fpsMin} / ${s.fpsAvg} / ${s.fpsMax}`);
  setText('skin-debug-gpu', s.gpu);
  setText('skin-debug-gpu-vendor', s.gpuVendor);
  setText('skin-debug-webgl', s.webgl);
  setText('skin-debug-viewport', `${s.width}×${s.height} @${s.pixelRatio}x`);
  setText('skin-debug-buffer', `${s.bufferWidth}×${s.bufferHeight}`);
  setText('skin-debug-draws', String(s.drawCalls));
  setText('skin-debug-tris', fmtDebugCount(s.triangles));
  setText('skin-debug-geoms', String(s.geometries));
  setText('skin-debug-textures', String(s.textures));
  setText('skin-debug-programs', String(s.programs));
  setText('skin-debug-postfx', s.postFx);
  setText('skin-debug-skin-type', s.skinType);
  setText('skin-debug-cape', `${fmtDebugBool(s.hasCape)} / ${fmtDebugBool(s.hasElytra)}`);
  setText('skin-debug-presentation', s.presentation);
  setText('skin-debug-animation', s.animation);
  setText('skin-debug-shot', s.shotPreset);
  setText('skin-debug-camera', `${s.cameraFov}° / ${s.cameraDistance} / ${s.cameraZoom}`);
  setText('skin-debug-yaw', s.cameraYaw.toFixed(2));
  setText('skin-debug-cam-flags', `${fmtDebugBool(s.cursorFollow)} / ${fmtDebugBool(s.autoRotate)}`);
  setText(
    'skin-debug-overlays',
    fmtDebugFlags([
      ['hitbox', o.hitbox],
      ['parts', o.partHitboxes],
      ['axes', o.axes],
      ['grid', o.grid],
      ['light', o.lightHelper],
      ['shadowCam', o.shadowCamera],
      ['look', o.lookTarget],
      ['wire', o.wireframe],
    ]),
  );
  setText(
    'skin-debug-scene-flags',
    fmtDebugFlags([
      ['floor', o.floor],
      ['ground', o.ground],
      ['contact', o.contactShadow],
      ['atmo', o.atmosphere],
      ['fx', o.particles],
      ['post', o.postFx],
      ['shadows', o.shadows],
      ['ibl', o.envMap],
    ]),
  );
  setText(
    'skin-debug-parts',
    fmtDebugFlags([
      ['head', o.head],
      ['body', o.body],
      ['arms', o.arms],
      ['legs', o.legs],
      ['outer', o.outerLayer],
      ['cape', o.cape],
      ['elytra', o.elytra],
      ['voxels', o.outerVoxels],
    ]),
  );
  setText(
    'skin-debug-behavior',
    fmtDebugFlags([
      ['pause', o.pauseAnimation],
      ['freeze', o.freezeCamera],
      ['spin', o.forceAutoRotate],
      ['flat', o.flatShading],
    ]),
  );
}

/**
 * Взгляд idle за курсором по всей вкладке скинов (включая боковые панели).
 * Координаты считаются относительно сцены — уход на UI слева/справа не сбрасывает взгляд.
 */
let skinCursorLookBound = false;
function bindSkinCursorLook(): void {
  if (skinCursorLookBound) return;
  const tab = document.getElementById('tab-skins');
  const stage = document.getElementById('skin-stage');
  if (!tab || !stage) return;
  skinCursorLookBound = true;

  const updateAim = (e: PointerEvent): void => {
    if (!skinViewer || skinViewer.disposed || !skinViewer.cursorFollow) return;
    const rect = stage.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    // За краями сцены не зажимаем в ±1 слишком рано — панели по бокам тоже «тянут» взгляд
    skinViewer.setCursorAim(
      Math.max(-1.35, Math.min(1.35, nx)),
      Math.max(-1.2, Math.min(1.2, ny)),
    );
  };

  tab.addEventListener('pointermove', updateAim);
  tab.addEventListener('pointerleave', () => {
    skinViewer?.setCursorAim(0, 0);
  });
}

const SKIN_ANIM_I18N: Record<SkinAnimId, string> = {
  idle: 'skins.animIdle',
  run: 'skins.animRun',
  wave: 'skins.animWave',
  sneak: 'skins.animSneak',
  look: 'skins.animLook',
  cool: 'skins.animCool',
  glide: 'skins.animGlide',
  victory: 'skins.animVictory',
  sad: 'skins.animSad',
  dance: 'skins.animDance',
};

const SKIN_POSE_I18N: Record<ShotPresetId, string> = {
  hero: 'skins.poseHero',
  bust: 'skins.poseBust',
  back: 'skins.poseBack',
  discord: 'skins.poseDiscord',
};

function setSkinAnimDropdownOpen(open: boolean): void {
  const root = document.getElementById('skin-anim-dropdown');
  const menu = document.getElementById('skin-anim-menu');
  const trigger = document.getElementById('skin-anim-trigger');
  if (!root || !menu || !trigger) return;
  root.classList.toggle('open', open);
  menu.classList.toggle('hidden', !open);
  trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
}

/** Переключение анимации основного вьювера (с кроссфейдом внутри движка) */
function setSkinAnimMode(mode: SkinAnimId): void {
  if (!skinViewer || skinViewer.disposed) return;
  skinShotPreset = null;
  skinViewer.clearShotPreset();
  skinAnimMode = mode;
  skinViewer.setAnimation(createSkinAnimation(mode));
  // Взгляд за курсором — только в idle, иначе ломает другие клипы
  skinViewer.setCursorFollow(mode === 'idle');
  if (mode !== 'idle') skinViewer.setCursorAim(0, 0);
  fitSkinViewer();
  syncSkinAnimButtons();
  syncSkinPoseButtons();
  setSkinAnimDropdownOpen(false);
}

/** Пресет позы/кадра под скриншот */
function setSkinShotPreset(id: ShotPresetId): void {
  if (!skinViewer || skinViewer.disposed) return;
  skinShotPreset = id;
  skinViewer.applyShotPreset(id);
  // Синхронизируем label анимации с тем, что выставил пресет
  if (id === 'hero') skinAnimMode = 'cool';
  else if (id === 'back') skinAnimMode = 'idle';
  else skinAnimMode = 'idle';
  fitSkinViewer();
  syncSkinAnimButtons();
  syncSkinPoseButtons();
  setSkinAnimDropdownOpen(false);
}

function syncSkinPoseButtons(): void {
  document.querySelectorAll<HTMLElement>('#skin-pose-presets [data-pose]').forEach((el) => {
    const id = el.getAttribute('data-pose') as ShotPresetId | null;
    el.classList.toggle('active', id != null && id === skinShotPreset);
    const key = id ? SKIN_POSE_I18N[id] : null;
    if (key) {
      el.setAttribute('data-i18n', key);
      el.textContent = t(key);
    }
  });
}

function syncSkinAnimButtons(): void {
  const label = document.getElementById('skin-anim-trigger-label');
  if (label) {
    if (skinShotPreset) {
      label.setAttribute('data-i18n', SKIN_POSE_I18N[skinShotPreset]);
      label.textContent = t(SKIN_POSE_I18N[skinShotPreset]);
    } else {
      label.setAttribute('data-i18n', SKIN_ANIM_I18N[skinAnimMode]);
      label.textContent = t(SKIN_ANIM_I18N[skinAnimMode]);
    }
  }
  const highlightAnim =
    skinShotPreset === 'bust' || skinShotPreset === 'discord' ? null : skinAnimMode;
  document.querySelectorAll<HTMLElement>('#skin-anim-menu [data-anim]').forEach((el) => {
    el.classList.toggle('active', el.getAttribute('data-anim') === highlightAnim);
  });
}

/** Стабильный вариант позы для превью по id скина */
function previewVariantForId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 4;
}

function setSkinViewerPaused(paused: boolean): void {
  if (!skinViewer || skinViewer.disposed) return;
  if (paused) {
    skinViewer.stop();
    return;
  }
  // Пока вкладка была скрыта, канвас имел нулевой размер — кадрируем заново
  fitSkinViewer();
  skinViewer.start();
}

/**
 * Ленивая инициализация вкладки скинов. WebGL-контекст движка и список превью
 * стоят на старте порядка 0.6 с (создание контекста ждёт готовности GPU-процесса),
 * а вкладка при запуске не видна. Поднимаем при первом открытии вкладки, а если
 * пользователь туда не заходит — в простое после старта, когда GPU уже прогрет.
 */
let skinTabPromise: Promise<void> | null = null;
/** Скин, пришедший из сети раньше, чем был создан вьювер. */
let pendingViewerSkin: string | null = null;
/** Уже показанный URL — не дёргать setSkin повторно (двойная вспышка dress). */
let viewerSkinUrl: string | null = null;
let viewerCapeUrl: string | null | undefined = undefined;

function ensureSkinTab(): Promise<void> {
  if (!skinTabPromise) {
    skinTabPromise = (async () => {
      initSkinViewer();
      updateSkinsAccountUi();
      const auth = accountAuthType();
      if (auth === 'msa' || auth === 'yggdrasil') {
        try {
          await syncLicenseCosmeticsFromProfile({ quiet: true });
        } catch (e) {
          console.warn('auto sync cosmetics on skins tab failed', e);
          await loadSkinsList();
        }
      } else {
        await loadSkinsList();
      }
      if (isOfflineAccount()) {
        await applyOfflineSteveSkin();
      } else if (pendingViewerSkin) {
        const url = pendingViewerSkin;
        pendingViewerSkin = null;
        await loadSkinToViewer(url);
      }
      if (presenceTab === 'skins' && !document.hidden) setSkinViewerPaused(false);
    })();
  } else {
    void refreshSkinsUiForAccount();
  }
  return skinTabPromise;
}

async function loadSkinToViewer(dataUrl: string): Promise<void> {
  // Вьювер ещё не создан (вкладка не открывалась) — запоминаем до ensureSkinTab.
  if (!skinViewer) {
    pendingViewerSkin = dataUrl;
    return;
  }
  // renderSkinsList / upload часто зовут setSkin дважды с тем же URL
  if (viewerSkinUrl === dataUrl) return;
  try {
    await skinViewer.setSkin(dataUrl);
    viewerSkinUrl = dataUrl;
    // Габариты модели зависят от classic/slim, поэтому кадр считаем после загрузки
    fitSkinViewer();
    updateSkinModelBadge();
  } catch (e) {
    console.error('loadSkin failed', e);
  }
}

/** Плащ основного вьювера: меняет габариты модели, поэтому кадрируем заново */
async function setViewerCape(dataUrl: string | null): Promise<void> {
  if (!skinViewer || skinViewer.disposed) return;
  if (viewerCapeUrl === dataUrl) return;
  try {
    await skinViewer.setCape(dataUrl);
    viewerCapeUrl = dataUrl;
  } catch (e) {
    console.error('setCape failed', e);
  }
  fitSkinViewer();
}

/** Бейдж типа модели — движок определяет classic/slim по альфа-каналу скина */
function updateSkinModelBadge(): void {
  const el = document.getElementById('skin-current-model');
  if (!el) return;
  if (!skinViewer || skinViewer.disposed) {
    el.textContent = '';
    return;
  }
  el.textContent = skinViewer.modelType === SkinModelType.Slim
    ? t('skins.modelSlim')
    : t('skins.modelClassic');
}

function accountAuthType(): string {
  return String(currentAccount?.meta?.type || currentAccount?.type || 'offline');
}

/** Ключ владельца косметики: uuid без дефисов или offline */
function accountCosmeticsKey(): string {
  const uuid = String(currentAccount?.uuid || '').replace(/-/g, '').toLowerCase();
  return uuid || 'offline';
}

function isOfflineAccount(): boolean {
  const auth = accountAuthType();
  return auth === 'offline' || auth === 'crack' || accountCosmeticsKey() === 'offline';
}

function canShowCapesRail(): boolean {
  return accountAuthType() === 'msa' && !isOfflineAccount();
}

function ownsCosmetic(item: { id?: string; accountId?: string } | null | undefined): boolean {
  if (!item?.id) return false;
  const key = accountCosmeticsKey();
  if (item.accountId) return String(item.accountId).toLowerCase() === key;
  // Наследие без accountId: только записи с uuid текущего аккаунта в id
  if (key === 'offline') return false;
  const short = key.slice(0, 8);
  return item.id.includes(key) || item.id.includes(short);
}

function cosmeticsForCurrentAccount(): any[] {
  return savedSkins.filter((s) => ownsCosmetic(s));
}

function activeSkinStorageKey(): string {
  return `active-skin:${accountCosmeticsKey()}`;
}

function activeCapeStorageKey(): string {
  return `active-cape:${accountCosmeticsKey()}`;
}

function getActiveSkinId(): string | null {
  return localStorage.getItem(activeSkinStorageKey()) || localStorage.getItem('active-skin');
}

function setActiveSkinId(id: string | null): void {
  const key = activeSkinStorageKey();
  if (id) localStorage.setItem(key, id);
  else localStorage.removeItem(key);
  localStorage.removeItem('active-skin');
}

function getActiveCapeId(): string | null {
  return localStorage.getItem(activeCapeStorageKey()) || localStorage.getItem('active-cape');
}

function setActiveCapeId(id: string | null): void {
  const key = activeCapeStorageKey();
  if (id) localStorage.setItem(key, id);
  else localStorage.removeItem(key);
  localStorage.removeItem('active-cape');
}

async function saveAccountSkin(skin: {
  id: string;
  name: string;
  dataUrl: string;
  mojangCapeId?: string;
}): Promise<any> {
  return api?.saveSkin?.({
    ...skin,
    accountId: accountCosmeticsKey(),
  });
}

/** Локальный Steve из ассетов лаунчера — для оффлайн-аккаунтов */
const OFFLINE_STEVE_SKIN_URL = '../../assets/skins/steve.png';

async function applyOfflineSteveSkin(): Promise<void> {
  setActiveSkinId(null);
  setActiveCapeId(null);
  await loadSkinToViewer(OFFLINE_STEVE_SKIN_URL);
  await setViewerCape(null);
  updateNameType(t('skins.steveSkin'), t('acc.offline'));
}

/** UI вкладки скинов под тип текущего аккаунта */
function updateSkinsAccountUi(): void {
  const offline = isOfflineAccount();
  const showCapes = canShowCapesRail();

  document.getElementById('skin-rail-right')?.classList.toggle('is-hidden', !showCapes);
  document.getElementById('skin-rail-left')?.classList.toggle('is-locked', offline);
  document.getElementById('skins-offline-lock')?.classList.toggle('hidden', !offline);

  const uploadBtn = document.getElementById('upload-skin-btn') as HTMLButtonElement | null;
  if (uploadBtn) {
    uploadBtn.disabled = offline;
    uploadBtn.classList.toggle('hidden', offline);
  }
}

async function refreshSkinsUiForAccount(): Promise<void> {
  updateSkinsAccountUi();
  if (!skinTabPromise) return;
  // Смена аккаунта — разрешить повторную загрузку того же dataUrl
  viewerSkinUrl = null;
  viewerCapeUrl = undefined;
  const auth = accountAuthType();
  if (auth === 'msa' || auth === 'yggdrasil') {
    try {
      await syncLicenseCosmeticsFromProfile({ quiet: true });
    } catch (e) {
      console.warn('auto sync cosmetics failed', e);
      await loadSkinsList();
    }
  } else {
    await loadSkinsList();
  }
  if (isOfflineAccount()) await applyOfflineSteveSkin();
}

/** MSA / Ely — скин уходит на сервер и виден всем; плащи MSA переключаются через API */
async function applyActiveCosmetics(opts?: {
  buildId?: string;
  loader?: string;
  gameVersion?: string;
  silent?: boolean;
  /** Явно снять плащ на MSA (кнопка «Без плаща») */
  hideCape?: boolean;
}): Promise<void> {
  if (!api?.applyCosmetics) return;
  if (isOfflineAccount()) return;
  const skinId = getActiveSkinId();
  const capeId = canShowCapesRail() ? getActiveCapeId() : null;
  if (!skinId && !capeId && !opts?.hideCape) return;

  const mine = cosmeticsForCurrentAccount();
  const skin = skinId ? mine.find((s) => s.id === skinId) : null;
  const cape = capeId ? mine.find((s) => s.id === capeId) : null;
  const variant =
    skinViewer && !skinViewer.disposed && skinViewer.modelType === SkinModelType.Slim
      ? 'slim'
      : 'classic';
  const auth = accountAuthType();
  const online = auth === 'msa' || auth === 'yggdrasil';

  if (!opts?.silent && online && skin?.dataUrl) {
    updateStatus(t('skins.uploadingSkin'));
  }

  try {
    const result = await api.applyCosmetics({
      account: currentAccount,
      skinId: skinId || undefined,
      capeId: capeId || undefined,
      mojangCapeId: cape ? mojangCapeIdFromLocal(cape.id, cape) : undefined,
      skinDataUrl: skin?.dataUrl,
      capeDataUrl: cape?.dataUrl,
      variant,
      hideCape: opts?.hideCape === true && auth === 'msa',
      buildId: opts?.buildId,
      loader: opts?.loader,
      gameVersion: opts?.gameVersion,
      // Клик пользователя — не доверять «уже залит» из meta после 429
      forceSkinUpload: !opts?.silent,
    });

    // Селектор, список аккаунтов и карточка «Лицензионный/Ely» — сразу
    if (skin?.dataUrl && (!opts?.silent || result.uploaded || result.local)) {
      await refreshAccountUiAvatar(skin.dataUrl);
      await bumpAccountAvatarRev(skin.id || skin.dataUrl.slice(-24));
      if (skin.id && !isProfileSkinId(skin.id)) {
        await mirrorSkinToProfileCard(skin.dataUrl);
      }
    }

    // Ely: если API сайта не принял OAuth — открыть страницу смены скина
    if (result.openWeb && !result.uploaded) {
      void api?.openExternal?.(result.openWeb);
    }

    if (opts?.silent) return;

    if (result.uploaded && result.capeSwitched) {
      updateStatus(t('skins.skinAndCapeApplied'));
    } else if (result.uploaded) {
      updateStatus(t('skins.skinUploaded'));
    } else if (result.capeSwitched) {
      updateStatus(t('skins.capeSwitched'));
    } else if (result.rateLimited || result.error === 'rate_limited') {
      updateStatus(
        result.local && result.csl ? t('skins.rateLimitedLocal') : t('skins.rateLimited'),
      );
    } else if (result.openWeb) {
      updateStatus(t('skins.elyUploadWebOnly'));
    } else if (result.error && online) {
      updateStatus(t('skins.applyFailed', { msg: result.error }));
    } else if (!online && skin?.dataUrl) {
      updateStatus(t('skins.offlineSkinHint'));
    } else if (result.local && result.csl && skin?.dataUrl) {
      updateStatus(t('skins.skinUploaded'));
    }
  } catch (e) {
    console.warn('applyCosmetics failed', e);
    if (!opts?.silent) {
      updateStatus(t('skins.applyFailed', { msg: e instanceof Error ? e.message : String(e) }));
    }
  }
}

// ===== Мини-превью карточек (один общий offscreen-движок) =====
// Отдельный WebGLRenderer на карточку упирался в лимит браузера (~16 живых
// контекстов), поэтому все превью рисует один движок, а карточки получают
// готовый кадр через drawImage в обычный 2D-канвас.
let previewEngine: SkinViewEngine | null = null;
let previewQueue: Promise<void> = Promise.resolve();
let previewSkinLoaded: string | null = null;
let previewCapeLoaded: string | null = null;

function getPreviewEngine(): SkinViewEngine | null {
  if (previewEngine && !previewEngine.disposed) return previewEngine;
  try {
    // Карточки: погрудный кадр, прозрачный фон, hero-поза
    previewEngine = new SkinViewEngine(document.createElement('canvas'), {
      autoDetectModel: true,
      idleAnimation: false,
      enableControls: false,
      antialias: true,
      autoResize: false,
      transparent: true,
      presentation: 'bust',
      enableEffects: false,
    });
    previewEngine.setSize(PREVIEW_SIZE.w, PREVIEW_SIZE.h);
    (window as unknown as { __previewEngine?: SkinViewEngine }).__previewEngine = previewEngine;
    previewSkinLoaded = null;
    previewCapeLoaded = null;
  } catch (e) {
    console.error('skin preview engine init failed', e);
    previewEngine = null;
  }
  return previewEngine;
}

/**
 * Рендер превью в 2D-канвас карточки. Задачи выполняются последовательно:
 * движок один, а setSkin/setCape меняют его состояние. Устаревшие задачи
 * отсекаются по target.isConnected — перерисовка списка отцепляет старые канвасы.
 */
function queueCardPreview(
  target: HTMLCanvasElement,
  skinDataUrl: string | null,
  capeDataUrl: string | null,
  yaw: number,
  variant = 0,
): void {
  previewQueue = previewQueue.then(async () => {
    if (!target.isConnected) return;
    const engine = getPreviewEngine();
    if (!engine || engine.disposed) return;
    try {
      if (skinDataUrl && previewSkinLoaded !== skinDataUrl) {
        await engine.setSkin(skinDataUrl);
        previewSkinLoaded = skinDataUrl;
      }
      if (previewCapeLoaded !== capeDataUrl) {
        await engine.setCape(capeDataUrl);
        previewCapeLoaded = capeDataUrl;
      }
      if (engine.disposed || !target.isConnected) return;
      // Разные «постеровые» позы по карточкам; для плащей — вид со спины
      const isCape = Math.abs(yaw - Math.PI) < 0.01;
      engine.setAnimation(new BustPoseAnimation(isCape ? 0 : variant));
      engine.setPlayerYaw(isCape ? Math.PI : (-0.7 + (variant % 4) * 0.18));
      engine.setSize(PREVIEW_SIZE.w, PREVIEW_SIZE.h);
      engine.fitPlayerToFrame(SKIN_CARD_FRAME);
      engine.renderFrame();
      target.width = engine.canvas.width;
      target.height = engine.canvas.height;
      target.getContext('2d')?.drawImage(engine.canvas, 0, 0);
    } catch (e) {
      console.error('card preview failed', e);
    }
  });
}

function updateNameType(name: string, type: string): void {
  const nameEl = document.getElementById('skin-current-name');
  if (nameEl) nameEl.textContent = name;
  const typeEl = document.getElementById('skin-current-type');
  if (typeEl) typeEl.textContent = type;
}

async function loadSkinsList(): Promise<void> {
  if (api?.loadSkins) savedSkins = await api.loadSkins();
  await pruneDuplicateProfileSkins();
  updateSkinsAccountUi();
  if (isOfflineAccount()) {
    const grid = document.getElementById('skins-list');
    if (grid) grid.innerHTML = '';
    const capes = document.getElementById('capes-list');
    if (capes) capes.innerHTML = '';
    return;
  }
  renderSkinsList();
  if (canShowCapesRail()) renderCapesList();
  else {
    const capes = document.getElementById('capes-list');
    if (capes) capes.innerHTML = '';
    await setViewerCape(null);
  }
}

function renderSkinsList(): void {
  const grid = document.getElementById('skins-list');
  if (!grid) return;
  const skins = cosmeticsForCurrentAccount().filter(s => !isCapeId(s.id));
  if (skins.length === 0) {
    grid.innerHTML = '<div class="skins-empty">' + t('skins.none') + '</div>';
    return;
  }
  const activeId = getActiveSkinId();
  grid.innerHTML = skins.map(s => {
    const isActive = activeId === s.id;
    return `
      <div class="skin-card ${isActive ? 'active' : ''}" data-skin-id="${s.id}">
        ${isDeletableSkinId(s.id) ? '<button class="skin-delete-btn" data-skin-id="'+s.id+'" title="'+t('btn.delete')+'"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1.5 3h9M4.5 1.5h3M2 3v7.5a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3M5 4.5v4.5M7 4.5v4.5" stroke="rgba(255,255,255,0.4)" stroke-width="1.2" stroke-linecap="round"/></svg></button>' : ''}
        <canvas class="skin-card-canvas" width="${PREVIEW_SIZE.w}" height="${PREVIEW_SIZE.h}" data-skin-preview="${s.id}"></canvas>
        <div class="skin-card-name">${s.name}</div>
      </div>
    `;
  }).join('');

  skins.forEach(s => {
    const canvas = grid.querySelector<HTMLCanvasElement>(`canvas[data-skin-preview="${s.id}"]`);
    if (canvas && s.dataUrl) {
      queueCardPreview(canvas, s.dataUrl, null, 0, previewVariantForId(s.id));
    }
  });

  const activeSkin = skins.find(s => s.id === activeId) || skins[0];
  if (activeSkin?.dataUrl) {
    if (getActiveSkinId() !== activeSkin.id) setActiveSkinId(activeSkin.id);
    const firstCard = grid.querySelector<HTMLElement>(`.skin-card[data-skin-id="${activeSkin.id}"]`);
    if (firstCard) {
      grid.querySelectorAll('.skin-card').forEach(c => c.classList.remove('active'));
      firstCard.classList.add('active');
    }
    loadSkinToViewer(activeSkin.dataUrl);
    const typeLabel = activeSkin.id.startsWith('ely-skin-')
      ? t('acc.ely')
      : activeSkin.id.startsWith('license-skin-')
        ? t('acc.license')
        : t('acc.local');
    updateNameType(activeSkin.name, typeLabel);
  }

  grid.querySelectorAll<HTMLElement>('.skin-card').forEach(el => {
    el.addEventListener('click', async () => {
      if (isOfflineAccount()) {
        updateStatus(t('skins.offlineLocked'));
        return;
      }
      const id = el.getAttribute('data-skin-id');
      const skin = cosmeticsForCurrentAccount().find(s => s.id === id);
      if (skin?.dataUrl) {
        grid.querySelectorAll('.skin-card').forEach(c => c.classList.remove('active'));
        el.classList.add('active');
        setActiveSkinId(id!);
        await loadSkinToViewer(skin.dataUrl);
        void refreshAccountUiAvatar(skin.dataUrl);
        void bumpAccountAvatarRev(skin.id);
        // Карточка профиля сразу = установленный скин
        if (!isProfileSkinId(id!)) {
          void mirrorSkinToProfileCard(skin.dataUrl);
        }
        const activeCapeId = canShowCapesRail() ? getActiveCapeId() : null;
        const cape = activeCapeId ? cosmeticsForCurrentAccount().find(c => c.id === activeCapeId) : null;
        await setViewerCape(cape?.dataUrl ?? null);
        const typeLabel = skin.id.startsWith('ely-skin-')
          ? t('acc.ely')
          : skin.id.startsWith('license-skin-')
            ? t('acc.license')
            : t('acc.local');
        updateNameType(skin.name, typeLabel);
        if (canShowCapesRail()) renderCapesList();
        void applyActiveCosmetics();
      }
    });
  });
}

document.getElementById('upload-skin-btn')?.addEventListener('click', () => {
  document.getElementById('skin-file-input')?.click();
});

// Сброс вида: после вращения мышью возвращает исходное кадрирование
document.getElementById('skin-reset-view')?.addEventListener('click', () => {
  if (!skinViewer || skinViewer.disposed) return;
  skinViewer.resetCameraPose();
  fitSkinViewer();
});

document.getElementById('skin-anim-trigger')?.addEventListener('click', (e) => {
  e.stopPropagation();
  const root = document.getElementById('skin-anim-dropdown');
  setSkinAnimDropdownOpen(!root?.classList.contains('open'));
});

document.getElementById('skin-anim-menu')?.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-anim]');
  const id = btn?.getAttribute('data-anim') as SkinAnimId | null;
  if (!id || !SKIN_ANIM_IDS.includes(id)) return;
  setSkinAnimMode(id);
});

document.getElementById('skin-pose-presets')?.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-pose]');
  const id = btn?.getAttribute('data-pose') as ShotPresetId | null;
  if (!id || !(id in SKIN_SHOT_FRAMES)) return;
  // Повторный клик по активному пресету — вернуть обычный idle
  if (skinShotPreset === id) {
    setSkinAnimMode('idle');
    return;
  }
  setSkinShotPreset(id);
});

document.addEventListener('click', (e) => {
  const root = document.getElementById('skin-anim-dropdown');
  if (!root || root.classList.contains('open') === false) return;
  if (root.contains(e.target as Node)) return;
  setSkinAnimDropdownOpen(false);
});

document.getElementById('skin-file-input')?.addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  if (isOfflineAccount()) {
    updateStatus(t('skins.offlineLocked'));
    input.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = async () => {
    const dataUrl = reader.result as string;
    const name = file.name.replace(/\.[^/.]+$/, '');
    const id = 'skin-' + accountCosmeticsKey().slice(0, 8) + '-' + Date.now().toString(36);
    await saveAccountSkin({ id, name, dataUrl });
    setActiveSkinId(id);
    await loadSkinToViewer(dataUrl);
    void refreshAccountUiAvatar(dataUrl);
    void bumpAccountAvatarRev(id);
    await mirrorSkinToProfileCard(dataUrl);
    updateNameType(name, t('acc.local'));
    await loadSkinsList();
    // Сразу на Microsoft / Ely.by — чтобы скин видели все
    void applyActiveCosmetics();
  };
  reader.readAsDataURL(file);
  input.value = '';
});

// Cape upload
document.getElementById('capes-list')?.addEventListener('click', (e) => {
  const card = (e.target as HTMLElement).closest('#cape-add-card');
  if (card) {
    if (!canShowCapesRail()) return;
    document.getElementById('cape-file-input')?.click();
  }
});
document.getElementById('cape-file-input')?.addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  if (!canShowCapesRail()) {
    input.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = async () => {
    const dataUrl = reader.result as string;
    const id = 'cape-' + accountCosmeticsKey().slice(0, 8) + '-' + Date.now().toString(36);
    await saveAccountSkin({ id, name: file.name.replace(/\.[^/.]+$/, ''), dataUrl });
    await loadSkinsList();
    setActiveCapeId(id);
    await setViewerCape(dataUrl);
    void applyActiveCosmetics();
    renderCapesList();
  };
  reader.readAsDataURL(file);
  input.value = '';
});

// Delete skin
document.getElementById('skins-list')?.addEventListener('click', async (e) => {
  const btn = (e.target as HTMLElement).closest('.skin-delete-btn') as HTMLElement;
  if (!btn) return;
  if (isOfflineAccount()) return;
  const id = btn.getAttribute('data-skin-id');
  if (!id) return;
  const confirmed = await confirmAction(t('skins.deleteSkin'));
  if (!confirmed) return;
  if (api?.removeSkin) await api.removeSkin(id);
  if (getActiveSkinId() === id) setActiveSkinId(null);
  await loadSkinsList();
});

// Delete cape
document.getElementById('capes-list')?.addEventListener('click', async (e) => {
  const btn = (e.target as HTMLElement).closest('.cape-delete-btn') as HTMLElement;
  if (!btn) return;
  const id = btn.getAttribute('data-cape-id');
  if (!id) return;
  const confirmed = await confirmAction(t('skins.deleteCape'));
  if (!confirmed) return;
  if (api?.removeSkin) await api.removeSkin(id);
  if (getActiveCapeId() === id) setActiveCapeId(null);
  await setViewerCape(null);
  await loadSkinsList();
  if (canShowCapesRail()) renderCapesList();
});

/**
 * Синхронизация скина (+ плащей только для MSA) с Profile API / Ely.
 * Набор косметики привязан к uuid аккаунта — чужие плащи лицензии не подмешиваются.
 */
async function syncLicenseCosmeticsFromProfile(opts?: { quiet?: boolean }): Promise<number> {
  const auth = accountAuthType();
  if (auth !== 'msa' && auth !== 'yggdrasil') {
    if (!opts?.quiet) updateStatus(isOfflineAccount() ? t('skins.offlineLocked') : t('skins.noLicense'));
    return 0;
  }
  if (!api?.listProfileCosmetics || !api?.fetchSkinImage || !api?.saveSkin) {
    if (!opts?.quiet) updateStatus(t('skins.fetchFailed'));
    return 0;
  }

  if (!opts?.quiet) updateStatus(t('skins.loadingLicense'));
  const profile = await api.listProfileCosmetics(currentAccount);
  if (!profile.success) {
    if (!opts?.quiet) {
      updateStatus(t('skins.applyFailed', { msg: profile.error || t('common.error') }));
    }
    return 0;
  }

  // Если main обновил MSA-токен — сохраняем аккаунт
  if ((profile as any).account?.accessToken) {
    currentAccount = {
      ...currentAccount,
      ...(profile as any).account,
      username: (profile as any).account.name || currentAccount.username,
    };
    await api.saveAccount?.({ ...currentAccount, name: currentAccount.username });
  }

  const accKey = accountCosmeticsKey();
  const uuidShort = accKey.slice(0, 8) || 'acc';
  let savedCapeCount = 0;
  let activeMsaCapeId: string | null = null;
  let hadSkin = false;
  const prevActiveId = getActiveSkinId();

  // Удалить только legacy-форматы этого аккаунта (не трогаем актуальные cape-msa-{mojangId})
  if (api.removeSkin) {
    const staleIds = savedSkins
      .filter((s) => {
        if (!ownsCosmetic(s) || !isCapeId(s.id)) return false;
        if (auth === 'msa') {
          return s.id === `cape-license-${uuidShort}`
            || s.id.startsWith(`cape-msa-${uuidShort}-`);
        }
        // Ely: плащи не храним
        return true;
      })
      .map((s) => s.id);
    for (const id of staleIds) await api.removeSkin(id);
  }

  const activeSkin =
    (profile.skins || []).find((s: any) => s.state === 'active') || (profile.skins || [])[0];
  // Если выбран локальный upload — не затирать карточку профиля ответом Mojang/Ely
  // (иначе «Лицензионный скин» откатится, пока upload ещё в полёте)
  const keepLocalProfileCard =
    opts?.quiet
    && !!prevActiveId
    && prevActiveId.startsWith('skin-')
    && savedSkins.some((s) => s.id === prevActiveId && ownsCosmetic(s));

  if (activeSkin?.url && !keepLocalProfileCard) {
    const b64 = await api.fetchSkinImage(activeSkin.url);
    if (b64) {
      const dataUrl = `data:image/png;base64,${b64}`;
      const id = (auth === 'yggdrasil' ? 'ely-skin-' : 'license-skin-') + accKey;
      const name = auth === 'yggdrasil' ? t('skins.elySkin') : t('skins.licenseSkin');
      await saveAccountSkin({ id, name, dataUrl });
      // Quiet: не переключать вьювер, если уже выбран другой скин
      const keepSelection =
        opts?.quiet
        && !!prevActiveId
        && prevActiveId !== id
        && savedSkins.some((s) => s.id === prevActiveId && ownsCosmetic(s));
      if (!keepSelection) {
        setActiveSkinId(id);
        await loadSkinToViewer(dataUrl);
        await refreshAccountUiAvatar(dataUrl);
        await bumpAccountAvatarRev(activeSkin.url);
      }
      hadSkin = true;
    }
  }

  // Плащи — только Microsoft; id = cape-msa-{mojangCapeId}, mojangCapeId в метаданных
  const capeList = auth === 'msa' ? (profile.capes || []) : [];
  const keepCapeIds = new Set<string>();
  for (const cape of capeList) {
    if (!cape?.url || !cape?.id) continue;
    // Всегда перекачиваем — локальный PNG мог быть подменён прокси
    const capeB64 = await api.fetchSkinImage(cape.url);
    if (!capeB64) {
      console.warn('[cosmetics] cape texture fetch failed', cape.alias || cape.id, cape.url);
      continue;
    }
    const capeDataUrl = `data:image/png;base64,${capeB64}`;
    const mojangCapeId = String(cape.id);
    const localId = `cape-msa-${mojangCapeId}`;
    keepCapeIds.add(localId);
    const alias = String(cape.alias || '').trim();
    // «Common» и т.п. — сырой alias Microsoft; для UI оставляем как есть
    const name = alias
      ? t('skins.licenseCapeNamed', { name: alias })
      : t('skins.licenseCape');
    await saveAccountSkin({ id: localId, name, dataUrl: capeDataUrl, mojangCapeId });
    savedCapeCount++;
    if (String(cape.state).toLowerCase() === 'active') activeMsaCapeId = localId;
  }

  // Убрать плащи этого аккаунта, которых больше нет (+ legacy cape-msa-{uuid8}-*)
  if (auth === 'msa' && api.removeSkin) {
    for (const s of savedSkins) {
      if (!ownsCosmetic(s) || !isCapeId(s.id)) continue;
      const obsolete =
        (s.id.startsWith('cape-msa-') && !keepCapeIds.has(s.id))
        || s.id.startsWith(`cape-msa-${uuidShort}-`)
        || s.id === `cape-license-${uuidShort}`;
      if (obsolete && !keepCapeIds.has(s.id)) {
        await api.removeSkin(s.id);
      }
    }
  }

  if (auth !== 'msa') {
    setActiveCapeId(null);
  }

  // Убрать дубли license-skin-{8}/полных uuid и «Лицензионный» у Ely
  if (api?.loadSkins) savedSkins = await api.loadSkins();
  await pruneDuplicateProfileSkins();

  await loadSkinsList();
  // ACTIVE с профиля — в main (confirmed). Выбор в UI не затираем: иначе клик Migrator
  // сбрасывался sync'ом обратно на плащ с аккаунта, и казалось, что «не применяется».
  if (auth === 'msa') {
    const cur = getActiveCapeId();
    const curValid = !!(cur && cosmeticsForCurrentAccount().some((s) => s.id === cur));
    if (!curValid) {
      if (activeMsaCapeId) {
        setActiveCapeId(activeMsaCapeId);
        const c = cosmeticsForCurrentAccount().find((s) => s.id === activeMsaCapeId);
        if (c?.dataUrl) await setViewerCape(c.dataUrl);
      } else {
        setActiveCapeId(null);
        await setViewerCape(null);
      }
    } else if (activeMsaCapeId && cur !== activeMsaCapeId) {
      console.log('[cosmetics] keep UI cape selection', cur, 'profile ACTIVE', activeMsaCapeId);
    }
    if (activeMsaCapeId) {
      try {
        const c = cosmeticsForCurrentAccount().find((s) => s.id === activeMsaCapeId);
        localStorage.setItem(
          `msa-cape-synced:${accountCosmeticsKey()}`,
          mojangCapeIdFromLocal(activeMsaCapeId, c),
        );
      } catch { /* ignore */ }
    }
  }
  if (canShowCapesRail()) renderCapesList();

  if (!opts?.quiet) {
    if (savedCapeCount > 0) {
      updateStatus(t('skins.licenseCapesLoaded', { n: savedCapeCount }));
    } else if (hadSkin) {
      updateStatus(
        auth === 'msa'
          ? t('skins.licenseLoadedNoCapes', { n: capeList.length })
          : t('skins.licenseLoaded'),
      );
    } else {
      updateStatus(t('skins.fetchFailed'));
    }
  }

  return savedCapeCount;
}

// Capes list
function isCapeId(id: string): boolean {
  return id.startsWith('cape-') || id.startsWith('license-cape-');
}

/** Профильный скин аккаунта (MSA / Ely) — не пользовательский upload */
function isProfileSkinId(id: string): boolean {
  return id.startsWith('license-skin-') || id.startsWith('ely-skin-');
}

function canonicalProfileSkinId(auth: string = accountAuthType()): string | null {
  const accKey = accountCosmeticsKey();
  if (!accKey || accKey === 'offline') return null;
  if (auth === 'yggdrasil') return `ely-skin-${accKey}`;
  if (auth === 'msa') return `license-skin-${accKey}`;
  return null;
}

/**
 * Карточка «Лицензионный скин» / «Скин Ely.by» сразу отражает установленный скин.
 * Не меняет activeSkinId — выбор пользователя остаётся на кликнутой карточке.
 */
async function mirrorSkinToProfileCard(dataUrl: string): Promise<void> {
  const auth = accountAuthType();
  const canonical = canonicalProfileSkinId(auth);
  if (!canonical || !dataUrl) return;
  if (auth !== 'msa' && auth !== 'yggdrasil') return;

  const name = auth === 'yggdrasil' ? t('skins.elySkin') : t('skins.licenseSkin');
  await saveAccountSkin({ id: canonical, name, dataUrl });

  const accId = accountCosmeticsKey();
  const idx = savedSkins.findIndex((s) => s.id === canonical);
  if (idx >= 0) {
    savedSkins[idx] = { ...savedSkins[idx], name, dataUrl, accountId: accId };
  } else {
    savedSkins.push({ id: canonical, name, dataUrl, accountId: accId });
  }

  const canvas = document.querySelector<HTMLCanvasElement>(
    `#skins-list canvas[data-skin-preview="${canonical}"]`,
  );
  if (canvas) {
    queueCardPreview(canvas, dataUrl, null, 0, previewVariantForId(canonical));
  } else {
    // Карточки ещё нет в DOM — перерисуем список, сохранив выбор
    const keep = getActiveSkinId();
    await loadSkinsList();
    if (keep) setActiveSkinId(keep);
  }
}

/**
 * Один профильный скин на аккаунт:
 * MSA → license-skin-{uuid}, Ely → ely-skin-{uuid}.
 * Убирает legacy license-skin-{8} и чужой префикс (Ely с «Лицензионный скин»).
 */
async function pruneDuplicateProfileSkins(): Promise<void> {
  if (!api?.removeSkin) return;
  const auth = accountAuthType();
  const canonical = canonicalProfileSkinId(auth);
  if (!canonical) return;

  const profileSkins = savedSkins.filter(
    (s) => ownsCosmetic(s) && !isCapeId(s.id) && isProfileSkinId(String(s.id)),
  );
  if (profileSkins.length === 0) return;

  const wantName = auth === 'yggdrasil' ? t('skins.elySkin') : t('skins.licenseSkin');
  const keep =
    profileSkins.find((s) => s.id === canonical)
    || profileSkins.find((s) =>
      auth === 'yggdrasil'
        ? String(s.id).startsWith('ely-skin-')
        : String(s.id).startsWith('license-skin-'),
    )
    || profileSkins[0];

  let changed = false;
  if (keep?.dataUrl && (keep.id !== canonical || keep.name !== wantName)) {
    await saveAccountSkin({ id: canonical, name: wantName, dataUrl: keep.dataUrl });
    changed = true;
  }

  for (const s of profileSkins) {
    if (s.id === canonical) continue;
    await api.removeSkin(s.id);
    changed = true;
  }

  const active = getActiveSkinId();
  if (active && isProfileSkinId(active) && active !== canonical) {
    setActiveSkinId(canonical);
    changed = true;
  }

  if (changed && api.loadSkins) savedSkins = await api.loadSkins();
}

function isDeletableSkinId(id: string): boolean {
  return id.startsWith('skin-');
}

function isDeletableCapeId(id: string): boolean {
  // Официальные плащи MSA/лицензии не удаляем из списка вручную
  if (id.startsWith('cape-msa-') || id.startsWith('cape-license-') || id.startsWith('license-cape-')) {
    return false;
  }
  return id.startsWith('cape-');
}

function renderCapePreview(canvas: HTMLCanvasElement, capeDataUrl: string): void {
  if (!canvas || !capeDataUrl) return;
  const mine = cosmeticsForCurrentAccount();
  const activeSkinId = getActiveSkinId();
  const activeSkin = mine.find(s => s.id === activeSkinId)
    || mine.find(s => !isCapeId(s.id));
  // Вид со спины — как в старом превью плаща
  queueCardPreview(canvas, activeSkin?.dataUrl ?? null, capeDataUrl, Math.PI);
}

/** Mojang capeId: из метаданных или из локального id (без «отрезания» UUID вслепую) */
function mojangCapeIdFromLocal(localId: string, item?: { mojangCapeId?: string }): string {
  if (item?.mojangCapeId) return String(item.mojangCapeId);
  const prefix = 'cape-msa-';
  if (!localId.startsWith(prefix)) return localId;
  const rest = localId.slice(prefix.length);
  const short = accountCosmeticsKey().slice(0, 8);
  if (short && rest.toLowerCase().startsWith(`${short}-`)) {
    return rest.slice(short.length + 1);
  }
  return rest;
}

function resolveSelectedCapeId(capes: any[]): string | null {
  const activeCapeId = getActiveCapeId();
  if (activeCapeId && capes.some((c) => c.id === activeCapeId)) return activeCapeId;

  // Legacy id / mojangCapeId — сопоставить с карточкой, чтобы UI совпадал с NameMC
  const wantMojang = activeCapeId
    ? mojangCapeIdFromLocal(activeCapeId, capes.find((c) => c.id === activeCapeId))
    : '';
  if (wantMojang) {
    const byMojang = capes.find(
      (c) => c.mojangCapeId === wantMojang || c.id === `cape-msa-${wantMojang}`,
    );
    if (byMojang) return byMojang.id;
  }
  return null;
}

function renderCapesList(): void {
  const list = document.getElementById('capes-list');
  if (!list) return;
  if (!canShowCapesRail()) {
    list.innerHTML = '';
    return;
  }
  const capes = cosmeticsForCurrentAccount().filter(s => isCapeId(s.id));
  const selectedId = resolveSelectedCapeId(capes);
  if (selectedId !== getActiveCapeId()) setActiveCapeId(selectedId);

  const noCapeActive = !selectedId;
  let html = `<div class="cape-card ${noCapeActive ? 'active' : ''}" data-cape-id="">
    <div class="cape-card-stub">
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M3 3L15 15M15 3L3 15" stroke="rgba(255,255,255,0.25)" stroke-width="2" stroke-linecap="round"/></svg>
    </div>
    <div class="cape-card-name">${t('skins.noCape')}</div>
  </div>
  <div class="cape-card" id="cape-add-card">
    <div class="cape-card-stub">
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 2V16M2 9H16" stroke="rgba(255,255,255,0.25)" stroke-width="2" stroke-linecap="round"/></svg>
    </div>
    <div class="cape-card-name">${t('btn.add')}</div>
  </div>`;
  html += capes.map(c => `
    <div class="cape-card ${c.id === selectedId ? 'active' : ''}" data-cape-id="${c.id}">
      ${isDeletableCapeId(c.id) ? '<button class="cape-delete-btn" data-cape-id="'+c.id+'" title="'+t('btn.delete')+'"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1.5 3h9M4.5 1.5h3M2 3v7.5a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3M5 4.5v4.5M7 4.5v4.5" stroke="rgba(255,255,255,0.4)" stroke-width="1.2" stroke-linecap="round"/></svg></button>' : ''}
      <canvas class="skin-card-canvas" width="${PREVIEW_SIZE.w}" height="${PREVIEW_SIZE.h}" data-cape-preview="${c.id}"></canvas>
      <div class="cape-card-name">${c.name}</div>
    </div>
  `).join('');
  list.innerHTML = html;

  capes.forEach(c => {
    const canvas = list.querySelector<HTMLCanvasElement>(`canvas[data-cape-preview="${c.id}"]`);
    if (canvas && c.dataUrl) renderCapePreview(canvas, c.dataUrl);
  });

  const selectedCape = selectedId ? capes.find(c => c.id === selectedId) : null;
  void setViewerCape(selectedCape?.dataUrl ?? null);

  list.querySelectorAll<HTMLElement>('.cape-card').forEach(el => {
    el.addEventListener('click', async () => {
      if (el.id === 'cape-add-card') return;
      const id = el.getAttribute('data-cape-id');
      list.querySelectorAll('.cape-card').forEach(c => c.classList.remove('active'));
      el.classList.add('active');
      if (!id) {
        setActiveCapeId(null);
        await setViewerCape(null);
        if (accountAuthType() === 'msa' && api?.switchAccountCape) {
          updateStatus(t('skins.switchingCape'));
          const sw = await api.switchAccountCape(currentAccount, null);
          updateStatus(sw.success ? t('skins.capeHidden') : t('skins.applyFailed', { msg: sw.error || '' }));
        } else {
          void applyActiveCosmetics({ hideCape: true });
        }
        return;
      }
      const cape = cosmeticsForCurrentAccount().find(c => c.id === id);
      if (cape?.dataUrl) {
        setActiveCapeId(id!);
        await setViewerCape(cape.dataUrl);
        updateNameType(t('skins.capePrefix', { name: cape.name }), t('acc.license'));
        if (id.startsWith('cape-msa-') && api?.switchAccountCape && accountAuthType() === 'msa') {
          const mojangId = mojangCapeIdFromLocal(id, cape);
          updateStatus(t('skins.switchingCape'));
          const sw = await api.switchAccountCape(currentAccount, mojangId);
          if (sw.success && (sw as any).account) {
            currentAccount = { ...currentAccount, ...(sw as any).account };
          }
          if (sw.success) {
            updateStatus(t('skins.capeSwitched'));
            void applyActiveCosmetics({ silent: true });
          } else if (sw.error === 'rate_limited') {
            updateStatus(t('skins.rateLimited'));
          } else if (sw.error === 'cape_mismatch') {
            updateStatus(t('skins.capeMismatch'));
          } else {
            updateStatus(t('skins.applyFailed', { msg: sw.error || '' }));
          }
        } else {
          void applyActiveCosmetics();
        }
      }
    });
  });
}

/* ===== QUICK ACTIONS ===== */

document.getElementById('quick-banner-play')?.addEventListener('click', async () => {
  if (savedBuilds.length > 0) await launchBuild(savedBuilds[0]);
  else updateStatus(t('status.noBuilds'));
});

document.getElementById('modal-about')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeModal('modal-about');
});
document.getElementById('modal-settings')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeModal('modal-settings');
});

document.getElementById('quick-banner-settings')?.addEventListener('click', () => {
  openModal('modal-settings');
  void checkForUpdatesUI();
  void refreshJavaManager();
});
document.getElementById('settings-close')?.addEventListener('click', () => closeModal('modal-settings'));
document.getElementById('about-close')?.addEventListener('click', () => closeModal('modal-about'));

/* ===== SETTINGS TABS ===== */

const settingsTabs = document.querySelectorAll<HTMLElement>('.stngs-sidebar [data-settings-tab]');
settingsTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const target = tab.getAttribute('data-settings-tab');
    settingsTabs.forEach(t => t.classList.toggle('active', t === tab));
    document.querySelectorAll<HTMLElement>('.stngs-panel').forEach(p => {
      p.classList.toggle('active', p.getAttribute('data-settings-panel') === target);
    });
    if (target === 'launch') void refreshJavaManager();
  });
});

/* ===== SETTINGS ABOUT PANEL ===== */

void api?.getAppVersion?.().then(v => {
  const el = document.getElementById('settings-about-version');
  if (el && v) el.textContent = v;
});

document.getElementById('settings-about-releases')?.addEventListener('click', () => {
  void api?.openExternal('https://github.com/studioberry-hub/client/releases');
});
document.getElementById('settings-about-tg')?.addEventListener('click', () => {
  void api?.openExternal('https://t.me/undefinedlauncher');
});
document.getElementById('settings-about-copy')?.addEventListener('click', () => {
  const version = document.getElementById('settings-about-version')?.textContent || '—';
  const lines = [t('about.copyLine'), `${t('about.copyVer')} ${version}`, t('about.license')];
  navigator.clipboard.writeText(lines.join('\n')).catch(() => {});
});

/* ===== UPDATE CHECK ===== */

const updateStatusEl = document.getElementById('settings-update-status');
const updateBtn = document.getElementById('settings-update-btn') as HTMLButtonElement | null;
const updatesTabEl = document.querySelector<HTMLElement>('.stngs-sidebar [data-settings-tab="updates"]');
let updatePending = false;

function setUpdatesTabIndicator(hasUpdate: boolean): void {
  if (updatesTabEl) updatesTabEl.classList.toggle('has-update', hasUpdate);
}

async function checkForUpdatesUI(): Promise<void> {
  if (!api?.checkForUpdates || !updateStatusEl) return;
  if (updateBtn) updateBtn.disabled = true;
  updateStatusEl.textContent = t('updates.checking');
  let info;
  try {
    info = await api.checkForUpdates();
  } catch {
    info = null;
  }
  if (!info || info.error) {
    updateStatusEl.textContent = t('updates.checkFailed');
    if (updateBtn) {
      updateBtn.disabled = false;
      updateBtn.textContent = t('btn.check');
      updateBtn.classList.remove('has-update');
    }
    updatePending = false;
    setUpdatesTabIndicator(false);
    return;
  }
  if (info.updateAvailable) {
    updatePending = true;
    setUpdatesTabIndicator(true);
    updateStatusEl.textContent = t('updates.available', { latest: info.latest, current: info.current });
    if (updateBtn) {
      updateBtn.disabled = false;
      updateBtn.textContent = t('btn.updateRestart');
      updateBtn.classList.add('has-update');
    }
  } else {
    updatePending = false;
    setUpdatesTabIndicator(false);
    updateStatusEl.textContent = t('updates.latest', { current: info.current });
    if (updateBtn) {
      updateBtn.disabled = false;
      updateBtn.textContent = t('btn.check');
      updateBtn.classList.remove('has-update');
    }
  }
}

updateBtn?.addEventListener('click', async () => {
  if (updatePending) {
    const result = await api?.launchUpdater();
    if (result?.success) return;
    updatePending = false;
    setUpdatesTabIndicator(false);
    updateStatusEl!.textContent = t('updates.launchFailed');
    updateBtn.textContent = t('btn.check');
    updateBtn.classList.remove('has-update');
    return;
  }
  await checkForUpdatesUI();
});

document.getElementById('about-copy-btn')?.addEventListener('click', () => {
  const lines = ['Undefined Client - Minecraft Launcher'];
  document.querySelectorAll('#modal-about .about-row').forEach(row => {
    const spans = row.querySelectorAll('span');
    if (spans.length === 2) lines.push(`${spans[0].textContent}: ${spans[1].textContent}`);
  });
  const ver = document.getElementById('about-version');
  if (ver) {
    const verText = (ver.textContent || '').split('—').pop()?.trim() || ver.textContent || '';
    lines.push(`${t('about.copyVer')} ${verText}`);
  }
  navigator.clipboard.writeText(lines.join('\n')).catch(() => {});
});

document.getElementById('about-tg-btn')?.addEventListener('click', () => {
  api?.openExternal('https://t.me/undefinedlauncher');
});

/* ===== CONTEXT MENU ===== */

const ctxMenu = document.getElementById('ctx-menu')!;

document.getElementById('btn-menu')?.addEventListener('click', (e) => {
  e.stopPropagation();
  const btn = e.currentTarget as HTMLElement | null;
  if (!btn) return;
  const rect = btn.getBoundingClientRect();
  ctxMenu.style.left = 'auto';
  ctxMenu.style.right = (window.innerWidth - rect.right) + 'px';
  ctxMenu.style.top = (rect.bottom + 4) + 'px';
  ctxMenu.classList.add('open');
});

document.addEventListener('click', () => ctxMenu.classList.remove('open'));
ctxMenu.addEventListener('click', (e) => e.stopPropagation());

document.getElementById('ctx-settings')?.addEventListener('click', () => {
  ctxMenu.classList.remove('open');
  openModal('modal-settings');
  void checkForUpdatesUI();
  void refreshJavaManager();
});

document.getElementById('ctx-about')?.addEventListener('click', () => {
  ctxMenu.classList.remove('open');
  openModal('modal-about');
});

/* ===== THEME / ACCENT COLOR ===== */

const THEME_ACCENTS: Record<string,string> = {
  '#70ADDF':'ocean', '#5b8ed4':'midnight', '#a78bfa':'purple', '#4ade80':'forest',
};

function darkenColor(hex: string, amount: number): string {
  const r = Math.max(0, parseInt(hex.slice(1,3), 16) - amount);
  const g = Math.max(0, parseInt(hex.slice(3,5), 16) - amount);
  const b = Math.max(0, parseInt(hex.slice(5,7), 16) - amount);
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}

function applyAccent(accent: string): void {
  document.documentElement.style.setProperty('--accent', accent);
  document.documentElement.style.setProperty('--accent-hover', darkenColor(accent, 20));
  const r = parseInt(accent.slice(1,3), 16);
  const g = parseInt(accent.slice(3,5), 16);
  const b = parseInt(accent.slice(5,7), 16);
  document.documentElement.style.setProperty('--accent-rgb', `${r},${g},${b}`);
  const theme = THEME_ACCENTS[accent];
  if (theme) document.documentElement.setAttribute('data-theme', theme);
  else document.documentElement.removeAttribute('data-theme');
}

function updateAccentUI(color: string): void {
  let matched = false;
  document.querySelectorAll('#settings-accent-picker .accent-swatch[data-accent]').forEach(s => {
    const a = s.getAttribute('data-accent');
    const isMatch = a === color;
    if (isMatch) matched = true;
    s.classList.toggle('active', isMatch);
  });
  const customSwatch = document.getElementById('settings-custom-accent');
  if (customSwatch) {
    customSwatch.classList.toggle('active', !matched);
    customSwatch.classList.toggle('has-color', !matched);
    if (!matched) customSwatch.style.background = color;
    else customSwatch.style.background = '';
  }
}

function setAccentColor(color: string): void {
  localStorage.setItem('Undefined Client-accent', color);
  localStorage.setItem('Undefined Client-theme', 'custom');
  applyAccent(color);
  updateAccentUI(color);
}

document.querySelectorAll<HTMLElement>('#settings-accent-picker .accent-swatch[data-accent]').forEach(swatch => {
  swatch.addEventListener('click', () => {
    setAccentColor(swatch.getAttribute('data-accent')!);
  });
});

document.getElementById('settings-custom-accent')?.addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'color';
  input.value = localStorage.getItem('Undefined Client-accent') || '#70ADDF';
  document.body.appendChild(input);
  input.addEventListener('input', () => setAccentColor(input.value));
  input.addEventListener('blur', () => input.remove());
  input.click();
});

// Generic setting load/save helpers
function settingSave(id: string, key: string): void {
  const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
  if (!el) return;
  el.addEventListener('change', () => {
    const val = 'checked' in el ? el.checked : el.value;
    localStorage.setItem('Undefined Client-' + key, String(val));
  });
}
function settingLoad(id: string, key: string, fallback: any = false): void {
  const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
  if (!el) return;
  const stored = localStorage.getItem('Undefined Client-' + key);
  const val = stored !== null ? stored : String(fallback);
  if ('checked' in el) el.checked = val === 'true';
  else el.value = val;
}
// Toggle settings
settingSave('setting-close-after-launch', 'close-after-launch');
settingSave('setting-show-console', 'show-console');
settingSave('setting-keep-open', 'keep-open');
settingSave('setting-auto-update-mods', 'auto-update-mods');
settingSave('setting-language', 'language');
document.getElementById('setting-language')?.addEventListener('change', e => {
  void setLang((e.target as HTMLSelectElement).value);
});
settingSave('setting-minimize-on-launch', 'minimize-on-launch');
settingSave('setting-discord-rpc', 'discord-rpc');
settingSave('setting-check-updates-start', 'check-updates-start');
settingSave('setting-mods-page-size', 'mods-page-size');
settingSave('setting-skin-viewer-debug', 'skin-viewer-debug');
document.getElementById('setting-skin-viewer-debug')?.addEventListener('change', () => {
  applySkinViewerDebugSetting();
});
document.getElementById('setting-skin-viewer-debug-reset')?.addEventListener('click', () => {
  resetSkinViewerDebugDefaults();
});
ensureSkinDebugOptionsUi();

// Custom dropdowns (native select hidden, .stngs-select-btn/.stngs-select-menu shown)
let customSelectsInit = false;
function syncSelectUI(wrap: HTMLElement): void {
  const select = wrap.querySelector<HTMLSelectElement>('select');
  const valueEl = wrap.querySelector<HTMLElement>('.stngs-select-value');
  if (!select) return;
  let text = select.options[select.selectedIndex]?.textContent ?? select.value;
  if (!text || !text.trim()) {
    const menuOpt = wrap.querySelector<HTMLElement>(`.stngs-select-opt[data-value="${CSS.escape(select.value)}"]`);
    if (menuOpt) text = menuOpt.textContent || '';
  }
  if (valueEl) valueEl.textContent = text;
  wrap.querySelectorAll<HTMLElement>('.stngs-select-opt').forEach(o =>
    o.classList.toggle('selected', o.dataset.value === select.value));
}
function syncCustomSelects(): void {
  document.querySelectorAll<HTMLElement>('.stngs-select-wrap').forEach(syncSelectUI);
}
function initCustomSelects(): void {
  if (customSelectsInit) return;
  customSelectsInit = true;
  document.querySelectorAll<HTMLElement>('.stngs-select-wrap').forEach(wrap => {
    const btn = wrap.querySelector<HTMLElement>('.stngs-select-btn');
    const menu = wrap.querySelector<HTMLElement>('.stngs-select-menu');
    const select = wrap.querySelector<HTMLSelectElement>('select');
    if (!btn || !menu || !select) return;
    btn.addEventListener('click', e => {
      e.stopPropagation();
      document.querySelectorAll<HTMLElement>('.stngs-select-wrap.open').forEach(w => {
        if (w !== wrap) w.classList.remove('open');
      });
      wrap.classList.toggle('open');
    });
    menu.addEventListener('click', e => {
      const opt = (e.target as HTMLElement).closest<HTMLElement>('.stngs-select-opt');
      if (!opt || opt.dataset.value === undefined) return;
      select.value = opt.dataset.value;
      select.dispatchEvent(new Event('change'));
      wrap.classList.remove('open');
      syncSelectUI(wrap);
    });
    select.addEventListener('change', () => syncSelectUI(wrap));
  });
  document.addEventListener('click', e => {
    if (!(e.target as HTMLElement).closest('.stngs-select-wrap')) {
      document.querySelectorAll<HTMLElement>('.stngs-select-wrap.open').forEach(w => w.classList.remove('open'));
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.querySelectorAll<HTMLElement>('.stngs-select-wrap.open').forEach(w => w.classList.remove('open'));
    }
  });
  syncCustomSelects();
}

// Animations toggle
const animationsToggle = document.getElementById('setting-animations') as HTMLInputElement | null;
if (animationsToggle) {
  const animKey = 'Undefined Client-animations';
  const animStored = localStorage.getItem(animKey);
  const animOn = animStored !== null ? animStored === 'true' : true;
  animationsToggle.checked = animOn;
  document.documentElement.classList.toggle('animations-off', !animOn);
  animationsToggle.addEventListener('change', () => {
    document.documentElement.classList.toggle('animations-off', !animationsToggle.checked);
    localStorage.setItem(animKey, String(animationsToggle.checked));
  });
}

// RAM slider
const ramSlider = document.getElementById('setting-ram') as HTMLInputElement | null;
const ramLabel = document.getElementById('setting-ram-label');
if (ramSlider && ramLabel) {
  const ramKey = 'Undefined Client-ram';
  const stored = localStorage.getItem(ramKey);
  ramSlider.value = stored || '2048';
  ramLabel.textContent = ramSlider.value + t('common.mb');
  ramSlider.addEventListener('input', () => {
    ramLabel.textContent = ramSlider.value + t('common.mb');
    localStorage.setItem(ramKey, ramSlider.value);
  });
}

// UI scale (zoom)
const uiScaleSlider = document.getElementById('setting-ui-scale') as HTMLInputElement | null;
const uiScaleLabel = document.getElementById('setting-ui-scale-label');
if (uiScaleSlider && uiScaleLabel) {
  const scaleKey = 'Undefined Client-ui-scale';
  const storedScale = localStorage.getItem(scaleKey);
  uiScaleSlider.value = storedScale || '100';
  uiScaleLabel.textContent = uiScaleSlider.value + '%';
  const applyScale = (v: string): void => {
    const zoom = Number(v) / 100;
    document.body.style.zoom = String(zoom);
  };
  applyScale(uiScaleSlider.value);
  uiScaleSlider.addEventListener('input', () => {
    uiScaleLabel.textContent = uiScaleSlider.value + '%';
    localStorage.setItem(scaleKey, uiScaleSlider.value);
    applyScale(uiScaleSlider.value);
  });
}

function loadTheme(): void {
  const theme = localStorage.getItem('Undefined Client-theme') || 'ocean';
  const accent = localStorage.getItem('Undefined Client-accent') || '#70ADDF';
  if (theme !== 'custom') {
    const themeAccents: Record<string,string> = { ocean:'#70ADDF', midnight:'#5b8ed4', purple:'#a78bfa', forest:'#4ade80' };
    const defAccent = themeAccents[theme] || '#70ADDF';
    localStorage.setItem('Undefined Client-accent', defAccent);
    applyAccent(defAccent);
  } else {
    applyAccent(accent);
  }
  const currentAccent = localStorage.getItem('Undefined Client-accent') || '#70ADDF';
  updateAccentUI(currentAccent);
  // Load all settings
  settingLoad('setting-close-after-launch', 'close-after-launch', false);
  settingLoad('setting-show-console', 'show-console', false);
  settingLoad('setting-keep-open', 'keep-open', true);
  settingLoad('setting-auto-update-mods', 'auto-update-mods', false);
  settingLoad('setting-language', 'language', 'ru');
  void setLang(localStorage.getItem('Undefined Client-language') || 'ru');
  settingLoad('setting-minimize-on-launch', 'minimize-on-launch', false);
  settingLoad('setting-discord-rpc', 'discord-rpc', true);
  settingLoad('setting-check-updates-start', 'check-updates-start', true);
  settingLoad('setting-mods-page-size', 'mods-page-size', '20');
  settingLoad('setting-skin-viewer-debug', 'skin-viewer-debug', false);
  ensureSkinDebugOptionsUi();
  applySkinViewerDebugSetting();
  initCustomSelects();
}

document.getElementById('quick-launch')?.addEventListener('click', async () => {
  if (savedBuilds.length > 0) {
    const lastId = localStorage.getItem('last-launch-id');
    const build = savedBuilds.find(b => b.id === lastId) || savedBuilds[0];
    await launchBuild(build);
  } else updateStatus(t('status.noBuilds'));
});
document.getElementById('last-server')?.addEventListener('click', () => {
  if (savedServers.length > 0) joinServer(savedServers[savedServers.length - 1].ip);
  else updateStatus(t('status.noServers'));
});

/* ===== LAUNCH / JOIN ===== */

// ===== Поведение при запуске =====
/**
 * Действия из блока настроек «Поведение при запуске». Вызывается всеми путями
 * запуска игры: и запуском сборки, и входом на сервер, — иначе часть путей
 * молча игнорирует настройки пользователя.
 */
function applyLaunchBehavior(): void {
  const showConsole = localStorage.getItem('Undefined Client-show-console') === 'true';
  const closeAfterLaunch = localStorage.getItem('Undefined Client-close-after-launch') === 'true';
  const minimizeOnLaunch = localStorage.getItem('Undefined Client-minimize-on-launch') === 'true';
  const keepOpen = localStorage.getItem('Undefined Client-keep-open') !== 'false';
  if (showConsole) openConsoleLog();
  if (closeAfterLaunch) {
    api?.windowClose();
  } else if (!keepOpen || minimizeOnLaunch) {
    api?.windowMinimize();
  }
}

function showLaunchProgress(status: string): void {
  const el = document.getElementById('download-progress');
  const label = document.getElementById('download-progress-label');
  const speedEl = document.getElementById('download-progress-speed');
  const percent = document.getElementById('download-progress-percent');
  const fill = document.getElementById('download-progress-fill');
  if (el) el.classList.remove('hidden');
  if (label) label.textContent = status;
  if (speedEl) speedEl.textContent = '';
  if (percent) percent.textContent = '';
  if (fill) { fill.style.width = '20%'; fill.style.animation = 'progressIndeterminate 1.5s ease-in-out infinite'; }
}

async function launchBuild(build: Build, server?: { ip: string; port: number; name?: string }): Promise<void> {
  if (!(await requireAccount())) return;
  // Токен мог ещё обновляться в фоне после старта — в игру нужен свежий.
  if (accountRefreshPromise) await accountRefreshPromise;
  if (runningBuild) {
    updateStatus(t('status.closeFirst', { name: runningBuild.name }));
    return;
  }

  updateStatus(t('status.launching', { name: build.name }));
  showLaunchProgress(t('status.launching', { name: build.name }));
  if (!api?.launch) {
    updateStatus(t('status.launcherUnavailable'));
    return;
  }
  runningBuild = build;
  const slugBuildId = build.id.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '');
  const globalRam = Number(localStorage.getItem('Undefined Client-ram') || '2048') || 2048;
  const mem = build.memory;
  const targetMax = (mem && mem.max > 0) ? mem.max : (globalRam > 0 ? globalRam : 0);
  const memMin = mem && mem.min > 0 && mem.min < targetMax ? mem.min : Math.max(Math.min(targetMax >> 1, 1024), 128);
  const memory = targetMax > 0 ? { min: memMin, max: targetMax } : undefined;
  const mine = cosmeticsForCurrentAccount();
  const activeSkinId = isOfflineAccount() ? null : getActiveSkinId();
  const activeCapeId = canShowCapesRail() ? getActiveCapeId() : null;
  const activeSkin = activeSkinId ? mine.find((s) => s.id === activeSkinId) : null;
  const activeCape = activeCapeId ? mine.find((s) => s.id === activeCapeId) : null;
  const skinVariant =
    skinViewer && !skinViewer.disposed && skinViewer.modelType === SkinModelType.Slim
      ? 'slim'
      : 'classic';

  const result = await api.launch({
    buildId: slugBuildId,
    buildName: build.name,
    modpackUrl: (build as any).modpackUrl,
    minecraft: {
      version: build.gameVersion,
      loader: { loader: build.loader as any, version: build.loaderVersion || undefined },
    },
    account: currentAccount,
    javaPath: build.javaPath || undefined,
    jvmArgs: build.jvmArgs ? build.jvmArgs.split(/\s+/).filter(Boolean) : undefined,
    mcArgs: build.mcArgs ? build.mcArgs.split(/\s+/).filter(Boolean) : undefined,
    memory,
    window: build.window,
    server,
    discordRpc: localStorage.getItem('Undefined Client-discord-rpc') !== 'false',
    cosmetics: {
      skinId: activeSkinId || undefined,
      capeId: activeCapeId || undefined,
      mojangCapeId: activeCape
        ? mojangCapeIdFromLocal(activeCape.id, activeCape)
        : undefined,
      skinDataUrl: activeSkin?.dataUrl,
      capeDataUrl: activeCape?.dataUrl,
      variant: skinVariant,
    },
  });
  if (result.success) {
    localStorage.setItem('last-launch-id', build.id);
    applyLaunchBehavior();
  } else {
    runningBuild = null;
    updateStatus(t('status.error', { msg: result.errorKey ? t(result.errorKey) : (result.error || t('common.error')) }));
  }
}

let runningTimerTick = false;
let runningTimerId: any = null;

function startRunningTimer(): void {
  if (runningTimerTick) return;
  runningTimerTick = true;
  const tick = (): void => {
    if (!runningBuild) { runningTimerTick = false; return; }
    const elapsed = Math.floor((Date.now() - runningBuildStart) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    const meta = document.getElementById('quick-banner-meta');
    if (meta) meta.textContent = `${runningBuild.name} · ${timeStr}`;
    const title = document.getElementById('quick-banner-title');
    if (title) title.textContent = t('sidebar.inGame');
    const sub = document.getElementById('quick-banner-sub');
    if (sub) sub.textContent = t('status.timeInBuild');
    const btn = document.getElementById('quick-banner-play') as HTMLButtonElement;
    if (btn) btn.disabled = true;
    // Sidebar indicator
    const ind = document.getElementById('running-indicator');
    if (ind) ind.classList.remove('hidden');
    const indName = document.getElementById('running-indicator-name');
    if (indName) indName.textContent = runningBuild.name;
    const indTime = document.getElementById('running-indicator-time');
    if (indTime) indTime.textContent = timeStr;
  };
  tick();
  runningTimerId = setInterval(tick, 1000);
}

function stopRunningTimer(): void {
  if (!runningBuild) return;
  // Accumulate playtime
  if (runningBuildStart > 0) {
    const elapsed = Math.floor((Date.now() - runningBuildStart) / 1000);
    if (elapsed > 0) {
      runningBuild.playtime = (runningBuild.playtime || 0) + elapsed;
      const existing = savedBuilds.find(b => b.id === runningBuild!.id);
      if (existing) existing.playtime = runningBuild.playtime;
      if (api?.saveBuild) api.saveBuild(runningBuild);
    }
  }
  runningBuild = null;
  runningBuildStart = 0;
  runningTimerTick = false;
  if (runningTimerId) { clearInterval(runningTimerId); runningTimerId = null; }
  const ind = document.getElementById('running-indicator');
  if (ind) ind.classList.add('hidden');
  const btn = document.getElementById('quick-banner-play') as HTMLButtonElement;
  if (btn) btn.disabled = false;
  renderBuilds();
  updateBanner();
  updateSidebarCards();
  updateStats();
}

async function joinServer(ip: string): Promise<void> {
  const [host, portStr] = ip.split(':');
  const port = parseInt(portStr, 10) > 0 ? parseInt(portStr, 10) : 25565;
  updateStatus(t('status.connecting', { ip: host }));
  showLaunchProgress(t('status.connecting', { ip: host }));
  if (!api?.launch) return;
  // Результат обязательно дожидаемся: раньше запуск уходил «в никуда», и ни
  // настройки «Поведения при запуске», ни ошибки до пользователя не доходили.
  const result = await api.launch({
    minecraft: { version: 'latest_release' },
    server: { ip: host, port, name: savedServers.find(s => s.ip === ip)?.name },
    account: currentAccount,
    discordRpc: localStorage.getItem('Undefined Client-discord-rpc') !== 'false',
  });
  if (result.success) {
    applyLaunchBehavior();
  } else {
    updateStatus(t('status.error', { msg: result.errorKey ? t(result.errorKey) : (result.error || t('common.error')) }));
  }
}

function updateStatus(message: string): void {
  const bannerSub = document.getElementById('quick-banner-sub');
  if (bannerSub) bannerSub.textContent = message;
}

/* ===== SAVED ACCOUNTS ===== */

async function renderSavedAccounts(): Promise<void> {
  const list = document.getElementById('acc-popup-list');
  if (!list || !api?.loadAccounts) return;
  const accounts = await api.loadAccounts();
  if (accounts.length === 0) {
    showNoAccountState();
    return;
  }
  list.innerHTML = accounts.map((a: any) => {
    const isEly = a.meta?.type === 'yggdrasil';
    const avatar = accountAvatarSources(a);
    const typeLabel = isEly ? t('acc.ely') : (a.meta?.type === 'msa' ? t('acc.license') : t('acc.offline'));
    return `
    <div class="acc-popup-row${a.uuid === currentAccount.uuid ? ' selected' : ''}" data-uuid="${a.uuid}">
      <div class="acc-popup-row-avatar">
        <img src="${avatar.primary}" data-fallback="${avatar.fallback}" alt="" style="display:none;" onload="this.style.display=''">
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          <rect x="2" y="2" width="28" height="28" rx="2" fill="#7BD4B7"/>
          <circle cx="16" cy="12" r="5" fill="#2A2A2A"/>
          <ellipse cx="16" cy="24" rx="8" ry="6" fill="#2A2A2A"/>
        </svg>
      </div>
      <div class="acc-popup-row-info">
        <div class="acc-popup-row-name">${a.name}</div>
        <div class="acc-popup-row-type">${typeLabel}</div>
      </div>
      <button class="acc-popup-row-del" data-uuid="${a.uuid}">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M4 1C4.00002 0.447709 4.44775 0 5.00004 0H9C9.55228 0 9.99998 0.447722 9.99996 1H4Z" fill="#FF4B4B"/>
          <path d="M0 2C0 1.44772 0.447715 1 1 1H13C13.5523 1 14 1.44772 14 2C14 2.55228 13.5523 3 13 3H1C0.447716 3 0 2.55228 0 2Z" fill="#FF4B4B"/>
          <path d="M1.10995 5.09951C1.05108 4.51082 1.51337 4 2.10499 4H11.895C12.4866 4 12.9489 4.51082 12.89 5.0995L12.09 13.0995C12.0389 13.6107 11.6088 14 11.095 14H2.90499C2.39124 14 1.96107 13.6107 1.90995 13.0995L1.10995 5.09951Z" fill="#FF4B4B"/>
        </svg>
      </button>
    </div>
  `;
  }).join('');
  // Разметка списка собирается строкой, поэтому резерв вешаем уже на готовые узлы.
  list.querySelectorAll<HTMLImageElement>('.acc-popup-row-avatar img')
    .forEach(img => bindImageFallback(img));
  // MSA/Ely: подменить mc-heads на голову из актуальной текстуры скина
  accounts.forEach((a: any) => {
    const type = a.meta?.type || a.type;
    if (type !== 'yggdrasil' && type !== 'msa') return;
    const row = list.querySelector<HTMLImageElement>(`.acc-popup-row[data-uuid="${a.uuid}"] img`);
    if (!row) return;
    resolveAccountHeadAvatar(a).then((avatar) => {
      if (!avatar) return;
      row.src = avatar;
      row.style.display = 'block';
      row.dataset.fallback = '';
    }).catch(() => {});
  });
  list.querySelectorAll<HTMLElement>('.acc-popup-row').forEach(el => {
    el.addEventListener('click', async (e) => {
      if ((e.target as HTMLElement).closest('.acc-popup-row-del')) return;
      const uuid = el.getAttribute('data-uuid');
      const account = accounts.find((a: any) => a.uuid === uuid);
      if (!account) return;
      if ((account.meta?.type === 'msa' || account.meta?.type === 'yggdrasil') && api?.refreshAccount) {
        try {
          const refreshed = await api.refreshAccount(account);
          if (refreshed) {
            applyAccount(refreshed);
            closeAccountPopup();
            await api?.saveAccount?.(refreshed);
            renderSavedAccounts();
            return;
          }
        } catch {}
      }
      applyAccount(account);
      closeAccountPopup();
    });
  });
  list.querySelectorAll<HTMLElement>('.acc-popup-row-del').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const uuid = btn.getAttribute('data-uuid');
      if (uuid && api?.removeAccount) {
        await api.removeAccount(uuid);
        renderSavedAccounts();
      }
    });
  });
}

/* ===== CONFIRM ===== */

function confirmAction(message: string): Promise<boolean> {
  return new Promise(resolve => {
    const overlay = document.getElementById('modal-confirm');
    const msgEl = document.getElementById('confirm-message');
    const yesBtn = document.getElementById('confirm-yes');
    const noBtn = document.getElementById('confirm-no');
    if (!overlay || !msgEl || !yesBtn || !noBtn) { resolve(true); return; }
    msgEl.textContent = message;
    overlay.classList.remove('hidden');
    const cleanup = () => {
      overlay.classList.add('hidden');
      yesBtn.removeEventListener('click', onYes);
      noBtn.removeEventListener('click', onNo);
    };
    const onYes = () => { cleanup(); resolve(true); };
    const onNo = () => { cleanup(); resolve(false); };
    yesBtn.addEventListener('click', onYes);
    noBtn.addEventListener('click', onNo);
  });
}

/* ===== MODS TAB ===== */

let modsData: any[] = [];
let currentCategory = 'all';
let searchTimer: ReturnType<typeof setTimeout> | null = null;
let modsOffset = 0;
let modsTotal = 0;
let modsQuery = '';
let modsSort = 'relevance';
let modsVersion = '';
const modsLoaders = new Set<string>();
const modsTags = new Set<string>();
const modsKnownVersions = new Set<string>();
function modsPageSize(): number {
  const v = Number(localStorage.getItem('Undefined Client-mods-page-size') || '20');
  return [10, 20, 50].includes(v) ? v : 20;
}

function versionKey(v: string): number[] {
  const m = v.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!m) return [0, 0, 0];
  return [Number(m[1]), Number(m[2]), Number(m[3] || 0)];
}
function compareGameVersions(a: string, b: string): number {
  const ka = versionKey(a);
  const kb = versionKey(b);
  for (let i = 0; i < 3; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
  return a.localeCompare(b);
}

function updateModsVersionSelect(): void {
  const select = document.getElementById('mods-version-select') as HTMLSelectElement;
  const menu = document.getElementById('mods-version-menu');
  if (!select || !menu) return;
  const current = select.value;
  const versions = [...modsKnownVersions].sort(compareGameVersions).reverse();
  select.querySelectorAll('option[data-dynamic]').forEach(o => o.remove());
  menu.querySelectorAll('.stngs-select-opt[data-dynamic]').forEach(o => o.remove());
  for (const v of versions) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    opt.setAttribute('data-dynamic', '1');
    select.appendChild(opt);
    const mi = document.createElement('div');
    mi.className = 'stngs-select-opt';
    mi.dataset.value = v;
    mi.setAttribute('data-dynamic', '1');
    mi.textContent = v;
    menu.appendChild(mi);
  }
  if (versions.includes(current)) select.value = current;
  else select.value = '';
  const wrap = select.closest('.stngs-select-wrap');
  if (wrap) syncSelectUI(wrap as HTMLElement);
}

function loadMods(): void {
  modsOffset = 0;
  modsRenderedCount = 0;
  modsData = [];
  refreshModsClearBtn();
  searchMods('', 'all');
}

/**
 * Каталог модов — сетевой запрос к Modrinth. На старте вкладка не видна, поэтому
 * первую загрузку делаем при первом открытии вкладки (или в простое после старта).
 */
let modsCatalogRequested = false;

function ensureModsCatalog(): void {
  if (modsCatalogRequested) return;
  modsCatalogRequested = true;
  loadMods();
}

async function searchMods(query: string, category: string, append: boolean = false): Promise<void> {
  const grid = document.getElementById('mods-grid');
  if (!grid) return;
  if (!append) modsOffset = 0;
  modsQuery = query;
  currentCategory = category;
  if (api?.getModrinthProjects) {
    if (!append) { grid.innerHTML = '<div style="padding:20px;text-align:center;color:rgba(255,255,255,0.3);font-weight:300;">' + t('common.loading') + '</div>'; modsRenderedCount = 0; }
    try {
      const result = await api.getModrinthProjects(query || '', category === 'all' ? '' : category, modsOffset, modsPageSize(), {
        categories: [...modsTags],
        loaders: [...modsLoaders],
        version: modsVersion || undefined,
        index: modsSort,
      });
      if (result.error) {
        if (!append) {
          modsData = [];
          modsTotal = 0;
          modsRenderedCount = 0;
          grid.innerHTML = '<div style="padding:20px;text-align:center;color:rgba(255,255,255,0.3);font-weight:300;">' + t('mods.loadError') + ': ' + result.error + ' <button class="mods-retry-btn">' + t('btn.retry') + '</button></div>';
          grid.querySelector<HTMLButtonElement>('.mods-retry-btn')?.addEventListener('click', () => searchMods(modsQuery, currentCategory));
        }
        return;
      }
      const hits = result.hits || [];
      for (const h of hits) {
        for (const gv of (h.versions || [])) modsKnownVersions.add(gv);
      }
      updateModsVersionSelect();
      modsTotal = result.total_hits || 0;
      if (append) {
        modsData = modsData.concat(hits);
      } else {
        modsData = hits;
      }
      modsOffset += hits.length;
      renderMods(append);
    } catch {
      if (!append) grid.innerHTML = '<div style="padding:20px;text-align:center;color:rgba(255,255,255,0.3);font-weight:300;">' + t('mods.loadError') + '</div>';
    }
  }
}

let modsRenderedCount = 0;

function renderMods(append: boolean = false): void {
  const grid = document.getElementById('mods-grid');
  if (!grid) return;
  if (!modsData || modsData.length === 0) {
    if (!append) grid.innerHTML = '<div style="padding:20px;text-align:center;color:rgba(255,255,255,0.3);font-weight:300;">' + t('mods.notFound') + '</div>';
    return;
  }

  const newItems = append ? modsData.slice(modsRenderedCount) : modsData;
  modsRenderedCount = modsData.length;

  const cardsHtml = newItems.map(p => `
    <div class="mod-card" data-modrinth-id="${p.slug || p.id}" data-modrinth-type="${p.project_type || 'mod'}">
      <div class="mod-card-icon" style="background:${p.color ? '#' + p.color.toString(16).padStart(6,'0') : 'rgba(255,255,255,0.05)'}">
        ${p.icon_url ? `<img src="${catalogImageUrl(p.icon_url)}" alt="">` : '<svg width="24" height="24" viewBox="0 0 20 20" fill="none"><rect width="20" height="20" rx="4" fill="#2A2A2A"/><path d="M6 4L14 10L6 16V4Z" fill="#fff"/></svg>'}
      </div>
      <div class="mod-card-info">
        <div class="mod-card-name">${p.title || 'Unknown'}</div>
        <div class="mod-card-desc">${(p.description || '').substring(0, 100)}</div>
      </div>
      <div class="mod-card-actions">
        <button class="details-btn" data-modrinth-id="${p.slug || p.id}">${t('btn.details')}</button>
        <button class="list-row-btn download-btn" data-modrinth-id="${p.slug || p.id}">${t('btn.download')}</button>
      </div>
    </div>
  `).join('');
  const loadMoreHtml = `<div class="load-more-wrap"><button class="load-more-btn" ${modsOffset >= modsTotal ? 'disabled' : ''}>${modsOffset >= modsTotal ? t('mods.allLoaded') : t('mods.showMore')}</button></div>`;

  if (append) {
    const oldWrap = grid.querySelector('.load-more-wrap');
    if (oldWrap) oldWrap.remove();
    grid.insertAdjacentHTML('beforeend', cardsHtml + loadMoreHtml);
  } else {
    grid.innerHTML = cardsHtml + loadMoreHtml;
  }

  // Details button
  grid.querySelectorAll<HTMLElement>('.details-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-modrinth-id');
      if (id) openModalDetails(id);
    });
  });

  // Download button → version picker → target build → download
  grid.querySelectorAll<HTMLElement>('.download-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-modrinth-id');
      if (!id) return;
      openModalVersionsForDownload(id);
    });
  });

  // Load more button
  const loadMoreBtn = grid.querySelector<HTMLButtonElement>('.load-more-btn');
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', async () => {
      loadMoreBtn.disabled = true;
      await searchMods(modsQuery, currentCategory, true);
    });
  }
}

// New flow: version picker → target build → download
let pendingDownloadVersionId: string = '';
let pendingDownloadGameVersions: string[] = [];

function openModalVersionsForDownload(projectId: string): void {
  pendingDownloadVersionId = '';
  pendingDownloadGameVersions = [];
  pendingTargetProjectId = projectId;
  const titleEl = document.getElementById('modal-versions-title');
  const subEl = document.getElementById('modal-versions-sub');
  const list = document.getElementById('versions-list');
  const confirmBtn = document.getElementById('modal-versions-confirm') as HTMLButtonElement;
  if (titleEl) titleEl.textContent = t('mods.versionsTitle');
  if (subEl) subEl.textContent = t('mods.versionsLoading');
  if (!list) return;
  if (confirmBtn) confirmBtn.disabled = true;
  list.innerHTML = '<div style="padding:16px;text-align:center;color:rgba(255,255,255,0.3);">' + t('common.loading') + '</div>';
  openModal('modal-versions');

  (async () => {
    let versions = await api?.getModrinthVersions(projectId) || [];
    if (versions.length === 0) {
      list.innerHTML = '<div style="padding:16px;text-align:center;color:rgba(255,255,255,0.3);">' + t('mods.versionsNone') + '</div>';
      if (subEl) subEl.textContent = t('mods.versionsNoneShort');
      return;
    }
    const versionFilter = modsVersion || '';
    const loaderFilter = [...modsLoaders];
    if (versionFilter || loaderFilter.length) {
      const filtered = versions.filter(v => {
        if (versionFilter && !(v.game_versions || []).includes(versionFilter)) return false;
        if (loaderFilter.length && !(v.loaders || []).some((l: string) => loaderFilter.includes(l))) return false;
        return true;
      });
      if (filtered.length === 0) {
        list.innerHTML = '<div style="padding:16px;text-align:center;color:rgba(255,255,255,0.3);">' + t('mods.versionsFilterEmpty') + '</div>';
        if (subEl) subEl.textContent = t('mods.versionsFilterEmpty');
        return;
      }
      if (subEl) subEl.textContent = t('mods.versionsFilteredCount', { n: filtered.length });
      versions = filtered;
    } else {
      if (subEl) subEl.textContent = t('mods.versionsCount', { n: versions.length });
    }
    list.innerHTML = versions.map((v: any) => {
      const loaders = (v.loaders || []).map((l: string) => `<span class="version-loader-tag">${l}</span>`).join('');
      const gv = versionFilter && (v.game_versions || []).includes(versionFilter) ? versionFilter : (v.game_versions?.[0] || '');
      return `<div class="version-item" data-version-id="${v.id}">
        <div class="version-item-name">${v.name || v.version_number || '—'}</div>
        <div class="version-item-loaders">${loaders}</div>
        <div class="version-item-meta">${gv}</div>
      </div>`;
    }).join('');
    list.querySelectorAll('.version-item').forEach(el => {
      el.addEventListener('click', () => {
        list.querySelectorAll('.version-item.selected').forEach(e => e.classList.remove('selected'));
        el.classList.add('selected');
        if (confirmBtn) confirmBtn.disabled = false;
        const vid = el.getAttribute('data-version-id');
        const vobj = versions.find(v => v.id === vid);
        pendingDownloadGameVersions = vobj?.game_versions || [];
      });
    });
  })();
}

// Override version confirm to go to target build selector (or install modpack directly)
document.getElementById('modal-versions-confirm')?.addEventListener('click', async () => {
  const selected = document.querySelector('#versions-list .version-item.selected');
  if (!selected || !pendingTargetProjectId) return;
  pendingDownloadVersionId = selected.getAttribute('data-version-id') || '';
  closeModal('modal-versions');
  // Fetch project to determine if it's a modpack
  const projectInfo = await api?.getModrinthProject(pendingTargetProjectId);
  if (projectInfo?.project_type === 'modpack') {
    // Install modpack directly as a new build
    updateStatus(t('status.downloadingPack'));
    const result = await api?.downloadMod(pendingTargetProjectId, pendingDownloadVersionId);
    if (result?.success) {
      updateStatus(t('status.packInstalled'));
      await loadBuilds();
    } else {
      updateStatus(t('status.error', { msg: result?.error || t('common.unknown') }));
    }
  } else {
    // Step 2: open target build selector for regular mods
    openModalTargetBuildForDownload(pendingTargetProjectId);
  }
});

function openModalTargetBuildForDownload(projectId: string): void {
  const list = document.getElementById('target-build-list');
  const confirmBtn = document.getElementById('modal-target-confirm') as HTMLButtonElement;
  if (!list) return;
  if (confirmBtn) confirmBtn.disabled = true;

  if (savedBuilds.length === 0) {
    list.innerHTML = '<div style="padding:16px;text-align:center;color:rgba(255,255,255,0.3);">' + t('mods.noBuildsForInstall') + '</div>';
  } else {
    list.innerHTML = savedBuilds.map(b => {
      const iconSrc = b.icon ? buildIconSrc(b.icon) : '';
      const compatible = pendingDownloadGameVersions.length === 0 ||
        b.gameVersion === 'latest_release' || b.gameVersion === 'latest_snapshot' ||
        pendingDownloadGameVersions.includes(b.gameVersion);
      const compatCls = compatible ? '' : ' incompatible';
      const compatAttr = compatible ? '' : ` title="${t('mods.incompatibleBuild')}"`;
      return `<div class="build-option-item${compatCls}" data-build-id="${b.id}"${compatAttr}>
        <div class="build-option-icon" style="background:rgba(255,255,255,0.1)">${iconSrc ? `<img src="${iconSrc}">` : ''}</div>
        <div class="build-option-info">
          <div class="build-option-name">${b.name}</div>
          <div class="build-option-meta">${b.gameVersion} · ${b.loader}</div>
        </div>
      </div>`;
    }).join('');
    list.querySelectorAll('.build-option-item').forEach(el => {
      el.addEventListener('click', () => {
        if (el.classList.contains('incompatible')) return;
        list.querySelectorAll('.build-option-item.selected').forEach(e => e.classList.remove('selected'));
        el.classList.add('selected');
        if (confirmBtn) confirmBtn.disabled = false;
      });
    });
  }
  openModal('modal-target-build');
}

// Override target build confirm to download with version
document.getElementById('modal-target-confirm')?.addEventListener('click', async () => {
  const selected = document.querySelector('#target-build-list .build-option-item.selected');
  if (!selected || !pendingTargetProjectId) return;
  const buildId = selected.getAttribute('data-build-id');
  if (!buildId) return;
  closeModal('modal-target-build');
  updateStatus(t('status.downloading'));
  await downloadModToBuild(pendingTargetProjectId, buildId, pendingDownloadVersionId);
});

async function downloadModToBuild(
  projectId: string,
  buildId: string,
  versionId?: string,
  contentTypeHint?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await api?.installMod(buildId, projectId, versionId, contentTypeHint);
    if (result?.success) {
      const contentType = result.contentType || 'mod';
      const typeLabel: Record<string, string> = { mod: t('type.mod'), resourcepack: t('type.resourcepack'), shader: t('type.shader') };
      updateStatus(t('status.typeInstalled', { type: typeLabel[contentType] || t('type.file') }));
      const build = savedBuilds.find(b => b.id === buildId);
      if (build && result.name && result.filename) {
        const buildMap: Record<string, string> = {
          mod: 'mods', resourcepack: 'resourcePacks', shader: 'shaders', datapack: 'dataPacks',
        };
        const buildKey = buildMap[contentType] || 'mods';
        if (!(build as any)[buildKey]) (build as any)[buildKey] = [];
        (build as any)[buildKey].push({
          name: result.name,
          enabled: true,
          filename: result.filename,
          version: result.version || '',
          description: result.description || '',
          projectId: result.projectId || projectId,
          iconUrl: result.iconUrl || '',
        });
        if (api?.saveBuild) await api.saveBuild(build);
      }
      await loadBuilds();
      return { success: true };
    }
    updateStatus(t('status.error', { msg: result?.error || t('common.unknown') }));
    return { success: false, error: result?.error };
  } catch (e) {
    updateStatus(t('status.downloadError'));
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/* ===== Deep link uclient://: сценарий подтверждения и установки ===== */

/** Этап диалога: от него зависят кнопки и реакция на отмену. */
type DeepLinkStage = 'idle' | 'loading' | 'confirm' | 'installing' | 'finished';

let deepLinkStage: DeepLinkStage = 'idle';
let deepLinkPayload: DeepLinkInstall | null = null;
let deepLinkResolved: Extract<DeepLinkResolveResult, { ok: true }> | null = null;
/** Версия, жёстко заданная в ссылке. Без неё версия подбирается под сборку. */
let deepLinkFixedVersion: DeepLinkVersion | null = null;
let deepLinkBuildId = '';
/** Отменяет результат запроса, который пришёл после закрытия диалога. */
let deepLinkToken = 0;
let deepLinkProgressOff: (() => void) | null = null;

const DEEP_LINK_TYPE_KEYS: Record<string, string> = {
  mod: 'type.mod',
  modpack: 'type.modpack',
  datapack: 'type.datapack',
  resourcepack: 'type.resourcepack',
  shader: 'type.shader',
};

function dlSetText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function dlToggle(id: string, visible: boolean): void {
  document.getElementById(id)?.classList.toggle('hidden', !visible);
}

function dlSetNote(text: string, kind: 'info' | 'error' | 'success'): void {
  const el = document.getElementById('dl-note');
  if (!el) return;
  el.classList.remove('error', 'success');
  if (!text) {
    el.textContent = '';
    el.classList.add('hidden');
    return;
  }
  if (kind !== 'info') el.classList.add(kind);
  el.textContent = text;
  el.classList.remove('hidden');
}

/** Отрицательный процент скрывает полосу прогресса. */
function dlSetProgress(percent: number, label: string): void {
  const wrap = document.getElementById('dl-progress');
  if (!wrap) return;
  if (percent < 0) {
    wrap.classList.add('hidden');
    return;
  }
  wrap.classList.remove('hidden');
  dlSetText('dl-progress-label', label);
  dlSetText('dl-progress-percent', percent > 0 ? `${percent}%` : '');
  const fill = document.getElementById('dl-progress-fill');
  if (fill) fill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

function dlSetButtons(confirmLabel: string, confirmEnabled: boolean, showCancel: boolean): void {
  const confirmBtn = document.getElementById('dl-confirm') as HTMLButtonElement | null;
  if (confirmBtn) {
    confirmBtn.textContent = confirmLabel;
    confirmBtn.disabled = !confirmEnabled;
  }
  const cancelBtn = document.getElementById('dl-cancel') as HTMLButtonElement | null;
  if (cancelBtn) {
    cancelBtn.textContent = t('btn.cancel');
    cancelBtn.disabled = !showCancel;
    cancelBtn.classList.toggle('hidden', !showCancel);
  }
}

function dlVersionLabel(v: DeepLinkVersion): string {
  const title = v.versionNumber || v.name || v.id;
  const game = v.gameVersions[0] || '';
  return game ? `${title} · ${game}` : title;
}

/**
 * Совместимость версии контента со сборкой. Загрузчик проверяем только для модов:
 * текстуры, шейдеры и дата-паки от него не зависят, а Modrinth помечает их
 * служебными загрузчиками ('minecraft', 'datapack').
 */
function dlVersionFitsBuild(v: DeepLinkVersion, build: Build, type: string): boolean {
  const anyGameVersion = build.gameVersion === 'latest_release' || build.gameVersion === 'latest_snapshot';
  if (!anyGameVersion && v.gameVersions.length && !v.gameVersions.includes(build.gameVersion)) return false;
  if (type === 'mod' && v.loaders.length && !v.loaders.includes(build.loader)) return false;
  return true;
}

/** Самая свежая подходящая версия: список от main отсортирован по дате публикации. */
function dlPickVersion(
  versions: DeepLinkVersion[],
  build: Build | null,
  payload: DeepLinkInstall,
): DeepLinkVersion | null {
  const fitting = build ? versions.filter(v => dlVersionFitsBuild(v, build, payload.type)) : versions.slice();
  // Подсказки из ссылки уточняют выбор, но не отбрасывают вариант целиком.
  const hinted = fitting.filter(v =>
    (!payload.gameVersion || v.gameVersions.includes(payload.gameVersion)) &&
    (!payload.loader || !v.loaders.length || v.loaders.includes(payload.loader)));
  const pool = hinted.length > 0 ? hinted : fitting;
  // Релиз предпочтительнее беты: версия не выбрана вручную, ставим стабильное.
  return pool.find(v => v.versionType === 'release') || pool[0] || null;
}

function dlResolveErrorText(code: string): string {
  switch (code) {
    case 'network': return t('deeplink.errNetwork');
    case 'not_found': return t('deeplink.errNotFound');
    case 'type_mismatch': return t('deeplink.errTypeMismatch');
    case 'no_versions': return t('deeplink.errNoVersions');
    case 'version_not_found': return t('deeplink.errVersionNotFound');
    case 'bad_link': return t('deeplink.errBadLink');
    default: return t('deeplink.errUnknown');
  }
}

/** Сообщения от файловых операций и fetch приводим к понятной формулировке. */
function dlInstallErrorText(error?: string): string {
  const raw = String(error || '');
  if (!raw) return t('deeplink.errUnknown');
  if (/ENOSPC|no space/i.test(raw)) return t('deeplink.errNoSpace');
  if (/EACCES|EPERM|EBUSY|EROFS/i.test(raw)) return t('deeplink.errWrite');
  if (/fetch failed|network|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|ECONNREFUSED|getaddrinfo|Download failed/i.test(raw)) {
    return t('deeplink.errNetwork');
  }
  if (/Version not found|No file URL|Version fetch failed/i.test(raw)) return t('deeplink.errVersionNotFound');
  return t('status.error', { msg: raw });
}

function dlShowFailure(text: string): void {
  deepLinkStage = 'finished';
  dlToggle('dl-build-label', false);
  dlToggle('dl-build-list', false);
  dlSetProgress(-1, '');
  dlSetText('dl-sub', t('deeplink.errorSub'));
  dlSetNote(text, 'error');
  dlSetButtons(t('btn.close'), true, false);
  updateStatus(text);
}

function openDeepLinkModal(payload: DeepLinkInstall): void {
  dlSetText('dl-sub', t('deeplink.checking'));
  dlSetText('dl-card-name', payload.name || payload.project);
  dlSetText('dl-card-meta', t('common.loading'));
  const iconEl = document.getElementById('dl-card-icon');
  if (iconEl) iconEl.innerHTML = '';
  const typeEl = document.getElementById('dl-card-type');
  if (typeEl) {
    typeEl.textContent = t(DEEP_LINK_TYPE_KEYS[payload.type] || 'type.file');
    typeEl.classList.remove('hidden');
  }
  const list = document.getElementById('dl-build-list');
  if (list) list.innerHTML = '';
  dlToggle('dl-build-label', false);
  dlToggle('dl-build-list', false);
  dlSetNote('', 'info');
  dlSetProgress(-1, '');
  dlSetButtons(t('btn.install'), false, true);
  openModal('modal-deeplink');
}

function renderDeepLinkConfirm(): void {
  const payload = deepLinkPayload;
  const resolved = deepLinkResolved;
  if (!payload || !resolved) return;

  dlSetText('dl-card-name', resolved.project.title || payload.name || payload.project);
  const iconEl = document.getElementById('dl-card-icon');
  if (iconEl) {
    iconEl.innerHTML = '';
    if (/^https:\/\//i.test(resolved.project.iconUrl)) {
      const img = document.createElement('img');
      img.src = catalogImageUrl(resolved.project.iconUrl);
      iconEl.appendChild(img);
    }
  }

  deepLinkFixedVersion = resolved.versionId
    ? (resolved.versions.find(v => v.id === resolved.versionId) || null)
    : null;
  dlSetText('dl-card-meta', deepLinkFixedVersion
    ? t('deeplink.versionFixed', { version: dlVersionLabel(deepLinkFixedVersion) })
    : t('deeplink.versionLatest'));
  dlSetText('dl-sub', t('deeplink.confirmSub'));

  // Модпак — это отдельный набор версии игры и загрузчика, поэтому ставится
  // новой сборкой, а не в существующую.
  if (payload.type === 'modpack') {
    deepLinkBuildId = '';
    dlToggle('dl-build-label', false);
    dlToggle('dl-build-list', false);
    const version = deepLinkFixedVersion || dlPickVersion(resolved.versions, null, payload);
    if (!version) {
      dlShowFailure(t('deeplink.errVersionNotFound'));
      return;
    }
    dlSetNote(t('deeplink.modpackNote'), 'info');
    dlSetButtons(t('btn.install'), true, true);
    return;
  }

  dlToggle('dl-build-label', true);
  dlToggle('dl-build-list', true);
  const list = document.getElementById('dl-build-list');
  if (!list) return;
  if (savedBuilds.length === 0) {
    list.innerHTML = '<div style="padding:16px;text-align:center;color:rgba(255,255,255,0.3);">'
      + t('mods.noBuildsForInstall') + '</div>';
    dlSetNote(t('deeplink.needBuild'), 'error');
    dlSetButtons(t('btn.install'), false, true);
    return;
  }

  let compatibleCount = 0;
  list.innerHTML = savedBuilds.map(b => {
    const iconSrc = b.icon ? buildIconSrc(b.icon) : '';
    const compatible = deepLinkFixedVersion
      ? dlVersionFitsBuild(deepLinkFixedVersion, b, payload.type)
      : resolved.versions.some(v => dlVersionFitsBuild(v, b, payload.type));
    if (compatible) compatibleCount++;
    const compatCls = compatible ? '' : ' incompatible';
    const compatAttr = compatible ? '' : ` title="${t('mods.incompatibleBuild')}"`;
    return `<div class="build-option-item${compatCls}" data-build-id="${srvEsc(b.id)}"${compatAttr}>
      <div class="build-option-icon" style="background:rgba(255,255,255,0.1)">${iconSrc ? `<img src="${srvEsc(iconSrc)}">` : ''}</div>
      <div class="build-option-info">
        <div class="build-option-name">${srvEsc(b.name)}</div>
        <div class="build-option-meta">${srvEsc(b.gameVersion)} · ${srvEsc(b.loader)}</div>
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('.build-option-item').forEach(el => {
    el.addEventListener('click', () => {
      if (el.classList.contains('incompatible')) return;
      list.querySelectorAll('.build-option-item.selected').forEach(e => e.classList.remove('selected'));
      el.classList.add('selected');
      deepLinkBuildId = el.getAttribute('data-build-id') || '';
      dlSetButtons(t('btn.install'), !!deepLinkBuildId, true);
    });
  });

  dlSetNote(compatibleCount === 0 ? t('deeplink.noCompatibleBuild') : '', 'error');
  dlSetButtons(t('btn.install'), false, true);
}

/**
 * Запускает установку и показывает её прогресс в том же диалоге. Прогресс берётся
 * из существующего канала загрузок Modrinth — второго механизма скачивания нет.
 */
async function runDeepLinkInstall(
  task: () => Promise<{ success: boolean; error?: string }>,
  successText: string,
): Promise<void> {
  deepLinkStage = 'installing';
  dlToggle('dl-build-label', false);
  dlToggle('dl-build-list', false);
  dlSetNote('', 'info');
  dlSetText('dl-sub', t('deeplink.installing'));
  dlSetButtons(t('btn.install'), false, false);
  dlSetProgress(0, t('deeplink.installing'));

  deepLinkProgressOff = api?.onDownloadProgress?.((data) => {
    if (deepLinkStage !== 'installing' || !data) return;
    if (data.kind === 'status' && data.key) {
      dlSetProgress(0, t(data.key, data.params));
      return;
    }
    if (data.type === 'start') dlSetProgress(0, String(data.filename || ''));
    else if (data.type === 'progress') dlSetProgress(Number(data.percent) || 0, String(data.filename || ''));
    else if (data.type === 'done') dlSetProgress(100, String(data.filename || ''));
  }) || null;

  let result: { success: boolean; error?: string };
  try {
    result = await task();
  } catch (e) {
    result = { success: false, error: e instanceof Error ? e.message : String(e) };
  }
  deepLinkProgressOff?.();
  deepLinkProgressOff = null;
  deepLinkStage = 'finished';

  if (result.success) {
    dlSetProgress(100, '');
    dlSetText('dl-sub', t('deeplink.doneSub'));
    dlSetNote(successText, 'success');
    updateStatus(successText);
  } else {
    dlSetProgress(-1, '');
    dlSetText('dl-sub', t('deeplink.errorSub'));
    const message = dlInstallErrorText(result.error);
    dlSetNote(message, 'error');
    updateStatus(message);
  }
  dlSetButtons(t('btn.close'), true, false);
}

async function confirmDeepLinkInstall(): Promise<void> {
  if (deepLinkStage === 'finished') {
    closeDeepLinkModal();
    return;
  }
  if (deepLinkStage !== 'confirm') return;
  const payload = deepLinkPayload;
  const resolved = deepLinkResolved;
  if (!payload || !resolved) return;
  const projectRef = resolved.project.slug || payload.project;

  if (payload.type === 'modpack') {
    const version = deepLinkFixedVersion || dlPickVersion(resolved.versions, null, payload);
    if (!version) {
      dlShowFailure(t('deeplink.errVersionNotFound'));
      return;
    }
    await runDeepLinkInstall(async () => {
      const res = await api?.downloadMod(projectRef, version.id);
      if (res?.success) {
        await loadBuilds();
        return { success: true };
      }
      return { success: false, error: res?.error };
    }, t('deeplink.doneModpack', { name: resolved.project.title }));
    return;
  }

  const build = savedBuilds.find(b => b.id === deepLinkBuildId);
  if (!build) return;
  const version = deepLinkFixedVersion || dlPickVersion(resolved.versions, build, payload);
  if (!version) {
    dlShowFailure(t('deeplink.errVersionForBuild', { build: build.name }));
    return;
  }
  await runDeepLinkInstall(
    () => downloadModToBuild(projectRef, build.id, version.id, payload.type),
    t('deeplink.doneContent', { name: resolved.project.title, build: build.name }),
  );
}

function closeDeepLinkModal(): void {
  // Идущую установку не прерываем: файл уже скачивается в сборку.
  if (deepLinkStage === 'installing') return;
  deepLinkProgressOff?.();
  deepLinkProgressOff = null;
  deepLinkToken++;
  deepLinkStage = 'idle';
  deepLinkPayload = null;
  deepLinkResolved = null;
  deepLinkFixedVersion = null;
  deepLinkBuildId = '';
  closeModal('modal-deeplink');
}

/** Точка входа для всех deep link'ов. */
async function handleDeepLinkPayload(payload: DeepLinkPayload | null): Promise<void> {
  if (!payload) return;
  if (payload.action === 'import-instance') {
    await openShareImportModal(payload.id);
    return;
  }
  await handleDeepLinkInstall(payload);
}

/** Точка входа: сюда попадают ссылки и холодного старта, и запущенного лаунчера. */
async function handleDeepLinkInstall(payload: DeepLinkInstall | null): Promise<void> {
  if (!payload || payload.action !== 'install' || payload.source !== 'modrinth') return;
  if (deepLinkStage === 'installing') {
    updateStatus(t('deeplink.busy'));
    return;
  }
  const token = ++deepLinkToken;
  deepLinkStage = 'loading';
  deepLinkPayload = payload;
  deepLinkResolved = null;
  deepLinkFixedVersion = null;
  deepLinkBuildId = '';
  openDeepLinkModal(payload);

  if (!api?.resolveDeepLink) {
    dlShowFailure(t('deeplink.errUnknown'));
    return;
  }
  const result = await api.resolveDeepLink(payload);
  if (token !== deepLinkToken) return;
  if (!result || !result.ok) {
    dlShowFailure(dlResolveErrorText(result?.code || 'network'));
    return;
  }
  deepLinkResolved = result;
  deepLinkStage = 'confirm';
  renderDeepLinkConfirm();
}

/* ===== Шаринг / импорт пользовательских сборок ===== */

let shareBusy = false;
let shareProgressOff: (() => void) | null = null;
let shareImportId = '';
let shareImportBusy = false;
let shareImportDone = false;
let shareImportProgressOff: (() => void) | null = null;

function shareSetText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function shareToggle(id: string, visible: boolean): void {
  document.getElementById(id)?.classList.toggle('hidden', !visible);
}

function shareSetNote(text: string, kind: 'info' | 'error' = 'info'): void {
  const el = document.getElementById('share-note');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('hidden', !text);
  el.classList.toggle('error', kind === 'error');
}

function shareSetProgress(ratio: number, label: string): void {
  const wrap = document.getElementById('share-progress');
  const fill = document.getElementById('share-progress-fill');
  const labelEl = document.getElementById('share-progress-label');
  const pctEl = document.getElementById('share-progress-percent');
  if (!wrap) return;
  if (ratio < 0) {
    wrap.classList.add('hidden');
    return;
  }
  wrap.classList.remove('hidden');
  if (labelEl) labelEl.textContent = label;
  if (pctEl) pctEl.textContent = ratio > 0 ? `${Math.round(ratio * 100)}%` : '';
  if (fill) fill.style.width = `${Math.max(0, Math.min(100, Math.round(ratio * 100)))}%`;
}

function shareErrorText(code?: string): string {
  switch (code) {
    case 'build_not_found': return t('share.errBuild');
    case 'instance_missing': return t('share.errInstance');
    case 'too_many_files': return t('share.errTooMany');
    case 'file_too_large': return t('share.errFileLarge');
    case 'hosted_too_large': return t('share.errHostedLarge');
    case 'api_missing': return t('share.errApiMissing');
    case 'network':
    case 'timeout': return t('share.errNetwork');
    case 'not_found': return t('shareImport.errNotFound');
    case 'bad_id':
    case 'bad_manifest': return t('shareImport.errBad');
    default:
      if (code && code.startsWith('upload_failed')) return t('share.errUpload');
      if (code && code.startsWith('import_failed')) return t('shareImport.errImport');
      return t('share.errUnknown');
  }
}

function shareBuildIconHtml(build: { icon?: string; iconBg?: string }): string {
  if (build.icon) {
    return `<img src="${buildIconSrc(build.icon)}" style="width:100%;height:100%;object-fit:cover;">`;
  }
  return `<img src="../../assets/InstancesIcons/emptyIcon.png" style="width:100%;height:100%;object-fit:cover;">`;
}

async function openShareModal(build: Build): Promise<void> {
  if (shareBusy) {
    updateStatus(t('share.busy'));
    return;
  }
  shareBusy = true;
  shareProgressOff?.();
  shareProgressOff = api?.onInstanceShareProgress?.((data) => {
    const total = Number(data?.total) || 0;
    const current = Number(data?.current) || 0;
    const phase = String(data?.phase || '');
    const filename = String(data?.filename || '');
    if (phase === 'hash' && total > 0) {
      shareSetProgress(current / total, t('share.phaseHash', { file: filename }));
      shareSetText('share-sub', t('share.preparing'));
    } else if (phase === 'upload' && total > 0) {
      shareSetProgress(current / total, t('share.phaseUpload', { file: filename }));
      shareSetText('share-sub', t('share.uploading'));
    } else if (phase === 'prepare') {
      shareSetProgress(0, t('share.preparing'));
    }
  }) || null;

  shareSetText('share-card-name', build.name);
  shareSetText('share-card-meta', [build.gameVersion, build.loader, build.loaderVersion].filter(Boolean).join(' • '));
  const iconEl = document.getElementById('share-card-icon');
  if (iconEl) iconEl.innerHTML = shareBuildIconHtml(build);
  shareSetNote('', 'info');
  shareSetProgress(0, t('share.preparing'));
  shareToggle('share-link-row', false);
  shareToggle('share-open', false);
  shareSetText('share-sub', t('share.preparing'));
  const doneBtn = document.getElementById('share-done') as HTMLButtonElement | null;
  if (doneBtn) doneBtn.disabled = true;
  openModal('modal-share');

  const authorName = (currentAccount?.username && currentAccount.username !== t('common.loading'))
    ? currentAccount.username
    : 'Undefined Client';

  try {
    const result = await api?.createInstanceShare?.(build.id, { authorName });
    if (!result?.ok || !result.url) {
      shareSetProgress(-1, '');
      shareSetText('share-sub', t('share.errorSub'));
      shareSetNote(shareErrorText(result?.error), 'error');
      if (doneBtn) doneBtn.disabled = false;
      return;
    }
    shareSetProgress(-1, '');
    shareSetText('share-sub', t('share.readySub'));
    const input = document.getElementById('share-link-input') as HTMLInputElement | null;
    if (input) input.value = result.url;
    shareToggle('share-link-row', true);
    shareToggle('share-open', true);
    const counts = result.counts;
    if (counts) {
      shareSetNote(t('share.counts', {
        mods: counts.mods,
        resourcePacks: counts.resourcePacks,
        shaders: counts.shaders,
        dataPacks: counts.dataPacks,
      }), 'info');
    }
    if (doneBtn) doneBtn.disabled = false;
  } catch {
    shareSetProgress(-1, '');
    shareSetText('share-sub', t('share.errorSub'));
    shareSetNote(shareErrorText('network'), 'error');
    if (doneBtn) doneBtn.disabled = false;
  } finally {
    shareBusy = false;
    shareProgressOff?.();
    shareProgressOff = null;
  }
}

function closeShareModal(): void {
  shareProgressOff?.();
  shareProgressOff = null;
  closeModal('modal-share');
}

function shareImportSetProgress(ratio: number, label: string): void {
  const wrap = document.getElementById('share-import-progress');
  const fill = document.getElementById('share-import-progress-fill');
  const labelEl = document.getElementById('share-import-progress-label');
  const pctEl = document.getElementById('share-import-progress-percent');
  if (!wrap) return;
  if (ratio < 0) {
    wrap.classList.add('hidden');
    return;
  }
  wrap.classList.remove('hidden');
  if (labelEl) labelEl.textContent = label;
  if (pctEl) pctEl.textContent = ratio > 0 ? `${Math.round(ratio * 100)}%` : '';
  if (fill) fill.style.width = `${Math.max(0, Math.min(100, Math.round(ratio * 100)))}%`;
}

function shareImportSetNote(text: string, kind: 'info' | 'error' = 'info'): void {
  const el = document.getElementById('share-import-note');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('hidden', !text);
  el.classList.toggle('error', kind === 'error');
}

async function openShareImportModal(id: string): Promise<void> {
  if (shareImportBusy) {
    updateStatus(t('shareImport.busy'));
    return;
  }
  shareImportId = id;
  shareImportDone = false;
  shareImportSetNote('', 'info');
  shareImportSetProgress(-1, '');
  shareSetText('share-import-sub', t('shareImport.loading'));
  shareSetText('share-import-name', '…');
  shareSetText('share-import-author', '');
  const details = document.getElementById('share-import-details');
  if (details) details.innerHTML = '';
  const stats = document.getElementById('share-import-stats');
  if (stats) stats.innerHTML = '';
  const iconEl = document.getElementById('share-import-icon');
  if (iconEl) iconEl.innerHTML = '';
  const confirmBtn = document.getElementById('share-import-confirm') as HTMLButtonElement | null;
  const cancelBtn = document.getElementById('share-import-cancel') as HTMLButtonElement | null;
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.textContent = t('btn.import');
  }
  if (cancelBtn) {
    cancelBtn.disabled = false;
    cancelBtn.classList.remove('hidden');
  }
  openModal('modal-share-import');

  const result = await api?.getInstanceShare?.(id);
  if (!result?.ok || !result.manifest) {
    shareSetText('share-import-sub', t('shareImport.errorSub'));
    shareImportSetNote(shareErrorText(result?.error || 'not_found'), 'error');
    return;
  }
  const m = result.manifest;
  const author = m.authorName || 'Undefined Client';
  shareSetText('share-import-sub', t('shareImport.confirmSub', { author }));
  shareSetText('share-import-name', m.name || '—');
  shareSetText('share-import-author', t('shareImport.fromAuthor', { author }));
  if (iconEl) {
    if (m.iconPreset) iconEl.innerHTML = shareBuildIconHtml({ icon: m.iconPreset });
    else if (m.iconUrl) {
      const src = m.iconUrl.startsWith('http') ? catalogImageUrl(m.iconUrl) : absoluteApiUrl(m.iconUrl);
      iconEl.innerHTML = `<img src="${src}" style="width:100%;height:100%;object-fit:cover;">`;
    } else {
      iconEl.innerHTML = shareBuildIconHtml({});
    }
  }
  if (details) {
    const loader = [m.loader, m.loaderVersion].filter(Boolean).join(' ') || '—';
    details.innerHTML = `
      <div class="share-import-detail">
        <span class="share-import-detail-label">${t('shareImport.detailGame')}</span>
        <span class="share-import-detail-value">${m.gameVersion || '—'}</span>
      </div>
      <div class="share-import-detail">
        <span class="share-import-detail-label">${t('shareImport.detailLoader')}</span>
        <span class="share-import-detail-value">${loader}</span>
      </div>
    `;
  }
  if (stats) {
    const c = m.counts || { mods: 0, resourcePacks: 0, shaders: 0, dataPacks: 0 };
    stats.innerHTML = `
      <div class="share-import-stat"><span>${t('share.statMods')}</span><b>${c.mods}</b></div>
      <div class="share-import-stat"><span>${t('share.statResourcePacks')}</span><b>${c.resourcePacks}</b></div>
      <div class="share-import-stat"><span>${t('share.statShaders')}</span><b>${c.shaders}</b></div>
      <div class="share-import-stat"><span>${t('share.statDataPacks')}</span><b>${c.dataPacks}</b></div>
    `;
  }
  if (confirmBtn) confirmBtn.disabled = false;
}

function absoluteApiUrl(pathOrUrl: string): string {
  try {
    return new URL(pathOrUrl, getApiBase()).toString();
  } catch {
    return pathOrUrl;
  }
}

function closeShareImportModal(): void {
  if (shareImportBusy) return;
  shareImportProgressOff?.();
  shareImportProgressOff = null;
  shareImportId = '';
  closeModal('modal-share-import');
}

async function confirmShareImport(): Promise<void> {
  if (shareImportDone) {
    closeShareImportModal();
    switchTab('builds');
    return;
  }
  if (!shareImportId || shareImportBusy) return;
  shareImportBusy = true;
  const confirmBtn = document.getElementById('share-import-confirm') as HTMLButtonElement | null;
  const cancelBtn = document.getElementById('share-import-cancel') as HTMLButtonElement | null;
  if (confirmBtn) confirmBtn.disabled = true;
  if (cancelBtn) cancelBtn.disabled = true;
  shareSetText('share-import-sub', t('shareImport.importing'));
  shareImportSetNote('', 'info');
  shareImportProgressOff?.();
  shareImportProgressOff = api?.onInstanceShareProgress?.((data) => {
    const total = Number(data?.total) || 0;
    const current = Number(data?.current) || 0;
    const filename = String(data?.filename || '');
    if (String(data?.phase) === 'import' && total > 0) {
      shareImportSetProgress(current / total, t('shareImport.phaseFile', { file: filename }));
    }
  }) || null;

  try {
    const result = await api?.importInstanceShare?.(shareImportId);
    if (!result?.ok) {
      shareImportSetProgress(-1, '');
      shareSetText('share-import-sub', t('shareImport.errorSub'));
      shareImportSetNote(shareErrorText(result?.error), 'error');
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = t('btn.retry');
      }
      if (cancelBtn) cancelBtn.disabled = false;
      return;
    }
    await loadBuilds();
    shareImportDone = true;
    shareImportSetProgress(1, t('shareImport.doneSub'));
    shareSetText('share-import-sub', t('shareImport.doneSub'));
    shareImportSetNote(t('shareImport.doneNote', { name: result.build?.name || '' }), 'info');
    if (confirmBtn) {
      confirmBtn.textContent = t('btn.close');
      confirmBtn.disabled = false;
    }
    if (cancelBtn) cancelBtn.classList.add('hidden');
  } catch {
    shareImportSetProgress(-1, '');
    shareSetText('share-import-sub', t('shareImport.errorSub'));
    shareImportSetNote(shareErrorText('network'), 'error');
    if (confirmBtn) confirmBtn.disabled = false;
    if (cancelBtn) cancelBtn.disabled = false;
  } finally {
    shareImportBusy = false;
    shareImportProgressOff?.();
    shareImportProgressOff = null;
  }
}

document.getElementById('share-close')?.addEventListener('click', () => closeShareModal());
document.getElementById('share-cancel')?.addEventListener('click', () => closeShareModal());
document.getElementById('share-done')?.addEventListener('click', () => closeShareModal());
document.getElementById('share-copy')?.addEventListener('click', async () => {
  const input = document.getElementById('share-link-input') as HTMLInputElement | null;
  if (!input?.value) return;
  try {
    await navigator.clipboard.writeText(input.value);
    updateStatus(t('share.copied'));
  } catch {
    input.select();
    document.execCommand('copy');
    updateStatus(t('share.copied'));
  }
});
document.getElementById('share-open')?.addEventListener('click', () => {
  const input = document.getElementById('share-link-input') as HTMLInputElement | null;
  if (input?.value) void api?.openExternal?.(input.value);
});
document.getElementById('modal-share')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeShareModal();
});

document.getElementById('share-import-close')?.addEventListener('click', () => closeShareImportModal());
document.getElementById('share-import-cancel')?.addEventListener('click', () => closeShareImportModal());
document.getElementById('share-import-confirm')?.addEventListener('click', () => void confirmShareImport());
document.getElementById('modal-share-import')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeShareImportModal();
});

document.getElementById('dl-close')?.addEventListener('click', () => closeDeepLinkModal());
document.getElementById('dl-cancel')?.addEventListener('click', () => closeDeepLinkModal());
document.getElementById('dl-confirm')?.addEventListener('click', () => void confirmDeepLinkInstall());
document.getElementById('modal-deeplink')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeDeepLinkModal();
});

// Keep existing mods search debounce and category handlers below
document.querySelectorAll<HTMLElement>('.category-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentCategory = btn.getAttribute('data-category') || 'all';
    const input = document.getElementById('mods-search-input') as HTMLInputElement;
    modsOffset = 0;
    searchMods(input?.value || '', currentCategory);
  });
});

document.getElementById('mods-search-input')?.addEventListener('input', (e) => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const val = (e.target as HTMLInputElement).value;
    modsOffset = 0;
    searchMods(val, currentCategory);
  }, 400);
});

function refreshModsClearBtn(): void {
  const btn = document.getElementById('mods-filters-clear') as HTMLButtonElement;
  const toggle = document.getElementById('mods-filters-toggle');
  const badge = document.getElementById('mods-filters-count');
  const count = modsLoaders.size + modsTags.size + (modsVersion ? 1 : 0) + (modsSort !== 'relevance' ? 1 : 0);
  if (btn) btn.disabled = count === 0;
  toggle?.classList.toggle('active', count > 0);
  if (badge) {
    badge.textContent = String(count);
    badge.style.display = count > 0 ? '' : 'none';
  }
}

function modsSearchWithFilters(): void {
  const input = document.getElementById('mods-search-input') as HTMLInputElement;
  modsOffset = 0;
  searchMods(input?.value || '', currentCategory);
}

const modsFiltersPopup = document.getElementById('mods-filters-popup');
const modsFiltersPop = document.querySelector('.mods-filters-pop');

function openModsFiltersPopup(): void {
  if (!modsFiltersPopup || !modsFiltersPop) return;
  modsFiltersPopup.classList.remove('hidden', 'closing');
  modsFiltersPop.classList.add('open');
  void modsFiltersPopup.offsetWidth;
  modsFiltersPopup.classList.add('open');
}

function closeModsFiltersPopup(): void {
  if (!modsFiltersPopup || !modsFiltersPop) return;
  if (modsFiltersPopup.classList.contains('closing')) return;
  if (!modsFiltersPopup.classList.contains('open')) {
    modsFiltersPopup.classList.add('hidden');
    return;
  }
  modsFiltersPopup.classList.remove('open');
  modsFiltersPop.classList.remove('open');
  void modsFiltersPopup.offsetWidth;
  modsFiltersPopup.classList.add('closing');
  modsFiltersPopup.onanimationend = () => {
    modsFiltersPopup.classList.remove('closing');
    modsFiltersPopup.classList.add('hidden');
    modsFiltersPopup.onanimationend = null;
  };
}

document.getElementById('mods-filters-toggle')?.addEventListener('click', (e) => {
  e.stopPropagation();
  if (modsFiltersPopup?.classList.contains('open')) {
    closeModsFiltersPopup();
  } else {
    openModsFiltersPopup();
  }
});

document.addEventListener('click', (e) => {
  const wrap = document.getElementById('mods-filters-toggle')?.parentElement;
  if (!wrap || !modsFiltersPopup?.classList.contains('open')) return;
  if (!wrap.contains(e.target as Node)) closeModsFiltersPopup();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModsFiltersPopup();
});

document.getElementById('mods-sort-select')?.addEventListener('change', (e) => {
  modsSort = (e.target as HTMLSelectElement).value || 'relevance';
  refreshModsClearBtn();
  modsSearchWithFilters();
});

document.getElementById('mods-version-select')?.addEventListener('change', (e) => {
  modsVersion = (e.target as HTMLSelectElement).value || '';
  refreshModsClearBtn();
  modsSearchWithFilters();
});

document.querySelectorAll<HTMLButtonElement>('#mods-loader-chips .mods-chip').forEach(btn => {
  btn.addEventListener('click', () => {
    btn.classList.toggle('active');
    const v = btn.getAttribute('data-loader') || '';
    if (btn.classList.contains('active')) modsLoaders.add(v); else modsLoaders.delete(v);
    refreshModsClearBtn();
    modsSearchWithFilters();
  });
});

document.querySelectorAll<HTMLButtonElement>('#mods-tag-chips .mods-chip').forEach(btn => {
  btn.addEventListener('click', () => {
    btn.classList.toggle('active');
    const v = btn.getAttribute('data-tag') || '';
    if (btn.classList.contains('active')) modsTags.add(v); else modsTags.delete(v);
    refreshModsClearBtn();
    modsSearchWithFilters();
  });
});

document.getElementById('mods-filters-clear')?.addEventListener('click', () => {
  modsSort = 'relevance';
  modsVersion = '';
  modsLoaders.clear();
  modsTags.clear();
  const sortSel = document.getElementById('mods-sort-select') as HTMLSelectElement;
  if (sortSel) sortSel.value = 'relevance';
  const verSel = document.getElementById('mods-version-select') as HTMLSelectElement;
  if (verSel) verSel.value = '';
  document.querySelectorAll('#mods-loader-chips .mods-chip, #mods-tag-chips .mods-chip').forEach(c => c.classList.remove('active'));
  refreshModsClearBtn();
  closeModsFiltersPopup();
  modsSearchWithFilters();
});

/* ===== STATS ===== */

function updateStats(): void {
  const statBuilds = document.getElementById('stat-builds');
  if (statBuilds) statBuilds.textContent = String(savedBuilds.length);
  const statServers = document.getElementById('stat-servers');
  if (statServers) statServers.textContent = String(savedServers.length);
  const statMods = document.getElementById('stat-mods');
  if (statMods) statMods.textContent = String(savedMods?.length || 0);
  const statSkins = document.getElementById('stat-skins');
  if (statSkins) statSkins.textContent = String(savedSkins.length);
  const statPlaytime = document.getElementById('stat-playtime');
  if (statPlaytime) {
    const total = savedBuilds.reduce((sum, b) => sum + (b.playtime || 0), 0);
    statPlaytime.textContent = formatPlaytime(total);
  }
}

/* ===== STATS MODAL ===== */

function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function openStatsModal(): void {
  renderStatsModal();
  openModal('modal-stats');
}

function renderStatsModal(): void {
  const totalEl = document.getElementById('stats-total');
  const favEl = document.getElementById('stats-favorite');
  const listEl = document.getElementById('stats-list');
  const played = savedBuilds
    .map(b => ({ build: b, time: b.playtime || 0 }))
    .filter(x => x.time > 0)
    .sort((a, b) => b.time - a.time);
  const total = played.reduce((sum, x) => sum + x.time, 0);
  const allTotal = savedBuilds.reduce((sum, b) => sum + (b.playtime || 0), 0);

  if (totalEl) {
    totalEl.innerHTML = `
      <div class="stats-total-info">
        <div class="stats-total-label">${t('stats.total')}</div>
        <div class="stats-total-hint">${t('stats.hint')}</div>
      </div>
      <div class="stats-total-value">${formatPlaytime(allTotal)}</div>`;
  }

  if (favEl) {
    if (played.length > 0) {
      const top = played[0];
      favEl.classList.remove('hidden');
      favEl.innerHTML = `
        <div class="stats-fav-badge">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0.5L10.1 5.3L15.3 5.9L11.6 9.4L12.6 14.5L8 11.9L3.4 14.5L4.4 9.4L0.7 5.9L5.9 5.3L8 0.5Z"/></svg>
          <span>${t('stats.favorite')}</span>
        </div>
        <div class="stats-fav-info">
          <div class="stats-fav-name">${escapeHtml(top.build.name)}</div>
          <div class="stats-fav-meta">${escapeHtml(top.build.gameVersion)} · ${escapeHtml(top.build.loader)}</div>
        </div>
        <div class="stats-fav-time">${formatPlaytime(top.time)}</div>`;
    } else {
      favEl.classList.add('hidden');
      favEl.innerHTML = '';
    }
  }

  if (listEl) {
    if (played.length === 0) {
      listEl.innerHTML = `<div class="stats-empty">${t('stats.noData')}</div>`;
      return;
    }
    let html = `<div class="stats-list-head"><span>${t('stats.build')}</span><span>${t('stats.time')}</span></div>`;
    for (const x of played) {
      const pct = total > 0 ? Math.round((x.time / total) * 100) : 0;
      html += `<div class="stats-item">
        <div class="stats-item-main">
          <div class="stats-item-name">${escapeHtml(x.build.name)}</div>
          <div class="stats-item-bar"><div class="stats-item-bar-fill" style="width:${pct}%"></div></div>
        </div>
        <div class="stats-item-time">${formatPlaytime(x.time)}<span class="stats-item-pct">${pct}%</span></div>
      </div>`;
    }
    listEl.innerHTML = html;
  }
}

document.getElementById('stat-card-playtime')?.addEventListener('click', openStatsModal);
document.getElementById('modal-stats-close')?.addEventListener('click', () => closeModal('modal-stats'));
document.getElementById('modal-stats')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeModal('modal-stats');
});

function updateSidebarCards(): void {
  const qlIcon = document.getElementById('quick-launch-icon');
  const qlName = document.getElementById('quick-launch-name');
  const qlVer = document.getElementById('quick-launch-version');
  if (savedBuilds.length > 0) {
    const lastId = localStorage.getItem('last-launch-id');
    const build = savedBuilds.find(b => b.id === lastId) || savedBuilds[0];
    if (qlName) qlName.textContent = build.name;
    if (qlVer) qlVer.textContent = `${build.gameVersion} · ${build.loader}`;
    if (qlIcon) {
      qlIcon.style.background = 'rgba(255, 255, 255, 0)';
      if (build.icon) {
        qlIcon.innerHTML = `<img src="${buildIconSrc(build.icon)}" style="width:100%;height:100%;object-fit:cover;border-radius:4px;">`;
      } else {
        qlIcon.innerHTML = `<svg width="32" height="32" viewBox="0 0 32 32" fill="none"><rect x="2" y="2" width="28" height="28" rx="4" fill="rgba(255,255,255,0.1)"/><path d="M12 10L22 16L12 22V10Z" fill="#2A2A2A"/></svg>`;
      }
    }
  } else {
    if (qlName) qlName.textContent = t('sidebar.noBuilds');
    if (qlVer) qlVer.textContent = '';
    if (qlIcon) {
      qlIcon.innerHTML = `<svg width="32" height="32" viewBox="0 0 32 32" fill="none"><rect x="2" y="2" width="28" height="28" rx="4" fill="#7BD4B7"/><path d="M12 10L22 16L12 22V10Z" fill="#2A2A2A"/></svg>`;
    }
  }

  const lsCard = document.getElementById('last-server');
  const lsName = document.getElementById('last-server-name');
  const lsVer = document.getElementById('last-server-version');
  const lsIcon = document.getElementById('last-server-icon');
  if (savedServers.length > 0) {
    const srv = savedServers[savedServers.length - 1];
    if (lsName) lsName.textContent = srv.name;
    if (lsVer) lsVer.textContent = srv.version || srv.ip;
    if (lsCard) lsCard.classList.remove('hidden-card');
    if (lsIcon) {
      lsIcon.innerHTML = `<div style="width:100%;height:100%;border-radius:4px;background:${stringToColor(srv.name)};display:flex;align-items:center;justify-content:center;overflow:hidden;"><span style="color:#1a1a1a;font-size:15px;font-weight:700;font-family:'Nekst',Arial,sans-serif">${escapeHtml(String(srv.name).charAt(0).toUpperCase())}</span></div>`;
    }
  } else {
    if (lsCard) lsCard.classList.add('hidden-card');
  }
}

function updateBanner(): void {
  const lastId = localStorage.getItem('last-launch-id');
  if (lastId) {
    const build = savedBuilds.find(b => b.id === lastId);
    if (build) {
      const title = document.getElementById('quick-banner-title');
      if (title) title.textContent = build.name;
      const meta = document.getElementById('quick-banner-meta');
      if (meta) meta.textContent = `${build.gameVersion} · ${build.loader}${build.loaderVersion ? ' · ' + build.loaderVersion : ''}`;
      updateStatus(t('home.continueGame'));
      return;
    }
  }
  if (savedBuilds.length > 0) {
    const build = savedBuilds[0];
    const title = document.getElementById('quick-banner-title');
    if (title) title.textContent = build.name;
    const meta = document.getElementById('quick-banner-meta');
    if (meta) meta.textContent = `${build.gameVersion} · ${build.loader}${build.loaderVersion ? ' · ' + build.loaderVersion : ''}`;
    updateStatus(t('sidebar.quickLaunch'));
  } else {
    const title = document.getElementById('quick-banner-title');
    if (title) title.textContent = t('sidebar.noBuilds');
    const meta = document.getElementById('quick-banner-meta');
    if (meta) meta.textContent = t('home.noBuildsHint');
    updateStatus(t('home.welcomeStatus'));
  }
}

/* ===== MODAL FUNCTIONS ===== */

/* ── Modal helpers ── */
const PRESENCE_MODALS: Record<string, string> = { 'modal-settings': 'settings', 'modal-about': 'about' };

function openModal(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('hidden', 'closing');
  if (PRESENCE_MODALS[id]) pushPresence(PRESENCE_MODALS[id]);
}
function closeModal(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('closing');
  setTimeout(() => {
    el.classList.add('hidden');
    el.classList.remove('closing');
  }, 120);
  if (PRESENCE_MODALS[id]) pushPresence(presenceTab);
}
function onOverlayClick(e: MouseEvent, id: string): void {
  if (e.target === e.currentTarget) closeModal(id);
}

/* ── Esc-to-close ── */

const ESC_CLOSEABLE_MODALS: { id: string; close: () => void }[] = [
  { id: 'modal-build', close: closeModalBuildModal },
  { id: 'modal-server', close: closeModalServerModal },
  { id: 'modal-account', close: () => closeModal('modal-account') },
  { id: 'modal-acc-req', close: () => closeModal('modal-acc-req') },
  { id: 'modal-about', close: () => closeModal('modal-about') },
  { id: 'modal-settings', close: () => closeModal('modal-settings') },
  { id: 'modal-stats', close: () => closeModal('modal-stats') },
  { id: 'modal-target-build', close: () => closeModal('modal-target-build') },
  { id: 'modal-versions', close: () => closeModal('modal-versions') },
  { id: 'modal-mod-details', close: () => closeModal('modal-mod-details') },
  { id: 'modal-news-details', close: () => closeModal('modal-news-details') },
  { id: 'modal-import', close: () => closeModal('modal-import') },
  { id: 'modal-deeplink', close: closeDeepLinkModal },
  { id: 'modal-share', close: closeShareModal },
  { id: 'modal-share-import', close: closeShareImportModal },
  { id: 'modal-srv-info', close: () => closeModal('modal-srv-info') },
  { id: 'modal-crash', close: () => closeModal('modal-crash') },
];

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (accountPopup.classList.contains('open')) {
    closeAccountPopup();
    return;
  }
  for (let i = ESC_CLOSEABLE_MODALS.length - 1; i >= 0; i--) {
    const entry = ESC_CLOSEABLE_MODALS[i];
    const el = document.getElementById(entry.id);
    if (el && !el.classList.contains('hidden') && !el.classList.contains('closing')) {
      try { entry.close(); } catch { closeModal(entry.id); }
      break;
    }
  }
});

/* ── Modal: Build ── */

function switchBeTab(tab: string): void {
  document.querySelectorAll('.be-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.be-panel').forEach(p => p.classList.remove('active'));
  const tabEl = document.querySelector(`.be-tab[data-be-tab="${tab}"]`);
  const panelEl = document.querySelector(`.be-panel[data-be-panel="${tab}"]`);
  if (tabEl) tabEl.classList.add('active');
  if (panelEl) panelEl.classList.add('active');
  if (tab === 'screenshots') loadBeScreenshots();
  if (tab === 'worlds') loadBeWorlds();
}

async function openModalBuild(build?: Build): Promise<void> {
  if (!build && !(await requireAccount())) return;
  const nameInput = document.getElementById('modal-build-name') as HTMLInputElement;
  const versionSelect = document.getElementById('modal-build-version') as HTMLSelectElement;
  const loaderSelect = document.getElementById('modal-build-loader') as HTMLSelectElement;
  const loaderVerInput = document.getElementById('modal-build-loader-ver') as HTMLInputElement;
  const title = document.getElementById('modal-build-title');
  const sub = document.getElementById('modal-build-sub');
  const submitBtn = document.getElementById('build-form-submit') as HTMLButtonElement;

  switchBeTab('general');
  pendingBuildIcon = build?.icon;
  const iconFileInput = document.getElementById('modal-build-icon-input') as HTMLInputElement | null;
  if (iconFileInput) iconFileInput.value = '';
  await ensureInstanceIconGrid();
  const preview = document.getElementById('modal-build-icon-preview');
  if (preview) (preview as HTMLElement).style.background = '';
  setBuildIconPreview(pendingBuildIcon);

  if (versionSelect && !versionsPopulated && api?.getVersions) {
    versionsPopulated = true;
    api.getVersions().then(versions => {
      if (!versions || !Array.isArray(versions)) return;
      const seen = new Set<string>();
      for (const v of versions) {
        const id = v.id;
        if (seen.has(id)) continue;
        seen.add(id);
        if (['old_alpha', 'old_beta'].includes(v.type)) continue;
        appendBuildVersionOption(id, id + (v.type === 'snapshot' ? t('be.snapshotSuffix') : ''));
      }
      if (build && build.gameVersion && build.gameVersion !== 'latest_release' && build.gameVersion !== 'latest_snapshot') {
        versionSelect.value = build.gameVersion;
      }
      syncBuildVersionUI();
    }).catch(() => {});
  }

  if (build) {
    editingBuildId = build.id;
    editingBuild = build;
    javaManualChoice = false;
    if (!build.mods) build.mods = [];
    if (!build.resourcePacks) build.resourcePacks = [];
    if (!build.shaders) build.shaders = [];
    if (!build.dataPacks) build.dataPacks = [];
    const openSection = document.getElementById('modal-build-open-section');
    if (openSection) openSection.style.display = '';
    if (title) title.textContent = t('be.manageTitle');
    if (sub) sub.textContent = t('be.manageSub');
    if (submitBtn) submitBtn.textContent = t('btn.save');
    if (nameInput) nameInput.value = build.name;
    if (versionSelect) versionSelect.value = build.gameVersion;
    if (loaderSelect) loaderSelect.value = build.loader;
    if (loaderVerInput) loaderVerInput.value = build.loaderVersion || '';
    syncBuildVersionUI();
    const loaderWrap = loaderSelect?.closest('.stngs-select-wrap');
    if (loaderWrap) syncSelectUI(loaderWrap as HTMLElement);

    // Restore file lists from build data + show loading state
    const loadingHtml = '<div class="be-file-empty" style="opacity:0.4">' + t('be.scanning') + '</div>';
    const listIds = ['be-mods-list', 'be-rp-list', 'be-shaders-list', 'be-dp-list'];
    listIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = loadingHtml;
    });
    // Scan and watch
    autoScanBuildInstance();
    startWatchingInstance();
  } else {
    editingBuildId = null;
    editingBuild = null;
    javaAutoApplied = false;
    lastAutoJavaPath = '';
    javaManualChoice = false;
    setJavaAutoHint('', '', false);
    const openSection = document.getElementById('modal-build-open-section');
    if (openSection) openSection.style.display = 'none';
    if (title) title.textContent = t('be.newTitle');
    if (sub) sub.textContent = t('be.newSub');
    if (submitBtn) submitBtn.textContent = t('btn.create');
    if (nameInput) nameInput.value = '';
    if (versionSelect) versionSelect.selectedIndex = 0;
    if (loaderSelect) loaderSelect.selectedIndex = 0;
    if (loaderVerInput) loaderVerInput.value = '';
    syncBuildVersionUI();
    const loaderWrap = loaderSelect?.closest('.stngs-select-wrap');
    if (loaderWrap) syncSelectUI(loaderWrap as HTMLElement);
    ['be-mods-list', 'be-rp-list', 'be-shaders-list', 'be-dp-list'].forEach(id => renderBeFileList(id, []));
  }

  const jvmInput = document.getElementById('modal-build-jvm') as HTMLInputElement;
  const mcInput = document.getElementById('modal-build-mcargs') as HTMLInputElement;
  const ramMinInput = document.getElementById('modal-build-ram-min') as HTMLInputElement;
  const ramMaxInput = document.getElementById('modal-build-ram-max') as HTMLInputElement;
  const winWInput = document.getElementById('modal-build-win-w') as HTMLInputElement;
  const winHInput = document.getElementById('modal-build-win-h') as HTMLInputElement;
  const fsCheck = document.getElementById('modal-build-fullscreen') as HTMLInputElement;
  const javaPath = document.getElementById('modal-build-java-path') as HTMLInputElement;
  if (build) {
    if (jvmInput) jvmInput.value = build.jvmArgs || '';
    if (mcInput) mcInput.value = build.mcArgs || '';
    if (ramMinInput) ramMinInput.value = build.memory?.min ? String(build.memory.min) : '';
    if (ramMaxInput) ramMaxInput.value = build.memory?.max ? String(build.memory.max) : '';
    if (winWInput) winWInput.value = build.window?.width ? String(build.window.width) : '';
    if (winHInput) winHInput.value = build.window?.height ? String(build.window.height) : '';
    if (fsCheck) fsCheck.checked = build.window?.fullscreen || false;
    if (javaPath) javaPath.value = build.javaPath || '';
  } else {
    if (jvmInput) jvmInput.value = '';
    if (mcInput) mcInput.value = '';
    if (ramMinInput) ramMinInput.value = '';
    if (ramMaxInput) ramMaxInput.value = '';
    if (winWInput) winWInput.value = '';
    if (winHInput) winHInput.value = '';
    if (fsCheck) fsCheck.checked = false;
    if (javaPath) javaPath.value = '';
  }

  openModal('modal-build');
  populateLoaderVersions(
    (document.getElementById('modal-build-loader') as HTMLSelectElement)?.value || 'vanilla',
    (document.getElementById('modal-build-version') as HTMLSelectElement)?.value || 'latest_release'
  );
  void populateJavaOptions().then(() => {
    const javaSelect = document.getElementById('modal-build-java') as HTMLSelectElement;
    const javaCustomRow = document.getElementById('be-java-custom-row');
    let val = '';
    const bp = (build?.javaPath || '').trim();
    if (bp) {
      val = detectedJava.some(j => j.path === bp) ? bp : '__custom';
      if (val === '__custom' && javaPath) javaPath.value = bp;
    }
    if (javaSelect) javaSelect.value = val;
    if (javaCustomRow) javaCustomRow.classList.toggle('hidden', val !== '__custom');
    const wrap = javaSelect?.closest('.stngs-select-wrap');
    if (wrap) syncSelectUI(wrap as HTMLElement);
    if (!build) void autoApplyCompatibleJava();
  });
}

function closeModalBuildModal(): void {
  stopWatchingInstance();
  closeModal('modal-build');
}

let instanceWatchCleanup: (() => void) | null = null;

function startWatchingInstance(): void {
  stopWatchingInstance();
  if (!editingBuildId || !api?.watchInstance) return;
  api.watchInstance(editingBuildId);
  if (api.onInstanceChanged) {
    instanceWatchCleanup = api.onInstanceChanged((buildId, data) => {
      if (buildId !== editingBuildId) return;
      applyScannedData(data);
    });
  }
}

function stopWatchingInstance(): void {
  if (instanceWatchCleanup) { instanceWatchCleanup(); instanceWatchCleanup = null; }
  if (editingBuildId && api?.unwatchInstance) api.unwatchInstance(editingBuildId);
}

function applyScannedData(data: any): void {
  if (!editingBuild) return;
  const panels: { key: string; listId: string }[] = [
    { key: 'mods', listId: 'be-mods-list' },
    { key: 'resourcepacks', listId: 'be-rp-list' },
    { key: 'shaders', listId: 'be-shaders-list' },
    { key: 'datapacks', listId: 'be-dp-list' },
  ];
  for (const { key, listId } of panels) {
    const scannedItems: BeFileItem[] = (data as any)[key] || [];
    const buildKey = listIdToBuildKey(listId);
    const arr = buildKey ? (editingBuild[buildKey] as BeFileItem[]) : null;
    if (!arr) continue;
    const existingByFile = new Map<string, BeFileItem>();
    for (const item of arr) {
      if (item.filename) existingByFile.set(item.filename.toLowerCase(), item);
    }
    for (const item of scannedItems) {
      const keyName = item.filename?.toLowerCase() || '';
      const existing = existingByFile.get(keyName);
      if (existing) {
        if (existing.name !== item.name || existing.version !== item.version || existing.description !== item.description || existing.projectId !== item.projectId || existing.iconUrl !== item.iconUrl) {
          existing.name = item.name;
          existing.version = item.version || existing.version;
          existing.description = item.description || existing.description;
          if (item.projectId) { existing.projectId = item.projectId; existing.iconUrl = item.iconUrl; }
        }
      } else {
        arr.push(item);
      }
    }
    renderBeFileList(listId, arr);
  }
}

function renderBeFileListsFromBuild(): void {
  if (!editingBuild) return;
  const panels: { key: string; listId: string }[] = [
    { key: 'mods', listId: 'be-mods-list' },
    { key: 'resourcepacks', listId: 'be-rp-list' },
    { key: 'shaders', listId: 'be-shaders-list' },
    { key: 'datapacks', listId: 'be-dp-list' },
  ];
  for (const { key, listId } of panels) {
    const buildKey = listIdToBuildKey(listId);
    const arr = buildKey ? (editingBuild[buildKey] as BeFileItem[] | null) : null;
    if (arr) renderBeFileList(listId, arr);
  }
}

async function autoScanBuildInstance(): Promise<void> {
  if (!editingBuildId || !api?.scanInstance) return;
  const scanId = editingBuildId;
  try {
    const result = await api.scanInstance(scanId);
    if (editingBuildId !== scanId) return;
    if (result) applyScannedData(result);
    else renderBeFileListsFromBuild();
  } catch {
    if (editingBuildId !== scanId) return;
    renderBeFileListsFromBuild();
  }
}

interface BeFileItem {
  name: string;
  enabled: boolean;
  filename?: string;
  version?: string;
  description?: string;
  projectId?: string;
  iconUrl?: string;
}

const LIST_ID_TO_BUILD_KEY: Record<string, keyof Build> = {
  'be-mods-list': 'mods',
  'be-rp-list': 'resourcePacks',
  'be-shaders-list': 'shaders',
  'be-dp-list': 'dataPacks',
};
function listIdToBuildKey(listId: string): keyof Build | undefined {
  return LIST_ID_TO_BUILD_KEY[listId];
}

function renderBeFileList(listId: string, items: BeFileItem[]): void {
  const list = document.getElementById(listId);
  if (!list) return;
  if (items.length === 0) {
    list.innerHTML = '<div class="be-file-empty">' + t('be.noItems') + '</div>';
    return;
  }
  list.innerHTML = items.map((item, i) => {
    const ext = item.filename ? item.filename.split('.').pop()?.toUpperCase() || 'FILE' : 'FILE';
    const versionHtml = item.version ? `<span class="be-file-version">${item.version}</span>` : '';
    const fileMeta = item.filename || '';
    const desc = item.description || '';
    const hasProject = !!item.projectId;
    const iconHtml = hasProject && item.iconUrl
      ? `<img class="be-file-modicon" src="${catalogImageUrl(item.iconUrl)}" alt="">`
      : `<div class="be-file-icon">${ext}</div>`;
    const detailsBtn = hasProject
      ? `<button class="be-file-details" data-project="${item.projectId}" title="${t('btn.details')}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
         </button>`
      : '';
    return `<div class="be-file-item" draggable="true" data-index="${i}"${item.projectId ? ` data-project="${item.projectId}"` : ''}${item.iconUrl ? ` data-icon="${item.iconUrl}"` : ''}>
      ${iconHtml}
      <div class="be-file-info">
        <div class="be-file-name">${item.name} ${versionHtml}</div>
        <div class="be-file-meta">${fileMeta}${desc ? ' — ' + desc : ''}</div>
      </div>
      <label class="be-file-toggle">
        <input type="checkbox"${item.enabled ? ' checked' : ''}>
        <span class="be-toggle-track"></span>
      </label>
      ${detailsBtn}
      <button class="be-file-del" data-index="${i}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>`;
  }).join('');

  // Drag & drop
  list.querySelectorAll('.be-file-item[draggable]').forEach(el => {
    el.addEventListener('dragstart', (e) => {
      el.classList.add('dragging');
      (e as DragEvent).dataTransfer?.setData('text/plain', String((el as HTMLElement).dataset.index));
    });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
    el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('drag-over'); });
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drag-over');
      const fromIdx = parseInt((e as DragEvent).dataTransfer?.getData('text/plain') || '', 10);
      const toIdx = parseInt((el as HTMLElement).dataset.index || '', 10);
      if (isNaN(fromIdx) || isNaN(toIdx) || fromIdx === toIdx) return;
      const buildKey = listIdToBuildKey(listId);
      const arr = buildKey && editingBuild ? (editingBuild[buildKey] as BeFileItem[]) : null;
      if (arr) {
        const [moved] = arr.splice(fromIdx, 1);
        arr.splice(toIdx, 0, moved);
        renderBeFileList(listId, arr);
      }
    });
  });

  // Toggle
  list.querySelectorAll('.be-file-toggle input').forEach((cb, i) => {
    cb.addEventListener('change', () => {
      const buildKey = listIdToBuildKey(listId);
      const arr = buildKey && editingBuild ? (editingBuild[buildKey] as BeFileItem[]) : null;
      if (arr && arr[i]) arr[i].enabled = (cb as HTMLInputElement).checked;
    });
  });

  // Delete
  list.querySelectorAll('.be-file-del').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt((btn as HTMLElement).dataset.index || '', 10);
      const buildKey = listIdToBuildKey(listId);
      const arr = buildKey && editingBuild ? (editingBuild[buildKey] as BeFileItem[]) : null;
      if (arr) {
        arr.splice(idx, 1);
        renderBeFileList(listId, arr);
      }
    });
  });

  // Details button
  list.querySelectorAll('.be-file-details').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const projectId = (btn as HTMLElement).getAttribute('data-project');
      if (projectId) openModalDetails(projectId);
    });
  });
}

let editingBuild: Build | null = null;

async function submitModalBuild(): Promise<void> {
  const nameInput = document.getElementById('modal-build-name') as HTMLInputElement;
  const versionSelect = document.getElementById('modal-build-version') as HTMLSelectElement;
  const loaderSelect = document.getElementById('modal-build-loader') as HTMLSelectElement;
  const loaderVerInput = document.getElementById('modal-build-loader-ver') as HTMLInputElement;
  if (!nameInput || !versionSelect || !loaderSelect || !loaderVerInput) return;
  const name = nameInput.value.trim();
  if (!name) return;
  if (loaderSelect.value !== 'vanilla' && !loaderVerInput.value.trim()) { updateStatus(t('status.enterLoaderVersion')); loaderVerInput.focus(); return; }

  // Выбор иконки: пресет из сетки, своя (data URL) или прежняя (modrinth/URL)
  const selectedIcon = document.querySelector('#modal-build .be-icon-opt.selected');
  let icon: string | undefined = pendingBuildIcon;
  if (selectedIcon) {
    const filename = (selectedIcon as HTMLElement).getAttribute('data-icon');
    if (filename) icon = `preset:${filename}`;
  } else if (editingBuildId && icon === undefined) {
    icon = editingBuild?.icon;
  }

  const jvmArgs = (document.getElementById('modal-build-jvm') as HTMLInputElement)?.value?.trim() || '';
  const mcArgs = (document.getElementById('modal-build-mcargs') as HTMLInputElement)?.value?.trim() || '';
  const ramMin = parseInt((document.getElementById('modal-build-ram-min') as HTMLInputElement)?.value) || 0;
  const ramMax = parseInt((document.getElementById('modal-build-ram-max') as HTMLInputElement)?.value) || 0;
  const winW = parseInt((document.getElementById('modal-build-win-w') as HTMLInputElement)?.value) || 0;
  const winH = parseInt((document.getElementById('modal-build-win-h') as HTMLInputElement)?.value) || 0;
  const fullscreen = (document.getElementById('modal-build-fullscreen') as HTMLInputElement)?.checked || false;
  const javaSelectVal = (document.getElementById('modal-build-java') as HTMLSelectElement)?.value || '';
  let javaPath = '';
  if (javaSelectVal === '__custom') {
    javaPath = (document.getElementById('modal-build-java-path') as HTMLInputElement)?.value?.trim() || '';
  } else if (javaSelectVal) {
    javaPath = javaSelectVal;
  }
  const memory: { min: number; max: number } | undefined = (ramMin || ramMax) ? { min: ramMin || 1024, max: ramMax || 2048 } : undefined;
  const window: { width: number; height: number; fullscreen: boolean } | undefined = (winW || winH) ? { width: winW || 854, height: winH || 480, fullscreen } : undefined;

  function collectFiles(key: string): BeFileItem[] {
    const items: BeFileItem[] = [];
    const list = document.getElementById(key);
    if (list) {
      list.querySelectorAll('.be-file-item').forEach(el => {
        const nameEl = el.querySelector('.be-file-name');
        const metaEl = el.querySelector('.be-file-meta');
        const cb = el.querySelector('.be-file-toggle input') as HTMLInputElement;
        if (nameEl) {
          const html = nameEl.innerHTML;
          const name = html.replace(/<span class="be-file-version">.*?<\/span>/, '').trim();
          items.push({
            name,
            enabled: cb?.checked ?? true,
            filename: metaEl?.textContent?.split(' — ')[0]?.trim() || undefined,
            projectId: (el as HTMLElement).getAttribute('data-project') || undefined,
            iconUrl: (el as HTMLElement).getAttribute('data-icon') || undefined,
          });
        }
      });
    }
    return items;
  }

  if (editingBuildId) {
    const existing = savedBuilds.find(b => b.id === editingBuildId);
    if (existing) {
      existing.name = name;
      existing.gameVersion = versionSelect.value;
      existing.loader = loaderSelect.value;
      existing.loaderVersion = loaderVerInput.value.trim();
      existing.icon = icon;
      existing.jvmArgs = jvmArgs;
      existing.mcArgs = mcArgs;
      existing.memory = memory;
      existing.window = window;
      existing.javaPath = javaPath;
      existing.mods = collectFiles('be-mods-list');
      existing.resourcePacks = collectFiles('be-rp-list');
      existing.shaders = collectFiles('be-shaders-list');
      existing.dataPacks = collectFiles('be-dp-list');
      if (api?.saveBuild) await api.saveBuild(existing);
    }
  } else {
    const build: Build = {
      id: name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '') + '-' + Date.now().toString(36),
      name,
      gameVersion: versionSelect.value,
      loader: loaderSelect.value,
      loaderVersion: loaderVerInput.value.trim(),
      iconBg: BUILD_COLORS[Math.floor(Math.random() * BUILD_COLORS.length)],
      icon,
      jvmArgs,
      mcArgs,
      memory,
      window,
      javaPath,
      mods: collectFiles('be-mods-list'),
      resourcePacks: collectFiles('be-rp-list'),
      shaders: collectFiles('be-shaders-list'),
      dataPacks: collectFiles('be-dp-list'),
    };
    if (api?.saveBuild) await api.saveBuild(build);
    else savedBuilds.push(build);
  }
  await loadBuilds();
  closeModalBuildModal();
}

/* ── Modal: Server ── */
function openModalServer(server?: Server): void {
  const nameInput = document.getElementById('modal-server-name') as HTMLInputElement;
  const ipInput = document.getElementById('modal-server-ip') as HTMLInputElement;
  const verInput = document.getElementById('modal-server-version') as HTMLInputElement;
  const title = document.getElementById('modal-server-title');
  const sub = document.getElementById('modal-server-sub');
  const submitBtn = document.getElementById('modal-server-submit') as HTMLButtonElement;

  if (server) {
    editingServerId = server.id;
    if (title) title.textContent = t('srv.editTitle');
    if (sub) sub.textContent = t('srv.editSub');
    if (submitBtn) submitBtn.textContent = t('btn.save');
    if (nameInput) nameInput.value = server.name;
    if (ipInput) ipInput.value = server.ip;
    if (verInput) verInput.value = server.version || '';
  } else {
    editingServerId = null;
    if (title) title.textContent = t('srv.newTitle');
    if (sub) sub.textContent = t('srv.newSub');
    if (submitBtn) submitBtn.textContent = t('btn.add');
    if (nameInput) nameInput.value = '';
    if (ipInput) ipInput.value = '';
    if (verInput) verInput.value = '';
  }
  openModal('modal-server');
}

function closeModalServerModal(): void {
  closeModal('modal-server');
}

async function submitModalServer(): Promise<void> {
  const nameInput = document.getElementById('modal-server-name') as HTMLInputElement;
  const ipInput = document.getElementById('modal-server-ip') as HTMLInputElement;
  const verInput = document.getElementById('modal-server-version') as HTMLInputElement;
  if (!nameInput || !ipInput) return;
  const name = nameInput.value.trim();
  const ip = ipInput.value.trim();
  if (!name || !ip) return;

  if (editingServerId) {
    const existing = savedServers.find(s => s.id === editingServerId);
    if (existing) {
      existing.name = name;
      existing.ip = ip;
      existing.version = verInput?.value?.trim() || '';
      if (api?.saveServer) await api.saveServer(existing);
    }
  } else {
    const server: Server = {
      id: 'srv-' + Date.now().toString(36),
      name, ip,
      version: verInput?.value?.trim() || '',
    };
    if (api?.saveServer) await api.saveServer(server);
    else savedServers.push(server);
  }
  await loadServers();
  closeModalServerModal();
}

/* ── Modal: Target Build Selector ── */
let pendingTargetProjectId: string = '';


/* ===== NEWS ===== */
// Адреса новостей строятся от общей базы API, а не от вшитого домена:
// иначе при отладке против локального сервера картинки и ссылки на посты
// продолжали бы вести на прод.
const NEWS_SITE_CLIENT = getApiBase();
const NEWS_SITE_ORIGIN = new URL(NEWS_SITE_CLIENT).origin;

let newsPosts: NewsPostSummary[] = [];
let newsLoading = false;
let newsError: string | null = null;
let newsLoaded = false;
let newsFetchLang: 'ru' | 'en' | null = null;
let newsFetchedAt = 0;
let newsLoadPromise: Promise<void> | null = null;
const NEWS_CACHE_MS = 5 * 60 * 1000;
let detailsNewsId = '';

function newsApiLang(): 'ru' | 'en' {
  return currentLang === 'en' ? 'en' : 'ru';
}

function resolveNewsAssetUrl(url: string | null | undefined): string {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('/')) return `${NEWS_SITE_ORIGIN}${url}`;
  return `${NEWS_SITE_CLIENT}/${url.replace(/^\//, '')}`;
}

function formatNewsDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const locale = currentLang === 'en' ? 'en-US'
    : currentLang === 'kk' ? 'kk-KZ'
    : currentLang === 'tt' ? 'tt-RU'
    : currentLang === 'uk' ? 'uk-UA'
    : 'ru-RU';
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
}

function newsCoverHtml(
  cover: string | null,
  title: string,
  emptyClass = 'news-card-cover--empty',
  lazy = true,
): string {
  const url = resolveNewsAssetUrl(cover);
  if (!url) return `<div class="news-card-cover ${emptyClass}" aria-hidden="true"></div>`;
  const loading = lazy ? ' loading="lazy"' : ' fetchpriority="high"';
  return `<div class="news-card-cover"><img src="${escapeHtml(url)}" alt="${escapeHtml(title)}"${loading}></div>`;
}

function renderNewsArticleCard(post: NewsPostSummary, lazy = true): string {
  return `
    <article class="news-card" data-news-id="${escapeHtml(post.id)}" tabindex="0">
      ${newsCoverHtml(post.cover, post.title, 'news-card-cover--empty', lazy)}
      <div class="news-card-body">
        <div class="news-card-title">${escapeHtml(post.title)}</div>
        ${post.summary ? `<div class="news-card-summary">${escapeHtml(post.summary)}</div>` : ''}
        <div class="news-card-meta">${escapeHtml(formatNewsDate(post.publishedAt))}</div>
      </div>
    </article>`;
}

function renderNewsFeatured(post: NewsPostSummary): string {
  const coverUrl = resolveNewsAssetUrl(post.cover);
  const mediaHtml = coverUrl
    ? `<img src="${escapeHtml(coverUrl)}" alt="${escapeHtml(post.title)}" fetchpriority="high">`
    : '<div class="news-featured-placeholder" aria-hidden="true"></div>';

  return `
    <section class="news-featured-band" aria-label="${escapeHtml(t('news.featuredLabel'))}">
      <article class="news-featured" data-news-id="${escapeHtml(post.id)}" tabindex="0">
        <div class="news-featured-media">${mediaHtml}</div>
        <div class="news-featured-body">
          <p class="news-featured-label">${escapeHtml(t('news.featuredLabel'))}</p>
          <h2 class="news-featured-title">${escapeHtml(post.title)}</h2>
          ${post.summary ? `<p class="news-featured-summary">${escapeHtml(post.summary)}</p>` : ''}
          <div class="news-card-meta">${escapeHtml(formatNewsDate(post.publishedAt))}</div>
        </div>
      </article>
    </section>`;
}

function bindNewsOpenHandlers(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('[data-news-id]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = el.getAttribute('data-news-id');
      if (id) void openModalNews(id);
    });
  });
}

async function loadNews(force = false): Promise<void> {
  if (newsLoadPromise) await newsLoadPromise;

  const lang = newsApiLang();
  const cacheFresh = newsLoaded && !force
    && newsFetchLang === lang
    && (Date.now() - newsFetchedAt) < NEWS_CACHE_MS;

  if (cacheFresh) {
    renderNews();
    renderHomeNews();
    return;
  }

  if (newsLoadPromise) {
    await newsLoadPromise;
    renderNews();
    renderHomeNews();
    return;
  }

  newsLoadPromise = (async () => {
    newsLoading = true;
    newsError = null;
    renderNews();
    renderHomeNews();

    try {
      const result = await api?.fetchNewsList?.(lang, 50);
      if (!result || result.error) {
        if (!newsPosts.length) {
          newsError = result?.error || 'network';
          newsPosts = [];
        }
      } else {
        newsPosts = Array.isArray(result.posts) ? result.posts : [];
        newsLoaded = true;
        newsError = null;
        newsFetchLang = lang;
        newsFetchedAt = Date.now();
      }
    } catch {
      if (!newsPosts.length) {
        newsError = 'network';
        newsPosts = [];
      }
    } finally {
      newsLoading = false;
      newsLoadPromise = null;
    }
  })();

  await newsLoadPromise;
  renderNews();
  renderHomeNews();
}

function renderNews(): void {
  if (presenceTab !== 'news') return;

  const root = document.getElementById('news-page');
  if (!root) return;

  if (newsLoading && !newsLoaded) {
    root.innerHTML = `<div class="news-state-msg">${escapeHtml(t('news.loading'))}</div>`;
    return;
  }

  if (newsError) {
    root.innerHTML = `<div class="news-state-msg error">${escapeHtml(t('news.error'))} <button class="mods-retry-btn" id="news-retry-btn">${escapeHtml(t('btn.retry'))}</button></div>`;
    document.getElementById('news-retry-btn')?.addEventListener('click', () => void loadNews(true));
    return;
  }

  if (!newsPosts.length) {
    root.innerHTML = `<div class="news-state-msg">${escapeHtml(t('news.empty'))}</div>`;
    return;
  }

  const [featured, ...rest] = newsPosts;
  const moreHtml = rest.length
    ? `<section class="news-more">
        <h2 class="news-more-title">${escapeHtml(t('news.moreArticles'))}</h2>
        <div class="news-cards-grid">
          ${rest.map(post => renderNewsArticleCard(post)).join('')}
        </div>
      </section>`
    : '';

  root.innerHTML = renderNewsFeatured(featured) + moreHtml;
  bindNewsOpenHandlers(root);
}

function renderHomeNews(): void {
  const block = document.getElementById('home-news-attribution');
  const coverEl = document.getElementById('home-news-cover');
  const titleEl = document.getElementById('home-news-title');
  const summaryEl = document.getElementById('home-news-summary');
  const openBtn = document.getElementById('home-news-open-btn');
  if (!block || !coverEl || !titleEl || !summaryEl || !openBtn) return;

  const hide = (): void => block.classList.add('hidden');

  if (newsLoading && !newsLoaded) {
    hide();
    return;
  }

  if (newsError || !newsPosts.length) {
    hide();
    return;
  }

  const post = newsPosts[0];
  const coverUrl = resolveNewsAssetUrl(post.cover);
  coverEl.innerHTML = coverUrl
    ? `<img src="${escapeHtml(coverUrl)}" alt="" loading="lazy">`
    : '';

  titleEl.textContent = post.title;

  if (post.summary) {
    summaryEl.textContent = post.summary;
    summaryEl.classList.remove('hidden');
  } else {
    summaryEl.textContent = '';
    summaryEl.classList.add('hidden');
  }

  openBtn.onclick = (e) => {
    e.stopPropagation();
    void openModalNews(post.id);
  };

  block.classList.remove('hidden');
}

function bindNewsContentLinks(container: HTMLElement): void {
  container.querySelectorAll('a[href]').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const href = (a as HTMLAnchorElement).href;
      if (href) void api?.openExternal(href);
    });
  });
  container.querySelectorAll('img').forEach(img => {
    img.addEventListener('click', () => {
      if (img.src) void api?.openExternal(img.src);
    });
  });
}

async function openModalNews(postId: string): Promise<void> {
  detailsNewsId = postId;
  const coverWrap = document.getElementById('modal-news-cover-large-wrap');
  const coverLarge = document.getElementById('modal-news-cover-large') as HTMLImageElement | null;
  const title = document.getElementById('modal-news-title');
  const sub = document.getElementById('modal-news-sub');
  const author = document.getElementById('modal-news-date');
  const authorMeta = document.getElementById('modal-news-author');
  const desc = document.getElementById('modal-news-description');
  const openBtn = document.getElementById('modal-news-open-url');

  if (!desc) return;
  if (title) title.textContent = '—';
  if (sub) sub.textContent = t('news.postedOn');
  if (author) author.textContent = '—';
  if (authorMeta) authorMeta.textContent = '—';
  // Сбрасываем обложку до загрузки поста
  if (coverWrap) coverWrap.classList.add('hidden');
  if (coverLarge) coverLarge.removeAttribute('src');
  desc.innerHTML = `<div style="padding:16px;text-align:center;color:rgba(255,255,255,0.3);">${escapeHtml(t('common.loading'))}</div>`;
  openModal('modal-news-details');

  const result = await api?.fetchNewsPost?.(postId, newsApiLang());
  const post = result?.post;
  if (!post) {
    desc.innerHTML = `<div style="padding:16px;text-align:center;color:rgba(255,255,255,0.3);">${escapeHtml(t('news.notFound'))}</div>`;
    return;
  }

  const coverUrl = resolveNewsAssetUrl(post.cover);
  if (title) title.textContent = post.title || '—';
  if (sub) sub.textContent = post.summary || t('news.postedOn');
  if (authorMeta) authorMeta.textContent = post.author || 'Undefined Client';
  if (author) author.textContent = formatNewsDate(post.publishedAt);

  // Обложка в теле модалки — только если есть URL, без обрезки пропорций
  if (coverUrl && coverLarge && coverWrap) {
    coverLarge.src = coverUrl;
    coverLarge.alt = post.title || '';
    coverWrap.classList.remove('hidden');
  }

  const bodyHtml = post.contentHtml || markedParse(post.content || '');
  desc.innerHTML = sanitizeHtml(bodyHtml);
  bindNewsContentLinks(desc);

  if (openBtn) {
    openBtn.onclick = () => void api?.openExternal(`${NEWS_SITE_CLIENT}/news/${encodeURIComponent(post.id)}`);
  }
}

document.getElementById('news-refresh-btn')?.addEventListener('click', () => void loadNews(true));


/* ── Modal: Mod Details ── */
let detailsProjectId: string = '';

async function openModalDetails(projectId: string): Promise<void> {
  detailsProjectId = projectId;
  const icon = document.getElementById('modal-mod-icon') as HTMLImageElement;
  const title = document.getElementById('modal-mod-title');
  const typeEl = document.getElementById('modal-mod-type');
  const downloads = document.getElementById('modal-mod-downloads');
  const updated = document.getElementById('modal-mod-updated');
  const author = document.getElementById('modal-mod-author');
  const tags = document.getElementById('modal-mod-tags');
  const desc = document.getElementById('modal-mod-description');
  const urlBtn = document.getElementById('modal-mod-open-url');
  const dlBtn = document.getElementById('modal-mod-download-btn');
  if (!desc) return;
  desc.innerHTML = '<div style="padding:16px;text-align:center;color:rgba(255,255,255,0.3);">' + t('common.loading') + '</div>';
  openModal('modal-mod-details');

  const project = await api?.getModrinthProject(projectId);
  if (!project) {
    desc.innerHTML = '<div style="padding:16px;text-align:center;color:rgba(255,255,255,0.3);">' + t('mods.detailsFailed') + '</div>';
    return;
  }

  if (icon && project.icon_url) icon.src = catalogImageUrl(project.icon_url);
  if (title) title.textContent = project.title || '—';
  if (typeEl) typeEl.textContent = (project.project_type || 'unknown').replace(/_/g, ' ').toUpperCase();
  if (downloads) downloads.textContent = t('mods.downloadsCount', { n: (project.downloads || 0).toLocaleString() });
  if (updated) {
    const d = project.updated ? new Date(project.updated) : null;
    updated.textContent = d ? t('mods.updated', { date: d.toLocaleDateString() }) : '—';
  }
  if (author) {
    const authorName = project.author || project.team || '—';
    const authorUrl = `https://modrinth.com/user/${authorName}`;
    author.innerHTML = `<a href="${authorUrl}" target="_blank">${authorName}</a>`;
  }
  if (tags) {
    const categories: string[] = project.categories || project.client_side ? [project.client_side] : [];
    tags.innerHTML = categories.map((c: string) => `<span class="mod-details-tag">${c}</span>`).join('');
  }

  if (urlBtn) {
    const projUrl = `https://modrinth.com/${project.project_type || 'mod'}/${project.slug || project.id}`;
    urlBtn.onclick = () => api?.openExternal(projUrl);
  }
  if (dlBtn) {
    dlBtn.onclick = () => {
      closeModal('modal-mod-details');
      openModalVersionsForDownload(project.slug || project.id);
    };
  }

  const bodyMd = project.body || '';
  const bodyHtml = markedParse(bodyMd);
  desc.innerHTML = sanitizeHtml(bodyHtml);
  // Open external links in system browser
  desc.querySelectorAll('a[href]').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const href = (a as HTMLAnchorElement).href;
      if (href) api?.openExternal(href);
    });
  });
}

function markedParse(md: string): string {
  try {
    return marked.parse(md, { async: false }) as string;
  } catch {
    return md;
  }
}

function sanitizeHtml(html: string): string {
  const allowedTags = ['p','br','b','i','u','strong','em','h1','h2','h3','h4','h5','h6','ul','ol','li','a','img','pre','code','blockquote','hr','table','thead','tbody','tr','th','td','span','div'];
  const allowedAttrs = ['href','src','alt','title','target','width','height','class'];
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, (tag) => {
      const tagName = tag.match(/<\/?(\w+)/)?.[1]?.toLowerCase();
      if (!tagName || !allowedTags.includes(tagName)) return '';
      if (tag.startsWith('</')) return `</${tagName}>`;
      const attrs = tag.match(/(\w+)\s*=\s*"([^"]*)"/g) || [];
      const safe = attrs.filter((a: string) => allowedAttrs.includes(a.split('=')[0])).join(' ');
      return `<${tagName}${safe ? ' ' + safe : ''}>`;
    });
}

document.getElementById('modal-mod-versions')?.addEventListener('click', () => {
  if (detailsProjectId) openModalVersionsForDownload(detailsProjectId);
});

/* ── Modal: Import ── */
function openModalImport(): void {
  const info = document.getElementById('import-info');
  const infoText = document.getElementById('import-info-text');
  const confirmBtn = document.getElementById('modal-import-confirm') as HTMLButtonElement;
  const fileInput = document.getElementById('import-file-input') as HTMLInputElement;
  if (info) info.classList.add('hidden');
  if (confirmBtn) confirmBtn.disabled = true;
  if (fileInput) fileInput.value = '';
  openModal('modal-import');
}

document.getElementById('import-dropzone')?.addEventListener('click', () => {
  document.getElementById('import-file-input')?.click();
});

document.getElementById('import-file-input')?.addEventListener('change', function () {
  const file = (this as HTMLInputElement).files?.[0];
  const info = document.getElementById('import-info');
  const infoText = document.getElementById('import-info-text');
  const confirmBtn = document.getElementById('modal-import-confirm') as HTMLButtonElement;
  if (file) {
    if (info) info.classList.remove('hidden');
    if (infoText) infoText.textContent = t('import.selected', { name: file.name });
    if (confirmBtn) confirmBtn.disabled = false;
  }
});

document.getElementById('modal-import-confirm')?.addEventListener('click', async () => {
  const fileInput = document.getElementById('import-file-input') as HTMLInputElement;
  const file = fileInput?.files?.[0];
  if (!file) return;
  updateStatus(t('status.importing'));
  closeModal('modal-import');
  // For now, read .mrpack as modpack download (simplified)
  if (file.name.endsWith('.mrpack')) {
    updateStatus(t('status.mrpackNotImplemented'));
  } else if (file.name.endsWith('.zip')) {
    updateStatus(t('status.cfNotImplemented'));
  } else {
    updateStatus(t('status.unsupportedFormat'));
  }
});

/* ── Screenshots & Worlds (build editor) ── */

let beScreenshots: any[] = [];
let beWorlds: any[] = [];
let beSelScreenshots = new Set<string>();
let beSelWorlds = new Set<string>();

const BE_MEDIA_CHECK_SVG = '<span class="be-media-check"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 6.5 5 9l4.5-6" stroke="#0d1421" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';

function formatBeSize(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(2) + t('common.mb');
}

function worldGameTypeName(world: any): string {
  if (world.hardcore) return t('be.worldHardcore');
  switch (world.gameType) {
    case 0: return t('be.worldSurvival');
    case 1: return t('be.worldCreative');
    case 2: return t('be.worldAdventure');
    default: return t('be.worldSpectator');
  }
}

function renderBeScreenshots(): void {
  const grid = document.getElementById('be-screenshots-grid');
  const countEl = document.getElementById('be-screenshots-count');
  if (!grid) return;
  if (!editingBuildId) {
    grid.innerHTML = '<div class="be-file-empty">' + t('be.newBuildHint') + '</div>';
    if (countEl) countEl.textContent = '';
    return;
  }
  if (beScreenshots.length === 0) {
    grid.innerHTML = '<div class="be-file-empty">' + t('be.screenshotsEmpty') + '</div>';
    if (countEl) countEl.textContent = '';
    return;
  }
  grid.innerHTML = beScreenshots.map(s => `
    <div class="be-media-card${beSelScreenshots.has(s.name) ? ' selected' : ''}" data-name="${s.name}">
      ${s.thumb ? `<img class="be-media-thumb" src="${s.thumb}" loading="lazy">` : '<div class="be-media-thumb"></div>'}
      <div class="be-media-text">
        <div class="be-media-name">${s.name}</div>
        <div class="be-media-info">${formatBeSize(s.size)}</div>
      </div>
      ${BE_MEDIA_CHECK_SVG}
    </div>
  `).join('');
  if (countEl) countEl.textContent = beSelScreenshots.size > 0 ? t('be.selectedCount').replace('{n}', String(beSelScreenshots.size)) : '';
  grid.querySelectorAll<HTMLElement>('.be-media-card').forEach(card => {
    card.addEventListener('click', () => {
      const name = card.getAttribute('data-name');
      if (!name) return;
      if (beSelScreenshots.has(name)) beSelScreenshots.delete(name);
      else beSelScreenshots.add(name);
      renderBeScreenshots();
    });
  });
}

function renderBeWorlds(): void {
  const grid = document.getElementById('be-worlds-grid');
  const countEl = document.getElementById('be-worlds-count');
  if (!grid) return;
  if (!editingBuildId) {
    grid.innerHTML = '<div class="be-file-empty">' + t('be.newBuildHint') + '</div>';
    if (countEl) countEl.textContent = '';
    return;
  }
  if (beWorlds.length === 0) {
    grid.innerHTML = '<div class="be-file-empty">' + t('be.worldsEmpty') + '</div>';
    if (countEl) countEl.textContent = '';
    return;
  }
  grid.innerHTML = beWorlds.map(w => {
    const info: string[] = [worldGameTypeName(w)];
    const dateLocale = currentLang === 'kk' ? 'kk-KZ' : currentLang === 'tt' ? 'tt-RU' : currentLang === 'en' ? 'en-US' : 'ru-RU';
    if (w.version) info.push(t('be.worldVersion').replace('{v}', w.version));
    if (w.lastPlayed > 0) info.push(t('be.worldLastPlayed').replace('{d}', new Date(w.lastPlayed).toLocaleString(dateLocale)));
    info.push(t('be.worldSize').replace('{s}', (w.size / (1024 * 1024)).toFixed(1)));
    return `
    <div class="be-media-card${beSelWorlds.has(w.folder) ? ' selected' : ''}" data-name="${w.folder}">
      ${w.icon ? `<img class="be-media-thumb world" src="${w.icon}" loading="lazy">` : '<div class="be-media-thumb world"></div>'}
      <div class="be-media-text">
        <div class="be-media-name">${w.name}</div>
        <div class="be-media-info">${info.join(' • ')}</div>
      </div>
      ${BE_MEDIA_CHECK_SVG}
    </div>
  `;
  }).join('');
  if (countEl) countEl.textContent = beSelWorlds.size > 0 ? t('be.selectedCount').replace('{n}', String(beSelWorlds.size)) : '';
  grid.querySelectorAll<HTMLElement>('.be-media-card').forEach(card => {
    card.addEventListener('click', () => {
      const name = card.getAttribute('data-name');
      if (!name) return;
      if (beSelWorlds.has(name)) beSelWorlds.delete(name);
      else beSelWorlds.add(name);
      renderBeWorlds();
    });
  });
}

async function loadBeScreenshots(): Promise<void> {
  const grid = document.getElementById('be-screenshots-grid');
  if (!grid) return;
  if (!editingBuildId || !api?.listScreenshots) {
    beScreenshots = [];
    beSelScreenshots.clear();
    renderBeScreenshots();
    return;
  }
  grid.innerHTML = '<div class="be-file-empty" style="opacity:0.4">' + t('common.loading') + '</div>';
  try {
    beScreenshots = await api.listScreenshots(editingBuildId);
  } catch {
    beScreenshots = [];
  }
  const names = new Set(beScreenshots.map(s => s.name));
  beSelScreenshots = new Set([...beSelScreenshots].filter(n => names.has(n)));
  renderBeScreenshots();
}

async function loadBeWorlds(): Promise<void> {
  const grid = document.getElementById('be-worlds-grid');
  if (!grid) return;
  if (!editingBuildId || !api?.listWorlds) {
    beWorlds = [];
    beSelWorlds.clear();
    renderBeWorlds();
    return;
  }
  grid.innerHTML = '<div class="be-file-empty" style="opacity:0.4">' + t('common.loading') + '</div>';
  try {
    beWorlds = await api.listWorlds(editingBuildId);
  } catch {
    beWorlds = [];
  }
  const names = new Set(beWorlds.map(w => w.folder));
  beSelWorlds = new Set([...beSelWorlds].filter(n => names.has(n)));
  renderBeWorlds();
}

async function beMediaDelete(sub: 'screenshots' | 'saves', sel: Set<string>): Promise<void> {
  if (sel.size === 0 || !editingBuildId || !api?.deleteInstanceFiles) return;
  if (!await confirmAction(t('be.confirmDeleteFiles'))) return;
  const res = await api.deleteInstanceFiles(editingBuildId, sub, [...sel]);
  if (res?.success) {
    updateStatus(t('be.deletedOk').replace('{n}', String(res.deleted ?? 0)));
    sel.clear();
    if (sub === 'screenshots') await loadBeScreenshots();
    else await loadBeWorlds();
  }
}

async function beMediaSave(sub: 'screenshots' | 'saves', sel: Set<string>): Promise<void> {
  if (sel.size === 0 || !editingBuildId || !api?.saveInstanceFiles) return;
  const res = await api.saveInstanceFiles(editingBuildId, sub, [...sel]);
  if (res?.success && !res.canceled) {
    updateStatus(t('be.savedOk').replace('{n}', String(res.saved ?? 0)));
  }
}

document.getElementById('be-screenshots-refresh')?.addEventListener('click', () => loadBeScreenshots());
document.getElementById('be-worlds-refresh')?.addEventListener('click', () => loadBeWorlds());
document.getElementById('be-screenshots-delete')?.addEventListener('click', () => beMediaDelete('screenshots', beSelScreenshots));
document.getElementById('be-worlds-delete')?.addEventListener('click', () => beMediaDelete('saves', beSelWorlds));
document.getElementById('be-screenshots-save')?.addEventListener('click', () => beMediaSave('screenshots', beSelScreenshots));
document.getElementById('be-worlds-save')?.addEventListener('click', () => beMediaSave('saves', beSelWorlds));

/* ── Wire modal UI events ── */
// Build editor tab switching
document.querySelectorAll('.be-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const target = (tab as HTMLElement).getAttribute('data-be-tab');
    if (target) switchBeTab(target);
  });
});

// Build modal
document.getElementById('modal-build-close')?.addEventListener('click', () => closeModalBuildModal());
document.getElementById('build-form-cancel')?.addEventListener('click', () => closeModalBuildModal());
document.getElementById('build-form-submit')?.addEventListener('click', () => submitModalBuild());
document.getElementById('modal-build-open-folder')?.addEventListener('click', async () => {
  if (!editingBuildId) return;
  if (api?.getInstancePath && api?.openPath) {
    const instanceDir = await api.getInstancePath(editingBuildId);
    if (instanceDir) await api.openPath(instanceDir);
  }
  closeModalBuildModal();
});
document.getElementById('modal-build')?.addEventListener('click', (e) => { if (e.target === e.currentTarget) closeModalBuildModal(); });

// Build add file buttons
document.querySelectorAll('.be-add-btn:not(.be-scan-btn):not(.be-media-btn)').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.jar,.zip,.litemod,.disabled,.mcpack,.mcaddon';
    input.multiple = true;
    input.onchange = () => {
      const files = input.files;
      if (!files) return;
      const listId = (btn as HTMLElement).closest('.be-panel')?.querySelector('.be-file-list')?.id;
      if (!listId) return;
      const buildKey = listIdToBuildKey(listId);
      const arr = buildKey && editingBuild ? (editingBuild[buildKey] as BeFileItem[]) : null;
      if (!arr) return;
      for (const file of Array.from(files)) {
        arr.push({ name: file.name.replace(/\.[^.]+$/, ''), enabled: true, filename: file.name });
      }
      renderBeFileList(listId, arr);
    };
    input.click();
  });
});

// Build scan buttons
document.querySelectorAll('.be-scan-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    if (!editingBuildId || !api?.scanInstance) return;
    const scanId = editingBuildId;
    try {
      const result = await api.scanInstance(scanId);
      if (editingBuildId !== scanId) return;
      if (result) applyScannedData(result);
      else renderBeFileListsFromBuild();
    } catch (e) {
      console.error('Scan failed:', e);
      if (editingBuildId === scanId) renderBeFileListsFromBuild();
    }
  });
});

// Icon picker: сетка заполняется из assets/InstancesIcons (ensureInstanceIconGrid)
void ensureInstanceIconGrid();
document.getElementById('modal-build-icon-input')?.addEventListener('change', function () {
  const file = (this as HTMLInputElement).files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = typeof reader.result === 'string' ? reader.result : '';
    if (!dataUrl) return;
    pendingBuildIcon = dataUrl;
    document.querySelectorAll('#modal-build .be-icon-opt.selected').forEach((e) => e.classList.remove('selected'));
    setBuildIconPreview(dataUrl);
  };
  reader.readAsDataURL(file);
});

// Update loader versions datalist for modal
document.getElementById('modal-build-loader')?.addEventListener('change', () => {
  const loaderSelect = document.getElementById('modal-build-loader') as HTMLSelectElement;
  const versionSelect = document.getElementById('modal-build-version') as HTMLSelectElement;
  populateLoaderVersions(loaderSelect.value, versionSelect?.value || 'latest_release');
});
document.getElementById('modal-build-version')?.addEventListener('change', () => {
  const loaderSelect = document.getElementById('modal-build-loader') as HTMLSelectElement;
  if (loaderSelect.value !== 'vanilla') {
    const versionSelect = document.getElementById('modal-build-version') as HTMLSelectElement;
    populateLoaderVersions(loaderSelect.value, versionSelect?.value || 'latest_release');
  }
  if (!editingBuildId) void autoApplyCompatibleJava();
});

// Server modal
document.getElementById('modal-server-close')?.addEventListener('click', () => closeModalServerModal());
document.getElementById('modal-server-cancel')?.addEventListener('click', () => closeModalServerModal());
document.getElementById('modal-server-submit')?.addEventListener('click', () => submitModalServer());
document.getElementById('modal-server')?.addEventListener('click', (e) => { if (e.target === e.currentTarget) closeModalServerModal(); });

// Target build modal
document.getElementById('modal-target-close')?.addEventListener('click', () => closeModal('modal-target-build'));
document.getElementById('modal-target-cancel')?.addEventListener('click', () => closeModal('modal-target-build'));
document.getElementById('modal-target-build')?.addEventListener('click', (e) => { if (e.target === e.currentTarget) closeModal('modal-target-build'); });

// Server launch build picker
let pendingServerBuild: { ip: string; port: number; name?: string } | null = null;
let pendingServerAddr = '';

function openServerLaunchPicker(ip: string, port: number, name?: string): void {
  const [host] = ip.split(':');
  const usePort = parseInt(String(port), 10) > 0 ? parseInt(String(port), 10) : 25565;
  pendingServerBuild = { ip: host, port: usePort, name: name || undefined };
  const list = document.getElementById('server-build-list');
  if (!list) return;
  if (savedBuilds.length === 0) {
    list.innerHTML = '<div style="padding:16px;text-align:center;color:rgba(255,255,255,0.3);">' + t('servers.noBuildsForLaunch') + '</div>';
  } else {
    list.innerHTML = savedBuilds.map(b => {
      const iconSrc = b.icon ? buildIconSrc(b.icon) : '';
      return `<div class="build-option-item" data-build-id="${srvEsc(b.id)}">
        <div class="build-option-icon" style="background:rgba(255,255,255,0.1)">${iconSrc ? `<img src="${iconSrc}">` : ''}</div>
        <div class="build-option-info">
          <div class="build-option-name">${srvEsc(b.name)}</div>
          <div class="build-option-meta">${srvEsc(b.gameVersion)} · ${srvEsc(b.loader)}</div>
        </div>
      </div>`;
    }).join('');
    list.querySelectorAll('.build-option-item').forEach(el => {
      el.addEventListener('click', () => {
        list.querySelectorAll('.build-option-item.selected').forEach(e => e.classList.remove('selected'));
        el.classList.add('selected');
        const confirmBtn = document.getElementById('server-build-confirm') as HTMLButtonElement;
        if (confirmBtn) confirmBtn.disabled = false;
      });
    });
  }
  const confirmBtn = document.getElementById('server-build-confirm') as HTMLButtonElement;
  if (confirmBtn) confirmBtn.disabled = true;
  openModal('modal-server-build');
}
document.getElementById('server-build-close')?.addEventListener('click', () => closeModal('modal-server-build'));
document.getElementById('server-build-cancel')?.addEventListener('click', () => closeModal('modal-server-build'));
document.getElementById('modal-server-build')?.addEventListener('click', (e) => { if (e.target === e.currentTarget) closeModal('modal-server-build'); });
document.getElementById('server-build-confirm')?.addEventListener('click', () => {
  const selected = document.querySelector('#server-build-list .build-option-item.selected');
  if (!selected || !pendingServerBuild) return;
  const buildId = selected.getAttribute('data-build-id');
  if (!buildId) return;
  const build = savedBuilds.find(b => b.id === buildId);
  if (!build) return;
  closeModal('modal-server-build');
  void launchBuild(build, { ip: pendingServerBuild.ip, port: pendingServerBuild.port, name: pendingServerBuild.name });
});

// Version picker
document.getElementById('modal-versions-close')?.addEventListener('click', () => closeModal('modal-versions'));
document.getElementById('modal-versions-cancel')?.addEventListener('click', () => closeModal('modal-versions'));
document.getElementById('modal-versions')?.addEventListener('click', (e) => { if (e.target === e.currentTarget) closeModal('modal-versions'); });


// News details
document.getElementById('modal-news-close')?.addEventListener('click', () => closeModal('modal-news-details'));
document.getElementById('modal-news-close2')?.addEventListener('click', () => closeModal('modal-news-details'));
document.getElementById('modal-news-details')?.addEventListener('click', (e) => { if (e.target === e.currentTarget) closeModal('modal-news-details'); });

// Mod details
document.getElementById('modal-mod-close')?.addEventListener('click', () => closeModal('modal-mod-details'));
document.getElementById('modal-mod-close2')?.addEventListener('click', () => closeModal('modal-mod-details'));
document.getElementById('modal-mod-details')?.addEventListener('click', (e) => { if (e.target === e.currentTarget) closeModal('modal-mod-details'); });

// Import
document.getElementById('modal-import-close')?.addEventListener('click', () => closeModal('modal-import'));
document.getElementById('modal-import-cancel')?.addEventListener('click', () => closeModal('modal-import'));
document.getElementById('modal-import')?.addEventListener('click', (e) => { if (e.target === e.currentTarget) closeModal('modal-import'); });

/* ===== START ===== */

init();
