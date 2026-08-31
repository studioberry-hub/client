// Кастомные анимации в духе трейлеров Mojang + бленд поз для переключения.
// Свой базовый класс — без импорта PlayerAnimation из skin3d (конфликт @types/three).

/** Минимальный контракт анимации */
export interface SkinAnimation {
  speed: number;
  paused: boolean;
  progress: number;
  /** Анимация сама крутит ноги (иначе движок держит stock-позу) */
  readonly controlsLegs?: boolean;
  update(player: any, deltaTime: number): void;
}

/** Снимок углов частей тела для кроссфейда */
export interface PoseSnapshot {
  root: { x: number; y: number; z: number; rx: number; ry: number; rz: number };
  head: { x: number; y: number; z: number };
  body: { x: number; y: number; z: number };
  leftArm: { x: number; y: number; z: number };
  rightArm: { x: number; y: number; z: number };
  leftLeg: { x: number; y: number; z: number };
  rightLeg: { x: number; y: number; z: number };
  cape: { x: number; y: number; z: number };
}

const PARTS = [
  "head",
  "body",
  "leftArm",
  "rightArm",
  "leftLeg",
  "rightLeg",
] as const;

function readRot(obj: any): { x: number; y: number; z: number } {
  return { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z };
}

function writeRot(obj: any, r: { x: number; y: number; z: number }): void {
  obj.rotation.x = r.x;
  obj.rotation.y = r.y;
  obj.rotation.z = r.z;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpRot(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
  t: number,
): { x: number; y: number; z: number } {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) };
}

/** Быстрый ease для короткого кроссфейда */
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** Плавный in-out для ванильных циклов (мягче сырого sin) */
function smoothWave(t: number): number {
  // sin → почти-синусоида с более мягкими краями
  const s = Math.sin(t);
  return Math.sign(s) * Math.pow(Math.abs(s), 0.85);
}

function smooth01(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

/** «Ударная» кривая шага — как в трейлерном спринте */
function punch(x: number): number {
  return Math.sin(x) * Math.abs(Math.sin(x));
}

export function capturePose(player: any): PoseSnapshot {
  return {
    root: {
      x: player.position.x,
      y: player.position.y,
      z: player.position.z,
      rx: player.rotation.x,
      ry: player.rotation.y,
      rz: player.rotation.z,
    },
    head: readRot(player.skin.head),
    body: readRot(player.skin.body),
    leftArm: readRot(player.skin.leftArm),
    rightArm: readRot(player.skin.rightArm),
    leftLeg: readRot(player.skin.leftLeg),
    rightLeg: readRot(player.skin.rightLeg),
    cape: readRot(player.cape),
  };
}

export function applyPose(player: any, pose: PoseSnapshot): void {
  player.position.set(pose.root.x, pose.root.y, pose.root.z);
  player.rotation.x = pose.root.rx;
  player.rotation.y = pose.root.ry;
  player.rotation.z = pose.root.rz;
  writeRot(player.skin.head, pose.head);
  writeRot(player.skin.body, pose.body);
  writeRot(player.skin.leftArm, pose.leftArm);
  writeRot(player.skin.rightArm, pose.rightArm);
  writeRot(player.skin.leftLeg, pose.leftLeg);
  writeRot(player.skin.rightLeg, pose.rightLeg);
  writeRot(player.cape, pose.cape);
}

export function blendPoses(player: any, from: PoseSnapshot, to: PoseSnapshot, t: number): void {
  const k = easeOutCubic(Math.max(0, Math.min(1, t)));
  player.position.set(
    lerp(from.root.x, to.root.x, k),
    lerp(from.root.y, to.root.y, k),
    lerp(from.root.z, to.root.z, k),
  );
  player.rotation.x = lerp(from.root.rx, to.root.rx, k);
  player.rotation.y = lerp(from.root.ry, to.root.ry, k);
  player.rotation.z = lerp(from.root.rz, to.root.rz, k);
  writeRot(player.skin.head, lerpRot(from.head, to.head, k));
  writeRot(player.skin.body, lerpRot(from.body, to.body, k));
  writeRot(player.skin.leftArm, lerpRot(from.leftArm, to.leftArm, k));
  writeRot(player.skin.rightArm, lerpRot(from.rightArm, to.rightArm, k));
  writeRot(player.skin.leftLeg, lerpRot(from.leftLeg, to.leftLeg, k));
  writeRot(player.skin.rightLeg, lerpRot(from.rightLeg, to.rightLeg, k));
  writeRot(player.cape, lerpRot(from.cape, to.cape, k));
}

/** Yaw плаща в skin3d — без него текстура «задом наперёд» */
const CAPE_YAW = Math.PI;
/** Угол покоя плаща (CapeDefaultAngle из skin3d) */
const CAPE_REST_X = (10.8 * Math.PI) / 180;

export function resetLimbPose(player: any): void {
  player.position.set(0, 0, 0);
  player.rotation.x = 0;
  player.rotation.z = 0;
  for (const name of PARTS) {
    const part = player.skin[name];
    part.rotation.order = "XYZ";
    part.rotation.set(0, 0, 0);
    part.quaternion.identity();
  }
  // Rest-позиции skin3d / product (emote мог сдвинуть xyz)
  player.skin.head.position.set(0, 0, 0);
  player.skin.body.position.set(0, -6, 0);
  player.skin.rightArm.position.set(-5, -2, 0);
  player.skin.leftArm.position.set(5, -2, 0);
  // Ноги — applyStockLegPose снаружи, если анимация их не контролирует
  // Сохраняем yaw π — иначе плащ смотрит не туда и «15» зеркалится
  player.cape.rotation.set(CAPE_REST_X, CAPE_YAW, 0);
}

abstract class BaseSkinAnimation implements SkinAnimation {
  speed = 1;
  paused = false;
  progress = 0;
  readonly controlsLegs: boolean = false;

  update(player: any, deltaTime: number): void {
    if (this.paused) return;
    const delta = deltaTime * this.speed;
    this.animate(player, delta);
    this.progress += delta;
  }

  protected abstract animate(player: any, delta: number): void;
}

export function animationControlsLegs(animation: SkinAnimation | null): boolean {
  return Boolean(animation?.controlsLegs);
}

/**
 * Trailer idle — «живой» герой: дыхание, slim/classic осанка, толчок по клику.
 */
export class HeroIdleAnimation extends BaseSkinAnimation {
  override readonly controlsLegs = true;
  /**
   * Движок включает при взгляде за курсором: анимация не крутит голову,
   * иначе взгляд и idle-look конфликтуют и выглядят криво.
   */
  suppressAutoLook = false;
  /** Тонкая модель — чуть другая осанка */
  modelSlim = false;

  private _nudgeElapsed = -1;
  private _nudgeImpactPending = false;

  private static readonly NUDGE_DURATION = 1.35;

  nudge(): void {
    this._nudgeElapsed = 0;
    this._nudgeImpactPending = true;
  }

  get isNudging(): boolean {
    return this._nudgeElapsed >= 0;
  }

  /** Блокирует взгляд курсором во время толчка */
  get blocksCursorLook(): boolean {
    return this.isNudging;
  }

  consumeNudgeImpact(): boolean {
    const v = this._nudgeImpactPending;
    this._nudgeImpactPending = false;
    return v;
  }

  protected animate(player: any, delta: number): void {
    const t = this.progress;
    const breathe = Math.sin(t * 1.35);
    const wind = Math.sin(t * 2.1) * 0.5 + Math.sin(t * 3.4) * 0.5;
    const weight = 0.55 + Math.sin(t * 0.35) * 0.45;
    const slim = this.modelSlim ? 1 : 0;

    // Спокойная стойка: лёгкое дыхание, руки у тела (не «распахнуты»)
    player.skin.body.rotation.x = 0.02 + breathe * 0.025 - slim * 0.01;
    player.skin.body.rotation.z = (weight - 0.5) * (0.04 + slim * 0.02);

    const busyHead = this.blocksCursorLook;
    if (this.suppressAutoLook && !busyHead) {
      player.skin.body.rotation.y = -0.04 + slim * 0.02;
      player.skin.head.rotation.set(-0.03, 0, 0);
    } else {
      const lookRaw = Math.sin(t * 0.55);
      const look = lookRaw * lookRaw * lookRaw;
      player.skin.body.rotation.y = -0.06 + look * 0.06 + slim * 0.02;
      player.skin.head.rotation.y = look * 0.4;
      player.skin.head.rotation.x = -0.04 + Math.sin(t * 0.8) * 0.05;
      player.skin.head.rotation.z = look * 0.03 + slim * 0.02;
    }

    // Руки почти вдоль тела; z ≈ ±0.06 — естественный зазор, не разведение
    player.skin.leftArm.rotation.x = -0.05 + breathe * 0.035 + slim * 0.02;
    player.skin.leftArm.rotation.z = 0.06 + wind * 0.015 - slim * 0.015;
    player.skin.rightArm.rotation.x = -0.03 + Math.sin(t * 0.9 + 1.2) * 0.04;
    player.skin.rightArm.rotation.z = -0.06 - weight * 0.02 + slim * 0.015;

    // Ноги почти параллельно — ощущение «стоит», а не контрапоста
    player.skin.leftLeg.rotation.x = -0.03 * weight;
    player.skin.rightLeg.rotation.x = 0.04 * weight + slim * 0.02;
    player.skin.leftLeg.rotation.z = 0.015;
    player.skin.rightLeg.rotation.z = -0.015;

    player.cape.rotation.x = Math.PI * 0.1 + wind * 0.06 + breathe * 0.02;

    if (this._nudgeElapsed >= 0) {
      this._nudgeElapsed += delta;
      const u = this._nudgeElapsed / HeroIdleAnimation.NUDGE_DURATION;
      if (u >= 1) this._nudgeElapsed = -1;
      else this._applyNudgeOverlay(player, u);
    }
  }

  private _applyNudgeOverlay(player: any, u: number): void {
    let push: number;
    if (u < 0.1) push = easeOutCubic(u / 0.1);
    else if (u < 0.28) push = 1;
    else push = 1 - easeOutCubic((u - 0.28) / 0.72);

    const shakeEnv = push * (u < 0.65 ? 1 : Math.max(0, 1 - (u - 0.65) / 0.28));
    const shake = Math.sin(u * Math.PI * 11) * shakeEnv;

    player.position.z -= 1.55 * push;
    player.position.y += 0.2 * push;
    player.rotation.x -= 0.32 * push;
    player.rotation.z += shake * 0.05;

    player.skin.body.rotation.x -= 0.18 * push;
    player.skin.body.rotation.z += shake * 0.04;
    player.skin.head.rotation.y += shake * 0.55;
    player.skin.head.rotation.z += shake * 0.28;
    player.skin.head.rotation.x -= 0.1 * push + Math.abs(shake) * 0.06;

    player.skin.leftArm.rotation.x -= 0.55 * push;
    player.skin.rightArm.rotation.x -= 0.5 * push;
    player.skin.leftArm.rotation.z += 0.35 * push;
    player.skin.rightArm.rotation.z -= 0.35 * push;
    player.skin.leftLeg.rotation.x -= 0.18 * push;
    player.skin.rightLeg.rotation.x += 0.22 * push;
    player.cape.rotation.x += 0.12 * push;
  }
}

/**
 * Trailer sprint — широкий шаг, сильный наклон, плащ парусом,
 * противоположный мах рук; темп чуть выше среднего игрового спринта.
 */
export class TrailerRunAnimation extends BaseSkinAnimation {
  override readonly controlsLegs = true;
  override speed = 1.12;

  protected animate(player: any): void {
    const t = this.progress * 9.6;
    const stride = Math.sin(t);
    const strideOpp = Math.sin(t + Math.PI);
    const plant = punch(t);
    const plantOpp = punch(t + Math.PI);
    const bob = Math.abs(Math.sin(t));

    player.rotation.x = 0.26;
    player.rotation.z = stride * 0.035;
    player.position.y = bob * 0.55;
    player.position.x = stride * 0.08;

    player.skin.body.rotation.x = 0.12;
    player.skin.body.rotation.y = stride * 0.12;
    player.skin.body.rotation.z = stride * 0.04;

    player.skin.head.rotation.x = -0.18;
    player.skin.head.rotation.y = stride * 0.07;
    player.skin.head.rotation.z = -stride * 0.03;

    // Ноги — широкий театральный шаг
    player.skin.leftLeg.rotation.x = strideOpp * 1.15;
    player.skin.rightLeg.rotation.x = stride * 1.15;
    player.skin.leftLeg.rotation.z = plantOpp * 0.06;
    player.skin.rightLeg.rotation.z = -plant * 0.06;

    // Руки — противоположный мах с раскрытием в стороны
    player.skin.leftArm.rotation.x = stride * 1.25;
    player.skin.rightArm.rotation.x = strideOpp * 1.25;
    player.skin.leftArm.rotation.z = 0.22 + Math.abs(stride) * 0.12;
    player.skin.rightArm.rotation.z = -0.22 - Math.abs(strideOpp) * 0.12;

    player.cape.rotation.x = Math.PI * 0.42 + bob * 0.14;
  }
}

/**
 * Махать — быстрее и живее: активный мах, лёгкий подскок, голова в ритме.
 */
export class WaveHelloAnimation extends BaseSkinAnimation {
  override readonly controlsLegs = true;
  override speed = 1.15;

  protected animate(player: any): void {
    const t = this.progress * 6.8;
    const wave = Math.sin(t);
    const lift = smooth01(Math.min(1, this.progress * 3.2));
    const bounce = (0.5 - 0.5 * Math.cos(t * 0.5)) * 0.14 * lift;

    player.position.y = bounce;

    player.skin.head.rotation.x = -0.05 + bounce * 0.05;
    player.skin.head.rotation.y = 0.14 * lift + wave * 0.04 * lift;
    player.skin.head.rotation.z = 0.05 * lift + wave * 0.03 * lift;

    player.skin.body.rotation.x = 0.025 + bounce * 0.02;
    player.skin.body.rotation.y = 0.07 * lift;
    player.skin.body.rotation.z = wave * 0.025 * lift;

    player.skin.rightArm.rotation.x = wave * 0.06 * lift;
    player.skin.rightArm.rotation.y = 0;
    player.skin.rightArm.rotation.z = (-2.15 + wave * 0.48) * lift;

    player.skin.leftArm.rotation.x = -0.08 + bounce * 0.04;
    player.skin.leftArm.rotation.y = 0;
    player.skin.leftArm.rotation.z = 0.1;

    player.skin.leftLeg.rotation.set(-0.04 - bounce * 0.04, 0, 0.025);
    player.skin.rightLeg.rotation.set(0.05 + bounce * 0.05, 0, -0.025);
    player.cape.rotation.x = CAPE_REST_X + bounce * 0.08;
  }
}

/** Красться — чуть бодрее шаг */
export class SneakAnimation extends BaseSkinAnimation {
  override readonly controlsLegs = true;
  override speed = 1.1;

  protected animate(player: any): void {
    const t = this.progress * 3.4;
    const stride = Math.sin(t) * 0.32;
    const bob = Math.abs(Math.sin(t)) * 0.06;

    player.position.y = -0.95 + bob;
    player.rotation.x = 0.1;

    player.skin.body.rotation.x = 0.12;
    player.skin.body.rotation.y = stride * 0.05;
    player.skin.body.rotation.z = 0;

    player.skin.head.rotation.x = -0.02 + bob * 0.1;
    player.skin.head.rotation.y = stride * 0.08;
    player.skin.head.rotation.z = 0;

    player.skin.leftLeg.rotation.set(stride, 0, 0.015);
    player.skin.rightLeg.rotation.set(-stride, 0, -0.015);
    player.skin.leftArm.rotation.set(-stride * 0.28 - 0.18, 0, 0.09);
    player.skin.rightArm.rotation.set(stride * 0.28 - 0.18, 0, -0.09);

    player.cape.rotation.x = CAPE_REST_X + 0.1 + bob * 0.05;
  }
}

/** Оглядывание — быстрее смена взгляда */
export class LookAroundAnimation extends BaseSkinAnimation {
  override readonly controlsLegs = true;
  override speed = 1.15;

  protected animate(player: any): void {
    const t = this.progress * 1.45;
    const look = Math.sin(t);
    const settle = smooth01(Math.min(1, this.progress * 1.8));
    const k = look * settle;
    const blink = Math.sin(t * 2.2) * 0.02;

    player.skin.head.rotation.x = -0.04 + blink;
    player.skin.head.rotation.y = k * 0.78;
    player.skin.head.rotation.z = k * 0.03;

    player.skin.body.rotation.x = 0.02;
    player.skin.body.rotation.y = k * 0.14;
    player.skin.body.rotation.z = 0;

    player.skin.leftArm.rotation.set(-0.1 - k * 0.04, 0, 0.09);
    player.skin.rightArm.rotation.set(-0.08 + k * 0.04, 0, -0.09);
    player.skin.leftLeg.rotation.set(-0.03, 0, 0.02);
    player.skin.rightLeg.rotation.set(0.04, 0, -0.02);
    player.cape.rotation.x = CAPE_REST_X;
  }
}

/**
 * Рука на сердце — быстрый вход + дыхание.
 */
export class CoolPoseAnimation extends BaseSkinAnimation {
  override readonly controlsLegs = true;
  override speed = 1.1;

  protected animate(player: any): void {
    const breathe = Math.sin(this.progress * 1.35) * 0.016;
    const inPose = smooth01(Math.min(1, this.progress * 2.0));
    const pulse = Math.sin(this.progress * 2.4) * 0.02 * inPose;

    player.skin.body.rotation.y = -0.1 * inPose;
    player.skin.body.rotation.z = 0;
    player.skin.body.rotation.x = 0.025 + breathe;

    player.skin.head.rotation.y = 0.14 * inPose;
    player.skin.head.rotation.x = -0.05 + breathe;
    player.skin.head.rotation.z = 0;

    player.skin.rightArm.rotation.x = (-1.0 + pulse) * inPose;
    player.skin.rightArm.rotation.y = 0;
    player.skin.rightArm.rotation.z = (0.75 + pulse * 0.5) * inPose;

    player.skin.leftArm.rotation.x = -0.05 + breathe;
    player.skin.leftArm.rotation.y = 0;
    player.skin.leftArm.rotation.z = 0.08;

    player.skin.leftLeg.rotation.set(-0.03, 0, 0.02);
    player.skin.rightLeg.rotation.set(0.06 * inPose, 0, -0.03 * inPose);
    player.cape.rotation.x = CAPE_REST_X + breathe;
  }
}

/** Победа — бодрый подскок */
export class VictoryAnimation extends BaseSkinAnimation {
  override readonly controlsLegs = true;
  override speed = 1.2;

  protected animate(player: any): void {
    const t = this.progress * 5.8;
    const bounce = 0.5 - 0.5 * Math.cos(t);
    const sway = Math.sin(t) * 0.4;

    player.position.y = bounce * 0.75;

    player.skin.head.rotation.x = -0.12 + bounce * 0.05;
    player.skin.head.rotation.y = sway * 0.06;
    player.skin.head.rotation.z = 0;
    player.skin.body.rotation.x = -0.04;
    player.skin.body.rotation.y = sway * 0.04;
    player.skin.body.rotation.z = 0;

    player.skin.leftArm.rotation.set(bounce * 0.05, 0, 2.35 + sway * 0.06);
    player.skin.rightArm.rotation.set(bounce * 0.05, 0, -2.35 - sway * 0.06);

    player.skin.leftLeg.rotation.set(-0.1 * bounce, 0, 0.025);
    player.skin.rightLeg.rotation.set(0.12 * bounce, 0, -0.025);
    player.cape.rotation.x = CAPE_REST_X + bounce * 0.05;
  }
}

/** Сон стоя — ноги на полу; дышат только голова и руки */
export class SleepAnimation extends BaseSkinAnimation {
  override readonly controlsLegs = true;
  override speed = 0.75;

  protected animate(player: any): void {
    const inPose = smooth01(Math.min(1, this.progress * 1.35));
    const breath = Math.sin(this.progress * 1.15) * 0.03;
    const snore = Math.sin(this.progress * 2.3) * 0.014;

    // Корень и ноги не двигаем — стоим на полу
    player.position.y = 0;
    player.rotation.x = 0;
    player.rotation.z = 0;

    // Корпус статично чуть опущен (без дыхания)
    const sink = 0.9 * inPose;
    player.skin.body.position.y = -6 - sink;
    player.skin.head.position.y = -sink;
    player.skin.leftArm.position.y = -2 - sink;
    player.skin.rightArm.position.y = -2 - sink;

    player.skin.body.rotation.x = 0.1 * inPose;
    player.skin.body.rotation.y = 0;
    player.skin.body.rotation.z = 0;

    player.skin.leftLeg.rotation.set(0, 0, 0.02);
    player.skin.rightLeg.rotation.set(0, 0, -0.02);

    // Дыхание / сопение — только голова и руки
    player.skin.head.rotation.x = (0.78 + breath + snore) * inPose;
    player.skin.head.rotation.y = snore * 0.35;
    player.skin.head.rotation.z = 0;

    player.skin.leftArm.rotation.set(0.12 * inPose + breath * 0.85, 0, 0.04);
    player.skin.rightArm.rotation.set(0.14 * inPose + breath * 0.85, 0, -0.04);

    player.cape.rotation.x = CAPE_REST_X + 0.03 * inPose;
  }
}

/** @deprecated используйте SleepAnimation */
export const SadAnimation = SleepAnimation;

/** Танец — быстрее ритм, выше амплитуда */
export class DanceAnimation extends BaseSkinAnimation {
  override readonly controlsLegs = true;
  override speed = 1.2;

  protected animate(player: any): void {
    const t = this.progress * 6.6;
    const beat = Math.sin(t);
    const beatOpp = Math.sin(t + Math.PI);
    const bob = Math.abs(Math.sin(t * 2)) * 0.7;

    player.position.y = bob * 0.48;

    player.skin.body.rotation.y = beat * 0.14;
    player.skin.body.rotation.z = beat * 0.03;
    player.skin.body.rotation.x = 0.05 + bob * 0.02;

    player.skin.head.rotation.y = beat * 0.12;
    player.skin.head.rotation.z = -beat * 0.04;
    player.skin.head.rotation.x = -0.05 + bob * 0.04;

    player.skin.leftArm.rotation.set(beatOpp * 0.7, 0, 0.32 + bob * 0.12);
    player.skin.rightArm.rotation.set(beat * 0.7, 0, -0.32 - bob * 0.12);

    player.skin.leftLeg.rotation.set(beat * 0.4, 0, 0.04);
    player.skin.rightLeg.rotation.set(beatOpp * 0.4, 0, -0.04);
    player.cape.rotation.x = CAPE_REST_X + bob * 0.06;
  }
}

/** Парение — пикирующий «cinema»-ракурс из трейлеров с elytra */
export class GlideAnimation extends BaseSkinAnimation {
  override readonly controlsLegs = true;
  override speed = 1.1;

  protected animate(player: any): void {
    const t = this.progress;
    const bob = Math.sin(t * 2.2);
    const bank = Math.sin(t * 1.15);

    player.rotation.x = -0.72;
    player.rotation.z = bank * 0.14;
    player.position.y = 1.6 + bob * 0.48;

    player.skin.head.rotation.x = 0.45;
    player.skin.head.rotation.y = bank * 0.12;
    player.skin.body.rotation.x = 0.08;

    player.skin.leftArm.rotation.x = -0.35;
    player.skin.leftArm.rotation.y = 0;
    player.skin.leftArm.rotation.z = 1.05 + bob * 0.07;
    player.skin.rightArm.rotation.x = -0.35;
    player.skin.rightArm.rotation.y = 0;
    player.skin.rightArm.rotation.z = -1.05 - bob * 0.07;

    player.skin.leftLeg.rotation.x = 0.3 + bob * 0.05;
    player.skin.rightLeg.rotation.x = 0.18 - bob * 0.05;
    player.skin.leftLeg.rotation.z = 0.06;
    player.skin.rightLeg.rotation.z = -0.06;

    player.cape.rotation.x = CAPE_REST_X + 1.85 + bob * 0.08;
  }
}

/** Погрудные позы для карточек — постеровый вайб */
export class BustPoseAnimation extends BaseSkinAnimation {
  constructor(private readonly variant = 0) {
    super();
  }

  protected animate(player: any): void {
    const t = this.progress;
    const breathe = Math.sin(t * 1.4) * 0.02;
    const v = this.variant % 4;

    player.position.y = 0;
    player.rotation.z = v === 2 ? -0.06 : 0.04;

    if (v === 0) {
      player.skin.head.rotation.y = 0.45;
      player.skin.head.rotation.x = -0.1 + breathe;
      player.skin.body.rotation.y = -0.22;
      player.skin.leftArm.rotation.x = -0.65;
      player.skin.leftArm.rotation.z = 0.78;
      player.skin.rightArm.rotation.x = 0.05;
      player.skin.rightArm.rotation.z = -0.42;
    } else if (v === 1) {
      player.skin.head.rotation.y = -0.3;
      player.skin.head.rotation.x = -0.06 + breathe;
      player.skin.body.rotation.y = 0.18;
      player.skin.leftArm.rotation.x = -1.05;
      player.skin.leftArm.rotation.z = 0.28;
      player.skin.rightArm.rotation.x = -1.1;
      player.skin.rightArm.rotation.z = -0.18;
    } else if (v === 2) {
      player.skin.head.rotation.y = 0.95;
      player.skin.head.rotation.x = -0.12 + breathe;
      player.skin.body.rotation.y = 0.52;
      player.skin.leftArm.rotation.x = -0.25;
      player.skin.leftArm.rotation.z = 0.5;
      player.skin.rightArm.rotation.x = -0.45;
      player.skin.rightArm.rotation.z = -0.65;
    } else {
      player.skin.head.rotation.y = -0.18;
      player.skin.head.rotation.x = 0.06 + breathe;
      player.skin.body.rotation.y = -0.12;
      player.skin.leftArm.rotation.x = -0.2;
      player.skin.leftArm.rotation.z = 0.22;
      player.skin.rightArm.rotation.x = -1.45;
      player.skin.rightArm.rotation.z = -0.4;
    }

    player.cape.rotation.x = Math.PI * 0.16 + breathe;
  }
}

export function resetPlayerRootPose(player: any): void {
  player.position.set(0, 0, 0);
  player.rotation.x = 0;
  player.rotation.z = 0;
}

export type SkinAnimId =
  | "idle"
  | "run"
  | "wave"
  | "sneak"
  | "look"
  | "cool"
  | "glide"
  | "victory"
  | "sleep"
  | "dance"
  | "dab"
  | "think"
  | "hello";

/** Dab — быстрый snap в позу */
export class DabAnimation extends BaseSkinAnimation {
  override readonly controlsLegs = true;
  override speed = 1.15;

  protected animate(player: any): void {
    const hold = smooth01(Math.min(1, this.progress * 3.0));
    const settle = Math.sin(this.progress * 3.5) * 0.02 * hold;

    player.skin.body.rotation.y = -0.14 * hold;
    player.skin.body.rotation.z = 0;
    player.skin.body.rotation.x = 0.03 * hold;

    player.skin.head.rotation.y = 0.38 * hold;
    player.skin.head.rotation.x = 0.14 * hold + settle;
    player.skin.head.rotation.z = -0.1 * hold;

    player.skin.rightArm.rotation.x = -1.65 * hold;
    player.skin.rightArm.rotation.y = 0;
    player.skin.rightArm.rotation.z = 0.7 * hold;

    player.skin.leftArm.rotation.x = 0;
    player.skin.leftArm.rotation.y = 0;
    player.skin.leftArm.rotation.z = 2.2 * hold;

    player.skin.leftLeg.rotation.set(0.05 * hold, 0, 0.025);
    player.skin.rightLeg.rotation.set(-0.04 * hold, 0, -0.03 * hold);
    player.cape.rotation.x = CAPE_REST_X;
  }
}

/**
 * Думать — быстрее вход, лёгкое «покачивание» руки у лица.
 */
export class ThinkAnimation extends BaseSkinAnimation {
  override readonly controlsLegs = true;
  override speed = 1.1;

  protected animate(player: any): void {
    const breathe = Math.sin(this.progress * 1.3) * 0.018;
    const inPose = smooth01(Math.min(1, this.progress * 2.0));
    const tap = Math.sin(this.progress * 2.8) * 0.04 * inPose;

    player.skin.head.rotation.x = 0.1 + breathe;
    player.skin.head.rotation.y = 0.12 * inPose + tap * 0.3;
    player.skin.head.rotation.z = 0;
    player.skin.body.rotation.y = -0.06 * inPose;
    player.skin.body.rotation.x = 0.025 + breathe * 0.4;
    player.skin.body.rotation.z = 0;

    player.skin.rightArm.rotation.x = (-2.05 + tap) * inPose;
    player.skin.rightArm.rotation.y = 0;
    player.skin.rightArm.rotation.z = (0.22 + tap * 0.4) * inPose;

    player.skin.leftArm.rotation.x = -0.08 + breathe;
    player.skin.leftArm.rotation.y = 0;
    player.skin.leftArm.rotation.z = 0.09;

    player.skin.leftLeg.rotation.set(-0.03, 0, 0.02);
    player.skin.rightLeg.rotation.set(0.05, 0, -0.02);
    player.cape.rotation.x = CAPE_REST_X + breathe;
  }
}

/** Привет — быстрый мах + кивок */
export class HelloNodAnimation extends BaseSkinAnimation {
  override readonly controlsLegs = true;
  override speed = 1.2;

  protected animate(player: any): void {
    const t = this.progress * 6.2;
    const wave = Math.sin(t);
    const lift = smooth01(Math.min(1, this.progress * 3.0));
    const nod = Math.sin(t * 0.55) * 0.08 * lift;
    const bounce = (0.5 - 0.5 * Math.cos(t * 0.5)) * 0.1 * lift;

    player.position.y = bounce;

    player.skin.head.rotation.x = -0.04 + nod;
    player.skin.head.rotation.y = 0.12 * lift;
    player.skin.head.rotation.z = wave * 0.025 * lift;
    player.skin.body.rotation.y = 0.05 * lift;
    player.skin.body.rotation.x = 0.025 + bounce * 0.02;
    player.skin.body.rotation.z = wave * 0.02 * lift;

    player.skin.rightArm.rotation.x = wave * 0.05 * lift;
    player.skin.rightArm.rotation.y = 0;
    player.skin.rightArm.rotation.z = (-2.05 + wave * 0.42) * lift;

    player.skin.leftArm.rotation.x = -0.07;
    player.skin.leftArm.rotation.y = 0;
    player.skin.leftArm.rotation.z = 0.09;

    player.skin.leftLeg.rotation.set(-0.03, 0, 0.02);
    player.skin.rightLeg.rotation.set(0.04, 0, -0.02);
    player.cape.rotation.x = CAPE_REST_X + bounce * 0.06;
  }
}

/** Пресеты кадра под скриншот */
export type ShotPresetId = "hero" | "bust" | "back" | "discord";

export function createSkinAnimation(id: SkinAnimId | "sad"): SkinAnimation {
  // Процедурные позы (идея SPE, без сырых ключей Emotecraft)
  switch (id) {
    case "run":
      return new TrailerRunAnimation();
    case "wave":
      return new WaveHelloAnimation();
    case "hello":
      return new HelloNodAnimation();
    case "sneak":
      return new SneakAnimation();
    case "look":
      return new LookAroundAnimation();
    case "cool":
      return new CoolPoseAnimation();
    case "think":
      return new ThinkAnimation();
    case "dab":
      return new DabAnimation();
    case "glide":
      return new GlideAnimation();
    case "victory":
      return new VictoryAnimation();
    case "sleep":
    case "sad":
      return new SleepAnimation();
    case "dance":
      return new DanceAnimation();
    case "idle":
    default:
      return new HeroIdleAnimation();
  }
}
