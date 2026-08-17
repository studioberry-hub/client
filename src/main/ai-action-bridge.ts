// ===== Мост AI-tools → renderer (launch / Java / share / catalog) =====
import { BrowserWindow, ipcMain } from 'electron';

type AiActionMessage = {
  id: string;
  action: string;
  payload: Record<string, unknown>;
};

type AiActionResultMessage = {
  id: string;
  result: unknown;
};

const pending = new Map<
  string,
  { resolve: (v: unknown) => void; timer: ReturnType<typeof setTimeout> }
>();

let bridgeReady = false;

function ensureBridge(): void {
  if (bridgeReady) return;
  bridgeReady = true;
  ipcMain.on('ai:action-result', (_event, msg: AiActionResultMessage) => {
    if (!msg?.id) return;
    const entry = pending.get(msg.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(msg.id);
    entry.resolve(msg.result);
  });
}

/** Запрос действия в UI-окне лаунчера (общий аккаунт, прогресс, существующие API). */
export function callRendererAiAction(
  action: string,
  payload: Record<string, unknown> = {},
  timeoutMs = 180_000,
): Promise<unknown> {
  ensureBridge();
  return new Promise((resolve) => {
    const wins = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
    const win = wins[0];
    if (!win) {
      resolve({ ok: false, error: 'no_window' });
      return;
    }
    const id = `ai_act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ ok: false, error: 'timeout' });
    }, timeoutMs);
    pending.set(id, { resolve, timer });
    const msg: AiActionMessage = { id, action, payload };
    win.webContents.send('ai:action', msg);
  });
}
