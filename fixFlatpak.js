const fs = require('fs');
let pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

pkg.build.flatpak = pkg.build.flatpak || {};
pkg.build.flatpak.runtimeVersion = "23.08";
pkg.build.flatpak.baseVersion = "23.08";

fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2), 'utf8');
console.log('Updated flatpak config');
