// Назначение: схема пользовательской шаринга сборки и адреса API/страницы.
// Общий модуль для main, preload и рендерера — без Node/Electron API.

import { getApiBase } from './apiBase';

/** Версия JSON-манифеста. При несовместимых изменениях увеличивать. */
export const INSTANCE_SHARE_SCHEMA = 1;

/** Типы контента в шаре (миры не включаются). */
export type ShareContentType = 'mod' | 'resourcepack' | 'shader' | 'datapack';

export interface InstanceShareFile {
  /** Стабильный id файла внутри шара (для hosted-скачивания). */
  fileId: string;
  contentType: ShareContentType;
  filename: string;
  enabled: boolean;
  name: string;
  version?: string;
  sha1: string;
  size: number;
  /** Если файл есть на Modrinth — ставим по project/version, без загрузки на наш сервер. */
  projectId?: string;
  versionId?: string;
  /** true: бинарник лежит на нашем сервере (кастомный мод и т.п.). */
  hosted?: boolean;
}

export interface InstanceShareCounts {
  mods: number;
  resourcePacks: number;
  shaders: number;
  dataPacks: number;
}

/**
 * Публичный манифест шара. Сервер дополняет id/createdAt/iconUrl;
 * клиент при создании шлёт тело без id.
 */
export interface InstanceShareManifest {
  schemaVersion: number;
  id: string;
  createdAt: string;
  name: string;
  /** Абсолютный или относительный URL иконки на нашем сервере / CDN. */
  iconUrl?: string;
  iconBg?: string;
  /** Пресет иконки лаунчера (`preset:…`), если иконка не загружалась. */
  iconPreset?: string;
  gameVersion: string;
  loader: string;
  loaderVersion: string;
  jvmArgs?: string;
  mcArgs?: string;
  memory?: { min: number; max: number };
  window?: { width: number; height: number; fullscreen: boolean };
  counts: InstanceShareCounts;
  files: InstanceShareFile[];
  /** Отображаемое имя автора на странице шара. */
  authorName?: string;
}

/** Тело POST без серверных полей (iconUrl можно передать, если иконка уже на CDN). */
export type InstanceShareCreateBody = Omit<InstanceShareManifest, 'id' | 'createdAt'> & {
  iconUrl?: string;
};

/** Id шара в URL: буквы, цифры, `_`, `-`. */
export const SHARE_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function instanceSharePageUrl(id: string, apiBase = getApiBase()): string {
  return `${apiBase.replace(/\/+$/, '')}/instanceShare/${encodeURIComponent(id)}`;
}

/** Deep link, который открывает клиент и показывает модалку импорта. */
export function instanceShareDeepLink(id: string): string {
  return `uclient://import-instance?id=${encodeURIComponent(id)}`;
}

export function instanceShareApiCollectionUrl(apiBase = getApiBase()): string {
  return `${apiBase.replace(/\/+$/, '')}/api/instance-share`;
}

export function instanceShareApiItemUrl(id: string, apiBase = getApiBase()): string {
  return `${instanceShareApiCollectionUrl(apiBase)}/${encodeURIComponent(id)}`;
}

export function instanceShareApiFileUrl(id: string, fileId: string, apiBase = getApiBase()): string {
  return `${instanceShareApiItemUrl(id, apiBase)}/files/${encodeURIComponent(fileId)}`;
}
