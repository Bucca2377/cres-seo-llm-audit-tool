import { NextRequest, NextResponse } from "next/server";

/**
 * Shared-password gate for the hosted app (HTTP Basic Auth).
 *
 * The password is read at RUNTIME from the SITE_PASSWORD env var. Bracket
 * notation (process.env["SITE_PASSWORD"]) is deliberate: it stops Next from
 * inlining the value at build time, so the password set in Railway is read
 * live. If SITE_PASSWORD is unset (e.g. local dev), the app is left open.
 *
 * The browser prompts for a username + password; any username is accepted and
 * only the password is checked, so the team just needs to remember one secret.
 */
export const config = {
  // Apply to everything except Next's static assets and the logo.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|cres-logo.svg).*)"],
};

export function middleware(req: NextRequest) {
  const expected = process.env["SITE_PASSWORD"];
  if (!expected) return NextResponse.next(); // no gate configured

  const header = req.headers.get("authorization") || "";
  if (header.startsWith("Basic ")) {
    let decoded = "";
    try {
      decoded = atob(header.slice(6));
    } catch {
      decoded = "";
    }
    const sep = decoded.indexOf(":");
    const supplied = sep >= 0 ? decoded.slice(sep + 1) : decoded;
    if (supplied === expected) return NextResponse.next();
  }

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="CRES Marketing Hub", charset="UTF-8"' },
  });
}
