# CRES Property Management Platform — Roadmap
**Updated May 2026** · Full PM Platform plan including all native modules: PM Core, Living Ledger, Marketing Hub (with the SEO / LLM Audit Tool live today), FLAIR Secret Shopper, and the platform path forward.

> This document supersedes the May 2025 baseline (`CRES_Platform_Roadmap.md`) and the interim Unified Roadmap. For the SEO / LLM Audit Tool's own granular backlog, see `cres-marketing-hub/SEO_LLM_Audit_Tool_Roadmap.md` in the project repo.

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
┌──────────────────────────────────────────────────────────────────────────┐
│                          CRES PM PLATFORM                                 │
├──────────────────────────────────┬───────────────────────────────────────┤
│  PROPERTY OPERATIONS             │  MARKETING & LEAD INTELLIGENCE         │
│                                  │                                        │
│  • Dashboard                     │  • LLM Visibility ✅                   │
│  • Tenants & Leases              │  • SEO & Rank Check ✅                 │
│  • Maintenance / Work Orders     │  • Content Generator ✅                │
│  • Living Ledger (financial core)│  • Lead Attribution                    │
│  • Automation Hub                │  • PPC Campaigns (Google + Meta)       │
│  • Vendors                       │  • ILS Listings                        │
│  • Reporting                     │                                        │
├──────────────────────────────────┼───────────────────────────────────────┤
│  LEASING (FLAIR + Screening)     │  RESIDENT LIFECYCLE                    │
│                                  │                                        │
│  • Live Lead-Response Dialer     │  • Resident Portal (work orders, rent, │
│  • Call Recording + Scoring      │    messaging, documents)               │
│  • Agent Scorecards              │  • Screening & Application             │
│  • Secret Shop Reports           │  • Renewals & Retention                │
│  • Tenant Screening (API)        │  • Collections                         │
│  • Application + Lease Signing   │  • Move-out flow                       │
├──────────────────────────────────┼───────────────────────────────────────┤
│  RESIDENT SERVICES MARKETPLACE   │  OWNER & PORTFOLIO                     │
│                                  │                                        │
│  • Laundry (Rinse, SudShare)     │  • Portfolio Dashboard                 │
│  • Cleaning (Tend, Handy)        │  • Owner Portal (read-only)            │
│  • Dog Walking (Wag, Rover)      │  • Monthly Owner PDF Report            │
│  • Smart Access (Latch)          │  • Benchmarking                        │
│  • Concierge (Hello Alfred)      │                                        │
├──────────────────────────────────┴───────────────────────────────────────┤
│                  AI LAYER (Anthropic Claude)                              │
│   Ambient insight cards · Chat panel · Web search · Invoice extraction    │
│   Content generation · Audit reasoning · Renewal letters · Risk scoring   │
├──────────────────────────────────────────────────────────────────────────┤
│                  DATA LAYER (Supabase)                                    │
│   Postgres · Auth · Realtime · Storage · Row-level security               │
├──────────────────────────────────────────────────────────────────────────┤
│                  INTEGRATION LAYER                                        │
│   Plaid · Resend · Stripe · Twilio · CallRail · GSC · Google + Meta Ads   │
│   SerpAPI · FLAIR API · AppFolio/Yardi · TransUnion SmartMove · DocuSign  │
│   TLG Collections · Service Providers (Rinse, Wag, Tend, Hello Alfred)    │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Part 2: What's Live Today (May 2026)

The first live module of the platform exists as a standalone tool — the **SEO / LLM Audit Tool** at `C:\Users\BrendanVanDeventer\Projects\cres-marketing-hub`. Production-ready, in active use by CRES on 73 properties. Approximately **50% of the planned Marketing Intelligence module** is already shipped.

| Feature | Where | Status |
|---|---|---|
| Property roster (73 properties) | SEO/LLM Tool | ✅ |
| LLM Visibility Audit (9-item checklist) | SEO/LLM Tool | ✅ |
| SEO & Rank Check (real Google data via SerpAPI) | SEO/LLM Tool | ✅ |
| Content Generator (6 types) | SEO/LLM Tool | ✅ |
| Branded PDF Audit Reports | SEO/LLM Tool | ✅ |
| Per-property audit persistence | SEO/LLM Tool | ✅ |
| Property identity (website + GBP URL fields) | SEO/LLM Tool | ✅ |
| Deterministic rank matching (domain + GBP id, name fallback) | SEO/LLM Tool | ✅ |
| One-click batch enrichment for entire roster | SEO/LLM Tool | ✅ |
| Audit-time auto-capture of website + GBP URL | SEO/LLM Tool | ✅ |

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

(Note: Resident Portal moved to Phase 5 — Resident Lifecycle, where it's
treated as a full module rather than a payment-only stub.)
```

### Phase 3 — Marketing Intelligence Hub 🟡 (~50% already shipped)
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
✅ Property identity model (website + gbpUrl) for deterministic
   rank-check matching; eliminates name-collision audit failures
✅ One-click batch enrichment — SerpAPI lookup fills website + GBP URL
   across the entire roster in a single click
✅ Audit-time auto-capture — first audit of a new property silently
   locks in its website + GBP URL for all future audits

PORTING WORK (the platform integration)
🔴 Move audit tool from standalone repo into Marketing module
🔴 Replace localStorage with Supabase
🔴 Inherit auth + multi-property context from platform shell
🔴 Audit recommendations flow into platform task list

NEW FEATURES (not in standalone tool)
🔴 Lead Attribution module — the North Star

   This is the flagship differentiator. CRES platform is uniquely positioned
   to do best-in-class multifamily marketing attribution because it owns all
   three funnel layers natively: Marketing Hub (lead capture) + Resident
   Lifecycle (applications) + Living Ledger (lease). Every existing competitor
   owns only one layer and is blind to the other two.

   Capture layer (some pieces ship from standalone tool):
   · leads table in Supabase
   · /api/leads/capture with referrer detection
   · Universal first-party tracking pixel on property websites
   · UTM enforcement + link builder UI
   · Dynamic Number Insertion (DNI) via Twilio number pool — phone numbers
     swap based on traffic source; calls become attributable
   · CallRail webhook integration (backup / supplement to DNI)
   · ILS email forwarding parser — Apartments.com, Zillow, Rent.com, Zumper,
     HotPads, Apartment List, Trulia, Rentable; Claude extracts prospect +
     ILS source from forwarded emails
   · Dedicated LLM landing pages (/from-claude, /from-chatgpt,
     /from-perplexity, /from-gemini, /from-grok)
   · QR codes per offline campaign (signage, direct mail, print)
   · Cookie-based 60-day return-visit detection

   Identity resolution:
   · Fuzzy match on phone + email + name across sources
   · Manual merge UI for ambiguous cases
   · Cross-touchpoint stitching (web pixel + DNI call + ILS form → one lead)

   Funnel stages (joins with Phase 5 data):
   · Lead → Contacted → Qualified → Tour scheduled → Tour completed →
     Application started → Application submitted → Approved → Lease signed
     → Moved in
   · Each stage timestamped in Supabase; funnel becomes a SQL query

   Reporting:
   · CPL by source (cost per lead)
   · CPT by source (cost per tour)
   · CPA by source (cost per application)
   · CPLease by source — the only number that matters
   · Lead→Tour and Tour→Application conversion rates by source AND by agent
     (FLAIR scorecards plug in here)
   · Time-from-first-touch-to-lease distribution
   · Per-property, per-portfolio, per-market views

   Recommendation engine:
   · Claude reads full funnel + property + market data monthly
   · Outputs dollar-level reallocation recs: "Cut Apartments.com spend
     at Vangard Lofts ($850/mo, 0 leases). Reallocate to Google Ads
     and FLAIR Connect."
   · This is the artifact owners actually want — the answer to the
     question the industry has been asking for 30 years

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

### Phase 5 — Resident Lifecycle 🔴
**3-4 weeks · The full prospect→resident→renewal→move-out flow**

This phase brings the resident-facing modules into the platform. Each
submodule is a build-vs-integrate decision; defaults below.

```
======================================================================
5a. Screening & Application Module
======================================================================
Build: native application form, lease document storage, status tracking
Integrate: identity + credit + criminal + eviction history checks

Application flow
- Public application form (per property, mobile-friendly)
- Required fields: contact, income, employment, rental history,
  emergency contact, vehicle info, pet info
- File uploads: ID, pay stubs, bank statements
- Application fee via Stripe ($50-$75 typical)
- Status pipeline: submitted → screening → approved → lease-out

Screening integrations (pick one as primary; can support multiple)
- TransUnion SmartMove          ($25-$40/applicant) — industry standard
- Experian RentBureau           ($30-$50/applicant) — strong on rental history
- Plaid Income + Identity       ($1-$5/applicant)   — modern, bank-data-backed
- LeasingDesk (RealPage)        ($35-$45/applicant) — bundled if on RealPage
- AppFolio Screening            (free if on AppFolio) — only if AppFolio sync
- AAOA (American Apartment Owners Association)      — lower volume, cheaper
- Snappt or DocVerify           ($5-$10/applicant)  — document fraud detection

Screening rule engine
- Property-specific income multiplier (e.g., 2.5x or 3x monthly rent)
- Credit score floor (e.g., 600+)
- Eviction record gating
- Criminal record gating (configurable per jurisdiction)
- Conditional approval: higher deposit, co-signer required, etc.

Lease execution
- DocuSign or HelloSign integration for e-signatures
- Lease templates per property
- Auto-creates tenant record + ledger entries on countersign

======================================================================
5b. Resident Portal Module
======================================================================
Build: native portal at /portal route, mobile-first PWA
Integrate: Stripe for payments, Twilio for messaging

Authentication
- Magic-link email login (no password)
- Or SMS OTP via Twilio
- Session persists 30 days

Portal Features
- Dashboard
  · Balance due + next payment date
  · Open work orders + status
  · Recent activity (lease docs, notices, messages)
  · Lease info (end date, renewal CTA if within 90 days)

- Rent Payment
  · ACH (free) or card (2.9% + $0.30) via Stripe
  · Auto-pay enrollment
  · Partial payment with payment plan
  · Receipts auto-emailed
  · Webhook → ledger_entry confirmed

- Work Orders
  · Submit new request (issue, category, priority, photos)
  · View status / vendor / ETA
  · Approve / reject completion
  · Rate the work after close
  · Real-time updates via Supabase Realtime

- Messaging (Inbox)
  · Two-way thread with property management
  · Office hours auto-responder
  · AI draft assistant for common questions (Claude — "Where do I park?",
    "How do I refer a friend?", "Is the gym open today?")
  · Push notifications via PWA or SMS fallback

- Documents
  · Lease + addenda
  · Move-in inspection report
  · Notices (rent increase, community announcements)
  · Payment receipts

- Profile
  · Update contact info, emergency contact
  · Pet registration
  · Vehicle registration
  · Renters insurance upload (auto-reminder if expiring)

- Referrals
  · Trackable referral link per resident
  · Reward when referred prospect signs lease (configurable per property)

Tech notes
- Mobile-first (most residents will use phone)
- PWA so it's installable to home screen without app store
- Push notifications via web push API + Twilio SMS fallback

======================================================================
5c. Renewals & Retention Module
======================================================================
Build: native renewal flow + AI letter generation + retention scoring
Integrate: optional renewal-specialist services

Renewal pipeline
- 120 days before lease_end: auto-create renewal record (status: pending)
- 90 days before: Claude drafts renewal offer letter using property
  context + market data + resident history
  · Suggested new rent (configurable: flat, market-rate, formula)
  · Lease term options (12 / 18 / 24 months)
  · Incentives (free month, upgrade credit, etc.)
- PM reviews + approves with one click
- Letter sent via email + posted to resident portal
- Resident accepts / counter-offers / declines in portal
- All actions update tenant status in real time

Retention scoring (AI-driven)
- Per-resident risk score based on:
  · Payment history (on-time %, late count)
  · Work order satisfaction ratings
  · Lease length (longer = lower churn risk)
  · Recent inquiries about move-out / lease break
  · Survey responses
  · FLAIR call data (if they've called the office recently with frustration)
- High-risk residents flagged for proactive outreach
- Low-risk residents get streamlined renewal flow

Exit surveys
- Auto-sent on non-renewal
- Captures reason for leaving (rent, amenities, management, life event)
- Data feeds back into property improvement priorities

======================================================================
5d. Collections Module
======================================================================
Build: automated reminder cadence + payment plans + activity tracking
Integrate: collections agency handoff for severe delinquency

Delinquency pipeline
- Day 1-5 past due: friendly portal banner + auto-email reminder
- Day 6-10: text reminder via Twilio + late fee auto-assessed
- Day 11-20: PM-initiated outreach (call + offer payment plan)
- Day 21-30: pre-notice (warning of legal action)
- Day 31+: file 3-day notice / eviction filing (depends on jurisdiction)
- Day 60+: handoff to collections agency for past residents

Payment plan tool
- PM creates custom plan in portal: amount, due dates, auto-debit ACH
- Resident signs digitally; plan tracked in ledger
- Missed plan payment auto-escalates to next pipeline stage

Collections agency integrations (handoff)
- TLG Collections                 — multifamily-focused
- EZ Collect                      — multifamily-focused
- Resident Resources              — multifamily-focused
- RentDebt Automated Collections  — multifamily-focused
- Cross Country Collections       — general but multifamily-experienced

PM workflow
- Per-property delinquency dashboard
- Per-resident timeline of all attempts
- Bulk actions (send all 3-day notices for property X)
- Court filing prep doc generator (Claude)

======================================================================
5e. Move-Out Flow
======================================================================
Build: native checklist + photo documentation + security deposit calc

Move-out pipeline
- 30-day notice intake (from resident portal or PM-entered)
- Move-out inspection scheduled
- Inspection app for PM (photos, damage notes, repair estimates)
- Security deposit reconciliation
  · Itemized deductions
  · Refund calculation
  · Auto-generated disposition letter (Claude)
  · Compliance check per jurisdiction (deadlines vary by state)
- Stripe refund initiation (or check via Resend → bookkeeper)
- Vacancy turnover work orders auto-created
```

### Phase 6 — Portfolio & Owner Layer 🔴
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

### Phase 7 — Resident Services Marketplace 🔴
**2-3 weeks · In-app booking for life-logistics services**

Residents book services through the resident portal; CRES gets revenue
share or referral fees per booking. Each service is either embedded
(direct API) or referral-link.

```
======================================================================
Service Categories + Recommended Providers
======================================================================

Laundry & Dry Cleaning
- Rinse              (B2C, white-label, app + delivery) — direct API
- SudShare           (Uber-for-laundry) — referral or API
- Press Wash         (pickup/delivery) — local markets
- Recommend: Rinse as primary if market coverage; SudShare as fallback

Home Cleaning
- Tend               (subscription cleaning, multifamily-friendly)
- Handy              (general home services, well-known brand)
- TaskRabbit         (single tasks, more variable quality)
- Cleanly            (laundry + cleaning combined)
- Recommend: Tend for recurring, Handy for one-off

Dog Walking & Pet Care
- Wag                (largest, has API, multifamily partnerships)
- Rover              (largest competitor, marketplace model)
- PetCheck           (multifamily-focused, white-label option)
- Recommend: Wag for API integration, Rover as referral link

Smart Home / Access
- Latch              (smart locks + community access — also amenity infra)
- Igloohome          (smart locks)
- August             (smart locks, consumer-grade)
- Recommend: Latch if installing smart-access portfolio-wide

Concierge & Errands
- Hello Alfred       (white-label concierge for multifamily)
- Amenify            (multifamily-focused engagement + services)
- TaskRabbit         (errands, general)
- Recommend: Hello Alfred or Amenify (both built for multifamily)

Moving & Storage
- Bellhop            (moving, has API)
- Lugg               (on-demand moving, like Uber for moves)
- Clutter            (valet storage)
- MakeSpace          (on-demand storage)
- Recommend: Bellhop for moving, Clutter for storage

Furniture Rental
- Feather            (modern, full-room packages)
- CORT               (national, business-side)
- Fernish            (subscription furniture)

Resident Engagement / Events
- Amenify            (events + services bundle)
- Common Living      (community programming)

Insurance
- Lemonade Renters   (modern, API-friendly, low premium)
- Roost Tenant       (multifamily-specialized)
- ePremium / GetCovered (rental-specialist)

Internet / Utilities
- Citizens Disco     (bulk internet for multifamily)
- Citizen Home       (white-label utility setup)
- Citizen Wifi       (managed wifi for properties)

======================================================================
Marketplace Architecture
======================================================================

Per-resident
- Browse services in portal
- One-tap booking (provider handles fulfillment + payment)
- CRES receives revenue share via referral tracking or API webhook
- All bookings logged to resident timeline

Per-property
- PM enables/disables services per property (some only available in
  certain markets or for properties of certain class)
- Revenue tracking dashboard
- Resident usage analytics (which services drive engagement)

Per-portfolio
- Negotiate bulk rates with key providers (Rinse, Hello Alfred, Tend)
- Track revenue share across all properties
- Service NPS / satisfaction surveys

Integration model
- Tier 1 (direct API, in-app booking): Rinse, Wag, Tend, Hello Alfred,
  Latch, Lemonade
- Tier 2 (referral link, attribution tracking): Rover, TaskRabbit,
  Handy, Bellhop
- Tier 3 (informational only, contact PM): one-off local providers

Revenue model
- Most providers offer 10-30% revenue share to multifamily partners
- Some bundle the rev share into reduced monthly fee for the property
- CRES platform takes platform fee (configurable per property contract)
```

### Phase 8 — Advanced Integrations 🔴
**Ongoing**

```
- AppFolio / Yardi bi-directional sync (CRES platform = intelligence layer
  on top of existing PM software)
- Vendor mobile app (SMS-based, mark job started/complete, submit hours)
- Automated rent escalation notices (separate from Renewals — for mid-lease
  rent adjustments where allowed)
- Insurance + tax document parsing (Claude extracts premium, dates,
  assessed value; flags YoY anomalies)
- Utility RUBS automation (utility@invoices.cres.com → Claude reads
  RUBS ratio → per-tenant billback)
- Multi-language resident portal (Spanish at minimum; Vietnamese, Mandarin,
  Tagalog for major markets)
- Accessibility audit and WCAG 2.1 AA compliance pass on the resident portal
```

---

## Part 4: Tech Stack

```
CORE PLATFORM
Frontend:     Next.js 16+ (App Router) — also PWA shell for resident portal
Database:     Supabase (Postgres + Auth + Realtime + Storage)
ORM:          Prisma
Styling:      Inline styles + brand CSS custom properties
Hosting:      Vercel
PDF:          Browser-native print + custom @page CSS

AI + SEARCH
AI:           Anthropic SDK (claude-sonnet-4-5 default)
Search:       SerpAPI (real-time Google + Maps + Reviews)
Charts:       Recharts

MESSAGING + DELIVERY
Email:        Resend (invoice inbox, owner reports, resident notices)
SMS:          Twilio (resident texts, vendor app, payment reminders)
E-signature:  DocuSign or HelloSign (lease execution)

PAYMENTS
Stripe:       Resident rent payments (ACH + card)
              Application fees
              Refund processing (security deposits)

MARKETING & LEAD INTEL
GSC:          Google Search Console API (live keyword data)
Google Ads:   Google Ads API (live campaign data)
Meta Ads:     Meta Marketing API
CallRail:     Phone lead attribution
FLAIR:        Direct API if available, else PDF parsing pipeline

LEASING & RESIDENT LIFECYCLE
Plaid:        Bank feed (Phase 2) + Income verification (Phase 5 screening)
TransUnion:   SmartMove screening (primary recommendation)
Experian:     RentBureau screening (alternative)
Snappt:       Document fraud detection
Collections:  TLG / EZ Collect / Resident Resources (delinquency handoff)

RESIDENT SERVICES MARKETPLACE
Rinse / SudShare:     Laundry
Tend / Handy:         Cleaning
Wag / Rover:          Pet services
Hello Alfred:         Concierge
Latch:                Smart access
Bellhop / Clutter:    Moving + storage
Lemonade / Roost:     Renters insurance

LEGACY SYSTEM INTEGRATION (Phase 8)
AppFolio / Yardi:     Bi-directional sync for portfolios already on legacy PM software
```

---

## Part 5: Build Priority Order

If building from scratch today, optimized for fastest ROI per build week:

1. **Phase 0 + Phase 1 Properties/Tenants/Vendors** — the operational shell. After this, CRES is on the platform for property data.
2. **Phase 1 Living Ledger** — the financial differentiator. Same-day P&L is the original "why we built this."
3. **Phase 3 Marketing Hub port** — move the SEO/LLM Audit Tool into the platform. ~50% of Phase 3 work already done (including the property identity layer needed for attribution); this is mostly plumbing.
4. **Phase 5b Resident Portal (rent payment + work orders + messaging)** — single highest-leverage resident-facing module. Eliminates daily friction for both residents and PMs. Stripe + Twilio + Supabase Realtime; ~2 weeks once Phase 1 is up.
5. **Phase 4 FLAIR Module (Step 1)** — PDF intake. Solves the "FLAIR data lives in a folder" problem with minimal integration work.
6. **Phase 2 Automation** — invoice inbox + Plaid eliminates the bulk of routine manual entry.
7. **Phase 5a Screening & Application** — closes the prospect→resident loop. TransUnion SmartMove + Stripe + DocuSign. After this, the platform owns the full leasing pipeline.
8. **Phase 5d Collections** — automated reminder cadence + payment plans. High operational savings; doesn't need any new integrations beyond Twilio + Stripe (already in by step 4).
9. **Phase 5c Renewals & Retention** — AI-drafted renewal letters + retention scoring. Differentiator nobody in the legacy PM space is doing well.
10. **Phase 3 Lead Attribution** — solves an industry-wide problem and is uniquely valuable; depends on FLAIR step 1 + Marketing port being complete.
11. **Phase 6 Owner Portal + Monthly Report** — the artifact owners actually want; needs all upstream data flowing.
12. **Phase 4 FLAIR Module (Step 2)** — API integration once Step 1 proves value and FLAIR partnership is formalized.
13. **Phase 7 Resident Services Marketplace (Tier 1: Rinse, Wag, Tend, Hello Alfred, Latch, Lemonade)** — revenue-generating layer. Defer until Phase 5b Resident Portal is in real use; otherwise no surface to sell into.
14. **Phase 5e Move-Out Flow** — completes the resident lifecycle. Lower urgency since most properties handle this manually today without much pain.
15. **Phase 7 Tier 2 + Tier 3 Services** — long-tail marketplace expansion as portfolio appetite warrants.
16. **Phase 8 Advanced Integrations** — AppFolio/Yardi sync, multi-language, accessibility pass. Order by individual ROI per property.

---

## Part 6: File Map

```
PLATFORM DOCS (this folder)
  Property_Management_Software_Roadmap.md  ← THIS document (May 2026)
  CRES_Platform_Roadmap.md                 ← May 2025 baseline (historical)
  CRES_Platform_Build_Brief.md             ← Technical spec (schema, API routes)
  cres-marketing-hub.jsx                   ← Marketing Hub prototype (superseded by live tool)
  cres-pm-v2.jsx                           ← PM Platform v2 prototype (still pending build)
  PROJECT_LOCATION.md                      ← Pointer to live audit tool repo

SEO / LLM AUDIT TOOL (live, separate repo)
  C:\Users\BrendanVanDeventer\Projects\cres-marketing-hub\
    SEO_LLM_Audit_Tool_Roadmap.md          ← Tool-specific backlog
    Property_Management_Software_Roadmap.md ← Mirror of THIS document for in-repo reference
    README.md                              ← Setup + run
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
