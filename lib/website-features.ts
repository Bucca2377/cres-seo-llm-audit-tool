/**
 * Deterministic detection of website features from the crawled site text.
 *
 * Why: on JS-heavy property sites (Funnel/RENTCafe, etc.) the real features live on
 * sub-pages and inside widgets our headless crawler can't always render. The model
 * then turned CAPTURE FAILURES ("gallery images not rendered", "preferred-employer
 * page not accessible", "no self-serve scheduler") into red ISSUEs — false negatives
 * that told a client their site was missing things it actually has.
 *
 * These signals, though, almost always survive into the crawled text even when the
 * widget itself doesn't render: the site NAV carries "Preferred Employer Program"
 * and "Floorplans" on every page, buttons carry "Book Your Tour" / "Lease Now", and
 * floor-plan cards carry "Virtual Tour" / "360". A keyword scan across everything we
 * crawled reliably confirms a feature is PRESENT. (Absence is NOT asserted here — you
 * cannot prove a feature is missing from a capture you know is incomplete; the caller
 * treats "not detected" as "verify live", never as a red issue.)
 *
 * Framework-free; covered by tests/detectors.test.ts.
 */

export interface WebsiteFeatureSignals {
  preferredEmployer: boolean;
  virtualTour: boolean;
  tourScheduling: boolean;
  onlineApplication: boolean;
  gallery: boolean;
}

/**
 * Known apartment LEASING PLATFORMS, detected from the site's raw HTML (their embed
 * scripts/iframes). This is how we escape the per-property "dance": these widgets
 * are what hide features (online application, self-serve tour scheduling, live
 * availability) behind JS with no text signal — but they come from a small, finite
 * set of vendors. Recognize the platform once and we can INFER its standard
 * capabilities for every property that uses it. All of these provide online
 * applications, tour scheduling, and availability as core functions.
 */
const LEASING_PLATFORMS: { name: string; re: RegExp }[] = [
  { name: "Funnel", re: /funnelleasing\.com|usefunnel|funnel[-_]?leasing/i },
  { name: "RentCafe", re: /rentcafe\.com|securecafe|yardikube|cafeportal/i },
  { name: "Entrata", re: /entrata\.com|prospectportal|entratacdn/i },
  { name: "RealPage", re: /realpage\.com|onesite|rpx\.realpage/i },
  { name: "AppFolio", re: /appfolio\.com|myappfolio/i },
  { name: "Knock", re: /knockrentals|knockcrm/i },
  { name: "ResMan", re: /myresman|resman\.com/i },
  { name: "RentDynamics", re: /rentdynamics/i },
  // EliseAI (MeetElise) — an AI leasing assistant. It presents office hours, tour
  // scheduling, and applications ONLY inside its chat, so its hours can't be crawled
  // from the page; recognizing it lets the audit defer to Google instead of falsely
  // flagging "couldn't read hours".
  { name: "EliseAI", re: /eliseai\.com|meetelise/i },
];

/** Identify the leasing platform a site runs on from its RAW HTML, or null. */
export function detectLeasingPlatform(html: string): string | null {
  const h = html || "";
  for (const p of LEASING_PLATFORMS) if (p.re.test(h)) return p.name;
  return null;
}

/**
 * Known self-guided VIRTUAL-TOUR hosts. A tour embed (script/iframe/link) or a
 * provider domain listed in the page's JSON is the strongest present-signal — it
 * survives even when the widget itself never renders as visible text. `realync`
 * is a distinctive brand token; `peek` is constrained to a domain-ish shape
 * (peek.us / peek.com / peekpro) so ordinary prose ("take a peek inside") can't
 * false-fire it.
 */
const VIRTUAL_TOUR_HOSTS =
  /my\.matterport\.com|matterport\.com|ricoh360\.com|kuula\.co|cloudpano\.com|zillow\.com[\\/]+view-3d-home|youriguide\.com|realync|peek(?:pro|\.[a-z])/i;

/** Visible-ish tour phrases / link text. Kept tight so bare "360" or "tour"
 *  tokens (common on any site) don't count — only the real tour phrases do. */
const VIRTUAL_TOUR_PHRASES = /virtual\s+tour|3\s*-?\s*d\s*tour|360\s*°?\s*tour|matterport/i;

/**
 * Detect a self-guided VIRTUAL TOUR from a website's RAW rendered HTML (the DOM),
 * not the crawler's visible text. Returns true when the HTML shows a known tour
 * host anywhere (embed script/iframe/link/JSON domain) OR a real tour phrase as
 * visible-ish text. Otherwise false — so a corporate site with a stray "tour" or
 * "360" word does NOT trip it, while every real property site (whose tour lives in
 * a host embed or a "Virtual Tour" link) does.
 */
export function virtualTourFromHtml(html: string): boolean {
  const h = html || "";
  return VIRTUAL_TOUR_HOSTS.test(h) || VIRTUAL_TOUR_PHRASES.test(h);
}

/** Apply / online-application PHRASES. Tight enough that "conditions apply" or
 *  "restrictions apply" can't fire it — only a real apply CALL-TO-ACTION does. */
const APPLY_PHRASES =
  /apply\s+(?:now|online|today)|online\s+application|application\s+portal|start\s+(?:your\s+)?application|lease\s+(?:now|online)/i;
/** Apply LINKS: an href whose path is an application action or points at a
 *  resident-portal application flow. Catches the "Apply Now" button even when
 *  the crawler's visible-text extraction dropped it (it lives in a JS panel). */
const APPLY_HREF =
  /href=["'][^"']*(?:\/apply(?:[-/?"']|now|online|today)|applynow|apply-online|\/application\b|applicant|prospectportal|securecafe|onlineleasing)/i;

/**
 * Detect an ONLINE APPLICATION / Apply path from a website's RAW rendered HTML
 * (the DOM), not the crawler's visible text. Apartment sites surface "Apply Now"
 * in the nav/header/footer and on each floor-plan/availability card — often in a
 * JS-expanded panel whose text the crawl misses, though the anchor + its portal
 * href sit in the DOM. Returns true on a real apply phrase OR an apply-action
 * link; a bare "conditions apply" in prose does NOT trip it.
 */
export function onlineApplicationFromHtml(html: string): boolean {
  const h = html || "";
  return APPLY_PHRASES.test(h) || APPLY_HREF.test(h);
}

export function detectWebsiteFeatures(siteText: string): WebsiteFeatureSignals {
  const t = siteText || "";
  return {
    preferredEmployer: /preferred[-\s]?employer/i.test(t),
    virtualTour: /virtual\s*tour|matterport|3\s*-?\s*d\s*tour|360[^a-z0-9]{0,4}(?:tour|virtual|view)/i.test(t),
    tourScheduling:
      /schedule\s+(?:a\s+|your\s+)?tour|book\s+(?:a\s+|your\s+)?tour|request\s+(?:a\s+)?tour|tour\s+scheduling|self[-\s]?schedul/i.test(
        t
      ),
    onlineApplication:
      /apply\s+(?:now|online|today)|lease\s+now|online\s+application|application\s+portal|start\s+(?:your\s+)?application/i.test(
        t
      ),
    gallery: /\bphoto\s*gallery\b|\bgallery\b/i.test(t),
  };
}

/**
 * The site's FAQ page URL, read from EVERY link on the page (hidden dropdown
 * items included), or null. FAQ links often live in a collapsed nav dropdown,
 * which the visible-text crawl never sees, so the audit falsely said "no FAQ
 * page" for Farmhouse (farmhouseapts.com/faqs/ is under a menu dropdown).
 */
export function faqLinkFromLinks(links: { href: string; text: string }[], origin?: string): string | null {
  for (const l of links || []) {
    const href = l?.href || "";
    if (origin) {
      try {
        if (new URL(href).origin !== origin) continue;
      } catch {
        continue;
      }
    }
    if (/\/faqs?(?:[/?#]|$)|frequently-asked/i.test(href) || /^\s*(?:faqs?|frequently asked questions)\s*$/i.test(l?.text || "")) {
      return href;
    }
  }
  return null;
}

/**
 * On-page SEO facts read from a page's RAW HTML (the Bright Data copy of a site that
 * bot-blocks our crawler). Same fields the crawler reads from the live DOM. The old
 * fallback (web_fetch) only sees page TEXT, so it reported every meta description,
 * H1 and schema block as missing (Reserve at Sawmill: 0/1 meta, no H1, no schema).
 */
export function seoFromRawHtml(
  html: string,
  pageUrl: string
): {
  title: string;
  metaDescription: string;
  h1Count: number;
  h1Text: string;
  hasCanonical: boolean;
  hasSchema: boolean;
  internalLinks: number;
  wordCount: number;
} {
  const decode = (s: string) =>
    s
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&#0?39;|&apos;|&rsquo;/gi, "'")
      .replace(/&quot;/gi, '"')
      .replace(/\s+/g, " ")
      .trim();
  const metaTag = (html.match(/<meta\b[^>]*\bname\s*=\s*["']description["'][^>]*>/i) || [])[0] || "";
  const metaDescription = decode((metaTag.match(/\bcontent\s*=\s*"([^"]*)"/i) || metaTag.match(/\bcontent\s*=\s*'([^']*)'/i) || [])[1] || "");
  const h1s = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => decode(m[1])).filter(Boolean);
  let host = "";
  try {
    host = new URL(pageUrl).host.replace(/^www\./, "");
  } catch {
    /* relative links still count below */
  }
  let internalLinks = 0;
  for (const m of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)["']/gi)) {
    const href = m[1].trim();
    if (/^(mailto|tel|javascript):/i.test(href)) continue;
    if (!/^https?:\/\//i.test(href) || (host && href.replace(/^https?:\/\/(www\.)?/i, "").startsWith(host))) internalLinks++;
  }
  const body = (html.match(/<body\b[\s\S]*$/i) || [html])[0]
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  return {
    title: decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || ""),
    metaDescription,
    h1Count: h1s.length,
    h1Text: h1s[0] || "",
    hasCanonical: /<link\b[^>]*\brel\s*=\s*["']canonical["']/i.test(html),
    hasSchema: /<script\b[^>]*type\s*=\s*["']application\/ld\+json["']/i.test(html),
    internalLinks,
    wordCount: decode(body).split(/\s+/).filter(Boolean).length,
  };
}
