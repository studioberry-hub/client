const fs = require('fs');
let html = fs.readFileSync('src/renderer/index.html', 'utf8');
html = html.replace(/<div class="name">Kolibra Group<\/div>\s*<div class="role" data-i18n="about\.kolibraRole">.*?<\/div>\s*<\/div>/, '<div class="name">Kolibra Group</div>\n            <div class="role" data-i18n="about.kolibraRole">Основной разработчик клиента</div>\n          </div>\n          <div class="about-author-chip linux-only">\n            <div class="name">Hanoka</div>\n            <div class="role" data-i18n="about.hanokaRole">Реализовал поддержку Linux для вас</div>\n          </div>');
fs.writeFileSync('src/renderer/index.html', html);
