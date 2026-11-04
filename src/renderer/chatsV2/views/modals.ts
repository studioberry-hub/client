// Модальные окна чатов v2: серверы, группы, приглашения, настройки сервера, каналы, пересылка, звук, быстрый переход.
import { IC, channelMark } from '../icons';
import {
  S,
  allTextChannels,
  canManage,
  errText,
  groups,
  invalidate,
  isOnline,
  isRoomOwner,
  loadDetail,
  loadLists,
  loadMembers,
  roomById,
  servers,
  unwrap,
  userOf,
} from '../store';
import { DEV, listDevices, setInputDevice, setOutputDevice } from '../rtc';
import { MODAL_CLOSE_SVG, confirmDialog, openModal, toast } from '../overlays';
import { openBannerCrop, type BannerCrop } from '../bannerCrop';
import { assetUrl, avatarHtml, copyText, debounce, esc, fmtDate, plural, sameId, syncRange } from '../util';
import { groupIcon } from './sidebar';
import {
  BITRATE_OPTIONS,
  SLOWMODE_OPTIONS,
  TEXT_CHANNEL_PERMS,
  VOICE_CHANNEL_PERMS,
  overwriteState,
  setOverwriteState,
} from '../channelPerms';
import type { ChannelOverwrite, Message, Role, TextChannel, VoiceChannel } from '../types';

// ===== Связь с навигацией =====

export type ModalHooks = {
  openDm: (peerId: number) => void;
  openGroup: (roomId: number) => void;
  openServer: (roomId: number, channelId?: number) => void;
  forward: (target: { kind: 'dm'; peerId: number } | { kind: 'channel'; roomId: number; channelId: number }, msg: Message) => Promise<boolean>;
};

let H: ModalHooks = {
  openDm: () => undefined,
  openGroup: () => undefined,
  openServer: () => undefined,
  forward: async () => false,
};

export function setModalHooks(h: ModalHooks): void {
  H = h;
}

const SELECT_CHEVRON = `<svg class="stngs-select-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 4L6 8L10 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

type SelectOpt = { value: string; label: string };

let selectPortal: { wrap: HTMLElement; menu: HTMLElement } | null = null;

function closeLauncherSelect(): void {
  const cur = selectPortal;
  if (!cur) return;
  selectPortal = null;
  cur.wrap.classList.remove('open');
  cur.menu.classList.remove('open', 'is-portal', 'closing');
  cur.menu.removeAttribute('style');
  if (cur.menu.parentElement !== cur.wrap) cur.wrap.appendChild(cur.menu);
}

let selectDocBound = false;
function ensureSelectDoc(): void {
  if (selectDocBound) return;
  selectDocBound = true;
  document.addEventListener(
    'mousedown',
    (e) => {
      if (!selectPortal) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('.stngs-select-menu, .stngs-select-btn')) return;
      closeLauncherSelect();
    },
    true,
  );
}

/** Тот же выпадающий список, что у версии загрузчика: кнопка и меню порталом, не системный select. */
function launcherSelect(attr: string, options: SelectOpt[], current: string): string {
  const value = options.some((o) => o.value === current) ? current : (options[0]?.value ?? '');
  const label = options.find((o) => o.value === value)?.label || '';
  return `<div class="stngs-select-wrap be-select-wrap versions-select-wrap">
    <select class="stngs-select-hidden" ${attr}>${options
      .map((o) => `<option value="${esc(o.value)}"${o.value === value ? ' selected' : ''}>${esc(o.label)}</option>`)
      .join('')}</select>
    <button type="button" class="stngs-select-btn">
      <span class="stngs-select-value">${esc(label)}</span>
      ${SELECT_CHEVRON}
    </button>
    <div class="stngs-select-menu select-scroll-menu">${options
      .map((o) => `<div class="stngs-select-opt${o.value === value ? ' selected' : ''}" data-value="${esc(o.value)}">${esc(o.label)}</div>`)
      .join('')}</div>
  </div>`;
}

function bindLauncherSelects(root: HTMLElement): void {
  ensureSelectDoc();
  closeLauncherSelect();
  root.querySelectorAll<HTMLElement>('.stngs-select-wrap').forEach((wrap) => {
    const btn = wrap.querySelector<HTMLButtonElement>('.stngs-select-btn');
    const menu = wrap.querySelector<HTMLElement>('.stngs-select-menu');
    const select = wrap.querySelector<HTMLSelectElement>('select');
    const valueEl = wrap.querySelector<HTMLElement>('.stngs-select-value');
    if (!btn || !menu || !select || !valueEl) return;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (selectPortal?.wrap === wrap) {
        closeLauncherSelect();
        return;
      }
      closeLauncherSelect();
      const rect = btn.getBoundingClientRect();
      const width = rect.width;
      let left = rect.left;
      if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
      document.body.appendChild(menu);
      menu.classList.add('is-portal');
      menu.style.position = 'fixed';
      menu.style.left = `${Math.max(8, left)}px`;
      menu.style.top = `${rect.bottom + 6}px`;
      menu.style.width = `${width}px`;
      menu.style.minWidth = `${width}px`;
      menu.style.zIndex = '20000';
      wrap.classList.add('open');
      void menu.offsetWidth;
      menu.classList.add('open');
      selectPortal = { wrap, menu };
    });
    menu.addEventListener('click', (e) => {
      const opt = (e.target as HTMLElement).closest<HTMLElement>('.stngs-select-opt');
      if (!opt || opt.dataset.value === undefined) return;
      select.value = opt.dataset.value;
      valueEl.textContent = (opt.textContent || '').trim();
      menu.querySelectorAll('.stngs-select-opt').forEach((n) => n.classList.toggle('selected', n === opt));
      select.dispatchEvent(new Event('change'));
      closeLauncherSelect();
    });
  });
}

async function fileBytes(f: File): Promise<Uint8Array> {
  return new Uint8Array(await f.arrayBuffer());
}

function friendPickRow(id: number, checked: boolean, disabled = false): string {
  const u = userOf(id);
  return `<label class="cv2-pick ${disabled ? 'is-disabled' : ''}" data-name="${esc(u.username.toLowerCase())}">
    ${avatarHtml(u.username, u.avatar_url, u.avatar_color, { size: 32, status: isOnline(id) ? 'online' : 'offline', ring: 'var(--bg-base)' })}
    <span class="cv2-pick__name">${esc(u.username)}</span>
    <input type="checkbox" value="${id}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
    <span class="cv2-check">${IC.check(12)}</span>
  </label>`;
}

// ===== Создание сервера / вход по приглашению =====

export function createServerModal(): void {
  let avatar: File | null = null;
  const close = openModal({
    cls: 'is-create-server',
    width: 460,
    title: 'Создайте свой сервер',
    sub: 'Сервер — место, где вы с друзьями общаетесь в каналах и голосе. Название можно изменить позже.',
    body: `<div class="cv2-cs">
      <label class="cv2-cs__upload" data-upload>
        <input type="file" accept="image/*" hidden data-file>
        <span class="cv2-cs__upload-in">${IC.image(24)}<span>Загрузить</span></span>
      </label>
      <label class="cv2-field"><span class="cv2-field__label">Название сервера</span>
        <input class="cv2-input" data-name maxlength="60" value="${esc(`Сервер ${S.me.username || ''}`.trim())}" autofocus></label>
      <label class="cv2-field"><span class="cv2-field__label">Описание <i>(необязательно)</i></span>
        <input class="cv2-input" data-desc maxlength="200" placeholder="О чём этот сервер?"></label>
      <div class="cv2-cs__join">Уже есть приглашение? <a data-join>Присоединиться к серверу</a></div>
    </div>`,
    actions: [
      { label: 'Отмена', kind: 'ghost' },
      {
        label: 'Создать',
        kind: 'primary',
        onClick: async (box) => {
          const name = (box.querySelector('[data-name]') as HTMLInputElement).value.trim();
          const desc = (box.querySelector('[data-desc]') as HTMLInputElement).value.trim();
          if (!name) {
            toast('Введите название сервера', 'error');
            return false;
          }
          try {
            const d = unwrap<any>(await S.api.cloudCreateRoom?.(name, [], desc));
            const id = Number(d?.room?.id ?? d?.id);
            if (id && avatar) {
              try {
                await S.api.cloudUploadRoomAvatar?.(id, await fileBytes(avatar), avatar.name);
              } catch {
                toast('Сервер создан, но значок не загрузился', 'error');
              }
            }
            await loadLists();
            invalidate('rail');
            if (id) H.openServer(id);
            toast('Сервер создан', 'success');
          } catch (e) {
            toast(errText(e), 'error');
            return false;
          }
        },
      },
    ],
    onMount: (box) => {
      const input = box.querySelector('[data-file]') as HTMLInputElement;
      const up = box.querySelector('[data-upload]') as HTMLElement;
      input.addEventListener('change', () => {
        avatar = input.files?.[0] || null;
        if (!avatar) return;
        const url = URL.createObjectURL(avatar);
        up.style.backgroundImage = `url("${url}")`;
        up.classList.add('has-img');
      });
      box.querySelector('[data-join]')?.addEventListener('click', () => {
        close();
        joinServerModal();
      });
    },
  });
}

function parseCode(raw: string): string {
  const v = raw.trim();
  const m = v.match(/(?:invite\/|join\/|#)([A-Za-z0-9_-]{4,})\/?$/);
  return (m ? m[1] : v).trim();
}

export function joinServerModal(prefill = ''): void {
  openModal({
    width: 460,
    title: 'Присоединиться к серверу',
    sub: 'Введите код или ссылку-приглашение.',
    body: `<label class="cv2-field"><span class="cv2-field__label">Ссылка-приглашение</span>
        <input class="cv2-input" data-code placeholder="hX7k2QpLmN" value="${esc(prefill)}" autofocus></label>
      <div class="cv2-invprev" data-prev></div>
      <div class="cv2-field__hint">Приглашения выглядят так: <code class="cv2-code">hX7k2QpLmN</code></div>`,
    actions: [
      { label: 'Отмена', kind: 'ghost' },
      {
        label: 'Присоединиться',
        kind: 'primary',
        onClick: async (box) => {
          const code = parseCode((box.querySelector('[data-code]') as HTMLInputElement).value);
          if (!code) return false;
          try {
            const d = unwrap<{ room_id: number }>(await S.api.cloudJoinInvite?.(code));
            await loadLists();
            invalidate('rail');
            if (d?.room_id) H.openServer(Number(d.room_id));
            toast('Вы присоединились к серверу', 'success');
          } catch (e) {
            toast(errText(e), 'error');
            return false;
          }
        },
      },
    ],
    onMount: (box) => {
      const input = box.querySelector('[data-code]') as HTMLInputElement;
      const prev = box.querySelector('[data-prev]') as HTMLElement;
      const look = debounce(async () => {
        const code = parseCode(input.value);
        if (code.length < 4) {
          prev.innerHTML = '';
          return;
        }
        try {
          const inv = unwrap<any>(await S.api.cloudGetInvite?.(code));
          prev.innerHTML = `<div class="cv2-invprev__card">
            ${avatarHtml(inv.room_name, inv.avatar_url, inv.avatar_color, { size: 48, cls: 'is-square', letters: true })}
            <span><span class="cv2-invprev__name">${esc(inv.room_name)}</span><span class="cv2-invprev__sub">${inv.members_total} ${plural(Number(inv.members_total) || 0, 'участник', 'участника', 'участников')} · пригласил ${esc(inv.creator_username)}</span></span>
          </div>`;
        } catch (e) {
          prev.innerHTML = `<div class="cv2-invprev__err">${esc(errText(e))}</div>`;
        }
      }, 350);
      input.addEventListener('input', look);
      if (prefill) look();
    },
  });
}

// ===== Группы: создание и добавление участников =====

const GROUP_MAX = 10;

export function groupPickerModal(opts: { mode: 'create' | 'add'; roomId?: number; preselect?: number[] }): void {
  const room = opts.roomId ? roomById(opts.roomId) : undefined;
  const inGroup = new Set<number>((S.members.get(opts.roomId || 0) || room?.members?.map((m) => ({ user_id: m.user_id })) || []).map((m) => m.user_id));
  const pre = new Set(opts.preselect || []);
  // Участник ЛС уже в будущей группе — места считаем вместе с ним и собой
  const base = opts.mode === 'add' ? inGroup.size : 1 + pre.size;
  const friends = S.friends.friends.slice().sort((a, b) => Number(isOnline(b.id)) - Number(isOnline(a.id)) || a.username.localeCompare(b.username, 'ru'));
  const list = friends.filter((f) => !pre.has(f.id));
  const body = list.length
    ? `<label class="cv2-search is-modal">${IC.search(16)}<input type="search" data-q placeholder="Введите имя пользователя друга" autofocus></label>
       <div class="cv2-picklist" data-list>${list.map((f) => friendPickRow(f.id, false, inGroup.has(f.id))).join('')}</div>`
    : `<div class="cv2-empty is-modal"><div class="cv2-empty__text">${S.friends.friends.length ? 'Все ваши друзья уже здесь.' : 'Сначала добавьте друзей — в группу можно пригласить только друзей.'}</div></div>`;
  openModal({
    width: 440,
    cls: 'is-picker',
    title: opts.mode === 'add' ? `Добавить друзей в «${room?.name || 'группу'}»` : 'Выберите друзей',
    sub: `Можно добавить ещё ${Math.max(0, GROUP_MAX - base)} ${plural(GROUP_MAX - base, 'друга', 'друзей', 'друзей')}.`,
    body,
    actions: list.length
      ? [
          {
            label: opts.mode === 'add' ? 'Добавить' : 'Создать группу',
            kind: 'primary',
            onClick: async (box) => {
              const ids = Array.from(box.querySelectorAll<HTMLInputElement>('input[type=checkbox]:checked:not(:disabled)')).map((i) => Number(i.value));
              if (!ids.length) {
                toast('Выберите хотя бы одного друга', 'error');
                return false;
              }
              try {
                if (opts.mode === 'add' && opts.roomId) {
                  unwrap(await S.api.cloudGroupAdd?.(opts.roomId, ids));
                  await Promise.all([loadLists(), loadMembers(opts.roomId)]);
                  invalidate('sidebar', 'main', 'aside');
                  return;
                }
                const all = [...pre, ...ids];
                // Один друг без предвыбора — это обычные ЛС, как в Discord
                if (all.length === 1) {
                  H.openDm(all[0]!);
                  return;
                }
                const d = unwrap<any>(await S.api.cloudGroupCreate?.(all));
                await loadLists();
                const id = Number(d?.room?.id ?? d?.id ?? d?.room_id);
                if (id) H.openGroup(id);
              } catch (e) {
                toast(errText(e), 'error');
                return false;
              }
            },
          },
        ]
      : [{ label: 'Закрыть', kind: 'ghost' }],
    onMount: (box) => {
      const q = box.querySelector<HTMLInputElement>('[data-q]');
      const listEl = box.querySelector<HTMLElement>('[data-list]');
      const sub = box.querySelector<HTMLElement>('.modal-header-sub');
      const sync = () => {
        const n = box.querySelectorAll('input[type=checkbox]:checked:not(:disabled)').length;
        const left = GROUP_MAX - base - n;
        if (sub) sub.textContent = left > 0 ? `Можно добавить ещё ${left} ${plural(left, 'друга', 'друзей', 'друзей')}.` : 'Достигнут лимит группы — 10 участников.';
        box.querySelectorAll<HTMLInputElement>('input[type=checkbox]:not(:checked)').forEach((i) => {
          if (!inGroup.has(Number(i.value))) i.disabled = left <= 0;
        });
      };
      listEl?.addEventListener('change', sync);
      q?.addEventListener('input', () => {
        const v = q.value.trim().toLowerCase();
        listEl?.querySelectorAll<HTMLElement>('.cv2-pick').forEach((el) => {
          el.hidden = Boolean(v) && !String(el.dataset.name).includes(v);
        });
      });
    },
  });
}

// ===== Приглашение на сервер =====

export function inviteModal(roomId: number): void {
  const room = roomById(roomId);
  const members = new Set((S.members.get(roomId) || []).map((m) => m.user_id));
  const friends = S.friends.friends.filter((f) => !members.has(f.id));
  openModal({
    width: 460,
    cls: 'is-invite',
    title: `Пригласить друзей на сервер «${room?.name || ''}»`,
    body: `${
      friends.length
        ? `<label class="cv2-search is-modal">${IC.search(16)}<input type="search" data-q placeholder="Поиск друзей"></label>
           <div class="cv2-picklist">${friends
             .map((f) => {
               const u = userOf(f.id);
               return `<div class="cv2-pick is-row" data-name="${esc(u.username.toLowerCase())}">
                 ${avatarHtml(u.username, u.avatar_url, u.avatar_color, { size: 32, status: isOnline(f.id) ? 'online' : 'offline', ring: 'var(--bg-base)' })}
                 <span class="cv2-pick__name">${esc(u.username)}</span>
                 <button type="button" class="stngs-btn primary sm" data-invite="${f.id}">Пригласить</button>
               </div>`;
             })
             .join('')}</div>`
        : '<div class="cv2-empty is-modal"><div class="cv2-empty__text">Все друзья уже на этом сервере. Поделитесь ссылкой ниже.</div></div>'
    }
    <div class="cv2-field is-link"><span class="cv2-field__label">Или отправьте код приглашения</span>
      <div class="cv2-copybox"><input class="cv2-input" data-link readonly placeholder="Создаём приглашение…"><button type="button" class="stngs-btn primary sm" data-copy disabled>Копировать</button></div>
      <span class="cv2-field__hint">Срок действия — 7 дней.</span>
    </div>`,
    onMount: (box) => {
      box.querySelectorAll<HTMLButtonElement>('[data-invite]').forEach((b) =>
        b.addEventListener('click', async () => {
          b.disabled = true;
          try {
            unwrap(await S.api.cloudInviteUserToRoom?.(roomId, Number(b.dataset.invite)));
            b.textContent = 'Отправлено';
            b.className = 'stngs-btn ghost sm';
          } catch (e) {
            b.disabled = false;
            toast(errText(e), 'error');
          }
        }),
      );
      const q = box.querySelector<HTMLInputElement>('[data-q]');
      q?.addEventListener('input', () => {
        const v = q.value.trim().toLowerCase();
        box.querySelectorAll<HTMLElement>('.cv2-pick').forEach((el) => {
          el.hidden = Boolean(v) && !String(el.dataset.name).includes(v);
        });
      });
      const link = box.querySelector('[data-link]') as HTMLInputElement;
      const copy = box.querySelector('[data-copy]') as HTMLButtonElement;
      void (async () => {
        try {
          const exp = new Date(Date.now() + 7 * 864e5).toISOString();
          const inv = unwrap<any>(await S.api.cloudCreateInvite?.(roomId, { expires_at: exp }));
          link.value = String(inv?.code || inv?.invite?.code || inv?.invite?.token || '');
          copy.disabled = !link.value;
          if (!link.value) link.placeholder = 'Код не пришёл';
        } catch (e) {
          link.placeholder = errText(e);
        }
      })();
      copy.addEventListener('click', () => {
        copyText(link.value);
        copy.textContent = 'Скопировано';
        copy.classList.replace('is-primary', 'is-success');
        window.setTimeout(() => {
          copy.textContent = 'Копировать';
          copy.classList.replace('is-success', 'is-primary');
        }, 1500);
      });
    },
  });
}

// ===== Каналы и категории =====

type ChannelEdit =
  | { kind: 'text'; roomId: number; catId?: number | null; ch?: TextChannel }
  | { kind: 'voice'; roomId: number; catId?: number | null; ch?: VoiceChannel }
  | { kind: 'category'; roomId: number; cat?: { id: number; name: string } };

type ChannelTab = 'overview' | 'perms';

function channelSettingsModal(o: Exclude<ChannelEdit, { kind: 'category' }>): void {
  const ch = o.ch;
  if (!ch) return;
  const voice = o.kind === 'voice';
  const text = ch as TextChannel;
  const room = roomById(o.roomId);
  let tab: ChannelTab = 'overview';
  let bannerFile: BannerCrop | null = null;
  let overwrites: ChannelOverwrite[] = (ch.overwrites || []).map((row) => ({
    target_id: row.target_id,
    target_type: row.target_type,
    allow: { ...(row.allow || {}) },
    deny: { ...(row.deny || {}) },
  }));
  if (!overwrites.some((row) => row.target_id === 0)) {
    overwrites.unshift({ target_id: 0, target_type: 'role', allow: {}, deny: {} });
  }
  let sel = 'role:0';
  const locked = Boolean(ch.is_default);
  openModal({
    bare: true,
    cls: 'build-editor',
    width: 960,
    body: `<div class="build-editor-header">
      <div class="modal-header">
        <div class="modal-header-text">
          <div class="modal-header-title">Настройки канала</div>
          <div class="modal-header-sub">${esc(voice ? ch.name : `# ${ch.name}`)}${room?.name ? ` — ${esc(room.name)}` : ''}</div>
        </div>
      </div>
      <button type="button" class="modal-close" data-modal-close aria-label="Закрыть">${MODAL_CLOSE_SVG}</button>
    </div>
    <div class="build-editor-body">
      <div class="build-editor-sidebar">
        <div class="stngs-group-title">${esc(ch.name)}</div>
        <button type="button" class="be-tab" data-tab="overview">Обзор</button>
        <button type="button" class="be-tab" data-tab="perms">Права доступа</button>
        ${locked ? '' : '<button type="button" class="be-tab danger" data-delete>Удалить канал</button>'}
      </div>
      <div class="build-editor-content" data-body></div>
    </div>`,
    onClose: () => closeLauncherSelect(),
    onMount: (box) => {
      const bodyEl = box.querySelector('[data-body]') as HTMLElement;
      const paint = async () => {
        closeLauncherSelect();
        box.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
        if (tab === 'perms') await paintPerms();
        else paintOverview();
      };

      const paintOverview = () => {
        const cats = (S.details.get(o.roomId)?.categories || []).filter((c) => c.id != null);
        const slow = String(Number(text.slowmode_seconds) || 0);
        const kind = text.channel_kind || 'text';
        const cat = String(ch.category_id ?? '');
        const rate = String((ch as VoiceChannel).bitrate || 64000);
        bodyEl.innerHTML = `<div class="be-panel-title">Обзор канала</div>
          <div class="stngs-panel-sub">${voice ? 'Название, лимит и качество голоса.' : 'Название, тема, медленный режим и обложка.'}</div>
          <label class="cv2-field"><span class="cv2-field__label">Название канала</span>
            <input class="cv2-input" data-name maxlength="60" value="${esc(ch.name)}"></label>
          ${
            voice
              ? ''
              : `<label class="cv2-field"><span class="cv2-field__label">Тема канала</span>
            <input class="cv2-input" data-topic maxlength="300" value="${esc(text.topic || '')}" placeholder="О чём этот канал"></label>
            <label class="cv2-field"><span class="cv2-field__label">Тип канала</span>
              ${launcherSelect(
                'data-kind',
                [
                  { value: 'text', label: 'Текстовый' },
                  { value: 'news', label: 'Новости' },
                  { value: 'rules', label: 'Правила' },
                ],
                kind,
              )}</label>
            <label class="cv2-field"><span class="cv2-field__label">Медленный режим</span>
              ${launcherSelect(
                'data-slow',
                SLOWMODE_OPTIONS.map(([sec, label]) => ({ value: String(sec), label })),
                slow,
              )}
              <span class="cv2-field__hint">Сколько ждать между сообщениями. Админы не ограничены.</span></label>
            <label class="cv2-perm"><span><b>Возрастной канал</b><span>Помечает канал как 18+.</span></span>
              <input type="checkbox" data-nsfw ${text.is_nsfw ? 'checked' : ''}><span class="cv2-switch"></span></label>`
          }
          <label class="cv2-field"><span class="cv2-field__label">Категория</span>
            ${launcherSelect(
              'data-cat',
              [{ value: '', label: 'Без категории' }, ...cats.map((c) => ({ value: String(c.id), label: c.name }))],
              cat,
            )}</label>
          ${
            voice
              ? `<label class="cv2-field"><span class="cv2-field__label">Битрейт</span>
              ${launcherSelect(
                'data-rate',
                BITRATE_OPTIONS.map(([n, label]) => ({ value: String(n), label })),
                rate,
              )}</label>
            <label class="cv2-field"><span class="cv2-field__label">Лимит участников <i data-limit-val>${(ch as VoiceChannel).user_limit ? (ch as VoiceChannel).user_limit : '∞'}</i></span>
              <input type="range" min="0" max="99" step="1" value="${Number((ch as VoiceChannel).user_limit) || 0}" data-limit class="cv2-range"></label>`
              : `<div class="cv2-field"><span class="cv2-field__label">Обложка канала</span>
            <div class="cv2-file">
              <button type="button" class="stngs-btn sm" data-banner-pick>Выберите файл</button>
              <span class="cv2-file__name" data-banner-name>${bannerFile ? esc(bannerFile.name) : 'Файл не выбран'}</span>
              <input type="file" data-banner accept="image/png,image/jpeg,image/gif,image/webp" hidden>
            </div>
            <span class="cv2-field__hint">960×540, показывается в шапке списка каналов.</span></div>`
          }
          <div class="cv2-roles__foot"><button type="button" class="stngs-btn primary" data-save>Сохранить изменения</button></div>`;
        bindLauncherSelects(bodyEl);
        const range = bodyEl.querySelector('[data-limit]') as HTMLInputElement | null;
        if (range) {
          const paintLimit = () => {
            syncRange(range);
            const v = bodyEl.querySelector('[data-limit-val]');
            if (v) v.textContent = Number(range.value) ? range.value : '∞';
          };
          range.addEventListener('input', paintLimit);
          paintLimit();
        }
        bodyEl.querySelector('[data-banner-pick]')?.addEventListener('click', () => {
          bodyEl.querySelector<HTMLInputElement>('[data-banner]')?.click();
        });
        bodyEl.querySelector<HTMLInputElement>('[data-banner]')?.addEventListener('change', async (e) => {
          const input = e.currentTarget as HTMLInputElement;
          const f = input.files?.[0];
          input.value = '';
          if (!f) return;
          const cropped = await openBannerCrop(f);
          if (!cropped) return;
          bannerFile = cropped;
          const name = bodyEl.querySelector('[data-banner-name]');
          if (name) name.textContent = cropped.name || f.name;
        });
        bodyEl.querySelector('[data-save]')?.addEventListener('click', async () => {
          let name = (bodyEl.querySelector('[data-name]') as HTMLInputElement).value.trim();
          if (!voice) name = name.toLowerCase().replace(/\s+/g, '-');
          if (!name) {
            toast('Введите название канала', 'error');
            return;
          }
          const catRaw = (bodyEl.querySelector('[data-cat]') as HTMLSelectElement | null)?.value ?? '';
          const category_id = catRaw ? Number(catRaw) : null;
          try {
            if (voice) {
              unwrap(
                await S.api.cloudUpdateVoiceChannel?.(o.roomId, ch.id, {
                  name,
                  user_limit: Number((bodyEl.querySelector('[data-limit]') as HTMLInputElement).value) || 0,
                  bitrate: Number((bodyEl.querySelector('[data-rate]') as HTMLSelectElement).value) || 64000,
                  category_id,
                }),
              );
            } else {
              unwrap(
                await S.api.cloudUpdateTextChannel?.(o.roomId, ch.id, {
                  name,
                  topic: (bodyEl.querySelector('[data-topic]') as HTMLInputElement).value.trim(),
                  slowmode_seconds: Number((bodyEl.querySelector('[data-slow]') as HTMLSelectElement).value) || 0,
                  channel_kind: (bodyEl.querySelector('[data-kind]') as HTMLSelectElement).value || 'text',
                  is_nsfw: Boolean((bodyEl.querySelector('[data-nsfw]') as HTMLInputElement | null)?.checked),
                  category_id,
                }),
              );
              if (bannerFile) unwrap(await S.api.cloudUploadChannelBanner?.(o.roomId, ch.id, bannerFile.bytes, bannerFile.name));
            }
            await loadDetail(o.roomId);
            invalidate('sidebar', 'main', 'header');
            toast('Канал сохранён', 'success');
            box.querySelector<HTMLElement>('[data-modal-close]')?.click();
          } catch (e) {
            toast(errText(e), 'error');
          }
        });
      };

      const paintPerms = async () => {
        await Promise.all([loadMembers(o.roomId), S.details.get(o.roomId)?.roles?.length ? null : loadDetail(o.roomId)]);
        const roles = [...(S.details.get(o.roomId)?.roles || [])].sort((a, b) => (b.position || 0) - (a.position || 0));
        const members = S.members.get(o.roomId) || [];
        const groups = voice ? VOICE_CHANNEL_PERMS : TEXT_CHANNEL_PERMS;
        if (!overwrites.some((row) => `${row.target_type}:${row.target_id}` === sel)) sel = 'role:0';
        const current = overwrites.find((row) => `${row.target_type}:${row.target_id}` === sel) || overwrites[0];
        const usedRoles = new Set(overwrites.filter((row) => row.target_type === 'role').map((row) => row.target_id));
        const usedMembers = new Set(overwrites.filter((row) => row.target_type === 'member').map((row) => row.target_id));
        const roleLeft = roles.filter((r) => !usedRoles.has(r.id));
        const memberLeft = members.filter((m) => !usedMembers.has(m.user_id));
        const labelOf = (row: ChannelOverwrite) => {
          if (row.target_id === 0) return '@everyone';
          if (row.target_type === 'role') return roles.find((r) => r.id === row.target_id)?.name || 'роль';
          return userOf(row.target_id).username;
        };
        bodyEl.innerHTML = `<div class="be-panel-title">Права доступа</div>
          <div class="stngs-panel-sub">Нейтрально — как на сервере. Галочка разрешает именно в этом канале, крест запрещает.</div>
          <div class="cv2-roles">
            <div class="cv2-roles__list">
              ${overwrites
                .map((row) => {
                  const key = `${row.target_type}:${row.target_id}`;
                  const color = row.target_type === 'role' ? roles.find((r) => r.id === row.target_id)?.color || '#99AAB5' : '';
                  return `<button type="button" class="cv2-roles__item ${key === sel ? 'is-active' : ''}" data-ow="${key}">${
                    row.target_id === 0 ? '<i style="background:#99AAB5"></i>' : row.target_type === 'role' ? `<i style="background:${esc(color)}"></i>` : ''
                  }<span>${esc(labelOf(row))}</span></button>`;
                })
                .join('')}
              ${
                roleLeft.length
                  ? launcherSelect(
                      'data-add-role',
                      [{ value: '', label: 'Добавить роль' }, ...roleLeft.map((r) => ({ value: String(r.id), label: r.name }))],
                      '',
                    )
                  : ''
              }
              ${
                memberLeft.length
                  ? launcherSelect(
                      'data-add-member',
                      [{ value: '', label: 'Добавить участника' }, ...memberLeft.map((m) => ({ value: String(m.user_id), label: userOf(m.user_id).username }))],
                      '',
                    )
                  : ''
              }
            </div>
            <div class="cv2-roles__edit">
              ${groups
                .map(
                  ([title, list]) => `<div class="cv2-perms"><div class="cv2-perms__title">${title}</div>${list
                    .map(([key, label, hint]) => {
                      const state = overwriteState(current, key);
                      const on = (name: string) => (state === name ? ' is-on' : '');
                      return `<div class="cv2-perm"><span><b>${label}</b>${hint ? `<span>${hint}</span>` : ''}</span>
                        <div class="cv2-tri" data-tri="${key}" data-state="${state}">
                          <button type="button" class="cv2-tri__btn is-deny${on('deny')}" data-set="deny" title="Запретить" aria-label="Запретить"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
                          <button type="button" class="cv2-tri__btn is-inherit${on('inherit')}" data-set="inherit" title="Как на сервере" aria-label="Как на сервере"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M10.4 3.1L5.6 12.9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
                          <button type="button" class="cv2-tri__btn is-allow${on('allow')}" data-set="allow" title="Разрешить" aria-label="Разрешить"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3.4 8.2l3 3.2 6.2-6.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
                        </div></div>`;
                    })
                    .join('')}</div>`,
                )
                .join('')}
              <div class="cv2-roles__foot">
                ${current && current.target_id !== 0 ? '<button type="button" class="stngs-btn danger sm" data-ow-del>Убрать</button>' : '<span></span>'}
                <button type="button" class="stngs-btn primary" data-ow-save>Сохранить права</button>
              </div>
            </div>
          </div>`;
        bindLauncherSelects(bodyEl);
        bodyEl.querySelectorAll<HTMLElement>('[data-ow]').forEach((b) => {
          b.addEventListener('click', () => {
            sel = b.dataset.ow || sel;
            void paint();
          });
        });
        const add = (kind: 'role' | 'member', raw: string) => {
          const id = Number(raw);
          if (!id) return;
          overwrites.push({ target_id: id, target_type: kind, allow: {}, deny: {} });
          sel = `${kind}:${id}`;
          void paint();
        };
        bodyEl.querySelector('[data-add-role]')?.addEventListener('change', (e) => add('role', (e.target as HTMLSelectElement).value));
        bodyEl.querySelector('[data-add-member]')?.addEventListener('change', (e) => add('member', (e.target as HTMLSelectElement).value));
        bodyEl.querySelectorAll<HTMLElement>('[data-tri]').forEach((group) => {
          group.querySelectorAll<HTMLButtonElement>('[data-set]').forEach((b) => {
            b.addEventListener('click', () => {
              if (!current) return;
              const perm = group.dataset.tri || '';
              const next = (b.dataset.set as 'inherit' | 'allow' | 'deny') || 'inherit';
              setOverwriteState(current, perm, next);
              group.dataset.state = next;
              group.querySelectorAll<HTMLButtonElement>('[data-set]').forEach((n) => n.classList.toggle('is-on', n === b));
            });
          });
        });
        bodyEl.querySelector('[data-ow-del]')?.addEventListener('click', () => {
          overwrites = overwrites.filter((row) => `${row.target_type}:${row.target_id}` !== sel);
          sel = 'role:0';
          void paint();
        });
        bodyEl.querySelector('[data-ow-save]')?.addEventListener('click', async () => {
          const cleaned = overwrites.filter((row) => Object.keys(row.allow || {}).length || Object.keys(row.deny || {}).length);
          try {
            if (voice) unwrap(await S.api.cloudUpdateVoiceChannel?.(o.roomId, ch.id, { overwrites: cleaned }));
            else unwrap(await S.api.cloudUpdateTextChannel?.(o.roomId, ch.id, { overwrites: cleaned }));
            await loadDetail(o.roomId);
            invalidate('sidebar', 'main', 'header', 'composer');
            toast('Права канала сохранены', 'success');
          } catch (e) {
            toast(errText(e), 'error');
          }
        });
      };

      box.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => {
        b.addEventListener('click', () => {
          tab = (b.dataset.tab as ChannelTab) || 'overview';
          void paint();
        });
      });
      box.querySelector('[data-delete]')?.addEventListener('click', async () => {
        if (!(await confirmDialog('Удалить канал', `Канал «${esc(ch.name)}» и его история будут удалены без возможности восстановления.`, 'Удалить канал'))) return;
        try {
          if (voice) unwrap(await S.api.cloudDeleteVoiceChannel?.(o.roomId, ch.id));
          else unwrap(await S.api.cloudDeleteTextChannel?.(o.roomId, ch.id));
          await loadDetail(o.roomId);
          const v = S.view;
          if (v.kind === 'server' && (v.channelId === ch.id || v.voiceId === ch.id)) H.openServer(o.roomId);
          invalidate('sidebar', 'main');
          box.querySelector<HTMLElement>('[data-modal-close]')?.click();
        } catch (e) {
          toast(errText(e), 'error');
        }
      });
      void paint();
    },
  });
}

export function channelModal(o: ChannelEdit): void {
  const editing = o.kind === 'category' ? Boolean(o.cat) : Boolean(o.ch);
  if (o.kind !== 'category' && editing && o.ch) {
    channelSettingsModal(o);
    return;
  }
  if (o.kind === 'category') {
    openModal({
      width: 440,
      title: editing ? 'Настройки категории' : 'Создать категорию',
      body: `<label class="cv2-field"><span class="cv2-field__label">Название категории</span><input class="cv2-input" data-name maxlength="60" value="${esc(o.cat?.name || '')}" placeholder="Новая категория" autofocus></label>`,
      actions: [
        ...(editing
          ? [
              {
                label: 'Удалить',
                kind: 'danger' as const,
                onClick: async () => {
                  if (!(await confirmDialog('Удалить категорию', `Категория «${esc(o.cat!.name)}» будет удалена. Каналы останутся без категории.`, 'Удалить'))) return false;
                  try {
                    unwrap(await S.api.cloudDeleteCategory?.(o.roomId, o.cat!.id));
                    await loadDetail(o.roomId);
                    invalidate('sidebar');
                  } catch (e) {
                    toast(errText(e), 'error');
                    return false;
                  }
                },
              },
            ]
          : [{ label: 'Отмена', kind: 'ghost' as const }]),
        {
          label: editing ? 'Сохранить' : 'Создать',
          kind: 'primary',
          onClick: async (box) => {
            const name = (box.querySelector('[data-name]') as HTMLInputElement).value.trim();
            if (!name) return false;
            try {
              if (o.cat) unwrap(await S.api.cloudUpdateCategory?.(o.roomId, o.cat.id, { name }));
              else unwrap(await S.api.cloudCreateCategory?.(o.roomId, { name }));
              await loadDetail(o.roomId);
              invalidate('sidebar');
            } catch (e) {
              toast(errText(e), 'error');
              return false;
            }
          },
        },
      ],
    });
    return;
  }
  let bannerFile: BannerCrop | null = null;
  const ch = o.ch as (TextChannel & VoiceChannel) | undefined;
  const textKind = (o.kind === 'text' && (o.ch as TextChannel | undefined)?.channel_kind) || 'text';
  const locked = Boolean(editing && ch?.is_default);
  const types = editing
    ? ''
    : `<div class="cv2-field"><span class="cv2-field__label">Тип канала</span>
        <div class="cv2-radios" data-types>
          ${[
            ['text', channelMark('text', 18), 'Текстовый', 'Сообщения, изображения, мнения и шутки'],
            ['voice', channelMark('voice', 18), 'Голосовой', 'Общайтесь голосом все вместе'],
            ['news', channelMark('news', 18), 'Новости', 'Важные объявления — пишут только админы'],
            ['rules', channelMark('rules', 18), 'Правила', 'Правила сервера — пишут только админы'],
          ]
            .map(
              ([id, ico, t, s]) => `<label class="cv2-radio"><input type="radio" name="cv2-chtype" value="${id}" ${(o.kind === 'voice' ? 'voice' : 'text') === id ? 'checked' : ''}>
                <span class="cv2-radio__ico">${ico}</span><span class="cv2-radio__text"><b>${t}</b><span>${s}</span></span><span class="cv2-radio__dot"></span></label>`,
            )
            .join('')}
        </div></div>`;
  openModal({
    width: 480,
    title: editing ? `Настройки канала` : 'Создать канал',
    sub: editing ? (o.kind === 'voice' ? `🔊 ${ch?.name}` : `# ${ch?.name}`) : undefined,
    body: `${types}
      <label class="cv2-field"><span class="cv2-field__label">Название канала</span>
        <div class="cv2-input-ico">${channelMark(o.kind === 'voice' ? 'voice' : textKind, 16)}<input class="cv2-input" data-name maxlength="60" value="${esc(ch?.name || '')}" placeholder="новый-канал" autofocus></div></label>
      <label class="cv2-field" data-only="text"><span class="cv2-field__label">Тема канала</span>
        <input class="cv2-input" data-topic maxlength="300" value="${esc((o.ch as TextChannel | undefined)?.topic || '')}" placeholder="Расскажите, о чём этот канал"></label>
      <div class="cv2-field" data-only="text"><span class="cv2-field__label">Обложка канала</span>
        <div class="cv2-file">
          <button type="button" class="stngs-btn sm" data-banner-pick>Выберите файл</button>
          <span class="cv2-file__name" data-banner-name>Файл не выбран</span>
          <input type="file" data-banner accept="image/png,image/jpeg,image/gif,image/webp" hidden>
        </div>
        <span class="cv2-field__hint">960×540. Перед сохранением кадрируется и показывается в шапке списка каналов.</span></div>
      <label class="cv2-field" data-only="text"><span class="cv2-field__label">Медленный режим</span>
        <select class="cv2-input" data-slow>${[0, 5, 10, 30, 60, 300, 900, 3600]
          .map((s) => `<option value="${s}" ${(Number((o.ch as TextChannel | undefined)?.slowmode_seconds) || 0) === s ? 'selected' : ''}>${s === 0 ? 'Выключен' : s < 60 ? `${s} сек.` : s < 3600 ? `${s / 60} мин.` : '1 ч.'}</option>`)
          .join('')}</select></label>
      <label class="cv2-field" data-only="voice"><span class="cv2-field__label">Лимит участников <i data-limit-val>${ch?.user_limit ? ch.user_limit : '∞'}</i></span>
        <input type="range" min="0" max="25" step="1" value="${Number(ch?.user_limit) || 0}" data-limit class="cv2-range"></label>
      ${locked ? '<span class="cv2-field__hint">Это системный канал: его можно переименовать и перенести, но нельзя удалить.</span>' : ''}`,
    actions: [
      ...(editing && !locked
        ? [
            {
              label: 'Удалить канал',
              kind: 'danger' as const,
              onClick: async () => {
                if (!(await confirmDialog('Удалить канал', `Канал «${esc(ch!.name)}» и его история будут удалены без возможности восстановления.`, 'Удалить канал'))) return false;
                try {
                  if (o.kind === 'voice') unwrap(await S.api.cloudDeleteVoiceChannel?.(o.roomId, ch!.id));
                  else unwrap(await S.api.cloudDeleteTextChannel?.(o.roomId, ch!.id));
                  await loadDetail(o.roomId);
                  const v = S.view;
                  if (v.kind === 'server' && (v.channelId === ch!.id || v.voiceId === ch!.id)) H.openServer(o.roomId);
                  invalidate('sidebar', 'main');
                } catch (e) {
                  toast(errText(e), 'error');
                  return false;
                }
              },
            },
          ]
        : [{ label: 'Отмена', kind: 'ghost' as const }]),
      {
        label: editing ? 'Сохранить' : 'Создать канал',
        kind: 'primary',
        onClick: async (box) => {
          const type = editing ? (o.kind === 'voice' ? 'voice' : textKind) : (box.querySelector('input[name=cv2-chtype]:checked') as HTMLInputElement)?.value || 'text';
          let name = (box.querySelector('[data-name]') as HTMLInputElement).value.trim();
          if (type !== 'voice') name = name.toLowerCase().replace(/\s+/g, '-');
          if (!name) {
            toast('Введите название канала', 'error');
            return false;
          }
          const topic = (box.querySelector('[data-topic]') as HTMLInputElement).value.trim();
          const slow = Number((box.querySelector('[data-slow]') as HTMLSelectElement).value) || 0;
          const limit = Number((box.querySelector('[data-limit]') as HTMLInputElement).value) || 0;
          const catId = 'catId' in o ? o.catId ?? null : null;
          try {
            if (type === 'voice') {
              const body = { name, user_limit: limit, ...(editing ? {} : { category_id: catId }) };
              if (editing) unwrap(await S.api.cloudUpdateVoiceChannel?.(o.roomId, ch!.id, body));
              else unwrap(await S.api.cloudCreateVoiceChannel?.(o.roomId, body));
            } else {
              const body = { name, topic, slowmode_seconds: slow, channel_kind: type, ...(editing ? {} : { category_id: catId }) };
              let channelId = editing ? ch!.id : 0;
              if (editing) unwrap(await S.api.cloudUpdateTextChannel?.(o.roomId, ch!.id, body));
              else {
                const created = unwrap<any>(await S.api.cloudCreateTextChannel?.(o.roomId, body));
                channelId = Number(created?.id ?? created?.channel?.id);
                if (channelId) H.openServer(o.roomId, channelId);
              }
              if (bannerFile && channelId) {
                unwrap(await S.api.cloudUploadChannelBanner?.(o.roomId, channelId, bannerFile.bytes, bannerFile.name));
              }
            }
            await loadDetail(o.roomId);
            invalidate('sidebar', 'main');
          } catch (e) {
            toast(errText(e), 'error');
            return false;
          }
        },
      },
    ],
    onMount: (box) => {
      const sync = () => {
        const type = editing ? (o.kind === 'voice' ? 'voice' : 'text') : (box.querySelector('input[name=cv2-chtype]:checked') as HTMLInputElement)?.value || 'text';
        const isVoice = type === 'voice';
        box.querySelectorAll<HTMLElement>('[data-only]').forEach((el) => {
          el.hidden = (el.dataset.only === 'voice') !== isVoice;
        });
        const ico = box.querySelector('.cv2-input-ico');
        if (ico?.firstElementChild) ico.firstElementChild.outerHTML = channelMark(isVoice ? 'voice' : type, 16);
      };
      box.querySelector('[data-banner-pick]')?.addEventListener('click', () => {
        box.querySelector<HTMLInputElement>('[data-banner]')?.click();
      });
      box.querySelector<HTMLInputElement>('[data-banner]')?.addEventListener('change', async (e) => {
        const input = e.currentTarget as HTMLInputElement;
        const f = input.files?.[0];
        input.value = '';
        if (!f) return;
        const cropped = await openBannerCrop(f);
        if (!cropped) return;
        bannerFile = cropped;
        const name = box.querySelector('[data-banner-name]');
        if (name) name.textContent = cropped.name || f.name;
      });
      box.querySelector('[data-types]')?.addEventListener('change', sync);
      const range = box.querySelector('[data-limit]') as HTMLInputElement;
      const paintLimit = () => {
        syncRange(range);
        const v = box.querySelector('[data-limit-val]');
        if (v) v.textContent = Number(range.value) ? range.value : '∞';
      };
      range.addEventListener('input', paintLimit);
      paintLimit();
      sync();
    },
  });
}

// ===== Настройки сервера =====

const PERMS: Array<[string, Array<[string, string, string]>]> = [
  [
    'Общие права сервера',
    [
      ['administrator', 'Администратор', 'Все права и обход ограничений каналов. Выдавайте осторожно.'],
      ['manage_channels', 'Управлять каналами', 'Создание, изменение и удаление каналов и категорий.'],
      ['manage_roles', 'Управлять ролями', 'Создание ролей и выдача их участникам ниже по иерархии.'],
      ['create_invite', 'Создавать приглашения', 'Приглашать новых людей на сервер.'],
    ],
  ],
  [
    'Текстовые каналы',
    [
      ['send_messages', 'Отправлять сообщения', ''],
      ['attach_files', 'Прикреплять файлы', ''],
      ['add_reactions', 'Добавлять реакции', ''],
      ['manage_messages', 'Управлять сообщениями', 'Удалять чужие сообщения и закреплять.'],
    ],
  ],
  [
    'Голосовые каналы',
    [
      ['connect', 'Подключаться', ''],
      ['speak', 'Говорить', ''],
    ],
  ],
  [
    'Модерация',
    [
      ['kick_members', 'Выгонять участников', ''],
      ['ban_members', 'Банить участников', ''],
      ['mute_members', 'Отключать микрофон участникам', ''],
      ['deafen_members', 'Отключать звук участникам', ''],
      ['move_members', 'Перемещать участников', 'Между голосовыми каналами.'],
      ['priority_speaker', 'Приоритетный режим', ''],
    ],
  ],
  [
    'Участники',
    [
      ['change_nickname', 'Менять свой никнейм', ''],
      ['manage_nicknames', 'Менять чужие никнеймы', ''],
      ['mention_everyone', 'Упоминать @everyone', ''],
      ['view_audit_log', 'Смотреть журнал аудита', ''],
      ['read_message_history', 'Читать историю сообщений', ''],
    ],
  ],
];

type SettingsTab = 'overview' | 'safety' | 'roles' | 'members' | 'invites' | 'audit' | 'bans' | 'mutes' | 'danger';

export function serverSettingsModal(roomId: number, start: SettingsTab = 'overview'): void {
  const room = roomById(roomId);
  const owner = isRoomOwner(roomId);
  const groups: Array<{ title: string; items: Array<[SettingsTab, string, boolean]> }> = [
    {
      title: room?.name || 'Сервер',
      items: [
        ['overview', 'Обзор', canManage(roomId)],
        ['safety', 'Безопасность', canManage(roomId)],
      ],
    },
    {
      title: 'Люди',
      items: [
        ['members', 'Участники', true],
        ['roles', 'Роли', canManage(roomId, 'manage_roles')],
        ['invites', 'Приглашения', canManage(roomId, 'create_invite')],
      ],
    },
    {
      title: 'Модерация',
      items: [
        ['audit', 'Журнал аудита', canManage(roomId) || canManage(roomId, 'view_audit_log')],
        ['bans', 'Баны', canManage(roomId, 'ban_members')],
        ['mutes', 'Тайм-ауты', canManage(roomId, 'mute_members') || canManage(roomId, 'kick_members')],
      ],
    },
  ];
  const tabs = groups.flatMap((g) => g.items);
  let tab: SettingsTab = start;
  let roleSel: number | null = null;
  let roleBusy = false;
  openModal({
    bare: true,
    cls: 'build-editor',
    width: 960,
    body: `<div class="build-editor-header">
      <div class="modal-header">
        <div class="modal-header-text">
          <div class="modal-header-title">Настройки сервера</div>
          ${room?.name ? `<div class="modal-header-sub">${esc(room.name)}</div>` : ''}
        </div>
      </div>
      <button type="button" class="modal-close" data-modal-close aria-label="Закрыть">${MODAL_CLOSE_SVG}</button>
    </div>
    <div class="build-editor-body">
      <div class="build-editor-sidebar">
        ${groups
          .map((g) => {
            const items = g.items.filter((t) => t[2]);
            if (!items.length) return '';
            return `<div class="stngs-group-title">${esc(g.title)}</div>${items
              .map(([id, label]) => `<button type="button" class="be-tab" data-tab="${id}">${esc(label)}</button>`)
              .join('')}`;
          })
          .join('')}
        ${owner ? `<button type="button" class="be-tab" data-tab="danger">Опасная зона</button><button type="button" class="be-tab danger" data-delete>Удалить сервер</button>` : ''}
      </div>
      <div class="build-editor-content" data-body></div>
    </div>`,
    onClose: () => closeLauncherSelect(),
    onMount: (box, close) => {
      const bodyEl = box.querySelector('[data-body]') as HTMLElement;
      const paint = async () => {
        closeLauncherSelect();
        box.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
        bodyEl.innerHTML = '<div class="cv2-spinner is-center"></div>';
        try {
          if (tab === 'overview') paintOverview();
          else if (tab === 'safety') await paintSafety();
          else if (tab === 'roles') await paintRoles();
          else if (tab === 'members') await paintMembers();
          else if (tab === 'invites') await paintInvites();
          else if (tab === 'audit') await paintAudit();
          else if (tab === 'mutes') await paintMutes();
          else if (tab === 'danger') await paintDanger();
          else await paintBans();
        } catch (e) {
          bodyEl.innerHTML = `<div class="cv2-empty"><div class="cv2-empty__text">${esc(errText(e))}</div></div>`;
        }
      };

      const paintOverview = () => {
        const d = S.details.get(roomId);
        const r = roomById(roomId);
        const banner = assetUrl(d?.banner_url || r?.banner_url);
        bodyEl.innerHTML = `<div class="be-panel-title">Обзор сервера</div>
          <div class="cv2-ov">
            <label class="cv2-ov__banner">
              <span class="cv2-field__label">Обложка</span>
              <span class="cv2-ov__banner-frame ${banner ? 'has-img' : ''}" ${banner ? `style="background-image:url('${esc(banner)}')"` : ''}>
                <span class="cv2-ov__banner-hint">${IC.image(16)} 960×540</span>
              </span>
              <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden data-banner>
            </label>
            <div class="cv2-ov__row">
              <label class="cv2-ov__ava" data-tip="Сменить значок">
                ${avatarHtml(r?.name || '', r?.avatar_url, r?.avatar_color, { size: 96, cls: 'is-square', letters: true })}
                <span class="cv2-ov__ava-edit">${IC.image(20)}</span>
                <input type="file" accept="image/*" hidden data-ava>
              </label>
              <div class="cv2-ov__fields">
                <label class="cv2-field"><span class="cv2-field__label">Название сервера</span><input class="cv2-input" data-name maxlength="60" value="${esc(d?.name || r?.name || '')}"></label>
                <label class="cv2-field"><span class="cv2-field__label">Описание</span><textarea class="cv2-input" data-desc rows="3" maxlength="300">${esc(d?.description || r?.description || '')}</textarea></label>
                <button type="button" class="stngs-btn primary" data-save>Сохранить изменения</button>
              </div>
            </div>
          </div>`;
        bodyEl.querySelector('[data-save]')?.addEventListener('click', async () => {
          const name = (bodyEl.querySelector('[data-name]') as HTMLInputElement).value.trim();
          const description = (bodyEl.querySelector('[data-desc]') as HTMLTextAreaElement).value.trim();
          if (!name) return;
          try {
            unwrap(await S.api.cloudUpdateRoom?.(roomId, { name, description }));
            await Promise.all([loadLists(), loadDetail(roomId)]);
            invalidate('rail', 'sidebar');
            toast('Сохранено', 'success');
          } catch (e) {
            toast(errText(e), 'error');
          }
        });
        const bannerInput = bodyEl.querySelector('[data-banner]') as HTMLInputElement;
        bannerInput.addEventListener('change', async () => {
          const f = bannerInput.files?.[0];
          bannerInput.value = '';
          if (!f) return;
          const cropped = await openBannerCrop(f);
          if (!cropped) return;
          try {
            unwrap(await S.api.cloudUploadRoomBanner?.(roomId, cropped.bytes, cropped.name));
            await Promise.all([loadLists(), loadDetail(roomId)]);
            invalidate('sidebar', 'main');
            paintOverview();
            toast('Обложка обновлена', 'success');
          } catch (e) {
            toast(errText(e), 'error');
          }
        });
        const ava = bodyEl.querySelector('[data-ava]') as HTMLInputElement;
        ava.addEventListener('change', async () => {
          const f = ava.files?.[0];
          if (!f) return;
          try {
            unwrap(await S.api.cloudUploadRoomAvatar?.(roomId, await fileBytes(f), f.name));
            await loadLists();
            invalidate('rail', 'sidebar');
            paintOverview();
            toast('Значок обновлён', 'success');
          } catch (e) {
            toast(errText(e), 'error');
          }
        });
      };

      const paintRoles = async () => {
        const roles = unwrap<Role[]>(await S.api.cloudListRoles?.(roomId)) || [];
        if (roleSel == null || !roles.some((r) => r.id === roleSel)) roleSel = roles[0]?.id ?? null;
        const role = roles.find((r) => r.id === roleSel);
        bodyEl.innerHTML = `<div class="be-panel-title">Роли</div>
          <div class="stngs-panel-sub">Роли объединяют участников и выдают им права. Цвет старшей роли окрашивает имя.</div>
          <div class="cv2-roles">
            <div class="cv2-roles__list">
              <button type="button" class="stngs-btn primary sm" data-new>${IC.plus(14)}<span>Создать роль</span></button>
              ${roles
                .slice()
                .sort((a, b) => (b.position || 0) - (a.position || 0))
                .map((r) => `<button type="button" class="cv2-roles__item ${r.id === roleSel ? 'is-active' : ''}" data-role="${r.id}" draggable="true"><i style="background:${esc(r.color || '#99AAB5')}"></i><span>${esc(r.name)}</span></button>`)
                .join('')}
            </div>
            <div class="cv2-roles__edit">${
              role
                ? `<div class="cv2-roles__row">
                    <label class="cv2-field"><span class="cv2-field__label">Название роли</span><input class="cv2-input" data-rname maxlength="40" value="${esc(role.name)}"></label>
                    <label class="cv2-field is-color"><span class="cv2-field__label">Цвет</span><input type="color" data-rcolor value="${esc(role.color || '#99AAB5')}"></label>
                  </div>
                  ${PERMS.map(
                    ([title, list]) => `<div class="cv2-perms"><div class="cv2-perms__title">${title}</div>${list
                      .map(
                        ([key, label, hint]) => `<label class="cv2-perm"><span><b>${label}</b>${hint ? `<span>${hint}</span>` : ''}</span>
                          <input type="checkbox" data-perm="${key}" ${role.permissions?.[key] ? 'checked' : ''}><span class="cv2-switch"></span></label>`,
                      )
                      .join('')}</div>`,
                  ).join('')}
                  <div class="cv2-roles__foot">
                    <button type="button" class="stngs-btn danger sm" data-rdel>Удалить роль</button>
                    <button type="button" class="stngs-btn primary" data-rsave>Сохранить</button>
                  </div>`
                : '<div class="cv2-empty"><div class="cv2-empty__text">Ролей пока нет. Создайте первую.</div></div>'
            }</div>
          </div>`;
        let roleDragged = false;
        bodyEl.querySelectorAll<HTMLElement>('[data-role]').forEach((b) => {
          b.addEventListener('click', () => {
            if (roleDragged) {
              roleDragged = false;
              return;
            }
            roleSel = Number(b.dataset.role);
            void paint();
          });
          b.addEventListener('dragstart', (ev) => {
            roleDragged = true;
            b.classList.add('is-drag');
            ev.dataTransfer?.setData('text/plain', String(b.dataset.role || ''));
            if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
          });
          b.addEventListener('dragend', () => b.classList.remove('is-drag'));
          b.addEventListener('dragover', (ev) => {
            ev.preventDefault();
            b.classList.add('is-drop');
          });
          b.addEventListener('dragleave', () => b.classList.remove('is-drop'));
          b.addEventListener('drop', (ev) => {
            ev.preventDefault();
            b.classList.remove('is-drop');
            const from = Number(ev.dataTransfer?.getData('text/plain'));
            const to = Number(b.dataset.role);
            if (!from || from === to || roleBusy) return;
            const ordered = roles.slice().sort((a, c) => (c.position || 0) - (a.position || 0));
            const fromI = ordered.findIndex((r) => r.id === from);
            const toI = ordered.findIndex((r) => r.id === to);
            if (fromI < 0 || toI < 0) return;
            const [moved] = ordered.splice(fromI, 1);
            if (!moved) return;
            ordered.splice(toI, 0, moved);
            roleBusy = true;
            void (async () => {
              try {
                await Promise.all(
                  ordered.map((r, i) => {
                    const position = ordered.length - i;
                    if ((r.position || 0) === position) return Promise.resolve();
                    return S.api.cloudUpdateRole?.(roomId, r.id, {
                      name: r.name,
                      color: r.color,
                      permissions: r.permissions || {},
                      position,
                    });
                  }),
                );
                await loadDetail(roomId);
                invalidate('aside', 'sidebar');
                void paint();
              } catch (err) {
                toast(errText(err), 'error');
              } finally {
                roleBusy = false;
              }
            })();
          });
        });
        bodyEl.querySelector('[data-new]')?.addEventListener('click', async (e) => {
          if (!e.isTrusted || roleBusy) return;
          roleBusy = true;
          try {
            const r = unwrap<Role>(await S.api.cloudCreateRole?.(roomId, { name: 'новая роль', color: '#99AAB5', permissions: { send_messages: true, add_reactions: true, attach_files: true, connect: true, speak: true } }));
            roleSel = r?.id ?? null;
            await loadDetail(roomId);
            void paint();
          } catch (e) {
            toast(errText(e), 'error');
          } finally {
            roleBusy = false;
          }
        });
        bodyEl.querySelector('[data-rsave]')?.addEventListener('click', async (e) => {
          if (!e.isTrusted || roleBusy || !role) return;
          roleBusy = true;
          const permissions: Record<string, boolean> = {};
          bodyEl.querySelectorAll<HTMLInputElement>('[data-perm]').forEach((i) => (permissions[i.dataset.perm!] = i.checked));
          try {
            unwrap(
              await S.api.cloudUpdateRole?.(roomId, role.id, {
                name: (bodyEl.querySelector('[data-rname]') as HTMLInputElement).value.trim() || role.name,
                color: (bodyEl.querySelector('[data-rcolor]') as HTMLInputElement).value,
                permissions,
              }),
            );
            await loadDetail(roomId);
            invalidate('aside', 'sidebar');
            toast('Роль сохранена', 'success');
            void paint();
          } catch (e) {
            toast(errText(e), 'error');
          } finally {
            roleBusy = false;
          }
        });
        bodyEl.querySelector('[data-rdel]')?.addEventListener('click', async (e) => {
          if (!e.isTrusted || roleBusy || !role || !(await confirmDialog('Удалить роль', `Роль «${esc(role.name)}» будет снята со всех участников.`, 'Удалить'))) return;
          roleBusy = true;
          try {
            unwrap(await S.api.cloudDeleteRole?.(roomId, role.id));
            roleSel = null;
            await loadDetail(roomId);
            void paint();
          } catch (e) {
            toast(errText(e), 'error');
          } finally {
            roleBusy = false;
          }
        });
      };

      const paintMembers = async () => {
        await Promise.all([loadMembers(roomId), S.details.get(roomId) ? null : loadDetail(roomId)]);
        const roles = S.details.get(roomId)?.roles || [];
        const list = S.members.get(roomId) || [];
        const canRoles = canManage(roomId, 'manage_roles');
        const canKick = canManage(roomId, 'kick_members');
        const canBan = canManage(roomId, 'ban_members');
        const ownerId = S.details.get(roomId)?.creator_id ?? roomById(roomId)?.creator_id;
        bodyEl.innerHTML = `<div class="be-panel-title">Участники — ${list.length}</div>
          <label class="cv2-search is-modal">${IC.search(16)}<input type="search" data-q placeholder="Поиск участников"></label>
          <div class="cv2-smembers">${list
            .map((m) => {
              const u = userOf(m.user_id);
              const mine = roles.filter((r) => m.role_ids?.includes(r.id));
              const isOwner = sameId(ownerId, m.user_id);
              const self = sameId(m.user_id, S.me.id);
              return `<div class="cv2-smember" data-name="${esc(u.username.toLowerCase())}">
                ${avatarHtml(u.username, u.avatar_url, u.avatar_color, { size: 36, status: isOnline(m.user_id) ? 'online' : 'offline', ring: 'var(--bg-base)' })}
                <span class="cv2-smember__name">${esc(u.username)}${isOwner ? `<span class="cv2-mrow__crown">${IC.crown(14)}</span>` : ''}</span>
                ${
                  canManage(roomId, 'manage_nicknames') || owner
                    ? `<span class="cv2-smember__nick"><input class="cv2-input is-nick" data-nick="${m.user_id}" value="${esc(m.nickname || '')}" placeholder="Никнейм на сервере" maxlength="32"></span>`
                    : m.nickname
                      ? `<span class="cv2-smember__nick">${esc(m.nickname)}</span>`
                      : '<span class="cv2-smember__nick"></span>'
                }
                <span class="cv2-smember__roles">${mine
                  .map((r) => `<span class="cv2-chip" style="--rc:${esc(r.color || '#99AAB5')}"><i></i>${esc(r.name)}${canRoles ? `<button type="button" data-unrole="${r.id}" data-uid="${m.user_id}">${IC.close(10)}</button>` : ''}</span>`)
                  .join('')}${
                  canRoles && roles.length
                    ? `<select class="cv2-chip is-add" data-addrole="${m.user_id}"><option value="">+ роль</option>${roles
                        .filter((r) => !m.role_ids?.includes(r.id))
                        .map((r) => `<option value="${r.id}">${esc(r.name)}</option>`)
                        .join('')}</select>`
                    : ''
                }</span>
                <span class="cv2-smember__acts">${
                  !isOwner && !self
                    ? `${canKick ? `<button type="button" class="stngs-btn ghost sm" data-kick="${m.user_id}">Выгнать</button>` : ''}${canBan ? `<button type="button" class="stngs-btn danger sm" data-ban="${m.user_id}">Бан</button>` : ''}`
                    : ''
                }</span>
              </div>`;
            })
            .join('')}</div>`;
        const q = bodyEl.querySelector<HTMLInputElement>('[data-q]');
        q?.addEventListener('input', () => {
          const v = q.value.trim().toLowerCase();
          bodyEl.querySelectorAll<HTMLElement>('.cv2-smember').forEach((el) => (el.hidden = Boolean(v) && !String(el.dataset.name).includes(v)));
        });
        bodyEl.querySelectorAll<HTMLSelectElement>('[data-addrole]').forEach((s) =>
          s.addEventListener('change', async () => {
            if (!s.value || roleBusy) return;
            roleBusy = true;
            try {
              unwrap(await S.api.cloudAssignRole?.(roomId, Number(s.dataset.addrole), Number(s.value)));
              void paint();
              invalidate('aside');
            } catch (e) {
              toast(errText(e), 'error');
            } finally {
              roleBusy = false;
            }
          }),
        );
        bodyEl.querySelectorAll<HTMLElement>('[data-unrole]').forEach((b) =>
          b.addEventListener('click', async () => {
            try {
              unwrap(await S.api.cloudRemoveRole?.(roomId, Number(b.dataset.uid), Number(b.dataset.unrole)));
              void paint();
              invalidate('aside');
            } catch (e) {
              toast(errText(e), 'error');
            }
          }),
        );
        bodyEl.querySelectorAll<HTMLInputElement>('[data-nick]').forEach((input) =>
          input.addEventListener('change', async () => {
            try {
              unwrap(await S.api.cloudSetMemberNickname?.(roomId, Number(input.dataset.nick), input.value.trim() || null));
              toast('Никнейм сохранён', 'success');
              void paint();
            } catch (e) {
              toast(errText(e), 'error');
            }
          }),
        );
        bodyEl.querySelectorAll<HTMLElement>('[data-kick]').forEach((b) =>
          b.addEventListener('click', async () => {
            const uid = Number(b.dataset.kick);
            if (!(await confirmDialog('Выгнать участника', `Выгнать <b>${esc(userOf(uid).username)}</b> с сервера? Он сможет вернуться по приглашению.`, 'Выгнать'))) return;
            try {
              unwrap(await S.api.cloudKickMember?.(roomId, uid));
              void paint();
            } catch (e) {
              toast(errText(e), 'error');
            }
          }),
        );
        bodyEl.querySelectorAll<HTMLElement>('[data-ban]').forEach((b) =>
          b.addEventListener('click', () => banDialog(roomId, Number(b.dataset.ban), () => void paint())),
        );
      };

      const paintInvites = async () => {
        const list = unwrap<any[]>(await S.api.cloudListInvites?.(roomId)) || [];
        bodyEl.innerHTML = `<div class="be-panel-title">Приглашения</div>
          <div class="cv2-settings__bar cv2-settings__invite">
            <label class="cv2-field"><span class="cv2-field__label">Сколько раз можно войти</span><input class="cv2-input" data-uses type="number" min="0" max="100" value="0" placeholder="0 — без лимита"></label>
            <label class="cv2-field"><span class="cv2-field__label">Истекает</span>
              ${launcherSelect('data-exp', [
                { value: '0', label: 'Никогда' },
                { value: '1800', label: '30 минут' },
                { value: '3600', label: '1 час' },
                { value: '86400', label: '1 день' },
                { value: '604800', label: '7 дней' },
              ], '0')}
            </label>
            <button type="button" class="stngs-btn primary sm" data-new>${IC.link(14)}<span>Создать приглашение</span></button>
          </div>
          ${
            list.length
              ? `<div class="cv2-table"><div class="cv2-table__head"><span>Код</span><span>Создал</span><span>Использований</span><span>Истекает</span><span></span></div>${list
                  .map(
                    (i) => `<div class="cv2-table__row"><span><code class="cv2-code">${esc(i.code)}</code></span><span>${esc(userOf(i.creator_id).username)}</span><span>${i.uses ?? 0}${i.max_uses ? ` / ${i.max_uses}` : ''}</span><span>${i.expires_at ? esc(fmtDate(i.expires_at)) : 'Никогда'}</span>
                      <span class="cv2-table__acts"><button type="button" class="cv2-ibtn is-sm" data-copy="${esc(i.code)}" data-tip="Копировать">${IC.copy(14)}</button><button type="button" class="cv2-ibtn is-sm is-danger" data-del="${i.id}" data-tip="Удалить">${IC.trash(14)}</button></span></div>`,
                  )
                  .join('')}</div>`
              : '<div class="cv2-empty"><div class="cv2-empty__text">Активных приглашений нет.</div></div>'
          }`;
        bindLauncherSelects(bodyEl);
        bodyEl.querySelector('[data-new]')?.addEventListener('click', async () => {
          try {
            const uses = Math.max(0, Number((bodyEl.querySelector('[data-uses]') as HTMLInputElement)?.value) || 0);
            const exp = Number((bodyEl.querySelector('[data-exp]') as HTMLSelectElement)?.value) || 0;
            const inv = unwrap<any>(
              await S.api.cloudCreateInvite?.(roomId, {
                max_uses: uses,
                expires_at: exp ? new Date(Date.now() + exp * 1000).toISOString() : null,
              }),
            );
            if (inv?.code) {
              copyText(String(inv.code));
              toast('Код скопирован', 'success');
            }
            void paint();
          } catch (e) {
            toast(errText(e), 'error');
          }
        });
        bodyEl.querySelectorAll<HTMLElement>('[data-copy]').forEach((b) =>
          b.addEventListener('click', () => {
            copyText(String(b.dataset.copy));
            toast('Код скопирован', 'success');
          }),
        );
        bodyEl.querySelectorAll<HTMLElement>('[data-del]').forEach((b) =>
          b.addEventListener('click', async () => {
            try {
              unwrap(await S.api.cloudDeleteInvite?.(roomId, Number(b.dataset.del)));
              void paint();
            } catch (e) {
              toast(errText(e), 'error');
            }
          }),
        );
      };

      const paintBans = async () => {
        const list = unwrap<any[]>(await S.api.cloudListBans?.(roomId)) || [];
        bodyEl.innerHTML = `<div class="be-panel-title">Баны — ${list.length}</div>
          ${
            list.length
              ? `<div class="cv2-table is-bans"><div class="cv2-table__head"><span>Пользователь</span><span>Причина</span><span>Срок</span><span></span></div>${list
                  .map(
                    (b) => `<div class="cv2-table__row"><span>${esc(b.username)}</span><span>${esc(b.reason || '—')}</span><span>${b.is_permanent ? 'Навсегда' : b.expires_at ? `до ${esc(fmtDate(b.expires_at))}` : '—'}</span>
                      <span class="cv2-table__acts"><button type="button" class="stngs-btn ghost sm" data-unban="${b.user_id}">Разбанить</button></span></div>`,
                  )
                  .join('')}</div>`
              : '<div class="cv2-empty"><div class="cv2-empty__text">Забаненных пользователей нет.</div></div>'
          }`;
        bodyEl.querySelectorAll<HTMLElement>('[data-unban]').forEach((b) =>
          b.addEventListener('click', async () => {
            try {
              unwrap(await S.api.cloudUnbanUser?.(roomId, Number(b.dataset.unban)));
              void paint();
            } catch (e) {
              toast(errText(e), 'error');
            }
          }),
        );
      };

      const channelOptions = (): SelectOpt[] => {
        const list = allTextChannels(S.details.get(roomId));
        return [{ value: '', label: 'Не выбран' }, ...list.map((c) => ({ value: String(c.id), label: `# ${c.name}` }))];
      };

      const paintSafety = async () => {
        await loadDetail(roomId);
        const s = S.details.get(roomId)?.settings;
        bodyEl.innerHTML = `<div class="be-panel-title">Безопасность</div>
          <div class="stngs-panel-sub">Проверка при входе, вложения и канал, куда пишутся системные сообщения.</div>
          <label class="cv2-field"><span class="cv2-field__label">Уровень проверки</span>
            ${launcherSelect(
              'data-ver',
              [
                { value: '0', label: 'Нет' },
                { value: '1', label: 'Аккаунт старше 10 минут' },
                { value: '2', label: 'Нужен аватар' },
              ],
              String(s?.verification_level === 3 ? 0 : s?.verification_level || 0),
            )}
          </label>
          <label class="cv2-field"><span class="cv2-field__label">Вложения</span>
            ${launcherSelect(
              'data-filter',
              [
                { value: 'disabled', label: 'Все, у кого есть право' },
                { value: 'members', label: 'Только участники с ролью' },
                { value: 'all', label: 'Только администраторы' },
              ],
              s?.explicit_filter === 'members' || s?.explicit_filter === 'all' ? s.explicit_filter : 'disabled',
            )}
          </label>
          <label class="cv2-field"><span class="cv2-field__label">Уведомления по умолчанию</span>
            ${launcherSelect(
              'data-notify',
              [
                { value: 'all', label: 'Все сообщения' },
                { value: 'mentions', label: 'Только упоминания' },
              ],
              s?.notify_default === 'mentions' ? 'mentions' : 'all',
            )}
          </label>
          <label class="cv2-field"><span class="cv2-field__label">Системные сообщения</span>${launcherSelect('data-system', channelOptions(), s?.system_channel_id ? String(s.system_channel_id) : '')}</label>
          <label class="cv2-field"><span class="cv2-field__label">Канал правил</span>${launcherSelect('data-rules', channelOptions(), s?.rules_channel_id ? String(s.rules_channel_id) : '')}</label>
          <button type="button" class="stngs-btn primary" data-save>Сохранить</button>`;
        bindLauncherSelects(bodyEl);
        bodyEl.querySelector('[data-save]')?.addEventListener('click', async () => {
          const numOrNull = (sel: string) => {
            const v = Number((bodyEl.querySelector(sel) as HTMLSelectElement).value);
            return v > 0 ? v : null;
          };
          try {
            unwrap(
              await S.api.cloudUpdateRoomSettings?.(roomId, {
                verification_level: Number((bodyEl.querySelector('[data-ver]') as HTMLSelectElement).value),
                explicit_filter: (bodyEl.querySelector('[data-filter]') as HTMLSelectElement).value,
                notify_default: (bodyEl.querySelector('[data-notify]') as HTMLSelectElement).value,
                system_channel_id: numOrNull('[data-system]'),
                rules_channel_id: numOrNull('[data-rules]'),
              }),
            );
            await loadDetail(roomId);
            toast('Настройки сохранены', 'success');
            void paint();
          } catch (e) {
            toast(errText(e), 'error');
          }
        });
      };

      const paintAudit = async () => {
        const list = unwrap<any[]>(await S.api.cloudRoomAudit?.(roomId)) || [];
        const label: Record<string, string> = {
          settings_update: 'Настройки',
          role_create: 'Роль создана',
          role_update: 'Роль изменена',
          role_delete: 'Роль удалена',
          role_assign: 'Роль выдана',
          role_remove: 'Роль снята',
          invite_create: 'Приглашение',
          invite_delete: 'Приглашение удалено',
          ban: 'Бан',
          unban: 'Разбан',
          mute: 'Тайм-аут',
          unmute: 'Тайм-аут снят',
          kick: 'Кик',
          nickname: 'Никнейм',
          transfer: 'Передача владения',
        };
        bodyEl.innerHTML = `<div class="be-panel-title">Журнал аудита</div>
          <div class="stngs-panel-sub">Кто менял роли, банил, кикал и правил настройки сервера.</div>
          ${
            list.length
              ? `<div class="cv2-table is-audit"><div class="cv2-table__head"><span>Кто</span><span>Действие</span><span>Подробности</span><span>Когда</span></div>${list
                  .map(
                    (a) => `<div class="cv2-table__row"><span>${esc(a.actor_name || '—')}</span><span>${esc(label[a.action] || a.action)}</span><span>${esc(a.detail || a.target_name || '—')}</span><span>${a.created_at ? esc(fmtDate(a.created_at)) : '—'}</span></div>`,
                  )
                  .join('')}</div>`
              : '<div class="cv2-empty"><div class="cv2-empty__text">Записей пока нет.</div></div>'
          }`;
      };

      const paintMutes = async () => {
        const list = unwrap<any[]>(await S.api.cloudListMutes?.(roomId)) || [];
        bodyEl.innerHTML = `<div class="be-panel-title">Тайм-ауты — ${list.length}</div>
          <div class="stngs-panel-sub">Заглушенные участники не могут писать, пока срок не кончится.</div>
          ${
            list.length
              ? `<div class="cv2-table is-bans"><div class="cv2-table__head"><span>Пользователь</span><span>Причина</span><span>Срок</span><span></span></div>${list
                  .map(
                    (m) => `<div class="cv2-table__row"><span>${esc(m.username || userOf(m.user_id).username)}</span><span>${esc(m.reason || '—')}</span><span>${m.expires_at ? `до ${esc(fmtDate(m.expires_at))}` : '—'}</span>
                      <span class="cv2-table__acts"><button type="button" class="stngs-btn ghost sm" data-unmute="${m.user_id}">Снять</button></span></div>`,
                  )
                  .join('')}</div>`
              : '<div class="cv2-empty"><div class="cv2-empty__text">Тайм-аутов нет.</div></div>'
          }`;
        bodyEl.querySelectorAll<HTMLElement>('[data-unmute]').forEach((b) =>
          b.addEventListener('click', async () => {
            try {
              unwrap(await S.api.cloudUnmuteUser?.(roomId, Number(b.dataset.unmute)));
              void paint();
            } catch (e) {
              toast(errText(e), 'error');
            }
          }),
        );
      };

      const paintDanger = async () => {
        await loadMembers(roomId);
        const list = (S.members.get(roomId) || []).filter((m) => !sameId(m.user_id, S.me.id));
        bodyEl.innerHTML = `<div class="be-panel-title">Опасная зона</div>
          <div class="stngs-panel-sub">Передача владения необратима: новый владелец сможет удалить сервер.</div>
          <label class="cv2-field"><span class="cv2-field__label">Новый владелец</span>
            ${launcherSelect(
              'data-owner',
              [{ value: '', label: 'Выберите участника' }, ...list.map((m) => ({ value: String(m.user_id), label: userOf(m.user_id).username }))],
              '',
            )}
          </label>
          <button type="button" class="stngs-btn danger" data-transfer>Передать владение</button>`;
        bindLauncherSelects(bodyEl);
        bodyEl.querySelector('[data-transfer]')?.addEventListener('click', async () => {
          const id = Number((bodyEl.querySelector('[data-owner]') as HTMLSelectElement).value);
          if (!id) return;
          const name = userOf(id).username;
          if (!(await confirmDialog('Передать сервер', `Владельцем станет <b>${esc(name)}</b>. Вы останетесь участником.`, 'Передать'))) return;
          try {
            unwrap(await S.api.cloudTransferRoom?.(roomId, id));
            await Promise.all([loadLists(), loadDetail(roomId)]);
            toast('Владение передано', 'success');
            close();
          } catch (e) {
            toast(errText(e), 'error');
          }
        });
      };

      box.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) =>
        b.addEventListener('click', () => {
          tab = b.dataset.tab as SettingsTab;
          void paint();
        }),
      );
      box.querySelector('[data-delete]')?.addEventListener('click', async () => {
        const name = roomById(roomId)?.name || '';
        if (!(await confirmDialog('Удалить сервер', `Сервер <b>${esc(name)}</b> будет удалён вместе со всеми каналами и сообщениями. Это действие нельзя отменить.`, 'Удалить сервер'))) return;
        try {
          unwrap(await S.api.cloudDeleteRoom?.(roomId));
          close();
          await loadLists();
          S.view = { kind: 'friends', tab: 'online' };
          invalidate('rail', 'sidebar', 'main', 'aside');
          toast('Сервер удалён', 'success');
        } catch (e) {
          toast(errText(e), 'error');
        }
      });
      if (!tabs.find((t) => t[0] === tab)?.[2]) tab = 'members';
      void paint();
    },
  });
}

export function banDialog(roomId: number, uid: number, done?: () => void): void {
  openModal({
    width: 440,
    title: `Забанить ${userOf(uid).username}`,
    body: `<label class="cv2-field"><span class="cv2-field__label">Причина</span><input class="cv2-input" data-reason maxlength="200" placeholder="Необязательно" autofocus></label>
      <label class="cv2-perm"><span><b>Навсегда</b><span>Иначе — на 7 дней</span></span><input type="checkbox" data-perm-ban checked><span class="cv2-switch"></span></label>`,
    actions: [
      { label: 'Отмена', kind: 'ghost' },
      {
        label: 'Забанить',
        kind: 'danger',
        onClick: async (box) => {
          try {
            unwrap(
              await S.api.cloudBanUser?.(
                roomId,
                uid,
                (box.querySelector('[data-reason]') as HTMLInputElement).value.trim(),
                (box.querySelector('[data-perm-ban]') as HTMLInputElement).checked,
              ),
            );
            await loadMembers(roomId);
            invalidate('aside');
            done?.();
          } catch (e) {
            toast(errText(e), 'error');
            return false;
          }
        },
      },
    ],
  });
}

// ===== Пересылка сообщения =====

export function forwardModal(msg: Message): void {
  type Target = { key: string; label: string; sub: string; ava: string; target: Parameters<ModalHooks['forward']>[0] };
  const targets: Target[] = [];
  for (const d of S.dms) {
    const u = userOf(d.peer_id);
    targets.push({ key: `dm:${d.peer_id}`, label: u.username, sub: 'Личные сообщения', ava: avatarHtml(u.username, u.avatar_url, u.avatar_color, { size: 32 }), target: { kind: 'dm', peerId: d.peer_id } });
  }
  for (const g of groups()) {
    const ch = S.details.get(g.id)?.default_channel_id;
    if (ch) targets.push({ key: `g:${g.id}`, label: g.name, sub: 'Группа', ava: groupIcon(g, 32), target: { kind: 'channel', roomId: g.id, channelId: ch } });
  }
  for (const r of servers()) {
    for (const c of allTextChannels(S.details.get(r.id))) {
      if ((c.channel_kind === 'news' || c.channel_kind === 'rules') && !canManage(r.id)) continue;
      targets.push({ key: `c:${c.id}`, label: `#${c.name}`, sub: r.name, ava: avatarHtml(r.name, r.avatar_url, r.avatar_color, { size: 32, cls: 'is-square', letters: true }), target: { kind: 'channel', roomId: r.id, channelId: c.id } });
    }
  }
  openModal({
    width: 480,
    cls: 'is-picker',
    title: 'Переслать',
    sub: 'Выберите, куда отправить сообщение.',
    body: `<label class="cv2-search is-modal">${IC.search(16)}<input type="search" data-q placeholder="Поиск" autofocus></label>
      <div class="cv2-picklist">${
        targets.length
          ? targets
              .map(
                (t, i) => `<div class="cv2-pick is-row" data-name="${esc((t.label + ' ' + t.sub).toLowerCase())}">${t.ava}<span class="cv2-pick__name">${esc(t.label)}<small>${esc(t.sub)}</small></span>
                  <button type="button" class="stngs-btn primary sm" data-fw="${i}">Отправить</button></div>`,
              )
              .join('')
          : '<div class="cv2-empty is-modal"><div class="cv2-empty__text">Некуда пересылать — откройте беседу или сервер.</div></div>'
      }</div>
      <div class="cv2-fwprev"><span class="cv2-fwprev__bar"></span><span>${esc((msg.text || msg.attachment_name || '').slice(0, 200))}</span></div>`,
    onMount: (box) => {
      const q = box.querySelector<HTMLInputElement>('[data-q]');
      q?.addEventListener('input', () => {
        const v = q.value.trim().toLowerCase();
        box.querySelectorAll<HTMLElement>('.cv2-pick').forEach((el) => (el.hidden = Boolean(v) && !String(el.dataset.name).includes(v)));
      });
      box.querySelectorAll<HTMLButtonElement>('[data-fw]').forEach((b) =>
        b.addEventListener('click', async () => {
          b.disabled = true;
          const ok = await H.forward(targets[Number(b.dataset.fw)]!.target, msg);
          b.textContent = ok ? 'Отправлено' : 'Ошибка';
          b.className = `stngs-btn sm ${ok ? 'ghost' : 'danger'}`;
          if (!ok) b.disabled = false;
        }),
      );
    },
  });
}

// ===== Настройки голоса =====

export function audioSettingsModal(): void {
  let stream: MediaStream | null = null;
  let raf = 0;
  let ctx: AudioContext | null = null;
  const stopTest = () => {
    cancelAnimationFrame(raf);
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    void ctx?.close().catch(() => undefined);
    ctx = null;
  };
  openModal({
    width: 520,
    title: 'Голос и звук',
    body: `<div class="cv2-audio">
      <label class="cv2-field"><span class="cv2-field__label">Устройство ввода</span><select class="cv2-input" data-in><option value="">По умолчанию</option></select></label>
      <label class="cv2-field"><span class="cv2-field__label">Устройство вывода</span><select class="cv2-input" data-out><option value="">По умолчанию</option></select></label>
      <div class="cv2-field"><span class="cv2-field__label">Проверка микрофона</span>
        <div class="cv2-audio__test"><button type="button" class="stngs-btn primary sm" data-test>Проверить</button><div class="cv2-meter"><i data-meter></i></div></div>
        <span class="cv2-field__hint">Скажите что-нибудь — полоска покажет уровень сигнала.</span>
      </div>
    </div>`,
    actions: [{ label: 'Готово', kind: 'primary' }],
    onClose: stopTest,
    onMount: (box) => {
      const inSel = box.querySelector('[data-in]') as HTMLSelectElement;
      const outSel = box.querySelector('[data-out]') as HTMLSelectElement;
      void listDevices().then(({ inputs, outputs }) => {
        inSel.insertAdjacentHTML('beforeend', inputs.filter((d) => d.deviceId && d.deviceId !== 'default').map((d) => `<option value="${esc(d.deviceId)}">${esc(d.label || 'Микрофон')}</option>`).join(''));
        outSel.insertAdjacentHTML('beforeend', outputs.filter((d) => d.deviceId && d.deviceId !== 'default').map((d) => `<option value="${esc(d.deviceId)}">${esc(d.label || 'Динамики')}</option>`).join(''));
        inSel.value = DEV.input;
        outSel.value = DEV.output;
      });
      inSel.addEventListener('change', () => void setInputDevice(inSel.value));
      outSel.addEventListener('change', () => void setOutputDevice(outSel.value));
      const btn = box.querySelector('[data-test]') as HTMLButtonElement;
      const meter = box.querySelector('[data-meter]') as HTMLElement;
      btn.addEventListener('click', async () => {
        if (stream) {
          stopTest();
          btn.textContent = 'Проверить';
          meter.style.width = '0';
          return;
        }
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: inSel.value ? { deviceId: { exact: inSel.value } } : true });
          ctx = new AudioContext();
          const an = ctx.createAnalyser();
          an.fftSize = 512;
          ctx.createMediaStreamSource(stream).connect(an);
          const buf = new Uint8Array(an.fftSize);
          const tick = () => {
            an.getByteTimeDomainData(buf);
            let sum = 0;
            for (let i = 0; i < buf.length; i++) sum += ((buf[i]! - 128) / 128) ** 2;
            meter.style.width = `${Math.min(100, Math.sqrt(sum / buf.length) * 400)}%`;
            raf = requestAnimationFrame(tick);
          };
          tick();
          btn.textContent = 'Остановить';
        } catch (e) {
          toast('Нет доступа к микрофону: ' + errText(e), 'error');
        }
      });
    },
  });
}

// ===== Общие серверы / друзья =====

export function mutualModal(uid: number, kind: 'servers' | 'friends'): void {
  const mu = S.mutuals.get(uid);
  const u = userOf(uid);
  const rows =
    kind === 'servers'
      ? (mu?.servers || []).map(
          (s) => `<button type="button" class="cv2-pick is-row is-btn" data-room="${s.id}">${avatarHtml(s.name, s.avatar_url, s.avatar_color, { size: 36, cls: 'is-square', letters: true })}<span class="cv2-pick__name">${esc(s.name)}</span></button>`,
        )
      : (mu?.friends || []).map((f) => {
          const fu = userOf(f.id);
          return `<button type="button" class="cv2-pick is-row is-btn" data-peer="${f.id}">${avatarHtml(fu.username, fu.avatar_url, fu.avatar_color, { size: 36, status: isOnline(f.id) ? 'online' : 'offline', ring: 'var(--bg-base)' })}<span class="cv2-pick__name">${esc(fu.username)}</span></button>`;
        });
  openModal({
    width: 420,
    title: kind === 'servers' ? `Общие серверы с ${u.username}` : `Общие друзья с ${u.username}`,
    body: `<div class="cv2-picklist">${rows.join('') || '<div class="cv2-empty is-modal"><div class="cv2-empty__text">Пусто</div></div>'}</div>`,
    onMount: (box, close) => {
      box.querySelectorAll<HTMLElement>('[data-room]').forEach((b) =>
        b.addEventListener('click', () => {
          close();
          H.openServer(Number(b.dataset.room));
        }),
      );
      box.querySelectorAll<HTMLElement>('[data-peer]').forEach((b) =>
        b.addEventListener('click', () => {
          close();
          H.openDm(Number(b.dataset.peer));
        }),
      );
    },
  });
}

// ===== Быстрый переход (Ctrl+K) =====

export function quickSwitcher(): void {
  type Item = { label: string; sub: string; ava: string; go: () => void; hay: string };
  const items: Item[] = [];
  const seen = new Set<number>();
  for (const d of S.dms) {
    const u = userOf(d.peer_id);
    seen.add(d.peer_id);
    items.push({ label: u.username, sub: 'Личные сообщения', ava: avatarHtml(u.username, u.avatar_url, u.avatar_color, { size: 24 }), go: () => H.openDm(d.peer_id), hay: u.username.toLowerCase() });
  }
  for (const f of S.friends.friends) {
    if (seen.has(f.id)) continue;
    const u = userOf(f.id);
    items.push({ label: u.username, sub: 'Друг', ava: avatarHtml(u.username, u.avatar_url, u.avatar_color, { size: 24 }), go: () => H.openDm(f.id), hay: u.username.toLowerCase() });
  }
  for (const g of groups()) items.push({ label: g.name, sub: 'Группа', ava: groupIcon(g, 24), go: () => H.openGroup(g.id), hay: g.name.toLowerCase() });
  for (const r of servers()) {
    items.push({ label: r.name, sub: 'Сервер', ava: avatarHtml(r.name, r.avatar_url, r.avatar_color, { size: 24, cls: 'is-square', letters: true }), go: () => H.openServer(r.id), hay: r.name.toLowerCase() });
    for (const c of allTextChannels(S.details.get(r.id))) {
      items.push({ label: c.name, sub: r.name, ava: `<span class="cv2-qs__hash">${channelMark(c.channel_kind, 18)}</span>`, go: () => H.openServer(r.id, c.id), hay: `${c.name} ${r.name}`.toLowerCase() });
    }
  }
  let sel = 0;
  let shown: Item[] = [];
  openModal({
    bare: true,
    cls: 'is-qs',
    width: 560,
    body: `<div class="cv2-qs">
      <div class="cv2-qs__title">Найти или начать беседу</div>
      <input class="cv2-qs__input" data-q placeholder="Куда отправимся?" autofocus>
      <div class="cv2-qs__list" data-list></div>
      <div class="cv2-qs__hint"><b>Совет:</b> используйте ↑ ↓ и Enter. Окно открывается по Ctrl+K.</div>
    </div>`,
    onMount: (box, close) => {
      const q = box.querySelector('[data-q]') as HTMLInputElement;
      const list = box.querySelector('[data-list]') as HTMLElement;
      const paint = () => {
        const v = q.value.trim().toLowerCase();
        shown = (v ? items.filter((i) => i.hay.includes(v)) : items.slice(0, 40)).slice(0, 40);
        sel = Math.min(sel, Math.max(0, shown.length - 1));
        list.innerHTML = shown.length
          ? shown.map((i, n) => `<button type="button" class="cv2-qs__item ${n === sel ? 'is-sel' : ''}" data-i="${n}">${i.ava}<span>${esc(i.label)}</span><small>${esc(i.sub)}</small></button>`).join('')
          : '<div class="cv2-qs__empty">Ничего не найдено</div>';
      };
      const go = (i: number) => {
        const it = shown[i];
        if (!it) return;
        close();
        it.go();
      };
      q.addEventListener('input', () => {
        sel = 0;
        paint();
      });
      q.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % Math.max(1, shown.length);
          paint();
          list.querySelector('.is-sel')?.scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter') {
          e.preventDefault();
          go(sel);
        }
      });
      list.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
        if (b) go(Number(b.dataset.i));
      });
      paint();
    },
  });
}
