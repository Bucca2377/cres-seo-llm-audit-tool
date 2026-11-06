/**
 * Shared Bright Data Web Unlocker fetch for bot-protected pages (Apartments.com,
 * Cloudflare-gated sites). Single source of truth for the retry behavior.
 *
 * The Unlocker INTERMITTENTLY returns HTTP 200 with an EMPTY body — the very same
 * URL then returns the full ~800KB page on an immediate retry. When one of those
 * empty responses reached /api/apts-status it wiped every deterministic read
 * (office hours, concession, virtual tour, advertising), so the audit fell back to
 * an amber "couldn't read the hours this run" on a listing whose full weekly hours
 * were actually sitting right there in the HTML. Retrying on an empty/thin body
 * eliminates that class of false "couldn't read" flags at the source.
 *
 * Returns the first response body at least `minLength` chars long, or null when no
 * attempt produced a usable body. Empty bodies come back fast, so the retries add
 * negligible latency in the common case. Gated on BRIGHTDATA_API_TOKEN +
 * BRIGHTDATA_ZONE — no creds returns null (caller keeps its prior behavior).
 */
export async function brightDataRaw(
  url: string,
  opts: { minLength?: number; attempts?: number; timeoutMs?: number; accept?: (html: string) => boolean } = {}
): Promise<string | null> {
  return (await brightDataRawDetailed(url, opts)).html;
}

/**
 * Same fetch, but also says WHY it failed (last attempt's reason), so the audit
 * can show it instead of silently falling back: "no credentials", "HTTP 402 …",
 * "empty body (n chars)", "timed out after 45s".
 */
export async function brightDataRawDetailed(
  url: string,
  opts: { minLength?: number; attempts?: number; timeoutMs?: number; accept?: (html: string) => boolean } = {}
): Promise<{ html: string | null; error: string | null }> {
  const token = process.env.BRIGHTDATA_API_TOKEN;
  const zone = process.env.BRIGHTDATA_ZONE;
  if (!token || !zone) return { html: null, error: "Bright Data credentials are not set in Railway" };
  if (!url) return { html: null, error: "no listing URL" };
  let error: string | null = null;
  const minLength = opts.minLength ?? 1000;
  const attempts = opts.attempts ?? 3;
  // A real Unlocker fetch returns in ~9s and an empty body comes back near-instantly,
  // so 90s/attempt just let a slow hang stall the whole audit. Cap it tight.
  const timeoutMs = opts.timeoutMs ?? 35000;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch("https://api.brightdata.com/request", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ zone, url, format: "raw" }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const body = await r.text();
      if (r.ok && body && body.length >= minLength) {
        // A full-size page can still be the WRONG page (Apartments.com served Reserve at
        // Sawmill's fetch its 69 KB generic homepage). Let the caller reject it so the
        // next attempt runs instead of the bad page being used.
        if (!opts.accept || opts.accept(body)) return { html: body, error: null };
        const title = (body.match(/<title>([^<]{0,80})/i) || [])[1]?.trim();
        error = `a page came back but it wasn't the listing (${Math.round(body.length / 1024)} KB${title ? `, titled "${title}"` : ""}), likely a bot check`;
        continue;
      }
      error = r.ok
        ? `the page that came back was too small to be the real page (${Math.round(body.length / 1024)} KB), likely a bot check`
        : `Bright Data HTTP ${r.status}${body ? ": " + body.replace(/\s+/g, " ").slice(0, 120) : ""}`;
    } catch (e) {
      error =
        e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")
          ? `timed out after ${Math.round(timeoutMs / 1000)}s`
          : `network error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return { html: null, error: `${error ?? "unknown error"} (after ${attempts} attempts)` };
}
