// Сопоставление блоков и биомов мира с реестром версии рендерера (1.21.6).
//
// Численные block state ID между версиями Minecraft НЕ совпадают, поэтому индексы
// из палитры чанка нельзя использовать напрямую. Палитра даёт имя блока и его
// properties — по ним здесь вычисляется state ID в реестре 1.21.6. То же с биомами:
// сопоставление идёт по имени, а не по числу.

import type { WirePaletteEntry } from './types';

/** Счётчики того, что не удалось сопоставить один в один. */
export interface MappingStats {
  /** Имя блока отсутствует в реестре 1.21.6 -> сколько записей палитры затронуто. */
  missingBlocks: Map<string, number>;
  /** Блок переименован между версиями и подменён по таблице. */
  renamedBlocks: Map<string, number>;
  /** Свойство состояния отброшено: в 1.21.4 у блока такого свойства нет. */
  droppedProps: Map<string, number>;
  /** Значение перечислимого свойства не найдено в 1.21.4. */
  unknownValues: Map<string, number>;
  missingBiomes: Map<string, number>;
  renamedBiomes: Map<string, number>;
}

export function createMappingStats(): MappingStats {
  return {
    missingBlocks: new Map(),
    renamedBlocks: new Map(),
    droppedProps: new Map(),
    unknownValues: new Map(),
    missingBiomes: new Map(),
    renamedBiomes: new Map(),
  };
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

// ===== Переименования блоков =====

/**
 * Блоки, переименованные между 1.13 и 1.21.6. `maxDataVersion` ограничивает правило
 * версиями, в которых старое имя означало именно этот блок: например `stone_slab`
 * в 1.13 — это плита из полированного камня, а с 1.14 так называется другой блок.
 */
const BLOCK_RENAMES: Array<{ from: string; to: string; maxDataVersion?: number }> = [
  // 1.20.3 переименовала обычную траву, чтобы освободить имя под новый блок.
  { from: 'grass', to: 'short_grass' },
  // 1.17
  { from: 'grass_path', to: 'dirt_path' },
  // 1.14 добавила породы дерева в имена знаков
  { from: 'sign', to: 'oak_sign' },
  { from: 'wall_sign', to: 'oak_wall_sign' },
  // 1.14 разделила плиты из камня и полированного камня
  { from: 'stone_slab', to: 'smooth_stone_slab', maxDataVersion: 1631 },
  // 1.13 ещё звал вагонетку с воронкой иначе (встречается в TileEntities, не в палитре)
  { from: 'cactus_flower_pot', to: 'potted_cactus' },

  // ===== Блоки новее мешера 1.21.6 (1.21.7–1.21.11) → ближайший аналог =====
  { from: 'oak_shelf', to: 'chiseled_bookshelf' },
  { from: 'spruce_shelf', to: 'chiseled_bookshelf' },
  { from: 'birch_shelf', to: 'chiseled_bookshelf' },
  { from: 'jungle_shelf', to: 'chiseled_bookshelf' },
  { from: 'acacia_shelf', to: 'chiseled_bookshelf' },
  { from: 'dark_oak_shelf', to: 'chiseled_bookshelf' },
  { from: 'mangrove_shelf', to: 'chiseled_bookshelf' },
  { from: 'cherry_shelf', to: 'chiseled_bookshelf' },
  { from: 'bamboo_shelf', to: 'chiseled_bookshelf' },
  { from: 'crimson_shelf', to: 'chiseled_bookshelf' },
  { from: 'warped_shelf', to: 'chiseled_bookshelf' },
  { from: 'pale_oak_shelf', to: 'chiseled_bookshelf' },
  { from: 'copper_chest', to: 'chest' },
  { from: 'exposed_copper_chest', to: 'chest' },
  { from: 'weathered_copper_chest', to: 'chest' },
  { from: 'oxidized_copper_chest', to: 'chest' },
  { from: 'waxed_copper_chest', to: 'chest' },
  { from: 'waxed_exposed_copper_chest', to: 'chest' },
  { from: 'waxed_weathered_copper_chest', to: 'chest' },
  { from: 'waxed_oxidized_copper_chest', to: 'chest' },
  { from: 'copper_golem_statue', to: 'copper_block' },
  { from: 'exposed_copper_golem_statue', to: 'exposed_copper' },
  { from: 'weathered_copper_golem_statue', to: 'weathered_copper' },
  { from: 'oxidized_copper_golem_statue', to: 'oxidized_copper' },
  { from: 'waxed_copper_golem_statue', to: 'copper_block' },
  { from: 'waxed_exposed_copper_golem_statue', to: 'exposed_copper' },
  { from: 'waxed_weathered_copper_golem_statue', to: 'weathered_copper' },
  { from: 'waxed_oxidized_copper_golem_statue', to: 'oxidized_copper' },
  { from: 'copper_torch', to: 'torch' },
  { from: 'copper_wall_torch', to: 'wall_torch' },
  { from: 'copper_lantern', to: 'lantern' },
  { from: 'exposed_copper_lantern', to: 'lantern' },
  { from: 'weathered_copper_lantern', to: 'lantern' },
  { from: 'oxidized_copper_lantern', to: 'lantern' },
  { from: 'waxed_copper_lantern', to: 'lantern' },
  { from: 'waxed_exposed_copper_lantern', to: 'lantern' },
  { from: 'waxed_weathered_copper_lantern', to: 'lantern' },
  { from: 'waxed_oxidized_copper_lantern', to: 'lantern' },
  { from: 'copper_chain', to: 'chain' },
  { from: 'exposed_copper_chain', to: 'chain' },
  { from: 'weathered_copper_chain', to: 'chain' },
  { from: 'oxidized_copper_chain', to: 'chain' },
  { from: 'waxed_copper_chain', to: 'chain' },
  { from: 'waxed_exposed_copper_chain', to: 'chain' },
  { from: 'waxed_weathered_copper_chain', to: 'chain' },
  { from: 'waxed_oxidized_copper_chain', to: 'chain' },
  { from: 'iron_chain', to: 'chain' },
  { from: 'copper_bars', to: 'iron_bars' },
  { from: 'exposed_copper_bars', to: 'iron_bars' },
  { from: 'weathered_copper_bars', to: 'iron_bars' },
  { from: 'oxidized_copper_bars', to: 'iron_bars' },
  { from: 'waxed_copper_bars', to: 'iron_bars' },
  { from: 'waxed_exposed_copper_bars', to: 'iron_bars' },
  { from: 'waxed_weathered_copper_bars', to: 'iron_bars' },
  { from: 'waxed_oxidized_copper_bars', to: 'iron_bars' },
  { from: 'exposed_lightning_rod', to: 'lightning_rod' },
  { from: 'weathered_lightning_rod', to: 'lightning_rod' },
  { from: 'oxidized_lightning_rod', to: 'lightning_rod' },
  { from: 'waxed_lightning_rod', to: 'lightning_rod' },
  { from: 'waxed_exposed_lightning_rod', to: 'lightning_rod' },
  { from: 'waxed_weathered_lightning_rod', to: 'lightning_rod' },
  { from: 'waxed_oxidized_lightning_rod', to: 'lightning_rod' },
];

/** Быстрый поиск правила по имени. */
const renameIndex = new Map<string, Array<{ to: string; maxDataVersion?: number }>>();
for (const rule of BLOCK_RENAMES) {
  const list = renameIndex.get(rule.from) ?? [];
  list.push({ to: rule.to, maxDataVersion: rule.maxDataVersion });
  renameIndex.set(rule.from, list);
}

// ===== Переименования биомов =====

/**
 * 1.18 вычистила «hills/plateau/mountains»-варианты биомов. Старые имена
 * сопоставляются с ближайшим по виду биомом 1.21.4, иначе трава и листва
 * получат цвет случайного биома.
 */
const BIOME_RENAMES: Record<string, string> = {
  nether: 'nether_wastes',
  mountains: 'windswept_hills',
  mountain_edge: 'windswept_hills',
  wooded_mountains: 'windswept_forest',
  gravelly_mountains: 'windswept_gravelly_hills',
  modified_gravelly_mountains: 'windswept_gravelly_hills',
  snowy_tundra: 'snowy_plains',
  snowy_mountains: 'snowy_plains',
  desert_hills: 'desert',
  desert_lakes: 'desert',
  wooded_hills: 'forest',
  taiga_hills: 'taiga',
  taiga_mountains: 'taiga',
  jungle_hills: 'jungle',
  jungle_edge: 'sparse_jungle',
  modified_jungle: 'jungle',
  modified_jungle_edge: 'sparse_jungle',
  bamboo_jungle_hills: 'bamboo_jungle',
  stone_shore: 'stony_shore',
  birch_forest_hills: 'birch_forest',
  tall_birch_forest: 'old_growth_birch_forest',
  tall_birch_hills: 'old_growth_birch_forest',
  dark_forest_hills: 'dark_forest',
  snowy_taiga_hills: 'snowy_taiga',
  snowy_taiga_mountains: 'snowy_taiga',
  giant_tree_taiga: 'old_growth_pine_taiga',
  giant_tree_taiga_hills: 'old_growth_pine_taiga',
  giant_spruce_taiga: 'old_growth_spruce_taiga',
  giant_spruce_taiga_hills: 'old_growth_spruce_taiga',
  savanna_plateau: 'savanna_plateau',
  shattered_savanna: 'windswept_savanna',
  shattered_savanna_plateau: 'windswept_savanna',
  wooded_badlands_plateau: 'wooded_badlands',
  modified_wooded_badlands_plateau: 'wooded_badlands',
  badlands_plateau: 'badlands',
  modified_badlands_plateau: 'badlands',
  mushroom_field_shore: 'mushroom_fields',
  swamp_hills: 'swamp',
  deep_warm_ocean: 'warm_ocean',
  // 1.13-1.17 звали болото swamp, имя не менялось; здесь на всякий случай синонимы
  swampland: 'swamp',
};

// ===== Резолвер блоков =====

export interface BlockResolver {
  /** State ID блока в реестре рендерера. */
  resolve(entry: WirePaletteEntry): number;
  /** Биом по имени -> числовой ID в реестре рендерера. */
  resolveBiome(name: string): number;
  stats: MappingStats;
  /** Сколько записей палитры прошло через резолвер (для процента промахов). */
  resolvedCount: number;
}

/**
 * Значение свойства состояния -> смещение внутри блока.
 * Повторяет арифметику prismarine-block, но без исключений: неизвестные свойства
 * и значения отбрасываются и попадают в статистику.
 */
function stateOffset(
  states: any[],
  key: string,
  rawValue: string,
  blockName: string,
  stats: MappingStats,
): number {
  let multiplier = 1;
  for (let i = states.length - 1; i >= 0; i--) {
    const state = states[i];
    if (state.name === key) {
      if (state.type === 'enum' || state.values) {
        const index = state.values.indexOf(rawValue);
        if (index < 0) {
          bump(stats.unknownValues, `${blockName}.${key}=${rawValue}`);
          return 0;
        }
        return multiplier * index;
      }
      if (state.type === 'bool') {
        // В minecraft-data порядок значений bool — true, затем false.
        return multiplier * (rawValue === 'true' ? 0 : 1);
      }
      const num = Number(rawValue);
      if (!Number.isFinite(num)) {
        bump(stats.unknownValues, `${blockName}.${key}=${rawValue}`);
        return 0;
      }
      return multiplier * num;
    }
    multiplier *= state.num_values;
  }
  bump(stats.droppedProps, `${blockName}.${key}`);
  return 0;
}

export function createBlockResolver(mcData: any, dataVersion: number): BlockResolver {
  const stats = createMappingStats();
  const cache = new Map<string, number>();

  const airState: number = mcData.blocksByName.air?.defaultState ?? 0;
  const fallbackState: number = mcData.blocksByName.stone?.defaultState ?? airState;

  const resolveName = (name: string): string => {
    const rules = renameIndex.get(name);
    if (!rules) return name;
    for (const rule of rules) {
      if (rule.maxDataVersion != null && dataVersion > rule.maxDataVersion) continue;
      // Подменяем, только если новое имя действительно есть в реестре.
      if (mcData.blocksByName[rule.to]) {
        bump(stats.renamedBlocks, `${name} -> ${rule.to}`);
        return rule.to;
      }
    }
    return name;
  };

  const resolve = (entry: WirePaletteEntry): number => {
    const key = entry.props ? `${entry.name}|${JSON.stringify(entry.props)}` : entry.name;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;

    let stateId: number;
    let props = entry.props;
    let name = resolveName(entry.name);

    // 1.17 разделила котёл: пустой `cauldron` без свойств и `water_cauldron` с level 1..3.
    if (name === 'cauldron' && props?.level) {
      const level = Number(props.level);
      if (level > 0 && mcData.blocksByName.water_cauldron) {
        bump(stats.renamedBlocks, `cauldron(level=${level}) -> water_cauldron`);
        name = 'water_cauldron';
        props = { level: String(Math.min(3, level)) };
      } else {
        props = undefined;
      }
    }

    const block = mcData.blocksByName[name];

    if (!block) {
      bump(stats.missingBlocks, entry.name);
      // Воздуховидные блоки заменяем воздухом, остальное — камнем: дыры в рельефе
      // заметнее и хуже, чем неверная текстура.
      stateId = /(^|_)air$/.test(name) || name === 'light' || name === 'void_air' ? airState : fallbackState;
    } else if (!props || !block.states) {
      stateId = block.defaultState;
    } else {
      let offset = 0;
      for (const [k, v] of Object.entries(props)) {
        offset += stateOffset(block.states, k, v, name, stats);
      }
      stateId = block.minStateId + offset;
      // Защита от несовпадения набора свойств между версиями.
      if (stateId < block.minStateId || stateId > block.maxStateId) {
        bump(stats.unknownValues, `${name} state out of range`);
        stateId = block.defaultState;
      }
    }

    cache.set(key, stateId);
    resolver.resolvedCount++;
    return stateId;
  };

  const biomeCache = new Map<string, number>();
  const defaultBiome: number = mcData.biomesByName.plains?.id ?? 0;

  const resolveBiome = (rawName: string): number => {
    const cached = biomeCache.get(rawName);
    if (cached !== undefined) return cached;
    let name = rawName;
    const renamed = BIOME_RENAMES[name];
    if (renamed && renamed !== name && mcData.biomesByName[renamed]) {
      bump(stats.renamedBiomes, `${name} -> ${renamed}`);
      name = renamed;
    }
    const biome = mcData.biomesByName[name];
    let id: number;
    if (biome) {
      id = biome.id;
    } else {
      bump(stats.missingBiomes, rawName);
      id = defaultBiome;
    }
    biomeCache.set(rawName, id);
    return id;
  };

  const resolver: BlockResolver = { resolve, resolveBiome, stats, resolvedCount: 0 };
  return resolver;
}

/** Краткая сводка по промахам сопоставления — для лога и отчёта. */
export function formatStats(stats: MappingStats, limit = 12): string[] {
  const lines: string[] = [];
  const dump = (title: string, map: Map<string, number>) => {
    if (map.size === 0) return;
    const sorted = [...map.entries()].sort((a, b) => b[1] - a[1]);
    const head = sorted.slice(0, limit).map(([k, n]) => `${k} x${n}`).join(', ');
    const tail = sorted.length > limit ? ` … и ещё ${sorted.length - limit}` : '';
    lines.push(`${title} (${map.size}): ${head}${tail}`);
  };
  dump('нет в 1.21.6 (блоки)', stats.missingBlocks);
  dump('переименованные блоки', stats.renamedBlocks);
  dump('отброшенные свойства', stats.droppedProps);
  dump('неизвестные значения свойств', stats.unknownValues);
  dump('нет в 1.21.4 (биомы)', stats.missingBiomes);
  dump('переименованные биомы', stats.renamedBiomes);
  return lines;
}
