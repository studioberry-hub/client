const fs = require('fs');

// 1. Update MessengerHost in ui.ts
let uiCode = fs.readFileSync('src/renderer/messenger/ui.ts', 'utf8');
uiCode = uiCode.replace(
  'openInstanceShare?: (shareId: string) => void | Promise<void>;',
  'openInstanceShare?: (shareId: string) => void | Promise<void>;\n  openOfficialNews?: (postId: string) => void;'
);

// 2. Add click handlers for rich elements in ui.ts
const clickHandlers = `
    const target = e.target as HTMLElement;
    const shareBtn = target.closest('.msgr-share-btn') as HTMLElement | null;
    if (shareBtn) {
      e.preventDefault();
      const shareId = shareBtn.getAttribute('data-share-id');
      if (shareId && host?.openInstanceShare) {
        void host.openInstanceShare(shareId);
      }
      return;
    }
    const joinBtn = target.closest('.msgr-join-chat-btn') as HTMLElement | null;
    if (joinBtn) {
      e.preventDefault();
      const token = joinBtn.getAttribute('data-invite-id');
      if (token) {
        joinBtn.setAttribute('disabled', 'true');
        req('/invites/' + encodeURIComponent(token) + '/join', { method: 'POST' }).then(res => {
          joinBtn.removeAttribute('disabled');
          if (res.ok) {
            void loadConversations();
          } else {
            toast(host?.t('msgr.error') || 'Error');
          }
        });
      }
      return;
    }
    const repostTile = target.closest('.sf-repost-tile') as HTMLElement | null;
    if (repostTile) {
      e.preventDefault();
      const postId = repostTile.getAttribute('data-sf-repost');
      if (postId && host?.openOfficialNews) {
        host.openOfficialNews(postId);
      }
      return;
    }
`;

uiCode = uiCode.replace(
  "const messagesEl = $('msgr-messages');\n  messagesEl?.addEventListener('scroll', () => {",
  "const messagesEl = $('msgr-messages');\n  messagesEl?.addEventListener('scroll', () => {"
);
uiCode = uiCode.replace(
  "messagesEl?.addEventListener('click', (e) => {",
  "messagesEl?.addEventListener('click', (e) => {\n" + clickHandlers
);

fs.writeFileSync('src/renderer/messenger/ui.ts', uiCode, 'utf8');

// 3. Update initMessenger in app.ts to pass openOfficialNews
let appCode = fs.readFileSync('src/renderer/app.ts', 'utf8');
appCode = appCode.replace(
  'getLauncherStats: () => {',
  'openOfficialNews: (id) => void openModalNews(id),\n      getLauncherStats: () => {'
);
fs.writeFileSync('src/renderer/app.ts', appCode, 'utf8');

console.log('Added rich elements click handlers and updated MessengerHost');
