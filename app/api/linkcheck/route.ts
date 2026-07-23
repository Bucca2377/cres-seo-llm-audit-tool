import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Lightweight "does this link actually work?" check. Follows redirects and reports
 * whether the URL resolves to a live page and what domain it lands on — used to
 * confirm the Website link on a Google listing (and the Apartments.com "View
 * Property Website" link) genuinely reaches the property's site, not a dead end.
 *
 * A Cloudflare/bot 403 or 429 still means the site is UP (it loads fine in a real
 * visitor's browser), so those count as reachable. A network error / DNS failure /
 * timeout is INCONCLUSIVE (reachable: null) — often just our datacenter IP being
 * blocked — never reported as "broken".
 */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function domainOf(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

export async function POST(req: NextRequest) {
  let url = "";
  try {
    url = ((await req.json()) as { url?: string })?.url || "";
  } catch {
    return NextResponse.json({ reachable: null });
  }
  if (!url) return NextResponse.json({ reachable: null });
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;

  try {
    const r = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*" },
      signal: AbortSignal.timeout(20000),
    });
    const finalUrl = r.url || url;
    const reachable = (r.status >= 200 && r.status < 400) || r.status === 403 || r.status === 429;
    return NextResponse.json({ reachable, status: r.status, finalUrl, finalDomain: domainOf(finalUrl) });
  } catch {
    // DNS/timeout/network — could be dead, could be blocking our IP. Inconclusive.
    return NextResponse.json({ reachable: null, status: 0, finalUrl: url, finalDomain: domainOf(url) });
  }
}
