# SlideForge Architecture & System Design

> **Document Version**: 1.0.0  
> **Target Audience**: Contributors, Core Maintainers, and Advanced Users  

---

## 1. High-Level Overview

SlideForge is a zero-framework, lightning-fast Node.js application (`>=22.19`) that pairs a zero-dependency backend server with an immersive frontend studio canvas. It mimics GenSpark AI Slides with 100% behavior parity while running entirely locally on the user's own AI API keys.

```
┌────────────────────────────────────────────────────────┐
│                      Browser UI                        │
│  (Canvas, Rail Thumbnails, Setup Modal, AI Prompting)  │
└──────────────────────────┬─────────────────────────────┘
                           │ HTTP / JSON / SSE
                           ▼
┌────────────────────────────────────────────────────────┐
│                    Node.js Server                      │
│                  (src/server.js, src/api.js)           │
├───────────────────┬───────────────────┬────────────────┤
│   AI Orchestrator │   Render Engine   │  Export Engine │
│  (src/ai/*)       │  (src/render/*)   │  (src/export/*)│
└───────────────────┴───────────────────┴────────────────┘
                           │
                           ▼
             Local Storage (`data/decks/`)
             Local Config (`data/config.json`)
```

---

## 2. Core Modules

### A. AI Orchestrator (`src/ai/`)
- **`provider.js`**: Unified model adapter supporting **Mock** (offline tests), **Gemini** (Google AI Studio REST API), **Vertex AI** (Express Mode with `x-goog-api-key`), and **OpenAI-compatible** endpoints (OpenAI, OpenRouter, LM Studio).
- **`config-store.js`**: Manages local configuration (`data/config.json`). Enforces that API keys are stored exclusively on disk, never logged, and masked when transmitted to the UI (`maskKey`).
- **`orchestrator.js`**: Drives the 4-step generation pipeline (Outline → Slides → Render → Verify).

### B. Render & Layout Engine (`src/render/`)
- **`layouts.js`**: Implements 10 professional presentation archetypes (Hero, Bento, Metric-Triple, Split-Compare, Bullets, Timeline, Quote, Table, Grid, CTA).
- **`slide-html.js`**: Assembles semantic, styled HTML markup for each slide at 1280×720 resolution.
- **`parse.js`**: Parses authored HTML back into structured specs, preserving user layout adjustments and custom geometry across edits.
- **`sanitize.js`**: Robust HTML sanitizer enforcing the project's shared vocabulary, blocking XSS, inline script tags, and malicious URI schemes while preserving safe styles and SVG filters.

### C. Deck Store (`src/store.js`)
- Manages deck persistence, version history, etags for optimistic concurrency control (returning `409 Conflict` on stale saves), and page reordering/deletion.

### D. Export Engine (`src/export/`)
- Headless Playwright integration for high-fidelity vector PDF generation, 2× PNG rasters, and native OOXML PowerPoint (`pptxgenjs`) exports.

---

## 3. Data Flow & Security Boundaries

1. **User Request**: The user initiates deck generation or editing in the web UI.
2. **Local Key Retrieval**: The server reads the API key securely from `data/config.json` (or environment variables).
3. **Direct Provider Call**: The backend communicates directly with the AI provider endpoint. No intermediary cloud service or proxy accesses the user's key or data.
4. **Local Persistence**: Decks and states are written to local JSON files under `data/`.
