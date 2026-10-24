/**
 * tests/verify.test.js — M-ACC gates (docs/06):
 * provenance ledger sanitize/strip/round-trip, notes ledger preservation,
 * scoped verify determinism + page mapping, verify2 schema wiring.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSpec } from '../src/spec.js';
import { renderSlideHtml } from '../src/render/slide-html.js';
import { parseSlideHtml } from '../src/render/parse.js';
import { createMockProvider, rng, hashSeed } from '../src/ai/provider.js';
import { planSlides, scopedVerify, attachProvenance, stampProvenance, VERIFY_PLAYBOOK } from '../src/ai/orchestrator.js';
import { schemaForKind } from '../src/ai/schemas.js';

/* ---------------- provenance sanitizer ---------------- */

test('normalizeSpec keeps only legal, well-formed provenance entries', () => {
  const raw = {
    archetype: 'hero', title: 'T',
    content: { lead: 'L', points: ['p1'] }, // lead's provenance rejected below (source junk); points.0 legal
    provenance: {
      'title': { source: 'user', ref: 'manual-edit', confidence: 1, at: '2026-10-23T10:00:00' }, // legal
      'points.0': { source: 'ai:gen', ref: 'pipeline:planSlides', confidence: 0.8 },            // legal
      '../etc/passwd': { source: 'user' },                                                     // path junk
      'title2': { source: 'user' },                                                            // bad path shape (digit start)
      'lead': { source: 'nsa', confidence: 1 },                                                // unknown source
      'subtitle': { source: 'user', confidence: 42 },                                          // confidence clamped
    },
  };
  const { spec } = normalizeSpec(raw, { index: 0 });
  assert.equal(Object.keys(spec.provenance).length, 4, 'legal entries kept: title/points.0/title2 (path digits ok)/subtitle(clamped)');
  assert.equal(spec.provenance.title.source, 'user');
  assert.equal(spec.provenance.title.confidence, 1);
  assert.equal(spec.provenance['points.0'].confidence, 0.8);
  assert.equal(spec.provenance['title2'].source, 'user', 'digit suffixes are legal slot paths');
  assert.equal(spec.provenance.subtitle.confidence, 1, 'confidence clamped into [0,1]');
  assert.ok(spec.provenance['../etc/passwd'] === undefined, 'path junk rejected');
  assert.ok(spec.provenance.lead === undefined, 'unknown source rejected');
});

test('normalizeSpec caps provenance at 40 entries and short strings', () => {
  const prov = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`slot${i}`, { source: 'ai', ref: 'x'.repeat(300), confidence: 0.5, at: 'z'.repeat(500) }]));
  const { spec } = normalizeSpec({ archetype: 'hero', title: 'T', content: { lead: 'L', points: ['p'] }, provenance: prov }, { index: 0 });
  assert.ok(Object.keys(spec.provenance).length <= 40);
  const e = Object.values(spec.provenance)[0];
  assert.ok(e.ref.length <= 64 && e.at.length <= 32);
});

test('provenance survives the render -> parse island round-trip', () => {
  const { spec } = normalizeSpec({ archetype: 'bento', title: 'T', content: { blocks: [{ label: 'L', value: '42%', text: 't' }] }, notes: 'hello' }, { index: 0 });
  attachProvenance(spec, { source: 'ai:gen', ref: 'pipeline:planSlides', confidence: 0.8 });
  const round = parseSlideHtml(renderSlideHtml(spec));
  assert.equal(round.degraded, false);
  assert.equal(round.spec.provenance.title.source, 'ai:gen');
  assert.equal(round.spec.provenance['blocks.0.text'].source, 'ai:gen');
});

test('attachProvenance never clobbers an existing user origin', () => {
  const { spec } = normalizeSpec({ archetype: 'hero', title: 'T', content: { lead: 'L', points: ['p'] } }, { index: 0 });
  stampProvenance(spec, 'title', { source: 'user', ref: 'manual-edit', confidence: 1 });
  attachProvenance(spec, { source: 'ai:gen', ref: 'pipeline', confidence: 0.5 });
  assert.equal(spec.provenance.title.source, 'user');   // user wins
  assert.equal(spec.provenance['points.0'].source, 'ai:gen');
});

test('proof-vision: model-replayed provenance cannot leak into a spec via planSlides (strip gate)', async () => {
  const text = JSON.stringify({
    slides: [{
      archetype: 'hero', title: 'Spoofed', kicker: 'K',
      content: { lead: 'Lead line', points: ['a', 'b'] },
      provenance: { title: { source: 'user', ref: 'manual-edit', confidence: 1 }, kicker: { source: 'user' } },
    }],
  });
  const fakeProvider = { complete: async () => ({ text, usage: { input_tokens: 1, output_tokens: 1, cached_tokens: 0, thinking_tokens: 0 } }) };
  const outline = { title: 'D', narrative: '', slides: [{ index: 0, title: 'Spoofed', archetype: 'hero', purpose: '' }] };
  const { specs } = await planSlides(fakeProvider, outline, { theme: 'midnight' });
  assert.equal(specs.length, 1);
  assert.equal(specs[0].provenance.title.source, 'ai:gen', 'model-declared provenance must be stripped, then server-attached');
  assert.equal(specs[0].provenance.kicker.source, 'ai:gen');
});

test('notes: generation prose clamps to the budget, [verify …] ledger survives round-trip', () => {
  const ledger = Array.from({ length: 12 }, (_, i) => `[verify 2026-10-23] item number ${i} is a longish factual claim line with a note attached — needs_source: mock note body`).join('\n');
  const { spec } = normalizeSpec({ archetype: 'hero', title: 'T', content: { lead: 'L', points: ['p'] }, notes: ledger }, { index: 0 });
  assert.ok(spec.notes.startsWith('[verify '), 'pure ledger notes not truncated by the 120-word clamp');
  const round = parseSlideHtml(renderSlideHtml(spec));
  assert.ok(round.spec.notes.includes('[verify 2026-10-23] item number 11'), 'ledger survives the island loop');
});

test('non-ledger notes still clamp to 120 words', () => {
  const long = Array.from({ length: 300 }, (_, i) => `word${i}`).join(' ');
  const { spec } = normalizeSpec({ archetype: 'hero', title: 'T', content: { lead: 'L', points: ['p'] }, notes: long }, { index: 0 });
  assert.ok(spec.notes.split(/\s+/).length <= 121);
});

/* ---------------- scoped verify ---------------- */

test('verify2 schema is wired through schemaForKind', () => {
  const s = schemaForKind('verify2');
  assert.equal(s.properties.results.items.properties.verdict.enum.length, 3);
  assert.equal(s.properties.results.items.required[0], 'page_index');
});

test('scopedVerify (mock, deck) maps every verdict to a page and accumulates usage', async () => {
  rng(hashSeed('k'));
  const provider = createMockProvider();
  const pages = [0, 1, 2].map((i) => ({
    page_index: i,
    spec: normalizeSpec({ archetype: 'hero', title: `Slide ${i}`, content: { lead: `Claim ${i} says 42% uplift`, points: ['A', 'B'] } }, { index: i }).spec,
  }));
  const seen = [];
  const results = await scopedVerify(provider, pages, { scope: 'deck', mode: 'professional', onPage: (s) => seen.push(s.message) });
  assert.ok(Array.isArray(results));
  const idxs = new Set(results.map((r) => r.page_index));
  assert.deepEqual([...idxs].sort(), [0, 1, 2], 'deck batches must be page-mapped');
  assert.ok(results.every((r) => ['plausible', 'needs_source', 'likely_false'].includes(r.verdict)));
  assert.ok(results.every((r) => r.confidence >= 0 && r.confidence <= 1));
  assert.ok(seen.some((m) => m.includes('page ')), 'onPage progress streamed');
  assert.ok(results.usage.input_tokens >= 0 && results.usage.output_tokens >= 0);
});

test('scopedVerify (element) targets one slot; mock marks it needs_source with a note', async () => {
  const provider = createMockProvider();
  const { spec } = normalizeSpec({ archetype: 'hero', title: 'The 97% claim', content: { lead: 'L', points: ['p'] } }, { index: 0 });
  const results = await scopedVerify(provider, [{ page_index: 0, spec, slot: 'title' }], { scope: 'element' });
  assert.equal(results.length, 1);
  assert.equal(results[0].slot, 'title');
  assert.equal(results[0].page_index, 0);
  assert.equal(results[0].verdict, 'needs_source');
});

test('scopedVerify relays the creative screenshot only in creative mode', async () => {
  const { spec } = normalizeSpec({ archetype: 'hero', title: 'T', content: { lead: 'Lead claim of 42% uplift', points: ['A 12-word point'] } }, { index: 0 });
  const calls = [];
  const spy = {
    complete: async (args) => { calls.push(args); return { text: '{"results":[]}', usage: { input_tokens: 1, output_tokens: 1, cached_tokens: 0, thinking_tokens: 0 } }; },
  };
  await scopedVerify(spy, [{ page_index: 0, spec, images: { mime_type: 'image/png', data: 'AAAA' } }], { scope: 'page', mode: 'creative' });
  assert.equal(calls[0].images.length, 1);
  assert.equal(calls[0].images[0].mime_type, 'image/png');
  assert.equal(calls[0].system, VERIFY_PLAYBOOK, 'playbook text ships as the system prompt (L9: load the playbook)');
  calls.length = 0;
  await scopedVerify(spy, [{ page_index: 0, spec, images: { mime_type: 'image/png', data: 'AAAA' } }], { scope: 'page', mode: 'professional' });
  assert.equal(calls[0].images, undefined, 'professional mode is text-only (docs/04 §L9)');
});

test('verify playbook keeps the verbatim L9 instructions', async () => {
  const { spec } = normalizeSpec({ archetype: 'hero', title: 'The 97% adoption claim', content: { lead: 'Lead claim of 42% uplift', points: ['A 12-word point'] } }, { index: 0 });
  let seen;
  const spy = { complete: async (args) => { seen = args; return { text: '{"results":[]}', usage: {} }; } };
  await scopedVerify(spy, [{ page_index: 0, spec }], { scope: 'deck' });
  const payload = JSON.parse(seen.user);
  assert.ok(payload.instruction.startsWith('Verify all content across the entire deck'), 'deck prompt verbatim (docs/04 §L9)');
  assert.ok(payload.instruction.includes('report per-item verdicts with links'));
  await scopedVerify(spy, [{ page_index: 0, spec, slot: 'title' }], { scope: 'element' });
  const el = JSON.parse(seen.user);
  assert.ok(el.instruction.includes('Verify the selected title'), 'element {type} substitution');
  assert.ok(VERIFY_PLAYBOOK.includes('built-in verify playbook'));
});
