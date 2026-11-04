const fs = require('fs');
let pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
console.log(pkg.build.linux.target);
