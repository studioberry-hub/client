const fs = require('fs');
const path = require('path');
function findString(dir) {
  try {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const full = path.join(dir, file);
      try {
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          findString(full);
        } else if (stat.isFile() && (full.endsWith('.html') || full.endsWith('.js') || full.endsWith('.json') || full.endsWith('.txt'))) {
          const content = fs.readFileSync(full, 'utf8');
          if (content.includes('modal-sf-compose')) {
            console.log(full);
          }
        }
      } catch(e) {}
    }
  } catch(e) {}
}
findString(path.join(process.env.APPDATA, 'Cursor'));
