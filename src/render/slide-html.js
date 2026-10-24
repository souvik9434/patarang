/**
 * render/slide-html.js — spec -> complete 1280x720 HTML document.
 *
 * The produced document is the canonical artefact of a SlideForge slide:
 *   - self-contained markup + inline CSS (no CDN, no network at export time)
 *   - a `<script id="slide-spec" type="application/json">` island carrying the
 *     machine-readable spec (invariant I1: HTML is authoritative, spec is a cache)
 *   - `data-sf-id` / `data-sf-slot` hooks so the bridge can resolve a click to a
 *     slot without a vision model (roast R11)
 */

import { THEMES, FONT_PAIRS } from '../spec.js';
import { renderLayout } from './layouts.js';
import { sanitize } from '../sanitize.js';

export const FONT_STACK_DISPLAY = `'Poppins','Segoe UI',system-ui,-apple-system,sans-serif`;
export const FONT_STACK_BODY = `'Inter var','Inter','Segoe UI',system-ui,-apple-system,sans-serif`;

export function fontFaces(fontBase = '/fonts/') {
  return `
@font-face{font-family:'Poppins';font-style:normal;font-weight:400;font-display:swap;src:url('${fontBase}poppins-400.woff2') format('woff2');}
@font-face{font-family:'Poppins';font-style:normal;font-weight:600;font-display:swap;src:url('${fontBase}poppins-600.woff2') format('woff2');}
@font-face{font-family:'Poppins';font-style:normal;font-weight:700;font-display:swap;src:url('${fontBase}poppins-700.woff2') format('woff2');}
@font-face{font-family:'Poppins';font-style:normal;font-weight:800;font-display:swap;src:url('${fontBase}poppins-800.woff2') format('woff2');}
@font-face{font-family:'Inter var';font-style:normal;font-weight:100 900;font-display:swap;src:url('${fontBase}inter-var.woff2') format('woff2');unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+2000-206F,U+20B9,U+2212,U+2215,U+FEFF,U+FFFD;}`;
}

export function themeVars(themeOrSpec) {
  const isObj = themeOrSpec && typeof themeOrSpec === 'object';
  const themeId = isObj ? themeOrSpec.theme : themeOrSpec;
  const base = THEMES[themeId] || THEMES.midnight;
  const pal = (isObj && themeOrSpec.palette && typeof themeOrSpec.palette === 'object') ? themeOrSpec.palette : {};
  const fp = FONT_PAIRS[isObj ? themeOrSpec.fontPair : 'modern'] || FONT_PAIRS.modern;
  const t = { ...base, ...pal };
  return `
:root{
--bg:${t.bg};--bg-alt:${t.bgAlt};--surface:${t.surface};--surface-alt:${t.surfaceAlt};
--ink:${t.ink};--muted:${t.muted};--accent:${t.accent};--accent2:${t.accent2};
--line:${t.line};--positive:${t.positive};
--font-display:${fp.display};--font-body:${fp.body};
}`;
}

export const LAYOUT_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1280px;height:720px;overflow:hidden;background:var(--bg);color:var(--ink);
  font-family:var(--font-body,${FONT_STACK_BODY});-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}
.slide-container{position:relative;width:1280px;height:720px;padding:72px 88px;display:flex;flex-direction:column;
  gap:26px;background:var(--bg);overflow:hidden}
.slide-container[data-sf-canvas="full-bleed"]{padding:0;gap:0}
.slide-container[data-sf-canvas="centered"]{align-items:center;text-align:center}
.slide-container[data-sf-canvas="centered"] .sf-title,.slide-container[data-sf-canvas="centered"] .sf-subtitle{margin-left:auto;margin-right:auto}
.slide-container::before{content:'';position:absolute;inset:0;pointer-events:none;
  background:radial-gradient(120% 90% at 88% -10%,color-mix(in srgb,var(--accent) 16%,transparent) 0%,transparent 58%),
             radial-gradient(90% 70% at -10% 108%,color-mix(in srgb,var(--accent2) 14%,transparent) 0%,transparent 55%)}
.slide-container>*{position:relative;z-index:1}

.sf-kicker{font-family:var(--font-display,${FONT_STACK_DISPLAY});font-size:13px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--accent)}
.sf-title{font-family:var(--font-display,${FONT_STACK_DISPLAY});font-size:56px;line-height:1.04;font-weight:800;letter-spacing:-.022em;max-width:22ch}
.sf-subtitle{font-size:21px;line-height:1.5;color:var(--muted);max-width:78ch;font-weight:400}
.sf-lead{font-size:25px;line-height:1.45;color:var(--ink);max-width:70ch;font-weight:500}
.sf-title+.sf-subtitle{margin-top:-8px}

.sf-points{display:flex;flex-direction:column;gap:12px;margin-top:4px;position:static}
.sf-point{display:flex;align-items:flex-start;gap:12px;font-size:19px;line-height:1.45;color:var(--ink);max-width:74ch}
.sf-bullet{flex:0 0 auto;width:8px;height:8px;border-radius:50%;background:var(--accent);margin-top:8px}

.sf-grid{display:grid;gap:22px;flex:1 1 auto;min-height:0;align-content:stretch;grid-auto-rows:minmax(0,1fr)}
.sf-grid-2{grid-template-columns:repeat(2,1fr)}
.sf-grid-3{grid-template-columns:1.2fr 1fr;grid-template-rows:repeat(2,minmax(0,1fr))}
.sf-grid-4{grid-template-columns:repeat(4,1fr)}
.sf-card{border:1px solid var(--line);border-radius:20px;background:var(--surface);padding:28px;
  display:flex;flex-direction:column;gap:10px;box-shadow:0 1px 0 rgba(255,255,255,.04) inset,0 18px 40px -28px rgba(0,0,0,.55);
  backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);overflow:hidden}
@keyframes sf-glow{0%,100%{box-shadow:0 1px 0 rgba(255,255,255,.04) inset,0 18px 40px -28px rgba(0,0,0,.55)}50%{box-shadow:0 1px 0 rgba(255,255,255,.09) inset,0 22px 46px -26px rgba(0,0,0,.62)}}
@media screen and (prefers-reduced-motion:no-preference){.sf-card--block.is-hero,.sf-card--metric{animation:sf-glow 6s ease-in-out infinite}}
.sf-card--block.is-hero{grid-row:span 2;justify-content:center}
.sf-card--block.is-accent{background:color-mix(in srgb,var(--accent) 16%,var(--surface));border-color:color-mix(in srgb,var(--accent) 38%,transparent)}
.sf-card--block.is-accent2{background:color-mix(in srgb,var(--accent2) 16%,var(--surface));border-color:color-mix(in srgb,var(--accent2) 38%,transparent)}
.sf-card--block.is-muted{background:var(--surface-alt)}
.sf-card__label{font-family:${FONT_STACK_DISPLAY};font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.sf-card__value{font-family:${FONT_STACK_DISPLAY};font-size:42px;font-weight:800;letter-spacing:-.02em;line-height:1}
.sf-card__text{font-size:17px;line-height:1.45;color:var(--muted)}

.sf-card--metric{justify-content:center;gap:12px}
.sf-metric__label{font-family:${FONT_STACK_DISPLAY};font-size:13px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:var(--muted)}
.sf-metric__value{font-family:${FONT_STACK_DISPLAY};font-size:60px;font-weight:800;letter-spacing:-.03em;line-height:.95;color:var(--accent)}
.sf-metric__delta{align-self:flex-start;font-size:13px;font-weight:600;padding:4px 10px;border-radius:999px;border:1px solid var(--line)}
.sf-metric__delta.is-up{color:var(--positive);background:color-mix(in srgb,var(--positive) 14%,transparent);border-color:color-mix(in srgb,var(--positive) 34%,transparent)}
.sf-metric__delta.is-down{color:#f87171;background:rgba(248,113,113,.12);border-color:rgba(248,113,113,.32)}

.sf-split{display:grid;grid-template-columns:1fr 1fr;gap:26px;flex:1;align-content:stretch}
.sf-split--media{grid-template-columns:1.05fr .95fr}
.sf-col{border:1px solid var(--line);border-radius:22px;background:var(--surface);padding:30px;display:flex;flex-direction:column;gap:12px}
.sf-col--right{background:var(--surface-alt);border-color:color-mix(in srgb,var(--accent) 34%,transparent)}
.sf-col__label{font-family:${FONT_STACK_DISPLAY};font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--accent)}
.sf-col__head{font-family:${FONT_STACK_DISPLAY};font-size:28px;font-weight:700;letter-spacing:-.01em;line-height:1.15}
.sf-col__text{font-size:17px;line-height:1.5;color:var(--muted)}
.sf-list{list-style:none;display:flex;flex-direction:column;gap:10px;margin-top:4px}
.sf-list li{display:flex;gap:10px;align-items:flex-start;font-size:17px;line-height:1.45;color:var(--ink)}

.sf-rows{display:flex;flex-direction:column;gap:16px;flex:1;justify-content:center}
.sf-row{display:flex;gap:22px;align-items:flex-start;border-top:1px solid var(--line);padding-top:16px}
.sf-row:first-child{border-top:0;padding-top:0}
.sf-row__index{font-family:${FONT_STACK_DISPLAY};font-size:15px;font-weight:700;color:var(--accent);letter-spacing:.08em;padding-top:3px}
.sf-row__head{font-family:${FONT_STACK_DISPLAY};font-size:24px;font-weight:700;letter-spacing:-.01em}
.sf-row__text{font-size:17px;line-height:1.45;color:var(--muted);margin-top:4px;max-width:82ch}

.sf-steps{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:18px;flex:1;align-content:center;position:relative}
.sf-steps::before{content:'';position:absolute;left:8%;right:8%;top:22px;height:1px;background:var(--line)}
.sf-step{display:flex;flex-direction:column;gap:8px;position:relative}
.sf-step__dot{width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  font-family:${FONT_STACK_DISPLAY};font-weight:700;font-size:17px;background:var(--surface);border:1px solid var(--line);color:var(--accent);margin-bottom:6px}
.sf-step__label{font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.sf-step__head{font-family:${FONT_STACK_DISPLAY};font-size:21px;font-weight:700;line-height:1.2}
.sf-step__text{font-size:15px;line-height:1.45;color:var(--muted)}

.sf-timeline{display:flex;flex-direction:column;gap:18px;flex:1;justify-content:center}
.sf-event{display:grid;grid-template-columns:120px 1fr;gap:24px;align-items:start;position:relative;padding-left:22px}
.sf-event::before{content:'';position:absolute;left:0;top:8px;width:9px;height:9px;border-radius:50%;background:var(--accent)}
.sf-event::after{content:'';position:absolute;left:4px;top:24px;bottom:-18px;width:1px;background:var(--line)}
.sf-event:last-child::after{display:none}
.sf-event__when{font-family:${FONT_STACK_DISPLAY};font-size:13px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);padding-top:4px}
.sf-event__head{font-family:${FONT_STACK_DISPLAY};font-size:23px;font-weight:700}
.sf-event__text{font-size:16px;line-height:1.45;color:var(--muted);margin-top:3px}

.sf-quote-card{flex:1;justify-content:center;padding:42px 54px;position:relative}
.sf-quote__mark{position:absolute;right:44px;top:12px;font-family:${FONT_STACK_DISPLAY};font-size:160px;line-height:1;color:var(--accent);opacity:.16;pointer-events:none}
.sf-quote{font-family:${FONT_STACK_DISPLAY};font-size:38px;line-height:1.26;font-weight:700;letter-spacing:-.015em;max-width:34ch}
.sf-quote__attr{font-size:18px;font-weight:600;color:var(--accent);letter-spacing:.02em;margin-top:16px}

.sf-chart-card{flex:1;padding:24px 32px;gap:12px;justify-content:space-between}
.sf-chart__legend{display:flex;gap:22px;justify-content:flex-end;align-items:center;font-size:14px;font-weight:600;color:var(--ink)}
.sf-chart__legitem{display:inline-flex;align-items:center;gap:8px}
.sf-chart__swatch{width:12px;height:12px;border-radius:4px;display:inline-block}
.sf-chart{flex:1;display:flex;align-items:center}
.sf-chart svg{overflow:visible}
.sf-chart__label{font-family:${FONT_STACK_BODY};font-size:13px;font-weight:500;fill:var(--muted)}
.sf-chart__val{font-family:${FONT_STACK_DISPLAY};font-size:13px;font-weight:700;fill:var(--ink)}

.sf-table-wrap{flex:1;padding:20px 28px;justify-content:center;overflow:hidden}
.sf-table{width:100%;border-collapse:collapse;font-size:16px}
.sf-table th{font-family:${FONT_STACK_DISPLAY};font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--accent);text-align:left;padding:12px 16px;border-bottom:2px solid var(--line)}
.sf-table td{padding:14px 16px;border-bottom:1px solid var(--line);color:var(--ink);line-height:1.4}
.sf-table tr:last-child td{border-bottom:0}
.sf-table td:first-child{font-weight:700}

.sf-custom{flex:1;display:flex;flex-direction:column;gap:20px;min-height:0}

.sf-media{border-radius:22px;overflow:hidden;border:1px solid var(--line);background:var(--surface-alt);min-height:280px}
.sf-media img{width:100%;height:100%;object-fit:cover;display:block}
.sf-media__ph{width:100%;height:100%;min-height:280px;background:linear-gradient(135deg,var(--surface-alt),var(--surface))}
.sf-media__text{display:flex;flex-direction:column;gap:14px;justify-content:center}

/* P0a per-slide image layer — absolutely positioned by spec.geometry["img"],
 * BELOW the text layer by design (a background image you drag into place). */
.sf-imglayer{position:absolute;overflow:hidden;border-radius:20px;background:var(--surface-alt);
  border:1px solid var(--line);box-shadow:0 18px 40px -28px rgba(0,0,0,.55);z-index:0}
.sf-imglayer img{width:100%;height:100%;display:block}
.sf-imglayer img.is-broken{display:none}
`;

export function buildSlideCss(fontBase = '/fonts/') {
  return `${fontFaces(fontBase)}\n${LAYOUT_CSS}`;
}

/**
 * @param {object} spec  normalised SlideSpec
 * @param {{fontBase?:string, includeBridge?:boolean, bridgeSrc?:string, title?:string}} opts
 */
/**
 * Apply editor geometry (spec.geometry) to rendered markup.
 * geometry = { "<sfId>": { x, y, w, h, r?, z? } }.
 *
 * OFFSET MODEL (2026-10-23): for layout elements x/y are a DELTA from the
 * element's natural flow slot and are emitted as `position:relative`. Relative
 * offsets never remove an element from flow, so moving one element can never
 * reflow — and visually "replace" — its siblings. The image layer keeps
 * absolute coordinates because `.sf-imglayer` is a full-slide overlay.
 */
export function applyGeometry(bodyHtml, geometry, styles) {
  const hasGeo = geometry && Object.keys(geometry).length;
  const hasSt = styles && Object.keys(styles).length;
  if (!hasGeo && !hasSt) return bodyHtml;
  return bodyHtml.replace(/data-sf-id="([^"]+)"([^>]*)>/g, (full, id, rest) => {
    const g = hasGeo ? geometry[id] : null;
    const s = hasSt ? styles[id] : null;
    if (!g && !s) return full;
    const isImage = /data-sf-role="image"|data-sf-extra/.test(rest);
    let style = '';
    if (g) {
      style += `${isImage ? 'position:absolute' : 'position:relative'};left:${Math.round(g.x)}px;top:${Math.round(g.y)}px;` +
        (g.w ? `width:${Math.round(g.w)}px;` : '') + (g.h ? `height:${Math.round(g.h)}px;` : '') +
        (g.z !== undefined ? `z-index:${Math.round(g.z)};` : '') +
        (g.r !== undefined ? `transform:rotate(${Math.round(g.r)}deg);transform-origin:center center;` : '');
    }
    if (s) {
      if (s.color) style += `color:${s.color};`;
      if (s.bg) style += `background:${s.bg};`;
      if (s.borderColor) style += `border-color:${s.borderColor};`;
      if (s.fontSize) style += `font-size:${/^\d+$/.test(String(s.fontSize)) ? s.fontSize + 'px' : s.fontSize};`;
      if (s.fontWeight) style += `font-weight:${s.fontWeight};`;
      if (s.radius) style += `border-radius:${/^\d+$/.test(String(s.radius)) ? s.radius + 'px' : s.radius};`;
      if (s.padding) style += `padding:${/^\d+$/.test(String(s.padding)) ? s.padding + 'px' : s.padding};`;
      if (s.shadow) {
        const sh = { none: 'none', soft: '0 8px 24px rgba(0,0,0,.18)', deep: '0 22px 48px -12px rgba(0,0,0,.45)', glow: '0 0 28px color-mix(in srgb,var(--accent) 45%,transparent)' }[s.shadow] || s.shadow;
        style += `box-shadow:${sh};`;
      }
    }
    if (!style) return full;
    if (/style="/.test(rest)) {
      return `data-sf-id="${id}"${rest.replace(/style="/, `style="${style}`)}>`;
    }
    return `data-sf-id="${id}"${rest} style="${style}">`;
  });
}

/**
 * P0a per-slide image layer (docs/05): spec.image = { url, alt, fit, w? h? }.
 * Spec的照片 backend: one `<img>` only — no inline SVG, no object/embed (XSS
 * roast). Broken sources collapse into the neutral layer background instead
 * of showing a stretched broken-image glyph.
 */
export function renderImageLayer(spec) {
  const im = spec.image;
  if (!im || !im.url) return '';
  const dims = im.w > 0 && im.h > 0 ? ` width="${im.w}" height="${im.h}"` : '';
  return `
    <div class="sf-imglayer" data-sf-id="img" data-sf-slot="image" data-sf-role="image" data-sf-fit="${escAttr(im.fit)}" aria-label="${escAttr(im.alt || 'slide image')}">
      <img src="${escAttr(im.url)}" alt="${escAttr(im.alt || '')}" loading="eager" decoding="async"${dims} style="object-fit:${im.fit}" onerror="this.classList.add('is-broken')">
    </div>
  `;
}

function escAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderExtras(spec) {
  const extras = Array.isArray(spec.extras) ? spec.extras : [];
  return extras.map((e) => {
    const id = String(e?.id || '').slice(0, 64);
    const slot = String(e?.slot || id).slice(0, 64);
    const cls = String(e?.cls || 'sf-extra').slice(0, 64);
    const inner = escapeHtml(String(e?.text || e?.content || ''));
    if (!id) return '';
    return `<div class="${cls}" data-sf-id="${escAttr(id)}" data-sf-slot="${escAttr(slot)}" data-sf-extra="1">${inner}</div>`;
  }).join('');
}

export function renderSlideHtml(spec, opts = {}) {
  const fontBase = opts.fontBase ?? '/fonts/';
  const themeId = THEMES[spec.theme] ? spec.theme : 'midnight';
  const body = applyGeometry(renderLayout(spec) + renderImageLayer(spec) + renderExtras(spec), spec.geometry, spec.styles);
  const island = JSON.stringify(spec).replace(/</g, '\\u003c');
  const bridge = opts.includeBridge
    ? `<script src="${opts.bridgeSrc || '/bridge.js'}" defer></script>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1280,height=720">
<title>${escapeHtml(spec.title || 'Slide')}</title>
<style>${buildSlideCss(fontBase).replace(/\$\{FONT_STACK_DISPLAY\}/g, `var(--font-display,${FONT_STACK_DISPLAY})`).replace(/\$\{FONT_STACK_BODY\}/g, `var(--font-body,${FONT_STACK_BODY})`)}${themeVars(spec)}</style>
</head>
<body>
<div class="slide-container" data-sf-theme="${escapeHtml(themeId)}" data-sf-canvas="${escapeHtml(spec.canvasMode || 'standard')}" data-sf-archetype="${escapeHtml(spec.archetype)}" data-sf-page="${escapeHtml(spec.id)}">
${body}
</div>
<script id="slide-spec" type="application/json">${island}</script>
${bridge}
</body>
</html>`;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Sanitise HTML that we did NOT author (e.g. an imported Genspark slide) and
 * keep the spec island if present.
 */
export function sanitiseImportedSlide(html) {
  const cleaned = sanitize(html, { keepStyle: true, allowScript: false });
  return cleaned;
}
