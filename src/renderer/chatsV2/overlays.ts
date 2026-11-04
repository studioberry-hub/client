// Оверлеи чатов v2: подсказки, контекстные меню, модалки, тосты, выбор эмодзи, просмотр изображений.
import { IC } from './icons';
import { esc } from './util';

// ===== Слой оверлеев =====

export function layer(): HTMLElement {
  let el = document.getElementById('cv2-layer');
  if (!el) {
    el = document.createElement('div');
    el.id = 'cv2-layer';
    el.className = 'cv2-layer';
    document.body.appendChild(el);
  }
  return el;
}

export function clampToViewport(el: HTMLElement, x: number, y: number, pad = 8): void {
  const r = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = Math.max(pad, Math.min(x, vw - r.width - pad));
  const top = Math.max(pad, Math.min(y, vh - r.height - pad));
  // Целые координаты: иначе мелкие SVG в меню рисуются между пикселями и мылятся
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
}

// ===== Подсказки =====

let tipEl: HTMLElement | null = null;
let tipFor: HTMLElement | null = null;
let tipTimer: number | null = null;

function hideTip(): void {
  if (tipTimer != null) window.clearTimeout(tipTimer);
  tipTimer = null;
  tipFor = null;
  if (tipEl) {
    tipEl.classList.remove('is-on');
    const el = tipEl;
    window.setTimeout(() => {
      if (!el.classList.contains('is-on')) el.hidden = true;
    }, 120);
  }
}

function showTip(target: HTMLElement): void {
  const text = target.dataset.tip;
  if (!text) return;
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.className = 'cv2-tip';
    layer().appendChild(tipEl);
  }
  const side = (target.dataset.tipSide || 'top') as 'top' | 'right' | 'bottom' | 'left';
  tipEl.className = `cv2-tip is-${side}`;
  tipEl.textContent = text;
  tipEl.hidden = false;
  const r = target.getBoundingClientRect();
  const t = tipEl.getBoundingClientRect();
  let x = r.left + r.width / 2 - t.width / 2;
  let y = r.top - t.height - 8;
  if (side === 'right') {
    x = r.right + 12;
    y = r.top + r.height / 2 - t.height / 2;
  } else if (side === 'bottom') {
    y = r.bottom + 8;
  } else if (side === 'left') {
    x = r.left - t.width - 12;
    y = r.top + r.height / 2 - t.height / 2;
  }
  clampToViewport(tipEl, x, y, 4);
  requestAnimationFrame(() => tipEl?.classList.add('is-on'));
}

/** Обновить текст уже открытой подсказки, если у цели сменился data-tip. */
export function refreshOpenTip(): void {
  if (!tipEl || !tipFor || tipEl.hidden) return;
  const text = tipFor.dataset.tip || '';
  if (!text || tipEl.textContent === text) return;
  tipEl.textContent = text;
}

export function bindTooltips(root: HTMLElement): void {
  root.addEventListener('mouseover', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
    if (t === tipFor) return;
    hideTip();
    if (!t) return;
    tipFor = t;
    tipTimer = window.setTimeout(() => showTip(t), Number(t.dataset.tipDelay || 160));
  });
  root.addEventListener('mouseleave', hideTip);
  root.addEventListener('mousedown', hideTip, true);
  window.addEventListener('blur', hideTip);
  document.addEventListener('scroll', hideTip, true);
}

// ===== Контекстное меню =====

export type MenuItem =
  | 'sep'
  | { header: string }
  | { html: string; onMount?: (el: HTMLElement) => void }
  | {
      label: string;
      icon?: string;
      danger?: boolean;
      disabled?: boolean;
      checked?: boolean;
      hint?: string;
      onClick?: () => void;
      sub?: MenuItem[];
    };

let menuEl: HTMLElement | null = null;
let menuCleanup: (() => void) | null = null;

export function closeMenu(): void {
  if (!menuEl) return;
  const el = menuEl;
  menuEl = null;
  menuCleanup?.();
  menuCleanup = null;
  el.classList.remove('is-on');
  layer().querySelectorAll('.cv2-menu.is-sub').forEach((n) => n.remove());
  window.setTimeout(() => el.remove(), 140);
}

function buildMenu(items: MenuItem[], onClose: () => void): HTMLElement {
  const el = document.createElement('div');
  el.className = 'cv2-menu';
  el.setAttribute('role', 'menu');
  items.forEach((it) => {
    if (it === 'sep') {
      el.insertAdjacentHTML('beforeend', '<div class="cv2-menu__sep"></div>');
      return;
    }
    if ('header' in it) {
      el.insertAdjacentHTML('beforeend', `<div class="cv2-menu__head">${esc(it.header)}</div>`);
      return;
    }
    if ('html' in it) {
      const box = document.createElement('div');
      box.className = 'cv2-menu__custom';
      box.innerHTML = it.html;
      el.appendChild(box);
      it.onMount?.(box);
      return;
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `cv2-menu__item${it.danger ? ' is-danger' : ''}${it.sub ? ' has-sub' : ''}${it.hint ? ' has-hint' : ''}`;
    b.disabled = Boolean(it.disabled);
    b.innerHTML = `${it.icon ? `<span class="cv2-menu__ico">${it.icon}</span>` : ''}<span class="cv2-menu__text"><span class="cv2-menu__label">${esc(it.label)}</span>${
      it.hint ? `<span class="cv2-menu__hint">${esc(it.hint)}</span>` : ''
    }</span>${it.checked != null ? `<span class="cv2-menu__check ${it.checked ? 'is-on' : ''}">${IC.check(12)}</span>` : ''}${
      it.sub ? `<span class="cv2-menu__chev">${IC.chevronRight(12)}</span>` : ''
    }`;
    if (it.sub) {
      let subEl: HTMLElement | null = null;
      b.addEventListener('mouseenter', () => {
        // Подменю живёт в слое, а не внутри меню: transform родителя ломает position:fixed
        layer().querySelectorAll('.cv2-menu.is-sub').forEach((n) => n.remove());
        subEl = buildMenu(it.sub!, onClose);
        subEl.classList.add('is-sub');
        layer().appendChild(subEl);
        const r = b.getBoundingClientRect();
        clampToViewport(subEl, r.right + 4, r.top - 6);
        if (subEl.getBoundingClientRect().left < r.right) clampToViewport(subEl, r.left - subEl.offsetWidth - 4, r.top - 6);
        requestAnimationFrame(() => subEl?.classList.add('is-on'));
      });
    } else {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        onClose();
        it.onClick?.();
      });
    }
    el.appendChild(b);
  });
  return el;
}

/** Открыть меню у точки курсора или под элементом. */
export function openMenu(items: MenuItem[], at: { x: number; y: number } | HTMLElement, opts: { align?: 'start' | 'end'; side?: 'bottom' | 'right' | 'top' } = {}): void {
  closeMenu();
  const el = buildMenu(items, closeMenu);
  layer().appendChild(el);
  let x: number;
  let y: number;
  if (at instanceof HTMLElement) {
    const r = at.getBoundingClientRect();
    if (opts.side === 'right') {
      x = r.right + 6;
      y = r.top;
    } else if (opts.side === 'top') {
      x = opts.align === 'end' ? r.right - el.offsetWidth : r.left;
      y = r.top - el.offsetHeight - 6;
    } else {
      x = opts.align === 'end' ? r.right - el.offsetWidth : r.left;
      y = r.bottom + 6;
    }
    el.style.transformOrigin = opts.side === 'top' ? 'bottom' : 'top';
  } else {
    x = at.x;
    y = at.y;
    el.style.transformOrigin = 'top left';
  }
  clampToViewport(el, x, y);
  menuEl = el;
  requestAnimationFrame(() => el.classList.add('is-on'));
  const onDown = (e: MouseEvent) => {
    if (!(e.target as HTMLElement).closest('.cv2-menu')) closeMenu();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') closeMenu();
  };
  window.setTimeout(() => {
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', closeMenu);
    window.addEventListener('resize', closeMenu);
  }, 0);
  menuCleanup = () => {
    document.removeEventListener('mousedown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', closeMenu);
    window.removeEventListener('resize', closeMenu);
  };
}

// ===== Модальные окна =====

export type ModalAction = {
  label: string;
  kind?: 'primary' | 'danger' | 'ghost' | 'success';
  /** Вернуть false — окно не закрывать (ошибка валидации) */
  onClick?: (box: HTMLElement) => boolean | void | Promise<boolean | void>;
};

export type ModalOpts = {
  title?: string;
  sub?: string;
  body: string;
  cls?: string;
  width?: number;
  actions?: ModalAction[];
  onMount?: (box: HTMLElement, close: () => void) => void;
  onClose?: () => void;
  /** Без шапки и подвала — тело рисует всё само */
  bare?: boolean;
};

const modalStack: HTMLElement[] = [];

/** Толстый крестик модалок лаунчера, viewBox 12×12. */
export const MODAL_CLOSE_SVG = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M0 1.06066C0 0.474874 0.474874 0 1.06066 0C1.34196 0 1.61175 0.111748 1.81066 0.31066L11.6893 10.1893C11.8883 10.3883 12 10.658 12 10.9393C12 11.5251 11.5251 12 10.9393 12C10.658 12 10.3883 11.8883 10.1893 11.6893L0.31066 1.81066C0.111748 1.61175 0 1.34196 0 1.06066Z" fill="currentColor"/><path d="M1.06066 12C0.474874 12 5.66382e-09 11.5251 1.26493e-08 10.9393C1.60038e-08 10.658 0.111748 10.3883 0.31066 10.1893L10.1893 0.31066C10.3883 0.111748 10.658 1.27096e-07 10.9393 1.30451e-07C11.5251 1.37436e-07 12 0.474874 12 1.06066C12 1.34196 11.8883 1.61175 11.6893 1.81066L1.81066 11.6893C1.61175 11.8883 1.34196 12 1.06066 12Z" fill="currentColor"/></svg>`;

function modalBtnClass(kind?: string): string {
  if (kind === 'primary' || kind === 'success') return 'stngs-btn primary';
  if (kind === 'danger') return 'stngs-btn danger';
  return 'stngs-btn ghost';
}

function modalSizeClass(width?: number): string {
  if (!width || width <= 400) return 'sm';
  if (width <= 520) return 'md';
  if (width <= 700) return 'lg';
  return 'xl';
}

export function openModal(o: ModalOpts): () => void {
  closeMenu();
  const wrap = document.createElement('div');
  wrap.className = `modal-overlay${o.cls && /\bis-qs\b/.test(o.cls) ? ' is-qs' : ''}`;
  wrap.dataset.cv2Modal = '1';
  const actions = (o.actions || [])
    .map((a, i) => `<button type="button" class="${modalBtnClass(a.kind)}" data-modal-act="${i}">${esc(a.label)}</button>`)
    .join('');
  const windowCls = ['modal-window', modalSizeClass(o.width), o.cls || ''].filter(Boolean).join(' ');
  wrap.innerHTML = o.bare
    ? `<div class="${windowCls}" role="dialog" aria-modal="true">${o.body}</div>`
    : `<div class="${windowCls}" role="dialog" aria-modal="true">
      <div class="modal-header">
        <div class="modal-header-text">
          ${o.title ? `<div class="modal-header-title">${esc(o.title)}</div>` : ''}
          ${o.sub ? `<div class="modal-header-sub">${esc(o.sub)}</div>` : ''}
        </div>
        <button type="button" class="modal-close" data-modal-close aria-label="Закрыть">${MODAL_CLOSE_SVG}</button>
      </div>
      <div class="modal-body">${o.body}</div>
      ${actions ? `<div class="modal-footer">${actions}</div>` : ''}
    </div>`;
  document.body.appendChild(wrap);
  modalStack.push(wrap);
  const box = wrap.querySelector('.modal-window') as HTMLElement;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    const i = modalStack.indexOf(wrap);
    if (i >= 0) modalStack.splice(i, 1);
    wrap.classList.add('closing');
    document.removeEventListener('keydown', onKey, true);
    window.setTimeout(() => wrap.remove(), 120);
    o.onClose?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (modalStack[modalStack.length - 1] !== wrap) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
    if (e.key === 'Enter' && !e.shiftKey && (e.target as HTMLElement)?.tagName !== 'TEXTAREA') {
      // Сначала «Сохранить». Иначе Enter в настройках канала жмёт «Удалить»,
      // потому что опасная кнопка стоит в подвале раньше основной.
      const primary =
        box.querySelector<HTMLButtonElement>('.modal-footer .stngs-btn.primary') ||
        box.querySelector<HTMLButtonElement>('.modal-footer .stngs-btn.danger');
      if (primary && !primary.disabled) {
        e.preventDefault();
        primary.click();
      }
    }
  };
  document.addEventListener('keydown', onKey, true);
  wrap.addEventListener('mousedown', (e) => {
    if (e.target === wrap) close();
  });
  wrap.querySelectorAll('[data-modal-close]').forEach((b) => b.addEventListener('click', close));
  wrap.querySelectorAll<HTMLButtonElement>('[data-modal-act]').forEach((b) => {
    b.addEventListener('click', async () => {
      const a = o.actions?.[Number(b.dataset.modalAct)];
      if (!a) return;
      if (!a.onClick) {
        close();
        return;
      }
      b.disabled = true;
      b.classList.add('is-busy');
      try {
        const r = await a.onClick(box);
        if (r !== false) close();
      } finally {
        b.disabled = false;
        b.classList.remove('is-busy');
      }
    });
  });
  o.onMount?.(box, close);
  requestAnimationFrame(() => {
    box.querySelector<HTMLElement>('[autofocus], input:not([type=checkbox]), textarea')?.focus();
  });
  return close;
}

export function confirmDialog(title: string, text: string, ok = 'Подтвердить', danger = true): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    openModal({
      title,
      body: `<p class="cv2-modal__text">${text}</p>`,
      width: 440,
      actions: [
        { label: 'Отмена', kind: 'ghost' },
        {
          label: ok,
          kind: danger ? 'danger' : 'primary',
          onClick: () => {
            done = true;
            resolve(true);
          },
        },
      ],
      onClose: () => {
        if (!done) resolve(false);
      },
    });
  });
}

export function promptDialog(title: string, label: string, value = '', opts: { placeholder?: string; ok?: string; max?: number; sub?: string } = {}): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false;
    openModal({
      title,
      sub: opts.sub,
      width: 440,
      body: `<label class="cv2-field"><span class="cv2-field__label">${esc(label)}</span>
        <input class="cv2-input" data-prompt value="${esc(value)}" placeholder="${esc(opts.placeholder || '')}" maxlength="${opts.max || 100}" autofocus></label>`,
      actions: [
        { label: 'Отмена', kind: 'ghost' },
        {
          label: opts.ok || 'Сохранить',
          kind: 'primary',
          onClick: (box) => {
            done = true;
            resolve((box.querySelector('[data-prompt]') as HTMLInputElement).value.trim());
          },
        },
      ],
      onClose: () => {
        if (!done) resolve(null);
      },
    });
  });
}

// ===== Тосты =====

const toastSeen = new Map<string, number>();

export function toast(text: string, kind: 'info' | 'error' | 'success' = 'info', ms = 3200): void {
  const key = `${kind}:${text}`;
  const now = Date.now();
  const prev = toastSeen.get(key) || 0;
  if (now - prev < 4000) return;
  toastSeen.set(key, now);
  let host = document.getElementById('cv2-toasts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'cv2-toasts';
    host.className = 'cv2-toasts';
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = `cv2-toast is-${kind}`;
  el.innerHTML = `<span class="cv2-toast__dot"></span><span>${esc(text)}</span>`;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-on'));
  window.setTimeout(() => {
    el.classList.remove('is-on');
    window.setTimeout(() => el.remove(), 260);
  }, ms);
}

// ===== Выбор эмодзи =====

const EMOJI: Array<{ id: string; title: string; icon: string; list: string }> = [
  {
    id: 'smile',
    title: 'Смайлы',
    icon: '😀',
    list: '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😙 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 🤥 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🤧 🥵 🥶 🥴 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 ☠️ 💩 🤡 👹 👺 👻 👽 👾 🤖 😺 😸 😹 😻 😼 😽 🙀 😿 😾',
  },
  {
    id: 'people',
    title: 'Жесты',
    icon: '👍',
    list: '👋 🤚 🖐️ ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 🖕 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 🤝 🙏 ✍️ 💅 🤳 💪 🦾 🧠 👀 👁️ 👅 👄 🫶 🙋 🙅 🙆 💁 🤷 🤦 🙇 🧍 🏃 💃 🕺 👯 🧑‍💻 🧙 🦸 🥷',
  },
  {
    id: 'hearts',
    title: 'Сердца',
    icon: '❤️',
    list: '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ♥️ 💋 💯 💢 💥 💫 💦 💨 🕳️ 💬 👁️‍🗨️ 🗨️ 💤',
  },
  {
    id: 'nature',
    title: 'Природа',
    icon: '🐱',
    list: '🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐔 🐧 🐦 🐤 🦆 🦅 🦉 🦇 🐺 🐗 🐴 🦄 🐝 🐛 🦋 🐌 🐞 🐜 🐢 🐍 🦎 🐙 🦑 🦀 🐡 🐠 🐟 🐬 🐳 🐋 🦈 🐊 🐅 🐆 🦓 🦍 🐘 🦒 🐪 🌵 🎄 🌲 🌳 🌴 🌱 🌿 ☘️ 🍀 🍁 🍂 🍃 🌸 🌹 🌺 🌻 🌼 🌷 🌞 🌝 🌚 🌙 ⭐ 🌟 ✨ ⚡ 🔥 🌈 ☀️ ⛅ ☁️ 🌧️ ⛈️ ❄️ ☃️ 💧 🌊',
  },
  {
    id: 'food',
    title: 'Еда',
    icon: '🍕',
    list: '🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🥑 🍆 🥔 🥕 🌽 🌶️ 🥒 🥦 🧄 🧅 🍄 🥜 🍞 🥐 🥖 🧀 🥚 🍳 🥞 🧇 🥓 🥩 🍗 🍖 🌭 🍔 🍟 🍕 🥪 🌮 🌯 🥗 🍝 🍜 🍲 🍛 🍣 🍱 🥟 🍤 🍙 🍚 🍘 🍦 🍰 🎂 🧁 🍫 🍬 🍭 🍩 🍪 ☕ 🍵 🧃 🥤 🧋 🍺 🍻 🥂 🍷 🥃 🍸 🍹 🧊',
  },
  {
    id: 'activity',
    title: 'Игры',
    icon: '🎮',
    list: '🎮 🕹️ 👾 🎲 ♟️ 🎯 🎳 🏆 🥇 🥈 🥉 🏅 🎖️ ⚽ 🏀 🏈 ⚾ 🎾 🏐 🏉 🎱 🏓 🏸 🥊 🥋 ⛳ ⛸️ 🎿 🛹 🏂 🏋️ 🤺 🚴 🏎️ 🏍️ 🎪 🎭 🎨 🎬 🎤 🎧 🎼 🎹 🥁 🎷 🎺 🎸 🎻 🎉 🎊 🎈 🎁 🎀 🎃 🎄 🧨 ✨',
  },
  {
    id: 'objects',
    title: 'Предметы',
    icon: '💡',
    list: '⌚ 📱 💻 ⌨️ 🖥️ 🖨️ 🖱️ 💾 💿 📀 📷 📸 📹 🎥 📞 ☎️ 📺 📻 ⏰ ⏳ 📡 🔋 🔌 💡 🔦 🕯️ 💸 💵 💰 💳 💎 ⚖️ 🔧 🔨 ⚒️ 🛠️ ⛏️ 🔩 ⚙️ 🔫 💣 🔪 🗡️ ⚔️ 🛡️ 🔮 🧿 💊 💉 🧬 🔬 🔭 🧹 🧺 🧻 🚽 🛁 🔑 🗝️ 🚪 🛋️ 🛏️ 🧸 🎁 📦 📫 📝 📁 📅 📌 📍 📎 ✂️ 🔒 🔓 🚀 🛸 ✈️ 🚗 🚕 🚓 🚑 🚒 🏠 🏰 🗿',
  },
  {
    id: 'symbols',
    title: 'Символы',
    icon: '✅',
    list: '✅ ☑️ ✔️ ❌ ❎ ➕ ➖ ➗ ✖️ ♾️ ‼️ ⁉️ ❓ ❔ ❕ ❗ 〰️ ⚠️ 🚫 ⛔ 📛 🔞 ♻️ 🔱 ⚜️ 🔰 ⭕ 🟢 🟡 🟠 🔴 🟣 🔵 ⚫ ⚪ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 ▶️ ⏸️ ⏹️ ⏺️ ⏭️ ⏮️ ⏩ ⏪ 🔀 🔁 🔂 🔄 🆗 🆕 🆒 🆓 🆙 🆘 🔝 🔜 💲 ©️ ®️ ™️ #️⃣ 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟',
  },
];

const LS_RECENT = 'cv2.recentEmoji';

function recentEmoji(): string[] {
  try {
    return (JSON.parse(localStorage.getItem(LS_RECENT) || '[]') as string[]).slice(0, 24);
  } catch {
    return [];
  }
}

function pushRecent(e: string): void {
  const list = [e, ...recentEmoji().filter((x) => x !== e)].slice(0, 24);
  localStorage.setItem(LS_RECENT, JSON.stringify(list));
}

export const QUICK_REACTIONS = ['❤️', '👍', '😂', '🔥', '😮', '😢'];

let pickerEl: HTMLElement | null = null;
let closeOtherPicker: () => void = () => undefined;
let openStickers: (anchor: HTMLElement) => void = () => undefined;

const PICKER_SEARCH_ICO = `<svg class="cv2-pop__search-ico" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="4.25" stroke="currentColor" stroke-width="1.6"/><path d="M10.5 10.5L13.5 13.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;

/** Панель стикеров закрывается и открывается отсюда, без циклического импорта. */
export function setStickerCloser(fn: () => void): void {
  closeOtherPicker = fn;
}

export function setStickerOpener(fn: (anchor: HTMLElement) => void): void {
  openStickers = fn;
}

export function closeEmojiPicker(): void {
  if (!pickerEl) return;
  const el = pickerEl;
  pickerEl = null;
  el.classList.remove('is-on');
  window.setTimeout(() => el.remove(), 160);
}

type EmojiSec = { id: string; title: string; icon: string; list: string };

function emojiGlyphs(list: string): string[] {
  return list.split(/\s+/).filter(Boolean);
}

function emojiSections(): EmojiSec[] {
  const recent = recentEmoji();
  return [
    ...(recent.length ? [{ id: 'recent', title: 'Недавние', icon: '🕘', list: recent.join(' ') }] : []),
    ...EMOJI,
  ];
}

export function openEmojiPicker(anchor: HTMLElement, onPick: (emoji: string) => void, opts: { keepOpen?: boolean; side?: 'top' | 'left' } = {}): void {
  closeEmojiPicker();
  closeOtherPicker();
  closeMenu();
  const el = document.createElement('div');
  el.className = 'cv2-pop cv2-emoji';
  const tabs = opts.keepOpen
    ? `<div class="cv2-pop__tabs"><button type="button" class="cv2-pop__tab is-on" data-pop-tab="emoji">Эмодзи</button><button type="button" class="cv2-pop__tab" data-pop-tab="stickers">Стикеры</button></div>`
    : '';
  el.innerHTML = `${tabs}
    <label class="cv2-pop__search">${PICKER_SEARCH_ICO}<input type="search" placeholder="Поиск" data-emo-find autocomplete="off"></label>
    <div class="cv2-pop__grid" data-emo-grid></div>
    <div class="cv2-pop__bar" data-emo-rail></div>`;
  layer().appendChild(el);
  const r = anchor.getBoundingClientRect();
  if (opts.side === 'left') clampToViewport(el, r.left - el.offsetWidth - 8, r.top - 40);
  else clampToViewport(el, r.right - el.offsetWidth, r.top - el.offsetHeight - 10);
  pickerEl = el;
  requestAnimationFrame(() => el.classList.add('is-on'));

  const rail = el.querySelector<HTMLElement>('[data-emo-rail]')!;
  const grid = el.querySelector<HTMLElement>('[data-emo-grid]')!;
  const find = el.querySelector<HTMLInputElement>('[data-emo-find]')!;
  let query = '';

  const markRail = (id: string) => {
    rail.querySelectorAll<HTMLElement>('.cv2-pop__railbtn').forEach((btn) => {
      btn.classList.toggle('is-on', btn.dataset.sec === id);
    });
  };

  const paintRail = () => {
    rail.innerHTML = emojiSections()
      .map(
        (s) =>
          `<button type="button" class="cv2-pop__railbtn is-emo" data-sec="${esc(s.id)}" title="${esc(s.title)}">${s.icon}</button>`,
      )
      .join('');
  };

  const paintGrid = () => {
    const q = query.trim().toLowerCase();
    const source = emojiSections();
    const sections = q
      ? source.flatMap((s) => {
          if (s.title.toLowerCase().includes(q)) return [s];
          const hit = emojiGlyphs(s.list).filter((e) => e.includes(q));
          return hit.length ? [{ ...s, list: hit.join(' ') }] : [];
        })
      : source;
    if (!sections.length) {
      grid.innerHTML = `<div class="cv2-pop__none">Ничего не найдено</div>`;
      markRail('');
      return;
    }
    grid.innerHTML = sections
      .map(
        (s) =>
          `<div class="cv2-emoji__sec" id="cv2-emo-${esc(s.id)}" data-sec="${esc(s.id)}" data-title="${esc(s.title)}"><div class="cv2-emoji__title">${esc(s.title)}</div><div class="cv2-emoji__grid">${emojiGlyphs(s.list)
            .map((e) => `<button type="button" class="cv2-emoji__e" data-e="${e}">${e}</button>`)
            .join('')}</div></div>`,
      )
      .join('');
    markRail(q ? '' : sections[0].id);
  };

  const spy = () => {
    if (query.trim()) return;
    const secs = Array.from(grid.querySelectorAll<HTMLElement>('.cv2-emoji__sec'));
    let current = secs[0];
    for (const sec of secs) {
      if (sec.offsetTop - grid.scrollTop <= 28) current = sec;
    }
    if (!current) return;
    markRail(current.dataset.sec || '');
  };

  paintRail();
  paintGrid();
  grid.addEventListener('scroll', spy, { passive: true });
  find.addEventListener('input', () => {
    query = find.value;
    paintGrid();
    grid.scrollTop = 0;
  });

  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-pop-tab="stickers"]')) {
      openStickers(anchor);
      return;
    }
    const tab = t.closest<HTMLElement>('[data-sec]');
    if (tab && rail.contains(tab)) {
      if (query) {
        query = '';
        find.value = '';
        paintGrid();
      }
      const id = tab.dataset.sec || '';
      markRail(id);
      grid.querySelector(`#cv2-emo-${id}`)?.scrollIntoView({ block: 'start' });
      return;
    }
    const btn = t.closest<HTMLElement>('[data-e]');
    if (!btn) return;
    const emoji = btn.dataset.e!;
    pushRecent(emoji);
    onPick(emoji);
    if (!opts.keepOpen && !(e as MouseEvent).shiftKey) closeEmojiPicker();
  });
  const onDown = (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest('.cv2-emoji') || anchor.contains(t)) return;
    closeEmojiPicker();
    document.removeEventListener('mousedown', onDown, true);
  };
  window.setTimeout(() => document.addEventListener('mousedown', onDown, true), 0);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeEmojiPicker();
      document.removeEventListener('keydown', onKey, true);
    }
  };
  document.addEventListener('keydown', onKey, true);
}

// ===== Просмотр изображения =====

export function openLightbox(src: string, name = ''): void {
  const wrap = document.createElement('div');
  wrap.className = 'cv2-lightbox';
  wrap.innerHTML = `<img src="${esc(src)}" alt="${esc(name)}" draggable="false">
    <div class="cv2-lightbox__bar"><span>${esc(name)}</span><a href="${esc(src)}" data-href="${esc(src)}" class="cv2-lightbox__open">Открыть оригинал</a></div>`;
  layer().appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('is-on'));
  const close = () => {
    wrap.classList.remove('is-on');
    document.removeEventListener('keydown', onKey, true);
    window.setTimeout(() => wrap.remove(), 200);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  document.addEventListener('keydown', onKey, true);
  wrap.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.cv2-lightbox__open')) return;
    close();
  });
}
