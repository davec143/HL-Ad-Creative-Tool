# HitLights Ad Builder — handoff (Oct 3, 2026)

This is the full state of the project at the end of the cloud Claude Code session, for continuing
locally. Read it top to bottom once. `CLAUDE.md` (repo root) is the short version that Claude Code
loads automatically. The full conversation is kept outside the repo, because the repo is
public (see *Open items*).

---

## 1. What this is

A standalone web app that turns one Shopify product (an exact variant) and a short message into a
brand-locked Meta **image** ad at three placement sizes: **1080×1080, 1080×1920, 1200×628**. It
replaces the Claude-artifact "HitLights Ad Builder" (kit v16, kept read-only in `legacy/`).

**How a set is made now (all five templates are "composed"):**

1. **Product:** pick a Shopify variant. Its photo, SKU, price and stock are frozen into the set.
2. **Copy:** typed, or drafted with *Write it for me* (LLM), with a fact guard (no invented figures
   or claims).
3. **Cutout:** the product photo's background is removed locally (IS-Net ONNX model, free). A
   person approves each cutout **once** per product photo, or uploads their own transparent PNG.
4. **Free layout check:** all three sizes are laid out before anything is paid for. Copy that
   doesn't fit fails here, with the field named.
5. **One paid render:** Higgsfield (Nano Banana Pro, 2K, via its MCP server with OAuth) renders
   **one scene photograph only**. That's about 2 credits per set (it was 6), and it's shared by all
   three sizes.
6. **Scene check:** a vision model checks the photo for stray text, logos, panels, faces or
   close-up devices.
7. **Compose:** headless Chromium renders each size from the template layout:
   - the real logo;
   - the exact copy in Montserrat (bundled, OFL licence);
   - the gold CTA;
   - the real product cutout;
   - the scene.

   Then it's encoded to a JPEG of ≤ 460 KB.
8. **Gate → deliver:** a file is delivered automatically (download, plus Google Drive) only when
   the output is valid, the cutout is approved and the scene check passed. Otherwise it's held,
   with the reason shown, and can be overridden with a recorded reason.

**Why it was rebuilt this way:** live tests of the original approach failed in ways prompting
can't fix. When the image model drew the whole ad, it:

- drew boxes around the logo zone;
- put the headline under the logo;
- garbled the product's printed labels;
- drew a second, fake HitLights logo;
- dropped the "@" from the email.

Now the image model never draws text, the logo or the product. See `docs/adr/0001` and `0003`.

---

## 2. Where everything is

| What | Where |
|---|---|
| Code | GitHub `davec143/hl-ad-creative-tool`, branch **`claude/hardening-15a789c`** (working branch) |
| Known-good snapshot | branch **`snapshot/2026-10-03-composed-ok`** = commit `37ff880` (first live composed set looked right; logo size approved). Don't push to it. |
| Latest commit | `4c5baee` "Cutouts: keep the product solid where background removal hesitated". CI green. |
| Production | Railway service **HL-Ad-Creative-Tool**, `https://hl-ad-creative-tool-production.up.railway.app` (`/readyz` = self-check) |
| Railway source | the repo above, branch `claude/hardening-15a789c`, Dockerfile build (`railway.json`), volume at `/data`, **1 replica** |
| CI | GitHub Actions `.github/workflows/ci.yml`: Node + Python tests (3.11/3.12), Docker build, container readiness, non-root check |

**Railway doesn't auto-deploy pushes to this repo** (it's linked through a collaborator account).
After every push: Railway → Deployments → Ctrl/Cmd+K → **Deploy Latest Commit**, then check that the
top card shows the new commit message and `/readyz` is all ok.

---

## 3. Code map

| Path | What |
|---|---|
| `composer/templates.mjs` | Per-template, per-size layouts (T1–T5), `LOGO_W` (340/380/300 px), `layoutFor()` |
| `composer/page.mjs` | HTML builder per template + in-page fit/overlap/clear-space/safe-zone/font checks |
| `composer/render.mjs` | Chromium via playwright-core; prefers Playwright's own headless build, falls back to a local Chromium |
| `core/composed.mjs` | Which templates are composed (all five); composed scene drafting text and sample scenes |
| `core/scene.mjs` | Scene-photo prompt, render params, scene-check prompt/schema/parser |
| `core/gates.mjs` | The single delivery decision (composed branch: output + cutout approval + scene check) |
| `core/brand.mjs`, `core/engine.mjs` | Brand system and v16 engine (verbatim extract; parity-tested) |
| `server/pipeline.mjs` | Run pipeline: composed path (`processComposed`) + legacy path; paid-render attempt ledger |
| `server/compose.mjs` | `CutoutStore` (per photo hash, versioned `CUTOUT_ALGO`), compose → JPEG |
| `finishing/cutout.py` | IS-Net background removal + `refine()` (keeps the product solid where the model hesitated) |
| `finishing/encode.py` | PNG → JPEG ≤ 460 KB (4:4:4 first, 4:2:0 fallback) |
| `finishing/finish.py` | v16 finishing, **byte-identical, never edit** (legacy path only) |
| `server/render/higgsfield-mcp.mjs` | Higgsfield MCP client (OAuth, at-most-once paid submissions) |
| `server/providers/` | Shopify (variants), LLM (OpenAI / Anthropic / OpenAI-compatible), Drive (service account) |
| `web/` | The page (preview, cutout approval panel, scene panel, run cards) |
| `tests/` | `composed.test.mjs` (Chromium), parity, render-safety, gates, security, pipeline, `test_finishing.py` |
| `legacy/` | v16 and v13 originals, **read-only** (parity oracle) |
| `reference/HitLights_Ad_Templates.html` | The template library (source of truth for layouts and colours) |

---

## 4. Configuration (Railway variables; names only, never commit values)

| Variable | Set to / notes |
|---|---|
| `APP_PASSWORD` | team password (≥ 10 chars) |
| `SESSION_SECRET` | ≥ 32 random chars |
| `PUBLIC_URL` | `https://hl-ad-creative-tool-production.up.railway.app` |
| `DATA_DIR` | `/data` (the Railway volume) |
| `SHOPIFY_STORE` / `SHOPIFY_ADMIN_TOKEN` | `hitlights.myshopify.com` / custom-app token with `read_products`, `read_inventory` |
| `LLM_PROVIDER` / `OPENAI_API_KEY` | `openai` / your key. Defaults: `gpt-5.6-luna` for drafting **and** checks (cheapest). `LLM_QA_MODEL=gpt-5.6-terra` gives stricter checks; recommended if the scene check misses things. |
| `GOOGLE_SERVICE_ACCOUNT_JSON` / `DRIVE_PARENT` | service-account JSON (added with "New Variable", not the Raw Editor) / Shared Drive folder ID |
| `COMPOSED_TEMPLATES` | unset = all five composed. Set it to empty (or a subset like `t1,t4`) to send templates back to the old prompt-driven pipeline (emergency switch). |
| `CREDITS_PER_RENDER`, `MAX_CREDITS_PER_RUN`, `MAX_CREDITS_PER_DAY` | defaults 2 / 12 / 120 (estimates; caps include reservations) |
| `CUTOUT_MODEL`, `PLAYWRIGHT_BROWSERS_PATH` | set by the Docker image; set locally only if you run outside Docker |

Higgsfield has no key in the app: sign in once from the banner on the page (OAuth). The token is
stored on the `/data` volume.

---

## 5. Run it locally (macOS)

```bash
# 1. Get the code
git clone https://github.com/davec143/hl-ad-creative-tool.git HL-Ad-Creative-Tool
cd HL-Ad-Creative-Tool
git checkout claude/hardening-15a789c

# 2. Node 22 + Python 3.11 (e.g. `brew install node@22 python@3.11`)
npm ci
python3.11 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt

# 3. Chromium for the composer (Playwright's build for this version)
npx playwright-core install chromium

# 4. Background-removal model (~178 MB, hash-checked)
mkdir -p models && curl -L -o models/isnet-general-use.onnx \
  https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx
shasum -a 256 models/isnet-general-use.onnx   # must be 60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a

# 5. Local settings (never commit .env)
cp .env.example .env
#   then edit .env: CUTOUT_MODEL=./models/isnet-general-use.onnx, and add your own
#   Shopify/OpenAI values if you want live data locally

# 6. Run without spending credits (fake renderer)
PYTHON=.venv/bin/python npm run dev      # → http://localhost:8080

# 7. Tests
PYTHON=.venv/bin/python node --test tests/*.test.mjs
.venv/bin/python -m pytest -q tests
```

**Continue with Claude Code locally:** `cd HL-Ad-Creative-Tool && claude`, then say *"Read
CLAUDE.md and docs/HANDOFF.md, then continue."* Optionally also give it the conversation export
(`HitLights-Ad-Builder-conversation.md`, sent separately; keep it out of the public repo).

---

## 6. Status: what's verified and what isn't

| Area | Status |
|---|---|
| All 5 templates composed | ✅ Tests (156 Node + 48 Python), browser UI tested end to end with the fake renderer and the real cutout model |
| First live composed set (T1, EZDim) | ✅ Oct 3: one scene render, scene check pass, three sizes composed, logos right. Held only because the cutout wasn't approved yet. |
| Cutout fix (product partly see-through) | ✅ Implemented + tested on a reproduction, CI green (`4c5baee`). ⏳ **Not yet confirmed live**: deploy, then *Re-compose (0 credits)* on the EZDim set, compare, approve. |
| Delivery to Google Drive | ⏳ Configured; a passed composed file hasn't been saved live yet (the first set was held for cutout approval) |
| OpenAI drafting + scene check | ✅ Working live |
| Shopify catalog | ✅ Working live |
| Higgsfield sign-in + scene render | ✅ Working live |
| Paid-render safety (ambiguous → human decision) | ✅ Tested with fault injection; never triggered live |

---

## 7. Decisions made (and why)

- **Composition, not prompting.** The AI paints only the background photo; the app sets the logo,
  copy, CTA and the real product (ADR 0001/0003). This reduced credits per set from about 6 to 2.
- **Logos:** white on dark/photo grounds, black on light. T2 uses the black logo inside the white
  bubble. **Logo width 31% / 35% / 25%** of frame width (square / portrait / landscape), within the
  brand's 20–36% rule, anchored per the Logo Grid. Danah approved this size.
- **T4 portrait:** the logo moved into the cream panel (black lockup). Over the photo at y=288 it
  floated mid-scene. This is the one deliberate departure from the template library.
- **Scene descriptions** are the space and the light only (no people, hands or devices). Drafted
  scenes follow this (a documented parity deviation).
- **LLM:** provider-agnostic (OpenAI chosen; Anthropic or any OpenAI-compatible API also works).
  The cheapest model for everything, by Danah's choice; `LLM_QA_MODEL` is the knob for stricter checks.
- **Cutouts:** approved once per product photo. An automatic cutout from an older method is redone
  automatically; approved and uploaded ones never are.
- **Safety:** paid renders are at-most-once (Higgsfield has no idempotency key). An unknown outcome
  stops the set for a human decision; it's never resubmitted silently.

## 8. Rules for whoever continues (from the hardening spec)

- Never edit `legacy/` or `finishing/finish.py` (must stay byte-identical to v16; CI checks it).
- Keep `tests/parity.test.mjs` green; document any intentional prompt change as a deviation there.
- **No paid Higgsfield renders without Danah's explicit approval.** Tests use the fake renderer.
- Never commit secrets, `.env`, OAuth tokens or run data. The repo is **public**.
- Small commits; push to `claude/hardening-15a789c`; wait for CI green before telling Danah to deploy.
- Don't start video (`VIDEO_PLAN.md`) until the image pipeline is fully proven live.

## 9. Open items / next steps (in order)

1. **Deploy `4c5baee`**, *Re-compose* the EZDim set, check the side-by-side cutout panel, approve,
   and confirm "Ready to use" plus the file appearing in Drive (this verifies Drive live).
2. **Make the GitHub repo private** (GitHub → Settings → General → Danger Zone → Change visibility).
   It contains the internal template library (`reference/`, "not for external distribution").
   Railway deploys still work, since the collaborator account keeps access.
3. **Rotate the secrets pasted in chat earlier:** the Shopify Admin token (Shopify → app → API
   credentials) and the Higgsfield API key (unused by the app). Update `SHOPIFY_ADMIN_TOKEN` in Railway.
4. Run one real set per template you use, and tune layouts from Danah's feedback (free to iterate
   with *Preview free*). Known candidates:
   - T5 product runs off the frame edge (template style), which can crop a switch;
   - T2/T4 portrait have a bottom band that Reels covers;
   - T3 square has empty space left-centre.
5. If the scene check passes photos it shouldn't, set `LLM_QA_MODEL=gpt-5.6-terra`.
6. Optional: fix Railway auto-deploy (install the Railway GitHub app on `davec143`'s repo) so pushes
   deploy without the manual step.
7. Later: video (`VIDEO_PLAN.md`), creative variants (`docs/CREATIVE_DIVERSITY.md`).
