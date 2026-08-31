// ===== afterPack: updater/unins рядом с exe, без мусора в win-unpacked =====
const fs = require('fs');
const path = require('path');

/** @param {import('electron-builder').AfterPackContext} context */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;

  const projectDir = context.packager.projectDir;
  const outDir = context.appOutDir;

  for (const name of ['updater.exe', 'unins000.exe']) {
    const src = path.join(projectDir, 'dist', name);
    const dest = path.join(outDir, name);
    if (!fs.existsSync(src)) {
      console.warn(`[afterPack] пропуск ${name}: нет ${src}`);
      continue;
    }
    fs.copyFileSync(src, dest);
    console.log(`[afterPack] скопирован ${name}`);
  }

  // Релизный zip никогда не должен лежать внутри win-unpacked
  for (const name of ['latest-windows-amd64.zip', 'win-unpacked.zip']) {
    const bad = path.join(outDir, name);
    if (fs.existsSync(bad)) {
      fs.unlinkSync(bad);
      console.log(`[afterPack] удалён лишний ${name}`);
    }
  }
};
