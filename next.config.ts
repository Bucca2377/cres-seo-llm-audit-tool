import type { NextConfig } from "next";
import { execSync } from "child_process";

// Stamp the deployed commit so the running build is identifiable in the UI —
// Railway injects RAILWAY_GIT_COMMIT_SHA at build time; fall back to local git.
function commitSha(): string {
  if (process.env.RAILWAY_GIT_COMMIT_SHA) return process.env.RAILWAY_GIT_COMMIT_SHA;
  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

const nextConfig: NextConfig = {
  // Playwright + its chromium are native/large; keep them out of the bundle
  // and require them at runtime in the /api/fetch route handler.
  serverExternalPackages: ["playwright", "playwright-core", "@sparticuz/chromium"],
  // Inlined into the client bundle at build time (accessible via process.env).
  env: {
    NEXT_PUBLIC_COMMIT_SHA: commitSha(),
  },
};

export default nextConfig;
