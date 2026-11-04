// Правая панель беседы: профиль собеседника, список участников, результаты поиска и закреплённые сообщения.
// Плюс всплывающая карточка пользователя (клик по аватару/имени), как в Discord.
import { IC } from '../icons';
import { S, gameIcon, getMutual, getProfile, invalidate, isOnline, isRoomOwner, membersShown, myGame, profileShown, relationTo, roomById, userOf } from '../store';
import { V } from '../rtc';
import { avatarHtml, botBadge, esc, fmtMsgTime, formatText, plainPreview, plural, sameId } from '../util';
import { clampToViewport, layer } from '../overlays';
import type { Member, Message, Role } from '../types';

// ===== Карточка профиля =====

const requested = new Set<number>();

/** Подгрузить профиль и общие данные один раз за сессию (повторно — по force). */
export function ensureProfile(uid: number, force = false): void {
  if (!uid || (requested.has(uid) && !force)) return;
  requested.add(uid);
  void Promise.all([getProfile(uid, force), sameId(uid, S.me.id) ? null : getMutual(uid, force)]).then(() => invalidate('aside'));
}

function relationButton(uid: number): string {
  if (sameId(uid, S.me.id)) return '';
  const rel = relationTo(uid);
  if (rel === 'none') return `<button type="button" class="cv2-pcard__btn is-accent" data-act="friend-add" data-uid="${uid}">Добавить в друзья</button>`;
  if (rel === 'incoming') return `<button type="button" class="cv2-pcard__btn is-accent" data-act="friend-accept" data-uid="${uid}">Принять заявку</button>`;
  if (rel === 'outgoing') return `<button type="button" class="cv2-pcard__btn is-dim" data-act="friend-decline" data-uid="${uid}">Заявка отправлена</button>`;
  if (rel === 'blocked') return `<button type="button" class="cv2-pcard__btn" data-act="friend-unblock" data-uid="${uid}">Разблокировать</button>`;
  return '';
}

function steamCard(uid: number): string {
  const p = S.profiles.get(uid);
  if (!p?.steam_id) return '';
  const online = Boolean(Number(p.steam_online));
  const status = p.steam_current_game ? `Играет в ${p.steam_current_game}` : online ? 'В сети' : p.steam_state_message || 'Не в сети';
  return `<div class="cv2-pcard__steam">
    <div class="cv2-pcard__steam-head">${IC.steam(20)}<span>Профиль Steam</span></div>
    <div class="cv2-pcard__steam-body">
      ${avatarHtml(p.steam_persona || p.username, p.steam_avatar, null, { size: 48, cls: 'is-steam' })}
      <span class="cv2-pcard__steam-text">
        <span class="cv2-pcard__steam-name">${esc(p.steam_persona || p.username)}</span>
        <span class="cv2-pcard__steam-status ${online || p.steam_current_game ? 'is-on' : ''}">${esc(status)}</span>
      </span>
    </div>
    ${p.steam_url ? `<button type="button" class="cv2-pcard__btn is-inner" data-act="open-url" data-href="${esc(p.steam_url)}">Открыть профиль</button>` : ''}
  </div>`;
}

/** Плитки только по числу реальных объектов: один сервер — одна иконка. */
function rowStack(items: string[]): string {
  const list = items.filter(Boolean).slice(0, 3);
  if (!list.length) return '';
  return `<span class="cv2-pcard__stack">${list.join('')}</span>`;
}

function cssColor(value: string | null | undefined, fallback: string): string {
  const s = String(value || '').trim();
  if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) return s;
  if (/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(s)) return s;
  return fallback;
}

function badgeChip(b: { label: string; color?: string; text_color?: string }): string {
  const bg = cssColor(b.color, '#5b6eae');
  const fg = cssColor(b.text_color, '#ffffff');
  return `<span class="cv2-pcard__badge" style="background:${esc(bg)};color:${esc(fg)}">${esc(b.label)}</span>`;
}

function pcardRow(act: string, uid: number, stack: string, label: string): string {
  return `<button type="button" class="cv2-pcard__row" data-act="${act}" data-uid="${uid}">${stack}<span class="cv2-pcard__row-label">${label}</span><span class="cv2-pcard__chev">${IC.chevron(24)}</span></button>`;
}

export function profileCard(uid: number, mode: 'panel' | 'popout'): string {
  ensureProfile(uid);
  const u = userOf(uid);
  const p = S.profiles.get(uid);
  const mu = S.mutuals.get(uid);
  // В справочнике уже лежит обрезанная голова. URL профиля может прийти пустым или сырым листом.
  const avatar = u.avatar_url || p?.avatar_abs || p?.avatar_url;
  const color = p?.avatar_color || u.avatar_color || null;
  const badges = (p?.badges || []).filter((b) => b.label);
  const game = isOnline(uid) ? myGame(uid) : null;
  const gIcon = game ? gameIcon(game) : null;
  const me = sameId(uid, S.me.id);
  const servers = mu?.servers || [];
  const friends = mu?.friends || [];
  const games = Number(p?.steam_games_count) || 0;
  const gameList = (p?.steam_games || []).filter((g) => g.name).slice(0, 8);
  const rows: string[] = [];
  if (game) {
    const tile = gIcon ? `<span class="cv2-pcard__gtile is-img"><img src="${esc(gIcon)}" alt="" onerror="this.remove()"></span>` : '';
    rows.push(`<div class="cv2-pcard__row is-static">${rowStack(tile ? [tile] : [])}<span class="cv2-pcard__row-label">Играет в ${esc(game)}</span></div>`);
  }
  if (!me && servers.length) {
    const stack = rowStack(servers.map((s) => avatarHtml(s.name, s.avatar_url, s.avatar_color, { size: 20, cls: 'is-tile' })));
    rows.push(pcardRow('mutual-servers', uid, stack, `${servers.length} ${plural(servers.length, 'общий сервер', 'общих сервера', 'общих серверов')}`));
  }
  if (!me && friends.length) {
    const stack = rowStack(friends.map((f) => avatarHtml(f.username, f.avatar_url, f.avatar_color, { size: 20, cls: 'is-tile' })));
    rows.push(pcardRow('mutual-friends', uid, stack, `${friends.length} ${plural(friends.length, 'общий друг', 'общих друга', 'общих друзей')}`));
  }
  if (gameList.length) {
    rows.push(
      `<div class="cv2-pcard__games"><div class="cv2-pcard__games-title">${games || gameList.length} ${plural(games || gameList.length, 'игра', 'игры', 'игр')}</div>${gameList
        .map((g) => {
          const href = g.appid ? `https://store.steampowered.com/app/${encodeURIComponent(String(g.appid))}` : '';
          const cover = g.appid
            ? `<img src="https://cdn.cloudflare.steamstatic.com/steam/apps/${encodeURIComponent(String(g.appid))}/capsule_231x87.jpg" alt="" loading="lazy" onerror="this.remove()">`
            : '';
          const hours = g.hours ? `<span>${esc(String(g.hours))} ч</span>` : '';
          const inner = `${cover}<b>${esc(g.name)}</b>${hours}`;
          return href
            ? `<button type="button" class="cv2-pcard__game" data-act="open-url" data-href="${esc(href)}">${inner}</button>`
            : `<div class="cv2-pcard__game">${inner}</div>`;
        })
        .join('')}</div>`,
    );
  } else if (games) {
    rows.push(`<div class="cv2-pcard__row is-static"><span class="cv2-pcard__row-label">В библиотеке ${games} ${plural(games, 'игра', 'игры', 'игр')}</span></div>`);
  }
  const rel = relationButton(uid);
  return `<div class="cv2-pcard is-${mode}" data-uid="${uid}">
    <div class="cv2-pcard__ava">${avatarHtml(u.username, avatar, color, { size: 52, status: isOnline(uid) ? 'online' : 'offline', ring: '#2b2b2b' })}</div>
    <div class="cv2-pcard__name">${esc(p?.username || u.username)}${u.bot ? botBadge() : ''}</div>
    <div class="cv2-pcard__tag"><span class="cv2-pcard__login">${esc(p?.username || u.username)}</span></div>
    ${badges.length ? `<div class="cv2-pcard__badges">${badges.map((b) => badgeChip(b)).join('')}</div>` : ''}
    ${roomRolesHtml(uid)}
    ${p?.bio ? `<div class="cv2-pcard__bio">${formatText(p.bio)}</div>` : ''}
    <div class="cv2-pcard__actions">
      ${S.api.openUserProfile ? `<button type="button" class="cv2-pcard__btn" data-act="full-profile" data-uid="${uid}">Открыть полный профиль</button>` : ''}
      ${mode === 'popout' && !me ? `<button type="button" class="cv2-pcard__btn" data-act="open-dm" data-peer="${uid}">Написать</button>` : ''}
      ${rel}
    </div>
    ${rows.length ? `<div class="cv2-pcard__rows">${rows.join('')}</div>` : ''}
    ${steamCard(uid)}
  </div>`;
}

// ===== Участники =====

/** Роли участника на открытом сервере — и в боковой карточке, и во всплывающей. */
function roomRolesHtml(uid: number): string {
  const v = S.view;
  if (v.kind !== 'server' && v.kind !== 'group') return '';
  const member = (S.members.get(v.roomId) || []).find((m) => sameId(m.user_id, uid));
  if (!member?.role_ids?.length) return '';
  const roles = (S.details.get(v.roomId)?.roles || [])
    .filter((r) => member.role_ids?.includes(r.id))
    .sort((a, b) => (b.position || 0) - (a.position || 0));
  if (!roles.length) return '';
  return `<div class="cv2-pcard__roles">${roles
    .map((r) => `<span class="cv2-pcard__role"><i style="background:${esc(r.color || '#99aab5')}"></i>${esc(r.name)}</span>`)
    .join('')}</div>`;
}

function memberRow(m: { user_id: number; username: string }, roomId: number, ownerId: number | null | undefined, roleColor?: string): string {
  const uid = m.user_id;
  const u = userOf(uid);
  const game = myGame(uid);
  const online = isOnline(uid);
  return `<div class="cv2-mrow ${online ? '' : 'is-off'}" data-act="user" data-uid="${uid}" data-ctx="member" data-room="${roomId}">
    ${avatarHtml(u.username, u.avatar_url, u.avatar_color, { size: 24, status: online ? 'online' : 'offline', ring: 'var(--cv2-bg-aside)' })}
    <span class="cv2-mrow__text">
      <span class="cv2-mrow__name" ${roleColor ? `style="color:${esc(roleColor)}"` : ''}>${esc(u.username || m.username)}${u.bot ? botBadge() : ''}${
        sameId(ownerId, uid) ? `<span class="cv2-mrow__crown" data-tip="${roomById(roomId)?.kind === 'group' ? 'Владелец группы' : 'Владелец сервера'}">${IC.crown(14)}</span>` : ''
      }</span>
      ${online && game ? `<span class="cv2-mrow__sub">Играет в <b>${esc(game)}</b></span>` : ''}
    </span>
  </div>`;
}

function memberDisplayName(m: Member): string {
  return userOf(m.user_id).username || m.username || '';
}

function sortMembers(a: Member, b: Member): number {
  const ao = isOnline(a.user_id) ? 0 : 1;
  const bo = isOnline(b.user_id) ? 0 : 1;
  if (ao !== bo) return ao - bo;
  return memberDisplayName(a).localeCompare(memberDisplayName(b), 'ru');
}

function topRole(roomId: number, m: Member): Role | undefined {
  const roles = (S.details.get(roomId)?.roles || []).filter((r) => m.role_ids?.includes(r.id));
  roles.sort((a, b) => (b.position || 0) - (a.position || 0));
  return roles[0];
}

function topRoleColor(roomId: number, m: Member): string | undefined {
  const color = topRole(roomId, m)?.color;
  return color && color !== '#000000' ? color : undefined;
}

function memberSection(title: string, members: Member[], roomId: number, ownerId: number | null | undefined, color?: string): string {
  if (!members.length) return '';
  const tint = color && color !== '#000000' ? ` style="color:${esc(color)}"` : '';
  return `<div class="cv2-mgroup">
    <div class="cv2-list-label is-aside"${tint}>${esc(title)} — ${members.length}</div>
    ${members.map((m) => memberRow(m, roomId, ownerId, topRoleColor(roomId, m))).join('')}
  </div>`;
}

export function membersPanel(roomId: number): string {
  const room = roomById(roomId);
  const d = S.details.get(roomId);
  const ownerId = d?.creator_id ?? room?.creator_id;
  const list: Member[] = S.members.get(roomId) || (room?.members || []).map((m) => ({ user_id: m.user_id, username: m.username, is_online: m.is_online }));
  if (!list.length) return `<div class="cv2-aside__pad"><div class="cv2-skel">${'<div class="cv2-skel__row"></div>'.repeat(6)}</div></div>`;
  const isGroup = room?.kind === 'group';
  const roles = [...(d?.roles || [])].sort((a, b) => (b.position || 0) - (a.position || 0));
  const used = new Set<number>();
  const chunks: string[] = [];

  // Сервер: сначала роли (выше по иерархии — выше в списке), под каждой — её участники
  if (!isGroup && roles.length) {
    for (const role of roles) {
      const group = list.filter((m) => !used.has(m.user_id) && topRole(roomId, m)?.id === role.id).sort(sortMembers);
      if (!group.length) continue;
      group.forEach((m) => used.add(m.user_id));
      chunks.push(memberSection(role.name, group, roomId, ownerId, role.color));
    }
  }

  const rest = list.filter((m) => !used.has(m.user_id)).sort(sortMembers);
  if (isGroup) {
    chunks.push(memberSection('Участники', rest, roomId, ownerId));
  } else {
    const on = rest.filter((m) => isOnline(m.user_id));
    const off = rest.filter((m) => !isOnline(m.user_id));
    chunks.push(memberSection('В сети', on, roomId, ownerId));
    chunks.push(memberSection('Не в сети', off, roomId, ownerId));
  }

  return `<div class="cv2-members">
    ${chunks.join('')}
    ${isGroup && isRoomOwner(roomId) ? `<button type="button" class="cv2-btn is-ghost is-block is-sm cv2-members__add" data-act="group-add" data-room="${roomId}">${IC.userPlus(14)}<span>Добавить друзей</span></button>` : ''}
  </div>`;
}

// ===== Поиск и закрепы =====

function miniMsg(m: Message, panel: 'search' | 'pins'): string {
  const u = m.sender_id ? userOf(m.sender_id) : null;
  const q = panel === 'search' ? S.ui.asidePanel?.query || '' : '';
  let text = esc(plainPreview(m.text, 400)) || (m.attachment_name ? `📎 ${esc(m.attachment_name)}` : '');
  if (q) {
    const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    text = text.replace(re, '<mark>$1</mark>');
  }
  return `<div class="cv2-mini" data-act="jump" data-mid="${esc(m.id)}">
    ${avatarHtml(u?.username || m.sender_username, u?.avatar_url || m.sender_avatar_url, u?.avatar_color || m.sender_avatar_color, { size: 32 })}
    <span class="cv2-mini__main">
      <span class="cv2-mini__head"><b>${esc(u?.username || m.sender_username)}</b><span>${esc(fmtMsgTime(m.created_at))}</span></span>
      <span class="cv2-mini__text">${text}</span>
    </span>
    ${panel === 'pins' ? `<button type="button" class="cv2-mini__x" data-act="msg-unpin" data-mid="${esc(m.id)}" data-tip="Открепить">${IC.close(12)}</button>` : ''}
    <span class="cv2-mini__jump">Перейти</span>
  </div>`;
}

export function listPanel(): string {
  const p = S.ui.asidePanel;
  if (!p) return '';
  const title = p.kind === 'pins' ? 'Закреплённые сообщения' : p.loading ? 'Поиск…' : `${p.results.length} ${plural(p.results.length, 'результат', 'результата', 'результатов')}`;
  const body = p.loading
    ? `<div class="cv2-aside__pad"><div class="cv2-skel">${'<div class="cv2-skel__row is-tall"></div>'.repeat(4)}</div></div>`
    : p.results.length
      ? p.results.map((m) => miniMsg(m, p.kind)).join('')
      : `<div class="cv2-empty is-aside">
          <div class="cv2-empty__art">${p.kind === 'pins' ? IC.pin(36) : IC.search(36)}</div>
          <div class="cv2-empty__text">${p.kind === 'pins' ? 'В этой беседе пока нет закреплённых сообщений. Наведите на сообщение и нажмите на значок булавки.' : 'Ничего не найдено. Попробуйте другой запрос.'}</div>
        </div>`;
  return `<div class="cv2-lpanel">
    <div class="cv2-lpanel__head"><span>${esc(title)}</span><button type="button" class="cv2-ibtn is-sm" data-act="aside-close" data-tip="Закрыть">${IC.close(16)}</button></div>
    <div class="cv2-lpanel__list">${body}</div>
  </div>`;
}

/** Содержимое правой панели для текущего представления ('' — панель скрыта). */
export function renderAside(): string {
  if (S.ui.asidePanel) return listPanel();
  const v = S.view;
  if (v.kind === 'dm') return profileShown() ? `<div class="cv2-aside__scroll">${profileCard(v.peerId, 'panel')}</div>` : '';
  if (v.kind === 'group' || (v.kind === 'server' && v.channelId && !v.voiceId)) {
    return membersShown() ? `<div class="cv2-aside__scroll">${membersPanel(v.roomId)}</div>` : '';
  }
  return '';
}

// ===== Всплывающая карточка пользователя =====

let popEl: HTMLElement | null = null;
let popUid = 0;
let popAt: { x: number; y: number } | null = null;

export function closeUserPopout(): void {
  if (!popEl) return;
  const el = popEl;
  popEl = null;
  popUid = 0;
  popAt = null;
  el.classList.remove('is-on');
  el.dispatchEvent(new Event('cv2-popout-close'));
  window.setTimeout(() => el.remove(), 160);
}

/** Карточка у точки клика и целиком внутри окна: лишнее прокручивается внутри. */
function placePopout(el: HTMLElement, x: number, y: number): void {
  const pad = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  el.style.maxHeight = `${Math.max(180, vh - pad * 2)}px`;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  let left = x + 10;
  let top = y + 10;
  if (x > vw * 0.62 || left + w > vw - pad) left = x - w - 10;
  if (top + h > vh - pad) top = Math.max(pad, vh - h - pad);
  if (top < pad) top = pad;
  el.style.maxHeight = `${Math.max(180, vh - top - pad)}px`;
  clampToViewport(el, left, top);
}

export function openUserPopout(uid: number, anchor: HTMLElement, at?: { x: number; y: number }): void {
  if (popEl && popUid === uid) {
    closeUserPopout();
    return;
  }
  closeUserPopout();
  const el = document.createElement('div');
  el.className = 'cv2-popout';
  el.innerHTML = profileCard(uid, 'popout');
  layer().appendChild(el);
  popEl = el;
  popUid = uid;
  const r = anchor.getBoundingClientRect();
  const x = at && (at.x > 0 || at.y > 0) ? at.x : r.left + Math.min(r.width, 36);
  const y = at && (at.x > 0 || at.y > 0) ? at.y : r.bottom;
  popAt = { x, y };
  placePopout(el, x, y);
  const onResize = () => {
    if (popEl && popAt) placePopout(popEl, popAt.x, popAt.y);
  };
  window.addEventListener('resize', onResize);
  el.addEventListener('cv2-popout-close', () => window.removeEventListener('resize', onResize), { once: true });
  requestAnimationFrame(() => el.classList.add('is-on'));
  const onDown = (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest('.cv2-popout') || anchor.contains(t) || t.closest('.cv2-menu')) return;
    closeUserPopout();
    document.removeEventListener('mousedown', onDown, true);
  };
  window.setTimeout(() => document.addEventListener('mousedown', onDown, true), 0);
}

/** Обновить открытую карточку после догрузки профиля. */
export function refreshUserPopout(): void {
  if (!popEl || !popUid) return;
  popEl.innerHTML = profileCard(popUid, 'popout');
  if (popAt) placePopout(popEl, popAt.x, popAt.y);
}
