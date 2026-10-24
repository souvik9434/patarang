/**
 * api.js — HTTP API.
 *
 * Route names mirror the OBSERVED GenSpark contracts where they exist
 * (/api/project/slide_data, /api/project/save_slide_data) so a client written
 * against SlideForge reads like a client written against Genspark.
 * SlideForge-specific routes live under /api/decks/.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReadStream, existsSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import * as store from './store.js';
import { normalizeSpec, validateSpec, ARCHETYPES, THEMES, THEME_IDS, FONT_PAIR_IDS, CANVAS_MODES } from './spec.js';
import { PRESET_CATALOG, expandPreset } from './presets.js';
import { createProvider, ProviderError } from './ai/provider.js';
import { generateDeck, rewriteSlot, planOutline, planSlides, renderSlides, verifyDeck, scopedVerify, stampProvenance, attachProvenance } from './ai/orchestrator.js';
import { routeChat, editPageSpec } from './ai/chat.js';
import { loadConfig, saveConfig, publicConfig, maskKey } from './ai/config-store.js';
import { authorize, touchAgent, setEnabled as setAgentAccess, publicAgents, rotateToken, loadAgents, maskToken, recordAgentOp, pushAgentInbox, clearAgentInbox } from './agents-store.js';
import { PROVIDERS, listModels, defaultModelFor } from './ai/catalog.js';
import { parseSlideHtml, setSlot, listSlots } from './render/parse.js';
import { renderSlideHtml } from './render/slide-html.js';
import { sanitize } from './sanitize.js';
import { exportPdf, exportPng, exportPptxNative, exportPptxImage, ExportError, closeBrowser } from './export/index.js';
import {
  MEDIA_DIR, ensureDeckMediaDir, readMultipart, sniff, probeSize, generatedName,
  safeDeckId, listDeckMedia, mediaFileStream, LIMITS,
} from './media.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const FONTS_DIR = path.join(PUBLIC_DIR, 'fonts');
const EXPORT_DIR = path.join(ROOT, 'exports');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.pdf': 'application/pdf',
};

const MAX_BODY = 4 * 1024 * 1024;

export function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error('payload too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(raw); } catch { throw new Error('invalid JSON body'); }
}

function sseHeaders() {
  return {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  };
}

/* ------------------------------ routing ------------------------------ */

export async function handleApi(req, res, url) {
  const p = url.pathname;
  const q = url.searchParams;

  /* ---- AGENT CONNECT (⛓ tab) — off by default, user-managed in the UI ---- */
  if (p === '/api/agents/status' && req.method === 'GET') {
    return json(res, 200, { status: 0, data: publicAgents(), message: '' });
  }
  if (p === '/api/agents/access' && req.method === 'POST') {
    const body = await readBody(req);
    setAgentAccess(body.enabled === true);
    return json(res, 200, { status: 0, data: publicAgents(), message: body.enabled ? 'agent access ON' : 'agent access OFF' });
  }
  if (p === '/api/agents/reveal' && req.method === 'POST') {
    // explicit user click — returns the RAW token once for copy-paste
    return json(res, 200, { status: 0, data: { token: loadAgents().token }, message: '' });
  }
  if (p === '/api/agents/rotate' && req.method === 'POST') {
    const s = rotateToken();
    return json(res, 200, { status: 0, data: { ...publicAgents(), token: s.token }, message: 'token rotated — old agents stop immediately' });
  }

  if (p === '/api/agents/inbox' && req.method === 'POST') {
    const body = await readBody(req);
    const item = pushAgentInbox(body);
    return json(res, 200, { status: 0, data: { queued: item, inbox: publicAgents().inbox }, message: 'queued for MCP agent' });
  }

  /* ---- AGENT CONTROL ROUTES (Bearer token required; opencode / Freebuff MCP) ---- */
  const agentName = () => (req.headers['x-agent-name'] ? String(req.headers['x-agent-name']).slice(0, 24) : 'opencode');
  if (p.startsWith('/api/agents/schema') || p.startsWith('/api/agents/decks') || p.startsWith('/api/agents/slides') || p.startsWith('/api/agents/media') || p.startsWith('/api/agents/export') || p.startsWith('/api/agents/chat')) {
    if (!authorize(req)) { return json(res, 403, { status: 403, data: null, message: 'agent access forbidden (enable in the ⛓ Connect tab, or token mismatch — rotate if needed)' }); }
    touchAgent(agentName());

    if (p === '/api/agents/schema' && req.method === 'GET') {
      return json(res, 200, { status: 0, data: agentSchemaData(), message: '' });
    }
    if (p === '/api/agents/media' && req.method === 'POST') {
      return agentUploadMedia(req, res, await readBody(req), agentName());
    }
    if (p === '/api/agents/decks' && req.method === 'GET') {
      return json(res, 200, { status: 0, data: { decks: store.listDecks(), inbox: publicAgents().inbox }, message: '' });
    }
    if (p === '/api/agents/decks/build' && req.method === 'POST') {
      return agentBuildDeck(req, res, await readBody(req), agentName());
    }
    const mmSlides = p.match(/^\/api\/agents\/decks\/([\w-]+)\/slides$/);
    if (mmSlides && req.method === 'POST') {
      return agentSaveSlides(req, res, mmSlides[1], await readBody(req), agentName());
    }
    const mmManage = p.match(/^\/api\/agents\/decks\/([\w-]+)\/manage$/);
    if (mmManage && req.method === 'POST') {
      return agentManageDeck(req, res, mmManage[1], await readBody(req), agentName());
    }
    const mm1 = p.match(/^\/api\/agents\/decks\/([\w-]+)$/);
    if (mm1 && req.method === 'GET') {
      const loaded = store.loadDeck(mm1[1]);
      if (!loaded) return json(res, 404, { status: 404, data: null, message: 'deck not found' });
      const ordered = loaded.deck.file_contents.slice().sort((a, b) => (a.page_index ?? 0) - (b.page_index ?? 0));
      const pages = ordered.map((fc, i) => {
        const parsed = parseSlideHtml(loaded.pages[fc.page_id] || fc.content || '');
        return {
          page_no: i + 1, page_id: fc.page_id,
          title: parsed.spec.title || '',
          archetype: parsed.spec.archetype,
          theme: parsed.spec.theme,
          spec: parsed.spec,
          slots: parsed.spec ? listSlots(parsed.spec).map((s) => ({ slot: s.slot, value: String(s.value ?? '') })) : [],
        };
      });
      return json(res, 200, { status: 0, data: { project_id: mm1[1], title: loaded.deck.meta_data.file_name, page_count: pages.length, version_number: loaded.deck.meta_data.version_number, editor_url: `http://127.0.0.1:4173/?deck=${mm1[1]}`, pages, history: loaded.history.slice(-8) }, message: '' });
    }
    if (p === '/api/agents/chat' && req.method === 'POST') {
      const body = await readBody(req);
      // Fast-path: if an MCP agent passes a structured JSON command in `message`
      // (e.g. {"action":"build","title":"...","slides":[...]}), execute directly
      // with ZERO dependency on the rate-limited BYO API key!
      const rawMsg = String(body?.message || '').trim();
      if (rawMsg.startsWith('{')) {
        try {
          const cmd = JSON.parse(rawMsg);
          if (cmd.action === 'schema') return json(res, 200, { status: 0, data: agentSchemaData(), message: '' });
          if (cmd.action === 'upload_media') return agentUploadMedia(req, res, cmd, agentName());
          if (cmd.action === 'build') return agentBuildDeck(req, res, cmd, agentName());
          if (cmd.action === 'save_slides') return agentSaveSlides(req, res, cmd.project_id || body.project_id, cmd, agentName());
          if (cmd.action === 'manage' || ['theme', 'delete', 'reorder', 'notes'].includes(cmd.action)) {
            return agentManageDeck(req, res, cmd.project_id || body.project_id, cmd, agentName());
          }
        } catch { /* fall through to natural-language streamChat */ }
      }
      const out = await captureStreamChat(body);
      return json(res, 200, { status: out.outcome === 'ai_error' ? 502 : 0, data: out, message: out.message || '' });
    }
    const mm2 = p.match(/^\/api\/agents\/slides\/text$/);
    if (mm2 && req.method === 'POST') {
      return agentEditText(req, res, await readBody(req), agentName());
    }
    if (p === '/api/agents/export' && req.method === 'POST') {
      const body = await readBody(req);
      const id = safeDeckId(String(body.project_id || ''));
      if (!id) return json(res, 400, { status: 400, data: null, message: 'project_id required' });
      return handleExport(req, res, id, { format: body.format || 'pdf' });
    }
  }

  /* ---- provider info ---- */
  if (p === '/api/provider' && req.method === 'GET') {
    const cfg = loadConfig();
    const pub = publicConfig();
    return json(res, 200, {
      status: 0,
      data: {
        provider: cfg.provider,
        model: cfg.model,
        reasoning: cfg.reasoning,
        key_hint: cfg.apiKey ? maskKey(cfg.apiKey) : '',
        key_present: !!cfg.apiKey,
        connected: pub.connected,
        config_source: process.env.SLIDEFORGE_API_KEY ? 'env' : 'file',
      },
      message: '',
    });
  }

  /* ---- AI setup (M-PROV): catalogue, saved config, live validation ---- */
  if (p === '/api/ai/models' && req.method === 'GET') {
    const cfg = loadConfig();
    const providerId = q.get('provider') || cfg.provider;
    return json(res, 200, { status: 0, data: { provider: providerId, default: defaultModelFor(providerId), models: listModels(providerId) }, message: '' });
  }

  if (p === '/api/ai/catalog' && req.method === 'GET') {
    return json(res, 200, { status: 0, data: { providers: PROVIDERS }, message: '' });
  }

  if (p === '/api/ai/config' && req.method === 'GET') {
    return json(res, 200, { status: 0, data: publicConfig(), message: '' });
  }

  if (p === '/api/ai/config' && req.method === 'POST') {
    const body = await readBody(req);
    const before = loadConfig();
    const cfg = saveConfig({
      provider: body.provider,
      apiKey: typeof body.apiKey === 'string' && body.apiKey ? body.apiKey : (body.clear_key ? null : undefined),
      model: body.model,
      reasoning: body.reasoning,
      baseUrl: body.baseUrl,
      cacheName: body.cacheName,
    });
    // Live validation when asked (or whenever the engine changed) — cheap
    // countTokens ping, no generation charge, real GCP error on a bad key.
    let validation = null;
    if (body.validate !== false) {
      try {
        const prov = createProvider({});
        if (prov.validate) validation = { ...(await prov.validate()) };
        else validation = { ok: true, engine: cfg.provider };
      } catch (e) {
        // keep the saved config (harmless), but surface the error verbatim
        return json(res, 200, {
          status: 0,
          data: { config: publicConfig(), validation: { ok: false, error: e?.message || String(e), status: e instanceof ProviderError ? e.status : 502 }, previous: { model: before.model, provider: before.provider } },
          message: 'saved, but validation failed',
        });
      }
    }
    return json(res, 200, { status: 0, data: { config: publicConfig(), validation }, message: validation && validation.ok === false ? 'validation failed' : '' });
  }

  if (p === '/api/ai/validate' && req.method === 'POST') {
    // Validate a draft (unsaved) configuration: parse a draft key/model silently.
    const body = await readBody(req);
    try {
      const prov = createProvider({
        provider: body.provider,
        apiKey: typeof body.apiKey === 'string' && body.apiKey ? body.apiKey : loadConfig().apiKey,
        model: body.model,
        baseUrl: body.baseUrl,
      });
      const probe = prov.validate ? await prov.validate() : { ok: true };
      return json(res, 200, { status: 0, data: { ...probe, model: body.model || '' }, message: '' });
    } catch (e) {
      return json(res, 200, { status: 0, data: { ok: false, error: e?.message || String(e), status: e instanceof ProviderError ? e.status : 502 }, message: 'validation failed' });
    }
  }

  /* ---- CHAT (SSE) — one message → one routed deck tool (Genspark parity) ---- */
  if (p === '/api/ai/chat' && req.method === 'POST') {
    const body = await readBody(req);
    return streamChat(req, res, body);
  }

  /* ---- decks ---- */
  if (p === '/api/decks' && req.method === 'GET') {
    return json(res, 200, { status: 0, data: { decks: store.listDecks() }, message: '' });
  }

  if (p === '/api/decks' && req.method === 'POST') {
    const body = await readBody(req);
    const deck = store.createDeck({ title: body.title || body.brief?.slice(0, 60) || 'Untitled deck', file_prefix: body.file_prefix || 'deck' });
    return json(res, 200, { status: 0, data: { project_id: deck.project_id, meta_data: deck.meta_data }, message: '' });
  }

  let m = p.match(/^\/api\/decks\/([\w-]+)$/);
  if (m && req.method === 'GET') {
    const loaded = store.loadDeck(m[1]);
    if (!loaded) return json(res, 404, { status: 404, data: null, message: 'deck not found' });
    return json(res, 200, { status: 0, data: { deck: loaded.deck, history: loaded.history }, message: '' });
  }

  /* ---- GENERATE (SSE) — create + generate in one call ---- */
  m = p.match(/^\/api\/decks\/generate$/);
  if (m && req.method === 'POST') {
    const body = await readBody(req);
    return streamGenerate(req, res, body);
  }

  /* ---- ASK (SSE) — regenerate or rewrite a slot ---- */
  m = p.match(/^\/api\/decks\/([\w-]+)\/ask$/);
  if (m && req.method === 'POST') {
    const body = await readBody(req);
    return streamAsk(req, res, m[1], body);
  }

  /* ---- VERIFY (M-ACC, SSE) — scoped fact-check + notes into slides ---- */
  m = p.match(/^\/api\/decks\/([\w-]+)\/verify$/);
  if (m && req.method === 'POST') {
    const body = await readBody(req);
    return streamVerify(req, res, m[1], body);
  }

  /* ---- GEOMETRY (M4 drag commit) — set one element's rect on one page ---- */
  m = p.match(/^\/api\/decks\/([\w-]+)\/slides\/([\w-]+)\/geometry$/);
  if (m && req.method === 'POST') {
    const body = await readBody(req);
    return setGeometry(req, res, m[1], m[2], body);
  }

  /* ---- ELEMENT STYLE (CS.4 Inspector Studio) — persist style/text on one [data-sf-id] ---- */
  m = p.match(/^\/api\/decks\/([\w-]+)\/slides\/([\w-]+)\/style$/);
  if (m && req.method === 'POST') {
    const body = await readBody(req);
    return setElementStyle(req, res, m[1], m[2], body);
  }

  /* ---- DUPLICATE (Ctrl+D) — clone an element's geometry + content ---- */
  m = p.match(/^\/api\/decks\/([\w-]+)\/slides\/([\w-]+)\/duplicate$/);
  if (m && req.method === 'POST') {
    const body = await readBody(req);
    return duplicateElement(req, res, m[1], m[2], body);
  }

  /* ---- DELETE a duplicated extra (Del/Backspace) ---- */
  m = p.match(/^\/api\/decks\/([\w-]+)\/slides\/([\w-]+)\/extras\/([\w-]+)$/);
  if (m && req.method === 'DELETE') {
    return deleteExtra(req, res, m[1], m[2], m[3]);
  }
  if (p === '/api/media/upload' && req.method === 'POST') {
    return handleMediaUpload(req, res);
  }

  if (p === '/api/media/list' && req.method === 'GET') {
    const deckId = safeDeckId(q.get('deck_id'));
    if (!deckId) return json(res, 400, { status: 400, data: null, message: 'deck_id required' });
    if (!store.loadDeck(deckId)) return json(res, 404, { status: 404, data: null, message: 'deck not found' });
    return json(res, 200, { status: 0, data: listDeckMedia(deckId), message: '' });
  }

  m = p.match(/^\/api\/decks\/([\w-]+)\/slides\/([\w-]+)\/image$/);
  if (m && req.method === 'POST') {
    const body = await readBody(req);
    return setSlideImage(req, res, m[1], m[2], body);
  }

  /* ---- slide_data (GenSpark parity) ---- */
  if (p === '/api/project/slide_data' && req.method === 'GET') {

    const id = q.get('project_id');
    if (!id) return json(res, 400, { status: 400, data: null, message: 'project_id required' });
    const payload = store.getSlideData(id, { with_version_history: q.get('with_version_history') !== 'false' });
    if (!payload) return json(res, 404, { status: 404, data: null, message: 'deck not found' });
    return json(res, 200, payload);
  }

  /* ---- save_slide_data (GenSpark parity) ---- */
  if (p === '/api/project/save_slide_data' && req.method === 'POST') {
    const body = await readBody(req);
    applyManualEditProvenance(body); // M-ACC ledger: manual text edits get user origin
    const result = store.saveSlideData(body.project_id, body);
    return json(res, result.status === 0 ? 200 : result.status, result);
  }

  /* ---- pages ---- */
  m = p.match(/^\/api\/decks\/([\w-]+)\/pages$/);
  if (m && req.method === 'POST') {
    const body = await readBody(req);
    const id = m[1];
    const { spec } = parseSlideHtml(body.html || '');
    const html = body.html || renderSlideHtml({ ...spec, archetype: 'bullets', title: body.title || 'New slide', theme: body.theme || 'midnight' });
    const added = store.addPage(id, { html, title: body.title || 'New slide' });
    if (!added) return json(res, 404, { status: 404, data: null, message: 'deck not found' });
    return json(res, 200, { status: 0, data: { page_id: added.page_id }, message: '' });
  }

  m = p.match(/^\/api\/decks\/([\w-]+)\/pages\/([\w-]+)$/);
  if (m && req.method === 'DELETE') {
    const ok = store.deletePage(m[1], m[2]);
    return json(res, ok ? 200 : 404, { status: ok ? 0 : 404, data: null, message: ok ? '' : 'page not found' });
  }

  m = p.match(/^\/api\/decks\/([\w-]+)\/reorder$/);
  if (m && req.method === 'POST') {
    const body = await readBody(req);
    const ok = store.reorderPages(m[1], body.order || []);
    return json(res, ok ? 200 : 400, { status: ok ? 0 : 400, data: null, message: ok ? '' : 'invalid order' });
  }

  m = p.match(/^\/api\/decks\/([\w-]+)\/history$/);
  if (m && req.method === 'GET') {
    return json(res, 200, { status: 0, data: { history: store.getHistory(m[1]) }, message: '' });
  }

  /* ---- export ---- */
  m = p.match(/^\/api\/decks\/([\w-]+)\/export$/);
  if (m && req.method === 'POST') {
    const body = await readBody(req);
    return handleExport(req, res, m[1], body);
  }

  return false;
}

/* --------------------------- generation --------------------------- */

async function streamGenerate(req, res, body) {
  const deck = store.createDeck({ title: body.title || body.brief?.slice(0, 60) || 'Untitled deck', file_prefix: body.file_prefix || 'deck' });
  res.writeHead(200, sseHeaders());
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  try {
    const provider = createProvider({});
    send({ type: 'deck', project_id: deck.project_id, meta_data: deck.meta_data });

    const result = await generateDeck(provider, body.brief || '', {
      slides: Number(body.slides) || 8,
      theme: body.theme || 'midnight',
      onStep: (s) => send({ type: 'step', ...s }),
    });

    const pages = result.pages.map((p) => ({ page_id: p.page_id, content: p.content }));
    store.replacePages(deck.project_id, pages, { note: 'generated' });
    send({ type: 'done', project_id: deck.project_id, page_count: pages.length, outline: result.outline, verification: result.verification, issues: result.issues, usage: result.usage });
  } catch (e) {
    send({ type: 'error', message: e?.message || String(e), status: e instanceof ProviderError ? e.status : 500 });
  }
  res.end();
}

async function streamAsk(req, res, id, body) {
  res.writeHead(200, sseHeaders());
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  const loaded = store.loadDeck(id);
  if (!loaded) { send({ type: 'error', message: 'deck not found', status: 404 }); res.end(); return; }

  try {
    const provider = createProvider({});
    const instruction = String(body.prompt || '').trim();

    /* --- targeted rewrite of one slot (point-and-edit) --- */
    if (body.slot && body.page_id) {
      send({ type: 'step', step: 'rewrite', message: 'Rewriting selection…' });
      const fc = loaded.deck.file_contents.find((f) => f.page_id === body.page_id);
      const parsed = parseSlideHtml(loaded.pages[body.page_id] || '');
      const out = await rewriteSlot(provider, { spec: parsed.spec, slot: body.slot, instruction });
      const newSpec = stampProvenance(setSlot(parsed.spec, body.slot, out.value), body.slot,
        { source: 'ai:rewrite', ref: instruction.slice(0, 30), confidence: 0.8 }); // M-ACC ledger
      const html = renderSlideHtml(newSpec, { fontBase: '/fonts/' });
      const res2 = store.saveSlideData(id, {
        project_id: id,
        updated_file_contents: [{ page_id: body.page_id, content: html, page_index: fc?.page_index ?? 0, is_edited: true, action: 'update' }],
        updated_meta_data: { page_num: loaded.deck.meta_data.page_num },
        is_manual_edit: false,
        version_number: loaded.deck.meta_data.version_number,
      });
      send({ type: 'done', mode: 'rewrite', page_id: body.page_id, slot: body.slot, value: out.value, reason: out.reason, status: res2.status, usage: out.usage });
      res.end();
      return;
    }

    /* --- full regeneration --- */
    send({ type: 'step', step: 'outline', message: 'Planning narrative…' });
    const outline = await planOutline(provider, instruction, { slides: Number(body.slides) || loaded.deck.file_contents.length || 8, theme: body.theme || 'midnight' });
    send({ type: 'step', step: 'slides', message: 'Writing slide content…' });
    const slidesStep = await planSlides(provider, outline, { theme: body.theme || 'midnight' });
    send({ type: 'step', step: 'render', message: 'Rendering slides…' });
    const pages = renderSlides(slidesStep.specs);
    send({ type: 'step', step: 'verify', message: 'Verifying content…' });
    const verification = await verifyDeck(provider, slidesStep.specs);

    const usage = { input_tokens: 0, output_tokens: 0, cached_tokens: 0, thinking_tokens: 0 };
    for (const u of [outline.usage, slidesStep.usage, verification.usage]) {
      if (!u) continue;
      for (const k of Object.keys(usage)) usage[k] += Number(u[k] || 0);
    }

    store.replacePages(id, pages.map((pg) => ({ page_id: pg.page_id, content: pg.content })), { note: 'regenerated' });
    send({ type: 'done', mode: 'regenerate', page_count: pages.length, outline, verification, issues: slidesStep.issues, usage });
  } catch (e) {
    send({ type: 'error', message: e?.message || String(e), status: e instanceof ProviderError ? e.status : 500 });
  }
  res.end();
}

/* --------------------------- CHAT (conversational tools) --------------------------- */

/**
 * One user message → ONE routed deck tool. The router LLM call emits a reply
 * sentence (the AI "talks"), then the action executes through the same pure
 * pipeline as generate/ask. NO offline path: createProvider throws a clean
 * "AI is not connected" ProviderError when no provider + key is configured.
 */
const CHAT_APPEND_CAP = 6;
const CHAT_SLIDES_MAX = 14;

async function streamChat(req, res, body) {
  res.writeHead(200, sseHeaders());
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  const message = String(body.message || '').trim().slice(0, 2000);
  if (!message) { send({ type: 'error', message: 'Type a message first', status: 400 }); res.end(); return; }

  const usage = { input_tokens: 0, output_tokens: 0, cached_tokens: 0, thinking_tokens: 0 };
  const bump = (u) => { for (const k of Object.keys(usage)) usage[k] += Number(u?.[k] || 0); };

  try {
    const provider = createProvider({});
    const deckId = String(body.project_id || '').slice(0, 64);
    const loaded = deckId ? store.loadDeck(deckId) : null;
    const titlesOf = (ld) => (ld.deck.file_contents || [])
      .sort((a, b) => (a.page_index ?? 0) - (b.page_index ?? 0))
      .map((fc) => (parseSlideHtml(ld.pages[fc.page_id] || fc.content || '').spec.title || ''))
      .filter(Boolean);

    const intent = await routeChat(provider, {
      message,
      deckOpen: !!loaded,
      page_no: Number(body.page_no) || 0,
      page_count: loaded?.deck.file_contents.length || 0,
      selection: body.selection && typeof body.selection === 'object' ? { sfId: String(body.selection.sfId || '').slice(0, 64), slot: String(body.selection.slot || '').slice(0, 40) } : null,
      selection_text: String(body.selection_text || '').slice(0, 300),
      slide_titles: loaded ? titlesOf(loaded) : [],
    });
    bump(intent.usage);
    send({ type: 'reply', text: intent.reply, action: intent.action });

    /* ---------- answer — pure conversation ---------- */
    if (intent.action === 'answer') {
      send({ type: 'done', mode: 'answer', usage, project_id: deckId || null });
      res.end();
      return;
    }

    /* ---------- create — "make me 4 slides about …" ---------- */
    if (intent.action === 'create') {
      let id = deckId;
      if (loaded) {
        send({ type: 'step', step: 'create', message: `Rebuilding ${loaded.deck.file_contents.length}-slide deck from scratch…` });
      } else {
        send({ type: 'step', step: 'create', message: 'Creating a new deck…' });
        const deck = store.createDeck({ title: (intent.brief || message).slice(0, 60) || 'Untitled deck', file_prefix: 'deck' });
        id = deck.project_id;
        send({ type: 'deck', project_id: id, meta_data: deck.meta_data });
      }
      const slides = Math.max(3, Math.min(Number(intent.slides) || 8, CHAT_SLIDES_MAX));
      const theme = intent.theme || 'midnight';
      const brief = String(intent.brief || message);
      const result = await generateDeck(provider, brief, { slides, theme, onStep: (s) => send({ type: 'step', ...s }) });
      const pages = result.pages.map((p) => ({ page_id: p.page_id, content: p.content }));
      store.replacePages(id, pages, { note: 'created via chat' });
      bump(result.usage);
      send({ type: 'done', mode: 'create', project_id: id, page_count: pages.length, slides: pages.length, issues: result.issues, usage, outline: result.outline });
      res.end();
      return;
    }

    if (!loaded) {
      send({ type: 'error', message: 'No deck is open — ask me to create one first (e.g. "make me 5 slides about X")', status: 409 });
      res.end();
      return;
    }

    /* ---------- add_slides ---------- */
    if (intent.action === 'add_slides') {
      const n = Math.max(1, Math.min(Number(intent.slides) || 1, CHAT_APPEND_CAP));
      const theme = intent.theme || 'midnight';
      send({ type: 'step', step: 'outline', message: `Planning ${n} new slide${n > 1 ? 's' : ''}…` });
      const brief = String(intent.brief || intent.instruction || message);
      const outline = await planOutline(provider, brief, { slides: n, theme });
      bump(outline.usage);
      send({ type: 'step', step: 'slides', message: 'Writing slide content…' });
      const slidesStep = await planSlides(provider, outline, { theme });
      bump(slidesStep.usage);
      const rendered = renderSlides(slidesStep.specs);
      let lastPageId = null;
      for (const pg of rendered) {
        const added = store.addPage(deckId, { html: pg.content, title: pg.spec.title || 'New slide' });
        if (added) lastPageId = added.page_id;
      }
      const after = store.loadDeck(deckId);
      send({ type: 'done', mode: 'add_slides', project_id: deckId, page_id: lastPageId, page_count: after?.deck.file_contents.length, added: rendered.length, usage });
      res.end();
      return;
    }

    const pagesSorted = () => loaded.deck.file_contents.slice().sort((a, b) => (a.page_index ?? 0) - (b.page_index ?? 0));
    const savePageHtml = (pageId, html, note) => {
      const fc = loaded.deck.file_contents.find((f) => f.page_id === pageId);
      return store.saveSlideData(deckId, {
        project_id: deckId,
        updated_file_contents: [{ page_id: pageId, content: html, page_index: fc?.page_index ?? 0, is_edited: false, action: 'update' }],
        updated_meta_data: { page_num: loaded.deck.meta_data.page_num },
        is_manual_edit: false,
        version_number: loaded.deck.meta_data.version_number,
      });
    };

    /* ---------- edit_slide — "fix slide 4" ---------- */
    if (intent.action === 'edit_slide') {
      const pageNo = Math.max(1, Number(intent.page_no) || Number(body.page_no) || 1);
      const targets = pagesSorted();
      const fc = targets[pageNo - 1];
      if (!fc) { send({ type: 'error', message: `This deck has ${targets.length} slide${targets.length === 1 ? '' : 's'} — no slide ${pageNo}`, status: 400 }); res.end(); return; }
      const parsed = parseSlideHtml(loaded.pages[fc.page_id] || fc.content || '');
      const instruction = String(intent.instruction || message);
      send({ type: 'step', step: 'edit', message: `Editing slide ${pageNo}…` });
      const out = await editPageSpec(provider, { spec: parsed.spec, instruction });
      bump(out.usage);
      if (!out.spec) {
        send({ type: 'note', text: out.issues?.length ? out.issues.join('; ') : 'I could not produce a valid rewrite for that slide — nothing was changed.' });
        send({ type: 'done', mode: 'edit_slide', project_id: deckId, usage });
        res.end();
        return;
      }
      const res2 = savePageHtml(fc.page_id, out.html);
      if (res2.status !== 0) throw new Error(res2.message || 'save failed');
      send({ type: 'done', mode: 'edit_slide', project_id: deckId, page_id: fc.page_id, page_no: pageNo, usage });
      res.end();
      return;
    }

    /* ---------- edit_selection — the exact selected element/text ---------- */
    if (intent.action === 'edit_selection') {
      const slot = String(body.selection?.slot || intent.slot || '').slice(0, 40);
      const pageNo = Number(body.page_no) || 1;
      if (!slot) { send({ type: 'error', message: 'Select the element on the canvas first, then tell me what to change', status: 400 }); res.end(); return; }
      const fc = pagesSorted()[pageNo - 1];
      if (!fc) { send({ type: 'error', message: 'slide not found', status: 400 }); res.end(); return; }
      const parsed = parseSlideHtml(loaded.pages[fc.page_id] || fc.content || '');
      const instruction = String(intent.instruction || message);
      send({ type: 'step', step: 'rewrite', message: 'Rewriting the selection…' });
      const out = await rewriteSlot(provider, { spec: parsed.spec, slot, instruction });
      bump(out.usage);
      const newSpec = stampProvenance(setSlot(parsed.spec, slot, out.value), slot, { source: 'ai:rewrite', ref: instruction.slice(0, 30), confidence: 0.8 });
      const html = renderSlideHtml(newSpec, { fontBase: '/fonts/' });
      const res2 = savePageHtml(fc.page_id, html);
      if (res2.status !== 0) throw new Error(res2.message || 'save failed');
      send({ type: 'done', mode: 'edit_selection', project_id: deckId, page_id: fc.page_id, page_no: pageNo, slot, value: out.value, reason: out.reason, usage });
      res.end();
      return;
    }

    /* ---------- edit_theme — restyle without touching content ---------- */
    if (intent.action === 'edit_theme') {
      const theme = intent.theme;
      if (!theme) { send({ type: 'error', message: 'Which theme? midnight · aurora · sand · cobalt · mono · ember', status: 400 }); res.end(); return; }
      const pages = pagesSorted().map((fc) => {
        const parsed = parseSlideHtml(loaded.pages[fc.page_id] || fc.content || '');
        parsed.spec.theme = theme;
        return { page_id: fc.page_id, content: renderSlideHtml(parsed.spec, { fontBase: '/fonts/' }) };
      });
      store.replacePages(deckId, pages, { note: `theme: ${theme} (chat)` });
      send({ type: 'done', mode: 'edit_theme', project_id: deckId, theme, page_count: pages.length, usage });
      res.end();
      return;
    }

    /* ---------- delete_slides — "delete slides 2-4" ---------- */
    if (intent.action === 'delete_slides') {
      const total = pagesSorted().length;
      const idx = new Set();
      for (const tok of intent.delete_ranges || []) {
        const m = String(tok).match(/^(\d+)(?:\s*-\s*(\d+))?$/);
        if (!m) continue;
        const a = Number(m[1]), b = Number(m[2] || m[1]);
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) if (i >= 1 && i <= total) idx.add(i);
      }
      if (!idx.size) { send({ type: 'error', message: `Tell me which slides to delete — this deck has ${total}`, status: 400 }); res.end(); return; }
      for (const i of [...idx].sort((a, b) => b - a)) {
        const fc = pagesSorted()[i - 1];
        if (fc) store.deletePage(deckId, fc.page_id);
      }
      const after = store.loadDeck(deckId);
      send({ type: 'done', mode: 'delete_slides', project_id: deckId, page_count: after?.deck.file_contents.length, deleted: idx.size, usage });
      res.end();
      return;
    }

    /* ---------- verify — fact-check the open deck ---------- */
    if (intent.action === 'verify') {
      const specs = pagesSorted().map((fc) => parseSlideHtml(loaded.pages[fc.page_id] || fc.content || '').spec);
      send({ type: 'step', step: 'verify', message: `Fact-checking ${specs.length} slide${specs.length === 1 ? '' : 's'}…` });
      const results = await verifyDeck(provider, specs);
      bump(results.usage);
      const c = results.reduce((acc, r) => { acc[r.verdict] = (acc[r.verdict] || 0) + 1; return acc; }, {});
      const lines = results.filter((r) => r.verdict !== 'plausible').slice(0, 6).map((r) => `${r.verdict}: ${r.claim.slice(0, 80)}`);
      send({
        type: 'done', mode: 'verify', project_id: deckId,
        text: `${results.length} claim${results.length === 1 ? '' : 's'} checked — ${c.plausible || 0} plausible · ${c.needs_source || 0} need source · ${c.likely_false || 0} likely false${lines.length ? '\n' + lines.join('\n') : ''}`,
        usage,
      });
      res.end();
      return;
    }

    send({ type: 'error', message: `I don't know how to "${intent.action}" yet`, status: 400 });
    res.end();
  } catch (e) {
    send({ type: 'error', message: e?.message || String(e), status: e instanceof ProviderError ? e.status : 500 });
    res.end();
  }
}

/* --------------------------- agent helpers (⛓) --------------------------- */

/**
 * Run the full conversational pipeline non-SSE for agents: the SAME
 * streamChat (router → executor → save), captured into JSON events. The MCP
 * tool `slideforge_chat` returns {outcome, events, reply, deck} to the agent.
 */
async function captureStreamChat(body) {
  const chunks = [];
  const fakeRes = { writeHead() {}, write(c) { chunks.push(String(c)); }, end() {} };
  try {
    await streamChat(null, fakeRes, body);
  } catch (e) {
    return { outcome: 'error', message: String(e?.message || e).slice(0, 300), events: [] };
  }
  const events = [];
  for (const chunk of chunks) {
    for (const line of chunk.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      try { events.push(JSON.parse(line.slice(6))); } catch { /* ignore malformed line */ }
    }
  }
  const err = events.find((e) => e.type === 'error');
  const done = events.find((e) => e.type === 'done');
  const reply = events.find((e) => e.type === 'reply');
  const deck = events.find((e) => e.type === 'deck');
  return {
    outcome: err ? 'ai_error' : done ? 'ok' : 'unknown',
    message: err ? err.message : (done ? '' : 'no events'),
    reply: reply ? reply.text : '',
    project_id: done?.project_id || deck?.project_id || body.project_id || null,
    mode: done?.mode || null,
    page_count: done?.page_count ?? null,
    steps: events.filter((e) => e.type === 'step').map((e) => e.message),
  };
}

/**
 * Agent surgical text edit on one slot path (e.g. "title" or "blocks.0.text").
 * Same parse → setSlot → render → version-guarded save pipeline as the
 * editor; is_manual_edit:false → stamped ai:rewrite provenance upstream.
 */
function agentSchemaData() {
  return {
    themes: THEME_IDS,
    archetypes: ARCHETYPES,
    slot_shapes: {
      hero: { lead: 'string (<=26w)', points: ['string (<=14w, max 3)'] },
      bento: { blocks: [{ label: 'string (<=3w)', value: 'string (<=6w)', text: 'string (<=16w)', tone: 'default|accent|accent2|muted' }] },
      'metric-triple': { metrics: [{ label: 'string (<=4w)', value: 'string (<=4w)', delta: 'string (<=5w)', dir: 'up|down|flat' }] },
      'split-compare': {
        left: { label: 'string', head: 'string', text: 'string', points: ['string'] },
        right: { label: 'string', head: 'string', text: 'string', points: ['string'] },
      },
      bullets: { items: [{ head: 'string (<=6w)', text: 'string (<=16w)' }] },
      roadmap: { steps: [{ label: 'string', head: 'string', text: 'string' }] },
      timeline: { events: [{ when: 'string', head: 'string', text: 'string' }] },
      quote: { quote: 'string (<=34w)', attribution: 'string (<=10w)' },
      chart: { chart: { type: 'bar|line|donut', unit: 'string', categories: ['string'], series: [{ name: 'string', values: [0] }] } },
      'image-text': { image: { url: 'string', alt: 'string', caption: 'string' }, points: ['string'] },
      table: { table: { headers: ['string'], rows: [['string']] } },
      custom: { html: 'sanitized HTML+SVG+CSS composition (div/span/svg/table/ul/li with inline styles and data-sf-id hooks)' },
    },
    presets: PRESET_CATALOG,
    font_pairs: FONT_PAIR_IDS,
    canvas_modes: CANVAS_MODES,
    custom_palette_keys: ['bg', 'bgAlt', 'surface', 'surfaceAlt', 'ink', 'muted', 'accent', 'accent2', 'line', 'positive'],
  };
}

async function agentUploadMedia(req, res, body, agent = 'opencode') {
  const projectId = safeDeckId(String(body?.project_id || ''));
  if (!projectId || !store.loadDeck(projectId)) return json(res, 404, { status: 404, data: null, message: 'valid project_id required' });
  let buf;
  if (typeof body.svg === 'string' && body.svg.trim()) {
    const cleaned = sanitize(body.svg.trim(), { keepStyle: true, allowScript: false });
    const withNs = cleaned.includes('xmlns=') ? cleaned : cleaned.replace(/^<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    buf = Buffer.from(withNs, 'utf8');
  } else if (typeof body.data_base64 === 'string' && body.data_base64.trim()) {
    buf = Buffer.from(body.data_base64.replace(/^data:[^;]+;base64,/, ''), 'base64');
  } else {
    return json(res, 400, { status: 400, data: null, message: 'provide svg (string) or data_base64 (base64 image)' });
  }
  const kind = sniff(buf);
  if (!kind) return json(res, 415, { status: 415, data: null, message: 'unsupported media format (png/jpg/webp/gif/svg only)' });
  const dir = ensureDeckMediaDir(projectId);
  const name = generatedName(kind.ext);
  writeFileSync(path.join(dir, name), buf);
  const sz = probeSize(buf, kind.ext) || { w: 0, h: 0 };
  const urlPath = `/media/${projectId}/${name}`;
  recordAgentOp({ agent, action: 'upload_media', project_id: projectId, page_no: 1, summary: `Uploaded ${name}` });
  return json(res, 200, {
    status: 0,
    data: { path: urlPath, name, mime: kind.mime, w: sz.w, h: sz.h, bytes: buf.length },
    message: '',
  });
}

function buildRenderedSlide(raw, index, defaultTheme, agent, prevSpec = null) {
  const expanded = expandPreset(raw && typeof raw === 'object' ? raw : {});
  const { provenance: _drop, ...clean } = expanded;
  void _drop;
  if (prevSpec) {
    if (clean.geometry === undefined && prevSpec.geometry) clean.geometry = prevSpec.geometry;
    if (clean.styles === undefined && prevSpec.styles) clean.styles = prevSpec.styles;
    if (clean.image === undefined && prevSpec.image) clean.image = prevSpec.image;
    if (clean.notes === undefined && prevSpec.notes) clean.notes = prevSpec.notes;
    if (!clean.id && prevSpec.id) clean.id = prevSpec.id;
  }
  const { spec: spec0, issues: normIssues } = normalizeSpec({ ...clean, theme: clean.theme || defaultTheme }, { index });
  const v = validateSpec(spec0);
  const spec = attachProvenance(spec0, { source: 'ai:gen', ref: `mcp:${agent}`, confidence: 0.9 });
  const html = renderSlideHtml(spec, { fontBase: '/fonts/' });
  return {
    page_id: spec.id,
    title: spec.title,
    spec,
    content: html,
    issues: [...(normIssues || []).map((m) => `slide ${index + 1}: ${m}`), ...v.issues.map((i) => `slide ${index + 1}: ${i.msg}`)],
  };
}

async function agentBuildDeck(req, res, body, agent = 'opencode') {
  const rawSlides = Array.isArray(body?.slides) ? body.slides : [];
  if (!rawSlides.length || rawSlides.length > 24) {
    return json(res, 400, { status: 400, data: null, message: 'slides array (1..24 SlideSpec items) is required' });
  }
  const defaultTheme = THEME_IDS.includes(body.theme) ? body.theme : 'midnight';
  const title = String(body.title || rawSlides[0]?.title || 'Untitled deck').slice(0, 80);
  const existingId = body.project_id ? safeDeckId(String(body.project_id)) : '';
  const loaded = existingId ? store.loadDeck(existingId) : null;
  const projectId = loaded ? existingId : store.createDeck({ title, file_prefix: 'deck' }).project_id;

  const built = rawSlides.map((s, i) => buildRenderedSlide(s, i, defaultTheme, agent));
  const issues = built.flatMap((b) => b.issues);
  store.replacePages(projectId, built.map((b) => ({ page_id: b.page_id, content: b.content })), { note: `built by ${agent} (${built.length} slides)` });
  if (body.clear_inbox) clearAgentInbox();
  recordAgentOp({ agent, action: 'build_deck', project_id: projectId, page_no: 1, summary: `Built "${title}" (${built.length} slides)` });
  const after = store.loadDeck(projectId);
  return json(res, 200, {
    status: 0,
    data: {
      project_id: projectId,
      title,
      page_count: built.length,
      version_number: after?.deck.meta_data.version_number ?? 1,
      editor_url: `http://127.0.0.1:4173/?deck=${projectId}`,
      issues,
    },
    message: '',
  });
}

async function agentEditText(req, res, body, agent = 'opencode') {
  const projectId = safeDeckId(String(body.project_id || ''));
  const slot = String(body.slot || '').slice(0, 64);
  if (!projectId || !slot) { return json(res, 400, { status: 400, data: null, message: 'project_id and slot required' }); }
  const loaded = store.loadDeck(projectId);
  if (!loaded) return json(res, 404, { status: 404, data: null, message: 'deck not found' });
  const ordered = loaded.deck.file_contents.slice().sort((a, b) => (a.page_index ?? 0) - (b.page_index ?? 0));
  const pageNo = Math.max(1, Number(body.page) || 1);
  const fc = ordered[pageNo - 1];
  if (!fc) return json(res, 400, { status: 400, data: null, message: `deck has ${ordered.length} pages — no page ${pageNo}` });
  const parsed = parseSlideHtml(loaded.pages[fc.page_id] || fc.content || '');
  if (parsed.degraded) return json(res, 409, { status: 409, data: null, message: 'page has no spec island — cannot edit text safely' });
  const before = listSlots(parsed.spec).find((s) => s.slot === slot)?.value ?? null;
  const value = String(body.value ?? '');
  const spec = setSlot(parsed.spec, slot, value);
  const html = renderSlideHtml(spec, { fontBase: '/fonts/' });
  const result = store.saveSlideData(projectId, {
    project_id: projectId,
    updated_file_contents: [{ page_id: fc.page_id, content: html, page_index: fc.page_index ?? 0, is_edited: true, action: 'update' }],
    updated_meta_data: { page_num: loaded.deck.meta_data.page_num },
    is_manual_edit: false,
    version_number: loaded.deck.meta_data.version_number,
  });
  if (result.status !== 0) return json(res, result.status, result);
  recordAgentOp({ agent, action: 'edit_text', project_id: projectId, page_no: pageNo, summary: `Edited slide ${pageNo} (${slot})` });
  return json(res, 200, {
    status: 0,
    data: { page: pageNo, page_id: fc.page_id, slot, before: String(before ?? ''), after: value, version_number: result.data?.meta_data?.version_number ?? loaded.deck.meta_data.version_number, editor_url: `http://127.0.0.1:4173/?deck=${projectId}` },
    message: '',
  });
}

async function agentSaveSlides(req, res, rawId, body, agent = 'opencode') {
  const projectId = safeDeckId(String(rawId || ''));
  const loaded = projectId ? store.loadDeck(projectId) : null;
  if (!loaded) return json(res, 404, { status: 404, data: null, message: 'deck not found' });
  const rawSlides = Array.isArray(body?.slides) ? body.slides : [];
  if (!rawSlides.length || rawSlides.length > 24) return json(res, 400, { status: 400, data: null, message: 'slides array (1..24 items) required' });
  const mode = ['upsert', 'append', 'replace'].includes(body.mode) ? body.mode : 'upsert';
  const ordered = loaded.deck.file_contents.slice().sort((a, b) => (a.page_index ?? 0) - (b.page_index ?? 0));
  const defaultTheme = THEME_IDS.includes(body.theme) ? body.theme : (parseSlideHtml(loaded.pages[ordered[0]?.page_id] || '').spec?.theme || 'midnight');

  if (mode === 'replace') {
    return agentBuildDeck(req, res, { ...body, project_id: projectId, theme: defaultTheme }, agent);
  }
  const issues = [];
  let touchedPage = 1;
  if (mode === 'append') {
    for (let i = 0; i < rawSlides.length; i++) {
      const b = buildRenderedSlide(rawSlides[i], ordered.length + i, defaultTheme, agent);
      issues.push(...b.issues);
      store.addPage(projectId, { html: b.content, title: b.title || 'New slide' });
    }
    touchedPage = ordered.length + 1;
  } else {
    const pages = ordered.map((fc) => ({ page_id: fc.page_id, content: loaded.pages[fc.page_id] || fc.content || '' }));
    for (let i = 0; i < rawSlides.length; i++) {
      const item = rawSlides[i];
      const pageNo = Math.max(1, Number(item.page_no || item.page) || (i + 1));
      touchedPage = pageNo;
      if (pageNo <= pages.length) {
        const prev = parseSlideHtml(pages[pageNo - 1].content).spec;
        const b = buildRenderedSlide(item, pageNo - 1, prev?.theme || defaultTheme, agent, prev);
        issues.push(...b.issues);
        pages[pageNo - 1] = { page_id: pages[pageNo - 1].page_id, content: b.content };
      } else {
        const b = buildRenderedSlide(item, pages.length, defaultTheme, agent);
        issues.push(...b.issues);
        pages.push({ page_id: b.page_id, content: b.content });
      }
    }
    store.replacePages(projectId, pages, { note: `slides updated by ${agent}` });
  }
  const after = store.loadDeck(projectId);
  recordAgentOp({ agent, action: mode + '_slides', project_id: projectId, page_no: touchedPage, summary: `Updated ${rawSlides.length} slide(s) on deck` });
  return json(res, 200, {
    status: 0,
    data: { project_id: projectId, mode, page_count: after?.deck.file_contents.length ?? 0, version_number: after?.deck.meta_data.version_number ?? 1, editor_url: `http://127.0.0.1:4173/?deck=${projectId}`, issues },
    message: '',
  });
}

async function agentManageDeck(req, res, rawId, body, agent = 'opencode') {
  const projectId = safeDeckId(String(rawId || ''));
  const loaded = projectId ? store.loadDeck(projectId) : null;
  if (!loaded) return json(res, 404, { status: 404, data: null, message: 'deck not found' });
  const rawAct = String(body?.sub_action || body?.op || body?.action || '');
  const action = rawAct === 'manage' ? String(body?.op || body?.sub_action || '') : rawAct;
  const ordered = loaded.deck.file_contents.slice().sort((a, b) => (a.page_index ?? 0) - (b.page_index ?? 0));

  if (action === 'theme') {
    if (!THEME_IDS.includes(body.theme)) return json(res, 400, { status: 400, data: null, message: `theme must be one of ${THEME_IDS.join(', ')}` });
    const pages = ordered.map((fc) => {
      const parsed = parseSlideHtml(loaded.pages[fc.page_id] || fc.content || '');
      parsed.spec.theme = body.theme;
      return { page_id: fc.page_id, content: renderSlideHtml(parsed.spec, { fontBase: '/fonts/' }) };
    });
    store.replacePages(projectId, pages, { note: `theme ${body.theme} (${agent})` });
  } else if (action === 'delete') {
    const pagesToDel = (Array.isArray(body.pages) ? body.pages : [body.page]).map(Number).filter((n) => n >= 1 && n <= ordered.length).sort((a, b) => b - a);
    if (!pagesToDel.length) return json(res, 400, { status: 400, data: null, message: 'provide page (1-based) or pages[] to delete' });
    for (const pNo of pagesToDel) store.deletePage(projectId, ordered[pNo - 1].page_id);
  } else if (action === 'reorder') {
    const order = Array.isArray(body.order) ? body.order : [];
    const pageIds = order.map((x) => (typeof x === 'number' ? ordered[x - 1]?.page_id : String(x))).filter(Boolean);
    if (!store.reorderPages(projectId, pageIds)) return json(res, 400, { status: 400, data: null, message: 'invalid order (pass 1-based page numbers or page_ids covering all slides)' });
  } else if (action === 'notes') {
    const pageNo = Math.max(1, Number(body.page) || 1);
    const fc = ordered[pageNo - 1];
    if (!fc) return json(res, 400, { status: 400, data: null, message: `no slide ${pageNo}` });
    const parsed = parseSlideHtml(loaded.pages[fc.page_id] || fc.content || '');
    parsed.spec.notes = String(body.notes ?? '').slice(0, 2000);
    const html = renderSlideHtml(parsed.spec, { fontBase: '/fonts/' });
    store.saveSlideData(projectId, { project_id: projectId, updated_file_contents: [{ page_id: fc.page_id, content: html, page_index: fc.page_index ?? 0, is_edited: true, action: 'update' }], updated_meta_data: { page_num: loaded.deck.meta_data.page_num }, is_manual_edit: false, version_number: loaded.deck.meta_data.version_number });
  } else {
    return json(res, 400, { status: 400, data: null, message: 'action must be theme | delete | reorder | notes' });
  }
  const after = store.loadDeck(projectId);
  recordAgentOp({ agent, action, project_id: projectId, page_no: Number(body.page) || 1, summary: `Managed deck (${action})` });
  return json(res, 200, { status: 0, data: { project_id: projectId, action, page_count: after?.deck.file_contents.length ?? 0, version_number: after?.deck.meta_data.version_number ?? 1, editor_url: `http://127.0.0.1:4173/?deck=${projectId}` }, message: '' });
}

/* --------------------------- M-ACC verify --------------------------- */

const VERIFY_BATCH_CAP = 12;       // L9: "work through the deck in batches"
const VERIFY_CREATIVE_IMG_CAP = 3; // payload guard for screenshot vision
const VERIFY_NOTES_PER_PAGE = 8;

/**
 * SSE verify (docs/06 Block 2): one provider call per page (deck scope =
 * batches), per-item page-mapped verdicts, then notes are written INTO each
 * affected slide's spec.notes — deduplicated, version-guarded (409 → skipped,
 * remaining pages still attempted). Links are stored TEXT-ONLY: nothing is
 * ever fetched server-side (SSRF closure, roast Block 2.5).
 */
async function streamVerify(req, res, id, body) {
  res.writeHead(200, sseHeaders());
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  const loaded = store.loadDeck(id);
  if (!loaded) { send({ type: 'error', message: 'deck not found', status: 404 }); res.end(); return; }

  const scope = ['deck', 'page', 'element'].includes(body.scope) ? body.scope : 'deck';
  const mode = ['professional', 'creative'].includes(body.mode) ? body.mode : 'professional';
  let targets = loaded.deck.file_contents.slice().sort((a, b) => (a.page_index ?? 0) - (b.page_index ?? 0));
  if (scope !== 'deck') {
    targets = targets.filter((fc) => fc.page_id === body.page_id);
    if (!targets.length) { send({ type: 'error', message: 'page_id not found in deck', status: 400 }); res.end(); return; }
    if (scope === 'element' && !body.slot) { send({ type: 'error', message: 'slot required for element scope', status: 400 }); res.end(); return; }
  } else {
    targets = targets.slice(0, VERIFY_BATCH_CAP);
  }

  const issues = [];
  const imagesByIndex = new Map();
  if (mode === 'creative') {
    // Block 3: capture the page PNG(s) at scale 1 and relay as base64.
    const visual = scope === 'deck' ? targets.slice(0, VERIFY_CREATIVE_IMG_CAP) : targets;
    try {
      const dir = path.join(EXPORT_DIR, `verify-${id.slice(0, 8)}-${Date.now()}`);
      const shots = await exportPng(
        visual.map((fc) => ({ page_id: fc.page_id, content: loaded.pages[fc.page_id] || fc.content || '' })),
        { outDir: dir, fontsDir: FONTS_DIR, scale: 1 },
      );
      shots.forEach((file, i) => {
        const fc = visual[i];
        if (!fc) return;
        imagesByIndex.set(String(fc.page_index ?? 0), { mime_type: 'image/png', data: readFileSync(file, 'base64') });
      });
    } catch (e) {
      issues.push(`screenshot capture failed (${String(e?.message || e).slice(0, 120)}) — text-only verification`);
    }
  }

  try {
    const provider = createProvider({});
    const pageData = targets.map((fc) => {
      const parsed = parseSlideHtml(loaded.pages[fc.page_id] || fc.content || '');
      return {
        page_index: fc.page_index ?? 0,
        spec: parsed.spec,
        slot: scope === 'element' ? String(body.slot).slice(0, 40) : '',
        images: imagesByIndex.get(String(fc.page_index ?? 0)) || null,
      };
    });
    send({ type: 'step', step: 'verify', message: `Verify online — scope ${scope}, mode ${mode}, ${pageData.length} page(s)` });
    const results = await scopedVerify(provider, pageData, {
      scope, mode,
      onPage: (s) => send({ type: 'step', ...s }),
      addIssue: (msg) => issues.push(msg),
    });
    const usage = { ...results.usage };
    issues.push(...(results.issues || []));
    delete results.usage;
    delete results.issues;

    /* notes INTO slides: fresh deck per page, dedupe exact lines, 409 → skip */
    const byPage = new Map();
    for (const r of results) {
      const k = String(r.page_index ?? 0);
      if (!byPage.has(k)) byPage.set(k, []);
      byPage.get(k).push(r);
    }
    const dateTag = new Date().toISOString().slice(0, 10);
    const skipped = [];
    const noted = [];
    for (const [idx, items] of byPage) {
      const fc = targets.find((x) => String(x.page_index ?? 0) === idx);
      if (!fc) continue;
      try {
        const fresh = store.loadDeck(id);
        if (!fresh) throw new Error('deck vanished');
        const ffc = fresh.deck.file_contents.find((x) => x.page_id === fc.page_id);
        if (!ffc) throw new Error('page vanished');
        const parsed = parseSlideHtml(fresh.pages[fc.page_id] || ffc.content || '');
        if (parsed.degraded) { skipped.push({ page_index: Number(idx), reason: 'no spec island' }); continue; }
        const spec = parsed.spec;
        const existing = new Set(String(spec.notes || '').split('\n').map((l) => l.trim()).filter(Boolean));
        const addition = [];
        for (const r of items.slice(0, VERIFY_NOTES_PER_PAGE)) {
          const links = (r.links || []).length ? ` (${r.links.map((u) => u.slice(0, 60)).join(' ')})` : '';
          const line = `[verify ${dateTag}] ${String(r.item).slice(0, 90).trim()} — ${r.verdict}: ${String(r.note).slice(0, 140).trim()}${links}`;
          if (!existing.has(line)) { addition.push(line); existing.add(line); }
        }
        if (!addition.length) { skipped.push({ page_index: Number(idx), reason: 'notes up to date' }); continue; }
        const base = String(spec.notes || '').trim();
        spec.notes = base ? base + '\n' + addition.join('\n') : addition.join('\n');
        const html = renderSlideHtml(spec, { fontBase: '/fonts/' });
        const res2 = store.saveSlideData(id, {
          project_id: id,
          updated_file_contents: [{ page_id: fc.page_id, content: html, page_index: Number(idx), is_edited: true, action: 'update' }],
          updated_meta_data: { page_num: fresh.deck.meta_data.page_num },
          is_manual_edit: false,
          version_number: fresh.deck.meta_data.version_number,
        });
        if (res2.status === 409) skipped.push({ page_index: Number(idx), reason: 'edited during verification (409)' });
        else noted.push(Number(idx));
      } catch (e) {
        skipped.push({ page_index: Number(idx), reason: String(e?.message || e).slice(0, 80) });
      }
    }

    send({ type: 'step', step: 'verify', message: `Notes written into ${noted.length} slide(s); ${skipped.length} skipped` });
    send({ type: 'done', scope, mode, results, noted, skipped, issues, usage });
  } catch (e) {
    send({ type: 'error', message: e?.message || String(e), status: e instanceof ProviderError ? e.status : 500 });
  }
  res.end();
}

/**
 * M-ACC ledger (docs/06 Block 1): on manual saves, diff each updated page's
 * slot values against the stored page and stamp the CHANGED text slots
 * {source:'user', ref:'manual-edit', confidence:1}. Stamp via the canonical
 * parse → render path (same as geometry); a failed/degraded parse leaves the
 * content untouched and the save continues — ledger work never fails a save.
 */
function applyManualEditProvenance(body) {
  if (!body || body.is_manual_edit === false) return; // AI path keeps ai:gen / ai:rewrite
  const updates = Array.isArray(body.updated_file_contents) ? body.updated_file_contents : [];
  if (!updates.length || !body.project_id) return;
  let loaded = null;
  try { loaded = store.loadDeck(body.project_id); } catch { return; }
  if (!loaded) return;
  for (const u of updates) {
    if (!u?.page_id || typeof u.content !== 'string') continue;
    try {
      const oldParsed = parseSlideHtml(loaded.pages[u.page_id] || '');
      if (oldParsed.degraded) continue; // nothing reliable to diff against
      const newParsed = parseSlideHtml(u.content);
      if (newParsed.degraded) continue; // no island — nothing to stamp onto
      const before = new Map(listSlots(oldParsed.spec).map((s) => [s.slot, String(s.value ?? '')]));
      const changed = [];
      for (const s of listSlots(newParsed.spec)) {
        if (s.slot === 'notes' && String(s.value || '').includes('[verify ')) continue; // ledger is system-managed
        if (typeof s.value !== 'string' && typeof s.value !== 'number') continue;
        const was = before.get(s.slot);
        if (was !== undefined && was === String(s.value ?? '')) continue;
        if (changed.length >= 40) break;
        changed.push(s.slot);
      }
      if (!changed.length) continue;
      for (const slotPath of changed) {
        stampProvenance(newParsed.spec, slotPath, { source: 'user', ref: 'manual-edit', confidence: 1 });
      }
      u.content = renderSlideHtml(newParsed.spec, { fontBase: '/fonts/' });
    } catch { /* ledger work must never break a user save */ }
  }
}

/* ------------------------------ geometry ------------------------------ */

/**
 * M4 drag commit: parse the page, record one element's rect into
 * spec.geometry[sfId], re-render and save through the GenSpark-parity
 * save route (version-guarded). Mirrors streamAsk's slot-rewrite path minus
 * the AI call, so a drag survives every later spec-driven rebuild.
 */
async function setGeometry(req, res, id, pageId, body) {
  const loaded = store.loadDeck(id);
  if (!loaded) return json(res, 404, { status: 404, data: null, message: 'deck not found' });

  const fc = loaded.deck.file_contents.find((f) => f.page_id === pageId);
  if (!fc) return json(res, 404, { status: 404, data: null, message: 'page not found' });

  /**
   * M-CANVAS C5: accept a LIST of rects (all-or-nothing) or a legacy single
   * shape. List cap 40 (docs/07 C5.2) — a gesture can't exceed it, and it
   * bounds render cost. Any invalid member rejects the WHOLE request.
   */
  const legacy = body.items === undefined;
  const items = legacy
    ? [{ sfId: body.sfId, x: body.x, y: body.y, w: body.w, h: body.h, z: body.z, r: body.r }]
    : Array.isArray(body.items) ? body.items : [];
  if (!items.length || items.length > 40) {
    return json(res, 400, { status: 400, data: null, message: 'items 1..40 required' });
  }
  const norm = [];
  for (const it of items) {
    const sfId = String(it?.sfId || '').slice(0, 64);
    const x = Number(it?.x), y = Number(it?.y), w = Number(it?.w), h = Number(it?.h);
    if (!sfId || !Number.isFinite(x) || !Number.isFinite(y)) {
      return json(res, 400, { status: 400, data: null, message: 'each item needs sfId and finite x/y' });
    }
    norm.push({
      sfId, x, y,
      ...(Number.isFinite(w) ? { w } : {}),
      ...(Number.isFinite(h) ? { h } : {}),
      ...(Number.isFinite(Number(it?.z)) ? { z: Number(it.z) } : {}),
      ...(Number.isFinite(Number(it?.r)) ? { r: Number(it.r) } : {}),
    });
  }

  const parsed = parseSlideHtml(loaded.pages[pageId] || fc.content || '');
  const spec = parsed.spec;

  spec.geometry = { ...(spec.geometry || {}) };
  for (const it of norm) {
    // 24px floor + canvas clamp (docs/07 C3.2): mirror of public/canvas-snap.js
    const w = it.w !== undefined ? Math.max(24, Math.min(Math.round(it.w), 1280)) : undefined;
    const h = it.h !== undefined ? Math.max(24, Math.min(Math.round(it.h), 720)) : undefined;
    const z = it.z !== undefined ? Math.round(Number(it.z)) : undefined;
    const r = it.r !== undefined ? Math.round(Number(it.r)) : undefined;
    const cx = Math.max(-2400, Math.min(2400, Math.round(it.x))); // offset model: deltas may be negative
    const cy = Math.max(-1600, Math.min(1600, Math.round(it.y)));
    spec.geometry[it.sfId] = {
      x: cx,
      y: cy,
      ...(w !== undefined ? { w } : {}),
      ...(h !== undefined ? { h } : {}),
      ...(z !== undefined && Number.isFinite(z) ? { z } : {}),
      ...(r !== undefined && Number.isFinite(r) ? { r } : {}),
    };
  }

  const html = renderSlideHtml(spec, { fontBase: '/fonts/' });
  const result = store.saveSlideData(id, {
    project_id: id,
    updated_file_contents: [{ page_id: pageId, content: html, page_index: fc.page_index ?? 0, is_edited: true, action: 'update' }],
    updated_meta_data: { page_num: loaded.deck.meta_data.page_num },
    is_manual_edit: true,
    version_number: loaded.deck.meta_data.version_number,
  });
  if (result.status !== 0) return json(res, result.status, result);
  return json(res, 200, { status: 0, data: { content: html, page_index: fc.page_index ?? 0, version_number: result.data?.meta_data?.version_number ?? loaded.deck.meta_data.version_number, spec, degraded: parsed.degraded, issues: parsed.issues, applied: norm.length }, message: '' });
}

async function setElementStyle(req, res, id, pageId, body) {
  const loaded = store.loadDeck(id);
  if (!loaded) return json(res, 404, { status: 404, data: null, message: 'deck not found' });
  const fc = loaded.deck.file_contents.find((f) => f.page_id === pageId);
  if (!fc) return json(res, 404, { status: 404, data: null, message: 'page not found' });
  const sfId = String(body?.sfId || '').slice(0, 64);
  if (!sfId) return json(res, 400, { status: 400, data: null, message: 'sfId required' });

  let parsed = parseSlideHtml(loaded.pages[pageId] || fc.content || '');
  let spec = parsed.spec;
  if (typeof body.text === 'string') {
    if (body.slot && body.slot !== 'html') {
      spec = setSlot(spec, body.slot, body.text);
    } else if (spec.archetype === 'custom' && typeof spec.content?.html === 'string') {
      const escTxt = body.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const re = new RegExp(`(data-sf-id="${sfId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>)([^<]*)(</[a-zA-Z0-9]+>)`);
      spec.content.html = spec.content.html.replace(re, `$1${escTxt}$3`);
    }
  }
  const nextStyles = { ...(spec.styles || {}) };
  if (body.style === null) {
    delete nextStyles[sfId];
  } else if (body.style && typeof body.style === 'object') {
    nextStyles[sfId] = { ...(nextStyles[sfId] || {}), ...body.style };
  }
  const { spec: normSpec } = normalizeSpec({ ...spec, styles: nextStyles }, { id: spec.id, index: spec.index ?? 0 });
  const html = renderSlideHtml(normSpec, { fontBase: '/fonts/' });
  const result = store.saveSlideData(id, {
    project_id: id,
    updated_file_contents: [{ page_id: pageId, content: html, page_index: fc.page_index ?? 0, is_edited: true, action: 'update' }],
    updated_meta_data: { page_num: loaded.deck.meta_data.page_num },
    is_manual_edit: true,
    version_number: loaded.deck.meta_data.version_number,
  });
  if (result.status !== 0) return json(res, result.status, result);
  return json(res, 200, {
    status: 0,
    data: { content: html, spec: normSpec, version_number: result.data?.meta_data?.version_number ?? loaded.deck.meta_data.version_number },
    message: '',
  });
}

/* ------------------------------ duplicate element (Ctrl+D) ------------------------------ */

async function duplicateElement(req, res, id, pageId, body) {
  const loaded = store.loadDeck(id);
  if (!loaded) return json(res, 404, { status: 404, data: null, message: 'deck not found' });
  const fc = loaded.deck.file_contents.find((f) => f.page_id === pageId);
  if (!fc) return json(res, 404, { status: 404, data: null, message: 'page not found' });

  const sfId = String(body.sfId || '').slice(0, 64);
  const x = Number(body.x), y = Number(body.y);
  if (!sfId || !Number.isFinite(x) || !Number.isFinite(y)) {
    return json(res, 400, { status: 400, data: null, message: 'sfId, x and y required' });
  }
  const w = Number.isFinite(Number(body.w)) ? Math.max(24, Math.round(Number(body.w))) : undefined;
  const h = Number.isFinite(Number(body.h)) ? Math.max(24, Math.round(Number(body.h))) : undefined;
  const r = Number.isFinite(Number(body.r)) ? Math.round(Number(body.r)) : undefined;
  const z = Number.isFinite(Number(body.z)) ? Math.round(Number(body.z)) : undefined;
  const cls = String(body.cls || 'sf-extra').slice(0, 64);
  const text = String(body.text || body.content || '').slice(0, 200);
  const newId = `${sfId}-copy`;

  const parsed = parseSlideHtml(loaded.pages[pageId] || fc.content || '');
  const spec = parsed.spec;
  spec.extras = Array.isArray(spec.extras) ? spec.extras : [];
  if (spec.extras.length >= 40) {
    return json(res, 400, { status: 400, data: null, message: 'duplicate limit reached (40 copies per slide)' });
  }
  // avoid id collision
  let finalId = newId;
  let n = 2;
  while (spec.extras.some((e) => e.id === finalId) || (spec.geometry && spec.geometry[finalId])) {
    finalId = `${sfId}-copy${n++}`;
  }
  spec.extras.push({ id: finalId, slot: finalId, cls, text });

  spec.geometry = { ...(spec.geometry || {}) };
  spec.geometry[finalId] = {
    x: Math.max(-2400, Math.min(2400, Math.round(x))),
    y: Math.max(-1600, Math.min(1600, Math.round(y))),
    ...(w !== undefined ? { w } : {}),
    ...(h !== undefined ? { h } : {}),
    ...(r ? { r } : {}),
    ...(z !== undefined ? { z } : {}),
  };

  const html = renderSlideHtml(spec, { fontBase: '/fonts/' });
  const result = store.saveSlideData(id, {
    project_id: id,
    updated_file_contents: [{ page_id: pageId, content: html, page_index: fc.page_index ?? 0, is_edited: true, action: 'update' }],
    updated_meta_data: { page_num: loaded.deck.meta_data.page_num },
    is_manual_edit: true,
    version_number: loaded.deck.meta_data.version_number,
  });
  if (result.status !== 0) return json(res, result.status, result);
  return json(res, 200, { status: 0, data: { content: html, page_index: fc.page_index ?? 0, version_number: result.data?.meta_data?.version_number ?? loaded.deck.meta_data.version_number, spec, newId: finalId, degraded: parsed.degraded, issues: parsed.issues }, message: '' });
}

/** Remove a duplicated extra from a slide (pairs with Ctrl+D). */
async function deleteExtra(req, res, id, pageId, sfId) {
  const loaded = store.loadDeck(id);
  if (!loaded) return json(res, 404, { status: 404, data: null, message: 'deck not found' });
  const fc = loaded.deck.file_contents.find((f) => f.page_id === pageId);
  if (!fc) return json(res, 404, { status: 404, data: null, message: 'page not found' });

  const parsed = parseSlideHtml(loaded.pages[pageId] || fc.content || '');
  const spec = parsed.spec;
  const extras = Array.isArray(spec.extras) ? spec.extras : [];
  const next = extras.filter((e) => e.id !== sfId);
  if (next.length === extras.length) {
    return json(res, 404, { status: 404, data: null, message: 'not a duplicated element' });
  }
  if (next.length) spec.extras = next;
  else delete spec.extras;
  if (spec.geometry) delete spec.geometry[sfId];

  const html = renderSlideHtml(spec, { fontBase: '/fonts/' });
  const result = store.saveSlideData(id, {
    project_id: id,
    updated_file_contents: [{ page_id: pageId, content: html, page_index: fc.page_index ?? 0, is_edited: true, action: 'update' }],
    updated_meta_data: { page_num: loaded.deck.meta_data.page_num },
    is_manual_edit: true,
    version_number: loaded.deck.meta_data.version_number,
  });
  if (result.status !== 0) return json(res, result.status, result);
  return json(res, 200, {
    status: 0,
    data: {
      content: html,
      page_index: fc.page_index ?? 0,
      version_number: result.data?.meta_data?.version_number ?? loaded.deck.meta_data.version_number,
      spec, deleted: sfId, degraded: parsed.degraded, issues: parsed.issues,
    },
    message: '',
  });
}

/* ------------------------------ media ------------------------------ */

/**
 * P0a upload (docs/05 closed spec): multipart `deck_id` + `files[]`.
 * Server-generated names ONLY (`media-<ts>-<6rand>`), magic-byte sniffing,
 * hard size cap, deck existence check before any write.
 */
async function handleMediaUpload(req, res) {
  try {
    const parts = await readMultipart(req);
    const deckId = safeDeckId(parts.find((pt) => pt.name === 'deck_id' && pt.filename === undefined)?.data.toString('utf8'));
    if (!deckId) return json(res, 400, { status: 400, data: null, message: 'deck_id field required' });
    if (!store.loadDeck(deckId)) return json(res, 404, { status: 404, data: null, message: 'deck not found' });

    const files = parts.filter((pt) => pt.name === 'files' && pt.filename);
    if (!files.length) return json(res, 400, { status: 400, data: null, message: 'no files[] parts' });

    const dir = ensureDeckMediaDir(deckId);
    const paths = [];
    for (const pt of files) {
      if (pt.data.length > LIMITS.MAX_UPLOAD) {
        return json(res, 413, { status: 413, data: null, message: `file exceeds ${LIMITS.MAX_UPLOAD} bytes` });
      }
      const kind = sniff(pt.data);
      if (!kind) {
        return json(res, 415, { status: 415, data: null, message: 'unsupported media type (allowed: png, jpg, webp, gif, svg)' });
      }
      const name = generatedName(kind.ext);
      writeDeckMedia(dir, name, pt.data);
      const { w, h } = probeSize(pt.data, kind.ext);
      paths.push({ path: `/media/${deckId}/${name}`, bytes: pt.data.length, mime: kind.mime, w, h });
    }
    return json(res, 200, { status: 0, data: { paths }, message: '' });
  } catch (e) {
    const code = e?.code === 'PAYLOAD_TOO_LARGE' ? 413 : e?.code === 'BAD_CONTENT_TYPE' ? 400 : 500;
    if (code === 500) console.error('media upload failed:', e);
    return json(res, code, { status: code, data: null, message: e?.message || 'upload failed' });
  }
}

function writeDeckMedia(dir, name, data) {
  // name is server-generated and validated upstream; belt+braces the prefix check.
  const file = path.join(dir, name);
  if (!file.startsWith(MEDIA_DIR)) throw new Error('media path escape rejected');
  writeFileSync(file, data);
  return file;
}

/**
 * P0a image commit: set / clear one slide's image slot through the same
 * parse → normalize → render → version-guarded save pipeline as geometry.
 * URL validation + default geometry come from normalizeSpec itself, so there
 * is exactly ONE code path for what a legal image attachment looks like.
 */
async function setSlideImage(req, res, id, pageId, body) {
  const loaded = store.loadDeck(id);
  if (!loaded) return json(res, 404, { status: 404, data: null, message: 'deck not found' });
  const fc = loaded.deck.file_contents.find((f) => f.page_id === pageId);
  if (!fc) return json(res, 404, { status: 404, data: null, message: 'page not found' });

  // Deck-scoped media rule (docs/05): an image may only reference THIS deck's
  // uploads — normalizeSpec cannot know the deck id, so the boundary is here.
  const urlIn = String(body?.image?.url || '');
  if (urlIn && !urlIn.startsWith(`/media/${id}/`)) {
    return json(res, 400, { status: 400, data: null, message: `image.url must be a /media/${id}/... path` });
  }

  const parsed = parseSlideHtml(loaded.pages[pageId] || fc.content || '');
  const specBase = { ...parsed.spec, image: body?.image ?? null }; // null clears the slot
  const { spec } = normalizeSpec(specBase, { id: parsed.spec.id, index: parsed.spec.index ?? 0 });
  if (!spec.geometry) spec.geometry = {};
  // Preserve any pre-existing user drag of the image layer geo even after clear
  if (!spec.image) delete spec.geometry.img;

  const html = renderSlideHtml(spec, { fontBase: '/fonts/' });
  const result = store.saveSlideData(id, {
    project_id: id,
    updated_file_contents: [{ page_id: pageId, content: html, page_index: fc.page_index ?? 0, is_edited: true, action: 'update' }],
    updated_meta_data: { page_num: loaded.deck.meta_data.page_num },
    is_manual_edit: true,
    version_number: loaded.deck.meta_data.version_number,
  });
  if (result.status !== 0) return json(res, result.status, result);
  return json(res, 200, {
    status: 0,
    data: {
      content: html,
      page_index: fc.page_index ?? 0,
      version_number: result.data?.meta_data?.version_number ?? loaded.deck.meta_data.version_number,
      image: spec.image || null,
      geometry: parsed.spec.geometry || {},
    },
    message: '',
  });
}

/* ------------------------------ export ------------------------------ */

async function handleExport(req, res, id, body) {
  const loaded = store.loadDeck(id);
  if (!loaded) return json(res, 404, { status: 404, data: null, message: 'deck not found' });
  const format = String(body.format || 'pdf').toLowerCase();
  const pages = loaded.deck.file_contents.map((fc) => ({ page_id: fc.page_id, content: loaded.pages[fc.page_id] || '' }));
  if (!pages.length) return json(res, 400, { status: 400, data: null, message: 'deck has no slides' });

  const base = `deck-${id.slice(0, 8)}`;
  try {
    if (format === 'pdf') {
      const file = path.join(EXPORT_DIR, `${base}.pdf`);
      await exportPdf(pages, { outFile: file, fontsDir: FONTS_DIR });
      return json(res, 200, { status: 0, data: { file, name: `${base}.pdf`, mime: 'application/pdf', bytes: statSync(file).size, warnings: [] } });
    }
    if (format === 'png') {
      const dir = path.join(EXPORT_DIR, base);
      const files = await exportPng(pages, { outDir: dir, fontsDir: FONTS_DIR, scale: Number(body.scale) || 2 });
      return json(res, 200, { status: 0, data: { files, name: base, mime: 'image/png', warnings: [] } });
    }
    if (format === 'pptx-native' || format === 'pptx') {
      const specs = pages.map((pg) => {
        const parsed = parseSlideHtml(pg.content);
        return parsed.spec;
      });
      const file = path.join(EXPORT_DIR, `${base}.pptx`);
      const out = await exportPptxNative(specs, { outFile: file });
      return json(res, 200, { status: 0, data: { file, name: `${base}.pptx`, mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', bytes: statSync(file).size, warnings: out.warnings } });
    }
    if (format === 'pptx-image') {
      const dir = path.join(EXPORT_DIR, `${base}-png`);
      const files = await exportPng(pages, { outDir: dir, fontsDir: FONTS_DIR, scale: 2 });
      const file = path.join(EXPORT_DIR, `${base}-image.pptx`);
      const out = await exportPptxImage(files, { outFile: file });
      return json(res, 200, { status: 0, data: { file, name: path.basename(file), mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', bytes: statSync(file).size, warnings: out.warnings } });
    }
    return json(res, 400, { status: 400, data: null, message: `unknown format "${format}"` });
  } catch (e) {
    const status = e instanceof ExportError ? e.status : 500;
    return json(res, status, { status, data: null, message: e?.message || String(e), hint: e?.hint || '' });
  }
}

/* ------------------------------ static ------------------------------ */

export function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('forbidden'); return true; }
  if (!existsSync(file) || !statSync(file).isFile()) return false;
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': statSync(file).size,
    'Cache-Control': 'no-cache',
  });
  createReadStream(file).pipe(res);
  return true;
}

/** Serve stored slide media (P0a): GET /media/<deck>/<file> with no-script headers. */
export function serveMedia(req, res, url) {
  const m = url.pathname.match(/^\/media\/([\w-]+)\/([A-Za-z0-9._-]+)$/);
  if (!m) return false;
  return !!mediaFileStream(res, m[1], m[2]);
}

/** Serve a stored slide as an editable canvas document (adds the bridge). */
export function serveCanvas(req, res, url) {
  const m = url.pathname.match(/^\/canvas\/([\w-]+)\/([\w-]+)\.html$/);
  if (!m) return false;
  const [, id, pageId] = m;
  const loaded = store.loadDeck(id);
  if (!loaded) { res.writeHead(404); res.end('deck not found'); return true; }
  let html = loaded.pages[pageId];
  if (!html) { res.writeHead(404); res.end('page not found'); return true; }
  if (url.searchParams.get('editor') === '1') {
    html = html.replace('</body>', '<script type="module" src="/bridge.js"></script>\n</body>');
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
  return true;
}

export { PUBLIC_DIR, EXPORT_DIR, FONTS_DIR, closeBrowser };
