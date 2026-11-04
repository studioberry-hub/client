// Перетаскивание каналов и групп на сервере: порядок как в Discord, только у администратора.

import { toast } from './overlays';
import { S, allTextChannels, allVoiceChannels, canReorder, errText, invalidate, loadDetail } from './store';

type Kind = 'text' | 'voice';
type Ch = { kind: Kind; id: number };
type Node = { type: 'channel'; ch: Ch } | { type: 'category'; id: number; channels: Ch[] };
type Drag = { roomId: number; type: 'channel'; kind: Kind; id: number } | { roomId: number; type: 'category'; id: number };

let drag: Drag | null = null;
let suppressClick = false;

function armSuppress(): void {
  suppressClick = true;
  window.setTimeout(() => {
    suppressClick = false;
  }, 120);
}

function model(roomId: number): Node[] {
  const d = S.details.get(roomId);
  if (!d) return [];
  const channels = [
    ...allTextChannels(d).map((c) => ({ kind: 'text' as const, id: c.id, categoryId: c.category_id ?? null, position: c.position || 0 })),
    ...allVoiceChannels(d).map((c) => ({ kind: 'voice' as const, id: c.id, categoryId: c.category_id ?? null, position: c.position || 0 })),
  ];
  const cats = (d.categories || []).filter((c) => c.id != null).map((c) => ({ id: c.id as number, position: c.position || 0 }));
  const known = new Set(cats.map((c) => c.id));
  const nodes: Array<Node & { position: number }> = [];
  for (const c of channels) {
    if (c.categoryId == null || !known.has(c.categoryId)) nodes.push({ type: 'channel', ch: { kind: c.kind, id: c.id }, position: c.position });
  }
  for (const cat of cats) {
    nodes.push({
      type: 'category',
      id: cat.id,
      position: cat.position,
      channels: channels
        .filter((c) => c.categoryId === cat.id)
        .sort((a, b) => a.position - b.position)
        .map((c) => ({ kind: c.kind, id: c.id })),
    });
  }
  nodes.sort((a, b) => a.position - b.position);
  return nodes.map((n) => (n.type === 'channel' ? { type: 'channel', ch: n.ch } : { type: 'category', id: n.id, channels: n.channels }));
}

function clone(nodes: Node[]): Node[] {
  return nodes.map((n) => (n.type === 'channel' ? { type: 'channel', ch: { ...n.ch } } : { type: 'category', id: n.id, channels: n.channels.map((c) => ({ ...c })) }));
}

function signature(nodes: Node[]): string {
  return nodes
    .map((n) => (n.type === 'channel' ? `c:${n.ch.kind}:${n.ch.id}` : `g:${n.id}(${n.channels.map((c) => `${c.kind}:${c.id}`).join(',')})`))
    .join('|');
}

function take(nodes: Node[], current: Drag): { nodes: Node[]; item: Node | Ch | null } {
  const next = clone(nodes);
  if (current.type === 'category') {
    const i = next.findIndex((n) => n.type === 'category' && n.id === current.id);
    if (i < 0) return { nodes: next, item: null };
    const [item] = next.splice(i, 1);
    return { nodes: next, item };
  }
  for (let i = 0; i < next.length; i++) {
    const n = next[i];
    if (n.type === 'channel' && n.ch.kind === current.kind && n.ch.id === current.id) {
      next.splice(i, 1);
      return { nodes: next, item: n.ch };
    }
    if (n.type === 'category') {
      const j = n.channels.findIndex((c) => c.kind === current.kind && c.id === current.id);
      if (j >= 0) {
        const [ch] = n.channels.splice(j, 1);
        return { nodes: next, item: ch };
      }
    }
  }
  return { nodes: next, item: null };
}

function catIdOf(el: HTMLElement): number {
  return Number(el.closest('.cv2-cat')?.getAttribute('data-cat') || el.dataset.dragId || 0);
}

function insert(nodes: Node[], item: Node | Ch, target: HTMLElement, place: 'before' | 'after' | 'into', current: Drag): Node[] {
  if (current.type === 'category' && item && typeof item === 'object' && 'type' in item && item.type === 'category') {
    if (target.classList.contains('cv2-ch') && !target.dataset.dragCat) {
      const id = Number(target.dataset.dragId);
      const kind = target.dataset.dragKind as Kind;
      const idx = nodes.findIndex((n) => n.type === 'channel' && n.ch.id === id && n.ch.kind === kind);
      const at = idx < 0 ? nodes.length : place === 'before' ? idx : idx + 1;
      nodes.splice(at, 0, item);
      return nodes;
    }
    const id = catIdOf(target);
    const idx = nodes.findIndex((n) => n.type === 'category' && n.id === id);
    const at = idx < 0 ? nodes.length : place === 'before' ? idx : idx + 1;
    nodes.splice(at, 0, item);
    return nodes;
  }
  const ch = item as Ch;
  if (target.classList.contains('cv2-tree')) {
    nodes.push({ type: 'channel', ch });
    return nodes;
  }
  if (target.classList.contains('cv2-cat__body') || (target.classList.contains('cv2-cat__head') && place === 'into')) {
    const cat = nodes.find((n) => n.type === 'category' && n.id === catIdOf(target));
    if (cat && cat.type === 'category') {
      if (target.classList.contains('cv2-cat__head')) cat.channels.unshift(ch);
      else cat.channels.push(ch);
    } else nodes.push({ type: 'channel', ch });
    return nodes;
  }
  if (target.classList.contains('cv2-cat__head')) {
    const idx = nodes.findIndex((n) => n.type === 'category' && n.id === catIdOf(target));
    nodes.splice(idx < 0 ? nodes.length : idx, 0, { type: 'channel', ch });
    return nodes;
  }
  if (target.classList.contains('cv2-ch')) {
    const parent = target.dataset.dragCat || '';
    const id = Number(target.dataset.dragId);
    const kind = target.dataset.dragKind as Kind;
    if (!parent) {
      const idx = nodes.findIndex((n) => n.type === 'channel' && n.ch.id === id && n.ch.kind === kind);
      const at = idx < 0 ? nodes.length : place === 'before' ? idx : idx + 1;
      nodes.splice(at, 0, { type: 'channel', ch });
      return nodes;
    }
    const cat = nodes.find((n) => n.type === 'category' && n.id === Number(parent));
    if (cat && cat.type === 'category') {
      const idx = cat.channels.findIndex((c) => c.id === id && c.kind === kind);
      const at = idx < 0 ? cat.channels.length : place === 'before' ? idx : idx + 1;
      cat.channels.splice(at, 0, ch);
    } else nodes.push({ type: 'channel', ch });
    return nodes;
  }
  nodes.push({ type: 'channel', ch });
  return nodes;
}

function hit(e: DragEvent): { el: HTMLElement; place: 'before' | 'after' | 'into' } | null {
  const raw = e.target as HTMLElement | null;
  if (!raw?.closest) return null;
  const tree = raw.closest<HTMLElement>('.cv2-tree');
  if (!tree) return null;
  const members = raw.closest('.cv2-vmembers');
  const ch = members ? (members.previousElementSibling as HTMLElement | null) : raw.closest<HTMLElement>('.cv2-ch');
  if (ch?.classList.contains('cv2-ch') && tree.contains(ch)) {
    const r = ch.getBoundingClientRect();
    return { el: ch, place: e.clientY < r.top + r.height / 2 ? 'before' : 'after' };
  }
  const head = raw.closest<HTMLElement>('.cv2-cat__head');
  if (head && tree.contains(head)) {
    const r = head.getBoundingClientRect();
    return { el: head, place: e.clientY > r.top + r.height * 0.55 ? 'into' : 'before' };
  }
  const body = raw.closest<HTMLElement>('.cv2-cat__body');
  if (body && tree.contains(body)) return { el: body, place: 'into' };
  return { el: tree, place: 'after' };
}

function mark(root: HTMLElement, target: HTMLElement, place: 'before' | 'after' | 'into', current: Drag): void {
  root.querySelectorAll('.is-drop-before, .is-drop-after, .is-drop-into').forEach((el) => el.classList.remove('is-drop-before', 'is-drop-after', 'is-drop-into'));
  let host = target;
  let mode = place;
  if (current.type === 'category' && mode === 'into') mode = 'after';
  if (target.classList.contains('cv2-cat__head') || target.classList.contains('cv2-cat__body')) host = target.closest('.cv2-cat') || target;
  if (target.classList.contains('cv2-tree')) return;
  host.classList.add(mode === 'before' ? 'is-drop-before' : mode === 'after' ? 'is-drop-after' : 'is-drop-into');
}

async function commit(roomId: number, nodes: Node[]): Promise<void> {
  const d = S.details.get(roomId);
  if (!d || !canReorder(roomId)) return;
  const prev = new Map<string, { categoryId: number | null; position: number }>();
  for (const c of allTextChannels(d)) prev.set(`text:${c.id}`, { categoryId: c.category_id ?? null, position: c.position || 0 });
  for (const c of allVoiceChannels(d)) prev.set(`voice:${c.id}`, { categoryId: c.category_id ?? null, position: c.position || 0 });
  const prevCat = new Map<number, number>();
  for (const cat of d.categories || []) if (cat.id != null) prevCat.set(cat.id, cat.position || 0);
  const text = new Map((d.text_channels || []).map((c) => [c.id, c]));
  const voice = new Map((d.voice_channels || []).map((c) => [c.id, c]));
  const jobs: Array<Promise<unknown>> = [];
  const pushChannel = (ch: Ch, categoryId: number | null, position: number) => {
    const row = ch.kind === 'text' ? text.get(ch.id) : voice.get(ch.id);
    if (row) {
      row.category_id = categoryId;
      row.position = position;
    }
    const old = prev.get(`${ch.kind}:${ch.id}`);
    if (old && old.categoryId === categoryId && old.position === position) return;
    const body = { category_id: categoryId, position };
    const req = ch.kind === 'text' ? S.api.cloudUpdateTextChannel?.(roomId, ch.id, body) : S.api.cloudUpdateVoiceChannel?.(roomId, ch.id, body);
    if (req) jobs.push(req);
  };
  nodes.forEach((node, i) => {
    if (node.type === 'channel') {
      pushChannel(node.ch, null, i);
      return;
    }
    const cat = (d.categories || []).find((c) => c.id === node.id);
    if (cat) cat.position = i;
    if (prevCat.get(node.id) !== i) {
      const req = S.api.cloudUpdateCategory?.(roomId, node.id, { name: cat?.name, position: i });
      if (req) jobs.push(req);
    }
    node.channels.forEach((ch, j) => pushChannel(ch, node.id, j));
  });
  invalidate('sidebar');
  try {
    await Promise.all(jobs);
  } catch (err) {
    toast(errText(err), 'error');
    await loadDetail(roomId);
    invalidate('sidebar');
  }
}

export function bindChannelDrag(root: HTMLElement): void {
  root.addEventListener(
    'click',
    (e) => {
      if (!suppressClick) return;
      suppressClick = false;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );
  root.addEventListener('dragstart', (e) => {
    const t = e.target as HTMLElement | null;
    const handle = t?.closest<HTMLElement>('[data-drag]');
    if (!handle) return;
    if (t?.closest('button')) {
      e.preventDefault();
      return;
    }
    const roomId = Number(handle.closest('.cv2-tree')?.getAttribute('data-room') || 0);
    if (!roomId || !canReorder(roomId)) {
      e.preventDefault();
      return;
    }
    const id = Number(handle.dataset.dragId);
    drag = handle.dataset.drag === 'category' ? { roomId, type: 'category', id } : { roomId, type: 'channel', kind: (handle.dataset.dragKind as Kind) || 'text', id };
    handle.classList.add('is-dragging');
    e.dataTransfer?.setData('text/plain', 'cv2-order');
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  });
  root.addEventListener('dragover', (e) => {
    if (!drag) return;
    const where = hit(e);
    if (!where || !where.el.closest('.cv2-tree')?.isConnected) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    mark(root, where.el, where.place, drag);
  });
  root.addEventListener('drop', (e) => {
    if (!drag) return;
    e.preventDefault();
    e.stopPropagation();
    const current = drag;
    const where = hit(e);
    drag = null;
    armSuppress();
    root.querySelectorAll('.is-dragging, .is-drop-before, .is-drop-after, .is-drop-into').forEach((el) => el.classList.remove('is-dragging', 'is-drop-before', 'is-drop-after', 'is-drop-into'));
    if (!where || !canReorder(current.roomId)) return;
    let place = where.place;
    if (current.type === 'category' && place === 'into') place = 'after';
    const before = model(current.roomId);
    const pulled = take(before, current);
    if (!pulled.item) return;
    const next = insert(pulled.nodes, pulled.item, where.el, place, current);
    if (signature(before) === signature(next) || signature(model(current.roomId)) === signature(next)) return;
    void commit(current.roomId, next);
  });
  root.addEventListener('dragend', () => {
    if (drag) armSuppress();
    drag = null;
    root.querySelectorAll('.is-dragging, .is-drop-before, .is-drop-after, .is-drop-into').forEach((el) => el.classList.remove('is-dragging', 'is-drop-before', 'is-drop-after', 'is-drop-into'));
  });
}
