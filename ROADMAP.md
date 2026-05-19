# CRES SEO / LLM Audit Tool — Roadmap
**Updated May 2026**

Standalone roadmap for the SEO / LLM Audit Tool. This tool lives at `C:\Users\BrendanVanDeventer\Projects\cres-marketing-hub` and ships to https://github.com/Bucca2377/cres-seo-llm-audit-tool.

> For how this tool fits into the broader CRES PM Platform, see `CRES_PM_Platform_Roadmap.md` in the OneDrive CRES Property Mgmt Software folder. This document focuses only on the tool itself.

---

## Status Key
```
✅ LIVE       — Working in the tool today
🟡 PARTIAL    — Built but limited or behind a feature flag
🔴 PLANNED    — Designed, not yet built
```

---

## Part 1: What's Live Today (May 2026)

### Property Management
- ✅ Property roster (73 properties imported: 51 CRES-managed + 22 competitor comps from HelloData)
- ✅ Top-bar property switcher with name/address search
- ✅ Property CRUD (add, edit, delete, reset to demo)
- ✅ JSON import / export (single property or array)
- ✅ Import modes: append, merge by name, replace entire roster
- ✅ Conversion scripts:
  - `scripts/convert-xlsx-to-roster.mjs` (Properties Master xlsx → JSON)
  - `scripts/convert-hellodata.mjs` (HelloData survey xlsx files → JSON)
  - `scripts/build-clean-roster.mjs` (merge Master + HelloData with fuzzy name matching)

### LLM Visibility Audit
- ✅ 9-item optimization checklist:
  - Google Business Profile (20 pts)
  - Apartment Schema Markup (15 pts)
  - Review Volume 30+ (12 pts)
  - Review Quality 4.0+ (10 pts)
  - NAP Consistency Across ILS (10 pts)
  - Structured FAQ on Website (10 pts)
  - Amenities Structured Data (8 pts)
  - Perplexity / Web Citations (5 pts)
  - Owner Response to Reviews (7 pts)
  - **Total: 97 points**
- ✅ AI Audit button — automated grading via SerpAPI ground truth + Claude reasoning
- ✅ Per-property checklist editing (click to cycle status)
- ✅ SerpAPI ground-truth for GBP, Reviews, Quality, and Owner Response (deterministic grading on those items)
- ✅ Evidence text per item with audit findings
- ✅ Persistent audit results + timestamps per property
- ✅ Ranked recommendations after each audit

### LLM Search Simulator
- ✅ Before/after AI response comparison for any renter query
- ✅ Real Claude API call (no web search, just reasoning)

### SEO & Rank Check
- ✅ Real-time Google data via SerpAPI (no longer relying on Claude web-search guesses)
- ✅ Inline Map Pack 3-pack detection
- ✅ Expanded Map Pack check (positions 4-20 via `google_maps` engine)
- ✅ Organic top 30 search
- ✅ Knowledge graph match for branded queries
- ✅ Aggregator-aware diagnosis (recognizes Apartments.com / Zillow / Trulia dominance)
- ✅ Single-query Rank Check (manual spot check)

### SEO Audit
- ✅ Auto-generate 6 relevant queries via Claude
- ✅ Parallel rank checks (Map Pack + organic for each)
- ✅ Scorecard: Map Pack hits, Page 1 hits, Avg organic rank (with sample-size warning)
- ✅ Per-query results table with column rename for clarity ("GBP Map Pack", "Website in Organic", "Who's Winning")
- ✅ Strongest / weakest query callouts
- ✅ Ranked recommendations (Immediate / High / Ongoing priority bands)
- ✅ Persistent results + timestamps per property

### Content Generator
- ✅ 6 content types via real Claude API:
  - Full Listing Description
  - Google Ad Copy
  - Meta / Instagram Ad
  - Prospect Email Sequence
  - Social Media Post
  - LLM-Optimized FAQ Page
- ✅ Property context auto-injected
- ✅ Optional focus notes
- ✅ Copy + Clear actions

### PDF Export
- ✅ CRES-branded multi-page report
- ✅ Real CRES logo (navy SVG sourced from cre-strategies.com)
- ✅ Running page header (`CRES | SEO / LLM Audit | {property} | {month/year}`)
- ✅ Running footer (`Confidential – Prepared by CRES | Page N`)
- ✅ Section headers with teal underline
- ✅ Color-coded findings table (Functional / Incomplete / Absent)
- ✅ Recommendations organized into priority bands
- ✅ Auto-synthesized executive narrative

### Infrastructure
- ✅ Server-side API proxies (`/api/ai`, `/api/serp`) — keys never reach the browser
- ✅ Cost calculation per call (in `_meta.cost` on responses)
- ✅ `useSessionSpend` hook (drafted in `lib/property.ts`, not yet wired to UI)
- ✅ Conservative Claude prompt (caps web searches at ~5-7 per LLM Audit)
- ✅ Next.js 16 + TypeScript + Anthropic SDK + SerpAPI

---

## Part 2: Pending Features (the Backlog)

### Audit & Analysis

🔴 **Top 10 Market Queries**
For each property, fetch 10 highest-volume rental queries in its market and show who's winning each slot (Map Pack #1 + Organic #1). Competitive intel, not the property's own performance.
- Cost: 1 Claude call + 10 SerpAPI calls per property per run
- Concern: 10 × 73 properties = 730 SerpAPI calls — overruns free tier (250/mo)
- Path: gate behind paid SerpAPI plan OR cache results per city (multiple properties in same city share queries)

🔴 **Google Search Console integration**
Replace one-shot SerpAPI snapshots with real GSC data: every query the property is getting impressions for, with avg position, CTR, click counts, 16 months of history.
- Two paths:
  - **CSV import** (lightweight, ~2 hours) — PM exports from GSC, drops into property settings, app parses
  - **OAuth + per-property verification** (proper, ~1-2 days) — coordination problem with property owners for non-CRES-managed sites
- Recommend: CSV first, OAuth later

🔴 **Expanded Map Pack depth control**
Currently checks top 20 in expanded view; offer paginated checks to 40, 60, 100.
- Diminishing returns past 20 (no clicks at those positions)
- Useful as diagnostic only

🔴 **Year-built data source**
Currently `0` for all imported properties.
- Options: ATTOM Property API, county assessor scraping, manual entry per property
- Lowest effort: add to property edit form, fill in as PMs audit

### Reporting & Export

🔴 **Bulk PDF export**
Currently one property at a time. Add "Export all 73 properties as PDF" → zip of branded reports.

🔴 **Per-property cost meter in the PDF**
Stamp "Audit cost: $0.21" on the report so cost transparency follows the artifact.

🔴 **Comparative report**
Multi-property side-by-side audit summary for portfolio reviews. E.g., 3-5 properties, columns side by side.

### Data Quality

🔴 **Fuzzy roster dedup**
Improve matching during HelloData import so "Reserve at Sawmill" / "Reserve at Saw Mill" don't create two entries.
- Already partially handled in `nameMatches`
- Extend to import-time merge logic in `build-clean-roster.mjs`

🔴 **Manual GBP URL field per property**
Paste the property's Google Maps URL into property settings to lock in identity, avoiding name-matching ambiguity.
- Eliminates "wrong GBP detected" issues
- Adds a direct-link button on the audit results

🔴 **Property website URL field**
Capture the actual website domain (e.g., `vangardlofts.com`) so audits check schema, FAQ, and pages on the right site directly rather than guessing from search snippets.

🔴 **Address normalization on import**
Some HelloData property addresses imported with city mismatches (e.g., Edge 26 is at "Edgewater, CO" per Google but our roster says "Wheat Ridge"). Add a verification step against the GBP address.

### Cost & Ops

🟡 **Built-in spend meter UI**
The `useSessionSpend` hook is drafted in `lib/property.ts` and emits events from `callAI` and `callSerp`. Just needs the top-bar display:
- "Session: $0.34 · 28 SerpAPI · 6 Claude"
- Reset button
- Persists to sessionStorage across refresh
- Tooltip with cost breakdown

🔴 **Hard spending guardrail**
Fail audit calls fast when a user-set daily/monthly cap is exceeded. Prevents runaway-prompt cost surprises.

🔴 **Web search trimming round 2**
Consider whether items 2 (Schema), 6 (FAQ), 9 (Citations) should drop web search entirely and fall back to "Partial — manual verification recommended" defaults. Further $0.05-0.10 cost reduction per LLM Audit.

🔴 **Switch from `claude-sonnet-4-5` to a cheaper model for SEO Audit recommendations call**
The recommendations synthesis call doesn't need web search and is mostly text generation. `claude-haiku-4` or `claude-sonnet-4-5` with smaller max_tokens would do.

### UX

🔴 **Onboarding tour**
First-run experience that walks a new PM through: import properties, run first audit, interpret results.

🔴 **Audit history per property**
Currently shows the last audit. Persist a history of audits with timestamps to show change over time.

🔴 **Differential PDF**
"What changed since last audit?" — useful when re-auditing the same property quarterly.

---

## Part 3: Architecture

### Stack
```
Next.js 16+ (App Router)         Front + back end + API routes
React + TypeScript               UI
Anthropic SDK                    Claude API for AI features
SerpAPI                          Real Google SERP data
Recharts                         (removed from current build — was used in old prototypes)
Inline styles                    No CSS framework; brand tokens in JS constants
Browser localStorage             Persistence layer (will move to Supabase if integrated into PM Platform)
Vercel                           Hosting (planned, currently localhost only)
```

### Key Files
```
app/page.tsx                     Main hub (LLM Visibility / SEO / Content tabs)
app/property-settings.tsx        Property edit panel
app/api/ai/route.ts              Anthropic proxy with cost calculation
app/api/serp/route.ts            SerpAPI proxy (Google + Google Maps + Reviews)
lib/property.ts                  Property type, roster hook, callAI / callSerp helpers, useSessionSpend
public/cres-logo.svg             Brand asset (navy variant)
scripts/                         xlsx → JSON conversion + roster build utilities
```

### AI Cost Model (May 2026, after prompt cost reductions)
| Operation | Cost per run |
|---|---|
| LLM Visibility Audit | ~$0.15-$0.25 (5-7 web searches + tokens + 1 SerpAPI) |
| SEO Audit (6 queries) | ~$0.07-$0.14 (mostly SerpAPI, free under 250/mo) |
| Content generation (one type) | ~$0.02-$0.05 |
| Single Rank Check | ~$0.01-$0.02 |
| **Full property audit (LLM + SEO + 1 content piece)** | **~$0.25-$0.45** |

---

## Part 4: Path to Platform Integration

This tool's eventual home is the CRES PM Platform's **Marketing Intelligence module**. See `CRES_PM_Platform_Roadmap.md` Part 7 for the integration plan.

In short:
- Tool code ports into platform's `/marketing` module largely unchanged
- localStorage replaced by Supabase
- Property roster syncs with platform's Properties module (one source of truth)
- Recommendations flow into platform task queue
- Branded PDF reports become a section in monthly owner reports

Until then: this tool ships standalone, costs ~$0.25-$0.45 per property audit, and runs on `localhost:3000` against a Next.js dev server.

---

## Part 5: Build Priority Order

If picking what to build next on the tool alone:

1. **Spend meter UI wire-up** (~1 hr) — finishes a half-built feature, gives real-time cost visibility
2. **Manual GBP URL field** (~2 hr) — eliminates the biggest source of audit accuracy errors (name-matching failures)
3. **Property website URL field** (~1 hr) — same idea, helps Schema/FAQ checks
4. **GSC CSV import** (~3 hr) — biggest data quality jump available, no API integration needed
5. **Hard spending guardrail** (~2 hr) — prevents future cost surprises
6. **Bulk PDF export** (~4 hr) — useful for portfolio reviews
7. **Top 10 Market Queries** (~1 day) — competitive intel, defer until SerpAPI volume is acceptable
8. **Comparative report** (~1 day) — portfolio meetings
9. **GSC OAuth integration** (~2 days) — turns CSV import into live data flow

Everything else is nice-to-have and can be deferred indefinitely.
