const fs = require('fs');
let css = fs.readFileSync('src/renderer/styles.css', 'utf8');
css = css.replace('.linux-only { display: none !important; }', '.about-author-chip.linux-only { display: none !important; }');
css = css.replace('body.platform-linux .linux-only { display: flex !important; }', 'body.platform-linux .about-author-chip.linux-only { display: flex !important; }');
fs.writeFileSync('src/renderer/styles.css', css);
