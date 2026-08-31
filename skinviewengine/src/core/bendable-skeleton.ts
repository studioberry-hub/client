// Скелет Emotecraft: половины конечностей + bend-сустав (аналог bendy-lib)
import {
  BoxGeometry,
  BufferAttribute,
  Group,
  Mesh,
  Vector3,
  type Material,
} from "three";
import {
  STOCK_LEFT_LEG_POSE,
  STOCK_LEG_INNER_SIZE,
  STOCK_LEG_OUTER_SIZE,
  STOCK_RIGHT_LEG_POSE,
} from "./skin-leg-stock.js";
import { SKIN_TEXTURE_SIZE } from "./skin-uv-inset.js";

export type BendPartName = "body" | "leftArm" | "rightArm" | "leftLeg" | "rightLeg";

/** Rest-позиции частей в локали SkinObject (после product leg pose) */
export const SKIN_REST_POS = {
  head: { x: 0, y: 0, z: 0 },
  body: { x: 0, y: -6, z: 0 },
  rightArm: { x: -5, y: -2, z: 0 },
  leftArm: { x: 5, y: -2, z: 0 },
  rightLeg: { ...STOCK_RIGHT_LEG_POSE },
  leftLeg: { ...STOCK_LEFT_LEG_POSE },
} as const;

type HalfKind = "upper" | "lower";

interface LimbUV {
  inner: { u: number; v: number; w: number; h: number; d: number };
  outer: { u: number; v: number; w: number; h: number; d: number };
}

interface BendLimbState {
  bendJoint: Group;
  upperInner: Mesh;
  upperOuter: Mesh;
  lowerInner: Mesh;
  lowerOuter: Mesh;
  stockInner: Mesh;
  stockOuter: Mesh;
  pivot: Group;
}

const AXIS_TMP = new Vector3();

// ===== UV половин конечности =====

function setHalfLimbUVs(
  box: BoxGeometry,
  u: number,
  v: number,
  width: number,
  height: number,
  depth: number,
  half: HalfKind,
  textureSize: number = SKIN_TEXTURE_SIZE,
): void {
  const h0 = half === "upper" ? 0 : height / 2;
  const h1 = half === "upper" ? height / 2 : height;
  const mid = height / 2;

  const toFaceVertices = (x1: number, y1: number, x2: number, y2: number) => [
    [x1 / textureSize, 1.0 - y2 / textureSize],
    [x2 / textureSize, 1.0 - y2 / textureSize],
    [x2 / textureSize, 1.0 - y1 / textureSize],
    [x1 / textureSize, 1.0 - y1 / textureSize],
  ];

  const top =
    half === "upper"
      ? toFaceVertices(u + depth, v, u + width + depth, v + depth)
      : toFaceVertices(
          u + depth,
          v + depth + mid - 0.01,
          u + width + depth,
          v + depth + mid + 0.01,
        );
  const bottom =
    half === "lower"
      ? toFaceVertices(u + width + depth, v, u + width * 2 + depth, v + depth)
      : toFaceVertices(
          u + depth,
          v + depth + mid - 0.01,
          u + width + depth,
          v + depth + mid + 0.01,
        );

  const left = toFaceVertices(u, v + depth + h0, u + depth, v + depth + h1);
  const front = toFaceVertices(u + depth, v + depth + h0, u + width + depth, v + depth + h1);
  const right = toFaceVertices(
    u + width + depth,
    v + depth + h0,
    u + width + depth * 2,
    v + depth + h1,
  );
  const back = toFaceVertices(
    u + width + depth * 2,
    v + depth + h0,
    u + width * 2 + depth * 2,
    v + depth + h1,
  );

  const uvAttr = box.attributes.uv as BufferAttribute;
  if (!uvAttr) return;

  const uvRight = [right[3], right[2], right[0], right[1]];
  const uvLeft = [left[3], left[2], left[0], left[1]];
  const uvTop = [top[3], top[2], top[0], top[1]];
  const uvBottom = [bottom[0], bottom[1], bottom[3], bottom[2]];
  const uvFront = [front[3], front[2], front[0], front[1]];
  const uvBack = [back[3], back[2], back[0], back[1]];

  const data: number[] = [];
  for (const face of [uvRight, uvLeft, uvTop, uvBottom, uvFront, uvBack]) {
    for (const uv of face) data.push(uv[0], uv[1]);
  }
  uvAttr.set(new Float32Array(data));
  uvAttr.needsUpdate = true;
}

function limbUV(slim: boolean): Record<BendPartName, LimbUV> {
  const armW = slim ? 3 : 4;
  return {
    body: {
      inner: { u: 16, v: 16, w: 8, h: 12, d: 4 },
      outer: { u: 16, v: 32, w: 8, h: 12, d: 4 },
    },
    rightArm: {
      inner: { u: 40, v: 16, w: armW, h: 12, d: 4 },
      outer: { u: 40, v: 32, w: armW, h: 12, d: 4 },
    },
    leftArm: {
      inner: { u: 32, v: 48, w: armW, h: 12, d: 4 },
      outer: { u: 48, v: 48, w: armW, h: 12, d: 4 },
    },
    rightLeg: {
      inner: { u: 0, v: 16, w: 4, h: 12, d: 4 },
      outer: { u: 0, v: 32, w: 4, h: 12, d: 4 },
    },
    leftLeg: {
      inner: { u: 16, v: 48, w: 4, h: 12, d: 4 },
      outer: { u: 0, v: 48, w: 4, h: 12, d: 4 },
    },
  };
}

function ensurePivot(part: any, fallbackY: number): Group {
  const inner = part.innerLayer as Mesh;
  const parent = inner.parent as Group | null;
  if (parent && parent !== part) {
    return parent;
  }
  const pivot = new Group();
  pivot.name = "bendPivot";
  pivot.position.y = fallbackY;
  part.add(pivot);
  pivot.add(inner);
  if (part.outerLayer.parent === part) pivot.add(part.outerLayer);
  return pivot;
}

function makeHalfMesh(
  source: Mesh,
  size: [number, number, number],
  uv: { u: number; v: number; w: number; h: number; d: number },
  half: HalfKind,
  y: number,
  useUnitScale: boolean,
): Mesh {
  const geom = new BoxGeometry(
    useUnitScale ? 1 : size[0],
    useUnitScale ? 1 : size[1],
    useUnitScale ? 1 : size[2],
  );
  setHalfLimbUVs(geom, uv.u, uv.v, uv.w, uv.h, uv.d, half);
  // Схлопываем срез — иначе «крышка» стыка видна как щель
  collapseCutFace(geom, half === "upper" ? "bottom" : "top");

  const mesh = new Mesh(geom, source.material as Material);
  mesh.name = `${source.name || "limb"}_${half}`;
  mesh.castShadow = source.castShadow;
  mesh.receiveShadow = source.receiveShadow;
  mesh.renderOrder = source.renderOrder;
  mesh.position.set(0, y, 0);
  if (useUnitScale) {
    mesh.scale.set(size[0], size[1], size[2]);
  } else {
    mesh.scale.set(1, 1, 1);
  }
  return mesh;
}

/** Схлопнуть грань среза в центр (EmoteCraftTSViewer collapseFace) */
function collapseCutFace(geometry: BoxGeometry, face: "top" | "bottom"): void {
  const faceIndex = face === "top" ? 2 : 3; // BoxGeometry: right left top bottom front back
  const pos = geometry.attributes.position as BufferAttribute;
  const base = faceIndex * 4;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < 4; i++) {
    cx += pos.getX(base + i);
    cy += pos.getY(base + i);
    cz += pos.getZ(base + i);
  }
  cx *= 0.25;
  cy *= 0.25;
  cz *= 0.25;
  for (let i = 0; i < 4; i++) pos.setXYZ(base + i, cx, cy, cz);
  pos.needsUpdate = true;
}

/**
 * Управляет bend-суставами на SkinObject.
 * При bend=0 половины смыкаются в цельный куб — совместимо с обычными анимациями.
 */
export class BendableSkeleton {
  private _slim = false;
  private _limbs = new Map<BendPartName, BendLimbState>();
  private _installed = false;

  get installed(): boolean {
    return this._installed;
  }

  /** Установить/переустановить скелет после смены скина или slim */
  install(skin: any, slim: boolean): void {
    if (this._installed && this._slim === slim) {
      this.resetBends();
      return;
    }
    this.uninstall();
    this._slim = slim;
    const uvs = limbUV(slim);

    this._installBody(skin.body, uvs.body);
    this._installArm(skin.rightArm, uvs.rightArm, "rightArm", slim);
    this._installArm(skin.leftArm, uvs.leftArm, "leftArm", slim);
    this._installLeg(skin.rightLeg, uvs.rightLeg, "rightLeg");
    this._installLeg(skin.leftLeg, uvs.leftLeg, "leftLeg");

    this._installed = true;
    this.resetBends();
  }

  uninstall(): void {
    for (const state of this._limbs.values()) {
      state.bendJoint.removeFromParent();
      state.upperInner.removeFromParent();
      state.upperOuter.removeFromParent();
      state.lowerInner.geometry.dispose();
      state.lowerOuter.geometry.dispose();
      state.upperInner.geometry.dispose();
      state.upperOuter.geometry.dispose();

      state.stockInner.visible = true;
      state.stockOuter.visible = true;
      if (state.stockInner.parent !== state.pivot) {
        state.pivot.add(state.stockInner);
      }
      if (state.stockOuter.parent !== state.pivot) {
        state.pivot.add(state.stockOuter);
      }
    }
    this._limbs.clear();
    this._installed = false;
  }

  /** Сброс всех сгибов */
  resetBends(): void {
    for (const state of this._limbs.values()) {
      state.bendJoint.quaternion.identity();
      state.bendJoint.rotation.set(0, 0, 0);
    }
  }

  /**
   * Emotecraft bend (как EmoteCraftTSViewer / bendy-lib).
   * axis≈0 → сгиб вокруг локального X; иначе ось в плоскости XZ.
   */
  setBend(part: BendPartName, bend: number, axis: number = 0): void {
    const state = this._limbs.get(part);
    if (!state) return;
    state.bendJoint.rotation.set(0, 0, 0);
    state.bendJoint.quaternion.identity();
    if (Math.abs(bend) < 1e-5) return;

    // Числовой axis из SPE/bendy-lib; 0 = X (как строковый "x" в EmoteCraftTSViewer)
    if (Math.abs(axis) < 1e-5) {
      state.bendJoint.rotation.x = bend;
      return;
    }
    AXIS_TMP.set(Math.cos(axis), 0, Math.sin(axis)).normalize();
    state.bendJoint.quaternion.setFromAxisAngle(AXIS_TMP, bend);
  }

  private _installArm(
    part: any,
    uv: LimbUV,
    name: "leftArm" | "rightArm",
    slim: boolean,
  ): void {
    const pivot = ensurePivot(part, -4);
    const armW = slim ? 3 : 4;
    const innerSize: [number, number, number] = [armW, 6, 4];
    const outerSize: [number, number, number] = [slim ? 3.5 : 4.5, 6.5, 4.5];
    this._splitLimb(part, pivot, uv, name, innerSize, outerSize, true);
  }

  private _installLeg(part: any, uv: LimbUV, name: "leftLeg" | "rightLeg"): void {
    const pivot = ensurePivot(part, -6);
    const innerSize: [number, number, number] = [
      STOCK_LEG_INNER_SIZE[0],
      6,
      STOCK_LEG_INNER_SIZE[2],
    ];
    const outerSize: [number, number, number] = [
      STOCK_LEG_OUTER_SIZE[0],
      6.25,
      STOCK_LEG_OUTER_SIZE[2],
    ];
    this._splitLimb(part, pivot, uv, name, innerSize, outerSize, false);
  }

  private _installBody(part: any, uv: LimbUV): void {
    let pivot = part.children.find(
      (c: any) => c instanceof Group && c.name === "bendPivot",
    ) as Group | undefined;
    if (!pivot) {
      pivot = new Group();
      pivot.name = "bendPivot";
      const inner = part.innerLayer as Mesh;
      const outer = part.outerLayer as Mesh;
      part.add(pivot);
      pivot.add(inner);
      pivot.add(outer);
    }
    this._splitLimb(part, pivot, uv, "body", [8, 6, 4], [8.5, 6.25, 4.5], false);
  }

  private _splitLimb(
    part: any,
    pivot: Group,
    uv: LimbUV,
    name: BendPartName,
    innerSize: [number, number, number],
    outerSize: [number, number, number],
    useUnitScale: boolean,
  ): void {
    const stockInner = part.innerLayer as Mesh;
    const stockOuter = part.outerLayer as Mesh;
    stockInner.visible = false;
    stockOuter.visible = false;

    const halfH = innerSize[1] / 2;
    const outerHalfH = outerSize[1] / 2;

    const upperInner = makeHalfMesh(
      stockInner,
      innerSize,
      uv.inner,
      "upper",
      halfH,
      useUnitScale,
    );
    const upperOuter = makeHalfMesh(
      stockOuter,
      outerSize,
      uv.outer,
      "upper",
      outerHalfH,
      useUnitScale,
    );

    const bendJoint = new Group();
    bendJoint.name = `${name}_bend`;
    bendJoint.position.set(0, 0, 0);

    const lowerInner = makeHalfMesh(
      stockInner,
      innerSize,
      uv.inner,
      "lower",
      -halfH,
      useUnitScale,
    );
    const lowerOuter = makeHalfMesh(
      stockOuter,
      outerSize,
      uv.outer,
      "lower",
      -outerHalfH,
      useUnitScale,
    );

    pivot.add(upperInner, upperOuter, bendJoint);
    bendJoint.add(lowerInner, lowerOuter);

    this._limbs.set(name, {
      bendJoint,
      upperInner,
      upperOuter,
      lowerInner,
      lowerOuter,
      stockInner,
      stockOuter,
      pivot,
    });
  }
}
