// Конвертация ModelPart Euler (Emotecraft) → Three.js через Flip(1,−1,−1)
import { Euler, Matrix4, Quaternion } from "three";

const FLIP_YZ = new Matrix4().makeScale(1, -1, -1);
const _m = new Matrix4();
const _e = new Euler();
const _q = new Quaternion();

/**
 * Сопряжение euler ModelPart через MC entity Flip(1,−1,−1).
 * Как в EmoteCraftTSViewer / minecraft-rotation.ts.
 */
export function minecraftEulerToThree(
  pitch: number,
  yaw: number,
  roll: number,
): [number, number, number] {
  _e.set(pitch, yaw, roll, "ZYX");
  _m.makeRotationFromEuler(_e);
  _m.premultiply(FLIP_YZ);
  _m.multiply(FLIP_YZ);
  _q.setFromRotationMatrix(_m);
  _e.setFromQuaternion(_q, "ZYX");
  return [_e.x, _e.y, _e.z];
}

/** Смещение позиции ModelPart → Three.js: (x, −y, −z) */
export function flipYzPosition(x: number, y: number, z: number): [number, number, number] {
  return [x, -y, -z];
}
