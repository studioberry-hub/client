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
const target = new Date("2026-09-20T03:37:34Z").getTime();
let closest = candidates[0];
let minDiff = Infinity;
for(const c of candidates) {
  const diff = Math.abs(c.time - target);
  if(diff < minDiff) {
    minDiff = diff;
    closest = c;
  }
}
console.log("Closest to 03:37 is:", new Date(closest.time).toISOString(), closest.file);
