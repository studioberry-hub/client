// Синтаксис команд консоли: ваниль, Bukkit/Paper и команды установленных плагинов.
// Дерево аргументов повторяет подсказки чата: литералы, числа, игроки и селекторы.

export interface SuggestPlayer {
  name: string;
  head: string;
}

export interface SuggestRow {
  text: string;
  hint: string;
  head?: string;
  icon?: string;
}

export type RegName = 'item' | 'block' | 'entity' | 'effect' | 'enchant' | 'biome' | 'structure' | 'particle' | 'attribute' | 'feature' | 'damage' | 'slot';

export type Registries = Record<RegName, string[]>;

export const EMPTY_REGS: Registries = {
  item: [], block: [], entity: [], effect: [], enchant: [], biome: [], structure: [], particle: [], attribute: [], feature: [], damage: [], slot: [],
};

export type Syn =
  | { k: 'lit'; hint: string; values: string[]; then?: Syn }
  | { k: 'player'; hint: string; then?: Syn }
  | { k: 'num'; hint: string; then?: Syn }
  | { k: 'bool'; then?: Syn }
  | { k: 'word'; hint: string; then?: Syn }
  | { k: 'greedy'; hint: string }
  | { k: 'alt'; options: Syn[] }
  | { k: 'command' }
  | { k: 'ref'; id: string }
  | { k: 'reg'; reg: RegName; hint: string; then?: Syn }
  | { k: 'pos'; hint: string; then?: Syn };

export interface ServerCommand {
  name: string;
  hint: string;
  aliases?: string[];
  syn?: Syn;
}

const SELECTORS = ['@a', '@e', '@p', '@r', '@s', '@n'];
const MODES = ['survival', 'creative', 'adventure', 'spectator'];
const DIFFICULTIES = ['peaceful', 'easy', 'normal', 'hard'];
const RULES = ['keepInventory', 'doDaylightCycle', 'doWeatherCycle', 'doMobSpawning', 'mobGriefing', 'doFireTick', 'naturalRegeneration', 'showDeathMessages', 'fallDamage', 'drowningDamage', 'commandBlockOutput', 'doImmediateRespawn', 'pvp', 'sendCommandFeedback', 'doEntityDrops', 'doTileDrops', 'doMobLoot', 'randomTickSpeed', 'spawnRadius', 'maxEntityCramming'];

const lit = (hint: string, values: string[], then?: Syn): Syn => ({ k: 'lit', hint, values, then });
const player = (then?: Syn, hint = 'игрок'): Syn => ({ k: 'player', hint, then });
const num = (hint: string, then?: Syn): Syn => ({ k: 'num', hint, then });
const word = (hint: string, then?: Syn): Syn => ({ k: 'word', hint, then });
const greedy = (hint: string): Syn => ({ k: 'greedy', hint });
const alt = (...options: Syn[]): Syn => ({ k: 'alt', options });
const bool = (then?: Syn): Syn => ({ k: 'bool', then });
const reg = (name: RegName, hint: string, then?: Syn): Syn => ({ k: 'reg', reg: name, hint, then });
const pos = (then?: Syn, hint = 'координата'): Syn => ({ k: 'pos', hint, then });
const xyz = (then?: Syn): Syn => pos(pos(pos(then)));

const SLOTS = [
  'weapon.mainhand', 'weapon.offhand', 'armor.head', 'armor.chest', 'armor.legs', 'armor.feet', 'armor.body',
  'player.cursor', 'horse.saddle', 'horse.armor', 'horse.chest',
  ...Array.from({ length: 36 }, (_, index) => `container.${index}`),
  ...Array.from({ length: 9 }, (_, index) => `hotbar.${index}`),
  ...Array.from({ length: 27 }, (_, index) => `enderchest.${index}`),
  ...Array.from({ length: 4 }, (_, index) => `player.crafting.${index}`),
];
const cmd = (name: string, hint: string, syn?: Syn, aliases?: string[]): ServerCommand => ({ name, hint, syn, aliases });

const refs = new Map<string, Syn>();

function execTree(): Syn {
  const loop: Syn = { k: 'ref', id: 'exec' };
  return alt(
    lit('модификатор', ['as', 'at'], player(loop, 'цель')),
    lit('модификатор', ['summon'], word('сущность', loop)),
    lit('проверка', ['if', 'unless'], lit('тип', ['entity', 'block', 'blocks', 'score', 'data', 'predicate', 'function', 'biome', 'dimension', 'loaded', 'items'], word('условие', loop))),
    lit('модификатор', ['positioned', 'rotated', 'facing', 'align', 'anchored', 'in', 'on'], word('значение', loop)),
    lit('сохранить', ['store'], lit('результат', ['result', 'success'], word('хранилище', loop))),
    lit('действие', ['run'], { k: 'command' }),
  );
}

refs.set('exec', execTree());

const BUILTIN: ServerCommand[] = [
  cmd('advancement', '<grant|revoke> <цели> <only|until|from|through|everything>', alt(
    lit('действие', ['grant', 'revoke'], player(lit('охват', ['only', 'until', 'from', 'through'], word('достижение')), 'цели')),
    lit('действие', ['grant', 'revoke'], player(lit('охват', ['everything']), 'цели')),
  )),
  cmd('attribute', '<цель> <атрибут> <get|base|modifier>', player(reg('attribute', 'атрибут', lit('действие', ['get', 'base', 'modifier'], alt(num('число'), word('параметр')))), 'цель')),
  cmd('ban', '<игроки> [причина]', player(greedy('причина'))),
  cmd('ban-ip', '<адрес> [причина]', word('адрес', greedy('причина'))),
  cmd('banlist', '[ips|players]', lit('список', ['ips', 'players'])),
  cmd('bossbar', '<add|get|list|remove|set>', alt(
    lit('действие', ['add'], word('id', greedy('название'))),
    lit('действие', ['remove', 'get', 'set'], word('id')),
    lit('действие', ['list']),
  )),
  cmd('clear', '[игроки] [предмет] [число]', player(reg('item', 'предмет', num('число')))),
  cmd('clone', '<от> <до> <куда>', xyz(xyz(xyz()))),
  cmd('damage', '<цель> <урон> [тип]', player(num('урон', reg('damage', 'тип урона')), 'цель')),
  cmd('data', '<get|merge|modify|remove>', lit('действие', ['get', 'merge', 'modify', 'remove'], word('источник'))),
  cmd('datapack', '<enable|disable|list>', lit('действие', ['enable', 'disable', 'list'], word('набор'))),
  cmd('debug', '<start|stop|function|status>', lit('действие', ['start', 'stop', 'status', 'function'])),
  cmd('defaultgamemode', '<режим>', lit('режим', MODES)),
  cmd('deop', '<игроки>', player()),
  cmd('dialog', '<show|clear>', lit('действие', ['show', 'clear'], player())),
  cmd('difficulty', '[сложность]', lit('сложность', DIFFICULTIES)),
  cmd('effect', '<give|clear> <цели> <эффект>', alt(
    lit('действие', ['give'], player(reg('effect', 'эффект', num('секунды', num('уровень', bool()))))),
    lit('действие', ['clear'], player(reg('effect', 'эффект'))),
  )),
  cmd('enchant', '<цели> <чары> [уровень]', player(reg('enchant', 'чары', num('уровень')))),
  cmd('execute', '<as|at|if|run…>', { k: 'ref', id: 'exec' }),
  cmd('experience', '<add|set|query> <цели>', alt(
    lit('действие', ['add', 'set'], player(num('количество'))),
    lit('действие', ['query'], player(lit('что', ['points', 'levels']))),
  ), ['xp']),
  cmd('fill', '<от> <до> <блок>', xyz(xyz(reg('block', 'блок')))),
  cmd('fillbiome', '<от> <до> <биом>', xyz(xyz(reg('biome', 'биом')))),
  cmd('forceload', '<add|remove|query>', lit('действие', ['add', 'remove', 'query'], word('чанк'))),
  cmd('function', '<функция>', word('функция')),
  cmd('gamemode', '<режим> [игрок]', lit('режим', MODES, player())),
  cmd('gamerule', '<правило> [значение]', lit('правило', RULES, alt(bool(), num('число')))),
  cmd('give', '<игрок> <предмет> [число]', player(reg('item', 'предмет', num('число')))),
  cmd('help', '[команда]', { k: 'command' }),
  cmd('item', '<replace|modify>', alt(
    lit('действие', ['replace'], alt(
      lit('где', ['entity'], player(reg('slot', 'слот', lit('источник', ['with'], reg('item', 'предмет', num('число')))))),
      lit('где', ['block'], xyz(reg('slot', 'слот', lit('источник', ['with'], reg('item', 'предмет', num('число')))))),
    )),
    lit('действие', ['modify'], alt(
      lit('где', ['entity'], player(reg('slot', 'слот', word('модификатор')))),
      lit('где', ['block'], xyz(reg('slot', 'слот', word('модификатор')))),
    )),
  )),
  cmd('jfr', '<start|stop>', lit('действие', ['start', 'stop'])),
  cmd('kick', '<игроки> [причина]', player(greedy('причина'))),
  cmd('kill', '[цели]', player(undefined, 'цели')),
  cmd('list', '[uuids]', lit('что', ['uuids'])),
  cmd('locate', '<biome|poi|structure> <имя>', alt(
    lit('тип', ['biome'], reg('biome', 'биом')),
    lit('тип', ['structure'], reg('structure', 'структура')),
    lit('тип', ['poi'], word('точка')),
  )),
  cmd('loot', '<give|insert|spawn|replace>', lit('действие', ['give', 'insert', 'spawn', 'replace'], word('куда'))),
  cmd('me', '<действие>', greedy('действие')),
  cmd('msg', '<игрок> <сообщение>', player(greedy('сообщение')), ['tell', 'w']),
  cmd('op', '<игроки>', player()),
  cmd('pardon', '<игроки>', player()),
  cmd('pardon-ip', '<адрес>', word('адрес')),
  cmd('particle', '<частица>', reg('particle', 'частица', xyz())),
  cmd('perf', '<start|stop>', lit('действие', ['start', 'stop'])),
  cmd('place', '<feature|structure|template|jigsaw>', alt(
    lit('что', ['feature'], reg('feature', 'особенность', xyz())),
    lit('что', ['structure'], reg('structure', 'структура', xyz())),
    lit('что', ['template', 'jigsaw'], word('имя', xyz())),
  )),
  cmd('playsound', '<звук> <источник> <игрок>', word('звук', lit('источник', ['master', 'music', 'record', 'weather', 'block', 'hostile', 'neutral', 'player', 'ambient', 'voice'], player()))),
  cmd('random', '<roll|reset|value>', lit('действие', ['roll', 'reset', 'value'], word('последовательность'))),
  cmd('recipe', '<give|take> <игрок>', lit('действие', ['give', 'take'], player(word('рецепт')))),
  cmd('reload', ''),
  cmd('return', '[значение]', num('значение')),
  cmd('ride', '<цель> <mount|dismount>', player(lit('действие', ['mount', 'dismount'], player(undefined, 'транспорт')), 'цель')),
  cmd('rotate', '<цель>', player(word('поворот'), 'цель')),
  cmd('save-all', '[flush]', lit('режим', ['flush'])),
  cmd('save-off', ''),
  cmd('save-on', ''),
  cmd('say', '<сообщение>', greedy('сообщение')),
  cmd('schedule', '<function|clear>', lit('действие', ['function', 'clear'], word('функция', num('тики')))),
  cmd('scoreboard', '<objectives|players>', alt(
    lit('раздел', ['objectives'], lit('действие', ['add', 'remove', 'setdisplay', 'list', 'modify'], word('имя'))),
    lit('раздел', ['players'], lit('действие', ['add', 'remove', 'set', 'get', 'list', 'reset', 'enable', 'operation'], player())),
  )),
  cmd('seed', ''),
  cmd('setblock', '<x> <y> <z> <блок>', xyz(reg('block', 'блок'))),
  cmd('setidletimeout', '<минуты>', num('минуты')),
  cmd('setworldspawn', '[x] [y] [z]', xyz()),
  cmd('spawnpoint', '[игрок] [x] [y] [z]', alt(player(xyz()), xyz())),
  cmd('spectate', '[цель] [игрок]', player(player(), 'цель')),
  cmd('spreadplayers', '<x> <z> <дистанция>', pos(pos(num('дистанция')))),
  cmd('stop', ''),
  cmd('stopsound', '<игрок> [источник] [звук]', player(word('источник'))),
  cmd('summon', '<сущность> [x] [y] [z]', reg('entity', 'сущность', xyz())),
  cmd('tag', '<цели> <add|remove|list>', player(lit('действие', ['add', 'remove', 'list'], word('тег')), 'цели')),
  cmd('team', '<add|remove|join|leave|empty|list|modify>', alt(
    lit('действие', ['add', 'remove', 'empty', 'modify'], word('команда')),
    lit('действие', ['join'], word('команда', player())),
    lit('действие', ['leave'], player()),
    lit('действие', ['list']),
  )),
  cmd('teammsg', '<сообщение>', greedy('сообщение'), ['tm']),
  cmd('teleport', '<цель> [куда]', player(alt(player(undefined, 'куда'), xyz()), 'цель'), ['tp']),
  cmd('tellraw', '<игроки> <json>', player(greedy('json'))),
  cmd('tick', '<query|rate|freeze|step|sprint|unfreeze>', alt(
    lit('действие', ['query', 'freeze', 'unfreeze']),
    lit('действие', ['rate', 'sprint', 'step'], num('значение')),
  )),
  cmd('time', '<set|add|query>', alt(
    lit('действие', ['set'], alt(lit('время', ['day', 'night', 'noon', 'midnight']), num('тики'))),
    lit('действие', ['add'], num('тики')),
    lit('действие', ['query'], lit('что', ['daytime', 'gametime', 'day'])),
  )),
  cmd('title', '<игроки> <title|subtitle|actionbar|clear|reset|times>', player(alt(
    lit('действие', ['clear', 'reset']),
    lit('действие', ['title', 'subtitle', 'actionbar'], greedy('текст')),
    lit('действие', ['times'], num('появление', num('держание', num('затухание')))),
  ))),
  cmd('transfer', '<игрок> <хост> [порт]', player(word('хост', num('порт')))),
  cmd('trigger', '<цель> [add|set] [число]', word('цель', lit('действие', ['add', 'set'], num('число')))),
  cmd('waypoint', '<modify|list>', lit('действие', ['modify', 'list'], word('точка'))),
  cmd('weather', '<clear|rain|thunder> [длительность]', lit('погода', ['clear', 'rain', 'thunder'], num('длительность'))),
  cmd('whitelist', '<add|remove|on|off|list|reload>', alt(
    lit('действие', ['on', 'off', 'list', 'reload']),
    lit('действие', ['add', 'remove'], player()),
  )),
  cmd('worldborder', '<add|set|center|damage|warning|get>', alt(
    lit('действие', ['set', 'add'], num('радиус')),
    lit('действие', ['center'], word('позиция')),
    lit('действие', ['damage', 'warning', 'get'], word('параметр')),
  )),
  cmd('plugins', '', undefined, ['pl', 'bukkit:plugins', 'bukkit:pl']),
  cmd('version', '', undefined, ['ver', 'about', 'bukkit:version', 'bukkit:ver', 'bukkit:about']),
  cmd('restart', 'перезапуск сервера'),
  cmd('tps', 'тики в секунду', undefined, ['paper:tps']),
  cmd('mspt', 'время тика', undefined, ['paper:mspt']),
  cmd('timings', '<on|off|paste|reset|report|ver>', lit('действие', ['on', 'off', 'paste', 'reset', 'report', 'ver', 'cost', 'verbose'])),
  cmd('paper', '<версия|чанки|сущности|отладка>', lit('раздел', ['version', 'chunkinfo', 'entity', 'dumpplugins', 'dumpitem', 'heap', 'mobcaps', 'reload', 'fixlight', 'sync', 'debug'])),
  cmd('spigot', '<restart|reload>', lit('действие', ['restart', 'reload'])),
  cmd('spark', '<profiler|tps|health|ping|gc>', alt(
    lit('раздел', ['profiler'], lit('действие', ['start', 'stop', 'info', 'open', 'cancel'])),
    lit('раздел', ['tps', 'health', 'ping', 'gc', 'tickmonitor', 'heapsummary', 'heapdump']),
  ), ['paper:spark']),
  cmd('tablistping', '<reload|report>', lit('действие', ['reload', 'report']), ['tlp']),
  cmd('panels', '<open|reload|help|data|generate|version>', alt(
    lit('действие', ['reload', 'help', 'version', 'generate']),
    lit('действие', ['open'], word('панель', player())),
    lit('действие', ['data'], player()),
  ), ['pa', 'commandpanels:panels', 'commandpanels:pa']),
  cmd('/undo', '[шаги] [игрок]', num('шаги', player())),
  cmd('/redo', '[шаги] [игрок]', num('шаги', player())),
  cmd('/clearhistory', ''),
  cmd('/wand', ''),
  cmd('/pos1', ''),
  cmd('/pos2', ''),
  cmd('/hpos1', ''),
  cmd('/hpos2', ''),
  cmd('/desel', '', undefined, ['/deselect', '/sel']),
  cmd('/expand', '<блоки> [направление]', num('блоки', word('направление'))),
  cmd('/contract', '<блоки>', num('блоки')),
  cmd('/shift', '<блоки>', num('блоки')),
  cmd('/size', ''),
  cmd('/count', '<маска>', word('маска')),
  cmd('/distr', ''),
  cmd('/copy', ''),
  cmd('/cut', '[маска]', word('маска')),
  cmd('/paste', '[-a] [-o] [-s]', lit('флаг', ['-a', '-o', '-s', '-n'])),
  cmd('/rotate', '<градусы>', num('градусы')),
  cmd('/flip', '[направление]', word('направление')),
  cmd('/stack', '<число>', num('число')),
  cmd('/set', '<узор>', word('узор')),
  cmd('/replace', '<что> <на что>', word('что', word('на что'))),
  cmd('/overlay', '<узор>', word('узор')),
  cmd('/walls', '<узор>', word('узор')),
  cmd('/faces', '<узор>', word('узор')),
  cmd('/center', '<узор>', word('узор')),
  cmd('/line', '<узор>', word('узор')),
  cmd('/sphere', '<узор> <радиус>', word('узор', num('радиус'))),
  cmd('/hsphere', '<узор> <радиус>', word('узор', num('радиус'))),
  cmd('/cyl', '<узор> <радиус> [высота]', word('узор', num('радиус', num('высота')))),
  cmd('/hcyl', '<узор> <радиус> [высота]', word('узор', num('радиус', num('высота')))),
  cmd('/pyramid', '<узор> <размер>', word('узор', num('размер'))),
  cmd('/generate', '<узор> <выражение>', word('узор', greedy('выражение'))),
  cmd('/forestgen', '<размер> <тип> <плотность>', num('размер', word('тип', num('плотность')))),
  cmd('/pumpkins', '<размер>', num('размер')),
  cmd('/schematic', '<save|load|list|delete>', lit('действие', ['save', 'load', 'list', 'delete', 'formats'], word('имя')), ['/schem']),
  cmd('/butcher', '[радиус]', num('радиус')),
  cmd('/remove', '<тип> [радиус]', word('тип', num('радиус'))),
  cmd('/removenear', '<маска> <радиус>', word('маска', num('радиус'))),
  cmd('/replacenear', '<размер> <что> <на что>', num('размер', word('что', word('на что')))),
  cmd('/removeabove', '<размер>', num('размер')),
  cmd('/removebelow', '<размер>', num('размер')),
  cmd('/snow', '[радиус]', num('радиус')),
  cmd('/thaw', '[радиус]', num('радиус')),
  cmd('/green', '[радиус]', num('радиус')),
  cmd('/extinguish', '[радиус]', num('радиус'), ['/ex']),
  cmd('/up', '<блоки>', num('блоки')),
  cmd('/ascend', '[этажи]', num('этажи')),
  cmd('/descend', '[этажи]', num('этажи')),
  cmd('/thru', ''),
  cmd('/ceil', ''),
  cmd('/unstuck', ''),
  cmd('/jumpto', ''),
  cmd('/none', ''),
  cmd('/tool', '<инструмент>', word('инструмент')),
  cmd('/mask', '[маска]', word('маска')),
  cmd('/gmask', '[маска]', word('маска')),
  cmd('/material', '<узор>', word('узор')),
  cmd('/range', '<дистанция>', num('дистанция')),
  cmd('/brush', '<sphere|cylinder|smooth|clipboard>', lit('кисть', ['sphere', 'cylinder', 'smooth', 'clipboard', 'gravity', 'butcher', 'extinguish'], word('узор'))),
  cmd('/worldedit', '<version|reload|help|tz>', lit('действие', ['version', 'reload', 'help', 'tz', 'drawsel'])),
];

const builtins: ServerCommand[] = [];
const seen = new Set<string>();

function pushCommand(row: ServerCommand): void {
  const name = row.name.toLowerCase();
  if (seen.has(name)) return;
  seen.add(name);
  builtins.push({ ...row, name });
  for (const alias of row.aliases || []) {
    const key = alias.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    builtins.push({ name: key, hint: row.hint, syn: row.syn });
  }
}

for (const row of BUILTIN) pushCommand(row);

let jarCommands: ServerCommand[] = [];
let learned: ServerCommand[] = [];

function unwrap(syn: Syn | undefined): Syn | undefined {
  if (!syn || syn.k !== 'ref') return syn;
  return refs.get(syn.id);
}

export function commands(): ServerCommand[] {
  return [...builtins, ...jarCommands, ...learned];
}

export function findCommand(name: string): ServerCommand | undefined {
  const key = name.toLowerCase();
  return commands().find((row) => row.name === key);
}

function usageToSyn(usage: string): Syn | undefined {
  const parts = usage.trim().replace(/^\//, '').split(/\s+/).slice(1).filter(Boolean);
  if (!parts.length) return undefined;
  let node: Syn | undefined;
  for (let i = parts.length - 1; i >= 0; i -= 1) node = usageToken(parts[i], node);
  return node;
}

function usageToken(token: string, then?: Syn): Syn {
  const inner = token.replace(/^[<[]|[>\]]$/g, '');
  if (/player|target|targets|игрок|ник/i.test(inner) && !inner.includes('|')) return player(then);
  if (/^(true\|false|boolean)$/i.test(inner)) return bool(then);
  if (inner.includes('|')) return lit('вариант', inner.split('|').map((part) => part.trim()).filter(Boolean), then);
  if (/count|amount|radius|level|seconds|ticks|duration|distance|page|size|port|number/i.test(inner)) return num(inner, then);
  if (/message|reason|text|json|name/i.test(inner)) return greedy(inner);
  return word(inner || 'аргумент', then);
}

export function setJarCommands(rows: Array<{ name: string; description?: string; usage?: string; aliases?: string[] }>): void {
  const next: ServerCommand[] = [];
  const local = new Set<string>();
  for (const row of rows) {
    const name = row.name.toLowerCase();
    if (!name || builtins.some((row) => row.name === name) || local.has(name)) continue;
    const usage = (row.usage || '').trim();
    const hint = usage || (row.description || '').trim();
    const syn = /[<\[]/.test(usage) ? usageToSyn(usage) : undefined;
    local.add(name);
    next.push({ name, hint, syn });
    for (const alias of row.aliases || []) {
      const key = alias.toLowerCase();
      if (!key || local.has(key) || builtins.some((row) => row.name === key)) continue;
      local.add(key);
      next.push({ name: key, hint, syn });
    }
  }
  jarCommands = next;
}

export function resetLearned(): void {
  learned = [];
}

export function learnHelpCommand(rawName: string, hint: string): void {
  const name = rawName.replace(/^\/+/, (marks) => (marks.length > 1 ? '/' : '')).toLowerCase();
  if (!name || findCommand(name)) return;
  const text = hint.trim();
  const syn = /[<\[]/.test(text) ? usageToSyn(text) : undefined;
  learned.push({ name, hint: text, syn });
  const colon = name.indexOf(':');
  if (colon > 0) learnHelpCommand(name.slice(colon + 1), text);
}

function filterRows(values: string[], partial: string, hint: string): SuggestRow[] {
  const head = partial.toLowerCase();
  return values
    .filter((item) => item.toLowerCase().startsWith(head) && item.toLowerCase() !== head)
    .map((text) => ({ text, hint }));
}

function peopleRows(partial: string, players: SuggestPlayer[]): SuggestRow[] {
  const selectors = filterRows(SELECTORS, partial, 'селектор');
  const names = players
    .filter((row) => row.name.toLowerCase().startsWith(partial.toLowerCase()) && row.name.toLowerCase() !== partial.toLowerCase())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((row) => ({ text: row.name, hint: 'игрок', head: row.head }));
  return [...selectors, ...names];
}

function commandNameRows(partial: string): SuggestRow[] {
  const head = partial.toLowerCase();
  return commands()
    .filter((row) => {
      if (row.name.includes(':') && !head.includes(':')) return false;
      return row.name.startsWith(head) && row.name !== head;
    })
    .map((row) => ({ text: row.name, hint: row.hint }));
}

function dedupe(rows: SuggestRow[]): SuggestRow[] {
  const seenRows = new Set<string>();
  const out: SuggestRow[] = [];
  for (const row of rows) {
    const key = row.text.toLowerCase();
    if (seenRows.has(key)) continue;
    seenRows.add(key);
    out.push(row);
  }
  return out;
}

function score(syn: Syn, word: string, players: SuggestPlayer[]): number {
  const lower = word.toLowerCase();
  if (syn.k === 'lit') return syn.values.some((item) => item.toLowerCase() === lower) ? 5 : -1;
  if (syn.k === 'bool') return lower === 'true' || lower === 'false' ? 5 : -1;
  if (syn.k === 'num') return /^-?\d+(\.\d+)?$/.test(word) ? 4 : -1;
  if (syn.k === 'player') {
    if (/^(~|\^)/.test(word)) return -1;
    if (SELECTORS.includes(lower) || players.some((row) => row.name.toLowerCase() === lower) || word.startsWith('@')) return 4;
    return 0;
  }
  if (syn.k === 'reg') return 1;
  if (syn.k === 'pos') return /^(~|\^|-?\d)/.test(word) ? 4 : -1;
  if (syn.k === 'word' || syn.k === 'greedy' || syn.k === 'command') return 1;
  return -1;
}

function step(syn: Syn | undefined, word: string, players: SuggestPlayer[]): Syn | undefined {
  const node = unwrap(syn);
  if (!node) return undefined;
  if (node.k === 'alt') {
    let best: Syn | undefined;
    let bestScore = -1;
    for (const option of node.options) {
      const rank = score(unwrap(option) || option, word, players);
      if (rank > bestScore) {
        bestScore = rank;
        best = option;
      }
    }
    if (bestScore < 0 || !best) return undefined;
    return step(best, word, players);
  }
  if (node.k === 'command') return findCommand(word)?.syn;
  if (score(node, word, players) < 0) return undefined;
  if (node.k === 'greedy') return undefined;
  if (node.k === 'ref') return undefined;
  return node.then;
}

function idMatchesPartial(id: string, partial: string): boolean {
  const head = partial.toLowerCase();
  const full = id.toLowerCase();
  const path = full.slice(full.indexOf(':') + 1);
  if (!head) return true;
  if (full === head || path === head) return false;
  return full.startsWith(head) || path.startsWith(head);
}

function registryRows(name: RegName, partial: string, regs: Registries, labels: Record<string, string>, hint: string): SuggestRow[] {
  const source = name === 'slot' ? SLOTS : (regs[name] || []);
  const head = partial.toLowerCase();
  return source
    .filter((id) => idMatchesPartial(id, partial))
    .sort((a, b) => {
      const path = (id: string) => id.slice(id.indexOf(':') + 1).toLowerCase();
      const rank = (id: string) => (path(id).startsWith(head) ? 0 : 1);
      return rank(a) - rank(b) || path(a).localeCompare(path(b));
    })
    .map((id) => ({
      text: id,
      hint: labels[id] || hint,
      icon: name === 'item' || name === 'block' ? id : undefined,
    }));
}

function slotRows(syn: Syn | undefined, partial: string, players: SuggestPlayer[], regs: Registries, labels: Record<string, string>): SuggestRow[] {
  const node = unwrap(syn);
  if (!node) return [];
  if (node.k === 'alt') {
    const head: SuggestRow[] = [];
    const tail: SuggestRow[] = [];
    for (const option of node.options) {
      for (const row of slotRows(option, partial, players, regs, labels)) {
        if (row.head || row.hint === 'игрок' || row.hint === 'селектор') tail.push(row);
        else head.push(row);
      }
    }
    return dedupe([...head, ...tail]);
  }
  if (node.k === 'reg') return registryRows(node.reg, partial, regs, labels, node.hint);
  if (node.k === 'pos') return filterRows(['~', '^'], partial, node.hint);
  if (node.k === 'lit') return filterRows(node.values, partial, node.hint);
  if (node.k === 'player') return peopleRows(partial, players);
  if (node.k === 'bool') return filterRows(['true', 'false'], partial, 'значение');
  if (node.k === 'command') return commandNameRows(partial);
  return [];
}

export function suggestFor(raw: string, players: SuggestPlayer[], regs: Registries = EMPTY_REGS, labels: Record<string, string> = {}): SuggestRow[] {
  const { words, partial } = splitCommand(raw);
  if (!words.length) return commandNameRows(partial);
  const command = findCommand(words[0]);
  if (!command) return [];
  let node = command.syn;
  for (const word of words.slice(1)) node = step(node, word, players);
  return slotRows(node, partial, players, regs, labels);
}

export function tokenClass(commandName: string, prev: string[], word: string, players: SuggestPlayer[], regs: Registries = EMPTY_REGS): string {
  const command = findCommand(commandName);
  if (!command) return 'is-text';
  let node = command.syn;
  for (const done of prev) node = step(node, done, players);
  const current = unwrap(node);
  if (!current) return 'is-text';
  if (current.k === 'alt') {
    const ranks = current.options.map((option) => tokenClassNode(unwrap(option) || option, word, players, regs));
    if (ranks.includes('is-player')) return 'is-player';
    if (ranks.includes('is-ok')) return 'is-ok';
    if (ranks.includes('is-num')) return 'is-num';
    if (ranks.includes('is-text')) return 'is-text';
    return 'is-bad';
  }
  return tokenClassNode(current, word, players, regs);
}

function registryHas(syn: Syn, word: string, regs: Registries): boolean {
  if (syn.k !== 'reg') return false;
  const source = syn.reg === 'slot' ? SLOTS : (regs[syn.reg] || []);
  if (!source.length) return false;
  const lower = word.toLowerCase();
  return source.some((id) => {
    const full = id.toLowerCase();
    const path = full.slice(full.indexOf(':') + 1);
    return full === lower || path === lower || full.startsWith(lower) || path.startsWith(lower);
  });
}

function tokenClassNode(syn: Syn, word: string, players: SuggestPlayer[], regs: Registries): string {
  const lower = word.toLowerCase();
  if (syn.k === 'player') {
    if (SELECTORS.includes(lower) || players.some((row) => row.name.toLowerCase() === lower) || word.startsWith('@')) return 'is-player';
    if (players.some((row) => row.name.toLowerCase().startsWith(lower))) return 'is-player';
    return 'is-text';
  }
  if (syn.k === 'lit') {
    if (syn.values.some((item) => item.toLowerCase() === lower)) return 'is-ok';
    if (syn.values.some((item) => item.toLowerCase().startsWith(lower))) return 'is-text';
    return 'is-bad';
  }
  if (syn.k === 'bool') {
    if (lower === 'true' || lower === 'false') return 'is-ok';
    if ('true'.startsWith(lower) || 'false'.startsWith(lower)) return 'is-text';
    return 'is-bad';
  }
  if (syn.k === 'num') return /^-?\d+(\.\d+)?$/.test(word) ? 'is-num' : 'is-bad';
  if (syn.k === 'pos') return /^(~|\^|-?\d)/.test(word) ? 'is-num' : 'is-bad';
  if (syn.k === 'reg') {
    const source = syn.reg === 'slot' ? SLOTS : (regs[syn.reg] || []);
    if (!source.length) return 'is-text';
    if (registryHas(syn, word, regs)) return source.some((id) => id.toLowerCase() === lower || id.slice(id.indexOf(':') + 1).toLowerCase() === lower) ? 'is-ok' : 'is-text';
    return 'is-bad';
  }
  if (syn.k === 'command') return findCommand(word) ? 'is-cmd' : (knownCommand(word) ? 'is-cmd' : 'is-bad');
  return 'is-text';
}

export function splitCommand(raw: string): { slash: boolean; words: string[]; partial: string } {
  let body = raw;
  let slash = false;
  if (body.startsWith('//')) body = body.slice(1);
  else if (body.startsWith('/')) {
    slash = true;
    body = body.slice(1);
  }
  const trailing = /\s$/.test(body);
  const words = body.trim().split(/\s+/).filter(Boolean);
  const partial = trailing || !words.length ? '' : words[words.length - 1];
  return { slash, words: trailing ? words : words.slice(0, -1), partial };
}

export function knownCommand(name: string): boolean {
  const key = name.toLowerCase();
  return commands().some((row) => row.name === key || row.name.startsWith(key));
}
