// HitLights brand system, Logo Grid and template library for the Ad Builder.
// Extracted verbatim from builder v16 (legacy/v16/source/b_script.js) by tools/extract-brand.cjs.
// This file is now the source of truth. Any change here must keep tests/parity.test.mjs green
// (or be added there as a documented deviation) and must match reference/HitLights_Ad_Templates.html.

export const BRAND = {
  "purpleDeep": "#523875",
  "purple": "#675185",
  "gold": "#EBA800",
  "goldBright": "#FBCA10",
  "ink": "#232323",
  "cream": "#FBF6EE",
  "blush": "#F3E4DA",
  "promoTop": "#241A30",
  "promoBottom": "#120C18",
  "face": "Montserrat, a geometric sans-serif — headings heavy at 600 to 800, body regular",
  "craftTrade": "Lighting: large soft key from upper left, a warm practical LED glow as secondary source, controlled specular highlights on product surfaces. Register: contemporary premium hardware advertising — crisp macro detail, controlled reflections, deep saturated shadows, clean architectural geometry.",
  "craftLife": "Lighting: warm low-Kelvin practical LED glow as the hero light source with soft ambient fill, warmer white balance than the trade register. Register: warm, lived-in, editorial interior photography — styled but not staged.",
  "ctaPill": "The call to action is always a solid gold #EBA800 fully rounded pill with extra-bold dark ink #232323 lettering and a soft drop shadow beneath it, high contrast, never an outline or ghost button, never a square-cornered or rectangular button, and never any colour other than that gold.",
  "ctaPromo": "The call to action is a solid gold #EBA800 button with slightly rounded corners — a rounded rectangle, not a full pill — with extra-bold dark ink #232323 lettering, high contrast, never an outline or ghost button, and never any colour other than that gold.",
  "punch": "High saturation and strong contrast with deep shadows and bright highlights — built to fight a busy social feed — but no neon oversaturation, no HDR halos and no synthetic stock sheen.",
  "typeRule": "All lettering set in Montserrat or an identical heavy geometric sans-serif, tight tracking, crisp, correctly spelled, evenly kerned, and comfortably inside the frame with clear margins at the top and bottom.",
  "trust": "Trust seal: only if one of the proof lines is a certification or a warranty, that same wording may also appear as a small white circular seal with extra-bold violet #523875 lettering, carrying no words beyond that proof line — present and legible, never competing with the headline or the product. With no such proof line there is no seal."
};

export const TPL_ORDER = [
  "t1",
  "t2",
  "t3",
  "t5",
  "t4"
];

export const TPL = {
  "t1": {
    "name": "Template 1 — Collage Hero",
    "pillar": "Pillar A · Pro-Trust",
    "register": "trade",
    "system": "Palette (HitLights Template 1, Pro-Trust): deep violet #523875 as the full-bleed field, #675185 as its lighter violet tone, bright gold #FBCA10, gold #EBA800, ink #232323, pure white. Gold is only ever the warm accent, reading as the glow of an LED: bright gold #FBCA10 for headline line one, for the proof-line bullets, and for a quiet fine polka-dot grid at roughly half opacity anchored in the bottom-left corner; gold #EBA800 for the CTA pill and nothing else. Headline line one in bright gold #FBCA10, extra-bold and larger; line two in white, bold and slightly smaller.",
    "craft": "Lighting: large soft key from upper left, a warm practical LED glow as secondary source, controlled specular highlights on product surfaces. Register: contemporary premium hardware advertising — crisp macro detail, controlled reflections, deep saturated shadows, clean architectural geometry.",
    "photo": "Photography: job-site and installer realism — real hands, real hardware, real rough-in conditions, upscale but neutral interiors.",
    "cta": "The call to action is always a solid gold #EBA800 fully rounded pill with extra-bold dark ink #232323 lettering and a soft drop shadow beneath it, high contrast, never an outline or ghost button, never a square-cornered or rectangular button, and never any colour other than that gold.",
    "ctaNoun": "pill",
    "skeleton": "Layout skeleton, in this order: reserved logo space, then a two-line stacked headline, then the hero visual, then the proof points, then the CTA. Rule of thirds, one dominant focal anchor, eye landing on the subject within half a second.",
    "proof": "bullets",
    "contact": true,
    "seal": true,
    "deadline": false,
    "master": "Square frame, the whole canvas the deep violet #523875 field (Template 1, Collage Hero). Top-left: the reserved logo space, and beneath it the two-line headline. On the right, starting about a third of the way down, the scene photograph as a large inset with softly rounded corners, roughly 60% of the frame width. Overlapping that photograph's lower-left corner, the product from the reference image as a clean hero cut-out with a warm glow and a soft drop shadow. The proof lines stacked in the left column beneath the headline, beside the photograph. The trust seal, if there is one, at the photograph's lower-right edge. The gold pill centred along the bottom with the contact line beneath it. The bright gold dot grid in the bottom-left corner, behind the product cut-out.",
    "portrait": "The violet field throughout. The reserved logo space and the two-line headline across the top, the inset photograph through the middle with the glowing product cut-out overlapping its lower-left corner, the proof lines beneath, then the gold pill and contact line centred along the bottom. The dot grid stays in the bottom-left corner.",
    "landscape": "The violet field throughout. A type column down the left, in this reading order — reserved logo space, headline, proof points, gold pill with the contact line beneath it — and the inset photograph filling the right with the glowing product cut-out overlapping its lower-left corner. The dot grid stays in the bottom-left corner.",
    "keep": "the same violet field and bright gold dot texture in the bottom-left corner, the same softly rounded corners on the inset photograph, the same glowing product cut-out",
    "palette": "violet #523875 and #675185, bright gold #FBCA10, gold #EBA800, ink #232323, white",
    "avoidExtra": "",
    "labels": {
      "h1": "Headline line 1 — bright gold",
      "h2": "Headline line 2 — white"
    }
  },
  "t2": {
    "name": "Template 2 — Speech-Bubble Hero",
    "pillar": "Pillar A · Pro-Trust",
    "register": "trade",
    "system": "Palette (HitLights Template 2, Pro-Trust Speech-Bubble): the photograph itself is the ground, in cool blue-grey daylight tones; the brand is carried by a clean white rounded speech-bubble panel. Gold #EBA800 for the CTA pill, ink #232323 for the headline and proof line, white for the bubble and the contact line. Headline in ink #232323, extra-bold, centred, both lines the same size. No full violet field and no dot texture in this template.",
    "craft": "Lighting: large soft key from upper left, a warm practical LED glow as secondary source, controlled specular highlights on product surfaces. Register: contemporary premium hardware advertising — crisp macro detail, controlled reflections, deep saturated shadows, clean architectural geometry.",
    "photo": "Photography: job-site and installer realism — real hands, real hardware, real rough-in conditions, upscale but neutral interiors. Cool, natural daylight on site, so the white bubble and the gold pill stand out against it.",
    "cta": "The call to action is always a solid gold #EBA800 fully rounded pill with extra-bold dark ink #232323 lettering and a soft drop shadow beneath it, high contrast, never an outline or ghost button, never a square-cornered or rectangular button, and never any colour other than that gold.",
    "ctaNoun": "pill",
    "skeleton": "Layout skeleton, in this order: the speech bubble carrying the reserved logo space, headline, proof line and CTA; then the product; then the contact line. One dominant focal anchor, eye landing on the bubble headline first and the product second.",
    "proof": "inline",
    "contact": true,
    "seal": false,
    "deadline": false,
    "master": "Square frame (Template 2, Speech-Bubble Hero). The scene photograph fills the entire frame edge to edge. Across the upper part, a solid pure-white speech-bubble panel with generously rounded corners and a soft drop shadow, its top edge about 4% down from the top of the frame and its sides about 6% in from each edge; inside it, centred, in this order — the reserved logo space, the two-line headline in ink, the proof points on a single line separated by thin vertical bars, and the gold pill. The product from the reference image sits prominently in the lower part of the frame, as a clean arrangement or in use, clear of the bubble. Centred along the bottom, just above a clear margin, the contact line in small white lettering with a subtle shadow for legibility.",
    "portrait": "The photograph fills the frame. The solid white speech bubble across the upper third, its top edge 14% down from the top of the frame and its sides about 6% in from each edge, with the reserved logo space, headline, proof line and gold pill centred inside; the product through the middle and lower frame; the contact line centred near the bottom above a clear margin.",
    "landscape": "The photograph fills the frame. The solid white speech bubble on the left half, spanning from about 4% to 52% of the frame width, its top edge about 10% down from the top of the frame, with the reserved logo space, headline, proof line and gold pill centred inside; the product in the right half; the contact line small and white along the bottom, centred beneath the bubble.",
    "keep": "the same full-bleed photograph, the same white rounded speech bubble with its soft shadow, the same product arrangement",
    "palette": "white, deep violet #523875, gold #EBA800, ink #232323, and the natural colours of the photograph",
    "avoidExtra": ", no violet background field",
    "labels": {
      "h1": "Headline line 1 — ink, inside the bubble",
      "h2": "Headline line 2 — ink"
    }
  },
  "t3": {
    "name": "Template 3 — Discount Deadline",
    "pillar": "Pillar B · Promo Urgency",
    "register": "promo",
    "system": "Palette (HitLights Template 3, Promo Urgency): a near-black deep violet ground grading from #241A30 at the top to #120C18 at the bottom, with a soft blurred glow of gold #EBA800 and violet #675185 light behind the product; bright gold #FBCA10 for the offer line; white for the second headline line and the deadline line; gold #EBA800 for the CTA button with ink #232323 lettering. The offer line in bright gold #FBCA10, extra-bold and very large — the loudest element in the frame; line two in white, bold and much smaller.",
    "craft": "Lighting: moody, low-key ambient room light with the product catching a warm LED glow; deep shadows and rich contrast. Register: premium retail promotion — urgent, never cheap.",
    "photo": "Photography: the product as an angled flat-lay, tilted a few degrees, softly lit, over a blurred ambient-lit room background.",
    "cta": "The call to action is a solid gold #EBA800 button with slightly rounded corners — a rounded rectangle, not a full pill — with extra-bold dark ink #232323 lettering, high contrast, never an outline or ghost button, and never any colour other than that gold.",
    "ctaNoun": "button",
    "skeleton": "Layout skeleton, in this order: reserved logo space, then the offer line and line two, then the product, then the deadline line and the CTA. The offer reads first, within half a second.",
    "proof": "none",
    "contact": false,
    "seal": false,
    "deadline": true,
    "master": "Square frame (Template 3, Discount Deadline). The whole canvas the dark violet ground with a soft gold-and-violet glow behind the centre. Top-left: the reserved logo space. Beneath it, starting about a quarter of the way down, the offer line and then line two, left-aligned. In the lower right, the product as an angled flat-lay tilted a few degrees anticlockwise over a blurred ambient room. Along the bottom-left, the deadline line in white and directly beneath it the gold CTA button.",
    "portrait": "The dark violet ground and glow throughout. The reserved logo space top-left, the offer line and line two beneath it, the tilted product flat-lay filling the middle, then the deadline line and the gold button along the bottom-left.",
    "landscape": "The dark violet ground and glow throughout. Down the left half, in this reading order — reserved logo space, offer line, line two, deadline line, gold button — and the tilted product flat-lay filling the right half.",
    "keep": "the same dark violet ground and gold-and-violet glow, the same tilted product flat-lay, the same deadline line word for word",
    "palette": "dark violet #241A30 to #120C18, violet #675185, bright gold #FBCA10, gold #EBA800, ink #232323, white",
    "avoidExtra": ", no fake prices, no percentages or dates other than the exact wording given",
    "labels": {
      "h1": "Offer — bright gold, the largest line (e.g. 11% OFF)",
      "h2": "Line 2 — white (e.g. LED Kits — Limited Time)"
    }
  },
  "t5": {
    "name": "Template 5 — Glow Room Hero",
    "pillar": "Pillar A · Pro-Trust",
    "register": "trade",
    "system": "Palette (HitLights Template 5, Glow Room Hero): the photograph is the ground — a dark, moody, warm interior lit almost entirely by warm-white LED strip light of around 2700 to 3000K in ceiling coves, under shelves and cabinets and behind wall panels, with deep brown-charcoal shadows. All lettering pure white with a soft dark drop shadow for legibility, over a gentle darkening of the photograph behind the type. Gold #EBA800 only for the CTA pill, with ink #232323 lettering. No violet, no dot texture, and no panels, boxes or colour bands behind the type. Headline in white, extra-bold, very large, title case; subheadline in white at a regular weight, roughly a third of the headline size.",
    "craft": "Lighting: the LED strips in the room and the glowing product are the only light sources; warm amber highlights, deep low-key shadows, rich contrast. Register: premium architectural-lighting advertising — crisp, cinematic, never cheap.",
    "photo": "Photography: a high-end modern residential interior — concrete or wood-panelled walls, an open living room and kitchen — shot at night with the main lights off, so the only light is warm LED cove, shelf and under-cabinet lighting. No people.",
    "cta": "The call to action is always a solid gold #EBA800 fully rounded pill with extra-bold dark ink #232323 lettering and a soft drop shadow beneath it, high contrast, never an outline or ghost button, never a square-cornered or rectangular button, and never any colour other than that gold. The pill's wording is followed by a small right-pointing arrow in the same ink colour.",
    "ctaNoun": "pill",
    "skeleton": "Layout skeleton, in this order: clear space for the logo, then the two-line headline, then the subheadline, then the CTA, with the glowing product as the foreground hero. The headline reads first, the product second.",
    "proof": "none",
    "sub": true,
    "contact": true,
    "contactIn": {
      "master": "stacked",
      "portrait": "inline",
      "landscape": ""
    },
    "seal": false,
    "deadline": false,
    "master": "Square frame (Template 5, Glow Room Hero). The interior photograph fills the whole frame edge to edge. Centred in the upper 55% of the frame, stacked and centre-aligned: clear space for the logo, the two-line headline very large, the subheadline on two lines, then the gold pill. In the lower-left and centre foreground, the product from the reference image, large, photoreal and lit up with a warm glow, running out past the left and bottom edges of the frame. In the bottom-right corner, right-aligned on two small lines, the contact details, each followed by a small white circular icon — a phone handset after the phone number, an envelope after the email.",
    "portrait": "The photograph fills the frame. Centred between 14% and 50% of the frame height, stacked and centre-aligned: clear space for the logo, the very large two-line headline, the subheadline on two lines, the gold pill, and directly beneath the pill the contact details on one small white line separated by a vertical bar. The glowing product fills the bottom third of the frame, running out past both side edges and the bottom edge.",
    "landscape": "The photograph fills the frame. A right-aligned type block over the right 45% of the frame, stacked: clear space for the logo, the very large two-line headline, the subheadline on two lines, then the gold pill. The glowing product coils across the lower-left of the frame, running out past the left and bottom edges. No contact details in this size.",
    "keep": "the same interior photograph and its warm LED lighting, the same large glowing product, the same white lettering with soft shadows, the same subheadline word for word",
    "palette": "white, gold #EBA800, ink #232323, and the warm amber and charcoal tones of the photograph",
    "avoidExtra": ", no violet, no coloured panels or boxes behind the text, no people",
    "labels": {
      "h1": "Headline line 1 — white, very large",
      "h2": "Headline line 2 — white, very large"
    }
  },
  "t4": {
    "name": "Template 4 — Styled Room Hero",
    "pillar": "Pillar C · Aesthetic Lifestyle",
    "register": "lifestyle",
    "system": "Palette (HitLights Template 4, Aesthetic Lifestyle): warm cream #FBF6EE as the ground, blush #F3E4DA as its secondary warm tone, violet #675185 used only as a narrow vertical accent bar beside the type and never as a full-bleed block, gold #EBA800 as the single high-saturation accent, ink #232323 for type, white. This is the lighter register of the same brand system, so it reads as home content in feed rather than a trade ad. Headline in ink #232323 at a bold rather than extra-bold weight, both lines the same size, with only the final word of line two picked out in gold #EBA800. No dot texture in this register.",
    "craft": "Lighting: warm low-Kelvin practical LED glow as the hero light source with soft ambient fill, warmer white balance than the trade register. Register: warm, lived-in, editorial interior photography — styled but not staged.",
    "photo": "Photography: styled, warm, lived-in domestic rooms — a bedroom shelf, a kitchen backsplash, a vanity mirror. Absolutely no tool belts, no job site, no work gloves, no exposed construction — this register exists to avoid trade imagery entirely.",
    "cta": "The call to action is always a solid gold #EBA800 fully rounded pill with extra-bold dark ink #232323 lettering and a soft drop shadow beneath it, high contrast, never an outline or ghost button, never a square-cornered or rectangular button, and never any colour other than that gold.",
    "ctaNoun": "pill",
    "skeleton": "Layout skeleton, in this order: the hero photograph with a calm corner kept clear for the logo, then the two-line stacked headline, then the proof points, then the CTA. Rule of thirds, one dominant focal anchor, eye landing on the subject within half a second.",
    "proof": "bullets",
    "contact": true,
    "seal": true,
    "deadline": false,
    "master": "Square frame (Template 4, Styled Room Hero). The scene photograph fills the upper 60% of the frame edge to edge, its two bottom corners softly rounded where it meets the panel below. Over the photograph: a calm, darker corner of the scene kept clear for the logo at the top-left, and the trust seal, if there is one, top-right. The lower 40% is the warm cream #FBF6EE panel, with a narrow vertical violet #675185 accent bar running down its left edge; indented to the right of that bar, in this reading order — headline, proof lines, gold pill with the contact line beneath it.",
    "portrait": "Photograph across the upper 55% of the frame edge to edge with its bottom corners softly rounded, a calm, darker corner of the scene kept clear for the logo over its top-left and the seal, if any, over its top-right. The cream #FBF6EE panel across the lower portion with the violet #675185 accent bar down its left edge, and to the right of the bar in this reading order — headline, proof lines, gold pill, contact line.",
    "landscape": "Photograph filling the left 55% of the frame edge to edge with its right-hand corners softly rounded, a calm, darker corner of the scene kept clear for the logo over its top-left and the seal, if any, over its top-right. The cream #FBF6EE panel filling the right portion with the violet #675185 accent bar down its left edge, and to the right of the bar in this reading order — headline, proof points, gold pill with the contact line beneath it.",
    "keep": "the same cream panel and violet accent bar, the same softly rounded corners on the photograph",
    "palette": "cream #FBF6EE and blush #F3E4DA, violet #675185 and #523875, gold #EBA800, ink #232323, white",
    "avoidExtra": ", no tool belts, no job site, no work gloves",
    "labels": {
      "h1": "Headline line 1 — ink",
      "h2": "Headline line 2 — ink, last word in gold"
    }
  }
};

export const SAMPLE = {
  "t1": {
    "h1": "DRIVER + DIMMER.",
    "h2": "ONE GANG BOX.",
    "sub": "",
    "p1": "UL Listed & Class 2",
    "p2": "100% to 0.3% dimming",
    "p3": "6-year warranty",
    "cta": "SHOP EZDIM PRO",
    "deadline": "",
    "scene": "A licensed electrician's gloved hands seating the product into a single steel gang box in an open drywall wall, neat copper conductors visible, deep violet shadow behind."
  },
  "t2": {
    "h1": "LED Kits Built",
    "h2": "for the Job Site",
    "sub": "",
    "p1": "UL Listed",
    "p2": "Class 2",
    "p3": "6-Yr Warranty",
    "cta": "View Collection",
    "deadline": "",
    "scene": "A contractor in daylight on a commercial fit-out, open ceiling grid and ladder behind, the product laid out on a clean workbench in the foreground."
  },
  "t3": {
    "h1": "",
    "h2": "LED Kits — Limited Time",
    "sub": "",
    "p1": "",
    "p2": "",
    "p3": "",
    "cta": "Shop Now",
    "deadline": "",
    "scene": "An oak side table in a softly lit living room at dusk, warm LED shelf lighting glowing in the blurred background."
  },
  "t4": {
    "h1": "Your space,",
    "h2": "your glow.",
    "sub": "",
    "p1": "Instant ambiance",
    "p2": "Plug-and-play setup",
    "p3": "6-year warranty",
    "cta": "Shop the Look",
    "deadline": "",
    "scene": "A styled bedroom shelf at dusk, books and a ceramic vase glowing under warm LED strip light, a linen-covered bed softly out of focus."
  },
  "t5": {
    "h1": "Built For",
    "h2": "Professionals",
    "sub": "Premium LED strips built for consistent performance",
    "p1": "",
    "p2": "",
    "p3": "",
    "cta": "View Our Collection",
    "deadline": "",
    "scene": "A high-end open-plan living room and kitchen at night, main lights off, warm LED cove lighting along the ceiling and under the cabinets."
  }
};

export const LIMITS = {
  "t1": {
    "h1": 24,
    "h2": 24,
    "hl": 40,
    "p": 28,
    "cta": 22,
    "ctaWords": [
      2,
      4
    ]
  },
  "t2": {
    "h1": 24,
    "h2": 24,
    "hl": 40,
    "p": 20,
    "cta": 20,
    "ctaWords": [
      2,
      3
    ]
  },
  "t3": {
    "h1": 12,
    "h2": 32,
    "deadline": 32,
    "cta": 16,
    "ctaWords": [
      2,
      3
    ]
  },
  "t4": {
    "h1": 22,
    "h2": 22,
    "hl": 40,
    "p": 28,
    "cta": 20,
    "ctaWords": [
      2,
      4
    ]
  },
  "t5": {
    "h1": 14,
    "h2": 16,
    "hl": 26,
    "sub": 60,
    "subWords": [
      5,
      8
    ],
    "cta": 22,
    "ctaWords": [
      2,
      3
    ]
  }
};

export const CANVAS = {
  "master": {
    "W": 1080,
    "H": 1080,
    "w": 280,
    "dims": "1080x1080",
    "title": "Square"
  },
  "portrait": {
    "W": 1080,
    "H": 1920,
    "w": 320,
    "dims": "1080x1920",
    "title": "Portrait"
  },
  "landscape": {
    "W": 1200,
    "H": 628,
    "w": 240,
    "dims": "1200x628",
    "title": "Landscape"
  }
};

export const KINDS = [
  "master",
  "portrait",
  "landscape"
];

export const LOGOGRID = {
  "t1": {
    "colour": "white",
    "shadow": false,
    "ground": "panel",
    "even": true,
    "a": "tl",
    "pos": {
      "master": [
        64,
        64
      ],
      "portrait": [
        64,
        288
      ],
      "landscape": [
        56,
        48
      ]
    },
    "sits": "Violet field"
  },
  "t2": {
    // DEVIATION from v16 (decided Sept 30, 2026): the template library allows only the white and
    // black lockups ("never recolour, no violet"), and its T2 card uses the black lockup.
    "colour": "black",
    "shadow": false,
    "ground": "bubble",
    "even": true,
    "a": "bubble",
    "pos": {
      "master": [
        400,
        88
      ],
      "portrait": [
        380,
        309
      ],
      "landscape": [
        216,
        72
      ]
    },
    "pad": {
      "master": 40,
      "portrait": 40,
      "landscape": 28
    },
    "bx": {
      "master": [
        0.06,
        0.94
      ],
      "portrait": [
        0.06,
        0.94
      ],
      "landscape": [
        0.02,
        0.56
      ]
    },
    "sits": "White bubble"
  },
  "t3": {
    "colour": "white",
    "shadow": false,
    "ground": "panel",
    "even": false,
    "a": "tl",
    "pos": {
      "master": [
        64,
        64
      ],
      "portrait": [
        64,
        288
      ],
      "landscape": [
        56,
        48
      ]
    },
    "sits": "Dark gradient",
    "grad": [
      "241A30",
      "120C18"
    ]
  },
  "t4": {
    "colour": "white",
    "shadow": true,
    "ground": "photo",
    "even": false,
    "a": "tl",
    "pos": {
      "master": [
        64,
        64
      ],
      "portrait": [
        64,
        288
      ],
      "landscape": [
        56,
        48
      ]
    },
    "sits": "Photo (calm corner)"
  },
  "t5": {
    "colour": "white",
    "shadow": true,
    "ground": "photo",
    "even": false,
    "a": {
      "master": "tc",
      "portrait": "tc",
      "landscape": "tr"
    },
    "pos": {
      "master": [
        400,
        64
      ],
      "portrait": [
        380,
        288
      ],
      "landscape": [
        904,
        48
      ]
    },
    "sits": "Photo (dark ceiling)"
  }
};

export const FIELD = {
  "t1": "523875",
  "t2": "-",
  "t3": "-",
  "t4": "FBF6EE",
  "t5": "-"
};

export const SAFE_TOP = 269;

export const LOGO_AR = 0.14079728583545378;

export const LOGOWHERE = {
  "tl": "the top-left corner",
  "tc": "the top centre",
  "tr": "the top-right corner",
  "bubble": "the top centre of the white speech bubble"
};

export const FLAGTXT = {
  "COLLISION": "Artwork runs into the logo zone, so the logo overlaps it. Regenerate this size; don't use this file as is.",
  "PLACEHOLDER": "A blank patch is still visible behind the logo after repainting. Regenerate this size.",
  "CONTRAST": "The background under the logo was too light or dark for this template's lockup, so the other colourway was used. Check it against the other sizes.",
  "BUBBLE?": "Couldn't find the white speech bubble, so the logo is at the grid default. Check that it sits inside the bubble.",
  "SAFEZONE": "The logo is in the top 14%, where the Stories/Reels header covers it (the bubble was drawn too high). Regenerate this size.",
  "NOCTA": "No solid gold button was found. The generator may have drawn it in another colour or left it out. Regenerate this size.",
  "CTACOLOR": "The button is too far from HitLights gold (#EBA800) to correct. Regenerate this size.",
  "FIELDCOLOR": "The brand background drifted off the palette. Compare it with the other sizes before using it."
};

export const BLOCKING = [
  "COLLISION",
  "PLACEHOLDER",
  "SAFEZONE",
  "NOCTA",
  "CTACOLOR",
  "TEXT"
];

export const CREDITS_PER_RENDER = 2;

export const ARFOR = {
  "master": "1:1",
  "portrait": "9:16",
  "landscape": "16:9"
};

