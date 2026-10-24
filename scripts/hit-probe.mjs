import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1600, height: 950 } })).newPage();
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2400);
const fr = page.frames().find((f) => f.url().includes('/canvas/'));
if (!fr) { console.log('no frame'); await browser.close(); process.exit(1); }
const rects = await fr.evaluate(`(() => {
  const cr = (document.querySelector('.slide-container')||document.body).getBoundingClientRect();
  return [...document.querySelectorAll('[data-sf-id]')].map((el) => {
    const r = el.getBoundingClientRect();
    return { id: el.getAttribute('data-sf-id'), x: r.left - cr.left, y: r.top - cr.top, w: r.width, h: r.height };
  });
})()`);
const box = await fr.locator('.slide-container').boundingBox();
const t = rects[1] || rects[0];
const pt = { x: Math.round(box.x + t.x + t.w * 0.25), y: Math.round(box.y + t.y + t.h * 0.8) };
console.log('tile', t.id, 'page pt', pt);
// click-select first (like the E2E) then probe what element sits under the drag point
await page.mouse.click(Math.round(box.x + (t.x + t.w / 2)), Math.round(box.y + (t.y + t.h / 2)));
await page.waitForTimeout(300);
const under = await page.evaluate(`(() => {
  const els = [];
  for (let el = document.elementFromPoint(${pt.x}, ${pt.y}); el; el = el.parentElement) els.push(el.tagName + '.' + String(el.className).split(' ')[0]);
  return els.slice(0, 6);
})()`);
console.log('host chain at drag point:', under);
const frUnder = await fr.evaluate(`(() => {
  const cr = (document.querySelector('.slide-container')||document.body).getBoundingClientRect();
  const el = document.elementFromPoint(cr.left + ${t.x + t.w * 0.25}, cr.top + ${t.y + t.h * 0.8});
  if (!el) return null;
  return el.tagName + ' ' + String(el.className).split(' ')[0] + ' sfid=' + (el.closest('[data-sf-id]')?.getAttribute('data-sf-id') || 'none') + ' vis=' + getComputedStyle(el).visibility + ' pe=' + getComputedStyle(el).pointerEvents;
})()`);
console.log('iframe under drag point:', frUnder);
// now send a synthetic full drag AFTER selection to close the loop:
const sel1 = await fr.evaluate(`(() => {
  const cr = (document.querySelector('.slide-container')||document.body).getBoundingClientRect();
  const el = document.elementFromPoint(cr.left + ${t.x + t.w * 0.25}, cr.top + ${t.y + t.h * 0.8});
  const hit = el && el.closest('[data-sf-id]');
  return hit ? hit.getAttribute('data-sf-id') : null;
})()`);
console.log('would-grab id:', sel1);
// real pointer attempt
const counts = await fr.evaluate(`(() => {
  window.__c = { d: 0, m: 0, u: 0 };
  document.addEventListener('pointerdown', () => window.__c.d++, true);
  document.addEventListener('pointermove', () => window.__c.m++, true);
  document.addEventListener('pointerup', () => window.__c.u++, true);
  return 'ok';
})()`);
console.log('probe armed:', counts);
for (let i = 1; i <= 6; i++) await page.mouse.move(pt.x + i * 30, pt.y, { steps: 1 });
const c2 = await fr.evaluate(`window.__c`);
console.log('after 6 moves probe:', JSON.stringify(c2));
await browser.close();
