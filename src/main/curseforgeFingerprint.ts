// Назначение: CurseForge fingerprint (MurmurHash2) для резолва локальных jar
// без загрузки на наш сервер — аналог SHA1→version у Modrinth.

import * as fs from 'fs';

/** Байты, которые CF выкидывает перед хешем (tab/lf/cr/space). */
const STRIP = new Set([9, 10, 13, 32]);

/**
 * MurmurHash2 (32-bit), seed = 1 — как в официальном клиенте CurseForge /
 * Prism Launcher. Читаем little-endian блоками по 4 байта.
 */
export function murmurHash2(buf: Buffer, seed = 1): number {
  const m = 0x5bd1e995;
  const r = 24;
  let len = buf.length;
  let h = (seed ^ len) >>> 0;
  let i = 0;

  while (len >= 4) {
    let k =
      (buf[i] | (buf[i + 1] << 8) | (buf[i + 2] << 16) | (buf[i + 3] << 24)) >>> 0;
    k = Math.imul(k, m) >>> 0;
    k = (k ^ (k >>> r)) >>> 0;
    k = Math.imul(k, m) >>> 0;
    h = Math.imul(h, m) >>> 0;
    h = (h ^ k) >>> 0;
    i += 4;
    len -= 4;
  }

  switch (len) {
    case 3:
      h = (h ^ (buf[i + 2] << 16)) >>> 0;
    // fallthrough
    case 2:
      h = (h ^ (buf[i + 1] << 8)) >>> 0;
    // fallthrough
    case 1:
      h = (h ^ buf[i]) >>> 0;
      h = Math.imul(h, m) >>> 0;
  }

  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, m) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return h >>> 0;
}

/** Fingerprint буфера: без whitespace-байтов, затем MurmurHash2(seed=1). */
export function curseforgeFingerprintFromBuffer(data: Buffer): number {
  const cleaned = Buffer.allocUnsafe(data.length);
  let n = 0;
  for (let i = 0; i < data.length; i++) {
    const b = data[i];
    if (!STRIP.has(b)) cleaned[n++] = b;
  }
  return murmurHash2(cleaned.subarray(0, n), 1);
}

/** Fingerprint файла на диске (стрим, без полной загрузки в память). */
export function curseforgeFingerprintFile(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk: string | Buffer) => {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      // Собираем только «чистые» байты, чтобы не держать исходник целиком дважды
      const cleaned = Buffer.allocUnsafe(buf.length);
      let n = 0;
      for (let i = 0; i < buf.length; i++) {
        const b = buf[i];
        if (!STRIP.has(b)) cleaned[n++] = b;
      }
      if (n) {
        chunks.push(cleaned.subarray(0, n));
        total += n;
      }
    });
    stream.on('error', reject);
    stream.on('end', () => {
      resolve(murmurHash2(Buffer.concat(chunks, total), 1));
    });
  });
}
