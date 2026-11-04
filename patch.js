const fs = require('fs');
let ru = fs.readFileSync('src/renderer/locales/ru.json', 'utf8');
ru = ru.replace(/"skins\.animDance": "(.*?)",/, '"skins.animDance": "$1",\n  "skins.animSad": "Грустить",');
ru = ru.replace(/"about\.kolibraRole": "(.*?)",/, '"about.kolibraRole": "$1",\n  "about.hanokaRole": "Реализовал поддержку Linux для вас",');
fs.writeFileSync('src/renderer/locales/ru.json', ru);
let en = fs.readFileSync('src/renderer/locales/en.json', 'utf8');
en = en.replace(/"skins\.animDance": "(.*?)",/, '"skins.animDance": "$1",\n  "skins.animSad": "Sad",');
en = en.replace(/"about\.kolibraRole": "(.*?)",/, '"about.kolibraRole": "$1",\n  "about.hanokaRole": "Implemented Linux support for you",');
fs.writeFileSync('src/renderer/locales/en.json', en);
