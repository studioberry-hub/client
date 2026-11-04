const fs = require('fs');

const enAdd = {
  "builds.groupCount": "{count} builds",
  "news.title": "Latest News",
  "news.subtitle": "Launcher updates and important announcements",
  "news.newPost": "New Post",
  "news.notificationsSoon": "Notifications (soon)",
  "news.wall": "News Feed",
  "news.clientNews": "Client News",
  "news.feedCommunity": "Community",
  "news.feedEmpty": "Feed is empty",
  "news.loading": "Loading...",
  "news.createClan": "Create Clan",
  "news.clanSub": "Create a new clan",
  "news.clanExplain": "A clan allows publishing posts on its behalf.",
  "news.clanIcon": "Clan Icon",
  "news.clanIconHint": "Upload an icon",
  "news.clanName": "CLAN NAME",
  "news.clanDesc": "CLAN DESCRIPTION",
  "btn.cancel": "Cancel",
  "news.newPostSub": "Share something with the community",
  "news.composerPlaceholder": "What's new? Markdown is supported",
  "news.postAs": "POST AS",
  "news.postAsSelf": "Personal account",
  "news.clanHint": "Or as a clan (soon)",
  "news.photo": "Attach Photo",
  "news.publish": "Publish",
  "news.repostTitle": "Share",
  "news.repostSub": "Share with friends",
  "news.repostPick": "Choose destination",
  "news.repostWall": "On wall",
  "news.repostChats": "In chats",
  "news.repostCommentPh": "Add a comment...",
  "news.repostNoChats": "No available chats"
};

const ruAdd = {
  "builds.groupCount": "{count} сборок",
  "news.title": "Последние новости",
  "news.subtitle": "Обновления лаунчера и важные объявления",
  "news.newPost": "Новый пост",
  "news.notificationsSoon": "Уведомления (скоро)",
  "news.wall": "Новостная лента",
  "news.clientNews": "Новости клиента",
  "news.feedCommunity": "Сообщество",
  "news.feedEmpty": "Лента пуста",
  "news.loading": "Загрузка...",
  "news.createClan": "Создать клан",
  "news.clanSub": "Создать новый клан",
  "news.clanExplain": "Клан позволяет публиковать посты от его имени.",
  "news.clanIcon": "Иконка клана",
  "news.clanIconHint": "Загрузите иконку",
  "news.clanName": "ИМЯ КЛАНА",
  "news.clanDesc": "ОПИСАНИЕ КЛАНА",
  "btn.cancel": "Отмена",
  "news.newPostSub": "Поделитесь чем-то с сообществом",
  "news.composerPlaceholder": "Что нового? Markdown поддерживается",
  "news.postAs": "ОТ ИМЕНИ",
  "news.postAsSelf": "Личный аккаунт",
  "news.clanHint": "Или от имени клана (скоро)",
  "news.photo": "Прикрепить",
  "news.publish": "Опубликовать",
  "news.repostTitle": "Поделиться",
  "news.repostSub": "Поделиться с друзьями",
  "news.repostPick": "Выберите место",
  "news.repostWall": "На стену",
  "news.repostChats": "В чаты",
  "news.repostCommentPh": "Добавьте комментарий...",
  "news.repostNoChats": "Нет доступных чатов"
};

const localesDir = 'D:/vbProj/uclient/src/renderer/locales';
const files = fs.readdirSync(localesDir);

for (const file of files) {
  if (!file.endsWith('.json')) continue;
  
  const p = localesDir + '/' + file;
  let raw = fs.readFileSync(p, 'utf8');
  const hasBom = raw.charCodeAt(0) === 0xFEFF;
  if (hasBom) raw = raw.slice(1);
  
  const data = JSON.parse(raw);
  const lang = file.replace('.json', '');
  
  const patch = (lang === 'en') ? enAdd : ruAdd;
  
  for (const [k, v] of Object.entries(patch)) {
    if (!data[k]) {
      data[k] = v;
    } else {
      // Overwrite if garbled
      if (typeof data[k] === 'string' && data[k].includes('Р')) {
         data[k] = v;
      }
    }
  }
  
  let out = JSON.stringify(data, null, 2);
  if (hasBom) out = '\uFEFF' + out;
  fs.writeFileSync(p, out, 'utf8');
}
console.log('Injected translations into locales successfully');
