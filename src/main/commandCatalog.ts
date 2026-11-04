// Списки предметов, блоков и прочих реестров из client.jar и их иконки 16×16.
// Берутся из ассетов игры, а не из зашитого списка.

import * as fs from 'fs';
import AdmZip from 'adm-zip';

export interface CatalogEntry {
  id: string;
  name: string;
}

export interface CommandCatalog {
  ok: boolean;
  version: string;
  jarPath?: string;
  error?: string;
  items: CatalogEntry[];
  blocks: CatalogEntry[];
  entities: CatalogEntry[];
  effects: CatalogEntry[];
  enchantments: CatalogEntry[];
  biomes: CatalogEntry[];
  structures: CatalogEntry[];
  particles: CatalogEntry[];
  attributes: CatalogEntry[];
  features: CatalogEntry[];
  damageTypes: CatalogEntry[];
}

interface BuiltCatalog {
  key: string;
  zip: AdmZip;
  catalog: CommandCatalog;
  textureOf: Map<string, string>;
}

let built: BuiltCatalog | null = null;
const iconCache = new Map<string, string>();

function ns(id: string): string {
  return id.includes(':') ? id : `minecraft:${id}`;
}

function langName(lang: Record<string, string>, key: string, id: string): string {
  return lang[key] || lang[`block.minecraft.${id}`] || lang[`item.minecraft.${id}`] || '';
}

function idsFrom(zip: AdmZip, prefix: string): string[] {
  const out: string[] = [];
  for (const entry of zip.getEntries()) {
    const name = entry.entryName.replace(/\\/g, '/');
    if (!name.startsWith(prefix) || !name.endsWith('.json') || entry.isDirectory) continue;
    const base = name.slice(prefix.length).replace(/\.json$/i, '');
    if (!base || base.includes('/')) continue;
    out.push(ns(base));
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

function fromLang(lang: Record<string, string>, prefix: string): CatalogEntry[] {
  const out: CatalogEntry[] = [];
  const head = `${prefix}.`;
  for (const key of Object.keys(lang)) {
    if (!key.startsWith(head)) continue;
    const id = key.slice(head.length);
    if (!id || id.includes('.')) continue;
    out.push({ id: ns(id), name: lang[key] });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

function readJson(zip: AdmZip, entryName: string): unknown {
  const entry = zip.getEntry(entryName);
  if (!entry) return null;
  try {
    return JSON.parse(entry.getData().toString('utf8'));
  } catch {
    return null;
  }
}

function firstModel(value: unknown, depth = 0): string {
  if (depth > 8 || value == null) return '';
  if (typeof value === 'string') {
    return /^minecraft:(item|block)\//.test(value) ? value : '';
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstModel(item, depth + 1);
      if (found) return found;
    }
    return '';
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (record.type === 'minecraft:model' && typeof record.model === 'string') return record.model;
    if (typeof record.base === 'string' && record.base.startsWith('minecraft:')) return record.base;
    for (const nested of Object.values(record)) {
      const found = firstModel(nested, depth + 1);
      if (found) return found;
    }
  }
  return '';
}

function textureFromModel(zip: AdmZip, modelId: string, seen = new Set<string>()): string {
  const clean = modelId.replace(/^minecraft:/, '');
  if (!clean || seen.has(clean)) return '';
  seen.add(clean);
  const json = readJson(zip, `assets/minecraft/models/${clean}.json`) as { parent?: string; textures?: Record<string, string> } | null;
  if (!json) return '';
  const textures = json.textures || {};
  const raw = textures.layer0 || textures.all || textures.particle || textures.texture || Object.values(textures).find((item) => typeof item === 'string' && !item.startsWith('#'));
  if (typeof raw === 'string' && raw.startsWith('minecraft:')) {
    return `assets/minecraft/textures/${raw.slice('minecraft:'.length)}.png`;
  }
  if (typeof json.parent === 'string') return textureFromModel(zip, json.parent, seen);
  return '';
}

function textureForItem(zip: AdmZip, id: string): string {
  const json = readJson(zip, `assets/minecraft/items/${id}.json`);
  const model = firstModel(json);
  if (!model) return '';
  return textureFromModel(zip, model);
}

function textureForBlock(zip: AdmZip, id: string): string {
  return textureFromModel(zip, `minecraft:block/${id}`) || textureForItem(zip, id);
}

function named(ids: string[], lang: Record<string, string>, kind: 'item' | 'block'): CatalogEntry[] {
  return ids.map((full) => {
    const id = full.slice(full.indexOf(':') + 1);
    const name = kind === 'block'
      ? langName(lang, `block.minecraft.${id}`, id)
      : (lang[`item.minecraft.${id}`] || lang[`block.minecraft.${id}`] || '');
    return { id: full, name };
  });
}

export function loadCommandCatalog(jarPath: string, version: string): CommandCatalog {
  const stat = fs.statSync(jarPath);
  const key = `${jarPath}:${stat.mtimeMs}`;
  if (built?.key === key) return built.catalog;
  const zip = new AdmZip(jarPath);
  const lang = (readJson(zip, 'assets/minecraft/lang/en_us.json') || {}) as Record<string, string>;
  const itemIds = idsFrom(zip, 'assets/minecraft/items/');
  const blockIds = idsFrom(zip, 'assets/minecraft/blockstates/');
  const textureOf = new Map<string, string>();
  for (const full of itemIds) {
    const id = full.slice(full.indexOf(':') + 1);
    const texture = textureForItem(zip, id);
    if (texture) textureOf.set(full, texture);
  }
  for (const full of blockIds) {
    if (textureOf.has(full)) continue;
    const id = full.slice(full.indexOf(':') + 1);
    const texture = textureForBlock(zip, id);
    if (texture) textureOf.set(full, texture);
  }
  const catalog: CommandCatalog = {
    ok: true,
    version,
    jarPath,
    items: named(itemIds, lang, 'item'),
    blocks: named(blockIds, lang, 'block'),
    entities: fromLang(lang, 'entity.minecraft'),
    effects: fromLang(lang, 'effect.minecraft'),
    enchantments: fromLang(lang, 'enchantment.minecraft'),
    biomes: fromLang(lang, 'biome.minecraft'),
    structures: idsFrom(zip, 'data/minecraft/worldgen/structure/').map((id) => ({ id, name: '' })),
    particles: idsFrom(zip, 'assets/minecraft/particles/').map((id) => ({ id, name: '' })),
    attributes: fromLang(lang, 'attribute.name'),
    features: idsFrom(zip, 'data/minecraft/worldgen/feature/').concat(idsFrom(zip, 'data/minecraft/worldgen/configured_feature/')).map((id) => ({ id, name: '' })),
    damageTypes: idsFrom(zip, 'data/minecraft/damage_type/').map((id) => ({ id, name: '' })),
  };
  built = { key, zip, catalog, textureOf };
  iconCache.clear();
  return catalog;
}

export function catalogIcons(jarPath: string, version: string, ids: string[]): Record<string, string> {
  loadCommandCatalog(jarPath, version);
  if (!built) return {};
  const out: Record<string, string> = {};
  for (const id of ids) {
    const key = id.toLowerCase();
    const cached = iconCache.get(key);
    if (cached !== undefined) {
      if (cached) out[key] = cached;
      continue;
    }
    const texture = built.textureOf.get(key) || built.textureOf.get(ns(key.replace(/^minecraft:/, '')));
    const entry = texture ? built.zip.getEntry(texture) : null;
    const url = entry ? `data:image/png;base64,${entry.getData().toString('base64')}` : '';
    iconCache.set(key, url);
    if (url) out[key] = url;
  }
  return out;
}
