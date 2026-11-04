const fs = require('fs');

const restoreNews = fs.readFileSync('D:/vbProj/uclient/_restore_news.html', 'utf8');
const restoreModals = fs.readFileSync('D:/vbProj/uclient/_restore_modals.html', 'utf8');

let html = fs.readFileSync('D:/vbProj/uclient/src/renderer/index.html', 'utf8');

// Replace tab-news
html = html.replace(/<div class="tab-view" id="tab-news">[\s\S]*?<!-- Skins Tab -->/, restoreNews + '\\n\\n        <!-- Skins Tab -->');

// Replace modals
html = html.replace(/<div id="modal-sf-post"[\s\S]*?(?=<div id="modal-ai-access")/, restoreModals + '\\n  ');

fs.writeFileSync('D:/vbProj/uclient/src/renderer/index.html', html);
console.log('Restored exactly from Cursor files.');
