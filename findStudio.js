const fs = require('fs');
const path = require('path');
function walk(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    if (file === 'node_modules' || file === '.git' || file === 'release') continue;
    const p = path.join(dir, file);
    const stat = fs.statSync(p);
    if (stat.isDirectory()) {
      walk(p);
    } else if (file.endsWith('.json') || file.endsWith('.js') || file.endsWith('.ts')) {
      const content = fs.readFileSync(p, 'utf8');
      if (content.includes('StudioBerry')) {
        console.log(p);
      }
    }
  }
}
walk('.');
