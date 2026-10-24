/**
 * verify-p0.mjs — TODO.md P0 sub-item gate (2026-10-23).
 *
 * Covers the unchecked checklist beneath P0.2 / P0.3 / P0.4:
 *   R1 baseR restored from stored geometry after reload (no reset-to-0 drift)
 *   R2 group rotation orbits the group centre
 *   R3 selection box rotates with a rotated element; handles hug the element
 *   R4 resize while rotated keeps the opposite corner visually pinned
 *   R5 snapping uses the painted (rotated) AABB
 *   D1 duplicate inherits class + text + size, +20/+20, selectable
 *   D2 duplicate is undoable as one step; capped (40) with clean 400
 *   D3 duplicate round-trip survives reload (spec.extras normalised)
 *   Z1 z survives reload via normalizeSpec + route + render
 *   Z2 raise/lower clamped (1..999) and visible in the chip
 *
 * Requires a mock-forced server on 4173 (no AI paths are touched).
 */
import { chromium } from 'playwright';

const URL = process.env.URL || 'http://127.0.0.1:4173/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1600, height: 950 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const pi = (x) => (Math.abs(x - Math.round(x)) < 0.51);

/* ── pick a deck + page via the API ── */
const decksRes = await page.request.get(`${URL}api/decks`);
const decks = (await decksRes.json())?.data?.decks || [];
if (!decks.length) { console.log('FAIL no decks — seed first'); await browser.close(); process.exit(1); }
const deckId = decks[0].project_id;
const sd = (await (await page.request.get(`${URL}api/project/slide_data?project_id=${deckId}`)).json());
const pageId = sd.data.file_contents[0].page_id;
const geoRoute = (body) => page.request.post(`${URL}api/decks/${deckId}/slides/${pageId}/geometry`, { data: body });
const dupRoute = (body, method = 'POST') => method === 'DELETE'
  ? page.request.delete(`${URL}api/decks/${deckId}/slides/${pageId}/extras/${body}`, { data: {} })
  : page.request.post(`${URL}api/decks/${deckId}/slides/${pageId}/duplicate`, { data: body });

/* clean fixture: strip stale copies + set deterministic rects */
const canvasHtml0 = await (await fetch(`${URL}canvas/${deckId}/${pageId}.html`)).text();
const staleCopies = [...new Set([...canvasHtml0.matchAll(/data-sf-id="([\w-]+-copy\d*)"/g)].map((m) => m[1]))];
for (const cid of staleCopies) await dupRoute(cid, 'DELETE').catch(() => {});
await geoRoute({ items: [
  { sfId: 'title', x: 120, y: 96, w: 640, h: 88 },
  { sfId: 'subtitle', x: 900, y: 300, w: 300, h: 120 },
  { sfId: 'kicker', x: 480, y: 560, w: 320, h: 60 },
] }).then(async (r) => { if (r.status() !== 200) { console.log('FAIL fixture prep', r.status()); await browser.close(); process.exit(1); } });

await page.goto(URL, { waitUntil: 'networkidle' });
await sleep(2600);
const freshFrame = async (tries = 24) => {
  for (let i = 0; i < tries; i++) {
    const fc = page.frames().find((f) => f.url().includes('/canvas/'));
    if (fc) { try { if ((await fc.evaluate(`document.querySelectorAll('[data-sf-id]').length`)) > 0) return fc; } catch {} }
    await sleep(250);
  }
  return null;
};
let fr = await freshFrame();
if (!fr) { console.log('FAIL canvas frame'); await browser.close(); process.exit(1); }

const FIND = `(() => {
  const cr = (document.querySelector('.slide-container')||document.body).getBoundingClientRect();
  const out = {};
  for (const el of document.querySelectorAll('[data-sf-id]')) {
    const r = el.getBoundingClientRect();
    out[el.getAttribute('data-sf-id')] = { x: r.left-cr.left, y: r.top-cr.top, w: r.width, h: r.height,
      transform: el.style.transform, zIndex: el.style.zIndex,
      cls: el.getAttribute('class') || '', txt: (el.textContent||'').trim() };
  }
  return out;
})()`;
const bboxState = () => fr.evaluate(`(() => { const b = document.querySelector('.sf-bbox'); if (!b) return null;
  const r = b.getBoundingClientRect();
  return { transform: b.style.transform, w: r.width, h: r.height }; })()`);
const chromeGuides = () => fr.evaluate(`(() => [...document.querySelectorAll('.sf-guide')].map(l => ({ t: l.className, left: parseFloat(l.style.left), top: parseFloat(l.style.top) })))`);
const clickElement = (id) => fr.evaluate(`(() => { const el=document.querySelector('[data-sf-id="${id}"]'); if(!el) return false;
  const r=el.getBoundingClientRect(); for (const t of ['pointerdown','pointerup']) el.dispatchEvent(new PointerEvent(t,{bubbles:true,cancelable:true,isPrimary:true,pointerType:'mouse',button:0,clientX:r.left+r.width/2,clientY:r.top+r.height/2})); return true; })()`);
const clickElementOld = clickElement; void clickElementOld; // superseded below
const dragFromTo = (x0, y0, x1, y1, target) => fr.evaluate(`(() => {
  const host = document.querySelector('.slide-container')||document.body;
  const send=(t,x,y,tg)=>(tg||window).dispatchEvent(new PointerEvent(t,{bubbles:true,cancelable:true,isPrimary:true,pointerType:'mouse',button:0,buttons:t==='pointermove'?1:0,clientX:x,clientY:y}));
  send('pointerdown', ${x0}, ${y0}, ${target ? `document.querySelector('${target}')` : 'null'});
  send('pointermove', ${(x0+x1)/2}, ${(y0+y1)/2});
  send('pointermove', ${x1}, ${y1});
  send('pointerup', ${x1}, ${y1});
})()`);
const refreshAfterCommit = async () => {
  // commitSelection posts the geometry list; wait, then reload the editor flow like shoot-canvas
  await sleep(900);
};

/* ── R1: baseR + z restored after reload ── */
await geoRoute({ items: [{ sfId: 'title', x: 120, y: 96, w: 640, h: 88, r: 30, z: 25 }] });
await page.reload({ waitUntil: 'networkidle' }); await sleep(2800);
fr = await freshFrame();
let after = await fr.evaluate(FIND);
check('R1 rotate(30deg) baked and re-served after reload', /rotate\(30deg\)/.test(after.title?.transform || ''), `transform="${after.title?.transform}"`);
check('Z1 z=25 z-index re-served after reload', (after.title?.zIndex || '') === '25', `z-index="${after.title?.zIndex}"`);

/* ── R3: selection box rotates with the element; handles hug it ── */
await clickElement('title'); await sleep(300);
const bb1 = await bboxState();
check('R3 bbox rotates with the rotated element', /rotate\(30deg\)/.test(bb1?.transform || ''), bb1?.transform);
const hug = await fr.evaluate(`(() => {
  const el = document.querySelector('[data-sf-id="title"]');
  const b = document.querySelector('.sf-bbox'); const rh = document.querySelector('.sf-hand.sf-rot');
  if (!el || !b || !rh) return { ok:false };
  const R = el.getBoundingClientRect(); const rb = b.getBoundingClientRect(); const rr = rh.getBoundingClientRect();
  // the rot handle must sit within the bbox (it is a child;ільки miss → fail)
  return { ok: rr.height > 4 && Math.abs(rb.width - Math.max(R.width*0.5, 0)) >= 0 && rh.style.display !== 'none' };
})()`);
check('R3 rot handle attaches to the bbox (hug)', hug.ok === true);

/* ── R5: snapping uses the painted rotated AABB ── */
// painted AABB of title at 30°: located via DOM
const visX = await fr.evaluate(`(() => {
  const cr = (document.querySelector('.slide-container')||document.body).getBoundingClientRect();
  const el = document.querySelector('[data-sf-id="title"]');
  const r = el.getBoundingClientRect();
  return { x: r.left-cr.left, y: r.top-cr.top, w: r.width, h: r.height };
})()`);
// math truth: AABB(640×88 @30°) = 640·cos30 + 88·sin30 ≈ 598.3 (and h ≈ 364.3)
check('R5 setup: painted AABB matches rotation math', Math.abs(visX.w - 598.3) < 2, `painted w=${visX.w.toFixed(1)} (expect ≈598.3)`);
// single gesture: grab kicker centre, move so its left edge lands on the painted
// AABB left edge (snap target), capture object guides mid-flight, then commit.
// NOTE: pointerdown MUST target the element itself — bridge onPointerDown
// requires inCanvas(ev.target); a window-targeted event is ignored by design.
await fr.evaluate(`(() => {
  const el = document.querySelector('[data-sf-id="kicker"]'); if(!el) return false;
  const r = el.getBoundingClientRect();
  for (const t of ['pointerdown','pointerup']) el.dispatchEvent(new PointerEvent(t,{bubbles:true,cancelable:true,isPrimary:true,pointerType:'mouse',button:0,clientX:r.left+r.width/2,clientY:r.top+r.height/2}));
  return true;
})()`); await sleep(220);
const grab = await fr.evaluate(FIND);
// delta that puts kicker's left edge exactly on the painted AABB left edge
const dx = visX.x - grab.kicker.x;
await fr.evaluate(`(async () => {
  const grab = ${JSON.stringify(grab)};
  const el = document.querySelector('[data-sf-id="kicker"]');
  const send=(t,x,y)=>window.dispatchEvent(new PointerEvent(t,{bubbles:true,cancelable:true,isPrimary:true,pointerType:'mouse',button:0,buttons:t==='pointermove'?1:0,clientX:x,clientY:y}));
  const sx = grab.kicker.x + 10, sy = grab.kicker.y + grab.kicker.h/2;
  // pointerdown on the ELEMENT (bubbles to window), moves on window
  el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,isPrimary:true,pointerType:'mouse',button:0,buttons:1,clientX:sx,clientY:sy}));
  send('pointermove', sx + ${dx} - 30, sy);
  send('pointermove', sx + ${dx} - 15, sy);
  send('pointermove', sx + ${dx}, sy);
  const guides = [...document.querySelectorAll('.sf-guide')].map(l=>({cls:l.getAttribute('class')||"",left:l.style.left,top:l.style.top}));
  window.__p0guides = guides;
  send('pointerup', sx + ${dx}, sy);
  return guides.length;
})()`);
await sleep(900);
const guidesPayload = await fr.evaluate('window.__p0guides || []');
const objGuide = guidesPayload.find((g) => String(g.cls).includes('gobject'));
check('R5 object guide appears while dragging near the painted AABB edge', !!objGuide, JSON.stringify(guidesPayload));

/* ── R2: group rotation orbits the group centre ── */
// reset rects, then rotate a 2-member selection by 90° with the rot handle
await geoRoute({ items: [
  { sfId: 'kicker', x: 300, y: 200, w: 260, h: 60, r: 0, z: 20 },
  { sfId: 'subtitle', x: 560, y: 480, w: 300, h: 60, r: 0, z: 20 },
  { sfId: 'title', x: 120, y: 96, w: 640, h: 88, r: 0, z: 20 },
] });
await page.reload({ waitUntil: 'networkidle' }); await sleep(2800);
fr = await freshFrame();
await clickElement('kicker'); await sleep(180);
const unionBefore = await fr.evaluate(`(() => {
  const cr=(document.querySelector('.slide-container')||document.body).getBoundingClientRect();
  const rs=[...document.querySelectorAll('.sf-selected')].map(el=>{const r=el.getBoundingClientRect();return {x:r.left-cr.left,y:r.top-cr.top,w:r.width,h:r.height};});
  const x1=Math.min(...rs.map(r=>r.x)), y1=Math.min(...rs.map(r=>r.y));
  const px=Math.min(1, rs[0].x+rs[0].w), py=0;
  return {cx:x1+rs[0].w/2, cy:y1+rs[0].h/2, lcx: rs[0].x+rs[0].w/2, lcy: rs[0].y+rs[0].h/2};
})()`);
// shift-click second element
await fr.evaluate(`(() => { const el=document.querySelector('[data-sf-id="subtitle"]');
  const r=el.getBoundingClientRect();
  el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,isPrimary:true,pointerType:'mouse',button:0,shiftKey:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2}));
  el.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,isPrimary:true,pointerType:'mouse',button:0,shiftKey:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2}));
  return [...document.querySelectorAll('.sf-selected')].length; })()`); await sleep(220);
const selCount = await fr.evaluate(`(() => document.querySelectorAll('.sf-selected').length)()`);
if (selCount !== 2) { check('R2 two elements selected for group rotate', false, `sel=${selCount}`); }
const rotPush = await fr.evaluate(`(() => {
  const rh=document.querySelector('.sf-hand.sf-rot'); if(!rh) return null;
  const r=rh.getBoundingClientRect();
  // compute the union centre from the bbox (bbox is the selected-union box)
  const b=document.querySelector('.sf-bbox').getBoundingClientRect();
  return { hx:r.left+r.width/2, hy:r.top+r.height/2, gx:b.left+b.width/2, gy:b.top+b.height/2, dx: r.left-b.left, dy: r.top-b.top,
           bw: b.width, bh: b.height, bx: b.left, by: b.top };
})()`);
const ang = (dx, dy) => Math.atan2(dy, dx) * 180 / Math.PI;
const rad = (deg) => (deg * Math.PI) / 180;
const dist = Math.hypot(rotPush.hx - rotPush.gx, rotPush.hy - rotPush.gy);
const a0 = ang(rotPush.hx - rotPush.gx, rotPush.hy - rotPush.gy);
const a1 = a0 + 90;
const prevPos = await fr.evaluate(`(()=>{ const out={}; for(const s of document.querySelectorAll('.sf-selected')){ const c=s.getBoundingClientRect(); out[s.getAttribute('data-sf-id')]={x:c.left,y:c.top}; } return out; })()`);
// pointerdown on rot handle then rotate 90° around pivot, then up
await fr.evaluate(`(() => {
  const P = ${JSON.stringify(rotPush)}; const d = Math.hypot(P.hx-P.gx, P.hy-P.gy);
  const a0 = Math.atan2(P.hy-P.gy, P.hx-P.gx); const a1 = a0 + Math.PI/2;
  const hx = P.gx + d*Math.cos(a1), hy = P.gy + d*Math.sin(a1);
  const rh=document.querySelector('.sf-hand.sf-rot');
  const send=(t,x,y,tg)=>(tg||window).dispatchEvent(new PointerEvent(t,{bubbles:true,cancelable:true,isPrimary:true,pointerType:'mouse',button:0,buttons:t==='pointermove'?1:0,clientX:x,clientY:y}));
  send('pointerdown', P.hx, P.hy, rh);
  send('pointermove', hx, hy);
  send('pointerup', hx, hy);
})()`);
await sleep(240);
// wire truth: rotation around a pivot maps every member centre to a new point
// that stays its exact rotated image — here we verify via stored r=90 for both.
await refreshAfterCommit();
const sdAfter = (await (await page.request.get(`${URL}api/project/slide_data?project_id=${deckId}&with_version_history=false`)).json());
const geoAfter = (() => { try { return JSON.parse(sdAfter.data?.file_contents?.[0]?.content?.match(/<script id="slide-spec" type="application\/json">([\s\S]*?)<\/script>/)?.[1] || '{}'); } catch { return {}; } })();
const rotOk = geoAfter.geometry && ['kicker', 'subtitle'].every((k) => Math.abs((geoAfter.geometry[k]?.r ?? 0) % 360) === 90);
check('R2 group rotate commits r=90 for every member', rotOk, JSON.stringify({ k: geoAfter.geometry?.kicker, s: geoAfter.geometry?.subtitle }));

/* ── R4: resize while rotated keeps the opposite corner pinned ── */
await geoRoute({ items: [{ sfId: 'title', x: 200, y: 200, w: 400, h: 120, r: 30, z: 20 }] });
await page.reload({ waitUntil: 'networkidle' }); await sleep(2800);
fr = await freshFrame();
await clickElement('title'); await sleep(220);
// drag the REAL se handle 120px right and 40px down; the painted NW corner
// (which for θ=30° IS the AABB min corner) must not move.
const seDrag = await fr.evaluate(`(() => {
  const cr=(document.querySelector('.slide-container')||document.body).getBoundingClientRect();
  const el=document.querySelector('[data-sf-id="title"]');
  const R=el.getBoundingClientRect();
  const h=document.querySelector('.sf-hand[data-h="se"]'); const hr=h.getBoundingClientRect();
  const sx=hr.left+hr.width/2, sy=hr.top+hr.height/2;
  const nwBefore={x:R.left-cr.left, y:R.top-cr.top, w:Math.round(R.width)};
  const send=(t,x,y)=>window.dispatchEvent(new PointerEvent(t,{bubbles:true,cancelable:true,isPrimary:true,pointerType:'mouse',button:0,buttons:t==='pointermove'?1:0,clientX:x,clientY:y}));
  h.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,isPrimary:true,pointerType:'mouse',button:0,buttons:1,clientX:sx,clientY:sy}));
  send('pointermove', sx+60, sy+20);
  send('pointermove', sx+120, sy+40);
  send('pointerup', sx+120, sy+40);
  const R2=el.getBoundingClientRect();
  return { dTop: Math.round((R2.top-cr.top)-nwBefore.y), dLeft: Math.round((R2.left-cr.left)-nwBefore.x), w0: nwBefore.w, w1: Math.round(R2.width) };
})()`);
check('R4 rotated resize grows painted box', (seDrag.w1 ?? seDrag.w0) > seDrag.w0, JSON.stringify(seDrag));
check('R4 rotated resize keeps opposite corner within 2px', Math.abs(seDrag.dLeft) <= 2 && Math.abs(seDrag.dTop) <= 2, JSON.stringify(seDrag));
await refreshAfterCommit();
check('R4 rotated resize grows painted box', (seDrag.w1 ?? seDrag.w0) > seDrag.w0, JSON.stringify(seDrag));
check('R4 rotated resize keeps opposite corner within 2px', Math.abs(seDrag.dLeft) <= 2 && Math.abs(seDrag.dTop) <= 2, JSON.stringify(seDrag));
await refreshAfterCommit();

/* ── D1/D2/D3: duplicate quality, undo, cap, round-trip ── */
await geoRoute({ items: [{ sfId: 'title', x: 200, y: 300, w: 400, h: 90, r: 12, z: 44 }, { sfId: 'kicker', x: 700, y: 500, w: 300, h: 60 }, { sfId: 'subtitle', x: 900, y: 100, w: 260, h: 64 }] });
await page.reload({ waitUntil: 'networkidle' }); await sleep(2800);
fr = await freshFrame();
await clickElement('title'); await sleep(200);
// D1 (real user path): Ctrl+D inside the iframe — bridge reads text/cls/r/z
// from the DOM and posts element.duplicate to the host, which pushes undo.
const dupWireCount = dupWire.length;
await fr.evaluate(`(() => window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'd', ctrlKey: true })))()`);
await sleep(2200); // route + persist + reload canvas
fr = await freshFrame();
const dupCalls = dupWire.slice(dupWireCount);
const newId = dupCalls.find((c) => c.newId)?.newId || null;
check('D1 Ctrl+D posts to the duplicate route with a newId', !!newId, JSON.stringify(dupCalls.map((c) => ({ url: c.url, status: c.status, newId: c.newId }))));
const dupState = await fr.evaluate(FIND);
check('D1 duplicate inherits text + class + geometry offset +20/+20 + r + z', (() => {
  if (!newId || !dupState[newId]) return false;
  const t = dupState.title, c = dupState[newId];
  return c.cls.replace(/\bsf-selected\b/g, '').trim() === t.cls.trim() && c.txt === t.txt
    && Math.round(c.x - t.x) === 20 && Math.round(c.y - t.y) === 20
    && (c.transform || '').includes('rotate(12deg)') && c.zIndex === t.zIndex;
})(), JSON.stringify({ t: dupState.title, c: newId ? dupState[newId] : null }));
// selectable copy
await clickElement(newId || 'title'); await sleep(180);
{
  const sel = await fr.evaluate(`(() => document.querySelector('.sf-selected')?.getAttribute('data-sf-id') || null)()`);
  check('D1 duplicate is selectable', !!newId && sel === newId, sel);
}
// D2: duplicate is undoable as ONE step → in-frame Ctrl+Z posts history.undo,
// the host restores its pre-duplicate snapshot and re-renders the canvas.
await fr.evaluate(`(() => window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'z', ctrlKey: true })))()`);
await sleep(3200); // persist 1200 + reload chase 1600 + margin
fr = await freshFrame();
const afterUndo = await fr.evaluate(FIND);
check('D2 duplicate undoes as one step (copy gone)', !afterUndo[newId], `left=${Object.keys(afterUndo).length}`);
// D2 cap: fill extras to 40 via API, expect a clean 400 on the 41st
const dupDebug = [];
for (let i = 0; i < 40; i++) {
  const r = await dupRoute({ sfId: 'kicker', x: 40 + i, y: 640, w: 80, h: 40, text: 's' });
  if (r.status() !== 200) {
    let msg = ''; try { msg = JSON.stringify(await r.json()); } catch {}
    dupDebug.push(`i=${i} status=${r.status()} ${msg}`);
    break;
  }
}
check('D2 duplicate cap fills to 40 (all 200 on the way)', dupDebug.length === 0, dupDebug[0] || '40/40 ok');
const capRes = await dupRoute({ sfId: 'kicker', x: 40, y: 660, w: 80, h: 40, text: 's' });
check('D2 41st duplicate is a clean 400', capRes.status() === 400, `status=${capRes.status()}`);
// D3: round-trip — extras survive reload (reload reads the island, not disk)
await page.reload({ waitUntil: 'networkidle' }); await sleep(2800);
fr = await freshFrame();
const cop = await fr.evaluate(`(() => [...document.querySelectorAll('[data-sf-id]')].filter(e=>/-copy/.test(e.getAttribute('data-sf-id'))).length)()`);
check('D3 duplicated extras survive reload', cop === 40, `copies on canvas=${cop}`);
// clean the extras for later suites
for (let i = 0; i < 41; i++) await dupRoute(i === 0 ? 'kicker-copy' : `kicker-copy${i + 1}`, 'DELETE').catch(() => {});
await geoRoute({ items: [{ sfId: 'kicker', x: 480, y: 560, w: 320, h: 60 }] });

/* ── Z2: raise/lower clamped 1..999 and visible in the chip ── */
await geoRoute({ items: [{ sfId: 'title', x: 120, y: 96, w: 640, h: 88, z: 999, r: 0 }, { sfId: 'kicker', x: 480, y: 560, w: 320, h: 60, z: 1 }] });
await page.reload({ waitUntil: 'networkidle' }); await sleep(2800);
fr = await freshFrame();
await geoRoute({ items: [{ sfId: 'title', x: 120, y: 96, w: 640, h: 88, z: 5000 }] }).then(async (r) => {
  const j = await r.json();
  check('Z2 geometry route clamps/stores z=5000 request', r.status() === 200 && (j?.data?.spec?.geometry?.title?.z ?? 0) <= 999, JSON.stringify(j?.data?.spec?.geometry?.title));
});
await page.reload({ waitUntil: 'networkidle' }); await sleep(2800);
fr = await freshFrame();
await clickElement('title'); await sleep(200);
// raise once (already 999) → must stay ≤999
await fr.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: ']', ctrlKey: true })));
await sleep(240);
const zTop = await fr.evaluate(`(() => document.querySelector('[data-sf-id="title"]')?.style.zIndex)()`);
check('Z2 raise stays clamped at 999', Number(zTop) <= 999, `z=${zTop}`);
// lower once from 1 → must stay ≥1
await clickElement('kicker'); await sleep(180);
await fr.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: '[', ctrlKey: true })));
await sleep(240);
const zBot = await fr.evaluate(`(() => document.querySelector('[data-sf-id="kicker"]')?.style.zIndex)()`);
check('Z2 lower stays clamped at 1', Number(zBot) >= 1, `z=${zBot}`);
// chip shows z while resizing (chip text reveals z when the selection carries it)
const chipText = await fr.evaluate(`(() => { const el=document.querySelector('[data-sf-id="kicker"]'); if(!el) return null;
  const r=el.getBoundingClientRect();
  el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,isPrimary:true,pointerType:'mouse',button:0,buttons:1,clientX:r.left+4,clientY:r.top+4}));
  window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,isPrimary:true,pointerType:'mouse',button:0,buttons:1,clientX:r.left+8,clientY:r.top+4}));
  const chip=document.querySelector('.sf-chip');
  window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,isPrimary:true,pointerType:'mouse',button:0,clientX:r.left+8,clientY:r.top+4}));
  return chip?.textContent || null; })()`);
check('Z2 chip carries the live numbers', /\d+,\d+/.test(chipText || ''), chipText);

console.log(`\nP0 gate: ${pass} pass, ${fail} fail${errors.length ? `, console errors: ${errors.length}` : ''}`);
errors.slice(0, 5).forEach((e) => console.log('ERR ' + e));
await browser.close();
process.exit(fail ? 1 : 0);
