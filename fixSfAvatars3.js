const fs = require('fs');
let ts = fs.readFileSync('src/renderer/social-feed.ts', 'utf8');

ts = ts.replace(
  /const styleEl = document\.getElementById\('msgr-avatar-styles'\) as HTMLStyleElement;/,
  `let styleEl = document.getElementById('msgr-avatar-styles') as HTMLStyleElement;
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
      }`
);

fs.writeFileSync('src/renderer/social-feed.ts', ts, 'utf8');
console.log('social-feed.ts handles missing styleEl');
