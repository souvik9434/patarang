/**
 * shoot-canvas.mjs — M-CANVAS pointer E2E (docs/07 gates).
 *
 * Strata:
 *   1. REAL mouse click-select (C1) for chrome + real input plumbing.
 *   2. SYNTHETIC drag/marquee/align/nudge (handler path identical; real
 *      input plumbing already proven by step 1).
 *   Assertions use the WIRE (chip ↔ geometry POST ↔ stored slide_data) so
 *   no DOM-identity races. Requires mock-forced server on 4173.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = 'D:/SlideForge/proof';
mkdirSync(OUT, { recursive: true });
const URL = process.env.URL || 'http://127.0.0.1:4173/';
const CANVAS_CX = 640;

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1600, height: 950 } })).newPage();
const errors = [];
const geoWire = [];
const dupWire = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('response', (r) => {
  if (r.url().includes('/duplicate') && r.request().method() === 'POST') {
    const entry = { url: r.url(), status: r.status(), newId: null };
    dupWire.push(entry);
    r.json().then((b) => { entry.newId = b?.data?.newId || null; }).catch(() => {});
  }
  if (!r.url().includes('/geometry') || r.request().method() !== 'POST') return;
  let items = [];
  try { const b = JSON.parse(r.request().postData() || '{}'); items = Array.isArray(b.items) ? b.items : [b]; } catch {}
  geoWire.push({ url: r.url().split('/api/')[1], items, status: r.status() });
});

const deckList = await (await fetch(`${URL}api/decks`)).json().catch(() => null);
const pick = (deckList?.data?.decks || []).slice().sort((a, b) => b.page_num - a.page_num)[0];
const OPEN = pick ? `${URL}${URL.includes('?') ? '&' : '?'}deck=${pick.project_id}` : URL;
await page.goto(OPEN, { waitUntil: 'networkidle' });
await page.waitForTimeout(2600);
const frame0 = page.frames().find((f) => f.url().includes('/canvas/'));
if (!frame0) { console.log('FAIL: canvas frame not found'); await browser.close(); process.exit(1); }

const findRects = `(() => { const cr=(document.querySelector('.slide-container')||document.body).getBoundingClientRect(); return [...document.querySelectorAll('[data-sf-id]')].map((el)=>{const r=el.getBoundingClientRect();return {id:el.getAttribute('data-sf-id'),x:r.left-cr.left,y:r.top-cr.top,w:r.width,h:r.height,cx:r.left-cr.left+r.width/2,cy:r.top-cr.top+r.height/2};}); })()`;

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

const r0 = Number((frame0.url().match(/[?&]r=(\d+)/) || [])[1] || 0);
let rMin = r0;
const freshFrame = async (tries = 20) => {
  for (let i = 0; i < tries; i++) {
    const fr = page.frames().find((f) => { const m = f.url().match(/[?&]r=(\d+)/); return f.url().includes('/canvas/') && m && Number(m[1]) > rMin; });
    if (fr) {
      try { const n = await fr.evaluate(findRects); if (n.length) { rMin = Number((fr.url().match(/[?&]r=(\d+)/) || [])[1] || rMin); return fr; } } catch {}
    }
    await page.waitForTimeout(250);
  }
  return null;
};

const rectIds = (await frame0.evaluate(findRects)).map((r) => r.id);
if (!rectIds.length) { console.log('FAIL: no selectable elements'); await browser.close(); process.exit(1); }

const deckId = (frame0.url().match(/canvas\/([\w-]+)\//) || [])[1];
const pageId = (frame0.url().match(/\/([\w-]+)\.html/) || [])[1];
// Deterministic fixture: remove duplicated extras left by earlier runs.
const canvasHtml = await (await fetch(`${URL}canvas/${deckId}/${pageId}.html`)).text();
const staleCopies = [...new Set([...canvasHtml.matchAll(/data-sf-id="([\w-]+-copy\d*)"/g)].map((m) => m[1]))];
for (const cid of staleCopies) {
  await page.request.delete(`${URL}api/decks/${deckId}/slides/${pageId}/extras/${cid}`).catch(() => {});
}
if (staleCopies.length) console.log(`fixture: removed ${staleCopies.length} stale copies`);
// x/y are OFFSETS from each element's natural flow slot (offset model) —
// reset to 0,0 so every element stays inside the 1280×720 .slide-container!
const items = rectIds.map((id) => ({ sfId: id, slot: id, x: 0, y: 0, w: 220, h: 42 }));
const prep = await page.request.post(`${URL}api/decks/${deckId}/slides/${pageId}/geometry`, { data: { items }, headers: { 'Content-Type': 'application/json' } });
if (prep.status() !== 200) { console.log(`FAIL: fixture prep refused (${prep.status()})`); await browser.close(); process.exit(1); }
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(2800);
let frame = page.frames().find((f) => f.url().includes('/canvas/'));
if (!frame) { console.log('FAIL: canvas frame gone after reload'); await browser.close(); process.exit(1); }

const box = await frame.locator('.slide-container').boundingBox();
const toPage = (x, y) => ({ x: box.x + x * (box.width / 1280), y: box.y + y * (box.height / 720) });
const rects0 = await frame.evaluate(findRects);
if (!rects0.length) { console.log('FAIL: canvas empty after fixture'); await browser.close(); process.exit(1); }
const t = rects0.find((r) => Math.abs(r.cx - 640) >= 24 && r.x >= 0 && r.y >= 0 && r.x + r.w <= 1280 && r.y + r.h <= 720) || rects0[0];
if (Math.abs(t.cx - 640) < 24) { console.log('FAIL: fixture overlap with centre'); await browser.close(); process.exit(1); }
const tStart = { ...t };

/* ── 1) REAL click-select (C1) ── */
const start = toPage(t.cx, t.cy);
await page.mouse.click(start.x, start.y);
await page.waitForTimeout(260);
const handles = await frame.locator('.sf-hand').count();
const bboxVisible = await frame.locator('.sf-bbox').isVisible();
const alignVisible = await frame.locator('.sf-alignbar').isVisible();
check('C1 click-select shows bbox + 8 handles + align bar', handles === 9 && bboxVisible && alignVisible, `handles=${handles} h=${await frame.evaluate(() => [...document.querySelectorAll('[data-h]')].map((e) => e.dataset.h).join(','))}`);

/* ── 2) SYNTHETIC drag with magnet (C2/C5) ── */
const grabPt = { x: Math.min(t.x + t.w * 0.25, t.x + t.w - 4), y: t.y + t.h * 0.8 };
const dragDx = (CANVAS_CX - t.cx) * (1 - 4 / Math.max(Math.abs(CANVAS_CX - t.cx), 8));
const wireCountBeforeDrag = geoWire.length;
const dragResult = await frame.evaluate(`(async () => {
  const cr = (document.querySelector('.slide-container')||document.body).getBoundingClientRect();
  const host = document.querySelector('.slide-container') || document.body;
  const el = document.elementFromPoint(cr.left + ${grabPt.x}, cr.top + ${grabPt.y});
  const hit = el && el.closest('[data-sf-id]');
  if (!hit) return { ok: false, reason: 'no hit at grab point' };
  const r = hit.getBoundingClientRect();
  const gx = r.left + r.width * 0.25;
  const gy = r.top + r.height * 0.8;
  const send = (type, x, y, target) => (target || host).dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, isPrimary: true, pointerType: 'mouse',
    button: 0, buttons: type === 'pointermove' ? 1 : 0, clientX: x, clientY: y,
  }));
  send('pointerdown', gx, gy, hit);
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    send('pointermove', gx + (${dragDx} / steps) * i, gy);
  }
  await new Promise((res) => setTimeout(res, 60));
  const chip = document.querySelector('.sf-chip');
  const guides = document.querySelectorAll('.sf-guide').length;
  const chipTxt = chip ? chip.textContent : '';
  send('pointerup', gx + ${dragDx}, gy);
  return { ok: true, guides, chipTxt, hitId: hit.getAttribute('data-sf-id') };
})()`);
const guidesDuring = dragResult?.guides ?? 0;
const chipTxt = dragResult?.chipTxt ?? '';
await page.waitForTimeout(120);
await page.waitForResponse((r) => r.url().includes('/geometry') && r.request().method() === 'POST', { timeout: 5000 }).catch(() => null);
await page.screenshot({ path: `${OUT}/canvas-snap-guides.png` });
const wireCountAtDrop = geoWire.length;
check('C2 magnet shows snap guide lines during drag', guidesDuring >= 1,
  `guides=${guidesDuring}, chip="${chipTxt}", hit=${dragResult?.hitId || 'none'}, reason=${dragResult?.reason || '-'}`);

const fr2 = await freshFrame();
if (!fr2) check('C2/C5 post-drop canvas reload', false, 'freshFrame timed out (no commit seen)');
const drop = fr2 ? geoWire.slice(wireCountBeforeDrag).find((g) => g.items?.length && g.status === 200) : null;
const chipMatch = chipTxt.match(/^(-?\d+),(-?\d+) · (\d+)×(\d+)/);
const chipRect = chipMatch && { x: Number(chipMatch[1]), y: Number(chipMatch[2]), w: Number(chipMatch[3]), h: Number(chipMatch[4]) };
const it = drop?.items[0];
const chipAgrees = !!(chipRect && it && (it.atX ?? it.x) === chipRect.x && (it.atY ?? it.y) === chipRect.y && Math.round(it.w) === chipRect.w && Math.round(it.h) === chipRect.h);
let storedAgrees = false;
if (it && drop) {
  const dId = (drop.url.match(/decks\/([\w-]+)\//) || [])[1];
  const pId = (drop.url.match(/slides\/([\w-]+)\//) || [])[1];
  try {
    const sd = await (await fetch(`${URL}api/project/slide_data?project_id=${dId}&deck=${pId}`)).json();
    const fc = (sd.data?.file_contents || []).find((f) => f.page_id === pId);
    const c = fc?.content || '';
    const idx = c.indexOf(`data-sf-id="${it.sfId}"`);
    const seg = idx >= 0 ? c.slice(Math.max(0, idx - 320), idx + 220) : '';
    storedAgrees = !!seg && seg.includes(`left:${it.x}px`) && seg.includes(`top:${it.y}px`);
  } catch { storedAgrees = false; }
}
check('C5 drop commit: bridge chip == wire POST == stored slide_data render', chipAgrees && storedAgrees && !!fr2,
  `wire=${it ? `${it.sfId} ${it.x},${it.y},${it.w}x${it.h}` : 'NONE'} chipAgrees=${chipAgrees} storedAgrees=${storedAgrees}`);

/* ── 3) SYNTHETIC marquee + align (C1/C4) ── */
const selIds = fr2 ? await fr2.evaluate(`(() => { const host = document.querySelector('.slide-container') || document.body; const send = (type, x, y) => host.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, isPrimary: true, pointerType: 'mouse', button: 0, buttons: type === 'pointermove' ? 1 : 0, clientX: x, clientY: y })); send('pointerdown', 30, 30); send('pointermove', 1180, 640); send('pointerup', 1180, 640); return [...document.querySelectorAll('.sf-selected')].map((el) => el.getAttribute('data-sf-id')); })()`) : [];
check('C1 synthetic marquee band-selects the canvas', selIds.length >= 2, `selected=${selIds.length} ids=${selIds.slice(0, 4).join(',')}`);
if (fr2) await page.screenshot({ path: `${OUT}/canvas-marquee.png` });

/* ── 4) align-left via the floating bar (C4) ── */
let fr3 = fr2;
if (selIds.length >= 2 && fr2) {
  await fr2.locator('.sf-alignbar button[data-mode="left"]').first().click({ force: true });
  await page.waitForTimeout(600);
  fr3 = await freshFrame();
  const afterA = fr3 ? await fr3.evaluate(findRects) : [];
  const xs = afterA.filter((r) => selIds.includes(r.id));
  const sameX = xs.length >= 2 && xs.every((r) => Math.abs(r.x - xs[0].x) <= 3);
  check('C4 align-left from the floating bar', sameX, `x=${xs.map((r) => Math.round(r.x)).join(',')}`);
}
if (!fr3) { console.log('NOTE: post-align frame not re-acquired — skipping dependent steps'); }

/* ── 5) SYNTHETIC keyboard nudge (C4) ── */
let fr4 = null;
if (fr3) {
  const nudgeEl = await fr3.evaluate(`(() => { const host = document.querySelector('.slide-container') || document.body; const el = host.querySelector('[data-sf-id]'); if (el) { const r = el.getBoundingClientRect(); for (const type of ['pointerdown', 'pointerup']) { el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, isPrimary: true, pointerType: 'mouse', button: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 })); } return el.getAttribute('data-sf-id'); } return null; })()`);
  const before = fr3 ? await fr3.evaluate(findRects) : [];
  await fr3.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowRight' }))`);
  await fr3.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowRight' }))`);
  await fr3.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, shiftKey: true, key: 'ArrowDown' }))`);
  await page.waitForTimeout(2600);
  fr4 = await freshFrame();
  const afterAll = fr4 ? await fr4.evaluate(findRects) : [];
  const b0 = before.find((q) => q.id === nudgeEl);
  const a0 = afterAll.find((q) => q.id === nudgeEl);
  const nudged = !!b0 && !!a0 && Math.abs(a0.x - b0.x - 2) <= 1.5 && Math.abs(a0.y - b0.y - 10) <= 1.5;
  check('C4 keyboard nudge (2×1px right, Shift+10px down) persisted', nudged,
    `el=${nudgeEl || '—'} delta=${b0 && a0 ? `${(a0.x - b0.x).toFixed(1)},${(a0.y - b0.y).toFixed(1)}` : '—'}`);
}

/* ── 6) SYNTHETIC Escape clears selection (C1) ── */
const fr5 = fr4 || fr3 || fr2;
if (fr5) {
  const escRects = await fr5.evaluate(findRects);
  const focusPt = toPage(escRects[0].cx, escRects[0].cy);
  await page.mouse.click(focusPt.x, focusPt.y);
  await page.waitForTimeout(200);
  await fr5.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' }))`);
  await page.waitForTimeout(200);
  const stillSel = await fr5.evaluate(() => document.querySelectorAll('.sf-selected').length);
  check('C1 Escape deselects', stillSel === 0);
}

/* ── 7) rotation (C6): wire angle + persisted transform ── */
const geoAtRot = geoWire.length;
let fr6 = fr5;
let rotId = null;
let rotPost = null;
let rotStored = '';
if (fr6) {
  const rr = await fr6.evaluate(findRects);
  rotId = (rr[2] || rr[0])?.id || null;
  if (rotId) {
    await fr6.evaluate(`(() => { const el=document.querySelector('[data-sf-id="${rotId}"]'); if(!el) return false; const r=el.getBoundingClientRect(); for (const t of ['pointerdown','pointerup']) el.dispatchEvent(new PointerEvent(t,{bubbles:true,cancelable:true,isPrimary:true,pointerType:'mouse',button:0,clientX:r.left+r.width/2,clientY:r.top+r.height/2})); return true; })()`);
    await page.waitForTimeout(180);
    await fr6.evaluate(`(() => {
      const el = document.querySelector('[data-sf-id="${rotId}"]');
      const rh = document.querySelector('.sf-hand.sf-rot');
      if (!el || !rh) return { ok:false };
      const er = el.getBoundingClientRect(), rr2 = rh.getBoundingClientRect();
      const C = { x: er.left + er.width/2, y: er.top + er.height/2 };
      const H = { x: rr2.left + rr2.width/2, y: rr2.top + rr2.height/2 };
      const a0 = Math.atan2(H.y-C.y, H.x-C.x), rad = Math.hypot(H.x-C.x, H.y-C.y), a1 = a0 + Math.PI/6;
      const P1 = { x: C.x + Math.cos(a1)*rad, y: C.y + Math.sin(a1)*rad };
      const send=(t,x,y,tg)=>(tg||window).dispatchEvent(new PointerEvent(t,{bubbles:true,cancelable:true,isPrimary:true,pointerType:'mouse',button:0,buttons:t==='pointermove'?1:0,clientX:x,clientY:y}));
      send('pointerdown', H.x, H.y, rh);
      for (let i=1;i<=6;i++) send('pointermove', H.x+(P1.x-H.x)*i/6, H.y+(P1.y-H.y)*i/6);
      send('pointerup', P1.x, P1.y);
      return { ok:true };
    })()`);
    for (let i = 0; i < 20 && !rotPost; i++) {
      await page.waitForTimeout(150);
      rotPost = geoWire.slice(geoAtRot).flatMap((g) => g.items || []).find((x) => x.sfId === rotId && typeof x.r === 'number' && x.r !== 0);
    }
  }
}
check('C6 rotation commits an angle within ±3° of the 30° drag', !!rotPost && Math.abs(rotPost.r - 30) <= 3,
  rotId ? `id=${rotId} r=${rotPost?.r ?? 'none'}` : 'no element');
fr6 = await freshFrame();
if (fr6 && rotId) rotStored = await fr6.evaluate(`(() => { const el=document.querySelector('[data-sf-id="${rotId}"]'); return el ? (el.style.transform||'') : ''; })()`).catch(() => '');
check('C6 rotation persists after canvas reload (inline rotate)', /rotate\(\s*-?\d+deg\s*\)/.test(rotStored), rotStored || 'none');

/* ── 8) z-order raise/lower (Ctrl+] / Ctrl+[) ── */
const geoAtZ = geoWire.length;
let zUp = null, zDown = null;
const selectOn = async (fr, id) => fr.evaluate(`(() => { const el=document.querySelector('[data-sf-id="${id}"]'); if(!el) return false; const r=el.getBoundingClientRect(); for (const t of ['pointerdown','pointerup']) el.dispatchEvent(new PointerEvent(t,{bubbles:true,cancelable:true,isPrimary:true,pointerType:'mouse',button:0,clientX:r.left+r.width/2,clientY:r.top+r.height/2})); return el.classList.contains('sf-selected'); })()`);
if (fr6 && rotId) {
  await selectOn(fr6, rotId);
  await page.waitForTimeout(150);
  await fr6.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:']',ctrlKey:true}))`);
  for (let i = 0; i < 16 && !zUp; i++) {
    await page.waitForTimeout(150);
    zUp = geoWire.slice(geoAtZ).flatMap((g) => g.items || []).find((x) => x.sfId === rotId && typeof x.z === 'number');
  }
  const frZ = await freshFrame();
  if (frZ && rotId) {
    await selectOn(frZ, rotId);
    await page.waitForTimeout(150);
    await frZ.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'[',ctrlKey:true}))`);
    for (let i = 0; i < 16 && !zDown; i++) {
      await page.waitForTimeout(150);
      zDown = geoWire.slice(geoAtZ).flatMap((g) => g.items || []).filter((x) => x.sfId === rotId && typeof x.z === 'number').pop();
    }
  }
}
check('C8 Ctrl+] raises z and Ctrl+[ lowers it (wire)', !!zUp && !!zDown && zUp.z >= 21 && zDown.z < zUp.z,
  `up=${zUp?.z ?? 'none'} down=${zDown?.z ?? 'none'}`);

/* ── 9) duplicate (Ctrl+D): route + persisted copy ── */
const dupBase = dupWire.length;
let dupHit = null;
const fr7 = await freshFrame();
if (fr7 && rotId) {
  await fr7.evaluate(`(() => { const el=document.querySelector('[data-sf-id="${rotId}"]'); const r=el.getBoundingClientRect(); for (const t of ['pointerdown','pointerup']) el.dispatchEvent(new PointerEvent(t,{bubbles:true,cancelable:true,isPrimary:true,pointerType:'mouse',button:0,clientX:r.left+r.width/2,clientY:r.top+r.height/2})); return true; })()`);
  await page.waitForTimeout(150);
  await fr7.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'d',ctrlKey:true}))`);
  for (let i = 0; i < 24 && !dupHit; i++) {
    await page.waitForTimeout(150);
    dupHit = dupWire.slice(dupBase)[0] || null;
  }
}
const fr8 = await freshFrame(30);
let copyMeta = null;
if (fr8 && dupHit?.newId) {
  const copyId = dupHit.newId;
  for (let i = 0; i < 12 && !copyMeta; i++) {
    copyMeta = await fr8.evaluate(`(() => {
      const src = document.querySelector('[data-sf-id="${rotId}"]');
      const cp = document.querySelector('[data-sf-id="${copyId}"]');
      if (!src || !cp) return null;
      const a = src.getBoundingClientRect(), b = cp.getBoundingClientRect();
      return { id: cp.getAttribute('data-sf-id'), dx: b.left - a.left, dy: b.top - a.top, dw: b.width - a.width, dh: b.height - a.height, selected: cp.classList.contains('sf-selected') };
    })()`).catch(() => null);
    if (copyMeta && copyMeta.selected) break;
    await page.waitForTimeout(250);
  }
}
check('C9 Ctrl+D creates a persisted copy via the duplicate route', !!dupHit && dupHit.status === 200 && !!dupHit.newId && !!copyMeta,
  `route=${dupHit?.status ?? 'none'} newId=${dupHit?.newId ?? 'none'}`);
check('C9 copy keeps size, offsets +20/+20 and is auto-selected', !!copyMeta && Math.abs(copyMeta.dx - 20) <= 2 && Math.abs(copyMeta.dy - 20) <= 2 && Math.abs(copyMeta.dw) <= 2 && Math.abs(copyMeta.dh) <= 2 && copyMeta.selected === true,
  copyMeta ? `dx=${copyMeta.dx.toFixed(1)} dy=${copyMeta.dy.toFixed(1)} dw=${copyMeta.dw.toFixed(1)} sel=${copyMeta.selected}` : 'none');

/* ── 10) delete the copy (Del) and prove it is gone ── */
const delBase = dupWire.length;
let delOk = false, delGone = false;
if (fr8 && dupHit?.newId) {
  const copyId = dupHit.newId;
  await fr8.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'Delete'}))`);
  for (let i = 0; i < 16 && !delOk; i++) {
    await page.waitForTimeout(200);
    const got = await page.request.get(`${URL}api/project/slide_data?project_id=${deckId}&deck=${pageId}`).then((r) => r.json()).catch(() => null);
    const html = got?.data?.file_contents?.find((f) => f.page_id === pageId)?.content || '';
    if (html && !html.includes(`data-sf-id="${copyId}"`)) delOk = true;
  }
  const fr9 = await freshFrame(20);
  delGone = fr9 ? await fr9.evaluate(`!document.querySelector('[data-sf-id="${copyId}"]')`).catch(() => false) : false;
}
check('C10 Delete removes the extra from stored slide_data and the live canvas', delOk && delGone, `wire=${delOk} live=${delGone}`);

await page.screenshot({ path: `${OUT}/canvas-after.png` });
console.log('geometry POSTs:', JSON.stringify(geoWire, null, 0).slice(0, 4000));
console.log('console errors:', errors.length ? errors.slice(0, 6) : 'none');
check('0 console errors', errors.length === 0);
console.log(`
CANVAS E2E: ${pass} pass / ${fail} fail`);
await browser.close();
if (fail > 0) process.exit(1);