import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

interface SerpRequest {
  query?: string;
  location?: string;
  engine?: "google" | "google_maps" | "google_maps_reviews" | "google_maps_photos" | "google_autocomplete";
  data_id?: string;
  /** google_maps_reviews: "newestFirst" | "mostRelevant" | "highestRating" | "lowestRating". */
  sort_by?: string;
  /** google_maps_reviews: pagination cursor from serpapi_pagination.next_page_token. */
  next_page_token?: string;
}

/** Engines that identify a place by data_id instead of a text query. */
const DATA_ID_ENGINES = new Set(["google_maps_reviews", "google_maps_photos"]);

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

  // google_maps_reviews / google_maps_photos identify a place by data_id, not q
  if (DATA_ID_ENGINES.has(engine)) {
    if (!body.data_id) {
      return NextResponse.json(
        { error: `Missing 'data_id' field (required for ${engine})` },
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
  if (DATA_ID_ENGINES.has(engine)) {
    baseParams.data_id = body.data_id as string;
    baseParams.hl = "en";
    // sort_by / pagination only apply to reviews, but passing them through is
    // harmless for photos (SerpAPI ignores unknown params for the engine).
    if (body.sort_by) baseParams.sort_by = body.sort_by;
    if (body.next_page_token) baseParams.next_page_token = body.next_page_token;
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
