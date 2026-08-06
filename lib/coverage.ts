/**
 * COMPLETENESS BACKSTOP for the marketing-audit recommendations.
 *
 * The consistency table can flag a RED ("ISSUE") cell — a confirmed conflict or
 * absence — and the model is REQUIRED to write a recommendation that fixes every
 * such cell. It sometimes forgets one (pure LLM variance); that's how a real
 * office-hours conflict ended up in the table with NO fix card. Rather than trust
 * the model to be complete, this deterministically walks every red cell and returns
 * a fix card for any that no existing recommendation already covers.
 *
 * Framework-free (no React/Next/DOM) so it imports into the client component and
 * runs in the plain test process. Covered by tests/detectors.test.ts — change the
 * topics or matching only with the tests green.
 *
 * NOTE: this only fires for RED cells (confirmed ISSUES). Amber ("CHECK") cells are
 * soft/verify-live and are intentionally left to the model. It also respects the
 * app's hard rules: never recommends Google photos, and never injects an
 * Apartments.com fix when the listing is dark (the reactivation card covers that).
 */

type CovStatus = "green" | "amber" | "red" | "na";
interface CovCell {
  status?: CovStatus;
  note?: string | null;
}
interface CovRow {
  label?: string;
  apartments?: CovCell | null;
  google?: CovCell | null;
  website?: CovCell | null;
}
interface CovRecLike {
  title?: string;
  what?: string;
}
type PlatformKey = "website" | "apartments" | "google";

/** A recommendation card. `priority` is a subset of RecommendationPriority, so the
 *  result is directly assignable to RecommendationCard[] in the app. */
export interface CoverageCard {
  priority: "FOUNDATIONAL" | "QUICK WIN" | "CONTENT" | "STRATEGIC";
  title: string;
  what: string;
  why: string;
  effort: string;
  success: string;
  source: string;
}

const PLATFORM_PHRASE: Record<PlatformKey, string> = {
  website: "the website",
  apartments: "the Apartments.com listing",
  google: "the Google Business Profile",
};
const listPhrase = (ps: PlatformKey[]) => ps.map((p) => PLATFORM_PHRASE[p]).join(" and ");
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const verb = (ps: PlatformKey[]) => (ps.length > 1 ? "have" : "has");
const escapeReg = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

interface Topic {
  /** identifies the row by its label */
  label: RegExp;
  /** an existing rec whose text matches this is treated as already covering the row */
  covers: RegExp;
  /** build the fix card, or return null to intentionally NOT inject (handled elsewhere) */
  card: (red: PlatformKey[], note: string, aptIsDark: boolean) => CoverageCard | null;
}

const TOPICS: Topic[] = [
  {
    label: /\bhours?\b/i,
    covers: /\bhours?\b/i,
    card: (red, note, dark) => {
      // A "missing hours" red (a platform simply has NO hours listed) needs an
      // ADD-hours card, not a "resolve the conflict" card. Detect it from the note.
      const isMissing = /no office hours|hours not listed|not listed on|\badd (?:them|your|the )?(?:weekly )?(?:office )?hours\b|add business hours/i.test(note);
      if (isMissing) {
        return {
          priority: "FOUNDATIONAL",
          title: `Add office hours to ${listPhrase(red)}`,
          what: `${cap(listPhrase(red))} ${verb(red)} no office hours listed${note ? ` (${note})` : ""}. Add the weekly hours so searchers see when the leasing office is open — copy them from a platform that already shows them.`,
          why: "A listing with no hours leaves prospects guessing when they can visit or call, and an incomplete profile is a lead leak (Google also favors complete listings).",
          effort: "~10 min · marketing manager with the listing's admin access",
          success: `Office hours visible on ${listPhrase(red)} within 24 hours.`,
          source: "Fixes the missing office-hours finding.",
        };
      }
      return {
        priority: "FOUNDATIONAL",
        title: "Fix the office-hours conflict across listings",
        what: `The office hours don't match across your listings${note ? ` (${note})` : ""}. Decide the correct schedule, then update ${
          dark ? "the Google Business Profile and the website" : "the Google Business Profile, the website, and the Apartments.com listing"
        } so every platform shows the SAME hours. Verify with a live check afterward.`,
        why: "Mismatched hours send prospects to a closed leasing office, destroying trust and losing tours on the spot.",
        effort: "~15 min · marketing manager with Google Business access",
        success: "All listings show identical office hours within 48 hours, confirmed by a live check.",
        source: "Fixes the office-hours conflict in the consistency check.",
      };
    },
  },
  {
    label: /website link/i,
    covers: /website link/i,
    card: (_red, note) => ({
      priority: "FOUNDATIONAL",
      title: "Fix the website link on your Google listing",
      what: `The Website link on the Google Business Profile does not reach your live leasing site${note ? ` (${note})` : ""}. Update it to the correct URL so prospects who click "Website" on Google land on your site instead of an error or the wrong page.`,
      why: "A broken or wrong website link on Google sends every click-to-site prospect into a dead end — a direct lead leak.",
      effort: "~10 min · marketing manager with Google Business access",
      success: "Clicking Website on the Google listing opens the correct live site within 24 hours.",
      source: "Fixes the broken/incorrect website link on the Google listing.",
    }),
  },
  {
    label: /pricing|availability|rent range/i,
    covers: /pricing|price|rent range|availability/i,
    card: (red) =>
      red.length
        ? {
            priority: "CONTENT",
            title: `Publish current pricing and availability on ${listPhrase(red)}`,
            what: `${cap(listPhrase(red))} ${verb(red)} no current pricing or availability shown. Add live floor-plan pricing and available-unit info so prospects can qualify themselves instead of bouncing to a competitor that shows rents.`,
            why: "Listings without visible pricing lose price-shopping prospects before they ever inquire.",
            effort: "~1 hr · marketing manager",
            success: `Current pricing and availability visible on ${listPhrase(red)} within 1 week.`,
            source: "Fixes the missing pricing/availability finding.",
          }
        : null,
  },
  {
    label: /photo|gallery/i,
    covers: /photo|gallery|image/i,
    card: (red) => {
      // The property's OWN listing photos (website / Apartments.com) are weak or
      // missing -> produce a professional set (a real shoot).
      const others = red.filter((x) => x !== "google");
      if (others.length) {
        return {
          priority: "CONTENT",
          title: `Upgrade the photo gallery on ${listPhrase(others)}`,
          what: `The photos on ${listPhrase(others)} are weak or missing. Add professional, well-lit photos covering interiors/units, amenities, and the exterior so the property presents at its best.`,
          why: "Amateur or sparse photos are a top reason prospects skip a listing during comparison shopping.",
          effort: "~1 day · marketing manager + photographer",
          success: `A professional photo set live on ${listPhrase(others)} within 2 weeks.`,
          source: "Fixes the photo-quality finding.",
        };
      }
      // ONLY the Google Business Profile is missing the professional set that already
      // exists on the website / Apartments.com -> upload the existing photos (no shoot
      // needed). This fires only when a vision check confirmed the profile lacks the
      // pro set, so it's a reliable, fully-controllable fix — NOT the old "refresh the
      // Google gallery" guesswork the hard rule used to drop.
      if (red.includes("google")) {
        return {
          priority: "QUICK WIN",
          title: "Upload your professional photos to the Google Business Profile",
          what: "Your professional photo set is on the website and Apartments.com but not on the Google Business Profile. Upload the same interior, amenity, and exterior photos to the profile so searchers see the property at its best right in Google.",
          why: "Most prospects judge a property from its Google photos first; a thin or amateur Google gallery loses clicks to competitors that show a full set.",
          effort: "~20 min · marketing manager with Google Business access",
          success: "A professional photo set live on the Google Business Profile within 1 week.",
          source: "Fixes the missing Google-profile photos finding.",
        };
      }
      return null;
    },
  },
  {
    label: /virtual tour|matterport|3d tour/i,
    covers: /virtual tour|matterport|3d tour/i,
    card: (red) => {
      if (!red.length) return null;
      // Apartments.com INCLUDES a Matterport/3D tour with the advertising package, so a
      // missing tour there is a free ask to the rep, not a production project. When the
      // gap is ONLY on Apartments.com, frame it that way (quick win); otherwise it's a
      // real shoot on the property's own site.
      const aptsOnly = red.length === 1 && red[0] === "apartments";
      const aptsNote = red.includes("apartments")
        ? " Apartments.com includes a Matterport/3D tour with your advertising package — request it from your account rep at no extra cost."
        : "";
      return {
        priority: aptsOnly ? "QUICK WIN" : "CONTENT",
        title: `Add a virtual tour to ${listPhrase(red)}`,
        what: `${cap(listPhrase(red))} ${verb(red)} no virtual tour. Add a Matterport/360 tour so remote and out-of-town prospects can walk the units without an in-person visit.${aptsNote}`,
        why: "Listings with a virtual tour convert more remote prospects and cut wasted in-person tours.",
        effort: aptsOnly ? "~15 min · request from your Apartments.com rep" : "~1 week · marketing manager + tour vendor",
        success: `A virtual tour live on ${listPhrase(red)} within 2 weeks.`,
        source: "Fixes the missing virtual-tour finding.",
      };
    },
  },
  {
    label: /preferred employer/i,
    covers: /preferred employer|employer/i,
    card: () => ({
      priority: "STRATEGIC",
      title: "Launch a preferred-employer program",
      what: "There is no preferred-employer program. Identify major local employers (hospitals, universities, corporate parks, military bases) and offer a modest move-in incentive, then add a Preferred Employers page to the website with partner logos and eligibility.",
      why: "Employer partnerships drive qualified, stable renters and differentiate the property from open-market-only competitors.",
      effort: "~2 weeks · property manager + marketing manager",
      success: "Preferred Employers page live and 3+ employer partnerships within 90 days.",
      source: "Fixes the missing preferred-employer finding.",
    }),
  },
  {
    label: /tour scheduling|schedule a tour|request a tour/i,
    covers: /tour scheduling|schedule a tour|request a tour|book a tour/i,
    card: (red) =>
      red.length
        ? {
            priority: "QUICK WIN",
            title: `Add tour scheduling to ${listPhrase(red)}`,
            what: `${cap(listPhrase(red))} ${verb(red)} no way to schedule a tour. Add a Schedule-a-Tour button / booking widget so prospects can self-book instead of waiting on a callback.`,
            why: "Self-scheduling captures prospects at peak intent, when a callback delay would lose them.",
            effort: "~2 hrs · marketing manager or web vendor",
            success: `A working tour-scheduling option live on ${listPhrase(red)} within 1 week.`,
            source: "Fixes the missing tour-scheduling finding.",
          }
        : null,
  },
  {
    label: /online application|apply online|application/i,
    covers: /online application|apply online|application portal/i,
    card: (red) =>
      red.length
        ? {
            priority: "QUICK WIN",
            title: `Add an online application link to ${listPhrase(red)}`,
            what: `${cap(listPhrase(red))} ${verb(red)} no online application path. Add a clear Apply-Online link so ready prospects can convert immediately.`,
            why: "Every step between intent and applying leaks conversions; a visible apply link captures ready renters.",
            effort: "~1 hr · marketing manager or web vendor",
            success: `A working online-application link live on ${listPhrase(red)} within 1 week.`,
            source: "Fixes the missing online-application finding.",
          }
        : null,
  },
  // Intentionally NEVER injected (handled elsewhere / not a deficiency):
  { label: /concession/i, covers: /concession/i, card: () => null }, // optional promo — never a required feature
  { label: /currently advertising/i, covers: /apartments\.?com/i, card: () => null }, // dark apts → reactivation card
];

/**
 * Returns fix cards for every RED consistency finding that no existing
 * recommendation already covers. Empty array when everything is covered.
 */
export function missingFindingCards(
  rows: CovRow[],
  existingRecs: CovRecLike[],
  ctx: { aptIsDark: boolean }
): CoverageCard[] {
  const recsText = (existingRecs || []).map((c) => `${c?.title || ""}. ${c?.what || ""}`);
  const covered = (re: RegExp) => recsText.some((t) => re.test(t));
  const out: CoverageCard[] = [];
  for (const row of rows || []) {
    const label = row?.label || "";
    let red: PlatformKey[] = (["website", "apartments", "google"] as PlatformKey[]).filter(
      (p) => row?.[p]?.status === "red"
    );
    if (!red.length) continue;
    // When Apartments.com is dark, all its issues fold into the reactivation card.
    if (ctx.aptIsDark) red = red.filter((p) => p !== "apartments");
    if (!red.length) continue;
    const note = (row?.[red[0]]?.note || "").toString().trim();
    const topic = TOPICS.find((t) => t.label.test(label));
    if (topic) {
      if (covered(topic.covers)) continue; // the model already wrote a fix
      const card = topic.card(red, note, ctx.aptIsDark);
      if (card) out.push(card);
    } else {
      // Unknown/future row type: still GUARANTEE coverage with a generic fix card.
      const key = label.split("/")[0].trim();
      if (key && covered(new RegExp(escapeReg(key), "i"))) continue;
      out.push({
        priority: "FOUNDATIONAL",
        title: `Resolve the "${label}" issue`,
        what: `The consistency check flagged "${label}" as an issue on ${listPhrase(red)}${note ? ` (${note})` : ""}. Correct it so this data point is accurate and consistent across your listings.`,
        why: "An unresolved inconsistency across your listings erodes prospect trust and can suppress conversions.",
        effort: "~30 min · marketing manager",
        success: `"${label}" shown accurately and consistently within 1 week.`,
        source: `Fixes the "${label}" finding in the consistency check.`,
      });
    }
  }
  return out;
}

/**
 * DETERMINISTIC RECOMMENDATIONS SOURCE.
 * Returns a fix card for EVERY red consistency finding — not just the ones a
 * model rec missed. This is how the marketing audit builds its recommendations:
 * entirely from the finalized consistency table, so a recommendation can only
 * ever exist for a real, verified issue and can never contradict the table.
 * Same rules as missingFindingCards (no Google-photo cards; a dark
 * Apartments.com listing folds into the reactivation card handled by the caller;
 * concession is never a required-feature card).
 */
export function allFindingCards(
  rows: CovRow[],
  ctx: { aptIsDark: boolean }
): CoverageCard[] {
  return missingFindingCards(rows, [], ctx);
}
