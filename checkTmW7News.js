const fs = require('fs');
const content = fs.readFileSync('C:/Users/PC-25/AppData/Roaming/Cursor/User/History/-4c05a7/TmW7.html', 'utf8');
const match = content.match(/<div class="tab-view" id="tab-news">.*?<!-- Skins Tab -->/s);
console.log(match ? match[0] : "Not found");
