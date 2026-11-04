const fs = require('fs');
let ts = fs.readFileSync('src/renderer/messenger/ui.ts', 'utf8');

// In fullSkinTextureUrl:
ts = ts.replace(
  /if \(user\.skinUrl && \/textures\\.minecraft\\.net\|skin\/i\.test\(user\.skinUrl\)\) \{/,
  'if (user.skinUrl && !user.skinUrl.includes("/avatar/")) {'
);

fs.writeFileSync('src/renderer/messenger/ui.ts', ts, 'utf8');
console.log('Relaxed skinUrl check in fullSkinTextureUrl');
