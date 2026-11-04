// Точка входа чатов v2 (Discord-стиль): монтирование в #tab-chats, перерисовка по регионам, контроллер для bootstrap.
import { IC, channelMark } from './icons';
import {
  ALL,
  S,
  activeKey,
  invalidate,
  loadDetail,
  loadEndpoints,
  loadFriends,
  loadInbox,
  loadLists,
  loadMe,
  loadMembers,
  allTextChannels,
  allVoiceChannels,
  roomById,
  saveUi,
  setRenderer,
  totalUnread,
  userOf,
  type Region,
} from './store';
import { C, V, callAccept, callDecline, rtcInit, rtcShutdown, sampleVoicePing } from './rtc';
import { bindTooltips, layer, toast } from './overlays';
import { assetUrl, avatarHtml, esc, sameId } from './util';
import { bindRailDnd, renderRail } from './views/rail';
import { groupIcon, renderHomeList, renderHomeTop, renderServerList, renderServerTop, renderVoicePanel, tickTimers } from './views/sidebar';
import { worldsRev } from './worlds';
import { lanHostStamp } from '../messenger/ui';
import { probeWorldPings, renderFriendsBody, renderFriendsHead, renderInvitesBody, renderInvitesHead, renderWorldsBody, renderWorldsHead } from './views/home';
import { chatShell, feedCtx, feedEl, paintFeed, renderChannelHead, renderComposer, renderDmHead, renderGroupHead, renderVoiceHead } from './views/chat';
import { refreshUserPopout, renderAside } from './views/aside';
import { renderDmCallArea, renderGroupCallArea, renderVoiceStage } from './views/voice';
import { setModalHooks } from './views/modals';
import { ack, forwardTo, openDm, openFriends, openGroup, openInvites, openServer, wsSend } from './nav';
import { autosize, bindActions, focusComposer, focusEditBox, rememberHome } from './actions';
import { chatsTabActive, onWs, setPresence } from './ws';
import type { ChatsApi, ChatsController, HomeChatPreview } from './types';

// ===== Разметка корня =====

const ROOT_HTML = `
  <nav class="cv2-rail" id="cv2-rail" aria-label="Серверы"></nav>
  <div class="cv2-body">
    <aside class="cv2-side" id="cv2-side">
      <div class="cv2-side__top" id="cv2-side-top"></div>
      <div class="cv2-side__scroll" id="cv2-side-list"></div>
      <div class="cv2-side__voice" id="cv2-side-voice"></div>
    </aside>
    <div class="cv2-scrim" data-act="toggle-sidebar"></div>
    <main class="cv2-main" id="cv2-main">
      <header class="cv2-head" id="cv2-head"></header>
      <div class="cv2-content" id="cv2-content"></div>
    </main>
  </div>`;

let root: HTMLElement;
const $ = (id: string) => document.getElementById(id);

// ===== Сигнатура основного экрана =====

/** Пока сигнатура не меняется, лента и поле ввода не пересоздаются (фокус, прокрутка, черновик целы). */
function mainSig(): string {
  const v = S.view;
  if (v.kind === 'friends') return `friends:${v.tab}:${worldsRev()}`;
  if (v.kind === 'worlds') return `worlds:${worldsRev()}:${lanHostStamp()}`;
  if (v.kind === 'invites') return 'invites';
  if (v.kind === 'dm') return `dm:${v.peerId}`;
  if (v.kind === 'group') return `group:${v.roomId}:${S.details.has(v.roomId) ? 1 : 0}`;
  if (v.voiceId) return `voice:${v.roomId}:${v.voiceId}`;
  return `ch:${v.roomId}:${v.channelId ?? 0}:${S.details.has(v.roomId) ? 1 : 0}`;
}

let paintedSig = '';
let paintedFeedKey = '';

// ===== Регионы =====

function paintLayout(): void {
  const v = S.view;
  root.dataset.view = v.kind;
  root.classList.toggle('is-side-open', S.ui.mobileSidebar);
}

function paintRail(): void {
  const el = $('cv2-rail');
  if (!el) return;
  const list = el.querySelector('#cv2-rail-list');
  const top = list?.scrollTop ?? 0;
  el.innerHTML = renderRail();
  const nl = el.querySelector('#cv2-rail-list');
  if (nl) nl.scrollTop = top;
}

function homeMode(): boolean {
  const k = S.view.kind;
  return k === 'friends' || k === 'worlds' || k === 'invites' || k === 'dm' || k === 'group';
}

function paintSidebar(): void {
  const top = $('cv2-side-top');
  const list = $('cv2-side-list');
  if (!top || !list) return;
  const scroll = list.scrollTop;
  const v = S.view;
  if (homeMode()) {
    top.innerHTML = renderHomeTop();
    list.innerHTML = renderHomeList();
  } else if (v.kind === 'server') {
    top.innerHTML = renderServerTop(v.roomId);
    list.innerHTML = renderServerList(v.roomId);
  }
  list.scrollTop = scroll;
  applyChannelBanner();
}

function paintBanner(el: HTMLElement | null, url: string): void {
  if (!el) return;
  el.classList.toggle('has-banner', Boolean(url));
  if (url) el.style.setProperty('--cv2-banner', `url("${url.replace(/"/g, '%22')}")`);
  else el.style.removeProperty('--cv2-banner');
}

/** Обложка только в шапке списка каналов (16:9), не на всю ширину чата. Своя обложка канала заменяет серверную. */
function applyChannelBanner(): void {
  const v = S.view;
  paintBanner($('cv2-head'), '');
  if (v.kind !== 'server') {
    paintBanner($('cv2-side'), '');
    return;
  }
  const detail = S.details.get(v.roomId);
  const roomUrl = assetUrl(detail?.banner_url || roomById(v.roomId)?.banner_url);
  let channelUrl = '';
  if (v.channelId && !v.voiceId) {
    const ch = allTextChannels(detail).find((c) => c.id === v.channelId);
    if (ch?.banner_url) channelUrl = assetUrl(ch.banner_url);
  }
  paintBanner($('cv2-side'), channelUrl || roomUrl);
}

/** Перерисовка блока голоса/звонка: анимация появления — только при переходе «пусто → есть». */
function paintSteady(el: HTMLElement, html: string): void {
  if (el.dataset.html === html) return;
  const had = Boolean(el.firstElementChild);
  el.dataset.html = html;
  el.innerHTML = html;
  if (had) el.firstElementChild?.classList.add('is-steady');
}

function paintVoice(): void {
  const el = $('cv2-side-voice');
  if (el) paintSteady(el, renderVoicePanel());
  paintRing();
  paintPill();
}

function paintHeader(): void {
  const el = $('cv2-head');
  if (!el) return;
  const v = S.view;
  if (v.kind === 'friends') el.innerHTML = renderFriendsHead(v.tab);
  else if (v.kind === 'worlds') el.innerHTML = renderWorldsHead();
  else if (v.kind === 'invites') el.innerHTML = renderInvitesHead();
  else if (v.kind === 'dm') el.innerHTML = renderDmHead(v.peerId);
  else if (v.kind === 'group') el.innerHTML = renderGroupHead(v.roomId);
  else if (v.voiceId) el.innerHTML = renderVoiceHead(v.roomId, v.voiceId);
  else if (v.channelId) el.innerHTML = renderChannelHead(v.roomId, v.channelId);
  else el.innerHTML = '';
  // Кнопка сайдбара видна только в узкой раскладке (через CSS)
  el.insertAdjacentHTML('afterbegin', `<button type="button" class="cv2-ibtn is-menu" data-act="toggle-sidebar" aria-label="Каналы и беседы">${IC.chevronRight(18)}</button>`);
  // Поле поиска в шапке не должно терять фокус при перерисовке
  restoreFocus(el);
  applyChannelBanner();
  syncPopoutChrome();
}

function callAreaHtml(): string {
  const v = S.view;
  if (v.kind === 'dm') return renderDmCallArea(v.peerId);
  if (v.kind === 'group') return renderGroupCallArea(v.roomId);
  return '';
}

function paintCall(): void {
  const el = $('cv2-call');
  if (!el) return;
  const html = callAreaHtml();
  paintSteady(el, html);
  el.classList.toggle('is-on', Boolean(html));
}

function paintAside(): void {
  const el = $('cv2-aside');
  if (!el) return;
  const html = renderAside();
  el.innerHTML = html;
  el.classList.toggle('is-open', Boolean(html));
  el.closest('.cv2-chat')?.classList.toggle('has-aside', Boolean(html));
}

type FocusMemo = { input: string; start: number | null; end: number | null } | null;
let focusMemo: FocusMemo = null;

function memoFocus(): void {
  const a = document.activeElement as HTMLInputElement | null;
  focusMemo = a && root.contains(a) && a.dataset?.input ? { input: a.dataset.input, start: a.selectionStart, end: a.selectionEnd } : null;
}

function restoreFocus(scope: HTMLElement): void {
  if (!focusMemo) return;
  const el = scope.querySelector<HTMLInputElement>(`[data-input="${focusMemo.input}"]`);
  if (!el || document.activeElement === el) return;
  el.focus();
  if (focusMemo.start != null) el.setSelectionRange(focusMemo.start, focusMemo.end ?? focusMemo.start);
}

/** Возвращает true, если экран построен заново (лента уже отрисована). */
function paintMain(): boolean {
  const content = $('cv2-content');
  if (!content) return false;
  const sig = mainSig();
  const v = S.view;
  paintHeader();
  const isChat = v.kind === 'dm' || v.kind === 'group' || (v.kind === 'server' && !v.voiceId && v.channelId);
  if (sig === paintedSig && isChat && $('cv2-feed')) {
    paintCall();
    paintAside();
    return false;
  }
  const prevSig = paintedSig;
  paintedSig = sig;
  content.classList.remove('is-enter');
  if (v.kind === 'friends') content.innerHTML = renderFriendsBody(v.tab);
  else if (v.kind === 'worlds') {
    content.innerHTML = renderWorldsBody();
    probeWorldPings();
  }
  else if (v.kind === 'invites') content.innerHTML = renderInvitesBody();
  else if (v.kind === 'server' && v.voiceId) content.innerHTML = renderVoiceStage(v.roomId, v.voiceId);
  else if (v.kind === 'server' && !v.channelId) {
    content.innerHTML = S.details.has(v.roomId)
      ? `<div class="cv2-empty is-big"><div class="cv2-empty__art">${channelMark('text', 48)}</div><div class="cv2-empty__title">Здесь пока нет текстовых каналов</div><div class="cv2-empty__text">Создайте канал, чтобы начать общение.</div></div>`
      : '<div class="cv2-spinner is-center"></div>';
  } else {
    const ctx = feedCtx();
    if (!ctx) {
      content.innerHTML = '<div class="cv2-spinner is-center"></div>';
      paintedSig = '';
      return true;
    }
    content.innerHTML = chatShell(ctx, renderAside());
    paintCall();
    paintedFeedKey = '';
    paintFeedNow();
    const ta = content.querySelector<HTMLTextAreaElement>('[data-input="composer"]');
    if (ta) autosize(ta);
    // Как в Discord: при открытии беседы курсор сразу в поле ввода
    if (prevSig.split(':')[0] !== '' && chatsTabActive()) focusComposer();
  }
  // Анимация входа только при смене экрана, а не при каждом обновлении
  if (prevSig.split(':').slice(0, 2).join(':') !== sig.split(':').slice(0, 2).join(':')) {
    void content.offsetWidth;
    content.classList.add('is-enter');
  }
  restoreFocus(content);
  return true;
}

function paintFeedNow(): void {
  const ctx = feedCtx();
  if (!ctx || !feedEl()) return;
  paintFeed(ctx, paintedFeedKey === ctx.key ? 'keep' : 'restore');
  paintedFeedKey = ctx.key;
  if (S.ui.editing?.key === ctx.key) requestAnimationFrame(focusEditBox);
}

function paintComposer(): void {
  const ctx = feedCtx();
  const old = root.querySelector<HTMLElement>('.cv2-composer');
  if (!ctx || !old) return;
  const ta = old.querySelector<HTMLTextAreaElement>('[data-input="composer"]');
  if (ta) {
    if (ta.value) S.ui.drafts.set(ctx.key, ta.value);
    else S.ui.drafts.delete(ctx.key);
  }
  const tmp = document.createElement('div');
  tmp.innerHTML = renderComposer(ctx);
  const fresh = tmp.firstElementChild as HTMLElement | null;
  if (!fresh) return;
  old.replaceWith(fresh);
  const nta = fresh.querySelector<HTMLTextAreaElement>('[data-input="composer"]');
  if (nta) {
    autosize(nta);
    focusComposer();
  }
}

function paintBadge(): void {
  const n = totalUnread();
  const el = $('gs-chats-badge');
  if (el) {
    el.textContent = n > 99 ? '99+' : String(n);
    el.hidden = n === 0;
    el.classList.toggle('hidden', n === 0);
  }
}

// ===== Плавающие элементы: входящий звонок и плашка голоса =====

function paintRing(): void {
  let el = document.getElementById('cv2-ring');
  const show = C.phase === 'incoming' && C.peerId != null && !(chatsTabActive() && S.view.kind === 'dm' && sameId(S.view.peerId, C.peerId));
  if (!show) {
    if (el) {
      el.classList.remove('is-on');
      const dead = el;
      window.setTimeout(() => dead.remove(), 200);
      el.id = '';
    }
    return;
  }
  const u = userOf(C.peerId);
  if (!el) {
  el = document.createElement('div');
  el.id = 'cv2-ring';
  el.className = 'cv2-ring';
  el.innerHTML = `<div class="cv2-ring__ava"></div>
    <div class="cv2-ring__name"></div>
    <div class="cv2-ring__sub">Входящий звонок…</div>
    <div class="cv2-ring__btns">
      <button type="button" class="cv2-cbtn is-hangup" data-ring="decline" title="Отклонить">${IC.phoneOff(22)}</button>
      <button type="button" class="cv2-cbtn is-accept" data-ring="accept" title="Принять">${IC.phone(22)}</button>
    </div>`;
  layer().appendChild(el);
  const peer = C.peerId!;
  el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-ring]');
    if (!b) return;
    if (b.dataset.ring === 'accept') {
      document.querySelector<HTMLElement>('.tab-btn[data-tab="messenger"]')?.click();
      void callAccept().then(() => openDm(peer));
    } else void callDecline();
  });
  requestAnimationFrame(() => el?.classList.add('is-on'));
  }
  const ava = el.querySelector('.cv2-ring__ava');
  const name = el.querySelector('.cv2-ring__name');
  if (ava) ava.innerHTML = avatarHtml(u.username, u.avatar_url, u.avatar_color, { size: 80 });
  if (name) name.textContent = u.username;
}

function paintPill(): void {
  let el = document.getElementById('cv2-pill');
  const active = Boolean(V.channelId) || C.phase === 'active' || C.phase === 'connecting' || C.phase === 'outgoing';
  if (!active || chatsTabActive()) {
    el?.remove();
    return;
  }
  if (!el) {
    const btn = document.createElement('button');
    btn.type = 'button';
    el = btn;
    el.id = 'cv2-pill';
    el.className = 'cv2-floatpill';
    el.addEventListener('click', () => document.querySelector<HTMLElement>('.tab-btn[data-tab="chats"]')?.click());
    layer().appendChild(el);
  }
  const room = roomById(V.roomId);
  const label = V.channelId ? (room?.kind === 'group' ? `Звонок · ${room.name}` : room?.name || 'Голосовой канал') : `Звонок · ${userOf(C.peerId).username}`;
  el.innerHTML = `<span class="cv2-floatpill__dot"></span>${IC.speaker(14)}<span>${esc(label)}</span>`;
}

// ===== Планировщик =====

function render(regions: Set<Region>): void {
  if (!root?.isConnected) return;
  memoFocus();
  rememberHome(S.view);
  const step = (name: string, fn: () => void) => {
    try {
      fn();
    } catch (e) {
      console.warn('[chatsV2] paint', name, e);
    }
  };
  if (regions.has('layout') || regions.has('main')) step('layout', paintLayout);
  if (regions.has('rail')) step('rail', paintRail);
  if (regions.has('sidebar')) step('sidebar', paintSidebar);
  if (regions.has('voice')) step('voice', paintVoice);
  let rebuilt = false;
  if (regions.has('main')) {
    try {
      rebuilt = paintMain();
    } catch (e) {
      console.warn('[chatsV2] paint', 'main', e);
    }
  } else {
    if (regions.has('header')) step('header', paintHeader);
    if (regions.has('aside')) step('aside', paintAside);
  }
  if (regions.has('feed') && !rebuilt) step('feed', paintFeedNow);
  if (regions.has('composer')) step('composer', paintComposer);
  if (regions.has('badge') || regions.has('rail')) step('badge', paintBadge);
  if (regions.has('aside')) step('popout', refreshUserPopout);
}

// ===== Загрузка =====

let booting: Promise<void> | null = null;

async function boot(): Promise<void> {
  if (S.me.id == null) return;
  const pop = popoutQuery().kind;
  if (pop) {
    // Окно уже на экране. Тянем только списки, чтобы сразу открыть нужный диалог.
    await Promise.all([loadEndpoints(), loadMe(), loadLists()]);
    S.booted = true;
    try {
      await applyPopoutTarget();
    } finally {
      revealChatPopout();
    }
    void loadFriends();
    void loadInbox();
    return;
  }
  await loadEndpoints();
  await Promise.all([loadMe(), loadLists(), loadFriends(), loadInbox()]);
  S.booted = true;
  // Детали групп нужны сразу: id текстового и голосового канала звонка
  await Promise.all(S.rooms.filter((r) => r.kind === 'group').map((r) => loadDetail(r.id)));
  const v = S.view;
  if (v.kind === 'server' || v.kind === 'group') {
    if (!roomById(v.roomId)) openFriends();
    else {
      await loadDetail(v.roomId);
      void loadMembers(v.roomId).then(() => invalidate('aside'));
    }
  }
  if (S.loadError) toast(S.loadError, 'error');
  invalidate(...ALL, 'header', 'feed');
  window.dispatchEvent(new CustomEvent('gs-home-chats'));
}

/** Параметры отдельного окна: ?cv2pop=dm|server|group&id=&t= */
function popoutQuery(): { kind: 'dm' | 'server' | 'group' | null; title: string } {
  const q = new URLSearchParams(location.search);
  const kind = q.get('cv2pop');
  const title = q.get('t') || '';
  if (kind === 'dm' || kind === 'server' || kind === 'group') return { kind, title };
  return { kind: null, title };
}

/** Имя в тайтлбаре: канал сервера или собеседник. Список каналов только у сервера. */
function syncPopoutChrome(): void {
  const pop = popoutQuery();
  if (!pop.kind) return;
  const room = pop.kind === 'server';
  document.body.classList.add('gs-chat-popout');
  document.body.classList.toggle('is-room', room);
  document.body.classList.toggle('is-dm', !room);
  const label = livePopoutTitle(pop.title);
  const span = document.getElementById('titlebar-name');
  if (span && label) span.textContent = label;
  if (label) document.title = label;
  const mark = document.getElementById('titlebar-mark');
  const icon = popoutMarkHtml();
  if (mark && icon && mark.dataset.html !== icon) {
    mark.dataset.html = icon;
    mark.innerHTML = icon;
  }
  const v = S.view;
  const ready =
    (pop.kind === 'dm' && v.kind === 'dm') ||
    (pop.kind === 'group' && v.kind === 'group') ||
    (pop.kind === 'server' && v.kind === 'server');
  document.body.classList.toggle('is-ready', ready);
}

/** Иконка в тайтлбаре: аватар собеседника или значок сервера. */
function popoutMarkHtml(): string {
  const pop = popoutQuery();
  const qid = Number(new URLSearchParams(location.search).get('id')) || 0;
  const v = S.view;
  if (pop.kind === 'dm') {
    const id = v.kind === 'dm' ? v.peerId : qid;
    const u = userOf(id);
    const dm = S.dms.find((d) => sameId(d.peer_id, id));
    return avatarHtml(u.username || pop.title || 'Чат', u.avatar_url || dm?.peer_avatar_url, u.avatar_color || dm?.peer_avatar_color, { size: 18, letters: true });
  }
  const roomId = v.kind === 'server' || v.kind === 'group' ? v.roomId : qid;
  const room = roomById(roomId);
  if (!room) return '';
  if (room.kind === 'group') {
    return room.avatar_url
      ? avatarHtml(room.name, room.avatar_url, room.avatar_color, { size: 18, letters: true })
      : groupIcon(room, 18);
  }
  return avatarHtml(room.name, room.avatar_url, room.avatar_color, { size: 18, cls: 'is-square', letters: true });
}

function livePopoutTitle(fallback: string): string {
  const v = S.view;
  if (v.kind === 'dm') return userOf(v.peerId).username || fallback || 'Чат';
  if (v.kind === 'group') return roomById(v.roomId)?.name || fallback || 'Группа';
  if (v.kind === 'server') {
    const d = S.details.get(v.roomId);
    if (v.voiceId) {
      const ch = allVoiceChannels(d).find((c) => sameId(c.id, v.voiceId));
      if (ch?.name) return ch.name;
    } else if (v.channelId) {
      const ch = allTextChannels(d).find((c) => sameId(c.id, v.channelId));
      if (ch?.name) return ch.name;
    }
    return roomById(v.roomId)?.name || fallback || 'Канал';
  }
  return fallback || 'Чат';
}

/** Отдельное окно чата: один диалог, без рельса серверов и меню GameSync. */
async function applyPopoutTarget(): Promise<void> {
  const { kind } = popoutQuery();
  if (!kind) return;
  syncPopoutChrome();
  const id = Number(new URLSearchParams(location.search).get('id'));
  if (!id) return;
  const ch = Number(new URLSearchParams(location.search).get('ch')) || undefined;
  // go() внутри open* срабатывает до ожидания истории — убираем заставку сразу
  const opened = kind === 'dm' ? openDm(id) : kind === 'group' ? openGroup(id) : openServer(id, ch);
  syncPopoutChrome();
  await opened;
  syncPopoutChrome();
}

/** Окно было скрыто, пока грузилась заставка. Показать уже собранный чат. */
function revealChatPopout(): void {
  if (!popoutQuery().kind) return;
  const show = (window as unknown as { electronAPI?: { chatPopoutShow?: () => void } }).electronAPI?.chatPopoutShow;
  if (!show) return;
  requestAnimationFrame(() => requestAnimationFrame(() => show()));
}

function refresh(): Promise<void> {
  if (booting) return booting;
  booting = boot().finally(() => {
    booting = null;
  });
  return booting;
}

function resetSession(): void {
  void rtcShutdown();
  S.rooms = [];
  S.dms = [];
  S.friends = { friends: [], incoming: [], outgoing: [], blocked: [] };
  S.inbox = [];
  S.details.clear();
  S.members.clear();
  S.convs.clear();
  S.typing.clear();
  S.profiles.clear();
  S.mutuals.clear();
  S.chUnread.clear();
  S.voiceMembers.clear();
  S.booted = false;
  S.view = { kind: 'friends', tab: 'online' };
  paintedSig = '';
  paintedFeedKey = '';
  invalidate(...ALL, 'header');
}

// ===== Инициализация =====

export function initChats(api: ChatsApi): ChatsController {
  S.api = api;
  const host = document.getElementById('cv2-root') || document.getElementById('tab-chats');
  root = document.createElement('div');
  root.className = 'cv2';
  root.id = 'cv2';
  root.innerHTML = ROOT_HTML;
  if (host) {
    if (host.id === 'tab-chats') {
      // Старую разметку не трогаем — только прячем, чтобы не мешала
      for (const ch of Array.from(host.children)) if (ch.id !== 'gs-msgr-holospeak-about-btn') (ch as HTMLElement).hidden = true;
    }
    host.appendChild(root);
  }

  rtcInit(wsSend, (text, kind) => toast(text, kind === 'error' ? 'error' : 'info'));
  setRenderer(render);
  setModalHooks({
    openDm: (id) => void openDm(id),
    openGroup: (id) => void openGroup(id),
    openServer: (id, ch) => void openServer(id, ch),
    forward: forwardTo,
  });
  bindActions(root);
  bindTooltips(root);
  bindTooltips(layer());
  const rail = $('cv2-rail');
  if (rail) {
    bindRailDnd(rail, (ids) => {
      S.ui.railOrder = ids;
      saveUi();
      invalidate('rail');
    });
  }

  api.onCloudWsMessage?.((data) => {
    let msg = data;
    if (typeof msg === 'string') {
      try {
        msg = JSON.parse(msg);
      } catch {
        return;
      }
    }
    if (msg && typeof msg === 'object') void onWs(msg as Record<string, any>).catch((e) => console.warn('[chatsV2] ws', e));
  });

  // Возврат на вкладку/в окно: отметить прочитанным то, что сейчас открыто
  const onBack = () => {
    window.setTimeout(() => {
      const key = activeKey();
      if (key && chatsTabActive() && document.hasFocus()) ack(key);
      paintPill();
      paintRing();
    }, 60);
  };
  document.querySelectorAll('.tab-btn[data-tab]').forEach((b) => b.addEventListener('click', onBack));
  window.addEventListener('focus', onBack);

  // Порог совпадает с контейнерным запросом в CSS, где правая панель становится оверлеем
  const syncCompact = () => {
    const w = root.clientWidth;
    if (!w) return; // вкладка скрыта — ширина неизвестна
    const compact = w <= 1120;
    if (compact === S.ui.compact) return;
    S.ui.compact = compact;
    S.ui.asideOverlay = false;
    invalidate('header', 'aside');
  };
  new ResizeObserver(syncCompact).observe(root);
  syncCompact();

  window.setInterval(() => {
    if (!root.isConnected) return;
    void sampleVoicePing().then(() => {
      if (root.isConnected) tickTimers(root);
    });
  }, 1000);

  invalidate(...ALL, 'header');

  return {
    refresh,
    openDm: (peerId) => {
      document.querySelector<HTMLElement>('.tab-btn[data-tab="messenger"]')?.click();
      return openDm(peerId);
    },
    openServer: (roomId, channelId) => {
      document.querySelector<HTMLElement>('.tab-btn[data-tab="messenger"]')?.click();
      return openServer(roomId, channelId);
    },
    openGroup: (roomId) => {
      document.querySelector<HTMLElement>('.tab-btn[data-tab="messenger"]')?.click();
      return openGroup(roomId);
    },
    setUserId(id) {
      const changed = !sameId(id, S.me.id);
      if (changed && S.me.id != null) resetSession();
      S.me.id = id;
      if (id == null) resetSession();
      else if (changed || !S.booted) void refresh();
    },
    setPlatformAdmin(admin) {
      S.me.admin = Boolean(admin);
      invalidate('sidebar', 'main');
    },
    setOnlineIds(ids) {
      S.online = new Set([...ids].map(Number));
      for (const u of S.users.values()) if (u.bot) S.online.add(u.id);
      invalidate('rail', 'sidebar', 'main', 'aside');
    },
    setPresenceStatus(status) {
      setPresence(status);
    },
    setUserGames(games) {
      S.games = games;
      invalidate('sidebar', 'main', 'aside');
    },
    setMyAvatar(url, color) {
      S.me.avatar = url ? `${url}${url.includes('?') ? '&' : '?'}v=${Date.now()}` : '';
      if (color) S.me.color = color;
      invalidate(...ALL, 'feed');
    },
    patchRoomAvatar(roomId, url) {
      const r = roomById(roomId);
      if (r) r.avatar_url = `${url}${url.includes('?') ? '&' : '?'}v=${Date.now()}`;
      const d = S.details.get(roomId);
      if (d) d.avatar_url = r?.avatar_url;
      invalidate('rail', 'sidebar');
    },
    homeRows,
  };
}

/** Превью чатов для главной: сначала непрочитанные, затем по свежести. */
function homeRows(): HomeChatPreview[] {
  const rows: Array<HomeChatPreview & { ts: string }> = [];
  for (const d of S.dms) {
    rows.push({
      kind: 'dm',
      id: d.peer_id,
      title: d.peer_username || 'Диалог',
      sub: String(d.last_message?.text || 'Личные сообщения'),
      unread: Number(d.unread_count) || 0,
      avatarUrl: d.peer_avatar_url || null,
      color: d.peer_avatar_color || null,
      ts: String(d.last_message?.created_at || ''),
    });
  }
  for (const r of S.rooms) {
    rows.push({
      kind: r.kind === 'group' ? 'group' : 'server',
      id: r.id,
      title: r.name || (r.kind === 'group' ? 'Группа' : 'Сервер'),
      sub: String(r.last_message?.text || (r.kind === 'group' ? 'Группа' : 'Сервер')),
      unread: Number(r.unread_count) || Number(r.mention_count) || 0,
      avatarUrl: r.avatar_url || null,
      color: r.avatar_color || null,
      ts: String(r.last_message?.created_at || ''),
    });
  }
  rows.sort((a, b) => b.unread - a.unread || b.ts.localeCompare(a.ts));
  return rows.slice(0, 8).map((row) => ({
    kind: row.kind,
    id: row.id,
    title: row.title,
    sub: row.sub,
    unread: row.unread,
    avatarUrl: row.avatarUrl,
    color: row.color,
  }));
}

window.addEventListener('gs-mail-open', (ev) => {
  const d = (ev as CustomEvent<{ kind?: string; roomId?: number; peerId?: number; channelId?: number }>).detail || {};
  if (d.kind === 'dm' && d.peerId) void openDm(d.peerId);
  else if (d.kind === 'group' && d.roomId) void openGroup(d.roomId);
  else if (d.kind === 'server' && d.roomId) void openServer(d.roomId, d.channelId || undefined);
  else if (d.kind === 'invite') openInvites();
});

export type { ChatsApi, ChatsController };
