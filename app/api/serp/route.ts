import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

interface SerpRequest {
  query?: string;
  location?: string;
  engine?: "google" | "google_maps" | "google_maps_reviews";
  data_id?: string;
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

  const engine = body.engine || "google";

  // google_maps_reviews uses data_id instead of q
  if (engine === "google_maps_reviews") {
    if (!body.data_id) {
      return NextResponse.json(
        { error: "Missing 'data_id' field (required for google_maps_reviews)" },
        { status: 400 }
      );
    }
  } else if (!body.query || typeof body.query !== "string") {
    return NextResponse.json(
      { error: "Missing or invalid 'query' field" },
      { status: 400 }
    );
  }

  const baseParams: Record<string, string> = {
    api_key: apiKey,
    engine,
  };
  if (engine === "google_maps_reviews") {
    baseParams.data_id = body.data_id as string;
    baseParams.hl = "en";
  } else {
    baseParams.q = body.query as string;
    baseParams.hl = "en";
    baseParams.gl = "us";
    if (engine === "google") baseParams.num = "30";
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

  // SerpAPI cost: $0 on free tier (250/mo limit). Hobby plan: ~$0.01/search.
  // We report 1 search per call; cost estimate is illustrative.
  return NextResponse.json({
    ...data,
    _meta: { searches: 1, cost: 0.01, source: "serpapi" },
  });
}
