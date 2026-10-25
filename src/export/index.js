/**
 * export/index.js — PDF / PNG / PPTX exporters.
 *
 * Fidelity contract (roast R4, R5, invariant I6):
 *   - Exports NEVER touch the network. Slide HTML is written to a temp dir with
 *     the fonts copied next to it and loaded over file://.
 *   - PDF  : vector, 1280x720 (13.333in x 7.5in), background printed.
 *   - PNG  : raster, device_scale_factor 2 (2560x1440).
 *   - PPTX : two explicit modes —
 *            `native` (editable shapes/text from the spec; CSS-only effects are
 *                      dropped and REPORTED as warnings, never silently)
 *            `image`  (pixel-perfect, not editable).
 */

import { mkdirSync, writeFileSync, rmSync, cpSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { THEMES } from '../spec.js';

export const PX_W = 1280;
export const PX_H = 720;
export const IN_W = 13.3333;
export const IN_H = 7.5;

let browserPromise = null;

export class ExportError extends Error {
  constructor(message, status = 500, hint = '') { super(message); this.status = status; this.hint = hint; }
}

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    throw new ExportError('playwright is not installed', 501,
      'run: npm i -D playwright && npx playwright install chromium');
  }
}

async function getBrowser() {
  if (browserPromise) return browserPromise;
  browserPromise = (async () => {
    const { chromium } = await loadPlaywright();
    return chromium.launch({ args: ['--font-render-hinting=none'] });
  })().catch((e) => { browserPromise = null; throw e; });
  return browserPromise;
}

export async function closeBrowser() {
  if (!browserPromise) return;
  try { const b = await browserPromise; await b.close(); } catch {}
  browserPromise = null;
}

/** Stage slide HTML + fonts into a temp dir so file:// rendering is fully local. */
export function stageDir(pages, { fontsDir, mediaDir } = {}) {
  const dir = path.join(os.tmpdir(), `patarang-export-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  const pagesDir = path.join(dir, 'pages');
  mkdirSync(pagesDir, { recursive: true });
  if (fontsDir && existsSync(fontsDir)) {
    cpSync(fontsDir, path.join(dir, 'fonts'), { recursive: true });
    cpSync(fontsDir, path.join(pagesDir, 'fonts'), { recursive: true });
  }
  const mDir = mediaDir || path.join(process.env.PATARANG_DATA || path.resolve(process.cwd(), 'data'), 'media');
  if (mDir && existsSync(mDir)) {
    cpSync(mDir, path.join(pagesDir, 'media'), { recursive: true });
  }
  pages.forEach((p, i) => {
    const html = p.content
      .replace(/(["'])\/fonts\//g, `$1./fonts/`)
      .replace(/(["'])\/media\//g, `$1./media/`);
    writeFileSync(path.join(pagesDir, `slide-${i + 1}.html`), html, 'utf8');
  });
  return { dir, pagesDir };
}

async function newContext(browser, { scale = 1 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: PX_W, height: PX_H }, deviceScaleFactor: scale });
  // invariant I6: fail loudly on any external request
  await ctx.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('file://') || url.startsWith('data:') || url.startsWith('about:')) return route.continue();
    return route.abort();
  });
  return ctx;
}

async function waitReady(page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.waitForTimeout(250);
}

/* --------------------------------- PDF --------------------------------- */

/**
 * Compose ONE printable document containing every slide, so Chromium produces a
 * single multi-page PDF (calling page.pdf() per slide cannot paginate).
 *
 * Per-slide CSS is scoped (`:root` -> `.sf-page-N`) so a deck with several
 * themes keeps its own palette, and the document-level `html,body` rules are
 * stripped because they would pin the body to 1280x720 and break pagination.
 */
export function composePrintDocument(pages) {
  const parts = pages.map((p, i) => {
    const html = String(p.content || '');
    const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
    const bodyM = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
    let body = bodyM ? bodyM[1] : html;
    body = body.replace(/<script[\s\S]*?<\/script>/gi, '');
    const css = styles
      .join('\n')
      .replace(/html\s*,\s*body\s*\{[^}]*\}/gi, '')
      .replace(/:root\s*\{/g, `.sf-page-${i + 1}{`);
    return { cls: `sf-page-${i + 1}`, css, body };
  });

  const head = `<!doctype html><html><head><meta charset="utf-8"><style>
@page{size:${PX_W}px ${PX_H}px;margin:0}
html,body{margin:0;padding:0;background:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.sf-page{position:relative;width:${PX_W}px;height:${PX_H}px;overflow:hidden;break-after:page;page-break-after:always;
  background:var(--bg);color:var(--ink);-webkit-print-color-adjust:exact;print-color-adjust:exact}
.sf-page:last-child{break-after:auto;page-break-after:auto}
</style></head><body>`;

  const body = parts.map((p) => `<section class="sf-page ${p.cls}"><style>${p.css}</style>${p.body}</section>`).join('\n');
  return `${head}${body}</body></html>`;
}

export async function exportPdf(pages, { outFile, fontsDir } = {}) {
  const browser = await getBrowser();
  const { dir, pagesDir } = stageDir(pages, { fontsDir });
  const ctx = await newContext(browser, { scale: 1 });
  try {
    const doc = composePrintDocument(pages)
      .replace(/(["'])\/fonts\//g, `$1./fonts/`)
      .replace(/(["'])\/media\//g, `$1./media/`);
    const docFile = path.join(pagesDir, 'print.html');
    writeFileSync(docFile, doc, 'utf8');
    const page = await ctx.newPage();
    await page.goto(pathToFileURL(docFile).href, { waitUntil: 'load' });
    await waitReady(page);
    await page.emulateMedia({ media: 'print' });
    await page.pdf({
      path: outFile,
      printBackground: true,
      preferCSSPageSize: true,
      width: `${PX_W}px`,
      height: `${PX_H}px`,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
    return outFile;
  } finally {
    await ctx.close().catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  }
}

/* --------------------------------- PNG --------------------------------- */

export async function exportPng(pages, { outDir, fontsDir, scale = 2 } = {}) {
  const browser = await getBrowser();
  const { dir, pagesDir } = stageDir(pages, { fontsDir });
  const ctx = await newContext(browser, { scale });
  const files = [];
  try {
    mkdirSync(outDir, { recursive: true });
    const page = await ctx.newPage();
    for (let i = 0; i < pages.length; i++) {
      await page.goto(pathToFileURL(path.join(pagesDir, `slide-${i + 1}.html`)).href, { waitUntil: 'load' });
      await waitReady(page);
      const file = path.join(outDir, `slide-${String(i + 1).padStart(2, '0')}.png`);
      await page.screenshot({ path: file, clip: { x: 0, y: 0, width: PX_W, height: PX_H } });
      files.push(file);
    }
    return files;
  } finally {
    await ctx.close().catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  }
}

/* -------------------------------- PPTX -------------------------------- */

function hex(color) {
  const c = String(color || '').trim();
  const m = c.match(/^#([0-9a-f]{6})$/i);
  if (m) return m[1].toUpperCase();
  const m3 = c.match(/^#([0-9a-f]{3})$/i);
  if (m3) return m3[1].split('').map((x) => x + x).join('').toUpperCase();
  return 'FFFFFF';
}

const isGradient = (c) => /gradient/i.test(String(c || ''));

/** Build a native, editable PPTX from the specs. Returns {file, warnings}. */
export async function exportPptxNative(specs, { outFile } = {}) {
  let pptxgen;
  try {
    pptxgen = (await import('pptxgenjs')).default || (await import('pptxgenjs'));
  } catch {
    throw new ExportError('pptxgenjs is not installed', 501, 'run: npm i pptxgenjs');
  }
  const warnings = [];
  const pptx = new pptxgen();
  pptx.defineLayout({ name: 'SF16x9', width: IN_W, height: IN_H });
  pptx.layout = 'SF16x9';
  pptx.author = 'Patarang';
  pptx.title = 'Patarang deck';

  for (const spec of specs) {
    const t = { ...(THEMES[spec.theme] || THEMES.midnight), ...(spec.palette || {}) };
    const slide = pptx.addSlide();
    if (isGradient(t.bg)) {
      warnings.push(`slide "${spec.title}": gradient background flattened to solid ${hex(t.bgAlt || t.surface)}`);
      slide.background = { color: hex(t.bgAlt || t.surface) };
    } else {
      slide.background = { color: hex(t.bg) };
    }
    const W = IN_W, H = IN_H, PAD = 0.92;
    let y = PAD;

    if (!spec.hideHeader) {
      if (spec.kicker) {
        slide.addText(String(spec.kicker).toUpperCase(), { x: PAD, y, w: W - PAD * 2, h: 0.28, fontSize: 12, bold: true, charSpacing: 2.2, color: hex(t.accent), fontFace: 'Poppins' });
        y += 0.34;
      }
      if (spec.title) {
        const lines = Math.max(1, Math.ceil(String(spec.title).length / 26));
        slide.addText(String(spec.title), { x: PAD, y, w: W - PAD * 2, h: 0.62 * lines, fontSize: 38, bold: true, color: hex(t.ink), fontFace: 'Poppins', valign: 'top', margin: 0 });
        y += 0.62 * lines + 0.12;
      }
      if (spec.subtitle) {
        slide.addText(String(spec.subtitle), { x: PAD, y, w: W - PAD * 2, h: 0.62, fontSize: 15, color: hex(t.muted), fontFace: 'Inter', valign: 'top', margin: 0 });
        y += 0.7;
      }
    }

    const c = spec.content || {};
    const cardW = (W - PAD * 2 - 0.3) / (c.blocks?.length || c.metrics?.length || 2);

    if (c.blocks?.length) {
      c.blocks.forEach((b, i) => {
        const x = PAD + i * (cardW + 0.15);
        slide.addShape(pptx.ShapeType.roundRect, {
          x, y: y + 0.1, w: cardW, h: 2.4,
          fill: { color: hex(b.tone === 'accent' ? t.accent : t.surface) },
          line: { color: hex(t.line === 'rgba(148,163,184,.22)' ? '2A3B5C' : t.line), width: 1 },
          rectRadius: 0.12,
        });
        let ty = y + 0.28;
        if (b.label) { slide.addText(String(b.label).toUpperCase(), { x: x + 0.18, y: ty, w: cardW - 0.36, h: 0.24, fontSize: 10, bold: true, charSpacing: 1.6, color: hex(t.muted), margin: 0 }); ty += 0.3; }
        if (b.value) { slide.addText(String(b.value), { x: x + 0.18, y: ty, w: cardW - 0.36, h: 0.6, fontSize: 30, bold: true, color: hex(t.ink), margin: 0 }); ty += 0.66; }
        if (b.text) { slide.addText(String(b.text), { x: x + 0.18, y: ty, w: cardW - 0.36, h: 1.0, fontSize: 12, color: hex(t.muted), margin: 0 }); }
      });
    }

    if (c.metrics?.length) {
      c.metrics.forEach((m, i) => {
        const x = PAD + i * (cardW + 0.15);
        slide.addShape(pptx.ShapeType.roundRect, { x, y: y + 0.1, w: cardW, h: 2.2, fill: { color: hex(t.surface) }, line: { color: '2A3B5C', width: 1 }, rectRadius: 0.12 });
        slide.addText(String(m.label || '').toUpperCase(), { x: x + 0.18, y: y + 0.3, w: cardW - 0.36, h: 0.24, fontSize: 10, bold: true, charSpacing: 1.4, color: hex(t.muted), margin: 0 });
        slide.addText(String(m.value || ''), { x: x + 0.18, y: y + 0.62, w: cardW - 0.36, h: 0.8, fontSize: 40, bold: true, color: hex(t.accent), margin: 0 });
        if (m.delta) slide.addText(String(m.delta), { x: x + 0.18, y: y + 1.5, w: cardW - 0.36, h: 0.3, fontSize: 11, bold: true, color: hex(m.positive === false ? 'F87171' : t.positive), margin: 0 });
      });
    }

    if (c.left || c.right) {
      const half = (W - PAD * 2 - 0.3) / 2;
      [['left', c.left], ['right', c.right]].forEach(([key, side], i) => {
        if (!side) return;
        const x = PAD + i * (half + 0.3);
        slide.addShape(pptx.ShapeType.roundRect, { x, y: y + 0.1, w: half, h: 3.3, fill: { color: hex(key === 'right' ? t.surfaceAlt : t.surface) }, line: { color: key === 'right' ? hex(t.accent) : '2A3B5C', width: 1 }, rectRadius: 0.12 });
        let ty = y + 0.28;
        if (side.label) { slide.addText(String(side.label).toUpperCase(), { x: x + 0.2, y: ty, w: half - 0.4, h: 0.24, fontSize: 10, bold: true, charSpacing: 1.6, color: hex(t.accent), margin: 0 }); ty += 0.3; }
        if (side.head) { slide.addText(String(side.head), { x: x + 0.2, y: ty, w: half - 0.4, h: 0.4, fontSize: 20, bold: true, color: hex(t.ink), margin: 0 }); ty += 0.48; }
        if (side.text) { slide.addText(String(side.text), { x: x + 0.2, y: ty, w: half - 0.4, h: 0.5, fontSize: 12, color: hex(t.muted), margin: 0 }); ty += 0.58; }
        if (side.points?.length) {
          slide.addText(side.points.map((p) => `• ${p}`).join('\n'), { x: x + 0.2, y: ty, w: half - 0.4, h: 1.6, fontSize: 12, color: hex(t.ink), margin: 0, breakLine: false });
        }
      });
    }

    if (c.items?.length) {
      c.items.forEach((it, i) => {
        const iy = y + 0.18 + i * 0.82;
        slide.addText(String(i + 1).padStart(2, '0'), { x: PAD, y: iy, w: 0.5, h: 0.3, fontSize: 12, bold: true, color: hex(t.accent), margin: 0 });
        if (it.head) slide.addText(String(it.head), { x: PAD + 0.55, y: iy, w: W - PAD * 2 - 0.55, h: 0.3, fontSize: 17, bold: true, color: hex(t.ink), margin: 0 });
        if (it.text) slide.addText(String(it.text), { x: PAD + 0.55, y: iy + 0.32, w: W - PAD * 2 - 0.55, h: 0.34, fontSize: 12, color: hex(t.muted), margin: 0 });
      });
    }

    if (c.points?.length && !c.items) {
      slide.addText(c.points.map((p) => `• ${p}`).join('\n'), { x: PAD, y: y + 0.2, w: W - PAD * 2, h: 2.4, fontSize: 15, color: hex(t.ink), margin: 0, lineSpacingMultiple: 1.35 });
    }

    if (c.quote) {
      slide.addText(String(c.quote), { x: PAD, y: y + 0.2, w: W - PAD * 2 - 1.2, h: 2.2, fontSize: 28, bold: true, color: hex(t.ink), margin: 0 });
      if (c.attribution) slide.addText(String(c.attribution), { x: PAD, y: y + 2.5, w: W - PAD * 2, h: 0.3, fontSize: 12, color: hex(t.muted), margin: 0 });
    }

    if (c.chart?.series?.length) {
      const chart = c.chart;
      const labels = chart.categories || [];
      const seriesData = chart.series.map((s) => ({
        name: s.name || 'Series',
        labels,
        values: (s.values || []).map((v) => Number(v) || 0),
      }));
      slide.addChart(chart.type === 'line' ? pptx.ChartType.line : pptx.ChartType.bar, seriesData, {
        x: PAD, y: y + 0.1, w: W - PAD * 2, h: 3.2,
        chartColors: [hex(t.accent), hex(t.accent2), hex(t.positive)],
        showLegend: seriesData.length > 1, showTitle: false, showValue: true,
        catAxisLabelColor: hex(t.muted), valAxisLabelColor: hex(t.muted),
        catAxisLabelFontFace: 'Inter', valAxisLabelFontFace: 'Inter',
      });
    }

    if (c.steps?.length) {
      const sw = (W - PAD * 2 - 0.15 * (c.steps.length - 1)) / c.steps.length;
      c.steps.forEach((st, i) => {
        const x = PAD + i * (sw + 0.15);
        slide.addShape(pptx.ShapeType.roundRect, { x, y: y + 0.1, w: sw, h: 2.3, fill: { color: hex(t.surface) }, line: { color: '2A3B5C', width: 1 }, rectRadius: 0.12 });
        if (st.label) slide.addText(String(st.label).toUpperCase(), { x: x + 0.16, y: y + 0.28, w: sw - 0.32, h: 0.24, fontSize: 10, bold: true, color: hex(t.accent), margin: 0 });
        if (st.head) slide.addText(String(st.head), { x: x + 0.16, y: y + 0.58, w: sw - 0.32, h: 0.45, fontSize: 16, bold: true, color: hex(t.ink), margin: 0 });
        if (st.text) slide.addText(String(st.text), { x: x + 0.16, y: y + 1.08, w: sw - 0.32, h: 1.0, fontSize: 12, color: hex(t.muted), margin: 0 });
      });
    }

    if (c.events?.length) {
      c.events.forEach((ev, i) => {
        const ey = y + 0.15 + i * 0.72;
        if (ev.when) slide.addText(String(ev.when).toUpperCase(), { x: PAD, y: ey, w: 1.3, h: 0.3, fontSize: 11, bold: true, color: hex(t.accent), margin: 0 });
        if (ev.head) slide.addText(String(ev.head), { x: PAD + 1.4, y: ey, w: W - PAD * 2 - 1.4, h: 0.3, fontSize: 16, bold: true, color: hex(t.ink), margin: 0 });
        if (ev.text) slide.addText(String(ev.text), { x: PAD + 1.4, y: ey + 0.28, w: W - PAD * 2 - 1.4, h: 0.34, fontSize: 12, color: hex(t.muted), margin: 0 });
      });
    }

    if (c.table?.headers?.length) {
      const headerRow = c.table.headers.map((h) => ({ text: String(h), options: { bold: true, color: hex(t.accent), fill: { color: hex(t.surfaceAlt || t.surface) } } }));
      const bodyRows = (c.table.rows || []).map((r) => r.map((cell) => ({ text: String(cell), options: { color: hex(t.ink), fill: { color: hex(t.surface) } } })));
      slide.addTable([headerRow, ...bodyRows], { x: PAD, y: y + 0.1, w: W - PAD * 2, fontSize: 13, fontFace: 'Inter', border: { pt: 1, color: '2A3B5C' } });
    }

    if (typeof c.html === 'string' && c.html.trim()) {
      // Extract structured cards/text blocks from custom HTML so native PPTX stays editable!
      const blocks = [...c.html.matchAll(/<div[^>]+data-sf-id="([^"]+)"[^>]*>([\s\S]*?)<\/div>/gi)]
        .map((m) => ({ id: m[1], text: m[2].replace(/<svg[\s\S]*?<\/svg>/gi, '').replace(/<[^>]+>/g, ' · ').replace(/\s+/g, ' ').replace(/^(\s*·\s*)+|(\s*·\s*)+$/g, '').trim() }))
        .filter((b) => b.text && b.text.length <= 260)
        .slice(0, 6);
      const cols = Math.min(3, Math.max(1, blocks.length));
      const bw = (W - PAD * 2 - 0.2 * (cols - 1)) / cols;
      blocks.forEach((b, i) => {
        const col = i % cols, row = Math.floor(i / cols);
        const bx = PAD + col * (bw + 0.2), by = (spec.hideHeader ? 1.1 : y + 0.1) + row * 2.1;
        slide.addShape(pptx.ShapeType.roundRect, { x: bx, y: by, w: bw, h: 1.85, fill: { color: hex(t.surface) }, line: { color: hex(t.accent), width: 1 }, rectRadius: 0.1 });
        slide.addText(b.text, { x: bx + 0.16, y: by + 0.16, w: bw - 0.32, h: 1.5, fontSize: 13, color: hex(t.ink), fontFace: 'Inter', valign: 'middle', margin: 0 });
      });
    }

    if (spec.notes) {
      slide.addNotes(String(spec.notes));
    }
  }

  await pptx.writeFile({ fileName: outFile });
  return { file: outFile, warnings };
}

/** Image-based PPTX: pixel-perfect, not editable. */
export async function exportPptxImage(pngFiles, { outFile } = {}) {
  let pptxgen;
  try {
    pptxgen = (await import('pptxgenjs')).default || (await import('pptxgenjs'));
  } catch {
    throw new ExportError('pptxgenjs is not installed', 501, 'run: npm i pptxgenjs');
  }
  const pptx = new pptxgen();
  pptx.defineLayout({ name: 'SF16x9', width: IN_W, height: IN_H });
  pptx.layout = 'SF16x9';
  pptx.author = 'Patarang';
  for (const f of pngFiles) {
    const slide = pptx.addSlide();
    slide.addImage({ path: f, x: 0, y: 0, w: IN_W, h: IN_H });
  }
  await pptx.writeFile({ fileName: outFile });
  return { file: outFile, warnings: ['image mode: slides are not editable (pixel-perfect fidelity)'] };
}
