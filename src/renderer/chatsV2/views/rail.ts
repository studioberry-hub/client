// Колонка серверов (72px): «Домой», ЛС с непрочитанными, серверы, обзор и создание.
import { IC, IMG } from '../icons';
import { S, homeBadgeCount, servers, userOf } from '../store';
import { V } from '../rtc';
import { avatarHtml, esc, groupColor, initials, sameId } from '../util';
import type { Room } from '../types';

function badge(n: number): string {
  if (!n) return '';
  return `<span class="cv2-badge">${n > 99 ? '99+' : n}</span>`;
}

/** Порядок серверов: пользовательский (DnD) + новые в конце. */
export function orderedServers(): Room[] {
  const list = servers();
  const order = S.ui.railOrder;
  const pos = new Map(order.map((id, i) => [id, i]));
  return [...list].sort((a, b) => {
    const pa = pos.has(a.id) ? pos.get(a.id)! : 1e6 + a.id;
    const pb = pos.has(b.id) ? pos.get(b.id)! : 1e6 + b.id;
    return pa - pb;
  });
}

function serverPill(r: Room): string {
  const v = S.view;
  const active = v.kind === 'server' && v.roomId === r.id;
  const unread = (r.unread_count || 0) > 0;
  const mention = r.mention_count || 0;
  const inVoice = sameId(V.roomId, r.id);
  const img = r.avatar_url ? avatarHtml(r.name, r.avatar_url, r.avatar_color, { size: 40, cls: 'cv2-pill__img' }) : '';
  return `<div class="cv2-rail__item ${active ? 'is-active' : ''} ${unread ? 'is-unread' : ''}" data-rail-id="${r.id}" draggable="true">
    <span class="cv2-rail__pip"></span>
    <button type="button" class="cv2-pill" data-act="open-server" data-room="${r.id}" data-tip="${esc(r.name)}" data-tip-side="right">
      ${img || `<span class="cv2-pill__txt">${esc(initials(r.name))}</span>`}
      ${inVoice ? `<span class="cv2-pill__voice">${IC.speaker(10)}</span>` : ''}
      ${badge(mention)}
    </button>
  </div>`;
}

export function renderRail(): string {
  const v = S.view;
  const homeActive = v.kind === 'friends' || v.kind === 'worlds' || v.kind === 'invites';
  const homeN = homeBadgeCount();
  // ЛС над разделителем: с непрочитанными + открытая сейчас беседа (как в референсе)
  const dmItems = S.dms
    .filter((d) => (d.unread_count || 0) > 0 || (v.kind === 'dm' && v.peerId === d.peer_id))
    .slice(0, 6)
    .map((d) => {
      const u = userOf(d.peer_id);
      const active = v.kind === 'dm' && v.peerId === d.peer_id;
      return `<div class="cv2-rail__item is-dm ${active ? 'is-active' : ''}">
        <span class="cv2-rail__pip"></span>
        <button type="button" class="cv2-pill is-round" data-act="open-dm" data-peer="${d.peer_id}" data-tip="${esc(u.username)}" data-tip-side="right">
          ${avatarHtml(u.username, u.avatar_url || d.peer_avatar_url, u.avatar_color || d.peer_avatar_color, { size: 40 })}
          ${badge(d.unread_count || 0)}
        </button>
      </div>`;
    })
    .join('');
  const groupItems = S.rooms
    .filter((r) => r.kind === 'group' && ((r.unread_count || 0) > 0 || (v.kind === 'group' && v.roomId === r.id)))
    .slice(0, 4)
    .map((g) => {
      const active = v.kind === 'group' && v.roomId === g.id;
      return `<div class="cv2-rail__item is-dm ${active ? 'is-active' : ''}">
        <span class="cv2-rail__pip"></span>
        <button type="button" class="cv2-pill is-round is-group" data-act="open-group" data-room="${g.id}" data-tip="${esc(g.name)}" data-tip-side="right" style="--g:${groupBg(g)};--cv2-ico-cut:${groupBg(g)}">
          ${IC.group(22)}
          ${badge(g.unread_count || 0)}
        </button>
      </div>`;
    })
    .join('');
  return `
    <div class="cv2-rail__item ${homeActive || v.kind === 'dm' || v.kind === 'group' ? 'is-active' : ''} is-home">
      <span class="cv2-rail__pip"></span>
      <button type="button" class="cv2-pill is-home ${homeActive ? 'is-on' : ''}" data-act="open-home" data-tip="Личные сообщения" data-tip-side="right">
        ${IC.home(20)}
        ${badge(homeN)}
      </button>
    </div>
    ${dmItems}${groupItems}
    <div class="cv2-rail__sep"></div>
    <div class="cv2-rail__list" id="cv2-rail-list">${orderedServers().map(serverPill).join('')}</div>
    <div class="cv2-rail__item">
      <button type="button" class="cv2-pill is-tool" data-act="join-server" data-tip="Присоединиться к серверу" data-tip-side="right">${IMG.explore(20)}</button>
    </div>
    <div class="cv2-rail__item">
      <button type="button" class="cv2-pill is-tool" data-act="create-server" data-tip="Создать сервер" data-tip-side="right">${IMG.newServer(20)}</button>
    </div>`;
}

function groupBg(g: Room): string {
  return groupColor(g.id);
}

/** DnD-перестановка серверов в rail; порядок сохраняется в localStorage. */
export function bindRailDnd(railEl: HTMLElement, onReorder: (ids: number[]) => void): void {
  let dragId: number | null = null;
  railEl.addEventListener('dragstart', (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('[data-rail-id]');
    if (!item) return;
    dragId = Number(item.dataset.railId);
    item.classList.add('is-drag');
    e.dataTransfer?.setData('text/plain', String(dragId));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  });
  railEl.addEventListener('dragover', (e) => {
    if (dragId == null) return;
    const item = (e.target as HTMLElement).closest<HTMLElement>('[data-rail-id]');
    if (!item) return;
    e.preventDefault();
    const r = item.getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    railEl.querySelectorAll('.is-drop-before, .is-drop-after').forEach((n) => n.classList.remove('is-drop-before', 'is-drop-after'));
    item.classList.add(after ? 'is-drop-after' : 'is-drop-before');
  });
  railEl.addEventListener('drop', (e) => {
    if (dragId == null) return;
    const item = (e.target as HTMLElement).closest<HTMLElement>('[data-rail-id]');
    e.preventDefault();
    const list = Array.from(railEl.querySelectorAll<HTMLElement>('[data-rail-id]')).map((n) => Number(n.dataset.railId));
    const from = list.indexOf(dragId);
    if (item && from >= 0) {
      const target = Number(item.dataset.railId);
      list.splice(from, 1);
      let to = list.indexOf(target);
      if (item.classList.contains('is-drop-after')) to += 1;
      list.splice(to, 0, dragId);
      onReorder(list);
    }
  });
  railEl.addEventListener('dragend', () => {
    dragId = null;
    railEl.querySelectorAll('.is-drag, .is-drop-before, .is-drop-after').forEach((n) => n.classList.remove('is-drag', 'is-drop-before', 'is-drop-after'));
  });
}
