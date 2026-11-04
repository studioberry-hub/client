// Списки версий загрузчиков для выбранной версии Minecraft.
// Источники: Fabric meta, Quilt meta, Forge maven + promotions, NeoForge maven.

export type LoaderVersionResult = {
  versions: string[];
  error?: string;
  /** Для этой версии игры сборок загрузчика нет — это не сбой сети. */
  unavailable?: boolean;
};

const UA = { 'User-Agent': 'Undefined-Client', Accept: 'application/json, application/xml, text/xml, */*' };

function compareSemver(a: string, b: string): number {
  const pa = a.split(/[^0-9]/).filter(Boolean).map(Number);
  const pb = b.split(/[^0-9]/).filter(Boolean).map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na !== nb) return na - nb;
  }
  return a.localeCompare(b);
}

function sortDesc(list: string[]): string[] {
  return [...new Set(list.filter(Boolean))].sort((a, b) => compareSemver(b, a));
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

function parseMavenVersions(xml: string): string[] {
  const out: string[] = [];
  const re = /<version>\s*([^<\s]+)\s*<\/version>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

/** NeoForge `21.1.172` / `21.1.80-beta` соответствует Minecraft `1.21.1`, но не `1.21.10`. */
export function neoforgeMatchesMinecraft(neoVersion: string, mcVersion: string): boolean {
  const v = String(neoVersion || '').trim();
  const mc = String(mcVersion || '').trim();
  if (!v || !mc) return false;
  if (v.startsWith(`${mc}-`) || v === mc) return true;
  const parts = mc.split('.');
  let major = '';
  let minor = '0';
  if (parts[0] === '1' && parts.length >= 2) {
    major = parts[1];
    minor = parts[2] ?? '0';
  } else if (parts.length >= 2) {
    major = parts[0];
    minor = parts[1];
  } else {
    return false;
  }
  const prefix = `${major}.${minor}`;
  if (v === prefix) return true;
  if (v.startsWith(`${prefix}.`) || v.startsWith(`${prefix}-`)) return true;
  return false;
}

function forgeMatchesMinecraft(forgeVersion: string, mcVersion: string): boolean {
  const v = String(forgeVersion || '').trim();
  const mc = String(mcVersion || '').trim();
  if (!v || !mc) return false;
  return v.startsWith(`${mc}-`);
}

async function listFabricOrQuilt(kind: 'fabric' | 'quilt', mc: string): Promise<LoaderVersionResult> {
  const url = kind === 'fabric'
    ? `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mc)}`
    : `https://meta.quiltmc.org/v3/versions/loader/${encodeURIComponent(mc)}`;
  try {
    const data = await fetchJson(url);
    if (!Array.isArray(data)) return { versions: [], unavailable: true };
    const versions = sortDesc(data.map((row: any) => String(row?.loader?.version || '')).filter(Boolean));
    if (!versions.length) return { versions: [], unavailable: true };
    return { versions };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const unavailable = /HTTP 404|HTTP 400/.test(message);
    return { versions: [], unavailable, error: unavailable ? undefined : message };
  }
}

async function listForge(mc: string): Promise<LoaderVersionResult> {
  const errors: string[] = [];
  const found: string[] = [];

  try {
    const xml = await fetchText('https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml');
    for (const v of parseMavenVersions(xml)) {
      if (forgeMatchesMinecraft(v, mc)) found.push(v);
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  try {
    const promo = await fetchJson('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json');
    const promos = promo?.promos || {};
    for (const key of [`${mc}-recommended`, `${mc}-latest`]) {
      const build = promos[key];
      if (!build) continue;
      const full = String(build).startsWith(`${mc}-`) ? String(build) : `${mc}-${build}`;
      found.push(full);
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  const versions = sortDesc(found);
  if (versions.length) return { versions };
  if (errors.length && found.length === 0 && errors.every((e) => /HTTP 404/.test(e))) {
    return { versions: [], unavailable: true };
  }
  if (!versions.length && !errors.length) return { versions: [], unavailable: true };
  return { versions: [], error: errors[0] || 'forge_metadata_failed', unavailable: !errors.length };
}

async function listNeoForge(mc: string): Promise<LoaderVersionResult> {
  const errors: string[] = [];
  const found: string[] = [];

  const take = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const raw of list) {
      const v = String(raw || '').trim();
      if (neoforgeMatchesMinecraft(v, mc)) found.push(v);
    }
  };

  try {
    const data = await fetchJson('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge');
    take(data?.versions);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  if (!found.length) {
    try {
      const xml = await fetchText('https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml');
      take(parseMavenVersions(xml));
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  // Ранний NeoForge 1.20.1 публиковался как net.neoforged:forge:
  // версии вида 1.20.1-47.1.x и отдельная голая 47.1.82.
  if (mc === '1.20.1' || mc === '1.20') {
    try {
      const legacy = await fetchJson('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/forge');
      const list = Array.isArray(legacy?.versions) ? legacy.versions : [];
      for (const raw of list) {
        const v = String(raw || '').trim();
        if (!v) continue;
        if (neoforgeMatchesMinecraft(v, mc) || (mc === '1.20.1' && /^47\.1\./.test(v))) found.push(v);
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  const versions = [...new Set(found.filter(Boolean))].sort((a, b) => {
    // Голая 47.1.82 должна стоять рядом с 1.20.1-47.1.x, а не выше всех из-за первой цифры.
    const key = (v: string) => v.match(/47\.1\.\d+.*$/)?.[0] || v;
    return compareSemver(key(b), key(a));
  });
  if (versions.length) return { versions };
  if (!errors.length) return { versions: [], unavailable: true };
  return { versions: [], error: errors[0], unavailable: false };
}

export async function listLoaderVersions(loader: string, mcVersion: string): Promise<LoaderVersionResult> {
  const kind = String(loader || '').toLowerCase();
  const mc = String(mcVersion || '').trim();
  if (!mc) return { versions: [], error: 'mc_version_required' };
  if (kind === 'vanilla' || !kind) return { versions: [] };
  if (kind === 'fabric' || kind === 'quilt') return listFabricOrQuilt(kind, mc);
  if (kind === 'forge') return listForge(mc);
  if (kind === 'neoforge') return listNeoForge(mc);
  return { versions: [], error: 'unsupported_loader' };
}
