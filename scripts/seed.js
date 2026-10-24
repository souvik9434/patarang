/**
 * scripts/seed.js — create a deck from a brief using the active provider and
 * store it on disk, so the editor and the export pipeline can be exercised
 * without a browser session.
 *
 *   node scripts/seed.js "brief" [--slides 8] [--theme midnight]
 */

import { createProvider } from '../src/ai/provider.js';
import { generateDeck } from '../src/ai/orchestrator.js';
import * as store from '../src/store.js';

const args = process.argv.slice(2);
const brief = args[0] || 'A board update on why our consumer-video pipeline stalled and the three moves that fix it';
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i > -1 ? args[i + 1] : dflt;
};
const slides = Number(flag('slides', 8));
const theme = flag('theme', 'midnight');

const provider = createProvider({});
console.log(`provider=${provider.name} model=${provider.model} brief="${brief.slice(0, 60)}…"`);

const deck = store.createDeck({ title: brief.slice(0, 60) });
const result = await generateDeck(provider, brief, { slides, theme, onStep: (s) => console.log(`  · ${s.message}`) });

const pages = result.pages.map((p) => ({ page_id: p.page_id, content: p.content }));
store.replacePages(deck.project_id, pages, { note: 'seeded' });

console.log(`deck_id=${deck.project_id}`);
console.log(`slides=${pages.length}`);
console.log(`data_dir=${store.ROOT}`);
console.log(`open    = http://127.0.0.1:${process.env.PORT || 4173}`);
