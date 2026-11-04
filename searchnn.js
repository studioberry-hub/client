const fs = require('fs');
const path = require('path');

function search(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const full = path.join(dir, file);
    if (fs.statSync(full).isDirectory()) {
      search(full);
    } else if (full.endsWith('.html') || full.endsWith('.ts') || full.endsWith('.js') || full.endsWith('.json')) {
      const content = fs.readFileSync(full, 'utf8');
      const idx = content.indexOf('\\n\\n');
      if (idx !== -1) {
        console.log('Found in', full);
        console.log(content.substring(Math.max(0, idx - 20), idx + 20));
      }
    }
  }
}
search('src/renderer');
