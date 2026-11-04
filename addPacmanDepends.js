const fs = require('fs');
let pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

pkg.build = pkg.build || {};
pkg.build.pacman = pkg.build.pacman || {};
pkg.build.pacman.depends = pkg.build.pacman.depends || [];
if (!pkg.build.pacman.depends.includes('libdecor')) {
  pkg.build.pacman.depends.push('libdecor');
}

fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2), 'utf8');
console.log('Added libdecor to pacman depends');
