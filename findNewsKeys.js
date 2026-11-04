const fs = require('fs');

// Scan index.html for all news-related i18n keys
const html = fs.readFileSync('src/renderer/index.html', 'utf8');
const htmlKeys = new Set();
const re1 = /data-i18n(?:-\w+)?="([^"]+)"/g;
let m;
while ((m = re1.exec(html)) !== null) {
  if (m[1].startsWith('news.') || m[1].startsWith('sf.')) htmlKeys.add(m[1]);
}

// Scan social-feed.ts for all i18n keys
const ts = fs.readFileSync('src/renderer/social-feed.ts', 'utf8');
const re2 = /i18n\(\s*['"]([^'"]+)['"]\s*\)/g;
while ((m = re2.exec(ts)) !== null) {
  if (m[1].startsWith('news.') || m[1].startsWith('sf.')) htmlKeys.add(m[1]);
}
// Also check t('key') patterns
const re3 = /t\(\s*['"]([^'"]+)['"]\s*\)/g;
while ((m = re3.exec(ts)) !== null) {
  if (m[1].startsWith('news.') || m[1].startsWith('sf.')) htmlKeys.add(m[1]);
}

// Check what keys exist in en.json
const en = JSON.parse(fs.readFileSync('src/renderer/locales/en.json', 'utf8'));
const ru = JSON.parse(fs.readFileSync('src/renderer/locales/ru.json', 'utf8').replace(/^\uFEFF/, ''));

const allKeys = [...htmlKeys].sort();
console.log('=== ALL news/sf keys found in code ===');
for (const k of allKeys) {
  const inEn = k in en ? 'EN:YES' : 'EN:MISSING';
  const inRu = k in ru ? 'RU:YES' : 'RU:MISSING';
  console.log(`  ${k}  ${inEn}  ${inRu}`);
}
