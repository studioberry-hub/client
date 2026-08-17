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

  authOffline: (username: string) => ipcRenderer.invoke('launcher:auth:offline', username),
  authMicrosoft: () => ipcRenderer.invoke('launcher:auth:microsoft'),
  authEly: () => ipcRenderer.invoke('launcher:auth:ely'),
  refreshAccount: (account: any) => ipcRenderer.invoke('launcher:auth:refresh', account),

  saveAccount: (account: any) => ipcRenderer.invoke('launcher:account:save', account),
  loadAccounts: () => ipcRenderer.invoke('launcher:account:load'),
  removeAccount: (uuid: string) => ipcRenderer.invoke('launcher:account:remove', uuid),

  saveBuild: (build: any) => ipcRenderer.invoke('launcher:build:save', build),
  loadBuilds: () => ipcRenderer.invoke('launcher:build:load'),
  removeBuild: (id: string) => ipcRenderer.invoke('launcher:build:remove', id),
  listInstanceIcons: () => ipcRenderer.invoke('launcher:instance-icons:list') as Promise<string[]>,

  saveServer: (server: any) => ipcRenderer.invoke('launcher:server:save', server),
  loadServers: () => ipcRenderer.invoke('launcher:server:load'),
  removeServer: (id: string) => ipcRenderer.invoke('launcher:server:remove', id),
  serverStatus: (ip: string) => ipcRenderer.invoke('servers:status', ip),
  fetchServerCatalog: () => ipcRenderer.invoke('servers:catalog'),

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

  getModrinthProjects: (query: string, type: string, offset?: number, limit?: number, opts?: { categories?: string[]; loaders?: string[]; version?: string; index?: string }) => ipcRenderer.invoke('modrinth:search', query, type, offset, limit, opts),
  getModrinthProject: (projectId: string) => ipcRenderer.invoke('modrinth:project', projectId),
  getModrinthVersions: (projectId: string) => ipcRenderer.invoke('modrinth:versions', projectId),
  downloadMod: (projectId: string, versionId?: string) => ipcRenderer.invoke('modrinth:download', projectId, versionId),
  installMod: (buildId: string, projectId: string, versionId?: string, contentType?: string, options?: { force?: boolean; skipDeps?: boolean; installOptional?: boolean }) => ipcRenderer.invoke('launcher:install-mod', buildId, projectId, versionId, contentType, options),
  resolveProjectByName: (name: string) => ipcRenderer.invoke('modrinth:resolve-project-by-name', name),

  getVersions: () => ipcRenderer.invoke('launcher:versions:list'),
  getLoaderVersions: (loader: string, mcVersion: string) => ipcRenderer.invoke('launcher:loader:versions', loader, mcVersion),
  detectJava: () => ipcRenderer.invoke('launcher:java:detect'),
  listJavaVersions: () => ipcRenderer.invoke('launcher:java:list'),
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

  // AI-агент: чат через сайт, MCP-tools исполняются локально в main
  aiStatus: (opts?: { testerKey?: string }) => ipcRenderer.invoke('ai:status', opts || {}),
  aiValidateKey: (testerKey: string) => ipcRenderer.invoke('ai:validateKey', testerKey),
  aiChat: (payload: {
    messages: Array<Record<string, unknown>>;
    tools?: boolean;
    context?: { buildId?: string; buildName?: string } | null;
    testerKey?: string;
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
  scanInstance: (buildId: string) => ipcRenderer.invoke('launcher:scan-instance', buildId),
  pickModpack: () => ipcRenderer.invoke('launcher:pick-modpack') as Promise<string | null>,
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
      };
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
