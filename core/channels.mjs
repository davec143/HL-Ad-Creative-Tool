// Social, banner and email creative: the channel registry shared by the page and the server.
// This is a separate tool from the Meta ad builder (core/brand.mjs, composer/templates.mjs) and
// shares none of its templates, limits or pipeline state. Nothing here is paid: every image is
// composed locally in Chromium from brand graphics, an optional product cutout and an optional
// background photo (an uploaded file or a scene already rendered for an ad set).

// safe: the region that every platform shows uncropped (covers and stories are cropped or
// overlaid by the platform's own UI). Text, logo, product and CTA stay inside it.
export const CHANNELS = {
  social: {
    name: "Social posts",
    blurb: "Organic feed posts, stories and pins for Instagram, Facebook, LinkedIn, X and Pinterest.",
    formats: [
      { id: "feed-portrait", name: "Instagram / Facebook feed", W: 1080, H: 1350, note: "4:5 — the feed's tallest format" },
      { id: "feed-square", name: "Square post", W: 1080, H: 1080, note: "1:1 — works on every network" },
      { id: "story", name: "Story / Reels cover", W: 1080, H: 1920, note: "9:16 — top 250 px and bottom 340 px kept clear for the app's UI", safe: { x: 72, y: 250, w: 936, h: 1330 } },
      { id: "link-post", name: "Facebook / LinkedIn landscape", W: 1200, H: 630, note: "1.91:1 — link and landscape posts" },
      { id: "x-post", name: "X (Twitter) post", W: 1600, H: 900, note: "16:9" },
      { id: "pin", name: "Pinterest pin", W: 1000, H: 1500, note: "2:3" },
    ],
    defaults: ["feed-portrait", "feed-square", "story"],
    styles: [
      { id: "product", name: "Product spotlight", hint: "The real product is the hero, headline above, CTA below." },
      { id: "text", name: "Announcement", hint: "Text-led: a big headline for news, tips and quotes; the product stays small." },
      { id: "promo", name: "Promo / offer", hint: "A gold offer badge with the product. Use only a real, approved offer." },
    ],
    budget: 1000000,
  },
  banner: {
    name: "Banners",
    blurb: "Website heroes, promo strips and profile covers for Facebook, LinkedIn and YouTube.",
    formats: [
      { id: "web-hero", name: "Website hero", W: 1920, H: 720, note: "Desktop homepage or collection banner" },
      { id: "web-mobile", name: "Mobile hero", W: 800, H: 1000, note: "Mobile version of the website hero" },
      { id: "promo-strip", name: "Promo strip", W: 1200, H: 300, note: "Announcement bar or mid-page strip" },
      { id: "fb-cover", name: "Facebook page cover", W: 1640, H: 624, note: "Centre kept clear of desktop and mobile crops. Covers aren't clickable, so the button is replaced by the web address", noCta: true, safe: { x: 230, y: 48, w: 1180, h: 528 } },
      { id: "li-cover", name: "LinkedIn company cover", W: 1128, H: 191, note: "Left side kept clear for the company logo; web address instead of a button", noCta: true, safe: { x: 300, y: 24, w: 804, h: 143 } },
      { id: "yt-banner", name: "YouTube channel banner", W: 2560, H: 1440, note: "Everything in the 1546×423 centre safe area that shows on all devices; web address instead of a button", noCta: true, safe: { x: 507, y: 509, w: 1546, h: 423 } },
    ],
    defaults: ["web-hero", "web-mobile", "promo-strip"],
    styles: [
      { id: "product", name: "Product split", hint: "Copy on one side, the real product on the other." },
      { id: "text", name: "Headline banner", hint: "Centred headline and CTA; the product is left out." },
      { id: "promo", name: "Sale banner", hint: "A gold offer badge beside the product. Use only a real, approved offer." },
    ],
    budget: 600000,
  },
  email: {
    name: "Email",
    blurb: "Header, hero, product and promo images for marketing emails, at 2× for sharp retina screens.",
    formats: [
      { id: "email-hero", name: "Email hero", W: 1200, H: 600, note: "Shown at 600×300 in the email" },
      { id: "email-product", name: "Product feature", W: 1200, H: 800, note: "Shown at 600×400 in the email" },
      { id: "email-header", name: "Email header", W: 1200, H: 300, note: "Shown at 600×150 at the top of the email" },
      { id: "email-promo", name: "Promo strip", W: 1200, H: 280, note: "Shown at 600×140 between sections" },
    ],
    defaults: ["email-hero", "email-product", "email-header"],
    styles: [
      { id: "product", name: "Product feature", hint: "Product, headline and button — for launches and spotlights." },
      { id: "text", name: "Header / headline", hint: "Logo and headline only, no product — for newsletters." },
      { id: "promo", name: "Promo", hint: "A gold offer badge with the product. Use only a real, approved offer." },
    ],
    budget: 250000,
  },
};
export const CHANNEL_ORDER = ["social", "banner", "email"];

export const BACKGROUNDS = {
  violet: { name: "Brand violet", dark: true },
  night: { name: "Night glow", dark: true },
  cream: { name: "Cream", dark: false },
  photo: { name: "Photo", dark: true },
};

export const CHANNEL_FIELDS = ["eyebrow", "headline", "headline2", "sub", "offer", "cta", "url"];
// Per-field character limits (soft limits are shown as hints; the layout check is the real test).
export const CHANNEL_LIMITS = { eyebrow: 32, headline: 44, headline2: 44, sub: 110, offer: 18, cta: 22, url: 40 };
export const FIELD_LABELS = { eyebrow: "Eyebrow", headline: "Headline", headline2: "Headline line 2", sub: "Supporting line", offer: "Offer badge", cta: "Button", url: "Web address" };

export const CHANNEL_SAMPLE = {
  social: { eyebrow: "New from HitLights", headline: "Light the room", headline2: "you actually live in", sub: "Warm, even LED strip light for shelves, coves and under-cabinet glow.", offer: "", cta: "Shop now", url: "hitlights.com" },
  banner: { eyebrow: "LED strip lighting", headline: "Light made simple", headline2: "", sub: "Strips, dimmers and power built to work together.", offer: "", cta: "Shop the collection", url: "hitlights.com" },
  email: { eyebrow: "Just in", headline: "Meet your new", headline2: "favourite glow", sub: "Easy-install LED lighting for every room.", offer: "", cta: "Shop now", url: "" },
};

export function formatFor(channel, id) {
  const c = CHANNELS[channel];
  return c ? c.formats.find((f) => f.id === id) || null : null;
}

// The region every placement shows, with a margin for plain formats.
export function safeArea(f) {
  if (f.safe) return { ...f.safe };
  const m = Math.round(Math.min(f.W, f.H) * (Math.min(f.W, f.H) < 400 ? 0.1 : 0.065));
  return { x: m, y: m, w: f.W - 2 * m, h: f.H - 2 * m };
}

// Layout family from the safe area's shape: strip (very wide), wide (landscape) or tall.
export function modeFor(f) {
  const s = safeArea(f), a = s.w / s.h;
  return a >= 4 ? "strip" : a >= 1.25 ? "wide" : "tall";
}

// Normalise a request's copy. Unknown fields are dropped; strings are trimmed and capped.
export function cleanChannelFields(raw) {
  const out = {};
  for (const k of CHANNEL_FIELDS) out[k] = typeof (raw || {})[k] === "string" ? raw[k].replace(/\s+/g, " ").trim().slice(0, 200) : "";
  return out;
}

// Problems a person must fix before rendering (independent of the layout check).
export function checkChannelFields(fields, { style } = {}) {
  const out = [];
  if (!fields.headline) out.push({ field: "headline", message: "Write a headline." });
  if (style === "promo" && !fields.offer) out.push({ field: "offer", message: "The promo style needs the offer badge text (a real, approved offer)." });
  for (const k of CHANNEL_FIELDS) if (fields[k] && fields[k].length > CHANNEL_LIMITS[k]) out.push({ field: k, message: `${FIELD_LABELS[k]} is ${fields[k].length} characters; keep it to ${CHANNEL_LIMITS[k]}.` });
  return out;
}

// Drafting brief for the channel tool. The model writes copy only from the product data; the
// server's fact guard (core/facts.mjs) removes any figure, offer or certification it invents.
export function channelDraftBrief(channel, style, product, angle) {
  const c = CHANNELS[channel];
  const what = {
    social: "an organic social media post image plus its caption. Social copy is conversational and scroll-stopping, but never hype; the caption is 1–3 short sentences, then 3–6 relevant hashtags.",
    banner: "a website / profile banner. Banner copy is short and scannable: the headline must read in under two seconds.",
    email: "a marketing email image plus the email's subject line and preheader. Subject: under 50 characters, specific, no clickbait or ALL CAPS. Preheader: under 90 characters, adds to the subject rather than repeating it.",
  }[channel];
  return [
    `You write copy for HitLights (hitlights.com), a US brand of LED strip lighting, dimmers, power supplies and accessories sold to homeowners, DIYers and electrical contractors.`,
    `Write ${what}`,
    `Layout style: ${(c.styles.find((s) => s.id === style) || c.styles[0]).name}.`,
    `Voice: confident, plain-spoken, practical; warm for homeowners, precise for pros. Montserrat, violet and gold brand. No emojis in the image text.`,
    `Fields (return every key; use "" when a field isn't needed):`,
    `- eyebrow: ≤ ${CHANNEL_LIMITS.eyebrow} chars, a short kicker shown above the headline.`,
    `- headline: ≤ ${CHANNEL_LIMITS.headline} chars, the main line (shown in gold).`,
    `- headline2: ≤ ${CHANNEL_LIMITS.headline2} chars, optional second line that completes the headline (shown in white), or "".`,
    `- sub: ≤ ${CHANNEL_LIMITS.sub} chars, one supporting benefit sentence.`,
    `- cta: ≤ ${CHANNEL_LIMITS.cta} chars, e.g. "Shop now", "See the collection".`,
    `- offer: always "" — offers and discounts are entered by a person, never drafted.`,
    `- caption: ${channel === "social" ? "the post caption, without hashtags" : '""'}.`,
    `- hashtags: ${channel === "social" ? "3–6 hashtags separated by spaces" : '""'}.`,
    `- subject: ${channel === "email" ? "the email subject line" : '""'}.`,
    `- preheader: ${channel === "email" ? "the email preheader" : '""'}.`,
    `- alt: alt text for the image, ≤ 125 chars, describing what it shows.`,
    `Hard rules: use ONLY facts in the product data below. Never invent a number, wattage, length, price, percentage, rating, certification, warranty or offer. If a fact isn't there, leave it out.`,
    product ? `Product: ${product.title}\nProduct data:\n${String(product.desc || "").slice(0, 3000)}` : "No product was picked: write brand-level copy for HitLights LED lighting without any specific figures.",
    angle ? `Angle requested by the marketer: ${angle}` : "Pick the strongest angle for this channel yourself.",
  ].join("\n");
}

export const CHANNEL_DRAFT_KEYS = ["eyebrow", "headline", "headline2", "sub", "cta", "offer", "caption", "hashtags", "subject", "preheader", "alt"];
export const CHANNEL_DRAFT_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: Object.fromEntries(CHANNEL_DRAFT_KEYS.map((k) => [k, { type: "string" }])),
  required: CHANNEL_DRAFT_KEYS,
};
