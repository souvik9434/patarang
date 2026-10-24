/**
 * bridge.js — canvas-side bridge (ES module). M-CANVAS rebuild (docs/07).
 *
 * Host envelope { v:1, method, params }.
 *   OUT: slide.ready | element.select | element.geometry.list | annotation.add | log
 *   IN:  element.update | element.style | element.select | nudge | setMode | ping
 *
 * Layers: C1 selection (hover / click / shift-add / marquee / bbox + 8 handles /
 * Esc) · C2 drag with smart guides (canvas + object edges/centres, Alt override,
 * live x,y w×h chip) · C3 resize (Shift aspect lock, 24px floor, group
 * proportional scale) · C4 keyboard nudge (1px / Shift+10px, batched commit) +
 * floating align/distribute bar · C5 commits are LIST posts — one undo push and
 * one route call per gesture.
 *
 * Coordinates are container-local CSS px = design space; the host scales the
 * iframe, so threshold math lives in here only (docs/07 C2.2).
 */

import * as SFSnap from '/canvas-snap.js';

const VERSION = 1;
const IN = new Set(['element.update', 'element.style', 'element.select', 'nudge', 'setMode', 'ping', 'raiseZ', 'lowerZ', 'duplicate', 'element.delete']);
const CANVAS = SFSnap.CANVAS; // 1280×720
const HANDS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

let mode = 'select';
let spec = null;

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));

function readSpec() {
  const el = $('#slide-spec');
  if (!el) return null;
  try { return JSON.parse(el.textContent); } catch { return null; }
}

function post(method, params = {}) {
  try { parent.postMessage({ v: VERSION, method, params }, '*'); } catch { /* parent gone */ }
}

function contRect() {
  return (document.querySelector('.slide-container') || document.body).getBoundingClientRect();
}

/* container-local coords for any pointer event */
function localPt(ev) {
  const r = contRect();
  return { x: ev.clientX - r.left, y: ev.clientY - r.top };
}

/** Painted (visual) AABB — includes rotation. Use for hit-testing + guides. */
function elRect(el) {
  const r = contRect();
  const er = el.getBoundingClientRect();
  return { x: er.left - r.left, y: er.top - r.top, w: er.width, h: er.height };
}

/** Accumulated offset of an element inside the slide container, ignoring transforms. */
function offsetInContainer(el) {
  let x = 0, y = 0, n = el;
  const C = document.querySelector('.slide-container');
  while (n && n !== C && n !== document.body) {
    x += n.offsetLeft || 0;
    y += n.offsetTop || 0;
    n = n.offsetParent;
  }
  return { x, y };
}

/**
 * Layout rect — the CSS box (left/top/width/height) with rotation REMOVED.
 * This is the only rect that may be stored as geometry: committing a painted
 * AABB after a rotation would inflate the element on every save.
 */
function layoutRect(el) {
  const cs = getComputedStyle(el);
  const w = parseFloat(cs.width) || 0;
  const h = parseFloat(cs.height) || 0;
  const o = offsetInContainer(el);
  return { x: o.x, y: o.y, w, h };
}

/** Inline rotation in degrees (geometry renders as rotate(Ndeg)). */
function rotOf(el) {
  const m = /rotate\(\s*(-?[\d.]+)deg\s*\)/.exec(el.style.transform || '');
  return m ? Number(m[1]) : 0;
}

/** Rotate point p around c by deg degrees. */
function rotPoint(p, c, deg) {
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  const dx = p.x - c.x, dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

/** AABB of a layout rect after rotating it around its centre. */
function rotatedAabb(r, deg) {
  if (!deg) return { ...r };
  const c = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  const pts = [
    { x: r.x, y: r.y }, { x: r.x + r.w, y: r.y },
    { x: r.x, y: r.y + r.h }, { x: r.x + r.w, y: r.y + r.h },
  ].map((p) => rotPoint(p, c, deg));
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x1 = Math.min(...xs), y1 = Math.min(...ys);
  return { x: x1, y: y1, w: Math.max(...xs) - x1, h: Math.max(...ys) - y1 };
}

/** Visual rect of an element: layout rect rotated by its own angle. */
function visualRect(el) {
  return rotatedAabb(layoutRect(el), rotOf(el));
}

function unionRect(rects) {
  if (!rects.length) return { x: 0, y: 0, w: 0, h: 0 };
  const x1 = Math.min(...rects.map((r) => r.x));
  const y1 = Math.min(...rects.map((r) => r.y));
  const x2 = Math.max(...rects.map((r) => r.x + r.w));
  const y2 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function applyLocal(el, r) {
  if (el.getAttribute('data-sf-role') === 'image' || el.hasAttribute('data-sf-extra')) {
    // The full-slide image overlay keeps absolute container coordinates.
    const parent = el.offsetParent;
    let relX = r.x, relY = r.y;
    if (parent && parent !== document.body) {
      const pr = parent.getBoundingClientRect();
      const cr = contRect();
      relX = r.x - (pr.left - cr.left);
      relY = r.y - (pr.top - cr.top);
    }
    el.style.position = 'absolute';
    el.style.left = `${Math.round(relX)}px`;
    el.style.top = `${Math.round(relY)}px`;
  } else {
    // OFFSET MODEL (2026-10-23): geometry is a delta from the element's
    // natural flow slot, applied with position:relative. Nothing leaves the
    // flow, so moving one element can never reflow its siblings.
    // layoutRect() already includes any existing offset => idempotent.
    const cur = layoutRect(el);
    const lx = (parseFloat(el.style.left) || 0) + (r.x - cur.x);
    const ly = (parseFloat(el.style.top) || 0) + (r.y - cur.y);
    el.style.position = 'relative';
    el.style.left = `${Math.round(lx)}px`;
    el.style.top = `${Math.round(ly)}px`;
  }
  el.style.margin = '0';
  if (r.w !== undefined) el.style.width = `${Math.round(r.w)}px`;
  if (r.h !== undefined) el.style.height = `${Math.round(r.h)}px`;
  if (r.r !== undefined) {
    el.style.transformOrigin = 'center center';
    const rr = Math.round(r.r);
    el.style.transform = rr ? `rotate(${rr}deg)` : '';
  }
  if (!el.style.zIndex) el.style.zIndex = '20';
}

/* ----------------------------- bridge chrome (C1/C2/C3 overlays) ----------------------------- */

let chrome = null; // { host, bbox, handles, guides, chip, alignbar, marquee, lines: [] }

const CHROME_CSS = `
.sf-bchost{position:absolute;inset:0;pointer-events:none;z-index:100}
.sf-bchost *{pointer-events:none}
.sf-bchost .sf-hand,.sf-bchost .sf-alignbar,.sf-bchost .sf-alignbar button{pointer-events:auto}
.sf-bbox{position:absolute;border:1.5px solid #2563EB;box-shadow:0 0 0 1px rgba(37,99,235,.22)}
.sf-hand{position:absolute;width:9px;height:9px;background:#fff;border:1.5px solid #2563EB;border-radius:2px;cursor:var(--hcur,nwse-resize)}
.sf-hand.sf-rot{width:12px;height:12px;border-radius:50%;background:#2563EB;border-color:#fff;box-shadow:0 1px 4px rgba(15,23,42,.35);cursor:grab}
.sf-hand.sf-rot:active{cursor:grabbing}
.sf-rotstem{position:absolute;width:1px;background:#2563EB;opacity:.55}
.sf-guide{position:absolute;background:#EF4444;opacity:.9}
.sf-gcanvas{background:#2563EB}
.sf-gobject{background:#EF4444}
.sf-gspacing{background:#EC4899;opacity:.85;outline:1px dashed rgba(236,72,153,.6);outline-offset:1px}
.sf-chip{position:absolute;background:#111827;color:#fff;font:11px/1.4 ui-monospace,monospace;padding:2px 6px;border-radius:5px;white-space:nowrap;z-index:101}
.sf-marquee{position:absolute;border:1px dashed #2563EB;background:rgba(37,99,235,.08)}
.sf-alignbar{position:absolute;display:flex;gap:2px;background:#fff;border:1px solid #E5E7EB;border-radius:8px;padding:3px;box-shadow:0 4px 14px rgba(15,23,42,.16);z-index:102}
.sf-alignbar button{width:24px;height:24px;border:0;background:transparent;border-radius:5px;cursor:pointer;font-size:11px;line-height:1;color:#374151;padding:0}
.sf-alignbar button:hover{background:#EFF6FF;color:#2563EB}
.sf-hover{outline:1.5px dashed rgba(37,99,235,.55);outline-offset:3px}
.sf-selected{outline:1.5px solid #2563EB;outline-offset:3px}
[data-sf-mode="draw"] .sf-bchost, [data-sf-mode="draw"] .sf-hover, [data-sf-mode="draw"] .sf-selected{display:none;outline:none}
`;

function buildAlignbar(bar) {
  const modes = [
    ['left', '⇤', 'align left'], ['hcenter', '⇔', 'align centre-x'], ['right', '⇥', 'align right'],
    ['top', '⇧', 'align top'], ['vcenter', '⇕', 'align middle'], ['bottom', '⇩', 'align bottom'],
    ['dist-x', '⋮⋯', 'distribute horizontally'], ['dist-y', '⋯⋮', 'distribute vertically'],
  ];
  bar.innerHTML = '';
  for (const [m, glyph, title] of modes) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = glyph;
    b.title = title;
    b.dataset.mode = m;
    bar.appendChild(b);
  }
  const sep = document.createElement('span');
  sep.style.cssText = 'width:1px;height:16px;background:#E5E7EB;margin:0 2px';
  bar.appendChild(sep);
  for (const [m, glyph, title] of [['raise', '↑', 'raise z-order (Ctrl+])'], ['lower', '↓', 'lower z-order (Ctrl+[)'], ['dup', '⧉', 'duplicate (Ctrl+D)'], ['ai-rewrite', '✦', 'AI Rewrite selection']]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = glyph;
    b.title = title;
    b.dataset.mode = m;
    bar.appendChild(b);
  }
  bar.addEventListener('click', onAlignClick);
}

function ensureChrome() {
  if (chrome) return chrome;
  const style = document.createElement('style');
  style.textContent = CHROME_CSS;
  document.head.appendChild(style);
  const host = document.createElement('div');
  host.className = 'sf-bchost';
  host.setAttribute('aria-hidden', 'true');
  const gen = (cls) => { const d = document.createElement('div'); d.className = cls; return d; };
  const bbox = gen('sf-bbox');
  const cursors = { nw: 'nwse', n: 'ns', ne: 'nesw', e: 'ew', se: 'nwse', s: 'ns', sw: 'nesw', w: 'ew' };
  const handles = {};
  for (const h of HANDS) {
    const d = gen('sf-hand');
    d.dataset.h = h;
    d.style.setProperty('--hcur', `${cursors[h]}-resize`);
    bbox.appendChild(d);
    handles[h] = d;
  }
  const rotStem = gen('sf-rotstem');
  bbox.appendChild(rotStem);
  const rotHandle = gen('sf-hand sf-rot');
  rotHandle.dataset.h = 'rot';
  rotHandle.style.setProperty('--hcur', 'grab');
  rotHandle.title = 'Rotate (Shift = 15°)';
  bbox.appendChild(rotHandle);
  const guides = gen('sf-bchost-guides');
  const chip = gen('sf-chip');
  const alignbar = gen('sf-alignbar');
  const marquee = gen('sf-marquee');
  buildAlignbar(alignbar);
  host.append(bbox, guides, chip, alignbar, marquee);
  (document.querySelector('.slide-container') || document.body).appendChild(host);
  chrome = { host, bbox, handles, rotStem, rotHandle, guides, chip, alignbar, marquee, lines: [] };
  hideChrome();
  return chrome;
}

function hideChrome() {
  if (!chrome) return;
  for (const k of ['bbox', 'chip', 'alignbar', 'marquee']) chrome[k].style.display = 'none';
  if (chrome.rotHandle) chrome.rotHandle.style.display = 'none';
  if (chrome.rotStem) chrome.rotStem.style.display = 'none';
  clearGuides();
}

function clearGuides() {
  if (!chrome) return;
  for (const l of chrome.lines) l.remove();
  chrome.lines = [];
}

function hideChip() { if (chrome) chrome.chip.style.display = 'none'; }

/* ------------------------------ selection model (C1) ------------------------------ */

let sel = []; // [{ sfId, slot, el }]
let hoverEl = null;
let uiRects = []; // cached rects for current selection
let uiUnion = null;

function selectableIds(el) {
  return { sfId: el.getAttribute('data-sf-id'), slot: el.getAttribute('data-sf-slot') || '' };
}

function setSelection(list, { notify = true } = {}) {
  for (const s of sel) s.el?.classList.remove('sf-selected');
  sel = (list || []).filter(Boolean);
  for (const s of sel) s.el?.classList.add('sf-selected');
  hoverCleanup();
  if (!sel.length) hideChrome(); else renderChrome();
  if (notify) {
    const it = sel[0];
    let info = { sfId: null, count: 0 };
    if (it && it.el) {
      const cs = getComputedStyle(it.el);
      const isLeaf = it.el.children.length === 0;
      info = {
        sfId: it.sfId,
        slot: it.slot || '',
        count: sel.length,
        isLeaf,
        text: isLeaf ? (it.el.textContent || '').trim() : '',
        computed: {
          fontSize: Math.round(parseFloat(cs.fontSize) || 18),
          radius: Math.round(parseFloat(cs.borderRadius) || 0),
        },
      };
    }
    post('element.select', info);
  }
}

function renderChrome() {
  const c = ensureChrome();
  uiRects = sel.map((s) => ({ sfId: s.sfId, slot: s.slot, el: s.el, rect: layoutRect(s.el) }));
  const singleRot = sel.length === 1 ? rotOf(sel[0].el) : 0;
  // Single rotated element: the box rotates with it (handles hug the element).
  // Otherwise: axis-aligned union of the visual rects.
  const u = singleRot
    ? { ...uiRects[0].rect }
    : unionRect(sel.map((s) => visualRect(s.el)));
  uiUnion = u;
  Object.assign(c.bbox.style, {
    left: `${u.x}px`, top: `${u.y}px`, width: `${u.w}px`, height: `${u.h}px`, display: 'block',
    transform: singleRot ? `rotate(${singleRot}deg)` : '',
    transformOrigin: 'center center',
  });
  const half = (v) => v / 2;
  const P = {
    nw: [0, 0], n: [half(u.w), 0], ne: [u.w, 0], e: [u.w, half(u.h)],
    se: [u.w, u.h], s: [half(u.w), u.h], sw: [0, u.h], w: [0, half(u.h)],
  };
  for (const h of HANDS) {
    const d = c.handles[h];
    d.style.left = `${P[h][0] - 4.5}px`;
    d.style.top = `${P[h][1] - 4.5}px`;
  }
  const rx = half(u.w) - 4.5;
  c.rotHandle.style.left = `${rx}px`;
  c.rotHandle.style.top = `${-26}px`;
  c.rotHandle.style.display = 'block';
  c.rotStem.style.left = `${half(u.w) - 0.5}px`;
  c.rotStem.style.top = `${-20}px`;
  c.rotStem.style.height = '20px';
  c.rotStem.style.display = 'block';
  const vis = singleRot ? rotatedAabb(u, singleRot) : u;
  Object.assign(c.alignbar.style, {
    left: `${Math.max(0, Math.min(vis.x, CANVAS.w - 260))}px`,
    top: `${Math.max(0, Math.min(vis.y + vis.h + 10, CANVAS.h - 32))}px`,
    display: 'flex',
  });
}

function hoverCleanup() {
  if (hoverEl) { hoverEl.classList.remove('sf-hover'); hoverEl = null; }
}

/* -------------------------------- marquee (C1.2) -------------------------------- */

const mq = { active: false, p0: null };

function startMarquee(ev) {
  const c = ensureChrome();
  mq.active = true;
  mq.p0 = localPt(ev);
  c.host.appendChild(c.marquee); // keep on top
  Object.assign(c.marquee.style, { left: `${mq.p0.x}px`, top: `${mq.p0.y}px`, width: '0px', height: '0px', display: 'block' });
}

function moveMarquee(ev) {
  if (!mq.active) return;
  const p = localPt(ev);
  Object.assign(chrome.marquee.style, {
    left: `${Math.min(mq.p0.x, p.x)}px`,
    top: `${Math.min(mq.p0.y, p.y)}px`,
    width: `${Math.abs(p.x - mq.p0.x)}px`,
    height: `${Math.abs(p.y - mq.p0.y)}px`,
  });
}

function endMarquee(ev) {
  if (!mq.active) return;
  mq.active = false;
  chrome.marquee.style.display = 'none';
  const p = localPt(ev);
  const box = unionRect([{ x: mq.p0.x, y: mq.p0.y, w: p.x - mq.p0.x, h: p.y - mq.p0.y }]);
  if (box.w < 4 && box.h < 4) { setSelection([]); return; } // plain background click deselects
  const hits = $$('[data-sf-id]').filter((el) => {
    const r = elRect(el);
    return r.x < box.x + box.w && r.x + r.w > box.x && r.y < box.y + box.h && r.y + r.h > box.y;
  }).map((el) => ({ ...selectableIds(el), el }));
  setSelection(hits);
}

/* ------------------------------ drag + smart guides (C2) ------------------------------ */

const drag = { active: null };

function startDrag(ev) {
  const first = sel[0];
  if (!first) return;
  ensureChrome();
  const others = $$('[data-sf-id]')
    .filter((el) => !sel.some((s) => s.el === el))
    .map((el) => ({ id: selectableIds(el).sfId, rect: visualRect(el) }));
  const p = localPt(ev);
  const prim = layoutRect(first.el);
  const primVis = visualRect(first.el);
  drag.active = {
    moved: false, startX: ev.clientX, startY: ev.clientY, others,
    session: SFSnap.startSession({ id: first.sfId, rect: primVis }, others),
    prim, primVis,
    base: uiRects.map((r) => ({ ...r.rect, rot: rotOf(r.el), vis: visualRect(r.el), sfId: r.sfId, slot: r.slot, el: r.el, css: r.el.style.cssText })),
    p,
  };
}

function drawGuides(guides) {
  const c = ensureChrome();
  clearGuides();
  for (const g of guides) {
    const l = document.createElement('div');
    l.className = `sf-guide sf-g${g.kind}`;
    if (g.axis === 'x') l.style.cssText += `left:${g.at - 0.5}px;top:0;width:1px;height:${CANVAS.h}px;`;
    else l.style.cssText += `top:${g.at - 0.5}px;left:0;height:1px;width:${CANVAS.w}px;`;
    c.guides.appendChild(l);
    c.lines.push(l);
  }
}

function drawSpacing(ghost) {
  // v1 (docs/07 C2.3): equal-spacing is an INDICATOR (pink line where the gap
  // is already equal within 2px), not yet a snap force — honest reduction.
  const extra = [];
  for (const axis of ['x', 'y']) {
    if (axis === 'x') {
      const left = drag.active.others.filter((o) => o.rect.x + o.rect.w <= ghost.x + 2)
        .sort((a, b) => b.rect.x + b.rect.w - (a.rect.x + a.rect.w))[0];
      const right = drag.active.others.filter((o) => o.rect.x >= ghost.x + ghost.w - 2)
        .sort((a, b) => a.rect.x - b.rect.x)[0];
      if (left && right) {
        const gl = ghost.x - (left.rect.x + left.rect.w);
        const gr = right.rect.x - (ghost.x + ghost.w);
        if (Math.abs(gl - gr) <= 2) extra.push({ axis: 'x', at: ghost.x - gl / 2 + (left.rect.x + left.rect.w) / 2, kind: 'spacing' });
      }
    } else {
      const top = drag.active.others.filter((o) => o.rect.y + o.rect.h <= ghost.y + 2)
        .sort((a, b) => b.rect.y + b.rect.h - (a.rect.y + a.rect.h))[0];
      const bot = drag.active.others.filter((o) => o.rect.y >= ghost.y + ghost.h - 2)
        .sort((a, b) => a.rect.y - b.rect.y)[0];
      if (top && bot) {
        const gt = ghost.y - (top.rect.y + top.rect.h);
        const gb = bot.rect.y - (ghost.y + ghost.h);
        if (Math.abs(gt - gb) <= 2) extra.push({ axis: 'y', at: ghost.y - gt / 2 + (top.rect.y + top.rect.h) / 2, kind: 'spacing' });
      }
    }
  }
  return extra;
}

function onPointerMoveDrag(ev) {
  const d = drag.active;
  if (!d) return;
  const dxRaw = ev.clientX - d.startX;
  const dyRaw = ev.clientY - d.startY;
  if (!d.moved && Math.abs(dxRaw) < 3 && Math.abs(dyRaw) < 3) return;
  d.moved = true;
  ev.preventDefault();
  document.body.style.userSelect = 'none';
  const pv = d.primVis;
  const ghost = { id: d.base[0].sfId, x: pv.x + dxRaw, y: pv.y + dyRaw, w: pv.w, h: pv.h };
  const { rect, guides } = SFSnap.snapRect(ghost, d.session, { disabled: ev.altKey });
  const dx = rect.x - pv.x;
  const dy = rect.y - pv.y;
  for (const m of d.base) applyLocal(m.el, { x: m.x + dx, y: m.y + dy, w: m.w, h: m.h });
  drawGuides(guides.concat(d.moved ? drawSpacing({ ...rect, id: d.base[0].sfId }) : []));
  showChip(rect, ev.altKey, d.base[0].rot);
}

function showChip(rect, alt = false, rot = 0) {
  const c = ensureChrome();
  const rtxt = rot ? ` · ${Math.round(rot)}°` : '';
  c.chip.textContent = `${Math.round(rect.x)},${Math.round(rect.y)} · ${Math.round(rect.w)}×${Math.round(rect.h)}${rtxt}${alt ? ' · alt=no snap' : ''}`;
  Object.assign(c.chip.style, {
    display: 'block',
    left: `${Math.max(0, Math.min(rect.x, CANVAS.w - 180))}px`,
    top: `${Math.max(2, rect.y - 24)}px`,
  });
}

function endDrag(ev, commit) {
  const d = drag.active;
  drag.active = null;
  document.body.style.userSelect = '';
  clearGuides();
  if (!d) return;
  if (!d.moved) { renderChrome(); return; }
  if (!commit) { // pointercancel: revert to gesture-start styles (M4 rule)
    for (const m of d.base) m.el.style.cssText = m.css;
    setSelection(sel, { notify: false });
    return;
  }
  hideChip();
  commitSelection();
}


/* ------------------------------ resize (C3) ------------------------------ */

const rz = { active: null };

function startResize(ev, hname) {
  ensureChrome();
  const rot = sel.length === 1 ? rotOf(sel[0].el) : 0;
  rz.active = {
    h: hname, startX: ev.clientX, startY: ev.clientY, base: { ...uiUnion }, last: null, rot,
    startLocal: null,
    members: uiRects.map((r) => ({ ...layoutRect(r.el), rot: rotOf(r.el), sfId: r.sfId, slot: r.slot, el: r.el, css: r.el.style.cssText })),
    others: $$('[data-sf-id]')
      .filter((el) => !sel.some((s) => s.el === el))
      .map((el) => ({ id: selectableIds(el).sfId, rect: visualRect(el) })),
  };
  if (rot) {
    const bc = { x: rz.active.base.x + rz.active.base.w / 2, y: rz.active.base.y + rz.active.base.h / 2 };
    rz.active.baseC = bc;
    rz.active.startLocal = rotPoint(localPt(ev), bc, -rot);
  }
}

/** Aspect lock (Shift + corner): scale both axes by the larger ratio, anchored at the opposite edge (docs/07 C3.1). */
function anchorAdjust(name, r, base, shift) {
  if (shift && name.length === 2) {
    const k = Math.max(r.w / Math.max(base.w, 1), r.h / Math.max(base.h, 1));
    r.w = base.w * k;
    r.h = base.h * k;
    if (name.includes('w')) r.x = base.x + base.w - r.w;
    if (name.includes('n')) r.y = base.y + base.h - r.h;
  }
  return r;
}

/** Corner of rect r that must stay pinned for a given resize handle. */
function anchorCorner(name, r) {
  const x = name.includes('w') ? r.x + r.w : r.x;
  const y = name.includes('n') ? r.y + r.h : r.y;
  return { x, y };
}

function onPointerResizeMove(ev) {
  const a = rz.active;
  if (!a) return;
  ev.preventDefault();
  document.body.style.userSelect = 'none';
  let dx, dy;
  if (a.rot) {
    // Work in the element's own rotated space so the handles feel square to
    // the user. Snapping is intentionally disabled while rotated (honest v1).
    const L = rotPoint(localPt(ev), a.baseC, -a.rot);
    dx = L.x - a.startLocal.x;
    dy = L.y - a.startLocal.y;
  } else {
    dx = ev.clientX - a.startX;
    dy = ev.clientY - a.startY;
  }
  let r = { x: a.base.x, y: a.base.y, w: a.base.w, h: a.base.h };
  if (a.h.includes('e')) r.w += dx;
  if (a.h.includes('w')) { r.x += dx; r.w -= dx; }
  if (a.h.includes('s')) r.h += dy;
  if (a.h.includes('n')) { r.y += dy; r.h -= dy; }
  r = anchorAdjust(a.h, r, a.base, ev.shiftKey);
  let f, guides = [];
  if (a.rot) {
    f = r;
    // keep the opposite corner visually pinned: resizing moves the centre,
    // and the centre is the rotation pivot, so correct the drift.
    const anchorBase = anchorCorner(a.h, a.base);
    const anchorNew = anchorCorner(a.h, f);
    const Pa = rotPoint(anchorBase, a.baseC, a.rot);
    const fc = { x: f.x + f.w / 2, y: f.y + f.h / 2 };
    const Pr = rotPoint(anchorNew, fc, a.rot);
    f = { ...f, x: f.x + (Pa.x - Pr.x), y: f.y + (Pa.y - Pr.y) };
  } else {
    const edgeSet = [];
    if (a.h.includes('w')) edgeSet.push('left');
    if (a.h.includes('e')) edgeSet.push('right');
    if (a.h.includes('n')) edgeSet.push('top');
    if (a.h.includes('s')) edgeSet.push('bottom');
    if (!a.session) a.session = SFSnap.startSession({ id: '__resize__', rect: r }, a.others);
    const snapped = SFSnap.snapResizeEdges(r, a.session, edgeSet, { disabled: ev.altKey });
    f = snapped.rect;
    guides = snapped.guides || [];
    a.last = snapped;
  }
  const sw = a.base.w ? f.w / a.base.w : 1;
  const sh = a.base.h ? f.h / a.base.h : 1;
  for (const m of a.members) {
    applyLocal(m.el, {
      x: f.x + (m.x - a.base.x) * sw,
      y: f.y + (m.y - a.base.y) * sh,
      w: a.members.length > 1 ? Math.max(SFSnap.MIN_SIZE, m.w * sw) : f.w,
      h: a.members.length > 1 ? Math.max(SFSnap.MIN_SIZE, m.h * sh) : f.h,
      r: m.rot,
    });
  }
  if (a.rot) {
    Object.assign(chrome.bbox.style, {
      left: `${f.x}px`, top: `${f.y}px`, width: `${f.w}px`, height: `${f.h}px`,
      transform: `rotate(${a.rot}deg)`, transformOrigin: 'center center',
    });
  } else {
    Object.assign(chrome.bbox.style, { left: `${f.x}px`, top: `${f.y}px`, width: `${f.w}px`, height: `${f.h}px`, transform: '' });
  }
  drawGuides(guides);
  showChip(f, ev.altKey, a.rot);
}

function endResize(ev, commit) {
  const a = rz.active;
  rz.active = null;
  document.body.style.userSelect = '';
  clearGuides();
  if (!a) return;
  hideChip();
  if (!commit) {
    for (const m of a.members) m.el.style.cssText = m.css;
    setSelection(sel, { notify: false });
    return;
  }
  commitSelection();
}

/* ------------------------------ keyboard nudge (C4) ------------------------------ */

let nudgeTimer = null;

function nudge(dx, dy) {
  if (!sel.length) return;
  for (const s of sel) {
    const r = layoutRect(s.el);
    applyLocal(s.el, SFSnap.clampRect({ x: r.x + dx, y: r.y + dy, w: r.w, h: r.h }));
  }
  renderChrome();
  clearTimeout(nudgeTimer);
  nudgeTimer = setTimeout(commitSelection, 420); // held arrows batch into ONE commit
}

function commitSelection() {
  if (!sel.length) return;
  const items = sel.map((s) => {
    const l = layoutRect(s.el);
    const absolute = s.el.hasAttribute('data-sf-extra') || s.el.getAttribute('data-sf-role') === 'image';
    // Base layout elements persist the OFFSET from their flow slot; extras and
    // the image overlay persist their absolute canvas position.
    const x = absolute ? l.x : (parseFloat(s.el.style.left) || 0);
    const y = absolute ? l.y : (parseFloat(s.el.style.top) || 0);
    const w = s.el.style.width ? l.w : undefined;
    const h = s.el.style.height ? l.h : undefined;
    const z = s.el.style.zIndex ? Number(s.el.style.zIndex) : undefined;
    const rr = rotOf(s.el);
    return {
      sfId: s.sfId, slot: s.slot || '',
      x: Math.round(x), y: Math.round(y),
      ...(w !== undefined ? { w: Math.round(w) } : {}),
      ...(h !== undefined ? { h: Math.round(h) } : {}),
      ...(Number.isFinite(z) ? { z } : {}),
      ...(rr ? { r: rr } : {}),
      atX: Math.round(l.x), atY: Math.round(l.y), // rendered position (wire/debug)
    };
  });
  post('element.geometry.list', { items });
}

/* ------------------------------ z-order (raise/lower) ------------------------------ */

function raiseZ() {
  if (!sel.length) return;
  for (const s of sel) {
    const cur = Number(s.el.style.zIndex) || 20;
    s.el.style.zIndex = String(Math.min(999, cur + 1));
  }
  renderChrome();
  commitSelection();
}

function lowerZ() {
  if (!sel.length) return;
  for (const s of sel) {
    const cur = Number(s.el.style.zIndex) || 20;
    s.el.style.zIndex = String(Math.max(1, cur - 1));
  }
  renderChrome();
  commitSelection();
}

/* ------------------------------ duplicate (Ctrl+D) ------------------------------ */

function duplicateSelected() {
  if (!sel.length) return;
  const s = sel[0];
  const r = SFSnap.clampRect({ ...layoutRect(s.el) });
  const text = (s.el.textContent || '').trim();
  const cls = (s.el.className || 'sf-extra').replace(/\bsf-selected\b/g, '').trim() || 'sf-extra';
  post('element.duplicate', {
    sfId: s.sfId, slot: s.slot || '', text, cls,
    x: Math.min(r.x + 20, CANVAS.w - r.w), y: Math.min(r.y + 20, CANVAS.h - r.h),
    w: r.w, h: r.h, r: rotOf(s.el),
    z: Number(s.el.style.zIndex) || 20,
  });
}

/** Only duplicated extras are removable — base layout slots stay intact. */
function deleteSelected() {
  if (sel.length !== 1) return;
  const s = sel[0];
  if (!/-copy\d*$/.test(s.sfId)) return;
  post('element.delete', { sfId: s.sfId });
}

function clearSel() { setSelection([]); }

/* ------------------------------ alignment bar (C4.4) ------------------------------ */

function onAlignClick(ev) {
  const m = ev.target?.dataset?.mode;
  if (!m || !sel.length) return;
  if (m === 'raise') { raiseZ(); return; }
  if (m === 'lower') { lowerZ(); return; }
  if (m === 'dup') { duplicateSelected(); return; }
  if (m === 'ai-rewrite') { post('selection.action', { action: 'ai-rewrite', sfId: sel[0].sfId, slot: sel[0].slot || '' }); return; }
  const rects = sel.map((s) => ({ ...layoutRect(s.el) }));
  let next;
  let bounds;
  if (m === 'dist-x' || m === 'dist-y') {
    next = SFSnap.distributeRects(rects, m === 'dist-x' ? 'x' : 'y');
  } else {
    bounds = sel.length > 1 ? unionRect(rects) : { x: 0, y: 0, w: CANVAS.w, h: CANVAS.h };
    next = SFSnap.alignRects(rects, bounds, m);
  }
  next.forEach((r, i) => applyLocal(sel[i].el, r));
  renderChrome();
  commitSelection();
}


/* ------------------------------ rotation (C6) ------------------------------ */

const rot = { active: null };

function startRotate(ev) {
  ensureChrome();
  // Pivot = centre of the visual union, so a group orbits as one object.
  const vis = unionRect(sel.map((s) => visualRect(s.el)));
  const gc = { x: vis.x + vis.w / 2, y: vis.y + vis.h / 2 };
  const cr = contRect();
  const p0 = { x: ev.clientX - cr.left, y: ev.clientY - cr.top };
  const startAngle = (Math.atan2(p0.y - gc.y, p0.x - gc.x) * 180) / Math.PI;
  rot.active = {
    gc, startAngle, last: 0,
    members: sel.map((s) => {
      const r = layoutRect(s.el);
      return { sfId: s.sfId, slot: s.slot, el: s.el, x: r.x, y: r.y, w: r.w, h: r.h, baseR: rotOf(s.el), css: s.el.style.cssText };
    }),
  };
}

function onPointerRotateMove(ev) {
  const a = rot.active;
  if (!a) return;
  ev.preventDefault();
  document.body.style.userSelect = 'none';
  const cr = contRect();
  const p = { x: ev.clientX - cr.left, y: ev.clientY - cr.top };
  const angle = (Math.atan2(p.y - a.gc.y, p.x - a.gc.x) * 180) / Math.PI;
  let delta = angle - a.startAngle;
  const base0 = a.members[0]?.baseR || 0;
  if (ev.shiftKey) {
    delta = Math.round(delta / 15) * 15;             // hard 15° steps
  } else {
    const r0 = base0 + delta;
    const magnet = Math.round(r0 / 90) * 90;          // soft 4° magnet at 0/90/180/270
    if (Math.abs(r0 - magnet) <= 4) delta = magnet - base0;
  }
  a.last = delta;
  for (const m of a.members) {
    const c0 = { x: m.x + m.w / 2, y: m.y + m.h / 2 };
    const c1 = rotPoint(c0, a.gc, delta);
    applyLocal(m.el, { x: c1.x - m.w / 2, y: c1.y - m.h / 2, w: m.w, h: m.h, r: m.baseR + delta });
  }
  renderChrome();
  const shown = Math.round(base0 + delta);
  if (chrome) {
    chrome.chip.textContent = `r ${shown}°${ev.shiftKey ? ' · 15° step' : ''}`;
    const u = unionRect(a.members.map((m) => visualRect(m.el)));
    Object.assign(chrome.chip.style, {
      display: 'block',
      left: `${Math.max(0, Math.min(u.x, CANVAS.w - 160))}px`,
      top: `${Math.max(2, u.y - 48)}px`,
    });
  }
}

function endRotate(ev, commit) {
  const a = rot.active;
  rot.active = null;
  document.body.style.userSelect = '';
  if (!a) return;
  if (!commit) {
    for (const m of a.members) m.el.style.cssText = m.css;
    setSelection(sel, { notify: false });
    return;
  }
  hideChip();
  renderChrome();
  commitSelection();
}

function inCanvas(target) {
  return target instanceof Node && (document.querySelector('.slide-container') || document.body).contains(target);
}

function onPointerDown(ev) {
  if (ev.button !== 0 || mode !== 'select') return;
  if (!inCanvas(ev.target)) return;
  if (ev.target.closest?.('.sf-alignbar')) return; // chrome anchors nothing on canvas
  const handle = ev.target.closest?.('.sf-hand');
  if (handle) {
    if (handle.classList.contains('sf-rot') || handle.dataset.h === 'rot') {
      ev.preventDefault();
      startRotate(ev);
      return;
    }
    ev.preventDefault();
    startResize(ev, handle.dataset.h);
    return;
  }
  if (ev.target.closest?.('.sf-alignbar')) return; // buttons handle themselves
  const el = ev.target.closest?.('[data-sf-id]');
  if (el) {
    const meta = selectableIds(el);
    const existing = sel.find((s) => s.sfId === meta.sfId);
    if (ev.shiftKey) {
      // additive toggle ends the gesture (drag after: plain click again)
      setSelection(existing ? sel.filter((s) => s.sfId !== meta.sfId) : [...sel, { ...meta, el }], { notify: true });
      ev.preventDefault();
      return;
    }
    if (!existing) setSelection([{ ...meta, el }], { notify: true });
    startDrag(ev);
  } else {
    startMarquee(ev);
  }
}

function onPointerMove(ev) {
  if (drag.active) onPointerMoveDrag(ev);
  else if (rz.active) onPointerResizeMove(ev);
  else if (rot.active) onPointerRotateMove(ev);
  else if (mq.active) moveMarquee(ev);
}

function onPointerUp(ev) {
  if (mq.active) endMarquee(ev);
  else if (drag.active) endDrag(ev, true);
  else if (rz.active) endResize(ev, true);
  else if (rot.active) endRotate(ev, true);
}

function onPointerCancel() {
  if (mq.active) { mq.active = false; chrome.marquee.style.display = 'none'; }
  if (drag.active) endDrag(null, false);
  if (rz.active) endResize(null, false);
  if (rot.active) endRotate(null, false);
}

/* hover affordance (C1) */
document.addEventListener('pointerover', (ev) => {
  if (mode !== 'select' || drag.active || rz.active || mq.active || !inCanvas(ev.target)) return;
  hoverCleanup();
  const el = ev.target.closest?.('[data-sf-id]');
  if (el && !sel.some((s) => s.el === el)) { el.classList.add('sf-hover'); hoverEl = el; }
}, true);
document.addEventListener('pointerout', (ev) => {
  const el = ev.target.closest?.('[data-sf-id]');
  if (el && el === hoverEl) hoverCleanup();
}, true);

/* keyboard lives here so arrows work while the IFRAME is focused; the host
 * also forwards keys when focus is outside — one implementation, two doors. */
window.addEventListener('keydown', (ev) => {
  if (mode !== 'select') return;
  if (ev.target.closest?.('input, textarea, [contenteditable="true"], [contenteditable=""]')) return;
  if (ev.key === 'Escape') { if (sel.length) { clearSel(); } return; }
  if (ev.ctrlKey || ev.metaKey) {
    if (ev.key === ']' || ev.key === '}') { ev.preventDefault(); raiseZ(); return; }
    if (ev.key === '[' || ev.key === '{') { ev.preventDefault(); lowerZ(); return; }
    if (ev.key === 'd' || ev.key === 'D') { ev.preventDefault(); duplicateSelected(); return; }
    const kk = ev.key.toLowerCase();
    if (kk === 'z') { ev.preventDefault(); post(ev.shiftKey ? 'history.redo' : 'history.undo', {}); return; }
    if (kk === 'y') { ev.preventDefault(); post('history.redo', {}); return; }
  }
  if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); deleteSelected(); return; }
  if (!ev.key.startsWith('Arrow') || !sel.length) return;
  const step = ev.shiftKey ? 10 : 1;
  const map = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  const pair = map[ev.key];
  if (pair) { ev.preventDefault(); nudge(pair[0], pair[1]); }
});

/* draw mode keeps the original annotate click; select-mode clicks are
 * pointerdown-driven (docs/07 C1). */
document.addEventListener('click', (ev) => {
  if (mode !== 'draw') return;
  const p = localPt(ev);
  post('annotation.add', { x: Math.round(p.x), y: Math.round(p.y), page: spec?.id || '' });
}, true);

document.addEventListener('pointerdown', onPointerDown, true);
document.addEventListener('dragstart', (e) => { if (drag.active || rz.active || mq.active) e.preventDefault(); }, true);
window.addEventListener('pointermove', onPointerMove, { capture: true, passive: false });
window.addEventListener('pointerup', onPointerUp, true);
window.addEventListener('pointercancel', onPointerCancel, true);

/* ------------------------------ host messages ------------------------------ */

window.addEventListener('message', (ev) => {
  const msg = ev.data;
  if (!msg || msg.v !== VERSION || !IN.has(msg.method)) return;
  const p = msg.params || {};
  switch (msg.method) {
    case 'element.update': setText(p.sfId, p.value); break;
    case 'element.style': setStyle(p.sfId, p.styles); break;
    case 'element.select':
      if (p.sfId) {
        const el = $(`[data-sf-id="${CSS.escape(p.sfId)}"]`);
        if (el) setSelection([{ ...selectableIds(el), el }], { notify: false });
      } else clearSel();
      break;
    case 'nudge': nudge(Number(p.dx) || 0, Number(p.dy) || 0); break;
    case 'raiseZ': raiseZ(); break;
    case 'lowerZ': lowerZ(); break;
    case 'duplicate': duplicateSelected(); break;
    case 'element.delete': deleteSelected(); break;
    case 'setMode':
      mode = p.mode === 'draw' ? 'draw' : 'select';
      document.body.dataset.sfMode = mode;
      if (mode !== 'select') clearSel();
      break;
    case 'ping': post('log', { message: 'pong' }); break;
  }
});

/* ------------------------------ legacy helpers (M4 contract kept) ------------------------------ */

function setText(sfId, value) {
  const el = $(`[data-sf-id="${CSS.escape(sfId)}"]`);
  if (!el) return false;
  el.textContent = value;
  syncSpec(sfId, value);
  return true;
}

function setStyle(sfId, styles) {
  const el = $(`[data-sf-id="${CSS.escape(sfId)}"]`);
  if (!el) return false;
  for (const [k, v] of Object.entries(styles || {})) el.style.setProperty(k, v);
  return true;
}

function syncSpec(sfId, value) {
  if (!spec) return;
  const slot = $(`[data-sf-id="${CSS.escape(sfId)}"]`)?.getAttribute('data-sf-slot');
  if (!slot) return;
  const parts = slot.split('.');
  const root = parts[0];
  if (['title', 'subtitle', 'kicker', 'notes'].includes(root)) {
    spec[root] = value;
  } else if (spec.content && root in spec.content) {
    let node = spec.content;
    for (let i = 1; i < parts.length - 1; i++) { if (node[parts[i]] == null) return; node = node[parts[i]]; }
    const last = parts[parts.length - 1];
    if (node && typeof node === 'object') node[last] = value;
  }
  const island = $('#slide-spec');
  if (island) island.textContent = JSON.stringify(spec);
}

/* ------------------------------ boot ------------------------------ */

let booted = false;

function boot() {
  if (booted) return;
  booted = true;
  spec = readSpec();
  ensureChrome();
  post('slide.ready', {
    spec,
    page: spec?.id || '',
    elements: $$('[data-sf-id]').map((el) => ({
      ...selectableIds(el),
      rect: elRect(el),
      tag: el.tagName.toLowerCase(),
      text: (el.textContent || '').trim().slice(0, 160),
    })),
  });
}

document.addEventListener('DOMContentLoaded', boot);
if (document.readyState !== 'loading') boot();
