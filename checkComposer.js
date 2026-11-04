const fs = require('fs');
const dir = 'src/renderer/locales';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
for (const file of files) {
  let raw = fs.readFileSync(dir + '/' + file, 'utf8');
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
  const data = JSON.parse(raw);
  const val = data['news.composerPlaceholder'];
  const hex = val ? Buffer.from(val, 'utf8').toString('hex').slice(0, 60) : 'MISSING';
  console.log(file + ': ' + JSON.stringify(val) + '  hex=' + hex);
}
