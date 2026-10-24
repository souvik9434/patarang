/**
 * ai/catalog.js — the model catalogue driving the provider picker.
 *
 * M-PROV: Vertex (Gemini Enterprise Agent Platform, express mode) is the
 * primary provider. Express mode has NO live model-list REST method
 * (surface = publishers.models.{generateContent,streamGenerateContent,
 * countTokens}), so — exactly like opencode does for its Vertex provider —
 * the "available models" list THIS file ships, and each entry can be live-
 * validated against the user's key (countTokens ping) before it is offered.
 *
 * Sources (verified 2026-10-23):
 *   - GEAP model pages (gemini-enterprise-agent-platform/models/*)
 *   - opencode provider DB for google-vertex (ids, variants, cache pricing)
 *   - `recon/` of GenSpark Nuxt bundles (not needed here — that was for the
 *     editor behaviour, not providers)
 *
 * Entry shape:
 *   id          — UI-facing model id (used as the provider request target)
 *   publisher   — google | anthropic | xai | zai-org | deepseek
 *   path        — the part after "publishers/<publisher>/models/"; when omitted,
 *                 id is used. Vertex call: POST {root}/v1/publishers/<p>/models/<path>:generateContent
 *   thinking    — reasoning variants OFFERED in the picker ("" = none offered);
 *                 for gemini they map to generationConfig.thinkingConfig.thinkingLevel,
 *                 for Anthropic models to thinkingConfig.thinkingBudget via CLAUDE_BUDGET.
 *   cache       — caching supported on this engine (explicit or implicit)
 *   tools       — function declarations / responseSchema constrained decoding
 *   context     — practical context window in tokens (for UI hints)
 *   status      — active | beta | legacy
 */
export const PROVIDERS = [
  {
    id: 'vertex',
    label: 'Vertex AI (Google Cloud · Agent Studio key)',
    auth: 'x-goog-api-key',
    source: 'catalog',
  },
  {
    id: 'gemini',
    label: 'Gemini API (Google AI Studio key)',
    auth: 'key param',
    source: 'catalog',
  },
  {
    id: 'openai-compatible',
    label: 'OpenAI-compatible (OpenAI, OpenRouter, …)',
    auth: 'Bearer key',
    source: 'catalog',
  },
  // NOTE (2026-10-23): NO 'mock' entry — the UI/catalog must never offer an
  // offline mode. SlideForge works ONLY when a real provider + API key is
  // configured; otherwise the app shows "AI not connected". The deterministic
  // createMockProvider() survives ONLY as an explicit test double, imported
  // directly by tests — unreachable from any config/env/UI path.
];

/** Anthropic extended-thinking budget map used on Vertex generateContent. */
export const CLAUDE_BUDGET = { none: 0, low: 1024, medium: 8192, high: 24576, xhigh: 49152, max: 63999 };

export const MODELS = [
  {
    id: 'gemini-4-argon',
    publisher: 'google',
    label: 'Gemini 4 Argon',
    family: 'gemini',
    thinking: ['low', 'medium', 'high'],
    cache: true, tools: true, context: 1000000, status: 'active',
    note: 'Flagship. Best deep-planning quality; slower and pricier than Flash.',
  },
  {
    id: 'gemini-3.8-flash',
    publisher: 'google',
    label: 'Gemini 3.8 Flash',
    family: 'gemini',
    thinking: ['minimal', 'low', 'medium', 'high'],
    cache: true, tools: true, context: 1000000, status: 'active',
    note: 'DEFAULT. Fastest strict-JSON pipeline model with thinking control.',
  },
  { id: 'gemini-3.7-flash', publisher: 'google', label: 'Gemini 3.7 Flash', family: 'gemini', thinking: ['low', 'medium', 'high'], cache: true, tools: true, context: 1000000, status: 'active' },
  { id: 'gemini-3.6-flash', publisher: 'google', label: 'Gemini 3.6 Flash', family: 'gemini', thinking: ['low', 'medium', 'high'], cache: true, tools: true, context: 1000000, status: 'active' },
  { id: 'gemini-3.5-flash', publisher: 'google', label: 'Gemini 3.5 Flash', family: 'gemini', thinking: ['low', 'medium', 'high'], cache: true, tools: true, context: 1000000, status: 'active' },
  {
    id: 'gemini-3.5-flash-lite',
    publisher: 'google',
    label: 'Gemini 3.5 Flash Lite',
    family: 'gemini',
    thinking: ['minimal', 'low', 'medium', 'high'],
    cache: true, tools: true, context: 1000000, status: 'active',
    note: 'Cheapest per call; good for outline/verify, weaker at tight spec budgets.',
  },
  { id: 'gemini-3.1-pro', publisher: 'google', label: 'Gemini 3.1 Pro', family: 'gemini', thinking: ['low', 'medium', 'high'], cache: true, tools: true, context: 2000000, status: 'active' },
  { id: 'gemini-2.5-flash', publisher: 'google', label: 'Gemini 2.5 Flash', family: 'gemini', thinking: ['minimal', 'low', 'medium', 'high'], cache: true, tools: true, context: 1000000, status: 'legacy' },
  {
    id: 'claude-sonnet-5-5',
    publisher: 'anthropic',
    label: 'Claude Sonnet 5.5 (Vertex partner)',
    family: 'claude',
    thinking: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    cache: true, tools: true, context: 200000, status: 'active',
    note: 'Vertex publisher path + Anthropic thinking-budget mapping.',
  },
  { id: 'claude-opus-5-5', publisher: 'anthropic', label: 'Claude Opus 5.5 (Vertex partner)', family: 'claude', thinking: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], cache: true, tools: true, context: 200000, status: 'active' },
  { id: 'claude-haiku-5-5', publisher: 'anthropic', label: 'Claude Haiku 5.5 (Vertex partner)', family: 'claude', thinking: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], cache: true, tools: true, context: 200000, status: 'active' },
  { id: 'claude-fable-5-1', publisher: 'anthropic', label: 'Claude Fable 5.1 (Vertex partner)', family: 'claude', thinking: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], cache: true, tools: true, context: 200000, status: 'active' },
  { id: 'grok-4.7', publisher: 'xai', label: 'Grok 4.7 (Vertex MaaS)', family: 'grok', thinking: ['low', 'medium', 'high'], cache: true, tools: true, context: 200000, status: 'beta', note: 'Reasoning is owned by the serving side; SlideForge sends no override unless a level matches.' },
  { id: 'glm-5.2', publisher: 'zai-org', label: 'GLM 5.2 (Vertex MaaS)', family: 'glm', thinking: [], cache: true, tools: true, context: 200000, status: 'beta', note: 'Thinking is a server-side variant; SlideForge sends no override.' },
  { id: 'deepseek-v4.1-flash', publisher: 'deepseek', label: 'DeepSeek V4.1 Flash (Vertex MaaS)', family: 'deepseek', thinking: [], cache: true, tools: true, context: 128000, status: 'beta', note: 'Thinking is a server-side variant; SlideForge sends no override.' },
];

/** Models relevant to the picker, sorted: flagship, then active Google, then partners. */
const PUBLISHER_ORDER = { google: 0, anthropic: 1, xai: 2, 'zai-org': 3, deepseek: 4 };
const FLAGSHIP_RANK = { 'gemini-4-argon': 1, 'gemini-3.8-flash': 2 };
export function listModels(providerId) {
  const order = { active: 0, beta: 1, legacy: 2 };
  return MODELS
    .filter((m) => (providerId === 'vertex' ? true : m.publisher === 'google' && providerId === 'gemini'))
    .sort((a, b) => (order[a.status] - order[b.status]) || ((FLAGSHIP_RANK[a.id] ?? 9) - (FLAGSHIP_RANK[b.id] ?? 9)) || ((PUBLISHER_ORDER[a.publisher] ?? 9) - (PUBLISHER_ORDER[b.publisher] ?? 9)) || a.id.localeCompare(b.id));
}

/** Suggested default model for a provider (the picker preselects this). */
export function defaultModelFor(providerId) {
  return DEFAULT_MODELS[providerId] || listModels(providerId)[0]?.id || '';
}

export function findModel(id) {
  return MODELS.find((m) => m.id === id) || null;
}

/** Publisher path tail for a model on Vertex: "publishers/{p}/models/{m}". */
export function modelPath(id) {
  const m = findModel(id);
  const publisher = m?.publisher || 'google';
  const tail = m?.id || id;
  return `publishers/${publisher}/models/${tail}`;
}

/** Families whose reasoning is enforced by the serving side — do not send. */
export function serverManagedThinking(id) {
  const m = findModel(id);
  return !m || m.family === 'glm' || m.family === 'deepseek' || m.family === 'grok';
}

export function isGeminiFamily(id) {
  const m = findModel(id);
  return !m || m.family === 'gemini' || (typeof id === 'string' && id.startsWith('gemini'));
}

export function isClaudeFamily(id) {
  const m = findModel(id);
  return !!m && m.family === 'claude';
}

/** Default model per provider id (mock is not a mode — see PROVIDERS note). */
export const DEFAULT_MODELS = {
  vertex: 'gemini-3.8-flash',
  gemini: 'gemini-3.8-flash',
  'openai-compatible': 'gpt-4.1-mini',
};

