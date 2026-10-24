<div align="center">

# ⚡ SlideForge

### **The Open-Source AI Presentation Studio**
*A behaviour-parity, production-grade clone of GenSpark AI Slides running entirely on your own AI API keys.*

[![CI Status](https://github.com/souvik9434/slideforge/actions/workflows/ci.yml/badge.svg)](https://github.com/souvik9434/slideforge/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node Version](https://img.shields.io/badge/node-%3E%3D22.19-brightgreen.svg)](https://nodejs.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[Quickstart](#-quickstart) •
[Security & API Keys](#-api-key-safety--security) •
[Architecture](#-architecture) •
[Contributing](CONTRIBUTING.md) •
[Security Policy](SECURITY.md) •
[Changelog](CHANGELOG.md)

</div>

---

## 🌟 What is SlideForge?

SlideForge is a lightning-fast, local-first AI presentation studio. It empowers you to generate professional, multi-slide decks from a single prompt using state-of-the-art LLMs (**Google Gemini, Vertex AI, or OpenAI-compatible endpoints**), edit them in a live canvas studio, and export them into high-fidelity **vector PDFs** and **native PowerPoint (PPTX)** presentations.

### Key Highlights:
- 🎨 **Professional Archetypes**: Hero, Bento, Metric-Triple, Split-Compare, Bullets, Timeline, Quote, Table and more, with a live canvas editor (move, resize, restyle, undo/redo).
- 🔑 **Bring Your Own Key (BYOK)**: 100% local execution with your personal API key. Zero telemetry, zero cloud storage of sensitive data.
- 📄 **High-Fidelity Exports**: Vector-accurate PDF generation and editable **native** PPTX output.
- 🛡️ **Robust Test Suite**: automated tests covering schema validation, HTML sanitization, render round-trips, and API-key safety — with a secret scanner and CI hygiene job locking the guarantees in.

### Where SlideForge fits

| If you want to… | Use |
|---|---|
| Write Markdown yourself and present it (developer talks) | [Slidev](https://github.com/slidevjs/slidev) — excellent, and not us |
| Have **AI build the deck for you**, free, open-source, on your own key | **SlideForge** ✨ |
| Have AI build the deck for you behind a credit paywall | Gamma / GenSpark (proprietary) |

> SlideForge is not affiliated with or endorsed by Genspark; it is an independent, behavior-parity implementation.

---

## 🚀 Quickstart

### Prerequisites
- **Node.js** `>= 22.19`

### 1. Clone & Install
```bash
git clone https://github.com/souvik9434/slideforge.git
cd slideforge
npm install
```

### 2. Configure Your API Key
Launch the studio server:
```bash
npm start
```
Open **`http://127.0.0.1:4173`**, click **Setup (⚙)**, select your AI provider (Gemini, Vertex, or OpenAI-compatible), paste your API key, and press **Save & Validate**.

Alternatively, you can set local environment variables:
```bash
cp .env.example .env
# Edit .env with your SLIDEFORGE_API_KEY
```

### 3. Generate a Deck via CLI
```bash
node scripts/seed.js "The Future of Quantum Computing in 2026" --slides 8 --theme midnight
```

---

## 🔒 API Key Safety & Security

SlideForge prioritizes your privacy and security:
- **Local-First Storage**: Your API key is stored locally in `data/config.json` (git-ignored) on your machine.
- **Zero UI Key Echoing**: The backend server never transmits plaintext API keys back to the browser UI.
- **Sanitized Logging**: All request handlers and loggers sanitize output to prevent accidental key exposure.

Read our complete [Security Policy](SECURITY.md) for more details.

---

## 🧪 Running Tests

Verify your installation by running the test suite:
```bash
npm test
```

---

## 🤝 Contributing

We love community contributions! Please check out our [Contributing Guide](CONTRIBUTING.md) and [Code of Conduct](CODE_OF_CONDUCT.md) before submitting pull requests.

---

## 📄 License

Distributed under the **MIT License**. See [LICENSE](LICENSE) for more information.
