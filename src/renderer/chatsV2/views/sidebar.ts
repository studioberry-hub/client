// Сайдбар (274px): домашний режим (поиск, Друзья, Приглашения, ЛС и группы) и дерево каналов сервера.
import { IC, IMG, VCI, assetMask, channelMarkTone } from '../icons';
import { voiceControls } from './voice';
import {
  S,
  allTextChannels,
  allVoiceChannels,
  canManage,
  canReorder,
  channelAllows,
  hideMutedChannels,
  isCatHidden,
  isChannelMuted,
  isConvSoundMuted,
  isFavChannel,
  isPinnedChannel,
  gameIcon,
  groups,
  isOnline,
  servers,
  myGame,
  roomById,
  showAllChannels,
  userOf,
} from '../store';
import { C, V, channelMembers } from '../rtc';
import { avatarHtml, botBadge, esc, groupColor, parseTime, plural, sameId } from '../util';
import { refreshOpenTip } from '../overlays';
import { openFriendWorlds } from '../worlds';
import type { Category, Dm, Room, TextChannel, VoiceChannel } from '../types';

// ===== Скрытые ЛС (крестик в строке, вернутся с новым сообщением) =====

const LS_HIDDEN = 'cv2.hiddenDms';

export const hiddenDms = new Set<number>(
  (() => {
    try {
      return JSON.parse(localStorage.getItem(LS_HIDDEN) || '[]') as number[];
    } catch {
      return [];
    }
  })(),
);

export function setDmHidden(peerId: number, hidden: boolean): void {
  if (hidden) hiddenDms.add(peerId);
  else hiddenDms.delete(peerId);
  localStorage.setItem(LS_HIDDEN, JSON.stringify([...hiddenDms]));
}

// ===== Статус пользователя =====

export function statusLine(uid: number): string {
  const game = myGame(uid);
  if (isOnline(uid)) return game ? `В сети • ${game}` : 'В сети';
  return 'Оффлайн';
}

export function userAvatar(uid: number, size: number, ring: string, withGame = true): string {
  const u = userOf(uid);
  const game = withGame ? myGame(uid) : null;
  return avatarHtml(u.username, u.avatar_url, u.avatar_color, {
    size,
    ring,
    status: isOnline(uid) ? 'online' : 'offline',
    gameIcon: game ? gameIcon(game) : null,
  });
}

function friendsGlyph(size: number): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M6.85714 4H5.14286C3.7227 4 2.57143 5.07452 2.57143 6.4V8C2.57143 9.19947 3.5142 10.1934 4.74587 10.3716C5.47106 9.20047 6.66639 8.35113 8.06836 8.08691C7.39991 7.23673 7 6.1654 7 5V4.00364C6.95271 4.00122 6.90508 4 6.85714 4Z" fill="currentColor"/><path d="M0 14.4V16C0 18.2091 1.91878 20 4.28571 20H6.10102C4.80447 18.7295 4 16.9587 4 15V13C4 12.6575 4.03443 12.3231 4.10002 12H2.57143C1.15127 12 0 13.0745 0 14.4Z" fill="currentColor"/><path d="M9 10H17C18.6569 10 20 11.3431 20 13V15C20 17.7614 17.7614 20 15 20H11C10.4101 20 9.8441 19.8979 9.31867 19.7103C7.38435 19.0198 6 17.1715 6 15V13C6 12.6494 6.06015 12.3128 6.17071 12C6.58254 10.8348 7.69378 10 9 10Z" fill="currentColor"/><path d="M12 0H14C15.6569 0 17 1.34315 17 3V5C17 6.65685 15.6569 8 14 8H12C10.9087 8 9.95353 7.41732 9.42857 6.54611C9.16843 6.11438 9.01394 5.61179 9.0009 5.07415C9.0003 5.0495 9 5.02479 9 5V3C9 1.34315 10.3431 0 12 0Z" fill="currentColor"/></svg>`;
}

export function groupIcon(g: Room, size = 32): string {
  const c = groupColor(g.id);
  return `<span class="cv2-gicon" style="--s:${size}px;--g:${c}">${friendsGlyph(Math.round(size * 0.62))}</span>`;
}

// ===== Домашний режим =====

type HomeRow = { kind: 'dm'; dm: Dm; t: number } | { kind: 'group'; room: Room; t: number };

function homeRows(): HomeRow[] {
  const q = S.ui.sidebarQuery.trim().toLowerCase();
  const v = S.view;
  const rows: HomeRow[] = [];
  for (const d of S.dms) {
    const active = v.kind === 'dm' && v.peerId === d.peer_id;
    if (hiddenDms.has(d.peer_id) && !active && !(d.unread_count || 0)) continue;
    if (q && !userOf(d.peer_id).username.toLowerCase().includes(q)) continue;
    rows.push({ kind: 'dm', dm: d, t: parseTime(d.last_message?.created_at)?.getTime() || 0 });
  }
  for (const g of groups()) {
    if (q && !g.name.toLowerCase().includes(q)) continue;
    rows.push({ kind: 'group', room: g, t: parseTime(g.last_message?.created_at)?.getTime() || 0 });
  }
  return rows.sort((a, b) => b.t - a.t);
}

function dmRow(d: Dm): string {
  const v = S.view;
  const u = userOf(d.peer_id);
  const active = v.kind === 'dm' && v.peerId === d.peer_id;
  const unread = d.unread_count || 0;
  const inCall = C.phase && sameId(C.peerId, d.peer_id);
  return `<div class="cv2-row ${active ? 'is-active' : ''} ${unread ? 'is-unread' : ''}" data-act="open-dm" data-peer="${d.peer_id}" data-ctx="dm" role="button" tabindex="0">
    ${userAvatar(d.peer_id, 32, active ? 'var(--cv2-row-active-solid)' : 'var(--cv2-bg-side)')}
    <span class="cv2-row__text">
      <span class="cv2-row__name">${esc(u.username)}${u.bot ? botBadge() : ''}</span>
      <span class="cv2-row__sub">${inCall ? '<span class="cv2-green">В звонке</span>' : esc(statusLine(d.peer_id))}</span>
    </span>
    ${unread ? `<span class="cv2-badge is-inline">${unread > 99 ? '99+' : unread}</span>` : ''}
    <button type="button" class="cv2-row__x" data-act="hide-dm" data-peer="${d.peer_id}" data-tip="Закрыть беседу">${IC.close(14)}</button>
  </div>`;
}

function groupRow(g: Room): string {
  const v = S.view;
  const active = v.kind === 'group' && v.roomId === g.id;
  const unread = g.unread_count || 0;
  const total = g.members_total || g.members?.length || 0;
  const inVoice = sameId(V.roomId, g.id);
  return `<div class="cv2-row ${active ? 'is-active' : ''} ${unread ? 'is-unread' : ''}" data-act="open-group" data-room="${g.id}" data-ctx="group" role="button" tabindex="0">
    ${groupIcon(g)}
    <span class="cv2-row__text">
      <span class="cv2-row__name">${esc(g.name)}</span>
      <span class="cv2-row__sub">${inVoice ? '<span class="cv2-green">В звонке</span>' : `${total} ${plural(total, 'участник', 'участника', 'участников')}`}</span>
    </span>
    ${unread ? `<span class="cv2-badge is-inline">${unread > 99 ? '99+' : unread}</span>` : ''}
    <button type="button" class="cv2-row__x" data-act="leave-group" data-room="${g.id}" data-tip="Покинуть группу">${IC.close(14)}</button>
  </div>`;
}

export function renderHomeTop(): string {
  return `<button type="button" class="cv2-findbtn" data-act="quick-switch">
    ${IC.search(18)}<span>Найти или начать беседу</span>
  </button>`;
}

function serverHomeRow(r: Room): string {
  const active = S.view.kind === 'server' && S.view.roomId === r.id;
  const total = r.members_total || r.members?.length || 0;
  return `<div class="cv2-row ${active ? 'is-active' : ''}" data-act="open-server" data-room="${r.id}" role="button" tabindex="0">
    ${avatarHtml(r.name, r.avatar_url, r.avatar_color, { size: 32, cls: 'is-square', letters: true })}
    <span class="cv2-row__text">
      <span class="cv2-row__name">${esc(r.name)}</span>
      <span class="cv2-row__sub">${total} ${plural(total, 'участник', 'участника', 'участников')}</span>
    </span>
  </div>`;
}

export function renderHomeList(): string {
  const v = S.view;
  const inc = S.friends.incoming.length;
  const inv = S.inbox.length;
  const q = S.ui.sidebarQuery.trim().toLowerCase();
  const srv = servers().filter((r) => !q || r.name.toLowerCase().includes(q));
  const rows = homeRows();
  const list = rows.length
    ? rows.map((r) => (r.kind === 'dm' ? dmRow(r.dm) : groupRow(r.room))).join('')
    : `<div class="cv2-side__empty">${
        S.ui.sidebarQuery ? 'Ничего не найдено' : 'Здесь появятся ваши личные беседы. Напишите другу из вкладки «Друзья».'
      }</div>`;
  const srvBlock = srv.length
    ? `<div class="cv2-side__label"><span>Серверы</span></div><div class="cv2-rows">${srv.map(serverHomeRow).join('')}</div>`
    : '';
  return `<div class="cv2-nav">
      <button type="button" class="cv2-nav__item ${v.kind === 'friends' ? 'is-active' : ''}" data-act="open-friends">
        ${IC.friends(18)}<span>Друзья</span>${inc ? `<span class="cv2-badge is-inline">${inc}</span>` : ''}
      </button>
      <button type="button" class="cv2-nav__item ${v.kind === 'invites' ? 'is-active' : ''}" data-act="open-invites">
        ${assetMask('invites', 18)}<span>Приглашения</span>${inv ? `<span class="cv2-badge is-inline">${inv}</span>` : ''}
      </button>
      <button type="button" class="cv2-nav__item ${v.kind === 'worlds' ? 'is-active' : ''}" data-act="open-worlds">
        ${assetMask('worlds', 18)}<span>Миры по сети</span>${openFriendWorlds().length ? `<span class="cv2-badge is-inline">${openFriendWorlds().length}</span>` : ''}
      </button>
    </div>
    ${srvBlock}
    <div class="cv2-side__label">
      <span>Личные сообщения</span>
      <button type="button" class="cv2-side__label-btn" data-act="create-group" data-tip="Создать группу">${IC.plus(14)}</button>
    </div>
    <div class="cv2-rows">${list}</div>`;
}

// ===== Режим сервера =====

export function renderServerTop(roomId: number): string {
  const r = roomById(roomId);
  const d = S.details.get(roomId);
  const name = d?.name || r?.name || 'Сервер';
  const muted = isConvSoundMuted(r?.site_id || '');
  const mark = avatarHtml(name, r?.avatar_url, r?.avatar_color, { size: 24, letters: true, cls: 'cv2-srvhead__mark' });
  return `<div class="cv2-srvhead">
    <button type="button" class="cv2-srvhead__main" data-act="server-menu" data-room="${roomId}">
      ${mark}
      <span class="cv2-srvhead__name">${esc(name)}</span>
      ${muted ? `<span class="cv2-srvhead__mute" title="Уведомления отключены">${VCI.soundOff(14)}</span>` : ''}
      <span class="cv2-srvhead__chev">${IC.chevronDown(16)}</span>
    </button>
    <button type="button" class="cv2-srvhead__invite" data-act="server-invite" data-room="${roomId}" data-tip="Пригласить людей">${IMG.addUser(18)}</button>
  </div>`;
}

function chIcon(c: TextChannel): string {
  return channelMarkTone(c.channel_kind, 18);
}

function textItem(roomId: number, c: TextChannel): string {
  const v = S.view;
  const active = v.kind === 'server' && v.channelId === c.id && !v.voiceId;
  const un = S.chUnread.get(c.id);
  const unread = !active && (un?.u || 0) > 0;
  const mention = un?.m || 0;
  const manage = channelAllows(roomId, c, 'manage_channels');
  const drag = canReorder(roomId)
    ? ` draggable="true" data-drag="channel" data-drag-kind="text" data-drag-id="${c.id}" data-drag-cat="${c.category_id ?? ''}"`
    : '';
  return `<div class="cv2-ch ${active ? 'is-active' : ''} ${unread ? 'is-unread' : ''}" data-act="open-channel" data-room="${roomId}" data-ch="${c.id}" data-ctx="channel" role="button" tabindex="0"${drag}>
    <span class="cv2-ch__pip"></span>
    <span class="cv2-ch__ico">${chIcon(c)}</span>
    <span class="cv2-ch__name">${esc(c.name)}</span>
    ${channelMarks(c.site_id)}
    ${mention ? `<span class="cv2-badge is-inline">${mention}</span>` : ''}
    ${
      manage
        ? `<button type="button" class="cv2-ch__tool" data-act="channel-settings" data-room="${roomId}" data-ch="${c.id}" data-tip="Настроить канал">${IMG.settings14(14)}</button>`
        : ''
    }
  </div>`;
}

export function voiceMemberRow(uid: number, size = 24): string {
  const u = userOf(uid);
  const muted = V.selfMuted.has(uid) || V.serverMuted.has(uid);
  const deaf = V.selfDeafened.has(uid);
  const speaking = V.speaking.has(uid);
  return `<div class="cv2-vmember" data-act="user" data-uid="${uid}" data-ctx="voice-user">
    <span class="cv2-vmember__ava ${speaking ? 'is-speaking' : ''}" data-speak-uid="${uid}">${avatarHtml(u.username, u.avatar_url, u.avatar_color, { size })}</span>
    <span class="cv2-vmember__name">${esc(u.username)}</span>
    <span class="cv2-vmember__icons">${deaf ? IC.headphonesOff(14) : muted ? IC.micOff(14) : ''}</span>
  </div>`;
}

function voiceItem(roomId: number, c: VoiceChannel): string {
  const members = channelMembers(c.id);
  const joined = sameId(V.channelId, c.id);
  const v = S.view;
  const active = v.kind === 'server' && v.voiceId === c.id;
  const limit = c.user_limit || 0;
  const drag = canReorder(roomId)
    ? ` draggable="true" data-drag="channel" data-drag-kind="voice" data-drag-id="${c.id}" data-drag-cat="${c.category_id ?? ''}"`
    : '';
  return `<div class="cv2-ch is-voice ${active ? 'is-active' : ''} ${joined ? 'is-joined' : ''}" data-act="open-voice" data-room="${roomId}" data-vc="${c.id}" data-ctx="voice" role="button" tabindex="0"${drag}>
    <span class="cv2-ch__pip"></span>
    <span class="cv2-ch__ico">${channelMarkTone('voice', 18)}</span>
    <span class="cv2-ch__name">${esc(c.name)}</span>
    ${channelMarks(c.site_id)}
    ${limit ? `<span class="cv2-ch__limit">${members.length}/${limit}</span>` : ''}
    ${
      channelAllows(roomId, c, 'manage_channels')
        ? `<button type="button" class="cv2-ch__tool" data-act="voice-settings" data-room="${roomId}" data-vc="${c.id}" data-tip="Настроить канал">${IMG.settings14(14)}</button>`
        : ''
    }
  </div>
  ${members.length ? `<div class="cv2-vmembers">${members.map((id) => voiceMemberRow(id)).join('')}</div>` : ''}`;
}

function channelMarks(siteId?: string): string {
  if (!siteId) return '';
  const bits = [
    isPinnedChannel(siteId) ? `<span title="Закреплён">${IC.pin(12)}</span>` : '',
    isFavChannel(siteId) ? `<span title="В избранном">${IC.star(12)}</span>` : '',
    isChannelMuted(siteId) ? `<span title="Канал заглушён">${VCI.soundOff(12)}</span>` : '',
  ].filter(Boolean);
  return bits.length ? `<span class="cv2-ch__marks">${bits.join('')}</span>` : '';
}

function channelShown(roomSite: string, siteId: string | undefined, active: boolean): boolean {
  if (active) return true;
  if (!siteId || showAllChannels(roomSite)) return true;
  if (hideMutedChannels(roomSite) && isChannelMuted(siteId)) return false;
  return true;
}

function channelHtml(roomId: number, text: TextChannel[], voice: VoiceChannel[]): string {
  return [...text.map((c) => ({ rank: isPinnedChannel(c.site_id || '') ? 0 : 1, pos: c.position || 0, html: textItem(roomId, c) })), ...voice.map((c) => ({ rank: isPinnedChannel(c.site_id || '') ? 0 : 1, pos: c.position || 0, html: voiceItem(roomId, c) }))]
    .sort((a, b) => a.rank - b.rank || a.pos - b.pos)
    .map((row) => row.html)
    .join('');
}

export function renderServerList(roomId: number): string {
  const d = S.details.get(roomId);
  if (!d) return `<div class="cv2-skel">${'<div class="cv2-skel__row"></div>'.repeat(8)}</div>`;
  const manage = canManage(roomId);
  const reorder = canReorder(roomId);
  const roomSite = roomById(roomId)?.site_id || '';
  const cats: Category[] = (d.categories || []).filter((c) => c.id != null);
  const allText = allTextChannels(d);
  const allVoice = allVoiceChannels(d);
  const view = S.view;
  const inCat = new Set<number>();
  for (const cat of cats) {
    for (const c of allText) if (c.category_id === cat.id) inCat.add(c.id);
    for (const c of allVoice) if (c.category_id === cat.id) inCat.add(c.id);
  }
  type Block = { rank: number; pos: number; html: string };
  const blocks: Block[] = [];
  for (const c of allText) {
    if (c.category_id != null && inCat.has(c.id)) continue;
    const active = view.kind === 'server' && view.channelId === c.id && !view.voiceId;
    if (!channelShown(roomSite, c.site_id, active)) continue;
    if (!active && !channelAllows(roomId, c, 'view_channel')) continue;
    blocks.push({ rank: isPinnedChannel(c.site_id || '') ? 0 : 1, pos: c.position || 0, html: textItem(roomId, c) });
  }
  for (const c of allVoice) {
    if (c.category_id != null && inCat.has(c.id)) continue;
    const active = view.kind === 'server' && view.voiceId === c.id;
    if (!channelShown(roomSite, c.site_id, active)) continue;
    if (!active && !channelAllows(roomId, c, 'view_channel')) continue;
    blocks.push({ rank: isPinnedChannel(c.site_id || '') ? 0 : 1, pos: c.position || 0, html: voiceItem(roomId, c) });
  }
  for (const cat of cats) {
    if (cat.id == null) continue;
    const key = `${roomId}:${cat.id}`;
    const collapsed = S.ui.collapsed.has(key);
    const text = allText.filter((c) => c.category_id === cat.id).sort((a, b) => (a.position || 0) - (b.position || 0));
    const voice = allVoice.filter((c) => c.category_id === cat.id).sort((a, b) => (a.position || 0) - (b.position || 0));
    const v = S.view;
    const hasActive = text.some((c) => v.kind === 'server' && v.channelId === c.id && !v.voiceId) || voice.some((c) => v.kind === 'server' && v.voiceId === c.id);
    if (cat.site_id && isCatHidden(cat.site_id) && !showAllChannels(roomSite) && !hasActive) continue;
    const visibleText = (collapsed
      ? text.filter((c) => (v.kind === 'server' && v.channelId === c.id) || (S.chUnread.get(c.id)?.u || 0) > 0)
      : text
    ).filter((c) => {
      const active = v.kind === 'server' && v.channelId === c.id && !v.voiceId;
      return channelShown(roomSite, c.site_id, active) && (active || channelAllows(roomId, c, 'view_channel'));
    });
    const visibleVoice = (collapsed ? voice.filter((c) => channelMembers(c.id).length > 0) : voice).filter((c) => {
      const active = v.kind === 'server' && v.voiceId === c.id;
      return channelShown(roomSite, c.site_id, active) && (active || channelAllows(roomId, c, 'view_channel'));
    });
    const headDrag = reorder ? ` draggable="true" data-drag="category" data-drag-id="${cat.id}"` : '';
    blocks.push({
      rank: 1,
      pos: cat.position || 0,
      html: `<div class="cv2-cat ${collapsed ? 'is-collapsed' : ''}" data-cat="${cat.id}">
      <div class="cv2-cat__head" data-act="toggle-cat" data-key="${esc(key)}" data-ctx="category" data-room="${roomId}" data-cat="${cat.id}"${headDrag}>
        <span class="cv2-cat__chev">${IC.chevronDown(10)}</span>
        <span class="cv2-cat__name">${esc(cat.name)}</span>
        ${manage ? `<button type="button" class="cv2-cat__add" data-act="create-channel" data-room="${roomId}" data-cat="${cat.id}" data-tip="Создать канал">${IC.plus(14)}</button>` : ''}
      </div>
      <div class="cv2-cat__body">${channelHtml(roomId, visibleText, visibleVoice)}</div>
    </div>`,
    });
  }
  blocks.sort((a, b) => a.rank - b.rank || a.pos - b.pos);
  return `<div class="cv2-tree${reorder ? ' is-admin' : ''}" data-room="${roomId}">${blocks.map((b) => b.html).join('')}</div>`;
}

// ===== Панель подключённого голоса / звонка =====

function elapsed(from: number): string {
  if (!from) return '';
  const s = Math.max(0, Math.floor((Date.now() - from) / 1000));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return h ? `${h}:${pad(m % 60)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

export function renderVoicePanel(): string {
  let title = '';
  let sub = '';
  let state: 'ok' | 'wait' = 'ok';
  let leaveAct = 'vc-leave';
  let openAct = '';
  if (V.channelId || V.connecting) {
    const room = roomById(V.roomId);
    const ch = allVoiceChannels(S.details.get(V.roomId || 0)).find((c) => c.id === V.channelId);
    title = V.connecting ? 'Подключение…' : 'Подключено';
    state = V.connecting ? 'wait' : 'ok';
    sub = room?.kind === 'group' ? `Звонок · ${room.name}` : `${ch?.name || 'Голосовой канал'} / ${room?.name || ''}`;
    openAct = `data-act="open-voice-room" data-room="${V.roomId || ''}" data-vc="${V.channelId || ''}"`;
  } else if (C.phase) {
    const u = userOf(C.peerId);
    title = C.phase === 'active' ? 'Звонок' : C.phase === 'incoming' ? 'Входящий звонок' : 'Вызов…';
    state = C.phase === 'active' ? 'ok' : 'wait';
    sub = u.username;
    leaveAct = 'call-hangup';
    openAct = `data-act="open-dm" data-peer="${C.peerId}"`;
  } else return '';
  const timer = V.channelId ? elapsed(V.joinedAt) : C.phase === 'active' ? elapsed(C.startedAt) : '';
  const pingTip = V.pingMs == null ? 'Пинг: измеряем…' : `Пинг: ${V.pingMs} мс`;
  const pingCls = V.pingMs == null ? '' : V.pingMs >= 160 ? ' is-bad' : V.pingMs >= 80 ? ' is-mid' : '';
  return `<div class="cv2-vpanel is-${state}">
    <div class="cv2-vpanel__top">
      <button type="button" class="cv2-vpanel__sig${pingCls}" data-act="vc-ping" data-tip="${esc(pingTip)}" data-tip-side="top">${IC.signal(16)}</button>
      <button type="button" class="cv2-vpanel__info" ${openAct}>
        <span class="cv2-vpanel__title">${esc(title)}</span>
        <span class="cv2-vpanel__sub">${esc(sub)}${timer ? ` · <span data-timer="${V.channelId ? V.joinedAt : C.startedAt}">${timer}</span>` : ''}</span>
      </button>
      <button type="button" class="cv2-vctl is-leave is-sm" data-act="${leaveAct}" data-tip="Отключиться">${VCI.hangup(14)}</button>
    </div>
    ${voiceControls(C.phase && !V.channelId ? 'call' : 'voice', 'panel')}
  </div>`;
}

export function tickTimers(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('[data-timer]').forEach((el) => {
    el.textContent = elapsed(Number(el.dataset.timer));
  });
  const sig = root.querySelector<HTMLElement>('.cv2-vpanel__sig');
  if (!sig) return;
  const ms = V.pingMs;
  sig.dataset.tip = ms == null ? 'Пинг: измеряем…' : `Пинг: ${ms} мс`;
  sig.classList.toggle('is-mid', ms != null && ms >= 80 && ms < 160);
  sig.classList.toggle('is-bad', ms != null && ms >= 160);
  refreshOpenTip();
}
