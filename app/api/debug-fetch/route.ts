import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

// TEMPORARY diagnostic: renders a URL with the same headless browser the audit
// uses and reports what it ACTUALLY captured (text length, whether a concession
// popup appeared and when, per-iframe text, a snippet). Lets us see what the
// Railway crawler sees for a JS-injected specials popup. Open in an authed
// browser: /api/debug-fetch?url=https://www.reserveatsawmillapartments.com
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const HINT =
  /waived|half.?off|free rent|month.?free|weeks?\s+free|\d+%\s*off|\$\d[\d,]*\s*off|limited.?time\s+special|move.?in\s+special|reduced deposit|rent special|deposit special/i;

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("url");
  if (!raw) return NextResponse.json({ error: "?url= required" }, { status: 400 });
  const url = raw.startsWith("http") ? raw : `https://${raw}`;

  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch (e) {
    return NextResponse.json({ error: "playwright import failed: " + String(e).slice(0, 150) });
  }

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
  } catch (e) {
    return NextResponse.json({ error: "launch failed: " + String(e).slice(0, 200) });
  }

  try {
    const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 900 } });
    const page = await ctx.newPage();
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

    const snapshots: { atMs: number; len: number; hint: boolean }[] = [];
    let hintFoundAtMs = -1;
    for (let poll = 0; poll < 12; poll++) {
      await page.waitForTimeout(800);
      const cur: string = await page.evaluate(() => document.body?.innerText || "");
      if (HINT.test(cur) && hintFoundAtMs < 0) hintFoundAtMs = (poll + 1) * 800;
      snapshots.push({ atMs: (poll + 1) * 800, len: cur.length, hint: HINT.test(cur) });
    }

    const text: string = await page.evaluate(() => document.body?.innerText || "");
    const frames: { url: string; len?: number; hint?: boolean; err?: string }[] = [];
    for (const f of page.frames()) {
      try {
        const t: string = await f.evaluate(() => document.body?.innerText || "");
        frames.push({ url: f.url().slice(0, 70), len: t.length, hint: HINT.test(t) });
      } catch (e) {
        frames.push({ url: f.url().slice(0, 70), err: String(e).slice(0, 60) });
      }
    }

    const m = text.match(/[\s\S]{0,60}(?:special|waived|half.?off|deposit|free|off)[\s\S]{0,140}/i);
    const snippet = (m ? m[0] : text.slice(0, 300)).replace(/\s+/g, " ").trim();

    return NextResponse.json({
      url,
      status: resp ? resp.status() : null,
      textLen: text.length,
      concessionHintInFinalText: HINT.test(text),
      hintFirstFoundAtMs: hintFoundAtMs,
      snapshots,
      frameCount: page.frames().length,
      frames,
      snippet,
    });
  } catch (e) {
    return NextResponse.json({ error: "render failed: " + String(e).slice(0, 200) });
  } finally {
    await browser.close();
  }
}
