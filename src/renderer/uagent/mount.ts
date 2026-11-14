// Экран UAgent и цикл инструментов. Решения принимает модель, не заготовки команд.

import { marked } from 'marked';
import { openImageViewer } from '../image-viewer';
import { expressionFor, setAgentGaze, syncAgentFaces } from './bloub-face';
import { COLORS as BLOUB_COLORS, SHAPES as BLOUB_SHAPES, type ShapeId } from './bloub/skins';

type ToolCall = {
  id: string;
  function: { name: string; arguments: string };
};

type Shot = { name: string; url: string; mime: 'image/jpeg' | 'image/png'; data: string };

type Wire = {
  role: string;
  content?: string | null;
  images?: { mime: string; data: string }[];
  tool_call_id?: string;
  tool_calls?: ToolCall[];
};

type DiffLine = { kind: 'add' | 'del'; text: string };
type Step = { name: string; ok: boolean; detail: string; error?: string; path?: string; diff?: DiffLine[] };

type Msg = { id?: string; role: 'user' | 'assistant'; text: string; images?: { name: string; url: string }[]; steps: Step[]; thought?: string; reasoning?: string; live?: boolean };

type FormField = { id: string; label: string; type: 'text' | 'select' | 'toggle'; options: string[]; placeholder: string; required: boolean };

type LiveForm = { title: string; submit: string; fields: FormField[]; resolve: (value: Record<string, string> | null) => void };

type Shape = ShapeId;

type ServerFocus = { id: string; name: string };

type BuildFocus = { id: string; name: string; meta: string };

type ModFocus = { id: string; name: string; meta: string };

type FocusHold = { server?: boolean; build?: boolean; mod?: boolean };

type Session = {
  id: string;
  title: string;
  group: string;
  shape: Shape;
  color: string;
  updated: number;
  messages: Msg[];
  wire: Wire[];
  steps: Step[];
  channel?: string;
  server?: ServerFocus | null;
  build?: BuildFocus | null;
  mod?: ModFocus | null;
  hold?: FocusHold;
};

type ChatRes = { error?: string; reply?: string; reasoning?: string; toolCalls?: ToolCall[]; stopped?: boolean };

type ToolRes = { ok?: boolean; error?: string; result?: unknown };

const STORE = 'uagent-v2';
// Та же иконка, что у кнопки закрытия модалки.
const CLOSE_ICON = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M0 1.06066C0 0.474874 0.474874 0 1.06066 0C1.34196 0 1.61175 0.111748 1.81066 0.31066L11.6893 10.1893C11.8883 10.3883 12 10.658 12 10.9393C12 11.5251 11.5251 12 10.9393 12C10.658 12 10.3883 11.8883 10.1893 11.6893L0.31066 1.81066C0.111748 1.61175 0 1.34196 0 1.06066Z" fill="currentColor"/><path d="M1.06066 12C0.474874 12 0 11.5251 0 10.9393C0 10.658 0.111748 10.3883 0.31066 10.1893L10.1893 0.31066C10.3883 0.111748 10.658 0 10.9393 0C11.5251 0 12 0.474874 12 1.06066C12 1.34196 11.8883 1.61175 11.6893 1.81066L1.81066 11.6893C1.61175 11.8883 1.34196 12 1.06066 12Z" fill="currentColor"/></svg>';
const GREETING = 'Привет! Расскажи, что ты хочешь сделать сегодня? Дай мне задачу, и я её сделаю!';
const SHAPES: Shape[] = BLOUB_SHAPES.map((shape) => shape.id);
const COLORS = BLOUB_COLORS.map((color) => color.hex).filter((hex) => hex !== '#0a0a0c');
const LEGACY_SHAPE: Record<string, Shape> = {
  blob: 'galet',
  round: 'cercle',
  hex: 'hexagone',
  square: 'squircle',
  bean: 'capsule',
};
const CONTEXT_BUDGET = 65000;
const RING = 2 * Math.PI * 6;
const ICON = '../../assets/icons/uagent';
const TAB_ICON = '../../assets/tabsIcons';
const FILE_ICON = '../../assets/selfHostedPage/filesIcons/file.svg';

const LABELS: Record<string, string> = {
  list_builds: 'Смотрю сборки',
  get_build: 'Открываю сборку',
  create_build: 'Создаю сборку',
  update_build: 'Меняю сборку',
  delete_build: 'Удаляю сборку',
  duplicate_build: 'Дублирую сборку',
  rename_build: 'Переименовываю сборку',
  select_build: 'Выбираю сборку',
  launch_build: 'Запускаю сборку',
  compare_builds: 'Сравниваю сборки',
  backup_build: 'Делаю резервную копию',
  import_modpack: 'Импортирую модпак',
  search_mods: 'Ищу моды',
  search_modpacks: 'Ищу модпаки',
  search_resourcepacks: 'Ищу ресурс-паки',
  search_shaders: 'Ищу шейдеры',
  get_mod: 'Смотрю проект',
  install_mod: 'Ставлю мод',
  install_matching_mod: 'Ставлю мод из каталога',
  install_matching_plugin: 'Ставлю плагин из каталога',
  delete_hosted_file: 'Удаляю файл сервера',
  install_mod_bulk: 'Ставлю несколько модов',
  update_outdated_mods: 'Обновляю моды',
  list_build_mods: 'Смотрю моды сборки',
  find_mod_in_build: 'Проверяю, есть ли мод',
  list_build_content: 'Смотрю содержимое сборки',
  toggle_mod: 'Переключаю мод',
  disable_all_mods: 'Выключаю все моды',
  enable_all_mods: 'Включаю все моды',
  remove_build_file: 'Убираю файл',
  copy_mods_to_build: 'Копирую моды',
  read_config: 'Читаю конфиг',
  write_config: 'Правлю конфиг',
  read_options: 'Читаю настройки игры',
  write_options: 'Правлю настройки игры',
  get_options_value: 'Смотрю параметр',
  set_options_value: 'Меняю параметр',
  list_configs: 'Смотрю конфиги',
  diagnose_build: 'Разбираю запуск',
  get_crash_report: 'Читаю краш',
  get_latest_log: 'Читаю лог',
  clear_logs: 'Чищу логи',
  get_console_tail: 'Смотрю консоль',
  open_console: 'Открываю консоль',
  list_java: 'Смотрю Java',
  install_java: 'Ставлю Java',
  remove_java: 'Удаляю Java',
  set_java_for_build: 'Назначаю Java',
  set_build_memory: 'Меняю память',
  set_jvm_args: 'Меняю аргументы Java',
  set_build_window: 'Меняю окно игры',
  recommend_java_for_build: 'Подбираю Java',
  validate_java_for_build: 'Проверяю Java',
  list_worlds: 'Смотрю миры',
  delete_world: 'Удаляю мир',
  list_screenshots: 'Смотрю скриншоты',
  delete_screenshot: 'Удаляю скриншот',
  list_servers: 'Смотрю серверы для входа',
  add_server: 'Добавляю сервер',
  edit_server: 'Правлю сервер',
  remove_server: 'Удаляю сервер',
  server_status: 'Проверяю сервер',
  list_server_catalog: 'Смотрю каталог серверов',
  list_hosted_servers: 'Смотрю свои серверы',
  create_hosted_server: 'Создаю сервер',
  update_hosted_server: 'Меняю сервер',
  install_hosted_core: 'Ставлю ядро',
  start_hosted_server: 'Запускаю сервер',
  stop_hosted_server: 'Останавливаю сервер',
  restart_hosted_server: 'Перезапускаю сервер',
  hosted_command: 'Отправляю команду',
  hosted_log: 'Читаю лог сервера',
  list_hosted_plugins: 'Смотрю плагины',
  install_hosted_plugin: 'Ставлю плагин',
  toggle_hosted_plugin: 'Переключаю плагин',
  list_hosted_files: 'Смотрю файлы сервера',
  find_hosted_files: 'Ищу файл сервера',
  grep_hosted_files: 'Ищу строку на сервере',
  read_hosted_file: 'Читаю файл сервера',
  edit_hosted_file: 'Правлю фрагмент файла',
  write_hosted_file: 'Создаю файл сервера',
  mkdir_hosted: 'Создаю папку сервера',
  copy_hosted_file: 'Копирую файл сервера',
  move_hosted_file: 'Переношу файл сервера',
  list_instance_files: 'Смотрю файлы сборки',
  find_instance_files: 'Ищу файл сборки',
  grep_instance_files: 'Ищу строку в сборке',
  read_instance_file: 'Читаю файл сборки',
  edit_instance_file: 'Правлю фрагмент сборки',
  write_instance_file: 'Создаю файл сборки',
  mkdir_instance: 'Создаю папку сборки',
  copy_instance_file: 'Копирую файл сборки',
  move_instance_file: 'Переношу файл сборки',
  delete_instance_file: 'Удаляю файл сборки',
  list_hosted_core_versions: 'Смотрю версии ядра',
  web_search: 'Ищу в интернете',
  fetch_url: 'Открываю страницу',
  lookup_plugin: 'Смотрю документацию плагина',
  play_command: 'Отправляю команду в игру',
  scan_configs: 'Смотрю ключи конфигов',
  ask_user_form: 'Уточняю формой',
  list_news: 'Смотрю новости',
  get_news: 'Читаю новость',
  list_accounts: 'Смотрю аккаунты',
  switch_account: 'Переключаю аккаунт',
  get_launcher_info: 'Смотрю лаунчер',
  get_system_info: 'Смотрю систему',
  check_updates: 'Проверяю обновление',
  launch_updater: 'Запускаю обновление',
  client_overview: 'Смотрю, что в клиенте',
  open_launcher_section: 'Открываю раздел',
  open_settings: 'Открываю настройки',
  list_bug_tags: 'Смотрю теги багов',
  create_bug_report: 'Отправляю отчёт',
  game_status: 'Смотрю, запущена ли игра',
  find_mod_conflicts: 'Ищу конфликты модов',
  get_build_disk_usage: 'Считаю место сборки',
  search_local_files: 'Ищу файлы',
  open_build_folder: 'Открываю папку сборки',
  clear_instance_cache: 'Чищу кэш сборки',
};

const api = (window as unknown as {
  electronAPI?: {
    aiChat?: (payload: { messages: Wire[]; tools?: boolean; turn?: string; model?: string }) => Promise<ChatRes>;
    aiChatStop?: (turn: string) => Promise<{ ok?: boolean }>;
    onAiDelta?: (cb: (packet: { turn?: string; text?: string; reasoning?: string }) => void) => () => void;
    speechModel?: () => Promise<{ url?: string; error?: string }>;
    onSpeechProgress?: (cb: (percent: number) => void) => () => void;
    aiToolsRun?: (name: string, args?: Record<string, unknown>, opts?: { confirmed?: boolean }) => Promise<ToolRes>;
    aiStatus?: () => Promise<{
      access?: boolean;
      models?: string[];
      reason?: string;
      error?: string;
      application?: { status?: string };
    }>;
    aiApply?: (reason: string) => Promise<{ ok?: boolean; reason?: string; error?: string }>;
    openExternal?: (url: string) => Promise<void>;
  };
}).electronAPI;

let sessions: Session[] = [];
let activeId = '';
let busy = false;
let panel: 'activity' | 'library' = 'activity';
let aboutOpen = true;
let sideOpen = true;
let renaming = false;
let libraryToken = 0;
let pendingFile: { name: string; text: string } | null = null;
let pendingShots: Shot[] = [];
type AttachKind = '' | 'root' | 'mod' | 'build' | 'server';
let attachKind: AttachKind = '';
let attachQuery = '';
let attachTimer = 0;
let attachToken = 0;
let attachRows: { id: string; name: string; meta: string }[] = [];
let pickerOpen = false;
let streamOnce = false;
let libraryHtml = '';
let libraryFor = '';
const focusReady = new Set<string>();
let openTelegram: (() => void) | null = null;
let shellReady = false;
let liveForm: LiveForm | null = null;
let compactAnnounced = false;
let remoteBusy = false;
let quietTurn = false;
let remoteConfirm: ((text: string) => Promise<boolean>) | null = null;
let localTurn = 0;
let listening = false;
let speechPrep = false;
let dangerResolve: ((ok: boolean) => void) | null = null;
let speechRec: { stop: () => void } | null = null;
let speechTimer = 0;
let speechGen = 0;

export function setUAgentRemoteConfirm(confirm: (text: string) => Promise<boolean>): void {
  remoteConfirm = confirm;
}

export function setUAgentTelegram(open: () => void): void {
  openTelegram = open;
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function asShape(value: unknown, index = 0): Shape {
  const raw = String(value || '');
  if ((SHAPES as string[]).includes(raw)) return raw as Shape;
  return LEGACY_SHAPE[raw] || SHAPES[index % SHAPES.length];
}

function load(): void {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) || '[]');
    const rows = Array.isArray(raw) ? raw : [];
    sessions = rows.filter((row) => row && row.id).map((row, index) => ({
      id: String(row.id),
      title: String(row.title || 'UAgent Bot').slice(0, 40),
      group: String(row.group || ''),
      shape: asShape(row.shape, index),
      color: /^#[0-9a-fA-F]{6}$/.test(String(row.color || '')) ? String(row.color) : COLORS[index % COLORS.length],
      server: row.server?.id ? { id: String(row.server.id), name: String(row.server.name || row.server.id) } : null,
      build: row.build?.name ? { id: String(row.build.id || row.build.name), name: String(row.build.name), meta: String(row.build.meta || '') } : null,
      mod: row.mod?.name ? { id: String(row.mod.id || row.mod.name), name: String(row.mod.name), meta: String(row.mod.meta || '') } : null,
      hold: row.hold && typeof row.hold === 'object'
        ? {
          server: row.hold.server ? true : undefined,
          build: row.hold.build ? true : undefined,
          mod: row.hold.mod ? true : undefined,
        }
        : undefined,
      updated: Number(row.updated) || Date.now(),
      channel: row.channel === 'telegram' ? 'telegram' : '',
      messages: (Array.isArray(row.messages) ? row.messages : []).filter(Boolean).map((msg: Msg) => ({
        ...msg,
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        text: typeof msg.text === 'string' ? msg.text : '',
        steps: Array.isArray(msg.steps) ? msg.steps : [],
      })),
      wire: Array.isArray(row.wire) ? row.wire : [],
      steps: Array.isArray(row.steps) ? row.steps : [],
    }));
  } catch {
    sessions = [];
  }
  if (!sessions.length) sessions.push(blank('UAgent Bot'));
  if (!sessions.some((row) => row.id === activeId)) activeId = sessions[0].id;
}

function save(): void {
  const payload = sessions.slice(0, 40).map((session) => ({
    ...session,
    wire: session.wire.map((msg) => {
      if (!msg.images?.length) return msg;
      const copy = { ...msg };
      delete copy.images;
      return copy;
    }),
  }));
  const write = (value: Session[]) => localStorage.setItem(STORE, JSON.stringify(value));
  try {
    write(payload);
  } catch {
    // Квота localStorage. Текст сообщений сохраняем, сырые ответы инструментов ужимаем.
    const slim = payload.map((session) => ({
      ...session,
      messages: session.messages.map((msg, index, all) => {
        if (index >= all.length - 2 || !msg.images?.length) return msg;
        const copy = { ...msg };
        delete copy.images;
        return copy;
      }),
      wire: session.wire.slice(-16).map((msg) => ({
        ...msg,
        content: typeof msg.content === 'string' && msg.content.length > 800 ? `${msg.content.slice(0, 800)}…` : msg.content,
      })),
    }));
    try {
      write(slim);
    } catch {
      try {
        write(slim.map((session) => ({ ...session, wire: session.wire.slice(-4) })));
      } catch { /* история в памяти остаётся до конца сеанса */ }
    }
  }
}

function blank(title: string): Session {
  const index = sessions.length;
  return {
    id: uid(),
    title,
    group: '',
    shape: SHAPES[index % SHAPES.length],
    color: COLORS[index % COLORS.length],
    updated: Date.now(),
    messages: [],
    wire: [],
    steps: [],
  };
}

function headHtml(session: Pick<Session, 'shape' | 'color'> & { id?: string }, size: 'sm' | 'lg', mode = 'idle', still = false): string {
  const shape = asShape(session.shape);
  const expr = expressionFor(session.id);
  return `<span class="uag-turn is-${size}" data-bloub data-shape="${shape}" data-color="${esc(session.color)}" data-expr="${expr}" data-mode="${mode}" data-follow="${size === 'lg' ? '1' : '0'}"${still ? ' data-still="1"' : ''}></span>`;
}

function avatarMode(session: Session, live: boolean): string {
  if (live) return 'thinking';
  if (liveForm && session.id === activeId) return 'notify';
  const steps = Array.isArray(session.steps) ? session.steps : [];
  const last = steps[steps.length - 1];
  if (last && !last.ok) return 'alert';
  return 'idle';
}

function placeHead(host: HTMLElement, session: Session, size: 'sm' | 'lg', live: boolean): void {
  const mode = avatarMode(session, live);
  const node = host.querySelector<HTMLElement>(':scope > [data-bloub]');
  if (!node) {
    host.innerHTML = headHtml(session, size, mode);
    return;
  }
  node.className = `uag-turn is-${size}`;
  node.dataset.shape = asShape(session.shape);
  node.dataset.color = session.color;
  node.dataset.expr = expressionFor(session.id);
  node.dataset.mode = mode;
  node.dataset.follow = size === 'lg' ? '1' : '0';
  delete node.dataset.still;
}

function dotsHtml(): string {
  return '<span class="uag2-dots" aria-hidden="true"><i></i><i></i><i></i></span>';
}

function current(): Session {
  return sessions.find((row) => row.id === activeId) || sessions[0];
}

function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] || ch));
}

function needsConfirm(name: string): boolean {
  return /^(delete_|remove_|clear_)/.test(name) || name === 'disable_all_mods' || name === 'clear_instance_cache';
}

function toolLabel(name: string): string {
  return LABELS[name] || name.replace(/_/g, ' ');
}

function changeOf(args: Record<string, unknown> | undefined, result: unknown): { path: string; diff: DiffLine[] } {
  const box = result && typeof result === 'object' ? (result as Record<string, unknown>) : {};
  const inner = box.result && typeof box.result === 'object' ? (box.result as Record<string, unknown>) : {};
  const path = String(inner.path || args?.path || args?.query || args?.url || '').replace(/\\/g, '/').trim();
  const raw = Array.isArray(inner.diff) ? (inner.diff as DiffLine[]) : [];
  const diff = raw
    .filter((row) => row && (row.kind === 'add' || row.kind === 'del') && typeof row.text === 'string')
    .slice(0, 48)
    .map((row) => ({ kind: row.kind, text: String(row.text).slice(0, 240) }));
  return { path, diff };
}

function toolPayload(result: unknown, name: string): string {
  const limit = name === 'fetch_url' || name === 'web_search' || name === 'lookup_plugin' ? 14000 : 6000;
  const box: Record<string, any> = result && typeof result === 'object' ? { ...(result as Record<string, any>) } : { value: result ?? { ok: false } };
  const inner: Record<string, any> | null = box.result && typeof box.result === 'object' ? { ...box.result } : null;
  if (inner) box.result = inner;
  const target = inner || box;
  let raw = JSON.stringify(box);
  if (raw.length > limit && typeof target.text === 'string') {
    const overflow = raw.length - limit + 160;
    target.text = `${String(target.text).slice(0, Math.max(400, String(target.text).length - overflow))}\n…обрезано`;
    target.truncated = true;
    raw = JSON.stringify(box);
  }
  return raw.length <= limit ? raw : raw.slice(0, limit);
}

function doneStep(name: string, ok = true, error = '', args?: Record<string, unknown>, result?: unknown): Step {
  const note = error.replace(/\s+/g, ' ').trim();
  const change = changeOf(args, result);
  const detail = change.path && !change.diff.length ? `${toolLabel(name)} · ${change.path}` : toolLabel(name);
  return {
    name,
    ok,
    detail,
    error: note ? note.slice(0, 160) : undefined,
    path: change.path || undefined,
    diff: change.diff.length ? change.diff : undefined,
  };
}

function renderMd(src: string): string {
  const html = marked.parse(src || '', { async: false, gfm: true, breaks: true }) as string;
  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/javascript:/gi, '');
}

function choices(text: string): { body: string; title: string; items: { key: string; label: string }[] } {
  const items: { key: string; label: string }[] = [];
  const rest = text.split('\n').filter((line) => {
    const match = line.trim().match(/^([A-C])[).]\s+(.+)$/);
    if (!match) return true;
    items.push({ key: match[1], label: match[2] });
    return false;
  });
  let body = rest.join('\n').trim();
  let title = '';
  if (items.length) {
    const parts = body.split(/\n{2,}/);
    const last = (parts[parts.length - 1] || '').trim();
    if (last.endsWith('?') && last.length < 140 && !last.includes('\n')) {
      title = last;
      parts.pop();
      body = parts.join('\n\n').trim();
    }
  }
  return { body, title, items };
}

function preview(session: Session): string {
  const last = [...(session.messages || [])].reverse().find((row) => String(row?.text || '').trim());
  if (!last) return 'Только что создан';
  const text = String(last.text || '').replace(/\s+/g, ' ').trim();
  return text.length > 28 ? `${text.slice(0, 28)}…` : text;
}

function dayLabel(ts: number): string {
  const date = new Date(ts);
  const time = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return `Сегодня в ${time}`;
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `Вчера в ${time}`;
  const day = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  return `${day} в ${time}`;
}

function rowsHtml(rows: Session[]): string {
  const session = current();
  return rows.map((row) => {
    const on = row.id === session.id;
    const working = on && busy;
    const sub = working ? `${dotsHtml()}Работает` : esc(preview(row));
    return `<button type="button" class="uag2-row${on ? ' is-on' : ''}${working ? ' is-busy' : ''}" data-id="${esc(row.id)}">
      ${headHtml(row, 'sm', working ? 'thinking' : row.id === activeId ? avatarMode(row, false) : 'idle', !working)}
      <span class="uag2-row__text"><b>${esc(row.title)}</b><small>${sub}</small></span>
      ${on ? `<span class="uag2-row__x" data-close="${esc(row.id)}"><img src="${ICON}/closeAgentTab.svg" alt=""></span>` : '<span></span>'}
    </button>`;
  }).join('');
}

function listHtml(): string {
  const loose = sessions.filter((row) => !row.group);
  const groups: string[] = [];
  sessions.forEach((row) => {
    if (row.group && !groups.includes(row.group)) groups.push(row.group);
  });
  const chunks = [rowsHtml(loose)];
  groups.forEach((title) => {
    chunks.push(
      `<div class="uag2-group"><span>${esc(title)}</span><i></i><button type="button" data-ungroup="${esc(title)}" aria-label="Убрать группу"><img src="${ICON}/closeAgentTab.svg" alt=""></button></div>`,
      rowsHtml(sessions.filter((row) => row.group === title)),
    );
  });
  return chunks.join('');
}

function thinkHtml(text: string, live = false): string {
  const full = text.trim();
  if (!full && !live) return '';
  const hidden = full ? '' : ' hidden';
  const liveId = live ? ' id="uag2-live-reason"' : '';
  const bodyId = live ? ' id="uag2-live-reason-body"' : '';
  return `<button type="button" class="uag2-think"${liveId}${hidden} data-reason="${esc(full)}">Показать размышления модели</button><div class="uag2-think__body"${bodyId} hidden>${esc(full)}</div>`;
}

function messageHtml(msg: Msg): string {
  const shots = (msg.images || []).map((image) => `<button type="button" class="uag2-shot"><img src="${esc(image.url)}" alt="${esc(image.name)}"></button>`).join('');
  const text = msg.text ? `<div>${esc(msg.text)}</div>` : '';
  return `<article class="uag2-bubble is-user uag-in">${shots ? `<div class="uag2-shots">${shots}</div>` : ''}${text}</article>`;
}

function modelSeesImages(id = currentPixiModel()): boolean {
  return id === 'pixi-2.0-lite' || id === 'pixi-2.0-pro';
}

function openShotList(list: { src: string; alt?: string }[], start: number): void {
  const clean = list.filter((item) => item.src);
  if (!clean.length) return;
  const at = Math.min(Math.max(0, start), clean.length - 1);
  openImageViewer(clean, at, 'agent');
}

function compressShot(file: File): Promise<Shot> {
  const blobUrl = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const maxSide = 1280;
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height, 1));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(blobUrl);
        reject(new Error('canvas'));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      let quality = 0.72;
      let dataUrl = canvas.toDataURL('image/jpeg', quality);
      while (dataUrl.length > 900_000 && quality > 0.4) {
        quality -= 0.12;
        dataUrl = canvas.toDataURL('image/jpeg', quality);
      }
      URL.revokeObjectURL(blobUrl);
      resolve({
        name: (file.name || 'screenshot.jpg').slice(0, 80),
        url: dataUrl,
        mime: 'image/jpeg',
        data: dataUrl.split(',')[1] || '',
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(blobUrl);
      reject(new Error('image'));
    };
    img.src = blobUrl;
  });
}

async function addShots(files: File[]): Promise<void> {
  for (const file of files) {
    if (pendingShots.length >= 4) break;
    if (!file.type.startsWith('image/')) continue;
    try {
      const shot = await compressShot(file);
      if (shot.data) pendingShots.push(shot);
    } catch {
      /* битый файл не прикладываем */
    }
  }
  fill();
}

function stepView(step: Step): { label: string; ok: boolean; error: string } {
  const extra = (step.error || '').replace(/\s+/g, ' ').trim();
  if (extra) return { label: step.detail, ok: step.ok, error: extra };
  const cut = step.detail.indexOf(': ');
  if (!step.ok && cut > 0) return { label: step.detail.slice(0, cut), ok: false, error: step.detail.slice(cut + 2).trim() };
  return { label: step.detail, ok: step.ok, error: '' };
}

function rowHtml(row: { label: string; ok: boolean; error: string; count: number }): string {
  const times = row.count > 1 ? `<i>×${row.count}</i>` : '';
  const state = row.ok ? '' : '<em>Не вышло</em>';
  const err = row.error ? `<small title="${esc(row.error)}">${esc(row.error)}</small>` : '';
  return `<button type="button" class="uag2-tool${row.ok ? '' : ' is-bad'}" data-activity="1"><span></span><b>${esc(row.label)}${times}</b>${state}${err}</button>`;
}

function diffHtml(step: Step): string {
  if (!step.diff?.length) return '';
  const rows = step.diff.map((line) => {
    const mark = line.kind === 'add' ? '+' : '−';
    const cls = line.kind === 'add' ? 'is-add' : 'is-del';
    return `<div class="${cls}">${mark} ${esc(line.text || ' ')}</div>`;
  }).join('');
  const title = step.path ? `<b>${esc(step.path)}</b>` : '';
  return `<div class="uag2-diff">${title}${rows}</div>`;
}

function toolRows(steps: Step[]): string {
  const blocks: string[] = [];
  const groups: { label: string; ok: boolean; error: string; count: number }[] = [];
  const flush = () => {
    if (!groups.length) return;
    const shown = groups.slice(0, 6);
    const rest = groups.length - shown.length;
    const more = rest > 0 ? `<button type="button" class="uag2-tool is-more" data-activity="1">Ещё ${rest}</button>` : '';
    blocks.push(`<div class="uag2-steps">${shown.map(rowHtml).join('')}${more}</div>`);
    groups.length = 0;
  };
  steps.forEach((step) => {
    if (step.diff?.length) {
      flush();
      const view = stepView(step);
      blocks.push(`<div class="uag2-steps">${rowHtml({ label: view.label, ok: view.ok, error: view.error, count: 1 })}</div>${diffHtml(step)}`);
      return;
    }
    const view = stepView(step);
    if (!view.label) return;
    const prev = groups[groups.length - 1];
    if (prev && prev.label === view.label && prev.ok === view.ok && prev.error === view.error) {
      prev.count += 1;
      return;
    }
    groups.push({ label: view.label, ok: view.ok, error: view.error, count: 1 });
  });
  flush();
  return blocks.join('');
}

function msgId(msg: Msg): string {
  if (!msg.id) msg.id = Math.random().toString(36).slice(2, 10);
  return msg.id;
}

function msgStamp(msg: Msg): string {
  const steps = Array.isArray(msg.steps) ? msg.steps : [];
  const text = String(msg.text || '');
  const diffs = steps.reduce((sum, step) => sum + (step.diff?.length || 0) + (step.path?.length || 0), 0);
  return `${msg.role}|${msg.live ? 1 : 0}|${steps.length}|${diffs}|${text.length}|${msg.reasoning?.length || 0}|${msg.thought?.length || 0}`;
}

function assistantHtml(msg: Msg, stream: boolean): string {
  const shown = presentAnswer(String(msg.text || ''), msg.reasoning || '');
  const text = shown.text.trim();
  const parts: string[] = [];
  if (msg.thought) parts.push(`<details class="uag2-thought"><summary>Размышление</summary><div class="uag2-md">${renderMd(msg.thought)}</div></details>`);
  if (msg.live || text || shown.reasoning) {
    let body = '';
    if (msg.live) body = `<div class="uag2-md" id="uag2-live-md">${text ? renderMd(text) : '<span class="uag2-caret"></span>'}</div>`;
    else if (text) {
      const parsed = choices(text);
      if (parsed.body) {
        const plain = esc(parsed.body).replace(/\n/g, '&#10;');
        body = `<div class="uag2-md${stream ? ' is-streaming' : ''}"${stream ? ` data-stream="1" data-plain="${plain}"` : ''}>${renderMd(parsed.body)}</div>`;
      }
      if (parsed.items.length) {
        parts.push(`<article class="uag2-ask">${parsed.title ? `<b>${esc(parsed.title)}</b>` : ''}${parsed.items.map((item) => `<button type="button" data-choice="${esc(item.label)}"><i>${esc(item.key)}</i><span>${esc(item.label)}</span></button>`).join('')}</article>`);
      }
    }
    if (body || shown.reasoning) parts.push(`<article class="uag2-bubble uag2-answer">${body}${thinkHtml(shown.reasoning, Boolean(msg.live))}</article>`);
  }
  const steps = Array.isArray(msg.steps) ? msg.steps : [];
  if (steps.length) parts.push(toolRows(steps));
  return parts.join('');
}

// Новые пузыри дописываются. Уже показанные не пересобираются, живой текст правится на месте.
function syncLog(session: Session): void {
  const log = document.getElementById('uag2-log');
  if (!log) return;
  const freshSession = log.dataset.session !== session.id;
  if (freshSession) {
    log.dataset.session = session.id;
    log.replaceChildren();
    log.insertAdjacentHTML('beforeend', `<div class="uag2-day">${esc(dayLabel(session.updated))}</div>`);
  }
  const greet = log.querySelector('.uag2-greet');
  if (!session.messages.length) {
    if (!greet) log.insertAdjacentHTML('beforeend', `<article class="uag2-bubble uag2-greet${freshSession ? '' : ' uag-in'}">${esc(GREETING)}</article>`);
  } else greet?.remove();
  const stream = streamOnce;
  streamOnce = false;
  const last = session.messages[session.messages.length - 1];
  const nodes = Array.from(log.querySelectorAll('[data-mid]')) as HTMLElement[];
  session.messages.forEach((msg, index) => {
    const id = msgId(msg);
    const stamp = msgStamp(msg);
    const node = nodes[index];
    const play = Boolean(stream && msg === last && msg.role === 'assistant' && !msg.live);
    if (node?.dataset.mid === id && node.dataset.stamp === stamp) return;
    if (node?.dataset.mid === id && msg.live && node.querySelector('#uag2-live-md')) {
      const shown = presentAnswer(msg.text, msg.reasoning || '');
      const md = node.querySelector('#uag2-live-md');
      if (md) md.innerHTML = shown.text ? renderMd(shown.text) : '<span class="uag2-caret"></span>';
      const reason = node.querySelector<HTMLElement>('.uag2-think');
      if (reason) {
        const full = shown.reasoning.trim();
        reason.hidden = !full;
        reason.dataset.reason = full;
      }
      node.dataset.stamp = stamp;
      return;
    }
    const fresh = document.createElement('div');
    const appear = !freshSession && node?.dataset.mid !== id;
    fresh.className = `uag2-msg${appear ? ' uag-in' : ''}`;
    fresh.dataset.mid = id;
    fresh.dataset.stamp = stamp;
    fresh.innerHTML = msg.role === 'user' ? messageHtml(msg) : assistantHtml(msg, play);
    const tail = log.querySelector('.uag2-tail');
    if (node?.dataset.mid === id) node.replaceWith(fresh);
    else if (tail) log.insertBefore(fresh, tail);
    else log.appendChild(fresh);
  });
  Array.from(log.querySelectorAll('[data-mid]')).slice(session.messages.length).forEach((node) => node.remove());
  let tail = log.querySelector('.uag2-tail') as HTMLElement | null;
  if (!tail) {
    tail = document.createElement('div');
    tail.className = 'uag2-tail';
    log.appendChild(tail);
  }
  const tailHtml = liveForm
    ? formCardHtml(liveForm)
    : busy && !session.messages.some((msg) => msg.live)
      ? `<div class="uag2-status">${dotsHtml()}<span>Читаю сообщение</span></div>`
      : '';
  if (tail.dataset.html !== tailHtml) {
    tail.innerHTML = tailHtml;
    tail.dataset.html = tailHtml;
  }
  stickLog(freshSession);
  if (stream) playStream();
}

const PIXI_MODELS = [
  { id: 'pixi-2.0-lite', tier: 'Lite', tone: 'lite', family: 'Pixi 2.0' },
  { id: 'pixi-2.0-pro', tier: 'Pro', tone: 'pro', family: 'Pixi 2.0' },
  { id: 'pixi-2.0-ultra', tier: 'Ultra', tone: 'ultra', family: 'Pixi 2.0' },
  { id: 'pixi-2.1-flash', tier: 'Flash', tone: 'flash', family: 'Pixi 2.1' },
] as const;

type PixiModelId = (typeof PIXI_MODELS)[number]['id'];

const LOCK_HINT = 'Эта модель сейчас недоступна публично. Она может быть открыта позже';
let unlockedModels = new Set<string>(['pixi-2.0-lite']);
let accessReady = false;
let gateStatus: 'open' | 'none' | 'pending' | 'rejected' = 'open';
let gateEpoch = 0;

function modelUnlocked(id: string): boolean {
  if (!accessReady) return id === 'pixi-2.0-lite' || unlockedModels.has(id);
  return unlockedModels.has(id);
}

function currentPixiModel(): PixiModelId {
  const saved = localStorage.getItem('Undefined Client-ai-model');
  const mapped = saved === 'pixi-1.5' ? 'pixi-2.0-ultra' : saved;
  const known = PIXI_MODELS.find((row) => row.id === mapped);
  if (known && modelUnlocked(known.id)) return known.id;
  return 'pixi-2.0-lite';
}

function pixiModelRow(id = currentPixiModel()) {
  return PIXI_MODELS.find((row) => row.id === id) || PIXI_MODELS[0];
}

function modelFor(_session: Session): PixiModelId {
  return currentPixiModel();
}

function launcherMark(className: string): string {
  return `<svg class="${className}" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect width="11" height="11"></rect><rect x="11" y="11" width="5" height="5"></rect></svg>`;
}

function syncModelButton(): void {
  const host = document.getElementById('uag2-model');
  const button = document.getElementById('uag2-model-btn');
  const badge = document.getElementById('uag2-model-badge');
  const menu = document.getElementById('uag2-model-menu');
  const picked = pixiModelRow(modelFor(current()));
  host?.setAttribute('data-tone', picked.tone);
  button?.setAttribute('aria-label', `Модель ${picked.family} ${picked.tier}`);
  if (badge) badge.textContent = picked.tier;
  if (!menu) return;
  menu.innerHTML = PIXI_MODELS.map((row) => {
    const on = row.id === picked.id;
    const locked = row.id !== 'pixi-2.0-lite' && !modelUnlocked(row.id);
    const lock = locked ? '<svg class="uag2-model-lock" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="3.2" y="7" width="9.6" height="7" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.4"></rect><path d="M5.2 7V5.1a2.8 2.8 0 0 1 5.6 0V7" fill="none" stroke="currentColor" stroke-width="1.4"></path></svg>' : '';
    return `<button type="button" class="uag2-model-row${on ? ' is-on' : ''}${locked ? ' is-locked' : ''}" role="option" aria-selected="${on ? 'true' : 'false'}" aria-disabled="${locked ? 'true' : 'false'}" data-model="${row.id}" data-tone="${row.tone}"${locked ? ` data-locked="1" title="${LOCK_HINT}"` : ''}>${launcherMark('uag2-model-mark')}<span class="uag2-model-tier">${row.tier}</span><span class="uag2-model-name">${row.family}</span>${lock}${on && !locked ? '<span class="uag2-model-state">Выбрана</span>' : ''}</button>`;
  }).join('');
}

function popMenu(menu: HTMLElement | null, open: boolean): void {
  if (!menu) return;
  if (open) {
    menu.hidden = false;
    menu.classList.remove('is-closing');
    menu.classList.remove('is-open');
    void menu.offsetWidth;
    menu.classList.add('is-open');
    return;
  }
  if (menu.hidden) return;
  menu.classList.remove('is-open');
  menu.classList.add('is-closing');
  window.setTimeout(() => {
    if (!menu.classList.contains('is-closing')) return;
    menu.hidden = true;
    menu.classList.remove('is-closing');
  }, 180);
}

function setModelMenu(open: boolean): void {
  const menu = document.getElementById('uag2-model-menu');
  document.getElementById('uag2-model-btn')?.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) syncModelButton();
  popMenu(menu, open);
}

function shellHtml(): string {
  return `<div class="uag2">
    <aside class="uag2-side">
      <div class="uag2-tools">
        <button type="button" class="uag2-icon" id="uag2-side-toggle" aria-label="Список"><img src="${ICON}/sidebar.svg" alt=""></button>
        <button type="button" class="uag2-icon" id="uag2-new" aria-label="Новый агент"><img src="${ICON}/newAgent.svg" alt=""></button>
      </div>
      <div class="uag2-list" id="uag2-list"></div>
      <button type="button" class="uag2-tg" id="uag2-tg">Telegram</button>
    </aside>
    <section class="uag2-chat">
      <header class="uag2-top">
        <button type="button" class="uag2-icon uag2-top-toggle" id="uag2-side-open" aria-label="Открыть список"><img src="${ICON}/sidebar.svg" alt=""></button>
        <div class="uag2-top__center">
          <button type="button" class="uag2-pill" id="uag2-pill"><span id="uag2-pill-face"></span><span id="uag2-title"></span></button>
        </div>
      </header>
      <div class="uag2-stream">
      <div class="uag2-log" id="uag2-log"></div>
      <div class="uag2-chip" id="uag2-chip"></div>
      <form class="uag2-form" id="uag2-form">
        <div class="uag2-form__row">
          <div class="uag2-plus" id="uag2-plus">
            <button type="button" class="uag2-round" id="uag2-file" aria-label="Прикрепить" aria-haspopup="menu" aria-expanded="false"><img src="${ICON}/attachFile.svg" alt=""></button>
            <div class="uag2-plus-menu" id="uag2-plus-menu" role="menu" hidden></div>
          </div>
          <div class="uag2-model" id="uag2-model" data-tone="lite">
            <button type="button" id="uag2-model-btn" aria-haspopup="listbox" aria-expanded="false" aria-label="Модель Pixi 2.0 Lite">
              ${launcherMark('uag2-model-logo')}
              <span class="uag2-model-badge" id="uag2-model-badge">Lite</span>
              <svg class="uag2-model-chevron" viewBox="0 0 10 6" width="10" height="6" aria-hidden="true"><path d="M1 1.15 5 4.85 9 1.15" fill="none" stroke="#9A9A9A" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path></svg>
            </button>
            <div class="uag2-model-menu" id="uag2-model-menu" role="listbox" hidden></div>
          </div>
          <input id="uag2-input" type="text" autocomplete="off">
          <button type="button" class="uag2-round is-send" id="uag2-act" aria-label="Говорить"><img src="${ICON}/microphone.svg" alt=""></button>
        </div>
        <div class="uag2-meta">
          <span class="uag2-ctx" id="uag2-ctx"><span class="uag2-ctx__dot"></span><span id="uag2-ctx-label">Без контекста</span></span>
          <button type="button" class="uag2-usage" id="uag2-usage" aria-expanded="false" title="Контекст">
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle class="uag2-ring__track" cx="8" cy="8" r="6"></circle><circle class="uag2-ring__value" id="uag2-ring" cx="8" cy="8" r="6"></circle></svg>
            <span id="uag2-usage-label">0%</span>
          </button>
          <div class="uag2-usage-menu" id="uag2-usage-menu" hidden></div>
        </div>
        <input id="uag2-file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif,.txt,.json,.yml,.yaml,.log,.md,.properties,.sk" multiple hidden>
      </form>
      </div>
    </section>
    <aside class="uag2-about">
      <button type="button" class="uag2-icon" id="uag2-about-x" aria-label="Закрыть"><img src="${ICON}/closeAgentInfoSidebar.svg" alt=""></button>
      <button type="button" class="uag-face-btn" id="uag2-face" aria-label="Внешний вид"></button>
      <div class="uag-picker" id="uag2-picker" hidden></div>
      <div class="uag2-name" id="uag2-namebox"><span id="uag2-name"></span><button type="button" id="uag2-rename" aria-label="Переименовать"><img src="${ICON}/editAgentName.svg" alt=""></button></div>
      <div class="uag2-card">
        <button type="button" class="is-danger" id="uag2-delete"><img src="../../assets/Pixi_DeleteAgent.svg" alt=""><span>Удалить агента</span></button>
        <button type="button" id="uag2-copy"><img src="../../assets/Pixi_CopyAgentID.svg" alt=""><span id="uag2-copy-label">Копировать ID агента</span></button>
      </div>
      <div class="uag2-tabs">
        <button type="button" data-panel="activity">Активность</button>
        <button type="button" data-panel="library">Библиотека</button>
      </div>
      <div class="uag2-panel" id="uag2-panel"></div>
    </aside>
    <div class="uag2-gate" id="uag2-gate" hidden>
      <div class="uag2-gate__track" id="uag2-gate-track">
        <section class="uag2-gate__slide">
          <div class="uag2-gate__brand">
            <span class="uag2-gate__face" data-bloub data-shape="squircle" data-color="accent" data-expr="attentif" data-mode="idle" data-follow="1"></span>
            <b>Pixi Agent</b>
          </div>
          <button type="button" class="uag2-gate__apply" id="uag2-gate-apply">Подать заявку</button>
          <p class="uag2-gate__chip"><i></i><span>У вас нет доступа к Pixi Agent: для использования нужно подать заявку</span></p>
          <p class="uag2-gate__status" id="uag2-gate-status" hidden></p>
        </section>
        <section class="uag2-gate__slide">
          <div class="uag2-gate__brand">
            <span class="uag2-gate__face" data-bloub data-shape="squircle" data-color="accent" data-expr="curieux" data-mode="idle" data-follow="1"></span>
            <b>Pixi Agent</b>
          </div>
          <p class="uag2-gate__ask">Для чего вам нужен доступ к Pixi Agent?</p>
          <textarea class="uag2-gate__text" id="uag2-gate-text" maxlength="1000" placeholder="Набранный текст для заявки"></textarea>
          <div class="uag2-gate__row">
            <button type="button" class="uag2-gate__back" id="uag2-gate-back" aria-label="Назад"><svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M7.5 2.2 3.7 6l3.8 3.8" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path></svg></button>
            <button type="button" class="uag2-gate__apply" id="uag2-gate-submit">Отправить на рассмотрение</button>
          </div>
        </section>
      </div>
      <p class="uag2-gate__legal">Используя Pixi Agent, вы соглашаетесь с <button type="button" class="uag2-gate__terms" id="uag2-gate-terms">условиями</button></p>
    </div>
  </div>`;
}

function activityHtml(steps: Step[], running = false): string {
  if (!steps.length) return '<p class="uag2-muted">Здесь появятся действия: сборки, моды, серверы, конфиги, поиск.</p>';
  const rows = steps.map((step, index) => {
    const run = running && index === steps.length - 1;
    const state = run ? 'Сейчас' : step.ok ? 'Готово' : 'Не вышло';
    return `<div class="uag2-act${run ? ' is-run' : ''}${step.ok ? '' : ' is-bad'}"><span class="uag2-act__dot"></span><span class="uag2-act__body"><b>${esc(step.detail)}</b></span><em class="uag2-act__state">${state}</em></div>`;
  }).join('');
  return `<div class="uag2-feed">${rows}</div>`;
}

function libTone(status: string): string {
  if (/run|online|start|запущ|работает/i.test(status)) return '';
  if (/stop|off|error|останов|ошиб/i.test(status)) return ' is-bad';
  return ' is-idle';
}

function libRow(title: string, meta: string, tone = ' is-idle'): string {
  const sub = meta ? `<small>${esc(meta)}</small>` : '';
  return `<div class="uag2-act is-lib${tone}"><span class="uag2-act__dot"></span><span class="uag2-act__body"><b>${esc(title)}</b>${sub}</span></div>`;
}

function pickerHtml(session: Session): string {
  const shapes = SHAPES.map((shape) => `<button type="button" data-shape="${shape}" class="${session.shape === shape ? 'is-on' : ''}">${headHtml({ id: session.id, shape, color: session.color }, 'sm', 'idle', true)}</button>`).join('');
  const colors = COLORS.map((color) => `<button type="button" data-color="${color}" class="uag-swatch${session.color === color ? ' is-on' : ''}" style="--head:${color}"></button>`).join('');
  return `<div class="uag-shapes">${shapes}</div><div class="uag-colors">${colors}</div>`;
}

function playStream(): void {
  const article = document.querySelector<HTMLElement>('[data-stream]');
  const node = article?.querySelector<HTMLElement>('.uag2-md');
  const plain = article?.dataset.plain || '';
  if (!node || !plain) return;
  const rich = /[*_`#|[\]\n]/.test(plain);
  if (!rich && plain.length < 280) {
    const words = plain.split(/(\s+)/);
    node.classList.remove('is-streaming');
    node.textContent = '';
    let index = 0;
    const step = () => {
      if (!node.isConnected) return;
      const chunk = document.createElement('span');
      chunk.className = 'uag-word';
      chunk.textContent = words.slice(index, index + 3).join('');
      node.appendChild(chunk);
      index += 3;
      if (index < words.length) requestAnimationFrame(step);
      else stickLog();
    };
    requestAnimationFrame(step);
    return;
  }
  const start = performance.now();
  const dur = Math.min(2200, 480 + plain.length * 7);
  const tick = (now: number) => {
    if (!node.isConnected) return;
    const progress = Math.min(1, (now - start) / dur);
    const eased = 1 - (1 - progress) ** 3;
    node.style.setProperty('--stream', `${Math.max(12, eased * 120)}%`);
    if (progress < 1) requestAnimationFrame(tick);
    else {
      node.classList.remove('is-streaming');
      stickLog();
    }
  };
  requestAnimationFrame(tick);
}

function asRows(result: unknown, key: string): Record<string, unknown>[] {
  if (Array.isArray(result)) return result.filter((row) => row && typeof row === 'object') as Record<string, unknown>[];
  if (result && typeof result === 'object') {
    const value = (result as Record<string, unknown>)[key];
    if (Array.isArray(value)) return value.filter((row) => row && typeof row === 'object') as Record<string, unknown>[];
  }
  return [];
}

function markTabs(): void {
  document.querySelectorAll<HTMLElement>('[data-panel]').forEach((node) => {
    node.classList.toggle('is-on', node.dataset.panel === panel);
  });
}

async function paintPanel(): Promise<void> {
  const host = document.getElementById('uag2-panel');
  if (!host) return;
  markTabs();
  if (panel === 'activity') {
    const html = activityHtml(current().steps, busy);
    const mark = `${busy ? 1 : 0}|${current().steps.map((step) => `${step.ok ? 1 : 0}:${step.detail}`).join('\n')}`;
    if (host.dataset.view !== mark) {
      host.innerHTML = html;
      host.dataset.view = mark;
    }
    return;
  }
  const sessionId = current().id;
  if (libraryHtml && libraryFor === sessionId) {
    if (host.dataset.view !== `lib:${sessionId}`) {
      host.innerHTML = libraryHtml;
      host.dataset.view = `lib:${sessionId}`;
    }
    return;
  }
  const token = ++libraryToken;
  host.innerHTML = '<p class="uag2-muted">Читаю сборки и серверы…</p>';
  const builds = await api?.aiToolsRun?.('list_builds', {}, { confirmed: true });
  const servers = await api?.aiToolsRun?.('list_hosted_servers', {}, { confirmed: true });
  if (token !== libraryToken || panel !== 'library' || !host.isConnected) return;
  const buildRows = asRows(builds?.result, 'builds');
  const serverRows = asRows(servers?.result, 'servers');
  libraryFor = sessionId;
  libraryHtml = `
    <section class="uag2-lib">
      <h4>Сборки <em>${buildRows.length}</em></h4>
      <div class="uag2-feed">
        ${buildRows.slice(0, 12).map((row) => libRow(String(row.name || 'Сборка'), [row.gameVersion, row.loader].filter(Boolean).join(' · '), ' is-idle')).join('') || '<p class="uag2-muted">Сборок нет</p>'}
      </div>
    </section>
    <section class="uag2-lib">
      <h4>Свои серверы <em>${serverRows.length}</em></h4>
      <div class="uag2-feed">
        ${serverRows.slice(0, 12).map((row) => {
          const meta = String(row.status || row.software || '');
          return libRow(String(row.name || 'Сервер'), meta, libTone(meta));
        }).join('') || '<p class="uag2-muted">Своих серверов нет</p>'}
      </div>
    </section>`;
  host.dataset.view = `lib:${sessionId}`;
  host.innerHTML = libraryHtml;
}

function showSteps(steps: Step[]): void {
  if (quietTurn) return;
  const think = document.getElementById('uag2-think');
  const last = steps[steps.length - 1];
  if (think) think.innerHTML = `<b>Думаю</b><span>${dotsHtml()} ${esc(last?.detail || 'Читаю сообщение')}</span>`;
  if (panel === 'activity') {
    const host = document.getElementById('uag2-panel');
    if (host) host.innerHTML = activityHtml(steps, true);
  }
  stickLog();
}

// Вкладка агента при старте скрыта: scrollTop в этот момент не сохраняется.
// Конец ленты ставим, когда чат уже виден, и ещё раз при смене агента.
function jumpLog(log: HTMLElement, settle = false): void {
  const go = () => {
    if (log.isConnected) log.scrollTop = log.scrollHeight;
  };
  go();
  if (!settle) return;
  requestAnimationFrame(go);
  window.setTimeout(go, 80);
}

function stickLog(force = false): void {
  const log = document.getElementById('uag2-log');
  if (!log) return;
  if (log.clientHeight < 8) {
    if (force) log.dataset.pin = '1';
    return;
  }
  const near = log.scrollHeight - log.scrollTop - log.clientHeight < 96;
  const settle = force || log.dataset.pin === '1';
  if (!(settle || near)) return;
  log.dataset.pin = '';
  jumpLog(log, settle);
}

function watchLog(log: HTMLElement): void {
  let seen = false;
  const reveal = () => {
    if (log.clientHeight < 8 || seen) return;
    seen = true;
    stickLog(true);
  };
  const observer = new IntersectionObserver(() => {
    if (log.clientHeight < 8) {
      seen = false;
      return;
    }
    reveal();
  });
  observer.observe(log);
  const resize = new ResizeObserver(() => {
    if (!seen || log.dataset.pin === '1') reveal();
  });
  resize.observe(log);
}

function formatTokens(value: number): string {
  if (value >= 1000) {
    const text = (value >= 10000 ? (value / 1000).toFixed(0) : (value / 1000).toFixed(1)).replace(/\.0$/, '');
    return `${text}K`;
  }
  return String(value);
}

function contextOf(session: Session): { rows: { label: string; hint: string; tokens: number; color: string }[]; total: number; budget: number; usage: number; free: number } {
  let chars = 0;
  for (const msg of session.wire) {
    chars += String(msg.content || '').length;
    if (msg.tool_calls) chars += JSON.stringify(msg.tool_calls).length;
  }
  const buildTokens = session.build ? Math.ceil(`${session.build.id}${session.build.name}${session.build.meta}`.length / 4) + 40 : 0;
  const serverTokens = session.server ? Math.ceil(`${session.server.id}${session.server.name}`.length / 4) + 20 : 0;
  const modTokens = session.mod ? Math.ceil(`${session.mod.id}${session.mod.name}${session.mod.meta}`.length / 4) + 20 : 0;
  const rows = [
    { label: 'Система', hint: 'Преамбула агента', tokens: 280, color: 'rgba(255,255,255,0.35)' },
    { label: 'Инструменты', hint: 'Схемы MCP', tokens: 1800, color: '#ef4444' },
    { label: 'Сборка', hint: session.build ? [session.build.name, session.build.meta].filter(Boolean).join(' · ') : 'Не выбрана', tokens: buildTokens, color: '#7dd3a7' },
    { label: 'Сервер', hint: session.server?.name || 'Не выбран', tokens: serverTokens, color: '#5b8cff' },
    { label: 'Мод', hint: session.mod?.name || 'Не выбран', tokens: modTokens, color: '#d2a8ff' },
    { label: 'Диалог', hint: 'Сообщения и ответы инструментов', tokens: Math.ceil(chars / 4), color: '#e2b86b' },
  ];
  const total = rows.reduce((sum, row) => sum + row.tokens, 0);
  const free = Math.max(0, CONTEXT_BUDGET - total);
  return { rows, total, budget: CONTEXT_BUDGET, usage: Math.min(1, total / CONTEXT_BUDGET), free };
}

function usageMenuHtml(session: Session): string {
  const ctx = contextOf(session);
  const pct = Math.round(ctx.usage * 100);
  const bar = ctx.rows.map((row) => {
    const width = Math.max(row.tokens > 0 ? 0.4 : 0, (row.tokens / ctx.budget) * 100);
    return `<span style="width:${width}%;background:${row.color}"></span>`;
  }).join('') + `<span class="is-free" style="width:${(ctx.free / ctx.budget) * 100}%"></span>`;
  const lines = ctx.rows.map((row) => `<div class="uag2-usage-menu__row"><i style="background:${row.color}"></i><span><b>${esc(row.label)}</b><small>${esc(row.hint)}</small></span><em>${formatTokens(row.tokens)}</em></div>`).join('');
  return `<div class="uag2-usage-menu__head"><b>Контекст</b><span>${pct}% · ${formatTokens(ctx.total)} / ${formatTokens(ctx.budget)}</span></div><div class="uag2-usage-menu__bar">${bar}</div>${lines}<div class="uag2-usage-menu__row"><i class="is-free"></i><span><b>Свободно</b><small>Запас до лимита</small></span><em>${formatTokens(ctx.free)}</em></div>`;
}

function paintContext(session: Session): void {
  const label = document.getElementById('uag2-ctx-label');
  const parts = [
    session.build ? `Сборка · ${[session.build.name, session.build.meta].filter(Boolean).join(' · ')}` : '',
    session.server ? `Сервер · ${session.server.name}` : '',
    session.mod ? `Мод · ${session.mod.name}` : '',
  ].filter(Boolean);
  if (label) label.textContent = parts.join('  ·  ') || 'Без контекста';
  const dot = document.querySelector<HTMLElement>('#uag2-ctx .uag2-ctx__dot');
  if (dot) dot.style.background = session.build || session.server || session.mod ? '#7dd3a7' : 'rgba(255,255,255,0.28)';
  const ctx = contextOf(session);
  const ring = document.getElementById('uag2-ring');
  if (ring) {
    ring.style.strokeDasharray = String(RING);
    ring.style.strokeDashoffset = String(RING * (1 - ctx.usage));
  }
  const pct = Math.round(ctx.usage * 100);
  const usageLabel = document.getElementById('uag2-usage-label');
  if (usageLabel) usageLabel.textContent = `${pct}%`;
  const usage = document.getElementById('uag2-usage');
  if (usage) usage.title = `Контекст ${pct}% · ${formatTokens(ctx.total)} / ${formatTokens(ctx.budget)}`;
  const menu = document.getElementById('uag2-usage-menu');
  if (menu && !menu.hidden) menu.innerHTML = usageMenuHtml(session);
}

function faceSession(): Session {
  const id = document.getElementById('uag2-face')?.getAttribute('data-agent') || activeId;
  return sessions.find((row) => row.id === id) || current();
}

function fill(): void {
  const root = document.querySelector('.uag2');
  root?.classList.toggle('is-about-closed', !aboutOpen);
  root?.classList.toggle('is-side-closed', !sideOpen);
  const session = current();
  const modelHost = document.getElementById('uag2-model');
  if (modelHost && modelHost.dataset.session !== session.id) {
    modelHost.dataset.session = session.id;
    syncModelButton();
  }
  const list = document.getElementById('uag2-list');
  const listStamp = `${activeId}|${sessions.map((row) => `${row.id}:${row.shape}:${row.color}:${row.title}:${row.group}:${row.messages.length}:${avatarMode(row, busy && row.id === session.id)}`).join('|')}`;
  if (list && list.dataset.stamp !== listStamp) {
    list.innerHTML = listHtml();
    list.dataset.stamp = listStamp;
  }
  syncLog(session);
  const title = document.getElementById('uag2-title');
  if (title) title.textContent = session.title;
  const pillFace = document.getElementById('uag2-pill-face');
  if (pillFace) placeHead(pillFace, session, 'sm', busy);
  const face = document.getElementById('uag2-face');
  if (face) {
    face.dataset.agent = session.id;
    placeHead(face, session, 'lg', busy);
  }
  const picker = document.getElementById('uag2-picker');
  if (picker) {
    picker.hidden = !pickerOpen;
    const pickerStamp = pickerOpen ? `${session.id}:${session.shape}:${session.color}` : '';
    if (picker.dataset.stamp !== pickerStamp) {
      picker.dataset.stamp = pickerStamp;
      picker.innerHTML = pickerOpen ? pickerHtml(session) : '';
    }
  }
  if (!focusReady.has(session.id)) {
    focusReady.add(session.id);
    const hadFocus = Boolean(session.server || session.build);
    if (!session.server) recoverServer(session);
    if (!session.build) recoverBuild(session);
    if (!hadFocus && (session.server || session.build)) save();
  }
  paintContext(session);
  const name = document.getElementById('uag2-name');
  if (name && !renaming) name.textContent = session.title;
  const input = document.getElementById('uag2-input') as HTMLInputElement | null;
  if (input) input.placeholder = `Сообщение для ${session.title}`;
  const chip = document.getElementById('uag2-chip');
  if (chip) {
    const shots = pendingShots.map((shot, index) => `<span class="uag2-shot"><button type="button" data-open-shot="${index}"><img src="${shot.url}" alt="${esc(shot.name)}"></button><button type="button" class="uag2-x" data-clear-shot="${index}" aria-label="Убрать">${CLOSE_ICON}</button></span>`).join('');
    const file = pendingFile ? `<span class="uag2-filechip"><span>${esc(pendingFile.name)}</span><button type="button" class="uag2-x" data-clear-file="1" aria-label="Убрать">${CLOSE_ICON}</button></span>` : '';
    const note = pendingShots.length && !modelSeesImages() ? '<small class="uag2-shot-note">Картинку видят Pro и Lite</small>' : '';
    chip.innerHTML = `${shots}${file}${note}`;
  }
  void paintPanel();
  syncActButton();
  const host = document.getElementById('uagent-root');
  if (host) syncAgentFaces(host);
}

function beginRename(): void {
  const box = document.getElementById('uag2-namebox');
  const session = current();
  if (!box || renaming) return;
  renaming = true;
  box.innerHTML = `<input id="uag2-name-input" value="${esc(session.title)}" maxlength="40"><input class="is-group" id="uag2-group-input" value="${esc(session.group)}" maxlength="32" placeholder="Группа">`;
  const name = document.getElementById('uag2-name-input') as HTMLInputElement | null;
  const group = document.getElementById('uag2-group-input') as HTMLInputElement | null;
  name?.focus();
  name?.select();
  const done = () => {
    if (!renaming) return;
    if (box.contains(document.activeElement)) return;
    renaming = false;
    const next = name?.value.trim().slice(0, 40);
    if (next) session.title = next;
    session.group = group?.value.trim().slice(0, 32) || '';
    save();
    box.innerHTML = `<span id="uag2-name"></span><button type="button" id="uag2-rename" aria-label="Переименовать"><img src="${ICON}/editAgentName.svg" alt=""></button>`;
    fill();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      (event.target as HTMLElement).blur();
    }
  };
  name?.addEventListener('keydown', onKey);
  group?.addEventListener('keydown', onKey);
  name?.addEventListener('blur', () => window.setTimeout(done, 80));
  group?.addEventListener('blur', () => window.setTimeout(done, 80));
}

function bindLook(root: HTMLElement): void {
  const about = root.querySelector('.uag2-about');
  if (!about) return;
  about.addEventListener('mousemove', (event: Event) => {
    const point = event as MouseEvent;
    setAgentGaze(point.clientX, point.clientY);
  });
  about.addEventListener('mouseleave', () => setAgentGaze(null, null));
}

function attachItem(kind: 'mod' | 'build' | 'server' | 'file', label: string, icon: string, hint: string): string {
  const sub = hint ? `<small>${esc(hint)}</small>` : '';
  return `<button type="button" role="menuitem" data-attach="${kind}"><img src="${icon}" alt=""><span><b>${label}</b>${sub}</span></button>`;
}

function hasAttachFocus(session = current()): boolean {
  return Boolean(session.mod || session.build || session.server || pendingFile || pendingShots.length);
}

function attachMenuHtml(kind: AttachKind): string {
  const session = current();
  if (kind === 'root') {
    const idle = hasAttachFocus(session) ? '' : ' disabled';
    return [
      attachItem('mod', 'Мод', `${TAB_ICON}/modscatalog.svg`, session.mod?.name || ''),
      attachItem('build', 'Сборка', `${TAB_ICON}/builds.svg`, session.build?.name || ''),
      attachItem('server', 'Сервер', `${TAB_ICON}/servers.svg`, session.server?.name || ''),
      attachItem('file', 'Файл', FILE_ICON, pendingFile?.name || ''),
      `<div class="uag2-plus-rule"></div><button type="button" class="uag2-plus-clear" data-attach-reset="1"${idle}>Очистить</button>`,
    ].join('');
  }
  const title = kind === 'mod' ? 'Мод' : kind === 'build' ? 'Сборка' : 'Сервер';
  const search = kind === 'mod' ? '<input type="text" data-attach-query placeholder="Название мода" autocomplete="off">' : '';
  return `<button type="button" data-attach-back="1"><span class="uag2-plus-chevron" aria-hidden="true"></span><span>${title}</span></button>${search}<div class="uag2-plus-list" id="uag2-plus-list"></div>`;
}

function setAttachMenu(kind: AttachKind): void {
  const menu = document.getElementById('uag2-plus-menu');
  const button = document.getElementById('uag2-file');
  const was = attachKind;
  attachKind = kind;
  attachQuery = '';
  attachRows = [];
  window.clearTimeout(attachTimer);
  button?.setAttribute('aria-expanded', kind ? 'true' : 'false');
  button?.classList.toggle('is-on', Boolean(kind));
  if (!menu) return;
  if (!kind) {
    popMenu(menu, false);
    return;
  }
  menu.innerHTML = attachMenuHtml(kind);
  if (!was) popMenu(menu, true);
  else {
    menu.hidden = false;
    menu.classList.add('is-open');
    menu.classList.remove('is-closing');
  }
  if (kind !== 'root') void loadAttachList();
  if (kind === 'mod') window.setTimeout(() => menu.querySelector<HTMLInputElement>('[data-attach-query]')?.focus(), 30);
}

function pickedAttach(kind: AttachKind): { id: string } | null {
  const session = current();
  if (kind === 'mod') return session.mod || null;
  if (kind === 'build') return session.build || null;
  if (kind === 'server') return session.server || null;
  return null;
}

function setHold(session: Session, kind: 'server' | 'build' | 'mod', held: boolean): void {
  const hold: FocusHold = { ...(session.hold || {}) };
  if (held) hold[kind] = true;
  else delete hold[kind];
  session.hold = hold.server || hold.build || hold.mod ? hold : undefined;
}

function clearAttachFocus(): void {
  const session = current();
  session.mod = null;
  session.build = null;
  session.server = null;
  setHold(session, 'mod', true);
  setHold(session, 'build', true);
  setHold(session, 'server', true);
  pendingFile = null;
  pendingShots = [];
  save();
  setAttachMenu('');
  fill();
}

function applyAttach(kind: AttachKind, row: { id: string; name: string; meta: string } | null): void {
  const session = current();
  if (kind !== 'mod' && kind !== 'build' && kind !== 'server') return;
  if (kind === 'mod') session.mod = row;
  if (kind === 'build') session.build = row;
  if (kind === 'server') session.server = row ? { id: row.id, name: row.name } : null;
  setHold(session, kind, !row);
  save();
  setAttachMenu('');
  fill();
}

async function loadAttachList(): Promise<void> {
  const list = document.getElementById('uag2-plus-list');
  const kind = attachKind;
  if (!list || (kind !== 'mod' && kind !== 'build' && kind !== 'server')) return;
  const token = ++attachToken;
  if (kind === 'mod' && attachQuery.trim().length < 2) {
    list.innerHTML = '<p class="uag2-plus-empty">Введите хотя бы 2 буквы</p>';
    return;
  }
  list.innerHTML = '<p class="uag2-plus-empty">Загрузка…</p>';
  const build = current().build;
  const [version, loader] = (build?.meta || '').split('·').map((part) => part.trim());
  const modArgs: Record<string, unknown> = { query: attachQuery.trim(), limit: 8 };
  if (version) modArgs.version = version;
  if (loader) modArgs.loader = loader.toLowerCase();
  let res: ToolRes | undefined;
  try {
    res = kind === 'build'
      ? await api?.aiToolsRun?.('list_builds', {}, { confirmed: true })
      : kind === 'server'
        ? await api?.aiToolsRun?.('list_hosted_servers', {}, { confirmed: true })
        : await api?.aiToolsRun?.('search_mods', modArgs, { confirmed: true });
  } catch {
    res = undefined;
  }
  if (token !== attachToken || !list.isConnected || attachKind !== kind) return;
  if (!res || res.ok === false || res.error) {
    list.innerHTML = '<p class="uag2-plus-empty">Не удалось загрузить</p>';
    return;
  }
  const source = kind === 'build' ? 'builds' : kind === 'server' ? 'servers' : 'mods';
  attachRows = asRows(res?.result, source).map((row) => {
    const id = String((kind === 'mod' ? row.slug || row.id : row.id) || row.name || '');
    const loaders = Array.isArray(row.loaders) ? row.loaders.slice(0, 2).map(String).join(', ') : '';
    return {
      id,
      name: String(row.title || row.name || row.slug || (kind === 'mod' ? 'Мод' : kind === 'build' ? 'Сборка' : 'Сервер')),
      meta: kind === 'mod'
        ? [row.slug && String(row.slug) !== id ? String(row.slug) : '', loaders].filter(Boolean).join(' · ')
        : kind === 'server'
          ? [row.software, row.gameVersion, row.status].filter(Boolean).map(String).join(' · ')
          : [row.gameVersion, row.loader].filter(Boolean).map(String).join(' · '),
    };
  }).filter((row) => row.id);
  const currentId = pickedAttach(kind)?.id || '';
  const clear = currentId ? '<button type="button" data-attach-clear="1">Убрать из контекста</button>' : '';
  const rows = attachRows.map((row, index) => {
    const on = row.id === currentId ? ' is-on' : '';
    const meta = row.meta ? `<small>${esc(row.meta)}</small>` : '';
    return `<button type="button" class="${on.trim()}" data-attach-pick="${index}"><span><b>${esc(row.name)}</b>${meta}</span></button>`;
  }).join('');
  list.innerHTML = `${clear}${rows || '<p class="uag2-plus-empty">Ничего не нашлось</p>'}`;
}

function confirmDeleteAgent(): Promise<boolean> {
  const session = current();
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-confirm-overlay';
    overlay.innerHTML = `<div class="modal-confirm-card" role="dialog" aria-modal="true" aria-labelledby="uag2-delete-title">
      <div class="modal-confirm-message" id="uag2-delete-title">Удалить агента «${esc(session.title)}»? Чат пропадёт.</div>
      <div class="modal-confirm-actions">
        <button type="button" class="stngs-btn" data-no>Отмена</button>
        <button type="button" class="stngs-btn uag2-confirm-danger" data-yes>Удалить</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(ok);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') finish(false);
    };
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) finish(false);
    });
    overlay.querySelector('[data-no]')?.addEventListener('click', () => finish(false));
    overlay.querySelector('[data-yes]')?.addEventListener('click', () => finish(true));
    overlay.querySelector<HTMLButtonElement>('[data-no]')?.focus();
  });
}

function bind(root: HTMLElement): void {
  bindLook(root);
  const log = document.getElementById('uag2-log');
  if (log) watchLog(log);
  document.getElementById('uag2-model-menu')?.addEventListener('mousedown', (event) => {
    const choice = (event.target as HTMLElement).closest<HTMLElement>('[data-model]');
    if (!choice?.dataset.model || choice.dataset.locked === '1') return;
    event.preventDefault();
    event.stopPropagation();
    localStorage.setItem('Undefined Client-ai-model', choice.dataset.model);
    syncModelButton();
    setModelMenu(false);
  });
  root.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const think = target.closest<HTMLButtonElement>('.uag2-think');
    if (think) {
      const body = think.nextElementSibling as HTMLElement | null;
      const open = think.getAttribute('aria-expanded') === 'true';
      think.setAttribute('aria-expanded', open ? 'false' : 'true');
      think.textContent = open ? 'Показать размышления модели' : 'Скрыть размышления модели';
      if (body) {
        body.hidden = open;
        if (!open) body.textContent = think.dataset.reason || body.textContent || '';
      }
      return;
    }
    const usageMenu = document.getElementById('uag2-usage-menu');
    const modelMenu = document.getElementById('uag2-model-menu');
    const onUsage = Boolean(target.closest('#uag2-usage') || target.closest('#uag2-usage-menu'));
    const onModel = Boolean(target.closest('#uag2-model'));
    const onPlus = Boolean(target.closest('#uag2-plus'));
    if (attachKind && !onPlus) setAttachMenu('');
    if (usageMenu && !onUsage) {
      popMenu(usageMenu, false);
      document.getElementById('uag2-usage')?.setAttribute('aria-expanded', 'false');
    }
    if (modelMenu && !onModel) setModelMenu(false);
    if (target.closest('#uag2-usage')) {
      if (!usageMenu) return;
      const open = usageMenu.hidden;
      document.getElementById('uag2-usage')?.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) usageMenu.innerHTML = usageMenuHtml(current());
      popMenu(usageMenu, open);
      if (open) setModelMenu(false);
      return;
    }
    const modelChoice = target.closest<HTMLElement>('#uag2-model-menu [data-model]');
    if (modelChoice?.dataset.model) {
      if (modelChoice.dataset.locked === '1') return;
      localStorage.setItem('Undefined Client-ai-model', modelChoice.dataset.model);
      syncModelButton();
      setModelMenu(false);
      if (pendingShots.length) fill();
      return;
    }
    if (target.closest('#uag2-model-btn')) {
      const open = document.getElementById('uag2-model-btn')?.getAttribute('aria-expanded') !== 'true';
      setModelMenu(open);
      if (open) {
        popMenu(usageMenu, false);
        document.getElementById('uag2-usage')?.setAttribute('aria-expanded', 'false');
      }
      return;
    }
    if (target.closest('#uag2-new')) {
      const session = blank('Новый агент');
      sessions.unshift(session);
      activeId = session.id;
      save();
      fill();
      return;
    }
    if (target.closest('#uag2-side-toggle')) {
      sideOpen = false;
      fill();
      return;
    }
    if (target.closest('#uag2-side-open')) {
      sideOpen = true;
      fill();
      return;
    }
    if (target.closest('#uag2-pill')) {
      aboutOpen = true;
      fill();
      return;
    }
    const shapeBtn = target.closest<HTMLElement>('#uag2-picker button[data-shape]');
    if (shapeBtn?.dataset.shape && (SHAPES as string[]).includes(shapeBtn.dataset.shape)) {
      current().shape = asShape(shapeBtn.dataset.shape);
      save();
      fill();
      return;
    }
    const colorBtn = target.closest<HTMLElement>('#uag2-picker button[data-color]');
    if (colorBtn?.dataset.color && /^#[0-9a-fA-F]{6}$/.test(colorBtn.dataset.color)) {
      current().color = colorBtn.dataset.color.toLowerCase();
      save();
      fill();
      return;
    }
    if (target.closest('#uag2-picker')) return;
    if (target.closest('#uag2-face')) {
      pickerOpen = !pickerOpen;
      fill();
      return;
    }
    if (target.closest('#uag2-about-x')) {
      aboutOpen = !aboutOpen;
      fill();
      return;
    }
    if (target.closest('#uag2-tg')) {
      openTelegram?.();
      return;
    }
    if (target.closest('#uag2-rename')) {
      beginRename();
      return;
    }
    if (target.closest('#uag2-delete')) {
      const id = current().id;
      void confirmDeleteAgent().then((ok) => {
        if (!ok || current().id !== id) return;
        sessions = sessions.filter((row) => row.id !== id);
        if (!sessions.length) sessions.push(blank('UAgent Bot'));
        activeId = sessions[0].id;
        save();
        fill();
      });
      return;
    }
    if (target.closest('#uag2-copy')) {
      void navigator.clipboard.writeText(current().id).then(() => {
        const label = document.getElementById('uag2-copy-label');
        if (!label) return;
        label.textContent = 'Скопировано';
        window.setTimeout(() => {
          if (label.isConnected) label.textContent = 'Копировать ID агента';
        }, 1200);
      }).catch(() => undefined);
      return;
    }
    if (target.closest('[data-form-skip]') && liveForm) {
      const pending = liveForm;
      liveForm = null;
      pending.resolve(null);
      return;
    }
    if (target.closest('#uag2-file')) {
      setAttachMenu(attachKind ? '' : 'root');
      return;
    }
    if (target.closest('[data-attach-back]')) {
      setAttachMenu('root');
      return;
    }
    if (target.closest('[data-attach-reset]')) {
      clearAttachFocus();
      return;
    }
    if (target.closest('[data-attach-clear]')) {
      applyAttach(attachKind, null);
      return;
    }
    const picked = target.closest<HTMLElement>('[data-attach-pick]');
    if (picked) {
      const row = attachRows[Number(picked.dataset.attachPick)];
      if (row) applyAttach(attachKind, row);
      return;
    }
    const attach = target.closest<HTMLElement>('[data-attach]');
    const kind = attach?.dataset.attach || '';
    if (kind === 'file') {
      setAttachMenu('');
      document.getElementById('uag2-file-input')?.click();
      return;
    }
    if (kind === 'mod' || kind === 'build' || kind === 'server') {
      setAttachMenu(kind);
      return;
    }
    if (target.closest('[data-clear-file]')) {
      pendingFile = null;
      fill();
      return;
    }
    const clearShot = target.closest<HTMLElement>('[data-clear-shot]');
    if (clearShot) {
      const index = Number(clearShot.dataset.clearShot);
      if (Number.isInteger(index)) pendingShots.splice(index, 1);
      fill();
      return;
    }
    const openPending = target.closest<HTMLElement>('[data-open-shot]');
    if (openPending) {
      const at = Number(openPending.dataset.openShot);
      openShotList(pendingShots.map((shot) => ({ src: shot.url, alt: shot.name })), Number.isInteger(at) ? at : 0);
      return;
    }
    const bubbleShot = target.closest<HTMLElement>('.uag2-bubble .uag2-shot');
    if (bubbleShot) {
      const shots = Array.from(bubbleShot.parentElement?.querySelectorAll<HTMLElement>('.uag2-shot') || [bubbleShot]);
      const at = Math.max(0, shots.indexOf(bubbleShot));
      openShotList(shots.map((node) => {
        const img = node.querySelector('img');
        return { src: img?.src || '', alt: img?.alt || '' };
      }), at);
      return;
    }
    const panelBtn = target.closest<HTMLElement>('[data-panel]');
    if (panelBtn) {
      panel = panelBtn.dataset.panel === 'library' ? 'library' : 'activity';
      void paintPanel();
      return;
    }
    if (target.closest('[data-activity]')) {
      panel = 'activity';
      aboutOpen = true;
      void paintPanel();
      document.querySelector('.uag2')?.classList.remove('is-about-closed');
      return;
    }
    const choice = target.closest<HTMLElement>('[data-choice]');
    if (choice?.dataset.choice) {
      void askUAgent(choice.dataset.choice);
      return;
    }
    const ungroup = target.closest<HTMLElement>('[data-ungroup]');
    if (ungroup) {
      const title = ungroup.dataset.ungroup || '';
      sessions.forEach((row) => {
        if (row.group === title) row.group = '';
      });
      save();
      fill();
      return;
    }
    const close = target.closest<HTMLElement>('[data-close]');
    if (close) {
      sessions = sessions.filter((row) => row.id !== close.dataset.close);
      if (!sessions.length) sessions.push(blank('UAgent Bot'));
      if (!sessions.some((row) => row.id === activeId)) activeId = sessions[0].id;
      save();
      fill();
      return;
    }
    const row = target.closest<HTMLElement>('[data-id]');
    if (row?.dataset.id) {
      activeId = row.dataset.id;
      fill();
    }
  });

  root.addEventListener('paste', (event) => {
    const items = Array.from(event.clipboardData?.items || []);
    const images = items
      .filter((item) => item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    if (!images.length) return;
    event.preventDefault();
    void addShots(images);
  });

  root.querySelector('#uag2-file-input')?.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []);
    input.value = '';
    if (!files.length) return;
    const images = files.filter((file) => file.type.startsWith('image/'));
    const textFile = files.find((file) => !file.type.startsWith('image/'));
    if (images.length) void addShots(images);
    if (!textFile) return;
    void textFile.text().then((text) => {
      pendingFile = {
        name: textFile.name.slice(0, 80),
        text: textFile.size > 200_000 ? '(файл больше 200 КБ, передано только имя)' : text.slice(0, 60_000),
      };
      fill();
    }).catch(() => undefined);
  });

  root.addEventListener('submit', (event) => {
    const form = (event.target as HTMLElement | null)?.closest?.('#uag2-user-form') as HTMLFormElement | null;
    if (!form || !liveForm) return;
    event.preventDefault();
    const missing = liveForm.fields.find((field) => {
      if (!field.required) return false;
      if (field.type === 'toggle') return false;
      const value = new FormData(form).get(field.id);
      return !String(value || '').trim();
    });
    const error = form.querySelector('.uag2-cardform__error');
    if (missing) {
      if (error) error.textContent = `Заполни «${missing.label}»`;
      return;
    }
    const data = new FormData(form);
    const answers: Record<string, string> = {};
    for (const field of liveForm.fields) {
      if (field.type === 'toggle') answers[field.id] = (form.querySelector(`[name="${field.id}"]`) as HTMLInputElement | null)?.checked ? 'да' : 'нет';
      else answers[field.id] = String(data.get(field.id) || '').trim();
    }
    const pending = liveForm;
    liveForm = null;
    pending.resolve(answers);
  });

  document.getElementById('uag2-plus-menu')?.addEventListener('input', (event) => {
    const input = event.target as HTMLInputElement;
    if (!input.matches('[data-attach-query]')) return;
    attachQuery = input.value;
    window.clearTimeout(attachTimer);
    attachTimer = window.setTimeout(() => { void loadAttachList(); }, 280);
  });
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !attachKind) return;
    event.stopPropagation();
    setAttachMenu('');
  });

  root.querySelector('#uag2-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    if (document.activeElement?.matches('[data-attach-query]')) return;
    stopSpeech();
    const input = document.getElementById('uag2-input') as HTMLInputElement | null;
    const text = input?.value.trim() || '';
    if ((!text && !pendingFile && !pendingShots.length) || !input || busy) return;
    input.value = '';
    void askUAgent(text);
  });

  root.querySelector('#uag2-act')?.addEventListener('click', () => {
    if (busy) {
      stopLocalTurn();
      return;
    }
    if (listening || speechPrep) stopSpeech();
    else void startSpeech();
  });
}

function syncActButton(): void {
  const button = document.getElementById('uag2-act');
  if (!button) return;
  if (busy) {
    button.classList.add('is-stop');
    button.classList.remove('is-rec');
    button.setAttribute('aria-label', 'Остановить');
    button.innerHTML = '<i class="uag2-stop"></i>';
    return;
  }
  button.classList.remove('is-stop');
  button.classList.toggle('is-rec', listening || speechPrep);
  button.setAttribute('aria-label', listening ? 'Остановить запись' : speechPrep ? 'Готовлю распознавание' : 'Говорить');
  button.innerHTML = `<img src="${ICON}/microphone.svg" alt="">`;
}

type VoskRecognizer = {
  on: (event: 'result' | 'partialresult', listener: (message: { result?: { text?: string; partial?: string } }) => void) => void;
  acceptWaveform: (buffer: AudioBuffer) => void;
  retrieveFinalResult: () => void;
  remove: () => void;
};

type VoskModel = {
  KaldiRecognizer: new (sampleRate: number) => VoskRecognizer;
};

let voskModel: Promise<VoskModel> | null = null;

type VoskApi = {
  Model: new (url: string) => VoskModel & {
    on: (event: 'load' | 'error', listener: (message: { result?: boolean; error?: string }) => void) => void;
  };
};

function loadVosk(): Promise<VoskApi> {
  const ready = (window as unknown as { Vosk?: VoskApi }).Vosk;
  if (ready?.Model) return Promise.resolve(ready);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'vendor/vosk.js';
    script.onload = () => {
      const loaded = (window as unknown as { Vosk?: VoskApi }).Vosk;
      if (loaded?.Model) resolve(loaded);
      else reject(new Error('Распознавание речи не загрузилось'));
    };
    script.onerror = () => reject(new Error('Распознавание речи не загрузилось'));
    document.head.appendChild(script);
  });
}

function openSpeechModel(vosk: VoskApi, url: string): Promise<VoskModel> {
  return new Promise((resolve, reject) => {
    const model = new vosk.Model(url);
    let done = false;
    let timer = 0;
    const finish = (err: Error | null) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      if (err) reject(err);
      else resolve(model);
    };
    timer = window.setTimeout(() => finish(new Error('Распознавание речи готовится слишком долго')), 90000);
    model.on('load', (message) => finish(message.result ? null : new Error('Модель распознавания не открылась')));
    model.on('error', (message) => finish(new Error(message.error || 'Модель распознавания не открылась')));
  });
}

function speechModel(): Promise<VoskModel> {
  if (!voskModel) {
    voskModel = (async () => {
      let stopProgress = () => {};
      const input = document.getElementById('uag2-input') as HTMLInputElement | null;
      if (input) input.title = 'Скачиваю распознавание речи…';
      stopProgress = api?.onSpeechProgress?.((percent) => {
        const box = document.getElementById('uag2-input') as HTMLInputElement | null;
        if (box && percent > 0 && percent < 100) box.title = `Скачиваю распознавание речи… ${percent}%`;
      }) || stopProgress;
      try {
        const packed = await api?.speechModel?.();
        if (!packed?.url) throw new Error(packed?.error || 'Не удалось подготовить распознавание речи');
        const box = document.getElementById('uag2-input') as HTMLInputElement | null;
        if (box) box.title = 'Распаковываю модель…';
        const vosk = await loadVosk();
        return await openSpeechModel(vosk, packed.url);
      } catch (err) {
        voskModel = null;
        throw err;
      } finally {
        stopProgress();
      }
    })();
  }
  return voskModel;
}

function stopSpeech(): void {
  speechGen += 1;
  listening = false;
  speechPrep = false;
  if (speechTimer) window.clearTimeout(speechTimer);
  speechTimer = 0;
  try {
    speechRec?.stop();
  } catch {
    /* запись уже закрыта */
  }
  speechRec = null;
  syncActButton();
}

function stopLocalTurn(): void {
  const running = localTurn;
  localTurn += 1;
  void api?.aiChatStop?.(String(running));
  stopSpeech();
  if (liveForm) {
    const pending = liveForm;
    liveForm = null;
    pending.resolve(null);
  }
  dangerResolve?.(false);
  dangerResolve = null;
  document.querySelector('.uag2-ask')?.remove();
}

function writeSpeech(input: HTMLInputElement, base: string, said: string, partial: string): void {
  input.value = [base, said, partial].map((part) => part.trim()).filter(Boolean).join(' ');
}

// Запись фразы в поле ввода. Текст остаётся, отправка по Enter.
// Модель живёт на компьютере: сервис Google из Chromium здесь не вызывается.
async function startSpeech(): Promise<void> {
  if (busy || listening || speechPrep) return;
  const input = document.getElementById('uag2-input') as HTMLInputElement | null;
  if (!input || !navigator.mediaDevices?.getUserMedia) {
    if (input) input.title = 'Распознавание речи недоступно';
    return;
  }
  const gen = speechGen;
  const base = input.value.trim();
  speechPrep = true;
  syncActButton();
  const audio = new AudioContext();
  let stream: MediaStream | null = null;
  const micPromise = navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    video: false,
  });
  micPromise.then((opened) => {
    if (gen !== speechGen) opened.getTracks().forEach((track) => track.stop());
  }).catch(() => {});
  try {
    const [model, mic] = await Promise.all([speechModel(), micPromise]);
    stream = mic;
    if (gen !== speechGen) {
      stream.getTracks().forEach((track) => track.stop());
      void audio.close();
      return;
    }
    if (audio.state === 'suspended') await audio.resume();
    const recognizer = new model.KaldiRecognizer(audio.sampleRate);
    let said = '';
    recognizer.on('partialresult', (message) => {
      if (gen !== speechGen) return;
      writeSpeech(input, base, said, message.result?.partial || '');
    });
    recognizer.on('result', (message) => {
      if (gen !== speechGen) return;
      const text = message.result?.text || '';
      if (text) said = `${said} ${text}`.trim();
      writeSpeech(input, base, said, '');
    });
    const source = audio.createMediaStreamSource(stream);
    const processor = audio.createScriptProcessor(4096, 1, 1);
    const mute = audio.createGain();
    mute.gain.value = 0;
    processor.onaudioprocess = (event) => {
      if (gen !== speechGen) return;
      try {
        recognizer.acceptWaveform(event.inputBuffer);
      } catch {
        /* кадр пришёл после остановки */
      }
    };
    source.connect(processor);
    processor.connect(mute);
    mute.connect(audio.destination);
    const session = {
      stop: () => {
        try { recognizer.retrieveFinalResult(); } catch { /* уже снят */ }
        window.setTimeout(() => {
          try { recognizer.remove(); } catch { /* уже снят */ }
        }, 400);
        try { processor.disconnect(); } catch { /* уже снят */ }
        try { source.disconnect(); } catch { /* уже снят */ }
        try { mute.disconnect(); } catch { /* уже снят */ }
        stream?.getTracks().forEach((track) => track.stop());
        void audio.close();
      },
    };
    if (gen !== speechGen) {
      session.stop();
      return;
    }
    speechRec = session;
    speechPrep = false;
    listening = true;
    input.title = '';
    speechTimer = window.setTimeout(() => stopSpeech(), 60000);
    syncActButton();
  } catch (err) {
    stream?.getTracks().forEach((track) => track.stop());
    void audio.close();
    if (gen !== speechGen) return;
    speechPrep = false;
    listening = false;
    speechRec = null;
    const name = err instanceof DOMException ? err.name : '';
    const message = err instanceof Error ? err.message : '';
    input.title = name === 'NotAllowedError' || name === 'NotFoundError' || /denied|notallowed|permission/i.test(message)
      ? 'Нет доступа к микрофону'
      : (message || 'Речь не распозналась');
    syncActButton();
  }
}

function confirmDanger(name: string): Promise<boolean> {
  const log = document.getElementById('uag2-log');
  if (!log) return Promise.resolve(false);
  return new Promise((resolve) => {
    const box = document.createElement('article');
    box.className = 'uag2-ask';
    box.innerHTML = `<b>${esc(toolLabel(name))}. Это нельзя отменить. Сделать?</b><button type="button" data-yes="1"><i>A</i><span>Да, сделать</span></button><button type="button" data-yes="0"><i>B</i><span>Нет</span></button>`;
    log.appendChild(box);
    log.scrollTop = log.scrollHeight;
    dangerResolve = (ok) => {
      dangerResolve = null;
      box.remove();
      resolve(ok);
    };
    box.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest('button');
      if (!button) return;
      dangerResolve?.(button.getAttribute('data-yes') === '1');
    });
  });
}

function aboutServer(text: string): boolean {
  return /сервер/i.test(text) && !/сборк/i.test(text);
}

function readServer(value: unknown): ServerFocus | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as { id?: unknown; name?: unknown };
  const id = String(row.id || '');
  if (!id) return null;
  return { id, name: String(row.name || id) };
}

function serversOf(result: ToolRes | undefined): ServerFocus[] {
  const root = result?.result && typeof result.result === 'object' ? result.result as Record<string, unknown> : null;
  const rows = root && Array.isArray(root.servers) ? root.servers : [];
  return rows.map(readServer).filter((row): row is ServerFocus => Boolean(row));
}

function namedServer(session: Session, rows: ServerFocus[]): ServerFocus | null {
  const text = session.messages.map((msg) => msg.text).join('\n').toLowerCase();
  return rows.find((row) => row.name.length > 2 && text.includes(row.name.toLowerCase())) || null;
}

function readBuild(value: unknown): BuildFocus | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.software || row.coreReady || row.players) return null;
  const name = String(row.name || '');
  const id = String(row.id || '');
  if (!name && !id) return null;
  const meta = [row.gameVersion || row.version, row.loader].filter(Boolean).map(String).join(' · ');
  return { id: id || name, name: name || id, meta };
}

function rememberBuild(session: Session, result: ToolRes | undefined, args: Record<string, unknown>, name: string): void {
  if (!/build/.test(name) || /hosted/.test(name) || name === 'list_builds' || name === 'compare_builds') return;
  const root = result?.result && typeof result.result === 'object' && !Array.isArray(result.result)
    ? result.result as Record<string, unknown>
    : null;
  const nested = readBuild(root?.build);
  const flat = root && (root.loader || root.loaderVersion) ? readBuild(root) : null;
  const one = nested || flat;
  if (one?.name) {
    session.build = one;
    return;
  }
  const id = typeof args.id === 'string' ? args.id : typeof args.buildId === 'string' ? args.buildId : '';
  if (id) session.build = { id, name: String(args.name || session.build?.name || id), meta: session.build?.id === id ? session.build.meta : '' };
}

function recoverBuild(session: Session): void {
  if (session.build?.name || session.hold?.build) return;
  for (const msg of session.wire) {
    if (msg.role === 'assistant') {
      for (const call of msg.tool_calls || []) {
        const tool = call.function?.name || '';
        if (!/build/.test(tool) || /hosted/.test(tool)) continue;
        try {
          rememberBuild(session, undefined, JSON.parse(call.function.arguments || '{}') as Record<string, unknown>, tool);
        } catch {
          /* аргументы инструмента уже не разобрать */
        }
      }
    }
    if (msg.role !== 'tool' || !msg.content) continue;
    try {
      rememberBuild(session, JSON.parse(msg.content) as ToolRes, {}, 'get_build');
    } catch {
      /* старый ответ инструмента */
    }
  }
}

const SERVER_ID_TOOLS = new Set([
  'play_command',
  'hosted_command',
  'start_hosted_server',
  'stop_hosted_server',
  'restart_hosted_server',
  'hosted_log',
  'list_hosted_plugins',
  'install_hosted_plugin',
  'toggle_hosted_plugin',
  'list_hosted_files',
  'read_hosted_file',
  'write_hosted_file',
  'delete_hosted_file',
  'mkdir_hosted',
  'copy_hosted_file',
  'move_hosted_file',
  'install_hosted_core',
  'update_hosted_server',
  'list_hosted_core_versions',
  'install_matching_plugin',
  'scan_configs',
  'find_hosted_files',
  'grep_hosted_files',
  'edit_hosted_file',
]);

function serverTool(name: string): boolean {
  return SERVER_ID_TOOLS.has(name);
}

const BUILD_ID_TOOLS = new Set([
  'get_build', 'update_build', 'delete_build', 'duplicate_build', 'rename_build', 'select_build', 'launch_build',
  'backup_build', 'install_mod', 'install_matching_mod', 'install_mod_bulk', 'update_outdated_mods',
  'list_build_mods', 'find_mod_in_build', 'list_build_content', 'toggle_mod', 'disable_all_mods', 'enable_all_mods',
  'remove_build_file', 'copy_mods_to_build', 'read_config', 'write_config', 'read_options', 'write_options',
  'get_options_value', 'set_options_value', 'list_configs', 'diagnose_build', 'get_crash_report', 'get_latest_log',
  'clear_logs', 'get_console_tail', 'open_console', 'set_java_for_build', 'set_build_memory', 'set_jvm_args',
  'set_build_window', 'recommend_java_for_build', 'validate_java_for_build', 'list_worlds', 'delete_world',
  'list_screenshots', 'delete_screenshot', 'list_instance_files', 'read_instance_file', 'write_instance_file', 'edit_instance_file', 'find_instance_files', 'grep_instance_files',
  'mkdir_instance', 'copy_instance_file', 'move_instance_file', 'delete_instance_file', 'find_mod_conflicts',
  'get_build_disk_usage', 'search_local_files', 'open_build_folder', 'clear_instance_cache',
]);

function pinBuildArgs(session: Session, name: string, args: Record<string, unknown>): void {
  const id = session.build?.id || '';
  if (!id || !BUILD_ID_TOOLS.has(name)) return;
  const given = typeof args.buildId === 'string' ? args.buildId.trim() : '';
  if (!given) args.buildId = id;
}

function rememberListedBuilds(session: Session, result: ToolRes | undefined): void {
  if (session.build?.id) return;
  const root = result?.result;
  const rows = Array.isArray(root) ? root.map(readBuild).filter((row): row is BuildFocus => Boolean(row)) : [];
  if (!rows.length) return;
  const text = session.messages.map((msg) => msg.text).join('\n').toLowerCase();
  const named = rows.filter((row) => row.name.length > 2 && text.includes(row.name.toLowerCase()));
  if (named.length === 1) session.build = named[0];
  else if (rows.length === 1) session.build = rows[0];
}

function pinServerArgs(session: Session, name: string, args: Record<string, unknown>): void {
  const id = session.server?.id || '';
  if (!id || !serverTool(name)) return;
  if (name === 'scan_configs' && args.buildId) return;
  const given = typeof args.id === 'string' ? args.id.trim() : '';
  if (!given || /\.jar$/i.test(given) || given.includes('/') || given.includes('\\')) args.id = id;
  if (name === 'play_command') args.focusId = id;
}

function serverChoiceForm(args: Record<string, unknown>): boolean {
  const fields = formFields(args.fields);
  const blob = `${args.title || ''} ${fields.map((field) => `${field.label} ${field.options.join(' ')}`).join(' ')}`.toLowerCase();
  if (!/сервер/.test(blob)) return false;
  return !/ник|игрок|материал|чар|сколько|стак/.test(blob);
}

function rememberServer(session: Session, result: ToolRes | undefined, args: Record<string, unknown>, name: string): void {
  const root = result?.result && typeof result.result === 'object' ? result.result as Record<string, unknown> : null;
  const acted = serverTool(name) && name !== 'list_hosted_servers' && name !== 'scan_configs';
  const one = readServer(root?.server) || (acted && result?.ok !== false ? readServer(root) : null);
  if (one && !/\.jar$/i.test(one.id)) {
    session.server = one;
    return;
  }
  if (acted && typeof args.id === 'string' && args.id && !/\.jar$/i.test(args.id) && result?.ok !== false) {
    session.server = { id: args.id, name: String(args.name || (session.server?.id === args.id ? session.server.name : '') || args.id) };
    return;
  }
  if (session.server) return;
  const rows = serversOf(result);
  const named = namedServer(session, rows);
  if (named) session.server = named;
  else if (rows.length === 1) session.server = rows[0];
}

function recoverServer(session: Session): void {
  if (session.server?.id || session.hold?.server) return;
  let actionId = '';
  let actionName = '';
  for (const msg of session.wire) {
    if (msg.role === 'assistant') {
      for (const call of msg.tool_calls || []) {
        if (!serverTool(call.function?.name || '')) continue;
        try {
          const args = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>;
          if (typeof args.id === 'string' && args.id && !/\.jar$/i.test(args.id)) {
            actionId = args.id;
            actionName = String(args.name || actionName || args.id);
          }
        } catch {
          /* аргументы инструмента уже не разобрать */
        }
      }
    }
    if (msg.role !== 'tool' || !msg.content) continue;
    try {
      const parsed = JSON.parse(msg.content) as ToolRes;
      const root = parsed.result && typeof parsed.result === 'object' ? parsed.result as Record<string, unknown> : null;
      const id = String(root?.id || '');
      const srvName = String(root?.name || '');
      if (parsed.ok !== false && id && srvName && !/\.jar$/i.test(id) && (Array.isArray(root?.commands) || root?.syntax)) {
        actionId = id;
        actionName = srvName;
      }
      if (!actionId) rememberServer(session, parsed, {}, 'list_hosted_servers');
    } catch {
      /* старый ответ инструмента */
    }
  }
  if (actionId) session.server = { id: actionId, name: actionName || actionId };
}

function formFields(raw: unknown): FormField[] {
  if (!Array.isArray(raw)) return [];
  const fields: FormField[] = [];
  for (const item of raw.slice(0, 6)) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const label = String(row.label || '').trim().slice(0, 80);
    if (!label) continue;
    const type = row.type === 'select' || row.type === 'toggle' ? row.type : 'text';
    const id = String(row.id || `field${fields.length + 1}`).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || `field${fields.length + 1}`;
    const options = Array.isArray(row.options) ? row.options.map((option) => String(option).trim()).filter(Boolean).slice(0, 8) : [];
    if (type === 'select' && options.length < 2) continue;
    fields.push({
      id,
      label,
      type,
      options,
      placeholder: String(row.placeholder || '').slice(0, 80),
      required: row.required !== false,
    });
  }
  return fields;
}

function formCardHtml(form: LiveForm): string {
  const fields = form.fields.map((field) => {
    if (field.type === 'toggle') {
      return `<label class="is-toggle"><input type="checkbox" name="${esc(field.id)}"><span>${esc(field.label)}</span></label>`;
    }
    if (field.type === 'select') {
      const options = field.options.map((option, index) => `<label><input type="radio" name="${esc(field.id)}" value="${esc(option)}"${index === 0 ? ' checked' : ''}><span>${esc(option)}</span></label>`).join('');
      return `<fieldset><legend>${esc(field.label)}</legend>${options}</fieldset>`;
    }
    return `<label>${esc(field.label)}<input name="${esc(field.id)}" placeholder="${esc(field.placeholder)}"${field.required ? ' required' : ''}></label>`;
  }).join('');
  return `<form class="uag2-cardform" id="uag2-user-form"><b>${esc(form.title)}</b>${fields}<p class="uag2-cardform__error"></p><div class="uag2-cardform__actions"><button type="submit">${esc(form.submit)}</button><button type="button" data-form-skip>Пропустить</button></div></form>`;
}

function askForm(args: Record<string, unknown>, fields: FormField[]): Promise<Record<string, string> | null> {
  return new Promise((resolve) => {
    liveForm = {
      title: String(args.title || 'Нужно уточнение').slice(0, 140),
      submit: String(args.submitLabel || 'Отправить').slice(0, 32),
      fields,
      resolve,
    };
    fill();
    stickLog(true);
  });
}

function contextFull(session: Session): boolean {
  return Math.round(contextOf(session).usage * 100) >= 100;
}

function summarizeWire(wire: Wire[]): string {
  const lines: string[] = [];
  for (const msg of wire) {
    if (msg.role === 'user' && msg.content) lines.push(`Пользователь: ${String(msg.content).replace(/\s+/g, ' ').slice(0, 220)}`);
    else if (msg.role === 'assistant' && msg.content) lines.push(`Агент: ${String(msg.content).replace(/\s+/g, ' ').slice(0, 220)}`);
    else if (msg.tool_calls?.length) lines.push(`Действия: ${msg.tool_calls.map((call) => call.function?.name).filter(Boolean).join(', ')}`);
  }
  return lines.slice(-24).join('\n').slice(0, 3500);
}

function compactWire(session: Session): boolean {
  const wire = session.wire;
  if (wire.length < 6) return false;
  let cut = Math.max(1, wire.length - 8);
  while (cut > 0 && wire[cut]?.role !== 'user') cut -= 1;
  if (cut <= 0) return false;
  const summary = summarizeWire(wire.slice(0, cut));
  session.wire = [
    { role: 'user', content: `Сжатый контекст прошлого диалога:\n${summary}` },
    { role: 'assistant', content: 'Контекст принял. Продолжаю с этими фактами.' },
    ...wire.slice(cut),
  ];
  return true;
}

function shrinkToolPayloads(session: Session): void {
  const tools = session.wire.filter((msg) => msg.role === 'tool');
  tools.forEach((msg, index) => {
    const age = tools.length - 1 - index;
    if (age < 2 || !msg.content) return;
    const file = /"(body|matches|content|entries)"/.test(msg.content);
    const cap = file && age < 8 ? 4500 : 500;
    if (msg.content.length > cap) msg.content = `${msg.content.slice(0, cap)}…`;
  });
}

function fitContext(session: Session): void {
  for (let pass = 0; pass < 3 && contextFull(session); pass += 1) {
    const cut = compactWire(session);
    shrinkToolPayloads(session);
    if (cut && !compactAnnounced) {
      compactAnnounced = true;
      session.messages.push({ role: 'assistant', text: 'Контекст заполнен на 100%. Я сжал раннюю часть диалога и продолжаю.', steps: [] });
      if (!quietTurn) fill();
    }
    if (!cut) break;
  }
}

function halted(gen: number): boolean {
  return gen !== 0 && gen !== localTurn;
}

function stoppedReply(session: Session, steps: Step[], thought: string): string {
  const reply = 'Остановил.';
  session.wire.push({ role: 'assistant', content: reply });
  session.steps = steps;
  session.messages.push({ role: 'assistant', text: reply, steps: [], thought: thought || undefined });
  return reply;
}

let paintedLive = false;

function withoutToolTags(text: string): string {
  return text
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
    .replace(/<\s*\/?\s*tool_calls\b[\s\S]*$/i, '')
    .replace(/<\s*\/?\s*function_call\b[\s\S]*$/i, '')
    .replace(/<\s*\/?\s*invoke\b[\s\S]*$/i, '')
    .trim();
}

// Уже показанный стрим не заменяем другим ответом. Дописываем только продолжение.
function settleText(shown: string, finalText: string): string {
  const live = withoutToolTags(shown);
  const done = withoutToolTags(finalText);
  if (offTopic(live)) return offTopic(done) ? '' : done;
  if (!live) return done;
  if (!done || live.startsWith(done)) return live;
  if (done.startsWith(live)) return done;
  return live;
}

function settleReason(shown?: string, finalText?: string): string | undefined {
  const live = (shown || '').trim();
  const done = (finalText || '').trim();
  if (!live) return done || undefined;
  if (!done || live.length >= done.length) return live;
  return done;
}

function hasCyrillic(text: string): boolean {
  return /[А-Яа-яЁё]/.test(text);
}

function leadLineKind(line: string): 'blank' | 'answer' | 'thought' | 'other' {
  const value = line.trim();
  if (!value) return 'blank';
  if (hasCyrillic(value)) return 'answer';
  const latin = (value.match(/[A-Za-z]/g) || []).length;
  if (latin >= 8) return 'thought';
  return 'other';
}

// Английское начало — мысль. Ответ начинается с первой строки на языке пользователя.
function splitLeadEnglish(text: string): { reasoning: string; reply: string } {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let seenThought = false;
  let cut = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const kind = leadLineKind(lines[i]);
    if (kind === 'blank') continue;
    if (kind === 'thought') {
      seenThought = true;
      continue;
    }
    if (seenThought && kind === 'answer') {
      cut = i;
      break;
    }
    break;
  }
  const src = lines.join('\n').trim();
  if (cut < 0) return { reasoning: '', reply: src };
  return {
    reasoning: lines.slice(0, cut).join('\n').trim(),
    reply: lines.slice(cut).join('\n').trim(),
  };
}

function joinThought(left: string, right: string): string {
  const a = left.trim();
  const b = right.trim();
  if (!a) return b;
  if (!b || a.includes(b)) return a;
  if (b.includes(a)) return b;
  return `${a}\n\n${b}`;
}

function presentAnswer(reply: string, reasoning = ''): { text: string; reasoning: string } {
  let text = reply.trim();
  let thought = reasoning.trim();
  const lead = splitLeadEnglish(text);
  if (lead.reasoning && lead.reply && hasCyrillic(lead.reply)) {
    thought = joinThought(lead.reasoning, thought);
    text = lead.reply;
  }
  const shortTail = !text || (hasCyrillic(text) && thought.length > text.length * 2 && hasCyrillic(thought));
  if (shortTail && thought) {
    const fromThought = splitLeadEnglish(thought);
    if (fromThought.reasoning && fromThought.reply && hasCyrillic(fromThought.reply) && fromThought.reply.length > text.length) {
      text = fromThought.reply;
      thought = fromThought.reasoning;
    } else if (!text) {
      const at = thought.search(/[А-Яа-яЁё]/);
      if (at > 0) {
        const lineAt = thought.lastIndexOf('\n', at);
        text = thought.slice(lineAt + 1).trim();
        thought = thought.slice(0, Math.max(0, lineAt)).trim();
      }
    }
  }
  if (text && thought.includes(text) && text.length > 40) thought = thought.replace(text, '').replace(/\n{3,}/g, '\n\n').trim();
  const peeled = peelPlan(text);
  if (peeled.reasoning) {
    thought = joinThought(peeled.reasoning, thought);
    text = peeled.text;
  }
  return { text: text.trim(), reasoning: thought.trim() };
}

// Английский план между русскими абзацами не попадает в пузырь ответа.
function peelPlan(text: string): { text: string; reasoning: string } {
  const blocks = text.split(/\n{2,}/);
  const answer: string[] = [];
  const plan: string[] = [];
  for (const block of blocks) {
    const value = block.trim();
    if (!value) continue;
    const latin = (value.match(/[A-Za-z]/g) || []).length;
    if (!hasCyrillic(value) && latin >= 12) plan.push(value);
    else answer.push(value);
  }
  if (!answer.length || !plan.length) return { text, reasoning: '' };
  return { text: answer.join('\n\n'), reasoning: plan.join('\n\n') };
}

function takeAnswer(shown: string, reply: string, reasoning: string): { text: string; reasoning: string } {
  return presentAnswer(settleText(shown, reply), reasoning);
}

function actionLine(calls: ToolCall[]): string {
  const label = toolLabel(String(calls[0]?.function?.name || ''));
  if (!label) return 'Делаю следующий шаг.';
  return /[.!?…]$/.test(label) ? label : `${label}.`;
}

function inventedTask(userText: string, reply: string): boolean {
  const ask = userText.toLowerCase();
  const answer = reply.toLowerCase();
  return ['main.py', 'handlers.py', 'config.py', 'python', 'telegram-бот', 'телеграм-бот'].some((mark) => answer.includes(mark) && !ask.includes(mark));
}

// Flash иногда представляется чужой моделью вместо выполнения просьбы.
function offTopic(reply: string, userText = ''): boolean {
  const answer = reply.toLowerCase();
  const ask = userText.toLowerCase();
  const marks = ['deepseek', 'gigachat', 'qwen', 'minimax', 'режим рассуждений', 'активировал модель', 'отличный выбор'];
  return marks.some((mark) => answer.includes(mark) && !ask.includes(mark));
}

function missesTask(userText: string, reply: string): boolean {
  const ask = userText.toLowerCase();
  const server = /сервер/.test(ask) && /включ|запуст|останови|погаси|рестарт/.test(ask);
  return inventedTask(userText, reply) || offTopic(reply, userText) || (server && reply.trim().length > 0);
}

function plainTool(name: string): boolean {
  if (!name || name === 'ask_user_form' || needsConfirm(name)) return false;
  if (name === 'launch_build' || name === 'create_build') return false;
  if (/^(edit_|write_|move_|copy_|mkdir_)/.test(name)) return false;
  return true;
}

function watchStream(session: Session, gen: number, thought: string, userText = ''): () => Msg | null {
  let draft: Msg | null = null;
  let frame = 0;
  let pending: { text: string; reasoning: string } | null = null;
  const paint = () => {
    frame = 0;
    const packet = pending;
    pending = null;
    if (!packet) return;
    const shown = presentAnswer(packet.text, packet.reasoning);
    if (offTopic(shown.text, userText)) shown.text = '';
    if (!draft) {
      draft = {
        role: 'assistant',
        text: shown.text,
        reasoning: shown.reasoning || undefined,
        steps: [],
        thought: thought || undefined,
        live: true,
      };
      session.messages.push(draft);
      if (draft.text) paintedLive = true;
      fill();
      return;
    }
    const switched = Boolean(shown.text && draft.text && !shown.text.startsWith(draft.text) && hasCyrillic(shown.text) && !hasCyrillic(draft.text));
    if (shown.text && (!draft.text || shown.text.startsWith(draft.text) || shown.text.length >= draft.text.length || switched)) draft.text = shown.text;
    else if (!shown.text && draft.text && !hasCyrillic(draft.text)) draft.text = '';
    if (shown.reasoning) draft.reasoning = shown.reasoning;
    const md = document.getElementById('uag2-live-md');
    if (md && draft.text) md.innerHTML = renderMd(draft.text);
    if (draft.text) paintedLive = true;
    const reason = document.getElementById('uag2-live-reason');
    if (reason) {
      const full = (draft.reasoning || '').trim();
      reason.hidden = !full;
      reason.dataset.reason = full;
      const body = document.getElementById('uag2-live-reason-body');
      if (body && reason.getAttribute('aria-expanded') === 'true') body.textContent = full;
    }
    stickLog();
  };
  const off = api?.onAiDelta?.((packet) => {
    if (packet.turn && String(gen) !== packet.turn) return;
    pending = { text: String(packet.text || ''), reasoning: String(packet.reasoning || '') };
    if (!frame) frame = requestAnimationFrame(paint);
  });
  return () => {
    off?.();
    if (frame) cancelAnimationFrame(frame);
    if (pending) paint();
    return draft;
  };
}

async function runPlainCalls(
  session: Session,
  calls: ToolCall[],
  steps: Step[],
  seen: Map<string, string>,
  repeats: Map<string, number>,
  gen: number,
): Promise<number> {
  let stalls = 0;
  const jobs = calls.map(async (call) => {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(call.function?.arguments || '{}');
    } catch {
      args = {};
    }
    const name = String(call.function?.name || '');
    const repeatKey = `${name}:${call.function?.arguments || ''}`;
    const prior = seen.get(repeatKey);
    if (prior && name !== 'ask_user_form') {
      const times = (repeats.get(repeatKey) || 1) + 1;
      repeats.set(repeatKey, times);
      return {
        id: call.id,
        repeatKey,
        payload: JSON.stringify({
          repeated: true,
          note: 'Такой вызов в этом ходе уже был. Возьми прошлый результат и сделай следующий шаг.',
          previous: prior,
        }).slice(0, 6000),
        step: { name, ok: true, detail: toolLabel(name) } as Step,
        stall: times >= 3,
      };
    }
    pinServerArgs(session, name, args);
    pinBuildArgs(session, name, args);
    if (call.function) call.function.arguments = JSON.stringify(args);
    const result = await api?.aiToolsRun?.(name, args, { confirmed: true });
    const reason = failureOf(result);
    const ok = !reason;
    const payload = toolPayload(result, name);
    return {
      id: call.id,
      name,
      args,
      result,
      repeatKey,
      payload,
        step: doneStep(name, ok, ok ? '' : reason, args, result),
      stall: false,
    };
  });
  steps.push(...calls.map((call) => {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(call.function?.arguments || '{}');
    } catch {
      args = {};
    }
    return doneStep(String(call.function?.name || ''), true, '', args);
  }));
  showSteps(steps);
  const done = await Promise.all(jobs);
  if (halted(gen)) return stalls;
  steps.splice(steps.length - calls.length, calls.length);
  for (const row of done) {
    if (row.stall) stalls += 1;
    steps.push(row.step);
    if (row.result) {
      rememberServer(session, row.result, row.args || {}, row.name || '');
      rememberBuild(session, row.result, row.args || {}, row.name || '');
      if (row.name === 'list_builds') rememberListedBuilds(session, row.result);
    }
    seen.set(row.repeatKey, row.payload);
    session.wire.push({ role: 'tool', tool_call_id: row.id, content: row.payload });
  }
  showSteps(steps);
  return stalls;
}

async function runTurn(session: Session, text: string, serverRequest: boolean, gen: number, images?: { mime: string; data: string }[]): Promise<string> {
  const thought = '';
  session.wire.push({ role: 'user', content: text, images });
  fitContext(session);
  const steps: Step[] = [];
  const seen = new Map<string, string>();
  const repeats = new Map<string, number>();
  let stalls = 0;
  let modelReasoning = '';
  let sealed = 0;
  let carried: Msg | null = null;
  let nudges = 0;
  // Действия круга вешаем на его реплику, а не на все сообщения хода сразу.
  const seal = (): void => {
    if (sealed >= steps.length) {
      carried = null;
      return;
    }
    const slice = steps.slice(sealed).map((step) => ({ ...step }));
    sealed = steps.length;
    if (carried) carried.steps = slice;
    else session.messages.push({ role: 'assistant', text: '', steps: slice });
    carried = null;
    fill();
  };
  const halt = (): string => {
    seal();
    session.messages.forEach((msg) => {
      if (msg.live) msg.live = false;
    });
    const last = session.messages[session.messages.length - 1];
    if (last?.role === 'assistant' && !last.text.trim() && !last.steps.length) session.messages.pop();
    return stoppedReply(session, steps, thought);
  };
  const rounds = 20;
  for (let round = 0; round < rounds; round += 1) {
    seal();
    if (halted(gen)) return halt();
    fitContext(session);
    shrinkToolPayloads(session);
    const stopWatch = watchStream(session, gen, thought, text);
    const res = await api?.aiChat?.({ messages: session.wire, tools: true, model: modelFor(session), turn: gen ? String(gen) : undefined });
    const draft = stopWatch();
    if (halted(gen) || res?.stopped) return halt();
    if (!res || res.error) {
      seal();
      const message = res?.error || 'Агент не ответил';
      if (draft) {
        draft.live = false;
        if (!draft.text) draft.text = message;
      } else session.messages.push({ role: 'assistant', text: message, steps: [], thought: thought || undefined });
      return message;
    }
    const calls = Array.isArray(res.toolCalls) ? res.toolCalls : [];
    if (res.reasoning) modelReasoning = String(res.reasoning);
    if (!calls.length) {
      const raw = String(res.reply || '');
      const shown = takeAnswer(draft?.text || '', raw, String(res.reasoning || modelReasoning || draft?.reasoning || ''));
      let reply = shown.text;
      const dump = offTopic(raw, text) || offTopic(reply, text);
      const judged = reply || raw;
      if (steps.length === 0 && modelFor(session) === 'pixi-2.1-flash' && missesTask(text, judged) && nudges < (dump ? 2 : 1)) {
        nudges += 1;
        if (draft) {
          const at = session.messages.indexOf(draft);
          if (at >= 0) session.messages.splice(at, 1);
        }
        session.wire.push({ role: 'assistant', content: 'Понял, делаю запрошенное.' });
        session.wire.push({
          role: 'user',
          content: 'Это не ответ на последнюю просьбу. Выполни именно её инструментами клиента. Не представляйся и не описывай модель. Не пиши про Python и чужие проекты. Включение своего сервера — start_hosted_server, плагин — lookup_plugin.',
        });
        fill();
        continue;
      }
      if (dump) {
        const fallback = 'Не взялся за задачу. Повтори запрос ещё раз.';
        session.wire.push({ role: 'assistant', content: fallback });
        if (draft) {
          draft.live = false;
          draft.text = fallback;
          draft.steps = [];
        } else session.messages.push({ role: 'assistant', text: fallback, steps: [] });
        fill();
        return fallback;
      }
      if (reply) {
        session.wire.push({ role: 'assistant', content: reply });
        session.steps = steps;
        if (draft) {
          draft.live = false;
          draft.text = reply;
          draft.steps = [];
          draft.thought = thought || undefined;
          draft.reasoning = shown.reasoning || undefined;
        } else {
          session.messages.push({ role: 'assistant', text: reply, steps: [], thought: thought || undefined, reasoning: shown.reasoning || undefined });
        }
        fill();
        return reply;
      }
      if (draft && !draft.text) session.messages.splice(session.messages.indexOf(draft), 1);
      break;
    }
    if (draft) {
      const shown = takeAnswer(draft.text, String(res.reply || ''), String(res.reasoning || modelReasoning || draft.reasoning || ''));
      draft.live = false;
      draft.text = shown.text.trim() && !inventedTask(text, shown.text) ? shown.text : actionLine(calls);
      draft.reasoning = shown.reasoning || undefined;
      draft.steps = [];
      carried = draft;
    } else {
      const lead: Msg = { role: 'assistant', text: actionLine(calls), steps: [] };
      session.messages.push(lead);
      carried = lead;
    }
    session.wire.push({ role: 'assistant', content: draft?.text || res.reply || null, tool_calls: calls });
    if (calls.length > 1 && calls.every((call) => plainTool(String(call.function?.name || '')))) {
      stalls += await runPlainCalls(session, calls, steps, seen, repeats, gen);
      if (halted(gen)) return halt();
      if (stalls >= 2) break;
      continue;
    }
    for (const call of calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function?.arguments || '{}');
      } catch {
        args = {};
      }
      if (halted(gen)) {
        session.wire.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: false, error: 'остановлено' }) });
        continue;
      }
      const name = String(call.function?.name || '');
      const repeatKey = `${name}:${call.function?.arguments || ''}`;
      const prior = seen.get(repeatKey);
      if (prior && name !== 'ask_user_form') {
        const times = (repeats.get(repeatKey) || 1) + 1;
        repeats.set(repeatKey, times);
        let previous: unknown = prior;
        try {
          previous = JSON.parse(prior);
        } catch {
          previous = prior;
        }
        session.wire.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({
            repeated: true,
            note: times >= 3
              ? 'Этот вызов уже повторялся. Ответь по полученным данным или смени инструмент.'
              : 'Такой вызов в этом ходе уже был. Возьми прошлый результат и сделай следующий шаг.',
            previous,
          }).slice(0, 6000),
        });
        steps.push({ name, ok: true, detail: toolLabel(name) });
        showSteps(steps);
        if (times >= 3) stalls += 1;
        continue;
      }
      if (serverRequest && (name === 'launch_build' || name === 'create_build')) {
        const known = session.server ? ` Сервер разговора: «${session.server.name}», id=${session.server.id}.` : '';
        session.wire.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({ ok: false, error: `Просят свой сервер, не игру и не сборку.${known} Вызови start_hosted_server.` }),
        });
        steps.push({ name, ok: false, detail: 'Это сервер, не сборка' });
        showSteps(steps);
        continue;
      }
      pinServerArgs(session, name, args);
      pinBuildArgs(session, name, args);
      if (name === 'ask_user_form' && session.server && serverChoiceForm(args)) {
        const known = session.server;
        session.wire.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({
            ok: true,
            answers: { id: known.id, server: known.name },
            note: `Сервер разговора уже выбран: «${known.name}», id=${known.id}. Форму не показывай, продолжай с этим id.`,
          }),
        });
        steps.push({ name, ok: true, detail: 'Сервер уже выбран' });
        showSteps(steps);
        continue;
      }
      if (name === 'ask_user_form' && quietTurn) {
        session.wire.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({ ok: false, error: 'Это Telegram. Форму лаунчера не открывай. Спроси то же обычным текстом ответа.' }),
        });
        steps.push({ name, ok: true, detail: 'Спрошу текстом' });
        continue;
      }
      if (name === 'ask_user_form') {
        const fields = formFields(args.fields);
        if (!fields.length) {
          session.wire.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: false, error: 'Нужны fields с id, label и type text, select или toggle.' }) });
          steps.push({ name, ok: false, detail: 'Форма без полей' });
          showSteps(steps);
          continue;
        }
        steps.push({ name, ok: true, detail: 'Жду ответ в форме' });
        showSteps(steps);
        const answers = await askForm(args, fields);
        if (halted(gen)) {
          session.wire.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: false, error: 'остановлено' }) });
          continue;
        }
        const ok = Boolean(answers);
        steps[steps.length - 1] = { name, ok, detail: ok ? 'Уточнил в форме' : 'Форма пропущена' };
        session.wire.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(ok ? { ok: true, answers } : { ok: false, error: 'Пользователь пропустил форму' }),
        });
        fill();
        continue;
      }
      if (needsConfirm(name)) {
        const ok = quietTurn && remoteConfirm ? await remoteConfirm(toolLabel(name)) : await confirmDanger(name);
        if (halted(gen)) {
          session.wire.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: false, error: 'остановлено' }) });
          continue;
        }
        if (!ok) {
          session.wire.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: false, error: 'user_declined' }) });
          steps.push({ name, ok: false, detail: 'Отменено' });
          showSteps(steps);
          continue;
        }
      }
      steps.push(doneStep(name, true, '', args));
      showSteps(steps);
      if (call.function) call.function.arguments = JSON.stringify(args);
      const result = await api?.aiToolsRun?.(name, args, { confirmed: true });
      if (halted(gen)) {
        session.wire.push({ role: 'tool', tool_call_id: call.id, content: toolPayload(result, name) });
        return halt();
      }
      const reason = failureOf(result);
      const ok = !reason;
      steps[steps.length - 1] = doneStep(name, ok, ok ? '' : reason, args, result);
      showSteps(steps);
      rememberServer(session, result, args, name);
      rememberBuild(session, result, args, name);
      if (name === 'list_builds') rememberListedBuilds(session, result);
      const payload = toolPayload(result, name);
      seen.set(repeatKey, payload);
      session.wire.push({
        role: 'tool',
        tool_call_id: call.id,
        content: payload,
      });
    }
    if (halted(gen)) return halt();
    if (stalls >= 2) break;
  }
  if (halted(gen)) return halt();
  seal();
  return closeTurn(session, steps, thought, modelReasoning);
}

async function closeTurn(session: Session, steps: Step[], thought: string, modelReasoning = ''): Promise<string> {
  const stopWatch = watchStream(session, 0, thought);
  const res = await api?.aiChat?.({
    model: modelFor(session),
    tools: false,
    messages: [
      ...session.wire,
      {
        role: 'user',
        content: 'Напиши ответ пользователю по уже полученным результатам: что сделано и что помешало, если задача не закрыта. По-русски, обычными абзацами. Не перечисляй инструменты и не вставляй сырой текст ошибок. Новые инструменты не вызывай и не выдумывай действий, которых не было.',
      },
    ],
  }).catch(() => null);
  const draft = stopWatch();
  const written = res && !res.error ? String(res.reply || '').trim() : '';
  const reasoning = (res && res.reasoning ? String(res.reasoning) : '') || modelReasoning;
  const done = steps.filter((step) => step.ok).map((step) => step.detail);
  const failed = steps.filter((step) => !step.ok);
  const failText = failed.length ? failed[failed.length - 1].error || failed[failed.length - 1].detail : '';
  const fallback = failed.length
    ? `Не довел до конца. ${done.length ? `Сделано: ${done.join(', ')}. ` : ''}${failText ? `Ошибка: ${failText}.` : ''}`
    : done.length
      ? `Сделано: ${done.join(', ')}.`
      : 'Не получилось ответить.';
  const shown = takeAnswer(draft?.text || '', written, reasoning || draft?.reasoning || '');
  const kept = shown.text || fallback;
  if (draft) {
    draft.live = false;
    draft.text = kept;
    draft.steps = [];
    draft.thought = thought || undefined;
    draft.reasoning = shown.reasoning || undefined;
  } else {
    session.messages.push({ role: 'assistant', text: kept, steps: [], thought: thought || undefined, reasoning: shown.reasoning || undefined });
  }
  session.wire.push({ role: 'assistant', content: kept });
  session.steps = steps;
  fill();
  return kept;
}

function failureOf(result: ToolRes | undefined): string {
  if (!result) return 'нет ответа';
  if (result.ok === false) return String(result.error || 'ошибка');
  const inner = result.result;
  if (inner && typeof inner === 'object') {
    const rec = inner as { ok?: boolean; success?: boolean; error?: unknown; build?: unknown; mods?: unknown; versions?: unknown };
    if (rec.ok === false || rec.success === false) return String(rec.error || 'ошибка');
    const err = typeof rec.error === 'string' ? rec.error.trim() : '';
    if (err && rec.ok !== true && rec.success !== true && !rec.build && !rec.mods && !rec.versions) return err;
  }
  return '';
}

function telegramSession(): Session {
  let session = sessions.find((row) => row.channel === 'telegram');
  if (!session) {
    session = blank('Telegram');
    session.channel = 'telegram';
    sessions.unshift(session);
    save();
  }
  return session;
}

export async function askUAgent(text: string, opts?: { remote?: boolean }): Promise<string> {
  if (!sessions.length) load();
  const remote = Boolean(opts?.remote);
  const prompt = text.trim();
  const file = remote ? null : pendingFile;
  const shots = remote ? [] : pendingShots.slice();
  if ((!prompt && !file && !shots.length) || busy || remoteBusy) return 'Агент сейчас занят.';
  if (!remote) {
    pendingFile = null;
    pendingShots = [];
  }
  const session = remote ? telegramSession() : current();
  if (!remote && session.title === 'Новый агент' && prompt) session.title = prompt.slice(0, 32);
  const shown = [prompt, file ? `Файл: ${file.name}` : ''].filter(Boolean).join('\n\n');
  if (!session.server) recoverServer(session);
  recoverBuild(session);
  const serverRequest = aboutServer(prompt);
  const known = session.server;
  const build = session.build;
  const memory = [
    build
      ? `[Контекст] Сборка этого разговора: «${build.name}», id=${build.id}${build.meta ? `, ${build.meta}` : ''}. Инструменты сборки вызывай с этим buildId. Другую сборку бери, только если пользователь её назвал.`
      : '',
    known
      ? `[Контекст] Сервер этого разговора: «${known.name}», id=${known.id}. Команды, плагины и файлы сервера — на него, id передавай этот. Форму выбора сервера не открывай. Другой сервер только если пользователь назвал его. Имя сервера бери из ответа инструмента, файл .jar — плагин.`
      : '',
    session.mod
      ? `[Контекст] Мод этого разговора: «${session.mod.name}», id=${session.mod.id}${session.mod.meta ? `, ${session.mod.meta}` : ''}. Установку и проверку делай для него. Другой мод бери, только если пользователь его назвал.`
      : '',
    serverRequest && !known
      ? '[Контекст] Речь о своём сервере, не об игре. Сначала list_hosted_servers, потом start_hosted_server. launch_build не вызывай.'
      : '',
    serverRequest && known ? 'launch_build не вызывай: это свой сервер, не игра.' : '',
    `[Имя] Сейчас ты ${pixiModelRow().family} ${pixiModelRow().tier}. Если спросят, кто ты или какая модель, ответь только этим именем. Не называй другую версию, даже если она есть в истории.`,
    '[Стиль] Пиши пользователю по-русски, короткими абзацами. Не перечисляй инструменты и не вставляй сырой текст ошибок: действия уже видны отдельным списком.',
    '[Файлы] Конфиг плагина уже лежит на сервере. Найди его find_hosted_files, grep_hosted_files или scan_configs, прочитай read_hosted_file и замени строки через edit_hosted_file. old — дословный кусок без номера строки. write_hosted_file создаёт только новый файл и не меняет существующий. После правки конфига плагина выполни его команду перезагрузки, иначе в игре останется старый текст.',
    '[Поиск] Документацию и факты вне лаунчера бери web_search, затем fetch_url: url из results и query со словами, которые ищешь. Если ответ обрезан и есть nextOffset, вызови fetch_url с тем же url и этим offset. Не останавливайся на начале страницы.',
    shots.length && modelSeesImages() ? '[Изображение] К сообщению приложено изображение. Смотри его и отвечай по нему. Не пиши, что скриншот не передался.' : '',
  ].filter(Boolean).join('\n');
  const wireText = [prompt || (shots.length ? 'Посмотри на изображение и ответь по нему.' : ''), file ? `Файл ${file.name}:\n${file.text}` : '', memory].filter(Boolean).join('\n\n');
  session.messages.push({
    role: 'user',
    text: shown,
    images: shots.map((shot) => ({ name: shot.name, url: shot.url })),
    steps: [],
  });
  session.updated = Date.now();
  compactAnnounced = false;
  if (remote) remoteBusy = true;
  else busy = true;
  quietTurn = remote;
  const gen = remote ? 0 : (localTurn += 1);
  if (!remote) {
    stopSpeech();
    fill();
  }
  try {
    const reply = await runTurn(session, wireText, serverRequest, gen, shots.map((shot) => ({ mime: shot.mime, data: shot.data })));
    if (!remote && !paintedLive) streamOnce = true;
    paintedLive = false;
    save();
    return reply;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Ошибка агента';
    session.messages.push({ role: 'assistant', text: message, steps: [] });
    return message;
  } finally {
    quietTurn = false;
    if (remote) remoteBusy = false;
    else busy = false;
    save();
    if (!remote) fill();
  }
}

function paintGate(): void {
  const gate = document.getElementById('uag2-gate');
  const apply = document.getElementById('uag2-gate-apply') as HTMLButtonElement | null;
  const status = document.getElementById('uag2-gate-status');
  const track = document.getElementById('uag2-gate-track');
  if (!gate) return;
  const closed = gateStatus !== 'open';
  gate.hidden = !closed;
  document.querySelector('.uag2')?.classList.toggle('is-gated', closed);
  if (apply) apply.disabled = gateStatus === 'pending';
  if (!status) return;
  if (gateStatus === 'pending') {
    status.hidden = false;
    status.textContent = 'Ваша заявка отправлена, ожидайте решения по заявке';
  } else if (gateStatus === 'rejected') {
    status.hidden = false;
    status.textContent = 'Ваша заявка отклонена, вы можете подать заявку повторно';
  } else {
    status.hidden = true;
    status.textContent = '';
  }
  if (gateStatus !== 'open') track?.classList.remove('is-form');
  if (gateStatus === 'pending') setGateMood('heureux', 'idle');
  else if (gateStatus === 'rejected') setGateMood('triste', 'idle');
  else if (gateStatus === 'none') setGateMood('attentif', 'idle');
}

const GATE_MOODS = ['attentif', 'curieux', 'heureux', 'surpris', 'fier'];
let gateMoodStep = 0;
let gateMoodTimer = 0;

function setGateMood(expr: string, mode: string): void {
  document.querySelectorAll<HTMLElement>('.uag2-gate__face').forEach((el) => {
    el.dataset.color = 'accent';
    el.dataset.follow = '1';
    el.dataset.expr = expr;
    el.dataset.mode = mode;
  });
}

function celebrateGate(): void {
  setGateMood('heureux', 'notify');
  window.setTimeout(() => {
    if (gateStatus === 'pending') setGateMood('heureux', 'idle');
  }, 2200);
}

type AccessStatus = {
  access?: boolean;
  models?: string[];
  reason?: string;
  error?: string;
  application?: { status?: string };
};

// Нет токена и обрыв сети — это не отказ в доступе. Заявку показываем только
// когда сервер узнал аккаунт и явно не выдал агента.
function applyAccessStatus(status: AccessStatus | null): void {
  if (!status || status.error) return;
  const reason = String(status.reason || '');
  if (reason === 'missing_auth' || reason === 'auth_unavailable') return;
  if (status.access) {
    gateStatus = 'open';
    const models = Array.isArray(status.models) && status.models.length ? status.models : ['pixi-2.0-lite'];
    unlockedModels = new Set(models.map(String));
    unlockedModels.add('pixi-2.0-lite');
    accessReady = true;
  } else if (reason === 'access_denied' || status.application) {
    const app = String(status.application?.status || 'none');
    gateStatus = app === 'pending' ? 'pending' : app === 'rejected' ? 'rejected' : 'none';
    unlockedModels = new Set(['pixi-2.0-lite']);
    accessReady = true;
  } else {
    return;
  }
  paintGate();
  syncModelButton();
  const host = document.getElementById('uagent-root');
  if (host) syncAgentFaces(host);
}

async function refreshGate(preset?: AccessStatus | null): Promise<void> {
  const epoch = ++gateEpoch;
  const status = preset !== undefined ? preset : await api?.aiStatus?.().catch(() => null);
  if (epoch !== gateEpoch) return;
  applyAccessStatus(status ?? null);
}

function bindGate(): void {
  document.getElementById('uag2-gate-terms')?.addEventListener('click', () => {
    void api?.openExternal?.('https://uprojects.site/client/legal/terms');
  });
  document.getElementById('uag2-gate-apply')?.addEventListener('click', () => {
    if (gateStatus === 'pending') return;
    document.getElementById('uag2-gate-track')?.classList.add('is-form');
    setGateMood('curieux', 'idle');
    window.setTimeout(() => document.getElementById('uag2-gate-text')?.focus(), 280);
  });
  document.getElementById('uag2-gate-back')?.addEventListener('click', () => {
    document.getElementById('uag2-gate-track')?.classList.remove('is-form');
    setGateMood('attentif', 'idle');
  });
  document.getElementById('uag2-gate-submit')?.addEventListener('click', () => {
    const field = document.getElementById('uag2-gate-text') as HTMLTextAreaElement | null;
    const reason = field?.value.trim() || '';
    if (reason.length < 4) {
      field?.focus();
      setGateMood('confus', 'idle');
      return;
    }
    setGateMood('excite', 'idle');
    void api?.aiApply?.(reason).then((result) => {
      if (result?.ok || result?.reason === 'already_pending') {
        gateStatus = 'pending';
        if (field) field.value = '';
        paintGate();
        celebrateGate();
        return;
      }
      setGateMood('triste', 'idle');
    });
  });
  window.clearInterval(gateMoodTimer);
  gateMoodTimer = window.setInterval(() => {
    const gate = document.getElementById('uag2-gate');
    if (!gate || gate.hidden || gateStatus !== 'none') return;
    if (document.getElementById('uag2-gate-track')?.classList.contains('is-form')) return;
    gateMoodStep = (gateMoodStep + 1) % GATE_MOODS.length;
    setGateMood(GATE_MOODS[gateMoodStep], 'idle');
  }, 3200);
}

export function mountUAgent(): void {
  const root = document.getElementById('uagent-root');
  if (!root || shellReady) return;
  shellReady = true;
  load();
  root.innerHTML = shellHtml();
  bind(root);
  bindGate();
  window.addEventListener('uagent-access', (event) => {
    const detail = (event as CustomEvent<AccessStatus | null | undefined>).detail;
    void refreshGate(detail == null ? undefined : detail);
  });
  syncModelButton();
  fill();
  void refreshGate();
}
