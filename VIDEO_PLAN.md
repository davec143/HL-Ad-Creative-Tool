# Video ads — implementation plan (not started)

**Status:** plan only. No video code exists. Start only after the image pipeline's live acceptance test (PLAN.md, Phase 6) passes and the hardening in this branch has run in production.

Every platform number below is a **starting assumption to re-verify at build time** against Meta's current ad specs and Higgsfield's model catalog. Both change.

## 1. Scope and principles

- **A separate pipeline** (`server/video/`), its own run type, attempt kinds and caps. It shares only:
  - the attempt ledger (at-most-once paid submissions, ambiguous → human decision);
  - delivery gates;
  - auth;
  - storage;
  - observability.
- **The generator never draws brand-controlled elements.** Logo, text, CTA, captions and end card are overlaid locally and deterministically (ADR 0001 approach, applied per frame or as an overlay track).
- **Placement variants vs creative variants** as defined in `docs/CREATIVE_DIVERSITY.md`. The first release: one concept, placement variants only.

## 2. Formats

| Placement | Aspect | Frame | Notes |
|---|---|---|---|
| Reels / Stories | 9:16 | 1080×1920 | Primary. Keep text, CTA and logo out of the top ~14% and bottom ~20–35% (UI overlays); verify current safe zones |
| Feed | 1:1 (consider 4:5) | 1080×1080 | 4:5 is out of scope for images by decision; revisit for video |
| Landscape | 16:9 | 1920×1080 | Lower priority (in-stream, Audience Network) |

- **Durations:** 6 s, 10 s and 15 s cuts from one master. Generator clip lengths are model-dependent (typically 5–10 s), so longer cuts are assembled from several clips or a held end card.
- **Encoding target:** H.264 High, yuv420p, 30 fps (or the source frame rate if it's 24/25), AAC 128–192 kbps 48 kHz stereo, MP4 with faststart. Bitrate is set to land well under Meta's file-size limit (verify; aim for ≤ 30 MB for 15 s).
- **Validation (ffprobe), as finished-image checks do now:** exact resolution, frame rate, duration ±0.1 s, codec and profile, pixel format, audio present or explicitly absent, file size, and moov atom at the front. A failed check holds the file.

## 3. Provider and model validation (spike, with an approval-gated credit budget)

- Use Higgsfield `models_explore` to list the video models currently offered on the subscription. For each candidate record:
  - cost per second / per clip;
  - supported durations and aspect ratios;
  - image-to-video support with a **product reference image**;
  - start/end frame control;
  - typical render time;
  - failure modes.
- **Spike test:** 3 products × 2 candidate models × 9:16 at 5 s. Score product fidelity, motion artefacts, and whether the product stays recognisable.
- Pick one default model plus one fallback, behind the `VideoRenderer` interface (same submit / wait / findCandidates contract as images).

## 4. Product fidelity

- Image-to-video from the **approved finished square** (or the product cutout, ADR 0003) as the first frame, so the product starts exact.
- Sample frames (first, 25%, 50%, 75%, last) and run the existing fidelity check per frame against the product photo. Any `fail` → held. `uncertain` → human approval with the frames shown.
- Prefer motion that doesn't rotate the product past angles visible in the reference (camera push-in, light sweep, environment motion).

## 5. Overlays, captions, end card (deterministic, local)

- Rendered with ffmpeg plus pre-rendered PNG/SVG layers from the brand-layer templates:
  - logo (fixed grid per ratio);
  - headline beats;
  - CTA pill;
  - contact line;
  - the end card (last 1.5–2 s): logo, CTA, URL or phone.
- **Captions.** Burned-in, plus a sidecar `.srt` for platforms that support it. The text comes only from approved copy; no speech-to-text in v1.
- **Safe zones** are enforced per ratio; a layout test fails if any overlay box intersects a UI zone.

## 6. Audio, music and voice rights

- **v1: no voice.** Music only from a licensed library with a written licence that covers paid social. Store the licence ID and track hash per run. Default to silent plus captions if none is configured.
- Generated music or voice (including Higgsfield audio models) only after a written review of the provider's commercial-use terms, recorded in `docs/`.
- Loudness normalised to about −14 LUFS integrated; true peak ≤ −1 dBTP (verify against current platform guidance).

## 7. Thumbnails

- Extract the frame at 0 s and at the strongest product frame. Composite the logo and CTA deterministically. Export JPEG ≤ 460 KB at the placement size, using the same finishing checks as images.

## 8. Moderation and policy

- Before delivery: provider moderation result (if returned), plus a vision check on the sampled frames for prohibited content, unexpected people or faces when "no people" was requested, and third-party logos or brands.
- Never generate real people's likenesses. Any person in frame must be clearly synthetic or explicitly approved.

## 9. Credits, time and recovery

- **Caps** `MAX_VIDEO_CREDITS_PER_RUN` and `MAX_VIDEO_CREDITS_PER_DAY`, with the same reservation semantics as images (reserved / spent / released; ambiguous stays reserved).
- **Forecast before submission:** clips × cost per clip, plus a worst case for one regeneration per clip. Refuse if it doesn't fit both caps and the live balance.
- **Timeouts.** A per-model render timeout (default 15 min). A timeout after a job ID was saved means Resume waits for the same job. **Cancel** calls the provider's cancel if one is documented; otherwise the job is marked abandoned, its credits counted as spent.
- **Resumability.** Every step is persisted: attempts, downloaded clips, assembled master, encodes and overlays. Re-encoding and overlays are free and repeatable.

## 10. QA and human approval

- **Automated:** ffprobe validation, overlay layout test, frame-sampled fidelity, text check on the end card and caption frames, moderation.
- **Human approval is always required for video** in v1: a reviewer watches each placement file before any delivery. The approval (who, when, version) is recorded. Auto-delivery is off for video.

## 11. Tests and acceptance matrix

- **Unit tests:** caption timing, safe-zone geometry, encode argument builder, ffprobe parser.
- **Integration (fake video renderer):** short synthetic clips generated locally with ffmpeg, crash injection around submissions (the same cases as `tests/render-safety.test.mjs`), resume after an encode crash, Drive idempotency.
- **Golden checks:** the overlay frame at fixed timestamps compared with committed PNGs.
- **Acceptance** (approval-gated credit budget): 3 products × 3 templates × 9:16 15 s, plus 1:1 for one product. Pass criteria:
  - 100% of delivered files pass validation;
  - no product-fidelity failures delivered;
  - no text errors (the text is deterministic);
  - human approval recorded on each file.

## 12. Out of scope for v1

UGC-style talking heads; voice-over; dynamic product catalogue video; automatic uploads to Ads Manager.
