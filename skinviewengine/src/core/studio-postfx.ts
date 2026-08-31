// Постпроцессинг: SSAA (высокий RT) + лёгкий bloom; без размытия текселей скина
import {
  HalfFloatType,
  LinearFilter,
  Vector2,
  WebGLRenderTarget,
  type Camera,
  type Scene,
  type WebGLRenderer,
} from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

const BLOOM_BASE = 0.045;
const BLOOM_RADIUS = 0.5;
const BLOOM_THRESHOLD = 0.9;

/**
 * Рендер-путь продукта:
 * 1) сцена в высокий RT (pixelRatio ≥ 2 — суперсэмплинг силуэта);
 * 2) лёгкий bloom;
 * 3) OutputPass.
 *
 * Soft-downsample / box-blur НЕ используем: усреднение соседей по кадру
 * смешивает соседние тексели Minecraft-скина → грязь и ложные оттенки.
 * MSAA на RT с NearestFilter тоже не используем (кайма по UV).
 * HalfFloat — меньше banding в тёмных midtones.
 */
export class StudioPostFx {
  private readonly _composer: EffectComposer;
  private readonly _bloom: UnrealBloomPass;
  private readonly _size = new Vector2(1, 1);

  constructor(renderer: WebGLRenderer, scene: Scene, camera: Camera) {
    const size = renderer.getSize(new Vector2());
    const cssW = Math.max(1, Math.floor(size.width));
    const cssH = Math.max(1, Math.floor(size.height));
    const pixelRatio = renderer.getPixelRatio();

    const renderTarget = new WebGLRenderTarget(cssW, cssH, {
      type: HalfFloatType,
      samples: 0,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
    });
    renderTarget.texture.name = "StudioPostFx.rt";

    this._composer = new EffectComposer(renderer, renderTarget);
    this._composer.setPixelRatio(pixelRatio);
    this._composer.setSize(cssW, cssH);

    this._composer.addPass(new RenderPass(scene, camera));

    this._bloom = new UnrealBloomPass(
      new Vector2(cssW, cssH),
      BLOOM_BASE,
      BLOOM_RADIUS,
      BLOOM_THRESHOLD,
    );
    this._bloom.enabled = BLOOM_BASE > 0;
    this._composer.addPass(this._bloom);
    this._composer.addPass(new OutputPass());

    this._size.set(cssW, cssH);
  }

  setSize(width: number, height: number): void {
    const cssW = Math.max(1, Math.floor(width));
    const cssH = Math.max(1, Math.floor(height));
    this._size.set(cssW, cssH);
    this._composer.setSize(cssW, cssH);
    this._bloom.resolution.set(cssW, cssH);
  }

  setPixelRatio(ratio: number): void {
    this._composer.setPixelRatio(ratio);
  }

  setBloomBoost(amount: number): void {
    const t = Math.max(0, Math.min(1, amount));
    this._bloom.strength = BLOOM_BASE + t * 0.35;
    this._bloom.enabled = this._bloom.strength > 0.001;
  }

  setBloomStrength(strength: number): void {
    this._bloom.strength = Math.max(0, strength);
    this._bloom.enabled = this._bloom.strength > 0.001;
  }

  resetBloomStrength(): void {
    this._bloom.strength = BLOOM_BASE;
    this._bloom.enabled = BLOOM_BASE > 0;
  }

  render(): void {
    this._composer.render();
  }

  dispose(): void {
    this._composer.dispose();
  }
}
