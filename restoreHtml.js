const fs = require('fs');
const tmw7 = fs.readFileSync('C:/Users/PC-25/AppData/Roaming/Cursor/User/History/-4c05a7/TmW7.html', 'utf8');
let current = fs.readFileSync('src/renderer/index.html', 'utf8');

const newsMatch = tmw7.match(/<div class="tab-view" id="tab-news">.*?<!-- Skins Tab -->/s);
const modalsMatch = tmw7.match(/<div id="modal-sf-post" class="modal-overlay hidden sf-modal">.*?<\/div>\s*<\/div>\s*<\/div>\s*<div id="modal-sf-compose" class="modal-overlay hidden sf-compose-modal">.*?<\/div>\s*<\/div>\s*<\/div>/s);

// Replace tab-news
if (newsMatch) {
  current = current.replace(/<div class="tab-view" id="tab-news">.*?<!-- Skins Tab -->/s, newsMatch[0]);
}

// Remove all my injected modals
current = current.replace(/<!-- Social Feed Modals -->.*?<div id="modal-ai-access"/s, '<div id="modal-ai-access"');

// Inject the original modals
if (modalsMatch) {
  current = current.replace(/<div id="modal-ai-access"/, modalsMatch[0] + '\n\n  <div id="modal-ai-access"');
}

fs.writeFileSync('src/renderer/index.html', current);
console.log("Restored HTML successfully.");
