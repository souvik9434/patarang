import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1600, height: 950 } })).newPage();
const posts = [];
const hostLog = [];
page.on('console', (m) => { if (m.type() !== 'debug') hostLog.push(`${m.type()}: ${m.text().slice(0, 160)}`); });
page.on('pageerror', (e) => hostLog.push('pageerror: ' + e.message.slice(0, 160)));
page.on('response', (r) => { if (r.url().includes('/geometry') && r.request().method() === 'POST') posts.push(r.status()); });
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await page.evaluate(`
  window.__msgProbe = [];
  window.addEventListener('message', (e) => {
    const d = e.data || {};
    if (d.v === 1) window.__msgProbe.push(d.method + (d.params && d.params.items ? ':' + d.params.items.length : ''));
  });
`);
const fr = page.frames().find((f) => f.url().includes('/canvas/'));
if (!fr) { console.log('no frame'); process.exit(1); }
let seq = null;
try {
  seq = await fr.evaluate(`
  (async () => {
    const host = document.querySelector('.slide-container') || document.body;    const send = (type, x, y) => host.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, isPrimary: true, pointerType: 'mouse', button: 0, buttons: type === 'pointermove' ? 1 : 0, clientX: x, clientY: y }));
    send('pointerdown', 30, 30);
    send('pointermove', 1180, 640);
    send('pointerup', 1180, 640);
    await new Promise((r2) => setTimeout(r2, 250));
    const btn = document.querySelector('.sf-alignbar button[data-mode="left"]');
    const info = btn ? { found: true, pe: getComputedStyle(btn).pointerEvents, barPe: getComputedStyle(btn.parentElement).pointerEvents } : { found: false };
    const bar = document.querySelector('.sf-alignbar');
    if (bar) {
      window.__clickLog = [];
      bar.addEventListener('click', (e) => { window.__clickLog.push((e.target && e.target.dataset && e.target.dataset.mode) || 'no-mode'); });
    }
    if (btn) {
      const r = btn.getBoundingClientRect();
      for (const type of ['pointerdown', 'pointerup']) {
        btn.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, isPrimary: true, pointerType: 'mouse', button: 0, clientX: r.left + 4, clientY: r.top + 4 }));
      }
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, clientX: r.left + 4, clientY: r.top + 4 }));
    }
    await new Promise((r2) => setTimeout(r2, 400));
    return {
      info,
      clickLog: bar ? window.__clickLog : ['no bar'],
      selected: [...document.querySelectorAll('.sf-selected')].length,
      selIds: [...document.querySelectorAll('.sf-selected')].map((e) => e.getAttribute('data-sf-id')).slice(0, 4),
    };
  })()
`);
} catch (e) { seq = { died: String(e && e.message || e).slice(0, 120) }; }
console.log(JSON.stringify(seq, null, 1));
await page.waitForTimeout(2000);
const logs = await page.evaluate(() => {
  const el = document.querySelector('#log');
  return el ? el.innerText.slice(-500) : null;
});
console.log('host msgs:', await page.evaluate(() => (window.__msgProbe || []).slice(-8)));
console.log('host #log tail:', logs);
console.log('console/pageerror:', hostLog.slice(-6));
console.log('geometry POSTs after click:', posts.length, posts.join(','));
await browser.close();
