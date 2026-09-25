import * as path from 'path';

const INSTANCE_BASE = 'uclient';

export function sanitizeBuildId(buildId: string): string {
  return String(buildId || '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-]/g, '');
}

/**
 * Основной каталог пользовательских данных лаунчера:
 * Windows: %APPDATA%\.Undefined Client
 * macOS: ~/Library/Application Support/.Undefined Client
 * Linux: ~/.Undefined Client
 */
export function getLauncherDataDir(): string {
  if (process.platform === 'win32') {
    const base = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
    return path.join(base, '.Undefined Client');
  }
  if (process.platform === 'darwin') {
    return path.join(process.env.HOME || '', 'Library', 'Application Support', '.Undefined Client');
  }
  return path.join(process.env.HOME || '', '.Undefined Client');
}

/**
 * Каталог хранения изолированных инстансов/сборок Minecraft:
 * Windows: %APPDATA%\.uclient
 * macOS: ~/Library/Application Support/uclient
 * Linux: ~/.uclient
 */
export function getInstancesDir(): string {
  if (process.platform === 'win32') {
    const base = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
    return path.join(base, `.${INSTANCE_BASE}`);
  }
  if (process.platform === 'darwin') {
    return path.join(process.env.HOME || '', 'Library', 'Application Support', INSTANCE_BASE);
  }
  return path.join(process.env.HOME || '', `.${INSTANCE_BASE}`);
}

/**
 * Корень конкретного изолированного инстанса сборки.
 */
export function getInstanceRoot(buildId: string): string {
  const sanitized = sanitizeBuildId(buildId);
  return path.join(getInstancesDir(), sanitized);
}

/**
 * Стандартный каталог .minecraft (для импорта миров, версий и текстур):
 * Windows: %APPDATA%\.minecraft
 * macOS: ~/Library/Application Support/minecraft
 * Linux: ~/.minecraft
 */
export function getDefaultMinecraftDir(): string {
  if (process.platform === 'win32') {
    const base = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
    return path.join(base, '.minecraft');
  }
  if (process.platform === 'darwin') {
    return path.join(process.env.HOME || '', 'Library', 'Application Support', 'minecraft');
  }
  return path.join(process.env.HOME || '', '.minecraft');
}
