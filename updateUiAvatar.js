const fs = require('fs');
let ts = fs.readFileSync('src/renderer/messenger/ui.ts', 'utf8');

// Update avatarImgHtml to use skeleton
ts = ts.replace(
  /function avatarImgHtml\(user: MessengerUser \| null \| undefined, size: number, fallbackLetter: string\): string \{[\s\S]*?return `<span class="msgr-avatar__fallback"[^>]*>.*?<\/span>`;\n  \}/,
  `function avatarImgHtml(user: MessengerUser | null | undefined, size: number, fallbackLetter: string): string {
    if (!user) {
      return \`<div class="msgr-avatar__skeleton" style="width:\${size}px; height:\${size}px; border-radius: 50%;"></div>\`;
    }
    ensureAvatar(user);
    const url = avatarCache.get(user.id) || avatarUrlSync(user);
    const idAttr = host!.escapeHtml(user.id);
    if (url) {
      return \`<img class="msgr-avatar__skeleton" data-msgr-user="\${idAttr}" src="\${host!.escapeHtml(url)}" alt="" width="\${size}" height="\${size}" style="border-radius: 50%; object-fit: cover;">\`;
    }
    return \`<img class="msgr-avatar__skeleton" data-msgr-user="\${idAttr}" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" data-size="\${size}" alt="" width="\${size}" height="\${size}" style="border-radius: 50%; object-fit: cover;">\`;
  }`
);

fs.writeFileSync('src/renderer/messenger/ui.ts', ts, 'utf8');
console.log('Updated ui.ts avatarImgHtml');
