const fs = require('fs');
const mapping = {
  "builds.groupCount": { en: "{{n}} builds", ru: "{{n}} сборок", uk: "{{n}} збірок", kk: "{{n}} жинақ", tt: "{{n}} җыентык", kbd: "{{n}} зэхуэхьэса" },
  "news.launcherTitle": { en: "Launcher News", ru: "Новости лаунчера", uk: "Новини лаунчера", kk: "Лаунчер жаңалықтары", tt: "Лаунчер яңалыклары", kbd: "Лаунчерым и хъыбархэр" },
  "news.clanDesc": { en: "Clan Description", ru: "Описание клана", uk: "Опис клану", kk: "Клан сипаттамасы", tt: "Клан тасвирламасы", kbd: "Кланым и тепсэлъыхьыгъуэ" },
  "news.clanExplain": { en: "A clan allows you to post on its behalf.", ru: "Клан позволяет публиковать посты от его имени.", uk: "Клан дозволяє публікувати пости від його імені.", kk: "Клан оның атынан пост жариялауға мүмкіндік береді.", tt: "Клан аның исеменнән постлар чыгарырга мөмкинлек бирә.", kbd: "Кланым и цIэкIэ постхэр къыдэбгъэкI хъунущ." },
  "news.clanIcon": { en: "Clan Icon", ru: "Иконка клана", uk: "Іконка клану", kk: "Клан белгішесі", tt: "Клан иконкасы", kbd: "Кланым и иконкэ" },
  "news.clanIconHint": { en: "Upload an icon", ru: "Загрузите иконку", uk: "Завантажте іконку", kk: "Белгішені жүктеңіз", tt: "Иконканы йөкләгез", kbd: "Иконкэ къегъэхь" },
  "news.clanName": { en: "Clan Name", ru: "Имя клана", uk: "Ім'я клану", kk: "Клан аты", tt: "Клан исеме", kbd: "Кланым и цIэ" },
  "news.clanNameRequired": { en: "Clan name is required", ru: "Имя клана обязательно", uk: "Ім'я клану обов'язкове", kk: "Клан аты міндетті", tt: "Клан исеме мәҗбүри", kbd: "Кланым и цIэр хуэщIын хуейщ" },
  "news.clanSub": { en: "Create a new clan", ru: "Создать новый клан", uk: "Створити новий клан", kk: "Жаңа клан құру", tt: "Яңа клан төзү", kbd: "КланщIэ къызэгъэпэщын" },
  "news.commentDeleted": { en: "Comment deleted", ru: "Комментарий удален", uk: "Коментар видалено", kk: "Пікір жойылды", tt: "Комментарий бетерелде", kbd: "Комментарийр ихыжын" },
  "news.commentEmpty": { en: "Comment cannot be empty", ru: "Комментарий не может быть пустым", uk: "Коментар не може бути порожнім", kk: "Пікір бос болмауы керек", tt: "Комментарий буш була алмый", kbd: "Комментарийр нэщI хъунукъым" },
  "news.commentPlaceholder": { en: "Write a comment...", ru: "Написать комментарий...", uk: "Написати коментар...", kk: "Пікір жазу...", tt: "Комментарий язу...", kbd: "Комментарий тхын..." },
  "news.comments": { en: "Comments", ru: "Комментарии", uk: "Коментарі", kk: "Пікірлер", tt: "Комментарийләр", kbd: "Комментарийхэр" },
  "news.composerPlaceholder": { en: "What's new? Markdown supported", ru: "Что нового? Поддерживается Markdown", uk: "Що нового? Підтримується Markdown", kk: "Не жаңалық? Markdown қолданылады", tt: "Нәрсә яңалык? Markdown ярдәм итә", kbd: "Сыт щIэуэ щыIэр? Markdown-р къагъэщхьэпэ" },
  "news.deleteComment": { en: "Delete comment", ru: "Удалить комментарий", uk: "Видалити коментар", kk: "Пікірді жою", tt: "Комментарийне бетерү", kbd: "Комментарийр ихыжын" },
  "news.deleteCommentConfirm": { en: "Are you sure you want to delete this comment?", ru: "Вы уверены, что хотите удалить этот комментарий?", uk: "Ви впевнені, що хочете видалити цей коментар?", kk: "Бұл пікірді жойғыңыз келетініне сенімдісіз бе?", tt: "Сез бу комментарийне бетерергә телисезме?", kbd: "Мы комментарийр ихыжыну ухуей?" },
  "news.deleteConfirm": { en: "Are you sure?", ru: "Вы уверены?", uk: "Ви впевнені?", kk: "Сенімдісіз бе?", tt: "Сез ышанасызмы?", kbd: "Уи фIэщ хъурэ?" },
  "news.deletePost": { en: "Delete post", ru: "Удалить пост", uk: "Видалити пост", kk: "Постты жою", tt: "Постны бетерү", kbd: "Постыр ихыжын" },
  "news.deleted": { en: "Deleted", ru: "Удалено", uk: "Видалено", kk: "Жойылды", tt: "Бетерелгән", kbd: "Ихыжащ" },
  "news.feedEmpty": { en: "Feed is empty", ru: "Лента пуста", uk: "Стрічка порожня", kk: "Таспа бос", tt: "Тасма буш", kbd: "Лентэр нэщIщ" },
  "news.noComments": { en: "No comments yet", ru: "Пока нет комментариев", uk: "Поки немає коментарів", kk: "Әзірге пікірлер жоқ", tt: "Әлегә комментарийләр юк", kbd: "Иджыри комментарийхэр щыIэкъым" },
  "news.notificationsSoon": { en: "Notifications (coming soon)", ru: "Уведомления (скоро)", uk: "Сповіщення (скоро)", kk: "Хабарландырулар (жақында)", tt: "Белдерүләр (тиздән)", kbd: "Хабархэр (куэд мыщIэу)" },
  "news.reply": { en: "Reply", ru: "Ответить", uk: "Відповісти", kk: "Жауап беру", tt: "Җавап бирү", kbd: "Жэуап етын" },
  "news.replyPlaceholder": { en: "Write a reply...", ru: "Написать ответ...", uk: "Написати відповідь...", kk: "Жауап жазу...", tt: "Җавап язу...", kbd: "Жэуап тхын..." },
  "news.replyTo": { en: "Reply to", ru: "Ответ", uk: "Відповідь", kk: "Жауап", tt: "Җавап", kbd: "Жэуап" },
  "news.repostChats": { en: "To chats", ru: "В чаты", uk: "У чати", kk: "Чаттарға", tt: "Чатларга", kbd: "Чатхэм" },
  "news.repostComment": { en: "Comment", ru: "Комментарий", uk: "Коментар", kk: "Пікір", tt: "Комментарий", kbd: "Комментарий" },
  "news.repostCommentPh": { en: "Add a comment...", ru: "Добавьте комментарий...", uk: "Додайте коментар...", kk: "Пікір қосыңыз...", tt: "Комментарий өстәгез...", kbd: "Комментарий хэлъхьэ..." },
  "news.repostNoChats": { en: "No chats available", ru: "Нет доступных чатов", uk: "Немає доступних чатів", kk: "Қолжетімді чаттар жоқ", tt: "Мөмкин булган чатлар юк", kbd: "Чатхэр щыIэкъым" },
  "news.repostPick": { en: "Pick a destination", ru: "Выберите место", uk: "Виберіть місце", kk: "Орынды таңдаңыз", tt: "Урынны сайлагыз", kbd: "Здэпщынур къыхэх" },
  "news.repostSend": { en: "Send", ru: "Отправить", uk: "Надіслати", kk: "Жіберу", tt: "Җибәрү", kbd: "Егъэхьын" },
  "news.repostSub": { en: "Share with friends", ru: "Поделиться с друзьями", uk: "Поділитися з друзями", kk: "Достармен бөлісу", tt: "Дусслар белән уртаклашу", kbd: "Ныбжьэгъухэм ептын" },
  "news.repostTitle": { en: "Share", ru: "Поделиться", uk: "Поділитися", kk: "Бөлісу", tt: "Уртаклашу", kbd: "Ептын" },
  "news.repostWall": { en: "To wall", ru: "На стену", uk: "На стіну", kk: "Қабырғаға", tt: "Стенага", kbd: "Стенэм" },
  "news.repostedWall": { en: "Reposted to wall", ru: "Репост на стену", uk: "Репост на стіну", kk: "Қабырғаға репост жасалды", tt: "Стенага репост ясалды", kbd: "Стенэм репост хуэщIащ" }
};

const locales = ['en', 'ru', 'uk', 'kk', 'tt', 'kbd'];

for (const loc of locales) {
  const path = 'src/renderer/locales/' + loc + '.json';
  let raw = fs.readFileSync(path, 'utf8');
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
  let data = JSON.parse(raw);
  for (const k of Object.keys(mapping)) {
    data[k] = mapping[k][loc] || mapping[k]['ru'];
  }
  
  const oldNews = {
    "news.title": { en: "Latest news", ru: "Последние новости", uk: "Останні новини", kk: "Соңғы жаңалықтар", tt: "Соңгы яңалыклар", kbd: "Иужьрей хъыбархэр" },
    "news.all": { en: "View all news", ru: "Все новости", uk: "Всі новини", kk: "Барлық жаңалықтар", tt: "Барлык яңалыклар", kbd: "Хъыбархэр псори" },
    "news.subtitle": { en: "Launcher updates and important announcements", ru: "Обновления лаунчера и важные объявления", uk: "Оновлення лаунчера та важливі оголошення", kk: "Лаунчер жаңартулары және маңызды хабарландырулар", tt: "Лаунчер яңартулары һәм мөһим игъланнар", kbd: "Лаунчерым и щIэ хъыбархэр" },
    "news.loading": { en: "Loading news...", ru: "Загрузка новостей...", uk: "Завантаження новин...", kk: "Жаңалықтарды жүктеу...", tt: "Яңалыклар йөкләү...", kbd: "Хъыбархэр къегъэхь..." },
    "news.empty": { en: "No published news yet", ru: "Пока нет опубликованных новостей", uk: "Поки немає опублікованих новин", kk: "Әзірге жарияланған жаңалықтар жоқ", tt: "Әлегә бастырылган яңалыклар юк", kbd: "Иджыри хъыбархэр къыдэкIакъым" },
    "news.error": { en: "Failed to load news", ru: "Не удалось загрузить новости", uk: "Не вдалося завантажити новини", kk: "Жаңалықтарды жүктеу сәтсіз аяқталды", tt: "Яңалыкларны йөкләп булмады", kbd: "Хъыбархэр къегъэхьакъым" },
    "news.refresh": { en: "Refresh", ru: "Обновить", uk: "Оновити", kk: "Жаңарту", tt: "Яңарту", kbd: "ЩIэгъэщIэн" },
    "news.openOnSite": { en: "Open on website", ru: "Открыть на сайте", uk: "Відкрити на сайті", kk: "Сайтта ашу", tt: "Сайтта ачу", kbd: "Сайтым зэIухын" },
    "news.openPost": { en: "Open post", ru: "Открыть пост", uk: "Відкрити пост", kk: "Постты ашу", tt: "Постны ачу", kbd: "Постыр зэIухын" },
    "news.notFound": { en: "News post not found", ru: "Новость не найдена", uk: "Новину не знайдено", kk: "Жаңалық табылмады", tt: "Яңалык табылмады", kbd: "Хъыбарыр къэгъуэтакъым" },
    "news.postedOn": { en: "Published on", ru: "Опубликовано", uk: "Опубліковано", kk: "Жарияланды", tt: "Бастырылган", kbd: "КъыдэкIащ" },
    "news.featuredLabel": { en: "Featured article", ru: "Главная статья", uk: "Головна стаття", kk: "Басты мақала", tt: "Төп мәкалә", kbd: "Тхыгъэ нэхъыщхьэ" },
    "news.moreArticles": { en: "More articles", ru: "Другие статьи", uk: "Інші статті", kk: "Басқа мақалалар", tt: "Башка мәкаләләр", kbd: "НэгъуэщI тхыгъэхэр" },
    "news.wall": { en: "News Wall", ru: "Новостная лента", uk: "Стрічка новин", kk: "Жаңалықтар таспасы", tt: "Яңалыклар тасмасы", kbd: "Хъыбар лентэ" },
    "news.feedCommunity": { en: "Community", ru: "Сообщество", uk: "Спільнота", kk: "Қауымдастық", tt: "Җәмгыять", kbd: "Зэгухьэныгъэ" },
    "news.clientNews": { en: "Client News", ru: "Новости клиента", uk: "Новини клієнта", kk: "Клиент жаңалықтары", tt: "Клиент яңалыклары", kbd: "Клиентым и хъыбархэр" },
    "news.newPost": { en: "New Post", ru: "Новый пост", uk: "Новий пост", kk: "Жаңа пост", tt: "Яңа пост", kbd: "ПостщIэ" },
    "news.newPostSub": { en: "Share something with the community", ru: "Поделитесь чем-то с сообществом", uk: "Поділіться чимось зі спільнотою", kk: "Қауымдастықпен бірдеңе бөлісіңіз", tt: "Җәмгыять белән берәр нәрсә уртаклашыгыз", kbd: "Зэгухьэныгъэм гуэрхэр гуэщ" },
    "news.postAs": { en: "Post as", ru: "От имени", uk: "Від імені", kk: "Атынан", tt: "Исеменнән", kbd: "И цIэкIэ" },
    "news.postAsSelf": { en: "Personal Account", ru: "Личный аккаунт", uk: "Особистий акаунт", kk: "Жеке аккаунт", tt: "Шәхси аккаунт", kbd: "Уи аккаунт" },
    "news.clanHint": { en: "Or as a clan (coming soon)", ru: "Или от имени клана (скоро)", uk: "Або від імені клану (скоро)", kk: "Немесе клан атынан (жақында)", tt: "Яисә клан исеменнән (тиздән)", kbd: "Е кланым и цIэкIэ (куэд мыщIэу)" },
    "news.photo": { en: "Attach", ru: "Прикрепить", uk: "Прикріпити", kk: "Тіркеу", tt: "Беркетергә", kbd: "Хэлъхьэн" },
    "news.createClan": { en: "Create Clan", ru: "Создать клан", uk: "Створити клан", kk: "Клан құру", tt: "Клан төзү", kbd: "КланщIэ къызэгъэпэщын" },
    "news.publish": { en: "Publish", ru: "Опубликовать", uk: "Опублікувати", kk: "Жариялау", tt: "Бастыру", kbd: "КъыдэгъэкIын" }
  };
  
  for (const k of Object.keys(oldNews)) {
    data[k] = oldNews[k][loc] || oldNews[k]['ru'];
  }
  
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}
console.log('Translated successfully!');
