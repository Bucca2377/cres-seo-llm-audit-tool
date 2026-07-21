/**
 * Shared, PURE detection logic for the audit — the pieces that historically kept
 * relapsing. Single source of truth (previously duplicated in app/page.tsx and
 * app/api/fetch/route.ts, which had already drifted apart) so a fix can't silently
 * regress in one copy. Covered by tests/detectors.test.ts — change these only with
 * the tests green.
 *
 * Everything here is framework-free (no React/Next/DOM) so it imports cleanly into
 * both the client component and the API routes, and runs in a plain test process.
 */

/**
 * HIGH-PRECISION move-in-special / concession phrases. Deliberately narrow: it must
 * fire on real specials (waived/reduced fees, half-off·free·reduced deposit, N
 * months/weeks free, move-in / limited-time special, $/% off) but NOT on ordinary
 * "security deposit", "application fee: $X", or "no specials". Verified across real
 * property sites (Sawmill, Edge 26, Sixcord, Station House).
 */
export const CONCESSION_RE =
  /waived?\s+\w{0,12}\s*(application|app|admin|amenity|move|fee)|(application|app|admin|amenity|move[-\s]?in)\s+fees?\s+waived|(half|1\/2)[-\s]?off|(first|1st|one|two|three|1|2|3)\s+month.?s?\s+free|\d+\s+weeks?\s+free|move[-\s]?in\s+special|limited[-\s]?time\s+special|look\s*(and|&|\+)\s*lease|\$\d[\d,]*\s*off|\d+%\s*off|reduced\s+deposit|\$0\s+(security\s+)?deposit|deposit\s+special|\brent\s+special|months?\s+free\s+rent|\$[\d,]+\s+(?:in\s+)?free\s+rent/i;
// NOTE: `\brent` (word boundary) is deliberate — a bare `rent\s+special` matched
// inside "cur-RENT SPECIALs" and false-flagged "no current specials" as a concession
// (caught by tests/detectors.test.ts). Keep boundaries on substring-prone words.

/**
 * Detect a concession in already-rendered/visible page text (crawled site text).
 * Returns the special's own wording (cleaned, <=90 chars) or null. Banner or popup
 * — it's text-based, so it doesn't matter which; it just needs the words present.
 */
export function detectWebsiteSpecial(siteText: string): string | null {
  const flat = (siteText || "").replace(/\s+/g, " ");
  const sentence = flat.match(new RegExp("[^.!?\\n]*(?:" + CONCESSION_RE.source + ")[^.!?\\n]*", "i"));
  if (!sentence) return null;
  return (
    sentence[0]
      .replace(/\\+/g, " ") // drop JSON-escape residue (\/, \", \\) that leaks in from raw HTML
      .replace(/\s+/g, " ")
      .replace(/^[^A-Za-z0-9$]+/, "")
      .trim()
      .slice(0, 90) || null
  );
}

/**
 * Pull a concession out of RAW HTML (before tag-stripping) — the special often
 * lives in an embedded <script> JSON that htmlToText would remove. JSON-unescapes a
 * window around the match into a clean string. Returns null when none is present.
 */
export function specialFromHtml(html: string): string | null {
  const m = (html || "").match(CONCESSION_RE);
  if (!m || m.index === undefined) return null;
  return (
    html
      .slice(Math.max(0, m.index - 90), m.index + 170)
      .replace(/\\u([0-9a-fA-F]{4})/g, (_full, h) => {
        try {
          return String.fromCharCode(parseInt(h, 16));
        } catch {
          return " ";
        }
      })
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\")
      .replace(/\\\//g, "/")
      .replace(/\\[nrt]/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/[^\x20-\x7E]/g, "")
      .replace(/\s+/g, " ")
      .trim() || null
  );
}

/**
 * Is an Apartments.com listing actively advertising, judged from its RAW HTML?
 * The "not currently advertising" banner is painted by JavaScript and is in NO
 * fetched HTML, so it can't be matched. The stable structural signals ARE in the
 * raw HTML: an ACTIVE listing renders the property's own "Pricing & Floor Plans" /
 * "Monthly Rent" section; a DARK shell has neither and pushes "Explore Similar
 * Rentals Nearby". Run on RAW HTML (not web_fetch's rendered text, which pulls in
 * the nearby-listing rents and false-positives). null = undeterminable.
 */
export function aptAdvertisingFromRawHtml(html: string): boolean | null {
  if (!html || html.length < 500) return null;
  const ownPricing = /pricing\s*&?\s*floor\s*plans|monthly\s+rent/i.test(html);
  if (ownPricing) return true;
  if (/explore similar rentals nearby/i.test(html)) return false;
  return null;
}

/**
 * A Google Business Profile does NOT carry pricing, concessions/specials, virtual
 * tours, preferred-employer programs, online applications, or tour scheduling — the
 * consistency table marks those Google cells "Not a Google feature." So a
 * recommendation telling the property to ADD one of those TO Google contradicts the
 * report and must be dropped. True = the card targets Google with a non-Google
 * feature (e.g. "add the concession to Google posts", "publish the virtual tour to
 * Google"). Office hours, photos, reviews, description, and the website link ARE
 * Google features, so recs about those correctly return false.
 */
export function recommendsNonGoogleFeatureOnGoogle(text: string): boolean {
  const t = text || "";
  const targetsGoogle = /\bgoogle\b|\bgbp\b/i.test(t);
  if (!targetsGoogle) return false;
  return /\b(concession|move[-\s]?in special|virtual tour|matterport|floor\s?plans?|pricing|rent range|preferred[-\s]?employer|online application|application portal|apply online|tour scheduling|schedule a tour)\b/i.test(
    t
  );
}

/** Verbs that mean "put a NEW special on the site" (invent/introduce one). */
const CONCESSION_CREATE_VERB =
  /\b(add|adding|create|creating|launch\w*|introduc\w*|start\w*|establish\w*|roll[-\s]?out|implement\w*|design\w*|develop\w*|offer\w*|build\w*|feature\w*|display\w*|promot\w*|advertis\w*|run|highlight\w*|put|include)\b/i;
/** Move-in-concession / limited-time-offer nouns (NOT generic "discount"/"waived fees",
 *  which would wrongly catch a preferred-employer program card). */
const CONCESSION_NOUN =
  /\b(concession|move[-\s]?in\s+(?:special|incentive|offer)|limited[-\s]?time\s+(?:special|offer|promo\w*)|specials?\s+section|rent\s+special)\b/i;
/** Third-party listing platforms — if a rec names one, it's DISTRIBUTING/syncing an
 *  existing special there, not inventing one on the property's own site. */
const CONCESSION_PLATFORM =
  /\b(apartments\.?com|apartmentfinder|for\s?rent|zillow|google|gbp|facebook|instagram|apartment\s?list|zumper|rent\.com)\b/i;

/**
 * Does a recommendation propose CREATING / ADDING a move-in concession or
 * limited-time special to the property's own site (i.e. inventing one)? This audit
 * is marketing HYGIENE, not revenue strategy — telling a property to invent a
 * discount is out of scope, and when a special already runs the rec is also just
 * wrong. Either way it must never reach the client. It has relapsed repeatedly
 * ("Add move-in concession or limited-time offer to website", "Design a move-in
 * special…") because the model reintroduces it every few runs and the old filter
 * (a) missed the verbs "add"/"design" and (b) only fired when we happened to detect
 * the banner that run. This is UNCONDITIONAL by design.
 *
 * It deliberately does NOT fire on SYNCING an EXISTING special to a named
 * third-party platform (e.g. "add the current move-in special to the Apartments.com
 * listing") — those name a platform and are legitimate distribution recs — nor on
 * unrelated programs that merely mention a discount (e.g. a preferred-employer
 * program), which don't use concession/special nouns.
 */
export function recommendsCreatingConcession(text: string): boolean {
  const t = text || "";
  if (!CONCESSION_NOUN.test(t)) return false;
  if (!CONCESSION_CREATE_VERB.test(t)) return false;
  if (CONCESSION_PLATFORM.test(t)) return false; // distributing an existing special, not inventing one
  return true;
}
