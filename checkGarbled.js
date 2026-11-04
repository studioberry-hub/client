const fs = require('fs');
let raw = fs.readFileSync('src/renderer/locales/ru.json', 'utf8');
if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
let data = JSON.parse(raw);
console.log(data['news.clanName']);
console.log(data['news.clanDesc']);
