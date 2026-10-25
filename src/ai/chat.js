/**
 * ai/chat.js — the conversational TOOL layer (Genspark-parity, 2026-10-23).
 *
 * The user talks to the editor in ONE message box. A routing LLM call turns
 * the message into STRICT JSON, then each action executes through the SAME
 * pure pipeline the generate path uses (plan → normalizeSpec → validate →
 * render HTML → store save). There is no offline path: when no provider is
 * configured the SSE endpoint answers "AI is not connected" and the UI keeps
 * the input disabled.
 *
 * Actions (docs parity with GenSpark AI Slides tools):
 *   create          — fresh deck ("make me 4 slides about …"); slides count
 *                     comes from the message, NOT from a form.
 *   add_slides      — append N slides to the open deck.
 *   edit_slide      — rewrite ONE slide ("fix slide 4").
 *   edit_selection  — rewrite exactly the selected canvas element/text.
 *   edit_theme      — re-theme without touching content.
 *   delete_slides   — remove slide ranges ("delete slides 2-4").
 *   verify          — fact-check the open deck; verdicts come back as a reply.
 *   answer          — pure conversation; no deck mutation.
 *
 * Pure layer: no store access, no SSE — executors live in api.js.
 */

import { normalizeSpec, validateSpec, CORE_ARCHETYPES, ARCHETYPE_IDS, THEME_IDS } from '../spec.js';
import { renderSlideHtml } from '../render/slide-html.js';
import { attachProvenance, extractJson } from './orchestrator.js';

const ROUTER_SYSTEM = `You are Patarang's assistant. You route ONE user message to EXACTLY ONE deck tool and output STRICT JSON only (no markdown fences):
{"action": string, "slides": int|null, "page_no": int|null, "theme": string|null, "brief": string|null, "instruction": string|null, "delete_ranges": [string]|null, "reply": string}

Actions: create | add_slides | edit_slide | edit_selection | edit_theme | delete_slides | verify | answer

Routing rules:
- "make/build/generate a deck|presentation" — create. slides = the number the user named (e.g. "4 slides" -> 4); null if unsaid (the pipeline picks a sensible count).
- With a deck OPEN, "start over / new deck / remake from scratch" is also create (the deck gets replaced).
- "add N more slides about X" or "add a slide about X" — add_slides.
- "edit/rewrite/fix/change/improve slide N" — edit_slide with page_no=N. "this slide" while a slide is open — edit_slide with page_no=current_page_no.
- If context.selection exists and the message says "this", "that", "it", "the selection", "the heading/text/kicker/label" without naming another slide — edit_selection (page_no = current_page_no).
- Colour/palette/dark/light/style-only requests with no content rewrite — edit_theme.
- "delete slide N" or "delete slides 2-4" — delete_slides; delete_ranges uses 1-based strings like ["4"] or ["2-4"].
- "verify/check the facts/sources" — verify.
- Questions, small talk, how-do-I, anything else — answer.
- reply: ONE short sentence, first person. For answer: answer the question fully but in <=3 sentences.`;

export const CHAT_ACTIONS = ['create', 'add_slides', 'edit_slide', 'edit_selection', 'edit_theme', 'delete_slides', 'verify', 'answer'];

export const CHAT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['action', 'reply'],
  properties: {
    action: { type: 'string', enum: CHAT_ACTIONS },
    slides: { type: 'integer' },
    page_no: { type: 'integer' },
    theme: { type: 'string', enum: THEME_IDS },
    brief: { type: 'string' },
    instruction: { type: 'string' },
    delete_ranges: { type: 'array', items: { type: 'string' } },
    reply: { type: 'string' },
  },
};

/**
 * ONE routing call. Returns a normalised intent — always safe to execute.
 */
export async function routeChat(provider, { message, deckOpen = false, page_no = 0, page_count = 0, selection = null, selection_text = '', slide_titles = [] } = {}) {
  const user = JSON.stringify({
    message,
    context: {
      deck_open: deckOpen,
      page_count,
      current_page_no: page_no,
      selection: selection ? { slot: selection.slot, sfId: selection.sfId, text: String(selection_text || '').slice(0, 300) } : null,
      slide_titles: slide_titles.slice(0, 20),
    },
  });
  const res = await provider.complete({ system: ROUTER_SYSTEM, user, kind: 'chat', schema: CHAT_SCHEMA });
  const json = extractJson(res.text) || {};
  const clean = (v) => (v === undefined || v === null || v === '' ? null : v);
  return {
    action: CHAT_ACTIONS.includes(json.action) ? json.action : 'answer',
    slides: clean(json.slides),
    page_no: clean(json.page_no),
    theme: THEME_IDS.includes(json.theme) ? json.theme : null,
    brief: clean(json.brief),
    instruction: clean(json.instruction),
    delete_ranges: Array.isArray(json.delete_ranges) ? json.delete_ranges.map(String).slice(0, 12) : null,
    reply: String(json.reply || 'Working on it.').slice(0, 600),
    usage: res.usage || {},
  };
}

/* ─────────────────── single-slide editor (edit_slide) ─────────────────── */

const EDITOR_SYSTEM = `You are Patarang's slide editor. You rewrite ONE existing slide and output STRICT JSON only (no markdown fences):
{"spec": <SlideSpec>}

Rules:
- Keep the slide's archetype unless the instruction explicitly demands a change.
- Change ONLY what the instruction asks for; everything else stays byte-equal in meaning.
- Never invent numbers that are not supplied. Use "—" when a number is unknown.
- Headlines <= 8 words. Body text <= 18 words. No paragraphs.
- Tone: concrete, decision-oriented, zero marketing fluff.

Archetype contracts:
${JSON.stringify({ note: 'see archetype field list in the current spec', archetypes: ARCHETYPE_IDS })}`;

const PAGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['spec'],
  properties: {
    spec: {
      type: 'object',
      additionalProperties: true,
      properties: {
        archetype: { type: 'string', enum: ARCHETYPE_IDS },
        title: { type: 'string' },
        kicker: { type: 'string' },
        subtitle: { type: 'string' },
        content: { type: 'object', additionalProperties: true },
      },
    },
  },
};

/**
 * Rewrite one slide spec from a natural-language instruction. Falls back to
 * the incoming spec (unchanged) if the model returns unparsable output — the
 * executor then replies honestly instead of corrupting the slide.
 */
export async function editPageSpec(provider, { spec, instruction }) {
  const user = JSON.stringify({
    task: 'Return {"spec": <SlideSpec>} — the slide rewritten per the instruction.',
    current_spec: spec,
    instruction,
    archetypes: CORE_ARCHETYPES,
  });
  const res = await provider.complete({ system: EDITOR_SYSTEM, user, kind: 'chat', schema: PAGE_SCHEMA });
  const json = extractJson(res.text);
  const raw = json?.spec && typeof json.spec === 'object' ? json.spec : null;
  if (!raw) return { spec: null, usage: res.usage || {} }; // executor: keep slide, tell the user
  // M-ACC spoof strip: model output never owns provenance.
  const { provenance: _declared, ...clean } = raw;
  void _declared;
  const merged = {
    ...clean,
    id: spec.id,
    archetype: clean.archetype || spec.archetype,
    theme: spec.theme,
    title: clean.title || spec.title,
  };
  const { spec: specOut } = normalizeSpec(merged, {});
  const v = validateSpec(specOut);
  if (!v.ok) return { spec: null, usage: res.usage || {}, issues: v.issues.map((i) => i.msg) };
  const withProv = attachProvenance(specOut, { source: 'ai:edit', ref: instruction.slice(0, 30), confidence: 0.8 });
  return {
    spec: withProv,
    html: renderSlideHtml(withProv, { fontBase: '/fonts/' }),
    usage: res.usage || {},
  };
}
