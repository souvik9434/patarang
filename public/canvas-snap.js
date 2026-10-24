/**
 * canvas-snap.js — M-CANVAS Layer 0 (docs/07 Block C2/C3/C4): pure canvas math.
 * No DOM. Canvas space = 1280×720 CSS px, 1:1 with the editor iframe.
 * bridge.js (module) imports this; node tests import it directly.
 * All rects are {x, y, w?, h?} integers.
 */

export const CANVAS = { w: 1280, h: 720 };
export const MIN_SIZE = 24;
export const EDGE_KINDS = { canvas: 'canvas', object: 'object', spacing: 'spacing' };

/** Clamp a rect inside the canvas with a hard MIN_SIZE floor (docs/07 C3.2). */
export function clampRect(rect) {
  const out = {
    x: Math.round(Number(rect.x) || 0),
    y: Math.round(Number(rect.y) || 0),
    w: Math.round(Number.isFinite(Number(rect.w)) ? Number(rect.w) : MIN_SIZE),
    h: Math.round(Number.isFinite(Number(rect.h)) ? Number(rect.h) : MIN_SIZE),
  };
  out.w = Math.max(MIN_SIZE, Math.min(out.w, CANVAS.w));
  out.h = Math.max(MIN_SIZE, Math.min(out.h, CANVAS.h));
  out.x = Math.max(0, Math.min(out.x, CANVAS.w - out.w));
  out.y = Math.max(0, Math.min(out.y, CANVAS.h - out.h));
  return out;
}

/**
 * Precompute snap candidates once per drag (docs/07 C2.1): canvas edges +
 * centres, then every other element's left/centre/right (x) and
 * top/middle/bottom (y). Sorted ascending.
 */
export function startSession(moving, others = []) {
  const xs = [
    { at: 0, kind: 'canvas', ref: 'canvas-left' },
    { at: CANVAS.w / 2, kind: 'canvas', ref: 'canvas-center-x' },
    { at: CANVAS.w, kind: 'canvas', ref: 'canvas-right' },
  ];
  const ys = [
    { at: 0, kind: 'canvas', ref: 'canvas-top' },
    { at: CANVAS.h / 2, kind: 'canvas', ref: 'canvas-center-y' },
    { at: CANVAS.h, kind: 'canvas', ref: 'canvas-bottom' },
  ];
  for (const o of others) {
    if (o.id === moving.id) continue;
    const r = o.rect;
    if (typeof r?.x !== 'number') continue;
    xs.push({ at: r.x, kind: 'object', ref: o.id }, { at: r.x + r.w / 2, kind: 'object', ref: o.id }, { at: r.x + r.w, kind: 'object', ref: o.id });
    if (typeof r?.y === 'number') ys.push({ at: r.y, kind: 'object', ref: o.id }, { at: r.y + r.h / 2, kind: 'object', ref: o.id }, { at: r.y + r.h, kind: 'object', ref: o.id });
  }
  xs.sort((a, b) => a.at - b.at);
  ys.sort((a, b) => a.at - b.at);
  return { xs, ys, others };
}

/** Nearest candidate within threshold for one edge (binary probe on sorted cands). */
function nearest(cands, at, threshold) {
  let best = null;
  let lo = 0, hi = cands.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const d = Math.abs(cands[mid].at - at);
    if (d <= threshold && (best === null || d < best.d)) best = { d, c: cands[mid] };
    if (cands[mid].at < at) lo = mid + 1; else hi = mid - 1;
  }
  return best && best.c;
}

/**
 * Snap a moving rect. Returns { rect, guides:[{axis, at, kind, ref}] }.
 * uses: 0..b rect x/y of the candidate rect. Guides are purely visual.
 */
export function snapRect(rect, session, { threshold = 6, disabled = false } = {}) {
  const r = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
  const guides = [];
  if (!disabled) {
    // Collect all candidate snap targets per axis: canvas/object edges+centres,
    // PLUS equal-spacing positions (spacingCandidates __mid case becomes a
    // real snap force, not just an indicator — docs/07 C2.3 upgrade).
    const xCands = [];
    for (const at of [r.x, r.x + r.w / 2, r.x + r.w]) {
      const c = nearest(session.xs, at, threshold);
      if (c) xCands.push({ d: Math.abs(c.at - at), at, c });
    }
    // equal-spacing snap targets (x)
    const scX = spacingCandidates(r, session.others || [], 'x');
    for (const cand of scX) {
      if (cand.__mid && cand.left && cand.right) {
        const targetX = (cand.left.x + cand.left.w + cand.right.x - r.w) / 2;
        const d = Math.abs(targetX - r.x);
        if (d <= threshold) xCands.push({ d, at: r.x, c: { at: targetX, kind: 'spacing', ref: 'spacing' } });
      }
    }
    const bx = xCands.sort((a, b) => a.d - b.d)[0];
    if (bx) {
      r.x += Math.round(bx.c.at - bx.at);
      guides.push({ axis: 'x', at: bx.c.at, kind: bx.c.kind, ref: bx.c.ref });
    }

    const yCands = [];
    for (const at of [r.y, r.y + r.h / 2, r.y + r.h]) {
      const c = nearest(session.ys, at, threshold);
      if (c) yCands.push({ d: Math.abs(c.at - at), at, c });
    }
    const scY = spacingCandidates(r, session.others || [], 'y');
    for (const cand of scY) {
      if (cand.__mid && cand.left && cand.right) {
        const targetY = (cand.left.y + cand.left.h + cand.right.y - r.h) / 2;
        const d = Math.abs(targetY - r.y);
        if (d <= threshold) yCands.push({ d, at: r.y, c: { at: targetY, kind: 'spacing', ref: 'spacing' } });
      }
    }
    const by = yCands.sort((a, b) => a.d - b.d)[0];
    if (by) {
      r.y += Math.round(by.c.at - by.at);
      guides.push({ axis: 'y', at: by.c.at, kind: by.c.kind, ref: by.c.ref });
    }
  }
  const rect2 = clampRect(r);
  return { rect: rect2, guides };
}

/**
 * Equal-spacing candidates (docs/07 C2.3, v1 simplification): for the axis,
 * find the two rects adjacent on each side of `moving` (by projection order)
 * and produce the line where gap(moving, nearer) == gap(nearer, farther).
 */
export function spacingCandidates(moving, others = [], axis = 'x') {
  const key = axis === 'x' ? 'x' : 'y';
  const sizeKey = axis === 'x' ? 'w' : 'h';
  const endKey = axis === 'x' ? ((r) => r.x + r.w) : ((r) => r.y + r.h);
  const mv = { start: moving[key], end: endKey(moving) };
  const left = [], right = [];
  for (const o of others) {
    if (!o.rect || typeof o.rect[key] !== 'number') continue;
    if (endKey(o.rect) <= mv.start) left.push(o.rect);
    else if (o.rect[key] >= mv.end) right.push(o.rect);
  }
  left.sort((a, b) => endKey(b) - endKey(a)); // nearest-to-moving first
  right.sort((a, b) => a[key] - b[key]);
  const out = [];
  if (left.length >= 2) {
    const near = left[0], far = left[1];
    out.push({ at: endKey(near) + (endKey(near) - far[key]), kind: 'spacing', ref: `${near[key]}-pair`, axis });
  }
  if (right.length >= 2) {
    const near = right[0], far = right[1];
    out.push({ at: near[key] - (endKey(far) - near[key]), kind: 'spacing', ref: `${near[key]}-pairR`, axis });
  }
  if (left.length >= 1 && right.length >= 1) {
    // single line where gap(moving, left) == gap(right, moving)
    out.push({ __mid: true, left: left[0], right: right[0], kind: 'spacing', axis });
  }
  return out;
}

/** Align N rects to their union box (docs/07 C4.4); caller passes bounds for canvas mode. */
export function alignRects(rects, bounds, mode) {
  const B = bounds;
  return rects.map((r) => {
    const out = { ...r };
    switch (mode) {
      case 'left': out.x = B.x; break;
      case 'right': out.x = B.x + B.w - r.w; break;
      case 'hcenter': out.x = B.x + (B.w - r.w) / 2; break;
      case 'top': out.y = B.y; break;
      case 'bottom': out.y = B.y + B.h - r.h; break;
      case 'vcenter': out.y = B.y + (B.h - r.h) / 2; break;
      default: return out;
    }
    return clampRect(out);
  });
}

/** Distribute N rects evenly (keeps sizes; needs >= 3 — docs/07 C4.4). */
export function distributeRects(rects, axis) {
  if (rects.length < 3) return rects.slice();
  const sorted = rects.slice().sort((a, b) => (axis === 'x' ? a.x - b.x : a.y - b.y));
  const first = sorted[0], last = sorted[sorted.length - 1];
  const gapKey = axis === 'x' ? 'x' : 'y';
  const spanFirst = axis === 'x' ? first.x : first.y;
  const totalSize = sorted.reduce((s, r) => s + (axis === 'x' ? r.w : r.h), 0);
  const spanStart = axis === 'x' ? first.x : first.y;
  const free = (axis === 'x' ? (last.x - first.x + last.w) : (last.y - first.y + last.h)) - totalSize;
  const gap = free / (sorted.length - 1);
  void spanFirst;
  let cursor = spanStart;
  const placed = new Map();
  for (const r of sorted) {
    const pos = Math.round(cursor);
    placed.set(r, pos);
    cursor += (axis === 'x' ? r.w : r.h) + gap;
  }
  return rects.map((r) => {
    if (!placed.has(r)) return { ...r };
    const out = { ...r, [gapKey]: placed.get(r) };
    return clampRect(out);
  });
}

/** Snap-resize: snap the resize EDGES of a rect (docs/07 C3). */
export function snapResizeEdges(rect, session, edges, { threshold = 6, disabled = false } = {}) {
  const r = { ...rect };
  const guides = [];
  if (!disabled) {
    for (const axis of ['x', 'y']) {
      const cands = axis === 'x' ? session.xs : session.ys;
      const probe = [];
      for (const e of edges) {
        if (e === (axis === 'x' ? 'left' : 'top')) probe.push(r[axis]);
        if (e === (axis === 'x' ? 'right' : 'bottom')) probe.push(r[axis] + (axis === 'x' ? r.w : r.h));
        if (e === (axis === 'x' ? 'center' : 'middle')) probe.push(r[axis] + (axis === 'x' ? r.w : r.h) / 2);
      }
      const hit = probe
        .map((at) => ({ at, c: nearest(cands, at, threshold) }))
        .filter((v) => v.c)
        .sort((a, b) => Math.abs(a.c.at - a.at) - Math.abs(b.c.at - b.at))[0];
      if (hit) {
        const isStartEdge = edges.includes(axis === 'x' ? 'left' : 'top') && Math.abs(hit.at - hit.c.at) === 0;
        const target = hit.c.at;
        if (Math.abs(target - hit.at) > 0.01) {
          if (hit.at === r[axis]) r[axis] = target;
          else r[axis === 'x' ? 'w' : 'h'] += target - hit.at;
          guides.push({ axis, at: target, kind: hit.c.kind, ref: hit.c.ref });
        }
        void isStartEdge;
      }
    }
  }
  return { rect: clampRect(r), guides };
}

const API = { CANVAS, MIN_SIZE, clampRect, startSession, snapRect, spacingCandidates, alignRects, distributeRects, snapResizeEdges };
export default API;
