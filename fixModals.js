const fs = require('fs');
let html = fs.readFileSync('src/renderer/index.html', 'utf8');
html = html.replace(/<div id="modal-sf-post" class="modal-overlay hidden sf-modal">\s*<div class="modal-card">/, '<div id="modal-sf-post" class="modal-overlay hidden sf-modal">\n    <div class="modal-window sf-post-window">');
html = html.replace(/<div id="modal-sf-compose" class="modal-overlay hidden sf-compose-modal">\s*<div class="modal-card">/, '<div id="modal-sf-compose" class="modal-overlay hidden sf-compose-modal">\n    <div class="modal-window md">');
fs.writeFileSync('src/renderer/index.html', html);
console.log('Fixed modal classes in index.html');
