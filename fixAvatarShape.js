const fs = require('fs');
let ts = fs.readFileSync('src/renderer/messenger/ui.ts', 'utf8');
ts = ts.replace(/border-radius:\s*50%;?/g, 'border-radius: 4px;');
fs.writeFileSync('src/renderer/messenger/ui.ts', ts, 'utf8');
console.log('Fixed avatar shape in ui.ts');
