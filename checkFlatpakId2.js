const fs = require('fs');
const content = fs.readFileSync('node_modules/app-builder-lib/out/targets/FlatpakTarget.js', 'utf8');
const lines = content.split('\n');
lines.forEach(l => {
  if (l.includes('appId')) console.log(l.trim());
});
