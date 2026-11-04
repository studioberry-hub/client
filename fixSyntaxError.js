const fs = require('fs');
let ts = fs.readFileSync('src/renderer/social-feed.ts', 'utf8');

// The messed up part is:
// if (u.startsWith('/api/messenger/')) {
//         // The user specified that messenger avatars are now under /client/api/messenger/...
//         // so we should just append it to the base (which is .../client)
//         return `${base}${u}`;
//       }${u}`;
//     }

ts = ts.replace(/if \(u\.startsWith\('\/api\/messenger\/'\)\) \{[\s\S]*?if \(u\.startsWith\('\/'\)\)/, 
`if (u.startsWith('/api/messenger/')) {
    return \`\${base}\${u}\`;
  }
  if (u.startsWith('/'))`);

fs.writeFileSync('src/renderer/social-feed.ts', ts, 'utf8');
