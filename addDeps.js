const fs = require('fs');
let pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

if (!pkg.build.linux) pkg.build.linux = {};

// Add common dependencies for Linux (libdecor for Wayland window decorations)
pkg.build.linux.depends = (pkg.build.linux.depends || []).concat(['libdecor-0-0']);
if (!pkg.build.deb) pkg.build.deb = {};
pkg.build.deb.depends = ['libdecor-0-0'];
if (!pkg.build.rpm) pkg.build.rpm = {};
pkg.build.rpm.depends = ['libdecor'];

fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2));
console.log('Added libdecor dependencies to package.json');
