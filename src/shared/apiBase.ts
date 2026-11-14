// Назначение: единый источник базового адреса нашего сервера (сайт лаунчера) и
// построение адресов прокси каталога Modrinth. Модуль общий для main-процесса,
// preload и рендерера, поэтому не использует ни Node, ни Electron API.

// ===== Базовый адрес =====

/** Прод-адрес API лаунчера. Все остальные адреса строятся от него. */
export const DEFAULT_API_BASE = 'https://uprojects.site/client';

/** Два входа одного сайта: Москва и Германия. */
export const API_EDGE_MSK = DEFAULT_API_BASE;
export const API_EDGE_EU = 'https://eu.uprojects.site/client';

let apiBase = DEFAULT_API_BASE;

const API_EDGES = [API_EDGE_MSK, API_EDGE_EU];

/** Второй вход того же сайта. Для локальной отладки запасного адреса нет. */
export function otherApiBase(base = apiBase): string | null {
  const current = String(base || '').trim().replace(/\/+$/, '');
  if (!API_EDGES.includes(current)) return null;
  return API_EDGES.find((item) => item !== current) || null;
}

/**
 * Задаёт базовый адрес. В main и preload значение берётся из окружения
 * (UC_API_BASE / UC_NEWS_API_BASE) — это нужно для отладки против локально
 * поднятого сайта. Рендерер до process.env не дотягивается, поэтому получает
 * готовое значение из preload.
 */
export function setApiBase(value: string | null | undefined): void {
  const text = String(value ?? '').trim().replace(/\/+$/, '');
  if (!text) return;
  apiBase = text;
}

export function getApiBase(): string {
  return apiBase;
}

/** Метаданные последнего релиза (версия, URL exe/zip на зеркале). */
export function releaseLatestUrl(): string {
  return `${apiBase}/api/release/latest`;
}

/** Прямая раздача zip-клиента с сайта (инсталлер / updater). */
export function releaseZipDirectUrl(): string {
  return `${apiBase}/api/download/zip`;
}

/**
 * Делает адрес абсолютным. Сервер отдаёт в JSON относительные ссылки на свои
 * же роуты (`/client/api/catalog/image?...`), а в лаунчере нет страницы,
 * относительно которой их можно было бы разрешить.
 */
export function absoluteApiUrl(pathOrUrl: string | null | undefined): string {
  const text = String(pathOrUrl ?? '').trim();
  if (!text) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return text;
  try {
    return new URL(text, apiBase).toString();
  } catch {
    return text;
  }
}

// ===== Прокси каталога (Modrinth + CurseForge CDN) =====

/** Хосты, которые принимает прокси файлов/картинок на сервере. */
const CATALOG_CDN_HOSTS = new Set([
  'cdn.modrinth.com',
  'media.forgecdn.net',
  'mediafilez.forgecdn.net',
  'edge.forgecdn.net',
  'www.curseforge.com',
]);

/** Причина загрузки: сервер передаёт её в Modrinth для статистики авторов. */
export type DownloadReason = 'standalone' | 'dependency' | 'modpack' | 'update';

export type CatalogSource = 'both' | 'modrinth' | 'curseforge';

/** true, если id проекта — CurseForge (`cf:12345`). */
export function isCurseForgeProjectId(id: string | null | undefined): boolean {
  return /^cf:\d+$/i.test(String(id || '').trim());
}

/**
 * true, если адрес указывает на CDN каталога. Проверка повторяет серверную:
 * прокси отвергает всё остальное, поэтому чужие хосты даже не пробуем.
 */
export function isCatalogCdnUrl(raw: string | null | undefined): boolean {
  const text = String(raw ?? '').trim();
  if (!text || text.length > 1024) return false;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' || url.port || !CATALOG_CDN_HOSTS.has(url.hostname)) {
      return false;
    }
    if (url.hostname === 'www.curseforge.com') {
      return /^\/api\/v1\/mods\/\d+\/files\/\d+\/download\/?$/i.test(url.pathname);
    }
    return true;
  } catch {
    return false;
  }
}

/** @deprecated используйте isCatalogCdnUrl */
export function isModrinthCdnUrl(raw: string | null | undefined): boolean {
  return isCatalogCdnUrl(raw);
}

/** true, если ссылка уже ведёт на наш прокси файлов каталога. */
export function isCatalogProxyFileUrl(raw: string | null | undefined): boolean {
  const text = String(raw ?? '').trim();
  if (!text) return false;
  return (
    text.startsWith('/client/api/catalog/file') ||
    text.includes('/api/catalog/file?') ||
    /\/client\/api\/catalog\/file\?/i.test(text)
  );
}

/**
 * Адрес файла версии через наш прокси. Не-CDN ссылки возвращаются как есть:
 * проксировать произвольный домен сервер всё равно откажется.
 * Относительные `/client/api/catalog/file?...` с сайта делаем абсолютными —
 * иначе Node fetch в main падает с «Failed to parse URL».
 */
export function catalogFileUrl(rawUrl: string, reason?: DownloadReason): string {
  const text = String(rawUrl ?? '').trim();
  if (!text) return '';
  if (isCatalogProxyFileUrl(text)) return absoluteApiUrl(text);
  if (!isCatalogCdnUrl(text)) return text;
  const qs = new URLSearchParams({ url: text });
  if (reason) qs.set('reason', reason);
  return `${apiBase}/api/catalog/file?${qs.toString()}`;
}

/** Адрес картинки (иконка проекта, галерея, аватар) через наш прокси. */
export function catalogImageUrl(rawUrl: string | null | undefined): string {
  const text = String(rawUrl ?? '').trim();
  if (!text) return '';
  // Уже наш прокси / относительный путь с сайта
  if (text.startsWith('/client/api/catalog/') || text.includes('/api/catalog/image')) {
    return absoluteApiUrl(text);
  }
  if (!isCatalogCdnUrl(text)) return absoluteApiUrl(text);
  return `${apiBase}/api/catalog/image?${new URLSearchParams({ url: text }).toString()}`;
}

/** Поиск в каталоге сайта (Modrinth / CurseForge / оба). */
export function catalogSearchUrl(params: URLSearchParams): string {
  return `${apiBase}/api/catalog/search?${params.toString()}`;
}

export function catalogProjectUrl(projectId: string): string {
  return `${apiBase}/api/catalog/project/${encodeURIComponent(projectId)}`;
}

export function catalogVersionsUrl(projectId: string): string {
  return `${apiBase}/api/catalog/project/${encodeURIComponent(projectId)}/version`;
}

/** Конкретный файл CurseForge (`cf:123` + fileId). */
export function catalogCfFileUrl(projectId: string, fileId: string | number): string {
  return `${apiBase}/api/catalog/project/${encodeURIComponent(projectId)}/file/${encodeURIComponent(String(fileId))}`;
}

/** Пакетный резолв CF fingerprint → project/file. */
export function catalogFingerprintsUrl(): string {
  return `${apiBase}/api/catalog/fingerprints`;
}

// ===== Прокси скинов =====
// Сервисы скинов фильтруются у российских провайдеров так же, как CDN Modrinth,
// поэтому голова скина и текстура идут через отдельный прокси на нашем сервере.
// Белый список здесь свой и с каталогом не пересекается: на сервере это разные
// роуты с разными зонами доверия.

/** Хосты, которые принимает роут /api/skin/image. Повторяет серверный список. */
const SKIN_HOSTS = new Set([
  'mc-heads.net',
  'mineskin.eu',
  'textures.minecraft.net',
  'skinsystem.ely.by',
  'ely.by',
  's.namemc.com',
]);

/** Скин по умолчанию, если у аккаунта (Ely и др.) нет своей текстуры */
export const DEFAULT_ACCOUNT_SKIN_URL = 'https://s.namemc.com/i/cbe20ed58814c5e1.png';

/**
 * Приводит адрес текстуры к https. Профиль Mojang исторически отдаёт ссылки на
 * textures.minecraft.net по http, а прокси принимает только https — без этой
 * нормализации лицензионный скин уходил бы мимо прокси на прямой адрес.
 */
function upgradeSkinScheme(text: string): string {
  return text.startsWith('http://') ? `https://${text.slice(7)}` : text;
}

/** true, если адрес указывает на разрешённый сервис скинов. */
export function isSkinServiceUrl(raw: string | null | undefined): boolean {
  const text = upgradeSkinScheme(String(raw ?? '').trim());
  if (!text || text.length > 512) return false;
  try {
    const url = new URL(text);
    return url.protocol === 'https:' && SKIN_HOSTS.has(url.hostname) && !url.port;
  } catch {
    return false;
  }
}

/**
 * Адрес картинки скина через наш прокси. Чужие хосты (в том числе Ely.by,
 * который у российских провайдеров работает) возвращаются как есть.
 */
export function skinImageUrl(rawUrl: string | null | undefined): string {
  const text = upgradeSkinScheme(String(rawUrl ?? '').trim());
  if (!isSkinServiceUrl(text)) return String(rawUrl ?? '').trim();
  return `${apiBase}/api/skin/image?${new URLSearchParams({ url: text }).toString()}`;
}

/** Адрес профиля игрока Mojang через наш прокси (ссылки на скин и плащ). */
export function skinProfileUrl(uuid: string): string {
  const clean = String(uuid ?? '').replace(/-/g, '').toLowerCase();
  return `${apiBase}/api/skin/profile?${new URLSearchParams({ uuid: clean }).toString()}`;
}

/** Актуальная текстура Ely.by через наш сервер (у браузера нет CORS на skinsystem). */
export function skinElyUrl(username: string): string {
  return `${apiBase}/api/skin/ely?${new URLSearchParams({ username: String(username ?? '').trim() }).toString()}`;
}

// ===== Запасной край для обычных запросов =====
// Если выбранный вход не ответил за короткое время, тот же GET уходит на второй.
// Вход целиком не переключаем: иначе свой сервер то появляется, то пропадает.
// POST не повторяем: реле и сообщения нельзя создать дважды.

const RETRY_STATUSES = new Set([502, 503, 504]);
// Второй край только если первый заметно задержался. Иначе каждый GET
// удваивается и оба входа упираются в один и тот же API.
const HEDGE_MS = 1600;
let transportInstalled = false;
let adoptHook: (base: string) => void = (base) => setApiBase(base);

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof Request !== 'undefined' && input instanceof Request) return input.method.toUpperCase();
  return 'GET';
}

function hasNoFailover(input: RequestInfo | URL, init?: RequestInit): boolean {
  const bag = new Headers(init?.headers || undefined);
  if (bag.get('x-uc-no-failover')) return true;
  return typeof Request !== 'undefined' && input instanceof Request && input.headers.get('x-uc-no-failover') === '1';
}

function linkAbort(outer: AbortSignal | null | undefined, controller: AbortController): void {
  if (!outer) return;
  if (outer.aborted) {
    controller.abort();
    return;
  }
  outer.addEventListener('abort', () => controller.abort(), { once: true });
}

/**
 * Включает быстрый повтор GET на второй край. Повторный вызов только меняет
 * обработчик переключения, сам fetch оборачивается один раз.
 */
export function installApiTransport(hook?: (base: string) => void): void {
  if (hook) adoptHook = hook;
  const root = globalThis as { fetch?: typeof fetch; __ucApiTransport?: boolean };
  if (transportInstalled || root.__ucApiTransport || typeof root.fetch !== 'function') return;
  transportInstalled = true;
  root.__ucApiTransport = true;
  const native = root.fetch.bind(globalThis);
  root.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (hasNoFailover(input, init)) return native(input, init);
    const url = requestUrl(input);
    const method = requestMethod(input, init);
    const current = getApiBase();
    const alternate = method === 'GET' || method === 'HEAD' ? otherApiBase(current) : null;
    if (!alternate || !url.startsWith(`${current}/`)) return native(input, init);

    const primaryCtl = new AbortController();
    const altCtl = new AbortController();
    linkAbort(init?.signal, primaryCtl);
    linkAbort(init?.signal, altCtl);
    const altUrl = `${alternate}${url.slice(current.length)}`;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    return await new Promise<Response>((resolve, reject) => {
      let failures = 0;
      let fallback: Response | null = null;
      const fail = (err: unknown) => {
        if (settled) return;
        if (init?.signal?.aborted) {
          settled = true;
          clearTimeout(timer);
          reject(err);
          return;
        }
        if (err instanceof Response) fallback = err;
        failures += 1;
        if (failures < 2) return;
        settled = true;
        clearTimeout(timer);
        if (fallback) resolve(fallback);
        else reject(err);
      };
      const win = (res: Response, loser: AbortController) => {
        if (settled) {
          void res.body?.cancel();
          return;
        }
        if (RETRY_STATUSES.has(res.status)) {
          fail(res);
          return;
        }
        settled = true;
        clearTimeout(timer);
        loser.abort();
        resolve(res);
      };
      void native(input, { ...init, signal: primaryCtl.signal }).then(
        (res) => win(res, altCtl),
        fail,
      );
      timer = setTimeout(() => {
        if (settled || altCtl.signal.aborted) return;
        void native(altUrl, { ...init, signal: altCtl.signal }).then(
          (res) => win(res, primaryCtl),
          fail,
        );
      }, HEDGE_MS);
    });
  }) as typeof fetch;
}
