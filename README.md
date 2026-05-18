# CRES Marketing Intelligence Hub

Standalone SEO and LLM search-ranking audit tool for multifamily properties.
Built on Next.js + Anthropic Claude.

## What it does

Six tabs against a configurable property:

- **LLM Visibility** — Optimization checklist, AI recommendations, live "Test Query" simulator.
- **SEO & Keywords** — Rank Check (live Google web search via Claude) + LLM-mention check.
- **Lead Attribution** — Channel breakdown, LLM query intelligence, tracking setup guide.
- **PPC Campaigns** — Live AI ad copy generator (Google + Meta).
- **ILS Listings** — Platform health scorecard.
- **Content Generator** — 6 content types, all live Claude API.

Property details (name, address, units, price, amenities, location) are configured via the **Property** button in the top bar and persisted to localStorage. All AI prompts use the current property.

## Setup

1. Install dependencies (already done if you cloned this).

   ```powershell
   npm install
   ```

2. Add your Anthropic API key.

   ```powershell
   Copy-Item .env.local.example .env.local
   notepad .env.local
   ```

   Paste your key after `ANTHROPIC_API_KEY=`. Get one at https://console.anthropic.com/.

3. Run the dev server.

   ```powershell
   npm run dev
   ```

   Open http://localhost:3000.

## Architecture notes

- The API key never reaches the browser. All Claude calls go through `app/api/ai/route.ts` which adds the key server-side.
- Default model: `claude-sonnet-4-5`. Override with `ANTHROPIC_MODEL` in `.env.local`.
- Rank Check uses the `web_search_20250305` tool for real Google results.

## File map

```
app/
  api/ai/route.ts       Server-side proxy to Anthropic
  layout.tsx            Root layout (fonts via globals.css)
  page.tsx              Marketing Hub (all 6 tabs)
  property-settings.tsx Property edit panel
  globals.css           Fonts, scrollbar, animations
lib/
  property.ts           Property type, defaults, useProperty hook, callAI helper
.env.local              Your API key (gitignored)
.env.local.example      Template
```

## What's demo data vs. live

| Section | Live (real Claude calls) | Demo data shown |
|---|---|---|
| LLM Visibility checklist | AI Recommendations button | Checklist scores |
| LLM Search Simulator | Yes (Test Query) | — |
| SEO Analyze | Yes (Analyze button) | Keyword rankings table |
| Rank Check | Yes (Google + LLM, web_search enabled) | — |
| PPC Ad Copy | Yes (Generate Ad Copy) | Campaign performance |
| Content Generator | Yes (all 6 types) | — |
| Lead Attribution AI | Yes (AI Analysis button) | 20 demo leads |
| ILS | — | All scorecards |

Anywhere a table or chart is rendered without an AI button next to it, it's demo data and would need a real data source (GSC, Google Ads API, CRM, etc.) to go live.
