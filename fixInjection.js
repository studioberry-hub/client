const fs = require('fs');
let code = fs.readFileSync('src/renderer/messenger/ui.ts', 'utf8');

const targetStr = `m.body && (!m.attachment || m.body !== m.attachment.name)
                ? \`<div class="msgr-bubble__text">\${host!.escapeHtml(m.body)}</div>\`
                : '';`;

// Since spaces and newlines might vary, let's use a robust regex
code = code.replace(
  /m\.body && \(\!m\.attachment \|\| m\.body !== m\.attachment\.name\)[\r\n\s]*\? `<div class="msgr-bubble__text">\$\{host!\.escapeHtml\(m\.body\)\}<\/div>`[\r\n\s]*: '';/,
  "formatMessageBodyHtml(m);"
);

fs.writeFileSync('src/renderer/messenger/ui.ts', code, 'utf8');
console.log('Fixed formatMessageBodyHtml injection');
