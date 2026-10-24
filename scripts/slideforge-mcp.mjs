#!/usr/bin/env node
/**
 * slideforge-mcp.mjs — MCP stdio server exposing SlideForge to coding agents
 * (opencode, Freebuff gateway, any MCP client). 2026-10-23.
 *
 * Newline-delimited JSON-RPC 2.0 over stdio (MCP stdio transport). Tools call
 * the local SlideForge HTTP API (default http://127.0.0.1:4173) with the
 * Bearer token from D:\SlideForge\data\agents.json — the SAME token the ⛓
 * Connect tab reveals/rotates. Agent access must be ON in the Connect tab or
 * every call returns a clean 403 denial.
 *
 *   SLIDEFORGE_URL=http://127.0.0.1:4173  (optional override)
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url))); // D:\SlideForge
const AGENTS_FILE = path.join(ROOT, 'data', 'agents.json');
const BASE = process.env.SLIDEFORGE_URL || 'http://127.0.0.1:4173';

function token() {
  if (process.env.SLIDEFORGE_AGENT_TOKEN) return process.env.SLIDEFORGE_AGENT_TOKEN;
  if (existsSync(AGENTS_FILE)) {
    try { return JSON.parse(readFileSync(AGENTS_FILE, 'utf8')).token || ''; } catch { return ''; }
  }
  return '';
}

async function callApi(pathname, opts = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'x-agent-name': process.env.SLIDEFORGE_AGENT_NAME || 'opencode',
    ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
  };
  const res = await fetch(`${BASE}${pathname}`, { method: opts.method || 'GET', headers, ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}) });
  const payload = await res.json().catch(() => ({ status: -1, message: `non-JSON ${res.status}` }));
  if (!res.ok || payload.status !== 0) {
    throw new Error(payload?.message || `SlideForge ${pathname} → ${res.status}`);
  }
  return payload.data;
}

const TOOLS = [
  {
    name: 'slideforge_schema',
    description: 'Read SlideForge archetype contracts, slot shapes, word budgets, and themes so you can build or edit slides directly without needing any SlideForge API key.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'slideforge_list_decks',
    description: 'List decks in SlideForge (project_id, title, slide count, updated time) plus any pending user prompts queued from the browser UI.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'slideforge_deck',
    description: 'Read one deck: every page with 1-based page_no, page_id, archetype, theme, full spec, and slot map [{slot, value}].',
    inputSchema: { type: 'object', properties: { project_id: { type: 'string' } }, required: ['project_id'], additionalProperties: false },
  },
  {
    name: 'slideforge_build_deck',
    description: 'Create a new deck (or replace project_id) from structured SlideSpec[] slides. Requires NO API key inside SlideForge — the calling agent supplies the slide specs directly. Returns project_id and live editor_url.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        theme: { type: 'string' },
        project_id: { type: 'string' },
        slides: { type: 'array', items: { type: 'object' } },
      },
      required: ['slides'],
      additionalProperties: false,
    },
  },
  {
    name: 'slideforge_save_slides',
    description: 'Upsert (by 1-based page_no), append, or replace slides on an existing deck using structured SlideSpec[] objects. Requires NO API key.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        mode: { type: 'string', enum: ['upsert', 'append', 'replace'] },
        theme: { type: 'string' },
        slides: { type: 'array', items: { type: 'object' } },
      },
      required: ['project_id', 'slides'],
      additionalProperties: false,
    },
  },
  {
    name: 'slideforge_manage_deck',
    description: 'Structural deck operations (theme | delete | reorder | notes) without using AI credits.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        action: { type: 'string', enum: ['theme', 'delete', 'reorder', 'notes'] },
        theme: { type: 'string' },
        page: { type: 'integer' },
        pages: { type: 'array', items: { type: 'integer' } },
        order: { type: 'array' },
        notes: { type: 'string' },
      },
      required: ['project_id', 'action'],
      additionalProperties: false,
    },
  },
  {
    name: 'slideforge_chat',
    description: 'Send a natural-language instruction OR a JSON builder command ({"action":"build"|"save_slides"|"manage"|"schema",...}) to SlideForge.',
    inputSchema: { type: 'object', properties: { message: { type: 'string' }, project_id: { type: 'string' } }, required: ['message'], additionalProperties: false },
  },
  {
    name: 'slideforge_edit_text',
    description: 'Surgically set one text slot: {project_id, page (1-based), slot (dot path from slideforge_deck), value}. Does NOT use AI credits — deterministic store edit.',
    inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, page: { type: 'integer', minimum: 1 }, slot: { type: 'string' }, value: { type: 'string' } }, required: ['project_id', 'page', 'slot', 'value'], additionalProperties: false },
  },
  {
    name: 'slideforge_upload_media',
    description: 'Upload generated SVG artwork/illustrations/diagrams (`svg` string) or raster images (`data_base64`) into a deck and receive the `/media/<deck>/<file>` URL to use in `image-text`, `custom`, or `spec.image`.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        filename: { type: 'string' },
        svg: { type: 'string' },
        data_base64: { type: 'string' },
      },
      required: ['project_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'slideforge_export',
    description: 'Export a deck to pdf | png | pptx-native | pptx-image; returns the file path(s).',
    inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, format: { type: 'string' } }, required: ['project_id'], additionalProperties: false },
  },
];

/* ------------------------------ JSON-RPC loop ------------------------------ */

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => {
  buf += c;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    handleLine(line);
  }
});
process.stdin.on('end', () => process.exit(0));

function write(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }

function handleLine(line) {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  if (method === undefined) return; // response to nothing we sent
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') return;
  if (method === 'ping') { write({ jsonrpc: '2.0', id, result: {} }); return; }

  switch (method) {
    case 'initialize':
      write({
        jsonrpc: '2.0', id,
        result: {
          protocolVersion: params?.protocolVersion || '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'slideforge', version: '1.0.0' },
          instructions: 'SlideForge is the deck editor at ' + BASE + '. Turn on agent access in the ⛓ Connect tab. slideforge_deck + slideforge_edit_text are credit-free; slideforge_chat uses the configured AI.',
        },
      });
      return;
    case 'tools/list':
      write({ jsonrpc: '2.0', id, result: { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) } });
      return;
    case 'tools/call': {
      const tool = String(params?.name || '');
      const args = params?.arguments || {};
      runTool(tool, args)
        .then((data) => write({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify({ ok: true, tool, data }, null, 1) }] } }))
        .catch((e) => write({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: String(e?.message || e) }] } }));
      return;
    }
    default:
      write({ jsonrpc: '2.0', id, error: { code: -32601, message: `unknown method ${method}` } });
  }
}

async function runTool(tool, args) {
  switch (tool) {
    case 'slideforge_schema':
      return callApi('/api/agents/schema');
    case 'slideforge_list_decks': {
      const res = await callApi('/api/agents/decks');
      return res.inbox?.length ? { decks: res.decks, inbox: res.inbox } : res.decks;
    }
    case 'slideforge_deck':
      return callApi(`/api/agents/decks/${encodeURIComponent(String(args.project_id || ''))}`);
    case 'slideforge_build_deck':
      return callApi('/api/agents/decks/build', { method: 'POST', body: args });
    case 'slideforge_save_slides':
      return callApi(`/api/agents/decks/${encodeURIComponent(String(args.project_id || ''))}/slides`, { method: 'POST', body: args });
    case 'slideforge_manage_deck':
      return callApi(`/api/agents/decks/${encodeURIComponent(String(args.project_id || ''))}/manage`, { method: 'POST', body: args });
    case 'slideforge_chat': {
      const body = { message: String(args.message || '') };
      if (args.project_id) body.project_id = args.project_id;
      return callApi('/api/agents/chat', { method: 'POST', body });
    }
    case 'slideforge_edit_text':
      return callApi('/api/agents/slides/text', {
        method: 'POST',
        body: { project_id: args.project_id, page: Number(args.page) || 1, slot: args.slot, value: String(args.value ?? '') },
      });
    case 'slideforge_upload_media':
      return callApi('/api/agents/media', { method: 'POST', body: args });
    case 'slideforge_export':
      return callApi('/api/agents/export', { method: 'POST', body: { project_id: args.project_id, format: args.format || 'pdf' } });
    default:
      throw new Error(`unknown tool ${tool}`);
  }
}
