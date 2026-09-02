# CHANGELOG v1.0.7-beta — UAgent по аккаунту и умнее контекст

*2 сентября 2026*

## Новое

- Доступ к UAgent по аккаунту Microsoft / Ely.by (вместо ключей `uag_*`)
- Заявка на доступ через бота Undefined Studio в чатах (кнопки меню / callback)
- Модалка «нет доступа» с переходом «Подать заявку» в DM бота
- Публичное имя модели в UI: Kolibra Pixi 1.0 (pill + карточка)
- Tool `find_mod_in_build` — проверка мода в сборке до предложения установки

## Улучшения

- Контекст UAgent: активная сборка (id, MC, loader), смена чипа пишет явную метку в историю
- Java: пустой `javaPath` трактуется как auto / effectivePath (как при запуске лаунчера)
- `get_build` / `diagnose_build` / `validate_java_for_build` / `recommend_java_for_build` отдают режим Java и effective path
- Повторная `install_mod` по уже установленному projectId блокируется с `alreadyInstalled`
- Бот проекта выше обычных чатов в списке; клавиатура `bot_keyboard` в ленте
- Полировка UI агента (rail, empty state, стили)

## Исправления

- Убраны UI и IPC ключей тестировщика (`ai:validateKey`, `X-UAgent-Key`)
- Агент меньше «теряет» выбранную сборку и не путает её с другой из истории
- Агент не сообщает «Java не настроена», если лаунчер уже подставит managed runtime
