const fs = require('fs');
let code = fs.readFileSync('D:/vbProj/cloudsrv/website/lib/social-feed.js', 'utf8');

const replacement = `
      const sent = [];
      const meta = {
        postId: post.id,
        author: authorLabel,
        snippet: snippet,
        thumbnail: post.attachments && post.attachments.length ? post.attachments[0].url : null
      };
      for (const cid of ids) {
        try {
          const msg = store.sendMessage(cid, viewerId, body, null, null, { kind: 'news_repost', meta });
`;

code = code.replace(
  /const sent = \[\];\s*for \(const cid of ids\) \{\s*try \{\s*const msg = store\.sendMessage\(cid, viewerId, body\);/,
  replacement.trim()
);

fs.writeFileSync('D:/vbProj/cloudsrv/website/lib/social-feed.js', code, 'utf8');
console.log('Backend patched for rich reposts');
