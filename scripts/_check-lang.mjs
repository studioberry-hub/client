import fs from 'fs';
const s = fs.readFileSync('src/renderer/index.html', 'utf8');
const i = s.indexOf('id="setting-language"');
const c = s.slice(i, i + 800);
console.log('--- chunk ---');
console.log(c);
console.log('--- names ---');
for (const m of c.matchAll(/>([^<]+)</g)) {
  const t = m[1].trim();
  if (!t || t.startsWith('M2 ')) continue;
  console.log(JSON.stringify(t), [...t].map((ch) => ch.codePointAt(0).toString(16)).join(' '));
}
