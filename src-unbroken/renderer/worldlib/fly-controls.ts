// Свободная камера для окна просмотра мира: WASD + мышь.
//
// Конвенция углов minecraft-renderer (как в geometryExport / playground):
//   forward = (-sin(yaw)*cos(pitch), sin(pitch), -cos(yaw)*cos(pitch))
//   yaw=0 → взгляд на −Z (север MC), pitch>0 → взгляд вверх.
//
// NBT Minecraft Rotation (градусы):
//   yaw=0 → юг (+Z), растёт по часовой; pitch>0 → взгляд вниз.
//
// Перевод (как в классическом prismarine-viewer: Math.PI - yaw):
//   rendererYaw   = π − mcYaw
//   rendererPitch = −mcPitch
//
// Производительность: углы обновляются на mousemove, updateCamera — раз за кадр.
// При повороте без перемещения в updateCamera уходит pos=null (дешевле).

import { Vec3 } from 'vec3';

export interface FlyCamera {
  /** Позиция глаз в мире (уже с eye-offset). */
  pos: Vec3;
  /** Радианы рендерера: 0 = север (−Z). */
  yaw: number;
  /** Радианы рендерера: 0 = горизонт, положительный = вверх. */
  pitch: number;
}

export interface FlyControlsOptions {
  camera: FlyCamera;
  canvas: HTMLElement;
  /** lookOnly=true → только yaw/pitch, позицию не слать. */
  applyCamera: (cam: FlyCamera, lookOnly: boolean) => void;
  onMove?: (cam: FlyCamera) => void;
  baseSpeed?: number;
}

const EYE_OFFSET = 1.62;
const PITCH_LIMIT = Math.PI / 2 - 0.01;
const GAME_CODES = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'Space', 'ShiftLeft', 'ShiftRight',
  'KeyR',
  'ControlLeft', 'ControlRight',
]);

/**
 * Градусы Rotation из NBT → радианы для updateCamera().
 * Не путать с mcYaw+π: на восток/запад это зеркалит взгляд.
 */
export function rotationFromMinecraftDegrees(yawDeg: number, pitchDeg: number): { yaw: number; pitch: number } {
  const mcYaw = (yawDeg * Math.PI) / 180;
  const mcPitch = (pitchDeg * Math.PI) / 180;
  return {
    yaw: Math.PI - mcYaw,
    pitch: Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, -mcPitch)),
  };
}

/** Камера на глазах игрока: Pos в NBT — ноги. */
export function cameraFromPlayerFeet(
  feet: { x: number; y: number; z: number },
  yaw = 0,
  pitch = 0,
): FlyCamera {
  return {
    pos: new Vec3(feet.x, feet.y + EYE_OFFSET, feet.z),
    yaw,
    pitch: Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch)),
  };
}

export { EYE_OFFSET };

function moveBasis(yaw: number): { fwdX: number; fwdZ: number; rightX: number; rightZ: number } {
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  return {
    fwdX: -sin,
    fwdZ: -cos,
    rightX: cos,
    rightZ: -sin,
  };
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function attachFlyControls(opts: FlyControlsOptions): () => void {
  const cam = opts.camera;
  const speedBase = opts.baseSpeed ?? 12;
  const keys = new Set<string>();
  let pointerLocked = false;
  let raf = 0;
  let lastTs = performance.now();
  let movedSinceNotify = false;
  let onMoveAcc = 0;
  let ignoreMouseUntil = 0;
  /** Нужен вызов applyCamera в конце кадра. */
  let camDirty = true;
  let lookDirty = false;
  let posDirty = false;

  const hint = document.createElement('div');
  hint.id = 'fly-hint';
  hint.textContent = 'ЛКМ по миру — мышь · WASD — полёт · Space/Shift — вверх/вниз · R — быстрее · Ctrl — медленнее · Esc — отпустить';
  Object.assign(hint.style, {
    position: 'absolute',
    left: '50%',
    bottom: '18px',
    transform: 'translateX(-50%)',
    zIndex: '30',
    padding: '8px 14px',
    borderRadius: '8px',
    background: 'rgba(12,14,18,0.78)',
    border: '1px solid #2b3038',
    color: '#c8cfd8',
    font: "12px/1.4 Consolas, 'Courier New', monospace",
    pointerEvents: 'none',
    maxWidth: '90%',
    textAlign: 'center',
  } as CSSStyleDeclaration);
  document.body.appendChild(hint);

  const capture = document.createElement('div');
  capture.id = 'fly-capture';
  Object.assign(capture.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '5',
    cursor: 'crosshair',
    background: 'transparent',
  } as CSSStyleDeclaration);
  document.body.appendChild(capture);

  const panel = document.getElementById('panel');
  if (panel) {
    panel.style.zIndex = '15';
    panel.style.pointerEvents = 'auto';
  }

  const requestLock = () => {
    if (document.pointerLockElement === capture) return;
    try {
      capture.requestPointerLock();
    } catch {
      try { opts.canvas.requestPointerLock?.(); } catch { /* */ }
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (isTypingTarget(e.target)) return;
    if (!GAME_CODES.has(e.code) && e.code !== 'Escape') return;
    if (e.code === 'Escape' && pointerLocked) {
      document.exitPointerLock();
      return;
    }
    keys.add(e.code);
    if (GAME_CODES.has(e.code)) e.preventDefault();
  };
  const onKeyUp = (e: KeyboardEvent) => {
    keys.delete(e.code);
    if (GAME_CODES.has(e.code)) e.preventDefault();
  };

  const onCaptureClick = (e: MouseEvent) => {
    e.preventDefault();
    requestLock();
  };

  const onPointerLock = () => {
    const locked = document.pointerLockElement === capture
      || document.pointerLockElement === opts.canvas;
    if (locked && !pointerLocked) ignoreMouseUntil = performance.now() + 120;
    pointerLocked = locked;
    hint.style.opacity = pointerLocked ? '0.35' : '1';
    capture.style.cursor = pointerLocked ? 'none' : 'crosshair';
  };

  const onMouseMove = (e: MouseEvent) => {
    if (!pointerLocked) return;
    if (performance.now() < ignoreMouseUntil) return;
    if (Math.abs(e.movementX) > 80 || Math.abs(e.movementY) > 80) return;
    const sens = 0.0022;
    cam.yaw -= e.movementX * sens;
    cam.pitch -= e.movementY * sens;
    cam.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, cam.pitch));
    // Только помечаем грязным — updateCamera раз за кадр.
    camDirty = true;
    lookDirty = true;
  };

  const tick = (ts: number) => {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;

    let forward = 0;
    let strafe = 0;
    let vertical = 0;
    if (keys.has('KeyW')) forward += 1;
    if (keys.has('KeyS')) forward -= 1;
    if (keys.has('KeyD')) strafe += 1;
    if (keys.has('KeyA')) strafe -= 1;
    if (keys.has('Space')) vertical += 1;
    if (keys.has('ShiftLeft') || keys.has('ShiftRight')) vertical -= 1;

    const moving = forward !== 0 || strafe !== 0 || vertical !== 0;
    if (moving) {
      let speed = speedBase;
      if (keys.has('ControlLeft') || keys.has('ControlRight')) speed *= 0.35;
      if (keys.has('KeyR')) speed *= 3;

      const { fwdX, fwdZ, rightX, rightZ } = moveBasis(cam.yaw);
      let dx = forward * fwdX + strafe * rightX;
      let dz = forward * fwdZ + strafe * rightZ;
      const len = Math.hypot(dx, dz);
      if (len > 0) {
        dx = (dx / len) * speed * dt;
        dz = (dz / len) * speed * dt;
        cam.pos.x += dx;
        cam.pos.z += dz;
      }
      cam.pos.y += vertical * speed * dt;
      camDirty = true;
      posDirty = true;
      movedSinceNotify = true;
      onMoveAcc += dt;
      if (onMoveAcc >= 0.35) {
        onMoveAcc = 0;
        opts.onMove?.(cam);
      }
    } else if (movedSinceNotify) {
      opts.onMove?.(cam);
      movedSinceNotify = false;
      onMoveAcc = 0;
    }

    if (camDirty) {
      // lookOnly: не гоняем sceneOrigin/tween позиции на каждый поворот мыши.
      opts.applyCamera(cam, lookDirty && !posDirty);
      camDirty = false;
      lookDirty = false;
      posDirty = false;
    }
  };

  capture.addEventListener('click', onCaptureClick);
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  document.addEventListener('pointerlockchange', onPointerLock);
  document.addEventListener('mousemove', onMouseMove);
  opts.applyCamera(cam, false);
  raf = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(raf);
    capture.removeEventListener('click', onCaptureClick);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('keyup', onKeyUp, true);
    document.removeEventListener('pointerlockchange', onPointerLock);
    document.removeEventListener('mousemove', onMouseMove);
    hint.remove();
    capture.remove();
    if (document.pointerLockElement === capture || document.pointerLockElement === opts.canvas) {
      document.exitPointerLock();
    }
  };
}
