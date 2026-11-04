import { contextBridge, ipcRenderer } from 'electron';
import { setApiBase, getApiBase } from '../shared/apiBase';

// Рендерер до process.env не дотягивается, поэтому базовый адрес нашего API
// вычисляется здесь и передаётся в него готовой строкой.
setApiBase(process.env.UC_API_BASE || process.env.UC_NEWS_API_BASE);

const { platform, versions } = process;
contextBridge.exposeInMainWorld('electronAPI', {
  getPlatformInfo: () => ({ platform: platform, nodeVersion: versions.node }),
  apiBase: getApiBase(),
  windowMinimize: () => ipcRenderer.send('window:minimize'),
  windowMaximize: () => ipcRenderer.send('window:maximize'),
  windowClose: () => ipcRenderer.send('window:close'),

  launch: (config: any) => ipcRenderer.invoke('launcher:launch', config),
  detectRunningGame: () =>
    ipcRenderer.invoke('launcher:detect-running-game') as Promise<{
      ok: boolean;
      running: boolean;
      buildId?: string;
      name?: string;
      gameVersion?: string;
      loader?: string;
      pid?: number;
      startedAt?: number;
    }>,

  authOffline: (username: string) => ipcRenderer.invoke('launcher:auth:offline', username),
  authMicrosoft: () => ipcRenderer.invoke('launcher:auth:microsoft'),
  authEly: () => ipcRenderer.invoke('launcher:auth:ely'),
  refreshAccount: (account: any) => ipcRenderer.invoke('launcher:auth:refresh', account),

  saveAccount: (account: any) => ipcRenderer.invoke('launcher:account:save', account),
  loadAccounts: () => ipcRenderer.invoke('launcher:account:load'),
  removeAccount: (uuid: string) => ipcRenderer.invoke('launcher:account:remove', uuid),
  setActiveAccount: (uuid: string) => ipcRenderer.invoke('launcher:account:setActive', uuid),
  getActiveAccount: () => ipcRenderer.invoke('launcher:account:getActive') as Promise<string | null>,

  saveBuild: (build: any) => ipcRenderer.invoke('launcher:build:save', build),
  prefetchRuntime: (opts: { buildId: string; gameVersion: string; loader?: string; loaderVersion?: string }) =>
    ipcRenderer.invoke('launcher:prefetch-runtime', opts) as Promise<{ ok: boolean; error?: string }>,
  loadBuilds: () => ipcRenderer.invoke('launcher:build:load'),
  removeBuild: (id: string) => ipcRenderer.invoke('launcher:build:remove', id),
  loadBuildGroups: () => ipcRenderer.invoke('launcher:build-groups:load'),
  saveBuildGroup: (group: any) => ipcRenderer.invoke('launcher:build-groups:save', group),
  removeBuildGroup: (id: string) => ipcRenderer.invoke('launcher:build-groups:remove', id),
  listInstanceIcons: () => ipcRenderer.invoke('launcher:instance-icons:list') as Promise<string[]>,

  saveServer: (server: any) => ipcRenderer.invoke('launcher:server:save', server),
  loadServers: () => ipcRenderer.invoke('launcher:server:load'),
  removeServer: (id: string) => ipcRenderer.invoke('launcher:server:remove', id),
  serverStatus: (ip: string) => ipcRenderer.invoke('servers:status', ip),
  fetchServerCatalog: (force?: boolean) => ipcRenderer.invoke('servers:catalog', force === true),
  fetchServerDetail: (source: string, id: string) => ipcRenderer.invoke('servers:detail', source, id),
  fetchServerHistory: (projectId: string, serverId: string, period: string) =>
    ipcRenderer.invoke('servers:history', projectId, serverId, period),

  getSkinData: (uuid: string, serverUrl?: string) => ipcRenderer.invoke('launcher:skin:get', uuid, serverUrl),
  fetchSkinImage: (url: string) => ipcRenderer.invoke('launcher:skin:fetch', url),
  getElyWornSkin: (nickname: string, force?: boolean) => ipcRenderer.invoke('launcher:ely:wornSkin', nickname, force),
  saveSkin: (skin: any) => ipcRenderer.invoke('launcher:skin:save', skin),
  loadSkins: () => ipcRenderer.invoke('launcher:skin:load'),
  removeSkin: (id: string) => ipcRenderer.invoke('launcher:skin:remove', id),
  applyCosmetics: (payload: any) => ipcRenderer.invoke('launcher:cosmetics:apply', payload),
  listProfileCosmetics: (account: any) => ipcRenderer.invoke('launcher:cosmetics:listProfile', account),
  switchAccountCape: (account: any, capeId: string | null) =>
    ipcRenderer.invoke('launcher:cosmetics:switchCape', account, capeId),

  getModrinthProjects: (query: string, type: string, offset?: number, limit?: number, opts?: { categories?: string[]; loaders?: string[]; version?: string; index?: string; source?: string }) => ipcRenderer.invoke('modrinth:search', query, type, offset, limit, opts),
  getModrinthProject: (projectId: string) => ipcRenderer.invoke('modrinth:project', projectId),
  getModrinthVersions: (projectId: string) => ipcRenderer.invoke('modrinth:versions', projectId),
  downloadMod: (projectId: string, versionId?: string) => ipcRenderer.invoke('modrinth:download', projectId, versionId),
  cancelDownloads: () => ipcRenderer.invoke('launcher:cancel-downloads') as Promise<{ ok: boolean }>,
  installMod: (buildId: string, projectId: string, versionId?: string, contentType?: string, options?: { force?: boolean; skipDeps?: boolean; installOptional?: boolean }) => ipcRenderer.invoke('launcher:install-mod', buildId, projectId, versionId, contentType, options),
  resolveProjectByName: (name: string) => ipcRenderer.invoke('modrinth:resolve-project-by-name', name),

  getVersions: () => ipcRenderer.invoke('launcher:versions:list'),
  getLoaderVersions: (loader: string, mcVersion: string) => ipcRenderer.invoke('launcher:loader:versions', loader, mcVersion) as Promise<{
    versions: string[];
    error?: string;
    unavailable?: boolean;
  }>,
  listInstanceDrives: () => ipcRenderer.invoke('launcher:instances:drives') as Promise<Array<{ letter: string; path: string }>>,
  getInstancesLocation: () => ipcRenderer.invoke('launcher:instances:location') as Promise<{
    platform: string;
    instancesDir: string;
    windowsOnly: boolean;
  }>,
  setDefaultInstancesDir: (dir: string) => ipcRenderer.invoke('launcher:instances:set-default-dir', dir) as Promise<{
    ok: boolean;
    error?: string;
    path?: string;
  }>,
  pickInstancesDir: (title?: string) => ipcRenderer.invoke('launcher:instances:pick-dir', title) as Promise<string | null>,
  prepareBuildLocation: (buildId: string, parentDir: string) =>
    ipcRenderer.invoke('launcher:instances:prepare-build', buildId, parentDir) as Promise<{ ok: boolean; path?: string; error?: string }>,
  moveInstance: (buildId: string, destParent: string) =>
    ipcRenderer.invoke('launcher:instances:move', buildId, destParent) as Promise<{ ok: boolean; path?: string; error?: string }>,
  scanExternalLaunchers: () => ipcRenderer.invoke('launcher:external-launchers:scan') as Promise<{
    ok: boolean;
    error?: string;
    launchers: Array<{
      id: string;
      name: string;
      root: string;
      iconDataUrl?: string;
      instances: Array<{
        id: string;
        name: string;
        gameVersion: string;
        loader: string;
        loaderVersion: string;
        iconDataUrl?: string;
      }>;
    }>;
  }>,
  importExternalInstances: (launcherId: string, instanceIds: string[]) =>
    ipcRenderer.invoke('launcher:external-launchers:import', launcherId, instanceIds) as Promise<{
      ok: boolean;
      error?: string;
      imported: any[];
    }>,
  detectJava: (refresh?: boolean) => ipcRenderer.invoke('launcher:java:detect', refresh),
  listJavaVersions: (refresh?: boolean) => ipcRenderer.invoke('launcher:java:list', refresh),
  pickJava: () => ipcRenderer.invoke('launcher:java:pick') as Promise<{ path: string; version: number; name: string } | null>,
  installJava: (version: number) => ipcRenderer.invoke('launcher:java:install', version),
  removeJava: (version: number) => ipcRenderer.invoke('launcher:java:remove', version),
  resolveJavaVersion: (gameVersion: string) => ipcRenderer.invoke('launcher:java:resolve', gameVersion),
  getCrashReport: (buildId: string) => ipcRenderer.invoke('launcher:crash-report', buildId),

  getAppVersion: () => ipcRenderer.invoke('updates:current'),
  loadLocale: (lang: string) => ipcRenderer.invoke('locale:load', lang),
  setLanguage: (lang: string) => ipcRenderer.send('launcher:set-language', lang),
  updatePresence: (data: { screen?: string; account?: { name: string; avatar: string } | null }) => ipcRenderer.send('launcher:presence', data),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  launchUpdater: () => ipcRenderer.invoke('updates:launch'),

  fetchNewsList: (lang?: string, limit?: number) => ipcRenderer.invoke('news:list', lang, limit),
  fetchNewsPost: (id: string, lang?: string) => ipcRenderer.invoke('news:get', id, lang),
  fetchNewsView: (id: string) => ipcRenderer.invoke('news:view', id) as Promise<{ views?: number; error?: string }>,

  // MC Messenger: сессия MSA/Ely + REST через сайт
  messengerSession: (account: any) => ipcRenderer.invoke('messenger:session', account),
  messengerLogout: () => ipcRenderer.invoke('messenger:logout'),
  messengerRequest: (payload: {
    method?: string;
    path: string;
    body?: unknown;
    query?: Record<string, string | number | undefined>;
  }) => ipcRenderer.invoke('messenger:request', payload),
  messengerPickFiles: (opts?: { media?: boolean }) =>
    ipcRenderer.invoke('messenger:pickFiles', opts || {}) as Promise<string[]>,
  messengerReadFile: (filePath: string) =>
    ipcRenderer.invoke('messenger:readFile', filePath) as Promise<{
      ok: boolean;
      name?: string;
      path?: string;
      size?: number;
      mime?: string;
      dataBase64?: string;
      error?: string;
    }>,
  messengerDownloadAttachment: (payload: { messageId: string; fileName?: string }) =>
    ipcRenderer.invoke('messenger:downloadAttachment', payload) as Promise<{
      ok: boolean;
      path?: string;
      error?: string;
    }>,
  messengerOpenLocalFile: (filePath: string) =>
    ipcRenderer.invoke('messenger:openLocalFile', filePath) as Promise<{
      ok: boolean;
      error?: string;
    }>,
  // Проверка Range и, если докачки нет, байты ролика для локальной перемотки.
  mediaPrepareSeek: (payload: { url: string; forceBlob?: boolean }) =>
    ipcRenderer.invoke('media:prepareSeek', payload) as Promise<{
      ok: boolean;
      ranges?: boolean;
      tooLarge?: boolean;
      mime?: string;
      data?: Uint8Array;
      error?: string;
    }>,

  // Join с друзьями: LAN-порт + relay-туннель
  gameRelayWatchLan: (buildId: string) => ipcRenderer.invoke('game-relay:watch-lan', buildId),
  gameRelayStopWatch: () => ipcRenderer.invoke('game-relay:stop-watch'),
  gameRelayGetLanPort: (buildId?: string) =>
    ipcRenderer.invoke('game-relay:get-lan-port', buildId) as Promise<{ port: number | null }>,
  gameRelayStart: (
    localPort: number,
    meta?: {
      buildId?: string;
      buildName?: string;
      gameVersion?: string;
      loader?: string;
      serverName?: string;
    } | null,
  ) => ipcRenderer.invoke('game-relay:start', localPort, meta || null),
  gameRelayStop: () => ipcRenderer.invoke('game-relay:stop'),
  gameRelayRestore: () => ipcRenderer.invoke('game-relay:restore'),
  gameRelayStatus: () => ipcRenderer.invoke('game-relay:status'),
  gameRelayJoinSession: (sessionId: string) => ipcRenderer.invoke('game-relay:join-session', sessionId),
  onGameRelayLanPort: (cb: (data: { buildId: string; port: number | null }) => void) => {
    const handler = (_e: unknown, data: { buildId: string; port: number | null }) => cb(data);
    ipcRenderer.on('game-relay:lan-port', handler);
    return () => ipcRenderer.removeListener('game-relay:lan-port', handler);
  },
  onGameRelayTunnel: (cb: (data: Record<string, unknown>) => void) => {
    const handler = (_e: unknown, data: Record<string, unknown>) => cb(data);
    ipcRenderer.on('game-relay:tunnel', handler);
    return () => ipcRenderer.removeListener('game-relay:tunnel', handler);
  },

  hostedServersList: () => ipcRenderer.invoke('hosted-servers:list'),
  hostedServersCreate: () => ipcRenderer.invoke('hosted-servers:create'),
  hostedServersUpdate: (id: string, patch: Record<string, unknown>) =>
    ipcRenderer.invoke('hosted-servers:update', id, patch),
  hostedServersDelete: (id: string) => ipcRenderer.invoke('hosted-servers:delete', id),
  hostedServersStart: (id: string) => ipcRenderer.invoke('hosted-servers:start', id),
  hostedServersStop: (id: string) => ipcRenderer.invoke('hosted-servers:stop', id),
  hostedServersCommand: (id: string, command: string) =>
    ipcRenderer.invoke('hosted-servers:command', id, command),
  hostedServersLog: (id: string) => ipcRenderer.invoke('hosted-servers:log', id),
  hostedServersPlugins: (id: string) => ipcRenderer.invoke('hosted-servers:plugins', id),
  commandCatalog: (version: string) => ipcRenderer.invoke('command-catalog:get', version),
  commandCatalogIcons: (version: string, ids: string[]) => ipcRenderer.invoke('command-catalog:icons', version, ids),
  hostedServersPluginAdd: (id: string) => ipcRenderer.invoke('hosted-servers:plugin-add', id),
  hostedServersPluginToggle: (id: string, name: string) =>
    ipcRenderer.invoke('hosted-servers:plugin-toggle', id, name),
  hostedServersPluginRemove: (id: string, name: string) =>
    ipcRenderer.invoke('hosted-servers:plugin-remove', id, name),
  hostedServersVersions: (software: string) => ipcRenderer.invoke('hosted-servers:versions', software),
  hostedServersInstallCore: (id: string) => ipcRenderer.invoke('hosted-servers:install-core', id),
  hostedServersOpenDir: (id: string) => ipcRenderer.invoke('hosted-servers:open-dir', id),
  hostedServersSetIcon: (id: string, dataUrl: string) => ipcRenderer.invoke('hosted-servers:set-icon', id, dataUrl),
  hostedServersFiles: (id: string, rel?: string) => ipcRenderer.invoke('hosted-servers:files', id, rel || ''),
  hostedServersFileDelete: (id: string, rel: string) => ipcRenderer.invoke('hosted-servers:file-delete', id, rel),
  hostedServersFileImport: (id: string, rel?: string) => ipcRenderer.invoke('hosted-servers:file-import', id, rel || ''),
  hostedServersFileTransfer: (id: string, mode: 'copy' | 'move', rels: string[], dest: string) =>
    ipcRenderer.invoke('hosted-servers:file-transfer', id, mode, rels, dest),
  hostedServersInstallUrl: (id: string, url: string, filename: string) =>
    ipcRenderer.invoke('hosted-servers:install-url', id, url, filename),
  onHostedPluginProgress: (cb: (data: { id: string; filename: string; received?: number; total?: number; done?: boolean; error?: string; clear?: boolean }) => void) => {
    const handler = (_e: unknown, data: { id: string; filename: string; received?: number; total?: number; done?: boolean; error?: string; clear?: boolean }) => cb(data);
    ipcRenderer.on('hosted-servers:plugin-progress', handler);
  },
  onHostedServerLog: (cb: (data: { id: string; line: string }) => void) => {
    const handler = (_e: unknown, data: { id: string; line: string }) => cb(data);
    ipcRenderer.on('hosted-servers:log', handler);
  },
  onHostedServerState: (cb: (server: Record<string, unknown>) => void) => {
    const handler = (_e: unknown, server: Record<string, unknown>) => cb(server);
    ipcRenderer.on('hosted-servers:state', handler);
  },
  onHostedServerUsage: (cb: (data: { id: string; cpuPercent: number; ramUsedMb: number }) => void) => {
    const handler = (_e: unknown, data: { id: string; cpuPercent: number; ramUsedMb: number }) => cb(data);
    ipcRenderer.on('hosted-servers:usage', handler);
  },

  // AI-агент: чат через сайт, доступ по JWT мессенджера
  aiStatus: () => ipcRenderer.invoke('ai:status'),
  aiProviderGet: () => ipcRenderer.invoke('ai:provider:get'),
  aiProviderSet: (patch: { kind?: string; baseUrl?: string; apiKey?: string; model?: string }) =>
    ipcRenderer.invoke('ai:provider:set', patch),
  aiProviderModels: () => ipcRenderer.invoke('ai:provider:models'),
  aiChat: (payload: {
    messages: Array<Record<string, unknown>>;
    tools?: boolean;
    model?: string;
    context?: { buildId?: string; buildName?: string } | null;
  }) => ipcRenderer.invoke('ai:chat', payload),
  aiToolsList: () => ipcRenderer.invoke('ai:tools:list'),
  aiToolsRun: (
    name: string,
    args?: Record<string, unknown>,
    opts?: { confirmed?: boolean },
  ) => ipcRenderer.invoke('ai:tools:run', name, args || {}, opts || {}),
  readAttachFile: (filePath: string) =>
    ipcRenderer.invoke('ai:readAttachFile', filePath) as Promise<{
      ok: boolean;
      text?: string;
      error?: string;
      truncated?: boolean;
      bytes?: number;
    } | null>,

  // Deep link uclient://: consume забирает ссылку холодного старта, onDeepLink —
  // ссылки, пришедшие в уже запущенный лаунчер (install / import-instance).
  consumeDeepLink: () => ipcRenderer.invoke('deeplink:consume'),
  resolveDeepLink: (payload: any) => ipcRenderer.invoke('deeplink:resolve', payload),
  onDeepLink: (callback: (payload: any) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: any) => callback(payload);
    ipcRenderer.on('deeplink:open', handler);
    // Совместимость со старым каналом на случай горячей подмены main без preload.
    ipcRenderer.on('deeplink:install', handler);
    return () => {
      ipcRenderer.removeListener('deeplink:open', handler);
      ipcRenderer.removeListener('deeplink:install', handler);
    };
  },

  // ===== Шаринг пользовательских сборок =====
  createInstanceShare: (buildId: string, opts?: { authorName?: string }) =>
    ipcRenderer.invoke('instance-share:create', buildId, opts),
  getInstanceShare: (id: string) => ipcRenderer.invoke('instance-share:get', id),
  importInstanceShare: (id: string) => ipcRenderer.invoke('instance-share:import', id),
  exportInstanceZip: (buildId: string) =>
    ipcRenderer.invoke('instance-export:zip', buildId) as Promise<{ ok: boolean; path?: string; error?: string }>,
  exportInstanceMrpack: (buildId: string) =>
    ipcRenderer.invoke('instance-export:mrpack', buildId) as Promise<{ ok: boolean; path?: string; error?: string }>,
  onInstanceExportProgress: (callback: (data: any) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on('instance-export:progress', handler);
    return () => ipcRenderer.removeListener('instance-export:progress', handler);
  },
  onInstanceShareProgress: (callback: (data: any) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on('instance-share:progress', handler);
    return () => ipcRenderer.removeListener('instance-share:progress', handler);
  },

  onDownloadProgress: (callback: (data: any) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on('launcher:download-progress', handler);
    return () => ipcRenderer.removeListener('launcher:download-progress', handler);
  },

  onLauncherStatus: (callback: (data: any) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on('launcher:status', handler);
    return () => ipcRenderer.removeListener('launcher:status', handler);
  },
  onLauncherLog: (callback: (data: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: string) => callback(data);
    ipcRenderer.on('launcher:log', handler);
    return () => ipcRenderer.removeListener('launcher:log', handler);
  },
  onLauncherDownload: (callback: (data: any) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on('launcher:download', handler);
    return () => ipcRenderer.removeListener('launcher:download', handler);
  },
  onLaunchProgress: (callback: (data: any) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on('launcher:progress', handler);
    return () => ipcRenderer.removeListener('launcher:progress', handler);
  },
  openConsole: () => ipcRenderer.invoke('console:open'),
  appendConsoleLog: (message: string) => ipcRenderer.invoke('console:append', message),
  /** Синхронизация акцента с окном консоли */
  notifyThemeChanged: (accent: string) => ipcRenderer.send('theme:changed', accent),
  onThemeChanged: (callback: (accent: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, accent: string) => callback(String(accent || ''));
    ipcRenderer.on('theme:changed', handler);
    return () => ipcRenderer.removeListener('theme:changed', handler);
  },
  // Просмотр мира Minecraft (окно открывается также флагом запуска --world[=путь])
  openWorldViewer: (worldPath?: string, profile?: { username?: string; uuid?: string; skinDataUrl?: string }, bounds?: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.invoke('world:open', worldPath ?? '', profile ?? null, bounds ?? null),
  attachWorldViewer: (bounds: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.invoke('world:attach', bounds),
  setWorldViewerBounds: (bounds: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.invoke('world:set-bounds', bounds),
  closeWorldViewer: () => ipcRenderer.invoke('world:close'),
  onWorldModalOpen: (callback: (data: { worldPath?: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { worldPath?: string }) => callback(data || {});
    ipcRenderer.on('world:modal-open', handler);
    return () => ipcRenderer.removeListener('world:modal-open', handler);
  },
  onWorldModalClosed: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('world:modal-closed', handler);
    return () => ipcRenderer.removeListener('world:modal-closed', handler);
  },
  onWorldBoundsSyncRequest: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('world:request-bounds-sync', handler);
    return () => ipcRenderer.removeListener('world:request-bounds-sync', handler);
  },
  listMinecraftWorlds: () => ipcRenderer.invoke('world:list'),
  ensureWorldExporter: () => ipcRenderer.invoke('world:ensure-exporter'),
  exportWorldPreview: (worldPath: string, minecraftVersion: string) =>
    ipcRenderer.invoke('world:export', worldPath, minecraftVersion),
  openWorldExport: (outDir: string) => ipcRenderer.invoke('world:open-export', outDir),
  onWorldExportProgress: (callback: (msg: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, msg: string) => callback(msg);
    ipcRenderer.on('world:export-progress', handler);
    return () => ipcRenderer.removeListener('world:export-progress', handler);
  },
  getConsoleHistory: () => ipcRenderer.invoke('console:history'),
  saveConsoleLog: (logContent: string) => ipcRenderer.invoke('console:save-log', logContent),
  onConsoleLog: (callback: (data: any) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on('launcher:progress', handler);
    return () => ipcRenderer.removeListener('launcher:progress', handler);
  },
  onJavaProgress: (callback: (data: any) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on('launcher:java-progress', handler);
    return () => ipcRenderer.removeListener('launcher:java-progress', handler);
  },
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  openPath: (dirPath: string) => ipcRenderer.invoke('shell:openPath', dirPath),
  saveLogFile: (buildId: string, logContent: string) => ipcRenderer.invoke('launcher:save-log', buildId, logContent),
  getInstancePath: (buildId: string) => ipcRenderer.invoke('launcher:get-instance-path', buildId),
  listScreenshots: (buildId: string) => ipcRenderer.invoke('launcher:list-screenshots', buildId),
  listWorlds: (buildId: string) => ipcRenderer.invoke('launcher:list-worlds', buildId),
  deleteInstanceFiles: (buildId: string, sub: string, names: string[]) => ipcRenderer.invoke('launcher:delete-instance-files', buildId, sub, names),
  saveInstanceFiles: (buildId: string, sub: string, names: string[]) => ipcRenderer.invoke('launcher:save-instance-files', buildId, sub, names),
  toggleInstanceFile: (buildId: string, sub: string, filename: string, enabled?: boolean) =>
    ipcRenderer.invoke('launcher:toggle-instance-file', buildId, sub, filename, enabled),
  getScreenshot: (buildId: string, name: string) =>
    ipcRenderer.invoke('launcher:get-screenshot', buildId, name) as Promise<{ success: boolean; dataUrl?: string; size?: number; error?: string }>,
  copyScreenshot: (buildId: string, name: string) =>
    ipcRenderer.invoke('launcher:copy-screenshot', buildId, name) as Promise<{ success: boolean; error?: string }>,
  importInstanceFiles: (buildId: string, sub: string, sourcePaths?: string[]) =>
    ipcRenderer.invoke('launcher:import-instance-files', buildId, sub, sourcePaths),
  scanInstance: (buildId: string) => ipcRenderer.invoke('launcher:scan-instance', buildId),
  pickModpack: () => ipcRenderer.invoke('launcher:pick-modpack') as Promise<string | null>,
  pickWallpaper: () => ipcRenderer.invoke('wallpaper:pick') as Promise<{ name: string; media: 'image' | 'video' } | { error: string } | null>,
  inspectModpack: (archivePath: string) =>
    ipcRenderer.invoke('launcher:inspect-modpack', archivePath) as Promise<{
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
    }>,
  createBuildShortcut: (buildId: string) =>
    ipcRenderer.invoke('launcher:create-build-shortcut', buildId) as Promise<{
      success: boolean;
      path?: string;
      name?: string;
      error?: string;
    }>,
  importModpack: (archivePath: string) =>
    ipcRenderer.invoke('launcher:import-modpack', archivePath) as Promise<{
      success: boolean;
      build?: any;
      error?: string;
      downloaded?: number;
      failed?: number;
    }>,
  watchInstance: (buildId: string) => ipcRenderer.invoke('launcher:watch-instance', buildId),
  unwatchInstance: (buildId: string) => ipcRenderer.invoke('launcher:unwatch-instance', buildId),
  onInstanceChanged: (callback: (buildId: string, data: any) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, buildId: string, data: any) => callback(buildId, data);
    ipcRenderer.on('launcher:instance-changed', handler);
    return () => ipcRenderer.removeListener('launcher:instance-changed', handler);
  },

  // ===== AI action bridge (main → renderer) =====
  onAiAction: (callback: (msg: { id: string; action: string; payload: Record<string, unknown> }) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      msg: { id: string; action: string; payload: Record<string, unknown> },
    ) => callback(msg);
    ipcRenderer.on('ai:action', handler);
    return () => ipcRenderer.removeListener('ai:action', handler);
  },
  aiActionResult: (msg: { id: string; result: unknown }) => ipcRenderer.send('ai:action-result', msg),
});
