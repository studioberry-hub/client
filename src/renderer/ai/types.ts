// ===== Общие типы UI агента =====

export type AiAgentStatus = 'idle' | 'thinking' | 'tool' | 'confirm' | 'streaming';

export type AiUndoAction = {
  id: string;
  label: string;
  at: number;
  revert: () => Promise<void> | void;
};

export type AiConfirmRequest = {
  id: string;
  tool: string;
  title: string;
  detail: string;
  risk: 'write' | 'read';
  args: Record<string, unknown>;
};

export type AiPlanStep = {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'error';
};

export type AiUiHost = {
  t: (key: string, params?: Record<string, string | number>) => string;
  escapeHtml: (s: string) => string;
  getMessagesRoot: () => HTMLElement | null;
  scrollToEnd: () => void;
  getBuild: (id: string | null | undefined) => {
    id: string;
    name: string;
    gameVersion: string;
    loader: string;
    icon?: string;
  } | null;
  openBuildSettings: (buildId: string) => void;
  sendPrompt: (text: string) => void;
  switchToAiTab: () => void;
};
