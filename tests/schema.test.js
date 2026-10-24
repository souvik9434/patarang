import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDeck, makeMetaData, makeFileContent, validateDeck, computeEtag, canonical } from '../src/schema.js';

test('makeDeck produces a valid deck', () => {
  const deck = makeDeck({ meta_data: makeMetaData({ file_name: 'Test deck' }) });
  deck.file_contents.push(makeFileContent({ content: '<html></html>' }));
  const v = validateDeck(deck);
  assert.equal(v.ok, true, JSON.stringify(v.issues));
  assert.equal(deck.meta_data.height, 720);
  assert.equal(deck.meta_data.width, 1280);
  assert.equal(deck.meta_data.page_num, 0);
});

test('validateDeck rejects a deck without project_id', () => {
  const v = validateDeck({ type: 'slides_agent', meta_data: makeMetaData(), file_contents: [] });
  assert.equal(v.ok, false);
  assert.ok(v.issues.some((i) => i.msg.includes('project_id')));
});

test('validateDeck rejects a file_content whose content is not a string', () => {
  const deck = makeDeck({});
  deck.file_contents.push({ page_id: 'pg_1', content: { nope: true } });
  const v = validateDeck(deck);
  assert.equal(v.ok, false);
});

test('etag changes when content changes and is stable otherwise', () => {
  const deck = makeDeck({});
  deck.file_contents.push(makeFileContent({ page_id: 'pg_1', content: 'a' }));
  const e1 = computeEtag(deck);
  const e2 = computeEtag(deck);
  assert.equal(e1, e2);
  deck.file_contents[0].content = 'b';
  assert.notEqual(computeEtag(deck), e1);
});

test('canonical is key-order independent', () => {
  assert.equal(canonical({ a: 1, b: 2 }), canonical({ b: 2, a: 1 }));
});
