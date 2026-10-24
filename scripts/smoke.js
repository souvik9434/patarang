/** scripts/smoke.js — end-to-end HTTP smoke: generate (SSE) → slide_data → save → export. */
const BASE = process.env.BASE || 'http://127.0.0.1:4173';

const j = async (path, opts) => {
  const r = await fetch(BASE + path, opts);
  return r.json();
};

console.log('1) provider:', JSON.stringify((await j('/api/provider')).data));

const brief = 'A board update on why our consumer-video pipeline stalled and the three moves that fix it';
const res = await fetch(`${BASE}/api/decks/generate`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ brief, slides: 6, theme: 'cobalt' }),
});
const text = await res.text();
const frames = text.split('\n\n').filter(Boolean).map((f) => JSON.parse(f.replace(/^data: /, '')));
console.log('2) generate frames:', frames.map((f) => f.type).join(','));
const done = frames.find((f) => f.type === 'done');
if (!done) {
  const err = frames.find((f) => f.type === 'error');
  console.log('2b) AI unavailable:', String(err?.message || 'no done frame').slice(0, 160));
  console.log('SMOKE SKIPPED (AI unavailable — non-AI gates not run)');
  process.exit(0);
}
console.log('   deck:', done.project_id, 'slides:', done.page_count, 'verify rows:', done.verification?.length ?? 0);
const id = done.project_id;

const sd = await j(`/api/project/slide_data?project_id=${id}&with_version_history=true`);
console.log('3) slide_data:', sd.status, 'pages:', sd.data.file_contents.length, 'size:', sd.data.meta_data.width + 'x' + sd.data.meta_data.height, 'history:', sd.data.version_history.length);

const fc = sd.data.file_contents[0];
const save = await j('/api/project/save_slide_data', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    project_id: id,
    updated_file_contents: [{ page_id: fc.page_id, content: fc.content.replace('Where we are', 'Where we stand'), page_index: 0, is_edited: true, action: 'update' }],
    updated_meta_data: { page_num: sd.data.meta_data.page_num },
    is_manual_edit: true,
    version_number: sd.data.meta_data.version_number,
  }),
});
console.log('4) save:', save.status, 'new version:', save.data?.meta_data?.version_number);

const stale = await j('/api/project/save_slide_data', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ project_id: id, updated_file_contents: [], updated_meta_data: {}, is_manual_edit: true, version_number: 0 }),
});
console.log('5) stale save (expect 409):', stale.status, 'current version:', stale.data?.current_version_number);

const exp = await j(`/api/decks/${id}/export`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ format: 'pdf' }),
});
console.log('6) export pdf:', exp.status, exp.data?.name, exp.data?.bytes, 'bytes; warnings:', exp.data?.warnings?.length ?? 0);

const ask = await fetch(`${BASE}/api/decks/${id}/ask`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: 'Make it shorter', slot: 'title', page_id: fc.page_id }),
});
const askFrames = (await ask.text()).split('\n\n').filter(Boolean).map((f) => JSON.parse(f.replace(/^data: /, '')));
const askDone = askFrames.find((f) => f.type === 'done');
console.log('7) point-edit:', askDone?.mode, 'slot:', askDone?.slot, '->', JSON.stringify(askDone?.value));

/* — M4: drag geometry commit (route) + region-rewrite isolation across geometry — */
const gsd = await j(`/api/project/slide_data?project_id=${id}&with_version_history=true`);
const gPage = gsd.data.file_contents[0];
const gHtml = await (await fetch(`${BASE}/canvas/${id}/${gPage.page_id}.html`)).text();
const sfIdMatch = gHtml.match(/data-sf-id="([^"]+)"[^>]*data-sf-slot="title"/) || gHtml.match(/data-sf-slot="title"[^>]*data-sf-id="([^"]+)"/);
const sfId = sfIdMatch ? sfIdMatch[1] : 'title';
const geo = await j(`/api/decks/${id}/slides/${gPage.page_id}/geometry`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sfId, slot: 'title', x: 120, y: 200, w: 600, h: 90 }),
});
console.log('8) geometry commit:', geo.status, 'v' + geo.data?.version_number, 'spec.geometry:', JSON.stringify(geo.data?.spec?.geometry));
const isle = JSON.parse((geo.data?.content || '').match(/<script id="slide-spec"[^>]*>([\s\S]*?)<\/script>/)[1].replace(/\\u003c/g, '<').replace(/<\\\//g, '</'));
console.log('   island geometry matches:', JSON.stringify(isle.geometry?.[sfId]) === JSON.stringify(geo.data?.spec?.geometry?.[sfId]));
console.log('   html bakes absolute pos:', /position:absolute;left:120px;top:200px/.test(geo.data?.content || ''));

const geo2 = await j(`/api/decks/${id}/slides/${gPage.page_id}/geometry`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sfId, x: 30, y: 40 }),
});
console.log('9) second drag (no w/h):', geo2.status, JSON.stringify(geo2.data?.spec?.geometry?.[sfId]), 'v' + geo2.data?.version_number);

const geoBad = await j(`/api/decks/${id}/slides/${gPage.page_id}/geometry`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sfId: '' }),
});
console.log('10) invalid geometry (expect 400):', geoBad.status, geoBad.message);
/* — M-PROV: provider catalogue + config read (GET-only; never clobbers user config) — */
const cat = await j('/api/ai/catalog');
console.log('11) ai catalog:', cat.status, cat.data?.providers?.map((p) => p.id).join(','));
const models = await j('/api/ai/models?provider=vertex');
const vm = models.data?.models || [];
console.log('12) vertex models:', vm.length, 'first:', vm[0]?.id, '· reasoning ctl:', vm.some((m) => m.thinking?.length), '· cache flags:', vm.every((m) => m.cache));
const cfg = await j('/api/ai/config');
console.log('13) ai config GET (masked):', cfg.status, 'provider:', cfg.data?.provider, 'key:', cfg.data?.key || '(none)', '· reasoning:', cfg.data?.reasoning);

/* — P0a: media upload → slide image commit → drag → /media/ serving → PDF carries the image — */
const badgeData = (await j('/api/provider')).data;
console.log('14) provider badge inputs (P0b):', 'provider:', badgeData.provider, '· key_present:', badgeData.key_present,
  '→ ribbon:', badgeData.provider === 'mock' ? 'MOCK DATA — no API key · content is generated locally'
  : badgeData.key_present ? '(none)' : 'NO KEY — ' + badgeData.provider + ' selected · paste your key in ⚙ Setup');

const { makePng } = await import('./png.js');
const fd = new FormData();
fd.append('deck_id', id);
fd.append('files', new Blob([makePng(8, 8, [37, 99, 235], true)], { type: 'image/png' }), '..\\..\\evil-poison-name.png'); // hostile filename on purpose
const up = await j('/api/media/upload', { method: 'POST', body: fd });
console.log('15) upload (hostile filename):', up.status, JSON.stringify(up.data?.paths));
const mediaPath = up.data?.paths?.[0]?.path;
if (up.status !== 0 || !mediaPath) {
  console.error('    FATAL: upload failed — is the server running the P0 build? (404 ⇒ stale process on 4173; kill it and restart)');
  process.exit(1);
}
const nameOk = /^\/media\/[\w-]+\/media-\d+-[a-z0-9]{6}\.png$/.test(mediaPath || '');
console.log('    server-generated name (client name ignored):', nameOk);

const bad = new FormData();
bad.append('deck_id', id);
bad.append('files', new Blob([Buffer.from('this is not an image at all')], { type: 'image/png' }), 'fake.png');
const rej = await j('/api/media/upload', { method: 'POST', body: bad });
console.log('    mixed-magic upload rejected (expect 415):', rej?.status ?? '(failed)', rej?.message || '');

const noDeck = new FormData();
noDeck.append('deck_id', 'sf_does_not_exist_at_all');
noDeck.append('files', new Blob([makePng(2, 2)], { type: 'image/png' }), 'x.png');
const noDeckRes = await j('/api/media/upload', { method: 'POST', body: noDeck });
console.log('    unknown deck rejected (expect 404):', noDeckRes?.status, noDeckRes?.message || '');

const mres = await fetch(BASE + mediaPath);
console.log('16) media served:', mres.status, mres.headers.get('content-type'),
  '| nosniff:', mres.headers.get('x-content-type-options'),
  '| CSP:', mres.headers.get('content-security-policy'),
  '| immutable:', (mres.headers.get('cache-control') || '').includes('immutable'));
const mediaBytes = new Uint8Array(await mres.arrayBuffer());
console.log('    magic header:', Array.from(mediaBytes.slice(0, 4)).map((b) => b.toString(16).padStart(2, '0')).join(' '));

const list = await j(`/api/media/list?deck_id=${id}`);
console.log('    list:', list.status, 'items:', JSON.stringify(list.data?.items?.map((i) => ({ w: i.w, h: i.h, bytes: i.bytes }))));

const page1 = (await j(`/api/project/slide_data?project_id=${id}`)).data.file_contents[0];
const imgCommit = await j(`/api/decks/${id}/slides/${page1.page_id}/image`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ image: { url: mediaPath, alt: 'smoke checker', fit: 'cover' } }),
});
console.log('17) image commit:', imgCommit.status, 'v' + imgCommit.data?.version_number,
  '| layer:', /\bdata-sf-id="img"/.test(imgCommit.data?.content || ''),
  '| island image:', (imgCommit.data?.content || '').includes('media-'), '| alt:', /\balt="smoke checker"/.test(imgCommit.data?.content || ''));

const imgGeo = await j(`/api/decks/${id}/slides/${page1.page_id}/geometry`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sfId: 'img', x: 700, y: 96, w: 500, h: 540 }),
});
console.log('    image drag commit:', imgGeo.status, 'geometry.img:', JSON.stringify(imgGeo.data?.spec?.geometry?.img));

const badImg = await j(`/api/decks/${id}/slides/${page1.page_id}/image`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ image: { url: '/media/OTHER_DECK/l.png' } }),
});
console.log('    cross-deck image url rejected (expect 400):', badImg?.status, badImg?.message || '');

const pdfWithImg = await j(`/api/decks/${id}/export`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ format: 'pdf' }),
});
const { readFileSync } = await import('node:fs');
const pdfBytes = readFileSync(pdfWithImg.data.file);
const hasImageXobject = pdfBytes.toString('latin1').includes('/Image');
console.log('18) export pdf with image:', pdfWithImg.status, pdfWithImg.data?.name, pdfWithImg.data?.bytes, 'bytes',
  '| grew vs step 6:', (pdfWithImg.data?.bytes ?? 0) > (exp.data?.bytes ?? 0),
  '| XObject /Image present:', hasImageXobject);

const removed = await j(`/api/decks/${id}/slides/${page1.page_id}/image`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: null }),
});
const geoAfterRemove = (removed.data?.content || '').match(/data-sf-id="img"/);
console.log('19) image removed:', removed.status, '| img layer in content:', !!geoAfterRemove,
  '| geometry img key:', JSON.stringify(removed.data?.spec?.geometry?.img ?? null));
/* — M-ACC: scoped verify (SSE) + notes INTO slides + provenance ledger — */
const sendVerify = async (payload) => {
  const r = await fetch(`${BASE}/api/decks/${id}/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return (await r.text()).split('\n\n').filter(Boolean).map((f) => JSON.parse(f.replace(/^data: /, '')));
};

const vFrames = await sendVerify({ scope: 'deck', mode: 'professional' });
const vDone = vFrames.find((f) => f.type === 'done');
const vResults = vDone?.results || [];
const vPages = new Set(vResults.map((r) => r.page_index));
console.log('20) verify deck:', vFrames.map((f) => f.type).join(','), '| results:', vResults.length,
  '| page-mapped pages:', vPages.size, '| noted:', JSON.stringify(vDone?.noted || []),
  '| usage:', JSON.stringify(vDone?.usage || {}));
const vSd = await j(`/api/project/slide_data?project_id=${id}&with_version_history=true`);
const vFirst = vSd.data.file_contents.find((f) => vPages.has(f.page_index)) || vSd.data.file_contents[0];
const vIsl = (vFirst.content || '').match(/<script id="slide-spec"[^>]*>([\s\S]*?)<\/script>/);
const vSpec = vIsl ? JSON.parse(vIsl[1].replace(/\\u003c/g, '<').replace(/<\\\//g, '</')) : null;
const ledger = vSpec ? String(vSpec.notes || '').split('\n').filter((l) => l.startsWith('[verify ')) : [];
console.log('    island verify ledger lines:', ledger.length, ledger[0] ? '| first: ' + ledger[0].slice(0, 72) : '');
const prov = (vSpec && vSpec.provenance) || {};
console.log('    provenance on that page:', Object.keys(prov).length, 'entries | title origin:', prov.title?.source || '—',
  '| ref:', prov.title?.ref || '—');

const vFrames2 = await sendVerify({ scope: 'deck', mode: 'professional' });
const vDone2 = vFrames2.find((f) => f.type === 'done');
const dupFree = (vDone2?.skipped || []).filter((s) => s.reason === 'notes up to date').length;
console.log('21) re-verify dedupe (expect noted pages reported "notes up to date"):', dupFree,
  '| skipped total:', (vDone2?.skipped || []).length, '| results identical set:', vDone2?.results?.length);

const vFramesEl = await sendVerify({ scope: 'element', mode: 'professional', page_id: vFirst.page_id, slot: 'title' });
const vDoneEl = vFramesEl.find((f) => f.type === 'done');
console.log('22) verify element:', (vDoneEl?.results || []).length, 'item(s) | slot:', vDoneEl?.results?.[0]?.slot,
  '| verdict:', vDoneEl?.results?.[0]?.verdict, '| noted now:', JSON.stringify(vDoneEl?.noted || []));

/* — M-CANVAS: list geometry commits (C5), all-or-nothing, floor/clamp — */
const multiGeo = await j(`/api/decks/${id}/slides/${page1.page_id}/geometry`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ items: [
    { sfId: 'img', x: 640, y: 120, w: 400, h: 300 },
    { sfId: 'title', x: 96, y: 80, w: 800, h: 90 },
  ] }),
});
console.log('23) multi-move list commit:', multiGeo.status, '| applied:', multiGeo.data?.applied,
  '| img:', JSON.stringify(multiGeo.data?.spec?.geometry?.img),
  '| title:', JSON.stringify(multiGeo.data?.spec?.geometry?.title),
  '| stored content clean of bridge chrome:', !(multiGeo.data?.content || '').match(/sf-bbox|sf-guide|sf-hand|sf-alignbar/));

const partBad = await j(`/api/decks/${id}/slides/${page1.page_id}/geometry`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ items: [
    { sfId: 'img', x: 100, y: 100, w: 300, h: 200 },
    { sfId: '', x: 1, y: 2 },
  ] }),
});
const tooBig = { items: [] };
for (let i = 0; i < 41; i++) tooBig.items.push({ sfId: `e${i}`, x: 10 + i, y: 10 });
const overCap = await j(`/api/decks/${id}/slides/${page1.page_id}/geometry`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(tooBig),
});
console.log('24) all-or-nothing 400 + 40-cap:', partBad.status, overCap.status,
  '| bad item not applied:', !(await j(`/api/project/slide_data?project_id=${id}`)).data.file_contents[0].content.includes('100" data-sf-x="100'));

const floorGeo = await j(`/api/decks/${id}/slides/${page1.page_id}/geometry`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sfId: 'img', x: -500, y: -8, w: 5, h: 5 }),
});
console.log('25) resize floor + clamp + legacy single shape:', floorGeo.status,
  JSON.stringify(floorGeo.data?.spec?.geometry?.img));

console.log('\nSMOKE OK');
