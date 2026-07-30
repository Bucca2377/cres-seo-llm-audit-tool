"use client";

import { useEffect, useState } from "react";
import {
  useRoster,
  buildSystemPrompt,
  buildPropContext,
  callAI,
  callSerp,
  callFetch,
  isStructuredRecs,
  type Property,
  type AuditRecommendations,
  type RecommendationCard,
  type RecommendationPriority,
  type SetAsideRec,
  type PageSeo,
  type TechnicalSeoResult,
  type SeoRankSnapshot,
  type CitationResult,
  type PageSpeedResult,
  type MarketingAuditResult,
  type MarketingStatus,
  type MarketingConsistencyRow,
  type PhoneInventory,
  type PhoneNumberEntry,
  type ReviewAuditResult,
  type ReviewPeriod,
  type ReviewSnapshot,
  type ReviewSentimentRow,
  type ReviewItem,
  type ReviewResponseGap,
  type ReviewResponseQualityFlag,
} from "@/lib/property";
import { detectWebsiteSpecial, recommendsGooglePhotos, dropDeadDialedNumbers } from "@/lib/detectors";
import { buildLocalReviewComparison, selfReviewPosition, type ReviewEntry } from "@/lib/review-rank";
import { extractAutocompleteSuggestions, finalizeQuerySet, bedroomGeoQueries, amenityGeoQueries, searchUnitWord, isSalesIntent, isOffProfileQuery } from "@/lib/seo-queries";
import { allFindingCards } from "@/lib/coverage";
import { parseWeekHours, reconcileOfficeHours } from "@/lib/hours";
import { detectWebsiteFeatures } from "@/lib/website-features";
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

/**
 * Condensed CRES company playbooks (Resident Reviews P&P, Leasing Lead
 * Nurturing, Sales Process Best Practices). Injected into audit prompts so
 * that recommendations touching reviews, lead follow-up, or the tour/sales
 * process cite the ACTUAL CRES tactic by name instead of generic advice.
 */
const CRES_PLAYBOOK = `CRES COMPANY PLAYBOOK — when a recommendation concerns RESIDENT REVIEWS, LEAD NURTURING, or the TOUR / SALES PROCESS, ground it in these real CRES policies and describe the specific tactic. Do not invent generic advice when a CRES policy already covers it.

CRITICAL — describe these as plain actions, NOT as branded programs. Do NOT fabricate official-sounding names like "CRES text-message review protocol", "the CRES review program", or "the CRES lead nurturing system" — those are not real. The ONLY proper-noun program below is "Hug a Building". Everything else is a practice you describe in plain words: write "text residents a direct Google review link after a positive interaction", NOT "deploy the CRES text-message review protocol".

RESIDENT REVIEWS (CRES Resident Reviews P&P):
- Ask ONLY at peak-satisfaction moments, texting the SPECIFIC resident segment at that moment — NEVER blast a review link to all residents. The three core triggers: (1) residents who MOVED IN within the past week, (2) residents who SUCCESSFULLY RENEWED their lease within the past 30 days, and (3) residents whose WORK ORDER was COMPLETED within 24 hours of submitting. Also acceptable: application/lease signing, after resident events, and during "Hug a Building" visits. Never ask during unresolved issues, delinquency, or move-out.
- TEXT MESSAGE is the preferred channel — text a one-tap Google review link (under 60 seconds) to the residents who just hit one of those trigger moments, NOT to the whole resident list. A recommendation to "text all residents a review link" is WRONG; always scope it to the trigger segments above.
- Remove friction everywhere: framed QR code at the front desk, QR on the back of staff badges/lanyards and business cards, a "Leave Us a Review" link in email signatures, a review link embedded in the automated "work order complete" notice, QR signage in laundry/mail/elevator/clubhouse, and a persistent "Rate Your Experience" button in the resident portal.
- "Hug a Building" (≈twice/year per building): power-wash + touch-up + resident gift baskets; use the face-to-face moment to gather feedback and solicit reviews with the QR code in hand.
- Respond to EVERY review. Never ask specifically for 5 stars — ask for honest feedback. Follow up only once.
- Employee incentives — DAILY: $25 per 4-/5-star review that names a team member, paid to that employee as part of their commission bonuses. MONTHLY team bonus (split among the staff): +$150 for a month with ZERO 1-/2-star reviews; +$250 for a month with 10+ 4-/5-star reviews. Residents: you cannot pay for a positive review, but may reward ALL feedback with a small incentive (gift card / raffle).

LEAD NURTURING (CRES Leasing Lead Nurturing): Speed to lead is key. Days 1–7: call + text + email DAILY until a tour is booked or they opt out (call first, then text with a booking link, then a follow-up email). Days 8–30: all three channels every Monday. Post-tour: thank-you text + email within 1 hour; days 1–3 daily; days 4–14 every 3 days; days 15–30 weekly. Always learn where a lost lead leased and why, and log it in the CRM.

SALES PROCESS (CRES Sales Process Best Practices) — the 5-step tour close: (1) Meet at the door, (2) Collect ID, (3) Build the relationship, (4) Tour the community leading with their hot buttons, (5) Close at the desk with 2–3 options and a direct ask. Post-tour checklist: update CRM, thank-you within 1 hour, follow-up within 24 hours.`;

/* -- RECOMMENDATION CARD RENDERER ----------------------------------- */
/**
 * Visual styling for each priority tag. Background tint is intentionally
 * light so the cards stay readable when printed in greyscale.
 */
const PRIORITY_STYLES: Record<RecommendationPriority, { bg: string; fg: string; border: string }> = {
  "QUICK WIN":    { bg: "#e7f6ec", fg: "#0f7b3a", border: "#bce5c9" },
  "FOUNDATIONAL": { bg: "#feeee7", fg: "#b1410f", border: "#fcd5c4" },
  "MAP PACK":     { bg: "#e6f1f8", fg: "#1c5b8a", border: "#bcd6e8" },
  "AI VISIBILITY":{ bg: "#e3f4f5", fg: "#0e6f7a", border: "#bce2e6" },
  "STRATEGIC":    { bg: "#efeaf7", fg: "#4d2f8f", border: "#d3c4ee" },
  "CONTENT":      { bg: "#fff6e0", fg: "#9b6a08", border: "#f5deaa" },
  "LONG-TAIL":    { bg: "#eef0f3", fg: "#3d4a5c", border: "#c6cdda" },
};

function PriorityChip({ priority }: { priority: RecommendationPriority }) {
  const s = PRIORITY_STYLES[priority] || PRIORITY_STYLES["STRATEGIC"];
  return (
    <span
      style={{
        display: "inline-block",
        padding: "3px 9px",
        borderRadius: 4,
        background: s.bg,
        color: s.fg,
        border: `1px solid ${s.border}`,
        fontFamily: "'Barlow Condensed',sans-serif",
        fontWeight: 700,
        fontSize: 10,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      {priority}
    </span>
  );
}

function RecCard({
  card,
  onSetAside,
}: {
  card: RecommendationCard;
  /** When provided, renders a "Set aside" control that reports the chosen reason. */
  onSetAside?: (card: RecommendationCard, reason: string) => void;
}) {
  const [choosing, setChoosing] = useState(false);
  // Combine the action + rationale into one short paragraph. Keeps a space
  // between them and avoids a doubled period when `what` already ends in one.
  const body = [card.what?.trim(), card.why?.trim()].filter(Boolean).join(" ");
  const footer = [card.effort?.trim(), card.success?.trim()].filter(Boolean).join("  ·  ");
  return (
    <div
      style={{
        background: "white",
        border: "1px solid #e6e9ec",
        borderRadius: 8,
        padding: "14px 18px",
        marginBottom: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 7 }}>
        <PriorityChip priority={card.priority} />
        <div
          style={{
            fontFamily: "'Barlow Condensed',sans-serif",
            fontWeight: 700,
            fontSize: 16,
            color: B.oxford,
            letterSpacing: "0.02em",
            flex: 1,
            lineHeight: 1.25,
          }}
        >
          {card.title}
        </div>
        {onSetAside && (
          <button
            onClick={() => setChoosing((v) => !v)}
            title="Set this recommendation aside if it isn't feasible or worth it"
            style={{
              flexShrink: 0,
              background: "transparent",
              border: "1px solid #d4d8dd",
              borderRadius: 20,
              padding: "2px 10px",
              fontFamily: "'Josefin Sans',sans-serif",
              fontSize: 11,
              color: choosing ? B.tangelo : "#8a909a",
              cursor: "pointer",
            }}
          >
            {choosing ? "Cancel" : "Set aside"}
          </button>
        )}
      </div>
      {choosing && onSetAside && (
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
          <span style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 11.5, color: "#8a909a" }}>
            Reason:
          </span>
          {SET_ASIDE_REASONS.map((r) => (
            <button
              key={r}
              onClick={() => {
                onSetAside(card, r);
                setChoosing(false);
              }}
              style={{
                background: "#faf5ee",
                border: "1px solid #e6d9c6",
                borderRadius: 20,
                padding: "3px 12px",
                fontFamily: "'Josefin Sans',sans-serif",
                fontSize: 11.5,
                color: B.oxford,
                cursor: "pointer",
              }}
            >
              {r}
            </button>
          ))}
        </div>
      )}
      <div
        style={{
          fontFamily: "'Josefin Sans',sans-serif",
          fontSize: 13,
          color: "#2a2a2a",
          lineHeight: 1.6,
        }}
      >
        {body}
      </div>
      {footer && (
        <div
          style={{
            fontFamily: "'Josefin Sans',sans-serif",
            fontSize: 11.5,
            color: "#8a909a",
            marginTop: 9,
            paddingTop: 8,
            borderTop: "1px solid #f0f2f4",
          }}
        >
          {footer}
        </div>
      )}
    </div>
  );
}

/**
 * Renders an audit's recommendations. Accepts the new structured array
 * format OR the legacy plain-text fallback. The legacy fallback renders
 * exactly as the old UI did, so existing persisted audits keep working.
 */
/**
 * Extract structured recommendation cards from a model response. Robust to
 * (a) ```json code fences, and (b) TRUNCATED output (e.g. the token budget was
 * hit mid-array): rather than throwing and dumping raw JSON to the UI, it
 * recovers every complete card object and drops a trailing incomplete one.
 * Returns [] if nothing usable is found — never a raw string.
 */
function parseRecCards(rawText: string): RecommendationCard[] {
  const text = (rawText || "").trim();
  if (!text) return [];
  // 1. Happy path: parse the whole { "recommendations": [...] } object.
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      const parsed = JSON.parse(objMatch[0]) as { recommendations?: unknown };
      if (isStructuredRecs(parsed.recommendations as AuditRecommendations)) {
        return parsed.recommendations as RecommendationCard[];
      }
    } catch {
      /* truncated or malformed — recover individual cards below */
    }
  }
  // 2. Recovery: each card is a flat object (its string values contain no
  //    literal braces), so match complete {...} blocks that carry a "title".
  //    A truncated final card has no closing brace and is simply skipped.
  const cards: RecommendationCard[] = [];
  const cardRe = /\{[^{}]*"title"[^{}]*\}/g;
  let m: RegExpExecArray | null;
  while ((m = cardRe.exec(text))) {
    try {
      const c = JSON.parse(m[0]) as RecommendationCard;
      if (c && typeof c.title === "string") cards.push(c);
    } catch {
      /* skip an unparseable fragment */
    }
  }
  return cards;
}

/**
 * Collapsed recap of recommendations the user has set aside. Shows the title,
 * the reason, and a Restore control so a set-aside item can be brought back.
 */
function SetAsideRecap({
  items,
  onRestore,
}: {
  items: SetAsideRec[];
  onRestore?: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  return (
    <div
      style={{
        marginTop: 14,
        border: "1px dashed #d4d8dd",
        borderRadius: 8,
        padding: "10px 14px",
        background: "#fafbfc",
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          background: "transparent",
          border: "none",
          padding: 0,
          fontFamily: "'Barlow Condensed',sans-serif",
          fontWeight: 700,
          fontSize: 13,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: "#8a909a",
          cursor: "pointer",
        }}
      >
        {open ? "▾" : "▸"} Considered &amp; Set Aside ({items.length})
      </button>
      {open && (
        <div style={{ marginTop: 10 }}>
          {items.map((s) => (
            <div
              key={s.key}
              style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 7 }}
            >
              <span
                style={{
                  fontFamily: "'Josefin Sans',sans-serif",
                  fontSize: 13,
                  color: "#8a909a",
                  textDecoration: "line-through",
                  flex: 1,
                  lineHeight: 1.4,
                }}
              >
                {s.title}
              </span>
              <span
                style={{
                  flexShrink: 0,
                  fontFamily: "'Josefin Sans',sans-serif",
                  fontSize: 11,
                  color: "#8a909a",
                  background: "#eef0f2",
                  borderRadius: 20,
                  padding: "2px 10px",
                }}
              >
                {s.reason}
              </span>
              {onRestore && (
                <button
                  onClick={() => onRestore(s.key)}
                  title="Bring this recommendation back into the active list"
                  style={{
                    flexShrink: 0,
                    background: "transparent",
                    border: "1px solid #d4d8dd",
                    borderRadius: 20,
                    padding: "2px 10px",
                    fontFamily: "'Josefin Sans',sans-serif",
                    fontSize: 11,
                    color: B.caribbean,
                    cursor: "pointer",
                  }}
                >
                  Restore
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RecommendationsBlock({
  recs,
  setAsideList,
  audit,
  onSetAside,
  onRestore,
}: {
  recs: AuditRecommendations | null | undefined;
  /** The property's full set-aside list (used to filter + build the recap). */
  setAsideList?: SetAsideRec[];
  /** Which audit this block belongs to; scopes the recap to that audit. */
  audit?: "marketing" | "seo";
  onSetAside?: (card: RecommendationCard, reason: string) => void;
  onRestore?: (key: string) => void;
}) {
  if (!recs) return null;
  if (isStructuredRecs(recs)) {
    const keys = new Set((setAsideList ?? []).map((s) => s.key));
    const active = recs.filter((c) => !isSetAside(c, keys));
    const recap = (setAsideList ?? []).filter((s) => !audit || s.audit === audit);
    return (
      <div>
        {active.map((card, i) => (
          <RecCard key={i} card={card} onSetAside={onSetAside} />
        ))}
        {active.length === 0 && recap.length > 0 && (
          <p style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 13, color: "#8a909a", fontStyle: "italic" }}>
            All recommendations from this audit have been set aside.
          </p>
        )}
        <SetAsideRecap items={recap} onRestore={onRestore} />
      </div>
    );
  }
  // Legacy string format — render with whitespace preserved.
  return (
    <div
      style={{
        fontFamily: "'Josefin Sans',sans-serif",
        fontSize: 13,
        lineHeight: 1.75,
        color: "#2a2a2a",
        whiteSpace: "pre-wrap",
      }}
    >
      {recs}
    </div>
  );
}

const SUGGESTED_QUERIES_DEFAULT = [
  "luxury apartments near brickell miami",
  "pet friendly apartments miami under $3000",
  "2 bedroom apartments miami with rooftop pool",
  "best apartments miami walkable to metro",
];

/* -- PRIMITIVES ----------------------------------------------------- */
function KPI({ label, value, sub, accent, live, trend }: { label: string; value: React.ReactNode; sub?: React.ReactNode; accent?: string; live?: boolean; trend?: number }) {
  return (
    <div style={{ background: "white", borderRadius: 10, padding: "18px 22px", borderTop: `4px solid ${accent || B.caribbean}`, boxShadow: "0 1px 6px rgba(0,0,0,0.07)", flex: 1, minWidth: 140, position: "relative", textAlign: "center" }}>
      {live && <span style={{ position: "absolute", top: 10, right: 12, width: 7, height: 7, background: "#22c55e", borderRadius: "50%", display: "inline-block", boxShadow: "0 0 0 2px rgba(34,197,94,0.3)", animation: "lp 2s infinite" }} />}
      <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 11, fontWeight: 300, color: "#999", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 30, fontWeight: 700, color: B.oxford, lineHeight: 1 }}>{value}</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 4 }}>
        {sub && <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 11, color: "#aaa" }}>{sub}</div>}
        {typeof trend === "number" && <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 11, color: trend > 0 ? "#22c55e" : B.tangelo, fontWeight: 400 }}>{trend > 0 ? "▲" : "▼"} {Math.abs(trend)}%</div>}
      </div>
    </div>
  );
}

/**
 * Accent color for an average-rank tile that reflects BOTH rank quality AND
 * coverage. A great average across only a couple of queries (e.g. #7 on 2 of 6)
 * shouldn't read green — being absent from most competitive searches is the
 * bigger story. Returns the MORE severe of the rank-based and coverage-based
 * color so the tile can't look healthy while the property is mostly invisible.
 */
function coverageRankAccent(avg: number | null, ranking: number, total: number, good = 10, ok = 30): string {
  if (!avg || !total) return B.tangelo;
  const cov = ranking / total;
  const rankSev = avg <= good ? 0 : avg <= ok ? 1 : 2;
  const covSev = cov >= 0.6 ? 0 : cov >= 0.3 ? 1 : 2;
  const sev = Math.max(rankSev, covSev);
  return sev === 0 ? "#22c55e" : sev === 1 ? "#f59e0b" : B.tangelo;
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
  map_pack_competitors: { name: string; rating: number | null; reviews: number | null }[];
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
  map_pack_competitors: [],
  diagnosis: "",
};

/**
 * Extract "City, ST, United States" from any of these address shapes:
 *   "1096 N Khione Loop, Salisbury, MD 21804"   (two commas, ideal)
 *   "1096 N Khione Loop Salisbury, MD 21804"    (one comma, common typo)
 *   "Salisbury, MD"                              (city + state only)
 *   "Salisbury MD 21804"                         (no commas at all)
 *
 * The previous implementation only handled the two-comma form correctly;
 * a single-comma address would send "1096 N Khione Loop Salisbury, MD"
 * to SerpAPI as the location, which SerpAPI rejects (not in its location
 * DB) and falls back to a non-localized search — producing wrong results.
 */
function extractLocation(address: string): string {
  if (!address || typeof address !== "string") return "";
  // Last segment after the final comma is expected to contain "ST" + optional ZIP.
  // The segment(s) before it contain the city (and possibly the street).
  const stateZipMatch = address.match(/,?\s*([A-Z]{2})\s*\d{0,5}\s*$/);
  if (!stateZipMatch) return address;
  const state = stateZipMatch[1];
  const beforeState = address.slice(0, stateZipMatch.index).replace(/,\s*$/, "").trim();
  if (!beforeState) return `${state}, United States`;

  // If the remainder still has commas, the last comma-segment is the city.
  if (beforeState.includes(",")) {
    const parts = beforeState.split(",").map((s) => s.trim()).filter(Boolean);
    const city = parts[parts.length - 1];
    return `${city}, ${state}, United States`;
  }

  // Otherwise we have "Street Number Street Name CityWord(s)" all jammed together.
  // Heuristic: the city is the trailing word(s) that aren't a street-type token.
  // Pull the last 1-3 tokens and treat them as the city, skipping common street suffixes.
  const tokens = beforeState.split(/\s+/);
  const STREET_TOKENS = new Set([
    "st", "street", "rd", "road", "ave", "avenue", "blvd", "boulevard",
    "ln", "lane", "dr", "drive", "loop", "ct", "court", "cir", "circle",
    "pkwy", "parkway", "way", "ter", "terrace", "pl", "place", "hwy", "highway",
    "n", "s", "e", "w", "north", "south", "east", "west", "ne", "nw", "se", "sw",
  ]);
  // Walk backwards collecting up to 3 trailing non-street tokens.
  const cityTokens: string[] = [];
  for (let i = tokens.length - 1; i >= 0 && cityTokens.length < 3; i--) {
    const t = tokens[i];
    const tl = t.toLowerCase().replace(/[.,]/g, "");
    if (STREET_TOKENS.has(tl) || /^\d/.test(t)) break;
    cityTokens.unshift(t);
  }
  const city = cityTokens.join(" ") || tokens[tokens.length - 1] || "";
  return city ? `${city}, ${state}, United States` : `${state}, United States`;
}

/**
 * Normalize any URL or domain-ish string into a bare lowercase hostname.
 * "https://www.villageatsnowfield.com/floor-plans" → "villageatsnowfield.com"
 * "www.VillageAtSnowfield.com" → "villageatsnowfield.com"
 * "villageatsnowfield.com" → "villageatsnowfield.com"
 * Returns empty string if it can't extract anything useful.
 */
function normalizeDomain(input: string | undefined | null): string {
  if (!input || typeof input !== "string") return "";
  let s = input.trim().toLowerCase();
  if (!s) return "";
  // Strip protocol
  s = s.replace(/^https?:\/\//, "");
  // Strip everything from the first slash, query, or hash onward
  s = s.split(/[/?#]/)[0];
  // Strip leading www.
  s = s.replace(/^www\./, "");
  // Strip trailing dots, ports
  s = s.replace(/:\d+$/, "").replace(/\.+$/, "");
  // Must contain at least one dot to be a real domain
  if (!s.includes(".")) return "";
  return s;
}

/**
 * Try to pull the GBP "data_id" (the long hex CID) out of a Google Maps URL.
 * Used to lock GBP identity when a property record has a gbpUrl set.
 * Example URL fragments to handle:
 *   /maps/place/.../data=!4m...!3m...!1s0x89c4595d...   (data_id after !1s)
 *   /maps?cid=12345678901234567890                       (cid → data_id is "0x0:0xABC..." form)
 *   /maps/place/.../@lat,lon,zoom/...
 * We only need a STABLE identifier we can compare against SerpAPI's
 * `place_id` / `data_id` / `cid` fields. Returns lowercase string or "".
 */
function extractGbpIdFromUrl(url: string | undefined | null): string {
  if (!url || typeof url !== "string") return "";
  const u = url.trim().toLowerCase();
  if (!u) return "";
  // !1s0x... form (most stable — this is the data_id SerpAPI also returns)
  const dataIdMatch = u.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/);
  if (dataIdMatch) return dataIdMatch[1];
  // ?cid= form
  const cidMatch = u.match(/[?&]cid=(\d+)/);
  if (cidMatch) return `cid:${cidMatch[1]}`;
  // /place/<name>/ form — extract the slug as a last-resort identifier
  const slugMatch = u.match(/\/place\/([^/]+)/);
  if (slugMatch) {
    const slug = decodeURIComponent(slugMatch[1]).toLowerCase();
    return `slug:${slug}`;
  }
  return "";
}

function nameMatches(haystack: string, needle: string): boolean {
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  if (h.includes(n)) return true;
  // also try without common suffixes/prefixes
  const stripped = n.replace(/\b(apartments?|the|lofts?)\b/g, "").trim();
  if (stripped.length > 3 && h.includes(stripped)) return true;
  // also try with all whitespace removed — handles "Saw Mill" vs "Sawmill" and similar
  const hNoSpace = h.replace(/[\s\-]/g, "");
  const nNoSpace = n.replace(/[\s\-]/g, "");
  if (nNoSpace.length > 3 && hNoSpace.includes(nNoSpace)) return true;
  const strippedNoSpace = stripped.replace(/[\s\-]/g, "");
  if (strippedNoSpace.length > 3 && hNoSpace.includes(strippedNoSpace)) return true;
  return false;
}

interface GBPGroundTruth {
  source: "knowledge_graph" | "local_results" | "place_results";
  name: string;
  address: string;
  rating: number | null;
  reviewCount: number | null;
  unclaimed: boolean;
  phone: string;
  website: string;
  hasHours: boolean;
  // Deterministic identifiers — used to build a gbpUrl for auto-capture
  // and to lock property identity on subsequent audits.
  dataId: string;
  placeId: string;
}

/**
 * Pull the property's GBP from a SerpAPI response. Match strategy (in order):
 *   1. property.gbpUrl matches the result's data_id / place_id / slug → DEFINITIVE
 *   2. property.website matches the result's website domain → STRONG
 *   3. Property name fuzzy-matches the result's title + address → FALLBACK
 *
 * The first two are deterministic. Falling all the way through to name
 * matching is how you get "Village Pizzeria" mis-identified as
 * "Village at Snowfield". Setting website + gbpUrl on the Property record
 * eliminates that class of failure.
 */
function extractGBP(data: any, property: Property): GBPGroundTruth | null {
  const propertyName = property.name;
  const targetDomain = normalizeDomain(property.website);
  const targetGbpId = extractGbpIdFromUrl(property.gbpUrl);

  const matchesProperty = (
    candidateName: string,
    candidateAddress: string,
    candidateWebsite: string | undefined,
    candidateDataId: string | undefined,
    candidatePlaceId: string | undefined
  ): "gbp" | "website" | "name" | null => {
    // 1. GBP-id match (most reliable)
    if (targetGbpId) {
      const candId = (candidateDataId || candidatePlaceId || "").toLowerCase();
      if (candId && targetGbpId === candId) return "gbp";
      // Slug-form fallback: if user pasted a /place/<slug>/ URL and SerpAPI
      // returned no data_id, the candidateName likely contains the same slug.
      if (targetGbpId.startsWith("slug:")) {
        const slug = targetGbpId.slice(5).replace(/[-_+]/g, " ");
        if (slug && candidateName.toLowerCase().includes(slug)) return "gbp";
      }
    }
    // 2. Website-domain match (very reliable for branded properties)
    if (targetDomain) {
      const candDomain = normalizeDomain(candidateWebsite);
      if (candDomain && (candDomain === targetDomain || candDomain.endsWith("." + targetDomain) || targetDomain.endsWith("." + candDomain))) {
        return "website";
      }
    }
    // 3. Name fuzzy match (last resort), gated on address sanity check.
    // Without this gate, "Cambridge Health & Wellness" gets accepted as
    // "Cambridge Apartments" because both contain the word "Cambridge".
    if (nameMatches(`${candidateName} ${candidateAddress}`, propertyName)) {
      if (candidateAddress && !addressShallowMatch(property.address, candidateAddress)) {
        return null;
      }
      return "name";
    }
    return null;
  };

  const kg = data?.knowledge_graph;
  if (kg && kg.title) {
    const m = matchesProperty(
      kg.title,
      kg.address || "",
      kg.website,
      kg.data_id,
      kg.place_id
    );
    if (m) {
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
        dataId: kg.data_id || "",
        placeId: kg.place_id || "",
      };
    }
  }

  // google_maps returns a singular `place_results` object (not a
  // `local_results` array) when the query resolves to exactly one place —
  // which is the common case for a precise property name. This is where the
  // RELIABLE rating + review count + data_id live; the google engine's
  // knowledge_graph often omits them. Missing this object is what made
  // properties with hundreds of reviews report "0 reviews".
  const place = data?.place_results;
  if (place && (place.title || place.name)) {
    const m = matchesProperty(
      place.title || place.name || "",
      place.address || "",
      place.website,
      place.data_id,
      place.place_id
    );
    if (m) {
      return {
        source: "place_results",
        name: place.title || place.name,
        address: place.address || "",
        rating: typeof place.rating === "number" ? place.rating : null,
        reviewCount:
          typeof place.reviews === "number"
            ? place.reviews
            : typeof place.review_count === "number"
            ? place.review_count
            : null,
        unclaimed: place.unclaimed_listing === true,
        phone: place.phone || "",
        website: place.website || "",
        hasHours: !!(place.hours || place.operating_hours),
        dataId: place.data_id || "",
        placeId: place.place_id || "",
      };
    }
  }

  const local = Array.isArray(data?.local_results)
    ? data.local_results
    : Array.isArray(data?.local_results?.places)
    ? data.local_results.places
    : [];
  // When we have a deterministic identifier, scan all local results, not just top 3
  const scanLimit = targetGbpId || targetDomain ? local.length : Math.min(3, local.length);
  for (let i = 0; i < scanLimit; i++) {
    const b = local[i];
    const m = matchesProperty(
      b.title || b.name || "",
      b.address || "",
      b.website,
      b.data_id,
      b.place_id
    );
    if (m) {
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
        dataId: b.data_id || "",
        placeId: b.place_id || "",
      };
    }
  }
  return null;
}

/**
 * The ILS / aggregator platforms that matter for apartment listing presence.
 * `domain` is matched against organic result hostnames; `label` is shown to
 * the property manager.
 */
const ILS_PLATFORMS: { domain: string; label: string }[] = [
  { domain: "apartments.com", label: "Apartments.com" },
  { domain: "zillow.com", label: "Zillow" },
  { domain: "rent.com", label: "Rent.com" },
  { domain: "apartmentfinder.com", label: "Apartment Finder" },
  { domain: "apartmentguide.com", label: "ApartmentGuide" },
  { domain: "apartmentratings.com", label: "ApartmentRatings" },
  { domain: "realtor.com", label: "Realtor.com" },
  { domain: "redfin.com", label: "Redfin" },
  { domain: "trulia.com", label: "Trulia" },
  { domain: "hotpads.com", label: "HotPads" },
  { domain: "rentcafe.com", label: "RentCafe" },
  { domain: "forrent.com", label: "ForRent" },
];

/**
 * Aggregator / ILS domains. Used by diagnose() and by the organic-column label to
 * explain WHY the property's own site isn't in organic: when the top organic results
 * are mostly these, "aggregators dominate" is the honest reason (a single property
 * essentially can't out-rank Apartments.com/Zillow for a head term). When they're
 * NOT — e.g. individual competing communities out-rank it — we don't claim aggregator
 * dominance; "who's beating you" already shows who.
 */
const AGGREGATOR_DOMAINS = [
  "apartments.com", "zillow.com", "rent.com", "apartmentfinder.com", "apartmentguide.com",
  "apartmentratings.com", "realtor.com", "redfin.com", "trulia.com", "hotpads.com", "rentcafe.com",
  "forrent.com", "zumper.com", "apartmentlist.com", "apartmenthomeliving.com", "homes.com",
  "padmapper.com", "rentals.com",
];
function aggregatorsDominateOrganic(topOrganic: { name: string; domain: string }[] | undefined): boolean {
  const top = (topOrganic || []).slice(0, 5);
  if (!top.length) return false;
  const agg = top.filter((o) => {
    const d = (o.domain || "").toLowerCase().replace(/^www\./, "");
    return AGGREGATOR_DOMAINS.some((a) => d === a || d.endsWith("." + a));
  }).length;
  return agg >= Math.ceil(top.length / 2); // a majority of the visible organic results are aggregators
}
/** Organic-column label when the property's own site isn't in the top 30. When the
 *  listing sites own the head term (the norm, so NOT a failure), say so plainly for a
 *  client instead of a scary "not in top 30". */
function organicAbsentLabel(topOrganic: { name: string; domain: string }[] | undefined): string {
  return aggregatorsDominateOrganic(topOrganic)
    ? "Listing sites own this (normal)"
    : "Not in organic top 30";
}

/**
 * Scan a `google` engine SerpAPI response's organic results for ILS /
 * aggregator listings that actually reference THIS property. Returns the
 * de-duplicated platform labels found.
 *
 * This is the authoritative answer to "is the property listed on the major
 * rental platforms?" — the LLM's own web search is unreliable for it (it
 * reported "no presence" for a property listed on six platforms), but the
 * SerpAPI organic results show every listing plainly.
 */
function extractListingPlatforms(data: any, property: Property): string[] {
  const org: any[] = Array.isArray(data?.organic_results) ? data.organic_results : [];
  const found: string[] = [];
  for (const r of org) {
    const dom = normalizeDomain(r.link || "");
    if (!dom) continue;
    const platform = ILS_PLATFORMS.find(
      (p) => dom === p.domain || dom.endsWith("." + p.domain)
    );
    if (!platform || found.includes(platform.label)) continue;
    // Verify the result is about THIS property, not just any listing on the
    // platform — the property name must appear in the title/snippet/link.
    const hay = `${r.title || ""} ${r.snippet || ""} ${r.link || ""}`;
    if (nameMatches(hay, property.name)) {
      found.push(platform.label);
    }
  }
  return found;
}

/**
 * Find the property's SPECIFIC Apartments.com listing URL from Google organic
 * results (e.g. https://www.apartments.com/six-cord-st-louis-mo/l3e6syg/).
 * Distinguishes a real listing from a city/search page by requiring a short
 * alphanumeric listing-ID segment in the path (e.g. "l3e6syg"), which city
 * pages ("/st-louis-mo/pet-friendly/") never have. Verifies the result is
 * about THIS property via name match. Returns "" if none found.
 */
function findApartmentsUrl(data: any, property: Property): string {
  const org: any[] = Array.isArray(data?.organic_results) ? data.organic_results : [];
  for (const r of org) {
    const link: string = r.link || "";
    const dom = normalizeDomain(link);
    if (dom !== "apartments.com" && !dom.endsWith(".apartments.com")) continue;
    let segs: string[] = [];
    try {
      segs = new URL(link).pathname.split("/").filter(Boolean);
    } catch {
      continue;
    }
    // A specific listing has a short id segment (letters+digits, no hyphens).
    const hasListingId = segs.some((s) => /^[a-z0-9]{6,10}$/i.test(s) && /\d/.test(s));
    if (segs.length < 2 || !hasListingId) continue;
    const hay = `${r.title || ""} ${r.snippet || ""} ${link}`;
    if (nameMatches(hay, property.name)) return link.split("?")[0].split("#")[0];
  }
  return "";
}

/**
 * Compute a website + gbpUrl patch for a property based on what we found
 * via GBP detection. Only suggests values for fields that aren't already
 * set on the property — never overwrites user-set values.
 *
 * Returns an empty object if there's nothing to enrich.
 */
function computeEnrichment(
  property: Property,
  gbp: GBPGroundTruth | null,
  apartmentsUrl?: string,
  overwrite?: boolean
): Partial<Pick<Property, "website" | "gbpUrl" | "apartmentsUrl">> {
  const patch: Partial<Pick<Property, "website" | "gbpUrl" | "apartmentsUrl">> = {};

  // Apartments.com listing URL: fill if we found a real one and either the
  // field is empty or we're overwriting.
  if (apartmentsUrl && (overwrite || !(property.apartmentsUrl || "").trim())) {
    patch.apartmentsUrl = apartmentsUrl;
  }

  if (!gbp) return patch;

  // Website: fill from SerpAPI if empty, or replace when overwriting.
  if (gbp.website && (overwrite || !normalizeDomain(property.website))) {
    patch.website = gbp.website;
  }

  // GBP URL: fill/replace if we have a stable identifier to build one.
  if ((gbp.dataId || gbp.placeId) && (overwrite || !extractGbpIdFromUrl(property.gbpUrl))) {
    // SerpAPI's data_id / place_id is the canonical Google Maps identifier;
    // we use a query URL form because we don't always have the slug.
    patch.gbpUrl = `https://www.google.com/maps/place/?q=place_id:${gbp.placeId || gbp.dataId}`;
  }

  return patch;
}

/**
 * Tokens that, when present in a property name, indicate the name already
 * scopes itself to a multifamily property. When NONE of these appear,
 * appending "apartments" to the SerpAPI query dramatically improves
 * GBP detection for generic-name properties like "Cambridge", "Reserve",
 * "The Edge", etc.
 */
const APARTMENT_TYPE_TOKENS = [
  "apartments", "apartment", "apts", "apt",
  "lofts", "loft",
  "townhomes", "townhome", "townhouses", "townhouse",
  "residences", "residence",
  "flats", "suites", "studios",
];

function hasApartmentToken(name: string): boolean {
  const lower = name.toLowerCase();
  return APARTMENT_TYPE_TOKENS.some((t) => new RegExp(`\\b${t}\\b`).test(lower));
}

/**
 * Build the SerpAPI search query used to find a property's GBP. If the
 * property name already contains an apartment-type token, the query is
 * just `{name} {city}`. Otherwise we inject " apartments" so Google
 * disambiguates the search from same-name businesses in other categories.
 *
 * Examples:
 *   "Cambridge"            in Clarksville → "Cambridge apartments Clarksville"
 *   "Cambridge Apartments" in Clarksville → "Cambridge Apartments Clarksville"
 *   "Vangard Lofts"        in Milford     → "Vangard Lofts Milford"
 *   "Reserve at Sawmill"   in Columbus    → "Reserve at Sawmill apartments Columbus"
 */
function buildGbpSearchQuery(property: Property): string {
  const city = extractCity(property.address);
  const suffix = hasApartmentToken(property.name) ? "" : " apartments";
  return `${property.name}${suffix}${city ? " " + city : ""}`.trim();
}

/**
 * Run a single-shot SerpAPI search for a property, extract GBP, and return
 * the recommended enrichment patch (website + gbpUrl). Used by the batch
 * enrichment flow. Returns null on failure or if no GBP found.
 */
async function enrichPropertyFromSerp(
  property: Property,
  overwrite?: boolean
): Promise<{ patch: Partial<Pick<Property, "website" | "gbpUrl" | "apartmentsUrl">>; gbp: GBPGroundTruth | null } | null> {
  try {
    const query = buildGbpSearchQuery(property);
    // google_maps engine — see the audit pre-flight note: it returns the
    // real listing data (rating, review count, data_id) that the default
    // google engine's knowledge_graph omits for apartment communities.
    const data = await callSerp({
      query,
      engine: "google_maps",
      location: extractLocation(property.address),
    });
    const gbp = extractGBP(data, property);

    // Apartments.com listing URL — a separate google (organic) search, since
    // the google_maps engine returns places, not organic ILS links. Only run
    // it when the property doesn't already have an Apartments.com URL.
    let apartmentsUrl = "";
    if (overwrite || !(property.apartmentsUrl || "").trim()) {
      try {
        const listingData = await callSerp({
          query: `${property.name} ${extractCity(property.address)}`.trim(),
          engine: "google",
          location: extractLocation(property.address),
        });
        apartmentsUrl = findApartmentsUrl(listingData, property);
      } catch {
        /* best-effort — apts.com is optional */
      }
    }

    if (!gbp && !apartmentsUrl) return null;
    const patch = computeEnrichment(property, gbp, apartmentsUrl, overwrite);
    return { patch, gbp };
  } catch {
    return null;
  }
}

/**
 * Pull just the "City" segment out of an address using the same robust
 * parser as extractLocation. Used for forming SerpAPI search queries.
 */
function extractCity(address: string): string {
  const loc = extractLocation(address);
  if (!loc) return "";
  // extractLocation returns "City, ST, United States"; pull just the city.
  const parts = loc.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts[0] : "";
}

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
    } To reach the 3-pack, prioritize a complete Google listing, a steady flow of new reviews, and matching name/address/phone across listing sites.`;
  }
  // Not in Map Pack at all but has organic
  if (organicRank && organicRank <= 10) {
    return `Page 1 organic (#${organicRank}) but missing from Map Pack entirely — likely a Google listing gap or mismatched name/address/phone across listing sites suppressing local visibility.`;
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

/**
 * Sanity check that two addresses refer to roughly the same physical place.
 * Used to reject name-only matches where the candidate is in a different
 * city / different state (e.g. "Cambridge" the property in Clarksville, IN
 * vs. "Cambridge" the unrelated business in Cambridge, MA).
 *
 * Returns true if:
 *   - Same leading street number (very strong signal), OR
 *   - Same parsed "City, ST" location, OR
 *   - Same city alone (fallback for SerpAPI results that omit state)
 *
 * Returns false only when both addresses are usable AND none of the above
 * match. When the candidate address is empty (organic results, knowledge
 * panels without an address), returns true — we can't verify, so we don't
 * reject.
 */
/**
 * Pull a US state code from an address. Prefers the two-letter code that sits
 * immediately before a 5-digit ZIP ("Salisbury, MD 21804" → "MD"); falls back
 * to a standalone two-letter token in the normalized location string.
 */
function parseStateCode(address: string): string {
  const zipMatch = address.match(/\b([A-Za-z]{2})\s+\d{5}\b/);
  if (zipMatch) return zipMatch[1].toUpperCase();
  const loc = extractLocation(address);
  const tok = loc
    .split(",")
    .map((s) => s.trim())
    .find((s) => /^[A-Za-z]{2}$/.test(s));
  return tok ? tok.toUpperCase() : "";
}

function addressShallowMatch(propertyAddress: string, candidateAddress: string): boolean {
  if (!candidateAddress) return true; // can't verify, don't reject
  const propStreetNum = (propertyAddress.match(/\b(\d{2,6})\b/) || [])[1];
  const candStreetNum = (candidateAddress.match(/\b(\d{2,6})\b/) || [])[1];
  if (propStreetNum && candStreetNum && propStreetNum === candStreetNum) return true;

  const propLoc = extractLocation(propertyAddress).toLowerCase();
  const candLoc = extractLocation(candidateAddress).toLowerCase();
  if (propLoc && candLoc && propLoc === candLoc) return true;

  // If both addresses name a state and the states differ, this is a
  // same-name property in a different state (e.g. Clarksville TN vs
  // Clarksville IN). Reject before the looser city-only check below.
  const propState = parseStateCode(propertyAddress);
  const candState = parseStateCode(candidateAddress);
  if (propState && candState && propState !== candState) return false;

  const propCity = extractCity(propertyAddress).toLowerCase();
  const candCity = extractCity(candidateAddress).toLowerCase();
  if (propCity && candCity && propCity === candCity) return true;

  return false;
}

/**
 * Match a SerpAPI result (organic or local) against the property using
 * the most reliable identifier available. Order of preference:
 *   1. gbpUrl → data_id / place_id / slug         (local results only)
 *   2. website → result link / result website     (domain comparison)
 *   3. property name fuzzy match + address sanity (last resort)
 *
 * Address sanity gating on (3) prevents the "Cambridge Health & Wellness
 * accepted as Cambridge Apartments" failure: name fuzzy matching alone
 * was the root cause of bad GBP identification for properties with
 * generic single-word names.
 *
 * Returns the match type or null.
 */
function matchPropertyToResult(
  property: Property,
  opts: {
    title?: string;
    link?: string;          // organic result URL
    website?: string;       // local result's website field
    address?: string;
    dataId?: string;
    placeId?: string;
  }
): "gbp" | "website" | "name" | null {
  const targetDomain = normalizeDomain(property.website);
  const targetGbpId = extractGbpIdFromUrl(property.gbpUrl);

  if (targetGbpId) {
    const candId = (opts.dataId || opts.placeId || "").toLowerCase();
    if (candId && candId === targetGbpId) return "gbp";
    if (targetGbpId.startsWith("slug:")) {
      const slug = targetGbpId.slice(5).replace(/[-_+]/g, " ");
      if (slug && (opts.title || "").toLowerCase().includes(slug)) return "gbp";
    }
  }

  if (targetDomain) {
    const fromLink = normalizeDomain(opts.link);
    const fromWebsite = normalizeDomain(opts.website);
    const cand = fromLink || fromWebsite;
    if (cand) {
      if (cand === targetDomain) return "website";
      // Sub/super domain (e.g. property.com vs apply.property.com)
      if (cand.endsWith("." + targetDomain) || targetDomain.endsWith("." + cand)) return "website";
    }
  }

  const haystack = `${opts.title || ""} ${opts.link || ""} ${opts.address || ""} ${opts.website || ""}`;
  if (nameMatches(haystack, property.name)) {
    // Gate the fuzzy-name fallback on address sanity. If the candidate has
    // an address and it lives in a different city/state from the property,
    // it's almost certainly the wrong entity even when the name matches.
    // Skipped when the candidate has no address (organic results) — those
    // are validated by domain-matching upstream when website is set.
    if (opts.address && !addressShallowMatch(property.address, opts.address)) {
      return null;
    }
    return "name";
  }
  return null;
}

async function fetchGoogleRank(
  property: Property,
  query: string,
  origin?: { lat: number; lng: number }
): Promise<GoogleRankResult> {
  try {
    const location = extractLocation(property.address);
    // Precise search origin (the property's own coordinates) localizes the Map Pack to
    // its exact spot instead of the city centroid, so ranks/competitors reflect the
    // immediate area. Falls back to the city `location` when we have no coordinates.
    const ll = origin ? `@${origin.lat},${origin.lng},14z` : undefined;
    const data = await callSerp({ query, location, engine: "google", ll });

    const localResults: any[] = Array.isArray(data?.local_results)
      ? data.local_results
      : Array.isArray(data?.local_results?.places)
      ? data.local_results.places
      : [];
    const organic: any[] = Array.isArray(data?.organic_results) ? data.organic_results : [];
    const kg = data?.knowledge_graph;

    // -- Map Pack matching ------------------------------------------------
    // Check knowledge_graph first (branded queries), then local_results 3-pack.
    const top3 = localResults.slice(0, 3);
    // Capture the 3-pack competitors' star ratings (present in the local_results
    // payload; we otherwise only keep their names) so the SEO audit can rank the
    // property's Google rating against its local pack.
    const mapPackCompetitors = top3
      .map((b: any) => ({
        name: b.title || b.name || "",
        rating: typeof b.rating === "number" ? b.rating : null,
        reviews:
          typeof b.reviews === "number" ? b.reviews : typeof b.review_count === "number" ? b.review_count : null,
      }))
      .filter((c: { name: string }) => c.name);
    let mapPackRank: number | null = null;
    let topMapPack: string[] = [];

    if (kg?.title) {
      const m = matchPropertyToResult(property, {
        title: kg.title,
        link: kg.website,
        website: kg.website,
        address: kg.address,
        dataId: kg.data_id,
        placeId: kg.place_id,
      });
      if (m) {
        mapPackRank = 1;
        topMapPack = [kg.title];
      }
    }
    if (mapPackRank === null) {
      top3.forEach((biz: any, idx: number) => {
        if (mapPackRank !== null) return;
        const m = matchPropertyToResult(property, {
          title: biz.title || biz.name,
          link: biz.website,
          website: biz.website,
          address: biz.address,
          dataId: biz.data_id,
          placeId: biz.place_id,
        });
        if (m) mapPackRank = idx + 1;
      });
      topMapPack = top3.map((b: any) => b.title || b.name).filter(Boolean);
      if (kg?.title && topMapPack.length === 0) topMapPack = [kg.title];
    }

    // -- Organic matching -------------------------------------------------
    let organicRank: number | null = null;
    for (const o of organic) {
      const m = matchPropertyToResult(property, {
        title: o.title,
        link: o.link,
        address: "",
        // organic doesn't have data_id/place_id
      });
      if (m) {
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

    // -- Expanded Map Pack (stage 2) -------------------------------------
    let expandedMapPackRank: number | null = null;
    if (mapPackRank === null) {
      try {
        const mapsData = await callSerp({ query, location, engine: "google_maps", ll });
        const mapsResults: any[] = Array.isArray(mapsData?.local_results)
          ? mapsData.local_results
          : [];
        const top20 = mapsResults.slice(0, 20);
        for (let idx = 0; idx < top20.length; idx++) {
          const biz = top20[idx];
          const m = matchPropertyToResult(property, {
            title: biz.title || biz.name,
            link: biz.website,
            website: biz.website,
            address: biz.address,
            dataId: biz.data_id,
            placeId: biz.place_id,
          });
          if (m) {
            expandedMapPackRank = idx + 1;
            break;
          }
        }
      } catch {
        /* expanded lookup failed; proceed without */
      }
    }

    // -- Diagnostic logging for no-match cases ---------------------------
    // When BOTH Map Pack and organic miss, log what SerpAPI actually
    // returned so a no-match audit can be debugged from devtools in 30s.
    if (mapPackRank === null && expandedMapPackRank === null && organicRank === null) {
      // Keep payload small — top 5 organic + top 3 local + kg summary.
      // eslint-disable-next-line no-console
      console.warn("[fetchGoogleRank] No match found", {
        property: {
          name: property.name,
          website: property.website || "(unset)",
          gbpUrl: property.gbpUrl || "(unset)",
          parsedDomain: normalizeDomain(property.website) || "(none)",
          parsedGbpId: extractGbpIdFromUrl(property.gbpUrl) || "(none)",
        },
        query,
        location,
        kg: kg ? { title: kg.title, website: kg.website, address: kg.address, data_id: kg.data_id } : null,
        top_local: top3.map((b: any) => ({ title: b.title || b.name, website: b.website, address: b.address, data_id: b.data_id })),
        top_organic: organic.slice(0, 5).map((o: any) => ({ title: o.title, link: o.link })),
        hint: "If the property IS in this result list, set website + gbpUrl on the property record for deterministic matching.",
      });
    }

    return {
      map_pack_appeared: top3.length > 0 || !!kg?.title,
      map_pack_rank: mapPackRank,
      expanded_map_pack_rank: expandedMapPackRank,
      top_map_pack: topMapPack,
      organic_rank: organicRank,
      organic_page: organicRank ? Math.ceil(organicRank / 10) : null,
      top_organic: topOrganic,
      map_pack_competitors: mapPackCompetitors,
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
                        ? `#${googleResult.map_pack_rank}`
                        : googleResult.expanded_map_pack_rank
                        ? `#${googleResult.expanded_map_pack_rank}`
                        : googleResult.map_pack_appeared
                        ? "Not in top 20"
                        : "—"}
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
                        : organicAbsentLabel(googleResult.top_organic)}
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

/* ================= ASK AN AI (custom free-text query tester) ====== */
// Lifted verbatim from the retired LLM Visibility tab's "Live LLM Search
// Simulator". Type any renter question, query an AI, and see how the
// property appears in AI search results today versus after optimization.
function AskAiQuestion({ property }: { property: Property }) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<any>(null);
  const [testing, setTesting] = useState(false);

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

  return (
    <div style={{ background: "white", borderRadius: 10, padding: 24, boxShadow: "0 1px 6px rgba(0,0,0,0.07)", marginBottom: 22 }}>
      <div style={{ marginBottom: 6 }}>
        <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 16, letterSpacing: "0.08em", textTransform: "uppercase", color: B.oxford }}>Ask an AI</div>
        <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 12, color: "#aaa", marginTop: 3 }}>Type any renter question to see how {property.name} appears in AI search results today versus after optimization</div>
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
  );
}

/* ================= SEO TAB ======================================== */
/**
 * For a single query's rank data, return the competitor communities ranking ahead of
 * the property IN THE LOCAL MAP PACK — the winnable local arena — dropping the property
 * itself, deduped by normalized name. Organic results are intentionally EXCLUDED: for a
 * broad category term the organic winners are listing sites and locator services, not
 * comps a single property can out-rank, so mixing them in just adds city-wide noise.
 */
function competitorsBeating(
  property: Property,
  r: { map_pack_rank: number | null; expanded_map_pack_rank?: number | null; map_pack_appeared: boolean; top_map_pack: string[]; organic_rank: number | null; top_organic: Array<{ name: string; domain: string }> }
): string[] {
  const norm = (s: string) => (s || "").toLowerCase().replace(/\b(apartments?|apartment homes?|the|lofts?|residences?|townhomes?|community|communities|at)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const isSelf = (n: string) => nameMatches(n || "", property.name);
  const inPack = !!(r.map_pack_rank && r.map_pack_rank <= 3);
  const packAll = (r.top_map_pack || []).filter((n) => !isSelf(n));
  const packBeating = inPack ? packAll.slice(0, (r.map_pack_rank as number) - 1) : packAll.slice(0, 3);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of packBeating) {
    const k = norm(n);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(n);
  }
  return out;
}

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
      <AskAiQuestion property={property} />
    </div>
  );
}

/**
 * A query is "branded / navigational" when it contains the property's own
 * name or its street — searches a stranger would never type. Ranking #1 for
 * your own name is expected and tells you nothing about competitive
 * visibility, so these are split out of the headline scorecard.
 */
function isBrandedQuery(query: string, property: Property): boolean {
  // ONLY the property NAME makes a query branded/navigational. We deliberately do
  // NOT treat the property's STREET as branded: a stranger searching "apartments
  // near East Stone Avenue" is doing a real competitive/local search, not typing
  // your brand — and street-token branding wrongly pulled those out of the
  // competitive scorecard (a street token like "stone" matched every "...Stone
  // Avenue..." query). Name-only keeps the split intuitive and matches what a
  // reader would call "your own name".
  return nameMatches(query, property.name);
}

/**
 * Compute the SEO scorecard summary (Map Pack + organic coverage, best/avg ranks,
 * branded vs competitive split, strongest query + winnable opportunity) from a
 * finished run. SINGLE SOURCE so the on-screen scorecard and the print report can't
 * drift — both call this. Competitive-only headline numbers; branded/navigational
 * queries (own name/street) are split out so a #1 for your own name can't inflate them.
 */
// Minimal rank shape this reads — satisfied by GoogleRankResult AND the print
// component's slightly looser stored variant (expanded_map_pack_rank optional).
type RankForSummary = {
  map_pack_rank: number | null;
  expanded_map_pack_rank?: number | null;
  map_pack_appeared: boolean;
  organic_rank: number | null;
  organic_page: number | null;
};
function computeSeoSummary(seo: { queries: string[]; ranks: RankForSummary[] }, property: Property) {
  const { queries, ranks } = seo;
  const branded = ranks.map((_, i) => isBrandedQuery(queries[i], property));
  const compIdx = ranks.map((_, i) => i).filter((i) => !branded[i]);
  const compRanks = compIdx.map((i) => ranks[i]);

  // Effective Map Pack position per query = the SMOOTHED median shown in the table
  // (median across recent checks — stable despite the hyper-local run-to-run bounce),
  // falling back to this run's reading when there's no history yet. The scorecard MUST
  // use the same value the table shows, or the KPIs disagree with the rows AND
  // flip-flop every run (raw Map Pack ranks are volatile; the table already smooths,
  // the KPIs didn't — that was the bug).
  const effMapPack = (i: number): number | null => {
    const sm = smoothedMapPack(property.seoRankSnapshots, queries[i], 5);
    if (sm) return sm.median;
    const r = ranks[i];
    return r.map_pack_rank ?? r.expanded_map_pack_rank ?? null;
  };
  const compEff = compIdx.map(effMapPack);
  const mapPackCount = compEff.filter((p): p is number => p != null && p <= 3).length;
  const partialPositions = compEff.filter((p): p is number => p != null && p > 3);
  const mapPackPartial = partialPositions.length;
  const bestPartialMP = partialPositions.length ? Math.min(...partialPositions) : null;
  const page1Count = compRanks.filter((r) => r.organic_rank && r.organic_rank <= 10).length;
  const compValid = compRanks.filter((r) => r.organic_rank).map((r) => r.organic_rank!);
  const avgRank = compValid.length ? Math.round(compValid.reduce((a, b) => a + b, 0) / compValid.length) : null;
  const compMapPackPositions = compEff.filter((x): x is number => typeof x === "number");
  const avgMapPackRank = compMapPackPositions.length
    ? Math.round(compMapPackPositions.reduce((a, b) => a + b, 0) / compMapPackPositions.length)
    : null;
  const mapPackRankingCount = compMapPackPositions.length;
  const bestMapPackRank = compMapPackPositions.length ? Math.min(...compMapPackPositions) : null;

  let strongestIdx = -1;
  let strongestScore = -1;
  let weakestIdx = -1;
  let weakestScore = Infinity;
  let opportunityIdx = -1;
  let oppScore = -1;
  compIdx.forEach((i) => {
    const r = ranks[i];
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
    if (r.map_pack_rank && r.map_pack_rank <= 3) return;
    let prox = 0;
    if (r.expanded_map_pack_rank) prox = Math.max(prox, 100 - r.expanded_map_pack_rank);
    else if (r.map_pack_appeared) prox = Math.max(prox, 45);
    if (r.organic_rank && r.organic_rank <= 30) prox = Math.max(prox, 60 - r.organic_rank);
    if (prox > oppScore) {
      oppScore = prox;
      opportunityIdx = i;
    }
  });
  const oppIsWinnable = opportunityIdx >= 0 && oppScore > 0;
  const finalOppIdx = oppIsWinnable ? opportunityIdx : weakestIdx;

  return {
    total: queries.length,
    competitiveTotal: compRanks.length,
    brandedCount: ranks.length - compRanks.length,
    mapPackCount,
    mapPackPartial,
    bestPartialMP,
    page1Count,
    avgRank,
    avgMapPackRank,
    mapPackRankingCount,
    bestMapPackRank,
    rankingCount: compValid.length,
    strongestQuery: strongestIdx >= 0 && strongestScore > 0 ? queries[strongestIdx] : null,
    strongestRank: strongestIdx >= 0 && strongestScore > 0 ? ranks[strongestIdx] : null,
    weakestQuery: weakestIdx >= 0 ? queries[weakestIdx] : null,
    opportunityQuery: finalOppIdx >= 0 ? queries[finalOppIdx] : null,
    opportunityRank: finalOppIdx >= 0 ? ranks[finalOppIdx] : null,
    opportunityWinnable: oppIsWinnable,
  };
}

/* -- SEO AUDIT (parallel rank check across 6 queries) --------------- */
type AuditStage = "idle" | "queries" | "checking" | "analyzing" | "done";

interface SEOAuditResults {
  queries: string[];
  ranks: GoogleRankResult[];
  recommendations: AuditRecommendations;
  timestamp: string;
  /** The search origin used for ranks (Map Pack is hyper-local). */
  location?: string;
  /** True when ranks were checked from the property's exact coordinates (its Google
   *  listing), not just the city — drives the "search from" methodology copy. */
  localizedToProperty?: boolean;
  /** Technical / on-page SEO health from the site crawl (optional). */
  technicalSeo?: TechnicalSeoResult;
  /** Local-citation / directory presence check (optional). */
  citations?: CitationResult;
  /** PageSpeed / Core Web Vitals (optional). */
  pageSpeed?: PageSpeedResult;
  /** Property's Google Business Profile star rating + review count (for the review-rank card). */
  googleRating?: number | null;
  googleReviewCount?: number | null;
  /** Property vs local Map Pack competitors, ranked by star rating. */
  localReviewComparison?: ReviewEntry[];
}

/**
 * Run PageSpeed Insights for mobile + desktop in parallel. Best-effort: a
 * strategy that errors is returned with its error and a null score, and a
 * total failure returns undefined so the audit skips the section.
 */
async function callPageSpeed(url: string): Promise<PageSpeedResult | undefined> {
  if (!url) return undefined;
  try {
    const strategies = await Promise.all(
      (["mobile", "desktop"] as const).map(async (strategy) => {
        try {
          const r = await fetch("/api/pagespeed", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url, strategy, samples: 3 }),
          });
          const d = await r.json();
          if (!r.ok || d.error) {
            return { strategy, score: null, lcp: "—", cls: "—", fcp: "—", tbt: "—", field: null, error: d.error || `failed (${r.status})` };
          }
          return { strategy, score: d.score ?? null, lcp: d.lcp || "—", cls: d.cls || "—", fcp: d.fcp || "—", tbt: d.tbt || "—", field: d.field ?? null, samples: d.samples ?? 1, scoreRange: d.scoreRange ?? null };
        } catch {
          return { strategy, score: null, lcp: "—", cls: "—", fcp: "—", tbt: "—", field: null, error: "request failed" };
        }
      })
    );
    // Return the result even when both strategies failed (e.g. the free
    // keyless PSI quota is exhausted) so the panel can show a helpful hint
    // instead of silently rendering nothing.
    return { url, checkedAt: new Date().toISOString(), strategies };
  } catch {
    return undefined;
  }
}

/** Plain-text PageSpeed summary fed into the recommendations prompt. */
function pageSpeedPromptSummary(ps: PageSpeedResult | undefined): string {
  if (!ps) return "PAGE SPEED / CORE WEB VITALS: not checked this run.";
  const parts = ps.strategies.map((s) =>
    s.score == null
      ? `${s.strategy}: could not measure`
      : `${s.strategy} performance score ${s.score}/100 (LCP ${s.lcp}, CLS ${s.cls}, TBT ${s.tbt})`
  );
  return `PAGE SPEED / CORE WEB VITALS (Google PageSpeed Insights): ${parts.join("; ")}.`;
}

/**
 * Directory / citation sources grouped by SYNDICATION NETWORK. Several
 * "directories" are siblings that share one listing feed (being on
 * Apartments.com generally covers ApartmentFinder/ForRent), so we detect
 * presence per network, not per individual site. Standalone sites (Facebook,
 * Apartment List) are their own citations. Yelp and BBB are intentionally
 * excluded — low-value for multifamily lead-gen vs. the ILS networks + Google.
 */
const CITATION_NETWORKS: { network: string; standalone: boolean; sites: { name: string; domain: string }[] }[] = [
  {
    network: "Apartments.com (CoStar)",
    standalone: false,
    sites: [
      { name: "Apartments.com", domain: "apartments.com" },
      { name: "ApartmentFinder", domain: "apartmentfinder.com" },
      { name: "ForRent.com", domain: "forrent.com" },
    ],
  },
  {
    network: "Rent. (RentPath)",
    standalone: false,
    sites: [
      { name: "Rent.com", domain: "rent.com" },
      { name: "ApartmentGuide", domain: "apartmentguide.com" },
      { name: "Rentals.com", domain: "rentals.com" },
    ],
  },
  {
    network: "Zillow",
    standalone: false,
    sites: [
      { name: "Zillow", domain: "zillow.com" },
      { name: "Trulia", domain: "trulia.com" },
      { name: "HotPads", domain: "hotpads.com" },
    ],
  },
  { network: "Apartment List", standalone: true, sites: [{ name: "Apartment List", domain: "apartmentlist.com" }] },
  { network: "Facebook", standalone: true, sites: [{ name: "Facebook", domain: "facebook.com" }] },
];

/**
 * Detect which directory/citation sources surface for a brand search. One
 * SerpAPI call. "Not detected" is a soft signal (the listing may exist but
 * rank below the results we scan), so it reads as "verify / opportunity" — and
 * we only treat a WHOLE network as absent, never an individual sibling site.
 */
async function checkCitations(property: Property): Promise<CitationResult | undefined> {
  const city = extractCity(property.address) || "";
  const q = `${property.name} ${city}`.trim();
  // Retry once on failure — this is the last SerpAPI call of the run, so it's the
  // most likely to catch a transient per-minute rate limit; a short pause clears it.
  let data: { organic_results?: unknown } | undefined;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      data = await callSerp({ query: q, engine: "google", location: extractLocation(property.address) });
      break;
    } catch {
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      return undefined;
    }
  }
  try {
    const results: unknown[] = Array.isArray(data?.organic_results) ? (data?.organic_results as unknown[]) : [];
    const hostOf = (u: string) => {
      try {
        return new URL(u).hostname.replace(/^www\./i, "").toLowerCase();
      } catch {
        return "";
      }
    };
    const found = results
      .map((r) => {
        const link = (r as { link?: string }).link || "";
        return { host: hostOf(link), url: link };
      })
      .filter((f) => f.host);
    const sources: CitationResult["sources"] = CITATION_NETWORKS.flatMap((net) =>
      net.sites.map((s) => {
        const hit = found.find((f) => f.host === s.domain || f.host.endsWith("." + s.domain));
        return { name: s.name, domain: s.domain, present: !!hit, url: hit?.url, network: net.network, standalone: net.standalone };
      })
    );
    // We audit the property's Apartments.com listing directly (its URL is
    // configured), so Apartments.com is a CONFIRMED citation — seed it present
    // even when the single brand search (directional, and flaky for aggregators)
    // didn't surface it this run. Prevents the absurd "we have the listing URL but
    // it shows not-detected".
    if (property.apartmentsUrl) {
      const apt = sources.find((s) => s.domain === "apartments.com");
      if (apt && !apt.present) {
        apt.present = true;
        apt.url = property.apartmentsUrl;
      }
      // Determine the "listed, not advertising" caveat HERE, deterministically from
      // the raw listing (same /api/apts-status check the marketing run uses), and
      // store it on the citation itself. Previously the panel read this from the
      // MARKETING audit's consistency table, so a stale/absent/flip-flopped marketing
      // run made a DARK Apartments.com listing render as a plain active green citation.
      // Self-contained here → the panel is correct regardless of the marketing audit.
      if (apt?.present) {
        try {
          const sr = await fetch("/api/apts-status", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: property.apartmentsUrl }),
          });
          const sj = (await sr.json()) as { advertising?: boolean | null };
          if (sj.advertising === false) apt.notAdvertising = true;
        } catch {
          /* best-effort — leave the caveat to the marketing-audit fallback */
        }
      }
    }
    // TARGETED PROBE for any network the single brand search didn't surface.
    // Aggregator listings rank inconsistently for a bare brand query, so pass 1
    // throws false "not found"s (e.g. Rent.com shows a full active listing but
    // doesn't crack page 1 for the brand term). For each still-missing network,
    // ask Google directly with a site:-scoped search whether the property has a
    // page on that domain, and require the property NAME to match the result so we
    // can only UPGRADE a false negative — never invent presence. Runs once per
    // audit (citations is the last step); stops at the first sibling that confirms.
    const loc = extractLocation(property.address);
    for (const net of CITATION_NETWORKS) {
      const netSources = net.sites
        .map((s) => sources.find((x) => x.domain === s.domain))
        .filter((x): x is NonNullable<typeof x> => !!x);
      if (netSources.some((s) => s.present)) continue; // already confirmed in pass 1
      for (const site of net.sites) {
        let probe: { organic_results?: unknown } | undefined;
        try {
          probe = await callSerp({ query: `${q} site:${site.domain}`, engine: "google", location: loc });
        } catch {
          continue; // best-effort per site
        }
        const orgs: unknown[] = Array.isArray(probe?.organic_results) ? (probe!.organic_results as unknown[]) : [];
        const hit = orgs.find((o) => {
          const link = (o as { link?: string }).link || "";
          const h = hostOf(link);
          const onDomain = h === site.domain || h.endsWith("." + site.domain);
          if (!onDomain) return false;
          const title = (o as { title?: string }).title || "";
          return nameMatches(`${title} ${link}`, property.name);
        }) as { link?: string } | undefined;
        if (hit) {
          const src = sources.find((s) => s.domain === site.domain);
          if (src) {
            src.present = true;
            src.url = hit.link;
          }
          break; // network confirmed via this sibling
        }
      }
    }
    return { sources, checkedAt: new Date().toISOString() };
  } catch {
    return undefined;
  }
}

/**
 * Collapse the per-site citation results into network-level rows: a network is
 * "present" if ANY sibling surfaced. Returns the found sites (with links) and
 * whether the network counts as a gap worth claiming.
 */
function citationNetworkRows(citations: CitationResult | undefined) {
  const sources = citations?.sources ?? [];
  return CITATION_NETWORKS.map((net) => {
    const siteResults = net.sites
      .map((s) => sources.find((x) => x.domain === s.domain))
      .filter(Boolean) as CitationResult["sources"];
    const foundSites = siteResults.filter((s) => s.present);
    return {
      network: net.network,
      standalone: net.standalone,
      present: foundSites.length > 0,
      foundSites,
      // Carried from the citation data itself (see checkCitations) so the "listed,
      // not advertising" caveat doesn't depend on a separate audit's state.
      notAdvertising: foundSites.some((s) => s.notAdvertising),
    };
  });
}

/**
 * True when the marketing audit determined the property is NOT advertising on
 * Apartments.com. A brand search still surfaces the (shell/unclaimed) listing —
 * a real NAP citation — so the directory-presence panel would show it as an
 * active green citation, contradicting the consistency check. This lets the
 * panel render it as "listed, not advertising" instead, so the two agree.
 */
function aptListedNotAdvertising(consistency: MarketingConsistencyRow[] | undefined): boolean {
  if (!consistency) return false;
  return consistency.some((r) => /not advertising on apartments/i.test(r?.apartments?.note || ""));
}

// detectWebsiteSpecial (concession detection) now lives in @/lib/detectors as the
// single source of truth (shared with the crawler + covered by tests/detectors.test.ts).

/** Strip protocol + trailing slash for compact display of a page URL. */
function shortUrl(u: string): string {
  return (u || "").replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

/* ---- Phone / tracking number inventory (Marketing Audit) ---- */
/** One number's result from the /api/dial Twilio dial-test. */
type DialResult = {
  number: string;
  status: "connected" | "failed" | "unknown";
  detail?: string;
  answeredBy?: "human" | "voicemail" | "fax" | "unknown" | null;
  ringSeconds?: number | null;
};

/**
 * US state → primary IANA timezone. Used to show the dial-test time in the
 * PROPERTY's local zone (what matters for judging office hours), not the
 * viewer's browser zone. Multi-zone states use their dominant zone.
 */
const STATE_TZ: Record<string, string> = {
  CT: "America/New_York", DE: "America/New_York", DC: "America/New_York", FL: "America/New_York", GA: "America/New_York", IN: "America/New_York", KY: "America/New_York", ME: "America/New_York", MD: "America/New_York", MA: "America/New_York", MI: "America/New_York", NH: "America/New_York", NJ: "America/New_York", NY: "America/New_York", NC: "America/New_York", OH: "America/New_York", PA: "America/New_York", RI: "America/New_York", SC: "America/New_York", VT: "America/New_York", VA: "America/New_York", WV: "America/New_York",
  AL: "America/Chicago", AR: "America/Chicago", IL: "America/Chicago", IA: "America/Chicago", KS: "America/Chicago", LA: "America/Chicago", MN: "America/Chicago", MS: "America/Chicago", MO: "America/Chicago", NE: "America/Chicago", ND: "America/Chicago", OK: "America/Chicago", SD: "America/Chicago", TN: "America/Chicago", TX: "America/Chicago", WI: "America/Chicago",
  AZ: "America/Phoenix", CO: "America/Denver", ID: "America/Denver", MT: "America/Denver", NM: "America/Denver", UT: "America/Denver", WY: "America/Denver",
  CA: "America/Los_Angeles", NV: "America/Los_Angeles", OR: "America/Los_Angeles", WA: "America/Los_Angeles",
  AK: "America/Anchorage", HI: "Pacific/Honolulu",
};

/** Pull the 2-letter state code from the end of an address ("…, MD 21804"). */
function extractStateCode(address: string): string {
  const m = (address || "").match(/,?\s*([A-Za-z]{2})\s*\d{0,5}\s*$/);
  return m ? m[1].toUpperCase() : "";
}

/**
 * Format the dial-test timestamp in the PROPERTY's local timezone (with the
 * zone abbreviation, e.g. "EDT") so a voicemail result can be judged against
 * the office's posted hours — not the viewer's clock.
 */
function formatDialTime(iso: string, address: string): string {
  const tz = STATE_TZ[extractStateCode(address)];
  try {
    const opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" };
    if (tz) return new Date(iso).toLocaleString("en-US", { ...opts, timeZone: tz, timeZoneName: "short" });
    return new Date(iso).toLocaleString("en-US", opts) + " (viewer's local time — property state unknown)";
  } catch {
    return new Date(iso).toLocaleString();
  }
}

/** Parse a GBP hours string ("9 AM–5 PM") into open/close minutes, or a state. */
function parseHoursRange(s: string): { open: number; close: number } | "closed" | "24h" | null {
  const t = (s || "").trim().toLowerCase();
  if (!t || t === "closed") return "closed";
  if (t.includes("24 hour") || t.includes("open 24")) return "24h";
  const parts = t.split(/[–—-]/).map((x) => x.trim());
  if (parts.length !== 2) return null;
  const toMin = (x: string): number | null => {
    const m = x.match(/(\d{1,2})(?::(\d{2}))?\s*(a|p)m/i);
    if (!m) return null;
    let h = parseInt(m[1], 10);
    const min = m[2] ? parseInt(m[2], 10) : 0;
    const pm = m[3].toLowerCase() === "p";
    if (pm && h !== 12) h += 12;
    if (!pm && h === 12) h = 0;
    return h * 60 + min;
  };
  const open = toMin(parts[0]);
  const close = toMin(parts[1]);
  if (open == null || close == null) return null;
  if (open === close) return "closed"; // 12 AM–12 AM = closed
  return { open, close };
}

/**
 * Was the property's office open at `iso`? Uses the GBP hours map + the
 * property's timezone (from its state). Returns null when undeterminable.
 */
function officeOpenAt(hours: Record<string, string> | undefined, iso: string | undefined, address: string): boolean | null {
  const tz = STATE_TZ[extractStateCode(address)];
  if (!hours || !iso || !tz) return null;
  try {
    const d = new Date(iso);
    const weekday = d.toLocaleString("en-US", { timeZone: tz, weekday: "long" }).toLowerCase();
    const hm = d.toLocaleString("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
    const [hh, mm] = hm.split(":").map((x) => parseInt(x, 10));
    const nowMin = (hh % 24) * 60 + mm;
    const range = parseHoursRange(hours[weekday]);
    if (range === "closed") return false;
    if (range === "24h") return true;
    if (!range) return null;
    return nowMin >= range.open && nowMin < range.close;
  } catch {
    return null;
  }
}

/** 10-digit key for de-duping a phone number regardless of formatting. */
function normalizePhone(s: string): string {
  const d = (s || "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : d;
}

/** Pretty US display form from any phone string. */
function formatPhone(s: string): string {
  const d = normalizePhone(s);
  if (d.length !== 10) return (s || "").trim();
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/**
 * Pull US phone numbers out of free text. Requires NANP-valid area/exchange
 * (first digit 2-9) so it doesn't match zip+4, prices, or ID strings. Returns
 * de-duped 10-digit keys.
 */
function extractPhones(text: string): string[] {
  if (!text) return [];
  const re = /(?:\+?1[\s.\-]?)?\(?([2-9]\d{2})\)?[\s.\-]?([2-9]\d{2})[\s.\-]?(\d{4})/g;
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.add(m[1] + m[2] + m[3]);
  return [...out];
}

/**
 * Derive the technical/on-page SEO issue lists from a crawl. Shared by the
 * on-screen panel, the printed report, and the recommendation prompt so all
 * three agree on what counts as a problem.
 */
function computeTechnicalIssues(tech: TechnicalSeoResult | undefined) {
  const pages = tech?.pages ?? [];
  return {
    total: pages.length,
    missingMeta: pages.filter((p) => !p.metaDescription),
    poorMeta: pages.filter(
      (p) => p.metaDescription && (p.metaDescription.length < 70 || p.metaDescription.length > 160)
    ),
    missingH1: pages.filter((p) => p.h1Count === 0),
    multiH1: pages.filter((p) => p.h1Count > 1),
    missingTitle: pages.filter((p) => !p.title),
    thinContent: pages.filter((p) => p.wordCount > 0 && p.wordCount < 150),
    anySchema: pages.some((p) => p.hasSchema),
    schemaPages: pages.filter((p) => p.hasSchema),
  };
}

/**
 * Fallback on-page reader for bot-protected sites: Claude's web_fetch
 * penetrates Cloudflare where the headless crawler is 403'd. Reliable for
 * title / meta description / H1s / word count; schema detection is best-effort
 * (web_fetch may not expose raw JSON-LD), so hasSchema is only true when Claude
 * can literally see a structured-data block.
 */
async function fetchTechnicalSeoViaWebFetch(website: string): Promise<PageSeo[] | null> {
  const url = website.startsWith("http") ? website : `https://${website}`;
  const prompt = `Use your web_fetch tool to load ${url} and its main same-domain nav pages (floor plans, amenities, photos/tour, contact — up to 5 pages total). For EACH page you actually read, report on-page SEO facts. Return ONLY JSON, no prose:
{"pages":[{"url":"page URL","title":"the <title>","metaDescription":"the meta description text, or empty string if there is none","h1Count":<number of H1 headings on the page>,"h1Text":"the main H1 text","hasSchema":<true ONLY if you can literally see a JSON-LD / schema.org structured-data block in the page source; otherwise false>,"internalLinks":<approx count of same-site links>,"wordCount":<approx visible word count>}]}
Omit any page you cannot read. Never invent values.`;
  const resp = await callAI({ prompt, webFetch: true, maxTokens: 1500 });
  const text = (resp.content || []).filter((b: { type: string }) => b.type === "text").map((b: { text?: string }) => b.text || "").join("\n");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let parsed: { pages?: Array<Record<string, unknown>> };
  try {
    parsed = JSON.parse(m[0]);
  } catch {
    return null;
  }
  const pages: PageSeo[] = (parsed.pages || []).map((p) => ({
    url: String(p.url || url),
    status: 200,
    title: String(p.title || ""),
    metaDescription: String(p.metaDescription || ""),
    h1Count: Number(p.h1Count) || 0,
    h1Text: String(p.h1Text || ""),
    hasCanonical: false, // not reliably visible via web_fetch
    hasSchema: !!p.hasSchema,
    internalLinks: Number(p.internalLinks) || 0,
    wordCount: Number(p.wordCount) || 0,
  }));
  return pages.length ? pages : null;
}

/** Plain-text technical-SEO summary fed into the recommendations prompt. */
function technicalSeoPromptSummary(tech: TechnicalSeoResult | undefined): string {
  const i = computeTechnicalIssues(tech);
  if (!tech || i.total === 0) {
    return "TECHNICAL / ON-PAGE SEO: the site could not be crawled this run (no on-page data).";
  }
  if (tech.blocked) {
    return "TECHNICAL / ON-PAGE SEO: the site's bot protection (e.g. Cloudflare) blocked our crawler, so on-page tags could NOT be read. Do NOT assume missing meta descriptions / H1s / schema — recommend verifying on-page SEO live rather than reporting gaps.";
  }
  const lines: string[] = [
    tech.source === "webfetch"
      ? `Read ${i.total} page(s) via the web_fetch fallback (the site blocked the crawler). Meta/H1/word counts are reliable; schema detection is best-effort, so do NOT claim schema is missing on the strength of this alone.`
      : `Crawled ${i.total} page(s) with a real browser.`,
  ];
  if (i.missingTitle.length) lines.push(`${i.missingTitle.length} page(s) have no <title>.`);
  if (i.missingMeta.length)
    lines.push(
      `${i.missingMeta.length}/${i.total} page(s) missing a meta description: ${i.missingMeta.slice(0, 5).map((p) => shortUrl(p.url)).join(", ")}.`
    );
  if (i.poorMeta.length) lines.push(`${i.poorMeta.length} page(s) have a too-short/too-long meta description.`);
  if (i.missingH1.length)
    lines.push(`${i.missingH1.length} page(s) have NO H1 heading: ${i.missingH1.slice(0, 5).map((p) => shortUrl(p.url)).join(", ")}.`);
  if (i.multiH1.length) lines.push(`${i.multiH1.length} page(s) have multiple H1 headings.`);
  lines.push(
    i.anySchema
      ? `JSON-LD structured data present on ${i.schemaPages.length}/${i.total} page(s).`
      : `NO JSON-LD structured data (schema) found on any crawled page.`
  );
  if (i.thinContent.length) lines.push(`${i.thinContent.length} page(s) have thin content (<150 words).`);
  const paths = tech.pages.map((p) => shortUrl(p.url)).filter(Boolean);
  if (paths.length)
    lines.push(
      `Pages found on the site: ${paths.join(", ")}. Do NOT recommend CREATING a page that already exists here — if a relevant page exists (e.g. an FAQ page), recommend IMPROVING it (add schema, expand content) instead.`
    );
  return "TECHNICAL / ON-PAGE SEO (from a live crawl):\n" + lines.map((l) => `- ${l}`).join("\n");
}

/* ---- Keyword rank movement (before/after, shown inline in the query table) ---- */

/** The baseline snapshot to compare against — only when ≥2 runs exist. */
function rankBaseline(snapshots: SeoRankSnapshot[] | undefined): SeoRankSnapshot | undefined {
  return snapshots && snapshots.length >= 2 ? snapshots[0] : undefined;
}

/**
 * Movement of a single rank value vs the baseline. Lower = better. Returns a
 * short label + tone; an empty label means "nothing to show" (no baseline, or
 * no change) so the caller renders nothing and avoids clutter.
 * `was === undefined` = no baseline exists; `was === null` = tracked but wasn't
 * ranking then (so ranking now is "new").
 */
function rankMovement(
  was: number | null | undefined,
  now: number | null
): { label: string; tone: "up" | "down" | "neutral" } {
  if (was === undefined) return { label: "", tone: "neutral" };
  if (was == null && now == null) return { label: "", tone: "neutral" };
  if (was == null) return { label: "★ new", tone: "up" };
  if (now == null) return { label: "▼ dropped", tone: "down" };
  if (now < was) return { label: `▲ from #${was}`, tone: "up" };
  if (now > was) return { label: `▼ from #${was}`, tone: "down" };
  return { label: "", tone: "neutral" }; // no change — render nothing
}

/** Movement for a query's organic OR map-pack rank vs the baseline snapshot. */
function movementFor(
  snapshots: SeoRankSnapshot[] | undefined,
  query: string,
  metric: "organicRank" | "mapPackRank",
  now: number | null
): { label: string; tone: "up" | "down" | "neutral" } {
  const baseline = rankBaseline(snapshots);
  if (!baseline) return { label: "", tone: "neutral" };
  const norm = (q: string) => q.trim().toLowerCase();
  const base = baseline.ranks.find((r) => norm(r.query) === norm(query));
  const was = base ? base[metric] : null;
  return rankMovement(was, now);
}

/** Map a movement tone to an on-screen color. */
function moveToneColor(tone: "up" | "down" | "neutral"): string {
  return tone === "up" ? "#15803d" : tone === "down" ? B.tangelo : "#9aa3ad";
}

/**
 * Smooth a query's Map Pack position across recent checks. The local 3-pack is
 * hyper-local and reorders minute-to-minute (the #3/#4 boundary flips constantly
 * for the same query), so a single reading — and any "movement" derived from it —
 * misrepresents a boundary flip as a real change. Returns the MEDIAN of the last
 * few snapshots plus the observed range, so the report shows the TYPICAL position.
 * `null`/absent readings are ignored; returns null when there are <2 checks to
 * smooth (nothing to stabilize yet — caller shows the live reading).
 */
function smoothedMapPack(
  snapshots: SeoRankSnapshot[] | undefined,
  query: string,
  window = 5
): { median: number; min: number; max: number; n: number } | null {
  const norm = (q: string) => q.trim().toLowerCase();
  const vals = (snapshots ?? [])
    .slice(-window)
    .map((s) => s.ranks.find((r) => norm(r.query) === norm(query))?.mapPackRank ?? null)
    .filter((x): x is number => typeof x === "number" && x > 0);
  if (vals.length < 2) return null;
  const sorted = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  return { median, min: sorted[0], max: sorted[sorted.length - 1], n: vals.length };
}

/** Plain-text citation summary fed into the recommendations prompt. */
function citationsPromptSummary(c: CitationResult | undefined): string {
  if (!c) return "LOCAL CITATIONS: not checked this run.";
  const rows = citationNetworkRows(c);
  const present = rows.filter((r) => r.present).map((r) => r.network);
  const missing = rows.filter((r) => !r.present).map((r) => r.network);
  return `LOCAL CITATIONS / DIRECTORY PRESENCE (directional read from ONE brand search — networks, not individual sibling sites):\n- Appears on: ${present.join(", ") || "none detected"}.\n- Not detected on: ${missing.join(", ") || "none"} (worth claiming for local-SEO trust + consistent name/address/phone; verify before asserting it's missing).`;
}

/** On-screen local-citations / directory presence panel (SEO tab). */
function CitationsPanel({ citations, aptNotAdvertising = false }: { citations: CitationResult | undefined; aptNotAdvertising?: boolean }) {
  if (!citations || citations.sources.length === 0) return null;
  const rows = citationNetworkRows(citations);
  // Apartments.com surfaces a listing (a real NAP citation) even when the
  // property isn't advertising there. When the marketing audit determined "not
  // advertising", render it as a caveat — not an active green citation — so this
  // panel agrees with the consistency check.
  const isAptCaveat = (r: (typeof rows)[number]) =>
    r.present && /^Apartments\.com/i.test(r.network) && (r.notAdvertising || aptNotAdvertising);
  // Count the caveat as present — a directory LISTING does exist on Apartments.com
  // (that's the citation); the "not actively advertising" flag is a separate
  // dimension shown on the chip, not a reason to drop it from the count.
  const presentCount = rows.filter((r) => r.present).length;
  return (
    <div style={{ background: "white", border: "1px solid #e6e9ec", borderRadius: 8, padding: "14px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span style={{ color: B.caribbean }}>📇</span>
        <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: B.caribbean }}>
          Local Citations / Directory Presence
        </span>
      </div>
      <p style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 12.5, color: "#333", marginBottom: 12 }}>
        Appears on <strong>{presentCount}</strong> of {rows.length} directory networks.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {rows.map((r) => {
          const caveat = isAptCaveat(r);
          const active = r.present && !caveat;
          const label = caveat
            ? `${r.network} — listed, not actively advertising`
            : active && r.foundSites.length > 1
            ? `${r.network} (${r.foundSites.length} sites)`
            : r.network;
          const url = r.foundSites[0]?.url;
          const chip = (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 12px",
                borderRadius: 20,
                fontFamily: "'Josefin Sans',sans-serif",
                fontSize: 12,
                border: `1px solid ${active ? "#bfe3cd" : "#e6d9c6"}`,
                background: active ? "#f0faf4" : "#fdf6ee",
                color: active ? "#15803d" : "#9a6a2a",
              }}
            >
              <span style={{ fontWeight: 700 }}>{caveat ? "◐" : active ? "✓" : "○"}</span> {label}
            </span>
          );
          return r.present && url ? (
            <a key={r.network} href={url} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
              {chip}
            </a>
          ) : (
            <span key={r.network}>{chip}</span>
          );
        })}
      </div>
      <p style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 11, color: "#9aa3ad", marginTop: 10 }}>
        Directional read from one brand search — networks, not individual sibling sites (a listing on Apartments.com covers ApartmentFinder/ForRent). A &ldquo;○&rdquo; means that network didn&apos;t surface, so it&apos;s worth verifying/claiming — not a confirmed absence.{aptNotAdvertising ? " Apartments.com shows a directory listing, but the property is not currently advertising there (see the consistency check)." : ""}
      </p>
    </div>
  );
}

/** Color a Lighthouse performance score (Google's thresholds). */
function pageSpeedColor(s: number | null): string {
  if (s == null) return "#9aa3ad";
  return s >= 90 ? "#15803d" : s >= 50 ? "#9a7200" : B.tangelo;
}

/**
 * CrUX field verdict → {label, color}. This is the REAL-USER result, so it's what
 * we headline when present. PSI reports overall_category as FAST/AVERAGE/SLOW (older)
 * or GOOD/NEEDS_IMPROVEMENT/POOR (newer) — map both to a plain-English verdict.
 */
function fieldVerdict(category: string): { label: string; color: string } {
  const c = (category || "").toUpperCase();
  if (c === "FAST" || c === "GOOD") return { label: "Good", color: "#15803d" };
  if (c === "SLOW" || c === "POOR") return { label: "Poor", color: B.tangelo };
  if (c === "AVERAGE" || c === "NEEDS_IMPROVEMENT") return { label: "Needs work", color: "#9a7200" };
  return { label: "Measured", color: "#555" };
}

/** On-screen PageSpeed / Core Web Vitals panel (SEO tab). */
function PageSpeedPanel({ ps }: { ps: PageSpeedResult | undefined }) {
  if (!ps || ps.strategies.length === 0) return null;
  const allFailed = ps.strategies.every((s) => s.score == null);
  if (allFailed) {
    return (
      <div style={{ background: "#fdf6ee", border: "1px solid #e6d9c6", borderRadius: 8, padding: "12px 18px" }}>
        <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: "#9a6a2a", marginBottom: 4 }}>
          ⚡ Page Speed / Core Web Vitals
        </div>
        <p style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 12.5, color: "#7a5a2a", margin: 0, lineHeight: 1.5 }}>
          Couldn&apos;t measure this run — Google&apos;s free keyless quota is limited and was exhausted. Add a free{" "}
          <strong>PAGESPEED_API_KEY</strong> in Railway (Google Cloud → enable &ldquo;PageSpeed Insights API&rdquo; → create an API key), then re-run. It&apos;s free and takes ~2 minutes.
        </p>
      </div>
    );
  }
  return (
    <div style={{ background: "white", border: "1px solid #e6e9ec", borderRadius: 8, padding: "14px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ color: B.caribbean }}>⚡</span>
        <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: B.caribbean }}>
          Page Speed / Core Web Vitals
        </span>
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        {ps.strategies.map((s) => {
          const verdict = s.field ? fieldVerdict(s.field.category) : null;
          return (
          <div key={s.strategy} style={{ flex: "1 1 240px", minWidth: 220, border: "1px solid #e6e9ec", borderRadius: 8, padding: "12px 16px" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 13, letterSpacing: "0.06em", textTransform: "uppercase", color: "#666", paddingTop: 3 }}>
                {s.strategy}
              </span>
              {/* Headline = the REAL-USER verdict when we have it (accurate + stable).
                  The lab score is only the headline when there's no field data. The
                  little caption ties the big word to real users so it doesn't read as
                  contradicting the (usually rosier) synthetic lab score beside it. */}
              {verdict ? (
                <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                  <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 26, lineHeight: 1, color: verdict.color }}>
                    {verdict.label}
                  </span>
                  <span style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 10, color: "#9aa3ad", marginTop: 2 }}>
                    real-user Core Web Vitals{s.score != null ? ` · lab score ${s.score}` : ""}
                  </span>
                </span>
              ) : (
                <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 30, lineHeight: 1, color: pageSpeedColor(s.score) }}>
                  {s.score == null ? "—" : s.score}
                  {s.score != null && <span style={{ fontSize: 13, color: "#aaa" }}> /100</span>}
                </span>
              )}
            </div>
            {s.error ? (
              <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 11.5, color: "#9aa3ad" }}>Could not measure this run.</div>
            ) : (
              <>
                {s.field && (
                  <div style={{ marginBottom: 8, paddingBottom: 8, borderBottom: "1px solid #f0f0f0" }}>
                    <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 10.5, color: "#15803d", fontWeight: 600, marginBottom: 3 }}>
                      Real users, 28-day{s.field.scope === "origin" ? " (site-wide)" : ""} — the accurate benchmark
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px" }}>
                      {[
                        ["LCP", s.field.lcp],
                        ["CLS", s.field.cls],
                        ["INP", s.field.inp],
                        ["FCP", s.field.fcp],
                      ].map(([k, v]) => (
                        <span key={k} style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 12, color: "#555" }}>
                          <strong style={{ color: "#333" }}>{k}</strong> {v}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px" }}>
                  <span style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 10.5, color: "#9aa3ad", width: "100%" }}>
                    Lab estimate{s.samples && s.samples > 1 ? ` · median of ${s.samples} runs` : ""}
                    {s.scoreRange && s.scoreRange.max > s.scoreRange.min ? ` (ranged ${s.scoreRange.min}–${s.scoreRange.max})` : ""}:
                  </span>
                  {[
                    ["LCP", s.lcp],
                    ["CLS", s.cls],
                    ["TBT", s.tbt],
                    ["FCP", s.fcp],
                  ].map(([k, v]) => (
                    <span key={k} style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 12, color: "#555" }}>
                      <strong style={{ color: "#333" }}>{k}</strong> {v}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
          );
        })}
      </div>
      <p style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 11, color: "#9aa3ad", marginTop: 10 }}>
        Google PageSpeed Insights · measured {new Date(ps.checkedAt).toLocaleString()} (cached between audits — it re-measures about every 2 weeks, or after &ldquo;Reset SEO history&rdquo;, since a synthetic lab score swings run-to-run). 90+ is good, 50–89 needs work, under 50 is poor. Mobile is what Google ranks on. The &ldquo;Real users&rdquo; line (when shown) is Google&rsquo;s 28-day field data and is the accurate benchmark.
      </p>
    </div>
  );
}

/** On-screen technical / on-page SEO health panel (SEO tab). */
function TechnicalSeoPanel({ tech }: { tech: TechnicalSeoResult | undefined }) {
  if (!tech || tech.pages.length === 0) return null;
  if (tech.blocked) {
    return (
      <div style={{ background: "#fdf6ee", border: "1px solid #e6d9c6", borderRadius: 8, padding: "12px 18px" }}>
        <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: "#9a6a2a", marginBottom: 4 }}>
          🩺 Technical / On-Page SEO
        </div>
        <p style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 12.5, color: "#7a5a2a", margin: 0, lineHeight: 1.5 }}>
          The site&apos;s bot protection (e.g. Cloudflare) blocked our crawler, so we couldn&apos;t read the on-page tags this run. Meta descriptions, H1s, and schema need to be <strong>verified live</strong> — not reported as gaps. (The Marketing Audit&apos;s website findings still work; they fall back to a different reader.)
        </p>
      </div>
    );
  }
  const i = computeTechnicalIssues(tech);
  const metaOk = i.total - i.missingMeta.length;
  const h1Ok = tech.pages.filter((p) => p.h1Count === 1).length;
  const th: React.CSSProperties = { padding: "7px 10px", textAlign: "left", fontFamily: "'Barlow Condensed',sans-serif", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#fff", background: B.oxford };
  const td: React.CSSProperties = { padding: "7px 10px", fontFamily: "'Josefin Sans',sans-serif", fontSize: 12, color: "#333", borderBottom: "1px solid #eef0f2", whiteSpace: "nowrap" };
  const yes = <span style={{ color: "#15803d", fontWeight: 700 }}>✓</span>;
  const no = <span style={{ color: B.tangelo, fontWeight: 700 }}>✗</span>;
  const kpis: [string, string, boolean][] = [
    ["Pages crawled", String(i.total), true],
    ["Meta descriptions", `${metaOk}/${i.total}`, i.missingMeta.length === 0],
    ["Single clean H1", `${h1Ok}/${i.total}`, h1Ok === i.total],
    ["Schema (JSON-LD)", i.anySchema ? "Present" : "None", i.anySchema],
  ];
  return (
    <div style={{ background: "white", border: "1px solid #e6e9ec", borderRadius: 8, padding: "14px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ color: B.caribbean }}>🩺</span>
        <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: B.caribbean }}>
          Technical / On-Page SEO
        </span>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        {kpis.map(([label, val, ok]) => (
          <div key={label} style={{ flex: "1 1 120px", minWidth: 110, border: "1px solid #e6e9ec", borderTop: `3px solid ${ok ? "#15803d" : B.tangelo}`, borderRadius: 6, padding: "8px 12px", textAlign: "center" }}>
            <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", color: "#999" }}>{label}</div>
            <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 18, fontWeight: 700, color: B.oxford }}>{val}</div>
          </div>
        ))}
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Page</th>
              <th style={{ ...th, textAlign: "center", width: 90 }}>Meta&nbsp;desc</th>
              <th style={{ ...th, textAlign: "center", width: 70 }}>H1</th>
              <th style={{ ...th, textAlign: "center", width: 80 }}>Schema</th>
              <th style={{ ...th, textAlign: "center", width: 70 }}>Words</th>
            </tr>
          </thead>
          <tbody>
            {tech.pages.map((p, idx) => (
              <tr key={idx}>
                <td style={{ ...td, whiteSpace: "normal", maxWidth: 320 }}>{shortUrl(p.url)}</td>
                <td style={{ ...td, textAlign: "center" }}>{p.metaDescription ? yes : no}</td>
                <td style={{ ...td, textAlign: "center" }}>{p.h1Count === 1 ? yes : <span style={{ color: B.tangelo, fontWeight: 700 }}>{p.h1Count === 0 ? "✗ none" : `${p.h1Count}×`}</span>}</td>
                <td style={{ ...td, textAlign: "center" }}>{p.hasSchema ? yes : no}</td>
                <td style={{ ...td, textAlign: "center" }}>{p.wordCount || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 11, color: "#9aa3ad", marginTop: 8 }}>
        Crawled {new Date(tech.timestamp).toLocaleString()} · homepage + up to 5 key pages. A missing meta description, a missing/duplicate H1, or absent schema is an easy on-page fix.
        {tech.source === "webfetch" && (
          <> The site blocked our crawler, so this was read via the web_fetch fallback — title, meta, H1s, and word counts are reliable; <strong>schema detection is best-effort</strong>, so confirm schema before treating it as absent.</>
        )}
      </p>
    </div>
  );
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
  const [newQuery, setNewQuery] = useState("");

  // The sticky tracked set. Fall back to legacy pinnedQueries for display so
  // existing properties show their pins until the next run migrates them.
  const trackedQueries = property.trackedQueries ?? property.pinnedQueries ?? [];
  const addTrackedQuery = () => {
    const q = newQuery.trim();
    if (!q) return;
    if (trackedQueries.some((p) => p.toLowerCase() === q.toLowerCase())) {
      setNewQuery("");
      return;
    }
    onUpdateProperty({ ...property, trackedQueries: [...trackedQueries, q] });
    setNewQuery("");
  };
  const removeTrackedQuery = (q: string) => {
    onUpdateProperty({
      ...property,
      trackedQueries: trackedQueries.filter((p) => p !== q),
    });
  };

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

  // Clear just this property's SEO history (results + rank-trend snapshots) so the
  // next run is a clean first-run baseline — e.g. after changing the tracked query
  // set makes old snapshots non-comparable. Marketing / Review / AI-rank history is
  // untouched (the Marketing tab has the full property-wide reset).
  const resetSeoHistory = () => {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        `Clear the SEO audit history for "${property.name}"?\n\nThis wipes the SEO results, the rank-trend snapshots (the before/after baseline), AND the saved set of tracked search phrases — so the next SEO run GENERATES A FRESH phrase set and starts a clean first-run baseline. Marketing, Review, and AI-rank history are NOT affected. This cannot be undone.`
      )
    ) {
      return;
    }
    const cleaned: Property = { ...property };
    delete (cleaned as unknown as Record<string, unknown>).seoAudit;
    delete (cleaned as unknown as Record<string, unknown>).seoRankSnapshots;
    // Also clear the sticky query set (both the current and legacy fields) — the run
    // reuses trackedQueries verbatim when present, so without this the "clean first
    // run" would silently reload the OLD phrases and never regenerate.
    delete (cleaned as unknown as Record<string, unknown>).trackedQueries;
    delete (cleaned as unknown as Record<string, unknown>).pinnedQueries;
    onUpdateProperty(cleaned);
    setResults(null);
    setStage("idle");
    setError(null);
    setProgress("");
  };

  const run = async () => {
    setError(null);
    setResults(null);

    // Track an evolving property reference so an enrichment pre-flight
    // can lock in website/gbpUrl that subsequent rank checks rely on
    // for deterministic matching.
    let currentProperty: Property = property;

    try {
      // Stage 0 (silent): auto-capture website + gbpUrl if missing. This
      // makes the parallel rank-checks below match by domain instead of
      // fuzzy name, eliminating the "Village Pizzeria misidentified as
      // Village at Snowfield" class of error. Costs 1 extra SerpAPI call
      // only when enrichment is needed.
      if (!currentProperty.website || !currentProperty.gbpUrl) {
        setStage("queries");
        setProgress("Locking property identity (1 SerpAPI lookup)…");
        try {
          const result = await enrichPropertyFromSerp(currentProperty);
          if (result && Object.keys(result.patch).length > 0) {
            currentProperty = { ...currentProperty, ...result.patch };
            onUpdateProperty(currentProperty);
          }
        } catch {
          /* enrichment is best-effort; continue without it */
        }
      }

      // Stage 1: assemble the query set. STICKY: once a tracked set exists we
      // reuse it verbatim every run (so keyword-rank movement is comparable),
      // and only auto-generate on the very first run / migration.
      setStage("queries");
      const stickySet = (currentProperty.trackedQueries && currentProperty.trackedQueries.length
        ? currentProperty.trackedQueries
        : currentProperty.pinnedQueries || []
      )
        .map((q) => q.trim())
        .filter(Boolean);

      let queries: string[];
      if (stickySet.length > 0) {
        // Reuse the saved set exactly — no AI generation, no drift.
        setProgress("Loading your tracked search queries…");
        const seen = new Set<string>();
        queries = [];
        for (const q of stickySet) {
          const key = q.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          queries.push(q);
        }
      } else {
        // First run for this property: build a starting set GROUNDED IN REAL SEARCH
        // DEMAND rather than the model's guess. Three stages:
        //  (A) the model identifies the property's real submarket (neighborhood/suburb,
        //      county, nearby major employers) and drafts localized seed phrases — NOT
        //      the broad metro name, NOT invented amenity+micro-street combos;
        //  (B) we expand those seeds through Google Autocomplete, whose suggestions come
        //      straight from actual search volume (what people really type);
        //  (C) the model picks the final phrases from those real suggestions, targeted
        //      to the submarket. Each stage falls back gracefully. First run only — the
        //      set is then sticky (saved as trackedQueries below).
        const amenitiesStr = currentProperty.amenities.slice(0, 8).join(", ") || "(none specified)";
        const unitType = (currentProperty.propertyType || "apartments").trim();
        // The word a RENTER actually types — never the industry term "multifamily"
        // (which also makes autocomplete return for-sale/investor results).
        const unitWord = searchUnitWord(currentProperty.propertyType || "");
        const bedroomTypes = (currentProperty.bedroomTypes || "").trim();

        // (A) Submarket anchors + seed phrases. The CITY is taken from the ADDRESS
        // (authoritative) so the model can't relocate the property to a neighboring
        // town — it drifted "Denver" -> "Aurora" off nearby landmarks (Buckley SFB,
        // CU Anschutz). The model only supplies the neighborhood WITHIN that city,
        // whether the city is a big central city, the county, employers, and seeds.
        setProgress("Mapping the property's local submarket…");
        const addressCity = (extractLocation(currentProperty.address) || "").split(",")[0].trim();
        const seedPrompt = `You are choosing Google search phrases to TRACK for a rental property. Identify the LOCAL SUBMARKET a real renter would search, then draft seed phrases.

Property: ${currentProperty.name}
Address: ${currentProperty.address}
City (FIXED — from the address; do NOT change it to a neighboring town): ${addressCity || "(parse from the address)"}
Type: ${unitType}${bedroomTypes ? `\nBedroom types: ${bedroomTypes}` : ""}
Amenities: ${amenitiesStr}

Rules:
- Anchor to the property's SPECIFIC submarket: its neighborhood or suburb, its county, and 1-2 MAJOR nearby employers/institutions (hospital, university, military base, corporate campus, downtown district) that exist for THIS address.
- Location phrases MUST stay in the city above and its OWN neighborhoods. NEVER relocate the property to a neighboring city (e.g. do not use "Aurora" for a Denver address). Prefer a specific NEIGHBORHOOD of that city over the bare city name. Nearby employers/institutions may appear ONLY in "near <X>" phrases, even if they sit in an adjacent town.
- Do NOT invent hyper-specific amenity + micro-street combinations no one types.
- Phrases must be how renters ACTUALLY search (type + place, bedroom + place, "near <employer>"), with real demand.
- These are RENTAL searches. NEVER use sale/purchase wording ("for sale", "to buy", "for sale by owner").
- Use the word a renter types: "${unitWord}". Do NOT use industry jargon like "multifamily" or "multi-family".
- Do NOT use a specific apartment community / competitor property name as a query; only generic phrases a stranger would type.

Return ONLY JSON: {"neighborhood":"","county":"","employers":["",""],"seeds":["10 short seed phrases"]}. "neighborhood" = the neighborhood/district WITHIN the city above where this exact address sits (e.g. a Denver address on S Akron St -> "Virginia Village") — used only to target the demand-grounded picks.`;

        let anchors: { neighborhood: string; county: string; employers: string[]; seeds: string[] } = {
          neighborhood: "",
          county: "",
          employers: [],
          seeds: [],
        };
        try {
          const sResp = await callAI({ prompt: seedPrompt, maxTokens: 500 });
          const sText = sResp.content?.[0]?.text || "";
          const sMatch = sText.match(/\{[\s\S]*\}/);
          if (sMatch) {
            const parsed = JSON.parse(sMatch[0]) as Partial<typeof anchors>;
            anchors = {
              neighborhood: typeof parsed.neighborhood === "string" ? parsed.neighborhood : "",
              county: typeof parsed.county === "string" ? parsed.county : "",
              employers: Array.isArray(parsed.employers) ? parsed.employers.filter((e): e is string => typeof e === "string") : [],
              seeds: Array.isArray(parsed.seeds) ? parsed.seeds.filter((e): e is string => typeof e === "string") : [],
            };
          }
        } catch {
          /* fall back to the seed-free path below */
        }

        // ALWAYS-tracked stock searches key off the property's CITY (fixed from the
        // address) — how renters actually phrase "2 bedroom apartments in <city>" /
        // "apartments with a pool in <city>", and the level where Google renders a local
        // pack. Neighborhood was tried and is too niche: for a residential neighborhood
        // like Virginia Village several bedroom/amenity queries returned NO map pack at all
        // (too little volume to be a local query, nothing to rank in). Neighborhood
        // targeting instead rides on the autocomplete PICKS, which only surface a
        // neighborhood phrase when it genuinely has search demand. For a suburb the
        // address city IS the specific town (e.g. "Aurora"); for a central city it's the
        // city ("Denver"), competitive but real.
        const stockGeo = addressCity || (anchors.county || "").trim();
        // One per floorplan the property actually offers (studio / 1 / 2 / 3).
        const stockBedroomQueries = bedroomGeoQueries(bedroomTypes, stockGeo);
        // One per high-demand amenity the property actually has (pool, pet friendly,
        // gym, …). Gated on the property's amenities so it never claims one it lacks.
        const stockAmenityQueries = amenityGeoQueries(currentProperty.amenities.join(" "), stockGeo, 3);
        const stockQueries = [...stockBedroomQueries, ...stockAmenityQueries];

        // Audience / price profile — used to drop searches aimed at the wrong renter
        // pool: income-restricted / senior phrases (unless the property IS that) and
        // "under $X" caps at or below the rent floor (which exclude the property).
        const ptLower = (currentProperty.propertyType || "").toLowerCase();
        // "Luxury" only fits a property positioned that way — check the type AND name
        // (e.g. "Luxury", "Luxe", "Upscale"). A value/workforce community like Asbury
        // Plaza has none, so "luxury apartments …" searches are dropped as off-profile.
        const nameTypeLower = `${currentProperty.propertyType || ""} ${currentProperty.name || ""}`.toLowerCase();
        const profileOpts = {
          rentMin: currentProperty.priceMin,
          rentMax: currentProperty.priceMax,
          affordable: /affordable|income[-\s]?(?:based|restricted)|section\s*8|tax credit|lihtc|subsidized/.test(ptLower),
          senior: /senior|55\s*\+|active adult/.test(ptLower),
          luxury: /\bluxury\b|\bluxe\b|\bupscale\b|high[-\s]?end/.test(nameTypeLower),
        };
        const rentRange =
          currentProperty.priceMin && currentProperty.priceMax
            ? `$${currentProperty.priceMin.toLocaleString()}-$${currentProperty.priceMax.toLocaleString()}/mo`
            : "";

        // (B) Expand seeds via Google Autocomplete (real demand). Best-effort, parallel.
        setProgress("Checking what renters actually search (Google Autocomplete)…");
        const suggestionPool: string[] = [];
        await Promise.all(
          anchors.seeds.slice(0, 8).map(async (seed) => {
            try {
              const ac = await callSerp({ query: seed, engine: "google_autocomplete" });
              suggestionPool.push(...extractAutocompleteSuggestions(ac));
            } catch {
              /* skip this seed's expansion */
            }
          })
        );
        // Drop for-sale/purchase AND off-profile (income-restricted/senior/sub-floor
        // price) suggestions here so the model never even sees them — autocomplete on
        // location seeds surfaces "low income …" and "… under $1000" a lot.
        const dedupPool = Array.from(
          new Set(suggestionPool.map((s) => s.trim()).filter(Boolean))
        ).filter((s) => !isSalesIntent(s) && !isOffProfileQuery(s, profileOpts));

        // (C) Pick the final phrases from the REAL suggestions, targeted to the submarket.
        setProgress("Selecting the phrases to track…");
        let picked: string[] = [];
        if (dedupPool.length) {
          const pickPrompt = `These are REAL Google Autocomplete suggestions (actual search demand) gathered for ${currentProperty.name} (${currentProperty.address}):

${dedupPool.slice(0, 80).map((s) => `- ${s}`).join("\n")}

Submarket: city="${addressCity}" (the property is in THIS city — do not use a neighboring city like Aurora for a Denver address), neighborhood="${anchors.neighborhood}", county="${anchors.county}", employers=${JSON.stringify(anchors.employers)}.

Already tracked (do NOT repeat any of these): "${currentProperty.name}"${stockQueries.length ? `, ${stockQueries.map((q) => `"${q}"`).join(", ")}` : ""}.

Pick 9 ADDITIONAL phrases to track. Requirements:
- Geographically TARGETED to the submarket above (neighborhood/suburb/county/employer), NOT the broad metro name alone.
- Real demand: choose phrases from the list above verbatim wherever possible.
- RENTAL intent only. Reject anything about buying/selling ("for sale", "to buy", "for sale by owner", "multi family for sale").
- This property rents ${rentRange || "at market rate"}${profileOpts.affordable ? "" : " (MARKET-RATE)"}.${profileOpts.affordable ? "" : ` Do NOT pick income-restricted/subsidized/senior searches ("low income", "income based", "section 8", "affordable housing", "62+", "senior").`}${currentProperty.priceMin ? ` Any price cap must fit that range — NEVER "under $${currentProperty.priceMin.toLocaleString()}" or lower.` : ""}
- Use the renter's word "${unitWord}"; NEVER industry jargon like "multifamily"/"multi-family".
- Do NOT pick a specific apartment community / competitor property name (e.g. "Fitzsimons Flats") — only generic phrases a stranger types.
- No near-duplicates (e.g. don't include both "buckley afb" and "buckley space force base").
- Diverse and COMPLEMENTARY to what's already tracked: neighborhood/suburb variants, "near <employer/institution>", and real price/quality modifiers renters add${profileOpts.luxury ? ` ("luxury", "upscale", "new")` : ` ("cheap", "affordable", "value", "pet friendly")`}. ${profileOpts.luxury ? "" : `This is a value/workforce community, NOT luxury — do NOT use "luxury", "upscale", or "high-end". `}An amenity tied to a neighborhood or employer is fine, but do NOT restate the plain bedroom or amenity stock phrases already tracked.
Return ONLY a JSON array of 9 strings.`;
          try {
            const pResp = await callAI({ prompt: pickPrompt, maxTokens: 400 });
            const pText = pResp.content?.[0]?.text || "";
            const pMatch = pText.match(/\[[\s\S]*\]/);
            if (pMatch) {
              const arr = JSON.parse(pMatch[0]) as unknown[];
              if (Array.isArray(arr)) picked = arr.filter((x): x is string => typeof x === "string");
            }
          } catch {
            /* fall through to the drafted seeds */
          }
        }

        // Deterministic backstop: drop any wrong-audience / sub-floor-price phrase the
        // model picked anyway (belt-and-suspenders over the pool filter + prompt rules).
        picked = picked.filter((q) => !isOffProfileQuery(q, profileOpts));

        // Fallbacks: model pick -> drafted seeds -> a minimal type+location default,
        // so the audit always has something to check even if AI/autocomplete failed.
        if (picked.length === 0) picked = anchors.seeds.slice(0, 9).filter((q) => !isOffProfileQuery(q, profileOpts));
        if (picked.length === 0) {
          const loc = extractLocation(currentProperty.address) || currentProperty.address;
          picked = [
            `${unitWord} in ${loc}`,
            `${unitWord} for rent ${loc}`,
            `${unitWord} near ${loc}`,
            `cheap ${unitWord} ${loc}`,
            `pet friendly ${unitWord} ${loc}`,
          ].filter((q) => !isOffProfileQuery(q, profileOpts));
        }

        // Final set (target 10): brand leads, then the always-tracked bedroom+county
        // and amenity+county stock searches, then the demand-grounded picks fill the
        // rest. Deduped + capped.
        queries = finalizeQuerySet(currentProperty.name, [...stockQueries, ...picked], 10);
        if (queries.length === 0) throw new Error("Could not generate query candidates.");
      }

      // The property's Google listing, fetched ONCE up front: its coordinates localize
      // the Map Pack checks to the property's exact spot (not the city centroid), so
      // ranks and competitors reflect the immediate area; its rating/review count feed
      // the review-rank card. Best-effort — no coords just falls back to city-level.
      setProgress("Locating the property on Google…");
      let origin: { lat: number; lng: number } | undefined;
      let googleRating: number | null = null;
      let googleReviewCount: number | null = null;
      try {
        const gbpSerp = await callSerp({
          query: buildGbpSearchQuery(currentProperty),
          engine: "google_maps",
          location: extractLocation(currentProperty.address),
        });
        const gbpInfo = extractGBP(gbpSerp, currentProperty);
        const gbpPlace = gbpSerp?.place_results as { gps_coordinates?: { latitude?: number; longitude?: number }; rating?: number; reviews?: number } | undefined;
        const gps = gbpPlace?.gps_coordinates;
        if (gps && typeof gps.latitude === "number" && typeof gps.longitude === "number") {
          origin = { lat: gps.latitude, lng: gps.longitude };
        }
        googleRating = gbpInfo?.rating ?? (typeof gbpPlace?.rating === "number" ? gbpPlace.rating : null);
        googleReviewCount = gbpInfo?.reviewCount ?? (typeof gbpPlace?.reviews === "number" ? gbpPlace.reviews : null);
      } catch {
        /* best-effort — fall back to city-level localization + no review card */
      }

      // Stage 2: parallel rank checks, localized to the property's coordinates.
      setStage("checking");
      let completed = 0;
      setProgress(`Checking rankings: 0 of ${queries.length} complete`);
      const rankPromises = queries.map((q) =>
        fetchGoogleRank(currentProperty, q, origin).then((r) => {
          completed += 1;
          setProgress(`Checking rankings: ${completed} of ${queries.length} complete`);
          return r;
        })
      );
      const ranks = await Promise.all(rankPromises);

      // Review rank: property rating vs the local Map Pack competitors gathered above.
      let localReviewComparison: ReviewEntry[] = [];
      try {
        localReviewComparison = buildLocalReviewComparison(
          { name: currentProperty.name, rating: googleRating, reviews: googleReviewCount },
          ranks.flatMap((r) => r.map_pack_competitors || [])
        );
      } catch {
        /* best-effort */
      }

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

      // AI-assistant visibility, technical/on-page crawl, citations, and page
      // speed are four INDEPENDENT stages — run them concurrently so wall-clock
      // is the slowest stage, not the sum of all four.
      setProgress("Running AI visibility, on-page crawl, citations, and speed checks…");
      const [llmRankResult, techResult, citations, pageSpeed] = await Promise.all([
        (async (): Promise<Property["llmRank"] | undefined> => {
      // AI-assistant visibility — folded into this single run so one button
      // covers Google rank + AI rank, and the recommendations address both.
      setProgress("Checking AI assistant visibility (a few asks for a stable read)…");
      let llmRankResult: Property["llmRank"] | undefined;
      try {
        const aiCity = extractCity(currentProperty.address) || "the area";
        const aiType = currentProperty.propertyType?.trim() || "apartments";
        const aiQuery = `best ${aiType} to rent in ${aiCity}`;
        const aiPrompt = `A prospective renter asks an AI assistant: "What are the ${aiQuery}?"\n\nUse web search to answer the way the assistant naturally would, then report the SPECIFIC apartment communities you would actually name or recommend. The property being tracked is "${currentProperty.name}" at ${currentProperty.address}.\n\nReturn ONLY this JSON, no prose:\n{"namedProperties":["community names you would recommend, best first"],"mentionsTarget":true or false,"note":"one sentence"}`;
        // AI answers vary per ask (LLM sampling), so a single ask flip-flops
        // between "named" and "not named". Ask a few times and report the
        // FREQUENCY ("named in X of N") — the real, stable signal.
        const ASKS = 3;
        const runs = await Promise.all(
          Array.from({ length: ASKS }, async () => {
            try {
              const aiData = await callAI({ prompt: aiPrompt, useWebSearch: true, maxTokens: 1500 });
              const aiText = (aiData.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
              const am = aiText.match(/\{[\s\S]*\}/);
              if (!am) return null;
              const ap = JSON.parse(am[0]) as { namedProperties?: string[]; mentionsTarget?: boolean; note?: string };
              const named = Array.isArray(ap.namedProperties) ? ap.namedProperties.filter((x): x is string => typeof x === "string") : [];
              // Decide "named" DETERMINISTICALLY from the recommended list the user
              // actually sees (same fuzzy matcher used everywhere — handles "Saw Mill"
              // vs "Sawmill"). Don't trust the model's self-reported mentionsTarget
              // boolean, which can disagree with its own list. Fall back to the boolean
              // only if the list came back empty.
              const mentions = named.length ? nameMatches(named.join(" || "), currentProperty.name) : !!ap.mentionsTarget;
              return { named, mentions, note: (ap.note || "").trim() };
            } catch {
              return null;
            }
          })
        );
        const ok = runs.filter((r): r is { named: string[]; mentions: boolean; note: string } => !!r);
        if (ok.length) {
          const asks = ok.length;
          const mentions = ok.filter((r) => r.mentions).length;
          // Merge the named communities by how many asks named each (most-consistent
          // first) so the list is stable, not whatever one ask happened to say.
          const freq = new Map<string, { name: string; count: number }>();
          for (const r of ok) {
            const seen = new Set<string>();
            for (const n of r.named) {
              const key = n.trim().toLowerCase();
              if (!key || seen.has(key)) continue;
              seen.add(key);
              const cur = freq.get(key);
              if (cur) cur.count++;
              else freq.set(key, { name: n.trim(), count: 1 });
            }
          }
          const merged = [...freq.values()].sort((a, b) => b.count - a.count).map((x) => x.name).slice(0, 12);
          const note =
            mentions === 0
              ? `Not named in any of ${asks} AI answers.`
              : `Named in ${mentions} of ${asks} AI answers${mentions < asks ? " (AI results vary per ask)" : ""}.`;
          llmRankResult = {
            checkedAt: new Date().toISOString(),
            query: aiQuery,
            models: [{ model: "Claude", mentionsTarget: mentions * 2 >= asks, namedProperties: merged, note, asks, mentions }],
          };
        }
      } catch {
        /* best-effort — AI visibility is non-fatal */
      }
          return llmRankResult;
        })(),
        (async (): Promise<{ technicalSeo?: TechnicalSeoResult; faqPagePath: string | null }> => {
      // Technical / on-page crawl — read the real site (title, meta, H1s,
      // schema, internal links) so the audit can flag on-page SEO gaps. Adds
      // ~60-90s but is best-effort: if the site can't be rendered we simply
      // skip the technical section instead of failing the audit.
      let technicalSeo: TechnicalSeoResult | undefined;
      // Does the site already have an FAQ page? Detected from the crawl (a /faq URL,
      // or "frequently asked questions" / an "FAQ" nav link in the page text) so we
      // never recommend CREATING an FAQ page for a site that has one — we recommend
      // improving it (e.g. adding schema) instead.
      let faqPagePath: string | null = null;
      if (currentProperty.website) {
        setProgress("Crawling the site for technical / on-page SEO…");
        try {
          const crawl = await callFetch({ url: currentProperty.website, follow: true, maxPages: 6 });
          const faqUrl = (crawl.pages || []).map((p) => p.url).find((u) => /\/faqs?\b|frequently-asked/i.test(u || ""));
          const crawlBlob = (crawl.pages || []).map((p) => `${p.url} ${(p.text || "").slice(0, 500)}`).join(" ");
          if (faqUrl) faqPagePath = shortUrl(faqUrl);
          else if (/frequently\s+asked\s+questions|\bfaqs\b/i.test(crawlBlob)) faqPagePath = "an FAQ page";
          const pages: PageSeo[] = (crawl.pages || [])
            .filter((p) => p.seo)
            .map((p) => ({ url: p.url, status: p.status, ...(p.seo as Omit<PageSeo, "url" | "status">) }));
          // A single thin page (typical of a Cloudflare/bot challenge) means the
          // crawler didn't reach the real site.
          const gotRealContent = pages.some(
            (p) => (p.status === 200 || p.status === null) && p.wordCount >= 80
          );
          if (pages.length && gotRealContent) {
            technicalSeo = { pages, timestamp: new Date().toISOString(), source: "crawl" };
          } else {
            // Crawler blocked → fall back to Claude web_fetch (penetrates
            // Cloudflare like the Marketing Audit does). If that also fails,
            // keep whatever thin pages we have and flag them blocked.
            setProgress("Site blocked our crawler — reading it via web_fetch…");
            let wf: PageSeo[] | null = null;
            try {
              wf = await fetchTechnicalSeoViaWebFetch(currentProperty.website);
            } catch {
              /* fallback best-effort */
            }
            if (wf && wf.length) {
              technicalSeo = { pages: wf, timestamp: new Date().toISOString(), source: "webfetch" };
            } else if (pages.length) {
              technicalSeo = { pages, timestamp: new Date().toISOString(), blocked: true };
            }
          }
        } catch {
          /* best-effort — technical section is skipped if the crawl fails */
        }
      }
          return { technicalSeo, faqPagePath };
        })(),
        (async (): Promise<CitationResult | undefined> => {
      // Local-citation / directory presence — one SerpAPI brand search. This is
      // the LAST of ~a dozen SerpAPI calls in the run, so a rate/quota blip tends
      // to hit HERE first. If it fails, keep the previous run's result rather than
      // letting the panel silently vanish (directory presence barely changes
      // run-to-run) — a transient blip should never look like "no citations".
      setProgress("Checking directory / citation presence…");
      const priorCitations = currentProperty.seoAudit?.citations;
      let citations = (await checkCitations(currentProperty)) ?? priorCitations;
      // Directory presence is STICKY — a network that surfaced in a prior run still
      // exists even if this run's single (flaky) brand search misses it. Union the
      // present set with the prior run's so detection doesn't flap 4 -> 0 -> 4
      // between runs. No extra API calls; a listing doesn't vanish run-to-run.
      if (citations && priorCitations && citations !== priorCitations) {
        citations = {
          ...citations,
          sources: citations.sources.map((s) => {
            const prior = priorCitations.sources.find((p) => p.domain === s.domain);
            return prior?.present && !s.present ? { ...s, present: true, url: s.url ?? prior.url } : s;
          }),
        };
      }
          return citations;
        })(),
        (async (): Promise<PageSpeedResult | undefined> => {
      // PageSpeed / Core Web Vitals. This is a periodic MEASUREMENT, not a per-run
      // thing — the site's real speed doesn't change between audit runs, only
      // Lighthouse's noisy synthetic lab number does. So REUSE the last measurement
      // (stops the score bouncing every re-run) and only re-measure when it's
      // missing, previously failed, or older than ~14 days. "Reset SEO history"
      // clears it and forces a fresh measurement.
      let pageSpeed: PageSpeedResult | undefined;
      if (currentProperty.website) {
        const prior = currentProperty.seoAudit?.pageSpeed;
        const priorHasScore = !!prior?.strategies?.some((s) => s.score != null);
        const priorAgeMs = prior?.checkedAt ? Date.now() - new Date(prior.checkedAt).getTime() : Infinity;
        if (priorHasScore && priorAgeMs < 14 * 24 * 60 * 60 * 1000) {
          pageSpeed = prior; // stable measurement — don't re-roll the noisy lab test
        } else {
          setProgress("Measuring page speed (Core Web Vitals)…");
          pageSpeed = await callPageSpeed(currentProperty.website);
        }
      }
          return pageSpeed;
        })(),
      ]);
      const technicalSeo = techResult.technicalSeo;
      const faqPagePath = techResult.faqPagePath;
      const aiSummary = llmRankResult
        ? `AI ASSISTANT VISIBILITY — asked Claude "${llmRankResult.query}" ${llmRankResult.models[0].asks ?? 1}x (AI answers vary per ask, so this is a frequency): ${currentProperty.name} was named in ${llmRankResult.models[0].mentions ?? (llmRankResult.models[0].mentionsTarget ? 1 : 0)} of ${llmRankResult.models[0].asks ?? 1} answers. Communities Claude recommended (most-consistent first): ${llmRankResult.models[0].namedProperties.join(", ") || "(none returned)"}. ${llmRankResult.models[0].note}`
        : "AI ASSISTANT VISIBILITY: could not be checked this run.";

      const recsPrompt = `SEO + AI visibility audit for ${currentProperty.name} at ${currentProperty.address}:

GOOGLE SEARCH RANK DATA:
${queryRankSummary}

${aiSummary}

${technicalSeoPromptSummary(technicalSeo)}
${faqPagePath ? `\nNOTE: the site ALREADY has an FAQ page (${faqPagePath}). Do NOT recommend creating/publishing a new FAQ page. If it lacks FAQPage (JSON-LD) schema, you MAY recommend adding schema to the EXISTING page instead.\n` : ""}
${pageSpeedPromptSummary(pageSpeed)}

${citationsPromptSummary(citations)}

Based on BOTH the Google rank data AND the AI-assistant visibility above, return EXACTLY 5 ranked recommendations to improve ${currentProperty.name}'s visibility across Google search AND AI assistants (ChatGPT/Claude/Gemini). Order by highest ROI first.

Return ONLY a JSON object, no prose before or after:
{
  "recommendations": [
    {
      "priority": "QUICK WIN" | "FOUNDATIONAL" | "MAP PACK" | "AI VISIBILITY" | "STRATEGIC" | "CONTENT" | "LONG-TAIL",
      "title": "Imperative phrase, max 12 words, no period",
      "what": "1-3 sentences. The concrete action. Name the page/URL, vendor, plugin, or platform. No hedging.",
      "why": "1-2 sentences. Reference the specific query/rank data above + the business impact. Cite numbers.",
      "effort": "Format: '~<time> · <who>'. Examples: '~4 hrs · marketing manager + web vendor', '~1 week · vendor work'.",
      "success": "Measurable outcome with timeframe. Example: 'Reach first page organic within 90 days for {specific query}'.",
      "source": "Reference the specific query name + audit finding. Example: 'Query 4: \\\"apartments with washer dryer Salisbury MD\\\" — Map Pack appeared, organic absent'."
    },
    ... 5 cards total
  ]
}

${CRES_PLAYBOOK}

Recommendation rules (STRICT):
1. EXACTLY 5 recommendations.
2. Each "title" is imperative — start with a verb (Build, Optimize, Claim, Target, Audit, Publish, Outreach).
3. "what" must be concrete: name a specific URL/page/platform/vendor/keyword. Forbid generic verbs without an object ("improve content" is unacceptable; "Build /apartments-with-washer-dryer-salisbury-md landing page on vangardlofts.com" is correct).
4. "why" must cite at least ONE specific query and rank from the audit above. Forbid generic SEO platitudes ("important for SEO" is unacceptable; "Audit shows Query 4 has Map Pack visibility (winnable) but property absent from organic top 30; competitor The Flatts owns #1" is correct).
5. "effort" must include time + role.
6. "success" must be measurable and time-boxed.
7. "source" must name the specific query that triggered this.
8. PLAIN ENGLISH: titles, "what", and "why" are read by a property manager, not an SEO specialist. Never use the jargon "NAP", "GBP", "SERP", or "ILS" in card text — say "name/address/phone", "Google listing", "search results", "listing sites" instead. (You may keep "Map Pack" and "organic" — those are clear in context.)
9. CRES PLAYBOOK GROUNDING: if a recommendation touches reviews, lead follow-up, or the tour/sales process, describe the specific CRES tactic from the playbook above plainly (e.g. "text residents a direct Google review link", "Hug a Building visits", "call + text + email daily for the first 7 days") rather than generic advice. Do NOT fabricate branded program names like "CRES text-message review protocol" — only "Hug a Building" is a named program.
10. KEY-PHRASE COPY: At least ONE recommendation MUST address putting the EXACT phrases the property fails to rank for (the queries above where it is absent or below the top 3) into its own copy — the page title, H1, and body of the most relevant page, the meta description, AND the Google Business Profile description/services. Name the specific phrases verbatim (e.g. 'weave "townhomes for rent in Salisbury" and "3 bedroom townhomes Salisbury MD" into the homepage title tag, H1, and the Google listing description'). This is the cheapest win when the property HAS the feature but never says the phrase. Only skip it if the property already ranks top-3 for every competitive query.
10a. WINNABLE FIRST: prioritize the SPECIFIC / local phrases the property is CLOSEST to winning (town, suburb, neighborhood, county, or near-a-landmark terms — especially ones already in the expanded Map Pack or ranking page 2-3) over broad metro-level head terms like "apartments for rent in <big city>". Broad heads are the slowest and most expensive to move, so if you mention one at all, frame it as a longer-term play, never the top near-term recommendation.
11. Priority assignment guide:
   - QUICK WIN: ≤ 4 hours, near-term measurable impact
   - MAP PACK: local 3-pack / Google-listing-driven visibility (the most distinctive SEO category)
   - FOUNDATIONAL: hygiene that everything else depends on (name/address/phone consistency, schema, complete Google listing)
   - AI VISIBILITY: getting named by AI assistants (ChatGPT/Claude/Gemini) — structured/schema data, FAQ content answering renter questions, and presence on the sources AI cites (Apartments.com, Google reviews, Reddit, "best apartments in {city}" roundups/listicles)
   - CONTENT: requires writing pages, FAQs, blog posts
   - STRATEGIC: > 1 week, multi-month positioning (backlink outreach, review campaigns)
   - LONG-TAIL: niche query optimization with lower competition
12. AI VISIBILITY: if the AI-assistant visibility above shows the property is NOT named (or ranks below the competitors listed), include at least ONE recommendation with priority "AI VISIBILITY" to fix that — cite what Claude surfaced instead, and give concrete steps (schema markup, FAQ/answer content, getting listed in local "best of" roundups, strengthening the Apartments.com + Google presence AI pulls from). If the property IS named prominently, you may skip this.
13. TECHNICAL / ON-PAGE: if the technical section above flags missing meta descriptions, missing/duplicate H1s, no JSON-LD schema, or thin content, include at least ONE "FOUNDATIONAL" recommendation to fix the on-page basics — name the specific pages from the crawl and the exact fix (e.g. 'write a 150-char meta description for /floor-plans and add a single H1'). Skip only if the crawl found no technical issues.
14. LOCAL CITATIONS: if the citation section shows the property is NOT detected on a whole directory NETWORK (e.g. the Zillow network, the RentPath network, or standalone Facebook), you MAY include ONE "FOUNDATIONAL" recommendation to claim/build a listing there with consistent name/address/phone — name the specific missing network(s). Frame it as "verify then claim" (the read is directional, from one search), and skip entirely if the major networks already appear.
15. PAGE SPEED: if the mobile PageSpeed score above is below 50 (poor) or 50-89 (needs work), include ONE recommendation to improve it — cite the actual mobile score and the weakest Core Web Vital (e.g. 'mobile score 38/100, LCP 6.2s'), and give concrete fixes (compress/next-gen images, defer offscreen images, reduce render-blocking scripts, enable caching/CDN). Skip if mobile scores 90+.${setAsidePromptNote(currentProperty)}`;

      // Recommendations are non-fatal: if this call blips (e.g. a transient
      // 502 from the host), still save the ranks + comp-set instead of failing
      // the whole audit. The user can re-run to refill recommendations.
      let recommendations: AuditRecommendations = [];
      try {
        const rResp = await callAI({
          prompt: recsPrompt,
          system: buildSystemPrompt(currentProperty),
          maxTokens: 4000,
        });
        // parseRecCards recovers complete cards even if the JSON is truncated,
        // so we never dump raw JSON to the UI.
        const rawText = rResp.content?.[0]?.text || "";
        recommendations = parseRecCards(rawText);
        if (Array.isArray(recommendations)) {
          recommendations = recommendations.filter((c) => {
            const t = `${c.title || ""}. ${c.what || ""}`;
            // HARD RULE: never recommend anything about the Google Business Profile
            // photo gallery (applies to every audit, not just marketing).
            if (recommendsGooglePhotos(t)) return false;
            // If the site already has an FAQ page, drop any rec to CREATE/PUBLISH a new
            // one. "Add schema to the existing FAQ" (verb "add") is NOT dropped.
            if (faqPagePath && /\b(creat\w*|publish\w*|build\w*|launch\w*|develop\w*|new)\b[\s\S]{0,50}(faq|frequently[-\s]?asked)/i.test(t)) return false;
            return true;
          });
        }
      } catch {
        /* keep recommendations empty; the audit still saves */
      }

      const finalResults: SEOAuditResults = {
        queries,
        ranks,
        recommendations,
        timestamp: new Date().toISOString(),
        location: extractLocation(currentProperty.address) || extractCity(currentProperty.address),
        localizedToProperty: !!origin,
        technicalSeo,
        citations,
        pageSpeed,
        googleRating,
        googleReviewCount,
        localReviewComparison,
      };
      setResults(finalResults);

      // Snapshot this run's per-query ranks for the before/after movement view.
      // Keep the baseline (first run) + the most recent 23 so the case-study
      // evidence survives long-term without unbounded growth.
      const snapshot: SeoRankSnapshot = {
        date: finalResults.timestamp,
        location: finalResults.location,
        ranks: queries.map((q, i) => ({
          query: q,
          organicRank: ranks[i]?.organic_rank ?? null,
          organicPage: ranks[i]?.organic_page ?? null,
          // Effective Map Pack position: top-3 rank, else the expanded (4-20)
          // position, so movement like "#8 -> #3" is captured.
          mapPackRank: (ranks[i]?.map_pack_rank ?? ranks[i]?.expanded_map_pack_rank) ?? null,
        })),
      };
      const priorSnapshots = currentProperty.seoRankSnapshots ?? [];
      const nextSnapshots = [...priorSnapshots, snapshot];
      const cappedSnapshots =
        nextSnapshots.length > 24 ? [nextSnapshots[0], ...nextSnapshots.slice(-23)] : nextSnapshots;

      onUpdateProperty({
        ...currentProperty,
        seoAudit: finalResults,
        llmRank: llmRankResult ?? currentProperty.llmRank,
        seoRankSnapshots: cappedSnapshots,
        // Persist the exact set we checked so every future run reuses it
        // (sticky). User add/remove edits this list between runs.
        trackedQueries: queries,
      });
      setStage("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Audit failed.");
      setStage("idle");
    }
  };

  // Aggregate metrics
  const summary = results ? computeSeoSummary(results, property) : null;

  return (
    <div style={{ background: "white", borderRadius: 10, padding: 24, boxShadow: "0 1px 6px rgba(0,0,0,0.07)", marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 16, letterSpacing: "0.08em", textTransform: "uppercase", color: B.oxford }}>
              SEO &amp; Website Optimization
            </div>
            <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 20, padding: "2px 10px", display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 6, height: 6, background: "#22c55e", borderRadius: "50%", display: "inline-block", animation: "lp 2s infinite" }} />
              <span style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 11, color: "#15803d", letterSpacing: "0.04em" }}>LIVE</span>
            </div>
          </div>
          <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 12, color: "#aaa", marginTop: 3 }}>
            Auto-generates relevant queries (plus any you've pinned below), checks Google Map Pack + organic rank AND whether AI assistants name you, then returns ranked recommendations.
          </div>
          {results && results.timestamp && (
            <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 11, color: "#888", marginTop: 4 }}>
              Last audited {new Date(results.timestamp).toLocaleString()}
            </div>
          )}
          {(results || property.seoAudit || (property.seoRankSnapshots?.length ?? 0) > 0) && (
            <button
              onClick={resetSeoHistory}
              disabled={isRunning}
              style={{
                marginTop: 6,
                padding: 0,
                border: "none",
                background: "none",
                fontFamily: "'Josefin Sans',sans-serif",
                fontSize: 11,
                color: "#b14a2a",
                cursor: isRunning ? "default" : "pointer",
                textDecoration: "underline",
                opacity: isRunning ? 0.5 : 1,
              }}
              title="Wipe this property's SEO results + rank-trend snapshots so the next SEO run is a clean first run. Marketing / Review / AI-rank history kept."
            >
              Reset SEO history
            </button>
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
          title="Web-search audit across the auto-generated queries plus any you've pinned"
        >
          <span>✦</span>
          {isRunning ? "Auditing..." : results ? "Re-run Audit" : "Run SEO Audit"}
        </button>
      </div>

      {/* Tracked search queries — the STICKY set checked on every run. Seeded
          on the first audit, then reused so rank movement is comparable. */}
      <div
        style={{
          background: "white",
          border: "1px solid #e6e9ec",
          borderRadius: 8,
          padding: "12px 16px",
          marginBottom: 16,
        }}
      >
        <div
          style={{
            fontFamily: "'Barlow Condensed',sans-serif",
            fontWeight: 700,
            fontSize: 12,
            letterSpacing: "0.09em",
            textTransform: "uppercase",
            color: B.oxford,
            marginBottom: 2,
          }}
        >
          Tracked search queries
        </div>
        <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 11, color: "#aaa", marginBottom: 10 }}>
          The fixed set checked every run, so &ldquo;Since Start&rdquo; movement stays comparable over time. Auto-filled on the first audit — add or remove queries here and the change sticks for all future runs.
        </div>
        {trackedQueries.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
            {trackedQueries.map((q) => (
              <span
                key={q}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  background: "#eef4f3",
                  border: `1px solid ${B.cambridge}`,
                  borderRadius: 16,
                  padding: "3px 6px 3px 11px",
                  fontFamily: "'Josefin Sans',sans-serif",
                  fontSize: 12,
                  color: "#2a4d49",
                }}
              >
                {q}
                <button
                  onClick={() => removeTrackedQuery(q)}
                  title="Remove this query from the tracked set (permanent — it won't be checked on future runs)"
                  style={{
                    border: "none",
                    background: "transparent",
                    color: "#7a8089",
                    cursor: "pointer",
                    fontSize: 14,
                    lineHeight: 1,
                    padding: "0 2px",
                  }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : (
          <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 11.5, color: "#9aa3ad", fontStyle: "italic", marginBottom: 10 }}>
            No queries yet — the first audit auto-generates a starting set. Or add your own below to seed it.
          </div>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={newQuery}
            onChange={(e) => setNewQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTrackedQuery();
              }
            }}
            placeholder="e.g. 3 bed apartments in Salisbury"
            style={{
              flex: 1,
              border: "1px solid #d8dee4",
              borderRadius: 6,
              padding: "8px 11px",
              fontFamily: "'Josefin Sans',sans-serif",
              fontSize: 13,
              color: "#2a2a2a",
              outline: "none",
            }}
          />
          <button
            onClick={addTrackedQuery}
            disabled={!newQuery.trim()}
            style={{
              background: newQuery.trim() ? B.caribbean : "#cfd6da",
              border: "none",
              borderRadius: 6,
              padding: "8px 16px",
              color: "white",
              fontFamily: "'Barlow Condensed',sans-serif",
              fontWeight: 700,
              fontSize: 13,
              letterSpacing: "0.06em",
              cursor: newQuery.trim() ? "pointer" : "default",
              whiteSpace: "nowrap",
            }}
          >
            + Add
          </button>
        </div>
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
          {/* ===== Group 1: SEO & Online Presence (ranks, AI, citations) ===== */}
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 16, letterSpacing: "0.08em", textTransform: "uppercase", color: B.oxford, borderBottom: `2px solid ${B.caribbean}`, paddingBottom: 6, marginBottom: 16 }}>
            SEO &amp; Online Presence
          </div>

          {/* Scorecard */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12, marginBottom: 18 }}>
            <KPI
              label="Map Pack hits (top 3)"
              value={`${summary.mapPackCount}/${summary.competitiveTotal}`}
              sub={
                summary.mapPackPartial > 0
                  ? `+${summary.mapPackPartial} more in expanded pack (${summary.mapPackPartial === 1 ? `#${summary.bestPartialMP}` : `best #${summary.bestPartialMP}`})`
                  : "of competitive searches"
              }
              accent={
                summary.mapPackCount >= 3
                  ? "#22c55e"
                  : summary.mapPackCount >= 1 || summary.mapPackPartial > 0
                  ? "#f59e0b"
                  : B.tangelo
              }
            />
            <KPI
              label="Avg Map Pack rank"
              value={summary.avgMapPackRank ? `#${summary.avgMapPackRank}` : "—"}
              sub={
                summary.avgMapPackRank ? (
                  <>
                    Best #{summary.bestMapPackRank} · avg of {summary.mapPackRankingCount} in the pack
                    {summary.competitiveTotal - summary.mapPackRankingCount > 0 && (
                      <>
                        <br />
                        <span style={{ color: B.tangelo, fontWeight: 700 }}>
                          absent from pack on {summary.competitiveTotal - summary.mapPackRankingCount} of {summary.competitiveTotal}
                        </span>
                      </>
                    )}
                  </>
                ) : (
                  "Not in the Map Pack for any competitive search"
                )
              }
              accent={coverageRankAccent(summary.avgMapPackRank, summary.mapPackRankingCount, summary.competitiveTotal, 3, 6)}
            />
            <KPI
              label="Page 1 (organic)"
              value={`${summary.page1Count}/${summary.competitiveTotal}`}
              sub="of competitive searches"
              accent={summary.page1Count >= 4 ? "#22c55e" : summary.page1Count >= 2 ? "#f59e0b" : B.tangelo}
            />
            <KPI
              label="Avg organic rank"
              value={summary.avgRank ? `#${summary.avgRank}` : "—"}
              sub={
                summary.avgRank ? (
                  <>
                    avg of {summary.rankingCount} of {summary.competitiveTotal} that rank
                    {summary.competitiveTotal - summary.rankingCount > 0 && (
                      <>
                        <br />
                        <span style={{ color: B.tangelo, fontWeight: 700 }}>
                          absent on {summary.competitiveTotal - summary.rankingCount} of {summary.competitiveTotal} (not in top 30)
                        </span>
                      </>
                    )}
                  </>
                ) : (
                  "Not ranking for any competitive search"
                )
              }
              accent={coverageRankAccent(summary.avgRank, summary.rankingCount, summary.competitiveTotal)}
            />
            <KPI
              label="Queries audited"
              value={summary.total}
              sub={
                summary.brandedCount > 0
                  ? `${summary.competitiveTotal} competitive · ${summary.brandedCount} branded`
                  : "real-time Google search"
              }
              accent={B.oxford}
            />
            <KPI
              label="Google rating"
              value={results.googleRating != null ? `${results.googleRating.toFixed(1)} ★` : "—"}
              sub={
                results.googleRating != null ? (
                  <>
                    {results.googleReviewCount != null ? `${results.googleReviewCount} reviews` : "review count n/a"}
                    {(() => {
                      const p = selfReviewPosition(results.localReviewComparison || []);
                      return p ? (
                        <>
                          <br />
                          #{p.pos} of {p.total} nearby
                        </>
                      ) : null;
                    })()}
                  </>
                ) : (
                  "No Google rating found"
                )
              }
              accent={
                results.googleRating == null
                  ? B.oxford
                  : results.googleRating >= 4.5
                  ? "#22c55e"
                  : results.googleRating >= 4.0
                  ? "#f59e0b"
                  : B.tangelo
              }
            />
          </div>

          {/* Methodology + "search from" point + hyper-local caveat */}
          <div
            style={{
              padding: "8px 14px",
              background: "#fff8ec",
              border: "1px solid #f5e2bd",
              borderRadius: 8,
              marginBottom: 14,
              fontFamily: "'Josefin Sans',sans-serif",
              fontSize: 11.5,
              color: "#7a5b1e",
              lineHeight: 1.55,
            }}
          >
            <strong>How this is measured:</strong> for each tracked search we query Google live{" "}
            {results.localizedToProperty ? (
              <>
                from the property&rsquo;s <strong>exact location</strong> (its coordinates on its Google listing)
              </>
            ) : (
              <>from {results.location || "the property&rsquo;s city"}</>
            )}
            , then record its Map Pack (local 3-pack) position and its organic position. Google&rsquo;s local results
            are <strong>proximity-based</strong>, so checking{" "}
            {results.localizedToProperty
              ? "from the property's own spot shows what a renter searching near it actually sees"
              : "from the property's area approximates what a nearby renter sees"}{" "}
            &mdash; not a city-wide average. Map Pack positions still shift with each searcher&rsquo;s precise location
            and personalization, so read them as &ldquo;visible to someone searching near the property,&rdquo; not an
            absolute rank. Organic ranks are more stable.
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
              {summary.opportunityQuery && (
                <div style={{ padding: "12px 14px", background: "#feeee7", borderRadius: 8, borderLeft: `4px solid ${B.tangelo}` }}>
                  <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: B.tangelo, marginBottom: 4 }}>
                    {summary.opportunityWinnable ? "Biggest opportunity (winnable)" : "Longer-term target"}
                  </div>
                  <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 13, color: "#333", marginBottom: 3 }}>
                    &ldquo;{summary.opportunityQuery}&rdquo;
                  </div>
                  <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 11, color: B.tangelo }}>
                    {(() => {
                      const r = summary.opportunityRank;
                      if (!r) return "";
                      if (summary.opportunityWinnable) {
                        if (r.expanded_map_pack_rank) return `In the expanded Map Pack (#${r.expanded_map_pack_rank}) — push into the top 3`;
                        if (r.organic_rank) return `Organic #${r.organic_rank} (P${r.organic_page}) — close; winnable to page 1`;
                        if (r.map_pack_appeared) return "Appears in the Map Pack — push into the top 3";
                        return "Close — winnable with focused work";
                      }
                      return "Not ranking yet — longer-term target (broad term)";
                    })()}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Google review rank vs the local Map Pack */}
          {results.localReviewComparison && results.localReviewComparison.length >= 2 && (
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase", color: B.oxford, marginBottom: 8 }}>
                Google review rank (local pack)
              </div>
              <div style={{ border: `1px solid #e5e7eb`, borderRadius: 8, overflow: "hidden" }}>
                {results.localReviewComparison.map((e, i) => (
                  <div
                    key={`${e.name}-${i}`}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "8px 12px",
                      background: e.isSelf ? "#eef6f6" : i % 2 ? "#fafafa" : "#fff",
                      fontFamily: "'Josefin Sans',sans-serif",
                      fontSize: 12.5,
                      fontWeight: e.isSelf ? 700 : 400,
                      color: e.isSelf ? B.caribbean : "#333",
                      borderTop: i === 0 ? "none" : "1px solid #eee",
                    }}
                  >
                    <span>
                      {i + 1}. {e.name}
                      {e.isSelf ? " (you)" : ""}
                    </span>
                    <span style={{ whiteSpace: "nowrap" }}>
                      {e.rating != null ? `${e.rating.toFixed(1)} ★` : "—"}
                      {e.reviews != null ? ` · ${e.reviews} reviews` : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Branded vs competitive callout — explains why the headline only
              counts competitive searches. */}
          {summary.brandedCount > 0 && (
            <div
              style={{
                padding: "10px 14px",
                background: "#f4f7f9",
                border: "1px solid #e2e8ec",
                borderRadius: 8,
                marginBottom: 12,
                fontFamily: "'Josefin Sans',sans-serif",
                fontSize: 12,
                color: "#44505c",
                lineHeight: 1.6,
              }}
            >
              <strong style={{ color: B.oxford }}>How to read this:</strong> the scorecard above counts only the{" "}
              <strong>{summary.competitiveTotal} competitive search{summary.competitiveTotal === 1 ? "" : "es"}</strong>{" "}
              — the ones a stranger would type. The {summary.brandedCount}{" "}
              branded/navigational {summary.brandedCount === 1 ? "query" : "queries"} (your own name or street, tagged{" "}
              <span style={{ fontWeight: 700, color: "#7a8089" }}>Branded</span> in the table) {summary.brandedCount === 1 ? "is" : "are"} kept out of these numbers — ranking #1 for those is expected and doesn&rsquo;t reflect competitive visibility.
            </div>
          )}

          {summary.competitiveTotal > 0 && (
            <div
              style={{
                padding: "10px 14px",
                background: "#f4f7f9",
                border: "1px solid #e2e8ec",
                borderRadius: 8,
                marginBottom: 12,
                fontFamily: "'Josefin Sans',sans-serif",
                fontSize: 12,
                color: "#44505c",
                lineHeight: 1.6,
              }}
            >
              <strong style={{ color: B.oxford }}>Map Pack vs. organic:</strong> the{" "}
              <strong>Map Pack</strong> (the local 3-pack on the map) is what a single property can realistically win, and Google shows it to people searching <em>near you</em>, so that&rsquo;s the column to watch. For broad category searches, the <strong>organic</strong> results are owned by listing sites like Apartments.com and Zillow for <em>every</em> property, not just yours — so &ldquo;listing sites own this&rdquo; there reflects the market, not a problem with your website. Your growth levers are Map Pack visibility, reviews, and a complete, consistent Google listing.
            </div>
          )}


          {/* Per-query results table */}
          <div style={{ border: "1px solid #e8e8e8", borderRadius: 8, overflow: "hidden", marginBottom: 18 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'Josefin Sans',sans-serif", fontSize: 12 }}>
              <thead>
                <tr style={{ background: B.oxford }}>
                  {["Query", "GBP Map Pack", "Website in Organic", "Since Start", "Who's Beating You"].map((h) => (
                    <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "white" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.queries.map((q, i) => {
                  const r = results.ranks[i];
                  const branded = isBrandedQuery(q, property);
                  const mpNow = r.map_pack_rank ?? r.expanded_map_pack_rank ?? null;
                  // Smooth the Map Pack position across recent checks so a
                  // minute-to-minute boundary flip doesn't read as a real move.
                  // Falls back to the live reading until there are >=2 checks.
                  const mpSmooth = smoothedMapPack(property.seoRankSnapshots, q, 5);
                  const mpMv = movementFor(property.seoRankSnapshots, q, "mapPackRank", mpSmooth ? mpSmooth.median : mpNow);
                  const orgMv = movementFor(property.seoRankSnapshots, q, "organicRank", r.organic_rank);
                  return (
                    <tr key={i} style={{ background: i % 2 === 0 ? "white" : "#fafafa", borderBottom: "1px solid #f0f0f0" }}>
                      <td style={{ padding: "10px 12px", color: "#333" }}>
                        {q}
                        {branded && (
                          <span
                            title="Branded / navigational query (your own name or street) — not counted in the competitive scorecard"
                            style={{
                              marginLeft: 8,
                              fontFamily: "'Barlow Condensed',sans-serif",
                              fontWeight: 700,
                              fontSize: 9,
                              letterSpacing: "0.08em",
                              textTransform: "uppercase",
                              color: "#7a8089",
                              background: "#eef1f3",
                              border: "1px solid #dfe4e8",
                              borderRadius: 4,
                              padding: "1px 5px",
                              whiteSpace: "nowrap",
                            }}
                          >
                            Branded
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "10px 12px" }}>
                        {mpSmooth ? (
                          <>
                            <span
                              style={{ color: mpSmooth.median <= 3 ? "#15803d" : "#9a7200", fontWeight: 600 }}
                              title={r.diagnosis || ""}
                            >
                              #{mpSmooth.median}
                            </span>
                            {mpSmooth.max > mpSmooth.min && (
                              <span style={{ display: "block", fontSize: 10, color: "#9aa3ad" }}>
                                typically #{mpSmooth.min}–#{mpSmooth.max} · {mpSmooth.n} checks
                              </span>
                            )}
                          </>
                        ) : (
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
                              ? `#${r.expanded_map_pack_rank}`
                              : r.map_pack_appeared
                              ? "Not in top 20"
                              : "No pack"}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "10px 12px" }}>
                        <span
                          style={{
                            // Listing-site-owned organic (a category head term) is the
                            // expected market reality for EVERY property, so it reads
                            // neutral gray, not alarm-orange. Orange is reserved for a
                            // genuine gap (individual competitors rank organically, you don't).
                            color: r.organic_rank
                              ? r.organic_rank <= 10
                                ? "#15803d"
                                : r.organic_rank <= 30
                                ? "#9a7200"
                                : B.tangelo
                              : aggregatorsDominateOrganic(r.top_organic)
                              ? "#9aa3ad"
                              : B.tangelo,
                            fontWeight: 600,
                          }}
                          title={
                            !r.organic_rank && aggregatorsDominateOrganic(r.top_organic)
                              ? "For a broad category search, listing sites (Apartments.com, Zillow) own the organic results for every property — expected, not a gap. The Map Pack is the local target."
                              : ""
                          }
                        >
                          {r.organic_rank ? `#${r.organic_rank} (P${r.organic_page})` : organicAbsentLabel(r.top_organic)}
                        </span>
                      </td>
                      <td style={{ padding: "10px 12px", fontSize: 11 }} title="Rank change vs the first tracked audit (baseline)">
                        {(() => {
                          if (!rankBaseline(property.seoRankSnapshots)) return <span style={{ color: "#9aa3ad" }}>baseline set</span>;
                          const line = (lbl: string, mv: { label: string; tone: "up" | "down" | "neutral" }) => (
                            <div style={{ color: mv.label ? moveToneColor(mv.tone) : "#9aa3ad", fontWeight: mv.label ? 700 : 400 }}>
                              <span style={{ color: "#9aa3ad", fontWeight: 400 }}>{lbl} </span>
                              {mv.label || "no change"}
                            </div>
                          );
                          return (<>{line("Org", orgMv)}{line("Map", mpMv)}</>);
                        })()}
                      </td>
                      <td style={{ padding: "10px 12px", color: "#666", fontSize: 11 }}>
                        {(() => {
                          const b = competitorsBeating(property, r);
                          if (b.length) return b.slice(0, 3).join(", ") + (b.length > 3 ? ` +${b.length - 3} more` : "");
                          return r.map_pack_rank && r.map_pack_rank <= 3 ? "You lead" : "—";
                        })()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* AI assistant visibility (from the same run) */}
          {property.llmRank && property.llmRank.models[0] && (
            <div style={{ background: "white", border: "1px solid #e6e9ec", borderRadius: 8, padding: "16px 20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: B.oxford }}>
                  AI Assistant Visibility
                </span>
                {(() => {
                  const m = property.llmRank!.models[0];
                  const hasFreq = typeof m.asks === "number" && typeof m.mentions === "number";
                  const maj = hasFreq && m.mentions! * 2 >= m.asks!;
                  const bg = hasFreq ? (m.mentions === 0 ? "#FCE4E4" : maj ? "#E0F0E8" : "#FBF0D9") : m.mentionsTarget ? "#E0F0E8" : "#FCE4E4";
                  const color = hasFreq ? (m.mentions === 0 ? "#b14a2a" : maj ? "#15803d" : "#9a7200") : m.mentionsTarget ? "#15803d" : "#b14a2a";
                  const text = hasFreq
                    ? `${m.model}: named in ${m.mentions} of ${m.asks} AI answers`
                    : `${m.model}: ${m.mentionsTarget ? `names ${property.name}` : `does not name ${property.name}`}`;
                  return (
                    <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", padding: "3px 10px", borderRadius: 20, background: bg, color }}>
                      {text}
                    </span>
                  );
                })()}
              </div>
              <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 11.5, color: "#888", marginBottom: 8 }}>
                Asked “{property.llmRank.query}”{property.llmRank.models[0].asks ? ` ${property.llmRank.models[0].asks}× ` : " "}— what an AI assistant recommends to renters. AI answers vary per ask, so this is how often you&apos;re named, not a fixed rank.
              </div>
              {property.llmRank.models[0].note && (
                <p style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 12.5, color: "#444", lineHeight: 1.55, margin: "0 0 10px" }}>{property.llmRank.models[0].note}</p>
              )}
              {property.llmRank.models[0].namedProperties.length > 0 && (
                <ol style={{ margin: 0, paddingLeft: 20, fontFamily: "'Josefin Sans',sans-serif", fontSize: 12.5, lineHeight: 1.7 }}>
                  {property.llmRank.models[0].namedProperties.map((n, j) => {
                    const isUs = nameMatches(n, property.name);
                    return (
                      <li key={j} style={{ fontWeight: isUs ? 700 : 400, color: isUs ? "#15803d" : "#333" }}>
                        {n}{isUs ? " ← you" : ""}
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          )}

          {/* Local citations / directory presence (still part of online presence) */}
          <CitationsPanel
            citations={results.citations}
            aptNotAdvertising={aptListedNotAdvertising(property.marketingAudit?.consistency)}
          />

          {/* ===== Group 2: Website Optimization (the site itself) ===== */}
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 16, letterSpacing: "0.08em", textTransform: "uppercase", color: B.oxford, borderBottom: `2px solid ${B.caribbean}`, paddingBottom: 6, marginTop: 22, marginBottom: 16 }}>
            Website Optimization
          </div>

          {/* Page speed / Core Web Vitals */}
          <PageSpeedPanel ps={results.pageSpeed} />

          {/* Technical / On-Page SEO health (from the site crawl) */}
          <TechnicalSeoPanel tech={results.technicalSeo} />

          {/* Recommendations */}
          <div style={{ background: "linear-gradient(135deg,#eef7f5,#e4f0ec)", border: `1px solid ${B.cambridge}`, borderLeft: `4px solid ${B.caribbean}`, borderRadius: 8, padding: "14px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <span style={{ color: B.caribbean }}>✦</span>
              <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: B.caribbean }}>
                Recommendations (ranked by ROI)
              </span>
            </div>
            <RecommendationsBlock
              recs={results.recommendations}
              setAsideList={property.setAsideRecs}
              audit="seo"
              onSetAside={(card, reason) => onUpdateProperty(withSetAside(property, card, reason, "seo"))}
              onRestore={(key) => onUpdateProperty(withRestored(property, key))}
            />
          </div>
        </>
      )}

      {!results && !isRunning && !error && (
        <div style={{ padding: "20px 16px", background: "#fafafa", borderRadius: 8, fontFamily: "'Josefin Sans',sans-serif", fontSize: 13, color: "#888", textAlign: "center", lineHeight: 1.6 }}>
          Runs ~30–60s. Generates relevant queries (plus any you've pinned above), checks live Google rankings for each (Map Pack + organic), aggregates a scorecard, and outputs 5 ranked actions. ~$0.05–$0.10 in API cost per audit.
        </div>
      )}
    </div>
  );
}

/* ================= MARKETING AUDIT TAB ============================ */
const MK_STATUS: Record<MarketingStatus, { bg: string; fg: string; label: string }> = {
  green: { bg: "#E0F0E8", fg: "#15803d", label: "Good" },
  amber: { bg: "#fff2dd", fg: "#9a7200", label: "Check" },
  red: { bg: "#FCE4E4", fg: "#b14a2a", label: "Issue" },
  na: { bg: "#f4f6f8", fg: "#9aa3ad", label: "N/A" },
};

/** Uppercase status label for the progress diff strings (GOOD/CHECK/ISSUE/N/A). */
const MK_STATUS_WORD: Record<MarketingStatus, string> = {
  green: "GOOD",
  amber: "CHECK",
  red: "ISSUE",
  na: "N/A",
};

/**
 * True only when a property has a REAL prior Marketing Audit to diff against —
 * a previous run that actually recorded consistency rows. The "Progress Since
 * Last Audit" section keys off this so a FIRST run never shows resolved /
 * regressed items. A first run already leaves marketingAuditPrev undefined;
 * this also rejects an empty or partial baseline (import, aborted run).
 */
function hasPriorMarketingBaseline(property: Property): boolean {
  const prev = property.marketingAuditPrev;
  return !!(prev && Array.isArray(prev.consistency) && prev.consistency.length > 0);
}

/**
 * Deterministic diff between the previous Marketing Audit snapshot and the
 * current run — no AI. Compares the consistency grid (per row/platform) so a
 * client can see accountability run-to-run.
 *
 * A consistency cell is a "problem" when red (ISSUE) or amber (CHECK); "ok"
 * when green (GOOD) or na (N/A).
 */
function computeAuditProgress(
  prev: { consistency: MarketingConsistencyRow[]; timestamp: string },
  currConsistency: MarketingConsistencyRow[]
): {
  fixed: string[];
  stillOpen: string[];
  regressed: string[];
  sinceTimestamp: string;
} {
  const fixed: string[] = [];
  const stillOpen: string[] = [];
  const regressed: string[] = [];

  const isProblem = (s: MarketingStatus) => s === "red" || s === "amber";
  const isOk = (s: MarketingStatus) => s === "green" || s === "na";

  const platforms: Array<{ key: "apartments" | "google" | "website"; label: string }> = [
    { key: "apartments", label: "Apartments.com" },
    { key: "google", label: "Google" },
    { key: "website", label: "Website" },
  ];

  const currByLabel = new Map(currConsistency.map((r) => [r.label, r]));
  for (const prevRow of prev.consistency) {
    const currRow = currByLabel.get(prevRow.label);
    if (!currRow) continue; // only rows present in BOTH
    for (const { key, label } of platforms) {
      const p = prevRow[key]?.status;
      const c = currRow[key]?.status;
      if (!p || !c) continue;
      const desc = `${prevRow.label} — ${label}: ${MK_STATUS_WORD[p]} → ${MK_STATUS_WORD[c]}`;
      if (isProblem(p) && c === "green") fixed.push(desc);
      else if (isOk(p) && isProblem(c)) regressed.push(desc);
      else if (isProblem(p) && isProblem(c)) stillOpen.push(desc);
    }
  }

  return { fixed, stillOpen, regressed, sinceTimestamp: prev.timestamp };
}

function MkStatusCell({ cell }: { cell: { status: MarketingStatus; note: string } }) {
  const s = MK_STATUS[cell.status] || MK_STATUS.amber;
  return (
    <td style={{ padding: "8px 10px", background: s.bg, borderBottom: "1px solid #eef0f2", verticalAlign: "top" }}>
      <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", color: s.fg, marginBottom: 2 }}>
        {s.label}
      </div>
      <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 11.5, color: "#333", lineHeight: 1.45 }}>{cell.note}</div>
    </td>
  );
}

/** Stringify SerpAPI place_results hours into a readable day-by-day list. */
function formatGbpHours(place: any): string {
  const h = place?.hours;
  if (!Array.isArray(h) || h.length === 0) return "not listed on Google";
  return h
    .map((entry: any) => {
      if (entry && typeof entry === "object") {
        if (entry.day) {
          const times = Array.isArray(entry.times) ? entry.times.join(", ") : entry.hours || entry.time || "";
          return `${entry.day}: ${times}`.trim();
        }
        const k = Object.keys(entry)[0];
        if (k) return `${k}: ${entry[k]}`;
      }
      return String(entry);
    })
    .filter(Boolean)
    .join("; ");
}

function MarketingAuditTab({
  property,
  onUpdateProperty,
}: {
  property: Property;
  onUpdateProperty: (p: Property) => void;
}) {
  const [website, setWebsite] = useState(property.website ?? "");
  const [aptUrl, setAptUrl] = useState(property.apartmentsUrl ?? "");
  const [gbpUrl, setGbpUrl] = useState(property.gbpUrl ?? "");
  const [stage, setStage] = useState<"idle" | "running" | "done">("idle");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<MarketingAuditResult | null>(property.marketingAudit ?? null);
  // True once an audit has been RUN this session (not merely loaded from
  // storage). Drives the "you're viewing a saved audit — re-run to refresh" hint
  // so a stale saved result is never mistaken for the current code's output.
  const [ranThisSession, setRanThisSession] = useState(false);

  useEffect(() => {
    setWebsite(property.website ?? "");
    setAptUrl(property.apartmentsUrl ?? "");
    setGbpUrl(property.gbpUrl ?? "");
    setResults(property.marketingAudit ?? null);
    setStage(property.marketingAudit ? "done" : "idle");
    setError(null);
    setProgress("");
    setRanThisSession(false);
  }, [property.id]);

  // Re-sync the URL fields when the stored values change out from under the
  // form — e.g. after batch enrichment / re-detect overwrites them — so the
  // Marketing Audit inputs reflect the latest saved data. Keyed on the values
  // (the effect above only fires on a property switch). Safe against typing:
  // editing a field updates local state only, not property.*.
  useEffect(() => {
    setWebsite(property.website ?? "");
    setAptUrl(property.apartmentsUrl ?? "");
    setGbpUrl(property.gbpUrl ?? "");
  }, [property.website, property.apartmentsUrl, property.gbpUrl]);

  const running = stage === "running";

  const run = async () => {
    setError(null);
    if (!website.trim()) {
      setError("Add the property website URL first.");
      return;
    }
    // Capture the PRIOR run BEFORE any fetching or property mutation. The
    // checklistStatuses snapshotted here are the OLD ones (before this run
    // overwrites them), which is what the "Progress Since Last Audit" diff
    // compares against. Deterministic — no AI involved.
    const prevSnapshot = property.marketingAudit
      ? {
          consistency: property.marketingAudit.consistency,
          checklistStatuses: { ...(property.checklistStatuses ?? {}) },
          timestamp: property.marketingAudit.timestamp,
        }
      : undefined;
    setStage("running");
    setResults(null);

    // Persist any URL edits up front so the run uses (and saves) them.
    let current: Property = { ...property, website: website.trim(), apartmentsUrl: aptUrl.trim(), gbpUrl: gbpUrl.trim() };
    onUpdateProperty(current);

    try {
      // --- Google Business Profile ground truth (deterministic via SerpAPI) ---
      setProgress("Pulling Google Business Profile data…");
      let gbpBlock = "GOOGLE BUSINESS PROFILE: could not be verified automatically this run — fetch the provided Google URL if present, otherwise mark Google cells 'Requires Client Verification'.";
      let googlePhotos: string[] = [];
      let googleWebsiteUrl = ""; // the "Website" link shown on the Google listing
      let gbpHadData = false; // true once SerpAPI returned a real Google profile
      let googlePhone = "";
      let officeHours: Record<string, string> | undefined;
      try {
        const serpData = await callSerp({
          query: buildGbpSearchQuery(current),
          engine: "google_maps",
          location: extractLocation(current.address),
        });
        const gbp = extractGBP(serpData, current);
        const place = serpData?.place_results;
        googlePhone = (place?.phone || "").toString();
        // GBP hours (day -> "9 AM–5 PM"), used to auto-flag whether the dial
        // test landed during office hours. SerpAPI returns an array of {day: hours}.
        if (Array.isArray(place?.hours)) {
          const map: Record<string, string> = {};
          for (const row of place.hours as Record<string, string>[]) {
            const day = Object.keys(row || {})[0];
            if (day) map[day.toLowerCase()] = String(row[day]);
          }
          if (Object.keys(map).length) officeHours = map;
        }
        // Google profile photo URLs for the vision pass. Use the direct Google
        // CDN thumbnails (not the serpapi proxy) and downsize to ~512px to keep
        // vision token cost low.
        googlePhotos = (Array.isArray(place?.images) ? place.images : [])
          .map((im: any) => im?.thumbnail || "")
          .filter((u: string) => /^https?:\/\//i.test(u) && !/serpapi\.com/i.test(u))
          .map((u: string) => u.replace(/=w\d+-h\d+/i, "=w512-h512"))
          .slice(0, 8);
        // The google_maps SEARCH result only carries photos when it resolves to
        // a single place; when it returns a list (common), place.images is empty
        // even though ground truth was matched. Fall back to the dedicated
        // photos endpoint keyed by the place's data_id so the vision grade still
        // runs instead of degrading to "quality not assessed".
        if (googlePhotos.length < 2 && gbp?.dataId) {
          try {
            const photoData = await callSerp({ engine: "google_maps_photos", data_id: gbp.dataId });
            googlePhotos = (Array.isArray(photoData?.photos) ? photoData.photos : [])
              .map((p: any) => p?.thumbnail || p?.image || "")
              .filter((u: string) => /^https?:\/\//i.test(u))
              .map((u: string) => u.replace(/=w\d+-h\d+/i, "=w512-h512"))
              .slice(0, 8);
          } catch {
            /* best-effort; grading falls back to "quality not assessed" */
          }
        }
        if (gbp || place) {
          const rating = gbp?.rating ?? (typeof place?.rating === "number" ? place.rating : null);
          const reviewCount = gbp?.reviewCount ?? (typeof place?.reviews === "number" ? place.reviews : null);
          gbpBlock = `GOOGLE BUSINESS PROFILE GROUND TRUTH (verified via SerpAPI — authoritative for Google; do NOT re-fetch Google Maps):
- Listing name: "${gbp?.name || place?.title || "(unknown)"}"
- Address on Google: ${gbp?.address || place?.address || "(not shown)"}
- Hours on Google: ${formatGbpHours(place)}
- Rating: ${rating !== null ? rating + " stars" : "not shown"}
- Review count: ${reviewCount !== null ? reviewCount : "not shown"}
- Website link on Google: ${gbp?.website || place?.website || "not shown"}
- Phone on Google: ${place?.phone || "not shown"}
- Note: Google may surface aggregator-pulled pricing; never mark Google pricing "green".`;
          googleWebsiteUrl = gbp?.website || place?.website || "";
          gbpHadData = true;
        }
      } catch {
        /* best-effort; proceed without GBP ground truth */
      }

      // --- Apartments.com active-listing confirmation (deterministic) ---
      // Apartments.com is JS-rendered + bot-protected, so a static fetch often
      // comes back empty even when the listing is fully active. Confirm via a
      // Google search whether an Apartments.com listing for this property is
      // indexed, so the audit never falsely reports "not advertising".
      let aptConfirmed = false;
      try {
        const listingData = await callSerp({
          query: `${current.name} ${extractCity(current.address)}`.trim(),
          engine: "google",
          location: extractLocation(current.address),
        });
        aptConfirmed = extractListingPlatforms(listingData, current).includes("Apartments.com");
      } catch {
        /* best-effort */
      }
      // --- Render the website + Apartments.com with a real headless browser ---
      // Penetrates JS-rendered and bot-protected sites that a plain fetch (or
      // Claude's web_fetch) can't read.
      setProgress("Rendering the website with a real browser (60–90s)…");
      let siteText = "";
      let siteImages: string[] = [];
      let siteBlocked = false;
      let leasingPlatform: string | null = null;
      try {
        const siteRes = await callFetch({ url: current.website || "", follow: true, maxPages: 5 });
        const sitePages = siteRes.pages || [];
        siteText = sitePages
          .map((p) => `=== ${p.url} (status ${p.status ?? "?"}) ===\n${(p.text || "").trim() || "[no content rendered]"}`)
          .join("\n\n");
        siteImages = siteRes.images || [];
        leasingPlatform = (siteRes as { platform?: string | null }).platform ?? null;
        // "Blocked" = nothing usable came back (empty, or every page 403/thin) —
        // e.g. an aggressive Cloudflare challenge our headless browser can't pass.
        // In that case we tell Claude to fetch the site with its OWN web_fetch,
        // which reaches sites our browser is 403'd from (same as Apartments.com).
        siteBlocked =
          !sitePages.some((p) => p.status === 200 && (p.text || "").trim().length > 50);
      } catch {
        siteText = "";
        siteBlocked = true;
      }

      // Office hours (and the leasing phone) usually live on the CONTACT page as
      // static HTML, but the follow-crawl can miss it or get 403'd on it — leaving us
      // showing "couldn't read hours" for a page that plainly displays them. When the
      // crawl surfaced no hours, fetch the Contact page directly (plain fetch, Bright
      // Data fallback) and fold its text into siteText so the hours reconciliation,
      // the phone inventory, AND the model all see the real Contact-page content.
      if (current.website && Object.keys(parseWeekHours(siteText || "")).length === 0) {
        try {
          let origin = "";
          try {
            origin = new URL(/^https?:\/\//i.test(current.website) ? current.website : `https://${current.website}`).origin;
          } catch {
            /* ignore */
          }
          const crawledContact = (siteText.match(/===\s*(https?:\/\/[^\s(]*contact[^\s(]*)/i) || [])[1];
          const contactUrl = crawledContact || (origin ? `${origin}/contact/` : "");
          if (contactUrl) {
            setProgress("Reading the Contact page for office hours…");
            const pr = await fetch("/api/pagetext", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url: contactUrl }),
            });
            const pj = (await pr.json()) as { text?: string };
            if (pj?.text && Object.keys(parseWeekHours(pj.text)).length > 0) {
              siteText += `\n\n=== Contact page (fetched directly: ${contactUrl}) ===\n${pj.text}`;
            }
          }
        } catch {
          /* best-effort — the hours cell stays "verify" if this fails */
        }
      }

      // Deterministic website concession detection — run BEFORE the prompt so the
      // special can be fed to the model as GROUND TRUTH. Otherwise the model
      // misses it and writes "the property offers no concessions / launch one"
      // even though we detected (and green-flagged) a live special.
      const websiteSpecial = siteText ? detectWebsiteSpecial(siteText) : null;

      // Dedicated Apartments.com read — its OWN retryable web_fetch, not buried
      // in the big audit call, so the listing facts are reliable and the model
      // just reports them instead of re-fetching (see readApartmentsListing).
      setProgress("Reading the Apartments.com listing…");
      const aptRead = current.apartmentsUrl ? await readApartmentsListing(current.apartmentsUrl) : null;
      // AUTHORITATIVE advertising verdict from the raw HTML (Bright Data). The
      // web_fetch-based read flip-flops: the "not currently advertising" banner is
      // JS-painted (absent from HTML), and the pricing proxy false-positives on the
      // nearby-listings section. This checks the raw HTML for the property's OWN
      // pricing section (active) vs "Explore Similar Rentals Nearby" (dark shell)
      // and overrides when determinable. Null result -> keep the web_fetch read.
      // Does the accurate weekly schedule from the raw HTML back the apts hours?
      // The model reader misreads collapsed days, so unless we confirm hours from
      // the raw HTML we must NOT trust its apts hours for the consistency check.
      let aptHoursVerified = false;
      let aptWebsiteUrl: string | null = null;
      let aptHasVirtualTour = false;
      if (current.apartmentsUrl && aptRead) {
        try {
          const sr = await fetch("/api/apts-status", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: current.apartmentsUrl }),
          });
          const sj = (await sr.json()) as {
            advertising?: boolean | null;
            officeHours?: Record<string, string> | null;
            concession?: string | null;
            websiteUrl?: string | null;
            virtualTour?: boolean | null;
          };
          const rawFetchOk = typeof sj.advertising === "boolean";
          if (rawFetchOk) {
            aptRead.advertising = sj.advertising as boolean;
            aptRead.ok = true;
          }
          // AUTHORITATIVE hours from the raw HTML (includes closed days). Overrides
          // the model's collapsed-view guess.
          if (sj.officeHours && Object.keys(sj.officeHours).length) {
            aptRead.officeHours = sj.officeHours;
            aptHoursVerified = true;
          }
          // AUTHORITATIVE concession from the raw HTML. Overrides the model's read
          // (which has reported stale/fabricated offers like "Apply by July 3"). When
          // the good raw fetch shows NO concession, clear the model's guess rather
          // than assert a wrong one.
          if (sj.concession) aptRead.concessions = sj.concession;
          else if (rawFetchOk && sj.advertising !== false) aptRead.concessions = "";
          // The listing's "View Property Website" outbound link (direct anchor to the
          // property domain) — used below to verify it reaches the real site.
          if (sj.websiteUrl) aptWebsiteUrl = sj.websiteUrl;
          // Matterport / 3D / virtual-tour PRESENCE from raw HTML — reliable, unlike
          // the model's flip-flopping media-summary count.
          if (sj.virtualTour === true) aptHasVirtualTour = true;
        } catch {
          /* keep the web_fetch-based read */
        }
      }

      const apartmentsBlock = !current.apartmentsUrl
        ? "APARTMENTS.COM LISTING: no listing URL was provided."
        : aptRead && aptRead.ok && aptRead.advertising === false
        ? `APARTMENTS.COM LISTING (${current.apartmentsUrl}): the listing shows "This property is NOT currently advertising on Apartments.com" — an inactive shell with no live data. Mark EVERY Apartments.com cell "na" with note "Not advertising on Apartments.com". Do NOT grade any feature, and do NOT borrow data from nearby / similar listings.`
        : aptRead && aptRead.ok
        ? `APARTMENTS.COM LISTING (already read from ${current.apartmentsUrl} — treat these facts as AUTHORITATIVE, do NOT re-fetch the URL):
- Advertising / active: ${aptRead.advertising === null ? "unknown" : aptRead.advertising ? "yes, active listing with units" : "listing present but not advertising units"}
- Pricing: ${aptRead.priceText || "not shown"}${aptRead.beds ? ` (${aptRead.beds})` : ""}${aptRead.sqft ? `, ${aptRead.sqft}` : ""}
- Office hours (as listed): ${Object.keys(aptRead.officeHours).length ? Object.entries(aptRead.officeHours).map(([d, h]) => `${d} ${h}`).join(", ") : "not shown on the listing"}
- Media on listing (verbatim gallery badge): "${aptRead.mediaSummary || "not shown"}"
- Concession / special: ${aptRead.concessions || "none advertised"}
- Tour scheduling (Request-a-Tour / contact form): ${aptRead.tourScheduling === null ? "unknown" : aptRead.tourScheduling ? "available" : "not found"}
- Online application / inquiry: ${aptRead.onlineApplication === null ? "unknown" : aptRead.onlineApplication ? "available" : "not found"}
- Amenities: ${aptRead.amenities.join(", ") || "not listed"}
- Phone numbers on listing: ${aptRead.phones.join(", ") || "none shown"}`
        : `APARTMENTS.COM LISTING (${current.apartmentsUrl}): the dedicated read came back empty this run (partial or blocked fetch). Mark the Apartments.com cells AMBER "could not read the listing this run; verify live" — NEVER red.`;

      // Is the Apartments.com listing DARK (deterministically detected shell)? If so
      // it can't carry a concession, take an activation recommendation, etc.
      const aptIsDark = !!(aptRead && aptRead.ok && aptRead.advertising === false);

      // GROUND TRUTH for the concession — a deterministic finding the model must
      // respect (it otherwise misses the special and recommends launching one).
      const concessionText = websiteSpecial || (aptRead?.ok ? aptRead.concessions : "") || "";
      const concessionSource = websiteSpecial
        ? "website"
        : aptRead?.ok && aptRead.concessions
        ? "Apartments.com listing"
        : null;
      // When Apartments.com is dark, do NOT suggest syncing the special there — you
      // can't add a concession to a listing that isn't advertising (activate it
      // first; that's a separate recommendation).
      const concessionSyncGuidance = aptIsDark
        ? "The Apartments.com listing is NOT currently advertising (dark), so do NOT recommend adding/syncing the concession to Apartments.com — there is nothing to add it to until the listing is reactivated. You may recommend syncing it to other ACTIVE platforms only."
        : "If a platform that should carry it (e.g. Apartments.com) is missing it, you MAY recommend SYNCING/promoting THIS existing special there — never a brand-new one.";
      const concessionBlock = concessionSource
        ? `CONCESSION — DETERMINISTIC GROUND TRUTH (verified in code from the actual content): the ${concessionSource} IS currently advertising this move-in special: "${concessionText}". Treat the concession as PRESENT. Mark the website "Concessions" cell GREEN with this wording. Do NOT state anywhere — executive summary, findings, or recommendations — that the property has "no concession", "no advertised specials", or similar. Do NOT recommend LAUNCHING, CREATING, ADDING, or INTRODUCING a concession: it already has one. ${concessionSyncGuidance}`
        : "";

      // OFFICE HOURS — DETERMINISTIC RECONCILIATION (see lib/hours). Office hours
      // were model-judged and unreliable: the model flip-flopped, flagged the
      // consensus instead of the outlier, and fabricated per-page website
      // differences. Compare the STRUCTURED hours we already have — website parsed
      // from the crawl footer, Google from SerpAPI, Apartments.com from the reader —
      // and flag the real minority. Website + Google are authoritative (a genuine
      // conflict between them is RED); a reader-derived ILS outlier is AMBER "verify".
      // Computed up-front and applied to the consistency hours row below.
      const websiteHoursParsed = parseWeekHours(siteText || "");
      const hoursVerdicts = reconcileOfficeHours([
        { key: "website", label: "the website", hours: websiteHoursParsed, authoritative: true },
        { key: "google", label: "Google", hours: officeHours, authoritative: true },
        // Only trust apts hours confirmed from the RAW HTML — the model reader
        // misreads collapsed days. Unverified -> excluded from the comparison so it
        // can't manufacture a false conflict.
        { key: "apartments", label: "Apartments.com", hours: aptIsDark || !aptRead?.ok || !aptHoursVerified ? undefined : aptRead.officeHours, authoritative: false },
      ]);

      // Deterministic website-feature detection (see lib/website-features). Computed
      // up-front and used by the consistency override below to correct false
      // "missing" reds on features we can positively detect. JS-heavy sites hide features behind
      // sub-pages/widgets, so the model marks present features "missing" — but the
      // signals survive in the crawled nav/buttons/footer text.
      const websiteFeatures = detectWebsiteFeatures(siteText || "");

      // --- Website-link check: does the "Website" link on the Google listing
      // actually reach the property's live site? A missing, broken, or wrong-domain
      // link there is a MAJOR lead leak — a prospect clicks "Website" on Google and
      // never lands on the leasing site. Deterministic: SerpAPI gives the URL; we
      // compare domains and probe reachability only when the domain differs.
      setProgress("Checking the Google listing's website link…");
      const domainOf = (u: string) => {
        try {
          return new URL(/^https?:\/\//i.test(u) ? u : "https://" + u).hostname.replace(/^www\./i, "").toLowerCase();
        } catch {
          return "";
        }
      };
      const propDomain = domainOf(current.website || "");
      const gWebDomain = domainOf(googleWebsiteUrl);
      // Actually FOLLOW the exact URL Google lists and confirm it resolves to a live
      // page (via /api/linkcheck — follows redirects; a 403/429 bot-wall still counts
      // as "up"). reachable=false is a genuinely broken click-through; null = we
      // couldn't determine (often our IP being blocked), so don't cry wolf.
      let gReach: { reachable?: boolean | null; finalDomain?: string } | null = null;
      if (googleWebsiteUrl) {
        try {
          const rr = await fetch("/api/linkcheck", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: googleWebsiteUrl }),
          });
          gReach = await rr.json();
        } catch {
          gReach = null;
        }
      }
      const gFinal = (gReach?.finalDomain || "").toLowerCase();
      let googleLink: { status: MarketingStatus; note: string };
      if (!gbpHadData) {
        googleLink = { status: "na", note: "No Google profile data this run." };
      } else if (!googleWebsiteUrl) {
        googleLink = { status: "red", note: "No website link on the Google listing — prospects can't click through to your site." };
      } else if (propDomain && gWebDomain && gWebDomain !== propDomain) {
        // Google points to a different domain than the property's site.
        googleLink =
          gReach?.reachable === false
            ? { status: "red", note: `Google's website link (${gWebDomain}) doesn't load — a broken click-through for prospects.` }
            : { status: "amber", note: `Google's website link goes to ${gWebDomain}, not your site (${propDomain}) — verify it's intended.` };
      } else if (gReach?.reachable === false) {
        googleLink = { status: "red", note: `The Website link on your Google listing (${propDomain}) returned an error and didn't load — verify it's live.` };
      } else if (gReach?.reachable === true && gFinal && propDomain && gFinal !== propDomain) {
        // Loads, but redirects off your domain to somewhere else.
        googleLink = { status: "amber", note: `The Google Website link redirects to ${gFinal}, not ${propDomain} — verify it's intended.` };
      } else if (gReach?.reachable === true) {
        googleLink = { status: "green", note: `Verified: the Website link on Google opens your live site${propDomain ? ` (${propDomain})` : ""}.` };
      } else {
        // Couldn't live-test (our IP likely blocked) — the link points to your own
        // domain, so treat it as working rather than crying wolf.
        googleLink = { status: "green", note: `Website link on Google points to your site${propDomain ? ` (${propDomain})` : ""} (couldn't live-test this run).` };
      }
      // Apartments.com "View Property Website" link. When we extracted the actual
      // outbound URL from the raw HTML (aptWebsiteUrl), VERIFY it: confirm its domain
      // is the property's, and follow it (via /api/linkcheck) to confirm it loads.
      let aptLink: { status: MarketingStatus; note: string };
      if (!aptRead || !current.apartmentsUrl) {
        aptLink = { status: "na", note: "No Apartments.com listing provided." };
      } else if (aptRead.advertising === false) {
        aptLink = { status: "na", note: "Not advertising on Apartments.com." };
      } else if (aptWebsiteUrl) {
        const linkDomain = domainOf(aptWebsiteUrl);
        if (propDomain && linkDomain && linkDomain !== propDomain) {
          aptLink = { status: "amber", note: `The listing's "View Property Website" link points to ${linkDomain}, not your site (${propDomain}) — verify it's intended.` };
        } else {
          let reach: { reachable?: boolean | null } | null = null;
          try {
            const rr = await fetch("/api/linkcheck", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url: aptWebsiteUrl }),
            });
            reach = await rr.json();
          } catch {
            reach = null;
          }
          aptLink =
            reach?.reachable === false
              ? { status: "red", note: `The listing's website link (${linkDomain || propDomain}) returned an error and didn't load — verify it's live.` }
              : { status: "green", note: `Verified: the "View Property Website" link opens your live site${propDomain ? ` (${propDomain})` : ""}.` };
        }
      } else if (!aptRead.ok) {
        aptLink = { status: "amber", note: "Could not read the Apartments.com listing this run — verify the 'View Property Website' link." };
      } else if (aptRead.hasWebsiteLink === true) {
        aptLink = { status: "green", note: "'View Property Website' link is present on the listing." };
      } else if (aptRead.hasWebsiteLink === false) {
        aptLink = { status: "amber", note: "Couldn't find the 'View Property Website' link — verify it's present and points to your site." };
      } else {
        aptLink = { status: "amber", note: "Could not confirm the 'View Property Website' link this run — verify." };
      }

      // Feed only HIGH-CONFIDENCE, actionable link problems to the rec engine:
      // Google missing (SerpAPI-definitive) or Google pointing to a different
      // domain, and an Apartments.com link that's genuinely absent. Uncertainty
      // ("couldn't read/confirm") shows in the row for visibility but doesn't
      // force a recommendation.
      const linkIssues: string[] = [];
      if (googleLink.status === "red") linkIssues.push(`Google listing: ${googleLink.note}`);
      else if (googleLink.status === "amber" && gWebDomain && propDomain && gWebDomain !== propDomain)
        linkIssues.push(`Google listing: ${googleLink.note}`);
      if (aptRead?.ok && aptRead.advertising !== false && aptRead.hasWebsiteLink === false)
        linkIssues.push(`Apartments.com listing: ${aptLink.note}`);
      const websiteLinkBlock = linkIssues.length
        ? `WEBSITE-LINK CHECK — DETERMINISTIC GROUND TRUTH: ${linkIssues.join(" ")} A prospect clicking "Website" on a listing must land on the leasing site, so a missing/broken/wrong link is a lead leak. Include a recommendation to fix the affected listing's website link.`
        : "";

      // Deterministic GROUND TRUTH for website features + leasing platform, fed to
      // the model so its executive summary / findings / recs can't claim a present
      // feature is "missing" — the model misreads JS-heavy sites, and we've already
      // detected these in code (they'd otherwise contradict the corrected table).
      const featurePresent: string[] = [];
      if (websiteFeatures.preferredEmployer) featurePresent.push("a Preferred Employer Program page");
      if (websiteFeatures.virtualTour || aptHasVirtualTour) featurePresent.push("a virtual tour / 3D tour");
      if (websiteFeatures.tourScheduling || leasingPlatform) featurePresent.push("self-serve tour scheduling");
      if (websiteFeatures.onlineApplication || leasingPlatform) featurePresent.push("an online application");
      const vtPresent = websiteFeatures.virtualTour || aptHasVirtualTour;
      const websiteFeatureBlock =
        featurePresent.length || leasingPlatform
          ? `WEBSITE FEATURES — DETERMINISTIC GROUND TRUTH (verified in code):${leasingPlatform ? ` the website runs on ${leasingPlatform}, which provides self-serve tour scheduling, online applications, and live availability.` : ""}${featurePresent.length ? ` The website HAS ${featurePresent.join(", ")}.` : ""} These features are LIVE and ACCESSIBLE. Do NOT state anywhere — executive summary, findings, or recommendations — that any of them is missing, absent, "not found", "not displayed", "not embedded", "confirmed to exist but not shown", or that prospects "can't experience" them, and do NOT recommend adding/building/publishing/"verifying" them.${vtPresent ? " In particular: the property HAS a virtual/3D tour that IS viewable — never frame virtual tours as a gap or a missing/undisplayed asset." : ""}`
          : "";
      // Gallery + neighborhood are frequent FALSE flags: our crawler can't always
      // capture gallery IMAGES (OUR limit, not a broken site), and Google Street View
      // shows a "Sorry, we have no imagery here" fallback on neighborhood maps that
      // the model misreads as missing content. Forbid turning either into a finding.
      const captureCaveatBlock = `CAPTURE CAVEATS — do NOT turn our capture limits into findings: (1) If gallery/site images weren't captured this run, that is OUR crawler limitation — the gallery is present and professional (it matches the Apartments.com listing). Do NOT say the gallery "rendered blank" / "doesn't render", and do NOT recommend verifying/fixing gallery rendering. (2) Ignore any "Sorry, we have no imagery here" text — that is a Google Street View map-widget fallback, NOT missing content. Do NOT claim the neighborhood page "lacks imagery" or recommend adding neighborhood photos.`;
      // Phone + office-hours guidance so the summary/recs stop inventing false problems.
      const phoneHoursGuidance = `PHONE & HOURS GUIDANCE: (1) Different phone numbers across platforms — and more than one number on the site (call-tracking numbers injected by scheduling/chat widgets) — are EXPECTED and intentional (lead-source tracking). Do NOT call phone numbers "confusing" or "inconsistent", and do NOT recommend standardizing/consolidating them; the only real phone problem is a number that does not RING (dial-tested separately). (2) Office hours were confirmed CONSISTENT across the platforms we could read. If the website's hours weren't in the captured pages, that is a capture limitation (hours usually sit on the Contact page) — do NOT claim the website is "missing office hours" or recommend adding them.`;

      setProgress("Analyzing content and writing the report…");
      const prompt = `You are a senior multifamily marketing auditor producing a concise, client-facing Marketing Audit for ${current.name} at ${current.address}.${current.propertyType ? ` This is a ${current.propertyType} community.` : ""}

PROPERTY WEBSITE${current.website ? ` (${current.website})` : ""}:
${
  siteBlocked
    ? `Our headless browser was BLOCKED by the site's bot protection (Cloudflare / 403), so no page content is below. FETCH the website URL above with your web_fetch tool and report what you ACTUALLY see there (office hours, floor plans/pricing, tour scheduling, online application, concessions, amenities, photos). Treat web_fetch content as authoritative for the website columns, exactly like the Apartments.com listing. Only if web_fetch ALSO cannot access it, mark the website rows amber "could not verify; check live".`
    : `the pages below were captured with a REAL headless browser, so JavaScript-rendered pricing, floor plans, galleries, tour tools, and specials ARE included. Report ONLY what you actually see in them:\n${siteText}`
}

${apartmentsBlock}${aptConfirmed ? "\n[An Apartments.com listing for this property is confirmed live and indexed on Google.]" : ""}

${gbpBlock}${concessionBlock ? "\n\n" + concessionBlock : ""}${websiteLinkBlock ? "\n\n" + websiteLinkBlock : ""}${websiteFeatureBlock ? "\n\n" + websiteFeatureBlock : ""}

${captureCaveatBlock}

${phoneHoursGuidance}

RULES (apply strictly):
- WEBSITE: use whichever source is available above — the headless-rendered pages OR your own web_fetch of the site if the browser was blocked. READ it and report real data: mark a feature GREEN with the actual numbers/details (real prices, unit counts, special wording, hours) when present; mark it RED only when the feature is structurally ABSENT from what you can see. Mark AMBER only if BOTH the headless browser AND your web_fetch failed to load the site (truly could not verify). Do NOT mark rows amber just because the headless browser was blocked if your web_fetch reached the site.
- APARTMENTS.COM — REPORT FROM THE PROVIDED FACTS, DO NOT RE-FETCH. Base every Apartments.com cell on the "APARTMENTS.COM LISTING" facts block above (already read for you). When it shows an active listing with units, mark "currently advertising / active" GREEN and report the real pricing/hours/etc. from those facts. A field shown there is reliable — report it, do not mark it "could not verify". Mark an Apartments.com cell AMBER "could not read the listing this run; verify live" ONLY when the facts block itself says the read came back empty, or a specific field there reads "unknown / not shown". NEVER red for a field the facts simply don't mention.
- APARTMENTS.COM VIRTUAL TOUR — USE THE PROVIDED MEDIA SUMMARY. The facts block lists the listing's media counts. If it shows one or more Virtual Tours, mark "Virtual tour" GREEN. If it shows photos/videos but ZERO virtual tours, mark it RED (the listing genuinely has no virtual tour). Only if the media counts are unknown, mark it AMBER. (A code check also enforces this from the media counts, so match it.)
- APARTMENTS.COM IS AN ILS — its lead flow IS the "Request a Tour" / contact/message form, which routes inquiries to the property. That is the intended behavior, NOT a deficiency. For "Tour scheduling", mark GREEN when a Request-a-Tour or contact option exists. For "Online application", Apartments.com is NOT expected to host the property's own application portal (prospects apply on the property website) — mark it GREEN when the listing lets a prospect inquire/request, or "na"; NEVER red for "no apply link" or "message form only". Do not treat Apartments.com's contact/message form as a missing feature.
- APARTMENTS.COM — PREFERRED EMPLOYERS IS NOT AN ILS FIELD. A preferred-employer program is a property-website feature, not a standard Apartments.com listing field. Always set the Apartments.com "Preferred employers" cell to "na" with note "Not an ILS feature"; NEVER mark it red or amber. The website column still catches a genuinely missing program, so this is not a lost finding.
- GOOGLE SCOPE: a Google Business Profile only carries active presence, hours, photos, rating/reviews, and the website link. For rows it does NOT carry (pricing, concessions, preferred employers, online application, tour scheduling, virtual tour) set the Google status to "na" with note "Not a Google feature". Never put amber/red in those Google cells. Because these are not Google listing features, NEVER write a recommendation that adds ANY of them to Google / a Google Business Profile / Google Posts / Google Maps / Google Street View. That means NO "add the concession/special to Google", NO "publish the virtual tour / Matterport to Google", NO "post pricing/floor plans to Google", NO "add the preferred-employer program / online application / tour scheduling to Google". If it's marked "Not a Google feature", it gets ZERO Google-targeted recommendations — full stop. (A recommendation to fix Google HOURS, PHOTOS, REVIEWS, DESCRIPTION, or the WEBSITE LINK is fine — those ARE Google features.)
- OFFICE HOURS = CONSISTENCY CHECK. First, normalize the values: a day shown as "12 AM to 12 AM" (or "12:00 AM to 12:00 AM" / "00:00 to 00:00") is a ZERO-LENGTH window that means CLOSED, not open 24 hours. Treat it as Closed. Then compare the hours across platforms day by day. Only flag a genuine difference in OPEN/CLOSE TIMES on a day both platforms are open (e.g. "Google shows weekdays starting at 10 AM, but the website and Apartments.com show 9 AM, and Google shows Saturday closing at 4 PM vs 2 PM elsewhere"). Mark the conflicting cells RED (ISSUE) with that plain-English note — a confirmed hours conflict is a real problem that sends prospects to a closed office, so it is an ISSUE, not a soft CHECK. Use AMBER for hours ONLY when you genuinely could not read the hours on a platform (not when the hours simply differ). Do NOT flag "12 AM to 12 AM" as open 24 hours, a data-entry error, or a conflict — it just means Closed. Mark hours GREEN when they match (treating 12 AM-12 AM as Closed). Write plainly; never use jargon like "structurally invalid".
- PHOTOS = QUALITY, NOT PRESENCE. Mark GREEN only when the content shows genuinely professional, high-quality photos (a real gallery with sharp interior/amenity/exterior images). The mere existence of photos is NOT enough. If you can only confirm photos exist but cannot judge quality (e.g. a Google profile that "has photos", or just a count), mark AMBER "photos present, quality not assessed". Never mark photos GREEN from presence alone.
- WEBSITE PRICING / AVAILABILITY lives on the FLOOR PLANS or AVAILABILITY page, NOT the homepage. Grade this GREEN when the floor plans / availability page shows per-plan pricing or availability ("Starting at $X", "$1,806", "4 Available", or a live availability/pricing widget) — even if some plans read "Call for details" / "Inquire", and even if the homepage shows no prices. It is CORRECT and expected that the homepage has no rent prices. NEVER mark website pricing RED/ISSUE or AMBER merely because the homepage lacks prices. Only mark it RED when there is NO floor plans or availability page at all (nowhere on the site to see pricing/units).
- DO NOT flag differing PHONE NUMBERS across platforms as a discrepancy. Different tracking numbers are intentional for lead-source attribution.
- PRICING & CONCESSIONS ARE NOT CONFLICTS. Rents and specials change constantly and Apartments.com / aggregator data lags the website (the website is authoritative), so small differences are normal and expected. NEVER mark pricing or concessions RED for a website-vs-Apartments.com mismatch. If both platforms show pricing, mark GREEN even when the ranges differ modestly (e.g. $2,149-$2,440 vs $2,190-$2,430 is fine — not an issue). If both advertise a concession, mark GREEN even when the wording or deadline differs (e.g. "first month free, apply by July 3" vs "Summer Savings, first month free"). Use AMBER only when they MATERIALLY contradict (one advertises a concession the other flatly denies, or a price is off by a large, prospect-misleading margin) with a plain "align these" note. This softer treatment is for pricing/concessions only; it does NOT loosen the office-hours rule.
- DETECTING A CONCESSION — scan the FULL page text, including any "[EMBEDDED WIDGETS]" section and homepage promo banners / popups (not just a dedicated Specials page). A move-in special, waived or reduced application fees, half-off / discounted / free security deposit, free rent ("first month free", "X weeks free"), or any "Limited-Time Special" / "Move-in Special" banner IS a concession — mark the website Concessions GREEN with the special's wording when any of these appear anywhere in the content.
- CONCESSIONS ABSENCE IS NOT A DEFICIENCY. A concession/special is an OPTIONAL promotion, not a required feature. If no concession is currently offered, mark the concessions cell "na" with note "No concession currently offered" — NEVER red. Only when a concession IS advertised on one platform but missing from another should the missing side be AMBER ("add the special to this listing"), never red. A concession present is green.
- Plain English, concise, no em dashes as punctuation, no "Note:" sections.

Status values are exactly "green" (found & functional / consistent), "amber" (present but could not verify / could not render, OR a non-critical inconsistency to align — e.g. pricing/concession wording that differs), "red" (confirmed absent OR a confirmed OPERATIONAL conflict that misleads a prospect, e.g. office hours that genuinely do not match — NOT pricing or concession differences, which follow the tolerance rule above), or "na" (not applicable to that platform).

Return ONLY this JSON object, no prose before or after:
{
  "consistency": [
    {"label":"Currently advertising / active","apartments":{"status":"...","note":"..."},"google":{"status":"...","note":"..."},"website":{"status":"...","note":"..."}},
    {"label":"Office hours listed","apartments":{"status":"...","note":"..."},"google":{"status":"...","note":"..."},"website":{"status":"...","note":"..."}},
    {"label":"Pricing / availability","apartments":{"status":"...","note":"..."},"google":{"status":"...","note":"..."},"website":{"status":"...","note":"..."}},
    {"label":"Photos quality","apartments":{"status":"...","note":"..."},"google":{"status":"...","note":"..."},"website":{"status":"...","note":"..."}},
    {"label":"Virtual tour","apartments":{"status":"...","note":"..."},"google":{"status":"...","note":"..."},"website":{"status":"...","note":"..."}},
    {"label":"Concessions listed","apartments":{"status":"...","note":"..."},"google":{"status":"...","note":"..."},"website":{"status":"...","note":"..."}},
    {"label":"Preferred employers","apartments":{"status":"...","note":"..."},"google":{"status":"...","note":"..."},"website":{"status":"...","note":"..."}},
    {"label":"Tour scheduling","apartments":{"status":"...","note":"..."},"google":{"status":"...","note":"..."},"website":{"status":"...","note":"..."}},
    {"label":"Online application","apartments":{"status":"...","note":"..."},"google":{"status":"...","note":"..."},"website":{"status":"...","note":"..."}}
  ],
  "phoneNumbers": {
    "website": ["every phone/tracking number displayed on the website, digits as shown"],
    "apartments": ["every phone/tracking number on the Apartments.com listing"],
    "google": ["the phone number on the Google listing if visible"]
  },
  "apartmentsPhotos": ["direct image URLs (the actual src) of the first few photos in the Apartments.com listing's photo gallery, e.g. https://images1.apartments.com/...; up to 6; ONLY real URLs you can actually see in the fetched page, NEVER invented, guessed, or constructed; [] if you cannot see any image URLs"]
}`;

      // Website content is provided (Playwright); Apartments.com is fetched by
      // Claude's web_fetch (which penetrates it where Playwright is 403'd).
      const data = await callAI({ prompt, webFetch: true, maxTokens: 6000 });
      const text = (data.content || [])
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("\n");
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("The audit did not return a structured result. Try again.");
      const parsed = JSON.parse(match[0]) as Partial<MarketingAuditResult>;

      // When the Apartments.com listing is DARK, inject a fixed recommendation to
      // turn it back on — with an explicit escape hatch in case the property intends
      // it to be off. Deterministic so the wording + escape hatch are reliable.
      const aptActivationCard: RecommendationCard = {
        priority: "FOUNDATIONAL",
        title: "Reactivate the Apartments.com listing (ignore if intentionally off)",
        what: 'Apartments.com shows "This property is not currently advertising on Apartments.com," so the listing is dark: anyone who finds you there lands on a shell and is funneled to the competitors in the "Explore Similar Rentals Nearby" panel. IF this is intentional (you have chosen not to advertise on Apartments.com), IGNORE this. Otherwise, contact your Apartments.com rep and reactivate the paid listing — upload the floor plans, current pricing, the active move-in special, photos, and the Matterport tour so it matches the website.',
        why: "A dark listing on the largest rental network leaks prospects straight to the competitors shown on your own shell page.",
        effort: "~1 day · marketing manager + Apartments.com rep",
        success: "Listing live with pricing, photos, and available units within 1 week (or confirmed intentionally off).",
        source: 'Apartments.com: "not currently advertising" (shell listing).',
      };

      // --- Vision pass: actually LOOK at the website gallery photos ---
      // The text audit can only confirm photos exist; here we hand the real
      // gallery image URLs to a vision model to grade marketing quality, then
      // overwrite the website "Photos quality" cell with a
      // real verdict instead of "present, quality not assessed".
      const consistency = parsed.consistency || [];
      // Insert the DETERMINISTIC "Website link works" row (computed in code above,
      // not model judgment) near the top — a broken/missing/wrong website link on
      // the Google listing is a major lead leak. Apartments.com routes inquiries
      // through its own contact form, so there's no outbound website link to test.
      {
        const websiteLinkRow: MarketingConsistencyRow = {
          label: "Website link works",
          apartments: aptLink,
          google: googleLink,
          website: { status: "na", note: "This is the destination site." },
        };
        const advIdx = consistency.findIndex((r) => /currently advertising|active/i.test(r?.label || ""));
        consistency.splice(advIdx >= 0 ? advIdx + 1 : consistency.length, 0, websiteLinkRow);
      }
      // SMART CLAMP for Apartments.com reds. The listing fetch is bot-protected
      // and SOMETIMES comes back partial — a red from a partial read can't prove
      // a feature is absent, so it must not manufacture a false ISSUE. But when
      // the fetch clearly SUCCEEDED (the listing returned several confirmed green
      // cells with real data), a red is a genuine "not on the listing" gap and
      // should stand as a real, decisive finding — not be disguised as "couldn't
      // read it." So we only soften reds to "verify live" amber when the read
      // looks partial/unreliable.
      //
      // Read-quality signal: how many Apartments.com cells came back green. Per
      // the audit's own rules the model marks a feature it couldn't clearly SEE
      // as amber (never red), so 3+ green cells means the listing genuinely came
      // through and any remaining red reflects a real absence, not a block.
      const aptGreenCount = consistency.filter(
        (r) => r?.apartments?.status === "green"
      ).length;
      const aptReadSucceeded = aptGreenCount >= 3;
      if (!aptReadSucceeded) {
        for (const row of consistency) {
          if (row?.apartments?.status === "red") {
            row.apartments = {
              status: "amber",
              note: "Could not confirm on the Apartments.com listing this run (bot-limited fetch); verify live.",
            };
          }
        }
      }
      // Preferred employers is NOT a standard Apartments.com listing field — it
      // lives on the property website. Like Google, pin it to N/A on the ILS so
      // the model can't flip it to a red ISSUE run-to-run (which just double-
      // counts the real website finding). Deterministic — no coin-flip.
      for (const row of consistency) {
        if (/preferred employer/i.test(row?.label || "") && row?.apartments) {
          row.apartments = {
            status: "na",
            note: "Not an ILS feature; preferred-employer programs live on the property website.",
          };
        }
      }
      // Force the website "Concessions" cell GREEN from the deterministic special
      // detected BEFORE the prompt (same value fed to the model as ground truth),
      // so the cell can't disagree with the model or be missed by it.
      if (websiteSpecial) {
        const concRow = consistency.find((r) => /concession/i.test(r?.label || ""));
        if (concRow) {
          concRow.website = { status: "green", note: websiteSpecial || "Move-in special advertised on the website." };
        }
      }
      // Concessions are an OPTIONAL promo, not a required feature — absence is
      // never a deficiency. If no concession is offered anywhere, a red just
      // means "none currently offered" -> neutral N/A. If a concession IS shown
      // on one platform but missing on another, that's a mild "align" AMBER, not
      // a red ISSUE. Deterministic backup to the prompt rule.
      {
        const concRow = consistency.find((r) => /concession/i.test(r?.label || ""));
        if (concRow) {
          const hasConcessionSomewhere = (["apartments", "website"] as const).some(
            (col) => concRow[col]?.status === "green"
          );
          for (const col of ["apartments", "website"] as const) {
            if (concRow[col]?.status === "red") {
              concRow[col] = hasConcessionSomewhere
                ? { status: "amber", note: "No concession shown here; align with the platform that advertises one." }
                : { status: "na", note: "No concession currently offered (not a deficiency)." };
            }
          }
        }
      }
      // Office-hours row — OVERWRITE with the deterministic reconciliation computed
      // up-front (structured website/Google/Apartments.com hours). Replaces the
      // model's unreliable judgment that flip-flopped, flagged the consensus instead
      // of the outlier, and fabricated per-page differences. Only overwrites the
      // cells we have a deterministic verdict for; leaves the rest (e.g. a dark
      // Apartments.com listing stays "na").
      if (hoursVerdicts) {
        const hoursRow = consistency.find((r) => /\bhours?\b/i.test(r?.label || ""));
        if (hoursRow) {
          if (hoursVerdicts.website) hoursRow.website = hoursVerdicts.website;
          else {
            // We couldn't parse hours from the site capture. That's a CAPTURE miss —
            // hours usually live on the Contact page, which our crawl doesn't always
            // reach — NOT a confirmed absence. Don't show a lenient GOOD (the model
            // did that with a contradictory "not displayed" note) and don't red it.
            // Amber "verify"; the model's own Contact-page read is unreliable here.
            hoursRow.website = {
              status: "amber",
              note: "Couldn’t read office hours in the site capture this run — verify live (usually on the Contact page). Consistent with Google/Apartments.com where checked.",
            };
          }
          if (hoursVerdicts.google) hoursRow.google = hoursVerdicts.google;
          if (hoursVerdicts.apartments && !aptIsDark) hoursRow.apartments = hoursVerdicts.apartments;
          // Apts active but hours NOT confirmed from raw HTML -> don't show the model's
          // collapsed-view guess as a graded schedule; mark it verify (and it was never
          // fed into the comparison, so it didn't create a false conflict either).
          else if (!aptIsDark && !aptHoursVerified && aptRead?.ok) {
            // When the website AND Google already agree on the hours, they're
            // established — a lone amber on Apartments.com (whose collapsed "View All
            // Hours" display we couldn't parse this run) reads as a problem when there
            // isn't one. Show it consistent, transparently noting we didn't separately
            // parse the listing. Only fall back to amber "verify" when we DON'T have
            // two agreeing authoritative sources to stand on.
            const siteGoogleAgree =
              hoursVerdicts.website?.status === "green" && hoursVerdicts.google?.status === "green";
            hoursRow.apartments = siteGoogleAgree
              ? {
                  status: "green",
                  note: "Hours match across your website and Google; Apartments.com shows them behind “View All Hours” (not separately parsed this run).",
                }
              : {
                  status: "amber",
                  note: "Full weekly hours weren’t readable from the listing this run — verify on Apartments.com (the listing collapses them behind “View All Hours”).",
                };
          }
        }
      }
      // WEBSITE FEATURE RECONCILIATION. On JS-heavy sites the features live on
      // sub-pages / widgets our crawler can't fully render, so the model turned
      // CAPTURE FAILURES ("page not accessible", "images not rendered") into red
      // ISSUEs — false negatives. Rule: a website feature is GREEN when we positively
      // detect it (crawled text or the Apartments.com read), and it must NEVER be red
      // just because we couldn't capture it — unconfirmed red -> amber "verify live".
      {
        const feats = websiteFeatures;
        const aptVT = !!(aptRead?.ok && aptRead.mediaCounts.virtualTours && aptRead.mediaCounts.virtualTours > 0);
        const aptPhotosGood = consistency.find((r) => /photo/i.test(r?.label || ""))?.apartments?.status === "green";
        const setWeb = (labelRe: RegExp, present: boolean, greenNote: string, verifyNote: string) => {
          const row = consistency.find((r) => labelRe.test(r?.label || ""));
          if (!row) return;
          if (present) row.website = { status: "green", note: greenNote };
          else if (row.website?.status === "red") row.website = { status: "amber", note: verifyNote };
        };
        // Preferred-employer is an OPTIONAL program (like a concession) — its absence
        // is not a deficiency, so it must never read as a to-do. GREEN when we
        // positively detect the page; otherwise neutral N/A, NOT an amber "verify live"
        // (a capture miss on an optional feature isn't a finding).
        {
          const peRow = consistency.find((r) => /preferred employer/i.test(r?.label || ""));
          if (peRow) {
            peRow.website = feats.preferredEmployer
              ? { status: "green", note: "Preferred Employer Program page is present on the site." }
              : { status: "na", note: "No preferred-employer page detected on the site (optional program)." };
          }
        }
        setWeb(
          /virtual tour/i,
          feats.virtualTour || aptVT,
          feats.virtualTour ? "Virtual tour available on the site." : "Virtual tours confirmed (present on the Apartments.com listing).",
          "Couldn’t confirm a virtual tour from the capture — verify live (often on the floor-plans page)."
        );
        // A recognized leasing platform (Funnel/RentCafe/Entrata/…) provides
        // self-serve tour scheduling, online application, and availability as core
        // functions — so a detected platform confirms these even when the widget
        // itself renders no text signal for the crawl to catch.
        setWeb(
          /tour scheduling/i,
          feats.tourScheduling || !!leasingPlatform,
          leasingPlatform ? `Self-serve tour scheduling via ${leasingPlatform}.` : "Self-serve tour scheduling is present on the site.",
          "Couldn’t confirm a self-serve scheduler from the capture — verify live."
        );
        setWeb(
          /online application/i,
          feats.onlineApplication || !!leasingPlatform,
          leasingPlatform ? `Online application via ${leasingPlatform}.` : "Online application / Apply is present on the site.",
          "Couldn’t confirm an online application from the capture — verify live."
        );
        // Photos: if our image capture failed (vision pass couldn't run) but the
        // gallery exists and the Apartments.com listing has professional photos, treat
        // the website gallery as present rather than flagging a capture miss.
        const photoRow = consistency.find((r) => /photo/i.test(r?.label || ""));
        if (photoRow && photoRow.website && photoRow.website.status !== "green" && /captur|render|not.*shown|could/i.test(photoRow.website.note || "")) {
          photoRow.website =
            feats.gallery && aptPhotosGood
              ? { status: "green", note: "Professional gallery present (matches the Apartments.com listing); site images weren’t captured this run." }
              : { status: "amber", note: "Gallery page exists but images weren’t captured this run — verify live." };
        }
      }
      // Virtual tour on Apartments.com. A Matterport/3D/virtual-tour marker in the
      // RAW HTML is the authoritative PRESENCE signal (the model's media-summary
      // count flip-flops — it reported "6 tours" one run and "none" the next, and
      // missed the Matterport tab entirely). Trust raw HTML first; only fall back to
      // the media count when the raw fetch was inconclusive.
      if (aptRead && aptRead.ok && aptRead.advertising !== false) {
        const vtRow = consistency.find((r) => /virtual tour/i.test(r?.label || ""));
        if (vtRow) {
          if (aptHasVirtualTour) {
            vtRow.apartments = { status: "green", note: "Matterport / 3D tour present on the listing." };
          } else if (aptRead.mediaCounts.virtualTours !== null) {
            const vts = aptRead.mediaCounts.virtualTours;
            vtRow.apartments = vts > 0
              ? { status: "green", note: `Media summary lists ${vts} virtual tour${vts > 1 ? "s" : ""}.` }
              : { status: "amber", note: "No virtual tour found in the media summary — verify on the listing." };
          }
        }
      }
      // Photo grades captured to drive the Google-vs-controlled comparison below:
      // Google photos are flagged only when the property HAS professional photos
      // on the website/listing that its Google profile is missing.
      let webPhotoStatus: MarketingStatus | null = null;
      let aptPhotoStatus: MarketingStatus | null = null;
      let googleHasPro: boolean | null = null;
      if (siteImages.length >= 2) {
        try {
          setProgress("Assessing photo quality…");
          const photoPrompt = `These ${Math.min(siteImages.length, 8)} images are from the website gallery of ${current.name}, a ${current.propertyType || "multifamily apartment"} community. Judge PHOTOGRAPHIC quality — lighting, focus/sharpness, framing/composition, resolution — the way a leasing prospect perceives it. Vacant or unstaged units are NORMAL for a rental gallery: do NOT downgrade for empty rooms or lack of staging. Return ONLY JSON, no prose: {"status":"green|amber|red","note":"one concise clause under 18 words citing what you actually see"}. green = professional real-estate photography (well-lit, sharp, properly framed), EVEN IF units are empty; amber = several genuinely weak shots (noticeably dark, blurry, crooked/tilted, low-res phone snapshots) OR only one or two usable photos total; red = clearly amateur throughout or almost no usable photos. When in doubt between green and amber for a clean, well-lit set, choose green.`;
          const pResp = await callAI({ prompt: photoPrompt, images: siteImages, maxTokens: 400 });
          const pText = (pResp.content || [])
            .filter((b: any) => b.type === "text")
            .map((b: any) => b.text)
            .join("");
          const pm = pText.match(/\{[\s\S]*\}/);
          if (pm) {
            const pj = JSON.parse(pm[0]) as { status?: string; note?: string };
            if (pj.status === "green" || pj.status === "amber" || pj.status === "red") {
              const verdict: { status: MarketingStatus; note: string } = { status: pj.status, note: (pj.note || "").trim() || "Gallery photos assessed" };
              webPhotoStatus = verdict.status;
              const row = consistency.find((c) => /photo/i.test(c.label));
              if (row) row.website = { status: verdict.status, note: verdict.note };
            }
          }
        } catch {
          /* keep the text-only "present, quality not assessed" fallback */
        }
      }

      // --- Google profile photos: assess whether the PROFESSIONAL set is present ---
      // Not an absolute quality grade of the gallery (that flip-flopped and threw
      // false alarms on visitor uploads). The one concrete, stable question: does
      // the Google profile carry the property's professional marketing photos, or
      // is it mostly casual visitor snapshots? The verdict is applied below, only
      // when the website/listing actually HAS a professional set to mirror.
      if (googlePhotos.length >= 2) {
        try {
          setProgress("Checking Google profile photos…");
          const gPrompt = `These ${Math.min(googlePhotos.length, 8)} images are the Google Business Profile gallery of ${current.name}. The property markets itself with professional photos elsewhere. QUESTION: does THIS Google gallery INCLUDE professional, owner-posted marketing photos (well-lit, staged, wide-angle interiors, amenities, exteriors), or is it mostly casual visitor phone snapshots that don't present the property at its best? A few odd visitor shots are fine — judge whether a professional set is PRESENT. Return ONLY JSON, no prose: {"hasProfessional": true|false}.`;
          const gResp = await callAI({ prompt: gPrompt, images: googlePhotos, maxTokens: 200 });
          const gText = (gResp.content || [])
            .filter((b: any) => b.type === "text")
            .map((b: any) => b.text)
            .join("");
          const gm = gText.match(/\{[\s\S]*\}/);
          if (gm) {
            const gj = JSON.parse(gm[0]) as { hasProfessional?: boolean };
            if (typeof gj.hasProfessional === "boolean") googleHasPro = gj.hasProfessional;
          }
        } catch {
          /* leave googleHasPro null -> not flagged (can't confirm a gap) */
        }
      }

      // --- Vision pass on the Apartments.com listing photos (separate verdict) ---
      // The listing fetch can't judge photo QUALITY from a media count ("16
      // Photos"), so the model returns the gallery image URLs (apartmentsPhotos)
      // and we grade them exactly like the website/Google galleries. Apartments.com
      // CDN images are public, so the vision model can fetch them even though the
      // listing HTML is bot-protected. We only accept real apartments.com image
      // URLs; a bad/guessed URL just makes the vision call fail → the amber
      // "quality not assessed" fallback stands (no regression).
      // Prefer the dedicated reader's gallery URLs (reliable); fall back to any
      // the big audit call happened to surface.
      const parsedAptPhotos = Array.isArray(
        (parsed as { apartmentsPhotos?: unknown }).apartmentsPhotos
      )
        ? ((parsed as { apartmentsPhotos: unknown[] }).apartmentsPhotos).filter(
            (u): u is string =>
              typeof u === "string" && /^https?:\/\/[^/]*apartments\.com\//i.test(u)
          )
        : [];
      const aptPhotoUrls: string[] = (aptRead?.photoUrls.length ? aptRead.photoUrls : parsedAptPhotos).slice(0, 6);
      if (aptPhotoUrls.length >= 2) {
        try {
          setProgress("Assessing Apartments.com photos…");
          const aPrompt = `These ${Math.min(aptPhotoUrls.length, 6)} images are from the Apartments.com listing gallery of ${current.name}, a ${current.propertyType || "multifamily apartment"} community. Judge PHOTOGRAPHIC quality ONLY — lighting, focus/sharpness, framing/composition, resolution — the way a leasing prospect perceives it. Vacant or unstaged units and a basic set are NORMAL and expected for a rental listing: do NOT downgrade for empty rooms, lack of staging/furniture, or limited coverage. Return ONLY JSON, no prose: {"status":"green|amber|red","note":"one concise clause under 18 words citing what you actually see"}. green = professional real-estate photography (well-lit, sharp, properly framed), EVEN IF the units are empty; amber = several genuinely weak shots (noticeably dark, blurry, crooked/tilted, or low-res phone snapshots); red = clearly amateur throughout or almost no usable photos. When in doubt between green and amber for a clean, well-lit set, choose green.`;
          const aResp = await callAI({ prompt: aPrompt, images: aptPhotoUrls, maxTokens: 400 });
          const aTextResp = (aResp.content || [])
            .filter((b: any) => b.type === "text")
            .map((b: any) => b.text)
            .join("");
          const am = aTextResp.match(/\{[\s\S]*\}/);
          if (am) {
            const aj = JSON.parse(am[0]) as { status?: string; note?: string };
            if (aj.status === "green" || aj.status === "amber" || aj.status === "red") {
              const row = consistency.find((c) => /photo/i.test(c.label));
              if (row) row.apartments = { status: aj.status, note: (aj.note || "").trim() || "Listing photos assessed" };
              aptPhotoStatus = aj.status;
            }
          }
        } catch {
          /* keep the text-only "quality not assessed" fallback */
        }
      }

      // If the Apartments.com listing is a shell (the page says the property is
      // NOT currently advertising), there is nothing to grade and the model must
      // not borrow data from nearby listings — collapse EVERY Apartments.com cell
      // to a neutral N/A. Runs last so it overrides all other Apartments guards.
      if (aptRead && aptRead.ok && aptRead.advertising === false) {
        for (const row of consistency) {
          if (row?.apartments) {
            row.apartments = { status: "na", note: "Not advertising on Apartments.com." };
          }
        }
      }

      // --- Google photos verdict: flag only a real, actionable gap ---
      // If the property has professional photos on the website or Apartments.com
      // but its Google profile is missing that set, flag it (amber) — prospects
      // lean on the Google profile and it isn't showing the property at its best.
      // Otherwise GOOD. Capped at amber (a Google gallery is never a red issue), and
      // a failed/unavailable check (googleHasPro null) is never flagged.
      if (googlePhotos.length >= 2) {
        const row = consistency.find((c) => /photo/i.test(c.label));
        if (row) {
          const proSource =
            webPhotoStatus === "green"
              ? "website"
              : aptPhotoStatus === "green"
              ? "Apartments.com listing"
              : "";
          if (googleHasPro === false && proSource) {
            row.google = {
              status: "amber",
              note: `Professional ${proSource} photos aren't on the Google profile — upload them so prospects see the property at its best.`,
            };
          } else if (googleHasPro === true) {
            row.google = { status: "green", note: "Professional photos are posted to the Google profile." };
          } else {
            row.google = { status: "green", note: "Active profile gallery." };
          }
        }
      }

      // --- Phone / tracking number inventory ---
      // Website + Google are pulled deterministically (crawl text regex + the
      // SerpAPI GBP phone); Apartments.com comes from what the model saw on its
      // web_fetch (the listing is bot-protected, so no deterministic path).
      const aiPhones = (parsed as { phoneNumbers?: { website?: string[]; apartments?: string[]; google?: string[] } }).phoneNumbers || {};
      const phoneEntries: PhoneNumberEntry[] = [];
      const seenPhone = new Set<string>();
      const addPhone = (raw: string, source: PhoneNumberEntry["source"]) => {
        const n = normalizePhone(raw);
        if (n.length !== 10) return;
        const key = `${source}|${n}`;
        if (seenPhone.has(key)) return;
        seenPhone.add(key);
        phoneEntries.push({ number: formatPhone(raw), source });
      };
      extractPhones(siteText).forEach((p) => addPhone(p, "Website"));
      (Array.isArray(aiPhones.website) ? aiPhones.website : []).forEach((p) => addPhone(p, "Website"));
      if (googlePhone) addPhone(googlePhone, "Google");
      (Array.isArray(aiPhones.google) ? aiPhones.google : []).forEach((p) => addPhone(p, "Google"));
      // Apartments.com phones come from the dedicated reader (reliable; empty
      // when the listing isn't advertising, so no borrowed nearby-listing number).
      (aptRead?.phones ?? []).forEach((p) => addPhone(p, "Apartments.com"));
      // Prune phantom WEBSITE numbers. Funnel/RentCafe scheduling+chat widgets inject
      // call-tracking numbers into the DOM that extractPhones picks up but that aren't
      // the property's displayed number — confusing (a number the client "can't find
      // on any page"). When the site's canonical number (the one that matches the
      // Google listing) is present, keep only that on the Website row and drop the
      // widget-injected extras. If none matches Google, keep all (can't tell which).
      const gNorm = googlePhone ? normalizePhone(googlePhone) : "";
      const websiteNums = phoneEntries.filter((e) => e.source === "Website");
      if (gNorm && websiteNums.length > 1 && websiteNums.some((e) => normalizePhone(e.number) === gNorm)) {
        const pruned = phoneEntries.filter((e) => e.source !== "Website" || normalizePhone(e.number) === gNorm);
        phoneEntries.length = 0;
        phoneEntries.push(...pruned);
      }
      let phones: PhoneInventory | undefined = phoneEntries.length
        ? { numbers: phoneEntries, collectedAt: new Date().toISOString(), officeHours }
        : undefined;

      // Dial-test the numbers as part of the audit (best-effort). If Twilio is
      // not configured or the call fails, the numbers still show — just without
      // a Connected/No-connection verdict.
      if (phones && phones.numbers.length) {
        setProgress("Dial-testing the tracking numbers…");
        try {
          const dialRes = await fetch("/api/dial", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ numbers: phones.numbers.map((n) => n.number) }),
          });
          const dialData = await dialRes.json();
          if (dialRes.ok && Array.isArray(dialData.results)) {
            const byNum = new Map<string, DialResult>(
              dialData.results.map((res: DialResult) => [normalizePhone(res.number), res])
            );
            phones = {
              ...phones,
              dialTested: true,
              dialTestedAt: new Date().toISOString(),
              numbers: phones.numbers.map((n) => {
                const res = byNum.get(normalizePhone(n.number));
                return res
                  ? { ...n, dialStatus: res.status as PhoneNumberEntry["dialStatus"], dialNote: res.detail, answeredBy: res.answeredBy, ringSeconds: res.ringSeconds }
                  : n;
              }),
            };
          }
        } catch {
          /* best-effort — leave numbers untested if the dial check fails */
        }
        // Drop dial-confirmed phantom numbers (a "failed" dial = invalid/unreachable,
        // e.g. a leasing-widget tracking number that isn't a live line). Only when at
        // least one other number connected, so a dial-wide outage can't wipe the list.
        if (phones?.dialTested) phones = { ...phones, numbers: dropDeadDialedNumbers(phones.numbers) };
      }

      // DETERMINISTIC RECOMMENDATIONS. The marketing recs are generated ENTIRELY
      // from the finalized consistency table — never from model free-text. Every
      // RED cell becomes a templated fix card (lib/coverage.ts) and a dark
      // Apartments.com listing gets the reactivation card. A recommendation can
      // therefore only exist for a real, verified issue and can never contradict
      // the table. This replaced the model-authored rec path (and its stack of
      // drop-filters) that kept inventing fixes for things that weren't wrong.
      // Amber/verify cells stay as table annotations, not recs. Single source of
      // truth in lib/coverage.ts, covered by tests/detectors.test.ts.
      const tableCards = allFindingCards(consistency, { aptIsDark }) as RecommendationCard[];
      let recsFinal: RecommendationCard[] = aptIsDark ? [aptActivationCard, ...tableCards] : tableCards;
      // Stable priority ordering — critical hygiene leads, longer-horizon work trails.
      const RECS_PRIORITY_RANK: Record<string, number> = {
        FOUNDATIONAL: 0, "QUICK WIN": 1, "MAP PACK": 2, "AI VISIBILITY": 3, CONTENT: 4, STRATEGIC: 5, "LONG-TAIL": 6,
      };
      recsFinal = [...recsFinal].sort(
        (a, b) => (RECS_PRIORITY_RANK[a.priority] ?? 9) - (RECS_PRIORITY_RANK[b.priority] ?? 9)
      );

      const result: MarketingAuditResult = {
        criticalIssues: parsed.criticalIssues || [],
        consistency,
        recommendations: recsFinal,
        summary: parsed.summary || [],
        sources: { website: current.website, apartments: current.apartmentsUrl, google: current.gbpUrl },
        phones,
        timestamp: new Date().toISOString(),
      };

      current = {
        ...current,
        marketingAudit: result,
        marketingAuditPrev: prevSnapshot ?? property.marketingAuditPrev,
      };
      onUpdateProperty(current);
      setResults(result);

      setStage("done");
      setProgress("");
      setRanThisSession(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Marketing audit failed.");
      setStage("idle");
      setProgress("");
    }
  };

  const inputStyle: React.CSSProperties = {
    flex: 1,
    border: "1px solid #d8dee4",
    borderRadius: 6,
    padding: "8px 11px",
    fontFamily: "'Josefin Sans',sans-serif",
    fontSize: 13,
    color: "#2a2a2a",
    outline: "none",
  };
  const labelStyle: React.CSSProperties = {
    fontFamily: "'Josefin Sans',sans-serif",
    fontSize: 11,
    color: "#888",
    width: 130,
    flexShrink: 0,
    alignSelf: "center",
  };

  // Clear this property's saved audit history so the next run is a clean first
  // run (URLs + settings kept). For rolling a property to a fresh baseline —
  // e.g. after an audit-methodology change makes old runs non-comparable.
  const resetAuditHistory = () => {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        `Clear all saved audit history for "${property.name}"?\n\nThis wipes the Marketing, SEO, Review, and AI-rank results and their trend snapshots. The property's URLs and settings are kept, so the next run starts as a clean first run. This cannot be undone.`
      )
    ) {
      return;
    }
    const cleaned: Property = { ...property };
    for (const f of [
      "marketingAudit", "marketingAuditPrev", "seoAudit", "seoRankSnapshots",
      "reviewAudit", "reviewSnapshots", "llmRank", "checklistStatuses",
      "checklistEvidence", "llmAuditRecommendations", "llmAuditTimestamp",
    ] as const) {
      delete (cleaned as unknown as Record<string, unknown>)[f];
    }
    onUpdateProperty(cleaned);
    setResults(null);
    setStage("idle");
    setError(null);
    setProgress("");
  };

  return (
    <div style={{ background: "white", borderRadius: 10, padding: 24, boxShadow: "0 1px 6px rgba(0,0,0,0.07)" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 14 }}>
        <div>
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 18, letterSpacing: "0.06em", textTransform: "uppercase", color: B.oxford }}>
            Marketing Audit
          </div>
          <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 12, color: "#aaa", marginTop: 3 }}>
            Reviews the property website, Apartments.com listing, and Google Business Profile for leasing readiness and cross-platform consistency.
          </div>
          {results?.timestamp && (
            <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 11, color: "#888", marginTop: 4 }}>
              Last audited {new Date(results.timestamp).toLocaleString()}
            </div>
          )}
          {(results || property.seoAudit || property.reviewAudit || property.llmRank || property.marketingAuditPrev) && (
            <button
              onClick={resetAuditHistory}
              disabled={running}
              style={{
                marginTop: 6,
                padding: 0,
                border: "none",
                background: "none",
                fontFamily: "'Josefin Sans',sans-serif",
                fontSize: 11,
                color: "#b14a2a",
                cursor: running ? "default" : "pointer",
                textDecoration: "underline",
                opacity: running ? 0.5 : 1,
              }}
              title="Wipe this property's saved audit history (URLs + settings kept) so the next run is a clean first run."
            >
              Reset audit history
            </button>
          )}
        </div>
        <button
          onClick={run}
          disabled={running}
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
            cursor: running ? "wait" : "pointer",
            opacity: running ? 0.7 : 1,
            display: "flex",
            alignItems: "center",
            gap: 8,
            whiteSpace: "nowrap",
          }}
          title="Fetches the website + Apartments.com via Claude and the Google listing via SerpAPI, then writes a client-ready audit."
        >
          <span>✦</span>
          {running ? "Auditing…" : results ? "Re-run Marketing Audit" : "Run Marketing Audit"}
        </button>
      </div>

      {/* URL inputs */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 10 }}>
          <span style={labelStyle}>Website</span>
          <input value={website} onChange={(e) => setWebsite(e.target.value)} style={inputStyle} placeholder="https://www.villageatsnowfield.com" />
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <span style={labelStyle}>Apartments.com</span>
          <input value={aptUrl} onChange={(e) => setAptUrl(e.target.value)} style={inputStyle} placeholder="https://www.apartments.com/<slug>/<id>/" />
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <span style={labelStyle}>Google listing</span>
          <input value={gbpUrl} onChange={(e) => setGbpUrl(e.target.value)} style={inputStyle} placeholder="https://www.google.com/maps/place/..." />
        </div>
      </div>

      {results && !ranThisSession && !running && (
        <div
          data-print-hide="true"
          style={{
            marginBottom: 14,
            padding: "9px 14px",
            background: "#fff8e6",
            border: "1px solid #f2d98a",
            borderRadius: 8,
            fontFamily: "'Josefin Sans',sans-serif",
            fontSize: 12.5,
            color: "#8a6d1a",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span aria-hidden>↻</span>
          <span>
            Showing your last saved audit{results.timestamp ? ` from ${new Date(results.timestamp).toLocaleDateString()}` : ""}. Click <strong>Run Marketing Audit</strong> to refresh it with the latest checks.
          </span>
        </div>
      )}

      {running && (
        <div style={{ marginTop: 14, padding: "12px 16px", background: "#f9fafb", borderRadius: 8, fontFamily: "'Josefin Sans',sans-serif", fontSize: 13, color: B.caribbean, display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ display: "flex", gap: 4 }}>
            {[0, 1, 2].map((n) => (
              <div key={n} style={{ width: 5, height: 5, background: B.caribbean, borderRadius: "50%", animation: `bounce 0.9s ${n * 0.18}s infinite` }} />
            ))}
          </div>
          <span>{progress}</span>
        </div>
      )}

      {error && (
        <div style={{ marginTop: 14, padding: "10px 16px", background: "#feeee7", borderRadius: 8, fontFamily: "'Josefin Sans',sans-serif", fontSize: 13, color: B.tangelo }}>
          Audit error: {error}
        </div>
      )}

      {!results && !running && !error && (
        <div style={{ marginTop: 16, padding: "20px 16px", background: "#fafafa", borderRadius: 8, fontFamily: "'Josefin Sans',sans-serif", fontSize: 13, color: "#888", textAlign: "center", lineHeight: 1.6 }}>
          Runs ~60–90s. Reads the three platforms, flags leasing-conversion gaps, and writes color-coded findings, critical issues, an ILS/Google consistency check, and tiered recommendations.
        </div>
      )}

      {results && (
        <MarketingAuditResultView results={results} property={property} onUpdateProperty={onUpdateProperty} />
      )}
    </div>
  );
}

/**
 * Phone / tracking number inventory with an optional Twilio dial-test. Lists
 * every number found by source; the "Test-call each number" button places a
 * brief automated call to each (via /api/dial) and marks it connected / no
 * connection. Results persist onto the property's marketingAudit.phones.
 */
function PhoneInventoryPanel({
  phones,
  property,
  onUpdateProperty,
  sectionTitle,
  para,
}: {
  phones: PhoneInventory;
  property: Property;
  onUpdateProperty: (p: Property) => void;
  sectionTitle: React.CSSProperties;
  para: React.CSSProperties;
}) {
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runDialTest = async () => {
    setTesting(true);
    setError(null);
    try {
      const numbers = phones.numbers.map((n) => n.number);
      const r = await fetch("/api/dial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numbers }),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d?.error || "Dial test failed.");
        setTesting(false);
        return;
      }
      const byNum = new Map<string, DialResult>(
        (d.results || []).map((res: DialResult) => [normalizePhone(res.number), res])
      );
      const updatedNumbers = dropDeadDialedNumbers(
        phones.numbers.map((n) => {
          const res = byNum.get(normalizePhone(n.number));
          return res
            ? { ...n, dialStatus: res.status as PhoneNumberEntry["dialStatus"], dialNote: res.detail, answeredBy: res.answeredBy, ringSeconds: res.ringSeconds }
            : n;
        })
      );
      if (property.marketingAudit) {
        onUpdateProperty({
          ...property,
          marketingAudit: { ...property.marketingAudit, phones: { ...phones, numbers: updatedNumbers, dialTested: true, dialTestedAt: new Date().toISOString() } },
        });
      }
    } catch {
      setError("Dial test request failed.");
    }
    setTesting(false);
  };

  const badge = (n: PhoneNumberEntry) => {
    if (testing) return <span style={{ color: "#9aa3ad", fontSize: 11 }}>testing…</span>;
    const s = n.dialStatus;
    const secs = typeof n.ringSeconds === "number" ? n.ringSeconds : null;
    const green = { color: "#15803d", fontWeight: 700, fontSize: 11.5 } as React.CSSProperties;
    const amber = { color: "#9a7200", fontWeight: 700, fontSize: 11.5 } as React.CSSProperties;
    const red = { color: B.tangelo, fontWeight: 700, fontSize: 11.5 } as React.CSSProperties;
    if (s === "failed") return <span style={red}>✗ No connection (dead / invalid)</span>;
    if (s === "unknown") return <span style={amber}>? Inconclusive</span>;
    if (s === "connected") {
      if (n.answeredBy === "human") return <span style={green}>✓ Answered by a person{secs != null ? ` (${secs}s to answer)` : ""}</span>;
      if (n.answeredBy === "voicemail") return <span style={amber}>⚠ Went to voicemail{secs != null ? ` (${secs}s)` : ""}</span>;
      if (n.answeredBy === "fax") return <span style={amber}>⚠ Fax line</span>;
      // No answering-machine verdict — say plainly what the line did.
      if (n.dialNote === "no-answer") return <span style={amber}>◦ Rang{secs != null ? ` ~${secs}s` : ""}, no answer</span>;
      if (n.dialNote === "busy") return <span style={amber}>◦ Line busy</span>;
      // Answered, but detection couldn't tell a person from voicemail/IVR.
      return <span style={amber}>◦ Answered — couldn&apos;t tell person vs voicemail</span>;
    }
    return <span style={{ color: "#c3c9cf", fontSize: 11 }}>not tested</span>;
  };

  return (
    <>
      <div style={sectionTitle}>Phone / Tracking Numbers</div>
      <p style={{ ...para, marginBottom: 10 }}>
        Numbers found across the website, Google, and Apartments.com. Different numbers per platform are expected (lead-source tracking); what matters is that each one dials the property.
      </p>
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 10 }}>
        <tbody>
          {(["Website", "Google", "Apartments.com"] as const).flatMap((src) => {
            const nums = phones.numbers.filter((n) => n.source === src);
            return nums.map((n, i) => (
              <tr key={`${src}-${i}`}>
                <td style={{ padding: "7px 10px", background: "#faf5ee", borderBottom: "1px solid #eef0f2", fontFamily: "'Josefin Sans',sans-serif", fontSize: 12, color: "#666", width: 150, verticalAlign: "middle" }}>
                  {i === 0 ? src : ""}
                </td>
                <td style={{ padding: "7px 10px", borderBottom: "1px solid #eef0f2", fontFamily: "'Josefin Sans',sans-serif", fontSize: 13, color: "#333", fontWeight: 600 }}>
                  {n.number}
                </td>
                <td style={{ padding: "7px 10px", borderBottom: "1px solid #eef0f2", textAlign: "right", width: 130 }}>
                  {badge(n)}
                </td>
              </tr>
            ));
          })}
        </tbody>
      </table>
      {phones.dialTested && phones.dialTestedAt && (() => {
        const when = formatDialTime(phones.dialTestedAt, property.address);
        const openAt = officeOpenAt(phones.officeHours, phones.dialTestedAt, property.address);
        const box = (bg: string, border: string, color: string, text: string) => (
          <p style={{ ...para, fontSize: 11.5, color, background: bg, border: `1px solid ${border}`, borderRadius: 6, padding: "7px 12px", margin: "0 0 10px 0" }}>{text}</p>
        );
        if (openAt === false)
          return box("#f0faf4", "#bfe3cd", "#15803d", `Dial-tested ${when} — OUTSIDE the property's office hours, so a no-answer or voicemail is expected, not a finding.`);
        if (openAt === true)
          return box("#fdf6ee", "#f0e2cd", "#9a6a2a", `Dial-tested ${when} — DURING the property's office hours, so a no-answer or voicemail here is a real lead-leak signal.`);
        return box("#fdf6ee", "#f0e2cd", "#9a7200", `Dial-tested ${when} (property's local time). A no-answer / voicemail only signals a problem if it landed during posted office hours (see the Office hours row above) — after-hours is expected.`);
      })()}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button
          onClick={runDialTest}
          disabled={testing}
          style={{
            background: testing ? "#cfd6da" : B.caribbean,
            border: "none",
            borderRadius: 8,
            padding: "8px 16px",
            color: "white",
            fontFamily: "'Barlow Condensed',sans-serif",
            fontWeight: 700,
            fontSize: 13,
            letterSpacing: "0.06em",
            cursor: testing ? "wait" : "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
          title="Places a brief automated call to each number to confirm it connects. Requires Twilio configured in Railway."
        >
          <span>📞</span> {testing ? "Calling each number…" : phones.dialTested ? "Re-test call each number" : "Test-call each number"}
        </button>
        <span style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 11, color: "#9aa3ad" }}>
          Places a brief live call to each number (~1.4¢ each) to confirm it rings a real line.
        </span>
      </div>
      {error && (
        <p style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 12, color: B.tangelo, marginTop: 8 }}>{error}</p>
      )}
    </>
  );
}

function MarketingAuditResultView({ results, property, onUpdateProperty }: { results: MarketingAuditResult; property: Property; onUpdateProperty: (p: Property) => void }) {
  const sectionTitle: React.CSSProperties = {
    fontFamily: "'Barlow Condensed',sans-serif",
    fontWeight: 700,
    fontSize: 13,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: B.oxford,
    margin: "24px 0 10px",
  };
  const para: React.CSSProperties = {
    fontFamily: "'Josefin Sans',sans-serif",
    fontSize: 13,
    color: "#2a2a2a",
    lineHeight: 1.6,
    marginBottom: 8,
  };
  const th: React.CSSProperties = {
    padding: "8px 10px",
    textAlign: "left",
    fontFamily: "'Barlow Condensed',sans-serif",
    fontWeight: 700,
    fontSize: 11,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "white",
    background: B.oxford,
  };
  return (
    <div>
      {/* ILS & Google Consistency */}
      {results.consistency.length > 0 && (
        <>
          <div style={sectionTitle}>ILS &amp; Google Consistency Check</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...th, background: "#faf5ee", color: "#666" }}>Data Point</th>
                <th style={th}>Apartments.com</th>
                <th style={th}>Google</th>
                <th style={th}>Website</th>
              </tr>
            </thead>
            <tbody>
              {results.consistency.map((row, i) => (
                <tr key={i}>
                  <td style={{ padding: "8px 10px", background: "#faf5ee", borderBottom: "1px solid #eef0f2", fontFamily: "'Josefin Sans',sans-serif", fontSize: 12, color: "#333", fontWeight: 600, width: 150 }}>
                    {row.label}
                  </td>
                  <MkStatusCell cell={row.apartments} />
                  <MkStatusCell cell={row.google} />
                  <MkStatusCell cell={row.website} />
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* Phone / tracking numbers found across the platforms */}
      {results.phones && results.phones.numbers.length > 0 && (
        <PhoneInventoryPanel
          phones={results.phones}
          property={property}
          onUpdateProperty={onUpdateProperty}
          sectionTitle={sectionTitle}
          para={para}
        />
      )}

      {/* Recommendations — same card format as the SEO/LLM tabs */}
      {isStructuredRecs(results.recommendations) && (
        <>
          <div style={sectionTitle}>Recommendations</div>
          <RecommendationsBlock
            recs={results.recommendations}
            setAsideList={property.setAsideRecs}
            audit="marketing"
            onSetAside={(card, reason) => onUpdateProperty(withSetAside(property, card, reason, "marketing"))}
            onRestore={(key) => onUpdateProperty(withRestored(property, key))}
          />
        </>
      )}

      {/* Progress Since Last Audit — accountability recap, kept at the bottom
          so the report leads with findings + actions and closes with what
          moved since the prior run. Deterministic diff vs the prior run. */}
      {hasPriorMarketingBaseline(property) &&
        (() => {
          const prog = computeAuditProgress(
            property.marketingAuditPrev!,
            results.consistency
          );
          const resolved = prog.fixed;
          const regressedAll = prog.regressed;
          const empty =
            resolved.length === 0 && prog.stillOpen.length === 0 && regressedAll.length === 0;
          const sinceDate = new Date(prog.sinceTimestamp).toLocaleDateString("en-US", {
            month: "long",
            day: "numeric",
            year: "numeric",
          });
          const groupLabel: React.CSSProperties = {
            fontFamily: "'Barlow Condensed',sans-serif",
            fontWeight: 700,
            fontSize: 13,
            letterSpacing: "0.04em",
            margin: "10px 0 4px",
          };
          const item: React.CSSProperties = {
            fontFamily: "'Josefin Sans',sans-serif",
            fontSize: 12.5,
            color: "#333",
            lineHeight: 1.5,
            marginBottom: 2,
          };
          return (
            <>
              <div style={sectionTitle}>Progress Since Last Audit</div>
              <p style={{ ...para, marginBottom: 10 }}>
                Since {sinceDate}: {resolved.length} resolved, {prog.stillOpen.length} still open,{" "}
                {regressedAll.length} regressed.
              </p>
              {empty ? (
                <p style={{ ...para, color: "#9aa3ad", fontStyle: "italic" }}>
                  No changes in tracked findings since the last audit.
                </p>
              ) : (
                <div style={{ marginBottom: 8 }}>
                  {resolved.length > 0 && (
                    <div>
                      <div style={{ ...groupLabel, color: "#15803d" }}>✓ Resolved</div>
                      {resolved.map((s, i) => (
                        <div key={`f${i}`} style={item}>{s}</div>
                      ))}
                    </div>
                  )}
                  {prog.stillOpen.length > 0 && (
                    <div>
                      <div style={{ ...groupLabel, color: "#9a7200" }}>⚠ Still open</div>
                      {prog.stillOpen.map((s, i) => (
                        <div key={`o${i}`} style={item}>{s}</div>
                      ))}
                    </div>
                  )}
                  {regressedAll.length > 0 && (
                    <div>
                      <div style={{ ...groupLabel, color: B.tangelo }}>✗ Regressed</div>
                      {regressedAll.map((s, i) => (
                        <div key={`r${i}`} style={item}>{s}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          );
        })()}
    </div>
  );
}

/* ================= REVIEW AUDIT TAB ============================== */
function reviewHasResponse(r: any): boolean {
  const c = r?.response;
  if (!c) return false;
  if (typeof c === "string") return c.trim().length > 0;
  if (typeof c === "object") return Object.keys(c).length > 0;
  return false;
}
function reviewResponseText(r: any): string {
  const c = r?.response;
  if (!c) return "";
  if (typeof c === "string") return c.trim();
  if (typeof c === "object") return (c.snippet || c.text || c.extracted_snippet || "").trim();
  return "";
}
const REVIEW_PERIODS: { id: ReviewPeriod; label: string; days: number; windowLabel: string; maxPages: number }[] = [
  { id: "1mo", label: "Last month", days: 31, windowLabel: "Last 30 days", maxPages: 4 },
  { id: "6mo", label: "Past 6 months", days: 186, windowLabel: "Last 6 months", maxPages: 8 },
  { id: "12mo", label: "Past 12 months", days: 366, windowLabel: "Last 12 months", maxPages: 14 },
];
const STAR_COLORS = ["#22c55e", "#86c34a", "#f59e0b", "#f08a3c", "#e0524f"]; // 5★ → 1★

/** "YYYY-MM" for a snapshot, deriving from its date for legacy snapshots
 * saved before month-keying existed. */
function snapshotMonthKey(s: ReviewSnapshot): string {
  return s.month || (s.date ? s.date.slice(0, 7) : "");
}
/** Short month label like "May '26" for the trend axis. */
function snapshotMonthLabel(s: ReviewSnapshot): string {
  const key = snapshotMonthKey(s);
  const [yy, mm] = key.split("-");
  if (!yy || !mm) return "";
  return (
    new Date(Number(yy), Number(mm) - 1, 1).toLocaleDateString("en-US", { month: "short" }) +
    " '" +
    yy.slice(2)
  );
}

function ReviewAuditTab({
  property,
  onUpdateProperty,
}: {
  property: Property;
  onUpdateProperty: (p: Property) => void;
}) {
  const [period, setPeriod] = useState<ReviewPeriod>(property.reviewAudit?.period ?? "1mo");
  const [stage, setStage] = useState<"idle" | "running" | "done">(property.reviewAudit ? "done" : "idle");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ReviewAuditResult | null>(property.reviewAudit ?? null);

  useEffect(() => {
    setResults(property.reviewAudit ?? null);
    setPeriod(property.reviewAudit?.period ?? "1mo");
    setStage(property.reviewAudit ? "done" : "idle");
    setError(null);
    setProgress("");
  }, [property.id]);

  const running = stage === "running";

  const run = async () => {
    setError(null);
    setStage("running");
    setResults(null);
    let current: Property = property;

    try {
      // 1. Google listing → rating, total reviews, data_id.
      setProgress("Finding the Google listing…");
      const serpData = await callSerp({
        query: buildGbpSearchQuery(current),
        engine: "google_maps",
        location: extractLocation(current.address),
      });
      const gbp = extractGBP(serpData, current);
      const place = serpData?.place_results;
      const dataId = gbp?.dataId || place?.data_id || "";
      const currentRating = gbp?.rating ?? (typeof place?.rating === "number" ? place.rating : null);
      const totalReviews = gbp?.reviewCount ?? (typeof place?.reviews === "number" ? place.reviews : null);
      if (!dataId) {
        throw new Error("Couldn't find this property's Google listing. Set the Google Business Profile URL in Property Settings, then retry.");
      }

      // Auto-capture gbpUrl/website if missing (same as other audits).
      if (gbp) {
        const patch = computeEnrichment(current, gbp);
        if (Object.keys(patch).length > 0) current = { ...current, ...patch };
      }

      // 2. Page reviews until we pass the window (cap N pages). We ask Google
      //    for newest-first, BUT that sort silently returns zero reviews for
      //    some listings (a Google/SerpAPI quirk — confirmed live on Flats on
      //    Maple, which has 147 reviews yet returns none under newestFirst).
      //    When that happens we fall back to Google's default sort so we never
      //    report "0 reviews" for a listing that clearly has them; since the
      //    fallback is relevance-ordered, we window by date afterward and skip
      //    the newest-first early-break.
      const periodDef = REVIEW_PERIODS.find((p) => p.id === period)!;
      const cutoff = new Date(Date.now() - periodDef.days * 24 * 60 * 60 * 1000);
      let allReviews: any[] = [];
      let token = "";
      let truncated = false;
      let sortMode: "newestFirst" | "" = "newestFirst"; // "" = Google default (relevance)
      const maxPages = periodDef.maxPages;
      for (let pageNum = 0; pageNum < maxPages; pageNum++) {
        setProgress(`Pulling reviews (page ${pageNum + 1})…`);
        let resp: any;
        try {
          resp = await callSerp({
            engine: "google_maps_reviews",
            data_id: dataId,
            // sort_by only on the first request; the page token encodes the sort.
            ...(token ? { next_page_token: token } : sortMode ? { sort_by: sortMode } : {}),
          });
        } catch {
          if (pageNum === 0)
            throw new Error("Couldn't load this property's Google reviews right now. Please try again in a moment.");
          truncated = true;
          break;
        }
        let batch: any[] = Array.isArray(resp?.reviews) ? resp.reviews : [];
        // newestFirst returned nothing for this listing — retry page 1 with the
        // default sort and continue paging from there.
        if (pageNum === 0 && batch.length === 0 && sortMode === "newestFirst") {
          sortMode = "";
          try {
            resp = await callSerp({ engine: "google_maps_reviews", data_id: dataId });
            batch = Array.isArray(resp?.reviews) ? resp.reviews : [];
          } catch {
            /* leave batch empty; the post-loop guard handles it */
          }
        }
        allReviews = allReviews.concat(batch);
        token = resp?.serpapi_pagination?.next_page_token || "";
        if (!batch.length || !token) break;
        // Early-break only valid when date-sorted. Under the relevance fallback
        // we page up to maxPages and window by date afterward.
        if (sortMode === "newestFirst") {
          const oldest = batch[batch.length - 1];
          const oldestDate = oldest?.iso_date ? new Date(oldest.iso_date) : null;
          if (oldestDate && oldestDate < cutoff) break;
        }
        if (pageNum === maxPages - 1 && token) truncated = true;
      }
      // Relevance-fallback means newer reviews may exist beyond what we paged,
      // so mark the report as a partial sample.
      if (sortMode === "") truncated = true;

      // Guard: a listing that HAS reviews but yields none here means Google
      // returned nothing this call — don't render a misleading "0 new reviews"
      // audit; ask for a retry instead.
      if (allReviews.length === 0 && totalReviews && totalReviews > 0) {
        throw new Error(
          "Google didn't return any individual reviews for this listing just now (a temporary Maps hiccup). Please re-run the Review Audit in a moment."
        );
      }

      // 3. Window + compute KPIs in code (never trust the model for counts).
      const windowed = allReviews.filter((r) => {
        if (!r?.iso_date) return false;
        return new Date(r.iso_date) >= cutoff;
      });
      const star = { s1: 0, s2: 0, s3: 0, s4: 0, s5: 0 };
      windowed.forEach((r) => {
        const n = Math.round(r.rating || 0);
        if (n === 1) star.s1++;
        else if (n === 2) star.s2++;
        else if (n === 3) star.s3++;
        else if (n === 4) star.s4++;
        else if (n === 5) star.s5++;
      });
      const newReviews = windowed.length;
      const windowWithResp = windowed.filter(reviewHasResponse).length;
      const responseRatePeriod = newReviews > 0 ? Math.round((windowWithResp / newReviews) * 100) : null;
      const allWithResp = allReviews.filter(reviewHasResponse).length;
      const responseRateAllTime = allReviews.length > 0 ? Math.round((allWithResp / allReviews.length) * 100) : null;

      // Prior rating: prefer the most recent snapshot from an EARLIER month
      // (so a same-month re-run doesn't compare against itself); else
      // reverse-estimate from this period's reviews.
      const runDate = new Date();
      const monthKey = `${runDate.getFullYear()}-${String(runDate.getMonth() + 1).padStart(2, "0")}`;
      const priorSnap = (current.reviewSnapshots || [])
        .filter((s) => s.month < monthKey)
        .sort((a, b) => (a.month < b.month ? 1 : -1))[0];
      let priorRating: number | null = null;
      let priorIsEstimated = false;
      if (priorSnap && typeof priorSnap.rating === "number") {
        priorRating = priorSnap.rating;
      } else if (currentRating !== null && totalReviews && totalReviews > newReviews) {
        const sumWindow = windowed.reduce((s, r) => s + (r.rating || 0), 0);
        const est = (currentRating * totalReviews - sumWindow) / (totalReviews - newReviews);
        priorRating = Math.round(est * 10) / 10;
        priorIsEstimated = true;
      }

      const reviews: ReviewItem[] = windowed.map((r) => ({
        name: r?.user?.name || "Anonymous",
        relativeDate: r?.date || "",
        isoDate: r?.iso_date || "",
        rating: Math.round(r?.rating || 0),
        text: (r?.snippet || r?.extracted_snippet || "").trim(),
        hasResponse: reviewHasResponse(r),
      }));
      // Candidate sets for the response sections (code holds the real text;
      // Claude only adds suggested replies / rewrites, matched back by id).
      const gapCandidates = windowed
        .filter((r) => !reviewHasResponse(r))
        .slice(0, 12)
        .map((r, i) => ({
          id: `g${i}`,
          reviewer: r?.user?.name || "Anonymous",
          rating: Math.round(r?.rating || 0),
          text: (r?.snippet || r?.extracted_snippet || "").trim(),
          escalate: Math.round(r?.rating || 0) <= 2,
          date: r?.date || "",
        }));
      const qualityCandidates = windowed
        .filter((r) => reviewHasResponse(r))
        .slice(0, 12)
        .map((r, i) => ({
          id: `q${i}`,
          reviewer: r?.user?.name || "Anonymous",
          rating: Math.round(r?.rating || 0),
          reviewText: (r?.snippet || r?.extracted_snippet || "").trim(),
          originalResponse: reviewResponseText(r),
        }));

      // 4. Claude: sentiment + response suggestions + narratives + recommendations.
      setProgress("Analyzing sentiment and writing recommendations…");
      const reviewLines = windowed
        .map((r) => {
          const name = r?.user?.name || "Anonymous";
          const text = (r?.snippet || r?.extracted_snippet || "").trim() || "[no written text]";
          const resp = reviewResponseText(r);
          return `- ${name} (${Math.round(r?.rating || 0)}★, ${r?.date || "?"}): "${text}"${resp ? ` | OWNER REPLY: "${resp}"` : " | OWNER REPLY: none"}`;
        })
        .join("\n");
      const gapLines = gapCandidates.length
        ? gapCandidates.map((c) => `[${c.id}] ${c.reviewer} (${c.rating}★): "${c.text || "[no written text]"}"`).join("\n")
        : "(none — every review in this period has an owner reply)";
      const qualityLines = qualityCandidates.length
        ? qualityCandidates.map((c) => `[${c.id}] ${c.reviewer} (${c.rating}★): review="${c.reviewText || "[no text]"}" reply="${c.originalResponse}"`).join("\n")
        : "(none)";

      const prompt = `You are a CRES reputation analyst writing a Resident Review Audit for ${current.name} at ${current.address}. Reporting period: ${periodDef.windowLabel}.

COMPUTED FACTS (authoritative — do NOT recompute or contradict these):
- Current Google rating: ${currentRating ?? "unknown"} (${totalReviews ?? "?"} total reviews)
- Prior rating: ${priorRating ?? "unknown"}${priorIsEstimated ? " (estimated)" : ""}
- New reviews in period: ${newReviews} (★ breakdown — 5:${star.s5} 4:${star.s4} 3:${star.s3} 2:${star.s2} 1:${star.s1})
- Owner response rate this period: ${responseRatePeriod ?? "n/a"}%

NEW REVIEWS IN PERIOD (with owner replies):
${reviewLines || "(no new reviews in this period)"}

REVIEWS WITH NO OWNER REPLY (write a suggested reply to post for each):
${gapLines}

REVIEWS WITH AN OWNER REPLY (flag ONLY the ones whose reply reads generic/templated):
${qualityLines}

${CRES_PLAYBOOK}

Return ONLY this JSON object, no prose:
{
  "narratives": {
    "breakdown": "1-2 sentences summarizing the period's new-review star mix and owner-response coverage.",
    "ratingOverview": "1-2 sentences on the current vs prior rating move and the lever to improve it."
  },
  "sentimentPeriod": [
    {"theme": "<theme from THIS period's review texts, name the staff member if a review names one>", "count": <# of period reviews on this theme>, "sentiment": "Positive|Negative|Mixed|Neutral", "recommendation": "1 sentence; if a 4/5-star review names a staff member call out the $25 incentive; if a 1/2-star, advise response review + internal escalation"}
  ],
  "responseGaps": [
    {"id": "g0", "suggestedResponse": "a warm, specific reply to post for that review; for a no-text review keep it a brief friendly thank-you; for a 1-2 star acknowledge the concern and offer a direct contact"}
  ],
  "responseQuality": [
    {"id": "q0", "issue": "why this existing reply reads generic/templated", "suggestedRewrite": "a short, personalized rewrite referencing the review or a brand differentiator"}
  ],
  "recommendations": [
    {"priority": "QUICK WIN"|"FOUNDATIONAL"|"CONTENT"|"STRATEGIC", "title": "imperative, <=12 words", "what": "concrete action, name staff/incentive when relevant", "why": "the observed review data + impact", "effort": "~<time> · <who>", "success": "measurable outcome", "source": "which review finding"}
  ]
}

RULES:
- sentimentPeriod: derive themes ONLY from the period review texts above; if a review names a staff member in a 4/5-star, note the $25 incentive per CRES P&P.
- responseGaps: one entry per [gN] review above, using its exact id. Empty array if there are none.
- responseQuality: include ONLY the [qN] reviews whose reply is genuinely generic/templated, using the exact id. Omit good replies. Empty array if none.
- recommendations: EXACTLY 5 cards, same format/rules as the other audits, grounded in the CRES playbook (text-first review link, QR touchpoints, $25/$150/$250 incentives, solicitation timing). Plain English, no em dashes, no fabricated program names. Base them ONLY on THIS reporting period's reviews (listed above); do NOT recommend acting on an all-time/historical-only theme that no review in this period repeats.`;

      // maxTokens must cover narratives + up to 12 suggested replies + up to 12
      // rewrites + 5 rec cards; at 4000 the JSON was being TRUNCATED mid-array on
      // review-heavy periods (hence "Expected ',' or ']'"). 8000 gives real headroom.
      const data = await callAI({ prompt, maxTokens: 8000 });
      const text = (data.content || [])
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("\n");
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("The audit did not return a structured result. Try again.");
      let parsed: any;
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        // Almost always a truncated response (too many reviews for one pass). Fail with
        // an actionable message instead of a raw JSON position error.
        throw new Error(
          "The review analysis came back incomplete — likely too many reviews for a single pass. Try a shorter period (Last month or Past 6 months) and re-run."
        );
      }

      const recs: AuditRecommendations = isStructuredRecs(parsed.recommendations as AuditRecommendations)
        ? (parsed.recommendations as RecommendationCard[])
        : [];

      // Merge Claude's suggestions onto the code-held review/response text by id.
      const gapSuggById = new Map<string, string>(
        (parsed.responseGaps || []).map((g: any) => [g.id, g.suggestedResponse || ""])
      );
      const responseGaps: ReviewResponseGap[] = gapCandidates.map((c) => ({
        reviewer: c.reviewer,
        rating: c.rating,
        text: c.text,
        escalate: c.escalate,
        suggestedResponse: gapSuggById.get(c.id) || "",
        date: c.date,
      }));
      const qById = new Map(qualityCandidates.map((c) => [c.id, c]));
      const responseQuality: ReviewResponseQualityFlag[] = ((parsed.responseQuality || []) as any[])
        .map((f) => {
          // Match by id; fall back to reviewer name if the model returned a name.
          const c =
            qById.get(f.id) ||
            qualityCandidates.find((q) => f.reviewer && q.reviewer.toLowerCase() === String(f.reviewer).toLowerCase());
          if (!c) return null;
          return {
            reviewer: c.reviewer,
            rating: c.rating,
            reviewText: c.reviewText,
            originalResponse: c.originalResponse,
            issue: f.issue || "",
            suggestedRewrite: f.suggestedRewrite || "",
          } as ReviewResponseQualityFlag;
        })
        .filter(Boolean) as ReviewResponseQualityFlag[];

      const runTs = runDate.toISOString();
      const result: ReviewAuditResult = {
        period,
        periodLabel: periodDef.windowLabel,
        kpis: {
          currentRating,
          priorRating,
          priorIsEstimated,
          newReviews,
          totalReviews,
          responseRatePeriod,
          responseRateAllTime,
        },
        starBreakdown: star,
        sentimentPeriod: (parsed.sentimentPeriod || []) as ReviewSentimentRow[],
        reviews,
        responseGaps,
        responseQuality,
        recommendations: recs,
        narratives: {
          breakdown: parsed.narratives?.breakdown || "",
          ratingOverview: parsed.narratives?.ratingOverview || "",
        },
        truncated,
        reviewsAnalyzed: allReviews.length,
        timestamp: runTs,
      };

      // 5. Upsert this month's trend snapshot (one point per calendar month).
      const snapshot: ReviewSnapshot = {
        month: monthKey,
        date: runTs,
        rating: currentRating ?? 0,
        totalReviews: totalReviews ?? 0,
      };
      // Normalize legacy snapshots (saved before month-keying) so sort/upsert work.
      const existing = (current.reviewSnapshots || []).map((s) => ({ ...s, month: snapshotMonthKey(s) || monthKey }));
      const snapshots = [...existing.filter((s) => s.month !== monthKey), snapshot]
        .sort((a, b) => (a.month < b.month ? -1 : 1))
        .slice(-24);

      current = { ...current, reviewAudit: result, reviewSnapshots: snapshots };
      onUpdateProperty(current);
      setResults(result);
      setStage("done");
      setProgress("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Review audit failed.");
      setStage("idle");
      setProgress("");
    }
  };

  return (
    <div style={{ background: "white", borderRadius: 10, padding: 24, boxShadow: "0 1px 6px rgba(0,0,0,0.07)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 18, letterSpacing: "0.06em", textTransform: "uppercase", color: B.oxford }}>
          Resident Review Audit
        </div>
        {results?.timestamp && (
          <span style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 11, color: "#888" }}>
            Last run {new Date(results.timestamp).toLocaleString()}
          </span>
        )}
      </div>
      <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 12, color: "#aaa", marginBottom: 14 }}>
        Pulls live Google reviews, tracks rating + volume over time, analyzes sentiment, and writes CRES-grounded recommendations.
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 0, border: `1px solid ${B.cambridge}`, borderRadius: 7, overflow: "hidden" }}>
          {REVIEW_PERIODS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              disabled={running}
              style={{
                background: period === p.id ? B.caribbean : "white",
                color: period === p.id ? "white" : B.caribbean,
                border: "none",
                padding: "8px 16px",
                fontFamily: "'Josefin Sans',sans-serif",
                fontSize: 12,
                fontWeight: 600,
                cursor: running ? "default" : "pointer",
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <button
          onClick={run}
          disabled={running}
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
            cursor: running ? "wait" : "pointer",
            opacity: running ? 0.7 : 1,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span>✦</span>
          {running ? "Auditing…" : results ? "Re-run Review Audit" : "Run Review Audit"}
        </button>
      </div>

      {running && (
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

      {!results && !running && !error && (
        <div style={{ padding: "20px 16px", background: "#fafafa", borderRadius: 8, fontFamily: "'Josefin Sans',sans-serif", fontSize: 13, color: "#888", textAlign: "center", lineHeight: 1.6 }}>
          Runs ~20–40s. Choose a period, then pull live Google reviews to score rating trend, star mix, sentiment, owner-response coverage, and the next month&rsquo;s actions.
        </div>
      )}

      {results && <ReviewAuditResultView results={results} snapshots={property.reviewSnapshots || []} />}
    </div>
  );
}

function ReviewAuditResultView({ results, snapshots }: { results: ReviewAuditResult; snapshots: ReviewSnapshot[] }) {
  const k = results.kpis;
  const sectionTitle: React.CSSProperties = {
    fontFamily: "'Barlow Condensed',sans-serif",
    fontWeight: 700,
    fontSize: 13,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: B.oxford,
    margin: "24px 0 10px",
  };
  const para: React.CSSProperties = {
    fontFamily: "'Josefin Sans',sans-serif",
    fontSize: 13,
    color: "#2a2a2a",
    lineHeight: 1.6,
    marginBottom: 8,
  };
  const th: React.CSSProperties = {
    padding: "8px 10px",
    textAlign: "left",
    fontFamily: "'Barlow Condensed',sans-serif",
    fontWeight: 700,
    fontSize: 11,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "white",
    background: B.oxford,
  };
  const sentimentColor = (s: string) =>
    s === "Positive" ? "#15803d" : s === "Negative" ? B.tangelo : s === "Mixed" ? "#9a7200" : "#666";

  const delta = k.currentRating !== null && k.priorRating !== null ? Math.round((k.currentRating - k.priorRating) * 10) / 10 : null;
  const starRows: [string, number, string][] = [
    ["5 Star", results.starBreakdown.s5, STAR_COLORS[0]],
    ["4 Star", results.starBreakdown.s4, STAR_COLORS[1]],
    ["3 Star", results.starBreakdown.s3, STAR_COLORS[2]],
    ["2 Star", results.starBreakdown.s2, STAR_COLORS[3]],
    ["1 Star", results.starBreakdown.s1, STAR_COLORS[4]],
  ];
  const maxStar = Math.max(1, ...starRows.map((r) => r[1]));
  const periodTotal = starRows.reduce((sum, r) => sum + r[1], 0);

  const renderSentiment = (rows: ReviewSentimentRow[], withRecommendation = true) => (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr>
          <th style={th}>Theme</th>
          <th style={{ ...th, width: 70, textAlign: "center" }}>Mentions</th>
          <th style={{ ...th, width: 90 }}>Sentiment</th>
          {withRecommendation && <th style={th}>CRES Recommendation</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} style={{ background: i % 2 ? "#fafafa" : "white" }}>
            <td style={{ padding: "8px 10px", borderBottom: "1px solid #eef0f2", fontFamily: "'Josefin Sans',sans-serif", fontSize: 12.5, color: "#333", fontWeight: 600 }}>{row.theme}</td>
            <td style={{ padding: "8px 10px", borderBottom: "1px solid #eef0f2", textAlign: "center", fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, color: "#666" }}>{row.count}</td>
            <td style={{ padding: "8px 10px", borderBottom: "1px solid #eef0f2", fontFamily: "'Josefin Sans',sans-serif", fontSize: 12, fontWeight: 600, color: sentimentColor(row.sentiment) }}>{row.sentiment}</td>
            {withRecommendation && <td style={{ padding: "8px 10px", borderBottom: "1px solid #eef0f2", fontFamily: "'Josefin Sans',sans-serif", fontSize: 12, color: "#333", lineHeight: 1.45 }}>{row.recommendation}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div>
      {/* KPIs */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
        <KPI label="Current Rating" value={k.currentRating !== null ? k.currentRating.toFixed(1) : "—"} sub="out of 5" accent={B.caribbean} />
        <KPI label="Prior Rating" value={k.priorRating !== null ? k.priorRating.toFixed(1) : "—"} sub={k.priorIsEstimated ? "estimated" : "prior month"} trend={delta !== null && delta !== 0 ? delta : undefined} accent={B.oxford} />
        <KPI label="Total Reviews" value={k.totalReviews ?? "—"} sub="all-time on Google" accent={B.oxford} />
        <KPI label="New Reviews" value={k.newReviews} sub={results.periodLabel} accent={B.tangelo} />
        <KPI label="Response Rate" value={k.responseRatePeriod !== null ? `${k.responseRatePeriod}%` : "—"} sub="this period" accent={k.responseRatePeriod !== null && k.responseRatePeriod >= 90 ? "#22c55e" : "#f59e0b"} />
        <KPI label="Response Rate" value={k.responseRateAllTime !== null ? `${k.responseRateAllTime}%` : "—"} sub="of reviews checked" accent={k.responseRateAllTime !== null && k.responseRateAllTime >= 90 ? "#22c55e" : "#f59e0b"} />
      </div>

      {/* Trend — one point per calendar month */}
      {snapshots.length >= 2 && (
        <>
          <div style={sectionTitle}>Rating &amp; Volume Trend (by month)</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 10, padding: "8px 4px", overflowX: "auto" }}>
            {snapshots.slice(-12).map((s, i) => {
              const h = Math.max(6, (s.rating / 5) * 70);
              const mLabel = snapshotMonthLabel(s);
              return (
                <div key={i} style={{ textAlign: "center", flexShrink: 0, width: 54 }}>
                  <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 11, color: B.oxford }}>{s.rating.toFixed(1)}</div>
                  <div style={{ height: h, background: B.caribbean, borderRadius: 3, margin: "2px auto", width: 22 }} />
                  <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 9, color: "#999" }}>{s.totalReviews} rev</div>
                  <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 8.5, color: "#bbb" }}>{mLabel}</div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Review Breakdown — hide the empty bar chart when no new reviews landed this period */}
      <div style={sectionTitle}>{results.period === "1mo" ? "Monthly" : "Period"} Review Breakdown</div>
      {periodTotal === 0 ? (
        !results.narratives.breakdown && (
          <p style={para}>No new reviews were posted during {results.periodLabel}, so there is no new-review breakdown for this period.</p>
        )
      ) : (
        <div style={{ marginBottom: 8 }}>
          {starRows.map(([label, count, color]) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <span style={{ width: 54, fontFamily: "'Josefin Sans',sans-serif", fontSize: 12, color: "#555" }}>{label}</span>
              <div style={{ flex: 1, background: "#f0f2f4", borderRadius: 3, height: 16, position: "relative" }}>
                <div style={{ width: `${(count / maxStar) * 100}%`, background: color, height: "100%", borderRadius: 3, minWidth: count > 0 ? 4 : 0 }} />
              </div>
              <span style={{ width: 24, textAlign: "right", fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 13, color: B.oxford }}>{count}</span>
            </div>
          ))}
        </div>
      )}
      {results.narratives.breakdown && <p style={para}>{results.narratives.breakdown}</p>}

      {/* Rating Overview */}
      {results.narratives.ratingOverview && (
        <>
          <div style={sectionTitle}>Rating Overview</div>
          <p style={para}>{results.narratives.ratingOverview}</p>
        </>
      )}

      {/* Sentiment: This Period (most actionable) */}
      {results.sentimentPeriod.length > 0 && (
        <>
          <div style={sectionTitle}>Sentiment Analysis: {results.periodLabel}</div>
          <p style={{ ...para, fontSize: 11.5, color: "#888" }}>Themes from the new reviews this period — what is driving feedback right now.</p>
          {renderSentiment(results.sentimentPeriod)}
        </>
      )}

      {/* Response gaps — show the review, a suggested reply, and escalation */}
      {results.responseGaps.length > 0 && (
        <>
          <div style={sectionTitle}>Reviews Awaiting a Response</div>
          {results.responseGaps.map((g, i) => (
            <div key={i} style={{ marginBottom: 12, padding: "10px 12px", background: "#fafbfc", border: "1px solid #eef0f2", borderRadius: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 13, fontWeight: 600, color: "#333" }}>{g.reviewer}</span>
                <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 12, color: g.rating >= 4 ? "#15803d" : g.rating <= 2 ? B.tangelo : "#9a7200" }}>{g.rating}★</span>
                {g.date && <span style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 11, color: "#aaa" }}>{g.date}</span>}
                {g.escalate && <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: "white", background: B.tangelo, borderRadius: 4, padding: "1px 6px" }}>Escalate</span>}
              </div>
              <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 12.5, color: g.text ? "#444" : "#bbb", fontStyle: g.text ? "italic" : "italic", lineHeight: 1.5, marginBottom: 6 }}>
                &ldquo;{g.text || "No written review text submitted"}&rdquo;
              </div>
              {g.suggestedResponse && (
                <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 12, color: "#15803d", lineHeight: 1.5, paddingLeft: 10, borderLeft: `2px solid ${B.cambridge}` }}>
                  <strong>Suggested reply:</strong> {g.suggestedResponse}
                </div>
              )}
              {g.escalate && (
                <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 11.5, color: B.tangelo, marginTop: 4 }}>
                  Escalate internally and confirm the public reply acknowledges the concern with a direct contact channel, per CRES P&P.
                </div>
              )}
            </div>
          ))}
        </>
      )}

      {/* Response quality — original reply, commentary, then rewrite */}
      {results.responseQuality.length > 0 && (
        <>
          <div style={sectionTitle}>Owner Response Quality</div>
          {results.responseQuality.map((q, i) => (
            <div key={i} style={{ marginBottom: 12, padding: "10px 12px", background: "#fafbfc", border: "1px solid #eef0f2", borderRadius: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 13, fontWeight: 600, color: "#333" }}>{q.reviewer}</span>
                <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 12, color: q.rating >= 4 ? "#15803d" : q.rating <= 2 ? B.tangelo : "#9a7200" }}>{q.rating}★</span>
              </div>
              {q.reviewText && (
                <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 12, color: "#666", fontStyle: "italic", lineHeight: 1.5, marginBottom: 6 }}>
                  Review: &ldquo;{q.reviewText}&rdquo;
                </div>
              )}
              {q.originalResponse ? (
                <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 12, color: "#444", lineHeight: 1.5, marginBottom: 6, paddingLeft: 10, borderLeft: "2px solid #e0e0e0" }}>
                  <strong style={{ color: "#777" }}>Current reply:</strong> &ldquo;{q.originalResponse}&rdquo;
                </div>
              ) : null}
              <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 12, color: "#9a7200", lineHeight: 1.5, marginBottom: 6 }}>
                {q.issue}
              </div>
              <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 12, color: "#15803d", lineHeight: 1.5, paddingLeft: 10, borderLeft: `2px solid ${B.cambridge}` }}>
                <strong>Suggested rewrite:</strong> {q.suggestedRewrite}
              </div>
            </div>
          ))}
        </>
      )}

      {/* New reviews */}
      {results.reviews.length > 0 && (
        <>
          <div style={sectionTitle}>New Reviews ({results.reviews.length})</div>
          {results.reviews.map((r, i) => (
            <div key={i} style={{ marginBottom: 8, paddingBottom: 8, borderBottom: "1px solid #f0f2f4" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 13, fontWeight: 600, color: "#333" }}>{r.name}</span>
                <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 12, color: r.rating >= 4 ? "#15803d" : r.rating <= 2 ? B.tangelo : "#9a7200" }}>{r.rating}★</span>
                <span style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 11, color: "#aaa" }}>{r.relativeDate}</span>
                {r.hasResponse && <span style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 10, color: "#15803d" }}>✓ replied</span>}
              </div>
              <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 12.5, color: r.text ? "#444" : "#bbb", lineHeight: 1.5, marginTop: 2, fontStyle: r.text ? "normal" : "italic" }}>
                {r.text || "[No written review text submitted]"}
              </div>
            </div>
          ))}
          {results.truncated && (
            <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 11, color: "#aaa", fontStyle: "italic" }}>
              Showing the {results.reviewsAnalyzed} most recent reviews analyzed; the period may contain more.
            </div>
          )}
        </>
      )}

      {/* Recommendations */}
      {isStructuredRecs(results.recommendations) && (
        <>
          <div style={sectionTitle}>CRES Recommendations</div>
          <RecommendationsBlock recs={results.recommendations} />
        </>
      )}
    </div>
  );
}

/* ================= MAIN APP ======================================= */
const TABS = [
  { id: "marketing", label: "Marketing Audit" },
  { id: "seo", label: "SEO & Website Optimization" },
  { id: "reviews", label: "Review Audit" },
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

function PrintSectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        fontFamily: "'Barlow Condensed', sans-serif",
        fontWeight: 700,
        fontSize: 20,
        color: PRINT_NAVY,
        margin: "26px 0 14px 0",
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

/**
 * Print-friendly version of RecCard. Tighter padding + smaller text so
 * 5-10 recommendations still fit cleanly across 2-3 pages with the
 * margin boxes the @page rules establish.
 */
function PrintRecCard({ card }: { card: RecommendationCard }) {
  const s = PRIORITY_STYLES[card.priority] || PRIORITY_STYLES["STRATEGIC"];
  const body = [card.what?.trim(), card.why?.trim()].filter(Boolean).join(" ");
  const footer = [card.effort?.trim(), card.success?.trim()].filter(Boolean).join("  ·  ");
  return (
    <div
      style={{
        border: `1px solid #e6e9ec`,
        borderLeft: `3px solid ${s.fg}`,
        borderRadius: 4,
        padding: "8px 12px",
        marginBottom: 8,
        breakInside: "avoid" as const,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
        <span
          style={{
            display: "inline-block",
            padding: "1px 6px",
            background: s.bg,
            color: s.fg,
            border: `1px solid ${s.border}`,
            borderRadius: 3,
            fontFamily: "'Barlow Condensed', sans-serif",
            fontWeight: 700,
            fontSize: 8,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
          }}
        >
          {card.priority}
        </span>
        <div
          style={{
            fontFamily: "'Barlow Condensed', sans-serif",
            fontWeight: 700,
            fontSize: 12,
            color: PRINT_NAVY,
            flex: 1,
            lineHeight: 1.2,
          }}
        >
          {card.title}
        </div>
      </div>
      <div
        style={{
          fontFamily: "'Josefin Sans', sans-serif",
          fontSize: 10,
          color: PRINT_BODY,
          lineHeight: 1.5,
        }}
      >
        {body}
      </div>
      {footer && (
        <div
          style={{
            fontFamily: "'Josefin Sans', sans-serif",
            fontSize: 9,
            color: "#8a909a",
            marginTop: 5,
            paddingTop: 4,
            borderTop: "1px solid #eef0f2",
          }}
        >
          {footer}
        </div>
      )}
    </div>
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

/** Structured facts read from an Apartments.com listing by the dedicated reader. */
interface ApartmentsListingRead {
  ok: boolean; // false = the fetch came back empty/blocked this run
  advertising: boolean | null;
  priceText: string;
  beds: string;
  sqft: string;
  officeHours: Record<string, string>; // day -> "9 AM-5 PM" | "Closed"
  mediaSummary: string; // verbatim gallery badge text, e.g. "16 Photos"
  mediaCounts: { photos: number | null; virtualTours: number | null; videos: number | null }; // parsed from mediaSummary in code
  photoUrls: string[];
  concessions: string; // "" when none advertised
  tourScheduling: boolean | null;
  onlineApplication: boolean | null;
  phones: string[];
  amenities: string[];
  hasWebsiteLink: boolean | null; // "View Property Website" link present on the listing
}

/**
 * Dedicated, retryable reader for an Apartments.com listing. The listing is
 * bot-protected (Playwright 403s it), so we use Claude's web_fetch — but as its
 * OWN focused call, not buried in the giant audit call. That's the whole point:
 * the model isn't juggling nine other jobs, so it reliably returns the media
 * summary, hours, and gallery image URLs; a thin read can simply be retried;
 * and the big audit call then consumes these facts as authoritative instead of
 * re-fetching. `ok:false` means the listing genuinely came back empty.
 */
async function readApartmentsListing(url: string): Promise<ApartmentsListingRead> {
  const empty: ApartmentsListingRead = {
    ok: false, advertising: null, priceText: "", beds: "", sqft: "",
    officeHours: {}, mediaSummary: "", mediaCounts: { photos: null, virtualTours: null, videos: null },
    photoUrls: [], concessions: "", tourScheduling: null, onlineApplication: null,
    phones: [], amenities: [], hasWebsiteLink: null,
  };
  if (!url) return empty;
  const prompt = `Use your web_fetch tool to load this Apartments.com listing and read it carefully: ${url}

Report EXACTLY what the listing shows, as JSON only (no prose). Never guess or invent — use null / [] / "" for anything you cannot actually see on the page.
{
  "advertising": true or false,
  "priceText": "rent range as shown, e.g. \\"$1,660+\\" (empty if not advertising)",
  "beds": "bedroom types offered, e.g. \\"2-3 BR\\"",
  "sqft": "square-footage range if shown",
  "officeHours": {"monday":"9 AM-5 PM or Closed","tuesday":"...", "wednesday":"...","thursday":"...","friday":"...","saturday":"...","sunday":"..."},
  "mediaSummaryVerbatim": "the small media-count badge on the photo gallery, transcribed EXACTLY as printed, e.g. \\"16 Photos\\" or \\"29 Photos, 2 Virtual Tours, 1 Video\\"",
  "photoUrls": ["direct gallery image src URLs, e.g. https://images1.apartments.com/... ; up to 6; only URLs you actually see"],
  "concessions": "the exact special/concession text if one is advertised, else empty string",
  "tourScheduling": true or false,
  "onlineApplication": true or false,
  "phones": ["any phone/tracking numbers shown"],
  "amenities": ["listed amenities, up to 12"]
}
For "mediaSummaryVerbatim", copy the gallery badge text character-for-character. Do NOT add media types (Virtual Tours, Videos) that are not literally printed there — if it only says "16 Photos", write exactly "16 Photos". Do NOT invent counts.

IF the page shows "This property is not currently advertising on Apartments.com" (a shell / inactive listing): set "advertising" to false and leave priceText, beds, sqft, officeHours, mediaSummaryVerbatim, photoUrls, concessions, and amenities EMPTY. Do NOT fill ANY field from the "Explore Similar Rentals Nearby" section or from web search — report only what THIS listing itself shows.`;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const resp = await callAI({ prompt, webFetch: true, maxTokens: 1200 });
      const text = (resp.content || [])
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("\n");
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) continue;
      const j = JSON.parse(m[0]) as Record<string, unknown>;
      const strArr = (v: unknown, n: number) =>
        Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === "string").slice(0, n) : [];
      // Parse media counts from the VERBATIM badge text, not a model-emitted
      // number: the model fabricates nonzero tour/video counts but transcribes
      // the badge accurately. No "Virtual Tour" in the text => 0 tours, for real.
      const mediaSummary = typeof j.mediaSummaryVerbatim === "string" ? j.mediaSummaryVerbatim.trim() : "";
      const grabCount = (re: RegExp): number | null => {
        if (!/\d/.test(mediaSummary)) return null; // badge unreadable -> unknown
        const mm = mediaSummary.match(re);
        return mm ? parseInt(mm[1], 10) : 0;
      };
      // DETERMINISTIC advertising check from the RAW fetched page, NOT the model's
      // (flip-floppy) boolean. The DEFINITIVE shell signal is the on-page banner
      // "This property is not currently advertising on Apartments.com" — and it IS
      // in the fetched content (the model reads it to follow its prompt), so detect
      // it directly. It WINS over the pricing-presence proxy, which false-positived
      // on the "Explore Similar Rentals Nearby" section: those nearby listings carry
      // "Monthly Rent" / pricing text that fooled the proxy into "advertising" on a
      // shell page. Only when the banner is ABSENT do we fall back to the
      // active-structure proxy (the property's own "Pricing & Floor Plans" section).
      const rawFetched = (resp.content || [])
        .filter((b: any) => b?.type === "web_fetch_tool_result")
        .map((b: any) => {
          try {
            return JSON.stringify(b);
          } catch {
            return "";
          }
        })
        .join("\n");
      const notAdvertisingBanner = /not\s+currently\s+advertising/i.test(rawFetched);
      const advertising: boolean | null = notAdvertisingBanner
        ? false
        : rawFetched.length > 500
        ? /pricing\s*&?\s*floor\s*plans|monthly\s+rent/i.test(rawFetched)
        : typeof j.advertising === "boolean"
        ? j.advertising
        : null;
      const read: ApartmentsListingRead = {
        ok: true,
        advertising,
        priceText: typeof j.priceText === "string" ? j.priceText : "",
        beds: typeof j.beds === "string" ? j.beds : "",
        sqft: typeof j.sqft === "string" ? j.sqft : "",
        officeHours: j.officeHours && typeof j.officeHours === "object" ? (j.officeHours as Record<string, string>) : {},
        mediaSummary,
        mediaCounts: {
          photos: grabCount(/(\d+)\s*photos?/i),
          virtualTours: grabCount(/(\d+)\s*virtual\s*tours?/i),
          videos: grabCount(/(\d+)\s*videos?/i),
        },
        photoUrls: strArr(j.photoUrls, 6).filter((u) => /^https?:\/\/[^/]*apartments\.com\//i.test(u)),
        concessions: typeof j.concessions === "string" ? j.concessions : "",
        tourScheduling: typeof j.tourScheduling === "boolean" ? j.tourScheduling : null,
        onlineApplication: typeof j.onlineApplication === "boolean" ? j.onlineApplication : null,
        phones: strArr(j.phones, 6),
        amenities: strArr(j.amenities, 12),
        // The "View Property Website" link is standard on an active listing.
        // Detect it deterministically from the raw fetched content (its visible
        // button text), not model judgment. null = page too thin to tell.
        hasWebsiteLink:
          rawFetched.length > 500 ? /view\s+property\s+website|property\s+website/i.test(rawFetched) : null,
      };
      // A "thin" read (nothing substantive) is a partial/blocked fetch — retry once.
      const thin =
        read.advertising === null && !read.priceText &&
        Object.keys(read.officeHours).length === 0 &&
        read.mediaCounts.photos === null && read.photoUrls.length === 0;
      if (thin && attempt < 2) continue;
      return thin ? empty : read;
    } catch {
      if (attempt < 2) continue;
    }
  }
  return empty;
}

/**
 * Classify a recommendation into a coarse topic so the printed report can
 * drop near-duplicates when the LLM-audit and SEO-audit card sets are
 * merged. Returns null for topics that are usually distinct (landing pages,
 * Map Pack tactics, etc.) — those are never deduped. Note that responding
 * to reviews and generating reviews are deliberately SEPARATE topics.
 */
function recTopicKey(card: RecommendationCard): string | null {
  const t = `${card.title} ${card.what}`.toLowerCase();
  if (/\breview/.test(t)) {
    return /(respond|reply|repl ?y|response|owner reply|monitor reviews?)/.test(t)
      ? "review-response"
      : "review-generation";
  }
  if (/\bfaq\b|frequently asked|q&a page|q & a/.test(t)) return "faq";
  if (/schema|json-?ld|structured data markup/.test(t)) return "schema";
  if (/amenit/.test(t)) return "amenities";
  if (/name.{0,12}address.{0,12}phone|listing consistency|consistent name/.test(t)) return "listings";
  return null;
}

/**
 * Merge structured card sets from multiple audits (order: marketing ->
 * checklist -> SEO) and drop only TRUE duplicates — cards proposing the same
 * action, keyed by normalized title. Two audits that both say "Add JSON-LD
 * schema" collapse to one; distinct recommendations that merely share a broad
 * topic (e.g. marketing "list amenities on the ILS listing" vs SEO "add an
 * amenities landing page for search") are BOTH kept. Earlier cards win ties.
 *
 * NOTE: this intentionally does NOT use recTopicKey. The coarse topic key is
 * right for matching set-aside items across re-runs (setAsideKey), but as a
 * dedup key it collapsed genuinely-different same-topic cards — silently
 * dropping SEO recs from the combined report.
 */
function dedupeRecCards(cards: RecommendationCard[]): RecommendationCard[] {
  const seen = new Set<string>();
  const kept: RecommendationCard[] = [];
  for (const c of cards) {
    const key = (c.title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    kept.push(c);
  }
  return kept;
}

/* ================= SET-ASIDE RECOMMENDATIONS ==================== */
/** Preset reasons a user can pick when setting a recommendation aside. */
const SET_ASIDE_REASONS = ["Not feasible", "Not worth it", "Already handled"] as const;

/**
 * Stable key used to recognize the "same" recommendation across audit re-runs,
 * even when the model rewords it. Prefers the coarse topic key (so any
 * review/FAQ/schema/amenities/listings card matches its set-aside twin) and
 * falls back to a normalized title for everything else.
 */
function setAsideKey(card: RecommendationCard): string {
  return recTopicKey(card) || (card.title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** True when a card has been set aside (matched against the property's list). */
function isSetAside(card: RecommendationCard, keys: Set<string>): boolean {
  return keys.has(setAsideKey(card));
}

/**
 * Prompt fragment appended to the Marketing + SEO audit prompts so the model
 * stops re-proposing recommendations the client has already declined. Belt to
 * the client-side filter's suspenders: even if the model ignores it, the
 * matching filter keeps the card out of the active list.
 */
function setAsidePromptNote(property: Property): string {
  const list = property.setAsideRecs ?? [];
  if (list.length === 0) return "";
  const lines = list.map((s) => `- ${s.title} (client reason: ${s.reason})`).join("\n");
  return `\n\nALREADY DECLINED BY THE CLIENT — DO NOT RECOMMEND THESE AGAIN (they have reviewed and set them aside; do not re-propose them even reworded):\n${lines}`;
}

/** Return a copy of `property` with `card` added to the set-aside list (dedup by key). */
function withSetAside(
  property: Property,
  card: RecommendationCard,
  reason: string,
  audit: "marketing" | "seo"
): Property {
  const key = setAsideKey(card);
  const rest = (property.setAsideRecs ?? []).filter((s) => s.key !== key);
  return {
    ...property,
    setAsideRecs: [
      ...rest,
      { key, title: card.title, reason, audit, setAsideAt: new Date().toISOString() },
    ],
  };
}

/** Return a copy of `property` with the set-aside entry for `key` removed. */
function withRestored(property: Property, key: string): Property {
  return { ...property, setAsideRecs: (property.setAsideRecs ?? []).filter((s) => s.key !== key) };
}

/** Standalone printed Resident Review Audit (its own PDF, not combined). */
function ReviewAuditReport({ property }: { property: Property }) {
  const ra = property.reviewAudit;
  const snapshots = property.reviewSnapshots || [];
  const now = new Date();
  const monthYear = now.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const cssName = property.name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const pageStyles = `
@media print {
  @page {
    size: letter;
    margin: 0.85in 0.65in 0.75in 0.65in;
    @top-left {
      content: "CRES  |  Resident Review Audit  |  ${cssName}  |  ${monthYear}";
      font-family: 'Josefin Sans', sans-serif;
      font-size: 8.5pt;
      color: #062347;
      margin-top: 0.4in;
    }
    @bottom-center {
      content: "Confidential – Prepared by CRES  |  Page " counter(page);
      font-family: 'Josefin Sans', sans-serif;
      font-size: 8.5pt;
      color: #888;
      margin-bottom: 0.4in;
    }
  }
}`;
  const bodyP: React.CSSProperties = { fontFamily: "'Josefin Sans', sans-serif", fontSize: 11, lineHeight: 1.6, color: PRINT_BODY, margin: "0 0 10px 0" };
  const td: React.CSSProperties = { padding: "5px 8px", fontSize: 10, lineHeight: 1.45, color: PRINT_BODY, verticalAlign: "top", borderBottom: "0.5px solid #d8d8d8" };
  const th: React.CSSProperties = { padding: "5px 8px", background: PRINT_NAVY, color: "white", textAlign: "left", fontFamily: "'Barlow Condensed', sans-serif", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" };
  const subHead: React.CSSProperties = { fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 12, letterSpacing: "0.06em", textTransform: "uppercase", color: PRINT_TEAL, margin: "0 0 6px 0" };

  const sentTable = (rows: ReviewSentimentRow[], withRecommendation = true) => (
    <table style={{ marginBottom: 14 }}>
      <thead>
        <tr>
          <th style={th}>Theme</th>
          <th style={{ ...th, width: 60, textAlign: "center" }}>Mentions</th>
          <th style={{ ...th, width: 70 }}>Sentiment</th>
          {withRecommendation && <th style={th}>CRES Recommendation</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="pb-avoid">
            <td style={{ ...td, fontWeight: 600, color: PRINT_NAVY }}>{r.theme}</td>
            <td style={{ ...td, textAlign: "center" }}>{r.count}</td>
            <td style={{ ...td, fontWeight: 700, color: r.sentiment === "Positive" ? "#15803d" : r.sentiment === "Negative" ? "#b14a2a" : "#9a7200" }}>{r.sentiment}</td>
            {withRecommendation && <td style={td}>{r.recommendation}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: pageStyles }} />
      <div className="printable-report" style={{ color: PRINT_BODY, fontFamily: "'Josefin Sans', sans-serif", fontSize: 11, lineHeight: 1.55 }}>
        {/* Cover — own page */}
        <section className="pb-after" style={{ textAlign: "center", paddingTop: "1.4in" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/cres-logo.svg"
            alt="CRES"
            style={{ maxWidth: 320, width: "60%", height: "auto", display: "block", margin: "0 auto 28px" }}
          />
          <div style={{ width: "52%", borderTop: `3px solid ${PRINT_ORANGE}`, margin: "0 auto 32px" }} />
          <h1 style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 32, color: PRINT_NAVY, textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 28px 0" }}>
            Resident Review Audit
          </h1>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 22, fontWeight: 700, color: PRINT_NAVY, marginBottom: 8 }}>{property.name}</div>
          <div style={{ fontSize: 13, color: "#222", marginBottom: 18 }}>{property.address || ""}</div>
          {ra && <div style={{ fontSize: 12, color: PRINT_MUTED, marginBottom: 6 }}>Reporting Period: {ra.periodLabel} · {new Date(ra.timestamp).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</div>}
          <div style={{ fontSize: 12, color: PRINT_MUTED }}>Prepared by: CRES</div>
        </section>

        {!ra && (
          <p style={bodyP}>No Review Audit has been run for this property yet. Run it from the Review Audit tab to populate this report.</p>
        )}

        {ra && (
          <>
            {/* KPIs */}
            <div className="pb-avoid" style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
              {([
                ["Current Rating", ra.kpis.currentRating !== null ? ra.kpis.currentRating.toFixed(1) : "—", "out of 5"],
                ["Prior Rating", ra.kpis.priorRating !== null ? ra.kpis.priorRating.toFixed(1) : "—", ra.kpis.priorIsEstimated ? "estimated" : "prior month"],
                ["Total Reviews", String(ra.kpis.totalReviews ?? "—"), "all-time"],
                ["New Reviews", String(ra.kpis.newReviews), ra.periodLabel],
                ["Response Rate", ra.kpis.responseRatePeriod !== null ? `${ra.kpis.responseRatePeriod}%` : "—", "this period"],
                ["Response Rate", ra.kpis.responseRateAllTime !== null ? `${ra.kpis.responseRateAllTime}%` : "—", "reviews checked"],
              ] as [string, string, string][]).map(([label, val, sub], i) => (
                <div key={i} style={{ flex: "1 1 28%", minWidth: 120, padding: "7px 10px", border: "1px solid #cfcfcf", borderLeft: `3px solid ${PRINT_TEAL}` }}>
                  <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 8.5, color: "#666", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 3 }}>{label}</div>
                  <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 19, fontWeight: 700, color: PRINT_NAVY, lineHeight: 1 }}>{val}</div>
                  <div style={{ fontSize: 8.5, color: "#888", marginTop: 2 }}>{sub}</div>
                </div>
              ))}
            </div>

            {/* Trend — one bar per month */}
            {snapshots.length >= 2 && (
              <div className="pb-avoid" style={{ marginBottom: 22 }}>
                <div style={subHead}>Rating &amp; Volume Trend (by month)</div>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 14, paddingTop: 6 }}>
                  {snapshots.slice(-12).map((s, i) => {
                    const h = Math.max(8, (s.rating / 5) * 80);
                    const mLabel = snapshotMonthLabel(s);
                    return (
                      <div key={i} style={{ textAlign: "center", width: 52 }}>
                        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 10, color: PRINT_NAVY }}>{s.rating.toFixed(1)}</div>
                        <div style={{ height: h, background: PRINT_TEAL, margin: "3px auto", width: 26, WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" }} />
                        <div style={{ fontSize: 8, color: "#888" }}>{s.totalReviews} rev</div>
                        <div style={{ fontSize: 8, color: "#aaa" }}>{mLabel}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Breakdown — star bars (hidden when no new reviews this period) */}
            <PrintSectionHeader>{ra.period === "1mo" ? "Monthly" : "Period"} Review Breakdown</PrintSectionHeader>
            {(ra.starBreakdown.s5 + ra.starBreakdown.s4 + ra.starBreakdown.s3 + ra.starBreakdown.s2 + ra.starBreakdown.s1) === 0 ? (
              !ra.narratives.breakdown && (
                <p style={bodyP}>No new reviews were posted during {ra.periodLabel}, so there is no new-review breakdown for this period.</p>
              )
            ) : (
              <div className="pb-avoid" style={{ marginBottom: 10 }}>
                {(["s5", "s4", "s3", "s2", "s1"] as const).map((key, idx) => {
                  const count = ra.starBreakdown[key];
                  const maxC = Math.max(1, ra.starBreakdown.s1, ra.starBreakdown.s2, ra.starBreakdown.s3, ra.starBreakdown.s4, ra.starBreakdown.s5);
                  const colors = ["#22c55e", "#86c34a", "#f59e0b", "#f08a3c", "#e0524f"];
                  return (
                    <div key={key} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                      <span style={{ width: 44, fontSize: 9.5, color: "#555" }}>{5 - idx} Star</span>
                      <div style={{ flex: 1, background: "#f0f2f4", height: 11, WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" }}>
                        <div style={{ width: `${(count / maxC) * 100}%`, background: colors[idx], height: "100%", minWidth: count > 0 ? 4 : 0, WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" }} />
                      </div>
                      <span style={{ width: 18, textAlign: "right", fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 12, color: PRINT_NAVY }}>{count}</span>
                    </div>
                  );
                })}
              </div>
            )}
            {ra.narratives.breakdown && <p style={bodyP}>{ra.narratives.breakdown}</p>}

            {/* Rating Overview */}
            {ra.narratives.ratingOverview && (
              <>
                <PrintSectionHeader>Rating Overview</PrintSectionHeader>
                <p style={bodyP}>{ra.narratives.ratingOverview}</p>
              </>
            )}

            {/* Sentiment: This Period */}
            {ra.sentimentPeriod.length > 0 && (
              <>
                <PrintSectionHeader>Sentiment Analysis: {ra.periodLabel}</PrintSectionHeader>
                <p style={{ ...bodyP, fontSize: 9.5, color: "#777" }}>Themes from the new reviews this period.</p>
                {sentTable(ra.sentimentPeriod)}
              </>
            )}

            {/* Reviews awaiting a response */}
            {ra.responseGaps.length > 0 && (
              <>
                <PrintSectionHeader>Reviews Awaiting a Response</PrintSectionHeader>
                {ra.responseGaps.map((g, i) => (
                  <div key={i} className="pb-avoid" style={{ marginBottom: 8 }}>
                    <p style={{ ...bodyP, margin: "0 0 2px 0" }}>
                      <strong style={{ color: g.rating <= 2 ? "#b14a2a" : PRINT_NAVY }}>{g.reviewer} ({g.rating}★){g.date ? ` · ${g.date}` : ""}{g.escalate ? " — ESCALATE" : ""}:</strong>{" "}
                      <em style={{ color: "#555" }}>&ldquo;{g.text || "No written review text submitted"}&rdquo;</em>
                    </p>
                    {g.suggestedResponse && (
                      <p style={{ ...bodyP, margin: 0, color: "#15803d", paddingLeft: 10, borderLeft: "2px solid #93b2ab" }}>Suggested reply: {g.suggestedResponse}</p>
                    )}
                  </div>
                ))}
              </>
            )}

            {/* Response quality */}
            {ra.responseQuality.length > 0 && (
              <>
                <PrintSectionHeader>Owner Response Quality</PrintSectionHeader>
                {ra.responseQuality.map((q, i) => (
                  <div key={i} className="pb-avoid" style={{ marginBottom: 8 }}>
                    <p style={{ ...bodyP, margin: "0 0 2px 0" }}>
                      <strong style={{ color: PRINT_NAVY }}>{q.reviewer} ({q.rating}★):</strong>{" "}
                      {q.reviewText && <em style={{ color: "#666" }}>&ldquo;{q.reviewText}&rdquo;</em>}
                    </p>
                    {q.originalResponse ? (
                      <p style={{ ...bodyP, margin: "0 0 2px 0", color: "#555" }}>Current reply: &ldquo;{q.originalResponse}&rdquo;</p>
                    ) : null}
                    <p style={{ ...bodyP, margin: "0 0 2px 0", color: "#9a7200" }}>{q.issue}</p>
                    <p style={{ ...bodyP, margin: 0, color: "#15803d", paddingLeft: 10, borderLeft: "2px solid #93b2ab" }}>Suggested rewrite: {q.suggestedRewrite}</p>
                  </div>
                ))}
              </>
            )}

            {/* New reviews */}
            {ra.reviews.length > 0 && (
              <>
                <PrintSectionHeader>New Reviews ({ra.reviews.length})</PrintSectionHeader>
                {ra.reviews.map((r, i) => (
                  <div key={i} className="pb-avoid" style={{ marginBottom: 6 }}>
                    <div style={{ fontSize: 10.5 }}>
                      <strong style={{ color: PRINT_NAVY }}>{r.name}</strong>{" "}
                      <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, color: r.rating >= 4 ? "#15803d" : r.rating <= 2 ? "#b14a2a" : "#9a7200" }}>{r.rating}★</span>{" "}
                      <span style={{ color: "#999" }}>{r.relativeDate}</span>
                      {r.hasResponse && <span style={{ color: "#15803d", fontSize: 9 }}> · replied</span>}
                    </div>
                    <div style={{ fontSize: 10, color: r.text ? "#444" : "#aaa", fontStyle: r.text ? "normal" : "italic", lineHeight: 1.45 }}>{r.text || "[No written review text submitted]"}</div>
                  </div>
                ))}
              </>
            )}

            {/* Recommendations */}
            {isStructuredRecs(ra.recommendations) && (
              <section className="pb-before">
                <PrintSectionHeader>CRES Recommendations</PrintSectionHeader>
                {ra.recommendations.map((card, i) => (
                  <PrintRecCard key={i} card={card} />
                ))}
              </section>
            )}

          </>
        )}
      </div>
    </>
  );
}

function PrintableReport({ property, mode = "combined" }: { property: Property; mode?: "combined" | "seo" | "marketing" }) {
  const llmRecs = property.llmAuditRecommendations;
  const llmTs = property.llmAuditTimestamp;
  const seo = property.seoAudit;
  const mkt = property.marketingAudit;

  const now = new Date();
  const monthYear = now.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const auditDateBase = llmTs ? new Date(llmTs) : seo ? new Date(seo.timestamp) : now;
  const auditDate = auditDateBase.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  // SEO scorecard — SAME computation as the on-screen scorecard (single source:
  // computeSeoSummary) so the print report shows the identical figures and can't
  // drift. Counts only competitive (non-branded) queries.
  const seoSummary = seo ? computeSeoSummary(seo, property) : null;
  const seoMP = seoSummary?.mapPackCount ?? 0;
  const seoMPPartial = seoSummary?.mapPackPartial ?? 0;
  const seoP1 = seoSummary?.page1Count ?? 0;
  const seoAvg = seoSummary?.avgRank ?? null;
  const seoCompTotal = seoSummary?.competitiveTotal ?? 0;
  const seoBrandedCount = seoSummary?.brandedCount ?? 0;
  const seoRankingCount = seoSummary?.rankingCount ?? 0;
  const seoAvgMP = seoSummary?.avgMapPackRank ?? null;
  const seoBestMP = seoSummary?.bestMapPackRank ?? null;
  const seoMPRankingCount = seoSummary?.mapPackRankingCount ?? 0;
  const seoTotal = seoSummary?.total ?? 0;

  const cssName = property.name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const pageStyles = `
@media print {
  @page {
    size: letter;
    margin: 0.85in 0.65in 0.75in 0.65in;
    @top-left {
      content: "CRES  |  ${mode === "seo" ? "SEO Audit" : mode === "marketing" ? "Marketing Audit" : "Marketing & SEO Audit"}  |  ${cssName}  |  ${monthYear}";
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

  const seoSummaryLine = seo
    ? `Across ${seoCompTotal} competitive search ${seoCompTotal === 1 ? "query" : "queries"} representative of in-market renter intent${seoBrandedCount > 0 ? ` (plus ${seoBrandedCount} branded/navigational ${seoBrandedCount === 1 ? "query" : "queries"} excluded from these figures)` : ""}, the property appears in the Google Map Pack for ${seoMP} and on Page 1 organically for ${seoP1}${seoAvg ? ` (average organic rank #${seoAvg} among the competitive queries it ranks for)` : ", and does not rank organically for any of them"}.`
    : "A SEO Audit has not yet been run for this property. Run it from the SEO & Rank Check tab to populate this section.";

  // -- Recommendations: prefer the new structured cards; fall back to
  // legacy text + categorizer for older persisted audits.
  const structuredSeoRecs = isStructuredRecs(seo?.recommendations) ? seo!.recommendations as RecommendationCard[] : null;
  const structuredMktRecs = isStructuredRecs(mkt?.recommendations) ? (mkt!.recommendations as RecommendationCard[]) : null;

  // Recommendations the client has set aside are dropped from the active
  // printed lists and instead summarized in a "Considered & Set Aside" recap.
  const setAsideList = property.setAsideRecs ?? [];
  const setAsideKeys = new Set(setAsideList.map((s) => s.key));
  // In SEO-only mode the recap shows just the SEO-sourced items; the combined
  // report shows all of them.
  const setAsideForPrint =
    mode === "seo"
      ? setAsideList.filter((s) => s.audit === "seo")
      : mode === "marketing"
      ? setAsideList.filter((s) => s.audit === "marketing")
      : setAsideList;

  // ONE unified FIX list per report = marketing-audit recs + SEO recs, deduped.
  // SEO-only mode carries just the SEO cards; marketing-only mode just marketing.
  const allStructuredCards: RecommendationCard[] = dedupeRecCards(
    mode === "seo"
      ? [...(structuredSeoRecs || [])]
      : mode === "marketing"
      ? [...(structuredMktRecs || [])]
      : [...(structuredMktRecs || []), ...(structuredSeoRecs || [])]
  ).filter((c) => !isSetAside(c, setAsideKeys));

  // Group cards into priority bands for the printed report. The order
  // is intentional: foundational and quick wins come before strategic
  // multi-month work.
  const printBandOrder: { label: string; priorities: RecommendationPriority[] }[] = [
    { label: "Immediate Priority — This Week",      priorities: ["QUICK WIN"] },
    { label: "High Priority — Within 2 Weeks",      priorities: ["FOUNDATIONAL", "MAP PACK", "AI VISIBILITY"] },
    { label: "Content & Strategy — Within 30 Days", priorities: ["CONTENT", "STRATEGIC"] },
    { label: "Long-Tail — Ongoing",                 priorities: ["LONG-TAIL"] },
  ];
  // NB: every RecommendationPriority MUST appear in exactly one band above, or a
  // card with that priority silently drops from the printed report (that's how
  // "AI VISIBILITY" SEO cards were vanishing).
  const printBands = printBandOrder
    .map((b) => ({
      label: b.label,
      cards: allStructuredCards.filter((c) => b.priorities.includes(c.priority)),
    }))
    .filter((b) => b.cards.length > 0);

  // Legacy fallback (only used when the SEO audit is still in text form)
  const useLegacyTextRecs = !structuredSeoRecs && !!seo?.recommendations;
  const seoRecLines = useLegacyTextRecs ? splitRecommendations(typeof seo?.recommendations === "string" ? seo!.recommendations : "") : [];
  const allRecs: ParsedRec[] = [
    ...(mode === "marketing" ? [] : seoRecLines.map(categorizeRecommendation)),
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
    padding: "5px 8px",
    fontSize: 10,
    lineHeight: 1.45,
    color: PRINT_BODY,
    verticalAlign: "top",
    borderBottom: "0.5px solid #d8d8d8",
  };
  const findingsTh: React.CSSProperties = {
    padding: "5px 8px",
    background: PRINT_NAVY,
    color: "white",
    textAlign: "left",
    fontFamily: "'Barlow Condensed', sans-serif",
    fontSize: 9.5,
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
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/cres-logo.svg"
            alt="CRES"
            style={{
              maxWidth: 320,
              width: "60%",
              height: "auto",
              display: "block",
              margin: "0 auto 28px",
            }}
          />
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
            {mode === "seo" ? "SEO Audit" : mode === "marketing" ? "Marketing Audit" : "Marketing Audit & SEO Audit"}
          </h1>
          <div style={{ marginBottom: 28 }} />
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
          <div style={{ fontSize: 12, color: PRINT_MUTED, marginBottom: 6 }}>
            Audit Date: {auditDate}
          </div>
          <div style={{ fontSize: 12, color: PRINT_MUTED }}>Prepared by: CRES</div>
        </section>

        {/* ============ MARKETING AUDIT FINDINGS ============ */}
        {/* Skipped when printing the SEO / LLM audit on its own. */}
        {mode !== "seo" && mkt && (
          <section className="pb-before">
            <PrintSectionHeader>Marketing Audit</PrintSectionHeader>
            <p style={{ ...bodyP, fontSize: 10.5, color: "#555", marginBottom: 14 }}>
              Audited {new Date(mkt.timestamp).toLocaleString()}. Sources: website, Apartments.com, Google Business Profile.
            </p>

            {/* ILS & Google Consistency */}
            {mkt.consistency.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 12, letterSpacing: "0.06em", textTransform: "uppercase", color: PRINT_TEAL, marginBottom: 6 }}>
                  ILS &amp; Google Consistency Check
                </div>
                <table>
                  <thead>
                    <tr>
                      <th style={{ ...findingsTh, background: "#faf5ee", color: "#666" }}>Data Point</th>
                      <th style={findingsTh}>Apartments.com</th>
                      <th style={findingsTh}>Google</th>
                      <th style={findingsTh}>Website</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mkt.consistency.map((row, i) => {
                      const cell = (c: { status: MarketingStatus; note: string }) => {
                        const s = MK_STATUS[c.status] || MK_STATUS.amber;
                        return (
                          <td style={{ ...findingsTd, background: s.bg }}>
                            <strong style={{ color: s.fg }}>{s.label}.</strong> {c.note}
                          </td>
                        );
                      };
                      return (
                        <tr key={i} className="pb-avoid">
                          <td style={{ ...findingsTd, background: "#faf5ee", fontWeight: 700, color: PRINT_NAVY, width: 110 }}>{row.label}</td>
                          {cell(row.apartments)}
                          {cell(row.google)}
                          {cell(row.website)}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Phone / tracking numbers */}
            {mkt.phones && mkt.phones.numbers.length > 0 && (
              <div className="pb-avoid" style={{ marginBottom: 16 }}>
                <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 12, letterSpacing: "0.06em", textTransform: "uppercase", color: PRINT_TEAL, marginBottom: 6 }}>
                  Phone / Tracking Numbers
                </div>
                <p style={{ ...bodyP, fontSize: 10.5, color: "#555", marginBottom: 8 }}>
                  Found across the website, Google, and Apartments.com. Different numbers per platform are expected (lead-source tracking); each should dial the property.
                </p>
                <table>
                  <tbody>
                    {(["Website", "Google", "Apartments.com"] as const).flatMap((src) => {
                      const nums = mkt.phones!.numbers.filter((n) => n.source === src);
                      return nums.map((n, i) => (
                        <tr key={`${src}-${i}`} className="pb-avoid">
                          <td style={{ ...findingsTd, background: "#faf5ee", fontWeight: 700, color: PRINT_NAVY, width: 120 }}>{i === 0 ? src : ""}</td>
                          <td style={findingsTd}>{n.number}</td>
                          {mkt.phones!.dialTested && (() => {
                            const secs = typeof n.ringSeconds === "number" ? n.ringSeconds : null;
                            let label = "—";
                            let color = "#9a7200";
                            if (n.dialStatus === "failed") { label = "No connection"; color = "#b14a2a"; }
                            else if (n.dialStatus === "unknown") { label = "Inconclusive"; color = "#9a7200"; }
                            else if (n.dialStatus === "connected") {
                              if (n.answeredBy === "human") { label = `Answered by a person${secs != null ? ` (${secs}s)` : ""}`; color = "#15803d"; }
                              else if (n.answeredBy === "voicemail") { label = `Went to voicemail${secs != null ? ` (${secs}s)` : ""}`; color = "#9a7200"; }
                              else if (n.answeredBy === "fax") { label = "Fax line"; color = "#9a7200"; }
                              else if (n.dialNote === "no-answer") { label = `Rang${secs != null ? ` ~${secs}s` : ""}, no answer`; color = "#9a7200"; }
                              else if (n.dialNote === "busy") { label = "Line busy"; color = "#9a7200"; }
                              else { label = "Answered (person vs voicemail unclear)"; color = "#9a7200"; }
                            }
                            return (
                              <td style={{ ...findingsTd, textAlign: "center", width: 150, fontWeight: 700, color }}>{label}</td>
                            );
                          })()}
                        </tr>
                      ));
                    })}
                  </tbody>
                </table>
                {mkt.phones.dialTested && mkt.phones.dialTestedAt && (() => {
                  const when = formatDialTime(mkt.phones.dialTestedAt, property.address);
                  const openAt = officeOpenAt(mkt.phones.officeHours, mkt.phones.dialTestedAt, property.address);
                  const base: React.CSSProperties = { ...bodyP, fontSize: 10, margin: "8px 0 0 0", padding: "6px 10px", borderRadius: 4 };
                  if (openAt === false)
                    return (
                      <p style={{ ...base, background: "#f0faf4", border: "1px solid #bfe3cd", color: "#15803d" }}>
                        <strong>Dial-tested {when} — OUTSIDE the property&rsquo;s office hours.</strong> A &ldquo;no answer&rdquo; or &ldquo;voicemail&rdquo; above is expected here, not a finding.
                      </p>
                    );
                  if (openAt === true)
                    return (
                      <p style={{ ...base, background: "#fdf6ee", border: "1px solid #f0e2cd", color: "#9a6a2a" }}>
                        <strong>Dial-tested {when} — DURING the property&rsquo;s office hours.</strong> A &ldquo;no answer&rdquo; or &ldquo;voicemail&rdquo; above is a real lead-leak signal.
                      </p>
                    );
                  return (
                    <p style={{ ...base, background: "#faf7f2", border: "1px solid #ececec", color: "#555" }}>
                      Dial-tested {when} (property&rsquo;s local time). A &ldquo;no answer&rdquo; / &ldquo;voicemail&rdquo; above only signals a lead leak if the call landed during posted office hours.
                    </p>
                  );
                })()}
              </div>
            )}

          </section>
        )}

        {/* ============ SEO RANK FINDINGS ============ */}
        {/* Skipped when printing the Marketing Audit on its own. */}
        {mode !== "marketing" && seo && (
          <section className="pb-before">
            <PrintSectionHeader>SEO &amp; Online Presence</PrintSectionHeader>
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
                  [
                    "Map Pack Hits (top 3)",
                    `${seoMP}/${seoCompTotal}`,
                    seoMPPartial > 0 ? `+${seoMPPartial} more in pack` : "Competitive searches",
                  ],
                  [
                    "Avg Map Pack Rank",
                    seoAvgMP ? `#${seoAvgMP}` : "—",
                    seoAvgMP
                      ? `Best #${seoBestMP} · avg of ${seoMPRankingCount} in pack${seoCompTotal - seoMPRankingCount > 0 ? ` · absent on ${seoCompTotal - seoMPRankingCount} of ${seoCompTotal}` : ""}`
                      : "Not in the Map Pack",
                  ],
                  ["Page 1 Organic", `${seoP1}/${seoCompTotal}`, "Competitive searches"],
                  [
                    "Avg Organic Rank",
                    seoAvg ? `#${seoAvg}` : "—",
                    seoAvg
                      ? `avg of ${seoRankingCount} of ${seoCompTotal} that rank${seoCompTotal - seoRankingCount > 0 ? ` · absent on ${seoCompTotal - seoRankingCount} (not in top 30)` : ""}`
                      : "Not ranking (competitive)",
                  ],
                  [
                    "Queries Audited",
                    `${seoTotal}`,
                    seoBrandedCount > 0 ? `${seoCompTotal} competitive · ${seoBrandedCount} branded` : "Real-time Google search",
                  ],
                  [
                    "Google Rating",
                    seo.googleRating != null ? `${seo.googleRating.toFixed(1)} ★` : "—",
                    seo.googleRating != null
                      ? seo.googleReviewCount != null
                        ? `${seo.googleReviewCount} reviews`
                        : "Review count n/a"
                      : "No Google rating",
                  ],
                ] as [string, string, string][]
              ).map(([label, val, sub]) => (
                <div
                  key={label}
                  style={{
                    flex: 1,
                    padding: "9px 12px",
                    border: "1px solid #cfcfcf",
                    borderTop: `3px solid ${PRINT_TEAL}`,
                    textAlign: "center",
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

            {/* Methodology + "search from" point + hyper-local caveat */}
            <p
              className="pb-avoid"
              style={{ ...bodyP, fontSize: 10, color: "#7a5b1e", background: "#fff8ec", border: "1px solid #f5e2bd", borderRadius: 6, padding: "7px 12px", marginBottom: 12, lineHeight: 1.5 }}
            >
              <strong>How this is measured:</strong> for each tracked search we query Google live{" "}
              {seo.localizedToProperty
                ? "from the property’s exact location (its coordinates on its Google listing)"
                : `from ${seo.location || "the property’s city"}`}
              , then record its Map Pack (local 3-pack) position and its organic position. Google&rsquo;s local results
              are proximity-based, so checking{" "}
              {seo.localizedToProperty
                ? "from the property’s own spot shows what a renter searching near it actually sees"
                : "from the property’s area approximates what a nearby renter sees"}{" "}
              &mdash; not a city-wide average. Map Pack positions still shift with each searcher&rsquo;s precise location and
              personalization, so read them as &ldquo;visible to someone searching near the property,&rdquo; not an absolute
              rank. Organic ranks are more stable.
            </p>

            {/* Google review rank vs the local Map Pack */}
            {seo.localReviewComparison && seo.localReviewComparison.length >= 2 && (
              <div className="pb-avoid" style={{ marginBottom: 14 }}>
                <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: PRINT_NAVY, marginBottom: 6 }}>
                  Google Review Rank (Local Pack)
                </div>
                <div style={{ border: "1px solid #cfcfcf" }}>
                  {seo.localReviewComparison.map((e, i) => (
                    <div
                      key={`${e.name}-${i}`}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "6px 12px",
                        background: e.isSelf ? "#eef6f6" : i % 2 ? "#fafafa" : "#fff",
                        fontFamily: "'Josefin Sans', sans-serif",
                        fontSize: 10.5,
                        fontWeight: e.isSelf ? 700 : 400,
                        color: e.isSelf ? PRINT_TEAL : "#333",
                        borderTop: i === 0 ? "none" : "1px solid #eee",
                      }}
                    >
                      <span>
                        {i + 1}. {e.name}
                        {e.isSelf ? " (you)" : ""}
                      </span>
                      <span style={{ whiteSpace: "nowrap" }}>
                        {e.rating != null ? `${e.rating.toFixed(1)} ★` : "—"}
                        {e.reviews != null ? ` · ${e.reviews} reviews` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Strongest query / winnable opportunity */}
            {seoSummary && (seoSummary.strongestQuery || seoSummary.opportunityQuery) && (
              <div className="pb-avoid" style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                {seoSummary.strongestQuery && (
                  <div style={{ flex: 1, padding: "8px 12px", background: "#f0fdf4", borderLeft: "3px solid #22c55e", borderRadius: 4 }}>
                    <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "#15803d", marginBottom: 3 }}>
                      Strongest Query
                    </div>
                    <div style={{ ...bodyP, fontSize: 10.5, color: "#333", margin: "0 0 2px 0" }}>&ldquo;{seoSummary.strongestQuery}&rdquo;</div>
                    {seoSummary.strongestRank && (
                      <div style={{ ...bodyP, fontSize: 9.5, color: "#15803d", margin: 0 }}>
                        {seoSummary.strongestRank.map_pack_rank ? `Map Pack #${seoSummary.strongestRank.map_pack_rank}` : ""}
                        {seoSummary.strongestRank.map_pack_rank && seoSummary.strongestRank.organic_rank ? " · " : ""}
                        {seoSummary.strongestRank.organic_rank ? `Organic #${seoSummary.strongestRank.organic_rank}` : ""}
                      </div>
                    )}
                  </div>
                )}
                {seoSummary.opportunityQuery && (
                  <div style={{ flex: 1, padding: "8px 12px", background: "#feeee7", borderLeft: "3px solid #e2662f", borderRadius: 4 }}>
                    <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "#b14a2a", marginBottom: 3 }}>
                      {seoSummary.opportunityWinnable ? "Biggest Opportunity (Winnable)" : "Longer-Term Target"}
                    </div>
                    <div style={{ ...bodyP, fontSize: 10.5, color: "#333", margin: "0 0 2px 0" }}>&ldquo;{seoSummary.opportunityQuery}&rdquo;</div>
                    <div style={{ ...bodyP, fontSize: 9.5, color: "#b14a2a", margin: 0 }}>
                      {(() => {
                        const r = seoSummary.opportunityRank;
                        if (!r) return "";
                        if (seoSummary.opportunityWinnable) {
                          if (r.expanded_map_pack_rank) return `In the expanded Map Pack (#${r.expanded_map_pack_rank}) — push into the top 3`;
                          if (r.organic_rank) return `Organic #${r.organic_rank} (P${r.organic_page}) — close; winnable to page 1`;
                          if (r.map_pack_appeared) return "Appears in the Map Pack — push into the top 3";
                          return "Close — winnable with focused work";
                        }
                        return "Not ranking yet — longer-term target (broad term)";
                      })()}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Branded vs competitive explainer */}
            {seoBrandedCount > 0 && (
              <p
                className="pb-avoid"
                style={{ ...bodyP, fontSize: 9.5, color: "#44505c", background: "#f4f7f9", border: "1px solid #e2e8ec", borderRadius: 6, padding: "7px 12px", marginBottom: 14, lineHeight: 1.5 }}
              >
                <strong style={{ color: PRINT_NAVY }}>How to read this:</strong> the scorecard counts only the {seoCompTotal}{" "}
                competitive search{seoCompTotal === 1 ? "" : "es"} &mdash; the ones a stranger would type. The {seoBrandedCount}{" "}
                branded/navigational {seoBrandedCount === 1 ? "query" : "queries"} (your own name or street) {seoBrandedCount === 1 ? "is" : "are"}{" "}
                kept out of these numbers &mdash; ranking #1 for those is expected and doesn&rsquo;t reflect competitive visibility.
              </p>
            )}

            {seoCompTotal > 0 && (
              <p
                className="pb-avoid"
                style={{ ...bodyP, fontSize: 9.5, color: "#44505c", background: "#f4f7f9", border: "1px solid #e2e8ec", borderRadius: 6, padding: "7px 12px", marginBottom: 14, lineHeight: 1.5 }}
              >
                <strong style={{ color: PRINT_NAVY }}>Map Pack vs. organic:</strong> the <strong>Map Pack</strong> (the local
                3-pack on the map) is what a single property can realistically win, and Google shows it to people searching
                <em> near you</em> &mdash; that is the column to watch. For broad category searches the <strong>organic</strong>{" "}
                results are owned by listing sites like Apartments.com and Zillow for <em>every</em> property, so &ldquo;listing
                sites own this&rdquo; reflects the market, not a problem with your website. Growth levers are Map Pack
                visibility, reviews, and a complete, consistent Google listing.
              </p>
            )}

            <table>
              <thead>
                <tr>
                  <th style={findingsTh}>Query</th>
                  <th style={{ ...findingsTh, width: 80, textAlign: "center" }}>GBP Map Pack</th>
                  <th style={{ ...findingsTh, width: 95, textAlign: "center" }}>Website in Organic</th>
                  <th style={{ ...findingsTh, width: 95 }}>Since Start</th>
                  <th style={findingsTh}>Who&rsquo;s Beating You</th>
                </tr>
              </thead>
              <tbody>
                {seo.queries.map((q, i) => {
                  const r = seo.ranks[i];
                  const mpNow = r.map_pack_rank ?? r.expanded_map_pack_rank ?? null;
                  // Smooth the Map Pack position across recent checks so a
                  // minute-to-minute boundary flip doesn't read as a real move.
                  // Falls back to the live reading until there are >=2 checks.
                  const mpSmooth = smoothedMapPack(property.seoRankSnapshots, q, 5);
                  const mpMv = movementFor(property.seoRankSnapshots, q, "mapPackRank", mpSmooth ? mpSmooth.median : mpNow);
                  const orgMv = movementFor(property.seoRankSnapshots, q, "organicRank", r.organic_rank);
                  const printMoveColor = (t: "up" | "down" | "neutral") => (t === "up" ? "#15803d" : t === "down" ? "#b14a2a" : "#888");
                  const mapText = mpSmooth
                    ? mpSmooth.max > mpSmooth.min
                      ? `#${mpSmooth.median} (${mpSmooth.min}–${mpSmooth.max})`
                      : `#${mpSmooth.median}`
                    : r.map_pack_rank
                    ? `#${r.map_pack_rank}`
                    : r.expanded_map_pack_rank
                    ? `#${r.expanded_map_pack_rank}`
                    : r.map_pack_appeared
                    ? "Not in top 20"
                    : "—";
                  const mapColor = mpSmooth
                    ? mpSmooth.median <= 3
                      ? "#15803d"
                      : "#9a7200"
                    : r.map_pack_rank
                    ? "#15803d"
                    : r.expanded_map_pack_rank
                    ? "#9a7200"
                    : "#888";
                  const orgText = r.organic_rank
                    ? `#${r.organic_rank} · P${r.organic_page}`
                    : organicAbsentLabel(r.top_organic);
                  // Listing-site-owned organic (category head term) is the expected
                  // market reality for every property -> neutral gray, not alarm red.
                  const orgColor = r.organic_rank
                    ? r.organic_rank <= 10
                      ? "#15803d"
                      : r.organic_rank <= 30
                      ? "#9a7200"
                      : "#b14a2a"
                    : aggregatorsDominateOrganic(r.top_organic)
                    ? "#888"
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
                      <td style={{ ...findingsTd, fontSize: 8.5 }}>
                        {rankBaseline(property.seoRankSnapshots) ? (
                          <>
                            <div style={{ fontWeight: 700, color: printMoveColor(orgMv.tone) }}>Org {orgMv.label || "no change"}</div>
                            <div style={{ fontWeight: 700, color: printMoveColor(mpMv.tone) }}>Map {mpMv.label || "no change"}</div>
                          </>
                        ) : (
                          <span style={{ color: "#888" }}>baseline set</span>
                        )}
                      </td>
                      <td style={{ ...findingsTd, fontSize: 10, color: "#555" }}>
                        {(() => {
                          const b = competitorsBeating(property, r);
                          if (b.length) return b.slice(0, 3).join(", ") + (b.length > 3 ? ` +${b.length - 3} more` : "");
                          return r.map_pack_rank && r.map_pack_rank <= 3 ? "You lead" : "—";
                        })()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {seo.citations && seo.citations.sources.length > 0 && (() => {
              const rows = citationNetworkRows(seo.citations);
              // Prefer the caveat carried by the citation data itself (determined
              // deterministically at fetch time); fall back to the marketing audit.
              const aptNotAdv = rows.some((r) => r.notAdvertising) || aptListedNotAdvertising(mkt?.consistency);
              const isAptCaveat = (r: (typeof rows)[number]) =>
                r.present && /^Apartments\.com/i.test(r.network) && (r.notAdvertising || aptListedNotAdvertising(mkt?.consistency));
              // Count the caveat as present — a listing exists (the citation); the
              // "not actively advertising" flag is shown in the row, not dropped.
              const presentCount = rows.filter((r) => r.present).length;
              return (
                <div className="pb-avoid" style={{ marginTop: 18 }}>
                  <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 12, letterSpacing: "0.06em", textTransform: "uppercase", color: PRINT_TEAL, marginBottom: 6 }}>
                    Local Citations / Directory Presence
                  </div>
                  <p style={{ ...bodyP, fontSize: 10.5, color: "#555", marginBottom: 8 }}>
                    Appears on {presentCount} of {rows.length} directory networks. Directional read from one brand search; a network shown as not detected is worth verifying/claiming, not a confirmed absence.{aptNotAdv ? " Apartments.com shows a directory listing, but the property is not currently advertising there (see the consistency check)." : ""}
                  </p>
                  <table>
                    <thead>
                      <tr>
                        <th style={findingsTh}>Directory network</th>
                        <th style={{ ...findingsTh, width: 120, textAlign: "center" }}>Listing found</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => {
                        const caveat = isAptCaveat(r);
                        const active = r.present && !caveat;
                        return (
                          <tr key={i} className="pb-avoid">
                            <td style={findingsTd}>
                              {r.network}
                              {caveat ? (
                                <span style={{ color: "#9a6a2a" }}> — listed, not actively advertising</span>
                              ) : active && r.foundSites.length > 0 ? (
                                <span style={{ color: "#888" }}> — {r.foundSites.map((s) => s.name).join(", ")}</span>
                              ) : null}
                            </td>
                            <td style={{ ...findingsTd, textAlign: "center", fontWeight: 700, color: active ? "#15803d" : "#9a6a2a" }}>
                              {caveat ? "Not advertising" : active ? "Yes" : "Verify"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </section>
        )}

        {/* ============ WEBSITE OPTIMIZATION ============ */}
        {/* Skipped when printing the Marketing Audit on its own. */}
        {mode !== "marketing" && seo && (seo.pageSpeed || seo.technicalSeo) && (
          <section className="pb-before">
            <PrintSectionHeader>Website Optimization</PrintSectionHeader>
            <p style={{ ...bodyP, fontSize: 10.5, color: "#555", marginBottom: 14 }}>
              How the property&rsquo;s own website performs and reads to search engines and AI.
            </p>

            {seo.pageSpeed && seo.pageSpeed.strategies.some((s) => s.score != null) && (
              <div className="pb-avoid" style={{ marginTop: 4 }}>
                <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 12, letterSpacing: "0.06em", textTransform: "uppercase", color: PRINT_TEAL, marginBottom: 6 }}>
                  Page Speed / Core Web Vitals
                </div>
                <table>
                  <thead>
                    <tr>
                      <th style={findingsTh}>Device</th>
                      <th style={{ ...findingsTh, width: 70, textAlign: "center" }}>Score</th>
                      <th style={{ ...findingsTh, width: 70, textAlign: "center" }}>LCP</th>
                      <th style={{ ...findingsTh, width: 70, textAlign: "center" }}>CLS</th>
                      <th style={{ ...findingsTh, width: 70, textAlign: "center" }}>TBT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {seo.pageSpeed.strategies.map((s, i) => (
                      <tr key={i} className="pb-avoid">
                        <td style={{ ...findingsTd, textTransform: "capitalize" }}>{s.strategy}</td>
                        <td style={{ ...findingsTd, textAlign: "center", fontWeight: 700, color: s.score == null ? "#888" : s.score >= 90 ? "#15803d" : s.score >= 50 ? "#9a7200" : "#b14a2a" }}>
                          {s.score == null ? "—" : `${s.score}/100`}
                        </td>
                        <td style={{ ...findingsTd, textAlign: "center" }}>{s.lcp}</td>
                        <td style={{ ...findingsTd, textAlign: "center" }}>{s.cls}</td>
                        <td style={{ ...findingsTd, textAlign: "center" }}>{s.tbt}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {seo.pageSpeed.strategies.some((s) => s.field) && (
                  <p style={{ ...bodyP, fontSize: 10, color: "#15803d", marginTop: 4 }}>
                    Real users (Google 28-day field data — the stable benchmark):{" "}
                    {seo.pageSpeed.strategies
                      .filter((s) => s.field)
                      .map((s) => `${s.strategy} LCP ${s.field!.lcp}, CLS ${s.field!.cls}, INP ${s.field!.inp}`)
                      .join(" · ")}
                  </p>
                )}
                <p style={{ ...bodyP, fontSize: 10, color: "#888", marginTop: 4 }}>
                  Score and lab metrics above are a synthetic lab test (measured periodically, not live); the Real-users line is the accurate benchmark. 90+ good · 50–89 needs work · under 50 poor. Mobile is Google&apos;s ranking signal.
                </p>
              </div>
            )}

            {seo.technicalSeo && seo.technicalSeo.pages.length > 0 && seo.technicalSeo.blocked && (
              <div className="pb-avoid" style={{ marginTop: 18 }}>
                <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 12, letterSpacing: "0.06em", textTransform: "uppercase", color: PRINT_TEAL, marginBottom: 6 }}>
                  Technical / On-Page SEO
                </div>
                <p style={{ ...bodyP, fontSize: 10.5, color: "#555" }}>
                  The site&apos;s bot protection blocked our crawler this run, so on-page tags (meta descriptions, H1s, schema) could not be read and should be verified live rather than reported as gaps.
                </p>
              </div>
            )}

            {seo.technicalSeo && seo.technicalSeo.pages.length > 0 && !seo.technicalSeo.blocked && (() => {
              const tech = seo.technicalSeo;
              const ti = computeTechnicalIssues(tech);
              const cell = (good: boolean, label: string) => (
                <td style={{ ...findingsTd, textAlign: "center", fontWeight: 700, color: good ? "#15803d" : "#b14a2a" }}>{label}</td>
              );
              return (
                <div className="pb-avoid" style={{ marginTop: 18 }}>
                  <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 12, letterSpacing: "0.06em", textTransform: "uppercase", color: PRINT_TEAL, marginBottom: 6 }}>
                    Technical / On-Page SEO
                  </div>
                  <p style={{ ...bodyP, fontSize: 10.5, color: "#555", marginBottom: 8 }}>
                    {tech.source === "webfetch" ? "Read" : "Crawled"} {tech.pages.length} page(s). {ti.missingMeta.length} missing a meta description, {ti.missingH1.length} with no H1, {ti.multiH1.length} with multiple H1s; JSON-LD schema {ti.anySchema ? "present" : "absent"}.
                    {tech.source === "webfetch" && " Read via the web_fetch fallback (site blocked the crawler); schema detection is best-effort."}
                  </p>
                  <table>
                    <thead>
                      <tr>
                        <th style={findingsTh}>Page</th>
                        <th style={{ ...findingsTh, width: 55, textAlign: "center" }}>Meta</th>
                        <th style={{ ...findingsTh, width: 55, textAlign: "center" }}>H1</th>
                        <th style={{ ...findingsTh, width: 60, textAlign: "center" }}>Schema</th>
                        <th style={{ ...findingsTh, width: 55, textAlign: "center" }}>Words</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tech.pages.map((p, i) => (
                        <tr key={i} className="pb-avoid">
                          <td style={findingsTd}>{shortUrl(p.url)}</td>
                          {cell(!!p.metaDescription, p.metaDescription ? "Yes" : "No")}
                          {cell(p.h1Count === 1, p.h1Count === 0 ? "None" : String(p.h1Count))}
                          {cell(p.hasSchema, p.hasSchema ? "Yes" : "No")}
                          <td style={{ ...findingsTd, textAlign: "center" }}>{p.wordCount || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })()}

          </section>
        )}

        {/* ============ RECOMMENDATIONS ============ */}
        {/* ONE unified recommendations section per report. Structured cards come
            from allStructuredCards (marketing + SEO, deduped);
            legacy text lines are the fallback for older persisted audits. */}
        {(printBands.length > 0 || allRecs.length > 0) && (
          <section className="pb-before">
            <PrintSectionHeader>Recommendations</PrintSectionHeader>

            {/* Preferred path: structured cards grouped by priority band */}
            {printBands.length > 0 && printBands.map((band, i) => (
              <div key={i}>
                <PrintPriorityHeader>{band.label}</PrintPriorityHeader>
                {band.cards.map((card, j) => (
                  <PrintRecCard key={j} card={card} />
                ))}
              </div>
            ))}

            {/* Legacy fallback: render the old categorized text lists when
                no structured cards are available (older persisted audits) */}
            {printBands.length === 0 && recImmediate.length > 0 && (
              <>
                <PrintPriorityHeader>Immediate Priority (This Week)</PrintPriorityHeader>
                <ul style={{ paddingLeft: 18, margin: "0 0 12px 0" }}>
                  {recImmediate.map((r, i) => (
                    <li key={i} style={{ ...bodyP, marginBottom: 8, paddingLeft: 4 }}>{r.text}</li>
                  ))}
                </ul>
              </>
            )}
            {printBands.length === 0 && recHigh.length > 0 && (
              <>
                <PrintPriorityHeader>High Priority (Within 2 Weeks)</PrintPriorityHeader>
                <ul style={{ paddingLeft: 18, margin: "0 0 12px 0" }}>
                  {recHigh.map((r, i) => (
                    <li key={i} style={{ ...bodyP, marginBottom: 8, paddingLeft: 4 }}>{r.text}</li>
                  ))}
                </ul>
              </>
            )}
            {printBands.length === 0 && recOngoing.length > 0 && (
              <>
                <PrintPriorityHeader>Ongoing Optimization</PrintPriorityHeader>
                <ul style={{ paddingLeft: 18, margin: "0 0 12px 0" }}>
                  {recOngoing.map((r, i) => (
                    <li key={i} style={{ ...bodyP, marginBottom: 8, paddingLeft: 4 }}>{r.text}</li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}

        {/* ============ PROGRESS SINCE LAST AUDIT ============ */}
        {/* Accountability recap, kept at the very bottom so the report leads
            with findings + actions and closes with what moved since the prior
            run. Deterministic diff. Marketing/combined only. */}
        {mode !== "seo" && hasPriorMarketingBaseline(property) && mkt &&
          (() => {
            const prog = computeAuditProgress(
              property.marketingAuditPrev!,
              mkt.consistency
            );
            const resolved = prog.fixed;
            const regressedAll = prog.regressed;
            const empty =
              resolved.length === 0 && prog.stillOpen.length === 0 && regressedAll.length === 0;
            const sinceDate = new Date(prog.sinceTimestamp).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            });
            const grp: React.CSSProperties = { fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 10.5, letterSpacing: "0.03em", margin: "6px 0 2px" };
            const li: React.CSSProperties = { ...bodyP, margin: "0 0 2px 0", fontSize: 10.5 };
            return (
              <section className="pb-avoid">
                <PrintSectionHeader>Progress Since Last Audit</PrintSectionHeader>
                <p style={{ ...bodyP, marginBottom: 6 }}>
                  Since {sinceDate}: {resolved.length} resolved, {prog.stillOpen.length} still open, {regressedAll.length} regressed.
                </p>
                {empty ? (
                  <p style={{ ...bodyP, color: PRINT_MUTED, fontStyle: "italic" }}>
                    No changes in tracked findings since the last audit.
                  </p>
                ) : (
                  <>
                    {resolved.length > 0 && (
                      <div>
                        <div style={{ ...grp, color: "#15803d" }}>✓ Resolved</div>
                        {resolved.map((s, i) => (
                          <p key={`f${i}`} style={li}>{s}</p>
                        ))}
                      </div>
                    )}
                    {prog.stillOpen.length > 0 && (
                      <div>
                        <div style={{ ...grp, color: "#9a7200" }}>⚠ Still open</div>
                        {prog.stillOpen.map((s, i) => (
                          <p key={`o${i}`} style={li}>{s}</p>
                        ))}
                      </div>
                    )}
                    {regressedAll.length > 0 && (
                      <div>
                        <div style={{ ...grp, color: PRINT_ORANGE }}>✗ Regressed</div>
                        {regressedAll.map((s, i) => (
                          <p key={`r${i}`} style={li}>{s}</p>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </section>
            );
          })()}

        {/* ============ CONSIDERED & SET ASIDE ============ */}
        {/* Recommendations the client reviewed and chose not to pursue, with
            the reason — kept for accountability so the report shows what was
            evaluated and consciously deprioritized. */}
        {setAsideForPrint.length > 0 && (
          <section className="pb-avoid">
            <PrintSectionHeader>Considered &amp; Set Aside</PrintSectionHeader>
            <p style={{ ...bodyP, fontSize: 10.5, color: "#555", marginBottom: 12 }}>
              These recommendations were reviewed and set aside this cycle. They are documented
              here for transparency and can be revisited in a future audit.
            </p>
            {setAsideForPrint.map((s) => (
              <div key={s.key} className="pb-avoid" style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
                <span style={{ ...bodyP, margin: 0, flex: 1, color: "#555" }}>{s.title}</span>
                <span style={{ flexShrink: 0, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 9.5, letterSpacing: "0.04em", textTransform: "uppercase", color: PRINT_MUTED }}>
                  {s.reason}
                </span>
              </div>
            ))}
          </section>
        )}

        {/* ============ EMPTY STATE ============ */}
        {!llmTs && !llmRecs && !seo && (
          <section className="pb-before">
            <PrintSectionHeader>No Audits Yet</PrintSectionHeader>
            <p style={bodyP}>
              No audits have been run for this property. Run the Marketing Audit and the SEO
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
    updatePropertyById,
    addProperty,
    deleteProperty,
    clearRoster,
    resetActiveToDemo,
    exportRoster,
    importProperty,
  } = useRoster();
  const [tab, setTab] = useState("marketing");
  // Deployed commit SHA, read at runtime from /api/version so the footer badge
  // reflects the RUNNING build (Railway exposes the SHA at runtime, not to the
  // build). Falls back to the build-time value / "dev" locally.
  const [buildSha, setBuildSha] = useState<string>(process.env.NEXT_PUBLIC_COMMIT_SHA || "");
  useEffect(() => {
    let alive = true;
    fetch("/api/version")
      .then((r) => r.json())
      .then((d) => { if (alive && d?.sha) setBuildSha(d.sha); })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Which report to print: the combined Marketing/SEO/LLM doc, or the
  // standalone Review Audit. Set just before window.print() so only the
  // targeted .printable-report is in the DOM.
  const [printTarget, setPrintTarget] = useState<"combined" | "seo" | "review" | "marketing">("combined");
  const [printNonce, setPrintNonce] = useState(0);
  const [printMenuOpen, setPrintMenuOpen] = useState(false);
  useEffect(() => {
    if (printNonce > 0) window.print();
  }, [printNonce]);
  const doPrint = (target: "combined" | "seo" | "review" | "marketing") => {
    setPrintTarget(target);
    setPrintMenuOpen(false);
    setPrintNonce((n) => n + 1);
  };
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
      {/* Build stamp — glance to confirm which commit is actually deployed and
          end the "is this the latest build?" ambiguity. Hidden in print. */}
      <div
        data-print-hide="true"
        title={`Deployed build: ${buildSha || "dev"}`}
        style={{
          position: "fixed",
          bottom: 6,
          right: 8,
          zIndex: 100,
          fontFamily: "'Josefin Sans',sans-serif",
          fontSize: 10,
          color: "#9aa3ab",
          background: "rgba(255,255,255,0.7)",
          padding: "2px 6px",
          borderRadius: 4,
          pointerEvents: "none",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        build {(buildSha || "dev").slice(0, 7)}
      </div>
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
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setPrintMenuOpen((v) => !v)}
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
              title="Print an audit as a PDF. Choose 'Save as PDF' as the destination."
            >
              <span>📄</span> Print <span style={{ fontSize: 9 }}>▼</span>
            </button>
            {printMenuOpen && (
              <>
                <div onClick={() => setPrintMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
                <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 50, background: "white", borderRadius: 10, boxShadow: "0 6px 24px rgba(0,0,0,0.18)", border: "1px solid #e6e9ec", overflow: "hidden", minWidth: 280 }}>
                  <div style={{ padding: "7px 16px 3px", fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "#9aa3ad" }}>
                    Print standalone
                  </div>
                  {([
                    ["marketing", "Marketing Audit"],
                    ["seo", "SEO & Website Optimization"],
                    ["review", "Review Audit"],
                  ] as const).map(([target, label]) => (
                    <button
                      key={target}
                      onClick={() => doPrint(target)}
                      style={{ display: "block", width: "100%", textAlign: "left", background: "white", border: "none", padding: "9px 16px", fontFamily: "'Josefin Sans',sans-serif", fontSize: 12.5, color: B.oxford, cursor: "pointer", whiteSpace: "nowrap" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "#f4f7f9")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "white")}
                    >
                      📄 {label}
                    </button>
                  ))}
                  <div style={{ padding: "7px 16px 3px", borderTop: "1px solid #eef0f2", fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "#9aa3ad" }}>
                    Print together
                  </div>
                  <button
                    onClick={() => doPrint("combined")}
                    style={{ display: "block", width: "100%", textAlign: "left", background: "white", border: "none", padding: "9px 16px 11px", fontFamily: "'Josefin Sans',sans-serif", fontSize: 12.5, color: B.oxford, cursor: "pointer", whiteSpace: "nowrap" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#f4f7f9")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "white")}
                  >
                    🖨 Marketing + SEO &amp; Website Optimization
                  </button>
                </div>
              </>
            )}
          </div>
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

        {tab === "marketing" && <MarketingAuditTab property={property} onUpdateProperty={updateActive} />}
        {tab === "reviews" && <ReviewAuditTab property={property} onUpdateProperty={updateActive} />}
        {tab === "seo" && <SEOTab property={property} onUpdateProperty={updateActive} />}
      </div>

      {printTarget === "review" ? (
        <ReviewAuditReport property={property} />
      ) : (
        <PrintableReport
          property={property}
          mode={printTarget === "seo" ? "seo" : printTarget === "marketing" ? "marketing" : "combined"}
        />
      )}

      <PropertySettings
        open={settingsOpen}
        property={property}
        properties={properties}
        canDelete={properties.length > 1}
        rosterSize={properties.length}
        onSave={updateActive}
        onReset={resetActiveToDemo}
        onDelete={() => deleteProperty(property.id)}
        onClearAll={clearRoster}
        onExport={() => exportRoster()}
        onImport={(json, opts) => importProperty(json, opts)}
        onUpdateProperty={updatePropertyById}
        onEnrich={(p, opts) => enrichPropertyFromSerp(p, opts?.overwrite)}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
