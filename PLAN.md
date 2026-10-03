# HitLights Ad Builder — Standalone App Plan

## Current state (Oct 3, 2026; branch `claude/hardening-15a789c`)

**First live test (Oct 3, one T1 set, about 6 credits).** The full chain worked: Shopify, OpenAI, Higgsfield, finishing, checks. The gates correctly held all three files:
- the image model drew a box around the logo zone, or put the headline under the logo;
- it garbled the product's printed labels.

Prompting can't make this reliable. **All five templates are now composed** (ADR 0001 + 0003; T1 first, then T4 after a second live test showed a duplicate AI-drawn logo and a dropped "@" in the email, then T2, T3 and T5):
- Higgsfield renders one scene photo per set (about 2 credits instead of 6);
- the app sets the real product cutout, the copy, the CTA and the logo in Chromium from fixed layouts.

**Status:** implemented and tested with the fake renderer and the real cutout model; not yet live.

**Scope:** image ads only. One concept per set at three **placement sizes** (1080×1080, 1080×1920, 1200×628). That is placement coverage, not creative diversity: see `docs/CREATIVE_DIVERSITY.md`. Video is planned only (`VIDEO_PLAN.md`).

| Area | Implemented | Tested how | Live-tested? |
|---|---|---|---|
| Brand engine (prompts, Logo Grid, limits) | ✅ | Byte-for-byte parity with v16 (45 tests; 3 documented deviations: T2 logo black, terminology in the prompt pack, nothing else) | n/a (pure code) |
| Finishing (crop, colour locks, logo, ≤460 KB) | ✅ `finish.py` unchanged from v16; size enforcement added around it | 42 Python tests on synthetic renders at real 2K sizes | ❌ not on real Higgsfield renders |
| Paid-render safety (attempt ledger, reservations, ambiguous → decision) | ✅ | 14 crash-injection tests with a fake renderer | ❌ |
| Higgsfield over MCP + OAuth | ✅ | Mocked client tests; response shapes confirmed once against the real MCP (read-only calls) | ❌ No render, no OAuth sign-in from the app yet |
| Delivery gates (QA, fidelity, flags, overrides) | ✅ | Unit + pipeline tests with mocked LLM and Drive | ❌ |
| Text & logo QA / product-fidelity QA | ✅ | Mocked LLM | ❌ No real model call yet (no LLM key configured) |
| Shopify variants | ✅ Query validated against the Shopify Admin schema | Mocked contract tests | ❌ Not run against the store (sandbox network blocked) |
| Google Drive delivery + idempotency | ✅ | Mocked Drive tests | ❌ No service account configured |
| Auth & security (sessions, CSRF, limiter, CSP) | ✅ | HTTP tests | ⚠️ The earlier version is deployed on Railway; this branch isn't yet |
| Composed T1 (cutout, layout check, scene render, scene check, compose) | ✅ | 15 Node tests with real Chromium + 4 Python tests; UI driven end to end in a browser with the real cutout model | ❌ Not yet on a real scene render |
| Ops (self-check, lock, graceful shutdown, logs, metrics) | ✅ | Tests + local start/stop | ❌ Docker image built only in CI (no Docker daemon in the dev sandbox) |

### Safety guarantees, stated precisely
- **At-most-once automatic submission, not exactly-once.** Higgsfield exposes no idempotency key.
  - The app never automatically resubmits a paid render whose outcome is unknown.
  - Only items Higgsfield explicitly marks `submission_failed` are retried, once.
  - Unknown outcomes stop the set, keep their credit reservation and wait for a person: adopt a found job, re-render knowingly, or skip.
  - A crash between Higgsfield accepting a job and the app saving its ID can still leave a charged job the app doesn't know about. It shows up as an *ambiguous* attempt, never as a silent duplicate.
- **Credit figures are estimates** (`CREDITS_PER_RENDER`, default 2). Higgsfield doesn't report per-job cost to the app.
- **Nothing is delivered automatically unless** every check explicitly passed: finished file, exact size, ≤460 KB, no blocking flag, text & logo QA pass and product-fidelity pass. Manual overrides and fidelity approvals are recorded.
- **The product-fidelity check is a vision model's judgement, not a guarantee.** "Uncertain" requires a person.

### Deployment requirements
- **One replica, with a persistent volume at `/data`.** Enforced by a lock file: a second live instance refuses to start.
- **Production refuses to start without** `APP_PASSWORD` (≥10 characters), `SESSION_SECRET` (≥32 characters) and an https public URL.

### Next
1. Deploy this branch to Railway: new variables and the volume, per README.
2. Sign in to Higgsfield from the app, then **one approved 6-credit test set**.
3. Add an LLM key (QA and fidelity are required for auto-delivery).
4. Run the acceptance matrix (about 90 credits, approval needed).

Design records: `docs/adr/0001` deterministic brand composition · `0002` Google SSO · `0003` product cutouts.

---

## Original plan (Sept 30, 2026, kept for history)

**Architecture changes from the original plan (decided during the build):**
- **Server is Node, not FastAPI.** The page's engine (prompts, limits) is shared verbatim between browser and server, and finishing still runs v16's Python `finish.py` unchanged, as a subprocess. This carries less porting risk than rewriting the JS prompts in Python.
- **Higgsfield via its official MCP server + one-time OAuth sign-in**, not the key-based Cloud API. The Cloud API bills a separate prepaid dollar balance, and Nano Banana Pro availability there is unconfirmed. The MCP path is exactly what v16 used: the same tools, model and subscription credits.
- **LLM is provider-agnostic:** `openai` (default `gpt-5.6-luna` for drafting and vision checks), `anthropic` (defaults `claude-haiku-4-5`, `claude-sonnet-5-5`), `openai-compatible` (Gemini, OpenRouter, etc.), or `none`. No provider has been live-tested yet.
- **Logos** come from the template library (byte-identical to v16's display copies), committed in `assets/logos/` with hashes.

**Goal:** Rebuild the HitLights Ad Builder (kit v16) as a standalone web app that doesn't depend on a Claude account, artifact runtime or connectors. It must produce the same output as v16 (same prompts, Logo Grid, finishing and QA), with Higgsfield as the renderer. It should be more stable than v16.
**Baseline:** `hitlights-ad-builder-rebuild-kit.zip` (builder v16, Sept 25 2026). This is the version that "works great".
**Delta source:** `ad-builder.html` + `REBUILD-INSTRUCTIONS.md` (the Sept 30 pack).

---

## 1. What we're rebuilding (v16, as it runs today)

| Stage | v16 today | Why it works |
|---|---|---|
| Product | Shopify connector → `search_products` (active only), featured image, stock and SKU | The real product photo goes into the render |
| Copy | Manual fields, or "Write it for me" (Claude `sample`) with per-template limits | Hard limits stop text from shrinking or garbling |
| Render | Higgsfield `nano_banana_pro`, 2K. **1:1 master first**, then 9:16 and 16:9 rendered **from the master** + the product photo | One ad at three sizes, not three designs |
| Prompts | Per-template brand system, composition, logo-zone reservation, typography, AVOID list | The generator never draws the logo |
| Finishing | `finish.py` in the Higgsfield sandbox: exact crop, brand-field colour lock, CTA gold lock to #EBA800, logo-zone check, real logo composited at a fixed grid position, JPEG ≤ 460 KB | Logo is pixel-exact every time |
| Repaint | A blank placeholder patch gets one automatic repaint (2 credits) | |
| QA | Claude vision reads each finished image against the expected copy and logo rules | Catches misspellings and stray logos |
| Delivery | Clean files go to a dated Drive folder. Flagged files are held back | Drive only ever holds files that are safe to run |
| Log | "Recent sets" table (artifact DB) | |

**v16's weak points (what "stable and reliable" has to fix):**
1. **The finishing step is a workaround.** Scripts go into the sandbox by heredoc, a background `sleep 900` keeps it alive, and each JPEG comes back as base64 in 19,000-character chunks. That's the most fragile part of the pipeline.
2. **Everything runs in the browser tab.** Closing the tab mid-run loses the run.
3. **Connectors are tied to the account.** Consent prompts (`consent_required`) and per-org publishing are why a rebuild pack exists at all.
4. **Logos are fetched at runtime** from Shopify CDN URLs (v13 used Higgsfield media URLs). If a URL moves, every run fails.
5. **There are no automated tests.** "Byte-for-byte" is maintained by hand.

---

## 2. Decisions needed before the build (the only blockers)

| # | Decision | My recommendation | Why |
|---|---|---|---|
| D1 | **Template art direction.** v16 and `ad-builder.html` disagree on 5 of 5 templates (table below) | Use **v16's templates** as the default. Add your new variants as **extra templates** (e.g. "T3b Promo — Room Photo") rather than overwriting | v16's versions are the ones proven to render well with the Logo Grid. New variants need their own grid entries and a test pass |
| D2 | **Hosting** | One Docker container on **Render or Railway** (about $7–25/mo), or Fly.io | Python finishing runs natively. No serverless timeouts on 3–5 minute renders |
| D3 | **Who can open it** | Google sign-in restricted to `@hitlights.com` | Stops credits from being spent by anyone with the link |
| D4 | **Copy drafting and QA model** | Anthropic **API key** (Claude Sonnet, Opus for QA if needed). Billed per use, with no Claude seat or connectors | This replaces the `sample` capability. It's the only Claude dependency left, and it's swappable |
| D5 | **Higgsfield access** | The Higgsfield **platform API** (API key), confirmed in the Phase 0 spike | The MCP connector isn't usable from a standalone server without an OAuth workaround |

### D1 detail: what differs between v16 and `ad-builder.html`

| Template | v16 (kit) | `ad-builder.html` |
|---|---|---|
| T1 Collage Hero | Violet field, **one** inset photo + glowing product cutout, headline line 1 in **#FBCA10** | "Collage of room, product and macro shots", headline line 1 in **#EBA800** |
| T2 Speech-Bubble | Job-site photo in cool daylight, **violet** logo in the bubble | **Aspirational finished space** (exterior at dusk, facade), **black** logo in the card |
| T3 Discount Deadline | **Dark violet gradient** #241A30→#120C18, angled flat-lay | **Full-bleed moody room photo**, darkened, no violet |
| T4 Styled Room | Photo on top, cream panel below, **white logo + shadow over the photo** | **Black logo on the cream panel** |
| T5 Glow Room / Spotlight | Gold **#EBA800** pill, no rule, contact details | Amber **#FFAB00** pill + **hairline amber rule**, #272727 scrim |
| Logo placement | Fixed pixel grid (e.g. 1080² at 64,64 w280) | Fractions "measured off approved reference ads" (sq 25.3% width, 5.1% margin) |
| Engine | QA, colour and CTA lock, flags, repaint, run log, balance | None of those. JPEG cap 700 KB |

**✅ Resolved (Sept 30):** Danah shared the template library `HitLights_Ad_Templates.html`, and it matches **v16** on all five templates:
- T2 is job-site contractor trust
- T3 is the dark violet gradient #241A30→#120C18
- T5 uses the gold #EBA800 pill with a → arrow and no violet

**The template library is the source of truth, and it goes into the repo at `reference/`.** The `ad-builder.html` variants are dropped.

**Logo per template, as used in the library's own template cards (decided Sept 30):**

| Template | Ground behind the logo | Logo file | Placement (unchanged v16 grid) |
|---|---|---|---|
| T1 Collage Hero | Violet field #523875 | `hitlights-logo-white.png` | Top-left |
| T2 Speech-Bubble | White bubble | `hitlights-logo-black.png` | Top-centre in the bubble |
| T3 Discount Deadline | Dark gradient | `hitlights-logo-white.png` | Top-left |
| T4 Styled Room | Photo (calm corner) | `hitlights-logo-white.png` + soft shadow | Top-left |
| T5 Glow Room | Dark photo | `hitlights-logo-white.png` + soft shadow | Top-centre (landscape: top-right) |

The logo files come from the library (they're embedded in it). They get committed to `assets/logos/`, so the app no longer fetches them from the Shopify CDN at runtime. The CONTRAST safety net stays: if the fixed colourway would be illegible, the other one is used and the file is flagged.

**Where the library differs from the v16 engine (to handle in Phase 2):**

| Library rule | v16 today | Plan |
|---|---|---|
| Two logo colourways only (white/black), "never recolour, no violet" | T2 uses a **violet** (#55426A) logo in the bubble | **Decided: follow the library.** T2 → **black**. The violet lockup is removed |
| A third file, `hitlights-mark.png` (the mark alone, where the lockup won't fit) | Not used | Commit it to the repo. Not used by any template yet |
| Colourway is picked from the actual background. A bright photo is softly darkened behind a white logo | Fixed colourway per template. Fallback to the other colourway flags CONTRAST. T4/T5 get a soft shadow | Keep v16 behaviour (it's proven). Revisit if CONTRAST flags show up in Phase 6 |

---

## 3. Target architecture

```
Browser (UI ported from v16: same steps, fields, cards, brand-kit panel)
   │  fetch / poll
   ▼
FastAPI app (Python 3.12, one container)
   ├─ /api/products      → Shopify Admin GraphQL (read_products, read_inventory)
   ├─ /api/draft         → Anthropic API (same brief as v16)
   ├─ /api/runs          → create run → background worker
   │     worker: import → master → portrait+landscape → finish → repaint? → QA → Drive → log
   ├─ /api/runs/{id}     → state for polling (the UI survives a tab close or reload)
   ├─ /api/runs/{id}/regen/{size}, /refinish (0 credits), /save-to-drive
   └─ /api/balance       → Higgsfield credits
Core modules (pure, tested):
   brand/      templates.yaml, logo_grid.yaml, limits.yaml, palette   ← single source of truth
   prompts.py  port of prompt_() / repaint / QA / draft briefs
   finish.py   v16 finish.py, unchanged logic, run locally
   assets/logos/ white, black, violet lockups (committed, checksummed)
Storage: SQLite on a persistent volume (runs, items, flags, QA, credits) + finished JPEGs on disk/S3
Integrations behind interfaces: RenderProvider (Higgsfield; fallback option: Gemini API),
   CopyModel (Anthropic), Delivery (Google Drive service account), Catalog (Shopify)
```

**What this removes:** the sandbox, heredocs, the keepalive, base64 chunking, connector consent, per-account publishing, and runtime logo fetches.
**What stays identical:** the prompt text, the master→derived render order, the Logo Grid, finishing math, flags, blocking rules, copy limits, QA prompt, Drive folder naming and file naming.

---

## 4. Phased build

Each phase has an exit test. Nothing moves forward until its exit test passes.

### Phase 0: Access and verification spike (≈½ day, ~10 credits)
- Credentials: Higgsfield API key, Shopify custom app token (`read_products`, `read_inventory`), Anthropic API key, Google service account with **Editor** on *Claude + Higgsfield Ad Creatives* (`1jTlV2izOOli81J9ZC-pXN-ZpYO0Wfh4L`).
- **Higgsfield API spike.** Confirm that `nano_banana_pro` is available via the API with:
  - 2K output
  - 1:1, 9:16 and 16:9
  - **multiple image references** (master + product photo)
  - references passed by URL or upload
  - job polling
  - credit cost per render (v16 assumes 2)
  - no "unlimited" plan prompt
- Download the two logo lockups and commit them with SHA-256 hashes.
- **Exit:** one 1:1 and one 9:16-from-master render done through the API, matching a v16 render in behaviour.
- **Fallback if the API lacks a feature:** (a) call Higgsfield's MCP server from the backend with a stored OAuth token, or (b) Gemini API "Nano Banana Pro" direct for that step. The provider interface keeps either one a config switch.

### Phase 1: Repo foundation (≈½ day)
- Import kit v16 `source/` into `legacy/v16/` (read-only reference) and `ad-builder.html` into `legacy/v13/`.
- Scaffold: `app/` (FastAPI), `core/`, `web/`, `tests/`, `Dockerfile`, `.env.example`, `pyproject.toml`, and CI (GitHub Actions: lint + tests).
- **Exit:** `docker compose up` serves a health page. CI is green.

### Phase 2: Brand engine with parity to v16 (≈1–1.5 days) ⭐ most important
- Extract `BRAND`, `TPL`, `LOGOGRID`, `CANVAS`, `FIELD`, `LIMITS`, `SAMPLE` and the photo registers from `b_script.js` into `core/brand/*.yaml`.
- Port `gridSpec`, `prompt_` (master + recompose), `repaint`, `qaPrompt`, the draft brief and `checkLimits` to `core/prompts.py`.
- **Golden parity tests.** Run the original JS in Node for every template × size × a set of copy inputs, save the exact prompt strings, and assert that the Python output is **byte-identical**. This proves "does exactly what the zip does".
- Copy `finish.py` over with logic untouched, and make it callable as a function (it's also still a CLI).
- **Finishing golden tests.** Collect saved raw renders (from Drive / Higgsfield history) for all 5 templates × 3 sizes, and assert:
  - logo placement at the §7 table positions
  - expected flags
  - output dimensions exactly 1080×1080 / 1080×1920 / 1200×628
  - file size ≤ 460 KB
  - that a visual diff against the v16 output is ≈0
- Keep the brand-kit reference generator (`kitBuild`), rendered from the same YAML so the kit and the tool can't drift.
- **Exit:** 100% prompt parity. All 15 Logo Grid cases pass.

### Phase 3: Integrations (≈1–1.5 days)
- **Shopify:** GraphQL search with the same query logic (`status:active`, title-word AND, SKU for one token). Return title, description, **all product images** (new: choose which image to use), totalInventory, SKU and price.
- **Higgsfield client:**
  - media import/upload, batch submit, poll with backoff
  - the v16 retry rule (one retry for items not accepted)
  - a 7-minute ceiling with a clear message
  - `use_unlim: false` always
  - balance
- **Anthropic:** draft (JSON mode, same brief and hard rules) and QA vision (same prompt, up to 3 images per call). Validate responses against a schema and retry once on malformed JSON.
- **Google Drive:** create the `YYYY-MM-DD Product` folder (with the `(set n)` suffix) and upload the JPEGs. Only clean files are uploaded. "Save anyway" is available.
- **Exit:** a contract test per integration (recorded fixtures) plus one live smoke test each.

### Phase 4: Run orchestrator (≈1 day)
- Persisted state machine per run and per size: `queued → importing → rendering → rendered → finishing → (repainting) → finished → qa → delivered | held | failed`.
- Every step is **idempotent and resumable.** A server restart or closed tab resumes from the last completed step. "Finish again" reuses paid renders at 0 credits.
- **Credit guard:**
  - check the balance before a run (≥6)
  - hard cap per run (e.g. 12 credits including repaint and auto-retry)
  - a daily cap (configurable)
- One run at a time per user (the same lock as v16's `busy`).
- **Optional auto-retry (new, off by default).** If a size fails QA on TEXT/NOCTA/COLLISION, regenerate that size once automatically (2 credits). Turn on after Phase 6 data shows it helps.
- **Exit:** kill the server mid-render and restart. The run completes without extra credits.

### Phase 5: UI (≈1 day)
- Port v16's `b_head.html` layout and styles:
  - steps 01–04
  - template picker grouped by pillar
  - live limit counters
  - stock chips
  - output cards with flags and QA
  - Download / Regenerate / "Save to Drive anyway"
  - Recent sets
  - Brand kit card
  - prompt pack
- Replace `mcp.callTool` with `fetch('/api/…')`. The UI polls run state and rebuilds cards from the server, so a reload shows the current run.
- Additions:
  - a product image picker (all Shopify images)
  - side-by-side view of the three sizes
  - "Download all (.zip)"
- **Exit:** a full set from the UI on EZDim 12V LED Dimmer Driver 40W, with log lines matching §5 of REBUILD.md (`white logo at (64,64) w280`, etc.).

### Phase 6: Acceptance and consistency testing (≈1 day, ~60–90 credits)
- **Matrix:** 3 products (EZDim dimmer driver, an LED strip, a lifestyle SKU) × 5 templates = 15 sets ≈ 90 credits. (Drop to 2 products ≈ 60 if needed.)
- **Measure per size:**
  - first-pass clean rate (no blocking flags + QA pass)
  - repaint rate
  - flag distribution
  - QA false-fail rate (spot-checked by you)
  - end-to-end time
- **Targets:**
  - ≥ 80% of sizes clean on first pass
  - 100% of delivered files at exact size with the logo on the grid
  - 0 garbled text in delivered files
  - ≤ 6 minutes per set
- Tune only through YAML (prompt wording, zone padding) and re-run the parity/golden tests after every change.
- **Exit:** targets met, and you sign off on the visual quality.

### Phase 7: Deploy and operate (≈½ day)
- Deploy the container: persistent volume, secrets in the host's env, Google sign-in allowlist, HTTPS.
- **Observability:**
  - structured logs per run
  - error alert (email or Slack)
  - `/admin` page with credits spent per day/week and clean rate
- **Runbook** (replaces REBUILD.md): rotate keys, swap logo files, add a template, change the Drive folder, and what each flag means.
- **Exit:** you run 3 real sets on production without me.

### Phase 8: Later (not in the first build)
- Batch mode (N products × 1 template, queued).
- Meta Ads Manager upload.
- A GHL/Attentive asset handoff.
- A 4:5 size (currently excluded by decision).
- Reels.

**Total:** ≈ 6–8 working sessions of build plus about 100 Higgsfield credits for spike and acceptance.

---

## 5. Reliability rules carried over (non-negotiable)
1. The generator never draws the logo. The real lockup is composited at a fixed grid position and never moved to find space.
2. Problems are **flagged**, never silently "fixed". Blocking flags (`COLLISION, PLACEHOLDER, SAFEZONE, NOCTA, CTACOLOR, TEXT`) hold a file back from Drive.
3. Master first, then derived sizes from the master plus the product photo.
4. Copy limits are enforced before any credit is spent.
5. Figures in copy come only from product data. The model never invents offers.
6. Settings are snapshotted when Generate is pressed, so edits mid-run can't make the sizes disagree.
7. Any change to prompts or grid has to pass the parity/golden tests before it deploys.

## 6. Adding or changing a template (after D1)
1. Add the entry to `templates.yaml` (system, craft, photo, composition per size, keep, avoid, labels, limits, samples).
2. Add a `logo_grid.yaml` row (colourway, ground type, x/y/w per size, and pad/bx if it's a bubble).
3. Generate the brand-kit reference and check the zones visually.
4. Run 2 live sets. Save the raw renders as new golden fixtures.
5. Add to the acceptance matrix.

## 7. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Higgsfield API doesn't match MCP features (multi-reference, 2K, cost) | Medium | Phase 0 spike first. Provider interface with MCP-bridge or Gemini fallback |
| Output quality differs from v16 despite identical prompts (different API path/defaults) | Low–Med | Side-by-side renders in Phase 0/6. Match params exactly |
| QA false fails block good files | Medium | "Save anyway" stays. Track false-fail rate in Phase 6 |
| Credit overspend from retries | Low | Per-run and daily caps. Auto-retry off by default |
| Unclear template direction (D1) | High until answered | Decide before Phase 2 |

## 8. What I need from you to start
Decisions D1–D5 are settled: v16 templates, and my defaults for hosting, sign-in and models. What's left:

1. ~~T2 logo colour~~: decided, follow the library (black).
2. **Three API keys** (Danah is providing these later. Phases 1–2 don't need them) to add as environment variables in the Claude Code environment settings (never pasted into chat):

   | Variable | Where it comes from | Needed for |
   |---|---|---|
   | `HIGGSFIELD_API_KEY` (+ `HIGGSFIELD_API_SECRET` if issued) | Higgsfield account → API keys | Rendering. **Required** |
   | `SHOPIFY_STORE` + `SHOPIFY_ADMIN_TOKEN` | Shopify admin → custom app with `read_products` and `read_inventory` | Product search. Optional (a pasted URL works without it) |
   | `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys (pay-as-you-go, ~$20 to start) | "Write it for me" + text check. Optional at first |

3. **Google Drive is postponed.** Downloads work without it. It gets set up at deploy time (Phase 7) with a guided walkthrough.
4. **Nothing to collect for test renders.** I pull recent generations from Higgsfield directly, with your OK.
5. **Credits:** about 100 Higgsfield credits available over the build.
