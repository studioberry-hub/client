// ===== Резолв и установка зависимостей модов (Modrinth), по аналогии с Prism Launcher =====
// required — качаем транзитивно; optional — только предлагаем; incompatible — конфликт;
// embedded — пропускаем (уже внутри файла).

import * as fs from 'fs';
import * as path from 'path';
import { downloadModrinthFile, runWithConcurrency, PROXY_MAX_CONCURRENT_DOWNLOADS } from './modrinthDownload';

const UA = 'Undefined-Client/mod-deps';
const CONTENT_SUBDIRS: Record<string, string> = {
  mod: 'mods',
  resourcepack: 'resourcepacks',
  shader: 'shaderpacks',
  datapack: 'datapacks',
};

export type ModDepType = 'required' | 'optional' | 'incompatible' | 'embedded';

export type ModInstallOptions = {
  force?: boolean;
  skipDeps?: boolean;
  installOptional?: boolean;
};

export type ResolvedModFile = {
  projectId: string;
  projectSlug?: string;
  title: string;
  versionId: string;
  versionNumber: string;
  filename: string;
  fileUrl: string;
  fileSize: number;
  sha1?: string;
  iconUrl: string;
  description: string;
  contentType: string;
  isDependency: boolean;
};

export type ModDepConflict = {
  projectId: string;
  title: string;
  withProjectId: string;
  withTitle: string;
};

export type ModDepOptional = {
  projectId: string;
  title: string;
  versionId?: string;
};

export type ModDepUnresolved = {
  projectId: string;
  reason: string;
};

export type ModInstallPlan = {
  root: ResolvedModFile;
  toInstall: ResolvedModFile[];
  alreadySatisfied: { projectId: string; title: string }[];
  optional: ModDepOptional[];
  conflicts: ModDepConflict[];
  unresolved: ModDepUnresolved[];
};

export type ModInstallProgress =
  | { type: 'start'; filename: string; size: number; index: number; total: number }
  | { type: 'progress'; filename: string; percent: number; received: number; total: number; index: number }
  | { type: 'file-done'; filename: string; filePath: string; index: number; total: number }
  | { type: 'batch'; i: number; n: number; file: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

export type ModInstallResult =
  | {
      success: true;
      name: string;
      version: string;
      filename: string;
      projectId: string;
      iconUrl: string;
      description: string;
      contentType: string;
      installed: Array<{
        name: string;
        version: string;
        filename: string;
        projectId: string;
        iconUrl: string;
        description: string;
        contentType: string;
        isDependency: boolean;
      }>;
      dependenciesInstalled: number;
      alreadySatisfied: { projectId: string; title: string }[];
      optionalSuggested: ModDepOptional[];
      conflicts: ModDepConflict[];
      unresolved: ModDepUnresolved[];
    }
  | {
      success: false;
      error: string;
      conflicts?: ModDepConflict[];
      unresolved?: ModDepUnresolved[];
      optionalSuggested?: ModDepOptional[];
      pendingDeps?: number;
    };

type ModrinthDep = {
  project_id?: string | null;
  version_id?: string | null;
  file_name?: string | null;
  dependency_type?: string;
};

type ProjectCache = Map<string, any>;
type VersionCache = Map<string, any>;

function normalizeLoaderId(loader: string): string {
  return String(loader || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

async function modrinthJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Подбор версии под MC + loader (как в Prism / AI). */
export function pickCompatibleModrinthVersion(
  list: any[],
  gameVersion: string,
  loader: string,
  projectType: string,
): any | null {
  if (!Array.isArray(list) || !list.length) return null;
  const gv = String(gameVersion || '').trim();
  const ld = normalizeLoaderId(loader);
  const needLoader = Boolean(ld && ld !== 'vanilla' && (projectType === 'mod' || !projectType));

  const scored = list.filter((v) => {
    const versions: string[] = Array.isArray(v?.game_versions) ? v.game_versions.map(String) : [];
    const loaders: string[] = Array.isArray(v?.loaders)
      ? v.loaders.map((x: unknown) => normalizeLoaderId(String(x)))
      : [];
    if (gv && versions.length && !versions.includes(gv)) return false;
    if (needLoader && loaders.length && !loaders.includes(ld)) return false;
    return true;
  });

  return scored[0] || null;
}

function primaryFile(version: any): any | null {
  if (!version?.files?.length) return null;
  return version.files.find((f: any) => f.primary) || version.files[0] || null;
}

function projectTitle(project: any, fallback: string): string {
  return String(project?.title || project?.slug || fallback || '').trim() || fallback;
}

/**
 * Собирает projectId уже установленных модов/контента:
 * метаданные сборки + кэш .uclient-cache.json.
 */
export function collectInstalledProjectIds(
  instanceRoot: string,
  buildMeta?: {
    mods?: Array<{ projectId?: string }>;
    resourcePacks?: Array<{ projectId?: string }>;
    shaders?: Array<{ projectId?: string }>;
    dataPacks?: Array<{ projectId?: string }>;
  } | null,
): Set<string> {
  const ids = new Set<string>();
  const lists = [
    buildMeta?.mods,
    buildMeta?.resourcePacks,
    buildMeta?.shaders,
    buildMeta?.dataPacks,
  ];
  for (const list of lists) {
    for (const item of list || []) {
      const id = String(item?.projectId || '').trim();
      if (id) ids.add(id);
    }
  }
  try {
    const cachePath = path.join(instanceRoot, '.uclient-cache.json');
    if (fs.existsSync(cachePath)) {
      const cache = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      for (const entry of Object.values(cache || {}) as any[]) {
        const id = String(entry?.projectId || '').trim();
        if (id) ids.add(id);
      }
    }
  } catch {
    /* ignore */
  }
  return ids;
}

async function fetchProject(projectId: string, cache: ProjectCache): Promise<any | null> {
  const key = String(projectId);
  if (cache.has(key)) return cache.get(key);
  const data = await modrinthJson(`https://api.modrinth.com/v2/project/${encodeURIComponent(key)}`);
  cache.set(key, data);
  return data;
}

/** Пакетная загрузка проектов — один запрос вместо N. */
async function fetchProjectsBatch(ids: string[], cache: ProjectCache): Promise<void> {
  const missing = [...new Set(ids.map(String).filter(Boolean))].filter((id) => !cache.has(id));
  if (!missing.length) return;
  // Modrinth: до ~100 id за раз
  for (let i = 0; i < missing.length; i += 80) {
    const chunk = missing.slice(i, i + 80);
    const data = await modrinthJson(
      `https://api.modrinth.com/v2/projects?ids=${encodeURIComponent(JSON.stringify(chunk))}`,
    );
    if (Array.isArray(data)) {
      for (const p of data) {
        if (p?.id) cache.set(String(p.id), p);
      }
    }
    for (const id of chunk) {
      if (!cache.has(id)) cache.set(id, null);
    }
  }
}

async function fetchVersionById(versionId: string, cache: VersionCache): Promise<any | null> {
  const key = String(versionId);
  if (cache.has(key)) return cache.get(key);
  const data = await modrinthJson(`https://api.modrinth.com/v2/version/${encodeURIComponent(key)}`);
  if (data) cache.set(key, data);
  return data;
}

async function fetchVersionsBatch(ids: string[], cache: VersionCache): Promise<void> {
  const missing = [...new Set(ids.map(String).filter(Boolean))].filter((id) => !cache.has(id));
  if (!missing.length) return;
  for (let i = 0; i < missing.length; i += 80) {
    const chunk = missing.slice(i, i + 80);
    const data = await modrinthJson(
      `https://api.modrinth.com/v2/versions?ids=${encodeURIComponent(JSON.stringify(chunk))}`,
    );
    if (Array.isArray(data)) {
      for (const v of data) {
        if (v?.id) cache.set(String(v.id), v);
      }
    }
  }
}

/**
 * Список версий с фильтром на стороне Modrinth.
 * Без фильтра Fabric API отдаёт тысячи версий — это и тормозило установку.
 */
async function fetchProjectVersions(
  projectId: string,
  gameVersion: string,
  loader: string,
): Promise<any[]> {
  const params = new URLSearchParams();
  const gv = String(gameVersion || '').trim();
  const ld = normalizeLoaderId(loader);
  if (gv) params.set('game_versions', JSON.stringify([gv]));
  if (ld && ld !== 'vanilla') params.set('loaders', JSON.stringify([ld]));
  const qs = params.toString();
  const url =
    `https://api.modrinth.com/v2/project/${encodeURIComponent(projectId)}/version` +
    (qs ? `?${qs}` : '');
  const data = await modrinthJson(url);
  return Array.isArray(data) ? data : [];
}

async function resolveVersionForProject(
  projectId: string,
  preferredVersionId: string | undefined,
  gameVersion: string,
  loader: string,
  projectType: string,
  versionCache: VersionCache,
): Promise<any | null> {
  if (preferredVersionId) {
    const v = await fetchVersionById(preferredVersionId, versionCache);
    if (v) return v;
  }
  const list = await fetchProjectVersions(projectId, gameVersion, loader);
  const picked = pickCompatibleModrinthVersion(list, gameVersion, loader, projectType);
  if (picked?.id) versionCache.set(String(picked.id), picked);
  return picked;
}

function toResolvedFile(
  project: any,
  version: any,
  contentTypeHint: string | undefined,
  isDependency: boolean,
): ResolvedModFile | null {
  const file = primaryFile(version);
  if (!file?.url || !file?.filename) return null;
  const projectId = String(project?.id || version?.project_id || '').trim();
  if (!projectId) return null;
  const projectType = (contentTypeHint && CONTENT_SUBDIRS[contentTypeHint]
    ? contentTypeHint
    : String(project?.project_type || 'mod')) as string;
  return {
    projectId,
    projectSlug: project?.slug ? String(project.slug) : undefined,
    title: projectTitle(project, file.filename),
    versionId: String(version.id),
    versionNumber: String(version.version_number || ''),
    filename: String(file.filename),
    fileUrl: String(file.url),
    fileSize: Number(file.size) || 0,
    sha1: file.hashes?.sha1 ? String(file.hashes.sha1) : undefined,
    iconUrl: String(project?.icon_url || ''),
    description: String(project?.description || ''),
    contentType: CONTENT_SUBDIRS[projectType] ? projectType : 'mod',
    isDependency,
  };
}

/**
 * Строит план установки: корневой мод + транзитивные required + конфликты/optional.
 */
export async function resolveModInstallPlan(opts: {
  projectId: string;
  versionId?: string;
  contentType?: string;
  gameVersion: string;
  loader: string;
  installedProjectIds: Set<string>;
  skipDeps?: boolean;
  installOptional?: boolean;
}): Promise<ModInstallPlan | { error: string }> {
  const projectCache: ProjectCache = new Map();
  const versionCache: VersionCache = new Map();
  const installed = new Set(opts.installedProjectIds);

  const rootProject = await fetchProject(opts.projectId, projectCache);
  if (!rootProject) return { error: 'project_not_found' };

  const rootType = (opts.contentType && CONTENT_SUBDIRS[opts.contentType]
    ? opts.contentType
    : String(rootProject.project_type || 'mod')) as string;

  const rootVersion = await resolveVersionForProject(
    opts.projectId,
    opts.versionId,
    opts.gameVersion,
    opts.loader,
    rootType,
    versionCache,
  );
  if (!rootVersion) return { error: 'no_compatible_version' };

  const root = toResolvedFile(rootProject, rootVersion, opts.contentType, false);
  if (!root) return { error: 'no_file' };

  const toInstall: ResolvedModFile[] = [root];
  const alreadySatisfied: { projectId: string; title: string }[] = [];
  const optional: ModDepOptional[] = [];
  const conflicts: ModDepConflict[] = [];
  const unresolved: ModDepUnresolved[] = [];

  // Быстрый путь: нет зависимостей — без обхода графа
  const rootDeps: ModrinthDep[] = Array.isArray(rootVersion?.dependencies)
    ? rootVersion.dependencies
    : [];
  if (opts.skipDeps || !rootDeps.length) {
    return {
      root,
      toInstall,
      alreadySatisfied,
      optional,
      conflicts,
      unresolved,
    };
  }

  const visited = new Set<string>([root.projectId]);
  const plannedIds = new Set<string>([root.projectId]);
  const titleById = new Map<string, string>([[root.projectId, root.title]]);

  type QueueItem = {
    version: any;
    projectId: string;
    title: string;
  };
  let frontier: QueueItem[] = [{ version: rootVersion, projectId: root.projectId, title: root.title }];

  const noteConflict = (
    fromId: string,
    fromTitle: string,
    withId: string,
    withTitle: string,
  ) => {
    if (conflicts.some((c) => c.projectId === fromId && c.withProjectId === withId)) return;
    conflicts.push({
      projectId: fromId,
      title: fromTitle,
      withProjectId: withId,
      withTitle,
    });
  };

  const isPresent = (projectId: string) =>
    installed.has(projectId) || plannedIds.has(projectId);

  while (frontier.length && !opts.skipDeps) {
    // Собираем кандидатов волны, затем тянем проекты/версии пачками параллельно
    type Need = {
      fromId: string;
      fromTitle: string;
      depProjectId: string;
      preferredVersionId?: string;
      kind: 'required' | 'optional' | 'incompatible';
    };
    const needs: Need[] = [];

    for (const current of frontier) {
      const deps: ModrinthDep[] = Array.isArray(current.version?.dependencies)
        ? current.version.dependencies
        : [];

      for (const dep of deps) {
        const depType = String(dep.dependency_type || '').toLowerCase() as ModDepType;
        const depProjectId = String(dep.project_id || '').trim();
        if (!depProjectId) {
          if (dep.file_name && depType === 'required') {
            unresolved.push({
              projectId: String(dep.file_name),
              reason: 'external_dependency',
            });
          }
          continue;
        }
        if (depType === 'embedded') continue;

        if (depType === 'incompatible') {
          needs.push({
            fromId: current.projectId,
            fromTitle: current.title,
            depProjectId,
            kind: 'incompatible',
          });
          continue;
        }

        if (depType === 'optional' && !opts.installOptional) {
          needs.push({
            fromId: current.projectId,
            fromTitle: current.title,
            depProjectId,
            preferredVersionId: dep.version_id ? String(dep.version_id) : undefined,
            kind: 'optional',
          });
          continue;
        }

        if (depType === 'required' || depType === 'optional') {
          if (installed.has(depProjectId)) {
            needs.push({
              fromId: current.projectId,
              fromTitle: current.title,
              depProjectId,
              kind: 'required',
            });
            continue;
          }
          if (visited.has(depProjectId)) continue;
          visited.add(depProjectId);
          needs.push({
            fromId: current.projectId,
            fromTitle: current.title,
            depProjectId,
            preferredVersionId: dep.version_id ? String(dep.version_id) : undefined,
            kind: 'required',
          });
        }
      }
    }

    const projectIds = needs.map((n) => n.depProjectId);
    await fetchProjectsBatch(projectIds, projectCache);

    const versionIds = needs
      .map((n) => n.preferredVersionId)
      .filter((id): id is string => Boolean(id));
    await fetchVersionsBatch(versionIds, versionCache);

    const nextFrontier: QueueItem[] = [];
    const resolveJobs: Array<Promise<void>> = [];

    for (const need of needs) {
      const depProject = projectCache.get(need.depProjectId);
      const depTitle = projectTitle(depProject, need.depProjectId);
      titleById.set(need.depProjectId, depTitle);

      if (need.kind === 'incompatible') {
        if (isPresent(need.depProjectId) && need.depProjectId !== need.fromId) {
          noteConflict(need.fromId, need.fromTitle, need.depProjectId, depTitle);
        }
        continue;
      }

      if (need.kind === 'optional' && !opts.installOptional) {
        if (!isPresent(need.depProjectId) && !optional.some((o) => o.projectId === need.depProjectId)) {
          optional.push({
            projectId: need.depProjectId,
            title: depTitle,
            versionId: need.preferredVersionId,
          });
        }
        continue;
      }

      if (installed.has(need.depProjectId)) {
        if (!alreadySatisfied.some((a) => a.projectId === need.depProjectId)) {
          alreadySatisfied.push({ projectId: need.depProjectId, title: depTitle });
        }
        continue;
      }

      if (plannedIds.has(need.depProjectId)) continue;

      resolveJobs.push(
        (async () => {
          const depProjectType = String(depProject?.project_type || 'mod');
          const depVersion = await resolveVersionForProject(
            need.depProjectId,
            need.preferredVersionId,
            opts.gameVersion,
            opts.loader,
            depProjectType,
            versionCache,
          );
          if (!depVersion) {
            unresolved.push({ projectId: need.depProjectId, reason: 'no_compatible_version' });
            return;
          }
          const resolved = toResolvedFile(depProject, depVersion, depProjectType, true);
          if (!resolved) {
            unresolved.push({ projectId: need.depProjectId, reason: 'no_file' });
            return;
          }
          toInstall.push(resolved);
          plannedIds.add(need.depProjectId);
          nextFrontier.push({
            version: depVersion,
            projectId: need.depProjectId,
            title: resolved.title,
          });
        })(),
      );
    }

    await Promise.all(resolveJobs);
    frontier = nextFrontier;
  }

  // Повторная проверка incompatible по уже закэшированным версиям
  for (const item of toInstall) {
    const ver = versionCache.get(item.versionId);
    const deps: ModrinthDep[] = Array.isArray(ver?.dependencies) ? ver.dependencies : [];
    for (const dep of deps) {
      if (String(dep.dependency_type || '').toLowerCase() !== 'incompatible') continue;
      const otherId = String(dep.project_id || '').trim();
      if (!otherId || !isPresent(otherId) || otherId === item.projectId) continue;
      const otherTitle = titleById.get(otherId) || otherId;
      noteConflict(item.projectId, item.title, otherId, otherTitle);
    }
  }

  return {
    root,
    toInstall,
    alreadySatisfied,
    optional,
    conflicts,
    unresolved,
  };
}

/** Скачивает файлы плана в папки инстанса (параллельно, в лимит прокси). */
export async function downloadModInstallPlan(
  instanceRoot: string,
  plan: ModInstallPlan,
  onProgress?: (ev: ModInstallProgress) => void,
): Promise<ModInstallResult> {
  const installedMeta: Array<{
    name: string;
    version: string;
    filename: string;
    projectId: string;
    iconUrl: string;
    description: string;
    contentType: string;
    isDependency: boolean;
  }> = [];

  const total = plan.toInstall.length;
  let doneCount = 0;

  try {
    await runWithConcurrency(plan.toInstall, PROXY_MAX_CONCURRENT_DOWNLOADS, async (item) => {
      const subDir = CONTENT_SUBDIRS[item.contentType] || 'mods';
      const targetDir = path.join(instanceRoot, subDir);
      if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
      const filePath = path.join(targetDir, item.filename);

      onProgress?.({
        type: 'start',
        filename: item.filename,
        size: item.fileSize,
        index: doneCount + 1,
        total,
      });

      await downloadModrinthFile(item.fileUrl, filePath, {
        reason: item.isDependency ? 'dependency' : 'standalone',
        expectedSize: item.fileSize,
        sha1: item.sha1,
        onProgress: (received, sizeTotal) => {
          const percent = sizeTotal > 0 ? Math.round((received / sizeTotal) * 100) : 0;
          onProgress?.({
            type: 'progress',
            filename: item.filename,
            percent,
            received,
            total: sizeTotal,
            index: doneCount + 1,
          });
        },
      });

      const i = ++doneCount;
      onProgress?.({ type: 'batch', i, n: total, file: item.filename });
      onProgress?.({
        type: 'file-done',
        filename: item.filename,
        filePath,
        index: i,
        total,
      });

      installedMeta.push({
        name: item.title,
        version: item.versionNumber,
        filename: item.filename,
        projectId: item.projectId,
        iconUrl: item.iconUrl,
        description: item.description,
        contentType: item.contentType,
        isDependency: item.isDependency,
      });
    });

    onProgress?.({ type: 'done' });

    const rootMeta = installedMeta.find((m) => !m.isDependency) || installedMeta[0];
    return {
      success: true,
      name: rootMeta?.name || plan.root.title,
      version: rootMeta?.version || plan.root.versionNumber,
      filename: rootMeta?.filename || plan.root.filename,
      projectId: plan.root.projectId,
      iconUrl: plan.root.iconUrl,
      description: plan.root.description,
      contentType: plan.root.contentType,
      installed: installedMeta,
      dependenciesInstalled: installedMeta.filter((m) => m.isDependency).length,
      alreadySatisfied: plan.alreadySatisfied,
      optionalSuggested: plan.optional,
      conflicts: plan.conflicts,
      unresolved: plan.unresolved,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    onProgress?.({ type: 'error', message });
    return { success: false, error: `Download failed: ${message}` };
  }
}

/**
 * Полный цикл: резолв → проверка конфликтов → скачивание.
 * При conflicts и без force возвращает error: 'mod_conflicts' без загрузки.
 */
export async function installModWithDependencies(opts: {
  instanceRoot: string;
  projectId: string;
  versionId?: string;
  contentType?: string;
  gameVersion: string;
  loader: string;
  installedProjectIds: Set<string>;
  options?: ModInstallOptions;
  onProgress?: (ev: ModInstallProgress) => void;
}): Promise<ModInstallResult> {
  const flags = opts.options || {};
  const planOrErr = await resolveModInstallPlan({
    projectId: opts.projectId,
    versionId: opts.versionId,
    contentType: opts.contentType,
    gameVersion: opts.gameVersion,
    loader: opts.loader,
    installedProjectIds: opts.installedProjectIds,
    skipDeps: flags.skipDeps,
    installOptional: flags.installOptional,
  });

  if ('error' in planOrErr) {
    return { success: false, error: planOrErr.error };
  }

  const plan = planOrErr;
  const pendingDeps = plan.toInstall.filter((x) => x.isDependency).length;

  if (plan.conflicts.length && !flags.force) {
    return {
      success: false,
      error: 'mod_conflicts',
      conflicts: plan.conflicts,
      unresolved: plan.unresolved,
      optionalSuggested: plan.optional,
      pendingDeps,
    };
  }

  // Недостающие required без совместимой версии — мягкое предупреждение, установку не блокируем
  return downloadModInstallPlan(opts.instanceRoot, plan, opts.onProgress);
}
