// Сборка рендерера. На Windows открытый лаунчер держит app.js в отображении
// памяти, и прямая запись в него падает. Пишем во временный файл и подменяем
// цель переименованием: так файл можно заменить, пока он ещё открыт.

import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const jobs = [
  { entry: 'dist/renderer/app.js', out: 'src/renderer/app.js', globalName: 'app' },
  { entry: 'dist/renderer/console.js', out: 'src/renderer/console.js', globalName: 'consoleWin' },
];

function swapIn(target, tmp) {
  const bak = `${target}.bak`;
  if (fs.existsSync(bak)) fs.rmSync(bak, { force: true });
  if (fs.existsSync(target)) fs.renameSync(target, bak);
  fs.renameSync(tmp, target);
  if (fs.existsSync(bak)) fs.rmSync(bak, { force: true });
}

for (const job of jobs) {
  const target = path.join(root, job.out);
  const tmp = `${target}.bundle.js`;
  await esbuild.build({
    entryPoints: [path.join(root, job.entry)],
    outfile: tmp,
    bundle: true,
    format: 'iife',
    globalName: job.globalName,
    platform: 'browser',
    conditions: ['import'],
    logLevel: 'info',
  });
  swapIn(target, tmp);
  console.log(`replaced ${job.out}`);
}
