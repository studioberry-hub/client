// Проводной формат колонок (main -> окно мира) и мост preload.
// Дублирует интерфейсы из src/main/anvil.ts: бандл окна собирается отдельно
// от main-процесса, тянуть туда main-код нельзя.

export interface WirePaletteEntry {
  name: string;
  props?: Record<string, string>;
}

export interface WireSection {
  y: number;
  blockPalette: WirePaletteEntry[];
  blockBits: number;
  blockData: Uint32Array | null;
  biomePalette: string[];
  biomeBits: number;
  biomeData: Uint32Array | null;
  skyLight: Uint8Array | null;
  blockLight: Uint8Array | null;
  skyFull?: boolean;
}

export interface WireColumn {
  x: number;
  z: number;
  minY: number;
  worldHeight: number;
  dataVersion: number;
  status: string;
  lightOn: boolean;
  sections: WireSection[];
  blockEntities: Record<string, any>;
  byteSize: number;
}

export interface WorldInfo {
  ok: boolean;
  message?: string;
  worldPath: string;
  name: string;
  versionName: string;
  dataVersion: number;
  minY: number;
  worldHeight: number;
  start: { x: number; y: number; z: number };
  /** Градусы Rotation из NBT, если есть. */
  yaw?: number;
  pitch?: number;
  chunkCount: number;
  regionCount: number;
  startSource: string;
  dimension?: string;
}

export interface WorldEntry {
  buildId: string;
  folder: string;
  worldPath: string;
}

export interface WorldApi {
  worldPath: string;
  shotPath: string;
  /** true — view внутри модалки лаунчера. */
  embedded?: boolean;
  closeEmbed?(): Promise<{ ok?: boolean }>;
  describe(path: string): Promise<WorldInfo>;
  listWorlds(): Promise<WorldEntry[]>;
  column(path: string, x: number, z: number): Promise<WireColumn | null>;
  columns(path: string, coords: Array<[number, number]>): Promise<WireColumn[]>;
  columnsRing?(path: string, centerX: number, centerZ: number, radius: number): Promise<{
    columns: WireColumn[];
    missing: Array<[number, number]>;
  }>;
  columnsRadius?(path: string, centerX: number, centerZ: number, radius: number): Promise<{
    columns: WireColumn[];
    missing: Array<[number, number]>;
  }>;
  previewProfile?(): Promise<{ username: string; uuid?: string; skinDataUrl?: string }>;
  stats(path: string): Promise<any>;
  screenshot(filePath: string): Promise<{ ok: boolean; path?: string; bytes?: number; error?: string }>;
  finish(): Promise<void>;
  findClientJar?(gameVersion: string): Promise<string | null>;
  blockTextures?(gameVersion: string, jarPath?: string): Promise<{
    ok: boolean;
    jarPath?: string;
    textures: Record<string, string>;
    count: number;
    error?: string;
  }>;
}

declare global {
  interface Window {
    worldApi?: WorldApi;
  }
}
