const fs = require('fs');
let ts = fs.readFileSync('src/renderer/social-feed.ts', 'utf8');

ts = ts.replace(
  /function avatarImgBits\(opts: AvatarOpts\): \{ src: string; attr: string \} \{[\s\S]*?return \{ src, attr \};\n  \}/,
  `function avatarImgBits(opts: AvatarOpts): { src: string; attr: string } {
    const key = avatarKey(opts);
    const url = resolveAvatar(opts);
    const src = url || 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    const attr = key && host ? \` data-sf-avatar="\${host.escapeHtml(key)}"\` : '';
    return { src, attr };
  }`
);

// Add skeleton class and onload to all social-feed avatars
ts = ts.replace(/<img class="([^"]*avatar[^"]*)"/g, '<img class="$1 msgr-avatar__skeleton" onload="this.classList.remove(\'msgr-avatar__skeleton\')"');

fs.writeFileSync('src/renderer/social-feed.ts', ts, 'utf8');
console.log('Updated social-feed.ts avatars');
