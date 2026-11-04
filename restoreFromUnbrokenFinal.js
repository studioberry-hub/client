const fs = require('fs');

// Read the unbroken index.html
const unbroken = fs.readFileSync('src-unbroken/renderer/index.html', 'utf8');

// Extract tab-news from unbroken
const newsMatch = unbroken.match(/<div class="tab-view" id="tab-news">[\s\S]*?(?=\s*<!-- Skins Tab -->)/);
if (!newsMatch) { console.error('Could not find tab-news in unbroken'); process.exit(1); }
console.log('Extracted tab-news from unbroken, length:', newsMatch[0].length);

// Extract modals from unbroken (modal-sf-post through to modal-ai-access)
const modalsMatch = unbroken.match(/<div id="modal-sf-post"[\s\S]*?(?=\s*<div id="modal-ai-access")/);
if (!modalsMatch) { console.error('Could not find modals in unbroken'); process.exit(1); }
console.log('Extracted modals from unbroken, length:', modalsMatch[0].length);

// Read current index.html
let current = fs.readFileSync('src/renderer/index.html', 'utf8');

// Replace tab-news in current
const currentNewsMatch = current.match(/<div class="tab-view" id="tab-news">[\s\S]*?(?=\s*<!-- Skins Tab -->)/);
if (!currentNewsMatch) { console.error('Could not find tab-news in current'); process.exit(1); }
console.log('Found tab-news in current, length:', currentNewsMatch[0].length);
current = current.replace(currentNewsMatch[0], newsMatch[0]);

// Replace modals in current
const currentModalsMatch = current.match(/<div id="modal-sf-post"[\s\S]*?(?=\s*<div id="modal-ai-access")/);
if (!currentModalsMatch) { console.error('Could not find modals in current'); process.exit(1); }
console.log('Found modals in current, length:', currentModalsMatch[0].length);
current = current.replace(currentModalsMatch[0], modalsMatch[0]);

fs.writeFileSync('src/renderer/index.html', current, 'utf8');
console.log('Done: restored tab-news and modals from src-unbroken');
