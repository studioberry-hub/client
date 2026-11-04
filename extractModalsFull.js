const fs = require('fs');
const content = fs.readFileSync('C:/Users/PC-25/AppData/Roaming/Cursor/User/History/-4c05a7/TmW7.html', 'utf8');
const lines = content.split('\n');
let start = -1;
let end = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('id="modal-sf-post"')) start = i;
  if (lines[i].includes('id="modal-ai-access"')) { end = i; break; }
}
if (start > -1 && end > -1) {
  const extracted = lines.slice(start, end).join('\n');
  fs.writeFileSync('extracted_modals_full.html', extracted);
}
