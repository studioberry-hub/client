const fs = require('fs');
let pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

pkg.build.snap = pkg.build.snap || {};
pkg.build.snap.stagePackages = pkg.build.snap.stagePackages || ['default'];
if (!pkg.build.snap.stagePackages.includes('libdecor-0-0')) {
  pkg.build.snap.stagePackages.push('libdecor-0-0');
}

fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2), 'utf8');
console.log('Added libdecor-0-0 to snap stagePackages');
