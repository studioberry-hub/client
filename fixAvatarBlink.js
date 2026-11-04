const fs = require('fs');
let code = fs.readFileSync('src/renderer/messenger/ui.ts', 'utf8');

code = code.replace(
  /return `<img class="msgr-avatar__skeleton" onload="if\(\!this\.src\.startsWith\('data:'\)\) this\.classList\.remove\('msgr-avatar__skeleton'\)" data-msgr-user="\$\{idAttr\}" src="\$\{host\!\.escapeHtml\(url\)\}" alt="" width="\$\{size\}" height="\$\{size\}">`;/,
  'return `<img data-msgr-user="${idAttr}" src="${host!.escapeHtml(url)}" alt="" width="${size}" height="${size}">`;'
);

code = code.replace(
  /return `<img class="msgr-avatar__photo msgr-avatar__skeleton" src="\$\{host\!\.escapeHtml\(url\)\}" alt="" width="\$\{size\}" height="\$\{size\}" onload="if\(\!this\.src\.startsWith\('data:'\)\) this\.classList\.remove\('msgr-avatar__skeleton'\)" data-fallback="\$\{letter\}" onerror="var s=document\.createElement\('span'\);s\.className='msgr-avatar__fallback';s\.textContent=this\.getAttribute\('data-fallback'\)\|\|'\?';this\.replaceWith\(s\)">`;/,
  'return `<img class="msgr-avatar__photo" src="${host!.escapeHtml(url)}" alt="" width="${size}" height="${size}" data-fallback="${letter}" onerror="var s=document.createElement(\\\'span\\\');s.className=\\\'msgr-avatar__fallback\\\';s.textContent=this.getAttribute(\\\'data-fallback\\\')||\\\'?\\\';this.replaceWith(s)">`;'
);

fs.writeFileSync('src/renderer/messenger/ui.ts', code, 'utf8');
console.log('Fixed avatar blinking');
