import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Google PageSpeed Insights proxy. Returns the Lighthouse performance score
 * plus Core Web Vitals for one URL + strategy (mobile | desktop).
 *
 * The PSI API is free. Without a key it is rate-limited (fine for the odd
 * audit); set PAGESPEED_API_KEY (a free Google Cloud "PageSpeed Insights API"
 * key) in the environment for reliable higher-volume use. The key is read at
 * runtime via bracket notation so Next doesn't inline it at build time.
 */
interface PsiRequest {
  url: string;
  strategy?: "mobile" | "desktop";
}

function normUrl(u: string): string {
  const t = (u || "").trim();
  if (!t) return "";
  return t.startsWith("http") ? t : `https://${t}`;
}

export async function POST(req: NextRequest) {
  let body: PsiRequest;
  try {
    body = (await req.json()) as PsiRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const url = normUrl(body.url);
  if (!url) return NextResponse.json({ error: "Missing 'url'" }, { status: 400 });
  const strategy = body.strategy === "desktop" ? "desktop" : "mobile";

  const params = new URLSearchParams({ url, strategy, category: "performance" });
  const key = process.env["PAGESPEED_API_KEY"] || process.env["GOOGLE_PSI_KEY"] || "";
  if (key) params.set("key", key);

  let data: {
    error?: { message?: string };
    lighthouseResult?: {
      categories?: { performance?: { score?: number } };
      audits?: Record<string, { displayValue?: string }>;
    };
  };
  try {
    const r = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params.toString()}`);
    data = await r.json();
    if (!r.ok || data?.error) {
      return NextResponse.json(
        { error: data?.error?.message || `PageSpeed request failed (status ${r.status})` },
        { status: r.status || 500 }
      );
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "PageSpeed request failed" },
      { status: 502 }
    );
  }

  const lh = data.lighthouseResult || {};
  const audits = lh.audits || {};
  const rawScore = lh.categories?.performance?.score;
  const score = typeof rawScore === "number" ? Math.round(rawScore * 100) : null;
  const dv = (k: string) => audits[k]?.displayValue || "—";

  return NextResponse.json({
    strategy,
    score,
    lcp: dv("largest-contentful-paint"),
    cls: dv("cumulative-layout-shift"),
    fcp: dv("first-contentful-paint"),
    tbt: dv("total-blocking-time"),
    speedIndex: dv("speed-index"),
  });
}
