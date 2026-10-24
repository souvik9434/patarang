import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSpec, validateSpec, ARCHETYPE_IDS } from '../src/spec.js';
import { renderSlideHtml, applyGeometry } from '../src/render/slide-html.js';
import { parseSlideHtml, getSlot, setSlot, extractSpecIsland } from '../src/render/parse.js';
import { sanitize } from '../src/sanitize.js';
import { renderLayout } from '../src/render/layouts.js';

const SAMPLES = {
  hero: { title: 'Ship it', content: { lead: 'A short statement.', points: ['One', 'Two'] } },
  bento: { title: 'Signals', content: { blocks: [{ label: 'Reach', value: '42%', text: 'Measured.' }] } },
  'metric-triple': { title: 'Numbers', content: { metrics: [{ label: 'Adoption', value: '61%', delta: '+4%' }] } },
  'split-compare': { title: 'Decision', content: { left: { label: 'Today', head: 'A', points: ['p'] }, right: { label: 'Target', head: 'B', points: ['q'] } } },
  bullets: { title: 'Detail', content: { items: [{ head: 'One', text: 'Text' }] } },
  roadmap: { title: 'Plan', content: { steps: [{ label: 'P1', head: 'Do', text: 'It' }] } },
  timeline: { title: 'When', content: { events: [{ when: 'Q1', head: 'Ship', text: 'Now' }] } },
  quote: { title: 'Note', content: { quote: 'A quote.', attribution: 'Someone' } },
  chart: { title: 'Trend', content: { chart: { type: 'bar', categories: ['A', 'B'], series: [{ name: 'S', values: [1, 2] }] } } },
  'image-text': { title: 'Practice', content: { image: { url: '', alt: '' }, text: 'T', points: ['p'] } },
  table: { title: 'Matrix', content: { table: { headers: ['Col 1', 'Col 2'], rows: [['R1C1', 'R1C2']] } } },
  custom: { title: 'Freeform', content: { html: '<div data-sf-id="c1" style="display:flex;gap:12px"><span>Custom block</span></div>' } },
};

test('every archetype normalises, validates and renders', () => {
  for (const archetype of ARCHETYPE_IDS) {
    const { spec } = normalizeSpec({ ...SAMPLES[archetype], archetype }, { index: 0 });
    assert.equal(spec.archetype, archetype);
    const v = validateSpec(spec);
    assert.equal(v.ok, true, `${archetype}: ${JSON.stringify(v.issues)}`);
    const html = renderSlideHtml(spec);
    assert.ok(html.includes('data-sf-archetype="' + archetype + '"'));
    assert.ok(html.includes('slide-spec'));
  }
});

test('render -> parse round trip keeps title and archetype', () => {
  const { spec } = normalizeSpec({ ...SAMPLES.bento, archetype: 'bento' }, { index: 0 });
  const html = renderSlideHtml(spec);
  const parsed = parseSlideHtml(html);
  assert.equal(parsed.degraded, false);
  assert.equal(parsed.spec.archetype, 'bento');
  assert.equal(parsed.spec.title, spec.title);
  assert.equal(parsed.spec.content.blocks[0].value, spec.content.blocks[0].value);
});

test('parse degrades gracefully when the spec island is missing', () => {
  const parsed = parseSlideHtml('<html><body><h1>Imported title</h1><p>Body copy</p></body></html>');
  assert.equal(parsed.degraded, true);
  assert.ok(parsed.spec.title.length > 0);
});

test('parse ignores a corrupt spec island and falls back', () => {
  const parsed = parseSlideHtml('<script id="slide-spec" type="application/json">{not json</script><h1>T</h1>');
  assert.equal(parsed.degraded, true);
});

test('setSlot mutates nested slots immutably', () => {
  const { spec } = normalizeSpec({ ...SAMPLES.bento, archetype: 'bento' }, { index: 0 });
  const next = setSlot(spec, 'blocks.0.text', 'Changed');
  assert.equal(next.content.blocks[0].text, 'Changed');
  assert.equal(spec.content.blocks[0].text, 'Measured.');
  assert.equal(getSlot(next, 'blocks.0.text'), 'Changed');
});

test('text budgets are enforced by normalisation', () => {
  const long = 'word '.repeat(60).trim();
  const { spec } = normalizeSpec({ archetype: 'hero', title: long, content: { lead: long, points: [long] } }, { index: 0 });
  assert.ok(spec.title.split(/\s+/).length <= 9);
  assert.ok(spec.content.lead.split(/\s+/).length <= 27);
});

test('rendered markup survives the sanitiser unchanged (shared vocabulary)', () => {
  for (const archetype of ARCHETYPE_IDS) {
    const { spec } = normalizeSpec({ ...SAMPLES[archetype], archetype }, { index: 0 });
    const body = renderLayout(spec);
    const cleaned = sanitize(body);
    // every data-sf-id hook must survive
    const ids = [...body.matchAll(/data-sf-id="([^"]+)"/g)].map((m) => m[1]);
    for (const id of ids) assert.ok(cleaned.includes(`data-sf-id="${id}"`), `${archetype}: lost ${id}`);
  }
});


/* ------------------- M4 geometry (drag -> spec -> rebuild) ------------------- */

test('normalizeSpec preserves valid editor geometry and drops invalid rects', () => {
  const { spec } = normalizeSpec({
    archetype: 'hero', title: 'T',
    content: { lead: 'L', points: ['a'] },
    geometry: {
      title: { x: 10.4, y: 20.6, w: 400.1, h: 80.2 },
      junk: { x: 'nope', y: 5 },
      partial: { x: 30, y: 40 },
      bad: 'not-an-object',
    },
    geomMode: 'offset', // geometry restoration is offset-mode gated
  });
  assert.deepEqual(spec.geometry, {
    title: { x: 10, y: 21, w: 400, h: 80 },
    partial: { x: 30, y: 40 },
  });
});

test('geometry survives render -> parse -> render (drag is stable across rebuilds)', () => {
  const { spec } = normalizeSpec({ ...SAMPLES.bento, archetype: 'bento' }, { index: 0 });
  spec.geometry = { block0: { x: 120, y: 90, w: 500, h: 300 } };
  const html = renderSlideHtml(spec);
  const parsed = parseSlideHtml(html);
  assert.equal(parsed.degraded, false);
  assert.deepEqual(parsed.spec.geometry, { block0: { x: 120, y: 90, w: 500, h: 300 } });
  const again = renderSlideHtml(parsed.spec);
  // OFFSET model (2026-10-23): layout elements render position:relative deltas
  assert.match(again, /style="position:relative;left:120px;top:90px;width:500px;height:300px;"/);
});

test('setSlot keeps geometry; region rewrite only touches that slot (M4 gate)', () => {
  const { spec } = normalizeSpec({ ...SAMPLES.bento, archetype: 'bento' }, { index: 0 });
  spec.geometry = { title: { x: 5, y: 6 } };
  const next = setSlot(spec, 'blocks.0.text', 'Rewritten only here.');
  assert.equal(getSlot(next, 'blocks.0.text'), 'Rewritten only here.');
  assert.equal(getSlot(next, 'blocks.0.label'), getSlot(spec, 'blocks.0.label'));
  assert.deepEqual(next.geometry, spec.geometry);
  const html = renderSlideHtml(next);
  assert.match(html, /style="position:relative;left:5px;top:6px;"/);
});

test('applyGeometry freezes elements and applies cleanly to authored markup', () => {
  const { spec } = normalizeSpec({ ...SAMPLES.hero, archetype: 'hero' }, { index: 0 });
  const body = renderLayout(spec);
  const frozen = applyGeometry(body, { title: { x: 88, y: 160, w: 600, h: 120 } });
  // OFFSET model: non-image elements apply as position:relative deltas
  assert.match(frozen, /data-sf-id="title" data-sf-slot="title" style="position:relative;left:88px;top:160px;width:600px;height:120px;"/);
  assert.equal(applyGeometry(body, {}), body);
  assert.equal(applyGeometry(body, { nosuch: { x: 1, y: 2 } }), body);
});

test('CS.1/CS.4 canvasMode, hideHeader, fontPair, and spec.styles survive render -> parse', () => {
  const { spec } = normalizeSpec({
    archetype: 'custom',
    title: 'Full Bleed Cover',
    canvasMode: 'full-bleed',
    hideHeader: true,
    fontPair: 'editorial',
    styles: { c1: { color: '#be185d', fontSize: '32', radius: '16', shadow: 'deep' } },
    content: { html: '<div data-sf-id="c1">Styled node</div>' },
  });
  const html = renderSlideHtml(spec);
  assert.match(html, /data-sf-canvas="full-bleed"/);
  assert.ok(!html.includes('class="sf-title"'), 'hideHeader suppresses headBlock');
  assert.match(html, /color:#be185d;font-size:32px;border-radius:16px;/);
  const parsed = parseSlideHtml(html);
  assert.equal(parsed.spec.canvasMode, 'full-bleed');
  assert.equal(parsed.spec.hideHeader, true);
  assert.equal(parsed.spec.fontPair, 'editorial');
  assert.equal(parsed.spec.styles.c1.color, '#be185d');
});

test('CS.2/CS.3 all 6 GenSpark presets expand, sanitize, and preserve SVG markers/filters', async () => {
  const { PRESET_CATALOG, expandPreset } = await import('../src/presets.js');
  for (const id of Object.keys(PRESET_CATALOG)) {
    const raw = expandPreset({ preset: id, title: `Preset ${id}` });
    const { spec } = normalizeSpec(raw);
    const v = validateSpec(spec);
    assert.equal(v.ok, true, `preset ${id} valid`);
    const html = renderSlideHtml(spec);
    assert.ok(html.includes('data-sf-id='), `preset ${id} has interactive hooks`);
  }
});