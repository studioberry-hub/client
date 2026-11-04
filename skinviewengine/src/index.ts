// Публичный API skinviewengine — Three.js-обёртка над skin3d PlayerObject
export { SkinViewEngine, DEFAULT_CAMERA_SETTINGS } from "./core/scene-loop.js";
export {
  buildSkinUrlsByUsername,
  EmptyUsernameError,
  normalizeUsername,
} from "./core/skin-username.js";
export {
  DEFAULT_LIGHT_SETTINGS,
  FLOOR_Y,
  ProductLighting,
  configureProductRenderer,
  createFloorAndContactShadow,
  createPlasticEnvironment,
  enableShadows,
  normalizeSkinDepthBias,
  setupSceneEnvironment,
  tuneSkinMaterials,
} from "./core/product-visuals.js";
export { OuterVoxelLayers } from "./core/skin-outer-voxel.js";
export {
  configureSkinCanvasTexture,
  padTextureEdgeRGB,
  sanitizeSkinCanvas,
} from "./core/skin-texture.js";
export { applySkinUVInsets } from "./core/skin-uv-inset.js";
export { SkinLineup, LineupActor, type SkinLineupOptions } from "./core/skin-lineup.js";
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
  HoverAnimation,
  TrailerRunAnimation,
  WalkCycleAnimation,
  HitAnimation,
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
