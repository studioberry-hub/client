// Разбор и валидация deep link'ов `uclient://` и подбор данных Modrinth для
// установки контента. Ссылку может сформировать любой сайт, поэтому её содержимое
// считается недоверенным вводом: каждый параметр проверяется по белому списку,
// длина ограничена, лишние параметры игнорируются.

import { getApiBase, absoluteApiUrl } from '../shared/apiBase';

export const DEEP_LINK_SCHEME = 'uclient';

// ===== Ограничения недоверенного ввода =====

/** Ссылка целиком: отсекает попытки передать «мусор» гигантским аргументом. */
const MAX_URL_LENGTH = 2048;
/** Отображаемое название: идёт только в интерфейс. */
const MAX_NAME_LENGTH = 120;
const MAX_PROJECT_LENGTH = 64;
const MAX_VERSION_LENGTH = 32;
const MAX_GAME_VERSION_LENGTH = 32;

/** Типы контента, которые ставятся в клиент. Плагинов здесь нет — они для сервера. */
const ALLOWED_TYPES = ['mod', 'modpack', 'datapack', 'resourcepack', 'shader'] as const;
export type DeepLinkContentType = (typeof ALLOWED_TYPES)[number];

/** Загрузчики, которые понимает лаунчер; всё остальное трактуем как «не задан». */
const ALLOWED_LOADERS = ['vanilla', 'fabric', 'forge', 'neoforge', 'quilt'];

/** Slug или id проекта Modrinth. Запрещены слэши, `%`, `?`, `#` и пробелы. */
const PROJECT_RE = /^[A-Za-z0-9_.+!'()-]{1,64}$/;
/** Id CurseForge в каталоге: `cf:238222`. */
const CF_PROJECT_RE = /^cf:\d{1,12}$/i;
/** Идентификатор версии Modrinth — base62; у CF — числовой fileId. */
const VERSION_RE = /^[A-Za-z0-9]{1,32}$/;
/** Версия игры: `1.20.1`, `24w14a`, `1.21-pre1`. */
const GAME_VERSION_RE = /^[A-Za-z0-9_.-]{1,32}$/;

export interface DeepLinkInstall {
  action: 'install';
  source: 'modrinth' | 'curseforge';
  type: DeepLinkContentType;
  project: string;
  /** Пустая строка означает «поставить последнюю подходящую версию». */
  version: string;
  name: string;
  gameVersion: string;
  loader: string;
}

/** Импорт пользовательской сборки по id шара на сайте. */
export interface DeepLinkImportInstance {
  action: 'import-instance';
  id: string;
}

/** Вступление в группу мессенджера по токену приглашения. */
export interface DeepLinkJoinGroup {
  action: 'join-group';
  token: string;
}

export type DeepLinkPayload = DeepLinkInstall | DeepLinkImportInstance | DeepLinkJoinGroup;

/** Причина отказа — только для лога: пользователю о чужих ссылках сообщать нечего. */
export type DeepLinkRejectReason =
  | 'empty'
  | 'too_long'
  | 'bad_scheme'
  | 'malformed'
  | 'unknown_action'
  | 'unsupported_source'
  | 'unsupported_type'
  | 'bad_project'
  | 'bad_version'
  | 'bad_share_id'
  | 'bad_invite_token';

export type DeepLinkParseResult =
  | { ok: true; payload: DeepLinkPayload }
  | { ok: false; reason: DeepLinkRejectReason };

// ===== Валидация параметров =====

/** Убирает управляющие символы и лишние пробелы: строка попадёт в интерфейс. */
function sanitizeName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_LENGTH);
}

function readStr(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const s = value.trim();
  return s.length > max ? '' : s;
}

/**
 * Общая проверка набора параметров установки. Используется и при разборе ссылки,
 * и при приёме задачи из рендерера: доверять уже проверенным данным повторно нельзя.
 */
export function validateInstallParams(get: (key: string) => unknown): DeepLinkParseResult {
  const source = readStr(get('source'), 32).toLowerCase();
  if (source !== 'modrinth' && source !== 'curseforge') {
    return { ok: false, reason: 'unsupported_source' };
  }

  const type = readStr(get('type'), 32).toLowerCase();
  if (!(ALLOWED_TYPES as readonly string[]).includes(type)) {
    return { ok: false, reason: 'unsupported_type' };
  }

  const project = readStr(get('project'), MAX_PROJECT_LENGTH);
  const projectOk =
    source === 'curseforge' ? CF_PROJECT_RE.test(project) : PROJECT_RE.test(project);
  if (!projectOk) return { ok: false, reason: 'bad_project' };

  // Версия необязательна, но если она передана — молча подменять её на «последнюю»
  // нельзя: пользователь ждёт именно ту версию, что была на сайте.
  const versionRaw = typeof get('version') === 'string' ? String(get('version')).trim() : '';
  if (versionRaw && (versionRaw.length > MAX_VERSION_LENGTH || !VERSION_RE.test(versionRaw))) {
    return { ok: false, reason: 'bad_version' };
  }
  const version = versionRaw;

  // Необязательные подсказки для подбора версии: неверное значение просто игнорируем.
  const gameVersionRaw = readStr(get('gameVersion'), MAX_GAME_VERSION_LENGTH);
  const gameVersion = GAME_VERSION_RE.test(gameVersionRaw) ? gameVersionRaw : '';
  const loaderRaw = readStr(get('loader'), 32).toLowerCase();
  const loader = ALLOWED_LOADERS.includes(loaderRaw) ? loaderRaw : '';

  return {
    ok: true,
    payload: {
      action: 'install',
      source: source as 'modrinth' | 'curseforge',
      type: type as DeepLinkContentType,
      project,
      version,
      name: sanitizeName(get('name')),
      gameVersion,
      loader,
    },
  };
}

/** Id шара: тот же формат, что в shared/instanceShare (без импорта цикла). */
const SHARE_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

function validateImportInstanceParams(get: (key: string) => unknown): DeepLinkParseResult {
  const id = readStr(get('id'), 64);
  if (!SHARE_ID_RE.test(id)) return { ok: false, reason: 'bad_share_id' };
  return { ok: true, payload: { action: 'import-instance', id } };
}

function validateJoinGroupParams(get: (key: string) => unknown): DeepLinkParseResult {
  const token = readStr(get('token'), 64);
  if (!SHARE_ID_RE.test(token)) return { ok: false, reason: 'bad_invite_token' };
  return { ok: true, payload: { action: 'join-group', token } };
}

/** Разбор ссылки вида `uclient://install?...` или `uclient://import-instance?id=...`. */
export function parseDeepLink(raw: unknown): DeepLinkParseResult {
  if (typeof raw !== 'string') return { ok: false, reason: 'empty' };
  const text = raw.trim().replace(/^"+|"+$/g, '').trim();
  if (!text) return { ok: false, reason: 'empty' };
  if (text.length > MAX_URL_LENGTH) return { ok: false, reason: 'too_long' };
  if (!new RegExp(`^${DEEP_LINK_SCHEME}://`, 'i').test(text)) return { ok: false, reason: 'bad_scheme' };

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (url.protocol !== `${DEEP_LINK_SCHEME}:`) return { ok: false, reason: 'bad_scheme' };

  // Действие задаётся хостом. У нестандартных схем хост не приводится к нижнему
  // регистру автоматически, поэтому делаем это сами. Windows иногда добавляет
  // завершающий слэш — пустой путь и '/' допустимы, остальное отбрасываем.
  const action = url.hostname.toLowerCase();
  if (url.pathname.replace(/\/+/g, '')) return { ok: false, reason: 'unknown_action' };

  if (action === 'install') {
    return validateInstallParams((key) => url.searchParams.get(key));
  }
  if (action === 'import-instance') {
    return validateImportInstanceParams((key) => url.searchParams.get(key));
  }
  if (action === 'join-group') {
    return validateJoinGroupParams((key) => url.searchParams.get(key));
  }
  return { ok: false, reason: 'unknown_action' };
}

/** Повторная валидация задачи, пришедшей из рендерера через IPC. */
export function validateInstallPayload(raw: unknown): DeepLinkParseResult {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'malformed' };
  const obj = raw as Record<string, unknown>;
  if (obj.action !== 'install') return { ok: false, reason: 'unknown_action' };
  return validateInstallParams((key) => obj[key]);
}

export function validateImportInstancePayload(raw: unknown): DeepLinkParseResult {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'malformed' };
  const obj = raw as Record<string, unknown>;
  if (obj.action !== 'import-instance') return { ok: false, reason: 'unknown_action' };
  return validateImportInstanceParams((key) => obj[key]);
}

/** Первая ссылка `uclient://` среди аргументов процесса. */
export function findDeepLinkInArgv(argv: readonly unknown[]): string {
  const prefix = new RegExp(`^${DEEP_LINK_SCHEME}://`, 'i');
  for (const arg of argv) {
    if (typeof arg !== 'string') continue;
    const candidate = arg.trim().replace(/^"+|"+$/g, '').trim();
    if (prefix.test(candidate)) return candidate;
  }
  return '';
}

// ===== Подбор проекта и версий на Modrinth =====

const MODRINTH_API = 'https://api.modrinth.com/v2';
const API_TIMEOUT_MS = 15000;

/** Наш роут версий отдаёт не больше 50 записей за запрос. */
const VERSIONS_PAGE_SIZE = 50;
/** Больше версий в окне подтверждения показывать нет смысла. */
const MAX_VERSIONS = 200;

export interface DeepLinkVersion {
  id: string;
  name: string;
  versionNumber: string;
  versionType: string;
  gameVersions: string[];
  loaders: string[];
  datePublished: string;
  filename: string;
  size: number;
}

export interface DeepLinkProject {
  id: string;
  slug: string;
  title: string;
  description: string;
  iconUrl: string;
  projectType: string;
}

/** Коды ошибок разбираются в рендерере в человекочитаемые сообщения. */
export type DeepLinkResolveError =
  | 'bad_link'
  | 'network'
  | 'not_found'
  | 'type_mismatch'
  | 'no_versions'
  | 'version_not_found';

export type DeepLinkResolveResult =
  | { ok: true; project: DeepLinkProject; versions: DeepLinkVersion[]; versionId: string }
  | { ok: false; code: DeepLinkResolveError; actualType?: string };

type ApiResult = { ok: true; data: any } | { ok: false; code: 'network' | 'not_found' };

async function getJson(url: string): Promise<ApiResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Undefined-Client', Accept: 'application/json' },
      signal: ctrl.signal,
    });
    // 404 отличаем от прочих ошибок: «проекта нет» — это ответ по существу,
    // и повторять запрос куда-либо ещё бессмысленно.
    if (res.status === 404) return { ok: false, code: 'not_found' };
    if (!res.ok) return { ok: false, code: 'network' };
    return { ok: true, data: await res.json() };
  } catch {
    return { ok: false, code: 'network' };
  } finally {
    clearTimeout(timer);
  }
}

/** Запрос к каталогу нашего сервера. */
function catalogGet(pathname: string): Promise<ApiResult> {
  return getJson(`${getApiBase()}/api/catalog${pathname}`);
}

/** Прямой запрос к API Modrinth — резервный путь. */
function modrinthGet(pathname: string): Promise<ApiResult> {
  return getJson(`${MODRINTH_API}${pathname}`);
}

/**
 * Modrinth в v2 отдаёт для дата-паков `project_type: 'mod'` (дата-пак там оформлен
 * как загрузчик, а не как отдельный тип проекта), хотя в поиске тип уже 'datapack'.
 * Поэтому тип из ссылки сверяем с допуском.
 */
function typeMatches(linkType: DeepLinkContentType, projectType: string): boolean {
  if (linkType === projectType) return true;
  return linkType === 'datapack' && projectType === 'mod';
}

/** Версия в ответе Modrinth: файлы лежат массивом, нужен основной. */
function toVersionLite(v: any): DeepLinkVersion {
  const file = Array.isArray(v?.files) ? (v.files.find((f: any) => f?.primary) || v.files[0]) : null;
  return {
    id: String(v?.id || ''),
    name: String(v?.name || ''),
    versionNumber: String(v?.version_number || ''),
    versionType: String(v?.version_type || ''),
    gameVersions: Array.isArray(v?.game_versions) ? v.game_versions.map(String) : [],
    loaders: Array.isArray(v?.loaders) ? v.loaders.map(String) : [],
    datePublished: String(v?.date_published || ''),
    filename: String(file?.filename || ''),
    size: Number(file?.size) || 0,
  };
}

/** Версия в ответе нашего сервера: основной файл уже выбран и лежит в `file`. */
function toVersionLiteProxied(v: any): DeepLinkVersion {
  return {
    id: String(v?.id || ''),
    name: String(v?.name || ''),
    versionNumber: String(v?.version_number || ''),
    versionType: String(v?.version_type || ''),
    gameVersions: Array.isArray(v?.game_versions) ? v.game_versions.map(String) : [],
    loaders: Array.isArray(v?.loaders) ? v.loaders.map(String) : [],
    datePublished: String(v?.date_published || ''),
    filename: String(v?.file?.filename || ''),
    size: Number(v?.file?.size) || 0,
  };
}

function toProject(raw: any, payload: DeepLinkInstall, iconUrl: string): DeepLinkProject {
  return {
    id: String(raw?.id || ''),
    slug: String(raw?.slug || payload.project),
    title: String(raw?.title || payload.name || payload.project),
    description: String(raw?.description || ''),
    iconUrl,
    projectType: String(raw?.project_type || ''),
  };
}

/**
 * Проект: сначала наш сервер, при его недоступности — Modrinth напрямую
 * (только для source=modrinth; CurseForge без ключа на клиенте недоступен).
 * `not_found` считаем окончательным ответом и резервный путь не пробуем.
 */
async function loadProject(
  payload: DeepLinkInstall,
): Promise<{ ok: true; project: DeepLinkProject } | { ok: false; code: 'network' | 'not_found' }> {
  const slug = encodeURIComponent(payload.project);

  const viaProxy = await catalogGet(`/project/${slug}`);
  if (viaProxy.ok) {
    const raw = viaProxy.data?.project;
    // Сервер уже подменил ссылку на иконку своим прокси, но отдал её
    // относительным путём — в лаунчере нет страницы, чтобы его разрешить.
    return { ok: true, project: toProject(raw, payload, absoluteApiUrl(raw?.icon_url)) };
  }
  if (viaProxy.code === 'not_found') return { ok: false, code: 'not_found' };

  if (payload.source === 'curseforge') return { ok: false, code: 'network' };

  const direct = await modrinthGet(`/project/${slug}`);
  if (!direct.ok) return { ok: false, code: direct.code };
  return { ok: true, project: toProject(direct.data, payload, String(direct.data?.icon_url || '')) };
}

/**
 * Версии проекта. Наш роут отдаёт их страницами по 50 и в поле `total`
 * сообщает общее количество, поэтому листаем до конца или до разумного предела.
 */
async function loadVersions(
  payload: DeepLinkInstall,
): Promise<{ ok: true; versions: DeepLinkVersion[] } | { ok: false; code: 'network' | 'not_found' }> {
  const slug = encodeURIComponent(payload.project);
  const collected: DeepLinkVersion[] = [];

  for (let offset = 0; offset < MAX_VERSIONS; offset += VERSIONS_PAGE_SIZE) {
    const page = await catalogGet(`/project/${slug}/versions?limit=${VERSIONS_PAGE_SIZE}&offset=${offset}`);
    if (!page.ok) {
      // Первая же страница не пришла — уходим на прямой API. Если оборвалось
      // на середине списка, довольствуемся тем, что успели получить: сервер
      // жив, и повторять всё через заблокированный CDN смысла нет.
      if (offset === 0) break;
      return { ok: true, versions: collected };
    }
    const list = Array.isArray(page.data?.versions) ? page.data.versions : [];
    collected.push(...list.map(toVersionLiteProxied));
    const total = Number(page.data?.total) || collected.length;
    if (list.length === 0 || collected.length >= total) {
      return { ok: true, versions: collected };
    }
  }
  if (collected.length > 0) return { ok: true, versions: collected };

  if (payload.source === 'curseforge') return { ok: false, code: 'network' };

  const direct = await modrinthGet(`/project/${slug}/version`);
  if (!direct.ok) return { ok: false, code: direct.code };
  const list = Array.isArray(direct.data) ? direct.data : [];
  return { ok: true, versions: list.map(toVersionLite) };
}

/**
 * Загружает проект и список его версий. Скачиванием не занимается — установка
 * идёт через существующие обработчики `launcher:install-mod` и `modrinth:download`.
 */
export async function resolveDeepLinkTarget(payload: DeepLinkInstall): Promise<DeepLinkResolveResult> {
  const projectRes = await loadProject(payload);
  if (!projectRes.ok) return { ok: false, code: projectRes.code };

  const project = projectRes.project;
  if (!typeMatches(payload.type, project.projectType)) {
    return { ok: false, code: 'type_mismatch', actualType: project.projectType };
  }

  const versionsRes = await loadVersions(payload);
  if (!versionsRes.ok) return { ok: false, code: versionsRes.code };

  const versions = versionsRes.versions
    .filter((v) => v.id && v.filename)
    .sort((a, b) => (a.datePublished < b.datePublished ? 1 : a.datePublished > b.datePublished ? -1 : 0));
  if (versions.length === 0) return { ok: false, code: 'no_versions' };

  // Явно указанную версию проверяем по списку проекта: чужой id ставить нельзя.
  if (payload.version && !versions.some((v) => v.id === payload.version)) {
    return { ok: false, code: 'version_not_found' };
  }

  return { ok: true, project, versions, versionId: payload.version };
}
