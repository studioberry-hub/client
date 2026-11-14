// Новые MCP UAgent: обзор клиента, разделы лаунчера, настройки и баг-трекер.
// Исполнение остаётся в уже существующих действиях окна, без заготовок «если сказали запусти».

import { callRendererAiAction } from './ai-action-bridge';

type ToolEntry = {
  risk: 'read' | 'write';
  schema: {
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  };
  run: (args: Record<string, unknown>) => Promise<unknown>;
};

function tool(
  name: string,
  risk: 'read' | 'write',
  description: string,
  properties: Record<string, unknown>,
  required: string[],
  run: (args: Record<string, unknown>) => Promise<unknown>,
): ToolEntry {
  return {
    risk,
    schema: {
      type: 'function',
      function: {
        name,
        description,
        parameters: { type: 'object', properties, required, additionalProperties: false },
      },
    },
    run,
  };
}

function text(value: unknown, max = 4000): string {
  return String(value || '').trim().slice(0, max);
}

export function getUAgentMcpTools(): Record<string, ToolEntry> {
  return {
    client_overview: tool(
      'client_overview',
      'read',
      'Живой снимок клиента: аккаунт, идёт ли игра, локальные сборки и серверы для подключения.',
      {},
      [],
      () => callRendererAiAction('client_overview', {}, 20_000),
    ),

    open_launcher_section: tool(
      'open_launcher_section',
      'read',
      'Открыть раздел лаунчера: home, news, builds, mods, servers, host, skins, messenger или ai.',
      {
        section: {
          type: 'string',
          description: 'home | news | builds | mods | servers | host | skins | messenger | ai',
        },
      },
      ['section'],
      (args) => callRendererAiAction('open_launcher_section', { section: text(args.section, 40) }, 15_000),
    ),

    open_settings: tool(
      'open_settings',
      'read',
      'Открыть настройки: appearance, launch, mods, interface, gamepad, agent, updates, debug, bug или about.',
      {
        tab: {
          type: 'string',
          description: 'Вкладка настроек. По умолчанию appearance.',
        },
      },
      [],
      (args) => callRendererAiAction('open_settings', { tab: text(args.tab, 40) || 'appearance' }, 15_000),
    ),

    list_bug_tags: tool(
      'list_bug_tags',
      'read',
      'Список тегов баг-трекера Undefined.',
      {},
      [],
      () => callRendererAiAction('list_bug_tags', {}, 20_000),
    ),

    create_bug_report: tool(
      'create_bug_report',
      'write',
      'Опубликовать отчёт в баг-трекере. Только если человек прямо просит отправить баг.',
      {
        title: { type: 'string' },
        body: { type: 'string' },
        kind: { type: 'string', description: 'bug или suggestion' },
        steps: { type: 'string' },
        expected: { type: 'string' },
        actual: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      ['title', 'body'],
      (args) =>
        callRendererAiAction(
          'create_bug_report',
          {
            title: text(args.title, 160),
            body: text(args.body, 8000),
            kind: text(args.kind, 32) || 'bug',
            steps: text(args.steps, 4000),
            expected: text(args.expected, 4000),
            actual: text(args.actual, 4000),
            tags: Array.isArray(args.tags) ? args.tags.map((tag) => text(tag, 40)).filter(Boolean).slice(0, 8) : [],
          },
          30_000,
        ),
    ),
  };
}
