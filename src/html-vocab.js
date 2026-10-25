/**
 * html-vocab.js — the SINGLE source of truth for which HTML tags / attributes /
 * style properties Patarang is allowed to emit and to accept.
 *
 * Consumed by BOTH:
 *   - src/render/layouts.js  (renderer may only emit vocabulary-allowed markup)
 *   - src/sanitize.js        (sanitiser may only preserve vocabulary-allowed markup)
 *
 * Keeping one module for both is deliberate: it makes drift between "what we
 * render" and "what we allow" structurally impossible (see 02-ROAST-CODE.md X2).
 */

export const ALLOWED_TAGS = new Set([
  'html', 'head', 'body', 'title',
  'div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li',
  'strong', 'em', 'b', 'i', 'br', 'hr', 'blockquote', 'figure', 'figcaption',
  'code', 'pre', 'kbd', 'mark', 'small', 'sub', 'sup',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption',
  'img', 'figure',
  'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'defs', 'linearGradient', 'radialGradient', 'stop', 'clipPath',
  'use', 'symbol', 'filter', 'feDropShadow', 'feGaussianBlur', 'feOffset', 'feMerge', 'feMergeNode',
  'marker', 'pattern', 'mask',
]);

/** Tags whose entire content is dropped (script/style are handled separately). */
export const DROP_CONTENT_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'template', 'noscript']);

/** Global attributes allowed on any allowed element. */
export const GLOBAL_ATTRS = new Set(['class', 'id', 'data-sf-id', 'data-sf-role', 'data-sf-slot', 'style', 'title', 'role', 'aria-label', 'aria-hidden', 'lang', 'dir']);

export const CANONICAL_TAG = {
  lineargradient: 'linearGradient',
  radialgradient: 'radialGradient',
  clippath: 'clipPath',
  fedropshadow: 'feDropShadow',
  fegaussianblur: 'feGaussianBlur',
  feoffset: 'feOffset',
  femerge: 'feMerge',
  femergenode: 'feMergeNode',
};

export const CANONICAL_ATTR = {
  viewbox: 'viewBox',
  preserveaspectratio: 'preserveAspectRatio',
  gradientunits: 'gradientUnits',
  gradienttransform: 'gradientTransform',
  stddeviation: 'stdDeviation',
  markerwidth: 'markerWidth',
  markerheight: 'markerHeight',
  refx: 'refX',
  refy: 'refY',
  markerunits: 'markerUnits',
  patternunits: 'patternUnits',
};

/** Per-tag extra attributes. */
export const TAG_ATTRS = {
  a: new Set(['href', 'target', 'rel']),
  img: new Set(['src', 'alt', 'width', 'height', 'loading', 'decoding']),
  svg: new Set(['viewBox', 'width', 'height', 'fill', 'stroke', 'stroke-width', 'xmlns', 'preserveAspectRatio']),
  path: new Set(['d', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'fill-rule', 'opacity', 'fill-opacity', 'stroke-opacity', 'transform', 'filter', 'marker-end', 'marker-start']),
  rect: new Set(['x', 'y', 'width', 'height', 'rx', 'ry', 'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity', 'fill-opacity', 'stroke-opacity', 'transform', 'filter']),
  circle: new Set(['cx', 'cy', 'r', 'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity', 'fill-opacity', 'stroke-opacity', 'transform', 'filter']),
  ellipse: new Set(['cx', 'cy', 'rx', 'ry', 'fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity', 'transform', 'filter']),
  line: new Set(['x1', 'y1', 'x2', 'y2', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-dasharray', 'opacity', 'stroke-opacity', 'filter', 'marker-end', 'marker-start']),
  polyline: new Set(['points', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'filter', 'marker-end', 'marker-start']),
  polygon: new Set(['points', 'fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'filter']),
  text: new Set(['x', 'y', 'fill', 'font-size', 'font-weight', 'font-family', 'text-anchor', 'dominant-baseline', 'opacity', 'letter-spacing', 'transform', 'filter']),
  tspan: new Set(['x', 'dy', 'fill', 'font-size', 'font-weight', 'font-family', 'text-anchor', 'opacity']),
  g: new Set(['fill', 'stroke', 'stroke-width', 'opacity', 'transform', 'clip-path', 'filter']),
  defs: new Set([]),
  linearGradient: new Set(['id', 'x1', 'y1', 'x2', 'y2', 'gradientUnits', 'gradientTransform']),
  radialGradient: new Set(['id', 'cx', 'cy', 'r', 'fx', 'fy', 'gradientUnits', 'gradientTransform']),
  stop: new Set(['offset', 'stop-color', 'stop-opacity']),
  clipPath: new Set(['id']),
  filter: new Set(['id', 'x', 'y', 'width', 'height']),
  feDropShadow: new Set(['dx', 'dy', 'stdDeviation', 'flood-color', 'flood-opacity']),
  feGaussianBlur: new Set(['in', 'stdDeviation', 'result']),
  feOffset: new Set(['in', 'dx', 'dy', 'result']),
  feMerge: new Set([]),
  feMergeNode: new Set(['in']),
  marker: new Set(['id', 'viewBox', 'refX', 'refY', 'markerWidth', 'markerHeight', 'orient', 'markerUnits']),
  pattern: new Set(['id', 'width', 'height', 'patternUnits']),
  mask: new Set(['id']),
  use: new Set(['href', 'x', 'y', 'width', 'height']),
  symbol: new Set(['id', 'viewBox']),
  td: new Set(['colspan', 'rowspan']),
  th: new Set(['colspan', 'rowspan', 'scope']),
  meta: new Set(['charset', 'name', 'content']),
  title: new Set([]),
  script: new Set(['type', 'id']),
  style: new Set(['type']),
  html: new Set(['lang']),
  body: new Set([]),
  head: new Set([]),
  ol: new Set(['start', 'type']),
  li: new Set(['value']),
  time: new Set(['datetime']),
};

/**
 * Style properties allowed inside an inline `style` attribute.
 * Deliberately excludes anything that can load or execute anything:
 * `background-image` (url()), `behavior`, `binding`, `-moz-binding`.
 */
export const ALLOWED_STYLE_PROPS = new Set([
  'display', 'position', 'top', 'right', 'bottom', 'left', 'width', 'height', 'min-width', 'min-height',
  'max-width', 'max-height', 'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'gap', 'row-gap', 'column-gap', 'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row',
  'grid-area', 'place-items', 'align-items', 'align-self', 'justify-content', 'justify-items', 'justify-self',
  'flex-direction', 'flex-wrap', 'flex', 'flex-grow', 'flex-shrink', 'flex-basis', 'order',
  'color', 'background', 'background-color', 'background-blend-mode', 'opacity',
  'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-transform',
  'text-align', 'text-decoration', 'text-overflow', 'white-space', 'word-break', 'word-wrap', 'vertical-align',
  'border', 'border-width', 'border-style', 'border-color', 'border-radius', 'border-top', 'border-right',
  'border-bottom', 'border-left', 'box-shadow', 'outline', 'outline-offset',
  'overflow', 'overflow-x', 'overflow-y', 'object-fit', 'object-position',
  'transform', 'transform-origin', 'transition', 'animation', 'filter', 'backdrop-filter', '-webkit-backdrop-filter', 'mix-blend-mode',
  'text-shadow', 'background-clip', '-webkit-background-clip', '-webkit-text-fill-color', 'clip-path', 'column-count', 'column-gap',
  'list-style', 'list-style-type', 'z-index', 'inset', 'aspect-ratio', 'table-layout', 'visibility', 'cursor',
]);

/** URL-bearing style values are forbidden outright. */
export const FORBIDDEN_STYLE_VALUE = /(url\s*\(|expression\s*\(|javascript:|data:text\/html|@import|binding)/i;

/** Attribute values that must never be trusted. */
export const FORBIDDEN_URL_VALUE = /(javascript:|data:text\/html|vbscript:)/i;

export const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'data:image/', 'mailto:', '#', '/', './', '../']);

export function attrAllowed(tag, attr) {
  const raw = attr.toLowerCase();
  if (raw.startsWith('on')) return false;
  const a = CANONICAL_ATTR[raw] || raw;
  const t = CANONICAL_TAG[tag.toLowerCase()] || tag.toLowerCase();
  if (GLOBAL_ATTRS.has(a)) return true;
  const set = TAG_ATTRS[t];
  return !!set && set.has(a);
}
