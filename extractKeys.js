const fs = require('fs');
const html = fs.readFileSync('src/renderer/index.html', 'utf8');
const ts = fs.readFileSync('src/renderer/social-feed.ts', 'utf8');
const keys = new Set();
[...html.matchAll(/data-i18n(?:-[a-z]+)?="([^"]+)"/g)].forEach(m => {
  if (m[1].startsWith('news.') || m[1] === 'builds.groupCount') keys.add(m[1]);
});
[...ts.matchAll(/t\('([^']+)'\)/g)].forEach(m => {
  if (m[1].startsWith('news.') || m[1] === 'builds.groupCount') keys.add(m[1]);
});
console.log(Array.from(keys).sort());
