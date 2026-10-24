import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1600, height: 950 } })).newPage();
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
const fr = page.frames().find((f) => f.url().includes('/canvas/'));
if (!fr) { console.log('no frame'); await browser.close(); process.exit(1); }
const probe = await fr.evaluate(`
  window.__sfprobe = [];
  document.addEventListener('pointerdown', (e) => { window.__sfprobe.push(['down', e.clientX, e.clientY, e.target === document]); }, true);
  document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, isPrimary: true, pointerType: 'mouse', button: 0, clientX: 640, clientY: 300 }));
  document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, isPrimary: true, pointerType: 'mouse', button: 0, buttons: 1, clientX: 900, clientY: 400 }));
  document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, isPrimary: true, pointerType: 'mouse', button: 0, clientX: 900, clientY: 400 }));
  new Promise((res) => setTimeout(() => res({
    probe: window.__sfprobe,
    marquee: (() => { const m = document.querySelector('.sf-marquee'); return m ? { display: m.style.display, w: m.style.width, l: m.style.left, t: m.style.top } : null; })(),
    sel: [...document.querySelectorAll('.sf-selected')].length,
    chromeHost: !!document.querySelector('.sf-bchost'),
  }), 700))
`);
console.log(JSON.stringify(probe, null, 1));
await browser.close();
