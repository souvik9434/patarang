import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProvider, createMockProvider, rng, hashSeed } from '../src/ai/provider.js';
import { generateDeck, extractJson } from '../src/ai/orchestrator.js';
import { validateSpec } from '../src/spec.js';

test('mock provider is deterministic for the same input', async () => {
  const p = createMockProvider();
  const a = await p.complete({ kind: 'outline', user: 'deck about latency', system: 'x' });
  const b = await p.complete({ kind: 'outline', user: 'deck about latency', system: 'x' });
  assert.equal(a.text, b.text);
});

test('mock provider differs for different briefs', async () => {
  const p = createMockProvider();
  const a = await p.complete({ kind: 'outline', user: 'deck about latency' });
  const b = await p.complete({ kind: 'outline', user: 'deck about pricing' });
  assert.notEqual(a.text, b.text);
});

test('mock provider needs no API key and reports available', () => {
  const p = createMockProvider();
  assert.equal(p.available, true);
});

test('extractJson survives fences and prose around JSON', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('Here you go: {"a":1} — done'), { a: 1 });
  assert.deepEqual(extractJson('{"a":"}"}'), { a: '}' });
  assert.equal(extractJson('no json here'), null);
});

test('rng is reproducible', () => {
  const a = rng(hashSeed('x'))();
  const b = rng(hashSeed('x'))();
  assert.equal(a, b);
});

test('generateDeck produces a valid, complete deck offline', async () => {
  const p = createMockProvider();
  const result = await generateDeck(p, 'A board update on why our pipeline stalled', { slides: 6, theme: 'midnight' });
  assert.ok(result.pages.length >= 4);
  assert.ok(result.pages.length <= 10);
  for (const page of result.pages) {
    assert.ok(page.content.includes('data-sf-archetype'));
    assert.ok(page.content.includes('slide-spec'));
    const spec = JSON.parse(page.content.match(/<script id="slide-spec" type="application\/json">([\s\S]*?)<\/script>/)[1]);
    const v = validateSpec(spec);
    assert.equal(v.ok, true, JSON.stringify(v.issues));
  }
});

test('generateDeck is byte-identical across runs (determinism gate)', async () => {
  const p = createMockProvider();
  const a = await generateDeck(p, 'Same brief', { slides: 5 });
  const b = await generateDeck(p, 'Same brief', { slides: 5 });
  assert.equal(a.pages[0].content, b.pages[0].content);
});


/* ───────────────────────── M-PROV: Vertex provider & catalogue ───────────────────────── */

import { PROVIDERS, MODELS, listModels, findModel, modelPath, serverManagedThinking, CLAUDE_BUDGET } from '../src/ai/catalog.js';
import { toVertexSchema } from '../src/ai/provider.js';
import { maskKey } from '../src/ai/config-store.js';

test('catalogue: every model entry is complete and provider-keyed', () => {
  assert.ok(PROVIDERS.some((p) => p.id === 'vertex'));
  assert.equal(findModel('gemini-4-argon').publisher, 'google');
  assert.equal(findModel('claude-sonnet-5-5').publisher, 'anthropic');
  for (const m of MODELS) {
    assert.ok(m.id && m.label && m.publisher && m.family, `incomplete entry ${m.id}`);
    assert.ok(['active', 'beta', 'legacy'].includes(m.status), m.id);
    assert.ok(Array.isArray(m.thinking), m.id);
    assert.equal(typeof m.cache, 'boolean', m.id);
  }
  const vertexList = listModels('vertex');
  assert.ok(vertexList.length >= 10, 'vertex catalogue too small');
  assert.ok(vertexList[0].id.startsWith('gemini'), 'active gemini models sort first');
  assert.ok(listModels('gemini').every((m) => m.publisher === 'google'));
});

test('modelPath builds vertex REST target for every publisher', () => {
  assert.equal(modelPath('gemini-3.8-flash'), 'publishers/google/models/gemini-3.8-flash');
  assert.equal(modelPath('claude-sonnet-5-5'), 'publishers/anthropic/models/claude-sonnet-5-5');
  assert.ok(modelPath('grok-4.7').startsWith('publishers/xai/'));
});

test('toVertexSchema converts to the OpenAPI subset Vertex accepts', () => {
  const out = toVertexSchema({
    type: 'object',
    title: 'ignored',
    description: 'kept',
    additionalProperties: false,
    properties: {
      name: { type: 'string', description: 'the name' },
      verdict: { type: 'string', enum: ['a', 'b'] },
      count: { type: 'integer' },
      tags: { type: 'array', items: { type: 'string' } },
      nested: { type: 'object', properties: { deep: { type: 'boolean' } }, required: ['deep'] },
    },
    required: ['name'],
  });
  assert.equal(out.type, 'OBJECT');
  assert.equal(out.description, 'kept');
  assert.equal(out.additionalProperties, undefined);
  assert.equal(out.title, undefined);
  assert.equal(out.properties.name.type, 'STRING');
  assert.deepEqual(out.properties.verdict.enum, ['a', 'b']);
  assert.equal(out.properties.count.type, 'INTEGER');
  assert.equal(out.properties.tags.items.type, 'STRING');
  assert.equal(out.properties.nested.properties.deep.type, 'BOOLEAN');
  assert.ok(Array.isArray(out.propertyOrdering));
  assert.deepEqual(out.required, ['name']);
});

test('claude reasoning maps to thinkingBudget; server-managed engines get no override', () => {
  assert.equal(CLAUDE_BUDGET.medium, 8192);
  assert.ok(serverManagedThinking('glm-5.2'));
  assert.ok(serverManagedThinking('grok-4.7'));
  assert.ok(serverManagedThinking('deepseek-v4.1-flash'));
  assert.ok(!serverManagedThinking('gemini-3.8-flash'));
  assert.ok(!serverManagedThinking('claude-sonnet-5-5'));
});

test('DEFAULT catalog default model for vertex is the flash default', async () => {
  const { DEFAULT_MODELS } = await import('../src/ai/catalog.js');
  assert.equal(DEFAULT_MODELS.vertex, 'gemini-3.8-flash');
});

test('vertex provider calls the express REST surface with x-goog-api-key', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: '{"ok":1}' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 40, cachedContentTokenCount: 90, thoughtsTokenCount: 10 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const p = createProvider({ provider: 'vertex', apiKey: 'KEY123456789', model: 'gemini-3.8-flash', reasoning: 'medium' });
    const out = await p.complete({ system: 'SYS', user: 'USER', schema: { type: 'object', properties: { ok: { type: 'integer' } } } });

    assert.equal(out.text, '{"ok":1}');
    assert.deepEqual(out.usage, { input_tokens: 120, output_tokens: 50, cached_tokens: 90, thinking_tokens: 10 });

    const call = calls.find((c) => c.url.includes(':generateContent'));
    assert.ok(call, 'no generateContent call');
    assert.ok(call.url.includes('https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-3.8-flash:generateContent'), call.url);
    assert.equal(call.opts.headers['x-goog-api-key'], 'KEY123456789');
    const body = JSON.parse(call.opts.body);
    assert.equal(body.systemInstruction.parts[0].text, 'SYS'); // separate static role (cache-friendly)
    assert.equal(body.generationConfig.responseMimeType, 'application/json');
    assert.equal(body.generationConfig.responseSchema.type, 'OBJECT');
    assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, 'MEDIUM');
    assert.equal(body.contents[0].parts[0].text, 'USER');

    const v = await p.validate();
    const c2 = calls.find((c) => c.url.includes(':countTokens'));
    assert.ok(c2, 'validate should use countTokens');
    assert.equal(v.ok, true);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('vertex provider reasoning: off suppresses thinkingConfig; claude maps budget', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), body: JSON.parse(opts.body) });
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'x' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const pOff = createProvider({ provider: 'vertex', apiKey: 'K', model: 'gemini-3.8-flash', reasoning: 'off' });
    await pOff.complete({ user: 'u' });
    assert.equal(calls.at(-1).body.generationConfig.thinkingConfig, undefined);

    const pCl = createProvider({ provider: 'vertex', apiKey: 'K', model: 'claude-sonnet-5-5', reasoning: 'high' });
    await pCl.complete({ user: 'u' });
    assert.equal(calls.at(-1).body.generationConfig.thinkingConfig.thinkingBudget, 24576);
    assert.equal(calls.at(-1).body.generationConfig.responseMimeType, 'application/json');
    assert.ok(calls.find((c) => c.url.includes('publishers/anthropic/models/claude-sonnet-5-5:generateContent')));

    const pGlm = createProvider({ provider: 'vertex', apiKey: 'K', model: 'glm-5.2', reasoning: 'high' }); // server-managed: no override, and no crash
    await pGlm.complete({ user: 'u' });
    assert.ok(calls.find((c) => c.url.includes('publishers/zai-org/models/glm-5.2:generateContent')));
    const glmBody = calls.filter((c) => c.url.includes('glm-5.2')).at(-1).body;
    assert.equal(glmBody.generationConfig.thinkingConfig, undefined);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('maskKey leaks nothing useful', () => {
  assert.equal(maskKey('AIzaSy1234567890AbCdEf'), '••••CdEf');
  assert.equal(maskKey(''), '');
  assert.equal(maskKey('short'), '••••hort');
  const m = maskKey('AIzaSy1234567890AbCdEf');
  assert.ok(!m.includes('AIzaSy'), 'must not expose the key prefix');
  assert.ok(m.length <= 8, 'mask stays short');
});

test('split-compare normalizeSpec does not report false-positive empty slots', async () => {
  const { normalizeSpec, validateSpec } = await import('../src/spec.js');
  const { spec, issues } = normalizeSpec({
    archetype: 'split-compare',
    title: 'Legacy Panels vs AnalyzeG Standard',
    content: {
      left: { label: 'LEGACY', head: 'Slow Panels', text: '6-8 weeks', points: ['60% fake'] },
      right: { label: 'ANALYZEG', head: '24h Vault', text: '5-layer KYC', points: ['Zero PII'] },
    },
  });
  assert.deepEqual(issues, []);
  assert.equal(validateSpec(spec).ok, true);
});