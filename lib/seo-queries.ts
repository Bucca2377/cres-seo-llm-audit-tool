/**
 * Helpers for building the SEO audit's tracked-query set.
 *
 * The model supplies the geographic targeting (the property's real submarket:
 * neighborhood / suburb / county / nearby major employers) and the phrasing, but the
 * phrasing is GROUNDED in Google Autocomplete — those suggestions come straight from
 * actual search volume, so the tracked phrases are what people actually type, not
 * invented long-tails and not the over-broad metro head term. These are the
 * mechanical, framework-free pieces (parse the autocomplete payload + finalize the
 * set); tested in tests/detectors.test.ts.
 */

/**
 * Standard bedroom-by-county searches that should ALWAYS be tracked, one per bedroom
 * type the property actually offers (studio / 1 / 2 / 3). Uses the exact phrasing the
 * user asked for: "studio apartments to rent in <geo>", "one bedroom apartments to
 * rent in <geo>", "2 bedroom apartments to rent in <geo>", "3 bedroom apartments to
 * rent in <geo>". `geo` is normally the county name (e.g. "Arapahoe County").
 *
 * Reads which floorplans exist from the property's free-text bedroomTypes field,
 * tolerating the common shapes ("Studio, 1 Bed, 2 Bed, 3 Bed", "1-3 Bedrooms",
 * "1 & 2 Bedroom", "Studio/1/2/3", word forms). Returns [] when we don't know the
 * geo or the field lists no recognizable bedroom info (never fabricates a floorplan).
 */
export function bedroomCountyQueries(bedroomTypes: string, geo: string): string[] {
  const g = (geo || "").trim();
  if (!g) return [];
  const t = (bedroomTypes || "").toLowerCase();
  // bedroomTypes is a DEDICATED field, so bare counts ("one, two, three", "1/2/3",
  // "Studio-3") are bedroom info even without the word "bedroom". We rely on the
  // studio/number extraction below returning nothing for non-bedroom junk rather than
  // gating on a bed-word (which dropped the common "one, two, three" entry).
  const beds = new Set<number>(); // 0 = studio
  if (/\bstudio\b|\befficienc/.test(t)) beds.add(0);
  const norm = t
    .replace(/\bstudio\b/g, "0")
    .replace(/\bone\b/g, "1")
    .replace(/\btwo\b/g, "2")
    .replace(/\bthree\b/g, "3")
    .replace(/\bfour\b/g, "4");
  // Ranges ("1-3", "1 to 3") expand to every count between.
  for (const m of norm.matchAll(/([0-4])\s*(?:-|–|—|to)\s*([0-4])/g)) {
    const a = +m[1];
    const b = +m[2];
    if (a <= b) for (let i = a; i <= b; i++) beds.add(i);
  }
  // Standalone single digits (0-4) in the dedicated bedroom field are bedroom counts.
  for (const m of norm.matchAll(/\b([0-4])\b/g)) beds.add(+m[1]);
  const out: string[] = [];
  if (beds.has(0)) out.push(`studio apartments to rent in ${g}`);
  if (beds.has(1)) out.push(`one bedroom apartments to rent in ${g}`);
  if (beds.has(2)) out.push(`2 bedroom apartments to rent in ${g}`);
  if (beds.has(3)) out.push(`3 bedroom apartments to rent in ${g}`);
  return out;
}

/**
 * Standard amenity-by-county searches to track, one per high-demand amenity the
 * property actually offers (only what renters really search on). Gated on the
 * property's amenities so it never claims an amenity the property lacks, in priority
 * order (pool, pet friendly, gym, garage, in-unit laundry) and capped. Returns []
 * when we don't know the geo or none of the tracked amenities are present.
 */
export function amenityCountyQueries(amenities: string, geo: string, cap = 3): string[] {
  const g = (geo || "").trim();
  if (!g) return [];
  const a = (amenities || "").toLowerCase();
  const out: string[] = [];
  const add = (q: string) => {
    if (out.length < cap) out.push(q);
  };
  if (/\bswimming pool\b|\bpool\b(?!\s*table)/.test(a)) add(`apartments with a pool in ${g}`);
  if (/\bpets?\b|pet[-\s]?friendly|dog[-\s]?friendly|dog park/.test(a)) add(`pet friendly apartments in ${g}`);
  if (/\bgym\b|fitness/.test(a)) add(`apartments with a gym in ${g}`);
  if (/\bgarage\b|covered parking/.test(a)) add(`apartments with a garage in ${g}`);
  if (/washer|dryer|in[-\s]?unit laundry/.test(a)) add(`apartments with in-unit laundry in ${g}`);
  return out;
}

/**
 * The word a RENTER actually types for this property type. Industry
 * classifications ("multifamily", "multi-family", "apartment community") are NOT
 * consumer search terms — a renter types "apartments". Only genuine consumer
 * categories map to their own word. Prevents the "multifamily aurora" class of
 * unnatural query (and the sale-intent results autocomplete returns for the
 * investor term "multifamily").
 */
export function searchUnitWord(propertyType: string): string {
  const t = (propertyType || "").toLowerCase();
  if (/town\s?home|town\s?house/.test(t)) return "townhomes";
  if (/\bcondos?\b|condominium/.test(t)) return "condos";
  if (/\bsenior\b|55\s*\+|active adult/.test(t)) return "senior apartments";
  if (/\bstudent\b/.test(t)) return "student apartments";
  if ((/single[-\s]?family/.test(t) || /\bhouses?\b/.test(t)) && !/apart/.test(t)) return "houses for rent";
  // multifamily / multi-family / apartment community / apartment homes / empty / other
  return "apartments";
}

/**
 * Phrases that betray SALE/purchase intent — wrong for a RENTAL audit. Autocomplete
 * for investor terms like "multifamily" surfaces these ("multifamily for sale …"),
 * so they must be filtered out of the tracked set.
 */
export const SALES_INTENT_RE =
  /\bfor[-\s]?sale\b|homes?\s+for\s+sale|\bto\s+buy\b|\bbuy\b|\bpurchase\b|investment\s+propert|\bfor\s+sale\s+by\s+owner\b|\bmls\b/i;

/** True when a query reads as a for-sale / purchase search rather than a rental. */
export function isSalesIntent(q: string): boolean {
  return SALES_INTENT_RE.test(q || "");
}

/**
 * True when a query targets the wrong AUDIENCE or price band for THIS property, so it
 * shouldn't be tracked:
 *  - income-restricted / subsidized / senior searches for a market-rate (non-senior)
 *    property — different renter pool entirely;
 *  - an "under $X" price cap at or below the property's rent floor, which excludes the
 *    property from that search altogether (e.g. "under $1000" when rents start at $1000).
 * `affordable`/`senior` flags keep those searches when the property actually is that.
 */
export function isOffProfileQuery(
  q: string,
  opts: { rentMin?: number; rentMax?: number; affordable?: boolean; senior?: boolean }
): boolean {
  const s = (q || "").toLowerCase();
  if (
    !opts.affordable &&
    /\blow[-\s]?income\b|\bincome[-\s]?based\b|\bincome[-\s]?restricted\b|\bsection\s*8\b|\bsubsidized\b|\baffordable housing\b|\bhousing authority\b|\btax credit\b|\blihtc\b/.test(s)
  )
    return true;
  if (!opts.senior && /\b62\s*\+|\b55\s*\+|\bsenior (?:living|apartments)\b/.test(s)) return true;
  const min = opts.rentMin;
  if (min && min > 0) {
    const m = s.match(/under\s*\$?\s*([\d,]{3,})/);
    if (m) {
      const cap = parseInt(m[1].replace(/,/g, ""), 10);
      if (cap && cap <= min) return true;
    }
  }
  return false;
}

/** Pull the suggestion strings out of a SerpAPI google_autocomplete response. */
export function extractAutocompleteSuggestions(serpData: unknown): string[] {
  const s = (serpData as { suggestions?: unknown })?.suggestions;
  if (!Array.isArray(s)) return [];
  const out: string[] = [];
  for (const x of s) {
    const v = typeof x === "string" ? x : (x as { value?: unknown })?.value;
    if (typeof v === "string" && v.trim()) out.push(v.trim());
  }
  return out;
}

/**
 * Normalized dedupe key: lowercased, punctuation-flattened, and with the
 * air/space-force-base variants collapsed so "buckley afb" and "buckley space force
 * base" (the same place) don't both take a slot.
 */
function dedupeKey(t: string): string {
  return t
    .toLowerCase()
    .replace(/\b(?:air|space)\s+force\s+base\b|\bafb\b|\bsfb\b/g, "base")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Finalize the tracked-query set: the brand query (the property name) always leads
 * so a property is always checked for its own name, then the picks — with SALE-intent
 * phrases dropped (rental audit) and near-duplicates collapsed — deduped
 * case-insensitively with empties dropped, capped at `cap`.
 */
export function finalizeQuerySet(brand: string, picked: string[], cap = 6): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (q: string | undefined, isBrand = false) => {
    const t = (q || "").trim();
    if (!t) return;
    if (!isBrand && isSalesIntent(t)) return; // rental audit: no for-sale/buy phrases
    const k = dedupeKey(t);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(t);
  };
  push(brand, true);
  for (const q of picked || []) push(q);
  return out.slice(0, cap);
}
