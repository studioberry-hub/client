const fs = require('fs');
let css = fs.readFileSync('src/renderer/styles.css', 'utf8');

if (!css.includes('.msgr-avatar__skeleton')) {
  css += `\n
@keyframes avatarWave {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
.msgr-avatar__skeleton {
  background: linear-gradient(90deg, #3a3a3a 25%, #4a4a4a 50%, #3a3a3a 75%) !important;
  background-size: 200% 100% !important;
  animation: avatarWave 1.5s infinite linear !important;
}
img.msgr-avatar__skeleton {
  color: transparent !important;
}
`;
  fs.writeFileSync('src/renderer/styles.css', css, 'utf8');
  console.log('Added skeleton CSS to styles.css');
}
