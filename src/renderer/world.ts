// Точка входа окна просмотра мира.
//
// Окно читает НАСТОЯЩИЕ сохранения Minecraft Java Edition: region-файлы разбираются
// в main-процессе (src/main/anvil.ts, src/main/worldViewer.ts), сюда колонки приходят
// по IPC в компактном проводном виде и собираются в объекты prismarine-chunk, которые
// понимает minecraft-renderer.
//
// Почему разбор в main: там есть настоящие fs и zlib и нет CSP. Браузерный бандл этого
// окна собирается esbuild'ом с заглушками node-модулей, zlib в нём просто бросает ошибку.
//
// Окно грузится по кастомной схеме app://local/ (см. src/main/main.ts): mesherWasm.js
// инициализирует wasm по абсолютному пути '/wasm_mesher_bg.wasm', под file:// это не
// резолвится.
import { AppViewer, createGraphicsBackendSingleThread, getInitialPlayerState } from 'minecraft-renderer';
import { Vec3 } from 'vec3';
import ChunkLoader from 'prismarine-chunk';
import MinecraftData from 'minecraft-data';
import { createBlockResolver, formatStats } from './worldlib/mapping';
import { inspectChunkInternals, wireToColumn, createEmptyColumn } from './worldlib/column';
import type { WireColumn, WorldInfo } from './worldlib/types';
import {
  attachFlyControls,
  cameraFromPlayerFeet,
  rotationFromMinecraftDegrees,
} from './worldlib/fly-controls';
import { resolvePreviewStrategy, MESHER_MAX_VERSION } from './worldlib/version-matrix';
import { applyClientTexturesToViewer, tryLoadClientJarAtlas } from './worldlib/client-atlas';
import { spawnSavePlayerMarker } from './worldlib/player-marker';

// Версия реестра блоков должна совпадать с mesherWasm (у воркера нет 1.21.11).
// 1.21.6 — максимум pc-данных в мешере, при этом есть leaf_litter / bush / firefly_bush.
const RENDER_VERSION = '1.21.6';

/** Ближний радиус — быстрый первый кадр. */
const VIEW_DISTANCE_NEAR = 3;
/** Полный радиус: больше = тяжелее GPU и мешер. */
const VIEW_DISTANCE_FAR = 6;
/** Бюджет CPU на ingest колонок за один кадр (мс) — анти-фриз. */
const INGEST_FRAME_BUDGET_MS = 5;
/** Максимум строк в лог-панели (DOM-лаг). */
const LOG_MAX_LINES = 80;

// ===== Диагностика на экране =====

const statusEl = document.getElementById('status')!;
const logEl = document.getElementById('log')!;
const messageEl = document.getElementById('message')!;

function log(message: string, kind: 'info' | 'ok' | 'err' = 'info'): void {
  const line = document.createElement('div');
  line.className = `line ${kind}`;
  line.textContent = `${new Date().toISOString().slice(11, 23)}  ${message}`;
  logEl.appendChild(line);
  while (logEl.childElementCount > LOG_MAX_LINES) logEl.firstChild?.remove();
  logEl.scrollTop = logEl.scrollHeight;
  // eslint-disable-next-line no-console
  console.log(`[world] ${message}`);
}

function setStatus(text: string, kind: 'info' | 'ok' | 'err' = 'info'): void {
  statusEl.textContent = text;
  statusEl.className = kind;
}

/** Крупное сообщение поверх окна: для отказов вроде неподдерживаемой версии. */
function showMessage(title: string, detail: string): void {
  messageEl.innerHTML = '';
  const h = document.createElement('div');
  h.className = 'message-title';
  h.textContent = title;
  const p = document.createElement('div');
  p.className = 'message-text';
  p.textContent = detail;
  messageEl.append(h, p);
  messageEl.style.display = 'flex';
}

/**
 * Завершение автоматического прогона: скриншот текущего состояния окна и выход.
 * Вызывается и на успешном пути, и на отказах — иначе сценарий с --world-exit зависнет.
 */
async function finishRun(report: Record<string, any>): Promise<void> {
  const api = window.worldApi;
  if (!api?.shotPath) return;
  await new Promise((r) => setTimeout(r, 800));
  const result = await api.screenshot(api.shotPath);
  log(`скриншот: ${result.ok ? `${result.path} (${result.bytes} байт)` : result.error}`, result.ok ? 'ok' : 'err');
  // Итоговая строка для лога процесса — по ней собирается отчёт.
  // eslint-disable-next-line no-console
  console.log('[world-report] ' + JSON.stringify(report));
  await api.finish();
}

function describeError(e: any): string {
  const failure = e?.failure ? ` failure=${JSON.stringify(e.failure)}` : '';
  return `${e?.name ?? 'Error'}: ${e?.message ?? String(e)}${failure}`;
}

window.addEventListener('error', (e) => log(`window.onerror: ${e.message}`, 'err'));
window.addEventListener('unhandledrejection', (e) => log(`unhandledrejection: ${describeError(e.reason)}`, 'err'));

// ===== Провайдер мира на реальных данных =====

interface RealWorldProvider {
  getColumnAt(pos: Vec3): any | null;
  setBlockStateId(pos: Vec3, stateId: number): void;
  getBiome(pos: Vec3): number;
}

/**
 * Кэш собранных колонок. Контракт провайдера синхронный.
 *
 * ВАЖНО: getColumnAt должен возвращать null, пока данных нет — иначе WorldView
 * (особенно с isPlayground) помечает пустышку как loaded и больше не перезагружает.
 * Когда колонка появляется в кэше — будим waitingSpiralChunksLoad.
 */
class ColumnStore {
  private columns = new Map<string, any>();
  private biomes = new Map<string, number>();
  /** Чанки, которых нет на диске (подтверждённый miss). */
  private knownMissing = new Set<string>();
  private emptyColumn: any = null;
  private emptyBiome = 0;
  /** WorldView для пробуждения спирали. */
  worldView: { waitingSpiralChunksLoad?: Record<string, (ok: boolean) => void>; loadChunk?: (pos: { x: number; z: number }, light?: boolean, reason?: string) => Promise<void> } | null = null;
  metrics = { requested: 0, received: 0, empty: 0, wireBytes: 0, ipcMs: 0, buildMs: 0, sections: 0 };

  constructor(
    private readonly worldPath: string,
    private readonly internals: ReturnType<typeof inspectChunkInternals>,
    private readonly resolver: ReturnType<typeof createBlockResolver>,
    private readonly geometry: { minY: number; worldHeight: number },
    private readonly capacity = 2048,
  ) {}

  private empty(): any {
    if (!this.emptyColumn) {
      this.emptyColumn = createEmptyColumn(
        this.internals, this.geometry.minY, this.geometry.worldHeight,
        this.emptyBiome || this.resolver.resolveBiome('plains'),
      );
    }
    return this.emptyColumn;
  }

  private static key(chunkX: number, chunkZ: number): string {
    return `${chunkX},${chunkZ}`;
  }

  /** Ключ ожидания WorldView: блок-координаты угла чанка. */
  private static waiterKey(chunkX: number, chunkZ: number): string {
    return `${chunkX * 16},${chunkZ * 16}`;
  }

  has(chunkX: number, chunkZ: number): boolean {
    const k = ColumnStore.key(chunkX, chunkZ);
    return this.columns.has(k) || this.knownMissing.has(k);
  }

  get size(): number {
    return this.columns.size;
  }

  getColumn(chunkX: number, chunkZ: number): any | null {
    return this.columns.get(ColumnStore.key(chunkX, chunkZ)) ?? null;
  }

  getBiome(chunkX: number, chunkZ: number): number {
    return this.biomes.get(ColumnStore.key(chunkX, chunkZ)) ?? 0;
  }

  /** Разбудить спираль WorldView после появления колонки. */
  private wakeWaiter(chunkX: number, chunkZ: number): void {
    const wv = this.worldView;
    if (!wv?.waitingSpiralChunksLoad) return;
    const wk = ColumnStore.waiterKey(chunkX, chunkZ);
    const resolve = wv.waitingSpiralChunksLoad[wk];
    if (resolve) {
      resolve(true);
      delete wv.waitingSpiralChunksLoad[wk];
    }
  }

  private put(wire: WireColumn): void {
    const t0 = performance.now();
    const built = wireToColumn(wire, this.internals, this.resolver);
    this.metrics.buildMs += performance.now() - t0;
    this.metrics.sections += built.sectionsWithBlocks;
    const key = ColumnStore.key(wire.x, wire.z);
    this.columns.set(key, built.column);
    this.biomes.set(key, built.biomeId);
    this.knownMissing.delete(key);
    if (!this.emptyBiome) this.emptyBiome = built.biomeId;
    this.wakeWaiter(wire.x, wire.z);
  }

  private markMissing(chunkX: number, chunkZ: number): void {
    const key = ColumnStore.key(chunkX, chunkZ);
    if (this.columns.has(key)) return;
    this.knownMissing.add(key);
    this.metrics.empty++;
    this.wakeWaiter(chunkX, chunkZ);
  }

  private evict(): void {
    while (this.columns.size > this.capacity) {
      const oldest = this.columns.keys().next().value as string;
      this.columns.delete(oldest);
      this.biomes.delete(oldest);
    }
  }

  /**
   * Подгрузка области. Пустой квадрат ≤4 — один bulk IPC; иначе только недостающие кольца.
   * Ingest режется по времени кадра, чтобы wireToColumn не клинил UI.
   */
  async prefetchArea(centerX: number, centerZ: number, radius: number): Promise<void> {
    const api = window.worldApi!;
    const yieldFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

    const ingest = async (columns: WireColumn[], missing: Array<[number, number]>) => {
      let frameStart = performance.now();
      for (const wire of columns) {
        if (this.has(wire.x, wire.z) && this.getColumn(wire.x, wire.z)) continue;
        this.metrics.received++;
        this.metrics.wireBytes += wire.byteSize;
        this.put(wire);
        if (performance.now() - frameStart >= INGEST_FRAME_BUDGET_MS) {
          await yieldFrame();
          frameStart = performance.now();
        }
      }
      for (const [cx, cz] of missing) this.markMissing(cx, cz);
    };

    // Быстрый путь только для крошечной области (центр ±1): иначе bulk клинит main/IPC.
    if (radius <= 1 && api.columnsRadius) {
      let missingCount = 0;
      const area = (radius * 2 + 1) ** 2;
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
          if (!this.has(centerX + dx, centerZ + dz)) missingCount++;
        }
      }
      if (missingCount === 0) return;
      if (missingCount === area) {
        this.metrics.requested += area;
        const t0 = performance.now();
        const res = await api.columnsRadius(this.worldPath, centerX, centerZ, radius);
        this.metrics.ipcMs += performance.now() - t0;
        await ingest(res?.columns || [], res?.missing || []);
        this.evict();
        return;
      }
    }

    for (let r = 0; r <= radius; r++) {
      const coords: Array<[number, number]> = [];
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const cx = centerX + dx;
          const cz = centerZ + dz;
          if (!this.has(cx, cz)) coords.push([cx, cz]);
        }
      }
      if (coords.length === 0) continue;

      this.metrics.requested += coords.length;
      const t0 = performance.now();
      let columns: WireColumn[] = [];
      let missing: Array<[number, number]> = [];
      // Полное кольцо — один ring-IPC; частично — только недостающие coords.
      const fullRing = r === 0 ? 1 : r * 8;
      if (api.columnsRing && coords.length === fullRing) {
        const res = await api.columnsRing(this.worldPath, centerX, centerZ, r);
        columns = res?.columns || [];
        missing = res?.missing || [];
      } else {
        const wireColumns = await api.columns(this.worldPath, coords);
        columns = wireColumns || [];
        const got = new Set(columns.map((w) => ColumnStore.key(w.x, w.z)));
        missing = coords.filter(([cx, cz]) => !got.has(ColumnStore.key(cx, cz)));
      }
      this.metrics.ipcMs += performance.now() - t0;
      await ingest(columns, missing);
      await yieldFrame();
    }
    this.evict();
  }

  createProvider(): RealWorldProvider {
    return {
      getColumnAt: (pos: Vec3) => {
        const cx = Math.floor(pos.x / 16);
        const cz = Math.floor(pos.z / 16);
        const col = this.getColumn(cx, cz);
        if (col) return col;
        // Подтверждённая пустота на диске — отдаём воздух, чтобы спираль не зависла.
        if (this.knownMissing.has(ColumnStore.key(cx, cz))) return this.empty();
        // Данных ещё нет — WorldView ждёт waiter.
        return null;
      },
      setBlockStateId: (pos: Vec3, stateId: number) => {
        const column = this.getColumn(Math.floor(pos.x / 16), Math.floor(pos.z / 16));
        column?.setBlockStateId(new Vec3(pos.x & 15, pos.y, pos.z & 15), stateId);
      },
      getBiome: (pos: Vec3) => this.getBiome(Math.floor(pos.x / 16), Math.floor(pos.z / 16)),
    };
  }
}

// ===== Выбор мира =====

/** Путь к миру: из аргумента окна, иначе первый подходящий мир из инстансов сборок. */
async function resolveWorld(): Promise<{ path: string; info: WorldInfo } | { error: string }> {
  const api = window.worldApi;
  if (!api) return { error: 'Мост worldApi недоступен: окно открыто без preload.' };

  if (api.worldPath) {
    const info = await api.describe(api.worldPath);
    return info.ok ? { path: api.worldPath, info } : { error: info.message ?? 'Мир не открыт.' };
  }

  const worlds = await api.listWorlds();
  log(`путь к миру не задан, найдено миров в инстансах: ${worlds.length}`);
  const problems: string[] = [];
  for (const entry of worlds) {
    const info = await api.describe(entry.worldPath);
    if (info.ok) return { path: entry.worldPath, info };
    problems.push(`${entry.folder}: ${info.message}`);
  }
  return {
    error: worlds.length === 0
      ? 'Миры не найдены. Укажите папку мира: electron . --world="<путь>"'
      : `Ни один мир не открылся.\n${problems.join('\n')}`,
  };
}

// ===== Запуск =====

async function main(): Promise<void> {
  if (window.worldApi?.embedded) {
    document.body.classList.add('embedded');
    document.getElementById('embed-close')?.addEventListener('click', () => {
      void window.worldApi?.closeEmbed?.();
    });
  }
  setStatus('Поиск мира…');

  const resolved = await resolveWorld();
  if ('error' in resolved) {
    setStatus('Мир не открыт', 'err');
    log(resolved.error, 'err');
    showMessage('Мир не открыт', resolved.error);
    await finishRun({ ok: false, error: resolved.error });
    return;
  }

  const { path: worldPath, info } = resolved;
  log(`мир «${info.name}» — ${info.versionName} (DataVersion ${info.dataVersion})`, 'ok');
  log(`region-файлов ${info.regionCount}, колонок на диске ${info.chunkCount}, высота ${info.minY}..${info.minY + info.worldHeight - 1}`);
  log(`старт камеры: ${info.start.x.toFixed(1)}, ${info.start.y.toFixed(1)}, ${info.start.z.toFixed(1)} (источник: ${info.startSource}${info.dimension ? `, ${info.dimension}` : ''})`);
  if (info.yaw != null || info.pitch != null) {
    log(`NBT Rotation: yaw=${(info.yaw ?? 0).toFixed(1)}° pitch=${(info.pitch ?? 0).toFixed(1)}°`);
  }
  const gate = resolvePreviewStrategy(info.dataVersion);
  log(`стратегия: ${gate.strategy}${gate.degraded ? ' (degraded)' : ''} → реестр ${MESHER_MAX_VERSION}`);
  if (gate.degraded) log(`мир новее мешера: неизвестные блоки будут упрощены`, 'err');
  document.title = `Undefined Client — ${info.name} (${info.versionName})`;

  const feet = new Vec3(info.start.x, info.start.y, info.start.z);
  const rot = rotationFromMinecraftDegrees(info.yaw ?? 0, info.pitch ?? 0);
  const flyCam = cameraFromPlayerFeet(feet, rot.yaw, rot.pitch);
  // Центр подгрузки чанков — блок под ногами, не глаза.
  const target = feet.floored();
  log(
    `камера рендерера: yaw=${(rot.yaw * 180 / Math.PI).toFixed(1)}° pitch=${(rot.pitch * 180 / Math.PI).toFixed(1)}° `
    + `(π−mcYaw, −mcPitch)`,
  );
  // 2 воркера: меньше конкуренции с main при подгрузке.
  const mesherWorkers = 2;
  const viewer = new AppViewer({
    config: {
      sceneBackground: '#6ec6ff',
      statsVisible: 0,
    },
    rendererConfig: {
      mesherWorkers,
      wasmMesher: true,
      // Освещение грузит FPS при повороте; небо оставляем через defaultSkybox.
      enableLighting: false,
      smoothLighting: false,
      dayCycle: false,
      starfield: false,
      defaultSkybox: true,
      renderEntities: true,
      fetchPlayerSkins: false,
      extraBlockRenderers: false,
      showHand: false,
      showChunkBorders: false,
      // false: иначе null-колонка помечается loaded без геометрии и больше не грузится.
      isPlayground: false,
      instantCameraUpdate: true,
      // true: мешер режет работу по кадрам — без этого фризы при подгрузке.
      _experimentalSmoothChunkLoading: true,
      // Батч даёт соседям время попасть в пайплайн до mesh (меньше blind mesh).
      addChunksBatchWaitTime: 120,
      smartCull: false,
      fov: 70,
    },
  });
  (globalThis as any).viewer = viewer;

  setStatus('Проверка воркера мешера…');
  try {
    await viewer.preloadWorkers();
    log('mesher worker: mc-web-pong получен', 'ok');
  } catch (e) {
    log(`mesher worker preload FAILED: ${describeError(e)}`, 'err');
    setStatus('Мешер не стартовал', 'err');
    throw e;
  }

  // ВНИМАНИЕ: сначала пробуем атлас из client jar версии мира (или MESHER_MAX),
  // иначе остаёмся на вшитом mc-assets.
  setStatus('Загрузка ассетов…');
  viewer.resourcesManager.currentConfig = { version: RENDER_VERSION, noInventoryGui: true };
  await viewer.resourcesManager.loadSourceData(RENDER_VERSION);

  // Jar: только НОВЫЕ имена текстур (строки dataURL). Объект {contents} ломает drawImage.
  const atlasCandidates = Array.from(new Set([
    info.versionName,
    RENDER_VERSION,
    '1.21.6',
  ].filter(Boolean) as string[]));
  let clientAtlas = null as Awaited<ReturnType<typeof tryLoadClientJarAtlas>>;
  let addedCustom = 0;
  for (const ver of atlasCandidates) {
    clientAtlas = await tryLoadClientJarAtlas({ gameVersion: ver });
    if (clientAtlas) {
      addedCustom = applyClientTexturesToViewer(viewer, clientAtlas);
      log(
        `jar ${ver}: ${clientAtlas.count} PNG, в атлас добавлено новых ${addedCustom}`
        + (clientAtlas.jarPath ? ` (${clientAtlas.jarPath})` : ''),
        addedCustom > 0 ? 'ok' : 'err',
      );
      break;
    }
  }
  if (!clientAtlas) log('jar клиента не найден — текстуры mc-assets', 'err');

  try {
    await viewer.resourcesManager.updateAssetsData({});
    log('ассеты собраны', 'ok');
  } catch (e) {
    log(`атлас с customTextures упал: ${describeError(e)} — откат на mc-assets`, 'err');
    try {
      if (viewer.resourcesManager.currentResources) {
        viewer.resourcesManager.currentResources.customTextures = {};
      }
      await viewer.resourcesManager.updateAssetsData({});
      log('ассеты собраны без jar-текстур', 'ok');
    } catch (e2) {
      throw e2;
    }
  }

  setStatus('Инициализация бэкенда…');
  await viewer.loadBackend(createGraphicsBackendSingleThread);
  log(`backend загружен, THREE.REVISION=${(globalThis as any).THREE?.REVISION ?? 'n/a'}`, 'ok');

  // ===== Загрузка области мира =====

  setStatus('Чтение колонок из сохранения…');
  const mcData = (MinecraftData as any)(RENDER_VERSION);
  const Chunk: any = (ChunkLoader as any)(RENDER_VERSION);
  const internals = inspectChunkInternals(Chunk);
  const resolver = createBlockResolver(mcData, info.dataVersion);
  const store = new ColumnStore(worldPath, internals, resolver, info);

  const centerX = Math.floor(target.x / 16);
  const centerZ = Math.floor(target.z / 16);
  const loadStart = performance.now();
  // Halo +1: у края viewDistance соседи уже в кэше → меньше «blind mesh».
  await store.prefetchArea(centerX, centerZ, VIEW_DISTANCE_NEAR + 1);
  const nearMs = performance.now() - loadStart;

  const m = store.metrics;
  log(
    `ближняя область: ${m.received}/${m.requested} колонок, ${m.sections} секций, `
    + `${(m.wireBytes / 1024 / 1024).toFixed(2)} MB за ${nearMs.toFixed(0)} ms `
    + `(IPC ${m.ipcMs.toFixed(0)} ms, сборка ${m.buildMs.toFixed(0)} ms)`,
    m.received > 0 ? 'ok' : 'err',
  );

  for (const line of formatStats(resolver.stats)) log(line, 'err');
  if (formatStats(resolver.stats).length === 0) log('сопоставление блоков и биомов: без промахов', 'ok');

  if (m.received === 0) {
    setStatus('В области нет готовых чанков', 'err');
    showMessage('В этой области мира нет данных', `Мир «${info.name}» открыт, но вокруг точки старта нет полностью сгенерированных чанков.`);
    await finishRun({ ok: false, error: 'нет готовых чанков в области', dataVersion: info.dataVersion });
    return;
  }

  // ===== Старт рендера =====

  setStatus('Старт рендера…');
  // Центр WorldView — целочисленные ноги: так спираль чанков совпадает с кэшем.
  // Радиус отрисовки = NEAR, данные уже с halo NEAR+1.
  await viewer.startWorld(store.createProvider(), VIEW_DISTANCE_NEAR, getInitialPlayerState(), target);
  // Небольшая пауза батча: соседи успевают попасть в мешер до mesh края.
  viewer.worldView.addWaitTime = 80;
  viewer.worldView.keepChunksDistance = 2;
  store.worldView = viewer.worldView as any;
  let loadedChunks = 0;
  viewer.worldView.on('loadChunk', () => { loadedChunks++; });
  await viewer.worldView.init(target);
  log(`worldView.init выполнен, отдано колонок рендереру: ${loadedChunks} `
    + `(пустых на диске: ${m.empty})`, 'ok');

  // Персонаж на точке сейва: скин лаунчера + ник (шрифт minecraft.ttf как mojangles).
  try {
    const profile = (await window.worldApi!.previewProfile?.()) || { username: 'Player' };
    const ok = await spawnSavePlayerMarker({
      feet: { x: feet.x, y: feet.y, z: feet.z },
      yaw: flyCam.yaw,
      pitch: flyCam.pitch,
      username: profile.username || 'Player',
      uuid: profile.uuid,
      skinDataUrl: profile.skinDataUrl,
    });
    log(
      ok
        ? `маркер игрока «${profile.username}»${profile.skinDataUrl ? ' со скином' : ''}`
        : 'не удалось создать маркер игрока',
      ok ? 'ok' : 'err',
    );
  } catch (e) {
    log(`маркер игрока: ${describeError(e)}`, 'err');
  }

  const applyCamera = (cam = flyCam, lookOnly = false) => {
    if (lookOnly) {
      viewer.updateCamera(null as any, cam.yaw, cam.pitch);
    } else {
      viewer.updateCamera(cam.pos, cam.yaw, cam.pitch);
    }
  };
  applyCamera();

  /** Ждём, пока мешер хотя бы раз отметит чанк — иначе force-reload срывает первую спираль. */
  async function waitMesherKickoff(timeoutMs = 8000): Promise<void> {
    const t0 = performance.now();
    while (performance.now() - t0 < timeoutMs) {
      const n = Object.keys(viewer.rendererState?.world?.chunksLoaded ?? {}).length;
      if (n > 0) return;
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  /** Ждём, пока очередь мешера опустеет — иначе expand накладывается на фриз. */
  async function waitMesherQuiet(timeoutMs = 8000): Promise<void> {
    const t0 = performance.now();
    let quietStreak = 0;
    while (performance.now() - t0 < timeoutMs) {
      const work = Number(viewer.rendererState?.world?.mesherWork ?? 0);
      if (work <= 0) {
        if (++quietStreak >= 2) return;
      } else {
        quietStreak = 0;
      }
      await new Promise((r) => setTimeout(r, 40));
    }
  }

  // Фоновая догрузка FAR: данные в кэш → расширяем радиус без «force», чтобы не сбрасывать спираль резко.
  let expandDone = false;
  let lastChunkKey = `${Math.floor(flyCam.pos.x / 16)},${Math.floor(flyCam.pos.z / 16)}`;
  let prefetchInFlight: Promise<void> | null = null;

  const ensureChunksAround = (pos: Vec3, radius: number) => {
    const cx = Math.floor(pos.x / 16);
    const cz = Math.floor(pos.z / 16);
    const key = `${cx},${cz}`;
    const run = async () => {
      await store.prefetchArea(cx, cz, radius);
      if (key !== lastChunkKey) {
        lastChunkKey = key;
        // Без force: только кольцо вокруг нового чанка, камеру не трогаем.
        await viewer.worldView?.updatePosition(pos, false);
      }
    };
    prefetchInFlight = (prefetchInFlight ?? Promise.resolve()).then(run, run);
    return prefetchInFlight;
  };

  void (async () => {
    const t0 = performance.now();
    // Даём первому кадру и NEAR-мешеру устояться, потом догружаем по одному кольцу.
    await waitMesherKickoff(5000);
    await waitMesherQuiet(5000);
    for (let r = VIEW_DISTANCE_NEAR + 1; r <= VIEW_DISTANCE_FAR; r++) {
      await store.prefetchArea(centerX, centerZ, r);
      await waitMesherQuiet(6000);
      viewer.worldView.updateViewDistance(r);
      await viewer.worldView.updatePosition(new Vec3(flyCam.pos.x, flyCam.pos.y, flyCam.pos.z), false);
      await waitMesherQuiet(6000);
    }
    expandDone = true;
    const diskStats = await window.worldApi!.stats(worldPath);
    log(
      `дальняя область догружена за ${(performance.now() - t0).toFixed(0)} ms `
      + `(всего колонок в кэше ${store.size}`
      + (diskStats ? `, main ${diskStats.columnsRead} за ${diskStats.readMs.toFixed(0)} ms` : '')
      + `)`,
      'ok',
    );
  })();

  const canvas = (document.getElementById('viewer-canvas')
    ?? document.querySelector('canvas')
    ?? document.body) as HTMLElement;
  attachFlyControls({
    camera: flyCam,
    canvas,
    applyCamera,
    onMove: (cam) => {
      void ensureChunksAround(cam.pos, expandDone ? VIEW_DISTANCE_FAR : VIEW_DISTANCE_NEAR);
    },
    baseSpeed: 14,
  });
  log(
    `камера игрока: ${flyCam.pos.x.toFixed(1)}, ${flyCam.pos.y.toFixed(1)}, ${flyCam.pos.z.toFixed(1)} `
    + `(yaw ${(flyCam.yaw * 180 / Math.PI).toFixed(0)}°, pitch ${(flyCam.pitch * 180 / Math.PI).toFixed(0)}°)`,
    'ok',
  );

  setStatus(`Рендер идёт — ${info.name} (${info.versionName})`, 'ok');

  const statsEl = document.getElementById('stats') as HTMLElement;
  let lastFps = 0;
  setInterval(() => {
    const st = viewer.rendererState?.world;
    const ns = viewer.nonReactiveState;
    lastFps = ns?.fps ?? 0;
    const chunks = st ? Object.keys(st.chunksLoaded ?? {}).length : 0;
    statsEl.textContent =
      `fps=${lastFps}  колонок в кэше=${store.size}  chunksLoaded=${chunks}  `
      + `allChunksLoaded=${st?.allChunksLoaded}  mesherWork=${st?.mesherWork}`;
    // Маркер сейва не куллить на дистанции 10 блоков.
    try {
      const marker = (globalThis as any).world?.entities?.entities?.['save-player'];
      if (marker) marker.visible = true;
    } catch { /* */ }
  }, 500);

  // Автоматическая фиксация результата: путь скриншота приходит аргументом окна.
  if (window.worldApi!.shotPath) {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
      if (viewer.rendererState?.world?.allChunksLoaded && expandDone) break;
    }
    await new Promise((r) => setTimeout(r, 2500));
    applyCamera();
    await new Promise((r) => setTimeout(r, 1500));
    await finishRun({
      ok: true,
      world: info.name,
      versionName: info.versionName,
      dataVersion: info.dataVersion,
      minY: info.minY,
      worldHeight: info.worldHeight,
      columnsRequested: m.requested,
      columnsReceived: m.received,
      emptyColumnsServed: m.empty,
      sectionsWithBlocks: m.sections,
      wireBytes: m.wireBytes,
      loadMs: Math.round(nearMs),
      ipcMs: Math.round(m.ipcMs),
      buildMs: Math.round(m.buildMs),
      chunksGivenToRenderer: loadedChunks,
      fps: lastFps,
      mapping: {
        missingBlocks: Object.fromEntries(resolver.stats.missingBlocks),
        renamedBlocks: Object.fromEntries(resolver.stats.renamedBlocks),
        droppedProps: Object.fromEntries(resolver.stats.droppedProps),
        unknownValues: Object.fromEntries(resolver.stats.unknownValues),
        missingBiomes: Object.fromEntries(resolver.stats.missingBiomes),
        renamedBiomes: Object.fromEntries(resolver.stats.renamedBiomes),
      },
    });
  }
}

main().catch(async (e) => {
  log(`FATAL: ${describeError(e)}`, 'err');
  if (e?.stack) log(String(e.stack), 'err');
  setStatus('Ошибка', 'err');
  await finishRun({ ok: false, error: describeError(e) });
});
