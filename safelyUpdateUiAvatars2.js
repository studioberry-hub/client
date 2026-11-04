const fs = require('fs');
let ts = fs.readFileSync('src/renderer/messenger/ui.ts', 'utf8');

ts = ts.replace(
  /function avatarImgHtml\(user: MessengerUser \| null \| undefined, size: number, fallbackLetter: string\): string \{[\s\S]*?return `<span class="msgr-avatar__fallback"[^>]*>.*?<\/span>`;\s*\}/,
  `function avatarImgHtml(user: MessengerUser | null | undefined, size: number, fallbackLetter: string): string {
    if (!user) {
      return \`<div class="msgr-avatar__skeleton" style="width:\${size}px; height:\${size}px; border-radius: 50%;"></div>\`;
    }
    ensureAvatar(user);
    const url = avatarCache.get(user.id) || avatarUrlSync(user);
    const idAttr = host!.escapeHtml(user.id);
    if (url) {
      return \`<img class="msgr-avatar__skeleton" onload="if(!this.src.startsWith('data:')) this.classList.remove('msgr-avatar__skeleton')" data-msgr-user="\${idAttr}" src="\${host!.escapeHtml(url)}" alt="" width="\${size}" height="\${size}" style="border-radius: 50%; object-fit: cover;">\`;
    }
    return \`<img class="msgr-avatar__skeleton" onload="if(!this.src.startsWith('data:')) this.classList.remove('msgr-avatar__skeleton')" data-msgr-user="\${idAttr}" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" data-size="\${size}" alt="" width="\${size}" height="\${size}" style="border-radius: 50%; object-fit: cover;">\`;
  }`
);

ts = ts.replace(
  /function groupAvatarHtml\(conv: MessengerConversation, size: number\): string \{[\s\S]*?return `<span class="msgr-avatar__fallback">\$\{letter\}<\/span>`;\s*\}/,
  `function groupAvatarHtml(conv: MessengerConversation, size: number): string {
    const letter = host!.escapeHtml((conv.title || '?').slice(0, 1));
    if (conv.avatarUrl) {
      const url = resolveMsgrMediaUrl(conv.avatarUrl, conv.updatedAt);
      return \`<img class="msgr-avatar__photo msgr-avatar__skeleton" src="\${host!.escapeHtml(url)}" alt="" width="\${size}" height="\${size}" onload="if(!this.src.startsWith('data:')) this.classList.remove('msgr-avatar__skeleton')" data-fallback="\${letter}" onerror="var s=document.createElement('span');s.className='msgr-avatar__fallback';s.textContent=this.getAttribute('data-fallback')||'?';this.replaceWith(s)">\`;
    }
    return \`<span class="msgr-avatar__fallback">\${letter}</span>\`;
  }`
);

fs.writeFileSync('src/renderer/messenger/ui.ts', ts, 'utf8');
console.log('Fixed regex in safelyUpdateUiAvatars');
