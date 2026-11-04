const fs = require('fs');
const path = require('path');

const srcDir = 'D:/vbProj/uclient/src-unbroken/renderer/locales';
const destDir = 'D:/vbProj/uclient/src/renderer/locales';

if (fs.existsSync(srcDir)) {
  const files = fs.readdirSync(srcDir);
  for (const file of files) {
    if (file.endsWith('.json')) {
      fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
    }
  }
  console.log('Restored locales from src-unbroken');
} else {
  console.log('src-unbroken not found');
}
