const fs = require('fs');
let html = fs.readFileSync('src/renderer/index.html', 'utf8');

// ===== modal-sf-post =====
html = html.replace(
  /id="sf-modal-title">([^<]+)<\/h2>/,
  'id="sf-modal-title">Пост</h2>'
);

// ===== modal-sf-compose =====
html = html.replace(
  /id="sf-compose-title">([^<]+)<\/h2>/,
  'id="sf-compose-title">Новый пост</h2>'
);
// Fix hints
html = html.replace(
  /class="news-composer__hint">([^<]+)<\/span>/,
  'class="news-composer__hint">Markdown · JPEG до 6 фото</span>'
);
// Fix "От имени"
html = html.replace(
  /data-i18n="news\.postAs">([^<]+)<\/label>/,
  'data-i18n="news.postAs">От имени</label>'
);
// Fix clan explanation
html = html.replace(
  /class="news-composer__clan-hint"[^>]*>([^<]*(?:<[^/][^<]*)*)<\/div>/,
  function(match) {
    return match.replace(/>([^<]+)<\/div>$/, '>Клан — сообщество/канал. Создай его кнопкой ниже, затем публикуй посты от его имени.</div>');
  }
);
// Fix "Фото"
html = html.replace(
  /data-i18n="news\.photo">([^<]+)<\/span>/,
  'data-i18n="news.photo">Фото</span>'
);
// Fix "Создать клан" (button in compose modal)
html = html.replace(
  /data-i18n="news\.createClan">([^<]+)<\/span>/g,
  'data-i18n="news.createClan">Создать клан</span>'
);
// Fix "Опубликовать"
html = html.replace(
  /data-i18n="news\.publish">([^<]+)<\/button>/,
  'data-i18n="news.publish">Опубликовать</button>'
);

fs.writeFileSync('src/renderer/index.html', html, 'utf8');
console.log('Phase 2: compose modal text fixed');
