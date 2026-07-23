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
  opts: { minLength?: number; attempts?: number } = {}
): Promise<string | null> {
  const token = process.env.BRIGHTDATA_API_TOKEN;
  const zone = process.env.BRIGHTDATA_ZONE;
  if (!token || !zone || !url) return null;
  const minLength = opts.minLength ?? 1000;
  const attempts = opts.attempts ?? 3;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch("https://api.brightdata.com/request", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ zone, url, format: "raw" }),
        signal: AbortSignal.timeout(90000),
      });
      if (r.ok) {
        const html = await r.text();
        if (html && html.length >= minLength) return html;
      }
    } catch {
      /* empty body / timeout / network — fall through and retry */
    }
  }
  return null;
}
