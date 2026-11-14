// Воркер Vosk собирает адрес модели от blob:-страницы. База получается
// недействительной, конструктор URL падает, и событие готовности не приходит.
// IndexedDB в том же воркере тоже может не ответить. Оба места обходим.

import fs from 'node:fs';

const OLD_URL = 'const fullModelUrl = new URL(modelUrl, location.href.replace(/^blob:/, ""));';
const NEW_URL = 'const fullModelUrl = /^https?:/i.test(modelUrl) ? new URL(modelUrl) : new URL(modelUrl, "http://localhost/");';
const OLD_MOUNT = [
  'this.Vosk.FS.mkdir(storagePath);',
  'this.Vosk.FS.mount(this.Vosk.IDBFS, {}, storagePath);',
  'return this.Vosk.syncFilesystem(true);',
].join('\r\n                    ');
const NEW_MOUNT = [
  'try { this.Vosk.FS.mkdir(storagePath); } catch (e) { /* каталог уже есть */ }',
  'return Promise.resolve();',
].join('\r\n                    ');
const OLD_SAVE = 'return this.Vosk.syncFilesystem(false);';
const NEW_SAVE = 'return Promise.resolve();';

export function patchVoskWorker(file) {
  const source = fs.readFileSync(file, 'utf8');
  const marker = "createBase64WorkerFactory('";
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`В ${file} нет воркера Vosk`);
  const b64Start = start + marker.length;
  const b64End = source.indexOf("'", b64Start);
  const body = Buffer.from(source.slice(b64Start, b64End), 'base64').toString('utf8');
  if (body.includes(NEW_URL)) return false;
  if (!body.includes(OLD_URL)) throw new Error(`В ${file} не найдена сборка адреса модели`);
  if (!body.includes(OLD_MOUNT)) throw new Error(`В ${file} не найдено хранилище модели`);
  if (!body.includes(OLD_SAVE)) throw new Error(`В ${file} не найдена запись модели`);
  const next = body.replace(OLD_URL, NEW_URL).replace(OLD_MOUNT, NEW_MOUNT).replace(OLD_SAVE, NEW_SAVE);
  fs.writeFileSync(file, source.slice(0, b64Start) + Buffer.from(next, 'utf8').toString('base64') + source.slice(b64End));
  return true;
}

if (process.argv[1] && process.argv[1].endsWith('patch-vosk-worker.mjs')) {
  for (const file of process.argv.slice(2)) {
    const changed = patchVoskWorker(file);
    console.log(changed ? `patched ${file}` : `already ${file}`);
  }
}
