import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { dialStore } from "@/lib/dial-store";

export const runtime = "nodejs";

/**
 * Twilio callbacks for the dial test (speech transcript + async answering-machine
 * result). PUBLIC (exempt from the site password in middleware.ts) because Twilio
 * can't send Basic auth, so it is locked down two ways: the per-call random token
 * in ?k= must belong to a call /api/dial just placed, and the X-Twilio-Signature
 * must verify with TWILIO_AUTH_TOKEN against the exact URL we gave Twilio.
 */
const GOODBYE =
  '<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">This is an automated line check from C R E S. Thank you, goodbye.</Say><Hangup/></Response>';

function validSignature(url: string, params: Record<string, string>, signature: string, token: string): boolean {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const expected = crypto.createHmac("sha1", token).update(Buffer.from(data, "utf-8")).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature || "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const token = process.env["TWILIO_AUTH_TOKEN"];
  const k = req.nextUrl.searchParams.get("k") || "";
  const t = req.nextUrl.searchParams.get("t") || "";
  const entry = k ? dialStore.get(k) : undefined;
  if (!token || !entry || (t !== "gather" && t !== "amd")) return new NextResponse("Not found", { status: 404 });

  const form = await req.formData().catch(() => null);
  const params: Record<string, string> = {};
  form?.forEach((v, key) => {
    if (typeof v === "string") params[key] = v;
  });
  const url = `${entry.url}&t=${t}`;
  if (!validSignature(url, params, req.headers.get("x-twilio-signature") || "", token)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  if (t === "amd") {
    if (params.AnsweredBy) entry.answeredBy = params.AnsweredBy;
    return new NextResponse(null, { status: 204 });
  }
  entry.speech = (params.SpeechResult || "").slice(0, 400);
  entry.gatherDone = true;
  return new NextResponse(GOODBYE, { headers: { "Content-Type": "text/xml" } });
}
