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

  type CruxExperience = {
    overall_category?: string;
    metrics?: Record<string, { percentile?: number; category?: string }>;
  };
  let data: {
    error?: { message?: string };
    lighthouseResult?: {
      categories?: { performance?: { score?: number } };
      audits?: Record<string, { displayValue?: string }>;
    };
    loadingExperience?: CruxExperience;
    originLoadingExperience?: CruxExperience;
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

  // CrUX field data — REAL users over a 28-day rolling window, so it's STABLE
  // run-to-run (unlike the synthetic Lighthouse lab numbers above, which vary).
  // Prefer this-page data; fall back to origin-level. Absent for low-traffic
  // sites (not enough real visitors to be in the Chrome UX Report) -> field:null.
  const hasMetrics = (e?: CruxExperience) => !!(e?.metrics && Object.keys(e.metrics).length);
  const crux = hasMetrics(data.loadingExperience)
    ? data.loadingExperience
    : hasMetrics(data.originLoadingExperience)
    ? data.originLoadingExperience
    : undefined;
  const pct = (k: string) =>
    typeof crux?.metrics?.[k]?.percentile === "number" ? (crux.metrics[k].percentile as number) : null;
  const field = crux
    ? (() => {
        const lcp = pct("LARGEST_CONTENTFUL_PAINT_MS");
        const cls = pct("CUMULATIVE_LAYOUT_SHIFT_SCORE");
        const inp = pct("INTERACTION_TO_NEXT_PAINT");
        const fcp = pct("FIRST_CONTENTFUL_PAINT_MS");
        return {
          scope: hasMetrics(data.loadingExperience) ? "page" : "origin",
          category: crux.overall_category || "",
          lcp: lcp != null ? (lcp / 1000).toFixed(1) + " s" : "—",
          cls: cls != null ? (cls / 100).toFixed(2) : "—",
          inp: inp != null ? Math.round(inp) + " ms" : "—",
          fcp: fcp != null ? (fcp / 1000).toFixed(1) + " s" : "—",
        };
      })()
    : null;

  return NextResponse.json({
    strategy,
    score,
    lcp: dv("largest-contentful-paint"),
    cls: dv("cumulative-layout-shift"),
    fcp: dv("first-contentful-paint"),
    tbt: dv("total-blocking-time"),
    speedIndex: dv("speed-index"),
    field,
  });
}
