const fs = require('fs');
let css = fs.readFileSync('src/renderer/styles.css', 'utf8');
css = css.replace(/body\.platform-linux #app \{ border: 1px solid rgba\(255, 255, 255, 0\.15\); box-sizing: border-box; \}/, 'body.platform-linux #app { border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; box-sizing: border-box; overflow: hidden; }');
fs.writeFileSync('src/renderer/styles.css', css);
