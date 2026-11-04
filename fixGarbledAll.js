const fs = require('fs');
let buf = fs.readFileSync('src/renderer/index.html');
let html = buf.toString('utf8');

// Extract news+modals section boundaries
const nsI = html.indexOf('<div class="tab-view" id="tab-news">');
const meI = html.indexOf('<div id="modal-ai-access"');
const before = html.substring(0, nsI);
const section = html.substring(nsI, meI);
const after = html.substring(meI);

// All unique garbled->clean pairs found in the section
// We'll find them by looking for Р* С* sequences
const pairs = [
  // Direct full-line replacements in the section:
  ['aria-label="\u0420\u0421\u201a\u0420\u00b5\u0420\u0405\u0420\u00b0"', 'aria-label="Стена"'],
  ['title="\u0420\u0421\u201a\u0420\u00b5\u0420\u0405\u0420\u00b0"', 'title="Стена"'],
  ['aria-label="\u0420\u0422\u0420\u00b8\u0420\u0457 \u0420\u00bb\u0420\u00b5\u0420\u0405\u0421\u201a\u0421\u2039"', 'aria-label="Тип ленты"'],
  ['aria-label="\u0420\u0453\u0420\u0432\u0420\u00b5\u0420\u00b4\u0420\u0455\u0420\u0458\u0420\u00bb\u0420\u00b5\u0420\u0405\u0420\u00b8\u0421\u040f"', 'aria-label="Уведомления"'],
  ['title="\u0420\u0453\u0420\u0432\u0420\u00b5\u0420\u00b4\u0420\u0455\u0420\u0458\u0420\u00bb\u0420\u00b5\u0420\u0405\u0420\u00b8\u0421\u040f"', 'title="Уведомления"'],
  ['aria-label="\u0420\u0405\u0420\u0455\u0420\u0432\u0421\u2039\u0420\u2116 \u0420\u0457\u0420\u0455\u0421\u0403\u0421\u201a"', 'aria-label="Новый пост"'],
  ['title="\u0420\u0405\u0420\u0455\u0420\u0432\u0421\u2039\u0420\u2116 \u0420\u0457\u0420\u0455\u0421\u0403\u0421\u201a"', 'title="Новый пост"'],
];

let fixed = section;
for (const [from, to] of pairs) {
  if (fixed.includes(from)) {
    fixed = fixed.split(from).join(to);
  }
}

// Now replace ALL remaining inner text between > and < that contains garbled chars
// We'll do it by replacing specific known garbled strings with correct ones
const textReplacements = [
  // tab-news inner texts
  ['>\u0420\u0405\u0420\u0455\u0420\u0432\u0420\u0455\u0421\u0403\u0421\u201a\u0420\u00b8<', '>Новости<'],
  ['>\u0420\u203a\u0420\u00b5\u0420\u0405\u0421\u201a\u0420\u00b0 \u0421\u0403\u0420\u0455\u0420\u0455\u0420\u00b1\u0421\u2030\u0420\u00b5\u0421\u0403\u0421\u201a\u0420\u0432\u0420\u00b0 \u0420\u00b8 \u0420\u0405\u0420\u0455\u0420\u0432\u0420\u0455\u0421\u0403\u0421\u201a\u0420\u00b8 \u0420\u00bb\u0420\u00b0\u0421\u0453\u0420\u0405\u0421\u2021\u0420\u00b5\u0421\u0402\u0420\u00b0<', '>Лента сообщества и новости лаунчера<'],
  ['>\u0420\u040b\u0420\u00b1\u0420\u0405\u0420\u0455\u0420\u0432\u0420\u00b8\u0421\u201a\u0421\u0453<', '>Обновить<'],
  ['>\u0420\u0421\u201a\u0420\u00b5\u0420\u0405\u0420\u00b0<', '>Стена<'],
  ['>\u0420\u203a\u0420\u00b5\u0420\u0405\u0421\u201a\u0420\u00b0 \u0421\u0403\u0420\u0455\u0420\u0455\u0420\u00b1\u0421\u2030\u0420\u00b5\u0421\u0403\u0421\u201a\u0420\u0432\u0420\u00b0<', '>Лента сообщества<'],
  ['>\u0420\u0405\u0420\u0455\u0420\u0432\u0420\u0455\u0421\u0403\u0421\u201a\u0420\u00b8 \u0420\u0454\u0420\u00bb\u0420\u00b8\u0420\u00b5\u0420\u0405\u0421\u201a\u0420\u00b0<', '>Новости клиента<'],
  ['>\u0420\u040f\u0420\u0455\u0421\u0403\u0421\u201a<', '>Пост<'],
  ['>\u0420\u0405\u0420\u0455\u0420\u0432\u0421\u2039\u0420\u2116 \u0420\u0457\u0420\u0455\u0421\u0403\u0421\u201a<', '>Новый пост<'],
  ['>\u0420\u0424\u0420\u0455\u0421\u201a\u0420\u0455<', '>Фото<'],
  ['>\u0420\u040e\u0420\u0455\u0420\u00b7\u0420\u00b4\u0420\u00b0\u0421\u201a\u0421\u0453 \u0420\u0454\u0420\u00bb\u0420\u00b0\u0420\u0405<', '>Создать клан<'],
  ['>\u0420\u040b\u0420\u0457\u0421\u0453\u0420\u00b1\u0420\u00bb\u0420\u00b8\u0420\u0454\u0420\u0455\u0420\u0432\u0420\u00b0\u0421\u201a\u0421\u0453<', '>Опубликовать<'],
  ['>\u0420\u040b\u0421\u201a \u0420\u00b8\u0420\u0458\u0420\u00b5\u0420\u0405\u0420\u00b8<', '>От имени<'],
  ['>\u0420\u040b\u0421\u201a\u0420\u0458\u0420\u00b5\u0420\u0405\u0420\u00b0<', '>Отмена<'],
  ['>\u0420\u040b\u0421\u201a\u0420\u0457\u0421\u0402\u0420\u00b0\u0420\u0432\u0420\u00b8\u0421\u201a\u0421\u0453<', '>Отправить<'],
  ['>\u0420 \u0420\u00b5\u0420\u0457\u0420\u0455\u0421\u0403\u0421\u201a<', '>Репост<'],
  ['>\u0420\u0405\u0420\u00b0 \u0421\u0403\u0421\u201a\u0420\u00b5\u0420\u0405\u0421\u0453<', '>На стену<'],
  ['>\u0420\u0432 \u0421\u2021\u0420\u00b0\u0421\u201a\u0421\u2039<', '>В чаты<'],
  ['>\u0420\u0405\u0420\u00b0\u0420\u00b7\u0420\u0432\u0420\u00b0\u0420\u0405\u0420\u00b8\u0420\u00b5<', '>Название<'],
  ['>\u0420\u040b\u0420\u0457\u0420\u00b8\u0421\u0403\u0420\u00b0\u0420\u0405\u0420\u00b8\u0420\u00b5<', '>Описание<'],
  ['>\u0420\u0450\u0420\u0454\u0420\u0455\u0420\u0405\u0420\u0454\u0420\u00b0 \u0420\u0454\u0420\u00bb\u0420\u00b0\u0420\u0405\u0420\u00b0<', '>Иконка клана<'],
];

for (const [from, to] of textReplacements) {
  while (fixed.includes(from)) {
    fixed = fixed.replace(from, to);
  }
}

// Fix remaining longer garbled inner texts using regex
// Find >garbled< patterns and replace everything between > and < if it contains mojibake
const mojibakeCharRe = /[\u0420\u0421][\u00b0-\u00bf\u0400-\u04FF\u2000-\u206F]/;
fixed = fixed.replace(/>([^<]{2,})</g, (match, inner) => {
  if (mojibakeCharRe.test(inner)) {
    // Try to decode: these are UTF-8 bytes misinterpreted through CP1252->UTF8
    try {
      const bytes = [];
      for (let i = 0; i < inner.length; i++) {
        const c = inner.charCodeAt(i);
        if (c < 0x80) {
          bytes.push(c);
        } else if (c < 0x100) {
          bytes.push(c);
        } else {
          // Multi-byte: encode back to UTF-8 bytes
          if (c < 0x800) {
            bytes.push(0xC0 | (c >> 6));
            bytes.push(0x80 | (c & 0x3F));
          } else {
            bytes.push(0xE0 | (c >> 12));
            bytes.push(0x80 | ((c >> 6) & 0x3F));
            bytes.push(0x80 | (c & 0x3F));
          }
        }
      }
      // Now interpret these bytes as CP1252, map to Unicode
      const cp1252 = [
        0x20AC,0x81,0x201A,0x0192,0x201E,0x2026,0x2020,0x2021,
        0x02C6,0x2030,0x0160,0x2039,0x0152,0x8D,0x017D,0x8F,
        0x90,0x2018,0x2019,0x201C,0x201D,0x2022,0x2013,0x2014,
        0x02DC,0x2122,0x0161,0x203A,0x0153,0x9D,0x017E,0x0178
      ];
      const step1 = [];
      for (const b of bytes) {
        if (b >= 0x80 && b <= 0x9F) {
          step1.push(cp1252[b - 0x80]);
        } else {
          step1.push(b);
        }
      }
      // Now step1 contains code points that were CP1251 encoded, decode them
      const buf2 = Buffer.from(step1.map(x => x & 0xFF));
      const td = new TextDecoder('windows-1251');
      const decoded = td.decode(buf2);
      if (decoded && !mojibakeCharRe.test(decoded) && decoded.length > 0) {
        return '>' + decoded + '<';
      }
    } catch(e) {}
  }
  return match;
});

// Also fix placeholder="garbled" and title="garbled"
fixed = fixed.replace(/(placeholder|title|aria-label)="([^"]{2,})"/g, (match, attr, val) => {
  if (mojibakeCharRe.test(val)) {
    try {
      const bytes = [];
      for (let i = 0; i < val.length; i++) {
        const c = val.charCodeAt(i);
        if (c < 0x80) { bytes.push(c); }
        else if (c < 0x100) { bytes.push(c); }
        else if (c < 0x800) { bytes.push(0xC0|(c>>6)); bytes.push(0x80|(c&0x3F)); }
        else { bytes.push(0xE0|(c>>12)); bytes.push(0x80|((c>>6)&0x3F)); bytes.push(0x80|(c&0x3F)); }
      }
      const cp1252 = [0x20AC,0x81,0x201A,0x0192,0x201E,0x2026,0x2020,0x2021,0x02C6,0x2030,0x0160,0x2039,0x0152,0x8D,0x017D,0x8F,0x90,0x2018,0x2019,0x201C,0x201D,0x2022,0x2013,0x2014,0x02DC,0x2122,0x0161,0x203A,0x0153,0x9D,0x017E,0x0178];
      const step1 = bytes.map(b => (b>=0x80&&b<=0x9F) ? cp1252[b-0x80] : b);
      const buf2 = Buffer.from(step1.map(x => x & 0xFF));
      const td = new TextDecoder('windows-1251');
      const decoded = td.decode(buf2);
      if (decoded && !mojibakeCharRe.test(decoded)) {
        return attr + '="' + decoded + '"';
      }
    } catch(e) {}
  }
  return match;
});

html = before + fixed + after;
fs.writeFileSync('src/renderer/index.html', html, 'utf8');

// Verify
const remaining = (fixed.match(/[\u0420\u0421][\u00b0-\u00bf\u0400-\u04FF\u2000-\u206F]/g) || []).length;
console.log('Remaining mojibake chars in section: ' + remaining);
