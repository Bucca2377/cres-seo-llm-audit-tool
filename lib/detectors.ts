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
  /waived?\s+\w{0,12}\s*(application|app|admin|amenity|move|fee)|(application|app|admin|amenity|move[-\s]?in)\s+fees?\s+waived|(half|1\/2)[-\s]?off|(first|1st|one|two|three|1|2|3)\s+month.?s?\s+free|\d+\s+weeks?\s+free|move[-\s]?in\s+special|limited[-\s]?time\s+special|look\s*(and|&|\+)\s*lease|\$\d[\d,]*\s*off|\d+%\s*off|reduced\s+deposit|\$0\s+(security\s+)?deposit|deposit\s+special|\brent\s+special|months?\s+free\s+rent|\$[\d,]+\s+(?:in\s+)?free\s+rent|\$\d[\d,]*\s*(?:\w+\s+){0,2}gift\s*cards?/i;
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
  // past the cap and truncated it. Stopping at "=" keeps the match on one page.
  const re = new RegExp("[^.!?\\n=]*(?:" + CONCESSION_RE.source + ")[^.!?\\n=]*", "gi");
  // A special can appear more than once (a clean hero banner AND a messy social-feed
  // post with hashtags/carousel labels around it). Clean EACH candidate and keep the
  // longest — the fullest clean wording — instead of whichever matched first.
  let best: string | null = null;
  for (const m of flat.matchAll(re)) {
    const cleaned = cleanSpecial(m[0]);
    if (cleaned && (!best || cleaned.length > best.length)) best = cleaned;
  }
  return best;
}

/** Strip a single concession window down to clean, readable special wording. */
function cleanSpecial(rawWindow: string): string | null {
  let raw = rawWindow;
  // Belt-and-suspenders: if a transcript header still leaked in on some other
  // separator, drop everything up to its closing "===" or "(status NNN)" marker.
  const sep = raw.lastIndexOf("===");
  if (sep >= 0) raw = raw.slice(sep + 3);
  raw = raw.replace(/.*\(status\s+\d+\)\s*/i, ""); // raw is already single-line (whitespace collapsed)
  raw = raw
    .replace(/#[A-Za-z0-9_]+/g, " ") // social hashtags (#washu, #stl) around a feed post
    .replace(/\b\d+\s*\(current\)\s*\d*/gi, " ") // image-carousel / slider pager ("1 (current) 2")
    .replace(/\\+/g, " ") // JSON-escape residue (\/, \", \\) that leaks in from raw HTML
    .replace(/\s+/g, " ")
    .trim();
  // TRIM THE LEADING EDGE to the actual offer. The window grabs everything back to the
  // last sentence break, which on a nav-heavy page is a long run of menu text ("Skip to
  // main content Resident Login Our Team About Us …") sitting before the concession —
  // and the length cap would then return only that nav prefix. Start the special at the
  // concession phrase itself, but back up to include an immediately-preceding "$amount"
  // lead-in (e.g. "$99 PLUS receive $250 off …") so the deposit half isn't dropped.
  const cm = raw.match(CONCESSION_RE);
  if (cm && cm.index !== undefined && cm.index > 0) {
    let start = cm.index;
    const lead = raw.slice(Math.max(0, start - 45), start);
    const dollarLead = lead.search(/\$\s?\d/);
    if (dollarLead >= 0) start = Math.max(0, start - 45) + dollarLead;
    raw = raw.slice(start);
  }
  raw = raw.replace(/^[^A-Za-z0-9$]+/, "").trim(); // leading punctuation/space
  // Cap length but never cut mid-word (a "$5" tail from "$500" reads as an error).
  if (raw.length > 110) raw = raw.slice(0, 110).replace(/\s+\S*$/, "");
  return raw || null;
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
 * Does a recommendation propose a PAID review-incentive program — the daily
 * $25-per-named-review employee bonus or the monthly $150 / $250 team bonuses (or a
 * cash/gift-card review incentive)? Used to GATE these out for a property already
 * rated above 4.25, where paying to generate reviews just wastes money. The three
 * program dollar amounts are unambiguous in a review-audit rec; the incentive/bonus
 * phrasing catches reworded versions. Responding to reviews, texting a review link,
 * and QR touchpoints are FREE tactics and correctly return false.
 */
export function recommendsReviewIncentive(text: string): boolean {
  const t = (text || "").toLowerCase();
  if (/\$\s?(?:25|150|250)\b/.test(t)) return true; // the exact CRES program amounts
  if (/named[-\s]?review|review[-\s]?incentive|incentive\s+(?:per|for)\s+(?:a\s+)?(?:review|\d|four|five)/.test(t)) return true;
  if (/monthly\s+(?:team\s+)?bonus|commission\s+bonus|staff\s+bonus|team\s+bonus/.test(t)) return true;
  return false;
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

/**
 * Extract the FIRST complete, balanced JSON object from a model response. The old
 * `text.match(/\{[\s\S]*\}/)` grabbed from the first "{" to the LAST "}", so any
 * trailing prose or a second object after the JSON produced "Unexpected non-whitespace
 * character after JSON" on parse. This walks braces (respecting quoted strings and
 * escapes) and returns just the first balanced object, or null if none is complete
 * (e.g. a truncated response) so the caller can fail with a clear, retryable message.
 */
export function extractFirstJsonObject(text: string): string | null {
  const s = text || "";
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') {
      inStr = true;
    } else if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null; // never balanced -> truncated / malformed
}
