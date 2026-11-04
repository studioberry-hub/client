// Назначение: UI-звуки чатов/звонков из assets/sounds.

const SOUND_BASE = '../../assets/sounds';

export const GS_SOUND = {
  /** Входящий звонок (рингтон, loop) */
  incoming: `${SOUND_BASE}/incoming.mp3`,
  /** Исходящий звонок (ожидание ответа, loop) */
  outgoing: `${SOUND_BASE}/outgoing.mp3`,
  /** Вход в голосовой канал */
  connect: `${SOUND_BASE}/connect.mp3`,
  /** Выход из голосового / сброс активного звонка */
  hangup: `${SOUND_BASE}/hangup.mp3`,
  /** Отклонение входящего звонка */
  reject: `${SOUND_BASE}/reject.mp3`,
  /** Исходящее сообщение */
  send: `${SOUND_BASE}/send.mp3`,
  /** Входящее сообщение */
  message: `${SOUND_BASE}/message.mp3`,
} as const;

export type GsSoundKind = keyof typeof GS_SOUND;

const VOLUME: Partial<Record<GsSoundKind, number>> = {
  incoming: 0.7,
  outgoing: 0.55,
  connect: 0.75,
  hangup: 0.7,
  reject: 0.7,
  send: 0.55,
  message: 0.65,
};

/** Долгие рингтоны — один экземпляр, чтобы не наслаивались */
const looping = new Map<'incoming' | 'outgoing', HTMLAudioElement>();

function makeAudio(kind: GsSoundKind, loop = false): HTMLAudioElement {
  const a = new Audio(GS_SOUND[kind]);
  a.volume = VOLUME[kind] ?? 0.7;
  a.loop = loop;
  a.preload = 'auto';
  return a;
}

/** Одноразовый звук (сообщения, connect, hangup, reject). */
export function playGsSound(kind: GsSoundKind): void {
  try {
    if (kind === 'incoming' || kind === 'outgoing') {
      startCallRing(kind);
      return;
    }
    const a = makeAudio(kind, false);
    void a.play().catch(() => {
      /* автоплей / фокус */
    });
  } catch {
    /* ignore */
  }
}

/** Старт рингтона входящего/исходящего звонка. */
export function startCallRing(kind: 'incoming' | 'outgoing'): void {
  stopCallRing();
  try {
    const a = makeAudio(kind, true);
    looping.set(kind, a);
    void a.play().catch(() => {
      /* ignore */
    });
  } catch {
    /* ignore */
  }
}

/** Остановить оба рингтона (ответ / сброс / reject). */
export function stopCallRing(): void {
  for (const [key, a] of looping) {
    try {
      a.pause();
      a.currentTime = 0;
    } catch {
      /* ignore */
    }
    looping.delete(key);
  }
}
