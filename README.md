# HitLights Ad Builder

A standalone web app that turns one product photo and a short message into a brand-locked Meta ad at
the three Andromeda sizes: **1080×1080, 1080×1920 and 1200×628**. It's one image reflowed to three
sizes, not three designs. It is a rebuild of the Claude-artifact Ad Builder (v16) that runs on its own
server, with no Claude account, artifact runtime or connectors.

## How a set is made

1. **Product.** Shopify catalog search (active products, stock, SKU, every product photo) or a pasted image URL.
2. **Copy.** Typed by hand, or drafted by *Write it for me*, within each template's length limits.
3. **Render.** Higgsfield Nano Banana Pro at 2K. The 1:1 master is rendered first, then the 9:16 and 16:9 are rendered *from the master* plus the product photo.
4. **Finish** (local, free). This step:
   - crops each render to the exact size;
   - locks the brand field colour and the CTA gold (#EBA800);
   - checks the logo zone;
   - composites the **real HitLights logo** at the fixed Logo Grid position;
   - saves a JPEG of 460 KB or less.
5. **Repaint.** If a blank patch was drawn where the logo goes, that one render is repainted once.
6. **Text & logo check.** A vision model reads each finished image against the expected copy.
7. **Deliver.** Downloads (single files or a zip) and optionally a dated Google Drive folder. Files with a blocking flag are held back.

The generator never draws the logo. Problems are flagged, never "fixed" by moving the logo.

## What's where

| Path | What |
|---|---|
| `core/brand.mjs` | Brand system, 5 templates, Logo Grid, copy limits. **The source of truth.** Extracted verbatim from v16. |
| `core/engine.mjs` | Prompts, grid specs, limits, draft/QA briefs. Pure functions shared by the page and the server. |
| `finishing/finish.py` | v16 finishing script, **unchanged**. `process.py` adds the exact-size crop. |
| `server/` | Node server: API, run pipeline, Higgsfield / Shopify / LLM / Drive clients. |
| `web/` | The page (v16's layout and styles). |
| `assets/logos/` | The approved lockups, taken from the template library. |
| `reference/HitLights_Ad_Templates.html` | The template library (brand reference). |
| `legacy/` | The original v16 kit and the v13 page, read-only. v16 is the parity oracle for the tests. |

## Run it locally

```bash
npm install
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
cp .env.example .env          # fill in what you have
PYTHON=.venv/bin/python npm run dev     # fake renderer, no credits
PYTHON=.venv/bin/python npm start       # real Higgsfield (sign in from the page's banner)
```

Open http://localhost:8080.

## Tests

```bash
npm run test:js                                    # parity with v16, providers, HTTP, pipeline
.venv/bin/python -m pytest -q tests                # finishing: grid placement, colour locks, flags
```

- **Parity tests** run the original v16 script in a fake DOM and require every prompt, spec and brief to match **byte for byte**. The only difference is one documented deviation: the T2 logo is black, per the template library.
- **Finishing tests** use synthetic renders at the real Higgsfield sizes.

## Configuration

Everything is set with environment variables. See `.env.example`.

- **Rendering:** `RENDERER=higgsfield-mcp` (default). The server talks to Higgsfield's official MCP server with the same tools, model and subscription credits as v16. Someone signs in to Higgsfield once from the page, and the sign-in is kept in `DATA_DIR`.
- **Language model:** `LLM_PROVIDER=anthropic` uses `claude-haiku-4-5` for drafting and `claude-sonnet-5-5` for the check. `openai-compatible` works with OpenAI, Gemini or OpenRouter. `none` turns both off; everything else keeps working.
- **Guards:** `MAX_CREDITS_PER_RUN`, `MAX_CREDITS_PER_DAY`, and `APP_PASSWORD` + `SESSION_SECRET`.

## Deploy (Railway)

`railway.json` sets up the build and health check.

1. **Create the service.** Railway → New Project → Deploy from GitHub repo → pick this repo and branch.
2. **Add a volume** mounted at `/data`. It holds the run history, finished files and the Higgsfield sign-in.
3. **Set Variables.** `DATA_DIR=/data`, `APP_PASSWORD`, `SESSION_SECRET`, `SHOPIFY_STORE`, `SHOPIFY_ADMIN_TOKEN`, and optionally the LLM and Drive settings (see `.env.example`).
   - `PORT` and the public URL come from Railway automatically.
4. **Generate a public domain.** Settings → Networking → Generate Domain.
5. **Sign in to Higgsfield once.** Open the page and use the banner.

Keep it at **one replica**: runs are coordinated inside a single process.
