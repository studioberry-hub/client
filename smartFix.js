const fs = require('fs');
let html = fs.readFileSync('src/renderer/index.html', 'utf8');

// The mojibake is double-encoded UTF-8. The src-unbroken file was saved 
// with the wrong encoding. The text between tags will be replaced by i18n 
// at runtime anyway. But hardcoded fallback text and attributes still need fixing.
// 
// Strategy: since all visible text has data-i18n attributes, the garbled 
// fallback text inside the tags doesn't matter at runtime (i18n replaces it).
// BUT attributes like placeholder, title, aria-label DO need to be correct.
//
// Let's just blank out garbled inner text (i18n will fill it) and fix attributes.

const nsI = html.indexOf('<div class="tab-view" id="tab-news">');
const meI = html.indexOf('<div id="modal-ai-access"');
let section = html.substring(nsI, meI);

// Detect mojibake: contains chars like Р followed by combining marks from CP1252 range
const isMojibake = (str) => /\u0420[\u0400-\u04FF\u00A0-\u00FF]|\u0421[\u0080-\u00FF\u2000-\u206F]/.test(str) && 
  /[\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u2039\u0152\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u203A\u0153]/.test(str);

// Replace garbled inner text with clean fallback based on data-i18n key
const i18nFallbacks = {
  'tab.news': 'Новости',
  'news.subtitle': 'Лента сообщества и новости лаунчера',
  'news.refresh': 'Обновить',
  'news.wall': 'Стена',
  'news.clientNews': 'Новости клиента',
  'news.feedCommunity': 'Сообщество',
  'news.feedEmpty': 'Лента пуста',
  'news.loading': 'Загрузка...',
  'news.newPost': 'Новый пост',
  'news.newPostSub': 'Поделитесь чем-то с сообществом',
  'news.postAs': 'ОТ ИМЕНИ',
  'news.postAsSelf': 'Личный аккаунт',
  'news.clanHint': 'Или от имени клана (скоро)',
  'news.photo': 'Прикрепить',
  'news.createClan': 'Создать клан',
  'news.publish': 'Опубликовать',
  'news.openPost': 'Пост',
  'news.clanSub': 'Сообщество с постами и чатом',
  'news.clanExplain': 'Клан — канал сообщества. Владелец и админы публикуют посты от имени клана.',
  'news.clanIcon': 'Иконка клана',
  'news.clanIconHint': 'JPEG, квадрат. Можно задать при создании или позже.',
  'news.clanName': 'НАЗВАНИЕ',
  'news.clanDesc': 'ОПИСАНИЕ',
  'btn.cancel': 'Отмена',
  'news.repostTitle': 'Репост',
  'news.repostSub': 'На стену или в чаты',
  'news.repostWall': 'На стену',
  'news.repostChats': 'В чаты',
  'news.repostComment': 'Комментарий к репосту',
  'news.repostNoChats': 'Нет доступных чатов',
  'news.repostSend': 'Отправить',
  'news.composerPlaceholder': 'Что нового? Markdown поддерживается',
  'news.repostCommentPh': 'Необязательно',
  'news.notificationsSoon': 'Уведомления (скоро)',
};

// Fix elements with data-i18n: replace garbled inner text with correct fallback
for (const [key, val] of Object.entries(i18nFallbacks)) {
  // Match: data-i18n="key">garbled</tag  
  const re = new RegExp('(data-i18n="' + key.replace(/\./g, '\\.') + '"[^>]*>)([^<]*)(</)', 'g');
  section = section.replace(re, (m, before, text, after) => {
    if (isMojibake(text) || text.trim() === '') {
      return before + val + after;
    }
    return m;
  });
}

// Fix data-i18n-placeholder
section = section.replace(/(data-i18n-placeholder="news\.composerPlaceholder")/g, (m) => m);
// Fix placeholder attributes that have mojibake
section = section.replace(/placeholder="([^"]+)"/g, (m, val) => {
  if (isMojibake(val)) {
    // Try to guess based on context
    if (m.includes('sf-clan-name') || section.indexOf(m) > section.indexOf('sf-clan-name') - 200) {
      return 'placeholder="Например: Vialand"';
    }
    if (m.includes('sf-clan-desc') || section.indexOf(m) > section.indexOf('sf-clan-desc') - 200) {
      return 'placeholder="Кратко о сообществе"';
    }
    if (m.includes('sf-repost-comment') || section.indexOf(m) > section.indexOf('sf-repost-comment') - 200) {
      return 'placeholder="Необязательно"';
    }
    if (m.includes('sf-composer-input') || section.indexOf(m) > section.indexOf('sf-composer-input') - 200) {
      return 'placeholder="Что нового? Markdown поддерживается"';
    }
    return 'placeholder=""'; // fallback - i18n will fill it
  }
  return m;
});

// Fix title and aria-label attributes with mojibake
section = section.replace(/(title|aria-label)="([^"]+)"/g, (m, attr, val) => {
  if (isMojibake(val)) {
    // Guess from nearby IDs/context
    if (val.length < 15) return attr + '="Стена"';
    if (val.length < 25 && val.includes('\u0420')) return attr + '="Уведомления"';  
    return attr + '=""'; // i18n will handle
  }
  return m;
});

// Fix specific aria-labels by their element context
section = section.replace(/aria-label="[^"]*"(\s*class="nr-wall")/g, 'aria-label="Стена"$1');
section = section.replace(/title="[^"]*"(\s*(?:id="sf-wall-type"|class="nr-wall__title))/g, 'title="Стена"$1');
section = section.replace(/aria-label="[^"]*"(\s*(?:id="sf-notif-btn"|class="nr-wall__notif))/g, 'aria-label="Уведомления"$1');
section = section.replace(/title="[^"]*"(\s*(?:id="sf-notif-btn"|class="nr-wall__notif))/g, 'title="Уведомления"$1');
section = section.replace(/aria-label="[^"]*"(\s*(?:id="sf-new-post-btn"|class="nr-wall__new))/g, 'aria-label="Новый пост"$1');
section = section.replace(/title="[^"]*"(\s*(?:id="sf-new-post-btn"|class="nr-wall__new))/g, 'title="Новый пост"$1');

// Fix garbled text NOT covered by data-i18n (plain inner text)
section = section.replace(/>([^<]{2,})</g, (m, text) => {
  if (isMojibake(text)) {
    // These are fallback texts that i18n should replace. Just clean them.
    return '><';
  }
  return m;
});

// Fix specific known garbled placeholders by finding them near their IDs
const placeholderFixes = [
  ['sf-composer-input', 'Что нового? Markdown поддерживается'],
  ['sf-clan-name', 'Например: Vialand'],
  ['sf-clan-desc', 'Кратко о сообществе'],
  ['sf-repost-comment', 'Необязательно'],
];
for (const [id, ph] of placeholderFixes) {
  const idIdx = section.indexOf('id="' + id + '"');
  if (idIdx >= 0) {
    // Find the placeholder within 300 chars
    const chunk = section.substring(idIdx, idIdx + 300);
    const phMatch = chunk.match(/placeholder="[^"]*"/);
    if (phMatch) {
      const fixed = 'placeholder="' + ph + '"';
      section = section.substring(0, idIdx) + 
        section.substring(idIdx, idIdx + 300).replace(phMatch[0], fixed) + 
        section.substring(idIdx + 300);
    }
  }
}

html = html.substring(0, nsI) + section + html.substring(meI);
fs.writeFileSync('src/renderer/index.html', html, 'utf8');

// Final check
const check = fs.readFileSync('src/renderer/index.html', 'utf8');
const ns2 = check.indexOf('id="tab-news"');
const me2 = check.indexOf('id="modal-ai-access"');
const s2 = check.substring(ns2, me2);
console.log('news-remaster:', s2.includes('news-remaster'));
console.log('nr-wall:', s2.includes('nr-wall'));
console.log('sf-wall-avatar:', s2.includes('sf-wall-avatar'));
console.log('modal-sf-compose:', s2.includes('modal-sf-compose'));
console.log('modal-sf-clan:', s2.includes('modal-sf-clan'));
console.log('modal-sf-repost:', s2.includes('modal-sf-repost'));

const mojibakeCount = (s2.match(/[\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u2039\u0152\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u203A\u0153]/g) || []).length;
console.log('Mojibake chars remaining:', mojibakeCount);
