# HitLights Ad Builder — Rebuild Kit

Rebuild the HitLights Ad Builder on any Claude account, exactly as it runs today (builder v16, published Sept 25, 2026).

**The short version:** connect three connectors on the new account, change two lines in the page, then ask Claude to publish the page with the capability block below. Allow about 20 minutes plus one test set (6 Higgsfield credits).

---

## 1. What's in this kit

| File | What it is | Do you need it? |
|---|---|---|
| `HitLights-Ad-Builder.html` | The complete builder: one self-contained page, ready to publish. | **Yes.** This is the tool. |
| `REBUILD.md` | This guide. | Yes |
| `reference/HitLights Ad Templates.html` | The brand-kit reference: 5 templates × 3 sizes with the Logo Grid. It's the same file the builder's *Download* button produces. | Optional (for the vault) |
| `source/b_head.html` | Page HTML and CSS | Only to edit the tool |
| `source/b_script.js` | All page logic: prompts, Logo Grid, pipeline, QA, Drive, run log, brand kit | Only to edit the tool |
| `source/b_tail.html` | Closing tags | Only to edit the tool |
| `source/finish.py` | The finishing script that runs in the Higgsfield sandbox (logo, colour lock, flags). Readable copy. | Only to edit the tool |
| `source/mk_logos.py` | Builds the three logo files in the sandbox from the Shopify CDN lockups | Only to edit the tool |
| `source/assemble.py` | Rebuilds `HitLights-Ad-Builder.html` from the source files | Only to edit the tool |

You don't need the `source/` folder to rebuild the tool. It's there so the tool can be maintained.

---

## 2. Before you start (on the NEW account)

| Requirement | Why | How to check |
|---|---|---|
| A Claude plan with artifacts and connectors | The builder is a published artifact that calls connectors | You can publish an artifact from a chat |
| **Higgsfield** connector, signed in, **with credits** | Renders the images and runs the finishing sandbox. **Required.** | claude.ai → Settings → Connectors |
| **Shopify** connector, on the HitLights store | Product search and product photos. Optional: without it, paste an image URL instead. | Same place |
| **Google Drive** connector | Saves finished sets to a Drive folder. Optional: without it, files still download from the page. | Same place |

**Connector names must match exactly.** The page looks for connectors named `Higgsfield`, `Shopify` and `Google Drive`. If one shows a different name on the new account (for example `Google Drive (Work)`), see §6, Troubleshooting.

**Costs:**

| Action | Cost |
|---|---|
| One render (Nano Banana Pro, 2K) | 2 Higgsfield credits |
| One full set (square + portrait + landscape) | 6 credits |
| Regenerate one size | 2 credits |
| Blank-patch repaint (automatic, at most once per file) | 2 credits |
| QA check and "Write it for me" drafting | Claude usage on the account running the page (no Higgsfield credits) |
| Finishing (crop, colour lock, logo) | Free (Higgsfield sandbox) |

---

## 3. Change the two account-specific lines

Open `HitLights-Ad-Builder.html` in any text editor and use find-and-replace. **Nothing else in the file is tied to an account.**

### 3a. Google Drive folder (where finished sets are saved)

Find:
```
DRIVE_PARENT="1jTlV2izOOli81J9ZC-pXN-ZpYO0Wfh4L"
```
- **Same Google account, or the folder is shared with the new account's Google login:** leave it as is.
- **Different Drive:** create a folder (the current one is named *Claude + Higgsfield Ad Creatives*) and open it. The ID is the last part of the URL, `drive.google.com/drive/folders/<THIS PART>`. Paste it between the quotes.

Each run creates a sub-folder named `YYYY-MM-DD <product name>` inside it.

### 3b. The page's own link (skip on the first publish)

Find:
```
LIVE_URL="https://claude.ai/artifact/4FxPbojAkC1vmdpvwTDqv4"
```
This link only appears when someone opens a downloaded copy of the file: the page then shows *"Open the live Ad Builder"*. Publish first (§4), copy the new artifact's link, paste it here, then republish (§4, step 5). If you skip this, the button points at the original account's builder, which the new account can't open. Nothing else breaks.

---

## 4. Publish it

1. In a Claude chat on the new account, attach `HitLights-Ad-Builder.html`.
2. Paste this prompt exactly:

```
Publish the attached HitLights-Ad-Builder.html as an artifact, unchanged. Read the whole file first.
Title: HitLights Ad Builder. Icon: image. Use contract "latest".
Declare exactly these capabilities:

{
  "mcp": {"servers": [
    {"server": "Higgsfield",   "tools": ["media_import_url", "generate_image_batch", "jobs_wait", "sandbox_exec", "balance"]},
    {"server": "Shopify",      "tools": ["search_products"]},
    {"server": "Google Drive", "tools": ["create_file"]}
  ]},
  "sample": {},
  "downloads": true,
  "db": {}
}

Do not edit, reformat, or "improve" the page. After publishing, list the "runs" collection of the
artifact's database once to confirm it is reachable (it will be empty).
```

3. Open the published page. On first use Claude asks you to allow each connector, Claude access ("sample"), downloads and the database. Allow all of them.
4. Copy the page's link.
5. Do §3b (paste the link into `LIVE_URL`), then in the **same chat**: *"Republish the attached file to the same artifact, same capabilities."*

**What each capability does:**

| Capability | Used for |
|---|---|
| `mcp` → Higgsfield | Import the product photo, render the three sizes, run finishing in the sandbox, show your credit balance |
| `mcp` → Shopify | Search the catalog (active products only), read the featured image, stock and SKU |
| `mcp` → Google Drive | Create the dated folder and upload the three JPEGs |
| `sample` | "Write it for me" copy drafting, and the QA check that reads each finished image against the copy |
| `downloads` | Download buttons on each finished file and the Brand kit download |
| `db` | The "Recent sets" run log (date, product, template, per-size flags, QA result, Drive link) |

**Sharing:** a page that calls connectors can only be used by signed-in members of the Claude organisation that owns it. Every runner needs their own Higgsfield connector and credits. It won't work through a public link.

---

## 5. Acceptance test (do this once after publishing)

Use one in-stock product (for example **EZDim 12V LED Dimmer Driver 40W**).

1. **Banner check:** open the page. No red or amber banner means all three connectors were found. Under the Generate button you should see *"A set uses 6 Higgsfield credits (3 renders × 2)… Balance: …"*.
2. **Product:** search "EZDim" and pick a result. A green stock chip means it's in stock.
3. **Template 1**, keep the sample copy, press **Generate the three sizes**. It takes about 3–5 minutes.
4. **Check the log.** It should show:
   - `white logo at (64,64) w280` for 1080×1080
   - `(64,288) w320` for 1080×1920
   - `(56,48) w240` for 1200×628
5. **Check the output.** You get three cards with images, a Download button on each, and "Text & logo check" results. If Drive is on, a Drive folder link appears.
6. The **Recent sets** table shows the run.
7. Repeat for Templates 2–5 when you want full acceptance (≈30 credits). The expected logo positions are in the table in §7.

**If step 4 says "The HitLights logos couldn't be prepared in the Higgsfield sandbox":** see Troubleshooting.

---

## 6. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Banner: "Connectors are switched off by how this page is shared" | Opened through a public link, or by an account outside the org | Open it signed in as an org member, from the owner's share |
| Banner: "Higgsfield is not connected" | Connector missing on this account | Settings → Connectors → add Higgsfield, then press *Check again* |
| A connector is connected but the page says it isn't | Its display name differs from `Higgsfield` / `Shopify` / `Google Drive` | Tell Claude: *"In the page, change the connector name 'Google Drive' to '<exact name>' in both the page constant and the capability declaration, then republish."* The constants are `var HF="Higgsfield", SH="Shopify"` and `var GD="Google Drive"`. |
| "The HitLights logos couldn't be prepared in the Higgsfield sandbox" | The Shopify CDN logo files moved, or the sandbox can't reach cdn.shopify.com | Check both logo URLs in §8 open in a browser. If HitLights replaced them, update `LOGO_URL` in the page with the new public PNG links (white and black lockups, same shape) and republish. |
| Higgsfield error mentioning base64 or "bring the file in by its URL" | Someone edited the page to send image data inside a sandbox command | Restore this kit's file. Never paste logos or scripts into commands as base64. Higgsfield refuses them. |
| "Still rendering after about seven minutes" | Higgsfield queue | Wait, then run it again. Credits are only spent on renders that started. |
| A file is marked **Held back from Drive** | A blocking flag (see §7) | Press Regenerate on that size (2 credits), or "Save to Drive anyway" if you've checked it |
| Drive save fails | Folder ID wrong or not shared with this Google login | Fix `DRIVE_PARENT` (§3a) and republish |
| Shopify search returns nothing | Different store connected, or product not active | The search only returns `status:active` products. Use the URL tab for anything else. |
| "Write it for me" is missing | `sample` not allowed | Reload and allow Claude access when asked |

---

## 7. How the tool works (reference)

**Pipeline, per run:**
1. Import the product image to Higgsfield.
2. Render the **1:1 master** from the product photo and the template prompt.
3. Render the **9:16 and 16:9** from the master plus the product photo. They're one ad at three sizes, not three designs.
4. **Finishing** in the Higgsfield sandbox (`finish.py`):
   - crop to exactly 1080×1080 / 1080×1920 / 1200×628
   - lock the brand field colour
   - find the gold CTA and lock it to #EBA800
   - check the logo zone
   - composite the real logo at its fixed grid position
   - export JPEG ≤ 460 KB
5. **Repaint** a blank placeholder patch once, if one was drawn where the logo goes.
6. **QA:** Claude reads each finished image against the typed copy and logo rules.
7. **Drive:** create a dated folder and upload the files that passed. Flagged files are held back.
8. **Log** the run to "Recent sets".

**Logo Grid:** pixel top-left of the logo on the finished file.

| Template | Colourway | 1080×1080 (w 280) | 1080×1920 (w 320) | 1200×628 (w 240) |
|---|---|---|---|---|
| T1 Collage Hero | White | 64, 64 | 64, 288 | 56, 48 |
| T2 Speech-Bubble Hero | Violet #55426A, centred in the bubble top | 400, 88 | 380, 309 | 216, 72 |
| T3 Discount Deadline | White | 64, 64 | 64, 288 | 56, 48 |
| T4 Styled Room Hero | White + soft shadow | 64, 64 | 64, 288 | 56, 48 |
| T5 Glow Room Hero | White + soft shadow (top-right on 1200×628) | 400, 64 | 380, 288 | 904, 48 |

The 9:16 logo always sits below the Stories/Reels header (top 14% = 269 px).

**Flags:**

| Flag | Meaning | Held back from Drive? |
|---|---|---|
| COLLISION | Artwork or text inside the logo zone | **Yes** |
| PLACEHOLDER | Blank patch still behind the logo after one repaint | **Yes** |
| SAFEZONE | 9:16 logo in the top 14% | **Yes** |
| NOCTA | No gold CTA button found | **Yes** |
| CTACOLOR | CTA too far off #EBA800 to correct | **Yes** |
| TEXT | QA found wrong or garbled wording | **Yes** |
| CONTRAST | The fixed colourway was illegible, so the other lockup was used | No (check it) |
| BUBBLE? | T2 speech bubble not found; logo at grid default | No (check it) |
| FIELDCOLOR | Brand ground off palette (e.g. T3 drifting warm) | No (check it) |

**Copy limits (characters; CTA in words):**

| Template | Line 1 | Line 2 | Other | CTA |
|---|---|---|---|---|
| T1 | 24 | 24 | proof points 28 each | 22 chars, 2–4 words |
| T2 | 24 | 24 | proof points 20 each | 20 chars, 2–3 words |
| T3 | 12 (offer) | 32 | deadline 32 | 16 chars, 2–3 words |
| T4 | 22 | 22 | proof points 28 each | 20 chars, 2–4 words |
| T5 | 14 | 16 | subheadline 60, 5–8 words | 22 chars, 2–3 words |

Both headline lines together: 40 characters max on T1, T2 and T4, and 26 on T5.

**Palette:**
- Purple deep #523875
- Purple #675185
- Logo violet #55426A
- Gold (CTA) #EBA800
- Gold bright #FBCA10
- Ink #232323
- Cream #FBF6EE
- T3 ground #241A30 → #120C18

**Andromeda sizes only:** 1080×1080, 1080×1920 and 1200×628. There is no 4:5 by decision. Reels are out of scope for now.

---

## 8. External dependencies

| Dependency | Value | Notes |
|---|---|---|
| White lockup | `https://cdn.shopify.com/s/files/1/2097/6403/files/Logo_White_HitLights_R.png?v=1614820672` | Public, 1179×166, with ® |
| Black lockup | `https://cdn.shopify.com/s/files/1/2097/6403/files/Logo_Black_HitLights_Rs_1e65dd71-06e3-4435-aca2-1728dd559b58.png?v=1614820450` | Public, 1179×166, with ® |
| Violet lockup | Built in the sandbox: the black lockup's shape in #55426A | No file needed |
| Image model | Higgsfield `nano_banana_pro`, 2K, `use_unlim: false` | Always spends credits, never an unlimited plan |
| Fonts | Google Fonts: Montserrat, Source Sans 3, JetBrains Mono | Page UI only |
| Runtime | Artifact contract 0.2.58 ("latest" as of Sept 25, 2026) | |

---

## 9. Editing the tool later

1. Edit the files in `source/`: `b_script.js` for logic and prompts, `finish.py` for finishing, `b_head.html` for layout and styles.
2. Rebuild: `cd source && python3 assemble.py` (needs Python 3 with `numpy` and `Pillow`). This writes `../HitLights-Ad-Builder.html`.
   - It embeds `finish.py` and `mk_logos.py` into the page as plain text.
   - It regenerates the on-page violet logo.
   - It refuses to build if any base64 sandbox path sneaks back in.
3. Republish the rebuilt file to the same artifact (§4, step 5 wording).
4. If you changed the Logo Grid or templates, press **Download the brand-kit reference (.html)** in the page's Brand kit card and replace `HitLights Ad Templates.html` in the vault. The kit renders from the same table, so the two can't drift.

**Rules that keep it reliable:**
- The image generator never draws the logo. It leaves the zone clear, and the real lockup is composited afterward.
- The logo position is fixed per template and size. Problems are flagged, and the logo is never moved to find space.
- Nothing is sent to the Higgsfield sandbox as base64. Logos come by URL, and scripts go in as plain text.

---

*Built Sept 25, 2026 · HitLights internal · Source matches live builder v16 byte-for-byte.*
