/**
 * scripts/export-cli.js — export a stored deck without the HTTP layer.
 *
 *   node scripts/export-cli.js <deck_id> [--format pdf|png|pptx-native|pptx-image]
 */

import path from 'node:path';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as store from '../src/store.js';
import { parseSlideHtml } from '../src/render/parse.js';
import { exportPdf, exportPng, exportPptxNative, exportPptxImage, closeBrowser } from '../src/export/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FONTS_DIR = path.join(ROOT, 'public', 'fonts');
const EXPORT_DIR = path.join(ROOT, 'exports');

const args = process.argv.slice(2);
const deckId = args[0];
const flagIdx = args.indexOf('--format');
const format = flagIdx > -1 ? args[flagIdx + 1] : 'pdf';

if (!deckId) {
  console.error('usage: node scripts/export-cli.js <deck_id> [--format pdf|png|pptx-native|pptx-image]');
  console.error('decks:', store.listDecks().map((d) => d.project_id).join('\n        '));
  process.exit(1);
}

const loaded = store.loadDeck(deckId);
if (!loaded) { console.error('deck not found:', deckId); process.exit(1); }

const pages = loaded.deck.file_contents.map((fc) => ({ page_id: fc.page_id, content: loaded.pages[fc.page_id] || '' }));
const specs = pages.map((p) => parseSlideHtml(p.content).spec);
const base = `deck-${deckId.slice(0, 8)}`;

if (format === 'pdf') {
  const file = path.join(EXPORT_DIR, `${base}.pdf`);
  await exportPdf(pages, { outFile: file, fontsDir: FONTS_DIR });
  console.log(`${file}  (${statSync(file).size} bytes)`);
} else if (format === 'png') {
  const dir = path.join(EXPORT_DIR, base);
  const files = await exportPng(pages, { outDir: dir, fontsDir: FONTS_DIR, scale: 2 });
  console.log(files.join('\n'));
} else if (format === 'pptx-native') {
  const file = path.join(EXPORT_DIR, `${base}.pptx`);
  const res = await exportPptxNative(specs, { outFile: file });
  console.log(`${file}  (${statSync(file).size} bytes)`);
  res.warnings.forEach((w) => console.log('  ⚠ ' + w));
} else if (format === 'pptx-image') {
  const dir = path.join(EXPORT_DIR, `${base}-png`);
  const files = await exportPng(pages, { outDir: dir, fontsDir: FONTS_DIR, scale: 2 });
  const file = path.join(EXPORT_DIR, `${base}-image.pptx`);
  const res = await exportPptxImage(files, { outFile: file });
  console.log(`${file}  (${statSync(file).size} bytes)`);
  res.warnings.forEach((w) => console.log('  ⚠ ' + w));
} else {
  console.error('unknown format', format);
}

await closeBrowser();
