# skinviewengine

Собственный WebGL2-движок для рендеринга Minecraft-скинов: анимации, позирование, расширяемая архитектура.

> Отдельный подпроект внутри `uclient`. Не зависит от Electron-лаунчера.

## Структура

```
src/
  core/       — рендерер, камера, игровой цикл
  skin/       — загрузка текстур, модель (classic/slim), UV
  animation/  — idle, walk, pose
  math/       — минимальные vec/mat-хелперы
examples/demo/ — минимальная HTML-страница с canvas
```

## Быстрый старт

```bash
cd skinviewengine
npm install
npm run dev      # демо в браузере (Vite, порт 5174)
npm run build    # сборка библиотеки (dist/) + демо
```

## Публичный API

```ts
import { SkinViewEngine } from "skinviewengine";

const engine = new SkinViewEngine(canvas);
engine.start();

// URL, файл (blob/data) или Image/Canvas
await engine.setSkin("https://example.com/skin.png");

// По никнейму Minecraft (mc-heads.net → mineskin.eu)
await engine.setSkinByUsername("Notch");
```

Демо: поле «Никнейм» → «Загрузить по нику». Загрузка по URL и из PNG-файла работает как раньше.

## Следующие шаги разработки

1. Реализовать шейдеры и меш персонажа в `core/renderer.ts`
2. Подключить загрузку PNG-скина и UV-разметку в `skin/`
3. Добавить скелетную анимацию в `animation/`
4. Интегрировать движок в uclient (отдельная задача)
