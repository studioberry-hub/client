const fs = require('fs');
let ts = fs.readFileSync('src/renderer/social-feed.ts', 'utf8');

// Update authorBits
ts = ts.replace(
  /avatarAttr: bits\.attr,/g,
  'avatarAttr: bits.attr,\n      avatarCls: bits.cls,'
);
ts = ts.replace(
  /avatarAttr: '',/g,
  'avatarAttr: \'\',\n      avatarCls: \'\','
);

// Update HTML generation: sf-quote__avatar
ts = ts.replace(
  /<img class="sf-quote__avatar" src="\$\{host\.escapeHtml\(who\.avatar\)\}"\$\{who\.avatarAttr\} alt="">/g,
  '<span class="sf-quote__avatar ${who.avatarCls || \'\'}" ${who.avatarAttr || \'\'} style="${!who.avatarCls ? `background-image: url(\'${host.escapeHtml(who.avatar)}\'); background-size: cover;` : \'\'}"></span>'
);

// sf-post__avatar
ts = ts.replace(
  /<img class="sf-post__avatar\$\{who\.isClan \? ' is-clan' : ''\}" src="\$\{host\.escapeHtml\(who\.avatar\)\}"\$\{who\.avatarAttr\} alt="" loading="lazy">/g,
  '<span class="sf-post__avatar${who.isClan ? \' is-clan\' : \'\'} ${who.avatarCls || \'\'}" ${who.avatarAttr || \'\'} style="${!who.avatarCls ? `background-image: url(\'${host.escapeHtml(who.avatar)}\'); background-size: cover;` : \'\'}"></span>'
);

// sf-pm-comment__avatar
ts = ts.replace(
  /<img class="sf-pm-comment__avatar" src="\$\{host\.escapeHtml\(av\.src\)\}"\$\{av\.attr\} alt="">/g,
  '<span class="sf-pm-comment__avatar ${av.cls || \'\'}" ${av.attr || \'\'} style="${!av.cls ? `background-image: url(\'${host.escapeHtml(av.src)}\'); background-size: cover;` : \'\'}"></span>'
);

// sf-mention-card__avatar
ts = ts.replace(
  /<img class="sf-mention-card__avatar" src="\$\{host\.escapeHtml\(av\.src\)\}"\$\{av\.attr\} alt="">/g,
  '<span class="sf-mention-card__avatar ${av.cls || \'\'}" ${av.attr || \'\'} style="${!av.cls ? `background-image: url(\'${host.escapeHtml(av.src)}\'); background-size: cover;` : \'\'}"></span>'
);

// And we need to fix the manually set images (syncAccountAvatars, sf-pm-avatar, sf-comment-avatar)
// Wait, syncAccountAvatars uses getElementById('sf-wall-avatar'). That's an <img>!
// Let's change them in HTML if they are images, or we can just apply CSS to the element!
ts = ts.replace(
  /el\.src = bits\.src;/g,
  'el.style.backgroundImage = `url("${bits.src}")`; el.style.backgroundSize = "cover"; el.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";'
);
ts = ts.replace(
  /avatar\.src = who\.avatar;/g,
  'avatar.style.backgroundImage = `url("${who.avatar}")`; avatar.style.backgroundSize = "cover"; avatar.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";'
);
ts = ts.replace(
  /commentAvatar\.src = bits\.src;/g,
  'commentAvatar.style.backgroundImage = `url("${bits.src}")`; commentAvatar.style.backgroundSize = "cover"; commentAvatar.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";'
);
ts = ts.replace(
  /inlineAv\.src = bits\.src;/g,
  'inlineAv.style.backgroundImage = `url("${bits.src}")`; inlineAv.style.backgroundSize = "cover"; inlineAv.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";'
);

fs.writeFileSync('src/renderer/social-feed.ts', ts, 'utf8');
console.log('social-feed.ts HTML updated');
