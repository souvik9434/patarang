/**
 * ai/orchestrator.js — the generation pipeline.
 *
 * Four PURE, independently callable steps (roast C5). Each returns data only;
 * rendering to HTML happens in step 3 through the deterministic renderer.
 *
 *   1. planOutline(brief)        -> {title, narrative, slides:[{title,archetype,purpose}]}
 *   2. planSlides(outline)        -> [SlideSpec]
 *   3. renderSlides(specs)        -> [{page_id, content(html), spec}]
 *   4. verifyDeck(slides)         -> [{claim, verdict, confidence, note}]
 *
 * The SSE endpoint streams step boundaries so the UI can show real progress.
 */

import { archetypeCatalogue, normalizeSpec, validateSpec, ARCHETYPE_IDS, CORE_ARCHETYPES, THEMES, THEME_IDS } from '../spec.js';
import { renderSlideHtml } from '../render/slide-html.js';
import { newId } from '../schema.js';
import { schemaForKind, VERIFY2_SCHEMA } from './schemas.js';
import { listSlots } from '../render/parse.js';

export function extractJson(text) {
  if (typeof text !== 'string') return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.search(/[[{]/);
  if (start === -1) return null;
  // scan for balanced JSON
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  const slice = end === -1 ? raw.slice(start) : raw.slice(start, end);
  try { return JSON.parse(slice); } catch { return null; }
}

const SYSTEM = `You are SlideForge's deck architect. You output STRICT JSON only (no markdown fences, no prose).

Design rules you must obey:
- One narrative arc. Each slide advances it; no slide repeats another.
- Choose ONLY these archetypes: ${CORE_ARCHETYPES.join(', ')}.
- Never invent numbers that are not supplied by the brief. Use placeholders like "—" if unknown.
- Headlines <= 8 words. Body text <= 18 words. No paragraphs.
- Tone: concrete, decision-oriented, zero marketing fluff.

Archetype contracts:
${JSON.stringify(archetypeCatalogue(), null, 2)}`;

/* ------------------------------ step 1 ------------------------------ */

export async function planOutline(provider, brief, { slides = 8, theme = 'midnight' } = {}) {
  const user = JSON.stringify({
    brief,
    slide_count: slides,
    theme,
    task: 'Return {"title": string, "narrative": string, "slides": [{"index": number, "title": string, "archetype": string, "purpose": string}]}',
  });
  const res = await provider.complete({ system: SYSTEM, user, kind: 'outline', schema: schemaForKind('outline') });
  const json = extractJson(res.text);
  const planned = (json?.slides || []).slice(0, Math.max(3, Math.min(14, slides)));
  return {
    title: String(json?.title || brief.slice(0, 60)).slice(0, 120),
    narrative: String(json?.narrative || '').slice(0, 400),
    slides: planned.map((s, i) => ({
      index: i,
      title: String(s.title || `Slide ${i + 1}`).slice(0, 90),
      archetype: ARCHETYPE_IDS.includes(s.archetype) ? s.archetype : CORE_ARCHETYPES[i % CORE_ARCHETYPES.length],
      purpose: String(s.purpose || '').slice(0, 220),
    })),
    usage: res.usage || {},
  };
}

/* ------------------------------ step 2 ------------------------------ */

export async function planSlides(provider, outline, { theme = 'midnight' } = {}) {
  const user = JSON.stringify({
    task: 'Return {"slides": [ <spec> ] } — one spec per planned slide, in order.',
    outline,
    theme,
    spec_shape: {
      archetype: 'one of ' + ARCHETYPE_IDS.join('|'),
      title: 'string',
      kicker: 'string (2-4 words, uppercase ok)',
      subtitle: 'string',
      content: 'archetype-specific: see contracts above',
    },
  });
  const res = await provider.complete({ system: SYSTEM, user, kind: 'slides', schema: schemaForKind('slides') });
  const json = extractJson(res.text);
  const rawSlides = Array.isArray(json?.slides) ? json.slides : [];
  const specs = [];
  const issues = [];
  rawSlides.forEach((raw, i) => {
    const plan = outline.slides[i] || {};
    // M-ACC spoof strip (docs/06 Block 1): model output NEVER owns provenance.
    const { provenance: _declared, ...clean } = raw && typeof raw === 'object' ? raw : {};
    void _declared;
    const { spec, issues: iss } = normalizeSpec({ ...clean, title: clean.title || plan.title, archetype: clean.archetype || plan.archetype, theme: clean.theme || theme }, { index: i });
    const v = validateSpec(spec);
    if (!v.ok) issues.push(`slide ${i + 1}: ${v.issues.filter((x) => x.level === 'error').map((x) => x.msg).join('; ')}`);
    spec.id = spec.id || newId('pg');
    spec.theme = THEME_IDS.includes(spec.theme) ? spec.theme : theme;
    attachProvenance(spec, { source: 'ai:gen', ref: 'pipeline:planSlides', confidence: 0.8 });
    specs.push(spec);
  });
  return { specs, issues, usage: res.usage || {} };
}

/* ------------------------------ step 3 ------------------------------ */

export function renderSlides(specs, { fontBase = '/fonts/' } = {}) {
  return specs.map((spec, i) => ({
    page_id: spec.id || newId('pg'),
    index: i,
    spec,
    content: renderSlideHtml({ ...spec, id: spec.id || newId('pg') }, { fontBase }),
  }));
}

/* ------------------------------ step 4 ------------------------------ */

export async function verifyDeck(provider, specs) {
  const claims = [];
  for (const s of specs) {
    const texts = [];
    if (s.title) texts.push(s.title);
    const c = s.content || {};
    for (const key of ['lead', 'text']) if (c[key]) texts.push(c[key]);
    for (const arr of ['points', 'items', 'bullets']) if (Array.isArray(c[arr])) texts.push(...c[arr].map((x) => (typeof x === 'string' ? x : x?.text || '')));
    for (const b of c.blocks || []) texts.push(b.text, b.value);
    for (const m of c.metrics || []) texts.push(m.value, m.delta);
    for (const t of texts) {
      const t2 = String(t || '').trim();
      if (/\d/.test(t2) && t2.length >= 2) claims.push(t2);
    }
  }
  if (!claims.length) return [];
  const user = JSON.stringify({
    task: 'Return {"results":[{"claim": string, "verdict": "plausible"|"needs_source"|"likely_false", "confidence": number, "note": string}]}',
    claims: claims.slice(0, 40),
  });
  try {
    const res = await provider.complete({ system: 'You are a fact checker. Output strict JSON only.', user, kind: 'verify', schema: schemaForKind('verify') });
    const json = extractJson(res.text);
    const out = Array.isArray(json?.results) ? json.results : [];
    out.usage = res.usage || {}; // ride along; array stays array-shaped for JSON
    return out;
  } catch {
    return [];
  }
}

/* ------------------------- point-and-edit ------------------------- */

/**
 * Rewrite ONE slot of one slide (roast R11 — no vision model needed: the slot
 * is already known because the editor resolved the click to the DOM element).
 */
export async function rewriteSlot(provider, { spec, slot, instruction }) {
  const current = readSlot(spec, slot);
  const user = JSON.stringify({
    task: 'Return {"slot": string, "value": string, "reason": string}. Rewrite ONLY the given slot text.',
    slot,
    current,
    instruction,
    limits: 'Keep it under 18 words. No markdown. No emoji.',
  });
  const res = await provider.complete({ system: 'You rewrite a single slide text field. Output strict JSON only.', user, kind: 'rewrite', schema: schemaForKind('rewrite') });
  const json = extractJson(res.text);
  const value = String(json?.value ?? current ?? '').slice(0, 600);
  return { slot, value, reason: String(json?.reason || ''), usage: res.usage || {} };
}

function readSlot(spec, slot) {
  const parts = String(slot || '').split('.');
  if (parts.length === 1 && spec[parts[0]] !== undefined) return spec[parts[0]];
  let node = spec?.content;
  for (const p of parts) {
    if (node == null) return '';
    node = node[p];
  }
  return node ?? '';
}

/* --------------------------- full pipeline --------------------------- */

export async function generateDeck(provider, brief, { slides = 8, theme = 'midnight', onStep = () => {} } = {}) {
  const usage = { input_tokens: 0, output_tokens: 0, cached_tokens: 0, thinking_tokens: 0 };
  const acc = (u) => {
    if (!u) return;
    for (const k of Object.keys(usage)) usage[k] += Number(u[k] || 0);
  };

  onStep({ step: 'outline', message: 'Planning narrative…' });
  const outline = await planOutline(provider, brief, { slides, theme });
  acc(outline.usage);

  onStep({ step: 'slides', message: 'Writing slide content…' });
  const slidesStep = await planSlides(provider, outline, { theme });
  const { specs, issues } = slidesStep;
  acc(slidesStep.usage);

  onStep({ step: 'render', message: 'Rendering slides…' });
  const pages = renderSlides(specs);

  onStep({ step: 'verify', message: 'Verifying content…' });
  const verification = await verifyDeck(provider, specs);
  acc(verification.usage);

  return { outline, specs, pages, verification, issues, usage };
}

/* --------------------------- provenance ledger --------------------------- */

const ISO = () => new Date().toISOString().slice(0, 19);

/**
 * Stamp EVERY populated string/number slot with an origin (generation path).
 * Never clobbers an existing entry — user/manual origins always win.
 */
export function attachProvenance(spec, { source, ref = '', confidence = 0.8, at = ISO() } = {}) {
  if (!spec || typeof spec !== 'object') return spec;
  const prov = { ...(spec.provenance || {}) };
  let n = Object.keys(prov).length;
  for (const s of listSlots(spec)) {
    if (n >= 40) break;
    if (prov[s.slot]) continue;
    if (typeof s.value !== 'string' && typeof s.value !== 'number') continue;
    if (!String(s.value ?? '').trim()) continue; // empty slots carry no origin
    prov[s.slot] = { source, ref: String(ref).slice(0, 64), confidence, at: String(at).slice(0, 32) };
    n++;
  }
  if (n) spec.provenance = prov;
  return spec;
}

/** Re-stamp ONE slot (rewrite path): AI replaced that text, so its origin
 * becomes ai:rewrite / instruction quote. */
export function stampProvenance(spec, slotPath, { source, ref = '', confidence = 0.8, at = ISO() } = {}) {
  if (!spec || typeof spec !== 'object' || !slotPath) return spec;
  spec.provenance = {
    ...(spec.provenance || {}),
    [slotPath]: { source, ref: String(ref).slice(0, 64), confidence, at: String(at).slice(0, 32) },
  };
  return spec;
}

/* --------------------- scoped verification (M-ACC) --------------------- */
/*
 * GenSpark ships these task skeletons verbatim in the client (docs/04 §L9).
 * "Load the `verify` playbook first and follow it" — so the playbook text
 * IS the system prompt; nothing is fetched at runtime.
 */
export const VERIFY_PLAYBOOK = `You are SlideForge's verification agent (the built-in verify playbook). Output STRICT JSON only — no markdown, no prose.

Playbook:
1. Work through the supplied slide content one slide at a time, exactly as given.
2. Check each factual item — figures, dates, names, claims, calculations, and internal consistency — and assign a verdict: plausible (backed by common knowledge), needs_source (cannot be confirmed without a web lookup), or likely_false (contradicts known facts).
3. Report PER-ITEM verdicts with confidence 0..1 and a short, concrete note.
4. links may contain only URLs you are confident exist. They are stored as text; nothing is fetched server-side.
5. Never restate long item text; reference it briefly. item <= 90 chars, note <= 160 chars.`;

const DECK_PROMPT = 'Verify all content across the entire deck — facts, figures, sources, calculations, and internal consistency on every page. Load the `verify` playbook first and follow it: work through the deck in batches, write verification notes into each slide, and report per-item verdicts with links.';
const ELEMENT_PROMPT = (type) => `Verify the selected ${type} — facts, figures, sources, calculations, and internal consistency. Load the \`verify\` playbook first and follow it: check it, write its verification note into the slide, and report the verdict with links.`;
const PAGE_PROMPT_PRO = 'Fact check all the content. If content is right, show me references with clickable links. Otherwise tell me where is wrong and search for content with references.';
const PAGE_PROMPT_CREATIVE = 'First, use the screenshot tool to review the current slide content. Pay special attention to: factual statements and numerical data in text, portraits and logos depicting real people or brands, and diagrams illustrating knowledge or conceptual relationships. After reviewing the screenshot, fact check all the content. If content is right, show me references with clickable links. Otherwise tell me where is wrong and search for content with references.';

const MAX_ITEMS_PER_PAGE = 24;
const VERDICTS = ['plausible', 'needs_source', 'likely_false'];

function cleanLinks(links) {
  return (Array.isArray(links) ? links : [])
    .filter((u) => typeof u === 'string' && /^https?:\/\/\S+$/.test(u.trim()))
    .map((u) => u.trim().slice(0, 200))
    .slice(0, 3);
}

function pageItems(spec, slot = '') {
  if (slot) {
    const s = listSlots(spec).find((x) => x.slot === slot);
    return s ? [{ slot, text: String(s.value ?? '').slice(0, 200) }] : [];
  }
  return listSlots(spec)
    .filter((s) => (typeof s.value === 'string' || typeof s.value === 'number') && String(s.value ?? '').trim().length >= 3)
    .filter((s) => s.slot !== 'notes') // the verification ledger itself is never a claim to verify
    .slice(0, MAX_ITEMS_PER_PAGE)
    .map((s) => ({ slot: s.slot, text: String(s.value ?? '').slice(0, 200) }));
}

/**
 * Scoped verification. `pages` = [{page_index, spec, slot?, images?}].
 * Deck scope = one provider call per page (batch = page, docs/06 Block 2);
 * element/page scope = the single targeted call. Creative mode relays the
 * page screenshot through provider.complete({images}) — with one text-only
 * retry if the image call fails (Block 3: never a hard fail). Usage accumulates.
 */
export async function scopedVerify(provider, pages, { scope = 'deck', mode = 'professional', onPage = () => {}, addIssue = () => {} } = {}) {
  const usage = { input_tokens: 0, output_tokens: 0, cached_tokens: 0, thinking_tokens: 0 };
  const results = [];
  const issues = [];
  for (const pg of pages) {
    const items = pageItems(pg.spec, pg.slot || '');
    if (!items.length) { onPage({ step: 'verify', message: `page ${pg.page_index + 1}: nothing to verify` }); continue; }
    const hasImage = mode === 'creative' && !!pg.images;
    const instruction = scope === 'element'
      ? ELEMENT_PROMPT(pg.slot || 'element')
      : scope === 'page'
        ? (mode === 'creative' ? PAGE_PROMPT_CREATIVE : PAGE_PROMPT_PRO)
        : DECK_PROMPT;
    const user = JSON.stringify({
      instruction,
      scope,
      mode,
      page_index: pg.page_index,
      context: { pages: [{ page_index: pg.page_index, title: String(pg.spec?.title || '').slice(0, 90), items }] },
      task: 'Return {"results":[{"page_index": number, "slot": string, "item": string, "verdict": "plausible"|"needs_source"|"likely_false", "confidence": number, "note": string, "links": [string, ...]}]} — verdicts ONLY for the context shown.',
    });
    onPage({ step: 'verify', message: `Verifying page ${pg.page_index + 1}…${hasImage ? ' (screenshot vision)' : ''}` });
    try {
      const res = await provider.complete({
        system: VERIFY_PLAYBOOK, user, kind: 'verify2', schema: VERIFY2_SCHEMA,
        images: hasImage ? [pg.images] : undefined,
      });
      const json = extractJson(res.text);
      for (const r of (Array.isArray(json?.results) ? json.results : []).slice(0, 8)) {
        results.push({
          page_index: Number(pg.page_index ?? 0), // server-side page mapping — the model never dictates it
          slot: String(r?.slot || pg.slot || '').slice(0, 40),
          item: (String(r?.item || '').slice(0, 160) || String(items[0]?.text || '').slice(0, 160) || 'item'),
          verdict: VERDICTS.includes(r?.verdict) ? r.verdict : 'needs_source',
          confidence: Math.min(1, Math.max(0, Number(r?.confidence) || 0)),
          note: String(r?.note || '').slice(0, 240),
          links: cleanLinks(r?.links),
        });
      }
      for (const u of Object.keys(usage)) usage[u] += Number(res.usage?.[u] || 0);
    } catch (e) {
      const msg = String(e?.message || e).slice(0, 140);
      if (hasImage) { // text-only retry (docs/06 Block 3)
        addIssue(`page ${pg.page_index + 1}: image call failed (${msg}) — text-only retry`);
        try {
          const res = await provider.complete({ system: VERIFY_PLAYBOOK, user, kind: 'verify2', schema: VERIFY2_SCHEMA });
          const json = extractJson(res.text);
          for (const r of (Array.isArray(json?.results) ? json.results : []).slice(0, 6)) {
            results.push({
              page_index: Number(pg.page_index ?? 0),
              slot: String(r?.slot || pg.slot || '').slice(0, 40),
              item: String(r?.item || '').slice(0, 160) || 'item',
              verdict: VERDICTS.includes(r?.verdict) ? r.verdict : 'needs_source',
              confidence: Math.min(1, Math.max(0, Number(r?.confidence) || 0)),
              note: String(r?.note || '').slice(0, 240),
              links: cleanLinks(r?.links),
            });
          }
          for (const u of Object.keys(usage)) usage[u] += Number(res.usage?.[u] || 0);
        } catch (e2) {
          addIssue(`page ${pg.page_index + 1}: verification failed (${String(e2?.message || e2).slice(0, 140)})`);
        }
      } else {
        addIssue(`page ${pg.page_index + 1}: verification failed (${msg})`);
      }
    }
  }
  wrapperUsage(results, usage);
  results.issues = issues;
  return results;
}

function wrapperUsage(results, usage) {
  results.usage = usage; // ride along, same convention as verifyDeck
}
