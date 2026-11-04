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
let candidates = [];
for (const file of files) {
  if (file.endsWith('.html')) {
    try {
      const content = fs.readFileSync(file, 'utf8');
      if (content.includes('tab-news')) {
        const stat = fs.statSync(file);
        candidates.push({ file, time: stat.mtimeMs });
      }
    } catch (e) {}
  }
}
candidates.sort((a,b) => b.time - a.time);
for(let i = 0; i < Math.min(10, candidates.length); i++) {
  console.log(new Date(candidates[i].time).toISOString() + ' ' + candidates[i].file);
}
