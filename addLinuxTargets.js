const fs = require('fs');
let pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

// Add scripts
pkg.scripts["dist:linux:snap"] = "npm run build && electron-builder --linux snap";
pkg.scripts["dist:linux:flatpak"] = "npm run build && electron-builder --linux flatpak";
pkg.scripts["dist:linux:pacman"] = "npm run build && electron-builder --linux pacman";

// Add targets
if (pkg.build && pkg.build.linux && Array.isArray(pkg.build.linux.target)) {
  const t = pkg.build.linux.target;
  if (!t.includes('snap')) t.push('snap');
  if (!t.includes('flatpak')) t.push('flatpak');
  if (!t.includes('pacman')) t.push('pacman');
}

// Write back
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2), 'utf8');
console.log('Added snap, flatpak, pacman to package.json');
