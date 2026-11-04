// Сводка для меню «Почта»: непрочитанные, упоминания, приглашения и конфликты синхронизации.
import { S, allTextChannels, roomById } from './store';

export type MailItem = {
  id: string;
  tab: 'unread' | 'mentions' | 'conflicts' | 'invites';
  title: string;
  body: string;
  kind: 'dm' | 'group' | 'server' | 'invite' | 'conflict';
  roomId?: number;
  peerId?: number;
  channelId?: number;
};

type ConflictRow = { rel: string; gameId: number };

function conflictRows(): ConflictRow[] {
  const bag = (window as Window & { __gsConflicts?: ConflictRow[] }).__gsConflicts;
  return Array.isArray(bag) ? bag : [];
}

function channelOf(channelId: number): { roomId: number; name: string; room: string } | null {
  for (const [roomId, detail] of S.details) {
    const ch = allTextChannels(detail).find((c) => c.id === channelId);
    if (!ch) continue;
    return { roomId, name: ch.name, room: detail.name || roomById(roomId)?.name || 'Сервер' };
  }
  return null;
}

export function collectMail(): MailItem[] {
  const items: MailItem[] = [];
  for (const d of S.dms) {
    const name = d.peer_username || 'Личные сообщения';
    const preview = (d.last_message?.text || 'Новое сообщение').replace(/\s+/g, ' ').slice(0, 120);
    if ((d.unread_count || 0) > 0) {
      items.push({ id: `u-dm-${d.peer_id}`, tab: 'unread', title: name, body: preview, kind: 'dm', peerId: d.peer_id });
    }
    if ((d.mention_count || 0) > 0) {
      items.push({
        id: `m-dm-${d.peer_id}`,
        tab: 'mentions',
        title: name,
        body: 'Вас упомянули в личных сообщениях',
        kind: 'dm',
        peerId: d.peer_id,
      });
    }
  }
  for (const r of S.rooms) {
    if (r.kind !== 'group') continue;
    const preview = (r.last_message?.text || 'Новое сообщение').replace(/\s+/g, ' ').slice(0, 120);
    if ((r.unread_count || 0) > 0) {
      items.push({ id: `u-g-${r.id}`, tab: 'unread', title: r.name, body: preview, kind: 'group', roomId: r.id });
    }
    if ((r.mention_count || 0) > 0) {
      items.push({ id: `m-g-${r.id}`, tab: 'mentions', title: r.name, body: 'Вас упомянули в группе', kind: 'group', roomId: r.id });
    }
  }
  const roomsWithMention = new Set<number>();
  const roomsWithUnread = new Set<number>();
  for (const [cid, un] of S.chUnread) {
    const ref = channelOf(cid);
    if (!ref) continue;
    if (un.u > 0) {
      roomsWithUnread.add(ref.roomId);
      items.push({
        id: `u-ch-${cid}`,
        tab: 'unread',
        title: `#${ref.name}`,
        body: ref.room,
        kind: 'server',
        roomId: ref.roomId,
        channelId: cid,
      });
    }
    if (un.m > 0) {
      roomsWithMention.add(ref.roomId);
      items.push({
        id: `m-ch-${cid}`,
        tab: 'mentions',
        title: `#${ref.name}`,
        body: `Упоминание · ${ref.room}`,
        kind: 'server',
        roomId: ref.roomId,
        channelId: cid,
      });
    }
  }
  for (const r of S.rooms) {
    if (r.kind === 'group') continue;
    const preview = (r.last_message?.text || 'Новые сообщения').replace(/\s+/g, ' ').slice(0, 120);
    if ((r.unread_count || 0) > 0 && !roomsWithUnread.has(r.id)) {
      items.push({ id: `u-r-${r.id}`, tab: 'unread', title: r.name, body: preview, kind: 'server', roomId: r.id });
    }
    if ((r.mention_count || 0) > 0 && !roomsWithMention.has(r.id)) {
      items.push({
        id: `m-r-${r.id}`,
        tab: 'mentions',
        title: r.name,
        body: 'Вас упомянули на сервере',
        kind: 'server',
        roomId: r.id,
      });
    }
  }
  for (const inv of S.inbox) {
    const who = inv.inviter?.username || 'Кто-то';
    items.push({
      id: `inv-${inv.id}`,
      tab: 'invites',
      title: inv.room.name,
      body: `${who} приглашает вас`,
      kind: 'invite',
      roomId: inv.room.id,
    });
  }
  conflictRows().forEach((c, i) => {
    items.push({
      id: `cf-${c.gameId}-${i}`,
      tab: 'conflicts',
      title: c.rel || 'Файл',
      body: 'Файл изменён и локально, и на сервере',
      kind: 'conflict',
    });
  });
  return items;
}
