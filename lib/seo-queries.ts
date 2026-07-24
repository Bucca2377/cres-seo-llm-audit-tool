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
  const hasBedContext = /bed\b|beds\b|\bbr\b|bedroom|studio|efficienc/.test(t);
  if (!hasBedContext) return [];
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
 * Finalize the tracked-query set: the brand query (the property name) always leads
 * so a property is always checked for its own name, then the model's picks, deduped
 * case-insensitively with empties dropped, capped at `cap`.
 */
export function finalizeQuerySet(brand: string, picked: string[], cap = 6): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (q: string | undefined) => {
    const t = (q || "").trim();
    const k = t.toLowerCase();
    if (!t || seen.has(k)) return;
    seen.add(k);
    out.push(t);
  };
  push(brand);
  for (const q of picked || []) push(q);
  return out.slice(0, cap);
}
