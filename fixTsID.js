const fs = require('fs');
let code = fs.readFileSync('src/renderer/social-feed.ts', 'utf8');
code = code.replace(/sf-official-news/g, 'sf-launcher-list');
fs.writeFileSync('src/renderer/social-feed.ts', code);
console.log('Replaced sf-official-news with sf-launcher-list');
