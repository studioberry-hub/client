const fs = require('fs');

// Get the clean HTML from git
const { execSync } = require('child_process');
const gitHtml = execSync('git show HEAD:src/renderer/index.html', { encoding: 'utf8', maxBuffer: 50*1024*1024 });

// Extract tab-news from git (clean)
const gitNewsMatch = gitHtml.match(/<div class="tab-view" id="tab-news">[\s\S]*?(?=\s*<!-- Skins Tab -->)/);
if (!gitNewsMatch) { console.error('No tab-news in git'); process.exit(1); }

// Extract modals from git (clean)  
const gitModalsMatch = gitHtml.match(/<div id="modal-sf-post"[\s\S]*?(?=\s*<div id="modal-ai-access")/);
if (!gitModalsMatch) { console.error('No modals in git'); process.exit(1); }

// Read current index.html
let current = fs.readFileSync('src/renderer/index.html', 'utf8');

// Replace tab-news
const curNewsMatch = current.match(/<div class="tab-view" id="tab-news">[\s\S]*?(?=\s*<!-- Skins Tab -->)/);
current = current.replace(curNewsMatch[0], gitNewsMatch[0]);

// Replace modals
const curModalsMatch = current.match(/<div id="modal-sf-post"[\s\S]*?(?=\s*<div id="modal-ai-access")/);
current = current.replace(curModalsMatch[0], gitModalsMatch[0]);

fs.writeFileSync('src/renderer/index.html', current, 'utf8');
console.log('Restored tab-news and modals from git HEAD (clean encoding)');
console.log('git news length:', gitNewsMatch[0].length);
console.log('git modals length:', gitModalsMatch[0].length);
