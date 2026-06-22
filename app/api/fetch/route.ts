import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

interface FetchRequest {
  url: string;
  /** Follow the real nav links found on the page and render those too. */
  follow?: boolean;
  /** Max total pages to render when following (includes the start page). */
  maxPages?: number;
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Nav links worth following on an apartment site.
const NAV_RE =
  /floor|plan|amenit|photo|galler|tour|contact|apply|special|concession|pet|faq|lease|availab|neighbor|pricing|gallery/i;

const PAGE_TEXT_CAP = 14000;

function normUrl(u: string): string {
  const t = (u || "").trim();
  if (!t) return "";
  return t.startsWith("http") ? t : `https://${t}`;
}

export async function POST(req: NextRequest) {
  let body: FetchRequest;
  try {
    body = (await req.json()) as FetchRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const start = normUrl(body.url);
  if (!start) return NextResponse.json({ error: "Missing 'url'" }, { status: 400 });
  const maxPages = Math.min(Math.max(body.maxPages || 1, 1), 10);

  // Lazy import so the bundle stays light and build doesn't choke on the
  // native module (kept external in next.config).
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    return NextResponse.json(
      { error: "Headless browser not available. Run: npx playwright install chromium" },
      { status: 500 }
    );
  }

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
  } catch (e) {
    // Graceful: return 200 with no pages so the audit degrades to "verify
    // live" amber instead of a hard failure. Most common cause: Playwright
    // was updated but its browser wasn't reinstalled, or the dev server is
    // running with a stale browser registry (restart it).
    const msg = e instanceof Error ? e.message.split("\n")[0] : "launch failed";
    return NextResponse.json({
      pages: [],
      error: `Headless browser failed to launch: ${msg}. Run "npx playwright install chromium" and restart the dev server.`,
    });
  }
  const pages: { url: string; status: number | null; text: string }[] = [];
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  try {
    // Each page gets a FRESH context. The target sites flag rapid sequential
    // navigations within one session (2nd+ nav returns 403), but a fresh
    // context per page behaves like a first-time visitor and gets through.
    const render = async (target: string, wantLinks: boolean) => {
      const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 900 } });
      await ctx.route("**/*", (route) => {
        const t = route.request().resourceType();
        if (t === "image" || t === "media" || t === "font") route.abort();
        else route.continue();
      });
      const page = await ctx.newPage();
      try {
        const resp = await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(3500); // let client-side widgets + challenge resolve
        const text: string = await page.evaluate(() => document.body?.innerText || "");
        let links: { href: string; text: string }[] = [];
        if (wantLinks) {
          links = await page.evaluate(() =>
            Array.from(document.querySelectorAll("a[href]")).map((a) => ({
              href: (a as HTMLAnchorElement).href,
              text: (a.textContent || "").trim().slice(0, 60),
            }))
          );
        }
        return { status: resp ? resp.status() : null, text: text.slice(0, PAGE_TEXT_CAP), links };
      } finally {
        await ctx.close();
      }
    };

    const home = await render(start, !!body.follow);
    pages.push({ url: start, status: home.status, text: home.text });

    if (body.follow && maxPages > 1) {
      let origin = "";
      try {
        origin = new URL(start).origin;
      } catch {
        /* ignore */
      }
      const seen = new Set<string>([start.replace(/\/+$/, "")]);
      const candidates: string[] = [];
      for (const l of home.links) {
        let href = l.href;
        try {
          const u = new URL(href);
          if (origin && u.origin !== origin) continue; // same-site only
          href = u.href.split("#")[0].replace(/\/+$/, "");
        } catch {
          continue;
        }
        if (seen.has(href)) continue;
        if (!NAV_RE.test(l.text) && !NAV_RE.test(href)) continue;
        seen.add(href);
        candidates.push(href);
        if (candidates.length >= maxPages - 1) break;
      }
      for (const c of candidates) {
        await sleep(1500); // space out navigations so the site doesn't 403 the session
        try {
          const r = await render(c, false);
          pages.push({ url: c, status: r.status, text: r.text });
        } catch {
          pages.push({ url: c, status: null, text: "" });
        }
      }
    }

    return NextResponse.json({ pages, _meta: { source: "playwright", pages: pages.length } });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Render failed", pages },
      { status: 500 }
    );
  } finally {
    await browser.close();
  }
}
