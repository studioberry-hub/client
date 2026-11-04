const fs = require('fs');
let ts = fs.readFileSync('src/renderer/social-feed.ts', 'utf8');

const regex = /function avatarImgBits\(opts: AvatarOpts\): \{ src: string; attr: string \} \{[\s\S]*?return \{ src, attr \};\s*\}/;

ts = ts.replace(regex, `function avatarImgBits(opts: AvatarOpts): { src: string; attr: string; cls: string } {
    if (!host) return { src: '', attr: '', cls: '' };
    const key = avatarKey(opts);
    const src = resolveAvatar(opts);
    
    let safeId = '';
    if (key) {
      safeId = 'sf_' + key.replace(/[^a-zA-Z0-9_-]/g, '_');
      let styleEl = document.getElementById('msgr-avatar-styles') as HTMLStyleElement;
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'msgr-avatar-styles';
        document.head.appendChild(styleEl);
        styleEl.sheet?.insertRule(\`
          @keyframes avatarWave {
            0% { background-position: 200% 0; }
            100% { background-position: -200% 0; }
          }
        \`, 0);
        styleEl.sheet?.insertRule(\`
          .msgr-avatar-node {
            display: inline-block;
            background: linear-gradient(90deg, #3a3a3a 25%, #4a4a4a 50%, #3a3a3a 75%);
            background-size: 200% 100%;
            animation: avatarWave 1.5s infinite linear;
            border-radius: 50%;
            background-position: center;
            background-repeat: no-repeat;
            overflow: hidden;
          }
        \`, 1);
      }
      if (styleEl && styleEl.sheet && src) {
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
  }`);

fs.writeFileSync('src/renderer/social-feed.ts', ts, 'utf8');
console.log('Fixed avatarImgBits signature with correct regex');
