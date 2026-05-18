"use client";

import { useEffect, useState } from "react";
import {
  useRoster,
  buildSystemPrompt,
  buildPropContext,
  callAI,
  callSerp,
  type Property,
  type ChecklistStatus,
} from "@/lib/property";
import PropertySettings from "./property-settings";

/* -- BRAND ---------------------------------------------------------- */
const B = {
  oxford: "#062347",
  caribbean: "#006a6a",
  cambridge: "#93b2ab",
  tangelo: "#f25620",
  antique: "#fff2dd",
  s1: "#dd917c",
  s2: "#e5bdb3",
};

/* -- DEMO DATA ------------------------------------------------------ */
const LLM_ITEMS: { id: number; label: string; pts: number; description: string }[] = [
  { id: 1, label: "Google Business Profile", pts: 20, description: "Verified listing with photos, hours, and a full description" },
  { id: 2, label: "Apartment Schema Markup", pts: 15, description: "JSON-LD RentalApartment structured data on the property website" },
  { id: 3, label: "Review Volume (50+ target)", pts: 12, description: "50+ reviews across Google, Apartments.com, and Yelp" },
  { id: 4, label: "Review Quality (4.0+ avg)", pts: 10, description: "Average rating of 4.0 stars or higher" },
  { id: 5, label: "NAP Consistency Across ILS", pts: 10, description: "Name / Address / Phone exact-match across every listing platform" },
  { id: 6, label: "Structured FAQ on Website", pts: 10, description: "Q&A page with schema markup, ideal for AI citation" },
  { id: 7, label: "Bing Places Claimed", pts: 8, description: "Microsoft Bing Places listing claimed and verified" },
  { id: 8, label: "Amenities Structured Data", pts: 8, description: "All amenities tagged with standard taxonomy across platforms" },
  { id: 9, label: "Perplexity / Web Citations", pts: 5, description: "Cited in third-party rental guides or local content lists" },
  { id: 10, label: "Owner Response to Reviews", pts: 7, description: "Management responds to all reviews, recent and old" },
];

function statusOf(p: Property, itemId: number): ChecklistStatus {
  return p.checklistStatuses?.[String(itemId)] ?? "missing";
}

function earnedPoints(pts: number, status: ChecklistStatus): number {
  if (status === "complete") return pts;
  if (status === "partial") return Math.floor(pts / 2);
  return 0;
}

function nextStatus(s: ChecklistStatus): ChecklistStatus {
  if (s === "missing") return "partial";
  if (s === "partial") return "complete";
  return "missing";
}

const CONTENT_TYPES = [
  { id: "listing", label: "Full Listing Description", hint: "For Apartments.com, website" },
  { id: "google_ad", label: "Google Ad Copy", hint: "Headlines + descriptions" },
  { id: "meta_ad", label: "Meta / Instagram Ad", hint: "Hook, body, CTA" },
  { id: "email", label: "Prospect Email Sequence", hint: "3-touch drip campaign" },
  { id: "social", label: "Social Media Post", hint: "Instagram / LinkedIn" },
  { id: "llm_page", label: "LLM-Optimized FAQ Page", hint: "Structured for AI citation" },
];

const SUGGESTED_QUERIES_DEFAULT = [
  "luxury apartments near brickell miami",
  "pet friendly apartments miami under $3000",
  "2 bedroom apartments miami with rooftop pool",
  "best apartments miami walkable to metro",
];

/* -- PRIMITIVES ----------------------------------------------------- */
function KPI({ label, value, sub, accent, live, trend }: { label: string; value: React.ReactNode; sub?: string; accent?: string; live?: boolean; trend?: number }) {
  return (
    <div style={{ background: "white", borderRadius: 10, padding: "18px 22px", borderLeft: `4px solid ${accent || B.caribbean}`, boxShadow: "0 1px 6px rgba(0,0,0,0.07)", flex: 1, minWidth: 140, position: "relative" }}>
      {live && <span style={{ position: "absolute", top: 10, right: 12, width: 7, height: 7, background: "#22c55e", borderRadius: "50%", display: "inline-block", boxShadow: "0 0 0 2px rgba(34,197,94,0.3)", animation: "lp 2s infinite" }} />}
      <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 11, fontWeight: 300, color: "#999", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 30, fontWeight: 700, color: B.oxford, lineHeight: 1 }}>{value}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
        {sub && <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 11, color: "#aaa" }}>{sub}</div>}
        {typeof trend === "number" && <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 11, color: trend > 0 ? "#22c55e" : B.tangelo, fontWeight: 400 }}>{trend > 0 ? "▲" : "▼"} {Math.abs(trend)}%</div>}
      </div>
    </div>
  );
}

function ScoreMeter({ score, max = 100 }: { score: number; max?: number }) {
  const pct = (score / max) * 100;
  const color = pct >= 75 ? "#22c55e" : pct >= 50 ? "#f59e0b" : B.tangelo;
  const label = pct >= 75 ? "Strong" : pct >= 50 ? "Moderate" : "Needs Work";
  return (
    <div style={{ textAlign: "center" }}>
      <svg width={140} height={80} viewBox="0 0 140 80">
        <path d="M 15 70 A 55 55 0 0 1 125 70" fill="none" stroke="#f0f0f0" strokeWidth={12} strokeLinecap="round" />
        <path d="M 15 70 A 55 55 0 0 1 125 70" fill="none" stroke={color} strokeWidth={12} strokeLinecap="round" strokeDasharray={`${(pct / 100) * 172.8} 172.8`} />
        <text x="70" y="62" textAnchor="middle" fontFamily="'Barlow Condensed',sans-serif" fontWeight="700" fontSize="26" fill={B.oxford}>{score}</text>
        <text x="70" y="76" textAnchor="middle" fontFamily="'Josefin Sans',sans-serif" fontSize="9" fill="#aaa" letterSpacing="1">/ {max}</text>
      </svg>
      <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 14, letterSpacing: "0.08em", color, textTransform: "uppercase", marginTop: -4 }}>{label}</div>
    </div>
  );
}

/* ================= LLM VISIBILITY TAB ============================= */
function LLMTab({
  property,
  onUpdateProperty,
}: {
  property: Property;
  onUpdateProperty: (p: Property) => void;
}) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<any>(null);
  const [testing, setTesting] = useState(false);
  const [aiRec, setAiRec] = useState<string | null>(null);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);

  // Restore persisted audit recommendations when switching property
  useEffect(() => {
    setAiRec(property.llmAuditRecommendations ?? null);
    setAuditError(null);
  }, [property.id, property.llmAuditRecommendations]);

  const earned = LLM_ITEMS.reduce(
    (s, i) => s + earnedPoints(i.pts, statusOf(property, i.id)),
    0
  );
  const total = LLM_ITEMS.reduce((s, i) => s + i.pts, 0);

  const cycleStatus = (itemId: number) => {
    const current = statusOf(property, itemId);
    const next = nextStatus(current);
    onUpdateProperty({
      ...property,
      checklistStatuses: {
        ...(property.checklistStatuses ?? {}),
        [String(itemId)]: next,
      },
    });
  };

  const testQuery = async (q?: string) => {
    const useQ = q || query;
    if (!useQ.trim()) return;
    if (q) setQuery(q);
    setTesting(true);
    setResult(null);
    try {
      const prompt = `A prospective renter just searched: "${useQ}"

Simulate two AI assistant responses to this query:

RESPONSE A — ${property.name} has no LLM optimization (no schema markup, few reviews, inconsistent ILS data, no FAQ page). Respond as an AI that knows general apartment options for the area but has no specific structured data about ${property.name}.

RESPONSE B — ${property.name} has full LLM optimization (complete schema, 80+ reviews averaging 4.4 stars, consistent NAP across all platforms, structured FAQ content, Bing Places claimed, cited in local rental guides). Now ${property.name} is naturally citable.

Return ONLY a JSON object:
{"before": "Response A text (2-3 sentences, natural AI assistant voice)", "after": "Response B text (2-3 sentences, naturally mentions ${property.name} with specific details)", "mentioned_before": false, "mentioned_after": true}`;
      const d = await callAI({ prompt, maxTokens: 800 });
      const raw = d.content[0].text.replace(/```json|```/g, "").trim();
      setResult(JSON.parse(raw));
    } catch {
      setResult({ error: true });
    }
    setTesting(false);
  };

  const runAudit = async () => {
    setLoadingAudit(true);
    setAuditError(null);
    try {
      const city =
        property.address.split(",").slice(-2, -1)[0]?.trim() ||
        property.address.split(",")[1]?.trim() ||
        "";
      const itemsList = LLM_ITEMS.map(
        (i) => `${i.id}. ${i.label} — ${i.description}`
      ).join("\n");

      // SerpAPI pre-flight: get Google Business Profile ground truth
      let gbpGround: GBPGroundTruth | null = null;
      try {
        const serpQuery = `${property.name}${city ? " " + city : ""}`;
        const serpData = await callSerp({
          query: serpQuery,
          location: extractLocation(property.address),
        });
        gbpGround = extractGBP(serpData, property.name);
      } catch {
        /* OK to proceed without ground truth */
      }

      const groundTruthBlock = gbpGround
        ? `GOOGLE BUSINESS PROFILE GROUND TRUTH (verified via SerpAPI — Google's actual data):
- Listing exists as: "${gbpGround.name}"
- Address per Google: ${gbpGround.address}
- Rating: ${gbpGround.rating !== null ? gbpGround.rating + " stars" : "not shown"}
- Google review count: ${gbpGround.reviewCount !== null ? gbpGround.reviewCount + " reviews" : "not shown"}
- Listing status: ${gbpGround.unclaimed ? "**UNCLAIMED** (owner has not verified the GBP)" : "claimed/verified"}
- Hours: ${gbpGround.hasHours ? "listed" : "not listed"}
- Phone: ${gbpGround.phone || "not listed"}
- Website per Google: ${gbpGround.website || "not listed"}

For items 1, 3, and 4 BELOW, use the ground truth above — do not search the web for those items, just grade against the rubric:
- Item 1 (Google Business Profile): COMPLETE if listing is claimed AND has hours AND ≥5 reviews. PARTIAL if listing exists but is unclaimed OR missing hours OR has <5 reviews. (Since the listing exists, MISSING is not valid here.)
- Item 3 (Review Volume): COMPLETE if Google review count ≥50. PARTIAL if 20–49. MISSING if <20. (You may add Apartments.com/Yelp counts if helpful, but Google count is the floor.)
- Item 4 (Review Quality): COMPLETE if rating ≥4.0. PARTIAL if 3.0–3.9. MISSING if <3.0 or no rating.

In your evidence sentences for items 1, 3, 4, cite the actual numbers (e.g., "Listing claimed, 254 reviews at 3.2 stars per Google").
`
        : `(No GBP ground truth from SerpAPI — fall back to web_search for items 1, 3, 4.)`;

      const prompt = `${groundTruthBlock}

Audit ${property.name} at ${property.address} for LLM search visibility. Use web search aggressively — do as many searches as needed to reach a confident verdict on each item.

PROPERTY FACTS:
- Name in our system: ${property.name}
- Address: ${property.address}
- City: ${city}
${property.managerName ? `- Management company: ${property.managerName}` : ""}
${property.amenities.length ? `- Known amenities: ${property.amenities.slice(0, 6).join(", ")}` : ""}

PHASE 1 — PROPERTY IDENTIFICATION (do this first):
The property may be listed online under a slightly different name (e.g., "View Apartments by Trion Living" when our system has "View Apartments"). Search multiple query variations to find its actual web footprint:
- "${property.name}" alone
- "${property.name} ${city}"
- "${property.name} apartments ${city}"
${property.managerName ? `- "${property.name} ${property.managerName}"` : ""}
- The property's likely website domain

Note the property's:
- Official Google Business Profile name (record the EXACT name as it appears on Google)
- Official website URL
- Listed phone number
- Visible review counts and ratings from Google, Apartments.com, Yelp, Apartment Ratings, etc.

PHASE 2 — GRADE EACH CHECKLIST ITEM:

CHECKLIST:
${itemsList}

Grading rubric — when evidence is clearly visible in search results, lean toward "complete". Only mark "missing" when MULTIPLE varied searches turn up nothing. Use "partial" for moderate evidence that doesn't fully meet the bar.

1. Google Business Profile — Detecting GBP via general web search is unreliable; the actual GBP knowledge panel often doesn't appear in search result snippets even when the GBP exists. Calibrate accordingly:
   - COMPLETE: search results explicitly show a Google Business listing with star rating + review count + hours/address (the knowledge panel surfaced in search snippets).
   - COMPLETE also if you find direct google.com/maps/place/ URLs in results pointing to this property.
   - PARTIAL: GBP isn't directly visible in search snippets BUT you found strong indirect evidence the business is established online — any of: a Yelp listing with hours/phone, a working official website (e.g., edge26.trionliving.com), a phone number that responds to searches, an active social presence. Established apartment communities almost always have a GBP — if there's clear evidence the business exists, lean PARTIAL rather than MISSING. Note in the evidence: "GBP likely exists but not directly visible in search results — manual verification recommended."
   - MISSING: only if you find NO web presence for the property at all (no website, no Yelp, no listings anywhere). This should be rare for established apartment communities.
   - Try these search queries specifically: "${property.name} google", "${property.name} google maps", "${property.name} reviews", "${property.name} hours", and the phone number alone if you find one in Phase 1.

2. Apartment Schema Markup — Check the property's official website (visit the homepage if found). COMPLETE only if you can confirm JSON-LD/RentalApartment schema. PARTIAL if the website exists and is well-structured but schema can't be confirmed from snippets. MISSING if no official website found.

3. Review Volume — Sum visible review counts across Google + Apartments.com + Yelp + Apartment Ratings + any other platforms. COMPLETE if total ≥50 across platforms. PARTIAL if 20-49. MISSING if <20 or unable to find any. (A GBP with 312 Google reviews alone clearly qualifies as COMPLETE.)

4. Review Quality — COMPLETE if average rating ≥4.0 on the primary platform (usually Google). PARTIAL if 3.0-3.9. MISSING if <3.0 or no reviews exist.

5. NAP Consistency — Search for the property on Apartments.com, Zillow, Rent.com, Apartment Finder. COMPLETE if name + address + phone appear consistently across at least 3 platforms. PARTIAL if minor formatting differences (St./Street, Ave/Avenue) or missing from 1-2 platforms. MISSING if major inconsistencies or absent from most platforms.

6. Structured FAQ on Website — If you found the website in Phase 1, look for an /faq, /questions, or /resident-faq URL. COMPLETE if a dedicated FAQ page exists. PARTIAL if FAQ-style content exists but not on a dedicated page. MISSING if no FAQ content found OR no website found.

7. Bing Places — Search Bing.com for the property name + city. COMPLETE if a Bing local business listing appears with reviews/hours. PARTIAL if a Bing entry exists but seems unclaimed (no description, no photos). MISSING if no Bing local presence.

8. Amenities Structured Data — Check the property's Apartments.com listing. COMPLETE if the listing has a fully populated amenities section (10+ amenities tagged). PARTIAL if some amenities listed but sparse (<10). MISSING if no Apartments.com listing or no amenities listed.

9. Perplexity / Web Citations — Search for queries like "best apartments ${city}" or "${city} apartment guide" or "${city} luxury apartments". COMPLETE if ${property.name} is cited in 2+ third-party blog posts/guides. PARTIAL if cited once. MISSING if no citations beyond official listings.

10. Owner Response to Reviews — Check Google reviews for the property. COMPLETE if you can see management responses to most recent reviews (look at the top 5-10 reviews on Google). PARTIAL if some responses visible. MISSING if no management responses on visible reviews.

Return ONLY a JSON object, no prose before or after:
{
  "audit": [
    {"id": 1, "status": "complete" | "partial" | "missing", "evidence": "one specific sentence citing what you found, including names/numbers"},
    ... (entries for ALL 10 items, in id order)
  ],
  "recommendations": "1. First action\\n2. Second action\\n3. Third action\\n4. Fourth action\\n5. Fifth action"
}

Evidence sentences must cite SPECIFIC findings (e.g., "Found GBP 'View Apartments by Trion Living' at 10701 N Pecos St with 312 Google reviews at 3.8 stars, hours and photos present" — NOT generic statements like "GBP exists"). Recommendations must be specific to ${property.name}'s actual gaps and reference the audit findings. Order by highest impact first.`;

      const data = await callAI({ prompt, maxTokens: 4000, useWebSearch: true });
      const text = (data.content || [])
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("\n");
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("Audit returned no JSON.");

      const parsed = JSON.parse(match[0]) as {
        audit: { id: number; status: ChecklistStatus; evidence: string }[];
        recommendations: string;
      };
      if (!Array.isArray(parsed.audit)) throw new Error("Audit data malformed.");

      const newStatuses: Record<string, ChecklistStatus> = { ...(property.checklistStatuses ?? {}) };
      const newEvidence: Record<string, string> = { ...(property.checklistEvidence ?? {}) };
      for (const a of parsed.audit) {
        if (a && typeof a.id === "number") {
          newStatuses[String(a.id)] = a.status;
          newEvidence[String(a.id)] = a.evidence || "";
        }
      }
      const now = new Date().toISOString();
      onUpdateProperty({
        ...property,
        checklistStatuses: newStatuses,
        checklistEvidence: newEvidence,
        llmAuditRecommendations: parsed.recommendations || "",
        llmAuditTimestamp: now,
      });
      setAiRec(parsed.recommendations || null);
    } catch (e) {
      setAuditError(e instanceof Error ? e.message : "Audit failed. Please try again.");
    }
    setLoadingAudit(false);
  };

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 20, marginBottom: 22 }}>
        <div style={{ background: "white", borderRadius: 10, padding: "24px 20px", boxShadow: "0 1px 6px rgba(0,0,0,0.07)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 13, letterSpacing: "0.1em", textTransform: "uppercase", color: B.oxford, marginBottom: 16, textAlign: "center" }}>LLM Visibility Score</div>
          <ScoreMeter score={earned} max={total} />
          <div style={{ marginTop: 14, fontFamily: "'Josefin Sans',sans-serif", fontSize: 11, color: "#aaa", textAlign: "center", lineHeight: 1.6 }}>Measures how likely AI assistants are to cite {property.name} in apartment searches</div>
        </div>
        <div style={{ background: "white", borderRadius: 10, overflow: "hidden", boxShadow: "0 1px 6px rgba(0,0,0,0.07)" }}>
          <div style={{ padding: "12px 18px", borderBottom: "1px solid #f0f0f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 13, letterSpacing: "0.1em", textTransform: "uppercase", color: B.oxford }}>Optimization Checklist</span>
            <button
              onClick={runAudit}
              disabled={loadingAudit}
              style={{
                background: B.caribbean,
                border: "none",
                borderRadius: 6,
                padding: "5px 14px",
                color: "white",
                fontFamily: "'Josefin Sans',sans-serif",
                fontSize: 11,
                cursor: loadingAudit ? "wait" : "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
                opacity: loadingAudit ? 0.7 : 1,
              }}
              title="Web-search audit: checks Google Business Profile, reviews, NAP, website FAQ, Bing, citations. Writes statuses + evidence to this property."
            >
              <span>✦</span>
              {loadingAudit ? "Auditing (web search, ~30-60s)..." : "Run AI Audit"}
            </button>
          </div>
          <div style={{ maxHeight: 320, overflowY: "auto" }}>
            {LLM_ITEMS.map((item, i) => {
              const status = statusOf(property, item.id);
              const earned = earnedPoints(item.pts, status);
              return (
                <div
                  key={item.id}
                  onClick={() => cycleStatus(item.id)}
                  title="Click to cycle: missing → partial → complete"
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 12,
                    padding: "10px 18px",
                    borderBottom: i < LLM_ITEMS.length - 1 ? "1px solid #fafafa" : "none",
                    cursor: "pointer",
                    transition: "background 0.1s",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#fafafa")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <div
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: "50%",
                      background: status === "complete" ? "#22c55e" : status === "partial" ? "#f59e0b" : "#f0f0f0",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      marginTop: 1,
                    }}
                  >
                    <span style={{ color: "white", fontSize: 10, fontWeight: 700 }}>
                      {status === "complete" ? "✓" : status === "partial" ? "~" : "✗"}
                    </span>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span
                        style={{
                          fontFamily: "'Josefin Sans',sans-serif",
                          fontSize: 13,
                          color: "#333",
                          fontWeight: status === "missing" ? 300 : 400,
                        }}
                      >
                        {item.label}
                      </span>
                      <span
                        style={{
                          fontFamily: "'Barlow Condensed',sans-serif",
                          fontSize: 13,
                          fontWeight: 700,
                          color: status === "complete" ? "#22c55e" : status === "partial" ? "#f59e0b" : "#ccc",
                        }}
                      >
                        {earned}/{item.pts}
                      </span>
                    </div>
                    <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 11, color: "#bbb", marginTop: 2 }}>
                      {item.description}
                    </div>
                    {property.checklistEvidence?.[String(item.id)] && (
                      <div
                        style={{
                          marginTop: 4,
                          padding: "4px 8px",
                          background: status === "complete" ? "#f0fdf4" : status === "partial" ? "#fef9e6" : "#fdf2f0",
                          borderRadius: 4,
                          fontFamily: "'Josefin Sans',sans-serif",
                          fontSize: 11,
                          color: status === "complete" ? "#15803d" : status === "partial" ? "#9a7200" : B.tangelo,
                          lineHeight: 1.5,
                        }}
                      >
                        <span style={{ fontWeight: 600 }}>Audit: </span>
                        {property.checklistEvidence[String(item.id)]}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div
            style={{
              padding: "8px 18px",
              borderTop: "1px solid #f5f5f5",
              fontFamily: "'Josefin Sans',sans-serif",
              fontSize: 11,
              color: "#aaa",
              background: "#fafafa",
            }}
          >
            Click any row to cycle status manually. Click <strong>Run AI Audit</strong> to populate statuses + evidence automatically via web search.
          </div>
        </div>
      </div>

      {auditError && (
        <div style={{ background: "#fdf2f0", border: `1px solid ${B.tangelo}`, borderRadius: 8, padding: "10px 16px", marginBottom: 16, fontFamily: "'Josefin Sans',sans-serif", fontSize: 13, color: B.tangelo }}>
          Audit error: {auditError}
        </div>
      )}

      {aiRec && (
        <div style={{ background: "linear-gradient(135deg,#eef7f5,#e4f0ec)", border: `1px solid ${B.cambridge}`, borderLeft: `4px solid ${B.caribbean}`, borderRadius: 8, padding: "14px 20px", marginBottom: 22 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: B.caribbean }}>✦</span>
              <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: B.caribbean }}>Recommendations (ranked by impact)</span>
            </div>
            {property.llmAuditTimestamp && (
              <span style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 11, color: "#888" }}>
                Audited {new Date(property.llmAuditTimestamp).toLocaleString()}
              </span>
            )}
          </div>
          <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 13, lineHeight: 1.75, color: "#2a2a2a", whiteSpace: "pre-wrap" }}>{aiRec}</div>
        </div>
      )}

      <div style={{ background: "white", borderRadius: 10, padding: 24, boxShadow: "0 1px 6px rgba(0,0,0,0.07)" }}>
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 16, letterSpacing: "0.08em", textTransform: "uppercase", color: B.oxford }}>Live LLM Search Simulator</div>
          <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 12, color: "#aaa", marginTop: 3 }}>See how {property.name} appears in AI search results today versus after optimization</div>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && testQuery()} placeholder='Try: "best apartments near brickell miami"' style={{ flex: 1, border: "1px solid #e0e0e0", borderRadius: 8, padding: "10px 14px", fontFamily: "'Josefin Sans',sans-serif", fontSize: 13, outline: "none", background: "#fafafa", color: "#333" }} />
          <button onClick={() => testQuery()} disabled={!query.trim() || testing} style={{ background: B.oxford, border: "none", borderRadius: 8, padding: "10px 20px", color: "white", fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 13, letterSpacing: "0.06em", cursor: "pointer", whiteSpace: "nowrap", opacity: !query.trim() || testing ? 0.5 : 1 }}>
            {testing ? "Simulating..." : "Test Query"}
          </button>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
          {SUGGESTED_QUERIES_DEFAULT.map((q) => (
            <button key={q} onClick={() => testQuery(q)} style={{ padding: "4px 12px", borderRadius: 20, border: `1px solid ${B.cambridge}`, background: "transparent", color: B.caribbean, fontFamily: "'Josefin Sans',sans-serif", fontSize: 11, cursor: "pointer" }}>{q}</button>
          ))}
        </div>

        {testing && <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 13, color: B.caribbean, fontStyle: "italic", padding: "12px 0" }}>Simulating LLM responses before and after optimization...</div>}

        {result && !result.error && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={{ borderRadius: 10, overflow: "hidden", border: `2px solid ${B.tangelo}` }}>
              <div style={{ background: B.tangelo, padding: "10px 16px", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ background: "rgba(255,255,255,0.2)", color: "white", width: 20, height: 20, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>✗</span>
                <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 13, letterSpacing: "0.08em", color: "white", textTransform: "uppercase" }}>Today — Not Optimized</span>
              </div>
              <div style={{ padding: 16, background: "#fff9f8" }}>
                <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 13, color: "#555", lineHeight: 1.7, fontStyle: "italic" }}>&ldquo;{result.before}&rdquo;</div>
                <div style={{ marginTop: 12, fontFamily: "'Josefin Sans',sans-serif", fontSize: 11, color: B.tangelo }}>{property.name} not mentioned in this response</div>
              </div>
            </div>
            <div style={{ borderRadius: 10, overflow: "hidden", border: "2px solid #22c55e" }}>
              <div style={{ background: "#22c55e", padding: "10px 16px", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ background: "rgba(255,255,255,0.25)", color: "white", width: 20, height: 20, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>✓</span>
                <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 13, letterSpacing: "0.08em", color: "white", textTransform: "uppercase" }}>After Optimization</span>
              </div>
              <div style={{ padding: 16, background: "#f0fdf4" }}>
                <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 13, color: "#2a2a2a", lineHeight: 1.7, fontStyle: "italic" }}>&ldquo;{result.after}&rdquo;</div>
                <div style={{ marginTop: 12, fontFamily: "'Josefin Sans',sans-serif", fontSize: 11, color: "#15803d" }}>{property.name} cited naturally in AI response</div>
              </div>
            </div>
          </div>
        )}
        {result?.error && <div style={{ padding: 14, background: "#feeee7", borderRadius: 8, fontFamily: "'Josefin Sans',sans-serif", fontSize: 13, color: B.tangelo }}>Simulation failed. Please try again.</div>}
      </div>
    </div>
  );
}

/* ================= RANK CHECK ===================================== */
interface GoogleRankResult {
  map_pack_appeared: boolean;
  map_pack_rank: number | null;
  expanded_map_pack_rank: number | null; // position 4-20 in Maps expanded list
  top_map_pack: string[];
  organic_rank: number | null;
  organic_page: number | null;
  top_organic: { name: string; domain: string }[];
  diagnosis: string;
  raw?: string;
  error?: string;
}

const EMPTY_RANK: GoogleRankResult = {
  map_pack_appeared: false,
  map_pack_rank: null,
  expanded_map_pack_rank: null,
  top_map_pack: [],
  organic_rank: null,
  organic_page: null,
  top_organic: [],
  diagnosis: "",
};

function extractLocation(address: string): string {
  const parts = address.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const city = parts[parts.length - 2];
    const stateZip = parts[parts.length - 1];
    const state = stateZip.split(/\s+/)[0];
    return `${city}, ${state}, United States`;
  }
  return address;
}

function nameMatches(haystack: string, needle: string): boolean {
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  if (h.includes(n)) return true;
  // also try without common suffixes/prefixes
  const stripped = n.replace(/\b(apartments?|the|lofts?)\b/g, "").trim();
  if (stripped.length > 3 && h.includes(stripped)) return true;
  return false;
}

interface GBPGroundTruth {
  source: "knowledge_graph" | "local_results";
  name: string;
  address: string;
  rating: number | null;
  reviewCount: number | null;
  unclaimed: boolean;
  phone: string;
  website: string;
  hasHours: boolean;
}

function extractGBP(data: any, propertyName: string): GBPGroundTruth | null {
  const kg = data?.knowledge_graph;
  if (kg && kg.title && nameMatches(`${kg.title} ${kg.address || ""}`, propertyName)) {
    return {
      source: "knowledge_graph",
      name: kg.title,
      address: kg.address || "",
      rating: typeof kg.rating === "number" ? kg.rating : null,
      reviewCount: typeof kg.review_count === "number" ? kg.review_count : null,
      unclaimed: kg.unclaimed_listing === true,
      phone: kg.phone || "",
      website: kg.website || "",
      hasHours: !!kg.hours,
    };
  }
  const local = Array.isArray(data?.local_results)
    ? data.local_results
    : Array.isArray(data?.local_results?.places)
    ? data.local_results.places
    : [];
  for (let i = 0; i < Math.min(3, local.length); i++) {
    const b = local[i];
    if (nameMatches(`${b.title || b.name || ""} ${b.address || ""}`, propertyName)) {
      return {
        source: "local_results",
        name: b.title || b.name,
        address: b.address || "",
        rating: typeof b.rating === "number" ? b.rating : null,
        reviewCount:
          typeof b.reviews === "number"
            ? b.reviews
            : typeof b.review_count === "number"
            ? b.review_count
            : null,
        unclaimed: b.unclaimed_listing === true,
        phone: b.phone || "",
        website: b.website || "",
        hasHours: !!b.hours,
      };
    }
  }
  return null;
}

const AGGREGATOR_DOMAINS = [
  "apartments.com",
  "zillow.com",
  "rent.com",
  "trulia.com",
  "homes.com",
  "rentcafe.com",
  "apartmentlist.com",
  "zumper.com",
  "hotpads.com",
  "padmapper.com",
  "realtor.com",
];

function diagnose(
  mapPackRank: number | null,
  expandedMapPackRank: number | null,
  organicRank: number | null,
  topMapPack: string[],
  topOrganic: { name: string; domain: string }[]
): string {
  const topAgg = topOrganic
    .slice(0, 5)
    .filter((o) => AGGREGATOR_DOMAINS.some((d) => o.domain?.includes(d)));
  const aggDominated = topAgg.length >= 3;
  const aggList = topAgg.slice(0, 3).map((o) => o.domain).join(", ");

  // In Map Pack 3-pack
  if (mapPackRank && organicRank && organicRank <= 10) {
    return `Strong: Map Pack #${mapPackRank} and Page 1 organic (#${organicRank}).`;
  }
  if (mapPackRank) {
    return `Map Pack #${mapPackRank}${
      organicRank
        ? ` · organic #${organicRank} (Page ${Math.ceil(organicRank / 10)})`
        : aggDominated
        ? ` · organic dominated by aggregators (${aggList})`
        : " · absent from organic top 30"
    } — local pack is carrying this query.`;
  }
  // In expanded Map Pack but not in top 3
  if (expandedMapPackRank) {
    return `Expanded Map Pack #${expandedMapPackRank} (visible in "More places" view, NOT in the prominent 3-pack). Top 3 currently: ${topMapPack.slice(0, 2).join(", ") || "n/a"}. ${
      organicRank && organicRank <= 30
        ? `Organic #${organicRank} (Page ${Math.ceil(organicRank / 10)}).`
        : aggDominated
        ? `Organic aggregator-dominated (${aggList}).`
        : "Property's own URL not in organic top 30."
    } To reach the 3-pack, prioritize Google Business Profile completeness, review velocity, and NAP consistency.`;
  }
  // Not in Map Pack at all but has organic
  if (organicRank && organicRank <= 10) {
    return `Page 1 organic (#${organicRank}) but missing from Map Pack entirely — likely a Google Business Profile or NAP-consistency issue suppressing local visibility.`;
  }
  if (organicRank && organicRank <= 30) {
    return `Page ${Math.ceil(organicRank / 10)} organic, not in Map Pack — needs both content depth and stronger local signals.`;
  }
  // Not in Map Pack and not in organic top 30
  if (topMapPack.length > 0 && aggDominated) {
    return `Not in Map Pack top 20 (3-pack: ${topMapPack[0]}${
      topMapPack[1] ? `, ${topMapPack[1]}` : ""
    }). Organic top 5 dominated by aggregators (${aggList}) — property may appear inside those listings but not as a direct organic result. To rank directly would require dedicated content + backlinks.`;
  }
  if (topMapPack.length > 0) {
    return `Not in Map Pack top 20. 3-pack: ${topMapPack[0]}${topMapPack[1] ? `, ${topMapPack[1]}` : ""}.`;
  }
  if (aggDominated) {
    return `Aggregator-dominated query (${aggList}). Property's own URL doesn't appear in top 30 — direct ranking would require dedicated content + backlinks.`;
  }
  return "Not ranking and no Map Pack rendered — Google deemed this query not local-intent.";
}

async function fetchGoogleRank(property: Property, query: string): Promise<GoogleRankResult> {
  try {
    const location = extractLocation(property.address);
    const data = await callSerp({ query, location, engine: "google" });

    const localResults: any[] = Array.isArray(data?.local_results)
      ? data.local_results
      : Array.isArray(data?.local_results?.places)
      ? data.local_results.places
      : [];
    const organic: any[] = Array.isArray(data?.organic_results) ? data.organic_results : [];
    const kg = data?.knowledge_graph;

    // Map Pack matching: check knowledge_graph first (branded queries), then local_results (3-pack queries)
    const top3 = localResults.slice(0, 3);
    let mapPackRank: number | null = null;
    let topMapPack: string[] = [];

    if (kg?.title && nameMatches(`${kg.title} ${kg.address || ""}`, property.name)) {
      // Knowledge graph match = property is the dominant local result for this query
      mapPackRank = 1;
      topMapPack = [kg.title];
    } else {
      top3.forEach((biz: any, idx: number) => {
        const candidate = `${biz.title || biz.name || ""} ${biz.address || ""}`;
        if (mapPackRank === null && nameMatches(candidate, property.name)) {
          mapPackRank = idx + 1;
        }
      });
      topMapPack = top3.map((b: any) => b.title || b.name).filter(Boolean);
      if (kg?.title && topMapPack.length === 0) topMapPack = [kg.title];
    }

    // Match in organic results
    let organicRank: number | null = null;
    for (const o of organic) {
      const candidate = `${o.title || ""} ${o.link || ""} ${o.snippet || ""}`;
      if (nameMatches(candidate, property.name)) {
        organicRank = typeof o.position === "number" ? o.position : organic.indexOf(o) + 1;
        break;
      }
    }

    const topOrganic = organic.slice(0, 5).map((o: any) => {
      let domain = "";
      try {
        if (o.link) domain = new URL(o.link).hostname.replace(/^www\./, "");
      } catch {
        /* ignore */
      }
      return { name: o.title || "", domain };
    });

    // Stage 2: if NOT in inline Map Pack top 3, fetch expanded Maps view (~20 results)
    let expandedMapPackRank: number | null = null;
    if (mapPackRank === null) {
      try {
        const mapsData = await callSerp({ query, location, engine: "google_maps" });
        const mapsResults: any[] = Array.isArray(mapsData?.local_results)
          ? mapsData.local_results
          : [];
        const top20 = mapsResults.slice(0, 20);
        for (let idx = 0; idx < top20.length; idx++) {
          const biz = top20[idx];
          const candidate = `${biz.title || biz.name || ""} ${biz.address || ""}`;
          if (nameMatches(candidate, property.name)) {
            expandedMapPackRank = idx + 1;
            break;
          }
        }
      } catch {
        /* expanded lookup failed; proceed without */
      }
    }

    return {
      map_pack_appeared: top3.length > 0 || !!kg?.title,
      map_pack_rank: mapPackRank,
      expanded_map_pack_rank: expandedMapPackRank,
      top_map_pack: topMapPack,
      organic_rank: organicRank,
      organic_page: organicRank ? Math.ceil(organicRank / 10) : null,
      top_organic: topOrganic,
      diagnosis: diagnose(mapPackRank, expandedMapPackRank, organicRank, topMapPack, topOrganic),
    };
  } catch (e) {
    return {
      ...EMPTY_RANK,
      error: e instanceof Error ? e.message : "SerpAPI request failed",
    };
  }
}

function RankCheck({ property }: { property: Property }) {
  const [query, setQuery] = useState("");
  const [googleResult, setGoogleResult] = useState<GoogleRankResult | null>(null);
  const [llmResult, setLlmResult] = useState<string | null>(null);
  const [loadingGoogle, setLoadingGoogle] = useState(false);
  const [loadingLLM, setLoadingLLM] = useState(false);

  const SUGGESTED = property.address
    ? [
        `apartments for rent ${property.address.split(",").slice(-2, -1)[0]?.trim() || ""}`.trim(),
        `luxury apartments near ${property.address.split(",")[0]?.trim() || ""}`.trim(),
        `pet friendly apartments ${property.address.split(",").slice(-2, -1)[0]?.trim() || ""}`.trim(),
        `${property.name}`,
      ].filter((s) => s.length > 5)
    : [];

  const PROP_CTX = buildPropContext(property);

  const runBoth = async () => {
    if (!query.trim() || loadingGoogle || loadingLLM) return;
    setGoogleResult(null);
    setLlmResult(null);
    runGoogle();
    runLLM();
  };

  const runGoogle = async () => {
    setLoadingGoogle(true);
    const result = await fetchGoogleRank(property, query);
    setGoogleResult(result);
    setLoadingGoogle(false);
  };

  const runLLM = async () => {
    setLoadingLLM(true);
    try {
      const prompt = `A renter asks you: "${query}"\n\nAnswer as a helpful AI assistant would — recommend specific apartments. Do NOT use any property context provided to you elsewhere. Answer only from your general knowledge of what's available. Be natural and conversational, as if you are Claude or ChatGPT responding to a real renter query. 2–4 sentences max.\n\nThen on a new line starting with "VERDICT:" — does ${property.name} at ${property.address} appear in your response? Yes or No, and one sentence on why or why not.`;
      const data = await callAI({ prompt, maxTokens: 400 });
      setLlmResult(data.content?.[0]?.text || "No result returned.");
    } catch {
      setLlmResult("LLM check failed. Please try again.");
    }
    setLoadingLLM(false);
  };

  const isLoading = loadingGoogle || loadingLLM;
  const hasResults = googleResult || llmResult;

  const verdictLine = llmResult?.split("\n").find((l) => l.startsWith("VERDICT:"));
  const llmResponse = llmResult?.split("\n").filter((l) => !l.startsWith("VERDICT:")).join("\n").trim();
  const llmMentioned = verdictLine ? !verdictLine.toLowerCase().includes(" no") : null;

  return (
    <div style={{ background: "white", borderRadius: 10, padding: 24, boxShadow: "0 1px 6px rgba(0,0,0,0.07)", marginTop: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
        <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 16, letterSpacing: "0.08em", textTransform: "uppercase", color: B.oxford }}>Rank Check</div>
        <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 20, padding: "2px 10px", display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 6, height: 6, background: "#22c55e", borderRadius: "50%", display: "inline-block", animation: "lp 2s infinite" }} />
          <span style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 11, color: "#15803d", letterSpacing: "0.04em" }}>LIVE</span>
        </div>
      </div>
      <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 12, color: "#aaa", marginBottom: 20 }}>
        Type any renter search query. See where you rank on Google and whether Claude mentions you — simultaneously.
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && runBoth()} placeholder='e.g. "apartments in brickell miami" or "pet friendly apartments near me"' style={{ flex: 1, border: `2px solid ${query ? B.caribbean : "#e0e0e0"}`, borderRadius: 8, padding: "11px 16px", fontFamily: "'Josefin Sans',sans-serif", fontSize: 14, outline: "none", background: "#fafafa", color: "#333", transition: "border-color 0.15s" }} />
        <button onClick={runBoth} disabled={!query.trim() || isLoading} style={{ background: B.caribbean, border: "none", borderRadius: 8, padding: "11px 24px", color: "white", fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 15, letterSpacing: "0.06em", cursor: !query.trim() || isLoading ? "not-allowed" : "pointer", opacity: !query.trim() || isLoading ? 0.5 : 1, whiteSpace: "nowrap", transition: "opacity 0.15s" }}>
          {isLoading ? "Checking..." : "Check Rankings"}
        </button>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 24 }}>
        {SUGGESTED.map((s) => (
          <button key={s} onClick={() => setQuery(s)} style={{ padding: "3px 11px", borderRadius: 20, border: `1px solid ${B.cambridge}`, background: "transparent", color: B.caribbean, fontSize: 11, fontFamily: "'Josefin Sans',sans-serif", cursor: "pointer", transition: "background 0.1s" }}>{s}</button>
        ))}
      </div>

      {(hasResults || isLoading) && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div style={{ borderRadius: 10, overflow: "hidden", border: `2px solid ${loadingGoogle ? "#e0e0e0" : googleResult ? "#4285f4" : "#e0e0e0"}`, transition: "border-color 0.3s" }}>
            <div style={{ background: loadingGoogle ? "#f5f5f5" : "#4285f4", padding: "12px 18px", display: "flex", alignItems: "center", gap: 10, transition: "background 0.3s" }}>
              <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 20, color: loadingGoogle ? "#aaa" : "white" }}>G</span>
              <div>
                <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 13, letterSpacing: "0.08em", color: loadingGoogle ? "#888" : "white", textTransform: "uppercase" }}>Google Search</div>
                <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 10, color: loadingGoogle ? "#bbb" : "rgba(255,255,255,0.75)" }}>Real-time web search results</div>
              </div>
              {loadingGoogle && (
                <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                  {[0, 1, 2].map((n) => <div key={n} style={{ width: 5, height: 5, background: B.cambridge, borderRadius: "50%", animation: `bounce 0.9s ${n * 0.18}s infinite` }} />)}
                </div>
              )}
            </div>
            <div style={{ padding: 16, background: "#fafbff", minHeight: 120 }}>
              {loadingGoogle && !googleResult && (
                <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 12, color: "#aaa", fontStyle: "italic" }}>
                  Searching Google for Map Pack + organic results...
                </div>
              )}
              {googleResult?.error && (
                <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 13, color: B.tangelo }}>{googleResult.error}</div>
              )}
              {googleResult && !googleResult.error && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {/* Map Pack badge */}
                  <div
                    style={{
                      padding: "10px 12px",
                      borderRadius: 8,
                      background:
                        googleResult.map_pack_rank && googleResult.map_pack_rank <= 3
                          ? "#dcfce7"
                          : googleResult.map_pack_appeared
                          ? "#fef9e6"
                          : "#feeee7",
                      borderLeft: `4px solid ${
                        googleResult.map_pack_rank && googleResult.map_pack_rank <= 3
                          ? "#22c55e"
                          : googleResult.map_pack_appeared
                          ? "#f59e0b"
                          : B.tangelo
                      }`,
                    }}
                  >
                    <div
                      style={{
                        fontFamily: "'Barlow Condensed',sans-serif",
                        fontWeight: 700,
                        fontSize: 11,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        color: "#666",
                        marginBottom: 3,
                      }}
                    >
                      Map Pack (Target: Top 3)
                    </div>
                    <div
                      style={{
                        fontFamily: "'Barlow Condensed',sans-serif",
                        fontSize: 22,
                        fontWeight: 700,
                        color: B.oxford,
                      }}
                    >
                      {googleResult.map_pack_rank
                        ? `#${googleResult.map_pack_rank} of 3`
                        : googleResult.expanded_map_pack_rank
                        ? `Expanded #${googleResult.expanded_map_pack_rank} (not in 3-pack)`
                        : googleResult.map_pack_appeared
                        ? "Not in top 20"
                        : "Map Pack didn't appear"}
                    </div>
                    {googleResult.top_map_pack && googleResult.top_map_pack.length > 0 && (
                      <div
                        style={{
                          marginTop: 6,
                          fontFamily: "'Josefin Sans',sans-serif",
                          fontSize: 11,
                          color: "#666",
                          lineHeight: 1.5,
                        }}
                      >
                        Showing: {googleResult.top_map_pack.join(" · ")}
                      </div>
                    )}
                  </div>

                  {/* Organic rank badge */}
                  <div
                    style={{
                      padding: "10px 12px",
                      borderRadius: 8,
                      background:
                        googleResult.organic_rank && googleResult.organic_rank <= 10
                          ? "#dcfce7"
                          : googleResult.organic_rank && googleResult.organic_rank <= 30
                          ? "#fef9e6"
                          : "#feeee7",
                      borderLeft: `4px solid ${
                        googleResult.organic_rank && googleResult.organic_rank <= 10
                          ? "#22c55e"
                          : googleResult.organic_rank && googleResult.organic_rank <= 30
                          ? "#f59e0b"
                          : B.tangelo
                      }`,
                    }}
                  >
                    <div
                      style={{
                        fontFamily: "'Barlow Condensed',sans-serif",
                        fontWeight: 700,
                        fontSize: 11,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        color: "#666",
                        marginBottom: 3,
                      }}
                    >
                      Organic Result (Target: Page 1)
                    </div>
                    <div
                      style={{
                        fontFamily: "'Barlow Condensed',sans-serif",
                        fontSize: 22,
                        fontWeight: 700,
                        color: B.oxford,
                      }}
                    >
                      {googleResult.organic_rank
                        ? `#${googleResult.organic_rank} · Page ${googleResult.organic_page ?? Math.ceil(googleResult.organic_rank / 10)}`
                        : "Not in top 100"}
                    </div>
                    {googleResult.top_organic && googleResult.top_organic.length > 0 && (
                      <div
                        style={{
                          marginTop: 6,
                          fontFamily: "'Josefin Sans',sans-serif",
                          fontSize: 11,
                          color: "#666",
                          lineHeight: 1.6,
                        }}
                      >
                        <span style={{ color: "#999" }}>Top results:</span>
                        <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
                          {googleResult.top_organic.slice(0, 5).map((o, i) => (
                            <li key={i} style={{ marginBottom: 2 }}>
                              {o.name}
                              {o.domain && <span style={{ color: "#aaa" }}> · {o.domain}</span>}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  {/* Diagnosis */}
                  {googleResult.diagnosis && (
                    <div
                      style={{
                        padding: "8px 12px",
                        background: "white",
                        border: "1px solid #e0e0e0",
                        borderRadius: 6,
                        fontFamily: "'Josefin Sans',sans-serif",
                        fontSize: 12,
                        color: "#444",
                        lineHeight: 1.6,
                      }}
                    >
                      <span style={{ fontWeight: 600, color: B.oxford }}>Why: </span>
                      {googleResult.diagnosis}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div style={{ borderRadius: 10, overflow: "hidden", border: `2px solid ${loadingLLM ? "#e0e0e0" : llmResult ? (llmMentioned ? "#22c55e" : B.tangelo) : "#e0e0e0"}`, transition: "border-color 0.3s" }}>
            <div style={{ background: loadingLLM ? "#f5f5f5" : llmResult ? (llmMentioned ? "#22c55e" : B.tangelo) : "#f5f5f5", padding: "12px 18px", display: "flex", alignItems: "center", gap: 10, transition: "background 0.3s" }}>
              <span style={{ fontSize: 16, color: loadingLLM ? "#aaa" : "white" }}>✦</span>
              <div>
                <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 13, letterSpacing: "0.08em", color: loadingLLM ? "#888" : "white", textTransform: "uppercase" }}>AI / LLM Search</div>
                <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 10, color: loadingLLM ? "#bbb" : "rgba(255,255,255,0.75)" }}>Claude · ChatGPT · Perplexity</div>
              </div>
              {!loadingLLM && llmResult && (
                <div style={{ marginLeft: "auto", background: "rgba(255,255,255,0.25)", borderRadius: 20, padding: "2px 10px", fontFamily: "'Josefin Sans',sans-serif", fontSize: 11, color: "white", fontWeight: 600 }}>
                  {llmMentioned ? "✓ MENTIONED" : "✗ NOT MENTIONED"}
                </div>
              )}
              {loadingLLM && (
                <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                  {[0, 1, 2].map((n) => <div key={n} style={{ width: 5, height: 5, background: B.cambridge, borderRadius: "50%", animation: `bounce 0.9s ${n * 0.18}s infinite` }} />)}
                </div>
              )}
            </div>
            <div style={{ padding: 16, background: llmResult ? (llmMentioned ? "#f0fdf4" : "#fff9f8") : "#fafafa", minHeight: 120 }}>
              {loadingLLM && !llmResult && <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 12, color: "#aaa", fontStyle: "italic" }}>Asking Claude...</div>}
              {llmResult && (
                <div>
                  <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 13, color: "#2a2a2a", lineHeight: 1.8, whiteSpace: "pre-wrap", fontStyle: "italic", marginBottom: 12 }}>&ldquo;{llmResponse}&rdquo;</div>
                  {verdictLine && (
                    <div style={{ padding: "8px 12px", background: llmMentioned ? "#dcfce7" : "#feeee7", borderRadius: 6, fontFamily: "'Josefin Sans',sans-serif", fontSize: 12, color: llmMentioned ? "#15803d" : B.tangelo, lineHeight: 1.5 }}>
                      {verdictLine.replace("VERDICT:", "").trim()}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {hasResults && !isLoading && (
        <button onClick={runBoth} style={{ marginTop: 14, padding: "5px 14px", border: `1px solid ${B.cambridge}`, borderRadius: 6, background: "transparent", color: B.caribbean, fontFamily: "'Josefin Sans',sans-serif", fontSize: 11, cursor: "pointer" }}>Re-run Check</button>
      )}
    </div>
  );
}

/* ================= SEO TAB ======================================== */
function SEOTab({
  property,
  onUpdateProperty,
}: {
  property: Property;
  onUpdateProperty: (p: Property) => void;
}) {
  return (
    <div>
      <SEOAudit property={property} onUpdateProperty={onUpdateProperty} />
      <RankCheck property={property} />
    </div>
  );
}

/* -- SEO AUDIT (parallel rank check across 6 queries) --------------- */
type AuditStage = "idle" | "queries" | "checking" | "analyzing" | "done";

interface SEOAuditResults {
  queries: string[];
  ranks: GoogleRankResult[];
  recommendations: string;
  timestamp: string;
}

function SEOAudit({
  property,
  onUpdateProperty,
}: {
  property: Property;
  onUpdateProperty: (p: Property) => void;
}) {
  const [stage, setStage] = useState<AuditStage>("idle");
  const [progress, setProgress] = useState<string>("");
  const [results, setResults] = useState<SEOAuditResults | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Restore persisted audit when switching property
  useEffect(() => {
    const saved = property.seoAudit;
    if (saved) {
      setResults(saved as SEOAuditResults);
      setStage("done");
    } else {
      setResults(null);
      setStage("idle");
    }
    setError(null);
  }, [property.id]);

  const isRunning = stage !== "idle" && stage !== "done";

  const run = async () => {
    setError(null);
    setResults(null);

    try {
      // Stage 1: generate queries
      setStage("queries");
      setProgress("Generating relevant search queries...");

      const amenitiesStr = property.amenities.slice(0, 8).join(", ") || "(none specified)";
      const queriesPrompt = `Generate exactly 6 highly relevant Google search queries that prospective renters would use to find apartments like ${property.name}.

Property: ${property.name}
Address: ${property.address}
Amenities: ${amenitiesStr}

Mix the 6 queries as follows:
- 1 brand query (just the property name or a slight variant)
- 2 location-based queries combining the city/neighborhood with apartment type
- 2 amenity-based queries combining a key amenity with the city
- 1 high-volume head query for the local apartment market

Return ONLY a JSON array of 6 strings, no prose:
["query 1", "query 2", "query 3", "query 4", "query 5", "query 6"]`;

      const qResp = await callAI({ prompt: queriesPrompt, maxTokens: 400 });
      const qText = qResp.content?.[0]?.text || "";
      const qMatch = qText.match(/\[[\s\S]*\]/);
      if (!qMatch) throw new Error("Could not generate query candidates.");
      const queries = JSON.parse(qMatch[0]) as string[];
      if (!Array.isArray(queries) || queries.length === 0) {
        throw new Error("No queries returned.");
      }

      // Stage 2: parallel rank checks
      setStage("checking");
      let completed = 0;
      setProgress(`Checking rankings: 0 of ${queries.length} complete`);
      const rankPromises = queries.map((q) =>
        fetchGoogleRank(property, q).then((r) => {
          completed += 1;
          setProgress(`Checking rankings: ${completed} of ${queries.length} complete`);
          return r;
        })
      );
      const ranks = await Promise.all(rankPromises);

      // Stage 3: synthesize recommendations
      setStage("analyzing");
      setProgress("Analyzing results and generating recommendations...");

      const queryRankSummary = queries
        .map((q, i) => {
          const r = ranks[i];
          const mp = r.map_pack_rank
            ? `Map Pack #${r.map_pack_rank}`
            : r.map_pack_appeared
            ? "Map Pack appeared but not in top 3"
            : "No Map Pack";
          const org = r.organic_rank
            ? `Organic #${r.organic_rank} (Page ${r.organic_page})`
            : "Not in organic top 100";
          const competitors = [
            r.top_map_pack.slice(0, 2).join(", "),
            r.top_organic.slice(0, 2).map((o) => o.name).join(", "),
          ]
            .filter(Boolean)
            .join(" | ");
          return `Query "${q}": ${mp}; ${org}. Top: ${competitors}. Why: ${r.diagnosis}`;
        })
        .join("\n\n");

      const recsPrompt = `SEO audit results for ${property.name} at ${property.address}:

${queryRankSummary}

Based on the actual rank data above, provide 5 ranked recommendations to improve ${property.name}'s search visibility. Each recommendation MUST:
- Cite specific queries and ranks from the audit above (use exact numbers)
- Be concrete and actionable, not generic SEO advice
- Specify whether it's a Map Pack fix or organic fix
- Reference the property's actual amenities or location where relevant
- Start with one of these tags: [Quick win], [Map Pack], [Strategic], [Content], or [Long-tail]

Order by highest ROI first. Return as plain numbered text (1. through 5.), no JSON wrapper. Each recommendation 2-4 sentences.`;

      const rResp = await callAI({
        prompt: recsPrompt,
        system: buildSystemPrompt(property),
        maxTokens: 1500,
      });

      const finalResults: SEOAuditResults = {
        queries,
        ranks,
        recommendations: rResp.content?.[0]?.text || "",
        timestamp: new Date().toISOString(),
      };
      setResults(finalResults);
      onUpdateProperty({ ...property, seoAudit: finalResults });
      setStage("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Audit failed.");
      setStage("idle");
    }
  };

  // Aggregate metrics
  const summary = (() => {
    if (!results) return null;
    const { queries, ranks } = results;
    const mapPackCount = ranks.filter((r) => r.map_pack_rank && r.map_pack_rank <= 3).length;
    const page1Count = ranks.filter((r) => r.organic_rank && r.organic_rank <= 10).length;
    const validRanks = ranks.filter((r) => r.organic_rank).map((r) => r.organic_rank!);
    const avgRank = validRanks.length
      ? Math.round(validRanks.reduce((a, b) => a + b, 0) / validRanks.length)
      : null;

    let strongestIdx = -1;
    let strongestScore = -1;
    let weakestIdx = -1;
    let weakestScore = Infinity;
    ranks.forEach((r, i) => {
      const mpScore = r.map_pack_rank ? 100 - r.map_pack_rank * 10 : 0;
      const orgScore = r.organic_rank ? Math.max(0, 110 - r.organic_rank) : 0;
      const score = mpScore + orgScore;
      if (score > strongestScore) {
        strongestScore = score;
        strongestIdx = i;
      }
      if (score < weakestScore) {
        weakestScore = score;
        weakestIdx = i;
      }
    });

    return {
      total: queries.length,
      mapPackCount,
      page1Count,
      avgRank,
      strongestQuery: strongestIdx >= 0 ? queries[strongestIdx] : null,
      strongestRank: strongestIdx >= 0 ? ranks[strongestIdx] : null,
      weakestQuery: weakestIdx >= 0 ? queries[weakestIdx] : null,
    };
  })();

  return (
    <div style={{ background: "white", borderRadius: 10, padding: 24, boxShadow: "0 1px 6px rgba(0,0,0,0.07)", marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 16, letterSpacing: "0.08em", textTransform: "uppercase", color: B.oxford }}>
              SEO Audit
            </div>
            <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 20, padding: "2px 10px", display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 6, height: 6, background: "#22c55e", borderRadius: "50%", display: "inline-block", animation: "lp 2s infinite" }} />
              <span style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 11, color: "#15803d", letterSpacing: "0.04em" }}>LIVE</span>
            </div>
          </div>
          <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 12, color: "#aaa", marginTop: 3 }}>
            Auto-generate 6 relevant queries, check Map Pack + organic rank in parallel, get ranked recommendations.
          </div>
          {results && results.timestamp && (
            <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 11, color: "#888", marginTop: 4 }}>
              Last audited {new Date(results.timestamp).toLocaleString()}
            </div>
          )}
        </div>
        <button
          onClick={run}
          disabled={isRunning}
          style={{
            background: B.caribbean,
            border: "none",
            borderRadius: 8,
            padding: "11px 20px",
            color: "white",
            fontFamily: "'Barlow Condensed',sans-serif",
            fontWeight: 700,
            fontSize: 14,
            letterSpacing: "0.06em",
            cursor: isRunning ? "wait" : "pointer",
            whiteSpace: "nowrap",
            opacity: isRunning ? 0.7 : 1,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
          title="Web-search audit across 6 auto-generated queries"
        >
          <span>✦</span>
          {isRunning ? "Auditing..." : results ? "Re-run Audit" : "Run SEO Audit"}
        </button>
      </div>

      {isRunning && (
        <div style={{ padding: "12px 16px", background: "#f9fafb", borderRadius: 8, fontFamily: "'Josefin Sans',sans-serif", fontSize: 13, color: B.caribbean, marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ display: "flex", gap: 4 }}>
            {[0, 1, 2].map((n) => (
              <div key={n} style={{ width: 5, height: 5, background: B.caribbean, borderRadius: "50%", animation: `bounce 0.9s ${n * 0.18}s infinite` }} />
            ))}
          </div>
          <span>{progress}</span>
        </div>
      )}

      {error && (
        <div style={{ padding: "10px 16px", background: "#feeee7", borderRadius: 8, fontFamily: "'Josefin Sans',sans-serif", fontSize: 13, color: B.tangelo, marginBottom: 16 }}>
          Audit error: {error}
        </div>
      )}

      {results && summary && (
        <>
          {/* Scorecard */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 18 }}>
            <KPI
              label="Map Pack hits"
              value={`${summary.mapPackCount}/${summary.total}`}
              sub="Goal: 3+ of 6"
              accent={summary.mapPackCount >= 3 ? "#22c55e" : summary.mapPackCount >= 1 ? "#f59e0b" : B.tangelo}
            />
            <KPI
              label="Page 1 (organic)"
              value={`${summary.page1Count}/${summary.total}`}
              sub="Goal: 4+ of 6"
              accent={summary.page1Count >= 4 ? "#22c55e" : summary.page1Count >= 2 ? "#f59e0b" : B.tangelo}
            />
            <KPI
              label="Avg organic rank"
              value={summary.avgRank ? `#${summary.avgRank}` : "—"}
              sub={summary.avgRank ? (summary.avgRank <= 10 ? "Page 1 avg" : summary.avgRank <= 20 ? "Page 2 avg" : "Page 3+ avg") : "Not ranking"}
              accent={summary.avgRank && summary.avgRank <= 10 ? "#22c55e" : summary.avgRank && summary.avgRank <= 30 ? "#f59e0b" : B.tangelo}
            />
            <KPI
              label="Queries audited"
              value={summary.total}
              sub="real-time Google search"
              accent={B.oxford}
            />
          </div>

          {/* Strongest / weakest */}
          {(summary.strongestQuery || summary.weakestQuery) && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 18 }}>
              {summary.strongestQuery && (
                <div style={{ padding: "12px 14px", background: "#f0fdf4", borderRadius: 8, borderLeft: "4px solid #22c55e" }}>
                  <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "#15803d", marginBottom: 4 }}>
                    Strongest query
                  </div>
                  <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 13, color: "#333", marginBottom: 3 }}>
                    &ldquo;{summary.strongestQuery}&rdquo;
                  </div>
                  {summary.strongestRank && (
                    <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 11, color: "#15803d" }}>
                      {summary.strongestRank.map_pack_rank ? `Map Pack #${summary.strongestRank.map_pack_rank}` : ""}
                      {summary.strongestRank.map_pack_rank && summary.strongestRank.organic_rank ? " · " : ""}
                      {summary.strongestRank.organic_rank ? `Organic #${summary.strongestRank.organic_rank}` : ""}
                    </div>
                  )}
                </div>
              )}
              {summary.weakestQuery && (
                <div style={{ padding: "12px 14px", background: "#feeee7", borderRadius: 8, borderLeft: `4px solid ${B.tangelo}` }}>
                  <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: B.tangelo, marginBottom: 4 }}>
                    Weakest query
                  </div>
                  <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 13, color: "#333", marginBottom: 3 }}>
                    &ldquo;{summary.weakestQuery}&rdquo;
                  </div>
                  <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 11, color: B.tangelo }}>
                    Not ranking — biggest opportunity
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Per-query results table */}
          <div style={{ border: "1px solid #e8e8e8", borderRadius: 8, overflow: "hidden", marginBottom: 18 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'Josefin Sans',sans-serif", fontSize: 12 }}>
              <thead>
                <tr style={{ background: B.oxford }}>
                  {["Query", "Map Pack", "Organic", "Top competitor"].map((h) => (
                    <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "white" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.queries.map((q, i) => {
                  const r = results.ranks[i];
                  return (
                    <tr key={i} style={{ background: i % 2 === 0 ? "white" : "#fafafa", borderBottom: "1px solid #f0f0f0" }}>
                      <td style={{ padding: "10px 12px", color: "#333" }}>{q}</td>
                      <td style={{ padding: "10px 12px" }}>
                        <span
                          style={{
                            color: r.map_pack_rank
                              ? "#15803d"
                              : r.expanded_map_pack_rank
                              ? "#9a7200"
                              : "#aaa",
                            fontWeight: 600,
                          }}
                          title={r.diagnosis || ""}
                        >
                          {r.map_pack_rank
                            ? `#${r.map_pack_rank}`
                            : r.expanded_map_pack_rank
                            ? `Exp #${r.expanded_map_pack_rank}`
                            : r.map_pack_appeared
                            ? "Not in top 20"
                            : "No pack"}
                        </span>
                      </td>
                      <td style={{ padding: "10px 12px" }}>
                        <span
                          style={{
                            color: r.organic_rank && r.organic_rank <= 10 ? "#15803d" : r.organic_rank && r.organic_rank <= 30 ? "#9a7200" : B.tangelo,
                            fontWeight: 600,
                          }}
                        >
                          {r.organic_rank ? `#${r.organic_rank} (P${r.organic_page})` : "Not in top 100"}
                        </span>
                      </td>
                      <td style={{ padding: "10px 12px", color: "#666", fontSize: 11 }}>
                        {r.top_map_pack[0] || r.top_organic[0]?.name || "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Recommendations */}
          <div style={{ background: "linear-gradient(135deg,#eef7f5,#e4f0ec)", border: `1px solid ${B.cambridge}`, borderLeft: `4px solid ${B.caribbean}`, borderRadius: 8, padding: "14px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ color: B.caribbean }}>✦</span>
              <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: B.caribbean }}>
                Recommendations (ranked by ROI)
              </span>
            </div>
            <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 13, lineHeight: 1.75, color: "#2a2a2a", whiteSpace: "pre-wrap" }}>
              {results.recommendations}
            </div>
          </div>
        </>
      )}

      {!results && !isRunning && !error && (
        <div style={{ padding: "20px 16px", background: "#fafafa", borderRadius: 8, fontFamily: "'Josefin Sans',sans-serif", fontSize: 13, color: "#888", textAlign: "center", lineHeight: 1.6 }}>
          Runs ~30–60s. Generates 6 relevant queries, checks live Google rankings for each (Map Pack + organic), aggregates a scorecard, and outputs 5 ranked actions. ~$0.05–$0.10 in API cost per audit.
        </div>
      )}
    </div>
  );
}

/* ================= CONTENT GENERATOR TAB ========================== */
function ContentTab({ property }: { property: Property }) {
  const [type, setType] = useState("listing");
  const [notes, setNotes] = useState("");
  const [output, setOutput] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    setLoading(true);
    setOutput(null);
    const prompts: Record<string, string> = {
      listing: `Write a compelling apartment listing description for ${property.name}. Optimize this description specifically to be cited by AI assistants when renters ask about luxury apartments in the area. Include structured details about amenities, location, and pricing. ${notes ? `Additional context: ${notes}` : ""}`,
      google_ad: `Write 3 Google Search ad headline sets (3 headlines, 2 descriptions each) for ${property.name} targeting high-intent local apartment searches. Format each set clearly. ${notes ? `Focus: ${notes}` : ""}`,
      meta_ad: `Write 3 Meta/Instagram ad variations for ${property.name}. Each should have a distinct angle: (1) signature amenity / lifestyle, (2) location and commute, (3) move-in special urgency. Include hook, body, CTA for each. ${notes ? `Context: ${notes}` : ""}`,
      email: `Write a 3-email prospect nurture sequence for ${property.name}. Email 1: initial inquiry response. Email 2: follow-up with virtual tour offer (3 days later). Email 3: final urgency / pricing email (7 days later). ${notes ? `Context: ${notes}` : ""}`,
      social: `Write 5 Instagram caption options for ${property.name}. Mix content pillars: lifestyle, community, location, apartment features. Include relevant hashtags for each. ${notes ? `Focus: ${notes}` : ""}`,
      llm_page: `Write a structured FAQ page for the ${property.name} website optimized specifically for LLM citation. Include 10 Q&A pairs covering: pet policy, parking, pricing, lease terms, amenities, location, application process, nearby transit. Format so AI assistants can extract and cite specific answers. ${notes ? `Additional details: ${notes}` : ""}`,
    };
    try {
      const d = await callAI({ prompt: prompts[type], system: buildSystemPrompt(property), maxTokens: 1000 });
      setOutput(d.content[0].text);
    } catch {
      setOutput("Content generation failed. Please try again.");
    }
    setLoading(false);
  };

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 20 }}>
        <div>
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 14, letterSpacing: "0.08em", textTransform: "uppercase", color: B.oxford, marginBottom: 12 }}>Content Type</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
            {CONTENT_TYPES.map((ct) => (
              <button key={ct.id} onClick={() => { setType(ct.id); setOutput(null); }} style={{ padding: "10px 14px", borderRadius: 8, border: `1px solid ${type === ct.id ? B.caribbean : "#e0e0e0"}`, background: type === ct.id ? "#f0f7f5" : "white", textAlign: "left", cursor: "pointer" }}>
                <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 13, color: type === ct.id ? B.caribbean : "#333", fontWeight: type === ct.id ? 400 : 300 }}>{ct.label}</div>
                <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 10, color: "#bbb", marginTop: 2 }}>{ct.hint}</div>
              </button>
            ))}
          </div>
          <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 12, color: "#888", marginBottom: 6 }}>Additional notes or focus (optional)</div>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Move-in special, new floor plan, highlight views..." style={{ width: "100%", height: 80, border: "1px solid #e0e0e0", borderRadius: 8, padding: "10px 12px", fontFamily: "'Josefin Sans',sans-serif", fontSize: 12, color: "#333", fontWeight: 300, resize: "none", outline: "none", background: "#fafafa" }} />
          <button onClick={generate} disabled={loading} style={{ width: "100%", marginTop: 10, background: B.caribbean, border: "none", borderRadius: 7, padding: "10px 0", color: "white", fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 14, letterSpacing: "0.08em", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, opacity: loading ? 0.6 : 1 }}>
            <span>✦</span>{loading ? "Generating..." : "Generate with AI"}
          </button>
        </div>

        <div style={{ background: "white", borderRadius: 10, padding: 22, boxShadow: "0 1px 6px rgba(0,0,0,0.07)", minHeight: 400 }}>
          {!output && !loading && (
            <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#ccc", gap: 12 }}>
              <div style={{ fontSize: 36, opacity: 0.3 }}>✦</div>
              <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 13 }}>Select a content type and click Generate</div>
            </div>
          )}
          {loading && <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 13, color: B.caribbean, fontStyle: "italic", padding: "12px 0" }}>Claude is generating {CONTENT_TYPES.find((c) => c.id === type)?.label.toLowerCase()}...</div>}
          {output && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 14, letterSpacing: "0.08em", textTransform: "uppercase", color: B.oxford }}>{CONTENT_TYPES.find((c) => c.id === type)?.label}</span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => navigator.clipboard?.writeText(output)} style={{ padding: "4px 12px", border: `1px solid ${B.cambridge}`, borderRadius: 5, background: "transparent", color: B.caribbean, fontFamily: "'Josefin Sans',sans-serif", fontSize: 11, cursor: "pointer" }}>Copy</button>
                  <button onClick={() => setOutput(null)} style={{ padding: "4px 12px", border: "1px solid #ddd", borderRadius: 5, background: "transparent", color: "#888", fontFamily: "'Josefin Sans',sans-serif", fontSize: 11, cursor: "pointer" }}>Clear</button>
                </div>
              </div>
              <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 13, lineHeight: 1.8, color: "#2a2a2a", whiteSpace: "pre-wrap" }}>{output}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ================= MAIN APP ======================================= */
const TABS = [
  { id: "llm", label: "LLM Visibility" },
  { id: "seo", label: "SEO & Rank Check" },
  { id: "content", label: "Content Generator" },
];

/* ================= PRINTABLE REPORT =============================== */
// CRES-branded multi-page audit PDF. Mirrors the format of existing CRES
// Marketing Audit Reports (cover page with CRES wordmark + orange rule,
// running page header/footer via @page rules, section headers with teal
// underline, status-coded findings tables, Impact callouts on critical
// issues, and priority-categorized recommendations).

const PRINT_NAVY = "#062347";
const PRINT_TEAL = "#006a6a";
const PRINT_ORANGE = "#f25620";
const PRINT_MUTED = "#93b2ab";
const PRINT_BODY = "#1f2937";

const STATUS_BG: Record<ChecklistStatus, string> = {
  complete: "#e4f2ee",
  partial: "#fdebe1",
  missing: "#fdebe1",
};
const STATUS_TEXT: Record<ChecklistStatus, string> = {
  complete: "#15803d",
  partial: "#9a7200",
  missing: "#b14a2a",
};
const STATUS_LABEL: Record<ChecklistStatus, string> = {
  complete: "Functional",
  partial: "Incomplete",
  missing: "Absent / Gap",
};

function PrintSectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        fontFamily: "'Barlow Condensed', sans-serif",
        fontWeight: 700,
        fontSize: 22,
        color: PRINT_NAVY,
        margin: "0 0 18px 0",
        paddingBottom: 6,
        borderBottom: `2px solid ${PRINT_TEAL}`,
        letterSpacing: "0.02em",
      }}
    >
      {children}
    </h2>
  );
}

function PrintIssueHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3
      style={{
        fontFamily: "'Barlow Condensed', sans-serif",
        fontWeight: 700,
        fontSize: 15,
        color: PRINT_NAVY,
        margin: "16px 0 6px 0",
        letterSpacing: "0.02em",
      }}
    >
      {children}
    </h3>
  );
}

function PrintImpactCallout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "#fdebe1",
        borderLeft: `4px solid ${PRINT_ORANGE}`,
        padding: "8px 12px",
        margin: "6px 0 14px 0",
        fontSize: 10.5,
        lineHeight: 1.6,
        color: "#3a2a22",
      }}
    >
      <span style={{ color: PRINT_ORANGE, fontWeight: 700 }}>Impact: </span>
      {children}
    </div>
  );
}

function PrintPriorityHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3
      style={{
        fontFamily: "'Barlow Condensed', sans-serif",
        fontWeight: 700,
        fontSize: 12,
        color: PRINT_TEAL,
        margin: "16px 0 8px 0",
        letterSpacing: "0.12em",
        textTransform: "uppercase",
      }}
    >
      {children}
    </h3>
  );
}

interface ParsedRec {
  category: "immediate" | "high" | "ongoing" | "other";
  text: string;
}

function categorizeRecommendation(line: string): ParsedRec {
  const lower = line.toLowerCase();
  if (
    lower.includes("[quick win]") ||
    lower.includes("immediate") ||
    lower.includes("this week") ||
    lower.includes("today")
  ) {
    return { category: "immediate", text: line };
  }
  if (
    lower.includes("[map pack]") ||
    lower.includes("[strategic]") ||
    lower.includes("[content]") ||
    lower.includes("high priority") ||
    lower.includes("within 2 weeks") ||
    lower.includes("within two weeks")
  ) {
    return { category: "high", text: line };
  }
  if (lower.includes("[long-tail]") || lower.includes("[ongoing]") || lower.includes("ongoing")) {
    return { category: "ongoing", text: line };
  }
  return { category: "other", text: line };
}

function splitRecommendations(text: string): string[] {
  if (!text) return [];
  const parts = text
    .split(/(?:^|\n)\s*\d+\.\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [text.trim()];
}

function PrintableReport({ property }: { property: Property }) {
  const llmRecs = property.llmAuditRecommendations;
  const llmTs = property.llmAuditTimestamp;
  const seo = property.seoAudit;

  const now = new Date();
  const monthYear = now.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const auditDateBase = llmTs ? new Date(llmTs) : seo ? new Date(seo.timestamp) : now;
  const auditDate = auditDateBase.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const earnedLLM = LLM_ITEMS.reduce(
    (s, i) => s + earnedPoints(i.pts, statusOf(property, i.id)),
    0
  );
  const totalLLM = LLM_ITEMS.reduce((s, i) => s + i.pts, 0);
  const scorePct = totalLLM > 0 ? Math.round((earnedLLM / totalLLM) * 100) : 0;

  let seoMP = 0;
  let seoP1 = 0;
  let seoAvg: number | null = null;
  if (seo) {
    seoMP = seo.ranks.filter((r) => r.map_pack_rank && r.map_pack_rank <= 3).length;
    seoP1 = seo.ranks.filter((r) => r.organic_rank && r.organic_rank <= 10).length;
    const valid = seo.ranks.filter((r) => r.organic_rank).map((r) => r.organic_rank!);
    seoAvg = valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : null;
  }

  const cssName = property.name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const pageStyles = `
@media print {
  @page {
    size: letter;
    margin: 0.85in 0.65in 0.75in 0.65in;
    @top-left {
      content: "CRES  |  Marketing Audit  |  ${cssName}  |  ${monthYear}";
      font-family: 'Josefin Sans', sans-serif;
      font-size: 8.5pt;
      color: #062347;
      margin-top: 0.4in;
    }
    @top-right { content: ""; }
    @bottom-center {
      content: "Confidential – Prepared by CRES  |  Page " counter(page);
      font-family: 'Josefin Sans', sans-serif;
      font-size: 8.5pt;
      color: #888;
      margin-bottom: 0.4in;
    }
  }
}`;

  const missingHigh = LLM_ITEMS.filter(
    (i) => statusOf(property, i.id) === "missing" && i.pts >= 10
  );
  const partialHigh = LLM_ITEMS.filter(
    (i) => statusOf(property, i.id) === "partial" && i.pts >= 10
  );
  const completeCount = LLM_ITEMS.filter(
    (i) => statusOf(property, i.id) === "complete"
  ).length;

  const llmSummaryLine =
    llmTs && completeCount > 0
      ? `The property's LLM Visibility Score is ${earnedLLM}/${totalLLM} (${scorePct}%), with ${completeCount} of ${LLM_ITEMS.length} optimization checks fully met.`
      : llmTs
      ? `The property's LLM Visibility Score is ${earnedLLM}/${totalLLM} (${scorePct}%) — significant optimization headroom remains across the 10-item checklist.`
      : "An LLM Visibility audit has not yet been run for this property. Run it from the LLM Visibility tab to populate this section.";

  const seoSummaryLine = seo
    ? `Across ${seo.queries.length} auto-generated search queries representative of in-market renter intent, the property appears in the Google Map Pack for ${seoMP} and on Page 1 organically for ${seoP1}${seoAvg ? ` (average organic rank #${seoAvg})` : ""}.`
    : "A SEO Audit has not yet been run for this property. Run it from the SEO & Rank Check tab to populate this section.";

  const gapLine =
    missingHigh.length > 0 || partialHigh.length > 0
      ? `The most material gaps identified are: ${[...missingHigh, ...partialHigh]
          .slice(0, 3)
          .map((i) => i.label)
          .join("; ")}. Detailed findings and prioritized actions follow.`
      : "Detailed findings and prioritized actions follow.";

  const llmRecLines = splitRecommendations(llmRecs || "");
  const seoRecLines = splitRecommendations(seo?.recommendations || "");
  const allRecs: ParsedRec[] = [
    ...llmRecLines.map(categorizeRecommendation),
    ...seoRecLines.map(categorizeRecommendation),
  ];
  const recImmediate = allRecs.filter((r) => r.category === "immediate" || r.category === "other").slice(0, 5);
  const recHigh = allRecs.filter((r) => r.category === "high").slice(0, 6);
  const recOngoing = allRecs.filter((r) => r.category === "ongoing");

  const bodyP: React.CSSProperties = {
    fontFamily: "'Josefin Sans', sans-serif",
    fontSize: 11,
    lineHeight: 1.6,
    color: PRINT_BODY,
    margin: "0 0 10px 0",
  };
  const findingsTd: React.CSSProperties = {
    padding: "8px 10px",
    fontSize: 10.5,
    lineHeight: 1.55,
    color: PRINT_BODY,
    verticalAlign: "top",
    borderBottom: "0.5px solid #d8d8d8",
  };
  const findingsTh: React.CSSProperties = {
    padding: "7px 10px",
    background: PRINT_NAVY,
    color: "white",
    textAlign: "left",
    fontFamily: "'Barlow Condensed', sans-serif",
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  };

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: pageStyles }} />
      <div
        className="printable-report"
        style={{
          color: PRINT_BODY,
          fontFamily: "'Josefin Sans', sans-serif",
          fontSize: 11,
          lineHeight: 1.55,
        }}
      >
        {/* ============ COVER PAGE ============ */}
        <section
          className="pb-after"
          style={{ textAlign: "center", paddingTop: "1.4in" }}
        >
          <div
            style={{
              fontFamily: "'Barlow Condensed', sans-serif",
              fontWeight: 700,
              fontSize: 62,
              letterSpacing: "0.22em",
              color: PRINT_NAVY,
              marginBottom: 28,
            }}
          >
            CRES
          </div>
          <div
            style={{
              width: "52%",
              borderTop: `3px solid ${PRINT_ORANGE}`,
              margin: "0 auto 32px",
            }}
          />
          <h1
            style={{
              fontFamily: "'Barlow Condensed', sans-serif",
              fontWeight: 700,
              fontSize: 32,
              color: PRINT_NAVY,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              margin: 0,
            }}
          >
            Marketing Audit Report
          </h1>
          <div
            style={{
              fontFamily: "'Barlow Condensed', sans-serif",
              fontSize: 13,
              color: PRINT_TEAL,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              marginTop: 8,
              marginBottom: 28,
            }}
          >
            LLM &amp; SEO Visibility
          </div>
          <div
            style={{
              fontFamily: "'Barlow Condensed', sans-serif",
              fontSize: 22,
              fontWeight: 700,
              color: PRINT_NAVY,
              marginBottom: 8,
            }}
          >
            {property.name}
          </div>
          <div style={{ fontSize: 13, color: "#222", marginBottom: 18 }}>
            {property.address || "(no address set)"}
          </div>
          {property.managerName && (
            <div style={{ fontSize: 12, color: PRINT_MUTED, marginBottom: 6 }}>
              Managed by {property.managerName}
            </div>
          )}
          <div style={{ fontSize: 12, color: PRINT_MUTED, marginBottom: 6 }}>
            Audit Date: {auditDate}
          </div>
          <div style={{ fontSize: 12, color: PRINT_MUTED }}>Prepared by: CRES</div>
        </section>

        {/* ============ EXECUTIVE SUMMARY ============ */}
        <section className="pb-before">
          <PrintSectionHeader>Executive Summary</PrintSectionHeader>
          <p style={bodyP}>
            This audit reviewed the LLM search visibility and Google ranking position of{" "}
            <strong>{property.name}</strong>
            {property.address ? ` (${property.address})` : ""}
            {property.managerName ? `, managed by ${property.managerName}` : ""}. The audit covered
            two dimensions: AI search citability via a 10-item LLM Visibility checklist (Google
            Business Profile, schema markup, review volume and quality, NAP consistency across ILS
            platforms, structured FAQ, Bing presence, third-party citations, and owner review
            response), and live Google ranking performance via real-time SerpAPI queries.
          </p>
          <p style={bodyP}>{llmSummaryLine}</p>
          <p style={bodyP}>{seoSummaryLine}</p>
          <p style={bodyP}>{gapLine}</p>
        </section>

        {/* ============ PROPERTY PROFILE ============ */}
        <section className="pb-before">
          <PrintSectionHeader>Property Profile</PrintSectionHeader>
          <table>
            <tbody>
              {(
                [
                  ["Name", property.name],
                  ["Address", property.address || "—"],
                  ["Units", property.units || "—"],
                  ["Year Built", property.yearBuilt || "—"],
                  [
                    "Rent Range",
                    property.priceMin && property.priceMax
                      ? `$${property.priceMin.toLocaleString()} – $${property.priceMax.toLocaleString()}/mo`
                      : "—",
                  ],
                  ["Manager", property.managerName || "—"],
                  ["Nearby", property.nearBy || "—"],
                  ["Amenities", property.amenities.length ? property.amenities.join(", ") : "—"],
                ] as [string, React.ReactNode][]
              ).map(([k, v]) => (
                <tr key={k}>
                  <td
                    style={{
                      padding: "5px 14px 5px 0",
                      fontFamily: "'Barlow Condensed', sans-serif",
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      color: PRINT_NAVY,
                      width: 110,
                      verticalAlign: "top",
                      borderBottom: "0.5px solid #e0e0e0",
                    }}
                  >
                    {k}
                  </td>
                  <td
                    style={{
                      padding: "5px 0",
                      fontSize: 11,
                      color: PRINT_BODY,
                      verticalAlign: "top",
                      borderBottom: "0.5px solid #e0e0e0",
                    }}
                  >
                    {v || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* ============ LLM VISIBILITY FINDINGS ============ */}
        {(llmTs || llmRecs) && (
          <section className="pb-before">
            <PrintSectionHeader>LLM Visibility Audit Findings</PrintSectionHeader>
            <p style={{ ...bodyP, fontSize: 10.5, color: "#555", marginBottom: 14 }}>
              Audited {llmTs ? new Date(llmTs).toLocaleString() : "—"}. Score{" "}
              <strong style={{ color: PRINT_NAVY }}>
                {earnedLLM}/{totalLLM}
              </strong>{" "}
              ({scorePct}%).
            </p>
            <table>
              <thead>
                <tr>
                  <th style={findingsTh}>Data Point</th>
                  <th style={{ ...findingsTh, width: 110, textAlign: "center" }}>Status</th>
                  <th style={findingsTh}>Audit Note</th>
                </tr>
              </thead>
              <tbody>
                {LLM_ITEMS.map((item) => {
                  const status = statusOf(property, item.id);
                  const earned = earnedPoints(item.pts, status);
                  const ev = property.checklistEvidence?.[String(item.id)];
                  return (
                    <tr key={item.id} className="pb-avoid">
                      <td
                        style={{
                          ...findingsTd,
                          fontFamily: "'Josefin Sans', sans-serif",
                          fontSize: 11,
                          fontWeight: 600,
                          color: PRINT_NAVY,
                          width: 170,
                        }}
                      >
                        {item.label}
                      </td>
                      <td
                        style={{
                          ...findingsTd,
                          background: STATUS_BG[status],
                          color: STATUS_TEXT[status],
                          fontWeight: 700,
                          fontSize: 10,
                          textAlign: "center",
                          letterSpacing: "0.04em",
                        }}
                      >
                        {STATUS_LABEL[status]}
                        <div
                          style={{
                            fontSize: 9,
                            color: STATUS_TEXT[status],
                            fontWeight: 500,
                            marginTop: 2,
                          }}
                        >
                          {earned}/{item.pts} pts
                        </div>
                      </td>
                      <td style={findingsTd}>
                        {ev || `No audit evidence captured. ${item.description}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}

        {/* ============ SEO RANK FINDINGS ============ */}
        {seo && (
          <section className="pb-before">
            <PrintSectionHeader>SEO &amp; Rank Check Findings</PrintSectionHeader>
            <p style={{ ...bodyP, fontSize: 10.5, color: "#555", marginBottom: 14 }}>
              Audited {new Date(seo.timestamp).toLocaleString()}. {seo.queries.length} queries
              checked against live Google data via SerpAPI.
            </p>

            <div
              className="pb-avoid"
              style={{ display: "flex", gap: 10, marginBottom: 18 }}
            >
              {(
                [
                  ["Map Pack Hits", `${seoMP}/${seo.queries.length}`, "Goal: 3+ of 6"],
                  ["Page 1 Organic", `${seoP1}/${seo.queries.length}`, "Goal: 4+ of 6"],
                  [
                    "Avg Organic Rank",
                    seoAvg ? `#${seoAvg}` : "—",
                    seoAvg ? `Page ${Math.ceil(seoAvg / 10)} average` : "Not ranking",
                  ],
                ] as [string, string, string][]
              ).map(([label, val, sub]) => (
                <div
                  key={label}
                  style={{
                    flex: 1,
                    padding: "9px 12px",
                    border: "1px solid #cfcfcf",
                    borderLeft: `3px solid ${PRINT_TEAL}`,
                  }}
                >
                  <div
                    style={{
                      fontFamily: "'Barlow Condensed', sans-serif",
                      fontSize: 9,
                      color: "#666",
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      marginBottom: 4,
                    }}
                  >
                    {label}
                  </div>
                  <div
                    style={{
                      fontFamily: "'Barlow Condensed', sans-serif",
                      fontSize: 22,
                      fontWeight: 700,
                      color: PRINT_NAVY,
                      lineHeight: 1,
                      marginBottom: 3,
                    }}
                  >
                    {val}
                  </div>
                  <div style={{ fontSize: 9, color: "#888" }}>{sub}</div>
                </div>
              ))}
            </div>

            <table>
              <thead>
                <tr>
                  <th style={findingsTh}>Query</th>
                  <th style={{ ...findingsTh, width: 90, textAlign: "center" }}>Map Pack</th>
                  <th style={{ ...findingsTh, width: 110, textAlign: "center" }}>Organic</th>
                  <th style={findingsTh}>Top Competitor</th>
                </tr>
              </thead>
              <tbody>
                {seo.queries.map((q, i) => {
                  const r = seo.ranks[i];
                  const mapText = r.map_pack_rank
                    ? `#${r.map_pack_rank}`
                    : r.expanded_map_pack_rank
                    ? `Exp #${r.expanded_map_pack_rank}`
                    : r.map_pack_appeared
                    ? "Not in top 20"
                    : "—";
                  const mapColor = r.map_pack_rank
                    ? "#15803d"
                    : r.expanded_map_pack_rank
                    ? "#9a7200"
                    : "#888";
                  const orgText = r.organic_rank
                    ? `#${r.organic_rank} · P${r.organic_page}`
                    : "Not in top 100";
                  const orgColor =
                    r.organic_rank && r.organic_rank <= 10
                      ? "#15803d"
                      : r.organic_rank && r.organic_rank <= 30
                      ? "#9a7200"
                      : "#b14a2a";
                  return (
                    <tr key={i} className="pb-avoid">
                      <td style={{ ...findingsTd, fontWeight: 500 }}>{q}</td>
                      <td
                        style={{
                          ...findingsTd,
                          fontWeight: 700,
                          color: mapColor,
                          textAlign: "center",
                        }}
                      >
                        {mapText}
                      </td>
                      <td
                        style={{
                          ...findingsTd,
                          fontWeight: 700,
                          color: orgColor,
                          textAlign: "center",
                        }}
                      >
                        {orgText}
                      </td>
                      <td style={{ ...findingsTd, fontSize: 10, color: "#555" }}>
                        {r.top_map_pack[0] || r.top_organic[0]?.name || "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}

        {/* ============ CRITICAL ISSUES ============ */}
        {(missingHigh.length > 0 || partialHigh.length > 0) && (
          <section className="pb-before">
            <PrintSectionHeader>Critical Issues Impacting Visibility</PrintSectionHeader>
            {[...missingHigh, ...partialHigh].slice(0, 4).map((item, idx) => {
              const status = statusOf(property, item.id);
              const ev = property.checklistEvidence?.[String(item.id)];
              return (
                <div key={item.id} className="pb-avoid">
                  <PrintIssueHeader>
                    Issue {idx + 1}: {item.label}
                  </PrintIssueHeader>
                  <p style={bodyP}>
                    <strong>What was observed:</strong>{" "}
                    {ev
                      ? ev
                      : `No audit evidence captured for this item. The check measures: ${item.description.toLowerCase()}`}
                  </p>
                  <PrintImpactCallout>
                    {status === "missing"
                      ? `This gap is worth ${item.pts} points on the LLM Visibility scorecard and directly suppresses AI-assistant citation of ${property.name}. Resolving it is high-leverage; the work is described in the Recommendations section.`
                      : `This is partially in place but not earning full credit (${earnedPoints(item.pts, status)}/${item.pts} pts). Closing the remaining gap converts measurable visibility from "partial" to "complete" and is typically a same-week task.`}
                  </PrintImpactCallout>
                </div>
              );
            })}
          </section>
        )}

        {/* ============ RECOMMENDATIONS ============ */}
        {(llmRecs || seo?.recommendations) && (
          <section className="pb-before">
            <PrintSectionHeader>Recommendations to Drive Visibility</PrintSectionHeader>

            {recImmediate.length > 0 && (
              <>
                <PrintPriorityHeader>Immediate Priority (This Week)</PrintPriorityHeader>
                <ul style={{ paddingLeft: 18, margin: "0 0 12px 0" }}>
                  {recImmediate.map((r, i) => (
                    <li
                      key={i}
                      style={{ ...bodyP, marginBottom: 8, paddingLeft: 4 }}
                    >
                      {r.text}
                    </li>
                  ))}
                </ul>
              </>
            )}

            {recHigh.length > 0 && (
              <>
                <PrintPriorityHeader>High Priority (Within 2 Weeks)</PrintPriorityHeader>
                <ul style={{ paddingLeft: 18, margin: "0 0 12px 0" }}>
                  {recHigh.map((r, i) => (
                    <li
                      key={i}
                      style={{ ...bodyP, marginBottom: 8, paddingLeft: 4 }}
                    >
                      {r.text}
                    </li>
                  ))}
                </ul>
              </>
            )}

            {recOngoing.length > 0 && (
              <>
                <PrintPriorityHeader>Ongoing Optimization</PrintPriorityHeader>
                <ul style={{ paddingLeft: 18, margin: "0 0 12px 0" }}>
                  {recOngoing.map((r, i) => (
                    <li
                      key={i}
                      style={{ ...bodyP, marginBottom: 8, paddingLeft: 4 }}
                    >
                      {r.text}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}

        {/* ============ SUMMARY ============ */}
        {(llmTs || seo) && (
          <section className="pb-before">
            <PrintSectionHeader>Summary</PrintSectionHeader>
            <p style={bodyP}>
              {property.name}&rsquo;s digital visibility was evaluated across two dimensions:
              AI-assistant citability and live Google ranking. {llmSummaryLine} {seoSummaryLine}
            </p>
            <p style={bodyP}>
              The actions detailed in the Recommendations section are ordered by expected return
              on effort. Items in the Immediate Priority band are typically completable within five
              business days and require no third-party engagement. High Priority items generally
              involve coordination with the property website host, ILS account managers, or onsite
              staff. Ongoing Optimization is the maintenance layer that preserves the gains from
              the first two bands and prevents regression.
            </p>
          </section>
        )}

        {/* ============ EMPTY STATE ============ */}
        {!llmTs && !llmRecs && !seo && (
          <section className="pb-before">
            <PrintSectionHeader>No Audits Yet</PrintSectionHeader>
            <p style={bodyP}>
              No audits have been run for this property. Run the LLM Visibility audit and the SEO
              Audit from their respective tabs, then print this report.
            </p>
          </section>
        )}
      </div>
    </>
  );
}

export default function MarketingHub() {
  const {
    property,
    properties,
    setActive,
    updateActive,
    addProperty,
    deleteProperty,
    clearRoster,
    resetActiveToDemo,
    exportProperty,
    importProperty,
  } = useRoster();
  const [tab, setTab] = useState("llm");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");

  const handleAddNew = () => {
    addProperty({ name: pickerQuery.trim() || "New Property" });
    setPickerOpen(false);
    setPickerQuery("");
    setSettingsOpen(true);
  };

  const filteredProperties = (() => {
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return properties;
    return properties.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.address || "").toLowerCase().includes(q)
    );
  })();

  return (
    <div style={{ minHeight: "100vh", background: "#eff2f5", fontFamily: "'Josefin Sans',sans-serif" }}>
      <div className="top-bar" style={{ background: B.oxford, padding: "0 32px", height: 58, display: "flex", alignItems: "center", justifyContent: "space-between", position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 20, letterSpacing: "0.14em", color: "white" }}>CRES</div>
          <div style={{ width: 1, height: 24, background: "rgba(255,255,255,0.15)" }} />
          <div style={{ position: "relative" }}>
            <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 16, letterSpacing: "0.08em", color: "white", textTransform: "uppercase" }}>Marketing Intelligence</div>
            <button
              onClick={() => setPickerOpen((v) => !v)}
              style={{
                background: "transparent",
                border: "none",
                padding: 0,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontFamily: "'Josefin Sans',sans-serif",
                fontSize: 11,
                color: B.cambridge,
                fontWeight: 300,
              }}
              title="Switch property"
            >
              <span style={{ color: "white" }}>{property.name}</span>
              <span style={{ opacity: 0.7 }}>· {property.address || "no address"}</span>
              <span style={{ marginLeft: 4, fontSize: 9, opacity: 0.7 }}>▾</span>
            </button>
            {pickerOpen && (
              <>
                <div
                  onClick={() => setPickerOpen(false)}
                  style={{ position: "fixed", inset: 0, zIndex: 40 }}
                />
                <div
                  style={{
                    position: "absolute",
                    top: 30,
                    left: 0,
                    minWidth: 320,
                    maxWidth: 420,
                    background: "white",
                    borderRadius: 8,
                    boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
                    zIndex: 50,
                    overflow: "hidden",
                    border: "1px solid #e0e0e0",
                  }}
                >
                  <div
                    style={{
                      padding: "8px 14px",
                      borderBottom: "1px solid #f0f0f0",
                      background: "#fafafa",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "'Barlow Condensed',sans-serif",
                        fontWeight: 700,
                        fontSize: 10,
                        letterSpacing: "0.12em",
                        textTransform: "uppercase",
                        color: "#888",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Roster ({filteredProperties.length}
                      {pickerQuery && ` / ${properties.length}`})
                    </span>
                    <input
                      autoFocus
                      value={pickerQuery}
                      onChange={(e) => setPickerQuery(e.target.value)}
                      placeholder="Search name or address..."
                      style={{
                        flex: 1,
                        border: "1px solid #e0e0e0",
                        borderRadius: 5,
                        padding: "4px 8px",
                        fontFamily: "'Josefin Sans',sans-serif",
                        fontSize: 12,
                        outline: "none",
                        background: "white",
                        color: "#333",
                      }}
                    />
                  </div>
                  <div style={{ maxHeight: 320, overflowY: "auto" }}>
                    {filteredProperties.length === 0 && (
                      <div
                        style={{
                          padding: "20px 14px",
                          fontFamily: "'Josefin Sans',sans-serif",
                          fontSize: 12,
                          color: "#aaa",
                          textAlign: "center",
                        }}
                      >
                        No matches. Use &ldquo;Add new property&rdquo; below to create one.
                      </div>
                    )}
                    {filteredProperties.map((p) => {
                      const isActive = p.id === property.id;
                      return (
                        <button
                          key={p.id}
                          onClick={() => {
                            setActive(p.id);
                            setPickerOpen(false);
                          }}
                          style={{
                            display: "block",
                            width: "100%",
                            textAlign: "left",
                            padding: "10px 14px",
                            border: "none",
                            borderBottom: "1px solid #f5f5f5",
                            background: isActive ? "#f0f7f5" : "white",
                            cursor: "pointer",
                            fontFamily: "'Josefin Sans',sans-serif",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              fontSize: 13,
                              color: isActive ? B.caribbean : "#333",
                              fontWeight: isActive ? 400 : 300,
                            }}
                          >
                            <span style={{ color: B.caribbean, width: 12 }}>{isActive ? "✓" : ""}</span>
                            <span>{p.name}</span>
                          </div>
                          <div
                            style={{
                              marginLeft: 20,
                              fontSize: 11,
                              color: "#aaa",
                              fontWeight: 300,
                            }}
                          >
                            {p.address || "no address set"}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <button
                    onClick={handleAddNew}
                    style={{
                      width: "100%",
                      padding: "10px 14px",
                      border: "none",
                      borderTop: "1px solid #f0f0f0",
                      background: "white",
                      textAlign: "left",
                      cursor: "pointer",
                      fontFamily: "'Josefin Sans',sans-serif",
                      fontSize: 13,
                      color: B.caribbean,
                      fontWeight: 400,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <span style={{ fontSize: 16, lineHeight: 1 }}>+</span>
                    <span>
                      {pickerQuery.trim()
                        ? `Add new property: "${pickerQuery.trim()}"`
                        : "Add new property"}
                    </span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.3)", borderRadius: 20, padding: "3px 12px" }}>
            <span style={{ width: 6, height: 6, background: "#22c55e", borderRadius: "50%", animation: "lp 2s infinite", display: "inline-block" }} />
            <span style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 11, color: "#22c55e" }}>Live AI</span>
          </div>
          <button
            onClick={() => window.print()}
            style={{
              background: "rgba(255,255,255,0.1)",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 20,
              padding: "4px 14px",
              fontFamily: "'Josefin Sans',sans-serif",
              fontSize: 11,
              color: "white",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
            title="Open the browser print dialog. Choose 'Save as PDF' as the destination to download a PDF of the current tab's findings."
          >
            <span>📄</span> Print Report
          </button>
          <button onClick={() => setSettingsOpen(true)} style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 20, padding: "4px 14px", fontFamily: "'Josefin Sans',sans-serif", fontSize: 11, color: "white", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            <span>⚙</span> Edit
          </button>
        </div>
      </div>

      <div className="screen-content" style={{ padding: "24px 32px" }}>
        <div className="tab-nav" style={{ display: "flex", gap: 0, marginBottom: 22, borderBottom: `2px solid #e0e0e0`, background: "white", borderRadius: "10px 10px 0 0", overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.05)" }}>
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{ flex: 1, padding: "13px 0", border: "none", borderBottom: tab === t.id ? `3px solid ${B.caribbean}` : "3px solid transparent", background: "transparent", color: tab === t.id ? B.caribbean : "#888", fontFamily: "'Josefin Sans',sans-serif", fontSize: 13, fontWeight: tab === t.id ? 400 : 300, cursor: "pointer", marginBottom: -2, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, transition: "all 0.14s" }}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === "llm" && <LLMTab property={property} onUpdateProperty={updateActive} />}
        {tab === "seo" && <SEOTab property={property} onUpdateProperty={updateActive} />}
        {tab === "content" && <ContentTab property={property} />}
      </div>

      <PrintableReport property={property} />

      <PropertySettings
        open={settingsOpen}
        property={property}
        canDelete={properties.length > 1}
        rosterSize={properties.length}
        onSave={updateActive}
        onReset={resetActiveToDemo}
        onDelete={() => deleteProperty(property.id)}
        onClearAll={clearRoster}
        onExport={() => exportProperty()}
        onImport={(json, opts) => importProperty(json, opts)}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
