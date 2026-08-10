// Сервис просмотра миров: открывает сохранение, проверяет версию и отдаёт колонки
// в окно рендерера через IPC.
//
// Вся работа с диском и zlib живёт здесь, в main-процессе: в браузерном бандле окна
// мира нет ни fs, ни zlib, а CSP не даёт их подтянуть.

import { BrowserWindow, ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { parse as parseNbt } from 'prismarine-nbt';
import {
  RegionFile, REGION_SIZE, MIN_DATA_VERSION, MAX_DATA_VERSION,
  parseRegionName, parseChunkTag, chunkTagToWire, geometryForDataVersion,
  isRenderableStatus, sampleSurfaceY,
  type WireColumn, type ColumnGeometry,
} from './anvil';
import { getInstancesDir } from './launcher';

// ===== Названия версий по DataVersion =====

/** Релизные версии Java Edition: DataVersion -> имя. Нужны только для сообщений. */
const RELEASES: Array<[number, string]> = [
  [1519, '1.13'], [1628, '1.13.1'], [1631, '1.13.2'],
  [1952, '1.14'], [1957, '1.14.1'], [1963, '1.14.2'], [1968, '1.14.3'], [1976, '1.14.4'],
  [2225, '1.15'], [2227, '1.15.1'], [2230, '1.15.2'],
  [2566, '1.16'], [2567, '1.16.1'], [2578, '1.16.2'], [2580, '1.16.3'], [2584, '1.16.4'], [2586, '1.16.5'],
  [2724, '1.17'], [2730, '1.17.1'],
  [2860, '1.18'], [2865, '1.18.1'], [2975, '1.18.2'],
  [3105, '1.19'], [3117, '1.19.1'], [3120, '1.19.2'], [3218, '1.19.3'], [3337, '1.19.4'],
  [3463, '1.20'], [3465, '1.20.1'], [3578, '1.20.2'], [3698, '1.20.3'], [3700, '1.20.4'],
  [3837, '1.20.5'], [3839, '1.20.6'],
  [3953, '1.21'], [3955, '1.21.1'], [4080, '1.21.2'], [4082, '1.21.3'], [4189, '1.21.4'],
  [4325, '1.21.5'], [4435, '1.21.6'], [4438, '1.21.7'], [4440, '1.21.8'],
  [4554, '1.21.9'], [4556, '1.21.10'], [4671, '1.21.11'],
];

/** Ближайший релиз, не превышающий dataVersion (для миров из снапшотов). */
function guessVersionName(dataVersion: number): string {
  if (dataVersion > 0 && dataVersion < RELEASES[0][0]) {
    return `старее 1.13 (DataVersion ${dataVersion})`;
  }
  let best = '';
  for (const [dv, name] of RELEASES) {
    if (dv <= dataVersion) best = name;
  }
  if (!best) return `DataVersion ${dataVersion}`;
  const exact = RELEASES.find(([dv]) => dv === dataVersion);
  return exact ? exact[1] : `~${best} (DataVersion ${dataVersion})`;
}

export const SUPPORTED_RANGE = '1.13 – 1.21';

/** Радиус (в чанках), по которому ищется самая плотно сгенерированная область мира. */
const START_SEARCH_RADIUS = 5;

// ===== Описание открытого мира =====

export interface WorldInfo {
  ok: boolean;
  /** Понятное пользователю сообщение об отказе (версия вне диапазона, нет региона и т. п.). */
  message?: string;
  worldPath: string;
  name: string;
  versionName: string;
  dataVersion: number;
  minY: number;
  worldHeight: number;
  /** Стартовая точка камеры в мировых координатах. */
  start: { x: number; y: number; z: number };
  /** Сколько колонок доступно во всех region-файлах. */
  chunkCount: number;
  regionCount: number;
  /** Источник стартовой позиции: player | spawn | chunk. */
  startSource: string;
}

function nbtValue(tag: any): any {
  if (tag == null) return undefined;
  if (typeof tag === 'object' && 'value' in tag) return tag.value;
  return tag;
}

/**
 * Находит каталог с region-файлами обычного мира.
 * Порядок важен: ванилла кладёт их в <world>/region, но моды и датапаки с
 * кастомными измерениями переносят обычный мир в
 * <world>/dimensions/minecraft/overworld/region. Последним кандидатом идёт сам путь —
 * так можно указать папку с одними .mca (например тестовые фикстуры).
 */
function resolveRegionDir(worldPath: string): string | null {
  const candidates = [
    path.join(worldPath, 'region'),
    path.join(worldPath, 'dimensions', 'minecraft', 'overworld', 'region'),
    path.join(worldPath, 'DIM0', 'region'),
    worldPath,
  ];

  // Прочие измерения из датапаков: dimensions/<namespace>/<id>/region.
  const dimensionsRoot = path.join(worldPath, 'dimensions');
  try {
    for (const ns of fs.readdirSync(dimensionsRoot, { withFileTypes: true })) {
      if (!ns.isDirectory()) continue;
      for (const id of fs.readdirSync(path.join(dimensionsRoot, ns.name), { withFileTypes: true })) {
        if (id.isDirectory()) candidates.push(path.join(dimensionsRoot, ns.name, id.name, 'region'));
      }
    }
  } catch { /* каталога dimensions нет — обычный ванильный мир */ }

  for (const dir of candidates) {
    try {
      if (fs.existsSync(dir) && fs.readdirSync(dir).some((f) => parseRegionName(f))) return dir;
    } catch { /* нет доступа — пробуем следующий */ }
  }
  return null;
}

// ===== Сессия чтения мира =====

/** Максимум одновременно открытых region-файлов. */
const MAX_OPEN_REGIONS = 8;

class WorldSession {
  readonly regionDir: string;
  private geometry: ColumnGeometry = { minY: 0, worldHeight: 256 };
  private dataVersion = 0;
  /** Открытые region-файлы: ключ `X,Z`, порядок вставки = давность обращения. */
  private open = new Map<string, RegionFile>();
  /** Какие region-файлы есть на диске. */
  private regions = new Set<string>();
  private columnCache = new Map<string, WireColumn | null>();
  /** Диагностика для отчёта о пропускной способности. */
  stats = { columnsRead: 0, bytes: 0, readMs: 0, skippedStatus: 0, failed: 0 };

  constructor(regionDir: string) {
    this.regionDir = regionDir;
    for (const file of fs.readdirSync(regionDir)) {
      const rc = parseRegionName(file);
      if (rc) this.regions.add(`${rc.x},${rc.z}`);
    }
  }

  setGeometry(geometry: ColumnGeometry, dataVersion: number): void {
    this.geometry = geometry;
    this.dataVersion = dataVersion;
  }

  get regionCount(): number {
    return this.regions.size;
  }

  private region(rx: number, rz: number): RegionFile | null {
    const key = `${rx},${rz}`;
    if (!this.regions.has(key)) return null;
    const cached = this.open.get(key);
    if (cached) return cached;
    const file = path.join(this.regionDir, `r.${rx}.${rz}.mca`);
    let handle: RegionFile;
    try {
      handle = RegionFile.open(file);
    } catch {
      this.regions.delete(key);
      return null;
    }
    if (this.open.size >= MAX_OPEN_REGIONS) {
      const oldest = this.open.keys().next().value as string;
      this.open.get(oldest)?.close();
      this.open.delete(oldest);
    }
    this.open.set(key, handle);
    return handle;
  }

  /** Число присутствующих на диске колонок (без разбора NBT). */
  countChunks(): number {
    let total = 0;
    for (const key of this.regions) {
      const [rx, rz] = key.split(',').map(Number);
      const handle = this.region(rx, rz);
      if (handle) total += handle.listChunks().length;
    }
    return total;
  }

  /**
   * DataVersion первого доступного чанка. Отдельно от поиска пригодной колонки:
   * версию нужно узнать и у миров, которые мы не поддерживаем (до 1.13 у чанков
   * вообще нет ни палитры блоков, ни тега Status).
   */
  probeDataVersion(): number {
    for (const key of [...this.regions].sort()) {
      const [rx, rz] = key.split(',').map(Number);
      const handle = this.region(rx, rz);
      if (!handle) continue;
      for (const c of handle.listChunks()) {
        const column = this.readColumnAt(rx * REGION_SIZE + c.localX, rz * REGION_SIZE + c.localZ);
        if (column) return column.dataVersion;
      }
    }
    return 0;
  }

  /** Первая колонка с готовым рельефом — нужна, чтобы узнать версию мира. */
  findAnyRenderableColumn(): WireColumn | null {
    for (const key of [...this.regions].sort()) {
      const [rx, rz] = key.split(',').map(Number);
      const handle = this.region(rx, rz);
      if (!handle) continue;
      const chunks = handle.listChunks();
      // Идём от середины: у краёв region-файла чаще недогенерированные чанки.
      const order = chunks
        .map((c, i) => ({ c, i }))
        .sort((a, b) => Math.abs(a.i - chunks.length / 2) - Math.abs(b.i - chunks.length / 2));
      for (const { c } of order) {
        const column = this.readColumnAt(rx * REGION_SIZE + c.localX, rz * REGION_SIZE + c.localZ);
        if (column && isRenderableStatus(column.status)) return column;
      }
    }
    return null;
  }

  /**
   * Колонка в самой «плотной» части мира: вокруг неё максимум полностью
   * сгенерированных соседей. Используется, когда в level.dat нет позиции игрока
   * (например для тестовых фикстур) — иначе камера смотрит в пустоту.
   */
  findDensestColumn(radius: number, scanLimit = 1200): WireColumn | null {
    const renderable: Array<{ x: number; z: number }> = [];
    let scanned = 0;

    for (const key of [...this.regions].sort()) {
      if (scanned >= scanLimit) break;
      const [rx, rz] = key.split(',').map(Number);
      const handle = this.region(rx, rz);
      if (!handle) continue;
      for (const c of handle.listChunks()) {
        if (scanned++ >= scanLimit) break;
        const x = rx * REGION_SIZE + c.localX;
        const z = rz * REGION_SIZE + c.localZ;
        const column = this.readColumn(x, z);
        if (column) renderable.push({ x, z });
      }
    }
    if (renderable.length === 0) return null;

    const present = new Set(renderable.map((c) => `${c.x},${c.z}`));
    let best = renderable[0];
    let bestScore = -1;
    for (const candidate of renderable) {
      let score = 0;
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
          if (present.has(`${candidate.x + dx},${candidate.z + dz}`)) score++;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    return this.readColumn(best.x, best.z);
  }

  /** Колонка по мировым координатам чанка; null — нет данных или чанк не догенерирован. */
  readColumn(chunkX: number, chunkZ: number): WireColumn | null {
    const key = `${chunkX},${chunkZ}`;
    if (this.columnCache.has(key)) return this.columnCache.get(key) ?? null;
    const column = this.readColumnAt(chunkX, chunkZ);
    const usable = column && isRenderableStatus(column.status) ? column : null;
    if (column && !usable) this.stats.skippedStatus++;
    // Кэш держим ограниченным: 1024 колонки ~ несколько десятков МБ.
    if (this.columnCache.size > 1024) this.columnCache.clear();
    this.columnCache.set(key, usable);
    return usable;
  }

  private readColumnAt(chunkX: number, chunkZ: number): WireColumn | null {
    const rx = Math.floor(chunkX / REGION_SIZE);
    const rz = Math.floor(chunkZ / REGION_SIZE);
    const handle = this.region(rx, rz);
    if (!handle) return null;
    const localX = ((chunkX % REGION_SIZE) + REGION_SIZE) % REGION_SIZE;
    const localZ = ((chunkZ % REGION_SIZE) + REGION_SIZE) % REGION_SIZE;
    const t0 = performance.now();
    try {
      const buffer = handle.readChunkNbt(localX, localZ);
      if (!buffer) return null;
      const column = chunkTagToWire(parseChunkTag(buffer), this.dataVersion ? this.geometry : undefined);
      column.x = chunkX;
      column.z = chunkZ;
      this.stats.columnsRead++;
      this.stats.bytes += column.byteSize;
      this.stats.readMs += performance.now() - t0;
      return column;
    } catch (e: any) {
      this.stats.failed++;
      console.warn(`[worldViewer] чанк ${chunkX},${chunkZ}: ${e?.message || e}`);
      return null;
    }
  }

  close(): void {
    for (const handle of this.open.values()) handle.close();
    this.open.clear();
    this.columnCache.clear();
  }
}

// ===== Открытие мира =====

const sessions = new Map<string, WorldSession>();

/** Сырые байты level.dat; распаковку gzip делает сам prismarine-nbt. */
function readLevelDatBuffer(worldPath: string): Buffer | null {
  const datPath = path.join(worldPath, 'level.dat');
  if (!fs.existsSync(datPath)) return null;
  try {
    return fs.readFileSync(datPath);
  } catch {
    return null;
  }
}

export async function describeWorld(worldPath: string): Promise<WorldInfo> {
  const fail = (message: string): WorldInfo => ({
    ok: false, message, worldPath, name: path.basename(worldPath), versionName: '',
    dataVersion: 0, minY: 0, worldHeight: 256, start: { x: 0, y: 64, z: 0 },
    chunkCount: 0, regionCount: 0, startSource: 'none',
  });

  if (!worldPath || !fs.existsSync(worldPath)) return fail(`Папка мира не найдена: ${worldPath}`);

  const regionDir = resolveRegionDir(worldPath);
  if (!regionDir) {
    return fail('В папке мира нет region-файлов (.mca). Похоже, мир ни разу не открывали в игре.');
  }

  let name = path.basename(worldPath);
  let dataVersion = 0;
  let versionName = '';
  let start: { x: number; y: number; z: number } | null = null;
  let startSource = 'none';

  const datBuffer = readLevelDatBuffer(worldPath);
  if (datBuffer) {
    try {
      const { parsed } = await parseNbt(datBuffer);
      const data: any = (parsed as any)?.value?.Data?.value ?? {};
      const levelName = nbtValue(data.LevelName);
      if (typeof levelName === 'string' && levelName) name = levelName;
      const dv = nbtValue(data.DataVersion);
      if (typeof dv === 'number') dataVersion = dv;
      const vName = nbtValue((data.Version as any)?.value?.Name ?? (data.Version as any)?.Name);
      if (typeof vName === 'string') versionName = vName;

      const playerPos = nbtValue(nbtValue(data.Player)?.Pos);
      const posList = Array.isArray(playerPos) ? playerPos : nbtValue(playerPos);
      if (Array.isArray(posList) && posList.length === 3) {
        start = { x: Number(posList[0]), y: Number(posList[1]), z: Number(posList[2]) };
        startSource = 'player';
      }
      if (!start) {
        const sx = nbtValue(data.SpawnX);
        const sy = nbtValue(data.SpawnY);
        const sz = nbtValue(data.SpawnZ);
        if (typeof sx === 'number' && typeof sz === 'number') {
          start = { x: sx, y: typeof sy === 'number' ? sy : 64, z: sz };
          startSource = 'spawn';
        }
      }
    } catch (e: any) {
      console.warn(`[worldViewer] level.dat не разобран: ${e?.message || e}`);
    }
  }

  const session = new WorldSession(regionDir);

  // Тестовые корпуса (фикстуры) идут без level.dat — версию берём из самого чанка.
  if (!dataVersion) dataVersion = session.probeDataVersion();
  if (!dataVersion && session.regionCount > 0) {
    // Чанки без DataVersion — это 1.8 и раньше: тег появился в 1.9.
    dataVersion = 1;
  }
  if (!dataVersion) {
    session.close();
    return fail('Не удалось определить версию мира: level.dat не читается и region-файлы пусты.');
  }

  if (!versionName) versionName = guessVersionName(dataVersion);

  if (dataVersion < MIN_DATA_VERSION || dataVersion > MAX_DATA_VERSION) {
    session.close();
    const info = fail(
      dataVersion < MIN_DATA_VERSION
        ? `Мир создан в версии ${versionName} — поддерживаются только ${SUPPORTED_RANGE}. `
          + 'До 1.13 блоки хранятся числовыми ID (до «расплющивания»), такие миры не открываем.'
        : `Мир создан в версии ${versionName} — поддерживаются только ${SUPPORTED_RANGE}.`,
    );
    info.dataVersion = dataVersion;
    info.versionName = versionName;
    info.name = name;
    return info;
  }

  const geometry = geometryForDataVersion(dataVersion);
  session.setGeometry(geometry, dataVersion);

  if (!start) {
    const probe = session.findDensestColumn(START_SEARCH_RADIUS) ?? session.findAnyRenderableColumn();
    if (probe) {
      start = { x: probe.x * 16 + 8, y: sampleSurfaceY(probe) + 2, z: probe.z * 16 + 8 };
      startSource = 'chunk';
    }
  } else {
    // Позиция игрока может указывать в незагруженную область — уточняем Y по рельефу.
    const column = session.readColumn(Math.floor(start.x / 16), Math.floor(start.z / 16));
    if (column) {
      start.y = Math.max(start.y, sampleSurfaceY(column, start.x & 15, start.z & 15) + 2);
    }
  }
  if (!start) {
    session.close();
    return fail('В region-файлах нет ни одного полностью сгенерированного чанка.');
  }

  sessions.get(worldPath)?.close();
  sessions.set(worldPath, session);

  return {
    ok: true,
    worldPath,
    name,
    versionName,
    dataVersion,
    minY: geometry.minY,
    worldHeight: geometry.worldHeight,
    start,
    chunkCount: session.countChunks(),
    regionCount: session.regionCount,
    startSource,
  };
}

// ===== Поиск миров в инстансах сборок =====

export interface WorldEntry {
  buildId: string;
  folder: string;
  worldPath: string;
}

/** Все миры во всех инстансах сборок плюс стандартный .minecraft. */
export function listAllWorlds(): WorldEntry[] {
  const out: WorldEntry[] = [];
  const roots: Array<{ buildId: string; savesDir: string }> = [];

  try {
    const instancesDir = getInstancesDir();
    for (const entry of fs.readdirSync(instancesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      roots.push({ buildId: entry.name, savesDir: path.join(instancesDir, entry.name, 'saves') });
    }
  } catch { /* инстансов ещё нет */ }

  const appData = process.env.APPDATA;
  if (appData) roots.push({ buildId: '.minecraft', savesDir: path.join(appData, '.minecraft', 'saves') });

  for (const { buildId, savesDir } of roots) {
    try {
      if (!fs.existsSync(savesDir)) continue;
      for (const entry of fs.readdirSync(savesDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        out.push({ buildId, folder: entry.name, worldPath: path.join(savesDir, entry.name) });
      }
    } catch { /* нет доступа */ }
  }
  return out;
}

// ===== IPC =====

export function registerWorldViewerIpc(): void {
  ipcMain.handle('worldview:describe', async (_event, worldPath: string) => describeWorld(worldPath));

  ipcMain.handle('worldview:list-worlds', () => listAllWorlds());

  ipcMain.handle('worldview:column', (_event, worldPath: string, chunkX: number, chunkZ: number) => {
    const session = sessions.get(worldPath);
    if (!session) return null;
    return session.readColumn(chunkX, chunkZ);
  });

  /** Пакетное чтение: один round-trip на кольцо чанков вокруг центра. */
  ipcMain.handle('worldview:columns', (_event, worldPath: string, coords: Array<[number, number]>) => {
    const session = sessions.get(worldPath);
    if (!session || !Array.isArray(coords)) return [];
    const out: WireColumn[] = [];
    for (const [cx, cz] of coords) {
      const column = session.readColumn(cx, cz);
      if (column) out.push(column);
    }
    return out;
  });

  ipcMain.handle('worldview:stats', (_event, worldPath: string) => sessions.get(worldPath)?.stats ?? null);

  ipcMain.handle('worldview:close', (_event, worldPath: string) => {
    sessions.get(worldPath)?.close();
    sessions.delete(worldPath);
  });

  /** Скриншот окна мира на диск — используется для фиксации результата. */
  ipcMain.handle('worldview:screenshot', async (event, filePath: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return { ok: false, error: 'нет окна' };
    const png = (await win.webContents.capturePage()).toPNG();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, png);
    return { ok: true, path: filePath, bytes: png.length };
  });
}

export function closeAllWorldSessions(): void {
  for (const session of sessions.values()) session.close();
  sessions.clear();
}
