// Перенос сборки на другой путь Windows: копируем, сверяем, старый каталог не удаляем.
import * as fs from 'fs';
import * as path from 'path';
import { getInstanceRoot, sanitizeBuildId, setInstanceOverride } from './paths';

type ProgressFn = (data: any) => void;

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop()!;
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) out.push(full);
    }
  }
  return out;
}

function treeStats(dir: string): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  for (const file of walkFiles(dir)) {
    files++;
    try { bytes += fs.statSync(file).size; } catch { /* файл исчез */ }
  }
  return { files, bytes };
}

export async function moveInstanceCopy(opts: {
  buildId: string;
  destParent: string;
  sendProgress: ProgressFn;
}): Promise<{ ok: boolean; path?: string; error?: string }> {
  if (process.platform !== 'win32') return { ok: false, error: 'windows_only' };
  const buildId = String(opts.buildId || '').trim();
  const parent = path.resolve(String(opts.destParent || '').trim());
  if (!buildId || !path.isAbsolute(parent)) return { ok: false, error: 'bad_path' };
  const rootDrive = path.parse(parent).root;
  if (!rootDrive || !fs.existsSync(rootDrive)) return { ok: false, error: 'drive_missing' };

  const src = getInstanceRoot(buildId);
  const dest = path.join(parent, sanitizeBuildId(buildId));
  if (path.resolve(src) === path.resolve(dest)) return { ok: true, path: src };
  if (!fs.existsSync(src)) {
    setInstanceOverride(buildId, dest);
    await fs.promises.mkdir(dest, { recursive: true });
    return { ok: true, path: dest };
  }

  const files = walkFiles(src);
  opts.sendProgress({ type: 'start', filename: path.basename(src), size: files.length });
  await fs.promises.mkdir(dest, { recursive: true });
  let done = 0;
  for (const file of files) {
    const rel = path.relative(src, file);
    const target = path.join(dest, rel);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.copyFile(file, target);
    done++;
    if (done % 20 === 0 || done === files.length) {
      const percent = files.length ? Math.round((done / files.length) * 100) : 100;
      opts.sendProgress({ type: 'progress', percent, received: done, total: files.length, filename: rel });
    }
  }

  const a = treeStats(src);
  const b = treeStats(dest);
  if (a.files !== b.files || a.bytes !== b.bytes) {
    return { ok: false, error: 'verify_failed', path: dest };
  }
  setInstanceOverride(buildId, dest);
  opts.sendProgress({ type: 'done', filename: dest, filePath: dest });
  return { ok: true, path: dest };
}
