const fs = require('fs');
let code = fs.readFileSync('src/renderer/messenger/ui.ts', 'utf8');

const formatBodyFunc = `
function formatMessageBodyHtml(m: MessengerMessage): string {
  if (!m.body) return '';
  if (m.attachment && m.body === m.attachment.name) return '';

  let html = host?.escapeHtml(m.body) || '';

  // 1. Repost rich tile
  if (m.kind === 'news_repost' && m.meta) {
    const meta = m.meta as any;
    const thumbHtml = meta.thumbnail ? \`<img class="sf-repost-tile-img" src="\${host?.escapeHtml(meta.thumbnail)}" alt="">\` : '';
    const tileHtml = \`
      <div class="sf-repost-tile" data-sf-repost="\${host?.escapeHtml(meta.postId || '')}">
        \${thumbHtml}
        <div class="sf-repost-tile-content">
          <div class="sf-repost-tile-author">\${host?.escapeHtml(meta.author || '')}</div>
          <div class="sf-repost-tile-snippet">\${host?.escapeHtml(meta.snippet || '')}</div>
        </div>
      </div>
    \`;
    // The backend prepends some text like "Р РµРїРѕСЃС‚ ..." we can just hide it completely or render the tile below it
    // Actually, we can just return the tile and the text above it.
    html = html.replace(/&#128257; Репост.*\\n\\n#post:.*$/s, ''); // try to remove the boilerplate if present
    html = html.trim();
    if (html) {
      return \`<div class="msgr-bubble__text">\${html}</div>\${tileHtml}\`;
    }
    return tileHtml;
  }

  // 2. Clickable Links and Shared Builds / Chats
  let hasSpecialTile = '';

  const urlRegex = /(https?:\\/\\/[^\\s]+)/g;
  html = html.replace(urlRegex, (url) => {
    // Check if it's a shared build
    if (url.includes('/client/instanceShare/')) {
      const shareId = url.split('/client/instanceShare/')[1]?.split(/[?#]/)[0];
      if (shareId) {
        hasSpecialTile += \`
          <div class="msgr-share-tile">
            <div class="msgr-share-tile-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
            </div>
            <div class="msgr-share-tile-info">
              <div class="msgr-share-tile-title">Поделились сборкой</div>
              <button type="button" class="stngs-btn primary msgr-share-btn" data-share-id="\${host?.escapeHtml(shareId)}">Открыть</button>
            </div>
          </div>
        \`;
        return ''; // Remove URL from text
      }
    }
    // Check if it's a shared chat
    if (url.includes('/client/msgr/')) {
      const inviteId = url.split('/client/msgr/')[1]?.split(/[?#]/)[0];
      if (inviteId) {
        hasSpecialTile += \`
          <div class="msgr-share-tile">
            <div class="msgr-share-tile-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
            </div>
            <div class="msgr-share-tile-info">
              <div class="msgr-share-tile-title">Приглашение в чат</div>
              <button type="button" class="stngs-btn primary msgr-join-chat-btn" data-invite-id="\${host?.escapeHtml(inviteId)}">Присоединиться</button>
            </div>
          </div>
        \`;
        return ''; // Remove URL from text
      }
    }
    return \`<a href="\${host?.escapeHtml(url)}" target="_blank" class="msgr-link" rel="noopener noreferrer">\${host?.escapeHtml(url)}</a>\`;
  });

  html = html.trim();
  let finalHtml = '';
  if (html) finalHtml += \`<div class="msgr-bubble__text">\${html}</div>\`;
  if (hasSpecialTile) finalHtml += hasSpecialTile;
  
  return finalHtml;
}
`;

code = code.replace(
  /function formatMsgTime/,
  formatBodyFunc + '\nfunction formatMsgTime'
);

code = code.replace(
  /m\.body && \(\!m\.attachment \|\| m\.body \!\=\= m\.attachment\.name\)\n\s*\? `<div class="msgr-bubble__text">\$\{host!\.escapeHtml\(m\.body\)\}<\/div>`\n\s*: '';/,
  "formatMessageBodyHtml(m);"
);

fs.writeFileSync('src/renderer/messenger/ui.ts', code, 'utf8');
console.log('Added rich text formatter');
