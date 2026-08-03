/**
 * Set-aside / mark-done matching for recommendation cards. PURE + tested.
 *
 * A card the user sets aside or marks Done is identified by a key so it (a) drops
 * out of the active list now and (b) can be recognized again on a later run. The
 * key MUST identify the SPECIFIC card, not a broad topic: an earlier version keyed
 * cards by a coarse topic bucket ("review-generation"), which in the review audit —
 * where every rec is review-related — collapsed the bonus rec, the QR-code rec, and
 * the solicitation rec into ONE bucket, so setting one aside removed them all. The
 * key is the normalized TITLE; cross-run suppression of a reworded twin is handled
 * separately by feeding the set-aside titles back into the audit prompt.
 *
 * Covered by tests/detectors.test.ts.
 */
import type { RecommendationCard, SetAsideRec } from "./property";

/** Normalize a rec title to a stable per-card key (lowercased, punctuation flattened). */
export function normRecTitle(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Stable key identifying a SPECIFIC recommendation card (its normalized title). */
export function setAsideKey(card: RecommendationCard): string {
  return normRecTitle(card.title);
}

/**
 * Build the match-set from a property's set-aside list, keyed by each entry's
 * normalized TITLE. Keying on the title (not the stored `key`) also migrates old
 * entries that were saved under the coarse topic key — they still match their own
 * card by title, and only that card.
 */
export function setAsideKeySet(list: SetAsideRec[] | undefined): Set<string> {
  return new Set((list ?? []).map((s) => normRecTitle(s.title)));
}

/** True when a card matches something in the set-aside / done match-set. */
export function isSetAside(card: RecommendationCard, keys: Set<string>): boolean {
  return keys.has(setAsideKey(card));
}
