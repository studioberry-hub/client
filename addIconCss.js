const fs = require('fs');
let css = fs.readFileSync('src/renderer/styles.css', 'utf8');

css += `\n
.msgr-bubble__read-icon {
  width: 15px;
  height: 15px;
  margin-top: -1px;
  opacity: 0.95;
}
`;

fs.writeFileSync('src/renderer/styles.css', css, 'utf8');
console.log('Added .msgr-bubble__read-icon to styles.css');
