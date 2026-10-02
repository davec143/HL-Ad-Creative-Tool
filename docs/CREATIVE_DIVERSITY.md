# Placement variants vs creative variants (and a 3×3 proposal)

## Terminology

**Andromeda** is Meta's ad-retrieval system: the machine-learning stage that picks which ads are candidates for each person. It is **not** a file specification. Nothing about Andromeda requires three sizes. Earlier versions of this tool described its three outputs as "the Andromeda spec"; that wording has been removed.

| Term | What it is | What this tool makes today |
|---|---|---|
| **Placement variants** | One concept adapted to different aspect ratios so it fits each placement (Feed, Stories/Reels, right column, Audience Network) | ✅ Yes: 1080×1080, 1080×1920 and 1200×628 from one square master |
| **Creative variants** | Genuinely different concepts: different hooks, scenes, visual treatments, value propositions | ❌ Not yet: one concept per set |

What Meta's guidance on retrieval-era delivery rewards is **creative diversity**: distinct concepts that let the system find different audiences. Three resizes of one image are a single concept; they help placement coverage, not diversity.

## Proposal: 3 concepts × 3 placements

**Do not build this until** paid-render safety (Phase 1) and delivery gates (Phase 2) have run cleanly in production. Both are now implemented and covered by tests, but not yet live-tested.

### Model
- **Concept:** `{conceptId, productId, variantId, templateId, templateVersion, hook, scene, copy}`. Each concept is a set as it exists today (three placement sizes).
- **Hook categories**, one per concept, chosen so the three differ:

| Hook | Angle | Natural template |
|---|---|---|
| benefit | What it does for you | T1, T4 |
| proof | Certifications, warranty, specs (only those in the product data) | T1, T2 |
| urgency | A real, approved offer or deadline | T3 |
| lifestyle | The room, the mood | T4, T5 |
| trade | Install speed, code compliance, the job site | T2, T5 |

- **Matrix:** a "batch" is three concepts (different hooks, and ideally different templates) × three placements = **9 finished files, 9 renders**.

### Credit forecasting (strict)
- Show the forecast **before** anything is submitted:
  - 9 renders × `CREDITS_PER_RENDER` (an estimate);
  - plus a worst case for repaints, one per placeholder flag, at most 9.
- Require the batch's worst case to fit **both** the per-batch cap and today's remaining daily cap, counting reservations. Otherwise refuse up front.
- Submit concept by concept, each through the existing attempt ledger. Any ambiguous attempt stops the whole batch for a decision, exactly as for a single set.

### Attribution once assets are in Ads Manager
- Encode IDs in file names and the Drive folder: `<date> <product> / C1-benefit-T1v2 / 1080x1080.jpg`.
- Record `conceptId`, `hook`, `templateId@version` and `variantId` in a manifest (`manifest.json`) uploaded with each batch, for joining with Ads Manager exports (ad name convention: `HL|<conceptId>|<hook>|<size>`).
- Report per hook and template in a later phase (Supermetrics / GA4 join), not in this tool.

### Not in scope
- Automatic hook generation without human review.
- Generating more than 3 concepts per batch.
- Any spend-driven automation.
