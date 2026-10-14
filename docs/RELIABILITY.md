# Reliability verification — October 13, 2026

The reported transparent packaging defect was reproduced beyond the original photo. Algorithm 4
preserves white printed packaging under smaller image sizes, JPEG compression and neutral/warm
studio backgrounds while preserving model-confirmed physical openings. Only alpha changes;
decoded source RGB is unchanged. Approved and uploaded cutouts remain preserved on upgrades.

## Reproduced faults now covered by regressions

- A burst of 32 Generate requests could all pass the busy check. Admission is reserved before
  waiting for the provider; exactly one set is created.
- Busy approvals/overrides and shutdown actions could persist changes before rejecting the
  request. Availability is checked before saved state changes.
- Restart recovery missed interrupted sets older than the latest 50 and could stop recovering
  other sets when one had an unresolved submission. Every unfinished set is considered, while
  ambiguous paid submissions still require a decision.
- A concurrent cutout replacement could combine metadata from one revision with pixels from
  another. Preview and run composition now consume immutable bytes captured under the source lock.
- Recomposition could duplicate Drive files, and interrupted uploads could match stale files by
  name alone. Known run/version/folder files are updated in place; lost responses are reconciled
  by checksum. An unresolved write prevents reuse of an older remembered checksum, including
  when output changes from A to B and back to A.
- Delayed polls, Generate responses, previews, catalog searches and drafts could overwrite a
  newer selection or edit. Responses are applied only to the state that requested them.
- Selecting a variant without its own image retained the preceding variant's photo. It now uses
  the product's default photo. Invalidating a pasted URL clears its former selection.
- Template 3 could accept a scene image that failed to decode. All scene image elements are
  checked. Valid second-line-only headlines now agree with form validation; offer templates
  still require their offer and deadline.
- Download size checks occurred only after buffering the response. Source photos stop at 15 MiB
  and renders at 64 MiB while streaming, even with missing or false Content-Length. Rejected and
  redirected response bodies are cancelled.

## Verification

```sh
PYTHON=.venv/bin/python node --test tests/*.test.mjs
.venv/bin/python -m pytest -q tests
```

New focused suites: `tests/stress-pipeline.test.mjs`, `tests/stress-render.test.mjs`,
`tests/web-state.test.mjs`, `tests/download.test.mjs`, `tests/test_cutout_stress.py`.

The extended local verification also exercised three real product photos across all five
templates and three sizes (45 JPEGs), narrow/wide/square synthetic product shapes, concurrent
composition, invalid image/copy inputs, Chromium termination/reconnection and resource cleanup.
All 45 real-product JPEGs had the correct dimensions and were below 460,000 bytes; the largest was
397,670 bytes. Real-photo test assets and run data remain outside this public repository.

The cutout matrix covers 18 actual model predictions: three products × native resolution, 50%,
25%, JPEG quality 40, neutral studio white and warm studio white. It checks 138 product/background
landmarks and unchanged RGB. Four cases failed the prior algorithm. New synthetic regressions also
cover mounting holes and a clear centered reel opening versus printed round artwork.

CI runs Node tests with real Chromium, Python tests on 3.11 and 3.12, the legacy parity checks,
dependency audit, production Docker build, readiness, authentication refusal and non-root checks.
Stress tests use fake paid-render/LLM/Drive providers. No automatic retry of an ambiguous paid
render was introduced. Production smoke tests reuse existing scenes at zero Higgsfield credits.

## Scope of the evidence

These tests establish behavior for the fixtures, transformations and failures exercised. They do
not prove arbitrary-image segmentation or external-service availability. White objects with no
visible boundary and ambiguous printed/open regions still need the intended one-time visual
review; low-resolution antialiased edge pixels may remain. Failed or uncertain output continues
to be held for review rather than silently delivered.

Drive's in-place media update follows the documented
[files.update API](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/update).
