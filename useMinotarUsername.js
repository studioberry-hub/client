const fs = require('fs');
let code = fs.readFileSync('src/renderer/messenger/ui.ts', 'utf8');

// Replace in fullSkinTextureUrl
code = code.replace(
  /\`https:\/\/crafatar\.com\/skins\/\$\{uuid\}\`/g,
  '\`https://minotar.net/skin/${encodeURIComponent(user.username)}\`'
);

// Replace in rawSkinUrl
code = code.replace(
  /\`https:\/\/crafatar\.com\/avatars\/\$\{uuid\}\?size=64\`/g,
  '\`https://minotar.net/avatar/${encodeURIComponent(user.username)}/64.png\`'
);

// Replace in avatarUrlSync (size=48)
code = code.replace(
  /\`https:\/\/crafatar\.com\/avatars\/\$\{uuid\}\?size=48\&overlay=true\`/g,
  '\`https://minotar.net/helm/${encodeURIComponent(user.username)}/48.png\`'
);

fs.writeFileSync('src/renderer/messenger/ui.ts', code, 'utf8');
console.log('Switched from Crafatar UUID to Minotar Username');
