const fs = require('fs');
let html = fs.readFileSync('src/renderer/index.html', 'utf8');

// Map of garbled -> correct text
const fixes = [
  // tab-news section hardcoded text
  ['>Новости</h1>', '>Новости</h1>'],
  ['>Лента сообщества и новости лаунчера</p>', '>Лента сообщества и новости лаунчера</p>'],
  ['>Обновить</span>', '>Обновить</span>'],
  ['aria-label="Стена"', 'aria-label="Стена"'],
  ['title="Стена"', 'title="Стена"'],
  ['>Стена</span>', '>Стена</span>'],
  ['aria-label="Тип ленты"', 'aria-label="Тип ленты"'],
  ['>Лента сообщества</span>', '>Лента сообщества</span>'],
  ['>Новости клиента</span>', '>Новости клиента</span>'],
  ['aria-label="Уведомления"', 'aria-label="Уведомления"'],
  ['title="Уведомления"', 'title="Уведомления"'],
  ['aria-label="Новый пост"', 'aria-label="Новый пост"'],
  ['title="Новый пост"', 'title="Новый пост"'],
  // modal-sf-post
  ['>Пост</h2>', '>Пост</h2>'],
  // modal-sf-compose
  ['>Новый пост</h2>', '>Новый пост</h2>'],
  ['>Markdown · JPEG до 6 фото</span>', '>Markdown · JPEG до 6 фото</span>'],
  ['>От имени</label>', '>От имени</label>'],
  ['>Фото</span>', '>Фото</span>'],
  ['>Создать клан</span>', '>Создать клан</span>'],
  ['>Опубликовать</button>', '>Опубликовать</button>'],
  // modal-sf-clan
  ['>Создать клан</h2>', '>Создать клан</h2>'],
  ['>Иконка клана</label>', '>Иконка клана</label>'],
  ['>Название</label>', '>Название</label>'],
  ['placeholder="Например: Vialand"', 'placeholder="Например: Vialand"'],
  ['>Описание</label>', '>Описание</label>'],
  ['placeholder="Кратко о сообществе"', 'placeholder="Кратко о сообществе"'],
  ['>Отмена</button>', '>Отмена</button>'],
  ['>Создать клан</button>', '>Создать клан</button>'],
  // modal-sf-repost
  ['>Репост</h2>', '>Репост</h2>'],
  ['>На стену или в чаты</p>', '>На стену или в чаты</p>'],
  ['>На стену</span>', '>На стену</span>'],
  ['>В чаты</span>', '>В чаты</span>'],
  ['>Комментарий к репосту</label>', '>Комментарий к репосту</label>'],
  ['placeholder="Необязательно"', 'placeholder="Необязательно"'],
  ['>Отправить</button>', '>Отправить</button>'],
];

// Now do the actual replacement by finding the garbled versions
// Extract garbled text between news section start and modal-ai-access

// Build a function to decode: the garbled text is UTF-8 bytes interpreted as Windows-1251 then encoded as UTF-8
// Actually let me just find and replace each garbled substring directly

// Get the news + modals section
const newsStart = html.indexOf('<div class="tab-view" id="tab-news">');
const modalEnd = html.indexOf('<div id="modal-ai-access"');
const section = html.substring(newsStart, modalEnd);

// Find all Russian text in the section (text between > and <, or in placeholder/title/aria-label attributes)
// that contains garbled characters (bytes like РЎ, Рќ, etc.)

// Strategy: replace entire section with fixed version by fixing all garbled text
let fixed = section;

// Fix all garbled Cyrillic. The pattern is: valid UTF-8 was read as Windows-1251 and re-encoded as UTF-8.
// We need to reverse this: decode UTF-8 bytes as if they were CP1251
function fixMojibake(str) {
  // Convert string to buffer, reinterpret CP1252->UTF8 decoded bytes as CP1251
  const buf = Buffer.from(str, 'utf8');
  let result = '';
  let i = 0;
  while (i < buf.length) {
    const b = buf[i];
    if (b < 0x80) {
      result += String.fromCharCode(b);
      i++;
    } else if (b === 0xC3 && i + 1 < buf.length) {
      // UTF-8 two-byte: C3 xx -> char 0xC0 + (xx - 0x80)
      const ch = 0xC0 + (buf[i+1] - 0x80);
      result += String.fromCharCode(ch);
      i += 2;
    } else if (b === 0xC2 && i + 1 < buf.length) {
      // UTF-8 two-byte: C2 xx -> char xx
      result += String.fromCharCode(buf[i+1]);
      i += 2;
    } else if (b === 0xE2 && i + 2 < buf.length) {
      // Three-byte UTF-8
      const cp = ((b & 0x0F) << 12) | ((buf[i+1] & 0x3F) << 6) | (buf[i+2] & 0x3F);
      result += String.fromCharCode(cp);
      i += 3;
    } else if (b >= 0xC0 && b < 0xE0 && i + 1 < buf.length) {
      const cp = ((b & 0x1F) << 6) | (buf[i+1] & 0x3F);
      result += String.fromCharCode(cp);
      i += 2;
    } else {
      result += String.fromCharCode(b);
      i++;
    }
  }
  // Now 'result' contains chars in CP1251 range, decode them
  const cp1251 = Buffer.from(result.split('').map(c => c.charCodeAt(0) & 0xFF));
  try {
    const td = new TextDecoder('windows-1251');
    return td.decode(cp1251);
  } catch(e) {
    return str;
  }
}

// Find all text content and attribute values that contain mojibake
// Mojibake signature: Р followed by specific combining chars
const mojibakeRe = /(?:Р[^\x00-\x7F\s<>"=]|С[^\x00-\x7F\s<>"=])[^\x00-\x7F]*/g;

// Better approach: find all sequences of garbled Cyrillic
const garbledSeqRe = /(?:(?:Р[а-яА-ЯёЁ\u0080-\u00FF\u0400-\u04FF]|С[а-яА-ЯёЁ\u0080-\u00FF\u0400-\u04FF]|Рё|вЂ[^\s])+[\s]*)+/g;

// Actually, simplest approach: find unique garbled strings and fix them
const allGarbled = new Set();
const gRe = /((?:[\u0400-\u04FF][\u0080-\u00FF\u0400-\u04FF\u2000-\u206F\u2013-\u2026]*)+)/g;
let gm;
while ((gm = gRe.exec(fixed)) !== null) {
  const s = gm[1];
  // Check if it's actually garbled (contains Р followed by unusual chars)
  if (/Р[ЅІЇЈ]|С[‚ƒ„…†‡€‰Š‹Œ]|Р[°-я].*Р[°-я]/u.test(s) === false) continue;
  if (s.length > 3) allGarbled.add(s);
}

console.log('Garbled strings found:', allGarbled.size);
for (const g of allGarbled) {
  const decoded = fixMojibake(g);
  console.log(JSON.stringify(g).slice(0,60) + ' -> ' + decoded);
}
