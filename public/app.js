/**
 * app.js — editor controller.
 *
 * State is tiny and explicit; every network call is one function so the
 * "no framework" cost stays bounded (roast C1).
 */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const state = {
  deck: null,          // meta_data
  pages: [],           // [{page_id, content}]
  index: 0,
  spec: null,
  selection: null,     // { sfId, slot }
  mode: 'select',
  provider: '',
  aiConnected: false,  // real provider + saved key — chat is DISABLED until true
  busy: false,
  dirty: new Map(),    // page_id -> html
};

/* ───────────────────────────── utils ───────────────────────────── */

function toast(msg, isErr = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('is-err', isErr);
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 4200);
}

/* ───────────────────────────── AI response surface ───────────────────────────── */

const aiUI = { live: null, timer: null, startedAt: 0, abort: null, history: [] };

function aiStatus(state, label, meta) {
  const box = $('#aiStatus');
  if (!box) return;
  box.dataset.state = state;
  $('#aiStatusLabel').textContent = label;
  if (meta !== undefined) $('#aiStatusMeta').textContent = meta;
  $('#btnAiCancel').hidden = state !== 'working';
}

function aiBegin(label) {
  const ctrl = new AbortController();
  aiUI.abort = ctrl;
  aiUI.startedAt = Date.now();
  clearInterval(aiUI.timer);
  const tick = () => {
    const s = ((Date.now() - aiUI.startedAt) / 1000).toFixed(1);
    $('#aiStatusMeta').textContent = `${s}s`;
  };
  tick();
  aiUI.timer = setInterval(tick, 200);
  aiStatus('working', label, '0.0s');
  return ctrl.signal;
}

function aiFinish(ok, label) {
  const s = ((Date.now() - aiUI.startedAt) / 1000).toFixed(1);
  clearInterval(aiUI.timer);
  aiUI.timer = null;
  aiUI.abort = null;
  aiStatus(ok ? 'done' : 'error', label, `${ok ? 'finished' : 'failed'} in ${s}s`);
}

/** Render one message card. Returns the node so callers can update it. */
function aiMsg({ kind = 'step', title = '', text = '', rows = [], actions = [] } = {}) {
  const feed = $('#aiLog');
  if (!feed) return null;
  const node = document.createElement('div');
  node.className = 'ai-msg';
  node.dataset.kind = kind;
  const icon = document.createElement('span');
  icon.className = 'ai-msg__icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = kind === 'ok' ? '✓' : kind === 'err' ? '!' : kind === 'result' ? 'i' : '·';
  const body = document.createElement('div');
  body.className = 'ai-msg__body';
  if (title) {
    const t = document.createElement('div');
    t.className = 'ai-msg__title';
    t.textContent = title;
    body.appendChild(t);
  }
  if (text) {
    const tx = document.createElement('div');
    tx.className = 'ai-msg__text';
    tx.textContent = text;
    body.appendChild(tx);
  }
  if (rows.length) {
    const ul = document.createElement('ul');
    ul.className = 'ai-msg__rows';
    for (const r of rows) {
      const li = document.createElement('li');
      if (r.tag) {
        const tag = document.createElement('span');
        tag.className = 'ai-msg__tag';
        tag.dataset.v = r.tag;
        tag.textContent = String(r.tag).replace(/_/g, ' ');
        li.appendChild(tag);
      }
      const sp = document.createElement('span');
      sp.textContent = r.text || String(r);
      li.appendChild(sp);
      ul.appendChild(li);
    }
    body.appendChild(ul);
  }
  for (const a of actions) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'link';
    b.textContent = a.label;
    b.addEventListener('click', a.onClick);
    body.appendChild(b);
  }
  node.append(icon, body);
  feed.appendChild(node);
  while (feed.children.length > 200) feed.firstElementChild.remove();
  feed.scrollTop = feed.scrollHeight;
  aiUI.history.push(`${title ? title + ' — ' : ''}${text}`.trim());
  return node;
}

/** Mark one card as the live (spinning) step; demote the previous one. */
function aiLive(node) {
  if (aiUI.live && aiUI.live !== node) aiUI.live.dataset.kind = 'step';
  if (node) { node.dataset.kind = 'live'; aiUI.live = node; }
}

/** Back-compat shim: every legacy `log(msg, kind)` call renders a card. */
function log(msg, kind = '') {
  if (kind === 'ok') { aiMsg({ kind: 'ok', text: msg }); return null; }
  if (kind === 'err') { aiMsg({ kind: 'err', text: msg }); return null; }
  const node = aiMsg({ kind: 'step', text: msg });
  aiLive(node);
  return node;
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = { status: res.status, message: text.slice(0, 200) }; }
  if (!res.ok && json?.status === 0) json.status = res.status;
  return json;
}

/** POST that returns an SSE stream, invoking onEvent per frame. */
async function sse(path, body, onEvent, signal) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  if (!res.ok || !res.body) throw new Error(`stream failed: ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const frames = buf.split('\n\n');
    buf = frames.pop() || '';
    for (const frame of frames) {
      const line = frame.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      try { onEvent(JSON.parse(line.slice(5).trim())); } catch {}
    }
  }
}

/* ───────────────────────────── deck ───────────────────────────── */

async function loadDeck(id) {
  const payload = await api(`/api/project/slide_data?project_id=${encodeURIComponent(id)}&with_version_history=true`);
  if (!payload || payload.status !== 0) { toast('Could not load deck', true); return; }
  state.deck = payload.data.meta_data;
  state.pages = payload.data.file_contents.map((fc) => ({ page_id: fc.page_id, content: fc.content }));
  state.index = 0;
  state.dirty.clear();
  $('#deckTitle').value = state.deck.file_name || 'Untitled deck';
  $('#versionChip').textContent = 'v' + (state.deck.version_number ?? 0);
  $('#empty').style.display = 'none';
  const frame = $('#stageFrame');
  if (frame) frame.style.display = '';
  renderThumbs();
  showPage(0);
  renderHistory(payload.data.version_history || []);
  refreshMediaList();
}

/** Home: nothing loaded, AI-first. Never auto-open someone's old deck. */
function showHome() {
  state.deck = null;
  state.pages = [];
  state.index = 0;
  state.selection = null;
  state.dirty.clear();
  const frame = $('#stageFrame');
  if (frame) frame.style.display = 'none';
  $('#empty').style.display = '';
  $('#thumbs')?.replaceChildren();
  $('#deckTitle').value = '';
  $('#versionChip').textContent = 'v0';
  refreshRecent();
  $('#brief')?.focus();
}

async function refreshRecent() {
  const box = $('#recent');
  if (!box) return;
  const r = await api('/api/decks');
  const decks = (r?.data?.decks || []).slice(0, 6);
  box.replaceChildren();
  if (!decks.length) { box.hidden = true; return; }
  box.hidden = false;
  const label = document.createElement('span');
  label.className = 'recent__label';
  label.textContent = 'Recent';
  box.appendChild(label);
  for (const d of decks) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'recent__item';
    const strong = document.createElement('strong');
    strong.textContent = d.file_name || 'Untitled deck';
    const meta = document.createElement('span');
    meta.textContent = `${d.page_num} slide${d.page_num === 1 ? '' : 's'} · v${d.version_number}`;
    btn.append(strong, meta);
    btn.addEventListener('click', () => loadDeck(d.project_id));
    box.appendChild(btn);
  }
}

function renderThumbs() {
  const list = $('#thumbs');
  list.innerHTML = '';
  state.pages.forEach((p, i) => {
    const li = document.createElement('li');
    li.className = 'thumb' + (i === state.index ? ' is-active' : '');
    li.dataset.index = String(i);
    li.innerHTML = `<div class="thumb__frame"><iframe loading="lazy" tabindex="-1" title="Slide ${i + 1}" scrolling="no" src="/canvas/${state.deck.project_id}/${p.page_id}.html"></iframe><span class="thumb__num">${i + 1}</span></div>`;
    li.addEventListener('click', () => showPage(i));
    list.appendChild(li);
  });
}

function showPage(i) {
  if (i < 0 || i >= state.pages.length) return;
  state.index = i;
  mediaState.draft = null; // a new target slide starts with a clean draft
  $$('.thumb').forEach((t, k) => t.classList.toggle('is-active', k === i));
  const page = state.pages[i];
  $('#canvas').src = `/canvas/${state.deck.project_id}/${page.page_id}.html?editor=1`;
  fitCanvas();
  renderInspector();
  renderNotes();
}

function fitCanvas() {
  const stage = $('#stage');
  const frame = $('#stageFrame');
  const pad = 48;
  const sw = stage.clientWidth - pad;
  const sh = stage.clientHeight - pad;
  const scale = Math.min(sw / 1280, sh / 720, 1);
  frame.style.transform = `scale(${scale})`;
}

window.addEventListener('resize', fitCanvas);

/* ───────────────────────── canvas bridge ───────────────────────── */

window.addEventListener('message', (ev) => {
  const msg = ev.data;
  if (!msg || msg.v !== 1) return;
  if (msg.method === 'slide.ready') {
    state.spec = msg.params.spec;
    state.slotToSfId = new Map(
      (msg.params.elements || []).filter((e) => e.slot).map((e) => [e.slot, e.sfId]),
    );
    renderInspector();
    renderNotes();
    refreshMediaPane();
  }
  if (msg.method === 'element.select') {
    state.selection = msg.params.sfId
      ? { sfId: msg.params.sfId, slot: msg.params.slot, isLeaf: !!msg.params.isLeaf, text: msg.params.text || '', computed: msg.params.computed || {} }
      : null;
    renderInspector();
    if (state.selection) switchTab('inspect');
  }
  if (msg.method === 'element.geometry.list') commitGeometries(msg.params.items);
  if (msg.method === 'element.geometry') commitGeometry(msg.params);
  if (msg.method === 'element.duplicate') commitDuplicate(msg.params);
  if (msg.method === 'element.delete') commitDelete(msg.params);
  if (msg.method === 'history.undo') applyUndo();
  if (msg.method === 'history.redo') applyRedo();
  if (msg.method === 'selection.action') {
    const act = msg.params?.action;
    if (act === 'ai-rewrite') {
      switchTab('ai');
      const box = $('#aiChatInput');
      if (box) {
        box.placeholder = `Rewrite selected ${state.selection?.slot || 'element'} — e.g. "make it punchier"`;
        box.focus();
      }
    } else if (act === 'focus') {
      switchTab('media');
    }
  }
});

function toCanvas(method, params) {
  const frame = $('#canvas');
  frame.contentWindow?.postMessage({ v: 1, method, params }, '*');
}

/* After a duplicate the canvas reloads; re-select the copy once it boots.
 * The bridge is an ES module and may boot after the load event, so retry a
 * few times — a duplicate select is idempotent. */
let pendingSelect = null;
$('#canvas').addEventListener('load', () => {
  if (!pendingSelect) return;
  const id = pendingSelect;
  pendingSelect = null;
  let tries = 0;
  const tick = () => {
    if (tries++ >= 8) return;
    toCanvas('element.select', { sfId: id });
    setTimeout(tick, 250);
  };
  tick();
});

/* ───────────────────────── geometry & undo ───────────────────────── */

// Per-page edit stacks: page_id -> [{ spec, content }] (deck reload clears them).
const undoStack = new Map();
const redoStack = new Map();
const STACK_CAP = 40;

function snapshotPage(page) {
  return { spec: structuredClone(state.spec), content: page.content };
}

function pushUndo(page) {
  const stack = undoStack.get(page.page_id) || [];
  stack.push(snapshotPage(page));
  undoStack.set(page.page_id, stack.slice(-STACK_CAP));
  redoStack.set(page.page_id, []);
}

function applyUndo() {
  const page = state.pages[state.index];
  const stack = undoStack.get(page.page_id);
  if (!stack || !stack.length) { toast('Nothing to undo'); return; }
  const rStack = redoStack.get(page.page_id) || [];
  rStack.push(snapshotPage(page));
  redoStack.set(page.page_id, rStack.slice(-STACK_CAP));
  const snap = stack.pop();
  page.content = snap.content;
  state.spec = snap.spec;
  state.dirty.set(page.page_id, snap.content); // restore via the manual-edit pipeline
  saveSoon();
  reloadCanvasSoon();
  toast('Undone');
}

function applyRedo() {
  const page = state.pages[state.index];
  const rStack = redoStack.get(page.page_id);
  if (!rStack || !rStack.length) { toast('Nothing to redo'); return; }
  const stack = undoStack.get(page.page_id) || [];
  stack.push(snapshotPage(page));
  undoStack.set(page.page_id, stack.slice(-STACK_CAP));
  const snap = rStack.pop();
  page.content = snap.content;
  state.spec = snap.spec;
  state.dirty.set(page.page_id, snap.content);
  saveSoon();
  reloadCanvasSoon();
  toast('Redone');
}

function isTypingField() {
  const el = document.activeElement;
  return !!(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable));
}

/** Re-load the current page (cache-busted) so baked geometry + fresh spec island show. */
function reloadCanvas() {
  const page = state.pages[state.index];
  if (!page) return;
  $('#canvas').src = `/canvas/${state.deck.project_id}/${page.page_id}.html?editor=1&r=${Date.now()}`;
  const thumb = $$('.thumb')[state.index]?.querySelector('iframe');
  if (thumb) thumb.src = `/canvas/${state.deck.project_id}/${page.page_id}.html`;
}

/**
 * Undo/redo path: restore -> persist -> THEN re-point the iframe. A reload
 * before the save would just re-serve the pre-restore disk content (the
 * exact state being undone), so the refresh must chase the write.
 */
function reloadCanvasSoon() {
  clearTimeout(reloadCanvasSoon._t);
  // persist (1200 ms debounce) runs first; nudge past it with a small margin.
  reloadCanvasSoon._t = setTimeout(reloadCanvas, 1600);
}

/** Geometry commit from a canvas gesture (bridge posts a LIST once, on drop/align/nudge). */
async function commitGeometries(items) {
  const page = state.pages[state.index];
  if (!page || !state.deck || !Array.isArray(items) || !items.length) return;
  const beforeVersion = state.deck.version_number;
  pushUndo(page);
  const res = await api(`/api/decks/${state.deck.project_id}/slides/${page.page_id}/geometry`, {
    method: 'POST',
    body: { items },
  });
  if (res?.status === 409) {
    undoStack.delete(page.page_id);
    toast('Deck changed elsewhere — reloading', true);
    loadDeck(state.deck.project_id);
    return;
  }
  if (res?.status !== 0) {
    undoStack.delete(page.page_id);
    log(res?.message || 'Move failed', 'err');
    toast(res?.message || 'Move failed', true);
    return;
  }
  if (res.data?.degraded) toast('Slide parsed heuristically — geometry still applied');
  state.dirty.delete(page.page_id); // the geometry route already saved this page
  page.content = res.data.content;
  state.deck.version_number = Math.max(state.deck.version_number ?? beforeVersion, res.data.version_number ?? 0);
  $('#versionChip').textContent = 'v' + state.deck.version_number;
  reloadCanvas();
}

/** Single-shape commit kept for script/legacy callers. */
function commitGeometry(g) { return commitGeometries(g ? [g] : []); }

/** Duplicate element: clone geometry + content via the duplicate route. */
async function commitDuplicate(d) {
  const page = state.pages[state.index];
  if (!page || !state.deck || !d?.sfId) return;
  pushUndo(page);
  const res = await api(`/api/decks/${state.deck.project_id}/slides/${page.page_id}/duplicate`, {
    method: 'POST',
    body: d,
  });
  if (res?.status === 409) { undoStack.delete(page.page_id); toast('Deck changed elsewhere — reloading', true); loadDeck(state.deck.project_id); return; }
  if (res?.status !== 0) { undoStack.delete(page.page_id); log(res?.message || 'Duplicate failed', 'err'); toast(res?.message || 'Duplicate failed', true); return; }
  if (res.data?.degraded) toast('Slide parsed heuristically');
  state.dirty.delete(page.page_id);
  page.content = res.data.content;
  state.deck.version_number = Math.max(state.deck.version_number ?? 0, res.data.version_number ?? 0);
  $('#versionChip').textContent = 'v' + state.deck.version_number;
  const newId = res.data?.newId;
  if (newId) pendingSelect = newId;
  reloadCanvas();
  if (newId) {
    toast('Duplicated — drag the copy or press Ctrl+D again');
    log(`Duplicated ${d.sfId} → ${newId}`, 'ok');
  }
}

/** Delete a duplicated extra (pairs with Ctrl+D). */
async function commitDelete(d) {
  const page = state.pages[state.index];
  if (!page || !state.deck || !d?.sfId) return;
  pushUndo(page);
  const res = await api(`/api/decks/${state.deck.project_id}/slides/${page.page_id}/extras/${encodeURIComponent(d.sfId)}`, {
    method: 'DELETE',
  });
  if (res?.status === 409) { undoStack.delete(page.page_id); toast('Deck changed elsewhere — reloading', true); loadDeck(state.deck.project_id); return; }
  if (res?.status !== 0) { undoStack.delete(page.page_id); log(res?.message || 'Delete failed', 'err'); toast(res?.message || 'Delete failed', true); return; }
  state.dirty.delete(page.page_id);
  page.content = res.data.content;
  state.deck.version_number = Math.max(state.deck.version_number ?? 0, res.data.version_number ?? 0);
  $('#versionChip').textContent = 'v' + state.deck.version_number;
  reloadCanvas();
  toast('Element removed');
}

/* ───────────────────────────── inspector ───────────────────────────── */

function slotsFromSpec() {
  const spec = state.spec;
  if (!spec) return [];
  const out = [];
  for (const key of ['kicker', 'title', 'subtitle']) {
    if (spec[key]) out.push({ slot: key, value: spec[key], label: key });
  }
  const c = spec.content || {};
  const walk = (node, prefix) => {
    if (node == null) return;
    if (Array.isArray(node)) node.forEach((v, i) => walk(v, `${prefix}.${i}`));
    else if (typeof node === 'object') Object.entries(node).forEach(([k, v]) => walk(v, prefix ? `${prefix}.${k}` : k));
    else out.push({ slot: prefix, value: node, label: prefix });
  };
  walk(c, '');
  return out;
}

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** M-ACC provenance: tiny origin tag per inspector row (spec.provenance[slot]). */
function originChip(slot) {
  const p = state.spec?.provenance?.[slot];
  if (!p) return '';
  const label = p.source + (p.source === 'ai:rewrite' && p.ref ? ` "${p.ref}"` : '');
  return ` <span class="origin-chip" data-origin="${escapeHtml(p.source)}" title="source: ${escapeHtml(p.source)} · ref: ${escapeHtml(p.ref || '—')} · confidence: ${escapeHtml(String(p.confidence ?? '—'))}">${escapeHtml(label)}</span>`;
}

function renderInspector() {
  const host = $('#inspect');
  host.innerHTML = '';
  const sel = state.selection;
  const page = state.pages[state.index];
  if (sel && page && state.deck) {
    const curSt = state.spec?.styles?.[sel.sfId] || {};
    const studio = document.createElement('div');
    studio.className = 'insp__studio';
    studio.style.cssText = 'padding:12px;border:1px solid var(--line-2);border-radius:10px;background:var(--bg-2);margin-bottom:14px;display:flex;flex-direction:column;gap:8px';
    studio.innerHTML = `
      <div style="font-size:11px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.08em">Selected · ${escapeHtml(sel.sfId)}</div>
      ${sel.isLeaf ? `<label class="insp__label">Text<input id="stText" value="${escapeHtml(curSt.text ?? sel.text)}"></label>` : ''}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <label class="insp__label">Font px<input id="stSize" type="number" min="10" max="120" value="${escapeHtml(curSt.fontSize || sel.computed?.fontSize || 18)}"></label>
        <label class="insp__label">Radius px<input id="stRadius" type="number" min="0" max="999" value="${escapeHtml(curSt.radius ?? sel.computed?.radius ?? 0)}"></label>
        <label class="insp__label">Text color<input id="stColor" placeholder="#f5f5f5" value="${escapeHtml(curSt.color || '')}"></label>
        <label class="insp__label">Fill bg<input id="stBg" placeholder="rgba(...) or #hex" value="${escapeHtml(curSt.bg || '')}"></label>
      </div>
      <label class="insp__label">Shadow
        <select id="stShadow">
          <option value="">Default</option>
          <option value="none" ${curSt.shadow === 'none' ? 'selected' : ''}>None</option>
          <option value="soft" ${curSt.shadow === 'soft' ? 'selected' : ''}>Soft elevation</option>
          <option value="deep" ${curSt.shadow === 'deep' ? 'selected' : ''}>Deep 3D</option>
          <option value="glow" ${curSt.shadow === 'glow' ? 'selected' : ''}>Accent glow</option>
        </select>
      </label>
      <div style="display:flex;gap:6px;margin-top:4px">
        <button class="btn btn--primary btn--block" id="btnApplyStyle" type="button">Apply style</button>
        <button class="btn btn--ghost" id="btnResetStyle" type="button" title="Reset element style">Reset</button>
      </div>
    `;
    host.appendChild(studio);
    const livePreview = () => {
      const st = {};
      if ($('#stSize', studio)?.value) st['font-size'] = $('#stSize', studio).value + 'px';
      if ($('#stRadius', studio)?.value !== '') st['border-radius'] = $('#stRadius', studio).value + 'px';
      if ($('#stColor', studio)?.value.trim()) st.color = $('#stColor', studio).value.trim();
      if ($('#stBg', studio)?.value.trim()) st.background = $('#stBg', studio).value.trim();
      toCanvas('element.style', { sfId: sel.sfId, styles: st });
      if (sel.isLeaf && $('#stText', studio)) toCanvas('element.update', { sfId: sel.sfId, value: $('#stText', studio).value });
    };
    studio.querySelectorAll('input,select').forEach((inp) => inp.addEventListener('input', livePreview));
    $('#btnApplyStyle', studio)?.addEventListener('click', async () => {
      pushUndo(page);
      const style = {};
      if ($('#stSize', studio)?.value) style.fontSize = $('#stSize', studio).value;
      if ($('#stRadius', studio)?.value !== '') style.radius = $('#stRadius', studio).value;
      if ($('#stColor', studio)?.value.trim()) style.color = $('#stColor', studio).value.trim();
      if ($('#stBg', studio)?.value.trim()) style.bg = $('#stBg', studio).value.trim();
      if ($('#stShadow', studio)?.value) style.shadow = $('#stShadow', studio).value;
      const body = { sfId: sel.sfId, slot: sel.slot || '', style };
      if (sel.isLeaf && $('#stText', studio)) { body.text = $('#stText', studio).value; style.text = body.text; }
      const res = await api(`/api/decks/${state.deck.project_id}/slides/${page.page_id}/style`, { method: 'POST', body });
      if (res?.status === 0) {
        page.content = res.data.content;
        state.spec = res.data.spec;
        state.deck.version_number = res.data.version_number;
        $('#versionChip').textContent = 'v' + state.deck.version_number;
        reloadCanvas();
        toast('Element style saved');
      }
    });
    $('#btnResetStyle', studio)?.addEventListener('click', async () => {
      pushUndo(page);
      const res = await api(`/api/decks/${state.deck.project_id}/slides/${page.page_id}/style`, { method: 'POST', body: { sfId: sel.sfId, style: null } });
      if (res?.status === 0) {
        page.content = res.data.content;
        state.spec = res.data.spec;
        reloadCanvas();
        renderInspector();
        toast('Element style reset');
      }
    });
  }
  const slots = slotsFromSpec().filter((s) => s.slot !== 'html');
  if (!slots.length && !sel) {
    host.innerHTML = '<p style="color:var(--ink-3);font-size:12px;line-height:1.5">Click any element on the canvas to style its font, colors, radius, shadow, or text.</p>';
    return;
  }
  for (const s of slots) {
    if (typeof s.value !== 'string' && typeof s.value !== 'number') continue;
    const row = document.createElement('div');
    row.className = 'insp__row';
    const id = 'insp-' + s.slot.replace(/[^\w]/g, '_');
    row.innerHTML = `<label class="insp__label" for="${id}">${s.label}${originChip(s.slot)}</label>
      <input id="${id}" data-slot="${s.slot}" value="${String(s.value).replace(/"/g, '&quot;')}">`;
    const input = $('input', row);
    input.addEventListener('focus', () => {
      const sfId = sfIdForSlot(s.slot);
      if (sfId) toCanvas('element.select', { sfId });
      const page = state.pages[state.index];
      if (page && state.spec) pushUndo(page); // snapshot before the first keystroke
    });
    input.addEventListener('input', () => {
      const sfId = sfIdForSlot(s.slot);
      if (sfId) toCanvas('element.update', { sfId, value: input.value });
      row.classList.add('is-dirty');
      markDirty();
    });
    host.appendChild(row);
  }
}

function sfIdForSlot(slot) {
  if (!state.slotToSfId) return null;
  return state.slotToSfId.get(slot) || null;
}

function renderNotes() {
  const host = $('#notes');
  const spec = state.spec;
  const notes = spec?.notes || '';
  host.innerHTML = `<h4>Speaker notes</h4><p>${notes || 'No notes for this slide.'}</p><h4 style="margin-top:12px">Verification</h4><p id="verifyBox">—</p>`;
}

/* ───────────────────────────── history ───────────────────────────── */

function renderHistory(history) {
  let box = $('#historyBox');
  if (!box) {
    box = document.createElement('div');
    box.id = 'historyBox';
    $('#notes').appendChild(box);
  }
  box.innerHTML = '';
  const h = document.createElement('h4');
  h.textContent = 'Version history';
  box.appendChild(h);
  const ul = document.createElement('div');
  ul.className = 'notes';
  history.slice(-30).reverse().forEach((e) => {
    const d = document.createElement('div');
    d.innerHTML = `<strong style="color:var(--ink)">v${e.version_number}</strong> · ${e.note || 'edit'} · ${e.page_count} slides · ${new Date(e.created_at).toLocaleString()}`;
    ul.appendChild(d);
  });
  box.appendChild(ul);
}

/* ───────────────────────────── saving ───────────────────────────── */

let saveTimer = null;
function markDirty() {
  const page = state.pages[state.index];
  if (!page) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const html = $('#canvas').contentDocument?.documentElement?.outerHTML;
    if (!html) return;
    state.dirty.set(page.page_id, html);
    saveSoon();
  }, 700);
}

let persistTimer = null;
function saveSoon() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persist, 1200);
}

async function persist() {
  if (!state.deck || state.dirty.size === 0) return;
  const updates = [];
  for (const [page_id, content] of state.dirty.entries()) {
    const idx = state.pages.findIndex((p) => p.page_id === page_id);
    updates.push({ page_id, content, page_index: idx, is_edited: true, action: 'update' });
  }
  const payload = {
    project_id: state.deck.project_id,
    updated_file_contents: updates,
    updated_meta_data: { page_num: state.pages.length, file_name: $('#deckTitle').value },
    is_manual_edit: true,
    version_number: state.deck.version_number,
  };
  const res = await api('/api/project/save_slide_data', { method: 'POST', body: payload });
  if (res?.status === 409) {
    toast('This deck changed elsewhere — reload to continue', true);
    return;
  }
  if (res?.status === 0) {
    state.dirty.clear();
    state.deck.version_number = Math.max(state.deck.version_number, res.data?.meta_data?.version_number ?? 0);
    $('#versionChip').textContent = 'v' + state.deck.version_number;
    const history = res.data?.session_state?.version_history || [];
    renderHistory(history);
  }
}

/* ───────────────────────────── actions ───────────────────────────── */

/* ───────────────────── AI chat — the only entry point ───────────────────── */

/**
 * ONE function every message flows through — the empty-state box and the AI
 * panel both call it. The server routes each message to a deck tool
 * (create · add_slides · edit_slide · edit_selection · edit_theme ·
 * delete_slides · verify · answer) so the user NEVER touches a form.
 */
async function sendChat(box) {
  const el = box || $('#aiChatInput');
  const message = (el?.value || '').trim();
  if (!message) return;
  if (!state.aiConnected && !agentState.enabled) {
    toast('AI is not connected — set your API key in ⚙ Setup or enable ⛓ Connect', true);
    switchTab('setup');
    return;
  }
  if (el) el.value = '';
  aiMsg({ kind: 'user', title: 'You', text: message });
  if (!state.aiConnected && agentState.enabled) {
    await api('/api/agents/inbox', {
      method: 'POST',
      body: { message, project_id: state.deck?.project_id || null, page_no: state.pages.length ? state.index + 1 : 0, selection: state.selection || null },
    });
    aiMsg({ kind: 'result', title: '⛓ Queued for OpenCode MCP', text: 'Your prompt is queued in the MCP inbox. Tell OpenCode in your terminal to execute it (zero Gemini API key needed).' });
    toast('Queued for OpenCode MCP');
    return;
  }
  setBusy(true);
  const signal = aiBegin('Thinking');
  let failed = false;
  try {
    await sse('/api/ai/chat', {
      message,
      project_id: state.deck?.project_id || null,
      page_no: state.pages.length ? state.index + 1 : 0,
      page_count: state.pages.length,
      selection: state.selection ? { sfId: state.selection.sfId, slot: state.selection.slot } : null,
      selection_text: selectionText(),
    }, (ev) => {
      if (ev.type === 'reply') { aiMsg({ kind: 'result', title: 'Patarang', text: ev.text }); }
      else if (ev.type === 'step') log(`${ev.message}`);
      else if (ev.type === 'note') aiMsg({ kind: 'err', text: ev.text });
      else if (ev.type === 'deck') { state.deck = ev.meta_data; }
      else if (ev.type === 'done') {
        if (ev.mode === 'create') {
          aiMsg({ kind: 'result', title: `Deck ready — ${ev.page_count} slides`, text: 'Every element is editable: click to select, drag to move, handles to resize.' });
        } else if (ev.mode === 'verify' && ev.text) {
          aiMsg({ kind: 'result', title: 'Verification', text: ev.text });
        } else if (ev.mode === 'edit_selection') {
          aiMsg({ kind: 'result', title: `Selection rewritten — ${ev.slot}`, rows: [{ tag: 'after', text: String(ev.value ?? '') || '(empty)' }] });
        }
        if (ev.usage && Number(ev.usage.output_tokens)) aiMsg({ kind: 'step', text: `Tokens: ${fmtTokens(ev.usage)}` });
        if (ev.project_id) loadDeck(ev.project_id);
      }
      else if (ev.type === 'error') {
        failed = true;
        log(ev.message, 'err');
        toast(ev.message, true);
        if (agentState.enabled) {
          api('/api/agents/inbox', {
            method: 'POST',
            body: { message, project_id: state.deck?.project_id || null, page_no: state.pages.length ? state.index + 1 : 0, selection: state.selection || null },
          });
          aiMsg({ kind: 'result', title: '⛓ Queued for OpenCode MCP (API fallback)', text: 'Direct API key failed (e.g. 429 quota), so this request was automatically queued for OpenCode MCP. Ask OpenCode to build/edit it directly!' });
        }
      }
    }, signal);
    aiFinish(!failed, failed ? 'Failed' : 'Done');
  } catch (e) {
    if (e.name === 'AbortError') { aiFinish(false, 'Cancelled'); log('Cancelled by user'); }
    else { log(String(e.message || e), 'err'); aiFinish(false, 'Failed'); }
  } finally {
    setBusy(false);
  }
}

/** Text of the selected canvas element (chat carries it as edit target). */
function selectionText() {
  if (!state.selection?.sfId) return '';
  try {
    return $('#canvas').contentDocument?.querySelector(`[data-sf-id="${CSS.escape(state.selection.sfId)}"]`)?.textContent?.trim()?.slice(0, 280) || '';
  } catch { return ''; }
}

function fmtTokens(u) {
  const n = (x) => Number(x || 0).toLocaleString('en-IN');
  let s = `${n(u.input_tokens)} in · ${n(u.output_tokens)} out`;
  if (u.cached_tokens) s += ` · ${n(u.cached_tokens)} cached ✓`;
  if (u.thinking_tokens) s += ` · ${n(u.thinking_tokens)} thinking`;
  return s;
}

async function regenerate() {
  const prompt = $('#aiPrompt').value.trim();
  if (!prompt) { toast('Describe the change first', true); return; }
  setBusy(true);
  const signal = aiBegin('Regenerating deck');
  aiLive(aiMsg({ kind: 'step', title: 'Instruction', text: prompt }));
  let failed = false;
  try {
    await sse(`/api/decks/${state.deck.project_id}/ask`, { prompt, slides: state.pages.length }, (ev) => {
      if (ev.type === 'step') log(ev.message);
      else if (ev.type === 'done') {
        aiMsg({ kind: 'result', title: 'Deck regenerated', text: 'The whole deck was rebuilt from your instruction.' });
        if (ev.usage) aiMsg({ kind: 'step', text: `Tokens: ${fmtTokens(ev.usage)}` });
        loadDeck(state.deck.project_id);
      }
      else if (ev.type === 'error') { failed = true; log(ev.message, 'err'); toast(ev.message, true); }
    }, signal);
    aiFinish(!failed, failed ? 'Failed' : 'Deck regenerated');
  } catch (e) {
    if (e.name === 'AbortError') { aiFinish(false, 'Cancelled'); log('Cancelled by user'); }
    else { log(String(e.message || e), 'err'); aiFinish(false, 'Failed'); }
  }
  finally { setBusy(false); }
}

async function rewriteSelection() {
  if (!state.selection?.slot) { toast('Select an element on the canvas first', true); return; }
  const prompt = $('#aiPrompt').value.trim();
  if (!prompt) { toast('Describe the change first', true); return; }
  const sel = state.selection;
  let before = '';
  try {
    const doc = $('#canvas').contentDocument;
    before = doc?.querySelector(`[data-sf-id="${CSS.escape(sel.sfId)}"]`)?.textContent?.trim() || '';
  } catch {}
  setBusy(true);
  const signal = aiBegin('Rewriting selection');
  aiLive(aiMsg({ kind: 'step', title: `Instruction — ${sel.slot}`, text: prompt }));
  let failed = false;
  try {
    await sse(`/api/decks/${state.deck.project_id}/ask`, {
      prompt,
      slot: sel.slot,
      page_id: state.pages[state.index].page_id,
    }, (ev) => {
      if (ev.type === 'step') log(ev.message);
      else if (ev.type === 'done') {
        aiMsg({
          kind: 'result',
          title: `Selection rewritten — ${sel.slot}`,
          rows: [
            { tag: 'before', text: before || '(empty)' },
            { tag: 'after', text: String(ev.value ?? '') || '(empty)' },
          ],
        });
        if (ev.usage) aiMsg({ kind: 'step', text: `Tokens: ${fmtTokens(ev.usage)}` });
        loadDeck(state.deck.project_id);
      }
      else if (ev.type === 'error') { failed = true; log(ev.message, 'err'); toast(ev.message, true); }
    }, signal);
    aiFinish(!failed, failed ? 'Failed' : 'Rewritten');
  } catch (e) {
    if (e.name === 'AbortError') { aiFinish(false, 'Cancelled'); log('Cancelled by user'); }
    else { log(String(e.message || e), 'err'); aiFinish(false, 'Failed'); }
  }
  finally { setBusy(false); }
}

async function runVerify() {
  if (!state.deck) { toast('Generate a deck first', true); return; }
  const scope = $('#verifyScope').value;
  const mode = $('#verifyMode').value;
  if (scope === 'element' && !state.selection?.slot) { toast('Select an element on the canvas first', true); return; }
  if (scope !== 'deck' && !state.pages[state.index]) { toast('Pick a slide first', true); return; }
  setBusy(true);
  const signal = aiBegin('Verifying content');
  aiLive(aiMsg({ kind: 'step', title: 'Verification started', text: `Scope: ${scope} · Mode: ${mode}` }));
  let failed = false;
  try {
    await sse(`/api/decks/${state.deck.project_id}/verify`, {
      scope, mode,
      ...(scope !== 'deck' ? { page_id: state.pages[state.index].page_id } : {}),
      ...(scope === 'element' ? { slot: state.selection.slot } : {}),
    }, (ev) => {
      if (ev.type === 'step') log(ev.message);
      else if (ev.type === 'done') {
        const results = ev.results || [];
        const c = results.reduce((a, r) => { a[r.verdict] = (a[r.verdict] || 0) + 1; return a; }, {});
        aiMsg({
          kind: 'result',
          title: `Verification complete — ${results.length} claim${results.length === 1 ? '' : 's'} checked`,
          text: `${c.plausible || 0} plausible · ${c.needs_source || 0} needs source · ${c.likely_false || 0} likely false\nNotes written to ${(ev.noted || []).length} slide(s); ${(ev.skipped || []).length} skipped.`,
          rows: results.filter((r) => r.verdict !== 'plausible').slice(0, 10)
            .map((r) => ({ tag: r.verdict, text: `${r.item}${r.note ? ' — ' + r.note : ''}` })),
        });
        if (ev.usage) aiMsg({ kind: 'step', text: `Tokens: ${fmtTokens(ev.usage)}` });
        loadDeck(state.deck.project_id); // Notes pane + island refresh with the ledger
      }
      else if (ev.type === 'error') { failed = true; log(ev.message, 'err'); toast(ev.message, true); }
    }, signal);
    aiFinish(!failed, failed ? 'Failed' : 'Verified');
  } catch (e) {
    if (e.name === 'AbortError') { aiFinish(false, 'Cancelled'); log('Cancelled by user'); }
    else { log(String(e.message || e), 'err'); aiFinish(false, 'Failed'); }
  }
  finally { setBusy(false); }
}

async function exportDeck(format) {
  if (!state.deck) return;
  setBusy(true);
  log(`Exporting ${format}…`);
  try {
    const res = await api(`/api/decks/${state.deck.project_id}/export`, { method: 'POST', body: { format } });
    if (res?.status !== 0) { toast(res?.message || 'Export failed', true); log(res?.message || 'Export failed', 'err'); return; }
    const d = res.data;
    toast(`Exported: ${d.name || (d.files || []).length + ' files'}`);
    log(`Export ready: ${d.file || (d.files || []).join(', ')}`, 'ok');
    if (d.warnings?.length) d.warnings.forEach((w) => log('⚠ ' + w));
  } catch (e) {
    toast(String(e.message || e), true);
  } finally { setBusy(false); }
}

function setBusy(on) {
  state.busy = on;
  $$('.btn').forEach((b) => { if (b.id !== 'btnExport') b.disabled = on; });
  applyAiState(); // keep AI entry points gated by connection, not just by busy
}

function switchTab(name) {
  $$('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.tab === name));
  $$('.tabpane').forEach((p) => p.classList.toggle('is-active', p.dataset.pane === name));
  if (name === 'setup' && !switchTab.setupLoaded) {
    switchTab.setupLoaded = true;
    initSetup();
  }
  if (name === 'media') { refreshMediaList(); refreshMediaPane(); }
  if (name === 'connect') initConnect();
}

/* ─────────────────── MY Connect (opencode · Freebuff via MCP) ───────────────────────────── */

const agentState = { token: '', loaded: false, enabled: false, lastOpId: null };

async function initConnect() {
  if (agentState.loaded) { renderAgents(await api('/api/agents/status')); return; }
  agentState.loaded = true;
  const base = 'D:\\Patarang\\scripts\\patarang-mcp.mjs';
  const nodePath = 'C:\\Program Files\\nodejs\\node.exe';
  $('#snipOpen').textContent = JSON.stringify({
    mcp: { servers: { patarang: { type: 'local', command: [nodePath, base], disabled: false } } },
  }, null, 2);
  $('#snipMcp').textContent = [
    'command: ' + nodePath,
    'args:    ' + JSON.stringify([base]),
    'type:    stdio  (newline-delimited JSON-RPC 2.0)',
    'tools:   patarang_schema · patarang_list_decks · patarang_deck · patarang_build_deck · patarang_save_slides · patarang_manage_deck · patarang_edit_text · patarang_export · patarang_chat',
    'env:     PATARANG_URL=http://127.0.0.1:4173 (optional)',
  ].join('\n');
  await refreshAgents();

  $('#btnAgentToggle').addEventListener('click', async () => {
    const st = await api('/api/agents/status');
    const next = !(st?.data?.enabled);
    await api('/api/agents/access', { method: 'POST', body: { enabled: next } });
    await refreshAgents();
    toast(next ? 'Agent access ON — paste the opencode snippet and start it' : 'Agent access OFF');
  });
  $('#btnAgentReveal').addEventListener('click', async () => {
    const res = await api('/api/agents/reveal', { method: 'POST', body: {} });
    agentState.token = res?.data?.token || '';
    $('#agentToken').textContent = agentState.token || '(none)';
  });
  $('#btnAgentRotate').addEventListener('click', async () => {
    const res = await api('/api/agents/rotate', { method: 'POST', body: {} });
    agentState.token = res?.data?.token || '';
    $('#agentToken').textContent = agentState.token;
    toast('Token rotated — old agents stop immediately');
    await refreshAgents();
  });
  $('#btnAgentCopy').addEventListener('click', copyAgentToken);
  $('#btnCopyOpen').addEventListener('click', () => copySnippet('#snipOpen'));
}

async function refreshAgents() {
  const res = await api('/api/agents/status');
  renderAgents(res);
}

function renderAgents(res) {
  const d = res?.data || {};
  agentState.enabled = !!d.enabled;
  if (agentState.lastOpId === null) agentState.lastOpId = d.last_op?.id || 0;
  $('#agentState').textContent = d.enabled ? 'ON' : 'OFF';
  $('#agentState').classList.toggle('is-on', !!d.enabled);
  $('#btnAgentToggle').textContent = d.enabled ? 'Disable agent access' : 'Enable agent access';
  $('#btnAgentToggle').classList.toggle('btn--primary', !d.enabled);
  $('#agentToken').textContent = d.token_masked ? d.token_masked + '…' : 'sfag_••••••••…';
  agentState.tokenMasked = d.token_masked || '';
  const list = $('#agentList');
  const items = d.agents || [];
  list.innerHTML = '';
  if (!items.length) {
    list.append(Object.assign(document.createElement('p'), { className: 'agent__none', textContent: 'No agent activity yet.' }));
  } else {
    for (const a of items) {
      const row = document.createElement('div');
      row.className = 'agent__item';
      row.textContent = `${a.name} · last seen ${new Date(a.last_seen).toLocaleTimeString()}`;
      list.append(row);
    }
  }
  applyAiState();
}

function startAgentSyncWatcher() {
  api('/api/agents/status').then((res) => {
    const d = res?.data || {};
    agentState.enabled = !!d.enabled;
    agentState.lastOpId = d.last_op?.id || 0;
    applyAiState();
  });
  setInterval(async () => {
    if (document.visibilityState === 'hidden' || state.busy || state.dirty.size > 0) return;
    const res = await api('/api/agents/status');
    const d = res?.data;
    if (!d) return;
    const prevEnabled = agentState.enabled;
    agentState.enabled = !!d.enabled;
    if (prevEnabled !== agentState.enabled) applyAiState();
    const op = d.last_op;
    if (op && agentState.lastOpId !== null && op.id > agentState.lastOpId) {
      agentState.lastOpId = op.id;
      if (op.project_id) {
        history.replaceState(null, '', `/?deck=${encodeURIComponent(op.project_id)}`);
        await loadDeck(op.project_id);
        if (op.page_no && state.pages[op.page_no - 1]) selectPage(op.page_no - 1);
      }
      aiMsg({ kind: 'result', title: `⛓ ${op.agent} (${op.action})`, text: op.summary || 'Updated deck via MCP' });
      toast(`⛓ ${op.agent}: ${op.summary || 'deck updated'}`);
    }
  }, 2500);
}

async function copyAgentToken() {
  let token = agentState.token;
  if (!token) {
    const res = await api('/api/agents/reveal', { method: 'POST', body: {} });
    token = res?.data?.token || '';
  }
  if (!token) { toast('No token yet', true); return; }
  try { await navigator.clipboard.writeText(token); toast('Token copied — paste into the agent config'); }
  catch { toast('Clipboard blocked by the browser', true); }
}

async function copySnippet(sel) {
  try { await navigator.clipboard.writeText($(sel).textContent.trim()); toast('Snippet copied'); }
  catch { toast('Clipboard blocked by the browser', true); }
}

/* ───────────────────────── setup (provider picker) ───────────────────────── */

const setupState = { models: [], cfg: null, busy: false };

async function initSetup() {
  const cfgRes = await api('/api/ai/config');
  setupState.cfg = cfgRes?.status === 0 ? cfgRes.data : null;
  const catRes = await api('/api/ai/catalog');
  const providers = catRes?.status === 0 ? catRes.data.providers : [];

  const provSel = $('#provSelect');
  provSel.innerHTML = '';
  for (const pr of providers) {
    const o = document.createElement('option');
    o.value = pr.id;
    o.textContent = pr.label;
    provSel.appendChild(o);
  }
  provSel.value = setupState.cfg?.provider || 'vertex';

  $('#provKey').placeholder = setupState.cfg?.key_present ? `Saved key: ${setupState.cfg.key_hint || ''} — leave blank to keep` : 'Paste the API key';
  $('#keyState').textContent = setupState.cfg?.key_present ? `saved (${setupState.cfg.source})` : 'none yet';

  provSel.addEventListener('change', () => loadModels(provSel.value, null));
  $('#provRefresh').addEventListener('click', () => loadModels(provSel.value, $('#modelSelect').value));
  $('#modelSelect').addEventListener('change', () => {
    const id = $('#modelSelect').value;
    $('#modelNote').textContent = setupState.models.find((m) => m.id === id)?.note || '';
    fillReasoning(id, $('#reasonSelect').value); // keep the user's level when still valid
  });
  $('#btnProvSave').addEventListener('click', saveSetup);

  await loadModels(provSel.value, provSel.value === setupState.cfg?.provider ? setupState.cfg?.model : null);
}

async function loadModels(providerId, preselect) {
  const modelSel = $('#modelSelect');
  const note = $('#modelNote');
  modelSel.innerHTML = '';
  note.textContent = 'Loading model catalogue…';
  const res = await api(`/api/ai/models?provider=${encodeURIComponent(providerId)}`);
  if (res?.status !== 0) { note.textContent = 'Could not load models.'; return; }
  setupState.models = res.data.models || [];
  const selectable = setupState.models;

  if (!selectable.length) {
    modelSel.appendChild(new Option('(no models — connect a provider first)', ''));
    modelSel.disabled = true;
    note.textContent = '';
    fillReasoning(null, 'off');
    return;
  }
  modelSel.disabled = false;
  for (const m of selectable) {
    const tags = [m.status !== 'active' ? m.status : null, m.cache ? 'cache' : null, m.thinking.length ? `thinking ${m.thinking.join('/')}` : 'no thinking ctl'].filter(Boolean);
    modelSel.appendChild(new Option(`${m.label} — ${tags.join(' · ')}`, m.id));
  }
  const wanted = selectable.some((m) => m.id === preselect) ? preselect
    : selectable.some((m) => m.id === res.data.default) ? res.data.default
    : selectable[0].id;
  modelSel.value = wanted;
  const m = selectable.find((x) => x.id === wanted);
  note.textContent = m?.note || '';
  fillReasoning(wanted, setupState.cfg && providerId === setupState.cfg.provider ? setupState.cfg.reasoning : 'low');
}

function fillReasoning(modelId, current) {
  const reasonSel = $('#reasonSelect');
  reasonSel.innerHTML = '';
  const m = setupState.models.find((x) => x.id === modelId);
  const levels = m?.thinking?.length ? ['off', ...m.thinking] : ['off'];
  for (const lvl of levels) {
    reasonSel.appendChild(new Option(lvl === 'off' ? 'off (no thinking)' : lvl, lvl));
  }
  reasonSel.disabled = levels.length === 1;
  reasonSel.value = levels.includes(current) ? current : 'low';
  // keep the chip honest about what this model can do
  if (m && m.thinking.length) reasonSel.title = `Sends generationConfig.thinkingConfig ${m.family === 'claude' ? 'thinkingBudget' : 'thinkingLevel'}`;
  else reasonSel.title = 'This engine manages reasoning on its own; Patarang sends no override.';
}

async function saveSetup() {
  if (setupState.busy) return;
  setupState.busy = true;
  const status = $('#provStatus');
  status.textContent = 'Saving & validating…';
  status.classList.remove('is-err', 'is-ok');
  const body = {
    provider: $('#provSelect').value,
    model: $('#modelSelect').value || undefined,
    reasoning: $('#reasonSelect').value,
    validate: true,
  };
  const keyVal = $('#provKey').value.trim();
  if (keyVal) body.apiKey = keyVal;
  try {
    const res = await api('/api/ai/config', { method: 'POST', body });
    if (res?.status !== 0) throw new Error(res?.message || 'save failed');
    setupState.cfg = res.data.config;
    $('#provKey').value = '';
    $('#provKey').placeholder = `Saved key: ${setupState.cfg.key_hint || ''} — leave blank to keep`;
    $('#keyState').textContent = `saved (${setupState.cfg.source})`;

    const v = res.data.validation;
    if (!v || v.ok) {
      status.textContent = `✓ ${setupState.cfg.provider} · ${setupState.cfg.model} · reasoning ${setupState.cfg.reasoning}`;
      status.classList.add('is-ok');
      state.provider = setupState.cfg.provider;
      $('#providerChip').textContent = setupState.cfg.provider + (setupState.cfg.model ? ` · ${setupState.cfg.model}` : '');
      updateProviderUi({ provider: setupState.cfg.provider, model: setupState.cfg.model, key_present: setupState.cfg.key_present });
      log(`Provider ready: ${setupState.cfg.provider} / ${setupState.cfg.model}`, 'ok');
    } else {
      status.textContent = `Saved, but live check failed: ${v.error || 'unknown error'}`;
      status.classList.add('is-err');
    }

    const cmp = $('#cacheNote');
    if (v?.engine === 'vertex') {
      cmp.hidden = false;
      cmp.textContent = 'Vertex: static system prompt enables implicit caching — cached tokens are reported per generate in the AI log.';
    } else cmp.hidden = true;
  } catch (e) {
    status.textContent = String(e.message || e);
    status.classList.add('is-err');
  } finally {
    setupState.busy = false;
  }
}

/* ─────────────────── P0a media slot + P0b provider badge ───────────────────
 * Badge states (docs/05, roast-closed): mock → blue ribbon; real provider
 * without key → amber "NO KEY"; key present → hidden. The ribbon is
 * aria-hidden decoration with pointer-events:none so drag hit-testing on the
 * canvas frame is never affected. It is NOT dismissable (state info, not an ad).
 */

const mediaState = { list: [], busy: false, draft: null };

/** Gate every AI entry point on a verified connection (no mock/offline path). */
function applyAiState() {
  const on = !!(state.aiConnected || agentState.enabled);
  const hint = 'AI not connected — add your API key in ⚙ Setup or enable ⛓ Connect for OpenCode MCP';
  for (const sel of ['#btnAiSend', '#btnGenerateEmpty']) {
    const b = $(sel);
    if (!b) continue;
    b.disabled = !on;
    if (on) b.removeAttribute('title'); else b.title = hint;
  }
  const p = $('#aiChatInput');
  if (p) {
    p.disabled = !on;
    p.placeholder = on
      ? (state.aiConnected ? 'Talk to Patarang — e.g. “make me 4 slides about our Series-A plan”' : '⛓ OpenCode MCP active — type here to queue or command OpenCode directly')
      : hint;
  }
  const br = $('#brief');
  if (br) {
    br.disabled = !on;
    if (!on) br.placeholder = hint;
  }
  document.body.classList.toggle('ai-off', !on);
}

function updateProviderUi(d) {
  if (!d) return;
  state.provider = d.provider;
  state.providerKeyPresent = !!d.key_present;
  state.aiConnected = !!(d.provider && (d.key_present || d.connected));
  const ribbon = $('#providerRibbon');
  if (!state.aiConnected && !agentState.enabled) {
    $('#providerChip').textContent = 'AI not connected';
    $('#providerChip').classList.add('chip--off');
    ribbon.className = 'ribbon ribbon--off';
    ribbon.textContent = "AI NOT CONNECTED — pick a provider in ⚙ Setup or enable ⛓ Connect for OpenCode MCP";
    ribbon.hidden = false;
    aiMsgOnce({ kind: 'err', title: 'AI not connected', text: 'Open ⚙ Setup to save an API key, or open ⛓ Connect to let OpenCode drive Patarang via MCP.' });
  } else if (!state.aiConnected && agentState.enabled) {
    $('#providerChip').textContent = '⛓ opencode MCP';
    $('#providerChip').classList.remove('chip--off');
    ribbon.hidden = true;
    ribbon.textContent = '';
  } else {
    $('#providerChip').textContent = d.provider + (d.model ? ` · ${d.model}` : '') + (agentState.enabled ? ' + ⛓ MCP' : '');
    $('#providerChip').classList.remove('chip--off');
    ribbon.hidden = true;
    ribbon.textContent = '';
  }
  applyAiState();
}

/** One-shot offline notice in the feed (re-armed when AI connects again). */
function aiMsgOnce(msg) {
  if (state.aiConnected) { aiFeedNotice = null; return; }
  if (aiFeedNotice) return;
  aiFeedNotice = aiMsg(msg);
}
let aiFeedNotice = null;

function refreshMediaPane() {
  const im = state.spec?.image || null;
  const box = $('#mediaCurrent');
  const thumb = $('#mediaThumb');
  if (mediaState.draft) {
    // an in-progress pick (just uploaded or clicked from the list) wins over
    // the saved spec state — refreshMediaPane must not clobber it
    $$('#mediaList .media-item').forEach((el) => el.classList.toggle('is-selected', el.dataset.path === mediaState.draft));
    return;
  }
  if (im) {
    box.hidden = false;
    thumb.src = im.url;
    thumb.dataset.url = im.url;
    $('#mediaAlt').value = im.alt || '';
    $('#mediaFit').value = im.fit || 'contain';
  } else {
    box.hidden = true;
    thumb.removeAttribute('src');
    delete thumb.dataset.url;
  }
  $$('#mediaList .media-item').forEach((el) => el.classList.toggle('is-selected', !!im && el.dataset.path === im.url));
}

async function refreshMediaList() {
  if (!state.deck) return;
  const res = await api(`/api/media/list?deck_id=${encodeURIComponent(state.deck.project_id)}`);
  mediaState.list = res?.status === 0 ? (res.data?.items || []) : [];
  const wrap = $('#mediaList');
  wrap.innerHTML = '';
  if (!mediaState.list.length) {
    const p = document.createElement('p');
    p.className = 'setup__hint';
    p.textContent = 'No images uploaded for this deck yet.';
    wrap.appendChild(p);
  }
  for (const it of mediaState.list) {
    const btn = document.createElement('button');
    btn.className = 'media-item';
    btn.type = 'button';
    btn.dataset.path = it.path;
    btn.title = `${it.name} · ${it.w && it.h ? it.w + '×' + it.h : ''} · ${Math.round(it.bytes / 1024)} KB`.trim();
    btn.innerHTML = `<img src="${it.path}" alt="" loading="lazy"><span>${it.w && it.h ? `${it.w}×${it.h}` : 'image'}</span>`;
    btn.addEventListener('click', () => selectMedia(it));
    wrap.appendChild(btn);
  }
  refreshMediaPane();
}

function selectMedia(it) {
  const box = $('#mediaCurrent');
  const thumb = $('#mediaThumb');
  mediaState.draft = it.path;
  box.hidden = false;
  thumb.src = it.path;
  thumb.dataset.url = it.path;
  $('#mediaAlt').value = it.alt || '';
  $('#mediaFit').value = it.fit || 'contain';
  $$('#mediaList .media-item').forEach((el) => el.classList.toggle('is-selected', el.dataset.path === it.path));
}

async function uploadMedia(files) {
  if (!state.deck) { toast('Generate or open a deck first', true); return; }
  const list = Array.from(files || []);
  if (!list.length) return;
  const fd = new FormData();
  fd.append('deck_id', state.deck.project_id);
  let skipped = 0;
  for (const f of list) {
    if (/\.(png|jpe?g|webp|gif|svg)$/i.test(f.name) || /^image\//i.test(f.type)) fd.append('files', f, f.name);
    else skipped++;
  }
  if (skipped) toast(`${skipped} file(s) skipped — png / jpg / webp / gif / svg only`, true);
  if (![...fd.getAll('files')].length) return;
  mediaState.busy = true;
  setBusy(true);
  try {
    const res = await fetch('/api/media/upload', { method: 'POST', body: fd });
    const r = await res.json().catch(() => null);
    if (r?.status !== 0) { toast(r?.message || 'Upload failed', true); return; }
    const paths = r.data?.paths || [];
    if (paths.length) log(`Uploaded ${paths.length} image${paths.length > 1 ? 's' : ''}`, 'ok');
    await refreshMediaList();
    if (paths[0]) selectMedia({ path: paths[0].path, alt: '', fit: 'contain' });
    switchTab('media');
  } finally {
    mediaState.busy = false;
    setBusy(false);
    $('#mediaFile').value = '';
  }
}

/** Image commit — same parse → render → save semantics as a geometry drag. */
async function commitSlideImage(image) {
  const page = state.pages[state.index];
  if (!page || !state.deck) { toast('Generate or open a deck first', true); return; }
  const beforeVersion = state.deck.version_number;
  const payloadUrl = image?.url || $('#mediaThumb')?.dataset.url;
  if (image && !payloadUrl) { toast('Pick an image first', true); return; }
  pushUndo(page);
  const body = {
    image: image
      ? { url: payloadUrl, alt: $('#mediaAlt').value.trim() || '', fit: $('#mediaFit').value || 'contain' }
      : null,
  };
  const res = await api(`/api/decks/${state.deck.project_id}/slides/${page.page_id}/image`, { method: 'POST', body });
  if (res?.status === 409) {
    undoStack.delete(page.page_id);
    toast('Deck changed elsewhere — reloading', true);
    loadDeck(state.deck.project_id);
    return;
  }
  if (res?.status !== 0) {
    undoStack.delete(page.page_id);
    log(res?.message || 'Image change failed', 'err');
    toast(res?.message || 'Image change failed', true);
    return;
  }
  state.dirty.delete(page.page_id); // the image route already saved this page
  page.content = res.data.content;
  state.deck.version_number = Math.max(state.deck.version_number ?? beforeVersion, res.data.version_number ?? 0);
  $('#versionChip').textContent = 'v' + state.deck.version_number;
  if (state.spec) state.spec = { ...state.spec, image: res.data.image };
  mediaState.draft = null; // committed — the saved spec image is now authoritative
  reloadCanvas();
  refreshMediaPane();
  toast(image ? 'Image applied — drag the box to reposition' : 'Image removed');
}

/* ───────────────────────────── wiring ───────────────────────────── */

function init() {
  $('#btnAiSend').addEventListener('click', () => sendChat());
  $('#aiChatInput').addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' && !e.shiftKey) || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      sendChat();
    }
  });
  $('#btnGenerateEmpty').addEventListener('click', () => {
    const brief = $('#brief')?.value.trim() || '';
    if (!brief) { toast('Write a brief first', true); $('#brief')?.focus(); return; }
    $('#aiChatInput').value = brief;
    sendChat();
  });

  $('#btnAiCancel')?.addEventListener('click', () => {
    aiUI.abort?.abort();
    aiStatus('idle', 'Cancelling…');
  });
  $('#btnAiCopy')?.addEventListener('click', async () => {
    const text = aiUI.history.join('\n').trim();
    if (!text) { toast('Nothing to copy yet', true); return; }
    try {
      await navigator.clipboard.writeText(text);
      toast('Conversation copied');
    } catch {
      toast('Clipboard blocked by the browser', true);
    }
  });
  $('#btnAiClear')?.addEventListener('click', () => {
    $('#aiLog')?.replaceChildren();
    aiUI.history = [];
    aiUI.live = null;
    aiStatus('idle', 'Ready', '');
    toast('Messages cleared');
  });
  $('#btnAddSlide').addEventListener('click', async () => {
    if (!state.deck) return;
    const res = await api(`/api/decks/${state.deck.project_id}/pages`, { method: 'POST', body: { title: 'New slide' } });
    if (res?.status === 0) loadDeck(state.deck.project_id);
  });
  $('#btnDeleteSlide').addEventListener('click', async () => {
    if (!state.deck || !state.pages[state.index]) return;
    const page = state.pages[state.index];
    await api(`/api/decks/${state.deck.project_id}/pages/${page.page_id}`, { method: 'DELETE' });
    loadDeck(state.deck.project_id);
  });
  $('#deckTitle').addEventListener('input', () => { if (state.deck) { state.deck.file_name = $('#deckTitle').value; saveSoon(); } });
  $('#btnShortcuts')?.addEventListener('click', () => { $('#shortcutsModal').hidden = false; });

  /* Narrow viewports: the inspector becomes an off-canvas sheet. */
  const setPanel = (open) => {
    document.body.classList.toggle('panel-open', open);
    $('#btnPanel')?.setAttribute('aria-expanded', String(open));
    $('#panel')?.setAttribute('aria-hidden', String(!open && window.matchMedia('(max-width:1180px)').matches));
  };
  $('#btnPanel')?.addEventListener('click', () => setPanel(!document.body.classList.contains('panel-open')));
  document.addEventListener('click', (e) => {
    if (!document.body.classList.contains('panel-open')) return;
    if (e.target.closest('#panel') || e.target.closest('#btnPanel')) return;
    setPanel(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('panel-open')) setPanel(false);
  });
  window.matchMedia('(max-width:1180px)').addEventListener('change', (m) => {
    if (!m.matches) setPanel(false);
    $('#panel')?.setAttribute('aria-hidden', String(false));
  });
  if (window.matchMedia('(max-width:1180px)').matches) setPanel(false);
$('#btnCloseShortcuts')?.addEventListener('click', () => { $('#shortcutsModal').hidden = true; });
document.querySelector('#shortcutsModal .modal__backdrop')?.addEventListener('click', () => { $('#shortcutsModal').hidden = true; });
document.addEventListener('keydown', (e) => { if (e.key === '?' && !isTypingField()) { e.preventDefault(); $('#shortcutsModal').hidden = !$('#shortcutsModal').hidden; } });
  $('#btnMediaUpload').addEventListener('click', (e) => { e.preventDefault(); $('#mediaFile').click(); });
  $('#mediaFile').addEventListener('change', (e) => { e.preventDefault(); uploadMedia(e.target.files); });
  $('#btnMediaApply').addEventListener('click', () => commitSlideImage(true));
  $('#btnMediaRemove').addEventListener('click', () => commitSlideImage(false));
  $('#btnUndo').addEventListener('click', applyUndo);
  $('#btnRedo').addEventListener('click', applyRedo);
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || isTypingField()) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); applyUndo(); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); applyRedo(); }
  });
  /* Forward arrows/Escape when the HOST (not the iframe) has focus so
   * keyboard nudge + Esc work from either focus context — bridge applies. */
  document.addEventListener('keydown', (e) => {
    if (isTypingField() || !state.selection) return;
    if (e.key === 'Escape') { toCanvas('element.select', { sfId: null }); return; }
    if (!e.key.startsWith('Arrow') && !(e.ctrlKey || e.metaKey)) return;
    if ((e.ctrlKey || e.metaKey) && (e.key === ']' || e.key === '[')) {
      e.preventDefault();
      toCanvas(e.key === ']' ? 'raiseZ' : 'lowerZ', {});
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
      e.preventDefault();
      toCanvas('duplicate', {});
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      toCanvas('element.delete', {});
      return;
    }
    const step = e.shiftKey ? 10 : 1;
    const map = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const pair = map[e.key];
    if (pair) { e.preventDefault(); toCanvas('nudge', { dx: pair[0], dy: pair[1] }); }
  });
  $$('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));
  $$('.mode').forEach((b) => b.addEventListener('click', () => {
    $$('.mode').forEach((x) => x.classList.remove('is-active'));
    b.classList.add('is-active');
    state.mode = b.dataset.mode;
    toCanvas('setMode', { mode: state.mode });
  }));
  const menu = $('#exportMenu');
  $('#btnExport').addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    $('#btnExport').setAttribute('aria-expanded', String(!menu.hidden));
  });
  $$('#exportMenu button').forEach((b) => b.addEventListener('click', () => {
    menu.hidden = true;
    exportDeck(b.dataset.format);
  }));
  document.addEventListener('click', () => { menu.hidden = true; });

  api('/api/provider').then((r) => {
    if (r?.status === 0) updateProviderUi(r.data);
  });
  startAgentSyncWatcher();
  $('#providerChip').style.cursor = 'pointer';
  $('#providerChip').addEventListener('click', () => switchTab('setup'));

  // AI-first home: start empty, let the user (or the AI) create the deck.
  const wantDeck = new URLSearchParams(location.search).get('deck');
  if (wantDeck) loadDeck(wantDeck); else showHome();
  document.querySelector('.brand')?.addEventListener('click', () => {
    history.replaceState(null, '', location.pathname);
    showHome();
  });
  setTimeout(fitCanvas, 60);
}

init();
