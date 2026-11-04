// Зал аккаунтов: персонажи рисует Mine3D (тот же движок, что вкладка скинов).
import {
  VictoryAnimation,
  GlideAnimation,
  SkinLineup,
  SleepAnimation,
  TrailerRunAnimation,
  type LineupActor,
} from 'skinviewengine';
import { activeGamepadGlyphs, setAccountStagePad } from './gamepad';

/**
 * Длина шага «Бег»: нога skin3d ≈ 12, мах 1.05 и опора 0.48.
 * Полцикла клипа (фаза π) — один шаг, поэтому скорость тела = шаг × темп.
 */
const RUN_LEG = 12;
const RUN_SWING = 1.05;
const RUN_SUPPORT = 0.48;
const RUN_STEP = RUN_LEG * (Math.sin(RUN_SWING) + Math.sin(RUN_SUPPORT));
const RUN_PHASE_SCALE = 8.6;
const RUN_CLIP_SPEED = 1.12;
const RUN_TRAVEL = 140;
const RUN_VELOCITY = (RUN_CLIP_SPEED * RUN_PHASE_SCALE / Math.PI) * RUN_STEP;

/** Клип «Бег». Фазу задаёт пройденный путь, таймер клипа выключен. */
function hallRun(): TrailerRunAnimation {
  const anim = new TrailerRunAnimation();
  anim.speed = 0;
  anim.paused = true;
  return anim;
}

function syncRunPhase(anim: { progress: number } | null, traveled: number): void {
  if (!anim) return;
  const phase = (Math.max(0, traveled) / RUN_STEP) * Math.PI;
  anim.progress = phase / RUN_PHASE_SCALE;
}

export interface AccountStageSlot {
  id: string;
  name: string;
  detail: string;
  kind: 'account' | 'add';
  active?: boolean;
  skinUrl?: string | null;
  /** Оффлайн: одна плашка вместо трёх счётчиков */
  offline?: boolean;
  avatarUrl?: string | null;
  statusTitle?: string;
  statusSub?: string;
  statPosts?: string;
  statFriends?: string;
  statSkins?: string;
}

export interface AccountStageOptions {
  title: string;
  hint: string;
  slots: AccountStageSlot[];
  resolveSkin?: (id: string) => Promise<string | null>;
  onPick: (id: string) => void;
  onAdd: () => void;
  onClose?: () => void;
  activeLabel?: string;
  introTitle?: string;
  introSub?: string;
  addNote?: { title: string; text: string; image: string };
  padHints?: { move: string; pick: string; close: string };
}

/** Бегут вправо: прошлый −π/2 смотрел спиной по ходу. */
const RUN_YAW = Math.PI / 2;
const SPACING = 34;

interface SlotView {
  slot: AccountStageSlot;
  actor: LineupActor;
  label: HTMLButtonElement;
  targetX: number;
  runFrom: number;
  runAt: number;
  runDur: number;
  arrived: boolean;
  mode: 'run' | 'sleep' | 'float' | 'hero';
}

let current: { close: () => void } | null = null;

export function closeAccountStage(): void {
  current?.close();
  current = null;
}

export function openAccountStage(options: AccountStageOptions): void {
  closeAccountStage();
  const root = document.createElement('div');
  root.className = 'acc-stage';
  root.innerHTML = `
    <button type="button" class="acc-stage__close" aria-label="Close">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path d="M1 1L11 11M11 1L1 11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
      </svg>
    </button>
    <button type="button" class="acc-stage__nav acc-stage__nav--prev" aria-label="Previous"></button>
    <button type="button" class="acc-stage__nav acc-stage__nav--next" aria-label="Next"></button>
    <div class="acc-stage__intro">
      <div class="acc-stage__intro-title"></div>
      <div class="acc-stage__intro-sub"></div>
    </div>
    <div class="acc-stage__head">
      <div class="acc-stage__title"></div>
      <div class="acc-stage__hint"></div>
    </div>
    <canvas class="acc-stage__canvas"></canvas>
    <div class="acc-pad" hidden>
      <div class="acc-pad__item">
        <img class="acc-pad__icon" data-pad="left" alt="">
        <img class="acc-pad__icon" data-pad="right" alt="">
        <span data-pad-label="move"></span>
      </div>
      <div class="acc-pad__item">
        <img class="acc-pad__icon" data-pad="confirm" alt="">
        <span data-pad-label="pick"></span>
      </div>
      <div class="acc-pad__item">
        <img class="acc-pad__icon" data-pad="cancel" alt="">
        <span data-pad-label="close"></span>
      </div>
    </div>
    <aside class="acc-note" hidden>
      <div class="acc-note__media"><img alt=""></div>
      <div class="acc-note__body">
        <div class="acc-note__title"></div>
        <div class="acc-note__text"></div>
      </div>
    </aside>
    <div class="acc-stage__veil"></div>
  `;
  const titleEl = root.querySelector<HTMLElement>('.acc-stage__title');
  const hintEl = root.querySelector<HTMLElement>('.acc-stage__hint');
  const introEl = root.querySelector<HTMLElement>('.acc-stage__intro');
  const introTitleEl = root.querySelector<HTMLElement>('.acc-stage__intro-title');
  const introSubEl = root.querySelector<HTMLElement>('.acc-stage__intro-sub');
  const headEl = root.querySelector<HTMLElement>('.acc-stage__head');
  if (titleEl) titleEl.textContent = options.title;
  if (hintEl) hintEl.textContent = options.hint;
  if (introTitleEl) introTitleEl.textContent = options.introTitle || '';
  if (introSubEl) introSubEl.textContent = options.introSub || '';
  const padBar = root.querySelector<HTMLElement>('.acc-pad');
  if (padBar && options.padHints) {
    const moveLabel = padBar.querySelector('[data-pad-label="move"]');
    const pickLabel = padBar.querySelector('[data-pad-label="pick"]');
    const closeLabel = padBar.querySelector('[data-pad-label="close"]');
    if (moveLabel) moveLabel.textContent = options.padHints.move;
    if (pickLabel) pickLabel.textContent = options.padHints.pick;
    if (closeLabel) closeLabel.textContent = options.padHints.close;
  }
  const paintPadBar = (): void => {
    if (!padBar) return;
    const glyphs = activeGamepadGlyphs();
    if (!glyphs) {
      padBar.hidden = true;
      return;
    }
    padBar.hidden = false;
    (['left', 'right', 'confirm', 'cancel'] as const).forEach((key) => {
      const img = padBar.querySelector<HTMLImageElement>(`[data-pad="${key}"]`);
      const src = glyphs[key];
      if (img && img.getAttribute('src') !== src) img.src = src;
    });
  };
  const noteEl = root.querySelector<HTMLElement>('.acc-note');
  const noteImg = noteEl?.querySelector('img');
  const noteTitle = noteEl?.querySelector<HTMLElement>('.acc-note__title');
  const noteText = noteEl?.querySelector<HTMLElement>('.acc-note__text');
  if (options.addNote && noteEl && noteTitle && noteText) {
    noteEl.hidden = false;
    noteTitle.textContent = options.addNote.title;
    noteText.replaceChildren();
    options.addNote.text.split(/\n{2,}/).forEach((part) => {
      const paragraph = part.trim();
      if (!paragraph) return;
      const p = document.createElement('p');
      p.textContent = paragraph;
      noteText.appendChild(p);
    });
    if (noteImg) noteImg.src = options.addNote.image;
  }
  document.body.appendChild(root);
  requestAnimationFrame(() => root.classList.add('is-shown'));

  const canvas = root.querySelector('canvas') as HTMLCanvasElement;
  const views: SlotView[] = [];
  let focused: SlotView | null = null;
  let scroll = 0;
  let scrollTarget = 0;
  let dragging = false;
  let dragMoved = false;
  let dragLastX = 0;
  let startedAt = 0;
  let runStarted = false;
  const introAudio = new Audio('../../assets/sounds/run_choose_account.mp3');
  const runAudio = new Audio('../../assets/sounds/choose_account.mp3');
  introAudio.preload = 'auto';
  runAudio.preload = 'auto';
  const selectedAudio = new Audio('../../assets/sounds/selected_account.mp3');
  selectedAudio.preload = 'auto';

  let actorsShown = false;
  let leaving: 'pick' | 'dismiss' | 'add' | null = null;
  let leaveAt = 0;
  let pickView: SlotView | null = null;
  let leaveFadeTimer = 0;
  let leaveDoneTimer = 0;
  let noteTimer = 0;
  const lineup = new SkinLineup(canvas, {
    onFrame: (dt) => {
      if (!runStarted) return;
      if (!actorsShown) {
        actorsShown = true;
        for (const view of views) {
          view.actor.wrapper.visible = true;
          if (view.actor.animation) view.actor.animation.paused = false;
        }
      }
      const now = (performance.now() - startedAt) / 1000;
      scroll += (scrollTarget - scroll) * Math.min(1, dt * 8);
      lineup.rig.position.x = scroll;
      for (const view of views) {
        const celebrating = leaving === 'pick' && view === pickView;
        if (!view.arrived && !celebrating) {
          const local = Math.max(0, now - view.runAt);
          const u = Math.min(1, local / view.runDur);
          const traveled = (view.targetX - view.runFrom) * u;
          view.actor.wrapper.position.x = view.runFrom + traveled;
          view.actor.wrapper.rotation.y = RUN_YAW;
          syncRunPhase(view.actor.animation, traveled);
          if (u >= 1) view.arrived = true;
        }
        if (view.arrived && !celebrating) {
          view.actor.wrapper.position.x = view.targetX;
          const yaw = view.actor.wrapper.rotation.y;
          view.actor.wrapper.rotation.y = yaw + (0 - yaw) * Math.min(1, dt * 8);
        }
        if (celebrating) {
          view.actor.wrapper.position.x = view.targetX;
          const u = Math.min(1, (performance.now() - leaveAt) / 1150);
          const turn = Math.min(1, u / 0.85);
          const eased = 1 - Math.pow(1 - turn, 3);
          view.actor.wrapper.rotation.y = eased * Math.PI * 2;
          const flash = u < 0.35 ? Math.sin((u / 0.35) * Math.PI) : 0;
          view.actor.setEmissive(flash * 2.8);
          lineup.setBloomBoost(flash);
        }
        const mode: SlotView['mode'] = celebrating
          ? 'hero'
          : !view.arrived ? 'run' : view === focused ? 'float' : 'sleep';
        if (view.mode !== mode) {
          view.mode = mode;
          if (mode === 'run') {
            const run = hallRun();
            run.paused = false;
            view.actor.setAnimation(run);
          } else if (mode === 'hero') {
            view.actor.setAnimation(new VictoryAnimation());
          } else {
            view.actor.setAnimation(mode === 'float' ? new GlideAnimation() : new SleepAnimation());
          }
        }
        const point = lineup.projectSlot(view.actor);
        view.label.style.left = `${point.x}px`;
        view.label.style.top = `${point.y + 12}px`;
        view.label.style.visibility = point.visible ? 'visible' : 'hidden';
        view.label.classList.toggle('is-focus', view === focused);
      }
      if (noteEl && focused?.slot.kind === 'add') {
        const point = lineup.projectSlot(focused.actor);
        const cardW = noteEl.offsetWidth || 300;
        const cardH = noteEl.offsetHeight || 320;
        // Руки в T-позе шире корпуса: карточка начинается заметно правее силуэта.
        const left = Math.max(16, Math.min(root.clientWidth - cardW - 16, point.x + 280));
        const centerY = point.y - 130;
        const top = Math.max(cardH / 2 + 16, Math.min(root.clientHeight - cardH / 2 - 16, centerY));
        noteEl.style.left = `${left}px`;
        noteEl.style.top = `${top}px`;
      }
      lineup.setFocus(focused?.actor ?? null);
      paintPadBar();
    },
  });

  const count = Math.max(1, options.slots.length);
  options.slots.forEach((slot, index) => {
    const actor = lineup.addActor();
    const targetX = (index - (count - 1) / 2 + 1) * SPACING;
    const label = document.createElement('button');
    label.type = 'button';
    if (slot.kind === 'add') {
      label.className = 'acc-stage__label';
      label.innerHTML = '<div class="acc-stage__name"></div><div class="acc-stage__detail"></div><div class="acc-stage__badge"></div>';
      label.querySelector('.acc-stage__name')!.textContent = slot.name;
      label.querySelector('.acc-stage__detail')!.textContent = slot.detail;
      const badge = label.querySelector<HTMLElement>('.acc-stage__badge');
      if (badge) badge.hidden = true;
    } else {
      label.className = 'acc-card';
      label.dataset.id = slot.id;
      label.innerHTML = `
        <img class="acc-card__avatar" alt="">
        <div class="acc-card__name"></div>
        <div class="acc-card__type"></div>
        <div class="acc-card__status">
          <div class="acc-card__status-title"></div>
          <div class="acc-card__status-sub"></div>
        </div>
        <div class="acc-card__stats">
          <div class="acc-card__stat"><b class="acc-card__posts">0</b><span class="acc-card__posts-label"></span></div>
          <div class="acc-card__stat"><b class="acc-card__friends">0</b><span class="acc-card__friends-label"></span></div>
          <div class="acc-card__stat"><b class="acc-card__skins">0</b><span class="acc-card__skins-label"></span></div>
        </div>
      `;
      label.querySelector('.acc-card__name')!.textContent = slot.name;
      label.querySelector('.acc-card__type')!.textContent = slot.detail;
      const avatar = label.querySelector<HTMLImageElement>('.acc-card__avatar');
      if (avatar && slot.avatarUrl) avatar.src = slot.avatarUrl;
      const status = label.querySelector<HTMLElement>('.acc-card__status');
      const stats = label.querySelector<HTMLElement>('.acc-card__stats');
      if (slot.offline) {
        stats?.setAttribute('hidden', '');
        label.querySelector('.acc-card__status-title')!.textContent = slot.statusTitle || '';
        label.querySelector('.acc-card__status-sub')!.textContent = slot.statusSub || '';
      } else {
        status?.setAttribute('hidden', '');
        label.querySelector('.acc-card__posts-label')!.textContent = slot.statPosts || '';
        label.querySelector('.acc-card__friends-label')!.textContent = slot.statFriends || '';
        label.querySelector('.acc-card__skins-label')!.textContent = slot.statSkins || '';
      }
    }
    root.appendChild(label);
    const runFrom = targetX - RUN_TRAVEL;
    const runDur = RUN_TRAVEL / RUN_VELOCITY;
    actor.setAnimation(hallRun());
    actor.wrapper.visible = false;
    actor.wrapper.position.x = runFrom;
    actor.wrapper.rotation.y = RUN_YAW;
    label.style.visibility = 'hidden';
    views.push({
      slot,
      actor,
      label,
      targetX,
      runFrom,
      runAt: 0,
      runDur,
      arrived: false,
      mode: 'run',
    });
  });

  scroll = 0;
  scrollTarget = 0;
  const focusHome = views[0].targetX;
  let selectedIndex = 0;

  const resize = (): void => lineup.setSize(root.clientWidth, root.clientHeight);
  resize();
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(root);

  const selectIndex = (index: number): void => {
    if (leaving) return;
    const next = Math.max(0, Math.min(views.length - 1, index));
    selectedIndex = next;
    focused = views[next];
    scrollTarget = focusHome - views[next].targetX;
    armAddNote();
  };

  /** Карточка «добавить» выезжает справа через 2 с удержания фокуса. */
  function armAddNote(): void {
    window.clearTimeout(noteTimer);
    noteEl?.classList.remove('is-shown');
    if (!runStarted || leaving || focused?.slot.kind !== 'add') return;
    noteTimer = window.setTimeout(() => {
      if (closed || leaving || focused?.slot.kind !== 'add') return;
      noteEl?.classList.add('is-shown');
    }, 2000);
  }

  const activate = (view: SlotView): void => {
    if (leaving || !runStarted) return;
    if (view.slot.kind === 'add') beginLeave('add', view);
    else beginLeave('pick', view);
  };

  const viewFromActor = (actor: LineupActor | null): SlotView | null => {
    if (!actor) return null;
    return views.find((view) => view.actor === actor) ?? null;
  };

  let dragSteps = 0;

  canvas.addEventListener('pointerdown', (event) => {
    dragging = true;
    dragMoved = false;
    dragSteps = 0;
    dragLastX = event.clientX;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (dragging) {
      const dx = event.clientX - dragLastX;
      dragLastX = event.clientX;
      if (Math.abs(dx) > 2) dragMoved = true;
      dragSteps += dx;
      if (Math.abs(dragSteps) >= 48) {
        selectIndex(selectedIndex + (dragSteps > 0 ? -1 : 1));
        dragSteps = 0;
      }
      return;
    }
    const hit = viewFromActor(lineup.pick(event.clientX, event.clientY));
    if (hit) selectIndex(views.indexOf(hit));
  });
  canvas.addEventListener('pointerup', (event) => {
    if (!dragging) return;
    dragging = false;
    if (!dragMoved) {
      const view = viewFromActor(lineup.pick(event.clientX, event.clientY));
      if (view) activate(view);
    }
    canvas.releasePointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointerleave', () => {
    dragging = false;
  });
  let wheelSteps = 0;
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    wheelSteps += delta;
    if (Math.abs(wheelSteps) < 28) return;
    selectIndex(selectedIndex + (wheelSteps > 0 ? 1 : -1));
    wheelSteps = 0;
  }, { passive: false });

  views.forEach((view) => {
    view.label.addEventListener('pointerenter', () => selectIndex(views.indexOf(view)));
    view.label.addEventListener('click', () => activate(view));
    if (view.slot.skinUrl) void lineup.setSkin(view.actor, view.slot.skinUrl);
    else if (options.resolveSkin && view.slot.kind === 'account') {
      void options.resolveSkin(view.slot.id).then((url) => {
        if (url) void lineup.setSkin(view.actor, url);
      });
    }
  });

  root.querySelector('.acc-stage__nav--prev')?.addEventListener('click', () => selectBy(-1));
  root.querySelector('.acc-stage__nav--next')?.addEventListener('click', () => selectBy(1));

  const selectBy = (dir: -1 | 1): void => {
    selectIndex(selectedIndex + dir);
  };
  setAccountStagePad({
    move: selectBy,
    confirm: () => {
      if (focused) activate(focused);
    },
  });
  if (views[0]) selectIndex(0);

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') requestClose();
    else if (event.key === 'ArrowLeft') selectBy(-1);
    else if (event.key === 'ArrowRight') selectBy(1);
  };
  document.addEventListener('keydown', onKey);
  root.querySelector('.acc-stage__close')?.addEventListener('click', () => requestClose());

  lineup.start();
  let introDone = false;
  let closed = false;
  const beginRun = (): void => {
    if (closed || introDone) return;
    introDone = true;
    introEl?.classList.add('is-out');
    headEl?.classList.add('is-shown');
    root.classList.add('is-ready');
    window.setTimeout(() => {
      if (closed) return;
      runStarted = true;
      startedAt = performance.now();
      armAddNote();
      void runAudio.play().catch(() => {});
    }, 620);
  };
  introAudio.addEventListener('ended', beginRun);
  const introFallback = window.setTimeout(beginRun, 7000);
  void introAudio.play().catch(() => {
    window.setTimeout(beginRun, 2200);
  });

  function teardown(): void {
    if (closed) return;
    closed = true;
    window.clearTimeout(introFallback);
    window.clearTimeout(leaveFadeTimer);
    window.clearTimeout(leaveDoneTimer);
    window.clearTimeout(noteTimer);
    introAudio.pause();
    runAudio.pause();
    resizeObserver.disconnect();
    document.removeEventListener('keydown', onKey);
    setAccountStagePad(null);
    lineup.dispose();
    root.remove();
    options.onClose?.();
    if (current?.close === teardown) current = null;
  }

  function finishLeave(): void {
    const reason = leaving;
    const picked = pickView;
    teardown();
    if (reason === 'pick' && picked) options.onPick(picked.slot.id);
    else if (reason === 'add') options.onAdd();
  }

  /** Выбор — вспышка, оборот и «Руки вверх». Затемнение меню — через 4 с. */
  function beginLeave(reason: 'pick' | 'dismiss' | 'add', view?: SlotView): void {
    if (closed || leaving) return;
    leaving = reason;
    pickView = view ?? null;
    window.clearTimeout(noteTimer);
    noteEl?.classList.remove('is-shown');
    leaveAt = performance.now();
    introAudio.pause();
    runAudio.pause();
    selectedAudio.currentTime = 0;
    void selectedAudio.play().catch(() => {});
    const dimDelay = 4000;
    const fadeDelay = 4600;
    window.setTimeout(() => {
      if (!closed) root.classList.add('is-dimming');
    }, dimDelay);
    leaveFadeTimer = window.setTimeout(() => {
      if (!closed) root.classList.add('is-leaving');
    }, fadeDelay);
    leaveDoneTimer = window.setTimeout(() => finishLeave(), fadeDelay + 480);
  }

  function requestClose(): void {
    if (closed || leaving) return;
    beginLeave('dismiss');
  }

  current = { close: teardown };
}
