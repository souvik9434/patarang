/**
 * store.js — file-backed deck store with optimistic concurrency.
 *
 * On-disk layout (roast C18):
 *   data/decks/<project_id>/deck.json      wire-format deck (meta_data, file_contents metadata)
 *   data/decks/<project_id>/history.json   append-only version_history
 *   data/decks/<project_id>/pages/<page_id>.html
 *
 * Concurrency (roast R9 / invariant I3):
 *   every save carries the base version_number; a stale save is rejected with
 *   409 and the current version so the UI can offer Reload / Force.
 */

import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { makeDeck, makeMetaData, makeFileContent, computeEtag, CANVAS, newId } from './schema.js';

const ROOT = process.env.SLIDEFORGE_DATA || path.resolve(process.cwd(), 'data');
const DECKS = path.join(ROOT, 'decks');
const HISTORY_LIMIT = 200;

function deckDir(id) { return path.join(DECKS, id); }
function ensure(id) { mkdirSync(path.join(deckDir(id), 'pages'), { recursive: true }); return deckDir(id); }

function readJson(file, fallback) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, obj) {
  writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
}

export function nowIso() { return new Date().toISOString(); }

/* ------------------------------ create ------------------------------ */

export function createDeck({ title = 'Untitled deck', file_prefix = 'deck', type = 'slides_agent' } = {}) {
  const deck = makeDeck({ type, meta_data: makeMetaData({ file_name: title, file_prefix }) });
  ensure(deck.project_id);
  deck.meta_data.etag = computeEtag(deck);
  writeJson(path.join(deckDir(deck.project_id), 'deck.json'), deck);
  writeJson(path.join(deckDir(deck.project_id), 'history.json'), []);
  return deck;
}

export function listDecks() {
  if (!existsSync(DECKS)) return [];
  const out = [];
  for (const id of readdirSync(DECKS)) {
    const deck = readJson(path.join(deckDir(id), 'deck.json'), null);
    if (deck) out.push({ project_id: deck.project_id, file_name: deck.meta_data.file_name, page_num: deck.meta_data.page_num, version_number: deck.meta_data.version_number, updated_at: deck.meta_data.updated_at, type: deck.type });
  }
  return out.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
}

export function deckExists(id) { return existsSync(path.join(deckDir(id), 'deck.json')); }

/* ------------------------------- read ------------------------------- */

export function loadDeck(id) {
  const deck = readJson(path.join(deckDir(id), 'deck.json'), null);
  if (!deck) return null;
  const pages = {};
  const dir = path.join(deckDir(id), 'pages');
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.html')) continue;
      pages[f.replace(/\.html$/, '')] = readFileSync(path.join(dir, f), 'utf8');
    }
  }
  const history = readJson(path.join(deckDir(id), 'history.json'), []);
  return { deck, pages, history };
}

/** Genspark-parity read envelope. */
export function getSlideData(id, { with_version_history = true } = {}) {
  const loaded = loadDeck(id);
  if (!loaded) return null;
  const { deck, pages, history } = loaded;
  const file_contents = deck.file_contents.map((fc) => ({
    page_id: fc.page_id,
    page_index: fc.page_index,
    is_edited: fc.is_edited,
    action: fc.action,
    content: pages[fc.page_id] ?? fc.content ?? '',
  }));
  const data = { meta_data: deck.meta_data, file_contents };
  if (with_version_history) data.version_history = history;
  return { status: 0, data, message: '' };
}

/* ------------------------------- save ------------------------------- */

/**
 * Save slide data (Genspark-parity body).
 * @returns {{status:number, data?:any, message:string}}
 */
export function saveSlideData(id, body = {}) {
  const loaded = loadDeck(id);
  if (!loaded) return { status: 404, data: null, message: 'deck not found' };
  const { deck, history } = loaded;

  const base = Number(body.version_number ?? deck.meta_data.version_number);
  if (Number.isFinite(base) && base < deck.meta_data.version_number) {
    return {
      status: 409,
      data: { session_state: { version_history: history }, current_version_number: deck.meta_data.version_number },
      message: 'version conflict: deck changed elsewhere',
    };
  }

  const updates = Array.isArray(body.updated_file_contents) ? body.updated_file_contents : [];
  const dirty = [];
  for (const u of updates) {
    if (!u?.page_id) continue;
    const pageFile = path.join(deckDir(id), 'pages', `${u.page_id}.html`);
    const existing = deck.file_contents.find((f) => f.page_id === u.page_id);
    if (existing) {
      writeFileSync(pageFile, u.content ?? '', 'utf8');
      existing.is_edited = u.is_edited ?? true;
      existing.action = u.action ?? 'update';
      dirty.push(u.page_id);
    }
  }

  if (body.updated_meta_data && typeof body.updated_meta_data === 'object') {
    const m = body.updated_meta_data;
    if (typeof m.file_name === 'string') deck.meta_data.file_name = m.file_name;
    if (typeof m.page_num === 'number') deck.meta_data.page_num = m.page_num;
    if (typeof m.showIndex === 'boolean') deck.meta_data.showIndex = m.showIndex;
  }

  deck.meta_data.version_number += 1;
  deck.meta_data.updated_at = nowIso();
  deck.meta_data.etag = computeEtag(deck);

  const entry = {
    version_number: deck.meta_data.version_number,
    etag: deck.meta_data.etag,
    created_at: deck.meta_data.updated_at,
    page_count: deck.file_contents.length,
    pages: dirty,
    note: body.is_manual_edit ? 'manual edit' : 'ai edit',
    manual: body.is_manual_edit !== false,
  };
  const nextHistory = [...history, entry].slice(-HISTORY_LIMIT);
  writeJson(path.join(deckDir(id), 'deck.json'), deck);
  writeJson(path.join(deckDir(id), 'history.json'), nextHistory);

  return {
    status: 0,
    data: { session_state: { version_history: nextHistory }, meta_data: deck.meta_data },
    message: '',
  };
}

/** Replace the whole page list (used by the AI orchestrator after regeneration). */
export function replacePages(id, pages, { note = 'ai regenerate' } = {}) {
  const loaded = loadDeck(id);
  if (!loaded) return { status: 404, data: null, message: 'deck not found' };
  const { deck, history } = loaded;

  // remove old page files
  const dir = path.join(deckDir(id), 'pages');
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) if (f.endsWith('.html')) rmSync(path.join(dir, f), { force: true });
  }
  deck.file_contents = pages.map((p, i) => {
    writeFileSync(path.join(dir, `${p.page_id}.html`), p.content, 'utf8');
    return makeFileContent({ page_id: p.page_id, page_index: i, content: '', is_edited: false, action: 'update' });
  });
  deck.meta_data.page_num = pages.length;
  deck.meta_data.version_number += 1;
  deck.meta_data.updated_at = nowIso();
  deck.meta_data.etag = computeEtag(deck);

  const entry = {
    version_number: deck.meta_data.version_number,
    etag: deck.meta_data.etag,
    created_at: deck.meta_data.updated_at,
    page_count: pages.length,
    pages: pages.map((p) => p.page_id),
    note,
    manual: false,
  };
  const nextHistory = [...history, entry].slice(-HISTORY_LIMIT);
  writeJson(path.join(deckDir(id), 'deck.json'), deck);
  writeJson(path.join(deckDir(id), 'history.json'), nextHistory);

  return { status: 0, data: { session_state: { version_history: nextHistory }, meta_data: deck.meta_data }, message: '' };
}

/** Create a single new page (add slide). */
export function addPage(id, { html = '', title = 'New slide' } = {}) {
  const loaded = loadDeck(id);
  if (!loaded) return null;
  const { deck, history } = loaded;
  const page_id = newId('pg');
  writeFileSync(path.join(deckDir(id), 'pages', `${page_id}.html`), html, 'utf8');
  deck.file_contents.push(makeFileContent({ page_id, page_index: deck.file_contents.length, content: '', is_edited: true, action: 'insert' }));
  deck.meta_data.page_num = deck.file_contents.length;
  deck.meta_data.version_number += 1;
  deck.meta_data.updated_at = nowIso();
  deck.meta_data.etag = computeEtag(deck);
  writeJson(path.join(deckDir(id), 'deck.json'), deck);
  writeJson(path.join(deckDir(id), 'history.json'), [...history, { version_number: deck.meta_data.version_number, etag: deck.meta_data.etag, created_at: deck.meta_data.updated_at, page_count: deck.file_contents.length, pages: [page_id], note: `add ${title}`, manual: true }].slice(-HISTORY_LIMIT));
  return { page_id, deck };
}

export function deletePage(id, page_id) {
  const loaded = loadDeck(id);
  if (!loaded) return false;
  const { deck, history } = loaded;
  const before = deck.file_contents.length;
  deck.file_contents = deck.file_contents.filter((f) => f.page_id !== page_id);
  if (deck.file_contents.length === before) return false;
  deck.file_contents.forEach((f, i) => { f.page_index = i; });
  deck.meta_data.page_num = deck.file_contents.length;
  deck.meta_data.version_number += 1;
  deck.meta_data.updated_at = nowIso();
  deck.meta_data.etag = computeEtag(deck);
  rmSync(path.join(deckDir(id), 'pages', `${page_id}.html`), { force: true });
  writeJson(path.join(deckDir(id), 'deck.json'), deck);
  writeJson(path.join(deckDir(id), 'history.json'), [...history, { version_number: deck.meta_data.version_number, etag: deck.meta_data.etag, created_at: deck.meta_data.updated_at, page_count: deck.file_contents.length, pages: [], note: 'delete slide', manual: true }].slice(-HISTORY_LIMIT));
  return true;
}

export function reorderPages(id, orderedIds) {
  const loaded = loadDeck(id);
  if (!loaded) return false;
  const { deck } = loaded;
  const map = new Map(deck.file_contents.map((f) => [f.page_id, f]));
  const next = orderedIds.map((pid) => map.get(pid)).filter(Boolean);
  if (next.length !== deck.file_contents.length) return false;
  next.forEach((f, i) => { f.page_index = i; });
  deck.file_contents = next;
  deck.meta_data.version_number += 1;
  deck.meta_data.updated_at = nowIso();
  deck.meta_data.etag = computeEtag(deck);
  writeJson(path.join(deckDir(id), 'deck.json'), deck);
  return true;
}

export function getHistory(id) {
  return readJson(path.join(deckDir(id), 'history.json'), []);
}

/**
 * Restore a previous version (M4 history panel).
 * The history entries carry the page ids + version number; the page files are
 * rewritten from a snapshot kept alongside the deck.
 */
export function restoreVersion(id, versionNumber) {
  const loaded = loadDeck(id);
  if (!loaded) return { status: 404, data: null, message: 'deck not found' };
  const { deck, history } = loaded;
  const entry = history.find((h) => h.version_number === Number(versionNumber));
  if (!entry) return { status: 404, data: null, message: 'version not found' };
  const snapDir = path.join(deckDir(id), 'snapshots', String(entry.version_number));
  if (!existsSync(snapDir)) return { status: 409, data: null, message: 'snapshot content not available for this version' };

  for (const f of readdirSync(snapDir)) {
    if (!f.endsWith('.html')) continue;
    copyFileSync(path.join(snapDir, f), path.join(deckDir(id), 'pages', f));
  }
  deck.meta_data.version_number += 1;
  deck.meta_data.updated_at = nowIso();
  deck.meta_data.etag = computeEtag(deck);
  const next = [...history, {
    version_number: deck.meta_data.version_number, etag: deck.meta_data.etag,
    created_at: deck.meta_data.updated_at, page_count: deck.file_contents.length,
    pages: deck.file_contents.map((f) => f.page_id), note: `restore v${entry.version_number}`, manual: true,
  }].slice(-HISTORY_LIMIT);
  writeJson(path.join(deckDir(id), 'deck.json'), deck);
  writeJson(path.join(deckDir(id), 'history.json'), next);
  return { status: 0, data: { session_state: { version_history: next }, meta_data: deck.meta_data }, message: '' };
}

export { ROOT, DECKS, CANVAS };
