import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let playwright = null;
try { playwright = await import('playwright'); } catch {}
let pptxgen = null;
try { pptxgen = await import('pptxgenjs'); } catch {}

const tmp = mkdtempSync(path.join(os.tmpdir(), 'slideforge-export-test-'));
const fontsDir = path.resolve('public/fonts');

const PAGES = [{
  page_id: 'pg_1',
  content: `<!doctype html><html><head><meta charset="utf-8"><style>
    @font-face{font-family:'Poppins';font-weight:800;src:url('./fonts/poppins-800.woff2') format('woff2');}
    html,body{margin:0;width:1280px;height:720px;background:#0b1120;color:#f8fafc;font-family:'Poppins',sans-serif}
    .slide{padding:72px 88px;font-size:56px;font-weight:800}
  </style></head><body><div class="slide">Export test</div></body></html>`,
}];

test('pdf export produces a real PDF at 1280x720', { skip: !playwright && 'playwright not installed' }, async () => {
  const { exportPdf, closeBrowser } = await import('../src/export/index.js');
  const out = path.join(tmp, 'deck.pdf');
  await exportPdf(PAGES, { outFile: out, fontsDir });
  assert.ok(existsSync(out));
  const buf = readFileSync(out);
  assert.ok(buf.length > 1000, 'pdf suspiciously small');
  assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
  await closeBrowser();
});

test('png export produces a 2x raster of the slide', { skip: !playwright && 'playwright not installed' }, async () => {
  const { exportPng, closeBrowser } = await import('../src/export/index.js');
  const dir = path.join(tmp, 'png');
  const files = await exportPng(PAGES, { outDir: dir, fontsDir, scale: 2 });
  assert.equal(files.length, 1);
  assert.ok(statSync(files[0]).size > 1000);
  await closeBrowser();
});

test('pptx native export produces a real OOXML file', { skip: !pptxgen && 'pptxgenjs not installed' }, async () => {
  const { exportPptxNative } = await import('../src/export/index.js');
  const { normalizeSpec } = await import('../src/spec.js');
  const { spec } = normalizeSpec({
    archetype: 'metric-triple', title: 'Native PPTX',
    content: { metrics: [{ label: 'Adoption', value: '61%', delta: '+4%' }] },
  }, { index: 0 });
  const out = path.join(tmp, 'deck.pptx');
  const res = await exportPptxNative([spec], { outFile: out });
  assert.ok(existsSync(out));
  const buf = readFileSync(out);
  assert.equal(buf.subarray(0, 2).toString(), 'PK'); // zip container
  assert.ok(buf.length > 3000);
  assert.ok(Array.isArray(res.warnings));
});
