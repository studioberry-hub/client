// Хостинг: карточки своих серверов и модалка управления в каркасе редактора сборки.

import { catalogImageUrl, getApiBase, skinImageUrl } from '../shared/apiBase';
import { EMPTY_REGS, knownCommand, learnHelpCommand, resetLearned, setJarCommands, splitCommand, suggestFor, tokenClass, type Registries, type SuggestPlayer } from './serverCommandSyntax';
import { openBannerCrop } from './chatsV2/bannerCrop';

type RunStatus = 'stopped' | 'installing' | 'starting' | 'running' | 'stopping' | 'error';
type EditorTab = 'dashboard' | 'console' | 'players' | 'files' | 'plugins' | 'settings';
type LogLevel = 'info' | 'warn' | 'error' | 'run' | 'done' | 'exit';

interface CatalogEntry { id: string; name: string }

interface HostedServer {
  id: string;
  name: string;
  software: string;
  gameVersion: string;
  port: number;
  memoryMb: number;
  memoryMin?: number;
  javaPath?: string;
  jvmArgs?: string;
  javaNeed?: number;
  javaResolved?: string;
  motd: string;
  maxPlayers: number;
  gamemode: string;
  difficulty: string;
  viewDistance: number;
  simulationDistance: number;
  levelName: string;
  onlineMode: boolean;
  pvp: boolean;
  whiteList: boolean;
  allowFlight: boolean;
  spawnMonsters: boolean;
  forceGamemode: boolean;
  commandBlocks: boolean;
  spawnProtection: number;
  publicRelay: boolean;
  eulaAccepted: boolean;
  whitelistNames: string;
  hardcore: boolean;
  allowNether: boolean;
  generateStructures: boolean;
  levelSeed: string;
  levelType: string;
  spawnAnimals: boolean;
  spawnNpcs: boolean;
  enforceWhitelist: boolean;
  playerIdleTimeout: number;
  hideOnlinePlayers: boolean;
  enableStatus: boolean;
  cpuPercent?: number;
  ramUsedMb?: number;
  status: RunStatus;
  error: string;
  publicHost: string;
  publicPort: number;
  relayError: string;
  directHost?: string;
  directPort?: number;
  directError?: string;
  coreReady: boolean;
  iconData?: string;
  listingDesc?: string;
  listingVisible?: boolean;
  listingShots?: string[];
}

interface HostApi {
  hostedServersList?: () => Promise<HostedServer[]>;
  hostedServersCreate?: () => Promise<HostedServer>;
  hostedServersUpdate?: (id: string, patch: Partial<HostedServer>) => Promise<{ ok: boolean; error?: string; server?: HostedServer }>;
  hostedServersDelete?: (id: string) => Promise<{ ok: boolean }>;
  hostedServersStart?: (id: string) => Promise<{ ok: boolean; error?: string }>;
  hostedServersStop?: (id: string) => Promise<{ ok: boolean }>;
  hostedServersCommand?: (id: string, command: string) => Promise<{ ok: boolean; error?: string }>;
  hostedServersLog?: (id: string) => Promise<string[]>;
  hostedServersPlugins?: (id: string) => Promise<Array<{ name: string; enabled: boolean; size: number; commands?: Array<{ name: string; description: string; usage: string; aliases: string[] }> }>>;
  commandCatalog?: (version: string) => Promise<{ ok: boolean; items: CatalogEntry[]; blocks: CatalogEntry[]; entities: CatalogEntry[]; effects: CatalogEntry[]; enchantments: CatalogEntry[]; biomes: CatalogEntry[]; structures: CatalogEntry[]; particles: CatalogEntry[]; attributes: CatalogEntry[]; features: CatalogEntry[]; damageTypes: CatalogEntry[] }>;
  commandCatalogIcons?: (version: string, ids: string[]) => Promise<Record<string, string>>;
  hostedServersPluginAdd?: (id: string) => Promise<{ ok: boolean; error?: string }>;
  hostedServersPluginToggle?: (id: string, name: string) => Promise<Array<{ name: string; enabled: boolean; size: number }>>;
  hostedServersPluginRemove?: (id: string, name: string) => Promise<Array<{ name: string; enabled: boolean; size: number }>>;
  hostedServersVersions?: (software: string) => Promise<{ ok: boolean; versions: string[]; error?: string }>;
  hostedServersInstallCore?: (id: string) => Promise<{ ok: boolean; error?: string }>;
  hostedServersOpenDir?: (id: string) => Promise<{ ok: boolean }>;
  hostedServersSetIcon?: (id: string, dataUrl: string) => Promise<{ ok: boolean; error?: string; server?: HostedServer }>;
  hostedServersFiles?: (id: string, rel?: string) => Promise<{ ok: boolean; entries: Array<{ name: string; dir: boolean; size: number }>; error?: string }>;
  hostedServersFileDelete?: (id: string, rel: string) => Promise<{ ok: boolean; error?: string }>;
  hostedServersFileImport?: (id: string, rel?: string) => Promise<{ ok: boolean; error?: string }>;
  hostedServersFileTransfer?: (id: string, mode: 'copy' | 'move', rels: string[], dest: string) => Promise<{ ok: boolean; error?: string }>;
  hostedServersInstallUrl?: (id: string, url: string, filename: string) => Promise<{ ok: boolean; error?: string; already?: boolean }>;
  onHostedPluginProgress?: (cb: (data: { id: string; filename: string; received?: number; total?: number; done?: boolean; error?: string; clear?: boolean }) => void) => void;
  listInstanceIcons?: () => Promise<string[]>;
  detectJava?: (refresh?: boolean) => Promise<Array<{ name: string; path: string; version: number; managed?: boolean }>>;
  pickJava?: () => Promise<{ path: string; version: number; name: string } | null>;
  installJava?: (version: number) => Promise<{ success: boolean; path?: string; error?: string }>;
  resolveJavaVersion?: (gameVersion: string) => Promise<{ success: boolean; version?: number }>;
  getModrinthProjects?: (query: string, type: string, offset?: number, limit?: number, opts?: { loaders?: string[]; version?: string; index?: string; source?: string }) => Promise<{ hits?: any[]; total_hits?: number; error?: string }>;
  getModrinthVersions?: (projectId: string) => Promise<any[]>;
  onHostedServerLog?: (cb: (data: { id: string; line: string }) => void) => void;
  onHostedServerState?: (cb: (server: HostedServer) => void) => void;
  onHostedServerUsage?: (cb: (data: { id: string; cpuPercent: number; ramUsedMb: number }) => void) => void;
  serverStatus?: (ip: string) => Promise<{ online?: boolean; players?: { online?: number | null } } | null>;
}

const CORES: Array<[string, string]> = [
  ['vanilla', 'Vanilla'],
  ['paper', 'Paper'],
  ['purpur', 'Purpur'],
  ['folia', 'Folia'],
  ['leaves', 'Leaves'],
  ['leaf', 'Leaf'],
  ['pufferfish', 'Pufferfish'],
  ['fabric', 'Fabric'],
  ['quilt', 'Quilt'],
  ['spigot', 'Spigot'],
  ['bukkit', 'CraftBukkit'],
  ['mohist', 'Mohist'],
  ['sponge', 'Sponge'],
  ['velocity', 'Velocity'],
  ['waterfall', 'Waterfall'],
  ['bungeecord', 'BungeeCord'],
  ['canvas', 'Canvas'],
  ['arclight', 'Arclight'],
  ['youer', 'Youer'],
  ['banner', 'Banner'],
  ['divinemc', 'DivineMC'],
];

const GAMEMODES: Array<[string, string]> = [
  ['survival', 'Выживание'],
  ['creative', 'Творчество'],
  ['adventure', 'Приключение'],
  ['spectator', 'Наблюдатель'],
];
const DIFFICULTIES: Array<[string, string]> = [
  ['peaceful', 'Мирная'],
  ['easy', 'Лёгкая'],
  ['normal', 'Нормальная'],
  ['hard', 'Сложная'],
];
const LEVEL_TYPES: Array<[string, string]> = [
  ['minecraft:normal', 'Обычный'],
  ['minecraft:flat', 'Плоский'],
  ['minecraft:large_biomes', 'Крупные биомы'],
  ['minecraft:amplified', 'Усиленный'],
  ['minecraft:single_biome_surface', 'Один биом'],
];

let servers: HostedServer[] = [];
let openId: string | null = null;
let editorTab: EditorTab = 'dashboard';
let listMode: 'list' | 'grid' = 'list';
let chartPeriod: '24h' | '7d' | '30d' = '24h';
let chartPlayers: number | null = null;
let chartTimer: ReturnType<typeof setInterval> | null = null;
let pluginView: 'installed' | 'catalog' = 'installed';
let fileRel = '';
let fileBack: string[] = [];
let fileForward: string[] = [];
let fileSelected = new Set<string>();
let playerSelected = new Set<string>();
let fileClip: { mode: 'copy' | 'move'; rels: string[] } | null = null;
let pluginQuery = '';
let pluginSource = 'both';
let pluginSort = 'relevance';
let pluginOffset = 0;
let pluginTotal = 0;
let pluginBusy = false;
let pluginGen = 0;
let pluginReq = 0;
const pluginSeen = new Set<string>();
let pluginHits: any[] = [];
let pluginLayout: 'cards' | 'list' = 'cards';
const PLUGIN_PAGE = 20;
let pluginObserver: IntersectionObserver | null = null;
let booted = false;
let commandRegs: Registries = EMPTY_REGS;
const commandLabels: Record<string, string> = {};
const commandIcons = new Map<string, string>();
const iconMiss = new Set<string>();
let catalogVersion = '';
let catalogToken = 0;

function api(): HostApi | undefined {
  return (window as unknown as { electronAPI?: HostApi }).electronAPI;
}

function esc(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function current(): HostedServer | undefined {
  return servers.find((row) => row.id === openId);
}

function coreLabel(id: string): string {
  return CORES.find((row) => row[0] === id)?.[1] || id;
}

function statusLabel(status: RunStatus): string {
  if (status === 'installing') return 'Скачивание ядра';
  if (status === 'starting') return 'Запуск';
  if (status === 'running') return 'Запущен';
  if (status === 'stopping') return 'Остановка';
  if (status === 'error') return 'Ошибка';
  return 'Остановлен';
}

function busy(status: RunStatus): boolean {
  return status === 'installing' || status === 'starting' || status === 'stopping';
}

function toneOf(status: RunStatus): string {
  if (status === 'running') return 'on';
  if (status === 'error') return 'crash';
  if (status === 'installing' || status === 'starting' || status === 'stopping') return 'wait';
  return 'off';
}

function listStatusText(status: RunStatus): string {
  if (status === 'running') return 'Работает';
  if (status === 'error') return 'Крашнулся';
  if (status === 'installing') return 'Установка';
  if (status === 'starting') return 'Запуск';
  if (status === 'stopping') return 'Остановка';
  return 'Выключен';
}

function statusMark(status: RunStatus, text: string): string {
  const spin = busy(status) ? '<span class="hs-spin" aria-hidden="true"></span>' : '';
  return `${spin}${esc(text)}`;
}

function publicAddr(server: HostedServer): string {
  if (server.publicHost && server.publicPort) return `${server.publicHost}:${server.publicPort}`;
  if (server.directHost) return `${server.directHost}:${server.directPort || server.port}`;
  return `127.0.0.1:${server.port}`;
}

const HOST_ASSET = '../../assets/selfHostedPage';

function hostAsset(file: string, flip = false): string {
  return `<img class="hs-asset${flip ? ' is-flip' : ''}" src="${HOST_ASSET}/${file}" alt="" width="16" height="16">`;
}

const ICON_BACK = hostAsset('nextPage.svg', true);
const ICON_FWD = hostAsset('nextPage.svg');
const ICON_POWER = hostAsset('power.svg');
const ICON_RESTART = hostAsset('restart.svg');
const ICON_LINK = hostAsset('copyLink.svg');
const ICON_PENCIL = hostAsset('edit.svg');
const ICON_UPLOAD = hostAsset('upload.svg');

function hostPane(): HTMLElement | null {
  return document.getElementById('servers-host-pane');
}

function markServerPage(open: boolean): void {
  document.getElementById('tab-host')?.classList.toggle('is-server', open);
}

function confirmHost(message: string, yesLabel = 'Удалить'): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.getElementById('modal-confirm');
    const msgEl = document.getElementById('confirm-message');
    const yesBtn = document.getElementById('confirm-yes');
    const noBtn = document.getElementById('confirm-no');
    if (!overlay || !msgEl || !yesBtn || !noBtn) {
      resolve(false);
      return;
    }
    const previous = yesBtn.textContent;
    msgEl.textContent = message;
    yesBtn.textContent = yesLabel;
    overlay.classList.remove('hidden');
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      overlay.classList.add('hidden');
      yesBtn.textContent = previous;
      yesBtn.removeEventListener('click', onYes);
      noBtn.removeEventListener('click', onNo);
      resolve(value);
    };
    const onYes = () => finish(true);
    const onNo = () => finish(false);
    yesBtn.addEventListener('click', onYes);
    noBtn.addEventListener('click', onNo);
  });
}

function askHost(message: string, placeholder: string): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-confirm-overlay';
    overlay.innerHTML = `<div class="modal-confirm-card">
      <div class="modal-confirm-message">${esc(message)}</div>
      <input class="hs-ask" placeholder="${esc(placeholder)}" autocomplete="off" spellcheck="false">
      <div class="modal-confirm-actions">
        <button type="button" class="stngs-btn ghost" data-no>Отмена</button>
        <button type="button" class="stngs-btn primary" data-yes>Отправить</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('input');
    const finish = (value: string | null) => {
      overlay.remove();
      resolve(value);
    };
    input?.focus();
    overlay.querySelector('[data-no]')?.addEventListener('click', () => finish(null));
    overlay.querySelector('[data-yes]')?.addEventListener('click', () => {
      const text = input?.value.trim() || '';
      if (text) finish(text);
    });
    input?.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') finish(null);
      if (event.key === 'Enter') {
        event.preventDefault();
        const text = input.value.trim();
        if (text) finish(text);
      }
    });
  });
}

function classify(line: string): LogLevel {
  if (/Done \(/i.test(line)) return 'done';
  if (/^>\s/.test(line) || /запуск:/i.test(line)) return 'run';
  const tagged = line.match(/\[(?:[^\]/\n]+\/)?(FATAL|SEVERE|ERROR|WARN(?:ING)?|INFO|DEBUG|TRACE)\]/i);
  const level = tagged?.[1]?.toUpperCase() || '';
  if (level === 'FATAL' || level === 'SEVERE' || level === 'ERROR') return 'error';
  if (level === 'WARN' || level === 'WARNING') return 'warn';
  if (/\b(error|exception|ошибк)/i.test(line)) return 'error';
  if (/\bwarn/i.test(line)) return 'warn';
  return 'info';
}

function logEntry(line: string): string {
  const level = classify(line);
  return `<div class="hs-log hs-log--${level}">${esc(line)}</div>`;
}

function selectHtml(id: string, value: string, options: Array<[string, string]>, wrapClass = ''): string {
  const opts = options.some((row) => row[0] === value) ? options : ([[value, value], ...options] as Array<[string, string]>);
  const extra = wrapClass ? ` ${wrapClass}` : '';
  return `<div class="stngs-select-wrap be-select-wrap${extra}">
    <select class="stngs-select-hidden" id="${id}">
      ${opts.map(([v, label]) => `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(label)}</option>`).join('')}
    </select>
    <button type="button" class="stngs-select-btn"><span class="stngs-select-value"></span>
      <svg class="stngs-select-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 4L6 8L10 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    <div class="stngs-select-menu select-scroll-menu" data-for="${id}">
      ${opts.map(([v, label]) => `<div class="stngs-select-opt" data-value="${esc(v)}">${esc(label)}</div>`).join('')}
    </div>
  </div>`;
}

function restoreHostMenu(menu: HTMLElement): void {
  const select = document.getElementById(menu.dataset.for || '');
  const wrap = select?.closest<HTMLElement>('.stngs-select-wrap');
  menu.classList.remove('is-portal', 'open', 'host-portal');
  menu.removeAttribute('style');
  if (wrap && menu.parentElement !== wrap) wrap.appendChild(menu);
  wrap?.classList.remove('open');
}

function closeHostSelects(): void {
  document.querySelectorAll<HTMLElement>('.stngs-select-menu.host-portal').forEach(restoreHostMenu);
}

function bindSelect(wrap: HTMLElement): void {
  const btn = wrap.querySelector<HTMLElement>('.stngs-select-btn');
  const menu = wrap.querySelector<HTMLElement>('.stngs-select-menu');
  const select = wrap.querySelector<HTMLSelectElement>('select');
  const valueEl = wrap.querySelector<HTMLElement>('.stngs-select-value');
  if (!btn || !menu || !select || !valueEl || btn.dataset.bound === '1') return;
  btn.dataset.bound = '1';
  const sync = () => {
    valueEl.textContent = select.options[select.selectedIndex]?.textContent || select.value;
    menu.querySelectorAll<HTMLElement>('.stngs-select-opt').forEach((opt) => {
      opt.classList.toggle('selected', opt.dataset.value === select.value);
    });
  };
  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    const wasOpen = wrap.classList.contains('open');
    closeHostSelects();
    if (wasOpen) return;
    wrap.classList.add('open');
    const rect = btn.getBoundingClientRect();
    document.body.appendChild(menu);
    menu.classList.add('is-portal', 'host-portal', 'open');
    menu.style.position = 'fixed';
    menu.style.left = `${Math.max(8, rect.left)}px`;
    menu.style.top = `${rect.bottom + 6}px`;
    menu.style.minWidth = `${Math.max(rect.width, 180)}px`;
    menu.style.maxHeight = '280px';
  });
  menu.addEventListener('click', (event) => {
    const opt = (event.target as HTMLElement).closest<HTMLElement>('.stngs-select-opt');
    if (!opt || opt.dataset.value === undefined) return;
    select.value = opt.dataset.value;
    select.dispatchEvent(new Event('change'));
    restoreHostMenu(menu);
    sync();
  });
  sync();
}

function hostTabActive(): boolean {
  return document.getElementById('tab-host')?.classList.contains('active') ?? false;
}

function upsert(server: HostedServer): void {
  const index = servers.findIndex((row) => row.id === server.id);
  if (index >= 0) servers[index] = { ...servers[index], ...server };
  else servers.unshift(server);
}

async function refreshList(): Promise<void> {
  const host = api();
  const pane = document.getElementById('servers-host-pane');
  if (!host?.hostedServersList) {
    if (pane) pane.innerHTML = '<div class="host-empty">Перезапустите лаунчер, чтобы включить хостинг.</div>';
    return;
  }
  servers = await host.hostedServersList();
  if (!openId) renderList();
  else paintChrome();
}

function syncListTools(): void {
  const pane = hostPane();
  pane?.classList.toggle('is-grid', listMode === 'grid');
  const icon = document.getElementById('host-view-icon') as HTMLImageElement | null;
  const btn = document.getElementById('host-view-toggle');
  if (icon) {
    icon.src = listMode === 'grid'
      ? '../../assets/newServersPage/icons/list.svg'
      : '../../assets/newServersPage/icons/grid.svg';
  }
  btn?.setAttribute('title', listMode === 'grid' ? 'Списком' : 'Сеткой');
}

function renderList(): void {
  markServerPage(false);
  const pane = hostPane();
  if (!pane) return;
  syncListTools();
  if (!servers.length) {
    pane.classList.remove('is-grid');
    pane.innerHTML = `<div class="hs-empty">
      <h2>Нет своих серверов</h2>
      <p>Сервер запускается на этом компьютере. Пока лаунчер открыт, игроки заходят по публичному адресу.</p>
      <button type="button" class="hs-primary" id="host-empty-create">Создать сервер</button>
    </div>`;
  } else {
    pane.innerHTML = servers.map((server) => rowHtml(server)).join('');
  }
  pane.querySelector('#host-empty-create')?.addEventListener('click', () => void createServer());
  pane.querySelectorAll<HTMLElement>('.scat-card').forEach((row) => {
    row.addEventListener('click', () => openServer(row.dataset.hostId || '', 'dashboard'));
  });
  pane.querySelectorAll<HTMLElement>('[data-host-start]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      void toggleRun(btn.dataset.hostStart || '');
    });
  });
}

function rowHtml(server: HostedServer): string {
  const tone = toneOf(server.status);
  const icon = server.iconData
    ? `<img src="${server.iconData}" alt="">`
    : '<img src="../../assets/tabsIcons/hosting.svg" alt="">';
  const sub = server.motd || `${server.gameVersion} · ${coreLabel(server.software)}`;
  return `<article class="scat-card" data-host-id="${esc(server.id)}">
    <div class="scat-ico">${icon}</div>
    <div class="scat-main">
      <div class="scat-name">${esc(server.name)}</div>
      <div class="scat-desc">${esc(sub)}</div>
    </div>
    <span class="hs-row__status is-${tone}">${statusMark(server.status, listStatusText(server.status))}</span>
    <button type="button" class="hs-power is-${tone}" data-host-start="${esc(server.id)}" title="${server.status === 'running' ? 'Остановить' : 'Запустить'}"><span class="hs-mask" style="--hs-icon: url('${HOST_ASSET}/power.svg')"></span></button>
  </article>`;
}

function closeDetail(): void {
  closeHostSelects();
  stopPluginScroll();
  stopChartWatch();
  openId = null;
  fileClip = null;
  fileSelected = new Set();
  playerSelected = new Set();
  closeListing();
  renderList();
}

function paintChrome(): void {
  const server = current();
  if (!server) return;
  const icon = document.getElementById('hs-icon');
  const badges = document.getElementById('hs-badges');
  const addr = document.getElementById('hs-addr');
  const power = document.getElementById('hs-power') as HTMLButtonElement | null;
  const restart = document.getElementById('hs-restart') as HTMLButtonElement | null;
  if (icon) {
    icon.innerHTML = server.iconData
      ? `<img src="${server.iconData}" alt="">`
      : '<img src="../../assets/tabsIcons/hosting.svg" alt="">';
  }
  const tone = toneOf(server.status);
  const stateText = listStatusText(server.status);
  if (badges) {
    badges.innerHTML = `<span class="hs-badge is-self">Self-hosted</span>
      <span class="hs-badge ${server.publicRelay ? 'is-pub' : 'is-off'}">${server.publicRelay ? 'Публичный' : 'Локальный'}</span>
      <span class="hs-badge is-${tone}">${statusMark(server.status, stateText)}</span>`;
  }
  if (addr) addr.textContent = publicAddr(server);
  if (power) power.disabled = busy(server.status);
  if (restart) restart.disabled = busy(server.status);
}

function copyAddress(text: string, btn: HTMLElement): void {
  const prev = btn.textContent || '';
  void navigator.clipboard.writeText(text).then(() => {
    if (btn.classList.contains('host-connect__value')) {
      btn.textContent = 'Скопировано';
      window.setTimeout(() => {
        if (btn.isConnected) btn.textContent = text;
      }, 1200);
      return;
    }
    btn.title = 'Скопировано';
    window.setTimeout(() => {
      if (btn.isConnected) btn.title = prev ? 'Скопировать адрес' : 'Скопировать адрес';
    }, 1200);
  }).catch(() => undefined);
}

async function openServer(id: string, tab: EditorTab): Promise<void> {
  const server = servers.find((row) => row.id === id);
  const pane = hostPane();
  if (!server || !pane) return;
  openId = id;
  editorTab = tab;
  fileRel = '';
  fileBack = [];
  fileForward = [];
  fileSelected = new Set();
  playerSelected = new Set();
  markServerPage(true);
  pane.classList.remove('is-grid');
  pane.innerHTML = detailShell();
  bindShell(id);
  paintChrome();
  await renderPanel();
}

function detailShell(): string {
  const tabs: Array<[EditorTab, string]> = [
    ['dashboard', 'Дашборд'],
    ['console', 'Консоль'],
    ['players', 'Игроки'],
    ['plugins', 'Плагины'],
    ['files', 'Файлы'],
    ['settings', 'Настройки'],
  ];
  return `<div class="hs-page">
    <button type="button" class="hs-back" id="hs-back"><span class="hs-back__btn">${ICON_BACK}</span><span>Вернуться к серверам</span></button>
    <header class="hs-card">
      <div class="hs-card__icon" id="hs-icon"></div>
      <div>
        <div class="hs-badges" id="hs-badges"></div>
        <div class="hs-addr" id="hs-addr"></div>
      </div>
      <div class="hs-card__tools">
        <button type="button" class="hs-iconbtn" id="hs-copy" title="Скопировать адрес">${ICON_LINK}</button>
        <button type="button" class="hs-iconbtn" id="hs-edit" title="Листинг">${ICON_PENCIL}</button>
        <button type="button" class="hs-iconbtn is-restart" id="hs-restart" title="Перезапустить">${ICON_RESTART}</button>
        <button type="button" class="hs-iconbtn is-power" id="hs-power" title="Питание">${ICON_POWER}</button>
      </div>
    </header>
    <nav class="hs-tabs" id="hs-tabs">${tabs.map(([id, label]) => `<button type="button" class="hs-tab${editorTab === id ? ' is-on' : ''}" data-host-tab="${id}">${label}</button>`).join('')}</nav>
    <div class="hs-body" id="host-modal-panel"></div>
  </div>`;
}

function bindShell(id: string): void {
  document.getElementById('hs-back')?.addEventListener('click', closeDetail);
  document.getElementById('hs-copy')?.addEventListener('click', () => {
    const server = current();
    const btn = document.getElementById('hs-copy');
    if (server && btn) copyAddress(publicAddr(server), btn);
  });
  document.getElementById('hs-edit')?.addEventListener('click', () => openListing());
  document.getElementById('hs-power')?.addEventListener('click', () => void toggleRun(id));
  document.getElementById('hs-restart')?.addEventListener('click', () => void restartServer(id));
  document.querySelectorAll<HTMLElement>('#hs-tabs [data-host-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      editorTab = (btn.dataset.hostTab as EditorTab) || 'dashboard';
      document.querySelectorAll('#hs-tabs .hs-tab').forEach((node) => node.classList.toggle('is-on', node === btn));
      void renderPanel();
    });
  });
}

async function restartServer(id: string): Promise<void> {
  const server = servers.find((row) => row.id === id);
  const host = api();
  if (!server || !host) return;
  if (server.status === 'running' || server.status === 'starting') await host.hostedServersStop?.(id);
  await host.hostedServersStart?.(id);
}

function gbLabel(mb: number): string {
  const gb = mb / 1024;
  const text = (gb >= 10 ? gb.toFixed(0) : gb.toFixed(1)).replace('.', ',');
  return `${text} GB`;
}

function gauge(kind: 'cpu' | 'ram', name: string, value: string, color: string, ratio: number): string {
  const r = 21;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, ratio));
  const dash = clamped * c;
  const arc = clamped > 0
    ? `<circle class="hs-meter__arc" cx="27" cy="27" r="${r}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-dasharray="${dash} ${c}" transform="rotate(-90 27 27)"/>`
    : `<circle class="hs-meter__arc" cx="27" cy="27" r="${r}" fill="none" stroke="${color}" stroke-width="4" stroke-dasharray="0 ${c}" transform="rotate(-90 27 27)"/>`;
  return `<div class="hs-meter" data-meter="${kind}" data-color="${color}">
    <svg viewBox="0 0 54 54" aria-hidden="true">
      <circle cx="27" cy="27" r="${r}" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="4"/>
      ${arc}
    </svg>
    <div class="hs-meter__name">${name}</div>
    <div class="hs-meter__val">${value}</div>
  </div>`;
}

function paintMeters(server: HostedServer): void {
  const live = server.status === 'running' || server.status === 'starting';
  const cpuBox = document.querySelector<HTMLElement>('[data-meter="cpu"]');
  const ramBox = document.querySelector<HTMLElement>('[data-meter="ram"]');
  const cpu = live ? Math.max(0, Math.min(100, Math.round(server.cpuPercent ?? 0))) : null;
  const ramMb = live ? Math.max(0, Math.round(server.ramUsedMb ?? 0)) : null;
  const apply = (box: HTMLElement | null, text: string, ratio: number) => {
    if (!box) return;
    const val = box.querySelector('.hs-meter__val');
    if (val) val.textContent = text;
    const arc = box.querySelector<SVGCircleElement>('.hs-meter__arc');
    if (!arc) return;
    const r = Number(arc.getAttribute('r') || 21);
    const c = 2 * Math.PI * r;
    const dash = Math.max(0, Math.min(1, ratio)) * c;
    arc.setAttribute('stroke-dasharray', `${dash} ${c}`);
    arc.setAttribute('stroke-linecap', dash > 0 ? 'round' : 'butt');
  };
  apply(cpuBox, cpu == null ? '—' : `${cpu}%`, cpu == null ? 0 : cpu / 100);
  const ramText = ramMb == null ? '—' : `${gbLabel(ramMb)} / ${gbLabel(server.memoryMb)}`;
  apply(ramBox, ramText, ramMb == null ? 0 : ramMb / Math.max(1, server.memoryMb));
}

// ===== Онлайн, тот же ряд замеров, что у карточки сервера =====

const HOST_HIST_KEY = 'uc-srv-online-hist';

function hostHistId(server: HostedServer): string {
  return `uc-${server.id}`;
}

function readHostPoints(id: string): { t: string; n: number }[] {
  let row: unknown[] = [];
  try {
    const raw = JSON.parse(localStorage.getItem(HOST_HIST_KEY) || '{}') as Record<string, unknown>;
    const list = raw?.[id];
    if (Array.isArray(list)) row = list;
  } catch {
    return [];
  }
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

function pushHostHist(id: string, value: number): void {
  if (!id || !Number.isFinite(value)) return;
  let all: Record<string, unknown[]> = {};
  try {
    const raw = JSON.parse(localStorage.getItem(HOST_HIST_KEY) || '{}');
    if (raw && typeof raw === 'object') all = raw as Record<string, unknown[]>;
  } catch {
    all = {};
  }
  const row = readHostPoints(id);
  const next = Math.max(0, Math.round(value));
  const now = Date.now();
  const last = row[row.length - 1];
  if (last && last.n === next && now - new Date(last.t).getTime() < 60_000) return;
  row.push({ t: new Date(now).toISOString(), n: next });
  all[id] = row.slice(-240);
  try { localStorage.setItem(HOST_HIST_KEY, JSON.stringify(all)); } catch { /* квота хранилища */ }
}

function hostWhen(raw: string): string {
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function hostSmoothPath(coords: { x: number; y: number }[]): string {
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

function hostChartHtml(server: HostedServer): string {
  const period = chartPeriod;
  const span = period === '30d' ? 30 : period === '7d' ? 7 : 1;
  const from = Date.now() - span * 86_400_000;
  const points = readHostPoints(hostHistId(server))
    .filter((point) => new Date(point.t).getTime() >= from)
    .map((point) => ({ t: point.t, online: point.n }));
  const drawn = points.length ? points : [{ t: '', online: 0 }];
  const values = points.map((point) => point.online);
  const peak = values.length ? Math.max(...values) : 0;
  const min = values.length ? Math.min(...values) : 0;
  const avg = values.length ? values.reduce((sum, n) => sum + n, 0) / values.length : 0;
  const peakAt = points.find((point) => point.online === peak)?.t || '';
  const minAt = points.find((point) => point.online === min)?.t || '';
  const now = chartPlayers != null ? String(chartPlayers) : (points.length ? String(points[points.length - 1].online) : '—');
  const rangeLabel = period === '30d' ? 'за 30 дней' : period === '7d' ? 'за 7 дней' : 'за 24 часа';
  const ranges = ([['24h', '24 часа'], ['7d', '7 дней'], ['30d', '30 дней']] as const)
    .map(([key, label]) => `<button type="button" data-range="${key}" class="${key === period ? 'is-on' : ''}">${label}</button>`)
    .join('');
  const w = 480;
  const h = 128;
  const padL = 2;
  const padR = 6;
  const padT = 10;
  const padB = 6;
  const max = Math.max(1, ...drawn.map((point) => point.online));
  const step = drawn.length === 1 ? 0 : (w - padL - padR) / (drawn.length - 1);
  const coords = drawn.map((point, index) => ({
    x: padL + index * step,
    y: h - padB - (point.online / max) * (h - padT - padB),
  }));
  const line = hostSmoothPath(coords);
  const last = coords[coords.length - 1];
  const area = `${line}L${last.x.toFixed(1)},${h - padB}L${padL},${h - padB}Z`;
  const payload = encodeURIComponent(JSON.stringify(drawn.filter((point) => point.t)));
  const avgText = Number.isInteger(avg) ? String(avg) : (Math.round(avg * 10) / 10).toFixed(1);
  return `<div class="scat-live">
    <div class="scat-live-top">
      <div>
        <div class="scat-live-title">Статистика онлайна игроков</div>
        <div class="scat-ranges">${ranges}</div>
      </div>
      <div class="scat-now"><span>Сейчас онлайн</span><b>${esc(now)}</b><small>Обновлено: только что</small></div>
    </div>
    <div class="scat-plot" data-samples="${payload}"><svg class="scat-chart scat-chart-live" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><path class="scat-chart-area" d="${area}"></path><path class="scat-chart-line" d="${line}"></path><circle class="scat-chart-dot" cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="3.5"></circle></svg><div class="scat-tip" hidden></div></div>
    <div class="scat-chart-times"><span>${esc(hostWhen(points[0]?.t || ''))}</span><span>${esc(hostWhen(points[points.length - 1]?.t || ''))}</span></div>
    <div class="scat-sums">
      <div class="scat-sum"><span>Пик онлайна</span><b>${peak}</b><small>${esc(hostWhen(peakAt))}</small></div>
      <div class="scat-sum"><span>Минимум онлайна</span><b>${min}</b><small>${esc(hostWhen(minAt))}</small></div>
      <div class="scat-sum"><span>Средний онлайн</span><b>${avgText}</b><small>${rangeLabel}</small></div>
    </div>
  </div>`;
}

function paintHostChart(server: HostedServer): void {
  const box = document.querySelector('.hs-chart');
  if (!box) return;
  box.innerHTML = hostChartHtml(server);
}

function stopChartWatch(): void {
  if (chartTimer) clearInterval(chartTimer);
  chartTimer = null;
}

async function sampleHostOnline(server: HostedServer): Promise<number | null> {
  if (server.status !== 'running' && server.status !== 'starting') return server.status === 'stopped' || server.status === 'error' ? 0 : null;
  try {
    const status = await api()?.serverStatus?.(`127.0.0.1:${server.port}`);
    if (status?.players?.online != null) return Math.max(0, Math.round(Number(status.players.online)));
    if (status?.online) return 0;
  } catch {
    /* локальный запрос не ответил */
  }
  return null;
}

function watchHostChart(): void {
  stopChartWatch();
  const tick = async () => {
    const server = current();
    if (!server || editorTab !== 'dashboard' || openId !== server.id) return;
    const count = await sampleHostOnline(server);
    if (count != null) {
      chartPlayers = count;
      pushHostHist(hostHistId(server), count);
    }
    if (current()?.id === server.id && editorTab === 'dashboard') paintHostChart(server);
  };
  void tick();
  chartTimer = setInterval(() => { void tick(); }, 15000);
}

function bindChartHover(root: HTMLElement): void {
  root.addEventListener('mousemove', (event) => {
    const plot = (event.target as HTMLElement).closest<HTMLElement>('.scat-plot');
    if (!plot) {
      root.querySelectorAll<HTMLElement>('.scat-tip').forEach((tip) => { tip.hidden = true; });
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
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)));
    const index = Math.min(samples.length - 1, Math.max(0, Math.round(ratio * (samples.length - 1))));
    const tip = plot.querySelector<HTMLElement>('.scat-tip');
    if (!tip) return;
    root.querySelectorAll<HTMLElement>('.scat-tip').forEach((node) => { node.hidden = true; });
    tip.hidden = false;
    tip.innerHTML = `<b>${Number(samples[index].online || 0).toLocaleString('ru-RU')}</b><small>${esc(hostWhen(samples[index].t))}</small>`;
    const half = (tip.offsetWidth || 96) / 2;
    const left = Math.max(half + 4, Math.min(rect.width - half - 4, event.clientX - rect.left));
    tip.style.left = `${left}px`;
    tip.style.top = `${event.clientY - rect.top}px`;
  });
  root.addEventListener('mouseleave', () => {
    root.querySelectorAll<HTMLElement>('.scat-tip').forEach((tip) => { tip.hidden = true; });
  });
}

function dashboardHtml(server: HostedServer): string {
  const live = server.status === 'running' || server.status === 'starting';
  const cpu = live ? Math.max(0, Math.min(100, Math.round(server.cpuPercent ?? 0))) : null;
  const ramMb = live ? Math.max(0, Math.round(server.ramUsedMb ?? 0)) : null;
  const known = readHostPoints(hostHistId(server));
  chartPlayers = known.length ? known[known.length - 1].n : null;
  return `<div class="hs-dash">
    <section class="hs-panel hs-chart">${hostChartHtml(server)}</section>
    <section class="hs-panel hs-meters">
      <h2 class="hs-meters__title">Потребление сервера</h2>
      <div class="hs-meter-row">
        ${gauge('cpu', 'CPU', cpu == null ? '—' : `${cpu}%`, '#C4FF83', cpu == null ? 0 : cpu / 100)}
        ${gauge('ram', 'RAM', ramMb == null ? '—' : `${gbLabel(ramMb)} / ${gbLabel(server.memoryMb)}`, '#FFF583', ramMb == null ? 0 : ramMb / Math.max(1, server.memoryMb))}
      </div>
    </section>
  </div>`;
}

function bindDashboard(): void {
  const chart = document.querySelector<HTMLElement>('.hs-chart');
  if (!chart) return;
  chart.addEventListener('click', (event) => {
    const btn = (event.target as HTMLElement).closest<HTMLElement>('[data-range]');
    if (!btn) return;
    const next = btn.dataset.range;
    if (next !== '24h' && next !== '7d' && next !== '30d') return;
    chartPeriod = next;
    const server = current();
    if (server) paintHostChart(server);
  });
  bindChartHover(chart);
  watchHostChart();
}

async function renderPanel(): Promise<void> {
  closeHostSelects();
  closePlayerMenu();
  stopPluginScroll();
  stopChartWatch();
  const panel = document.getElementById('host-modal-panel');
  const server = current();
  if (!panel || !server) return;
  if (editorTab === 'dashboard') panel.innerHTML = dashboardHtml(server);
  else if (editorTab === 'console') panel.innerHTML = consoleHtml();
  else if (editorTab === 'players') panel.innerHTML = '<div class="hs-panel hs-files"><p class="hs-note">Загрузка игроков…</p></div>';
  else if (editorTab === 'files') panel.innerHTML = '<div class="hs-panel hs-files"><p class="hs-note">Загрузка файлов…</p></div>';
  else if (editorTab === 'plugins') panel.innerHTML = '<div class="hs-panel hs-plugins"><p class="hs-note">Загрузка…</p></div>';
  else panel.innerHTML = settingsHtml(server);
  panel.querySelectorAll<HTMLElement>('.stngs-select-wrap').forEach(bindSelect);
  if (editorTab === 'dashboard') bindDashboard();
  if (editorTab === 'console') await fillConsole(server.id);
  if (editorTab === 'players') await fillPlayers(server.id);
  if (editorTab === 'files') await fillFiles(server.id);
  if (editorTab === 'plugins') await fillPlugins(server.id);
  if (editorTab === 'settings') bindSettings(server);
}

// ===== Команды и игроки консоли, как в чате Minecraft =====

const onlinePlayers = new Map<string, Map<string, { name: string; uuid: string }>>();
const knownUuids = new Map<string, Map<string, string>>();
let suggestAt = 0;
const SUGGEST_PAGE = 32;
let suggestShown = SUGGEST_PAGE;
let suggestQuery = '';
let commandHistory: string[] = [];
let historyAt = -1;
let commandFlight = false;

function roster(id: string): Map<string, { name: string; uuid: string }> {
  let map = onlinePlayers.get(id);
  if (!map) {
    map = new Map();
    onlinePlayers.set(id, map);
  }
  return map;
}

function headOf(name: string): string {
  return skinImageUrl(`https://mc-heads.net/avatar/${encodeURIComponent(name)}/32`);
}

function suggestPlayers(id: string): SuggestPlayer[] {
  return [...roster(id).values()].map((row) => ({ name: row.name, head: headOf(row.name) }));
}

function onlineNames(id: string): string[] {
  return [...roster(id).values()].map((row) => row.name).sort((a, b) => a.localeCompare(b, 'ru'));
}

function prunePlayerSelection(id: string): void {
  const online = new Set(onlineNames(id));
  for (const name of [...playerSelected]) {
    if (!online.has(name)) playerSelected.delete(name);
  }
}

function playerListHtml(id: string): string {
  const names = onlineNames(id);
  if (!names.length) return '<p class="hs-note">Никого нет на сервере</p>';
  return names.map((name) => {
    const on = playerSelected.has(name);
    return `<div class="hs-file hs-player-row${on ? ' is-on' : ''}">
      <input class="hs-check" type="checkbox" data-player-check="${esc(name)}"${on ? ' checked' : ''}>
      <img class="hs-head" src="${esc(headOf(name))}" alt="" onerror="this.remove()">
      <span class="hs-file__name">${esc(name)}</span>
      <button type="button" class="hs-more" data-player-menu="${esc(name)}" title="Действия"><i></i><i></i><i></i></button>
    </div>`;
  }).join('');
}

function paintPlayers(id: string): void {
  if (openId !== id) return;
  prunePlayerSelection(id);
  const list = document.getElementById('hs-roster');
  const title = document.getElementById('hs-roster-count');
  if (list && editorTab === 'players') {
    const names = onlineNames(id);
    list.innerHTML = playerListHtml(id);
    if (title) title.textContent = `Онлайн ${names.length}`;
    const all = document.getElementById('host-player-all') as HTMLInputElement | null;
    const acts = document.getElementById('hs-player-acts');
    if (all) all.checked = names.length > 0 && names.every((name) => playerSelected.has(name));
    if (acts) acts.hidden = playerSelected.size === 0;
  }
  if (editorTab === 'console') paintCommandUi();
}

function plainLog(line: string): string {
  return line.replace(/^\[[^\]]+\]:\s*/, '').replace(/^\[[^\]]+\]\s*/, '').replace(/^System chat:\s*/i, '').trim();
}

function rememberUuid(id: string, name: string, uuid: string): void {
  let map = knownUuids.get(id);
  if (!map) {
    map = new Map();
    knownUuids.set(id, map);
  }
  map.set(name.toLowerCase(), uuid);
  const online = roster(id).get(name.toLowerCase());
  if (online) online.uuid = uuid;
}

function addPlayer(id: string, name: string): void {
  const key = name.toLowerCase();
  const uuid = knownUuids.get(id)?.get(key) || '';
  roster(id).set(key, { name, uuid });
}

function notePlayerLine(id: string, line: string, paint = true): void {
  const text = plainLog(line);
  const help = text.match(/^(\/+[A-Za-z0-9_.:/-]+):\s+(.+)$/);
  if (help) learnHelpCommand(help[1], help[2]);
  const uuid = text.match(/^UUID of player ([A-Za-z0-9_]{1,16}) is ([0-9a-fA-F-]{32,36})\b/);
  if (uuid) {
    rememberUuid(id, uuid[1], uuid[2]);
    return;
  }
  const list = text.match(/^There are (\d+) of a max of \d+ players online:?\s*(.*)$/i);
  if (list) {
    const names = (list[2] || '').split(',').map((name) => name.trim()).filter((name) => /^[A-Za-z0-9_]{1,16}$/.test(name));
    const next = new Map<string, { name: string; uuid: string }>();
    for (const name of names) next.set(name.toLowerCase(), { name, uuid: knownUuids.get(id)?.get(name.toLowerCase()) || '' });
    onlinePlayers.set(id, next);
    if (paint) paintPlayers(id);
    return;
  }
  const logged = text.match(/^([A-Za-z0-9_]{1,16})\[\/[^\]]+\] logged in\b/);
  const joined = text.match(/^([A-Za-z0-9_]{1,16}) (?:joined the game|присоединился к игре|зашёл в игру|зашел в игру)\b/);
  const left = text.match(/^([A-Za-z0-9_]{1,16}) (?:left the game|lost connection|вышел из игры|покинул игру|потерял соединение)\b/);
  const name = logged?.[1] || joined?.[1];
  if (name) addPlayer(id, name);
  if (left) roster(id).delete(left[1].toLowerCase());
  if (!name && !left) return;
  if (paint) paintPlayers(id);
}

function rebuildPlayers(id: string, lines: string[]): void {
  onlinePlayers.set(id, new Map());
  resetLearned();
  for (const line of lines) notePlayerLine(id, line, false);
  paintPlayers(id);
}

function rememberNames(rows: CatalogEntry[]): void {
  for (const row of rows) {
    if (row.name) commandLabels[row.id] = row.name;
  }
}

async function loadCommandCatalog(version: string): Promise<void> {
  if (!version) return;
  if (catalogVersion === version && commandRegs.item.length) return;
  const token = ++catalogToken;
  const payload = await api()?.commandCatalog?.(version);
  if (!payload?.ok || token !== catalogToken) return;
  commandRegs = {
    item: payload.items.map((row) => row.id),
    block: payload.blocks.map((row) => row.id),
    entity: payload.entities.map((row) => row.id),
    effect: payload.effects.map((row) => row.id),
    enchant: payload.enchantments.map((row) => row.id),
    biome: payload.biomes.map((row) => row.id),
    structure: payload.structures.map((row) => row.id),
    particle: payload.particles.map((row) => row.id),
    attribute: payload.attributes.map((row) => row.id),
    feature: payload.features.map((row) => row.id),
    damage: payload.damageTypes.map((row) => row.id),
    slot: [],
  };
  rememberNames(payload.items);
  rememberNames(payload.blocks);
  rememberNames(payload.entities);
  rememberNames(payload.effects);
  rememberNames(payload.enchantments);
  rememberNames(payload.biomes);
  catalogVersion = version;
  paintCommandUi();
}

async function hydrateIcons(ids: string[]): Promise<void> {
  const pending = [...new Set(ids.filter((id) => !commandIcons.has(id) && !iconMiss.has(id)))];
  if (!pending.length || !catalogVersion) return;
  for (let offset = 0; offset < pending.length; offset += 48) {
    const missing = pending.slice(offset, offset + 48);
    const got = await api()?.commandCatalogIcons?.(catalogVersion, missing) || {};
    const box = document.getElementById('host-suggest');
    for (const id of missing) {
      const url = got[id] || got[id.toLowerCase()] || '';
      if (url) commandIcons.set(id, url);
      else iconMiss.add(id);
      if (!url || !box) continue;
      const slot = box.querySelector<HTMLElement>(`[data-icon="${CSS.escape(id)}"]`);
      if (slot && !slot.querySelector('img')) slot.innerHTML = `<img src="${esc(url)}" alt="">`;
    }
  }
}

function colorizeCommand(raw: string, players: SuggestPlayer[]): string {
  if (!raw) return '';
  const double = raw.startsWith('//');
  const slash = raw.startsWith('/') && !double;
  let body = raw;
  if (double) body = raw.slice(1);
  else if (slash) body = raw.slice(1);
  const parts: string[] = [];
  if (double) parts.push('<span class="is-text">/</span>');
  else if (slash) parts.push('<span class="is-text">/</span>');
  const bits = body.match(/\s+|\S+/g) || [];
  let cmd = '';
  const prev: string[] = [];
  for (const bit of bits) {
    if (/^\s+$/.test(bit)) {
      parts.push(esc(bit));
      continue;
    }
    if (!cmd) {
      cmd = bit.toLowerCase();
      parts.push(`<span class="${bit && !knownCommand(cmd) ? 'is-bad' : 'is-cmd'}">${esc(bit)}</span>`);
      continue;
    }
    parts.push(`<span class="${tokenClass(cmd, prev, bit, players, commandRegs)}">${esc(bit)}</span>`);
    prev.push(bit);
  }
  return parts.join('');
}

function applySuggestion(input: HTMLInputElement, text: string): void {
  const raw = input.value;
  const { words } = splitCommand(raw);
  const prefix = raw.startsWith('//') || raw.startsWith('/') ? '/' : '';
  input.value = `${prefix}${[...words, text].join(' ')} `;
  historyAt = -1;
  paintCommandUi();
  input.focus();
}

function paintCommandUi(keepScroll = false): void {
  const input = document.getElementById('host-command') as HTMLInputElement | null;
  const hl = document.getElementById('host-command-hl');
  const box = document.getElementById('host-suggest');
  const form = document.getElementById('host-command-form');
  if (!input || !hl || !box || !form) return;
  const players = suggestPlayers(openId || '');
  if (input.value !== suggestQuery) {
    suggestQuery = input.value;
    suggestAt = 0;
    suggestShown = SUGGEST_PAGE;
  }
  form.classList.toggle('is-typed', input.value.length > 0);
  hl.innerHTML = colorizeCommand(input.value, players);
  hl.scrollLeft = input.scrollLeft;
  const rows = input.value.trim() ? suggestFor(input.value, players, commandRegs, commandLabels) : [];
  if (!rows.length) {
    box.hidden = true;
    box.innerHTML = '';
    suggestAt = 0;
    suggestShown = SUGGEST_PAGE;
    return;
  }
  if (suggestAt >= rows.length) suggestAt = 0;
  suggestShown = Math.min(rows.length, Math.max(suggestShown, suggestAt + 1));
  const visible = rows.slice(0, suggestShown);
  const scroll = box.scrollTop;
  box.hidden = false;
  box.innerHTML = visible.map((row, index) => {
    const icon = row.icon ? commandIcons.get(row.icon) : '';
    const mark = row.head
      ? `<img class="hs-head" src="${esc(row.head)}" alt="" onerror="this.remove()">`
      : (row.icon ? `<span class="hs-icon" data-icon="${esc(row.icon)}">${icon ? `<img src="${esc(icon)}" alt="">` : ''}</span>` : '');
    return `<button type="button" class="hs-suggest__row${index === suggestAt ? ' is-on' : ''}" data-suggest="${esc(row.text)}"><span class="hs-suggest__main">${mark}<span>${esc(row.text)}</span></span>${row.hint ? `<span class="hs-suggest__hint">${esc(row.hint)}</span>` : ''}</button>`;
  }).join('');
  if (keepScroll) box.scrollTop = scroll;
  else box.querySelector('.is-on')?.scrollIntoView({ block: 'nearest' });
  void hydrateIcons(visible.map((row) => row.icon).filter((id): id is string => !!id));
}

function consoleHtml(): string {
  return `<div class="hs-panel hs-console">
    <div class="hs-console__well">
      <div class="hs-console__log console-body" id="host-console-body" role="list"></div>
      <form class="hs-console__ask" id="host-command-form">
        <div class="hs-suggest" id="host-suggest" hidden></div>
        <div class="hs-cmd">
          <pre class="hs-cmd__hl" id="host-command-hl"></pre>
          <input class="hs-cmd__input" id="host-command" placeholder=" " autocomplete="off" spellcheck="false" aria-label="Команда" aria-autocomplete="list">
        </div>
        <span class="hs-console__ghost">Введите команду. Подсказки открываются сами, список команд: <span class="hs-kbd">/help</span></span>
      </form>
    </div>
  </div>`;
}

async function fillConsole(id: string): Promise<void> {
  const body = document.getElementById('host-console-body');
  const lines = (await api()?.hostedServersLog?.(id)) || [];
  const plugins = (await api()?.hostedServersPlugins?.(id)) || [];
  setJarCommands(plugins.filter((row) => row.enabled !== false).flatMap((row) => row.commands || []));
  rebuildPlayers(id, lines);
  void loadCommandCatalog(current()?.gameVersion || '');
  if (body) {
    body.innerHTML = lines.map((line) => logEntry(line)).join('');
    body.scrollTop = body.scrollHeight;
  }
  const panel = document.getElementById('host-modal-panel');
  panel?.querySelectorAll<HTMLElement>('[data-host-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      panel.querySelectorAll('[data-host-filter]').forEach((node) => node.classList.remove('active'));
      btn.classList.add('active');
      const onlyErrors = btn.dataset.hostFilter === 'error';
      body?.querySelectorAll<HTMLElement>('.clog-entry').forEach((entry) => {
        entry.hidden = onlyErrors && !entry.classList.contains('clog-entry--error') && !entry.classList.contains('clog-entry--warn');
      });
    });
  });
  document.getElementById('host-copy-log')?.addEventListener('click', () => {
    void navigator.clipboard.writeText(lines.join('\n')).catch(() => undefined);
  });
  const input = document.getElementById('host-command') as HTMLInputElement | null;
  const form = document.getElementById('host-command-form') as HTMLFormElement | null;
  // Enter и так шлёт submit. Один обработчик, иначе команда уходит дважды.
  if (form) {
    form.onsubmit = (event) => {
      event.preventDefault();
      void sendCommand(id);
    };
  }
  input?.addEventListener('input', () => {
    historyAt = -1;
    suggestAt = 0;
    suggestShown = SUGGEST_PAGE;
    paintCommandUi();
  });
  input?.addEventListener('scroll', () => {
    const hl = document.getElementById('host-command-hl');
    if (hl) hl.scrollLeft = input.scrollLeft;
  });
  input?.addEventListener('focus', () => paintCommandUi());
  input?.addEventListener('blur', () => {
    const box = document.getElementById('host-suggest');
    if (!box) return;
    box.hidden = true;
    box.innerHTML = '';
  });
  input?.addEventListener('keydown', (event) => {
    const key = event.key;
    const open = !document.getElementById('host-suggest')?.hidden;
    if (key === 'Enter') {
      event.preventDefault();
      void sendCommand(id);
      return;
    }
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      const rows = suggestFor(input.value, suggestPlayers(id), commandRegs, commandLabels);
      if (open && rows.length) {
        event.preventDefault();
        if (key === 'ArrowDown') {
          if (suggestAt >= rows.length - 1) {
            suggestAt = 0;
          } else {
            suggestAt += 1;
            if (suggestAt >= suggestShown) suggestShown = Math.min(rows.length, suggestAt + SUGGEST_PAGE);
          }
        } else if (suggestAt <= 0) {
          suggestAt = Math.min(rows.length, suggestShown) - 1;
        } else {
          suggestAt -= 1;
        }
        paintCommandUi();
        return;
      }
      if (!input.value || input.selectionStart === 0) {
        if (!commandHistory.length) return;
        event.preventDefault();
        if (key === 'ArrowUp') historyAt = Math.min(commandHistory.length - 1, historyAt + 1);
        else historyAt = Math.max(-1, historyAt - 1);
        input.value = historyAt < 0 ? '' : commandHistory[historyAt];
        suggestAt = 0;
        suggestShown = SUGGEST_PAGE;
        paintCommandUi();
      }
      return;
    }
    if (key === 'Tab' && open) {
      event.preventDefault();
      const chosen = document.querySelector<HTMLElement>('#host-suggest .is-on')?.dataset.suggest;
      if (chosen) applySuggestion(input, chosen);
      return;
    }
    if (key === 'Escape' && open) {
      event.preventDefault();
      const box = document.getElementById('host-suggest');
      if (box) {
        box.hidden = true;
        box.innerHTML = '';
      }
    }
  });
  document.getElementById('host-suggest')?.addEventListener('scroll', () => {
    const box = document.getElementById('host-suggest');
    if (!box || box.hidden || !input) return;
    if (box.scrollTop + box.clientHeight < box.scrollHeight - 56) return;
    const total = suggestFor(input.value, suggestPlayers(id), commandRegs, commandLabels).length;
    if (suggestShown >= total) return;
    suggestShown = Math.min(total, suggestShown + SUGGEST_PAGE);
    paintCommandUi(true);
  });
  document.getElementById('host-suggest')?.addEventListener('mousedown', (event) => {
    const btn = (event.target as HTMLElement).closest<HTMLElement>('[data-suggest]');
    if (!btn || !input) return;
    event.preventDefault();
    applySuggestion(input, btn.dataset.suggest || '');
  });
}

async function fillPlayers(id: string): Promise<void> {
  const panel = document.getElementById('host-modal-panel');
  if (!panel) return;
  panel.innerHTML = `<div class="hs-panel hs-files">
    <div class="hs-files__bar"><span class="hs-roster__title" id="hs-roster-count">Онлайн 0</span></div>
    <div class="hs-files__rule"></div>
    <div class="hs-files__all">
      <input class="hs-check" type="checkbox" id="host-player-all">
      <span>Выбрать все</span>
      <div class="hs-files__acts" id="hs-player-acts" hidden>
        <button type="button" class="hs-textbtn" id="host-player-bulk">Действия</button>
      </div>
    </div>
    <div class="hs-files__list" id="hs-roster"></div>
  </div>`;
  panel.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement;
    if (target.id === 'host-player-all') {
      playerSelected = new Set(target.checked ? onlineNames(id) : []);
      paintPlayers(id);
      return;
    }
    const name = target.dataset.playerCheck;
    if (!name) return;
    if (target.checked) playerSelected.add(name);
    else playerSelected.delete(name);
    paintPlayers(id);
  });
  panel.addEventListener('click', (event) => {
    const bulk = (event.target as HTMLElement).closest<HTMLElement>('#host-player-bulk');
    const btn = (event.target as HTMLElement).closest<HTMLElement>('[data-player-menu]');
    if (!bulk && !btn) return;
    event.stopPropagation();
    if (bulk) {
      const names = [...playerSelected];
      if (names.length) openPlayerMenu(id, bulk, names);
      return;
    }
    const name = btn?.dataset.playerMenu || '';
    if (!name) return;
    const names = playerSelected.has(name) && playerSelected.size > 1 ? [...playerSelected] : [name];
    openPlayerMenu(id, btn!, names);
  });
  const lines = (await api()?.hostedServersLog?.(id)) || [];
  if (openId !== id || editorTab !== 'players') return;
  onlinePlayers.set(id, new Map());
  for (const line of lines) notePlayerLine(id, line, false);
  paintPlayers(id);
}

async function dispatchCommand(id: string, raw: string): Promise<void> {
  const typed = raw.trim();
  const text = typed.startsWith('//') ? typed : typed.replace(/^\//, '');
  if (!text || commandFlight) return;
  commandFlight = true;
  commandHistory = [text, ...commandHistory.filter((row) => row !== text)].slice(0, 40);
  historyAt = -1;
  try {
    await api()?.hostedServersCommand?.(id, text);
  } finally {
    commandFlight = false;
  }
}

function playerCommand(act: string, name: string, extra = ''): string {
  if (act === 'msg') return `msg ${name} ${extra}`;
  if (act === 'kick') return `kick ${name}`;
  if (act === 'ban') return `ban ${name}`;
  if (act === 'pardon') return `pardon ${name}`;
  if (act === 'op') return `op ${name}`;
  if (act === 'deop') return `deop ${name}`;
  if (act === 'gm-survival') return `gamemode survival ${name}`;
  if (act === 'gm-creative') return `gamemode creative ${name}`;
  if (act === 'gm-adventure') return `gamemode adventure ${name}`;
  if (act === 'gm-spectator') return `gamemode spectator ${name}`;
  if (act === 'wl-add') return `whitelist add ${name}`;
  if (act === 'wl-remove') return `whitelist remove ${name}`;
  if (act === 'clear') return `clear ${name}`;
  if (act === 'kill') return `kill ${name}`;
  return '';
}

function playerActLabel(names: string[]): string {
  return names.length === 1 ? names[0] : `${names.length} игроков`;
}

async function runPlayerAction(id: string, names: string[], act: string): Promise<void> {
  const list = names.filter(Boolean);
  if (!list.length) return;
  const who = playerActLabel(list);
  let extra = '';
  if (act === 'msg') {
    const text = await askHost(`Сообщение для ${who}`, 'Текст сообщения');
    if (!text) return;
    extra = text;
  } else if (act === 'ban') {
    const ok = await confirmHost(`Забанить ${who}?`, 'Забанить');
    if (!ok) return;
  } else if (act === 'kill') {
    const ok = await confirmHost(`Убить ${who}?`, 'Убить');
    if (!ok) return;
  }
  for (const name of list) {
    const command = playerCommand(act, name, extra);
    if (command) await dispatchCommand(id, command);
  }
}

function closePlayerMenu(): void {
  document.getElementById('hs-player-menu')?.classList.remove('is-open');
}

function playerMenuRoot(): HTMLElement {
  let menu = document.getElementById('hs-player-menu');
  if (menu) return menu;
  menu = document.createElement('div');
  menu.id = 'hs-player-menu';
  menu.setAttribute('role', 'menu');
  document.body.appendChild(menu);
  menu.addEventListener('click', (event) => event.stopPropagation());
  document.addEventListener('click', () => closePlayerMenu());
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closePlayerMenu();
  });
  return menu;
}

function playerMenuIcon(markup: string): string {
  return `<svg class="hs-pmenu__ico" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">${markup}</svg>`;
}

function openPlayerMenu(id: string, btn: HTMLElement, names: string[]): void {
  const list = names.filter(Boolean);
  if (!list.length) return;
  const key = list.slice().sort().join('\n');
  closeFileMenu();
  const menu = playerMenuRoot();
  if (menu.dataset.player === key && menu.classList.contains('is-open')) {
    closePlayerMenu();
    return;
  }
  menu.dataset.player = key;
  const stroke = 'stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"';
  const item = (act: string, label: string, icon: string, danger = false) => `<button type="button" role="menuitem"${danger ? ' class="is-danger"' : ''} data-act="${act}">${playerMenuIcon(icon)}<span>${label}</span></button>`;
  menu.innerHTML = `${item('msg', 'Сообщение', `<path d="M2.2 3.2h9.6v6.1H7.3L5 11.3V9.3H2.2V3.2Z" ${stroke}/>`)}
    ${item('kick', 'Кикнуть', `<path d="M6 7h5.2M8.8 4.6 11.2 7 8.8 9.4" ${stroke}/><path d="M2.4 3.4v7.2" ${stroke}/>`)}
    ${item('ban', 'Забанить', `<circle cx="7" cy="7" r="4.4" ${stroke}/><path d="m4.1 9.9 5.8-5.8" ${stroke}/>`, true)}
    ${item('pardon', 'Разбанить', `<path d="M3.2 7.2 5.8 9.7 10.8 4.4" ${stroke}/>`)}
    ${item('op', 'Сделать оператором', `<path d="M7 1.8 11.4 3.6v3.2c0 2.3-1.6 4-4.4 5.1-2.8-1.1-4.4-2.8-4.4-5.1V3.6L7 1.8Z" ${stroke}/>`)}
    ${item('deop', 'Снять оператора', `<path d="M7 1.8 11.4 3.6v3.2c0 2.3-1.6 4-4.4 5.1-2.8-1.1-4.4-2.8-4.4-5.1V3.6L7 1.8Z" ${stroke}/><path d="m4 10 6-6" ${stroke}/>`)}
    ${item('gm-survival', 'Выживание', `<path d="M8.2 2.2 11.6 5.6 6.2 11.2 2.6 11.4 2.8 7.8 8.2 2.2Z" ${stroke}/>`)}
    ${item('gm-creative', 'Творчество', `<path d="M7 1.8 12 4.6 7 7.4 2 4.6 7 1.8Z" ${stroke}/><path d="M2 4.6v4.8L7 12.2l5-2.8V4.6" ${stroke}/>`)}
    ${item('gm-adventure', 'Приключение', `<circle cx="7" cy="7" r="4.4" ${stroke}/><path d="M7 2.6v2.2M7 9.2v2.2M2.6 7h2.2M9.2 7h2.2" ${stroke}/>`)}
    ${item('gm-spectator', 'Наблюдение', `<path d="M1.6 7S3.6 3.6 7 3.6 12.4 7 12.4 7 10.4 10.4 7 10.4 1.6 7 1.6 7Z" ${stroke}/><circle cx="7" cy="7" r="1.5" ${stroke}/>`)}
    ${item('wl-add', 'В белый список', `<path d="M7 3.2v7.6M3.2 7h7.6" ${stroke}/>`)}
    ${item('wl-remove', 'Убрать из белого списка', `<path d="M3.2 7h7.6" ${stroke}/>`)}
    ${item('clear', 'Очистить инвентарь', `<path d="M3.2 4.2h7.6M5.4 4.2V3h3.2v1.2M4.4 4.2l.5 7h4.2l.5-7" ${stroke}/>`)}
    ${item('kill', 'Убить', `<path d="M3.2 3.2 10.8 10.8M10.8 3.2 3.2 10.8" ${stroke}/>`, true)}`;
  const rect = btn.getBoundingClientRect();
  const width = menu.offsetWidth || 240;
  const height = menu.offsetHeight || 360;
  let top = rect.bottom + 6;
  let origin = 'top right';
  if (top + height > window.innerHeight - 8) {
    top = Math.max(8, rect.top - height - 6);
    origin = 'bottom right';
  }
  const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.style.transformOrigin = origin;
  menu.classList.remove('is-open');
  requestAnimationFrame(() => menu.classList.add('is-open'));
  menu.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((row) => {
    row.addEventListener('click', () => {
      const act = row.dataset.act || '';
      closePlayerMenu();
      void runPlayerAction(id, list, act);
    });
  });
}

async function sendCommand(id: string): Promise<void> {
  if (commandFlight) return;
  const input = document.getElementById('host-command') as HTMLInputElement | null;
  const typed = input?.value.trim() || '';
  const text = typed.startsWith('//') ? typed : typed.replace(/^\//, '');
  if (!text) return;
  commandFlight = true;
  commandHistory = [text, ...commandHistory.filter((row) => row !== text)].slice(0, 40);
  historyAt = -1;
  if (input) {
    input.value = '';
    paintCommandUi();
  }
  try {
    await api()?.hostedServersCommand?.(id, text);
  } finally {
    commandFlight = false;
  }
}

const ICON_TRASH = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M4 1C4 .45 4.45 0 5 0h4c.55 0 1 .45 1 1H4Z" fill="currentColor"/><path d="M1 2c0-.55.45-1 1-1h10c.55 0 1 .45 1 1s-.45 1-1 1H2c-.55 0-1-.45-1-1Z" fill="currentColor"/><path d="M2.11 5.1A1.1 1.1 0 0 1 3.1 4h7.8a1.1 1.1 0 0 1 1 1.1l-.8 8a1 1 0 0 1-1 .9H3.9a1 1 0 0 1-1-.9l-.8-8Z" fill="currentColor"/></svg>';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

function stopPluginScroll(): void {
  pluginObserver?.disconnect();
  pluginObserver = null;
}

function crumbsHtml(): string {
  const parts = fileRel ? fileRel.split('/').filter(Boolean) : [];
  const bits = ['<button type="button" data-crumb="">Сервер</button>'];
  let acc = '';
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    bits.push(`<img class="host-crumbs__sep" src="${HOST_ASSET}/slash.svg" alt="">`);
    bits.push(`<button type="button" data-crumb="${esc(acc)}">${esc(part)}</button>`);
  }
  bits.push(`<img class="host-crumbs__sep" src="${HOST_ASSET}/slash.svg" alt="">`);
  return bits.join('');
}

function fileIcon(name: string, dir: boolean): string {
  const lower = name.toLowerCase();
  if (dir) return lower === 'config' ? 'filesIcons/config.svg' : 'filesIcons/folder.svg';
  if (/\.jar(\.disabled)?$/.test(lower)) return 'filesIcons/jar.svg';
  if (lower.endsWith('.properties')) return 'filesIcons/properties.svg';
  if (/\.ya?ml$/.test(lower)) return 'filesIcons/yml.svg';
  if (/\.(png|jpe?g|gif|webp|bmp|ico|svg)$/.test(lower)) return 'filesIcons/image.svg';
  if (/\.(toml|conf|cfg|ini|json)$/.test(lower)) return 'filesIcons/config.svg';
  return 'filesIcons/file.svg';
}

function joinRel(base: string, name: string): string {
  return base ? `${base}/${name}` : name;
}

async function fillFiles(id: string): Promise<void> {
  closeFileMenu();
  const panel = document.getElementById('host-modal-panel');
  const res = await api()?.hostedServersFiles?.(id, fileRel);
  const entries = res?.entries || [];
  if (!panel) return;
  const rows = entries.map((entry) => {
    const rel = joinRel(fileRel, entry.name);
    const on = fileSelected.has(rel) ? ' is-on' : '';
    return `<div class="hs-file${entry.dir ? ' is-dir' : ''}${on}" data-file="${esc(entry.name)}" data-dir="${entry.dir ? '1' : '0'}">
      <input class="hs-check" type="checkbox" data-file-check="${esc(rel)}"${fileSelected.has(rel) ? ' checked' : ''}>
      <span class="hs-file__ico">${hostAsset(fileIcon(entry.name, entry.dir))}</span>
      <span class="hs-file__name">${esc(entry.name)}</span>
      <button type="button" class="hs-more" data-file-menu="${esc(entry.name)}" data-file-dir="${entry.dir ? '1' : '0'}" data-file-size="${entry.size}" title="Действия"><i></i><i></i><i></i></button>
    </div>`;
  }).join('');
  const clip = fileClip
    ? `<div class="hs-clip">${fileClip.mode === 'move' ? 'Перенос' : 'Копирование'}: ${fileClip.rels.length}. Откройте папку и подтвердите.
        <button type="button" class="hs-textbtn" id="host-file-paste">Вставить сюда</button>
        <button type="button" class="hs-textbtn" id="host-file-clip-cancel">Отмена</button>
      </div>`
    : '';
  const allOn = entries.length > 0 && entries.every((entry) => fileSelected.has(joinRel(fileRel, entry.name)));
  panel.innerHTML = `<div class="hs-panel hs-files">
    <div class="hs-files__bar">
      <button type="button" class="hs-navbtn" id="host-file-back" title="Назад" ${fileBack.length ? '' : 'disabled'}>${ICON_BACK}</button>
      <button type="button" class="hs-navbtn" id="host-file-fwd" title="Вперёд" ${fileForward.length ? '' : 'disabled'}>${ICON_FWD}</button>
      <nav class="hs-crumbs" aria-label="Путь">${crumbsHtml()}</nav>
      <button type="button" class="hs-navbtn" id="host-file-add" title="Загрузить">${ICON_UPLOAD}</button>
    </div>
    <div class="hs-files__rule"></div>
    <div class="hs-files__all">
      <input class="hs-check" type="checkbox" id="host-file-all"${allOn ? ' checked' : ''}>
      <span>Выбрать все</span>
      <div class="hs-files__acts"${fileSelected.size ? '' : ' hidden'}>
        <button type="button" class="hs-textbtn" id="host-file-move" ${fileSelected.size ? '' : 'disabled'}>Перенести</button>
        <button type="button" class="hs-textbtn" id="host-file-copy" ${fileSelected.size ? '' : 'disabled'}>Копировать</button>
        <button type="button" class="hs-textbtn is-danger" id="host-file-del" ${fileSelected.size ? '' : 'disabled'}>Удалить выбранное</button>
      </div>
    </div>
    ${clip}
    <div class="hs-files__list">
      ${rows || '<p class="hs-note">Папка пустая</p>'}
    </div>
    ${res?.error ? `<p class="hs-note">${esc(res.error)}</p>` : ''}
  </div>`;
  const go = (rel: string, push = true) => {
    if (push && rel !== fileRel) {
      fileBack.push(fileRel);
      fileForward = [];
    }
    fileRel = rel;
    fileSelected = new Set();
    void fillFiles(id);
  };
  panel.querySelector('#host-file-back')?.addEventListener('click', () => {
    const prev = fileBack.pop();
    if (prev === undefined) return;
    fileForward.push(fileRel);
    fileRel = prev;
    fileSelected = new Set();
    void fillFiles(id);
  });
  panel.querySelector('#host-file-fwd')?.addEventListener('click', () => {
    const next = fileForward.pop();
    if (next === undefined) return;
    fileBack.push(fileRel);
    fileRel = next;
    fileSelected = new Set();
    void fillFiles(id);
  });
  panel.querySelectorAll<HTMLElement>('[data-crumb]').forEach((btn) => {
    btn.addEventListener('click', () => go(btn.dataset.crumb || ''));
  });
  panel.querySelector('#host-file-add')?.addEventListener('click', async () => {
    await api()?.hostedServersFileImport?.(id, fileRel);
    await fillFiles(id);
  });
  panel.querySelector('#host-file-all')?.addEventListener('change', (event) => {
    const on = (event.target as HTMLInputElement).checked;
    fileSelected = new Set(on ? entries.map((entry) => joinRel(fileRel, entry.name)) : []);
    void fillFiles(id);
  });
  panel.querySelectorAll<HTMLInputElement>('[data-file-check]').forEach((input) => {
    input.addEventListener('click', (event) => event.stopPropagation());
    input.addEventListener('change', () => {
      const rel = input.dataset.fileCheck || '';
      if (input.checked) fileSelected.add(rel);
      else fileSelected.delete(rel);
      void fillFiles(id);
    });
  });
  const arm = (mode: 'copy' | 'move') => {
    if (!fileSelected.size) return;
    fileClip = { mode, rels: [...fileSelected] };
    void fillFiles(id);
  };
  panel.querySelector('#host-file-copy')?.addEventListener('click', () => arm('copy'));
  panel.querySelector('#host-file-move')?.addEventListener('click', () => arm('move'));
  panel.querySelector('#host-file-clip-cancel')?.addEventListener('click', () => {
    fileClip = null;
    void fillFiles(id);
  });
  panel.querySelector('#host-file-paste')?.addEventListener('click', () => void pasteFiles(id));
  panel.querySelector('#host-file-del')?.addEventListener('click', () => void deleteSelected(id));
  panel.querySelectorAll<HTMLElement>('.hs-file').forEach((row) => {
    row.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('[data-file-menu], [data-file-check]')) return;
      if (row.dataset.dir !== '1') return;
      go(joinRel(fileRel, row.dataset.file || ''));
    });
  });
  panel.querySelectorAll<HTMLElement>('[data-file-menu]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      openFileMenu(id, btn);
    });
  });
}

function closeFileMenu(): void {
  document.getElementById('hs-file-menu')?.classList.remove('is-open');
}

function fileMenuRoot(): HTMLElement {
  let menu = document.getElementById('hs-file-menu');
  if (menu) return menu;
  menu = document.createElement('div');
  menu.id = 'hs-file-menu';
  menu.setAttribute('role', 'menu');
  document.body.appendChild(menu);
  menu.addEventListener('click', (event) => event.stopPropagation());
  document.addEventListener('click', () => closeFileMenu());
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeFileMenu();
  });
  return menu;
}

function openFileMenu(id: string, btn: HTMLElement): void {
  closePlayerMenu();
  const name = btn.dataset.fileMenu || '';
  const dir = btn.dataset.fileDir === '1';
  const size = Number(btn.dataset.fileSize || 0);
  const rel = joinRel(fileRel, name);
  const menu = fileMenuRoot();
  if (menu.dataset.rel === rel && menu.classList.contains('is-open')) {
    closeFileMenu();
    return;
  }
  menu.dataset.player = '';
  menu.dataset.rel = rel;
  const pathLabel = rel || name;
  menu.innerHTML = `${dir ? '<button type="button" data-act="open">Открыть</button>' : ''}
    <button type="button" data-act="copy">Копировать</button>
    <button type="button" data-act="move">Перенести</button>
    <div class="hs-filemenu__sep"></div>
    <button type="button" class="is-danger" data-act="del">Удалить</button>
    <div class="hs-filemenu__sep"></div>
    <div class="hs-filemenu__meta">
      <div><span>Имя</span><b>${esc(name)}</b></div>
      <div><span>Тип</span><b>${dir ? 'Папка' : 'Файл'}</b></div>
      <div><span>Размер</span><b>${dir ? '—' : formatSize(size)}</b></div>
      <div><span>Путь</span><b>${esc(pathLabel)}</b></div>
    </div>`;
  const rect = btn.getBoundingClientRect();
  const width = menu.offsetWidth || 240;
  const height = menu.offsetHeight || 220;
  let top = rect.bottom + 6;
  let origin = 'top right';
  if (top + height > window.innerHeight - 8) {
    top = Math.max(8, rect.top - height - 6);
    origin = 'bottom right';
  }
  const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.style.transformOrigin = origin;
  menu.classList.remove('is-open');
  requestAnimationFrame(() => menu.classList.add('is-open'));
  menu.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((item) => {
    item.addEventListener('click', () => {
      const act = item.dataset.act;
      closeFileMenu();
      if (act === 'open' && dir) {
        fileBack.push(fileRel);
        fileForward = [];
        fileRel = rel;
        fileSelected = new Set();
        void fillFiles(id);
        return;
      }
      if (act === 'copy' || act === 'move') {
        fileClip = { mode: act, rels: [rel] };
        void fillFiles(id);
        return;
      }
      if (act === 'del') {
        void (async () => {
          const ok = await confirmHost(`Удалить «${name}»?`);
          if (!ok) return;
          await api()?.hostedServersFileDelete?.(id, rel);
          fileSelected.delete(rel);
          await fillFiles(id);
        })();
      }
    });
  });
}

async function deleteSelected(id: string): Promise<void> {
  if (!fileSelected.size) return;
  const ok = await confirmHost(`Удалить выбранное (${fileSelected.size})?`);
  if (!ok) return;
  for (const rel of fileSelected) await api()?.hostedServersFileDelete?.(id, rel);
  fileSelected = new Set();
  await fillFiles(id);
}

async function pasteFiles(id: string): Promise<void> {
  if (!fileClip) return;
  const host = api();
  if (!host?.hostedServersFileTransfer) {
    fileClip = null;
    const panel = document.getElementById('host-modal-panel');
    panel?.insertAdjacentHTML('afterbegin', '<p class="hs-note">Перезапустите лаунчер, чтобы переносить файлы.</p>');
    return;
  }
  const res = await host.hostedServersFileTransfer(id, fileClip.mode, fileClip.rels, fileRel);
  fileClip = null;
  fileSelected = new Set();
  if (res && res.ok === false) {
    await fillFiles(id);
    document.getElementById('host-modal-panel')?.insertAdjacentHTML('beforeend', `<p class="hs-note">${esc(res.error || 'Не удалось')}</p>`);
    return;
  }
  await fillFiles(id);
}

function catalogSpec(software: string): { type: string; loaders: string[] } {
  if (software === 'fabric') return { type: 'mod', loaders: ['fabric'] };
  if (software === 'quilt') return { type: 'mod', loaders: ['quilt', 'fabric'] };
  if (software === 'velocity') return { type: 'plugin', loaders: ['velocity'] };
  if (software === 'waterfall' || software === 'bungeecord') return { type: 'plugin', loaders: ['waterfall', 'bungeecord'] };
  if (software === 'vanilla') return { type: 'datapack', loaders: [] };
  if (software === 'folia') return { type: 'plugin', loaders: ['folia', 'paper'] };
  if (['canvas', 'arclight', 'youer', 'banner', 'divinemc', 'sponge', 'mohist'].includes(software)) {
    return { type: 'mod', loaders: ['forge', 'fabric', 'neoforge'] };
  }
  return { type: 'plugin', loaders: ['paper', 'purpur', 'spigot', 'bukkit'] };
}

function contentTitle(software: string): string {
  const spec = catalogSpec(software);
  if (spec.type === 'mod') return 'Моды';
  if (spec.type === 'datapack') return 'Датапаки';
  return 'Плагины';
}

function installedRow(row: { name: string; enabled: boolean; size: number }): string {
  const title = row.name.replace(/\.jar$/i, '');
  return `<div class="hs-plug">
    <span class="hs-plug__ico">${hostAsset('filesIcons/jar.svg')}</span>
    <div>
      <div class="hs-plug__name" title="${esc(row.name)}">${esc(title)}</div>
      <div class="hs-plug__desc">${formatSize(row.size)}${row.enabled ? '' : ' · выключен'}</div>
    </div>
    <label class="hs-switch" title="${row.enabled ? 'Выключить' : 'Включить'}">
      <input type="checkbox" data-plugin-toggle="${esc(row.name)}"${row.enabled ? ' checked' : ''}>
      <span></span>
    </label>
    <button type="button" class="hs-del" data-plugin-remove="${esc(row.name)}" title="Удалить">${ICON_TRASH}</button>
  </div>`;
}

async function paintInstalled(id: string): Promise<void> {
  const list = document.getElementById('host-installed');
  if (!list) return;
  const installed = (await api()?.hostedServersPlugins?.(id)) || [];
  list.innerHTML = installed.length
    ? installed.map((row) => installedRow(row)).join('')
    : '<p class="hs-note">Пока ничего не установлено</p>';
  list.querySelectorAll<HTMLInputElement>('[data-plugin-toggle]').forEach((input) => {
    input.addEventListener('change', async () => {
      await api()?.hostedServersPluginToggle?.(id, input.dataset.pluginToggle || '');
      await paintInstalled(id);
    });
  });
  list.querySelectorAll<HTMLElement>('[data-plugin-remove]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const name = btn.dataset.pluginRemove || '';
      const ok = await confirmHost(`Удалить «${name}»?`);
      if (!ok) return;
      await api()?.hostedServersPluginRemove?.(id, name);
      await paintInstalled(id);
    });
  });
}

function pluginNote(text: string): void {
  const note = document.getElementById('host-plugin-error');
  if (!note) return;
  note.hidden = !text;
  note.textContent = text;
}

async function fillPlugins(id: string): Promise<void> {
  const panel = document.getElementById('host-modal-panel');
  const server = current();
  if (!panel || !server) return;
  const noun = contentTitle(server.software);
  panel.innerHTML = `<div class="hs-panel hs-plugins">
    <div class="hs-plugins__bar">
      <div class="hs-pills">
        <button type="button" class="hs-pill${pluginView === 'installed' ? ' is-on' : ''}" data-plugin-view="installed">Установленные</button>
        <button type="button" class="hs-pill${pluginView === 'catalog' ? ' is-on' : ''}" data-plugin-view="catalog">Каталог плагинов</button>
      </div>
      <span class="hs-plugins__hint">Управление ${esc(noun.toLowerCase())} сервера</span>
      <button type="button" class="hs-textbtn hs-plugins__add" id="host-plugin-file">Добавить файл</button>
    </div>
    <div id="host-installed" ${pluginView === 'installed' ? '' : 'hidden'}></div>
    <p class="hs-note" id="host-plugin-error" hidden></p>
    <div class="hs-catalog" id="host-plugin-catalog" ${pluginView === 'catalog' ? '' : 'hidden'}>
      <div class="hs-catalog__tools">
        <div class="search-input-wrapper hs-plugin-search">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.5"/>
            <path d="M11 11L15 15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          <input id="host-plugin-search" class="search-input" placeholder="Поиск" value="${esc(pluginQuery)}" spellcheck="false" autocomplete="off">
        </div>
        <div class="hs-catalog__filters">
          ${selectHtml('host-plugin-source', pluginSource, [['both', 'Modrinth и CurseForge'], ['modrinth', 'Modrinth'], ['curseforge', 'CurseForge']])}
          ${selectHtml('host-plugin-sort', pluginSort, [['relevance', 'Релевантность'], ['downloads', 'По скачиваниям'], ['newest', 'По новизне'], ['updated', 'По обновлениям']])}
          <button type="button" class="mods-view-toggle" id="host-plugin-view" data-mode="${pluginLayout}" aria-pressed="${pluginLayout === 'cards' ? 'true' : 'false'}" title="${pluginLayout === 'cards' ? 'Список' : 'Плитки'}">
            <img class="mods-view-toggle__icon mods-view-toggle__icon--cards" src="../../assets/icons/cards.svg" width="16" height="16" alt="" aria-hidden="true">
            <img class="mods-view-toggle__icon mods-view-toggle__icon--list" src="../../assets/icons/list.svg" width="16" height="16" alt="" aria-hidden="true">
          </button>
        </div>
      </div>
      <div class="hs-catalog__list mods-grid hs-plugin-grid${pluginLayout === 'cards' ? ' is-cards' : ''}" id="host-plugin-grid"></div>
    </div>
  </div>`;
  panel.querySelectorAll<HTMLElement>('[data-plugin-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      pluginView = (btn.dataset.pluginView as 'installed' | 'catalog') || 'installed';
      void fillPlugins(id);
    });
  });
  panel.querySelectorAll<HTMLElement>('.stngs-select-wrap').forEach(bindSelect);
  let timer = 0;
  const search = () => {
    pluginQuery = (document.getElementById('host-plugin-search') as HTMLInputElement | null)?.value || '';
    pluginSource = (document.getElementById('host-plugin-source') as HTMLSelectElement | null)?.value || 'both';
    pluginSort = (document.getElementById('host-plugin-sort') as HTMLSelectElement | null)?.value || 'relevance';
    stopPluginScroll();
    void searchPlugins(server, false);
  };
  document.getElementById('host-plugin-search')?.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(search, 320);
  });
  document.getElementById('host-plugin-search')?.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key !== 'Enter') return;
    window.clearTimeout(timer);
    search();
  });
  document.getElementById('host-plugin-source')?.addEventListener('change', search);
  document.getElementById('host-plugin-sort')?.addEventListener('change', search);
  document.getElementById('host-plugin-view')?.addEventListener('click', () => {
    pluginLayout = pluginLayout === 'cards' ? 'list' : 'cards';
    const grid = document.getElementById('host-plugin-grid');
    if (!grid) return;
    applyPluginLayout(grid);
    stopPluginScroll();
    grid.innerHTML = pluginHits.map((hit) => pluginHitHtml(hit)).join('');
    bindPluginCards(grid, server);
    if (pluginOffset < pluginTotal && pluginHits.length) armPluginScroll(grid, server);
  });
  document.getElementById('host-plugin-file')?.addEventListener('click', async () => {
    const res = await api()?.hostedServersPluginAdd?.(id);
    if (res && res.ok === false) pluginNote(res.error || 'Файл не добавлен');
    await paintInstalled(id);
  });
  await paintInstalled(id);
  await searchPlugins(server, false);
}

async function searchPlugins(server: HostedServer, append: boolean): Promise<void> {
  const grid = document.getElementById('host-plugin-grid');
  if (!grid) return;
  if (append && (pluginBusy || pluginOffset >= pluginTotal)) return;
  const spec = catalogSpec(server.software);
  const gen = append ? pluginGen : ++pluginGen;
  const req = ++pluginReq;
  stopPluginScroll();
  if (!append) {
    pluginOffset = 0;
    pluginTotal = 0;
    pluginSeen.clear();
    pluginHits = [];
    grid.innerHTML = '<p class="host-lead">Ищу…</p>';
  } else {
    grid.querySelector('.mods-scroll-sentinel')?.remove();
    grid.querySelector('.mods-loading-more')?.remove();
    grid.insertAdjacentHTML('beforeend', '<div class="mods-loading-more">Загрузка…</div>');
  }
  pluginBusy = true;
  const offset = pluginOffset;
  const result = await api()?.getModrinthProjects?.(pluginQuery, spec.type, offset, PLUGIN_PAGE, {
    loaders: spec.loaders,
    version: server.gameVersion,
    index: pluginSort,
    source: pluginSource,
  });
  if (req !== pluginReq || gen !== pluginGen || !grid.isConnected) return;
  pluginBusy = false;
  grid.querySelector('.mods-loading-more')?.remove();
  if (!result || result.error) {
    if (!append) grid.innerHTML = `<p class="host-lead">${esc(result?.error || 'Каталог недоступен')}</p>`;
    return;
  }
  const hits = result.hits || [];
  pluginTotal = Number(result.total_hits || 0);
  const fresh = hits.filter((hit) => {
    const id = pluginId(hit);
    if (!id || pluginSeen.has(id)) return false;
    pluginSeen.add(id);
    return true;
  });
  if (!hits.length && !append) {
    pluginHits = [];
    grid.innerHTML = '<p class="host-lead">Ничего не найдено для этой версии и ядра.</p>';
    return;
  }
  if (!append) {
    pluginHits = fresh;
    grid.innerHTML = '';
  } else if (fresh.length) {
    pluginHits = pluginHits.concat(fresh);
  }
  // Смещение кратно размеру страницы: общий каталог считает страницу как offset/limit.
  // Прибавлять число карточек нельзя — короткая страница снова запрашивает ту же.
  if (hits.length) pluginOffset += PLUGIN_PAGE;
  else pluginTotal = pluginOffset;
  applyPluginLayout(grid);
  if (fresh.length) grid.insertAdjacentHTML('beforeend', fresh.map((hit) => pluginHitHtml(hit)).join(''));
  bindPluginCards(grid, server);
  if (pluginOffset < pluginTotal && hits.length) armPluginScroll(grid, server);
}

function armPluginScroll(grid: HTMLElement, server: HostedServer): void {
  grid.querySelector('.mods-scroll-sentinel')?.remove();
  grid.insertAdjacentHTML('beforeend', '<div class="mods-scroll-sentinel" aria-hidden="true"></div>');
  const sentinel = grid.querySelector('.mods-scroll-sentinel');
  if (!sentinel) return;
  pluginObserver?.disconnect();
  pluginObserver = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    pluginObserver?.disconnect();
    pluginObserver = null;
    void searchPlugins(server, true);
  }, { root: grid, rootMargin: '240px' });
  pluginObserver.observe(sentinel);
}

function bindPluginCards(grid: HTMLElement, server: HostedServer): void {
  grid.querySelectorAll<HTMLButtonElement>('[data-plugin-open]:not([data-bound])').forEach((btn) => {
    btn.dataset.bound = '1';
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      const id = btn.dataset.pluginOpen || '';
      const raw = btn.dataset.pluginMode || 'details';
      const mode = raw === 'versions' || raw === 'ask' ? raw : 'details';
      if (id) openPluginCatalog(server, id, mode);
    });
  });
}

function pluginId(hit: any): string {
  return String(hit?.project_id || hit?.slug || hit?.id || '');
}

function pluginSourceOf(hit: any): 'curseforge' | 'modrinth' {
  const raw = String(hit?.source || '').toLowerCase();
  if (raw === 'curseforge' || raw === 'cf') return 'curseforge';
  if (pluginId(hit).startsWith('cf:')) return 'curseforge';
  return 'modrinth';
}

function compactCount(value: unknown): string {
  const n = Number(value) || 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return String(n);
}

function relativeAge(raw: unknown): string {
  if (!raw) return '';
  const then = new Date(String(raw)).getTime();
  if (Number.isNaN(then)) return '';
  const sec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (sec < 3600) return `${Math.max(1, Math.floor(sec / 60))}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

function pluginAccent(hit: any): string {
  const n = Number(hit?.color);
  if (!Number.isFinite(n)) return 'rgba(255,255,255,0.05)';
  return `#${Math.max(0, Math.floor(n)).toString(16).padStart(6, '0')}`;
}

function pluginGallery(hit: any): string {
  const featured = String(hit?.featured_gallery || '').trim();
  if (featured) return featured;
  if (Array.isArray(hit?.gallery)) {
    const first = hit.gallery.find((row: unknown) => typeof row === 'string' && String(row).trim());
    if (first) return String(first).trim();
  }
  return '';
}

function applyPluginLayout(grid: HTMLElement): void {
  grid.classList.toggle('is-cards', pluginLayout === 'cards');
  const btn = document.getElementById('host-plugin-view');
  if (!btn) return;
  btn.dataset.mode = pluginLayout;
  btn.setAttribute('aria-pressed', pluginLayout === 'cards' ? 'true' : 'false');
  const title = pluginLayout === 'cards' ? 'Список' : 'Плитки';
  btn.title = title;
  btn.setAttribute('aria-label', title);
}

function pluginHitHtml(hit: any): string {
  return pluginLayout === 'list' ? pluginListRow(hit) : pluginCard(hit);
}

function pluginListRow(hit: any): string {
  const id = pluginId(hit);
  const source = pluginSourceOf(hit);
  const title = esc(hit.title || id);
  const accent = pluginAccent(hit);
  const badge = source === 'curseforge'
    ? '<span class="mod-source-badge mod-source-badge--cf">CurseForge</span>'
    : '<span class="mod-source-badge mod-source-badge--mr">Modrinth</span>';
  const icon = hit.icon_url
    ? `<img src="${esc(catalogImageUrl(hit.icon_url))}" alt="">`
    : '<svg width="24" height="24" viewBox="0 0 20 20" fill="none"><rect width="20" height="20" rx="4" fill="#2A2A2A"/><path d="M6 4L14 10L6 16V4Z" fill="#fff"/></svg>';
  return `<div class="mod-card" data-plugin-id="${esc(id)}" data-mod-source="${source}">
    <div class="mod-card-icon" style="background:${accent}">${icon}</div>
    <div class="mod-card-info">
      <div class="mod-card-name">${title} ${badge}</div>
      <div class="mod-card-desc">${esc(String(hit.description || '').slice(0, 100))}</div>
    </div>
    <div class="mod-card-actions">
      <button type="button" class="details-btn" data-plugin-open="${esc(id)}" data-plugin-mode="details">Подробнее</button>
      <button type="button" class="details-btn" data-plugin-open="${esc(id)}" data-plugin-mode="ask">Спросить агента</button>
      <button type="button" class="list-row-btn download-btn" data-plugin-open="${esc(id)}" data-plugin-mode="versions">Скачать</button>
    </div>
  </div>`;
}

function pluginCard(hit: any): string {
  const id = pluginId(hit);
  const source = pluginSourceOf(hit);
  const title = esc(hit.title || id);
  const accent = pluginAccent(hit);
  const gallery = pluginGallery(hit);
  const badge = source === 'curseforge'
    ? '<span class="mod-source-badge mod-source-badge--cf">CurseForge</span>'
    : '<span class="mod-source-badge mod-source-badge--mr">Modrinth</span>';
  const icon = hit.icon_url
    ? `<img src="${esc(catalogImageUrl(hit.icon_url))}" alt="">`
    : '<svg width="24" height="24" viewBox="0 0 20 20" fill="none"><rect width="20" height="20" rx="4" fill="#2A2A2A"/><path d="M6 4L14 10L6 16V4Z" fill="#fff"/></svg>';
  const placeholder = source === 'curseforge'
    ? '../../assets/images/modCFPlaceholder.png'
    : '../../assets/images/modPlaceholder.png';
  const hero = gallery
    ? `<img class="mod-tile__hero-img" src="${esc(catalogImageUrl(gallery))}" alt="" loading="lazy">`
    : `<div class="mod-tile__hero-ph" aria-hidden="true"><img class="mod-tile__hero-ph-img" src="${placeholder}" alt=""></div>`;
  const author = String(hit.author || '').trim();
  const updated = relativeAge(hit.date_modified);
  return `<article class="mod-tile" data-plugin-id="${esc(id)}">
    <div class="mod-tile__hero" style="--mod-accent:${accent}">${hero}</div>
    <div class="mod-tile__body">
      <div class="mod-tile__head">
        <div class="mod-tile__icon" style="background:${accent}">${icon}</div>
        <div class="mod-tile__titles">
          <div class="mod-tile__name">${title} ${badge}</div>
          ${author ? `<div class="mod-tile__author">от ${esc(author)}</div>` : ''}
        </div>
      </div>
      <p class="mod-tile__desc">${esc(String(hit.description || '').slice(0, 140))}</p>
      <div class="mod-tile__stats">
        <span title="Скачивания">${compactCount(hit.downloads)}</span>
        <span title="Подписки">${compactCount(hit.follows)}</span>
        ${updated ? `<span title="Обновлено">${esc(updated)}</span>` : ''}
      </div>
      <div class="mod-card-actions mod-tile__actions">
        <button type="button" class="details-btn" data-plugin-open="${esc(id)}" data-plugin-mode="details">Подробнее</button>
        <button type="button" class="details-btn" data-plugin-open="${esc(id)}" data-plugin-mode="ask" data-plugin-title="${title}">Спросить агента</button>
        <button type="button" class="list-row-btn download-btn" data-plugin-open="${esc(id)}" data-plugin-mode="versions">Скачать</button>
      </div>
    </div>
  </article>`;
}

function preferredPluginLoader(server: HostedServer): string {
  const spec = catalogSpec(server.software);
  if (spec.loaders.includes(server.software)) return server.software;
  return spec.loaders[0] || '';
}

function openPluginCatalog(server: HostedServer, projectId: string, mode: 'details' | 'versions' | 'ask'): void {
  if (mode === 'ask') {
    const card = document.querySelector<HTMLElement>(`[data-plugin-id="${CSS.escape(projectId)}"]`);
    const title = card?.querySelector('.mod-tile__name, .mod-card-name')?.childNodes[0]?.textContent?.trim() || projectId;
    window.dispatchEvent(new CustomEvent('uclient-host-catalog', {
      detail: { projectId, mode: 'ask', title },
    }));
    return;
  }
  window.dispatchEvent(new CustomEvent('uclient-host-catalog', {
    detail: {
      projectId,
      mode,
      gameVersion: server.gameVersion,
      loader: preferredPluginLoader(server),
      install: (version: any) => {
        const card = document.querySelector<HTMLElement>(`[data-plugin-id="${CSS.escape(projectId)}"]`);
        const title = card?.querySelector('.mod-tile__name, .mod-card-name')?.childNodes[0]?.textContent?.trim() || projectId;
        return installChosenPlugin(server, version, title);
      },
    },
  }));
}

// Каталог сайта кладёт jar в `file`, а не в массив `files`. Без этого
// установка не видела файл, хотя сборка под версию и ядро уже была.
function versionFiles(version: any): any[] {
  if (Array.isArray(version?.files) && version.files.length) return version.files;
  if (version?.file && typeof version.file === 'object') return [version.file];
  return [];
}

function jarOf(version: any): { url: string; filename: string } | null {
  const ordered = [...versionFiles(version)].sort((a, b) => Number(Boolean(b?.primary)) - Number(Boolean(a?.primary)));
  for (const file of ordered) {
    const url = String(file?.url || file?.download_url || file?.downloadUrl || '');
    let filename = String(file?.filename || file?.fileName || file?.name || '');
    if (!filename && url) {
      try { filename = decodeURIComponent(new URL(url).pathname.split('/').pop() || ''); } catch { filename = ''; }
    }
    if (!url.startsWith('https://')) continue;
    if (!/\.jar$/i.test(filename) && !/\.jar(\?|$)/i.test(url)) continue;
    return { url, filename: /\.jar$/i.test(filename) ? filename : 'plugin.jar' };
  }
  return null;
}

function pluginBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.max(0, Math.round(bytes))} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

function postTask(detail: Record<string, unknown>): void {
  window.dispatchEvent(new CustomEvent('uclient-task', { detail }));
}

async function installChosenPlugin(server: HostedServer, version: any, pluginName?: string): Promise<void> {
  const file = jarOf(version);
  if (!file) {
    pluginNote('Для этой версии нет jar.');
    return;
  }
  const name = (pluginName || file.filename.replace(/\.jar$/i, '')).trim();
  pluginNote('');
  try {
    const res = await api()?.hostedServersInstallUrl?.(server.id, file.url, file.filename);
    if (res?.already) {
      postTask({
        id: `plugin-have-${server.id}-${Date.now()}`,
        title: 'Уведомление',
        stage: `Плагин ${name} уже скачан для сервера ${server.name}`,
        detail: 'Этот плагин уже есть на вашем сервере. Действие не требуется. Если вам необходимо переустановить плагин, сначала удалите его из вашего сервера.',
        percent: null,
        tone: 'info',
        settled: true,
      });
      return;
    }
    if (!res?.ok) {
      pluginNote(res?.error || 'Не удалось скачать');
      return;
    }
    await paintInstalled(server.id);
  } catch (err) {
    pluginNote(err instanceof Error ? err.message : 'Не удалось скачать');
  }
}

function field(label: string, hint: string, inner: string): string {
  return `<div class="be-field"><label>${label}</label>${inner}<div class="be-hint">${hint}</div></div>`;
}

function check(id: string, label: string, hint: string, on: boolean): string {
  return `<label class="be-checkbox" title="${esc(hint)}"><input type="checkbox" id="${id}"${on ? ' checked' : ''}>${label}</label>`;
}

function settingsHtml(server: HostedServer): string {
  return `<form class="hs-panel hs-settings" id="host-settings-form">
    <section class="host-section">
    <div class="be-panel-title">Сервер</div>
    <div class="be-field">
      <label>Иконка</label>
      <div class="be-icon-picker">
        <div class="be-icon-preview" id="host-icon-preview">${server.iconData ? `<img src="${server.iconData}" alt="">` : ''}</div>
        <div class="be-icon-grid" id="host-icon-grid"></div>
        <button type="button" class="stngs-btn" id="host-icon-upload">Загрузить</button>
        <input type="file" id="host-icon-file" accept="image/png,image/jpeg,image/webp" hidden>
      </div>
      <div class="be-hint">Та же сетка, что у сборки. В игре иконка видна в списке серверов: файл server-icon.png, 64×64.</div>
    </div>
    <div class="be-row">
      ${field('Название', 'Имя только в лаунчере.', `<input id="hs-name" value="${esc(server.name)}" maxlength="48">`)}
      ${field('MOTD', 'Текст в списке серверов у игрока.', `<input id="hs-motd" value="${esc(server.motd)}" maxlength="59">`)}
    </div>
    <div class="be-row">
      ${field('Ядро', 'Чем сервер будет запущен.', selectHtml('hs-software', server.software, CORES))}
      ${field('Версия', 'Версия Minecraft или ядра прокси.', selectHtml('hs-version', server.gameVersion, [[server.gameVersion, server.gameVersion]]))}
    </div>
    <div class="be-row">
      ${field('Порт', '25565 зарезервирован клиентом и недоступен. Свободный порт назначается сам.', `<input id="hs-port" type="number" min="1" max="65535" value="${server.port}">`)}
      ${field('Игроки', 'Одновременно на сервере.', `<input id="hs-players" type="number" min="1" max="1000" value="${server.maxPlayers}">`)}
    </div>
    </section>
    <section class="host-section">
    <div class="be-panel-title">Запуск</div>
    <div class="be-row">
      ${field('RAM мин., МБ', 'Сколько памяти занять сразу.', `<input id="hs-memory-min" type="number" min="256" max="32768" step="256" value="${server.memoryMin || 512}">`)}
      ${field('RAM макс., МБ', 'Потолок для Java, как у сборки.', `<input id="hs-memory" type="number" min="512" max="32768" step="256" value="${server.memoryMb}">`)}
    </div>
    <div class="be-row">
      <div class="be-field">
        <label>Java</label>
        <div class="stngs-select-wrap be-select-wrap">
          <select class="stngs-select-hidden" id="hs-java">
            <option value="">Авто</option>
            <option value="__custom">Свой путь…</option>
          </select>
          <button type="button" class="stngs-select-btn"><span class="stngs-select-value">Авто</span>
            <svg class="stngs-select-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 4L6 8L10 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <div class="stngs-select-menu select-scroll-menu" data-for="hs-java">
            <div class="stngs-select-opt" data-value="">Авто</div>
            <div class="stngs-select-opt" data-value="__custom">Свой путь…</div>
          </div>
        </div>
        <div class="be-java-row hidden" id="hs-java-custom-row">
          <input id="hs-java-path" value="${esc(server.javaPath || '')}" placeholder="Путь к java">
          <button type="button" class="be-java-browse" id="hs-java-browse">Обзор</button>
        </div>
        <div class="be-java-hint" id="hs-java-hint"></div>
      </div>
      ${field('Аргументы JVM', 'Дополнительно к -Xms и -Xmx. Как в настройках сборки.', `<input id="hs-jvm" value="${esc(server.jvmArgs || '')}" placeholder="-XX:+UseG1GC">`)}
    </div>
    <div class="host-actions">
      <button type="button" class="stngs-btn" id="host-port-auto">Свободный порт</button>
      <button type="button" class="stngs-btn primary" id="host-install-core">Скачать ядро</button>
      <span class="be-hint">${server.coreReady ? 'Ядро уже скачано.' : 'Ядро скачается и при запуске.'}</span>
    </div>
    </section>
    <section class="host-section">
    <div class="be-panel-title">Мир</div>
    <div class="be-row">
      ${field('Режим', 'Режим для новых игроков.', selectHtml('hs-gamemode', server.gamemode, GAMEMODES))}
      ${field('Сложность', 'Урон и голод.', selectHtml('hs-difficulty', server.difficulty, DIFFICULTIES))}
    </div>
    <div class="be-row">
      ${field('Тип мира', 'Генерация при первом запуске.', selectHtml('hs-level-type', server.levelType || 'minecraft:normal', LEVEL_TYPES))}
      ${field('Имя мира', 'Папка мира на диске.', `<input id="hs-level" value="${esc(server.levelName)}">`)}
    </div>
    <div class="be-row">
      ${field('Сид', 'Пусто — случайный сид.', `<input id="hs-seed" value="${esc(server.levelSeed || '')}">`)}
      ${field('Прорисовка', 'Дальность чанков.', `<input id="hs-view" type="number" min="3" max="32" value="${server.viewDistance}">`)}
    </div>
    <div class="be-row">
      ${field('Симуляция', 'Чанки, где идёт жизнь мира.', `<input id="hs-sim" type="number" min="3" max="32" value="${server.simulationDistance}">`)}
      ${field('Защита спавна', 'Радиус без ломания блоков. 0 отключает.', `<input id="hs-spawn" type="number" min="0" max="64" value="${server.spawnProtection}">`)}
    </div>
    <div class="be-row">
      ${field('Простой игрока, мин', 'Через сколько минут без действий игрока кикнет. 0 — не кикать.', `<input id="hs-idle" type="number" min="0" max="1440" value="${server.playerIdleTimeout || 0}">`)}
      ${field('Никнеймы белого списка', 'Через пробел. Для оффлайн-сервера UUID считается по нику.', `<input id="hs-names" value="${esc(server.whitelistNames || '')}" placeholder="Steve Alex">`)}
    </div>
    </section>
    <section class="host-section">
    <div class="be-panel-title">Правила</div>
    <div class="host-checks">
      ${check('hs-relay', 'Публичный адрес через реле', 'Пока лаунчер открыт, сервер доступен снаружи.', server.publicRelay)}
      ${check('hs-online', 'Проверка лицензии', 'online-mode. Выключено — можно заходить с пиратских клиентов.', server.onlineMode)}
      ${check('hs-pvp', 'PvP', 'Игроки могут бить друг друга.', server.pvp)}
      ${check('hs-white', 'Белый список', 'Заходят только указанные ники.', server.whiteList)}
      ${check('hs-enforce', 'Строгий белый список', 'Кикает уже зашедших, кого нет в списке.', server.enforceWhitelist)}
      ${check('hs-flight', 'Полёты', 'Разрешить полёт в выживании.', server.allowFlight)}
      ${check('hs-mobs', 'Монстры', 'Появление враждебных мобов.', server.spawnMonsters)}
      ${check('hs-animals', 'Животные', 'Появление животных.', server.spawnAnimals !== false)}
      ${check('hs-npcs', 'Жители', 'Появление жителей.', server.spawnNpcs !== false)}
      ${check('hs-nether', 'Незер', 'Порталы в Незер.', server.allowNether !== false)}
      ${check('hs-structures', 'Структуры', 'Деревни, крепости и прочие постройки.', server.generateStructures !== false)}
      ${check('hs-hardcore', 'Хардкор', 'Одна жизнь, затем бан.', server.hardcore)}
      ${check('hs-force', 'Принудительный режим', 'Каждый вход ставит режим сервера.', server.forceGamemode)}
      ${check('hs-cmd', 'Командные блоки', 'Разрешить командные блоки.', server.commandBlocks)}
      ${check('hs-status', 'Статус в списке', 'Показывать MOTD и онлайн при пинге.', server.enableStatus !== false)}
      ${check('hs-hide', 'Скрыть онлайн', 'Не отдавать ники в списке серверов.', server.hideOnlinePlayers)}
      ${check('hs-eula', 'Принимаю EULA Mojang', 'Без этого сервер не запустится.', server.eulaAccepted)}
    </div>
    </section>
    <div class="host-actions">
      <button type="submit" class="stngs-btn primary">Сохранить</button>
      <button type="button" class="stngs-btn" id="host-open-dir">Открыть директорию сервера</button>
      <button type="button" class="stngs-btn danger" id="host-delete">Удалить сервер</button>
      <span class="host-saved" id="host-saved"></span>
    </div>
  </form>`;
}

function val(id: string): string {
  return (document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null)?.value ?? '';
}
function on(id: string): boolean {
  return Boolean((document.getElementById(id) as HTMLInputElement | null)?.checked);
}

function readSettings(): Partial<HostedServer> {
  return {
    name: val('hs-name'),
    motd: val('hs-motd'),
    software: val('hs-software'),
    gameVersion: val('hs-version'),
    port: Number(val('hs-port')),
    memoryMb: Number(val('hs-memory')),
    memoryMin: Number(val('hs-memory-min')),
    javaPath: val('hs-java') === '__custom' ? val('hs-java-path') : val('hs-java'),
    jvmArgs: val('hs-jvm'),
    maxPlayers: Number(val('hs-players')),
    gamemode: val('hs-gamemode'),
    difficulty: val('hs-difficulty'),
    levelType: val('hs-level-type'),
    levelName: val('hs-level'),
    levelSeed: val('hs-seed'),
    viewDistance: Number(val('hs-view')),
    simulationDistance: Number(val('hs-sim')),
    spawnProtection: Number(val('hs-spawn')),
    playerIdleTimeout: Number(val('hs-idle')),
    publicRelay: on('hs-relay'),
    onlineMode: on('hs-online'),
    pvp: on('hs-pvp'),
    whiteList: on('hs-white'),
    enforceWhitelist: on('hs-enforce'),
    allowFlight: on('hs-flight'),
    spawnMonsters: on('hs-mobs'),
    spawnAnimals: on('hs-animals'),
    spawnNpcs: on('hs-npcs'),
    allowNether: on('hs-nether'),
    generateStructures: on('hs-structures'),
    hardcore: on('hs-hardcore'),
    forceGamemode: on('hs-force'),
    commandBlocks: on('hs-cmd'),
    enableStatus: on('hs-status'),
    hideOnlinePlayers: on('hs-hide'),
    eulaAccepted: on('hs-eula'),
    whitelistNames: val('hs-names'),
  };
}

function bindSettings(server: HostedServer): void {
  void fillVersions(server, false);
  void fillIconGrid(server);
  void fillJavaSelect(server);
  document.getElementById('hs-software')?.addEventListener('change', () => {
    const fresh = current();
    if (fresh) void fillVersions(fresh, true);
  });
  document.getElementById('host-port-auto')?.addEventListener('click', () => {
    const input = document.getElementById('hs-port') as HTMLInputElement | null;
    if (!input) return;
    const used = new Set(servers.filter((row) => row.id !== server.id).map((row) => row.port));
    used.add(25565);
    let port = 25566;
    while (used.has(port)) port += 1;
    input.value = String(port);
  });
  document.getElementById('host-install-core')?.addEventListener('click', () => void installCore(server.id));
  document.getElementById('host-open-dir')?.addEventListener('click', () => {
    void api()?.hostedServersOpenDir?.(server.id);
  });
  document.getElementById('host-settings-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    void saveSettings(server.id);
  });
  document.getElementById('host-delete')?.addEventListener('click', () => void removeServer(server.id));
  document.getElementById('host-icon-upload')?.addEventListener('click', () => {
    document.getElementById('host-icon-file')?.click();
  });
  document.getElementById('host-icon-file')?.addEventListener('change', async (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    try {
      await applyIcon(server.id, url);
    } finally {
      URL.revokeObjectURL(url);
    }
  });
}

async function fillJavaSelect(server: HostedServer): Promise<void> {
  const select = document.getElementById('hs-java') as HTMLSelectElement | null;
  const menu = document.querySelector<HTMLElement>('.stngs-select-menu[data-for="hs-java"]');
  const row = document.getElementById('hs-java-custom-row');
  const pathInput = document.getElementById('hs-java-path') as HTMLInputElement | null;
  const hint = document.getElementById('hs-java-hint');
  if (!select || !menu || !hint) return;
  select.querySelectorAll('option[data-java-dyn]').forEach((node) => node.remove());
  menu.querySelectorAll('[data-java-dyn]').forEach((node) => node.remove());
  const found = (await api()?.detectJava?.(true)) || [];
  const resolved = await api()?.resolveJavaVersion?.(server.gameVersion);
  const need = resolved?.version || server.javaNeed || 21;
  for (const j of found) {
    const kind = j.managed ? 'лаунчер' : 'система';
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
  const pinned = (pathInput?.value || server.javaPath || '').trim();
  const value = pinned ? (found.some((j) => j.path === pinned) ? pinned : '__custom') : '';
  select.value = value;
  if (pathInput && value === '__custom') pathInput.value = pinned;
  row?.classList.toggle('hidden', value !== '__custom');
  const valueEl = select.closest('.stngs-select-wrap')?.querySelector('.stngs-select-value');
  if (valueEl) valueEl.textContent = select.options[select.selectedIndex]?.textContent || 'Авто';
  const hasNeed = found.some((j) => j.version >= need);
  hint.className = `be-java-hint${hasNeed ? ' ok' : ''}`;
  hint.innerHTML = `<span class="be-java-hint-dot"></span><span>${hasNeed ? `Авто подберёт Java ${need} или новее` : `Для ${esc(server.gameVersion)} нужна Java ${need}`}</span>`;
  if (!hasNeed) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'stngs-btn';
    btn.textContent = `Установить Java ${need}`;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Установка…';
      const res = await api()?.installJava?.(need);
      btn.textContent = res?.success ? 'Установлена' : 'Не установилась';
      if (res?.success) void fillJavaSelect({ ...server, gameVersion: (document.getElementById('hs-version') as HTMLSelectElement | null)?.value || server.gameVersion });
    });
    hint.appendChild(btn);
  }
  if (select.dataset.javaBound === '1') return;
  select.dataset.javaBound = '1';
  select.addEventListener('change', () => {
    row?.classList.toggle('hidden', select.value !== '__custom');
    const label = select.options[select.selectedIndex]?.textContent || 'Авто';
    const el = select.closest('.stngs-select-wrap')?.querySelector('.stngs-select-value');
    if (el) el.textContent = label;
  });
  document.getElementById('hs-java-browse')?.addEventListener('click', async () => {
    const picked = await api()?.pickJava?.();
    if (!picked?.path || !pathInput) return;
    pathInput.value = picked.path;
    select.value = '__custom';
    select.dispatchEvent(new Event('change'));
    row?.classList.remove('hidden');
  });
}

async function fillIconGrid(server: HostedServer): Promise<void> {
  const grid = document.getElementById('host-icon-grid');
  if (!grid) return;
  const files = (await api()?.listInstanceIcons?.()) || [];
  grid.innerHTML = files.map((name) => `<img class="be-icon-opt" data-icon="${esc(name)}" src="../../assets/InstancesIcons/${esc(name)}" alt="">`).join('');
  grid.querySelectorAll<HTMLElement>('.be-icon-opt').forEach((img) => {
    img.addEventListener('click', () => {
      grid.querySelectorAll('.be-icon-opt').forEach((node) => node.classList.remove('selected'));
      img.classList.add('selected');
      void applyIcon(server.id, img.getAttribute('src') || '');
    });
  });
}

function png64(src: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('canvas'));
        return;
      }
      ctx.imageSmoothingEnabled = true;
      ctx.clearRect(0, 0, 64, 64);
      ctx.drawImage(img, 0, 0, 64, 64);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('icon'));
    img.src = src;
  });
}

async function applyIcon(id: string, src: string): Promise<void> {
  const dataUrl = await png64(src);
  const preview = document.getElementById('host-icon-preview');
  if (preview) preview.innerHTML = `<img src="${dataUrl}" alt="">`;
  const res = await api()?.hostedServersSetIcon?.(id, dataUrl);
  if (res?.server) upsert(res.server);
  paintChrome();
}

async function fillVersions(server: HostedServer, softwareChanged: boolean): Promise<void> {
  const select = document.getElementById('hs-software') as HTMLSelectElement | null;
  const version = document.getElementById('hs-version') as HTMLSelectElement | null;
  if (!version) return;
  const software = select?.value || server.software;
  const res = await api()?.hostedServersVersions?.(software);
  const values = res?.versions?.length ? res.versions : [server.gameVersion];
  const picked = !softwareChanged && values.includes(version.value) ? version.value : values[0];
  version.innerHTML = values.map((row) => `<option value="${esc(row)}">${esc(row)}</option>`).join('');
  version.value = picked || server.gameVersion;
  const menu = document.querySelector<HTMLElement>('.stngs-select-menu[data-for="hs-version"]');
  if (menu) menu.innerHTML = values.map((row) => `<div class="stngs-select-opt" data-value="${esc(row)}">${esc(row)}</div>`).join('');
  const wrap = version.closest<HTMLElement>('.stngs-select-wrap');
  const valueEl = wrap?.querySelector<HTMLElement>('.stngs-select-value');
  if (valueEl) valueEl.textContent = version.options[version.selectedIndex]?.textContent || version.value;
}

async function saveSettings(id: string): Promise<void> {
  const note = document.getElementById('host-saved');
  const patch = readSettings();
  if (patch.port === 25565) {
    if (note) note.textContent = 'Порт 25565 зарезервирован и недоступен';
    return;
  }
  const res = await api()?.hostedServersUpdate?.(id, patch);
  if (res?.server) upsert(res.server);
  if (note) note.textContent = res?.ok ? 'Сохранено. Мир и ядро применятся при следующем запуске.' : res?.error || 'Не сохранилось';
  paintChrome();
}

async function installCore(id: string): Promise<void> {
  await saveSettings(id);
  const note = document.getElementById('host-saved');
  if (note) note.textContent = 'Скачиваю ядро…';
  const res = await api()?.hostedServersInstallCore?.(id);
  if (note) note.textContent = res?.ok ? 'Ядро готово.' : res?.error || 'Не удалось скачать ядро';
  await refreshList();
}

async function createServer(): Promise<void> {
  const created = await api()?.hostedServersCreate?.();
  if (!created) return;
  upsert(created);
  await openServer(created.id, 'dashboard');
}

async function toggleRun(id: string): Promise<void> {
  const server = servers.find((row) => row.id === id);
  const host = api();
  if (!server || !host) return;
  if (server.status === 'running' || server.status === 'starting') {
    await host.hostedServersStop?.(id);
    return;
  }
  const res = await host.hostedServersStart?.(id);
  if (res && !res.ok) {
    server.status = 'error';
    server.error = res.error || '';
    paintChrome();
    if (!openId) renderList();
  }
}

async function removeServer(id: string): Promise<void> {
  const server = servers.find((row) => row.id === id);
  if (!server) return;
  const ok = await confirmHost(`Удалить сервер «${server.name}» вместе с миром и файлами?`);
  if (!ok) return;
  server.listingVisible = false;
  await publishListing(server);
  notifyListings();
  await api()?.hostedServersDelete?.(id);
  servers = servers.filter((row) => row.id !== id);
  if (openId === id) closeDetail();
  else renderList();
}

function onState(server: HostedServer): void {
  if (!server?.id) return;
  const prev = servers.find((row) => row.id === server.id);
  const live = server.status === 'running' || server.status === 'starting';
  if (!live) {
    server.cpuPercent = undefined;
    server.ramUsedMb = undefined;
    onlinePlayers.delete(server.id);
    if (openId === server.id) paintPlayers(server.id);
  } else if (prev && !server.ramUsedMb && prev.ramUsedMb) {
    server.cpuPercent = prev.cpuPercent;
    server.ramUsedMb = prev.ramUsedMb;
  }
  upsert(server);
  if (openId === server.id) {
    paintChrome();
    if (editorTab === 'dashboard') paintMeters(server);
  } else if (hostTabActive()) renderList();
}

function onUsage(data: { id: string; cpuPercent: number; ramUsedMb: number }): void {
  const row = servers.find((server) => server.id === data.id);
  if (!row) return;
  row.cpuPercent = data.cpuPercent;
  row.ramUsedMb = data.ramUsedMb;
  if (openId === data.id && editorTab === 'dashboard') paintMeters(row);
}

function onLog(data: { id: string; line: string }): void {
  if (!data?.id) return;
  notePlayerLine(data.id, data.line);
  if (openId !== data.id || editorTab !== 'console') return;
  const body = document.getElementById('host-console-body');
  if (!body) return;
  body.insertAdjacentHTML('beforeend', logEntry(data.line));
  body.scrollTop = body.scrollHeight;
}

// ===== Публичный листинг для каталога «Серверы Undefined» =====

export interface UndefinedCatalogSeed {
  id: string;
  name: string;
  ip: string;
  port: number;
  desc: string;
  icon: string;
  screenshots: string[];
  versions: string[];
  maxPlayers: number | null;
  online: boolean | null;
  localPort: number;
}

export function undefinedListingEntries(): UndefinedCatalogSeed[] {
  const out: UndefinedCatalogSeed[] = [];
  for (const server of servers) {
    if (!server.listingVisible || !server.publicHost || !server.publicPort) continue;
    if (!server.publicHost.toLowerCase().endsWith('.uprojects.site')) continue;
    out.push({
      id: `uc-${server.id}`,
      name: server.name,
      ip: server.publicHost,
      port: server.publicPort,
      desc: server.listingDesc || server.motd || '',
      icon: server.iconData || '',
      screenshots: (server.listingShots || []).slice(0, 5),
      versions: server.gameVersion ? [server.gameVersion] : [],
      maxPlayers: server.maxPlayers,
      online: server.status === 'running' ? true : server.status === 'stopped' || server.status === 'error' ? false : null,
      localPort: server.port,
    });
  }
  return out;
}

export function hiddenListingAddrs(): string[] {
  return servers
    .filter((server) => !server.listingVisible && server.publicHost && server.publicPort)
    .map((server) => `${server.publicHost}:${server.publicPort}`);
}

function notifyListings(): void {
  window.dispatchEvent(new CustomEvent('undefined-listings-changed'));
}

async function publishListing(server: HostedServer): Promise<void> {
  const base = getApiBase().replace(/\/+$/, '');
  try {
    if (!server.listingVisible || !server.publicHost || !server.publicPort) {
      await fetch(`${base}/api/listings/${encodeURIComponent(server.id)}`, { method: 'DELETE' });
      return;
    }
    await fetch(`${base}/api/listings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: server.id,
        name: server.name,
        ip: server.publicHost,
        port: server.publicPort,
        motd: server.motd,
        desc: server.listingDesc || '',
        version: server.gameVersion,
        icon: server.iconData || '',
        screenshots: (server.listingShots || []).slice(0, 5),
        maxPlayers: server.maxPlayers,
      }),
    });
  } catch {
    /* без сайта сервер всё равно виден в каталоге на этом компьютере */
  }
}

let listingShots: string[] = [];

function shotList(shots: string[]): string {
  const thumbs = shots.map((src, index) => `<div class="hs-shot"><img src="${src}" alt=""><button type="button" data-shot-del="${index}" aria-label="Убрать">×</button></div>`).join('');
  const add = shots.length < 5 ? `<button type="button" class="hs-shot-add" id="hl-shot-add">+</button>` : '';
  return thumbs + add;
}

function paintListingShots(): void {
  const box = document.getElementById('hl-shots');
  if (!box) return;
  box.innerHTML = shotList(listingShots);
  box.querySelector('#hl-shot-add')?.addEventListener('click', () => {
    document.getElementById('hl-shot-file')?.click();
  });
  box.querySelectorAll<HTMLElement>('[data-shot-del]').forEach((btn) => {
    btn.addEventListener('click', () => {
      listingShots.splice(Number(btn.dataset.shotDel || 0), 1);
      paintListingShots();
    });
  });
}

function closeListing(): void {
  const overlay = document.getElementById('modal-host-listing');
  if (!overlay || overlay.classList.contains('hidden')) return;
  overlay.classList.add('closing');
  window.setTimeout(() => {
    overlay.classList.add('hidden');
    overlay.classList.remove('closing');
    overlay.style.removeProperty('z-index');
  }, 120);
}

function openListing(): void {
  const server = current();
  const overlay = document.getElementById('modal-host-listing');
  if (!server || !overlay) return;
  listingShots = [...(server.listingShots || [])].slice(0, 5);
  const motd = document.getElementById('hl-motd') as HTMLInputElement | null;
  const desc = document.getElementById('hl-desc') as HTMLTextAreaElement | null;
  const on = document.getElementById('hl-on') as HTMLInputElement | null;
  const sub = document.getElementById('hl-sub');
  const icon = document.getElementById('hl-icon');
  if (motd) motd.value = server.motd || '';
  if (desc) desc.value = server.listingDesc || '';
  if (on) on.checked = Boolean(server.listingVisible);
  if (sub) sub.textContent = publicAddr(server);
  if (icon) icon.innerHTML = server.iconData ? `<img src="${server.iconData}" alt="">` : '';
  paintListingShots();
  overlay.classList.remove('hidden', 'closing');
  overlay.style.zIndex = '1600';
}

async function saveListing(): Promise<void> {
  const server = current();
  if (!server) return;
  const motd = (document.getElementById('hl-motd') as HTMLInputElement | null)?.value || '';
  const listingDesc = (document.getElementById('hl-desc') as HTMLTextAreaElement | null)?.value || '';
  const listingVisible = Boolean((document.getElementById('hl-on') as HTMLInputElement | null)?.checked);
  const shots = listingShots.slice(0, 5);
  const res = await api()?.hostedServersUpdate?.(server.id, { motd, listingDesc, listingVisible, listingShots: shots });
  const saved = res?.server;
  if (saved) upsert(saved);
  else {
    server.motd = motd;
    server.listingDesc = listingDesc;
    server.listingVisible = listingVisible;
    server.listingShots = shots;
  }
  await publishListing(saved || server);
  notifyListings();
  closeListing();
  paintChrome();
}

function shrinkShot(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      // Сайт отбрасывает кадр длиннее 180000 символов, поэтому ужимаем, пока data URL влезает.
      let width = Math.min(960, img.width);
      let quality = 0.72;
      let data = '';
      for (let attempt = 0; attempt < 6; attempt++) {
        const scale = width / Math.max(1, img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
        data = canvas.toDataURL('image/jpeg', quality);
        if (data.length <= 170000) break;
        quality = Math.max(0.42, quality - 0.08);
        width = Math.round(width * 0.82);
      }
      resolve(data);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image'));
    };
    img.src = url;
  });
}

function boot(): void {
  if (booted) return;
  booted = true;
  document.querySelector<HTMLElement>('.tab-btn[data-tab="host"]')?.addEventListener('click', () => {
    void refreshList();
  });
  document.getElementById('host-create-btn')?.addEventListener('click', () => {
    void createServer();
  });
  document.getElementById('host-view-toggle')?.addEventListener('click', () => {
    listMode = listMode === 'grid' ? 'list' : 'grid';
    if (!openId) renderList();
    else syncListTools();
  });
  document.getElementById('hl-close')?.addEventListener('click', closeListing);
  document.getElementById('hl-cancel')?.addEventListener('click', closeListing);
  document.getElementById('hl-save')?.addEventListener('click', () => void saveListing());
  document.getElementById('modal-host-listing')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) closeListing();
  });
  document.getElementById('hl-shot-file')?.addEventListener('change', async (event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || listingShots.length >= 5) return;
    const pending = openBannerCrop(file);
    document.querySelectorAll<HTMLElement>('[data-cv2-modal]').forEach((el) => {
      el.style.zIndex = '1700';
    });
    const cropped = await pending;
    if (!cropped) return;
    try {
      const raw = cropped.bytes;
      const copy = new Uint8Array(raw.byteLength);
      copy.set(raw);
      const blob = new Blob([copy], { type: 'image/jpeg' });
      listingShots.push(await shrinkShot(new File([blob], 'cover.jpg', { type: 'image/jpeg' })));
      paintListingShots();
    } catch { /* битый файл просто не добавляем */ }
  });
  document.getElementById('host-modal-close')?.addEventListener('click', closeDetail);
  document.getElementById('host-run-btn')?.addEventListener('click', () => {
    if (openId) void toggleRun(openId);
  });
  document.getElementById('modal-host')?.addEventListener('click', (event) => {
    if (event.target === document.getElementById('modal-host')) closeDetail();
  });
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest?.('.stngs-select-menu.host-portal, #servers-host-pane .stngs-select-btn, #host-modal-panel .stngs-select-btn')) return;
    closeHostSelects();
  });
  const host = api();
  host?.onHostedServerState?.(onState);
  host?.onHostedServerLog?.(onLog);
  host?.onHostedServerUsage?.(onUsage);
  host?.onHostedPluginProgress?.((data) => {
    const id = String(data.id || '');
    if (!id) return;
    if (data.clear) {
      postTask({ action: 'clear', id });
      return;
    }
    const name = String(data.filename || 'плагин');
    if (data.error) {
      postTask({ id, title: 'Загрузка', stage: name, detail: String(data.error), percent: null, tone: 'error' });
      postTask({ action: 'settle', id });
      return;
    }
    if (data.done) {
      postTask({ id, title: 'Загрузка', stage: name, detail: 'Плагин установлен.', percent: 100, tone: 'success' });
      postTask({ action: 'settle', id });
      return;
    }
    const total = Number(data.total) || 0;
    const received = Number(data.received) || 0;
    const percent = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : null;
    const detail = total > 0 ? `${pluginBytes(received)} из ${pluginBytes(total)}` : pluginBytes(received);
    postTask({ id, title: 'Загрузка', stage: name, detail, percent, tone: 'download' });
  });
}

boot();
