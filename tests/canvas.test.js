/**
 * tests/canvas.test.js — M-CANVAS Layer 0 gates (docs/07 C2/C3/C4):
 * pure snap math in public/canvas-snap.js (imported by the iframe bridge).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CANVAS, MIN_SIZE, clampRect, startSession, snapRect, snapResizeEdges,
  alignRects, distributeRects,
} from '../public/canvas-snap.js';

const TH = { threshold: 6 };

/* ---------------- clamp (C3.2 floor) ---------------- */

test('clampRect floors size at 24 and clamps position inside the canvas', () => {
  assert.deepEqual(clampRect({ x: -10, y: -10, w: 4, h: 4 }), { x: 0, y: 0, w: 24, h: 24 });
  const b = clampRect({ x: 3000, y: 3000, w: 400, h: 400 });
  assert.equal(b.x, CANVAS.w - 400);
  assert.equal(b.y, CANVAS.h - 400);
});

/* ---------------- snap: hits (C2) ---------------- */

test('snapRect snaps to the canvas centre-x within threshold', () => {
  const moving = { id: 'a', x: CANVAS.w / 2 - 4, y: 100, w: 100, h: 60 }; // left edge 4px from centre
  const s = startSession(moving, []);
  const { rect, guides } = snapRect(moving, s, TH);
  assert.equal(rect.x, CANVAS.w / 2);
  assert.ok(guides.some((g) => g.axis === 'x' && g.kind === 'canvas' && g.at === CANVAS.w / 2));
});

test('snapRect snaps to another object\'s right edge and reports object guide', () => {
  const other = { id: 'b', rect: { x: 600, y: 100, w: 80, h: 60 } };
  const moving = { id: 'a', x: 682, y: 100, w: 60, h: 60 }; // left edge 2px from 680
  const s = startSession(moving, [other]);
  const { rect, guides } = snapRect(moving, s, TH);
  assert.equal(rect.x, 680);
  assert.ok(guides.some((g) => g.axis === 'x' && g.kind === 'object' && g.ref === 'b'));
});

test('snapRect ignores distances beyond threshold (no magnetic rose-touching)', () => {
  const other = { id: 'b', rect: { x: 600, y: 100, w: 80, h: 60 } };
  const moving = { id: 'a', x: 690, y: 100, w: 60, h: 60 }; // 10px away — beyond 6
  const s = startSession(moving, [other]);
  const { rect } = snapRect(moving, s, TH);
  assert.equal(rect.x, 690);
});

test('snapRect honours the Alt override (disabled snapping)', () => {
  const other = { id: 'b', rect: { x: 600, y: 100, w: 80, h: 60 } };
  const moving = { id: 'a', x: 682, y: 100, w: 60, h: 60 };
  const s = startSession(moving, [other]);
  const { rect, guides } = snapRect(moving, s, { ...TH, disabled: true });
  assert.equal(rect.x, 682);
  assert.equal(guides.length, 0);
});

test('snapRect never snaps a rect to ITSELF (moving id excluded)', () => {
  const moving = { id: 'a', x: 682, y: 100, w: 60, h: 60 };
  const others = [{ id: 'a', rect: { x: 680, y: 100, w: 60, h: 60 } }];
  const s = startSession(moving, others);
  const { guides } = snapRect(moving, s, TH);
  assert.equal(guides.length, 0);
});

/* ---------------- resize snap (C3) ---------------- */

test('snapResizeEdges snaps the moved right edge and keeps the floor', () => {
  const other = { id: 'b', rect: { x: 700, y: 0, w: 40, h: 40 } };
  const s = startSession({ id: 'a', rect: { x: 0, y: 0, w: 10, h: 10 } }, [other]);
  const { rect, guides } = snapResizeEdges({ x: 0, y: 0, w: 695, h: 100 }, s, ['right'], TH);
  assert.equal(rect.w, 700);
  assert.ok(guides.some((g) => g.axis === 'x' && g.kind === 'object'));
});

test('snapResizeEdges pushes size to the floor when collapsing past 24', () => {
  const s = startSession({ id: 'a', rect: { x: 0, y: 0, w: 10, h: 10 } }, []);
  const { rect } = snapResizeEdges({ x: 500, y: 100, w: 10, h: 100 }, s, ['left'], { ...TH, disabled: true });
  assert.equal(rect.w, MIN_SIZE);
});

/* ---------------- align + distribute (C4.4) ---------------- */

test('alignRects aligns left/top inside an explicit bounds box', () => {
  const rects = [{ x: 100, y: 200, w: 50, h: 40 }, { x: 300, y: 400, w: 80, h: 30 }];
  const [a, b] = alignRects(rects, { x: 10, y: 10, w: 500, h: 300 }, 'left');
  assert.equal(a.x, 10);
  assert.equal(b.x, 10);
  const [c, d] = alignRects(rects, { x: 10, y: 10, w: 500, h: 300 }, 'top');
  assert.equal(c.y, 10);
  assert.equal(d.y, 10);
});

test('alignRects vcenter/right preserve size', () => {
  const rects = [{ x: 0, y: 0, w: 50, h: 40 }];
  const out = alignRects(rects, { x: 0, y: 0, w: 1000, h: 720 }, 'hcenter');
  assert.equal(out[0].x, (1000 - 50) / 2);
  assert.equal(out[0].w, 50);
});

test('distributeRects spreads 3 rects into equal gaps (axis x)', () => {
  const rects = [
    { x: 0, y: 0, w: 100, h: 50 },
    { x: 50, y: 0, w: 100, h: 50 },
    { x: 900, y: 0, w: 100, h: 50 },
  ];
  const out = distributeRects(rects, 'x');
  const sorted = [...out].sort((a, b) => a.x - b.x);
  const g1 = sorted[1].x - (sorted[0].x + sorted[0].w);
  const g2 = sorted[2].x - (sorted[1].x + sorted[1].w);
  assert.equal(g1, g2);
  assert.equal(sorted[0].x, 0);
  assert.equal(sorted[2].x, 900);
  // output order preserves caller order (bridge maps rects back by index)
  assert.equal(out[0].w, 100);
});

test('snapRect snaps to equal-spacing position when gaps are within threshold', () => {
  // three objects: left at 0..100, right at 300..400, moving in between
  // equal spacing: gap = (300 - (x+120)) should equal (x - 100)
  // => x - 100 = 300 - x - 120 => 2x = 320 => x = 160
  const left = { id: 'l', rect: { x: 0, y: 0, w: 100, h: 50 } };
  const right = { id: 'r', rect: { x: 300, y: 0, w: 100, h: 50 } };
  const moving = { id: 'm', x: 142, y: 0, w: 120, h: 50 }; // 2px off from 140
  const s = startSession(moving, [left, right]);
  const { rect, guides } = snapRect(moving, s, { threshold: 6 });
  assert.equal(rect.x, 140);
  assert.ok(guides.some((g) => g.kind === 'spacing'));
});

test('distributeRects is a no-op under 3 rects (docs/07 C4.4)', () => {
  const rects = [{ x: 10, y: 0, w: 100, h: 50 }, { x: 300, y: 0, w: 100, h: 50 }];
  assert.deepEqual(distributeRects(rects, 'x'), rects);
});
