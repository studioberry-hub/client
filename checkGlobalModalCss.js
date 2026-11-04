const fs = require('fs');
const css = fs.readFileSync('src/renderer/styles.css', 'utf8');
console.log('modal-overlay:', css.includes('modal-overlay'));
console.log('modal-card:', css.includes('modal-card'));
