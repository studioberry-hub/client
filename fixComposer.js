const fs = require('fs');
let css = fs.readFileSync('src/renderer/messenger-tg-refresh.css', 'utf8');

css = css.replace(/\.msgr-composer\s*\{[\s\S]*?\}/, '#msgr-composer-bar {\n  border-top: 1px solid rgba(255, 255, 255, 0.05) !important;\n  background: #1b1b1b !important;\n  backdrop-filter: none !important;\n}');

fs.writeFileSync('src/renderer/messenger-tg-refresh.css', css);
console.log('Fixed msgr-composer-bar background');
