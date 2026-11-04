const fs = require('fs');

let ru = JSON.parse(fs.readFileSync('src/renderer/locales/ru.json', 'utf8'));
ru['builds.groupCount'] = "Сборок в группе: {count}";
fs.writeFileSync('src/renderer/locales/ru.json', JSON.stringify(ru, null, 2), 'utf8');

let en = JSON.parse(fs.readFileSync('src/renderer/locales/en.json', 'utf8'));
en['builds.groupCount'] = "Builds in group: {count}";
fs.writeFileSync('src/renderer/locales/en.json', JSON.stringify(en, null, 2), 'utf8');

let appTs = fs.readFileSync('src/renderer/app.ts', 'utf8');
appTs = appTs.replace(
  /t\('builds\.groupCount', \{ n: count \}\) \|\| `\$\{count\} .*`/g,
  "t('builds.groupCount', { count }) || `${count}`"
);
fs.writeFileSync('src/renderer/app.ts', appTs, 'utf8');
