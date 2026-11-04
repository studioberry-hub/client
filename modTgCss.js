const fs = require('fs');
let css = fs.readFileSync('src/renderer/messenger-tg-refresh.css', 'utf8');

// Remove .msgr-thread background
css = css.replace(/\.msgr-thread\s*\{[\s\S]*?background:[\s\S]*?rgba\(0,\s*0,\s*0,\s*0\.12\);\s*\}/, '.msgr-thread {\n  /* Removed gradient */\n}');

// Change .msgr-composer background
css = css.replace(/\.msgr-composer\s*\{[\s\S]*?backdrop-filter:[^;]+;\s*\}/, '.msgr-composer {\n  border-top: 1px solid rgba(255, 255, 255, 0.06);\n  background: #1b1b1b;\n}');

fs.writeFileSync('src/renderer/messenger-tg-refresh.css', css);
console.log('Modified messenger-tg-refresh.css');
