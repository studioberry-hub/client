const fs = require('fs');
let code = fs.readFileSync('src/renderer/messenger/ui.ts', 'utf8');

// Fix the regex for removing the boilerplate
code = code.replace(
  /html = html\.replace\(\/&#128257; Репост\.\*\\\\n\\\\n#post:\.\*\$\/s, ''\);/,
  "html = html.replace(/🔄 Репост[\\s\\S]*?#post:[\\w-]+/s, '');"
);

fs.writeFileSync('src/renderer/messenger/ui.ts', code, 'utf8');
console.log('Fixed boilerplate removal regex');
