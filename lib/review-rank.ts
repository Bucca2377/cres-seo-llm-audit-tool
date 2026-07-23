/**
 * Google review-rank comparison for the SEO audit. Ranks the property's Google
 * star rating against the local Map Pack competitors that appeared across the
 * audit's queries, so the report shows where the property stands on reviews
 * (e.g. "4.4 stars, #2 of 5 nearby") rather than a bare number.
 *
 * Framework-free (no React/Next/DOM) so it imports into the client component and
 * runs in the plain test process. Covered by tests/detectors.test.ts.
 */

export interface ReviewEntry {
  name: string;
  rating: number | null;
  reviews: number | null;
  /** true for the audited property's own row. */
  isSelf?: boolean;
}

/**
 * Normalize a business name for cross-result dedupe: lowercase, strip punctuation,
 * and drop generic multifamily filler words so "The Flats at Stone" and
 * "Flats Stone Apartments" collapse to the same key.
 */
export function normReviewName(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(apartments?|apts?|homes?|the|at|of|residences?|community|living|luxury)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Build the local Google-review ranking: the audited property plus the DISTINCT
 * Map Pack competitors seen across the queries, deduped by normalized name and
 * sorted by star rating (highest first; unrated entries last, capped).
 *
 * The property's own row always uses the authoritative GBP rating passed in
 * `self` — any competitor-row copy of the property (its own Map Pack appearance,
 * where SerpAPI's rating/review count is unreliable) is dropped by name match.
 * Returns [] when `self` has no rating AND no rated competitors (nothing to show).
 */
export function buildLocalReviewComparison(
  self: { name: string; rating: number | null; reviews: number | null },
  competitors: ReviewEntry[],
  cap = 8
): ReviewEntry[] {
  const selfKey = normReviewName(self.name);
  const byKey = new Map<string, ReviewEntry>();
  for (const c of competitors || []) {
    const key = normReviewName(c.name);
    if (!key || key === selfKey) continue; // drop the property's own (unreliable) map-pack row
    const prev = byKey.get(key);
    // Prefer the copy that actually carries a rating (and a review count).
    if (!prev || (prev.rating == null && c.rating != null)) {
      byKey.set(key, { name: c.name, rating: c.rating ?? null, reviews: c.reviews ?? null });
    }
  }
  const list: ReviewEntry[] = [...byKey.values()];
  if (self.rating != null) {
    list.push({ name: self.name, rating: self.rating, reviews: self.reviews ?? null, isSelf: true });
  }
  // If nothing has a rating, there's no meaningful ranking to render.
  if (!list.some((e) => e.rating != null)) return [];
  list.sort((a, b) => {
    if (a.rating == null && b.rating == null) return 0;
    if (a.rating == null) return 1;
    if (b.rating == null) return -1;
    return b.rating - a.rating;
  });
  return list.slice(0, cap);
}

/**
 * 1-based position of the property among the RATED entries in a ranked list, plus
 * the count of rated entries. null when the property isn't present or has no rating.
 */
export function selfReviewPosition(list: ReviewEntry[]): { pos: number; total: number } | null {
  const rated = (list || []).filter((e) => e.rating != null);
  const idx = rated.findIndex((e) => e.isSelf);
  if (idx < 0) return null;
  return { pos: idx + 1, total: rated.length };
}
