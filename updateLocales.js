const fs = require('fs');
const path = require('path');

const locales = {
  'en.json': {
    "builds.addGroup": "Create group",
    "builds.editGroup": "Manage",
    "builds.groupCreateTitle": "New group",
    "builds.groupEditTitle": "Manage group",
    "builds.groupCreateSub": "Name, icon and list of builds",
    "builds.groupName": "Group name",
    "builds.groupIcon": "Icon",
    "builds.groupIconUpload": "Upload custom",
    "builds.groupMembers": "Builds in group",
    "builds.groupDelete": "Delete group",
    "builds.groupEmpty": "No builds in this group yet"
  },
  'ru.json': {
    "builds.addGroup": "Создать группу",
    "builds.editGroup": "Управление",
    "builds.groupCreateTitle": "Новая группа",
    "builds.groupEditTitle": "Управление группой",
    "builds.groupCreateSub": "Название, иконка и список сборок",
    "builds.groupName": "Название группы",
    "builds.groupIcon": "Иконка",
    "builds.groupIconUpload": "Загрузить свою",
    "builds.groupMembers": "Сборки в группе",
    "builds.groupDelete": "Удалить группу",
    "builds.groupEmpty": "В этой группе пока нет сборок"
  },
  'uk.json': {
    "builds.addGroup": "Створити групу",
    "builds.editGroup": "Керування",
    "builds.groupCreateTitle": "Нова група",
    "builds.groupEditTitle": "Керування групою",
    "builds.groupCreateSub": "Назва, іконка та список збірок",
    "builds.groupName": "Назва групи",
    "builds.groupIcon": "Іконка",
    "builds.groupIconUpload": "Завантажити свою",
    "builds.groupMembers": "Збірки в групі",
    "builds.groupDelete": "Видалити групу",
    "builds.groupEmpty": "У цій групі поки немає збірок"
  },
  'kk.json': {
    "builds.addGroup": "Топ құру",
    "builds.editGroup": "Басқару",
    "builds.groupCreateTitle": "Жаңа топ",
    "builds.groupEditTitle": "Топты басқару",
    "builds.groupCreateSub": "Атауы, белгішесі және жинақтар тізімі",
    "builds.groupName": "Топ атауы",
    "builds.groupIcon": "Белгіше",
    "builds.groupIconUpload": "Өзіңіздікін жүктеңіз",
    "builds.groupMembers": "Топтағы жинақтар",
    "builds.groupDelete": "Топты жою",
    "builds.groupEmpty": "Бұл топта әзірге жинақтар жоқ"
  },
  'tt.json': {
    "builds.addGroup": "Төркем төзү",
    "builds.editGroup": "Идарә итү",
    "builds.groupCreateTitle": "Яңа төркем",
    "builds.groupEditTitle": "Төркем белән идарә итү",
    "builds.groupCreateSub": "Исем, икона һәм җыелмалар исемлеге",
    "builds.groupName": "Төркем исеме",
    "builds.groupIcon": "Икона",
    "builds.groupIconUpload": "Үзегезнекен йөкләгез",
    "builds.groupMembers": "Төркемдәге җыелмалар",
    "builds.groupDelete": "Төркемне бетерү",
    "builds.groupEmpty": "Бу төркемдә әлегә җыелмалар юк"
  },
  'kbd.json': {
    "builds.addGroup": "Создать группу",
    "builds.editGroup": "Управление",
    "builds.groupCreateTitle": "Новая группа",
    "builds.groupEditTitle": "Управление группой",
    "builds.groupCreateSub": "Название, иконка и список сборок",
    "builds.groupName": "Название группы",
    "builds.groupIcon": "Иконка",
    "builds.groupIconUpload": "Загрузить свою",
    "builds.groupMembers": "Сборки в группе",
    "builds.groupDelete": "Удалить группу",
    "builds.groupEmpty": "В этой группе пока нет сборок"
  }
};

const dir = 'src/renderer/locales';

for (const [file, strings] of Object.entries(locales)) {
  const p = path.join(dir, file);
  if (fs.existsSync(p)) {
    let json = JSON.parse(fs.readFileSync(p, 'utf8'));
    
    // add strings after builds.groupCount
    let newJson = {};
    for (const key in json) {
      newJson[key] = json[key];
      if (key === 'builds.groupCount') {
        for (const [newKey, newVal] of Object.entries(strings)) {
          newJson[newKey] = newVal;
        }
      }
    }
    
    // fallback if builds.groupCount wasn't found
    for (const [newKey, newVal] of Object.entries(strings)) {
      if (!newJson[newKey]) newJson[newKey] = newVal;
    }
    
    fs.writeFileSync(p, JSON.stringify(newJson, null, 2), 'utf8');
    console.log(`Updated ${file}`);
  }
}
