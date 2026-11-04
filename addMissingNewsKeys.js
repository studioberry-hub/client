const fs = require('fs');

const missing = {
  en: {
    "news.clanNameRequired": "Clan name is required",
    "news.commentDeleted": "Comment deleted",
    "news.commentEmpty": "Comment cannot be empty",
    "news.commentPlaceholder": "Write a comment…",
    "news.comments": "Comments",
    "news.deleteComment": "Delete comment",
    "news.deleteCommentConfirm": "Delete this comment?",
    "news.deleteConfirm": "Delete this post?",
    "news.deletePost": "Delete post",
    "news.deleted": "Post deleted",
    "news.noComments": "No comments yet",
    "news.reply": "Reply",
    "news.replyPlaceholder": "Write a reply…",
    "news.replyTo": "Reply to {name}",
    "news.repostComment": "Comment",
    "news.repostSend": "Share",
    "news.repostedWall": "Shared on wall"
  },
  ru: {
    "news.clanNameRequired": "Укажите название клана",
    "news.commentDeleted": "Комментарий удалён",
    "news.commentEmpty": "Комментарий не может быть пустым",
    "news.commentPlaceholder": "Написать комментарий…",
    "news.comments": "Комментарии",
    "news.deleteComment": "Удалить комментарий",
    "news.deleteCommentConfirm": "Удалить этот комментарий?",
    "news.deleteConfirm": "Удалить этот пост?",
    "news.deletePost": "Удалить пост",
    "news.deleted": "Пост удалён",
    "news.noComments": "Пока нет комментариев",
    "news.reply": "Ответить",
    "news.replyPlaceholder": "Написать ответ…",
    "news.replyTo": "Ответ для {name}",
    "news.repostComment": "Комментарий",
    "news.repostSend": "Поделиться",
    "news.repostedWall": "Опубликовано на стене"
  },
  uk: {
    "news.clanNameRequired": "Вкажіть назву клану",
    "news.commentDeleted": "Коментар видалено",
    "news.commentEmpty": "Коментар не може бути порожнім",
    "news.commentPlaceholder": "Написати коментар…",
    "news.comments": "Коментарі",
    "news.deleteComment": "Видалити коментар",
    "news.deleteCommentConfirm": "Видалити цей коментар?",
    "news.deleteConfirm": "Видалити цей пост?",
    "news.deletePost": "Видалити пост",
    "news.deleted": "Пост видалено",
    "news.noComments": "Поки що немає коментарів",
    "news.reply": "Відповісти",
    "news.replyPlaceholder": "Написати відповідь…",
    "news.replyTo": "Відповідь для {name}",
    "news.repostComment": "Коментар",
    "news.repostSend": "Поділитися",
    "news.repostedWall": "Опубліковано на стіні"
  },
  kk: {
    "news.clanNameRequired": "Клан атауын көрсетіңіз",
    "news.commentDeleted": "Пікір жойылды",
    "news.commentEmpty": "Пікір бос болмауы керек",
    "news.commentPlaceholder": "Пікір жазыңыз…",
    "news.comments": "Пікірлер",
    "news.deleteComment": "Пікірді жою",
    "news.deleteCommentConfirm": "Бұл пікірді жоясыз ба?",
    "news.deleteConfirm": "Бұл жазбаны жоясыз ба?",
    "news.deletePost": "Жазбаны жою",
    "news.deleted": "Жазба жойылды",
    "news.noComments": "Әзірге пікірлер жоқ",
    "news.reply": "Жауап беру",
    "news.replyPlaceholder": "Жауап жазыңыз…",
    "news.replyTo": "{name} үшін жауап",
    "news.repostComment": "Пікір",
    "news.repostSend": "Бөлісу",
    "news.repostedWall": "Қабырғаға жарияланды"
  },
  tt: {
    "news.clanNameRequired": "Клан исемен күрсәтегез",
    "news.commentDeleted": "Фикер бетерелде",
    "news.commentEmpty": "Фикер буш булырга тиеш түгел",
    "news.commentPlaceholder": "Фикер языгыз…",
    "news.comments": "Фикерләр",
    "news.deleteComment": "Фикерне бетерү",
    "news.deleteCommentConfirm": "Бу фикерне бетерергәме?",
    "news.deleteConfirm": "Бу язманы бетерергәме?",
    "news.deletePost": "Язманы бетерү",
    "news.deleted": "Язма бетерелде",
    "news.noComments": "Әлегә фикерләр юк",
    "news.reply": "Җавап бирү",
    "news.replyPlaceholder": "Җавап языгыз…",
    "news.replyTo": "{name} өчен җавап",
    "news.repostComment": "Фикер",
    "news.repostSend": "Уртаклашу",
    "news.repostedWall": "Стенага бастырылды"
  },
  kbd: {
    "news.clanNameRequired": "Кланым и цIэр къыхэф",
    "news.commentDeleted": "Псалъэр хахыжащ",
    "news.commentEmpty": "Псалъэр нэщI хъунукIэ хъунущ",
    "news.commentPlaceholder": "Псалъэ тхы…",
    "news.comments": "Псалъэхэр",
    "news.deleteComment": "Псалъэр хах",
    "news.deleteCommentConfirm": "Мы псалъэр пхахыжын?",
    "news.deleteConfirm": "Мы тхыгъэр пхахыжын?",
    "news.deletePost": "Тхыгъэр хах",
    "news.deleted": "Тхыгъэр хахыжащ",
    "news.noComments": "Иджыри псалъэ щыIэкъым",
    "news.reply": "Жэуап етыж",
    "news.replyPlaceholder": "Жэуап тхы…",
    "news.replyTo": "{name} жэуап",
    "news.repostComment": "Псалъэ",
    "news.repostSend": "Хэгуашэ",
    "news.repostedWall": "Блыным тралъхьащ"
  }
};

const dir = 'src/renderer/locales';
for (const lang of Object.keys(missing)) {
  const file = dir + '/' + lang + '.json';
  let raw = fs.readFileSync(file, 'utf8');
  const hasBom = raw.charCodeAt(0) === 0xFEFF;
  if (hasBom) raw = raw.slice(1);
  const data = JSON.parse(raw);

  let added = 0;
  for (const [k, v] of Object.entries(missing[lang])) {
    if (!(k in data)) {
      data[k] = v;
      added++;
    }
  }

  let out = JSON.stringify(data, null, 2) + '\n';
  if (hasBom) out = '\uFEFF' + out;
  fs.writeFileSync(file, out, 'utf8');
  console.log(lang + ': added ' + added + ' keys');
}
