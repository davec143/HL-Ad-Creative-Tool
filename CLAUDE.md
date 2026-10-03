# HitLights Ad Builder

Standalone web app (Node 22 + Python 3.11, Docker on Railway) that turns one Shopify product and a
short message into a brand-locked Meta image ad at 1080×1080, 1080×1920 and 1200×628, for HitLights
marketing (Danah).

**Start here: `docs/HANDOFF.md`.** It has the full status, configuration, local setup, decisions and
the ordered next steps. `README.md` covers how a set is made; `PLAN.md` has the history and current state.

## How it works (one paragraph)

All five templates are *composed*:
- Higgsfield renders **one scene photograph** per set (no text, logo or product);
- the app removes the product photo's background locally (`finishing/cutout.py`, approved once per
  photo by a person);
- the app lays out every size in headless Chromium from fixed template layouts (`composer/`), with
  the real logo, the exact copy in Montserrat, the gold CTA and the real product;
- layout checks run before any credits are spent;
- a scene check (vision LLM) and `core/gates.mjs` decide what is delivered (download + Google Drive).

## Rules

- Never edit `legacy/` or `finishing/finish.py` (byte-identical to v16; CI enforces it).
- Keep `tests/parity.test.mjs` green; intentional prompt changes go in its `DEVIATIONS`.
- **No paid Higgsfield renders without Danah's explicit approval.** Use the fake renderer
  (`npm run dev`, `RENDERER=fake`) and the tests.
- Never commit secrets, `.env`, tokens or run data. **The GitHub repo is public.**
- Work on branch `claude/hardening-15a789c`; small commits; wait for CI green before asking Danah to
  deploy (Railway: Deployments → Deploy Latest Commit; pushes don't auto-deploy).
- Paid renders are at-most-once: never add automatic resubmission of an unconfirmed render.

## Commands

```bash
PYTHON=.venv/bin/python npm run dev                 # local app, fake renderer, http://localhost:8080
PYTHON=.venv/bin/python node --test tests/*.test.mjs # Node tests (needs Chromium: npx playwright-core install chromium)
.venv/bin/python -m pytest -q tests                  # Python tests
```

## Working with Danah

She runs marketing at HitLights (D2C + B2B LED lighting). Be direct about what works and what's broken;
use skimmable tables and bold takeaways, and give ready-to-use steps. She deploys on Railway herself and
sends screenshots of results. Ask before assuming numbers or account details you haven't seen.
