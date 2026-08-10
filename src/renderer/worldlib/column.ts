// Сборка колонки prismarine-chunk из проводных данных Anvil.
//
// Ключевая идея: раскладка упакованных индексов, приходящая из main-процесса, уже
// совпадает с внутренним форматом BitArrayNoSpan (пары 32-битных слов low/high).
// Поэтому BitArray строится ПОВЕРХ переданного ArrayBuffer без копирования и
// перепаковки, а секция создаётся через ChunkSection.fromLocalPalette с палитрой
// state ID версии рендерера. Поблочный setBlockStateId (98 тысяч вызовов на колонку)
// не используется — он на порядок медленнее.

import type { BlockResolver } from './mapping';
import type { WireColumn, WireSection } from './types';

/** Классы prismarine-chunk, доступные только через экземпляр колонки. */
interface ChunkInternals {
  Chunk: any;
  ChunkSection: any;
  BiomeSection: any;
  BitArray: any;
  noSizePrefix: boolean | undefined;
  hasFluidCount: boolean | undefined;
}

/** Полностью освещённая секция: нибблы 15 на все 4096 блоков. */
const FULL_SKY_LIGHT = new Uint8Array(2048).fill(0xff);

export function inspectChunkInternals(Chunk: any): ChunkInternals {
  const probe = new Chunk({ minY: -64, worldHeight: 384 });
  return {
    Chunk,
    ChunkSection: Chunk.section,
    BiomeSection: probe.biomes[0].constructor,
    BitArray: probe.skyLightMask.constructor,
    noSizePrefix: probe.sections[0].noSizePrefix,
    hasFluidCount: probe.sections[0].hasFluidCount,
  };
}

/** Данные из IPC могут прийти как вид на общий буфер — BitArray требует буфер целиком. */
function ownBuffer(view: Uint32Array): ArrayBuffer {
  if (view.byteOffset === 0 && view.byteLength === view.buffer.byteLength) {
    return view.buffer as ArrayBuffer;
  }
  return view.slice().buffer as ArrayBuffer;
}

function toNibbleBuffer(view: Uint8Array): Uint8Array {
  return view.length === 2048 ? view : new Uint8Array(2048);
}

function buildBlockSection(
  wire: WireSection,
  internals: ChunkInternals,
  resolver: BlockResolver,
): any | null {
  if (wire.blockPalette.length === 0) return null;
  const palette = wire.blockPalette.map((entry) => resolver.resolve(entry));

  if (palette.length === 1 || !wire.blockData || wire.blockBits === 0) {
    return internals.ChunkSection.fromLocalPalette({
      noSizePrefix: internals.noSizePrefix,
      hasFluidCount: internals.hasFluidCount,
      palette: [palette[0]],
      data: null,
    });
  }

  const data = new internals.BitArray({
    data: ownBuffer(wire.blockData),
    bitsPerValue: wire.blockBits,
    capacity: 4096,
  });
  return internals.ChunkSection.fromLocalPalette({
    noSizePrefix: internals.noSizePrefix,
    hasFluidCount: internals.hasFluidCount,
    palette,
    data,
  });
}

function buildBiomeSection(
  wire: WireSection,
  internals: ChunkInternals,
  resolver: BlockResolver,
): any | null {
  if (wire.biomePalette.length === 0) return null;
  const palette = wire.biomePalette.map((name) => resolver.resolveBiome(name));

  if (palette.length === 1 || !wire.biomeData || wire.biomeBits === 0) {
    return internals.BiomeSection.fromLocalPalette({
      noSizePrefix: internals.noSizePrefix,
      palette: [palette[0]],
      data: null,
    });
  }

  const data = new internals.BitArray({
    data: ownBuffer(wire.biomeData),
    bitsPerValue: wire.biomeBits,
    capacity: 64,
  });
  return internals.BiomeSection.fromLocalPalette({
    noSizePrefix: internals.noSizePrefix,
    palette,
    data,
  });
}

/**
 * Пустая колонка (только воздух, полное небесное освещение).
 *
 * Нужна обязательно: WorldView._loadChunks при getColumnAt() === null уходит в
 * бесконечное ожидание промиса waitingSpiralChunksLoad, который в нашем сценарии
 * никто не разрешит (в mcraft.fun его разрешает событие прихода чанка от сервера).
 * Поэтому на месте несгенерированных чанков отдаётся воздух — это и семантически
 * верно: там действительно пустота.
 */
export function createEmptyColumn(
  internals: ChunkInternals,
  minY: number,
  worldHeight: number,
  biomeId: number,
): any {
  const column = new internals.Chunk({ minY, worldHeight });
  const biome = internals.BiomeSection.fromLocalPalette({
    noSizePrefix: internals.noSizePrefix,
    palette: [biomeId],
    data: null,
  });
  for (let i = 0; i < column.numSections; i++) column.biomes[i] = biome;
  for (let y = (minY >> 4) - 1; y <= (minY + worldHeight) / 16; y++) {
    column._loadSkyLightNibbles(y, FULL_SKY_LIGHT);
  }
  return column;
}

export interface BuildResult {
  column: any;
  /** Доминирующий биом колонки — им заполняются секции без данных о биомах. */
  biomeId: number;
  sectionsWithBlocks: number;
}

/** Строит колонку prismarine-chunk по проводным данным. */
export function wireToColumn(
  wire: WireColumn,
  internals: ChunkInternals,
  resolver: BlockResolver,
): BuildResult {
  const column = new internals.Chunk({ minY: wire.minY, worldHeight: wire.worldHeight });
  const numSections: number = column.numSections;
  /** Смещение индекса секции блоков: minY = -64 -> 4. */
  const blockOffset = Math.abs(wire.minY >> 4);

  let sectionsWithBlocks = 0;
  let biomeId = -1;

  for (const section of wire.sections) {
    const index = section.y + blockOffset;

    if (index >= 0 && index < numSections) {
      const blocks = buildBlockSection(section, internals, resolver);
      if (blocks) {
        column.sections[index] = blocks;
        sectionsWithBlocks++;
      }
      const biomes = buildBiomeSection(section, internals, resolver);
      if (biomes) {
        column.biomes[index] = biomes;
        if (biomeId < 0) biomeId = resolver.resolveBiome(section.biomePalette[0]);
      }
    }

    // Секции света на одну шире колонки с обеих сторон, поэтому индексы проверяются
    // отдельно — приграничные секции (y = -5 и y = 20 для обычного мира) тоже нужны.
    const lightIndex = section.y + blockOffset + 1;
    if (lightIndex >= 0 && lightIndex < numSections + 2) {
      if (section.skyFull) {
        column._loadSkyLightNibbles(section.y, FULL_SKY_LIGHT);
      } else if (section.skyLight) {
        column._loadSkyLightNibbles(section.y, toNibbleBuffer(section.skyLight));
      }
      if (section.blockLight) {
        column._loadBlockLightNibbles(section.y, toNibbleBuffer(section.blockLight));
      }
    }
  }

  if (biomeId < 0) biomeId = resolver.resolveBiome('plains');

  // Секции без данных о биомах (пустые секции старых версий) получают доминирующий
  // биом колонки: иначе тинты травы и листвы считаются по биому с ID 0.
  const fallbackBiome = internals.BiomeSection.fromLocalPalette({
    noSizePrefix: internals.noSizePrefix,
    palette: [biomeId],
    data: null,
  });
  for (let i = 0; i < numSections; i++) {
    if (column.biomes[i]?.data?.palette === undefined && column.biomes[i]?.data?.value === 0) {
      column.biomes[i] = fallbackBiome;
    }
  }

  column.blockEntities = wire.blockEntities ?? {};
  column.x = wire.x;
  column.z = wire.z;

  return { column, biomeId, sectionsWithBlocks };
}
