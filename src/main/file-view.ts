// Окно файла, поиск и точечная замена. Модель видит кусок с номерами строк и меняет фрагмент, а не весь файл.

import fs from 'fs';
import path from 'path';

const SKIP_DIR = new Set([
  'libraries',
  'versions',
  'cache',
  '.cache',
  'crash-reports',
  'region',
  'poi',
  'entities',
  'playerdata',
  'node_modules',
  '.git',
]);

const BINARY_RE = /\.(jar|zip|gz|tgz|7z|rar|tar|png|jpe?g|gif|webp|bmp|ico|exe|dll|so|dylib|class|nbt|mca|dat|db|sqlite3?|lock|ogg|mp3|wav|flac|bin|pak|litemod|schem|schematic)$/i;

const WINDOW_LINES = 160;
const WINDOW_CHARS = 4200;

export type FileEntry = { name: string; dir: boolean; size: number };

export type FileHit = { path: string; line?: number; text?: string };

export function fsProblem(err: unknown): string {
  const code = err && typeof err === 'object' && 'code' in err ? String((err as { code?: string }).code || '') : '';
  if (code === 'ENOENT') return 'Файл не найден';
  if (code === 'EISDIR') return 'Это папка. Нужен путь к файлу внутри неё.';
  if (code === 'EACCES' || code === 'EPERM') return 'Нет доступа к файлу';
  return err instanceof Error ? err.message : String(err);
}

export function viewText(text: string, offset = 1, limit = WINDOW_LINES): {
  start: number;
  end: number;
  total: number;
  truncated: boolean;
  body: string;
  note: string;
} {
  const lines = text.split(/\r?\n/);
  const start = Math.max(1, Math.floor(offset) || 1);
  if (start > lines.length) {
    return { start, end: lines.length, total: lines.length, truncated: false, body: '', note: 'Дальше строк нет.' };
  }
  const take = Math.min(400, Math.max(1, Math.floor(limit) || WINDOW_LINES));
  const slice: string[] = [];
  let chars = 0;
  let end = Math.min(start, lines.length) - 1;
  for (let line = start; line <= lines.length && slice.length < take; line += 1) {
    const row = `${line}|${lines[line - 1]}`;
    if (slice.length && chars + row.length > WINDOW_CHARS) break;
    slice.push(row);
    chars += row.length + 1;
    end = line;
  }
  if (!lines.length) end = 0;
  const truncated = end < lines.length;
  const note = truncated
    ? `Строки ${start}–${end} из ${lines.length}. Дальше читай с offset ${end + 1}. Правка — edit: old без номера строки, new как должно стать.`
    : 'Правка — edit: old дословный фрагмент без номера строки, new как должно стать. Файл целиком не переписывай.';
  return { start, end, total: lines.length, truncated, body: slice.join('\n'), note };
}

function countOf(text: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let at = 0;
  while (at <= text.length) {
    const found = text.indexOf(needle, at);
    if (found < 0) break;
    count += 1;
    at = found + needle.length;
  }
  return count;
}

export function applyTextReplace(text: string, old: string, next: string): { ok: true; text: string } | { ok: false; error: string; count?: number } {
  const from = String(old ?? '');
  const to = String(next ?? '');
  if (!from) return { ok: false, error: 'Нужен фрагмент old из прочитанного файла, без номера строки.' };
  if (from === to) return { ok: false, error: 'old и new совпадают, менять нечего.' };
  let source = text;
  let needle = from;
  let insert = to;
  let count = countOf(source, needle);
  if (!count) {
    source = text.replace(/\r\n/g, '\n');
    needle = from.replace(/\r\n/g, '\n');
    insert = to.replace(/\r\n/g, '\n');
    count = countOf(source, needle);
    if (count === 1 && text.includes('\r\n')) {
      return { ok: true, text: source.replace(needle, insert).replace(/\n/g, '\r\n') };
    }
  }
  if (!count) return { ok: false, error: 'Фрагмент не найден. Прочитай файл и скопируй строки дословно, без номеров.' };
  if (count > 1) return { ok: false, error: `Фрагмент встречается ${count} раз. Добавь соседние строки, чтобы он был один.`, count };
  return { ok: true, text: source.replace(needle, insert) };
}

export type FragmentLine = { kind: 'add' | 'del'; text: string };

/** Короткий diff заменённого фрагмента: убранные строки, затем добавленные. */
export function fragmentDiff(before: string, after: string, limit = 24): { added: number; removed: number; lines: FragmentLine[] } {
  const oldLines = String(before ?? '').replace(/\r\n/g, '\n').split('\n');
  const newLines = String(after ?? '').replace(/\r\n/g, '\n').split('\n');
  const clip = (text: string) => text.slice(0, 240);
  return {
    removed: before ? oldLines.length : 0,
    added: after ? newLines.length : 0,
    lines: [
      ...oldLines.slice(0, limit).map((text) => ({ kind: 'del' as const, text: clip(text) })),
      ...newLines.slice(0, limit).map((text) => ({ kind: 'add' as const, text: clip(text) })),
    ],
  };
}

export function refuseShortOverwrite(prev: string, next: string): string | null {
  if (prev.length > 1500 && next.length < prev.length * 0.5) {
    return 'Текст короче файла и сотрёт непрочитанный хвост. Замени фрагмент через edit: old и new.';
  }
  return null;
}

export function aroundText(text: string, anchor: string): { start: number; end: number; total: number; truncated: boolean; body: string; note: string } {
  const norm = text.replace(/\r\n/g, '\n');
  const piece = String(anchor || '').replace(/\r\n/g, '\n').split('\n')[0] || '';
  const at = piece ? norm.indexOf(piece) : -1;
  const line = at < 0 ? 1 : norm.slice(0, at).split('\n').length;
  const view = viewText(text, Math.max(1, line - 6), 18);
  return { ...view, note: 'Фрагмент заменён.' };
}

export function listEntries(abs: string, limit = 80): { entries: FileEntry[]; truncated: boolean } {
  const all = fs.readdirSync(abs, { withFileTypes: true });
  const entries = all.slice(0, limit).map((entry) => ({
    name: entry.name,
    dir: entry.isDirectory(),
    size: entry.isDirectory() ? 0 : fs.statSync(path.join(abs, entry.name)).size,
  }));
  entries.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
  return { entries, truncated: all.length > limit };
}

export function searchFiles(root: string, startRel: string, query: string, kind: 'grep' | 'find'): {
  ok: boolean;
  error?: string;
  matches: FileHit[];
  truncated?: boolean;
  note?: string;
} {
  const needle = query.trim();
  if (!needle) return { ok: false, error: 'Нужен текст для поиска', matches: [] };
  const rootResolved = path.resolve(root);
  const start = path.resolve(rootResolved, startRel || '.');
  if (start !== rootResolved && !start.startsWith(rootResolved + path.sep)) {
    return { ok: false, error: 'Неверный путь', matches: [] };
  }
  const matches: FileHit[] = [];
  let truncated = false;
  const smart = needle === needle.toLowerCase();
  const want = smart ? needle.toLowerCase() : needle;
  const cap = 40;

  const push = (hit: FileHit) => {
    if (matches.length >= cap) {
      truncated = true;
      return;
    }
    matches.push(hit);
  };

  const consider = (abs: string, rel: string) => {
    if (matches.length >= cap) {
      truncated = true;
      return;
    }
    const shown = rel.replace(/\\/g, '/');
    if (kind === 'find') {
      if (shown.toLowerCase().includes(needle.toLowerCase())) push({ path: shown });
      return;
    }
    if (BINARY_RE.test(shown)) return;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(abs);
    } catch {
      return;
    }
    if (!stat.isFile() || stat.size > 256_000) return;
    let buf: Buffer;
    try {
      buf = fs.readFileSync(abs);
    } catch {
      return;
    }
    if (buf.includes(0)) return;
    const lines = buf.toString('utf8').split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const hay = smart ? line.toLowerCase() : line;
      if (!hay.includes(want)) continue;
      push({ path: shown, line: i + 1, text: line.trim().slice(0, 180) });
      if (matches.length >= cap) return;
    }
  };

  const walk = (abs: string, rel: string, depth: number) => {
    if (truncated || depth > 8) return;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(abs);
    } catch {
      return;
    }
    if (stat.isFile()) {
      consider(abs, rel);
      return;
    }
    if (!stat.isDirectory()) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (matches.length >= cap) {
        truncated = true;
        break;
      }
      if (entry.isDirectory() && SKIP_DIR.has(entry.name)) continue;
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(abs, entry.name), child, depth + 1);
      else consider(path.join(abs, entry.name), child);
    }
  };

  const rel = startRel.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  walk(start, rel, 0);
  return {
    ok: true,
    matches,
    truncated,
    note: truncated ? 'Показаны первые совпадения. Сузь папку или запрос.' : undefined,
  };
}
