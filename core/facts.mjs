// Fact guard for drafted copy. The drafting brief (v16, unchanged) already tells the model to use
// only product data; this checks it deterministically. Any figure, percentage, price, offer word
// or certification in a drafted field that does not appear in the product data is a violation;
// the field keeps its previous value and the person is told why.

const CERTS = ["UL", "cUL", "ETL", "cETL", "Energy Star", "DLC", "CE", "RoHS", "FCC", "CSA", "Title 24", "JA8", "IP20", "IP44", "IP54", "IP65", "IP67", "IP68", "NEC", "Class 2", "warranty", "guarantee", "certified", "listed"];
const OFFER = ["sale", "discount", "off", "free shipping", "deal", "save", "limited time", "today only", "clearance", "coupon"];

const norm = (s) => String(s || "").toLowerCase().replace(/[‐-―]/g, "-").replace(/\s+/g, " ");
const digitsOf = (s) => (String(s).match(/\d+(?:[.,]\d+)*/g) || []).map((d) => d.replace(/,/g, ""));
function hasWord(text, w) {
  const re = new RegExp("(^|[^a-z0-9])" + w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "($|[^a-z0-9])");
  return re.test(text);
}

// fields: {h1, h2, sub, p1, p2, p3, cta, scene}; source: product title + listing text.
// Returns [{field, reason}] for every unsupported claim.
export function factViolations(fields, source) {
  const src = norm(source), srcDigits = new Set(digitsOf(src));
  const out = [];
  for (const [field, raw] of Object.entries(fields)) {
    const t = norm(raw);
    if (!t) continue;
    for (const d of digitsOf(t)) if (!srcDigits.has(d)) out.push({ field, reason: `the figure "${d}" isn't in the product data` });
    if (/[$€£]\s*\d/.test(t) && !/[$€£]\s*\d/.test(src)) out.push({ field, reason: "a price isn't in the product data" });
    if (/%/.test(t) && !/%/.test(src)) out.push({ field, reason: "a percentage isn't in the product data" });
    for (const c of CERTS) if (hasWord(t, c.toLowerCase()) && !hasWord(src, c.toLowerCase())) out.push({ field, reason: `"${c}" isn't in the product data` });
    if (field !== "scene") for (const o of OFFER) if (hasWord(t, o) && !hasWord(src, o)) out.push({ field, reason: `offer wording "${o}" isn't in the product data` });
  }
  return out;
}

// Apply a draft safely: violating fields keep their previous value.
export function guardDraft(before, drafted, source) {
  const keys = ["h1", "h2", "sub", "p1", "p2", "p3", "cta", "scene"];
  const changed = {};
  for (const k of keys) if (drafted[k] !== before[k]) changed[k] = drafted[k];
  const violations = factViolations(changed, source);
  const out = { ...drafted };
  for (const v of violations) out[v.field] = before[v.field];
  return { form: out, violations };
}
