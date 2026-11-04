const fs = require('fs');

// Read src-unbroken - it has the RIGHT structure but WRONG encoding in text
const unbroken = fs.readFileSync('src-unbroken/renderer/index.html', 'utf8');

// Extract tab-news from unbroken (correct structure)
const newsMatch = unbroken.match(/<div class="tab-view" id="tab-news">[\s\S]*?(?=\s*<!-- Skins Tab -->)/);
if (!newsMatch) { console.error('No tab-news in unbroken'); process.exit(1); }
let newsHtml = newsMatch[0];

// Extract modals from unbroken
const modalsMatch = unbroken.match(/<div id="modal-sf-post"[\s\S]*?(?=\s*<div id="modal-ai-access")/);
if (!modalsMatch) { console.error('No modals in unbroken'); process.exit(1); }
let modalsHtml = modalsMatch[0];

// Now fix ALL garbled text in both sections.
// The encoding issue: text was UTF-8, got read as CP1252, then written as UTF-8 again.
// To reverse: take the garbled UTF-8 string, encode to bytes, interpret those bytes as CP1252 
// code points, get the original bytes, then decode as UTF-8.

function fixMojibake(input) {
  // CP1252 to Unicode mapping for 0x80-0x9F range
  const cp1252map = {
    0x80:0x20AC, 0x82:0x201A, 0x83:0x0192, 0x84:0x201E, 0x85:0x2026,
    0x86:0x2020, 0x87:0x2021, 0x88:0x02C6, 0x89:0x2030, 0x8A:0x0160,
    0x8B:0x2039, 0x8C:0x0152, 0x8E:0x017D, 0x91:0x2018, 0x92:0x2019,
    0x93:0x201C, 0x94:0x201D, 0x95:0x2022, 0x96:0x2013, 0x97:0x2014,
    0x98:0x02DC, 0x99:0x2122, 0x9A:0x0161, 0x9B:0x203A, 0x9C:0x0153,
    0x9E:0x017E, 0x9F:0x0178
  };
  // Build reverse map: Unicode -> CP1252 byte
  const revMap = {};
  for (const [byte, uni] of Object.entries(cp1252map)) {
    revMap[uni] = Number(byte);
  }

  // Convert input string's code points back to CP1252 bytes
  const bytes = [];
  for (let i = 0; i < input.length; i++) {
    const cp = input.codePointAt(i);
    if (cp > 0xFFFF) { i++; } // skip surrogate
    
    if (cp < 0x80) {
      bytes.push(cp);
    } else if (cp <= 0xFF && !(cp >= 0x80 && cp <= 0x9F)) {
      // Direct Latin-1 range (0xA0-0xFF) - same in CP1252
      bytes.push(cp);
    } else if (revMap[cp] !== undefined) {
      // This Unicode char came from CP1252's 0x80-0x9F range
      bytes.push(revMap[cp]);
    } else if (cp >= 0x100 && cp <= 0xFFFF) {
      // Could be a Unicode char that doesn't map back - keep as-is via UTF-8
      // But this shouldn't happen in mojibake recovery
      if (cp < 0x800) {
        bytes.push(0xC0 | (cp >> 6));
        bytes.push(0x80 | (cp & 0x3F));
      } else {
        bytes.push(0xE0 | (cp >> 12));
        bytes.push(0x80 | ((cp >> 6) & 0x3F));
        bytes.push(0x80 | (cp & 0x3F));
      }
    }
  }

  // Now 'bytes' should be the original UTF-8 bytes - decode them
  const buf = Buffer.from(bytes);
  return buf.toString('utf8');
}

// Apply fix to text content (between > and <) and attribute values
function fixSection(html) {
  // Fix text content: >garbled<
  html = html.replace(/>([^<]+)</g, (match, text) => {
    // Only fix if it contains likely mojibake (chars from CP1252 0x80-0x9F mapped to Unicode)
    if (/[\u0192\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178\u201A\u201E]/.test(text)) {
      try {
        const fixed = fixMojibake(text);
        // Verify the result looks like valid text (no control chars)
        if (fixed && !/[\x00-\x08\x0E-\x1F]/.test(fixed)) {
          return '>' + fixed + '<';
        }
      } catch(e) {}
    }
    return match;
  });

  // Fix attribute values: attr="garbled"
  html = html.replace(/(placeholder|title|aria-label)="([^"]+)"/g, (match, attr, val) => {
    if (/[\u0192\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178\u201A\u201E]/.test(val)) {
      try {
        const fixed = fixMojibake(val);
        if (fixed && !/[\x00-\x08\x0E-\x1F]/.test(fixed)) {
          return attr + '="' + fixed + '"';
        }
      } catch(e) {}
    }
    return match;
  });

  return html;
}

newsHtml = fixSection(newsHtml);
modalsHtml = fixSection(modalsHtml);

// Read current index.html and replace
let current = fs.readFileSync('src/renderer/index.html', 'utf8');

const curNewsMatch = current.match(/<div class="tab-view" id="tab-news">[\s\S]*?(?=\s*<!-- Skins Tab -->)/);
if (curNewsMatch) {
  current = current.replace(curNewsMatch[0], newsHtml);
}

const curModalsMatch = current.match(/<div id="modal-sf-post"[\s\S]*?(?=\s*<div id="modal-ai-access")/);
if (curModalsMatch) {
  current = current.replace(curModalsMatch[0], modalsHtml);
} else {
  const aiIdx = current.indexOf('<div id="modal-ai-access"');
  current = current.substring(0, aiIdx) + modalsHtml + '\n  ' + current.substring(aiIdx);
}

fs.writeFileSync('src/renderer/index.html', current, 'utf8');

// Verify
const verify = fs.readFileSync('src/renderer/index.html', 'utf8');
const nsI = verify.indexOf('<div class="tab-view" id="tab-news">');
const meI = verify.indexOf('<div id="modal-ai-access"');
const sec = verify.substring(nsI, meI);
const hasMojibake = /[\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178]/.test(sec);
console.log('Structure: news-remaster =', sec.includes('news-remaster'));
console.log('Structure: nr-wall =', sec.includes('nr-wall'));
console.log('Structure: sf-wall-avatar =', sec.includes('sf-wall-avatar'));
console.log('Structure: modal-sf-compose =', sec.includes('modal-sf-compose'));
console.log('Mojibake remaining:', hasMojibake);

// Show a sample of text
const sample = sec.match(/>([А-Яа-яЁё][^<]{2,})</g);
if (sample) {
  console.log('Sample Russian texts:');
  sample.slice(0, 10).forEach(s => console.log('  ' + s.substring(1, 60)));
}
