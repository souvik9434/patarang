# Contributing to SlideForge

Thank you for helping build the open-source AI presentation studio. ❤️

First off: fixes and small improvements are always welcome. The rules below exist to keep the codebase healthy and to make sure nothing enters it that could hurt you — SlideForge ships with a hard promise of **local-first API-key safety**, and we defend it in review.

Before you start, make sure you've read the [Code of Conduct](CODE_OF_CONDUCT.md). By participating you agree to it.

---

## What we're most likely to accept

- **Bug fixes** (with a reproduction)
- **Documentation improvements**
- **Environment-specific fixes** (Windows/Linux/macOS quirks, Node versions)
- **Performance improvements**
- **Provider adapter polish** (Gemini / Vertex / OpenAI-compatible edge cases)
- New features that were discussed and approved first (see below)

Large additions — new UI systems, archetypes, export engines, anything touching

- `src/ai/config-store.js` (API-key storage & masking),
- `src/sanitize.js` / `src/html-vocab.js` (HTML/SVG allow-list),
- `src/agents-store.js` (agent access tokens),

…require a **design discussion before implementation**. Open a Feature Request issue describing the problem and your proposed approach, and wait for a maintainer's approval before writing the PR. Changes in the three sensitive files above always need maintainer review, because they carry the key-safety guarantee.

Label routing: look for [`good first issue`](../../issues?q=is%3Aissue%20is%3Aopen%20label%3A%22good%20first%20issue%22) and [`help wanted`](../../issues?q=is%3Aissue%20is%3Aopen%20label%3A%22help%20wanted%22) to find work. Want an issue? Comment and a maintainer may assign it unless someone is already on it.

> [!NOTE]
> PRs that skip the process below will likely be closed without review — not out of unfriendliness, but because a solo-maintainer project must keep review volume honest.

---

## The contribution workflow

### 1. Issues first
- **Bugs**: use the Bug Report template. Search existing issues first; blank issues are not accepted.
- **Features**: use the Feature Request template. New functionality starts as an issue (the design review happens there, before code exists).

### 2. Set up your environment
```bash
git clone https://github.com/souvik9434/slideforge.git
cd slideforge
npm install
npm start   # http://127.0.0.1:4173 — Setup (⚙) → paste YOUR key → Save & Validate
npm test
```

### 3. Branch & implement
```bash
git checkout -b fix/restore-scroll-position   # or feat/…, docs/…, perf/…
```
Keep PRs **small and focused** — one bug or one feature at a time.

### 4. Commit titles: conventional commits
`type(scope): summary` with `feat` · `fix` · `docs` · `chore` · `refactor` · `perf` · `test`.

```
fix(export): restore slide 3 table borders in native PPTX
docs(repo): document the vertex cache env var
```

### 5. Test before you push
```bash
npm test
```
Add tests for new behavior. Core modules (`schema`, `render`, `store`, `export`, `ai`) must stay green — CI runs the full suite on every PR and it is a **required check**.

### 6. Pull request
- Base on `main`, complete the PR template, and write the description in your own words — short beats long.
- **Bug fixes, chores, and tests must link an existing issue** (`Fixes #123`).
- UI changes: include before/after screenshots (or a short clip).
- Logic changes: explain how a reviewer can verify the fix themselves.

---

## API-key safety rules (non-negotiable)

SlideForge's promise is that user keys stay on the user's machine. In any PR:

- **Never** write a key into code, tests, docs, or fixtures — use obvious fake strings (`paste-your-api-key-here`).
- **Never** return a full key from an endpoint — go through `maskKey()` / `publicConfig()` (`src/ai/config-store.js`).
- **Never** log key material, `Authorization`/`x-goog-api-key` headers, or raw provider error bodies.
- **Never** add telemetry, analytics, or outbound calls that ship user content or config anywhere but the user's chosen AI provider.
- `data/`, `.env*`, `memory/`, `recon/`, `proof/`, `exports/` are git-ignored on purpose. Never commit them; never relax the ignore rules for them.

CI runs a secret scan over every pushed commit and blocks violations. If you suspect you've committed a real key anywhere: **revoke it at your provider immediately** — git history removal is not enough.

---

## Reporting bugs responsibly

Vulnerabilities and key-exposure risks never go through public issues — see [SECURITY.md](SECURITY.md).

---

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
