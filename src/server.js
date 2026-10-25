/**
 * server.js — Patarang HTTP server (zero framework).
 *
 *   GET  /                          editor shell
 *   GET  /canvas/:deck/:page.html   canvas document (iframe target)
 *   GET  /api/project/slide_data    Genspark-parity read
 *   POST /api/project/save_slide_data  Genspark-parity write
 *   POST /api/decks/generate        SSE generation
 *   POST /api/decks/:id/ask         SSE regenerate / targeted rewrite
 *   POST /api/decks/:id/export      pdf | png | pptx-native | pptx-image
 */

import http from 'node:http';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApi, serveStatic, serveCanvas, serveMedia, EXPORT_DIR, closeBrowser } from './api.js';
import { loadConfig } from './ai/config-store.js';
import { ROOT as DATA_ROOT } from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';

mkdirSync(EXPORT_DIR, { recursive: true });
mkdirSync(path.join(DATA_ROOT, 'decks'), { recursive: true });
mkdirSync(path.join(DATA_ROOT, 'media'), { recursive: true });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      const handled = await handleApi(req, res, url);
      if (!handled) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ status: 404, data: null, message: 'no route' })); }
      return;
    }
    if (serveCanvas(req, res, url)) return;
    if (serveMedia(req, res, url)) return;
    if (serveStatic(req, res, url)) return;
    // SPA-ish fallback
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 — Patarang');
  } catch (e) {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 500, data: null, message: e?.message || 'internal error' }));
    } else {
      try { res.end(); } catch {}
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Patarang listening on http://${HOST}:${PORT}`);
  console.log(`  data:    ${path.join(PROJECT_ROOT, 'data')}`);
  console.log(`  exports: ${EXPORT_DIR}`);
  console.log(`  provider: ${loadConfig().provider || '(not connected)'} ${loadConfig().model || ''}`);
});

const shutdown = async () => { await closeBrowser(); server.close(() => process.exit(0)); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
