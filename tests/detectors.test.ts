import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectWebsiteSpecial,
  specialFromHtml,
  aptAdvertisingFromRawHtml,
  aptConcessionFromRawHtml,
  aptWebsiteLinkFromRawHtml,
  aptHasVirtualTourFromRawHtml,
  recommendsGooglePhotos,
  recommendsNonGoogleFeatureOnGoogle,
  recommendsCreatingConcession,
  dropDeadDialedNumbers,
  extractFirstJsonObject,
} from "../lib/detectors";
import { missingFindingCards, allFindingCards } from "../lib/coverage";
import { parseWeekHours, reconcileOfficeHours, aptOfficeHoursFromRawHtml, officeHoursFromHtml } from "../lib/hours";
import { detectWebsiteFeatures, detectLeasingPlatform, virtualTourFromHtml } from "../lib/website-features";
import { brightDataRaw } from "../lib/brightdata";
import { buildLocalReviewComparison, selfReviewPosition } from "../lib/review-rank";
import { extractAutocompleteSuggestions, finalizeQuerySet, bedroomGeoQueries, amenityGeoQueries, searchUnitWord, isOffProfileQuery } from "../lib/seo-queries";

/**
 * Regression tests for the detectors that historically kept relapsing. Each case
 * is grounded in a real page we audited. If someone (or a future refactor) breaks
 * concession detection or the Apartments.com active-vs-dark logic, `npm test` goes
 * red HERE instead of surfacing weeks later in a client's report.
 */

// ----- Concession detection (website banner / popup text) --------------------

test("concession: detects the real Reserve at Sawmill move-in banner", () => {
  const banner =
    "Move-in Special Lowest Prices of the Season! Limited-Time Specials on Select 2-Bedroom Apartment Homes, Half-Off Security Deposit Waived Application Fees* Schedule Your Tour Today!";
  const note = detectWebsiteSpecial(banner);
  assert.ok(note, "should detect the concession");
  assert.match(note!, /special|half-off|limited-time|waived|free|deposit/i);
});

test("concession: detects other real specials", () => {
  assert.ok(detectWebsiteSpecial("6 Weeks Free on select units! Move in by 8/15."));
  assert.ok(detectWebsiteSpecial("1 Month Free Rent plus 4 Months Free Parking."));
  assert.ok(detectWebsiteSpecial("Move into Station House by July 31 to receive up to $1,875 in Free Rent."));
  assert.ok(detectWebsiteSpecial("$500 off your first full month's rent."));
});

test("concession: does NOT false-fire on ordinary fee/deposit language", () => {
  // These are the traps that must stay null — a standard deposit / app fee / "no specials"
  // is not a concession, and firing here is exactly what over-flagged before.
  assert.equal(detectWebsiteSpecial("A security deposit is required at signing."), null);
  assert.equal(detectWebsiteSpecial("Application fee: $50 per applicant."), null);
  assert.equal(detectWebsiteSpecial("There are no current specials. Contact us for availability."), null);
  assert.equal(detectWebsiteSpecial("Pet deposit and monthly pet rent apply."), null);
  assert.equal(detectWebsiteSpecial(""), null);
});

test("concession: strips a leaked crawl-transcript header from the special (the Forest Cove bug)", () => {
  // The crawl transcript joins pages with "=== <url> (status 200) ===" separators.
  // A greedy match used to reach back across one and prepend "com/ (status 200) ==="
  // to the special AND push the real wording past the length cap ("…OF YOU" truncated).
  const transcript =
    "=== https://forestcovedenver.com/ (status 200) === LOOK & LEASE: GET 1 MONTH FREE WHEN YOU APPLY WITHIN 48 HOURS OF YOUR TOUR! === https://forestcovedenver.com/floorplans/ (status 200) === Floor Plans";
  const special = detectWebsiteSpecial(transcript);
  assert.ok(special, "should still detect the special");
  assert.doesNotMatch(special!, /status|===|com\//i, "no transcript header/URL/status noise");
  assert.match(special!, /look\s*&\s*lease/i);
  assert.match(special!, /1 month free/i);
  assert.match(special!, /48 hours of your tour/i, "not truncated mid-phrase");
});

test("concession: specialFromHtml pulls a clean string out of escaped raw HTML", () => {
  // Mimics the embedded-JSON form the special arrives in from Bright Data raw HTML.
  const raw =
    '{"promo":"\\ud83d\\udd25 Lowest Prices of the Season! Limited-Time Specials on Select 2-Bedroom Apartment Homes, Half-Off Security Deposit \\u2022 Waived Application Fees*"}';
  const out = specialFromHtml(raw);
  assert.ok(out, "should extract a special");
  assert.match(out!, /Half-Off Security Deposit/i);
  assert.doesNotMatch(out!, /\\u|\\"/, "should be JSON-unescaped (no residue)");
});

test("concession: strips social hashtags + carousel labels from the special (the Station House bug)", () => {
  // Real Station House homepage text: the special sits in a social-feed post with
  // Instagram hashtags and image-carousel pager labels and NO punctuation boundary,
  // so the window used to grab "#washu ... 1 (current) 2 ..." as part of the special.
  const text =
    "SQFT, walk in closet, full sized kitchen, and a washer/dryer in-unit. #stl #washu #washu23 #umsl #slu 1 (current) 2 NEW MOVE-IN SPECIAL $500 GIFT CARD Move into STATION HOUSE by August 15th to receive a $500 GIFT CARD!* *Must sign a 12-month lease View Availability";
  const s = detectWebsiteSpecial(text)!;
  assert.ok(s);
  assert.doesNotMatch(s, /#\w+|\(current\)/i); // no hashtags, no carousel pager
  assert.doesNotMatch(s, /^[^A-Za-z0-9$]|^\d/); // clean leading char (not "#" or a pager digit)
  assert.match(s, /move-in special/i);
  assert.match(s, /\$500 gift card/i);
});

test("concession: recognizes a '$X gift card' offer (no 'special' wording needed)", () => {
  assert.ok(detectWebsiteSpecial("Move in by Aug 15 to receive a $500 Visa gift card."));
  // "gift" without a $ amount + "card" is not a concession (no false-fire).
  assert.equal(detectWebsiteSpecial("Browse gift shop items in our lobby."), null);
});

// ----- Apartments.com active-vs-dark detection (from RAW HTML) ---------------

test("apts: DARK shell (Explore Similar Rentals Nearby, no own pricing) -> false", () => {
  // The real Reserve at Sawmill shell markers (from the live raw HTML probe).
  const shell =
    "<html>" + "x".repeat(600) + " ...Explore Similar Rentals Nearby... Sunset Village Apartments $1,981+ 2 Beds ..." + "</html>";
  assert.equal(aptAdvertisingFromRawHtml(shell), false);
});

test("apts: ACTIVE listing (own Pricing & Floor Plans / Monthly Rent) -> true", () => {
  const active =
    "<html>" + "x".repeat(600) + " Pricing & Floor Plans ... Monthly Rent $1,660 - $2,144 ... 4 Available ..." + "</html>";
  assert.equal(aptAdvertisingFromRawHtml(active), true);
  // Even if a shell-style nearby section is ALSO present, own pricing wins (active).
  assert.equal(aptAdvertisingFromRawHtml(active + " Explore Similar Rentals Nearby"), true);
});

test("apts: undeterminable -> null (caller keeps its prior read)", () => {
  assert.equal(aptAdvertisingFromRawHtml(""), null); // empty
  assert.equal(aptAdvertisingFromRawHtml("short"), null); // too thin
  assert.equal(aptAdvertisingFromRawHtml("<html>" + "x".repeat(600) + " generic page, no markers</html>"), null);
});

test("apts: reads the listing's OWN concession from raw HTML (not 'July 3', not junk)", () => {
  // The real Apartments.com rent-specials markup for Village at Snowfield.
  const raw =
    '<div class="rentSpecialsSection mortar-wrapper" id="rentSpecialsSection" data-specials-label="1 Month Free">' +
    '<p class="specialTitle">?? Summer Savings Are Here!</p>' +
    '<p class="copy">Waived Application Fees &bull; *$250 Security Deposit* &bull; First Month Rent FREE *For qualified applicants.</p></div>';
  const c = aptConcessionFromRawHtml(raw)!;
  assert.ok(c);
  assert.match(c, /Waived Application Fees/i);
  assert.match(c, /\$250 Security Deposit/i);
  assert.match(c, /First Month Rent FREE/i);
  assert.doesNotMatch(c, /July 3/i); // the fabricated value must be gone
  assert.doesNotMatch(c, /class=|rentSpecialsSection|<|>/); // no raw markup residue
  // Fallback to the short data-specials-label when there's no copy paragraph.
  assert.equal(
    aptConcessionFromRawHtml('<div id="rentSpecialsSection" data-specials-label="6 Weeks Free"></div>'),
    "6 Weeks Free"
  );
  // No specials section at all -> null.
  assert.equal(aptConcessionFromRawHtml("<html><body>no specials</body></html>"), null);
});

test("apts: detects a Matterport/3D virtual tour from raw HTML (fixes the flaky media-count read)", () => {
  const withTour = "<html>" + "x".repeat(600) + '<div class="tab">Matterport 3D Tours</div> ...</html>';
  assert.equal(aptHasVirtualTourFromRawHtml(withTour), true);
  assert.equal(aptHasVirtualTourFromRawHtml("<html>" + "x".repeat(600) + " no tour markers here </html>"), null);
  assert.equal(aptHasVirtualTourFromRawHtml("short"), null);
});

test("recs: DROPS any Google Business Profile photo recommendation (hard rule)", () => {
  assert.equal(recommendsGooglePhotos("Verify and refresh Google Business Profile photo gallery. Review the current photo set."), true);
  assert.equal(recommendsGooglePhotos("Upload professional photos to the Google Business Profile."), true);
  // Not about Google photos -> kept.
  assert.equal(recommendsGooglePhotos("Complete the Google Business Profile description and hours."), false);
  assert.equal(recommendsGooglePhotos("Upgrade the website photo gallery."), false);
});

test("apts: extracts the 'View Property Website' outbound link from raw HTML", () => {
  // The real Apartments.com anchor for Village at Snowfield (direct link to the
  // property domain with a tracking param).
  const raw =
    '<div class="mortar-wrapper"><a href="https://www.villageatsnowfield.com/?switch_cls[id]=29769" ' +
    'title="View Property Website" rel="nofollow noopener" class="baseAlignedIcon propertyWebsiteLink js-propertyWebsiteExternal" ' +
    'target="_blank"><span>View Property Website</span></a></div>';
  const link = aptWebsiteLinkFromRawHtml(raw)!;
  assert.ok(link);
  assert.match(link, /^https:\/\/www\.villageatsnowfield\.com\//);
  // Entity-decodes and only returns real http(s) links; nothing to find -> null.
  assert.equal(aptWebsiteLinkFromRawHtml("<a href=\"/local/page\">Home</a>"), null);
  assert.equal(aptWebsiteLinkFromRawHtml("<html>no link</html>"), null);
});

// ----- "Not a Google feature" recs must never point at Google -----------------

test("recs: drops adding a non-Google feature to Google", () => {
  // The two real offenders from the report.
  assert.equal(recommendsNonGoogleFeatureOnGoogle("Add concession details to Google Business posts. Create a Google Business Profile post highlighting the move-in special."), true);
  assert.equal(recommendsNonGoogleFeatureOnGoogle("Publish virtual tour to Google Street View. Publish the Matterport tour to the Google Business Profile."), true);
  assert.equal(recommendsNonGoogleFeatureOnGoogle("Post the floor plan pricing to the Google Business Profile."), true);
});

test("recs: keeps legitimate Google recs and non-Google recs", () => {
  // Office hours / photos / reviews / description ARE Google features.
  assert.equal(recommendsNonGoogleFeatureOnGoogle("Fix office hours conflict on Google Business Profile."), false);
  assert.equal(recommendsNonGoogleFeatureOnGoogle("Complete the Google Business Profile description and add the website link."), false);
  // Preferred-employer / virtual-tour / concession recs that DON'T target Google stay.
  assert.equal(recommendsNonGoogleFeatureOnGoogle("Launch a preferred employers corporate discount program on the website."), false);
  assert.equal(recommendsNonGoogleFeatureOnGoogle("Add the Matterport virtual tour to the Apartments.com listing."), false);
});

// ----- "Create a concession on the site" recs must never reach the client -------

test("recs: DROPS 'create/add a concession to the website' cards (the recurring relapse)", () => {
  // The exact offending card the model keeps re-emitting (title + body combined,
  // as the filter sees it). Note the verbs are "Add"/"Design" — the old filter's
  // launch|create|introduce list missed both, so it slipped through.
  const offender =
    "Add move-in concession or limited-time offer to website. Design a move-in special (e.g. first month free on select floor plans, $500 off first month, or waived application fees for July move-ins) and add a prominent banner or Specials section to the homepage and floor plans page. Include expiration date and contact CTA. The website shows no concessions.";
  assert.equal(recommendsCreatingConcession(offender), true);
  assert.equal(recommendsCreatingConcession("Launch a move-in special to differentiate the property."), true);
  assert.equal(recommendsCreatingConcession("Create a limited-time offer and feature it in a Specials section on the homepage."), true);
  assert.equal(recommendsCreatingConcession("Introduce a rent special for the slow season."), true);
});

test("recs: KEEPS legitimate concession-distribution and unrelated cards", () => {
  // Syncing an EXISTING special to a named third-party platform is legitimate.
  assert.equal(recommendsCreatingConcession("Add the current move-in special to the Apartments.com listing so it matches the website."), false);
  assert.equal(recommendsCreatingConcession("Promote the existing concession on the Google Business Profile posts."), false);
  // A preferred-employer discount program is NOT a concession/special (different noun).
  assert.equal(recommendsCreatingConcession("Build a preferred employer discount program: $200 off first month or waived admin fees; create a Preferred Employers page."), false);
  // Unrelated hygiene recs are untouched.
  assert.equal(recommendsCreatingConcession("Fix Google hours to match the actual Saturday closure."), false);
  assert.equal(recommendsCreatingConcession("Add professional photos to the Apartments.com listing."), false);
});

// ----- Completeness backstop: every RED finding must have a covering rec ---------

const hoursConflictRow = {
  label: "Office hours listed",
  apartments: { status: "na", note: "Not advertising on Apartments.com" },
  google: { status: "red", note: "Google shows Saturday 9 AM-5 PM, but website shows Saturday closed" },
  website: { status: "green", note: "Mon-Fri 9 AM-5 PM, Sat-Sun closed" },
};

test("coverage: injects an office-hours fix when the model omitted it (the exact miss)", () => {
  const recs = [
    { title: "Reactivate the Apartments.com listing", what: "..." },
    { title: "Launch a preferred-employer program", what: "..." },
  ];
  const cards = missingFindingCards([hoursConflictRow], recs, { aptIsDark: true });
  assert.equal(cards.length, 1);
  assert.match(cards[0].title, /hours/i);
  assert.equal(cards[0].priority, "FOUNDATIONAL");
  // aptIsDark -> the fix must NOT tell them to update the dark Apartments.com listing.
  assert.doesNotMatch(cards[0].what, /Apartments\.com/i);
});

test("coverage: does NOT double-inject when the model already wrote the fix", () => {
  const recs = [{ title: "Fix Saturday office-hours conflict on Google", what: "Update the hours..." }];
  assert.equal(missingFindingCards([hoursConflictRow], recs, { aptIsDark: true }).length, 0);
});

test("coverage: injects for an uncovered virtual-tour red, naming the right platform", () => {
  const row = {
    label: "Virtual tour",
    apartments: { status: "na" },
    google: { status: "na", note: "Not a Google feature" },
    website: { status: "red", note: "No virtual tour on the website" },
  };
  const cards = missingFindingCards([row], [], { aptIsDark: false });
  assert.equal(cards.length, 1);
  assert.match(cards[0].title, /virtual tour/i);
  assert.match(cards[0].what, /the website/i);
});

test("coverage: NEVER injects a Google-photos card (hard rule)", () => {
  const row = {
    label: "Photos quality",
    apartments: { status: "na" },
    google: { status: "red", note: "Mostly visitor snapshots" },
    website: { status: "green" },
  };
  assert.equal(missingFindingCards([row], [], { aptIsDark: false }).length, 0);
});

test("coverage: skips a dark-Apartments.com red (reactivation card covers it) and green/na rows", () => {
  const aptOnlyRed = {
    label: "Online application",
    apartments: { status: "red", note: "No apply link on the listing" },
    google: { status: "na" },
    website: { status: "green" },
  };
  assert.equal(missingFindingCards([aptOnlyRed], [], { aptIsDark: true }).length, 0);
  // Nothing red at all -> nothing injected.
  const clean = {
    label: "Pricing / availability",
    apartments: { status: "na" },
    google: { status: "na" },
    website: { status: "green", note: "$1,660-$2,144" },
  };
  assert.equal(missingFindingCards([clean], [], { aptIsDark: false }).length, 0);
});

test("coverage: covers multiple uncovered reds in one pass", () => {
  const rows = [
    hoursConflictRow,
    { label: "Tour scheduling", apartments: { status: "na" }, google: { status: "na" }, website: { status: "red", note: "No scheduler" } },
    { label: "Online application", apartments: { status: "na" }, google: { status: "na" }, website: { status: "red", note: "No apply link" } },
  ];
  const cards = missingFindingCards(rows, [], { aptIsDark: true });
  assert.equal(cards.length, 3);
});

test("coverage: never injects an optional-promo (concession) card", () => {
  // Even if a concession row somehow arrives red, it's not a required feature.
  const row = { label: "Concessions listed", apartments: { status: "na" }, google: { status: "na" }, website: { status: "red", note: "none" } };
  assert.equal(missingFindingCards([row], [], { aptIsDark: false }).length, 0);
});

test("coverage: allFindingCards emits a card for EVERY red (deterministic recs source)", () => {
  const rows = [
    { label: "Office hours", website: { status: "red" }, google: { status: "red" }, apartments: { status: "green" } },
    { label: "Virtual tour", website: { status: "red" }, google: { status: "na" }, apartments: { status: "green" } },
    { label: "Pricing & availability", website: { status: "green" }, google: { status: "na" }, apartments: { status: "green" } },
  ];
  const cards = allFindingCards(rows, { aptIsDark: false });
  // 2 reds (hours, virtual tour) -> 2 cards; the all-green pricing row -> none.
  assert.equal(cards.length, 2);
  assert.ok(cards.some((c) => /hours/i.test(c.title)));
  assert.ok(cards.some((c) => /virtual tour/i.test(c.title)));
});

// ----- Deterministic office-hours reconciliation --------------------------------

test("hours: parseWeekHours reads a footer, ignores day names in prose", () => {
  const footer =
    "OFFICE HOURS Mon: Closed Tue: 9:00 AM-5:00 PM Wed: 9:00 AM-5:00 PM Thu: 9:00 AM-5:00 PM Fri: 9:00 AM-5:00 PM Sat: 10:00 AM-4:00 PM Sun: Closed";
  const h = parseWeekHours(footer);
  assert.match(h.monday, /closed/i);
  assert.match(h.tuesday, /9:00 AM-5:00 PM/i);
  assert.match(h.saturday, /10:00 AM-4:00 PM/i);
  assert.match(h.sunday, /closed/i);
  // A day name in prose with no adjacent hours must NOT produce an entry.
  assert.equal(Object.keys(parseWeekHours("Move in by Monday to save big!")).length, 0);
});

test("hours: parseWeekHours expands day RANGES (the Contact-page 'Mon-Fri' format)", () => {
  // Main & Stone's Contact page: "Office Hours  Mon-Fri 8:30 AM - 5:30 PM  Sat 10:00 AM - 5:00 PM".
  const h = parseWeekHours("Office Hours Mon-Fri 8:30 AM - 5:30 PM Sat 10:00 AM - 5:00 PM");
  assert.match(h.monday, /8:30 AM - 5:30 PM/i); // range expanded, not just Friday
  assert.match(h.wednesday, /8:30 AM - 5:30 PM/i);
  assert.match(h.friday, /8:30 AM - 5:30 PM/i);
  assert.match(h.saturday, /10:00 AM - 5:00 PM/i);
  // "Monday - Thursday" full-name range works too.
  const h2 = parseWeekHours("Monday - Thursday 9 AM - 6 PM");
  assert.match(h2.tuesday, /9 AM - 6 PM/i);
});

test("hours: parseWeekHours reads the compact 'M-F ... to ...' footer (the Station House case)", () => {
  // Station House (stationhousestl.com) footer: "M-F 9:00 AM to 5:00 PM" — single-letter
  // day range + the word "to" as the time separator. Both used to fail -> "couldn't read".
  const h = parseWeekHours("STATION HOUSE (314) 627-2559 - call or text us! M-F 9:00 AM to 5:00 PM 1019 N Skinker Pkwy St. Louis, MO 63112");
  assert.match(h.monday, /9:00 AM to 5:00 PM/i); // range expanded across M-F
  assert.match(h.wednesday, /9:00 AM to 5:00 PM/i);
  assert.match(h.friday, /9:00 AM to 5:00 PM/i);
  assert.equal(h.saturday, undefined); // weekend not listed -> not fabricated
  assert.equal(h.sunday, undefined);
  // Mixed compact abbreviations, per-day.
  const h2 = parseWeekHours("M-Th 9am - 6pm F 9am - 5pm Sa 10am - 2pm");
  assert.match(h2.tuesday, /9am - 6pm/i);
  assert.match(h2.friday, /9am - 5pm/i);
  assert.match(h2.saturday, /10am - 2pm/i);
  // A stray day letter in prose with NO hours after it must not produce a day.
  assert.equal(Object.keys(parseWeekHours("Welcome. Move in by Friday and save. Our team is fast.")).length, 0);
  // officeHoursFromHtml pulls it straight out of a rendered footer.
  const hh = officeHoursFromHtml("<html><footer>M-F 9:00 AM to 5:00 PM</footer></html>")!;
  assert.match(hh.monday, /9:00 AM to 5:00 PM/i);
});

const WEEK_9_5 = { monday: "9 AM-5 PM", tuesday: "9 AM-5 PM", wednesday: "9 AM-5 PM", thursday: "9 AM-5 PM", friday: "9 AM-5 PM", saturday: "10 AM-4 PM", sunday: "Closed" };

test("hours: the Village at Snowfield case — flags the Apartments.com outlier, not the consensus", () => {
  // Website + Google both say Mon closed; Apartments.com (reader-derived) says Mon 9-5.
  const website = { ...WEEK_9_5, monday: "Closed" };
  const google = { ...WEEK_9_5, monday: "Closed" };
  const apartments = { ...WEEK_9_5 }; // monday 9-5 — the outlier
  const v = reconcileOfficeHours([
    { key: "website", label: "the website", hours: website, authoritative: true },
    { key: "google", label: "Google", hours: google, authoritative: true },
    { key: "apartments", label: "Apartments.com", hours: apartments, authoritative: false },
  ])!;
  assert.equal(v.website.status, "green");
  assert.equal(v.google.status, "green");
  // Apartments.com is the lone outlier AND reader-derived -> AMBER "verify", not a hard ISSUE,
  // and definitely not the two that actually agree.
  assert.equal(v.apartments.status, "amber");
  assert.match(v.apartments.note, /Mon 9 AM–5 PM/);
});

test("hours: all platforms agree -> all green (kills the false positive)", () => {
  const v = reconcileOfficeHours([
    { key: "website", label: "the website", hours: { ...WEEK_9_5, monday: "Closed" }, authoritative: true },
    { key: "google", label: "Google", hours: { ...WEEK_9_5, monday: "Closed" }, authoritative: true },
    { key: "apartments", label: "Apartments.com", hours: { ...WEEK_9_5, monday: "Closed" }, authoritative: false },
  ])!;
  assert.equal(v.website.status, "green");
  assert.equal(v.google.status, "green");
  assert.equal(v.apartments.status, "green");
});

test("hours: an authoritative outlier (Google) is a RED conflict", () => {
  // Website + Apartments.com say Mon 9-5; Google says Mon closed -> Google is the
  // outlier and it's high-confidence, so it's a real operational conflict.
  const v = reconcileOfficeHours([
    { key: "website", label: "the website", hours: WEEK_9_5, authoritative: true },
    { key: "apartments", label: "Apartments.com", hours: WEEK_9_5, authoritative: false },
    { key: "google", label: "Google", hours: { ...WEEK_9_5, monday: "Closed" }, authoritative: true },
  ])!;
  assert.equal(v.google.status, "red");
  assert.equal(v.website.status, "green");
  assert.equal(v.apartments.status, "green");
});

test("hours: parses Apartments.com weekly schedule from raw HTML (incl. closed Monday)", () => {
  // The real Apartments.com markup — hours live in daysHoursContainer spans behind
  // "View All Hours", which the model reader misses (it only sees "open today").
  const raw =
    '<div class="hoursReview"><span class="hoursTitle">Office Hours</span>' +
    '<span class="daysHoursContainer"> Monday, Closed </span>' +
    '<span class="daysHoursContainer"> Tuesday - Friday, 9am - 5pm </span>' +
    '<span class="daysHoursContainer"> Saturday, 10am - 4pm </span>' +
    '<span class="daysHoursContainer"> Sunday, Closed </span></div>';
  const h = aptOfficeHoursFromRawHtml(raw)!;
  assert.ok(h);
  assert.match(h.monday, /closed/i); // the bug: was read as 9-5
  assert.match(h.tuesday, /9am - 5pm/i);
  assert.match(h.friday, /9am - 5pm/i);
  assert.match(h.saturday, /10am - 4pm/i);
  assert.match(h.sunday, /closed/i);
  // No hours block in this fetch -> null (caller must NOT fall back to the model guess).
  assert.equal(aptOfficeHoursFromRawHtml("<html><body>no hours here</body></html>"), null);
});

test("hours: raw-HTML apts hours reconcile clean with website+Google (no false conflict)", () => {
  const apts = aptOfficeHoursFromRawHtml(
    '<span class="daysHoursContainer">Monday, Closed</span>' +
      '<span class="daysHoursContainer">Tuesday - Friday, 9am - 5pm</span>' +
      '<span class="daysHoursContainer">Saturday, 10am - 4pm</span>' +
      '<span class="daysHoursContainer">Sunday, Closed</span>'
  )!;
  const v = reconcileOfficeHours([
    { key: "website", label: "the website", hours: { ...WEEK_9_5, monday: "Closed" }, authoritative: true },
    { key: "google", label: "Google", hours: { ...WEEK_9_5, monday: "Closed" }, authoritative: true },
    { key: "apartments", label: "Apartments.com", hours: apts, authoritative: false },
  ])!;
  assert.equal(v.website.status, "green");
  assert.equal(v.google.status, "green");
  assert.equal(v.apartments.status, "green"); // now that apts is read correctly, all agree
});

test("hours: two sources that simply disagree (no majority) -> amber verify, null when <2", () => {
  const tie = reconcileOfficeHours([
    { key: "website", label: "the website", hours: { ...WEEK_9_5 }, authoritative: true },
    { key: "google", label: "Google", hours: { ...WEEK_9_5, monday: "Closed" }, authoritative: true },
  ])!;
  assert.equal(tie.website.status, "amber");
  assert.equal(tie.google.status, "amber");
  // The note must SHOW each side's actual hours for the differing day, not just say
  // "they differ" — so the user can resolve it without opening both listings.
  assert.match(tie.website.note, /Mon 9 AM.5 PM/i); // this cell's own value
  assert.match(tie.website.note, /Google shows Mon closed/i); // and the other side's
  assert.match(tie.google.note, /Mon closed/i);
  assert.match(tie.google.note, /website shows Mon 9 AM.5 PM/i);
  // Only one source with parseable hours -> nothing to compare.
  assert.equal(reconcileOfficeHours([{ key: "website", label: "the website", hours: WEEK_9_5, authoritative: true }]), null);
});

// ----- Website feature detection (JS-heavy sites hide features in sub-pages) -----

test("website-features: detects features from crawled nav/buttons/footer text", () => {
  // Signals as they survive in the crawled text of a Funnel/RENTCafe site like
  // Main & Stone, even when the interactive widget itself doesn't render.
  const siteText =
    "Amenities Floorplans Neighborhood Gallery Residents FAQs Contact Preferred Employer Program ... " +
    "Book Your Tour Find Your Home ... Davis Studio 1 bath 360 Virtual Tour ... Lease Now Check Availability";
  const f = detectWebsiteFeatures(siteText);
  assert.equal(f.preferredEmployer, true);
  assert.equal(f.virtualTour, true);
  assert.equal(f.tourScheduling, true);
  assert.equal(f.onlineApplication, true);
  assert.equal(f.gallery, true);
});

test("website-features: does not hallucinate features on a bare site", () => {
  const f = detectWebsiteFeatures("Welcome home. Contact us for availability. Pet friendly community.");
  assert.equal(f.preferredEmployer, false);
  assert.equal(f.virtualTour, false);
  assert.equal(f.tourScheduling, false);
  assert.equal(f.onlineApplication, false);
});

test("website-features: detects the leasing platform from raw HTML embed scripts", () => {
  // Main & Stone's real embed (confirmed live): integrations.funnelleasing.com.
  assert.equal(
    detectLeasingPlatform('<script src="https://integrations.funnelleasing.com/widget.js"></script>'),
    "Funnel"
  );
  assert.equal(detectLeasingPlatform('<iframe src="https://property.securecafe.com/..."></iframe>'), "RentCafe");
  assert.equal(detectLeasingPlatform('<script src="https://prospectportal.entrata.com/x.js">'), "Entrata");
  // Solas Glendale's real chat embed (confirmed live): cdn.eliseai.com / @meetelise.
  // Its office hours live only inside the chat, so recognizing it lets the audit
  // defer to Google instead of a false "couldn't read hours".
  assert.equal(detectLeasingPlatform('<script src="https://cdn.eliseai.com/@meetelise/chat"></script>'), "EliseAI");
  // A plain marketing site with no leasing widget -> null (we won't infer features).
  assert.equal(detectLeasingPlatform("<html><body>Welcome to our community</body></html>"), null);
});

// ----- Office hours & virtual tour from RAW HTML (rendered DOM) ----------------
// These read the DOM (footers/widgets/JSON-LD) that the visible-text crawl misses.
// Snippets mirror the real corpus (Pecan Creek JSON-LD, Cambridge DoubleMap widget,
// Asbury/Forest Cove footer text, and the Sixcord corporate site for the VT negative).

test("hours: officeHoursFromHtml reads JSON-LD OpeningHoursSpecification (Mon-Fri 9-6, Sat closed)", () => {
  // The real Pecan Creek shape: one spec per day, opens/closes "HH:MM:SS", and the
  // 00:00:00->00:00:00 "closed" encoding. Saturday is closed here; Sunday is omitted
  // entirely and must fill to "Closed".
  const mkDay = (d: string, o: string, c: string) =>
    `{"@type":"OpeningHoursSpecification","dayOfWeek":["${d}"],"opens":"${o}","closes":"${c}"}`;
  const raw =
    '<script type="application/ld+json">{"@type":"ApartmentComplex","openingHoursSpecification":[' +
    ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map((d) => mkDay(d, "09:00:00", "18:00:00")).join(",") +
    "," +
    mkDay("Saturday", "00:00:00", "00:00:00") +
    "]}</script>";
  const h = officeHoursFromHtml(raw)!;
  assert.ok(h);
  assert.equal(h.monday, "9 AM - 6 PM");
  assert.equal(h.friday, "9 AM - 6 PM");
  assert.equal(h.saturday, "Closed"); // opens === closes -> closed
  assert.equal(h.sunday, "Closed"); // day omitted from the schema -> closed
  // Also accepts the string (non-array) dayOfWeek form and "HH:MM" without seconds.
  const strForm = officeHoursFromHtml(
    '"OpeningHoursSpecification","dayOfWeek":"Monday","opens":"10:00","closes":"17:00"'
  )!;
  assert.equal(strForm.monday, "10 AM - 5 PM");
});

test("hours: officeHoursFromHtml reads a DoubleMap <dt>/<dd><time> widget", () => {
  // The real Cambridge / liveatcf markup.
  const raw =
    '<dl class="open-hours-data">' +
    '<div class="open-hours-item"><dt day="0">Monday</dt> <dd> <time>9:00 am</time> - <time>6:00 pm</time> </dd></div>' +
    '<div class="open-hours-item"><dt day="5">Saturday</dt> <dd> <time>10:00 am</time> - <time>2:00 pm</time> </dd></div>' +
    '<div class="open-hours-item"><dt day="6">Sunday</dt> <dd>Closed</dd></div>' +
    "</dl>";
  const h = officeHoursFromHtml(raw)!;
  assert.ok(h);
  assert.equal(h.monday, "9:00 am - 6:00 pm");
  assert.equal(h.saturday, "10:00 am - 2:00 pm");
  assert.equal(h.sunday, "Closed"); // <dd>Closed</dd>
});

test("hours: officeHoursFromHtml falls back to plain footer text", () => {
  // The Asbury / Forest Cove / Vivian footer shape (no JSON-LD, no widget markup).
  const raw =
    "<footer><p>Office Hours</p> Monday - Friday: 10:00am - 6:00pm Saturday: 10:00am - 5:00pm Sunday: Closed</footer>";
  const h = officeHoursFromHtml(raw)!;
  assert.ok(h);
  assert.match(h.monday, /10:00am - 6:00pm/i); // range expanded across Mon-Fri
  assert.match(h.wednesday, /10:00am - 6:00pm/i);
  assert.match(h.saturday, /10:00am - 5:00pm/i);
  assert.match(h.sunday, /closed/i);
});

test("hours: officeHoursFromHtml returns null when the HTML has no hours anywhere", () => {
  assert.equal(officeHoursFromHtml("<html><body>Welcome home! Contact us for availability.</body></html>"), null);
  assert.equal(officeHoursFromHtml(""), null);
});

test("website-features: virtualTourFromHtml detects a tour host embed or a tour link", () => {
  // A Matterport iframe (host embed) -> true.
  assert.equal(virtualTourFromHtml('<iframe src="https://my.matterport.com/show/?m=abc123"></iframe>'), true);
  // A "Virtual Tours" nav link (visible-ish phrase) -> true.
  assert.equal(virtualTourFromHtml('<a href="/virtual-tours">Virtual Tours</a>'), true);
  // Other real hosts from the corpus JSON provider list.
  assert.equal(virtualTourFromHtml('{"providers":["kuula.co/share","ricoh360.com","cloudpano.com"]}'), true);
});

test("website-features: virtualTourFromHtml stays false on a bare corporate page (the Sixcord case)", () => {
  // Sixcord's raw HTML carries the bare words "tour" and "360" but NONE of the real
  // tour phrases/hosts -> must NOT false-fire.
  const corporate =
    "<html><body><h1>About Our Company</h1><p>Take a guided tour of our services and explore 360 degrees of innovation. Take a peek inside.</p></body></html>";
  assert.equal(virtualTourFromHtml(corporate), false);
  assert.equal(virtualTourFromHtml(""), false);
});

// ----- Google review rank (SEO audit: property vs local Map Pack ratings) ----

test("review-rank: ranks the property against local competitors by stars", () => {
  // Competitors gathered across queries (with a dupe from repeated Map Pack hits),
  // plus a stray copy of the PROPERTY itself from its own Map Pack appearance.
  const competitors = [
    { name: "The Flats at Stone", rating: 3.4, reviews: 120 },
    { name: "Riverside Apartments", rating: 4.6, reviews: 88 },
    { name: "The Flats at Stone Apartments", rating: 3.4, reviews: 120 }, // dupe
    { name: "Main & Stone", rating: 4.1, reviews: 5 }, // property's own (unreliable) map-pack row
  ];
  const ranked = buildLocalReviewComparison(
    { name: "Main & Stone", rating: 4.4, reviews: 132 },
    competitors
  );
  // Deduped competitors (2) + the property (1) = 3 rows; the property's own map-pack
  // copy is dropped in favor of the authoritative 4.4 rating.
  assert.equal(ranked.length, 3);
  assert.deepEqual(ranked.map((r) => r.name), ["Riverside Apartments", "Main & Stone", "The Flats at Stone"]);
  const self = ranked.find((r) => r.isSelf)!;
  assert.equal(self.rating, 4.4);
  assert.equal(self.reviews, 132); // authoritative count, not the "5" from the map-pack copy
  const pos = selfReviewPosition(ranked)!;
  assert.deepEqual(pos, { pos: 2, total: 3 });
});

test("review-rank: no ratings anywhere -> empty (nothing to render)", () => {
  const ranked = buildLocalReviewComparison(
    { name: "Main & Stone", rating: null, reviews: null },
    [{ name: "Riverside Apartments", rating: null, reviews: null }]
  );
  assert.equal(ranked.length, 0);
  assert.equal(selfReviewPosition(ranked), null);
});

// ----- SEO query generation (autocomplete grounding + finalize) --------------

test("seo-queries: extractAutocompleteSuggestions reads the SerpAPI payload shape", () => {
  const payload = {
    suggestions: [
      { value: "apartments in aurora co" },
      { value: "apartments in aurora co under 1500" },
      "cheap apartments aurora", // tolerate a bare-string variant
      { value: "  " }, // dropped (blank)
      { notValue: "x" }, // dropped (no value)
    ],
  };
  assert.deepEqual(extractAutocompleteSuggestions(payload), [
    "apartments in aurora co",
    "apartments in aurora co under 1500",
    "cheap apartments aurora",
  ]);
  assert.deepEqual(extractAutocompleteSuggestions({}), []);
  assert.deepEqual(extractAutocompleteSuggestions(null), []);
});

test("seo-queries: bedroomGeoQueries emits one stock search per floorplan present", () => {
  assert.deepEqual(bedroomGeoQueries("Studio, 1 Bed, 2 Bed, 3 Bed", "Arapahoe County"), [
    "studio apartments to rent in Arapahoe County",
    "1 bedroom apartments to rent in Arapahoe County",
    "2 bedroom apartments to rent in Arapahoe County",
    "3 bedroom apartments to rent in Arapahoe County",
  ]);
  // Only the floorplans present, shared "bedroom" word ("1 & 2 bedroom").
  assert.deepEqual(bedroomGeoQueries("1 & 2 Bedroom", "Denver County"), [
    "1 bedroom apartments to rent in Denver County",
    "2 bedroom apartments to rent in Denver County",
  ]);
  // Ranges expand ("1-3 Bedrooms" -> 1, 2, 3).
  assert.deepEqual(bedroomGeoQueries("1-3 Bedrooms", "Adams County"), [
    "1 bedroom apartments to rent in Adams County",
    "2 bedroom apartments to rent in Adams County",
    "3 bedroom apartments to rent in Adams County",
  ]);
  // Bare word/number counts with NO "bedroom" word — the real Forest Cove entry.
  assert.deepEqual(bedroomGeoQueries("one, two, three", "Arapahoe County"), [
    "1 bedroom apartments to rent in Arapahoe County",
    "2 bedroom apartments to rent in Arapahoe County",
    "3 bedroom apartments to rent in Arapahoe County",
  ]);
  // No county -> none; no recognizable bedroom info -> none (never fabricates).
  assert.deepEqual(bedroomGeoQueries("Studio, 1 Bed", ""), []);
  assert.deepEqual(bedroomGeoQueries("", "Denver County"), []);
  assert.deepEqual(bedroomGeoQueries("call for details", "Denver County"), []);
});

test("seo-queries: isOffProfileQuery drops wrong-audience + sub-floor-price searches", () => {
  const mkt = { rentMin: 1000, rentMax: 4000, affordable: false, senior: false };
  assert.equal(isOffProfileQuery("low income apartments arapahoe county", mkt), true);
  assert.equal(isOffProfileQuery("income based apartments arapahoe county", mkt), true);
  assert.equal(isOffProfileQuery("section 8 apartments denver", mkt), true);
  assert.equal(isOffProfileQuery("62+ apartments denver", mkt), true);
  assert.equal(isOffProfileQuery("luxury apartments near university of denver", mkt), true); // value property, not luxury
  assert.equal(isOffProfileQuery("upscale apartments denver", mkt), true);
  assert.equal(isOffProfileQuery("1 bedroom apartments denver under $1,000", mkt), true); // below the $1000 floor
  assert.equal(isOffProfileQuery("apartments under $2000 denver", mkt), false); // within range
  assert.equal(isOffProfileQuery("cheap apartments denver", mkt), false);
  assert.equal(isOffProfileQuery("2 bedroom apartments denver", mkt), false);
  // An affordable / senior property KEEPS those searches.
  assert.equal(isOffProfileQuery("low income apartments denver", { affordable: true }), false);
  assert.equal(isOffProfileQuery("62+ apartments denver", { senior: true }), false);
  assert.equal(isOffProfileQuery("luxury apartments denver", { luxury: true }), false);
});

test("seo-queries: amenityGeoQueries emits searches only for amenities present, in priority order, capped", () => {
  assert.deepEqual(
    amenityGeoQueries("Swimming Pool, Pet Friendly, Fitness Center, Garage Parking, In-Unit Washer/Dryer", "Denver County", 3),
    [
      "apartments with a pool in Denver County",
      "pet friendly apartments in Denver County",
      "apartments with a gym in Denver County",
    ]
  );
  // Only amenities actually present.
  assert.deepEqual(amenityGeoQueries("Pool, Clubhouse", "Adams County"), ["apartments with a pool in Adams County"]);
  // No county / no tracked amenities -> none (never fabricates an amenity).
  assert.deepEqual(amenityGeoQueries("Pool", ""), []);
  assert.deepEqual(amenityGeoQueries("Clubhouse, Business Center, Package Lockers", "Denver County"), []);
});

test("seo-queries: searchUnitWord maps industry types to what renters actually type", () => {
  assert.equal(searchUnitWord("Multifamily"), "apartments");
  assert.equal(searchUnitWord("multi-family"), "apartments");
  assert.equal(searchUnitWord("Apartment Homes"), "apartments");
  assert.equal(searchUnitWord(""), "apartments");
  assert.equal(searchUnitWord("Townhome Community"), "townhomes");
  assert.equal(searchUnitWord("Condominiums"), "condos");
  assert.equal(searchUnitWord("Senior Living 55+"), "senior apartments");
  assert.equal(searchUnitWord("Student Housing"), "student apartments");
  assert.equal(searchUnitWord("Single-Family Rentals"), "houses for rent");
});

test("seo-queries: finalizeQuerySet drops sale-intent phrases and collapses base near-dupes", () => {
  // Sale/purchase intent is wrong for a rental audit -> dropped (brand always kept).
  assert.deepEqual(
    finalizeQuerySet("Forrest Cove", [
      "apartments for rent aurora",
      "multifamily for sale aurora",
      "apartments to buy denver",
      "cheap apartments aurora",
    ], 10),
    ["Forrest Cove", "apartments for rent aurora", "cheap apartments aurora"]
  );
  // "buckley afb" and "buckley space force base" are the same place -> one slot.
  const nd = finalizeQuerySet("X", ["apartments near buckley afb", "apartments near buckley space force base"], 10);
  assert.equal(nd.length, 2);
  assert.equal(nd.filter((q) => /buckley/i.test(q)).length, 1);
});

test("seo-queries: finalizeQuerySet leads with brand, dedupes, caps", () => {
  const q = finalizeQuerySet(
    "Forest Cove",
    [
      "apartments near Anschutz Medical Campus",
      "APARTMENTS NEAR ANSCHUTZ MEDICAL CAMPUS", // case-dupe -> dropped
      "2 bedroom apartments Stapleton",
      "apartments in Arapahoe County",
      "apartments in Stapleton Denver",
      "cheap apartments Aurora",
      "one more that exceeds the cap",
    ],
    6
  );
  assert.equal(q[0], "Forest Cove"); // brand always first
  assert.equal(q.length, 6); // capped
  assert.equal(new Set(q.map((s) => s.toLowerCase())).size, 6); // no dupes
  assert.ok(!q.includes("one more that exceeds the cap")); // trimmed by the cap
});

// ----- Model JSON extraction (first balanced object, ignore trailing junk) ---

test("json: extractFirstJsonObject returns the first balanced object, ignoring trailing content", () => {
  // The real failure: valid JSON followed by more text ("…after JSON at position N").
  assert.equal(extractFirstJsonObject('{"a":1}\n\nSome trailing note.'), '{"a":1}');
  // A second object after the first is ignored.
  assert.equal(extractFirstJsonObject('prose {"a":{"b":2}} then {"c":3}'), '{"a":{"b":2}}');
  // Braces inside strings don't break the balance.
  assert.equal(extractFirstJsonObject('{"note":"a } inside {"}'), '{"note":"a } inside {"}');
  // Escaped quote inside a string is handled.
  assert.equal(extractFirstJsonObject('{"q":"say \\"hi\\""}'), '{"q":"say \\"hi\\""}');
  // Truncated / unbalanced -> null (caller shows a retryable error).
  assert.equal(extractFirstJsonObject('{"a":1'), null);
  assert.equal(extractFirstJsonObject("no json here"), null);
});

// ----- Phantom phone pruning (dial-confirmed dead numbers) -------------------

test("phones: dropDeadDialedNumbers removes a dial-confirmed dead number, keeps live ones", () => {
  // The real Asbury Plaza case: a Funnel/RentCafe widget-injected tracking number
  // (569 = bogus area code) that the dial test confirmed dead, alongside live lines.
  const nums = [
    { number: "(833) 452-1183", dialStatus: "connected" },
    { number: "(569) 979-5276", dialStatus: "failed" },
    { number: "(303) 756-0651", dialStatus: "connected" },
  ];
  const kept = dropDeadDialedNumbers(nums);
  assert.equal(kept.length, 2);
  assert.ok(!kept.some((n) => n.number.includes("569")), "the dead phantom is dropped");
  // Dial-wide failure (nothing connected) -> keep everything, don't nuke the list.
  const allFailed = [{ number: "a", dialStatus: "failed" }, { number: "b", dialStatus: "failed" }];
  assert.equal(dropDeadDialedNumbers(allFailed).length, 2);
  // Untested / inconclusive numbers are left alone.
  assert.equal(dropDeadDialedNumbers([{ number: "x", dialStatus: null }]).length, 1);
  assert.equal(dropDeadDialedNumbers([{ number: "y", dialStatus: "unknown" }, { number: "z", dialStatus: "connected" }]).length, 2);
});

// ----- Bright Data fetch: retry past the intermittent empty body -------------

const restoreEnv = (key: string, val: string | undefined) => {
  if (val === undefined) delete process.env[key];
  else process.env[key] = val;
};

test("brightdata: retries past an empty 200 body and returns the full page", async () => {
  // Bright Data intermittently answers HTTP 200 with an EMPTY body; the SAME url
  // returns the full ~800KB page on an immediate retry. That empty response is what
  // turned a readable Apartments.com hours block into a false amber "couldn't read
  // this run." The helper must retry past it.
  const prevToken = process.env.BRIGHTDATA_API_TOKEN;
  const prevZone = process.env.BRIGHTDATA_ZONE;
  const prevFetch = globalThis.fetch;
  process.env.BRIGHTDATA_API_TOKEN = "test-token";
  process.env.BRIGHTDATA_ZONE = "cres";
  const bodies = ["", "", "<html>" + "x".repeat(9000) + "</html>"]; // two empties, then a full page
  let calls = 0;
  globalThis.fetch = (async () => {
    const body = bodies[Math.min(calls, bodies.length - 1)];
    calls++;
    return { ok: true, text: async () => body };
  }) as unknown as typeof fetch;
  try {
    const html = await brightDataRaw("https://www.apartments.com/x/", { minLength: 5000, attempts: 4 });
    assert.ok(html && html.length >= 5000, "returns the full page, not the empty body");
    assert.equal(calls, 3, "retried past both empty responses");
  } finally {
    globalThis.fetch = prevFetch;
    restoreEnv("BRIGHTDATA_API_TOKEN", prevToken);
    restoreEnv("BRIGHTDATA_ZONE", prevZone);
  }
});

test("brightdata: returns null without creds (never makes a live call)", async () => {
  const prevToken = process.env.BRIGHTDATA_API_TOKEN;
  const prevZone = process.env.BRIGHTDATA_ZONE;
  const prevFetch = globalThis.fetch;
  delete process.env.BRIGHTDATA_API_TOKEN;
  delete process.env.BRIGHTDATA_ZONE;
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return { ok: true, text: async () => "x".repeat(9000) };
  }) as unknown as typeof fetch;
  try {
    assert.equal(await brightDataRaw("https://www.apartments.com/x/"), null);
    assert.equal(called, false, "no creds -> short-circuits before fetching");
  } finally {
    globalThis.fetch = prevFetch;
    restoreEnv("BRIGHTDATA_API_TOKEN", prevToken);
    restoreEnv("BRIGHTDATA_ZONE", prevZone);
  }
});
