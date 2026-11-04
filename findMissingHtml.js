const fs = require('fs');
const path = require('path');
const histDir = path.join(process.env.APPDATA, 'Cursor', 'User', 'History', '-4c05a7');
const files = fs.readdirSync(histDir);
for (const file of files) {
  const content = fs.readFileSync(path.join(histDir, file), 'utf8');
  if (content.includes('nr-type-switch')) {
    console.log(file + ' has nr-type-switch');
  }
  if (content.includes('modal-sf-clan')) {
    console.log(file + ' has modal-sf-clan');
  }
}
