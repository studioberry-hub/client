// Группы версий Minecraft по манифесту Mojang (version_manifest_v2).
// rd / classic / infdev лежат в type=old_alpha — их не выкидываем, а показываем отдельно.

export type McVersionGroup = 'release' | 'snapshot' | 'old_beta' | 'old_alpha' | 'ancient';

export const MC_VERSION_GROUPS: McVersionGroup[] = [
  'release',
  'snapshot',
  'old_beta',
  'old_alpha',
  'ancient',
];

export const DEFAULT_VERSION_FILTERS: Record<McVersionGroup, boolean> = {
  release: true,
  snapshot: false,
  old_beta: false,
  old_alpha: false,
  ancient: false,
};

/** До альфы: pre-classic (rd), classic (c0), infdev, indev. */
export function isAncientVersionId(id: string): boolean {
  const s = String(id || '').trim().toLowerCase();
  if (!s) return false;
  return (
    s.startsWith('rd-')
    || s.startsWith('rd_')
    || /^c0[._]/.test(s)
    || s.startsWith('inf-')
    || s.startsWith('inf_')
    || s.startsWith('in-')
    || s.startsWith('indev')
  );
}

export function classifyMcVersion(id: string, type: string): McVersionGroup {
  const name = String(id || '').trim();
  const kind = String(type || '').toLowerCase();
  if (isAncientVersionId(name)) return 'ancient';
  if (kind === 'release') return 'release';
  if (kind === 'snapshot') return 'snapshot';
  if (kind === 'old_beta' || /^b\d/i.test(name)) return 'old_beta';
  if (kind === 'old_alpha' || /^a\d/i.test(name)) return 'old_alpha';
  if (kind === 'ancient') return 'ancient';
  return 'ancient';
}
