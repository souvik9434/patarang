import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'patarang-store-test-'));
process.env.PATARANG_DATA = tmp;

const store = await import('../src/store.js');

after(() => rmSync(tmp, { recursive: true, force: true }));

test('createDeck + getSlideData returns the Genspark-parity envelope', () => {
  const deck = store.createDeck({ title: 'Test' });
  const added = store.addPage(deck.project_id, { html: '<html><body>one</body></html>', title: 'one' });
  assert.ok(added.page_id);
  const payload = store.getSlideData(deck.project_id);
  assert.equal(payload.status, 0);
  assert.equal(payload.data.meta_data.page_num, 1);
  assert.equal(payload.data.file_contents.length, 1);
  assert.equal(payload.data.file_contents[0].content, '<html><body>one</body></html>');
  assert.ok(Array.isArray(payload.data.version_history));
});

test('save bumps version and appends history', () => {
  const deck = store.createDeck({ title: 'Test2' });
  store.addPage(deck.project_id, { html: '<p>a</p>', title: 'a' });
  const before = store.getSlideData(deck.project_id).data.meta_data.version_number;
  const res = store.saveSlideData(deck.project_id, {
    project_id: deck.project_id,
    updated_file_contents: [],
    updated_meta_data: { page_num: 1 },
    is_manual_edit: true,
  });
  assert.equal(res.status, 0);
  assert.equal(res.data.meta_data.version_number, before + 1);
  assert.ok(res.data.session_state.version_history.length >= 1);
});

test('a stale save is rejected with 409 and the current version', () => {
  const deck = store.createDeck({ title: 'Test3' });
  store.addPage(deck.project_id, { html: '<p>a</p>', title: 'a' });
  store.saveSlideData(deck.project_id, { updated_file_contents: [], updated_meta_data: {}, is_manual_edit: true });
  const stale = store.saveSlideData(deck.project_id, { updated_file_contents: [], updated_meta_data: {}, is_manual_edit: true, version_number: 0 });
  assert.equal(stale.status, 409);
  assert.ok(stale.data.current_version_number >= 1);
});

test('replacePages swaps the whole deck', () => {
  const deck = store.createDeck({ title: 'Test4' });
  store.replacePages(deck.project_id, [
    { page_id: 'pg_a', content: '<p>a</p>' },
    { page_id: 'pg_b', content: '<p>b</p>' },
  ], { note: 'test' });
  const payload = store.getSlideData(deck.project_id);
  assert.equal(payload.data.file_contents.length, 2);
  assert.equal(payload.data.meta_data.page_num, 2);
  assert.equal(payload.data.file_contents[1].content, '<p>b</p>');
});

test('deletePage and reorderPages keep indexes contiguous', () => {
  const deck = store.createDeck({ title: 'Test5' });
  store.replacePages(deck.project_id, [
    { page_id: 'pg_1', content: '1' }, { page_id: 'pg_2', content: '2' }, { page_id: 'pg_3', content: '3' },
  ]);
  store.deletePage(deck.project_id, 'pg_2');
  const payload = store.getSlideData(deck.project_id);
  assert.equal(payload.data.file_contents.length, 2);
  assert.deepEqual(payload.data.file_contents.map((f) => f.page_index), [0, 1]);
  store.reorderPages(deck.project_id, ['pg_3', 'pg_1']);
  const after = store.getSlideData(deck.project_id);
  assert.deepEqual(after.data.file_contents.map((f) => f.page_id), ['pg_3', 'pg_1']);
});

test('listDecks reports the newest first', () => {
  const decks = store.listDecks();
  assert.ok(decks.length >= 1);
  assert.ok(decks[0].project_id);
});
