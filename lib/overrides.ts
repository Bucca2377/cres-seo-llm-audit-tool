import type { MarketingConsistencyRow, MarketingSourceCell, RecommendationCard } from "./property";
import { allFindingCards } from "./coverage";

/**
 * Manual team corrections to the Marketing Audit's ILS & Google Consistency
 * grid. Each of the three platform columns of each row can be overridden with a
 * team-chosen status + note that REPLACES the auto-detected verdict on screen
 * and in the printed client report — for the case where the automated check is
 * uncertain (amber "Check") or plain wrong and a human knows the ground truth
 * (e.g. "confirmed no virtual tour"). Overrides live on the property record and
 * survive audit re-runs (keyed by the stable row label + platform), so a
 * correction sticks until the team resets it back to auto.
 */
export type OverridePlatform = "apartments" | "google" | "website";

export const OVERRIDE_PLATFORMS: OverridePlatform[] = ["apartments", "google", "website"];

/**
 * Stable key for one cell's override. Keyed by the row's LABEL (normalized:
 * lowercased, whitespace-collapsed, trimmed) + the platform — never the row
 * index, so a correction stays attached to "Virtual tour" even if the audit
 * reorders rows on a later run.
 */
export function overrideKey(label: string, platform: OverridePlatform): string {
  const norm = (label || "").toLowerCase().replace(/\s+/g, " ").trim();
  return `${norm}::${platform}`;
}

/**
 * The override stored for a cell, or null if none. Pure lookup.
 */
export function cellOverride(
  overrides: Record<string, MarketingSourceCell> | undefined,
  label: string,
  platform: OverridePlatform
): MarketingSourceCell | null {
  if (!overrides) return null;
  const o = overrides[overrideKey(label, platform)];
  return o ? { status: o.status, note: o.note } : null;
}

/**
 * Return a NEW consistency array with any stored overrides applied on top of
 * the auto-detected cells. Non-mutating — used by both the on-screen table and
 * the printed report so the corrected values render identically in each.
 */
export function applyConsistencyOverrides(
  rows: MarketingConsistencyRow[],
  overrides: Record<string, MarketingSourceCell> | undefined
): MarketingConsistencyRow[] {
  if (!overrides || Object.keys(overrides).length === 0 || !rows?.length) return rows;
  return rows.map((row) => ({
    ...row,
    apartments: cellOverride(overrides, row.label, "apartments") ?? row.apartments,
    google: cellOverride(overrides, row.label, "google") ?? row.google,
    website: cellOverride(overrides, row.label, "website") ?? row.website,
  }));
}

/**
 * Immutably set (or clear, when `next` is null) one cell override on a map.
 * Returns a new map; the caller persists it on the property.
 */
export function withCellOverride(
  overrides: Record<string, MarketingSourceCell> | undefined,
  label: string,
  platform: OverridePlatform,
  next: MarketingSourceCell | null
): Record<string, MarketingSourceCell> {
  const map = { ...(overrides || {}) };
  const key = overrideKey(label, platform);
  if (next && next.status) {
    map[key] = { status: next.status, note: (next.note || "").trim() };
  } else {
    delete map[key];
  }
  return map;
}

// ---------------------------------------------------------------------------
// Override lifecycle: confirmed issues -> recommendations, and cure recognition
// ---------------------------------------------------------------------------

const REACTIVATION_MARKER = /reactivate the apartments\.com listing/i;
const REC_PRIORITY_RANK: Record<string, number> = {
  FOUNDATIONAL: 0,
  "QUICK WIN": 1,
  "MAP PACK": 2,
  "AI VISIBILITY": 3,
  CONTENT: 4,
  STRATEGIC: 5,
  "LONG-TAIL": 6,
};

/**
 * The recommendations to actually SHOW, given the team's overrides. Marketing
 * recs are a deterministic function of the consistency table (lib/coverage
 * turns every RED cell into a fix card), so we recompute them from the
 * OVERRIDDEN table: a cell the team marked "Issue" gains its fix card, and a
 * cell they marked "Good" drops the auto-generated one. The Apartments.com
 * reactivation card (not derived from a red cell) is preserved from the stored
 * set. With no overrides the stored recs are returned untouched, so this can
 * never diverge from what the audit run produced.
 */
export function effectiveMarketingRecommendations(
  storedRecs: RecommendationCard[],
  rawConsistency: MarketingConsistencyRow[],
  overrides: Record<string, MarketingSourceCell> | undefined
): RecommendationCard[] {
  if (!overrides || Object.keys(overrides).length === 0) return storedRecs;
  const eff = applyConsistencyOverrides(rawConsistency, overrides);
  const reactivation = (storedRecs || []).filter((c) => REACTIVATION_MARKER.test(c?.title || ""));
  const aptIsDark = reactivation.length > 0;
  const tableCards = allFindingCards(eff, { aptIsDark }) as RecommendationCard[];
  return [...reactivation, ...tableCards].sort(
    (a, b) => (REC_PRIORITY_RANK[a.priority] ?? 9) - (REC_PRIORITY_RANK[b.priority] ?? 9)
  );
}

/**
 * On a fresh audit run, drop any "Issue" (red) override whose cell the detector
 * now POSITIVELY reports as Good (green) — the flagged problem is genuinely
 * fixed, so the manual flag has served its purpose and is cleared (the cell
 * reverts to the live Good result). Overrides the detector still can't confirm
 * (auto stays amber/na/red) are LEFT in place, so a flaky check never silently
 * erases a real finding. Returns the trimmed override map plus the resolved
 * cells for the "resolved since you flagged it" note. Pure.
 */
export function resolveCuredOverrides(
  overrides: Record<string, MarketingSourceCell> | undefined,
  freshConsistency: MarketingConsistencyRow[]
): {
  next: Record<string, MarketingSourceCell>;
  resolved: { label: string; platform: OverridePlatform }[];
} {
  const resolved: { label: string; platform: OverridePlatform }[] = [];
  if (!overrides || Object.keys(overrides).length === 0) return { next: overrides || {}, resolved };
  const next = { ...overrides };
  const norm = (s: string) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
  for (const [key, cell] of Object.entries(overrides)) {
    if (cell?.status !== "red") continue;
    const sep = key.lastIndexOf("::");
    if (sep < 0) continue;
    const normLabel = key.slice(0, sep);
    const platform = key.slice(sep + 2) as OverridePlatform;
    if (!OVERRIDE_PLATFORMS.includes(platform)) continue;
    const row = (freshConsistency || []).find((r) => norm(r.label) === normLabel);
    if (row && row[platform]?.status === "green") {
      delete next[key];
      resolved.push({ label: row.label, platform });
    }
  }
  return { next, resolved };
}

/**
 * Return the override map WITHOUT any cell on the given platform column. Used so
 * a property marked "no Apartments.com listing" shows the deterministic N/A for
 * that whole column, ignoring stale per-cell edits made before the flag was set.
 */
export function overridesExcludingPlatform(
  overrides: Record<string, MarketingSourceCell> | undefined,
  platform: OverridePlatform
): Record<string, MarketingSourceCell> {
  if (!overrides) return {};
  const suffix = `::${platform}`;
  const out: Record<string, MarketingSourceCell> = {};
  for (const [k, v] of Object.entries(overrides)) if (!k.endsWith(suffix)) out[k] = v;
  return out;
}
