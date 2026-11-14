// Локальная модель распознавания речи для микрофона агента.
// Chromium в Electron отдаёт звук сервису Google, и эта отправка обрывается.
// Модель Vosk качается один раз в userData и дальше работает на этом компьютере.

import { app, ipcMain, net } from 'electron';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';

const MODEL_URL = 'https://alphacephei.com/vosk/models/vosk-model-small-ru-0.22.zip';
const MODEL_FILE = 'ru.tar.gz';
const MIN_BYTES = 8_000_000;

let preparing: Promise<void> | null = null;

function speechDir(): string {
  return path.join(app.getPath('userData'), 'speech');
}

function modelPath(): string {
  return path.join(speechDir(), MODEL_FILE);
}

function runTar(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('tar', args, { windowsHide: true });
    let err = '';
    child.stderr.on('data', (chunk) => {
      err += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(err.trim() || `tar завершился с кодом ${code}`));
    });
  });
}

function findModelDir(root: string): string | null {
  if (fs.existsSync(path.join(root, 'am', 'final.mdl'))) return root;
  for (const name of fs.readdirSync(root)) {
    const nested = path.join(root, name);
    if (fs.existsSync(path.join(nested, 'am', 'final.mdl'))) return nested;
  }
  return null;
}

function headerLength(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const total = Number(raw || 0);
  return Number.isFinite(total) ? total : 0;
}

// Node и Chromium не заканчивают TLS с этим сервером: соединение висит до таймаута.
// Системный curl на Windows проходит, поэтому сначала он.
function downloadWithNet(dest: string, onProgress: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = net.request(MODEL_URL);
    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { fs.rmSync(dest, { force: true }); } catch { /* поток ещё держит файл */ }
      reject(err);
    };
    const timer = setTimeout(() => {
      request.abort();
      fail(new Error('Сервер модели не отвечает'));
    }, 20000);
    request.on('error', (err) => fail(err instanceof Error ? err : new Error(String(err))));
    request.on('response', (response) => {
      clearTimeout(timer);
      const status = response.statusCode || 0;
      const body = response as unknown as {
        resume: () => void;
        pause: () => void;
        on(event: 'data', listener: (chunk: Buffer) => void): void;
        on(event: 'end', listener: () => void): void;
        on(event: 'error', listener: (err: Error) => void): void;
      };
      if (status !== 200) {
        body.resume();
        fail(new Error(`Модель не скачалась: HTTP ${status}`));
        return;
      }
      const total = headerLength(response.headers['content-length']);
      const file = fs.createWriteStream(dest);
      let got = 0;
      let last = -1;
      file.on('error', fail);
      file.on('drain', () => body.resume());
      body.on('data', (chunk: Buffer) => {
        got += chunk.length;
        if (!file.write(chunk)) body.pause();
        const percent = total > 0 ? Math.min(99, Math.round((got / total) * 100)) : 0;
        if (percent !== last) {
          last = percent;
          onProgress(percent);
        }
      });
      body.on('error', (err) => fail(err instanceof Error ? err : new Error(String(err))));
      body.on('end', () => {
        file.end(() => {
          if (settled) return;
          if (got < MIN_BYTES) {
            fail(new Error('Модель скачалась не полностью'));
            return;
          }
          settled = true;
          resolve();
        });
      });
    });
    request.end();
  });
}

function downloadWithCurl(dest: string, onProgress: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const bin = process.platform === 'win32' ? 'curl.exe' : 'curl';
    const child = spawn(bin, [
      '-L', '--fail', '--retry', '2', '--connect-timeout', '20', '--max-time', '180',
      '--progress-bar', '-o', dest, MODEL_URL,
    ], { windowsHide: true });
    let err = '';
    child.stderr.on('data', (chunk) => {
      const text = String(chunk);
      err += text;
      const match = text.match(/(\d{1,3}(?:\.\d+)?)%/);
      if (match) onProgress(Math.min(99, Math.round(Number(match[1]))));
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0 && fs.existsSync(dest) && fs.statSync(dest).size >= MIN_BYTES) resolve();
      else {
        fs.rmSync(dest, { force: true });
        reject(new Error(err.trim().slice(-180) || `curl завершился с кодом ${code}`));
      }
    });
  });
}

async function downloadZip(dest: string, onProgress: (percent: number) => void): Promise<void> {
  fs.rmSync(dest, { force: true });
  try {
    await downloadWithCurl(dest, onProgress);
  } catch (err) {
    fs.rmSync(dest, { force: true });
    try {
      await downloadWithNet(dest, onProgress);
    } catch (netErr) {
      fs.rmSync(dest, { force: true });
      const first = err instanceof Error ? err.message : 'curl';
      const second = netErr instanceof Error ? netErr.message : 'сеть';
      throw new Error(`Не удалось скачать модель. ${first}. ${second}`.slice(0, 280));
    }
  }
}

async function buildModel(onProgress: (percent: number) => void): Promise<void> {
  const dir = speechDir();
  fs.mkdirSync(dir, { recursive: true });
  const dest = modelPath();
  const zip = path.join(dir, 'ru.zip.part');
  const unpack = path.join(dir, 'unpack');
  fs.rmSync(unpack, { recursive: true, force: true });
  fs.rmSync(dest, { force: true });
  onProgress(0);
  await downloadZip(zip, onProgress);
  fs.mkdirSync(unpack, { recursive: true });
  await runTar(['-xf', zip, '-C', unpack]);
  const modelDir = findModelDir(unpack);
  if (!modelDir) throw new Error('В архиве модели нет акустической модели');
  // Vosk снимает верхнюю папку архива, поэтому в tar кладём саму папку модели.
  await runTar(['-czf', dest, '-C', path.dirname(modelDir), path.basename(modelDir)]);
  fs.rmSync(zip, { force: true });
  fs.rmSync(unpack, { recursive: true, force: true });
  if (!fs.existsSync(dest) || fs.statSync(dest).size < MIN_BYTES) {
    fs.rmSync(dest, { force: true });
    throw new Error('Не удалось собрать модель распознавания');
  }
  onProgress(100);
}

function ensureSpeechModel(onProgress: (percent: number) => void): Promise<void> {
  try {
    if (fs.existsSync(modelPath()) && fs.statSync(modelPath()).size >= MIN_BYTES) {
      onProgress(100);
      return Promise.resolve();
    }
  } catch {
    /* скачаем заново */
  }
  if (!preparing) {
    preparing = buildModel(onProgress).catch((err) => {
      preparing = null;
      throw err;
    });
  }
  return preparing;
}

let speechPort = 0;

function speechUrl(): Promise<string> {
  if (speechPort) return Promise.resolve(`http://127.0.0.1:${speechPort}/${MODEL_FILE}`);
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Private-Network': 'true',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      };
      if (req.method === 'OPTIONS') {
        res.writeHead(204, headers);
        res.end();
        return;
      }
      if (req.url?.split('?')[0] !== `/${MODEL_FILE}`) {
        res.writeHead(404, headers);
        res.end();
        return;
      }
      const file = modelPath();
      if (!fs.existsSync(file)) {
        res.writeHead(404, headers);
        res.end();
        return;
      }
      res.writeHead(200, {
        ...headers,
        'Content-Type': 'application/gzip',
        'Content-Length': fs.statSync(file).size,
      });
      fs.createReadStream(file).pipe(res);
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      speechPort = typeof addr === 'object' && addr ? addr.port : 0;
      if (!speechPort) {
        reject(new Error('Не удалось открыть распознавание речи'));
        return;
      }
      resolve(`http://127.0.0.1:${speechPort}/${MODEL_FILE}`);
    });
  });
}

export function registerSpeechIpc(): void {
  ipcMain.handle('speech:model', async (event) => {
    try {
      await ensureSpeechModel((percent) => {
        if (!event.sender.isDestroyed()) event.sender.send('speech:progress', percent);
      });
      return { url: await speechUrl() };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось подготовить распознавание речи';
      return { error: message };
    }
  });
}
