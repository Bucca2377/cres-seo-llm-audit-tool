import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

interface AIRequest {
  prompt: string;
  system?: string;
  maxTokens?: number;
  useWebSearch?: boolean;
}

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "ANTHROPIC_API_KEY is not set. Add it to .env.local and restart the dev server.",
      },
      { status: 500 }
    );
  }

  let body: AIRequest;
  try {
    body = (await req.json()) as AIRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.prompt || typeof body.prompt !== "string") {
    return NextResponse.json(
      { error: "Missing or invalid 'prompt' field" },
      { status: 400 }
    );
  }

  const payload: Record<string, unknown> = {
    model: MODEL,
    max_tokens: body.maxTokens ?? 1000,
    messages: [{ role: "user", content: body.prompt }],
  };
  if (body.system) payload.system = body.system;
  if (body.useWebSearch) {
    payload.tools = [{ type: "web_search_20250305", name: "web_search" }];
  }

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(payload),
  });

  const data = await r.json();
  if (!r.ok) {
    return NextResponse.json(
      {
        error:
          data?.error?.message || `Anthropic API error (status ${r.status})`,
      },
      { status: r.status }
    );
  }
  return NextResponse.json(data);
}
