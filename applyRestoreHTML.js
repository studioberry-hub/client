const fs = require('fs');

let index = fs.readFileSync('src/renderer/index.html', 'utf8');
const restoreNews = fs.readFileSync('_restore_news.html', 'utf8');
const restoreModals = fs.readFileSync('_restore_modals.html', 'utf8');

// Replace tab-news
index = index.replace(/<div class="tab-view" id="tab-news">[\s\S]*?<!-- Skins Tab -->/, restoreNews);

// Replace modals
// Wait, what is the exact boundary for modals?
// The user's regex for restoring modals was: /<div id="modal-sf-post"[\s\S]*?(?=<div id="modal-ai-access")/
// So we replace the same range in index.html
index = index.replace(/<div id="modal-sf-post"[\s\S]*?(?=<div id="modal-ai-access")/, restoreModals);

fs.writeFileSync('src/renderer/index.html', index, 'utf8');
console.log('Restored news and modals from Cursor backups');
