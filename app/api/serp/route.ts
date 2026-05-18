import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

interface SerpRequest {
  query: string;
  location?: string;
  engine?: "google" | "google_maps";
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "SERPAPI_KEY is not set. Get a free key at https://serpapi.com/ and add it to .env.local, then restart the dev server.",
      },
      { status: 500 }
    );
  }

  let body: SerpRequest;
  try {
    body = (await req.json()) as SerpRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.query || typeof body.query !== "string") {
    return NextResponse.json(
      { error: "Missing or invalid 'query' field" },
      { status: 400 }
    );
  }

  const engine = body.engine || "google";
  const baseParams: Record<string, string> = {
    api_key: apiKey,
    engine,
    q: body.query,
    hl: "en",
    gl: "us",
  };
  // google supports `num`; google_maps uses pagination via `start`
  if (engine === "google") {
    baseParams.num = "30";
  }

  // First try with location (better Map Pack accuracy). If SerpAPI rejects the
  // location string (not in their location DB), retry without it.
  const withLocation = new URLSearchParams(baseParams);
  if (body.location) withLocation.set("location", body.location);
  let r = await fetch(`https://serpapi.com/search.json?${withLocation.toString()}`);
  let data = await r.json();

  if (
    body.location &&
    (data?.error?.toLowerCase?.().includes("location") ||
      data?.error?.toLowerCase?.().includes("unsupported"))
  ) {
    // Fallback: same query, no location parameter
    const withoutLocation = new URLSearchParams(baseParams);
    r = await fetch(`https://serpapi.com/search.json?${withoutLocation.toString()}`);
    data = await r.json();
  }

  if (!r.ok || data?.error) {
    return NextResponse.json(
      { error: data?.error || `SerpAPI error (status ${r.status})` },
      { status: r.status || 500 }
    );
  }
  return NextResponse.json(data);
}
