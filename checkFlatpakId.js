const fs = require('fs');
const content = fs.readFileSync('node_modules/app-builder-lib/out/targets/FlatpakTarget.js', 'utf8');
console.log(content.match(/appId|manifest\.id/g));
