const fs = require('fs');
let ts = fs.readFileSync('src/renderer/social-feed.ts', 'utf8');

ts = ts.replace(/if \(\s*u\.startsWith\('\/api\/messenger\/'\)\s*\)\s*\{[\s\S]*?\}/, 
`if (u.startsWith('/api/messenger/')) {
    return \`\${base}\${u}\`;
  }`);

fs.writeFileSync('src/renderer/social-feed.ts', ts, 'utf8');
