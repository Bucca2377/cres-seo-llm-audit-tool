import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectWebsiteSpecial,
  specialFromHtml,
  aptAdvertisingFromRawHtml,
  recommendsNonGoogleFeatureOnGoogle,
  recommendsCreatingConcession,
} from "../lib/detectors";
import { missingFindingCards } from "../lib/coverage";
import { parseWeekHours, reconcileOfficeHours } from "../lib/hours";

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

test("concession: specialFromHtml pulls a clean string out of escaped raw HTML", () => {
  // Mimics the embedded-JSON form the special arrives in from Bright Data raw HTML.
  const raw =
    '{"promo":"\\ud83d\\udd25 Lowest Prices of the Season! Limited-Time Specials on Select 2-Bedroom Apartment Homes, Half-Off Security Deposit \\u2022 Waived Application Fees*"}';
  const out = specialFromHtml(raw);
  assert.ok(out, "should extract a special");
  assert.match(out!, /Half-Off Security Deposit/i);
  assert.doesNotMatch(out!, /\\u|\\"/, "should be JSON-unescaped (no residue)");
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

test("hours: two sources that simply disagree (no majority) -> amber verify, null when <2", () => {
  const tie = reconcileOfficeHours([
    { key: "website", label: "the website", hours: { ...WEEK_9_5 }, authoritative: true },
    { key: "google", label: "Google", hours: { ...WEEK_9_5, monday: "Closed" }, authoritative: true },
  ])!;
  assert.equal(tie.website.status, "amber");
  assert.equal(tie.google.status, "amber");
  // Only one source with parseable hours -> nothing to compare.
  assert.equal(reconcileOfficeHours([{ key: "website", label: "the website", hours: WEEK_9_5, authoritative: true }]), null);
});
