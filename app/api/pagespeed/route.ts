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
  samples?: number;
}

function normUrl(u: string): string {
  const t = (u || "").trim();
  if (!t) return "";
  return t.startsWith("http") ? t : `https://${t}`;
}

type CruxExperience = {
  overall_category?: string;
  metrics?: Record<string, { percentile?: number; category?: string }>;
};
type PsiRaw = {
  error?: { message?: string };
  lighthouseResult?: {
    categories?: { performance?: { score?: number } };
    audits?: Record<string, { displayValue?: string }>;
  };
  loadingExperience?: CruxExperience;
  originLoadingExperience?: CruxExperience;
};
type PsiSample = {
  score: number;
  lcp: string;
  cls: string;
  fcp: string;
  tbt: string;
  speedIndex: string;
  field: {
    scope: string;
    category: string;
    lcp: string;
    cls: string;
    inp: string;
    fcp: string;
  } | null;
};

// A single Lighthouse lab run is synthetic and noisy (network jitter, CPU
// contention on Google's test box, cold vs. warm cache) — the same URL can swing
// 5–15 points run to run. We therefore take SEVERAL samples and report the MEDIAN,
// the standard way to tame that variance instead of trusting one draw. CrUX field
// data (real users, 28-day) is identical across samples, so it's read from any run.
function runOnce(url: string, strategy: string, key: string): Promise<PsiSample | null> {
  const params = new URLSearchParams({ url, strategy, category: "performance" });
  if (key) params.set("key", key);
  return fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params.toString()}`)
    .then((r) => r.json().then((d) => ({ ok: r.ok, status: r.status, d: d as PsiRaw })))
    .then(({ ok, d }) => {
      if (!ok || d?.error) return null;
      const lh = d.lighthouseResult || {};
      const audits = lh.audits || {};
      const rawScore = lh.categories?.performance?.score;
      if (typeof rawScore !== "number") return null;
      const dv = (k: string) => audits[k]?.displayValue || "—";
      const hasMetrics = (e?: CruxExperience) => !!(e?.metrics && Object.keys(e.metrics).length);
      const crux = hasMetrics(d.loadingExperience)
        ? d.loadingExperience
        : hasMetrics(d.originLoadingExperience)
        ? d.originLoadingExperience
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
              scope: hasMetrics(d.loadingExperience) ? "page" : "origin",
              category: crux!.overall_category || "",
              lcp: lcp != null ? (lcp / 1000).toFixed(1) + " s" : "—",
              cls: cls != null ? (cls / 100).toFixed(2) : "—",
              inp: inp != null ? Math.round(inp) + " ms" : "—",
              fcp: fcp != null ? (fcp / 1000).toFixed(1) + " s" : "—",
            };
          })()
        : null;
      return {
        score: Math.round(rawScore * 100),
        lcp: dv("largest-contentful-paint"),
        cls: dv("cumulative-layout-shift"),
        fcp: dv("first-contentful-paint"),
        tbt: dv("total-blocking-time"),
        speedIndex: dv("speed-index"),
        field,
      };
    })
    .catch(() => null);
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
  const key = process.env["PAGESPEED_API_KEY"] || process.env["GOOGLE_PSI_KEY"] || "";
  const samples = Math.max(1, Math.min(5, body.samples ?? 3));

  // Fire the samples together (fast) and keep whatever succeeds. If they all fail
  // (e.g. 429/network), surface the error like a single run would.
  const results = (await Promise.all(Array.from({ length: samples }, () => runOnce(url, strategy, key)))).filter(
    (r): r is PsiSample => r != null
  );
  if (results.length === 0) {
    return NextResponse.json(
      { error: "PageSpeed request failed (no samples returned — likely rate-limited; set PAGESPEED_API_KEY)" },
      { status: 502 }
    );
  }

  // Median by score. With an even count we take the lower-middle run so every
  // reported metric belongs to ONE real run (no synthetic mix of LCP-from-run-A,
  // CLS-from-run-B). Field data is identical across samples; use any run that has it.
  const sorted = [...results].sort((a, b) => a.score - b.score);
  const median = sorted[Math.floor((sorted.length - 1) / 2)];
  const field = results.find((r) => r.field)?.field ?? null;
  const scores = sorted.map((r) => r.score);

  return NextResponse.json({
    strategy,
    score: median.score,
    lcp: median.lcp,
    cls: median.cls,
    fcp: median.fcp,
    tbt: median.tbt,
    speedIndex: median.speedIndex,
    field,
    samples: results.length,
    scoreRange: scores.length > 1 ? { min: scores[0], max: scores[scores.length - 1] } : null,
  });
}
