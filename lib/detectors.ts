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
