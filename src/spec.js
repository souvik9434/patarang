/**
 * spec.js — the AI-facing slide specification.
 *
 * The LLM NEVER emits HTML (roast C5 / invariant I5). It emits *data* that
 * conforms to this module's shape; `src/render/layouts.js` owns all geometry.
 *
 * This module is also the single place that knows:
 *   - which archetypes exist and what content each one requires
 *   - the typographic / text budgets (the anti-"wall of text" contract)
 *   - the theme palettes
 *   - how to normalise + validate an LLM response into a legal spec
 */

export const THEMES = {
  midnight: {
    label: 'Midnight',
    bg: '#0b1120', bgAlt: '#111a2e', surface: '#16213a', surfaceAlt: '#1d2b48',
    ink: '#f8fafc', muted: '#94a3b8', accent: '#60a5fa', accent2: '#a78bfa',
    line: 'rgba(148,163,184,.22)', positive: '#34d399',
  },
  aurora: {
    label: 'Aurora',
    bg: 'linear-gradient(135deg,#0f2027 0%,#203a43 55%,#2c5364 100%)', bgAlt: '#16232b',
    surface: 'rgba(255,255,255,.06)', surfaceAlt: 'rgba(255,255,255,.10)',
    ink: '#f1f7f9', muted: '#a9c0c9', accent: '#5eead4', accent2: '#f0abfc',
    line: 'rgba(255,255,255,.16)', positive: '#86efac',
  },
  sand: {
    label: 'Sand',
    bg: '#faf7f2', bgAlt: '#f3ede4', surface: '#ffffff', surfaceAlt: '#efe7db',
    ink: '#1c1917', muted: '#78716c', accent: '#c2410c', accent2: '#0f766e',
    line: 'rgba(28,25,23,.14)', positive: '#15803d',
  },
  cobalt: {
    label: 'Cobalt',
    bg: '#f5f8ff', bgAlt: '#e8eeff', surface: '#ffffff', surfaceAlt: '#dde6ff',
    ink: '#0b1220', muted: '#5b6478', accent: '#1d4ed8', accent2: '#0891b2',
    line: 'rgba(11,18,32,.12)', positive: '#047857',
  },
  mono: {
    label: 'Mono',
    bg: '#111111', bgAlt: '#1c1c1c', surface: '#1f1f1f', surfaceAlt: '#262626',
    ink: '#fafafa', muted: '#a3a3a3', accent: '#fafafa', accent2: '#a3a3a3',
    line: 'rgba(250,250,250,.18)', positive: '#e5e5e5',
  },
  ember: {
    label: 'Ember',
    bg: '#1a0f0a', bgAlt: '#2a1710', surface: '#2c1a13', surfaceAlt: '#3a231a',
    ink: '#fff7ed', muted: '#c4a184', accent: '#fb923c', accent2: '#f472b6',
    line: 'rgba(255,247,237,.16)', positive: '#4ade80',
  },
  ivory: {
    label: 'Ivory Editorial',
    bg: 'linear-gradient(135deg,#fdfcfb 0%,#f5efe6 100%)', bgAlt: '#efe8dc', surface: 'rgba(255,255,255,.92)', surfaceAlt: '#f4ede2',
    ink: '#14281d', muted: '#52665b', accent: '#0f5132', accent2: '#b45309',
    line: 'rgba(20,40,29,.14)', positive: '#15803d',
  },
  rose: {
    label: 'Rose Luxury',
    bg: 'linear-gradient(135deg,#fff5f7 0%,#fce7f3 55%,#fae8ff 100%)', bgAlt: '#fbcfe8', surface: 'rgba(255,255,255,.92)', surfaceAlt: '#fdf2f8',
    ink: '#3b0724', muted: '#831843', accent: '#be185d', accent2: '#7e22ce',
    line: 'rgba(131,24,67,.15)', positive: '#047857',
  },
  emerald: {
    label: 'Emerald Botanical',
    bg: 'linear-gradient(135deg,#ecfdf5 0%,#d1fae5 55%,#e0f2fe 100%)', bgAlt: '#d1fae5', surface: 'rgba(255,255,255,.92)', surfaceAlt: '#ecfdf5',
    ink: '#062c21', muted: '#276749', accent: '#047857', accent2: '#0369a1',
    line: 'rgba(6,44,33,.14)', positive: '#15803d',
  },
  amber: {
    label: 'Amber Solar',
    bg: 'linear-gradient(135deg,#fffbeb 0%,#fef3c7 55%,#ffedd5 100%)', bgAlt: '#fde68a', surface: 'rgba(255,255,255,.94)', surfaceAlt: '#fff7ed',
    ink: '#291505', muted: '#78350f', accent: '#d97706', accent2: '#4338ca',
    line: 'rgba(120,53,15,.15)', positive: '#15803d',
  },
};

export const THEME_IDS = Object.keys(THEMES);

export const FONT_PAIRS = {
  modern: {
    label: 'Modern Geometric',
    display: `'Poppins','Segoe UI',system-ui,-apple-system,sans-serif`,
    body: `'Inter var','Inter','Segoe UI',system-ui,-apple-system,sans-serif`,
  },
  editorial: {
    label: 'Editorial Serif',
    display: `Georgia,'Times New Roman',serif`,
    body: `'Inter var','Inter','Segoe UI',system-ui,-apple-system,sans-serif`,
  },
  technical: {
    label: 'Technical Mono',
    display: `'Poppins','Segoe UI',system-ui,sans-serif`,
    body: `ui-monospace,'Cascadia Code','Consolas',monospace`,
  },
  bold: {
    label: 'Bold Keynote',
    display: `'Poppins','Impact','Arial Black',sans-serif`,
    body: `'Poppins','Segoe UI',system-ui,sans-serif`,
  },
};

export const FONT_PAIR_IDS = Object.keys(FONT_PAIRS);
export const CANVAS_MODES = ['standard', 'full-bleed', 'centered'];

/**
 * Archetype contract.
 *  slots   – content keys the archetype consumes
 *  budget  – hard word budgets per slot (anti-wall-of-text)
 *  variant – true when the archetype is a thin data-driven variant of a base one
 */
export const ARCHETYPES = {
  hero: {
    label: 'Hero',
    slots: ['lead', 'points'],
    budget: { title: 8, subtitle: 22, lead: 26, points: 14 },
    max: { points: 3 },
    base: null,
  },
  bento: {
    label: 'Bento',
    slots: ['blocks'],
    budget: { title: 8, subtitle: 18, label: 3, value: 6, text: 16 },
    max: { blocks: 4 },
    base: null,
  },
  'metric-triple': {
    label: 'Metric row',
    slots: ['metrics'],
    budget: { title: 8, subtitle: 16, label: 4, value: 4, delta: 5 },
    max: { metrics: 4 },
    base: null,
  },
  'split-compare': {
    label: 'Split compare',
    slots: ['left', 'right'],
    budget: { title: 8, label: 3, head: 6, points: 12 },
    max: { points: 4 },
    base: null,
  },
  bullets: {
    label: 'Bullets',
    slots: ['items'],
    budget: { title: 8, subtitle: 18, head: 6, text: 16 },
    max: { items: 5 },
    base: null,
  },
  roadmap: {
    label: 'Roadmap',
    slots: ['steps'],
    budget: { title: 8, label: 3, head: 6, text: 14 },
    max: { steps: 5 },
    base: 'bento',
    variant: true,
  },
  timeline: {
    label: 'Timeline',
    slots: ['events'],
    budget: { title: 8, when: 3, head: 6, text: 14 },
    max: { events: 5 },
    base: 'split-compare',
    variant: true,
  },
  quote: {
    label: 'Quote',
    slots: ['quote', 'attribution'],
    budget: { title: 8, quote: 34, attribution: 10 },
    base: 'hero',
    variant: true,
  },
  chart: {
    label: 'Chart',
    slots: ['chart'],
    budget: { title: 8, subtitle: 16, categories: 3 },
    base: 'bento',
    variant: true,
  },
  'image-text': {
    label: 'Image + text',
    slots: ['image', 'points'],
    budget: { title: 8, subtitle: 20, text: 20, points: 14 },
    base: 'hero',
    variant: true,
  },
  table: {
    label: 'Table matrix',
    slots: ['table'],
    budget: { title: 8, subtitle: 20, cell: 12 },
    base: 'bento',
    variant: true,
  },
  custom: {
    label: 'Custom composition',
    slots: ['html'],
    budget: { title: 8, subtitle: 24 },
    base: null,
  },
};

export const ARCHETYPE_IDS = Object.keys(ARCHETYPES);

/** Base archetypes that must be implemented at full quality (roast C4). */
export const CORE_ARCHETYPES = ['hero', 'bento', 'metric-triple', 'split-compare', 'bullets'];

/* ------------------------------------------------------------------ */
/* helpers                                                            */
/* ------------------------------------------------------------------ */

export const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;

export function clampWords(text, max) {
  const t = String(text || '').trim();
  if (!t) return '';
  if (words(t) <= max) return t;
  const parts = t.split(/\s+/);
  return parts.slice(0, max).join(' ') + '…';
}

export function clampList(list, max) {
  return Array.isArray(list) ? list.slice(0, max) : [];
}

function str(v, max) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  if (typeof v !== 'string') return '';
  return max ? clampWords(v, max) : v.trim();
}

/* M-ACC provenance ledger (docs/06 Block 1). Sources a provenance entry can
 * legally carry; slot-path shaped keys only; hard length caps; junk dropped.
 * Provenance NEVER comes from model output — orchestrator strips it from raw
 * model objects before normalizeSpec — it enters via server-side attach,
 * manual-edit diff, or this island round-trip only. */
export const PROVENANCE_SOURCES = ['ai', 'ai:gen', 'ai:rewrite', 'user', 'import'];
const SLOT_PATH_RE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+){0,3}$/;

function preserveProvenance(rawProv) {
  if (!rawProv || typeof rawProv !== 'object' || Array.isArray(rawProv)) return null;
  const out = {};
  for (const [k, v] of Object.entries(rawProv)) {
    if (!SLOT_PATH_RE.test(k) || !v || typeof v !== 'object' || Array.isArray(v)) continue;
    const source = String(v.source || '');
    if (!PROVENANCE_SOURCES.includes(source)) continue;
    out[k] = {
      source,
      ref: String(v.ref || '').slice(0, 64),
      confidence: Math.min(1, Math.max(0, Number(v.confidence) || 0)),
      at: String(v.at || '').slice(0, 32),
    };
    if (Object.keys(out).length >= 40) break;
  }
  return Object.keys(out).length ? out : null;
}

/** Notes: generation prose clamps to the 120-word budget, but an appended
 * verification ledger block ([verify …] lines, docs/06 Block 2) is preserved
 * verbatim up to 2000 chars — island round-trips may not eat verification. */
function clampNotes(v) {
  const s = str(v, 0);
  const at = s.lastIndexOf('[verify ');
  if (at === -1) return clampWords(s, 120);
  const head = clampWords(s.slice(0, at).trimEnd(), 120);
  const ledger = s.slice(at, at + 2000).trimEnd();
  return (head ? head + '\n' : '') + ledger;
}

/**
 * Normalise an arbitrary (LLM-produced) object into a legal SlideSpec.
 * Never throws; collects issues so the caller can log / re-prompt.
 */
export function normalizeSpec(raw, { id = '', index = 0 } = {}) {
  const issues = [];
  const r = raw && typeof raw === 'object' ? raw : {};

  let archetype = String(r.archetype || r.layout || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (!ARCHETYPE_IDS.includes(archetype)) {
    const guess = guessArchetype(r);
    issues.push(`unknown archetype "${r.archetype}" -> ${guess}`);
    archetype = guess;
  }
  const A = ARCHETYPES[archetype];

  const spec = {
    id: id || String(r.id || `pg_${index}`),
    index,
    archetype,
    theme: THEME_IDS.includes(r.theme) ? r.theme : 'midnight',
    fontPair: FONT_PAIR_IDS.includes(r.fontPair) ? r.fontPair : 'modern',
    canvasMode: CANVAS_MODES.includes(r.canvasMode) ? r.canvasMode : 'standard',
    ...(r.hideHeader === true ? { hideHeader: true } : {}),
    kicker: str(r.kicker, 7),
    title: str(r.title, A.budget.title),
    subtitle: str(r.subtitle ?? r.lead, A.budget.subtitle),
    notes: clampNotes(r.notes),
    sources: Array.isArray(r.sources) ? r.sources.slice(0, 6).map((s) => String(s).slice(0, 220)) : [],
    content: {},
  };

  const c = r.content && typeof r.content === 'object' ? r.content : r;
  const B = A.budget;

  switch (archetype) {
    case 'hero':
      spec.content = {
        lead: str(c.lead ?? c.subtitle, B.lead),
        points: clampList(c.points ?? c.bullets, A.max.points).map((p) => str(p, B.points)),
      };
      break;
    case 'bento':
      spec.content = {
        blocks: clampList(c.blocks, A.max.blocks).map((b) => ({
          label: str(b.label ?? b.title, B.label),
          value: str(b.value ?? b.metric, B.value),
          text: str(b.text ?? b.body ?? b.description, B.text),
          tone: ['accent', 'accent2', 'muted', 'plain'].includes(b.tone) ? b.tone : 'plain',
        })),
      };
      break;
    case 'metric-triple':
      spec.content = {
        metrics: clampList(c.metrics, A.max.metrics).map((m) => ({
          label: str(m.label, B.label),
          value: str(m.value, B.value),
          delta: str(m.delta, B.delta),
          positive: m.positive !== false,
        })),
      };
      break;
    case 'split-compare':
      spec.content = {
        left: sideOf(c.left, B),
        right: sideOf(c.right, B),
      };
      break;
    case 'bullets':
      spec.content = {
        items: clampList(c.items, A.max.items).map((it) => ({
          head: str(it.head ?? it.title, B.head),
          text: str(it.text ?? it.body, B.text),
        })),
      };
      break;
    case 'roadmap':
      spec.content = {
        steps: clampList(c.steps, A.max.steps).map((s) => ({
          label: str(s.label ?? s.phase, B.label),
          head: str(s.head ?? s.title, B.head),
          text: str(s.text, B.text),
        })),
      };
      break;
    case 'timeline':
      spec.content = {
        events: clampList(c.events, A.max.events).map((e) => ({
          when: str(e.when ?? e.date, B.when),
          head: str(e.head ?? e.title, B.head),
          text: str(e.text, B.text),
        })),
      };
      break;
    case 'quote':
      spec.content = {
        quote: str(c.quote, B.quote),
        attribution: str(c.attribution, B.attribution),
      };
      break;
    case 'chart': {
      const ch = c.chart || {};
      const cats = clampList(ch.categories, 8).map((x) => str(x, 6));
      const series = clampList(ch.series, 3).map((s) => ({
        name: str(s.name, 6),
        values: clampList(s.values, 8).map((v) => (Number.isFinite(Number(v)) ? Number(v) : 0)),
      }));
      const cType = ['line', 'donut', 'bar'].includes(ch.type) ? ch.type : 'bar';
      spec.content = { chart: { type: cType, unit: str(ch.unit, 3), categories: cats, series } };
      break;
    }
    case 'image-text':
      spec.content = {
        image: { url: str(c.image?.url, 400), alt: str(c.image?.alt, 12) },
        text: str(c.text, B.text),
        points: clampList(c.points, 4).map((p) => str(p, B.points)),
      };
      break;
    case 'table': {
      const tb = c.table || c;
      const headers = clampList(tb.headers, 6).map((h) => str(h, 6));
      const rows = clampList(tb.rows, 7).map((row) => clampList(row, 6).map((cell) => str(cell, B.cell)));
      spec.content = { table: { headers, rows } };
      break;
    }
    case 'custom':
      spec.content = {
        html: typeof c.html === 'string' ? c.html.slice(0, 24000) : '',
      };
      break;
    default:
      spec.content = {};
  }

  /* Preserve custom brand palette overrides (docs/10 Block 1, CSS-injection safe). */
  if (r.palette && typeof r.palette === 'object' && !Array.isArray(r.palette)) {
    const SAFE_COLOR = /^(#[0-9a-fA-F]{3,8}|rgba?\([0-9.,\s%]+\)|(linear|radial)-gradient\([a-zA-Z0-9#.,\s%-]+\))$/;
    const pal = {};
    for (const k of ['bg', 'bgAlt', 'surface', 'surfaceAlt', 'ink', 'muted', 'accent', 'accent2', 'line', 'positive']) {
      const val = typeof r.palette[k] === 'string' ? r.palette[k].trim() : '';
      if (val && val.length <= 160 && SAFE_COLOR.test(val)) pal[k] = val;
    }
    if (Object.keys(pal).length) spec.palette = pal;
  }

  /* Preserve per-element visual styles (docs/11 CS.4): { "<sfId>": { color, bg, fontSize, fontWeight, radius, shadow, padding, text } }. */
  if (r.styles && typeof r.styles === 'object' && !Array.isArray(r.styles)) {
    const SAFE_VAL = /^[a-zA-Z0-9#.,\s%()-]+$/;
    const st = {};
    for (const [k, v] of Object.entries(r.styles)) {
      if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
      const item = {};
      for (const prop of ['color', 'bg', 'fontSize', 'fontWeight', 'radius', 'shadow', 'padding', 'borderColor']) {
        const val = typeof v[prop] === 'string' || typeof v[prop] === 'number' ? String(v[prop]).trim() : '';
        if (val && val.length <= 120 && SAFE_VAL.test(val)) item[prop] = val;
      }
      if (typeof v.text === 'string') item.text = v.text.slice(0, 400);
      if (Object.keys(item).length) st[String(k).slice(0, 64)] = item;
      if (Object.keys(st).length >= 60) break;
    }
    if (Object.keys(st).length) spec.styles = st;
  }

  /* Preserve editor geometry (M4): { "<sfId>": { x, y, w, h, r?, z? } }.
   * OFFSET MODEL (2026-10-23): x/y are deltas from the element's natural flow
   * slot (rendered with position:relative), so a move never reflows siblings.
   * Decks written before the switch carry absolute coordinates and are reset
   * once — see geomMode below. */
  const OFFSET_MODE = r.geomMode === 'offset';
  if (r.geometry && typeof r.geometry === 'object' && !Array.isArray(r.geometry) && OFFSET_MODE) {
    const geo = {};
    for (const [k, v] of Object.entries(r.geometry)) {
      if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
      if (!Number.isFinite(Number(v.x)) || !Number.isFinite(Number(v.y))) continue;
      const rect = { x: Math.round(Number(v.x)), y: Math.round(Number(v.y)) };
      if (Number.isFinite(Number(v.w))) rect.w = Math.round(Number(v.w));
      if (Number.isFinite(Number(v.h))) rect.h = Math.round(Number(v.h));
      if (Number.isFinite(Number(v.z))) rect.z = Math.round(Number(v.z));
      if (Number.isFinite(Number(v.r))) rect.r = Math.round(Number(v.r));
      geo[String(k).slice(0, 64)] = rect;
    }
    if (Object.keys(geo).length) spec.geometry = geo;
  }

  /* Preserve editor extras (duplicated elements): array of { id, slot, cls, text }. */
  if (Array.isArray(r.extras)) {
    const extras = r.extras.filter((e) => e && typeof e === 'object' && e.id).map((e) => ({
      id: String(e.id).slice(0, 64),
      slot: String(e.slot || e.id).slice(0, 64),
      cls: String(e.cls || 'sf-extra').slice(0, 64),
      text: String(e.text || e.content || '').slice(0, 200),
    }));
    if (extras.length) spec.extras = extras;
  }

  /* Offset model marker: any deck written before 2026-10-23 stored absolute
   * canvas coords. Without this flag geometry was applied as position:absolute,
   * which pulled elements out of flow and made siblings collapse into their
   * slot. Fresh saves carry the flag, so legacy geometry resets exactly once. */
  spec.geomMode = 'offset';

  /* Preserve the slide image (P0a): { url, alt, fit }.
   * URL must be a local /media/<deck>/<file> path (server-stored, sprayed
   * nowhere else) — remote http(s) srcs only arrive via the import path and
   * are flagged, never silently rendered (docs/05 closed spec). */
  const ri = r.image;
  if (ri && typeof ri === 'object' && !Array.isArray(ri)) {
    const iUrl = str(ri.url, 400);
    if (iUrl) {
      if (/^\/media\/[\w-]+\/[A-Za-z0-9._-]+$/.test(iUrl)) {
        spec.image = {
          url: iUrl,
          alt: String(ri.alt ?? '').slice(0, 200).trim(),
          fit: ['contain', 'cover', 'fill'].includes(ri.fit) ? ri.fit : 'contain',
          ...(Number.isFinite(Number(ri.w)) && Number(ri.w) > 0 ? { w: Math.round(Number(ri.w)) } : {}),
          ...(Number.isFinite(Number(ri.h)) && Number(ri.h) > 0 ? { h: Math.round(Number(ri.h)) } : {}),
        };
        spec.geometry = { ...(spec.geometry || {}) };
        if (!spec.geometry.img) {
          spec.geometry.img = { x: 688, y: 80, w: 520, h: 560 }; // deterministic right-side default
        }
      } else {
        issues.push(`image url rejected (must be /media/<deck>/<file>): ${iUrl.slice(0, 60)}`);
      }
    } else if (ri.fit !== undefined || ri.alt !== undefined) {
      // image object present but empty url = an explicit "remove" — nothing to keep
    }
  }

  /* Preserve the provenance ledger (M-ACC): sanitized side-band — survives
   * island round-trips the same way geometry and image do. */
  const prov = preserveProvenance(r.provenance);
  if (prov) spec.provenance = prov;

  const fill = missingContent(spec);
  if (fill.length) issues.push(`empty content slots: ${fill.join(', ')}`);
  return { spec, issues };
}

function sideOf(side, B) {
  const s = side && typeof side === 'object' ? side : {};
  return {
    label: str(s.label, B.label),
    head: str(s.head ?? s.title, B.head),
    text: str(s.text, B.text),
    points: clampList(s.points ?? s.bullets, 4).map((p) => str(p, B.points)),
  };
}

function missingContent(spec) {
  const A = ARCHETYPES[spec.archetype];
  const missing = [];
  if (!spec.title) missing.push('title');
  for (const key of A.slots) {
    const v = spec.content[key];
    if (Array.isArray(v)) { if (!v.length) missing.push(key); }
    else if (v && typeof v === 'object') {
      if (key === 'chart') { if (!v.categories?.length || !v.series?.length) missing.push('chart'); }
      else if (key === 'table') { if (!v.headers?.length || !v.rows?.length) missing.push('table'); }
      else if (key === 'left' || key === 'right') { if (!v.head && !v.text && !v.points?.length) missing.push(key); }
      else if (key === 'image') { if (!v.url && !spec.content.points?.length) missing.push('image'); }
      else if (!Object.keys(v).length) missing.push(key);
    } else if (!v) missing.push(key);
  }
  return missing;
}

export function guessArchetype(r) {
  const c = r.content || r;
  if (c.metrics || c.blocks?.some?.((b) => b.value != null)) return 'metric-triple';
  if (c.blocks) return 'bento';
  if (c.left || c.right) return 'split-compare';
  if (c.events) return 'timeline';
  if (c.steps) return 'roadmap';
  if (c.chart) return 'chart';
  if (c.quote) return 'quote';
  if (c.items) return 'bullets';
  return 'hero';
}

/** Hard validation used by the orchestrator before a slide is accepted. */
export function validateSpec(spec) {
  const issues = [];
  const A = ARCHETYPES[spec.archetype];
  if (!A) { issues.push({ level: 'error', msg: `unknown archetype ${spec.archetype}` }); return { ok: false, issues }; }
  if (!spec.title) issues.push({ level: 'error', msg: 'missing title' });
  if (words(spec.title) > A.budget.title) issues.push({ level: 'warn', msg: `title over budget (${words(spec.title)} > ${A.budget.title})` });
  for (const key of A.slots) {
    const v = spec.content[key];
    if (Array.isArray(v) && !v.length) issues.push({ level: 'error', msg: `empty slot ${key}` });
    if ((v === undefined || v === null || v === '') && key !== 'quote') issues.push({ level: 'error', msg: `empty slot ${key}` });
  }
  if (spec.archetype === 'chart') {
    const ch = spec.content.chart;
    for (const s of ch.series || []) {
      if (s.values.length !== ch.categories.length) issues.push({ level: 'error', msg: `chart series "${s.name}" length mismatch` });
    }
  }
  const errs = issues.filter((i) => i.level === 'error');
  return { ok: errs.length === 0, issues };
}

/** Machine-readable archetype catalogue for the LLM system prompt. */
export function archetypeCatalogue() {
  return CORE_ARCHETYPES.map((id) => {
    const A = ARCHETYPES[id];
    return {
      archetype: id,
      label: A.label,
      required_slots: A.slots,
      max_items: A.max,
      word_budgets: A.budget,
    };
  });
}
