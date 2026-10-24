/**
 * scripts/shoot-media.mjs — P0 visual proof: the full UI media loop
 * (upload via the inspector → deck list → Apply → image layer on canvas),
 * plus the MOCK ribbon state. Run with the dev server on 4173.
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = 'D:/SlideForge/proof';
mkdirSync(OUT, { recursive: true });
const URL = process.env.URL || 'http://127.0.0.1:4173/';
const PNG = process.env.PNG || `${OUT}/proof-8x8.png`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('#thumbs .thumb', { timeout: 15000 });

// 1) Media tab: upload through the real file input
await page.click('.tab[data-tab="media"]');
await page.setInputFiles('#mediaFile', PNG);
await page.waitForSelector('#mediaList .media-item', { timeout: 15000 });
const listCount = await page.locator('#mediaList .media-item').count();

// 2) Set alt + fit through the form, Apply to slide
await page.fill('#mediaAlt', 'Blue checker 8×8 (proof)');
await page.selectOption('#mediaFit', 'cover');
await page.click('#btnMediaApply');
await page.waitForTimeout(1800); // commit → reloadCanvas
const ribbonVisible = await page.locator('#providerRibbon:not([hidden])').count();
const ribbonText = ribbonVisible ? (await page.textContent('#providerRibbon')) || '' : '';
await page.screenshot({ path: `${OUT}/p0-media-applied.png` });

// 3) The canvas iframe must carry the layer now
const frame = page.frames().find((f) => f.url().includes('/canvas/'));
let canvasHasLayer = false, canvasHasImg = false;
if (frame) {
  canvasHasLayer = !!(await frame.$('.sf-imglayer'));
  canvasHasImg = canvasHasLayer && !!(await frame.$('.sf-imglayer img[src^="/media/"]'));
  if (canvasHasLayer) await frame.locator('.sf-imglayer').screenshot({ path: `${OUT}/p0-image-layer.png` });
}
await (await page.$('#stageFrame')).screenshot({ path: `${OUT}/canvas-slide.png` });

console.log(JSON.stringify({
  uploadedItems: listCount,
  ribbonVisible: !!ribbonVisible,
  ribbonText: ribbonText.trim(),
  canvasHasLayer,
  canvasHasImg,
  consoleErrors: errors.length ? errors.slice(0, 5) : 'none',
}, null, 1));
await browser.close();
