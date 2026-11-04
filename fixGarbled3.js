const fs = require('fs');
let html = fs.readFileSync('src/renderer/index.html', 'utf8');

// ===== modal-sf-clan =====
html = html.replace(
  /id="sf-clan-title">([^<]+)<\/h2>/,
  'id="sf-clan-title">Создать клан</h2>'
);
// Clan subtitle
html = html.replace(
  /data-i18n="news\.clanSub">([^<]+)<\/p>/,
  'data-i18n="news.clanSub">Сообщество с постами и чатом</p>'
);
// Clan explain
html = html.replace(
  /data-i18n="news\.clanExplain">([^<]+)<\/p>/,
  'data-i18n="news.clanExplain">Клан — канал сообщества (сервер, гильдия, интерес). Владелец и админы публикуют посты от имени клана; при создании создаётся чат.</p>'
);
// Clan icon label
html = html.replace(
  /data-i18n="news\.clanIcon">([^<]+)<\/label>/,
  'data-i18n="news.clanIcon">Иконка клана</label>'
);
// Clan icon hint
html = html.replace(
  /data-i18n="news\.clanIconHint">([^<]+)<\/span>/,
  'data-i18n="news.clanIconHint">JPEG, квадрат. Можно задать при создании или позже.</span>'
);
// Clan name label
html = html.replace(
  /data-i18n="news\.clanName">([^<]+)<\/label>/,
  'data-i18n="news.clanName">Название</label>'
);
// Clan name placeholder
html = html.replace(
  /id="sf-clan-name"[^>]*placeholder="[^"]*"/,
  function(m) { return m.replace(/placeholder="[^"]*"/, 'placeholder="Например: Vialand"'); }
);
// Clan desc label
html = html.replace(
  /data-i18n="news\.clanDesc">([^<]+)<\/label>/,
  'data-i18n="news.clanDesc">Описание</label>'
);
// Clan desc placeholder
html = html.replace(
  /id="sf-clan-desc"[^>]*placeholder="[^"]*"/,
  function(m) { return m.replace(/placeholder="[^"]*"/, 'placeholder="Кратко о сообществе"'); }
);
// Cancel button
html = html.replace(
  /id="sf-clan-cancel"[^>]*>([^<]+)<\/button>/,
  'id="sf-clan-cancel" data-i18n="btn.cancel">Отмена</button>'
);
// Create clan submit button
html = html.replace(
  /id="sf-clan-submit"[^>]*>([^<]+)<\/button>/,
  'id="sf-clan-submit" data-i18n="news.createClan">Создать клан</button>'
);

// ===== modal-sf-repost =====
html = html.replace(
  /id="sf-repost-title">([^<]+)<\/h2>/,
  'id="sf-repost-title">Репост</h2>'
);
html = html.replace(
  /data-i18n="news\.repostSub">([^<]+)<\/p>/,
  'data-i18n="news.repostSub">На стену или в чаты</p>'
);
html = html.replace(
  /data-i18n="news\.repostWall">([^<]+)<\/span>/,
  'data-i18n="news.repostWall">На стену</span>'
);
html = html.replace(
  /data-i18n="news\.repostChats">([^<]+)<\/span>/,
  'data-i18n="news.repostChats">В чаты</span>'
);
html = html.replace(
  /data-i18n="news\.repostComment">([^<]+)<\/label>/,
  'data-i18n="news.repostComment">Комментарий к репосту</label>'
);
// Repost comment placeholder
html = html.replace(
  /id="sf-repost-comment"[^>]*placeholder="[^"]*"/,
  function(m) { return m.replace(/placeholder="[^"]*"/, 'placeholder="Необязательно"'); }
);
// Cancel
html = html.replace(
  /id="sf-repost-cancel"[^>]*>([^<]+)<\/button>/,
  'id="sf-repost-cancel" data-i18n="btn.cancel">Отмена</button>'
);
// Send
html = html.replace(
  /id="sf-repost-submit"[^>]*>([^<]+)<\/button>/,
  'id="sf-repost-submit" data-i18n="news.repostSend">Отправить</button>'
);

fs.writeFileSync('src/renderer/index.html', html, 'utf8');
console.log('Phase 3: clan and repost modals fixed');
