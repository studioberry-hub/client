const fs = require('fs');
let css = fs.readFileSync('src/renderer/messenger-tg-refresh.css', 'utf8');

css = css.replace(/border-top:\s*1px\s*solid\s*rgba\(255,\s*255,\s*255,\s*0\.05\)\s*!important;/, 'border-top: none !important;');

fs.writeFileSync('src/renderer/messenger-tg-refresh.css', css);
console.log('Removed top border from msgr-composer-bar');
