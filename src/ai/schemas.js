/**
 * ai/schemas.js — native JSON response contracts for the four pipeline steps.
 *
 * M-PROV "proper tools, A-to-Z": instead of asking for JSON in prose and
 * parsing with luck, every step sends a `responseSchema` (Vertex/Gemini
 * constrained decoding; json_schema for OpenAI-compatible). orchestrator.js
 * keeps its `extractJson` fallback for mock/legacy text responses.
 *
 * Plain JSON Schema (lowercase types); provider.js converts for Vertex.
 */

export const OUTLINE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    narrative: { type: 'string' },
    slides: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          title: { type: 'string' },
          archetype: { type: 'string' },
          purpose: { type: 'string' },
        },
        required: ['title', 'archetype'],
        propertyOrdering: ['index', 'title', 'archetype', 'purpose'],
      },
    },
  },
  required: ['title', 'slides'],
  propertyOrdering: ['title', 'narrative', 'slides'],
};

export const SLIDES_SCHEMA = {
  type: 'object',
  properties: {
    slides: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          archetype: { type: 'string' },
          title: { type: 'string' },
          kicker: { type: 'string' },
          subtitle: { type: 'string' },
          notes: { type: 'string' },
          content: {
            type: 'object',
            properties: {
              lead: { type: 'string' },
              points: { type: 'array', items: { type: 'string' } },
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { head: { type: 'string' }, text: { type: 'string' } },
                  propertyOrdering: ['head', 'text'],
                },
              },
              blocks: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    label: { type: 'string' },
                    value: { type: 'string' },
                    text: { type: 'string' },
                    tone: { type: 'string', enum: ['accent', 'accent2', 'muted', 'plain'] },
                  },
                  propertyOrdering: ['label', 'value', 'text', 'tone'],
                },
              },
              metrics: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    label: { type: 'string' },
                    value: { type: 'string' },
                    delta: { type: 'string' },
                    positive: { type: 'boolean' },
                  },
                  propertyOrdering: ['label', 'value', 'delta', 'positive'],
                },
              },
              left: {
                type: 'object',
                properties: { label: { type: 'string' }, head: { type: 'string' }, text: { type: 'string' }, points: { type: 'array', items: { type: 'string' } } },
                propertyOrdering: ['label', 'head', 'text', 'points'],
              },
              right: {
                type: 'object',
                properties: { label: { type: 'string' }, head: { type: 'string' }, text: { type: 'string' }, points: { type: 'array', items: { type: 'string' } } },
                propertyOrdering: ['label', 'head', 'text', 'points'],
              },
              steps: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { label: { type: 'string' }, head: { type: 'string' }, text: { type: 'string' } },
                  propertyOrdering: ['label', 'head', 'text'],
                },
              },
              events: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { when: { type: 'string' }, head: { type: 'string' }, text: { type: 'string' } },
                  propertyOrdering: ['when', 'head', 'text'],
                },
              },
              quote: { type: 'string' },
              attribution: { type: 'string' },
              chart: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['bar', 'line'] },
                  categories: { type: 'array', items: { type: 'string' } },
                  series: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        name: { type: 'string' },
                        values: { type: 'array', items: { type: 'number' } },
                      },
                      propertyOrdering: ['name', 'values'],
                    },
                  },
                },
                propertyOrdering: ['type', 'categories', 'series'],
              },
              image: { type: 'object', properties: { url: { type: 'string' }, alt: { type: 'string' } }, propertyOrdering: ['url', 'alt'] },
              text: { type: 'string' },
            },
          },
        },
        required: ['archetype', 'title', 'content'],
        propertyOrdering: ['archetype', 'title', 'kicker', 'subtitle', 'notes', 'content'],
      },
    },
  },
  required: ['slides'],
  propertyOrdering: ['slides'],
};

export const REWRITE_SCHEMA = {
  type: 'object',
  properties: {
    slot: { type: 'string' },
    value: { type: 'string' },
    reason: { type: 'string' },
  },
  required: ['value'],
  propertyOrdering: ['slot', 'value', 'reason'],
};

export const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          claim: { type: 'string' },
          verdict: { type: 'string', enum: ['plausible', 'needs_source', 'likely_false'] },
          confidence: { type: 'number' },
          note: { type: 'string' },
        },
        required: ['claim', 'verdict', 'confidence'],
        propertyOrdering: ['claim', 'verdict', 'confidence', 'note'],
      },
    },
  },
  required: ['results'],
  propertyOrdering: ['results'],
};

/* M-ACC (docs/06 Block 2): scoped verify — every item is page-mapped so notes
 * can be written INTO the right slide; links are TEXT-ONLY (never fetched). */
export const VERIFY2_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          page_index: { type: 'integer' },
          slot: { type: 'string' },
          item: { type: 'string' },
          verdict: { type: 'string', enum: ['plausible', 'needs_source', 'likely_false'] },
          confidence: { type: 'number' },
          note: { type: 'string' },
          links: { type: 'array', items: { type: 'string' } },
        },
        required: ['page_index', 'item', 'verdict', 'confidence'],
        propertyOrdering: ['page_index', 'slot', 'item', 'verdict', 'confidence', 'note', 'links'],
      },
    },
  },
  required: ['results'],
  propertyOrdering: ['results'],
};

export const SCHEMAS = {
  outline: OUTLINE_SCHEMA,
  slides: SLIDES_SCHEMA,
  rewrite: REWRITE_SCHEMA,
  verify: VERIFY_SCHEMA,
  verify2: VERIFY2_SCHEMA,
};

export function schemaForKind(kind) {
  return SCHEMAS[kind] || null;
}
