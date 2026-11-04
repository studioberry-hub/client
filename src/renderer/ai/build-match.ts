// Сопоставление просьбы пользователя с уже установленными сборками.
// «Запусти его сборку Fabulously Optimized 26.3» должно попасть в существующую
// сборку: местоимения не часть имени, а 26.3 может быть версией модпака.

export type MatchableBuild = {
  id: string;
  name: string;
  gameVersion?: string;
  version?: string;
  loader?: string;
  loaderVersion?: string;
  modpackVersion?: string;
};

const STOP_WORDS = new Set([
  'запусти',
  'запустить',
  'запустил',
  'запуск',
  'создай',
  'создайте',
  'создать',
  'сборку',
  'сборка',
  'сборки',
  'сборок',
  'она',
  'он',
  'оно',
  'её',
  'ее',
  'его',
  'ему',
  'им',
  'их',
  'свою',
  'свой',
  'свои',
  'своей',
  'своего',
  'своему',
  'мой',
  'моя',
  'мое',
  'моё',
  'мою',
  'мои',
  'мне',
  'тебе',
  'тебя',
  'уже',
  'есть',
  'установлена',
  'установлен',
  'установлено',
  'клиенте',
  'лаунчере',
  'пожалуйста',
  'плиз',
  'игру',
  'игра',
  'майн',
  'майнкрафт',
  'minecraft',
  'надо',
  'хочу',
  'открой',
  'открыть',
  'новую',
  'новый',
  'эта',
  'эту',
  'этот',
  'это',
  'эти',
  'этой',
  'того',
  'ту',
  'та',
  'модпак',
  'модпака',
  'модпаке',
  'версию',
  'версия',
  'версии',
  'версией',
  'указанной',
  'указанную',
  'указанная',
  'именно',
  'конкретно',
  'просто',
  'можешь',
  'давай',
  'ну',
  'вот',
  'the',
  'my',
  'this',
  'that',
  'his',
  'her',
  'its',
  'please',
  'launch',
  'start',
  'run',
  'play',
  'open',
]);

const LOADERS = new Set(['forge', 'fabric', 'quilt', 'neoforge', 'vanilla']);

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-z0-9а-я.+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function versionIn(hay: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 26.3 совпадает и с 26.3, и с 26.3.1
  return new RegExp(`(^|[^\\d.])${escaped}(?:\\.\\d+)?([^\\d.]|$)`).test(hay);
}

const LAUNCH_WORD_RE = /^(?:запуск\w*|запусти\w*|стартан\w*|стартуй\w*|launch\w*|start|run|play)$/i;

// \b не видит кириллицу: «запусти» в начале строки иначе не считается просьбой о запуске.
const EDGE = '[^a-zа-яё0-9]';

export function isLaunchRequest(text: string): boolean {
  return new RegExp(`(?:^|${EDGE})(?:запуск\\w*|запусти\\w*|стартан\\w*|стартуй\\w*|launch\\w*|start|run|play)(?:$|${EDGE})`, 'i').test(
    text || '',
  );
}

/** «Запусти последнюю сборку, на которой я играл» — без имени и версии. */
export function isLastPlayedRequest(text: string): boolean {
  const raw = (text || '').toLowerCase().replace(/ё/g, 'е');
  return /последн[а-я]*\s+сборк|последн[а-я]*\s+запуск|на\s+которо[а-я]*\s+(?:я\s+)?играл|недавн[а-я]*\s+сборк|прошл[а-я]*\s+сборк|last\s+(?:played\s+)?(?:build|instance)/i.test(
    raw,
  );
}

export function isCreateRequest(text: string): boolean {
  return new RegExp(
    `(?:^|${EDGE})(?:создай(?:те)?|создать|новую\\s+сборк\\w*|установ(?:и|ить)\\s+сборк\\w*|create\\s+(?:a\\s+)?(?:new\\s+)?(?:build|instance|modpack))(?:$|${EDGE})`,
    'i',
  ).test(text || '');
}

export function formatBuildChoice(build: MatchableBuild): string {
  const version = build.gameVersion || build.version || '?';
  const loader = build.loader || 'vanilla';
  const pack = build.modpackVersion ? ` · модпак ${build.modpackVersion}` : '';
  return `${build.name} (${version} · ${loader}${pack})`;
}

function buildHay(build: MatchableBuild): string {
  return normalize(
    [build.name, build.gameVersion, build.version, build.loader, build.loaderVersion, build.modpackVersion]
      .filter(Boolean)
      .join(' '),
  );
}

type QueryParts = {
  versions: string[];
  loaders: string[];
  nameWords: string[];
};

function queryParts(query: string): QueryParts {
  const normalized = normalize(query || '');
  const versions = normalized.match(/\d+(?:\.\d+)+/g) || [];
  const words = normalized
    .split(' ')
    .map((word) => word.replace(/^\.+|\.+$/g, ''))
    .filter(Boolean);
  const loaders = words.filter((word) => LOADERS.has(word));
  const nameWords = words.filter(
    (word) =>
      !STOP_WORDS.has(word) &&
      !LOADERS.has(word) &&
      !/^\d+(?:\.\d+)+$/.test(word) &&
      !LAUNCH_WORD_RE.test(word) &&
      word.length > 1,
  );
  return { versions, loaders, nameWords };
}

/** Слова запроса, которые реально встречаются в именах сборок. «его» и прочий шум отбрасываются. */
function salientNameWords(nameWords: string[], builds: MatchableBuild[]): string[] {
  return nameWords.filter((word) => builds.some((build) => normalize(build.name || '').includes(word)));
}

function passes(
  build: MatchableBuild,
  parts: QueryParts,
  salient: string[],
  requireVersion: boolean,
): boolean {
  const name = normalize(build.name || '');
  const hay = buildHay(build);
  if (requireVersion && parts.versions.length && !parts.versions.every((token) => versionIn(hay, token))) return false;
  if (parts.loaders.length && !parts.loaders.every((loader) => (build.loader || '').toLowerCase() === loader)) return false;
  if (salient.length && !salient.every((word) => name.includes(word))) return false;
  if (!salient.length && !parts.versions.length && !parts.loaders.length) return false;
  if (parts.nameWords.length && !salient.length) return false;
  return true;
}

/** Все сборки, которые однозначно подходят под имя, версию MC, лоадер и версию модпака. */
export function matchInstalledBuilds<T extends MatchableBuild>(query: string, builds: T[]): T[] {
  const parts = queryParts(query);
  if (!parts.nameWords.length && !parts.versions.length && !parts.loaders.length) return [];
  const salient = salientNameWords(parts.nameWords, builds);
  return builds.filter((build) => passes(build, parts, salient, true));
}

/** То же имя без фильтра версии — чтобы показать соседние версии, а не сказать «сборки нет». */
export function matchBuildsByName<T extends MatchableBuild>(query: string, builds: T[]): T[] {
  const parts = queryParts(query);
  const salient = salientNameWords(parts.nameWords, builds);
  if (!salient.length) return [];
  return builds.filter((build) => passes(build, parts, salient, false));
}

/**
 * Прямое совпадение, а если просьба — «запусти её» без имени,
 * берёт последнюю однозначно названную сборку из недавнего контекста.
 */
export function resolveLaunchBuilds<T extends MatchableBuild>(query: string, context: string, builds: T[]): T[] {
  const direct = matchInstalledBuilds(query, builds);
  if (direct.length) return direct;
  if (!isLaunchRequest(query) || isCreateRequest(query)) return [];
  const asked = queryParts(query);
  const salient = salientNameWords(asked.nameWords, builds);
  if (salient.length || asked.versions.length) return [];
  const lines = String(context || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const hit = matchInstalledBuilds(lines[i], builds);
    if (hit.length === 1) return hit;
  }
  return [];
}
