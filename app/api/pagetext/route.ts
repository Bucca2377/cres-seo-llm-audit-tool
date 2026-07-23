import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Fetch ONE page and return its readable text. Used to grab a specific page the main
 * crawl missed or got bot-walled on — e.g. the Contact page, where office hours and
 * the leasing phone usually live as static HTML. Tries a plain server fetch first
 * (works on most marketing sites), then falls back to Bright Data (residential IP,
 * defeats Cloudflare) so a 403 to our datacenter IP doesn't lose the page.
 */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function htmlToText(html: string): string {
  return (html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 12000);
}

async function brightData(url: string): Promise<string | null> {
  const token = process.env.BRIGHTDATA_API_TOKEN;
  const zone = process.env.BRIGHTDATA_ZONE;
  if (!token || !zone) return null;
  try {
    const r = await fetch("https://api.brightdata.com/request", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ zone, url, format: "raw" }),
      signal: AbortSignal.timeout(45000),
    });
    if (!r.ok) return null;
    const html = await r.text();
    return html && html.length > 200 ? html : null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  let url = "";
  try {
    url = ((await req.json()) as { url?: string })?.url || "";
  } catch {
    return NextResponse.json({ text: "" });
  }
  if (!url) return NextResponse.json({ text: "" });
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;

  // Plain fetch first.
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*" },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });
    if (r.ok) {
      const text = htmlToText(await r.text());
      if (text.length > 200) return NextResponse.json({ text });
    }
  } catch {
    /* fall through to Bright Data */
  }
  const html = await brightData(url);
  return NextResponse.json({ text: html ? htmlToText(html) : "" });
}
