// Копирует рантайм-артефакты minecraft-renderer в src/renderer/world/.
// Воркеры пакета — самодостаточные IIFE-бандлы, их достаточно положить рядом с HTML,
// потому что они создаются как `new Worker('mesher.js')` (относительный URL от документа).
// wasm-модуль в dist пакета отсутствует, он лежит в src/wasm-mesher/runtime-build/
// и грузится мешером по АБСОЛЮТНОМУ пути '/wasm_mesher_bg.wasm' — поэтому он должен
// оказаться в корне кастомного протокола app://local/.
import { mkdirSync, copyFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = join(root, 'node_modules', 'minecraft-renderer');
const outDir = join(root, 'src', 'renderer', 'world');

const files = [
  [join(pkg, 'dist', 'mesher.js'), 'mesher.js'],
  [join(pkg, 'dist', 'mesherWasm.js'), 'mesherWasm.js'],
  [join(pkg, 'dist', 'threeWorker.js'), 'threeWorker.js'],
  [join(pkg, 'src', 'wasm-mesher', 'runtime-build', 'wasm_mesher_bg.wasm'), 'wasm_mesher_bg.wasm'],
];

mkdirSync(outDir, { recursive: true });

let failed = false;
for (const [from, name] of files) {
  if (!existsSync(from)) {
    console.error(`[copy-world-assets] НЕ НАЙДЕН: ${from}`);
    failed = true;
    continue;
  }
  const to = join(outDir, name);
  copyFileSync(from, to);
  console.log(`[copy-world-assets] ${name} — ${(statSync(to).size / 1024).toFixed(1)} KB`);
}

if (failed) process.exit(1);
