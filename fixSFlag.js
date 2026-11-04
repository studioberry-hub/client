const fs = require('fs');
let code = fs.readFileSync('src/renderer/messenger/ui.ts', 'utf8');

code = code.replace(
  /html = html\.replace\(\/&#128257; Р РµРїРѕСЃС‚\.\*\\n\\n#post:\.\*\$\/s, ''\); \/\/ try to remove the boilerplate if present/g,
  "html = html.replace(/&#128257; Р РµРїРѕСЃС‚[\\s\\S]*?#post:[\\w-]+/, ''); // try to remove the boilerplate if present"
);

// Fallback in case of encoding mismatch:
code = code.replace(/html = html\.replace\(\/&\#128257;.*\/s, ''\);/g, "html = html.replace(/&#128257;[\\s\\S]*?#post:[\\w-]+/, '');");

fs.writeFileSync('src/renderer/messenger/ui.ts', code, 'utf8');
console.log('Fixed the remaining /s flag');
