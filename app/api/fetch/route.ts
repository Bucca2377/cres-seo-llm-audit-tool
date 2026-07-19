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

/** On-page SEO facts extracted per rendered page (see the render() evaluate). */
type PageSeoData = {
  title: string;
  metaDescription: string;
  h1Count: number;
  h1Text: string;
  hasCanonical: boolean;
  hasSchema: boolean;
  internalLinks: number;
  wordCount: number;
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Nav links worth following on an apartment site.
const NAV_RE =
  /floor|plan|amenit|photo|galler|tour|contact|apply|special|concession|pet|faq|lease|availab|neighbor|pricing|gallery/i;

const PAGE_TEXT_CAP = 14000;

/**
 * Fetch a URL through Bright Data's Web Unlocker — residential IPs that defeat
 * Cloudflare and return the real HTML. This is the only reliable way to read a
 * bot-protected site (e.g. a JS-injected specials popup) from a datacenter like
 * Railway, where our own headless browser gets a 403 challenge and Claude's
 * web_fetch strips the embedded JSON. Verified live: returns the full page
 * (including the specials data) in ~9s. Gated on BRIGHTDATA_API_TOKEN +
 * BRIGHTDATA_ZONE — no creds means unchanged behavior. Works for ANY
 * bot-protected site, not one specific marketing tool.
 */
async function fetchViaUnblockService(url: string): Promise<string | null> {
  const token = process.env.BRIGHTDATA_API_TOKEN;
  const zone = process.env.BRIGHTDATA_ZONE;
  if (!token || !zone) return null;
  try {
    const r = await fetch("https://api.brightdata.com/request", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ zone, url, format: "raw" }),
      signal: AbortSignal.timeout(60000),
    });
    if (!r.ok) return null;
    const html = await r.text();
    return html && html.length > 200 ? html : null;
  } catch {
    return null;
  }
}

/**
 * A move-in special often lives in the page's embedded JSON (a <script>), which
 * htmlToText strips out — so pull it straight from the raw HTML and JSON-unescape
 * it to a clean string. High-precision phrases (same as the audit's concession
 * detector) so it won't fire on "security deposit"/"application fee"/"no
 * specials". Returns null when no special is present. Verified on Bright Data
 * output: extracts "Lowest Prices... Half-Off Security Deposit Waived App Fees".
 */
const CONCESSION_RE =
  /waived?\s+\w{0,12}\s*(application|app|admin|amenity|move|fee)|(application|app|admin|amenity|move[-\s]?in)\s+fees?\s+waived|(half|1\/2)[-\s]?off|(first|1st|one|two|three|1|2|3)\s+month.?s?\s+free|\d+\s+weeks?\s+free|move[-\s]?in\s+special|limited[-\s]?time\s+special|look\s*(and|&|\+)\s*lease|\$\d[\d,]*\s*off|\d+%\s*off|reduced\s+deposit|deposit\s+special|rent\s+special|months?\s+free\s+rent/i;
function specialFromHtml(html: string): string | null {
  const m = html.match(CONCESSION_RE);
  if (!m || m.index === undefined) return null;
  return html
    .slice(Math.max(0, m.index - 90), m.index + 170)
    .replace(/\\u([0-9a-fA-F]{4})/g, (_full, h) => {
      try {
        return String.fromCharCode(parseInt(h, 16));
      } catch {
        return " ";
      }
    })
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\")
    .replace(/\\\//g, "/")
    .replace(/\\[nrt]/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip a rendered HTML document to readable text (scripts/styles removed). */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when a rendered page looks like a bot-challenge wall, not the real site. */
function looksBotBlocked(status: number | null, text: string): boolean {
  if (status === 403) return true;
  if (text.replace(/\s+/g, "").length < 200) return true;
  return /performing security verification|challenges\.cloudflare|checking your browser|verify you are (a )?human|are not a bot|enable javascript and cookies|attention required/i.test(
    text
  );
}

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

  // Launch is INTERMITTENTLY flaky on the Windows dev server: the same binary
  // launches fine one moment and throws "Executable doesn't exist" the next
  // (antivirus briefly locking the 203MB exe, or a Turbopack resolution race).
  // Since it works "every other time", retrying a few times with a short pause
  // makes it succeed nearly always. Re-resolve the exe each attempt too.
  let browser;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4 && !browser; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1500));
    try {
      const executablePath = resolveChromiumExe();
      browser = await chromium.launch({
        headless: true,
        ...(executablePath ? { executablePath } : {}),
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      });
    } catch (e) {
      lastErr = e;
    }
  }
  if (!browser) {
    // Graceful: return 200 with no pages so the audit degrades to "verify
    // live" amber instead of a hard failure.
    const msg = lastErr instanceof Error ? lastErr.message.split("\n")[0] : "launch failed";
    return NextResponse.json({
      pages: [],
      error: `Headless browser failed to launch after 4 attempts: ${msg}. Run "npx playwright install chromium" and restart the dev server.`,
    });
  }
  const pages: { url: string; status: number | null; text: string; seo?: PageSeoData }[] = [];
  const imageSet = new Set<string>();
  const MAX_IMAGES = 12;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  try {
    // Each page gets a FRESH context. The target sites flag rapid sequential
    // navigations within one session (2nd+ nav returns 403), but a fresh
    // context per page behaves like a first-time visitor and gets through.
    const render = async (target: string, wantLinks: boolean, pollLate = false) => {
      const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 900 } });
      await ctx.route("**/*", (route) => {
        const t = route.request().resourceType();
        if (t === "image" || t === "media" || t === "font") route.abort();
        else route.continue();
      });
      const page = await ctx.newPage();
      try {
        const resp = await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30000 });
        if (pollLate) {
          // Wait for LATE-injected content — specials/concession popups that
          // Entrata/NurtureBoss inject SECONDS after the page looks done. Poll up
          // to ~10s and break the moment a special appears. Do NOT break on "DOM
          // settled": the popup lands AFTER the page settles, so a settle-break
          // stops too early and misses it (the production bug that hid the
          // concession — locally the popup loaded fast enough to beat the settle,
          // on Railway's slower network it didn't). No concession => waits the
          // full window then captures whatever's there. HINT excludes the bare
          // word "special" so "special features" in main content can't trip it.
          const HINT =
            /waived|half.?off|free rent|month.?free|weeks?\s+free|\d+%\s*off|\$\d[\d,]*\s*off|limited.?time\s+special|move.?in\s+special|reduced deposit|rent special|deposit special/i;
          for (let poll = 0; poll < 12; poll++) {
            await page.waitForTimeout(800);
            const cur: string = await page.evaluate(() => document.body?.innerText || "");
            if (HINT.test(cur)) break; // special appeared — capture now
          }
        } else {
          await page.waitForTimeout(3500); // let client-side widgets + challenge resolve
        }
        const text: string = await page.evaluate(() => document.body?.innerText || "");
        // Also pull text from iframes. Some marketing tools render the
        // specials/concession popup (and chat/lead widgets) inside a
        // cross-origin iframe, which document.body.innerText does NOT include.
        // Playwright can read each frame's content, so an iframe-based concession
        // banner isn't missed. Best-effort: skip frames that block eval.
        let frameText = "";
        try {
          for (const f of page.frames()) {
            if (f === page.mainFrame()) continue;
            try {
              const ft: string = await f.evaluate(() => document.body?.innerText || "");
              if (ft && ft.trim().length > 20) frameText += "\n" + ft.trim();
            } catch {
              /* frame blocked eval — skip it */
            }
          }
        } catch {
          /* ignore frame enumeration errors */
        }
        let pageText = frameText ? `${text}\n\n[EMBEDDED WIDGETS]\n${frameText}` : text;
        const pageStatus = resp ? resp.status() : null;
        // If the browser got a Cloudflare/bot wall (common from Railway's
        // datacenter IP — a 403 "verify you're not a bot" page), we never saw
        // the real site or its JS-injected specials popup. Re-fetch through the
        // residential-IP unblock service (renders JS + defeats Cloudflare) and
        // use that fully-rendered HTML. Gated to the HOMEPAGE (pollLate) — that's
        // where the specials popup is, and it keeps cost to ONE unblock call per
        // audit. We keep the page's real (blocked) status so the existing
        // web_fetch fallback still fills pricing/hours from the other pages; the
        // deterministic concession detector reads this rescued homepage text out
        // of siteText. Only runs when a key is set, so normal sites are untouched.
        if (pollLate && looksBotBlocked(pageStatus, pageText)) {
          const html = await fetchViaUnblockService(target);
          if (html) {
            const unblocked = htmlToText(html);
            if (unblocked.length > pageText.length) pageText = unblocked;
            // The special is usually in embedded JSON that htmlToText strips —
            // pull it from the raw HTML and append so the audit's concession
            // detector sees it in the page text.
            const special = specialFromHtml(html);
            if (special) pageText += `\n[SPECIAL] ${special}`;
          }
        }
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
        // On-page SEO facts for the technical audit (title, meta description,
        // H1s, canonical, JSON-LD schema, internal-link count, word count).
        const seo = await page.evaluate(() => {
          const host = location.host;
          const md =
            document.querySelector('meta[name="description"]')?.getAttribute("content") || "";
          const h1s = Array.from(document.querySelectorAll("h1"))
            .map((h) => (h.textContent || "").trim())
            .filter(Boolean);
          let internal = 0;
          document.querySelectorAll("a[href]").forEach((a) => {
            try {
              if (new URL((a as HTMLAnchorElement).href).host === host) internal++;
            } catch {
              /* ignore unparseable href */
            }
          });
          const words = (document.body?.innerText || "").trim().split(/\s+/).filter(Boolean).length;
          return {
            title: (document.title || "").trim(),
            metaDescription: md.trim(),
            h1Count: h1s.length,
            h1Text: h1s[0] || "",
            hasCanonical: !!document.querySelector('link[rel="canonical"]'),
            hasSchema:
              document.querySelectorAll('script[type="application/ld+json"]').length > 0,
            internalLinks: internal,
            wordCount: words,
          };
        });
        return { status: pageStatus, text: pageText.slice(0, PAGE_TEXT_CAP), links, images, seo };
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

    // Retry the homepage render too: a launch can succeed but the first nav
    // still flake. An empty homepage blanks the entire website column, so it's
    // worth a second attempt before giving up.
    let home: {
      status: number | null;
      text: string;
      links: { href: string; text: string }[];
      images: string[];
      seo?: PageSeoData;
    } = {
      status: null,
      text: "",
      links: [],
      images: [],
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await sleep(1500);
      try {
        home = await render(start, !!body.follow, true);
        if (home.text && home.text.trim().length > 50) break; // got real content
      } catch {
        /* retry once */
      }
    }
    pages.push({ url: start, status: home.status, text: home.text, seo: home.seo });
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
          pages.push({ url: c, status: r.status, text: r.text, seo: r.seo });
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
