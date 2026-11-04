const fs = require('fs');
let code = fs.readFileSync('src/renderer/messenger/ui.ts', 'utf8');

code = code.replace(
  /\`https:\/\/minotar\.net\/skin\/\$\{encodeURIComponent\(user\.username\)\}\`/g,
  '\`https://mc-heads.net/skin/${encodeURIComponent(user.username)}\`'
);

code = code.replace(
  /\`https:\/\/minotar\.net\/avatar\/\$\{encodeURIComponent\(user\.username\)\}\/64\.png\`/g,
  '\`https://mc-heads.net/avatar/${encodeURIComponent(user.username)}/64\`'
);

code = code.replace(
  /\`https:\/\/minotar\.net\/helm\/\$\{encodeURIComponent\(user\.username\)\}\/48\.png\`/g,
  '\`https://mc-heads.net/avatar/${encodeURIComponent(user.username)}/48\`'
);

fs.writeFileSync('src/renderer/messenger/ui.ts', code, 'utf8');
console.log('Switched to mc-heads with username');
