const fs = require('fs');
const html = fs.readFileSync('src/renderer/index.html', 'utf8');
const mIdx = html.indexOf('<div id="modal-sf-post"');
console.log(html.substring(mIdx, mIdx + 500));
