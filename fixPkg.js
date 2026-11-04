const fs = require('fs');
let pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

if (pkg.build && pkg.build.linux && pkg.build.linux.depends) {
  delete pkg.build.linux.depends;
}

fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2));
console.log('Removed invalid depends from linux block');
