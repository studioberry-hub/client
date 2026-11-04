const fs = require('fs');
const { execSync } = require('child_process');

// Step 1: Get clean tab-news from git HEAD
const gitHtml = execSync('git show HEAD:src/renderer/index.html', { encoding: 'utf8', maxBuffer: 50*1024*1024 });
const gitNewsMatch = gitHtml.match(/<div class="tab-view" id="tab-news">[\s\S]*?(?=\s*<!-- Skins Tab -->)/);

// Step 2: Read current html
let html = fs.readFileSync('src/renderer/index.html', 'utf8');

// Step 3: Replace tab-news with git version (clean encoding)
const curNewsMatch = html.match(/<div class="tab-view" id="tab-news">[\s\S]*?(?=\s*<!-- Skins Tab -->)/);
html = html.replace(curNewsMatch[0], gitNewsMatch[0]);

// Step 4: Now fix modals - write clean versions directly
// The modals from src-unbroken have garbled text. We'll write them fresh.
const cleanModals = `
  <div id="modal-sf-post" class="modal-overlay hidden sf-modal">
    <div class="modal-card">
      <div class="modal-header">
        <h2 id="sf-modal-title" data-i18n="news.openPost">Пост</h2>
        <button class="modal-close" id="modal-sf-post-close" type="button" aria-label="Close">\u00d7</button>
      </div>
      <div class="modal-body" id="sf-modal-body"></div>
    </div>
  </div>

  <div id="modal-sf-compose" class="modal-overlay hidden sf-compose-modal">
    <div class="modal-card">
      <div class="modal-header">
        <h2 id="sf-compose-title" data-i18n="news.newPost">Новый пост</h2>
        <p data-i18n="news.newPostSub">Поделитесь чем-то с сообществом</p>
        <button class="modal-close" id="sf-compose-close" type="button" aria-label="Close">\u00d7</button>
      </div>
      <div class="modal-body">
        <div class="news-composer">
          <div class="news-composer__row">
            <img class="news-composer__avatar" id="sf-composer-avatar" alt="">
            <div class="modal-field news-composer__field">
              <textarea id="sf-composer-input" rows="5" placeholder="Что нового? Markdown поддерживается" data-i18n-placeholder="news.composerPlaceholder"></textarea>
            </div>
          </div>
          <div class="news-composer__previews" id="sf-composer-previews"></div>
          <div class="modal-field">
            <label data-i18n="news.postAs">ОТ ИМЕНИ</label>
            <select id="sf-composer-author" class="stngs-input">
              <option value="self" data-i18n="news.postAsSelf">Личный аккаунт</option>
            </select>
          </div>
          <div class="news-composer__clan-hint" data-i18n="news.clanHint">Или от имени клана (скоро)</div>
        </div>
        <div class="modal-footer news-composer__footer">
          <button type="button" class="stngs-btn ghost" id="sf-composer-photo" data-i18n="news.photo">Прикрепить</button>
          <button type="button" class="stngs-btn ghost" id="sf-composer-clan-btn" data-i18n="news.createClan">Создать клан</button>
          <button type="button" class="stngs-btn primary" id="sf-composer-submit" data-i18n="news.publish">Опубликовать</button>
        </div>
      </div>
    </div>
  </div>

  <div id="modal-sf-clan" class="modal-overlay hidden sf-clan-modal">
    <div class="modal-card">
      <div class="modal-header">
        <h2 id="sf-clan-title" data-i18n="news.createClan">Создать клан</h2>
        <p data-i18n="news.clanSub">Сообщество с постами и чатом</p>
        <button class="modal-close" id="sf-clan-close" type="button" aria-label="Close">\u00d7</button>
      </div>
      <div class="modal-body">
        <p class="modal-explain" data-i18n="news.clanExplain">Клан — канал сообщества (сервер, гильдия, интерес). Владелец и админы публикуют посты от имени клана; при создании создаётся чат.</p>
        <div class="modal-field">
          <label data-i18n="news.clanIcon">Иконка клана</label>
          <span class="modal-field-hint" data-i18n="news.clanIconHint">JPEG, квадрат. Можно задать при создании или позже.</span>
          <input type="file" id="sf-clan-icon" accept="image/jpeg,image/png">
        </div>
        <div class="modal-field">
          <label data-i18n="news.clanName">НАЗВАНИЕ</label>
          <input type="text" id="sf-clan-name" class="stngs-input" maxlength="48" placeholder="Например: Vialand">
        </div>
        <div class="modal-field">
          <label data-i18n="news.clanDesc">ОПИСАНИЕ</label>
          <textarea id="sf-clan-desc" class="stngs-input" rows="2" maxlength="200" placeholder="Кратко о сообществе"></textarea>
        </div>
        <div class="modal-footer">
          <button type="button" class="stngs-btn ghost" id="sf-clan-cancel" data-i18n="btn.cancel">Отмена</button>
          <button type="button" class="stngs-btn primary" id="sf-clan-submit" data-i18n="news.createClan">Создать клан</button>
        </div>
      </div>
    </div>
  </div>

  <div id="modal-sf-repost" class="modal-overlay hidden sf-repost-modal">
    <div class="modal-card">
      <div class="modal-header">
        <h2 id="sf-repost-title" data-i18n="news.repostTitle">Репост</h2>
        <p data-i18n="news.repostSub">На стену или в чаты</p>
        <button class="modal-close" id="sf-repost-close" type="button" aria-label="Close">\u00d7</button>
      </div>
      <div class="modal-body">
        <div class="sf-repost-tabs">
          <button class="sf-repost-tab is-active" id="sf-repost-tab-wall" data-i18n="news.repostWall">На стену</button>
          <button class="sf-repost-tab" id="sf-repost-tab-chats" data-i18n="news.repostChats">В чаты</button>
        </div>
        <div class="sf-repost-panel" id="sf-repost-panel-wall">
          <div class="modal-field">
            <label data-i18n="news.repostComment">Комментарий к репосту</label>
            <textarea id="sf-repost-comment" class="stngs-input" rows="2" placeholder="Необязательно" data-i18n-placeholder="news.repostCommentPh"></textarea>
          </div>
        </div>
        <div class="sf-repost-panel hidden" id="sf-repost-panel-chats">
          <div id="sf-repost-chat-list"></div>
          <div class="sf-repost-no-chats hidden" id="sf-repost-no-chats" data-i18n="news.repostNoChats">Нет доступных чатов</div>
        </div>
        <div class="modal-footer">
          <button type="button" class="stngs-btn ghost" id="sf-repost-cancel" data-i18n="btn.cancel">Отмена</button>
          <button type="button" class="stngs-btn primary" id="sf-repost-submit" data-i18n="news.repostSend">Отправить</button>
        </div>
      </div>
    </div>
  </div>

  `;

// Replace modals
const modalsMatch = html.match(/<div id="modal-sf-post"[\s\S]*?(?=\s*<div id="modal-ai-access")/);
if (modalsMatch) {
  html = html.replace(modalsMatch[0], cleanModals);
  console.log('Replaced modals with clean versions');
} else {
  // Insert before modal-ai-access
  const aiIdx = html.indexOf('<div id="modal-ai-access"');
  html = html.substring(0, aiIdx) + cleanModals + html.substring(aiIdx);
  console.log('Inserted clean modals before modal-ai-access');
}

fs.writeFileSync('src/renderer/index.html', html, 'utf8');
console.log('Done: clean tab-news from git + clean modals written');
