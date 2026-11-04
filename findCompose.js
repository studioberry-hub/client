const fs = require('fs');
const path = require('path');
const histDir = path.join(process.env.APPDATA, 'Cursor', 'User', 'History');
function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) results = results.concat(walk(file));
    else results.push(file);
  });
  return results;
}
const files = walk(histDir);
for (const file of files) {
  if (file.endsWith('.html')) {
    try {
      const content = fs.readFileSync(file, 'utf8');
      if (content.includes('modal-sf-compose')) {
        console.log(file);
      }
    } catch (e) {}
  }
}
