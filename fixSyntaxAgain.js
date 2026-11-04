const fs = require('fs');
let ts = fs.readFileSync('src/renderer/social-feed.ts', 'utf8');

ts = ts.replace(/if \(u\.startsWith\('\/api\/messenger\/'\)\) \{\s*return `\$\{base\}\$\{u\}`;\s*\}`\$\{u\}`;/, 
`if (u.startsWith('/api/messenger/')) {
    return \`\${base}\${u}\`;
  }`);

ts = ts.replace(/if \(u\.startsWith\('\/api\/messenger\/'\)\) \{\s*return `\$\{base\}\$\{u\}`;\s*\}`\$\{u\}`;/, 
`if (u.startsWith('/api/messenger/')) {
    return \`\${base}\${u}\`;
  }`);

ts = ts.replace(/\}\$\{u\}`;/g, '');

fs.writeFileSync('src/renderer/social-feed.ts', ts, 'utf8');
console.log('Fixed syntax in social-feed.ts');
