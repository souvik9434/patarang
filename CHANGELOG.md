# Changelog

All notable changes to Patarang are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-10-24

First public release.

### Added
- AI deck generation from a single brief via **Gemini**, **Vertex AI**, or **OpenAI-compatible** endpoints (Bring Your Own Key; keys stored locally only, masked in the UI).
- 12 slide archetypes (`hero`, `bento`, `metric-triple`, `split-compare`, `bullets`, `roadmap`, `timeline`, `quote`, `chart`, `image-text`, `table`, custom presets) with live canvas editing: move/resize/rotate, undo/redo, per-element style edits.
- Exports: **vector PDF**, **native editable PPTX**, PNG at 2×.
- Local-first storage: decks in `data/` (git-ignored) — zero telemetry, zero cloud storage of user content.
- Test suite covering schema validation, HTML sanitisation, render round-trips, store concurrency (409 on stale save), key masking/leak-freedom, and the repo secret scanner.
