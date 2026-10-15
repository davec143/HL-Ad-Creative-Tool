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

## October 14: scene layouts, reference templates and batches

The separate `/reference` template library is now generated from the same registry and compositor
as the builder. It includes all 11 templates, with 33 validated previews and direct template links.
The six October additions appear first. Run `npm run reference:build` after changing the registry,
layouts, preview inputs or renderer; CI rejects a stale generated library. Previews use schematic
room/product placeholders, without copying private reference imagery into this public repository.

The builder now offers all six supplied October reference families (T6–T11), each at three
placement sizes. Original T1–T5 prompt/finishing parity remains isolated from these composed-only
extensions. The reference artwork and validation gallery are kept outside this public repository.

Scene placement is explicit: reference layout, full background, or large photo panel. T3's default
now shows an unblurred full-room photo with a modest real product cutout. Full/panel modes preserve
substantial visible room area. T6's graphic default has no scene, no scene credit charge, and one
three-file set; choosing a photographic mode enables multi-set batches.

Batches contain one to five sequential sets, with a distinct scene brief for each and three files
per set. They persist child identities, request idempotency, planned credit reservations, progress,
and interruption state. Unknown paid submissions pause for a decision. Cancellation stops unused
work; accepted work is reconciled. Batch ZIPs include only deliverable files in Set-01 through
Set-05 folders. Product-cutout approval or replacement refreshes applicable finished siblings
without buying another scene, and remains bound to the reviewed cutout revision.

New regression suites cover batch admission, lost responses, cancellation, restart recovery,
credit reservations across days, sibling cutout changes, static graphic generation, and browser
response ownership. `tests/template-layouts.test.mjs` renders all 11 templates × three scene
choices × three sizes with real Chromium. Additional private checks measure visible scene pixels,
inspect 27 real-room/product compositions, and exercise a five-set browser workflow and ZIP hashes.

Scene checks screen defined defects, not overall design quality. Product review and failed-output
holds remain explicit. Provider/LLM/Drive fault injection uses test doubles; production verification
uses free previews and existing scenes instead of buying stress-test renders.

## October 15: six templates with real product photos

The T6–T11 validation matrix uses three original product photos (dimmer, COB strip and Luma5
strip), fresh transparent cutouts and three existing room photographs. All six templates are
composed for each product at 1080×1080, 1080×1920 and 1200×628: 54 JPEGs. T6 retains its intended
graphic background. Private source photos, cutout comparisons, output images and checksums remain
outside this public repository.

Real-photo inspection exposed remaining studio-white edge fragments, a narrow white sliver beside
the COB package and a thin studio-floor extension under the Luma5 reel. Cutout algorithm 5 removes
outside-connected backdrop pixels only with weak model support at the silhouette, or tightly
bounded small border components. Its bottom-extension rule requires a tiny tapered region with
broad product support above. Regression controls preserve a pale connector, an attached white
rail, white hardware, printed white packaging and genuine mounting openings. Source RGB remains
unchanged. Automatic cutouts from older algorithms refresh; approved and uploaded cutouts remain
unchanged.

Scene preparation algorithm 2 also removes tiny compressed near-white frames and their single-pixel
grey fringe. The narrow-frame pass is bounded to four pixels plus one fringe pixel, preserves broad
pale walls and unaccompanied grey edges, and retains the existing minimum image size. Older cached
preparation is upgraded from the paid original on free recomposition, invalidating checks and output
only when the scene pixels change. No paid scene resubmission is involved.

Verification includes actual Chromium composition, exact output dimensions, JPEG decoding, the
460,000-byte limit, source/cutout/output hashes, ZIP integrity, visual inspection of all 54 outputs,
and original/transparent/violet/dark cutout comparisons. The real-model transformation matrix is
rerun on algorithm 5; its scope remains the six transformations and three products described above.

## October 15: different templates within one batch

The builder defaults multi-set batches to Different templates and displays the planned design for
each set. Same template remains available for scene-only variation. A shared deterministic planner
selects distinct compatible templates, beginning with the selected design. It preserves the source
headline, CTA, contact details and visible supporting copy; proof lines may become a subheadline,
and a supplied promotional deadline remains visible in the target layout. Hidden stale fields are
excluded. Incompatible copy is never truncated or replaced with invented claims.

Each child persists its own form, template and credit estimate. Graphic layouts reserve zero scene
credits while photographic siblings reserve their actual estimate. Older manifests and retries keep
their original plans. Every child is preflighted in all three sizes before the first paid scene,
including when a later layout is tighter than the selected one. Cancellation, restart recovery,
ambiguous submissions and ready-only ZIP delivery retain their existing safeguards.

Free preview now covers every distinct planned template. Browser tests cover mode/count persistence,
stale multi-template previews, mixed graphic/photo authentication, exact request plans and child labels.
The independent compositor matrix checks all 11 starting templates × five planned designs × three
sizes (165 compositions) with real Chromium. Paid-provider tests use fakes; the interactive batch smoke
test reuses a verified product cutout and room photograph without purchasing new renders.
