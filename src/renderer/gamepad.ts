// Управление лаунчером с геймпада: стандартный mapping (Xbox, DualSense, Switch) и заряд по HID.
import { playUiSfx } from './ui-sfx';

const STORAGE_KEY = 'Undefined Client-gamepad';
const RING_PAD = 5;
const RING_RX = 13;

type LayoutId = 'auto' | 'xbox' | 'playstation' | 'nintendo';
type BindAction = 'confirm' | 'cancel' | 'tabPrev' | 'tabNext';
type Dir = 'up' | 'down' | 'left' | 'right';

interface GpBinds {
  confirm: number;
  cancel: number;
  tabPrev: number;
  tabNext: number;
}

interface GpConfig {
  enabled: boolean;
  layout: LayoutId;
  deadzone: number;
  repeatMs: number;
  vibration: boolean;
  binds: GpBinds | null;
}

interface Battery {
  percent: number;
  charging: boolean;
}

const DEFAULT_CONFIG: GpConfig = {
  enabled: true,
  layout: 'auto',
  deadzone: 0.4,
  repeatMs: 160,
  vibration: true,
  binds: null,
};

interface HidReportEvent {
  reportId: number;
  data: DataView;
}

interface HidPad {
  vendorId: number;
  productId: number;
  opened: boolean;
  open: () => Promise<void>;
  sendReport: (reportId: number, data: BufferSource) => Promise<void>;
  oninputreport: ((event: HidReportEvent) => void) | null;
}

interface HidApi {
  getDevices: () => Promise<HidPad[]>;
  requestDevice: (opts: { filters: Array<{ vendorId: number; productId: number }> }) => Promise<HidPad[]>;
  addEventListener: (type: string, listener: (event: Event & { device?: HidPad }) => void) => void;
}

function hidApi(): HidApi | null {
  return (navigator as Navigator & { hid?: HidApi }).hid || null;
}

const HID_FILTERS: Array<{ vendorId: number; productId: number }> = [
  { vendorId: 0x054c, productId: 0x0ce6 },
  { vendorId: 0x054c, productId: 0x0df2 },
  { vendorId: 0x054c, productId: 0x05c4 },
  { vendorId: 0x054c, productId: 0x09cc },
  { vendorId: 0x057e, productId: 0x2009 },
  { vendorId: 0x045e, productId: 0x0b13 },
  { vendorId: 0x045e, productId: 0x0b12 },
  { vendorId: 0x045e, productId: 0x02ff },
  { vendorId: 0x045e, productId: 0x02fd },
  { vendorId: 0x045e, productId: 0x028e },
];

const FOCUSABLE = [
  'button',
  'a[href]',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'summary',
  '[role="button"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="switch"]',
  '.tab-btn',
  '.sidebar-card',
  '.account-selector',
  '.be-tab',
  '.tb-btn',
  '.tb-tasks-btn',
  '.ctx-item',
  '.ext-launchers__toggle',
  '.ext-import',
  '.stngs-select-opt',
  '.build-run-item',
  '.acc-popup-row',
].join(',');

const XBOX_GLYPHS = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'L3', 'R3', '↑', '↓', '←', '→'];
const PS_GLYPHS = ['✕', '○', '□', '△', 'L1', 'R1', 'L2', 'R2', 'Create', 'Options', 'L3', 'R3', '↑', '↓', '←', '→'];
const NIN_GLYPHS = ['B', 'A', 'Y', 'X', 'L', 'R', 'ZL', 'ZR', '−', '+', 'L3', 'R3', '↑', '↓', '←', '→'];

const BIND_ACTIONS: BindAction[] = ['confirm', 'cancel', 'tabPrev', 'tabNext'];

let translate: (key: string) => string = (key) => key;
let config = loadConfig();
let started = false;
let frame = 0;
let activeIndex = -1;
let focused: HTMLElement | null = null;
/** Правый стик на странице скинов: yaw, pitch (−1..1) и dt в секундах */
let lookHandler: ((x: number, y: number, dt: number) => void) | null = null;
let lookStamp = 0;
let stickDir: Dir | null = null;
let repeatAt = 0;
let prevButtons: boolean[] = [];
let captureAction: BindAction | null = null;
const batteryByKey = new Map<string, Battery>();

function loadConfig(): GpConfig {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '');
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_CONFIG };
    return {
      enabled: raw.enabled !== false,
      layout: ['auto', 'xbox', 'playstation', 'nintendo'].includes(raw.layout) ? raw.layout : 'auto',
      deadzone: clamp(Number(raw.deadzone) || DEFAULT_CONFIG.deadzone, 0.2, 0.8),
      repeatMs: clamp(Number(raw.repeatMs) || DEFAULT_CONFIG.repeatMs, 80, 280),
      vibration: raw.vibration !== false,
      binds: sanitizeBinds(raw.binds),
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function sanitizeBinds(value: unknown): GpBinds | null {
  if (!value || typeof value !== 'object') return null;
  const src = value as Partial<GpBinds>;
  const next = {
    confirm: Number(src.confirm),
    cancel: Number(src.cancel),
    tabPrev: Number(src.tabPrev),
    tabNext: Number(src.tabNext),
  };
  if (Object.values(next).some((n) => !Number.isInteger(n) || n < 0 || n > 15)) return null;
  return next;
}

function saveConfig(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function t(key: string): string {
  const value = translate(key);
  return value && value !== key ? value : key;
}

function prettyName(id: string): string {
  const cut = id.split('(')[0].trim();
  return cut || id || 'Gamepad';
}

function vendorProduct(id: string): { vendor: number; product: number } | null {
  const vendor = id.match(/Vendor:\s*([0-9a-f]+)/i);
  const product = id.match(/Product:\s*([0-9a-f]+)/i);
  if (!vendor || !product) return null;
  return { vendor: parseInt(vendor[1], 16), product: parseInt(product[1], 16) };
}

function detectLayout(id: string): Exclude<LayoutId, 'auto'> {
  const ids = vendorProduct(id);
  const text = id.toLowerCase();
  if (ids?.vendor === 0x054c || text.includes('dualsense') || text.includes('dualshock')) return 'playstation';
  if (ids?.vendor === 0x057e || text.includes('nintendo') || text.includes('switch')) return 'nintendo';
  return 'xbox';
}

function resolvedLayout(id: string): Exclude<LayoutId, 'auto'> {
  if (config.layout !== 'auto') return config.layout;
  return id ? detectLayout(id) : 'xbox';
}

function glyphsFor(id: string): string[] {
  const layout = resolvedLayout(id);
  if (layout === 'playstation') return PS_GLYPHS;
  if (layout === 'nintendo') return NIN_GLYPHS;
  return XBOX_GLYPHS;
}

function defaultBinds(id: string): GpBinds {
  const nintendo = resolvedLayout(id) === 'nintendo';
  return {
    confirm: nintendo ? 1 : 0,
    cancel: nintendo ? 0 : 1,
    tabPrev: 4,
    tabNext: 5,
  };
}

function bindsFor(id: string): GpBinds {
  return config.binds || defaultBinds(id);
}

function glyph(id: string, index: number): string {
  return glyphsFor(id)[index] || String(index);
}

const GLYPH_FOLDERS: Record<Exclude<LayoutId, 'auto'>, string> = {
  xbox: 'xbox',
  playstation: 'playstation',
  nintendo: 'switch',
};

/** Белые SVG из @lizardbyte/gamepad-helper (кнопки Zacksly, CC BY 3.0). Индекс — стандарт Gamepad API. */
function glyphSrc(id: string, index: number): string | null {
  if (!Number.isInteger(index) || index < 0 || index > 15) return null;
  const folder = GLYPH_FOLDERS[resolvedLayout(id)];
  return `../../assets/icons/gamepads/${folder}/${index}.svg`;
}

function glyphMarkup(id: string, index: number): string {
  const src = glyphSrc(id, index);
  const alt = glyph(id, index);
  if (!src) return alt;
  return `<img class="gp-glyph" src="${src}" alt="${alt}">`;
}

/** Иконки подсказки зала аккаунтов: крестовина, подтверждение и отмена текущей раскладки. */
export function activeGamepadGlyphs(): { left: string; right: string; confirm: string; cancel: string } | null {
  const pad = pickActive(connectedPads());
  if (!pad || !config.enabled) return null;
  const binds = bindsFor(pad.id);
  const left = glyphSrc(pad.id, 14);
  const right = glyphSrc(pad.id, 15);
  const confirm = glyphSrc(pad.id, binds.confirm);
  const cancel = glyphSrc(pad.id, binds.cancel);
  if (!left || !right || !confirm || !cancel) return null;
  return { left, right, confirm, cancel };
}

// ===== Заряд: DualSense, DualShock 4, Switch =====

function hidKey(vendor: number, product: number): string {
  return `${vendor.toString(16)}:${product.toString(16)}`;
}

function parseSony(data: DataView, reportId: number): Battery | null {
  const offset = reportId === 0x31 ? 53 : 52;
  if (data.byteLength <= offset) return null;
  const raw = data.getUint8(offset);
  const level = raw & 0x0f;
  if (level > 10) return null;
  const full = (raw & 0x20) !== 0;
  return { percent: full ? 100 : Math.min(100, level * 10), charging: (raw & 0x10) !== 0 && !full };
}

function parseDs4(data: DataView, reportId: number): Battery | null {
  const offset = reportId === 0x11 ? 32 : 29;
  if (data.byteLength <= offset) return null;
  const raw = data.getUint8(offset);
  const level = raw & 0x0f;
  if (level > 10) return null;
  return { percent: Math.min(100, level * 10), charging: (raw & 0x10) !== 0 };
}

function parseSwitch(data: DataView, reportId: number): Battery | null {
  if (reportId !== 0x30 && reportId !== 0x21) return null;
  if (data.byteLength < 2) return null;
  const nibble = data.getUint8(1) >> 4;
  const level = nibble & 0x7;
  if (level > 4) return null;
  return { percent: level * 25, charging: nibble >= 8 };
}

function parseBattery(device: HidPad, reportId: number, data: DataView): Battery | null {
  if (device.vendorId === 0x054c && (device.productId === 0x0ce6 || device.productId === 0x0df2)) {
    return parseSony(data, reportId);
  }
  if (device.vendorId === 0x054c) return parseDs4(data, reportId);
  if (device.vendorId === 0x057e) return parseSwitch(data, reportId);
  return null;
}

function rememberBattery(device: HidPad, battery: Battery | null): void {
  if (!battery) return;
  batteryByKey.set(hidKey(device.vendorId, device.productId), battery);
  paintStatus();
}

const openHid: HidPad[] = [];

async function watchHid(device: HidPad): Promise<void> {
  if (!device.opened) {
    try { await device.open(); } catch { return; }
  }
  if (!openHid.includes(device)) openHid.push(device);
  device.oninputreport = (event) => {
    rememberBattery(device, parseBattery(device, event.reportId, event.data));
  };
  void paintGamepadColor(device);
}

function accentBytes(): { r: number; g: number; b: number } {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(raw);
  if (!match) return { r: 112, g: 173, b: 223 };
  return { r: parseInt(match[1], 16), g: parseInt(match[2], 16), b: parseInt(match[3], 16) };
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function paintGamepadColor(device: HidPad): Promise<void> {
  const { r, g, b } = accentBytes();
  const sony = device.vendorId === 0x054c;
  if (!sony) return;
  const edge = device.productId === 0x0df2;
  const dualsense = device.productId === 0x0ce6 || edge;
  try {
    if (dualsense) {
      // USB output 0x02: флаги и RGB светодиода в конце отчёта.
      const usb = new Uint8Array(47);
      usb[0] = 0xff;
      usb[1] = 0xf7;
      usb[44] = r;
      usb[45] = g;
      usb[46] = b;
      await device.sendReport(0x02, usb);
      return;
    }
    const ds4 = new Uint8Array(31);
    ds4[0] = 0xff;
    ds4[5] = r;
    ds4[6] = g;
    ds4[7] = b;
    await device.sendReport(0x05, ds4);
  } catch {
    if (!dualsense) return;
    try {
      // Bluetooth: отчёт 0x31, общая часть с 2-го байта, CRC32 с префиксом 0xA2.
      const raw = new Uint8Array(78);
      raw[0] = 0x31;
      raw[1] = 0x02;
      raw[2] = 0xff;
      raw[3] = 0xf7;
      raw[46] = r;
      raw[47] = g;
      raw[48] = b;
      const crcInput = new Uint8Array(75);
      crcInput[0] = 0xa2;
      crcInput.set(raw.subarray(0, 74), 1);
      const crc = crc32(crcInput);
      raw[74] = crc & 0xff;
      raw[75] = (crc >>> 8) & 0xff;
      raw[76] = (crc >>> 16) & 0xff;
      raw[77] = (crc >>> 24) & 0xff;
      await device.sendReport(0x31, raw.subarray(1));
    } catch { /* контроллер не принял цвет */ }
  }
}

export function setGamepadLook(handler: ((x: number, y: number, dt: number) => void) | null): void {
  lookHandler = handler;
}

/** Пока открыт зал аккаунтов, стик и крестовина листают персонажей, а не интерфейс лаунчера. */
export type AccountStagePad = {
  move: (dir: -1 | 1) => void;
  confirm: () => void;
};

let accountStagePad: AccountStagePad | null = null;
let stageStickDir: Dir | null = null;
let stageRepeatAt = 0;

export function setAccountStagePad(handler: AccountStagePad | null): void {
  accountStagePad = handler;
  stageStickDir = null;
}

export function syncGamepadColor(): void {
  for (const device of openHid) void paintGamepadColor(device);
}

async function refreshHid(): Promise<void> {
  const hid = hidApi();
  if (!hid?.getDevices) return;
  let devices: HidPad[] = [];
  try { devices = await hid.getDevices(); } catch { return; }
  for (const device of devices) void watchHid(device);
}

async function requestBatteryAccess(): Promise<void> {
  const hid = hidApi();
  if (!hid?.requestDevice) return;
  try {
    const devices = await hid.requestDevice({ filters: HID_FILTERS });
    for (const device of devices) void watchHid(device);
  } catch { /* нет жеста или устройство не отдаёт HID */ }
}

function batteryFor(id: string): Battery | null {
  const ids = vendorProduct(id);
  if (!ids) return batteryByKey.size === 1 ? [...batteryByKey.values()][0] : null;
  return batteryByKey.get(hidKey(ids.vendor, ids.product)) || null;
}

// ===== Список геймпадов =====

function connectedPads(): Gamepad[] {
  const list = navigator.getGamepads?.() || [];
  const out: Gamepad[] = [];
  for (const pad of list) {
    if (pad && pad.connected) out.push(pad);
  }
  return out;
}

function pickActive(pads: Gamepad[]): Gamepad | null {
  if (!pads.length) return null;
  const current = pads.find((pad) => pad.index === activeIndex);
  return current || pads[0];
}

function paintStatus(): void {
  const box = document.getElementById('gamepad-status');
  const nameEl = document.getElementById('gamepad-status-name');
  const percentEl = document.getElementById('gamepad-status-percent');
  const track = document.getElementById('gamepad-status-track');
  const fill = document.getElementById('gamepad-status-fill');
  const settingsName = document.getElementById('gp-settings-name');
  const settingsBattery = document.getElementById('gp-settings-battery');
  const pad = pickActive(connectedPads());
  if (!box || !nameEl || !percentEl || !track || !fill) return;
  if (!pad) {
    box.classList.add('hidden');
    box.hidden = true;
    activeIndex = -1;
    if (settingsName) settingsName.textContent = t('stngs.gamepadDisconnected');
    if (settingsBattery) settingsBattery.textContent = '';
    clearFocus();
    return;
  }
  activeIndex = pad.index;
  const name = prettyName(pad.id);
  const battery = batteryFor(pad.id);
  box.classList.remove('hidden');
  box.hidden = false;
  nameEl.textContent = name;
  box.title = battery ? `${name} · ${battery.percent}%` : name;
  box.classList.toggle('is-low', Boolean(battery && battery.percent <= 20));
  box.classList.toggle('is-charging', Boolean(battery?.charging));
  percentEl.textContent = battery ? `${battery.percent}%` : '';
  fill.style.width = battery ? `${battery.percent}%` : '0%';
  track.hidden = false;
  if (settingsName) settingsName.textContent = name;
  if (settingsBattery) {
    if (!battery) settingsBattery.textContent = t('stngs.gamepadUnknownBattery');
    else settingsBattery.textContent = battery.charging
      ? `${t('stngs.gamepadBattery')}: ${battery.percent}% · ${t('stngs.gamepadCharging')}`
      : `${t('stngs.gamepadBattery')}: ${battery.percent}%`;
  }
}

// ===== Фокус: тот же контур, что у списка найденных лаунчеров =====

function ensureRing(): SVGRectElement | null {
  let svg = document.querySelector<SVGSVGElement>('.gp-focus-ring');
  if (!svg) {
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'gp-focus-ring');
    svg.setAttribute('aria-hidden', 'true');
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('class', 'ext-ring__base');
    svg.appendChild(rect);
    document.body.appendChild(svg);
  }
  return svg.querySelector('rect');
}

function visibleRect(el: HTMLElement): DOMRect | null {
  const bounds = el.getBoundingClientRect();
  let left = bounds.left;
  let top = bounds.top;
  let right = bounds.right;
  let bottom = bounds.bottom;
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    const style = getComputedStyle(node);
    const clips = /hidden|auto|scroll|clip/.test(`${style.overflow}${style.overflowX}${style.overflowY}`);
    if (clips) {
      const parent = node.getBoundingClientRect();
      left = Math.max(left, parent.left);
      top = Math.max(top, parent.top);
      right = Math.min(right, parent.right);
      bottom = Math.min(bottom, parent.bottom);
    }
    node = node.parentElement;
  }
  left = Math.max(left, 6);
  top = Math.max(top, 6);
  right = Math.min(right, window.innerWidth - 6);
  bottom = Math.min(bottom, window.innerHeight - 6);
  if (right - left < 10 || bottom - top < 10) return null;
  return new DOMRect(left, top, right - left, bottom - top);
}

function ensureFocusGlyph(): HTMLImageElement {
  let img = document.querySelector<HTMLImageElement>('.gp-focus-glyph');
  if (!img) {
    img = document.createElement('img');
    img.className = 'gp-focus-glyph';
    img.alt = '';
    document.body.appendChild(img);
  }
  return img;
}

function paintFocusGlyph(left: number, top: number, boxW: number, boxH: number, pad: Gamepad | null): void {
  const img = ensureFocusGlyph();
  if (!pad) {
    img.classList.remove('is-on');
    return;
  }
  const index = bindsFor(pad.id).confirm;
  const src = glyphSrc(pad.id, index);
  if (!src) {
    img.classList.remove('is-on');
    return;
  }
  if (img.getAttribute('src') !== src) img.src = src;
  img.alt = glyph(pad.id, index);
  const size = 22;
  img.classList.add('is-on');
  img.style.left = `${left + boxW - size / 2}px`;
  img.style.top = `${top + (boxH - size) / 2}px`;
}

function paintRing(): void {
  const svg = document.querySelector<SVGSVGElement>('.gp-focus-ring');
  const base = ensureRing();
  if (!svg || !base) return;
  const pad = pickActive(connectedPads());
  if (accountStagePad || !focused || !focused.isConnected || !config.enabled || !pad) {
    svg.classList.remove('is-on');
    paintFocusGlyph(0, 0, 0, 0, null);
    return;
  }
  const rect = visibleRect(focused);
  if (!rect) {
    svg.classList.remove('is-on');
    paintFocusGlyph(0, 0, 0, 0, null);
    return;
  }
  const boxW = rect.width + RING_PAD * 2;
  const boxH = rect.height + RING_PAD * 2;
  let left = rect.left - RING_PAD;
  let top = rect.top - RING_PAD;
  if (left < 4) left = 4;
  if (top < 4) top = 4;
  if (left + boxW > window.innerWidth - 4) left = Math.max(4, window.innerWidth - 4 - boxW);
  if (top + boxH > window.innerHeight - 4) top = Math.max(4, window.innerHeight - 4 - boxH);
  svg.classList.add('is-on');
  svg.setAttribute('width', String(boxW));
  svg.setAttribute('height', String(boxH));
  svg.style.left = `${left}px`;
  svg.style.top = `${top}px`;
  svg.style.width = `${boxW}px`;
  svg.style.height = `${boxH}px`;
  const inset = RING_PAD - 3;
  const rx = Math.min(RING_RX, (rect.width + 6) / 2, (rect.height + 6) / 2);
  base.setAttribute('x', String(inset));
  base.setAttribute('y', String(inset));
  base.setAttribute('width', String(Math.max(8, rect.width + 6)));
  base.setAttribute('height', String(Math.max(8, rect.height + 6)));
  base.setAttribute('rx', String(rx));
  base.setAttribute('ry', String(rx));
  paintFocusGlyph(left, top, boxW, boxH, pad);
}

function clearFocus(): void {
  focused = null;
  paintRing();
}

const LAYER_SELECTOR = [
  '.modal-confirm-overlay',
  '.modal-overlay',
  '.build-run-panel.is-open',
  '.stngs-select-wrap.open',
  '#account-popup.open',
  '#ctx-menu.open',
  '#tb-tasks-menu.is-open',
  '.accent-color-pop:not(.hidden)',
  '[role="menu"].open',
  '[role="menu"].is-open',
  '.sf-post__menu.is-open',
  '.sf-pm-comment__menu.is-open',
].join(',');

function layerRank(el: HTMLElement): number {
  const z = Number(getComputedStyle(el).zIndex);
  return Number.isFinite(z) ? z : 0;
}

function navigationRoot(): HTMLElement {
  const layers = Array.from(document.querySelectorAll<HTMLElement>(LAYER_SELECTOR)).filter((el) => {
    if (el.classList.contains('hidden') || el.hasAttribute('hidden') || el.classList.contains('closing')) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 8 && rect.height > 8;
  });
  if (!layers.length) return document.body;
  let top = layers[0];
  for (const layer of layers) {
    if (layer === top) continue;
    if (top.contains(layer)) {
      top = layer;
      continue;
    }
    if (layer.contains(top)) continue;
    const dz = layerRank(layer) - layerRank(top);
    if (dz > 0) top = layer;
    else if (dz === 0 && (top.compareDocumentPosition(layer) & Node.DOCUMENT_POSITION_FOLLOWING)) top = layer;
  }
  return top;
}

function isNavigable(el: HTMLElement, root: ParentNode): boolean {
  if (!root.contains(el)) return false;
  if (el.closest('.gp-focus-ring, #splash')) return false;
  if (el.closest('[hidden], .hidden')) return false;
  if (el.classList.contains('hidden-card')) return false;
  if ((el as HTMLButtonElement).disabled) return false;
  if (el.getAttribute('aria-disabled') === 'true') return false;
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') return false;
  const rect = el.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return false;
  let parent = el.parentElement;
  while (parent) {
    const parentStyle = getComputedStyle(parent);
    if (parentStyle.overflow === 'hidden' || parentStyle.overflowY === 'hidden' || parentStyle.overflowX === 'hidden') {
      const parentRect = parent.getBoundingClientRect();
      if (parentRect.width < 2 || parentRect.height < 2) return false;
    }
    parent = parent.parentElement;
  }
  return true;
}

function candidates(): HTMLElement[] {
  const root = navigationRoot();
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => isNavigable(el, root));
}

function pickDirection(from: DOMRect, dir: Dir, list: HTMLElement[]): HTMLElement | null {
  const cx = from.left + from.width / 2;
  const cy = from.top + from.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of list) {
    if (el === focused) continue;
    const rect = el.getBoundingClientRect();
    const dx = rect.left + rect.width / 2 - cx;
    const dy = rect.top + rect.height / 2 - cy;
    if (dir === 'down' && dy < 8) continue;
    if (dir === 'up' && dy > -8) continue;
    if (dir === 'right' && dx < 8) continue;
    if (dir === 'left' && dx > -8) continue;
    const primary = dir === 'up' || dir === 'down' ? Math.abs(dy) : Math.abs(dx);
    const secondary = dir === 'up' || dir === 'down' ? Math.abs(dx) : Math.abs(dy);
    if (secondary > primary * 1.6 + 48) continue;
    const score = primary + secondary * 1.35;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

function scrollParent(el: HTMLElement | null): HTMLElement | null {
  const root = navigationRoot();
  let node = el?.parentElement || null;
  while (node && node !== document.body) {
    if (root !== document.body && node !== root && !root.contains(node)) break;
    const style = getComputedStyle(node);
    const scrollableY = (style.overflowY === 'auto' || style.overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 4;
    const scrollableX = (style.overflowX === 'auto' || style.overflowX === 'scroll') && node.scrollWidth > node.clientWidth + 4;
    if (scrollableY || scrollableX) return node;
    node = node.parentElement;
  }
  if (root !== document.body) return null;
  return document.querySelector<HTMLElement>('.tab-view.active');
}

function reveal(el: HTMLElement): void {
  const margin = 18;
  let parent: HTMLElement | null = el.parentElement;
  while (parent) {
    const style = getComputedStyle(parent);
    const canY = style.overflowY === 'auto' || style.overflowY === 'scroll';
    const canX = style.overflowX === 'auto' || style.overflowX === 'scroll';
    if (canY || canX) {
      const host = parent.getBoundingClientRect();
      const rect = el.getBoundingClientRect();
      if (canY && rect.top - margin < host.top) parent.scrollTop -= host.top - (rect.top - margin);
      else if (canY && rect.bottom + margin > host.bottom) parent.scrollTop += rect.bottom + margin - host.bottom;
      if (canX && rect.left - margin < host.left) parent.scrollLeft -= host.left - (rect.left - margin);
      else if (canX && rect.right + margin > host.right) parent.scrollLeft += rect.right + margin - host.right;
    }
    parent = parent.parentElement;
  }
}

function moveFocus(dir: Dir): void {
  const list = candidates();
  if (!list.length) return;
  if (focused && !list.includes(focused)) focused = null;
  const range = focused instanceof HTMLInputElement && focused.type === 'range' ? focused : null;
  if (range && (dir === 'left' || dir === 'right')) {
    const min = Number(range.min) || 0;
    const max = Number(range.max) || 100;
    const step = Number(range.step) || 1;
    const current = Number(range.value) || 0;
    range.value = String(dir === 'right' ? Math.min(max, current + step) : Math.max(min, current - step));
    range.dispatchEvent(new Event('input', { bubbles: true }));
    range.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  let next = focused ? pickDirection(focused.getBoundingClientRect(), dir, list) : list[0];
  if (!next && focused && navigationRoot() === document.body) {
    const scroller = scrollParent(focused);
    if (scroller) {
      scroller.scrollBy({
        top: dir === 'down' ? 80 : dir === 'up' ? -80 : 0,
        left: dir === 'right' ? 80 : dir === 'left' ? -80 : 0,
      });
      next = pickDirection(focused.getBoundingClientRect(), dir, candidates());
    }
  }
  if (!next || next === focused) return;
  focused = next;
  reveal(focused);
  playUiSfx('focus');
  paintRing();
}

function typingInField(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el || el === focused) return false;
  if (el.tagName === 'TEXTAREA' || el.isContentEditable) return true;
  if (el.tagName !== 'INPUT') return false;
  const type = (el as HTMLInputElement).type;
  return !['button', 'submit', 'checkbox', 'radio', 'range', 'file'].includes(type);
}

function pressEscape(): void {
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  document.dispatchEvent(event);
  const root = navigationRoot();
  if (root instanceof HTMLElement && root !== document.body) {
    root.querySelector<HTMLElement>('.modal-close, [data-close]')?.click();
  }
}

let pendingGamepadLaunch = false;

export function takeGamepadLaunch(): boolean {
  const armed = pendingGamepadLaunch;
  pendingGamepadLaunch = false;
  return armed;
}

function isLaunchControl(el: HTMLElement): boolean {
  return Boolean(el.closest('#build-run-play, .launch-btn'));
}

function activate(el: HTMLElement): void {
  if (isLaunchControl(el)) pendingGamepadLaunch = true;
  if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
    el.click();
    return;
  }
  el.click();
}

function switchTab(step: number): void {
  if (navigationRoot() !== document.body) return;
  const tabs = Array.from(document.querySelectorAll<HTMLElement>('#tab-panel .tab-btn'))
    .filter((tab) => isNavigable(tab, document.body));
  if (!tabs.length) return;
  const current = tabs.findIndex((tab) => tab.classList.contains('active'));
  const index = current < 0 ? 0 : (current + step + tabs.length) % tabs.length;
  tabs[index].click();
  focused = tabs[index];
  paintRing();
}

function rumble(pad: Gamepad): void {
  if (!config.vibration) return;
  const actuator = (pad as Gamepad & {
    vibrationActuator?: { playEffect: (type: string, params: Record<string, number>) => Promise<void> };
  }).vibrationActuator;
  if (!actuator?.playEffect) return;
  void actuator.playEffect('dual-rumble', {
    startDelay: 0,
    duration: 28,
    weakMagnitude: 0.18,
    strongMagnitude: 0.28,
  }).catch(() => {});
}

function readStick(pad: Gamepad): Dir | null {
  const dead = config.deadzone;
  const lx = pad.axes[0] || 0;
  const ly = pad.axes[1] || 0;
  const ax = Math.abs(lx);
  const ay = Math.abs(ly);
  if (ax < dead && ay < dead) return null;
  if (ax > ay) return lx > 0 ? 'right' : 'left';
  return ly > 0 ? 'down' : 'up';
}

function readDpad(pad: Gamepad, down: boolean[]): Dir | null {
  if (down[12]) return 'up';
  if (down[13]) return 'down';
  if (down[14]) return 'left';
  if (down[15]) return 'right';
  return null;
}

function buttonDown(pad: Gamepad): boolean[] {
  return pad.buttons.map((button) => Boolean(button?.pressed) || (button?.value || 0) > 0.55);
}

function onDirection(dir: Dir | null, now: number): void {
  if (!dir) {
    stickDir = null;
    return;
  }
  if (dir !== stickDir) {
    stickDir = dir;
    repeatAt = now + 320;
    moveFocus(dir);
    return;
  }
  if (now >= repeatAt) {
    repeatAt = now + config.repeatMs;
    moveFocus(dir);
  }
}

function onButtons(pad: Gamepad, down: boolean[]): void {
  const binds = bindsFor(pad.id);
  const edges: number[] = [];
  for (let i = 0; i < down.length; i += 1) {
    if (down[i] && !prevButtons[i]) edges.push(i);
  }
  if (captureAction && edges.length) {
    const index = edges.find((i) => i < 12) ?? edges[0];
    config.binds = { ...(config.binds || defaultBinds(pad.id)), [captureAction]: index };
    captureAction = null;
    saveConfig();
    renderBinds(pad.id);
    rumble(pad);
    return;
  }
  if (edges.includes(binds.confirm) && focused) {
    rumble(pad);
    playUiSfx('press');
    activate(focused);
  } else if (edges.includes(binds.cancel)) {
    if (document.activeElement instanceof HTMLElement && typingInField()) {
      (document.activeElement as HTMLElement).blur();
    } else {
      pressEscape();
    }
  }
  if (edges.includes(binds.tabPrev)) switchTab(-1);
  if (edges.includes(binds.tabNext)) switchTab(1);
}

function paintTester(pad: Gamepad | null): void {
  const host = document.getElementById('gp-tester');
  const panel = document.querySelector('.stngs-panel[data-settings-panel="gamepad"]');
  if (!host || !panel?.classList.contains('active')) return;
  const id = pad?.id || '';
  const labels = glyphsFor(id);
  if (host.childElementCount !== labels.length || host.dataset.layout !== resolvedLayout(id)) {
    host.dataset.layout = resolvedLayout(id);
    host.innerHTML = labels.map((_, index) => `<span class="gp-tester__key">${glyphMarkup(id, index)}</span>`).join('');
  }
  const cells = host.querySelectorAll<HTMLElement>('.gp-tester__key');
  cells.forEach((cell, index) => {
    cell.classList.toggle('is-down', Boolean(pad?.buttons[index]?.pressed || (pad?.buttons[index]?.value || 0) > 0.55));
  });
}

function keepFocusInside(): void {
  const root = navigationRoot();
  if (!focused || root.contains(focused)) return;
  const yes = root.id === 'modal-confirm' ? document.getElementById('confirm-yes') : null;
  focused = (yes && root.contains(yes) ? yes : null) || candidates()[0] || null;
  if (focused) reveal(focused);
}

function tick(now: number): void {
  frame = requestAnimationFrame(tick);
  const pads = connectedPads();
  const pad = pickActive(pads);
  keepFocusInside();
  paintRing();
  paintTester(pad);
  if (!pad || !config.enabled || typingInField()) {
    prevButtons = pad ? buttonDown(pad) : [];
    stickDir = null;
    return;
  }
  const down = buttonDown(pad);
  const dir = readDpad(pad, down) || readStick(pad);
  if (accountStagePad) {
    if (prevButtons.length) {
      const binds = bindsFor(pad.id);
      const edges: number[] = [];
      for (let i = 0; i < down.length; i += 1) {
        if (down[i] && !prevButtons[i]) edges.push(i);
      }
      if (edges.includes(binds.confirm)) {
        rumble(pad);
        playUiSfx('press');
        accountStagePad.confirm();
      } else if (edges.includes(binds.cancel)) {
        pressEscape();
      }
    }
    prevButtons = down;
    if (dir === 'left' || dir === 'right') {
      if (dir !== stageStickDir) {
        stageStickDir = dir;
        stageRepeatAt = now + 320;
        playUiSfx('focus');
        accountStagePad.move(dir === 'right' ? 1 : -1);
      } else if (now >= stageRepeatAt) {
        stageRepeatAt = now + config.repeatMs;
        playUiSfx('focus');
        accountStagePad.move(dir === 'right' ? 1 : -1);
      }
    } else {
      stageStickDir = null;
    }
    return;
  }
  if (prevButtons.length) onButtons(pad, down);
  prevButtons = down;
  onDirection(dir, now);
  const lookX = shapedAxis(pad.axes[2] || 0);
  const lookY = shapedAxis(pad.axes[3] || 0);
  const skinsLook = Boolean(
    lookHandler
    && document.getElementById('tab-skins')?.classList.contains('active')
    && navigationRoot() === document.body
    && !captureAction,
  );
  if (skinsLook && (lookX !== 0 || lookY !== 0)) {
    const dt = lookStamp ? Math.min(0.05, Math.max(0, (now - lookStamp) / 1000)) : 1 / 60;
    lookStamp = now;
    lookHandler!(lookX, lookY, dt);
  } else {
    lookStamp = now;
    const scrollAxis = pad.axes[3] || 0;
    if (Math.abs(scrollAxis) > config.deadzone) {
      const scroller = scrollParent(focused) || (navigationRoot() !== document.body ? navigationRoot() : null);
      if (scroller && scroller.scrollHeight > scroller.clientHeight + 4) {
        scroller.scrollBy({ top: scrollAxis * 14 });
      }
    }
  }
}

/** Ось стика за мёртвой зоной, −1..1 */
function shapedAxis(value: number): number {
  const mag = Math.abs(value);
  if (mag <= config.deadzone) return 0;
  const span = Math.max(0.001, 1 - config.deadzone);
  return Math.sign(value) * Math.min(1, (mag - config.deadzone) / span);
}

function ensureLoop(): void {
  if (frame) return;
  frame = requestAnimationFrame(tick);
}

// ===== Настройки =====

function renderBinds(id = pickActive(connectedPads())?.id || ''): void {
  const host = document.getElementById('gp-bind-list');
  if (!host) return;
  const binds = bindsFor(id);
  host.innerHTML = BIND_ACTIONS.map((action) => {
    const capturing = captureAction === action;
    const label = capturing ? t('stngs.gamepadPress') : glyphMarkup(id, binds[action]);
    return `<button type="button" class="gp-bind${capturing ? ' is-capturing' : ''}" data-gp-bind="${action}">
      <span>${t(`stngs.gamepadBind.${action}`)}</span>
      <span class="gp-bind__key">${label}</span>
    </button>`;
  }).join('');
}

function bindSettings(): void {
  const enabled = document.getElementById('setting-gamepad-enabled') as HTMLInputElement | null;
  const layout = document.getElementById('setting-gamepad-layout') as HTMLSelectElement | null;
  const deadzone = document.getElementById('setting-gamepad-deadzone') as HTMLInputElement | null;
  const repeat = document.getElementById('setting-gamepad-repeat') as HTMLInputElement | null;
  const vibration = document.getElementById('setting-gamepad-vibration') as HTMLInputElement | null;
  if (enabled) enabled.checked = config.enabled;
  if (layout) layout.value = config.layout;
  if (deadzone) deadzone.value = String(config.deadzone);
  if (repeat) repeat.value = String(config.repeatMs);
  paintRange(deadzone);
  paintRange(repeat);
  if (vibration) vibration.checked = config.vibration;
  syncSettingLabels();
  enabled?.addEventListener('change', () => {
    config.enabled = enabled.checked;
    saveConfig();
    if (!config.enabled) clearFocus();
  });
  layout?.addEventListener('change', () => {
    config.layout = layout.value as LayoutId;
    config.binds = null;
    saveConfig();
    renderBinds();
  });
  deadzone?.addEventListener('input', () => {
    config.deadzone = clamp(Number(deadzone.value) || 0.4, 0.2, 0.8);
    saveConfig();
    syncSettingLabels();
    paintRange(deadzone);
  });
  repeat?.addEventListener('input', () => {
    config.repeatMs = clamp(Number(repeat.value) || 160, 80, 280);
    saveConfig();
    syncSettingLabels();
    paintRange(repeat);
  });
  vibration?.addEventListener('change', () => {
    config.vibration = vibration.checked;
    saveConfig();
  });
  document.getElementById('gp-bind-list')?.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-gp-bind]');
    const action = button?.getAttribute('data-gp-bind') as BindAction | null;
    if (!action) return;
    captureAction = captureAction === action ? null : action;
    renderBinds();
  });
  document.getElementById('gp-battery-access')?.addEventListener('click', () => {
    void requestBatteryAccess();
  });
}

function paintRange(el: HTMLInputElement | null): void {
  if (!el) return;
  const min = Number(el.min) || 0;
  const max = Number(el.max) || 100;
  const val = Number(el.value);
  const pct = max === min ? 0 : ((val - min) / (max - min)) * 100;
  el.style.setProperty('--range-progress', `${pct}%`);
}

function syncSettingLabels(): void {
  const dead = document.getElementById('setting-gamepad-deadzone-label');
  const repeat = document.getElementById('setting-gamepad-repeat-label');
  if (dead) dead.textContent = `${Math.round(config.deadzone * 100)}%`;
  if (repeat) repeat.textContent = String(config.repeatMs);
}

export function refreshGamepadLabels(): void {
  syncSettingLabels();
  renderBinds();
  paintStatus();
  const layout = document.getElementById('setting-gamepad-layout') as HTMLSelectElement | null;
  const value = layout?.closest('.stngs-select-wrap')?.querySelector('.stngs-select-value');
  if (value && layout?.selectedOptions[0]) value.textContent = layout.selectedOptions[0].textContent || '';
}

export function initGamepad(tFn: (key: string) => string): void {
  translate = tFn;
  if (started) {
    refreshGamepadLabels();
    return;
  }
  started = true;
  bindSettings();
  renderBinds();
  paintStatus();
  window.addEventListener('gamepadconnected', () => {
    paintStatus();
    void refreshHid();
    ensureLoop();
  });
  window.addEventListener('gamepaddisconnected', () => {
    paintStatus();
    ensureLoop();
  });
  hidApi()?.addEventListener('connect', () => { void refreshHid(); });
  hidApi()?.addEventListener('disconnect', (event) => {
    const device = event.device;
    if (device) batteryByKey.delete(hidKey(device.vendorId, device.productId));
    paintStatus();
  });
  window.addEventListener('pointerdown', () => {
    if (document.activeElement === focused) return;
    clearFocus();
  }, true);
  window.setInterval(() => {
    paintStatus();
  }, 500);
  const arm = () => {
    window.removeEventListener('pointerdown', arm, true);
    void requestBatteryAccess();
  };
  window.addEventListener('pointerdown', arm, true);
  void refreshHid();
  ensureLoop();
}
