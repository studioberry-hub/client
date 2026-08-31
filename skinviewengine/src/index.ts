// Публичный API skinviewengine — Three.js-обёртка над skin3d PlayerObject
export { SkinViewEngine, DEFAULT_CAMERA_SETTINGS } from "./core/scene-loop.js";
export {
  buildSkinUrlsByUsername,
  EmptyUsernameError,
  normalizeUsername,
} from "./core/skin-username.js";
export { DEFAULT_LIGHT_SETTINGS, ProductLighting } from "./core/product-visuals.js";
export {
  computeVisibleBounds,
  fitObjectToFrame,
  measureObjectFrame,
  type FrameFitOptions,
  type FrameFitResult,
  type FrameMeasure,
  type NdcBox,
} from "./core/camera-framing.js";
export {
  HeroIdleAnimation,
  TrailerRunAnimation,
  BustPoseAnimation,
  WaveHelloAnimation,
  SneakAnimation,
  LookAroundAnimation,
  CoolPoseAnimation,
  GlideAnimation,
  VictoryAnimation,
  SleepAnimation,
  SadAnimation,
  DanceAnimation,
  DabAnimation,
  ThinkAnimation,
  HelloNodAnimation,
  createSkinAnimation,
  animationControlsLegs,
  resetPlayerRootPose,
  type SkinAnimation,
  type SkinAnimId,
  type ShotPresetId,
} from "./core/skin-animations.js";
export {
  SkinModelType,
  DEFAULT_SKIN_DEBUG_OPTIONS,
  type EngineOptions,
  type SkinSource,
  type CameraSettings,
  type LightSettings,
  type PresentationMode,
  type SkinDebugStats,
  type SkinDebugOptions,
} from "./types.js";

export {
  EmoteClipAnimation,
  type EmoteClip,
  type EmoteFrame,
  type EmotePartPose,
} from "./core/emote-animation.js";
export { BendableSkeleton } from "./core/bendable-skeleton.js";
export {
  locatorColorFromUuid,
  javaUuidHashCode,
  normalizeMinecraftUuid,
  type LocatorColor,
} from "./core/locator-color.js";

// Анимации skin3d (idle, walk и др.) — совместимы с PlayerObject
export {
  IdleAnimation,
  WalkingAnimation as WalkAnimation,
  RunningAnimation,
  PlayerAnimation,
} from "skin3d";
