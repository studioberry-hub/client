// Ванильные команды под версию сервера. Агент отправляет их, а не выдумывает синтаксис.

export type VanillaPlan = {
  commands: string[];
  note: string;
  syntax: 'components' | 'nbt';
  unclear?: string;
};

type Enchant = [string, number];

const MATERIALS: Array<[RegExp, string]> = [
  [/незерит|netherite/, 'netherite'],
  [/алмаз|diamond/, 'diamond'],
  [/желез|iron/, 'iron'],
  [/золот|golden|gold/, 'golden'],
  [/цепн|chain/, 'chainmail'],
  [/кожан|leather/, 'leather'],
];

const ARMOR = ['helmet', 'chestplate', 'leggings', 'boots'] as const;

const ARMOR_ENCHANTS: Record<(typeof ARMOR)[number], Enchant[]> = {
  helmet: [['protection', 4], ['respiration', 3], ['aqua_affinity', 1], ['unbreaking', 3], ['mending', 1], ['thorns', 3]],
  chestplate: [['protection', 4], ['unbreaking', 3], ['mending', 1], ['thorns', 3]],
  leggings: [['protection', 4], ['swift_sneak', 3], ['unbreaking', 3], ['mending', 1], ['thorns', 3]],
  boots: [['protection', 4], ['feather_falling', 4], ['depth_strider', 3], ['soul_speed', 3], ['unbreaking', 3], ['mending', 1], ['thorns', 3]],
};

const TOOLS: Array<{ test: RegExp; id: string; enchants: Enchant[]; plain?: boolean }> = [
  { test: /меч|sword/, id: 'sword', enchants: [['sharpness', 5], ['looting', 3], ['fire_aspect', 2], ['sweeping_edge', 3], ['unbreaking', 3], ['mending', 1]] },
  { test: /кирк|pickaxe|pick\b/, id: 'pickaxe', enchants: [['efficiency', 5], ['fortune', 3], ['unbreaking', 3], ['mending', 1]] },
  { test: /топор|\baxe\b/, id: 'axe', enchants: [['efficiency', 5], ['sharpness', 5], ['unbreaking', 3], ['mending', 1]] },
  { test: /лопат|shovel/, id: 'shovel', enchants: [['efficiency', 5], ['fortune', 3], ['unbreaking', 3], ['mending', 1]] },
  { test: /мотыг|\bhoe\b/, id: 'hoe', enchants: [['efficiency', 5], ['fortune', 3], ['unbreaking', 3], ['mending', 1]] },
  { test: /удоч|fishing/, id: 'fishing_rod', plain: true, enchants: [['lure', 3], ['luck_of_the_sea', 3], ['unbreaking', 3], ['mending', 1]] },
  { test: /лук|\bbow\b/, id: 'bow', plain: true, enchants: [['power', 5], ['punch', 2], ['flame', 1], ['infinity', 1], ['unbreaking', 3]] },
  { test: /арбалет|crossbow/, id: 'crossbow', plain: true, enchants: [['quick_charge', 3], ['multishot', 1], ['unbreaking', 3], ['mending', 1]] },
  { test: /трезуб|trident/, id: 'trident', plain: true, enchants: [['impaling', 5], ['loyalty', 3], ['channeling', 1], ['unbreaking', 3], ['mending', 1]] },
  { test: /элитр|elytra/, id: 'elytra', plain: true, enchants: [['unbreaking', 3], ['mending', 1]] },
];

const EFFECTS: Array<[RegExp, string]> = [
  [/скорост|speed/, 'speed'],
  [/сил[ауи]|strength/, 'strength'],
  [/прыж|jump/, 'jump_boost'],
  [/спешк|haste/, 'haste'],
  [/реген|regeneration/, 'regeneration'],
  [/невидим|invisibility/, 'invisibility'],
  [/ночн|night_vision/, 'night_vision'],
  [/огнестой|fire_resistance/, 'fire_resistance'],
  [/водн|дыхани|water_breathing/, 'water_breathing'],
];

function partsOf(version: string): number[] {
  const parts = String(version || '1.21.4').split(/[^0-9]+/).filter(Boolean).slice(0, 3).map((item) => Number(item) || 0);
  while (parts.length < 3) parts.push(0);
  return parts;
}

export function mcAtLeast(version: string, target: string): boolean {
  const left = partsOf(version);
  const right = partsOf(target);
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] > right[i];
  }
  return true;
}

function keepEnchant(version: string, id: string): boolean {
  if (id === 'mending' && !mcAtLeast(version, '1.9')) return false;
  if (id === 'sweeping_edge' && !mcAtLeast(version, '1.11.1')) return false;
  if (id === 'soul_speed' && !mcAtLeast(version, '1.16')) return false;
  if (id === 'swift_sneak' && !mcAtLeast(version, '1.19')) return false;
  return true;
}

function giveLine(version: string, item: string, enchants: Enchant[], player: string): string {
  const list = enchants.filter(([id]) => keepEnchant(version, id));
  if (!list.length) return `give ${player} ${item} 1`;
  if (mcAtLeast(version, '1.20.5')) {
    const levels = list.map(([id, level]) => `"minecraft:${id}":${level}`).join(',');
    return `give ${player} ${item}[enchantments={levels:{${levels}}}] 1`;
  }
  const nbt = list.map(([id, level]) => `{id:"minecraft:${id}",lvl:${level}s}`).join(',');
  return `give ${player} ${item}{Enchantments:[${nbt}]} 1`;
}

function playerOf(text: string, explicit?: string): string {
  const given = String(explicit || '').trim();
  if (/^@?[A-Za-z0-9_]{1,32}$/.test(given)) return given.startsWith('@') ? given : given;
  if (/всем игрокам|каждому игроку|@a\b/.test(text)) return '@a';
  const nick = text.match(/(?:ник(?:у|ом)?|игроку|для)\s+([A-Za-z0-9_]{3,16})/i);
  return nick?.[1] || '@p';
}

function materialOf(text: string): string {
  return MATERIALS.find(([test]) => test.test(text))?.[1] || '';
}

function rawCommand(text: string): string | null {
  const line = text.trim().replace(/^\//, '');
  if (!/^(give|gamemode|gm|time|weather|effect|xp|experience|tp|teleport|enchant|summon|difficulty|gamerule)\b/i.test(line)) return null;
  if (/@[a-z]|\b(day|night|noon|midnight|clear|rain|thunder|creative|survival|spectator|adventure)\b|[a-z]+_[a-z]+/i.test(line)) return line;
  return null;
}

export function buildVanillaCommands(request: string, version: string, playerArg = ''): VanillaPlan {
  const text = String(request || '').trim().toLowerCase();
  const syntax = mcAtLeast(version, '1.20.5') ? 'components' : 'nbt';
  const direct = rawCommand(request || '');
  if (direct) return { commands: [direct], note: 'Команда отправлена как есть.', syntax };
  if (!text) return { commands: [], note: '', syntax, unclear: 'Пустая команда. Вызови ask_user_form и спроси, что выдать.' };

  const player = playerOf(text, playerArg);
  const commands: string[] = [];
  const material = materialOf(text);
  const enchanted = /максим|полн|лучш|\bmax\b|чар|enchant/.test(text) && !/без чар|без зача|no enchant|unenchant/.test(text);
  const wantsArmor = /брон|комплект|сет|\bkit\b|armor|шлем|нагруд|понож|ботин|helmet|chest|legg|boot/.test(text);
  const tools = TOOLS.filter((item) => item.test.test(text));

  if (wantsArmor || tools.length) {
    if (!material && (wantsArmor || tools.some((item) => !item.plain))) {
      return {
        commands: [],
        note: '',
        syntax,
        unclear: 'Не назван материал. Вызови ask_user_form со списком: незерит, алмаз, железо, золото, кольчуга, кожа.',
      };
    }
    if (wantsArmor) {
      const pieces = ARMOR.filter((piece) => {
        if (piece === 'helmet') return /шлем|helmet|каск/.test(text);
        if (piece === 'chestplate') return /нагруд|chest/.test(text);
        if (piece === 'leggings') return /понож|legg/.test(text);
        return /ботин|boot/.test(text);
      });
      const chosen = pieces.length ? pieces : [...ARMOR];
      for (const piece of chosen) {
        const item = `${material}_${piece}`;
        commands.push(giveLine(version, item, enchanted ? ARMOR_ENCHANTS[piece] : [], player));
      }
    }
    for (const tool of tools) {
      const item = tool.plain ? tool.id : `${material}_${tool.id}`;
      commands.push(giveLine(version, item, enchanted ? tool.enchants : [], player));
    }
  }

  if (/творческ|креатив|creative/.test(text)) commands.push(`gamemode creative ${player}`);
  else if (/выживан|survival/.test(text)) commands.push(`gamemode survival ${player}`);
  else if (/приключ|adventure/.test(text)) commands.push(`gamemode adventure ${player}`);
  else if (/наблюд|spectator|спект/.test(text)) commands.push(`gamemode spectator ${player}`);

  if (/(^|[^а-яё])день([^а-яё]|$)|день$|\bday\b|рассвет/.test(text)) commands.push('time set day');
  else if (/ночь|night/.test(text)) commands.push('time set night');
  else if (/полдень|noon/.test(text)) commands.push('time set noon');
  else if (/полночь|midnight/.test(text)) commands.push('time set midnight');

  if (/ясн|clear weather|без дожд|солнеч/.test(text)) commands.push('weather clear');
  else if (/гроз|thunder/.test(text)) commands.push('weather thunder');
  else if (/дожд|rain/.test(text)) commands.push('weather rain');

  const xp = text.match(/(?:опыт|experience|\bxp\b)\D{0,8}(\d{1,7})/);
  if (xp) commands.push(`xp add ${player} ${xp[1]} points`);

  if (/снять эффект|убери эффект|clear effect/.test(text)) commands.push(`effect clear ${player}`);
  else {
    const level = enchanted ? 1 : 0;
    for (const [test, id] of EFFECTS) {
      if (test.test(text)) commands.push(`effect give ${player} ${id} 1000000 ${level} true`);
    }
  }

  if (!commands.length) {
    return {
      commands: [],
      note: '',
      syntax,
      unclear: 'Не разобрал, что сделать в игре. Вызови ask_user_form: предмет, материал и нужны ли максимальные чары.',
    };
  }
  return {
    commands,
    syntax,
    note: enchanted
      ? 'Чары совместимы между собой: защита вместо отдельных стихий, удача вместо шёлкового касания, бесконечность на луке вместо починки.'
      : 'Команды собраны под версию сервера.',
  };
}
