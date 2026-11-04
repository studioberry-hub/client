const fs = require('fs');
let ts = fs.readFileSync('src/renderer/social-feed.ts', 'utf8');

// The original logic:
// const base = getApiBase().replace(/\/$/, '');
// if (u.startsWith('/client/')) return `${base.replace(/\/client$/, '')}${u}`;
// if (u.startsWith('/api/messenger/')) {
//   return `${base.replace(/\/client$/, '')}${u}`;
// }
//
// We want to fix it. If the base is 'https://uprojects.site/client', and the URL is '/api/messenger/...',
// they want it to be 'https://uprojects.site/client/api/messenger/...'.
// Actually, if `u` starts with `/api/`, we can just append it to base if it doesn't already include `/client`.
// Let's just do:
// return base + (u.startsWith('/') ? '' : '/') + u;
// But wait, what if `u` is `/client/...`?
// If `u` is `/client/...` and base is `.../client`, we don't want `.../client/client/...`.

ts = ts.replace(/if\s*\(u\.startsWith\('\/api\/messenger\/'\)\)\s*\{[\s\S]*?\}/, (m) => {
  return `if (u.startsWith('/api/messenger/')) {
      // The user specified that messenger avatars are now under /client/api/messenger/...
      // so we should just append it to the base (which is .../client)
      return \`\${base}\${u}\`;
    }`;
});

fs.writeFileSync('src/renderer/social-feed.ts', ts, 'utf8');
console.log('Fixed absMedia in social-feed.ts');
