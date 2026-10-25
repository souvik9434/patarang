# Patarang: Open-Source Release Plan (v2 — research-grounded, execution-ready)

> **Target**: Public GitHub repository, MIT-licensed, ranked in GitHub search & Explore, with a contribution process that makes intentional or accidental damage impossible to merge.
> **Basis**: Deep-audit of this working tree + structural study of real top-tier repos: **sst/opencode** (config, CONTRIBUTING, .github layout) and **slidevjs/slidev** (community profile, docs split), verified via the GitHub Contents API on 2026-10-24.
> **Status**: Plan approved-pending — ▶ Phase 0 decisions needed from owner before execution.

---

## 0. Decisions needed from the owner (Phase 0 gate)

| # | Decision | Default if unanswered |
|---|----------|----------------------|
| 1 | **Where to publish**: real GitHub account/org + repo name. All docs currently use the placeholder `patarang/patarang`. | Publish under the owner's own account as `<owner>/patarang` |
| 2 | **Contact emails** in SECURITY.md (`security@patarang.dev`) and CoC (`conduct@patarang.dev`) — real mailbox or GitHub **private security advisory + Discussion** only? | Drop vanity domains; use GitHub private advisories + a Discussions category |
| 3 | **Private docs curation**: which of the 9 internal build/recon/roast docs (`01-ROAST-PREMORTEM.md` … `11-*.md`, `03-RECON-FINDINGS.md`, `04-AI-DEEP-RECON.md`) may go public, vs. kept as `docs/internal/` (git-ignored)? | Keep all recon/GenSpark-derived docs private; publish only user-facing docs |
| 4 | Publish as-is now with `npm publish` later, or never to npm? | GitHub-only for v0.1.x; npm decided after first release |

Nothing else blocks execution.

---

## 1. What the research actually found (evidence, not folklore)

### 1.1 sst/opencode — governance-first structure
Verified from `api.github.com/repos/sst/opencode/contents/`:

- **Root hygiene**: `.editorconfig`, `.gitattributes`, `.gitignore`, **`.gitleaksignore`** (they run **Gitleaks** secret scanning in CI), `AGENTS.md` (style guide for humans *and* AI coding agents), `CHANGELOG.md`, `CONTRIBUTING.md`.
- **`.github/`**: `CODEOWNERS` (review routing), `ISSUE_TEMPLATE/`, `pull_request_template.md`, `workflows/`, plus reusable `.github/actions/` and a `TEAM_MEMBERS` file for trusted-reviewer automation.
- **CONTRIBUTING.md is a gate, not a welcome mat.** Convention worth copying verbatim-in-spirit:
  - Conventional-commit titles: `type(scope): summary` with `feat|fix|docs|chore|refactor|test`.
  - **Bug fixes and chores MUST link an existing issue** (`Fixes #123`); enforced automatically.
  - Blank issues disallowed; templates mandatory; a bot flags template-violating/issues and closes them if not fixed in 2 hours.
  - Acceptance-scoping up front: "changes most likely to be accepted are: bug fixes, env-specific fixes, performance improvements, docs" — big features require design review *before* the PR.
  - Labels route work: `good first issue`, `help wanted`, `bug`, `perf`.
- Lesson → our "no one intentionally hampers it" requirement is solved **by review machinery**, not by trust: required checks + CODEOWNERS + branch protection.

### 1.2 slidevjs/slidev — the closest analogue (open-source slides tool)
Verified from `api.github.com/repos/slidevjs/slidev/contents/`:

- Root `LICENSE` + `CONTRIBUTING.md` + `CODE_OF_CONDUCT.md`; **`docs/` is a separate user-facing docs site** and internal build tooling lives elsewhere.
- `.github/`: `ISSUE_TEMPLATE/`, `workflows/`, `FUNDING.yml`, `stale.yml` (auto-close inactive issues — good for solo-maintainer longevity).
- `demo/` + `assets/` at root: instant visual proof for visitors.

### 1.3 API-key safety patterns across the ecosystem
- Never keys in code or committed config; `.env` + local data dirs `.gitignore`d; `.env.example` with **neutral placeholders** (no real key-prefix strings).
- Secret scanning **in CI (Gitleaks) + on GitHub (secret scanning & push protection)** — the opencode `.gitleaksignore` file signals they scan every PR.
- Vulnerability reporting via `SECURITY.md` → GitHub **private security advisories**.
- Dependabot + npm audit on schedule for supply-chain hygiene.

---

## 2. Current-state audit of this working tree (2026-10-24)

### ✅ Already solid
- `src/ai/config-store.js`: key stored in local `data/config.json` (atomic write), `maskKey()` → UI only ever sees `••••last4` + `key_present` flag; `src/agents-store.js`: agent tokens masked with `maskToken()` — **"zero UI key echo" is true in code**, not just in docs.
- Grep across the tree for real key shapes (`AIza…≥30`, `sk-…`, `ghp_…`): **0 matches** (excluding `node_modules`, `data`, `recon`, `memory`).
- `.gitignore` covers `.env*`, `data/`, `recon/`, `proof/`, exports, logs.
- `README.md` (hero + badges + BYOK security section + quickstart), `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `.env.example`, issue templates ×2, PR template, `ci.yml` (Node 22, `npm test`), `docs/ARCHITECTURE.md`, `docs/AI_PROVIDERS.md`, `docs/OPENSOURCE_PLAN.md`.
- `package.json`: MIT, `private:false`, engines ≥22.19, keywords, repository/bugs URLs.

### 🔴 Blockers — must fix before the first public commit
1. **The directory is not a git repository at all** (`git rev-parse` → `not a git repository`). No history to prune is actually good news — we start with a clean, curated tree.
2. **`memory/` (`memory.md`, `progress.md`) is NOT git-ignored.** These are working-session notes (recon details, internal plans). They would ship in commit #1. → ignore `memory/` (and `session-*.md`), or curate-then-ignore.
3. **`LICENSE` is corrupted**: the MIT liability paragraph is duplicated ("IN NO EVENT SHALL … IN NO EVENT SHALL …") and the middle of the paragraph was mangled during a paste. Replace with the byte-exact canonical MIT text.
4. **`.env.example` placeholder is `AIzaSyYourApiKeyHere`** — starts with the real Google-key prefix `AIzaSy`; style it like a real key so users don't "fix" it accidentally, but it *is* short enough to evade GitHub's pattern — still, use a neutral value (`paste-your-gemini-key-here`) so secret scanners and humans both read it as a template.
5. **`docs/` mixes public and private docs.** `03-RECON-FINDINGS.md` / `04-AI-DEEP-RECON.md` / `01-…-ROAST-*.md` etc. contain GenSpark recon evidence and internal roast gates. Decide curation (Decision #3) before `git init`, because **git history is forever**.
6. **`package.json` metadata points to the placeholder repo** (`patarang/patarang`) — must match the real remoteslug (Decision #1) or npm/GitHub links 404 publicly on day one.

### 🟡 Should-have for "top-repo" credibility (cheap, do in Phase 2–3)
- `.github/CODEOWNERS` (opencode-style review routing) — even a single-person team counts as the review gate.
- `CHANGELOG.md` + Keep-a-Changelog format; tag `v0.1.0` on first release.
- `FUNDING.yml` (optional), `stale.yml` (optional), `.editorconfig`, `CONTRIBUTING.md` upgrade to the opencode-style gate (conventional commits, linked-issues rule, scoped acceptance).
- Third badge column: CI (already), License (already), plus **deploy/demo GIF + social preview image** (GitHub Settings → Social preview, 1280×640) — the single highest-leverage visual for ranking clicks.
- Discussions enabled with categories: 💡 Ideas / 🙏 Q&A / 🔒 Security contact pointer.

---

## 3. Licensing decision (researched, not defaulted)

**Choice: MIT** (already in package.json + LICENSE). Rationale:
- Direct competitors and nearest analogues (Slidev = MIT, most BYO-key dev tools) use MIT/Apache-2.0; permissive maximizes adoption, forks, and "used by" lists — the goal is stars and ranking, not enforcement.
- **What protects us from abuse is not the license**: the name/trademark ("Patarang"), the branding, and GitHub org trust. A cheap parallel-lane trademark registration of the name is recommended; MIT code legally *must* remain forkable (that's the point).
- Add one README line: *"Patarang is not affiliated with or endorsed by Genspark; it is an independent, behaviour-parity implementation."* — pre-empts copycat-confusion reports that hurt ranking.

The corrupted LICENSE text gets replaced by canonical MIT ("Copyright (c) 2026 <real name/org>") in Phase 1 — a LICENSE file with malformed text makes GitHub's license detection (`detect-license` API) fail and shows no license badge, which actively hurts ranking.

---

## 4. API-key & secrets security program (the "fully safe" requirement)

### 4.1 Product guarantees — verify, then document as tested claims
| Guarantee | Mechanism (already in code) | Hardening |
|---|---|---|
| Keys are local-only | `data/config.json` (git-ignored), env-var override `PATARANG_API_KEY` | Add `data/`, `.env*`, `memory/`, `session-*.md`, `recon/`, `proof/` verification to a repo-hygiene CI step |
| Browser never sees plaintext keys | `maskKey()` / `maskToken()` in `config-store.js` / `agents-store.js`; `publicConfig()` strips the key | **Add a unit test asserting no API response body ever contains a full key** (defense against future contributors breaking it) |
| No key leakage in logs/errors | Provider error messages are static strings | Add regex redaction middleware for any `400/401/403` provider response body before it reaches console/UI; test it |
| No keys committed by *users* either | `.gitignore` covers `.env*` + `data/` | Ship a `scripts/check-secrets.js` (regex scan) run in CI both for the repo itself and documented for forks |

### 4.2 GitHub-side protections (set at repo creation, not discovered later)
- **Secret scanning: ON. Push protection: ON** (blocks any commit containing a detected key pattern from being pushed at all — this is the mechanism that guarantees *contributors* can't leak *their* keys into issues/PRs either).
- **Branch protection on `main`**: require PR before merge, require CI check (`test`) to pass, require CODEOWNERS review, disallow force-push and deletion.
- **Dependabot**: version updates (weekly) + security alerting.
- Security bug reports: enable **private vulnerability reporting** in Settings → Code security, and link it from SECURITY.md (replaces the vanity mailbox if Decision #2 = default).
- CI hardening (opencode pattern): pin actions by SHA (`actions/checkout@<sha>`), `permissions: contents: read` default per workflow, and – this matters for forks — **never allow PR workflows to receive repo secrets** (default GitHub behavior; don't override it).

---

## 5. Contribution process design ("no one intentionally hampers it")

Modeled on opencode's verified CONTRIBUTING.md, sized for a 1-maintainer project:

1. **Issue-first for anything except trivial fixes** — feature PRs require a prior approved feature-request issue (design review happens at the issue, not at the PR: saves both sides hours of wasted code).
2. **Required CI**: `npm test` (34+ tests) must pass; a **repo-hygiene job** fails on: committed `.env`/`data/`/`memory/` files, failing secret regex scan, or non-conventional PR title.
3. **Conventional commit titles**: `feat|fix|docs|chore|refactor|test(scope): summary` — enforced by the PR template + a title-formatting check.
4. **CODEOWNERS** routes every PR to the maintainer for approval — nothing self-merges even if a bot would approve.
5. **Small-PR doctrine** in the template: "explain the problem, how you tested it, and what the reviewer should verify"; screenshots mandatory for UI changes (matches what the project itself does in reviews).
6. Explicitly-out-of-scope list up front (one paragraph): provider SDKs we don't support, cloud/telemetry features (violates local-first promise), reformat-the-world PRs — declining them openly is what keeps the bar.
7. **Security-sensitive areas** (config-store, key handling, sanitiser) get a note in CONTRIBUTING: "changes here require maintainer discussion first" — mirrors opencode's "UI and core features require design review".

---

## 6. Execution phases

### Phase 0 — decisions (owner)
Fill in Section 0 defaults or override them. Nothing is committed yet.

### Phase 1 — repo curation & bootstrap (agent, ~1 session)
1. Fix `LICENSE` (canonical MIT).
2. Extend `.gitignore`: add `memory/`, `session-*.md`, `.tmp/`, `exports/` audit; neutralize `.env.example` placeholder.
3. Curate `docs/` per Decision #3 → move private docs to `docs/internal/` + ignore it; keep public: `ARCHITECTURE.md`, `AI_PROVIDERS.md`, the rewritten `OPENSOURCE_PLAN.md`, plus add a short `CLI_GUIDE.md`.
4. Update all placeholder URLs in `package.json`, READMEs, CONTRIBUTING to the real `owner/repo` (Decision #1); add the non-affiliation line.
5. Upgrade `CONTRIBUTING.md` to the gated process above; review PR template.
6. `git init` + first commit, then **pre-publish leak check**: run the secret regex scan + manual `git grep -iE 'AIza|sk-|ghp_|password|config.json'` + review every file in `git ls-files` against the ignore rules. Only then proceed.
7. Run `npm test` one last time so the recorded "34/34" claim is re-verified at HEAD.

### Phase 2 — GitHub repository & settings (owner+agent)
1. Create the repo (Decision #1) — description from Section 7, `git remote add` + push `main`.
2. Turn on: secret scanning, push protection, Discussions; branch protection rules from §4.2; enable Dependabot; add topics; upload social-preview image.
3. Add `.github/CODEOWNERS`, `CHANGELOG.md` (v0.1.0), optional `FUNDING.yml`/`stale.yml`.
4. Add `good first issue` / `help wanted` labels seeded with 5–10 fine-grained issues (docs, provider adapters, export polish) — issues with owners of small scope are what actually attract first contributors.

### Phase 3 — visibility & ranking work
1. README hero: a real 10-second GIF / screenshot first (visual proof drives the click), then the Quickstart.
2. Release flow: GitHub Release v0.1.0 with per-archetype screenshots in the release notes (releases create the repo's "published" signal for Explore/the trending algorithm).
3. Cross-listing: Rebuild in Stack "Open Source Alternatives" list, slidegen/marpp adjacent Dev.to write-up ("Why we rebuilt GenSpark AI Slides — open source, your own key"), awesome-* PRs where the tool genuinely fits (`awesome-slide`…), SaaSHub/Software-Advice listing reuse from the existing sweep playbook.
4. Steady-state contributions cadence: label cleanup weekly, `stale bot` optional, response-time discipline (first response within 24–48h is the strongest ranking/retention factor for new repos).
5. npm package `patarang` (v0.2) once Decision #4 resolves — npm presence feeds back into GitHub search weight ("published package" field).

### Verification gates before pushing
- [ ] `git ls-files` reviewed top-to-bottom — no `data/`, `memory/`, `recon/`, `proof/`, `exports/`, session notes.
- [ ] Secret scan clean; LICENSE detected as MIT by GitHub (check the license badge renders).
- [ ] `npm test` green at HEAD; CI green on the pushed commit.
- [ ] Every README/CONTRIBUTING/SECURITY link resolves (no placeholder `patarang/patarang` left).
- [ ] Branch protection active before the *second* push (first push happens pre-settings; that window has zero risk since the only committer is us).

---

## 7. Ready-to-paste repo metadata

- **Description** (keep ≤ ~120 chars for search truncation): `Open-source AI presentation studio — GenSpark AI Slides behavior-parity clone. Bring your own Gemini/OpenAI key. Local-first, zero telemetry.`
- **Topics** (max 20, most-searched first): `ai-slides` `presentation-generator` `genspark` `gemini` `openai` `pptx` `pdf-export` `byok` `local-first` `ai-agent` `nodejs` `developer-tools` `slides` `deck-builder`
- **Website field**: docs site or Playwright-hosted gallery when live; leave empty → set to repo Discussions later.
