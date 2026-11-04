const fs = require('fs');
let ts = fs.readFileSync('src/renderer/messenger/ui.ts', 'utf8');

// I'll find the exact start and end of the function manually to be 100% safe.
const startStr = 'function avatarImgHtml(user: MessengerUser | null | undefined, size: number, fallbackLetter: string): string {';
const start = ts.indexOf(startStr);
if (start !== -1) {
  // Find the end of this corrupted function by looking for the next function declaration
  const nextFunc = ts.indexOf('function groupAvatarHtml', start);
  
  if (nextFunc !== -1) {
    const correctCode = `function avatarImgHtml(user: MessengerUser | null | undefined, size: number, fallbackLetter: string): string {
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
}

`;
    ts = ts.substring(0, start) + correctCode + ts.substring(nextFunc);
    fs.writeFileSync('src/renderer/messenger/ui.ts', ts, 'utf8');
    console.log('Fixed avatarImgHtml in ui.ts');
  }
}
