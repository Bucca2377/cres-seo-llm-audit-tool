# CRES Marketing Intelligence — Team Onboarding

The CRES Marketing Intelligence tool audits a property's **website, Apartments.com listing, and Google Business Profile** for leasing readiness and cross-platform consistency, plus SEO rank tracking and a review audit. It produces client-ready, color-coded findings and a printable report.

- **Live app:** https://cresmarketingtool.up.railway.app (password protected)
- **Access:** ask Brendan (brendan@cre-strategies.com) for the shared site password. One password for the whole team; any username works.

---

## Part 1 — Using the app (leasing & marketing)

### Run an audit
1. Log in with the shared password.
2. Pick a property from the switcher (top left), or add a new one and fill in its details (name, address, website, Apartments.com URL, Google listing).
3. Choose a tab and run it:
   - **Marketing Audit** — website + Apartments.com + Google consistency check, phone/tracking-number dial test, and recommendations.
   - **SEO & Website Optimization** — tracked search phrases, Map Pack vs. organic rank, Core Web Vitals.
   - **Review Audit** — Google rating, review volume/recency trends, response gaps.
4. Each run takes ~60–90 seconds. Re-run any time to refresh.

### Correcting a result (the ✎ pencil)
The Marketing **ILS & Google Consistency Check** is auto-detected. When a cell is wrong or shows an unverified "Check," click the **✎** on that cell to correct it:
- Pick a status (**Good / Check / Issue / N/A**) and write the note.
- Marking a cell **Issue** automatically **adds a matching recommendation**.
- Marking a cell **Good** **removes** the auto-generated recommendation for it.
- Your correction shows an **"edited"** marker, replaces the result **on screen and in the printed report**, and **sticks through future re-runs**.
- If a later run **positively detects the problem as fixed**, your flag auto-clears back to **Good** and shows up under **"Resolved since you flagged them."** If the detector still can't confirm, your flag stays put.

### Deliverables
- Use the **Print** menu (top right) to produce the client report — you can print Marketing, SEO, or all together.
- The report reflects your ✎ corrections.

### Is my work saved? (the sync chip)
Bottom-right of the app shows a small status chip:
- **Synced** — your data is saved to the shared team store; everyone on every device sees it.
- **Saving…** — a change is being pushed.
- **Local only** — the shared database isn't connected (see Part 3); data is on this device only.
- **Sync error** — couldn't reach the store on the last save; changes are cached locally and will retry.

---

## Part 2 — Data & continuity

- **Property data (rosters, audits, your ✎ corrections)** live in a shared **Railway Postgres** database, synced across all devices. Each property saves independently, so two people editing different properties never overwrite each other. Which property you're *viewing* is per-device.
- **Backup:** you can **Export** the full roster from Settings at any time as a JSON backup.
- **The code** lives on GitHub and the **live app + data** live on Railway, both independent of any one laptop. If a machine dies, nothing is lost — a teammate just logs into the live app.

---

## Part 3 — How it's built & deployed (for whoever maintains it)

- **Stack:** Next.js 16 (React 19), deployed on **Railway**. Auto-deploys on every push to the GitHub `main` branch — no manual deploy step.
- **Repo:** https://github.com/Bucca2377/cres-seo-llm-audit-tool
- **Railway:** project **adorable-magic** → app service **valiant-communication** (public URL cresmarketingtool.up.railway.app) + a **Postgres** service.
- **Confirm which build is live:** the `build <sha>` stamp is bottom-right of the app. Match it to the latest commit on `main` before judging whether a change shipped.

### Secrets (all in Railway env vars — never in code or Git)
`SERPAPI_KEY` (market data; ~1,000 searches/mo — top up at serpapi.com/plan if the Google columns go blank), `ANTHROPIC_API_KEY`, `SITE_PASSWORD` (the login), `BRIGHTDATA_API_TOKEN` + `BRIGHTDATA_ZONE`, `PAGESPEED_API_KEY`, Twilio vars (phone dial test), and `DATABASE_URL` (the shared Postgres, set as `${{Postgres.DATABASE_URL}}`).

### Standing up the shared database (one time, in Railway)
1. In the project canvas, **right-click the empty canvas → Database → Add PostgreSQL** (a new Postgres service appears).
2. On the **valiant-communication** service → **Variables** → add `DATABASE_URL` with value `${{Postgres.DATABASE_URL}}` (use the reference picker; don't paste a raw URL).
3. Railway redeploys automatically. When it's Active, the app's sync chip flips to **Synced**.
4. The **first device** opened after the DB goes live **seeds** the shared store from its local copy — so open it first on the machine that holds the canonical roster.

### Working on the code
```bash
git clone https://github.com/Bucca2377/cres-seo-llm-audit-tool.git
cd cres-marketing-hub
npm install
npm test        # regression tests — run before AND after any change
npm run dev     # local dev at http://localhost:3000
```
For local runs, recreate `.env.local` from the Railway env values (at minimum `ANTHROPIC_API_KEY` and `SERPAPI_KEY`). With no `DATABASE_URL` locally, the app runs in "Local only" mode — that's expected.

### Conventions
- **Never** hardcode or commit secrets — Railway env only.
- Detection logic is **deterministic** and lives in tested `lib/` modules (`detectors`, `hours`, `website-features`, `coverage`, `seo-queries`, `overrides`). Run `npm test` before and after editing them.
- `next build` is strict (fails on unused vars/imports). Run `npm run build` before pushing.

---

**Questions:** Brendan Van Deventer — brendan@cre-strategies.com
