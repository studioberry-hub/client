const fs = require('fs');
const p = 'C:/Users/PC-25/AppData/Roaming/Cursor/User/History/-4c05a7/TmW7.html';
const h = fs.readFileSync(p, 'utf8');
const m1 = h.match(/<div class="tab-view" id="tab-news">[\s\S]*?<!-- Skins Tab -->/);
const m2 = h.match(/<div id="modal-sf-post"[\s\S]*?(?=<div id="modal-ai-access")/);
console.log('news len', m1 ? m1[0].length : 0);
console.log('modals len', m2 ? m2[0].length : 0);
if (m1) fs.writeFileSync('D:/vbProj/uclient/_restore_news.html', m1[0]);
if (m2) fs.writeFileSync('D:/vbProj/uclient/_restore_modals.html', m2[0]);
