const fs = require('fs');
let html = fs.readFileSync('src/renderer/index.html', 'utf8');

const postReplacement = `<div id="modal-sf-post" class="modal-overlay hidden">
        <div class="modal-window sm" role="dialog" aria-modal="true">
          <div class="modal-header">
            <div class="modal-header-text">
              <div class="modal-header-title" data-i18n="news.newPost">Новый пост</div>
              <div class="modal-header-sub" data-i18n="news.newPostSub">Поделитесь чем-то с сообществом</div>
            </div>
            <button class="modal-close" id="modal-sf-post-close" type="button" aria-label="Close">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M0 1.06066C0 0.474874 0.474874 0 1.06066 0C1.34196 0 1.61175 0.111748 1.81066 0.31066L11.6893 10.1893C11.8883 10.3883 12 10.658 12 10.9393C12 11.5251 11.5251 12 10.9393 12C10.658 12 10.3883 11.8883 10.1893 11.6893L0.31066 1.81066C0.111748 1.61175 0 1.34196 0 1.06066Z" fill="currentColor" />
                <path d="M1.06066 12C0.474874 12 5.66382e-09 11.5251 1.26493e-08 10.9393C1.60038e-08 10.658 0.111748 10.3883 0.31066 10.1893L10.1893 0.31066C10.3883 0.111748 10.658 1.27096e-07 10.9393 1.30451e-07C11.5251 1.37436e-07 12 0.474874 12 1.06066C12 1.34196 11.8883 1.61175 11.6893 1.81066L1.81066 11.6893C1.61175 11.8883 1.34196 12 1.06066 12Z" fill="currentColor" />
              </svg>
            </button>
          </div>
          <div class="modal-body">
            <div class="sf-composer-wrap">
              <img class="sf-composer-avatar" id="sf-post-avatar" src="" alt="">
              <textarea id="sf-post-text" class="sf-composer-input" data-i18n-ph="news.composerPlaceholder" placeholder="Что нового? Markdown поддерживается"></textarea>
            </div>
            
            <div id="sf-post-photo-preview" class="sf-photo-preview hidden">
              <img id="sf-post-photo-img" alt="">
              <button class="sf-photo-remove" id="sf-post-photo-remove">✕</button>
            </div>
            
            <div class="sf-form-group sf-author-group">
              <label data-i18n="news.postAs">ОТ ИМЕНИ</label>
              <select id="sf-post-author" class="sf-select">
                <option value="self" data-i18n="news.postAsSelf">Личный аккаунт</option>
              </select>
              <p class="sf-hint" data-i18n="news.clanHint">Или от имени клана (скоро)</p>
            </div>
          </div>
          <div class="modal-footer sf-post-footer">
            <button type="button" class="stngs-btn ghost" id="sf-post-attach-btn" data-i18n="news.photo">Прикрепить</button>
            <button type="button" class="stngs-btn ghost" id="sf-post-create-clan-btn" data-i18n="news.createClan">Создать клан</button>
            <input type="file" id="sf-photo-input" accept="image/*" hidden>
            <div class="spacer"></div>
            <button type="button" class="stngs-btn primary" id="modal-sf-post-ok" data-i18n="news.publish">Опубликовать</button>
          </div>
        </div>
      </div>`;
      
const clanReplacement = `<div id="modal-sf-clan" class="modal-overlay hidden">
        <div class="modal-window sm" role="dialog" aria-modal="true">
          <div class="modal-header">
            <div class="modal-header-text">
              <div class="modal-header-title" data-i18n="news.createClan">Создать клан</div>
              <div class="modal-header-sub" data-i18n="news.clanSub">Создать новый клан</div>
            </div>
            <button class="modal-close" id="modal-sf-clan-close" type="button" aria-label="Close">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M0 1.06066C0 0.474874 0.474874 0 1.06066 0C1.34196 0 1.61175 0.111748 1.81066 0.31066L11.6893 10.1893C11.8883 10.3883 12 10.658 12 10.9393C12 11.5251 11.5251 12 10.9393 12C10.658 12 10.3883 11.8883 10.1893 11.6893L0.31066 1.81066C0.111748 1.61175 0 1.34196 0 1.06066Z" fill="currentColor" />
                <path d="M1.06066 12C0.474874 12 5.66382e-09 11.5251 1.26493e-08 10.9393C1.60038e-08 10.658 0.111748 10.3883 0.31066 10.1893L10.1893 0.31066C10.3883 0.111748 10.658 1.27096e-07 10.9393 1.30451e-07C11.5251 1.37436e-07 12 0.474874 12 1.06066C12 1.34196 11.8883 1.61175 11.6893 1.81066L1.81066 11.6893C1.61175 11.8883 1.34196 12 1.06066 12Z" fill="currentColor" />
              </svg>
            </button>
          </div>
          <div class="modal-body">
            <p class="sf-hint" data-i18n="news.clanExplain">Клан позволяет публиковать посты от его имени.</p>
            <div class="sf-clan-icon-row">
              <img class="sf-clan-icon-preview" id="sf-clan-icon-preview" alt="">
              <div>
                <button type="button" class="stngs-btn ghost" id="sf-clan-icon-btn" data-i18n="news.clanIcon">Иконка клана</button>
                <input type="file" id="sf-clan-icon-input" accept="image/*" hidden>
                <p class="sf-hint" data-i18n="news.clanIconHint">Загрузите иконку</p>
              </div>
            </div>
            
            <div class="sf-form-group">
              <label data-i18n="news.clanName">ИМЯ КЛАНА</label>
              <input type="text" id="sf-clan-name" maxlength="50" autocomplete="off" class="sf-input" data-i18n-ph="news.clanName" placeholder="Имя клана">
            </div>
            
            <div class="sf-form-group">
              <label data-i18n="news.clanDesc">ОПИСАНИЕ КЛАНА</label>
              <input type="text" id="sf-clan-desc" maxlength="500" autocomplete="off" class="sf-input" data-i18n-ph="news.clanDesc" placeholder="Описание клана">
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="stngs-btn ghost" id="modal-sf-clan-cancel" data-i18n="btn.cancel">Отмена</button>
            <button type="button" class="stngs-btn primary" id="modal-sf-clan-ok" data-i18n="news.createClan">Создать клан</button>
          </div>
        </div>
      </div>`;
      
const repostReplacement = `<div id="modal-sf-repost" class="modal-overlay hidden">
        <div class="modal-window sm" role="dialog" aria-modal="true">
          <div class="modal-header">
            <div class="modal-header-text">
              <div class="modal-header-title" data-i18n="news.repostTitle">Поделиться</div>
              <div class="modal-header-sub" data-i18n="news.repostSub">Поделиться с друзьями</div>
            </div>
            <button class="modal-close" id="modal-sf-repost-close" type="button" aria-label="Close">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M0 1.06066C0 0.474874 0.474874 0 1.06066 0C1.34196 0 1.61175 0.111748 1.81066 0.31066L11.6893 10.1893C11.8883 10.3883 12 10.658 12 10.9393C12 11.5251 11.5251 12 10.9393 12C10.658 12 10.3883 11.8883 10.1893 11.6893L0.31066 1.81066C0.111748 1.61175 0 1.34196 0 1.06066Z" fill="currentColor" />
                <path d="M1.06066 12C0.474874 12 5.66382e-09 11.5251 1.26493e-08 10.9393C1.60038e-08 10.658 0.111748 10.3883 0.31066 10.1893L10.1893 0.31066C10.3883 0.111748 10.658 1.27096e-07 10.9393 1.30451e-07C11.5251 1.37436e-07 12 0.474874 12 1.06066C12 1.34196 11.8883 1.61175 11.6893 1.81066L1.81066 11.6893C1.61175 11.8883 1.34196 12 1.06066 12Z" fill="currentColor" />
              </svg>
            </button>
          </div>
          <div class="modal-body">
            <div class="sf-form-group">
              <label data-i18n="news.repostPick">Выберите место</label>
              <div class="sf-repost-tabs">
                <button class="sf-repost-tab active" id="sf-repost-tab-wall" data-i18n="news.repostWall">На стену</button>
                <button class="sf-repost-tab" id="sf-repost-tab-chats" data-i18n="news.repostChats">В чаты</button>
              </div>
            </div>
            
            <div id="sf-repost-wall-view">
              <textarea id="sf-repost-comment" class="sf-composer-input" data-i18n-ph="news.repostCommentPh" placeholder="Добавьте комментарий..."></textarea>
            </div>
            
            <div id="sf-repost-chats-view" class="hidden">
              <p class="sf-hint" data-i18n="news.repostNoChats">Нет доступных чатов</p>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="stngs-btn ghost" id="modal-sf-repost-cancel" data-i18n="btn.cancel">Отмена</button>
            <button type="button" class="stngs-btn primary" id="modal-sf-repost-ok" data-i18n="news.repostTitle">Поделиться</button>
          </div>
        </div>
      </div>`;

html = html.replace(/<div id="modal-sf-post"[\s\S]*?(?=<div id="modal-sf-clan")/g, postReplacement + '\n\n      ');
html = html.replace(/<div id="modal-sf-clan"[\s\S]*?(?=<div id="modal-sf-repost")/g, clanReplacement + '\n\n      ');
html = html.replace(/<div id="modal-sf-repost"[\s\S]*?(?=<div id="modal-ai-access")/g, repostReplacement + '\n\n      ');

const tabNewsReplacement = `<div class="tab-view" id="tab-news">
          <div class="tab-header-row">
            <div class="tab-title-block">
              <img class="tab-title-icon" src="../../assets/tabsIcons/news.svg" alt="">
              <div class="tab-title-texts">
                <h1 data-i18n="news.title">Последние новости</h1>
                <p data-i18n="news.subtitle">Обновления лаунчера и важные объявления</p>
              </div>
            </div>
            <div class="tab-actions-block">
              <button class="stngs-btn primary" id="news-new-post-btn" data-i18n="news.newPost">Новый пост</button>
              <button class="stngs-btn ghost icon-only" id="news-notifs-btn" aria-label="Notifications" data-i18n-title="news.notificationsSoon" title="Уведомления (скоро)">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
              </button>
            </div>
          </div>
          <div class="nr-content">
            <aside class="nr-sidebar">
              <button class="nr-tab active" id="nr-tab-wall" data-i18n="news.wall">Новостная лента</button>
              <button class="nr-tab" id="nr-tab-official" data-i18n="news.clientNews">Новости клиента</button>
              <button class="nr-tab" id="nr-tab-community" data-i18n="news.feedCommunity">Сообщество</button>
            </aside>
            <section class="nr-main">
              <div class="nr-wall" id="sf-main-wall">
                <div class="sf-empty" id="sf-main-empty" data-i18n="news.feedEmpty">Лента пуста</div>
                <div class="sf-loading hidden" id="sf-main-loading" data-i18n="news.loading">Загрузка...</div>
              </div>
              <div class="nr-wall__official hidden" id="sf-official-news" aria-hidden="true"></div>
            </section>
          </div>
        </div>`;

html = html.replace(/<div class="tab-view" id="tab-news">[\s\S]*?<!-- Skins Tab -->/, tabNewsReplacement + '\n\n        <!-- Skins Tab -->');

fs.writeFileSync('src/renderer/index.html', html);
console.log('Fixed garbled text');
