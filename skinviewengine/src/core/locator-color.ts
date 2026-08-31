// ===== Цвет маркера Locator Bar (Java Edition) по UUID =====
// Алгоритм как в игре / locator-bar-neighbors: UUID.hashCode() → RGB → яркость 90%.

export type LocatorColor = {
  /** Нижние 24 бита hashCode — «сырой» цвет */
  rawHex: string;
  /** Цвет на Locator Bar после нормализации яркости до 0.9 */
  renderedHex: string;
  r: number;
  g: number;
  b: number;
};

/** Нормализация UUID к 32 hex-символам без дефисов */
export function normalizeMinecraftUuid(uuid: string | null | undefined): string | null {
  const hex = String(uuid || "")
    .trim()
    .replace(/-/g, "")
    .toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) return null;
  return hex;
}

/** Java `UUID.hashCode()`: XOR четырёх signed int32 */
export function javaUuidHashCode(uuidHex32: string): number {
  const a = parseInt(uuidHex32.slice(0, 8), 16) | 0;
  const b = parseInt(uuidHex32.slice(8, 16), 16) | 0;
  const c = parseInt(uuidHex32.slice(16, 24), 16) | 0;
  const d = parseInt(uuidHex32.slice(24, 32), 16) | 0;
  return (a ^ b ^ c ^ d) | 0;
}

/**
 * HSB-пересборка с фиксированной яркостью (как клиент Minecraft).
 * `color` — 6 hex без #.
 */
function setBrightnessRgb(color: string, brightness: number): { r: number; g: number; b: number } {
  let red = parseInt(color.slice(0, 2), 16);
  let green = parseInt(color.slice(2, 4), 16);
  let blue = parseInt(color.slice(4, 6), 16);
  const rgbMax = Math.max(red, green, blue);
  const rgbMin = Math.min(red, green, blue);
  const range = rgbMax - rgbMin;
  const saturation = rgbMax !== 0 ? range / rgbMax : 0;

  let hue = 0;
  if (saturation !== 0) {
    const cr = (rgbMax - red) / range;
    const cg = (rgbMax - green) / range;
    const cb = (rgbMax - blue) / range;
    if (red === rgbMax) hue = cb - cg;
    else if (green === rgbMax) hue = 2 + cr - cb;
    else hue = 4 + cg - cr;
    hue /= 6;
    if (hue < 0) hue += 1;
  }

  if (saturation === 0) {
    const v = Math.round(brightness * 255);
    return { r: v, g: v, b: v };
  }

  const segment = (hue - Math.floor(hue)) * 6;
  const offset = segment - Math.floor(segment);
  const primary = brightness * (1 - saturation);
  const secondary = brightness * (1 - saturation * offset);
  const tertiary = brightness * (1 - saturation * (1 - offset));

  switch (Math.floor(segment)) {
    case 0:
      red = Math.round(brightness * 255);
      green = Math.round(tertiary * 255);
      blue = Math.round(primary * 255);
      break;
    case 1:
      red = Math.round(secondary * 255);
      green = Math.round(brightness * 255);
      blue = Math.round(primary * 255);
      break;
    case 2:
      red = Math.round(primary * 255);
      green = Math.round(brightness * 255);
      blue = Math.round(tertiary * 255);
      break;
    case 3:
      red = Math.round(primary * 255);
      green = Math.round(secondary * 255);
      blue = Math.round(brightness * 255);
      break;
    case 4:
      red = Math.round(tertiary * 255);
      green = Math.round(primary * 255);
      blue = Math.round(brightness * 255);
      break;
    default:
      red = Math.round(brightness * 255);
      green = Math.round(primary * 255);
      blue = Math.round(secondary * 255);
      break;
  }
  return { r: red, g: green, b: blue };
}

function toHex2(n: number): string {
  return Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
}

/** Цвет маркера Locator Bar по UUID игрока (Java Edition) */
export function locatorColorFromUuid(uuid: string | null | undefined): LocatorColor | null {
  const hex = normalizeMinecraftUuid(uuid);
  if (!hex) return null;
  const raw = javaUuidHashCode(hex) & 0xffffff;
  const rawHex = raw.toString(16).padStart(6, "0");
  const { r, g, b } = setBrightnessRgb(rawHex, 0.9);
  return {
    rawHex,
    renderedHex: `${toHex2(r)}${toHex2(g)}${toHex2(b)}`,
    r,
    g,
    b,
  };
}
