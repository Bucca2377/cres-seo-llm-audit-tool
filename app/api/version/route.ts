import { NextResponse } from "next/server";

export const runtime = "nodejs";
// Read at request time so it reflects the RUNNING container, not the build. On
// Railway, RAILWAY_GIT_COMMIT_SHA is injected into the runtime environment even
// though it isn't reliably available to `next build` (which is why the
// build-time NEXT_PUBLIC_COMMIT_SHA came out empty / "dev").
export const dynamic = "force-dynamic";

export async function GET() {
  const sha =
    process.env.RAILWAY_GIT_COMMIT_SHA ||
    process.env.NEXT_PUBLIC_COMMIT_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    "";
  return NextResponse.json({ sha });
}
