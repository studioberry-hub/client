const fs = require('fs');
const html = fs.readFileSync('src/renderer/index.html', 'utf8');
const nsI = html.indexOf('<div class="tab-view" id="tab-news">');
const meI = html.indexOf('<div id="modal-ai-access"');
const section = html.substring(nsI, meI);
// Check for actual mojibake: sequences like РЎ or Р° that are NOT valid Russian
const realMojibake = section.match(/\u0420[\u00b0-\u00bf\u0400-\u04FF]|\u0421[\u0080-\u009F\u2000-\u206F]/g);
console.log('Real mojibake sequences:', realMojibake ? realMojibake.length : 0);

// Quick visual check of all inner text
const texts = section.match(/>([^<]{3,})</g);
const suspicious = texts ? texts.filter(t => /[\u0420\u0421][\u00b0-\u00bf]/.test(t)) : [];
if (suspicious.length) {
  console.log('Suspicious texts:');
  suspicious.forEach(s => console.log('  ' + s.substring(0, 80)));
} else {
  console.log('No suspicious texts found - all clean!');
}
