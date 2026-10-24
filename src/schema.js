/**
 * schema.js — the DECK WIRE FORMAT.
 *
 * These shapes mirror the *observed* GenSpark contract exactly (wire-compatible
 * request/response shapes are facts, not code — see docs/03-RECON-FINDINGS.md):
 *
 *   GET  /api/project/slide_data?project_id=..&is_edit_mode=false&with_version_history=true
 *     -> { status:0, data:{ meta_data, file_contents:[{page_id,content}], version_history } }
 *
 *   POST /api/project/save_slide_data
 *     body { project_id, updated_file_contents:[{page_id,content,page_index,is_edited,action}],
 *            updated_meta_data, is_manual_edit, version_number? }
 *     -> { status:0, data:{ session_state:{ version_history } } }
 *
 * Validation is hand-rolled (no runtime dependency) — see 02-ROAST-CODE.md C1.
 * Every validator returns { ok, issues[] } and never throws on bad input.
 */

import { createHash } from 'node:crypto';

export const DECK_TYPES = ['slide_agent', 'slides_agent', 'slides_agent_git'];

export const CANVAS = { width: 1280, height: 720 };

export function newId(prefix) {
  const rnd = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`)
    .replace(/[^a-z0-9]/gi, '');
  return `${prefix}_${rnd.slice(0, 24)}`;
}

export function makeMetaData(over = {}) {
  return {
    file_name: over.file_name || 'Untitled deck',
    file_prefix: over.file_prefix || 'deck',
    height: CANVAS.height,
    width: CANVAS.width,
    page_num: over.page_num ?? 0,
    project_id: over.project_id || newId('sf'),
    is_finished: over.is_finished ?? false,
    is_paid: false,
    showIndex: over.showIndex ?? true,
    version_number: over.version_number ?? 0,
    etag: over.etag || '',
    created_at: over.created_at || new Date().toISOString(),
    updated_at: over.updated_at || new Date().toISOString(),
  };
}

export function makeFileContent({ page_id, page_index = 0, content = '', is_edited = false, action = 'update' }) {
  return { page_id: page_id || newId('pg'), page_index, is_edited, action, content };
}

export function makeDeck({ project_id, type = 'slides_agent', meta_data, file_contents = [], version_history = [] }) {
  const id = project_id || newId('sf');
  return {
    project_id: id,
    type,
    meta_data: makeMetaData({ ...meta_data, project_id: id }),
    file_contents,
    version_history,
  };
}

/* --------------------------- validators --------------------------- */

export function validateMetaData(m) {
  const issues = [];
  if (!m || typeof m !== 'object') return { ok: false, issues: [{ level: 'error', msg: 'meta_data missing' }] };
  if (typeof m.page_num !== 'number' || m.page_num < 0) issues.push({ level: 'error', msg: 'meta_data.page_num must be >= 0' });
  if (m.width && m.width !== CANVAS.width) issues.push({ level: 'warn', msg: `meta_data.width ${m.width} != ${CANVAS.width}` });
  if (m.height && m.height !== CANVAS.height) issues.push({ level: 'warn', msg: `meta_data.height ${m.height} != ${CANVAS.height}` });
  return { ok: !issues.some((i) => i.level === 'error'), issues };
}

export function validateFileContent(fc) {
  const issues = [];
  if (!fc || typeof fc !== 'object') return { ok: false, issues: [{ level: 'error', msg: 'file_content must be an object' }] };
  if (!fc.page_id) issues.push({ level: 'error', msg: 'file_content.page_id missing' });
  if (typeof fc.content !== 'string') issues.push({ level: 'error', msg: 'file_content.content must be a string' });
  if (typeof fc.page_index !== 'number') issues.push({ level: 'warn', msg: 'file_content.page_index missing' });
  return { ok: !issues.some((i) => i.level === 'error'), issues };
}

export function validateDeck(deck) {
  const issues = [];
  if (!deck || typeof deck !== 'object') return { ok: false, issues: [{ level: 'error', msg: 'deck missing' }] };
  if (!deck.project_id) issues.push({ level: 'error', msg: 'deck.project_id missing' });
  if (!DECK_TYPES.includes(deck.type)) issues.push({ level: 'warn', msg: `unknown deck.type ${deck.type}` });
  issues.push(...validateMetaData(deck.meta_data).issues);
  if (!Array.isArray(deck.file_contents)) issues.push({ level: 'error', msg: 'deck.file_contents must be an array' });
  else deck.file_contents.forEach((fc, i) => {
    for (const iss of validateFileContent(fc).issues) issues.push({ ...iss, msg: `file_contents[${i}]: ${iss.msg}` });
  });
  return { ok: !issues.some((i) => i.level === 'error'), issues };
}

/* ------------------------------ etag ------------------------------ */

export function canonical(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(canonical).join(',')}]`;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`;
}

export function computeEtag(deck) {
  const payload = canonical({
    m: deck.meta_data,
    f: deck.file_contents.map((fc) => ({ id: fc.page_id, i: fc.page_index, c: fc.content })),
  });
  return 'sha256:' + createHash('sha256').update(payload).digest('hex').slice(0, 32);
}

/* --------------------------- envelopes --------------------------- */

export const ok = (data) => ({ status: 0, data, message: '' });
export const fail = (message, code = 400) => ({ status: code, data: null, message });
