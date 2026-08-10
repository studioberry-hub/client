// Декларация модуля minecraft-renderer.
// Пакет не поставляет dist/index.d.ts (поле types указывает на несуществующий файл),
// поэтому для tsc объявляется минимальный контракт того, что реально используется.
declare module 'minecraft-renderer' {
  export const AppViewer: any;
  export const createGraphicsBackendSingleThread: any;
  export const createGraphicsBackendOffThread: any;
  export const getInitialPlayerState: () => any;
  export const WorldView: any;
  export const ResourcesManager: any;
  export const DocumentRenderer: any;
}
