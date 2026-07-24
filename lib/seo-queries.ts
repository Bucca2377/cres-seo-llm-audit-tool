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
