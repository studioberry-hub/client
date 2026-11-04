const fs = require('fs');
let html = fs.readFileSync('src/renderer/index.html', 'utf8');
html = html.replace(/\\n\\n/g, '\n\n'); // Replace literal '\n\n' with actual newlines
fs.writeFileSync('src/renderer/index.html', html);
console.log('Fixed literal newlines');
