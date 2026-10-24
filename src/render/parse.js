/**
 * render/parse.js — HTML -> spec (tolerant) and spec slot mutation.
 *
 * Invariant I1: the HTML file is authoritative; the spec island is a CACHE.
 *   - island present + parseable  -> trust it (degraded: false)
 *   - island missing / corrupt     -> rebuild heuristically from the DOM and
 *                                     flag `degraded: true` (the UI then blocks
 *                                     saving until a human confirms).
 *
 * A silent overwrite is a data-corruption bug, so the parser never writes back
 * on its own — it only reports.
 */

import { normalizeSpec, ARCHETYPE_IDS } from '../spec.js';

const ISLAND_RE = /<script[^>]*id=["']slide-spec["'][^>]*>([\s\S]*?)<\/script>/i;

export function extractSpecIsland(html) {
  const m = ISLAND_RE.exec(String(html || ''));
  if (!m) return null;
  const raw = m[1].replace(/\\u003c/g, '<').replace(/<\//g, '<\\/');
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function stripTags(s) {
  return String(s || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function pick(html, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(html))) {
    const t = stripTags(m[1]);
    if (t) out.push(t);
  }
  return out;
}

/** Heuristic reconstruction — deliberately conservative. */
export function specFromHtml(html) {
  const src = String(html || '');
  const issues = [];
  const headings = [...pick(src, 'h1'), ...pick(src, 'h2')];
  const paragraphs = pick(src, 'p');
  const listItems = pick(src, 'li');

  const raw = {
    archetype: 'hero',
    title: headings[0] || (paragraphs[0] || 'Imported slide').slice(0, 80),
    subtitle: headings[1] || '',
    points: [...listItems, ...paragraphs].slice(0, 5),
    notes: '',
    theme: 'sand',
  };
  // P0a recovery: the first /media/ image survives even without a spec island.
  const imgTag = src.match(/<img[^>]+src="\/media\/[\w-]+\/[A-Za-z0-9._-]+"[^>]*>/i);
  if (imgTag) {
    const tag = imgTag[0];
    const uM = tag.match(/src="(\/media\/[\w-]+\/[A-Za-z0-9._-]+)"/i);
    const aM = tag.match(/\balt="([^"]*)"/i);
    if (uM) raw.image = { url: uM[1], alt: aM ? aM[1] : '', fit: 'contain' };
  }
  if (!headings.length && !paragraphs.length && !listItems.length) {
    issues.push('no readable content found');
  }
  const { spec } = normalizeSpec(raw, { index: 0 });
  return { spec, degraded: true, issues };
}

/**
 * Parse a slide HTML document into a spec.
 * @returns {{spec:object, degraded:boolean, issues:string[]}}
 */
export function parseSlideHtml(html) {
  const island = extractSpecIsland(html);
  if (island && ARCHETYPE_IDS.includes(island.archetype)) {
    const { spec, issues } = normalizeSpec(island, { id: island.id, index: island.index ?? 0 });
    return { spec, degraded: false, issues };
  }
  const { spec, degraded, issues } = specFromHtml(html);
  return { spec, degraded, issues: [...issues, 'spec island missing or invalid — reconstructed heuristically'] };
}

/* --------------------------- slot access --------------------------- */

export function getSlot(spec, slot) {
  if (!slot) return undefined;
  const parts = String(slot).split('.');
  if (parts[0] === 'title' || parts[0] === 'subtitle' || parts[0] === 'kicker' || parts[0] === 'notes') {
    return spec[parts[0]];
  }
  let node = spec.content?.[parts[0]];
  for (let i = 1; i < parts.length && node != null; i++) {
    node = node[parts[i]];
  }
  return node;
}

/**
 * Immutably set a slot value. Supports `blocks.0.text`, `points.2`,
 * `title`, `chart.series.0.values.1`.
 */
export function setSlot(spec, slot, value) {
  const parts = String(slot || '').split('.');
  const clone = structuredClone(spec);
  if (parts.length === 1 && ['title', 'subtitle', 'kicker', 'notes', 'theme'].includes(parts[0])) {
    clone[parts[0]] = value;
    return clone;
  }
  const root = parts[0];
  if (!clone.content || !(root in clone.content)) return clone;
  let node = clone.content[root];
  for (let i = 1; i < parts.length - 1; i++) {
    if (node == null) return clone;
    node = node[parts[i]];
  }
  const last = parts[parts.length - 1];
  if (node && typeof node === 'object') node[last] = value;
  return clone;
}

/** All editable slots of a spec, for the inspector UI. */
export function listSlots(spec) {
  const out = [];
  for (const key of ['kicker', 'title', 'subtitle', 'notes']) {
    if (spec[key]) out.push({ slot: key, label: key, value: spec[key], kind: 'text' });
  }
  const c = spec.content || {};
  const walk = (node, prefix) => {
    if (node == null) return;
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, `${prefix}.${i}`));
    } else if (typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) walk(v, prefix ? `${prefix}.${k}` : k);
    } else {
      out.push({ slot: prefix, label: prefix, value: node, kind: typeof node === 'number' ? 'number' : 'text' });
    }
  };
  walk(c, '');
  return out;
}
