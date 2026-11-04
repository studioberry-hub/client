const fs = require('fs');
let ts = fs.readFileSync('src/renderer/messenger/ui.ts', 'utf8');

ts = ts.replace(
  /\`https:\/\/mc-heads\.net\/skin\/\$\{uuid\}\`/g,
  '\`https://crafatar.com/skins/${uuid}\`'
);

fs.writeFileSync('src/renderer/messenger/ui.ts', ts, 'utf8');
console.log('Switched from mc-heads.net/skin to crafatar.com/skins');
