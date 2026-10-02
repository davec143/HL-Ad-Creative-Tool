# ADR 0003: Deterministic product cutouts over AI scenes

- **Status:** Investigation. The current gate is a vision-model fidelity check with human approval for "uncertain" (Phase 6).
- **Date:** 2026-10-02

## Context

The generator re-draws the product from a reference photo. It can change the number of connectors, the shape, the colour or the markings. The fidelity check catches many of these errors, but a vision model **can't guarantee** exact product accuracy, and every failure costs a paid re-render.

## Proposal

Never let the generator draw the product.

1. **Cutout.** A background-removed PNG per product/variant, made once and reviewed by a person. It comes from the Shopify photo, either via a background-removal step or a supplied studio cutout, and is stored with its hash.
2. **Scene.** Higgsfield renders the scene with an explicit empty "product zone" per template and size, or with a placeholder that is masked out.
3. **Composite locally** with the brand layer (ADR 0001): placement, scale, a contact shadow and a light colour-match to the scene. Never alter the product's pixels beyond scaling.

## Trade-offs

| | AI-redrawn product (today) | Cutout composite |
|---|---|---|
| Hardware accuracy | Probabilistic, checked by a vision model | Exact by construction |
| Realism (lighting and integration) | High | Needs shadow and colour-match work; can look "pasted" |
| Hands holding the product, "in use" shots | Possible | Hard: needs a pose-matched cutout or a separate approach |
| Cost per change | Paid re-render | Free re-composite |

## Next steps

1. Prototype on T1 (inset photo + product cutout); its layout already shows a cutout overlapping the photo.
2. Measure Marketing's acceptance against current outputs on 10 products.
3. If adopted, the fidelity check becomes a cheap "is the cutout visible and unobstructed" check.
