// Иконки чатов v2: файлы из референса (assets/newchatV2, через <img>) и inline-SVG для остальных (currentColor).

// ===== Иконки из референса =====

/** Путь от src/renderer/index.html; в сборку assets/** попадает целиком. */
const IMG_BASE = '../../assets/newchatV2/';

const img = (file: string, size: number) =>
  `<img class="cv2-img" src="${IMG_BASE}${file}.svg" width="${size}" height="${size}" alt="" draggable="false">`;

export const IMG = {
  addFile: (z = 16) => img('addFile', z),
  addUser: (z = 16) => img('addUserToGroup', z),
  call: (z = 16) => img('call', z),
  delete: (z = 16) => img('delete', z),
  edit: (z = 16) => img('edit', z),
  emoji: (z = 16) => img('emoji', z),
  explore: (z = 20) => img('ExploreServers', z),
  forward: (z = 16) => img('forward', z),
  more: (z = 16) => img('moreOptions', z),
  newServer: (z = 20) => img('NewServer', z),
  pin: (z = 16) => img('pin', z),
  reply: (z = 16) => img('reply', z),
  report: (z = 16) => img('report', z),
  people: (z = 16) => img('showUserOrChatUsers', z),
  sticker: (z = 16) => img('sticker', z),
  copy: (z = 16) => img('copy', z),
  copyid: (z = 16) => img('copyid', z),
  topic: (z = 18) => img('topic', z),
  voice: (z = 18) => img('voice', z),
  news: (z = 18) => img('news', z),
  rules: (z = 18) => img('rules', z),
  settings14: (z = 14) => img('settings14', z),
};

/** Белый svg как маска: красится в currentColor родителя. */
export function assetMask(file: string, size: number): string {
  const src = `${IMG_BASE}${file}.svg`;
  return `<span class="cv2-ico-mask" style="width:${size}px;height:${size}px;-webkit-mask-image:url(&quot;${src}&quot;);mask-image:url(&quot;${src}&quot;)"></span>`;
}

function channelFile(kind: string | null | undefined): string {
  if (kind === 'voice') return 'voice';
  if (kind === 'news') return 'news';
  if (kind === 'rules') return 'rules';
  return 'topic';
}

/** Иконка типа канала: текстовый, голосовой, новости, правила. */
export function channelMark(kind: string | null | undefined, size = 18): string {
  const file = channelFile(kind);
  if (file === 'voice') return IMG.voice(size);
  if (file === 'news') return IMG.news(size);
  if (file === 'rules') return IMG.rules(size);
  return IMG.topic(size);
}

/** Та же иконка канала, но в цвет подписи строки. */
export function channelMarkTone(kind: string | null | undefined, size = 18): string {
  return assetMask(channelFile(kind), size);
}

/** Иконки панели ввода: assets/newchatV2/MessageTypeBar, все 16×16. */
export function composerIcon(file: string): string {
  return `<img class="cv2-img" src="${IMG_BASE}MessageTypeBar/${file}.svg" width="16" height="16" alt="" draggable="false">`;
}

/** Иконка пункта меню сервера из assets/newchatV2/MenuIcons. */
export function menuIcon(file: string, size = 18): string {
  return `<img class="cv2-img" src="${IMG_BASE}MenuIcons/${file}.svg" width="${size}" height="${size}" alt="" draggable="false">`;
}

/** Та же иконка, но красится в currentColor — для упоминания канала в тексте. */
function channelMarkTint(file: string, size: number): string {
  const src = `${IMG_BASE}${file}.svg`;
  return `<span class="cv2-mention__ico" style="width:${size}px;height:${size}px;-webkit-mask-image:url(&quot;${src}&quot;);mask-image:url(&quot;${src}&quot;)"></span>`;
}

export function channelMentionMark(kind: string | null | undefined, size = 14): string {
  if (kind === 'voice') return channelMarkTint('voice', size);
  if (kind === 'news') return channelMarkTint('news', size);
  if (kind === 'rules') return channelMarkTint('rules', size);
  return channelMarkTint('topic', size);
}

// ===== Иконки голосовой панели из прошлого UI (assets/icons) =====

const vimg = (path: string, size: number) =>
  `<img class="cv2-img" src="../../assets/icons/${path}.svg" width="${size}" height="${size}" alt="" draggable="false">`;

export const VCI = {
  mic: (z = 16) => vimg('chats/voiceBar/mic', z),
  micOff: (z = 16) => vimg('chats/voiceBar/mic_muted', z),
  sound: (z = 16) => vimg('chats/voiceBar/sound', z),
  soundOff: (z = 16) => vimg('chats/voiceBar/sound_muted', z),
  hangup: (z = 16) => vimg('chats/voiceBar/call_end', z),
  gear: (z = 16) => vimg('chats/groupControls/settings', z),
  selector: (z = 8) => vimg('selectorList', z),
};

// ===== Inline-SVG =====

const s = (body: string, size = 20, vb = 24) =>
  `<svg class="cv2-i" width="${size}" height="${size}" viewBox="0 0 ${vb} ${vb}" fill="none" aria-hidden="true">${body}</svg>`;

const st = 'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

export const IC = {
  home: (z = 20) =>
    s(
      '<path d="M0 8.62c0-.4.17-.77.46-1.03L8.43.5A2 2 0 0 1 9.76 0h.48c.49 0 .96.18 1.33.5l7.97 7.09c.3.26.46.63.46 1.03 0 .76-.62 1.38-1.38 1.38H18v8a2 2 0 0 1-2 2h-3v-5a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v5H4a2 2 0 0 1-2-2v-8h-.62C.62 10 0 9.38 0 8.62Z" fill="currentColor"/>',
      z,
      20,
    ),
  // Глифы ниже повторяют векторы Figma (сетка 18/16px, скруглённые прямоугольники)
  friends: (z = 18) => s('<rect x="5" y="0" width="8" height="8" rx="2" fill="currentColor"/><path d="M2 12a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v2a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4v-2Z" fill="currentColor"/>', z, 18),
  invites: (z = 18) =>
    s(
      '<path fill-rule="evenodd" d="M3 2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm2 2v10h8V4H5Z" fill="currentColor"/><rect x="2" y="4.5" width="2" height="2" rx=".6" fill="var(--cv2-ico-cut, #191919)"/><rect x="2" y="8" width="2" height="2" rx=".6" fill="var(--cv2-ico-cut, #191919)"/><rect x="2" y="11.5" width="2" height="2" rx=".6" fill="var(--cv2-ico-cut, #191919)"/><rect x="14" y="4.5" width="2" height="2" rx=".6" fill="var(--cv2-ico-cut, #191919)"/><rect x="14" y="8" width="2" height="2" rx=".6" fill="var(--cv2-ico-cut, #191919)"/><rect x="14" y="11.5" width="2" height="2" rx=".6" fill="var(--cv2-ico-cut, #191919)"/>',
      z,
      18,
    ),
  search: (z = 18) => s('<circle cx="7.5" cy="7.5" r="6.25" stroke="currentColor" stroke-width="2"/><path d="m12.2 12.2 4.6 4.6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>', z, 18),
  chat: (z = 16) =>
    s('<path d="M3 1h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6.5L2.6 15a.8.8 0 0 1-1.3-.6V3A2 2 0 0 1 3 1Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>', z, 16),
  dotsV: (z = 16) => s('<rect x="6" y="0" width="4" height="4" rx="2" fill="currentColor"/><rect x="6" y="6" width="4" height="4" rx="2" fill="currentColor"/><rect x="6" y="12" width="4" height="4" rx="2" fill="currentColor"/>', z, 16),
  newDm: (z = 16) =>
    s('<path d="M7.5 1H3a2 2 0 0 0-2 2v11.2a.8.8 0 0 0 1.3.6L6 12h1.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 7.5V3a2 2 0 0 0-2-2H7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12 9v6M9 12h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>', z, 16),
  addFriend: (z = 16) =>
    s('<rect x="3" y="0" width="7" height="7" rx="2" fill="currentColor"/><path d="M0 11a2 2 0 0 1 2-2h7.2A5 5 0 0 0 8.4 16H4a4 4 0 0 1-4-4v-1Z" fill="currentColor"/><path d="M13 9v6M10 12h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>', z, 16),
  group: (z = 20) =>
    s('<rect x="0" y="0" width="8" height="12" rx="2.5" fill="currentColor"/><rect x="10" y="0" width="8" height="8" rx="2.5" fill="currentColor"/><path d="M6 12a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v1a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4v-1Z" fill="currentColor" stroke="var(--cv2-ico-cut, #438A9A)" stroke-width="2"/>', z, 20),
  chevron: (z = 24) => s('<path d="m10 7 5 5-5 5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>', z, 24),
  speakerFill: (z = 16) =>
    s('<path d="M1 6a1 1 0 0 1 1-1h2l4-3.5A.6.6 0 0 1 9 2v12a.6.6 0 0 1-1 .5L4 11H2a1 1 0 0 1-1-1V6Z" fill="currentColor"/><path d="M11.5 5.2a3.6 3.6 0 0 1 0 5.6M13.4 3a6.6 6.6 0 0 1 0 10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>', z, 16),
  plus: (z = 18) => s('<path d="M12 5v14M5 12h14" ' + st + ' stroke-width="2.4"/>', z),
  plusCircle: (z = 20) => s('<circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M12 7.5v9M7.5 12h9" stroke="#202020" stroke-width="2.2" stroke-linecap="round"/>', z),
  compass: (z = 20) =>
    s('<circle cx="12" cy="12" r="10" fill="currentColor"/><path d="m15.8 8.2-2.1 5.5-5.5 2.1 2.1-5.5 5.5-2.1Z" fill="#202020"/>', z),
  message: (z = 18) =>
    s('<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.2 3.6c-.5.43-1.3.07-1.3-.6V16.3A2.5 2.5 0 0 1 4 14.5v-9Z" ' + st + '/>', z),
  moreV: (z = 18) => s('<circle cx="12" cy="5" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="19" r="2" fill="currentColor"/>', z),
  moreH: (z = 18) => s('<circle cx="5" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="19" cy="12" r="2" fill="currentColor"/>', z),
  phone: (z = 18) =>
    s('<path d="M5.1 3.5h3l1.6 4.2-2 1.4a12 12 0 0 0 7.2 7.2l1.4-2 4.2 1.6v3a2 2 0 0 1-2.2 2A17 17 0 0 1 3.1 5.7a2 2 0 0 1 2-2.2Z" ' + st + '/><path d="M15 3a6 6 0 0 1 6 6M15 7a2 2 0 0 1 2 2" ' + st + '/>', z),
  phoneOff: (z = 18) =>
    s('<path d="M3.3 13.4c4.8-4 12.6-4 17.4 0 .6.5.7 1.4.2 2l-1.4 1.7a1.2 1.2 0 0 1-1.5.3l-2.6-1.3a1.2 1.2 0 0 1-.6-1.2l.2-1.6a12 12 0 0 0-6 0l.2 1.6c.1.5-.2 1-.6 1.2L6 17.4c-.5.3-1.1.1-1.5-.3l-1.4-1.7a1.4 1.4 0 0 1 .2-2Z" fill="currentColor"/>', z),
  pin: (z = 18) =>
    s('<path d="M14.5 3.5 20.5 9.5l-2.1.7-3.7 3.7.4 4.1-1.6 1.6-3.6-3.6L5 20.9l-.9-.9 4.9-4.9-3.6-3.6 1.6-1.6 4.1.4 3.7-3.7.7-2.1Z" fill="currentColor"/>', z),
  userPlus: (z = 18) =>
    s('<circle cx="10" cy="7.5" r="4" fill="currentColor"/><path d="M2.5 20c0-3.9 3.4-6.5 7.5-6.5 1.5 0 2.9.35 4.1 1A5.5 5.5 0 0 0 13.3 20H2.5Z" fill="currentColor"/><path d="M19 14v6M16 17h6" ' + st + '/>', z),
  chatPlus: (z = 18) =>
    s('<path d="M20 11.5v2a2.5 2.5 0 0 1-2.5 2.5H10l-4.2 3.6c-.5.43-1.3.07-1.3-.6V16.3A2.5 2.5 0 0 1 4 14.5v-9A2.5 2.5 0 0 1 6.5 3H12" ' + st + '/><path d="M18 2.5v6M15 5.5h6" ' + st + '/>', z),
  groupAdd: (z = 18) =>
    s('<circle cx="8.5" cy="8" r="3.5" fill="currentColor"/><circle cx="16" cy="9" r="2.6" fill="currentColor" opacity=".7"/><path d="M2 19.5c0-3.3 2.9-5.5 6.5-5.5S15 16.2 15 19.5H2Z" fill="currentColor"/><path d="M19.5 14v6M16.5 17h6" ' + st + '/>', z),
  profile: (z = 18) =>
    s('<circle cx="12" cy="12" r="10" fill="currentColor"/><circle cx="12" cy="10" r="3.4" fill="var(--cv2-ico-cut, #202020)"/><path d="M5.9 18.4c1.2-2.3 3.4-3.6 6.1-3.6s4.9 1.3 6.1 3.6A8.9 8.9 0 0 1 12 21a8.9 8.9 0 0 1-6.1-2.6Z" fill="var(--cv2-ico-cut, #202020)"/>', z),
  heart: (z = 16) =>
    s('<path d="M8 15S0 10.3 0 5.1A4.3 4.3 0 0 1 8 2.8a4.3 4.3 0 0 1 8 2.3C16 10.3 8 15 8 15Z" fill="currentColor"/>', z, 16),
  edit: (z = 16) => s('<path d="m14.5 5.5 4 4L8 20H4v-4L14.5 5.5Z" fill="currentColor"/><path d="m16.5 3.5 1-1a1.4 1.4 0 0 1 2 0l2 2a1.4 1.4 0 0 1 0 2l-1 1-4-4Z" fill="currentColor"/>', z),
  smile: (z = 16) =>
    s('<circle cx="12" cy="12" r="10" fill="currentColor"/><circle cx="8.8" cy="10" r="1.4" fill="var(--cv2-ico-cut, #2b2b2b)"/><circle cx="15.2" cy="10" r="1.4" fill="var(--cv2-ico-cut, #2b2b2b)"/><path d="M7.8 14.2a5 5 0 0 0 8.4 0" stroke="var(--cv2-ico-cut, #2b2b2b)" stroke-width="1.8" stroke-linecap="round"/>', z),
  reply: (z = 16) => s('<path d="M10 5 3.5 11 10 17v-3.6c5.2 0 8.4 1.5 10.5 5.1-.6-5.3-3.6-9.6-10.5-10.4V5Z" fill="currentColor"/>', z),
  forward: (z = 16) => s('<path d="m14 5 6.5 6-6.5 6v-3.6c-5.2 0-8.4 1.5-10.5 5.1.6-5.3 3.6-9.6 10.5-10.4V5Z" fill="currentColor"/>', z),
  trash: (z = 16) =>
    s('<path d="M9 3h6l1 2h4v2H4V5h4l1-2Z" fill="currentColor"/><path d="M5.5 8.5h13l-1 11.2A1.5 1.5 0 0 1 16 21H8a1.5 1.5 0 0 1-1.5-1.3l-1-11.2Z" fill="currentColor"/>', z),
  copy: (z = 16) => s('<rect x="8" y="8" width="12" height="12" rx="2.5" ' + st + '/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8" ' + st + '/>', z),
  hash: (z = 20) => s('<path d="M9.5 3 7.5 21M16.5 3l-2 18M4 8.5h17M3 15.5h17" ' + st + '/>', z),
  news: (z = 20) => s('<path d="M4 9.5 17 4v16L4 14.5v-5Z" ' + st + '/><path d="M7.5 15.3 9 20h3l-1.3-4" ' + st + '/><path d="M20 10v4" ' + st + '/>', z),
  rules: (z = 20) => s('<path d="M6 3.5h9l4 4v13H6v-17Z" ' + st + '/><path d="m9.5 13.5 2 2 3.5-4" ' + st + '/>', z),
  speaker: (z = 20) =>
    s('<path d="M4 9.5h3.5L12 5v14l-4.5-4.5H4v-5Z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.3 5.7a9 9 0 0 1 0 12.6" ' + st + '/>', z),
  mic: (z = 18) =>
    s('<rect x="8.5" y="2.5" width="7" height="12" rx="3.5" fill="currentColor"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5v4" ' + st + '/>', z),
  micOff: (z = 18) =>
    s('<rect x="8.5" y="2.5" width="7" height="12" rx="3.5" fill="currentColor"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5v4" ' + st + '/><path d="M3.5 3.5 20.5 20.5" stroke="var(--cv2-red, #f04747)" stroke-width="2.4" stroke-linecap="round"/>', z),
  headphones: (z = 18) =>
    s('<path d="M3.5 15v-3a8.5 8.5 0 0 1 17 0v3" ' + st + '/><rect x="3" y="13.5" width="5" height="7" rx="2" fill="currentColor"/><rect x="16" y="13.5" width="5" height="7" rx="2" fill="currentColor"/>', z),
  headphonesOff: (z = 18) =>
    s('<path d="M3.5 15v-3a8.5 8.5 0 0 1 17 0v3" ' + st + '/><rect x="3" y="13.5" width="5" height="7" rx="2" fill="currentColor"/><rect x="16" y="13.5" width="5" height="7" rx="2" fill="currentColor"/><path d="M3.5 3.5 20.5 20.5" stroke="var(--cv2-red, #f04747)" stroke-width="2.4" stroke-linecap="round"/>', z),
  gear: (z = 18) =>
    s('<path d="M10.3 2.5h3.4l.5 2.5 1.7.9 2.4-.9 1.7 3-1.9 1.6v2l1.9 1.6-1.7 3-2.4-.9-1.7.9-.5 2.5h-3.4l-.5-2.5-1.7-.9-2.4.9-1.7-3 1.9-1.6v-2L3.6 8l1.7-3 2.4.9 1.7-.9.9-2.5Z" fill="currentColor"/><circle cx="12" cy="11.9" r="3" fill="var(--cv2-ico-cut, #191919)"/>', z),
  close: (z = 16) => s('<path d="M6 6l12 12M18 6 6 18" ' + st + ' stroke-width="2.4"/>', z),
  check: (z = 16) => s('<path d="m5 12.5 4.5 4.5L19 7.5" ' + st + ' stroke-width="2.6"/>', z),
  chevronDown: (z = 14) => s('<path d="m6 9 6 6 6-6" ' + st + ' stroke-width="2.4"/>', z),
  chevronRight: (z = 14) => s('<path d="m9 6 6 6-6 6" ' + st + ' stroke-width="2.4"/>', z),
  sticker: (z = 18) =>
    s('<path d="M5.5 3h13A2.5 2.5 0 0 1 21 5.5V13l-8 8H5.5A2.5 2.5 0 0 1 3 18.5v-13A2.5 2.5 0 0 1 5.5 3Z" fill="currentColor"/><path d="M13 21v-5.5a2.5 2.5 0 0 1 2.5-2.5H21" fill="var(--cv2-ico-cut, #252525)"/><path d="M13 21v-5.5a2.5 2.5 0 0 1 2.5-2.5H21" stroke="var(--cv2-ico-cut, #252525)" stroke-width="1.6"/>', z),
  file: (z = 22) => s('<path d="M6 2.5h8l5 5v13a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 20.5v-16A2 2 0 0 1 6 2.5Z" fill="currentColor" opacity=".9"/><path d="M14 2.5v5h5" fill="var(--cv2-ico-cut, #2b2b2b)" opacity=".5"/>', z),
  download: (z = 18) => s('<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" ' + st + '/>', z),
  crown: (z = 14) => s('<path d="M3 8l4.5 3.5L12 5l4.5 6.5L21 8l-2 10H5L3 8Z" fill="currentColor"/>', z),
  logout: (z = 16) => s('<path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15M10 16.5 14.5 12 10 7.5M14.5 12H4" ' + st + '/>', z),
  at: (z = 16) => s('<circle cx="12" cy="12" r="4" ' + st + '/><path d="M16 8v5.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1" ' + st + '/>', z),
  users: (z = 18) =>
    s('<circle cx="9" cy="8" r="3.6" fill="currentColor"/><path d="M2 19.5c0-3.3 3-5.5 7-5.5s7 2.2 7 5.5H2Z" fill="currentColor"/><circle cx="17" cy="9" r="2.8" fill="currentColor" opacity=".75"/><path d="M17.5 14c2.6.3 4.5 2.2 4.5 5.5h-4" fill="currentColor" opacity=".75"/>', z),
  link: (z = 16) => s('<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2" ' + st + '/>', z),
  shield: (z = 16) => s('<path d="M12 2.5 4.5 5.5v6c0 4.6 3.2 8.6 7.5 10 4.3-1.4 7.5-5.4 7.5-10v-6L12 2.5Z" fill="currentColor"/>', z),
  arrowDown: (z = 14) => s('<path d="M12 5v14M6 13l6 6 6-6" ' + st + ' stroke-width="2.4"/>', z),
  steam: (z = 18) =>
    s('<path d="M12 2a10 10 0 0 0-9.97 9.2l5.36 2.22a2.83 2.83 0 0 1 1.6-.5h.16l2.38-3.46v-.05a3.77 3.77 0 1 1 3.77 3.77h-.09l-3.4 2.42v.13a2.84 2.84 0 0 1-5.62.55L2.36 14.8A10 10 0 1 0 12 2Zm-4.14 15.1-1.23-.5a2.13 2.13 0 1 0 1.17-2.92l1.27.53a1.57 1.57 0 1 1-1.2 2.9Zm9.53-7.76a2.51 2.51 0 1 0-2.51 2.51 2.51 2.51 0 0 0 2.5-2.51Zm-4.4 0a1.89 1.89 0 1 1 1.89 1.89 1.89 1.89 0 0 1-1.9-1.89Z" fill="currentColor"/>', z),
  gamepad: (z = 16) =>
    s('<path d="M7 7h10a5 5 0 0 1 4.9 6l-.6 3.1a2.6 2.6 0 0 1-4.6 1l-1.9-2.6H9.2l-1.9 2.6a2.6 2.6 0 0 1-4.6-1L2.1 13A5 5 0 0 1 7 7Z" fill="currentColor"/><path d="M7.5 10v3.5M5.75 11.75h3.5" stroke="var(--cv2-ico-cut, #202020)" stroke-width="1.6" stroke-linecap="round"/><circle cx="16" cy="10.5" r="1.1" fill="var(--cv2-ico-cut, #202020)"/><circle cx="17.6" cy="13" r="1.1" fill="var(--cv2-ico-cut, #202020)"/>', z),
  image: (z = 16) => s('<rect x="3" y="4" width="18" height="16" rx="3" ' + st + '/><circle cx="9" cy="9.5" r="1.8" fill="currentColor"/><path d="m4 17.5 5-5 4 4 2.5-2.5 4.5 4.5" ' + st + '/>', z),
  bell: (z = 16) => s('<path d="M18 9.5a6 6 0 1 0-12 0c0 6-2.5 7.5-2.5 7.5h17S18 15.5 18 9.5ZM10 20.5a2.2 2.2 0 0 0 4 0" ' + st + '/>', z),
  star: (z = 18) => s('<path d="m9 1.2 2.2 4.7 5.1.6-3.8 3.5 1 5-4.5-2.5L4.5 15l1-5L1.7 6.5l5.1-.6L9 1.2Z" fill="currentColor"/>', z, 18),
  eye: (z = 18) => s('<path d="M1.2 9S4.2 3.5 9 3.5 16.8 9 16.8 9 13.8 14.5 9 14.5 1.2 9 1.2 9Z" stroke="currentColor" stroke-width="1.8"/><circle cx="9" cy="9" r="2.3" fill="currentColor"/>', z, 18),
  eyeOff: (z = 18) =>
    s('<path d="M2.2 3.2 15.8 14.8M7.2 7.4A2.4 2.4 0 0 0 10.6 11M3.4 6.2C2.2 7.2 1.2 9 1.2 9S4.2 14.5 9 14.5c1.1 0 2.1-.3 3-.8M6.2 4.2C7 3.8 8 3.5 9 3.5 13.8 3.5 16.8 9 16.8 9c-.4.7-1 1.5-1.7 2.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>', z, 18),
  signal: (z = 16) => s('<path d="M4 20v-3M9 20v-7M14 20V9M19 20V4" ' + st + ' stroke-width="2.6"/>', z),
  folderPlus: (z = 16) => s('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" ' + st + '/><path d="M12 10.5v5M9.5 13h5" ' + st + '/>', z),
};
