/**
 * ai/config-store.js — where the provider configuration lives.
 *
 * data/config.json next to the deck store (same SLIDEFORGE_DATA root), read
 * lazily, written atomically. The API key is NEVER returned to the UI unmasked
 * and is NEVER logged; only config save/receipt round-trips the full key.
 */

import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_MODELS } from './catalog.js';

const ROOT = process.env.SLIDEFORGE_DATA || path.resolve(process.cwd(), 'data');
const FILE = path.join(ROOT, 'config.json');

const ALLOWED_PROVIDERS = new Set(['gemini', 'vertex', 'openai-compatible']);

let cached = null;
let cachedAt = 0;

function readFile() {
  try {
    return existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {};
  } catch {
    return {};
  }
}

/**
 * Full config (server-side only). File is the single source of truth:
 * an env var must never silently swap the AI engine or inject a key
 * (2026-10-23 security mandate). NO offline mode: unconfigured => provider ''.
 */
export function loadConfig() {
  if (cached && Date.now() - cachedAt < 2000) return cached;
  const file = readFile();
  const env = process.env;
  const cfg = {
    provider: (file.provider || '').toLowerCase(),
    apiKey: file.apiKey ?? '',
    model: file.model || '',
    reasoning: ['off', 'low', 'medium', 'high'].includes(file.reasoning) ? file.reasoning : 'low',
    baseUrl: file.baseUrl || '',
    cacheName: file.cacheName || env.SLIDEFORGE_VERTEX_CACHE || '',
  };
  if (!ALLOWED_PROVIDERS.has(cfg.provider)) cfg.provider = '';
  if (cfg.provider && !cfg.model) {
    cfg.model = DEFAULT_MODELS[cfg.provider === 'vertex' ? 'gemini' : cfg.provider] || DEFAULT_MODELS.gemini;
  }
  cached = cfg;
  cachedAt = Date.now();
  return cfg;
}

/** Merge a save into the file (only defined, validated fields land). */
export function saveConfig(patch = {}) {
  const current = readFile();
  const next = { ...current };
  if (typeof patch.provider === 'string' && ALLOWED_PROVIDERS.has(patch.provider.toLowerCase())) {
    next.provider = patch.provider.toLowerCase();
  }
  if (typeof patch.apiKey === 'string') next.apiKey = patch.apiKey.trim();
  else if (patch.apiKey === null) delete next.apiKey; // explicit clear
  if (typeof patch.model === 'string' && patch.model.trim()) next.model = patch.model.trim();
  if (['off', 'low', 'medium', 'high'].includes(patch.reasoning)) next.reasoning = patch.reasoning;
  if (typeof patch.baseUrl === 'string') next.baseUrl = patch.baseUrl.trim();
  if (typeof patch.cacheName === 'string') next.cacheName = patch.cacheName.trim();
  writeFileSync(FILE, JSON.stringify(next, null, 2) + '\n', 'utf8');
  cached = null;
  cachedAt = 0;
  return loadConfig();
}

/** "abc123…w9yz" — enough to identify a key, useless to a thief. */
export function maskKey(key) {
  const k = String(key || '');
  if (!k) return '';
  // Never echo a key prefix: a provider key's head identifies the project.
  return `••••${k.slice(-4)}`;
}

/** What the UI is allowed to see. `connected` = real provider + key saved. */
export function publicConfig() {
  const cfg = loadConfig();
  return {
    provider: cfg.provider,
    model: cfg.model,
    reasoning: cfg.reasoning,
    baseUrl: cfg.baseUrl,
    key: maskKey(cfg.apiKey),
    key_present: !!cfg.apiKey,
    cacheName: cfg.cacheName ? true : false,
    source: process.env.SLIDEFORGE_API_KEY ? 'env' : 'file',
    connected: !!cfg.provider && !!cfg.apiKey,
  };
}

/** Config path (for docs/tests). */
export function configPath() { return FILE; }
