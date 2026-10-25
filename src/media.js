/**
 * media.js — image upload + serving (P0a, docs/05 closed spec).
 *
 * Client-supplied data is never trusted:
 *   - filenames are IGNORED; the server generates `media-<ts>-<6rand>` names
 *     (GenSpark's `assets/image/<name>-<ts>-<6rand>.<ext>` scheme, docs/04 §L11)
 *   - type detection is by MAGIC BYTES, not extension
 *   - inline SVG content with <script> is rejected outright
 *   - everything is served from /media/ under strict no-script headers, and the
 *     only consumer inside a slide is <img> (no object/embed/iframe)
 */

import { createReadStream, existsSync, statSync, mkdirSync, readdirSync, unlinkSync, rmdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { ROOT as DATA_ROOT } from './store.js';

export const MEDIA_DIR = path.join(DATA_ROOT, 'media');

const MAX_UPLOAD = Number(process.env.PATARANG_MAX_UPLOAD || 20 * 1024 * 1024);
/** Slack above the per-file cap for the multipart envelope itself. */
const ENVELOPE_SLACK = 1024 * 1024;

export function ensureDeckMediaDir(deckId) {
  const dir = path.join(MEDIA_DIR, deckId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function removeDeckMediaDir(deckId) {
  const dir = path.join(MEDIA_DIR, deckId);
  if (!dir.startsWith(MEDIA_DIR)) return false;
  if (!existsSync(dir)) return false;
  for (const f of readdirSync(dir)) {
    try { unlinkSync(path.join(dir, f)); } catch { /* best effort */ }
  }
  try { rmdirSync(dir); } catch { /* best effort */ }
  return !existsSync(dir);
}

/* ------------------------------- probing ------------------------------- */

/** Magic-byte sniff → { ext, mime } or null when unknown. */
export function sniff(buf) {
  if (!buf || buf.length < 12) return null;
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { ext: 'png', mime: 'image/png' };
  // JPEG (FF D8 FF)
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  // GIF87a / GIF89a
  if (buf.slice(0, 4).toString('latin1') === 'GIF8') return { ext: 'gif', mime: 'image/gif' };
  // RIFF....WEBP
  if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  // SVG (text XML starting with <?xml or <svg)
  const head = buf.slice(0, 256).toString('utf8').replace(/^\uFEFF/, '').trimStart().toLowerCase();
  if (head.startsWith('<?xml') || head.startsWith('<svg')) {
    if (/<script[\s>]/i.test(buf.toString('latin1')) || /\son\w+\s*=/i.test(head) || /xlink:href\s*=\s*["']\s*https?:/i.test(head)) return null;
    return { ext: 'svg', mime: 'image/svg+xml' };
  }
  return null;
}

/**
 * Intrinsic pixel size. `detail` = number of leading bytes examined
 * (JPEG SOF markers can sit behind EXIF blocks, so JPEG gets a bigger look).
 * Returns { w, h } with zeros when undeterminable (renderer falls back to CSS).
 */
export function probeSize(buf, ext) {
  try {
    if (ext === 'png' && buf.length >= 24) {
      return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    }
    if (ext === 'gif' && buf.length >= 10) {
      return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
    }
    if (ext === 'jpg') {
      let off = 2;
      const end = Math.min(buf.length, 1024 * 1024);
      while (off + 9 < end) {
        if (buf[off] !== 0xff) { off++; continue; }
        const marker = buf[off + 1];
        if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9) || marker === 0x01 || marker === 0xff) { off += 2; continue; }
        const len = buf.readUInt16BE(off + 2);
        if ((marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { h: buf.readUInt16BE(off + 5), w: buf.readUInt16BE(off + 7) };
        }
        off += 2 + len;
      }
      return { w: 0, h: 0 };
    }
    if (ext === 'webp') {
      const fourcc = buf.slice(12, 16).toString('latin1');
      if (fourcc === 'VP8 ' && buf.length >= 30) {
        return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
      }
      if (fourcc === 'VP8L' && buf.length >= 25) {
        const b = buf.readUInt32LE(21);
        return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 };
      }
      if (fourcc === 'VP8X' && buf.length >= 30) {
        return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
      }
      return { w: 0, h: 0 };
    }
    if (ext === 'svg') {
      const head = buf.toString('utf8', 0, Math.min(buf.length, 4096));
      const vb = head.match(/viewBox\s*=\s*["']\s*[\d.eE+-]+[\s,]+[\d.eE+-]+[\s,]+([\d.eE+-]+)[\s,]+([\d.eE+-]+)/i);
      if (vb) return { w: Math.round(Number(vb[1])), h: Math.round(Number(vb[2])) };
      const wh = head.match(/<svg[^>]*\swidth\s*=\s*["']\s*([\d.]+)/i) && head.match(/<svg[^>]*\sheight\s*=\s*["']\s*([\d.]+)/i);
      if (wh) return { w: Math.round(Number(wh[1])), h: Math.round(Number(wh[2])) };
      return { w: 0, h: 0 };
    }
  } catch { /* fall through */ }
  return { w: 0, h: 0 };
}

/* ------------------------------ multipart ------------------------------ */

/**
 * Minimal, strict multipart/form-data parser.
 * Returns array of { name, filename?, data } buffers.
 * Throws with `.code = 'PAYLOAD_TOO_LARGE'` when the body exceeds the cap.
 */
export async function readMultipart(req) {
  const ctype = String(req.headers['content-type'] || '');
  const bMatch = ctype.match(/multipart\/form-data\s*;.*?boundary\s*=\s*(?:"([^"]+)"|([A-Za-z0-9'()+_,.:=\- ]+))/i);
  if (!bMatch) { const e = new Error('expected multipart/form-data'); e.code = 'BAD_CONTENT_TYPE'; throw e; }
  const boundary = (bMatch[1] || bMatch[2]).trim();

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_UPLOAD + ENVELOPE_SLACK) {
      const e = new Error(`upload exceeds ${MAX_UPLOAD} bytes`); e.code = 'PAYLOAD_TOO_LARGE'; throw e;
    }
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks);
  return parseMultipartBuffer(body, boundary);
}

export function parseMultipartBuffer(body, boundary) {
  const delim = Buffer.from(`--${boundary}`);
  const parts = [];
  let i = body.indexOf(delim);
  if (i === -1) return parts;
  i += delim.length;
  for (;;) {
    if (body.slice(i, i + 2).toString('latin1') === '--') break; // final delimiter
    if (body[i] === 0x0d && body[i + 1] === 0x0a) i += 2;
    const headEnd = body.indexOf('\r\n\r\n', i);
    if (headEnd === -1) break;
    const headerBlock = body.toString('utf8', i, headEnd);
    const next = body.indexOf(delim, headEnd + 4);
    if (next === -1) break;
    const dataEnd = next - 2; // strip the CRLF that precedes the delimiter
    const km = headerBlock.match(/name\s*=\s*"([^"]*)"/i);
    const fm = headerBlock.match(/filename\s*=\s*"([^"]*)"/i);
    parts.push({ name: km ? km[1] : '', filename: fm ? fm[1] : undefined, data: body.slice(headEnd + 4, dataEnd) });
    i = next + delim.length;
  }
  return parts;
}

/* ------------------------------- lists / names ------------------------------- */

const NAME_RE = /^media-\d+-[a-z0-9]{6}\.([a-z0-9]+)$/;

export function generatedName(ext) {
  return `media-${Date.now()}-${randomBytes(4).toString('hex').slice(0, 6)}.${ext}`;
}

export function safeDeckId(id) {
  return /^[\w-]{1,64}$/.test(String(id || '')) ? String(id) : null;
}

export function safeFileName(name) {
  if (!NAME_RE.test(String(name || '')) || String(name).includes('..')) return null;
  return String(name);
}

/**
 * List one deck's media. Dims are probed from the same magic bytes at scan
 * time, so /api/media/list never needs a probe round-trip client-side.
 */
export function listDeckMedia(deckId) {
  if (!safeDeckId(deckId)) return null;
  const dir = path.join(MEDIA_DIR, deckId);
  if (!existsSync(dir)) return { items: [] };
  const items = [];
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    let st;
    try { st = statSync(file); } catch { continue; }
    if (!st.isFile()) continue;
    const buf = readFileSync(file);
    const kind = sniff(buf);
    const { w, h } = kind ? probeSize(buf, kind.ext) : { w: 0, h: 0 };
    items.push({ path: `/media/${deckId}/${name}`, name, bytes: st.size, mime: kind ? kind.mime : 'application/octet-stream', w, h });
  }
  items.sort((a, b) => a.name.localeCompare(b.name));
  return { items };
}

/** Checked stream response for GET /media/<deck>/<file>. Caller renders 404/403 on false. */
export function mediaFileStream(res, deckId, fileName) {
  if (!safeDeckId(deckId) || !safeFileName(fileName)) return null;
  const file = path.join(MEDIA_DIR, deckId, fileName);
  if (!file.startsWith(MEDIA_DIR) || !existsSync(file) || !statSync(file).isFile()) return null;
  const buf = readFileSync(file);
  const kind = sniff(buf) || { mime: 'application/octet-stream' };
  res.writeHead(200, {
    'Content-Type': kind.mime,
    'Content-Length': st_size(file),
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Content-Disposition': `inline; filename="${fileName}"`,
    'X-Frame-Options': 'DENY',
  });
  createReadStream(file).pipe(res);
  return { mime: kind.mime };
}

function st_size(file) { return statSync(file).size; }

export const LIMITS = { MAX_UPLOAD, ENVELOPE_SLACK };
