const fs = require('fs');
let indexHtml = fs.readFileSync('src/renderer/index.html', 'utf8');

const modalHtml = `
  <div id="modal-build-group" class="modal-overlay hidden">
    <div class="modal-window md">
      <div class="modal-header">
        <div class="modal-header-text">
          <div class="modal-header-title" id="modal-build-group-title" data-i18n="builds.groupCreateTitle">Новая группа</div>
          <div class="modal-header-sub" data-i18n="builds.groupCreateSub">Название, иконка и список сборок</div>
        </div>
        <button class="modal-close" id="modal-build-group-close" type="button" aria-label="Close">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M0 1.06066C0 0.474874 0.474874 0 1.06066 0C1.34196 0 1.61175 0.111748 1.81066 0.31066L11.6893 10.1893C11.8883 10.3883 12 10.658 12 10.9393C12 11.5251 11.5251 12 10.9393 12C10.658 12 10.3883 11.8883 10.1893 11.6893L0.31066 1.81066C0.111748 1.61175 0 1.34196 0 1.06066Z" fill="currentColor"/><path d="M1.06066 12C0.474874 12 5.66382e-09 11.5251 1.26493e-08 10.9393C1.60038e-08 10.658 0.111748 10.3883 0.31066 10.1893L10.1893 0.31066C10.3883 0.111748 10.658 1.27096e-07 10.9393 1.30451e-07C11.5251 1.37436e-07 12 0.474874 12 1.06066C12 1.34196 11.8883 1.61175 11.6893 1.81066L1.81066 11.6893C1.61175 11.8883 1.34196 12 1.06066 12Z" fill="currentColor"/></svg>
        </button>
      </div>
      <div class="modal-body build-group-modal-body">
        <label class="build-group-field">
          <span data-i18n="builds.groupName">Название группы</span>
          <input type="text" id="modal-build-group-name" class="form-input" maxlength="48" placeholder="Например: Выживание">
        </label>
        <div class="build-group-field">
          <span data-i18n="builds.groupIcon">Иконка</span>
          <div class="build-group-icon-row">
            <div id="modal-build-group-icon-preview" class="be-icon-preview"></div>
            <div class="be-icon-grid" id="modal-build-group-icon-grid"></div>
          </div>
          <input type="file" id="modal-build-group-icon-input" accept="image/png,image/jpeg,image/webp" style="display:none;">
          <button type="button" class="stngs-btn ghost" id="modal-build-group-icon-upload" data-i18n="builds.groupIconUpload">Загрузить свою</button>
        </div>
        <div class="build-group-field">
          <span data-i18n="builds.groupMembers">Сборки в группе</span>
          <div id="modal-build-group-builds" class="build-group-builds"></div>
        </div>
      </div>
      <div class="modal-footer build-group-modal-footer">
        <button type="button" class="stngs-btn ghost danger hidden" id="modal-build-group-delete" data-i18n="builds.groupDelete">Удалить группу</button>
        <div class="build-group-modal-footer__right">
          <button type="button" class="stngs-btn ghost" id="modal-build-group-cancel" data-i18n="btn.cancel">Отмена</button>
          <button type="button" class="stngs-btn primary" id="modal-build-group-ok" data-i18n="btn.save">Сохранить</button>
        </div>
      </div>
    </div>
  </div>
`;

indexHtml = indexHtml.replace('<div id="app-toast"', modalHtml + '\n  <div id="app-toast"');
fs.writeFileSync('src/renderer/index.html', indexHtml, 'utf8');
console.log('Restored modal-build-group');
