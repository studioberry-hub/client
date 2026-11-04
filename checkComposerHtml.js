const fs = require('fs');
const html = fs.readFileSync('src/renderer/index.html', 'utf8');
const idx = html.indexOf('news.composerPlaceholder');
if (idx < 0) { console.log('NOT FOUND'); process.exit(0); }
// Show surrounding context
const start = Math.max(0, idx - 200);
const end = Math.min(html.length, idx + 200);
console.log(html.substring(start, end));
