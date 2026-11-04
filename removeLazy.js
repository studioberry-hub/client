const fs = require('fs');
let ts = fs.readFileSync('src/renderer/social-feed.ts', 'utf8');

ts = ts.replace(/ loading="lazy"/g, '');

fs.writeFileSync('src/renderer/social-feed.ts', ts, 'utf8');
