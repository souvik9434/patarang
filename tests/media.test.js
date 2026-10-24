/**
 * tests/media.test.js — P0a unit gates (docs/05 closed spec):
 *   sniff-by-magic (never extension), size probing, multipart envelope parsing,
 *   server-generated naming + path-safety, spec.image normalisation,
 *   render → parse round-trip, island-less image recovery.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { sniff, probeSize, parseMultipartBuffer, generatedName, safeDeckId, safeFileName, ensureDeckMediaDir, removeDeckMediaDir, listDeckMedia } from '../src/media.js';
import { normalizeSpec } from '../src/spec.js';
import { renderSlideHtml, applyGeometry } from '../src/render/slide-html.js';
import { parseSlideHtml } from '../src/render/parse.js';
import { makePng } from '../scripts/png.js';

/* ------------------------- PNG encoder (from scripts/png.js) ------------------------- */

/* --------------------------------- sniff --------------------------------- */

test('sniff detects types by magic bytes, not extension', () => {
  const png = makePng(2, 2);
  assert.equal(sniff(png).ext, 'png');
  assert.equal(sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])).ext, 'jpg');
  assert.equal(sniff(Buffer.from('GIF89a' + '0'.repeat(10), 'latin1')).ext, 'gif');
  const webp = Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.alloc(4), Buffer.from('WEBPVP8 ', 'latin1')]);
  assert.equal(sniff(webp).ext, 'webp');
  assert.equal(sniff(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')).ext, 'svg');
  assert.equal(sniff(Buffer.from('random bytes of no format')), null);
  assert.equal(sniff(Buffer.alloc(4)), null);
});

test('sniff rejects script-bearing SVG but accepts clean SVG', () => {
  assert.equal(sniff(Buffer.from('<svg><script>alert(1)</script></svg>')), null);
  assert.equal(sniff(Buffer.from('<svg onload="alert(1)"></svg>')), null);
  assert.equal(sniff(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 5"></svg>')).ext, 'svg');
});

test('probeSize reads PNG IHDR and SVG viewBox', () => {
  assert.deepEqual(probeSize(makePng(8, 3), 'png'), { w: 8, h: 3 });
  assert.deepEqual(probeSize(Buffer.from('<svg viewBox="0 0 220 160"></svg>'), 'svg'), { w: 220, h: 160 });
  assert.deepEqual(probeSize(Buffer.from('nonsense'), 'png'), { w: 0, h: 0 }); // never throws
});

/* ------------------------------- multipart ------------------------------- */

test('parseMultipartBuffer extracts fields + file parts with CRLF framing', () => {
  const fileData = makePng(3, 3);
  const body = Buffer.concat([
    Buffer.from('--XYS\r\n', 'latin1'),
    Buffer.from('Content-Disposition: form-data; name="deck_id"\r\n\r\n', 'latin1'),
    Buffer.from('sf_abc123\r\n', 'latin1'),
    Buffer.from('--XYS\r\n', 'latin1'),
    Buffer.from('Content-Disposition: form-data; name="files"; filename="C:\\evil\\..\\weird name.PNG"\r\n', 'latin1'),
    Buffer.from('Content-Type: image/png\r\n\r\n', 'latin1'),
    fileData,
    Buffer.from('\r\n--XYS--\r\n', 'latin1'),
  ]);
  const parts = parseMultipartBuffer(body, 'XYS');
  assert.equal(parts.length, 2);
  assert.equal(parts[0].name, 'deck_id');
  assert.equal(parts[0].data.toString('utf8'), 'sf_abc123');
  assert.equal(parts[1].name, 'files');
  assert.ok(parts[1].filename.includes('weird name.PNG')); // hostile client name is PRESERVED AS METADATA ONLY…
  assert.deepEqual(parts[1].data, fileData);                // …but bytes are exact and naming is server-side
});

/* ------------------------------ name safety ------------------------------ */

test('generated names match the pinned scheme; hostile names/paths are rejected', () => {
  const name = generatedName('png');
  assert.match(name, /^media-\d+-[a-z0-9]{6}\.png$/);
  const seen = new Set(Array.from({ length: 6 }, () => generatedName('png')));
  assert.equal(seen.size > 1, true, 'random suffix must collide-prone-proof names');

  assert.equal(safeDeckId('sf_abc123'), 'sf_abc123');
  assert.equal(safeDeckId('../../etc'), null);
  assert.equal(safeDeckId('sf abc'), null);

  assert.equal(safeFileName('media-123-abc123.png'), 'media-123-abc123.png');
  assert.equal(safeFileName('../evil.js'), null);
  assert.equal(safeFileName('server-side-name-only.js'), null); // blocks path traversal / scripts
  assert.equal(safeFileName(''), null);
});

/* --------------------------- deck media cleanup --------------------------- */

test('ensure/list/removeDeckMediaDir is self-contained and cleaned up', () => {
  const deckId = 'sf_media_selftest';
  const dir = ensureDeckMediaDir(deckId);
  assert.ok(String(dir).includes(path.join('media', 'sf_media_selftest')));
  // empty dir: nothing listed
  assert.deepEqual(listDeckMedia(deckId), { items: [] });
  assert.equal(removeDeckMediaDir(deckId), true);
  assert.equal(existsSync(dir), false);
  // unknown deck: empty list, no throw
  assert.deepEqual(listDeckMedia('sf_never_uploaded'), { items: [] });
});

/* ------------------------------ spec.image ------------------------------ */

test('normalizeSpec attaches a legal /media/ image with default geometry', () => {
  const { spec } = normalizeSpec({ archetype: 'hero', title: 'T', content: { lead: 'L' }, image: { url: '/media/sf_x/media-1-abc123.png', alt: 'A', fit: 'cover', w: 8, h: 3 } });
  assert.equal(spec.image.url, '/media/sf_x/media-1-abc123.png');
  assert.equal(spec.image.fit, 'cover');
  assert.deepEqual(spec.geometry.img, { x: 688, y: 80, w: 520, h: 560 });
});

test('normalizeSpec preserves user-dragged image geometry over defaults', () => {
  const { spec } = normalizeSpec({
    archetype: 'hero', title: 'T', content: { lead: 'L' },
    image: { url: '/media/sf_x/media-1-abc123.png' },
    geometry: { img: { x: 10, y: 20 } },
    geomMode: 'offset', // image-geometry restoration is offset-mode gated
  });
  assert.deepEqual(spec.geometry.img, { x: 10, y: 20 });
});

test('normalizeSpec rejects non-/media/ image urls with a surfaced issue', () => {
  const { spec, issues } = normalizeSpec({ archetype: 'hero', title: 'T', content: { lead: 'L' }, image: { url: 'https://attacker.example/x.png' } });
  assert.equal(spec.image, undefined);
  assert.ok(issues.some((i) => i.includes('image url rejected')));
});

test('normalizeSpec clears the image when the slot is empty but tolerates a bare fit', () => {
  const { spec } = normalizeSpec({ archetype: 'hero', title: 'T', content: { lead: 'L' }, image: { url: '', fit: 'cover' } });
  assert.equal(spec.image, undefined);
});

/* ------------------------------- round trip ------------------------------- */

test('render → parse round-trip preserves image + geometry.img (island path)', () => {
  const { spec } = normalizeSpec({ archetype: 'hero', title: 'T', content: { lead: 'L' }, image: { url: '/media/sf_x/media-1-abc123.png', alt: 'Chart', fit: 'cover', w: 8, h: 3 } });
  const html = renderSlideHtml(spec);
  assert.ok(html.includes('sf-imglayer'));
  assert.ok(html.includes('data-sf-id="img"'));
  assert.ok(html.includes('src="/media/sf_x/media-1-abc123.png"'));
  assert.ok(html.includes('object-fit:cover'));
  assert.ok(html.includes('width="8" height="3"'));

  const parsed = parseSlideHtml(html);
  assert.equal(parsed.degraded, false);
  assert.deepEqual(parsed.spec.image, spec.image);
  assert.deepEqual(parsed.spec.geometry.img, spec.geometry.img);
});

test('image removal clears the layer and geometry key round-trips', () => {
  const withImg = normalizeSpec({ archetype: 'hero', title: 'T', content: { lead: 'L' }, image: { url: '/media/sf_x/media-1-abc123.png' } }).spec;
  const removed = normalizeSpec({ ...withImg, image: null }).spec;
  assert.equal(removed.image, undefined);
  const html = renderSlideHtml(removed);
  assert.ok(!html.includes('class="sf-imglayer"'), 'no image layer element after removal');
  const back = parseSlideHtml(html);
  assert.equal(back.spec.image, undefined);
});

test('applyGeometry positions the image layer like any other slot', () => {
  // real image markup carries data-sf-role="image" → absolute (full-slide overlay)
  const layer = '<div class="sf-imglayer" data-sf-id="img" data-sf-slot="image" data-sf-role="image"><img src="/media/d/f.png"></div>';
  const out = applyGeometry(layer, { img: { x: 40, y: 60, w: 100, h: 80 } });
  assert.ok(/style="position:absolute;left:40px;top:60px;width:100px;height:80px;"/.test(out));
});

test('island-less HTML recovers /media/ images heuristically', () => {
  const html = '<html><body><h1>Imported</h1><img src="/media/sf_x/media-2-def456.png" alt="Recovered"></body></html>';
  const parsed = parseSlideHtml(html);
  assert.equal(parsed.degraded, true);
  assert.equal(parsed.spec.image?.url, '/media/sf_x/media-2-def456.png');
  assert.equal(parsed.spec.image?.alt, 'Recovered');
  assert.ok(parsed.spec.geometry?.img, 'default geometry still injected');
});

/* ------------------------------ temp scaffold ------------------------------ */
/* (none — all helpers imported statically at the top) */
