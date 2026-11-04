const fs = require('fs');
let code = fs.readFileSync('src/renderer/messenger/ui.ts', 'utf8');

// Fix Regex
code = code.replace(
  /html\.replace\(\/🔄 Репост\[\\s\\S\]\*\?#post:\[\\w-\]\+\/s, ''\);/g,
  "html.replace(/🔄 Репост[\\s\\S]*?#post:[\\w-]+/, '');"
);
code = code.replace(
  /html\.match\(\/🔄 Репост · \(\.\*\?\)\\n\(\[\\s\\S\]\*\?\)#post:\(\[\\w-\]\+\)\/s\);/g,
  "html.match(/🔄 Репост · (.*?)\\n([\\s\\S]*?)#post:([\\w-]+)/);"
);

// Fix Object Literal
code = code.replace(
  /base64: b64,/g,
  "dataBase64: b64,\n              size: file.size,"
);

fs.writeFileSync('src/renderer/messenger/ui.ts', code, 'utf8');
console.log('Fixed syntax errors');
