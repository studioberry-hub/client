const fs = require('fs');
let ts = fs.readFileSync('src/renderer/messenger/ui.ts', 'utf8');

ts = ts.replace(/onload="this\.classList\.remove\('msgr-avatar__skeleton'\)"/g, `onload="if(!this.src.startsWith('data:')) this.classList.remove('msgr-avatar__skeleton')"`);
ts = ts.replace(/onload='this\.classList\.remove\("msgr-avatar__skeleton"\)'/g, `onload="if(!this.src.startsWith('data:')) this.classList.remove('msgr-avatar__skeleton')"`);

fs.writeFileSync('src/renderer/messenger/ui.ts', ts, 'utf8');

let ts2 = fs.readFileSync('src/renderer/social-feed.ts', 'utf8');
ts2 = ts2.replace(/onload="this\.classList\.remove\('msgr-avatar__skeleton'\)"/g, `onload="if(!this.src.startsWith('data:')) this.classList.remove('msgr-avatar__skeleton')"`);
fs.writeFileSync('src/renderer/social-feed.ts', ts2, 'utf8');

