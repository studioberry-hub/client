// Назначение: скачивание файлов Modrinth в main-процессе.
//
// Решает две независимые задачи.
// 1. Поток ответа пишется сразу на диск. Раньше файл целиком копился в массиве
//    чанков и склеивался через Buffer.concat, поэтому модпак на 500 МБ занимал
//    столько же оперативной памяти.
// 2. Основной путь загрузки — наш серверный прокси, резервный — прямое
//    обращение к cdn.modrinth.com. У части российских провайдеров DPI рвёт
//    длинные передачи к Cloudflare, и прямая загрузка не доходит до конца;
//    при этом сам наш сервер может быть недоступен, поэтому «прокси или
//    ничего» — тоже плохой вариант.

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { catalogFileUrl, isModrinthCdnUrl, type DownloadReason } from '../shared/apiBase';

// ===== Параметры =====

/** Ожидание заголовков. Тело качается сколько нужно — модпаки идут минутами. */
const HEADERS_TIMEOUT_MS = 30_000;

// Сторожевой таймер простоя. При DPI-фильтрации соединение часто не рвётся, а
// просто перестаёт отдавать данные: без этого таймера загрузка висела бы вечно.
const STALL_TIMEOUT_MS = 60_000;

/** Повторы при 503 от нашего прокси (исчерпаны слоты загрузки). */
const MAX_BUSY_RETRIES = 4;
const BUSY_BASE_DELAY_MS = 1500;
const BUSY_MAX_DELAY_MS = 15_000;

/** Прогресс в интерфейс — не чаще, чем раз в 120 мс, иначе IPC захлёбывается. */
const PROGRESS_INTERVAL_MS = 120;

/**
 * Прокси разрешает 4 одновременные загрузки с одного IP (MODRINTH_CDN_MAX_PER_IP).
 * Больше — гарантированный 503 на собственном сервере, поэтому пачки файлов
 * модпака качаются ровно в этот лимит.
 */
export const PROXY_MAX_CONCURRENT_DOWNLOADS = 4;

const USER_AGENT = 'Undefined-Client';

// ===== Ошибки =====

/**
 * Ошибка, при которой резервный путь не поможет: файла нет на CDN. Пробовать
 * после неё прямую ссылку бессмысленно — ответ будет тот же.
 */
class TerminalDownloadError extends Error {}

export interface DownloadFileOptions {
  /** Причина загрузки для атрибуции авторам проекта на стороне Modrinth. */
  reason?: DownloadReason;
  /** Ожидаемый sha1 (есть в modrinth.index.json): ловит молча битую докачку. */
  sha1?: string;
  /** Размер из метаданных версии — используется, если сервер не прислал Content-Length. */
  expectedSize?: number;
  onProgress?: (received: number, total: number) => void;
}

export interface DownloadFileResult {
  bytes: number;
  /** false означает, что сработал резервный прямой путь к CDN. */
  viaProxy: boolean;
}

// ===== Загрузка с резервным путём =====

/**
 * Качает файл в `destPath`. Сначала пробует наш прокси, при его недоступности —
 * прямую ссылку на CDN.
 *
 * Разделение случаев ответа прокси принципиально:
 *   * 503 — на сервере кончились слоты (лимит 4 загрузки на IP). Сервер жив,
 *     уходить на заблокированный CDN рано: ждём и повторяем.
 *   * 404 — файла нет, резерв не поможет, ошибка терминальная.
 *   * всё остальное (сеть, тайм-аут, 5xx, обрыв тела) — сервер или его канал
 *     до CDN не работают, пробуем напрямую.
 */
export async function downloadModrinthFile(
  sourceUrl: string,
  destPath: string,
  options: DownloadFileOptions = {},
): Promise<DownloadFileResult> {
  const attempts: { url: string; viaProxy: boolean }[] = [];
  if (isModrinthCdnUrl(sourceUrl)) {
    attempts.push({ url: catalogFileUrl(sourceUrl, options.reason), viaProxy: true });
  }
  // Чужие хосты (github и прочие разрешённые Modrinth зеркала) прокси не
  // принимает, для них прямая ссылка — единственный путь.
  attempts.push({ url: sourceUrl, viaProxy: false });

  let lastError: unknown = null;
  for (const attempt of attempts) {
    try {
      const bytes = await downloadOnce(attempt.url, destPath, options, attempt.viaProxy);
      return { bytes, viaProxy: attempt.viaProxy };
    } catch (err) {
      if (err instanceof TerminalDownloadError) throw err;
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'Download failed'));
}

async function downloadOnce(
  url: string,
  destPath: string,
  options: DownloadFileOptions,
  viaProxy: boolean,
): Promise<number> {
  const { response, controller } = await requestFile(url, viaProxy);
  return await streamToFile(response, controller, destPath, options);
}

/** Запрос за файлом с повтором при 503 от нашего прокси. */
async function requestFile(
  url: string,
  viaProxy: boolean,
): Promise<{ response: Response; controller: AbortController }> {
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEADERS_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
        signal: controller.signal,
      });
    } finally {
      // Снимаем только ожидание заголовков: за телом следит таймер простоя.
      clearTimeout(timer);
    }

    if (response.ok) return { response, controller };

    // Тело ошибки не нужно, но соединение надо закрыть явно.
    await response.body?.cancel().catch(() => {});

    if (response.status === 404) throw new TerminalDownloadError('Файл не найден (404)');
    if (viaProxy && response.status === 503 && attempt < MAX_BUSY_RETRIES) {
      await delay(busyDelay(response, attempt));
      continue;
    }
    throw new Error(`HTTP ${response.status}`);
  }
}

/**
 * Выдержка перед повтором. Растёт экспоненциально, а Retry-After трактуется как
 * верхняя граница, а не как точное указание: сервер отдаёт в этом заголовке
 * константу (10 секунд), тогда как слот освобождается сразу после завершения
 * любой из идущих загрузок — обычно за секунду-другую. Ждать по 10 секунд на
 * каждый из полутора сотен файлов модпака было бы неоправданно долго.
 */
function busyDelay(response: Response, attempt: number): number {
  const backoff = Math.min(BUSY_BASE_DELAY_MS * 2 ** attempt, BUSY_MAX_DELAY_MS);
  const hint = Number(response.headers.get('retry-after')) * 1000;
  const wait = Number.isFinite(hint) && hint > 0 ? Math.min(backoff, hint) : backoff;
  // Джиттер разводит пачку параллельных загрузок, иначе они повторяются разом.
  return wait + Math.floor(Math.random() * 500);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Пишет тело ответа на диск потоком. Файл собирается во временном `.part` и
 * переименовывается только после проверки размера и хэша: оборванная загрузка
 * не должна остаться на месте готового файла и выглядеть валидной.
 */
async function streamToFile(
  response: Response,
  controller: AbortController,
  destPath: string,
  options: DownloadFileOptions,
): Promise<number> {
  if (!response.body) throw new Error('Пустой ответ');

  await fs.promises.mkdir(path.dirname(destPath), { recursive: true });

  const headerSize = Number(response.headers.get('content-length'));
  const total = Number.isFinite(headerSize) && headerSize > 0
    ? headerSize
    : Number(options.expectedSize) || 0;

  const tmpPath = `${destPath}.part-${crypto.randomBytes(4).toString('hex')}`;
  const hash = options.sha1 ? crypto.createHash('sha1') : null;
  let received = 0;
  let lastTick = 0;

  const stallTimer = setTimeout(() => controller.abort(), STALL_TIMEOUT_MS);

  const meter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      received += chunk.length;
      hash?.update(chunk);
      stallTimer.refresh();
      const now = Date.now();
      if (options.onProgress && now - lastTick >= PROGRESS_INTERVAL_MS) {
        lastTick = now;
        options.onProgress(received, total);
      }
      cb(null, chunk);
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(response.body as any),
      meter,
      fs.createWriteStream(tmpPath),
    );

    // Апстрим объявил размер, но прислал меньше — соединение оборвали на середине.
    if (total > 0 && received !== total) {
      throw new Error(`Загрузка оборвана: получено ${received} из ${total} байт`);
    }
    if (hash) {
      const digest = hash.digest('hex');
      if (digest !== options.sha1) throw new Error('Контрольная сумма файла не совпала');
    }
    await fs.promises.rename(tmpPath, destPath);
  } catch (err) {
    await fs.promises.unlink(tmpPath).catch(() => {});
    throw err;
  } finally {
    clearTimeout(stallTimer);
  }

  options.onProgress?.(received, total || received);
  return received;
}

// ===== Параллельная обработка списка =====

/**
 * Выполняет задачи пачками не больше `limit` штук. Нужен для файлов модпака:
 * последовательная загрузка 150 модов занимает минуты, а превышение лимита
 * прокси даёт 503 на собственном сервере.
 */
export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const size = Math.max(1, Math.min(limit, items.length));
  let cursor = 0;

  const runners = Array.from({ length: size }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
    }
  });

  await Promise.all(runners);
}
