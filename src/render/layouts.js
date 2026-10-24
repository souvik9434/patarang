/**
 * render/layouts.js — archetype renderers.
 *
 * The renderer owns ALL geometry. The LLM owns content only (invariant I5).
 * Every archetype is laid out on a fixed 12-column grid inside a 1280x720
 * canvas with a shared typographic scale, so output is deterministic and
 * consistent — the opposite of "generic AI cards".
 *
 * Elements that the editor can mutate carry `data-sf-id` + `data-sf-slot`
 * so the bridge can resolve a click to a spec slot without a vision model.
 */

import { THEMES } from '../spec.js';
import { sanitize } from '../sanitize.js';

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const W = (id, slot, cls, inner, extra = '') =>
  `<div class="${cls}" data-sf-id="${esc(id)}" data-sf-slot="${esc(slot)}"${extra ? ' ' + extra : ''}>${inner}</div>`;

function headBlock(spec) {
  if (spec.hideHeader) return '';
  const parts = [];
  if (spec.kicker) parts.push(W('kicker', 'kicker', 'sf-kicker', esc(spec.kicker)));
  if (spec.title) parts.push(W('title', 'title', 'sf-title', esc(spec.title)));
  if (spec.subtitle) parts.push(W('subtitle', 'subtitle', 'sf-subtitle', esc(spec.subtitle)));
  return parts.join('');
}

function toneClass(tone) {
  return { accent: 'is-accent', accent2: 'is-accent2', muted: 'is-muted' }[tone] || 'is-plain';
}

/* ----------------------------- archetypes ----------------------------- */

function hero(spec) {
  const c = spec.content;
  const pts = (c.points || []).filter(Boolean).map((p, i) =>
    W(`point${i}`, `points.${i}`, 'sf-point', `<span class="sf-bullet"></span><span>${esc(p)}</span>`)).join('');
  return `
    ${headBlock(spec)}
    ${c.lead ? W('lead', 'lead', 'sf-lead', esc(c.lead)) : ''}
    ${pts ? `<div class="sf-points">${pts}</div>` : ''}
  `;
}

function bento(spec) {
  const blocks = spec.content.blocks || [];
  const n = blocks.length;
  const gridCls = n <= 2 ? 'sf-grid-2' : n === 3 ? 'sf-grid-3' : 'sf-grid-4';
  const html = blocks.map((b, i) => {
    const big = n === 3 && i === 0 ? ' is-hero' : '';
    return W(`block${i}`, `blocks.${i}`, `sf-card sf-card--block ${toneClass(b.tone)}${big}`, `
      ${b.label ? `<div class="sf-card__label">${esc(b.label)}</div>` : ''}
      ${b.value ? `<div class="sf-card__value">${esc(b.value)}</div>` : ''}
      ${b.text ? `<div class="sf-card__text">${esc(b.text)}</div>` : ''}
    `);
  }).join('');
  return `
    ${headBlock(spec)}
    <div class="sf-grid ${gridCls}">${html}</div>
  `;
}

function metricTriple(spec) {
  const metrics = spec.content.metrics || [];
  const cls = metrics.length === 2 ? 'sf-grid-2' : metrics.length === 4 ? 'sf-grid-4' : 'sf-grid-3';
  const html = metrics.map((m, i) => W(`metric${i}`, `metrics.${i}`, 'sf-card sf-card--metric', `
    <div class="sf-metric__label">${esc(m.label)}</div>
    <div class="sf-metric__value">${esc(m.value)}</div>
    ${m.delta ? `<div class="sf-metric__delta ${m.positive ? 'is-up' : 'is-down'}">${esc(m.delta)}</div>` : ''}
  `)).join('');
  return `
    ${headBlock(spec)}
    <div class="sf-grid ${cls}">${html}</div>
  `;
}

function splitCompare(spec) {
  const side = (k, s) => W(k, k, `sf-col sf-col--${k}`, `
    ${s.label ? `<div class="sf-col__label">${esc(s.label)}</div>` : ''}
    ${s.head ? `<div class="sf-col__head">${esc(s.head)}</div>` : ''}
    ${s.text ? `<div class="sf-col__text">${esc(s.text)}</div>` : ''}
    ${(s.points || []).length ? `<ul class="sf-list">${s.points.map((p, i) =>
      `<li data-sf-id="${esc(k + 'p' + i)}" data-sf-slot="${esc(k + '.points.' + i)}"><span class="sf-bullet"></span>${esc(p)}</li>`).join('')}</ul>` : ''}
  `);
  return `
    ${headBlock(spec)}
    <div class="sf-split">${side('left', spec.content.left || {})}${side('right', spec.content.right || {})}</div>
  `;
}

function bullets(spec) {
  const items = spec.content.items || [];
  const html = items.map((it, i) => W(`item${i}`, `items.${i}`, 'sf-row', `
    <div class="sf-row__index">${String(i + 1).padStart(2, '0')}</div>
    <div class="sf-row__body">
      ${it.head ? `<div class="sf-row__head">${esc(it.head)}</div>` : ''}
      ${it.text ? `<div class="sf-row__text">${esc(it.text)}</div>` : ''}
    </div>
  `)).join('');
  return `
    ${headBlock(spec)}
    <div class="sf-rows">${html}</div>
  `;
}

function roadmap(spec) {
  const steps = spec.content.steps || [];
  const html = steps.map((s, i) => W(`step${i}`, `steps.${i}`, 'sf-step', `
    <div class="sf-step__dot">${i + 1}</div>
    ${s.label ? `<div class="sf-step__label">${esc(s.label)}</div>` : ''}
    ${s.head ? `<div class="sf-step__head">${esc(s.head)}</div>` : ''}
    ${s.text ? `<div class="sf-step__text">${esc(s.text)}</div>` : ''}
  `)).join('');
  return `
    ${headBlock(spec)}
    <div class="sf-steps">${html}</div>
  `;
}

function timeline(spec) {
  const events = spec.content.events || [];
  const html = events.map((e, i) => W(`event${i}`, `events.${i}`, 'sf-event', `
    <div class="sf-event__when">${esc(e.when)}</div>
    <div class="sf-event__body">
      ${e.head ? `<div class="sf-event__head">${esc(e.head)}</div>` : ''}
      ${e.text ? `<div class="sf-event__text">${esc(e.text)}</div>` : ''}
    </div>
  `)).join('');
  return `
    ${headBlock(spec)}
    <div class="sf-timeline">${html}</div>
  `;
}

function quote(spec) {
  const c = spec.content;
  return `
    ${headBlock(spec)}
    <div class="sf-card sf-quote-card">
      <div class="sf-quote__mark" aria-hidden="true">“</div>
      <blockquote class="sf-quote" data-sf-id="quote" data-sf-slot="quote">${esc(c.quote)}</blockquote>
      ${c.attribution ? `<div class="sf-quote__attr" data-sf-id="attribution" data-sf-slot="attribution">— ${esc(c.attribution)}</div>` : ''}
    </div>
  `;
}

function chart(spec) {
  const ch = spec.content.chart || { categories: [], series: [] };
  const cats = ch.categories || [];
  const series = ch.series || [];
  const unit = ch.unit || '';
  const colors = ['var(--accent)', 'var(--accent2)', 'var(--positive)'];
  const W_ = 1040, H_ = 250, padL = 72, padB = 36, padT = 26, padR = 24;
  const innerW = W_ - padL - padR, innerH = H_ - padB - padT;
  const max = Math.max(1, ...series.flatMap((s) => s.values.map((v) => Math.abs(Number(v) || 0))));
  const step = cats.length ? innerW / cats.length : innerW;

  const legend = series.map((s, si) =>
    `<span class="sf-chart__legitem"><span class="sf-chart__swatch" style="background:${colors[si % colors.length]}"></span>${esc(s.name || `Series ${si + 1}`)}</span>`).join('');

  let grid = '';
  for (let g = 0; g <= 4; g++) {
    const frac = g / 4;
    const y = (padT + innerH * (1 - frac)).toFixed(1);
    const val = Math.round(max * frac) + unit;
    grid += `<line x1="${padL}" y1="${y}" x2="${W_ - padR}" y2="${y}" stroke="var(--line)" stroke-width="1"></line>`;
    grid += `<text x="${padL - 12}" y="${(Number(y) + 4).toFixed(1)}" text-anchor="end" class="sf-chart__label">${esc(val)}</text>`;
  }

  let bars = '';
  if (ch.type === 'bar' || ch.type === 'donut') {
    const bw = Math.max(14, Math.min(54, (step * 0.64) / Math.max(1, series.length)));
    cats.forEach((cat, ci) => {
      series.forEach((s, si) => {
        const v = Math.abs(Number(s.values[ci]) || 0);
        const h = (v / max) * innerH;
        const x = padL + ci * step + (step - bw * series.length) / 2 + si * bw;
        const y = padT + innerH - h;
        const col = colors[si % colors.length];
        bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw - 4).toFixed(1)}" height="${Math.max(2, h).toFixed(1)}" rx="6" fill="${col}"></rect>`;
        bars += `<text x="${(x + (bw - 4) / 2).toFixed(1)}" y="${Math.max(14, y - 8).toFixed(1)}" text-anchor="middle" class="sf-chart__val">${esc(v + unit)}</text>`;
      });
    });
  } else {
    series.forEach((s, si) => {
      const col = colors[si % colors.length];
      const pts = s.values.map((v, i) => {
        const x = padL + i * step + step / 2;
        const y = padT + innerH - (Math.abs(Number(v) || 0) / max) * innerH;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(' ');
      bars += `<polyline points="${pts}" fill="none" stroke="${col}" stroke-width="3.5" stroke-linejoin="round"></polyline>`;
      s.values.forEach((v, i) => {
        const x = padL + i * step + step / 2;
        const y = padT + innerH - (Math.abs(Number(v) || 0) / max) * innerH;
        bars += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" fill="${col}"></circle>`;
        bars += `<text x="${x.toFixed(1)}" y="${Math.max(14, y - 10).toFixed(1)}" text-anchor="middle" class="sf-chart__val">${esc(v + unit)}</text>`;
      });
    });
  }
  const axis = cats.map((c, i) =>
    `<text x="${(padL + i * step + step / 2).toFixed(1)}" y="${(padT + innerH + 28).toFixed(1)}" text-anchor="middle" class="sf-chart__label">${esc(c)}</text>`).join('');

  return `
    ${headBlock(spec)}
    <div class="sf-card sf-chart-card" data-sf-id="chart" data-sf-slot="chart">
      <div class="sf-chart__legend">${legend}</div>
      <div class="sf-chart">
        <svg viewBox="0 0 ${W_} ${H_}" width="100%" height="${H_}" role="img" aria-label="chart">
          ${grid}${bars}${axis}
        </svg>
      </div>
    </div>
  `;
}

function imageText(spec) {
  const c = spec.content;
  const pts = (c.points || []).filter(Boolean).map((p, i) =>
    W(`ipoint${i}`, `points.${i}`, 'sf-point', `<span class="sf-bullet"></span><span>${esc(p)}</span>`)).join('');
  return `
    ${headBlock(spec)}
    <div class="sf-split sf-split--media">
      ${W('image', 'image', 'sf-media', c.image?.url
        ? `<img src="${esc(c.image.url)}" alt="${esc(c.image.alt || '')}" />`
        : `<div class="sf-media__ph"></div>`)}
      <div class="sf-media__text">
        ${c.text ? W('mtext', 'text', 'sf-lead', esc(c.text)) : ''}
        ${pts ? `<div class="sf-points">${pts}</div>` : ''}
      </div>
    </div>
  `;
}

function table(spec) {
  const tb = spec.content.table || { headers: [], rows: [] };
  const ths = (tb.headers || []).map((h, i) => `<th data-sf-id="th${i}" data-sf-slot="table.headers.${i}">${esc(h)}</th>`).join('');
  const trs = (tb.rows || []).map((row, rIdx) => {
    const tds = (row || []).map((cell, cIdx) => `<td data-sf-id="td_${rIdx}_${cIdx}" data-sf-slot="table.rows.${rIdx}.${cIdx}">${esc(cell)}</td>`).join('');
    return `<tr>${tds}</tr>`;
  }).join('');
  return `
    ${headBlock(spec)}
    <div class="sf-card sf-table-wrap" data-sf-id="table" data-sf-slot="table">
      <table class="sf-table">
        <thead><tr>${ths}</tr></thead>
        <tbody>${trs}</tbody>
      </table>
    </div>
  `;
}

function custom(spec) {
  const rawHtml = spec.content?.html || '';
  const safeInner = sanitize(rawHtml, { keepStyle: true, allowScript: false });
  return `
    ${headBlock(spec)}
    <div class="sf-custom" data-sf-id="custom" data-sf-slot="html">${safeInner}</div>
  `;
}

const RENDERERS = {
  hero, bento, 'metric-triple': metricTriple, 'split-compare': splitCompare, bullets,
  roadmap, timeline, quote, chart, 'image-text': imageText, table, custom,
};

export function renderLayout(spec) {
  const fn = RENDERERS[spec.archetype] || hero;
  return fn(spec);
}

export { THEMES };
