const fs = require('fs');
let code = fs.readFileSync('src/renderer/messenger/ui.ts', 'utf8');

const enrichFn = `
/** Asynchronously fetch build metadata for [data-enrich-share] tiles */
const _shareCache = new Map();
async function enrichShareTiles(container) {
  const tiles = container.querySelectorAll('[data-enrich-share]');
  if (!tiles.length) return;
  for (const tile of Array.from(tiles)) {
    const shareId = tile.getAttribute('data-enrich-share');
    if (!shareId) continue;
    tile.removeAttribute('data-enrich-share');
    try {
      let info = _shareCache.get(shareId);
      if (!info) {
        const res = await fetch(getApiBase() + '/client/api/instance-share/' + encodeURIComponent(shareId));
        if (res.ok) {
          const data = await res.json();
          info = {
            name: data.name || data.buildName || 'Сборка',
            icon: data.iconUrl || null,
            gameVersion: data.gameVersion || '',
            loader: data.loader || '',
          };
          _shareCache.set(shareId, info);
        }
      }
      if (info) {
        const titleEl = tile.querySelector('.msgr-share-tile-title');
        if (titleEl) titleEl.textContent = info.name;
        const iconEl = tile.querySelector('.msgr-share-tile-icon');
        if (iconEl && info.icon) {
          const escaped = host && host.escapeHtml ? host.escapeHtml(info.icon) : info.icon;
          iconEl.innerHTML = '<img src="' + escaped + '" width="32" height="32" style="border-radius:4px;object-fit:cover" alt="">';
        }
        const infoEl = tile.querySelector('.msgr-share-tile-info');
        if (infoEl && (info.gameVersion || info.loader)) {
          const sub = document.createElement('div');
          sub.className = 'msgr-share-tile-sub';
          sub.textContent = [info.gameVersion, info.loader].filter(Boolean).join(' · ');
          const btn = infoEl.querySelector('button');
          if (btn) infoEl.insertBefore(sub, btn);
        }
      }
    } catch (e) { /* network error — leave as-is */ }
  }
}
`;

// Insert enrichShareTiles call after scrollTop
code = code.replace(
  /else thread\.scrollTop = savedScrollTop;\r?\n\}/,
  'else thread.scrollTop = savedScrollTop;\n  void enrichShareTiles(thread);\n}\n' + enrichFn
);

fs.writeFileSync('src/renderer/messenger/ui.ts', code, 'utf8');
console.log('Added enrichShareTiles');
