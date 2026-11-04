const { execSync } = require('child_process');
const gitHtml = execSync('git show HEAD:src/renderer/index.html', { encoding: 'utf8', maxBuffer: 50*1024*1024 });
console.log('Has modal-sf-post:', gitHtml.includes('modal-sf-post'));
console.log('Has modal-sf-compose:', gitHtml.includes('modal-sf-compose'));
console.log('Has tab-news:', gitHtml.includes('id="tab-news"'));

// What modals exist in git?
const modalIds = gitHtml.match(/id="modal-[^"]+"/g);
if (modalIds) console.log('Modal IDs in git:', modalIds.join(', '));
