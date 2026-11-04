const fs = require('fs');
let code = fs.readFileSync('src/renderer/messenger/ui.ts', 'utf8');

const pasteListener = `
  input?.addEventListener('paste', (e) => {
    if (e.clipboardData && e.clipboardData.files && e.clipboardData.files.length > 0) {
      e.preventDefault();
      for (let i = 0; i < e.clipboardData.files.length; i++) {
        if (pendingFiles.length >= 5) break;
        const file = e.clipboardData.files[i];
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result;
          const b64 = typeof result === 'string' ? result.split(',')[1] : null;
          if (b64) {
            pendingFiles.push({
              name: file.name || 'clipboard.png',
              mime: file.type || 'application/octet-stream',
              base64: b64,
            });
            renderPendingFiles();
          }
        };
        reader.readAsDataURL(file);
      }
    }
  });
`;

code = code.replace(
  /input\?\.addEventListener\('input', \(\) => \{/,
  pasteListener + "\n  input?.addEventListener('input', () => {"
);

fs.writeFileSync('src/renderer/messenger/ui.ts', code, 'utf8');
console.log('Added paste listener');
