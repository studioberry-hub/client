const fs = require('fs');
let code = fs.readFileSync('D:/vbProj/cloudsrv/website/lib/social-feed.js', 'utf8');

code = code.replace(/ensureColumn\(db, 'feed_posts', 'repost_of_id', 'repost_of_id TEXT'\);\s*/, '');

const insertPos = code.indexOf('CREATE TABLE IF NOT EXISTS feed_attachments');
if (insertPos !== -1) {
  code = code.substring(0, insertPos) + "`);\n  ensureColumn(db, 'feed_posts', 'repost_of_id', 'repost_of_id TEXT');\n  db.exec(`" + code.substring(insertPos);
}

fs.writeFileSync('D:/vbProj/cloudsrv/website/lib/social-feed.js', code, 'utf8');
console.log('Fixed migration bug');
