import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Playwright + its chromium are native/large; keep them out of the bundle
  // and require them at runtime in the /api/fetch route handler.
  serverExternalPackages: ["playwright", "playwright-core", "@sparticuz/chromium"],
};

export default nextConfig;
