const fs = require('fs');
let html = fs.readFileSync('src/renderer/index.html', 'utf8');

// ===== tab-news section =====
// Header
html = html.replace(
  /data-i18n="tab\.news">([^<]+)<\/h1>/,
  'data-i18n="tab.news">Новости</h1>'
);
html = html.replace(
  /data-i18n="news\.subtitle">([^<]+)<\/p>/,
  'data-i18n="news.subtitle">Лента сообщества и новости лаунчера</p>'
);
html = html.replace(
  /data-i18n="news\.refresh">([^<]+)<\/span>/,
  'data-i18n="news.refresh">Обновить</span>'
);

// Wall header
html = html.replace(
  /aria-label="[^"]*"(\s+class="nr-wall")/,
  'aria-label="Стена"$1'
);
html = html.replace(
  /title="[^"]*">\s*<span data-i18n="news\.wall">([^<]+)<\/span>/,
  'title="Стена"><span data-i18n="news.wall">Стена</span>'
);

// Feed type selector
html = html.replace(
  /aria-label="[^"]*"(\s+class="nr-wall__type-select")/,
  'aria-label="Тип ленты"$1'
);
html = html.replace(
  /data-i18n="news\.wall">([^<]+)<\/span>\s*<\/option>/g,
  'data-i18n="news.wall">Лента сообщества</span></option>'
);
html = html.replace(
  /data-i18n="news\.clientNews">([^<]+)<\/span>/g,
  'data-i18n="news.clientNews">Новости клиента</span>'
);

// Notification button
html = html.replace(
  /aria-label="[^"]*"(\s+id="sf-notif-btn")/,
  'aria-label="Уведомления"$1'
);
html = html.replace(
  /title="[^"]*"(\s+id="sf-notif-btn")/,
  'title="Уведомления"$1'
);

// New post button
html = html.replace(
  /aria-label="[^"]*"(\s+id="sf-new-post-btn")/,
  'aria-label="Новый пост"$1'
);
html = html.replace(
  /title="[^"]*"(\s+id="sf-new-post-btn")/,
  'title="Новый пост"$1'
);

fs.writeFileSync('src/renderer/index.html', html, 'utf8');
console.log('Phase 1: tab-news hardcoded text fixed');
