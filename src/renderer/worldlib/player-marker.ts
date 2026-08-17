// Маркер игрока на точке сохранения: скин + ник над головой через entities minecraft-renderer.
// Ник рисуется canvas'ом с fontFamily «mojangles» — подставляем наш minecraft.ttf под этим именем.

import { Vec3 } from 'vec3';

/** Имя семейства, зашитое в minecraft-renderer для nametag игрока. */
export const NAMETAG_FONT_FAMILY = 'mojangles';
/** URL шрифта в схеме app://local/ (см. registerWorldProtocol). */
const NAMETAG_FONT_URL = 'fonts/minecraft/minecraft.ttf';

export interface PreviewPlayerOpts {
  feet: { x: number; y: number; z: number };
  /** Углы уже в конвенции рендерера (как у flyCam). */
  yaw: number;
  pitch: number;
  username: string;
  uuid?: string;
  skinDataUrl?: string;
}

let nametagFontReady: Promise<void> | null = null;

/** Грузит minecraft.ttf и регистрирует его как mojangles до отрисовки ника. */
export function ensureNametagFont(): Promise<void> {
  if (!nametagFontReady) {
    nametagFontReady = (async () => {
      const face = new FontFace(NAMETAG_FONT_FAMILY, `url("${NAMETAG_FONT_URL}")`, {
        style: 'normal',
        weight: '400',
      });
      const loaded = await face.load();
      (document.fonts as FontFaceSet & { add(font: FontFace): void }).add(loaded);
      await document.fonts.load(`48px ${NAMETAG_FONT_FAMILY}`);
    })().catch((err) => {
      nametagFontReady = null;
      throw err;
    });
  }
  return nametagFontReady;
}

/**
 * Ставит видимого игрока (не local playerEntity — тот скрыт в first person).
 * worldRenderer берётся из globalThis.world после startWorld.
 */
export async function spawnSavePlayerMarker(opts: PreviewPlayerOpts): Promise<boolean> {
  const wr = (globalThis as any).world;
  const entities = wr?.entities;
  if (!entities?.update) return false;

  try {
    await ensureNametagFont();
  } catch {
    // Без шрифта ник всё равно покажется системным fallback.
  }

  if (entities.entitiesOptions) {
    entities.entitiesOptions.fontFamily = NAMETAG_FONT_FAMILY;
  }

  const id = 'save-player';
  const pos = new Vec3(opts.feet.x, opts.feet.y, opts.feet.z);
  entities.update(
    {
      id,
      name: 'player',
      pos,
      position: pos,
      width: 0.6,
      height: 1.8,
      username: opts.username || 'Player',
      uuid: opts.uuid,
      yaw: opts.yaw,
      pitch: opts.pitch,
    },
    opts.skinDataUrl ? { texture: opts.skinDataUrl } : {},
  );

  if (opts.skinDataUrl && typeof entities.updatePlayerSkin === 'function') {
    void entities.updatePlayerSkin(id, opts.username, opts.uuid, opts.skinDataUrl);
  }
  return true;
}
