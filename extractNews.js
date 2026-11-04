const fs = require('fs');
const files = fs.readdirSync('C:/Users/PC-25/AppData/Roaming/Cursor/User/History/-4c05a7/');
const target = files.sort((a,b) => fs.statSync('C:/Users/PC-25/AppData/Roaming/Cursor/User/History/-4c05a7/' + b).mtime - fs.statSync('C:/Users/PC-25/AppData/Roaming/Cursor/User/History/-4c05a7/' + a))[0];
const content = fs.readFileSync('C:/Users/PC-25/AppData/Roaming/Cursor/User/History/-4c05a7/' + target, 'utf8');
const match = content.match(/<div class="tab-view" id="tab-news">.*?<!-- Skins Tab -->/s);
if (match) {
  fs.writeFileSync('extracted_news.html', match[0]);
}
