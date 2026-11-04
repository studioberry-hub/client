const fs = require('fs');
let pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

pkg.build.appId = "org.studioberry.uclient";

fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2), 'utf8');
console.log('Fixed appId');
