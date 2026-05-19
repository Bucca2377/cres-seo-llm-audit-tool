# CRES Property Management Platform — Roadmap
**Updated May 2026** · Full PM Platform plan including all native modules: PM Core, Living Ledger, Marketing Hub (with the SEO / LLM Audit Tool live today), FLAIR Secret Shopper, and the platform path forward.

> This document supersedes the May 2025 baseline (`CRES_Platform_Roadmap.md`) and the interim Unified Roadmap. For the SEO / LLM Audit Tool's own granular backlog, see `cres-marketing-hub/ROADMAP.md` in the project repo.

---

## Status Key

```
✅ LIVE       — Working in production today
🟡 PARTIAL    — Built but limited (e.g., standalone tool not yet in platform shell)
🔴 PLANNED    — Designed, not yet built
```

---

## Part 1: Platform Architecture (Target State)

```
┌─────────────────────────────────────────────────────────────────┐
│                    CRES PM PLATFORM                              │
├──────────────────────────────────┬──────────────────────────────┤
│  PROPERTY MANAGEMENT             │  MARKETING INTELLIGENCE       │
│                                  │                               │
│  • Dashboard                     │  • LLM Visibility ✅          │
│  • Tenants & Leases              │  • SEO & Rank Check ✅        │
│  • Maintenance / Work Orders     │  • Content Generator ✅       │
│  • Living Ledger (financial core)│  • Lead Attribution           │
│  • Automation Hub                │  • PPC Campaigns              │
│  • Vendors                       │  • ILS Listings               │
│  • Reporting                     │                               │
├──────────────────────────────────┼──────────────────────────────┤
│  LEASING INTELLIGENCE (FLAIR)    │  OWNER & PORTFOLIO            │
│                                  │                               │
│  • Live Lead-Response Dialer     │  • Portfolio Dashboard        │
│  • Call Recording + Scoring      │  • Owner Portal (read-only)   │
│  • Agent Scorecards              │  • Monthly Owner PDF Report   │
│  • Secret Shop Reports           │  • Benchmarking               │
│  • Coaching / Action Items       │                               │
├──────────────────────────────────┴──────────────────────────────┤
│                AI LAYER (Anthropic Claude)                       │
│   Ambient insight cards · Chat panel · Web search                │
│   Invoice extraction · Content generation · Audit reasoning      │
├─────────────────────────────────────────────────────────────────┤
│                DATA LAYER (Supabase)                             │
│   Postgres · Auth · Realtime · Storage · Row-level security      │
├─────────────────────────────────────────────────────────────────┤
│                INTEGRATION LAYER                                 │
│   Plaid · Resend · CallRail · GSC · Google Ads · Meta Ads        │
│   SerpAPI · Stripe · AppFolio/Yardi · FLAIR API                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Part 2: What's Live Today (May 2026)

The first live module of the platform exists as a standalone tool — the **SEO / LLM Audit Tool** at `C:\Users\BrendanVanDeventer\Projects\cres-marketing-hub`. Production-ready, in active use by CRES on 73 properties. Approximately 40% of the planned Marketing Intelligence module is already shipped.

| Feature | Where | Status |
|---|---|---|
| Property roster (73 properties) | SEO/LLM Tool | ✅ |
| LLM Visibility Audit (9-item checklist) | SEO/LLM Tool | ✅ |
| SEO & Rank Check (real Google data via SerpAPI) | SEO/LLM Tool | ✅ |
| Content Generator (6 types) | SEO/LLM Tool | ✅ |
| Branded PDF Audit Reports | SEO/LLM Tool | ✅ |
| Per-property audit persistence | SEO/LLM Tool | ✅ |

Everything else in this roadmap is planned (🔴) unless flagged otherwise.

---

## Part 3: Build Phases

### Phase 0 — Foundation 🔴
**3-5 days · Unlocks every other module**

```
- Next.js 16+ App Router scaffold
- Supabase project (Postgres + Auth + Realtime + Storage)
- Prisma schema (Properties, Tenants, WorkOrders, Vendors, LedgerEntries,
  Invoices, ActivityFeed, Users, PropertyUsers, FLAIRShops, FLAIRScorecards,
  Audits — see CRES_Platform_Build_Brief.md)
- Auth flow (email + password + magic link via Supabase Auth)
- Property selector (multi-property from day 1)
- Role-based access (admin / manager / owner / viewer)
- AI proxy layer (server-side /api/ai, /api/serp — REUSE from cres-marketing-hub)
- Component library (KPICard, Badge, DataTable, AIInsightCard, ScoreMeter)
- Brand tokens + Barlow Condensed / Josefin Sans setup
```

### Phase 1 — Property Management Core 🔴
**1-2 weeks · Platform becomes usable for a real property**

```
Properties Module
- Properties CRUD with multi-property selector
- Property settings (amenities, rent range, manager, etc.)

Tenants & Leases Module
- Tenant table with filters (current / delinquent / expiring)
- Status auto-calculation (delinquent if balance>0 and >5d past due;
  expiring if lease_end within 90d)
- Add tenant form
- Lease expiration timeline view
- AI insight card: roster analysis, collection risk flags, renewal priorities

Maintenance / Work Orders Module
- Work order table with status filters
- CRUD with auto-incrementing WO-XXX IDs
- Vendor assignment dropdown
- Status changes trigger activity_feed inserts
- AI insight card: flag unassigned high-priority WOs

Vendors Module
- Directory with rating, YTD spend, active WO count
- Assign-to-WO action
- Add vendor form

Living Ledger (Financial Core)
- Three-tier visual: Confirmed / Invoiced / Expected / Overdue
- Three simultaneous net income figures, real-time via Supabase Realtime
- Revenue entries auto-created monthly from tenants (cron job)
- Expense entries from approved invoices
- Export Draft P&L (PDF via Resend)
- Share with Owner (email)

Activity Feed
- Supabase Realtime subscription
- Triggers from ledger_entries, work_orders, tenants
- Dashboard "Live Activity" sidebar pulls from this

Dashboard
- KPIs (occupancy, confirmed revenue, open WOs, delinquent count, expiring leases)
- 7-month occupancy + revenue charts
- Alerts feed
- AI insight card

AI Chat Panel
- Persistent slide-in (420px, full-height)
- Multi-turn conversation
- System prompt assembled fresh from DB per session

Reporting Module
- Real-time P&L snapshot
- 12-metric property snapshot grid
- AI Executive Summary
- Share with Owner button
```

### Phase 2 — Automation Layer 🔴
**1-2 weeks · Eliminates routine manual data entry**

```
Invoice Inbox
- Resend webhook delivers email to {property-slug}@invoices.cres.com
- Claude extracts vendor, invoice number, line items, total, GL code
- One-click Approve / Reject in Automation Hub
- Approved invoices auto-post to Living Ledger

Manual Paste Invoice Entry
- Already live in cres-marketing-hub prototype; port to platform

Recurring Expense Automation
- expense_templates table (insurance, mgmt fee, landscaping)
- Cron creates monthly ledger entries with status='expected'

Plaid Bank Feed Integration
- Property bank account linked via Plaid Link
- Webhook auto-matches transactions to tenants by amount + date
- Eliminates ~40 manual payment confirmations/month/property

Tenant Portal (standalone /portal route)
- Magic-link auth via email
- Current balance + payment history + submit payment (Stripe ACH or card)
- Payment success webhook → ledger entry created
- Maintenance request form → creates work_order
```

### Phase 3 — Marketing Intelligence Hub 🟡 (~40% already shipped)
**1-2 weeks remaining · Most heavy work already done in the SEO/LLM Audit Tool**

```
✅ Property data drives all AI prompts
✅ LLM Visibility checklist + AI Audit (SerpAPI-grounded)
✅ LLM Search Simulator
✅ AI Recommendations
✅ Content Generator (6 types)
✅ SEO & Rank Check (real Google data, Map Pack + organic)
✅ SEO Audit (auto-generated queries, parallel rank checks, ranked recs)
✅ Branded PDF reports

PORTING WORK (the platform integration)
🔴 Move audit tool from standalone repo into Marketing module
🔴 Replace localStorage with Supabase
🔴 Inherit auth + multi-property context from platform shell
🔴 Audit recommendations flow into platform task list

NEW FEATURES (not in standalone tool)
🔴 Lead Attribution module
   · leads table in Supabase
   · /api/leads/capture with referrer detection
   · CallRail webhook integration
   · ILS email forwarding parser
   · Dedicated LLM landing pages (/from-claude, /from-chatgpt, /from-perplexity)
   · Cookie-based 30-day attribution window

🔴 Google Search Console API integration
   · OAuth flow per property
   · Daily cron pulls query/position/impressions/clicks/CTR
   · Replaces SerpAPI one-shot rank checks with real history (16 months)

🔴 Google Ads API integration
   · OAuth + daily campaign sync (spend/impressions/clicks/conversions)
   · Real CPL by source

🔴 Meta Ads API integration
   · OAuth + daily campaign sync
   · Cross-reference with leads table for CPL

🔴 ILS listing scores (manual + future scraper)
   · Per-platform health scorecards (Apartments.com, Zillow, Rent.com,
     Zumper, HotPads)
   · NAP consistency tracking
   · Canonical Data Sheet generator (Claude)
```

### Phase 4 — Leasing Intelligence (FLAIR Module) 🔴
**1-2 weeks · CRES already uses FLAIR — this brings the data into the platform**

FLAIR (getflair.io) is a multifamily marketing technology platform CRES uses today. Three FLAIR products are relevant:

- **FLAIR Dialer** ($99-$199/mo/property) — automated outbound calling. When a web/ILS lead submits a contact form, FLAIR calls the leasing agent within seconds; when the agent answers, FLAIR auto-connects them to the prospect. Drops response time to under 60 seconds.
- **FLAIR Platform** — marketing tech for asset managers / property operators (lead routing, call recording, performance dashboards).
- **FLAIR Connect** — paid-search campaign management (PPC).
- **FLAIR Secret Shopper Reports** — call analytics produced as a byproduct of the dialer's recordings; CRES currently receives these as PDFs (see `Marketing Materials/Backup Reports - FLAIR - SEO - PPC/` and per-property `Secret Shop/` folders).

Native integration means: surface FLAIR's data — calls placed, response times, agent scores, secret-shop findings — inside the CRES platform rather than hopping out to FLAIR's tool or reading PDFs from property folders.

```
Native FLAIR Module (/flair tab in main nav, per property)

Live Lead Response Dashboard
- Real-time feed of FLAIR-routed calls (lead source → call timestamp →
  agent answered? → prospect connected?)
- Response time metric (target: <60 seconds, FLAIR's claim)
- Today's call summary per property
- Missed-call alerts surface in Activity Feed

Call History & Recordings
- Per-property timeline of all FLAIR-handled lead calls
- Audio playback (streamed from FLAIR's recording infrastructure)
- Transcripts (if FLAIR exposes them)
- Outcome tagging (no answer / talked / tour scheduled / not interested)

Agent Scorecards
- Per-leasing-agent aggregate scores across all calls
- Rubric breakdown (greeting, qualification, price-overcoming, tour ask, follow-up)
- Trend over time (improving or sliding)
- Tie scoring to leasing agent records (users table)

Secret Shop Reports (intake of existing FLAIR PDFs)
- Per-property history of mystery shops
- Score rubric breakdown
- AI layer: Claude reads transcript, suggests specific coaching scripts
- Flags patterns the rubric misses (tone, urgency, follow-up quality)

Insights & Coaching
- Cross-portfolio patterns ("agents who skip price-overcoming convert 22% less")
- Per-agent coaching plan auto-generated from low-score calls
- Low-score / missed-call events trigger tasks in the property manager's queue

Lead Attribution Tie-in
- Cross-reference FLAIR call records with the Marketing module's leads table
- Show full chain: which channel produced the lead → did FLAIR fire →
  did the agent answer → did it convert to tour → did it lease
- Per-channel conversion rate including the call-response variable

Integration Path
- Step 1: Manual PDF intake (~3-4 hours) — PM uploads existing FLAIR secret
  shop / scorecard PDFs into the property folder, Claude parses scores and
  recommendations, stores structured data. Immediate value: "FLAIR data
  lives in folders" problem solved without API work.
- Step 2: FLAIR API integration (~1-2 weeks) — auto-sync new calls, recordings,
  and scorecards. Requires conversation with FLAIR's team; the existing
  warrant + referral agreement in /FLAIR/ folder suggests there's already a
  CRES↔FLAIR business relationship that could include data access.
- Step 3: Bi-directional integration — trigger FLAIR auto-dial flows from
  inside the platform (e.g., "send this hot lead to FLAIR for immediate
  callback"), and FLAIR posts results back. Effectively makes FLAIR a
  module of the CRES platform rather than a separate tool.

Cost considerations
- FLAIR's $99-$199/property/month is paid to FLAIR separately. The platform
  module surfaces what's already being paid for; doesn't replace FLAIR.
- For non-FLAIR properties (if any in the CRES portfolio), the module
  still works at Step 1 (manual PDF upload) — degrades gracefully.
```

### Phase 5 — Portfolio & Owner Layer 🔴
**2-3 weeks · Run the whole firm from one screen**

```
Portfolio Dashboard
- Aggregate KPIs across all properties
- Per-property summary cards with drill-down
- Portfolio-level AI insight (Claude analyzes all properties)

Owner Portal
- owner role gets read-only access to their properties
- Dashboard: occupancy + financials + maintenance summary
- AI Executive Summary auto-generated monthly
- Owner can view Living Ledger directly (the "no-delay" value prop)

Owner Report PDF (Monthly)
- /api/reports/monthly-pdf
- Combines: occupancy, P&L, WO summary, lease pipeline, delinquency,
  marketing performance, FLAIR scores
- Claude generates narrative + CRES-branded layout
- Delivered via Resend attachment

Benchmarking
- Properties compared within portfolio
- AI identifies which property needs attention and why
```

### Phase 6 — Advanced Integrations 🔴
**Ongoing**

```
- AppFolio / Yardi bi-directional sync (CRES platform = intelligence layer
  on top of existing PM software)
- Vendor mobile app (SMS-based, mark job started/complete, submit hours)
- Automated rent escalation (Claude drafts renewal letters 90 days out)
- Insurance + tax document parsing (Claude extracts premium, dates,
  assessed value; flags YoY anomalies)
- Utility RUBS automation (utility@invoices.cres.com → Claude reads
  RUBS ratio → per-tenant billback)
```

---

## Part 4: Tech Stack

```
Frontend:     Next.js 16+ (App Router)
Database:     Supabase (Postgres + Auth + Realtime + Storage)
ORM:          Prisma
Styling:      Inline styles + brand CSS custom properties
AI:           Anthropic SDK (claude-sonnet-4-5 default)
Search:       SerpAPI (real-time Google + Maps + Reviews)
Charts:       Recharts
Hosting:      Vercel
Email:        Resend (invoice inbox, owner reports)
Payments:     Stripe (tenant portal payments)
PDF:          Browser-native print + custom @page CSS
SMS:          Twilio (vendor app, Phase 6)
FLAIR:        Direct API if available, else PDF parsing pipeline
```

---

## Part 5: Build Priority Order

If building from scratch today:

1. **Phase 0 + Phase 1 Properties/Tenants/Vendors** — the operational shell. After this, CRES is on the platform for property data.
2. **Phase 1 Living Ledger** — the financial differentiator. Same-day P&L is the original "why we built this."
3. **Phase 3 Marketing Hub port** — move the SEO/LLM Audit Tool into the platform. ~40% of Phase 3 work already done; this is mostly plumbing.
4. **Phase 4 FLAIR Module (Step 1)** — PDF intake. Solves the "FLAIR data lives in a folder" problem with minimal integration work.
5. **Phase 2 Automation** — invoice inbox + Plaid eliminates the bulk of routine manual entry.
6. **Phase 3 Lead Attribution** — solves an industry-wide problem and is uniquely valuable.
7. **Phase 5 Owner Portal + Monthly Report** — the artifact owners actually want.
8. **Phase 4 FLAIR Module (Step 2)** — API integration once Step 1 proves value.
9. **Phase 6 Advanced Integrations** — order by individual ROI per property.

---

## Part 6: File Map

```
PLATFORM DOCS (this folder)
  CRES_PM_Platform_Roadmap.md            ← THIS document (May 2026)
  CRES_Platform_Roadmap.md               ← May 2025 baseline (historical)
  CRES_Platform_Build_Brief.md           ← Technical spec (schema, API routes)
  cres-marketing-hub.jsx                 ← Marketing Hub prototype (superseded by live tool)
  cres-pm-v2.jsx                         ← PM Platform v2 prototype (still pending build)
  PROJECT_LOCATION.md                    ← Pointer to live audit tool repo

SEO / LLM AUDIT TOOL (live, separate repo)
  C:\Users\BrendanVanDeventer\Projects\cres-marketing-hub\
    ROADMAP.md                           ← Tool-specific backlog
    README.md                            ← Setup + run
    git: github.com/Bucca2377/cres-seo-llm-audit-tool

FLAIR (existing third-party reports)
  /FLAIR/                                ← Warrant + referral agreements
  /Marketing Materials/Backup Reports - FLAIR - SEO - PPC/
  /Property Level - Detailed Trees/*/Secret Shop/  ← per-property shop PDFs
```

---

## Part 7: How the SEO / LLM Audit Tool Fits In

The audit tool is **not** a separate side product. It's the first live module of this platform, built first because:
- It needed to ship fast for active CRES audit work
- It validates the AI + SerpAPI architecture before the bigger platform commits to it
- Its data model (Property type, audit results) maps directly to Supabase schema

When Phase 0 of this platform launches, the tool merges in:
1. `app/page.tsx` and `lib/property.ts` port over as the Marketing module
2. `localStorage` is replaced by Supabase queries
3. Property roster syncs with the platform's Properties module (one source of truth)
4. Audit recommendations flow into the property manager's task queue
5. Audit-derived PDFs become a section in the monthly owner report

Nothing rebuilt. Tool's work becomes Phase 3 work that's done.

---

## Part 8: Cost & Operations Reference

Per-audit costs (after May 2026 prompt cost reductions):

| Operation | Cost |
|---|---|
| LLM Visibility Audit | ~$0.15-$0.25 |
| SEO Audit (6 queries) | ~$0.07-$0.14 |
| Content generation (one type) | ~$0.02-$0.05 |
| Manual Rank Check | ~$0.01-$0.02 |
| **Full property audit (LLM + SEO + 1 content piece)** | **~$0.25-$0.45** |

Platform-level cost guardrails (recommended):
- Anthropic hard monthly cap at $50-$100 (Settings → Limits)
- SerpAPI Hobby plan ($50/mo for 5000 searches) for portfolio-scale work
- Per-organization spend dashboard (planned for Phase 1)
