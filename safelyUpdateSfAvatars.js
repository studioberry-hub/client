const fs = require('fs');
let ts = fs.readFileSync('src/renderer/social-feed.ts', 'utf8');

// Ensure avatarImgBits returns transparent gif if no src, so onload can still fire
ts = ts.replace(
  /function avatarImgBits\(opts: AvatarOpts\): \{ src: string; attr: string \} \{\s*const key = avatarKey\(opts\);\s*const src = resolveAvatar\(opts\);/,
  `function avatarImgBits(opts: AvatarOpts): { src: string; attr: string } {
    const key = avatarKey(opts);
    const url = resolveAvatar(opts);
    const src = url || 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';`
);

// We need to inject the skeleton class and onload event into avatar images.
// Instead of complex regex, let's just make sure all places where avatarImgBits are rendered get it.
// sf-quote__avatar
ts = ts.replace(
  /<img class="sf-quote__avatar"([^>]*)>/g,
  '<img class="sf-quote__avatar msgr-avatar__skeleton" onload="this.classList.remove(\'msgr-avatar__skeleton\')" $1>'
);
// sf-post__avatar
ts = ts.replace(
  /<img class="sf-post__avatar([^"]*)"([^>]*)>/g,
  '<img class="sf-post__avatar$1 msgr-avatar__skeleton" onload="this.classList.remove(\'msgr-avatar__skeleton\')" $2>'
);
// sf-pm-comment__avatar
ts = ts.replace(
  /<img class="sf-pm-comment__avatar"([^>]*)>/g,
  '<img class="sf-pm-comment__avatar msgr-avatar__skeleton" onload="this.classList.remove(\'msgr-avatar__skeleton\')" $1>'
);
// sf-mention-card__avatar
ts = ts.replace(
  /<img class="sf-mention-card__avatar"([^>]*)>/g,
  '<img class="sf-mention-card__avatar msgr-avatar__skeleton" onload="this.classList.remove(\'msgr-avatar__skeleton\')" $1>'
);
// sf-comment-avatar-inline
ts = ts.replace(
  /<img class="sf-pm__composer-avatar" id="sf-comment-avatar-inline"/g,
  '<img class="sf-pm__composer-avatar msgr-avatar__skeleton" onload="this.classList.remove(\'msgr-avatar__skeleton\')" id="sf-comment-avatar-inline"'
);

fs.writeFileSync('src/renderer/social-feed.ts', ts, 'utf8');
