// Матрица версий мира для предпросмотра (shared: main + renderer).
//
// Live ограничен mesherWasm (pc ≤ 1.21.6). Новее — live с аппроксимацией блоков
// и/или экспорт через Minecraft Web Exporter.

export type PreviewStrategy = 'live' | 'export' | 'unsupported';

export interface VersionGate {
  strategy: PreviewStrategy;
  renderVersion: string;
  degraded: boolean;
  /** Можно ли предложить live параллельно с export. */
  liveAvailable: boolean;
  reason: 'ok' | 'live_degraded' | 'need_export' | 'too_old' | 'unreadably_new';
  messageKey: string;
  messageParams?: Record<string, string>;
}

export const MIN_READ_DATA_VERSION = 1519;
export const MESHER_MAX_VERSION = '1.21.6';
export const MESHER_MAX_DATA_VERSION = 4435;
/** Потолок парсера Anvil в main (обновлять вместе с anvil.ts). */
export const READ_MAX_DATA_VERSION = 4903; // 26.2

const RELEASES: Array<[number, string]> = [
  [1519, '1.13'], [1631, '1.13.2'],
  [1976, '1.14.4'], [2230, '1.15.2'], [2586, '1.16.5'],
  [2730, '1.17.1'], [2975, '1.18.2'], [3337, '1.19.4'],
  [3700, '1.20.4'], [3839, '1.20.6'],
  [3955, '1.21.1'], [4189, '1.21.4'], [4325, '1.21.5'],
  [4435, '1.21.6'], [4440, '1.21.8'], [4556, '1.21.10'],
  [4671, '1.21.11'], [4790, '26.1.2'], [4903, '26.2'],
];

export function guessVersionName(dataVersion: number): string {
  let name = `DataVersion ${dataVersion}`;
  for (const [dv, n] of RELEASES) {
    if (dataVersion >= dv) name = n;
  }
  return name;
}

export function resolvePreviewStrategy(dataVersion: number, preferExport = false): VersionGate {
  const ver = guessVersionName(dataVersion);
  const mesher = MESHER_MAX_VERSION;

  if (!dataVersion || dataVersion < MIN_READ_DATA_VERSION) {
    return {
      strategy: 'unsupported',
      renderVersion: mesher,
      degraded: false,
      liveAvailable: false,
      reason: 'too_old',
      messageKey: 'be.worldPreviewTooOld',
    };
  }

  if (dataVersion > READ_MAX_DATA_VERSION) {
    return {
      strategy: 'export',
      renderVersion: mesher,
      degraded: true,
      liveAvailable: false,
      reason: 'unreadably_new',
      messageKey: 'be.worldPreviewNeedExport',
      messageParams: { version: ver, mesher },
    };
  }

  // Новее мешера (в т.ч. 26.x): по умолчанию export, live только как упрощённый fallback.
  if (dataVersion > MESHER_MAX_DATA_VERSION) {
    if (preferExport || dataVersion >= 4790) {
      return {
        strategy: 'export',
        renderVersion: mesher,
        degraded: true,
        liveAvailable: dataVersion <= READ_MAX_DATA_VERSION,
        reason: 'need_export',
        messageKey: 'be.worldPreviewNeedExport',
        messageParams: { version: ver, mesher },
      };
    }
    return {
      strategy: 'live',
      renderVersion: mesher,
      degraded: true,
      liveAvailable: true,
      reason: 'live_degraded',
      messageKey: 'be.worldPreviewDegraded',
      messageParams: { version: ver, mesher },
    };
  }

  if (preferExport) {
    return {
      strategy: 'export',
      renderVersion: mesher,
      degraded: false,
      liveAvailable: true,
      reason: 'need_export',
      messageKey: 'be.worldPreviewExportPreferred',
      messageParams: { version: ver },
    };
  }

  return {
    strategy: 'live',
    renderVersion: mesher,
    degraded: false,
    liveAvailable: true,
    reason: 'ok',
    messageKey: 'be.worldPreviewLiveOk',
    messageParams: { mesher },
  };
}

export function previewBadge(dataVersion: number): {
  kind: 'live' | 'degraded' | 'export' | 'unsupported';
  labelKey: string;
} {
  if (!dataVersion || dataVersion < MIN_READ_DATA_VERSION) {
    return { kind: 'unsupported', labelKey: 'be.worldBadgeUnsupported' };
  }
  if (dataVersion > READ_MAX_DATA_VERSION) {
    return { kind: 'export', labelKey: 'be.worldBadgeExport' };
  }
  // 26.1.2+ — экспорт предпочтителен (live-мешер только до 1.21.6)
  if (dataVersion >= 4790) {
    return { kind: 'export', labelKey: 'be.worldBadgeExport' };
  }
  if (dataVersion > MESHER_MAX_DATA_VERSION) {
    return { kind: 'degraded', labelKey: 'be.worldBadgeDegraded' };
  }
  return { kind: 'live', labelKey: 'be.worldBadgeLive' };
}
