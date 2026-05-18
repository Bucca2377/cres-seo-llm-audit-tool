"use client";

import { useState } from "react";
import {
  useRoster,
  buildSystemPrompt,
  buildPropContext,
  callAI,
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
      const itemsList = LLM_ITEMS.map(
        (i) => `${i.id}. ${i.label} — ${i.description}`
      ).join("\n");
      const prompt = `Audit ${property.name} at ${property.address} for LLM search visibility. Use web search to verify each checklist item below. Be evidence-based and conservative — when uncertain, mark "partial" or "missing" with a note explaining why.

CHECKLIST ITEMS:
${itemsList}

How to evaluate each item:
1. Google Business Profile — search for "${property.name} ${property.address}". Complete if a verified business listing exists with photos, hours, description; partial if listing exists but is sparse/unverified; missing if no GBP found.
2. Apartment Schema Markup — search for the property's official website. Complete only if you can confirm JSON-LD RentalApartment markup is present; partial if a website exists but schema can't be verified from search snippets; missing if no website found.
3. Review Volume — complete if 50+ reviews across Google + Apartments.com combined; partial if 20-49; missing if <20 or unable to find.
4. Review Quality — complete if average rating ≥4.0; partial if 3.0-3.9; missing if <3.0 or no reviews exist.
5. NAP Consistency Across ILS — check Apartments.com, Zillow, Rent.com listings for this property. Complete if name/address/phone match exactly across platforms; partial if minor formatting differences; missing if major inconsistencies or platforms missing entirely.
6. Structured FAQ on Website — search the property website (if found) for a FAQ page. Complete if a structured Q&A FAQ exists; partial if some FAQ-style content but no dedicated page; missing if no FAQ found.
7. Bing Places Claimed — search Bing for the property. Complete if a claimed Bing Places listing is visible; partial if listing exists but appears unclaimed; missing if no Bing presence.
8. Amenities Structured Data — check Apartments.com and Zillow listings. Complete if amenities are tagged consistently across platforms; partial if some platforms missing amenity tags; missing if amenities are largely absent.
9. Perplexity / Web Citations — search for "${property.name}" plus "best apartments" or "rental guide" in its city. Complete if cited in 2+ third-party guides; partial if 1 citation; missing if none.
10. Owner Response to Reviews — check Google reviews for the property. Complete if owner/manager responds to ≥75% of reviews; partial if some responses; missing if no responses visible.

Return ONLY a JSON object in this exact shape, no prose before or after:
{
  "audit": [
    {"id": 1, "status": "complete" | "partial" | "missing", "evidence": "one short sentence with the specific finding"},
    {"id": 2, "status": "...", "evidence": "..."},
    ... (entries for all 10 items, in id order)
  ],
  "recommendations": "1. First action\\n2. Second action\\n3. Third action\\n4. Fourth action\\n5. Fifth action"
}

Recommendations must be specific to ${property.name}'s actual gaps (use the property's amenities and location). Order by highest impact first.`;

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
      onUpdateProperty({
        ...property,
        checklistStatuses: newStatuses,
        checklistEvidence: newEvidence,
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
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span style={{ color: B.caribbean }}>✦</span>
            <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: B.caribbean }}>Recommendations (ranked by impact)</span>
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
  top_map_pack: [],
  organic_rank: null,
  organic_page: null,
  top_organic: [],
  diagnosis: "",
};

async function fetchGoogleRank(property: Property, query: string): Promise<GoogleRankResult> {
  const PROP_CTX = buildPropContext(property);
  const prompt = `${PROP_CTX}

Search Google for: "${query}"

Find both the Google Business / Map Pack (the 3-pack of local business results that appears for location-based searches) AND the organic web results.

For ${property.name} at ${property.address}, determine:
- Whether ${property.name} appears in the Map Pack (top 3 local slots). If yes, position 1, 2, or 3.
- The exact organic rank (1-100). Page = ceil(rank/10). If not in top 100, organic_rank=null.
- List the 3 businesses in the Map Pack by name (use [] if no Map Pack appeared).
- List the top 5 organic results: name + domain.
- One concise sentence on the single biggest reason ${property.name} is or isn't ranking well for this query.

Return ONLY a JSON object, no prose:
{
  "map_pack_appeared": true | false,
  "map_pack_rank": 1 | 2 | 3 | null,
  "top_map_pack": ["name1", "name2", "name3"],
  "organic_rank": <integer 1-100 or null>,
  "organic_page": <integer or null>,
  "top_organic": [{"name": "...", "domain": "..."}, ...],
  "diagnosis": "..."
}`;
  try {
    const data = await callAI({ prompt, maxTokens: 1200, useWebSearch: true });
    const text = (data.content || [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n");
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return { ...EMPTY_RANK, diagnosis: "Could not parse rank data.", raw: text };
    try {
      return JSON.parse(match[0]) as GoogleRankResult;
    } catch {
      return { ...EMPTY_RANK, diagnosis: "Malformed JSON returned.", raw: text };
    }
  } catch {
    return { ...EMPTY_RANK, error: "Search failed." };
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
                        : googleResult.map_pack_appeared
                        ? "Not in pack"
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
function SEOTab({ property }: { property: Property }) {
  return (
    <div>
      <SEOAudit property={property} />
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
}

function SEOAudit({ property }: { property: Property }) {
  const [stage, setStage] = useState<AuditStage>("idle");
  const [progress, setProgress] = useState<string>("");
  const [results, setResults] = useState<SEOAuditResults | null>(null);
  const [error, setError] = useState<string | null>(null);

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

      setResults({
        queries,
        ranks,
        recommendations: rResp.content?.[0]?.text || "",
      });
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
                        <span style={{ color: r.map_pack_rank ? "#15803d" : "#aaa", fontWeight: 600 }}>
                          {r.map_pack_rank ? `#${r.map_pack_rank}` : r.map_pack_appeared ? "Not in top 3" : "No pack"}
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
      <div style={{ background: B.oxford, padding: "0 32px", height: 58, display: "flex", alignItems: "center", justifyContent: "space-between", position: "relative" }}>
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
          <button onClick={() => setSettingsOpen(true)} style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 20, padding: "4px 14px", fontFamily: "'Josefin Sans',sans-serif", fontSize: 11, color: "white", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            <span>⚙</span> Edit
          </button>
        </div>
      </div>

      <div style={{ padding: "24px 32px" }}>
        <div style={{ display: "flex", gap: 0, marginBottom: 22, borderBottom: `2px solid #e0e0e0`, background: "white", borderRadius: "10px 10px 0 0", overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.05)" }}>
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{ flex: 1, padding: "13px 0", border: "none", borderBottom: tab === t.id ? `3px solid ${B.caribbean}` : "3px solid transparent", background: "transparent", color: tab === t.id ? B.caribbean : "#888", fontFamily: "'Josefin Sans',sans-serif", fontSize: 13, fontWeight: tab === t.id ? 400 : 300, cursor: "pointer", marginBottom: -2, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, transition: "all 0.14s" }}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === "llm" && <LLMTab property={property} onUpdateProperty={updateActive} />}
        {tab === "seo" && <SEOTab property={property} />}
        {tab === "content" && <ContentTab property={property} />}
      </div>

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
