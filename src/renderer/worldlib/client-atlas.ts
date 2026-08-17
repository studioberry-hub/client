// Загрузка текстур блоков из клиентского jar через IPC main-процесса.
// В customTextures.blocks.textures нужны СТРОКИ dataURL (как christmas в mc-assets),
// а не { contents } — иначе makeNewAtlas кладёт объект в img и drawImage падает.

export interface ClientAtlasResult {
  /** Имя текстуры (stone, oak_leaves) → data:image/png;base64,... */
  textures: Record<string, string>;
  jarPath?: string;
  count: number;
}

export async function tryLoadClientJarAtlas(opts: {
  gameVersion: string;
  jarPath?: string;
}): Promise<ClientAtlasResult | null> {
  const api = window.worldApi;
  if (!api?.blockTextures) return null;
  try {
    const res = await api.blockTextures(opts.gameVersion, opts.jarPath);
    if (!res?.ok || !res.textures || res.count < 10) return null;
    const textures: Record<string, string> = {};
    for (const [name, dataUrl] of Object.entries(res.textures)) {
      if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) {
        textures[name] = dataUrl;
      }
    }
    if (Object.keys(textures).length < 10) return null;
    return { textures, jarPath: res.jarPath, count: Object.keys(textures).length };
  } catch {
    return null;
  }
}

/**
 * Подмешивает только НОВЫЕ текстуры (которых нет в уже загруженном atlas json),
 * чтобы не пересобирать весь атлас тысячами кастомных картинок и не ломать beacon и т.п.
 * Если список известных имён недоступен — не трогаем customTextures (безопасный отказ).
 */
export function applyClientTexturesToViewer(viewer: any, atlas: ClientAtlasResult): number {
  const rm = viewer?.resourcesManager;
  if (!rm) return 0;

  const known: Set<string> = new Set();
  try {
    const latest = rm.sourceBlocksAtlases?.latest?.textures
      || rm.currentResources?.blocksAtlasJson?.textures
      || rm.blocksAtlasParser?.atlas?.latest?.textures;
    if (latest && typeof latest === 'object') {
      for (const k of Object.keys(latest)) known.add(k);
    }
  } catch { /* */ }

  // До updateAssetsData atlas json ещё может быть пуст — тогда берём ключи из source atlases.
  if (known.size === 0) {
    try {
      const src = rm.sourceBlocksAtlases;
      const pack = src?.latest || src;
      const tex = pack?.textures;
      if (tex) for (const k of Object.keys(tex)) known.add(k);
    } catch { /* */ }
  }

  const additions: Record<string, string> = {};
  for (const [name, dataUrl] of Object.entries(atlas.textures)) {
    // Новые блоки: нет в базовом атласе 1.21.6.
    // Также не подменяем уже известные — иначе лишняя нагрузка и риск битых PNG.
    if (known.size > 0 && known.has(name)) continue;
    additions[name] = dataUrl;
  }

  // Если known пуст (ещё не загрузили source) — добавляем только явный «хвост» имён,
  // которые точно нужны аппроксимациям 1.21.7+ / 26.x, иначе пропускаем.
  if (known.size === 0) {
    return 0;
  }

  const count = Object.keys(additions).length;
  if (count === 0) return 0;

  rm.currentResources ??= {};
  rm.currentResources.customTextures ??= {};
  rm.currentResources.customTextures.blocks = {
    ...(rm.currentResources.customTextures.blocks || {}),
    textures: {
      ...(rm.currentResources.customTextures.blocks?.textures || {}),
      ...additions,
    },
  };
  return count;
}
