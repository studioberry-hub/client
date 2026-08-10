// Панели управления камерой и светом для демо SkinViewEngine
import {
  DEFAULT_CAMERA_SETTINGS,
  DEFAULT_LIGHT_SETTINGS,
  SkinViewEngine,
  type CameraSettings,
  type LightSettings,
} from "../../src/index.ts";

const STORAGE_KEY = "skinviewengine-demo-settings-v5";

/** Старый дефолт skin3d adjustCameraDistance при fov 20 / zoom 1.16 */
const LEGACY_FORMULA_DISTANCE = 85;

interface PersistedSettings {
  camera: Partial<CameraSettings>;
  lights: Partial<LightSettings>;
}

/** Снимок камеры с подстановкой дефолтов движка */
function resolveCameraSettings(raw: Partial<CameraSettings>): CameraSettings {
  return { ...DEFAULT_CAMERA_SETTINGS, ...raw };
}

/** Снимок света с подстановкой дефолтов движка */
function resolveLightSettings(raw: Partial<LightSettings>): LightSettings {
  return { ...DEFAULT_LIGHT_SETTINGS, ...raw };
}

const fmt2 = (value: number | undefined, fallback = 0): string =>
  (value ?? fallback).toFixed(2);

const fmt1 = (value: number | undefined, fallback = 0): string =>
  (value ?? fallback).toFixed(1);

/** Привязка range/checkbox к числовому значению с форматированием */
function bindRange(
  input: HTMLInputElement,
  valueEl: HTMLElement | null,
  format: (v: number) => string,
  onChange: (v: number) => void,
  runInitialSync = true,
): void {
  const sync = (): void => {
    const value = Number(input.value);
    if (valueEl) valueEl.textContent = format(value);
    onChange(value);
  };
  input.addEventListener("input", sync);
  if (runInitialSync) sync();
}

function bindCheckbox(input: HTMLInputElement, onChange: (v: boolean) => void): void {
  input.addEventListener("change", () => onChange(input.checked));
}

/** Панель камеры, света и манипуляции вьювера */
export function initViewerControls(engine: SkinViewEngine): void {
  try {
    initViewerControlsUnsafe(engine);
  } catch (err) {
    console.warn("[skinviewengine] панель управления недоступна:", err);
  }
}

function initViewerControlsUnsafe(engine: SkinViewEngine): void {
  // ===== Камера =====
  const fovInput = document.getElementById("cam-fov") as HTMLInputElement;
  const fovVal = document.getElementById("cam-fov-val");
  const zoomInput = document.getElementById("cam-zoom") as HTMLInputElement;
  const zoomVal = document.getElementById("cam-zoom-val");
  const distInput = document.getElementById("cam-distance") as HTMLInputElement;
  const distVal = document.getElementById("cam-distance-val");
  const targetYInput = document.getElementById("cam-target-y") as HTMLInputElement;
  const targetYVal = document.getElementById("cam-target-y-val");
  const minPolarInput = document.getElementById("cam-min-polar") as HTMLInputElement;
  const minPolarVal = document.getElementById("cam-min-polar-val");
  const maxPolarInput = document.getElementById("cam-max-polar") as HTMLInputElement;
  const maxPolarVal = document.getElementById("cam-max-polar-val");
  const autoRotateInput = document.getElementById("cam-auto-rotate") as HTMLInputElement;
  const btnResetCamera = document.getElementById("btn-reset-camera");

  // ===== Свет =====
  const keyAzInput = document.getElementById("light-key-az") as HTMLInputElement;
  const keyAzVal = document.getElementById("light-key-az-val");
  const keyElInput = document.getElementById("light-key-el") as HTMLInputElement;
  const keyElVal = document.getElementById("light-key-el-val");
  const keyIntInput = document.getElementById("light-key-int") as HTMLInputElement;
  const keyIntVal = document.getElementById("light-key-int-val");
  const ambIntInput = document.getElementById("light-amb-int") as HTMLInputElement;
  const ambIntVal = document.getElementById("light-amb-int-val");
  const fillIntInput = document.getElementById("light-fill-int") as HTMLInputElement;
  const fillIntVal = document.getElementById("light-fill-int-val");
  const shadowRadInput = document.getElementById("light-shadow-rad") as HTMLInputElement;
  const shadowRadVal = document.getElementById("light-shadow-rad-val");
  const shadowIntInput = document.getElementById("light-shadow-int") as HTMLInputElement;
  const shadowIntVal = document.getElementById("light-shadow-int-val");
  const castShadowInput = document.getElementById("light-cast-shadow") as HTMLInputElement;
  const btnResetLights = document.getElementById("btn-reset-lights");

  let syncing = false;

  const persist = (): void => {
    if (syncing) return;
    try {
      const payload: PersistedSettings = {
        camera: engine.getCameraSettings(),
        lights: engine.getLightSettings(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // localStorage может быть недоступен
    }
  };

  const syncUiFromEngine = (): void => {
    syncing = true;

    const cam = resolveCameraSettings(engine.getCameraSettings());
    fovInput.value = String(cam.fov);
    if (fovVal) fovVal.textContent = `${Math.round(cam.fov)}°`;
    zoomInput.value = String(cam.zoom);
    if (zoomVal) zoomVal.textContent = fmt2(cam.zoom, DEFAULT_CAMERA_SETTINGS.zoom);
    distInput.value = String(Math.round(cam.distance));
    if (distVal) distVal.textContent = `${Math.round(cam.distance)}`;
    targetYInput.value = String(cam.lookTargetY);
    if (targetYVal) targetYVal.textContent = fmt1(cam.lookTargetY, DEFAULT_CAMERA_SETTINGS.lookTargetY);
    minPolarInput.value = String(Math.round(cam.minPolarAngleDeg));
    if (minPolarVal) minPolarVal.textContent = `${Math.round(cam.minPolarAngleDeg)}°`;
    maxPolarInput.value = String(Math.round(cam.maxPolarAngleDeg));
    if (maxPolarVal) maxPolarVal.textContent = `${Math.round(cam.maxPolarAngleDeg)}°`;
    autoRotateInput.checked = cam.autoRotate;

    const lights = resolveLightSettings(engine.getLightSettings());
    keyAzInput.value = String(Math.round(lights.keyAzimuthDeg));
    if (keyAzVal) keyAzVal.textContent = `${Math.round(lights.keyAzimuthDeg)}°`;
    keyElInput.value = String(Math.round(lights.keyElevationDeg));
    if (keyElVal) keyElVal.textContent = `${Math.round(lights.keyElevationDeg)}°`;
    keyIntInput.value = String(lights.keyIntensity);
    if (keyIntVal) keyIntVal.textContent = fmt2(lights.keyIntensity, DEFAULT_LIGHT_SETTINGS.keyIntensity);
    ambIntInput.value = String(lights.ambientIntensity);
    if (ambIntVal) ambIntVal.textContent = fmt2(lights.ambientIntensity, DEFAULT_LIGHT_SETTINGS.ambientIntensity);
    fillIntInput.value = String(lights.fillIntensity);
    if (fillIntVal) fillIntVal.textContent = fmt2(lights.fillIntensity, DEFAULT_LIGHT_SETTINGS.fillIntensity);
    shadowRadInput.value = String(lights.shadowRadius);
    if (shadowRadVal) shadowRadVal.textContent = String(Math.round(lights.shadowRadius));
    shadowIntInput.value = String(lights.shadowIntensity);
    if (shadowIntVal) shadowIntVal.textContent = fmt2(lights.shadowIntensity, DEFAULT_LIGHT_SETTINGS.shadowIntensity);
    castShadowInput.checked = lights.castShadows;

    syncing = false;
  };

  const sanitizePersistedCamera = (
    camera: Partial<CameraSettings>,
  ): Partial<CameraSettings> => {
    if (camera.distance === undefined) return camera;
    const rounded = Math.round(camera.distance);
    if (rounded >= LEGACY_FORMULA_DISTANCE - 2 && rounded <= LEGACY_FORMULA_DISTANCE + 2) {
      const { distance: _legacy, ...rest } = camera;
      return rest;
    }
    return camera;
  };

  const loadPersisted = (): void => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as PersistedSettings;
      if (data.camera) engine.applyCameraSettings(sanitizePersistedCamera(data.camera));
      if (data.lights) engine.applyLightSettings(data.lights);
    } catch {
      // игнорируем битый JSON
    }
  };

  // Первый кадр UI — дефолты движка (110) до localStorage
  syncUiFromEngine();

  const deferInitialSync = false;

  // ===== Привязки камеры =====
  bindRange(fovInput, fovVal, (v) => `${Math.round(v)}°`, (v) => {
    engine.setCameraFov(v);
    persist();
  }, deferInitialSync);

  bindRange(zoomInput, zoomVal, (v) => v.toFixed(2), (v) => {
    engine.setZoom(v);
    persist();
  }, deferInitialSync);

  bindRange(distInput, distVal, (v) => `${Math.round(v)}`, (v) => {
    engine.setCameraDistance(v);
    persist();
  }, deferInitialSync);

  bindRange(targetYInput, targetYVal, (v) => v.toFixed(1), (v) => {
    engine.setLookTargetY(v);
    persist();
  }, deferInitialSync);

  bindRange(minPolarInput, minPolarVal, (v) => `${Math.round(v)}°`, (v) => {
    const polar = engine.getPolarLimitsDeg();
    engine.setPolarLimitsDeg(v, polar.max);
    persist();
  }, deferInitialSync);

  bindRange(maxPolarInput, maxPolarVal, (v) => `${Math.round(v)}°`, (v) => {
    const polar = engine.getPolarLimitsDeg();
    engine.setPolarLimitsDeg(polar.min, v);
    persist();
  }, deferInitialSync);

  bindCheckbox(autoRotateInput, (v) => {
    engine.setAutoRotate(v);
    persist();
  });

  btnResetCamera?.addEventListener("click", () => {
    engine.resetCamera();
    syncUiFromEngine();
    persist();
  });

  // ===== Привязки света =====
  bindRange(keyAzInput, keyAzVal, (v) => `${Math.round(v)}°`, (v) => {
    const { elevationDeg } = engine.lighting.getKeyAzimuthElevation();
    engine.lighting.setKeyLightAzimuthElevation(v, elevationDeg);
    persist();
  }, deferInitialSync);

  bindRange(keyElInput, keyElVal, (v) => `${Math.round(v)}°`, (v) => {
    const { azimuthDeg } = engine.lighting.getKeyAzimuthElevation();
    engine.lighting.setKeyLightAzimuthElevation(azimuthDeg, v);
    persist();
  }, deferInitialSync);

  bindRange(keyIntInput, keyIntVal, (v) => v.toFixed(2), (v) => {
    engine.lighting.setKeyLightIntensity(v);
    persist();
  }, deferInitialSync);

  bindRange(ambIntInput, ambIntVal, (v) => v.toFixed(2), (v) => {
    engine.lighting.setAmbientIntensity(v);
    persist();
  }, deferInitialSync);

  bindRange(fillIntInput, fillIntVal, (v) => v.toFixed(2), (v) => {
    engine.lighting.setFillIntensity(v);
    persist();
  }, deferInitialSync);

  bindRange(shadowRadInput, shadowRadVal, (v) => String(Math.round(v)), (v) => {
    engine.lighting.setShadowRadius(v);
    persist();
  }, deferInitialSync);

  bindRange(shadowIntInput, shadowIntVal, (v) => v.toFixed(2), (v) => {
    engine.lighting.setShadowIntensity(v);
    persist();
  }, deferInitialSync);

  bindCheckbox(castShadowInput, (v) => {
    engine.lighting.setCastShadows(v);
    persist();
  });

  btnResetLights?.addEventListener("click", () => {
    engine.resetLighting();
    syncUiFromEngine();
    persist();
  });

  // Синхронизация дистанции при колёсике / орбите
  engine.controls.addEventListener("change", () => {
    if (syncing) return;
    distInput.value = String(Math.round(engine.getCameraDistance()));
    if (distVal) distVal.textContent = `${Math.round(engine.getCameraDistance())}`;
    persist();
  });

  loadPersisted();
  syncUiFromEngine(); // после localStorage — финальная синхронизация UI

  // Экспорт дефолтов для отладки в консоли
  (window as unknown as { __skinviewDefaults?: unknown }).__skinviewDefaults = {
    camera: DEFAULT_CAMERA_SETTINGS,
    lights: DEFAULT_LIGHT_SETTINGS,
  };
}
