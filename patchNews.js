const fs = require('fs');
const path = require('path');

function addKeys(file, keys) {
  let content = fs.readFileSync(file, 'utf8');
  const obj = JSON.parse(content);
  Object.assign(obj, keys);
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

addKeys('src/renderer/locales/ru.json', {
  'news.wall': 'Новостная лента',
  'news.feedCommunity': 'Сообщество',
  'news.clientNews': 'Новости клиента',
  'news.newPost': 'Новый пост',
  'news.newPostSub': 'Поделитесь чем-то с сообществом',
  'news.postAs': 'От имени',
  'news.postAsSelf': 'Личный аккаунт',
  'news.clanHint': 'Или от имени клана (скоро)',
  'news.photo': 'Прикрепить',
  'news.createClan': 'Создать клан',
  'news.publish': 'Опубликовать'
});

addKeys('src/renderer/locales/en.json', {
  'news.wall': 'News Wall',
  'news.feedCommunity': 'Community',
  'news.clientNews': 'Client News',
  'news.newPost': 'New Post',
  'news.newPostSub': 'Share something with the community',
  'news.postAs': 'Post as',
  'news.postAsSelf': 'Personal Account',
  'news.clanHint': 'Or as a clan (coming soon)',
  'news.photo': 'Attach',
  'news.createClan': 'Create Clan',
  'news.publish': 'Publish'
});
