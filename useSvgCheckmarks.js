const fs = require('fs');
let ts = fs.readFileSync('src/renderer/messenger/ui.ts', 'utf8');

ts = ts.replace(
  /const cls = seen \? 'msgr-bubble__read is-read' : 'msgr-bubble__read is-sent';\s*return `<span class="\$\{cls\}" title="\$\{host\.escapeHtml\(label\)\}">\$\{seen \? '.*?' : '.*?'\}<\/span>`;/,
  `const icon = seen ? '../../assets/messenger/read.svg' : '../../assets/messenger/send.svg';
    return \`<img class="msgr-bubble__read-icon" src="\${icon}" title="\${host.escapeHtml(label)}" width="18" height="18" alt="">\`;`
);

fs.writeFileSync('src/renderer/messenger/ui.ts', ts, 'utf8');
console.log('Replaced text checkmarks with SVG icons in ui.ts');
