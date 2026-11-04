const fs = require('fs');
let ts = fs.readFileSync('src/renderer/messenger/ui.ts', 'utf8');
ts = ts.replace(/ style="border-radius: 4px; object-fit: cover;"/g, '');
ts = ts.replace(/ style="width:\$\{size\}px; height:\$\{size\}px; border-radius: 4px;"/g, ' style="width:${size}px; height:${size}px;"');
fs.writeFileSync('src/renderer/messenger/ui.ts', ts, 'utf8');
console.log('Removed inline border-radius from ui.ts');
