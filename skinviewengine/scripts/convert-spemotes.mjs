// Конвертер SPEmotes/Emotecraft → компактные клипы со скелетным bend
import fs from "fs";
import path from "path";

const SRC = "C:/Users/PC-25/Downloads/SPEmotes_3.0";
const OUT = path.resolve("src/core/emotes");

/** Какие файлы → id анимации движка */
const MAP = [
  { file: "SPE_Wave your hand.json", id: "wave", name: "Wave" },
  { file: "SPE_crouch.json", id: "sneak", name: "Crouch" },
  { file: "SPE_Yes.json", id: "look", name: "Nod" },
  { file: "SPE_Hand on heart.json", id: "cool", name: "Hand on heart" },
  { file: "SPE_Be_ashamed.json", id: "sad", name: "Ashamed" },
  { file: "SPE_Dance1.json", id: "dance", name: "Dance" },
  { file: "SPE_Hands_up.json", id: "victory", name: "Hands up" },
  { file: "SPE_Dab.json", id: "dab", name: "Dab" },
  { file: "SPE_Think.json", id: "think", name: "Think" },
  { file: "SPE_Hello.json", id: "hello", name: "Hello" },
];

const PART_MAP = {
  head: "head",
  torso: "body",
  leftArm: "leftArm",
  rightArm: "rightArm",
  leftLeg: "leftLeg",
  rightLeg: "rightLeg",
};

const EASE_MAP = {
  LINEAR: "linear",
  CONSTANT: "constant",
  EASEINQUAD: "easeIn",
  EASEOUTQUAD: "easeOut",
  EASEINOUTQUAD: "easeInOut",
  EASEINBOUNCE: "easeIn",
  EASEOUTBOUNCE: "easeOut",
  EASEINOUTBOUNCE: "easeInOut",
  EASEINCUBIC: "easeIn",
  EASEOUTCUBIC: "easeOut",
  EASEINOUTCUBIC: "easeInOut",
  EASEINSINE: "easeIn",
  EASEOUTSINE: "easeOut",
  EASEINOUTSINE: "easeInOut",
  INOUTSINE: "easeInOut",
  INSINE: "easeIn",
  OUTSINE: "easeOut",
};

function deg2rad(v, degrees) {
  return degrees ? (v * Math.PI) / 180 : v;
}

function convert(file, id, name) {
  const raw = JSON.parse(fs.readFileSync(path.join(SRC, file), "utf8"));
  const em = raw.emote;
  const degrees = em.degrees === true || em.degrees === "true";
  const byTick = new Map();

  for (const move of em.moves) {
    const t = move.tick ?? 0;
    if (!byTick.has(t)) {
      byTick.set(t, {
        tick: t,
        ease: EASE_MAP[String(move.easing || "LINEAR").toUpperCase()] || "linear",
        parts: {},
      });
    }
    const frame = byTick.get(t);
    for (const [part, val] of Object.entries(move)) {
      if (["tick", "easing", "turn", "comment"].includes(part)) continue;
      const mapped = PART_MAP[part];
      if (!mapped || !val || typeof val !== "object") continue;

      const out = frame.parts[mapped] || {};
      if (typeof val.pitch === "number") out.rx = deg2rad(val.pitch, degrees);
      if (typeof val.yaw === "number") out.ry = deg2rad(val.yaw, degrees);
      if (typeof val.roll === "number") out.rz = deg2rad(val.roll, degrees);
      if (typeof val.x === "number") out.x = val.x;
      if (typeof val.y === "number") out.y = val.y;
      if (typeof val.z === "number") out.z = val.z;
      if (typeof val.bend === "number") out.bend = deg2rad(val.bend, degrees);
      if (typeof val.axis === "number") out.axis = deg2rad(val.axis, degrees);
      if (Object.keys(out).length) frame.parts[mapped] = out;
    }
  }

  const frames = [...byTick.values()]
    .map((f) => {
      const parts = {};
      for (const [k, v] of Object.entries(f.parts)) {
        const out = {};
        for (const key of ["rx", "ry", "rz", "x", "y", "z", "bend", "axis"]) {
          if (typeof v[key] === "number" && Number.isFinite(v[key])) {
            out[key] = +v[key].toFixed(5);
          }
        }
        if (Object.keys(out).length) parts[k] = out;
      }
      return { tick: f.tick, ease: f.ease, parts };
    })
    .filter((f) => Object.keys(f.parts).length > 0)
    .sort((a, b) => a.tick - b.tick);

  const endTick = Number(em.endTick) || frames[frames.length - 1]?.tick || 20;
  const loop = String(em.isLoop) === "true";

  return {
    schemaVersion: 2,
    id,
    name,
    source: file,
    tps: 20,
    endTick,
    loop,
    returnTick: Number(em.returnTick) || 0,
    frames,
  };
}

fs.mkdirSync(OUT, { recursive: true });
const index = [];
for (const item of MAP) {
  if (!fs.existsSync(path.join(SRC, item.file))) {
    console.warn("skip missing", item.file);
    continue;
  }
  const clip = convert(item.file, item.id, item.name);
  const outFile = `${item.id}.json`;
  fs.writeFileSync(path.join(OUT, outFile), JSON.stringify(clip));
  const ts = `// Автогенерация из SPEmotes (Emotecraft bend + xyz)\nimport type { EmoteClip } from "../emote-animation.js";\n\nconst clip = ${JSON.stringify(clip)} as EmoteClip;\n\nexport default clip;\n`;
  fs.writeFileSync(path.join(OUT, `${item.id}.ts`), ts);
  const bendFrames = clip.frames.filter((f) =>
    Object.values(f.parts).some((p) => typeof p.bend === "number"),
  ).length;
  index.push({
    id: item.id,
    file: outFile,
    frames: clip.frames.length,
    endTick: clip.endTick,
    bendFrames,
  });
  console.log(
    "wrote",
    outFile,
    "frames",
    clip.frames.length,
    "bendFrames",
    bendFrames,
    "end",
    clip.endTick,
  );
}
fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(index, null, 2));
console.log("done", index.length, "clips →", OUT);
