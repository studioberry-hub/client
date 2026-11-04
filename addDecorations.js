const fs = require('fs');
let code = fs.readFileSync('src/main/main.ts', 'utf8');

code = code.replace(
  /app\.commandLine\.appendSwitch\('ignore-gpu-blocklist'\);\n\}/,
  "app.commandLine.appendSwitch('ignore-gpu-blocklist');\n  app.commandLine.appendSwitch('enable-features', 'WaylandWindowDecorations');\n  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');\n}"
);

fs.writeFileSync('src/main/main.ts', code);
console.log('Added WaylandWindowDecorations to main.ts');
