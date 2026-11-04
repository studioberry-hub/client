const fs = require('fs');
const buf = fs.readFileSync('D:/vbProj/uclient/src-unbroken/renderer/locales/ru.json');
console.log(buf.slice(0, 100));
