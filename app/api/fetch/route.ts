import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Resolve the installed Chromium executable directly from the Playwright
 * browser cache. The Next dev server's Playwright sometimes fails its internal
 * "Executable doesn't exist" check even when the binary IS present (a flaky
 * resolution under Turbopack), so we find the real exe ourselves and pass it as
 * executablePath, bypassing that check entirely. Returns undefined if nothing
 * is found, in which case we fall back to Playwright's own resolution.
 */
function resolveChromiumExe(): string | undefined {
  const base = path.join(
    process.env.PLAYWRIGHT_BROWSERS_PATH ||
      process.env.LOCALAPPDATA ||
      path.join(os.homedir(), "AppData", "Local"),
    process.env.PLAYWRIGHT_BROWSERS_PATH ? "" : "ms-playwright"
  );
  // (dir, relative exe path) — prefer the lightweight headless shell.
  const variants: [RegExp, string[]][] = [
    [/^chromium_headless_shell-/, ["chrome-headless-shell-win64", "chrome-headless-shell.exe"]],
    [/^chromium_headless_shell-/, ["chrome-headless-shell-linux", "chrome-headless-shell"]],
    [/^chromium-/, ["chrome-win", "chrome.exe"]],
    [/^chromium-/, ["chrome-linux", "chrome"]],
  ];
  try {
    const dirs = fs.readdirSync(base);
    for (const [re, rel] of variants) {
      for (const d of dirs) {
        if (!re.test(d)) continue;
        const exe = path.join(base, d, ...rel);
        if (fs.existsSync(exe)) return exe;
      }
    }
  } catch {
    /* ignore — fall back to Playwright's own resolution */
  }
  return undefined;
}

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
    const executablePath = resolveChromiumExe();
    browser = await chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
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
  const imageSet = new Set<string>();
  const MAX_IMAGES = 12;
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
        // Gallery/marketing photo URLs (resolved absolute) so the caller can
        // hand them to a vision model to grade quality. We abort image *bytes*
        // for speed, but the <img> src/srcset attributes are still in the DOM.
        const images: string[] = await page.evaluate(() => {
          const bad = /logo|icon|sprite|favicon|placeholder|pixel|blank|spacer|loading|avatar|badge|thumb|map|pin/i;
          const out: string[] = [];
          document.querySelectorAll("img").forEach((node) => {
            const img = node as HTMLImageElement;
            let u = "";
            const srcset = img.getAttribute("srcset");
            if (srcset) {
              const cands = srcset.split(",").map((s) => s.trim().split(/\s+/)[0]).filter(Boolean);
              if (cands.length) u = cands[cands.length - 1]; // largest candidate
            }
            if (!u) u = img.getAttribute("src") || img.getAttribute("data-src") || img.getAttribute("data-lazy") || "";
            if (!u || u.startsWith("data:")) return;
            try {
              u = new URL(u, location.href).href;
            } catch {
              return;
            }
            if (/\.svg(\?|$)/i.test(u) || bad.test(u)) return;
            out.push(u);
          });
          return out;
        });
        return { status: resp ? resp.status() : null, text: text.slice(0, PAGE_TEXT_CAP), links, images };
      } finally {
        await ctx.close();
      }
    };

    const collectImages = (imgs: string[] | undefined) => {
      for (const u of imgs || []) {
        if (imageSet.size >= MAX_IMAGES) break;
        imageSet.add(u);
      }
    };

    const home = await render(start, !!body.follow);
    pages.push({ url: start, status: home.status, text: home.text });
    collectImages(home.images);

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
          collectImages(r.images);
        } catch {
          pages.push({ url: c, status: null, text: "" });
        }
      }
    }

    const images = Array.from(imageSet);
    return NextResponse.json({ pages, images, _meta: { source: "playwright", pages: pages.length, images: images.length } });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Render failed", pages },
      { status: 500 }
    );
  } finally {
    await browser.close();
  }
}
