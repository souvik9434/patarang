/** ui-audit.mjs — measurable editor-chrome gates (P2): contrast + overflow. */
import { chromium } from 'playwright';
const URL = process.env.URL || 'http://127.0.0.1:4173/';
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1600, height: 950 } })).newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto(URL, { waitUntil: 'networkidle' });
await p.waitForTimeout(2200);
const FN = () => {
  const P = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c || ''); if (!m) return null; const q = m[1].split(',').map(Number); return { r: q[0], g: q[1], b: q[2], a: q[3] ?? 1 }; };
  const L = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const BG = (el) => { let n = el; while (n && n.nodeType === 1) { const s = getComputedStyle(n); const c = P(s.backgroundColor); if (c && c.a > 0.9) return c; if (s.backgroundImage !== 'none') return null; n = n.parentElement; } return { r: 10, g: 13, b: 20, a: 1 }; };
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1)) continue;
    const q = el.getBoundingClientRect(); if (q.width < 2 || q.height < 2) continue;
    const s = getComputedStyle(el); if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity < 0.3) continue;
    const f = P(s.color); const g = BG(el); if (!f || !g) continue;
    const a = L(f); const c = L(g); const ratio = (Math.max(a, c) + 0.05) / (Math.min(a, c) + 0.05);
    out.push({ sel: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/)[0] : ''), ratio: +ratio.toFixed(2), size: parseFloat(s.fontSize), weight: +s.fontWeight, text: el.textContent.trim().slice(0, 42) });
  }
  return out;
};
const rows = await p.evaluate(FN);
const seen = new Set(); const uniq = [];
for (const r of rows) { const k = r.sel + r.size + r.weight; if (seen.has(k)) continue; seen.add(k); uniq.push(r); }
const need = (r) => ((r.size >= 18.66 || (r.size >= 14 && r.weight >= 700)) ? 3 : 4.5);
const bad = uniq.filter((r) => r.ratio < need(r)).sort((x, y) => x.ratio - y.ratio);
console.log(`contrast: ${uniq.length} distinct text styles, ${bad.length} below AA`);
for (const r of bad.slice(0, 20)) console.log(`  ${r.ratio} (need ${need(r)}) ${r.size}px/${r.weight} ${r.sel} — "${r.text}"`);
const ov = await p.evaluate(() => ({ doc: document.documentElement.scrollWidth - document.documentElement.clientWidth, body: document.body.scrollWidth - document.body.clientWidth }));
console.log('overflow(1600x950)', JSON.stringify(ov));
const targets = await p.evaluate(() => [...document.querySelectorAll('button,select,input,textarea,a[href]')].map((el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return { sel: el.tagName.toLowerCase() + (el.id ? '#' + el.id : ''), w: Math.round(r.width), h: Math.round(r.height), vis: r.width > 0 && s.display !== 'none' && s.visibility !== 'hidden' }; }).filter((x) => x.vis && (x.h < 24 || x.w < 16)));
console.log('small targets(<24px tall)', JSON.stringify(targets.slice(0, 12)));
console.log('pageerrors', errs.length ? errs : 'none');
await b.close();
