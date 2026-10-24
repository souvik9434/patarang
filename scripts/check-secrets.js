#!/usr/bin/env node
/**
 * scripts/check-secrets.js — repo hygiene: fail on anything that looks like a
 * real API key or private token tried to slip into the tree.
 *
 * Zero dependencies. Runs in CI (`npm test` job) and locally:
 *     node scripts/check-secrets.js
 *
 * Scanned are the files git would track (when available) or a filesystem walk
 * with the same ignore rules as .gitignore. Matching is format-based:
 * provider key shapes (Google `AIza…`, OpenAI `sk-…`, GitHub `ghp_…`),
 * not the harmless `.env.example` placeholders.
 */
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), '.');

/** Official/published key formats. Length thresholds chosen to match vendor docs. */
const PATTERNS = [
  { name: 'Google API key', re: /AIza[0-9A-Za-z_-]{30,}/g },
  { name: 'OpenAI-style secret key', re: /sk-[A-Za-z0-9_-]{20,}/g },
  { name: 'GitHub personal access token', re: /gh[pousr]_[A-Za-z0-9]{20,}/g },
  { name: 'Slack token', re: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
  { name: 'AWS access key id', re: /AKIA[0-9A-Z]{16}/g },
  { name: 'Generic long bearer secret', re: /Bearer\s+[A-Za-z0-9._~+/=-]{40,}/g },
];

// Dirs/files that must never be scanned (local data, vendored code, our own fixtures).
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'data', 'recon', 'proof', 'memory', 'exports',
  'docs/internal', '.tmp', 'dist', 'build', 'output', 'logs',
]);
const SKIP_FILES = new Set([
  'package-lock.json', 'check-secrets.js', '.DS_Store', 'Thumbs.db',
]);

function gitTrackedFiles() {
  try {
    const out = execSync('git ls-files -z', { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
    return out.toString('utf8').split('\0').filter(Boolean);
  } catch {
    return null; // not a git checkout (yet) — fall back to walk
  }
}

function walk() {
  const files = [];
  const visit = (dir, rel = '') => {
    for (const entry of readdirSync(dir)) {
      const abs = path.join(dir, entry);
      const relPath = rel ? `${rel}/${entry}` : entry;
      if (SKIP_DIRS.has(relPath) || SKIP_DIRS.has(entry)) continue;
      let st;
      try { st = statSync(abs); } catch { continue; }
      if (st.isDirectory()) visit(abs, relPath);
      else if (!SKIP_FILES.has(entry)) files.push(relPath);
    }
  };
  visit(ROOT);
  return files;
}

function isText(buf) {
  if (buf.includes(0)) return false; // binary
  return true;
}

const scanTargets = gitTrackedFiles() ?? walk();
const violations = [];

for (const rel of scanTargets) {
  if (SKIP_FILES.has(path.basename(rel))) continue;
  if (SKIP_DIRS.has(rel.split(path.sep)[0]) || SKIP_DIRS.has(rel)) continue;
  let buf;
  try { buf = readFileSync(path.join(ROOT, rel)); } catch { continue; }
  if (!isText(buf)) continue;
  const text = buf.toString('utf8');
  for (const { name, re } of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const line = text.slice(0, m.index).split('\n').length;
      violations.push(`${name} in ${rel}:${line} → ${m[0].slice(0, 8)}…`);
    }
  }
}

if (violations.length) {
  console.error(`✖ ${violations.length} potential secret(s) found:\n  ${violations.join('\n  ')}`);
  console.error('\nIf one is a real key: REVOKE it at the provider immediately, then remove it from the tree.');
  process.exit(1);
}

console.log(`✓ no key-shaped secrets in ${scanTargets.length} scanned file(s)`);
