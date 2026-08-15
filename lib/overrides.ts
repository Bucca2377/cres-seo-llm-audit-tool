import type { MarketingConsistencyRow, MarketingSourceCell } from "./property";

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
