# CRES SEO / LLM Audit Tool — Roadmap
**Updated May 2026**

Standalone roadmap for the SEO / LLM Audit Tool. This tool lives at `C:\Users\BrendanVanDeventer\Projects\cres-marketing-hub` and ships to https://github.com/Bucca2377/cres-seo-llm-audit-tool.

> For how this tool fits into the broader CRES PM Platform, see `Property_Management_Software_Roadmap.md` (in this repo root, mirrored from the OneDrive CRES Property Mgmt Software folder). This document focuses only on the tool itself.

---

## Status Key
```
✅ LIVE       — Working in the tool today
🟡 PARTIAL    — Built but limited or behind a feature flag
🔴 PLANNED    — Designed, not yet built
```

---

## The North Star — Full-Funnel Lead Attribution

The audit tool is the foundation. The end-state product is the **best-in-class multifamily marketing attribution platform** — the tool that finally answers the question every owner, asset manager, and operator has been asking for 30 years and never gotten a real number for:

> **"Where are our legit leads actually coming from, and where should we be allocating marketing dollars?"**

Nobody in the industry does this well. The reason is structural — the funnel has three layers and every existing tool owns only one:

| Layer | Existing players | What they're blind to |
|---|---|---|
| Lead capture | Apartments.com, Zillow, FLAIR, CallRail | What happened after the lead — tour? application? lease? |
| Tour / CRM | FLAIR, Knock, Funnel CRM, RentCafe CRM | True acquisition cost — source data is anonymized by the ILS |
| Application + Lease | AppFolio, Yardi, RealPage | Where the lead actually came from — they get a tenant, not a source |

CRES is in the rare position to own all three layers natively (Marketing Hub + Resident Lifecycle + Living Ledger by Phase 5 of the PM Platform). That structural advantage is the moat. Building this means CRES can answer questions no one else can.

### What "best in class" requires (six components)

**1. Lead Capture**
- Universal first-party tracking pixel on every CRES-managed property website
- UTM enforcement library — every CRES outbound link auto-tagged before it ships
- **Dynamic Number Insertion (DNI)** via Twilio number pool — phone number on the page swaps based on traffic source (Google Ads gets one, Apartments.com listing another, organic a third). Phone calls become attributable.
- **ILS email forwarding parser** — Apartments.com, Zillow, Rent.com, Zumper, HotPads, Apartment List, Trulia, Rentable all forward leads through generic emails. Claude extracts the actual prospect contact + identifies which ILS forwarded.
- **LLM-specific landing pages** — `/from-claude`, `/from-chatgpt`, `/from-perplexity`, `/from-gemini`, `/from-grok`. When an AI model cites a property, the link goes to a tagged landing page → source captured deterministically.
- QR codes per offline campaign (signage, direct mail, print ads, drive-by capture)
- CallRail-style click-to-call tracking for phone events

**2. Source Detection**
- Referrer parsing (Google organic vs Google Ads vs Apartments.com vs direct)
- Click ID capture (gclid, fbclid, msclkid)
- **LLM detection** — referrer in (`chat.openai.com`, `claude.ai`, `perplexity.ai`, `gemini.google.com`, `grok.com`) → tagged as "AI search"
- Branded vs cold query classification
- First-touch + last-touch + linear attribution models all stored

**3. Identity Resolution**
- Fuzzy match on phone + email + name across every touchpoint
- Cookie-based return-visit detection (60-day window)
- Manual merge UI for ambiguous cases
- This is the part competitors get wrong because they don't own the data — we will

**4. Funnel Stages (timestamped rows in Supabase)**
```
Lead (any inbound)
  → Contacted (FLAIR call connected or email reply)
  → Qualified (meets income/credit/timing criteria)
  → Tour scheduled
  → Tour completed
  → Application started
  → Application submitted
  → Approved
  → Lease signed
  → Moved in
```

**5. Reporting (the actual answer)**
- **CPL** (cost per lead) by source
- **CPT** (cost per tour) by source
- **CPA** (cost per application) by source
- **CPLease** (cost per lease) by source — *the only number that actually matters*
- Lead→Tour conversion rate by source (some sources send junk, some send buyers)
- Tour→Application by source + by leasing agent (FLAIR scorecards plug in here)
- Time-from-first-touch-to-lease distribution per source
- Per-property, per-portfolio, per-market views

**6. Recommendation Engine (the AI layer)**
- Claude reads funnel data + property context + market conditions monthly
- Outputs: *"Cut spend at Apartments.com for Vangard Lofts ($850/mo, 12 leads, 0 leases). Reallocate to Google Ads ($1.4 CPL, 38% lead→tour rate) and FLAIR Connect."*
- Per-property monthly allocation recommendation, dollarized
- This is the artifact owners actually want

### What this kills (the questions that go away)

- *"Is Apartments.com worth $850/mo?"* → now an actual number
- *"Should we put more into Google Ads or SEO?"* → CPLease by source tells you
- *"Did that Meta campaign work?"* → linked through to lease signings
- *"The agent says they were busy — were they?"* → calls timestamped, tied to leads, scored by FLAIR
- *"How much leasing comes from drive-bys?"* → QR codes on signage capture it
- *"Are LLM citations actually driving leads?"* → `/from-claude` page traffic and conversions answer it

### Where this lives in the build

This tool, as a standalone product, can ship pieces 1, 2, and 5 (lead capture, source detection, reporting) on top of the existing roster + audit infrastructure. Pieces 3 and 4 (identity resolution + funnel stages) require Resident Lifecycle data (applications, tours, leases) — that lives in the PM Platform's Phase 5. So:

- **Standalone tool (this repo)**: lead capture + source attribution + CPL reporting per channel
- **Platform integration (Phase 3 of PM Platform Roadmap)**: full funnel through to lease + recommendation engine

The two converge when this tool ports into the platform's Marketing module. Until then the standalone tool gets us to "where leads come from" — the platform gets us to "where leases come from."

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

### Property Identity & Audit Accuracy *(May 2026)*
- ✅ `website` field per property — used as primary match key for SEO rank checks
- ✅ `gbpUrl` field per property — locks GBP identity via Google Maps URL
- ✅ Tiered matching: GBP id → website domain → fuzzy name (last resort)
- ✅ "✨ Enrich all" button — one-click SerpAPI lookup populates website + gbpUrl for every property in the roster (with progress bar + cancel)
- ✅ Audit-time auto-capture — LLM Audit and SEO Audit silently fill website + gbpUrl on the first audit of a new property
- ✅ Robust address parser — handles single-comma addresses (`1096 N Khione Loop Salisbury, MD 21804`) correctly
- ✅ Diagnostic console logging when no match is found (shows parsed identifiers + top SerpAPI results for 30-second debugging)

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

### Attribution (the North Star buildout)

These items advance the tool toward the full-funnel attribution platform described in the North Star section. Roughly ordered by dependency and ROI.

🔴 **`leads` table + capture API** *(~1 day)*
Supabase (or sqlite-on-disk for standalone) schema: `id, property_id, source, source_detail, referrer, utm_*, gclid, fbclid, phone, email, name, raw_payload, created_at`. Endpoint `POST /api/leads/capture` accepts web form payloads and stores normalized lead rows. Foundation everything else hangs off.

🔴 **Universal tracking pixel** *(~1 day)*
JS snippet drops on every CRES-managed property website. Captures: page URL, referrer, UTM params, click IDs, viewport, session ID. POSTs to `/api/leads/pageview`. First-party cookie for return-visit detection.

🔴 **UTM enforcement library + link builder UI** *(~4 hours)*
Internal tool: paste destination URL + select source/medium/campaign → outputs tagged link. Prevents the "untagged link in the wild" problem that breaks attribution.

🔴 **LLM landing pages** *(~3 hours)*
Build `/from-claude`, `/from-chatgpt`, `/from-perplexity`, `/from-gemini`, `/from-grok` as deterministic source-tagged entry points. Each redirects to the property page but logs an `ai_search` lead row with the specific model. Pair with prompting Claude/ChatGPT-output content to link to these URLs.

🔴 **Dynamic Number Insertion (DNI) via Twilio** *(~2-3 days)*
Number pool per property. JS swaps the displayed phone number based on traffic source. Twilio webhook on inbound call → log `phone_call` lead with source = the swapped number's tag. Eliminates the "phone call from unknown source" blind spot.

🔴 **ILS email forwarding parser** *(~1-2 days)*
Per-property aliases: `vangard-leads@cres-leads.com`, etc. PMs configure each ILS account to forward there. Claude reads incoming email, extracts prospect name/phone/email + identifies ILS (Apartments.com, Zillow, etc), stores as lead row. Solves the largest blind spot — ILSs are 40-60% of multifamily lead volume and totally anonymized today.

🔴 **CallRail-style click-to-call tracking** *(~4 hours, complements DNI)*
Phone clicks on website logged before the call even fires; matched to the inbound call when it arrives via DNI.

🔴 **Lead source dashboard (v1 — pre-funnel)** *(~1-2 days)*
Per-property: leads by source over time, with absolute counts and trend. Doesn't yet show conversion to tour/lease (that requires PM Platform integration), but answers "where leads come from" deterministically.

🔴 **Identity resolution v1** *(~2 days)*
Fuzzy match leads on phone + email + first/last name across sources. Manual merge UI for ambiguous cases. Cookie-based return visit detection.

🔴 **CPL reporting (cost ingestion)** *(~1 day)*
Manual + automated cost ingestion (Google Ads API, Meta Ads API, ILS subscription costs entered per property). Combined with leads-by-source → CPL per channel per property.

🔴 **Funnel stages (requires PM Platform integration)** *(deferred to Phase 3 of PM Platform)*
Tour scheduled / completed / application / lease records come from Resident Lifecycle module. Once joined to leads, full CPT / CPA / CPLease becomes available. This is where the tool transitions from "lead attribution" to "marketing attribution platform."

🔴 **Recommendation engine** *(deferred — needs funnel data first)*
Claude reads the full funnel per property and outputs monthly dollar-level reallocation recommendations. The flagship artifact.

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

This tool's eventual home is the CRES PM Platform's **Marketing Intelligence module**. See `Property_Management_Software_Roadmap.md` Part 7 for the integration plan.

In short:
- Tool code ports into platform's `/marketing` module largely unchanged
- localStorage replaced by Supabase
- Property roster syncs with platform's Properties module (one source of truth)
- Recommendations flow into platform task queue
- Branded PDF reports become a section in monthly owner reports

Until then: this tool ships standalone, costs ~$0.25-$0.45 per property audit, and runs on `localhost:3000` against a Next.js dev server.

---

## Part 5: Build Priority Order

If picking what to build next on the tool alone, optimized for **fastest path to the North Star** (full-funnel attribution) while keeping audit accuracy improvements in flight:

**Quick wins first (~3 hr total)**
1. **Spend meter UI wire-up** (~1 hr) — finishes a half-built feature, gives real-time cost visibility
2. **Hard spending guardrail** (~2 hr) — prevents future cost surprises

> ~~Manual GBP URL field~~ and ~~Property website URL field~~ — **shipped May 2026** as part of the property identity + auto-enrichment work. See Part 1 → "Property Identity & Audit Accuracy."

**Attribution foundation (the North Star, ~2 weeks)**
3. **`leads` table + capture API** (~1 day) — the schema everything hangs off
4. **Universal tracking pixel** (~1 day) — first-party data starts flowing
5. **UTM enforcement library + link builder** (~4 hr) — kills the untagged-link problem
6. **LLM landing pages** (~3 hr) — first deterministic source attribution for AI traffic
7. **Lead source dashboard v1** (~1-2 days) — answers "where leads come from" for the first time
8. **ILS email forwarding parser** (~1-2 days) — captures the 40-60% of leads that ILSs currently hide
9. **Dynamic Number Insertion (Twilio)** (~2-3 days) — phone calls become attributable
10. **Identity resolution v1** (~2 days) — same prospect across email/phone/web stitches into one record
11. **CPL reporting (cost ingestion)** (~1 day) — first real cost-per-lead numbers per channel

**Audit + reporting depth (in parallel as bandwidth allows)**
12. **GSC CSV import** (~3 hr) — biggest data quality jump available, no API needed
13. **Bulk PDF export** (~4 hr) — useful for portfolio reviews
14. **Comparative report** (~1 day) — portfolio meetings
15. **GSC OAuth integration** (~2 days) — live keyword data
16. **Top 10 Market Queries** (~1 day) — defer until SerpAPI volume is acceptable

**Deferred to PM Platform integration**
17. **Funnel stages join** — requires tours + applications + leases from Resident Lifecycle module
18. **CPLease + recommendation engine** — needs funnel data, then becomes the flagship artifact

Everything else is nice-to-have and can be deferred indefinitely.
