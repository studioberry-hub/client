const fs = require('fs');
let css = fs.readFileSync('src/renderer/styles.css', 'utf8');
if (!css.includes('.msgr-share-tile-sub')) {
  css += `
.msgr-share-tile-sub {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  margin-top: 2px;
}
`;
  fs.writeFileSync('src/renderer/styles.css', css, 'utf8');
  console.log('Added sub style');
} else {
  console.log('Sub style already exists');
}
