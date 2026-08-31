// Плеер Emotecraft-клипов: MC→Three как EmoteCraftTSViewer (euler Flip + relative xyz + bend)
import {
  flipYzPosition,
  minecraftEulerToThree,
} from "./minecraft-rotation.js";
import {
  BendableSkeleton,
  SKIN_REST_POS,
  type BendPartName,
} from "./bendable-skeleton.js";
import type { SkinAnimation } from "./skin-animations.js";

export type EmoteEase = "linear" | "easeIn" | "easeOut" | "easeInOut" | "constant";

export interface EmotePartPose {
  rx?: number;
  ry?: number;
  rz?: number;
  x?: number;
  y?: number;
  z?: number;
  bend?: number;
  axis?: number;
}

export interface EmoteFrame {
  tick: number;
  ease?: EmoteEase;
  parts: Partial<
    Record<"head" | "body" | "leftArm" | "rightArm" | "leftLeg" | "rightLeg", EmotePartPose>
  >;
}

/** Компактный клип Emotecraft (с bend / смещениями) */
export interface EmoteClip {
  schemaVersion: 2 | 1;
  id: string;
  name: string;
  tps: number;
  endTick: number;
  loop: boolean;
  returnTick?: number;
  frames: EmoteFrame[];
}

type PartName = "head" | "body" | "leftArm" | "rightArm" | "leftLeg" | "rightLeg";

const PARTS: PartName[] = ["head", "body", "leftArm", "rightArm", "leftLeg", "rightLeg"];
const BEND_PARTS: BendPartName[] = ["body", "leftArm", "rightArm", "leftLeg", "rightLeg"];

/** Rest ModelPart (пиксели MC), как HumanoidModel / Emotecraft */
const MC_REST: Record<PartName, { x: number; y: number; z: number }> = {
  head: { x: 0, y: 0, z: 0 },
  body: { x: 0, y: 0, z: 0 },
  rightArm: { x: -5, y: 2, z: 0 },
  leftArm: { x: 5, y: 2, z: 0 },
  rightLeg: { x: -1.9, y: 12, z: 0.1 },
  leftLeg: { x: 1.9, y: 12, z: 0.1 },
};

const CAPE_YAW = Math.PI;
const CAPE_REST_X = (10.8 * Math.PI) / 180;

/** Смягчение SPE: меньше «резины» на bend и меньшие смещения суставов */
const BEND_SCALE = 0.72;
const POS_SCALE = 0.55;
/** Лёгкое приглушение экстремальных углов плеч (ближе к ванильной читаемости) */
const ROT_SCALE = 0.88;

interface PartState {
  rx: number;
  ry: number;
  rz: number;
  x: number;
  y: number;
  z: number;
  bend: number;
  axis: number;
}

type PoseState = Record<PartName, PartState>;

function emptyPart(mc: { x: number; y: number; z: number }): PartState {
  return { rx: 0, ry: 0, rz: 0, x: mc.x, y: mc.y, z: mc.z, bend: 0, axis: 0 };
}

function emptyPose(): PoseState {
  return {
    head: emptyPart(MC_REST.head),
    body: emptyPart(MC_REST.body),
    leftArm: emptyPart(MC_REST.leftArm),
    rightArm: emptyPart(MC_REST.rightArm),
    leftLeg: emptyPart(MC_REST.leftLeg),
    rightLeg: emptyPart(MC_REST.rightLeg),
  };
}

function easeT(t: number, ease: EmoteEase = "linear"): number {
  if (ease === "constant") return 0;
  const x = Math.max(0, Math.min(1, t));
  switch (ease) {
    case "easeIn":
      return x * x;
    case "easeOut":
      return 1 - (1 - x) * (1 - x);
    case "easeInOut":
      return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
    default:
      return x;
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpPart(a: PartState, b: PartState, t: number): PartState {
  return {
    rx: lerp(a.rx, b.rx, t),
    ry: lerp(a.ry, b.ry, t),
    rz: lerp(a.rz, b.rz, t),
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    z: lerp(a.z, b.z, t),
    bend: lerp(a.bend, b.bend, t),
    axis: lerp(a.axis, b.axis, t),
  };
}

function applyFrameDelta(state: PoseState, frame: EmoteFrame): void {
  for (const part of PARTS) {
    const p = frame.parts[part];
    if (!p) continue;
    const s = state[part];
    if (typeof p.rx === "number") s.rx = p.rx;
    if (typeof p.ry === "number") s.ry = p.ry;
    if (typeof p.rz === "number") s.rz = p.rz;
    if (typeof p.x === "number") s.x = p.x;
    if (typeof p.y === "number") s.y = p.y;
    if (typeof p.z === "number") s.z = p.z;
    if (typeof p.bend === "number") s.bend = p.bend;
    if (typeof p.axis === "number") s.axis = p.axis;
  }
}

function buildPoseKeys(frames: EmoteFrame[]): {
  tick: number;
  ease: EmoteEase;
  pose: PoseState;
}[] {
  const sorted = [...frames].sort((a, b) => a.tick - b.tick);
  const state = emptyPose();
  const keys: { tick: number; ease: EmoteEase; pose: PoseState }[] = [];

  for (const f of sorted) {
    applyFrameDelta(state, f);
    keys.push({
      tick: f.tick,
      ease: f.ease ?? "linear",
      pose: {
        head: { ...state.head },
        body: { ...state.body },
        leftArm: { ...state.leftArm },
        rightArm: { ...state.rightArm },
        leftLeg: { ...state.leftLeg },
        rightLeg: { ...state.rightLeg },
      },
    });
  }
  return keys;
}

function samplePose(
  keys: { tick: number; ease: EmoteEase; pose: PoseState }[],
  tick: number,
): PoseState {
  if (!keys.length) return emptyPose();
  if (tick <= keys[0].tick) return keys[0].pose;
  const last = keys[keys.length - 1];
  if (tick >= last.tick) return last.pose;

  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (tick >= a.tick && tick <= b.tick) {
      const span = b.tick - a.tick;
      const u = span <= 1e-8 ? 0 : (tick - a.tick) / span;
      const k = easeT(u, a.ease);
      const pose = emptyPose();
      for (const part of PARTS) {
        pose[part] = lerpPart(a.pose[part], b.pose[part], k);
      }
      return pose;
    }
  }
  return last.pose;
}

/**
 * Анимация по клипу Emotecraft.
 * Позиции SPE — абсолютные ModelPart px → relative → Flip YZ → skin3d rest.
 * Углы — minecraftEulerToThree, order ZYX. Без compose с торсом (части-сиблинги).
 */
export class EmoteClipAnimation implements SkinAnimation {
  speed = 1;
  paused = false;
  progress = 0;
  readonly controlsLegs = true;

  private readonly _clip: EmoteClip;
  private readonly _keys: { tick: number; ease: EmoteEase; pose: PoseState }[];
  private _skeleton: BendableSkeleton | null = null;

  constructor(clip: EmoteClip) {
    this._clip = clip;
    this._keys = buildPoseKeys(clip.frames);
  }

  bindSkeleton(skeleton: BendableSkeleton | null): void {
    this._skeleton = skeleton;
  }

  update(player: any, deltaTime: number): void {
    if (this.paused) return;
    this.progress += deltaTime * this.speed;

    const tps = this._clip.tps || 20;
    let tick = this.progress * tps;
    const end = Math.max(1, this._clip.endTick);
    const ret = this._clip.returnTick ?? 0;

    if (this._clip.loop) {
      if (tick > end) {
        const span = Math.max(1, end - ret);
        tick = ret + ((tick - ret) % span);
      }
    } else {
      tick = Math.min(tick, end);
    }

    this._applyPose(player, samplePose(this._keys, tick));
  }

  private _applyPose(player: any, pose: PoseState): void {
    const skin = player.skin;

    for (const name of PARTS) {
      this._applyPart(skin[name], name, pose[name]);
    }

    const sk = this._skeleton;
    if (sk?.installed) {
      sk.resetBends();
      for (const name of BEND_PARTS) {
        const p = pose[name];
        sk.setBend(name, p.bend * BEND_SCALE, p.axis);
      }
    }

    player.cape.rotation.set(CAPE_REST_X, CAPE_YAW, 0);
  }

  private _applyPart(obj: any, name: PartName, p: PartState): void {
    const mc = MC_REST[name];
    const rest = SKIN_REST_POS[name];
    // Абсолютные px SPE → relative → Flip YZ → soft scale (меньше щелей у плеч)
    const [fx, fy, fz] = flipYzPosition(
      (p.x - mc.x) * POS_SCALE,
      (p.y - mc.y) * POS_SCALE,
      (p.z - mc.z) * POS_SCALE,
    );
    obj.position.set(rest.x + fx, rest.y + fy, rest.z + fz);

    const [rx, ry, rz] = minecraftEulerToThree(
      p.rx * ROT_SCALE,
      p.ry * ROT_SCALE,
      p.rz * ROT_SCALE,
    );
    obj.rotation.order = "ZYX";
    obj.rotation.set(rx, ry, rz);
  }
}
