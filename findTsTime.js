const fs = require('fs');
const path = require('path');
const histDir = path.join(process.env.APPDATA, 'Cursor', 'User', 'History', '-2a42e37f');
const files = fs.readdirSync(histDir);
let candidates = [];
for (const file of files) {
  const stat = fs.statSync(path.join(histDir, file));
  candidates.push({ file, time: stat.mtimeMs });
}
candidates.sort((a,b) => b.time - a.time);
for(let i = 0; i < Math.min(10, candidates.length); i++) {
  console.log(new Date(candidates[i].time).toISOString() + ' ' + candidates[i].file);
}
