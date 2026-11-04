const fs = require('fs');
const css = fs.readFileSync('src/renderer/social-feed.css', 'utf8');
console.log('sf-modal:', css.includes('sf-modal'));
console.log('sf-compose-modal:', css.includes('sf-compose-modal'));
console.log('sf-post-window:', css.includes('sf-post-window'));
