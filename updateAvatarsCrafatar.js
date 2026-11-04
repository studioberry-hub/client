const fs = require('fs');
let ts = fs.readFileSync('src/renderer/messenger/ui.ts', 'utf8');

// Let's also update the fallback in rawSkinUrl to use Crafatar for consistency
ts = ts.replace(
  /\`https:\/\/mc-heads\.net\/avatar\/\$\{uuid\}\/64\`/g,
  '\`https://crafatar.com/avatars/${uuid}?size=64\`'
);
ts = ts.replace(
  /\`https:\/\/mc-heads\.net\/avatar\/\$\{uuid\}\/48\`/g,
  '\`https://crafatar.com/avatars/${uuid}?size=48&overlay=true\`'
);

fs.writeFileSync('src/renderer/messenger/ui.ts', ts, 'utf8');
console.log('Updated avatar APIs to use Crafatar for consistency');
