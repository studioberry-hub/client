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
const todayStart = new Date();
todayStart.setHours(0,0,0,0);
for (const file of files) {
  if (file.endsWith('.html')) {
    try {
      const stat = fs.statSync(file);
      if (stat.mtimeMs > todayStart.getTime()) {
        const content = fs.readFileSync(file, 'utf8');
        if (content.includes('tab-news') && content.includes('news')) {
          candidates.push({ file, time: stat.mtimeMs, size: stat.size });
        }
      }
    } catch (e) {}
  }
}
candidates.sort((a,b) => b.time - a.time);
for(let i = 0; i < Math.min(10, candidates.length); i++) {
  console.log(new Date(candidates[i].time).toISOString() + ' ' + candidates[i].file + ' size:' + candidates[i].size);
}
