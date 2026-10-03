# ADR 0001: Deterministic brand composition (AI scene + locally rendered brand layer)

- **Status:** Accepted and implemented for Template 1 (Oct 2026: `composer/`). Montserrat is bundled under the SIL Open Font License (`@fontsource/montserrat`). T2–T5 still use the prompt-driven pipeline until each is ported.
- **Date:** 2026-10-02
- **Deciders:** Marketing (owner), engineering

## Context

Today the image generator draws almost everything: the headline, proof points, CTA pill, speech bubble, panels, gradients and dot grid. The app adds only the logo and corrects two colours (`finish.py`). As a result:

| Problem | Today's mitigation | Residual risk |
|---|---|---|
| Misspelled or garbled text | Copy limits; text & logo QA (vision model) | QA can miss errors. Every miss is a paid re-render |
| Off-brand type (font, weight, kerning) | Prompt wording | Not checked at all |
| CTA wrong shape or colour | NOCTA / CTACOLOR detection; gold lock | Shape isn't checked |
| Inconsistency across the three sizes | Derived sizes rendered from the master | Typography still drifts between sizes |
| Copy change after approval | None | A copy change means a new paid render |

v16 parity (`tests/parity.test.mjs`) locks in today's prompt-driven design. This ADR describes how to move away from it deliberately.

## Decision (proposed)

Split each ad into two layers:

1. **Scene layer (paid, Higgsfield).** The photograph, product treatment, lighting and background, with **no text, CTA, panels or logo**. Rendered once per concept and size, and stored.
2. **Brand layer (free, local, deterministic).** Rendered by the app on top of the scene from a versioned template:
   - logo;
   - headline, subheadline, proof, deadline and contact text;
   - CTA pill, its text and arrow;
   - speech bubble and brand panels;
   - gradients, dot grids and other decorations.

## Template schema (sketch)

```jsonc
{
  "id": "t1", "version": "2.0.0",
  "sizes": {
    "1080x1080": {
      "safe": { "top": 0, "bottom": 0, "left": 64, "right": 64 },
      "scene": { "x": 486, "y": 360, "w": 540, "h": 560, "radius": 24 },   // where the AI scene sits / is masked
      "layers": [
        { "type": "rect", "fill": "#523875", "x": 0, "y": 0, "w": 1080, "h": 1080 },
        { "type": "dotgrid", "colour": "#FBCA10", "opacity": 0.5, "anchor": "bottom-left", "cols": 9, "rows": 6, "gap": 22, "r": 3 },
        { "type": "logo", "lockup": "white", "x": 64, "y": 64, "w": 280 },
        { "type": "text", "field": "h1", "font": "Montserrat-ExtraBold", "size": 64, "min": 48, "colour": "#FBCA10",
          "box": { "x": 64, "y": 150, "w": 400, "h": 160 }, "wrap": "balance", "maxLines": 2, "overflow": "shrink-then-fail" },
        { "type": "pill", "field": "cta", "fill": "#EBA800", "text": "#232323", "font": "Montserrat-ExtraBold", "size": 34,
          "box": { "cx": 540, "y": 950, "h": 84, "minW": 300 }, "shadow": true }
      ]
    }
  }
}
```

**Properties:**
- **Per-ratio constraints.** Every size has its own layout, safe zones (9:16 top 14% and bottom 20%) and overflow rules. Text that doesn't fit at the minimum size **fails before anything is rendered**, rather than being squeezed.
- **Versioned and recorded.** Templates are versioned; each finished file records the template version and the hashes of every asset (fonts, logos, the scene image) used to make it.

## Implementation options

| Option | Pros | Cons |
|---|---|---|
| **Pillow (Python)**, extending `finishing/` | Already in the stack and tested; precise pixel control | Text shaping is basic: kerning needs `libraqm`, which must be confirmed in the container |
| **SVG → raster** (resvg) | Declarative; good typography; the same template can preview in the browser | Adds a native dependency; font loading must be pinned |
| **Canvas** (node-canvas / skia-canvas) | Same API in browser and server | Native build in Docker; Cairo vs Skia differences |

**Recommendation:** resvg for rendering. SVG templates are easy to review and diff, and resvg gives deterministic output when fonts are pinned. Pillow stays responsible for the final crop, colour checks and JPEG encoding.

## Fonts and assets

- Commit the exact **Montserrat** files used (static OTF/TTF, the weights in use) and **Source Sans 3** if it's needed, with their **SIL Open Font License 1.1** text in `assets/fonts/LICENSE`. Record file hashes in `assets/fonts/SHA256SUMS` and check them in the startup self-check, as for logos.
- Use no system fonts. Rendering fails if a font can't be loaded.

## Testing

- **Golden images.** For each template × size × fixture copy, the rendered brand layer over a fixed fixture scene must match committed golden PNGs. The comparison is exact pixels, or a tolerance documented per renderer version.
- **Layout tests.** Text boxes stay inside safe zones; nothing overlaps the logo clear space; the longest allowed copy fits; over-length copy is refused.
- **Parity.** v16 prompt parity remains the test for the **v16 pipeline only**. The new pipeline has its own prompts ("scene only: no text, no logo, no CTA"), tested by snapshot.

## Migration

1. A feature flag (`COMPOSITION=v16|deterministic`) selects the pipeline per set, default `v16`. Runs record which pipeline produced them.
2. Templates migrate one at a time, starting with T1 (flat violet field, simplest) and ending with T2 (speech bubble over a photo).
3. Acceptance per template means side-by-side review by Marketing of 10 real sets, all golden tests green, and no increase in held rate.
4. **Rollback** is flipping the flag back. Both pipelines share the attempt ledger, finishing checks, gates and delivery, so rolling back changes nothing else.

## Payoffs

- **Re-use without paying again.** The raw scene for each size is stored with its job ID. Changing the headline, CTA, offer or contact details later is a **free local re-composite**: no Higgsfield credits, no new attempt.
- **Text accuracy.** The text can't be misspelled because it isn't generated. The text check becomes a pure layout check, and vision QA only has to verify the scene, i.e. product fidelity.
- **Consistency.** The same fonts, sizes and positions appear in every size by construction.

## Preconditions (blocking)

- Confirmation of the exact brand fonts and weights, plus licence files committed.
- Final template measurements per size from the template library (`reference/HitLights_Ad_Templates.html`) and the approved reference ads.
- Marketing sign-off on whether v16's "AI-integrated typography" look must be preserved or may change.
