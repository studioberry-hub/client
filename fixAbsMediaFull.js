const fs = require('fs');
let ts = fs.readFileSync('src/renderer/social-feed.ts', 'utf8');

const correctFn = `function absMedia(url: string | null | undefined): string {
  const u = String(url || '').trim();
  if (!u) return '';
  if (u.startsWith('http://') || u.startsWith('https://') || u.startsWith('data:')) {
    return skinImageUrl(u) || u;
  }
  const base = getApiBase().replace(/\\/$/, '');
  if (u.startsWith('/client/')) return \`\${base.replace(/\\/client$/, '')}\${u}\`;
  // Аватары чатов Messenger
  if (u.startsWith('/api/messenger/')) {
    return \`\${base}\${u}\`;
  }
  if (u.startsWith('/')) return \`\${base}\${u}\`;
  return u;
}`;

// We will find the start of absMedia and replace it up to its end.
const start = ts.indexOf('function absMedia');
let end = ts.indexOf('\n}', start);
if (start !== -1 && end !== -1) {
  ts = ts.substring(0, start) + correctFn + ts.substring(end + 2);
}

fs.writeFileSync('src/renderer/social-feed.ts', ts, 'utf8');
