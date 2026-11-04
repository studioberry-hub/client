// Preload окна просмотра мира.
//
// Окно грузится по кастомной схеме app:// с contextIsolation, поэтому доступ к IPC
// даётся только через этот мост. Путь к миру приходит из additionalArguments
// (см. createWorldWindow в main.ts), а не хардкодится в бандле окна.

import { contextBridge, ipcRenderer } from 'electron';

function readArg(name: string): string {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? decodeURIComponent(arg.slice(prefix.length)) : '';
}

const worldPath = readArg('world-path');
/** Куда сохранить скриншот сразу после прогрузки области (режим фиксации результата). */
const shotPath = readArg('world-shot');
/** Встроено в модалку лаунчера (WebContentsView) — без отдельного окна. */
const embedded = process.argv.some((a) => a === '--world-embed=1' || a === '--world-embed');

contextBridge.exposeInMainWorld('worldApi', {
  /** Путь к папке мира, переданный при создании окна ('' — мир не выбран). */
  worldPath,
  shotPath,
  embedded,
  closeEmbed: () => ipcRenderer.invoke('world:close'),
  describe: (path: string) => ipcRenderer.invoke('worldview:describe', path),
  listWorlds: () => ipcRenderer.invoke('worldview:list-worlds'),
  column: (path: string, x: number, z: number) => ipcRenderer.invoke('worldview:column', path, x, z),
  columns: (path: string, coords: Array<[number, number]>) => ipcRenderer.invoke('worldview:columns', path, coords),
  columnsRing: (path: string, centerX: number, centerZ: number, radius: number) =>
    ipcRenderer.invoke('worldview:columns-ring', path, centerX, centerZ, radius),
  columnsRadius: (path: string, centerX: number, centerZ: number, radius: number) =>
    ipcRenderer.invoke('worldview:columns-radius', path, centerX, centerZ, radius),
  previewProfile: () => ipcRenderer.invoke('worldview:preview-profile'),
  stats: (path: string) => ipcRenderer.invoke('worldview:stats', path),
  screenshot: (filePath: string) => ipcRenderer.invoke('worldview:screenshot', filePath),
  /** Сообщить, что автоматический прогон закончен (для сценариев с --world-exit). */
  finish: () => ipcRenderer.invoke('worldview:finish'),
  findClientJar: (gameVersion: string) => ipcRenderer.invoke('world:find-client-jar', gameVersion),
  blockTextures: (gameVersion: string, jarPath?: string) =>
    ipcRenderer.invoke('world:block-textures', gameVersion, jarPath),
});
