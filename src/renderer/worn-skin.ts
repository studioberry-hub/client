// Актуальная текстура скина Microsoft / Ely.by.
// mc-heads.net кэширует Steve и не видит скин, который сейчас надет в Mojang.

import {
  DEFAULT_ACCOUNT_SKIN_URL,
  skinElyUrl,
  skinImageUrl,
  skinProfileUrl,
} from '../shared/apiBase';

export type SkinIdentity = {
  provider?: string | null;
  uuid?: string | null;
  username?: string | null;
  skinUrl?: string | null;
};

export type SkinLookup = {
  getMojangSkin?: (uuid: string) => Promise<{ skinUrl?: string | null } | null>;
  getElyWornSkin?: (nickname: string, force?: boolean) => Promise<string | null>;
};

const cache = new Map<string, { url: string; exp: number }>();
const inflight = new Map<string, Promise<string>>();
const TTL_OK = 10 * 60 * 1000;
const TTL_MISS = 10 * 60 * 1000;

function https(raw: string | null | undefined): string {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  return text.startsWith('http://') ? `https://${text.slice(7)}` : text;
}

/** Уже готовая голова (crafatar/mc-heads), её нельзя кропать как лист 64×64. */
export function isFinishedHeadUrl(raw: string | null | undefined): boolean {
  const text = String(raw ?? '');
  return /crafatar\.com\/(?:avatars|renders)\//i.test(text)
    || /mc-heads\.net\/(?:avatar|helm|head)\//i.test(text)
    || /minotar\.net\/(?:avatar|helm|cube)\//i.test(text)
    || /\/avatar\//i.test(text);
}

/** Своя текстура, а не рендер mc-heads и не заглушка NameMC. */
export function isWornTexture(raw: string | null | undefined): boolean {
  const text = https(raw);
  if (!text || /mc-heads\.net|\/avatar\//i.test(text)) return false;
  if (text === DEFAULT_ACCOUNT_SKIN_URL) return false;
  return /textures\.minecraft\.net|skinsystem\.ely\.by|ely\.by\/storage|mineskin\.eu|s\.namemc\.com/i.test(
    text,
  );
}

function usable(raw: string): string {
  const text = https(raw);
  if (!text || /mc-heads\.net|\/avatar\//i.test(text)) return '';
  if (text === DEFAULT_ACCOUNT_SKIN_URL) return text;
  return isWornTexture(text) ? text : '';
}

/** Картинка текстуры через прокси (textures.minecraft.net у части провайдеров закрыт). */
export function wornSkinProxyUrl(raw: string): string {
  const text = https(raw);
  return skinImageUrl(text) || text;
}

function cacheKey(user: SkinIdentity): string {
  const provider = String(user.provider || '').toLowerCase();
  const uuid = String(user.uuid || '')
    .replace(/-/g, '')
    .toLowerCase();
  const name = String(user.username || '')
    .trim()
    .toLowerCase();
  return `${provider}:${uuid || name}`;
}

async function fetchMojang(uuid: string, lookup?: SkinLookup): Promise<string> {
  const clean = uuid.replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(clean)) return '';
  if (lookup?.getMojangSkin) {
    try {
      const data = await lookup.getMojangSkin(clean);
      const url = usable(data?.skinUrl || '');
      if (url && url !== DEFAULT_ACCOUNT_SKIN_URL) return url;
    } catch {
      /* пробуем HTTP-прокси */
    }
  }
  try {
    const res = await fetch(skinProfileUrl(clean));
    if (!res.ok) return '';
    const data = await res.json();
    const raw = data?.properties?.[0]?.value;
    if (!raw) return '';
    const textures = JSON.parse(atob(String(raw)));
    return usable(textures?.textures?.SKIN?.url || '');
  } catch {
    return '';
  }
}

async function fetchEly(username: string, lookup?: SkinLookup, force = false): Promise<string> {
  const name = username.trim();
  if (!name) return '';
  if (lookup?.getElyWornSkin) {
    try {
      // IPC уже ходил на skinsystem. Повторный fetch того же хоста только удваивает таймауты.
      // force сбрасывает кэш главного процесса: иначе смена скина не видна до 10 минут.
      return usable((await lookup.getElyWornSkin(name, force)) || '');
    } catch {
      return '';
    }
  }
  try {
    const res = await fetch(skinElyUrl(name));
    if (!res.ok) return '';
    const data = await res.json();
    return usable(data?.skinUrl || '');
  } catch {
    return '';
  }
}

/**
 * Голова как в прошлом мессенджере: лицо 8×8 с (8,8) и шлем 8×8 с (40,8) ровно поверх.
 * Чужой размер (уже готовая голова, рендер, не лист) не кропаем — иначе второй слой съезжает.
 */
export function cropWornHead(textureUrl: string, size = 64): Promise<string> {
  const src = wornSkinProxyUrl(textureUrl);
  if (!src) return Promise.resolve('');
  // Готовая голова уже собрана. Кроп (8,8)+(40,8) режет её на два куска.
  if (isFinishedHeadUrl(textureUrl) || isFinishedHeadUrl(src)) return Promise.resolve(src);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const w = img.naturalWidth || img.width;
        const hImg = img.naturalHeight || img.height;
        if (w < 64 || w % 64 !== 0) {
          resolve('');
          return;
        }
        const scale = w / 64;
        const rows = hImg / scale;
        if (Math.abs(rows - 64) > 0.5 && Math.abs(rows - 32) > 0.5) {
          resolve('');
          return;
        }
        const face = 8 * scale;
        const cell = document.createElement('canvas');
        cell.width = face;
        cell.height = face;
        const raw = cell.getContext('2d');
        if (!raw) {
          resolve('');
          return;
        }
        raw.imageSmoothingEnabled = false;
        raw.drawImage(img, 8 * scale, 8 * scale, face, face, 0, 0, face, face);
        raw.drawImage(img, 40 * scale, 8 * scale, face, face, 0, 0, face, face);
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve('');
          return;
        }
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(cell, 0, 0, face, face, 0, 0, size, size);
        resolve(canvas.toDataURL('image/png'));
      } catch {
        resolve('');
      }
    };
    img.onerror = () => resolve('');
    img.src = src;
  });
}

/** Живая текстура: профиль Mojang для лицензии, skinsystem для Ely.by. */
export function resolveWornSkinUrl(
  user: SkinIdentity,
  lookup?: SkinLookup,
  opts?: { live?: boolean },
): Promise<string> {
  const key = cacheKey(user);
  const stored = usable(user.skinUrl || '');
  const storedCustom = isWornTexture(stored) ? stored : '';
  if (!key || key.endsWith(':')) return Promise.resolve(storedCustom);

  // Уже известный лист скина не переспрашиваем у Ely на каждый аватар.
  // live — только если этот URL не оказался листом и голову снять нельзя.
  if (storedCustom && !opts?.live) {
    cache.set(key, { url: storedCustom, exp: Date.now() + TTL_OK });
    return Promise.resolve(storedCustom);
  }

  if (!opts?.live) {
    const hit = cache.get(key);
    if (hit && hit.exp > Date.now()) return Promise.resolve(hit.url || storedCustom);
  }

  const pending = inflight.get(key);
  if (pending && !opts?.live) return pending;

  const task = (async () => {
    const provider = String(user.provider || '').toLowerCase();
    const uuid = String(user.uuid || '').replace(/-/g, '');
    const name = String(user.username || '').trim();
    let live = '';
    if (provider === 'ely' || provider === 'yggdrasil') live = await fetchEly(name, lookup, Boolean(opts?.live));
    else if (provider === 'msa' || uuid) live = await fetchMojang(uuid, lookup);
    const url = live || storedCustom;
    cache.set(key, { url, exp: Date.now() + (url ? TTL_OK : TTL_MISS) });
    return url;
  })().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, task);
  return task;
}
