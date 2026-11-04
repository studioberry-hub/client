const fs = require('fs');
const html = fs.readFileSync('src/renderer/index.html', 'utf8');

// Extract the news section and modals
const newsStart = html.indexOf('<div class="tab-view" id="tab-news">');
const newsEnd = html.indexOf('<!-- Skins Tab -->', newsStart);
const newsSection = html.substring(newsStart, newsEnd);

const modalStart = html.indexOf('<div id="modal-sf-post"');
const modalEnd = html.indexOf('<div id="modal-ai-access"', modalStart);
const modalSection = html.substring(modalStart, modalEnd);

const combined = newsSection + modalSection;

// Find all hardcoded Russian text that's garbled (contains mojibake patterns)
const garbledPattern = /(?:placeholder|title|aria-label|>)\s*=?\s*"?([^"<>]*(?:Р[^\x00-\x7F]|С[^\x00-\x7F])[^"<>]*)"?/g;
let m;
const found = [];
while ((m = garbledPattern.exec(combined)) !== null) {
  found.push(m[0].substring(0, 120));
}
if (found.length === 0) {
  console.log('No garbled text found in news/modal sections!');
} else {
  console.log('Found ' + found.length + ' garbled strings:');
  found.forEach(f => console.log('  ' + f));
}
