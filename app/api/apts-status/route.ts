import { NextRequest, NextResponse } from "next/server";
import {
  aptAdvertisingFromRawHtml,
  aptConcessionFromRawHtml,
  aptWebsiteLinkFromRawHtml,
  aptHasVirtualTourFromRawHtml,
} from "@/lib/detectors";
import { aptOfficeHoursFromRawHtml } from "@/lib/hours";
import { brightDataRawDetailed } from "@/lib/brightdata";
import { getPool } from "@/lib/db";

/**
 * LAST GOOD READ per listing (Postgres). When Bright Data fails, the most recent
 * successful read (under 3 days old) is returned instead, flagged with cachedAt,
 * so one failed fetch doesn't turn hours / tours / photos into Checks. Hours,
 * tours and photos barely change in days; the caller still prefers a FRESH
 * concession from the backup reader because specials change often.
 */
const CACHE_MAX_AGE_MS = 3 * 24 * 3600 * 1000;
let cacheReady: Promise<void> | null = null;
function listingKey(url: string): string {
  try {
    const u = new URL(url);
    return (u.hostname.replace(/^www\./, "") + u.pathname).toLowerCase().replace(/\/+$/, "");
  } catch {
    return url.toLowerCase();
  }
}
async function cacheTable() {
  const p = getPool();
  if (!p) return null;
  if (!cacheReady) {
    cacheReady = p
      .query("CREATE TABLE IF NOT EXISTS apts_reads (key text PRIMARY KEY, data jsonb NOT NULL, fetched_at timestamptz NOT NULL DEFAULT now())")
      .then(() => undefined)
      .catch((e) => {
        cacheReady = null;
        throw e;
      });
  }
  await cacheReady;
  return p;
}
async function saveRead(url: string, data: Record<string, unknown>) {
  try {
    const p = await cacheTable();
    if (p) await p.query("INSERT INTO apts_reads (key, data, fetched_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, fetched_at = now()", [listingKey(url), data]);
  } catch {
    /* cache is best-effort */
  }
}
async function lastGoodRead(url: string): Promise<{ data: Record<string, unknown>; fetchedAt: string } | null> {
  try {
    const p = await cacheTable();
    if (!p) return null;
    const r = await p.query("SELECT data, fetched_at FROM apts_reads WHERE key = $1", [listingKey(url)]);
    const row = r.rows[0];
    if (!row) return null;
    const at = new Date(row.fetched_at);
    if (Date.now() - at.getTime() > CACHE_MAX_AGE_MS) return null;
    return { data: row.data, fetchedAt: at.toISOString() };
  } catch {
    return null;
  }
}

/** Gallery image URLs in the raw listing HTML (for the photo-quality pass). */
function photoUrlsFromRawHtml(html: string): string[] {
  const all = html.match(/https?:\/\/images\d*\.apartments\.com\/i2\/[A-Za-z0-9_-]+\/\d+\/[A-Za-z0-9_.%-]+/g) || [];
  return Array.from(new Set(all)).slice(0, 6);
}

export const runtime = "nodejs";
export const maxDuration = 150;

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
    // Apartments.com via the Unlocker can be genuinely SLOW (50s+) as well as
    // empty-fast, so give each attempt a longer window than the default 35s — a
    // 35s cap kills a slow-but-successful fetch, dropping VT/hours/concession and
    // producing a false "couldn't confirm" (the recurring virtual-tour CHECK). 3
    // attempts x 45s stays under the route's maxDuration.
    const { html, error } = await brightDataRawDetailed(url, { minLength: 5000, attempts: 3, timeoutMs: 45000 });
    if (!html) {
      const cached = await lastGoodRead(url);
      if (cached) return NextResponse.json({ ...cached.data, cachedAt: cached.fetchedAt, readError: error });
      return NextResponse.json({ advertising: null, officeHours: null, concession: null, websiteUrl: null, virtualTour: null, readError: error });
    }
    // Office hours + concession from the RAW HTML are AUTHORITATIVE. The visible
    // listing collapses hours behind "View All Hours" (model misreads closed days as
    // open) and the model has also misread the concession banner (e.g. reporting a
    // stale "Apply by July 3" when the listing shows the current Summer Savings offer).
    // The advertising flag doubles as a "was this a good raw fetch?" signal for the
    // caller (boolean = good; null = fetch too thin to trust).
    const read = {
      advertising: aptAdvertisingFromRawHtml(html),
      officeHours: aptOfficeHoursFromRawHtml(html),
      concession: aptConcessionFromRawHtml(html),
      websiteUrl: aptWebsiteLinkFromRawHtml(html),
      virtualTour: aptHasVirtualTourFromRawHtml(html),
      photoUrls: photoUrlsFromRawHtml(html),
    };
    // Only a conclusive read is worth keeping as the fallback.
    if (typeof read.advertising === "boolean") await saveRead(url, read);
    return NextResponse.json(read);
  } catch {
    return NextResponse.json({ advertising: null, officeHours: null, concession: null, websiteUrl: null, virtualTour: null });
  }
}
