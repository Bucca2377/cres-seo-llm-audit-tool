import { NextRequest, NextResponse } from "next/server";
import {
  aptAdvertisingFromRawHtml,
  aptConcessionFromRawHtml,
  aptWebsiteLinkFromRawHtml,
  aptHasVirtualTourFromRawHtml,
} from "@/lib/detectors";
import { aptOfficeHoursFromRawHtml } from "@/lib/hours";
import { brightDataRaw } from "@/lib/brightdata";

export const runtime = "nodejs";
export const maxDuration = 90;

/**
 * Deterministic "is this Apartments.com listing actively advertising?" check.
 *
 * Why a dedicated route: the on-page banner "This property is not currently
 * advertising on Apartments.com" is painted by JavaScript client-side, so it is
 * NOT in the HTML that web_fetch or a raw fetch returns — you cannot match that
 * text. But the RAW HTML (via Bright Data, which also clears Cloudflare) reliably
 * carries the real structural signals:
 *   - an ACTIVE listing renders the property's own "Pricing & Floor Plans" /
 *     "Monthly Rent" section (present in the embedded listing JSON), and
 *   - a DARK shell has neither and instead pushes "Explore Similar Rentals Nearby".
 * Running the check on the raw HTML (not web_fetch's content, which picks up the
 * nearby-listing pricing and false-positives) makes the verdict reliable.
 *
 * Returns { advertising: true | false | null } — null when undeterminable
 * (no creds, fetch failed, or thin HTML) so the caller keeps its prior read.
 */
export async function POST(req: NextRequest) {
  let url = "";
  try {
    url = ((await req.json()) as { url?: string })?.url || "";
  } catch {
    return NextResponse.json({ advertising: null });
  }
  try {
    // Bright Data intermittently returns an empty body on the first hit; brightDataRaw
    // retries so a transient empty response no longer wipes the deterministic reads and
    // falls the audit back to a false "couldn't read the hours this run." A real
    // Apartments.com listing (active or dark shell) is hundreds of KB, so require a
    // substantial body before trusting it.
    const html = await brightDataRaw(url, { minLength: 5000, attempts: 4 });
    if (!html) return NextResponse.json({ advertising: null, officeHours: null, concession: null, websiteUrl: null, virtualTour: null });
    // Office hours + concession from the RAW HTML are AUTHORITATIVE. The visible
    // listing collapses hours behind "View All Hours" (model misreads closed days as
    // open) and the model has also misread the concession banner (e.g. reporting a
    // stale "Apply by July 3" when the listing shows the current Summer Savings offer).
    // The advertising flag doubles as a "was this a good raw fetch?" signal for the
    // caller (boolean = good; null = fetch too thin to trust).
    return NextResponse.json({
      advertising: aptAdvertisingFromRawHtml(html),
      officeHours: aptOfficeHoursFromRawHtml(html),
      concession: aptConcessionFromRawHtml(html),
      websiteUrl: aptWebsiteLinkFromRawHtml(html),
      virtualTour: aptHasVirtualTourFromRawHtml(html),
    });
  } catch {
    return NextResponse.json({ advertising: null, officeHours: null, concession: null, websiteUrl: null, virtualTour: null });
  }
}
