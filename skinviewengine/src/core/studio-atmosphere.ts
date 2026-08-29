// Студийный фон вкладки скинов: сплошной серый как на референсе превью
import { Color, Group } from "three";

/** Цвет фона ≈ #2A2A2A (как на референсе / --bg-content) */
export const STUDIO_CLEAR_COLOR = new Color(0x2a2a2a);

/**
 * Сплошной Color-фон — без banding и без «грязи» низкоресного canvas.
 */
export class StudioAtmosphere {
  readonly group = new Group();
  /** Сплошной фон для scene.background */
  readonly backgroundColor = STUDIO_CLEAR_COLOR.clone();

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  update(_delta: number): void {
    // Сплошной цвет — анимация не нужна
  }

  dispose(): void {
    // нечего освобождать
  }
}
