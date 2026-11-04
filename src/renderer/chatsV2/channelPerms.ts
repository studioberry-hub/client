// Права канала в духе Discord: нейтрально / разрешить / запретить поверх прав ролей.

import type { ChannelOverwrite } from './types';

export type { ChannelOverwrite };

export type PermRow = [key: string, label: string, hint: string];

/** Права, которые есть у участника, пока роль или канал их не забрали. */
const ON_BY_DEFAULT = new Set([
  'view_channel',
  'send_messages',
  'attach_files',
  'add_reactions',
  'embed_links',
  'read_message_history',
  'connect',
  'speak',
  'create_invite',
  'send_voice_messages',
  'use_external_emojis',
  'use_voice_activation',
]);

export const TEXT_CHANNEL_PERMS: Array<[string, PermRow[]]> = [
  [
    'Общие права канала',
    [
      ['view_channel', 'Просматривать канал', 'Без этого права канал скрыт.'],
      ['manage_channels', 'Управлять каналом', 'Название, тема, права и удаление.'],
      ['manage_messages', 'Управлять сообщениями', 'Удалять чужие сообщения и закреплять.'],
      ['read_message_history', 'Читать историю сообщений', ''],
      ['create_invite', 'Создавать приглашения', ''],
    ],
  ],
  [
    'Текстовые права',
    [
      ['send_messages', 'Отправлять сообщения', ''],
      ['send_voice_messages', 'Отправлять голосовые', ''],
      ['embed_links', 'Вставлять ссылки', ''],
      ['attach_files', 'Прикреплять файлы', ''],
      ['add_reactions', 'Добавлять реакции', ''],
      ['use_external_emojis', 'Внешние эмодзи', ''],
      ['mention_everyone', 'Упоминать @everyone и @here', ''],
    ],
  ],
];

export const VOICE_CHANNEL_PERMS: Array<[string, PermRow[]]> = [
  [
    'Общие права канала',
    [
      ['view_channel', 'Просматривать канал', 'Без этого права канал скрыт.'],
      ['manage_channels', 'Управлять каналом', 'Название, лимит и права.'],
      ['create_invite', 'Создавать приглашения', ''],
    ],
  ],
  [
    'Голосовые права',
    [
      ['connect', 'Подключаться', ''],
      ['speak', 'Говорить', ''],
      ['use_voice_activation', 'Использовать активацию по голосу', ''],
      ['priority_speaker', 'Приоритетный режим', ''],
      ['mute_members', 'Отключать микрофон участникам', ''],
      ['deafen_members', 'Отключать звук участникам', ''],
      ['move_members', 'Перемещать участников', ''],
    ],
  ],
];

export const SLOWMODE_OPTIONS: Array<[number, string]> = [
  [0, 'Выключен'],
  [5, '5 секунд'],
  [10, '10 секунд'],
  [15, '15 секунд'],
  [30, '30 секунд'],
  [60, '1 минута'],
  [120, '2 минуты'],
  [300, '5 минут'],
  [600, '10 минут'],
  [900, '15 минут'],
  [1800, '30 минут'],
  [3600, '1 час'],
  [7200, '2 часа'],
  [21600, '6 часов'],
];

export const BITRATE_OPTIONS: Array<[number, string]> = [
  [8000, '8 кбит/с'],
  [16000, '16 кбит/с'],
  [32000, '32 кбит/с'],
  [64000, '64 кбит/с'],
  [96000, '96 кбит/с'],
  [128000, '128 кбит/с'],
];

function applyOverwrite(value: boolean, row: ChannelOverwrite | undefined, perm: string): boolean {
  if (!row) return value;
  if (row.deny?.[perm]) return false;
  if (row.allow?.[perm]) return true;
  return value;
}

/** Итог права: админ обходит канал, затем @everyone, роли и личное переопределение. */
export function resolveChannelPerm(opts: {
  admin?: boolean;
  rolePerms: Array<Record<string, boolean>>;
  roleIds: number[];
  memberId: number;
  overwrites: ChannelOverwrite[];
  perm: string;
  channelKind?: string;
}): boolean {
  if (opts.admin) return true;
  if (opts.rolePerms.some((p) => p.administrator)) return true;
  const explicit = opts.rolePerms.some((p) => p[opts.perm] === true);
  let value = explicit || ON_BY_DEFAULT.has(opts.perm);
  const kind = opts.channelKind || 'text';
  if ((kind === 'news' || kind === 'rules') && opts.perm === 'send_messages' && !explicit) value = false;
  const everyone = opts.overwrites.find((o) => o.target_id === 0);
  value = applyOverwrite(value, everyone, opts.perm);
  let allow = false;
  let deny = false;
  for (const id of opts.roleIds) {
    const row = opts.overwrites.find((o) => o.target_type === 'role' && o.target_id === id);
    if (row?.deny?.[opts.perm]) deny = true;
    if (row?.allow?.[opts.perm]) allow = true;
  }
  if (deny) value = false;
  else if (allow) value = true;
  const member = opts.overwrites.find((o) => o.target_type === 'member' && o.target_id === opts.memberId);
  return applyOverwrite(value, member, opts.perm);
}

export function overwriteState(row: ChannelOverwrite | undefined, perm: string): 'inherit' | 'allow' | 'deny' {
  if (row?.deny?.[perm]) return 'deny';
  if (row?.allow?.[perm]) return 'allow';
  return 'inherit';
}

export function setOverwriteState(row: ChannelOverwrite, perm: string, state: 'inherit' | 'allow' | 'deny'): void {
  row.allow = { ...(row.allow || {}) };
  row.deny = { ...(row.deny || {}) };
  delete row.allow[perm];
  delete row.deny[perm];
  if (state === 'allow') row.allow[perm] = true;
  if (state === 'deny') row.deny[perm] = true;
}
