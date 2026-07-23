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
];

/** Identify the leasing platform a site runs on from its RAW HTML, or null. */
export function detectLeasingPlatform(html: string): string | null {
  const h = html || "";
  for (const p of LEASING_PLATFORMS) if (p.re.test(h)) return p.name;
  return null;
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
