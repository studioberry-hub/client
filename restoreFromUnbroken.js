const fs = require('fs');

const unbrokenHtml = fs.readFileSync('D:/vbProj/uclient/src-unbroken/renderer/index.html', 'utf8');
let currentHtml = fs.readFileSync('D:/vbProj/uclient/src/renderer/index.html', 'utf8');

// 1. Replace tab-news
const newsMatch = unbrokenHtml.match(/<div class="tab-view" id="tab-news">[\s\S]*?<!-- Skins Tab -->/);
if (newsMatch) {
  currentHtml = currentHtml.replace(/<div class="tab-view" id="tab-news">[\s\S]*?<!-- Skins Tab -->/, newsMatch[0]);
}

// 2. Replace all sf- modals
const modalsMatch = unbrokenHtml.match(/<div id="modal-sf-post"[\s\S]*?(?=<div id="modal-ai-access")/);
if (modalsMatch) {
  // Remove existing sf- modals from currentHtml
  currentHtml = currentHtml.replace(/<div id="modal-sf-post"[\s\S]*?(?=<div id="modal-ai-access")/, '');
  // Inject unbroken modals
  currentHtml = currentHtml.replace(/<div id="modal-ai-access"/, modalsMatch[0] + '\n  <div id="modal-ai-access"');
}

fs.writeFileSync('D:/vbProj/uclient/src/renderer/index.html', currentHtml);
console.log('Restored index.html pieces from src-unbroken.');
