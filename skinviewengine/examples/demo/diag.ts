// Временная диагностическая страница: фиксированный кадр без idle-анимации для сравнения до/после
import { SkinViewEngine, SkinModelType } from "../../src/index.ts";
import demoSkinUrl from "./assets/target-skin.png";

const canvas = document.getElementById("skin-canvas") as HTMLCanvasElement;

const engine = new SkinViewEngine(canvas, {
  modelType: SkinModelType.Classic,
  autoDetectModel: true,
  idleAnimation: false,
  autoResize: false,
  enableControls: false,
});

engine.setSize(700, 1000);

(window as unknown as Record<string, unknown>).engine = engine;

void engine.setSkin(demoSkinUrl).then(() => {
  engine.renderFrame();
  (window as unknown as Record<string, unknown>).diagReady = true;
});
