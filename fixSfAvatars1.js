const fs = require('fs');
let ts = fs.readFileSync('src/renderer/social-feed.ts', 'utf8');

// Replace avatarImgBits to generate the CSS rule and return class instead of src/attr
ts = ts.replace(
  /function avatarImgBits\(opts:[\s\S]*?return \{ src, attr \};\n  \}/,
  `function avatarImgBits(opts: { skinUrl?: string; uuid?: string; username?: string; provider?: string }) {
    if (!host) return { src: '', attr: '', cls: '' };
    const key = avatarKey(opts);
    const src = resolveAvatar(opts);
    
    let safeId = '';
    if (key) {
      safeId = 'sf_' + key.replace(/[^a-zA-Z0-9_-]/g, '_');
      const styleEl = document.getElementById('msgr-avatar-styles') as HTMLStyleElement;
      if (styleEl && styleEl.sheet && src) {
        // Find if it already exists
        let exists = false;
        const targetCls = \`.avatar-node-\${safeId}\`;
        for (let i = 0; i < styleEl.sheet.cssRules.length; i++) {
          if ((styleEl.sheet.cssRules[i] as CSSStyleRule).selectorText === targetCls) {
            exists = true;
            break;
          }
        }
        if (!exists) {
          const cssUrl = src.replace(/'/g, "%27").replace(/"/g, "%22");
          styleEl.sheet.insertRule(
            \`.avatar-node-\${safeId} { background-image: url('\${cssUrl}') !important; background-size: cover !important; animation: none !important; }\`,
            styleEl.sheet.cssRules.length
          );
        }
      }
    }

    const attr = key && host ? \` data-sf-avatar="\${host.escapeHtml(key)}"\` : '';
    const cls = safeId ? \`msgr-avatar-node avatar-node-\${safeId}\` : 'msgr-avatar-node';
    return { src, attr, cls };
  }`
);

fs.writeFileSync('src/renderer/social-feed.ts', ts, 'utf8');
console.log('social-feed.ts updated');
