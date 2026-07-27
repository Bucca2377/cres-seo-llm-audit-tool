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
  // Exclude "=" from the sentence window: the crawl transcript joins pages with a
  // "=== <url> (status 200) ===" header, and a greedy match otherwise reaches back
  // across that separator and prepends the header's URL/status noise to the special
  // (e.g. "com/ (status 200) === LOOK & LEASE…"), which also pushed the real wording
  // past the 90-char cap and truncated it. Stopping at "=" keeps the match on one page.
  const sentence = flat.match(new RegExp("[^.!?\\n=]*(?:" + CONCESSION_RE.source + ")[^.!?\\n=]*", "i"));
  if (!sentence) return null;
  let raw = sentence[0];
  // Belt-and-suspenders: if a transcript header still leaked in on some other
  // separator, drop everything up to its closing "===" or "(status NNN)" marker.
  const sep = raw.lastIndexOf("===");
  if (sep >= 0) raw = raw.slice(sep + 3);
  raw = raw.replace(/.*\(status\s+\d+\)\s*/i, ""); // raw is already single-line (whitespace collapsed)
  return (
    raw
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
 * Extract the Apartments.com listing's OWN concession from its RAW HTML. The model
 * reader misreads this (it has reported stale/fabricated offers like "Apply by July
 * 3" when the listing actually shows the current Summer Savings offer). The real
 * offer lives in the listing's rent-specials section — the `<p class="copy">` terms,
 * with the short `data-specials-label` attribute as a fallback. Deliberately reads
 * ONLY the property's own specials section (not `specialFromHtml`, which scans the
 * whole page and can grab a nearby-listing offer or raw attribute markup). Returns a
 * clean string or null when the listing shows no special this fetch.
 */
export function aptConcessionFromRawHtml(html: string): string | null {
  if (!html) return null;
  const secStart = html.search(/id="rentSpecialsSection"/i);
  if (secStart >= 0) {
    const gt = html.indexOf(">", secStart);
    const chunk = gt >= 0 ? html.slice(gt + 1, gt + 1200) : "";
    const copy = chunk.match(/<p[^>]*class="[^"]*copy[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
    const raw = copy ? copy[1] : chunk;
    const text = raw
      .replace(/&bull;|&#8226;|•/gi, " · ")
      .replace(/&amp;/gi, "&")
      .replace(/&nbsp;/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/[^\x20-\x7E·]/g, " ") // drop mangled emoji / non-ASCII
      .replace(/\s+/g, " ")
      .replace(/^[\s·*]+/, "")
      .trim();
    if (text && text.length > 5) return text.slice(0, 150);
  }
  const label = html.match(/data-specials-label="([^"]{2,80})"/i);
  if (label && label[1].trim()) return label[1].trim();
  return null;
}

/**
 * Google Business Profile PHOTOS are NEVER our recommendation — the gallery is a
 * mix of owner + visitor uploads the property doesn't control, it's assessed on the
 * scorecard, and telling a property to "refresh the Google photo gallery" has been a
 * recurring bad rec. Drop any recommendation about the GBP photo gallery. True when
 * the text targets Google AND is about photos/gallery/images.
 */
export function recommendsGooglePhotos(text: string): boolean {
  const t = text || "";
  const google = /\bgoogle\b|\bgbp\b|business profile/i.test(t);
  const photos = /\bphotos?\b|\bgallery\b|\bimages?\b|\bphotography\b/i.test(t);
  return google && photos;
}

/**
 * Does an Apartments.com listing have a virtual tour, judged from RAW HTML? The
 * model's media-summary read flip-flops (reported "6 virtual tours" one run, "none"
 * the next). A Matterport / 3D / virtual-tour marker in the raw HTML is a reliable
 * PRESENCE signal — e.g. Main & Stone's listing has a "Matterport 3D Tours" tab and
 * embed. Returns true when present, null when undeterminable (never asserts absence,
 * so a thin fetch can't wrongly flip the cell to a red "no tour").
 */
export function aptHasVirtualTourFromRawHtml(html: string): boolean | null {
  if (!html || html.length < 500) return null;
  return /matterport|\b3d\s*tours?\b|virtual\s*tours?\b/i.test(html) ? true : null;
}

/**
 * Extract the "View Property Website" outbound link from an Apartments.com listing's
 * RAW HTML, so we can confirm the listing actually links to the property's real site
 * (not a dead/wrong URL). On apartments.com this is a direct anchor to the property
 * domain (with a `?switch_cls[id]=…` tracking param), tagged class="propertyWebsiteLink"
 * / title="View Property Website". Returns the href (HTML-entity-decoded) or null.
 */
export function aptWebsiteLinkFromRawHtml(html: string): string | null {
  if (!html) return null;
  const m =
    html.match(/<a\b[^>]*\bhref="([^"]+)"[^>]*(?:class="[^"]*propertyWebsiteLink[^"]*"|title="View Property Website")/i) ||
    html.match(/<a\b[^>]*(?:class="[^"]*propertyWebsiteLink[^"]*"|title="View Property Website")[^>]*\bhref="([^"]+)"/i);
  if (!m) return null;
  const href = (m[1] || "").replace(/&amp;/gi, "&").trim();
  return /^https?:\/\//i.test(href) ? href : null;
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

/**
 * Drop dial-confirmed PHANTOM phone numbers from a dialed inventory. A `dialStatus`
 * of "failed" means the carrier couldn't even place the call (invalid / unreachable),
 * i.e. a number the property doesn't actually use — a misparse (bogus area code) or a
 * leasing-widget (Funnel / RentCafe) call-tracking number injected into the DOM that
 * isn't a live line and never appears on the visible site. The tool's own principle
 * is "what matters is that each number DIALS the property," so a number that provably
 * doesn't dial is noise, not a finding.
 *
 * Guards: only prunes when at least one number actually CONNECTED (so a Twilio-wide
 * outage where everything "failed" never wipes the whole list), and never returns an
 * empty list. Generic over the entry shape — only `dialStatus` is read.
 */
export function dropDeadDialedNumbers<T extends { dialStatus?: string | null }>(numbers: T[]): T[] {
  const list = numbers || [];
  if (!list.some((n) => n?.dialStatus === "connected")) return list;
  const kept = list.filter((n) => n?.dialStatus !== "failed");
  return kept.length ? kept : list;
}
