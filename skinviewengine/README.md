![Mine3D Embedded](https://raw.githubusercontent.com/studioberry-hub/mine3d-embedded/refs/heads/main/.github/assets/logo.png)

---

# Mine3D Embedded

> Отдельный подпроект внутри `uclient`. Не зависит от Electron-лаунчера, является внутренней веткой Mine3D Embedded.

> [!NOTE]
> Основной репозиторий и основная ветка проекта находятся в [studioberry-hub -> mine3d-embedded](https://github.com/studioberry-hub/mine3d-embedded)

WebGL-движок для 3D-рендера Minecraft-скинов: студийный свет, outer-voxels, анимации, кадрирование камеры и отладочная телеметрия.

Используется в [Undefined Client](https://uprojects.site/client); этот репозиторий — отдельная библиотека для интеграции в любые веб- и Electron-проекты, а также в проекты реализованные через Rust, Go и прочее.

**Версия:** `0.2.0` · **Лицензия:** MIT

## Возможности

- Загрузка скина из URL, PNG-файла, `Image`/`Canvas` или по нику Minecraft (CDN)
- Classic / Slim с автоопределением модели
- Плащ (cape), presentation `full` / `bust`
- Анимации и shot-пресеты кадра
- OrbitControls, cursor-follow, автовращение, `fitPlayerToFrame`
- Bloom + SMAA (PostFX), контактные тени, атмосфера
- Debug API: оверлеи и `getDebugStats()`



## Установка

`three` — peer dependency (установите в своём проекте).

```bash
# из GitHub (после публикации репозитория)
npm install three@^0.156.1
npm install github:undefined-studio/mine3d-embedded

# или локально
npm install three@^0.156.1
npm install /path/to/mine3d-embedded
```

После клона репозитория библиотеки:

```bash
cd mine3d-embedded
npm install
npm run build:lib   # → dist/
```



## Быстрый старт

```ts
import { SkinViewEngine, createSkinAnimation } from "mine3d-embedded";

const canvas = document.querySelector("canvas")!;
const engine = new SkinViewEngine(canvas, {
  idleAnimation: true,
  enableControls: true,
  autoDetectModel: true,
});

engine.start();
await engine.setSkinByUsername("Steve");
engine.fitPlayerToFrame({ fillY: 0.72, offsetY: 0 });

engine.setAnimation(createSkinAnimation("wave"));

// при размонтировании
engine.dispose();
```



## Примеры


| Команда             | Описание                           |
| ------------------- | ---------------------------------- |
| `npm run dev`       | Playground (порт 5174) — полный UI |
| `npm run dev:basic` | Минимальный пример (порт 5175)     |




## Документация

- [Быстрый старт](docs/getting-started.md)
- [Интеграция](docs/integration.md)
- [API: SkinViewEngine](docs/api/engine.md)
- [API: опции и типы](docs/api/options.md)
- [API: анимации](docs/api/animations.md)
- [Отладка](docs/debug.md)
- [Архитектура](docs/architecture.md)
- [Troubleshooting](docs/troubleshooting.md)



## Публичный API (кратко)

```ts
import {
  SkinViewEngine,
  SkinModelType,
  createSkinAnimation,
  ENGINE_VERSION,
  ENGINE_DISPLAY_NAME,
  DEFAULT_CAMERA_SETTINGS,
  DEFAULT_LIGHT_SETTINGS,
  DEFAULT_SKIN_DEBUG_OPTIONS,
} from "mine3d-embedded";
```

Главный класс — `SkinViewEngine`. Имена методов стабильны; менять их без major-версии не планируется.

## Скрипты

```bash
npm run build:lib  # только библиотека (tsc → dist/)
npm run build      # библиотека + сборка playground
npm run typecheck  # проверка типов без emit
npm run dev        # playground
```
