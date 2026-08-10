// Назначение: единый источник базового адреса нашего сервера (сайт лаунчера) и
// построение адресов прокси каталога Modrinth. Модуль общий для main-процесса,
// preload и рендерера, поэтому не использует ни Node, ни Electron API.

// ===== Базовый адрес =====

/** Прод-адрес API лаунчера. Все остальные адреса строятся от него. */
export const DEFAULT_API_BASE = 'https://uprojects.site/client';

let apiBase = DEFAULT_API_BASE;

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

// ===== Прокси каталога Modrinth =====

/** Единственный хост, который принимает прокси на сервере. */
const CDN_HOST = 'cdn.modrinth.com';

/** Причина загрузки: сервер передаёт её в Modrinth для статистики авторов. */
export type DownloadReason = 'standalone' | 'dependency' | 'modpack' | 'update';

/**
 * true, если адрес указывает на CDN Modrinth. Проверка повторяет серверную:
 * прокси отвергает всё остальное, поэтому чужие хосты даже не пробуем.
 */
export function isModrinthCdnUrl(raw: string | null | undefined): boolean {
  const text = String(raw ?? '').trim();
  if (!text || text.length > 1024) return false;
  try {
    const url = new URL(text);
    return url.protocol === 'https:' && url.hostname === CDN_HOST && !url.port;
  } catch {
    return false;
  }
}

/**
 * Адрес файла версии через наш прокси. Не-CDN ссылки возвращаются как есть:
 * проксировать произвольный домен сервер всё равно откажется.
 */
export function catalogFileUrl(rawUrl: string, reason?: DownloadReason): string {
  if (!isModrinthCdnUrl(rawUrl)) return rawUrl;
  const qs = new URLSearchParams({ url: rawUrl });
  if (reason) qs.set('reason', reason);
  return `${apiBase}/api/catalog/file?${qs.toString()}`;
}

/** Адрес картинки (иконка проекта, галерея, аватар) через наш прокси. */
export function catalogImageUrl(rawUrl: string | null | undefined): string {
  const text = String(rawUrl ?? '').trim();
  if (!isModrinthCdnUrl(text)) return text;
  return `${apiBase}/api/catalog/image?${new URLSearchParams({ url: text }).toString()}`;
}

// ===== Прокси скинов =====
// Сервисы скинов фильтруются у российских провайдеров так же, как CDN Modrinth,
// поэтому голова скина и текстура идут через отдельный прокси на нашем сервере.
// Белый список здесь свой и с каталогом не пересекается: на сервере это разные
// роуты с разными зонами доверия.

/** Хосты, которые принимает роут /api/skin/image. Повторяет серверный список. */
const SKIN_HOSTS = new Set(['mc-heads.net', 'mineskin.eu', 'textures.minecraft.net']);

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
