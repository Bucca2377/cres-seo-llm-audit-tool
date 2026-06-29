# Playwright's official image ships Chromium + every system library it needs +
# Node 20, matched to the playwright npm version. That means the headless
# browser the Marketing Audit relies on works reliably on Linux — none of the
# Windows sandbox/antivirus flakiness that plagued local runs.
FROM mcr.microsoft.com/playwright:v1.61.0-jammy

WORKDIR /app

# Install dependencies against the committed lockfile for reproducible builds.
COPY package.json package-lock.json ./
RUN npm ci

# Copy the source and build the Next.js app. Runtime secrets (API keys, the
# site password) are NOT needed at build time — they're injected by Railway at
# runtime — so the build works without them.
COPY . .
RUN npm run build

ENV NODE_ENV=production
# Railway injects PORT at runtime; bind to it on all interfaces.
EXPOSE 3000
CMD ["sh", "-c", "npx next start -H 0.0.0.0 -p ${PORT:-3000}"]
