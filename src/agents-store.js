/**
 * agents-store.js — the AGENT CONNECT layer (2026-10-23).
 *
 * Lets trusted coding agents (opencode, Freebuff, any MCP client) control
 * Patarang through token-gated HTTP + the MCP stdio server in
 * scripts/patarang-mcp.mjs. Rules (mirrors the key-security mandate):
 *   - token is generated locally on first use, stored ONLY in
 *     data/agents.json, never logged, never sent anywhere;
 *   - access is OFF until the user switches it on in the ⛓ Connect tab;
 *   - the UI sees the token only after an explicit "Reveal" click
 *     (masked by default, e.g. sfag_ab12…ef34);
 *   - the user can rotate the token at any time — old clients stop working.
 */

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.env.PATARANG_DATA || path.resolve(process.cwd(), 'data');
const FILE = path.join(ROOT, 'agents.json');

const AGENT_NAMES = new Set(['opencode', 'freebuff', 'other', 'unknown']);

function ensureDir() {
  if (!existsSync(ROOT)) mkdirSync(ROOT, { recursive: true });
}

/** Mask like the API key: sfag_ab12…ef34 — identity, not a usable secret. */
export function maskToken(t) {
  const k = String(t || '');
  if (!k) return '';
  if (k.length <= 14) return k.slice(0, 9) + '…';
  return `${k.slice(0, 9)}…${k.slice(-4)}`;
}

export function loadAgents() {
  let raw = {};
  if (existsSync(FILE)) {
    try { raw = JSON.parse(readFileSync(FILE, 'utf8')); } catch { raw = {}; }
  }
  const state = {
    enabled: raw.enabled === true,
    token: typeof raw.token === 'string' && /^sfag_[0-9a-f]{32}$/.test(raw.token) ? raw.token : '',
    seen: (raw.seen && typeof raw.seen === 'object' && !Array.isArray(raw.seen)) ? raw.seen : {},
    last_op: (raw.last_op && typeof raw.last_op === 'object') ? raw.last_op : null,
    inbox: Array.isArray(raw.inbox) ? raw.inbox.slice(-20) : [],
  };
  if (!state.token) {
    state.token = 'sfag_' + randomBytes(16).toString('hex');
    writeAgents(state);
  }
  return state;
}

function writeAgents(state) {
  ensureDir();
  writeFileSync(FILE, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

/** Enable / disable agent access (user-driven only; routes enforce the flag). */
export function setEnabled(on) {
  const s = loadAgents();
  s.enabled = on === true;
  writeAgents(s);
  return s;
}

/** Rotate: new token material, old clients (opencode/Freebuff) stop instantly. */
export function rotateToken() {
  const s = loadAgents();
  s.token = 'sfag_' + randomBytes(16).toString('hex');
  s.seen = {}; // rotated token = unknown callers; start the ledger clean
  writeAgents(s);
  return s;
}

/** Record agent activity (best effort — must never break the agent route). */
export function touchAgent(name) {
  try {
    const s = loadAgents();
    const key = AGENT_NAMES.has(name) ? name : 'other';
    s.seen[key] = new Date().toISOString();
    writeAgents(s);
  } catch { /* ledger is best-effort */ }
}

/** Bearer auth: exact-token compare against the persisted token. */
export function authorize(req) {
  const s = loadAgents();
  if (!s.enabled) return false;
  const header = String(req.headers['authorization'] || '').trim();
  const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const alt = String(req.headers['x-agent-token'] || '').trim();
  const given = bearer || alt;
  return given.length >= 16 && given === s.token;
}

/** What the UI may see: no raw token, ever — masked only. */
export function publicAgents() {
  const s = loadAgents();
  return {
    enabled: s.enabled,
    token_masked: maskToken(s.token),
    agents: Object.entries(s.seen).map(([name, at]) => ({ name, last_seen: at })),
    last_op: s.last_op || null,
    inbox: s.inbox || [],
  };
}

/** Record last mutating agent op so the open browser UI auto-syncs live (docs/09 Block 1). */
export function recordAgentOp({ agent = 'opencode', action = 'update', project_id = '', page_no = 1, summary = '' } = {}) {
  const s = loadAgents();
  s.last_op = {
    id: Date.now(),
    agent: AGENT_NAMES.has(agent) ? agent : 'opencode',
    action: String(action || 'update').slice(0, 32),
    project_id: String(project_id || '').slice(0, 64),
    page_no: Math.max(1, Number(page_no) || 1),
    summary: String(summary || '').slice(0, 140),
    at: new Date().toISOString(),
  };
  writeAgents(s);
  return s.last_op;
}

/** Queue a prompt from the browser UI when BYO API key is 429/off so OpenCode MCP can fulfill it. */
export function pushAgentInbox(item = {}) {
  const s = loadAgents();
  s.inbox.push({
    id: Date.now(),
    message: String(item.message || '').slice(0, 1000),
    project_id: item.project_id ? String(item.project_id).slice(0, 64) : null,
    page_no: Number(item.page_no) || 0,
    selection: item.selection || null,
    at: new Date().toISOString(),
  });
  s.inbox = s.inbox.slice(-20);
  writeAgents(s);
  return s.inbox[s.inbox.length - 1];
}

export function clearAgentInbox() {
  const s = loadAgents();
  s.inbox = [];
  writeAgents(s);
  return [];
}
