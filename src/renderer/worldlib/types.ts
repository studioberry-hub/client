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
  chunkCount: number;
  regionCount: number;
  startSource: string;
}

export interface WorldEntry {
  buildId: string;
  folder: string;
  worldPath: string;
}

export interface WorldApi {
  worldPath: string;
  shotPath: string;
  describe(path: string): Promise<WorldInfo>;
  listWorlds(): Promise<WorldEntry[]>;
  column(path: string, x: number, z: number): Promise<WireColumn | null>;
  columns(path: string, coords: Array<[number, number]>): Promise<WireColumn[]>;
  stats(path: string): Promise<any>;
  screenshot(filePath: string): Promise<{ ok: boolean; path?: string; bytes?: number; error?: string }>;
  finish(): Promise<void>;
}

declare global {
  interface Window {
    worldApi?: WorldApi;
  }
}
