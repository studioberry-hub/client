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

// Версия жёстко зафиксирована: мини-версия minecraft-data собрана только под неё,
// и она же совпадает со STABLE_MODELS_VERSION рендерера. Блоки миров любых
// поддерживаемых версий пересчитываются в state ID этого реестра (см. worldlib/mapping.ts).
const RENDER_VERSION = '1.21.4';

/** Радиус области загрузки в чанках: (2r+1)^2 колонок. */
const VIEW_DISTANCE = 5;
/** Сколько колонок запрашивать одним IPC-вызовом. */
const BATCH_SIZE = 24;

// ===== Диагностика на экране =====

const statusEl = document.getElementById('status')!;
const logEl = document.getElementById('log')!;
const messageEl = document.getElementById('message')!;

function log(message: string, kind: 'info' | 'ok' | 'err' = 'info'): void {
  const line = document.createElement('div');
  line.className = `line ${kind}`;
  line.textContent = `${new Date().toISOString().slice(11, 23)}  ${message}`;
  logEl.appendChild(line);
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
 * Кэш собранных колонок. Контракт провайдера синхронный, поэтому колонки
 * подгружаются заранее (prefetchArea) — getColumnAt только смотрит в кэш.
 */
class ColumnStore {
  private columns = new Map<string, any>();
  private biomes = new Map<string, number>();
  /** Одна общая колонка воздуха на все несгенерированные чанки. */
  private emptyColumn: any = null;
  private emptyBiome = 0;
  /** Метрики загрузки для отчёта. */
  metrics = { requested: 0, received: 0, empty: 0, wireBytes: 0, ipcMs: 0, buildMs: 0, sections: 0 };

  constructor(
    private readonly worldPath: string,
    private readonly internals: ReturnType<typeof inspectChunkInternals>,
    private readonly resolver: ReturnType<typeof createBlockResolver>,
    private readonly geometry: { minY: number; worldHeight: number },
    /** Ограничение кэша: колонки далеко от камеры выгружаются. */
    private readonly capacity = 1024,
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

  has(chunkX: number, chunkZ: number): boolean {
    return this.columns.has(ColumnStore.key(chunkX, chunkZ));
  }

  get size(): number {
    return this.columns.size;
  }

  getColumn(chunkX: number, chunkZ: number): any | null {
    return this.columns.get(ColumnStore.key(chunkX, chunkZ)) ?? null;
  }

  /** Реальная колонка либо воздух: null возвращать нельзя (см. createEmptyColumn). */
  getColumnOrEmpty(chunkX: number, chunkZ: number): any {
    const column = this.getColumn(chunkX, chunkZ);
    if (column) return column;
    this.metrics.empty++;
    return this.empty();
  }

  getBiome(chunkX: number, chunkZ: number): number {
    return this.biomes.get(ColumnStore.key(chunkX, chunkZ)) ?? 0;
  }

  private put(wire: WireColumn): void {
    const t0 = performance.now();
    const built = wireToColumn(wire, this.internals, this.resolver);
    this.metrics.buildMs += performance.now() - t0;
    this.metrics.sections += built.sectionsWithBlocks;
    const key = ColumnStore.key(wire.x, wire.z);
    this.columns.set(key, built.column);
    this.biomes.set(key, built.biomeId);
    if (!this.emptyBiome) this.emptyBiome = built.biomeId;
  }

  /** Выгружает самые давние колонки, если кэш вырос выше лимита. */
  private evict(): void {
    while (this.columns.size > this.capacity) {
      const oldest = this.columns.keys().next().value as string;
      this.columns.delete(oldest);
      this.biomes.delete(oldest);
    }
  }

  /**
   * Загружает область (2*radius+1)^2 колонок вокруг центрального чанка.
   * Порядок — по спирали от центра, чтобы ближние чанки появлялись первыми.
   */
  async prefetchArea(centerX: number, centerZ: number, radius: number): Promise<void> {
    const coords: Array<[number, number]> = [];
    for (let r = 0; r <= radius; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const cx = centerX + dx;
          const cz = centerZ + dz;
          if (!this.has(cx, cz)) coords.push([cx, cz]);
        }
      }
    }
    this.metrics.requested += coords.length;

    for (let i = 0; i < coords.length; i += BATCH_SIZE) {
      const batch = coords.slice(i, i + BATCH_SIZE);
      const t0 = performance.now();
      const wireColumns = await window.worldApi!.columns(this.worldPath, batch);
      this.metrics.ipcMs += performance.now() - t0;
      for (const wire of wireColumns) {
        this.metrics.received++;
        this.metrics.wireBytes += wire.byteSize;
        this.put(wire);
      }
    }
    this.evict();
  }

  createProvider(): RealWorldProvider {
    return {
      getColumnAt: (pos: Vec3) => this.getColumnOrEmpty(Math.floor(pos.x / 16), Math.floor(pos.z / 16)),
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
  log(`старт камеры: ${info.start.x.toFixed(1)}, ${info.start.y.toFixed(1)}, ${info.start.z.toFixed(1)} (источник: ${info.startSource})`);
  document.title = `Undefined Client — ${info.name} (${info.versionName})`;

  const target = new Vec3(Math.floor(info.start.x), Math.floor(info.start.y), Math.floor(info.start.z));

  const viewer = new AppViewer({
    config: {
      sceneBackground: '#6ec6ff',
      statsVisible: 0,
    },
    rendererConfig: {
      mesherWorkers: 2,
      wasmMesher: true,
      enableLighting: true,
      smoothLighting: true,
      dayCycle: false,
      starfield: false,
      renderEntities: false,
      extraBlockRenderers: false,
      showHand: false,
      showChunkBorders: false,
      isPlayground: true,
      instantCameraUpdate: true,
      _experimentalSmoothChunkLoading: false,
      addChunksBatchWaitTime: 0,
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

  // ВНИМАНИЕ: атлас берётся из mc-assets. В проде он обязан собираться в рантайме
  // из клиентского jar пользователя — иначе текстуры не совпадут с его ресурспаком.
  setStatus('Загрузка ассетов…');
  viewer.resourcesManager.currentConfig = { version: RENDER_VERSION, noInventoryGui: true };
  await viewer.resourcesManager.loadSourceData(RENDER_VERSION);
  await viewer.resourcesManager.updateAssetsData({});
  log('ассеты собраны (mc-assets)', 'ok');

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
  await store.prefetchArea(centerX, centerZ, VIEW_DISTANCE);
  const loadMs = performance.now() - loadStart;

  const m = store.metrics;
  log(
    `область загружена: ${m.received}/${m.requested} колонок, ${m.sections} секций с блоками, `
    + `${(m.wireBytes / 1024 / 1024).toFixed(2)} MB данных за ${loadMs.toFixed(0)} ms `
    + `(IPC ${m.ipcMs.toFixed(0)} ms, сборка колонок ${m.buildMs.toFixed(0)} ms)`,
    m.received > 0 ? 'ok' : 'err',
  );
  const diskStats = await window.worldApi!.stats(worldPath);
  if (diskStats) {
    log(`main: прочитано ${diskStats.columnsRead} колонок за ${diskStats.readMs.toFixed(0)} ms, `
      + `пропущено по статусу ${diskStats.skippedStatus}, ошибок ${diskStats.failed}`);
  }

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
  await viewer.startWorld(store.createProvider(), VIEW_DISTANCE, getInitialPlayerState(), target);
  viewer.worldView.addWaitTime = 0;
  let loadedChunks = 0;
  viewer.worldView.on('loadChunk', () => { loadedChunks++; });
  await viewer.worldView.init(target);
  log(`worldView.init выполнен, отдано колонок рендереру: ${loadedChunks} `
    + `(из них воздушных заглушек: ${m.empty})`, 'ok');

  // Камера смотрит на точку старта сверху-сбоку под ~40°: в кадр попадает
  // вся загруженная область (2*VIEW_DISTANCE+1 чанков) вместе с рельефом.
  const distance = VIEW_DISTANCE * 16;
  const lookAt = target.offset(0, 2, 0);
  const camera = new Vec3(target.x + distance, target.y + distance * 0.85, target.z + distance);
  const dir = lookAt.minus(camera).normalize();
  const setCamera = () => viewer.updateCamera(camera, Math.atan2(-dir.x, -dir.z), Math.asin(dir.y));
  setCamera();
  // Повторяем после прогрузки чанков: worldRenderer при старте мира выставляет
  // камеру в startPosition, наш вызов может прийти раньше.
  setTimeout(setCamera, 1500);
  setTimeout(setCamera, 5000);
  log(`камера: ${camera} -> ${lookAt}`, 'ok');

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
  }, 500);

  // Автоматическая фиксация результата: путь скриншота приходит аргументом окна.
  if (window.worldApi!.shotPath) {
    // Ждём, пока мешер догонит все чанки, но не дольше минуты.
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
      if (viewer.rendererState?.world?.allChunksLoaded) break;
    }
    await new Promise((r) => setTimeout(r, 2500));
    setCamera();
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
      loadMs: Math.round(loadMs),
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
