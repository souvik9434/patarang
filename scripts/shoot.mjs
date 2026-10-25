import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = 'D:/Patarang/proof';
mkdirSync(OUT, { recursive: true });
const URL = process.env.URL || 'http://127.0.0.1:4173/';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

const _dl = await (await fetch(URL + 'api/decks')).json().catch(() => null);
const _d0 = (_dl?.data?.decks || []).find((d) => d.page_num > 0);
const OPEN = _d0 ? `${URL}?deck=${_d0.project_id}` : URL;
await page.goto(OPEN, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/editor-desktop.png` });

// canvas alone + selection chrome proof
const frame = page.frames().find((f) => f.url().includes('/canvas/'));
if (frame) {
  const el = await frame.$('.slide-container');
  if (el) await el.screenshot({ path: `${OUT}/canvas-slide.png` });
  const titleEl = await frame.$('[data-sf-id="title"]');
  if (titleEl && el) {
    await titleEl.click();
    await page.waitForTimeout(250);
    await el.screenshot({ path: `${OUT}/canvas-selected.png` });
  }
}

// mobile
const mctx = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2, isMobile: true });
const mpage = await mctx.newPage();
await mpage.goto(OPEN, { waitUntil: 'networkidle' });
await mpage.waitForTimeout(1800);
await mpage.screenshot({ path: `${OUT}/editor-mobile.png` });

console.log('console errors:', errors.length ? errors.slice(0, 8) : 'none');
await browser.close();
