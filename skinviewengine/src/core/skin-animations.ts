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


function smooth01(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

/**
 * Редкий поворот головы: на стыке цикла угол и скорость нулевые,
 * поэтому повтор не щёлкает.
 */
function rareHeadYaw(t: number): number {
  const period = 12.4;
  const phase = (t % period) / period;
  const hump = (center: number, half: number, amp: number): number => {
    const d = (phase - center) / half;
    if (d <= -1 || d >= 1) return 0;
    const x = 0.5 + 0.5 * Math.cos(Math.PI * d);
    return amp * x * x;
  };
  return hump(0.42, 0.1, 0.36) - hump(0.78, 0.08, 0.28);
}

/**
 * Шаг, в котором нижняя стопа остаётся на полу.
 * Угол 0 — нога вертикально, стопа внизу. Корню даём отрицательный Y,
 * равный подъёму дуги более прямой ноги (длина ноги skin3d ≈ 12).
 */
function groundedStride(
  phase: number,
  swing: number,
  support: number,
): { left: number; right: number; drop: number } {
  const s = Math.sin(phase);
  const left = s >= 0 ? s * swing : s * support;
  const right = s >= 0 ? -s * support : -s * swing;
  const lift = Math.min(1 - Math.cos(left), 1 - Math.cos(right));
  return { left, right, drop: -12 * lift };
}

/** Импульс удара: 0 на краях фазы, без рывка при зацикливании */
function strikePulse(phase: number): number {
  const p = phase - Math.floor(phase);
  if (p < 0.16 || p > 0.7) return 0;
  const u = (p - 0.16) / (0.7 - 0.16);
  const s = Math.sin(u * Math.PI);
  return s * s;
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
 * Idle: стопы на земле, дыхание грудью, редкий взгляд.
 * Корень по Y не двигается — иначе модель «левитирует».
 */
export class HeroIdleAnimation extends BaseSkinAnimation {
  override readonly controlsLegs = true;
  /**
   * Движок ставит true, когда взгляд за курсором включён.
   * Сам idle голову всё равно чуть поворачивает; курсор подмешивается поверх,
   * только если указатель реально ушёл от центра.
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
    // В нуле все добавки = 0: синусы и горб взгляда сходятся со стойкой
    const settle = smooth01(Math.min(1, t * 1.1));
    const breath = Math.sin(t * 0.78);
    const weight = Math.sin(t * 0.24);
    const look = rareHeadYaw(t);
    const slim = this.modelSlim ? 1 : 0;

    // Пол. Подскок всего тела убран — из‑за него ноги «плыли»
    player.position.x = 0;
    player.position.y = 0;

    // Дыхание — наклон груди. Таз без крена в сторону
    player.skin.body.rotation.x = breath * 0.055 * settle;
    player.skin.body.rotation.y = weight * 0.025 * settle;
    player.skin.body.rotation.z = 0;

    player.skin.head.rotation.x = breath * 0.018 * settle;
    player.skin.head.rotation.y = look * settle;
    player.skin.head.rotation.z = look * 0.05 * settle;

    // Плечи дышат вместе с грудью, руки не машут как при шаге
    player.skin.leftArm.rotation.x = breath * 0.04 * settle - weight * 0.035 * settle;
    player.skin.rightArm.rotation.x = breath * 0.04 * settle + weight * 0.035 * settle;
    player.skin.leftArm.rotation.y = 0;
    player.skin.rightArm.rotation.y = 0;
    player.skin.leftArm.rotation.z = (0.05 - slim * 0.012) * settle + breath * 0.02 * settle;
    player.skin.rightArm.rotation.z = (-0.05 + slim * 0.012) * settle - breath * 0.02 * settle;

    // Обе ноги прямые весь цикл: без сгиба колена и без крена в бедре
    player.skin.leftLeg.rotation.set(0, 0, 0);
    player.skin.rightLeg.rotation.set(0, 0, 0);

    if (player.cape?.visible) {
      player.cape.rotation.x = CAPE_REST_X + breath * 0.045 + weight * 0.025;
      player.cape.rotation.z = weight * 0.035;
      player.cape.rotation.y = CAPE_YAW;
    }

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
 * Парение в зале аккаунтов: тот же скелет, что у idle,
 * только тело мягко поднимается и покачивается.
 */
export class HoverAnimation extends BaseSkinAnimation {
  override readonly controlsLegs = true;

  private lift = 0;

  protected animate(player: any, delta: number): void {
    const t = this.progress;
    this.lift = Math.min(1, this.lift + delta * 1.5);
    const rise = this.lift;
    const bob = Math.sin(t * 1.35);
    const breath = Math.sin(t * 0.78);

    player.position.x = 0;
    player.position.z = 0;
    player.position.y = (2.4 + bob * 0.45) * rise;
    player.rotation.x = bob * 0.015 * rise;
    player.rotation.z = bob * 0.02 * rise;

    player.skin.body.rotation.x = breath * 0.045 * rise;
    player.skin.body.rotation.y = bob * 0.02 * rise;
    player.skin.body.rotation.z = 0;

    player.skin.head.rotation.x = -0.04 * rise + breath * 0.015;
    player.skin.head.rotation.y = Math.sin(t * 0.32) * 0.1 * rise;
    player.skin.head.rotation.z = 0;

    player.skin.leftArm.rotation.x = -0.08 * rise;
    player.skin.rightArm.rotation.x = -0.08 * rise;
    player.skin.leftArm.rotation.y = 0;
    player.skin.rightArm.rotation.y = 0;
    player.skin.leftArm.rotation.z = 0.16 * rise;
    player.skin.rightArm.rotation.z = -0.16 * rise;

    player.skin.leftLeg.rotation.set(0.04 * rise, 0, -0.02 * rise);
    player.skin.rightLeg.rotation.set(-0.02 * rise, 0, 0.02 * rise);

    if (player.cape?.visible) {
      player.cape.rotation.x = CAPE_REST_X + (0.22 + bob * 0.05) * rise;
      player.cape.rotation.y = CAPE_YAW;
      player.cape.rotation.z = 0;
    }
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
    const phase = this.progress * 8.6;
    const settle = smooth01(Math.min(1, this.progress * 2.2));
    // Маховая нога выше, опорная ближе к вертикали — её стопа на полу
    const step = groundedStride(phase, 1.05, 0.48);
    const sway = Math.sin(phase);

    player.position.x = 0;
    player.position.y = step.drop;
    player.rotation.x = 0.22 * settle;
    player.rotation.z = sway * 0.04;

    player.skin.body.rotation.x = 0.1 * settle;
    player.skin.body.rotation.y = sway * 0.1;
    player.skin.body.rotation.z = sway * 0.035;

    player.skin.head.rotation.x = -0.16 * settle;
    player.skin.head.rotation.y = sway * 0.05;
    player.skin.head.rotation.z = -sway * 0.03;

    player.skin.leftLeg.rotation.x = step.left;
    player.skin.rightLeg.rotation.x = step.right;
    player.skin.leftLeg.rotation.z = 0.02 * settle;
    player.skin.rightLeg.rotation.z = -0.02 * settle;

    // Противоход: рука назад, когда своя нога впереди
    player.skin.leftArm.rotation.x = -step.left * 1.05;
    player.skin.rightArm.rotation.x = -step.right * 1.05;
    player.skin.leftArm.rotation.z = 0.16 * settle;
    player.skin.rightArm.rotation.z = -0.16 * settle;

    if (player.cape?.visible) {
      player.cape.rotation.x = CAPE_REST_X + 0.95 * settle + Math.abs(sway) * 0.08;
      player.cape.rotation.y = CAPE_YAW;
    }
  }
}

/**
 * Ходьба — тот же скелет, что у бега, но спокойнее:
 * короткий шаг, небольшой наклон, плащ едва отходит.
 */
export class WalkCycleAnimation extends BaseSkinAnimation {
  override readonly controlsLegs = true;
  override speed = 1;

  protected animate(player: any): void {
    const phase = this.progress * 4.4;
    const settle = smooth01(Math.min(1, this.progress * 1.8));
    const step = groundedStride(phase, 0.68, 0.34);
    const sway = Math.sin(phase);

    player.position.x = 0;
    player.position.y = step.drop;
    player.rotation.x = 0.06 * settle;
    player.rotation.z = sway * 0.018;

    player.skin.body.rotation.x = 0.04 * settle;
    player.skin.body.rotation.y = sway * 0.06;
    player.skin.body.rotation.z = sway * 0.025;

    player.skin.head.rotation.x = -0.03 * settle;
    player.skin.head.rotation.y = -sway * 0.045;
    player.skin.head.rotation.z = -sway * 0.012;

    player.skin.leftLeg.rotation.x = step.left;
    player.skin.rightLeg.rotation.x = step.right;
    player.skin.leftLeg.rotation.z = 0.015 * settle;
    player.skin.rightLeg.rotation.z = -0.015 * settle;

    player.skin.leftArm.rotation.x = -step.left * 0.8;
    player.skin.rightArm.rotation.x = -step.right * 0.8;
    player.skin.leftArm.rotation.z = 0.06 * settle;
    player.skin.rightArm.rotation.z = -0.06 * settle;

    if (player.cape?.visible) {
      player.cape.rotation.x = CAPE_REST_X + 0.18 * settle + Math.abs(sway) * 0.04;
      player.cape.rotation.y = CAPE_YAW;
    }
  }
}

/** Удар — короткий выпад правой рукой и возврат без щелчка на стыке */
export class HitAnimation extends BaseSkinAnimation {
  override readonly controlsLegs = true;
  override speed = 1.05;

  protected animate(player: any): void {
    const period = 1.5;
    const phase = (this.progress % period) / period;
    const strike = strikePulse(phase);
    const sway = Math.sin(phase * Math.PI);

    // Без подскока: вес на задней ноге, передняя чуть подаётся
    player.position.y = 0;
    player.skin.body.rotation.y = -0.22 * strike;
    player.skin.body.rotation.x = 0.1 * strike;
    player.skin.body.rotation.z = 0.03 * sway * strike;

    player.skin.head.rotation.y = -0.1 * strike;
    player.skin.head.rotation.x = -0.05 * strike;

    player.skin.rightArm.rotation.x = -1.2 * strike;
    player.skin.rightArm.rotation.z = -0.18 * strike;
    player.skin.leftArm.rotation.x = 0.28 * strike;
    player.skin.leftArm.rotation.z = 0.16 * strike;

    player.skin.leftLeg.rotation.x = 0.22 * strike;
    player.skin.rightLeg.rotation.x = -0.06 * strike;
    player.skin.leftLeg.rotation.z = 0.02 * strike;
    player.skin.rightLeg.rotation.z = -0.02 * strike;

    if (player.cape?.visible) {
      player.cape.rotation.x = CAPE_REST_X + 0.28 * strike;
      player.cape.rotation.y = CAPE_YAW;
    }
  }
}

/**
 * Махать — рука над головой, корпус чуть качается.
 * Стопы на земле: подскока нет.
 */
export class WaveHelloAnimation extends BaseSkinAnimation {
  override readonly controlsLegs = true;
  override speed = 1.05;

  protected animate(player: any): void {
    const t = this.progress * 5.4;
    const wave = Math.sin(t);
    const lift = smooth01(Math.min(1, this.progress * 2.2));

    player.position.y = 0;

    player.skin.head.rotation.x = -0.04 * lift;
    player.skin.head.rotation.y = (0.16 + wave * 0.04) * lift;
    player.skin.head.rotation.z = (0.04 + wave * 0.02) * lift;

    player.skin.body.rotation.x = 0.02 * lift;
    player.skin.body.rotation.y = 0.08 * lift;
    player.skin.body.rotation.z = wave * 0.03 * lift;

    player.skin.rightArm.rotation.x = wave * 0.08 * lift;
    player.skin.rightArm.rotation.y = 0;
    player.skin.rightArm.rotation.z = (-2.2 + wave * 0.42) * lift;

    player.skin.leftArm.rotation.x = -0.06 * lift;
    player.skin.leftArm.rotation.y = 0;
    player.skin.leftArm.rotation.z = 0.08 * lift;

    // Опора на левую, правая чуть согнута — не шаг
    player.skin.leftLeg.rotation.set(0, 0, 0.02 * lift);
    player.skin.rightLeg.rotation.set(0.08 * lift, 0, -0.02 * lift);
    if (player.cape?.visible) {
      player.cape.rotation.x = CAPE_REST_X + wave * 0.04 * lift;
      player.cape.rotation.y = CAPE_YAW;
    }
  }
}

/** Красться — низкий корпус, короткий шаг, стопа в опоре */
export class SneakAnimation extends BaseSkinAnimation {
  override readonly controlsLegs = true;
  override speed = 1;

  protected animate(player: any): void {
    const phase = this.progress * 3.1;
    const settle = smooth01(Math.min(1, this.progress * 1.6));
    const step = groundedStride(phase, 0.42, 0.2);
    const sway = Math.sin(phase);

    // Бёдра назад: общий угол ног вперёд, стопы остаются под грудью.
    // Корень по X не крутим — раньше 0.16 рад плюс торс 0.32 клевали модель вперёд.
    const crouch = 0.48 * settle;
    const left = crouch + step.left;
    const right = crouch + step.right;
    const footLift = Math.min(1 - Math.cos(left), 1 - Math.cos(right));

    player.position.x = 0;
    player.position.y = -12 * footLift;
    player.rotation.x = 0;
    player.rotation.z = sway * 0.012;

    // Около 4° на груди, голова компенсирует — взгляд вперёд, не в пол
    player.skin.body.rotation.x = 0.07 * settle;
    player.skin.body.rotation.y = sway * 0.04;
    player.skin.body.rotation.z = sway * 0.015;

    player.skin.head.rotation.x = -player.skin.body.rotation.x;
    player.skin.head.rotation.y = sway * 0.04;
    player.skin.head.rotation.z = 0;

    player.skin.leftLeg.rotation.set(left, 0, 0.02 * settle);
    player.skin.rightLeg.rotation.set(right, 0, -0.02 * settle);
    player.skin.leftArm.rotation.set(0.48 * settle - step.left * 0.28, 0, 0.16 * settle);
    player.skin.rightArm.rotation.set(0.48 * settle - step.right * 0.28, 0, -0.16 * settle);

    if (player.cape?.visible) {
      player.cape.rotation.x = CAPE_REST_X + 0.22 * settle;
      player.cape.rotation.y = CAPE_YAW;
    }
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

/**
 * Прежняя стойка сна: стоит, корпус чуть опущен, голова опущена.
 * Сверху только тихое дыхание груди и редкий маленький поворот головы.
 */
export class SleepAnimation extends BaseSkinAnimation {
  override readonly controlsLegs = true;
  override speed = 0.75;

  protected animate(player: any): void {
    const inPose = smooth01(Math.min(1, this.progress * 1.35));
    const breath = Math.sin(this.progress * 1.05);
    const glance = rareHeadYaw(this.progress * 0.65);

    // Корень на полу, без крена и без подъёма
    player.position.y = 0;
    player.rotation.x = 0;
    player.rotation.z = 0;

    const sink = 0.9 * inPose;
    player.skin.body.position.y = -6 - sink;
    player.skin.head.position.y = -sink;
    player.skin.leftArm.position.y = -2 - sink;
    player.skin.rightArm.position.y = -2 - sink;

    // Старый наклон груди плюс тихая волна дыхания
    player.skin.body.rotation.x = 0.1 * inPose + breath * 0.035 * inPose;
    player.skin.body.rotation.y = 0;
    player.skin.body.rotation.z = 0;

    player.skin.leftLeg.rotation.set(0, 0, 0.02);
    player.skin.rightLeg.rotation.set(0, 0, -0.02);

    player.skin.head.rotation.x = 0.78 * inPose + breath * 0.012 * inPose;
    player.skin.head.rotation.y = glance * 0.18 * inPose;
    player.skin.head.rotation.z = 0;

    player.skin.leftArm.rotation.set(0.12 * inPose + breath * 0.04 * inPose, 0, 0.04);
    player.skin.rightArm.rotation.set(0.14 * inPose + breath * 0.04 * inPose, 0, -0.04);

    player.cape.rotation.x = CAPE_REST_X + 0.03 * inPose + breath * 0.02 * inPose;
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

/**
 * Парение — отдельный полёт, не Idle.
 * Тело в воздухе, руки в стороны, ноги тянутся назад и не шагают.
 */
export class GlideAnimation extends BaseSkinAnimation {
  override readonly controlsLegs = true;
  override speed = 1;

  protected animate(player: any): void {
    const t = this.progress;
    const settle = smooth01(Math.min(1, t * 1.2));
    const drift = Math.sin(t * 1.15);
    const bank = Math.sin(t * 0.55);

    player.rotation.x = -0.82 * settle;
    player.rotation.z = bank * 0.16 * settle;
    player.position.y = (2.4 + drift * 0.28) * settle;

    player.skin.head.rotation.x = 0.38 * settle;
    player.skin.head.rotation.y = bank * 0.1 * settle;
    player.skin.head.rotation.z = bank * 0.04 * settle;
    player.skin.body.rotation.x = 0.06 * settle + drift * 0.02;

    player.skin.leftArm.rotation.x = -0.28 * settle;
    player.skin.leftArm.rotation.y = 0;
    player.skin.leftArm.rotation.z = (1.15 + drift * 0.04) * settle;
    player.skin.rightArm.rotation.x = -0.28 * settle;
    player.skin.rightArm.rotation.y = 0;
    player.skin.rightArm.rotation.z = (-1.15 - drift * 0.04) * settle;

    player.skin.leftLeg.rotation.x = (0.42 + drift * 0.03) * settle;
    player.skin.rightLeg.rotation.x = (0.36 - drift * 0.03) * settle;
    player.skin.leftLeg.rotation.z = 0.05 * settle;
    player.skin.rightLeg.rotation.z = -0.05 * settle;

    if (player.cape?.visible) {
      player.cape.rotation.x = CAPE_REST_X + 1.7 * settle + drift * 0.06;
      player.cape.rotation.y = CAPE_YAW;
    }
  }
}

/** Погрудные позы. upright — ровный кадр карточки, без наклона корпуса. */
export class BustPoseAnimation extends BaseSkinAnimation {
  constructor(private readonly variant = 0, readonly upright = false) {
    super();
  }

  protected animate(player: any): void {
    if (this.upright) {
      player.position.y = 0;
      player.rotation.x = 0;
      player.rotation.z = 0;
      player.skin.head.rotation.x = 0;
      player.skin.head.rotation.y = 0.16;
      player.skin.head.rotation.z = 0;
      player.skin.body.rotation.x = 0;
      player.skin.body.rotation.y = 0;
      player.skin.body.rotation.z = 0;
      player.skin.leftArm.rotation.x = -0.05;
      player.skin.leftArm.rotation.y = 0;
      player.skin.leftArm.rotation.z = 0.05;
      player.skin.rightArm.rotation.x = -0.05;
      player.skin.rightArm.rotation.y = 0;
      player.skin.rightArm.rotation.z = -0.05;
      return;
    }

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
  | "walk"
  | "run"
  | "wave"
  | "hit"
  | "sneak"
  | "look"
  | "cool"
  | "glide"
  | "victory"
  | "sleep"
  | "dance"
  | "dab"
  | "think"
  | "hello"
  | "sad";

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

export function createSkinAnimation(id: SkinAnimId): SkinAnimation {
  // Процедурные позы (идея SPE, без сырых ключей Emotecraft)
  switch (id) {
    case "walk":
      return new WalkCycleAnimation();
    case "run":
      return new TrailerRunAnimation();
    case "hit":
      return new HitAnimation();
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
