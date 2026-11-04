import { getApiBase } from '../shared/apiBase';

// Живой каталог серверов: LibriumHub, Modrinth и публичный листинг Undefined.

export interface LiveServer {
  id: string;
  source: 'librium' | 'modrinth' | 'undefined';
  name: string;
  ip: string;
  port: number;
  desc: string;
  icon: string;
  banner: string;
  screenshots: string[];
  versions: string[];
  modes: string[];
  language: string;
  country: string;
  region: string;
  players: number | null;
  maxPlayers: number | null;
  online: boolean | null;
  rating: number | null;
  reviews: number | null;
  followers: number | null;
  joins: number | null;
  latency: number | null;
  modpackName: string;
  modpackIcon: string;
  /** Проект и версия модпака Modrinth, с которым запускается сервер. */
  modpackProjectId: string;
  modpackVersionId: string;
  projectUrl: string;
  /** Короткий id проекта Librium и uuid основного сервера — для графика онлайна. */
  projectId: string;
  serverId: string;
  history: number[];
}

export interface OnlineHistory {
  period: '24h' | '7d' | '30d';
  points: { t: string; online: number }[];
  peak: number;
  min: number;
  avg: number;
  uptime: number | null;
  peakAt: string;
  minAt: string;
}

const UA = 'Undefined-Client';
const CACHE_MS = 90 * 1000;
const LIBRIUM_PAGES = 4;

let cache: { at: number; data: LiveServer[] } = { at: 0, data: [] };
let inflight: Promise<LiveServer[]> | null = null;

function fixText(value: unknown): string {
  const s = String(value ?? '');
  if (!s) return '';
  // RSC иногда отдаёт UTF-8 как latin1-кодпоинты.
  if (!/[\u0080-\u00ff]/.test(s)) return s;
  try {
    const fixed = Buffer.from(s, 'latin1').toString('utf8');
    if (fixed.includes('\uFFFD')) return s;
    return fixed;
  } catch {
    return s;
  }
}

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function guessLang(text: string, code: string): string {
  const known = String(code || '').toLowerCase().slice(0, 2);
  if (known && known !== 'un') return known;
  if (/[а-яё]/i.test(text)) return 'ru';
  if (/[a-z]/i.test(text)) return 'en';
  return '';
}

function regionFor(country: string, host: string): string {
  const c = country.toLowerCase();
  if (['ru', 'by', 'kz', 'ua', 'uz', 'ge', 'am', 'az', 'md', 'kg', 'tj'].includes(c)) return 'cis';
  if (['de', 'fr', 'pl', 'nl', 'gb', 'uk', 'es', 'it', 'se', 'fi', 'no', 'cz', 'be', 'pt', 'ro', 'bg'].includes(c)) return 'europe';
  if (['jp', 'kr', 'in', 'cn', 'sg', 'au', 'nz', 'id', 'th', 'vn', 'ph'].includes(c)) return 'asia';
  if (['br', 'ar', 'cl', 'mx', 'pe', 'co'].includes(c)) return 'south';
  const h = host.toLowerCase();
  if (/\.(ru|su|by|kz)$/.test(h)) return 'cis';
  if (/\.(de|fr|nl|eu|pl|uk)$/.test(h)) return 'europe';
  return c ? 'north' : '';
}

function sliceJsonArray(text: string, start: number): string {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return '';
}

function decodeFlight(html: string): string {
  const parts: string[] = [];
  const re = /self\.__next_f\.push\(\[1,"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const start = m.index + m[0].length;
    const end = html.indexOf('"])</script>', start);
    if (end < 0) continue;
    try {
      parts.push(JSON.parse(`"${html.slice(start, end)}"`));
    } catch {
      /* кусок не JSON-строка */
    }
  }
  return parts.join('\n');
}

function extractProjects(decoded: string): any[] {
  const out: any[] = [];
  let from = 0;
  while (from < decoded.length) {
    const p = decoded.indexOf('"projects":[{"core"', from);
    if (p < 0) break;
    const arrStart = decoded.indexOf('[', p);
    const raw = sliceJsonArray(decoded, arrStart);
    from = arrStart + Math.max(raw.length, 1);
    if (!raw) continue;
    try {
      const list = JSON.parse(raw);
      if (Array.isArray(list)) out.push(...list);
    } catch {
      /* пропускаем битый кусок */
    }
  }
  return out;
}

function mapLibrium(project: any): LiveServer | null {
  const core = project?.core || {};
  const content = project?.content || {};
  const stats = project?.stats || {};
  const servers: any[] = Array.isArray(content.servers) ? content.servers : [];
  const primary = servers.find((s) => s?.isPrimary) || servers[0];
  const display = fixText(primary?.displayAddress || primary?.endpoint?.host || '').trim();
  const host = display.replace(/^mc:\/\//i, '').split('/')[0].split(':')[0].trim();
  const port = Number(String(display).split(':')[1]) || Number(primary?.endpoint?.port) || 25565;
  if (!host || !/^[a-z0-9.-]+$/i.test(host)) return null;
  const versions: string[] = [];
  const fromV = fixText(primary?.versionsSummary?.fromVersion);
  const toV = fixText(primary?.versionsSummary?.toVersion);
  if (fromV) versions.push(fromV);
  if (toV && toV !== fromV) versions.push(toV);
  const mon = primary?.monitoring || {};
  const online = mon.status === 'online' ? true : mon.status === 'offline' ? false : null;
  const country = String(primary?.countryCode || content.country_code || '').toLowerCase();
  const slug = fixText(core.name || core.uuid || host);
  const players = num(mon.playersOnline);
  return {
    id: `lh:${slug}`,
    source: 'librium',
    name: fixText(content.title || slug),
    ip: host,
    port,
    desc: fixText(content.short_description || ''),
    icon: fixText(content.logotype || ''),
    banner: '',
    screenshots: [],
    versions,
    modes: [],
    language: guessLang(`${fixText(content.title || '')} ${fixText(content.short_description || '')}`, fixText(content.language_code || '')),
    country: country.toUpperCase(),
    region: regionFor(country, host),
    players,
    maxPlayers: num(mon.playersMax),
    online,
    rating: num(stats.rating_overall),
    reviews: num(stats.reviews_count),
    followers: num(stats.views_count),
    joins: null,
    latency: num(mon.latencyMs),
    modpackName: '',
    modpackIcon: '',
    modpackProjectId: '',
    modpackVersionId: '',
    projectUrl: `https://libriumhub.com/project/${encodeURIComponent(slug)}`,
    projectId: String(core.uuid || ''),
    serverId: String(primary?.uuid || ''),
    history: players != null ? [players] : [],
  };
}

async function fetchText(url: string, ms = 14000): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/json' },
    signal: AbortSignal.timeout(ms),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function loadLibrium(): Promise<LiveServer[]> {
  const seen = new Set<string>();
  const out: LiveServer[] = [];
  for (let page = 1; page <= LIBRIUM_PAGES; page++) {
    const url = page === 1
      ? 'https://libriumhub.com/projects/servers'
      : `https://libriumhub.com/projects/servers?page=${page}`;
    let html = '';
    try {
      html = await fetchText(url);
    } catch {
      break;
    }
    const projects = extractProjects(decodeFlight(html));
    let added = 0;
    for (const project of projects) {
      const row = mapLibrium(project);
      if (!row || seen.has(row.id)) continue;
      seen.add(row.id);
      out.push(row);
      added++;
    }
    if (added === 0) break;
  }
  return out;
}

function mapModrinthHit(hit: any): LiveServer | null {
  const java = hit?.minecraft_java_server || hit?.minecraft_server || {};
  const ping = java?.ping?.data || {};
  const addr = String(java?.address || java?.ping?.address || '').trim();
  const host = addr.replace(/^mc:\/\//i, '').split('/')[0].split(':')[0];
  const port = Number(String(addr).split(':')[1]) || 25565;
  if (!host || !/^[a-z0-9.-]+$/i.test(host)) return null;
  const id = String(hit?.project_id || hit?.id || host);
  const versions = Array.isArray(hit?.game_versions)
    ? hit.game_versions.map((v: unknown) => String(v)).slice(0, 4)
    : [];
  const ver = String(ping?.version_name || '');
  if (ver && !versions.includes(ver)) versions.unshift(ver);
  const players = num(ping?.players_online);
  const maxPlayers = num(ping?.players_max);
  const gallery = Array.isArray(hit?.gallery) ? hit.gallery : [];
  const shots = gallery
    .map((g: any) => (typeof g === 'string' ? g : String(g?.url || '')))
    .filter(Boolean)
    .slice(0, 8);
  const content = java?.content || {};
  const kind = String(content?.kind || '');
  const secs = Number(ping?.latency?.secs) || 0;
  const nanos = Number(ping?.latency?.nanos);
  const latency = Number.isFinite(nanos) ? Math.round(secs * 1000 + nanos / 1e6) : null;
  return {
    id: `mr:${id}`,
    source: 'modrinth',
    name: fixText(hit?.name || hit?.title || host),
    ip: host,
    port,
    desc: fixText(hit?.summary || hit?.description || ''),
    icon: String(hit?.icon_url || ''),
    banner: shots[0] || '',
    screenshots: shots,
    versions,
    modes: Array.isArray(hit?.categories) ? hit.categories.map((c: unknown) => String(c)).slice(0, 6) : [],
    language: guessLang(`${fixText(hit?.name || '')} ${fixText(hit?.summary || '')}`, ''),
    country: '',
    region: regionFor('', host),
    players,
    maxPlayers,
    online: players != null ? true : null,
    rating: null,
    reviews: null,
    followers: num(hit?.follows),
    joins: num(java?.verified_plays_2w),
    latency,
    modpackName: kind === 'modpack' ? fixText(content?.project_name || '') : '',
    modpackIcon: kind === 'modpack' ? String(content?.project_icon || '') : '',
    modpackProjectId: kind === 'modpack' ? String(content?.project_id || '') : '',
    modpackVersionId: kind === 'modpack' ? String(content?.version_id || '') : '',
    projectUrl: `https://modrinth.com/server/${encodeURIComponent(String(hit?.slug || id))}`,
    projectId: '',
    serverId: '',
    history: players != null ? [players] : [],
  };
}

async function loadModrinth(): Promise<LiveServer[]> {
  const filters = 'project_types = "minecraft_java_server"';
  const out: LiveServer[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= 2; page++) {
    const url = `https://api.modrinth.com/v3/search?limit=40&page=${page}&index=relevance&new_filters=${encodeURIComponent(filters)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(14000),
    });
    if (!res.ok) break;
    const data = await res.json();
    const hits = Array.isArray(data?.hits) ? data.hits : [];
    let added = 0;
    for (const hit of hits) {
      const row = mapModrinthHit(hit);
      if (!row || seen.has(row.id)) continue;
      seen.add(row.id);
      out.push(row);
      added++;
    }
    if (added === 0) break;
  }
  return out;
}

async function loadUndefined(): Promise<LiveServer[]> {
  const res = await fetch(`${getApiBase()}/api/listings`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return [];
  const data = await res.json();
  const rows = Array.isArray(data?.servers) ? data.servers : [];
  const out: LiveServer[] = [];
  for (const raw of rows) {
    const ip = String(raw?.ip || '').trim().toLowerCase();
    const port = Number(raw?.port);
    if (!ip.endsWith('.uprojects.site') || !Number.isInteger(port) || port < 1 || port > 65535) continue;
    const version = String(raw?.version || '').trim();
    out.push({
      id: `uc-${String(raw?.id || ip).slice(0, 80)}`,
      source: 'undefined',
      name: String(raw?.name || ip).slice(0, 64),
      ip,
      port,
      desc: String(raw?.desc || raw?.motd || '').slice(0, 2000),
      icon: String(raw?.icon || ''),
      banner: '',
      screenshots: Array.isArray(raw?.screenshots) ? raw.screenshots.slice(0, 5).map((item: unknown) => String(item)) : [],
      versions: version ? [version] : [],
      modes: ['vanilla'],
      language: 'ru',
      country: 'RU',
      region: 'cis',
      players: null,
      maxPlayers: Number(raw?.maxPlayers) || null,
      online: null,
      rating: null,
      reviews: null,
      followers: null,
      joins: null,
      latency: null,
      modpackName: '',
      modpackIcon: '',
      modpackProjectId: '',
      modpackVersionId: '',
      projectUrl: '',
      projectId: '',
      serverId: '',
      history: [],
    });
  }
  return out;
}

export async function loadLiveServerCatalog(force = false): Promise<LiveServer[]> {
  if (!force && cache.data.length && Date.now() - cache.at < CACHE_MS) return cache.data;
  if (inflight) return inflight;
  inflight = (async () => {
    const [librium, modrinth, undefinedRows] = await Promise.all([
      loadLibrium().catch(() => [] as LiveServer[]),
      loadModrinth().catch(() => [] as LiveServer[]),
      loadUndefined().catch(() => [] as LiveServer[]),
    ]);
    const seen = new Set<string>();
    const merged: LiveServer[] = [];
    for (const row of [...librium, ...modrinth, ...undefinedRows]) {
      const key = `${row.ip.toLowerCase()}:${row.port}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(row);
    }
    if (merged.length) {
      cache = { at: Date.now(), data: merged };
    }
    return merged.length ? merged : cache.data;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

function imagesFromHtml(html: string): string[] {
  const found = html.match(/https:\/\/static\.libriumhub\.com\/public\/projects\/[^"'\\\s]+?\.(?:webp|png|jpe?g)/g) || [];
  const uniq: string[] = [];
  for (const url of found) {
    if (/avatar/i.test(url)) continue;
    if (!uniq.includes(url)) uniq.push(url);
  }
  return uniq.slice(0, 8);
}

function downsampleOnline(points: OnlineHistory['points'], maxN = 96): OnlineHistory['points'] {
  if (points.length <= maxN) return points;
  const bucket = Math.ceil(points.length / maxN);
  const out: OnlineHistory['points'] = [];
  for (let i = 0; i < points.length; i += bucket) {
    const slice = points.slice(i, i + bucket);
    out.push(slice.reduce((best, row) => (row.online > best.online ? row : best)));
  }
  return out;
}

/** История онлайна Librium: /api/projects/{id}/servers/{uuid}/monitoring/history */
export async function loadServerHistory(projectId: string, serverId: string, periodRaw: string): Promise<OnlineHistory | null> {
  const period = periodRaw === '7d' || periodRaw === '30d' ? periodRaw : '24h';
  if (!projectId || !serverId) return null;
  const url = `https://libriumhub.com/api/projects/${encodeURIComponent(projectId)}/servers/${encodeURIComponent(serverId)}/monitoring/history?period=${period}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) return null;
  const json = await res.json();
  const raw = json?.data?.points;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const points = raw.map((p: any) => ({
    t: String(p?.timestamp || ''),
    online: Math.max(0, Math.round(Number(p?.onlineMaximum ?? p?.onlineAverage ?? 0))),
  }));
  const values = points.map((p) => p.online);
  const peak = Math.max(...values);
  const min = Math.min(...values);
  const avg = values.reduce((sum, n) => sum + n, 0) / values.length;
  const peakAt = points.find((p) => p.online === peak)?.t || '';
  const minAt = points.find((p) => p.online === min)?.t || '';
  let ok = 0;
  let bad = 0;
  for (const p of raw) {
    ok += Number(p?.successfulChecks) || 0;
    bad += Number(p?.failedChecks) || 0;
  }
  return {
    period,
    points: downsampleOnline(points),
    peak,
    min,
    avg,
    uptime: ok + bad > 0 ? (ok / (ok + bad)) * 100 : null,
    peakAt,
    minAt,
  };
}

export async function loadServerDetail(source: string, id: string): Promise<(Partial<LiveServer> & { historySeries?: OnlineHistory | null }) | null> {
  if (source === 'librium') {
    const slug = id.replace(/^lh:/, '');
    const html = await fetchText(`https://libriumhub.com/project/${encodeURIComponent(slug)}`, 14000);
    const decoded = decodeFlight(html);
    const shots = imagesFromHtml(decoded + html);
    let desc = '';
    const descMatch = /"full_description":"((?:\\.|[^"\\])*)"/.exec(decoded)
      || /"description":"((?:\\.|[^"\\])*)"/.exec(decoded);
    if (descMatch) {
      try {
        desc = fixText(JSON.parse(`"${descMatch[1]}"`));
      } catch {
        desc = fixText(descMatch[1]);
      }
    }
    const blob = `${decoded}\n${html}`.replace(/\\"/g, '"');
    const projectId = /"projectCore":\{"uuid":"([^"]+)"/.exec(blob)?.[1] || '';
    const serverId = /"servers":\[\{"uuid":"([^"]+)"/.exec(blob)?.[1] || '';
    const historySeries = projectId && serverId
      ? await loadServerHistory(projectId, serverId, '24h').catch(() => null)
      : null;
    return {
      screenshots: shots,
      banner: shots[0] || '',
      desc: desc.length > 40 ? desc : undefined,
      projectId,
      serverId,
      historySeries,
    };
  }
  if (source === 'modrinth') {
    const projectId = id.replace(/^mr:/, '');
    const res = await fetch(`https://api.modrinth.com/v3/project/${encodeURIComponent(projectId)}`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(14000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const row = mapModrinthHit({ ...data, project_id: projectId });
    if (!row) return { desc: fixText(data?.description || '') };
    return row;
  }
  return null;
}
