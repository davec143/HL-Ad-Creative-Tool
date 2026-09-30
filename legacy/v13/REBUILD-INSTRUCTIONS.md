Category: Internal Tools / Marketing
Status: Handover pack — rebuilt for Version 13, Sept 30 2026. Replaces the Sept 16 pack, which is wrong in four material ways (see *What changed*).
Tags: Marketing / Ads / Meta / Artifacts / Ad Builder
Related: [[HitLights Ad Brand Kit]] · [[Andromeda Ad Creative Spec]] · [[EZDim Pro Ad Copy]]

# Rebuilding the HitLights Ad Builder

## What this is

An Artifact that turns one product image and a short message into a Meta image ad at all three Andromeda sizes — 1080×1080, 1080×1920 and 1200×628 — as **one image reflowed**, not three designs. It renders through Higgsfield, crops each file to exact size, stamps the real HitLights logo onto it, and files the set in Google Drive.

## Why a rebuild is ever needed

An Artifact that calls connectors is internal to the Claude organisation that owns it. It is never handed connector access through a public or anyone-with-the-link share, and never works for an account outside that organisation — no matter how correctly that person has the connectors set up. To run it on another account, it has to be **published from that account**.

Everything below rebuilds it byte for byte from `ad-builder.html`. Nothing is regenerated from a description, so nothing drifts.

---

## What changed since the Sept 16 pack

If you are working from the old document, these four things will bite:

**The capabilities manifest gained two entries.** `sandbox_exec` on Higgsfield, and a top-level `downloads`. Publishing with the old manifest produces a tool that generates renders and then fails at the finishing step.

**The tool now has five templates, not three.** They match the brand kit's numbering and are grouped by pillar in the picker.

**The logo is composited, not generated.** Prompts reserve an empty corner and forbid any wordmark; the real logo file is laid in afterwards during the crop. This is why `sandbox_exec` is in the manifest.

**There is no "contact line" field any more.** It is a support phone and a support email.

---

## Prerequisites on the target account

**Work in Cowork (the Claude desktop app) or Claude Code, not a plain claude.ai chat.** This is the one that silently wastes an hour. Artifacts created in ordinary chat run on a cut-down runtime with no connector access at all, so the rebuild hits exactly the wall it exists to escape.

**Higgsfield connected, with credit on that Higgsfield account.** Rendering bills there, not to the Claude subscription. Required — without it the tool cannot generate.

**Google Drive connected**, with write access to the shared *Claude + Higgsfield Ad Creatives* folder (owned by marketing@hitlights.com). Optional: without it the tool still generates and finishes the files, and offers them as downloads instead.

**Shopify connected to the HitLights store.** Optional — it powers catalog search and the live stock chips. Without it, paste a public image URL instead.

---

## The prompt — paste this verbatim

```
I'm attaching a finished HTML file called ad-builder.html. It is a working
internal tool — the HitLights Ad Builder — already built and tested on another
Claude account. I need it published as an Artifact on MY account so that it
runs against my own connectors.

Publish it exactly as it is. Do not redesign it, do not rewrite the copy, do
not improve the layout, and do not regenerate it from scratch. The brand
system, the prompt engineering and the error handling in that file are
deliberate and already correct.

Steps:

1. Read ad-builder.html in full.

2. Check the exact display names of my connected Higgsfield, Shopify and
   Google Drive connectors in this session. Near the top of the file's
   <script> block there is a line:

       var HF="Higgsfield", SH="Shopify", GD="Google Drive";

   If any of my three display names differs from those strings, edit that
   line AND the capabilities manifest in step 3 so they match my names
   exactly. If they already match, change nothing.

3. Publish the file with the Artifact tool, passing the file's path, and
   declare these capabilities:

   {"mcp":{"servers":[{"server":"Higgsfield","tools":["media_import_url","generate_image_batch","jobs_wait","sandbox_exec"]},{"server":"Shopify","tools":["search_products"]},{"server":"Google Drive","tools":["create_file"]}]},"sample":{},"downloads":true}

   Use favicon 🛠️ and title "HitLights Ad Builder".

4. The file deliberately has no doctype and no <html>, <head> or <body> tags —
   the Artifact tool supplies the page skeleton. Do not add them.

5. Leave the artifact private. Do not share it by public link: a page that
   declares connectors is refused connector access when shared that way,
   which is the exact problem this rebuild exists to solve.

6. Give me the URL when it's published.
```

---

## Three hardcoded values to check before you trust it

These are baked into the script and are not account-neutral.

**The logo URLs.** Lines beginning `var LOGO_WHITE=` and `var LOGO_BLACK=` point at two PNGs hosted under *this* Higgsfield account's media prefix (`.../user_39b7JrC2bsv1cMtGqDHJOpiQGAL/...`). They are publicly reachable, so another account can import them fine — but they are only as permanent as that media. **This is the most fragile thing in the tool.** If those files are ever purged, every run halts at the finishing step. Moving both lockups to a permanent host on hitlights.com and repointing these two lines is worth doing before this gets much more use.

**The Drive folder.** `var DRIVE_PARENT="1jTlV2izOOli81J9ZC-pXN-ZpYO0Wfh4L"` is the shared *Claude + Higgsfield Ad Creatives* folder. The rebuilding account needs write access to it, or this needs repointing.

**The logo-to-template map.** `var LOGO_FOR={collage:"white", bubble:"black", promo:"white", lifestyle:"black", spotlight:"white"}` — white lockup on dark grounds, black inside Template 2's white card and on Template 4's cream panel. Only change this if a template's ground changes.

---

## First run, and the error you will probably hit

Open the artifact and look at the top of the page before anything else.

**No banner** means connector access was granted. Search the catalog for `EZDim Pro`, pick an in-stock result, and press *Generate the three sizes*.

**A banner** now names its own cause. "Connectors are switched off by how this page is shared" means the publish did not carry the manifest — re-run step 3. "Higgsfield is not connected to your account" means the manifest is fine and the connector is missing or named differently — step 2 covers it.

**The one to expect: `consent_required`.** The renders succeed, then all three finishing steps fail with *"connector access isn't confirmed for this artifact right now"*. This is a permission prompt that was never answered — the page has not been allowed to use that connector yet, so the call never reached it. Reload the page, choose **Allow** when Claude asks about Higgsfield and Google Drive, then press **Finish these renders again**. That button reuses the renders you already paid for and costs no credits.

If the code in brackets says `approval_required` rather than `consent_required`, that is a different and more stubborn problem: org policy requires per-call approval for shell tools, which artifacts cannot do. In that case the crop-and-logo step has to move out of the artifact entirely — tell me and I will rework it.

Either way, **Build the prompt pack** under step 03 works with no connectors at all, so nobody is ever fully blocked.

---

## What a finished run produces

Three JPEGs at exactly 1080×1080, 1080×1920 and 1200×628, named after their dimensions, in a Drive folder named `YYYY-MM-DD Product Name`, each with the real logo composited in. They are also offered as save buttons on the page.

**The Higgsfield links in the Output panel are not deliverables.** They are raw renders with a deliberately empty logo corner. Only the finished files are publishable.

---

## Open items

**No real render has been through the reserved-space prompts yet.** The composite is verified in every position and colorway against existing renders, but whether the generator reliably leaves that corner empty is unproven. Check the first one; if a template crowds the corner, the reserved area needs widening for that template.

**Shopify's response shape is unverified in recent sessions.** The catalog search was built against a real call and has worked, but it has not been re-exercised lately.

**Two published copies do not sync.** When the brand kit or the spec changes, the file must be republished on both accounts from the same source. The source of truth is `ad-builder.html` in this folder; treat the published artifacts as builds of it.

The brand values in the file trace to `HitLights Ad Brand Kit.md` in `20_Areas/Marketing`, and the logo files to `Brand Assets/Logos/`. If those change, the `BRAND` object and the logo URLs are what need updating.
