const fs = require('fs');
let css = fs.readFileSync('src/renderer/styles.css', 'utf8');

const newStyles = `
/* Rich Message Styles */
.msgr-link {
  color: var(--accent);
  text-decoration: underline;
  word-break: break-all;
  cursor: pointer;
}
.msgr-link:hover {
  filter: brightness(1.2);
}

.msgr-share-tile {
  display: flex;
  align-items: center;
  gap: 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 12px;
  margin-top: 8px;
  max-width: 300px;
}
.msgr-share-tile-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: var(--accent);
}
.msgr-share-tile-info {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.msgr-share-tile-title {
  font-size: 13px;
  font-weight: 600;
  color: #fff;
}
.msgr-share-btn, .msgr-join-chat-btn {
  padding: 4px 12px;
  font-size: 12px;
  border-radius: 4px;
}

.sf-repost-tile {
  display: flex;
  align-items: stretch;
  gap: 12px;
  background: rgba(255, 255, 255, 0.05);
  border-left: 3px solid var(--accent);
  border-radius: 4px;
  padding: 8px 12px;
  margin-top: 8px;
  cursor: pointer;
  transition: background 0.1s;
}
.sf-repost-tile:hover {
  background: rgba(255, 255, 255, 0.1);
}
.sf-repost-tile-img {
  width: 48px;
  height: 48px;
  object-fit: cover;
  border-radius: 4px;
  flex-shrink: 0;
}
.sf-repost-tile-content {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.sf-repost-tile-author {
  font-size: 12px;
  font-weight: 700;
  color: var(--accent);
}
.sf-repost-tile-snippet {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.8);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
`;

if (!css.includes('.msgr-share-tile')) {
  fs.writeFileSync('src/renderer/styles.css', css + '\n' + newStyles, 'utf8');
  console.log('Added rich styles');
} else {
  console.log('Styles already exist');
}
