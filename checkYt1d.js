const fs = require('fs');
const content = fs.readFileSync('C:/Users/PC-25/AppData/Roaming/Cursor/User/History/-2a42e37f/yt1d.ts', 'utf8');
console.log('nr-type-switch in yt1d.ts:', content.includes('nr-type-switch'));
console.log('modal-sf-clan in yt1d.ts:', content.includes('modal-sf-clan'));
