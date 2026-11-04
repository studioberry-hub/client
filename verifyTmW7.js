const fs = require('fs');
const content = fs.readFileSync('C:/Users/PC-25/AppData/Roaming/Cursor/User/History/-4c05a7/TmW7.html', 'utf8');

const newsMatch = content.match(/<div class="tab-view" id="tab-news">.*?<!-- Skins Tab -->/s);
const modalsMatch = content.match(/<div id="modal-sf-post" class="modal-overlay hidden sf-modal">.*?<\/div>\s*<\/div>\s*<\/div>\s*<div id="modal-sf-compose" class="modal-overlay hidden sf-compose-modal">.*?<\/div>\s*<\/div>\s*<\/div>/s);

console.log("News Match Length:", newsMatch ? newsMatch[0].length : 0);
console.log("Modals Match Length:", modalsMatch ? modalsMatch[0].length : 0);
