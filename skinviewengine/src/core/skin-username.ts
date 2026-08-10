// Разрешение никнейма Minecraft → URL PNG-скина (CORS-friendly CDN)

/** Ошибка пустого никнейма после trim */
export class EmptyUsernameError extends Error {
  constructor() {
    super("Укажите никнейм Minecraft");
    this.name = "EmptyUsernameError";
  }
}

/** Нормализация никнейма: trim и проверка на пустую строку */
export function normalizeUsername(username: string): string {
  const name = username.trim();
  if (!name) {
    throw new EmptyUsernameError();
  }
  return name;
}

/** CDN-источники скина по никнейму (порядок = приоритет) */
export function buildSkinUrlsByUsername(username: string): string[] {
  const name = normalizeUsername(username);
  const encoded = encodeURIComponent(name);
  return [
    `https://mc-heads.net/skin/${encoded}`,
    `https://mineskin.eu/skin/${encoded}`,
  ];
}
