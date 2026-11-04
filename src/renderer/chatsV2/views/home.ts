// Домашние экраны: «Друзья» (вкладки, добавление, заявки, активность) и «Приглашения» на серверы.
import { IC, assetMask } from '../icons';
import { S, gameIcon, isOnline, myGame, roomById, userOf } from '../store';
import { openFriendWorlds, playersAt, type LiveWorld } from '../worlds';
import { avatarHtml, botBadge, esc, fmtDate, plural } from '../util';
import { statusLine, userAvatar } from './sidebar';
import { lanHostView, type LanHostView } from '../../messenger/ui';
import type { FriendUser, FriendsTab } from '../types';

// ===== Шапка «Друзья» =====

export function renderFriendsHead(tab: FriendsTab): string {
  const inc = S.friends.incoming.length;
  const tabs: Array<[FriendsTab, string, number]> = [
    ['online', 'В сети', 0],
    ['all', 'Все друзья', 0],
    ['pending', 'Заявки в друзья', inc],
  ];
  if (S.friends.blocked.length) tabs.push(['blocked', 'Заблокированные', 0]);
  return `<div class="cv2-head__title">
      <span class="cv2-head__ico">${IC.friends(18)}</span>
      <span class="cv2-head__name">Друзья</span>
      <span class="cv2-head__dot"></span>
      <div class="cv2-tabs" role="tablist">
        ${tabs
          .map(
            ([id, label, n]) =>
              `<button type="button" role="tab" class="cv2-tab ${tab === id ? 'is-active' : ''}" data-act="friends-tab" data-tab="${id}">${label}${
                n ? `<span class="cv2-badge is-inline">${n}</span>` : ''
              }</button>`,
          )
          .join('')}
      </div>
    </div>
    <div class="cv2-head__tools">
      <button type="button" class="cv2-ibtn" data-act="create-group" data-tip="Новая группа в ЛС" data-tip-side="bottom">${IC.newDm(16)}</button>
      <button type="button" class="cv2-ibtn ${tab === 'add' ? 'is-on' : ''}" data-act="friends-tab" data-tab="add" data-tip="Добавить друга" data-tip-side="bottom">${IC.addFriend(16)}</button>
    </div>`;
}

// ===== Строки друзей =====

function friendRow(f: FriendUser, mode: 'friend' | 'incoming' | 'outgoing' | 'blocked'): string {
  const u = userOf(f.id);
  let sub = statusLine(f.id);
  let actions = '';
  if (mode === 'friend') {
    actions = `<button type="button" class="cv2-rbtn" data-act="open-dm" data-peer="${f.id}" data-tip="Написать">${IC.chat(16)}</button>
      <button type="button" class="cv2-rbtn" data-act="friend-more" data-uid="${f.id}" data-tip="Ещё">${IC.dotsV(16)}</button>`;
  } else if (mode === 'incoming') {
    sub = 'Входящий запрос дружбы';
    actions = `<button type="button" class="cv2-rbtn is-accept" data-act="friend-accept" data-uid="${f.id}" data-tip="Принять">${IC.check(18)}</button>
      <button type="button" class="cv2-rbtn is-decline" data-act="friend-decline" data-uid="${f.id}" data-tip="Отклонить">${IC.close(16)}</button>`;
  } else if (mode === 'outgoing') {
    sub = 'Исходящий запрос дружбы';
    actions = `<button type="button" class="cv2-rbtn is-decline" data-act="friend-decline" data-uid="${f.id}" data-tip="Отменить">${IC.close(16)}</button>`;
  } else {
    sub = 'Заблокирован';
    actions = `<button type="button" class="cv2-btn is-ghost is-sm" data-act="friend-unblock" data-uid="${f.id}">Разблокировать</button>`;
  }
  return `<div class="cv2-frow" data-act="${mode === 'friend' ? 'open-dm' : 'user'}" data-peer="${f.id}" data-uid="${f.id}" data-ctx="friend">
    ${userAvatar(f.id, 32, 'var(--cv2-bg-main)')}
    <span class="cv2-frow__text">
      <span class="cv2-frow__name">${esc(u.username)}${u.bot ? botBadge() : ''}</span>
      <span class="cv2-frow__sub">${esc(sub)}</span>
    </span>
    <span class="cv2-frow__actions">${actions}</span>
  </div>`;
}

function filterQ(list: FriendUser[]): FriendUser[] {
  const q = S.ui.friendsQuery.trim().toLowerCase();
  return q ? list.filter((f) => userOf(f.id).username.toLowerCase().includes(q)) : list;
}

function emptyState(title: string, text: string): string {
  return `<div class="cv2-empty">
    <div class="cv2-empty__art">${IC.friends(44)}</div>
    <div class="cv2-empty__title">${esc(title)}</div>
    <div class="cv2-empty__text">${esc(text)}</div>
  </div>`;
}

function searchBox(): string {
  return `<label class="cv2-search">
    ${IC.search(18)}
    <input type="search" data-input="friends-q" placeholder="Поиск друзей" value="${esc(S.ui.friendsQuery)}" autocomplete="off">
  </label>`;
}

function addFriendView(): string {
  const st = S.ui.addFriendStatus;
  return `<div class="cv2-addfriend">
    <div class="cv2-addfriend__title">Добавить в друзья</div>
    <div class="cv2-addfriend__hint">Добавляйте друзей по нику GameSync или по числовому ID.</div>
    <form class="cv2-addfriend__box ${st ? (st.ok ? 'is-ok' : 'is-err') : ''}" data-form="add-friend">
      <input type="text" data-input="add-friend" placeholder="Ник или ID" autocomplete="off" maxlength="32" autofocus>
      <button type="submit" class="cv2-btn is-primary" data-add-friend-btn disabled>Отправить запрос дружбы</button>
    </form>
    ${st ? `<div class="cv2-addfriend__status ${st.ok ? 'is-ok' : 'is-err'}">${esc(st.text)}</div>` : ''}
    <div class="cv2-addfriend__sep"></div>
    ${
      S.friends.outgoing.length
        ? `<div class="cv2-list-label">Отправленные заявки — ${S.friends.outgoing.length}</div>${S.friends.outgoing
            .map((f) => friendRow(f, 'outgoing'))
            .join('')}`
        : emptyState('Найдите своих', 'Отправьте заявку — когда её примут, друг появится в списке, а вы увидите, во что он играет.')
    }
  </div>`;
}

export function renderFriendsBody(tab: FriendsTab): string {
  let main = '';
  if (tab === 'add') {
    main = addFriendView();
  } else if (tab === 'pending') {
    const inc = filterQ(S.friends.incoming);
    const out = filterQ(S.friends.outgoing);
    main = `${searchBox()}${
      inc.length || out.length
        ? `${inc.length ? `<div class="cv2-list-label">Входящие — ${inc.length}</div>${inc.map((f) => friendRow(f, 'incoming')).join('')}` : ''}
           ${out.length ? `<div class="cv2-list-label">Исходящие — ${out.length}</div>${out.map((f) => friendRow(f, 'outgoing')).join('')}` : ''}`
        : emptyState('Нет заявок', 'Здесь появятся входящие и исходящие запросы дружбы.')
    }`;
  } else if (tab === 'blocked') {
    const list = filterQ(S.friends.blocked);
    main = `${searchBox()}<div class="cv2-list-label">Заблокированные — ${list.length}</div>${list.map((f) => friendRow(f, 'blocked')).join('')}`;
  } else {
    const all = S.friends.friends;
    const base = tab === 'online' ? all.filter((f) => isOnline(f.id)) : all;
    const list = filterQ(base).sort((a, b) => Number(isOnline(b.id)) - Number(isOnline(a.id)) || userOf(a.id).username.localeCompare(userOf(b.id).username, 'ru'));
    const label = tab === 'online' ? `В сети — ${list.length}` : `Все друзья — ${list.length}`;
    main = `${searchBox()}${
      list.length
        ? `<div class="cv2-list-label">${label}</div><div class="cv2-flist">${list.map((f) => friendRow(f, 'friend')).join('')}</div>`
        : all.length
          ? emptyState(S.ui.friendsQuery ? 'Никого не найдено' : 'Никого нет в сети', S.ui.friendsQuery ? 'Попробуйте другое имя.' : 'Сейчас все друзья не в сети. Загляните позже.')
          : emptyState('Пока без друзей', 'Добавьте друга по имени пользователя — кнопка справа сверху.')
    }`;
  }
  return `<div class="cv2-friends">
    <section class="cv2-friends__main">${main}</section>
    <aside class="cv2-activity">${renderActivity()}</aside>
  </div>`;
}

// ===== Активность друзей =====

export function renderActivity(): string {
  const cards: string[] = [];
  const voiceSeen = new Set<number>();
  for (const f of S.friends.friends) {
    const vp = f.voice;
    if (!vp || voiceSeen.has(vp.channel_id) || !isOnline(f.id)) continue;
    voiceSeen.add(vp.channel_id);
    const ids = (S.voiceMembers.get(vp.channel_id) || vp.member_ids || []).filter((id) => id !== S.me.id);
    const friendsIn = ids.filter((id) => S.friends.friends.some((x) => x.id === id));
    const shown = (friendsIn.length ? friendsIn : [f.id]).slice(0, 2);
    const names = shown.map((id) => userOf(id).username);
    const extra = Math.max(0, (friendsIn.length || 1) - shown.length);
    const title = extra ? `${names.join(', ')} и ещё ${extra}` : names.join(' и ');
    const canOpen = Boolean(roomById(vp.room_id));
    const place = vp.room_kind === 'group' ? 'Групповой звонок' : `${vp.channel_name} · ${vp.room_name}`;
    cards.push(`<div class="cv2-acard ${canOpen ? 'is-link' : ''}" ${canOpen ? `data-act="open-voice-room" data-room="${vp.room_id}" data-vc="${vp.channel_id}"` : ''} data-tip="${esc(place)}">
      <span class="cv2-acard__stack">${shown
        .map((id) => {
          const u = userOf(id);
          return avatarHtml(u.username, u.avatar_url, u.avatar_color, { size: 32 });
        })
        .join('')}</span>
      <span class="cv2-acard__text"><span class="cv2-acard__name">${esc(title)}</span><span class="cv2-acard__sub">В голосовом канале</span></span>
      <span class="cv2-acard__tile is-voice"><span class="cv2-acard__mic">${IC.speakerFill(16)}</span></span>
    </div>`);
  }
  for (const world of openFriendWorlds()) {
    const players = playersAt(world.serverHost);
    const names = players.map((p) => p.username);
    const shown = (players.length ? players : [{ userId: world.userId, username: world.username }]).slice(0, 3);
    const who = names.length ? `В мире: ${names.join(', ')}` : `В мире: ${world.username}`;
    cards.push(`<div class="cv2-acard is-link" data-act="world-join" data-uid="${world.userId}" data-tip="${esc(world.serverHost)}">
      <span class="cv2-acard__stack">${shown
        .map((p) => {
          const u = userOf(p.userId);
          return avatarHtml(u.username || p.username, u.avatar_url, u.avatar_color, { size: 32 });
        })
        .join('')}</span>
      <span class="cv2-acard__text"><span class="cv2-acard__name">${esc(world.serverName || 'Мир по сети')}</span><span class="cv2-acard__sub">${esc(who)}</span></span>
      <span class="cv2-acard__tile">${IC.gamepad(18)}</span>
    </div>`);
  }
  for (const f of S.friends.friends) {
    const game = myGame(f.id);
    if (!game || !isOnline(f.id)) continue;
    const icon = gameIcon(game);
    const u = userOf(f.id);
    cards.push(`<div class="cv2-acard is-link" data-act="open-dm" data-peer="${f.id}">
      ${userAvatar(f.id, 32, 'var(--cv2-card)', false)}
      <span class="cv2-acard__text"><span class="cv2-acard__name">${esc(u.username)}</span><span class="cv2-acard__sub">${esc(game)}</span></span>
      <span class="cv2-acard__tile">${icon ? `<img src="${esc(icon)}" alt="" onerror="this.remove()">` : IC.gamepad(18)}</span>
    </div>`);
  }
  return `<div class="cv2-activity__title">Активность друзей</div>
    ${
      cards.length
        ? `<div class="cv2-activity__list">${cards.join('')}</div>`
        : `<div class="cv2-activity__empty">
            <div class="cv2-activity__empty-title">Сейчас тут тихо…</div>
            <div class="cv2-activity__empty-text">Когда друг начнёт играть или зайдёт в голосовой канал, это появится здесь.</div>
          </div>`
    }`;
}

// ===== Миры по сети =====

function pingSvg(tone: string): string {
  const dim = 'rgba(255,255,255,0.15)';
  const bars: Record<string, [string, string, string, string]> = {
    good: ['#27C37F', '#27C37F', '#27C37F', '#27C37F'],
    mid: ['#92E440', '#92E440', '#92E440', dim],
    slow: ['#FFC04C', '#FFC04C', dim, dim],
    bad: ['#FF4C4C', dim, dim, dim],
    off: [dim, dim, dim, dim],
  };
  const [short, mid, tall, top] = bars[tone] || bars.off!;
  return `<svg class="cv2-scard__ping" width="18" height="12" viewBox="0 0 18 12" aria-hidden="true"><rect x="15" width="3" height="12" rx="1" fill="${top}"/><rect x="10" y="2" width="3" height="10" rx="1" fill="${tall}"/><rect x="5" y="4" width="3" height="8" rx="1" fill="${mid}"/><rect y="6" width="3" height="6" rx="1" fill="${short}"/></svg>`;
}

function worldCardHtml(world: LiveWorld, mine = false): string {
  const players = playersAt(world.serverHost);
  const u = userOf(world.userId);
  const who = players.length ? players.map((p) => p.username).join(', ') : world.username;
  const desc = [world.build, world.version].filter(Boolean).join(' · ');
  const count = String(players.length || 1);
  return `<article class="cv2-scard" data-addr="${esc(world.serverHost)}" data-tone="off">
    <div class="cv2-scard__ico">${avatarHtml(u.username || world.username, u.avatar_url, u.avatar_color, { size: 42 })}</div>
    <div class="cv2-scard__main">
      <div class="cv2-scard__name">${esc(world.serverName || 'Мир по сети')}</div>
      <div class="cv2-scard__desc">${esc(desc || (mine ? 'Ваш мир' : world.username))}</div>
      <div class="cv2-scard__addr">${esc(world.serverHost)}</div>
    </div>
    <div class="cv2-scard__side">
      <span class="cv2-scard__players" title="${esc(who)}">${count}</span>
      ${pingSvg('off')}
      <span class="cv2-scard__ms">—</span>
    </div>
    <div class="cv2-scard__acts">
      ${mine ? '' : `<button type="button" class="cv2-btn is-primary is-sm" data-act="world-join" data-uid="${world.userId}">Войти</button>`}
      <button type="button" class="cv2-btn is-sm" data-act="world-copy" data-href="${esc(world.serverHost)}">Копировать</button>
    </div>
  </article>`;
}

function myWorldCard(hostView: LanHostView): string {
  if (hostView.open && hostView.addr) {
    const me = userOf(S.me.id);
    const world: LiveWorld = {
      userId: Number(S.me.id) || 0,
      siteId: '',
      username: me.username || 'Вы',
      playing: true,
      hosting: true,
      worldShare: true,
      serverHost: hostView.addr,
      serverName: hostView.name || 'Мой мир',
      build: hostView.build,
      version: [hostView.version, hostView.loader].filter(Boolean).join(' · '),
      sessionId: '',
    };
    return `<div class="cv2-scard-wrap">
      ${worldCardHtml(world, true)}
      <div class="cv2-scard__foot">
        <button type="button" class="cv2-btn is-primary is-sm" data-act="world-invite">Пригласить друзей</button>
        <button type="button" class="cv2-btn is-sm" data-act="world-close">Закрыть мир</button>
      </div>
    </div>`;
  }
  const hint = !hostView.gameOn
    ? 'Запустите сборку, в мире нажмите «Открыть для сети» — и мир появится здесь.'
    : !hostView.lanReady
      ? 'Игра запущена. В меню мира выберите «Открыть для сети», затем нажмите кнопку ниже.'
      : 'Мир в игре уже открыт для сети. Нажмите кнопку — друзья увидят карточку на этом экране, без сообщений в чат.';
  return `<article class="cv2-scard is-mine">
    <div class="cv2-scard__ico">${avatarHtml(S.me.username || 'Вы', S.me.avatar, S.me.color, { size: 42 })}</div>
    <div class="cv2-scard__main">
      <div class="cv2-scard__name">Мой мир</div>
      <div class="cv2-scard__desc">${esc(hint)}</div>
    </div>
    <div class="cv2-scard__acts">
      <button type="button" class="cv2-btn is-primary is-sm" data-act="world-open" ${hostView.gameOn ? '' : 'disabled'}>Открыть по сети</button>
    </div>
  </article>`;
}

export function renderWorldsHead(): string {
  const n = openFriendWorlds().length;
  const mine = lanHostView();
  return `<div class="cv2-head__title">
      <span class="cv2-head__ico">${assetMask('worlds', 18)}</span>
      <span class="cv2-head__name">Миры по сети</span>
      ${n ? `<span class="cv2-badge">${n}</span>` : ''}
    </div>
    ${
      mine.open
        ? `<div class="cv2-head__tools"><button type="button" class="cv2-btn is-ghost is-sm" data-act="world-invite">Пригласить друзей</button></div>`
        : ''
    }`;
}

export function renderWorldsBody(): string {
  const mine = myWorldCard(lanHostView());
  const worlds = openFriendWorlds();
  const cards = worlds.map((world) => worldCardHtml(world)).join('');
  const empty = worlds.length
    ? ''
    : `<div class="cv2-empty">
        <div class="cv2-empty__title">Сейчас никто из друзей не открыл мир</div>
        <div class="cv2-empty__text">Когда друг откроет мир, карточка с адресом и пингом появится здесь. Зайти можно сразу, без сообщения в чат.</div>
      </div>`;
  return `<div class="cv2-page"><div class="cv2-worlds">${mine}${cards}${empty}</div></div>`;
}

const pingCache = new Map<string, { at: number; tone: string; ms: string; players: string; motd: string; version: string }>();

/** Пинг и онлайн карточек миров — тем же запросом, что каталог серверов. */
export function probeWorldPings(): void {
  const api = (window as unknown as { electronAPI?: { serverStatus?: (addr: string) => Promise<any> } }).electronAPI;
  if (!api?.serverStatus) return;
  document.querySelectorAll<HTMLElement>('.cv2-scard[data-addr]').forEach((card) => {
    const addr = card.dataset.addr || '';
    if (!addr) return;
    const known = pingCache.get(addr);
    const apply = (row: { tone: string; ms: string; players: string; motd: string; version: string }) => {
      if (!card.isConnected) return;
      card.dataset.tone = row.tone;
      const ping = card.querySelector('.cv2-scard__ping');
      if (ping) ping.outerHTML = pingSvg(row.tone);
      const ms = card.querySelector('.cv2-scard__ms');
      if (ms) ms.textContent = row.ms;
      const players = card.querySelector('.cv2-scard__players');
      if (players && row.players) players.textContent = row.players;
    };
    if (known && Date.now() - known.at < 20000) {
      apply(known);
      return;
    }
    void api.serverStatus!(addr).then((st) => {
      const online = Boolean(st?.online);
      const latency = Number(st?.latency);
      const tone = !online ? 'off' : !Number.isFinite(latency) || latency <= 80 ? 'good' : latency <= 140 ? 'mid' : latency <= 220 ? 'slow' : 'bad';
      const motd = Array.isArray(st?.motd?.clean) ? st.motd.clean.join(' ').replace(/\s+/g, ' ').trim().slice(0, 140) : '';
      const row = {
        at: Date.now(),
        tone,
        ms: online && Number.isFinite(latency) && latency > 0 ? `${Math.round(latency)} мс` : online ? 'в сети' : 'нет связи',
        players: st?.players?.online != null ? String(st.players.online) : '',
        motd,
        version: String(st?.version || '').split('\n')[0] || '',
      };
      pingCache.set(addr, row);
      apply(row);
      if (motd) {
        const desc = card.querySelector('.cv2-scard__desc');
        if (desc && !desc.textContent) desc.textContent = motd;
      }
    }).catch(() => undefined);
  });
}

// ===== Приглашения =====

export function renderInvitesHead(): string {
  return `<div class="cv2-head__title">
      <span class="cv2-head__ico">${assetMask('invites', 18)}</span>
      <span class="cv2-head__name">Приглашения</span>
    </div>
    <div class="cv2-head__tools">
      <button type="button" class="cv2-btn is-ghost is-sm" data-act="join-server">${IC.link(14)}<span>Ввести код приглашения</span></button>
    </div>`;
}

export function renderInvitesBody(): string {
  if (!S.inbox.length) {
    return `<div class="cv2-page">
      <div class="cv2-empty is-big">
        <div class="cv2-empty__art">${assetMask('invites', 48)}</div>
        <div class="cv2-empty__title">Нет новых приглашений</div>
        <div class="cv2-empty__text">Когда друг пригласит вас на сервер, приглашение появится здесь. Есть код? Введите его ниже.</div>
        <form class="cv2-inline-form" data-form="join-code">
          <input class="cv2-input" data-input="join-code" placeholder="Код приглашения, например hX7k2Q" maxlength="64">
          <button type="submit" class="cv2-btn is-primary">Присоединиться</button>
        </form>
      </div>
    </div>`;
  }
  const cards = S.inbox
    .map((inv) => {
      const r = inv.room;
      const who = inv.inviter ? userOf(inv.inviter.id).username : 'Кто-то';
      return `<div class="cv2-invite" data-invite="${inv.id}">
        <div class="cv2-invite__banner" style="--c:${esc(r.avatar_color || '#303030')}"></div>
        <div class="cv2-invite__body">
          <div class="cv2-invite__icon">${avatarHtml(r.name, r.avatar_url, r.avatar_color, { size: 56, cls: 'is-square', letters: true })}</div>
          <div class="cv2-invite__who">${esc(who)} приглашает вас на сервер</div>
          <div class="cv2-invite__name">${esc(r.name)}</div>
          <div class="cv2-invite__stats">
            <span><i class="cv2-dot is-online"></i>${r.members_online} в сети</span>
            <span><i class="cv2-dot"></i>${r.members_total} ${plural(r.members_total, 'участник', 'участника', 'участников')}</span>
          </div>
          ${r.description ? `<div class="cv2-invite__desc">${esc(r.description)}</div>` : ''}
          <div class="cv2-invite__actions">
            <button type="button" class="cv2-btn is-ghost" data-act="invite-decline" data-id="${inv.id}">Отклонить</button>
            <button type="button" class="cv2-btn is-success" data-act="invite-accept" data-id="${inv.id}">Принять</button>
          </div>
          ${inv.created_at ? `<div class="cv2-invite__date">${esc(fmtDate(inv.created_at))}</div>` : ''}
        </div>
      </div>`;
    })
    .join('');
  return `<div class="cv2-page">
    <div class="cv2-list-label">Ожидают ответа — ${S.inbox.length}</div>
    <div class="cv2-invites">${cards}</div>
  </div>`;
}
