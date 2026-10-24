/**
 * ai/provider.js — the model adapter.
 *
 * ONE interface, four implementations (roast C6):
 *   mock              — deterministic, offline, no key. The reference
 *                       implementation of the spec contract and the CI gate.
 *   vertex            — Google Cloud Vertex AI / Gemini Enterprise Agent
 *                       Platform, EXPRESS MODE: an Agent Studio API key on
 *                       aiplatform.googleapis.com with header `x-goog-api-key`
 *                       (verified 2026-10-23, reference/express-mode/rest/v1).
 *                       Reasoning → generationConfig.thinkingConfig.thinkingLevel
 *                       (Gemini family) or Anthropic thinkingBudget (partners).
 *   gemini            — Google Gemini API (AI Studio key), generativelanguage
 *                       v1beta, JSON via responseMimeType.
 *   openai-compatible — any base URL speaking /chat/completions (OpenAI,
 *                       OpenRouter, lmstudio, …).
 *
 * Interface:
 *   const p = createProvider({provider, apiKey, model, baseUrl, reasoning})
 *   await p.complete({system, user, kind, schema}) -> {text, usage}
 *   p.available                                    -> boolean
 *   usage includes engine metadata when present:
 *   { input_tokens, output_tokens, cached_tokens, thinking_tokens }
 *
 * Config precedence: explicit opts > SLIDEFORGE_* env > data/config.json
 * (see config-store.js). The key never reaches the browser unmasked.
 */

import { createHash } from 'node:crypto';
import { loadConfig } from './config-store.js';
import { findModel, modelPath, isClaudeFamily, isGeminiFamily, serverManagedThinking, CLAUDE_BUDGET, DEFAULT_MODELS as CATALOG_DEFAULTS } from './catalog.js';

export const DEFAULT_MODELS = CATALOG_DEFAULTS;

export function hashSeed(s) {
  const h = createHash('sha256').update(String(s || '')).digest();
  return h.readUInt32BE(0);
}

/** Small deterministic PRNG (mulberry32) so the mock is reproducible. */
export function rng(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createProvider(opts = {}) {
  const cfg = loadConfig();
  // NO silent fallback: an app with no provider configured is "AI not
  // connected" — a loud ProviderError, never an offline imitation.
  const name = (opts.provider || cfg.provider || '').toLowerCase();
  const apiKey = opts.apiKey ?? cfg.apiKey ?? '';
  const model = opts.model || cfg.model || DEFAULT_MODELS[name === 'vertex' ? 'gemini' : name] || DEFAULT_MODELS.gemini;
  const baseUrl = opts.baseUrl || cfg.baseUrl || '';
  const reasoning = opts.reasoning || cfg.reasoning || 'low';
  const cacheName = opts.cacheName ?? cfg.cacheName ?? '';

  if (!name) {
    throw new ProviderError('AI is not connected — open Setup (⚙), pick a provider, paste your API key, and press Save & validate', 401);
  }
  if (name === 'vertex') return vertexProvider({ apiKey, model, baseUrl, reasoning, cacheName });
  if (name === 'gemini') return geminiProvider({ apiKey, model, baseUrl, reasoning });
  if (name === 'openai' || name === 'openai-compatible') return openAICompatibleProvider({ apiKey, model, baseUrl, reasoning });
  throw new ProviderError(`unknown provider "${name}" (use vertex | gemini | openai-compatible)`, 400);
}

/* ------------------------- test double (offline tests only) ------------------------- */

/**
 * Deterministic offline engine. NOT reachable through createProvider() or any
 * config path (2026-10-23 AI-only mandate): the product has no mock/offline
 * mode. Reserved for tests and offline scripts, which import it directly.
 */
export function createMockProvider(model = 'mock-1') {
  const complete = async ({ kind, user, system }) => {
    const seed = hashSeed(`${kind}|${system || ''}|${user || ''}`);
    const rand = rng(seed);
    const payload = mockGenerate(kind, user, rand);
    return { text: JSON.stringify(payload, null, 2), usage: { input_tokens: user.length, output_tokens: JSON.stringify(payload).length, mock: true } };
  };
  return { name: 'mock', model, available: true, complete };
}

const TOPIC_WORDS = ['latency', 'adoption', 'retention', 'pipeline', 'coverage', 'quality', 'trust', 'scale'];

function mockGenerate(kind, user, rand) {
  const brief = String(user || '');
  const topicMatch = brief.match(/(?:on|about|for|why)\s+([^,.;\n]{3,48})/i);
  let topic = (topicMatch ? topicMatch[1] : brief.slice(0, 48)).trim() || 'the programme';
  topic = topic.split(/\s+and\s+/)[0].split(/\s+because\s+/)[0].replace(/["'“”.]+$/g, '').trim();
  if (topic.split(/\s+/).length > 7) topic = topic.split(/\s+/).slice(0, 7).join(' ');
  const pick = (arr) => arr[Math.floor(rand() * arr.length) % arr.length];

  if (kind === 'outline') {
    const titles = ['Where we are', 'What we learned', 'What changes', 'How we execute', 'What it costs', 'How we measure', 'What could go wrong', 'The decision', 'Next 30 days', 'The ask'];
    const n = Math.max(4, Math.min(10, titles.length));
    return {
      title: topic.charAt(0).toUpperCase() + topic.slice(1),
      narrative: `A ${topic} story in three movements: state, change, execution.`,
      slides: titles.slice(0, n).map((t, i) => ({
        index: i,
        title: t,
        archetype: ['hero', 'bento', 'metric-triple', 'split-compare', 'bullets'][i % 5],
        purpose: `Establish ${t.toLowerCase()} for ${topic}.`,
      })),
    };
  }

  if (kind === 'slides') {
    const plan = safeParse(user) || {};
    const planned = Array.isArray(plan.slides) ? plan.slides : (Array.isArray(plan.outline?.slides) ? plan.outline.slides : []);
    return {
      slides: planned.map((s, i) => mockSlide(s, i, topic, rand)),
    };
  }

  if (kind === 'rewrite') {
    const payload = safeParse(user) || {};
    const slot = payload.slot || 'title';
    const current = payload.current ?? payload.value ?? '';
    const words = String(current).split(/\s+/).filter(Boolean);
    const tightened = words.slice(0, Math.max(3, Math.ceil(words.length * 0.6))).join(' ');
    return { slot, value: tightened || current, reason: 'mock rewrite: tightened for punch' };
  }

  if (kind === 'verify') {
    const payload = safeParse(user) || {};
    const claims = Array.isArray(payload.claims) ? payload.claims : [];
    return {
      results: claims.map((c) => ({
        claim: c,
        verdict: rand() > 0.25 ? 'plausible' : 'needs_source',
        confidence: Number((0.55 + rand() * 0.42).toFixed(2)),
        note: 'Mock verification — no web access in mock mode.',
      })),
    };
  }

  if (kind === 'verify2') {
    // M-ACC scoped verify, deterministic (docs/06 Block 2): worst item first.
    const payload = safeParse(user) || {};
    const pages = Array.isArray(payload?.context?.pages) ? payload.context.pages : [];
    const results = [];
    for (const pg of pages) {
      const items = Array.isArray(pg.items) ? pg.items.slice(0, 3) : [];
      items.forEach((it, k) => {
        results.push({
          page_index: Number(pg.page_index ?? 0),
          slot: String(it.slot || ''),
          item: String(it.text || it.value || '').slice(0, 200),
          verdict: k === 0 ? 'needs_source' : 'plausible',
          confidence: k === 0 ? 0.42 : 0.86,
          note: 'Mock verification — deterministic, no web access in mock mode.',
          links: [],
        });
      });
    }
    return { results };
  }

  return { echo: String(user || '').slice(0, 200) };
}

function mockSlide(s, i, topic, rand) {
  const archetype = s.archetype || 'bullets';
  const title = s.title || `Slide ${i + 1}`;
  const n = 2 + Math.floor(rand() * 2);
  const pick = (arr) => arr[Math.floor(rand() * arr.length) % arr.length];
  const metric = Math.min(96, 12 + (n * 37 + i * 13) % 70);
  const FRAMES = [
    (t) => `Measured against the pre-${t} baseline for the ${'latency'} cohort.`,
    (t) => `Held flat while ${'quality'} work shipped to the ${'coverage'} team.`,
    (t) => `The gap that ${t} was supposed to close, per the last review.`,
  ];
  switch (archetype) {
    case 'hero':
      return {
        archetype, title, kicker: 'Overview',
        subtitle: `Why ${topic} matters now`,
        content: { lead: `${topic} is the constraint that decides whether the next phase lands or stalls.`, points: ['One sentence per idea', 'Numbers over adjectives', 'A decision, not a summary'] },
      };
    case 'bento':
      return {
        archetype, title, kicker: 'Signals',
        content: { blocks: Array.from({ length: 3 }, (_, k) => ({ label: ['Reach', 'Depth', 'Trust'][k], value: `${Math.min(97, metric + k * 7)}%`, text: FRAMES[k % FRAMES.length](topic), tone: k === 0 ? 'accent' : 'plain' })) },
      };
    case 'metric-triple':
      return {
        archetype, title, kicker: 'By the numbers',
        content: { metrics: Array.from({ length: 3 }, (_, k) => ({ label: ['Adoption', 'Retention', 'Coverage'][k], value: `${Math.min(97, metric + k * 11)}%`, delta: k === 1 ? '-4%' : `+${3 + k}%`, positive: k !== 1 })) },
      };
    case 'split-compare':
      return {
        archetype, title, kicker: 'Decision',
        content: {
          left: { label: 'Today', head: 'What we run', text: `The current ${topic} process.`, points: ['Manual review', 'Siloed data', 'Weekly cadence'] },
          right: { label: 'Target', head: 'What we ship', text: `The next ${topic} process.`, points: ['Instrumented', 'Single source', 'Same-day'] },
        },
      };
    case 'roadmap':
      return {
        archetype, title, kicker: 'Plan',
        content: { steps: Array.from({ length: 4 }, (_, k) => ({ label: `Phase ${k + 1}`, head: ['Instrument', 'Instrument', 'Automate', 'Scale'][k], text: `Concrete ${topic} workstream for phase ${k + 1}.` })) },
      };
    case 'timeline':
      return {
        archetype, title, kicker: 'Timeline',
        content: { events: Array.from({ length: 4 }, (_, k) => ({ when: `Q${k + 1}`, head: `Milestone ${k + 1}`, text: `${topic} milestone with a measurable exit criterion.` })) },
      };
    case 'quote':
      return {
        archetype, title, kicker: 'Field note',
        content: { quote: `The ${topic} problem is not effort, it is instrumentation.`, attribution: 'Programme review' },
      };
    case 'chart':
      return {
        archetype, title, kicker: 'Trend',
        content: { chart: { type: 'bar', categories: ['Q1', 'Q2', 'Q3', 'Q4'], series: [{ name: 'Actual', values: [12, 24, 38, 55] }, { name: 'Plan', values: [15, 25, 35, 45] }] } },
      };
    case 'image-text':
      return {
        archetype, title, kicker: 'In practice',
        content: { image: { url: '', alt: '' }, text: `A concrete ${topic} situation.`, points: ['First observable', 'Second observable', 'What we changed'] },
      };
    default:
      return {
        archetype: 'bullets', title, kicker: 'Detail',
        content: { items: Array.from({ length: 3 }, (_, k) => ({ head: `Point ${k + 1}`, text: `A ${topic} detail that supports the claim above.` })) },
      };
  }
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

/**
 * M-ACC vision (docs/06 Block 3): optional inline images for the Creative
 * screenshot loop. Google-family adapters → inlineData parts; openai-compatible
 * → data-URL image_url content part; the mock provider ignores images.
 * Capped at 2 images per call; malformed entries dropped silently.
 */
function inlineImages(images) {
  return (Array.isArray(images) ? images : [])
    .filter((im) => im && typeof im.mime_type === 'string' && typeof im.data === 'string' && im.data)
    .slice(0, 2)
    .map((im) => ({ inlineData: { mimeType: im.mime_type.slice(0, 40), data: im.data } }));
}

function openAIImageParts(images) {
  return (Array.isArray(images) ? images : [])
    .filter((im) => im && typeof im.mime_type === 'string' && typeof im.data === 'string' && im.data)
    .slice(0, 2)
    .map((im) => ({ type: 'image_url', image_url: { url: `data:${im.mime_type};base64,${im.data}` } }));
}

/* ------------------------------ vertex ------------------------------ */

/**
 * Vertex AI / Gemini Enterprise Agent Platform — express mode.
 * POST {root}/v1/publishers/<pub>/models/<model>:generateContent
 * header: x-goog-api-key: <key>
 *
 * Reasoning:
 *   - Gemini family → generationConfig.thinkingConfig.thinkingLevel
 *   - Claude family → generationConfig.thinkingConfig.thinkingBudget
 *     (CLAUDE_BUDGET map; best-effort — the engine rejects wrong values clearly)
 *   - glm/deepseek/grok → engine-managed; SlideForge sends no override
 *
 * Caching done right (roast §4, "cache properly"):
 *   1. The system prompt is STATIC across calls (orchestrator SYSTEM)
 *      → implicit caching hits; `usageMetadata.cachedContentTokenCount`
 *      is surfaced as usage.cached_tokens so the UI shows real savings.
 *   2. If config.cacheName is set (an explicitly created cachedContent
 *      resource — available on full-Vertex auth), it is attached as
 *      `cachedContent:` on every request.
 */
function vertexProvider({ apiKey, model, baseUrl, reasoning = 'low', cacheName = '' }) {
  const root = (baseUrl || 'https://aiplatform.googleapis.com').replace(/\/+$/, '');
  const v = 'v1';
  const path = modelPath(model);
  const level = ['minimal', 'low', 'medium', 'high'].includes(String(reasoning)) ? String(reasoning).toUpperCase() : 'LOW';

  function buildBody({ system, user, schema, images }) {
    const body = {};
    if (system) body.systemInstruction = { parts: [{ text: system }] }; // separate role → cache-friendly static prefix
    if (cacheName) body.cachedContent = cacheName;
    const gen = { temperature: 0.6, responseMimeType: 'application/json' };
    if (schema) gen.responseSchema = toVertexSchema(schema);
    if (!serverManagedThinking(model)) {
      if (isClaudeFamily(model)) {
        const budget = CLAUDE_BUDGET[reasoning];
        if (budget !== undefined && budget !== 0) gen.thinkingConfig = { thinkingBudget: budget };
      } else if (String(reasoning) !== 'off' && String(reasoning) !== 'none' && isGeminiFamily(model) && findModel(model)?.thinking?.includes(String(reasoning))) {
        gen.thinkingConfig = { thinkingLevel: level };
      }
    }
    body.generationConfig = gen;
    body.contents = [{ role: 'user', parts: [{ text: user }, ...inlineImages(images)] }];
    return body;
  }

  async function countTokensPing() {
    const url = `${root}/${v}/${path}:countTokens`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'ping' }] }] }),
    });
    return { url, res };
  }

  return {
    name: 'vertex',
    model,
    available: !!apiKey,
    express: v,
    path,
    /** Live key+model validation without a generation charge. */
    async validate() {
      if (!apiKey) throw new ProviderError('missing Vertex API key', 401);
      const { res } = await countTokensPing();
      const text = await res.text();
      if (!res.ok) throw new ProviderError(`vertex ${res.status}: ${text.slice(0, 300)}`, res.status);
      return { ok: true, engine: 'vertex', status: res.status };
    },
    async complete({ system, user, schema, images }) {
      if (!apiKey) throw new ProviderError('missing Vertex API key (save it in Setup → Vertex, or set SLIDEFORGE_API_KEY)', 401);
      const url = `${root}/${v}/${path}:generateContent`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(buildBody({ system, user, schema, images })),
      });
      if (!res.ok) throw new ProviderError(`vertex ${res.status}: ${(await res.text()).slice(0, 400)}`, res.status);
      const meta = extractVertexMeta(await res.json());
      return meta;
    },
  };
}

function extractVertexMeta(json) {
  const cand = json?.candidates?.[0];
  const finish = cand?.finishReason;
  if (finish && !['STOP', 'MAX_TOKENS'].includes(finish)) {
    const block = cand?.finishMessage || json?.promptFeedback?.blockReason;
    throw new ProviderError(`vertex stopped: ${finish}${block ? ` (${block})` : ''}`, 502);
  }
  const text = cand?.content?.parts?.map((p) => p.text || '').join('') ?? '';
  const u = json?.usageMetadata || {};
  const usage = {
    input_tokens: u.promptTokenCount ?? 0,
    output_tokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
    cached_tokens: u.cachedContentTokenCount ?? 0, // cache savings, straight from Vertex
    thinking_tokens: u.thoughtsTokenCount ?? 0,
  };
  return { text, usage };
}

/**
 * Convert a plain JSON schema (lowercase types, draft-2020 style) into the
 * OpenAPI subset Vertex accepts for `generationConfig.responseSchema`:
 * upper-case types, strip unsupported keys, keep enums/items/properties.
 */
export function toVertexSchema(node) {
  if (Array.isArray(node)) return node.map(toVertexSchema);
  if (!node || typeof node !== 'object') return { type: 'STRING' };
  const out = {};
  if (node.type) out.type = String(node.type).toUpperCase();
  if (!out.type && node.enum) out.type = 'STRING';
  if (node.description) out.description = node.description;
  if (node.nullable) out.nullable = true;
  if (node.format) out.format = node.format;
  if (node.enum) out.enum = node.enum;
  if (node.items) out.items = toVertexSchema(node.items);
  if (node.properties) {
    const props = {};
    for (const [k, v] of Object.entries(node.properties)) props[k] = toVertexSchema(v);
    out.properties = props;
    // Vertex honours propertyOrdering — keep author order for stable outputs.
    out.propertyOrdering = node.propertyOrdering || Object.keys(props);
  }
  if (node.propertyOrdering) out.propertyOrdering = node.propertyOrdering;
  if (node.required) out.required = node.required;
  if (Array.isArray(node.anyOf)) out.anyOf = node.anyOf.map(toVertexSchema);
  return out;
}

/* ------------------------------ gemini ------------------------------ */

function geminiProvider({ apiKey, model, baseUrl, reasoning = 'low' }) {
  const root = baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
  const level = ['minimal', 'low', 'medium', 'high'].includes(String(reasoning)) ? String(reasoning).toUpperCase() : 'LOW';
  return {
    name: 'gemini',
    model,
    available: !!apiKey,
    async validate() {
      if (!apiKey) throw new ProviderError('missing Gemini API key', 401);
      const res = await fetch(`${root}/models/${encodeURIComponent(model)}:countTokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'ping' }] }] }),
      });
      if (!res.ok) throw new ProviderError(`gemini ${res.status}: ${(await res.text()).slice(0, 300)}`, res.status);
      return { ok: true, engine: 'gemini', status: res.status };
    },
    async complete({ system, user, schema, images }) {
      if (!apiKey) throw new ProviderError('missing API key for gemini provider (set SLIDEFORGE_API_KEY or save it in Setup)', 401);
      const url = `${root}/models/${encodeURIComponent(model)}:generateContent`;
      const gen = { temperature: 0.6, responseMimeType: 'application/json' };
      if (schema) gen.responseSchema = toVertexSchema(schema);
      if (String(reasoning) !== 'off' && findModel(model)?.thinking?.includes(String(reasoning))) {
        gen.thinkingConfig = { thinkingLevel: level };
      }
      const body = {
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents: [{ role: 'user', parts: [{ text: user }, ...inlineImages(images)] }],
        generationConfig: gen,
      };
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(body) });
      if (!res.ok) throw new ProviderError(`gemini ${res.status}: ${(await res.text()).slice(0, 400)}`, res.status);
      return extractVertexMeta(await res.json());
    },
  };
}

/* -------------------------- openai-compatible -------------------------- */

function openAICompatibleProvider({ apiKey, model, baseUrl, reasoning = 'low' }) {
  const root = baseUrl || 'https://api.openai.com/v1';
  return {
    name: 'openai-compatible',
    model,
    available: !!apiKey,
    async validate() {
      if (!apiKey) throw new ProviderError('missing API key for openai-compatible provider', 401);
      const res = await fetch(`${root}/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
      if (!res.ok) throw new ProviderError(`openai-compatible ${res.status}: ${(await res.text()).slice(0, 300)}`, res.status);
      return { ok: true, engine: 'openai-compatible', status: res.status };
    },
    async complete({ system, user, schema, images }) {
      if (!apiKey) throw new ProviderError('missing API key for openai-compatible provider (set SLIDEFORGE_API_KEY or save it in Setup)', 401);
      const imgParts = openAIImageParts(images);
      const body = {
        model,
        messages: [
          { role: 'system', content: system || 'You output strict JSON only.' },
          imgParts.length
            ? { role: 'user', content: [{ type: 'text', text: user }, ...imgParts] }
            : { role: 'user', content: user },
        ],
        response_format: schema ? { type: 'json_schema', json_schema: { name: 'slideforge_schema', schema } } : { type: 'json_object' },
        temperature: 0.6,
      };
      if (String(reasoning) !== 'off' && /^(gpt-5|o[13456])/i.test(model)) body.reasoning_effort = reasoning === 'low' ? 'low' : reasoning === 'high' ? 'high' : 'medium';
      const res = await fetch(`${root}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new ProviderError(`openai-compatible ${res.status}: ${(await res.text()).slice(0, 400)}`, res.status);
      const json = await res.json();
      const u = json?.usage || {};
      return {
        text: json?.choices?.[0]?.message?.content ?? '',
        usage: {
          input_tokens: u.prompt_tokens ?? 0,
          output_tokens: u.completion_tokens ?? 0,
          cached_tokens: u.prompt_tokens_details?.cached_tokens ?? 0,
          reasoning_tokens: u.completion_tokens_details?.reasoning_tokens ?? 0,
        },
      };
    },
  };
}

export class ProviderError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}
