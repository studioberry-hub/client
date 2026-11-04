const fs = require('fs');
let code = fs.readFileSync('src/renderer/messenger/ui.ts', 'utf8');

const regexFix = `
  // Check if it's a legacy repost in text (or if backend isn't updated)
  const repostMatch = html.match(/🔄 Репост · (.*?)\\n([\\s\\S]*?)#post:([\\w-]+)/s);
  if (repostMatch) {
    const author = repostMatch[1].trim();
    const snippet = repostMatch[2].trim();
    const postId = repostMatch[3].trim();
    
    const tileHtml = \`
      <div class="sf-repost-tile" data-sf-repost="\${host?.escapeHtml(postId)}">
        <div class="sf-repost-tile-content">
          <div class="sf-repost-tile-author">\${host?.escapeHtml(author)}</div>
          <div class="sf-repost-tile-snippet">\${host?.escapeHtml(snippet)}</div>
        </div>
      </div>
    \`;
    html = html.replace(repostMatch[0], '').trim();
    hasSpecialTile += tileHtml;
  }
`;

code = code.replace(
  "const urlRegex = /(https?:\\/\\/[^\\s]+)/g;",
  regexFix + "\n  const urlRegex = /(https?:\\/\\/[^\\s]+)/g;"
);

fs.writeFileSync('src/renderer/messenger/ui.ts', code, 'utf8');
console.log('Added legacy repost text parser');
