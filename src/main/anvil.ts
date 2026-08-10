// Чтение сохранений Minecraft Java Edition (формат Anvil) в main-процессе.
//
// Почему свой парсер, а не prismarine-provider-anvil:
//   1) он тянет prismarine-chunk + minecraft-data в РАНТАЙМ main-процесса, а полный
//      minecraft-data — это ~500 МБ JSON, который специально исключён из инсталлятора;
//   2) он открывает region-файл на запись ('r+') и дописывает нули, выравнивая размер
//      по 4 KiB, — для просмотрщика чужих сохранений это недопустимо;
//   3) он не поддерживает внешние чанки (.mcc), несжатые и LZ4-чанки;
//   4) он строит полноценные колонки prismarine-chunk, которые всё равно пришлось бы
//      сериализовать для передачи в окно рендерера.
//
// Здесь читается ровно то, что нужно рендереру, и отдаётся в компактном «проводном»
// виде (WireColumn): палитры имён блоков/биомов + упакованные индексы + нибблы света.
// Сопоставление имён блоков со state ID делает окно мира — там уже есть реестр 1.21.4.

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { parseUncompressed, simplify } from 'prismarine-nbt';

// ===== Константы формата =====

/** Размер сектора region-файла. */
const SECTOR_BYTES = 4096;
/** Чанков по каждой оси в одном region-файле. */
export const REGION_SIZE = 32;

/** Схемы сжатия данных чанка (байт после длины). */
const enum Compression {
  Gzip = 1,
  Zlib = 2,
  None = 3,
  Lz4 = 4,
  Custom = 127,
}
/** Флаг «данные чанка лежат во внешнем файле c.<x>.<z>.mcc». */
const EXTERNAL_FLAG = 128;

/** DataVersion 1.13 — ниже неё блоки хранятся числовыми ID (pre-flattening), не поддерживаем. */
export const MIN_DATA_VERSION = 1519;
/** DataVersion 1.21.11 — последняя версия ветки 1.21 на момент реализации. */
export const MAX_DATA_VERSION = 4671;
/** С этой DataVersion (20w17a, ветка 1.16) записи в long-массивах не пересекают границу long. */
const NO_SPAN_SINCE = 2529;

// ===== Проводной формат (main -> окно мира) =====

/** Запись палитры блоков: имя без префикса `minecraft:` и свойства состояния. */
export interface WirePaletteEntry {
  name: string;
  props?: Record<string, string>;
}

/**
 * Одна секция 16×16×16. Данные лежат уже в раскладке BitArrayNoSpan
 * (пары 32-битных слов low/high на каждый long), чтобы окно мира могло
 * построить BitArray поверх переданного ArrayBuffer без перепаковки.
 */
export interface WireSection {
  /** Индекс секции по Y (мировой, не смещённый). */
  y: number;
  blockPalette: WirePaletteEntry[];
  blockBits: number;
  blockData: Uint32Array | null;
  biomePalette: string[];
  biomeBits: number;
  biomeData: Uint32Array | null;
  /** 2048 байт нибблов или null, если света в файле нет. */
  skyLight: Uint8Array | null;
  blockLight: Uint8Array | null;
  /**
   * Небесный свет секции считается равным 15 во всём объёме. Ванилла не пишет на диск
   * секции, целиком залитые небесным светом, выше самой верхней записанной секции —
   * их нужно достроить, иначе всё, что над поверхностью, окажется неосвещённым.
   */
  skyFull?: boolean;
}

export interface WireColumn {
  x: number;
  z: number;
  minY: number;
  worldHeight: number;
  dataVersion: number;
  status: string;
  /** Освещение посчитано игрой; если false — окно мира достраивает небесный свет само. */
  lightOn: boolean;
  sections: WireSection[];
  blockEntities: Record<string, any>;
  /** Диагностика: сколько байт занимают переданные типизированные массивы. */
  byteSize: number;
}

// ===== Битовые упаковки =====

/**
 * Преобразует long-массив NBT (пары [high, low]) в плоский массив 32-битных слов
 * в порядке low, high — именно так BitArrayNoSpan из prismarine-chunk хранит данные.
 */
function longsToWords(longs: Array<[number, number]> | number[][]): Uint32Array {
  const words = new Uint32Array(longs.length * 2);
  for (let i = 0; i < longs.length; i++) {
    const l = longs[i] as any;
    // Значение может прийти как [hi, lo], так и BigInt (зависит от опций prismarine-nbt).
    if (typeof l === 'bigint') {
      words[i * 2] = Number(l & 0xffffffffn) >>> 0;
      words[i * 2 + 1] = Number((l >> 32n) & 0xffffffffn) >>> 0;
    } else {
      words[i * 2] = l[1] >>> 0;
      words[i * 2 + 1] = l[0] >>> 0;
    }
  }
  return words;
}

/** Чтение bits подряд идущих бит из little-endian потока слов. */
function readBits(words: Uint32Array, bitPos: number, bits: number): number {
  const wi = bitPos >>> 5;
  const off = bitPos & 31;
  let v = words[wi] >>> off;
  if (off + bits > 32) v |= words[wi + 1] << (32 - off);
  return v & ((1 << bits) - 1);
}

function writeBits(words: Uint32Array, bitPos: number, bits: number, value: number): void {
  const wi = bitPos >>> 5;
  const off = bitPos & 31;
  const mask = (1 << bits) - 1;
  words[wi] = ((words[wi] & ~(mask << off)) | ((value & mask) << off)) >>> 0;
  if (off + bits > 32) {
    const rem = off + bits - 32;
    words[wi + 1] = ((words[wi + 1] & ~((1 << rem) - 1)) | ((value & mask) >>> (32 - off))) >>> 0;
  }
}

/** Распаковка «сплошного» потока (до 1.16): записи пересекают границы long. */
function unpackSpanning(words: Uint32Array, bits: number, count: number): Uint16Array {
  const out = new Uint16Array(count);
  for (let i = 0; i < count; i++) out[i] = readBits(words, i * bits, bits);
  return out;
}

/** Упаковка в раскладку «без пересечения границы long» (1.16+ и BitArrayNoSpan). */
function packNoSpan(indices: Uint16Array, bits: number): Uint32Array {
  const valuesPerLong = Math.floor(64 / bits);
  const longs = Math.ceil(indices.length / valuesPerLong);
  const words = new Uint32Array(longs * 2);
  for (let i = 0; i < indices.length; i++) {
    const longIndex = Math.floor(i / valuesPerLong);
    const bitPos = longIndex * 64 + (i - longIndex * valuesPerLong) * bits;
    writeBits(words, bitPos, bits, indices[i]);
  }
  return words;
}

function neededBits(maxValue: number): number {
  let bits = 0;
  while (1 << bits <= maxValue) bits++;
  return bits;
}

// ===== Region-файл =====

/** Разбирает имя r.X.Z.mca. */
export function parseRegionName(name: string): { x: number; z: number } | null {
  const m = /^r\.(-?\d+)\.(-?\d+)\.mca$/.exec(name);
  return m ? { x: Number(m[1]), z: Number(m[2]) } : null;
}

/**
 * Читатель region-файла: только чтение, файл не модифицируется.
 * Таблица смещений (первые 4 KiB) читается один раз при открытии.
 */
export class RegionFile {
  private fd: number;
  /** offsets[i] = (номер сектора << 8) | число секторов; 0 — чанка нет. */
  private offsets: Uint32Array;
  readonly regionX: number;
  readonly regionZ: number;
  readonly fileSize: number;

  private constructor(private readonly file: string, fd: number, offsets: Uint32Array, size: number) {
    this.fd = fd;
    this.offsets = offsets;
    this.fileSize = size;
    const parsed = parseRegionName(path.basename(file));
    this.regionX = parsed?.x ?? 0;
    this.regionZ = parsed?.z ?? 0;
  }

  static open(file: string): RegionFile {
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const header = Buffer.alloc(SECTOR_BYTES);
      if (size >= SECTOR_BYTES) fs.readSync(fd, header, 0, SECTOR_BYTES, 0);
      const offsets = new Uint32Array(1024);
      for (let i = 0; i < 1024; i++) offsets[i] = header.readUInt32BE(i * 4);
      return new RegionFile(file, fd, offsets, size);
    } catch (e) {
      fs.closeSync(fd);
      throw e;
    }
  }

  close(): void {
    try { fs.closeSync(this.fd); } catch { /* уже закрыт */ }
  }

  hasChunk(localX: number, localZ: number): boolean {
    return this.offsets[localX + localZ * REGION_SIZE] !== 0;
  }

  /** Локальные координаты всех присутствующих в файле чанков. */
  listChunks(): Array<{ localX: number; localZ: number }> {
    const out: Array<{ localX: number; localZ: number }> = [];
    for (let i = 0; i < 1024; i++) {
      if (this.offsets[i] !== 0) out.push({ localX: i % REGION_SIZE, localZ: Math.floor(i / REGION_SIZE) });
    }
    return out;
  }

  /** Распакованные байты NBT чанка либо null, если чанка нет. */
  readChunkNbt(localX: number, localZ: number): Buffer | null {
    const offset = this.offsets[localX + localZ * REGION_SIZE];
    if (offset === 0) return null;

    const sector = offset >>> 8;
    const sectorCount = offset & 0xff;
    const start = sector * SECTOR_BYTES;
    if (start + 5 > this.fileSize) return null;

    const head = Buffer.alloc(5);
    fs.readSync(this.fd, head, 0, 5, start);
    const length = head.readInt32BE(0);
    const scheme = head.readUInt8(4);
    if (length <= 0) return null;

    let payload: Buffer;
    if ((scheme & EXTERNAL_FLAG) !== 0) {
      // Чанк больше 1 МиБ вынесен в отдельный файл рядом с region-файлом.
      const chunkX = this.regionX * REGION_SIZE + localX;
      const chunkZ = this.regionZ * REGION_SIZE + localZ;
      const mcc = path.join(path.dirname(this.file), `c.${chunkX}.${chunkZ}.mcc`);
      if (!fs.existsSync(mcc)) throw new Error(`внешний чанк не найден: ${path.basename(mcc)}`);
      payload = fs.readFileSync(mcc);
    } else {
      const dataLength = Math.min(length - 1, sectorCount * SECTOR_BYTES - 5);
      payload = Buffer.alloc(dataLength);
      fs.readSync(this.fd, payload, 0, dataLength, start + 5);
    }

    return decompressChunk(payload, scheme & ~EXTERNAL_FLAG);
  }
}

function decompressChunk(payload: Buffer, scheme: number): Buffer {
  switch (scheme) {
    case Compression.Gzip:
      return zlib.gunzipSync(payload);
    case Compression.Zlib:
      return zlib.inflateSync(payload);
    case Compression.None:
      return payload;
    case Compression.Lz4:
      throw new Error('чанк сжат LZ4 — эта схема сжатия не поддерживается');
    case Compression.Custom:
      throw new Error('чанк сжат кастомной схемой (127) — не поддерживается');
    default:
      throw new Error(`неизвестная схема сжатия чанка: ${scheme}`);
  }
}

// ===== NBT -> проводной формат =====

/** Читает NBT чанка и приводит к простому JS-объекту. */
export function parseChunkTag(buffer: Buffer): any {
  const tag = parseUncompressed(buffer, 'big');
  return simplify(tag as any);
}

function toUint8(value: any): Uint8Array | null {
  if (!value) return null;
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return new Uint8Array(Int8Array.from(value).buffer);
  if (Buffer.isBuffer(value)) return new Uint8Array(value);
  return null;
}

/** Убирает BigInt и прочее, что не переживёт JSON.stringify внутри toJson() колонки. */
function jsonSafe(value: any): any {
  if (typeof value === 'bigint') return Number(value);
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value instanceof Uint8Array || value instanceof Int8Array || value instanceof Int32Array) {
    return Array.from(value);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) out[k] = jsonSafe(v);
    return out;
  }
  return value;
}

/** Геометрия колонки: зависит от версии, а не от чанка. */
export interface ColumnGeometry {
  minY: number;
  worldHeight: number;
}

export function geometryForDataVersion(dataVersion: number): ColumnGeometry {
  // 1.18 (21w43a, DataVersion 2844) подняла высоту мира до -64..319.
  return dataVersion >= 2844 ? { minY: -64, worldHeight: 384 } : { minY: 0, worldHeight: 256 };
}

/**
 * Числовые ID биомов версий 1.13–1.17. С 1.18 биомы в файле хранятся именами,
 * а до 1.18 — числами, поэтому таблица нужна: сопоставлять биомы по числу
 * между версиями нельзя, реестр 1.21.4 другой.
 */
const LEGACY_BIOMES: Record<number, string> = {
  0: 'ocean', 1: 'plains', 2: 'desert', 3: 'mountains', 4: 'forest', 5: 'taiga', 6: 'swamp',
  7: 'river', 8: 'nether_wastes', 9: 'the_end', 10: 'frozen_ocean', 11: 'frozen_river',
  12: 'snowy_tundra', 13: 'snowy_mountains', 14: 'mushroom_fields', 15: 'mushroom_field_shore',
  16: 'beach', 17: 'desert_hills', 18: 'wooded_hills', 19: 'taiga_hills', 20: 'mountain_edge',
  21: 'jungle', 22: 'jungle_hills', 23: 'jungle_edge', 24: 'deep_ocean', 25: 'stone_shore',
  26: 'snowy_beach', 27: 'birch_forest', 28: 'birch_forest_hills', 29: 'dark_forest',
  30: 'snowy_taiga', 31: 'snowy_taiga_hills', 32: 'giant_tree_taiga', 33: 'giant_tree_taiga_hills',
  34: 'wooded_mountains', 35: 'savanna', 36: 'savanna_plateau', 37: 'badlands',
  38: 'wooded_badlands_plateau', 39: 'badlands_plateau', 40: 'small_end_islands',
  41: 'end_midlands', 42: 'end_highlands', 43: 'end_barrens', 44: 'warm_ocean',
  45: 'lukewarm_ocean', 46: 'cold_ocean', 47: 'deep_warm_ocean', 48: 'deep_lukewarm_ocean',
  49: 'deep_cold_ocean', 50: 'deep_frozen_ocean', 127: 'the_void',
  129: 'sunflower_plains', 130: 'desert_lakes', 131: 'gravelly_mountains', 132: 'flower_forest',
  133: 'taiga_mountains', 134: 'swamp_hills', 140: 'ice_spikes', 149: 'modified_jungle',
  151: 'modified_jungle_edge', 155: 'tall_birch_forest', 156: 'tall_birch_hills',
  157: 'dark_forest_hills', 158: 'snowy_taiga_mountains', 160: 'giant_spruce_taiga',
  161: 'giant_spruce_taiga_hills', 162: 'modified_gravelly_mountains', 163: 'shattered_savanna',
  164: 'shattered_savanna_plateau', 165: 'eroded_badlands',
  166: 'modified_wooded_badlands_plateau', 167: 'modified_badlands_plateau',
  168: 'bamboo_jungle', 169: 'bamboo_jungle_hills', 170: 'soul_sand_valley',
  171: 'crimson_forest', 172: 'warped_forest', 173: 'basalt_deltas',
  174: 'dripstone_caves', 175: 'lush_caves',
};

/** Палитра блоков секции -> проводной вид. */
function readBlockPalette(palette: any[]): WirePaletteEntry[] {
  return palette.map((entry) => {
    const name = String(entry?.Name ?? 'minecraft:air').replace(/^minecraft:/, '');
    const props = entry?.Properties;
    if (props && typeof props === 'object' && Object.keys(props).length > 0) {
      const flat: Record<string, string> = {};
      for (const [k, v] of Object.entries(props)) flat[k] = String(v);
      return { name, props: flat };
    }
    return { name };
  });
}

/**
 * Приводит упакованные индексы палитры к раскладке BitArrayNoSpan.
 * Для 1.16+ раскладка уже совпадает, поэтому данные просто переинтерпретируются;
 * для более старых версий поток распаковывается и упаковывается заново.
 */
function normalizeIndices(
  rawLongs: any,
  paletteLength: number,
  count: number,
  minBits: number,
  spanning: boolean,
): { bits: number; data: Uint32Array | null } {
  if (paletteLength <= 1) return { bits: 0, data: null };
  const bits = Math.max(minBits, neededBits(paletteLength - 1));
  if (!rawLongs || rawLongs.length === 0) return { bits: 0, data: null };

  const words = longsToWords(rawLongs);
  if (!spanning) {
    // Ожидаемое число long при раскладке без пересечений — проверка от нестандартных
    // писателей мира (сторонние редакторы иногда используют другой bitsPerValue).
    const expected = Math.ceil(count / Math.floor(64 / bits));
    if (expected === rawLongs.length) return { bits, data: words };
    const guessed = guessBitsNoSpan(rawLongs.length, count, bits);
    if (guessed !== bits) {
      const indices = unpackNoSpan(words, guessed, count);
      return { bits, data: packNoSpan(indices, bits) };
    }
    return { bits, data: words };
  }

  // До 1.16: bits однозначно вычисляется из числа long (count * bits / 64).
  const spanBits = Math.round((rawLongs.length * 64) / count);
  const indices = unpackSpanning(words, spanBits > 0 ? spanBits : bits, count);
  return { bits, data: packNoSpan(indices, bits) };
}

function unpackNoSpan(words: Uint32Array, bits: number, count: number): Uint16Array {
  const valuesPerLong = Math.floor(64 / bits);
  const out = new Uint16Array(count);
  for (let i = 0; i < count; i++) {
    const longIndex = Math.floor(i / valuesPerLong);
    out[i] = readBits(words, longIndex * 64 + (i - longIndex * valuesPerLong) * bits, bits);
  }
  return out;
}

function guessBitsNoSpan(longCount: number, count: number, fallback: number): number {
  for (let bits = 1; bits <= 16; bits++) {
    if (Math.ceil(count / Math.floor(64 / bits)) === longCount) return bits;
  }
  return fallback;
}

/** Секции нового формата (1.18+): корневые `sections` с `block_states` и `biomes`. */
function convertModernSections(root: any, geom: ColumnGeometry, spanning: boolean): WireSection[] {
  const out: WireSection[] = [];
  for (const section of root.sections ?? []) {
    const y = Number(section.Y);
    const skyLight = toUint8(section.SkyLight);
    const blockLight = toUint8(section.BlockLight);

    const bs = section.block_states;
    const insideColumn = y * 16 >= geom.minY && y * 16 < geom.minY + geom.worldHeight;
    if (!bs?.palette || !insideColumn) {
      // Секции над/под миром существуют только ради света на границе.
      if (skyLight || blockLight) {
        out.push({
          y, blockPalette: [], blockBits: 0, blockData: null,
          biomePalette: [], biomeBits: 0, biomeData: null, skyLight, blockLight,
        });
      }
      continue;
    }

    const blockPalette = readBlockPalette(bs.palette);
    const blocks = normalizeIndices(bs.data, blockPalette.length, 4096, 4, spanning);

    const biomeNames: string[] = (section.biomes?.palette ?? ['minecraft:plains'])
      .map((n: any) => String(n).replace(/^minecraft:/, ''));
    const biomes = normalizeIndices(section.biomes?.data, biomeNames.length, 64, 1, spanning);

    out.push({
      y,
      blockPalette,
      blockBits: blocks.bits,
      blockData: blocks.data,
      biomePalette: biomeNames,
      biomeBits: biomes.bits,
      biomeData: biomes.data,
      skyLight,
      blockLight,
    });
  }
  return out;
}

/**
 * Секции старого формата (1.13–1.17): `Level.Sections` с `Palette`/`BlockStates`.
 * Биомы лежат отдельно в `Level.Biomes` — int[1024] с 1.15 или byte[256] раньше —
 * и режутся здесь на секционные палитры.
 */
function convertLegacySections(level: any, geom: ColumnGeometry, spanning: boolean): WireSection[] {
  const rawBiomes: number[] | null = Array.isArray(level.Biomes) ? level.Biomes : null;
  const biome3d = rawBiomes != null && rawBiomes.length >= 1024;

  const biomeNameAt = (sectionY: number, bx: number, by: number, bz: number): string => {
    if (!rawBiomes) return 'plains';
    const id = biome3d
      ? rawBiomes[((sectionY * 4 + by) & 63) * 16 + bz * 4 + bx]
      : rawBiomes[(bz * 4) * 16 + bx * 4];
    return LEGACY_BIOMES[id] ?? 'plains';
  };

  const out: WireSection[] = [];
  for (const section of level.Sections ?? []) {
    const y = Number(section.Y);
    const skyLight = toUint8(section.SkyLight);
    const blockLight = toUint8(section.BlockLight);
    const insideColumn = y * 16 >= geom.minY && y * 16 < geom.minY + geom.worldHeight;

    if (!section.Palette || !insideColumn) {
      if (skyLight || blockLight) {
        out.push({
          y, blockPalette: [], blockBits: 0, blockData: null,
          biomePalette: [], biomeBits: 0, biomeData: null, skyLight, blockLight,
        });
      }
      continue;
    }

    const blockPalette = readBlockPalette(section.Palette);
    const blocks = normalizeIndices(section.BlockStates, blockPalette.length, 4096, 4, spanning);

    // Секционная палитра биомов 4×4×4 собирается из плоского массива уровня.
    const namesIndex = new Map<string, number>();
    const biomePalette: string[] = [];
    const biomeIndices = new Uint16Array(64);
    for (let by = 0; by < 4; by++) {
      for (let bz = 0; bz < 4; bz++) {
        for (let bx = 0; bx < 4; bx++) {
          const name = biomeNameAt(y, bx, by, bz);
          let idx = namesIndex.get(name);
          if (idx === undefined) {
            idx = biomePalette.length;
            biomePalette.push(name);
            namesIndex.set(name, idx);
          }
          biomeIndices[(by << 4) | (bz << 2) | bx] = idx;
        }
      }
    }
    const biomeBits = biomePalette.length > 1 ? Math.max(1, neededBits(biomePalette.length - 1)) : 0;

    out.push({
      y,
      blockPalette,
      blockBits: blocks.bits,
      blockData: blocks.data,
      biomePalette,
      biomeBits,
      biomeData: biomeBits > 0 ? packNoSpan(biomeIndices, biomeBits) : null,
      skyLight,
      blockLight,
    });
  }
  return out;
}

function collectBlockEntities(list: any): Record<string, any> {
  const out: Record<string, any> = {};
  if (!Array.isArray(list)) return out;
  for (const entity of list) {
    const x = Number(entity?.x);
    const y = Number(entity?.y);
    const z = Number(entity?.z);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    // Ключ — локальные координаты внутри колонки, как в prismarine-chunk.
    out[`${x & 15},${y},${z & 15}`] = jsonSafe(entity);
  }
  return out;
}

/** Статусы генерации, при которых чанк можно показывать: рельеф и свет уже готовы. */
const RENDERABLE_STATUSES = new Set(['full', 'fullchunk', 'postprocessed', 'mobs_spawned', 'spawn']);

export function isRenderableStatus(status: string): boolean {
  return RENDERABLE_STATUSES.has(status);
}

/**
 * Достраивает небесный свет там, где ванилла его не записала.
 * Правило формата: выше самой верхней секции с SkyLight свет равен 15,
 * ниже самой нижней — 0. Если света нет вообще (чанк не освещён игрой),
 * заливаем всю колонку — иначе мир будет чёрным.
 */
function completeSkyLight(sections: WireSection[], geom: ColumnGeometry): void {
  const minSection = geom.minY >> 4;
  const maxSection = minSection + (geom.worldHeight >> 4) - 1;

  let topStored = -Infinity;
  const byY = new Map<number, WireSection>();
  for (const s of sections) {
    byY.set(s.y, s);
    if (s.skyLight) topStored = Math.max(topStored, s.y);
  }
  const noLightAtAll = topStored === -Infinity;

  // Массивы света в prismarine-chunk имеют по одной дополнительной секции сверху и снизу.
  for (let y = minSection - 1; y <= maxSection + 1; y++) {
    const existing = byY.get(y);
    if (existing?.skyLight) continue;
    if (!noLightAtAll && y <= topStored) continue;
    if (existing) {
      existing.skyFull = true;
    } else {
      sections.push({
        y, blockPalette: [], blockBits: 0, blockData: null,
        biomePalette: [], biomeBits: 0, biomeData: null,
        skyLight: null, blockLight: null, skyFull: true,
      });
    }
  }
}

/** Преобразует разобранный NBT чанка в проводную колонку. */
export function chunkTagToWire(root: any, geom?: ColumnGeometry): WireColumn {
  const level = root.Level ?? null;
  const dataVersion = Number(root.DataVersion ?? level?.DataVersion ?? 0);
  const geometry = geom ?? geometryForDataVersion(dataVersion);
  const spanning = dataVersion < NO_SPAN_SINCE;

  const modern = Array.isArray(root.sections);
  const sections = modern
    ? convertModernSections(root, geometry, spanning)
    : convertLegacySections(level ?? {}, geometry, spanning);

  const status = String((modern ? root.Status : level?.Status) ?? '').replace(/^minecraft:/, '');
  const lightOn = Boolean(modern ? root.isLightOn : level?.isLightOn ?? level?.LightPopulated);

  completeSkyLight(sections, geometry);

  let byteSize = 0;
  for (const s of sections) {
    byteSize += (s.blockData?.byteLength ?? 0) + (s.biomeData?.byteLength ?? 0)
      + (s.skyLight?.byteLength ?? 0) + (s.blockLight?.byteLength ?? 0);
  }

  return {
    x: Number(modern ? root.xPos : level?.xPos ?? 0),
    z: Number(modern ? root.zPos : level?.zPos ?? 0),
    minY: geometry.minY,
    worldHeight: geometry.worldHeight,
    dataVersion,
    status,
    lightOn,
    sections,
    blockEntities: collectBlockEntities(modern ? root.block_entities : level?.TileEntities),
    byteSize,
  };
}

// ===== Вспомогательное для выбора стартовой позиции камеры =====

/** Имя блока в проводной колонке по локальным координатам (x,z в 0..15). */
export function wireBlockName(column: WireColumn, x: number, y: number, z: number): string {
  const sectionY = y >> 4;
  const section = column.sections.find((s) => s.y === sectionY);
  if (!section || section.blockPalette.length === 0) return 'air';
  if (section.blockPalette.length === 1) return section.blockPalette[0].name;
  if (!section.blockData) return section.blockPalette[0].name;

  const index = ((y & 15) << 8) | (z << 4) | x;
  const bits = section.blockBits;
  const valuesPerLong = Math.floor(64 / bits);
  const longIndex = Math.floor(index / valuesPerLong);
  const value = readBits(section.blockData, longIndex * 64 + (index - longIndex * valuesPerLong) * bits, bits);
  return section.blockPalette[value]?.name ?? 'air';
}

/** Высота верхнего непустого блока в точке колонки — для наводки камеры. */
export function sampleSurfaceY(column: WireColumn, x = 8, z = 8): number {
  const top = column.minY + column.worldHeight - 1;
  for (let y = top; y >= column.minY; y--) {
    const name = wireBlockName(column, x, y, z);
    if (name !== 'air' && name !== 'cave_air' && name !== 'void_air') return y;
  }
  return column.minY;
}
