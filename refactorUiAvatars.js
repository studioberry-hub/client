const fs = require('fs');
let ts = fs.readFileSync('src/renderer/messenger/ui.ts', 'utf8');

// Replace avatar cache logic
ts = ts.replace(
  /const avatarCache = new Map<string, string>\(\);/,
  `const avatarCache = new Map<string, string>();
const msgrAvatarStyle = document.createElement('style');
msgrAvatarStyle.id = 'msgr-avatar-styles';
document.head.appendChild(msgrAvatarStyle);

msgrAvatarStyle.sheet?.insertRule(\`
  @keyframes avatarWave {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
\`, 0);
msgrAvatarStyle.sheet?.insertRule(\`
  .msgr-avatar-node {
    display: inline-block;
    background: linear-gradient(90deg, #3a3a3a 25%, #4a4a4a 50%, #3a3a3a 75%);
    background-size: 200% 100%;
    animation: avatarWave 1.5s infinite linear;
    border-radius: 50%;
    background-position: center;
    background-repeat: no-repeat;
    overflow: hidden;
  }
\`, 1);

function setAvatarCache(userId: string, url: string) {
  if (!url || avatarCache.get(userId) === url) return;
  avatarCache.set(userId, url);
  const safeId = userId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const cssUrl = url.replace(/'/g, "%27").replace(/"/g, "%22");
  msgrAvatarStyle.sheet?.insertRule(
    \`.avatar-node-\${safeId} { background-image: url('\${cssUrl}') !important; background-size: cover !important; animation: none !important; }\`,
    msgrAvatarStyle.sheet.cssRules.length
  );
}
`
);

// Replace avatarCache.set calls
ts = ts.replace(/avatarCache\.set\(([^,]+),\s*([^)]+)\)/g, 'setAvatarCache($1, $2)');

// Rewrite applyAvatarsInDom to just be empty (CSS handles it now)
ts = ts.replace(
  /function applyAvatarsInDom\(userId: string\): void \{[\s\S]*?\}\n/,
  `function applyAvatarsInDom(userId: string): void {
  // CSS handles DOM updates automatically via .avatar-node-\${safeId} classes
}\n`
);

// Update avatarImgHtml to return the span
ts = ts.replace(
  /function avatarImgHtml\(user: MessengerUser \| null \| undefined, size: number, fallbackLetter: string\): string \{[\s\S]*?return `<span class="msgr-avatar__fallback"[^>]*>.*?<\/span>`;\n  \}/,
  `function avatarImgHtml(user: MessengerUser | null | undefined, size: number, fallbackLetter: string): string {
    if (!user) {
      return \`<span class="msgr-avatar-node" style="width:\${size}px; height:\${size}px;"></span>\`;
    }
    ensureAvatar(user);
    const safeId = user.id.replace(/[^a-zA-Z0-9_-]/g, '_');
    
    // We call avatarUrlSync to trigger sync load if possible (like MSA)
    const url = avatarUrlSync(user);
    if (url) setAvatarCache(user.id, url);

    return \`<span class="msgr-avatar-node avatar-node-\${safeId}" data-msgr-user="\${host!.escapeHtml(user.id)}" style="width:\${size}px; height:\${size}px; min-width:\${size}px;"></span>\`;
  }`
);

fs.writeFileSync('src/renderer/messenger/ui.ts', ts, 'utf8');
console.log('ui.ts updated with CSS-based avatars');
