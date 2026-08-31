// Реестр SPE/Emotecraft-клипов (bend + xyz) для createSkinAnimation
import { EmoteClipAnimation, type EmoteClip } from "./emote-animation.js";
import type { SkinAnimId, SkinAnimation } from "./skin-animations.js";

import cool from "./emotes/cool.js";
import dab from "./emotes/dab.js";
import dance from "./emotes/dance.js";
import hello from "./emotes/hello.js";
import look from "./emotes/look.js";
import sad from "./emotes/sad.js";
import sneak from "./emotes/sneak.js";
import think from "./emotes/think.js";
import victory from "./emotes/victory.js";
import wave from "./emotes/wave.js";

const CLIPS: Partial<Record<SkinAnimId, EmoteClip>> = {
  wave,
  sneak,
  look,
  cool,
  sad,
  dance,
  victory,
  dab,
  think,
  hello,
};

export function tryCreateEmoteAnimation(id: SkinAnimId): SkinAnimation | null {
  const clip = CLIPS[id];
  if (!clip) return null;
  return new EmoteClipAnimation(clip);
}
