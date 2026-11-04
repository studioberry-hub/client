const fs = require('fs');
let indexHtml = fs.readFileSync('src/renderer/index.html', 'utf8');
const buttonHtml = `
                  <button class="action-btn ghost" id="add-build-group-btn">
                    <span class="action-btn__icon" style="--action-icon: url('../../assets/icons/add.svg')" aria-hidden="true"></span>
                    <span data-i18n="builds.addGroup">Создать группу</span>
                  </button>`;
indexHtml = indexHtml.replace('<button class="action-btn" id="add-build-btn">', buttonHtml + '\n                  <button class="action-btn" id="add-build-btn">');
fs.writeFileSync('src/renderer/index.html', indexHtml, 'utf8');
console.log('Restored add-build-group-btn');
