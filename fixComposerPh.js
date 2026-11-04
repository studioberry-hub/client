const fs = require('fs');
let html = fs.readFileSync('src/renderer/index.html', 'utf8');

// Fix the garbled placeholder in the textarea
html = html.replace(
  /placeholder="[^"]*"\s*(data-i18n-placeholder="news\.composerPlaceholder")/,
  'placeholder="Что нового? Markdown поддерживается" $1'
);

fs.writeFileSync('src/renderer/index.html', html, 'utf8');
console.log('Fixed composerPlaceholder in HTML');
