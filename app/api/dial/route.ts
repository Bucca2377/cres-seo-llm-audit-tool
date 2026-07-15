import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Twilio dial-test: places a brief automated test call to each phone/tracking
 * number and reports whether it CONNECTS to a live line (the number works) or
 * FAILS (disconnected / invalid). Confirms the leasing numbers actually dial.
 *
 * Credentials are read at RUNTIME from env (bracket notation stops Next from
 * inlining them). Set in Railway, never in code:
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER (an owned Twilio #)
 *
 * NOTE: a real call briefly rings the destination. Trial Twilio accounts can
 * only call *verified* numbers — a paid (pay-as-you-go) account is required to
 * dial arbitrary property numbers.
 */
interface DialRequest {
  numbers: string[];
}

type DialStatus = "connected" | "failed" | "unknown";

const TWIML =
  "<Response><Say voice=\"alice\">This is an automated line check from C R E S. Thank you, goodbye.</Say><Hangup/></Response>";

/** Map a terminal Twilio call status to our connected/failed verdict. */
function mapStatus(twilioStatus: string): DialStatus {
  // The line is LIVE and reachable if the call rang through in any form.
  if (["completed", "busy", "no-answer"].includes(twilioStatus)) return "connected";
  if (["failed", "canceled"].includes(twilioStatus)) return "failed";
  return "unknown";
}

export async function POST(req: NextRequest) {
  const sid = process.env["TWILIO_ACCOUNT_SID"];
  const token = process.env["TWILIO_AUTH_TOKEN"];
  const from = process.env["TWILIO_FROM_NUMBER"];
  if (!sid || !token || !from) {
    return NextResponse.json(
      {
        error:
          "Twilio isn't configured. Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER in Railway (a paid Twilio account is required to call non-verified numbers).",
      },
      { status: 400 }
    );
  }

  let body: DialRequest;
  try {
    body = (await req.json()) as DialRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const raw = Array.isArray(body.numbers) ? body.numbers : [];
  // Normalize to +1XXXXXXXXXX (US), de-dupe, cap to a sane batch size.
  const numbers = Array.from(
    new Set(
      raw
        .map((n) => (n || "").replace(/\D/g, "").replace(/^1?(\d{10})$/, "$1"))
        .filter((d) => d.length === 10)
        .map((d) => `+1${d}`)
    )
  ).slice(0, 12);
  if (numbers.length === 0) {
    return NextResponse.json({ error: "No valid US phone numbers to test." }, { status: 400 });
  }

  const authHeader = "Basic " + Buffer.from(`${sid}:${token}`).toString("base64");
  const base = `https://api.twilio.com/2010-04-01/Accounts/${sid}`;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const mapAnsweredBy = (ab: string): "human" | "voicemail" | "fax" | "unknown" | null => {
    if (!ab) return null;
    if (ab === "human") return "human";
    if (ab.startsWith("machine")) return "voicemail";
    if (ab === "fax") return "fax";
    return "unknown";
  };

  const testOne = async (
    to: string
  ): Promise<{
    number: string;
    status: DialStatus;
    detail: string;
    answeredBy: "human" | "voicemail" | "fax" | "unknown" | null;
    ringSeconds: number | null;
  }> => {
    try {
      // Place the call with inline TwiML, a short ring timeout, and Answering
      // Machine Detection so we learn whether a live person or voicemail picked up.
      const form = new URLSearchParams({
        To: to,
        From: from,
        Twiml: TWIML,
        Timeout: "20",
        MachineDetection: "Enable",
        MachineDetectionTimeout: "12",
      });
      const placeRes = await fetch(`${base}/Calls.json`, {
        method: "POST",
        headers: { Authorization: authHeader, "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      });
      const placed = await placeRes.json();
      if (!placeRes.ok) {
        // 400 here usually means the number is invalid / unreachable.
        return { number: to, status: "failed", detail: placed?.message || `could not place call (${placeRes.status})`, answeredBy: null, ringSeconds: null };
      }
      const callSid = placed?.sid as string;
      if (!callSid) return { number: to, status: "unknown", detail: "no call id returned", answeredBy: null, ringSeconds: null };

      // Poll to a terminal status. Track ~ring time (place -> answered) and the
      // answered_by classification. Poll ~1.5s for a usable ring-time estimate.
      const t0 = Date.now();
      let status = String(placed?.status || "queued");
      let answeredBy = "";
      let ringSeconds: number | null = null;
      for (let i = 0; i < 24 && !["completed", "busy", "no-answer", "failed", "canceled"].includes(status); i++) {
        await sleep(1500);
        const poll = await fetch(`${base}/Calls/${callSid}.json`, { headers: { Authorization: authHeader } });
        const pj = await poll.json().catch(() => ({} as Record<string, unknown>));
        status = String((pj as { status?: string })?.status || status);
        const ab = String((pj as { answered_by?: string })?.answered_by || "");
        if (ab) answeredBy = ab;
        if (ringSeconds === null && ["in-progress", "completed", "busy"].includes(status)) {
          ringSeconds = Math.max(1, Math.round((Date.now() - t0) / 1000));
        }
      }
      if (ringSeconds === null && status === "no-answer") ringSeconds = Math.round((Date.now() - t0) / 1000);
      return { number: to, status: mapStatus(status), detail: status, answeredBy: mapAnsweredBy(answeredBy), ringSeconds };
    } catch (e) {
      return { number: to, status: "unknown", detail: e instanceof Error ? e.message : "request failed", answeredBy: null, ringSeconds: null };
    }
  };

  const results = await Promise.all(numbers.map(testOne));
  const cost = numbers.length * 0.02; // rough: ~1-2¢/call + $1/mo number
  return NextResponse.json({ results, _meta: { calls: numbers.length, cost, source: "twilio" } });
}
