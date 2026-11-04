// Своя модель UAgent: OpenAI-совместимый API или Claude. Ключ лежит только в данных лаунчера.

import fs from 'fs';
import path from 'path';
import { getLauncherDataDir } from './paths';

export type AiProviderKind = 'pixi' | 'openai' | 'anthropic';

export type AiProviderConfig = {
  kind: AiProviderKind;
  baseUrl: string;
  apiKey: string;
  model: string;
};

type ChatMessage = {
  role: string;
  content?: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{ id: string; type?: string; function: { name: string; arguments: string } }>;
};

const SYSTEM = [
  'Ты UAgent, агент лаунчера Undefined Client. Отвечай по-русски, ясно и по делу.',
  'Инструменты вызывай сам. Не проси пользователя нажать Play, если можешь вызвать launch_build.',
  'Каталог установленных сборок приходит в сообщении пользователя. Если имя и версия есть в каталоге, запускай launch_build с этим id.',
  'Версия модпака (например 26.3) и версия Minecraft — разные поля. Не говори, что сборки нет, если она перечислена.',
  'Свои серверы: сначала list_hosted_servers. Создание — create_hosted_server, затем update_hosted_server (имя, ядро, версия).',
  'Ядро ставь install_hosted_core, плагин — install_hosted_plugin по https-ссылке на jar. Конфиги читай read_hosted_file и только потом пиши write_hosted_file.',
  'Запуск, остановка и перезапуск своего сервера делай сам: start_hosted_server, stop_hosted_server, restart_hosted_server. Команду в консоль отправляй hosted_command. Не проси пользователя ввести её руками.',
  'Конфиг сервера меняй сам: список файлов, чтение, запись. Не присылай yaml со словами «сохрани это в файл». Если запись вернула need_read, сразу прочитай этот файл и запиши изменённый текст.',
  'Путь плагина бери из списка реальных файлов в сообщении. Не угадывай папку и не сочиняй yaml: сначала прочитай файл, потом меняй его текст.',
  'EULA сервера ставь только если пользователь явно согласился.',
  'Не выдумывай id. Если данных не хватает, вызови инструмент, а не отказывайся.',
].join('\n');

function storePath(): string {
  return path.join(getLauncherDataDir(), 'ai-provider.json');
}

function emptyConfig(): AiProviderConfig {
  return { kind: 'pixi', baseUrl: 'https://api.openai.com/v1', apiKey: '', model: '' };
}

export function readAiProvider(): AiProviderConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(storePath(), 'utf8'));
    const kind = raw?.kind === 'openai' || raw?.kind === 'anthropic' ? raw.kind : 'pixi';
    return {
      kind,
      baseUrl: String(raw?.baseUrl || emptyConfig().baseUrl).trim(),
      apiKey: String(raw?.apiKey || ''),
      model: String(raw?.model || '').trim(),
    };
  } catch {
    return emptyConfig();
  }
}

export function writeAiProvider(patch: Partial<AiProviderConfig>): AiProviderConfig {
  const prev = readAiProvider();
  const next: AiProviderConfig = {
    kind: patch.kind === 'openai' || patch.kind === 'anthropic' || patch.kind === 'pixi' ? patch.kind : prev.kind,
    baseUrl: patch.baseUrl != null ? String(patch.baseUrl).trim() : prev.baseUrl,
    apiKey: patch.apiKey != null && String(patch.apiKey).trim() && !/^•+$/.test(String(patch.apiKey).trim())
      ? String(patch.apiKey).trim()
      : prev.apiKey,
    model: patch.model != null ? String(patch.model).trim() : prev.model,
  };
  fs.mkdirSync(path.dirname(storePath()), { recursive: true });
  fs.writeFileSync(storePath(), JSON.stringify(next), 'utf8');
  return next;
}

export function publicAiProvider(): {
  kind: AiProviderKind;
  baseUrl: string;
  model: string;
  hasKey: boolean;
  keyTail: string;
} {
  const cfg = readAiProvider();
  return {
    kind: cfg.kind,
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    hasKey: Boolean(cfg.apiKey),
    keyTail: cfg.apiKey ? cfg.apiKey.slice(-4) : '',
  };
}

function normalizeOpenAiBase(base: string): string {
  let url = (base || 'https://api.openai.com/v1').trim().replace(/\/+$/, '');
  url = url.replace(/\/(?:chat\/completions|models|completions)$/i, '');
  try {
    const host = new URL(url).hostname.toLowerCase();
    // Без /api/v1 запрос уходит на сайт OpenRouter, и их защита отвечает Access denied by security policy.
    if (host === 'openrouter.ai' || host.endsWith('.openrouter.ai')) return 'https://openrouter.ai/api/v1';
  } catch {
    /* адрес проверяет сам fetch */
  }
  return url;
}

function apiUrl(base: string, suffix: string): string {
  const root = normalizeOpenAiBase(base);
  return `${root}${suffix.startsWith('/') ? suffix : `/${suffix}`}`;
}

function providerHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    // Пустой или node User-Agent OpenRouter режет политикой безопасности.
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'HTTP-Referer': 'https://uprojects.site',
    'X-Title': 'Undefined Client',
  };
}

async function readError(res: Response): Promise<string> {
  const raw = await res.text();
  try {
    const data = JSON.parse(raw);
    const msg = data?.error?.message || data?.error || data?.message;
    if (typeof msg === 'string' && msg.trim()) return explainProviderError(msg.trim());
  } catch {
    /* ответ не JSON */
  }
  if (/security policy/i.test(raw)) return explainProviderError('Access denied by security policy');
  const text = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return explainProviderError(text.slice(0, 240) || `HTTP ${res.status}`);
}

function explainProviderError(message: string): string {
  if (/security policy/i.test(message)) {
    return 'OpenRouter отклонил запрос политикой безопасности. В поле адреса оставьте https://openrouter.ai/api/v1 и ключ с openrouter.ai/keys. После этого полностью перезапустите лаунчер.';
  }
  return message;
}

export async function listProviderModels(cfg: AiProviderConfig): Promise<{ ok: boolean; models?: string[]; error?: string }> {
  if (!cfg.apiKey) return { ok: false, error: 'Нет API-ключа' };
  try {
    if (cfg.kind === 'anthropic') {
      const root = (cfg.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '').replace(/\/v1$/, '');
      const res = await fetch(`${root}/v1/models`, {
        headers: {
          'x-api-key': cfg.apiKey,
          'anthropic-version': '2023-06-01',
          'User-Agent': 'Undefined-Client',
          Accept: 'application/json',
        },
      });
      if (!res.ok) return { ok: false, error: await readError(res) };
      const data = await res.json();
      const models = (Array.isArray(data?.data) ? data.data : [])
        .map((row: { id?: string }) => String(row?.id || ''))
        .filter(Boolean);
      return { ok: true, models };
    }
    const res = await fetch(apiUrl(cfg.baseUrl || 'https://api.openai.com/v1', '/models'), {
      headers: providerHeaders(cfg.apiKey),
    });
    if (!res.ok) return { ok: false, error: await readError(res) };
    const data = await res.json();
    const models = (Array.isArray(data?.data) ? data.data : [])
      .map((row: { id?: string }) => String(row?.id || ''))
      .filter(Boolean)
      .sort();
    return { ok: true, models };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function normalizeToolCalls(raw: unknown): ChatMessage['tool_calls'] {
  if (!Array.isArray(raw)) return undefined;
  const calls = raw
    .map((row: any) => {
      const name = String(row?.function?.name || row?.name || '');
      if (!name) return null;
      const args = row?.function?.arguments ?? row?.arguments ?? '{}';
      return {
        id: String(row?.id || `call_${Math.random().toString(36).slice(2, 10)}`),
        type: 'function' as const,
        function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) },
      };
    })
    .filter(Boolean);
  return calls.length ? (calls as NonNullable<ChatMessage['tool_calls']>) : undefined;
}

export async function chatWithProvider(
  cfg: AiProviderConfig,
  messages: ChatMessage[],
  tools: unknown[] | null,
): Promise<{ reply?: string; toolCalls?: ChatMessage['tool_calls']; model?: string; error?: string }> {
  if (!cfg.apiKey || !cfg.model) return { error: 'Своя модель не настроена: укажи ключ и модель в настройках UAgent.' };
  try {
    if (cfg.kind === 'anthropic') return await chatAnthropic(cfg, messages, tools);
    return await chatOpenAI(cfg, messages, tools);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

async function chatOpenAI(cfg: AiProviderConfig, messages: ChatMessage[], tools: unknown[] | null) {
  const body: Record<string, unknown> = {
    model: cfg.model,
    temperature: 0.3,
    messages: [{ role: 'system', content: SYSTEM }, ...messages],
  };
  if (tools?.length) body.tools = tools;
  const res = await fetch(apiUrl(cfg.baseUrl || 'https://api.openai.com/v1', '/chat/completions'), {
    method: 'POST',
    headers: providerHeaders(cfg.apiKey),
    body: JSON.stringify(body),
  });
  if (!res.ok) return { error: await readError(res) };
  const data = await res.json();
  const msg = data?.choices?.[0]?.message || {};
  return {
    reply: String(msg.content || ''),
    toolCalls: normalizeToolCalls(msg.tool_calls),
    model: String(data?.model || cfg.model),
  };
}

function anthropicTools(tools: unknown[] | null) {
  if (!tools?.length) return undefined;
  return tools.map((row: any) => ({
    name: String(row?.function?.name || ''),
    description: String(row?.function?.description || ''),
    input_schema: row?.function?.parameters || { type: 'object', properties: {} },
  }));
}

function toAnthropic(messages: ChatMessage[]) {
  const out: Array<{ role: 'user' | 'assistant'; content: unknown }> = [];
  for (const msg of messages) {
    if (msg.role === 'user') {
      out.push({ role: 'user', content: String(msg.content || '') });
      continue;
    }
    if (msg.role === 'assistant') {
      const blocks: unknown[] = [];
      if (msg.content) blocks.push({ type: 'text', text: String(msg.content) });
      for (const call of msg.tool_calls || []) {
        let input: unknown = {};
        try {
          input = JSON.parse(call.function.arguments || '{}');
        } catch {
          input = {};
        }
        blocks.push({ type: 'tool_use', id: call.id, name: call.function.name, input });
      }
      if (blocks.length) out.push({ role: 'assistant', content: blocks });
      continue;
    }
    if (msg.role === 'tool') {
      const block = {
        type: 'tool_result',
        tool_use_id: String(msg.tool_call_id || ''),
        content: String(msg.content || ''),
      };
      const prev = out[out.length - 1];
      if (prev?.role === 'user' && Array.isArray(prev.content)) prev.content.push(block);
      else out.push({ role: 'user', content: [block] });
    }
  }
  return out;
}

async function chatAnthropic(cfg: AiProviderConfig, messages: ChatMessage[], tools: unknown[] | null) {
  const root = (cfg.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '').replace(/\/v1$/, '');
  const body: Record<string, unknown> = {
    model: cfg.model,
    max_tokens: 2048,
    temperature: 0.3,
    system: SYSTEM,
    messages: toAnthropic(messages),
  };
  const mapped = anthropicTools(tools);
  if (mapped?.length) body.tools = mapped;
  const res = await fetch(`${root}/v1/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) return { error: await readError(res) };
  const data = await res.json();
  const blocks = Array.isArray(data?.content) ? data.content : [];
  const reply = blocks
    .filter((block: { type?: string }) => block?.type === 'text')
    .map((block: { text?: string }) => String(block.text || ''))
    .join('\n')
    .trim();
  const toolCalls = blocks
    .filter((block: { type?: string }) => block?.type === 'tool_use')
    .map((block: { id?: string; name?: string; input?: unknown }) => ({
      id: String(block.id || ''),
      type: 'function' as const,
      function: { name: String(block.name || ''), arguments: JSON.stringify(block.input || {}) },
    }));
  return { reply, toolCalls: toolCalls.length ? toolCalls : undefined, model: String(data?.model || cfg.model) };
}
