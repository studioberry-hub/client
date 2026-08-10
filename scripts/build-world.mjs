// Сборка бандла окна просмотра мира (PoC minecraft-renderer).
//
// Отдельная точка входа со своими настройками, потому что мировому окну нужны:
//  - своя копия three 0.184 (из node_modules/minecraft-renderer/node_modules/three),
//    изолированная от three 0.156.1 главного бандла app.js;
//  - ручное разрешение `minecraft-renderer`: поле main в его package.json указывает
//    на несуществующий dist/index.js, реальная точка входа — dist/minecraft-renderer.js;
//  - подмена `minecraft-data` на мини-версию с данными одной версии игры
//    (полный пакет статически тянет ~500 МБ JSON);
//  - loader для .png (атласы mc-assets импортируются как модули).
import * as esbuild from 'esbuild';
import { writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outFile = join(root, 'src', 'renderer', 'world', 'world.js');
const rendererEntry = join(root, 'node_modules', 'minecraft-renderer', 'dist', 'minecraft-renderer.js');
const mcDataShim = join(root, 'scripts', 'world-shims', 'minecraft-data.cjs');

mkdirSync(dirname(outFile), { recursive: true });

// Полифилы node-встроенных модулей, которые тянет prismarine-стек.
const nodeShims = {
  zlib: join(root, 'scripts', 'world-shims', 'node', 'zlib.mjs'),
  util: join(root, 'scripts', 'world-shims', 'node', 'util.mjs'),
  assert: join(root, 'scripts', 'world-shims', 'node', 'assert.mjs'),
};

/** Точечная подмена импортов: только точное имя пакета, без подпутей. */
const remapPlugin = {
  name: 'world-remap',
  setup(build) {
    build.onResolve({ filter: /^minecraft-renderer$/ }, () => ({ path: rendererEntry }));
    build.onResolve({ filter: /^minecraft-data$/ }, () => ({ path: mcDataShim }));
    build.onResolve({ filter: /^(node:)?(zlib|util|assert)$/ }, (args) => ({
      path: nodeShims[args.path.replace(/^node:/, '')],
    }));
  },
};

const result = await esbuild.build({
  entryPoints: [join(root, 'src', 'renderer', 'world.ts')],
  outfile: outFile,
  bundle: true,
  format: 'iife',
  globalName: 'worldWin',
  platform: 'browser',
  target: ['chrome122'],
  loader: { '.png': 'dataurl' },
  inject: [join(root, 'scripts', 'world-shims', 'node-globals.mjs')],
  define: {
    'process.env.SINGLE_FILE_BUILD': 'false',
    'process.env.NODE_ENV': '"production"',
  },
  plugins: [remapPlugin],
  metafile: true,
  logLevel: 'info',
  logOverride: { 'direct-eval': 'silent' },
});

writeFileSync(join(root, '.spike2', 'world-meta.json'), JSON.stringify(result.metafile));

const size = statSync(outFile).size;
console.log(`[build-world] world.js — ${(size / 1024 / 1024).toFixed(2)} MB`);

// ===== Разбивка бандла по крупным составляющим =====
const inputs = result.metafile.outputs[Object.keys(result.metafile.outputs)[0]].inputs;
const groups = new Map();
for (const [file, info] of Object.entries(inputs)) {
  const m = /node_modules[\\/](@[^\\/]+[\\/][^\\/]+|[^\\/]+)/.exec(file);
  const key = m ? m[1] : 'src/*';
  groups.set(key, (groups.get(key) ?? 0) + info.bytesInOutput);
}
const top = [...groups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
for (const [name, bytes] of top) {
  console.log(`  ${name.padEnd(28)} ${(bytes / 1024).toFixed(0).padStart(8)} KB`);
}
