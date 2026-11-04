// Голосовые сцены: экран голосового канала сервера и области звонка над лентой (ЛС и группа).
import { IC, VCI } from '../icons';
import { S, allVoiceChannels, groupVoiceId, roomById, userOf } from '../store';
import { C, V, channelMembers } from '../rtc';
import { avatarHtml, esc, sameId } from '../util';

// ===== Однократная анимация появления плиток =====

// Плитка «выпрыгивает» только когда участник впервые появился в текущем подключении.
// Перерисовки (мьют, список участников) и переходы между экранами анимацию не перезапускают;
// если перерисовка пришлась на середину анимации — она продолжается с того же места.
const ENTER_MS = 420;
const seenAt = new Map<number, number>();
let seenScope = '';

function enterAttrs(scope: string, uid: number): { cls: string; style: string } {
  if (scope !== seenScope) {
    seenScope = scope;
    seenAt.clear();
  }
  const now = Date.now();
  let t = seenAt.get(uid);
  if (t == null) {
    t = now;
    seenAt.set(uid, t);
  }
  const age = now - t;
  return age < ENTER_MS ? { cls: ' is-enter', style: ` style="animation-delay:-${age}ms"` } : { cls: '', style: '' };
}

// ===== Плитки участников =====

function tile(uid: number, scope: string, size: 'lg' | 'md' = 'lg'): string {
  const u = userOf(uid);
  const me = sameId(uid, S.me.id);
  const muted = me ? V.muted : V.selfMuted.has(uid) || V.serverMuted.has(uid);
  const deaf = me ? V.deafened : V.selfDeafened.has(uid);
  const speaking = V.speaking.has(uid) || (C.phase === 'active' && sameId(uid, C.peerId) && C.remoteSpeaking);
  const enter = enterAttrs(scope, uid);
  const badges = `${muted ? `<span class="cv2-tile__badge" data-tip="Микрофон выключен">${VCI.micOff(14)}</span>` : ''}${deaf ? `<span class="cv2-tile__badge" data-tip="Звук выключен">${VCI.soundOff(14)}</span>` : ''}`;
  return `<div class="cv2-tile is-${size}${speaking ? ' is-speaking' : ''}${enter.cls}" data-speak-uid="${uid}" data-act="user" data-uid="${uid}" data-ctx="voice-user"${enter.style}>
    ${avatarHtml(u.username, u.avatar_url, u.avatar_color, { size: size === 'lg' ? 64 : 52 })}
    <span class="cv2-tile__name"><span>${esc(u.username)}</span>${badges}</span>
  </div>`;
}

// ===== Кнопки управления голосом =====

/** Микрофон и звук с селекторами устройств, настройки и отключение — как в прошлом UI. */
export function voiceControls(kind: 'voice' | 'call', variant: 'stage' | 'panel'): string {
  const leave = kind === 'call' ? 'call-hangup' : 'vc-leave';
  const z = variant === 'stage' ? 20 : 16;
  const sel = variant === 'stage' ? 10 : 8;
  return `<div class="cv2-vctrls is-${variant}">
    <div class="cv2-vdev">
      <button type="button" class="cv2-vctl${V.muted ? ' is-off' : ''}" data-act="toggle-mute" data-tip="${V.muted ? 'Включить микрофон' : 'Выключить микрофон'}">${V.muted ? VCI.micOff(z) : VCI.mic(z)}</button>
      <button type="button" class="cv2-vctl is-chev" data-act="dev-menu" data-kind="in" data-tip="Устройство ввода" aria-haspopup="menu">${VCI.selector(sel)}</button>
    </div>
    <div class="cv2-vdev">
      <button type="button" class="cv2-vctl${V.deafened ? ' is-off' : ''}" data-act="toggle-deafen" data-tip="${V.deafened ? 'Включить звук' : 'Выключить звук'}">${V.deafened ? VCI.soundOff(z) : VCI.sound(z)}</button>
      <button type="button" class="cv2-vctl is-chev" data-act="dev-menu" data-kind="out" data-tip="Устройство вывода" aria-haspopup="menu">${VCI.selector(sel)}</button>
    </div>
    <button type="button" class="cv2-vctl" data-act="audio-settings" data-tip="Настройки голоса">${VCI.gear(z)}</button>
    ${variant === 'stage' ? `<button type="button" class="cv2-vctl is-leave" data-act="${leave}" data-tip="Отключиться">${VCI.hangup(z)}</button>` : ''}
  </div>`;
}

// ===== Голосовой канал сервера =====

export function renderVoiceStage(roomId: number, vcId: number): string {
  const ch = allVoiceChannels(S.details.get(roomId)).find((c) => c.id === vcId);
  const members = channelMembers(vcId);
  const joined = sameId(V.channelId, vcId);
  const connecting = V.connecting && !joined;
  if (!joined) {
    const full = Boolean(ch?.user_limit) && members.length >= (ch?.user_limit || 0);
    return `<div class="cv2-stage is-lobby">
      <div class="cv2-stage__lobby">
        <span class="cv2-stage__ico">${IC.speaker(28)}</span>
        <div class="cv2-stage__title">${esc(ch?.name || 'Голосовой канал')}</div>
        <div class="cv2-stage__sub">${members.length ? `Сейчас в канале: ${members.length}` : 'Сейчас в голосовом канале никого нет'}</div>
        ${members.length ? `<div class="cv2-stage__faces">${members.slice(0, 8).map((id) => {
          const u = userOf(id);
          return `<span data-speak-uid="${id}" data-tip="${esc(u.username)}">${avatarHtml(u.username, u.avatar_url, u.avatar_color, { size: 32 })}</span>`;
        }).join('')}</div>` : ''}
        <button type="button" class="cv2-btn is-success" data-act="vc-join" data-room="${roomId}" data-vc="${vcId}" ${full || connecting ? 'disabled' : ''}>${connecting ? 'Подключение…' : full ? 'Канал заполнен' : 'Присоединиться'}</button>
      </div>
    </div>`;
  }
  const scope = `vc:${vcId}:${V.joinedAt}`;
  return `<div class="cv2-stage">
    <div class="cv2-stage__body"><div class="cv2-stage__grid">${members.map((id) => tile(id, scope)).join('')}</div></div>
    <div class="cv2-stage__dock">${voiceControls('voice', 'stage')}</div>
  </div>`;
}

// ===== Область звонка в ЛС =====

export function renderDmCallArea(peerId: number): string {
  if (!C.phase || !sameId(C.peerId, peerId)) return '';
  const u = userOf(peerId);
  if (C.phase === 'incoming') {
    return `<div class="cv2-callarea is-ringing">
      <div class="cv2-callarea__ring">${avatarHtml(u.username, u.avatar_url, u.avatar_color, { size: 64 })}</div>
      <div class="cv2-callarea__title">${esc(u.username)}</div>
      <div class="cv2-callarea__sub">Входящий звонок…</div>
      <div class="cv2-callarea__ctrls">
        <button type="button" class="cv2-vctl is-accept" data-act="call-accept" data-tip="Принять">${IC.phone(18)}</button>
        <button type="button" class="cv2-vctl is-leave" data-act="call-decline" data-tip="Отклонить">${VCI.hangup(18)}</button>
      </div>
    </div>`;
  }
  const scope = `call:${peerId}`;
  const status = C.phase === 'outgoing' ? 'Вызов…' : C.phase === 'connecting' ? 'Соединение…' : '';
  return `<div class="cv2-callarea ${C.phase === 'active' ? 'is-active' : 'is-wait'}">
    <div class="cv2-callarea__tiles">
      ${S.me.id != null ? tile(S.me.id, scope, 'md') : ''}
      <div class="${C.phase === 'active' ? '' : 'cv2-callarea__pulse'}">${tile(peerId, scope, 'md')}</div>
    </div>
    ${status ? `<div class="cv2-callarea__sub">${status}</div>` : ''}
    <div class="cv2-callarea__ctrls">${voiceControls('call', 'stage')}</div>
  </div>`;
}

// ===== Область группового звонка =====

export function renderGroupCallArea(roomId: number): string {
  const vc = groupVoiceId(roomId);
  if (!vc) return '';
  const members = channelMembers(vc);
  const joined = sameId(V.channelId, vc);
  if (!members.length && !joined) return '';
  const room = roomById(roomId);
  const scope = `vc:${vc}:${joined ? V.joinedAt : 'idle'}`;
  return `<div class="cv2-callarea ${joined ? 'is-active' : 'is-idle'}">
    <div class="cv2-callarea__tiles">${members.map((id) => tile(id, scope, 'md')).join('')}</div>
    ${
      joined
        ? `<div class="cv2-callarea__ctrls">${voiceControls('voice', 'stage')}</div>`
        : `<div class="cv2-callarea__sub">Идёт звонок в «${esc(room?.name || 'группе')}»</div>
           <div class="cv2-callarea__ctrls"><button type="button" class="cv2-btn is-success is-sm" data-act="group-call" data-room="${roomId}">${IC.phone(14)}<span>Присоединиться</span></button></div>`
    }
  </div>`;
}
