import { test } from "node:test";
import assert from "node:assert/strict";
import { detectWebsiteSpecial, specialFromHtml, aptAdvertisingFromRawHtml } from "../lib/detectors";

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
