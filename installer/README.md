# Установщик Undefined Client

Исходники Windows-установщика лаунчера. Отдельный «витринный» репозиторий с тем же описанием:  
[studioberry-hub/client-installer](https://github.com/studioberry-hub/client-installer).

> [!NOTE]
> Код живёт здесь, в [`installer/`](.) репозитория [client](https://github.com/studioberry-hub/client).  
> Репозиторий `client-installer` дублирует этот README и ссылается на исходники.

---

## Что это

Небольшой GUI-установщик на **Python + Tkinter + Pillow**:

| Артефакт | Точка входа | Назначение |
|---|---|---|
| `UClientInstaller.exe` | `installer.py` | Первая установка / переустановка |
| `updater.exe` | `updater.py` → `--mode updater` | Проверка и установка обновлений |
| `unins000.exe` | `unins000.py` → `--mode uninstall` | Удаление из «Приложений и возможностей» |

`updater.py` и `unins000.py` — тонкие обёртки: подставляют `--mode` и вызывают `installer.main()`.

---

## Как работает

```text
GitHub Releases (studioberry-hub/client)
        │  latest → asset latest-windows-amd64.zip
        ▼
   UClientInstaller / updater
        │  скачать → распаковать → ярлыки → реестр → uclient://
        ▼
%APPDATA%\UndefinedClientApp\
   ├── uclient.exe
   ├── updater.exe
   ├── unins000.exe
   └── version.txt
```

1. **Релиз** — запрос к `GET /repos/studioberry-hub/client/releases/latest`, ищется ассет `latest-windows-amd64.zip` (иначе любой `.zip`).
2. **Загрузка** — во временный файл с прогрессом (скорость со сглаживанием).
3. **Распаковка** — в `%APPDATA%\UndefinedClientApp` (per-user, **без прав администратора**).
4. **Метаданные** — `version.txt`, ключ Uninstall в `HKCU`, App Paths для `uclient.exe`.
5. **Ярлыки** — Рабочий стол и меню «Пуск».
6. **Протокол** — регистрация схемы `uclient://` в `HKCU\Software\Classes\uclient` (deep link с сайта).

Обновление (`updater`): сравнивает установленную версию с тегом latest; если новее — ставит поверх.  
Удаление (`unins000`): снимает ярлыки, ключи реестра, схему URL и каталог установки.

Все записи реестра — только **HKEY_CURRENT_USER**, чтобы не смешивать per-user установку с HKLM.

---

## Режимы запуска

```bash
python installer/installer.py                  # установка
python installer/installer.py --mode updater   # обновление
python installer/installer.py --mode uninstall # удаление
python installer/installer.py --mode preview --preview-as install
```

Полезные флаги:

| Флаг | Описание |
|---|---|
| `--owner` / `--repo` | GitHub owner/repo релизов (по умолчанию `studioberry-hub` / `client`) |
| `--dir` | Каталог установки (по умолчанию `%APPDATA%\UndefinedClientApp`) |
| `--mode` | `install` · `updater` · `uninstall` · `preview` |
| `--preview-as` | Внешний вид окна в режиме `preview` |
| `--uninstall` | Синоним `--mode uninstall` |

---

## Зависимости

См. [`requirements.txt`](requirements.txt).

```bash
python -m pip install -r installer/requirements.txt
```

Системно нужны: **Windows 10/11**, Python 3.11+, Tkinter (обычно идёт с официальным установщиком Python).

---

## Сборка exe

Из корня репозитория `client`:

```bat
build_installers.cmd
```

Скрипт ставит PyInstaller/Pillow при необходимости и собирает onefile:

- `dist\UClientInstaller.exe`
- `dist\updater.exe`
- `dist\unins000.exe`

В бандл кладутся `installer\assets` и шрифты Nekst из `assets\fonts\nekst`.

> [!IMPORTANT]
> `updater.exe` и `unins000.exe` нужно класть **внутрь** релизного zip клиента (`latest-windows-amd64.zip`), чтобы обновление и удаление работали у пользователя.

---

## Структура каталога

```text
installer/
├── README.md           ← этот файл
├── requirements.txt    ← pip-зависимости
├── installer.py        ← ядро (UI, download, registry, shortcuts)
├── updater.py          ← обёртка --mode updater
├── unins000.py         ← обёртка --mode uninstall
└── assets/
    ├── logo.png
    └── close.svg
```

Сборка описана в корневом [`build_installers.cmd`](../build_installers.cmd).

---

## Связанные репозитории

| Репозиторий | Роль |
|---|---|
| [studioberry-hub/client](https://github.com/studioberry-hub/client) | Лаунчер + **исходники установщика** (`installer/`) |
| [studioberry-hub/client-installer](https://github.com/studioberry-hub/client-installer) | Витрина установщика, дублирует этот README |

В корне `client` есть папка-ссылка [`client-installer/`](../client-installer/), которая ведёт на отдельный репозиторий.
