const fs = require('fs');
const html = fs.readFileSync('src/renderer/index.html', 'utf8');
const newsIdx = html.indexOf('<div class="tab-view" id="tab-news">');
console.log(html.substring(newsIdx, newsIdx + 500));
