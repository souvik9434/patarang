/**
 * sanitize.js — allow-list HTML sanitiser.
 *
 * SlideForge renders HTML that was produced by an LLM. That is an XSS sink with
 * the user's own API key in the same origin, so EVERY write path passes through
 * here (invariant I2). Nothing unsanitised is written to disk, served or
 * exported.
 *
 * Implementation: a small tag-soup tokenizer + allow-list from html-vocab.js.
 * No external dependency, no regex-based HTML "cleaning" (roast C11).
 */

import {
  ALLOWED_TAGS, DROP_CONTENT_TAGS, GLOBAL_ATTRS, TAG_ATTRS,
  ALLOWED_STYLE_PROPS, FORBIDDEN_STYLE_VALUE, FORBIDDEN_URL_VALUE,
  CANONICAL_TAG, CANONICAL_ATTR,
} from './html-vocab.js';

const VOID_TAGS = new Set(['meta', 'br', 'hr', 'img', 'link', 'input', 'source', 'area', 'base', 'col', 'embed', 'param', 'track', 'wbr']);

const RAW_TEXT = new Set(['script', 'style']);

/** Parse a style attribute into a filtered declaration string. */
export function sanitizeStyle(value) {
  if (!value) return '';
  if (FORBIDDEN_STYLE_VALUE.test(value)) {
    // keep only declarations that individually survive
    const kept = value
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean)
      .filter((d) => {
        const idx = d.indexOf(':');
        if (idx === -1) return false;
        const prop = d.slice(0, idx).trim().toLowerCase();
        const val = d.slice(idx + 1);
        if (!ALLOWED_STYLE_PROPS.has(prop)) return false;
        if (FORBIDDEN_STYLE_VALUE.test(val)) return false;
        return true;
      });
    return kept.join('; ');
  }
  return value
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .filter((d) => {
      const idx = d.indexOf(':');
      if (idx === -1) return false;
      const prop = d.slice(0, idx).trim().toLowerCase();
      return ALLOWED_STYLE_PROPS.has(prop);
    })
    .join('; ');
}

export function sanitizeUrl(value) {
  if (value === null || value === undefined) return '';
  const v = String(value).trim();
  if (!v) return '';
  if (FORBIDDEN_URL_VALUE.test(v)) return '';
  if (/^(https?:|mailto:|data:image\/|#|\/|\.\/|\.\.\/)/i.test(v)) return v;
  return '';
}

function sanitizeAttrs(tag, rawAttrs) {
  const out = [];
  const seen = new Set();
  for (const { name, value } of rawAttrs) {
    const rawAttr = name.toLowerCase();
    const attr = CANONICAL_ATTR[rawAttr] || rawAttr;
    if (seen.has(attr)) continue;
    seen.add(attr);
    if (rawAttr.startsWith('on')) continue;
    const allowed = GLOBAL_ATTRS.has(attr) || (TAG_ATTRS[tag]?.has(attr) ?? false);
    if (!allowed) continue;
    let v = value ?? '';
    if (attr === 'style') {
      v = sanitizeStyle(v);
      if (!v) continue;
      out.push(`${attr}="${escapeAttr(v)}"`);
      continue;
    }
    if (['href', 'src', 'xlink:href'].includes(attr)) {
      v = sanitizeUrl(v);
      if (!v) continue;
    }
    if (attr === 'id' || attr.startsWith('data-')) {
      out.push(`${attr}="${escapeAttr(v)}"`);
      continue;
    }
    out.push(`${attr}="${escapeAttr(v)}"`);
  }
  return out.join(' ');
}

export function escapeAttr(v) {
  return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeText(v) {
  return String(v).replace(/&(?!(?:amp|lt|gt|quot|#\d+|#x[0-9a-fA-F]+);)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Sanitise an HTML fragment/document.
 * @param {string} html
 * @param {{keepStyle?:boolean, allowScript?:boolean}} opts
 */
export function sanitize(html, opts = {}) {
  const keepStyle = opts.keepStyle !== false;
  const allowScript = opts.allowScript === true;
  const src = String(html || '');

  let out = '';
  let i = 0;
  const openStack = [];
  let skipUntilClose = null;

  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) {
      if (!skipUntilClose) out += escapeText(src.slice(i));
      break;
    }
    if (lt > i && !skipUntilClose) out += escapeText(src.slice(i, lt));

    // comment
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      i = end === -1 ? src.length : end + 3;
      continue;
    }
    // doctype
    if (src.startsWith('<!', lt)) {
      const end = src.indexOf('>', lt);
      i = end === -1 ? src.length : end + 1;
      continue;
    }
    // closing tag
    if (src.startsWith('</', lt)) {
      const end = src.indexOf('>', lt);
      if (end === -1) { i = src.length; break; }
      const rawClose = src.slice(lt + 2, end).trim().toLowerCase().split(/[\s/]/)[0];
      const name = CANONICAL_TAG[rawClose] || rawClose;
      if (skipUntilClose) {
        if (name === skipUntilClose) skipUntilClose = null;
        i = end + 1;
        continue;
      }
      const idx = openStack.lastIndexOf(name);
      if (idx !== -1) {
        for (let k = openStack.length - 1; k >= idx; k--) out += `</${openStack[k]}>`;
        openStack.length = idx;
      }
      i = end + 1;
      continue;
    }
    // opening tag
    const end = findTagEnd(src, lt);
    if (end === -1) {
      if (!skipUntilClose) out += escapeText(src.slice(lt));
      break;
    }
    const inner = src.slice(lt + 1, end);
    const selfClosing = inner.endsWith('/');
    const body = selfClosing ? inner.slice(0, -1) : inner;
    const m = /^([a-zA-Z][a-zA-Z0-9:-]*)/.exec(body);
    if (!m) {
      if (!skipUntilClose) out += escapeText(src.slice(lt, end + 1));
      i = end + 1;
      continue;
    }
    const rawTag = m[1].toLowerCase();
    const tag = CANONICAL_TAG[rawTag] || rawTag;
    const attrsRaw = parseAttrs(body.slice(m[1].length));

    if (skipUntilClose) {
      if (tag === skipUntilClose && !selfClosing && !VOID_TAGS.has(tag)) skipUntilClose = null;
      i = end + 1;
      continue;
    }

    if (RAW_TEXT.has(tag)) {
      if (tag === 'script' && !allowScript) {
        // drop entirely, including content
        if (!selfClosing) skipUntilClose = 'script';
        i = end + 1;
        continue;
      }
      if (tag === 'style' && !keepStyle) {
        if (!selfClosing) skipUntilClose = 'style';
        i = end + 1;
        continue;
      }
      // keep raw-text element; content handled below
      const closeIdx = src.toLowerCase().indexOf(`</${tag}`, end + 1);
      const contentEnd = closeIdx === -1 ? src.length : closeIdx;
      let content = src.slice(end + 1, contentEnd);
      if (tag === 'style') content = sanitizeCss(content);
      const attrStr = sanitizeAttrs(tag, attrsRaw);
      out += `<${tag}${attrStr ? ' ' + attrStr : ''}>${content}</${tag}>`;
      i = closeIdx === -1 ? src.length : src.indexOf('>', closeIdx) + 1;
      continue;
    }

    if (!ALLOWED_TAGS.has(tag)) {
      // unwrap: drop the tag, keep its children
      i = end + 1;
      continue;
    }

    const attrStr = sanitizeAttrs(tag, attrsRaw);
    if (VOID_TAGS.has(tag)) {
      out += `<${tag}${attrStr ? ' ' + attrStr : ''}>`;
    } else if (selfClosing) {
      out += `<${tag}${attrStr ? ' ' + attrStr : ''}></${tag}>`;
    } else {
      out += `<${tag}${attrStr ? ' ' + attrStr : ''}>`;
      openStack.push(tag);
    }
    i = end + 1;
  }

  for (let k = openStack.length - 1; k >= 0; k--) out += `</${openStack[k]}>`;
  return out;
}

/** Strip dangerous constructs from a CSS block. */
export function sanitizeCss(css) {
  return String(css || '')
    .replace(/@import[^;]*;?/gi, '')
    .replace(/url\s*\([^)]*\)/gi, 'none')
    .replace(/expression\s*\([^)]*\)/gi, '')
    .replace(/javascript:/gi, '');
}

function findTagEnd(src, start) {
  let quote = null;
  for (let i = start + 1; i < src.length; i++) {
    const ch = src[i];
    if (quote) { if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '>') return i;
  }
  return -1;
}

function parseAttrs(str) {
  const out = [];
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/g;
  let m;
  while ((m = re.exec(str))) {
    const name = m[1];
    const value = m[3] ?? m[4] ?? m[5] ?? '';
    out.push({ name, value });
  }
  return out;
}

/** Convenience: is this string free of script-ish content? (used by tests) */
export function hasScriptish(html) {
  return /<\s*script|\son[a-z]+\s*=|javascript:|<\s*iframe|<\s*object|<\s*embed/i.test(String(html || ''));
}
