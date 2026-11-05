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
  // DO NOT match the bare words: every Apartments.com listing carries a generic
  // "Virtual Tour" tab, "virtualtour-tab" markup, and even a matterport.com/show
  // script on the page whether or not THIS listing has a tour (The Flats at Leland
  // has 89 "virtual tour" hits + a matterport embed yet zero tours). The ONLY
  // reliable signal is the media-badge COUNT — "2 Virtual Tours" — which appears only
  // when the listing actually has them. No positive count => not present via this signal.
  const m = html.match(/(\d+)\s*virtual\s*tours?\b/i);
  return m && parseInt(m[1], 10) > 0 ? true : null;
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

// ---------------------------------------------------------------------------
// SEO-recommendation guards (deterministic drops for audit-QA accuracy issues)
// ---------------------------------------------------------------------------

/**
 * A recommendation that promises a Google "FAQ rich result / rich snippet".
 * Google DISCONTINUED FAQ rich results in 2026, so these are outdated and dropped.
 * Plain FAQ CONTENT recs (for AI-assistant visibility / on-page depth) are NOT
 * matched — only the ones tying FAQ to a Google rich result/snippet.
 */
export function promisesFaqRichResult(text: string): boolean {
  const t = (text || "").toLowerCase();
  return /\bfaq/.test(t) && /\brich\s+(?:result|results|snippet|snippets)\b/.test(t);
}

/**
 * The bedroom counts a property actually offers, parsed from its free-text
 * `bedroomTypes` field ("Studio, 1, 2" / "one, two, three bedroom" / "Studio - 2
 * Bed"). That field is controlled, so bare digits in it ARE bed counts. Returns a
 * Set of tokens: "studio" plus numeric strings "1".."5". Empty set = unknown.
 */
export function offeredBedroomCounts(bedroomTypes: string): Set<string> {
  const t = (bedroomTypes || "").toLowerCase();
  const out = new Set<string>();
  if (!t.trim()) return out;
  if (/studio|efficienc|\bzero\b|\b0\s*(?:bed|br|bd)\b/.test(t)) out.add("studio");
  const words: Record<string, string> = { one: "1", two: "2", three: "3", four: "4", five: "5" };
  for (const [w, n] of Object.entries(words)) if (new RegExp(`\\b${w}\\b`).test(t)) out.add(n);
  for (const d of t.match(/[1-5]/g) || []) out.add(d);
  return out;
}

/**
 * True when a recommendation's text proposes a floorplan the property does NOT
 * offer (the "invented floorplan" error, e.g. adding 3-bedroom copy to a property
 * with only studios–2BR). Matches ONLY explicit bed-count PHRASES ("studio",
 * "three-bedroom", "3 bed", "3br") — never a bare digit in prose — so a sqft or
 * price number can't trip it. Returns false when the offered set is unknown.
 */
export function recInventsFloorplan(text: string, offered: Set<string>): boolean {
  if (!offered || offered.size === 0) return false;
  const t = (text || "").toLowerCase();
  const found = new Set<string>();
  if (/\bstudio\b/.test(t)) found.add("studio");
  const words: Record<string, string> = { one: "1", two: "2", three: "3", four: "4", five: "5" };
  for (const [w, n] of Object.entries(words)) if (new RegExp(`\\b${w}[-\\s]?bed`).test(t)) found.add(n);
  for (const m of t.match(/\b[1-5][-\s]?(?:bed|br\b|bedroom)/g) || []) {
    const d = m.match(/[1-5]/);
    if (d) found.add(d[0]);
  }
  for (const c of found) if (!offered.has(c)) return true;
  return false;
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * True when a concession's stated deadline ("move in by September 25th",
 * "m/i by 9/25", "apply by Sept. 25") is already in the past, i.e. the text is
 * STALE. Farmhouse's audit reported "m/i by September 25th" weeks after the
 * listing changed to a November offer: the web_fetch read served an old copy.
 * A date with no year is read as this year, unless that is more than ~6 months
 * ago, in which case it means next year ("by January 15" read in November).
 * No recognizable deadline -> false (can't tell, keep the text).
 */
export function concessionDeadlinePassed(text: string, now: Date = new Date()): boolean {
  const t = (text || "").toLowerCase();
  let month = -1;
  let day = -1;
  let year: number | null = null;
  const named = t.match(/\bby\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/);
  const numeric = t.match(/\bby\s+(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (named) {
    month = MONTHS[named[1]];
    day = parseInt(named[2], 10);
    if (named[3]) year = parseInt(named[3], 10);
  } else if (numeric) {
    month = parseInt(numeric[1], 10) - 1;
    day = parseInt(numeric[2], 10);
    if (numeric[3]) year = parseInt(numeric[3].length === 2 ? "20" + numeric[3] : numeric[3], 10);
  }
  if (month < 0 || month > 11 || day < 1 || day > 31) return false;
  const endOfDay = (y: number) => new Date(y, month, day, 23, 59, 59);
  if (year != null) return endOfDay(year).getTime() < now.getTime();
  const thisYear = endOfDay(now.getFullYear());
  if (thisYear.getTime() >= now.getTime()) return false;
  const SIX_MONTHS_MS = 183 * 24 * 3600 * 1000;
  return now.getTime() - thisYear.getTime() <= SIX_MONTHS_MS;
}

/**
 * Apartments.com media counts ("36 Photos", "6 Virtual Tours", "1 Video") read
 * from the listing's fetched page content. The gallery shows them as three
 * separate buttons, and the model reader tends to copy only the first one
 * ("36 Photos"), which turned 6 real tours into "no virtual tour" (Farmhouse).
 * Returns null when the page content doesn't carry the photo button.
 */
export function aptMediaCountsFromContent(content: string): { photos: number; virtualTours: number | null; videos: number | null } | null {
  const c = content || "";
  const photos = c.match(/(\d+)\s*photos?\b/i);
  if (!photos || photos.index == null) return null;
  // Tours/videos sit right next to the photo button. Read only that window so a
  // "Similar Rentals Nearby" card further down can't lend its own tour count.
  const win = c.slice(photos.index, photos.index + 400);
  const vt = win.match(/(\d+)\s*virtual\s*tours?\b/i);
  const vid = win.match(/(\d+)\s*videos?\b/i);
  return {
    photos: parseInt(photos[1], 10),
    // Not seen next to the photo button = UNKNOWN, not zero: a miss here must
    // never become a false "no virtual tour" finding.
    virtualTours: vt ? parseInt(vt[1], 10) : null,
    videos: vid ? parseInt(vid[1], 10) : null,
  };
}

/**
 * Review-solicitation tactics a property can already have in place. The team
 * ticks these per property (Property.reviewTacticsInPlace) so the audits stop
 * recommending what the site already does. Farmhouse's management pointed out
 * every property has an office QR plaque, direct Google review links, and
 * maintenance door hangers with the QR, yet the report recommended them.
 */
export const REVIEW_TACTICS: { id: string; label: string; match: (t: string) => boolean }[] = [
  {
    id: "qr_office",
    label: "QR code review plaque in the leasing office",
    match: (t) => /\bqr\b/.test(t) && /\b(plaque|sign|signage|front desk|leasing office|office|desk|lobby|clubhouse)\b/.test(t),
  },
  {
    id: "direct_link",
    label: "Direct Google review link shared with residents",
    match: (t) => /\b(direct|one[-\s]?tap|short)\s+(google\s+)?review\s+links?\b/.test(t),
  },
  {
    id: "door_hangers",
    label: "Maintenance door hangers with a review QR code",
    match: (t) => /\bdoor[-\s]?hangers?\b/.test(t),
  },
];

/**
 * True when a recommendation TITLE proposes setting up a tactic the property
 * already has (a setup verb plus the tactic). Using an existing tactic better
 * ("text the review link within 24 hours of a closed work order") is kept.
 */
export function recSetsUpInPlaceTactic(title: string, inPlace: string[] | undefined): boolean {
  if (!inPlace || inPlace.length === 0) return false;
  const t = (title || "").toLowerCase();
  if (!/\b(add|adds|adding|create|generate|set\s*up|install|print|place|post|display|launch|introduce|implement|order|design|make|deploy|roll\s*out|start|leave|hang|attach|distribute|hand\s+out|put)\b/.test(t)) return false;
  return REVIEW_TACTICS.some((tac) => inPlace.includes(tac.id) && tac.match(t));
}

/** Prompt block naming the tactics already in place ("" when none ticked). */
export function reviewTacticsPromptBlock(inPlace: string[] | undefined): string {
  const labels = REVIEW_TACTICS.filter((t) => (inPlace || []).includes(t.id)).map((t) => t.label);
  if (!labels.length) return "";
  return `REVIEW TACTICS ALREADY IN PLACE at this property (confirmed by the property team): ${labels.join("; ")}. Do NOT recommend setting up, adding, printing or installing any of these. You MAY recommend using them more effectively (timing, follow-up, staff habits) or tactics beyond them.`;
}

/** One tracked search's verified positions, for checking claims in a recommendation. */
export interface RankFact {
  query: string;
  branded: boolean;
  /** Every Map Pack position a reader could see for it (this run + the table's smoothed value). */
  mapPack: number[];
  /** Organic position(s), empty when not in the top 30. */
  organic: number[];
}

/**
 * Remove sentences from a model-written recommendation that misstate the audit's
 * own data, and fix the one wording error we can fix in place. Farmhouse's report
 * said "ranks Map Pack #8–#17 for all tested queries" next to a table showing
 * #3, #5 and #6, and "absent from organic top 100" when we only check 30 deep.
 *  - a sentence claiming a Map Pack range for ALL/EVERY query that the data
 *    contradicts (some competitive search ranks outside it, or isn't in the pack);
 *  - a sentence quoting a tracked search followed directly by a "#N" that is
 *    neither its Map Pack nor its organic position;
 *  - a sentence proposing to set up a review tactic the property already runs;
 *  - "top 50/100" depth claims become "top 30" (the depth we actually check).
 */
export function scrubRecClaims(text: string, opts: { ranks?: RankFact[]; inPlace?: string[] }): string {
  if (!text) return text;
  const ranks = opts.ranks || [];
  const comp = ranks.filter((r) => !r.branded);
  const compPositions = comp.flatMap((r) => r.mapPack);
  const anyCompAbsent = comp.some((r) => r.mapPack.length === 0);
  const fixed = text.replace(/\btop[\s-]+(\d{2,3})\b/gi, (m, n) => (parseInt(n, 10) > 30 ? m.replace(n, "30") : m));
  const sentences = fixed.split(/(?<=[.!?])\s+(?=["“(]?[A-Z0-9#])/);
  const keep = sentences.filter((s) => {
    const low = s.toLowerCase();
    if (comp.length && /map\s*pack/.test(low) && /\b(all|every|each)\b/.test(low)) {
      const range = s.match(/#(\d{1,2})\s*(?:–|—|-|to)\s*#?(\d{1,2})\b/);
      if (range) {
        const a = parseInt(range[1], 10);
        const b = parseInt(range[2], 10);
        if (compPositions.some((p) => p < a || p > b) || anyCompAbsent) return false;
      }
    }
    for (const m of s.matchAll(/["“]([^"”]{3,90})["”]/g)) {
      const fact = ranks.find((r) => r.query.trim().toLowerCase() === m[1].trim().toLowerCase());
      if (!fact) continue;
      const after = s.slice((m.index ?? 0) + m[0].length);
      const n = after.match(/^\s*[(,]?\s*(?:(?:map\s*pack|organic|is|at|ranks?)\s*)*#(\d{1,3})\b/i);
      if (n) {
        const v = parseInt(n[1], 10);
        if (!fact.mapPack.includes(v) && !fact.organic.includes(v)) return false;
      }
    }
    if (recSetsUpInPlaceTactic(s, opts.inPlace)) return false;
    return true;
  });
  return keep.join(" ").trim();
}

/**
 * Review tactics a recommendation card is about (ids from REVIEW_TACTICS).
 * Marking such a card "✓ Done" records these as in place, so the tactic stays
 * out of future runs however the model rewords or re-bundles it (the Done list
 * alone matches by exact title).
 */
export function reviewTacticsInText(text: string): string[] {
  const t = (text || "").toLowerCase();
  return REVIEW_TACTICS.filter((tac) => tac.match(t)).map((tac) => tac.id);
}

/**
 * True when the transcript of a test call is a CARRIER INTERCEPT ("The number
 * you have dialed is not in service"). A disconnected US number usually answers
 * with this recording, which answering-machine detection classifies as "machine",
 * so the dial test used to report a dead line as "likely voicemail".
 */
export function isCarrierIntercept(text: string | null | undefined): boolean {
  const t = (text || "").toLowerCase();
  if (!t) return false;
  return /\b(not|no longer) (in|a) (service|working number)\b|\bno longer in service\b|\b(has been|is) disconnected\b|\bnot a working number\b|\bcannot be completed as dialed\b|\bcall (cannot|could not|can ?not) be completed\b|\btemporarily (out of service|disconnected)\b|\bnumber (you have dialed|you dialed|dialed) (is|has)\b[\s\S]{0,40}\b(changed|disconnected|not)\b|\bcheck the number and (dial|try) again\b/.test(t);
}

/**
 * What answered a test call, judged from the transcript of what the line said.
 * More reliable than answering-machine detection, which calls any recording a
 * "machine": Farmhouse's lines answer with a text-back phone menu ("…please press
 * 1… press 2…") that showed as "likely voicemail".
 *   "intercept" carrier not-in-service recording (dead line)
 *   "menu"      automated phone menu / IVR (a working line)
 *   "voicemail" voicemail greeting
 *   "person"    a live greeting ("This is Destiny, how can I assist?", Loch Haven)
 *   null        can't tell from the words (fall back to machine detection)
 */
export function classifyHeard(text: string | null | undefined): "intercept" | "menu" | "voicemail" | "person" | null {
  const t = (text || "").toLowerCase();
  if (!t) return null;
  if (isCarrierIntercept(t)) return "intercept";
  if (/\bpress (\d|one|two|three|four|five|star|pound|zero)\b|\bmain menu\b|\bdial by name\b/.test(t)) return "menu";
  if (/\bleave (a|your) (message|name)\b|\bafter the (tone|beep)\b|\bvoice ?mail\b|\bmailbox\b|\bnot available to take your call\b|\bunable to (take|answer) (your|the) call\b/.test(t)) return "voicemail";
  // A live answer: "how can I/we help / assist" or "<name> speaking". Checked after
  // menu/voicemail, so a recording that also says "press 1" or "leave a message"
  // isn't counted as a person (the call stops listening after a 2s pause, so a
  // greeting that ends on the question is someone waiting for a reply).
  if (/\bhow (can|may) (i|we) (help|assist)\b|\bwhat can (i|we) (do|help)\b|\b[a-z]+ speaking\b/.test(t)) return "person";
  return null;
}
