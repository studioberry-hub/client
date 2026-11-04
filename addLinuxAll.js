const fs = require('fs');
let pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

if (!pkg.build.linux.target.includes('rpm')) {
  pkg.build.linux.target.push('rpm');
}

pkg.scripts["dist:linux:all"] = "npm run build && electron-builder --linux";

fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2), 'utf8');
console.log('Added dist:linux:all and rpm to target');
