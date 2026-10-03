# HitLights Ad Builder

A standalone web app that turns one Shopify product (an exact variant) and a short message into a brand-locked Meta **image** ad at three **placement sizes**: **1080×1080, 1080×1920 and 1200×628**. It's one concept reflowed to three aspect ratios, not three designs and not three creative variants (see `docs/CREATIVE_DIVERSITY.md`). It rebuilds the Claude-artifact Ad Builder (v16) as its own server, with no Claude account, artifact runtime or connectors.

**Status:**
- **Image pipeline:** implemented and covered by automated tests. **Not yet live-tested** against Higgsfield, Shopify, an LLM or Drive. `PLAN.md` § *Current state* lists exactly what is and isn't verified.
- **Video:** planned only (`VIDEO_PLAN.md`).

## How a set is made

1. **Product.** Shopify search (active products) → pick the exact **variant**. Its image, SKU, price and stock (in stock / out of stock / unknown / not tracked) are frozen into the set. Or paste an https image URL (marked "external").
2. **Copy.** Typed by hand, or drafted by *Write it for me* within each template's length limits. A fact guard keeps out any figure, price, percentage, certification or offer that isn't in the product data.
3. **Render.** Higgsfield Nano Banana Pro, 2K: the 1:1 master first, then 9:16 and 16:9 rendered *from the master* plus the product photo.
4. **Finish** (local, free).
   - v16's `finish.py`, unchanged: exact crop; brand-field and CTA gold locks; logo-zone check; the **real logo** at its fixed Logo Grid position.
   - Then a hard output contract: exact size, decodes, **≤ 460,000 bytes**. It re-encodes down to quality 40 if needed, otherwise the file is held.
5. **Repaint.** If a blank patch was drawn where the logo goes, that render is repainted once (a paid action, same safety rules).
6. **Checks.** Two vision-model checks: **text & logo** against the expected copy, and **product fidelity** against the exact product photo (kept per set, with its hash).
7. **Deliver.** Download (single files or a zip). Drive is optional. **Only files that pass every gate are delivered automatically** (`core/gates.mjs`). Everything else is *held* or *unchecked*, with the reason shown. A person can record an override with a reason, or approve an "uncertain" product check.

## Paid-render safety (at-most-once, not exactly-once)

Higgsfield has no idempotency key, so the app never claims exactly-once.

- **Attempt records.** Every paid request is a durable attempt record saved **before** it's sent, with a credit **reservation**.
- **Accepted** jobs are saved with their ID; **Resume** waits for them and never pays again.
- **Explicit `submission_failed`** items are retried once; their reservation is released.
- **Ambiguous outcomes:** a timeout, dropped connection, missing or malformed response, or a crash mid-submission. These **stop the set**, keep the reservation, and show three choices: *adopt* a job found in Higgsfield's history, *re-render* knowingly, or *skip*. Nothing ambiguous is resubmitted silently.
- **Caps** (`MAX_CREDITS_PER_RUN`, `MAX_CREDITS_PER_DAY`) count reserved + spent credits. The live balance is checked before every paid action, including regeneration and repaint.
- **Credits are estimates** (`CREDITS_PER_RENDER`).

## What's where

| Path | What |
|---|---|
| `core/brand.mjs` | Brand system, 5 templates, Logo Grid, copy limits. Extracted verbatim from v16. |
| `core/engine.mjs` | Prompts, grid specs, limits, draft/QA briefs. Pure functions shared by page and server. |
| `core/gates.mjs` | The single delivery decision (passed / held / unchecked / failed / overridden). |
| `core/fidelity.mjs`, `core/facts.mjs` | Product-fidelity prompt + parsing; drafting fact guard. |
| `finishing/finish.py` | v16 finishing script, **byte-identical** (hash in `FINISH_PY_SHA256`). `process.py` adds the crop and the output contract. |
| `server/pipeline.mjs` | Run pipeline, attempt ledger, decisions, gates, Drive delivery. |
| `server/render/` | Higgsfield MCP client (OAuth), fake renderer for development and tests. |
| `server/providers/` | Shopify (variants), LLM (OpenAI, Claude, or any OpenAI-compatible API), Drive (service account). |
| `server/security.mjs`, `server/selfcheck.mjs`, `server/obs.mjs` | Sessions/CSRF/limits, startup self-check + instance lock, JSON logs + metrics. |
| `web/` | The page (v16 layout and styles). |
| `docs/adr/` | Design records: deterministic composition, Google SSO, product cutouts. |
| `legacy/` | The original v16 kit and the v13 page, **read-only**. v16 is the parity oracle for the tests. |

## Run it locally

```bash
npm ci
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
cp .env.example .env                    # fill in what you have
PYTHON=.venv/bin/python npm run dev     # fake renderer, no credits
```

Open http://localhost:8080.

## Tests

```bash
PYTHON=.venv/bin/python node --test tests/*.test.mjs   # parity, render safety, gates, security, providers, pipeline, ops
.venv/bin/python -m pytest -q tests                    # finishing: grid, colour locks, flags, 460 KB contract
```

CI also builds the production Docker image, checks that it runs as non-root and passes `/readyz`, and checks that it refuses to start without auth.

## Configuration

Everything is set with environment variables. See `.env.example`.

| Group | Variables |
|---|---|
| Required in production | `APP_PASSWORD` (≥10 chars), `SESSION_SECRET` (≥32 chars), https `PUBLIC_URL` (or Railway's generated domain), `DATA_DIR=/data` |
| Rendering | `RENDERER=higgsfield-mcp` (default; sign in once from the page), `CREDITS_PER_RENDER`, `MAX_CREDITS_PER_RUN`, `MAX_CREDITS_PER_DAY` |
| Catalog | `SHOPIFY_STORE`, `SHOPIFY_ADMIN_TOKEN` (scopes `read_products`, `read_inventory`) |
| Checks | `LLM_PROVIDER`: `openai` (`OPENAI_API_KEY`; `gpt-5.6-luna` drafts, `gpt-5.6-terra` checks), `anthropic` (`ANTHROPIC_API_KEY`; `claude-haiku-4-5` drafts, `claude-sonnet-5-5` checks), `openai-compatible` (Gemini, OpenRouter…), or `none`. `LLM_DRAFT_MODEL` / `LLM_QA_MODEL` override the models, `REQUIRE_PRODUCT_FIDELITY` (default on) |
| Drive | `GOOGLE_SERVICE_ACCOUNT_JSON`, `DRIVE_PARENT` |

**Without an LLM, nothing is delivered automatically.** The checks are off, so every file is *unchecked* and needs a recorded override.

## Deploy (Railway)

`railway.json` sets up the build and health check.

1. **Service.** Deploy the repo/branch.
2. **Volume** mounted at **`/data`**. It holds runs, finished files, the credit ledger, sessions and the Higgsfield sign-in. **Required.**
3. **Variables:** the production set above, plus Shopify (and later the LLM and Drive).
4. **Domain:** Settings → Networking → Generate Domain.
5. **Sign in to Higgsfield** once from the page's banner.
6. **Health checks.** `/readyz` shows the self-check; `/healthz` is liveness only.

**Keep exactly one replica.** Runs are coordinated in one process, and a lock file on the volume makes a second live instance refuse to start.

The container starts as root only to fix the volume's ownership, then runs as the `node` user.
