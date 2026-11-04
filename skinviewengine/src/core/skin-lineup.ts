// Ряд персонажей в одной сцене Mine3D: тот же рендер, что у вкладки скинов.
import { PlayerObject } from "skin3d";
import { inferModelType, isTextureSource, loadSkinToCanvas } from "skinview-utils";
import {
  CanvasTexture,
  Clock,
  Color,
  ColorManagement,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  SpotLight,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Texture,
} from "three";
import { loadSkinImage } from "./skin-image.js";
import { configureSkinCanvasTexture, sanitizeSkinCanvas } from "./skin-texture.js";
import { applySkinUVInsets } from "./skin-uv-inset.js";
import { applyStockLegPose } from "./skin-leg-stock.js";
import { OuterVoxelLayers } from "./skin-outer-voxel.js";
import { StudioAtmosphere } from "./studio-atmosphere.js";
import { StudioPostFx } from "./studio-postfx.js";
import {
  FLOOR_Y,
  configureProductRenderer,
  createFloorAndContactShadow,
  enableShadows,
  normalizeSkinDepthBias,
  setupProductLighting,
  setupSceneEnvironment,
  tuneSkinMaterials,
} from "./product-visuals.js";
import {
  animationControlsLegs,
  applyPose,
  blendPoses,
  capturePose,
  resetLimbPose,
  type PoseSnapshot,
  type SkinAnimation,
} from "./skin-animations.js";
import type { SkinSource } from "../types.js";

const MAX_PIXEL_RATIO = 3;
const MIN_PRODUCT_PIXEL_RATIO = 2;
const BLEND_DURATION = 0.22;

/** Камера стоит на месте и смотрит строго вперёд, на уровне глаз. */
const EYE_Y = 1;
const CAMERA_Z = 220;

export class LineupActor {
  readonly wrapper = new Group();
  readonly player = new PlayerObject();
  readonly voxels = new OuterVoxelLayers();
  readonly skinCanvas = document.createElement("canvas");

  animation: SkinAnimation | null = null;
  private blendFrom: PoseSnapshot | null = null;
  private blendElapsed = 0;
  private shade = -1;
  skinTexture: CanvasTexture | null = null;

  constructor() {
    this.player.name = "player";
    this.player.cape.visible = false;
    this.player.elytra.visible = false;
    this.player.ears.visible = false;
    this.wrapper.add(this.player);
  }

  setAnimation(animation: SkinAnimation | null): void {
    if (this.animation === animation) return;
    this.blendFrom = capturePose(this.player);
    this.blendElapsed = 0;
    this.animation = animation;
    if (animation) animation.progress = 0;
  }

  /** После смены текстуры цвет материала сбрасывается в белый. */
  invalidateShade(): void {
    this.shade = -1;
  }

  /** Вспышка как при смене скина: белый emissive на материалах. */
  setEmissive(intensity: number): void {
    this.player.traverse((obj) => {
      if (!(obj instanceof Mesh)) return;
      const list = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const entry of list) {
        if (!(entry instanceof MeshStandardMaterial)) continue;
        entry.emissive.setRGB(intensity, intensity * 0.95, intensity * 0.8);
        entry.emissiveIntensity = intensity > 0 ? 1 : 0;
      }
    });
  }

  /** Выбранный остаётся в свете продукта, остальные темнеют. */
  setShade(shade: number): void {
    if (Math.abs(this.shade - shade) < 0.02) return;
    this.shade = shade;
    this.player.traverse((obj) => {
      if (!(obj instanceof Mesh)) return;
      const list = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const entry of list) {
        if (entry instanceof MeshStandardMaterial) entry.color.setScalar(shade);
      }
    });
  }

  /** Семпл позы — тот же порядок, что в SkinViewEngine. */
  sample(deltaTime: number): void {
    resetLimbPose(this.player);
    this.animation?.update(this.player, deltaTime);
    if (!animationControlsLegs(this.animation)) applyStockLegPose(this.player.skin);
    if (!this.blendFrom) return;
    const target = capturePose(this.player);
    this.blendElapsed += Math.max(deltaTime, 0);
    const t = this.blendElapsed / BLEND_DURATION;
    blendPoses(this.player, this.blendFrom, target, t);
    if (t >= 1) {
      this.blendFrom = null;
      applyPose(this.player, target);
    }
  }
}

export interface SkinLineupOptions {
  onFrame?: (delta: number) => void;
}

/**
 * Одна сцена Mine3D на несколько аккаунтов.
 * Свет, тонмаппинг, воксельный второй слой и постэффект совпадают с просмотром скинов.
 */
export class SkinLineup {
  readonly canvas: HTMLCanvasElement;
  readonly rig = new Group();

  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly renderer: WebGLRenderer;
  private readonly atmosphere = new StudioAtmosphere();
  private readonly postFx: StudioPostFx;
  private readonly clock = new Clock();
  private readonly actors: LineupActor[] = [];
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly feet = new Vector3();
  private readonly envMap: Texture;
  private readonly contactTemplate: Mesh;
  private readonly spot: SpotLight;
  private readonly pool: Mesh;
  private deck: Mesh | null = null;
  private focus: LineupActor | null = null;
  private raf = 0;
  private running = false;
  private disposed = false;
  private readonly onFrame?: (delta: number) => void;

  constructor(canvas: HTMLCanvasElement, options: SkinLineupOptions = {}) {
    this.canvas = canvas;
    this.onFrame = options.onFrame;
    ColorManagement.enabled = true;

    this.scene.add(this.atmosphere.group);
    // ACES гасит #161616 шапки до почти чёрного. 0x252525 после тонамаппинга совпадает с titlebar.
    this.scene.background = new Color(0x252525);
    const lighting = setupProductLighting(this.scene);
    const shadowCam = lighting.key.shadow.camera;
    shadowCam.left = -260;
    shadowCam.right = 260;
    shadowCam.top = 70;
    shadowCam.bottom = -70;
    shadowCam.far = 420;
    shadowCam.updateProjectionMatrix();

    const floor = createFloorAndContactShadow(this.scene);
    floor.contactShadow.visible = false;
    this.contactTemplate = floor.contactShadow;
    const deck = new Mesh(
      new PlaneGeometry(900, 900),
      new MeshStandardMaterial({ color: 0x2a2a2a, roughness: 1, metalness: 0 }),
    );
    deck.rotation.x = -Math.PI / 2;
    deck.position.y = FLOOR_Y;
    deck.receiveShadow = true;
    this.scene.add(deck);
    this.deck = deck;

    this.camera = new PerspectiveCamera(20, 1, 1, 500);
    this.camera.position.set(0, EYE_Y, CAMERA_Z);
    this.camera.lookAt(0, EYE_Y, 0);

    this.renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      premultipliedAlpha: false,
      powerPreference: "high-performance",
      logarithmicDepthBuffer: true,
    });
    const dpr = Math.min(MAX_PIXEL_RATIO, Math.max(window.devicePixelRatio || 1, MIN_PRODUCT_PIXEL_RATIO));
    this.renderer.setPixelRatio(dpr);
    this.renderer.sortObjects = true;
    configureProductRenderer(this.renderer);
    this.envMap = setupSceneEnvironment(this.scene, this.renderer);

    this.postFx = new StudioPostFx(this.renderer, this.scene, this.camera);
    this.postFx.setPixelRatio(dpr);

    // Конус сверху на выбранного. Пятно на полу — отдельный декаль: пол ловит только тень.
    this.spot = new SpotLight(0xfff4e2, 0, 120, 0.38, 0.35, 1);
    this.spot.position.set(0, 70, 0);
    this.scene.add(this.spot);
    this.scene.add(this.spot.target);
    this.pool = createLampPool();
    this.scene.add(this.pool);

    this.scene.add(this.rig);
    this.setSize(canvas.clientWidth || 300, canvas.clientHeight || 400);
  }

  addActor(): LineupActor {
    const actor = new LineupActor();
    applyStockLegPose(actor.player.skin);
    this.configureMeshes(actor);
    applySkinUVInsets(actor.player.skin);
    tuneSkinMaterials(actor.player.skin, this.envMap);
    enableShadows(actor.player.skin);
    const blob = this.contactTemplate.clone();
    blob.visible = true;
    blob.position.set(0, FLOOR_Y + 0.08, 0.5);
    actor.wrapper.add(blob);
    this.rig.add(actor.wrapper);
    this.actors.push(actor);
    return actor;
  }

  setFocus(actor: LineupActor | null): void {
    this.focus = actor;
  }

  /** Короткий подъём bloom на время вспышки выбора. */
  setBloomBoost(amount: number): void {
    this.postFx.setBloomBoost(amount);
  }

  setSize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.postFx.setSize(w, h);
  }

  async setSkin(actor: LineupActor, source: SkinSource): Promise<void> {
    if (this.disposed) return;
    const resolved = isTextureSource(source) ? source : await loadSkinImage(source);
    if (this.disposed) return;
    loadSkinToCanvas(actor.skinCanvas, resolved);
    sanitizeSkinCanvas(actor.skinCanvas);
    const inferred = inferModelType(actor.skinCanvas);
    actor.player.skin.modelType = inferred === "slim" ? "slim" : "default";
    actor.skinTexture?.dispose();
    const texture = new CanvasTexture(actor.skinCanvas);
    configureSkinCanvasTexture(texture);
    actor.skinTexture = texture;
    actor.player.skin.map = texture;
    applySkinUVInsets(actor.player.skin);
    tuneSkinMaterials(actor.player.skin, this.envMap, texture);
    this.configureMeshes(actor);
    actor.voxels.rebuild(actor.player.skin, actor.skinCanvas, inferred === "slim", texture, this.envMap);
    actor.voxels.restoreProductVisibility();
    enableShadows(actor.player.skin);
    actor.player.skin.visible = true;
    actor.invalidateShade();
  }

  projectSlot(actor: LineupActor): { x: number; y: number; visible: boolean } {
    actor.wrapper.getWorldPosition(this.feet);
    this.feet.y = FLOOR_Y;
    this.feet.project(this.camera);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    return {
      x: (this.feet.x * 0.5 + 0.5) * w,
      y: (-this.feet.y * 0.5 + 0.5) * h,
      visible: this.feet.z < 1,
    };
  }

  pick(clientX: number, clientY: number): LineupActor | null {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.actors.map((actor) => actor.wrapper), true);
    const id = hits[0]?.object.id;
    if (id == null) return null;
    return this.actors.find((actor) => actor.wrapper.getObjectById(id)) ?? null;
  }

  start(): void {
    if (this.running || this.disposed) return;
    this.running = true;
    this.clock.start();
    const tick = (): void => {
      if (!this.running || this.disposed) return;
      this.raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, this.clock.getDelta());
      this.onFrame?.(dt);
      for (const actor of this.actors) {
        actor.sample(dt);
        actor.setShade(actor === this.focus ? 1 : 0.4);
      }
      this.aimSpot(dt);
      this.postFx.render();
    };
    this.raf = requestAnimationFrame(tick);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    cancelAnimationFrame(this.raf);
    for (const actor of this.actors) {
      actor.voxels.dispose(actor.player.skin);
      actor.skinTexture?.dispose();
    }
    this.deck?.geometry.dispose();
    (this.deck?.material as MeshStandardMaterial | undefined)?.dispose();
    this.pool.geometry.dispose();
    (this.pool.material as MeshBasicMaterial).map?.dispose();
    (this.pool.material as MeshBasicMaterial).dispose();
    this.postFx.dispose();
    this.atmosphere.dispose();
    this.envMap.dispose();
    this.renderer.dispose();
  }

  private aimSpot(dt: number): void {
    const actor = this.focus;
    const aim = actor ? actor.wrapper.getWorldPosition(this.feet) : this.feet.set(0, 0, 0);
    const aimX = actor ? aim.x : 0;
    const k = Math.min(1, dt * 7);
    this.spot.position.x += (aimX - this.spot.position.x) * k;
    this.spot.position.y = 70;
    this.spot.position.z = 0;
    this.spot.target.position.x += (aimX - this.spot.target.position.x) * k;
    this.spot.target.position.y = FLOOR_Y;
    this.spot.target.position.z = 0;
    const want = actor ? 26 : 0;
    this.spot.intensity += (want - this.spot.intensity) * Math.min(1, dt * 5);
    this.pool.position.x += (aimX - this.pool.position.x) * k;
    this.pool.position.y = FLOOR_Y + 0.2;
    this.pool.position.z = 1.2;
    const poolMat = this.pool.material as MeshBasicMaterial;
    const poolOpacity = actor ? 1 : 0;
    poolMat.opacity += (poolOpacity - poolMat.opacity) * Math.min(1, dt * 5);
  }

  private configureMeshes(actor: LineupActor): void {
    const skin = actor.player.skin;
    skin.traverse((obj) => {
      if (!(obj instanceof Mesh)) return;
      obj.renderOrder = obj.name === "outer" ? 1 : 0;
    });
    const limbs = [skin.rightArm, skin.leftArm, skin.rightLeg, skin.leftLeg];
    limbs.forEach((part, index) => {
      (part.outerLayer as Mesh).renderOrder = 2 + index;
    });
    normalizeSkinDepthBias(skin);
  }
}

/** Светлое пятно лампы на полу под выбранным персонажем. */
function createLampPool(): Mesh {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const c = size / 2;
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, "rgba(255, 255, 255, 0.9)");
    g.addColorStop(0.2, "rgba(255, 255, 255, 0.42)");
    g.addColorStop(0.45, "rgba(255, 255, 255, 0.14)");
    g.addColorStop(0.72, "rgba(255, 255, 255, 0.04)");
    g.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;
  const material = new MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    opacity: 0,
  });
  const mesh = new Mesh(new PlaneGeometry(78, 40), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = FLOOR_Y + 0.2;
  mesh.renderOrder = 2;
  return mesh;
}
