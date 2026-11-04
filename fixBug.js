const fs = require('fs');
let file = fs.readFileSync('D:/vbProj/cloudsrv/website/lib/social-feed.js', 'utf8');

// Remove ensureColumn feed_posts from top
file = file.replace(/ensureColumn\(db, 'feed_posts', 'repost_of_id', 'repost_of_id TEXT'\);\s*/, '');

// Insert it after CREATE INDEX idx_feed_posts_author_clan
file = file.replace(
  /CREATE INDEX IF NOT EXISTS idx_feed_posts_author_clan\s*ON feed_posts\(author_clan_id, created_at DESC\);\s*/,
  `CREATE INDEX IF NOT EXISTS idx_feed_posts_author_clan
      ON feed_posts(author_clan_id, created_at DESC);\n`);

// Wait, doing this via string replacement might be fragile. 
// I'll just append it to the end of the `migrateSocial` function before it returns.
