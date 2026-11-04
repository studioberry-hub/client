// Звуки интерфейса: пак Zen из uisfx. Синтез в Web Audio, без загрузки mp3.
import { createUISFX, getCue, type CueName, type PlayOptions } from 'uisfx';

const UI_SFX_KEY = 'Undefined Client-ui-sfx';

const CONTROL_SELECTOR = [
  'button',
  'a',
  'summary',
  'label',
  'select',
  'input',
  'textarea',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="tab"]',
  '[role="option"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[data-tab]',
  '[data-settings-tab]',
  '[data-home-action]',
  '.build-run-item',
  '.sidebar-card',
  '.be-tab',
  '.tab-btn',
].join(',');

function readEnabled(): boolean {
  const stored = localStorage.getItem(UI_SFX_KEY);
  return stored === null ? true : stored === 'true';
}

// Пак Zen сам по себе тихий: hover 0.12, press 0.2. Поднимаем каждый сигнал, мастер оставляем на 1.
const UI_SFX_GAIN = 4;

const player = createUISFX({
  pack: 'zen',
  volume: 1,
  enabled: readEnabled(),
});

let bound = false;
let wheelQuietUntil = 0;
let preloaded = false;
let lastNavAt = 0;
const pressedCue = new WeakMap<HTMLElement, CueName>();
const longPressTimer = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();
const layerOpen = new WeakMap<HTMLElement, boolean>();

function play(cue: CueName, options?: PlayOptions): void {
  if (!player.isEnabled()) return;
  const base = options?.volume ?? getCue(cue).defaultVolume;
  player.play(cue, { ...options, volume: Math.min(1, base * UI_SFX_GAIN) });
  if (!preloaded) {
    preloaded = true;
    void player.preload([
      'hover', 'press', 'release', 'toggle-on', 'toggle-off',
      'open', 'close', 'select', 'success', 'error', 'notification', 'focus', 'typing',
    ]);
  }
}

export function playUiSfx(cue: CueName, options?: PlayOptions): void {
  play(cue, options);
}

export function setUiSfxEnabled(on: boolean): void {
  localStorage.setItem(UI_SFX_KEY, String(on));
  if (!on) player.stopAll();
  player.setEnabled(on);
}

export function playStatusCue(message: string): void {
  const cue = outcomeFromStatus(message);
  if (cue) play(cue);
}

export function playToastCue(message: string): void {
  play(outcomeFromStatus(message) || 'notification');
}

function outcomeFromStatus(message: string): CueName | null {
  const text = message.trim().toLowerCase();
  if (!text) return null;
  if (/ошиб|error|failed|не удалось|сбой|could not/.test(text)) return 'error';
  if (/предупреж|warning/.test(text)) return 'warning';
  if (/^установлен|^скачан|^сохранен|^сохранено|^успеш|^готово|success|installed successfully|saved/.test(text)) return 'success';
  return null;
}

function isDisabled(el: HTMLElement): boolean {
  if (el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true') return true;
  return Boolean(el.closest('[aria-disabled="true"]'));
}

function isToggleControl(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) return true;
  if (el.getAttribute('role') === 'switch' || el.getAttribute('role') === 'checkbox') return true;
  return Boolean(el.closest('label.toggle, .toggle, [role="switch"]'));
}

function isDragSurface(el: HTMLElement): boolean {
  return Boolean(el.closest('[data-vp="seek"], [data-vp="vol-track"], [data-vp="vol-hit"]'))
    || (el instanceof HTMLInputElement && el.type === 'range');
}

function controlFrom(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  if (target.closest('[data-uisfx-ignore]')) return null;
  const surface = target.closest('[data-vp="seek"], [data-vp="vol-track"], [data-vp="vol-hit"]');
  if (surface instanceof HTMLElement) return surface;
  const el = target.closest(CONTROL_SELECTOR);
  if (el instanceof HTMLElement) return el;
  return pointerControl(target);
}

// Карточки, пункты меню и кнопки шапки — это div, не button. Берём внешний блок с cursor:pointer.
function pointerControl(start: Element): HTMLElement | null {
  let found: HTMLElement | null = null;
  let node: Element | null = start;
  let depth = 0;
  while (node && node !== document.body && depth < 12) {
    if (!(node instanceof HTMLElement)) break;
    if (getComputedStyle(node).cursor === 'pointer') found = node;
    else if (found) break;
    node = node.parentElement;
    depth += 1;
  }
  return found;
}

function videoOf(el: HTMLElement): HTMLVideoElement | null {
  const host = el.closest('[data-vp="panel"]')?.parentElement;
  const video = host?.querySelector('video');
  return video instanceof HTMLVideoElement ? video : null;
}

function cueForPress(el: HTMLElement): CueName {
  if (isDisabled(el)) return 'blocked';
  const vp = el.getAttribute('data-vp') || el.closest('[data-vp]')?.getAttribute('data-vp') || '';
  const iv = el.getAttribute('data-iv') || '';
  if (vp === 'play') {
    const video = videoOf(el);
    return video && !video.paused ? 'pause' : 'play';
  }
  if (vp === 'pause') return 'pause';
  if (vp === 'close' || iv === 'close') return 'close';
  if (vp === 'seek' || el.closest('[data-vp="seek"]')) return 'seek';
  if (vp === 'volume' || vp === 'vol-track' || vp === 'vol-hit' || el.closest('[data-vp="vol-track"], [data-vp="vol-hit"]')) {
    return 'volume-change';
  }
  if (iv === 'prev') return 'back';
  if (iv === 'next') return 'forward';
  if (iv === 'zoom-in') return 'expand';
  if (iv === 'zoom-out') return 'collapse';
  if (el.matches('[data-like], [data-sf-like], .like-btn, [data-action="like"]')) return 'reaction';
  if (el.matches('.danger, .is-danger, [data-sf-delete], [data-sf-cdelete], [data-kick]')) return 'delete';
  if (el.matches('[data-i18n="common.cancel"], [data-i18n="btn.cancel"], [data-retry]')) {
    return el.matches('[data-retry]') ? 'retry' : 'cancel';
  }
  if (el.matches('.tab-btn, [data-tab], [data-settings-tab], [role="tab"], [role="option"], .build-run-item, .be-tab')) {
    return 'select';
  }
  if (el.id === 'build-run-play' || el.classList.contains('build-run-play')) return 'start';
  if (el.id === 'btn-close' || el.classList.contains('modal-close')) return 'close';
  return 'press';
}

function playPress(el: HTMLElement): void {
  if (isToggleControl(el)) return;
  if (el instanceof HTMLInputElement && (el.type === 'range' || el.type === 'text' || el.type === 'search' || el.type === 'password' || el.type === 'number' || el.type === 'email' || el.type === 'url')) return;
  if (el instanceof HTMLTextAreaElement) return;
  if (isDragSurface(el) && !(el instanceof HTMLButtonElement)) {
    pressedCue.set(el, cueForPress(el));
    return;
  }
  const cue = cueForPress(el);
  pressedCue.set(el, cue);
  play(cue, cue === 'volume-change' || cue === 'seek' ? { cooldownMs: 90 } : undefined);
  const prev = longPressTimer.get(el);
  if (prev) clearTimeout(prev);
  longPressTimer.set(el, setTimeout(() => {
    longPressTimer.delete(el);
    if (pressedCue.get(el) === 'press') play('long-press');
  }, 500));
}

function playRelease(el: HTMLElement): void {
  const timer = longPressTimer.get(el);
  if (timer) clearTimeout(timer);
  longPressTimer.delete(el);
  const cue = pressedCue.get(el);
  pressedCue.delete(el);
  if (cue === 'press') play('release');
  else if (cue === 'seek' || cue === 'volume-change') play(cue, { cooldownMs: 90 });
}

function onPointerOver(event: PointerEvent): void {
  if (event.pointerType === 'touch') return;
  if (performance.now() < wheelQuietUntil) return;
  const el = controlFrom(event.target);
  if (!el || isDisabled(el)) return;
  const from = event.relatedTarget;
  if (from instanceof Node && el.contains(from)) return;
  play('hover');
}

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return;
  const el = controlFrom(event.target);
  if (!el) return;
  playPress(el);
}

function onPointerUp(event: PointerEvent): void {
  const el = controlFrom(event.target);
  if (el && pressedCue.has(el)) {
    playRelease(el);
    forgetPress(el);
    return;
  }
  pressedNodes.forEach((node) => playRelease(node));
  pressedNodes.clear();
}

const pressedNodes = new Set<HTMLElement>();

function rememberPress(el: HTMLElement): void {
  pressedNodes.add(el);
}

function forgetPress(el: HTMLElement): void {
  pressedNodes.delete(el);
}

const hiddenToggle = new WeakSet<HTMLElement>();

function isLayer(el: HTMLElement): boolean {
  if (el.id === 'btn-menu' || el.classList.contains('tb-btn') || el.classList.contains('tb-tasks-btn')) return false;
  if (el.classList.contains('modal-overlay') || el.classList.contains('build-run-panel')) return true;
  const role = el.getAttribute('role');
  if (role === 'menu' || role === 'dialog' || role === 'listbox') return true;
  const cls = typeof el.className === 'string' ? el.className : '';
  return /menu|popup|dropdown|popover|select-wrap|\bctx\b/i.test(`${el.id} ${cls}`);
}

function rememberHiddenToggle(el: HTMLElement, className: string): void {
  const tokens = className.split(/\s+/);
  if (el.hasAttribute('hidden') || tokens.includes('hidden') || el.getAttribute('aria-hidden') === 'true') {
    hiddenToggle.add(el);
  }
}

function layerIsOpen(el: HTMLElement, className: string): boolean {
  const tokens = new Set(className.split(/\s+/).filter(Boolean));
  if (tokens.has('closing')) return false;
  const hidden = el.hasAttribute('hidden') || tokens.has('hidden') || el.getAttribute('aria-hidden') === 'true';
  if (hidden) return false;
  if (tokens.has('open') || tokens.has('is-open')) return true;
  if (el.classList.contains('modal-overlay')) return true;
  // Меню, которое прячут классом hidden, без отдельного open.
  return hiddenToggle.has(el);
}

function syncLayer(el: HTMLElement, oldClass: string | null): void {
  if (!isLayer(el)) return;
  const className = typeof el.className === 'string' ? el.className : '';
  rememberHiddenToggle(el, className);
  const now = layerIsOpen(el, className);
  let prev = layerOpen.get(el);
  if (prev === undefined && oldClass != null) prev = layerIsOpen(el, oldClass);
  layerOpen.set(el, now);
  if (prev === undefined || prev === now) return;
  if (performance.now() - lastNavAt < 80) return;
  lastNavAt = performance.now();
  play(now ? 'open' : 'close');
}

function seedLayers(): void {
  const nodes = document.querySelectorAll<HTMLElement>(
    '.modal-overlay, .build-run-panel, .stngs-select-wrap, [role="menu"], [role="dialog"], [role="listbox"], [id*="popup"], [id*="dropdown"], [id*="menu"], [class*="popup"], [class*="dropdown"], [class*="menu"], [class*="ctx"]',
  );
  nodes.forEach((el) => {
    const className = typeof el.className === 'string' ? el.className : '';
    rememberHiddenToggle(el, className);
    layerOpen.set(el, layerIsOpen(el, className));
  });
}

function bindUiSfx(): void {
  if (bound) return;
  bound = true;
  seedLayers();

  document.addEventListener('wheel', () => {
    wheelQuietUntil = performance.now() + 180;
  }, { capture: true, passive: true });
  document.addEventListener('pointerover', onPointerOver, true);
  document.addEventListener('pointerdown', (event) => {
    const el = controlFrom(event.target);
    if (el) rememberPress(el);
    onPointerDown(event);
  }, true);
  document.addEventListener('pointerup', onPointerUp, true);
  document.addEventListener('pointercancel', () => {
    pressedNodes.forEach((el) => playRelease(el));
    pressedNodes.clear();
  }, true);

  document.addEventListener('dblclick', (event) => {
    const el = controlFrom(event.target);
    if (!el || isToggleControl(el) || isDragSurface(el)) return;
    play('double-click');
  }, true);

  document.addEventListener('focusin', (event) => {
    const el = event.target;
    if (!(el instanceof HTMLElement)) return;
    if (!el.matches('input, textarea, select, [contenteditable="true"]')) return;
    if (el instanceof HTMLInputElement && /^(checkbox|radio|range|button|submit|file)$/.test(el.type)) return;
    if (!el.matches(':focus-visible')) return;
    play('focus');
  }, true);

  document.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === 'z') {
      play(event.shiftKey ? 'redo' : 'undo');
      return;
    }
    if ((event.ctrlKey || event.metaKey) && key === 'y') {
      play('redo');
      return;
    }
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const el = event.target instanceof HTMLElement ? controlFrom(event.target) : null;
    if (!el || el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
    if (isToggleControl(el)) return;
    rememberPress(el);
    playPress(el);
  }, true);

  document.addEventListener('keyup', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const el = event.target instanceof HTMLElement ? controlFrom(event.target) : null;
    if (!el || !pressedCue.has(el)) return;
    playRelease(el);
    forgetPress(el);
  }, true);

  document.addEventListener('change', (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.id === 'setting-ui-sfx') {
      if (target.checked) {
        setUiSfxEnabled(true);
        play('toggle-on');
      } else {
        play('toggle-off');
        window.setTimeout(() => {
          if (!target.checked) setUiSfxEnabled(false);
        }, 220);
      }
      return;
    }
    if (target instanceof HTMLInputElement && target.type === 'checkbox') {
      const toggle = isToggleControl(target);
      play(toggle ? (target.checked ? 'toggle-on' : 'toggle-off') : (target.checked ? 'check' : 'uncheck'));
      return;
    }
    if (target instanceof HTMLInputElement && target.type === 'radio') {
      play('select');
      return;
    }
    if (target instanceof HTMLInputElement && target.type === 'range') {
      const volume = /volume/i.test(target.id) || Boolean(target.closest('[data-vp="vol"], [data-vp="volume"]'));
      play(volume ? 'volume-change' : 'snap', { cooldownMs: 90 });
      return;
    }
    if (target instanceof HTMLSelectElement) play('select');
  }, true);

  document.addEventListener('input', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
    if (target instanceof HTMLInputElement && /^(checkbox|radio|range|button|submit|file|color)$/.test(target.type)) return;
    const inputType = event instanceof InputEvent ? event.inputType : '';
    if (inputType === 'insertFromPaste' || inputType === 'insertFromDrop') return;
    play('typing');
  }, true);

  document.addEventListener('copy', () => play('copy'), true);
  document.addEventListener('paste', () => play('paste'), true);
  document.addEventListener('dragstart', () => play('drag-start'), true);
  document.addEventListener('drop', () => play('drop'), true);
  document.addEventListener('dragend', (event) => {
    if (event.dataTransfer?.dropEffect === 'none') play('invalid-drop');
  }, true);
  document.addEventListener('invalid', () => play('error'), true);
  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.closest('#tab-messenger, .msgr')) return;
    play('send');
  }, true);
  document.addEventListener('toggle', (event) => {
    const details = event.target;
    if (details instanceof HTMLDetailsElement) play(details.open ? 'expand' : 'collapse');
  }, true);

  window.addEventListener('online', () => play('connect'));
  window.addEventListener('offline', () => play('disconnect'));
  document.addEventListener('visibilitychange', () => {
    play(document.hidden ? 'sleep' : 'wake');
  });

  const observer = new MutationObserver((records) => {
    for (const rec of records) {
      if (!(rec.target instanceof HTMLElement)) continue;
      if (rec.attributeName === 'aria-expanded') {
        const now = rec.target.getAttribute('aria-expanded') === 'true';
        const was = rec.oldValue === 'true';
        if (now === was) continue;
        if (performance.now() - lastNavAt < 80) continue;
        lastNavAt = performance.now();
        play(now ? 'expand' : 'collapse');
        continue;
      }
      syncLayer(rec.target, rec.attributeName === 'class' ? rec.oldValue : null);
    }
  });
  observer.observe(document.body, {
    subtree: true,
    attributes: true,
    attributeOldValue: true,
    attributeFilter: ['class', 'hidden', 'aria-expanded', 'aria-hidden'],
  });
}

export function initUiSfx(): void {
  bindUiSfx();
  player.setEnabled(readEnabled());
}
