const fs = require('fs');
let ts = fs.readFileSync('src/renderer/messenger/ui.ts', 'utf8');

ts = ts.replace(
  /class="msgr-avatar__skeleton"/g,
  `class="msgr-avatar__skeleton" onload="this.classList.remove('msgr-avatar__skeleton')"`
);

// Group avatar: the user wants "сделай так, чтобы подгружались динамически... Должно быть как и было, только с характерной анимацией. Плюс сломалось положение"
// Let's also add the skeleton to groupAvatarHtml
ts = ts.replace(
  /function groupAvatarHtml\(conv: MessengerConversation, size: number\): string \{[\s\S]*?return `<span class="msgr-avatar__fallback">\$\{letter\}<\/span>`;\n  \}/,
  `function groupAvatarHtml(conv: MessengerConversation, size: number): string {
    const letter = host!.escapeHtml((conv.title || '?').slice(0, 1));
    if (conv.avatarUrl) {
      const url = resolveMsgrMediaUrl(conv.avatarUrl, conv.updatedAt);
      return \`<img class="msgr-avatar__photo msgr-avatar__skeleton" src="\${host!.escapeHtml(url)}" alt="" width="\${size}" height="\${size}" onload="this.classList.remove('msgr-avatar__skeleton')" data-fallback="\${letter}" onerror="var s=document.createElement('span');s.className='msgr-avatar__fallback';s.textContent=this.getAttribute('data-fallback')||'?';this.replaceWith(s)">\`;
    }
    return \`<span class="msgr-avatar__fallback">\${letter}</span>\`;
  }`
);

fs.writeFileSync('src/renderer/messenger/ui.ts', ts, 'utf8');
console.log('Updated ui.ts onload and group avatars');
