import {
  BustPoseAnimation,
  createSkinAnimation,
  DEFAULT_SKIN_DEBUG_OPTIONS,
  locatorColorFromUuid,
  SkinModelType,
  SkinViewEngine,
  type ShotPresetId,
  type SkinAnimId,
  type SkinDebugOptions,
} from 'skinviewengine';
import { marked } from 'marked';
import { setApiBase, getApiBase, catalogImageUrl, skinImageUrl } from '../shared/apiBase';
import { classifyMcVersion, DEFAULT_VERSION_FILTERS, MC_VERSION_GROUPS, type McVersionGroup } from '../shared/mcVersionGroups';
import { previewBadge, resolvePreviewStrategy } from '../shared/world-preview-matrix';
import type { AiUiHost } from './ai/types';
import { initMessenger, ensureMessengerTab, warmMessengerSession, notifyMessengerAccountChanged, notifyMessengerGameRunning, notifyMessengerGameStopped, openGroupInviteModal, openAssistantBotDm, openProfileByUsername, openProfileByUserId } from './messenger/ui';
import { initSocialFeed, loadSocialFeed, fetchUserSocialPosts, renderUserPostsHtml } from './social-feed';
import { bindZoomableImages, closeImageViewer, openImageViewer } from './image-viewer';
import { bindPlayableVideos, closeVideoViewer, isDirectVideoUrl, openVideoViewer } from './video-player';
import { initUiSfx, playStatusCue, playToastCue, setUiSfxEnabled } from './ui-sfx';
import { hiddenListingAddrs, undefinedListingEntries } from './hostedServers';
import { initGamepad, refreshGamepadLabels, setGamepadLook, syncGamepadColor, takeGamepadLaunch } from './gamepad';
import { closeAccountStage, openAccountStage } from './account-stage';
import {
  askAiConfirmBatch,
  askAiConfirmInChat,
  describeAiAction,
  parkAiConfirmsFromRoot,
  pushAiUndo,
  renderAiBuildDiff,
  renderAiUndoChip,
  restoreAiConfirmsForSession,
} from './ai/confirm-ui';
import {
  formatBuildChoice,
  isCreateRequest,
  isLastPlayedRequest,
  isLaunchRequest,
  matchBuildsByName,
  resolveLaunchBuilds,
} from './ai/build-match';
import {
  appendAiBuildPreview,
  appendAiCrashQuote,
  askAgentAboutMod,
  hideAiCrashBanner,
  isBuildTouchedByAgent,
  markBuildTouchedByAgent,
  showAiCrashBanner,
} from './ai/integrations-ui';
import {
  clearAiAttachments,
  closeAiAttachMenu,
  formatAiAttachmentsPrompt,
  getAiAttachments,
  initAiAttachUi,
  parseAiAttachmentsPrompt,
  pushAiAttachment,
  renderAiAttachBadgesHtml,
  type AiAttachment,
} from './ai/attach-ui';
import {
  renderAiContextBar,
  renderAiContextHints,
  renderAiEmptyScenarios,
  renderAiQuickChips,
} from './ai/shell-ui';
import {
  attachAiMessageActions,
  beginAiRound,
  endAiRound,
  hideAiSkeleton,
  mountAiPlan,
  onAiStop,
  setAiAgentStatus,
  setAiStopVisible,
  showAiSkeleton,
  updateAiPlanStep,
  wrapAiToolCollapsible,
} from './ai/turn-ui';

interface NewsPostSummary {
  id: string;
  title: string;
  summary: string;
  content?: string;
  cover: string | null;
  media?: { url: string; type?: string; alt?: string }[];
  publishedAt: string;
  author: string;
  hasEn?: boolean;
  views?: number;
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

interface DeepLinkJoinGroup {
  action: 'join-group';
  token: string;
}

interface DeepLinkLaunch {
  action: 'launch';
  id: string;
}

type DeepLinkPayload = DeepLinkInstall | DeepLinkImportInstance | DeepLinkJoinGroup | DeepLinkLaunch;

interface InstanceShareCounts {
  mods: number;
  resourcePacks: number;
  shaders: number;
  dataPacks: number;
}

interface InstanceShareFilePreview {
  fileId?: string;
  contentType?: string;
  filename?: string;
  name?: string;
  version?: string;
  enabled?: boolean;
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
  files?: InstanceShareFilePreview[];
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
  detectRunningGame?: () => Promise<{
    ok: boolean;
    running: boolean;
    buildId?: string;
    name?: string;
    gameVersion?: string;
    loader?: string;
    pid?: number;
    startedAt?: number;
  }>;
  authOffline: (username: string) => Promise<{ name: string; uuid: string; type: string }>;
  authMicrosoft: () => Promise<{ name: string; uuid: string; type: string }>;
  authEly: () => Promise<any>;
  refreshAccount: (account: any) => Promise<any>;
  saveAccount: (account: any) => Promise<any>;
  loadAccounts: () => Promise<any[]>;
  removeAccount: (uuid: string) => Promise<any>;
  setActiveAccount: (uuid: string) => Promise<{ ok?: boolean } | any>;
  getActiveAccount: () => Promise<string | null>;
  saveBuild: (build: any) => Promise<any>;
  prefetchRuntime?: (opts: { buildId: string; gameVersion: string; loader?: string; loaderVersion?: string }) => Promise<{ ok: boolean; error?: string }>;
  loadBuilds: () => Promise<any[]>;
  removeBuild: (id: string) => Promise<any>;
  loadBuildGroups: () => Promise<any[]>;
  saveBuildGroup: (group: any) => Promise<any>;
  removeBuildGroup: (id: string) => Promise<any>;
  /** Имена файлов из assets/InstancesIcons (подхватываются на лету) */
  listInstanceIcons: () => Promise<string[]>;
  saveServer: (server: any) => Promise<any>;
  loadServers: () => Promise<any[]>;
  removeServer: (id: string) => Promise<any>;
  serverStatus: (ip: string) => Promise<any>;
  fetchServerCatalog: (force?: boolean) => Promise<any[]>;
  fetchServerDetail: (source: string, id: string) => Promise<any>;
  fetchServerHistory: (projectId: string, serverId: string, period: string) => Promise<any>;
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
  getModrinthProjects: (query: string, type: string, offset?: number, limit?: number, opts?: { categories?: string[]; loaders?: string[]; version?: string; index?: string; source?: string }) => Promise<{ hits?: any[]; total_hits?: number; error?: string }>;
  getModrinthProject: (projectId: string) => Promise<any>;
  getModrinthVersions: (projectId: string) => Promise<any[]>;
  downloadMod: (projectId: string, versionId?: string) => Promise<{ success: boolean; filename?: string; error?: string; buildCreated?: boolean; build?: any }>;
  cancelDownloads: () => Promise<{ ok: boolean }>;
  installMod: (buildId: string, projectId: string, versionId?: string, contentType?: string, options?: { force?: boolean; skipDeps?: boolean; installOptional?: boolean }) => Promise<{
    success: boolean;
    name?: string;
    version?: string;
    filename?: string;
    projectId?: string;
    iconUrl?: string;
    description?: string;
    contentType?: string;
    error?: string;
    installed?: Array<{
      name: string;
      version: string;
      filename: string;
      projectId: string;
      iconUrl: string;
      description: string;
      contentType: string;
      isDependency: boolean;
    }>;
    dependenciesInstalled?: number;
    alreadySatisfied?: Array<{ projectId: string; title: string }>;
    optionalSuggested?: Array<{ projectId: string; title: string; versionId?: string }>;
    conflicts?: Array<{ projectId: string; title: string; withProjectId: string; withTitle: string }>;
    unresolved?: Array<{ projectId: string; reason: string }>;
    pendingDeps?: number;
  }>;
  resolveProjectByName: (name: string) => Promise<{ projectId: string; iconUrl: string; title: string; description: string } | null>;
  pickModpack: () => Promise<string | null>;
  pickWallpaper?: () => Promise<{ name: string; media: 'image' | 'video' } | { error: string } | null>;
  inspectModpack: (archivePath: string) => Promise<{
    success: boolean;
    inspect?: {
      format: string;
      name: string;
      gameVersion: string;
      loader: string;
      loaderVersion: string;
      fileCount: number;
      hasOverrides: boolean;
      archiveName: string;
      counts?: {
        mods: number;
        resourcePacks: number;
        shaders: number;
        dataPacks: number;
        configs: number;
      };
      previewFiles?: Array<{
        name: string;
        kind: 'mod' | 'resourcepack' | 'shader' | 'datapack' | 'config' | 'other';
      }>;
    };
    error?: string;
  }>;
  createBuildShortcut: (buildId: string) => Promise<{
    success: boolean;
    path?: string;
    name?: string;
    error?: string;
  }>;
  importModpack: (archivePath: string) => Promise<{
    success: boolean;
    error?: string;
    build?: any;
    inspect?: any;
    downloaded?: number;
    skipped?: number;
    extractSkipped?: string[];
    incomplete?: boolean;
  }>;
  getVersions: () => Promise<any[]>;
  getLoaderVersions: (loader: string, mcVersion: string) => Promise<{ versions: string[]; error?: string; unavailable?: boolean } | string[]>;
  listInstanceDrives?: () => Promise<Array<{ letter: string; path: string }>>;
  getInstancesLocation?: () => Promise<{ platform: string; instancesDir: string; windowsOnly: boolean }>;
  setDefaultInstancesDir?: (dir: string) => Promise<{ ok: boolean; error?: string; path?: string }>;
  pickInstancesDir?: (title?: string) => Promise<string | null>;
  prepareBuildLocation?: (buildId: string, parentDir: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
  moveInstance?: (buildId: string, destParent: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
  scanExternalLaunchers?: () => Promise<{
    ok: boolean;
    error?: string;
    launchers: Array<{
      id: string;
      name: string;
      root: string;
      iconDataUrl?: string;
      instances: Array<{ id: string; name: string; gameVersion: string; loader: string; loaderVersion: string; iconDataUrl?: string }>;
    }>;
  }>;
  importExternalInstances?: (launcherId: string, instanceIds: string[]) => Promise<{ ok: boolean; error?: string; imported: any[] }>;
  detectJava: (refresh?: boolean) => Promise<{ name: string; path: string; version: number; managed?: boolean }[]>;
  listJavaVersions: (refresh?: boolean) => Promise<{
    version: number;
    installed: boolean;
    managed: boolean;
    path: string | null;
    systemPaths: string[];
    canInstall?: boolean;
    names?: string[];
  }[]>;
  pickJava: () => Promise<{ path: string; version: number; name: string } | null>;
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
  fetchNewsView: (id: string) => Promise<{ views?: number; error?: string }>;
  messengerSession: (account: any) => Promise<{ ok: boolean; user?: any; token?: string; cached?: boolean; code?: string; error?: string }>;
  messengerLogout: () => Promise<{ ok: boolean }>;
  messengerRequest: (payload: {
    method?: string;
    path: string;
    body?: unknown;
    query?: Record<string, string | number | undefined>;
  }) => Promise<{ ok: boolean; data?: any; code?: string; error?: string; status?: number }>;
  aiStatus: () => Promise<{
    configured?: boolean;
    access?: boolean;
    reason?: string;
    requiresKey?: boolean;
    tools?: boolean;
    toolNames?: string[];
    error?: string;
  }>;
  aiProviderGet?: () => Promise<{
    kind?: 'pixi' | 'openai' | 'anthropic';
    baseUrl?: string;
    model?: string;
    hasKey?: boolean;
    keyTail?: string;
  }>;
  aiProviderSet?: (patch: { kind?: string; baseUrl?: string; apiKey?: string; model?: string }) => Promise<{
    kind?: string;
    baseUrl?: string;
    model?: string;
    hasKey?: boolean;
    keyTail?: string;
  }>;
  aiProviderModels?: () => Promise<{ ok?: boolean; models?: string[]; error?: string }>;
  hostedServersList?: () => Promise<
    Array<{
      id: string;
      name: string;
      software?: string;
      gameVersion?: string;
      status?: string;
      publicHost?: string;
      publicPort?: number;
      port?: number;
      coreReady?: boolean;
    }>
  >;
  hostedServersPlugins?: (id: string) => Promise<Array<{ name: string; enabled: boolean; size?: number }>>;
  hostedServersFiles?: (
    id: string,
    rel?: string,
  ) => Promise<{ ok?: boolean; entries?: Array<{ name: string; dir: boolean; size: number }> }>;
  aiChat: (payload: {
    messages: Array<Record<string, unknown>>;
    tools?: boolean;
    model?: string;
    context?: { buildId?: string; buildName?: string } | null;
  }) => Promise<{
    reply?: string;
    model?: string | null;
    toolsEnabled?: boolean;
    toolCalls?: Array<{ id: string; type?: string; function: { name: string; arguments: string } }>;
    error?: string;
    code?: string;
    reason?: string;
  }>;
  aiToolsList: () => Promise<{ tools?: unknown[]; names?: string[] }>;
  aiToolsRun: (
    name: string,
    args?: Record<string, unknown>,
    opts?: { confirmed?: boolean },
  ) => Promise<{
    ok: boolean;
    risk?: 'read' | 'write';
    result?: unknown;
    error?: string;
  }>;
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
  exportInstanceZip: (buildId: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
  exportInstanceMrpack: (buildId: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
  onInstanceExportProgress: (callback: (data: any) => void) => () => void;
  onDownloadProgress: (callback: (data: any) => void) => () => void;
  onLauncherStatus: (callback: (data: any) => void) => () => void;
  onLauncherLog: (callback: (data: string) => void) => () => void;
  onLauncherDownload: (callback: (data: any) => void) => () => void;
  onLaunchProgress: (callback: (data: any) => void) => () => void;
  openConsole: () => Promise<void>;
  appendConsoleLog: (message: string) => Promise<{ ok?: boolean } | void>;
  notifyThemeChanged?: (accent: string) => void;
  onThemeChanged?: (callback: (accent: string) => void) => () => void;
  getConsoleHistory: () => Promise<any[]>;
  saveConsoleLog: (logContent: string) => Promise<{ success: boolean; canceled?: boolean; path?: string; error?: string }>;
  onConsoleLog: (callback: (data: any) => void) => () => void;
  openExternal: (url: string) => Promise<void>;
  openPath: (dirPath: string) => Promise<string | void>;
  pickFiles: () => Promise<string[]>;
  readAttachFile: (filePath: string) => Promise<{
    name: string;
    path: string;
    text?: string;
    error?: string;
  } | null>;
  saveLogFile: (buildId: string, logContent: string) => Promise<{ success: boolean; path?: string; error?: string }>;
  openWorldViewer: (worldPath?: string, profile?: {
    username?: string;
    uuid?: string;
    skinDataUrl?: string;
  }, bounds?: { x: number; y: number; width: number; height: number }) => Promise<{ ok?: boolean; embedded?: boolean; pending?: boolean } | void>;
  attachWorldViewer: (bounds: { x: number; y: number; width: number; height: number }) => Promise<{ ok?: boolean }>;
  setWorldViewerBounds: (bounds: { x: number; y: number; width: number; height: number }) => Promise<{ ok?: boolean }>;
  closeWorldViewer: () => Promise<{ ok?: boolean }>;
  onWorldModalOpen: (callback: (data: { worldPath?: string }) => void) => () => void;
  onWorldModalClosed: (callback: () => void) => () => void;
  onWorldBoundsSyncRequest: (callback: () => void) => () => void;
  ensureWorldExporter: () => Promise<{ ok: boolean; exe?: string; error?: string }>;
  exportWorldPreview: (worldPath: string, minecraftVersion: string) => Promise<{
    ok: boolean;
    outDir?: string;
    error?: string;
    log?: string;
  }>;
  openWorldExport: (outDir: string) => Promise<{ ok: boolean; error?: string }>;
  onWorldExportProgress: (callback: (msg: string) => void) => () => void;
  listMinecraftWorlds: () => Promise<{ buildId: string; folder: string; worldPath: string }[]>;
  getInstancePath: (buildId: string) => Promise<string>;
  listScreenshots: (buildId: string) => Promise<{ name: string; size: number; modified: number; thumb: string }[]>;
  listWorlds: (buildId: string) => Promise<{
    name: string;
    folder: string;
    icon: string;
    lastPlayed: number;
    gameType: number;
    hardcore: boolean;
    difficulty: number;
    version: string;
    dataVersion: number;
    size: number;
  }[]>;
  deleteInstanceFiles: (buildId: string, sub: string, names: string[]) => Promise<{ success: boolean; deleted?: number; error?: string }>;
  saveInstanceFiles: (buildId: string, sub: string, names: string[]) => Promise<{ success: boolean; saved?: number; canceled?: boolean; error?: string }>;
  toggleInstanceFile: (
    buildId: string,
    sub: string,
    filename: string,
    enabled?: boolean,
  ) => Promise<{ success: boolean; filename?: string; enabled?: boolean; error?: string }>;
  getScreenshot: (buildId: string, name: string) => Promise<{ success: boolean; dataUrl?: string; size?: number; error?: string }>;
  copyScreenshot: (buildId: string, name: string) => Promise<{ success: boolean; error?: string }>;
  importInstanceFiles: (
    buildId: string,
    sub: string,
    sourcePaths?: string[],
  ) => Promise<{
    success: boolean;
    imported?: string[];
    targetDir?: string;
    count?: number;
    canceled?: boolean;
    error?: string;
  }>;
  scanInstance: (buildId: string) => Promise<{ mods: any[]; resourcepacks: any[]; shaders: any[]; datapacks: any[] }>;
  watchInstance: (buildId: string) => Promise<void>;
  unwatchInstance: (buildId: string) => Promise<void>;
  onInstanceChanged: (callback: (buildId: string, data: any) => void) => () => void;
  onBuildsChanged: (callback: () => void) => () => void;
  onAiAction: (
    callback: (msg: { id: string; action: string; payload: Record<string, unknown> }) => void,
  ) => () => void;
  aiActionResult: (msg: { id: string; result: unknown }) => void;
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

/** Иконка по умолчанию, если сборке не задали свою. */
const DEFAULT_BUILD_ICON_SRC = '../../assets/InstancesIcons/newBuild.png';

function defaultBuildIconHtml(extraStyle = ''): string {
  const style = extraStyle
    ? `width:100%;height:100%;object-fit:cover;${extraStyle}`
    : 'width:100%;height:100%;object-fit:cover;';
  return `<img src="${DEFAULT_BUILD_ICON_SRC}" style="${style}" alt="">`;
}

function buildCardIconHtml(build: { icon?: string }): string {
  if (build.icon) {
    return `<img src="${buildIconSrc(build.icon)}" style="width:100%;height:100%;object-fit:cover;" alt="">`;
  }
  return defaultBuildIconHtml();
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
    const translated = tr(key);
    const nested = el.querySelector<HTMLElement>('.ai-scenario__title, [data-i18n-target]');
    if (nested) {
      nested.textContent = translated;
      return;
    }
    if (el.querySelector('*')) {
      el.childNodes.forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) node.textContent = translated;
      });
    } else {
      el.textContent = translated;
    }
  });
  document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-i18n-ph], [data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-ph') || el.getAttribute('data-i18n-placeholder') || '';
    el.placeholder = tr(key);
  });
  document.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach(el => {
    el.title = tr(el.getAttribute('data-i18n-title') || '');
  });
  document.querySelectorAll<HTMLElement>('[data-i18n-html]').forEach(el => {
    el.innerHTML = tr(el.getAttribute('data-i18n-html') || '');
  });
  syncSidebarCollapseText();
  initGamepad((key) => t(key));
  refreshGamepadLabels();
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
  if (aiInited) {
    renderAiEmptyScenarios(getAiUiHost());
    renderAiSessionList();
    refreshAiShellUi(activeAiSession());
  }
}

/* ===== TITLEBAR ===== */

document.getElementById('btn-min')?.addEventListener('click', () => api?.windowMinimize());
document.getElementById('btn-max')?.addEventListener('click', () => api?.windowMaximize());
document.getElementById('btn-close')?.addEventListener('click', () => api?.windowClose());

/* ===== TAB SWITCHING ===== */

function switchTab(target: string): void {
  if (!target) return;
  if (target === 'ai') {
    if (!isAiFeatureEnabled()) {
      showAiAccessDeniedModal();
      return;
    }
  }
  if (target === 'messenger') {
    if (isOfflineAccount()) {
      showMessengerOfflineModal();
      return;
    }
  }
  if (target === 'skins') {
    if (isOfflineAccount()) {
      showSkinsOfflineModal();
      return;
    }
  }
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
  if (target === 'builds') void refreshExternalLaunchers();
  if (target === 'home') {
    renderHomeNews();
    refreshHomeDashboard();
  }
  if (target === 'news') {
    // JWT Messenger нужен для соцленты — прогреваем, если ещё не заходили в чаты
    void warmMessengerSession().finally(() => {
      void loadNews(false);
    });
  }
  if (target === 'ai') {
    ensureAiTab();
    void warmMessengerSession().finally(() => {
      void refreshAiAccessStatus().then(() => {
        if (aiAccessOk === false) showAiAccessDeniedModal();
      });
    });
  }
  if (target === 'messenger') {
    void ensureMessengerTab();
  }
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
let homeWallPlaying = false;

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
  setSkinViewerPaused(document.hidden || presenceTab !== 'skins');
  syncWallpaper();
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
      const w = img.naturalWidth || img.width;
      const hImg = img.naturalHeight || img.height;
      if (w < 64 || w % 64 !== 0) {
        resolve(null);
        return;
      }
      const scale = w / 64;
      const rows = hImg / scale;
      if (Math.abs(rows - 64) > 0.5 && Math.abs(rows - 32) > 0.5) {
        resolve(null);
        return;
      }
      const face = 8 * scale;
      ctx.drawImage(img, 8 * scale, 8 * scale, face, face, 0, 0, size, size);
      ctx.drawImage(img, 40 * scale, 8 * scale, face, face, 0, 0, size, size);
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
  forgetDiscordFaceStamp();
  pushPresence();
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

const discordFaceStamp = new Map<string, { stamp: string; at: number }>();

function discordFaceKey(acc: any): string {
  const type = acc?.meta?.type || acc?.type || '';
  const nick = String(acc?.username || acc?.name || '').trim().toLowerCase();
  const uuid = String(acc?.uuid || '').replace(/-/g, '').toLowerCase();
  return `${type}:${uuid || nick}`;
}

function skinFaceStamp(url: string | null | undefined): string {
  const text = String(url || '');
  if (!text || text.includes('cbe20ed58814c5e1')) return '';
  const hash = text.replace(/[^a-zA-Z0-9]/g, '').slice(-16);
  return hash ? `&s=${hash}` : '';
}

/** Публичная голова выбранного аккаунта. Discord забирает её сам, data:-адрес ему не виден. */
async function accountDiscordFaceUrl(acc: any): Promise<string> {
  const base = `${getApiBase()}/api/skin/face`;
  const type = acc?.meta?.type || acc?.type || '';
  const nick = String(acc?.username || acc?.name || '').trim();
  const uuid = String(acc?.uuid || '').replace(/-/g, '').toLowerCase();
  const key = discordFaceKey(acc);
  const cached = discordFaceStamp.get(key);
  const fresh = !cached || Date.now() - cached.at > 60_000;
  let stamp = cached?.stamp || '';
  try {
    if (fresh && type === 'yggdrasil' && nick && api?.getElyWornSkin) {
      stamp = skinFaceStamp(await api.getElyWornSkin(nick, true));
      discordFaceStamp.set(key, { stamp, at: Date.now() });
    } else if (fresh && type === 'msa' && uuid && api?.getSkinData) {
      const data = await api.getSkinData(uuid);
      stamp = skinFaceStamp(data?.skinUrl);
      discordFaceStamp.set(key, { stamp, at: Date.now() });
    }
  } catch {
    /* прошлый штамп, карточка всё равно откроется */
  }
  if (type === 'yggdrasil' && nick) return `${base}?nick=${encodeURIComponent(nick)}${stamp}`;
  if (type === 'msa' && uuid) return `${base}?uuid=${uuid}${stamp}`;
  return `${base}?steve=1`;
}

function forgetDiscordFaceStamp(): void {
  discordFaceStamp.delete(discordFaceKey(currentAccount));
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

let presenceSeq = 0;

function pushPresence(screen?: string): void {
  if (screen) presenceScreen = screen;
  const seq = ++presenceSeq;
  const screenNow = presenceScreen;
  const acc = currentAccount;
  const name = acc?.username || '';
  void (async () => {
    const account = name ? { name, avatar: await accountDiscordFaceUrl(acc) } : null;
    if (seq !== presenceSeq) return;
    api?.updatePresence?.({ screen: screenNow, account });
  })();
}

const tabs = document.querySelectorAll<HTMLElement>('.tab-btn');
const tabViews = document.querySelectorAll<HTMLElement>('.tab-view');

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    switchTab(tab.getAttribute('data-tab') || '');
  });
});

// ===== Сворачивание бокового меню =====

const SIDEBAR_COLLAPSE_KEY = 'Undefined Client-sidebar-collapsed';

function sidebarIsCollapsed(): boolean {
  return document.getElementById('tab-panel')?.classList.contains('is-collapsed') ?? false;
}

function syncSidebarCollapseText(): void {
  const collapsed = sidebarIsCollapsed();
  const key = collapsed ? 'sidebar.expand' : 'sidebar.collapse';
  const btn = document.getElementById('sidebar-collapse');
  btn?.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  btn?.removeAttribute('title');
  btn?.removeAttribute('data-i18n-title');
  if (btn) btn.setAttribute('aria-label', t(key));
  const label = btn?.querySelector<HTMLElement>('.sidebar-collapse__label');
  if (!label) return;
  label.setAttribute('data-i18n', key);
  label.textContent = t(key);
}

function setSidebarCollapsed(collapsed: boolean): void {
  document.getElementById('tab-panel')?.classList.toggle('is-collapsed', collapsed);
  localStorage.setItem(SIDEBAR_COLLAPSE_KEY, collapsed ? '1' : '0');
  if (!collapsed) hideSidebarTip();
  syncSidebarCollapseText();
}

document.getElementById('sidebar-collapse')?.addEventListener('click', () => {
  setSidebarCollapsed(!sidebarIsCollapsed());
});

// ===== Стеклянные подсказки свёрнутого меню =====

let sidebarTipEl: HTMLElement | null = null;
let sidebarTipTarget: HTMLElement | null = null;

function ensureSidebarTip(): HTMLElement {
  if (sidebarTipEl) return sidebarTipEl;
  const el = document.createElement('div');
  el.id = 'sidebar-tip';
  el.className = 'sidebar-tip';
  el.setAttribute('role', 'tooltip');
  el.innerHTML = '<div class="sidebar-tip__title"></div><div class="sidebar-tip__sub" hidden></div>';
  document.body.appendChild(el);
  sidebarTipEl = el;
  return el;
}

function sidebarTipHost(node: EventTarget | null): HTMLElement | null {
  if (!(node instanceof Element)) return null;
  const host = node.closest<HTMLElement>('.sidebar-collapse, .tab-btn, .sidebar-card, #account-selector');
  if (!host || !host.closest('#tab-panel')) return null;
  if (host.classList.contains('hidden') || host.classList.contains('hidden-card')) return null;
  return host;
}

function sidebarTipText(host: HTMLElement): { title: string; sub: string } | null {
  if (host.classList.contains('sidebar-collapse')) {
    const title = host.querySelector('.sidebar-collapse__label')?.textContent?.trim() || '';
    return title ? { title, sub: '' } : null;
  }
  if (host.classList.contains('tab-btn')) {
    const title = host.querySelector('.tab-btn-title')?.textContent?.trim() || '';
    return title ? { title, sub: '' } : null;
  }
  if (host.classList.contains('sidebar-card')) {
    const title = host.querySelector('.sidebar-card-label')?.textContent?.trim() || '';
    const name = host.querySelector('.sidebar-card-title')?.textContent?.trim() || '';
    const verNode = host.querySelector('.sidebar-srv-ver');
    const onlineNode = host.querySelector('.sidebar-srv-online');
    let sub = '';
    if (verNode || onlineNode) {
      sub = [name, verNode?.textContent?.trim() || '', onlineNode?.textContent?.trim() || ''].filter(Boolean).join(' • ');
    } else {
      const ver = host.querySelector('.sidebar-card-version')?.textContent?.replace(/\s*·\s*/g, ' ').replace(/\s+/g, ' ').trim() || '';
      sub = [name, ver].filter(Boolean).join(' • ');
    }
    if (!title && !sub) return null;
    return { title: title || name, sub: title ? sub : '' };
  }
  if (host.id === 'account-selector') {
    const name = host.querySelector('.account-nickname')?.textContent?.trim() || '';
    const type = host.querySelector('.account-type')?.textContent?.trim() || '';
    return { title: t('sidebar.activeAccount'), sub: [name, type].filter(Boolean).join(' • ') };
  }
  return null;
}

function hideSidebarTip(): void {
  sidebarTipTarget = null;
  sidebarTipEl?.classList.remove('is-open');
}

function showSidebarTip(host: HTMLElement): void {
  if (!sidebarIsCollapsed()) {
    hideSidebarTip();
    return;
  }
  const payload = sidebarTipText(host);
  if (!payload) {
    hideSidebarTip();
    return;
  }
  const tip = ensureSidebarTip();
  const titleEl = tip.querySelector<HTMLElement>('.sidebar-tip__title');
  const subEl = tip.querySelector<HTMLElement>('.sidebar-tip__sub');
  if (titleEl) titleEl.textContent = payload.title;
  const rich = Boolean(payload.sub);
  tip.classList.toggle('is-rich', rich);
  if (subEl) {
    subEl.hidden = !rich;
    subEl.textContent = payload.sub;
  }
  const same = sidebarTipTarget === host && tip.classList.contains('is-open');
  sidebarTipTarget = host;
  const rect = host.getBoundingClientRect();
  const height = tip.offsetHeight;
  const top = Math.max(8, rect.top + (rect.height - height) / 2);
  // Карточки и аккаунт уже панели, разделы — на всю ширину. Отступ один: от края меню.
  const panelRight = host.closest('#tab-panel')?.getBoundingClientRect().right ?? rect.right;
  tip.style.left = `${Math.round(panelRight + 4)}px`;
  tip.style.top = `${Math.round(top)}px`;
  tip.classList.add('is-open');
  // Смена раздела не снимает класс, поэтому CSS-переход не стартует повторно
  if (!same && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    tip.getAnimations().forEach((anim) => anim.cancel());
    tip.animate(
      [
        { opacity: 0, transform: 'scale(0.8)' },
        { opacity: 1, transform: 'scale(1)' },
      ],
      { duration: 180, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    );
  }
}

document.getElementById('tab-panel')?.addEventListener('pointerover', (event) => {
  if (!sidebarIsCollapsed()) return;
  const host = sidebarTipHost(event.target);
  if (!host) return;
  showSidebarTip(host);
});

document.getElementById('tab-panel')?.addEventListener('pointerout', (event) => {
  const next = event.relatedTarget;
  const nextHost = next instanceof Element ? sidebarTipHost(next) : null;
  if (nextHost) return;
  hideSidebarTip();
});

document.getElementById('sidebar-cards')?.addEventListener('scroll', () => {
  if (sidebarTipTarget) showSidebarTip(sidebarTipTarget);
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

async function resolveAccountStageSkin(acc: any): Promise<string | null> {
  const type = acc?.meta?.type || acc?.type;
  const accKey = String(acc?.uuid || '').replace(/-/g, '').toLowerCase();
  if (type === 'msa' && accKey) {
    const local = savedSkins.find((skin) => skin.id === `license-skin-${accKey}` && skin.dataUrl);
    if (local?.dataUrl) return local.dataUrl;
  }
  if (accKey && accKey === accountCosmeticsKey()) {
    const activeId = getActiveSkinId();
    const active = activeId ? savedSkins.find((skin) => skin.id === activeId && skin.dataUrl) : null;
    if (active?.dataUrl) return active.dataUrl;
  }
  if (!api?.fetchSkinImage) return null;
  try {
    if (type === 'yggdrasil') {
      const url = await getElyAvatarUrl(acc, true);
      if (!url) return null;
      const b64 = await api.fetchSkinImage(url);
      return b64 ? `data:image/png;base64,${b64}` : null;
    }
    if (type === 'msa' && accKey && api.getSkinData) {
      const data = await api.getSkinData(accKey);
      if (!data?.skinUrl) return null;
      const b64 = await api.fetchSkinImage(data.skinUrl);
      return b64 ? `data:image/png;base64,${b64}` : null;
    }
  } catch {
    return null;
  }
  return null;
}

function stageUuidKey(value: unknown): string {
  return String(value || '').replace(/-/g, '').toLowerCase();
}

let stageMessengerUser: { id?: string; username?: string; uuid?: string } | null = null;
let stageMessengerGate: Promise<{ id?: string; username?: string; uuid?: string } | null> | null = null;

/** Сессия мессенджера нужна lookup и /friends: без токена оба счётчика остаются нулями. */
async function ensureStageMessenger(): Promise<{ id?: string; username?: string; uuid?: string } | null> {
  if (stageMessengerUser) return stageMessengerUser;
  if (!stageMessengerGate) {
    stageMessengerGate = (async () => {
      if (!api?.messengerRequest && !api?.messengerSession) return null;
      const probe = await api?.messengerRequest?.({ path: '/me' });
      if (probe?.ok && probe.data?.user) return probe.data.user;
      const accounts = api?.loadAccounts ? await api.loadAccounts() : [];
      const preferred = [currentAccount, ...accounts].filter(Boolean);
      for (const acc of preferred) {
        const type = acc?.meta?.type || acc?.type;
        if (type !== 'msa' && type !== 'yggdrasil') continue;
        if (!String(acc?.accessToken || '').trim() || !api?.messengerSession) continue;
        const session = await api.messengerSession(acc);
        if (session?.ok && session.user) return session.user;
      }
      return null;
    })().then((user) => {
      stageMessengerUser = user;
      return user;
    }).finally(() => {
      if (!stageMessengerUser) stageMessengerGate = null;
    });
  }
  return stageMessengerGate;
}

/** Посты, друзья и свои скины для стеклянной карточки зала. */
async function loadAccountStageStats(acc: any): Promise<{ posts: number; friends: number; skins: number }> {
  const key = stageUuidKey(acc?.uuid);
  const skins = savedSkins.filter((skin) => {
    if (!skin?.dataUrl || isCapeId(String(skin.id || ''))) return false;
    const owner = stageUuidKey(skin.accountId);
    if (owner) return owner === key;
    return Boolean(key) && String(skin.id || '').toLowerCase().includes(key);
  }).length;
  let posts = 0;
  let friends = 0;
  const name = String(acc?.name || acc?.username || '').trim();
  if (!name || !api?.messengerRequest) return { posts, friends, skins };
  try {
    const sessionUser = await ensureStageMessenger();
    const res = await api.messengerRequest({
      path: '/social/users/lookup',
      query: { username: name },
    });
    const user = res?.ok ? res.data?.user : null;
    if (user) {
      const rawPosts = user.postCount ?? user.postsCount;
      if (rawPosts != null && rawPosts !== '') {
        posts = Number(rawPosts) || 0;
      } else if (user.id) {
        const postsRes = await api.messengerRequest({
          path: `/social/users/${encodeURIComponent(String(user.id))}/posts`,
          query: { limit: 50 },
        });
        const list = postsRes?.data?.posts;
        if (Array.isArray(list)) posts = list.length;
      }
      const rawFriends = user.friendCount ?? user.friendsCount;
      if (rawFriends != null && rawFriends !== '') friends = Number(rawFriends) || 0;
      const sameUser = Boolean(
        sessionUser && (
          (user.id && sessionUser.id && String(user.id) === String(sessionUser.id))
          || (user.username && sessionUser.username
            && String(user.username).toLowerCase() === String(sessionUser.username).toLowerCase())
          || (key && stageUuidKey(sessionUser.uuid) === key)
        ),
      );
      if (sameUser) {
        const friendsRes = await api.messengerRequest({ path: '/friends' });
        const list = friendsRes?.data?.friends;
        if (Array.isArray(list)) friends = list.length;
      }
    }
  } catch { /* нет сети или сессии */ }
  return { posts, friends, skins };
}

async function openAccountHall(): Promise<void> {
  const accounts = api?.loadAccounts ? await api.loadAccounts() : [];
  const shown = accounts;
  const steveHead = await drawSkinHeadAvatar(OFFLINE_STEVE_SKIN_URL, 80);
  const accountSlots = await Promise.all(shown.map(async (acc) => {
    const type = acc.meta?.type || acc.type;
    const offline = type === 'offline' || type === 'crack' || !type;
    const detail = type === 'yggdrasil'
      ? t('acc.ely')
      : type === 'msa'
        ? t('acc.license')
        : t('acc.offlineTypeName');
    const head = offline
      ? steveHead
      : type === 'yggdrasil'
        ? (await resolveAccountHeadAvatar(acc)) || steveHead
        : accountAvatarSources(acc).primary;
    return {
      id: String(acc.uuid),
      name: String(acc.name || acc.username || ''),
      detail,
      kind: 'account' as const,
      active: String(acc.uuid) === String(currentAccount?.uuid),
      offline,
      avatarUrl: head,
      statusTitle: t('acc.stageOfflineStatus'),
      statusSub: t('acc.stageOfflineHint'),
      statPosts: t('acc.stagePosts'),
      statFriends: t('acc.stageFriends'),
      statSkins: t('acc.stageSkins'),
      skinUrl: offline ? OFFLINE_STEVE_SKIN_URL : undefined,
    };
  }));
  openAccountStage({
    title: t('acc.stageTitle'),
    hint: t('acc.stageHint'),
    padHints: {
      move: t('acc.stagePadMove'),
      pick: t('acc.stagePadPick'),
      close: t('acc.stagePadClose'),
    },
    slots: [
      ...accountSlots,
      {
        id: 'add',
        name: t('acc.add'),
        detail: t('acc.stageAddDetail'),
        kind: 'add' as const,
        skinUrl: ADD_ACCOUNT_SKIN_URL,
      },
    ],
    resolveSkin: async (id) => {
      const acc = shown.find((item) => String(item.uuid) === id);
      return acc ? resolveAccountStageSkin(acc) : null;
    },
    onPick: (id) => {
      closeAccountStage();
      const acc = shown.find((item) => String(item.uuid) === id);
      if (!acc) return;
      void selectAccount(acc).then(() => renderSavedAccounts());
    },
    onAdd: () => {
      closeAccountStage();
      openModalAccount();
    },
    activeLabel: t('acc.stageCurrent'),
    introTitle: t('acc.stageIntroTitle'),
    introSub: t('acc.stageIntroSub'),
    addNote: {
      title: t('acc.stageAddTitle'),
      text: t('acc.stageAddText'),
      image: '../../assets/images/m3dv5_friendship.png',
    },
  });
  for (const acc of shown) {
    const type = acc.meta?.type || acc.type;
    if (type === 'offline' || type === 'crack' || !type) continue;
    const id = String(acc.uuid);
    void loadAccountStageStats(acc).then((stats) => {
      const card = document.querySelector<HTMLElement>(`.acc-stage .acc-card[data-id="${CSS.escape(id)}"]`);
      if (!card) return;
      const posts = card.querySelector('.acc-card__posts');
      const friends = card.querySelector('.acc-card__friends');
      const skins = card.querySelector('.acc-card__skins');
      if (posts) posts.textContent = String(stats.posts);
      if (friends) friends.textContent = String(stats.friends);
      if (skins) skins.textContent = String(stats.skins);
    });
    void resolveAccountStageSkin(acc).then(async (url) => {
      if (!url) return;
      const head = await drawSkinHeadAvatar(url, 80);
      const img = document.querySelector<HTMLImageElement>(`.acc-stage .acc-card[data-id="${CSS.escape(id)}"] .acc-card__avatar`);
      if (head && img) img.src = head;
    });
  }
}

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
      if (account?.uuid) await api?.setActiveAccount?.(account.uuid);
      void notifyMessengerAccountChanged().then(() => refreshAiAccessStatus());
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
      if (account?.uuid) await api?.setActiveAccount?.(account.uuid);
      void notifyMessengerAccountChanged().then(() => refreshAiAccessStatus());
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
    if (account?.uuid) await api?.setActiveAccount?.(account.uuid);
    void notifyMessengerAccountChanged().then(() => refreshAiAccessStatus());
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
  applyOnlineOnlyTabsVisibility();
  const popupNicknameEl = document.querySelector('.account-popup-current-name');
  if (popupNicknameEl) popupNicknameEl.textContent = account.name;

  if (type !== 'crack' && type !== 'offline' && account.uuid) {
    const uuid = account.uuid.replace(/-/g, '');
    const isEly = account.meta?.type === 'yggdrasil';
    const avatar = accountAvatarSources(account);
    // У Ely в skinUrl лежит лист текстуры. Голову подставит загрузка скина ниже.
    if (!isEly) {
      setSkinImage('.account-skin-img', '.account-skin-placeholder', avatar.primary, avatar.fallback);
      setSkinImage('.account-popup-skin-img', '.account-popup-skin-placeholder', avatar.primary, avatar.fallback);
    }
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
            if (elyB64) await refreshAccountUiAvatar(`data:image/png;base64,${elyB64}`);
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
  const startedUuid = String(account?.uuid || '');
  try {
    const refreshed = await api?.refreshAccount?.(account);
    if (!refreshed) return;
    // Токены сохраняем всегда; UI обновляем только если аккаунт всё ещё выбран
    await api?.saveAccount?.(refreshed);
    if (startedUuid && currentAccount?.uuid && currentAccount.uuid !== startedUuid) return;
    if (refreshed.name !== account.name || refreshed.uuid !== account.uuid) {
      applyAccount(refreshed);
    } else {
      currentAccount = { ...currentAccount, ...refreshed, username: refreshed.name };
    }
  } catch {
    /* оффлайн — остаётся аккаунт из кэша */
  } finally {
    accountRefreshPromise = null;
  }
}

/** Выбор аккаунта: UI сразу, refresh в фоне, запоминаем как активный */
async function selectAccount(account: any, opts?: { refresh?: boolean }): Promise<void> {
  if (!account) return;
  const prevUuid = currentAccount?.uuid || '';
  applyAccount(account);
  if (account.uuid) {
    try {
      await api?.setActiveAccount?.(account.uuid);
    } catch {
      /* ignore */
    }
  }
  const type = account.meta?.type || account.type;
  if (opts?.refresh !== false && (type === 'msa' || type === 'yggdrasil') && api?.refreshAccount) {
    accountRefreshPromise = refreshAccountInBackground(account);
  }
  if (account.uuid && account.uuid !== prevUuid) {
    void notifyMessengerAccountChanged().then(() => refreshAiAccessStatus());
  }
}

function showNoAccountState(): void {
  const nicknameEl = document.querySelector('.account-nickname');
  if (nicknameEl) nicknameEl.textContent = t('acc.needLogin');
  const typeEl = document.querySelector('.account-type');
  if (typeEl) typeEl.textContent = t('acc.addHint');
  currentAccount = { uuid: '', username: '', type: 'offline' };
  applyOnlineOnlyTabsVisibility();
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
  /** Модпак Modrinth, из которого собрана эта сборка. */
  modpackProjectId?: string;
  modpackVersionId?: string;
  modpackVersion?: string;
  /** Id группы сборок (null/undefined — в корне списка) */
  groupId?: string | null;
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

interface BuildGroup {
  id: string;
  name: string;
  icon?: string;
  order?: number;
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
  /** true — добавлен формой, false — сохранён из каталога. */
  manual?: boolean;
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
let savedBuildGroups: BuildGroup[] = [];
/** Развёрнутые группы в списке сборок */
const expandedBuildGroupIds = new Set<string>();
let editingBuildGroupId: string | null = null;
let pendingGroupIcon: string | undefined;
let savedServers: Server[] = [];
let editingBuildId: string | null = null;
let versionsPopulated = false;
let versionsPopulatePromise: Promise<void> | null = null;
let mcVersionCatalog: Array<{ id: string; type: string }> = [];

const VERSION_FILTER_KEY = 'Undefined Client-mc-version-groups';

function loadVersionFilters(): Record<McVersionGroup, boolean> {
  const filters = { ...DEFAULT_VERSION_FILTERS };
  try {
    const raw = localStorage.getItem(VERSION_FILTER_KEY);
    if (!raw) return filters;
    const parsed = JSON.parse(raw) as Partial<Record<McVersionGroup, boolean>>;
    for (const group of MC_VERSION_GROUPS) {
      if (typeof parsed[group] === 'boolean') filters[group] = parsed[group] as boolean;
    }
  } catch { /* настройки по умолчанию */ }
  if (!filters.release && !filters.snapshot && !filters.old_beta && !filters.old_alpha && !filters.ancient) {
    filters.release = true;
  }
  return filters;
}

function saveVersionFilters(filters: Record<McVersionGroup, boolean>): void {
  localStorage.setItem(VERSION_FILTER_KEY, JSON.stringify(filters));
}

function versionGroupLabel(group: McVersionGroup): string {
  return t(`versions.group.${group}`);
}

function appendBuildVersionOption(id: string, label: string): void {
  const select = document.getElementById('modal-build-version') as HTMLSelectElement;
  const menu = document.getElementById('modal-build-version-menu');
  if (!select) return;
  if (Array.from(select.options).some((o) => o.value === id)) return;
  const opt = document.createElement('option');
  opt.value = id;
  opt.textContent = label;
  opt.setAttribute('data-dynamic', '1');
  select.appendChild(opt);
  if (menu) {
    const mi = document.createElement('div');
    mi.className = 'stngs-select-opt';
    mi.dataset.value = id;
    mi.setAttribute('data-dynamic', '1');
    mi.textContent = label;
    menu.appendChild(mi);
  }
}

function syncBuildVersionUI(): void {
  const select = document.getElementById('modal-build-version') as HTMLSelectElement;
  const wrap = select?.closest('.stngs-select-wrap');
  if (wrap) syncSelectUI(wrap as HTMLElement);
}

function rebuildBuildVersionOptions(): void {
  const select = document.getElementById('modal-build-version') as HTMLSelectElement | null;
  const menu = document.getElementById('modal-build-version-menu');
  if (!select) return;
  const selected = select.value;
  const filters = loadVersionFilters();
  select.querySelectorAll('option[data-dynamic]').forEach((node) => node.remove());
  menu?.querySelectorAll('[data-dynamic]').forEach((node) => node.remove());

  const staticLatest = [
    { id: 'latest_release', group: 'release' as McVersionGroup, label: t('be.latestRelease') },
    { id: 'latest_snapshot', group: 'snapshot' as McVersionGroup, label: t('be.latestSnapshot') },
  ];
  for (const item of staticLatest) {
    const opt = select.querySelector(`option[value="${item.id}"]`) as HTMLOptionElement | null;
    const menuOpt = menu?.querySelector<HTMLElement>(`.stngs-select-opt[data-value="${item.id}"]`);
    const show = filters[item.group];
    if (opt) opt.hidden = !show;
    if (menuOpt) menuOpt.style.display = show ? '' : 'none';
  }

  const grouped = new Map<McVersionGroup, string[]>();
  for (const group of MC_VERSION_GROUPS) grouped.set(group, []);
  for (const v of mcVersionCatalog) {
    const group = classifyMcVersion(v.id, v.type);
    if (!filters[group]) continue;
    grouped.get(group)?.push(v.id);
  }
  if (selected && selected !== 'latest_release' && selected !== 'latest_snapshot') {
    const known = mcVersionCatalog.find((v) => v.id === selected);
    if (known) {
      const group = classifyMcVersion(known.id, known.type);
      const list = grouped.get(group);
      if (list && !list.includes(selected)) list.unshift(selected);
    }
  }

  for (const group of MC_VERSION_GROUPS) {
    const ids = grouped.get(group) || [];
    if (!ids.length || !menu) continue;
    const label = document.createElement('div');
    label.className = 'stngs-select-label';
    label.setAttribute('data-dynamic', '1');
    label.textContent = versionGroupLabel(group);
    menu.appendChild(label);
    for (const id of ids) appendBuildVersionOption(id, id);
  }
  const selectedOpt = Array.from(select.options).find((o) => o.value === selected);
  if (selectedOpt && !selectedOpt.hidden) select.value = selected;
  else if (filters.release) select.value = 'latest_release';
  versionsPopulated = mcVersionCatalog.length > 0;
  syncBuildVersionUI();
}

/** Подгружает список версий MC в селект сборки; при пустом ответе можно повторить */
async function ensureBuildVersionsLoaded(force = false): Promise<void> {
  const select = document.getElementById('modal-build-version') as HTMLSelectElement | null;
  if (!select || !api?.getVersions) return;
  if (!force && mcVersionCatalog.length > 0) {
    rebuildBuildVersionOptions();
    return;
  }
  if (versionsPopulatePromise) return versionsPopulatePromise;

  versionsPopulatePromise = (async () => {
    try {
      const versions = await api.getVersions();
      if (!versions || !Array.isArray(versions) || versions.length === 0) {
        versionsPopulated = false;
        return;
      }
      const seen = new Set<string>();
      mcVersionCatalog = [];
      for (const v of versions) {
        const id = String(v?.id || '').trim();
        if (!id || seen.has(id) || id === 'latest_release' || id === 'latest_snapshot') continue;
        seen.add(id);
        mcVersionCatalog.push({ id, type: String(v?.type || '') });
      }
      rebuildBuildVersionOptions();
    } catch {
      versionsPopulated = false;
    } finally {
      versionsPopulatePromise = null;
    }
  })();

  return versionsPopulatePromise;
}

let runningBuild: Build | null = null;
let runningBuildStart: number = 0;
let runningBuildTimer: number = 0;
let editingServerId: string | null = null;
const BUILD_COLORS = ['#7BD4B7', '#FF6B6B', '#4ECDC4', '#FFD93D', '#70ADDF', '#C084FC', '#FB923C', '#F472B6'];
let savedSkins: any[] = [];
let savedMods: any[] = [];

function setupDownloadProgress(): void {
  if (!api?.onDownloadProgress) return;
  api.onDownloadProgress((data: any) => {
    syncTaskFromDownload(data);
    if (data.type === 'start') {
      pushConsoleLog(t('log.downloadStart', { file: data.filename, size: formatSizeGlobal(data.size || 0) }));
    } else if (data.type === 'done') {
      if (data.buildCreated) {
        pushConsoleLog(t('log.buildCreated', { name: data.build.name }));
        const idx = savedBuilds.findIndex((b) => b.id === data.build.id);
        if (idx >= 0) savedBuilds[idx] = { ...savedBuilds[idx], ...data.build };
        else savedBuilds.push(data.build);
        renderBuilds();
        updateBanner();
        updateSidebarCards();
      } else {
        pushConsoleLog(t('log.savedTo', { path: data.filePath }));
      }
    } else if (data.type === 'error') {
      pushConsoleLog(t('log.error', { msg: data.message }));
    } else if (data.kind === 'status') {
      const params = data.params || {};
      const msg = data.key ? t(data.key, { ...params, unit: t('common.mb') }) : data.message;
      pushConsoleLog(msg);
    }
  });
}

function pushConsoleLog(message: string): void {
  const text = String(message || '').trim();
  if (!text) return;
  void api?.appendConsoleLog?.(text);
}

function openConsoleLog(): void {
  api?.openConsole?.();
}

document.getElementById('tb-tasks-clear')?.addEventListener('click', (e) => {
  e.stopPropagation();
  clearAllLauncherTasks();
});

/* ── Crash Modal ── */

let lastCrashLogs: string[] = [];
let lastCrashBuild: Build | null = null;

function joinInstancePath(root: string, ...parts: string[]): string {
  const sep = root.includes('/') && !root.includes('\\') ? '/' : '\\';
  return [root.replace(/[\\/]+$/, ''), ...parts].join(sep);
}

async function showCrashModal(logs: string[], build?: Build | null): Promise<void> {
  lastCrashLogs = Array.isArray(logs) ? logs.slice() : [];
  // Важно: к моменту close/crash runningBuild уже может быть сброшен
  lastCrashBuild = build || runningBuild || lastCrashBuild;

  const sub = document.getElementById('modal-crash-sub');
  if (sub) {
    sub.textContent = lastCrashBuild
      ? t('crash.subBuild', { name: lastCrashBuild.name })
      : t('crash.sub');
  }

  const logWrap = document.getElementById('modal-crash-log-wrap');
  const logPre = document.getElementById('modal-crash-log-preview');
  const excerpt = lastCrashLogs.join('\n').trim().slice(-2400);
  if (logPre) {
    logPre.textContent = excerpt || t('crash.logEmpty');
    requestAnimationFrame(() => {
      logPre.scrollTop = logPre.scrollHeight;
    });
  }
  if (logWrap) logWrap.hidden = false;

  openModal('modal-crash');
}

async function openCrashLaunchLog(): Promise<void> {
  const build = lastCrashBuild || runningBuild;
  if (!build?.id || !api?.getInstancePath || !api?.openPath) {
    updateStatus(t('crash.noBuild'));
    return;
  }

  const instanceDir = await api.getInstancePath(build.id);
  if (!instanceDir) {
    updateStatus(t('crash.openFailed'));
    return;
  }

  const latestLog = joinInstancePath(instanceDir, 'logs', 'latest.log');
  // Пустая строка от shell.openPath = успех
  const err = await api.openPath(latestLog);
  if (!err) {
    closeModal('modal-crash');
    return;
  }

  // Fallback: сохранить буфер краша и открыть его
  const buffer = lastCrashLogs.join('\n').trim();
  if (buffer && api.saveLogFile) {
    const result = await api.saveLogFile(build.id, buffer);
    if (result?.success && result.path) {
      await api.openPath(result.path);
      closeModal('modal-crash');
      return;
    }
  }
  // Открыть папку logs, если файла ещё нет
  const logsErr = await api.openPath(joinInstancePath(instanceDir, 'logs'));
  if (logsErr) updateStatus(t('crash.openFailed'));
  else closeModal('modal-crash');
}

async function openCrashWithAgent(): Promise<void> {
  const build = lastCrashBuild || runningBuild;
  const logs = lastCrashLogs;
  closeModal('modal-crash');

  switchTab('ai');
  ensureAiTab();
  const session = createAiSession(true, {
    buildId: build?.id || null,
    title: t('crash.agentChatTitle'),
  });
  renderAiSessionList();
  renderAiConversation();
  updateAiBuildChip(session);

  const host = getAiUiHost();
  const excerpt = logs.join('\n').slice(-8000);
  appendAiCrashQuote(host, {
    buildName: build?.name || build?.id || 'build',
    logExcerpt: excerpt || '(лог пуст — вызови get_crash_report / get_latest_log)',
  });
  if (build?.id) {
    showAiCrashBanner(host, {
      buildId: build.id,
      buildName: build.name || build.id,
    });
  }

  const prompt = [
    t('crash.agentPrompt', { name: build?.name || build?.id || 'build' }),
    '',
    '```',
    excerpt || '(лог пуст — вызови get_crash_report / get_latest_log)',
    '```',
  ].join('\n');
  await sendAiMessage(prompt);
}

document.getElementById('modal-crash-close')?.addEventListener('click', () => closeModal('modal-crash'));
document.getElementById('modal-crash')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeModal('modal-crash');
});

document.getElementById('modal-crash-folder')?.addEventListener('click', async () => {
  const build = lastCrashBuild || runningBuild;
  if (!build?.id) {
    updateStatus(t('crash.noBuild'));
    return;
  }
  if (!api?.getInstancePath || !api?.openPath) {
    updateStatus(t('crash.openFailed'));
    return;
  }
  try {
    const instanceDir = await api.getInstancePath(build.id);
    if (!instanceDir) {
      updateStatus(t('crash.openFailed'));
      return;
    }
    const err = await api.openPath(instanceDir);
    if (err) updateStatus(t('crash.openFailed'));
    else closeModal('modal-crash');
  } catch {
    updateStatus(t('crash.openFailed'));
  }
});

document.getElementById('modal-crash-log')?.addEventListener('click', () => {
  void openCrashLaunchLog();
});

document.getElementById('modal-crash-agent')?.addEventListener('click', () => {
  void openCrashWithAgent();
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

// ===== Активные задачи в titlebar =====
// Процент пишется только когда в событии есть реальные total/received или счётчик файлов.

type TaskTone = 'success' | 'error' | 'info' | 'chat' | 'download';

interface LauncherTask {
  id: string;
  title: string;
  stage: string;
  percent: number | null;
  detail: string;
  /** Есть живой AbortController скачивания — крестик реально обрывает поток. */
  cancellable?: boolean;
  tone?: TaskTone;
  /** Запись истории: не исчезает сама и не крутит полоску на кнопке. */
  settled?: boolean;
}

const launcherTasks = new Map<string, LauncherTask>();
const launcherTaskTimers = new Map<string, ReturnType<typeof setTimeout>>();
const taskSeen = new Set<string>();
const taskUnseen = new Set<string>();
let tasksLeaveLock = false;

const TASK_ICON_INFO =
  '<svg class="tb-task__icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="#3b82f6"/><path fill="#fff" d="M6.4 4.6a.7.7 0 0 1 1.08-.58l5 3.4a.7.7 0 0 1 0 1.16l-5 3.4A.7.7 0 0 1 6.4 11.4V4.6Z"/></svg>';
const TASK_ICON_ERROR =
  '<svg class="tb-task__icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="#ef4444"/><path fill="#fff" d="M5.2 5.2a.7.7 0 0 1 1 0L8 6.99l1.8-1.8a.7.7 0 1 1 1 1L9 8l1.8 1.8a.7.7 0 1 1-1 1L8 9.01l-1.8 1.8a.7.7 0 1 1-1-1L6.99 8 5.2 6.2a.7.7 0 0 1 0-1Z"/></svg>';
const TASK_ICON_OK =
  '<svg class="tb-task__icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="#22c55e"/><path fill="#fff" stroke="#fff" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" d="M4.8 8.2 6.9 10.3 11.2 5.8"/></svg>';
const TASK_ICON_CHAT =
  '<svg class="tb-task__icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="rgba(255,255,255,0.72)" d="M3 3.2h10a1 1 0 0 1 1 1v6.1a1 1 0 0 1-1 1H7.1L4.2 13.6V11.3H3a1 1 0 0 1-1-1V4.2a1 1 0 0 1 1-1Z"/></svg>';
const TASK_ICON_CLOSE =
  '<svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M0 1.06066C0 0.474874 0.474874 0 1.06066 0C1.34196 0 1.61175 0.111748 1.81066 0.31066L11.6893 10.1893C11.8883 10.3883 12 10.658 12 10.9393C12 11.5251 11.5251 12 10.9393 12C10.658 12 10.3883 11.8883 10.1893 11.6893L0.31066 1.81066C0.111748 1.61175 0 1.34196 0 1.06066Z" fill="currentColor"/><path d="M1.06066 12C0.474874 12 0 11.5251 0 10.9393C0 10.658 0.111748 10.3883 0.31066 10.1893L10.1893 0.31066C10.3883 0.111748 10.658 0 10.9393 0C11.5251 0 12 0.474874 12 1.06066C12 1.34196 11.8883 1.61175 11.6893 1.81066L1.81066 11.6893C1.61175 11.8883 1.34196 12 1.06066 12Z" fill="currentColor"/></svg>';

function taskToneClass(task: LauncherTask): string {
  if (task.tone === 'error') return ' is-error';
  if (task.tone === 'success') return ' is-success';
  if (task.tone === 'chat') return ' is-chat';
  if (task.tone === 'download' && !task.settled) return ' is-download';
  return ' is-info';
}

function taskIcon(task: LauncherTask): string {
  if (task.tone === 'error') return TASK_ICON_ERROR;
  if (task.tone === 'success') return TASK_ICON_OK;
  if (task.tone === 'chat') return TASK_ICON_CHAT;
  if (task.tone === 'download' && !task.settled) return '';
  return TASK_ICON_INFO;
}

function renderLauncherTasks(): void {
  if (tasksLeaveLock) return;
  const list = document.getElementById('tb-tasks-list');
  const badge = document.getElementById('tb-tasks-badge');
  const menuOpen = document.getElementById('tb-tasks-menu')?.classList.contains('is-open');
  if (menuOpen) taskUnseen.clear();
  const unseen = taskUnseen.size;
  if (badge) {
    badge.hidden = unseen === 0;
    badge.textContent = unseen > 0 ? String(unseen) : '';
  }
  paintTasksButton();
  if (!list) return;
  if (launcherTasks.size === 0) {
    list.innerHTML = `<div class="tb-tasks-empty">${escapeHtml(t('tasks.empty'))}</div>`;
    taskSeen.clear();
    return;
  }
  const groups = new Map<string, LauncherTask[]>();
  for (const task of launcherTasks.values()) {
    const key = task.title || t('tasks.download');
    const bucket = groups.get(key);
    if (bucket) bucket.push(task);
    else groups.set(key, [task]);
  }
  const fresh = new Set<string>();
  list.innerHTML = [...groups.entries()].map(([title, tasks]) => {
    const rows = tasks.map((task) => {
      const known = !task.settled && task.percent != null && Number.isFinite(task.percent);
      const width = known ? Math.max(0, Math.min(100, Number(task.percent))) : 0;
      const showTrack = !task.settled && (known || task.tone === 'download' || task.percent === null && !task.tone);
      const enter = taskSeen.has(task.id) ? '' : ' is-enter';
      fresh.add(task.id);
      const closeBtn = task.cancellable
        ? `<button type="button" class="tb-task__cancel" data-task-cancel="${escapeHtml(task.id)}" aria-label="${escapeHtml(t('tasks.cancel'))}">${TASK_ICON_CLOSE}</button>`
        : task.settled
          ? `<button type="button" class="tb-task__dismiss" data-task-dismiss="${escapeHtml(task.id)}" aria-label="${escapeHtml(t('tasks.clear'))}">${TASK_ICON_CLOSE}</button>`
          : '';
      return `<article class="tb-task${taskToneClass(task)}${enter}" data-task-id="${escapeHtml(task.id)}">
        ${taskIcon(task)}
        <div class="tb-task__main">
          <div class="tb-task__top">
            <span class="tb-task__stage">${escapeHtml(task.stage)}</span>
            <span class="tb-task__actions">${known ? `<span class="tb-task__pct">${Math.round(width)}%</span>` : ''}${closeBtn}</span>
          </div>
          ${showTrack ? `<div class="tb-task__track"><div class="tb-task__fill${known ? '' : ' is-indet'}"${known ? ` style="width:${width}%"` : ''}></div></div>` : ''}
          ${task.detail ? `<div class="tb-task__detail">${escapeHtml(task.detail)}</div>` : ''}
        </div>
      </article>`;
    }).join('');
    return `<section class="tb-task-group"><div class="tb-task-group__title">${escapeHtml(title)}</div>${rows}</section>`;
  }).join('');
  taskSeen.clear();
  fresh.forEach((id) => taskSeen.add(id));
}

/** Сводка всех задач на полоске кнопки: средний процент, либо бегунок, если размера нет. */
function paintTasksButton(): void {
  const bar = document.getElementById('tb-tasks-bar');
  const fill = document.getElementById('tb-tasks-bar-fill');
  const btn = document.getElementById('tb-tasks-btn');
  if (!bar || !fill) return;
  const tasks = [...launcherTasks.values()].filter((task) => !task.settled);
  btn?.classList.toggle('is-busy', tasks.length > 0);
  if (tasks.length === 0) {
    bar.hidden = true;
    bar.classList.remove('is-success', 'is-error');
    fill.classList.remove('is-indet');
    fill.style.width = '0';
    return;
  }
  bar.hidden = false;
  const hasError = tasks.some((task) => task.tone === 'error');
  const allSuccess = tasks.every((task) => task.tone === 'success');
  bar.classList.toggle('is-error', hasError);
  bar.classList.toggle('is-success', !hasError && allSuccess);
  const known = tasks.filter((task) => task.percent != null && Number.isFinite(task.percent));
  if (known.length === 0) {
    fill.classList.add('is-indet');
    fill.style.width = '';
    return;
  }
  const avg = known.reduce((sum, task) => sum + Number(task.percent), 0) / known.length;
  fill.classList.remove('is-indet');
  fill.style.width = `${Math.max(0, Math.min(100, avg))}%`;
}

function upsertLauncherTask(task: LauncherTask): void {
  const pending = launcherTaskTimers.get(task.id);
  if (pending) {
    clearTimeout(pending);
    launcherTaskTimers.delete(task.id);
  }
  const menuOpen = document.getElementById('tb-tasks-menu')?.classList.contains('is-open');
  if (!launcherTasks.has(task.id) && !menuOpen) taskUnseen.add(task.id);
  launcherTasks.set(task.id, task);
  renderLauncherTasks();
}

function clearLauncherTask(id: string): void {
  const pending = launcherTaskTimers.get(id);
  if (pending) {
    clearTimeout(pending);
    launcherTaskTimers.delete(id);
  }
  taskUnseen.delete(id);
  taskSeen.delete(id);
  launcherTasks.delete(id);
  renderLauncherTasks();
}

/** Готовая задача остаётся в истории, пока её не закроют крестиком или «Очистить». */
function finishLauncherTask(id: string, _delay = 900): void {
  const task = launcherTasks.get(id);
  if (!task || task.settled) return;
  const pending = launcherTaskTimers.get(id);
  if (pending) {
    clearTimeout(pending);
    launcherTaskTimers.delete(id);
  }
  launcherTasks.delete(id);
  taskSeen.delete(id);
  taskUnseen.delete(id);
  const histId = `hist-${Date.now().toString(36)}-${id.replace(/[^\w.-]+/g, '')}`;
  const tone = task.tone === 'error' ? 'error' : task.tone === 'chat' ? 'chat' : task.tone === 'info' ? 'info' : 'success';
  launcherTasks.set(histId, {
    ...task,
    id: histId,
    settled: true,
    cancellable: false,
    tone,
    percent: tone === 'error' ? task.percent : task.percent ?? 100,
  });
  if (!document.getElementById('tb-tasks-menu')?.classList.contains('is-open')) taskUnseen.add(histId);
  renderLauncherTasks();
}

function dismissLauncherTask(id: string): void {
  const node = document.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(id)}"]`);
  const drop = () => {
    if (!launcherTasks.has(id) && !tasksLeaveLock) return;
    tasksLeaveLock = false;
    clearLauncherTask(id);
  };
  if (!node || node.classList.contains('is-leaving')) {
    clearLauncherTask(id);
    return;
  }
  tasksLeaveLock = true;
  node.classList.add('is-leaving');
  node.addEventListener('animationend', drop, { once: true });
  window.setTimeout(drop, 240);
}

function clearAllLauncherTasks(): void {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>('#tb-tasks-list .tb-task'));
  const wipe = () => {
    if (!tasksLeaveLock && launcherTasks.size === 0) return;
    tasksLeaveLock = false;
    launcherTasks.clear();
    taskSeen.clear();
    taskUnseen.clear();
    launcherTaskTimers.forEach((timer) => clearTimeout(timer));
    launcherTaskTimers.clear();
    renderLauncherTasks();
  };
  if (!nodes.length) {
    wipe();
    return;
  }
  tasksLeaveLock = true;
  let left = nodes.length;
  const step = () => {
    left -= 1;
    if (left > 0) return;
    wipe();
  };
  nodes.forEach((node, index) => {
    node.style.animationDelay = `${index * 28}ms`;
    node.classList.add('is-leaving');
    node.addEventListener('animationend', step, { once: true });
  });
  window.setTimeout(wipe, 220 + nodes.length * 28);
}

window.addEventListener('uclient-task', (event) => {
  const detail = (event as CustomEvent<Partial<LauncherTask> & { action?: string }>).detail;
  if (!detail) return;
  if (detail.action === 'settle' && detail.id) {
    finishLauncherTask(detail.id);
    return;
  }
  if (detail.action === 'clear' && detail.id) {
    clearLauncherTask(detail.id);
    return;
  }
  if (!detail.id || !detail.stage) return;
  upsertLauncherTask({
    id: detail.id,
    title: detail.title || t('tasks.download'),
    stage: detail.stage,
    percent: detail.percent ?? null,
    detail: detail.detail || '',
    cancellable: detail.cancellable,
    tone: detail.tone,
    settled: detail.settled,
  });
});

function downloadStatusCancellable(key: string): boolean {
  if (
    key === 'smp.packFile'
    || key === 'smp.downloadingPackFiles'
    || key === 'smp.packFileErr'
    || key === 'import.cfDownloading'
  ) return true;
  return key.startsWith('status.deps');
}

let taskCancelInFlight = false;

async function cancelLauncherTask(id: string): Promise<void> {
  const task = launcherTasks.get(id);
  if (!task?.cancellable || taskCancelInFlight || !api?.cancelDownloads) return;
  taskCancelInFlight = true;
  try {
    const result = await api.cancelDownloads();
    if (result?.ok) {
      clearLauncherTask('download');
      clearLauncherTask('download-batch');
    }
  } finally {
    taskCancelInFlight = false;
  }
}

function taskTitleFromKey(key: string): string {
  if (key.startsWith('import.') || key.startsWith('launchers.')) return t('tasks.import');
  if (key.startsWith('smp.') || key.startsWith('status.deps')) return t('tasks.install');
  return t('tasks.download');
}

function syncTaskFromDownload(data: any): void {
  if (!data) return;
  if (data.type === 'cancelled') {
    clearLauncherTask('download');
    clearLauncherTask('download-batch');
    return;
  }
  if (data.type === 'start') {
    const size = Number(data.size) || 0;
    downloadPrevReceived = 0;
    downloadPrevTime = Date.now();
    upsertLauncherTask({
      id: 'download',
      title: t('tasks.download'),
      stage: String(data.filename || ''),
      percent: size > 0 ? 0 : null,
      detail: size > 0 ? formatSizeGlobal(size) : '',
      cancellable: true,
    });
    return;
  }
  if (data.type === 'progress') {
    const total = Number(data.total) || 0;
    const received = Number(data.received) || 0;
    const real = total > 0;
    let speed = '';
    const now = Date.now();
    const elapsed = downloadPrevTime ? (now - downloadPrevTime) / 1000 : 0;
    if (elapsed >= 0.5) {
      speed = formatSpeedGlobal((received - downloadPrevReceived) / elapsed);
      downloadPrevReceived = received;
      downloadPrevTime = now;
    }
    const left = real ? t('tasks.left', { text: formatSizeGlobal(Math.max(0, total - received)) }) : '';
    upsertLauncherTask({
      id: 'download',
      title: launcherTasks.get('download')?.title || t('tasks.download'),
      stage: String(data.filename || ''),
      percent: real ? Math.min(100, Math.round((received / total) * 100)) : null,
      detail: [left, speed].filter(Boolean).join(' · '),
      cancellable: true,
    });
    return;
  }
  if (data.type === 'done') {
    const stage = data.buildCreated
      ? t('log.buildCreatedLabel', { name: data.build?.name || '' })
      : t('log.done', { file: data.filename || '' });
    upsertLauncherTask({
      id: 'download',
      title: launcherTasks.get('download')?.title || t('tasks.download'),
      stage,
      percent: 100,
      detail: '',
      tone: 'success',
    });
    if (launcherTasks.has('download-batch')) {
      const batch = launcherTasks.get('download-batch')!;
      upsertLauncherTask({ ...batch, percent: 100, detail: '', tone: 'success' });
    }
    finishLauncherTask('download', 3000);
    finishLauncherTask('download-batch', 3000);
    return;
  }
  if (data.type === 'error') {
    const prev = launcherTasks.get('download');
    upsertLauncherTask({
      id: 'download',
      title: t('tasks.download'),
      stage: String(data.message || ''),
      percent: prev?.percent ?? 100,
      detail: '',
      tone: 'error',
    });
    finishLauncherTask('download', 4000);
    finishLauncherTask('download-batch', 4000);
    return;
  }
  if (data.kind !== 'status') return;
  const params = data.params || {};
  const msg = data.key ? t(data.key, { ...params, unit: t('common.mb') }) : String(data.message || '');
  const total = Number(params.n);
  const done = Number(params.i);
  const hasTotal = Number.isFinite(total) && total > 0;
  const hasDone = Number.isFinite(done) && done >= 0;
  const title = taskTitleFromKey(String(data.key || ''));
  const cancellable = downloadStatusCancellable(String(data.key || ''));
  if (hasTotal && hasDone) {
    const safeDone = Math.min(done, total);
    upsertLauncherTask({
      id: 'download-batch',
      title,
      stage: params.file ? String(params.file) : msg,
      percent: Math.min(100, Math.round((safeDone / total) * 100)),
      detail: t('tasks.files', { done: safeDone, total }),
      cancellable,
      tone: data.key === 'smp.packFileErr' ? 'error' : undefined,
    });
    return;
  }
  if (hasTotal) {
    upsertLauncherTask({
      id: 'download-batch',
      title,
      stage: msg,
      percent: 0,
      detail: t('tasks.files', { done: 0, total }),
      cancellable,
    });
    return;
  }
  upsertLauncherTask({
    id: 'download',
    title,
    stage: msg,
    percent: null,
    detail: '',
    cancellable,
  });
}

function syncTaskFromLaunch(data: any): void {
  if (!data) return;
  const msg = (d: any): string => (d.key ? t(d.key, d.params) : (d.message || ''));
  if (data.kind === 'info' || data.kind === 'debug' || data.kind === 'log') return;
  if (data.kind === 'launching') {
    clearLauncherTask('launch');
    return;
  }
  if (data.kind === 'close') {
    const failed = Boolean(data.code && data.code !== 0);
    upsertLauncherTask({
      id: 'launch',
      title: t('tasks.launch'),
      stage: failed ? t('status.minecraftCrashed') : t('status.minecraftClosed'),
      percent: failed ? null : 100,
      detail: '',
      tone: failed ? 'error' : 'success',
    });
    finishLauncherTask('launch', 4000);
    return;
  }
  if (data.kind === 'download') {
    const sTotal = Number(data.total?.size) || 0;
    const sDone = Number(data.downloaded?.size) || 0;
    const aTotal = Number(data.total?.amount) || 0;
    const aDone = Number(data.downloaded?.amount) || 0;
    let percent: number | null = null;
    let detail = '';
    if (sTotal > 0) {
      percent = Math.min(100, Math.round((sDone / sTotal) * 100));
      detail = t('tasks.left', { text: formatSizeGlobal(Math.max(0, sTotal - sDone)) });
    } else if (aTotal > 0) {
      percent = Math.min(100, Math.round((aDone / aTotal) * 100));
      detail = t('tasks.files', { done: aDone, total: aTotal });
    }
    if (data.speed) {
      const speed = formatSpeedGlobal(Number(data.speed) || 0);
      detail = detail ? `${detail} · ${speed}` : speed;
    }
    upsertLauncherTask({
      id: 'launch',
      title: t('tasks.launch'),
      stage: msg(data),
      percent,
      detail,
    });
    return;
  }
  if (data.kind === 'error' || data.kind === 'crash') {
    const prev = launcherTasks.get('launch');
    upsertLauncherTask({
      id: 'launch',
      title: t('tasks.launch'),
      stage: msg(data) || t('status.minecraftCrashed'),
      percent: prev?.percent ?? 100,
      detail: '',
      tone: 'error',
    });
    finishLauncherTask('launch', 4000);
    return;
  }
  upsertLauncherTask({
    id: 'launch',
    title: t('tasks.launch'),
    stage: msg(data),
    percent: null,
    detail: '',
  });
}

function syncTaskFromCounted(id: string, title: string, stage: string, current: number, total: number): void {
  const real = total > 0;
  upsertLauncherTask({
    id,
    title,
    stage,
    percent: real ? Math.min(100, Math.round((current / total) * 100)) : null,
    detail: real ? t('tasks.files', { done: current, total }) : '',
  });
}

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

function requestCloseSplash(): void {
  if (splashClosed) return;
  closeSplash();
}

async function init(): Promise<void> {
  await setLang(localStorage.getItem('Undefined Client-language') || 'ru');
  initCustomCarets();
  applyAiTabVisibility();
  initMessenger({
    t,
    escapeHtml,
    getAccount: () => currentAccount,
    openModal,
    closeModal,
    openSettingsTab: (tab: string) => {
      openModal('modal-settings');
      queueMicrotask(() => {
        document.querySelector<HTMLElement>(`[data-settings-tab="${tab}"]`)?.click();
        if (tab === 'updates') void checkForUpdatesUI();
      });
    },
    renderMarkdown: (md: string) => sanitizeHtml(markedParse(md || '')),
    updateStatus,
    showToast: showAppToast,
    openOfficialNews: (id) => void openModalNews(id),
      getLauncherStats: () => {
      const played = savedBuilds
        .map((b) => ({ build: b, time: b.playtime || 0 }))
        .filter((x) => x.time > 0)
        .sort((a, b) => b.time - a.time);
      const fav = played[0]?.build || null;
      const last = getLastPlayedBuild();
      const srv = savedServers.length ? savedServers[savedServers.length - 1] : null;
      return {
        favoriteBuild: fav?.name || null,
        // Секунды наигранного → «вес» для отображения
        favoriteBuildCount: fav ? Math.max(1, Math.round((played[0].time || 0) / 60)) : null,
        lastBuild: last?.name || null,
        lastBuildMeta: last
          ? [last.gameVersion, last.loader].filter(Boolean).join(' · ')
          : null,
        lastServer: srv ? srv.name || srv.ip : null,
        lastServerMeta: srv?.version || (srv ? srv.ip : null),
      };
    },
    resolveBuildIcon: (name) => {
      if (!name) return null;
      const build = savedBuilds.find((b) => b.name === name);
      if (!build) return DEFAULT_BUILD_ICON_SRC;
      return build.icon ? buildIconSrc(build.icon) : DEFAULT_BUILD_ICON_SRC;
    },
    resolveServerIcon: (name) => {
      if (!name) return null;
      const q = name.toLowerCase();
      const saved = savedServers.find(
        (s) =>
          String(s.name || '').toLowerCase() === q ||
          String(s.ip || '').toLowerCase() === q ||
          savedServerAddr(s).toLowerCase() === q,
      );
      if (saved) {
        const addr = savedServerAddr(saved);
        const fav = srvTileIcon(addr, srvStatusCache[addr] || {});
        if (fav) return fav;
      }
      const cat = serverCatalog.find(
        (c) =>
          String(c.name || '').toLowerCase() === q ||
          String(srvAddr(c) || '').toLowerCase() === q,
      );
      if (cat) {
        const fav = srvTileIcon(srvAddr(cat), cat.status || srvStatusCache[srvAddr(cat)] || {});
        if (fav) return fav;
      }
      return '../../assets/icons/serverIcon.png';
    },
    listLocalBuilds: () =>
      savedBuilds.map((b) => ({
        id: b.id,
        name: b.name,
        meta: [b.gameVersion, b.loader, b.loaderVersion].filter(Boolean).join(' · '),
      })),
    openInstanceShare: (shareId) => {
      void openShareImportModal(String(shareId || ''));
    },
    createInstanceShare: async (buildId) => {
      const authorName =
        currentAccount?.username && currentAccount.username !== t('common.loading')
          ? currentAccount.username
          : 'Undefined Client';
      const result = await api?.createInstanceShare?.(buildId, { authorName });
      if (!result?.ok) return { ok: false, error: String(result?.error || 'error') };
      return { ok: true, id: result.id, url: result.url };
    },
    focusBuildByName: (name) => {
      const build = savedBuilds.find((b) => b.name === name);
      if (!build) {
        updateStatus(t('msgr.groupBuildOpenFailed'));
        return;
      }
      switchTab('builds');
      const safeId = build.id.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const card = document.querySelector(`.build-card[data-build-id="${safeId}"]`) as HTMLElement | null;
      card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card?.classList.add('is-highlight');
      window.setTimeout(() => card?.classList.remove('is-highlight'), 1600);
    },
    openModProject: (projectId) => {
      void openModalDetails(String(projectId || ''));
    },
    openCatalogServer: (address) => {
      void (async () => {
        if (!srvLoaded) await loadServerCatalog();
        openServerInfo(String(address || ''));
      })();
    },
    ensureServerCatalog: async () => {
      if (!srvLoaded) await loadServerCatalog();
    },
    listCatalogServers: () =>
      serverCatalog.slice(0, 80).map((entry) => ({
        name: entry.name,
        address: srvAddr(entry),
        icon: entry.icon ? catalogImageUrl(entry.icon) : '',
        meta: [srvAddrText(entry), entry.versions?.[0] || ''].filter(Boolean).join(' · '),
      })),
    lookupCatalogServer: (address) => {
      const key = String(address || '').toLowerCase();
      const entry = serverCatalog.find((row) => srvAddr(row) === key || srvAddrText(row).toLowerCase() === key);
      if (!entry) return null;
      return {
        name: entry.name,
        icon: entry.icon ? catalogImageUrl(entry.icon) : '',
        meta: [srvAddrText(entry), entry.versions?.[0] || '', entry.players != null ? String(entry.players) : '']
          .filter(Boolean)
          .join(' · '),
      };
    },
    getRunningBuild: () => {
      if (!runningBuild) return null;
      return {
        id: runningBuild.id,
        name: runningBuild.name,
        gameVersion: runningBuild.gameVersion,
        loader: runningBuild.loader,
      };
    },
    launchJoinServer: async (server, hint) => {
      // Предпочитаем сборку с совпадающим именем из activity друга
      if (hint?.buildName) {
        const byName = savedBuilds.find((b) => b.name === hint.buildName);
        if (byName) {
          await launchBuild(byName, {
            ip: server.ip,
            port: server.port,
            name: server.name,
          });
          return;
        }
      }
      beginServerLaunch(server.ip, server.port, server.name || server.ip);
    },
    api: api || {},
    refreshAccount: async () => {
      if (currentAccount?.uuid) await refreshAccountInBackground(currentAccount);
    },
  });

  // UAgent / соц. API: JWT Messenger поднимаем сразу, не дожидаясь вкладки чатов
  initAiAssistant();
  initSocialFeed({
    t,
    escapeHtml,
    renderMarkdown: (md: string) => renderSocialMarkdown(md || ''),
    showToast: showAppToast,
    openModal,
    closeModal,
    getAccount: () => currentAccount,
    getSkinData: (uuid) => api?.getSkinData?.(uuid) ?? Promise.resolve(null),
    getElyWornSkin: (nickname, force) => api?.getElyWornSkin?.(nickname, force) ?? Promise.resolve(null),
    resolveAvatarUrl: ({ skinUrl, uuid, username, provider }) => {
      const skin = String(skinUrl || '').trim();
      const prov = String(provider || '').toLowerCase();
      // Лицензия и Ely кропаются с живой текстуры. mc-heads отдаёт старого Steve.
      if (
        prov === 'msa' ||
        prov === 'ely' ||
        prov === 'yggdrasil' ||
        /skinsystem\.ely\.by|ely\.by\/storage|textures\.minecraft\.net/i.test(skin)
      ) {
        return '';
      }
      const id = String(uuid || '').replace(/-/g, '').toLowerCase();
      if (id.length >= 32) {
        const direct = `https://mc-heads.net/avatar/${id}/64`;
        return skinImageUrl(direct) || direct;
      }
      const name = String(username || '').trim();
      if (name) {
        const direct = `https://mc-heads.net/avatar/${encodeURIComponent(name)}/64`;
        return skinImageUrl(direct) || direct;
      }
      if (skin && !/textures\.minecraft\.net/i.test(skin)) {
        return skinImageUrl(skin) || skin;
      }
      return '';
    },
    resolveNewsCoverUrl: (url) => resolveNewsAssetUrl(url),
    messengerRequest: (payload) =>
      api?.messengerRequest?.(payload) || Promise.resolve({ ok: false, error: 'unavailable' }),
    listNewsOfficial: async () => {
      await loadNewsOfficialOnly();
      return newsPosts.map((p) => ({
        id: String(p.id),
        title: String(p.title || ''),
        summary: String((p as any).summary || (p as any).excerpt || ''),
        content: String((p as any).content || ''),
        cover: resolveNewsAssetUrl(String((p as any).cover || (p as any).image || '')),
        media: Array.isArray((p as any).media) ? (p as any).media : [],
        date: String((p as any).publishedAt || (p as any).date || ''),
        views: Number((p as any).views || 0),
      }));
    },
    noteNewsView: async (id: string) => {
      const views = await noteOfficialNewsView(id);
      return views;
    },
    openOfficialNews: (id) => {
      void openModalNews(id);
    },
    listConversationsForRepost: async () => {
      const res = await api?.messengerRequest?.({ path: '/conversations' });
      const list = res?.ok ? res.data?.conversations || res.data || [] : [];
      return (Array.isArray(list) ? list : []).map((c: any) => ({
        id: String(c.id),
        title: String(c.title || c.peer?.username || c.name || 'Чат'),
      }));
    },
    confirm: (message) => confirmAction(message),
    openUserProfile: async (username: string, userId?: string) => {
      if (userId) {
        await openProfileByUserId(userId);
        return;
      }
      await openProfileByUsername(username);
    },
    loadOfficialNews: async (force) => {
      await loadNewsOfficialOnly(Boolean(force));
    },
    renderOfficialNews: (root) => {
      renderOfficialNewsInto(root);
    },
  });

  initStartedAt = performance.now();
  setTimeout(requestCloseSplash, SPLASH_SAFETY_MS);

  // Фон главной: выбранный ролик или свой файл, без случайной смены
  const videoEl = document.getElementById('home-video-bg') as HTMLVideoElement;
  if (videoEl) {
    videoEl.muted = true;
    videoEl.loop = true;
    videoEl.playsInline = true;
    if (videoEl.dataset.wallKind !== 'image') videoEl.pause();

    // Ambient glow from video colors (low frequency, skipped when not visible)
    const glowCanvas = document.createElement('canvas');
    glowCanvas.width = 8;
    glowCanvas.height = 4;
    const glowCtx = glowCanvas.getContext('2d');
    const banner = document.getElementById('quick-banner');
    let glowTimer: any = null;
    let wallpaperRunning = false;

    function updateGlow() {
      const source: CanvasImageSource | null = videoEl.dataset.wallKind === 'image'
        ? (document.getElementById('home-image-bg') as HTMLImageElement | null)
        : videoEl;
      if (!glowCtx || !source || !wallpaperRunning) return;
      if (source instanceof HTMLVideoElement && source.readyState < 2) return;
      if (source instanceof HTMLImageElement && !source.complete) return;
      try { glowCtx.drawImage(source, 0, 0, 8, 4); } catch { return; }
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
      homeWallPlaying = true;
      if (videoEl.dataset.wallKind !== 'image') void videoEl.play().catch(() => {});
      updateGlow();
      glowTimer = setInterval(updateGlow, 4000);
    }

    function stopWallpaper() {
      if (!wallpaperRunning) return;
      wallpaperRunning = false;
      homeWallPlaying = false;
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
    let crashLogs: string[] = [];

    function pushCrashLog(line: string): void {
      crashLogs.push(line);
      if (crashLogs.length > 500) crashLogs.shift();
    }

    api.onLaunchProgress((data) => {
      syncTaskFromLaunch(data);
      const msg = (d: any): string => (d.key ? t(d.key, d.params) : (d.message || ''));
      switch (data.kind) {
        case 'info':
        case 'debug':
          pushCrashLog(msg(data));
          break;
        case 'launching':
          crashLogs = [];
          if (data?.adopted && data.buildId) {
            applyAdoptedRunningGame({
              buildId: String(data.buildId),
              name: data.name ? String(data.name) : undefined,
              gameVersion: data.gameVersion ? String(data.gameVersion) : undefined,
              loader: data.loader ? String(data.loader) : undefined,
              startedAt: data.startedAt != null ? Number(data.startedAt) : undefined,
            });
          } else if (runningBuild) {
            runningBuildStart = Date.now();
            startRunningTimer();
            updateStatus(t('status.playing', { name: runningBuild.name }));
            updateBanner();
            updateSidebarCards();
            void notifyMessengerGameRunning();
          }
          break;
        case 'log':
          pushCrashLog(msg(data));
          break;
        case 'close':
          {
            const crashedBuild = runningBuild;
            stopRunningTimer();
            notifyMessengerGameStopped();
            updateBanner();
            if (data.code && data.code !== 0) {
              void showCrashModal(crashLogs, crashedBuild);
            }
          }
          break;
        case 'crash':
          {
            const crashedBuild = runningBuild;
            stopRunningTimer();
            notifyMessengerGameStopped();
            updateBanner();
            void showCrashModal(crashLogs, crashedBuild);
          }
          break;
        case 'error':
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
      const activeUuid = api.getActiveAccount ? await api.getActiveAccount() : null;
      const preferred =
        (activeUuid && saved.find((a: any) => a.uuid === activeUuid)) || saved[saved.length - 1];
      // Аккаунт из кэша показываем сразу: обновление токена — это сетевая цепочка
      // (для MSA — несколько запросов подряд, порядка 3 с), держать на ней весь
      // старт UI нельзя. Обновление уходит в фон, запуск игры его дожидается.
      applyAccount(preferred);
      if (preferred.uuid) {
        try {
          await api.setActiveAccount?.(preferred.uuid);
        } catch {
          /* ignore */
        }
      }
      if (preferred.meta?.type === 'msa' || preferred.meta?.type === 'yggdrasil') {
        accountRefreshPromise = refreshAccountInBackground(preferred);
        // Прогрев JWT после аккаунта: UAgent и лента постов не зависят от открытия чатов
        void warmMessengerSession(true).finally(() => {
          void refreshAiAccessStatus();
          startAgentTelegramBridge();
          if (presenceTab === 'news') void loadSocialFeed(true);
        });
      } else {
        void refreshAiAccessStatus();
      }
    } else {
      showNoAccountState();
      void refreshAiAccessStatus();
    }
  } else {
    showNoAccountState();
    void refreshAiAccessStatus();
  }
  pushPresence('home');

  await loadBuilds();
  api?.onBuildsChanged?.(() => {
    void loadBuilds();
  });
  void adoptRunningGameFromMain();
  await loadServers();
  renderSavedAccounts();
  loadTheme();
  // Проверка обновлений всегда (бейдж в titlebar); автозапуск updater — по настройке
  {
    const autoLaunch = localStorage.getItem('Undefined Client-check-updates-start') !== 'false';
    void checkForUpdatesUI({ autoLaunch });
  }
  setupDownloadProgress();
  if (api?.getPlatformInfo) {
    const info = api.getPlatformInfo();
    if (info.platform === 'linux') document.body.classList.add('platform-linux');
    if (info.platform === 'win32') document.body.classList.add('platform-win32');
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

  // Список версий Minecraft для модалки сборки
  renderVersionFilterSettings();
  void ensureBuildVersionsLoaded();
  void refreshInstanceLocationSettings();

  const remaining = SPLASH_MIN_MS - (performance.now() - initStartedAt);
  setTimeout(requestCloseSplash, Math.max(0, remaining));

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

/* ===== BUILDS ===== */

const GROUP_FOLDER_SVG = `<svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M6 12C6 9.79086 7.79086 8 10 8H16.1716C16.9672 8 17.7303 8.31607 18.2929 8.87868L19.7071 10.2929C20.2697 10.8555 21.0328 11.1716 21.8284 11.1716H30C32.2091 11.1716 34 12.9625 34 15.1716V28C34 30.2091 32.2091 32 30 32H10C7.79086 32 6 30.2091 6 28V12Z" fill="currentColor" fill-opacity="0.35"/><path d="M6 16H34V28C34 30.2091 32.2091 32 30 32H10C7.79086 32 6 30.2091 6 28V16Z" fill="currentColor" fill-opacity="0.55"/></svg>`;

async function loadBuilds(): Promise<void> {
  if (api?.loadBuilds) {
    savedBuilds = await api.loadBuilds();
  }
  if (api?.loadBuildGroups) {
    try {
      const groups = await api.loadBuildGroups();
      savedBuildGroups = Array.isArray(groups) ? groups : [];
    } catch {
      savedBuildGroups = [];
    }
  }
  for (const id of [...expandedBuildGroupIds]) {
    if (!savedBuildGroups.some((g) => g.id === id)) expandedBuildGroupIds.delete(id);
  }
  renderBuilds();
  renderHomeBuilds();
  updateStats();
  updateSidebarCards();
  updateBanner();
}

function buildsInGroup(groupId: string | null): Build[] {
  if (!groupId) {
    return savedBuilds.filter((b) => !b.groupId);
  }
  return savedBuilds.filter((b) => b.groupId === groupId);
}

function groupBuildCount(groupId: string): number {
  return savedBuilds.filter((b) => b.groupId === groupId).length;
}

function groupIconHtml(group: BuildGroup): string {
  if (group.icon) {
    return `<img src="${buildIconSrc(group.icon)}" alt="" style="width:100%;height:100%;object-fit:cover;">`;
  }
  return GROUP_FOLDER_SVG;
}

function renderBuildCardHtml(b: Build, idx: number): string {
  const iconHtml = buildCardIconHtml(b);
  const isRunning = runningBuild?.id === b.id;
  const agentTouched = isBuildTouchedByAgent(b.id);
  const loaderKey = String(b.loader || 'vanilla').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const tags = [
    b.gameVersion
      ? `<span class="build-tag">${escapeHtml(String(b.gameVersion))}</span>`
      : '',
    b.loader
      ? `<span class="build-tag build-tag--loader is-${escapeHtml(loaderKey)}">${escapeHtml(String(b.loader))}</span>`
      : '',
    b.loader && b.loader !== 'vanilla' && b.loaderVersion
      ? `<span class="build-tag">${escapeHtml(String(b.loaderVersion))}</span>`
      : '',
  ]
    .filter(Boolean)
    .join('');
  return `
    <div class="build-card${isRunning ? ' running' : ''}${agentTouched ? ' build-card--agent-touched' : ''}" data-build-id="${escapeHtml(b.id)}" data-loader="${escapeHtml(loaderKey)}" style="--build-i:${idx}">
      <div class="build-card-icon">${iconHtml}</div>
      <div class="build-card-info">
        <div class="build-card-title"${agentTouched ? ` data-agent-badge="${t('ai.build.touchedByAgent').replace(/"/g, '&quot;')}"` : ''}>
          ${isRunning ? `<span class="build-running-badge">${t('btn.playing')}</span>` : ''}
          <span class="build-card-name">${escapeHtml(String(b.name || ''))}</span>
        </div>
        ${tags ? `<div class="build-card-tags">${tags}</div>` : ''}
        <div class="build-card-time${b.playtime ? '' : ' is-empty'}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
          ${b.playtime ? formatPlaytime(b.playtime) : escapeHtml(t('builds.neverLaunched') || 'Ещё не запускалась')}
        </div>
      </div>
      <div class="build-card-actions">
        <button class="build-card-btn launch-btn${isRunning ? ' is-running' : ''}" data-build-id="${escapeHtml(b.id)}" title="${escapeHtml(isRunning ? t('btn.playing') : t('btn.launch'))}" aria-label="${escapeHtml(isRunning ? t('btn.playing') : t('btn.launch'))}"${runningBuild ? ' disabled' : ''}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M0 1.61803C0 0.724419 0.724419 0 1.61803 0C1.86923 0 2.11697 0.058484 2.34164 0.17082L13.1056 5.55279C13.6537 5.82687 14 6.38713 14 7C14 7.61287 13.6537 8.17313 13.1056 8.44721L2.34164 13.8292C2.11697 13.9415 1.86923 14 1.61803 14C0.724419 14 0 13.2756 0 12.382V1.61803Z" fill="currentColor"/></svg>
        </button>
        <div class="build-card-toolrow">
          <button class="build-card-btn build-share-btn" data-build-id="${escapeHtml(b.id)}" title="${t('btn.share')}" aria-label="${t('btn.share')}">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M0 11C0 10.4477 0.447715 10 1 10C1.55228 10 2 10.4477 2 11C2 11.5523 2.44772 12 3 12H11C11.5523 12 12 11.5523 12 11C12 10.4477 12.4477 10 13 10C13.5523 10 14 10.4477 14 11C14 12.6569 12.6569 14 11 14H3C1.34315 14 0 12.6569 0 11Z" fill="currentColor"/><path d="M1.47749 6.84591C1.10637 6.45548 1.10656 5.82238 1.47749 5.43183L6.35592 0.292896C6.72714 -0.0976319 7.32887 -0.0976319 7.70008 0.292896L12.571 5.42819C12.9419 5.81874 12.9421 6.45184 12.571 6.84226C12.1998 7.23269 11.598 7.23249 11.2268 6.84226L7.97857 3.41401V8.99999C7.97857 9.55228 7.55299 10 7.028 10C6.50302 10 6.07744 9.55228 6.07744 8.99999V3.41401L2.82165 6.84591C2.45041 7.23614 1.84862 7.23633 1.47749 6.84591Z" fill="currentColor"/></svg>
          </button>
          <button class="build-card-btn build-manage-btn" data-build-id="${escapeHtml(b.id)}" title="${t('btn.manage')}" aria-label="${t('btn.manage')}">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M12.0012 0.31162C11.5857 -0.103873 10.9121 -0.103873 10.4966 0.31162L10.185 0.62324L13.3768 3.81505L13.6884 3.50343C14.1039 3.08794 14.1039 2.41429 13.6884 1.9988L12.0012 0.31162ZM12.3128 4.87899L9.12101 1.68718L4.86527 5.94292L4.01637 9.33853C3.91897 9.72813 4.27187 10.081 4.66147 9.98363L8.05708 9.13473L12.3128 4.87899Z" fill="currentColor"/><path d="M0 3C0 1.34315 1.34315 0 3 0H5C5.55228 0 6 0.447715 6 1C6 1.55228 5.55228 2 5 2H3C2.44772 2 2 2.44772 2 3V11C2 11.5523 2.44772 12 3 12H11C11.5523 12 12 11.5523 12 11V9C12 8.44772 12.4477 8 13 8C13.5523 8 14 8.44772 14 9V11C14 12.6569 12.6569 14 11 14H3C1.34315 14 0 12.6569 0 11V3Z" fill="currentColor"/></svg>
          </button>
          <button class="build-card-btn danger build-delete-btn" data-build-id="${escapeHtml(b.id)}" title="${t('btn.delete')}" aria-label="${t('btn.delete')}">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 1C4 0.447715 4.44772 0 5 0H9C9.55228 0 10 0.447715 10 1H4Z" fill="currentColor"/><path d="M1 2C1 1.44772 1.44772 1 2 1H12C12.5523 1 13 1.44772 13 2C13 2.55228 12.5523 3 12 3H2C1.44772 3 1 2.55228 1 2Z" fill="currentColor"/><path d="M2.10995 5.09951C2.05108 4.51082 2.51337 4 3.10499 4H10.895C11.4866 4 11.9489 4.51082 11.89 5.0995L11.09 13.0995C11.0389 13.6107 10.6088 14 10.095 14H3.90499C3.39124 14 2.96107 13.6107 2.90995 13.0995L2.10995 5.09951Z" fill="currentColor"/></svg>
          </button>
        </div>
      </div>
    </div>`;
}

function renderGroupSectionHtml(g: BuildGroup, idx: number): string {
  const count = groupBuildCount(g.id);
  const countLabel = t('builds.groupCount', { count }) || `${count}`;
  const expanded = expandedBuildGroupIds.has(g.id);
  const members = buildsInGroup(g.id);
  let memberIdx = 0;
  const bodyInner = members.length
    ? `<div class="build-group-section__grid builds-grid">${members.map((b) => renderBuildCardHtml(b, memberIdx++)).join('')}</div>`
    : `<div class="build-group-section__empty">${escapeHtml(t('builds.groupEmpty') || 'В этой группе пока нет сборок')}</div>`;
  return `
    <section class="build-group-section${expanded ? ' is-expanded' : ''}" data-group-id="${escapeHtml(g.id)}" style="--build-i:${idx}">
      <div class="build-group-section__header">
        <button type="button" class="build-group-section__toggle" data-group-toggle="${escapeHtml(g.id)}" aria-expanded="${expanded ? 'true' : 'false'}">
          <span class="build-group-section__icon">${groupIconHtml(g)}</span>
          <span class="build-group-section__info">
            <span class="build-group-section__name">${escapeHtml(g.name)}</span>
            <span class="build-group-section__meta">${escapeHtml(countLabel)}</span>
          </span>
          <span class="build-group-section__chevron" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </span>
        </button>
        <button type="button" class="build-group-section__edit" data-group-edit="${escapeHtml(g.id)}" title="${escapeHtml(t('builds.editGroup') || 'Управление')}" aria-label="${escapeHtml(t('builds.editGroup') || 'Управление')}">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M12.0012 0.31162C11.5857 -0.103873 10.9121 -0.103873 10.4966 0.31162L10.185 0.62324L13.3768 3.81505L13.6884 3.50343C14.1039 3.08794 14.1039 2.41429 13.6884 1.9988L12.0012 0.31162ZM12.3128 4.87899L9.12101 1.68718L4.86527 5.94292L4.01637 9.33853C3.91897 9.72813 4.27187 10.081 4.66147 9.98363L8.05708 9.13473L12.3128 4.87899Z" fill="currentColor"/><path d="M0 3C0 1.34315 1.34315 0 3 0H5C5.55228 0 6 0.447715 6 1C6 1.55228 5.55228 2 5 2H3C2.44772 2 2 2.44772 2 3V11C2 11.5523 2.44772 12 3 12H11C11.5523 12 12 11.5523 12 11V9C12 8.44772 12.4477 8 13 8C13.5523 8 14 8.44772 14 9V11C14 12.6569 12.6569 14 11 14H3C1.34315 14 0 12.6569 0 11V3Z" fill="currentColor"/></svg>
        </button>
      </div>
      <div class="build-group-section__collapse">
        <div class="build-group-section__body">${bodyInner}</div>
      </div>
    </section>`;
}

function toggleBuildGroupExpand(groupId: string, section?: HTMLElement | null): void {
  const el =
    section ||
    document.querySelector<HTMLElement>(`.build-group-section[data-group-id="${CSS.escape(groupId)}"]`);
  const willExpand = !expandedBuildGroupIds.has(groupId);
  if (willExpand) expandedBuildGroupIds.add(groupId);
  else expandedBuildGroupIds.delete(groupId);

  if (!el) {
    renderBuilds();
    return;
  }

  el.classList.toggle('is-expanded', willExpand);
  const toggleBtn = el.querySelector<HTMLElement>('[data-group-toggle]');
  if (toggleBtn) toggleBtn.setAttribute('aria-expanded', willExpand ? 'true' : 'false');
}

function bindBuildCardActions(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('.launch-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const build = savedBuilds.find((b) => b.id === btn.getAttribute('data-build-id'));
      if (build) await launchBuild(build);
    });
  });
  root.querySelectorAll<HTMLElement>('.build-share-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const build = savedBuilds.find((b) => b.id === btn.getAttribute('data-build-id'));
      if (build) openBuildShareMenu(btn, build);
    });
  });
  root.querySelectorAll<HTMLElement>('.build-manage-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const build = savedBuilds.find((b) => b.id === btn.getAttribute('data-build-id'));
      if (build) openModalBuild(build);
    });
  });
  root.querySelectorAll<HTMLElement>('.build-delete-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-build-id');
      if (!id) return;
      const build = savedBuilds.find((b) => b.id === id);
      if (build && (await confirmAction(t('confirm.deleteBuild', { name: build.name })))) {
        const res = api?.removeBuild ? await api.removeBuild(id) : true;
        if (res && typeof res === 'object' && res.ok === false) {
          showAppToast(t('build.deleteFilesFailed'));
        }
        await loadBuilds();
      }
    });
  });
  root.querySelectorAll<HTMLElement>('[data-group-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-group-toggle');
      if (!id) return;
      const section = btn.closest<HTMLElement>('.build-group-section');
      toggleBuildGroupExpand(id, section);
    });
  });
  root.querySelectorAll<HTMLElement>('[data-group-edit]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-group-edit');
      if (id) void openModalBuildGroup(id);
    });
  });
}

function renderBuilds(): void {
  const list = document.getElementById('builds-list');
  if (!list) return;
  // Вынимаем строку переноса до innerHTML, иначе вместе со списком пропадёт и обработчик клика.
  const transferHost = document.getElementById('external-launchers');
  transferHost?.remove();

  const groups = [...savedBuildGroups].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name),
  );
  const ungrouped = buildsInGroup(null);

  if (savedBuilds.length === 0 && groups.length === 0) {
    list.className = 'builds-list';
    list.innerHTML = `
      <div class="builds-empty">
        <img src="../../assets/icons/newBuild.svg" width="56" height="56" alt="" aria-hidden="true">
        <div>${t('builds.empty')}</div>
        <button class="action-btn" id="builds-empty-create"><span>${t('builds.add')}</span></button>
      </div>`;
    mountExternalLaunchersRow(list);
    document.getElementById('builds-empty-create')?.addEventListener('click', () => openModalBuild());
    return;
  }

  list.className = 'builds-list';
  let idx = 0;
  const parts: string[] = [];
  for (const g of groups) {
    parts.push(renderGroupSectionHtml(g, idx++));
  }
  if (ungrouped.length) {
    parts.push(
      `<div class="builds-grid builds-grid--root">${ungrouped.map((b) => renderBuildCardHtml(b, idx++)).join('')}</div>`,
    );
  }
  list.innerHTML = parts.join('');
  // Строка переноса — первая в том же списке, что и группы, а не отдельный скрытый блок над ним.
  mountExternalLaunchersRow(list);
  bindBuildCardActions(list);
}

function mountExternalLaunchersRow(list: HTMLElement): void {
  let host = document.getElementById('external-launchers');
  if (!host) {
    host = document.createElement('div');
    host.id = 'external-launchers';
    host.className = 'ext-launchers hidden';
    bindExternalLaunchersClicks(host);
  }
  list.prepend(host);
  void refreshExternalLaunchers();
}

function bindExternalLaunchersClicks(host: HTMLElement): void {
  host.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const toggle = target.closest<HTMLElement>('[data-ext-toggle]');
    if (toggle) {
      const open = host.classList.toggle('is-expanded');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      return;
    }
    const allBtn = target.closest<HTMLElement>('[data-import-all]');
    if (allBtn) {
      const id = allBtn.getAttribute('data-import-all') || '';
      const ids = Array.from(host.querySelectorAll<HTMLElement>(`.ext-launcher[data-launcher="${id}"] [data-instance]`))
        .map((el) => el.getAttribute('data-instance') || '')
        .filter(Boolean);
      void importExternalSelection(id, ids);
      return;
    }
    const one = target.closest<HTMLElement>('[data-import-one]');
    if (!one) return;
    const launcherId = one.getAttribute('data-import-one') || '';
    const instanceId = one.getAttribute('data-instance') || '';
    void importExternalSelection(launcherId, instanceId ? [instanceId] : []);
  });
}

function setGroupIconPreview(icon: string | undefined): void {
  const preview = document.getElementById('modal-build-group-icon-preview');
  if (!preview) return;
  if (!icon) {
    preview.innerHTML = GROUP_FOLDER_SVG;
    return;
  }
  preview.innerHTML = `<img src="${buildIconSrc(icon)}" style="width:100%;height:100%;object-fit:cover;" alt="">`;
}

async function ensureGroupIconGrid(): Promise<void> {
  const grid = document.getElementById('modal-build-group-icon-grid');
  if (!grid) return;
  let files: string[] = [];
  try {
    files = (await api?.listInstanceIcons?.()) || [];
  } catch {
    files = [];
  }
  const selectedName = pendingGroupIcon?.startsWith('preset:')
    ? pendingGroupIcon.slice(7)
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
    img.addEventListener('click', () => {
      grid.querySelectorAll('.be-icon-opt.selected').forEach((e) => e.classList.remove('selected'));
      img.classList.add('selected');
      pendingGroupIcon = `preset:${filename}`;
      setGroupIconPreview(pendingGroupIcon);
      const fileInput = document.getElementById('modal-build-group-icon-input') as HTMLInputElement | null;
      if (fileInput) fileInput.value = '';
    });
    grid.appendChild(img);
  }
}

function renderGroupMemberChecks(selectedIds: Set<string>): void {
  const box = document.getElementById('modal-build-group-builds');
  if (!box) return;
  if (!savedBuilds.length) {
    box.innerHTML = `<div class="build-group-builds__empty">${escapeHtml(t('builds.none') || 'Нет сборок')}</div>`;
    return;
  }
  box.innerHTML = savedBuilds
    .map((b) => {
      const checked = selectedIds.has(b.id) ? ' checked' : '';
      const otherGroup =
        b.groupId && b.groupId !== editingBuildGroupId
          ? savedBuildGroups.find((g) => g.id === b.groupId)
          : null;
      const hint = otherGroup
        ? `<span class="build-group-builds__hint">${escapeHtml(otherGroup.name)}</span>`
        : '';
      return `<label class="build-group-builds__row">
        <input type="checkbox" data-group-build="${escapeHtml(b.id)}"${checked}>
        <span class="build-group-builds__icon">${buildCardIconHtml(b)}</span>
        <span class="build-group-builds__name">${escapeHtml(b.name)}</span>
        ${hint}
      </label>`;
    })
    .join('');
}

async function openModalBuildGroup(groupId?: string | null): Promise<void> {
  editingBuildGroupId = groupId || null;
  const group = groupId ? savedBuildGroups.find((g) => g.id === groupId) : null;
  pendingGroupIcon = group?.icon || undefined;
  const title = document.getElementById('modal-build-group-title');
  if (title) {
    title.textContent = group
      ? t('builds.groupEditTitle') || 'Управление группой'
      : t('builds.groupCreateTitle') || 'Новая группа';
  }
  const nameInput = document.getElementById('modal-build-group-name') as HTMLInputElement | null;
  if (nameInput) nameInput.value = group?.name || '';
  const delBtn = document.getElementById('modal-build-group-delete');
  delBtn?.classList.toggle('hidden', !group);
  setGroupIconPreview(pendingGroupIcon);
  await ensureGroupIconGrid();
  const selected = new Set<string>();
  if (group) {
    for (const b of savedBuilds) {
      if (b.groupId === group.id) selected.add(b.id);
    }
  }
  renderGroupMemberChecks(selected);
  openModal('modal-build-group');
  nameInput?.focus();
}

function closeModalBuildGroup(): void {
  closeModal('modal-build-group');
  editingBuildGroupId = null;
  pendingGroupIcon = undefined;
}

async function submitBuildGroup(): Promise<void> {
  const nameInput = document.getElementById('modal-build-group-name') as HTMLInputElement | null;
  const name = String(nameInput?.value || '').trim();
  if (!name) {
    showAppToast(t('builds.groupNameRequired') || 'Введите название группы');
    nameInput?.focus();
    return;
  }
  const id = editingBuildGroupId || `grp-${Date.now()}`;
  const selected = new Set<string>();
  document.querySelectorAll<HTMLInputElement>('#modal-build-group-builds input[data-group-build]').forEach((el) => {
    if (el.checked) selected.add(el.getAttribute('data-group-build') || '');
  });
  const group: BuildGroup = {
    id,
    name,
    icon: pendingGroupIcon,
    order: savedBuildGroups.find((g) => g.id === id)?.order ?? savedBuildGroups.length,
  };
  if (api?.saveBuildGroup) await api.saveBuildGroup(group);

  // Обновляем membership сборок
  for (const b of savedBuilds) {
    const shouldBeIn = selected.has(b.id);
    const wasIn = b.groupId === id;
    if (shouldBeIn && !wasIn) {
      b.groupId = id;
      if (api?.saveBuild) await api.saveBuild(b);
    } else if (!shouldBeIn && wasIn) {
      b.groupId = null;
      if (api?.saveBuild) await api.saveBuild(b);
    }
  }

  expandedBuildGroupIds.add(id);
  closeModalBuildGroup();
  await loadBuilds();
  showAppToast(t('builds.groupSaved') || 'Группа сохранена');
}

async function deleteBuildGroupCurrent(): Promise<void> {
  if (!editingBuildGroupId) return;
  const group = savedBuildGroups.find((g) => g.id === editingBuildGroupId);
  if (!group) return;
  if (!(await confirmAction(t('confirm.deleteGroup', { name: group.name }) || `Удалить группу «${group.name}»? Сборки останутся.`))) {
    return;
  }
  if (api?.removeBuildGroup) await api.removeBuildGroup(editingBuildGroupId);
  if (editingBuildGroupId) expandedBuildGroupIds.delete(editingBuildGroupId);
  closeModalBuildGroup();
  await loadBuilds();
  showAppToast(t('builds.groupDeleted') || 'Группа удалена');
}

function renderHomeBuilds(): void {
  const container = document.getElementById('home-builds-list');
  if (!container) return;
  const recent = savedBuilds.slice(-5).reverse();
  if (recent.length === 0) {
    container.innerHTML = `<div class="home-empty">
      <div class="home-empty__title">${escapeAiHtml(t('home.empty.buildsTitle'))}</div>
      <div class="home-empty__desc">${escapeAiHtml(t('home.empty.buildsDesc'))}</div>
      <button type="button" class="home-empty__btn" data-home-empty="add-build">${escapeAiHtml(t('home.empty.buildsCta'))}</button>
    </div>`;
    container.querySelector<HTMLElement>('[data-home-empty="add-build"]')?.addEventListener('click', () => {
      switchTab('builds');
      openModalBuild();
    });
    return;
  }
  container.innerHTML = recent.map(b => {
    const iconHtml = buildCardIconHtml(b);
    return `<div class="home-row${runningBuild?.id === b.id ? ' running' : ''}" data-build-id="${b.id}">
      <div class="home-row-icon" style="background:transparent">${iconHtml}</div>
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
document.getElementById('add-build-group-btn')?.addEventListener('click', () => void openModalBuildGroup());
document.getElementById('import-build-btn')?.addEventListener('click', () => openModalImport());
document.getElementById('modal-build-group-close')?.addEventListener('click', () => closeModalBuildGroup());
document.getElementById('modal-build-group-cancel')?.addEventListener('click', () => closeModalBuildGroup());
document.getElementById('modal-build-group-ok')?.addEventListener('click', () => void submitBuildGroup());
document.getElementById('modal-build-group-delete')?.addEventListener('click', () => void deleteBuildGroupCurrent());
document.getElementById('modal-build-group')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeModalBuildGroup();
});
document.getElementById('modal-build-group-icon-upload')?.addEventListener('click', () => {
  document.getElementById('modal-build-group-icon-input')?.click();
});
document.getElementById('modal-build-group-icon-input')?.addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    pendingGroupIcon = dataUrl;
    setGroupIconPreview(dataUrl);
    document.querySelectorAll('#modal-build-group-icon-grid .be-icon-opt.selected').forEach((el) => {
      el.classList.remove('selected');
    });
  } catch {
    /* ignore */
  }
  input.value = '';
});
document.getElementById('build-form-cancel')?.addEventListener('click', () => closeModalBuildModal());
document.getElementById('build-form-submit')?.addEventListener('click', () => submitModalBuild());

const colors = ['#7BD4B7', '#FF6B6B', '#4ECDC4', '#FFD93D', '#70ADDF', '#C084FC', '#FB923C', '#F472B6'];

function populateLoaderVersions(loader: string, mcVersion: string): void {
  const verSelect = document.getElementById('modal-build-loader-ver') as HTMLSelectElement | null;
  const verMenu = document.getElementById('modal-build-loader-ver-menu');
  const verField = document.getElementById('modal-build-loader-ver-field');
  const isVanilla = loader === 'vanilla';
  if (verField) verField.style.display = isVanilla ? 'none' : '';
  if (isVanilla) {
    if (verSelect) {
      verSelect.innerHTML = '';
      verSelect.value = '';
    }
    if (verMenu) verMenu.innerHTML = '';
    const wrap = verSelect?.closest('.stngs-select-wrap') as HTMLElement | null;
    if (wrap) syncSelectUI(wrap);
    return;
  }
  if (!api?.getLoaderVersions || !verSelect || !verMenu) return;
  const hint = document.getElementById('modal-build-loader-ver-hint');
  if (hint) {
    hint.textContent = t('loader.loading');
    hint.classList.remove('hidden');
  }
  api.getLoaderVersions(loader, mcVersion).then((raw) => {
    const currentLoader = (document.getElementById('modal-build-loader') as HTMLSelectElement)?.value;
    if (currentLoader !== loader) return;
    const payload = Array.isArray(raw)
      ? { versions: raw, error: '', unavailable: false }
      : {
        versions: Array.isArray(raw?.versions) ? raw.versions : [],
        error: String(raw?.error || ''),
        unavailable: !!raw?.unavailable,
      };
    const list = payload.versions.map((v) => String(v));
    const prev = verSelect.value;
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    verSelect.innerHTML = list.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
    verMenu.innerHTML = list.map((v) => `<div class="stngs-select-opt" data-value="${esc(v)}">${esc(v)}</div>`).join('');
    if (prev && list.includes(prev)) verSelect.value = prev;
    else if (list.length > 0) verSelect.value = list[0];
    const wrap = verSelect.closest('.stngs-select-wrap') as HTMLElement | null;
    if (wrap) syncSelectUI(wrap);
    if (hint) {
      if (list.length) {
        hint.textContent = '';
        hint.classList.add('hidden');
      } else if (payload.error && !payload.unavailable) {
        hint.textContent = payload.error;
        hint.classList.remove('hidden');
      } else {
        hint.textContent = t('loader.none', { loader, version: mcVersion });
        hint.classList.remove('hidden');
      }
    }
  }).catch((err) => {
    if (hint) {
      hint.textContent = err instanceof Error ? err.message : String(err || t('loader.failed'));
      hint.classList.remove('hidden');
    }
  });
}

let detectedJava: { name: string; path: string; version: number; managed?: boolean }[] = [];

async function populateJavaOptions(force = false): Promise<void> {
  const select = document.getElementById('modal-build-java') as HTMLSelectElement;
  const menu = document.getElementById('modal-build-java-menu');
  if (!select || !menu) return;
  if ((force || detectedJava.length === 0) && api?.detectJava) {
    try {
      detectedJava = (await api.detectJava(force)) || [];
    } catch {
      detectedJava = [];
    }
  }
  appendJavaOptions(select, menu);
}

function appendJavaOptions(select: HTMLSelectElement, menu: HTMLElement): void {
  menu.querySelectorAll<HTMLElement>('.stngs-select-opt[data-java-dyn]').forEach(o => o.remove());
  select.querySelectorAll<HTMLOptionElement>('option[data-java-dyn]').forEach(o => o.remove());
  for (const j of detectedJava) {
    const kind = j.managed ? t('jm.managed') : t('jm.system');
    const label = `Java ${j.version} · ${j.name} (${kind})`;
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
    item.title = j.path;
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
  canInstall?: boolean;
  names?: string[];
}

let javaManagerData: JavaVersionInfo[] = [];
let javaBusy: Record<number, boolean> = {};
let javaProgressCleanup: (() => void) | null = null;

function truncateJavaPath(p: string, max = 42): string {
  if (!p) return '';
  if (p.length <= max) return p;
  return `…${p.slice(-(max - 1))}`;
}

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
    else if (j.systemPaths.length > 1) metaParts.push(t('jm.systemFound', { n: String(j.systemPaths.length) }));
    if (!j.installed) metaParts.push(t('jm.available'));
    const pathText = j.installed && j.path ? j.path : '';
    const canInstall = j.canInstall !== false;
    // Установить managed-копию можно, даже если есть системная
    const installDisabled = !canInstall || j.managed || !!busy;
    const removeDisabled = !j.managed || !!busy;
    return `
      <div class="list-row" data-java-ver="${j.version}">
        <div class="java-row-badge ${j.installed ? 'installed' : ''}">${j.version}</div>
        <div class="list-row-info">
          <div class="java-row-title">Java ${j.version}</div>
          <div class="list-row-meta">${metaParts.join(' · ')}</div>
        </div>
        <div class="java-row-path" title="${escapeHtml(pathText)}">${escapeHtml(truncateJavaPath(pathText))}</div>
        <div class="java-row-status ${statusCls}">${statusText}</div>
        <div class="java-row-actions">
          <button class="list-row-btn java-install-btn" data-java-ver="${j.version}" ${installDisabled ? 'disabled' : ''}>${t('jm.install')}</button>
          <button class="list-row-btn danger java-remove-btn" data-java-ver="${j.version}" ${removeDisabled ? 'disabled' : ''}>${t('jm.remove')}</button>
        </div>
      </div>`;
  }).join('');
}

async function refreshJavaManager(force = true): Promise<void> {
  if (!api?.listJavaVersions) return;
  try {
    javaManagerData = await api.listJavaVersions(force);
  } catch {
    javaManagerData = [];
  }
  renderJavaManager(javaManagerData);
  try {
    detectedJava = (await api.detectJava?.(false)) || [];
  } catch {
    detectedJava = [];
  }
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
        clearLauncherTask(`java-${version}`);
        void refreshJavaManager(true);
        return;
      }
      javaBusy[version] = true;
      upsertLauncherTask({
        id: `java-${version}`,
        title: t('tasks.java', { v: version }),
        stage: data.status === 'extract' ? t('jm.extracting') : t('jm.downloading'),
        percent: null,
        detail: '',
      });
      const statusEl = container.querySelector<HTMLElement>(`.list-row[data-java-ver="${version}"] .java-row-status`);
      if (statusEl) {
        statusEl.className = 'java-row-status busy';
        statusEl.textContent = data.status === 'extract' ? t('jm.extracting') : t('jm.downloading');
      }
    });
  }
  document.getElementById('java-manager-rescan')?.addEventListener('click', () => {
    void refreshJavaManager(true);
  });
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
      await refreshJavaManager(true);
    } else if (btn.classList.contains('java-remove-btn')) {
      if (!await confirmAction(t('jm.removeConfirm', { ver: String(version) }))) return;
      javaBusy[version] = true;
      renderJavaManager(javaManagerData);
      const result = await api?.removeJava?.(version);
      javaBusy[version] = false;
      if (!result?.success) updateStatus(result?.error ? String(result.error) : t('jm.removeFailed'));
      await refreshJavaManager(true);
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
  const javaCustomRow = document.getElementById('be-java-custom-row');
  if (!select) return;
  if (select.value !== lastAutoJavaPath) {
    javaManualChoice = true;
    javaAutoApplied = false;
    setJavaAutoHint('', '', false);
  }
  if (javaCustomRow) javaCustomRow.classList.toggle('hidden', select.value !== '__custom');
});

document.getElementById('be-java-browse')?.addEventListener('click', async () => {
  if (!api?.pickJava) return;
  const picked = await api.pickJava();
  if (!picked?.path) return;
  const pathInput = document.getElementById('modal-build-java-path') as HTMLInputElement | null;
  const select = document.getElementById('modal-build-java') as HTMLSelectElement | null;
  const javaCustomRow = document.getElementById('be-java-custom-row');
  if (pathInput) pathInput.value = picked.path;
  if (select) {
    select.value = '__custom';
    const wrap = select.closest('.stngs-select-wrap');
    if (wrap) syncSelectUI(wrap as HTMLElement);
  }
  if (javaCustomRow) javaCustomRow.classList.remove('hidden');
  javaManualChoice = true;
  javaAutoApplied = false;
  setJavaAutoHint(
    picked.version > 0 ? t('jm.compatibleSelected', { ver: String(picked.version) }) : '',
    picked.version > 0 ? 'ok' : '',
    picked.version > 0,
  );
  if (picked.version > 0 && !detectedJava.some((j) => j.path === picked.path)) {
    detectedJava.push({
      name: picked.name || `Java ${picked.version}`,
      path: picked.path,
      version: picked.version,
      managed: false,
    });
    if (select) {
      const menu = document.getElementById('modal-build-java-menu');
      if (menu) appendJavaOptions(select, menu);
    }
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

/** После установки модпака из каталога обновить кнопку сервера, если модалка ещё открыта. */
let afterContentInstall: (() => void) | null = null;
// Установка из каталога плагинов своего сервера: та же модалка версий, другой приёмник.
let hostCatalogInstall: ((version: any) => Promise<void> | void) | null = null;
let versionsPreferGame = '';
let versionsPreferLoader = '';
let versionsHostLock = false;

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
  source?: 'librium' | 'modrinth' | 'undefined' | '';
  banner?: string;
  screenshots?: string[];
  language?: string;
  players?: number | null;
  maxPlayers?: number | null;
  online?: boolean | null;
  rating?: number | null;
  reviews?: number | null;
  followers?: number | null;
  joins?: number | null;
  modpackName?: string;
  modpackIcon?: string;
  modpackProjectId?: string;
  modpackVersionId?: string;
  modpackVersion?: string;
  modpackGame?: string;
  modpackLoader?: string;
  modpackSummary?: string;
  modpackResolved?: boolean;
  projectUrl?: string;
  projectId?: string;
  serverId?: string;
  remoteHistory?: {
    period: string;
    points: { t: string; online: number }[];
    peak: number;
    min: number;
    avg: number;
    uptime: number | null;
    peakAt: string;
    minAt: string;
  } | null;
  detailTried?: boolean;
  chartPeriod?: string;
  localPort?: number;
  localProbeAt?: number;
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
let srvSort = 'relevance';
let srvRegion = 'all';
let srvOnlineOnly = false;
let srvSource = 'all';
let srvLang = '';
let srvRenderedCount = 0;
let srvOfflineAddrs: Record<string, boolean> = {};
let srvStatusCache: Record<string, any> = {};
let srvRefreshTimer: any = null;
let srvLoading = false;
let srvLoaded = false;

function srvEsc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function srvCompact(n: number): string {
  const v = Math.max(0, Math.round(Number(n) || 0));
  if (v >= 1000) {
    const k = v / 1000;
    const text = (k >= 10 ? k.toFixed(0) : k.toFixed(1)).replace('.', ',');
    return `${text} тыс.`;
  }
  return String(v);
}

const SRV_LANG_NAMES: Record<string, string> = {
  ru: 'Русский', en: 'Английский', uk: 'Украинский', be: 'Белорусский',
  de: 'Немецкий', fr: 'Французский', es: 'Испанский', pt: 'Португальский',
  pl: 'Польский', tr: 'Турецкий', zh: 'Китайский', ja: 'Японский', ko: 'Корейский',
};

function srvLangName(code: string): string {
  const key = String(code || '').toLowerCase().slice(0, 2);
  return SRV_LANG_NAMES[key] || String(code || '');
}

function srvSkeletonHtml(): string {
  return Array.from({ length: 8 }, () => '<div class="scat-skel"></div>').join('');
}

const SRV_HIST_KEY = 'uc-srv-online-hist';

function srvReadHist(): Record<string, unknown[]> {
  try {
    const raw = JSON.parse(localStorage.getItem(SRV_HIST_KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

function srvReadPoints(id: string): { t: string; n: number }[] {
  const row = srvReadHist()[id];
  if (!Array.isArray(row)) return [];
  const now = Date.now();
  return row.map((item, index) => {
    if (item && typeof item === 'object') {
      const point = item as { t?: unknown; n?: unknown };
      const n = Math.max(0, Math.round(Number(point.n)));
      const t = String(point.t || '');
      if (t && Number.isFinite(n)) return { t, n };
    }
    const n = Math.max(0, Math.round(Number(item)));
    return {
      t: new Date(now - (row.length - 1 - index) * 60_000).toISOString(),
      n: Number.isFinite(n) ? n : 0,
    };
  }).filter((point) => point.t).slice(-240);
}

function srvPushHistory(id: string, value: number): void {
  if (!id || !Number.isFinite(value)) return;
  const all = srvReadHist();
  const row = srvReadPoints(id);
  const next = Math.max(0, Math.round(value));
  const now = Date.now();
  const last = row[row.length - 1];
  if (last && last.n === next && now - new Date(last.t).getTime() < 60_000) return;
  row.push({ t: new Date(now).toISOString(), n: next });
  all[id] = row.slice(-240);
  try { localStorage.setItem(SRV_HIST_KEY, JSON.stringify(all)); } catch { /* квота хранилища */ }
}

function srvLocalSeries(id: string, periodRaw: string): NonNullable<CatalogServerEntry['remoteHistory']> {
  const period = periodRaw === '7d' || periodRaw === '30d' ? periodRaw : '24h';
  const span = period === '30d' ? 30 : period === '7d' ? 7 : 1;
  const from = Date.now() - span * 86_400_000;
  const points = srvReadPoints(id)
    .filter((point) => new Date(point.t).getTime() >= from)
    .map((point) => ({ t: point.t, online: point.n }));
  const values = points.map((point) => point.online);
  const peak = values.length ? Math.max(...values) : 0;
  const min = values.length ? Math.min(...values) : 0;
  const avg = values.length ? values.reduce((sum, n) => sum + n, 0) / values.length : 0;
  return {
    period,
    points,
    peak,
    min,
    avg,
    uptime: null,
    peakAt: points.find((point) => point.online === peak)?.t || '',
    minAt: points.find((point) => point.online === min)?.t || '',
  };
}

function srvSmoothPath(coords: { x: number; y: number }[]): string {
  if (!coords.length) return '';
  if (coords.length === 1) return `M${coords[0].x.toFixed(1)},${coords[0].y.toFixed(1)}`;
  let d = `M${coords[0].x.toFixed(1)},${coords[0].y.toFixed(1)}`;
  for (let i = 0; i < coords.length - 1; i++) {
    const p0 = coords[Math.max(0, i - 1)];
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const p3 = coords[Math.min(coords.length - 1, i + 2)];
    const lo = Math.min(p1.y, p2.y);
    const hi = Math.max(p1.y, p2.y);
    const c1x = p1.x + (p2.x - p1.x) / 3;
    const c2x = p2.x - (p2.x - p1.x) / 3;
    const c1y = Math.min(hi, Math.max(lo, p1.y + (p2.y - p0.y) / 6));
    const c2y = Math.min(hi, Math.max(lo, p2.y - (p3.y - p1.y) / 6));
    d += `C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

function srvSmoothChart(samples: { t: string; online: number }[]): string {
  const pts = samples.length ? samples : [{ t: '', online: 0 }];
  const w = 480;
  const h = 128;
  const padL = 2;
  const padR = 6;
  const padT = 10;
  const padB = 6;
  const max = Math.max(1, ...pts.map((p) => p.online));
  const step = pts.length === 1 ? 0 : (w - padL - padR) / (pts.length - 1);
  const coords = pts.map((p, i) => ({
    x: padL + i * step,
    y: h - padB - (p.online / max) * (h - padT - padB),
  }));
  const line = srvSmoothPath(coords);
  const last = coords[coords.length - 1];
  const area = `${line}L${last.x.toFixed(1)},${h - padB}L${padL},${h - padB}Z`;
  const payload = encodeURIComponent(JSON.stringify(pts));
  return `<div class="scat-plot" data-samples="${payload}"><svg class="scat-chart scat-chart-live" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><path class="scat-chart-area" d="${area}"></path><path class="scat-chart-line" d="${line}"></path><circle class="scat-chart-dot" cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="3.5"></circle></svg><div class="scat-tip" hidden></div></div>`;
}

function srvFormatDesc(raw: string): string {
  const text = String(raw || '').replace(/\r\n/g, '\n').replace(/\\n/g, '\n');
  return sanitizeHtml(markedParse(text));
}

function srvWhen(raw: string): string {
  if (!raw) return '';
  const d = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return raw.slice(0, 16);
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function srvNum(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function srvChartRange(samples: { t: string; online: number }[], idx: number): string {
  const cur = samples[idx];
  if (!cur?.t) return '';
  const start = srvWhen(cur.t);
  const next = samples[idx + 1];
  if (next?.t) return `${start} – ${srvWhen(next.t)}`;
  const prev = samples[idx - 1];
  if (!prev?.t) return start;
  const a = new Date(prev.t.includes('T') ? prev.t : prev.t.replace(' ', 'T')).getTime();
  const b = new Date(cur.t.includes('T') ? cur.t : cur.t.replace(' ', 'T')).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return start;
  return `${start} – ${srvWhen(new Date(b + (b - a)).toISOString())}`;
}

function srvLiveChartHtml(e: CatalogServerEntry, players: number | null): string {
  const remote = e.source === 'librium' ? e.remoteHistory : null;
  const hist = remote && remote.points.length ? remote : srvLocalSeries(e.id, e.chartPeriod || '24h');
  const period = hist.period === '7d' || hist.period === '30d' ? hist.period : '24h';
  const ranges = (['24h', '7d', '30d'] as const).map((key) =>
    `<button type="button" data-range="${key}" class="${key === period ? 'is-on' : ''}">${srvEsc(t(`servers.range.${key}`))}</button>`
  ).join('');
  const now = players != null ? String(players) : '—';
  const first = hist.points[0]?.t || '';
  const last = hist.points[hist.points.length - 1]?.t || '';
  const uptime = hist.uptime == null
    ? ''
    : `<div class="scat-sum"><span>${srvEsc(t('servers.uptime'))}</span><b>${hist.uptime.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%</b><small>${srvEsc(t(`servers.rangeFor.${period}`))}</small></div>`;
  return `<div class="scat-live">
    <div class="scat-live-top">
      <div>
        <div class="scat-live-title">${srvEsc(t('servers.chartTitle'))}</div>
        <div class="scat-ranges">${ranges}</div>
      </div>
      <div class="scat-now"><span>${srvEsc(t('servers.nowOnline'))}</span><b>${srvEsc(now)}</b><small>${srvEsc(t('servers.chartUpdated'))}</small></div>
    </div>
    ${srvSmoothChart(hist.points)}
    <div class="scat-chart-times"><span>${srvEsc(srvWhen(first))}</span><span>${srvEsc(srvWhen(last))}</span></div>
    <div class="scat-sums">
      <div class="scat-sum"><span>${srvEsc(t('servers.peak'))}</span><b>${hist.peak}</b><small>${srvEsc(srvWhen(hist.peakAt))}</small></div>
      <div class="scat-sum"><span>${srvEsc(t('servers.minOnline'))}</span><b>${hist.min}</b><small>${srvEsc(srvWhen(hist.minAt))}</small></div>
      <div class="scat-sum"><span>${srvEsc(t('servers.avg'))}</span><b>${srvNum(hist.avg)}</b><small>${srvEsc(t(`servers.rangeFor.${period}`))}</small></div>
      ${uptime}
    </div>
  </div>`;
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
  const live = Number(srvStatusE(e)?.players?.online);
  if (Number.isFinite(live) && live > 0) return live;
  return Math.max(0, Number(e?.players) || 0);
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

function catalogFromUndefined(raw: ReturnType<typeof undefinedListingEntries>[number]): CatalogServerEntry {
  return {
    id: raw.id,
    name: raw.name,
    ip: raw.ip,
    port: raw.port,
    country: 'RU',
    region: 'cis',
    modes: ['vanilla'],
    desc: raw.desc,
    versions: raw.versions,
    points: 0,
    icon: raw.icon,
    source: 'undefined',
    banner: raw.screenshots.find((shot) => shot.startsWith('data:image/') || /^https?:\/\//i.test(shot)) || '',
    screenshots: raw.screenshots,
    localPort: raw.localPort,
    language: 'ru',
    players: null,
    maxPlayers: raw.maxPlayers,
    online: raw.online,
    rating: null,
    reviews: null,
    followers: null,
    joins: null,
    projectUrl: '',
    projectId: '',
    serverId: '',
    status: raw.online == null ? undefined : {
      online: raw.online !== false,
      players: { online: null, max: raw.maxPlayers },
      version: raw.versions[0] || '',
      latency: null,
      fromCatalog: true,
    },
  };
}

// Свои серверы с включённым листингом попадают в каталог сразу, не дожидаясь ответа сайта.
function applyUndefinedListings(): void {
  const hide = new Set(hiddenListingAddrs().map((addr) => addr.toLowerCase()));
  serverCatalog = serverCatalog.filter((entry) => {
    if (entry.source !== 'undefined') return true;
    return !hide.has(srvAddr(entry).toLowerCase());
  });
  for (const raw of undefinedListingEntries()) {
    const addr = `${raw.ip}:${raw.port}`.toLowerCase();
    const idx = serverCatalog.findIndex((entry) => srvAddr(entry).toLowerCase() === addr);
    const row = catalogFromUndefined(raw);
    if (idx >= 0) {
      if (serverCatalog[idx].source === 'undefined') {
        const prev = serverCatalog[idx];
        // Обновление листинга не должно стирать уже измеренный онлайн и пинг.
        if (row.players == null && prev.players != null) {
          row.players = prev.players;
          if (row.status?.players) row.status.players.online = prev.players;
        }
        if (row.status && prev.status?.latency != null && row.status.latency == null) {
          row.status.latency = prev.status.latency;
        }
        row.chartPeriod = prev.chartPeriod;
        serverCatalog[idx] = row;
      }
      continue;
    }
    serverCatalog.push(row);
  }
}

window.addEventListener('undefined-listings-changed', () => {
  if (!srvLoaded) return;
  applyUndefinedListings();
  renderServersGrid();
  const modal = document.getElementById('modal-srv-info');
  const ip = modal?.getAttribute('data-srv-ip') || '';
  if (modal && !modal.classList.contains('hidden') && ip) openServerInfo(ip);
});

async function loadServerCatalog(force = false): Promise<void> {
  if (srvLoaded && !force) return;
  if (srvLoading) return;
  srvLoading = true;
  const grid = document.getElementById('servers-grid');
  const refreshBtn = document.getElementById('servers-refresh-btn');
  if (force) {
    refreshBtn?.classList.add('is-refreshing');
    refreshBtn?.setAttribute('disabled', '');
    grid?.classList.add('is-refreshing');
    grid?.classList.remove('is-fresh');
  } else if (grid && srvCategory !== 'mine') {
    grid.innerHTML = srvSkeletonHtml();
  }
  let scraped: any[] = [];
  let failed = false;
  try {
    scraped = (await api?.fetchServerCatalog?.(force)) || [];
  } catch {
    failed = true;
  }
  if (!failed && (scraped.length > 0 || !force)) {
  serverCatalog = scraped.map(raw => {
    const ip = String(raw.ip || '').trim();
    const port = Number(raw.port) || 25565;
    const host = ip.split(':')[0];
    const name = String(raw.name || host || 'Server');
    const desc = String(raw.desc || raw.description || '');
    const modes = raw.modes && raw.modes.length > 0 ? raw.modes : srvModesFromName(name, desc);
    const players = raw.players == null ? null : Number(raw.players);
    const maxPlayers = raw.maxPlayers == null ? null : Number(raw.maxPlayers);
    const online = raw.online === true ? true : raw.online === false ? false : null;
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
      points: Number(raw.rating) || 0,
      icon: raw.icon || '',
      source: raw.source === 'modrinth' ? 'modrinth' : raw.source === 'librium' ? 'librium' : raw.source === 'undefined' ? 'undefined' : '',
      banner: String(raw.banner || (Array.isArray(raw.screenshots) ? raw.screenshots.find((shot: unknown) => typeof shot === 'string' && shot) : '') || ''),
      screenshots: Array.isArray(raw.screenshots) ? raw.screenshots : [],
      language: String(raw.language || ''),
      players: Number.isFinite(players as number) ? players : null,
      maxPlayers: Number.isFinite(maxPlayers as number) ? maxPlayers : null,
      online,
      rating: raw.rating == null ? null : Number(raw.rating),
      reviews: raw.reviews == null ? null : Number(raw.reviews),
      followers: raw.followers == null ? null : Number(raw.followers),
      joins: raw.joins == null ? null : Number(raw.joins),
      status: online == null && players == null ? undefined : {
        online: online !== false,
        players: { online: players, max: maxPlayers },
        version: Array.isArray(raw.versions) ? raw.versions[0] : '',
        latency: raw.latency == null ? null : Number(raw.latency),
        fromCatalog: true,
      },
      modpackName: String(raw.modpackName || ''),
      modpackIcon: String(raw.modpackIcon || ''),
      modpackProjectId: String(raw.modpackProjectId || ''),
      modpackVersionId: String(raw.modpackVersionId || ''),
      projectUrl: String(raw.projectUrl || ''),
      projectId: String(raw.projectId || ''),
      serverId: String(raw.serverId || ''),
    };
  });
  const seenAddr = new Set<string>();
  serverCatalog = serverCatalog.filter(e => {
    const a = srvAddr(e).toLowerCase();
    if (seenAddr.has(a)) return false;
    seenAddr.add(a);
    return true;
  });
  applyUndefinedListings();
  }
  srvLoading = false;
  refreshBtn?.classList.remove('is-refreshing');
  refreshBtn?.removeAttribute('disabled');
  grid?.classList.remove('is-refreshing');
  if (failed) return;
  srvLoaded = true;
  const attribution = document.getElementById('servers-attribution');
  if (attribution) attribution.classList.remove('hidden');
  syncServerVersionSelect();
  syncServerLangSelect();
  refreshServersFiltersUI();
  if (force) {
    for (const server of savedServers) delete srvStatusCache[savedServerAddr(server)];
  }
  renderServersGrid();
  if (force && grid) {
    grid.classList.add('is-fresh');
    window.setTimeout(() => grid.classList.remove('is-fresh'), 800);
  }
  pingServersUI(serverCatalog.slice(0, SRV_PAGE_SIZE));
}

function pingServersUI(entries: CatalogServerEntry[]): void {
  const queue = entries.filter(e => e && !e.status?.probed).slice();
  if (queue.length === 0) return;
  let i = 0;
  const worker = async (): Promise<void> => {
    while (i < queue.length) {
      const e = queue[i++];
      if (!e || e.status?.probed) continue;
      let st: any;
      try { st = (await api?.serverStatus?.(srvAddr(e))) || { online: false }; }
      catch { st = { online: false }; }
      // Публичный адрес реле не всегда отвечает на запрос списка. Свой процесс спрашиваем локально.
      if (e.source === 'undefined' && e.localPort && st.players?.online == null) {
        let local: any = null;
        try { local = await api?.serverStatus?.(`127.0.0.1:${e.localPort}`); }
        catch { local = null; }
        if (local?.online && local.players?.online != null) {
          st = {
            ...local,
            online: true,
            latency: st.online && st.latency != null ? st.latency : null,
            players: local.players,
          };
        }
      }
      const prev = e.status;
      if (st.online) {
        e.status = { ...st, probed: true };
        e.online = true;
        if (st.players?.online != null) {
          e.players = Number(st.players.online);
          srvPushHistory(e.id, Number(st.players.online));
        } else if (e.players == null) {
          e.players = 0;
          if (e.status.players) e.status.players.online = 0;
          srvPushHistory(e.id, 0);
        }
        if (st.players?.max != null) e.maxPlayers = Number(st.players.max);
      } else if (prev?.fromCatalog && prev.online) {
        e.status = { ...prev, probed: true };
        if (e.players == null) {
          e.players = 0;
          if (e.status.players) e.status.players.online = 0;
        }
      } else {
        e.status = { ...st, probed: true };
        e.online = false;
        srvPushHistory(e.id, 0);
      }
      updateSrvCardStatus(e);
      const infoModal = document.getElementById('modal-srv-info');
      if (infoModal && !infoModal.classList.contains('hidden') && infoModal.getAttribute('data-srv-ip') === srvAddr(e)) {
        openServerInfo(srvAddr(e));
      }
    }
  };
  void Promise.all(Array.from({ length: 6 }, () => worker()));
}

function updateSrvCardStatus(e: CatalogServerEntry): void {
  const addr = srvAddr(e);
  const card = document.querySelector<HTMLElement>(`.scat-card[data-srv-ip="${CSS.escape(addr)}"]`);
  if (!card) {
    // Статус каталога всё равно полезен для сайдбара
    if (e.status) srvStatusCache[addr] = e.status;
    const last = savedServers[savedServers.length - 1];
    if (last && savedServerAddr(last) === addr) updateSidebarLastServer();
    return;
  }
  const st = e.status || {};
  if (st) srvStatusCache[addr] = st;
  const online = st.online === false ? false : (!!st.online || e.online !== false);
  const players = st.players?.online != null ? st.players.online : e.players;
  const version = String(st.version || '').split('\n')[0] || '';
  const statusTxt = online
    ? (players != null ? srvCompact(Number(players)) : t('servers.online'))
    : '—';
  card.dataset.tone = srvTone(online, st.latency);
  const dot = card.querySelector('.srv-dot');
  if (dot) {
    dot.className = 'srv-dot ' + (online ? 'srv-online' : 'srv-offline');
  }
  const txt = card.querySelector('.srv-status-txt');
  if (txt) txt.textContent = statusTxt;
  const ping = card.querySelector('.scat-ping');
  if (ping) ping.outerHTML = srvPingSvg(card.dataset.tone || 'off');
  const verEl = card.querySelector('.srv-version');
  if (verEl) {
    if (version) verEl.textContent = version;
    else verEl.remove();
  }
  const descEl = card.querySelector('.srv-desc');
  if (descEl && !e.desc) {
    const d = Array.isArray(st?.motd?.clean) ? st.motd.clean.join(' ').substring(0, 110) : '';
    if (d) descEl.textContent = d;
  }
  const icon = e.icon || card.querySelector('.scat-manage') ? '' : srvServerFavicon(st);
  if (icon) {
    const iconEl = card.querySelector<HTMLElement>('.srv-icon');
    if (iconEl) iconEl.innerHTML = `<img src="${srvEsc(icon)}" alt="">`;
  }
  const last = savedServers[savedServers.length - 1];
  if (last && savedServerAddr(last) === addr) updateSidebarLastServer();
}

function srvServerFavicon(st: any): string {
  const raw = String(st?.icon || '');
  if (!raw) return '';
  const lower = raw.toLowerCase();
  if (/^data:image\/png(;|,)/.test(lower)) return raw;
  return '';
}

/** Иконка для плитки: фавиконка пинга, иначе логотип из каталога. */
function srvTileIcon(addr: string, st: any): string {
  const fav = srvServerFavicon(st);
  if (fav) return fav;
  const cat = serverCatalog.find((entry) => srvAddr(entry) === addr);
  const icon = String(cat?.icon || '').trim();
  return /^https?:\/\//i.test(icon) ? icon : '';
}

function srvMatchesFilters(e: CatalogServerEntry): boolean {
  const q = srvQuery.trim().toLowerCase();
  const addr = srvAddr(e);
  if (q && !(e.name.toLowerCase().includes(q) || addr.toLowerCase().includes(q) || (e.desc || '').toLowerCase().includes(q))) return false;
  if (srvSource !== 'all' && e.source !== srvSource) return false;
  if (srvLang) {
    const code = String(e.language || '').toLowerCase().slice(0, 2);
    if (code !== srvLang) return false;
  }
  if (srvCategory !== 'all' && srvCategory !== 'mine' && !e.modes.includes(srvCategory)) return false;
  if (srvRegion !== 'all' && e.region !== srvRegion) return false;
  if (srvOnlineOnly && !srvOnlineE(e) && e.online !== true) return false;
  if (srvVersionFilter) {
    const st = e.status || {};
    const pingVer = String(st.version || '').toLowerCase();
    const listed = (e.versions || []).some(v => v === srvVersionFilter || v.toLowerCase().includes(srvVersionFilter.toLowerCase()));
    if (!listed && !pingVer.includes(srvVersionFilter.toLowerCase())) return false;
  }
  return true;
}

function srvSorted(a: CatalogServerEntry, b: CatalogServerEntry): number {
  if (srvSort === 'name') return a.name.localeCompare(b.name);
  if (srvSort === 'rating') return (Number(b.rating) || 0) - (Number(a.rating) || 0) || srvPlayersE(b) - srvPlayersE(a);
  if (srvSort === 'players') return srvPlayersE(b) - srvPlayersE(a);
  const score = (e: CatalogServerEntry) => (e.source === 'librium' ? 1_000_000 : 0) + (Number(e.rating) || 0) * 10_000 + srvPlayersE(e);
  return score(b) - score(a);
}

function srvTone(online: boolean, latency: unknown): string {
  if (!online) return 'off';
  const ms = Number(latency);
  if (!Number.isFinite(ms) || ms <= 0) return 'good';
  if (ms <= 80) return 'good';
  if (ms <= 140) return 'mid';
  if (ms <= 220) return 'slow';
  return 'bad';
}

/** Полоски из pingStatus: низкий, нормальный, приемлемый, высокий, нет связи. */
function srvPingSvg(tone: string): string {
  const dim = 'rgba(255,255,255,0.15)';
  const bars: Record<string, [string, string, string, string]> = {
    good: ['#27C37F', '#27C37F', '#27C37F', '#27C37F'],
    mid: ['#92E440', '#92E440', '#92E440', dim],
    slow: ['#FFC04C', '#FFC04C', dim, dim],
    bad: ['#FF4C4C', dim, dim, dim],
    off: [dim, dim, dim, dim],
  };
  const [short, mid, tall, top] = bars[tone] || bars.off;
  return `<svg class="scat-ping" width="18" height="12" viewBox="0 0 18 12" aria-hidden="true"><rect x="15" width="3" height="12" rx="1" fill="${top}"/><rect x="10" y="2" width="3" height="10" rx="1" fill="${tall}"/><rect x="5" y="4" width="3" height="8" rx="1" fill="${mid}"/><rect y="6" width="3" height="6" rx="1" fill="${short}"/></svg>`;
}

function srvCardHtml(e: CatalogServerEntry): string {
  const players = e.players != null ? e.players : (e.status?.players?.online ?? null);
  const online = e.online !== false;
  const desc = srvEsc((e.desc || '').replace(/\s+/g, ' ').slice(0, 180));
  const icon = e.icon
    ? `<img src="${srvEsc(e.icon)}" alt="">`
    : `<span>${srvEsc(e.name).charAt(0).toUpperCase()}</span>`;
  const statusTxt = online
    ? (players != null ? srvCompact(Number(players)) : '—')
    : '—';
  const addrStr = srvAddr(e);
  const tone = srvTone(online, e.status?.latency);
  const pack = e.modpackName ? `<span class="scat-pack">${srvEsc(t('servers.hasPack'))}</span>` : '';
  const saved = savedServers.some((s) => savedServerAddr(s) === addrStr || s.ip === addrStr);
  const favTitle = saved ? t('servers.favRemove') : t('servers.favAdd');
  return `
  <article class="scat-card" data-srv-ip="${srvEsc(addrStr)}" data-tone="${tone}">
    <div class="scat-ico uc-frame srv-icon">${icon}</div>
    <div class="scat-main">
      <div class="scat-name-row">${pack}<span class="scat-name">${srvEsc(e.name)}</span></div>
      <div class="scat-desc srv-desc">${desc}</div>
    </div>
    <button type="button" class="scat-fav ${saved ? 'srv-unsave is-on' : 'srv-save'}" data-srv-ip="${srvEsc(addrStr)}" title="${srvEsc(favTitle)}">
      <img src="../../assets/newServersPage/icons/favorites.svg" alt="">
    </button>
    <div class="scat-side">
      <span class="scat-players">
        <i class="scat-picon"></i>
        <span class="srv-status-txt">${srvEsc(statusTxt)}</span>
      </span>
      ${srvPingSvg(tone)}
    </div>
  </article>`;
}

let srvSentinelObserver: IntersectionObserver | null = null;
let srvLoadingMore = false;

function disconnectSrvInfiniteScroll(): void {
  srvSentinelObserver?.disconnect();
  srvSentinelObserver = null;
}

function bindSrvInfiniteScroll(grid: HTMLElement): void {
  disconnectSrvInfiniteScroll();
  const sentinel = grid.querySelector<HTMLElement>('.scat-scroll-sentinel');
  if (!sentinel) return;
  const root = document.getElementById('tab-servers');
  srvSentinelObserver = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      loadMoreServersOnScroll();
    },
    { root, rootMargin: '280px 0px', threshold: 0 },
  );
  srvSentinelObserver.observe(sentinel);
}

function loadMoreServersOnScroll(): void {
  if (srvLoadingMore || srvCategory === 'mine' || !srvLoaded) return;
  const list = serverCatalog.filter(srvMatchesFilters).sort(srvSorted);
  if (srvRenderedCount >= list.length) return;
  srvLoadingMore = true;
  const before = srvRenderedCount;
  renderServersGrid(true);
  pingServersUI(list.slice(before, before + SRV_PAGE_SIZE));
  srvLoadingMore = false;
}

function renderServersGrid(append = false): void {
  const grid = document.getElementById('servers-grid');
  if (!grid) return;
  if (srvCategory === 'mine') {
    disconnectSrvInfiniteScroll();
    renderSavedServersGrid();
    return;
  }
  if (!srvLoaded) {
    disconnectSrvInfiniteScroll();
    if (!append && !srvLoading) grid.innerHTML = srvSkeletonHtml();
    return;
  }
  const list = serverCatalog.filter(srvMatchesFilters).sort(srvSorted);
  if (list.length === 0) {
    disconnectSrvInfiniteScroll();
    srvRenderedCount = 0;
    const hasQuery = Boolean(srvQuery.trim()) || srvSource !== 'all' || srvLang || srvCategory !== 'all' || srvRegion !== 'all' || srvOnlineOnly || srvVersionFilter;
    grid.innerHTML = hasQuery
      ? catalogStateHtml('servers.notFoundTitle', 'servers.notFoundDesc')
      : catalogStateHtml('servers.emptyTitle', 'servers.emptyDesc', { labelKey: 'servers.add', id: 'servers-empty-add' });
    document.getElementById('servers-empty-add')?.addEventListener('click', () => {
      document.getElementById('add-server-btn')?.click();
    });
    return;
  }
  const slice = append ? list.slice(srvRenderedCount, srvRenderedCount + SRV_PAGE_SIZE) : list.slice(0, SRV_PAGE_SIZE);
  if (!append) srvRenderedCount = 0;
  srvRenderedCount += slice.length;
  const cards = slice.map(srvCardHtml).join('');
  const more = srvRenderedCount < list.length
    ? '<div class="scat-scroll-sentinel" aria-hidden="true"></div>'
    : '';
  if (append) {
    grid.querySelector('.scat-scroll-sentinel')?.remove();
    grid.insertAdjacentHTML('beforeend', cards + more);
  } else {
    grid.innerHTML = cards + more;
  }
  bindSrvInfiniteScroll(grid);
}

// Порт из «хост:27228» нельзя отбрасывать: иначе пинг уходит на 25565.
function endpointFromAddress(raw: string, explicitPort?: number): { host: string; port: number } {
  let text = String(raw || '').trim().replace(/^mc:\/\//i, '').replace(/\.+$/, '');
  let host = text;
  let fromText = 0;
  const bracket = text.match(/^\[([^\]]+)\](?::(\d{1,5}))?$/);
  if (bracket) {
    host = bracket[1];
    fromText = Number(bracket[2]) || 0;
  } else {
    const cut = text.lastIndexOf(':');
    if (cut > 0 && text.indexOf(':') === cut) {
      const maybe = Number(text.slice(cut + 1));
      if (Number.isInteger(maybe) && maybe >= 1 && maybe <= 65535) {
        host = text.slice(0, cut);
        fromText = maybe;
      }
    }
  }
  const given = Number(explicitPort);
  const port = fromText
    || (Number.isInteger(given) && given >= 1 && given <= 65535 ? given : 25565);
  return { host, port };
}

function serverAddressField(server: Server): string {
  const { host, port } = endpointFromAddress(server.ip, server.port);
  return port !== 25565 ? `${host}:${port}` : host;
}

function savedServerAddr(s: Server): string {
  const { host, port } = endpointFromAddress(s.ip, s.port);
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
      const last = savedServers[savedServers.length - 1];
      if (last && savedServerAddr(last) === addr) updateSidebarLastServer();
    }
  };
  await Promise.all(Array.from({ length: 6 }, () => worker()));
}

function catalogForSaved(s: Server): CatalogServerEntry | undefined {
  return serverCatalog.find((entry) => srvAddr(entry) === savedServerAddr(s));
}

function serverIsManual(s: Server): boolean {
  if (s.manual === true) return true;
  if (s.manual === false) return false;
  return !catalogForSaved(s);
}

function srvPlainText(raw: string): string {
  return String(raw || '')
    .replace(/§./g, '')
    .replace(/[&$][0-9a-fk-or]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function srvMotdText(st: any): string {
  const clean = st?.motd?.clean;
  const text = Array.isArray(clean) ? clean.join(' ') : String(clean || '');
  return srvPlainText(text);
}

const SRV_EDIT_ICON = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M12.0012 0.31162C11.5857 -0.103873 10.9121 -0.103873 10.4966 0.31162L10.185 0.62324L13.3768 3.81505L13.6884 3.50343C14.1039 3.08794 14.1039 2.41429 13.6884 1.9988L12.0012 0.31162ZM12.3128 4.87899L9.12101 1.68718L4.86527 5.94292L4.01637 9.33853C3.91897 9.72813 4.27187 10.081 4.66147 9.98363L8.05708 9.13473L12.3128 4.87899Z" fill="currentColor"/><path d="M0 3C0 1.34315 1.34315 0 3 0H5C5.55228 0 6 0.447715 6 1C6 1.55228 5.55228 2 5 2H3C2.44772 2 2 2.44772 2 3V11C2 11.5523 2.44772 12 3 12H11C11.5523 12 12 11.5523 12 11V9C12 8.44772 12.4477 8 13 8C13.5523 8 14 8.44772 14 9V11C14 12.6569 12.6569 14 11 14H3C1.34315 14 0 12.6569 0 11V3Z" fill="currentColor"/></svg>';
const SRV_DEL_ICON = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M4 1C4 0.447715 4.44772 0 5 0H9C9.55228 0 10 0.447715 10 1H4Z" fill="currentColor"/><path d="M1 2C1 1.44772 1.44772 1 2 1H12C12.5523 1 13 1.44772 13 2C13 2.55228 12.5523 3 12 3H2C1.44772 3 1 2.55228 1 2Z" fill="currentColor"/><path d="M2.10995 5.09951C2.05108 4.51082 2.51337 4 3.10499 4H10.895C11.4866 4 11.9489 4.51082 11.89 5.0995L11.09 13.0995C11.0389 13.6107 10.6088 14 10.095 14H3.90499C3.39124 14 2.96107 13.6107 2.90995 13.0995L2.10995 5.09951Z" fill="currentColor"/></svg>';

function renderSavedServersGrid(): void {
  const grid = document.getElementById('servers-grid');
  if (!grid) return;
  disconnectSrvInfiniteScroll();
  void pingSavedServerStatuses();
  const q = srvQuery.trim().toLowerCase();
  const list = q
    ? savedServers.filter((s) => {
        const addr = savedServerAddr(s);
        return (
          String(s.name || '').toLowerCase().includes(q) ||
          addr.toLowerCase().includes(q) ||
          String(s.ip || '').toLowerCase().includes(q)
        );
      })
    : savedServers;
  if (list.length === 0) {
    grid.innerHTML = savedServers.length === 0
      ? catalogStateHtml('servers.emptyTitle', 'servers.emptyDesc', { labelKey: 'servers.add', id: 'servers-empty-add' })
      : catalogStateHtml('servers.notFoundTitle', 'servers.notFoundDesc');
    document.getElementById('servers-empty-add')?.addEventListener('click', () => {
      document.getElementById('add-server-btn')?.click();
    });
    return;
  }
  grid.innerHTML = list.map(s => {
    const addr = savedServerAddr(s);
    const cat = catalogForSaved(s);
    const st = cat?.status || srvStatus(addr) || {};
    const players = cat?.players != null ? cat.players : (st.players?.online ?? null);
    const online = cat ? cat.online !== false : !!st.online;
    const descRaw = (cat?.desc || srvMotdText(st)).replace(/\s+/g, ' ').slice(0, 180);
    const iconHtml = cat?.icon
      ? `<img src="${srvEsc(cat.icon)}" alt="">`
      : `<span>${srvEsc(s.name).charAt(0).toUpperCase()}</span>`;
    const statusTxt = online
      ? (players != null ? srvCompact(Number(players)) : '—')
      : '—';
    const tone = srvTone(online, st.latency);
    const pack = cat?.modpackName ? `<span class="scat-pack">${srvEsc(t('servers.hasPack'))}</span>` : '';
    const manual = serverIsManual(s);
    const editTitle = manual ? t('btn.edit') : t('servers.editManualOnly');
    return `
    <article class="scat-card" data-srv-ip="${srvEsc(addr)}" data-tone="${tone}">
      <div class="scat-ico uc-frame srv-icon">${iconHtml}</div>
      <div class="scat-main">
        <div class="scat-name-row">${pack}<span class="scat-name">${srvEsc(cat?.name || s.name)}</span></div>
        <div class="scat-desc srv-desc">${srvEsc(descRaw)}</div>
      </div>
      <div class="scat-manage">
        <button type="button" class="build-card-btn srv-edit" data-srv-id="${srvEsc(s.id)}" title="${srvEsc(editTitle)}" aria-label="${srvEsc(editTitle)}"${manual ? '' : ' disabled'}>${SRV_EDIT_ICON}</button>
        <button type="button" class="build-card-btn danger srv-del" data-srv-id="${srvEsc(s.id)}" title="${srvEsc(t('btn.delete'))}" aria-label="${srvEsc(t('btn.delete'))}">${SRV_DEL_ICON}</button>
      </div>
      <div class="scat-side">
        <span class="scat-players">
          <i class="scat-picon"></i>
          <span class="srv-status-txt">${srvEsc(statusTxt)}</span>
        </span>
        ${srvPingSvg(tone)}
      </div>
    </article>
`;
  }).join('');
}

function srvRegionNameMap(region: string): string {
  return srvRegionName(region);
}

function srvServerHasPack(cat: CatalogServerEntry | undefined): boolean {
  return Boolean(cat && (cat.modpackProjectId || cat.modpackName));
}

function srvLoaderLabel(id: string): string {
  const known: Record<string, string> = {
    fabric: 'Fabric',
    forge: 'Forge',
    neoforge: 'NeoForge',
    quilt: 'Quilt',
    vanilla: 'Vanilla',
  };
  if (!id) return '';
  return known[id] || id.charAt(0).toUpperCase() + id.slice(1);
}

/** Сборки, которые подходят серверу: тот же модпак, не любая сборка из списка. */
function srvPackBuilds(cat: CatalogServerEntry): Build[] {
  const id = cat.modpackProjectId || '';
  const name = (cat.modpackName || '').trim().toLowerCase();
  if (!id && !name) return [];
  return savedBuilds.filter((build) => {
    if (id && build.modpackProjectId && build.modpackProjectId === id) return true;
    if (name && build.name.trim().toLowerCase() === name) return true;
    return false;
  });
}

function catalogByEndpoint(host: string, port: number): CatalogServerEntry | undefined {
  const key = srvKeyOf(host.toLowerCase().replace(/\.+$/, '').replace(/^mc:\/\//i, ''), port || 25565);
  return serverCatalog.find((entry) => srvAddr(entry) === key);
}

const SRV_PACK_DL_ICON = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M0 11C0 10.4477 0.447715 10 1 10C1.55228 10 2 10.4477 2 11C2 11.5523 2.44772 12 3 12H11C11.5523 12 12 11.5523 12 11C12 10.4477 12.4477 10 13 10C13.5523 10 14 10.4477 14 11C14 12.6569 12.6569 14 11 14H3C1.34315 14 0 12.6569 0 11Z" fill="currentColor"/><path d="M12.9999 3.09369C13.3903 3.48411 13.3901 4.1172 12.9999 4.50775L7.70704 9.70703C7.31652 10.0976 6.6835 10.0976 6.29298 9.70703L1.04736 4.50775C0.657133 4.1172 0.656935 3.48411 1.04736 3.09369C1.43779 2.70326 2.07087 2.70346 2.46142 3.09369L6.00001 6.58594L6.00001 1C6.00001 0.447715 6.44773 0 7.00001 0C7.5523 0 8.00001 0.447715 8.00001 1V6.58594L11.5858 3.09369C11.9763 2.70346 12.6094 2.70326 12.9999 3.09369Z" fill="currentColor"/></svg>';
const SRV_PACK_OK_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.2 8.2 6.4 11.4 12.8 4.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

let srvPackBusy = false;

function srvPackCardHtml(cat: CatalogServerEntry): string {
  const ready = srvPackBuilds(cat).length > 0;
  const icon = cat.modpackIcon
    ? `<img src="${srvEsc(cat.modpackIcon)}" alt="">`
    : `<span>${srvEsc(cat.modpackName || '?').charAt(0).toUpperCase()}</span>`;
  const meta = [
    cat.modpackVersion || '',
    cat.modpackGame ? t('servers.packGame', { version: cat.modpackGame }) : '',
    srvLoaderLabel(cat.modpackLoader || ''),
  ].filter(Boolean).join(' · ');
  const summary = (cat.modpackSummary || '').replace(/[#*_`>\[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 160);
  const title = ready ? t('servers.packReady') : t('servers.downloadPack');
  return `<section class="scat-pack-card">
    <div class="scat-pack-badge">${srvEsc(t('servers.packBadge'))}</div>
    <div class="scat-pack-main">
      <div class="scat-pack-ico">${icon}</div>
      <div class="scat-pack-copy">
        <div class="scat-pack-name">${srvEsc(cat.modpackName || '')}</div>
        ${meta ? `<div class="scat-pack-meta">${srvEsc(meta)}</div>` : ''}
        ${summary ? `<div class="scat-pack-sum">${srvEsc(summary)}</div>` : ''}
      </div>
      <button type="button" class="scat-pack-dl${ready ? ' is-ready' : ''}" data-pack-dl ${ready || srvPackBusy ? 'disabled' : ''} title="${srvEsc(title)}">${ready ? SRV_PACK_OK_ICON : SRV_PACK_DL_ICON}<span>${srvEsc(ready ? t('servers.packReady') : t('btn.download'))}</span></button>
    </div>
  </section>`;
}

function syncSrvLaunchBtn(cat: CatalogServerEntry | undefined, ip: string): void {
  const launchBtn = document.getElementById('srv-info-launch') as HTMLButtonElement | null;
  if (!launchBtn) return;
  const hasPack = srvServerHasPack(cat);
  const ready = hasPack && cat ? srvPackBuilds(cat).length > 0 : false;
  launchBtn.disabled = srvPackBusy || !ip || ip.startsWith(':');
  if (hasPack && srvPackBusy) launchBtn.textContent = t('servers.packDownloading');
  else if (hasPack && !ready) launchBtn.textContent = t('servers.downloadPack');
  else launchBtn.textContent = t('servers.pick');
}

/** Карточка модпака берёт название, описание и версию из каталога модов. */
async function resolveServerModpack(cat: CatalogServerEntry): Promise<void> {
  const id = cat.modpackProjectId || '';
  if (!id || cat.modpackResolved) return;
  cat.modpackResolved = true;
  try {
    const [project, versions] = await Promise.all([
      api?.getModrinthProject(id),
      api?.getModrinthVersions(id),
    ]);
    if (project?.title) cat.modpackName = String(project.title);
    if (project?.icon_url) cat.modpackIcon = String(project.icon_url);
    if (project?.description) cat.modpackSummary = String(project.description);
    const list = Array.isArray(versions) ? versions : [];
    const ver = list.find((row) => row?.id === cat.modpackVersionId) || null;
    if (ver) {
      cat.modpackVersion = String(ver.version_number || ver.name || '');
      const games = Array.isArray(ver.game_versions) ? ver.game_versions : [];
      cat.modpackGame = String(games[0] || '');
      const loaders = (Array.isArray(ver.loaders) ? ver.loaders : [])
        .map((row: unknown) => String(row).toLowerCase())
        .filter((row: string) => row && row !== 'minecraft');
      cat.modpackLoader = loaders[0] || '';
    }
  } catch {
    cat.modpackResolved = false;
  }
}

async function downloadServerModpack(cat: CatalogServerEntry): Promise<void> {
  const projectId = cat.modpackProjectId || '';
  if (srvPackBusy || !projectId || srvPackBuilds(cat).length > 0) return;
  const ip = srvAddr(cat);
  if (!cat.modpackVersionId) {
    afterContentInstall = () => {
      const modal = document.getElementById('modal-srv-info');
      if (modal && !modal.classList.contains('hidden') && modal.getAttribute('data-srv-ip') === ip) openServerInfo(ip);
    };
    openModalVersionsForDownload(projectId);
    return;
  }
  srvPackBusy = true;
  syncSrvLaunchBtn(cat, ip);
  updateStatus(t('status.downloadingPack'));
  try {
    const result = await api?.downloadMod(projectId, cat.modpackVersionId);
    if (result?.success) {
      updateStatus(t('status.packInstalled'));
      await loadBuilds();
    } else if (result?.error && result.error !== 'cancelled') {
      updateStatus(t('status.error', { msg: result.error }));
    }
  } finally {
    srvPackBusy = false;
    const modal = document.getElementById('modal-srv-info');
    if (modal && !modal.classList.contains('hidden') && modal.getAttribute('data-srv-ip') === ip) openServerInfo(ip);
  }
}

function openServerInfo(ip: string): void {
  const cat = serverCatalog.find(c => srvAddr(c) === ip);
  const saved = savedServers.find(s => savedServerAddr(s) === ip);
  const name = cat?.name || saved?.name || ip;
  const st = cat?.status || srvStatus(ip) || {};
  const online = !!st.online || cat?.online === true;
  let players = st.players?.online != null ? Number(st.players.online) : (cat?.players ?? null);
  if (players == null && cat) {
    const points = srvReadPoints(cat.id);
    const last = points.length ? points[points.length - 1] : undefined;
    if (last) players = last.n;
    else if (online) players = 0;
  }
  const max = st.players?.max != null ? Number(st.players.max) : (cat?.maxPlayers ?? null);
  const version = srvPlainText(String(st.version || cat?.versions?.[0] || '').split('\n')[0]);
  const versions = cat?.versions?.length ? cat.versions.join(' – ') : version;
  const desc = (cat?.desc || srvMotdText(st)).trim();
  const modal = document.getElementById('modal-srv-info');
  if (!modal) return;
  const sameServer = !modal.classList.contains('hidden') && modal.getAttribute('data-srv-ip') === ip;
  modal.setAttribute('data-srv-ip', ip);
  if (!sameServer) {
    const scroller = document.getElementById('srv-info-scroll');
    if (scroller) scroller.scrollTop = 0;
  }
  const titleEl = document.getElementById('srv-info-title');
  const subEl = document.getElementById('srv-info-sub');
  if (titleEl) titleEl.textContent = name;
  if (subEl) subEl.textContent = ip;
  const dot = document.getElementById('srv-info-dot');
  if (dot) dot.className = 'srv-dot ' + (online ? 'srv-online' : 'srv-offline');
  const iconEl = document.getElementById('srv-info-icon');
  const icon = cat?.icon || '';
  if (iconEl) {
    iconEl.innerHTML = icon
      ? `<img src="${srvEsc(icon)}" alt="">`
      : `<span>${srvEsc(name).charAt(0).toUpperCase()}</span>`;
  }
  const banner = document.getElementById('srv-info-banner');
  const bannerUrl = cat?.banner || cat?.screenshots?.find((shot) => !!shot) || '';
  const windowEl = modal.querySelector<HTMLElement>('.scat-window');
  windowEl?.classList.toggle('is-cover', Boolean(bannerUrl));
  if (banner) {
    banner.hidden = !bannerUrl;
    banner.style.backgroundImage = bannerUrl ? `url("${bannerUrl.replace(/"/g, '')}")` : '';
  }
  const openBtn = document.getElementById('srv-info-open') as HTMLButtonElement | null;
  if (openBtn) openBtn.hidden = !cat?.projectUrl;
  syncSrvLaunchBtn(cat, ip);
  syncSrvInfoFav(ip);

  const parts: string[] = [];
  if (desc) parts.push(`<div class="scat-desc-full">${srvFormatDesc(desc)}</div>`);
  if (cat && srvServerHasPack(cat)) parts.push(srvPackCardHtml(cat));
  const tags = (cat?.modes || []).slice(0, 8);
  if (tags.length) {
    parts.push(`<div class="scat-tags">${tags.map(tag => `<span class="scat-tag">${srvEsc(tag)}</span>`).join('')}</div>`);
  }
  const shots = (cat?.screenshots || []).slice(0, 8);
  if (shots.length) {
    parts.push(`<div class="scat-shots">${shots.map((url) => `<button type="button" class="scat-shot" data-shot="${srvEsc(url)}"><img src="${srvEsc(url)}" alt=""></button>`).join('')}</div>`);
  }
  if (cat?.source === 'librium' && !cat.remoteHistory && !cat.detailTried) {
    parts.push(`<div class="scat-live scat-live-wait"><div class="scat-skel"></div></div>`);
  } else if (cat) {
    parts.push(srvLiveChartHtml(cat, players));
  } else if (saved) {
    parts.push(srvLiveChartHtml({ id: saved.id, name: saved.name } as CatalogServerEntry, players));
  }

  const rows: Array<[string, string]> = [];
  if (players != null) {
    const label = max != null ? `${players.toLocaleString('ru-RU')}/${max.toLocaleString('ru-RU')}` : players.toLocaleString('ru-RU');
    rows.push([t('servers.stat.online'), label]);
  }
  const tone = srvTone(online, st.latency);
  const pingText = st.latency != null
    ? `${Math.round(Number(st.latency))} мс`
    : '—';
  const pingRow = `<tr><td>${srvEsc(t('servers.stat.ping'))}</td><td><span class="scat-stat-ping" data-tone="${tone}">${srvPingSvg(tone)}<span>${srvEsc(pingText)}</span></span></td></tr>`;
  if (cat?.joins != null) rows.push([t('servers.stat.joins'), srvCompact(cat.joins)]);
  if (cat?.followers != null) rows.push([t('servers.stat.followers'), srvCompact(cat.followers)]);
  if (cat?.rating != null) rows.push([t('servers.stat.rating'), Number(cat.rating).toFixed(1)]);
  if (cat?.region) rows.push([t('servers.stat.region'), srvRegionName(cat.region) + (cat.country ? ` · ${cat.country}` : '')]);
  if (cat?.language) rows.push([t('servers.stat.lang'), srvLangName(cat.language)]);
  if (versions) rows.push([t('servers.stat.version'), versions]);
  const bodyRows = rows.map(([k, v]) => `<tr><td>${srvEsc(k)}</td><td>${srvEsc(v)}</td></tr>`);
  const onlineAt = bodyRows.findIndex((row) => row.includes(srvEsc(t('servers.stat.online'))));
  bodyRows.splice(onlineAt >= 0 ? onlineAt + 1 : 0, 0, pingRow);
  parts.push(`<table class="scat-stats">${bodyRows.join('')}</table>`);
  if (cat?.source === 'undefined') {
    parts.push(`<div class="scat-relay">Сервер запущен на базе реле-сервера Undefined</div>`);
  }
  const body = document.getElementById('srv-info-body');
  if (body) body.innerHTML = parts.join('');
  openModal('modal-srv-info');

  if (cat && players != null) srvPushHistory(cat.id, players);
  else if (!cat && saved && players != null) srvPushHistory(saved.id, players);
  if (cat?.source === 'undefined' && cat.localPort && (!cat.localProbeAt || Date.now() - cat.localProbeAt > 12000)) {
    cat.localProbeAt = Date.now();
    const port = cat.localPort;
    void (async () => {
      let local: any = null;
      try { local = await api?.serverStatus?.(`127.0.0.1:${port}`); }
      catch { local = null; }
      if (!local?.online || local.players?.online == null) return;
      const count = Number(local.players.online);
      cat.players = count;
      cat.online = true;
      cat.status = {
        ...(cat.status || {}),
        online: true,
        probed: true,
        players: { online: count, max: local.players?.max ?? cat.maxPlayers },
        version: cat.status?.version || local.version || '',
        latency: cat.status?.latency ?? null,
      };
      srvPushHistory(cat.id, count);
      if (!modal.classList.contains('hidden') && modal.getAttribute('data-srv-ip') === ip) openServerInfo(ip);
    })();
  }
  if (!cat && saved && !(ip in srvStatusCache)) {
    void (async () => {
      try { srvStatusCache[ip] = (await api?.serverStatus?.(ip)) || { online: false }; }
      catch { srvStatusCache[ip] = { online: false }; }
      if (!modal.classList.contains('hidden') && modal.getAttribute('data-srv-ip') === ip) openServerInfo(ip);
      if (srvCategory === 'mine') renderSavedServersGrid();
    })();
  }
  if (cat?.source && cat.id && !cat.detailTried) {
    cat.detailTried = true;
    void (async () => {
      try {
        const detail = await api?.fetchServerDetail?.(cat.source || '', cat.id);
        if (detail && modal.getAttribute('data-srv-ip') === ip) {
          if (detail.desc && String(detail.desc).length > (cat.desc || '').length) cat.desc = String(detail.desc);
          if (Array.isArray(detail.screenshots) && detail.screenshots.length) cat.screenshots = detail.screenshots.map((u: unknown) => String(u));
          if (detail.banner) cat.banner = String(detail.banner);
          if (detail.modpackName) cat.modpackName = String(detail.modpackName);
          if (detail.modpackIcon) cat.modpackIcon = String(detail.modpackIcon);
          if (detail.modpackProjectId) cat.modpackProjectId = String(detail.modpackProjectId);
          if (detail.modpackVersionId) cat.modpackVersionId = String(detail.modpackVersionId);
          if (detail.joins != null) cat.joins = Number(detail.joins);
          if (detail.projectId) cat.projectId = String(detail.projectId);
          if (detail.serverId) cat.serverId = String(detail.serverId);
          if (detail.historySeries && Array.isArray(detail.historySeries.points)) cat.remoteHistory = detail.historySeries;
        }
      } catch { /* сеть или разбор страницы */ }
      if (!modal.classList.contains('hidden') && modal.getAttribute('data-srv-ip') === ip) openServerInfo(ip);
    })();
  }
  if (cat?.modpackProjectId && !cat.modpackResolved) {
    void resolveServerModpack(cat).then(() => {
      if (!modal.classList.contains('hidden') && modal.getAttribute('data-srv-ip') === ip) openServerInfo(ip);
    });
  }
}
document.getElementById('modal-srv-info')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeModal('modal-srv-info');
});
document.getElementById('srv-info-close')?.addEventListener('click', () => closeModal('modal-srv-info'));
document.getElementById('srv-info-copy')?.addEventListener('click', () => {
  const ip = document.getElementById('srv-info-sub')?.textContent || '';
  if (ip) void navigator.clipboard?.writeText(ip);
});
document.getElementById('srv-info-open')?.addEventListener('click', () => {
  const ip = document.getElementById('modal-srv-info')?.getAttribute('data-srv-ip') || '';
  const entry = serverCatalog.find(c => srvAddr(c) === ip);
  if (entry?.projectUrl) void api?.openExternal?.(entry.projectUrl);
});
document.getElementById('srv-info-fav')?.addEventListener('click', () => {
  const ip = document.getElementById('modal-srv-info')?.getAttribute('data-srv-ip') || '';
  if (ip) void toggleServerFavorite(ip);
});
function srvHideChartTips(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('.scat-tip').forEach((tip) => { tip.hidden = true; });
}

document.getElementById('srv-info-scroll')?.addEventListener('mousemove', (e) => {
  const scroll = document.getElementById('srv-info-scroll');
  const plot = (e.target as HTMLElement).closest<HTMLElement>('.scat-plot');
  if (!scroll) return;
  if (!plot) {
    srvHideChartTips(scroll);
    return;
  }
  let samples: { t: string; online: number }[] = [];
  try {
    samples = JSON.parse(decodeURIComponent(plot.getAttribute('data-samples') || '[]'));
  } catch {
    return;
  }
  if (!samples.length) return;
  const rect = plot.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / Math.max(1, rect.width)));
  const idx = Math.min(samples.length - 1, Math.max(0, Math.round(ratio * (samples.length - 1))));
  const tip = plot.querySelector<HTMLElement>('.scat-tip');
  if (!tip) return;
  srvHideChartTips(scroll);
  const range = srvChartRange(samples, idx);
  tip.hidden = false;
  tip.innerHTML = `<b>${Number(samples[idx].online || 0).toLocaleString('ru-RU')}</b>${range ? `<small>${srvEsc(range)}</small>` : ''}`;
  const half = (tip.offsetWidth || 96) / 2;
  const left = Math.max(half + 4, Math.min(rect.width - half - 4, e.clientX - rect.left));
  tip.style.left = `${left}px`;
  tip.style.top = `${e.clientY - rect.top}px`;
});
document.getElementById('srv-info-scroll')?.addEventListener('mouseleave', () => {
  const scroll = document.getElementById('srv-info-scroll');
  if (scroll) srvHideChartTips(scroll);
});
document.getElementById('srv-info-body')?.addEventListener('click', (e) => {
  const packBtn = (e.target as HTMLElement).closest<HTMLElement>('[data-pack-dl]');
  if (packBtn) {
    const ip = document.getElementById('modal-srv-info')?.getAttribute('data-srv-ip') || '';
    const entry = serverCatalog.find((row) => srvAddr(row) === ip);
    if (entry && !srvPackBuilds(entry).length) void downloadServerModpack(entry);
    return;
  }
  const rangeBtn = (e.target as HTMLElement).closest<HTMLElement>('[data-range]');
  if (rangeBtn) {
    const period = rangeBtn.getAttribute('data-range') || '24h';
    const ip = document.getElementById('modal-srv-info')?.getAttribute('data-srv-ip') || '';
    const entry = serverCatalog.find((c) => srvAddr(c) === ip);
    if (!entry) return;
    document.querySelectorAll('#srv-info-body [data-range]').forEach((node) => {
      node.classList.toggle('is-on', node === rangeBtn);
    });
    const paint = (playersNow: number | null) => {
      const live = document.querySelector('#srv-info-body .scat-live');
      if (live) live.outerHTML = srvLiveChartHtml(entry, playersNow);
    };
    const playersNow = entry.status?.players?.online != null ? Number(entry.status.players.online) : (entry.players ?? null);
    if (!entry.projectId || !entry.serverId || entry.source !== 'librium') {
      entry.chartPeriod = period;
      paint(playersNow);
      return;
    }
    void (async () => {
      const data = await api?.fetchServerHistory?.(entry.projectId || '', entry.serverId || '', period);
      if (!data?.points || document.getElementById('modal-srv-info')?.getAttribute('data-srv-ip') !== ip) return;
      entry.remoteHistory = data;
      paint(playersNow);
    })();
    return;
  }
  const link = (e.target as HTMLElement).closest('a');
  if (link?.closest('.scat-desc-full')) {
    const href = link.getAttribute('href') || '';
    if (/^https?:\/\//i.test(href)) {
      e.preventDefault();
      void api?.openExternal?.(href);
    }
    return;
  }
  const descImg = (e.target as HTMLElement).closest<HTMLImageElement>('.scat-desc-full img');
  if (descImg?.src) {
    openImageViewer([{ src: descImg.src, externalUrl: descImg.src }], 0, 'server');
    return;
  }
  const shotBtn = (e.target as HTMLElement).closest<HTMLElement>('.scat-shot');
  const shot = shotBtn?.getAttribute('data-shot') || '';
  if (!shot) return;
  const buttons = Array.from(document.querySelectorAll<HTMLElement>('#srv-info-body .scat-shot'));
  openImageViewer(
    buttons.map((btn) => {
      const src = btn.getAttribute('data-shot') || '';
      return { src, externalUrl: src };
    }).filter((item) => item.src),
    Math.max(0, buttons.indexOf(shotBtn as HTMLElement)),
    'server',
  );
});
document.getElementById('srv-info-launch')?.addEventListener('click', () => {
  const modal = document.getElementById('modal-srv-info');
  const ip = modal?.getAttribute('data-srv-ip') || '';
  if (!ip) return;
  const entry = serverCatalog.find(c => srvAddr(c) === ip);
  if (entry && srvServerHasPack(entry) && srvPackBuilds(entry).length === 0) {
    void downloadServerModpack(entry);
    return;
  }
  closeModal('modal-srv-info');
  void (async () => {
    if (!(await requireAccount())) return;
    const [host, portPart] = ip.split(':');
    beginServerLaunch(host, parseInt(portPart, 10) || entry?.port || 25565, entry?.name);
  })();
});

function syncSrvInfoFav(ip: string): void {
  const favBtn = document.getElementById('srv-info-fav');
  const label = document.getElementById('srv-info-fav-label');
  if (!favBtn) return;
  const on = savedServers.some((s) => savedServerAddr(s) === ip || s.ip === ip);
  favBtn.classList.toggle('is-on', on);
  favBtn.setAttribute('data-srv-ip', ip);
  const text = on ? t('servers.favRemove') : t('servers.favAdd');
  favBtn.title = text;
  if (label) label.textContent = text;
}

async function toggleServerFavorite(ip: string): Promise<void> {
  const existing = savedServers.find((s) => savedServerAddr(s) === ip || s.ip === ip);
  if (existing) {
    if (!(await confirmAction(t('confirm.deleteServer', { name: existing.name })))) return;
    if (api?.removeServer) await api.removeServer(existing.id);
  } else {
    const entry = serverCatalog.find((c) => srvAddr(c) === ip);
    if (!entry) return;
    const st = entry.status || srvStatus(ip) || {};
    const version = String(st.version || '').split('\n')[0] || '';
    await api?.saveServer?.({ id: Date.now().toString(), name: entry.name, ip, port: entry.port, version, manual: false });
  }
  await loadServers();
  renderServersGrid();
  const modalIp = document.getElementById('modal-srv-info')?.getAttribute('data-srv-ip') || '';
  if (modalIp === ip) syncSrvInfoFav(ip);
}

document.getElementById('servers-grid')?.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('.srv-play, .srv-save, .srv-unsave, .srv-edit, .srv-del, .srv-info');
  if (!btn) {
    const card = (e.target as HTMLElement).closest<HTMLElement>('.scat-card');
    const cardIp = card?.getAttribute('data-srv-ip');
    if (cardIp) openServerInfo(cardIp);
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
      beginServerLaunch(host, parseInt(portPart, 10) || 25565, entry && 'name' in entry ? entry.name : undefined);
    })();
    return;
  }
  if ((btn.classList.contains('srv-save') || btn.classList.contains('srv-unsave')) && ip) {
    void toggleServerFavorite(ip);
    return;
  }
  const id = btn.getAttribute('data-srv-id');
  if (btn.classList.contains('srv-edit') && id) {
    const server = savedServers.find(s => s.id === id);
    if (server && serverIsManual(server)) openModalServer(server);
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
  srvSort = (e.target as HTMLSelectElement).value || 'relevance';
  refreshServersFiltersUI();
  renderServersGrid();
});

document.getElementById('servers-source-select')?.addEventListener('change', (e) => {
  srvSource = (e.target as HTMLSelectElement).value || 'all';
  srvRenderedCount = 0;
  renderServersGrid();
});

document.getElementById('servers-lang-select')?.addEventListener('change', (e) => {
  srvLang = (e.target as HTMLSelectElement).value || '';
  srvRenderedCount = 0;
  renderServersGrid();
});

document.getElementById('servers-fav-btn')?.addEventListener('click', () => {
  const on = srvCategory !== 'mine';
  srvCategory = on ? 'mine' : 'all';
  document.getElementById('servers-fav-btn')?.classList.toggle('is-on', on);
  renderServersGrid();
});

function setSrvLayout(mode: 'list' | 'grid'): void {
  const grid = document.getElementById('servers-grid');
  grid?.classList.toggle('is-list', mode === 'list');
  grid?.classList.toggle('is-grid', mode === 'grid');
  const icon = document.getElementById('servers-view-icon') as HTMLImageElement | null;
  if (icon) {
    icon.src = mode === 'grid'
      ? '../../assets/newServersPage/icons/list.svg'
      : '../../assets/newServersPage/icons/grid.svg';
  }
}

document.getElementById('servers-view-toggle')?.addEventListener('click', () => {
  const grid = document.getElementById('servers-grid');
  setSrvLayout(grid?.classList.contains('is-grid') ? 'list' : 'grid');
});

document.getElementById('servers-refresh-btn')?.addEventListener('click', () => {
  void loadServerCatalog(true);
});

document.getElementById('servers-attrib-close')?.addEventListener('click', () => {
  document.getElementById('servers-attribution')?.classList.add('is-hidden');
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

function syncServerLangSelect(): void {
  const select = document.getElementById('servers-lang-select') as HTMLSelectElement | null;
  if (!select) return;
  const codes = Array.from(new Set(
    serverCatalog.map(e => String(e.language || '').toLowerCase().slice(0, 2)).filter(Boolean),
  ));
  const current = srvLang;
  select.innerHTML = `<option value="">${t('servers.lang.any')}</option>`
    + codes.map(code => `<option value="${srvEsc(code)}">${srvEsc(srvLangName(code))}</option>`).join('');
  const menu = select.closest('.stngs-select-wrap')?.querySelector<HTMLElement>('.stngs-select-menu');
  if (menu) {
    menu.innerHTML = `<div class="stngs-select-opt" data-value="">${t('servers.lang.any')}</div>`
      + codes.map(code => `<div class="stngs-select-opt" data-value="${srvEsc(code)}">${srvEsc(srvLangName(code))}</div>`).join('');
  }
  select.value = current && codes.includes(current) ? current : '';
  srvLang = select.value;
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

let homeServersStatusPending = false;

function homeServerRowHtml(s: Server): string {
  const addr = savedServerAddr(s);
  const st = resolveLastServerStatus(addr);
  const online = !!st.online;
  const players = st.players?.online != null ? st.players.online : null;
  const max = st.players?.max != null ? st.players.max : null;
  const version = String(st.version || s.version || '').split('\n')[0] || '';
  const latency = st.latency != null && Number.isFinite(Number(st.latency))
    ? `${Math.round(Number(st.latency))} ms`
    : '';
  const statusTxt = online
    ? (players != null
      ? `${Number(players).toLocaleString()}${max != null ? '/' + Number(max).toLocaleString() : ''}`
      : t('servers.online'))
    : (Object.keys(st).length ? t('servers.offline') : '…');
  const fav = srvTileIcon(addr, st);
  const icon = fav
    ? `<img src="${srvEsc(fav)}" alt="">`
    : `<img src="../../assets/icons/serverIcon.png" alt="">`;

  return `
    <div class="home-row" data-server-id="${escapeHtml(s.id)}" data-srv-ip="${srvEsc(addr)}">
      <div class="home-row-icon">${icon}</div>
      <div class="home-row-info">
        <div class="home-row-title">${escapeHtml(s.name)}</div>
        <div class="home-row-meta home-srv-meta">
          <span class="srv-dot ${online ? 'srv-online' : 'srv-offline'}"></span>
          <span class="home-srv-online">${escapeHtml(statusTxt)}</span>
          ${version ? `<span class="srv-sep">·</span><span class="home-srv-ver">${escapeHtml(version)}</span>` : ''}
          ${latency ? `<span class="srv-sep">·</span><span class="home-srv-ping">${escapeHtml(latency)}</span>` : ''}
        </div>
      </div>
      <button class="home-row-btn">${t('btn.launch')}</button>
    </div>
  `;
}

async function refreshHomeServersStatus(servers: Server[]): Promise<void> {
  if (homeServersStatusPending || !api?.serverStatus) return;
  const need = servers.filter((s) => {
    const addr = savedServerAddr(s);
    return !addr || srvStatusCache[addr]?.online == null;
  });
  if (!need.length) return;

  homeServersStatusPending = true;
  try {
    await Promise.all(need.map(async (s) => {
      const addr = savedServerAddr(s);
      if (!addr || srvStatusCache[addr]?.online != null) return;
      try {
        srvStatusCache[addr] = (await api!.serverStatus!(addr)) || { online: false };
      } catch {
        srvStatusCache[addr] = { online: false };
      }
      const cat = serverCatalog.find((c) => srvAddr(c) === addr);
      if (cat) cat.status = srvStatusCache[addr];
    }));
    renderHomeServers();
  } finally {
    homeServersStatusPending = false;
  }
}

function renderHomeServers(): void {
  const list = document.getElementById('home-servers-list');
  if (!list) return;
  const recent = savedServers.slice(-5).reverse();
  if (recent.length === 0) {
    list.innerHTML = `<div class="home-empty">
      <div class="home-empty__title">${escapeAiHtml(t('home.empty.serversTitle'))}</div>
      <div class="home-empty__desc">${escapeAiHtml(t('home.empty.serversDesc'))}</div>
      <button type="button" class="home-empty__btn" data-home-empty="add-server">${escapeAiHtml(t('home.empty.serversCta'))}</button>
    </div>`;
    list.querySelector<HTMLElement>('[data-home-empty="add-server"]')?.addEventListener('click', () => {
      switchTab('servers');
      openModalServer();
    });
    return;
  }
  list.innerHTML = recent.map(homeServerRowHtml).join('');
  list.querySelectorAll<HTMLElement>('.home-row-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const server = savedServers.find(s => s.id === (btn.closest('.home-row') as HTMLElement)?.getAttribute('data-server-id'));
      if (server) void openLastServerLaunch(server);
    });
  });
  list.querySelectorAll<HTMLElement>('.home-row').forEach(row => {
    row.addEventListener('click', () => {
      const server = savedServers.find(s => s.id === row.getAttribute('data-server-id'));
      if (server) void openLastServerLaunch(server);
    });
  });
  void refreshHomeServersStatus(recent);
}

async function openLastServerLaunch(srv: Server): Promise<void> {
  if (!(await requireAccount())) return;
  const addr = savedServerAddr(srv);
  const [host, portPart] = addr.split(':');
  beginServerLaunch(host, parseInt(portPart, 10) || Number(srv.port) || 25565, srv.name);
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

// Правый стик на вкладке скинов крутит камеру. Полный наклон ≈ 1.7 рад/с.
setGamepadLook((x, y, dt) => {
  if (!skinViewer || skinViewer.disposed) return;
  skinViewer.orbitBy(x * 1.7 * dt, y * 1.15 * dt);
});

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
  'idle', 'walk', 'run', 'sneak', 'wave', 'hit', 'hello', 'look', 'cool', 'think', 'dab', 'glide', 'victory', 'sleep', 'dance',
];

/** Кадрирование пресетов под скриншот */
const SKIN_SHOT_FRAMES: Record<ShotPresetId, { fillY: number; maxFillX: number; offsetY: number }> = {
  hero: { fillY: 0.56, maxFillX: 0.7, offsetY: -0.16 },
  // Мягче заполнение: иначе bust/discord слишком крупно и «ныряют» в торс/руку
  bust: { fillY: 0.58, maxFillX: 0.62, offsetY: 0.04 },
  back: { fillY: 0.54, maxFillX: 0.72, offsetY: -0.16 },
  discord: { fillY: 0.6, maxFillX: 0.58, offsetY: 0.05 },
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

let skinFitTimer = 0;

/** Пока ширина сайдбара анимируется, канвас меняется каждый кадр. Кадрируем один раз, когда размер устоялся. */
function scheduleSkinViewerFit(): void {
  window.clearTimeout(skinFitTimer);
  skinFitTimer = window.setTimeout(() => fitSkinViewer(), 120);
}

function initSkinViewer(): void {
  if (!skinCanvas) return;
  try {
    skinViewer = new SkinViewEngine(skinCanvas, {
      autoDetectModel: true,
      idleAnimation: true,
      enableControls: true,
      // Силуэт сглаживает SMAA в post-FX; MSAA канваса ломает pixel-art UV
      antialias: false,
      transparent: false,
      presentation: 'full',
      autoResize: false,
    });
    viewerSkinUrl = null;
    viewerCapeUrl = undefined;
    skinViewer.controls.enableZoom = false;
    skinViewer.setCursorFollow(true);
    updateSkinLocatorBadge();
    skinAnimMode = 'idle';
    skinShotPreset = null;
    syncSkinAnimButtons();
    syncSkinPoseButtons();
    bindSkinCursorLook();
    (window as unknown as { __skinViewer?: SkinViewEngine }).__skinViewer = skinViewer;
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => scheduleSkinViewerFit()).observe(skinCanvas);
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
    // Вне панели отладки всегда продуктовые дефолты — иначе postFx=false из
    // localStorage навсегда отключал SMAA («пропало сглаживание»).
    skinViewer.setDebugOptions(
      enabled ? opts : { ...DEFAULT_SKIN_DEBUG_OPTIONS },
    );
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
  walk: 'skins.animWalk',
  run: 'skins.animRun',
  hit: 'skins.animHit',
  wave: 'skins.animWave',
  hello: 'skins.animHello',
  sneak: 'skins.animSneak',
  look: 'skins.animLook',
  cool: 'skins.animCool',
  think: 'skins.animThink',
  dab: 'skins.animDab',
  glide: 'skins.animGlide',
  victory: 'skins.animVictory',
  sleep: 'skins.animSleep',
  dance: 'skins.animDance',
  sad: 'skins.animSad',
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
  updateSkinLocatorBadge();
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
  updateSkinLocatorBadge();
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

/** Одна поза для всех карточек скинов: три четверти, без разброса по id. */
const SKIN_CARD_YAW = -0.35;

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
      bindSkinLocatorBadge();
      updateSkinsAccountUi();
      const auth = accountAuthType();
      if (auth === 'msa' || auth === 'yggdrasil') {
        try {
          await syncLicenseCosmeticsFromProfile({ quiet: true });
        } catch (e) {
          console.warn('auto sync cosmetics on skins tab failed', e);
          await loadSkinsList();
          if (auth === 'yggdrasil') await ensureElySkinFallback();
        }
      } else {
        await loadSkinsList();
      }
      if (isOfflineAccount()) {
        await applyOfflineSteveSkin();
      } else {
        // Догрузить вьювер, если sync/list не вызвали setSkin
        if (pendingViewerSkin) {
          const url = pendingViewerSkin;
          pendingViewerSkin = null;
          await loadSkinToViewer(url);
        }
        if (!viewerSkinUrl) {
          const mine = cosmeticsForCurrentAccount().filter((s) => !isCapeId(s.id) && s.dataUrl);
          const activeId = getActiveSkinId();
          const pick =
            (activeId && mine.find((s) => s.id === activeId))
            || mine[0];
          if (pick?.dataUrl) {
            setActiveSkinId(pick.id);
            await loadSkinToViewer(pick.dataUrl);
            const typeLabel = pick.id.startsWith('ely-skin-')
              ? t('acc.ely')
              : pick.id.startsWith('license-skin-')
                ? t('acc.license')
                : t('acc.local');
            updateNameType(pick.name, typeLabel);
          } else if (auth === 'yggdrasil') {
            await ensureElySkinFallback();
            await loadSkinsList();
          }
        }
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
    updateSkinLocatorBadge();
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

/** Цвет Locator Bar по UUID аккаунта — бейдж + маркер над головой */
function updateSkinLocatorBadge(): void {
  const el = document.getElementById('skin-locator-badge') as HTMLButtonElement | null;
  const uuid = String(currentAccount?.uuid || '');
  const color =
    !isOfflineAccount() && uuid ? locatorColorFromUuid(uuid) : null;

  if (skinViewer && !skinViewer.disposed) {
    skinViewer.setLocatorUuid(color ? uuid : null);
  }

  if (!el) return;
  // На пресетах под скриншот бейдж тоже прячем — чистый кадр
  if (!color || skinShotPreset) {
    el.hidden = true;
    el.classList.add('hidden');
    el.textContent = '';
    el.style.removeProperty('--locator-color');
    return;
  }
  const hex = `#${color.renderedHex.toUpperCase()}`;
  el.hidden = false;
  el.classList.remove('hidden');
  el.textContent = hex;
  el.style.setProperty('--locator-color', hex);
  el.title = t('skins.locatorBarHint');
  el.setAttribute('aria-label', t('skins.locatorBar'));
}

function bindSkinLocatorBadge(): void {
  const el = document.getElementById('skin-locator-badge');
  if (!el || el.dataset.bound === '1') return;
  el.dataset.bound = '1';
  el.addEventListener('click', async () => {
    const hex = el.textContent?.trim();
    if (!hex) return;
    try {
      await navigator.clipboard.writeText(hex);
      showAppToast(t('skins.locatorCopied', { color: hex }));
    } catch {
      /* ignore */
    }
  });
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

/**
 * Fallback для Ely: Profile API часто без url — тянем текстуру как при логине.
 * Возвращает true, если скин сохранён и показан.
 */
async function ensureElySkinFallback(): Promise<boolean> {
  if (accountAuthType() !== 'yggdrasil') return false;
  if (!api?.fetchSkinImage) return false;

  const accKey = accountCosmeticsKey();
  if (!accKey || accKey === 'offline') return false;

  const nick = String(currentAccount?.username || '').trim();
  let skinUrl =
    String(currentAccount?.skinUrl || '').trim()
    || (nick ? `https://skinsystem.ely.by/skins/${encodeURIComponent(nick)}.png` : '')
    || 'https://s.namemc.com/i/cbe20ed58814c5e1.png';

  if (api.getSkinData && currentAccount?.uuid) {
    try {
      const data = await api.getSkinData(
        String(currentAccount.uuid).replace(/-/g, ''),
        ELY_AUTH_SERVER,
      );
      if (data?.skinUrl) skinUrl = data.skinUrl;
    } catch (e) {
      console.warn('[skins] ely getSkinData fallback failed', e);
    }
  }

  // skinsystem/{nick}.png часто 404/редирект — если не вышло, дефолтный скин
  let b64 = await api.fetchSkinImage(skinUrl);
  if (!b64) {
    skinUrl = 'https://s.namemc.com/i/cbe20ed58814c5e1.png';
    b64 = await api.fetchSkinImage(skinUrl);
  }
  if (!b64) return false;

  const dataUrl = `data:image/png;base64,${b64}`;
  const id = `ely-skin-${accKey}`;
  await saveAccountSkin({ id, name: t('skins.elySkin'), dataUrl });
  setActiveSkinId(id);
  await loadSkinToViewer(dataUrl);
  await refreshAccountUiAvatar(dataUrl);
  await bumpAccountAvatarRev(skinUrl);
  return true;
}

/** Локальные скины зала: Steve для оффлайна, dummy для слота добавления */
const OFFLINE_STEVE_SKIN_URL = '../../assets/skins/steve.png';
const ADD_ACCOUNT_SKIN_URL = '../../assets/skins/dummy.png';

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
  updateSkinLocatorBadge();
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
      antialias: false,
      autoResize: false,
      transparent: true,
      presentation: 'bust',
      enableEffects: false,
    });
    previewEngine.setCameraFov(14);
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
      // Плащ — со спины, скин — одна и та же поза во всех карточках
      const isCape = Math.abs(yaw - Math.PI) < 0.01;
      engine.setAnimation(new BustPoseAnimation(0, true));
      engine.setPlayerYaw(isCape ? Math.PI : SKIN_CARD_YAW);
      engine.setSize(PREVIEW_SIZE.w * 2, PREVIEW_SIZE.h * 2);
      engine.fitPlayerToFrame(isCape ? SKIN_CARD_FRAME : { fillY: 0.9, maxFillX: 0.9, offsetY: 0 });
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
      queueCardPreview(canvas, s.dataUrl, null, 0);
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
    // Всё равно показать локально сохранённые скины
    await loadSkinsList();
    return 0;
  }

  if (!opts?.quiet) updateStatus(t('skins.loadingLicense'));
  const profile = await api.listProfileCosmetics(currentAccount);
  if (!profile.success) {
    if (!opts?.quiet) {
      updateStatus(t('skins.applyFailed', { msg: profile.error || t('common.error') }));
    }
    // Раньше здесь был return без loadSkinsList → пустой список и чёрный вьювер
    await loadSkinsList();
    if (auth === 'yggdrasil') await ensureElySkinFallback();
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

  const skinUrl =
    activeSkin?.url
    || activeSkin?.texture
    || activeSkin?.skinUrl
    || null;

  if (skinUrl && !keepLocalProfileCard) {
    const b64 = await api.fetchSkinImage(skinUrl);
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
        await bumpAccountAvatarRev(skinUrl);
      }
      hadSkin = true;
    }
  }

  // Ely API часто отдаёт пустой getSkins — добираем текстуру как при логине
  if (!hadSkin && auth === 'yggdrasil' && !keepLocalProfileCard) {
    hadSkin = await ensureElySkinFallback();
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
    queueCardPreview(canvas, dataUrl, null, 0);
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

document.getElementById('build-run-play')?.addEventListener('click', async () => {
  setHomeRunListOpen(false);
  if (runningBuild) return;
  const build = getHomeSelectedBuild();
  if (build) await launchBuild(build);
  else updateStatus(t('status.noBuilds'));
});

document.getElementById('build-run-selector')?.addEventListener('click', () => {
  setHomeRunListOpen(!homeRunListOpen);
});

document.getElementById('build-run-list')?.addEventListener('click', (e) => {
  const edit = (e.target as HTMLElement).closest<HTMLElement>('[data-edit-id]');
  if (edit) {
    e.stopPropagation();
    const build = savedBuilds.find((b) => b.id === edit.getAttribute('data-edit-id'));
    setHomeRunListOpen(false);
    if (build) void openModalBuild(build);
    return;
  }
  const item = (e.target as HTMLElement).closest<HTMLElement>('[data-build-id]');
  if (!item) return;
  setHomeRunListOpen(false);
  selectHomeBuild(item.getAttribute('data-build-id'));
});

document.getElementById('home-last-build')?.addEventListener('click', () => {
  const last = getLastPlayedBuild();
  if (!last) return;
  setHomeRunListOpen(false);
  selectHomeBuild(last.id);
});

document.getElementById('tb-tasks-list')?.addEventListener('click', (e) => {
  const cancel = (e.target as HTMLElement).closest<HTMLElement>('[data-task-cancel]');
  const dismiss = (e.target as HTMLElement).closest<HTMLElement>('[data-task-dismiss]');
  if (!cancel && !dismiss) return;
  e.preventDefault();
  e.stopPropagation();
  if (cancel) {
    const id = cancel.getAttribute('data-task-cancel') || '';
    void cancelLauncherTask(id);
    return;
  }
  dismissLauncherTask(dismiss?.getAttribute('data-task-dismiss') || '');
});

function setTasksMenuOpen(open: boolean): void {
  const menu = document.getElementById('tb-tasks-menu');
  const btn = document.getElementById('tb-tasks-btn');
  if (!menu) return;
  menu.classList.remove('hidden');
  menu.classList.toggle('is-open', open);
  btn?.classList.toggle('is-open', open);
  btn?.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) {
    setClientMenuOpen(false);
    taskUnseen.clear();
    renderLauncherTasks();
  }
}

document.getElementById('tb-tasks-btn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  const menu = document.getElementById('tb-tasks-menu');
  if (!menu) return;
  setTasksMenuOpen(!menu.classList.contains('is-open'));
});

document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement | null;
  if (!target) return;
  if (!target.closest('#build-run-panel') && homeRunListOpen) setHomeRunListOpen(false);
  if (!target.closest('#tb-tasks')) setTasksMenuOpen(false);
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (homeRunListOpen) setHomeRunListOpen(false);
  setTasksMenuOpen(false);
  setClientMenuOpen(false);
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
  const badge = document.getElementById('tb-update-badge');
  if (badge) {
    badge.hidden = !hasUpdate;
    badge.classList.toggle('is-visible', hasUpdate);
  }
}

async function checkForUpdatesUI(opts?: { autoLaunch?: boolean }): Promise<void> {
  if (!api?.checkForUpdates) return;
  if (updateBtn) updateBtn.disabled = true;
  if (updateStatusEl) updateStatusEl.textContent = t('updates.checking');
  let info;
  try {
    info = await api.checkForUpdates();
  } catch {
    info = null;
  }
  if (!info || info.error) {
    if (updateStatusEl) updateStatusEl.textContent = t('updates.checkFailed');
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
    if (updateStatusEl) {
      updateStatusEl.textContent = t('updates.available', { latest: info.latest, current: info.current });
    }
    if (updateBtn) {
      updateBtn.disabled = false;
      updateBtn.textContent = t('btn.updateRestart');
      updateBtn.classList.add('has-update');
    }
    // При запуске — сразу updater.exe (Windows / установленная сборка)
    if (opts?.autoLaunch && api.launchUpdater) {
      const platform = api.getPlatformInfo?.()?.platform;
      if (platform === 'win32') {
        if (updateStatusEl) {
          updateStatusEl.textContent = t('updates.launching', { latest: info.latest });
        }
        const result = await api.launchUpdater();
        if (result?.success) return;
        if (updateStatusEl) updateStatusEl.textContent = t('updates.launchFailed');
      }
    }
  } else {
    updatePending = false;
    setUpdatesTabIndicator(false);
    if (updateStatusEl) {
      updateStatusEl.textContent = t('updates.latest', { current: info.current });
    }
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

document.getElementById('tb-update-badge')?.addEventListener('click', async () => {
  if (updatePending) {
    const result = await api?.launchUpdater();
    if (result?.success) return;
  }
  // Фоллбек: открыть вкладку обновлений
  document.querySelector<HTMLElement>('.tab-btn[data-tab="settings"]')?.click();
  window.setTimeout(() => {
    document.querySelector<HTMLElement>('.stngs-sidebar [data-settings-tab="updates"]')?.click();
  }, 80);
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

function setClientMenuOpen(open: boolean): void {
  ctxMenu.classList.toggle('open', open);
  document.getElementById('btn-menu')?.classList.toggle('is-open', open);
}

document.getElementById('btn-menu')?.addEventListener('click', (e) => {
  e.stopPropagation();
  const btn = e.currentTarget as HTMLElement | null;
  if (!btn) return;
  if (ctxMenu.classList.contains('open')) {
    setClientMenuOpen(false);
    return;
  }
  setTasksMenuOpen(false);
  const rect = btn.getBoundingClientRect();
  ctxMenu.style.left = 'auto';
  ctxMenu.style.right = (window.innerWidth - rect.right) + 'px';
  ctxMenu.style.top = (rect.bottom + 4) + 'px';
  setClientMenuOpen(true);
});

document.addEventListener('click', () => setClientMenuOpen(false));
ctxMenu.addEventListener('click', (e) => e.stopPropagation());

document.getElementById('build-share-menu')?.addEventListener('click', (e) => {
  e.stopPropagation();
  const btn = (e.target as HTMLElement).closest('[data-share-action]') as HTMLElement | null;
  if (!btn || !shareMenuBuild) return;
  const action = btn.getAttribute('data-share-action');
  const build = shareMenuBuild;
  hideBuildShareMenu();
  if (action === 'link') void openShareModal(build);
  else if (action === 'zip') void runInstanceExport('zip', build);
  else if (action === 'mrpack') void runInstanceExport('mrpack', build);
  else if (action === 'shortcut') void createBuildDesktopShortcut(build);
});

document.addEventListener('click', () => hideBuildShareMenu());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideBuildShareMenu();
});

document.getElementById('ctx-settings')?.addEventListener('click', () => {
  setClientMenuOpen(false);
  openModal('modal-settings');
  void checkForUpdatesUI();
  void refreshJavaManager();
});

document.getElementById('ctx-about')?.addEventListener('click', () => {
  setClientMenuOpen(false);
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

function relativeLuminance(r: number, g: number, b: number): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function applyAccent(accent: string): void {
  document.documentElement.style.setProperty('--accent', accent);
  syncGamepadColor();
  document.documentElement.style.setProperty('--accent-hover', darkenColor(accent, 20));
  const r = parseInt(accent.slice(1, 3), 16);
  const g = parseInt(accent.slice(3, 5), 16);
  const b = parseInt(accent.slice(5, 7), 16);
  document.documentElement.style.setProperty('--accent-rgb', `${r},${g},${b}`);

  // Светлый акцент → тёмный текст/иконки на нём; тёмный → белые
  const lum = relativeLuminance(r, g, b);
  const onAccent = lum > 0.48 ? '#0d1421' : '#ffffff';
  const onRgb = onAccent === '#ffffff' ? '255,255,255' : '13,20,33';
  document.documentElement.style.setProperty('--on-accent', onAccent);
  document.documentElement.style.setProperty('--on-accent-rgb', onRgb);
  document.documentElement.setAttribute('data-accent-fg', lum > 0.48 ? 'dark' : 'light');

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
  api?.notifyThemeChanged?.(color);
}

document.querySelectorAll<HTMLElement>('#settings-accent-picker .accent-swatch[data-accent]').forEach(swatch => {
  swatch.addEventListener('click', () => {
    closeAccentColorPop();
    setAccentColor(swatch.getAttribute('data-accent')!);
  });
});

// ===== Кастомный color picker акцента =====
type AccentHsv = { h: number; s: number; v: number };
let accentPickerHsv: AccentHsv = { h: 210, s: 1, v: 1 };
let accentPickerOpen = false;
let accentPickerDragging: 'sv' | 'hue' | null = null;

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!m) return null;
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

function rgbToHex(r: number, g: number, b: number): string {
  const to = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

function rgbToHsv(r: number, g: number, b: number): AccentHsv {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  const s = max === 0 ? 0 : d / max;
  return { h: h * 360, s, v: max };
}

function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const hh = ((h % 360) + 360) % 360 / 60;
  const c = v * s;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const m = v - c;
  let rp = 0, gp = 0, bp = 0;
  if (hh < 1) { rp = c; gp = x; }
  else if (hh < 2) { rp = x; gp = c; }
  else if (hh < 3) { gp = c; bp = x; }
  else if (hh < 4) { gp = x; bp = c; }
  else if (hh < 5) { rp = x; bp = c; }
  else { rp = c; bp = x; }
  return {
    r: Math.round((rp + m) * 255),
    g: Math.round((gp + m) * 255),
    b: Math.round((bp + m) * 255),
  };
}

function accentHsvToHex(hsv: AccentHsv): string {
  const { r, g, b } = hsvToRgb(hsv.h, hsv.s, hsv.v);
  return rgbToHex(r, g, b);
}

function syncAccentColorPopUi(opts?: { skipInputs?: boolean }): void {
  const sv = document.getElementById('accent-sv');
  const svCursor = document.getElementById('accent-sv-cursor');
  const hueThumb = document.getElementById('accent-hue-thumb');
  const preview = document.getElementById('accent-preview');
  const hexInput = document.getElementById('accent-hex') as HTMLInputElement | null;
  const rInput = document.getElementById('accent-r') as HTMLInputElement | null;
  const gInput = document.getElementById('accent-g') as HTMLInputElement | null;
  const bInput = document.getElementById('accent-b') as HTMLInputElement | null;
  const hex = accentHsvToHex(accentPickerHsv);
  const rgb = hsvToRgb(accentPickerHsv.h, accentPickerHsv.s, accentPickerHsv.v);

  if (sv) sv.style.backgroundColor = `hsl(${accentPickerHsv.h}, 100%, 50%)`;
  if (svCursor) {
    svCursor.style.left = `${accentPickerHsv.s * 100}%`;
    svCursor.style.top = `${(1 - accentPickerHsv.v) * 100}%`;
  }
  if (hueThumb) {
    hueThumb.style.left = `${(accentPickerHsv.h / 360) * 100}%`;
    hueThumb.style.background = `hsl(${accentPickerHsv.h}, 100%, 50%)`;
  }
  if (preview) preview.style.background = hex;
  if (!opts?.skipInputs) {
    if (hexInput && document.activeElement !== hexInput) hexInput.value = hex.toUpperCase();
    if (rInput && document.activeElement !== rInput) rInput.value = String(rgb.r);
    if (gInput && document.activeElement !== gInput) gInput.value = String(rgb.g);
    if (bInput && document.activeElement !== bInput) bInput.value = String(rgb.b);
  }
}

function applyAccentFromPicker(): void {
  setAccentColor(accentHsvToHex(accentPickerHsv));
}

function setAccentColorPopOpen(open: boolean): void {
  const pop = document.getElementById('settings-accent-color-pop');
  const btn = document.getElementById('settings-custom-accent');
  const wrap = btn?.closest('.accent-custom-wrap') as HTMLElement | null;
  if (!pop || !btn) return;
  accentPickerOpen = open;
  if (open) {
    const current = localStorage.getItem('Undefined Client-accent') || '#70ADDF';
    const rgb = hexToRgb(current);
    if (rgb) accentPickerHsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
    syncAccentColorPopUi();
    wrap?.classList.add('is-open');
    pop.classList.remove('hidden');
    requestAnimationFrame(() => pop.classList.add('is-open'));
    btn.setAttribute('aria-expanded', 'true');
  } else if (pop.classList.contains('is-open') || !pop.classList.contains('hidden')) {
    pop.classList.remove('is-open');
    wrap?.classList.remove('is-open');
    btn.setAttribute('aria-expanded', 'false');
    window.setTimeout(() => {
      if (!pop.classList.contains('is-open')) pop.classList.add('hidden');
    }, 180);
  }
}

function closeAccentColorPop(): void {
  if (accentPickerOpen) setAccentColorPopOpen(false);
}

function pickAccentSvFromEvent(e: PointerEvent): void {
  const sv = document.getElementById('accent-sv');
  if (!sv) return;
  const rect = sv.getBoundingClientRect();
  accentPickerHsv.s = clamp01((e.clientX - rect.left) / rect.width);
  accentPickerHsv.v = clamp01(1 - (e.clientY - rect.top) / rect.height);
  syncAccentColorPopUi();
  applyAccentFromPicker();
}

function pickAccentHueFromEvent(e: PointerEvent): void {
  const hue = document.getElementById('accent-hue');
  if (!hue) return;
  const rect = hue.getBoundingClientRect();
  accentPickerHsv.h = clamp01((e.clientX - rect.left) / rect.width) * 360;
  syncAccentColorPopUi();
  applyAccentFromPicker();
}

function initAccentColorPicker(): void {
  const btn = document.getElementById('settings-custom-accent');
  const pop = document.getElementById('settings-accent-color-pop');
  const sv = document.getElementById('accent-sv');
  const hue = document.getElementById('accent-hue');
  const hexInput = document.getElementById('accent-hex') as HTMLInputElement | null;
  const rInput = document.getElementById('accent-r') as HTMLInputElement | null;
  const gInput = document.getElementById('accent-g') as HTMLInputElement | null;
  const bInput = document.getElementById('accent-b') as HTMLInputElement | null;
  if (!btn || !pop) return;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    setAccentColorPopOpen(!accentPickerOpen);
  });
  pop.addEventListener('click', (e) => e.stopPropagation());

  const bindDrag = (el: HTMLElement | null, kind: 'sv' | 'hue') => {
    if (!el) return;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      accentPickerDragging = kind;
      el.setPointerCapture?.(e.pointerId);
      if (kind === 'sv') pickAccentSvFromEvent(e);
      else pickAccentHueFromEvent(e);
    });
  };
  bindDrag(sv, 'sv');
  bindDrag(hue, 'hue');

  window.addEventListener('pointermove', (e) => {
    if (!accentPickerDragging) return;
    if (accentPickerDragging === 'sv') pickAccentSvFromEvent(e);
    else pickAccentHueFromEvent(e);
  });
  window.addEventListener('pointerup', () => {
    accentPickerDragging = null;
  });

  hexInput?.addEventListener('input', () => {
    const raw = hexInput.value.trim();
    const rgb = hexToRgb(raw.startsWith('#') ? raw : `#${raw}`);
    if (!rgb) return;
    accentPickerHsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
    syncAccentColorPopUi({ skipInputs: true });
    applyAccentFromPicker();
  });
  hexInput?.addEventListener('change', () => {
    const rgb = hexToRgb(hexInput.value);
    if (rgb) hexInput.value = rgbToHex(rgb.r, rgb.g, rgb.b).toUpperCase();
    else syncAccentColorPopUi();
  });

  const onRgbInput = () => {
    const r = Math.max(0, Math.min(255, Number(rInput?.value) || 0));
    const g = Math.max(0, Math.min(255, Number(gInput?.value) || 0));
    const b = Math.max(0, Math.min(255, Number(bInput?.value) || 0));
    accentPickerHsv = rgbToHsv(r, g, b);
    syncAccentColorPopUi({ skipInputs: true });
    applyAccentFromPicker();
  };
  rInput?.addEventListener('input', onRgbInput);
  gInput?.addEventListener('input', onRgbInput);
  bInput?.addEventListener('input', onRgbInput);

  document.addEventListener('click', () => closeAccentColorPop());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAccentColorPop();
  });
}

initAccentColorPicker();

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

// «Сворачивать» и «Оставлять открытым» — взаимоисключающие; держим в инверсии
(() => {
  const minEl = document.getElementById('setting-minimize-on-launch') as HTMLInputElement | null;
  const keepEl = document.getElementById('setting-keep-open') as HTMLInputElement | null;
  if (!minEl || !keepEl) return;
  minEl.addEventListener('change', () => {
    keepEl.checked = !minEl.checked;
    localStorage.setItem('Undefined Client-keep-open', String(keepEl.checked));
  });
  keepEl.addEventListener('change', () => {
    minEl.checked = !keepEl.checked;
    localStorage.setItem('Undefined Client-minimize-on-launch', String(minEl.checked));
  });
})();
document.getElementById('setting-skin-viewer-debug')?.addEventListener('change', () => {
  applySkinViewerDebugSetting();
});
document.getElementById('setting-skin-viewer-debug-reset')?.addEventListener('click', () => {
  resetSkinViewerDebugDefaults();
});
ensureSkinDebugOptionsUi();

// ===== Имена языков в селекте (нативные названия, не зависят от текущей локали) =====
const LANGUAGE_NATIVE_NAMES: Record<string, string> = {
  ru: 'Русский',
  en: 'English',
  tt: 'Татар',
  kk: 'Қазақша',
  uk: 'Украинский',
  kbd: 'Къэбэрдейбзэ',
};

function applyLanguageSelectLabels(): void {
  const select = document.getElementById('setting-language') as HTMLSelectElement | null;
  if (!select) return;
  const wrap = select.closest<HTMLElement>('.stngs-select-wrap');
  for (const opt of Array.from(select.options)) {
    const name = LANGUAGE_NATIVE_NAMES[opt.value];
    if (name) opt.textContent = name;
  }
  wrap?.querySelectorAll<HTMLElement>('.stngs-select-opt[data-value]').forEach(el => {
    const name = LANGUAGE_NATIVE_NAMES[el.dataset.value || ''];
    if (name) el.textContent = name;
  });
}

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

// ===== Размытие видеофона главной =====
const HOME_BLUR_KEY = 'Undefined Client-home-blur';
const HOME_BLUR_STRENGTH_KEY = 'Undefined Client-home-blur-strength';

function applyHomeBlur(): void {
  const layers = ['home-video-bg', 'home-image-bg']
    .map((id) => document.getElementById(id))
    .filter((el): el is HTMLElement => !!el);
  const toggle = document.getElementById('setting-home-blur') as HTMLInputElement | null;
  const slider = document.getElementById('setting-home-blur-strength') as HTMLInputElement | null;
  const label = document.getElementById('setting-home-blur-label');
  const on = toggle ? toggle.checked : localStorage.getItem(HOME_BLUR_KEY) === 'true';
  const raw = Number(slider?.value || localStorage.getItem(HOME_BLUR_STRENGTH_KEY) || '8');
  const strength = Math.max(2, Math.min(24, Number.isFinite(raw) ? raw : 8));
  if (label) label.textContent = String(strength);
  if (slider) syncRangeProgress(slider);
  for (const layer of layers) {
    if (on) {
      layer.style.filter = `blur(${strength}px)`;
      layer.classList.add('is-blurred');
    } else {
      layer.style.filter = '';
      layer.classList.remove('is-blurred');
    }
  }
}

// ===== Фон главной: набор роликов или свой файл, без случайной смены =====
const HOME_WALL_KEY = 'Undefined Client-home-wallpaper';
const HOME_WALL_CUSTOM_KEY = 'Undefined Client-home-wallpaper-custom';
const HOME_WALL_BUILTIN = ['1', '2', '3', '5', '6', '7', '8'] as const;

type HomeWallChoice =
  | { kind: 'builtin'; id: string }
  | { kind: 'custom'; name: string; media: 'image' | 'video' };

function readHomeWallCustom(): { name: string; media: 'image' | 'video' } | null {
  try {
    const raw = localStorage.getItem(HOME_WALL_CUSTOM_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (v && typeof v.name === 'string' && (v.media === 'image' || v.media === 'video')) return v;
  } catch { /* битая запись */ }
  return null;
}

function readHomeWall(): HomeWallChoice {
  try {
    const raw = localStorage.getItem(HOME_WALL_KEY);
    if (raw) {
      const v = JSON.parse(raw);
      if (v?.kind === 'builtin' && (HOME_WALL_BUILTIN as readonly string[]).includes(v.id)) return { kind: 'builtin', id: v.id };
      if (v?.kind === 'custom' && typeof v.name === 'string' && (v.media === 'image' || v.media === 'video')) {
        return { kind: 'custom', name: v.name, media: v.media };
      }
    }
  } catch { /* битая запись */ }
  return { kind: 'builtin', id: '1' };
}

function writeHomeWall(choice: HomeWallChoice): void {
  localStorage.setItem(HOME_WALL_KEY, JSON.stringify(choice));
}

function paintWallpaperPicker(): void {
  const grid = document.getElementById('wallpaper-grid');
  if (!grid) return;
  const choice = readHomeWall();
  const custom = readHomeWallCustom();
  const cards = HOME_WALL_BUILTIN.map((id, index) => {
    const on = choice.kind === 'builtin' && choice.id === id;
    return `<button type="button" class="wallpaper-card${on ? ' is-on' : ''}" data-wall="${id}" title="${index + 1}">
      <video muted preload="metadata" src="../../assets/VideoWallpapers/${id}.mp4"></video>
      <span class="wallpaper-card__label">${index + 1}</span>
    </button>`;
  });
  if (custom) {
    const on = choice.kind === 'custom';
    const face = custom.media === 'image'
      ? `<img alt="" src="wall://local/${encodeURIComponent(custom.name)}">`
      : `<video muted preload="metadata" src="wall://local/${encodeURIComponent(custom.name)}"></video>`;
    cards.push(`<button type="button" class="wallpaper-card${on ? ' is-on' : ''}" data-wall="custom">
      ${face}
      <span class="wallpaper-card__label">${t('stngs.wallpaperCustom')}</span>
    </button>`);
  }
  grid.innerHTML = cards.join('');
  grid.querySelectorAll<HTMLVideoElement>('video').forEach((video) => {
    video.addEventListener('loadeddata', () => {
      try { video.currentTime = 0.4; } catch { /* кадр ещё не готов */ }
    }, { once: true });
  });
}

function applyHomeWallpaper(): void {
  const video = document.getElementById('home-video-bg') as HTMLVideoElement | null;
  const image = document.getElementById('home-image-bg') as HTMLImageElement | null;
  if (!video) return;
  const choice = readHomeWall();
  if (choice.kind === 'custom' && choice.media === 'image') {
    video.pause();
    video.removeAttribute('src');
    video.dataset.wallKind = 'image';
    video.hidden = true;
    if (image) {
      image.hidden = false;
      const next = `wall://local/${encodeURIComponent(choice.name)}`;
      if (image.getAttribute('src') !== next) {
        image.removeAttribute('src');
        image.src = next;
      }
    }
  } else {
    if (image) {
      image.hidden = true;
      image.removeAttribute('src');
    }
    video.hidden = false;
    video.dataset.wallKind = 'video';
    const src = choice.kind === 'builtin'
      ? `../../assets/VideoWallpapers/${choice.id}.mp4`
      : `wall://local/${encodeURIComponent(choice.name)}`;
    if (video.getAttribute('src') !== src) {
      video.removeAttribute('src');
      video.src = src;
      video.load();
    }
    video.loop = true;
    video.muted = true;
    if (homeWallPlaying) void video.play().catch(() => {});
  }
  applyHomeBlur();
  paintWallpaperPicker();
}

const homeBlurToggle = document.getElementById('setting-home-blur') as HTMLInputElement | null;
const homeBlurSlider = document.getElementById('setting-home-blur-strength') as HTMLInputElement | null;
if (homeBlurToggle) {
  homeBlurToggle.checked = localStorage.getItem(HOME_BLUR_KEY) === 'true';
  homeBlurToggle.addEventListener('change', () => {
    localStorage.setItem(HOME_BLUR_KEY, String(homeBlurToggle.checked));
    applyHomeBlur();
  });
}
if (homeBlurSlider) {
  const storedStrength = localStorage.getItem(HOME_BLUR_STRENGTH_KEY);
  homeBlurSlider.value = storedStrength && Number(storedStrength) > 0 ? storedStrength : '8';
  homeBlurSlider.addEventListener('input', () => {
    localStorage.setItem(HOME_BLUR_STRENGTH_KEY, homeBlurSlider.value);
    applyHomeBlur();
  });
}
applyHomeBlur();
applyHomeWallpaper();

const wallpaperGrid = document.getElementById('wallpaper-grid');
wallpaperGrid?.addEventListener('click', (e) => {
  const card = (e.target as HTMLElement).closest<HTMLElement>('[data-wall]');
  if (!card) return;
  const id = card.dataset.wall || '';
  if (id === 'custom') {
    const custom = readHomeWallCustom();
    if (!custom) return;
    writeHomeWall({ kind: 'custom', name: custom.name, media: custom.media });
  } else if ((HOME_WALL_BUILTIN as readonly string[]).includes(id)) {
    writeHomeWall({ kind: 'builtin', id });
  } else {
    return;
  }
  applyHomeWallpaper();
});

const wallpaperPick = document.getElementById('wallpaper-pick');
wallpaperPick?.addEventListener('click', async () => {
  const picked = await api?.pickWallpaper?.();
  if (!picked) return;
  if ('error' in picked) {
    updateStatus(picked.error || t('stngs.wallpaperPick'));
    return;
  }
  localStorage.setItem(HOME_WALL_CUSTOM_KEY, JSON.stringify({ name: picked.name, media: picked.media }));
  writeHomeWall({ kind: 'custom', name: picked.name, media: picked.media });
  applyHomeWallpaper();
});

// ===== Звуки интерфейса (пак Zen) =====
initUiSfx();
const uiSfxToggle = document.getElementById('setting-ui-sfx') as HTMLInputElement | null;
if (uiSfxToggle) {
  const storedSfx = localStorage.getItem('Undefined Client-ui-sfx');
  uiSfxToggle.checked = storedSfx === null ? true : storedSfx === 'true';
  setUiSfxEnabled(uiSfxToggle.checked);
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

// ===== Слайдеры настроек (RAM / масштаб) =====
function syncRangeProgress(el: HTMLInputElement): void {
  const min = Number(el.min) || 0;
  const max = Number(el.max) || 100;
  const val = Number(el.value);
  const pct = max === min ? 0 : ((val - min) / (max - min)) * 100;
  el.style.setProperty('--range-progress', `${pct}%`);
}

document.querySelectorAll<HTMLInputElement>('.stngs-ram-control input[type="range"]').forEach((el) => {
  const paint = () => syncRangeProgress(el);
  paint();
  el.addEventListener('input', paint);
});

const ramSlider = document.getElementById('setting-ram') as HTMLInputElement | null;
const ramLabel = document.getElementById('setting-ram-label');
if (ramSlider && ramLabel) {
  const ramKey = 'Undefined Client-ram';
  const stored = localStorage.getItem(ramKey);
  ramSlider.value = stored || '2048';
  ramLabel.textContent = ramSlider.value + t('common.mb');
  syncRangeProgress(ramSlider);
  ramSlider.addEventListener('input', () => {
    ramLabel.textContent = ramSlider.value + t('common.mb');
    localStorage.setItem(ramKey, ramSlider.value);
    syncRangeProgress(ramSlider);
  });
}

// UI scale — сегментированный выбор (90–125%, шаг 5)
const UI_SCALE_STEPS: number[] = [90, 95, 100, 105, 110, 115, 120, 125];
const uiScaleSegments = document.getElementById('setting-ui-scale-segments');
const uiScaleLabel = document.getElementById('setting-ui-scale-label');
if (uiScaleSegments && uiScaleLabel) {
  const scaleKey = 'Undefined Client-ui-scale';
  const applyScale = (v: number): void => {
    document.body.style.zoom = String(v / 100);
    // Кастомный caret вне zoom — сразу пересчитать позицию
    if (typeof syncCustomCaret === 'function') syncCustomCaret();
  };

  const snapScale = (raw: number): number => {
    let best: number = UI_SCALE_STEPS[0];
    let bestDist = Math.abs(raw - best);
    for (const step of UI_SCALE_STEPS) {
      const d = Math.abs(raw - step);
      if (d < bestDist) {
        best = step;
        bestDist = d;
      }
    }
    return best;
  };

  let currentScale: number = snapScale(Number(localStorage.getItem(scaleKey) || '100') || 100);

  const renderScaleSegments = (): void => {
    uiScaleSegments.innerHTML = '';
    for (const step of UI_SCALE_STEPS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'stngs-scale-seg';
      btn.dataset.scale = String(step);
      btn.setAttribute('aria-label', `${step}%`);
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', step === currentScale ? 'true' : 'false');
      if (step <= currentScale) btn.classList.add('is-filled');
      if (step === currentScale) btn.classList.add('is-active');
      btn.addEventListener('click', () => setUiScale(step));
      uiScaleSegments.appendChild(btn);
    }
    uiScaleLabel.textContent = `${currentScale}%`;
  };

  const setUiScale = (value: number): void => {
    currentScale = snapScale(value);
    localStorage.setItem(scaleKey, String(currentScale));
    applyScale(currentScale);
    renderScaleSegments();
  };

  uiScaleSegments.addEventListener('keydown', (e) => {
    const idx = UI_SCALE_STEPS.indexOf(currentScale);
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      setUiScale(UI_SCALE_STEPS[Math.min(UI_SCALE_STEPS.length - 1, Math.max(0, idx) + 1)]);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      setUiScale(UI_SCALE_STEPS[Math.max(0, (idx < 0 ? 0 : idx) - 1)]);
    }
  });

  applyScale(currentScale);
  renderScaleSegments();
}

function loadTheme(): void {
  const theme = localStorage.getItem('Undefined Client-theme') || 'ocean';
  const accent = localStorage.getItem('Undefined Client-accent') || '#70ADDF';
  if (theme !== 'custom') {
    const themeAccents: Record<string,string> = { ocean:'#70ADDF', midnight:'#5b8ed4', purple:'#a78bfa', forest:'#4ade80' };
    const defAccent = themeAccents[theme] || '#70ADDF';
    localStorage.setItem('Undefined Client-accent', defAccent);
    applyAccent(defAccent);
    api?.notifyThemeChanged?.(defAccent);
  } else {
    applyAccent(accent);
    api?.notifyThemeChanged?.(accent);
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
  // Сводим конфликтующие значения: приоритет у «Сворачивать»
  {
    const minEl = document.getElementById('setting-minimize-on-launch') as HTMLInputElement | null;
    const keepEl = document.getElementById('setting-keep-open') as HTMLInputElement | null;
    if (minEl && keepEl) {
      keepEl.checked = !minEl.checked;
      localStorage.setItem('Undefined Client-keep-open', String(keepEl.checked));
    }
  }
  settingLoad('setting-discord-rpc', 'discord-rpc', true);
  settingLoad('setting-check-updates-start', 'check-updates-start', true);
  settingLoad('setting-mods-page-size', 'mods-page-size', '20');
  settingLoad('setting-skin-viewer-debug', 'skin-viewer-debug', false);
  ensureSkinDebugOptionsUi();
  applySkinViewerDebugSetting();
  applyLanguageSelectLabels();
  initCustomSelects();
  bindAiAccessSettingsUi();
}

document.getElementById('quick-launch')?.addEventListener('click', async () => {
  if (runningBuild) {
    updateStatus(t('status.closeFirst', { name: runningBuild.name }));
    return;
  }
  const build = getHomeFeaturedBuild();
  if (build) await launchBuild(build);
  else updateStatus(t('status.noBuilds'));
});
document.getElementById('last-server')?.addEventListener('click', () => {
  void (async () => {
    if (savedServers.length === 0) {
      updateStatus(t('status.noServers'));
      return;
    }
    await openLastServerLaunch(savedServers[savedServers.length - 1]);
  })();
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
  if (showConsole) openConsoleLog();
  if (closeAfterLaunch) {
    api?.windowClose();
  } else if (minimizeOnLaunch) {
    // Только явный пункт «Сворачивать лаунчер при запуске».
    // Раньше сюда же попадало выключенное «Оставлять открытым» (!keepOpen) —
    // из‑за этого окно сворачивалось даже при выключенном minimize.
    api?.windowMinimize();
  }
}

function showLaunchProgress(status: string): void {
  upsertLauncherTask({
    id: 'launch',
    title: t('tasks.launch'),
    stage: status,
    percent: null,
    detail: '',
  });
}

function buildHasGamepadMod(build: Build): boolean {
  return (build.mods || []).some((mod) => /controlify|controllable|midnightcontrols|lambdacontrols/i.test(`${mod.name} ${mod.filename || ''} ${mod.projectId || ''}`));
}

async function ensureGamepadMod(build: Build): Promise<void> {
  if (buildHasGamepadMod(build)) return;
  const loader = String(build.loader || '').toLowerCase();
  const projectId = loader === 'forge'
    ? 'controllable'
    : (loader === 'fabric' || loader === 'quilt' || loader === 'neoforge' ? 'controlify' : '');
  if (!projectId) {
    showAppToast(t('gamepad.modNeedLoader'));
    return;
  }
  const skipKey = 'Undefined Client-gamepad-mod-skip';
  const skipped = new Set((localStorage.getItem(skipKey) || '').split(',').filter(Boolean));
  if (skipped.has(build.id)) return;
  const modName = projectId === 'controlify' ? 'Controlify' : 'Controllable';
  const yesBtn = document.getElementById('confirm-yes');
  const prevYes = yesBtn?.textContent || '';
  if (yesBtn) yesBtn.textContent = t('gamepad.modInstall');
  const yes = await confirmAction(t('gamepad.modOffer', { mod: modName, name: build.name }));
  if (yesBtn) yesBtn.textContent = prevYes;
  if (!yes) {
    skipped.add(build.id);
    localStorage.setItem(skipKey, [...skipped].join(','));
    return;
  }
  showAppToast(t('gamepad.modInstalling', { mod: modName }));
  await downloadModToBuild(projectId, build.id);
}

async function launchBuild(build: Build, server?: { ip: string; port: number; name?: string }): Promise<void> {
  const fromGamepad = takeGamepadLaunch();
  if (!(await requireAccount())) return;
  // Токен мог ещё обновляться в фоне после старта — в игру нужен свежий.
  if (accountRefreshPromise) await accountRefreshPromise;
  if (runningBuild) {
    updateStatus(t('status.closeFirst', { name: runningBuild.name }));
    return;
  }
  if (fromGamepad) await ensureGamepadMod(build);

  updateStatus(t('status.launching', { name: build.name }));
  showLaunchProgress(t('status.launching', { name: build.name }));
  if (!api?.launch) {
    clearLauncherTask('launch');
    updateStatus(t('status.launcherUnavailable'));
    return;
  }
  runningBuild = build;
  syncRunningLaunchUi();
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
    localStorage.setItem('last-launch-at', String(Date.now()));
    applyLaunchBehavior();
  } else {
    runningBuild = null;
    syncRunningLaunchUi();
    clearLauncherTask('launch');
    updateStatus(t('status.error', { msg: result.errorKey ? t(result.errorKey) : (result.error || t('common.error')) }));
  }
}

function sanitizeBuildIdClient(id: string): string {
  return String(id || '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-]/g, '');
}

/** Подхватить Minecraft, оставшийся запущенным после закрытия лаунчера */
function applyAdoptedRunningGame(info: {
  buildId: string;
  name?: string;
  gameVersion?: string;
  loader?: string;
  startedAt?: number;
}): void {
  const slug = sanitizeBuildIdClient(info.buildId);
  const build =
    savedBuilds.find((b) => sanitizeBuildIdClient(b.id) === slug || b.id === info.buildId) ||
    null;
  if (build) {
    runningBuild = build;
  } else {
    runningBuild = {
      id: info.buildId,
      name: info.name || info.buildId,
      gameVersion: info.gameVersion || '?',
      loader: info.loader || 'vanilla',
      loaderVersion: '',
      iconBg: '#3a3a3a',
      playtime: 0,
    };
  }
  runningBuildStart = info.startedAt && info.startedAt > 0 ? info.startedAt : Date.now();
  startRunningTimer();
  updateStatus(t('status.playing', { name: runningBuild.name }));
  updateBanner();
  updateSidebarCards();
  renderBuilds();
  void notifyMessengerGameRunning();
}

async function adoptRunningGameFromMain(): Promise<void> {
  if (!api?.detectRunningGame || runningBuild) return;
  try {
    const res = await api.detectRunningGame();
    if (!res?.ok || !res.running || !res.buildId) return;
    applyAdoptedRunningGame({
      buildId: res.buildId,
      name: res.name,
      gameVersion: res.gameVersion,
      loader: res.loader,
      startedAt: res.startedAt,
    });
  } catch {
    /* ignore */
  }
}

function syncHomePlayButton(): void {
  const btn = document.getElementById('build-run-play') as HTMLButtonElement | null;
  if (!btn) return;
  const label = btn.querySelector('span');
  const selected = getHomeSelectedBuild();
  if (runningBuild) {
    btn.disabled = true;
    btn.classList.add('is-running');
    if (label) label.textContent = t('btn.playing');
  } else {
    btn.disabled = !selected;
    btn.classList.remove('is-running');
    if (label) label.textContent = t('btn.play');
  }
}

/** Обновить UI «игра запущена»: главная + список сборок */
function syncRunningLaunchUi(): void {
  syncHomePlayButton();
  renderBuilds();
  updateSidebarCards();
}

let runningTimerTick = false;
let runningTimerId: any = null;

function startRunningTimer(): void {
  if (runningTimerTick) return;
  runningTimerTick = true;
  syncRunningLaunchUi();
  const tick = (): void => {
    if (!runningBuild) { runningTimerTick = false; return; }
    const elapsed = Math.floor((Date.now() - runningBuildStart) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    syncHomePlayButton();
    // Sidebar indicator
    const ind = document.getElementById('running-indicator');
    if (ind) ind.classList.remove('hidden');
    const indName = document.getElementById('running-indicator-name');
    if (indName) indName.textContent = runningBuild.name;
    const indTime = document.getElementById('running-indicator-time');
    if (indTime) indTime.textContent = timeStr;
    updateHomeInsights();
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
      // Длительность только что завершённой сессии — для карточки на главной
      localStorage.setItem('last-session-seconds', String(elapsed));
    }
  }
  runningBuild = null;
  runningBuildStart = 0;
  runningTimerTick = false;
  if (runningTimerId) { clearInterval(runningTimerId); runningTimerId = null; }
  const ind = document.getElementById('running-indicator');
  if (ind) ind.classList.add('hidden');
  syncRunningLaunchUi();
  updateBanner();
  updateStats();
}

async function joinServer(ip: string): Promise<void> {
  const [host, portStr] = ip.split(':');
  const port = parseInt(portStr, 10) > 0 ? parseInt(portStr, 10) : 25565;
  updateStatus(t('status.connecting', { ip: host }));
  showLaunchProgress(t('status.connecting', { ip: host }));
  if (!api?.launch) {
    clearLauncherTask('launch');
    return;
  }
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
    clearLauncherTask('launch');
    updateStatus(t('status.error', { msg: result.errorKey ? t(result.errorKey) : (result.error || t('common.error')) }));
  }
}

function updateStatus(message: string): void {
  const bannerSub = document.getElementById('quick-banner-sub');
  if (bannerSub) bannerSub.textContent = message;
  playStatusCue(message);
}

let appToastTimer: ReturnType<typeof setTimeout> | null = null;

/** Плавающий тост (мессенджер, скриншоты) — не трогает баннер главной */
function showAppToast(message: string, ms = 4200): void {
  const el = document.getElementById('app-toast');
  if (!el) {
    updateStatus(message);
    return;
  }
  el.hidden = false;
  el.textContent = message;
  el.classList.add('is-visible');
  playToastCue(message);
  if (appToastTimer) clearTimeout(appToastTimer);
  appToastTimer = setTimeout(() => {
    el.classList.remove('is-visible');
    appToastTimer = setTimeout(() => {
      el.hidden = true;
      appToastTimer = null;
    }, 200);
  }, ms);
}

/** Empty/loading для каталогов модов и серверов */
function catalogStateHtml(
  titleKey: string,
  descKey?: string,
  cta?: { labelKey: string; id: string },
): string {
  const desc = descKey
    ? `<div class="catalog-state__desc">${escapeAiHtml(t(descKey))}</div>`
    : '';
  const btn = cta
    ? `<button type="button" class="action-btn catalog-state__cta" id="${cta.id}"><span>${escapeAiHtml(t(cta.labelKey))}</span></button>`
    : '';
  return `<div class="catalog-state">
    <div class="catalog-state__title">${escapeAiHtml(t(titleKey))}</div>
    ${desc}
    ${btn}
  </div>`;
}

/** Скелетон-плейсхолдеры каталога модов (список / сетка) */
function modsSkeletonHtml(count = 8): string {
  const mode = getModsViewMode();
  if (mode === 'cards') {
    return Array.from({ length: count }, () =>
      `<article class="mod-skel mod-skel--tile" aria-hidden="true">
        <div class="mod-skel__hero"></div>
        <div class="mod-skel__body">
          <div class="mod-skel__head">
            <div class="mod-skel__icon"></div>
            <div class="mod-skel__lines">
              <div class="mod-skel__bar mod-skel__bar--title"></div>
              <div class="mod-skel__bar mod-skel__bar--sub"></div>
            </div>
          </div>
          <div class="mod-skel__bar mod-skel__bar--desc"></div>
          <div class="mod-skel__bar mod-skel__bar--desc-short"></div>
        </div>
      </article>`,
    ).join('');
  }
  return Array.from({ length: count }, () =>
    `<div class="mod-skel mod-skel--row" aria-hidden="true">
      <div class="mod-skel__icon"></div>
      <div class="mod-skel__lines">
        <div class="mod-skel__bar mod-skel__bar--title"></div>
        <div class="mod-skel__bar mod-skel__bar--sub"></div>
      </div>
    </div>`,
  ).join('');
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
        <img ${isEly ? '' : `src="${avatar.primary}" data-fallback="${avatar.fallback}"`} alt="" style="display:none;" onload="this.style.display=''">
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
      // Сразу переключаем UI; refresh MSA/Ely уходит в фон (как при старте)
      closeAccountPopup();
      await selectAccount(account);
      renderSavedAccounts();
    });
  });
  list.querySelectorAll<HTMLElement>('.acc-popup-row-del').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const uuid = btn.getAttribute('data-uuid');
      if (uuid && api?.removeAccount) {
        const wasCurrent = currentAccount?.uuid === uuid;
        await api.removeAccount(uuid);
        if (wasCurrent) {
          const remaining = api.loadAccounts ? await api.loadAccounts() : [];
          if (remaining.length) {
            await selectAccount(remaining[remaining.length - 1]);
          } else {
            showNoAccountState();
          }
        }
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
    if (!overlay || !msgEl || !yesBtn || !noBtn) { resolve(false); return; }
    msgEl.textContent = message;
    overlay.classList.remove('hidden');
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      overlay.classList.add('hidden');
      yesBtn.removeEventListener('click', onYes);
      noBtn.removeEventListener('click', onNo);
      overlay.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKey);
      resolve(value);
    };
    const onYes = () => finish(true);
    const onNo = () => finish(false);
    const onBackdrop = (e: MouseEvent) => {
      if (e.target === overlay) finish(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish(false);
    };
    yesBtn.addEventListener('click', onYes);
    noBtn.addEventListener('click', onNo);
    overlay.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey);
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
let modsSource: 'both' | 'modrinth' | 'curseforge' = (localStorage.getItem('Undefined Client-mods-source') as any) || 'both';
if (modsSource !== 'both' && modsSource !== 'modrinth' && modsSource !== 'curseforge') modsSource = 'both';
let modsVersion = '';
const modsLoaders = new Set<string>();
const modsTags = new Set<string>();
const modsKnownVersions = new Set<string>();
let modsVersionsManifestLoaded = false;
let modsVersionsManifestPromise: Promise<void> | null = null;

function modsPageSize(): number {
  const v = Number(localStorage.getItem('Undefined Client-mods-page-size') || '20');
  return [10, 20, 50].includes(v) ? v : 20;
}

/** Каталог API больше не кладёт versions в hits — берём релизы из манифеста Mojang. */
function ensureModsVersionFilter(): Promise<void> {
  if (modsVersionsManifestLoaded) {
    updateModsVersionSelect();
    return Promise.resolve();
  }
  if (modsVersionsManifestPromise) return modsVersionsManifestPromise;
  if (!api?.getVersions) return Promise.resolve();
  modsVersionsManifestPromise = api
    .getVersions()
    .then((versions) => {
      if (!Array.isArray(versions)) return;
      for (const v of versions) {
        const id = String(v?.id || '').trim();
        const type = String(v?.type || '');
        // В фильтре каталога — только релизы (как на сайте); снапшоты засоряют список
        if (!id || type !== 'release') continue;
        if (!/^\d+\.\d+(\.\d+)?$/.test(id)) continue;
        modsKnownVersions.add(id);
      }
      modsVersionsManifestLoaded = modsKnownVersions.size > 0;
      updateModsVersionSelect();
    })
    .catch(() => {})
    .finally(() => {
      modsVersionsManifestPromise = null;
    });
  return modsVersionsManifestPromise;
}

type ModsViewMode = 'list' | 'cards';

function getModsViewMode(): ModsViewMode {
  return localStorage.getItem('Undefined Client-mods-view-mode') === 'cards' ? 'cards' : 'list';
}

function applyModsViewModeUi(mode: ModsViewMode = getModsViewMode()): void {
  const grid = document.getElementById('mods-grid');
  const btn = document.getElementById('mods-view-toggle');
  grid?.classList.toggle('is-cards', mode === 'cards');
  if (btn) {
    btn.setAttribute('aria-pressed', mode === 'cards' ? 'true' : 'false');
    btn.dataset.mode = mode;
    const titleKey = mode === 'cards' ? 'mods.view.toggleToList' : 'mods.view.toggleToCards';
    btn.setAttribute('title', t(titleKey));
    btn.setAttribute('aria-label', t(titleKey));
  }
}

function setModsViewMode(mode: ModsViewMode): void {
  localStorage.setItem('Undefined Client-mods-view-mode', mode);
  applyModsViewModeUi(mode);
  modsRenderedCount = 0;
  renderMods(false);
}

function modAccentColor(p: any): string {
  if (p?.color == null) return 'rgba(255,255,255,0.05)';
  const n = Number(p.color);
  if (!Number.isFinite(n)) return 'rgba(255,255,255,0.05)';
  return `#${Math.max(0, Math.floor(n)).toString(16).padStart(6, '0')}`;
}

function modGalleryUrl(p: any): string | null {
  if (typeof p?.featured_gallery === 'string' && p.featured_gallery.trim()) {
    return p.featured_gallery.trim();
  }
  if (Array.isArray(p?.gallery) && p.gallery.length) {
    const first = p.gallery.find((u: unknown) => typeof u === 'string' && String(u).trim());
    return first ? String(first).trim() : null;
  }
  if (typeof p?.gallery === 'string' && p.gallery.trim()) return p.gallery.trim();
  return null;
}

const MOD_GALLERY_PLACEHOLDER = `<div class="mod-tile__hero-ph" aria-hidden="true">
  <img class="mod-tile__hero-ph-img" src="../../assets/images/modPlaceholder.png" alt="">
</div>`;

const MOD_CF_GALLERY_PLACEHOLDER = `<div class="mod-tile__hero-ph" aria-hidden="true">
  <img class="mod-tile__hero-ph-img" src="../../assets/images/modCFPlaceholder.png" alt="">
</div>`;

function modSourceOf(p: any): 'curseforge' | 'modrinth' {
  const raw = String(p?.source || '').toLowerCase();
  if (raw === 'curseforge' || raw === 'cf') return 'curseforge';
  if (String(p?.project_id || p?.id || '').startsWith('cf:')) return 'curseforge';
  return 'modrinth';
}

function modSourceBadge(source: 'curseforge' | 'modrinth'): string {
  return source === 'curseforge'
    ? `<span class="mod-source-badge mod-source-badge--cf">CurseForge</span>`
    : `<span class="mod-source-badge mod-source-badge--mr">Modrinth</span>`;
}

/** Относительные /client/api/catalog/image → абсолютные (в Electron иначе картинки ломаются). */
function absolutizeCatalogHtml(html: string): string {
  return String(html || '').replace(
    /(<img\b[^>]*?\bsrc=(["']))([^"']+)(\2)/gi,
    (_m, pre: string, _q: string, src: string, post: string) => {
      const abs = catalogImageUrl(src) || absoluteApiUrl(src) || src;
      return `${pre}${abs}${post}`;
    },
  );
}

function formatModsRelativeDate(raw?: string | null): string {
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  const sec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (sec < 60) return `${Math.max(1, sec)}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

function renderModListRow(p: any): string {
  const id = escapeHtml(String(p.project_id || p.slug || p.id || ''));
  const title = escapeHtml(String(p.title || 'Unknown'));
  const desc = escapeHtml(String(p.description || '').substring(0, 100));
  const accent = modAccentColor(p);
  const source = modSourceOf(p);
  const sourceBadge = modSourceBadge(source);
  const icon = p.icon_url
    ? `<img src="${escapeHtml(catalogImageUrl(p.icon_url))}" alt="">`
    : '<svg width="24" height="24" viewBox="0 0 20 20" fill="none"><rect width="20" height="20" rx="4" fill="#2A2A2A"/><path d="M6 4L14 10L6 16V4Z" fill="#fff"/></svg>';
  return `<div class="mod-card" data-modrinth-id="${id}" data-modrinth-type="${escapeHtml(String(p.project_type || 'mod'))}" data-mod-source="${escapeHtml(source)}">
      <div class="mod-card-icon" style="background:${accent}">${icon}</div>
      <div class="mod-card-info">
        <div class="mod-card-name">${title} ${sourceBadge}</div>
        <div class="mod-card-desc">${desc}</div>
      </div>
      <div class="mod-card-actions">
        <button class="details-btn" data-modrinth-id="${id}">${t('btn.details')}</button>
        <button class="details-btn ai-ask-mod-btn" data-modrinth-id="${id}" data-modrinth-title="${title}">${t('ai.askAboutMod')}</button>
        <button class="list-row-btn download-btn" data-modrinth-id="${id}">${t('btn.download')}</button>
      </div>
    </div>`;
}

function renderModTile(p: any): string {
  const id = escapeHtml(String(p.project_id || p.slug || p.id || ''));
  const title = escapeHtml(String(p.title || 'Unknown'));
  const desc = escapeHtml(String(p.description || '').substring(0, 120));
  const authorRaw = String(p.author || '').trim();
  const accent = modAccentColor(p);
  const gallery = modGalleryUrl(p);
  const source = modSourceOf(p);
  const sourceBadge = modSourceBadge(source);
  const icon = p.icon_url
    ? `<img src="${escapeHtml(catalogImageUrl(p.icon_url))}" alt="">`
    : '<svg width="24" height="24" viewBox="0 0 20 20" fill="none"><rect width="20" height="20" rx="4" fill="#2A2A2A"/><path d="M6 4L14 10L6 16V4Z" fill="#fff"/></svg>';
  const placeholder = source === 'curseforge' ? MOD_CF_GALLERY_PLACEHOLDER : MOD_GALLERY_PLACEHOLDER;
  const hero = gallery
    ? `<img class="mod-tile__hero-img" src="${escapeHtml(catalogImageUrl(gallery))}" alt="" loading="lazy">`
    : placeholder;
  const downloads = formatAiDownloads(p.downloads);
  const follows = formatAiDownloads(p.follows);
  const updated = formatModsRelativeDate(p.date_modified);
  return `<article class="mod-tile" data-modrinth-id="${id}" data-modrinth-type="${escapeHtml(String(p.project_type || 'mod'))}" data-mod-source="${escapeHtml(source)}">
      <div class="mod-tile__hero" style="--mod-accent:${accent}">${hero}</div>
      <div class="mod-tile__body">
        <div class="mod-tile__head">
          <div class="mod-tile__icon" style="background:${accent}">${icon}</div>
          <div class="mod-tile__titles">
            <div class="mod-tile__name">${title} ${sourceBadge}</div>
            ${authorRaw ? `<div class="mod-tile__author">${escapeHtml(t('mods.byAuthor', { author: authorRaw }))}</div>` : ''}
          </div>
        </div>
        <p class="mod-tile__desc">${desc}</p>
        <div class="mod-tile__stats">
          <span title="${escapeHtml(t('mods.stat.downloads'))}">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M6 1.5v6.5M3.5 5.5L6 8l2.5-2.5M2 10.5h8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
            ${escapeHtml(downloads)}
          </span>
          <span title="${escapeHtml(t('mods.stat.follows'))}">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M6 10.2l-4.1-3.7A2.6 2.6 0 016 2.7a2.6 2.6 0 014.1 3.8L6 10.2z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>
            ${escapeHtml(follows)}
          </span>
          ${updated ? `<span title="${escapeHtml(t('mods.stat.updated'))}">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><circle cx="6" cy="6" r="4.25" stroke="currentColor" stroke-width="1.2"/><path d="M6 3.5V6l1.8 1.2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
            ${escapeHtml(updated)}
          </span>` : ''}
        </div>
        <div class="mod-card-actions mod-tile__actions">
          <button class="details-btn" data-modrinth-id="${id}">${t('btn.details')}</button>
          <button class="details-btn ai-ask-mod-btn" data-modrinth-id="${id}" data-modrinth-title="${title}">${t('ai.askAboutMod')}</button>
          <button class="list-row-btn download-btn" data-modrinth-id="${id}">${t('btn.download')}</button>
        </div>
      </div>
    </article>`;
}

let modsRenderedCount = 0;
let modsLoadingMore = false;
let modsSentinelObserver: IntersectionObserver | null = null;

function modsHasMore(): boolean {
  return modsOffset < modsTotal;
}

function disconnectModsInfiniteScroll(): void {
  modsSentinelObserver?.disconnect();
  modsSentinelObserver = null;
}

function bindModsInfiniteScroll(grid: HTMLElement): void {
  disconnectModsInfiniteScroll();
  const sentinel = grid.querySelector<HTMLElement>('.mods-scroll-sentinel');
  if (!sentinel || !modsHasMore()) return;

  // root: null — скролл может быть и у #mods-grid, и у #tab-mods
  modsSentinelObserver = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      void loadMoreModsOnScroll();
    },
    { root: null, rootMargin: '200px 0px', threshold: 0 },
  );
  modsSentinelObserver.observe(sentinel);
}

async function loadMoreModsOnScroll(): Promise<void> {
  if (modsLoadingMore || !modsHasMore()) return;
  modsLoadingMore = true;
  const grid = document.getElementById('mods-grid');
  const status = grid?.querySelector<HTMLElement>('.mods-loading-more');
  if (status) status.hidden = false;
  try {
    await searchMods(modsQuery, currentCategory, true);
  } finally {
    modsLoadingMore = false;
    const g = document.getElementById('mods-grid');
    const s = g?.querySelector<HTMLElement>('.mods-loading-more');
    if (s) s.hidden = !modsLoadingMore;
  }
}

function renderMods(append: boolean = false): void {
  const grid = document.getElementById('mods-grid');
  if (!grid) return;
  applyModsViewModeUi();
  if (!modsData || modsData.length === 0) {
    disconnectModsInfiniteScroll();
    if (!append) grid.innerHTML = catalogStateHtml('mods.notFoundTitle', 'mods.notFoundDesc');
    return;
  }

  const mode = getModsViewMode();
  const newItems = append ? modsData.slice(modsRenderedCount) : modsData;
  modsRenderedCount = modsData.length;

  const cardsHtml = newItems
    .map((p) => (mode === 'cards' ? renderModTile(p) : renderModListRow(p)))
    .join('');
  const footerHtml = modsHasMore()
    ? `<div class="mods-scroll-sentinel" aria-hidden="true"></div>
       <div class="mods-loading-more"${modsLoadingMore ? '' : ' hidden'}>${t('common.loading')}</div>`
    : '';

  if (append) {
    grid.querySelector('.mods-scroll-sentinel')?.remove();
    grid.querySelector('.mods-loading-more')?.remove();
    grid.insertAdjacentHTML('beforeend', cardsHtml + footerHtml);
  } else {
    grid.innerHTML = cardsHtml + footerHtml;
  }

  // Details button
  grid.querySelectorAll<HTMLElement>('.details-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-modrinth-id');
      if (id) openModalDetails(id);
    });
  });

  grid.querySelectorAll<HTMLElement>('.ai-ask-mod-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-modrinth-id') || '';
      const title = btn.getAttribute('data-modrinth-title') || id;
      askAgentAboutMod(getAiUiHost(), title, id);
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

  bindModsInfiniteScroll(grid);
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
  const sourceSel = document.getElementById('mods-source-select') as HTMLSelectElement | null;
  if (sourceSel) {
    sourceSel.value = modsSource;
    const wrap = sourceSel.closest('.stngs-select-wrap');
    if (wrap) syncSelectUI(wrap as HTMLElement);
  }
  refreshModsClearBtn();
  searchMods('', 'all');
}

/**
 * Каталог модов — сетевой запрос к Modrinth. На старте вкладка не видна, поэтому
 * первую загрузку делаем при первом открытии вкладки (или в простое после старта).
 */
let modsCatalogRequested = false;

function ensureModsCatalog(): void {
  void ensureModsVersionFilter();
  if (modsCatalogRequested) return;
  modsCatalogRequested = true;
  loadMods();
}

async function searchMods(query: string, category: string, append: boolean = false): Promise<void> {
  const grid = document.getElementById('mods-grid');
  if (!grid) return;
  if (!append) {
    modsOffset = 0;
    modsLoadingMore = false;
    disconnectModsInfiniteScroll();
  }
  modsQuery = query;
  currentCategory = category;
  if (api?.getModrinthProjects) {
    if (!append) {
      applyModsViewModeUi();
      grid.innerHTML = modsSkeletonHtml();
      modsRenderedCount = 0;
    }
    try {
      const result = await api.getModrinthProjects(query || '', category === 'all' ? '' : category, modsOffset, modsPageSize(), {
        categories: [...modsTags],
        loaders: [...modsLoaders],
        version: modsVersion || undefined,
        index: modsSort,
        source: modsSource,
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
      // На случай если API снова начнёт отдавать versions / game_versions в hits
      for (const h of hits) {
        const list = h.versions || h.game_versions || [];
        if (!Array.isArray(list)) continue;
        for (const gv of list) {
          const id = String(gv || '').trim();
          if (id) modsKnownVersions.add(id);
        }
      }
      if (!modsVersionsManifestLoaded) void ensureModsVersionFilter();
      else updateModsVersionSelect();
      modsTotal = result.total_hits || 0;
      if (append) {
        modsData = modsData.concat(hits);
      } else {
        modsData = hits;
      }
      if (hits.length) modsOffset += modsPageSize();
      // Пустая страница при append — дальше грузить нечего
      if (append && hits.length === 0) modsTotal = modsOffset;
      renderMods(append);
    } catch {
      if (!append) grid.innerHTML = '<div style="padding:20px;text-align:center;color:rgba(255,255,255,0.3);font-weight:300;">' + t('mods.loadError') + '</div>';
    }
  }
}

// ===== Установка контента: быстрый подбор версии (как Modrinth) =====
let pendingDownloadVersionId: string = '';
let pendingDownloadGameVersions: string[] = [];
let pendingDownloadLoaders: string[] = [];
let pendingVersionsAll: any[] = [];
let pendingProjectType = 'mod';
let versionsUiMode: 'quick' | 'list' = 'quick';
let versionsPickGame = '';
let versionsPickLoader = '';
let versionsShowAll = false;
let versionsOpenDd: 'game' | 'loader' | null = null;

function isReleaseGameVersion(v: string): boolean {
  return /^\d+\.\d+(\.\d+)?$/.test(String(v || ''));
}

function collectVersionFacets(versions: any[]): { gameVersions: string[]; loaders: string[] } {
  const games = new Set<string>();
  const loaders = new Set<string>();
  for (const v of versions) {
    for (const g of v.game_versions || []) games.add(String(g));
    for (const l of v.loaders || []) {
      const id = String(l).toLowerCase();
      if (id && id !== 'minecraft') loaders.add(id);
    }
  }
  return {
    gameVersions: [...games].sort((a, b) => b.localeCompare(a, undefined, { numeric: true })),
    loaders: [...loaders],
  };
}

function versionsSelectorConfig(projectType: string, loaders: string[]) {
  const type = String(projectType || 'mod');
  if (type === 'shader') {
    return { showGame: true, showLoader: loaders.length > 0, loaderKind: 'platform' as const, loaders };
  }
  if (type === 'mod' || type === 'plugin') {
    return { showGame: true, showLoader: loaders.length > 1, loaderKind: 'loader' as const, loaders };
  }
  return { showGame: true, showLoader: false, loaderKind: 'loader' as const, loaders: [] as string[] };
}

function preferredContentLoader(loaders: string[]): string {
  for (const id of ['fabric', 'neoforge', 'forge', 'quilt', 'iris', 'optifine']) {
    if (loaders.includes(id)) return id;
  }
  return loaders[0] || '';
}

function filterGameVersionsList(all: string[], showAll: boolean): string[] {
  if (showAll) return all;
  const releases = all.filter(isReleaseGameVersion);
  return releases.length ? releases : all;
}

function findMatchingVersion(
  versions: any[],
  gameVersion: string,
  loader: string,
  needLoader: boolean,
): any | null {
  return (
    versions.find((v) => {
      if (gameVersion && !(v.game_versions || []).includes(gameVersion)) return false;
      if (needLoader && loader && !(v.loaders || []).map((x: string) => String(x).toLowerCase()).includes(loader)) {
        return false;
      }
      return true;
    }) || null
  );
}

function formatBytesShort(n: number): string {
  if (!n) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let value = n;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatRelativeIso(iso: string): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffSec = Math.round((then - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 3600) return t('mods.dl.justNow');
  if (abs < 86400) return t('mods.dl.hoursAgo', { n: Math.round(abs / 3600) });
  if (abs < 86400 * 7) return t('mods.dl.daysAgo', { n: Math.round(abs / 86400) });
  if (abs < 86400 * 30) return t('mods.dl.weeksAgo', { n: Math.round(abs / (86400 * 7)) });
  return new Date(iso).toLocaleDateString();
}

function versionTypeLabel(type: string): string {
  const key = `mods.versionType.${type}`;
  const translated = t(key);
  return translated === key ? type : translated;
}

function setVersionsMode(mode: 'quick' | 'list'): void {
  versionsUiMode = mode;
  if (mode !== 'quick') closeVersionsDropdown(false);
  const quick = document.getElementById('versions-quick');
  const list = document.getElementById('versions-list');
  const confirmBtn = document.getElementById('modal-versions-confirm') as HTMLButtonElement | null;
  const backBtn = document.getElementById('modal-versions-back') as HTMLButtonElement | null;
  const subEl = document.getElementById('modal-versions-sub');
  if (quick) quick.hidden = mode !== 'quick';
  if (list) list.hidden = mode !== 'list';
  if (confirmBtn) confirmBtn.hidden = mode !== 'list';
  if (backBtn) backBtn.hidden = mode !== 'list';
  if (subEl) {
    subEl.textContent = mode === 'list' ? t('mods.versionsSub') : t('mods.dl.title');
  }
}

async function confirmPendingVersionInstall(): Promise<void> {
  if (!pendingTargetProjectId || !pendingDownloadVersionId) return;
  const hostInstall = hostCatalogInstall;
  hostCatalogInstall = null;
  versionsHostLock = false;
  closeVersionsDropdown(false);
  closeModal('modal-versions');
  if (hostInstall) {
    const version = pendingVersionsAll.find((row) => row.id === pendingDownloadVersionId);
    if (version) await hostInstall(version);
    return;
  }
  const projectInfo = await api?.getModrinthProject(pendingTargetProjectId);
  if (projectInfo?.project_type === 'modpack') {
    updateStatus(t('status.downloadingPack'));
    const result = await api?.downloadMod(pendingTargetProjectId, pendingDownloadVersionId);
    if (result?.success) {
      updateStatus(t('status.packInstalled'));
      await loadBuilds();
      const hook = afterContentInstall;
      afterContentInstall = null;
      hook?.();
    } else {
      updateStatus(t('status.error', { msg: result?.error || t('common.unknown') }));
    }
  } else {
    openModalTargetBuildForDownload(pendingTargetProjectId);
  }
}

const VERSIONS_SELECT_CHEVRON =
  '<svg class="stngs-select-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 4L6 8L10 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

let versionsPortalMenu: HTMLElement | null = null;
let versionsPortalHost: HTMLElement | null = null;
let versionsCloseAnimTimer: ReturnType<typeof setTimeout> | null = null;

function restoreVersionsPortalMenu(): void {
  if (versionsCloseAnimTimer) {
    clearTimeout(versionsCloseAnimTimer);
    versionsCloseAnimTimer = null;
  }
  if (versionsPortalMenu && versionsPortalHost && versionsPortalMenu.isConnected) {
    versionsPortalMenu.classList.remove('is-portal', 'open', 'closing');
    versionsPortalMenu.style.cssText = '';
    versionsPortalHost.appendChild(versionsPortalMenu);
  } else if (versionsPortalMenu?.isConnected && versionsPortalMenu.parentElement === document.body) {
    versionsPortalMenu.remove();
  }
  versionsPortalMenu = null;
  versionsPortalHost = null;
  document.querySelectorAll('#versions-quick .stngs-select-wrap.open').forEach((w) => w.classList.remove('open'));
  versionsOpenDd = null;
}

function closeVersionsDropdown(animated = true): void {
  if (!versionsPortalMenu) {
    document.querySelectorAll('#versions-quick .stngs-select-wrap.open').forEach((w) => w.classList.remove('open'));
    versionsOpenDd = null;
    return;
  }
  if (!animated) {
    restoreVersionsPortalMenu();
    return;
  }
  const menu = versionsPortalMenu;
  menu.classList.remove('open');
  menu.classList.add('closing');
  if (versionsCloseAnimTimer) clearTimeout(versionsCloseAnimTimer);
  versionsCloseAnimTimer = setTimeout(() => {
    restoreVersionsPortalMenu();
  }, 130);
}

function openVersionsDropdown(kind: 'game' | 'loader'): void {
  if (versionsOpenDd === kind) {
    closeVersionsDropdown(true);
    return;
  }
  closeVersionsDropdown(false);
  const wrap = document.querySelector(`#versions-quick [data-vdd="${kind}"]`) as HTMLElement | null;
  if (!wrap) return;
  const btn = wrap.querySelector('.stngs-select-btn') as HTMLElement | null;
  const menu = wrap.querySelector('.stngs-select-menu') as HTMLElement | null;
  if (!btn || !menu) return;

  versionsOpenDd = kind;
  versionsPortalHost = wrap;
  versionsPortalMenu = menu;
  wrap.classList.add('open');

  const rect = btn.getBoundingClientRect();
  const width = Math.max(rect.width, 170);
  let left = rect.left;
  if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
  left = Math.max(8, left);

  document.body.appendChild(menu);
  menu.classList.add('is-portal');
  menu.style.position = 'fixed';
  menu.style.left = `${left}px`;
  menu.style.top = `${rect.bottom + 6}px`;
  menu.style.minWidth = `${width}px`;
  menu.style.right = 'auto';
  menu.style.zIndex = '20000';
  menu.classList.remove('closing');
  void menu.offsetWidth;
  menu.classList.add('open');
}

function renderVersionsQuickPanel(): void {
  closeVersionsDropdown(false);
  const root = document.getElementById('versions-quick');
  if (!root) return;
  const facets = collectVersionFacets(pendingVersionsAll);
  const cfg = versionsSelectorConfig(pendingProjectType, facets.loaders);
  const games = filterGameVersionsList(facets.gameVersions, versionsShowAll);
  const matching = findMatchingVersion(
    pendingVersionsAll,
    versionsPickGame,
    versionsPickLoader,
    Boolean(versionsPickLoader),
  );

  const dd = (kind: 'game' | 'loader', placeholder: string, value: string, options: string[], withShowAll: boolean) => {
    const label = value
      ? kind === 'game'
        ? value
        : value.charAt(0).toUpperCase() + value.slice(1)
      : placeholder;
    const items = options
      .map((opt) => {
        const text = kind === 'game' ? opt : opt.charAt(0).toUpperCase() + opt.slice(1);
        return `<div class="stngs-select-opt${opt === value ? ' selected' : ''}" data-vdd-opt="${opt}" data-vdd-kind="${kind}">${text}</div>`;
      })
      .join('');
    const footer = withShowAll
      ? `<label class="versions-showall">
           <input type="checkbox" id="versions-show-all"${versionsShowAll ? ' checked' : ''} />
           <span>${t('mods.dl.showAllVersions')}</span>
         </label>`
      : '';
    return `
      <div class="stngs-select-wrap mods-select-wrap versions-select-wrap" data-vdd="${kind}">
        <button type="button" class="stngs-select-btn${value ? '' : ' is-placeholder'}" data-vdd-toggle="${kind}">
          <span class="stngs-select-value">${label}</span>
          ${VERSIONS_SELECT_CHEVRON}
        </button>
        <div class="stngs-select-menu select-scroll-menu">
          ${items || `<div class="stngs-select-opt" style="opacity:.5;cursor:default">${t('mods.dl.noOptions')}</div>`}
          ${footer}
        </div>
      </div>`;
  };

  let resultHtml = '';
  if (!versionsPickGame && cfg.showGame) {
    resultHtml = `<div class="dl-manual__status">${t('mods.dl.pickGame')}</div>`;
  } else if (cfg.showLoader && !versionsPickLoader) {
    resultHtml = `<div class="dl-manual__status">${
      cfg.loaderKind === 'platform' ? t('mods.dl.pickPlatform') : t('mods.dl.pickLoader')
    }</div>`;
  } else if (!matching) {
    resultHtml = `<div class="dl-manual__status">${t('mods.dl.noMatch')}</div>`;
  } else {
    const title = matching.version_number || matching.name || '—';
    const type = matching.version_type || 'release';
    const size = matching.file?.size || matching.files?.[0]?.size || 0;
    const meta = [formatRelativeIso(matching.date_published || ''), formatBytesShort(Number(size) || 0)]
      .filter(Boolean)
      .join(' · ');
    resultHtml = `
      <div class="dl-manual__card">
        <div class="dl-manual__card-main">
          <div class="dl-manual__card-title">
            <strong>${title}</strong>
            <span class="dl-manual__type dl-manual__type--${type}">${versionTypeLabel(type)}</span>
          </div>
          <div class="dl-manual__card-meta">${meta}</div>
        </div>
        <button type="button" class="stngs-btn primary dl-manual__install" data-vdd-install="${matching.id}">
          ${t('btn.install')}
        </button>
      </div>`;
  }

  root.innerHTML = `
    <div class="dl-manual__label">${t('mods.dl.title')}</div>
    <div class="dl-manual__row${cfg.showLoader ? ' has-two' : ''}">
      ${cfg.showGame ? dd('game', t('mods.dl.selectGame'), versionsPickGame, games, true) : ''}
      ${
        cfg.showLoader
          ? dd(
              'loader',
              cfg.loaderKind === 'platform' ? t('mods.dl.selectPlatform') : t('mods.dl.selectLoader'),
              versionsPickLoader,
              cfg.loaders,
              false,
            )
          : ''
      }
    </div>
    <div class="dl-manual__result">${resultHtml}</div>
    <button type="button" class="dl-manual__specific" data-vdd-specific>${t('mods.dl.specificVersion')}</button>`;
}

function renderVersionsListPanel(versions: any[]): void {
  const list = document.getElementById('versions-list');
  const confirmBtn = document.getElementById('modal-versions-confirm') as HTMLButtonElement | null;
  const subEl = document.getElementById('modal-versions-sub');
  if (!list) return;
  if (confirmBtn) confirmBtn.disabled = true;
  if (!versions.length) {
    list.innerHTML = `<div style="padding:16px;text-align:center;color:rgba(255,255,255,0.3);">${t('mods.versionsNone')}</div>`;
    if (subEl) subEl.textContent = t('mods.versionsNoneShort');
    return;
  }
  if (subEl) subEl.textContent = t('mods.versionsCount', { n: versions.length });
  list.innerHTML = versions
    .map((v: any) => {
      const loaders = (v.loaders || [])
        .map((l: string) => `<span class="version-loader-tag">${l}</span>`)
        .join('');
      const gv = (v.game_versions || []).slice(0, 3).join(', ');
      const type = v.version_type || 'release';
      return `<div class="version-item" data-version-id="${v.id}">
        <div class="version-item-name">${v.name || v.version_number || '—'}
          <span class="dl-manual__type dl-manual__type--${type}">${versionTypeLabel(type)}</span>
        </div>
        <div class="version-item-loaders">${loaders}</div>
        <div class="version-item-meta">${gv}</div>
      </div>`;
    })
    .join('');
  list.querySelectorAll('.version-item').forEach((el) => {
    el.addEventListener('click', () => {
      list.querySelectorAll('.version-item.selected').forEach((e) => e.classList.remove('selected'));
      el.classList.add('selected');
      if (confirmBtn) confirmBtn.disabled = false;
      const vid = el.getAttribute('data-version-id');
      const vobj = versions.find((v) => v.id === vid);
      pendingDownloadGameVersions = vobj?.game_versions || [];
      pendingDownloadLoaders = (vobj?.loaders || []).map((l: string) => String(l).toLowerCase());
    });
  });
}

function openModalVersionsForDownload(projectId: string): void {
  if (!versionsHostLock) {
    hostCatalogInstall = null;
    versionsPreferGame = '';
    versionsPreferLoader = '';
  }
  versionsHostLock = false;
  pendingDownloadVersionId = '';
  pendingDownloadGameVersions = [];
  pendingDownloadLoaders = [];
  pendingTargetProjectId = projectId;
  pendingVersionsAll = [];
  pendingProjectType = 'mod';
  versionsUiMode = 'quick';
  // Из редактора сборки — сразу подставляем MC/loader этой сборки.
  // Из каталога плагинов — версию и ядро открытого сервера.
  const beMeta = editingBuildId && !hostCatalogInstall ? getEditingBuildCatalogMeta() : null;
  versionsPickGame = versionsPreferGame || beMeta?.gameVersion || modsVersion || '';
  versionsPickLoader = versionsPreferLoader
    || (beMeta?.loader && beMeta.loader !== 'vanilla' ? beMeta.loader : '')
    || (modsLoaders.size === 1 ? [...modsLoaders][0] : '');
  versionsShowAll = false;
  versionsOpenDd = null;

  const titleEl = document.getElementById('modal-versions-title');
  const subEl = document.getElementById('modal-versions-sub');
  const quick = document.getElementById('versions-quick');
  const list = document.getElementById('versions-list');
  const confirmBtn = document.getElementById('modal-versions-confirm') as HTMLButtonElement | null;
  if (titleEl) titleEl.textContent = t('mods.versionsTitle');
  if (subEl) subEl.textContent = t('mods.dl.title');
  if (quick) quick.innerHTML = `<div class="dl-manual__status">${t('common.loading')}</div>`;
  if (list) list.innerHTML = '';
  if (confirmBtn) confirmBtn.disabled = true;
  setVersionsMode('quick');
  openModal('modal-versions');

  void (async () => {
    const [versions, projectInfo] = await Promise.all([
      api?.getModrinthVersions(projectId) || Promise.resolve([]),
      api?.getModrinthProject(projectId),
    ]);
    pendingVersionsAll = Array.isArray(versions) ? versions : [];
    pendingProjectType = String(projectInfo?.project_type || 'mod');

    if (!pendingVersionsAll.length) {
      if (quick) quick.innerHTML = `<div class="dl-manual__status">${t('mods.versionsNone')}</div>`;
      if (subEl) subEl.textContent = t('mods.versionsNoneShort');
      return;
    }

    const facets = collectVersionFacets(pendingVersionsAll);
    const cfg = versionsSelectorConfig(pendingProjectType, facets.loaders);
    const games = filterGameVersionsList(facets.gameVersions, versionsShowAll);

    // Каталог-фильтры, если ещё подходят
    if (versionsPickGame && !games.includes(versionsPickGame)) versionsPickGame = '';
    if (!versionsPickGame) versionsPickGame = games[0] || '';
    if (cfg.showLoader) {
      if (versionsPickLoader && !cfg.loaders.includes(versionsPickLoader)) versionsPickLoader = '';
      if (!versionsPickLoader) versionsPickLoader = preferredContentLoader(cfg.loaders);
    } else if (
      (pendingProjectType === 'mod' || pendingProjectType === 'shader') &&
      facets.loaders.length === 1
    ) {
      versionsPickLoader = facets.loaders[0];
    } else {
      versionsPickLoader = '';
    }

    renderVersionsQuickPanel();
  })();
}

document.getElementById('versions-quick')?.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const toggle = target.closest('[data-vdd-toggle]') as HTMLElement | null;
  if (toggle) {
    e.stopPropagation();
    const kind = toggle.getAttribute('data-vdd-toggle') as 'game' | 'loader';
    openVersionsDropdown(kind);
    return;
  }
  if (target.closest('[data-vdd-specific]')) {
    closeVersionsDropdown(false);
    setVersionsMode('list');
    renderVersionsListPanel(pendingVersionsAll);
    return;
  }
  const installBtn = target.closest('[data-vdd-install]') as HTMLElement | null;
  if (installBtn) {
    closeVersionsDropdown(false);
    pendingDownloadVersionId = installBtn.getAttribute('data-vdd-install') || '';
    const vobj = pendingVersionsAll.find((v) => v.id === pendingDownloadVersionId);
    pendingDownloadGameVersions = vobj?.game_versions || [];
    pendingDownloadLoaders = (vobj?.loaders || []).map((l: string) => String(l).toLowerCase());
    void confirmPendingVersionInstall();
  }
});

// Меню селектора вынесено в body — обрабатываем клики отдельно
document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const opt = target.closest('.stngs-select-menu.is-portal [data-vdd-opt]') as HTMLElement | null;
  if (opt) {
    e.stopPropagation();
    const kind = opt.getAttribute('data-vdd-kind');
    const value = opt.getAttribute('data-vdd-opt') || '';
    if (kind === 'game') versionsPickGame = value;
    if (kind === 'loader') versionsPickLoader = value;
    closeVersionsDropdown(true);
    // После анимации закрытия перерисуем карточку
    setTimeout(() => renderVersionsQuickPanel(), 140);
    return;
  }
  if (versionsOpenDd && !target.closest('#versions-quick [data-vdd-toggle]') && !target.closest('.stngs-select-menu.is-portal')) {
    closeVersionsDropdown(true);
  }
});

window.addEventListener('uclient-host-catalog', (event) => {
  const detail = (event as CustomEvent).detail || {};
  const projectId = String(detail.projectId || '');
  if (!projectId) return;
  if (detail.mode === 'ask') {
    askAgentAboutMod(getAiUiHost(), String(detail.title || projectId), projectId);
    return;
  }
  hostCatalogInstall = typeof detail.install === 'function' ? detail.install : null;
  versionsPreferGame = String(detail.gameVersion || '');
  versionsPreferLoader = String(detail.loader || '');
  versionsHostLock = true;
  if (detail.mode === 'versions') openModalVersionsForDownload(projectId);
  else void openModalDetails(projectId);
});

document.addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement;
  if (input?.id !== 'versions-show-all') return;
  versionsShowAll = !!input.checked;
  const facets = collectVersionFacets(pendingVersionsAll);
  const games = filterGameVersionsList(facets.gameVersions, versionsShowAll);
  if (versionsPickGame && !games.includes(versionsPickGame)) {
    versionsPickGame = games[0] || '';
  }
  // Обновляем список опций, оставляя меню открытым
  const wasOpen = versionsOpenDd;
  renderVersionsQuickPanel();
  if (wasOpen === 'game') openVersionsDropdown('game');
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && versionsOpenDd) closeVersionsDropdown(true);
});

document.getElementById('modal-versions-back')?.addEventListener('click', () => {
  setVersionsMode('quick');
  renderVersionsQuickPanel();
});

document.getElementById('modal-versions-confirm')?.addEventListener('click', async () => {
  const selected = document.querySelector('#versions-list .version-item.selected');
  if (!selected || !pendingTargetProjectId) return;
  pendingDownloadVersionId = selected.getAttribute('data-version-id') || '';
  const vobj = pendingVersionsAll.find((v) => v.id === pendingDownloadVersionId);
  pendingDownloadGameVersions = vobj?.game_versions || [];
  pendingDownloadLoaders = (vobj?.loaders || []).map((l: string) => String(l).toLowerCase());
  await confirmPendingVersionInstall();
});

/**
 * Совместимость выбранной версии контента со сборкой.
 * Загрузчик учитываем только для модов (как в deep link).
 */
function contentVersionFitsBuild(
  gameVersions: string[],
  loaders: string[],
  build: Build,
  type: string,
): boolean {
  const anyGame = build.gameVersion === 'latest_release' || build.gameVersion === 'latest_snapshot';
  if (!anyGame && gameVersions.length && !gameVersions.includes(build.gameVersion)) return false;
  if (type === 'mod' && loaders.length) {
    const real = loaders
      .map((l) => String(l).toLowerCase())
      .filter((l) => l && l !== 'minecraft' && l !== 'datapack');
    if (real.length && !real.includes(String(build.loader || '').toLowerCase())) return false;
  }
  return true;
}

function openModalTargetBuildForDownload(projectId: string): void {
  // Открытая сборка в редакторе — ставим сразу, если версия подходит
  if (editingBuildId) {
    const editing = savedBuilds.find((b) => b.id === editingBuildId);
    if (
      editing &&
      contentVersionFitsBuild(
        pendingDownloadGameVersions,
        pendingDownloadLoaders,
        editing,
        pendingProjectType,
      )
    ) {
      updateStatus(t('status.downloading'));
      void downloadModToBuild(projectId, editing.id, pendingDownloadVersionId, pendingProjectType);
      return;
    }
  }

  const list = document.getElementById('target-build-list');
  const confirmBtn = document.getElementById('modal-target-confirm') as HTMLButtonElement;
  if (!list) return;
  if (confirmBtn) confirmBtn.disabled = true;

  if (savedBuilds.length === 0) {
    list.innerHTML = '<div style="padding:16px;text-align:center;color:rgba(255,255,255,0.3);">' + t('mods.noBuildsForInstall') + '</div>';
  } else {
    list.innerHTML = savedBuilds.map(b => {
      const iconSrc = b.icon ? buildIconSrc(b.icon) : DEFAULT_BUILD_ICON_SRC;
      const compatible = contentVersionFitsBuild(
        pendingDownloadGameVersions,
        pendingDownloadLoaders,
        b,
        pendingProjectType,
      );
      const compatCls = compatible ? '' : ' incompatible';
      const compatAttr = compatible ? '' : ` title="${t('mods.incompatibleBuild')}"`;
      return `<div class="build-option-item${compatCls}" data-build-id="${b.id}"${compatAttr}>
        <div class="build-option-icon" style="background:transparent"><img src="${iconSrc}" style="width:100%;height:100%;object-fit:cover;"></div>
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
  await downloadModToBuild(pendingTargetProjectId, buildId, pendingDownloadVersionId, pendingProjectType);
});

async function downloadModToBuild(
  projectId: string,
  buildId: string,
  versionId?: string,
  contentTypeHint?: string,
  options?: { force?: boolean; skipDeps?: boolean; installOptional?: boolean },
): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await api?.installMod(buildId, projectId, versionId, contentTypeHint, options);
    if (result?.error === 'mod_conflicts' && !options?.force) {
      const lines = (result.conflicts || [])
        .map((c) => `• ${c.title} ↔ ${c.withTitle}`)
        .slice(0, 8);
      const depsNote =
        result.pendingDeps && result.pendingDeps > 0
          ? `\n\n${t('mods.depsWillInstall', { n: result.pendingDeps })}`
          : '';
      const msgEl = document.getElementById('confirm-message');
      if (msgEl) msgEl.style.whiteSpace = 'pre-wrap';
      const ok = await confirmAction(
        `${t('mods.depsConflictConfirm')}\n\n${lines.join('\n')}${depsNote}`,
      );
      if (msgEl) msgEl.style.whiteSpace = '';
      if (!ok) {
        updateStatus(t('mods.depsInstallCancelled'));
        return { success: false, error: 'cancelled' };
      }
      return downloadModToBuild(projectId, buildId, versionId, contentTypeHint, {
        ...options,
        force: true,
      });
    }

    if (result?.success) {
      const contentType = result.contentType || 'mod';
      const typeLabel: Record<string, string> = {
        mod: t('type.mod'),
        resourcepack: t('type.resourcepack'),
        shader: t('type.shader'),
        datapack: t('type.datapack'),
      };
      const depCount = result.dependenciesInstalled || 0;
      if (depCount > 0) {
        updateStatus(
          t('status.typeInstalledWithDeps', {
            type: typeLabel[contentType] || t('type.file'),
            n: depCount,
          }),
        );
      } else {
        updateStatus(t('status.typeInstalled', { type: typeLabel[contentType] || t('type.file') }));
      }

      const build = savedBuilds.find((b) => b.id === buildId);
      if (build) {
        const buildMap: Record<string, string> = {
          mod: 'mods',
          resourcepack: 'resourcePacks',
          shader: 'shaders',
          datapack: 'dataPacks',
        };
        const items =
          result.installed && result.installed.length
            ? result.installed
            : result.name && result.filename
              ? [
                  {
                    name: result.name,
                    version: result.version || '',
                    filename: result.filename,
                    projectId: result.projectId || projectId,
                    iconUrl: result.iconUrl || '',
                    description: result.description || '',
                    contentType,
                    isDependency: false,
                  },
                ]
              : [];

        for (const item of items) {
          const buildKey = buildMap[item.contentType || contentType] || 'mods';
          if (!(build as any)[buildKey]) (build as any)[buildKey] = [];
          const arr = (build as any)[buildKey] as BeFileItem[];
          const existingIdx = arr.findIndex(
            (m) =>
              (item.projectId && m.projectId === item.projectId) ||
              (item.filename && m.filename === item.filename),
          );
          const entry: BeFileItem = {
            name: item.name,
            enabled: true,
            filename: item.filename,
            version: item.version || '',
            description: item.description || '',
            projectId: item.projectId || '',
            iconUrl: item.iconUrl || '',
          };
          if (existingIdx >= 0) arr[existingIdx] = { ...arr[existingIdx], ...entry };
          else arr.push(entry);
        }
        if (api?.saveBuild) await api.saveBuild(build);
      }

      if (result.conflicts?.length) {
        pushConsoleLog(
          t('mods.depsConflictLog', {
            list: result.conflicts.map((c) => `${c.title} ↔ ${c.withTitle}`).join(', '),
          }),
        );
      }
      if (result.optionalSuggested?.length) {
        pushConsoleLog(
          t('mods.depsOptionalLog', {
            list: result.optionalSuggested.map((o) => o.title).join(', '),
          }),
        );
      }
      if (result.unresolved?.length) {
        pushConsoleLog(
          t('mods.depsUnresolvedLog', {
            list: result.unresolved.map((u) => u.projectId).join(', '),
          }),
        );
      }

      await loadBuilds();
      return { success: true };
    }

    const errKey =
      result?.error === 'no_compatible_version'
        ? 'mods.depsNoCompatible'
        : result?.error === 'project_not_found'
          ? 'mods.depsProjectMissing'
          : null;
    updateStatus(t('status.error', { msg: errKey ? t(errKey) : result?.error || t('common.unknown') }));
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
    const iconSrc = b.icon ? buildIconSrc(b.icon) : DEFAULT_BUILD_ICON_SRC;
    const compatible = deepLinkFixedVersion
      ? dlVersionFitsBuild(deepLinkFixedVersion, b, payload.type)
      : resolved.versions.some(v => dlVersionFitsBuild(v, b, payload.type));
    if (compatible) compatibleCount++;
    const compatCls = compatible ? '' : ' incompatible';
    const compatAttr = compatible ? '' : ` title="${t('mods.incompatibleBuild')}"`;
    return `<div class="build-option-item${compatCls}" data-build-id="${srvEsc(b.id)}"${compatAttr}>
      <div class="build-option-icon" style="background:transparent"><img src="${srvEsc(iconSrc)}" style="width:100%;height:100%;object-fit:cover;"></div>
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
  if (payload.action === 'join-group') {
    switchTab('messenger');
    await ensureMessengerTab(true);
    await openGroupInviteModal(payload.token);
    return;
  }
  if (payload.action === 'launch') {
    await handleDeepLinkLaunch(payload.id);
    return;
  }
  await handleDeepLinkInstall(payload);
}

/** Запуск сборки по ярлыку `uclient://launch?id=…`. */
async function handleDeepLinkLaunch(buildId: string): Promise<void> {
  const id = String(buildId || '').trim();
  if (!id) return;
  if (!savedBuilds.length && api?.loadBuilds) {
    await loadBuilds();
  }
  const build = savedBuilds.find((b) => b.id === id);
  if (!build) {
    updateStatus(t('status.error', { msg: t('share.errBuild') }));
    switchTab('builds');
    return;
  }
  switchTab('builds');
  await launchBuild(build);
}

/** Точка входа: сюда попадают ссылки и холодного старта, и запущенного лаунчера. */
async function handleDeepLinkInstall(payload: DeepLinkInstall | null): Promise<void> {
  if (!payload || payload.action !== 'install') return;
  if (payload.source !== 'modrinth' && payload.source !== 'curseforge') return;
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
  return buildCardIconHtml(build);
}

let shareMenuBuild: Build | null = null;
let exportBusy = false;
let shareMenuCloseTimer: ReturnType<typeof setTimeout> | null = null;

function hideBuildShareMenu(): void {
  const menu = document.getElementById('build-share-menu');
  shareMenuBuild = null;
  if (!menu || menu.hidden) return;
  if (menu.classList.contains('closing')) return;

  if (shareMenuCloseTimer) {
    clearTimeout(shareMenuCloseTimer);
    shareMenuCloseTimer = null;
  }

  menu.classList.remove('open');
  menu.classList.add('closing');
  const finish = () => {
    menu.classList.remove('closing');
    menu.hidden = true;
    shareMenuCloseTimer = null;
  };
  const onEnd = (e: AnimationEvent) => {
    if (e.target !== menu) return;
    menu.removeEventListener('animationend', onEnd);
    finish();
  };
  menu.addEventListener('animationend', onEnd);
  // Запасной таймер, если animationend не пришёл
  shareMenuCloseTimer = setTimeout(() => {
    menu.removeEventListener('animationend', onEnd);
    finish();
  }, 200);
}

async function createBuildDesktopShortcut(build: Build): Promise<void> {
  if (!api?.createBuildShortcut) {
    updateStatus(t('share.shortcutFail'));
    return;
  }
  try {
    const res = await api.createBuildShortcut(build.id);
    if (res?.success) {
      updateStatus(t('share.shortcutDone', { name: res.name || build.name }));
      return;
    }
    if (res?.error === 'unsupported_platform') {
      updateStatus(t('share.shortcutUnsupported'));
      return;
    }
    updateStatus(t('share.shortcutFail'));
  } catch {
    updateStatus(t('share.shortcutFail'));
  }
}

function openBuildShareMenu(anchor: HTMLElement, build: Build): void {
  const menu = document.getElementById('build-share-menu');
  if (!menu) {
    void openShareModal(build);
    return;
  }

  if (shareMenuCloseTimer) {
    clearTimeout(shareMenuCloseTimer);
    shareMenuCloseTimer = null;
  }

  shareMenuBuild = build;
  menu.classList.remove('closing', 'open');
  menu.hidden = false;

  const rect = anchor.getBoundingClientRect();
  const menuW = Math.max(220, menu.offsetWidth || 220);
  const menuH = menu.offsetHeight || 160;
  let left = rect.left;
  let top = rect.bottom + 6;
  let placement: 'above' | 'below' = 'below';
  if (left + menuW > window.innerWidth - 8) left = window.innerWidth - menuW - 8;
  if (top + menuH > window.innerHeight - 8) {
    top = rect.top - menuH - 6;
    placement = 'above';
  }
  menu.dataset.placement = placement;
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;

  // Перезапуск анимации после позиционирования
  void menu.offsetWidth;
  menu.classList.add('open');
}

async function runInstanceExport(kind: 'zip' | 'mrpack', build: Build): Promise<void> {
  if (exportBusy) {
    updateStatus(t('share.exportBusy'));
    return;
  }
  exportBusy = true;
  updateStatus(t('share.exportPreparing'));
  upsertLauncherTask({
    id: 'export',
    title: t('tasks.export'),
    stage: t('share.exportPreparing'),
    percent: null,
    detail: '',
  });
  const off = api?.onInstanceExportProgress?.((data) => {
    const phase = String(data?.phase || '');
    const file = String(data?.filename || '');
    let stage = t('share.exportPreparing');
    if (phase === 'pack' && file) stage = t('share.exportPacking', { file });
    else if (phase === 'resolve' && file) stage = t('share.exportResolving', { file });
    updateStatus(stage);
    upsertLauncherTask({
      id: 'export',
      title: t('tasks.export'),
      stage,
      percent: null,
      detail: '',
    });
  }) || null;

  try {
    const result = kind === 'zip'
      ? await api?.exportInstanceZip?.(build.id)
      : await api?.exportInstanceMrpack?.(build.id);
    if (!result?.ok) {
      if (result?.error === 'cancelled') updateStatus(t('share.exportCancelled'));
      else {
        updateStatus(t('share.exportFailed'));
        upsertLauncherTask({ id: 'export', title: t('tasks.export'), stage: t('share.exportFailed'), percent: null, detail: '', tone: 'error' });
        finishLauncherTask('export');
      }
      return;
    }
    updateStatus(t('share.exportDone', { path: result.path || '' }));
    upsertLauncherTask({
      id: 'export',
      title: t('tasks.export'),
      stage: t('share.exportDone', { path: result.path || '' }),
      percent: 100,
      detail: '',
      tone: 'success',
    });
    finishLauncherTask('export');
  } catch {
    updateStatus(t('share.exportFailed'));
    upsertLauncherTask({ id: 'export', title: t('tasks.export'), stage: t('share.exportFailed'), percent: null, detail: '', tone: 'error' });
    finishLauncherTask('export');
  } finally {
    off?.();
    exportBusy = false;
    clearLauncherTask('export');
  }
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
      syncTaskFromCounted('share', t('tasks.export'), t('share.phaseHash', { file: filename }), current, total);
    } else if (phase === 'upload' && total > 0) {
      shareSetProgress(current / total, t('share.phaseUpload', { file: filename }));
      shareSetText('share-sub', t('share.uploading'));
      syncTaskFromCounted('share', t('tasks.export'), t('share.phaseUpload', { file: filename }), current, total);
    } else if (phase === 'prepare') {
      shareSetProgress(0, t('share.preparing'));
      upsertLauncherTask({
        id: 'share',
        title: t('tasks.export'),
        stage: t('share.preparing'),
        percent: null,
        detail: '',
      });
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
    clearLauncherTask('share');
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
  const filesWrap = document.getElementById('share-import-files-wrap');
  const filesEl = document.getElementById('share-import-files');
  if (filesWrap) filesWrap.classList.add('hidden');
  if (filesEl) filesEl.innerHTML = '';
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
  if (filesEl && filesWrap && Array.isArray(m.files) && m.files.length) {
    const shown = m.files.slice(0, 40);
    const more = m.files.length - shown.length;
    filesEl.innerHTML =
      shown
        .map((f) => {
          const kind = String(f.contentType || 'mod');
          const kindKey = `import.manifest.kind.${kind === 'resourcepack' ? 'resourcepack' : kind}`;
          const kindLabel = t(kindKey) !== kindKey ? t(kindKey) : kind;
          const label = f.name || f.filename || '—';
          return `<div class="import-manifest-file"><span class="import-manifest-file-kind">${escapeManifestText(kindLabel)}</span><span class="import-manifest-file-name" title="${escapeManifestText(label)}">${escapeManifestText(label)}</span></div>`;
        })
        .join('') +
      (more > 0 ? `<div class="import-manifest-more">${t('import.manifest.more', { n: more })}</div>` : '');
    filesWrap.classList.remove('hidden');
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
      syncTaskFromCounted('share-import', t('tasks.import'), t('shareImport.phaseFile', { file: filename }), current, total);
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
    clearLauncherTask('share-import');
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

document.getElementById('mods-view-toggle')?.addEventListener('click', () => {
  setModsViewMode(getModsViewMode() === 'cards' ? 'list' : 'cards');
});
applyModsViewModeUi();

// ===== Sticky-панель поиска каталога / серверов =====
function initToolbarSticky(tabId: string, toolbarId: string, sentinelId: string): void {
  const tab = document.getElementById(tabId);
  const toolbar = document.getElementById(toolbarId);
  const sentinel = document.getElementById(sentinelId);
  if (!tab || !toolbar || !sentinel) return;

  const observer = new IntersectionObserver(
    (entries) => {
      const entry = entries[0];
      if (!entry) return;
      toolbar.classList.toggle('is-stuck', !entry.isIntersecting);
    },
    { root: tab, threshold: 0, rootMargin: '0px' },
  );
  observer.observe(sentinel);
}
initToolbarSticky('tab-mods', 'mods-search-bar', 'mods-toolbar-sentinel');
initToolbarSticky('tab-servers', 'servers-search-bar', 'servers-toolbar-sentinel');
initToolbarSticky('be-install-scroll', 'be-install-search-bar', 'be-install-toolbar-sentinel');

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

document.getElementById('mods-source-select')?.addEventListener('change', (e) => {
  const val = (e.target as HTMLSelectElement).value || 'both';
  modsSource = val === 'modrinth' || val === 'curseforge' ? val : 'both';
  localStorage.setItem('Undefined Client-mods-source', modsSource);
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
  modsSource = 'both';
  localStorage.setItem('Undefined Client-mods-source', modsSource);
  modsVersion = '';
  modsLoaders.clear();
  modsTags.clear();
  const sortSel = document.getElementById('mods-sort-select') as HTMLSelectElement;
  if (sortSel) sortSel.value = 'relevance';
  const sourceSel = document.getElementById('mods-source-select') as HTMLSelectElement;
  if (sourceSel) sourceSel.value = 'both';
  const verSel = document.getElementById('mods-version-select') as HTMLSelectElement;
  if (verSel) verSel.value = '';
  document.querySelectorAll('#mods-loader-chips .mods-chip, #mods-tag-chips .mods-chip').forEach(c => c.classList.remove('active'));
  refreshModsClearBtn();
  closeModsFiltersPopup();
  modsSearchWithFilters();
});

/* ===== STATS ===== */

function formatRelativeLaunch(ts: number): string {
  if (!ts || !Number.isFinite(ts)) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return t('home.relative.justNow');
  if (diffSec < 3600) return t('home.relative.minutes', { n: Math.floor(diffSec / 60) });
  if (diffSec < 86400) return t('home.relative.hours', { n: Math.floor(diffSec / 3600) });
  const days = Math.floor(diffSec / 86400);
  if (days === 1) return t('home.relative.yesterday');
  return t('home.relative.days', { n: days });
}

/** Сборка по last-launch-id (прямое совпадение или slug, как у instance root) */
function findBuildByLaunchId(lastId: string | null | undefined): Build | null {
  const id = String(lastId || '').trim();
  if (!id) return null;
  const direct = savedBuilds.find((b) => b.id === id);
  if (direct) return direct;
  const slug = sanitizeBuildIdClient(id);
  return savedBuilds.find((b) => sanitizeBuildIdClient(b.id) === slug) || null;
}

function getHomeFeaturedBuild(): Build | null {
  const byLast = findBuildByLaunchId(localStorage.getItem('last-launch-id'));
  if (byLast) return byLast;
  // Запас: максимальный playtime, иначе первая в списке
  if (!savedBuilds.length) return null;
  let best = savedBuilds[0];
  for (const b of savedBuilds) {
    if ((b.playtime || 0) > (best.playtime || 0)) best = b;
  }
  return best;
}

let homeSelectedBuildId: string | null = null;
let homeRunListOpen = false;

function getHomeSelectedBuild(): Build | null {
  if (homeSelectedBuildId) {
    const found = savedBuilds.find((b) => b.id === homeSelectedBuildId);
    if (found) return found;
  }
  const featured = getHomeFeaturedBuild();
  if (featured) homeSelectedBuildId = featured.id;
  return featured;
}

function selectHomeBuild(id: string | null): void {
  homeSelectedBuildId = id;
  renderBuildRunPanel();
}

function buildRunLabel(build: Build): string {
  const tail = [build.gameVersion, build.loader].filter(Boolean).join(' • ');
  return tail ? `${build.name} ${tail}` : build.name;
}

function setHomeRunListOpen(open: boolean): void {
  homeRunListOpen = open;
  document.getElementById('build-run-panel')?.classList.toggle('is-open', open);
  document.getElementById('build-run-selector')?.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function renderBuildRunPanel(): void {
  const label = document.getElementById('build-run-label');
  const meta = document.getElementById('build-run-meta');
  const icon = document.getElementById('build-run-icon');
  const list = document.getElementById('build-run-list');
  const selected = getHomeSelectedBuild();
  if (label) label.textContent = selected ? selected.name : t('sidebar.noBuilds');
  if (meta) {
    const line = selected ? [selected.gameVersion, selected.loader].filter(Boolean).join(' · ') : '';
    meta.textContent = line;
    meta.classList.toggle('hidden', !line);
  }
  if (icon) icon.innerHTML = selected ? buildCardIconHtml(selected) : defaultBuildIconHtml();
  setHomeRunListOpen(homeRunListOpen);
  syncHomePlayButton();
  if (!list) return;
  if (!savedBuilds.length) {
    list.innerHTML = `<div class="build-run-empty">${escapeHtml(t('sidebar.noBuilds'))}</div>`;
    return;
  }
  list.innerHTML = savedBuilds.map((b) => {
    const selectedCls = selected && b.id === selected.id ? ' is-selected' : '';
    const metaLine = [b.gameVersion, b.loader].filter(Boolean).join(' · ');
    return `<div class="build-run-item${selectedCls}" data-build-id="${escapeHtml(b.id)}" role="option">
      <span class="build-run-item__icon">${buildCardIconHtml(b)}</span>
      <span class="build-run-item__text">
        <span class="build-run-item__name">${escapeHtml(b.name)}</span>
        ${metaLine ? `<span class="build-run-item__meta">${escapeHtml(metaLine)}</span>` : ''}
      </span>
      <button type="button" class="build-run-item__edit" data-edit-id="${escapeHtml(b.id)}">
        <span></span><span></span><span></span>
      </button>
    </div>`;
  }).join('');
}

function updateHomeLastBuild(): void {
  const last = getLastPlayedBuild();
  const metaEl = document.getElementById('home-last-meta');
  const iconEl = document.getElementById('home-last-icon');
  const btn = document.getElementById('home-last-build') as HTMLButtonElement | null;
  if (!metaEl) return;
  if (!last) {
    metaEl.textContent = t('home.session.none');
    if (iconEl) iconEl.innerHTML = '';
    if (btn) btn.disabled = true;
    return;
  }
  if (btn) btn.disabled = false;
  const version = [last.gameVersion, last.loader].filter(Boolean).join(' ');
  metaEl.textContent = version ? `${last.name} • ${version}` : last.name;
  if (iconEl) iconEl.innerHTML = buildCardIconHtml(last);
}

function ruNoun(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last > 1 && last < 5) return few;
  if (last === 1) return one;
  return many;
}

function formatHomeLibraryLine(): string {
  const builds = savedBuilds.length;
  const servers = savedServers.length;
  if (currentLang === 'ru') {
    const buildsWord = ruNoun(builds, 'сборка', 'сборки', 'сборок');
    const serversWord = ruNoun(servers, 'сервер', 'сервера', 'серверов');
    return `${builds} ${buildsWord} • ${servers} ${serversWord}`;
  }
  return t('home.insight.libraryValue', { builds, servers });
}

function formatHomePlaytimeLine(seconds: number): string {
  if (seconds <= 0) return t('home.insight.playtimeEmpty');
  if (currentLang !== 'ru') return formatPlaytime(seconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const hourWord = ruNoun(hours, 'час', 'часа', 'часов');
  const minuteWord = ruNoun(minutes, 'минута', 'минуты', 'минут');
  if (hours <= 0) return `${minutes} ${minuteWord}`;
  return `${hours} ${hourWord} ${minutes} ${minuteWord}`;
}

function countInstalledMods(): number {
  return savedBuilds.reduce((sum, b) => sum + (Array.isArray(b.mods) ? b.mods.length : 0), 0);
}

function getLastPlayedBuild(): Build | null {
  return findBuildByLaunchId(localStorage.getItem('last-launch-id'));
}

function updateHomeWelcomeSub(): void {
  const el = document.getElementById('home-welcome-sub');
  if (!el) return;
  if (savedBuilds.length === 0) {
    el.textContent = t('home.welcomeEmpty');
    return;
  }
  if (getLastPlayedBuild()) {
    el.textContent = t('home.welcome');
    return;
  }
  el.textContent = t('home.welcomePick');
}

function updateHomeInsights(): void {
  const lastPlayed = getLastPlayedBuild();
  const sessionValue = document.getElementById('home-insight-session-value');
  const sessionHint = document.getElementById('home-insight-session-hint');
  const libraryValue = document.getElementById('home-insight-library-value');
  const libraryHint = document.getElementById('home-insight-library-hint');
  const playtimeValue = document.getElementById('home-insight-playtime-value');
  const playtimeHint = document.getElementById('home-insight-playtime-hint');

  updateHomeWelcomeSub();
  updateHomeLastBuild();

  const lastAt = Number(localStorage.getItem('last-launch-at') || 0);
  const lastSec = Number(localStorage.getItem('last-session-seconds') || 0);
  if (runningBuild && runningBuildStart > 0) {
    const elapsed = Math.max(0, Math.floor((Date.now() - runningBuildStart) / 1000));
    if (sessionValue) sessionValue.textContent = formatPlaytime(elapsed);
    if (sessionHint) sessionHint.textContent = runningBuild.name;
  } else if (lastSec > 0) {
    if (sessionValue) sessionValue.textContent = formatPlaytime(lastSec);
    if (sessionHint) {
      sessionHint.textContent = [lastPlayed?.name, lastAt ? formatRelativeLaunch(lastAt) : '']
        .filter(Boolean)
        .join(' · ');
    }
  } else if (lastAt > 0 && lastPlayed) {
    if (sessionValue) sessionValue.textContent = formatRelativeLaunch(lastAt);
    if (sessionHint) sessionHint.textContent = lastPlayed.name;
  } else {
    if (sessionValue) sessionValue.textContent = t('home.session.none');
    if (sessionHint) sessionHint.textContent = t('home.insight.sessionEmptyHint');
  }

  if (libraryValue) libraryValue.textContent = formatHomeLibraryLine();
  if (libraryHint) libraryHint.textContent = '';

  let totalPlay = savedBuilds.reduce((sum, b) => sum + (b.playtime || 0), 0);
  if (runningBuild && runningBuildStart > 0) {
    const already = savedBuilds.find((b) => b.id === runningBuild!.id)?.playtime || 0;
    const elapsed = Math.max(0, Math.floor((Date.now() - runningBuildStart) / 1000));
    if (already === (runningBuild.playtime || 0)) totalPlay += elapsed;
  }
  if (playtimeValue) playtimeValue.textContent = formatHomePlaytimeLine(totalPlay);
  if (playtimeHint) playtimeHint.textContent = '';
}

function refreshHomeDashboard(): void {
  updateBanner();
  updateHomeInsights();
  if (!newsPosts.length && !newsLoading) void loadNews(false);
  else renderHomeNews();
}

function updateStats(): void {
  // Legacy ids могут отсутствовать после редизайна Главной
  const statBuilds = document.getElementById('stat-builds');
  if (statBuilds) statBuilds.textContent = String(savedBuilds.length);
  const statServers = document.getElementById('stat-servers');
  if (statServers) statServers.textContent = String(savedServers.length);
  const statMods = document.getElementById('stat-mods');
  if (statMods) statMods.textContent = String(countInstalledMods() || savedMods?.length || 0);
  const statSkins = document.getElementById('stat-skins');
  if (statSkins) statSkins.textContent = String(savedSkins.length);
  const statPlaytime = document.getElementById('stat-playtime');
  if (statPlaytime) {
    const total = savedBuilds.reduce((sum, b) => sum + (b.playtime || 0), 0);
    statPlaytime.textContent = formatPlaytime(total);
  }
  updateHomeInsights();
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

document.getElementById('home-insights')?.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-home-action]');
  if (!btn) return;
  const action = btn.getAttribute('data-home-action');
  if (action === 'select-last') {
    const last = getLastPlayedBuild();
    if (last) selectHomeBuild(last.id);
  } else if (action === 'builds') {
    switchTab('builds');
  } else if (action === 'stats') {
    openStatsModal();
  }
});

document.getElementById('modal-stats-close')?.addEventListener('click', () => closeModal('modal-stats'));
document.getElementById('modal-stats')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeModal('modal-stats');
});

function resolveLastServerStatus(addr: string): any {
  if (srvStatusCache[addr]) return srvStatusCache[addr];
  const cat = serverCatalog.find((c) => srvAddr(c) === addr);
  if (cat?.status) {
    srvStatusCache[addr] = cat.status;
    return cat.status;
  }
  return {};
}

function updateSidebarLastServer(): void {
  const lsCard = document.getElementById('last-server');
  const lsName = document.getElementById('last-server-name');
  const lsVer = document.getElementById('last-server-version');
  const lsIcon = document.getElementById('last-server-icon');

  if (savedServers.length === 0) {
    if (lsCard) lsCard.classList.add('hidden-card');
    return;
  }

  const srv = savedServers[savedServers.length - 1];
  const addr = savedServerAddr(srv);
  const st = resolveLastServerStatus(addr);
  const online = !!st.online;
  const players = st.players?.online != null ? st.players.online : null;
  const max = st.players?.max != null ? st.players.max : null;
  const version = String(st.version || srv.version || '').split('\n')[0] || '';
  const statusTxt = online
    ? (players != null
      ? `${Number(players).toLocaleString()}${max != null ? '/' + Number(max).toLocaleString() : ''}`
      : t('servers.online'))
    : (Object.keys(st).length ? t('servers.offline') : '…');
  const fav = srvTileIcon(addr, st);

  if (lsName) lsName.textContent = srv.name;
  if (lsCard) lsCard.classList.remove('hidden-card');

  if (lsIcon) {
    lsIcon.innerHTML = fav
      ? `<img src="${srvEsc(fav)}" alt="">`
      : `<img src="../../assets/icons/serverIcon.png" alt="">`;
  }

  if (lsVer) {
    const verPart = version || addr;
    lsVer.innerHTML = `
      <span class="srv-dot ${online ? 'srv-online' : 'srv-offline'}"></span>
      <span class="sidebar-srv-online">${escapeHtml(statusTxt)}</span>
      ${verPart ? `<span class="srv-sep">·</span><span class="sidebar-srv-ver">${escapeHtml(verPart)}</span>` : ''}
    `;
  }
}

/** Пинг последнего сервера для иконки/онлайна в сайдбаре. */
async function ensureLastServerStatus(): Promise<void> {
  if (!savedServers.length || !api?.serverStatus) return;
  const srv = savedServers[savedServers.length - 1];
  const addr = savedServerAddr(srv);
  if (!addr) return;
  const cat = serverCatalog.find((c) => srvAddr(c) === addr);
  const cached = srvStatusCache[addr];
  const hasIcon = Boolean(srvServerFavicon(cached || {}) || cat?.icon);
  if (cached?.online != null && (hasIcon || cached.iconChecked)) {
    updateSidebarLastServer();
    return;
  }
  if (!cached && cat?.status?.online != null && cat.icon) {
    srvStatusCache[addr] = cat.status;
    updateSidebarLastServer();
    return;
  }
  try {
    const st = (await api.serverStatus(addr)) || { online: false };
    srvStatusCache[addr] = { ...st, iconChecked: true };
    if (cat) cat.status = st;
    updateSidebarLastServer();
  } catch {
    srvStatusCache[addr] = { online: false, iconChecked: true };
    updateSidebarLastServer();
  }
}

function updateSidebarCards(): void {
  const qlIcon = document.getElementById('quick-launch-icon');
  const qlName = document.getElementById('quick-launch-name');
  const qlVer = document.getElementById('quick-launch-version');
  const build = getHomeFeaturedBuild();
  if (build) {
    if (qlName) qlName.textContent = build.name;
    if (qlVer) qlVer.textContent = `${build.gameVersion} · ${build.loader}`;
    if (qlIcon) {
      qlIcon.style.background = 'transparent';
      if (build.icon) {
        qlIcon.innerHTML = `<img src="${buildIconSrc(build.icon)}" style="width:100%;height:100%;object-fit:cover;border-radius:4px;">`;
      } else {
        qlIcon.innerHTML = defaultBuildIconHtml('border-radius:4px;');
      }
    }
  } else {
    if (qlName) qlName.textContent = t('sidebar.noBuilds');
    if (qlVer) qlVer.textContent = '';
    if (qlIcon) {
      qlIcon.style.background = 'transparent';
      qlIcon.innerHTML = defaultBuildIconHtml('border-radius:4px;');
    }
  }

  updateSidebarLastServer();
  void ensureLastServerStatus();
}

function updateBanner(): void {
  renderBuildRunPanel();
  updateHomeInsights();
}

/* ===== MODAL FUNCTIONS ===== */

/* ── Modal helpers ── */
const PRESENCE_MODALS: Record<string, string> = { 'modal-settings': 'settings', 'modal-about': 'about' };
/** Базовый z-index .modal-overlay; каждая openModal поднимает окно поверх уже открытых. */
let modalZCounter = 1500;
/** Отложенное скрытие после анимации closing — отменяется при повторном openModal */
const modalCloseTimers = new Map<string, ReturnType<typeof setTimeout>>();

function openModal(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  const pending = modalCloseTimers.get(id);
  if (pending != null) {
    clearTimeout(pending);
    modalCloseTimers.delete(id);
  }
  el.classList.remove('hidden', 'closing');
  // Считаем max среди уже видимых оверлеев — иначе versions может оказаться под details.
  let maxZ = modalZCounter;
  const considerZ = (node: HTMLElement) => {
    if (node === el || node.classList.contains('hidden')) return;
    const raw = node.style.zIndex || getComputedStyle(node).zIndex;
    const z = parseInt(raw, 10);
    // Titlebar (2^31−1) и сплэш не поднимаем: модалка должна остаться под шапкой окна.
    if (Number.isFinite(z) && z > maxZ && z < 1_000_000) maxZ = z;
  };
  document.querySelectorAll<HTMLElement>('.modal-overlay').forEach(considerZ);
  // .msgr-ctx сознательно выше modal-overlay (1500 → 10050). Без этого пост из чата
  // оказывается под слоем мессенджера, и клик по крестику/оверлею не доходит до модалки.
  document.querySelectorAll<HTMLElement>('.msgr-ctx').forEach(considerZ);
  if (id === 'modal-sf-post' && maxZ < 10050) maxZ = 10050;
  modalZCounter = maxZ + 1;
  el.style.zIndex = String(modalZCounter);
  if (PRESENCE_MODALS[id]) pushPresence(PRESENCE_MODALS[id]);
}
function closeModal(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  if (id === 'modal-mod-details') {
    closeBeShotViewer();
    closeImageViewer('mod');
    closeVideoViewer('mod');
  }
  if (id === 'modal-news-details') {
    closeImageViewer('news');
    closeVideoViewer('news');
  }
  if (id === 'modal-srv-info') {
    closeImageViewer('server');
    afterContentInstall = null;
  }
  const prev = modalCloseTimers.get(id);
  if (prev != null) clearTimeout(prev);
  el.classList.add('closing');
  const timer = setTimeout(() => {
    modalCloseTimers.delete(id);
    el.classList.add('hidden');
    el.classList.remove('closing');
    el.style.removeProperty('z-index');
  }, 120);
  modalCloseTimers.set(id, timer);
  if (PRESENCE_MODALS[id]) pushPresence(presenceTab);
}
function onOverlayClick(e: MouseEvent, id: string): void {
  if (e.target === e.currentTarget) closeModal(id);
}

/* ── Модалка предпросмотра мира (WebContentsView в #world-preview-host) ── */

let worldPreviewBoundsObserver: ResizeObserver | null = null;
let worldPreviewResizeHandler: (() => void) | null = null;

function getWorldPreviewHostBounds(): { x: number; y: number; width: number; height: number } | null {
  // Вся карточка модалки — без внутренних отступов под header (chrome внутри world.html).
  const host = document.getElementById('world-preview-host')
    || document.querySelector('#modal-world-preview .world-preview-window');
  if (!host) return null;
  const r = host.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return null;
  return {
    x: Math.max(0, Math.round(r.left)),
    y: Math.max(0, Math.round(r.top)),
    width: Math.max(1, Math.round(r.width)),
    height: Math.max(1, Math.round(r.height)),
  };
}

function syncWorldPreviewBounds(): void {
  const bounds = getWorldPreviewHostBounds();
  if (!bounds || !api?.setWorldViewerBounds) return;
  void api.setWorldViewerBounds(bounds);
}

function stopWorldPreviewBoundsSync(): void {
  worldPreviewBoundsObserver?.disconnect();
  worldPreviewBoundsObserver = null;
  if (worldPreviewResizeHandler) {
    window.removeEventListener('resize', worldPreviewResizeHandler);
    worldPreviewResizeHandler = null;
  }
}

function startWorldPreviewBoundsSync(): void {
  stopWorldPreviewBoundsSync();
  const host = document.getElementById('world-preview-host');
  const win = document.querySelector('#modal-world-preview .world-preview-window');
  if (!host) return;
  worldPreviewBoundsObserver = new ResizeObserver(() => syncWorldPreviewBounds());
  worldPreviewBoundsObserver.observe(host);
  if (win) worldPreviewBoundsObserver.observe(win);
  worldPreviewResizeHandler = () => syncWorldPreviewBounds();
  window.addEventListener('resize', worldPreviewResizeHandler);
  // После шрифтов/layout ещё раз подогнать view под host.
  requestAnimationFrame(() => syncWorldPreviewBounds());
}

async function closeWorldPreviewModal(): Promise<void> {
  stopWorldPreviewBoundsSync();
  try { await api?.closeWorldViewer?.(); } catch { /* */ }
  closeModal('modal-world-preview');
}

async function openWorldPreviewModalChrome(): Promise<{ x: number; y: number; width: number; height: number } | null> {
  openModal('modal-world-preview');
  // Два кадра: layout модалки + flex host.
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  startWorldPreviewBoundsSync();
  return getWorldPreviewHostBounds();
}

document.getElementById('modal-world-preview')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) void closeWorldPreviewModal();
});

api?.onWorldModalOpen?.((data) => {
  void (async () => {
    const bounds = await openWorldPreviewModalChrome();
    if (!bounds) return;
    if (api?.attachWorldViewer) await api.attachWorldViewer(bounds);
    else if (api?.openWorldViewer) await api.openWorldViewer(data?.worldPath || '', undefined, bounds);
  })();
});
api?.onWorldModalClosed?.(() => {
  stopWorldPreviewBoundsSync();
  const el = document.getElementById('modal-world-preview');
  if (el && !el.classList.contains('hidden')) closeModal('modal-world-preview');
});
api?.onWorldBoundsSyncRequest?.(() => {
  syncWorldPreviewBounds();
});

/* ── Esc-to-close ── */

const ESC_CLOSEABLE_MODALS: { id: string; close: () => void }[] = [
  { id: 'modal-build', close: closeModalBuildModal },
  { id: 'modal-build-group', close: closeModalBuildGroup },
  { id: 'modal-server', close: closeModalServerModal },
  { id: 'modal-account', close: () => closeModal('modal-account') },
  { id: 'modal-acc-req', close: () => closeModal('modal-acc-req') },
  { id: 'modal-about', close: () => closeModal('modal-about') },
  { id: 'modal-settings', close: () => closeModal('modal-settings') },
  { id: 'modal-stats', close: () => closeModal('modal-stats') },
  { id: 'modal-target-build', close: () => closeModal('modal-target-build') },
  { id: 'modal-be-install', close: () => closeModal('modal-be-install') },
  { id: 'modal-versions', close: () => closeModal('modal-versions') },
  { id: 'modal-mod-details', close: () => closeModal('modal-mod-details') },
  { id: 'modal-news-details', close: () => closeModal('modal-news-details') },
  { id: 'modal-import', close: () => closeModal('modal-import') },
  { id: 'modal-deeplink', close: closeDeepLinkModal },
  { id: 'modal-share', close: closeShareModal },
  { id: 'modal-share-import', close: closeShareImportModal },
  { id: 'modal-server-build', close: () => closeModal('modal-server-build') },
  { id: 'modal-srv-info', close: () => closeModal('modal-srv-info') },
  { id: 'modal-crash', close: () => closeModal('modal-crash') },
  // Последним: поверх остальных (в т.ч. редактора сборки).
  { id: 'modal-world-preview', close: () => { void closeWorldPreviewModal(); } },
  // Пост сообщества может быть открыт поверх чата (z-index выше .msgr-ctx).
  { id: 'modal-sf-post', close: () => closeModal('modal-sf-post') },
];

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const shotViewer = document.getElementById('be-shot-viewer');
  if (shotViewer && !shotViewer.classList.contains('hidden')) {
    closeBeShotViewer();
    return;
  }
  if (accountPopup.classList.contains('open')) {
    closeAccountPopup();
    return;
  }
  // Закрываем верхнюю по z-index (важно при стеке: versions поверх details).
  let top: { entry: (typeof ESC_CLOSEABLE_MODALS)[number]; z: number } | null = null;
  for (const entry of ESC_CLOSEABLE_MODALS) {
    const el = document.getElementById(entry.id);
    if (!el || el.classList.contains('hidden') || el.classList.contains('closing')) continue;
    const z = parseInt(getComputedStyle(el).zIndex, 10) || 0;
    if (!top || z >= top.z) top = { entry, z };
  }
  if (top) {
    try { top.entry.close(); } catch { closeModal(top.entry.id); }
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
  if (tab !== 'screenshots') {
    closeBeShotViewer();
    closeImageViewer('shots');
  }
  if (tab === 'screenshots') loadBeScreenshots();
  if (tab === 'worlds') loadBeWorlds();
}

async function openModalBuild(build?: Build): Promise<void> {
  if (!build && !(await requireAccount())) return;
  const nameInput = document.getElementById('modal-build-name') as HTMLInputElement;
  const versionSelect = document.getElementById('modal-build-version') as HTMLSelectElement;
  const loaderSelect = document.getElementById('modal-build-loader') as HTMLSelectElement;
  const loaderVerInput = document.getElementById('modal-build-loader-ver') as HTMLSelectElement;
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

  await ensureBuildVersionsLoaded();
  if (
    build &&
    versionSelect &&
    build.gameVersion &&
    build.gameVersion !== 'latest_release' &&
    build.gameVersion !== 'latest_snapshot'
  ) {
    if (!Array.from(versionSelect.options).some((o) => o.value === build.gameVersion)) {
      appendBuildVersionOption(build.gameVersion, build.gameVersion);
    }
    versionSelect.value = build.gameVersion;
    syncBuildVersionUI();
  }

  if (build) {
    editingBuildId = build.id;
    editingBuild = build;
    javaManualChoice = false;
    if (!build.mods) build.mods = [];
    if (!build.resourcePacks) build.resourcePacks = [];
    if (!build.shaders) build.shaders = [];
    if (!build.dataPacks) build.dataPacks = [];
    const openFolderBtn = document.getElementById('modal-build-open-folder');
    if (openFolderBtn) openFolderBtn.hidden = false;
    if (title) title.textContent = t('be.manageTitle');
    if (sub) sub.textContent = t('be.manageSub');
    if (submitBtn) submitBtn.textContent = t('btn.save');
    if (nameInput) nameInput.value = build.name;
    if (versionSelect) versionSelect.value = build.gameVersion;
    if (loaderSelect) loaderSelect.value = build.loader;
    if (loaderVerInput) {
      const lv = build.loaderVersion || '';
      if (lv && !Array.from(loaderVerInput.options).some((o) => o.value === lv)) {
        const opt = document.createElement('option');
        opt.value = lv;
        opt.textContent = lv;
        loaderVerInput.appendChild(opt);
        const menu = document.getElementById('modal-build-loader-ver-menu');
        if (menu) {
          const item = document.createElement('div');
          item.className = 'stngs-select-opt';
          item.dataset.value = lv;
          item.textContent = lv;
          menu.appendChild(item);
        }
      }
      loaderVerInput.value = lv;
      const lvWrap = loaderVerInput.closest('.stngs-select-wrap') as HTMLElement | null;
      if (lvWrap) syncSelectUI(lvWrap);
    }
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
    const openFolderBtn = document.getElementById('modal-build-open-folder');
    if (openFolderBtn) openFolderBtn.hidden = true;
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
  void ensureBuildVersionsLoaded();
  void fillBuildDriveSelect();
  void fillInstancePathField(build);
  populateLoaderVersions(
    (document.getElementById('modal-build-loader') as HTMLSelectElement)?.value || 'vanilla',
    (document.getElementById('modal-build-version') as HTMLSelectElement)?.value || 'latest_release'
  );
  updateBeLoaderTabsVisibility();
  void populateJavaOptions(true).then(() => {
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
  closeBeShotViewer();
  closeImageViewer('shots');
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

/** Имя файла без .disabled — для сопоставления при toggle/scan. */
function contentFileBase(filename: string): string {
  return filename.replace(/\.disabled$/i, '').toLowerCase();
}

/**
 * Диск — источник правды: добавляем новые, обновляем существующие,
 * убираем то, чего больше нет в папке (ручное удаление / rename).
 */
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

    const existingByBase = new Map<string, BeFileItem>();
    for (const item of arr) {
      if (!item.filename) continue;
      const base = contentFileBase(item.filename);
      if (!existingByBase.has(base)) existingByBase.set(base, item);
    }

    const next: BeFileItem[] = [];
    const seen = new Set<string>();
    for (const item of scannedItems) {
      const base = contentFileBase(item.filename || '');
      if (!base || seen.has(base)) continue;
      seen.add(base);
      const existing = existingByBase.get(base);
      if (existing) {
        existing.filename = item.filename;
        existing.enabled = item.enabled !== false;
        if (item.name) existing.name = item.name;
        if (item.version) existing.version = item.version;
        if (item.description) existing.description = item.description;
        if (item.projectId) {
          existing.projectId = item.projectId;
          existing.iconUrl = item.iconUrl;
        }
        next.push(existing);
      } else {
        next.push(item);
      }
    }

    arr.length = 0;
    arr.push(...next);
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
/** Папка внутри .uclient/<buildId>/ для импорта локальных файлов */
const LIST_ID_TO_INSTANCE_SUB: Record<string, string> = {
  'be-mods-list': 'mods',
  'be-rp-list': 'resourcepacks',
  'be-shaders-list': 'shaderpacks',
  'be-dp-list': 'datapacks',
};

/** Допустимые расширения при DnD с диска (по типу списка). */
const BE_DROP_EXTS: Record<string, Set<string>> = {
  'be-mods-list': new Set(['.jar', '.litemod', '.zip', '.disabled']),
  'be-rp-list': new Set(['.zip']),
  'be-shaders-list': new Set(['.zip']),
  'be-dp-list': new Set(['.zip']),
};

function isOsFileDrag(dt: DataTransfer | null | undefined): boolean {
  if (!dt) return false;
  return Array.from(dt.types || []).includes('Files');
}

/** Пути файлов из OS DnD (Electron File.path). */
function extractDroppedFilePaths(dt: DataTransfer | null | undefined, listId: string): string[] {
  if (!dt?.files?.length) return [];
  const allow = BE_DROP_EXTS[listId];
  const paths: string[] = [];
  for (let i = 0; i < dt.files.length; i++) {
    const f = dt.files.item(i) as (File & { path?: string }) | null;
    if (!f?.path) continue;
    const lower = f.path.toLowerCase();
    const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.')) : '';
    if (allow && ext && !allow.has(ext)) continue;
    paths.push(f.path);
  }
  return paths;
}

function listIdToBuildKey(listId: string): keyof Build | undefined {
  return LIST_ID_TO_BUILD_KEY[listId];
}

function renderBeFileList(listId: string, items: BeFileItem[]): void {
  const list = document.getElementById(listId);
  if (!list) return;
  if (items.length === 0) {
    list.innerHTML =
      '<div class="be-file-empty">' +
      '<div>' + t('be.noItems') + '</div>' +
      '<div class="be-file-drop-hint">' + t('be.dropHint') + '</div>' +
      '</div>';
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

  // Drag & drop: порядок в списке + приём файлов с диска
  list.querySelectorAll('.be-file-item[draggable]').forEach(el => {
    el.addEventListener('dragstart', (e) => {
      if (isOsFileDrag((e as DragEvent).dataTransfer)) return;
      el.classList.add('dragging');
      (e as DragEvent).dataTransfer?.setData('text/plain', String((el as HTMLElement).dataset.index));
    });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (isOsFileDrag((e as DragEvent).dataTransfer)) {
        list.classList.add('be-file-list--drop');
        return;
      }
      el.classList.add('drag-over');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drag-over');
      const paths = extractDroppedFilePaths((e as DragEvent).dataTransfer, listId);
      if (paths.length) {
        e.stopPropagation();
        list.classList.remove('be-file-list--drop');
        void runBeImportFiles(listId, paths);
        return;
      }
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

  // Toggle — переименовываем файл на диске (.jar ↔ .jar.disabled)
  list.querySelectorAll('.be-file-toggle input').forEach((cb, i) => {
    cb.addEventListener('change', async () => {
      const buildKey = listIdToBuildKey(listId);
      const arr = buildKey && editingBuild ? (editingBuild[buildKey] as BeFileItem[]) : null;
      const item = arr?.[i];
      const wantEnabled = (cb as HTMLInputElement).checked;
      if (!item) return;
      if (!editingBuildId || !item.filename || !api?.toggleInstanceFile) {
        item.enabled = wantEnabled;
        return;
      }
      const sub = LIST_ID_TO_INSTANCE_SUB[listId];
      if (!sub) { item.enabled = wantEnabled; return; }
      (cb as HTMLInputElement).disabled = true;
      try {
        const res = await api.toggleInstanceFile(editingBuildId, sub, item.filename, wantEnabled);
        if (!res?.success) {
          (cb as HTMLInputElement).checked = !wantEnabled;
          updateStatus(t('be.toggleFailed'));
          return;
        }
        item.enabled = !!res.enabled;
        if (res.filename) item.filename = res.filename;
        // На случай гонки с вотчером: один base — одна запись
        const base = contentFileBase(item.filename || '');
        for (let j = arr.length - 1; j >= 0; j--) {
          if (j === i) continue;
          if (contentFileBase(arr[j].filename || '') === base) arr.splice(j, 1);
        }
        renderBeFileList(listId, arr);
      } catch {
        (cb as HTMLInputElement).checked = !wantEnabled;
        updateStatus(t('be.toggleFailed'));
      } finally {
        (cb as HTMLInputElement).disabled = false;
      }
    });
  });

  // Delete — убираем из UI и с диска инстанса
  list.querySelectorAll('.be-file-del').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const idx = parseInt((btn as HTMLElement).dataset.index || '', 10);
      const buildKey = listIdToBuildKey(listId);
      const arr = buildKey && editingBuild ? (editingBuild[buildKey] as BeFileItem[]) : null;
      if (!arr || idx < 0 || idx >= arr.length) return;
      const item = arr[idx];
      if (!await confirmAction(t('be.confirmDeleteFile', { name: item.name || item.filename || '' }))) return;
      const sub = LIST_ID_TO_INSTANCE_SUB[listId];
      if (editingBuildId && item.filename && sub && api?.deleteInstanceFiles) {
        try {
          const res = await api.deleteInstanceFiles(editingBuildId, sub, [item.filename]);
          if (!res?.success) {
            updateStatus(t('be.deleteFileFailed'));
            return;
          }
        } catch {
          updateStatus(t('be.deleteFileFailed'));
          return;
        }
      }
      arr.splice(idx, 1);
      renderBeFileList(listId, arr);
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
  const loaderVerInput = document.getElementById('modal-build-loader-ver') as HTMLSelectElement;
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

  let created: Build | null = null;
  if (editingBuildId) {
    const existing = savedBuilds.find(b => b.id === editingBuildId);
    if (existing) {
      const runtimeChanged = existing.gameVersion !== versionSelect.value
        || existing.loader !== loaderSelect.value
        || (existing.loaderVersion || '') !== loaderVerInput.value.trim();
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
      if (runtimeChanged) created = existing;
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
    const driveParent = (document.getElementById('modal-build-drive') as HTMLSelectElement | null)?.value || '';
    if (driveParent && driveParent !== BUILD_PATH_PICK && api?.prepareBuildLocation) {
      const placed = await api.prepareBuildLocation(build.id, driveParent);
      if (!placed?.ok) updateStatus(placed?.error || t('paths.moveFailed'));
    }
    created = build;
  }
  await loadBuilds();
  closeModalBuildModal();
  if (created) await prefetchBuildRuntime(created);
}

/** Клиент, библиотеки, ассеты и загрузчик — сразу после создания, до первого запуска. */
async function prefetchBuildRuntime(build: Build): Promise<void> {
  if (!api?.prefetchRuntime) return;
  updateStatus(t('smp.preparingRuntime'));
  const res = await api.prefetchRuntime({
    buildId: build.id,
    gameVersion: build.gameVersion,
    loader: build.loader,
    loaderVersion: build.loaderVersion,
  });
  if (res && !res.ok && res.error && res.error !== 'cancelled') {
    updateStatus(t('smp.prefetchFailed', { msg: res.error }));
  }
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
    if (ipInput) ipInput.value = serverAddressField(server);
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
  const typed = ipInput.value.trim();
  if (!name || !typed) return;
  const parsed = endpointFromAddress(typed);

  if (editingServerId) {
    const existing = savedServers.find(s => s.id === editingServerId);
    if (existing) {
      existing.name = name;
      existing.ip = parsed.host;
      existing.port = parsed.port;
      existing.version = verInput?.value?.trim() || '';
      existing.manual = true;
      if (api?.saveServer) await api.saveServer(existing);
    }
  } else {
    const server: Server = {
      id: 'srv-' + Date.now().toString(36),
      name,
      ip: parsed.host,
      port: parsed.port,
      version: verInput?.value?.trim() || '',
      manual: true,
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

async function loadNewsOfficialOnly(force = false): Promise<void> {
  const lang = newsApiLang();
  const cacheFresh =
    newsLoaded &&
    !force &&
    newsFetchLang === lang &&
    Date.now() - newsFetchedAt < NEWS_CACHE_MS;
  if (cacheFresh) return;
  if (newsLoadPromise) {
    await newsLoadPromise;
    return;
  }
  newsLoadPromise = (async () => {
    newsLoading = true;
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
}

async function loadNews(force = false): Promise<void> {
  await loadNewsOfficialOnly(force);
  renderHomeNews();
  if (presenceTab === 'news') {
    await loadSocialFeed(force);
  }
}

function renderNews(): void {
  if (presenceTab !== 'news') return;
  const root = document.getElementById('sf-official-news');
  if (!root) {
    void loadSocialFeed(false);
    return;
  }
  renderOfficialNewsInto(root);
}

function renderOfficialNewsInto(root: HTMLElement): void {
  if (newsLoading && !newsLoaded) {
    root.innerHTML = `<div class="news-state-msg">${escapeHtml(t('news.loading'))}</div>`;
    return;
  }

  if (newsError) {
    root.innerHTML = `<div class="news-state-msg error">${escapeHtml(t('news.error'))} <button class="mods-retry-btn" id="news-retry-btn">${escapeHtml(t('btn.retry'))}</button></div>`;
    document.getElementById('news-retry-btn')?.addEventListener('click', () => {
      void loadNewsOfficialOnly(true).then(() => renderOfficialNewsInto(root));
    });
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
          ${rest.map((post) => renderNewsArticleCard(post)).join('')}
        </div>
      </section>`
    : '';

  root.innerHTML = renderNewsFeatured(featured) + moreHtml;
  bindNewsOpenHandlers(root);
}

function latestOfficialNewsPost(): NewsPostSummary | null {
  if (!newsPosts.length) return null;
  let best = newsPosts[0];
  let bestTime = Date.parse(best.publishedAt || '') || 0;
  for (const post of newsPosts) {
    const time = Date.parse(post.publishedAt || '') || 0;
    if (time > bestTime) {
      best = post;
      bestTime = time;
    }
  }
  return best;
}

function renderHomeNews(): void {
  const block = document.getElementById('home-news-attribution');
  const coverEl = document.getElementById('home-news-cover');
  const titleEl = document.getElementById('home-news-title');
  const summaryEl = document.getElementById('home-news-summary');
  if (!block || !coverEl || !titleEl || !summaryEl) return;

  const post = latestOfficialNewsPost();
  if (!post) {
    block.classList.add('hidden');
    return;
  }
  const coverUrl = resolveNewsAssetUrl(post.cover);
  coverEl.classList.remove('is-ready');
  coverEl.classList.toggle('uc-frame', Boolean(coverUrl));
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

  const openPost = (): void => {
    void openModalNews(post.id);
  };
  block.onclick = openPost;
  block.onkeydown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openPost();
    }
  };

  block.classList.remove('hidden');
}

function bindNewsContentLinks(container: HTMLElement): void {
  container.querySelectorAll('a[href]').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const href = (a as HTMLAnchorElement).href;
      if (!href) return;
      // Файл ролика в новости — внутренний контент, без кнопки внешней ссылки.
      if (isDirectVideoUrl(href)) {
        openVideoViewer([{ src: href }], 0, 'news');
        return;
      }
      void api?.openExternal(href);
    });
  });
  // Картинки новости — внутренний контент лаунчера, без кнопки внешней ссылки.
  bindZoomableImages(container, { includeLinked: true, source: 'news' });
  bindPlayableVideos(container, { source: 'news' });
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

  const bodyHtml = post.content ? markedParse(post.content) : post.contentHtml || '';
  void noteOfficialNewsView(postId).then((views) => {
    if (views == null) return;
    const cached = newsPosts.find((item) => String(item.id) === String(postId));
    if (cached) cached.views = views;
  });
  desc.innerHTML = sanitizeHtml(bodyHtml);
  bindNewsContentLinks(desc);

  if (openBtn) {
    openBtn.onclick = () => void api?.openExternal(`${NEWS_SITE_CLIENT}/news/${encodeURIComponent(post.id)}`);
  }
}

document.getElementById('news-refresh-btn')?.addEventListener('click', () => void loadNews(true));


/* ── Modal: Mod Details ── */
let detailsProjectId: string = '';
let modDetailsTab: 'desc' | 'shots' = 'desc';

type ModGalleryItem = { url: string; thumb?: string; title?: string };

/** Достаёт исходный CDN-URL из нашего `/api/catalog/image?url=...`. */
function unwrapCatalogImageUrl(raw: string): string {
  const text = String(raw || '').trim();
  if (!text) return '';
  try {
    const abs = text.startsWith('http') ? text : catalogImageUrl(text);
    const u = new URL(abs);
    if (u.pathname.includes('/api/catalog/image')) {
      const inner = u.searchParams.get('url');
      if (inner) return inner;
    }
  } catch {
    /* ignore */
  }
  return text;
}

/** Полноразмерный URL галереи Modrinth (raw_url), иначе убираем суффикс превью. */
function modGalleryFullUrl(item: any): string {
  const raw = unwrapCatalogImageUrl(String(item?.raw_url || '').trim());
  const url = unwrapCatalogImageUrl(String(item?.url || item || '').trim());
  const candidate = raw || url;
  if (!candidate) return '';
  // CDN: ..._350.webp / ..._512.png / ?width=350 — для просмотра нужен оригинал
  return candidate
    .replace(/_(?:[1-9]\d{2,3})(?=\.(webp|png|jpe?g|gif)(?:\?|$))/i, '')
    .replace(/([?&])(?:width|w|height|h)=\d+/gi, '$1')
    .replace(/\?&/, '?')
    .replace(/[?&]$/, '');
}

/** Галерея проекта Modrinth (search hit или полный project) */
function modProjectGallery(project: any): ModGalleryItem[] {
  const out: ModGalleryItem[] = [];
  const seen = new Set<string>();
  const push = (full?: string | null, thumb?: string | null, title?: string | null) => {
    const u = String(full || '').trim();
    if (!u || seen.has(u)) return;
    seen.add(u);
    const t = String(thumb || '').trim();
    out.push({
      url: u,
      thumb: t && t !== u ? t : undefined,
      title: title ? String(title).trim() : undefined,
    });
  };

  const gallery = project?.gallery;
  if (Array.isArray(gallery)) {
    for (const item of gallery) {
      if (typeof item === 'string') push(item, item);
      else if (item && typeof item === 'object') {
        push(modGalleryFullUrl(item), item.url || item.raw_url, item.title);
      }
    }
  } else if (typeof gallery === 'string') {
    push(gallery, gallery);
  }
  if (!out.length && typeof project?.featured_gallery === 'string') {
    push(project.featured_gallery, project.featured_gallery);
  }
  return out;
}

function setModDetailsTab(tab: 'desc' | 'shots'): void {
  modDetailsTab = tab;
  const tabs = document.querySelectorAll<HTMLElement>('#modal-mod-tabs [data-mod-tab]');
  tabs.forEach((btn) => {
    const active = btn.getAttribute('data-mod-tab') === tab;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  const panels = document.querySelectorAll<HTMLElement>('#modal-mod-details [data-mod-panel]');
  panels.forEach((panel) => {
    const show = panel.getAttribute('data-mod-panel') === tab;
    panel.classList.toggle('is-active', show);
    panel.hidden = !show;
  });
}

let modDetailsGalleryItems: ModGalleryItem[] = [];

function modGalleryIsVideo(item: ModGalleryItem): boolean {
  const raw = unwrapCatalogImageUrl(item.url);
  return isDirectVideoUrl(raw) || isDirectVideoUrl(item.url);
}

function renderModDetailsGallery(items: ModGalleryItem[]): void {
  modDetailsGalleryItems = items;
  const gallery = document.getElementById('modal-mod-gallery');
  if (!gallery) return;
  if (!items.length) {
    gallery.innerHTML = '';
    return;
  }
  gallery.innerHTML = items
    .map((item, i) => {
      const title = item.title ? escapeHtml(item.title) : '';
      const cap = title ? `<span class="mod-details-gallery__cap">${title}</span>` : '';
      if (modGalleryIsVideo(item)) {
        const raw = unwrapCatalogImageUrl(item.url);
        const playable = /^https?:\/\//i.test(raw) ? raw : item.url;
        return `<button type="button" class="mod-details-gallery__item" data-gallery-index="${i}" title="${title || escapeHtml(item.url)}">
          <video src="${escapeHtml(playable)}" muted preload="metadata" playsinline></video>
          <span class="mod-details-gallery__play" aria-hidden="true"><img src="../../assets/icons/videoPlayer/play.svg" alt="" width="16" height="16"></span>
          ${cap}
        </button>`;
      }
      const src = escapeHtml(catalogImageUrl(item.thumb || item.url));
      return `<button type="button" class="mod-details-gallery__item" data-gallery-index="${i}" title="${title || escapeHtml(item.url)}">
        <img src="${src}" alt="${title}" loading="lazy">
        ${cap}
      </button>`;
    })
    .join('');
  gallery.querySelectorAll<HTMLButtonElement>('[data-gallery-index]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const idx = Number(btn.getAttribute('data-gallery-index'));
      if (!Number.isFinite(idx)) return;
      openModGalleryViewer(idx);
    });
  });
}

function setupModDetailsTabs(hasShots: boolean): void {
  const tabsBar = document.getElementById('modal-mod-tabs');
  const shotsTab = document.getElementById('modal-mod-tab-shots');
  if (tabsBar) tabsBar.hidden = !hasShots;
  if (shotsTab) shotsTab.hidden = !hasShots;
  setModDetailsTab('desc');
}

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
  setupModDetailsTabs(false);
  renderModDetailsGallery([]);
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
    const authorName = String(project.author || '').trim();
    if (!authorName || authorName === '—') {
      author.textContent = '—';
    } else if (project.source === 'curseforge' || String(project.id || '').startsWith('cf:')) {
      author.textContent = authorName;
    } else {
      const authorUrl = `https://modrinth.com/user/${encodeURIComponent(authorName)}`;
      author.innerHTML = `<a href="${authorUrl}" target="_blank" rel="noopener">${escapeHtml(authorName)}</a>`;
    }
  }
  if (tags) {
    const categories: string[] = project.categories || project.client_side ? [project.client_side] : [];
    tags.innerHTML = categories.map((c: string) => `<span class="mod-details-tag">${c}</span>`).join('');
  }

  if (urlBtn) {
    const isCf = project.source === 'curseforge' || String(project.id || projectId).startsWith('cf:');
    const projUrl = isCf
      ? (project.curseforge_url || `https://www.curseforge.com/minecraft/mc-mods/${String(project.slug || '').replace(/^cf:/, '') || project.id}`)
      : (project.modrinth_url || `https://modrinth.com/${project.project_type || 'mod'}/${project.slug || project.id}`);
    const label = urlBtn.querySelector('span');
    if (label) label.textContent = isCf ? t('btn.openInCurseforge') : t('btn.openInModrinth');
    urlBtn.onclick = () => api?.openExternal(projUrl);
  }
  if (dlBtn) {
    dlBtn.onclick = () => {
      versionsHostLock = Boolean(hostCatalogInstall);
      closeModal('modal-mod-details');
      openModalVersionsForDownload(project.id || project.project_id || project.slug || projectId);
    };
  }

  const galleryItems = modProjectGallery(project);
  setupModDetailsTabs(galleryItems.length > 0);
  renderModDetailsGallery(galleryItems);

  if (project.body_html) {
    desc.innerHTML = absolutizeCatalogHtml(project.body_html);
  } else {
    const bodyMd = project.body || project.description || '';
    const bodyHtml = markedParse(bodyMd);
    desc.innerHTML = absolutizeCatalogHtml(sanitizeHtml(bodyHtml));
  }
  // height:auto — пропорции при max-width; процентный width убираем (растягивал баннеры).
  // Пиксельный width у бейджей оставляем — иначе 2x-картинки становятся огромными.
  desc.querySelectorAll('img').forEach((img) => {
    const el = img as HTMLImageElement;
    const wAttr = el.getAttribute('width') || '';
    if (wAttr.includes('%')) el.removeAttribute('width');
    el.style.height = 'auto';
    el.style.maxWidth = '100%';
    if (el.style.width && el.style.width.includes('%')) el.style.width = '';
  });
  // Картинки страницы мода — общий просмотр, кнопка ссылки ведёт на оригинал.
  bindZoomableImages(desc, { external: true, source: 'mod' });
  // Ролики страницы мода — общий плеер, ссылка только на внешний файл.
  bindPlayableVideos(desc, { external: true, source: 'mod' });
  // Open external links in system browser
  desc.querySelectorAll('a[href]').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const href = (a as HTMLAnchorElement).href;
      if (!href) return;
      if (isDirectVideoUrl(href)) {
        openVideoViewer([{ src: href, externalUrl: href }], 0, 'mod');
        return;
      }
      api?.openExternal(href);
    });
  });
}

// Markdown внутри <details> marked не разбирает: заранее превращаем тело в HTML.
function markedParse(md: string): string {
  try {
    const blocks: string[] = [];
    const source = String(md || '').replace(/<details(\s[^>]*)?>([\s\S]*?)<\/details>/gi, (_full, attrs: string, inner: string) => {
      blocks.push(renderDetailsBlock(attrs || '', inner || ''));
      return `\n\n%%DETAILS${blocks.length - 1}%%\n\n`;
    });
    let html = marked.parse(source, { async: false, breaks: true, gfm: true }) as string;
    html = html.replace(/<p>\s*%%DETAILS(\d+)%%\s*<\/p>/g, (_m, index: string) => blocks[Number(index)] || '');
    html = html.replace(/%%DETAILS(\d+)%%/g, (_m, index: string) => blocks[Number(index)] || '');
    return html;
  } catch {
    return md;
  }
}

function renderDetailsBlock(attrs: string, inner: string): string {
  const summary = inner.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i);
  const body = summary ? inner.replace(summary[0], '') : inner;
  let innerHtml = '';
  try {
    innerHtml = marked.parse(body.trim(), { async: false, breaks: true, gfm: true }) as string;
  } catch {
    innerHtml = body;
  }
  const title = summary ? summary[1].trim() : '';
  const open = /\bopen\b/i.test(attrs) ? ' open' : '';
  return `<details class="sf-details"${open}><summary>${title}</summary><div class="sf-details__body"><div class="sf-details__inner">${innerHtml}</div></div></details>`;
}

/** Markdown для соцленты: @ник → mention + без «ломающих» заголовков */
function renderSocialMarkdown(md: string): string {
  const raw = String(md || '');
  const withMentions = raw.replace(
    /(^|[\s(])@([A-Za-z0-9_]{2,32})\b/g,
    '$1[@$2](#sf-mention/$2)',
  );
  let html = sanitizeHtml(markedParse(withMentions));
  html = html.replace(
    /<a\s+([^>]*?)href="#sf-mention\/([^"]+)"([^>]*)>(.*?)<\/a>/gi,
    (_m, _a, user, _b, text) =>
      `<span class="sf-mention" data-sf-user="${escapeHtml(decodeURIComponent(user))}">${text}</span>`,
  );
  return html;
}

function sanitizeHtml(html: string): string {
  const allowedTags = ['p','br','b','i','u','strong','em','h1','h2','h3','h4','h5','h6','ul','ol','li','a','img','video','source','pre','code','blockquote','hr','table','thead','tbody','tr','th','td','span','div','details','summary'];
  const allowedAttrs = ['href','src','alt','title','target','width','height','class','poster','preload','type','playsinline','muted','open'];
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, (tag) => {
      const tagName = tag.match(/<\/?(\w+)/)?.[1]?.toLowerCase();
      if (!tagName || !allowedTags.includes(tagName)) return '';
      if (tag.startsWith('</')) return `</${tagName}>`;
      const attrs = tag.match(/(\w+)\s*=\s*"([^"]*)"/g) || [];
      const safe = attrs.filter((a: string) => allowedAttrs.includes(a.split('=')[0].toLowerCase())).join(' ');
      const open = tagName === 'details' && /\sopen(?:=|\s|>|$)/i.test(tag) ? ' open' : '';
      return `<${tagName}${open}${safe ? ' ' + safe : ''}>`;
    });
}

const NOTED_VIEWS_KEY = 'uc-noted-views';

function notedViewIds(): Set<string> {
  try {
    const raw = JSON.parse(sessionStorage.getItem(NOTED_VIEWS_KEY) || '[]');
    return new Set(Array.isArray(raw) ? raw.map(String) : []);
  } catch {
    return new Set();
  }
}

function rememberNotedView(token: string): void {
  const ids = notedViewIds();
  ids.add(token);
  sessionStorage.setItem(NOTED_VIEWS_KEY, JSON.stringify([...ids]));
}

async function noteOfficialNewsView(id: string): Promise<number | null> {
  const clean = String(id || '').trim();
  if (!clean) return null;
  const token = `news:${clean}`;
  if (notedViewIds().has(token)) return null;
  rememberNotedView(token);
  const res = await api?.fetchNewsView?.(clean);
  const views = Number(res?.views);
  if (!res || res.error || !Number.isFinite(views)) {
    const ids = notedViewIds();
    ids.delete(token);
    sessionStorage.setItem(NOTED_VIEWS_KEY, JSON.stringify([...ids]));
    return null;
  }
  const cached = newsPosts.find((item) => String(item.id) === clean);
  if (cached) cached.views = views;
  return views;
}

document.getElementById('modal-mod-versions')?.addEventListener('click', () => {
  if (!detailsProjectId) return;
  // Как у «Скачать»: сначала закрываем Подробнее, иначе окно версий оказывается под ним.
  closeModal('modal-mod-details');
  openModalVersionsForDownload(detailsProjectId);
});

// Иконки клиентов в списке переноса. Файла нет — чужую иконку не подставляем.
const LAUNCHER_ICON_SRC: Record<string, string> = {
  prism: '../../assets/icons/launchersTransferIcons/prism.png',
  pinecone: '../../assets/icons/launchersTransferIcons/pinecone.png',
  modrinth: '../../assets/icons/launchersTransferIcons/modrinth.png',
  millida: '../../assets/icons/launchersTransferIcons/millida.png',
  xmcl: '../../assets/icons/launchersTransferIcons/xmcl.png',
};

const BUILD_PATH_PICK = '__pick__';
let buildPathCommitted = '';

async function fillBuildDriveSelect(): Promise<void> {
  const select = document.getElementById('modal-build-drive') as HTMLSelectElement | null;
  const menu = document.getElementById('modal-build-drive-menu');
  if (!select || !menu || !document.body.classList.contains('platform-win32')) return;
  buildPathCommitted = '';
  const loc = await api?.getInstancesLocation?.();
  const current = loc?.instancesDir || '';
  const options = [
    { value: '', label: current ? t('paths.defaultDir', { path: current }) : t('paths.defaultDisk') },
    { value: BUILD_PATH_PICK, label: t('paths.pickBuildPath') },
  ];
  select.innerHTML = options.map((o) => `<option value="${o.value.replace(/"/g, '&quot;')}">${escapeHtml(o.label)}</option>`).join('');
  menu.innerHTML = options.map((o) => `<div class="stngs-select-opt" data-value="${o.value.replace(/"/g, '&quot;')}">${escapeHtml(o.label)}</div>`).join('');
  select.value = '';
  const wrap = select.closest('.stngs-select-wrap') as HTMLElement | null;
  if (wrap) syncSelectUI(wrap);
}

document.getElementById('modal-build-drive')?.addEventListener('change', async () => {
  const select = document.getElementById('modal-build-drive') as HTMLSelectElement | null;
  const wrap = select?.closest('.stngs-select-wrap') as HTMLElement | null;
  if (!select || !wrap || select.value !== BUILD_PATH_PICK) {
    if (select && select.value !== BUILD_PATH_PICK) buildPathCommitted = select.value;
    return;
  }
  const picked = await api?.pickInstancesDir?.(t('paths.pickBuildPath'));
  if (picked) {
    let opt = Array.from(select.options).find((o) => o.value === picked);
    if (!opt) {
      opt = document.createElement('option');
      select.appendChild(opt);
      opt.value = picked;
    }
    opt.textContent = picked;
    select.value = picked;
    buildPathCommitted = picked;
  } else {
    select.value = buildPathCommitted;
  }
  syncSelectUI(wrap);
});

async function fillInstancePathField(build?: Build | null): Promise<void> {
  const el = document.getElementById('be-instance-path-text');
  const row = document.getElementById('be-instance-path-row');
  const driveField = document.getElementById('modal-build-drive-field');
  if (driveField) driveField.classList.toggle('hidden', !!build?.id);
  if (!el || !row) return;
  if (!build?.id || !document.body.classList.contains('platform-win32')) {
    row.classList.add('hidden');
    return;
  }
  row.classList.remove('hidden');
  const dir = await api?.getInstancePath?.(build.id);
  el.textContent = dir || '—';
}

async function refreshInstanceLocationSettings(): Promise<void> {
  if (!document.body.classList.contains('platform-win32')) return;
  const loc = await api?.getInstancesLocation?.();
  const label = document.getElementById('setting-instance-dir');
  if (label) label.textContent = loc?.instancesDir || '—';
  const select = document.getElementById('setting-instance-drive') as HTMLSelectElement | null;
  const menu = document.getElementById('setting-instance-drive-menu');
  if (!select || !menu) return;
  const drives = (await api?.listInstanceDrives?.()) || [];
  select.innerHTML = `<option value="">${t('paths.pickDrive')}</option>` + drives.map((d) => `<option value="${d.letter}:">${d.letter}:</option>`).join('');
  menu.innerHTML = `<div class="stngs-select-opt" data-value="">${t('paths.pickDrive')}</div>`
    + drives.map((d) => `<div class="stngs-select-opt" data-value="${d.letter}:">${d.letter}:</div>`).join('');
  const wrap = select.closest('.stngs-select-wrap') as HTMLElement | null;
  if (wrap) syncSelectUI(wrap);
}

function renderVersionFilterSettings(): void {
  const box = document.getElementById('setting-version-groups');
  if (!box) return;
  const filters = loadVersionFilters();
  box.innerHTML = MC_VERSION_GROUPS.map((group) => `
    <label class="stngs-check">
      <input type="checkbox" data-version-group="${group}" ${filters[group] ? 'checked' : ''}>
      <span>${versionGroupLabel(group)}</span>
    </label>
  `).join('');
  box.querySelectorAll<HTMLInputElement>('input[data-version-group]').forEach((input) => {
    input.addEventListener('change', () => {
      const next = loadVersionFilters();
      const group = input.dataset.versionGroup as McVersionGroup;
      next[group] = input.checked;
      if (!MC_VERSION_GROUPS.some((g) => next[g])) next.release = true;
      saveVersionFilters(next);
      rebuildBuildVersionOptions();
      renderVersionFilterSettings();
    });
  });
}

type CachedExternalLauncher = {
  id: string;
  name: string;
  iconDataUrl?: string;
  instances: Array<{
    id: string;
    name: string;
    gameVersion: string;
    loader: string;
    loaderVersion: string;
    iconDataUrl?: string;
  }>;
};

/** Уже собранный список чужих лаунчеров. Модалка импорта не сканирует диск заново. */
let cachedExternalLaunchers: CachedExternalLauncher[] | null = null;
let externalScanTask: Promise<void> | null = null;

function externalLauncherSectionsHtml(list: CachedExternalLauncher[]): string {
  return list.map((launcher) => {
    const icon = LAUNCHER_ICON_SRC[launcher.id] || launcher.iconDataUrl || '';
    const launcherIcon = icon ? `<img class="ext-launcher__icon" src="${escapeHtml(icon)}" alt="">` : '';
    const instances = launcher.instances || [];
    return `<section class="ext-launcher" data-launcher="${launcher.id}">
      <div class="ext-launcher__head">
        ${launcherIcon}
        <div class="ext-launcher__text">
          <div class="ext-launcher__name">${escapeHtml(launcher.name)}</div>
          <div class="ext-launcher__meta">${t('launchers.count', { n: instances.length })}</div>
        </div>
        <button type="button" class="ext-import" data-import-all="${launcher.id}" ${instances.length ? '' : 'disabled'}>${t('launchers.importAll')}</button>
      </div>
      <div class="ext-launcher__list">
        ${instances.length ? instances.map((inst) => `
          <div class="ext-instance">
            ${inst.iconDataUrl ? `<img class="ext-instance__icon" src="${escapeHtml(inst.iconDataUrl)}" alt="">` : ''}
            <div class="ext-instance__text">
              <div class="ext-instance__name">${escapeHtml(inst.name)}</div>
              <div class="ext-instance__meta">${escapeHtml([inst.gameVersion, inst.loader, inst.loaderVersion].filter(Boolean).join(' · '))}</div>
            </div>
            <button type="button" class="ext-import" data-import-one="${launcher.id}" data-instance="${escapeHtml(inst.id)}">${t('launchers.importOne')}</button>
          </div>
        `).join('') : `<div class="ext-launcher__empty">${t('launchers.empty')}</div>`}
      </div>
    </section>`;
  }).join('');
}

/** Внешний контур: зазор 2px, штрих 2px, радиус осевой 13px. Мигание — в CSS. */
const EXT_RING_RX = 13;
const EXT_RING_PAD = 5;

let externalRingFrame = 0;
let externalRingW = 0;
let externalRingH = 0;

function stopExternalLauncherRing(): void {
  if (externalRingFrame) cancelAnimationFrame(externalRingFrame);
  externalRingFrame = 0;
  externalRingW = 0;
  externalRingH = 0;
}

// Контур повторяет высоту блока. Пульс всей линии не зависит от периметра.
function mountExternalLauncherRing(host: HTMLElement): void {
  stopExternalLauncherRing();
  const loop = () => {
    if (!host.isConnected) return;
    paintExternalLauncherRing(host);
    externalRingFrame = requestAnimationFrame(loop);
  };
  externalRingFrame = requestAnimationFrame(loop);
}

function paintExternalLauncherRing(host: HTMLElement): void {
  const svg = host.querySelector<SVGSVGElement>('.ext-launchers__ring');
  const base = svg?.querySelector<SVGRectElement>('.ext-ring__base');
  if (!svg || !base) return;
  const cardW = host.clientWidth;
  const cardH = host.clientHeight;
  if (cardW < 8 || cardH < 8) return;
  if (cardW === externalRingW && cardH === externalRingH) return;
  externalRingW = cardW;
  externalRingH = cardH;

  const boxW = cardW + EXT_RING_PAD * 2;
  const boxH = cardH + EXT_RING_PAD * 2;
  svg.setAttribute('width', String(boxW));
  svg.setAttribute('height', String(boxH));
  svg.style.left = `${-EXT_RING_PAD}px`;
  svg.style.top = `${-EXT_RING_PAD}px`;
  svg.style.width = `${boxW}px`;
  svg.style.height = `${boxH}px`;

  // Осевая линия на 3px снаружи карточки: зазор 2px и половина штриха 1px.
  const inset = EXT_RING_PAD - 3;
  const rx = Math.min(EXT_RING_RX, (cardW + 6) / 2, (cardH + 6) / 2);
  base.setAttribute('x', String(inset));
  base.setAttribute('y', String(inset));
  base.setAttribute('width', String(cardW + 6));
  base.setAttribute('height', String(cardH + 6));
  base.setAttribute('rx', String(rx));
  base.setAttribute('ry', String(rx));
}

async function refreshExternalLaunchers(): Promise<void> {
  if (externalScanTask) return externalScanTask;
  externalScanTask = refreshExternalLaunchersNow().finally(() => {
    externalScanTask = null;
  });
  return externalScanTask;
}

async function refreshExternalLaunchersNow(): Promise<void> {
  if (!api?.scanExternalLaunchers) return;
  let res: { launchers?: CachedExternalLauncher[] } | undefined;
  try {
    res = await api.scanExternalLaunchers();
  } catch (err) {
    console.warn('[launchers] список чужих лаунчеров не загрузился', err);
    return;
  }
  const list = res?.launchers || [];
  cachedExternalLaunchers = list;
  const host = document.getElementById('external-launchers');
  if (!host) return;
  if (!list.length) {
    stopExternalLauncherRing();
    host.classList.add('hidden');
    host.innerHTML = '';
    return;
  }
  const instanceTotal = list.reduce((sum, launcher) => sum + (launcher.instances?.length || 0), 0);
  const marks = list.map((launcher) => {
    const icon = LAUNCHER_ICON_SRC[launcher.id] || launcher.iconDataUrl || '';
    return icon ? `<img class="ext-launchers__mark" src="${escapeHtml(icon)}" alt="">` : '';
  }).join('');
  host.classList.remove('is-expanded', 'hidden');
  host.innerHTML = `
    <svg class="ext-launchers__ring" aria-hidden="true">
      <rect class="ext-ring__base"></rect>
    </svg>
    <div class="ext-launchers__header">
      <button type="button" class="ext-launchers__toggle" data-ext-toggle aria-expanded="false">
        <span class="ext-launchers__marks">${marks}</span>
        <span class="ext-launchers__summary-text">${t('launchers.summary', { instances: instanceTotal, launchers: list.length })}</span>
        <span class="ext-launchers__chevron" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span>
      </button>
    </div>
    <div class="ext-launchers__collapse">
      <div class="ext-launchers__body">
        ${externalLauncherSectionsHtml(list)}
      </div>
    </div>
  `;
  mountExternalLauncherRing(host);
}

async function importExternalSelection(launcherId: string, instanceIds: string[]): Promise<void> {
  if (!api?.importExternalInstances || !instanceIds.length) return;
  updateStatus(t('status.importing'));
  const res = await api.importExternalInstances(launcherId, instanceIds);
  if (!res?.ok) {
    updateStatus(t('import.failed', { error: res?.error || 'unknown' }));
    return;
  }
  await loadBuilds();
  updateStatus(t('launchers.imported', { n: res.imported?.length || instanceIds.length }));
}

const externalLaunchersHost = document.getElementById('external-launchers');
if (externalLaunchersHost) bindExternalLaunchersClicks(externalLaunchersHost);

document.getElementById('setting-instance-drive')?.addEventListener('change', async (e) => {
  const value = (e.target as HTMLSelectElement).value;
  if (!value || !api?.setDefaultInstancesDir) return;
  const drive = value.replace(/[\\/]+$/, '');
  const parent = /^[A-Za-z]:$/.test(drive) ? `${drive}\\Undefined Client\\instances` : value;
  const res = await api.setDefaultInstancesDir(parent);
  if (!res?.ok) updateStatus(res?.error || t('paths.moveFailed'));
  else updateStatus(t('paths.defaultSaved', { path: res.path || parent }));
  await refreshInstanceLocationSettings();
});

document.getElementById('setting-instance-browse')?.addEventListener('click', async () => {
  const picked = await api?.pickInstancesDir?.();
  if (!picked || !api?.setDefaultInstancesDir) return;
  const res = await api.setDefaultInstancesDir(picked);
  if (!res?.ok) updateStatus(res?.error || t('paths.moveFailed'));
  else updateStatus(t('paths.defaultSaved', { path: res.path || picked }));
  await refreshInstanceLocationSettings();
});

document.getElementById('be-instance-move')?.addEventListener('click', async () => {
  if (!editingBuildId || !api?.pickInstancesDir || !api?.moveInstance) return;
  const dest = await api.pickInstancesDir();
  if (!dest) return;
  updateStatus(t('paths.moving'));
  const res = await api.moveInstance(editingBuildId, dest);
  if (!res?.ok) {
    updateStatus(t('paths.moveFailedDetail', { error: res?.error || 'unknown' }));
    return;
  }
  const text = document.getElementById('be-instance-path-text');
  if (text) text.textContent = res.path || dest;
  updateStatus(t('paths.moved', { path: res.path || dest }));
});

/* ── Modal: Import (.mrpack / .zip / ссылка шара) ── */
let pendingImportPath: string | null = null;

const SHARE_IMPORT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** Достаёт id шара из ссылки экспорта / deep link / сырого id. */
function parseShareImportRef(raw: string): string | null {
  const text = String(raw || '').trim().replace(/^["']+|["']+$/g, '').trim();
  if (!text) return null;
  if (SHARE_IMPORT_ID_RE.test(text)) return text;

  try {
    if (/^uclient:\/\//i.test(text)) {
      const u = new URL(text);
      if (u.hostname.toLowerCase() === 'import-instance') {
        const id = String(u.searchParams.get('id') || '').trim();
        return SHARE_IMPORT_ID_RE.test(id) ? id : null;
      }
      return null;
    }

    const u = new URL(text);
    const pathMatch = u.pathname.match(/\/instanceShare\/([A-Za-z0-9_-]{8,64})\/?$/i);
    if (pathMatch?.[1]) return pathMatch[1];
    const qId = String(u.searchParams.get('id') || '').trim();
    if (SHARE_IMPORT_ID_RE.test(qId)) return qId;
  } catch {
    /* не URL */
  }
  return null;
}

function setImportLinkError(message: string): void {
  const err = document.getElementById('import-link-error');
  if (!err) return;
  err.textContent = message;
  err.classList.toggle('hidden', !message);
}

function getImportLinkValue(): string {
  const input = document.getElementById('import-link-input') as HTMLInputElement | null;
  return String(input?.value || '').trim();
}

function syncImportConfirmEnabled(): void {
  const confirmBtn = document.getElementById('modal-import-confirm') as HTMLButtonElement | null;
  if (!confirmBtn) return;
  confirmBtn.disabled = !pendingImportPath && !getImportLinkValue();
}

function openModalImport(): void {
  pendingImportPath = null;
  const info = document.getElementById('import-info');
  const infoText = document.getElementById('import-info-text');
  const zone = document.getElementById('import-dropzone');
  const linkInput = document.getElementById('import-link-input') as HTMLInputElement | null;
  if (info) {
    info.classList.add('hidden');
    info.classList.remove('is-loading');
  }
  zone?.classList.remove('is-busy');
  if (infoText) infoText.textContent = '';
  clearImportManifestPreview();
  if (linkInput) linkInput.value = '';
  setImportLinkError('');
  syncImportConfirmEnabled();
  openModal('modal-import');
  void renderImportExternalLaunchers();
}

async function renderImportExternalLaunchers(): Promise<void> {
  const box = document.getElementById('import-external-launchers');
  if (!box) return;
  if (!cachedExternalLaunchers) await refreshExternalLaunchers();
  const list = cachedExternalLaunchers || [];
  if (!list.length) {
    box.innerHTML = `<div class="import-ext-empty">${escapeHtml(t('import.launchersEmpty'))}</div>`;
    return;
  }
  const instances = list.reduce((sum, launcher) => sum + (launcher.instances?.length || 0), 0);
  const marks = list.map((launcher) => {
    const icon = LAUNCHER_ICON_SRC[launcher.id] || '';
    const img = icon ? `<img src="${escapeHtml(icon)}" alt="">` : '';
    return `<button type="button" class="import-ext-launcher" data-import-launcher="${escapeHtml(launcher.id)}" title="${escapeHtml(launcher.name)}">${img}</button>`;
  }).join('');
  box.innerHTML = `
    <div class="import-ext-row">
      <span class="import-ext-marks">${marks}</span>
      <span class="import-ext-summary">${escapeHtml(t('import.launchersShort', { instances, launchers: list.length }))}</span>
    </div>
    <div class="import-ext-panel hidden"></div>
  `;
}

function clearImportManifestPreview(): void {
  const stats = document.getElementById('import-manifest-stats');
  const files = document.getElementById('import-manifest-files');
  if (stats) {
    stats.innerHTML = '';
    stats.classList.add('hidden');
  }
  if (files) {
    files.innerHTML = '';
    files.classList.add('hidden');
  }
}

function escapeManifestText(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderImportManifestPreview(inspect: {
  counts?: {
    mods: number;
    resourcePacks: number;
    shaders: number;
    dataPacks: number;
    configs: number;
    worlds?: number;
  };
  previewFiles?: Array<{ name: string; kind: string }>;
}): void {
  const statsEl = document.getElementById('import-manifest-stats');
  const filesEl = document.getElementById('import-manifest-files');
  if (!statsEl || !filesEl) return;

  const c = inspect.counts;
  const chips: string[] = [];
  if (c) {
    if (c.mods) chips.push(`<span class="import-manifest-stat">${t('import.manifest.mods', { n: c.mods })}</span>`);
    if (c.resourcePacks) chips.push(`<span class="import-manifest-stat">${t('import.manifest.resourcePacks', { n: c.resourcePacks })}</span>`);
    if (c.shaders) chips.push(`<span class="import-manifest-stat">${t('import.manifest.shaders', { n: c.shaders })}</span>`);
    if (c.dataPacks) chips.push(`<span class="import-manifest-stat">${t('import.manifest.dataPacks', { n: c.dataPacks })}</span>`);
    if (c.configs) chips.push(`<span class="import-manifest-stat">${t('import.manifest.configs', { n: c.configs })}</span>`);
    if (c.worlds) chips.push(`<span class="import-manifest-stat">${t('import.manifest.worlds', { n: c.worlds })}</span>`);
  }
  if (chips.length) {
    statsEl.innerHTML = chips.join('');
    statsEl.classList.remove('hidden');
  } else {
    statsEl.innerHTML = '';
    statsEl.classList.add('hidden');
  }

  const preview = Array.isArray(inspect.previewFiles) ? inspect.previewFiles : [];
  if (!preview.length) {
    filesEl.innerHTML = '';
    filesEl.classList.add('hidden');
    return;
  }
  const shown = preview.slice(0, 24);
  const more = preview.length - shown.length;
  filesEl.innerHTML =
    shown
      .map((f) => {
        const kindKey = `import.manifest.kind.${f.kind}`;
        const kindLabel = t(kindKey) !== kindKey ? t(kindKey) : f.kind;
        return `<div class="import-manifest-file"><span class="import-manifest-file-kind">${escapeManifestText(kindLabel)}</span><span class="import-manifest-file-name" title="${escapeManifestText(f.name)}">${escapeManifestText(f.name)}</span></div>`;
      })
      .join('') +
    (more > 0 ? `<div class="import-manifest-more">${t('import.manifest.more', { n: more })}</div>` : '');
  filesEl.classList.remove('hidden');
}

async function selectImportModpackFile(): Promise<void> {
  if (!api?.pickModpack) return;
  const filePath = await api.pickModpack();
  if (!filePath) return;
  pendingImportPath = filePath;
  const info = document.getElementById('import-info');
  const infoText = document.getElementById('import-info-text');
  const confirmBtn = document.getElementById('modal-import-confirm') as HTMLButtonElement;
  const zone = document.getElementById('import-dropzone');
  const name = filePath.replace(/^.*[\\/]/, '');
  if (info) {
    info.classList.remove('hidden');
    info.classList.add('is-loading');
  }
  zone?.classList.add('is-busy');
  clearImportManifestPreview();
  if (infoText) infoText.textContent = t('import.detecting');
  if (confirmBtn) confirmBtn.disabled = true;

  try {
    if (api.inspectModpack) {
      const res = await api.inspectModpack(filePath);
      if (res.success && res.inspect && infoText) {
        const i = res.inspect;
        const formatKey = `import.format.${i.format}`;
        const formatLabel = t(formatKey) !== formatKey ? t(formatKey) : i.format;
        const loaderVer = i.loaderVersion ? ` ${i.loaderVersion}` : '';
        infoText.textContent = `${formatLabel} · ${t('import.preview', {
          name: i.name || name,
          version: i.gameVersion || '—',
          loader: i.loader || 'vanilla',
          loaderVer,
          n: String(i.fileCount ?? 0),
        })}`;
        renderImportManifestPreview(i);
      } else if (infoText) {
        infoText.textContent = t('import.selected', { name });
      }
    } else if (infoText) {
      infoText.textContent = t('import.selected', { name });
    }
  } catch {
    if (infoText) infoText.textContent = t('import.selected', { name });
  } finally {
    info?.classList.remove('is-loading');
    zone?.classList.remove('is-busy');
    syncImportConfirmEnabled();
  }
}

document.getElementById('import-link-input')?.addEventListener('input', () => {
  setImportLinkError('');
  syncImportConfirmEnabled();
});

document.getElementById('import-link-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    void document.getElementById('modal-import-confirm')?.click();
  }
});

document.getElementById('import-dropzone')?.addEventListener('click', () => {
  void selectImportModpackFile();
});

document.getElementById('modal-import-confirm')?.addEventListener('click', async () => {
  const linkRaw = getImportLinkValue();

  // Файл приоритетнее, если выбран; иначе — импорт по ссылке
  if (!pendingImportPath && linkRaw) {
    const id = parseShareImportRef(linkRaw);
    if (!id) {
      setImportLinkError(t('import.linkInvalid'));
      return;
    }
    closeModal('modal-import');
    await openShareImportModal(id);
    return;
  }

  if (!pendingImportPath || !api?.importModpack) return;
  const archivePath = pendingImportPath;
  closeModal('modal-import');
  updateStatus(t('status.importing'));
  try {
    const res = await api.importModpack(archivePath);
    if (!res.success || !res.build) {
      updateStatus(t('import.failed', { error: res.error || 'unknown' }));
      return;
    }
    // Обогащаем метаданные через scan; если scan пуст — оставляем inventory из импорта
    let enriched = { ...res.build };
    if (api.scanInstance) {
      try {
        const scan = await api.scanInstance(res.build.id);
        const mapItems = (list: any[]) => (list || []).map((m: any) => ({
          name: m.name || m.filename,
          enabled: m.enabled !== false,
          filename: m.filename,
          version: m.version,
          description: m.description,
          projectId: m.projectId,
          iconUrl: m.iconUrl,
        }));
        const mods = mapItems(scan.mods);
        const resourcePacks = mapItems(scan.resourcepacks);
        const shaders = mapItems(scan.shaders);
        const dataPacks = mapItems(scan.datapacks);
        enriched = {
          ...res.build,
          mods: mods.length ? mods : (res.build.mods || []),
          resourcePacks: resourcePacks.length ? resourcePacks : (res.build.resourcePacks || []),
          shaders: shaders.length ? shaders : (res.build.shaders || []),
          dataPacks: dataPacks.length ? dataPacks : (res.build.dataPacks || []),
        };
        await api.saveBuild?.(enriched);
      } catch { /* сканирование не критично */ }
    }
    await loadBuilds();
    const modsN = enriched.mods?.length || 0;
    const skipN = Number(res.skipped || 0) + (Array.isArray(res.extractSkipped) ? res.extractSkipped.length : 0);
    if (res.incomplete || skipN > 0) {
      updateStatus(t('import.partial', { name: res.build.name, n: skipN || modsN }));
      showAppToast(t('import.partialHint', { n: skipN || 1 }));
    } else {
      updateStatus(t('import.done', { name: res.build.name }) + (modsN ? ` · ${modsN}` : ''));
    }
  } catch (e: any) {
    updateStatus(t('import.failed', { error: e?.message || 'unknown' }));
  }
});

/* ── Screenshots & Worlds (build editor) ── */

let beScreenshots: any[] = [];
let beWorlds: any[] = [];
let beSelScreenshots = new Set<string>();
let beSelWorlds = new Set<string>();

const BE_MEDIA_CHECK_SVG = '<span class="be-media-check"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 6.5 5 9l4.5-6" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';

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
  grid.className = 'be-shots-grid';
  grid.innerHTML = beScreenshots.map((s, i) => `
    <button type="button" class="be-shot-card${beSelScreenshots.has(s.name) ? ' selected' : ''}" data-name="${s.name}" data-index="${i}" style="animation-delay:${Math.min(i, 12) * 40}ms">
      <div class="be-shot-card__media">
        ${s.thumb ? `<img src="${s.thumb}" alt="" loading="lazy">` : '<div class="be-shot-card__placeholder"></div>'}
        ${BE_MEDIA_CHECK_SVG}
        <span class="be-shot-card__open">${t('be.shotOpen')}</span>
      </div>
      <div class="be-shot-card__meta">
        <div class="be-shot-card__name">${s.name}</div>
        <div class="be-shot-card__info">${formatBeSize(s.size)}</div>
      </div>
    </button>
  `).join('');
  if (countEl) countEl.textContent = beSelScreenshots.size > 0 ? t('be.selectedCount').replace('{n}', String(beSelScreenshots.size)) : '';
  grid.querySelectorAll<HTMLElement>('.be-shot-card').forEach(card => {
    const name = card.getAttribute('data-name');
    if (!name) return;
    const toggleSelect = (e: Event): void => {
      e.preventDefault();
      e.stopPropagation();
      if (beSelScreenshots.has(name)) beSelScreenshots.delete(name);
      else beSelScreenshots.add(name);
      renderBeScreenshots();
    };
    card.querySelector<HTMLElement>('.be-media-check')?.addEventListener('click', toggleSelect);
    card.addEventListener('click', (e) => {
      // Ctrl/Cmd по карточке — тоже мультивыбор
      if ((e as MouseEvent).ctrlKey || (e as MouseEvent).metaKey) {
        toggleSelect(e);
        return;
      }
      void openBeShotViewer(name);
    });
  });
}

let beShotViewerIndex = 0;
/** instance — скриншоты сборки; gallery — галерея мода с Modrinth */
let beShotViewerMode: 'instance' | 'gallery' = 'instance';

function syncBeShotViewerActions(): void {
  const isGallery = beShotViewerMode === 'gallery';
  const saveBtn = document.getElementById('be-shot-viewer-save');
  const delBtn = document.getElementById('be-shot-viewer-delete');
  // class «hidden» — display:none !important; атрибут hidden перебивается .be-add-btn
  saveBtn?.classList.toggle('hidden', isGallery);
  delBtn?.classList.toggle('hidden', isGallery);
  if (saveBtn) saveBtn.hidden = isGallery;
  if (delBtn) delBtn.hidden = isGallery;
}

function closeBeShotViewer(): void {
  const viewer = document.getElementById('be-shot-viewer');
  if (!viewer || viewer.classList.contains('hidden')) return;
  viewer.classList.add('is-closing');
  setTimeout(() => {
    viewer.classList.add('hidden');
    viewer.classList.remove('is-closing', 'is-open');
    viewer.setAttribute('aria-hidden', 'true');
    const img = document.getElementById('be-shot-viewer-img') as HTMLImageElement | null;
    if (img) img.removeAttribute('src');
    beShotViewerMode = 'instance';
    syncBeShotViewerActions();
  }, 180);
}

async function showBeShotViewer(): Promise<void> {
  const viewer = document.getElementById('be-shot-viewer');
  if (!viewer) return;
  syncBeShotViewerActions();
  viewer.classList.remove('hidden', 'is-closing');
  viewer.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => viewer.classList.add('is-open'));
  await loadBeShotViewerSlide();
}

async function openBeShotViewer(name: string): Promise<void> {
  const idx = beScreenshots.findIndex((s) => s.name === name);
  if (idx < 0 || !editingBuildId) return;
  const buildId = editingBuildId;
  openImageViewer(
    beScreenshots.map((shot) => ({
      src: String(shot.thumb || ''),
      alt: String(shot.name || ''),
      loadFull: async () => {
        if (!api?.getScreenshot) return shot.thumb || null;
        try {
          const res = await api.getScreenshot(buildId, shot.name);
          if (res?.success && res.dataUrl) return res.dataUrl;
        } catch {
          /* остаётся превью */
        }
        return shot.thumb || null;
      },
    })),
    idx,
    'shots',
  );
}

function openModGalleryViewer(index: number): void {
  if (index < 0 || index >= modDetailsGalleryItems.length) return;
  // Не даём фокусу кнопки утащить modal-body наверх
  const body = document.querySelector('#modal-mod-details .modal-body') as HTMLElement | null;
  const savedScroll = body?.scrollTop ?? 0;
  const item = modDetailsGalleryItems[index];
  if (!item) return;
  if (modGalleryIsVideo(item)) {
    const videos = modDetailsGalleryItems.filter(modGalleryIsVideo);
    const at = Math.max(0, videos.indexOf(item));
    openVideoViewer(
      videos.map((it) => {
        const raw = unwrapCatalogImageUrl(it.url);
        const src = /^https?:\/\//i.test(raw) ? raw : it.url;
        return {
          src,
          externalUrl: /^https?:\/\//i.test(raw) ? raw : null,
          alt: it.title || '',
        };
      }),
      at,
      'mod',
    );
  } else {
    const images = modDetailsGalleryItems.filter((it) => !modGalleryIsVideo(it));
    const at = Math.max(0, images.findIndex((it) => it === item));
    openImageViewer(
      images.map((it) => {
        const raw = unwrapCatalogImageUrl(it.url);
        return {
          src: catalogImageUrl(it.url),
          fallbackSrc: it.thumb ? catalogImageUrl(it.thumb) : null,
          externalUrl: /^https?:\/\//i.test(raw) ? raw : null,
          alt: it.title || '',
        };
      }),
      at,
      'mod',
    );
  }
  if (body) body.scrollTop = savedScroll;
}

async function loadBeShotViewerSlide(): Promise<void> {
  const img = document.getElementById('be-shot-viewer-img') as HTMLImageElement | null;
  const nameEl = document.getElementById('be-shot-viewer-name');
  const infoEl = document.getElementById('be-shot-viewer-info');
  const loading = document.getElementById('be-shot-viewer-loading');
  const errEl = document.getElementById('be-shot-viewer-error');
  if (loading) loading.classList.remove('hidden');
  if (errEl) errEl.classList.add('hidden');
  if (img) img.classList.remove('is-ready');

  if (beShotViewerMode === 'gallery') {
    const item = modDetailsGalleryItems[beShotViewerIndex];
    if (!item) {
      if (loading) loading.classList.add('hidden');
      return;
    }
    if (nameEl) nameEl.textContent = item.title || item.url.split('/').pop() || '—';
    if (infoEl) infoEl.textContent = `${beShotViewerIndex + 1} / ${modDetailsGalleryItems.length}`;
    if (!img) {
      if (loading) loading.classList.add('hidden');
      return;
    }
    // Сразу полноразмерный кадр — превью _350 в полноэкранном режиме выглядит как ~144p
    const src = catalogImageUrl(item.url);
    const slideIndex = beShotViewerIndex;
    await new Promise<void>((resolve) => {
      img.onload = () => {
        if (beShotViewerMode === 'gallery' && beShotViewerIndex === slideIndex) {
          img.classList.add('is-ready');
        }
        resolve();
      };
      img.onerror = () => {
        // Fallback на thumb, если оригинал недоступен
        if (item.thumb && img.src !== catalogImageUrl(item.thumb)) {
          img.onload = () => {
            if (beShotViewerMode === 'gallery' && beShotViewerIndex === slideIndex) {
              img.classList.add('is-ready');
            }
            resolve();
          };
          img.onerror = () => resolve();
          img.src = catalogImageUrl(item.thumb);
          return;
        }
        resolve();
      };
      img.src = src;
    });
    if (loading) loading.classList.add('hidden');
    if (beShotViewerIndex === slideIndex && !img.classList.contains('is-ready') && errEl) {
      errEl.classList.remove('hidden');
    }
    return;
  }

  const shot = beScreenshots[beShotViewerIndex];
  if (!shot || !editingBuildId) {
    if (loading) loading.classList.add('hidden');
    return;
  }
  if (nameEl) nameEl.textContent = shot.name;
  if (infoEl) infoEl.textContent = `${beShotViewerIndex + 1} / ${beScreenshots.length} · ${formatBeSize(shot.size)}`;
  if (img && shot.thumb) img.src = shot.thumb;
  let loaded = Boolean(shot.thumb);
  if (api?.getScreenshot) {
    try {
      const res = await api.getScreenshot(editingBuildId, shot.name);
      if (res?.success && res.dataUrl && img && beScreenshots[beShotViewerIndex]?.name === shot.name) {
        img.onload = () => img.classList.add('is-ready');
        img.src = res.dataUrl;
        loaded = true;
      }
    } catch {
      /* ниже покажем ошибку, если нет thumb */
    }
  }
  if (loading) loading.classList.add('hidden');
  if (!loaded && errEl) errEl.classList.remove('hidden');
}

async function beShotViewerCopy(): Promise<void> {
  if (beShotViewerMode === 'gallery') {
    const item = modDetailsGalleryItems[beShotViewerIndex];
    if (!item) return;
    const url = catalogImageUrl(item.url);
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })]);
        showAppToast(t('be.shotCopied'));
        return;
      }
    } catch {
      /* fallback — скопировать URL */
    }
    try {
      await navigator.clipboard.writeText(item.url);
      showAppToast(t('be.shotCopied'));
    } catch {
      showAppToast(t('be.shotCopyFailed'));
    }
    return;
  }
  const shot = beScreenshots[beShotViewerIndex];
  if (!shot || !editingBuildId || !api?.copyScreenshot) return;
  const res = await api.copyScreenshot(editingBuildId, shot.name);
  showAppToast(res?.success ? t('be.shotCopied') : t('be.shotCopyFailed'));
}

async function beShotViewerSave(): Promise<void> {
  if (beShotViewerMode === 'gallery') return;
  const shot = beScreenshots[beShotViewerIndex];
  if (!shot || !editingBuildId) return;
  await beMediaSave('screenshots', new Set([shot.name]));
}

async function beShotViewerDelete(): Promise<void> {
  if (beShotViewerMode === 'gallery') return;
  const shot = beScreenshots[beShotViewerIndex];
  if (!shot) return;
  const name = shot.name;
  await beMediaDelete('screenshots', new Set([name]), t('be.confirmDeleteScreenshot'));
  if (!beScreenshots.some((s) => s.name === name)) {
    if (beScreenshots.length === 0) closeBeShotViewer();
    else {
      beShotViewerIndex = Math.min(beShotViewerIndex, beScreenshots.length - 1);
      await loadBeShotViewerSlide();
    }
  }
}

function beShotViewerNav(delta: number): void {
  const total =
    beShotViewerMode === 'gallery' ? modDetailsGalleryItems.length : beScreenshots.length;
  if (total === 0) return;
  beShotViewerIndex = (beShotViewerIndex + delta + total) % total;
  void loadBeShotViewerSlide();
}

function trParams(key: string, params?: Record<string, string>): string {
  let s = t(key);
  if (params) {
    for (const [k, v] of Object.entries(params)) s = s.replace(`{${k}}`, v);
  }
  return s;
}

async function runBeWorldExport(worldPath: string, mcVersion: string): Promise<void> {
  if (!api?.exportWorldPreview || !api?.openWorldExport) {
    updateStatus(t('be.worldExportUnavailable'));
    return;
  }
  updateStatus(t('be.worldExportStarting'));
  const off = api.onWorldExportProgress?.((msg) => updateStatus(msg));
  try {
    const res = await api.exportWorldPreview(worldPath, mcVersion || '1.21.6');
    if (!res?.ok || !res.outDir) {
      updateStatus(res?.error || t('be.worldExportFail'));
      return;
    }
    updateStatus(t('be.worldExportDone'));
    await api.openWorldExport(res.outDir);
  } catch (e: any) {
    updateStatus(e?.message || t('be.worldExportFail'));
  } finally {
    off?.();
  }
}

async function openBeWorldPreview(folder: string): Promise<void> {
  if (!editingBuildId || !folder || !api?.getInstancePath || !api?.openWorldViewer) return;
  try {
    const root = await api.getInstancePath(editingBuildId);
    if (!root) {
      updateStatus(t('be.worldPreviewFail'));
      return;
    }
    const worldPath = joinInstancePath(root, 'saves', folder);
    const world = beWorlds.find((w) => w.folder === folder);
    const dataVersion = Number(world?.dataVersion || 0);
    const gate = resolvePreviewStrategy(dataVersion, false);

    if (gate.strategy === 'unsupported' || !gate.liveAvailable) {
      window.alert(trParams(gate.messageKey, gate.messageParams));
      return;
    }

    // Live / degraded — сразу открываем модалку, без modal-confirm.
    const skinId = getActiveSkinId();
    const skin = (skinId && savedSkins.find((s) => s.id === skinId && s.dataUrl))
      || savedSkins.find((s) => s.dataUrl && !isCapeId(s.id));
    const bounds = await openWorldPreviewModalChrome();
    await api.openWorldViewer(worldPath, {
      username: currentAccount?.username || 'Player',
      uuid: currentAccount?.uuid || undefined,
      skinDataUrl: skin?.dataUrl,
    }, bounds || undefined);
  } catch {
    await closeWorldPreviewModal();
    updateStatus(t('be.worldPreviewFail'));
  }
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
    const folderAttr = escapeHtml(w.folder);
    const badge = previewBadge(Number(w.dataVersion || 0));
    return `
    <div class="be-media-card${beSelWorlds.has(w.folder) ? ' selected' : ''}" data-name="${folderAttr}">
      ${w.icon ? `<img class="be-media-thumb world" src="${w.icon}" loading="lazy">` : '<div class="be-media-thumb world"></div>'}
      <div class="be-media-text">
        <div class="be-media-name">
          <span class="be-world-badge be-world-badge-${badge.kind}">${escapeHtml(t(badge.labelKey))}</span>
          ${escapeHtml(w.name)}
        </div>
        <div class="be-media-info">${info.join(' • ')}</div>
      </div>
      <button type="button" class="be-world-preview-btn" data-folder="${folderAttr}" title="${escapeHtml(t('be.worldPreview'))}">${escapeHtml(t('be.worldPreview'))}</button>
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
  grid.querySelectorAll<HTMLButtonElement>('.be-world-preview-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const folder = btn.getAttribute('data-folder');
      if (folder) void openBeWorldPreview(folder);
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

async function beMediaDelete(
  sub: 'screenshots' | 'saves',
  sel: Set<string>,
  confirmMsg?: string,
): Promise<void> {
  if (sel.size === 0 || !editingBuildId || !api?.deleteInstanceFiles) return;
  if (!await confirmAction(confirmMsg || t('be.confirmDeleteFiles'))) return;
  const res = await api.deleteInstanceFiles(editingBuildId, sub, [...sel]);
  if (res?.success) {
    showAppToast(t('be.deletedOk').replace('{n}', String(res.deleted ?? 0)));
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

document.getElementById('be-shot-viewer-backdrop')?.addEventListener('click', () => closeBeShotViewer());
document.getElementById('be-shot-viewer-close')?.addEventListener('click', () => closeBeShotViewer());
document.getElementById('be-shot-viewer-prev')?.addEventListener('click', () => beShotViewerNav(-1));
document.getElementById('be-shot-viewer-next')?.addEventListener('click', () => beShotViewerNav(1));
document.getElementById('be-shot-viewer-copy')?.addEventListener('click', () => void beShotViewerCopy());
document.getElementById('be-shot-viewer-save')?.addEventListener('click', () => void beShotViewerSave());
document.getElementById('be-shot-viewer-delete')?.addEventListener('click', () => void beShotViewerDelete());
document.addEventListener('keydown', (e) => {
  const viewer = document.getElementById('be-shot-viewer');
  if (!viewer || viewer.classList.contains('hidden')) return;
  if (e.key === 'Escape') { e.preventDefault(); closeBeShotViewer(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); beShotViewerNav(-1); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); beShotViewerNav(1); }
  else if (e.key === 'c' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void beShotViewerCopy(); }
});

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
  if (!api?.getInstancePath || !api?.openPath) return;
  try {
    const instanceDir = await api.getInstancePath(editingBuildId);
    if (!instanceDir) return;
    const err = await api.openPath(instanceDir);
    if (err) {
      updateStatus(String(err));
      return;
    }
  } catch (e) {
    updateStatus(e instanceof Error ? e.message : String(e));
    return;
  }
  closeModalBuildModal();
});
document.getElementById('modal-build')?.addEventListener('click', (e) => { if (e.target === e.currentTarget) closeModalBuildModal(); });

// ===== Импорт/скан контента сборки (кнопки в шапке панелей mods/rp/shaders/dp) =====
const BE_ADD_BTN_TO_LIST: Record<string, string> = {
  'be-mods-add': 'be-mods-list',
  'be-rp-add': 'be-rp-list',
  'be-shaders-add': 'be-shaders-list',
  'be-dp-add': 'be-dp-list',
};

const BE_LIST_TO_CONTENT: Record<string, {
  type: 'mod' | 'resourcepack' | 'shader' | 'datapack';
  titleKey: string;
  localHintKey: string;
}> = {
  'be-mods-list': {
    type: 'mod',
    titleKey: 'be.install.titleMod',
    localHintKey: 'be.install.localHintMod',
  },
  'be-rp-list': {
    type: 'resourcepack',
    titleKey: 'be.install.titleResourcepack',
    localHintKey: 'be.install.localHintResourcepack',
  },
  'be-shaders-list': {
    type: 'shader',
    titleKey: 'be.install.titleShader',
    localHintKey: 'be.install.localHintShader',
  },
  'be-dp-list': {
    type: 'datapack',
    titleKey: 'be.install.titleDatapack',
    localHintKey: 'be.install.localHintDatapack',
  },
};

const BE_LOADER_CATALOG = new Set(['fabric', 'forge', 'neoforge', 'quilt']);

type BeInstallContentType = 'mod' | 'resourcepack' | 'shader' | 'datapack';

let beInstallListId = 'be-mods-list';
let beInstallType: BeInstallContentType = 'mod';
let beInstallQuery = '';
let beInstallOffset = 0;
let beInstallTotal = 0;
let beInstallData: any[] = [];
let beInstallLoading = false;
let beInstallToken = 0;
let beInstallSearchTimer: ReturnType<typeof setTimeout> | null = null;
let beInstallSource: 'both' | 'modrinth' | 'curseforge' = 'both';
let beInstallSort = 'relevance';

function getEditingBuildCatalogMeta(): { gameVersion: string; loader: string } {
  const versionSelect = document.getElementById('modal-build-version') as HTMLSelectElement | null;
  const loaderSelect = document.getElementById('modal-build-loader') as HTMLSelectElement | null;
  const gameVersion = String(
    versionSelect?.value || editingBuild?.gameVersion || '',
  ).trim();
  const loader = String(loaderSelect?.value || editingBuild?.loader || 'vanilla')
    .trim()
    .toLowerCase();
  return { gameVersion, loader: loader || 'vanilla' };
}

function beInstallNeedsLoaderFilter(type: BeInstallContentType): boolean {
  return type === 'mod';
}

/** Для vanilla скрываем вкладки модов и шейдеров в редакторе сборки. */
function updateBeLoaderTabsVisibility(): void {
  const loader = getEditingBuildCatalogMeta().loader;
  const isVanilla = !BE_LOADER_CATALOG.has(loader);
  document.querySelectorAll<HTMLElement>('.be-tab[data-be-tab="mods"], .be-tab[data-be-tab="shaders"]').forEach((el) => {
    el.hidden = isVanilla;
  });
  document.querySelectorAll<HTMLElement>('.be-panel[data-be-panel="mods"], .be-panel[data-be-panel="shaders"]').forEach((el) => {
    el.hidden = isVanilla;
  });
  const active = document.querySelector('.be-tab.active') as HTMLElement | null;
  const tab = active?.getAttribute('data-be-tab') || '';
  if (isVanilla && (tab === 'mods' || tab === 'shaders')) {
    switchBeTab('general');
  }
}

function applyBeInstallViewModeUi(): void {
  const mode = getModsViewMode();
  const grid = document.getElementById('be-install-grid');
  const btn = document.getElementById('be-install-view-toggle');
  grid?.classList.toggle('is-cards', mode === 'cards');
  if (btn) {
    btn.setAttribute('aria-pressed', mode === 'cards' ? 'true' : 'false');
    btn.dataset.mode = mode;
    const titleKey = mode === 'cards' ? 'mods.view.toggleToList' : 'mods.view.toggleToCards';
    btn.setAttribute('title', t(titleKey));
    btn.setAttribute('aria-label', t(titleKey));
  }
}

function syncBeInstallFilterSelects(): void {
  const sourceSel = document.getElementById('be-install-source-select') as HTMLSelectElement | null;
  const sortSel = document.getElementById('be-install-sort-select') as HTMLSelectElement | null;
  if (sourceSel) {
    sourceSel.value = beInstallSource;
    const wrap = sourceSel.closest('.stngs-select-wrap') as HTMLElement | null;
    if (wrap) syncSelectUI(wrap);
  }
  if (sortSel) {
    sortSel.value = beInstallSort;
    const wrap = sortSel.closest('.stngs-select-wrap') as HTMLElement | null;
    if (wrap) syncSelectUI(wrap);
  }
}

function renderBeInstallCard(p: any, mode: ModsViewMode): string {
  const id = escapeHtml(String(p.project_id || p.slug || p.id || ''));
  const title = escapeHtml(String(p.title || 'Unknown'));
  const desc = escapeHtml(String(p.description || '').substring(0, mode === 'cards' ? 120 : 110));
  const accent = modAccentColor(p);
  const source = modSourceOf(p);
  const sourceBadge = modSourceBadge(source);
  const icon = p.icon_url
    ? `<img src="${escapeHtml(catalogImageUrl(p.icon_url))}" alt="">`
    : '<svg width="24" height="24" viewBox="0 0 20 20" fill="none"><rect width="20" height="20" rx="4" fill="#2A2A2A"/><path d="M6 4L14 10L6 16V4Z" fill="#fff"/></svg>';
  const actions = `<div class="mod-card-actions${mode === 'cards' ? ' mod-tile__actions' : ''}">
    <button type="button" class="details-btn" data-be-install-details="${id}">${t('btn.details')}</button>
    <button type="button" class="list-row-btn download-btn" data-be-install-pick="${id}">${t('btn.install')}</button>
  </div>`;
  if (mode === 'cards') {
    const authorRaw = String(p.author || '').trim();
    const gallery = modGalleryUrl(p);
    const placeholder = source === 'curseforge' ? MOD_CF_GALLERY_PLACEHOLDER : MOD_GALLERY_PLACEHOLDER;
    const hero = gallery
      ? `<img class="mod-tile__hero-img" src="${escapeHtml(catalogImageUrl(gallery))}" alt="" loading="lazy">`
      : placeholder;
    const downloads = formatAiDownloads(p.downloads);
    const follows = formatAiDownloads(p.follows);
    const updated = formatModsRelativeDate(p.date_modified);
    return `<article class="mod-tile" data-modrinth-id="${id}" data-mod-source="${escapeHtml(source)}">
      <div class="mod-tile__hero" style="--mod-accent:${accent}">${hero}</div>
      <div class="mod-tile__body">
        <div class="mod-tile__head">
          <div class="mod-tile__icon" style="background:${accent}">${icon}</div>
          <div class="mod-tile__titles">
            <div class="mod-tile__name">${title} ${sourceBadge}</div>
            ${authorRaw ? `<div class="mod-tile__author">${escapeHtml(t('mods.byAuthor', { author: authorRaw }))}</div>` : ''}
          </div>
        </div>
        <p class="mod-tile__desc">${desc}</p>
        <div class="mod-tile__stats">
          <span title="${escapeHtml(t('mods.stat.downloads'))}">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M6 1.5v6.5M3.5 5.5L6 8l2.5-2.5M2 10.5h8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
            ${escapeHtml(downloads)}
          </span>
          <span title="${escapeHtml(t('mods.stat.follows'))}">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M6 10.2l-4.1-3.7A2.6 2.6 0 016 2.7a2.6 2.6 0 014.1 3.8L6 10.2z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>
            ${escapeHtml(follows)}
          </span>
          ${updated ? `<span title="${escapeHtml(t('mods.stat.updated'))}">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><circle cx="6" cy="6" r="4.25" stroke="currentColor" stroke-width="1.2"/><path d="M6 3.5V6l1.8 1.2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
            ${escapeHtml(updated)}
          </span>` : ''}
        </div>
        ${actions}
      </div>
    </article>`;
  }
  return `<div class="mod-card" data-modrinth-id="${id}" data-mod-source="${escapeHtml(source)}">
    <div class="mod-card-icon" style="background:${accent}">${icon}</div>
    <div class="mod-card-info">
      <div class="mod-card-name">${title} ${sourceBadge}</div>
      <div class="mod-card-desc">${desc}</div>
    </div>
    ${actions}
  </div>`;
}

async function openBeInstallModal(listId: string): Promise<void> {
  if (!editingBuildId) {
    window.alert(t('be.importNeedSave'));
    return;
  }
  const cfg = BE_LIST_TO_CONTENT[listId];
  if (!cfg) return;

  const meta = getEditingBuildCatalogMeta();
  // Моды/шейдеры на vanilla — только локальные файлы (вкладки обычно скрыты)
  if ((cfg.type === 'mod' || cfg.type === 'shader') && !BE_LOADER_CATALOG.has(meta.loader)) {
    await runBeImportFiles(listId);
    return;
  }

  beInstallListId = listId;
  beInstallType = cfg.type;
  beInstallQuery = '';
  beInstallOffset = 0;
  beInstallTotal = 0;
  beInstallData = [];
  beInstallSource = modsSource;
  beInstallSort = modsSort || 'relevance';

  const titleEl = document.getElementById('be-install-title');
  const subEl = document.getElementById('be-install-sub');
  const hintEl = document.getElementById('be-install-local-hint');
  const metaEl = document.getElementById('be-install-meta');
  const searchEl = document.getElementById('be-install-search') as HTMLInputElement | null;
  if (titleEl) titleEl.textContent = t(cfg.titleKey);
  if (subEl) {
    subEl.textContent = beInstallNeedsLoaderFilter(cfg.type)
      ? t('be.install.sub')
      : t('be.install.subVersionOnly');
  }
  if (hintEl) hintEl.textContent = t(cfg.localHintKey);
  if (searchEl) searchEl.value = '';
  if (metaEl) {
    const chips: string[] = [];
    if (meta.gameVersion) {
      chips.push(
        `<span class="be-install-chip">${escapeHtml(t('be.install.metaVersion', { version: meta.gameVersion }))}</span>`,
      );
    }
    if (beInstallNeedsLoaderFilter(cfg.type) && meta.loader) {
      chips.push(
        `<span class="be-install-chip">${escapeHtml(t('be.install.metaLoader', { loader: meta.loader }))}</span>`,
      );
    }
    metaEl.innerHTML = chips.join('');
  }

  syncBeInstallFilterSelects();
  applyBeInstallViewModeUi();
  const scrollEl = document.getElementById('be-install-scroll');
  if (scrollEl) scrollEl.scrollTop = 0;
  document.getElementById('be-install-search-bar')?.classList.remove('is-stuck');
  openModal('modal-be-install');
  await searchBeInstallCatalog('', false);
}

function renderBeInstallGrid(append: boolean): void {
  const grid = document.getElementById('be-install-grid');
  if (!grid) return;
  applyBeInstallViewModeUi();
  if (!beInstallData.length) {
    grid.innerHTML = `<div class="be-install-empty">${escapeHtml(t('be.install.empty'))}</div>`;
    return;
  }
  const mode = getModsViewMode();
  const rows = beInstallData.map((p) => renderBeInstallCard(p, mode)).join('');
  const more =
    beInstallOffset < beInstallTotal
      ? `<div class="be-install-empty" id="be-install-more" style="padding:10px;cursor:pointer">${escapeHtml(t('common.loading'))}</div>`
      : '';
  if (append) {
    grid.querySelector('#be-install-more')?.remove();
    grid.insertAdjacentHTML('beforeend', rows + more);
  } else {
    grid.innerHTML = rows + more;
  }
}

async function searchBeInstallCatalog(query: string, append: boolean): Promise<void> {
  const grid = document.getElementById('be-install-grid');
  if (!grid || !api?.getModrinthProjects) return;
  if (beInstallLoading) return;
  beInstallLoading = true;
  const token = ++beInstallToken;
  if (!append) {
    beInstallOffset = 0;
    beInstallData = [];
    grid.innerHTML = `<div class="be-install-empty">${escapeHtml(t('be.install.loading'))}</div>`;
  }
  beInstallQuery = query;
  const meta = getEditingBuildCatalogMeta();
  const loaders = beInstallNeedsLoaderFilter(beInstallType) && meta.loader !== 'vanilla'
    ? [meta.loader]
    : [];
  const version =
    meta.gameVersion && meta.gameVersion !== 'latest_release' && meta.gameVersion !== 'latest_snapshot'
      ? meta.gameVersion
      : undefined;
  try {
    const result = await api.getModrinthProjects(query || '', beInstallType, beInstallOffset, 20, {
      loaders,
      version,
      index: beInstallSort || 'relevance',
      source: beInstallSource,
    });
    if (token !== beInstallToken) return;
    if (result?.error) {
      if (!append) {
        grid.innerHTML = `<div class="be-install-empty">${escapeHtml(t('mods.loadError'))}: ${escapeHtml(String(result.error))}</div>`;
      }
      return;
    }
    const hits = result?.hits || [];
    beInstallTotal = result?.total_hits || 0;
    beInstallData = append ? beInstallData.concat(hits) : hits;
    if (hits.length) beInstallOffset += 20;
    if (append && hits.length === 0) beInstallTotal = beInstallOffset;
    renderBeInstallGrid(append);
  } catch {
    if (token !== beInstallToken) return;
    if (!append) {
      grid.innerHTML = `<div class="be-install-empty">${escapeHtml(t('mods.loadError'))}</div>`;
    }
  } finally {
    if (token === beInstallToken) beInstallLoading = false;
  }
}

function pickBeInstallProject(projectId: string): void {
  if (!projectId) return;
  // versions-модалка поверх; editingBuildId уже задан → установка в текущую сборку
  openModalVersionsForDownload(projectId);
}

async function runBeScanInstance(): Promise<void> {
  if (!editingBuildId) {
    window.alert(t('be.importNeedSave'));
    return;
  }
  if (!api?.scanInstance) {
    window.alert(t('be.importUnavailable'));
    return;
  }
  const scanId = editingBuildId;
  updateStatus(t('be.scanning'));
  try {
    const result = await api.scanInstance(scanId);
    if (editingBuildId !== scanId) return;
    if (result) applyScannedData(result);
    else renderBeFileListsFromBuild();
    updateStatus(t('be.scanDone'));
  } catch (err) {
    console.error('Scan failed:', err);
    if (editingBuildId === scanId) renderBeFileListsFromBuild();
    updateStatus(t('be.scanFailed'));
  }
}

async function runBeImportFiles(listId: string, sourcePaths?: string[]): Promise<void> {
  const sub = LIST_ID_TO_INSTANCE_SUB[listId];
  if (!sub) return;
  if (!editingBuildId) {
    window.alert(t('be.importNeedSave'));
    return;
  }
  if (!api?.importInstanceFiles) {
    console.error('[be-import] importInstanceFiles unavailable in preload');
    window.alert(t('be.importUnavailable'));
    return;
  }
  const fromDrop = Array.isArray(sourcePaths) && sourcePaths.length > 0;
  updateStatus(fromDrop ? t('be.importing') : t('be.importPicking'));
  try {
    const result = await api.importInstanceFiles(
      editingBuildId,
      sub,
      fromDrop ? sourcePaths : undefined,
    );
    if (!result || result.canceled) return;
    if (!result.success) {
      console.error('[be-import] failed', result.error);
      updateStatus(t('be.importFailed'));
      window.alert(t('be.importFailed'));
      return;
    }
    updateStatus(t('be.importDone', { n: String(result.count ?? result.imported?.length ?? 0) }));
    await autoScanBuildInstance();
  } catch (err) {
    console.error('[be-import] error', err);
    updateStatus(t('be.importFailed'));
    window.alert(t('be.importFailed'));
  }
}

/** Приём модов/паков с диска в списки управления сборкой. */
function setupBeFileListOsDrop(): void {
  const panelToList: Record<string, string> = {
    mods: 'be-mods-list',
    resourcepacks: 'be-rp-list',
    shaders: 'be-shaders-list',
    datapacks: 'be-dp-list',
  };

  const bindDropTarget = (el: HTMLElement, listId: string) => {
    if ((el as HTMLElement & { _beOsDropBound?: boolean })._beOsDropBound) return;
    (el as HTMLElement & { _beOsDropBound?: boolean })._beOsDropBound = true;
    let depth = 0;
    el.addEventListener('dragenter', (e) => {
      if (!isOsFileDrag((e as DragEvent).dataTransfer)) return;
      e.preventDefault();
      depth += 1;
      el.classList.add('be-file-list--drop');
    });
    el.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) el.classList.remove('be-file-list--drop');
    });
    el.addEventListener('dragover', (e) => {
      if (!isOsFileDrag((e as DragEvent).dataTransfer)) return;
      e.preventDefault();
      const dt = (e as DragEvent).dataTransfer;
      if (dt) dt.dropEffect = 'copy';
    });
    el.addEventListener('drop', (e) => {
      depth = 0;
      el.classList.remove('be-file-list--drop');
      if (!isOsFileDrag((e as DragEvent).dataTransfer)) return;
      e.preventDefault();
      e.stopPropagation();
      const paths = extractDroppedFilePaths((e as DragEvent).dataTransfer, listId);
      if (!paths.length) return;
      void runBeImportFiles(listId, paths);
    });
  };

  Object.keys(LIST_ID_TO_INSTANCE_SUB).forEach((listId) => {
    const list = document.getElementById(listId);
    if (list) bindDropTarget(list, listId);
  });

  document.querySelectorAll<HTMLElement>('#modal-build .be-panel[data-be-panel]').forEach((panel) => {
    const key = panel.getAttribute('data-be-panel') || '';
    const listId = panelToList[key];
    if (!listId) return;
    bindDropTarget(panel, listId);
  });
}

// Прямые слушатели — надёжнее делегирования с :not() по SVG внутри кнопок
document.querySelectorAll<HTMLElement>('#modal-build .be-scan-btn').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    void runBeScanInstance();
  });
});
Object.keys(BE_ADD_BTN_TO_LIST).forEach((btnId) => {
  document.getElementById(btnId)?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    void openBeInstallModal(BE_ADD_BTN_TO_LIST[btnId]);
  });
});
setupBeFileListOsDrop();

document.getElementById('be-install-close')?.addEventListener('click', () => closeModal('modal-be-install'));
document.getElementById('be-install-cancel')?.addEventListener('click', () => closeModal('modal-be-install'));
document.getElementById('modal-be-install')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeModal('modal-be-install');
});
document.getElementById('be-install-local-btn')?.addEventListener('click', () => {
  closeModal('modal-be-install');
  void runBeImportFiles(beInstallListId);
});
document.getElementById('be-install-view-toggle')?.addEventListener('click', () => {
  setModsViewMode(getModsViewMode() === 'cards' ? 'list' : 'cards');
  applyBeInstallViewModeUi();
  renderBeInstallGrid(false);
});
document.getElementById('be-install-source-select')?.addEventListener('change', (e) => {
  const v = (e.target as HTMLSelectElement).value as 'both' | 'modrinth' | 'curseforge';
  beInstallSource = v === 'modrinth' || v === 'curseforge' ? v : 'both';
  void searchBeInstallCatalog(beInstallQuery, false);
});
document.getElementById('be-install-sort-select')?.addEventListener('change', (e) => {
  beInstallSort = (e.target as HTMLSelectElement).value || 'relevance';
  void searchBeInstallCatalog(beInstallQuery, false);
});
document.getElementById('be-install-search')?.addEventListener('input', (e) => {
  const q = (e.target as HTMLInputElement).value || '';
  if (beInstallSearchTimer) clearTimeout(beInstallSearchTimer);
  beInstallSearchTimer = setTimeout(() => {
    void searchBeInstallCatalog(q.trim(), false);
  }, 280);
});
document.getElementById('be-install-search')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (beInstallSearchTimer) clearTimeout(beInstallSearchTimer);
    const q = (e.target as HTMLInputElement).value || '';
    void searchBeInstallCatalog(q.trim(), false);
  }
});
document.getElementById('be-install-grid')?.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const pick = target.closest('[data-be-install-pick]') as HTMLElement | null;
  if (pick) {
    e.preventDefault();
    e.stopPropagation();
    pickBeInstallProject(pick.getAttribute('data-be-install-pick') || '');
    return;
  }
  const details = target.closest('[data-be-install-details]') as HTMLElement | null;
  if (details) {
    e.preventDefault();
    e.stopPropagation();
    const id = details.getAttribute('data-be-install-details') || '';
    if (id) void openModalDetails(id);
    return;
  }
  if (target.closest('#be-install-more')) {
    e.preventDefault();
    void searchBeInstallCatalog(beInstallQuery, true);
  }
});

document.getElementById('be-install-scroll')?.addEventListener('scroll', () => {
  const scrollEl = document.getElementById('be-install-scroll');
  if (!scrollEl || beInstallLoading) return;
  if (beInstallOffset >= beInstallTotal) return;
  if (scrollEl.scrollTop + scrollEl.clientHeight >= scrollEl.scrollHeight - 80) {
    void searchBeInstallCatalog(beInstallQuery, true);
  }
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
  updateBeLoaderTabsVisibility();
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

function beginServerLaunch(ip: string, port: number, name?: string): void {
  const parsed = endpointFromAddress(ip, port);
  const host = parsed.host;
  const usePort = parsed.port;
  const cat = catalogByEndpoint(host, usePort);
  if (cat && srvServerHasPack(cat)) {
    const packs = srvPackBuilds(cat);
    if (packs.length === 0) {
      openServerInfo(srvAddr(cat));
      return;
    }
    openServerLaunchPicker(host, usePort, name || cat.name, packs);
    return;
  }
  openServerLaunchPicker(host, usePort, name);
}

function openServerLaunchPicker(ip: string, port: number, name?: string, only?: Build[]): void {
  const [host] = ip.split(':');
  const usePort = parseInt(String(port), 10) > 0 ? parseInt(String(port), 10) : 25565;
  pendingServerBuild = { ip: host, port: usePort, name: name || undefined };
  const list = document.getElementById('server-build-list');
  if (!list) return;
  const builds = only || savedBuilds;
  const sub = document.getElementById('server-build-sub');
  if (sub) sub.textContent = only ? t('servers.packOnlySub') : t('servers.pickBuildSub');
  if (builds.length === 0) {
    const emptyKey = only ? 'servers.packNeedDownload' : 'servers.noBuildsForLaunch';
    list.innerHTML = '<div style="padding:16px;text-align:center;color:rgba(255,255,255,0.3);">' + t(emptyKey) + '</div>';
  } else {
    list.innerHTML = builds.map(b => {
      const iconSrc = b.icon ? buildIconSrc(b.icon) : DEFAULT_BUILD_ICON_SRC;
      return `<div class="build-option-item" data-build-id="${srvEsc(b.id)}">
        <div class="build-option-icon" style="background:transparent"><img src="${iconSrc}" style="width:100%;height:100%;object-fit:cover;"></div>
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
  if (builds.length === 1) {
    list.querySelector('.build-option-item')?.classList.add('selected');
    if (confirmBtn) confirmBtn.disabled = false;
  }
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
document.getElementById('modal-versions-close')?.addEventListener('click', () => {
  closeVersionsDropdown(false);
  closeModal('modal-versions');
});
document.getElementById('modal-versions-cancel')?.addEventListener('click', () => {
  closeVersionsDropdown(false);
  closeModal('modal-versions');
});
document.getElementById('modal-versions')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) {
    closeVersionsDropdown(false);
    closeModal('modal-versions');
  }
});


// News details
document.getElementById('modal-news-close')?.addEventListener('click', () => closeModal('modal-news-details'));
document.getElementById('modal-news-close2')?.addEventListener('click', () => closeModal('modal-news-details'));
document.getElementById('modal-news-details')?.addEventListener('click', (e) => { if (e.target === e.currentTarget) closeModal('modal-news-details'); });

// Mod details
document.getElementById('modal-mod-close')?.addEventListener('click', () => closeModal('modal-mod-details'));
document.getElementById('modal-mod-close2')?.addEventListener('click', () => closeModal('modal-mod-details'));
document.getElementById('modal-mod-details')?.addEventListener('click', (e) => { if (e.target === e.currentTarget) closeModal('modal-mod-details'); });
document.getElementById('modal-mod-tabs')?.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement | null)?.closest?.('[data-mod-tab]') as HTMLElement | null;
  if (!btn || btn.hidden) return;
  const tab = btn.getAttribute('data-mod-tab');
  if (tab === 'desc' || tab === 'shots') setModDetailsTab(tab);
});
// Каталог → агент: кнопка в футере модалки деталей мода
document.getElementById('modal-mod-ask-agent')?.addEventListener('click', () => {
  const title = document.getElementById('modal-mod-title')?.textContent?.trim() || detailsProjectId || '';
  if (!detailsProjectId) return;
  closeModal('modal-mod-details');
  askAgentAboutMod(getAiUiHost(), title, detailsProjectId);
});

// Import
document.getElementById('import-external-launchers')?.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const allBtn = target.closest<HTMLElement>('[data-import-all]');
  if (allBtn) {
    const id = allBtn.getAttribute('data-import-all') || '';
    const ids = (cachedExternalLaunchers?.find((launcher) => launcher.id === id)?.instances || []).map((inst) => inst.id);
    closeModal('modal-import');
    void importExternalSelection(id, ids);
    return;
  }
  const one = target.closest<HTMLElement>('[data-import-one]');
  if (one) {
    const launcherId = one.getAttribute('data-import-one') || '';
    const instanceId = one.getAttribute('data-instance') || '';
    closeModal('modal-import');
    void importExternalSelection(launcherId, instanceId ? [instanceId] : []);
    return;
  }
  const launcherBtn = target.closest<HTMLElement>('[data-import-launcher]');
  if (!launcherBtn) return;
  const id = launcherBtn.getAttribute('data-import-launcher') || '';
  const panel = document.querySelector<HTMLElement>('#import-external-launchers .import-ext-panel');
  const buttons = document.querySelectorAll<HTMLElement>('#import-external-launchers .import-ext-launcher');
  const wasOpen = launcherBtn.classList.contains('is-on');
  buttons.forEach((btn) => btn.classList.remove('is-on'));
  if (!panel || wasOpen) {
    if (panel) {
      panel.classList.add('hidden');
      panel.innerHTML = '';
    }
    return;
  }
  const launcher = (cachedExternalLaunchers || []).find((item) => item.id === id);
  launcherBtn.classList.add('is-on');
  panel.classList.remove('hidden');
  panel.innerHTML = launcher ? externalLauncherSectionsHtml([launcher]) : '';
});

document.getElementById('modal-import-close')?.addEventListener('click', () => closeModal('modal-import'));
document.getElementById('modal-import-cancel')?.addEventListener('click', () => closeModal('modal-import'));
document.getElementById('modal-import')?.addEventListener('click', (e) => { if (e.target === e.currentTarget) closeModal('modal-import'); });

// ===== AI-агент (AgentChatUI + MCP tools + контекст сборки) =====

type AiToolTrace = {
  id: string;
  name: string;
  arg: string;
  status: 'running' | 'done' | 'error';
  argsText?: string;
  resultText?: string;
};
type AiToolCall = { id: string; type?: string; function: { name: string; arguments: string } };
type AiWireMessage =
  | {
      role: 'user';
      content: string;
      /** Служебная подсказка для модели. В ленте не показывается. */
      hint?: string;
    }
  | {
      role: 'assistant';
      content: string | null;
      tool_calls?: AiToolCall[];
      workedMs?: number;
      /** Снимок шагов для UI. В запрос модели не уходит. */
      toolTrace?: AiToolTrace[];
    }
  | { role: 'tool'; tool_call_id: string; content: string };

type AiFolder = {
  id: string;
  name: string;
};

type AiModCard = {
  id: string;
  slug?: string;
  title: string;
  description?: string;
  iconUrl?: string | null;
  downloads?: number;
  updatedAt?: string | null;
};

type AiSession = {
  id: string;
  title: string;
  updatedAt: number;
  messages: AiWireMessage[];
  buildId?: string | null;
  /** null / пусто — чат в группе «Без папки» */
  folderId?: string | null;
  source?: 'telegram';
};

const AI_STORE_KEY = 'Undefined Client-ai-sessions';
/** Жёсткий потолок раундов. Раньше лимита ход закрывается ответом, а не обрывом. */
const AI_MAX_TOOL_ROUNDS = 16;
const AI_WRAP_AT = 12;
/** Бюджет контекста агента (токены) */
const AI_CONTEXT_BUDGET_TOKENS = 65_000;
/** Порог, после которого запускаем компакт истории */
const AI_CONTEXT_COMPACT_AT = 0.88;
const AI_CONTEXT_KEEP_RECENT = 6;

const AI_TOOL_LABELS: Record<string, string> = {
  list_builds: 'Список сборок',
  get_build: 'Детали сборки',
  select_build: 'Переключение сборки',
  get_instance_path: 'Путь инстанса',
  create_build: 'Создание сборки',
  update_build: 'Обновление сборки',
  delete_build: 'Удаление сборки',
  duplicate_build: 'Дублирование сборки',
  list_java: 'Проверка Java',
  list_mc_versions: 'Версии Minecraft',
  list_loader_versions: 'Версии loader',
  search_mods: 'Поиск модов',
  search_modpacks: 'Поиск модпаков',
  search_resourcepacks: 'Поиск ресурспаков',
  search_shaders: 'Поиск шейдеров',
  get_mod: 'Карточка проекта',
  list_build_mods: 'Моды сборки',
  find_mod_in_build: 'Проверка мода в сборке',
  list_build_content: 'Содержимое сборки',
  toggle_mod: 'Переключение мода',
  remove_build_file: 'Удаление файла',
  get_crash_report: 'Crash-лог',
  get_latest_log: 'Игровой лог',
  clear_logs: 'Очистка логов',
  open_build_folder: 'Папка сборки',
  open_build_subfolder: 'Папка инстанса',
  open_launcher_data_folder: 'Данные лаунчера',
  ensure_instance_dirs: 'Папки инстанса',
  install_mod: 'Установка мода',
  launch_build: 'Запуск сборки',
  game_status: 'Статус игры',
  set_build_memory: 'Память сборки',
  set_java_for_build: 'Java сборки',
  install_java: 'Установка Java',
  remove_java: 'Удаление Java',
  set_jvm_args: 'Аргументы JVM',
  recommend_java_for_build: 'Рекомендация Java',
  list_worlds: 'Список миров',
  delete_world: 'Удаление мира',
  list_screenshots: 'Скриншоты',
  delete_screenshot: 'Удаление скриншота',
  list_configs: 'Конфиги',
  list_accounts: 'Аккаунты',
  list_servers: 'Серверы',
  get_launcher_info: 'Сводка лаунчера',
  web_search: 'Инструмент поиска',
  fetch_url: 'Чтение страницы',
  list_hosted_servers: 'Свои серверы',
  create_hosted_server: 'Создание сервера',
  update_hosted_server: 'Настройки сервера',
  install_hosted_core: 'Ядро сервера',
  start_hosted_server: 'Запуск сервера',
  restart_hosted_server: 'Перезапуск сервера',
  stop_hosted_server: 'Остановка сервера',
  hosted_command: 'Команда сервера',
  hosted_log: 'Консоль сервера',
  list_hosted_plugins: 'Плагины сервера',
  install_hosted_plugin: 'Установка плагина',
  toggle_hosted_plugin: 'Плагин сервера',
  list_hosted_files: 'Файлы сервера',
  read_hosted_file: 'Чтение конфига',
  write_hosted_file: 'Запись конфига',
  list_hosted_core_versions: 'Версии ядра',
};

let aiSessions: AiSession[] = [];
let aiFolders: AiFolder[] = [];
let aiActiveId = '';
/** Свёрнутые папки сайдбара — только на время сессии окна */
const aiFolderCollapsed = new Set<string>();
let aiBusy = false;
let aiBusySessionId: string | null = null;
let aiInited = false;
let aiConfigured: boolean | null = null;
let aiAccessOk: boolean | null = null;
let aiSearchQuery = '';
/** Поколение стрима — сбрасывается при смене чата / очистке */
let aiStreamGen = 0;
/** Запрос остановки текущего хода агента */
let aiStopRequested = false;
/** Активный контейнер раунда (план + tools) */
let aiActiveRound: HTMLElement | null = null;
/** Ключ дня для разделителя в ленте */
let aiLastDividerDay = '';

const AI_ENABLED_LS_KEY = 'Undefined Client-ai-enabled';

function isAiFeatureEnabled(): boolean {
  // По умолчанию включено
  return localStorage.getItem(AI_ENABLED_LS_KEY) !== 'false';
}

function applyAiTabVisibility(): void {
  const enabled = isAiFeatureEnabled();
  document.querySelectorAll<HTMLElement>('.tab-btn[data-tab="ai"]').forEach((el) => {
    el.style.display = enabled ? '' : 'none';
  });
  if (!enabled && presenceTab === 'ai') switchTab('home');
}

function showAiAccessDeniedModal(): void {
  openModal('modal-ai-access');
}

/** Закрыть модалку доступа и открыть DM с ботом для заявки на UAgent. */
function openUagentApplyFromModal(): void {
  closeModal('modal-ai-access');
  if (isOfflineAccount()) {
    showMessengerOfflineModal();
    return;
  }
  switchTab('messenger');
  void openAssistantBotDm().then((ok) => {
    if (!ok) void ensureMessengerTab(true);
  });
}

function showMessengerOfflineModal(): void {
  openModal('modal-msgr-offline');
}

function showSkinsOfflineModal(): void {
  openModal('modal-skins-offline');
}

/** Чаты и скины скрыты для офлайн-аккаунта (нет уникальных auth-данных). */
function applyOnlineOnlyTabsVisibility(): void {
  const online = !isOfflineAccount();
  document.querySelectorAll<HTMLElement>('.tab-btn[data-tab="messenger"]').forEach((el) => {
    el.style.display = online ? '' : 'none';
  });
  document.querySelectorAll<HTMLElement>('.tab-btn[data-tab="skins"]').forEach((el) => {
    el.style.display = online ? '' : 'none';
  });
  if (!online && (presenceTab === 'messenger' || presenceTab === 'skins')) {
    switchTab('home');
  }
}

function isAiAccessDeniedResult(result: { error?: string; code?: string; reason?: string } | null | undefined): boolean {
  if (!result) return false;
  const code = String(result.code || result.reason || result.error || '').toLowerCase();
  return (
    code.includes('access_denied') ||
    code === 'missing_key' ||
    code === 'missing_auth' ||
    code === 'auth_unavailable'
  );
}

/** Человекочитаемое описание ошибки AI для чата. */
function formatAiChatError(result: { error?: any; code?: string; reason?: string } | null | undefined): string {
  const code = String(result?.code || result?.reason || '').toLowerCase();
  if (
    code === 'insufficient_balance' ||
    code === 'insufficient_quota' ||
    code === 'provider_unavailable' ||
    code === 'upstream_error'
  ) {
    return t('ai.error.providerOutage');
  }
  let raw = result?.error;
  if (raw && typeof raw === 'object') {
    raw = (raw as any).message || JSON.stringify(raw);
  }
  const text = String(raw || 'unknown');
  if (
    /insufficient\s*balance|insufficient\s*funds|недостаточно средств|технические сбои|provider_unavailable/i.test(
      text,
    )
  ) {
    return t('ai.error.providerOutage');
  }
  // Старый формат прокси: "400 {\"error\":{...}}"
  const jsonMatch = text.match(/\d{3}\s+(\{[\s\S]*\})\s*$/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      const msg = String(parsed?.error?.message || parsed?.message || '').trim();
      if (/insufficient\s*balance|insufficient\s*funds/i.test(msg)) {
        return t('ai.error.providerOutage');
      }
      if (msg) return msg;
    } catch {
      /* ignore */
    }
  }
  return text;
}

function handleAiAccessDenied(): void {
  aiAccessOk = false;
  showAiAccessDeniedModal();
}

async function refreshAiAccessStatus(): Promise<void> {
  if (!isAiFeatureEnabled()) {
    aiConfigured = false;
    aiAccessOk = false;
    return;
  }
  try {
    const status = await api?.aiStatus?.();
    aiConfigured = status?.configured !== false;
    aiAccessOk = Boolean(status?.access);
  } catch {
    aiConfigured = false;
    aiAccessOk = false;
  }
}

const AI_WRITE_TOOLS = new Set([
  'create_build',
  'update_build',
  'delete_build',
  'duplicate_build',
  'toggle_mod',
  'remove_build_file',
  'install_mod',
  'open_build_folder',
  'open_build_subfolder',
  'open_launcher_data_folder',
  'ensure_instance_dirs',
  'clear_logs',
  'delete_world',
  'delete_screenshot',
  'launch_build',
  'install_java',
  'remove_java',
  'set_build_memory',
  'set_jvm_args',
  'set_build_window',
  'write_config',
  'write_options',
  'set_options_value',
  'import_modpack',
  'backup_build',
  'create_instance_share',
  'import_instance_share',
  'install_mod_bulk',
  'update_outdated_mods',
  'add_server',
  'remove_server',
  'edit_server',
  'switch_account',
  'open_console',
  'launch_updater',
  'disable_all_mods',
  'enable_all_mods',
  'copy_mods_to_build',
  'open_modrinth_project',
  'clear_instance_cache',
  'set_java_for_build',
  'rename_build',
  'create_hosted_server',
  'update_hosted_server',
  'install_hosted_core',
  'start_hosted_server',
  'restart_hosted_server',
  'stop_hosted_server',
  'hosted_command',
  'install_hosted_plugin',
  'toggle_hosted_plugin',
  'write_hosted_file',
]);

function escapeAiHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function aiUid(): string {
  return `ai_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function loadAiSessions(): void {
  try {
    const raw = localStorage.getItem(AI_STORE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed?.sessions)) {
      aiSessions = parsed.sessions;
      aiActiveId = String(parsed.activeId || aiSessions[0]?.id || '');
    }
    aiFolders = Array.isArray(parsed?.folders)
      ? parsed.folders
          .filter((f: AiFolder) => f && typeof f.id === 'string' && typeof f.name === 'string')
          .slice(0, 40)
      : [];
  } catch {
    aiSessions = [];
    aiFolders = [];
    aiActiveId = '';
  }
  if (!aiSessions.length) {
    const created = createAiSession(false);
    aiActiveId = created.id;
  } else if (!aiSessions.some((s) => s.id === aiActiveId)) {
    aiActiveId = aiSessions[0].id;
  }
}

function saveAiSessions(): void {
  try {
    localStorage.setItem(
      AI_STORE_KEY,
      JSON.stringify({
        activeId: aiActiveId,
        sessions: aiSessions.slice(0, 40),
        folders: aiFolders.slice(0, 40),
      }),
    );
  } catch {
    /* quota */
  }
}

function activeAiSession(): AiSession | null {
  return aiSessions.find((s) => s.id === aiActiveId) || null;
}

function createAiSession(
  persist = true,
  opts?: { buildId?: string | null; title?: string; folderId?: string | null; source?: 'telegram' },
): AiSession {
  const lastId = localStorage.getItem('Undefined Client-last-build') || '';
  const fallback = savedBuilds.find((b) => b.id === lastId) || savedBuilds[0];
  const session: AiSession = {
    id: aiUid(),
    title: opts?.title || t('ai.newChatTitle'),
    updatedAt: Date.now(),
    messages: [],
    buildId: opts?.buildId !== undefined ? opts.buildId : fallback?.id || null,
    folderId: opts?.folderId || null,
    source: opts?.source,
  };
  aiSessions.unshift(session);
  aiActiveId = session.id;
  if (persist) saveAiSessions();
  return session;
}

function formatAiRelative(ts: number): string {
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (sec < 60) return `${Math.max(1, sec)}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

function titleFromPrompt(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return t('ai.newChatTitle');
  return clean.length > 34 ? `${clean.slice(0, 34)}…` : clean;
}

function formatAiDownloads(n?: number): string {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (v >= 1000) return `${Math.round(v / 1000)}K`;
  return String(v);
}

function formatAiDate(raw?: string | null): string {
  if (!raw) return '—';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

function sessionBuild(session: AiSession | null): Build | null {
  if (!session?.buildId) return null;
  return savedBuilds.find((b) => b.id === session.buildId) || null;
}

function aiContextPayload(session: AiSession | null): {
  buildId?: string;
  buildName?: string;
  gameVersion?: string;
  loader?: string;
  javaPath?: string | null;
  javaMode?: 'pinned' | 'auto' | 'missing';
} | null {
  const build = sessionBuild(session);
  if (!build) return null;
  const pinned = String(build.javaPath || '').trim();
  const javaMode: 'pinned' | 'auto' | 'missing' = pinned ? 'pinned' : 'auto';
  return {
    buildId: build.id,
    buildName: build.name,
    gameVersion: build.gameVersion || (build as any).version || undefined,
    loader: build.loader || 'vanilla',
    javaPath: pinned || null,
    javaMode,
  };
}

type AiContextBucket = {
  id: string;
  label: string;
  hint: string;
  tokens: number;
  color: string;
};

function charsToTokens(chars: number): number {
  return Math.max(0, Math.ceil(chars / 4));
}

function estimateAiContextBreakdown(session: AiSession | null): {
  buckets: AiContextBucket[];
  total: number;
  budget: number;
  usage: number;
} {
  const budget = AI_CONTEXT_BUDGET_TOKENS;

  // Системный preamble агента (оценка)
  const systemTokens = 280;
  // Схемы MCP tools (brief) — уходят в каждый запрос
  const mcpTokens = 1_800;
  const build = sessionBuild(session);
  const buildTokens = build
    ? charsToTokens(`build:${build.id}:${build.name}:${build.gameVersion}:${build.loader}`.length) + 40
    : 0;

  let conversationChars = 0;
  if (session) {
    for (const m of session.messages) {
      conversationChars += String((m as any).content || '').length;
      if ((m as any).tool_calls) conversationChars += JSON.stringify((m as any).tool_calls).length;
    }
  }
  const conversationTokens = charsToTokens(conversationChars);

  const buckets: AiContextBucket[] = [
    {
      id: 'system',
      label: t('ai.ctx.system'),
      hint: t('ai.ctx.systemHint'),
      tokens: systemTokens,
      color: 'rgba(255,255,255,0.35)',
    },
    {
      id: 'mcp',
      label: t('ai.ctx.mcp'),
      hint: t('ai.ctx.mcpHint'),
      tokens: mcpTokens,
      color: 'var(--accent)',
    },
    {
      id: 'build',
      label: t('ai.ctx.build'),
      hint: build ? build.name : t('ai.noBuild'),
      tokens: buildTokens,
      color: '#7dd3a7',
    },
    {
      id: 'conversation',
      label: t('ai.ctx.conversation'),
      hint: t('ai.ctx.conversationHint'),
      tokens: conversationTokens,
      color: '#e2b86b',
    },
  ].filter((b) => b.tokens > 0 || b.id === 'conversation' || b.id === 'mcp' || b.id === 'system');

  const total = buckets.reduce((s, b) => s + b.tokens, 0);
  return {
    buckets,
    total,
    budget,
    usage: Math.min(1, total / budget),
  };
}

function estimateAiContextUsage(session: AiSession | null): number {
  return estimateAiContextBreakdown(session).usage;
}

function formatAiTokens(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    const text = (n >= 10_000 ? k.toFixed(0) : k.toFixed(1)).replace(/\.0$/, '');
    return `${text}K`;
  }
  return String(n);
}

function updateAiContextRing(session: AiSession | null): void {
  const ring = document.getElementById('ai-context-ring-value') as SVGCircleElement | null;
  const wrap = document.getElementById('ai-context-ring');
  if (!ring) return;
  const { usage, total, budget } = estimateAiContextBreakdown(session);
  const C = 2 * Math.PI * 6;
  ring.style.strokeDasharray = String(C);
  ring.style.strokeDashoffset = String(C * (1 - usage));
  if (wrap) {
    wrap.title = `${t('ai.contextUsage')}: ${Math.round(usage * 100)}% · ${formatAiTokens(total)} / ${formatAiTokens(budget)}`;
  }
  // Если меню открыто — обновляем разбивку на лету
  const menu = document.getElementById('ai-context-menu');
  if (menu?.classList.contains('is-open')) renderAiContextMenu();
}

function renderAiContextMenu(): void {
  const menu = document.getElementById('ai-context-menu');
  if (!menu) return;
  const session = activeAiSession();
  const { buckets, total, budget, usage } = estimateAiContextBreakdown(session);
  const pct = Math.round(usage * 100);
  const free = Math.max(0, budget - total);

  // Доли относительно бюджета 256K — в баре виден и запас
  const barUsed = buckets
    .map((b) => {
      const w = Math.max(b.tokens > 0 ? 0.4 : 0, (b.tokens / budget) * 100);
      return `<span class="ai-context-menu__bar-seg" style="width:${w}%;background:${b.color}" title="${escapeAiHtml(b.label)}: ${formatAiTokens(b.tokens)}"></span>`;
    })
    .join('');
  const barFree = `<span class="ai-context-menu__bar-seg ai-context-menu__bar-seg--free" style="width:${(free / budget) * 100}%" title="${escapeAiHtml(t('ai.ctx.free'))}: ${formatAiTokens(free)}"></span>`;

  const rows = [
    ...buckets.map(
      (b) => `
      <div class="ai-context-menu__row">
        <span class="ai-context-menu__dot" style="background:${b.color}"></span>
        <span class="ai-context-menu__name">
          ${escapeAiHtml(b.label)}
          <span class="ai-context-menu__hint">${escapeAiHtml(b.hint)}</span>
        </span>
        <span class="ai-context-menu__tokens">${escapeAiHtml(formatAiTokens(b.tokens))}</span>
      </div>`,
    ),
    `<div class="ai-context-menu__row">
      <span class="ai-context-menu__dot ai-context-menu__dot--free"></span>
      <span class="ai-context-menu__name">
        ${escapeAiHtml(t('ai.ctx.free'))}
        <span class="ai-context-menu__hint">${escapeAiHtml(t('ai.ctx.freeHint'))}</span>
      </span>
      <span class="ai-context-menu__tokens">${escapeAiHtml(formatAiTokens(free))}</span>
    </div>`,
  ].join('');

  menu.innerHTML = `
    <div class="ai-context-menu__head">
      <div class="ai-context-menu__title">${escapeAiHtml(t('ai.contextUsage'))}</div>
      <div class="ai-context-menu__pct">${pct}% · ${escapeAiHtml(formatAiTokens(total))} / ${escapeAiHtml(formatAiTokens(budget))}</div>
    </div>
    <div class="ai-context-menu__bar">${barUsed}${barFree}</div>
    <div class="ai-context-menu__list">${rows}</div>
    <div class="ai-context-menu__foot">${escapeAiHtml(t('ai.ctx.foot'))}</div>
  `;
}

function setAiContextMenuOpen(open: boolean): void {
  const menu = document.getElementById('ai-context-menu');
  const ring = document.getElementById('ai-context-ring');
  if (!menu || !ring) return;
  if (open) {
    renderAiContextMenu();
    menu.classList.remove('hidden');
    placeAiFloating(menu, ring, 'up');
    requestAnimationFrame(() => {
      menu.classList.add('is-open');
      placeAiFloating(menu, ring, 'up');
    });
    ring.setAttribute('aria-expanded', 'true');
  } else if (menu.classList.contains('is-open') || !menu.classList.contains('hidden')) {
    menu.classList.remove('is-open');
    ring.setAttribute('aria-expanded', 'false');
    window.setTimeout(() => {
      if (!menu.classList.contains('is-open')) menu.classList.add('hidden');
    }, 160);
  }
}

function setAiChatMenuOpen(open: boolean): void {
  const menu = document.getElementById('ai-chat-menu-pop');
  const btn = document.getElementById('ai-chat-menu');
  if (!menu || !btn) return;
  if (open) {
    renderAiMoveMenu();
    menu.classList.remove('hidden');
    const anchor = btn;
    placeAiFloating(menu, anchor, 'down');
    requestAnimationFrame(() => {
      menu.classList.add('is-open');
      placeAiFloating(menu, anchor, 'down');
    });
    btn.setAttribute('aria-expanded', 'true');
  } else if (menu.classList.contains('is-open') || !menu.classList.contains('hidden')) {
    menu.classList.remove('is-open');
    btn.setAttribute('aria-expanded', 'false');
    window.setTimeout(() => {
      if (!menu.classList.contains('is-open')) menu.classList.add('hidden');
    }, 160);
  }
}

function setAiBuildMenuOpen(open: boolean): void {
  const menu = document.getElementById('ai-build-menu');
  const btn = document.getElementById('ai-build-btn');
  if (!menu || !btn) return;
  if (open) {
    renderAiBuildMenu();
    menu.classList.remove('hidden');
    placeAiFloating(menu, btn, 'up');
    requestAnimationFrame(() => {
      menu.classList.add('is-open');
      placeAiFloating(menu, btn, 'up');
    });
    btn.setAttribute('aria-expanded', 'true');
  } else if (menu.classList.contains('is-open') || !menu.classList.contains('hidden')) {
    menu.classList.remove('is-open');
    btn.setAttribute('aria-expanded', 'false');
    window.setTimeout(() => {
      if (!menu.classList.contains('is-open')) menu.classList.add('hidden');
    }, 180);
  }
}

function closeAiPopovers(except?: string): void {
  if (except !== 'ai-build-menu') setAiBuildMenuOpen(false);
  if (except !== 'ai-context-menu') setAiContextMenuOpen(false);
  if (except !== 'ai-attach-menu') closeAiAttachMenu();
  if (except !== 'ai-chat-menu-pop') setAiChatMenuOpen(false);
  if (except !== 'ai-model-menu') setAiModelMenuOpen(false);
  if (except !== 'ai-suggest') closeAiSuggest();
}

const AI_MODEL_KEY = 'Undefined Client-ai-model';

function currentAiModel(): 'pixi-1.0' | 'pixi-1.5' | 'custom' {
  const saved = localStorage.getItem(AI_MODEL_KEY);
  if (saved === 'pixi-1.5') return 'pixi-1.5';
  // Своя модель в настройках скрыта, пока от неё отказались.
  return 'pixi-1.0';
}

function usingCustomAi(): boolean {
  return currentAiModel() === 'custom';
}

function syncAiModelButton(): void {
  const btn = document.getElementById('ai-agent-ver');
  if (!btn) return;
  const id = currentAiModel();
  const customName = localStorage.getItem('Undefined Client-ai-custom-label') || 'Своя модель';
  const title = id === 'pixi-1.5' ? 'Pixi 1.5' : id === 'custom' ? customName : 'Pixi 1.0';
  btn.textContent = title;
  btn.title = title;
}

function setCurrentAiModel(id: 'pixi-1.0' | 'pixi-1.5' | 'custom'): void {
  localStorage.setItem(AI_MODEL_KEY, id);
  syncAiModelButton();
}

async function renderAiModelMenu(): Promise<void> {
  const menu = document.getElementById('ai-model-menu');
  if (!menu) return;
  const current = currentAiModel();
  const cards: Array<{ id: 'pixi-1.0' | 'pixi-1.5' | 'custom'; title: string; blurb: string; params: string }> = [
    {
      id: 'pixi-1.0',
      title: 'Pixi 1.0',
      blurb: 'Базовый режим агента лаунчера. В запрос уходит pixi-1.0.',
      params: 'Короче и быстрее',
    },
    {
      id: 'pixi-1.5',
      title: 'Pixi 1.5',
      blurb: 'Более сильный режим того же агента. В запрос уходит pixi-1.5.',
      params: 'Длиннее и точнее',
    },
  ];
  const check = `<svg class="ai-model-menu__check" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.5 8.2 6.4 11.1 12.5 4.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  menu.innerHTML = cards
    .map(
      (card) => `
    <button type="button" class="ai-model-menu__choice${current === card.id ? ' is-on' : ''}" data-model="${card.id}">
      <span class="ai-model-menu__copy">
        <span class="ai-model-menu__name">${escapeAiHtml(card.title)}</span>
        <span class="ai-model-menu__hint">${escapeAiHtml(card.params)}</span>
      </span>
      ${current === card.id ? check : '<span class="ai-model-menu__check"></span>'}
    </button>`,
    )
    .join('');
}

/** Меню на documentElement + fixed, чтобы его не резал overflow колонки и ленты. */
function placeAiFloating(menu: HTMLElement, anchor: HTMLElement, prefer: 'up' | 'down'): void {
  if (menu.parentElement !== document.documentElement) {
    document.documentElement.appendChild(menu);
  }
  const pad = 8;
  const topLimit = 40;
  menu.style.position = 'fixed';
  menu.style.zIndex = '100060';
  menu.style.right = 'auto';
  menu.style.bottom = 'auto';
  menu.style.transform = 'none';
  menu.style.maxHeight = `${Math.max(140, window.innerHeight - topLimit - pad)}px`;
  menu.style.overflowY = 'auto';
  const rect = anchor.getBoundingClientRect();
  const mw = Math.min(Math.max(menu.scrollWidth, 260), window.innerWidth - pad * 2);
  const mh = Math.min(menu.offsetHeight || 160, window.innerHeight - topLimit - pad);
  let left = rect.left;
  if (left + mw > window.innerWidth - pad) left = window.innerWidth - pad - mw;
  left = Math.max(pad, left);
  const above = rect.top - pad - mh;
  const below = rect.bottom + pad;
  let top = prefer === 'up' ? above : below;
  if (prefer === 'up' && top < topLimit) top = below;
  if (prefer === 'down' && top + mh > window.innerHeight - pad) top = Math.max(topLimit, above);
  top = Math.max(topLimit, Math.min(top, window.innerHeight - pad - 48));
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
  menu.style.width = `${Math.round(mw)}px`;
}

/** Меню модели — на documentElement + fixed, чтобы не резалось overflow rail/tab */
function ensureAiModelMenuHost(menu: HTMLElement): void {
  if (menu.parentElement !== document.documentElement) {
    document.documentElement.appendChild(menu);
  }
}

function positionAiModelMenu(): void {
  const menu = document.getElementById('ai-model-menu');
  const btn = document.getElementById('ai-agent-ver');
  if (!menu || !btn || menu.classList.contains('hidden')) return;
  placeAiFloating(menu, btn, 'up');
}

function setAiModelMenuOpen(open: boolean): void {
  const menu = document.getElementById('ai-model-menu');
  const btn = document.getElementById('ai-agent-ver');
  if (!menu || !btn) return;
  if (open) {
    ensureAiModelMenuHost(menu);
    void renderAiModelMenu().then(() => positionAiModelMenu());
    menu.classList.remove('hidden');
    positionAiModelMenu();
    requestAnimationFrame(() => {
      positionAiModelMenu();
      menu.classList.add('is-open');
    });
    btn.setAttribute('aria-expanded', 'true');
  } else if (menu.classList.contains('is-open') || !menu.classList.contains('hidden')) {
    menu.classList.remove('is-open');
    btn.setAttribute('aria-expanded', 'false');
    window.setTimeout(() => {
      if (!menu.classList.contains('is-open')) menu.classList.add('hidden');
    }, 160);
  }
}

function toggleAiModelMenu(): void {
  const menu = document.getElementById('ai-model-menu');
  if (!menu) return;
  const willOpen = !menu.classList.contains('is-open');
  closeAiPopovers(willOpen ? 'ai-model-menu' : undefined);
  setAiModelMenuOpen(willOpen);
}

function toggleAiContextMenu(): void {
  const menu = document.getElementById('ai-context-menu');
  if (!menu) return;
  const willOpen = !menu.classList.contains('is-open');
  closeAiPopovers(willOpen ? 'ai-context-menu' : undefined);
  setAiContextMenuOpen(willOpen);
}

async function compactAiSession(session: AiSession): Promise<boolean> {
  if (session.messages.length <= AI_CONTEXT_KEEP_RECENT + 2) return false;

  // Режем по границе user-сообщения, чтобы не разорвать tool_calls / tool
  let cut = Math.max(1, session.messages.length - AI_CONTEXT_KEEP_RECENT);
  while (cut > 0 && session.messages[cut]?.role !== 'user') cut -= 1;
  if (cut <= 0) return false;

  const older = session.messages.slice(0, cut);
  const keep = session.messages.slice(cut);
  if (!older.length || !keep.length) return false;

  const digest = older
    .map((m) => {
      if (m.role === 'user') return `User: ${String(m.content || '').slice(0, 400)}`;
      if (m.role === 'assistant') return `Assistant: ${String(m.content || '').slice(0, 400)}`;
      if (m.role === 'tool') return `Tool: ${String(m.content || '').slice(0, 180)}`;
      return '';
    })
    .filter(Boolean)
    .join('\n')
    .slice(0, 14000);

  const status = appendAiToolStatus('compact', 'running', { label: t('ai.compacting') });
  const started = Date.now();
  try {
    const result = await api?.aiChat?.({
      model: currentAiModel(),
      tools: false,
      context: aiContextPayload(session),
      messages: [
        {
          role: 'user',
          content: [
            'Сделай компакт (краткое резюме) истории диалога для продолжения работы агента лаунчера.',
            'Сохрани: цель пользователя, выбранную сборку, найденные моды/id, уже выполненные действия, важные факты.',
            'Ответь одним связным текстом без markdown-таблиц, до 1400 символов.',
            '',
            'История:',
            digest,
          ].join('\n'),
        },
      ],
    });
    const summary = String(result?.reply || '').trim();
    if (!summary || result?.error) {
      if (isAiAccessDeniedResult(result)) handleAiAccessDenied();
      setAiToolStatus(status, 'error', Date.now() - started);
      return false;
    }
    session.messages = sanitizeAiWireMessages([
      {
        role: 'assistant',
        content: `${t('ai.compactPrefix')}\n${summary}`,
      },
      ...keep,
    ]);
    session.updatedAt = Date.now();
    saveAiSessions();
    setAiToolStatus(status, 'done', Date.now() - started);
    updateAiContextRing(session);
    return true;
  } catch {
    setAiToolStatus(status, 'error', Date.now() - started);
    return false;
  }
}

async function ensureAiContextCapacity(session: AiSession): Promise<void> {
  let guard = 0;
  let compacted = false;
  while (guard < 3) {
    guard += 1;
    const { usage } = estimateAiContextBreakdown(session);
    if (usage < AI_CONTEXT_COMPACT_AT) break;
    const ok = await compactAiSession(session);
    if (!ok) break;
    compacted = true;
  }
  if (compacted) renderAiConversation();
}

function getAiUiHost(): AiUiHost {
  return {
    t,
    escapeHtml: escapeAiHtml,
    getMessagesRoot: () => document.getElementById('ai-messages'),
    scrollToEnd: scrollAiMessagesToEnd,
    getBuild: (id) => {
      const b = savedBuilds.find((x) => x.id === id) || null;
      if (!b) return null;
      return {
        id: b.id,
        name: b.name,
        gameVersion: b.gameVersion,
        loader: b.loader,
        icon: b.icon,
      };
    },
    openBuildSettings: (buildId) => {
      const b = savedBuilds.find((x) => x.id === buildId);
      if (b) void openModalBuild(b);
    },
    sendPrompt: (text) => {
      void sendAiMessage(text);
    },
    switchToAiTab: () => {
      switchTab('ai');
      ensureAiTab();
    },
  };
}

function refreshAiShellUi(session: AiSession | null): void {
  const host = getAiUiHost();
  const build = sessionBuild(session);
  renderAiContextBar(host, build);
  renderAiQuickChips(host, { buildId: session?.buildId || build?.id || null });
  renderAiContextHints(host, build);
}

function updateAiBuildChip(session: AiSession | null): void {
  const nameEl = document.getElementById('ai-build-name');
  const iconEl = document.querySelector('.ai-build-chip__icon') as HTMLElement | null;
  const build = sessionBuild(session);
  if (nameEl) nameEl.textContent = build?.name || t('ai.noBuild');
  if (iconEl) {
    // Без своей иконки — newBuild.png (цвет iconBg больше не подставляем)
    if (build?.icon) {
      const src = buildIconSrc(build.icon).replace(/\\/g, '/').replace(/"/g, '');
      iconEl.style.backgroundImage = `url("${src}")`;
      iconEl.style.backgroundColor = 'transparent';
    } else if (build) {
      iconEl.style.backgroundImage = `url("${DEFAULT_BUILD_ICON_SRC}")`;
      iconEl.style.backgroundColor = 'transparent';
    } else {
      iconEl.style.backgroundImage = '';
      iconEl.style.backgroundColor = '#666';
    }
  }
  refreshAiShellUi(session);
}

function autoResizeAiInput(): void {
  const input = document.getElementById('ai-input') as HTMLTextAreaElement | null;
  if (!input) return;
  const minH = 24;
  const maxH = 160;
  // Сброс высоты, чтобы scrollHeight отражал реальный объём текста
  input.style.height = `${minH}px`;
  const next = Math.min(Math.max(input.scrollHeight, minH), maxH);
  input.style.height = `${next}px`;
  input.style.overflowY = next >= maxH ? 'auto' : 'hidden';
  syncCustomCaret();
}

/** Подходит ли элемент под кастомный caret */
function isCustomCaretField(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return !el.disabled && !el.readOnly;
  if (!(el instanceof HTMLInputElement)) return false;
  if (el.disabled || el.readOnly) return false;
  const type = (el.getAttribute('type') || el.type || 'text').toLowerCase();
  return ['text', 'password', 'search', 'email', 'url', 'tel', 'number'].includes(type);
}

function ensureUcCaretEl(): HTMLElement {
  let caret = document.getElementById('uc-caret');
  if (!caret) {
    caret = document.createElement('span');
    caret.id = 'uc-caret';
    caret.className = 'uc-caret';
    caret.setAttribute('aria-hidden', 'true');
    caret.hidden = true;
    // Вне body: иначе CSS zoom на body дважды масштабирует position:fixed
    document.documentElement.appendChild(caret);
  } else if (caret.parentElement !== document.documentElement) {
    document.documentElement.appendChild(caret);
  }
  return caret;
}

/** Размер кастомного caret: всегда 2×16 (в локальных CSS px поля) */
const UC_CARET_W = 2;
const UC_CARET_H = 16;

const UC_CARET_MIRROR_PROPS = [
  'boxSizing',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize',
  'lineHeight', 'fontFamily', 'textAlign', 'textTransform', 'textIndent',
  'textDecoration', 'letterSpacing', 'wordSpacing', 'tabSize', 'whiteSpace',
  'wordWrap', 'wordBreak', 'direction',
] as const;

/** Координаты caret в viewport (устойчиво к body zoom / transform предков). */
function getTextFieldCaretViewportPos(
  el: HTMLInputElement | HTMLTextAreaElement,
): { x: number; y: number; w: number; h: number } | null {
  const rect = el.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return null;

  const style = window.getComputedStyle(el);
  const isTextarea = el instanceof HTMLTextAreaElement;
  const pos = el.selectionEnd ?? 0;
  const isPassword = el instanceof HTMLInputElement && el.type === 'password';
  const before = isPassword ? '\u2022'.repeat(pos) : el.value.slice(0, pos);

  const layoutW = el.offsetWidth || rect.width;
  const layoutH = el.offsetHeight || rect.height;
  const scaleX = layoutW > 0 ? rect.width / layoutW : 1;
  const scaleY = layoutH > 0 ? rect.height / layoutH : 1;

  const w = UC_CARET_W * scaleX;
  const h = UC_CARET_H * scaleY;

  // ===== Однострочный input: Y из content-box, X из зеркала =====
  // Flex-зеркало по Y часто врёт (пустой value / line-height:normal),
  // а во время scaleIn модалки «залипает» неверная вертикаль.
  if (!isTextarea) {
    const bt = parseFloat(style.borderTopWidth) || 0;
    const bb = parseFloat(style.borderBottomWidth) || 0;
    const pt = parseFloat(style.paddingTop) || 0;
    const pb = parseFloat(style.paddingBottom) || 0;
    const contentTop = rect.top + (bt + pt) * scaleY;
    const contentBottom = rect.bottom - (bb + pb) * scaleY;
    const contentH = Math.max(0, contentBottom - contentTop);
    const y = contentTop + Math.max(0, (contentH - h) / 2);

    const mirror = document.createElement('div');
    mirror.setAttribute('aria-hidden', 'true');
    for (const prop of UC_CARET_MIRROR_PROPS) {
      mirror.style[prop] = style[prop];
    }
    mirror.style.position = 'fixed';
    mirror.style.left = `${rect.left}px`;
    mirror.style.top = `${rect.top}px`;
    mirror.style.width = `${layoutW}px`;
    mirror.style.height = `${layoutH}px`;
    mirror.style.transform = `scale(${scaleX}, ${scaleY})`;
    mirror.style.transformOrigin = '0 0';
    mirror.style.visibility = 'hidden';
    mirror.style.pointerEvents = 'none';
    mirror.style.overflow = 'hidden';
    mirror.style.zIndex = '-1';
    mirror.style.display = 'flex';
    mirror.style.alignItems = 'center';
    mirror.style.whiteSpace = 'pre';

    const textSpan = document.createElement('span');
    textSpan.style.whiteSpace = 'pre';
    textSpan.style.marginLeft = `${-el.scrollLeft}px`;
    textSpan.textContent = before;
    const marker = document.createElement('span');
    marker.textContent = '\u200b';
    textSpan.appendChild(marker);
    mirror.appendChild(textSpan);

    document.documentElement.appendChild(mirror);
    const mr = marker.getBoundingClientRect();
    mirror.remove();

    return { x: mr.left, y, w, h };
  }

  // ===== Textarea: X/Y из зеркала строки =====
  const mirror = document.createElement('div');
  mirror.setAttribute('aria-hidden', 'true');
  for (const prop of UC_CARET_MIRROR_PROPS) {
    mirror.style[prop] = style[prop];
  }
  mirror.style.position = 'fixed';
  mirror.style.left = `${rect.left}px`;
  mirror.style.top = `${rect.top}px`;
  mirror.style.width = `${layoutW}px`;
  mirror.style.height = `${layoutH}px`;
  mirror.style.transform = `scale(${scaleX}, ${scaleY})`;
  mirror.style.transformOrigin = '0 0';
  mirror.style.visibility = 'hidden';
  mirror.style.pointerEvents = 'none';
  mirror.style.overflow = 'hidden';
  mirror.style.zIndex = '-1';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.overflowWrap = 'break-word';
  mirror.style.wordBreak = style.wordBreak;
  mirror.scrollTop = el.scrollTop;
  mirror.scrollLeft = el.scrollLeft;

  const textSpan = document.createElement('span');
  textSpan.style.whiteSpace = 'pre-wrap';
  textSpan.textContent = before;
  const marker = document.createElement('span');
  marker.textContent = '\u200b';
  textSpan.appendChild(marker);
  mirror.appendChild(textSpan);

  document.documentElement.appendChild(mirror);
  const mr = marker.getBoundingClientRect();
  mirror.remove();

  const y = mr.top + Math.max(0, (mr.height - h) / 2);
  return { x: mr.left, y, w, h };
}

function syncCustomCaret(): void {
  const caret = ensureUcCaretEl();
  const el = document.activeElement;
  if (!isCustomCaretField(el)) {
    caret.hidden = true;
    return;
  }

  let start = 0;
  let end = 0;
  try {
    start = el.selectionStart ?? 0;
    end = el.selectionEnd ?? 0;
  } catch {
    caret.hidden = true;
    return;
  }
  if (start !== end) {
    caret.hidden = true;
    return;
  }

  const pos = getTextFieldCaretViewportPos(el);
  if (!pos) {
    caret.hidden = true;
    return;
  }

  const field = el.getBoundingClientRect();
  // Прячем, если ушло за края поля
  if (
    pos.x < field.left - 2 ||
    pos.x > field.right + 2 ||
    pos.y + pos.h < field.top - 2 ||
    pos.y > field.bottom + 2
  ) {
    caret.hidden = true;
    return;
  }

  caret.hidden = false;
  caret.style.width = `${pos.w}px`;
  caret.style.height = `${pos.h}px`;
  caret.style.left = `${Math.round(pos.x)}px`;
  caret.style.top = `${Math.round(pos.y)}px`;
  caret.style.transform = 'none';
}

let customCaretBound = false;
function initCustomCarets(): void {
  if (customCaretBound) return;
  customCaretBound = true;
  ensureUcCaretEl();

  let raf = 0;
  let settleRaf = 0;
  let settleUntil = 0;

  const sync = (): void => {
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      raf = 0;
      syncCustomCaret();
    });
  };

  // Пока у предков идёт scaleIn/transform — пересчитываем caret несколько кадров,
  // иначе позиция «залипает» от промежуточного getBoundingClientRect.
  const settle = (ms = 220): void => {
    settleUntil = Math.max(settleUntil, performance.now() + ms);
    if (settleRaf) return;
    const tick = (): void => {
      settleRaf = 0;
      syncCustomCaret();
      if (performance.now() < settleUntil && isCustomCaretField(document.activeElement)) {
        settleRaf = requestAnimationFrame(tick);
      }
    };
    settleRaf = requestAnimationFrame(tick);
  };

  document.addEventListener('focusin', (e) => {
    if (isCustomCaretField(e.target as Element)) settle(240);
  });
  document.addEventListener('focusout', () => {
    settleUntil = 0;
    if (settleRaf) {
      cancelAnimationFrame(settleRaf);
      settleRaf = 0;
    }
    requestAnimationFrame(() => {
      if (!isCustomCaretField(document.activeElement)) {
        ensureUcCaretEl().hidden = true;
      }
    });
  });
  document.addEventListener('selectionchange', () => {
    if (isCustomCaretField(document.activeElement)) sync();
  });
  document.addEventListener('input', (e) => {
    if (isCustomCaretField(e.target as Element)) sync();
  }, true);
  document.addEventListener('keyup', (e) => {
    if (isCustomCaretField(e.target as Element)) sync();
  }, true);
  document.addEventListener('pointerup', (e) => {
    if (isCustomCaretField(e.target as Element)) sync();
  }, true);
  document.addEventListener('scroll', (e) => {
    if (isCustomCaretField(e.target as Element) || isCustomCaretField(document.activeElement)) sync();
  }, true);
  document.addEventListener(
    'animationend',
    () => {
      if (isCustomCaretField(document.activeElement)) sync();
    },
    true,
  );
  document.addEventListener(
    'transitionend',
    () => {
      if (isCustomCaretField(document.activeElement)) sync();
    },
    true,
  );
  window.addEventListener('resize', sync);
}

function setAiEmptyVisible(show: boolean): void {
  document.getElementById('ai-empty')?.classList.add('hidden');
  document.getElementById('ai-empty-dock')?.classList.toggle('hidden', !show);
  document.querySelector('#tab-ai .ai-stage')?.classList.toggle('is-empty', show);
}

function clearAiMessages(keepEmpty = true): void {
  aiStreamGen += 1;
  aiLastDividerDay = '';
  aiActiveRound = null;
  hideAiCrashBanner();
  hideAiSkeleton();
  const root = document.getElementById('ai-messages');
  if (!root) return;
  // Pending confirm паркуем по sessionId — иначе теряются при смене чата
  parkAiConfirmsFromRoot(root);
  // Убираем всё, кроме empty-state (иначе планы/разделители «липнут» к новому чату)
  root.querySelectorAll('.ai-msg, .ai-day-divider, .ai-round, .ai-skeleton').forEach((n) => n.remove());
  if (keepEmpty) setAiEmptyVisible(true);
}

const AI_SEND_ICON =
  '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M6 10V2M6 2L2.5 5.5M6 2L9.5 5.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const AI_STOP_ICON =
  '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true"><rect x="1" y="1" width="8" height="8" rx="1.5" fill="currentColor"/></svg>';

/** Send ↔ Stop в композере: квадрат, пока агент работает в активном чате. */
function syncAiComposerBusyUi(): void {
  const sendBtn = document.getElementById('ai-send') as HTMLButtonElement | null;
  if (!sendBtn) return;
  const busyHere = Boolean(aiBusy && aiBusySessionId && aiBusySessionId === aiActiveId);
  sendBtn.classList.toggle('is-stop', busyHere);
  sendBtn.disabled = false;
  sendBtn.type = busyHere ? 'button' : 'submit';
  sendBtn.innerHTML = busyHere ? AI_STOP_ICON : AI_SEND_ICON;
  sendBtn.title = busyHere ? t('ai.stop') : t('ai.send');
  sendBtn.setAttribute('aria-label', busyHere ? t('ai.stop') : t('ai.send'));
  // Titlebar-stop скрываем — управление только из композера
  setAiStopVisible(false);
}

function scrollAiMessagesToEnd(): void {
  const root = document.getElementById('ai-messages');
  if (root) root.scrollTop = root.scrollHeight;
}

function appendAiDayDivider(ts = Date.now()): void {
  const dayKey = new Date(ts).toDateString();
  if (aiLastDividerDay === dayKey) return;
  aiLastDividerDay = dayKey;
  const root = document.getElementById('ai-messages');
  if (!root) return;
  const el = document.createElement('div');
  el.className = 'ai-day-divider';
  el.setAttribute('role', 'separator');
  el.innerHTML = `<span>${escapeAiHtml(formatAiDate(new Date(ts).toISOString()))}</span>`;
  root.appendChild(el);
}

/** Голова текущего скина. mc-heads и Стив сюда не подходят. */
function aiSelfHeadSrc(): string {
  const cached = String(currentAccount?.uiAvatarDataUrl || '');
  if (cached.startsWith('data:')) return cached;
  const shown = document.querySelector<HTMLImageElement>('.account-skin-img')?.getAttribute('src') || '';
  return shown.startsWith('data:') ? shown : '';
}

function aiFaceHtml(role: 'user' | 'assistant'): string {
  if (role === 'assistant') {
    return '<span class="ai-ava ai-ava--agent"><img src="../../assets/images/UAgentLogo.png" alt="" draggable="false"></span>';
  }
  const name = String(currentAccount?.username || 'Вы');
  const src = aiSelfHeadSrc();
  const inner = src
    ? `<img src="${escapeAiHtml(src)}" alt="" draggable="false">`
    : `<span class="ai-ava__letter">${escapeAiHtml(name.slice(0, 1).toUpperCase())}</span>`;
  return `<span class="ai-ava ai-ava--self" data-ai-self-ava>${inner}</span>`;
}

function fillAiSelfHead(root: ParentNode): void {
  const slot = root.querySelector<HTMLElement>('[data-ai-self-ava]');
  if (!slot || slot.querySelector('img')) return;
  void resolveAccountHeadAvatar(currentAccount).then((url) => {
    if (!url || !slot.isConnected) return;
    slot.replaceChildren();
    const img = document.createElement('img');
    img.alt = '';
    img.draggable = false;
    img.src = url;
    slot.appendChild(img);
  });
}

function appendAiNode(role: string, html: string): HTMLElement | null {
  const root = aiActiveRound?.isConnected
    ? aiActiveRound
    : document.getElementById('ai-messages');
  if (!root) return null;
  setAiEmptyVisible(false);
  const el = document.createElement('div');
  el.className = `ai-msg ai-msg--${role}`;
  const stamp = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (role === 'assistant' || role === 'user') {
    const last = root.lastElementChild;
    const grouped = !!last?.classList.contains('ai-msg') && last.classList.contains(`ai-msg--${role}`);
    el.classList.add(grouped ? 'is-cont' : 'is-head');
    const who = role === 'assistant' ? 'UAgent' : String(currentAccount?.username || 'Вы');
    const gutter = grouped
      ? `<span class="ai-msg__hm">${stamp}</span>`
      : aiFaceHtml(role);
    const head = grouped
      ? ''
      : `<div class="ai-msg__head"><span class="ai-msg__name">${escapeAiHtml(who)}</span><span class="ai-msg__time">${stamp}</span></div>`;
    el.innerHTML = `<div class="ai-msg__row"><div class="ai-msg__gutter">${gutter}</div><div class="ai-msg__main">${head}<div class="ai-msg__bubble">${html}</div></div></div>`;
    if (role === 'user') fillAiSelfHead(el);
  } else {
    el.innerHTML = `<div class="ai-msg__bubble">${html}</div>`;
  }
  root.appendChild(el);
  scrollAiMessagesToEnd();
  return el;
}

function appendAiText(
  role: 'user' | 'assistant' | 'system',
  content: string,
  opts?: { retryPrompt?: string | null; attachments?: readonly AiAttachment[] },
): void {
  if (role === 'assistant') {
    const el = appendAiNode(role, `<div class="ai-md">${sanitizeHtml(markedParse(content || ''))}</div>`);
    if (el) {
      const retryPrompt =
        opts?.retryPrompt !== undefined
          ? opts.retryPrompt
          : [...(activeAiSession()?.messages || [])].reverse().find((m) => m.role === 'user')?.content;
      attachAiMessageActions(el, {
        copyLabel: t('ai.copy'),
        retryLabel: t('ai.retry'),
        onRetry: retryPrompt?.trim()
          ? () => {
              void sendAiMessage(retryPrompt.trim());
            }
          : undefined,
      });
    }
    return;
  }
  if (role === 'user') {
    // Живая отправка передаёт attachments явно; история — wire-промпт с блоком вложений
    const parsed =
      opts?.attachments?.length
        ? { text: content, attachments: opts.attachments }
        : parseAiAttachmentsPrompt(content);
    if (parsed.attachments.length) {
      const badges = renderAiAttachBadgesHtml(parsed.attachments);
      const body = parsed.text.trim()
        ? `<div class="ai-msg__text">${escapeAiHtml(parsed.text).replace(/\n/g, '<br>')}</div>`
        : '';
      appendAiNode(role, `${badges}${body}`);
      return;
    }
  }
  appendAiNode(role, escapeAiHtml(content).replace(/\n/g, '<br>'));
}

/** Пустой пузырь ответа с курсором (ожидание / стрим) */
function appendAiStreamBubble(): HTMLElement | null {
  return appendAiNode(
    'assistant',
    `<div class="ai-stream" aria-live="polite" aria-busy="true"><div class="ai-md ai-stream__md"></div><span class="ai-stream__caret" aria-hidden="true"></span></div>`,
  );
}

function sleepAi(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Стрим ответа сразу как markdown (без сырого «|» / «**» до финального рендера). */
async function streamAiAssistantText(
  content: string,
  into?: HTMLElement | null,
): Promise<HTMLElement | null> {
  const full = String(content || '');
  const el = into && into.isConnected ? into : appendAiStreamBubble();
  if (!el) return null;

  const gen = aiStreamGen;
  const mdEl = el.querySelector('.ai-stream__md') as HTMLElement | null;
  const bubble = el.querySelector('.ai-msg__bubble') as HTMLElement | null;
  if (!mdEl || !bubble) {
    appendAiText('assistant', full);
    el.remove();
    return null;
  }

  if (!full) {
    bubble.innerHTML = `<div class="ai-md"></div>`;
    return el;
  }

  // Скорость зависит от длины: короткие — медленнее, длинные — быстрее
  const chunk = full.length > 1200 ? 10 : full.length > 400 ? 5 : 3;
  const delay = full.length > 1200 ? 8 : 14;
  let i = 0;
  let lastRenderAt = 0;
  while (i < full.length) {
    if (gen !== aiStreamGen || !el.isConnected) return el;
    i = Math.min(full.length, i + chunk);
    const now = Date.now();
    // Markdown пересобираем ~30fps — иначе marked на каждом тике тормозит
    if (now - lastRenderAt >= 32 || i >= full.length) {
      lastRenderAt = now;
      mdEl.innerHTML = sanitizeHtml(markedParse(full.slice(0, i)));
      scrollAiMessagesToEnd();
    }
    await sleepAi(delay);
  }

  if (gen !== aiStreamGen || !el.isConnected) return el;
  bubble.innerHTML = `<div class="ai-md">${sanitizeHtml(markedParse(full))}</div>`;
  scrollAiMessagesToEnd();
  const session = activeAiSession();
  const lastUser = [...(session?.messages || [])].reverse().find((m) => m.role === 'user');
  attachAiMessageActions(el, {
    copyLabel: t('ai.copy'),
    retryLabel: t('ai.retry'),
    onRetry: () => {
      const prompt = lastUser?.content?.trim();
      if (prompt) void sendAiMessage(prompt);
    },
  });
  return el;
}

function toolLabel(name: string, args?: Record<string, unknown>): string {
  if (name === 'install_mod') {
    const title = asStringMaybe(args?.title) || asStringMaybe(args?.projectId);
    const base = dict['ai.tool.install_mod'] || AI_TOOL_LABELS.install_mod;
    return title ? `${base} ${title}…` : ensureToolEllipsis(base);
  }
  const localized = dict[`ai.tool.${name}`];
  if (localized) return ensureToolEllipsis(localized);
  const fallback = AI_TOOL_LABELS[name];
  if (fallback) return ensureToolEllipsis(fallback);
  return `${t('ai.toolUsing')}…`;
}

function ensureToolEllipsis(label: string): string {
  const s = label.trim();
  if (!s) return t('ai.toolUsing') + '…';
  return /…|\.\.\.$/.test(s) ? s : `${s}…`;
}

function asStringMaybe(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function appendAiToolStatus(
  name: string,
  status: 'running' | 'done' | 'error',
  opts?: { label?: string; durationMs?: number },
): HTMLElement | null {
  const label = opts?.label || toolLabel(name);
  const time =
    status !== 'running' && opts?.durationMs != null
      ? `${Math.max(1, Math.round(opts.durationMs / 1000))}sec`
      : '';
  // Пиксель только пока tool выполняется; после — только текст статуса
  const pixel =
    status === 'running'
      ? '<span class="ai-pixel is-running" aria-hidden="true"></span>'
      : '';
  return appendAiNode(
    'tool',
    `<div class="ai-tool is-${status}" data-tool="${escapeAiHtml(name)}">
      ${pixel}
      <span class="ai-tool__label">${escapeAiHtml(label)}</span>
      ${time ? `<span class="ai-tool__time">${escapeAiHtml(time)}</span>` : ''}
    </div>`,
  );
}

function setAiToolStatus(
  el: HTMLElement | null,
  status: 'running' | 'done' | 'error',
  durationMs?: number,
): void {
  const row = el?.querySelector('.ai-tool');
  if (!row) return;
  row.classList.remove('is-running', 'is-done', 'is-error');
  row.classList.add(`is-${status}`);
  // После выполнения пиксель скрываем
  row.querySelector('.ai-pixel')?.remove();
  if (status !== 'running' && durationMs != null) {
    let time = row.querySelector('.ai-tool__time');
    if (!time) {
      time = document.createElement('span');
      time.className = 'ai-tool__time';
      row.appendChild(time);
    }
    time.textContent = `${Math.max(1, Math.round(durationMs / 1000))}sec`;
  }
}

function setAiBusySession(sessionId: string | null): void {
  aiBusySessionId = sessionId;
  renderAiSessionList();
  const titlePixel = document.getElementById('ai-title-pixel');
  const activeBusy = Boolean(sessionId && sessionId === aiActiveId);
  if (titlePixel) {
    titlePixel.classList.toggle('hidden', !activeBusy);
    titlePixel.classList.toggle('is-running', activeBusy);
  }
  syncAiComposerBusyUi();
}

function appendAiModCards(mods: AiModCard[]): void {
  if (!mods.length) return;
  const cards = mods
    .slice(0, 6)
    .map((m) => {
      const icon = m.iconUrl
        ? `<img class="ai-mod-card__icon" src="${escapeAiHtml(m.iconUrl)}" alt="">`
        : `<div class="ai-mod-card__icon"></div>`;
      return `<button type="button" class="ai-mod-card" data-mod-id="${escapeAiHtml(m.id)}" data-mod-slug="${escapeAiHtml(m.slug || '')}">
        ${icon}
        <div class="ai-mod-card__body">
          <div class="ai-mod-card__title">${escapeAiHtml(m.title)}</div>
          <div class="ai-mod-card__meta">
            <span class="ai-mod-card__meta-item">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1.5V9M7 9L3.5 5.5M7 9L10.5 5.5M2 11.5H12" stroke="white" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
              ${escapeAiHtml(formatAiDownloads(m.downloads))} ${escapeAiHtml(t('ai.downloads'))}
            </span>
            <span class="ai-mod-card__meta-item">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.25" stroke="white" stroke-width="1.4"/><path d="M7 3.8V7L9.2 8.3" stroke="white" stroke-width="1.4" stroke-linecap="round"/></svg>
              ${escapeAiHtml(t('ai.updated'))} ${escapeAiHtml(formatAiDate(m.updatedAt))}
            </span>
          </div>
        </div>
      </button>`;
    })
    .join('');
  appendAiNode('mods', `<div class="ai-mod-cards">${cards}</div>`);
}

function extractModsFromToolResult(result: unknown): AiModCard[] {
  if (!result || typeof result !== 'object') return [];
  const obj = result as any;
  const list = Array.isArray(obj.mods) ? obj.mods : obj.mod ? [obj.mod] : [];
  return list
    .filter((m: any) => m && (m.id || m.slug) && m.title)
    .map((m: any) => ({
      id: String(m.id || m.slug),
      slug: m.slug,
      title: String(m.title),
      description: m.description,
      iconUrl: m.iconUrl || m.icon_url || null,
      downloads: Number(m.downloads) || 0,
      updatedAt: m.updatedAt || m.date_modified || null,
    }));
}

function renderAiSessionList(): void {
  const list = document.getElementById('ai-chat-list');
  if (!list) return;
  list.innerHTML = '';
  const q = aiSearchQuery.trim().toLowerCase();
  const loose = aiSessions.filter((s) => !s.folderId || !aiFolders.some((f) => f.id === s.folderId));
  const groups: { id: string; name: string; sessions: AiSession[] }[] = [
    ...aiFolders.map((f) => ({
      id: f.id,
      name: f.name,
      sessions: aiSessions.filter((s) => s.folderId === f.id),
    })),
    { id: '', name: t('ai.folder.none'), sessions: loose },
  ];
  for (const group of groups) {
    const sessions = group.sessions.filter((s) => !q || s.title.toLowerCase().includes(q) || group.name.toLowerCase().includes(q));
    if (!group.id && !sessions.length) continue;
    if (q && !sessions.length && !group.name.toLowerCase().includes(q)) continue;
    const folder = document.createElement('div');
    folder.className = 'ai-folder';
    if (group.id && aiFolderCollapsed.has(group.id) && !q) folder.classList.add('is-collapsed');
    const head = document.createElement('div');
    head.className = 'ai-folder__head';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'ai-folder__name';
    toggle.dataset.folderId = group.id;
    toggle.textContent = group.name;
    if (group.id) {
      toggle.addEventListener('click', () => {
        if (aiFolderCollapsed.has(group.id)) aiFolderCollapsed.delete(group.id);
        else aiFolderCollapsed.add(group.id);
        renderAiSessionList();
      });
      toggle.addEventListener('dblclick', (e) => {
        e.preventDefault();
        beginAiFolderRename(group.id, toggle);
      });
    }
    head.appendChild(toggle);
    if (group.id) {
      const renameBtn = document.createElement('button');
      renameBtn.type = 'button';
      renameBtn.className = 'ai-folder__act';
      renameBtn.title = t('ai.folder.rename');
      renameBtn.textContent = '✎';
      renameBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        beginAiFolderRename(group.id, toggle);
      });
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'ai-folder__act ai-folder__act--danger';
      delBtn.title = t('ai.folder.delete');
      delBtn.textContent = '×';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteAiFolder(group.id);
      });
      head.appendChild(renameBtn);
      head.appendChild(delBtn);
    }
    folder.appendChild(head);
    const chats = document.createElement('div');
    chats.className = 'ai-folder__chats';
    for (const session of sessions) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `ai-session${session.id === aiActiveId ? ' active' : ''}`;
      row.dataset.id = session.id;
      const busy = session.id === aiBusySessionId;
      row.innerHTML = `
        ${busy
          ? '<span class="ai-pixel is-running" aria-hidden="true"></span>'
          : `<img class="ai-session__ico" src="../../assets/icons/aiPanel/chat.svg" width="14" height="14" alt="" aria-hidden="true">`}
        <span class="ai-session__title">${escapeAiHtml(session.title)}</span>
        <span class="ai-session__time">${escapeAiHtml(formatAiRelative(session.updatedAt))}</span>
      `;
      row.addEventListener('click', () => selectAiSession(session.id));
      chats.appendChild(row);
    }
    folder.appendChild(chats);
    list.appendChild(folder);
  }
}

function beginAiFolderRename(folderId: string, nameBtn: HTMLButtonElement): void {
  const folder = aiFolders.find((f) => f.id === folderId);
  if (!folder) return;
  const input = document.createElement('input');
  input.className = 'ai-folder__rename';
  input.value = folder.name;
  nameBtn.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const commit = () => {
    if (done) return;
    done = true;
    const next = input.value.replace(/\s+/g, ' ').trim().slice(0, 40);
    if (next) folder.name = next;
    saveAiSessions();
    renderAiSessionList();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      renderAiSessionList();
    }
  });
  input.addEventListener('blur', commit);
}

function deleteAiFolder(folderId: string): void {
  aiFolders = aiFolders.filter((f) => f.id !== folderId);
  for (const session of aiSessions) {
    if (session.folderId === folderId) session.folderId = null;
  }
  aiFolderCollapsed.delete(folderId);
  saveAiSessions();
  renderAiSessionList();
}

function renderAiMoveMenu(): void {
  const host = document.getElementById('ai-menu-move');
  const session = activeAiSession();
  if (!host) return;
  const items = [
    { id: '', name: t('ai.folder.none') },
    ...aiFolders.map((f) => ({ id: f.id, name: f.name })),
  ];
  host.innerHTML = items
    .map((item) => {
      const on = (session?.folderId || '') === item.id || (!session?.folderId && !item.id);
      return `<button type="button" class="ai-chat-menu__move-btn${on ? ' is-on' : ''}" data-move-folder="${escapeAiHtml(item.id)}">${escapeAiHtml(item.name)}</button>`;
    })
    .join('');
}

function shortToolArg(args: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    if (key === 'buildId' || value == null || value === '') continue;
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    parts.push(`${key}: ${text.replace(/\s+/g, ' ').slice(0, 48)}`);
    if (parts.length >= 2) break;
  }
  return parts.join(' · ');
}

function toolStatusWord(status: 'running' | 'done' | 'error'): string {
  if (status === 'running') return '…';
  if (status === 'error') return 'ошибка';
  return 'готово';
}

type AiToolGroup = {
  root: HTMLElement;
  list: HTMLElement;
  labelEl: HTMLElement;
  countEl: HTMLElement;
  statusEl: HTMLElement;
};

let aiRoundTrace: AiToolTrace[] = [];

/** «1 действие», «2 действия», «5 действий». */
function actionCountPhrase(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  let word = 'действий';
  if (mod10 === 1 && mod100 !== 11) word = 'действие';
  else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) word = 'действия';
  return `${n} ${word}`;
}

function clipToolText(value: unknown, max = 700): string {
  if (value == null) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** Один свёрнутый блок на весь ход: шеврон, время, число действий, статус. */
function mountAiToolGroup(): AiToolGroup | null {
  const host = document.getElementById('ai-messages');
  if (!host) return null;
  aiRoundTrace = [];
  setAiEmptyVisible(false);
  const root = document.createElement('div');
  root.className = 'ai-tool-group is-collapsed';
  root.innerHTML = `
    <button type="button" class="ai-tool-group__sum">
      <span class="ai-worked__chev" aria-hidden="true"></span>
      <span class="ai-tool-group__label"></span>
      <span class="ai-tool-group__count"></span>
      <span class="ai-tool-group__sum-st"></span>
    </button>
    <div class="ai-tool-group__list" hidden></div>`;
  const list = root.querySelector('.ai-tool-group__list') as HTMLElement;
  const labelEl = root.querySelector('.ai-tool-group__label') as HTMLElement;
  const countEl = root.querySelector('.ai-tool-group__count') as HTMLElement;
  const statusEl = root.querySelector('.ai-tool-group__sum-st') as HTMLElement;
  root.querySelector('button')?.addEventListener('click', () => {
    const open = root.classList.toggle('is-open');
    root.classList.toggle('is-collapsed', !open);
    list.hidden = !open;
  });
  host.appendChild(root);
  scrollAiMessagesToEnd();
  return { root, list, labelEl, countEl, statusEl };
}

function noteToolGroup(
  group: AiToolGroup | null,
  id: string,
  opts: {
    name: string;
    arg: string;
    status: 'running' | 'done' | 'error';
    argsText?: string;
    resultText?: string;
  },
): void {
  const prev = aiRoundTrace.find((row) => row.id === id);
  const next: AiToolTrace = {
    id,
    name: opts.name,
    arg: opts.arg,
    status: opts.status,
    argsText: opts.argsText || prev?.argsText || '',
    resultText: opts.resultText || prev?.resultText || '',
  };
  if (prev) Object.assign(prev, next);
  else aiRoundTrace.push(next);
  if (!group) return;
  let row: HTMLElement | null = null;
  for (const child of Array.from(group.list.children)) {
    if ((child as HTMLElement).dataset.toolId === id) row = child as HTMLElement;
  }
  if (!row) {
    row = document.createElement('div');
    row.className = 'ai-tool-group__row';
    row.dataset.toolId = id;
    row.innerHTML = `
      <button type="button" class="ai-tool-group__item">
        <span class="ai-tool-group__name"></span>
        <span class="ai-tool-group__arg"></span>
        <span class="ai-tool-group__st"></span>
      </button>
      <pre class="ai-tool-group__detail" hidden></pre>`;
    const detail = row.querySelector('.ai-tool-group__detail') as HTMLElement;
    row.querySelector('button')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!detail.textContent?.trim()) return;
      detail.hidden = !detail.hidden;
    });
    group.list.appendChild(row);
  }
  row.className = `ai-tool-group__row is-${opts.status}`;
  const nameEl = row.querySelector('.ai-tool-group__name');
  const argEl = row.querySelector('.ai-tool-group__arg');
  const stEl = row.querySelector('.ai-tool-group__st');
  const detail = row.querySelector('.ai-tool-group__detail') as HTMLElement;
  if (nameEl) nameEl.textContent = opts.name;
  if (argEl) argEl.textContent = opts.arg;
  if (stEl) stEl.textContent = toolStatusWord(opts.status);
  const chunks = [next.argsText, next.resultText].filter(Boolean);
  detail.textContent = chunks.join('\n\n');
  const n = group.list.children.length;
  group.countEl.textContent = n ? actionCountPhrase(n) : '';
  if (opts.status === 'running') group.statusEl.textContent = toolStatusWord('running');
}

/** Сводка блока: время всего хода, число действий и общий статус. */
function finishToolGroup(
  group: AiToolGroup | null,
  workedMs?: number,
  status: 'running' | 'done' | 'error' = 'done',
): void {
  if (!group) return;
  const n = group.list.children.length;
  if (workedMs != null && workedMs > 0) {
    group.labelEl.textContent = t('ai.worked', { sec: Math.max(1, Math.round(workedMs / 1000)) });
  } else if (!group.labelEl.textContent) {
    group.labelEl.textContent = n ? actionCountPhrase(n) : '';
  }
  group.countEl.textContent = n ? actionCountPhrase(n) : '';
  const rowError = Boolean(group.list.querySelector('.is-error'));
  const shown = status === 'running' ? 'running' : rowError ? 'error' : 'done';
  group.statusEl.textContent = n ? toolStatusWord(shown) : '';
  group.root.classList.toggle('is-running', shown === 'running');
}

/** Весь ход лежит одним массивом шагов на первом сообщении ассистента. */
function commitTurnTrace(session: AiSession, anchorToolId: string, workedMs: number): void {
  if (!anchorToolId || !aiRoundTrace.length) return;
  const anchor = session.messages.findIndex(
    (msg) =>
      msg.role === 'assistant' &&
      msg.tool_calls?.some((tc) => tc.id === anchorToolId),
  );
  const anchorMsg = anchor >= 0 ? session.messages[anchor] : undefined;
  if (!anchorMsg || anchorMsg.role !== 'assistant') return;
  anchorMsg.toolTrace = aiRoundTrace.map((row) => ({
    ...row,
    status: row.status === 'running' ? 'done' : row.status,
  }));
  anchorMsg.workedMs = workedMs;
  for (let i = anchor + 1; i < session.messages.length; i += 1) {
    const msg = session.messages[i];
    if (msg.role === 'user') {
      const text = 'content' in msg ? String(msg.content || '') : '';
      if (!text.startsWith('[Контекст]')) break;
      continue;
    }
    if (msg.role === 'assistant') {
      delete msg.toolTrace;
      delete msg.workedMs;
    }
  }
}

function appendAiWorkedSummary(steps: AiToolTrace[], workedMs?: number): void {
  if (!steps.length) return;
  const group = mountAiToolGroup();
  for (const step of steps) {
    noteToolGroup(group, step.id, {
      name: step.name,
      arg: step.arg,
      status: step.status === 'running' ? 'done' : step.status,
      argsText: step.argsText,
      resultText: step.resultText,
    });
  }
  const failed = steps.some((step) => step.status === 'error');
  finishToolGroup(group, workedMs, failed ? 'error' : 'done');
}

/** Шаги одного сообщения: снимок хода или разбор tool_calls. */
function stepsFromAssistant(
  msg: Extract<AiWireMessage, { role: 'assistant' }>,
  toolResults: Map<string, any>,
): AiToolTrace[] {
  if (msg.toolTrace?.length) {
    return msg.toolTrace.map((step) => ({
      ...step,
      status: step.status === 'running' ? 'done' : step.status,
    }));
  }
  return (msg.tool_calls || []).map((tc) => {
    const args = parseToolArgs(tc.function.arguments);
    const result = toolResults.get(tc.id);
    return {
      id: tc.id,
      name: toolLabel(tc.function.name, args),
      arg: shortToolArg(args),
      status: (result?.error ? 'error' : 'done') as 'error' | 'done',
      argsText: clipToolText(args, 500),
      resultText: clipToolText(result, 700),
    };
  });
}

function renderAiConversation(): void {
  clearAiMessages(true);
  aiLastDividerDay = '';
  aiActiveRound = null;
  const session = activeAiSession();
  const titleEl = document.getElementById('ai-stage-title');
  if (titleEl) {
    titleEl.textContent = session?.messages.length ? session.title : t('ai.title');
    if (!session?.messages.length) titleEl.setAttribute('data-i18n', 'ai.title');
    else titleEl.removeAttribute('data-i18n');
  }
  updateAiBuildChip(session);
  updateAiContextRing(session);
  refreshAiShellUi(session);
  renderAiUndoChip(getAiUiHost());

  if (!session || !session.messages.length) {
    setAiEmptyVisible(true);
    restoreAiConfirmsForSession(session?.id || '', getAiUiHost());
    syncAiComposerBusyUi();
    return;
  }

  appendAiDayDivider(session.updatedAt);

  const toolResults = new Map<string, any>();
  for (const msg of session.messages) {
    if (msg.role === 'tool') {
      try {
        toolResults.set(msg.tool_call_id, JSON.parse(msg.content));
      } catch {
        toolResults.set(msg.tool_call_id, null);
      }
    }
  }

  let lastUserPrompt = '';
  for (let i = 0; i < session.messages.length; i += 1) {
    const msg = session.messages[i];
    if (msg.role === 'tool') continue;
    if (msg.role === 'user') {
      if (!String(msg.content || '').startsWith('[Контекст]')) lastUserPrompt = msg.content;
      appendAiText('user', visibleUserText(msg.content));
      continue;
    }
    if (msg.role !== 'assistant') continue;
    const hasTools = Boolean(msg.tool_calls?.length || msg.toolTrace?.length);
    if (!hasTools) {
      if (msg.content) appendAiText('assistant', msg.content, { retryPrompt: lastUserPrompt });
      continue;
    }

    // Подряд идущие вызовы одного ответа — один блок, даже если раньше лежали отдельными сообщениями.
    const steps: AiToolTrace[] = [];
    let workedMs = 0;
    const texts: string[] = [];
    const sideNotes: string[] = [];
    const modCalls: AiToolCall[] = [];
    let j = i;
    for (; j < session.messages.length; j += 1) {
      const stepMsg = session.messages[j];
      if (stepMsg.role === 'tool') continue;
      if (stepMsg.role === 'user') {
        if (String(stepMsg.content || '').startsWith('[Контекст]')) {
          sideNotes.push(stepMsg.content);
          continue;
        }
        break;
      }
      if (stepMsg.role !== 'assistant') break;
      const stepHasTools = Boolean(stepMsg.tool_calls?.length || stepMsg.toolTrace?.length);
      if (!stepHasTools) {
        if (stepMsg.content) texts.push(stepMsg.content);
        j += 1;
        break;
      }
      const before = steps.length;
      for (const step of stepsFromAssistant(stepMsg, toolResults)) {
        if (!steps.some((row) => row.id === step.id)) steps.push(step);
      }
      if (steps.length > before && typeof stepMsg.workedMs === 'number') workedMs += stepMsg.workedMs;
      if (stepMsg.tool_calls?.length) modCalls.push(...stepMsg.tool_calls);
      if (stepMsg.content) texts.push(stepMsg.content);
    }
    appendAiWorkedSummary(steps, workedMs || undefined);
    for (const note of sideNotes) appendAiText('user', note);
    for (const text of texts) appendAiText('assistant', text, { retryPrompt: lastUserPrompt });
    for (const tc of modCalls) {
      const mods = extractModsFromToolResult(toolResults.get(tc.id));
      if (mods.length) appendAiModCards(mods);
    }
    i = j - 1;
  }

  restoreAiConfirmsForSession(session.id, getAiUiHost());
  syncAiComposerBusyUi();
}

function selectAiSession(id: string): void {
  if (!aiSessions.some((s) => s.id === id)) return;
  aiActiveId = id;
  saveAiSessions();
  clearAiAttachments();
  closeAiAttachMenu();
  renderAiSessionList();
  renderAiConversation();
  syncAiComposerBusyUi();
  document.getElementById('ai-input')?.focus();
}

function deleteAiSession(id: string): void {
  aiSessions = aiSessions.filter((s) => s.id !== id);
  if (!aiSessions.length) createAiSession(false);
  if (aiActiveId === id) aiActiveId = aiSessions[0].id;
  saveAiSessions();
  renderAiSessionList();
  renderAiConversation();
}

function parseToolArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Сколько последних user-ходов держим «горячими» (полные tool-результаты). */
const AI_WIRE_HOT_USER_TURNS = 3;
const AI_WIRE_TOOL_HOT_CHARS = 3500;
const AI_WIRE_TOOL_COLD_CHARS = 400;
const AI_WIRE_USER_HOT_CHARS = 6000;
const AI_WIRE_USER_COLD_CHARS = 1200;

/** Ужимает JSON tool-результата: режет excerpt/логи и длинные массивы. */
function slimAiToolPayload(value: unknown, depth = 0): unknown {
  if (depth > 4) return null;
  if (typeof value === 'string') {
    if (value.length > 500) return value.slice(0, 400) + '…';
    return value;
  }
  if (Array.isArray(value)) {
    const sliced = value.slice(0, 10).map((x) => slimAiToolPayload(x, depth + 1));
    return value.length > 10 ? [...sliced, { _truncated: value.length }] : sliced;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (
        typeof v === 'string' &&
        v.length > 400 &&
        /excerpt|text|content|log|html|body|raw/i.test(k)
      ) {
        out[k] = v.slice(0, 350) + '…';
        continue;
      }
      out[k] = slimAiToolPayload(v, depth + 1);
    }
    return out;
  }
  return value;
}

function compactAiToolContent(raw: string, maxChars: number): string {
  const text = String(raw || '');
  if (!text) return JSON.stringify({ error: 'empty' });
  try {
    const parsed = JSON.parse(text);
    const slim = slimAiToolPayload(parsed);
    const out = JSON.stringify(slim);
    if (out.length <= maxChars) return out;
    return out.slice(0, maxChars) + '…';
  } catch {
    return text.length <= maxChars ? text : text.slice(0, maxChars) + '…';
  }
}

/** Старые user-сообщения: убираем код-блоки вложений/логов. */
function compactAiUserContent(raw: string, maxChars: number, stripBlocks: boolean): string {
  let s = String(raw || '');
  if (stripBlocks) {
    s = s.replace(/```[\s\S]*?```/g, '[…файл/лог…]');
  }
  if (s.length > maxChars) s = s.slice(0, maxChars) + '\n…';
  return s;
}

/**
 * Готовит историю к отправке в API (не мутирует session):
 * — горячие последние user-ходы почти целиком;
 * — старые tool-результаты и code-блоки сильно ужимаются.
 */
function prepareAiWireMessages(messages: AiWireMessage[]): AiWireMessage[] {
  const clean = sanitizeAiWireMessages(messages);
  let userTurns = 0;
  const hotFlags: boolean[] = new Array(clean.length).fill(false);
  for (let i = clean.length - 1; i >= 0; i -= 1) {
    if (clean[i].role === 'user') {
      userTurns += 1;
    }
    hotFlags[i] = userTurns <= AI_WIRE_HOT_USER_TURNS;
  }

  return clean.map((m, i) => {
    const hot = hotFlags[i];
    if (m.role === 'tool') {
      return {
        ...m,
        content: compactAiToolContent(String(m.content || ''), hot ? AI_WIRE_TOOL_HOT_CHARS : AI_WIRE_TOOL_COLD_CHARS),
      };
    }
    if (m.role === 'user') {
      const visible = compactAiUserContent(
        String(m.content || ''),
        hot ? AI_WIRE_USER_HOT_CHARS : AI_WIRE_USER_COLD_CHARS,
        !hot,
      );
      const hint = 'hint' in m && m.hint ? String(m.hint).trim() : '';
      return {
        role: 'user',
        content: hint ? `${hint}\n${visible}` : visible,
      };
    }
    if (m.role === 'assistant' && m.content) {
      const text = String(m.content);
      const max = hot ? 4000 : 1200;
      const next: AiWireMessage = {
        role: 'assistant',
        content: text.length > max ? text.slice(0, max) + '…' : text,
      };
      if (m.tool_calls?.length) next.tool_calls = m.tool_calls;
      return next;
    }
    if (m.role === 'assistant') {
      const next: AiWireMessage = { role: 'assistant', content: m.content };
      if (m.tool_calls?.length) next.tool_calls = m.tool_calls;
      return next;
    }
    return m;
  });
}

/** Чинит историю для API: tool только после assistant.tool_calls, без «осиротевших» tool. */
function sanitizeAiWireMessages(messages: AiWireMessage[]): AiWireMessage[] {
  const out: AiWireMessage[] = [];
  let pending = new Set<string>();

  const flushPending = (reason: string) => {
    for (const id of pending) {
      out.push({
        role: 'tool',
        tool_call_id: id,
        content: JSON.stringify({ error: reason }),
      });
    }
    pending = new Set();
  };

  for (const m of messages) {
    if (m.role === 'user') {
      flushPending('interrupted');
      const content = String(m.content || '').trim();
      if (content) {
        const kept: AiWireMessage = { role: 'user', content: m.content };
        if ('hint' in m && m.hint) kept.hint = m.hint;
        out.push(kept);
      }
      continue;
    }
    if (m.role === 'assistant') {
      flushPending('interrupted');
      const tcs = Array.isArray(m.tool_calls) ? m.tool_calls.filter((tc) => tc?.id && tc?.function?.name) : [];
      if (tcs.length) {
        const kept: AiWireMessage = {
          role: 'assistant',
          content: m.content == null || m.content === '' ? null : m.content,
          tool_calls: tcs,
        };
        if (typeof m.workedMs === 'number') kept.workedMs = m.workedMs;
        if (m.toolTrace?.length) kept.toolTrace = m.toolTrace;
        out.push(kept);
        pending = new Set(tcs.map((tc) => String(tc.id)));
      } else if (String(m.content || '').trim()) {
        out.push({ role: 'assistant', content: String(m.content) });
      }
      continue;
    }
    if (m.role === 'tool') {
      const id = String(m.tool_call_id || '');
      if (!id || !pending.has(id)) continue;
      pending.delete(id);
      out.push({
        role: 'tool',
        tool_call_id: id,
        content: compactAiToolContent(String(m.content || ''), AI_WIRE_TOOL_HOT_CHARS),
      });
    }
  }
  flushPending('incomplete');
  return out;
}

async function runAiToolSafe(
  name: string,
  args: Record<string, unknown>,
  opts?: { preconfirmed?: boolean; sessionId?: string | null },
): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  let exec = await api?.aiToolsRun?.(
    name,
    args,
    opts?.preconfirmed ? { confirmed: true } : undefined,
  );
  if (exec && !exec.ok && exec.error === 'confirm_required') {
    const sessionId = opts?.sessionId || activeAiSession()?.id;
    const fromTelegram = sessionById(sessionId)?.source === 'telegram';
    if (!fromTelegram) setAiAgentStatus('confirm');
    const described = describeAiAction(name, args, t, getAiUiHost());
    const line = [described.title, described.detail].filter(Boolean).join(' — ');
    const ok = fromTelegram
      ? await askTelegramConfirm(line)
      : await askAiConfirmInChat({
          host: getAiUiHost(),
          tool: name,
          args,
          risk: 'write',
          sessionId,
        });
    if (!ok) return { ok: false, error: 'cancelled' };
    exec = await api?.aiToolsRun?.(name, args, { confirmed: true });
  }
  return exec || { ok: false, error: 'no_api' };
}

function toolCallSignature(name: string, args: Record<string, unknown>): string {
  const stable: Record<string, unknown> = {};
  for (const key of Object.keys(args).sort()) stable[key] = args[key];
  return `${name}::${JSON.stringify(stable)}`;
}

/** Пустой объект или явная ошибка — это не прогресс хода. */
function isUselessToolPayload(payload: unknown): boolean {
  if (payload == null) return true;
  if (typeof payload === 'string') return !payload.trim();
  if (typeof payload !== 'object') return false;
  const obj = payload as Record<string, unknown>;
  if (obj.error) return true;
  return Object.keys(obj).length === 0;
}

function localAiTurnFallback(session: AiSession): string {
  const done: string[] = [];
  const failed: string[] = [];
  for (const msg of session.messages) {
    if (msg.role !== 'assistant' || !msg.tool_calls?.length) continue;
    for (const tc of msg.tool_calls) {
      const label = toolLabel(tc.function.name, parseToolArgs(tc.function.arguments));
      const toolMsg = session.messages.find((m) => m.role === 'tool' && m.tool_call_id === tc.id);
      let err = false;
      try {
        const parsed = JSON.parse(toolMsg && toolMsg.role === 'tool' ? toolMsg.content : '{}');
        err = Boolean(parsed?.error);
      } catch {
        err = true;
      }
      if (err) failed.push(label);
      else done.push(label);
    }
  }
  const lines = ['Остановился, чтобы не зациклиться на инструментах.'];
  if (done.length) lines.push(`Сделано: ${[...new Set(done)].slice(-8).join(', ')}.`);
  if (failed.length) lines.push(`Не вышло: ${[...new Set(failed)].slice(-6).join(', ')}.`);
  lines.push('Напиши, что сделать следующим шагом.');
  return lines.join(' ');
}

/** Финальный ответ без инструментов: что сделано и что осталось. */
async function finishAiTurnWithSummary(session: AiSession, reason: 'stall' | 'limit'): Promise<void> {
  const note =
    reason === 'stall'
      ? 'Одинаковые или пустые вызовы инструментов не дают нового результата. Не вызывай инструменты. Коротко напиши пользователю, что уже сделано и что осталось.'
      : 'Лимит шагов с инструментами почти исчерпан. Не вызывай инструменты. Коротко напиши пользователю, что уже сделано и что осталось.';
  setAiAgentStatus('thinking');
  const result = await api?.aiChat?.({
    model: currentAiModel(),
    messages: wireWithBuildCatalog([...session.messages, { role: 'user', content: note }]) as any,
    tools: false,
    context: aiContextPayload(session),
  });
  const reply = String(result?.reply || '').trim() || localAiTurnFallback(session);
  session.messages.push({ role: 'assistant', content: reply });
  setAiAgentStatus('streaming');
  await streamAiAssistantText(reply);
  session.updatedAt = Date.now();
  saveAiSessions();
  renderAiSessionList();
  updateAiContextRing(session);
}

async function answerHostedRequest(session: AiSession, text: string): Promise<boolean> {
  const raw = text.toLowerCase().replace(/ё/g, 'е');
  if (!asksOwnHostedServer(raw)) return false;
  if (/создай|поставь|установи|измени|запусти|останови|удали|включи|выключи|скачай|пропиши|настрой/.test(raw)) return false;
  const wantPlugins = /плагин/.test(raw);
  const wantList = /сервер/.test(raw);
  if (!wantPlugins && !wantList) return false;
  await refreshHostedBriefs();
  if (!hostedBriefs.length) return false;
  const chunks: string[] = [];
  for (const server of hostedBriefs) {
    const head = `${server.name} — ${server.software || '?'} ${server.gameVersion || '?'}, ${server.status || 'stopped'}`;
    if (!wantPlugins) {
      chunks.push(head);
      continue;
    }
    const plugins = (await api?.hostedServersPlugins?.(server.id)) || [];
    const body = plugins.length
      ? plugins.map((plugin) => `• ${plugin.name}${plugin.enabled ? '' : ' (выключен)'}`).join('\n')
      : 'Плагинов нет.';
    chunks.push(`${head}\n${body}`);
  }
  const reply = chunks.join('\n\n');
  session.messages.push({ role: 'assistant', content: reply });
  appendAiText('assistant', reply);
  saveAiSessions();
  return true;
}

async function runAiAgentTurn(session: AiSession): Promise<void> {
  await refreshHostedBriefs();
  aiTurnReadConfig = false;
  const askedNow = latestHumanUserText(session);
  if (/плагин|конфиг|сервер|\.ya?ml/i.test(askedNow)) await refreshHostedFileNote();
  let rounds = 0;
  let stallRounds = 0;
  let needWrap: 'stall' | 'limit' | null = null;
  let lastToolSig = '';
  const toolErrorHits = new Map<string, number>();
  const seenResult = new Map<string, string>();
  const messagesRoot = document.getElementById('ai-messages');
  // Один блок на весь ответ пользователю, а не на каждый раунд модели.
  let turnGroup: AiToolGroup | null = null;
  let turnAnchorToolId = '';
  let turnWorkedMs = 0;
  while (rounds < AI_MAX_TOOL_ROUNDS) {
    if (aiStopRequested) break;
    rounds += 1;
    setAiAgentStatus('thinking');
    syncAiComposerBusyUi();
    showAiSkeleton(messagesRoot);
    const result = await api?.aiChat?.({
      model: currentAiModel(),
      messages: wireWithBuildCatalog(session.messages) as any,
      tools: true,
      context: aiContextPayload(session),
    });
    hideAiSkeleton();

    if (aiStopRequested) break;

    if (!result || result.error) {
      if (isAiAccessDeniedResult(result)) {
        handleAiAccessDenied();
        break;
      }
      appendAiText('system', t('ai.error', { error: formatAiChatError(result) }));
      break;
    }

    const toolCalls = Array.isArray(result.toolCalls) ? result.toolCalls : [];
    let round: HTMLElement | null = null;
    let pendingVisibleReply = '';

    if (toolCalls.length) {
      // Итог пишем под общим блоком инструментов, не отдельным «Работал N с» на каждый вызов.
      aiActiveRound = null;
      if (!turnGroup) turnGroup = mountAiToolGroup();
      if (result.reply) {
        pendingVisibleReply = result.reply;
        session.messages.push({
          role: 'assistant',
          content: result.reply,
          tool_calls: toolCalls,
        });
      } else {
        session.messages.push({
          role: 'assistant',
          content: null,
          tool_calls: toolCalls,
        });
      }
      if (!turnAnchorToolId) turnAnchorToolId = String(toolCalls[0]?.id || '');
    } else {
      round = messagesRoot ? beginAiRound(messagesRoot) : null;
      aiActiveRound = round;
    }

    if (toolCalls.length) {

      const prepared = toolCalls.map((tc: any) => {
        const args = parseToolArgs(tc.function.arguments);
        if (
          !args.buildId &&
          session.buildId &&
          tc.function.name !== 'launch_build' &&
          tc.function.name !== 'create_build' &&
          !asksOwnHostedServer(latestHumanUserText(session))
        ) {
          args.buildId = session.buildId;
        }
        const adjusted = adjustBuildToolArgs(tc.function.name, args, session);
        return { tc, args: adjusted.args, blocked: adjusted.blocked || '' };
      });
      const writeItems = prepared
        .filter((x) => !x.blocked && AI_WRITE_TOOLS.has(x.tc.function.name))
        .map((x) => ({ tool: x.tc.function.name as string, args: x.args }));
      let batchOk = true;
      if (writeItems.length > 1) {
        if (session.source === 'telegram') {
          const lines = writeItems.map((item) => {
            const described = describeAiAction(item.tool, item.args, t, getAiUiHost());
            return [described.title, described.detail].filter(Boolean).join(' — ');
          });
          batchOk = await askTelegramConfirm(lines.join('\n'));
        } else {
          setAiAgentStatus('confirm');
          batchOk = await askAiConfirmBatch({
            host: getAiUiHost(),
            items: writeItems,
            sessionId: session.id,
          });
        }
      }
      const preconfirmed = writeItems.length > 1 && batchOk;
      const roundStarted = Date.now();
      let roundHadProgress = false;

      const answeredToolIds = new Set<string>();
      for (let i = 0; i < prepared.length; i += 1) {
        if (aiStopRequested) break;
        const { tc, args, blocked } = prepared[i];
        if (blocked) {
          noteToolGroup(turnGroup, tc.id, {
            name: toolLabel(tc.function.name, args),
            arg: shortToolArg(args),
            status: 'error',
            resultText: blocked,
          });
          session.messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify({
              error: blocked.startsWith('Запись запрещена') ? 'need_read' : 'build_mismatch',
              hint: blocked,
            }),
          });
          answeredToolIds.add(tc.id);
          continue;
        }
        const sig = toolCallSignature(tc.function.name, args);
        const repeat = sig === lastToolSig;
        const hammer = (toolErrorHits.get(sig) || 0) >= 2;
        lastToolSig = sig;
        updateAiPlanStep(`step_${rounds}_${i}`, 'running');
        setAiAgentStatus('tool', toolLabel(tc.function.name, args));
        syncAiComposerBusyUi();

        if (repeat || hammer) {
          updateAiPlanStep(`step_${rounds}_${i}`, 'error');
          noteToolGroup(turnGroup, tc.id, {
            name: toolLabel(tc.function.name, args),
            arg: shortToolArg(args),
            status: 'error',
          });
          session.messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify({
              error: repeat ? 'repeat_call' : 'error_loop',
              hint: 'Не повторяй этот вызов. Ответь пользователю, что уже известно и что осталось.',
            }),
          });
          answeredToolIds.add(tc.id);
          continue;
        }

        if (writeItems.length > 1 && AI_WRITE_TOOLS.has(tc.function.name) && !batchOk) {
          updateAiPlanStep(`step_${rounds}_${i}`, 'error');
          noteToolGroup(turnGroup, tc.id, {
            name: toolLabel(tc.function.name, args),
            arg: shortToolArg(args),
            status: 'error',
          });
          session.messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify({ error: 'cancelled' }),
          });
          answeredToolIds.add(tc.id);
          continue;
        }

        const beforeBuild =
          tc.function.name === 'update_build' && args.buildId
            ? savedBuilds.find((b) => b.id === args.buildId) || null
            : null;

        noteToolGroup(turnGroup, tc.id, {
          name: toolLabel(tc.function.name, args),
          arg: shortToolArg(args),
          status: 'running',
        });
        const started = Date.now();
        const exec = await runAiToolSafe(tc.function.name, args, {
          preconfirmed: preconfirmed && AI_WRITE_TOOLS.has(tc.function.name),
          sessionId: session.id,
        });
        const durationMs = Date.now() - started;
        const toolPayload = exec?.ok ? exec.result : { error: exec?.error || 'tool_failed' };
        noteToolGroup(turnGroup, tc.id, {
          name: toolLabel(tc.function.name, args),
          arg: shortToolArg(args),
          status: exec?.ok ? 'done' : 'error',
          argsText: clipToolText(args, 500),
          resultText: clipToolText(toolPayload, 700),
        });
        updateAiPlanStep(`step_${rounds}_${i}`, exec?.ok ? 'done' : 'error');

        // Контекст чата: select_build обновляет чип UI
        if (
          exec?.ok &&
          (            tc.function.name === 'read_config' ||
            tc.function.name === 'read_hosted_file')
        ) {
          aiTurnReadConfig = true;
        }
        if (exec?.ok && tc.function.name === 'select_build') {
          const selectedId =
            asStringMaybe(args.buildId) ||
            asStringMaybe(
              exec.result && typeof exec.result === 'object'
                ? (exec.result as Record<string, unknown>).id
                : null,
            );
          if (selectedId && savedBuilds.some((b) => b.id === selectedId)) {
            const prevId = session.buildId;
            session.buildId = selectedId;
            if (selectedId !== prevId) {
              const b = savedBuilds.find((x) => x.id === selectedId);
              const label = b
                ? `«${b.name}» (id=${b.id}, ${b.gameVersion || '?'} · ${b.loader || 'vanilla'})`
                : selectedId;
              session.messages.push({
                role: 'user',
                content: `[Контекст] Активная сборка сменена на ${label}. Дальше работай только с ней.`,
              } as any);
            }
            session.updatedAt = Date.now();
            saveAiSessions();
            updateAiBuildChip(session);
            updateAiContextRing(session);
          }
        }

        const fingerprint = JSON.stringify(toolPayload).slice(0, 600);
        const sameResult = seenResult.get(sig) === fingerprint;
        seenResult.set(sig, fingerprint);
        if (!exec?.ok) toolErrorHits.set(sig, (toolErrorHits.get(sig) || 0) + 1);
        else toolErrorHits.delete(sig);
        if (exec?.ok && !sameResult && !isUselessToolPayload(toolPayload)) roundHadProgress = true;

        session.messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: compactAiToolContent(JSON.stringify(toolPayload), AI_WIRE_TOOL_HOT_CHARS),
        });
        answeredToolIds.add(tc.id);

        if (exec?.ok && AI_WRITE_TOOLS.has(tc.function.name)) {
          const payloadObj =
            toolPayload && typeof toolPayload === 'object' ? (toolPayload as Record<string, unknown>) : null;
          const touchedId =
            asStringMaybe(args.buildId) ||
            asStringMaybe(payloadObj?.id) ||
            asStringMaybe(payloadObj?.buildId);
          if (touchedId && tc.function.name !== 'delete_build') {
            markBuildTouchedByAgent(touchedId);
          }
          if (tc.function.name === 'toggle_mod' && args.filename && args.buildId) {
            const filename = String(args.filename);
            const buildId = String(args.buildId);
            const wasEnabled = args.enabled;
            pushAiUndo({
              id: `undo_${Date.now()}`,
              label: `${t('ai.undo')}: ${filename}`,
              at: Date.now(),
              revert: async () => {
                await api?.aiToolsRun?.(
                  'toggle_mod',
                  {
                    buildId,
                    filename,
                    enabled: typeof wasEnabled === 'boolean' ? !wasEnabled : undefined,
                  },
                  { confirmed: true },
                );
              },
            });
            renderAiUndoChip(getAiUiHost());
          }
          if (tc.function.name === 'update_build' && beforeBuild) {
            const snap = {
              name: beforeBuild.name,
              gameVersion: beforeBuild.gameVersion,
              loader: beforeBuild.loader,
              loaderVersion: beforeBuild.loaderVersion,
              javaPath: beforeBuild.javaPath,
              memoryMin: beforeBuild.memory?.min,
              memoryMax: beforeBuild.memory?.max,
            };
            pushAiUndo({
              id: `undo_${Date.now()}`,
              label: `${t('ai.undo')}: ${beforeBuild.name}`,
              at: Date.now(),
              revert: async () => {
                await api?.aiToolsRun?.(
                  'update_build',
                  { buildId: beforeBuild.id, ...snap },
                  { confirmed: true },
                );
                await loadBuilds();
                renderBuilds();
              },
            });
            renderAiUndoChip(getAiUiHost());
            const host = getAiUiHost();
            const diff = renderAiBuildDiff(beforeBuild, { ...beforeBuild, ...args }, host);
            const root = host.getMessagesRoot();
            if (root) {
              const wrap = document.createElement('div');
              wrap.className = 'ai-msg ai-msg--system';
              wrap.innerHTML = `<div class="ai-msg__bubble"></div>`;
              wrap.querySelector('.ai-msg__bubble')?.appendChild(diff);
              root.appendChild(wrap);
              host.scrollToEnd();
            }
          }
          if (
            tc.function.name === 'create_build' ||
            tc.function.name === 'duplicate_build' ||
            tc.function.name === 'update_build' ||
            tc.function.name === 'install_mod' ||
            tc.function.name === 'delete_build'
          ) {
            await loadBuilds();
            const b = savedBuilds.find((x) => x.id === touchedId);
            if (b && (tc.function.name === 'create_build' || tc.function.name === 'duplicate_build')) {
              appendAiBuildPreview(getAiUiHost(), {
                id: b.id,
                name: b.name,
                gameVersion: b.gameVersion,
                loader: b.loader,
                icon: b.icon ? buildIconSrc(b.icon) : undefined,
              });
            } else {
              renderBuilds();
            }
          } else {
            renderBuilds();
          }
        }

        const mods = extractModsFromToolResult(toolPayload);
        if (mods.length) appendAiModCards(mods);
      }
      // Stop / обрыв: закрываем незакрытые tool_calls, иначе следующий запрос падает 400
      for (const tc of toolCalls) {
        if (answeredToolIds.has(tc.id)) continue;
        session.messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify({ error: aiStopRequested ? 'stopped' : 'incomplete' }),
        });
        answeredToolIds.add(tc.id);
      }
      session.messages = sanitizeAiWireMessages(session.messages);
      turnWorkedMs += Date.now() - roundStarted;
      finishToolGroup(turnGroup, turnWorkedMs, 'running');
      commitTurnTrace(session, turnAnchorToolId, turnWorkedMs);
      if (pendingVisibleReply && !aiStopRequested) {
        setAiAgentStatus('streaming');
        await streamAiAssistantText(pendingVisibleReply);
      }
      if (round) {
        endAiRound(round, t('ai.worked', { sec: Math.max(1, Math.round(turnWorkedMs / 1000)) }));
      }
      aiActiveRound = null;
      session.updatedAt = Date.now();
      saveAiSessions();
      updateAiContextRing(session);
      if (aiStopRequested) break;
      if (roundHadProgress) stallRounds = 0;
      else stallRounds += 1;
      if (stallRounds >= 2) needWrap = 'stall';
      else if (rounds >= AI_WRAP_AT) needWrap = 'limit';
      if (needWrap) break;
      continue;
    }

    if (turnGroup) finishToolGroup(turnGroup, turnWorkedMs, 'done');

    if (!result.reply) {
      if (round) endAiRound(round);
      aiActiveRound = null;
      appendAiText('system', t('ai.error', { error: 'empty' }));
      break;
    }
    session.messages.push({ role: 'assistant', content: result.reply });
    setAiAgentStatus('streaming');
    await streamAiAssistantText(result.reply);
    if (round) endAiRound(round);
    aiActiveRound = null;
    session.updatedAt = Date.now();
    saveAiSessions();
    renderAiSessionList();
    updateAiContextRing(session);
    setAiAgentStatus('idle');
    syncAiComposerBusyUi();
    return;
  }
  if (turnGroup) finishToolGroup(turnGroup, turnWorkedMs, 'done');
  aiActiveRound = null;
  if (needWrap || rounds >= AI_MAX_TOOL_ROUNDS) {
    await finishAiTurnWithSummary(session, needWrap || 'limit');
  }
  setAiAgentStatus('idle');
  syncAiComposerBusyUi();
}

function requestAiStop(): void {
  aiStopRequested = true;
  aiStreamGen += 1;
  setAiAgentStatus('idle');
  syncAiComposerBusyUi();
}

const TG_PREAMBLE_RE = /^Запрос из Telegram\.[\s\S]*?Не отказывайся и не проси скриншот\.\s*/;

function visibleUserText(text: string): string {
  const raw = String(text || '').trim();
  if (raw.startsWith('@@pixi ')) return 'Запрос из Telegram';
  const stripped = raw.replace(TG_PREAMBLE_RE, '').trim();
  return stripped || raw;
}

function latestHumanUserText(session: AiSession): string {
  for (let i = session.messages.length - 1; i >= 0; i -= 1) {
    const msg = session.messages[i];
    if (msg.role !== 'user') continue;
    const text = String(msg.content || '');
    if (text.startsWith('[Контекст]')) continue;
    return visibleUserText(text);
  }
  return '';
}

function recentBuildContext(session: AiSession): string {
  const bits: string[] = [];
  for (const msg of session.messages.slice(-12)) {
    if (msg.role !== 'user' && msg.role !== 'assistant') continue;
    const text = visibleUserText(String(msg.content || ''));
    if (!text || text.startsWith('[Контекст]')) continue;
    bits.push(text);
  }
  return bits.join('\n');
}

let hostedFileNote = '';
let aiTurnReadConfig = false;
let hostedBriefs: Array<{
  id: string;
  name: string;
  software?: string;
  gameVersion?: string;
  status?: string;
  publicHost?: string;
  publicPort?: number;
  port?: number;
}> = [];

async function refreshHostedBriefs(): Promise<void> {
  try {
    const list = await api?.hostedServersList?.();
    hostedBriefs = Array.isArray(list) ? list : [];
  } catch {
    hostedBriefs = [];
  }
}

function hostedCatalogNote(): string {
  if (!hostedBriefs.length) {
    return '[Свои серверы (вкладка «Хостинг»): список пуст. Это не папка сборки в .uclient. Повторно вызови list_hosted_servers, прежде чем говорить, что сервера нет.]';
  }
  const lines = hostedBriefs.slice(0, 20).map((server) => {
    const addr =
      server.publicHost && server.publicPort ? `${server.publicHost}:${server.publicPort}` : `порт ${server.port || '?'}`;
    return `- id=${server.id} | ${server.name} | ${server.software || '?'} ${server.gameVersion || '?'} | ${server.status || 'stopped'} | ${addr}`;
  });
  return [
    '[Факт: свои серверы уже есть в лаунчере. Не ищи их в папках сборок и не пиши, что серверов нет.]',
    ...lines,
    'Плагины — list_hosted_plugins. Файлы — list_hosted_files и read_hosted_file. Консоль — hosted_log. id бери только отсюда.',
    hostedFileNote
      ? `Реальные файлы плагинов. Не выдумывай путь и не пиши новый yaml, пока не прочитал один из этих файлов:\n${hostedFileNote}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

async function refreshHostedFileNote(): Promise<void> {
  const chunks: string[] = [];
  for (const server of hostedBriefs.slice(0, 3)) {
    const plugins = (await api?.hostedServersPlugins?.(server.id)) || [];
    const root = await api?.hostedServersFiles?.(server.id, 'plugins');
    const dirs = (root?.entries || []).filter((entry) => entry.dir).slice(0, 40);
    const files: string[] = [];
    for (const dir of dirs) {
      const inner = await api?.hostedServersFiles?.(server.id, `plugins/${dir.name}`);
      for (const file of inner?.entries || []) {
        if (!file.dir && /\.(ya?ml|json|properties|conf|txt)$/i.test(file.name)) {
          files.push(`plugins/${dir.name}/${file.name}`);
        }
      }
    }
    chunks.push(
      `Сервер «${server.name}» id=${server.id}. Плагины: ${plugins.map((plugin) => plugin.name).join(', ') || 'нет'}.\n${files.slice(0, 80).map((file) => `- ${file}`).join('\n') || '- конфигов нет'}`,
    );
  }
  hostedFileNote = chunks.join('\n');
}

function asksOwnHostedServer(text: string): boolean {
  const raw = text.toLowerCase().replace(/ё/g, 'е');
  if (/сборк/.test(raw) && !/сервер/.test(raw)) return false;
  if (/плагин/.test(raw)) return true;
  if (/на\s+сервере/.test(raw)) return true;
  if (/(?:запусти|останови|перезапусти|перезагрузи|рестарт|консол)/.test(raw) && /сервер/.test(raw)) return true;
  return /мо(?:й|его|ем|ём)\s+сервер|сво(?:й|его|ем|ём)\s+сервер|локальн\w*\s+сервер|self-?hosted|хостинг|вкладк\w*\s+хост/.test(raw);
}

function buildsCatalogNote(): string {
  if (!savedBuilds.length) return '[Каталог сборок клиента пуст.]';
  const lines = savedBuilds.slice(0, 48).map((build) => {
    const pack = build.modpackVersion ? ` | модпак ${build.modpackVersion}` : '';
    return `- id=${build.id} | ${build.name} | Minecraft ${build.gameVersion || '?'} | ${build.loader || 'vanilla'}${pack}`;
  });
  const featured = getHomeFeaturedBuild();
  const last = featured
    ? `Последняя сборка, на которой играли: id=${featured.id} | ${featured.name} | Minecraft ${featured.gameVersion || '?'} | ${featured.loader || 'vanilla'}${featured.modpackVersion ? ` | модпак ${featured.modpackVersion}` : ''}. Просьба запустить последнюю — launch_build с этим id.`
    : '';
  return [
    '[Факт: установленные сборки. Не говори, что сборки нет, если она в этом списке. Версия модпака и версия Minecraft — разные поля.]',
    last,
    ...lines,
  ].filter(Boolean).join('\n');
}

function wireWithBuildCatalog(messages: AiWireMessage[]): AiWireMessage[] {
  const prepared = prepareAiWireMessages(messages);
  for (let i = prepared.length - 1; i >= 0; i -= 1) {
    if (prepared[i].role !== 'user') continue;
    const content = String(prepared[i].content || '');
    if (content.includes('[Факт: свои серверы') || content.includes('[Свои серверы (вкладка')) return prepared;
    prepared[i] = { ...prepared[i], content: `${content}\n\n${hostedCatalogNote()}\n\n${buildsCatalogNote()}` };
    break;
  }
  return prepared;
}

function launchCandidates(session: AiSession): Build[] {
  return resolveLaunchBuilds(latestHumanUserText(session), recentBuildContext(session), savedBuilds);
}

function adjustBuildToolArgs(
  name: string,
  args: Record<string, unknown>,
  session: AiSession,
): { args: Record<string, unknown>; blocked?: string } {
  const asked = latestHumanUserText(session);
  if ((name === 'write_config' || name === 'write_hosted_file') && !aiTurnReadConfig) {
    return {
      args,
      blocked:
        'Запись запрещена: реальный конфиг ещё не прочитан. Открой файл из списка плагинов через read_hosted_file или read_config и меняй только его текст. Не выдумывай yaml.',
    };
  }
  if (hostedBriefs.length === 1 && /hosted/.test(name)) {
    const serverId = hostedBriefs[0].id;
    if (!args.id) args = { ...args, id: serverId };
  }
  if (asksOwnHostedServer(asked) && hostedBriefs.length === 1) {
    const serverId = hostedBriefs[0].id;
    if (name === 'read_config' || name === 'write_config' || name === 'list_configs' || name === 'list_build_content') {
      args = { ...args, buildId: serverId, id: serverId };
    }
  }
  if (name === 'launch_build' && isLastPlayedRequest(asked)) {
    const featured = getHomeFeaturedBuild();
    if (featured) return { args: { ...args, buildId: featured.id } };
  }
  if (
    asksOwnHostedServer(asked) &&
    (name === 'get_instance_path' ||
      name === 'list_build_content' ||
      name === 'list_build_mods' ||
      name === 'open_build_folder' ||
      name === 'open_build_subfolder' ||
      name === 'list_servers' ||
      name === 'get_build' ||
      name === 'ensure_instance_dirs')
  ) {
    return {
      args,
      blocked: `${hostedCatalogNote()} Не ищи сервер в инстансе сборки. Вызови list_hosted_servers или инструмент с id из списка.`,
    };
  }
  const matches = launchCandidates(session);
  const named = matchBuildsByName(asked, savedBuilds);
  if (name === 'create_build' && (matches.length || named.length)) {
    const found = matches.length ? matches : named;
    return {
      args,
      blocked: `Сборка уже установлена: ${found.map((build) => formatBuildChoice(build)).join('; ')}. Не создавай новую. Для запуска вызови launch_build с этим id.`,
    };
  }
  if (name === 'launch_build' && isLaunchRequest(asked)) {
    if (matches.length === 1) return { args: { ...args, buildId: matches[0].id } };
    if (matches.length > 1) {
      return {
        args,
        blocked: `Подходят несколько сборок: ${matches.map((build) => formatBuildChoice(build)).join('; ')}. Уточни версию и не запускай другую.`,
      };
    }
    const chosen = String(args.buildId || '');
    if (chosen && savedBuilds.some((build) => build.id === chosen)) return { args };
    if (named.length) {
      return {
        args,
        blocked: `По имени подходят: ${named.map((build) => formatBuildChoice(build)).join('; ')}. Вызови launch_build с id нужной. Не пиши, что сборки нет.`,
      };
    }
  }
  return { args };
}

async function performLaunch(
  session: AiSession,
  build: Build,
  opts: { viaTelegram: boolean; showLine?: string; skipConfirm?: boolean },
): Promise<string> {
  if (opts.showLine) {
    session.messages.push({ role: 'user', content: opts.showLine });
    appendAiText('user', opts.showLine);
    saveAiSessions();
  }
  const label = formatBuildChoice(build);
  const group = mountAiToolGroup();
  const started = Date.now();
  const stepId = `launch_${build.id}`;
  noteToolGroup(group, stepId, { name: 'Запуск сборки', arg: label, status: 'running' });
  let allowed = true;
  if (!opts.skipConfirm) {
    if (opts.viaTelegram) {
      allowed = await askTelegramConfirm(`Запустить сборку — ${label}?`);
    } else {
      setAiAgentStatus('confirm');
      allowed = await askAiConfirmInChat({
        host: getAiUiHost(),
        tool: 'launch_build',
        args: { buildId: build.id },
        risk: 'write',
        sessionId: session.id,
      });
    }
  }
  let reply = 'Запуск отменён.';
  if (allowed) {
    if (runningBuild) {
      reply = `Игра уже запущена: ${runningBuild.name}.`;
    } else {
      await launchBuild(build);
      const live = runningBuild as Build | null;
      reply =
        live?.id === build.id
          ? `Запущено: ${label}.`
          : 'Не удалось запустить сборку. Проверь аккаунт и что игра ещё не запущена.';
    }
  }
  const ok = reply.startsWith('Запущено');
  noteToolGroup(group, stepId, {
    name: 'Запуск сборки',
    arg: label,
    status: ok ? 'done' : 'error',
    argsText: label,
    resultText: reply,
  });
  const workedMs = Date.now() - started;
  finishToolGroup(group, workedMs, ok ? 'done' : 'error');
  session.messages.push({
    role: 'assistant',
    content: reply,
    workedMs,
    toolTrace: aiRoundTrace.map((row) => ({ ...row })),
  });
  appendAiText('assistant', reply);
  saveAiSessions();
  renderAiSessionList();
  return reply;
}

async function answerBuildRequest(session: AiSession, text: string): Promise<boolean> {
  const launch = isLaunchRequest(text) && !isCreateRequest(text);
  if (launch && isLastPlayedRequest(text)) {
    const named = matchBuildsByName(text, savedBuilds);
    const featured = named.length === 1 ? named[0] : named.length === 0 ? getHomeFeaturedBuild() : null;
    if (featured) {
      await performLaunch(session, featured, { viaTelegram: session.source === 'telegram' });
      return true;
    }
  }
  const matches = resolveLaunchBuilds(text, recentBuildContext(session), savedBuilds);
  const named = matchBuildsByName(text, savedBuilds);
  const createExisting = isCreateRequest(text) && (matches.length > 0 || named.length > 0);
  if (!launch && !createExisting) return false;
  if (launch && !matches.length) {
    if (!named.length) return false;
    const reply = `Нашёл сборки с таким именем, но версия не совпала один в один:\n${named
      .map((build) => `• ${formatBuildChoice(build)}`)
      .join('\n')}\nНапиши имя вместе с версией модпака или Minecraft.`;
    session.messages.push({ role: 'assistant', content: reply });
    appendAiText('assistant', reply);
    saveAiSessions();
    return true;
  }
  if (createExisting && !matches.length) {
    const reply = `Такая сборка уже есть:\n${named.map((build) => `• ${formatBuildChoice(build)}`).join('\n')}\nНовую создавать не буду. Напиши «запусти» и версию.`;
    session.messages.push({ role: 'assistant', content: reply });
    appendAiText('assistant', reply);
    saveAiSessions();
    return true;
  }
  if (matches.length > 1) {
    const reply = `Подходят несколько сборок:\n${matches
      .map((build) => `• ${formatBuildChoice(build)}`)
      .join('\n')}\nНапиши имя вместе с версией.`;
    session.messages.push({ role: 'assistant', content: reply });
    appendAiText('assistant', reply);
    saveAiSessions();
    return true;
  }
  await performLaunch(session, matches[0], { viaTelegram: session.source === 'telegram' });
  return true;
}

function collectTelegramReply(session: AiSession | null): string {
  const msgs = session?.messages || [];
  let lastUser = -1;
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    if (msgs[i].role === 'user') {
      lastUser = i;
      break;
    }
  }
  return (
    msgs
      .slice(lastUser + 1)
      .filter((msg) => msg.role === 'assistant' && msg.content)
      .map((msg) => String(msg.content))
      .join('\n\n')
      .trim() || 'Агент завершил шаг без текста.'
  );
}

async function runPixiOp(op: Record<string, unknown>): Promise<string> {
  const kind = String(op.op || '');
  if (kind === 'catalog') {
    return JSON.stringify({
      ok: true,
      builds: savedBuilds.map((build) => ({
        id: build.id,
        name: build.name,
        gameVersion: build.gameVersion,
        loader: build.loader,
        loaderVersion: build.loaderVersion || '',
        modpackVersion: (build as { modpackVersion?: string }).modpackVersion || '',
      })),
    });
  }
  if (kind === 'launch') {
    const session = ensureTelegramAiSession();
    const build = savedBuilds.find((item) => item.id === String(op.buildId || ''));
    if (!build) return 'Сборка не найдена в клиенте.';
    return performLaunch(session, build, {
      viaTelegram: true,
      skipConfirm: op.confirmed === true,
      showLine: visibleUserText(String(op.show || `Запустить сборку ${formatBuildChoice(build)}`)),
    });
  }
  if (kind === 'agent') {
    ensureTelegramAiSession();
    const show = visibleUserText(String(op.show || ''));
    const hint = String(op.hint || '');
    await sendAiMessage(show, hint);
    const session = aiSessions.find((item) => item.source === 'telegram') || activeAiSession();
    return collectTelegramReply(session);
  }
  return 'Неизвестная команда клиента.';
}

async function sendAiMessage(text: string, hint?: string): Promise<void> {
  const input = document.getElementById('ai-input') as HTMLTextAreaElement | null;
  const session = activeAiSession();
  if (!session || aiBusy) return;
  const prompt = text.trim();
  const attachments = [...getAiAttachments()];
  if (!prompt && !attachments.length) return;

  if (!usingCustomAi() && aiConfigured === false) {
    appendAiText('system', t('ai.unavailable'));
    return;
  }
  if (!usingCustomAi() && aiAccessOk === false) {
    handleAiAccessDenied();
    return;
  }

  // Вложения: в чат — badge-ряд, в API — полный блок с текстом логов/файлов
  const attachBlock = formatAiAttachmentsPrompt(attachments);
  const userLine = visibleUserText(prompt);
  const wirePrompt = [attachBlock, userLine].filter(Boolean).join('\n\n') || t('ai.attach.title');
  const titleSource = userLine || attachments.map((a) => a.label).join(', ') || t('ai.attach.title');

  if (!session.messages.length) session.title = titleFromPrompt(titleSource);
  const userMsg: AiWireMessage = { role: 'user', content: wirePrompt };
  if (hint?.trim()) userMsg.hint = hint.trim();
  session.messages.push(userMsg);
  session.updatedAt = Date.now();
  saveAiSessions();
  renderAiSessionList();

  if (input) {
    input.value = '';
    autoResizeAiInput();
  }
  clearAiAttachments();
  closeAiAttachMenu();
  appendAiDayDivider();
  appendAiText('user', userLine, { attachments });
  updateAiContextRing(session);

  aiBusy = true;
  aiStopRequested = false;
  setAiBusySession(session.id);
  try {
    // Лечим уже сохранённую битую историю (Stop / slice / reject)
    session.messages = sanitizeAiWireMessages(session.messages);
    saveAiSessions();
    const handled = (await answerBuildRequest(session, userLine)) || (await answerHostedRequest(session, userLine));
    if (!handled) {
      await ensureAiContextCapacity(session);
      await runAiAgentTurn(session);
    }
  } catch (err: any) {
    appendAiText('system', t('ai.error', { error: err?.message || 'unknown' }));
  } finally {
    aiBusy = false;
    aiStopRequested = false;
    aiActiveRound = null;
    setAiBusySession(null);
    setAiAgentStatus('idle');
    syncAiComposerBusyUi();
    input?.focus();
    const titleEl = document.getElementById('ai-stage-title');
    if (titleEl) titleEl.textContent = session.title;
    updateAiContextRing(session);
    saveAiSessions();
    renderAiSessionList();
    refreshAiShellUi(session);
  }
}

function renderAiBuildMenu(): void {
  const menu = document.getElementById('ai-build-menu');
  const session = activeAiSession();
  if (!menu) return;
  const items = [
    `<button type="button" data-build="" class="${!session?.buildId ? 'active' : ''}">${escapeAiHtml(t('ai.noBuild'))}</button>`,
    ...savedBuilds.map(
      (b) =>
        `<button type="button" data-build="${escapeAiHtml(b.id)}" class="${session?.buildId === b.id ? 'active' : ''}">${escapeAiHtml(b.name)}</button>`,
    ),
  ];
  menu.innerHTML = items.join('');
}

function ensureAiTab(): void {
  if (!aiInited) initAiAssistant();
  renderAiSessionList();
  renderAiConversation();
}

function bindAiActionBridge(): void {
  if (!api?.onAiAction || !api.aiActionResult) return;
  api.onAiAction((msg) => {
    void (async () => {
      let result: unknown = { ok: false, error: 'unknown_action' };
      try {
        const action = String(msg?.action || '');
        const payload = (msg?.payload && typeof msg.payload === 'object' ? msg.payload : {}) as Record<
          string,
          unknown
        >;
        if (action === 'game_status') {
          const detected = !runningBuild && api.detectRunningGame ? await api.detectRunningGame() : null;
          const adopted = Boolean(detected?.ok && detected.running);
          result = {
            ok: true,
            running: Boolean(runningBuild) || adopted,
            buildId: runningBuild?.id || (adopted ? detected?.buildId || null : null),
            name: runningBuild?.name || (adopted ? detected?.name || null : null),
            gameVersion: runningBuild?.gameVersion || (adopted ? detected?.gameVersion || null : null),
            loader: runningBuild?.loader || (adopted ? detected?.loader || null : null),
          };
        } else if (action === 'launch_build') {
          const buildId = String(payload.buildId || '');
          const build = savedBuilds.find((b) => b.id === buildId);
          if (!build) result = { ok: false, error: 'build_not_found' };
          else if (runningBuild) {
            result = { ok: false, error: 'game_already_running', name: runningBuild.name, buildId: runningBuild.id };
          } else {
            const ip = typeof payload.serverIp === 'string' ? payload.serverIp.trim() : '';
            const port = Number(payload.serverPort);
            const server =
              ip
                ? { ip, port: Number.isFinite(port) && port > 0 ? port : 25565 }
                : undefined;
            await launchBuild(build, server);
            const live = runningBuild as Build | null;
            const started = live?.id === build.id;
            result = started
              ? { ok: true, launched: true, buildId, name: build.name }
              : { ok: false, error: 'launch_not_started' };
          }
        } else if (action === 'install_java') {
          const version = Number(payload.version);
          result = api.installJava ? await api.installJava(version) : { success: false, error: 'unavailable' };
        } else if (action === 'remove_java') {
          const version = Number(payload.version);
          result = api.removeJava ? await api.removeJava(version) : { success: false, error: 'unavailable' };
        } else if (action === 'create_instance_share') {
          const buildId = String(payload.buildId || '');
          const authorName = typeof payload.authorName === 'string' ? payload.authorName : undefined;
          result = api.createInstanceShare
            ? await api.createInstanceShare(buildId, authorName ? { authorName } : undefined)
            : { ok: false, error: 'unavailable' };
        } else if (action === 'import_instance_share') {
          const shareId = String(payload.shareId || payload.id || '');
          result = api.importInstanceShare
            ? await api.importInstanceShare(shareId)
            : { ok: false, error: 'unavailable' };
          if ((result as any)?.ok && (result as any)?.build) {
            const b = (result as any).build;
            const idx = savedBuilds.findIndex((x) => x.id === b.id);
            if (idx >= 0) savedBuilds[idx] = b;
            else savedBuilds.push(b);
            renderBuilds();
          }
        } else if (action === 'list_server_catalog') {
          const list = api.fetchServerCatalog ? await api.fetchServerCatalog() : [];
          result = { ok: true, servers: Array.isArray(list) ? list.slice(0, 40) : [] };
        } else if (action === 'get_console_tail') {
          const limit = Math.min(200, Math.max(1, Number(payload.limit) || 40));
          const hist = api.getConsoleHistory ? await api.getConsoleHistory() : [];
          result = { ok: true, events: Array.isArray(hist) ? hist.slice(-limit) : [] };
        } else if (action === 'open_console') {
          await api.openConsole?.();
          result = { ok: true };
        } else if (action === 'launch_updater') {
          result = api.launchUpdater ? await api.launchUpdater() : { success: false, error: 'unavailable' };
        } else if (action === 'switch_account') {
          const uuid = String(payload.uuid || '').trim();
          const username = String(payload.username || '').trim();
          const accounts = api.loadAccounts ? await api.loadAccounts() : [];
          const found = (accounts || []).find(
            (a: any) =>
              (uuid && String(a.uuid || a.id || '') === uuid) ||
              (username && String(a.name || a.username || '').toLowerCase() === username.toLowerCase()),
          );
          if (!found) result = { ok: false, error: 'account_not_found' };
          else {
            await selectAccount(found);
            result = {
              ok: true,
              uuid: found.uuid || found.id || null,
              username: found.name || found.username || null,
            };
          }
        }
      } catch (e: any) {
        result = { ok: false, error: e?.message || 'action_failed' };
      }
      api.aiActionResult?.({ id: msg.id, result });
    })();
  });
}

let tgToastTimer = 0;
let agentBridgeStarted = false;
let tgPendingCode = '';
let tgLinkSeenAt = 0;
let tgFootTimer = 0;
let agentBridgeBusy = false;
let tgActiveJobId = '';
const TG_CONFIRM_MS = 70 * 1000;

function sessionById(id?: string | null): AiSession | null {
  if (!id) return activeAiSession();
  return aiSessions.find((s) => s.id === id) || null;
}

/** Опасное действие из Telegram: кнопки в боте, без модалки на ПК. */
async function askTelegramConfirm(text: string): Promise<boolean> {
  const summary = String(text || 'Выполнить действие в лаунчере').trim();
  const question = summary.endsWith('?') ? summary : `${summary}?`;
  const opened = await agentBridgeRequest('/confirm', 'POST', {
    jobId: tgActiveJobId,
    text: question.slice(0, 400),
  });
  const id = String(opened?.data?.id || '');
  if (!opened?.ok || !id) return false;
  const deadline = Date.now() + TG_CONFIRM_MS;
  while (Date.now() < deadline) {
    if (aiStopRequested) return false;
    const res = await agentBridgeRequest(`/confirm/${encodeURIComponent(id)}`, 'GET');
    const status = String(res?.data?.status || '');
    if (status === 'yes') return true;
    if (status === 'no' || status === 'timeout') return false;
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  return false;
}

function showTgAgentToast(ms = 4500): void {
  const el = document.getElementById('tb-agent-tg');
  if (!el) return;
  el.hidden = false;
  window.clearTimeout(tgToastTimer);
  tgToastTimer = window.setTimeout(() => {
    el.hidden = true;
  }, ms);
}

function agentBridgeRequest(path: string, method = 'GET', body?: unknown) {
  return api?.messengerRequest?.({ path: `/agent-bridge${path}`, method, body });
}

function ensureTelegramAiSession(): AiSession {
  ensureAiTab();
  let session = aiSessions.find((s) => s.source === 'telegram');
  if (!session) {
    let folder = aiFolders.find((f) => f.name === 'Telegram');
    if (!folder) {
      folder = { id: aiUid(), name: 'Telegram' };
      aiFolders.unshift(folder);
    }
    session = createAiSession(false, { title: 'Telegram', folderId: folder.id, source: 'telegram' });
  }
  aiActiveId = session.id;
  saveAiSessions();
  renderAiSessionList();
  renderAiConversation();
  return session;
}

async function runTelegramAgentJob(job: { id: string; text: string }): Promise<void> {
  showTgAgentToast(5000);
  const text = String(job.text || '').trim();
  if (text.startsWith('@@pixi ')) {
    let op: Record<string, unknown> = {};
    try {
      op = JSON.parse(text.slice('@@pixi '.length));
    } catch {
      await agentBridgeRequest('/result', 'POST', { id: job.id, reply: 'Не понял команду клиента.' });
      return;
    }
    if (aiBusy) {
      await agentBridgeRequest('/result', 'POST', {
        id: job.id,
        reply: 'Агент клиента сейчас занят другим запросом. Повтори чуть позже.',
      });
      return;
    }
    const kind = String(op.op || '');
    if (kind === 'agent') {
      if (aiAccessOk == null) await refreshAiAccessStatus();
      if (!usingCustomAi() && aiAccessOk === false) {
        await agentBridgeRequest('/result', 'POST', {
          id: job.id,
          reply: 'У этого аккаунта нет доступа к агенту в клиенте.',
        });
        return;
      }
    }
    tgActiveJobId = String(job.id || '');
    if (kind === 'launch') {
      aiBusy = true;
      setAiBusySession(ensureTelegramAiSession().id);
    }
    try {
      const reply = await runPixiOp(op);
      await agentBridgeRequest('/result', 'POST', { id: job.id, reply });
    } finally {
      tgActiveJobId = '';
      if (kind === 'launch') {
        aiBusy = false;
        setAiBusySession(null);
        setAiAgentStatus('idle');
      }
    }
    return;
  }
  if (!text) {
    await agentBridgeRequest('/result', 'POST', { id: job.id, reply: 'Пустой запрос.' });
    return;
  }
  if (aiBusy) {
    await agentBridgeRequest('/result', 'POST', {
      id: job.id,
      reply: 'Агент клиента сейчас занят другим запросом. Повтори чуть позже.',
    });
    return;
  }
  if (aiAccessOk == null) await refreshAiAccessStatus();
  if (!usingCustomAi() && aiAccessOk === false) {
    await agentBridgeRequest('/result', 'POST', {
      id: job.id,
      reply: 'У этого аккаунта нет доступа к агенту в клиенте.',
    });
    return;
  }
  showTgAgentToast(1800);
  ensureTelegramAiSession();
  tgActiveJobId = String(job.id || '');
  try {
    await sendAiMessage(text);
  } finally {
    tgActiveJobId = '';
  }
  const session = aiSessions.find((s) => s.source === 'telegram') || activeAiSession();
  const msgs = session?.messages || [];
  let lastUser = -1;
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    if (msgs[i].role === 'user') {
      lastUser = i;
      break;
    }
  }
  const parts = msgs
    .slice(lastUser + 1)
    .filter((m) => m.role === 'assistant' && m.content)
    .map((m) => String(m.content));
  const reply = parts.join('\n\n').trim() || 'Агент завершил шаг без текста.';
  await agentBridgeRequest('/result', 'POST', { id: job.id, reply });
}

async function pollAgentBridge(): Promise<void> {
  if (agentBridgeBusy) return;
  const res = await agentBridgeRequest('/poll');
  if (!res?.ok) return;
  const jobs = Array.isArray(res.data?.jobs) ? res.data.jobs : [];
  if (!jobs.length) return;
  agentBridgeBusy = true;
  try {
    for (const job of jobs) {
      if (!job?.id) continue;
      await runTelegramAgentJob({ id: String(job.id), text: String(job.text || '') });
    }
  } finally {
    agentBridgeBusy = false;
  }
}

function armTelegramFootTimer(ms: number): void {
  window.clearInterval(tgFootTimer);
  tgFootTimer = window.setInterval(() => {
    void refreshAiTelegramFoot();
  }, ms);
}

function startAgentTelegramBridge(): void {
  if (agentBridgeStarted) return;
  agentBridgeStarted = true;
  window.setInterval(() => {
    void agentBridgeRequest('/heartbeat', 'POST', {});
  }, 8000);
  window.setInterval(() => {
    void pollAgentBridge();
  }, 3000);
  void agentBridgeRequest('/heartbeat', 'POST', {});
  void refreshAiTelegramFoot();
  // Пока код на экране — чаще, чтобы модалка закрылась сразу после ответа бота.
  armTelegramFootTimer(4000);
}

function telegramPhotoSrc(data: { photoUrl?: string; photoDataUrl?: string } | null): string {
  const remote = String(data?.photoUrl || '').trim();
  if (remote.startsWith('https://') || remote.startsWith('http://')) return remote;
  if (remote.startsWith('/')) return absoluteApiUrl(remote);
  const inline = String(data?.photoDataUrl || '').trim();
  if (inline.startsWith('data:image/')) return inline;
  return '';
}

function renderAiTelegramFoot(data: {
  linked?: boolean;
  username?: string;
  firstName?: string;
  lastName?: string;
  telegramUserId?: string;
  photoUrl?: string;
  photoDataUrl?: string;
  linkedAt?: number;
  claimedCode?: string;
} | null): void {
  const bind = document.getElementById('ai-tg-bind');
  const user = document.getElementById('ai-tg-user');
  const avatar = document.getElementById('ai-tg-avatar');
  const display = document.getElementById('ai-tg-display');
  const handle = document.getElementById('ai-tg-handle');
  if (!bind || !user || !avatar || !display || !handle) return;
  const linked = Boolean(data?.linked);
  bind.classList.toggle('hidden', linked);
  user.classList.toggle('hidden', !linked);
  if (!linked) {
    avatar.replaceChildren();
    avatar.style.backgroundImage = '';
    display.textContent = '';
    handle.textContent = '';
    return;
  }
  const username = String(data?.username || '').replace(/^@/, '').trim();
  const id = String(data?.telegramUserId || '').trim();
  const fullName = [data?.firstName, data?.lastName].map((part) => String(part || '').trim()).filter(Boolean).join(' ');
  display.textContent = fullName || username || id;
  handle.textContent = username ? `@${username}` : id;
  const letter = (fullName || username || id || '?').charAt(0).toUpperCase();
  const src = telegramPhotoSrc(data || null);
  const currentImg = avatar.querySelector('img');
  const currentSrc = currentImg?.getAttribute('src') || '';
  if (src && currentSrc === src) return;
  if (!src && !currentImg && avatar.textContent === letter) return;
  avatar.replaceChildren();
  avatar.style.backgroundImage = '';
  if (!src) {
    avatar.textContent = letter;
    return;
  }
  const img = document.createElement('img');
  img.alt = '';
  img.referrerPolicy = 'no-referrer';
  img.src = src;
  img.addEventListener('error', () => {
    if (!avatar.contains(img)) return;
    avatar.replaceChildren();
    avatar.textContent = letter;
  });
  avatar.appendChild(img);
}

async function refreshAiTelegramFoot(): Promise<void> {
  const res = await agentBridgeRequest('/status');
  if (!res?.ok) return;
  const data = (res.data || {}) as {
    linked?: boolean;
    username?: string;
    firstName?: string;
    lastName?: string;
    telegramUserId?: string;
    photoUrl?: string;
    photoDataUrl?: string;
    linkedAt?: number;
    claimedCode?: string;
  };
  renderAiTelegramFoot(data);
  const modal = document.getElementById('modal-tg-link');
  const modalOpen = Boolean(modal && !modal.classList.contains('hidden'));
  if (!modalOpen) {
    if (tgPendingCode) {
      tgPendingCode = '';
      armTelegramFootTimer(4000);
    }
    return;
  }
  if (!tgPendingCode) return;
  const claimed = String(data.claimedCode || '').trim().toUpperCase();
  const linkedAt = Number(data.linkedAt || 0);
  const sameCode = claimed === tgPendingCode.toUpperCase();
  const newerLink = Boolean(data.linked) && linkedAt > tgLinkSeenAt && tgLinkSeenAt > 0;
  if (sameCode || newerLink) {
    tgPendingCode = '';
    closeModal('modal-tg-link');
    armTelegramFootTimer(4000);
  }
}

function showLinkCode(code: string): void {
  const el = document.getElementById('modal-tg-link-code');
  if (!el) return;
  el.classList.remove('is-wait');
  el.dataset.code = code;
  el.replaceChildren();
  [...code].forEach((ch, index) => {
    const span = document.createElement('span');
    span.className = 'ai-tg-link__ch';
    span.style.animationDelay = `${index * 55}ms`;
    span.textContent = ch;
    el.appendChild(span);
  });
}

async function openTelegramLinkModal(): Promise<void> {
  openModal('modal-tg-link');
  const hint = document.getElementById('modal-tg-link-hint');
  const codeEl = document.getElementById('modal-tg-link-code');
  if (hint) hint.textContent = t('ai.tg.bindHint');
  if (codeEl) {
    delete codeEl.dataset.code;
    codeEl.classList.add('is-wait');
    codeEl.replaceChildren();
  }
  tgPendingCode = '';
  await warmMessengerSession();
  const before = await agentBridgeRequest('/status');
  tgLinkSeenAt = before?.ok ? Number(before.data?.linkedAt || 0) : 0;
  const issued = await agentBridgeRequest('/code', 'POST', {});
  const code = String(issued?.data?.code || '').trim();
  if (!issued?.ok || !code) {
    if (codeEl) {
      codeEl.classList.remove('is-wait');
      codeEl.textContent = issued?.ok === false && issued?.code === 'unauthorized'
        ? t('ai.tg.needAccount')
        : t('ai.tg.codeFail');
    }
    return;
  }
  showLinkCode(code);
  tgPendingCode = code;
  armTelegramFootTimer(1500);
}

function bindTelegramLinkModal(): void {
  document.getElementById('modal-tg-link-close')?.addEventListener('click', () => closeModal('modal-tg-link'));
  document.getElementById('modal-tg-link')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal('modal-tg-link');
  });
  document.getElementById('modal-tg-link-refresh')?.addEventListener('click', () => {
    void openTelegramLinkModal();
  });
  document.getElementById('modal-tg-link-copy')?.addEventListener('click', () => {
    const host = document.getElementById('modal-tg-link-code');
    const code = String(host?.dataset.code || host?.textContent || '').trim();
    if (!code || code.includes('·')) return;
    void navigator.clipboard.writeText(code).catch(() => {});
  });
  document.getElementById('ai-tg-bind')?.addEventListener('click', () => {
    void openTelegramLinkModal();
  });
  document.getElementById('ai-tg-unlink')?.addEventListener('click', () => {
    void (async () => {
      await agentBridgeRequest('/unlink', 'POST', {});
      await refreshAiTelegramFoot();
    })();
  });
}

type AiSuggestItem = { id: string; title: string; hint: string };
let aiSuggestItems: AiSuggestItem[] = [];
let aiSuggestIndex = 0;
let aiSuggestMode: 'slash' | 'mention' | null = null;
let aiMentionFiles: AiSuggestItem[] = [];
let aiMentionBuildId = '';

function closeAiSuggest(): void {
  aiSuggestMode = null;
  aiSuggestItems = [];
  document.getElementById('ai-suggest')?.classList.add('hidden');
}

function ensureAiSuggest(): HTMLElement {
  let menu = document.getElementById('ai-suggest');
  if (menu) return menu;
  menu = document.createElement('div');
  menu.id = 'ai-suggest';
  menu.className = 'ai-suggest hidden';
  menu.addEventListener('click', (e) => {
    e.stopPropagation();
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-suggest]');
    if (!btn?.dataset.suggest) return;
    void runAiSuggest(btn.dataset.suggest);
  });
  document.documentElement.appendChild(menu);
  return menu;
}

function tokenAtCursor(input: HTMLTextAreaElement): { kind: 'slash' | 'mention'; query: string; start: number } | null {
  const pos = input.selectionStart ?? input.value.length;
  const before = input.value.slice(0, pos);
  const slash = before.match(/(?:^|\s)\/([^\s]*)$/);
  if (slash) return { kind: 'slash', query: slash[1] || '', start: pos - (slash[1] || '').length - 1 };
  const at = before.match(/(?:^|\s)@([^\s]*)$/);
  if (at) return { kind: 'mention', query: at[1] || '', start: pos - (at[1] || '').length - 1 };
  return null;
}

function replaceActiveToken(text: string): void {
  const input = document.getElementById('ai-input') as HTMLTextAreaElement | null;
  if (!input) return;
  const mark = tokenAtCursor(input);
  if (!mark) return;
  const pos = input.selectionStart ?? input.value.length;
  input.value = `${input.value.slice(0, mark.start)}${text}${input.value.slice(pos)}`;
  const caret = mark.start + text.length;
  input.setSelectionRange(caret, caret);
  autoResizeAiInput();
}

function slashCommands(): AiSuggestItem[] {
  return [
    { id: 'slash:new', title: 'Новый чат', hint: '/new' },
    { id: 'slash:clear', title: 'Очистить чат', hint: '/clear' },
    { id: 'slash:folder', title: 'Новая папка', hint: '/folder' },
    { id: 'slash:search', title: 'Поиск по чатам', hint: '/search' },
    { id: 'slash:telegram', title: 'Привязать Telegram', hint: '/telegram' },
    { id: 'slash:tools', title: 'Показать инструменты', hint: '/tools' },
  ];
}

async function refreshMentionFiles(buildId: string): Promise<void> {
  if (!buildId || !api?.scanInstance) {
    aiMentionFiles = [];
    aiMentionBuildId = '';
    return;
  }
  if (aiMentionBuildId === buildId) return;
  aiMentionBuildId = buildId;
  try {
    const data = await api.scanInstance(buildId);
    aiMentionFiles = (data?.mods || [])
      .slice(0, 24)
      .map((m: any) => {
        const filename = String(m.filename || m.file || m.name || '');
        return { id: `file:${filename}`, title: String(m.name || filename), hint: filename };
      })
      .filter((row: AiSuggestItem) => row.hint);
  } catch {
    aiMentionFiles = [];
  }
  if (aiSuggestMode === 'mention') syncAiSuggest();
}

function syncAiSuggest(): void {
  const input = document.getElementById('ai-input') as HTMLTextAreaElement | null;
  if (!input) return;
  const token = tokenAtCursor(input);
  if (!token) {
    closeAiSuggest();
    return;
  }
  closeAiPopovers('ai-suggest');
  const q = token.query.toLowerCase();
  let items: AiSuggestItem[] = [];
  if (token.kind === 'slash') {
    items = slashCommands().filter((item) => !q || `${item.title} ${item.hint}`.toLowerCase().includes(q));
  } else {
    const session = activeAiSession();
    const builds = savedBuilds.map((b) => ({
      id: `build:${b.id}`,
      title: b.name,
      hint: [b.gameVersion, b.loader].filter(Boolean).join(' · ') || 'сборка',
    }));
    const current = session?.buildId ? builds.filter((b) => b.id === `build:${session.buildId}`) : [];
    items = [...current, ...builds.filter((b) => !current.some((c) => c.id === b.id)), ...aiMentionFiles];
    items = items.filter((item) => !q || `${item.title} ${item.hint}`.toLowerCase().includes(q)).slice(0, 12);
    if (session?.buildId) void refreshMentionFiles(session.buildId);
  }
  aiSuggestMode = token.kind;
  aiSuggestItems = items;
  aiSuggestIndex = Math.max(0, Math.min(aiSuggestIndex, Math.max(0, items.length - 1)));
  const menu = ensureAiSuggest();
  if (!items.length) {
    menu.classList.add('hidden');
    return;
  }
  menu.innerHTML = items
    .map(
      (item, i) =>
        `<button type="button" class="ai-suggest__row${i === aiSuggestIndex ? ' is-on' : ''}" data-suggest="${escapeAiHtml(item.id)}"><span>${escapeAiHtml(item.title)}</span><span class="ai-suggest__hint">${escapeAiHtml(item.hint)}</span></button>`,
    )
    .join('');
  menu.classList.remove('hidden');
  placeAiFloating(menu, input, 'up');
}

function moveAiSuggest(delta: number): void {
  if (!aiSuggestItems.length) return;
  aiSuggestIndex = (aiSuggestIndex + delta + aiSuggestItems.length) % aiSuggestItems.length;
  syncAiSuggest();
}

async function showAiToolNames(): Promise<void> {
  const data = await api?.aiToolsList?.();
  const names = Array.isArray(data?.names) ? data.names.map((name) => String(name)) : [];
  const lines = names.slice(0, 28).map((name) => `• ${toolLabel(name)} — ${name}`);
  appendAiText(
    'system',
    lines.length ? `Инструменты агента:\n${lines.join('\n')}` : 'Список инструментов сейчас недоступен.',
  );
}

async function runAiSuggest(id: string): Promise<void> {
  closeAiSuggest();
  if (id.startsWith('slash:')) replaceActiveToken('');
  if (id === 'slash:new') {
    document.getElementById('ai-new-chat')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return;
  }
  if (id === 'slash:clear') {
    document.getElementById('ai-menu-clear')?.click();
    return;
  }
  if (id === 'slash:folder') {
    document.getElementById('ai-new-folder')?.click();
    return;
  }
  if (id === 'slash:search') {
    document.querySelector('.ai-shell')?.classList.add('is-rail-open');
    document.getElementById('ai-search-toggle')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return;
  }
  if (id === 'slash:telegram') {
    await openTelegramLinkModal();
    return;
  }
  if (id === 'slash:tools') {
    await showAiToolNames();
    return;
  }
  if (id.startsWith('build:')) {
    const buildId = id.slice('build:'.length);
    const build = savedBuilds.find((b) => b.id === buildId);
    const session = activeAiSession();
    if (!build || !session) return;
    session.buildId = build.id;
    session.updatedAt = Date.now();
    saveAiSessions();
    updateAiBuildChip(session);
    pushAiAttachment({
      kind: 'build',
      label: build.name,
      buildId: build.id,
      detail: [build.gameVersion, build.loader].filter(Boolean).join(' · '),
    });
    replaceActiveToken(`@${build.name} `);
    return;
  }
  if (id.startsWith('file:')) {
    const filename = id.slice('file:'.length);
    const session = activeAiSession();
    if (!filename || !session?.buildId) return;
    pushAiAttachment({
      kind: 'mod',
      label: filename.replace(/\.(jar|zip)$/i, ''),
      filename,
      buildId: session.buildId,
    });
    replaceActiveToken(`@${filename} `);
  }
}

function initAiAssistant(): void {
  if (aiInited) return;
  const form = document.getElementById('ai-form') as HTMLFormElement | null;
  const input = document.getElementById('ai-input') as HTMLTextAreaElement | null;
  const newBtn = document.getElementById('ai-new-chat');
  if (!form || !input) return;
  aiInited = true;

  bindAiActionBridge();
  bindTelegramLinkModal();
  startAgentTelegramBridge();

  loadAiSessions();
  renderAiEmptyScenarios(getAiUiHost());
  renderAiSessionList();
  renderAiConversation();
  refreshAiShellUi(activeAiSession());

  onAiStop(() => requestAiStop());

  document.getElementById('ai-send')?.addEventListener('click', (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    if (!btn.classList.contains('is-stop')) return;
    e.preventDefault();
    e.stopPropagation();
    requestAiStop();
  });

  // Выбор модели сохраняется локально и уходит в запрос как pixi-1.0 / pixi-1.5.
  syncAiModelButton();
  void api?.getAppVersion?.().then((v) => {
    if (!v) return;
    appVersion = String(v);
  });

  const verBtn = document.getElementById('ai-agent-ver');
  verBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleAiModelMenu();
  });
  document.getElementById('ai-model-menu')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const info = (e.target as HTMLElement).closest<HTMLElement>('[data-model-info]');
    if (info?.dataset.modelInfo) {
      const card = document.querySelector<HTMLElement>(
        `.ai-model-menu__card[data-card="${info.dataset.modelInfo}"]`,
      );
      if (card) card.hidden = !card.hidden;
      positionAiModelMenu();
      return;
    }
    const choice = (e.target as HTMLElement).closest<HTMLElement>('[data-model]');
    const id = choice?.dataset.model;
    if (id === 'pixi-1.0' || id === 'pixi-1.5' || id === 'custom') {
      setCurrentAiModel(id);
      setAiModelMenuOpen(false);
    }
  });
  window.addEventListener('resize', () => {
    if (window.innerWidth > 1040) document.querySelector('.ai-shell')?.classList.remove('is-rail-open');
    const menu = document.getElementById('ai-model-menu');
    const anchor = document.getElementById('ai-agent-ver');
    if (menu?.classList.contains('is-open') && anchor) placeAiFloating(menu, anchor, 'up');
    for (const id of ['ai-chat-menu-pop', 'ai-build-menu', 'ai-attach-menu', 'ai-context-menu', 'ai-suggest']) {
      const pop = document.getElementById(id);
      if (!pop || pop.classList.contains('hidden') || !pop.classList.contains('is-open') && id !== 'ai-suggest') continue;
      const button =
        id === 'ai-chat-menu-pop'
          ? document.getElementById('ai-chat-menu')
          : id === 'ai-build-menu'
            ? document.getElementById('ai-build-btn')
            : id === 'ai-attach-menu'
              ? document.getElementById('ai-attach')
              : id === 'ai-context-menu'
                ? document.getElementById('ai-context-ring')
                : document.getElementById('ai-input');
      if (button && !pop.classList.contains('hidden')) {
        placeAiFloating(pop, button, id === 'ai-chat-menu-pop' ? 'down' : 'up');
      }
    }
  });

  document.getElementById('ai-rail-toggle')?.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelector('.ai-shell')?.classList.toggle('is-rail-open');
  });

  newBtn?.addEventListener('click', () => {
    createAiSession(true);
    clearAiAttachments();
    closeAiAttachMenu();
    renderAiSessionList();
    renderAiConversation();
    refreshAiShellUi(activeAiSession());
    input.focus();
  });

  document.getElementById('ai-new-folder')?.addEventListener('click', () => {
    const folder: AiFolder = { id: aiUid(), name: t('ai.folder.new') };
    aiFolders.unshift(folder);
    saveAiSessions();
    renderAiSessionList();
    const created = document.querySelector<HTMLButtonElement>(
      `.ai-folder__name[data-folder-id="${folder.id}"]`,
    );
    if (created) beginAiFolderRename(folder.id, created);
  });

  document.getElementById('ai-menu-move')?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-move-folder]');
    if (!btn) return;
    const session = activeAiSession();
    if (!session) return;
    const folderId = btn.getAttribute('data-move-folder') || '';
    session.folderId = folderId || null;
    saveAiSessions();
    renderAiSessionList();
    closeAiPopovers();
  });

  // ===== Меню вложений (@) — сборки, моды, паки, файлы, логи =====
  initAiAttachUi({
    ...getAiUiHost(),
    getBuilds: () =>
      savedBuilds.map((b) => ({
        id: b.id,
        name: b.name,
        gameVersion: b.gameVersion || '',
        loader: b.loader || '',
        iconSrc: b.icon
          ? buildIconSrc(b.icon).replace(/\\/g, '/')
          : DEFAULT_BUILD_ICON_SRC,
        iconBg: b.iconBg,
      })),
    getSessionBuildId: () => activeAiSession()?.buildId || null,
    scanBuildContent: async (buildId) => {
      if (!api?.scanInstance) return null;
      try {
        const data = await api.scanInstance(buildId);
        return {
          mods: (data?.mods || []).map((m: any) => ({ filename: m.filename || m.file || m.name, name: m.name || m.title })),
          resourcepacks: (data?.resourcepacks || []).map((m: any) => ({ filename: m.filename || m.file || m.name, name: m.name || m.title })),
          shaders: (data?.shaders || []).map((m: any) => ({ filename: m.filename || m.file || m.name, name: m.name || m.title })),
          datapacks: (data?.datapacks || []).map((m: any) => ({ filename: m.filename || m.file || m.name, name: m.name || m.title })),
        };
      } catch {
        return null;
      }
    },
    pickFiles: async () => (api?.pickFiles ? await api.pickFiles() : []),
    readAttachFile: async (filePath) => (api?.readAttachFile ? await api.readAttachFile(filePath) : null),
    getCrashLog: async (buildId) => (api?.getCrashReport ? await api.getCrashReport(buildId) : null),
    getLatestLog: async (buildId) => {
      if (!api?.getInstancePath || !api?.readAttachFile) return null;
      try {
        const root = await api.getInstancePath(buildId);
        if (!root) return null;
        const read = await api.readAttachFile(joinInstancePath(root, 'logs', 'latest.log'));
        return read?.text || null;
      } catch {
        return null;
      }
    },
    closeOtherPopovers: () => closeAiPopovers('ai-attach-menu'),
    onMenuPlace: (menu, anchor) => placeAiFloating(menu, anchor, 'up'),
    onAttachmentsChange: () => {
      /* чипы рисует attach-ui */
    },
  });

  document.getElementById('ai-search-toggle')?.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelector('.ai-shell')?.classList.add('is-rail-open');
    const search = document.getElementById('ai-search') as HTMLInputElement | null;
    if (!search) return;
    search.classList.toggle('hidden');
    if (!search.classList.contains('hidden')) search.focus();
    else {
      aiSearchQuery = '';
      search.value = '';
      renderAiSessionList();
    }
  });

  document.getElementById('ai-search')?.addEventListener('input', (e) => {
    aiSearchQuery = (e.target as HTMLInputElement).value || '';
    renderAiSessionList();
  });

  input.addEventListener('input', () => {
    autoResizeAiInput();
    aiSuggestIndex = 0;
    syncAiSuggest();
  });
  autoResizeAiInput();
  input.addEventListener('keydown', (e) => {
    if (aiSuggestMode && aiSuggestItems.length) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeAiSuggest();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveAiSuggest(1);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveAiSuggest(-1);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const item = aiSuggestItems[aiSuggestIndex];
        if (item) void runAiSuggest(item.id);
        return;
      }
    }
    if (e.key === 'Escape') closeAiSuggest();
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void sendAiMessage(input.value);
  });

  document.getElementById('ai-empty-prompts')?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.ai-prompt');
    if (!btn) return;
    const key = btn.dataset.promptKey;
    void sendAiMessage(key ? t(key) : btn.textContent || '');
  });

  document.getElementById('ai-messages')?.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('a');
    if (a) {
      const href = a.getAttribute('href');
      if (href) {
        e.preventDefault();
        api?.openExternal?.(href);
      }
      return;
    }
    const card = (e.target as HTMLElement).closest<HTMLElement>('.ai-mod-card');
    if (card?.dataset.modId) {
      const id = card.dataset.modSlug || card.dataset.modId;
      void openModalDetails(id);
    }
  });

  document.getElementById('ai-build-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = document.getElementById('ai-build-menu');
    const willOpen = !menu?.classList.contains('is-open');
    closeAiPopovers(willOpen ? 'ai-build-menu' : undefined);
    setAiBuildMenuOpen(!!willOpen);
  });

  document.getElementById('ai-build-menu')?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-build]');
    if (!btn) return;
    const session = activeAiSession();
    if (!session) return;
    const nextId = btn.dataset.build || null;
    const prevId = session.buildId;
    session.buildId = nextId;
    // Явная смена контекста в истории — модель не должна цепляться за старую сборку
    if (nextId && nextId !== prevId) {
      const b = savedBuilds.find((x) => x.id === nextId);
      const label = b
        ? `«${b.name}» (id=${b.id}, ${b.gameVersion || '?'} · ${b.loader || 'vanilla'})`
        : nextId;
      session.messages.push({
        role: 'user',
        content: `[Контекст] Активная сборка сменена на ${label}. Дальше работай только с ней; не ссылайся на предыдущие сборки, пока я сам их не назову.`,
      } as any);
    }
    session.updatedAt = Date.now();
    saveAiSessions();
    updateAiBuildChip(session);
    updateAiContextRing(session);
    setAiBuildMenuOpen(false);
  });

  document.getElementById('ai-context-ring')?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleAiContextMenu();
  });

  document.getElementById('ai-context-menu')?.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  document.getElementById('ai-chat-menu')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = document.getElementById('ai-chat-menu-pop');
    const willOpen = !menu?.classList.contains('is-open');
    closeAiPopovers(willOpen ? 'ai-chat-menu-pop' : undefined);
    setAiChatMenuOpen(willOpen);
  });

  document.getElementById('ai-chat-menu-pop')?.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  document.getElementById('ai-menu-delete')?.addEventListener('click', () => {
    const session = activeAiSession();
    if (session) deleteAiSession(session.id);
    closeAiPopovers();
  });

  document.getElementById('ai-menu-clear')?.addEventListener('click', () => {
    const session = activeAiSession();
    if (!session) return;
    session.messages = [];
    session.title = t('ai.newChatTitle');
    session.updatedAt = Date.now();
    saveAiSessions();
    renderAiSessionList();
    renderAiConversation();
    closeAiPopovers();
  });

  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest('#ai-suggest, #ai-input, #ai-model-menu, #ai-chat-menu-pop, #ai-build-menu, #ai-attach-menu, #ai-context-menu, #ai-agent-ver, #ai-chat-menu, #ai-build-btn, #ai-attach, #ai-context-ring')) {
      return;
    }
    closeAiPopovers();
  });

  void api?.aiStatus?.().then((status) => {
    // Может прийти до warmMessengerSession — не затираем true, если статус уже ок
    aiConfigured = status?.configured !== false;
    if (status?.access) aiAccessOk = true;
    else if (aiAccessOk == null) aiAccessOk = false;
  });
}

let aiAccessSettingsBound = false;

function fillAiProviderModels(models: string[], selected: string): void {
  const select = document.getElementById('setting-ai-provider-model') as HTMLSelectElement | null;
  if (!select) return;
  const list = models.length ? models : selected ? [selected] : [];
  select.innerHTML = list
    .map((id) => `<option value="${escapeAiHtml(id)}">${escapeAiHtml(id)}</option>`)
    .join('');
  if (selected) select.value = selected;
}

function bindAiProviderSettings(): void {
  const kind = document.getElementById('setting-ai-provider-kind') as HTMLSelectElement | null;
  const url = document.getElementById('setting-ai-provider-url') as HTMLInputElement | null;
  const key = document.getElementById('setting-ai-provider-key') as HTMLInputElement | null;
  const status = document.getElementById('setting-ai-provider-status');
  if (!kind || !url || !key || kind.dataset.bound === '1') return;
  kind.dataset.bound = '1';
  void api?.aiProviderGet?.().then((cfg) => {
    if (!cfg) return;
    kind.value = cfg.kind || 'pixi';
    url.value = cfg.baseUrl || '';
    key.value = '';
    key.placeholder = cfg.hasKey ? `сохранён ••••${cfg.keyTail || ''}` : 'sk-...';
    fillAiProviderModels(cfg.model ? [cfg.model] : [], cfg.model || '');
    syncAiModelButton();
  });
  document.getElementById('setting-ai-provider-detect')?.addEventListener('click', () => {
    void (async () => {
      if (status) status.textContent = 'Ищу модели…';
      await api?.aiProviderSet?.({
        kind: kind.value,
        baseUrl: url.value.trim(),
        apiKey: key.value.trim(),
      });
      const found = await api?.aiProviderModels?.();
      if (!found?.ok) {
        if (status) status.textContent = found?.error || 'Не удалось получить список';
        return;
      }
      const models = found.models || [];
      const select = document.getElementById('setting-ai-provider-model') as HTMLSelectElement | null;
      fillAiProviderModels(models, select?.value || models[0] || '');
      if (status) status.textContent = models.length ? `Найдено: ${models.length}` : 'Список пуст';
    })();
  });
  document.getElementById('setting-ai-provider-save')?.addEventListener('click', () => {
    void (async () => {
      const select = document.getElementById('setting-ai-provider-model') as HTMLSelectElement | null;
      const saved = await api?.aiProviderSet?.({
        kind: kind.value,
        baseUrl: url.value.trim(),
        apiKey: key.value.trim(),
        model: select?.value || '',
      });
      if (saved?.model) localStorage.setItem('Undefined Client-ai-custom-label', saved.model);
      if (saved?.kind && saved.kind !== 'pixi' && saved.hasKey && saved.model) setCurrentAiModel('custom');
      else if (saved?.kind === 'pixi' && currentAiModel() === 'custom') setCurrentAiModel('pixi-1.0');
      key.value = '';
      if (saved?.hasKey) key.placeholder = `сохранён ••••${saved.keyTail || ''}`;
      if (status) status.textContent = 'Сохранено';
    })();
  });
}

function bindAiAccessSettingsUi(): void {
  if (aiAccessSettingsBound) {
    applyAiTabVisibility();
    return;
  }
  aiAccessSettingsBound = true;
  const toggle = document.getElementById('setting-ai-enabled') as HTMLInputElement | null;
  if (toggle) {
    settingLoad('setting-ai-enabled', 'ai-enabled', true);
    toggle.addEventListener('change', () => {
      const on = toggle.checked;
      localStorage.setItem(AI_ENABLED_LS_KEY, String(on));
      applyAiTabVisibility();
      if (on) {
        void refreshAiAccessStatus().then(() => {
          if (!aiAccessOk) showAiAccessDeniedModal();
        });
      }
    });
  }

  const closeAccess = () => closeModal('modal-ai-access');
  document.getElementById('modal-ai-access-close')?.addEventListener('click', closeAccess);
  document.getElementById('modal-ai-access-ok')?.addEventListener('click', closeAccess);
  document.getElementById('modal-ai-access')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeAccess();
  });
  document.getElementById('modal-ai-access-apply')?.addEventListener('click', () => {
    openUagentApplyFromModal();
  });
  document.getElementById('modal-ai-access-settings')?.addEventListener('click', () => {
    openUagentApplyFromModal();
  });

  bindAiProviderSettings();

  const closeMsgrOffline = () => closeModal('modal-msgr-offline');
  document.getElementById('modal-msgr-offline-close')?.addEventListener('click', closeMsgrOffline);
  document.getElementById('modal-msgr-offline-ok')?.addEventListener('click', closeMsgrOffline);
  document.getElementById('modal-msgr-offline')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeMsgrOffline();
  });
  document.getElementById('modal-msgr-offline-accounts')?.addEventListener('click', () => {
    closeMsgrOffline();
    openAccountPopup();
  });

  const closeSkinsOffline = () => closeModal('modal-skins-offline');
  document.getElementById('modal-skins-offline-close')?.addEventListener('click', closeSkinsOffline);
  document.getElementById('modal-skins-offline-ok')?.addEventListener('click', closeSkinsOffline);
  document.getElementById('modal-skins-offline')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeSkinsOffline();
  });
  document.getElementById('modal-skins-offline-accounts')?.addEventListener('click', () => {
    closeSkinsOffline();
    openAccountPopup();
  });

  applyAiTabVisibility();
  applyOnlineOnlyTabsVisibility();
}

/* ===== START ===== */

// AI инициализируем после локалей (см. init → setLang), иначе empty-сценарии получают сырые ключи
void init();
