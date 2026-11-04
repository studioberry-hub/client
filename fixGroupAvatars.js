const fs = require('fs');
let ts = fs.readFileSync('src/renderer/messenger/ui.ts', 'utf8');

ts = ts.replace(
  /function groupAvatarHtml\(conv: MessengerConversation, size: number\): string \{[\s\S]*?return `<span class="msgr-avatar__fallback">\$\{letter\}<\/span>`;\n  \}/,
  `function groupAvatarHtml(conv: MessengerConversation, size: number): string {
    const letter = host!.escapeHtml((conv.title || '?').slice(0, 1));
    if (conv.avatarUrl) {
      const url = resolveMsgrMediaUrl(conv.avatarUrl, conv.updatedAt);
      const cssUrl = url.replace(/'/g, "%27").replace(/"/g, "%22");
      return \`<span class="msgr-avatar-node" style="width:\${size}px; height:\${size}px; min-width:\${size}px; background-image: url('\${cssUrl}'); background-size: cover; animation: none;"></span>\`;
    }
    // Fallback letter instead of wave if no avatar is set for group
    return \`<span class="msgr-avatar__fallback" style="width:\${size}px; height:\${size}px; line-height:\${size}px;">\${letter}</span>\`;
  }`
);

fs.writeFileSync('src/renderer/messenger/ui.ts', ts, 'utf8');
