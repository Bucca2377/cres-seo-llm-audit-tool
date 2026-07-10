"use client";

import { Fragment, useEffect, useState } from "react";
import {
  useRoster,
  buildSystemPrompt,
  buildPropContext,
  callAI,
  callSerp,
  callFetch,
  isStructuredRecs,
  type Property,
  type ChecklistStatus,
  type AuditRecommendations,
  type RecommendationCard,
  type RecommendationPriority,
  type MarketingAuditResult,
  type MarketingStatus,
  type ReviewAuditResult,
  type ReviewPeriod,
  type ReviewSnapshot,
  type ReviewSentimentRow,
  type ReviewItem,
  type ReviewResponseGap,
  type ReviewResponseQualityFlag,
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
type LLMGroupId = "profile" | "website";

const LLM_GROUPS: { id: LLMGroupId; label: string; hint: string }[] = [
  { id: "profile", label: "Google Profile & Reviews", hint: "How the property shows up on Google Maps and in its reviews" },
  { id: "website", label: "Website & Structured Data", hint: "On-site signals AI assistants read to cite the property" },
];

const LLM_ITEMS: { id: number; label: string; pts: number; description: string; group: LLMGroupId }[] = [
  { id: 1, label: "Google Business Profile", pts: 20, description: "Verified listing with photos, hours, and a full description", group: "profile" },
  { id: 3, label: "Review Volume (30+ target)", pts: 12, description: "30+ reviews across Google, Apartments.com, and Yelp", group: "profile" },
  { id: 4, label: "Review Quality (4.0+ avg)", pts: 10, description: "Average rating of 4.0 stars or higher", group: "profile" },
  { id: 5, label: "Consistent Name, Address & Phone", pts: 10, description: "Name, address, and phone match across every listing site", group: "profile" },
  { id: 10, label: "Owner Response to Reviews", pts: 7, description: "Management responds to all reviews, recent and old", group: "profile" },
  { id: 2, label: "Apartment Schema Markup", pts: 15, description: "JSON-LD RentalApartment structured data on the property website", group: "website" },
  { id: 6, label: "Structured FAQ on Website", pts: 10, description: "Q&A page with schema markup, ideal for AI citation", group: "website" },
  { id: 8, label: "Amenities Structured Data", pts: 8, description: "All amenities tagged with standard taxonomy across platforms", group: "website" },
  { id: 9, label: "Perplexity / Web Citations", pts: 5, description: "Cited in third-party rental guides or local content lists", group: "website" },
];

/**
 * Condensed CRES company playbooks (Resident Reviews P&P, Leasing Lead
 * Nurturing, Sales Process Best Practices). Injected into audit prompts so
 * that recommendations touching reviews, lead follow-up, or the tour/sales
 * process cite the ACTUAL CRES tactic by name instead of generic advice.
 */
const CRES_PLAYBOOK = `CRES COMPANY PLAYBOOK — when a recommendation concerns RESIDENT REVIEWS, LEAD NURTURING, or the TOUR / SALES PROCESS, ground it in these real CRES policies and describe the specific tactic. Do not invent generic advice when a CRES policy already covers it.

CRITICAL — describe these as plain actions, NOT as branded programs. Do NOT fabricate official-sounding names like "CRES text-message review protocol", "the CRES review program", or "the CRES lead nurturing system" — those are not real. The ONLY proper-noun program below is "Hug a Building". Everything else is a practice you describe in plain words: write "text residents a direct Google review link after a positive interaction", NOT "deploy the CRES text-message review protocol".

RESIDENT REVIEWS (CRES Resident Reviews P&P):
- Ask at peak-satisfaction moments: 3–5 days after move-in, right after a work order is resolved, at application/lease signing, at renewal, after resident events, and during "Hug a Building" visits. Never ask during unresolved issues, delinquency, or move-out.
- TEXT MESSAGE is the preferred channel — send a direct Google review link by text after a positive interaction (one tap, under 60 seconds).
- Remove friction everywhere: framed QR code at the front desk, QR on the back of staff badges/lanyards and business cards, a "Leave Us a Review" link in email signatures, a review link embedded in the automated "work order complete" notice, QR signage in laundry/mail/elevator/clubhouse, and a persistent "Rate Your Experience" button in the resident portal.
- "Hug a Building" (≈twice/year per building): power-wash + touch-up + resident gift baskets; use the face-to-face moment to gather feedback and solicit reviews with the QR code in hand.
- Respond to EVERY review. Never ask specifically for 5 stars — ask for honest feedback. Follow up only once.
- Employee incentives: $25 per 4-/5-star review that names a team member; $200/month (split among the team) for a month with ZERO 1–2 star reviews; $500/month (split) for 10+ four-/five-star reviews. Residents: you cannot pay for a positive review, but may reward ALL feedback with a small incentive (gift card / raffle).

LEAD NURTURING (CRES Leasing Lead Nurturing): Speed to lead is key. Days 1–7: call + text + email DAILY until a tour is booked or they opt out (call first, then text with a booking link, then a follow-up email). Days 8–30: all three channels every Monday. Post-tour: thank-you text + email within 1 hour; days 1–3 daily; days 4–14 every 3 days; days 15–30 weekly. Always learn where a lost lead leased and why, and log it in the CRM.

SALES PROCESS (CRES Sales Process Best Practices) — the 5-step tour close: (1) Meet at the door, (2) Collect ID, (3) Build the relationship, (4) Tour the community leading with their hot buttons, (5) Close at the desk with 2–3 options and a direct ask. Post-tour checklist: update CRM, thank-you within 1 hour, follow-up within 24 hours.`;

function statusOf(p: Property, itemId: number): ChecklistStatus {
  return p.checklistStatuses?.[String(itemId)] ?? "missing";
}

/* -- RECOMMENDATION CARD RENDERER ----------------------------------- */
/**
 * Visual styling for each priority tag. Background tint is intentionally
 * light so the cards stay readable when printed in greyscale.
 */
const PRIORITY_STYLES: Record<RecommendationPriority, { bg: string; fg: string; border: string }> = {
  "QUICK WIN":    { bg: "#e7f6ec", fg: "#0f7b3a", border: "#bce5c9" },
  "FOUNDATIONAL": { bg: "#feeee7", fg: "#b1410f", border: "#fcd5c4" },
  "MAP PACK":     { bg: "#e6f1f8", fg: "#1c5b8a", border: "#bcd6e8" },
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

function RecCard({ card }: { card: RecommendationCard }) {
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
      </div>
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

function RecommendationsBlock({ recs }: { recs: AuditRecommendations | null | undefined }) {
  if (!recs) return null;
  if (isStructuredRecs(recs)) {
    return (
      <div>
        {recs.map((card, i) => (
          <RecCard key={i} card={card} />
        ))}
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

    // -- Map Pack matching ------------------------------------------------
    // Check knowledge_graph first (branded queries), then local_results 3-pack.
    const top3 = localResults.slice(0, 3);
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
        const mapsData = await callSerp({ query, location, engine: "google_maps" });
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
                        : "Property not ranking"}
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
  const q = query.toLowerCase();
  if (nameMatches(query, property.name)) return true;
  // Street-name match: ONLY when the address's first segment is a real street
  // line (has a house number). Otherwise the first segment is the city, and
  // since every local query contains the city, everything would read as
  // branded. Also exclude the city/state so they can never be a street token.
  const streetLine = (property.address.split(",")[0] || "").toLowerCase();
  if (!/\d/.test(streetLine)) return false; // no house number → not a usable street line
  const city = extractCity(property.address).toLowerCase();
  const streetTokens = streetLine
    .replace(/^\s*\d+\s*/, "")
    .replace(/\b(n|s|e|w|ne|nw|se|sw|north|south|east|west)\b/g, " ")
    .replace(/\b(st|street|ave|avenue|rd|road|dr|drive|ln|lane|blvd|boulevard|loop|ct|court|way|pl|place|cir|circle|ter|terrace|pkwy|parkway|hwy|highway|trl|trail)\b/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && w !== city);
  return streetTokens.length > 0 && streetTokens.some((tok) => q.includes(tok));
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

  const pinnedQueries = property.pinnedQueries || [];
  const addPinnedQuery = () => {
    const q = newQuery.trim();
    if (!q) return;
    if (pinnedQueries.some((p) => p.toLowerCase() === q.toLowerCase())) {
      setNewQuery("");
      return;
    }
    onUpdateProperty({ ...property, pinnedQueries: [...pinnedQueries, q] });
    setNewQuery("");
  };
  const removePinnedQuery = (q: string) => {
    onUpdateProperty({
      ...property,
      pinnedQueries: pinnedQueries.filter((p) => p !== q),
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

      // Stage 1: generate queries
      setStage("queries");
      setProgress("Generating relevant search queries...");

      const amenitiesStr = currentProperty.amenities.slice(0, 8).join(", ") || "(none specified)";
      const unitType = (currentProperty.propertyType || "apartments").trim();
      const unitWord = unitType.toLowerCase();
      const bedroomTypes = (currentProperty.bedroomTypes || "").trim();
      const queriesPrompt = `Generate exactly 6 highly relevant Google search queries that prospective renters would use to find a home like ${currentProperty.name}.

Property: ${currentProperty.name}
Address: ${currentProperty.address}
Property type: ${unitType}${bedroomTypes ? `\nBedroom types offered: ${bedroomTypes}` : ""}
Amenities: ${amenitiesStr}

CRITICAL: This is a "${unitType}" community. Use that product word ("${unitWord}") in the queries — do NOT default to the generic word "apartments" unless the type genuinely is apartments. Search the way a renter looking for THIS kind of home would.

Mix the 6 queries as follows:
- 1 brand query (just the property name or a slight variant)
- 1 type + city query (e.g. "${unitWord} for rent in <city>")
- ${bedroomTypes
        ? `1 bedroom-specific query using a real bedroom count from "${bedroomTypes}" (e.g. "3 bedroom ${unitWord} for rent in <city>")`
        : `1 bedroom-count query (e.g. "2 bedroom ${unitWord} in <city>")`}
- 2 amenity-based queries combining a key amenity with the city
- 1 high-volume head query for the local rental market

Return ONLY a JSON array of 6 strings, no prose:
["query 1", "query 2", "query 3", "query 4", "query 5", "query 6"]`;

      const qResp = await callAI({ prompt: queriesPrompt, maxTokens: 400 });
      const qText = qResp.content?.[0]?.text || "";
      const qMatch = qText.match(/\[[\s\S]*\]/);
      if (!qMatch) throw new Error("Could not generate query candidates.");
      const autoQueries = JSON.parse(qMatch[0]) as string[];
      if (!Array.isArray(autoQueries) || autoQueries.length === 0) {
        throw new Error("No queries returned.");
      }

      // Always include the user's pinned "must-check" queries first, then the
      // freshly auto-generated set. De-duped case-insensitively so a pinned
      // query the AI also happened to produce isn't checked twice.
      const pinned = (currentProperty.pinnedQueries || [])
        .map((q) => q.trim())
        .filter(Boolean);
      const seenQ = new Set<string>();
      const queries: string[] = [];
      for (const q of [...pinned, ...autoQueries]) {
        const key = q.trim().toLowerCase();
        if (!key || seenQ.has(key)) continue;
        seenQ.add(key);
        queries.push(q.trim());
      }

      // Stage 2: parallel rank checks
      setStage("checking");
      let completed = 0;
      setProgress(`Checking rankings: 0 of ${queries.length} complete`);
      const rankPromises = queries.map((q) =>
        fetchGoogleRank(currentProperty, q).then((r) => {
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

      // AI-assistant visibility — folded into this single run so one button
      // covers Google rank + AI rank, and the recommendations address both.
      setProgress("Checking AI assistant visibility…");
      let llmRankResult: Property["llmRank"] | undefined;
      try {
        const aiCity = extractCity(currentProperty.address) || "the area";
        const aiType = currentProperty.propertyType?.trim() || "apartments";
        const aiQuery = `best ${aiType} to rent in ${aiCity}`;
        const aiPrompt = `A prospective renter asks an AI assistant: "What are the ${aiQuery}?"\n\nUse web search to answer the way the assistant naturally would, then report the SPECIFIC apartment communities you would actually name or recommend. The property being tracked is "${currentProperty.name}" at ${currentProperty.address}.\n\nReturn ONLY this JSON, no prose:\n{"namedProperties":["community names you would recommend, best first"],"mentionsTarget":true or false,"note":"one sentence"}`;
        const aiData = await callAI({ prompt: aiPrompt, useWebSearch: true, maxTokens: 1500 });
        const aiText = (aiData.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
        const am = aiText.match(/\{[\s\S]*\}/);
        if (am) {
          const ap = JSON.parse(am[0]) as { namedProperties?: string[]; mentionsTarget?: boolean; note?: string };
          llmRankResult = {
            checkedAt: new Date().toISOString(),
            query: aiQuery,
            models: [{ model: "Claude", mentionsTarget: !!ap.mentionsTarget, namedProperties: Array.isArray(ap.namedProperties) ? ap.namedProperties.slice(0, 12) : [], note: (ap.note || "").trim() }],
          };
        }
      } catch {
        /* best-effort — AI visibility is non-fatal */
      }
      const aiSummary = llmRankResult
        ? `AI ASSISTANT VISIBILITY — asked Claude "${llmRankResult.query}": Claude ${llmRankResult.models[0].mentionsTarget ? "NAMES" : "does NOT name"} ${currentProperty.name}. Communities Claude recommended: ${llmRankResult.models[0].namedProperties.join(", ") || "(none returned)"}. ${llmRankResult.models[0].note}`
        : "AI ASSISTANT VISIBILITY: could not be checked this run.";

      const recsPrompt = `SEO + AI visibility audit for ${currentProperty.name} at ${currentProperty.address}:

GOOGLE SEARCH RANK DATA:
${queryRankSummary}

${aiSummary}

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
11. Priority assignment guide:
   - QUICK WIN: ≤ 4 hours, near-term measurable impact
   - MAP PACK: local 3-pack / Google-listing-driven visibility (the most distinctive SEO category)
   - FOUNDATIONAL: hygiene that everything else depends on (name/address/phone consistency, schema, complete Google listing)
   - AI VISIBILITY: getting named by AI assistants (ChatGPT/Claude/Gemini) — structured/schema data, FAQ content answering renter questions, and presence on the sources AI cites (Apartments.com, Google reviews, Reddit, "best apartments in {city}" roundups/listicles)
   - CONTENT: requires writing pages, FAQs, blog posts
   - STRATEGIC: > 1 week, multi-month positioning (backlink outreach, review campaigns)
   - LONG-TAIL: niche query optimization with lower competition
12. AI VISIBILITY: if the AI-assistant visibility above shows the property is NOT named (or ranks below the competitors listed), include at least ONE recommendation with priority "AI VISIBILITY" to fix that — cite what Claude surfaced instead, and give concrete steps (schema markup, FAQ/answer content, getting listed in local "best of" roundups, strengthening the Apartments.com + Google presence AI pulls from). If the property IS named prominently, you may skip this.`;

      const rResp = await callAI({
        prompt: recsPrompt,
        system: buildSystemPrompt(currentProperty),
        maxTokens: 4000,
      });

      // Parse the structured JSON. parseRecCards recovers complete cards even
      // if the model's JSON is truncated, so we never dump raw JSON to the UI.
      const rawText = rResp.content?.[0]?.text || "";
      const recommendations: AuditRecommendations = parseRecCards(rawText);

      const finalResults: SEOAuditResults = {
        queries,
        ranks,
        recommendations,
        timestamp: new Date().toISOString(),
        location: extractLocation(currentProperty.address) || extractCity(currentProperty.address),
      };
      setResults(finalResults);
      onUpdateProperty({ ...currentProperty, seoAudit: finalResults, llmRank: llmRankResult ?? currentProperty.llmRank });
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

    // Split branded/navigational queries from competitive ones. The headline
    // scorecard is built ONLY from competitive queries — ranking #1 for your
    // own name or street is expected and would otherwise inflate the numbers.
    const branded = ranks.map((_, i) => isBrandedQuery(queries[i], property));
    const compIdx = ranks.map((_, i) => i).filter((i) => !branded[i]);
    const compRanks = compIdx.map((i) => ranks[i]);

    const mapPackCount = compRanks.filter((r) => r.map_pack_rank && r.map_pack_rank <= 3).length;
    // Partial credit: competitive queries where the property appears in the
    // Map Pack but below the top-3 3-pack (the "More places" expanded view,
    // e.g. #19). Present, just not prominent.
    const mapPackPartialRanks = compRanks
      .filter((r) => !(r.map_pack_rank && r.map_pack_rank <= 3) && r.expanded_map_pack_rank)
      .map((r) => r.expanded_map_pack_rank!);
    const mapPackPartial = mapPackPartialRanks.length;
    const bestPartialMP = mapPackPartialRanks.length ? Math.min(...mapPackPartialRanks) : null;
    const page1Count = compRanks.filter((r) => r.organic_rank && r.organic_rank <= 10).length;
    const compValid = compRanks.filter((r) => r.organic_rank).map((r) => r.organic_rank!);
    const avgRank = compValid.length
      ? Math.round(compValid.reduce((a, b) => a + b, 0) / compValid.length)
      : null;

    // Strongest / weakest are chosen among COMPETITIVE queries so the cards
    // surface a real win and a real gap, not "you rank #1 for your own name".
    let strongestIdx = -1;
    let strongestScore = -1;
    let weakestIdx = -1;
    let weakestScore = Infinity;
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
    });

    return {
      total: queries.length,
      competitiveTotal: compRanks.length,
      brandedCount: ranks.length - compRanks.length,
      mapPackCount,
      mapPackPartial,
      bestPartialMP,
      page1Count,
      avgRank,
      rankingCount: compValid.length,
      // Only call a competitive query "strongest" if it genuinely ranks
      // somewhere — otherwise there's no real win to highlight.
      strongestQuery: strongestIdx >= 0 && strongestScore > 0 ? queries[strongestIdx] : null,
      strongestRank: strongestIdx >= 0 && strongestScore > 0 ? ranks[strongestIdx] : null,
      weakestQuery: weakestIdx >= 0 ? queries[weakestIdx] : null,
    };
  })();

  return (
    <div style={{ background: "white", borderRadius: 10, padding: 24, boxShadow: "0 1px 6px rgba(0,0,0,0.07)", marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 16, letterSpacing: "0.08em", textTransform: "uppercase", color: B.oxford }}>
              SEO / LLM Audit
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
          {isRunning ? "Auditing..." : results ? "Re-run Audit" : "Run SEO / LLM Audit"}
        </button>
      </div>

      {/* Pinned "must-check" queries — always included alongside the
          auto-generated set on every run. */}
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
          Must-check queries
        </div>
        <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 11, color: "#aaa", marginBottom: 10 }}>
          Always checked every run, on top of the auto-generated queries. Add the searches you care about so they never disappear.
        </div>
        {pinnedQueries.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
            {pinnedQueries.map((q) => (
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
                  onClick={() => removePinnedQuery(q)}
                  title="Remove this query"
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
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={newQuery}
            onChange={(e) => setNewQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addPinnedQuery();
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
            onClick={addPinnedQuery}
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
          {/* Scorecard */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 18 }}>
            <KPI
              label="Map Pack hits (top 3)"
              value={`${summary.mapPackCount}/${summary.competitiveTotal}`}
              sub={
                summary.mapPackPartial > 0
                  ? `+${summary.mapPackPartial} more in pack (best #${summary.bestPartialMP})`
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
              label="Page 1 (organic)"
              value={`${summary.page1Count}/${summary.competitiveTotal}`}
              sub="of competitive searches"
              accent={summary.page1Count >= 4 ? "#22c55e" : summary.page1Count >= 2 ? "#f59e0b" : B.tangelo}
            />
            <KPI
              label="Avg rank (competitive)"
              value={summary.avgRank ? `#${summary.avgRank}` : "—"}
              sub={
                summary.avgRank
                  ? `Avg of ${summary.rankingCount} of ${summary.competitiveTotal} ranking competitive queries`
                  : "Not ranking for any competitive search"
              }
              accent={
                !summary.avgRank
                  ? B.tangelo
                  : summary.avgRank <= 10
                  ? "#22c55e"
                  : summary.avgRank <= 30
                  ? "#f59e0b"
                  : B.tangelo
              }
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
          </div>

          {/* Map Pack location caveat — ranks are hyper-local */}
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
            <strong>Checked from {results.location || "the property's city"}.</strong> Google&rsquo;s Map Pack is
            hyper-local: it changes with the searcher&rsquo;s exact location and personalization, so a Map Pack
            rank here may not match what you see from your own device. Treat Map Pack positions as
            &ldquo;visible to a searcher near the property,&rdquo; not an absolute rank. Organic ranks are far more stable.
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


          {/* Per-query results table */}
          <div style={{ border: "1px solid #e8e8e8", borderRadius: 8, overflow: "hidden", marginBottom: 18 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'Josefin Sans',sans-serif", fontSize: 12 }}>
              <thead>
                <tr style={{ background: B.oxford }}>
                  {["Query", "GBP Map Pack", "Website in Organic", "Who's Winning"].map((h) => (
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
                      </td>
                      <td style={{ padding: "10px 12px" }}>
                        <span
                          style={{
                            color: r.organic_rank && r.organic_rank <= 10 ? "#15803d" : r.organic_rank && r.organic_rank <= 30 ? "#9a7200" : B.tangelo,
                            fontWeight: 600,
                          }}
                        >
                          {r.organic_rank ? `#${r.organic_rank} (P${r.organic_page})` : "Property not ranking"}
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

          {/* AI assistant visibility (from the same run) */}
          {property.llmRank && property.llmRank.models[0] && (
            <div style={{ background: "white", border: "1px solid #e6e9ec", borderRadius: 8, padding: "16px 20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: B.oxford }}>
                  AI Assistant Visibility
                </span>
                <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", padding: "3px 10px", borderRadius: 20, background: property.llmRank.models[0].mentionsTarget ? "#E0F0E8" : "#FCE4E4", color: property.llmRank.models[0].mentionsTarget ? "#15803d" : "#b14a2a" }}>
                  {property.llmRank.models[0].model}: {property.llmRank.models[0].mentionsTarget ? `names ${property.name}` : `does not name ${property.name}`}
                </span>
              </div>
              <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 11.5, color: "#888", marginBottom: 8 }}>
                Asked “{property.llmRank.query}” — what an AI assistant recommends to renters.
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

          {/* Recommendations */}
          <div style={{ background: "linear-gradient(135deg,#eef7f5,#e4f0ec)", border: `1px solid ${B.cambridge}`, borderLeft: `4px solid ${B.caribbean}`, borderRadius: 8, padding: "14px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <span style={{ color: B.caribbean }}>✦</span>
              <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: B.caribbean }}>
                Recommendations (ranked by ROI)
              </span>
            </div>
            <RecommendationsBlock recs={results.recommendations} />
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

/* ================= OPTIMIZATION CHECKLIST (shared) =============== */
/**
 * The same web-search analysis LLMTab.runAudit performs, but pure: it RETURNS
 * the results instead of setting React state / calling onUpdateProperty. Used
 * by the Marketing Audit tab so one "Run Marketing Audit" click populates the
 * optimization checklist alongside the website/Apartments.com/Google audit.
 *
 * The prompt-building, SerpAPI pre-flights, and JSON parsing are copied
 * verbatim from LLMTab.runAudit — keep them in sync until LLMTab is removed.
 * NOTE: unlike LLMTab, this does NOT auto-capture website/gbpUrl enrichment;
 * the Marketing Audit already persists those URL fields from its own inputs.
 */
async function runChecklistAudit(property: Property): Promise<{
  statuses: Record<string, ChecklistStatus>;
  evidence: Record<string, string>;
  recommendations: AuditRecommendations;
}> {
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
    const serpQuery = buildGbpSearchQuery(property);
    const serpData = await callSerp({
      query: serpQuery,
      engine: "google_maps",
      location: extractLocation(property.address),
    });
    gbpGround = extractGBP(serpData, property);
  } catch {
    /* OK to proceed without ground truth */
  }

  // Second pre-flight: fetch reviews + owner responses via google_maps_reviews
  let responseRate: number | null = null;
  let responsesChecked = 0;
  let responsesWith = 0;
  let reviewsCallRan = false;
  if (gbpGround) {
    try {
      let dataId = gbpGround.dataId || "";
      if (!dataId) {
        const location = extractLocation(property.address);
        const mapsResp = await callSerp({
          query: buildGbpSearchQuery(property),
          engine: "google_maps",
          location,
        });
        const mapsResults: any[] = [
          ...(mapsResp?.place_results ? [mapsResp.place_results] : []),
          ...(Array.isArray(mapsResp?.local_results) ? mapsResp.local_results : []),
        ];
        const match = mapsResults.find((r: any) =>
          matchPropertyToResult(property, {
            title: r.title || r.name,
            website: r.website,
            address: r.address,
            dataId: r.data_id,
            placeId: r.place_id,
          })
        );
        dataId = match?.data_id || "";
      }

      if (dataId) {
        reviewsCallRan = true;
        const reviewsResp = await callSerp({
          engine: "google_maps_reviews",
          data_id: dataId,
        });
        const reviews: any[] = Array.isArray(reviewsResp?.reviews)
          ? reviewsResp.reviews
          : [];
        responsesChecked = reviews.length;
        const hasResponse = (r: any): boolean => {
          const candidates = [r?.response, r?.owner_response];
          for (const c of candidates) {
            if (!c) continue;
            if (typeof c === "string" && c.trim().length > 0) return true;
            if (typeof c === "object") {
              if (typeof c.snippet === "string" && c.snippet.trim().length > 0) return true;
              if (typeof c.text === "string" && c.text.trim().length > 0) return true;
              if (Object.keys(c).length > 0) return true;
            }
          }
          if (typeof r?.owner_response_snippet === "string" && r.owner_response_snippet.trim().length > 0) {
            return true;
          }
          return false;
        };
        responsesWith = reviews.filter(hasResponse).length;
        responseRate =
          responsesChecked > 0
            ? Math.round((responsesWith / responsesChecked) * 100)
            : null;
      }
    } catch {
      /* best-effort; proceed without a response rate */
    }
  }

  const effectiveReviewCount: number | null =
    typeof gbpGround?.reviewCount === "number"
      ? gbpGround.reviewCount
      : reviewsCallRan
      ? responsesChecked
      : null;
  const noReviews = effectiveReviewCount !== null && effectiveReviewCount < 5;

  let confirmedPlatforms: string[] = [];
  try {
    const listingData = await callSerp({
      query: `${property.name} ${city}`.trim(),
      engine: "google",
      location: extractLocation(property.address),
    });
    confirmedPlatforms = extractListingPlatforms(listingData, property);
  } catch {
    /* OK to proceed without listings ground truth */
  }

  const listingsBlock = confirmedPlatforms.length
    ? `LISTINGS GROUND TRUTH (verified via Google search — authoritative, the property IS listed on these): ${confirmedPlatforms.join(", ")}.
For Item 5 (Consistent Name, Address & Phone) and Item 8 (Amenities Structured Data), use this. Do NOT claim the property has "no presence on rental platforms" — it is demonstrably listed on ${confirmedPlatforms.length} platform(s). Do NOT web-search for items 5 or 8.
- Item 5: COMPLETE if confirmed on ≥3 platforms; PARTIAL if 1–2. (Confirmed here: ${confirmedPlatforms.length}.)
- Item 8: if Apartments.com is in the confirmed list, the listing exists — grade amenities completeness on that listing, never "no listing found".`
    : `LISTINGS: the automatic check did not confirm aggregator listings this run. Web-search to verify presence on Apartments.com / Zillow / Rent.com before claiming the property is absent; if you find listings, grade items 5 and 8 against them.`;

  const reviewStateBlock = noReviews
    ? `REVIEW STATE (OVERRIDE — this property has essentially NO Google reviews, about ${effectiveReviewCount}):
- Because there are no reviews yet, do NOT recommend "respond to every review", "pin a review", or anything about managing review responses — there is nothing to respond to.
- The single highest review priority is GENERATING the first reviews using the CRES tactics (text residents a direct Google review link at move-in / after a work order / at lease signing, QR codes at every touchpoint, the $25/$200/$500 employee incentive).
- Item 10 (Owner Response to Reviews): grade MISSING with evidence "No Google reviews yet, so there are no owner responses to manage — generating the first reviews is the priority." Do NOT web-search item 10 and do NOT spend a recommendation slot on responding to reviews.
- Items 3 and 4 (review volume/quality) are MISSING — too few reviews to count or rate.`
    : "";

  const groundTruthBlock = gbpGround
    ? `GOOGLE BUSINESS PROFILE GROUND TRUTH (verified via SerpAPI — Google's actual data):
- Listing exists as: "${gbpGround.name}"
- Address per Google: ${gbpGround.address}
- Rating: ${gbpGround.rating !== null ? gbpGround.rating + " stars" : "not shown"}
- Google review count: ${
        typeof gbpGround.reviewCount === "number"
          ? gbpGround.reviewCount + " reviews"
          : effectiveReviewCount !== null
          ? `about ${effectiveReviewCount} review${effectiveReviewCount === 1 ? "" : "s"} (Google didn't show a total; this is the count we could verify)`
          : "not shown"
      }
- Hours: ${gbpGround.hasHours ? "listed" : "NOT listed"}
- Phone: ${gbpGround.phone || "NOT listed"}
- Website per Google: ${gbpGround.website || "NOT listed"}
- Owner response rate: ${
        responseRate !== null
          ? `${responseRate}% (${responsesWith} of ${responsesChecked} top reviews have owner/management responses)`
          : "unable to verify automatically"
      }

For items 1, 3, 4, and 10 BELOW, use the ground truth above — do not search the web for those items, just grade against the rubric:
- Item 1 (Google Business Profile): Focus on whether the listing is LIVE and ACTIVELY MANAGED. COMPLETE if the listing exists with rating, reviews, hours, and address all present (signs of an active, used profile). PARTIAL if the listing exists but shows signs of neglect — missing hours, missing website link, no phone, or zero reviews despite the property being established. MISSING is not valid here since the listing exists. In evidence, cite signs of active management ("hours present, X reviews, rating Y") and flag any gaps ("phone not listed" / "website link missing"). Do NOT mention "claimed" or "unclaimed" — that status is unreliable and the real signal is whether the profile is live and being maintained.
- Item 3 (Review Volume): COMPLETE if Google review count ≥30. PARTIAL if 10–29. MISSING if <10. (You may add Apartments.com/Yelp counts if helpful, but Google count is the floor.)
- Item 4 (Review Quality): COMPLETE if rating ≥4.0. PARTIAL if 3.0–3.9. MISSING if <3.0 or no rating.
- Item 10 (Owner Response to Reviews): ${
        responseRate !== null
          ? `Use the owner response rate from ground truth (${responseRate}%). COMPLETE if ≥ 50%. PARTIAL if 1-49%. MISSING if exactly 0%.`
          : `The automatic check couldn't read the response rate this run, but reviews EXIST on Google. Web-search the property's Google reviews directly (1 search). Look for any sample of owner/management replies. If you see ANY owner responses in the search snippets → mark COMPLETE with evidence "Owner replies are visible on the property's Google reviews." If review search returns no signal at all → mark PARTIAL with evidence "Couldn't confirm owner replies automatically — open the property's Google reviews to check." Do not mark MISSING unless you can confirm zero owner responses across the visible review sample.`
      }

In your evidence sentences, cite the actual numbers (e.g., "254 reviews at 3.2 stars; 8 of 10 top reviews have owner responses").
`
    : `GROUND TRUTH UNAVAILABLE: SerpAPI did not return a matching Google Business Profile for this property (possibly due to a generic property name, an incorrect address, or a brand-new listing not yet in Google's index).

IMPORTANT: items 1, 3, 4, and 10 must be web-searched directly — do not assume the Google listing is missing, broken, or absent. Search Google for "${property.name} apartments ${city}" and look for the property's actual Google listing, review count, and rating. If found, grade against the standard rubric. If web search ALSO can't confirm the listing, mark each of those items as PARTIAL with evidence "Couldn't auto-check this — paste the property's Google listing link in Property Settings, then re-run the audit." Do NOT mark items 1, 3, 4, or 10 as MISSING based on the lack of automatic data alone.`;

  const item10NeedsWebSearch = responseRate === null;
  const listingsCovered = confirmedPlatforms.length > 0
    ? " Items 5 and 8 are covered by the LISTINGS GROUND TRUTH above — do NOT search the web for those either."
    : "";
  const costControl = gbpGround
    ? `IMPORTANT — COST CONTROL: do at MOST 1 web search per checklist item, and only when ground truth above doesn't already answer the question. For items 1, 3, 4 the ground truth above is authoritative — do NOT search the web for those items.${
        item10NeedsWebSearch
          ? " For item 10 (Owner Response to Reviews), one web search IS required because the response rate couldn't be captured automatically."
          : " For item 10 the ground truth above is authoritative — do NOT search the web."
      }${listingsCovered}`
    : `IMPORTANT — COST CONTROL: do at MOST 1 web search per checklist item. Because ground truth is UNAVAILABLE for this run, items 1, 3, 4, and 10 each require one web search to verify the GBP/reviews state. Do NOT skip those searches — but cap them at one each.${listingsCovered}`;

  const prompt = `${groundTruthBlock}

${listingsBlock}
${reviewStateBlock ? "\n" + reviewStateBlock + "\n" : ""}
Audit ${property.name} at ${property.address} for LLM search visibility. ${costControl}

PROPERTY FACTS:
- Name in our system: ${property.name}
- Address: ${property.address}
- City: ${city}
${property.propertyType ? `- Property type: ${property.propertyType} (use this product word in recommendations, not a generic "apartments")` : ""}
${property.bedroomTypes ? `- Bedroom types offered: ${property.bedroomTypes}` : ""}
${property.managerName ? `- Management company: ${property.managerName}` : ""}
${property.amenities.length ? `- Known amenities: ${property.amenities.slice(0, 6).join(", ")}` : ""}

PHASE 1 — PROPERTY IDENTIFICATION:
Use the ground truth above when present. If no ground truth, do ONE search "${property.name} ${city}" to identify the property's actual web footprint (name variations, official website). Do NOT do exploratory multi-query searches — the budget per audit is roughly 7 web searches total (1 identification + up to 1 per remaining item).

PHASE 2 — GRADE EACH CHECKLIST ITEM:

CHECKLIST:
${itemsList}

Grading rubric — when evidence is clearly visible in search results, lean toward "complete". Only mark "missing" when MULTIPLE varied searches turn up nothing. Use "partial" for moderate evidence that doesn't fully meet the bar.

1. Google Business Profile — Detecting GBP via general web search is unreliable; the actual GBP knowledge panel often doesn't appear in search result snippets even when the GBP exists. Calibrate accordingly:
   - COMPLETE: search results explicitly show a Google Business listing with star rating + review count + hours/address (the knowledge panel surfaced in search snippets).
   - COMPLETE also if you find direct google.com/maps/place/ URLs in results pointing to this property.
   - PARTIAL: GBP isn't directly visible in search snippets BUT you found strong indirect evidence the business is established online — any of: a Yelp listing with hours/phone, a working official website (e.g., edge26.trionliving.com), a phone number that responds to searches, an active social presence. Established apartment communities almost always have a Google listing — if there's clear evidence the business exists, lean PARTIAL rather than MISSING. Note in the evidence: "Google listing likely exists but didn't show up in search — add its link in Property Settings to confirm."
   - MISSING: only if you find NO web presence for the property at all (no website, no Yelp, no listings anywhere). This should be rare for established apartment communities.
   - Note: ${gbpGround ? "ground truth above is authoritative for this item. Do NOT search the web for GBP — use the ground truth data only." : "ground truth was UNAVAILABLE this run. Web-search this item once to verify; lean PARTIAL with the manual-verification note if the search is inconclusive."}

2. Apartment Schema Markup — Check the property's official website (visit the homepage if found). COMPLETE only if you can confirm JSON-LD/RentalApartment schema. PARTIAL if the website exists and is well-structured but schema can't be confirmed from snippets. MISSING if no official website found.

3. Review Volume — Sum visible review counts across Google + Apartments.com + Yelp + Apartment Ratings + any other platforms. COMPLETE if total ≥50 across platforms. PARTIAL if 20-49. MISSING if <20 or unable to find any. (A GBP with 312 Google reviews alone clearly qualifies as COMPLETE.)

4. Review Quality — COMPLETE if average rating ≥4.0 on the primary platform (usually Google). PARTIAL if 3.0-3.9. MISSING if <3.0 or no reviews exist.

5. Consistent Name, Address & Phone — FIRST consult the LISTINGS GROUND TRUTH block above; it lists the platforms where this property is confirmed present. COMPLETE if confirmed on ≥3 platforms; PARTIAL if 1–2; only consider MISSING if zero platforms are confirmed AND a web search also finds none. Never claim "no presence on rental platforms" when the ground truth lists any. (If platforms are confirmed, do not web-search this item.)

6. Structured FAQ on Website — If you found the website in Phase 1, look for an /faq, /questions, or /resident-faq URL. COMPLETE if a dedicated FAQ page exists. PARTIAL if FAQ-style content exists but not on a dedicated page. MISSING if no FAQ content found OR no website found.

8. Amenities Structured Data — If Apartments.com is in the LISTINGS GROUND TRUTH block above, the listing EXISTS; grade the amenities section's completeness, never "no listing found". COMPLETE if the listing has a fully populated amenities section (10+ amenities tagged). PARTIAL if some amenities listed but sparse (<10), or if the listing exists but amenity depth can't be confirmed from snippets. MISSING only if Apartments.com is genuinely absent from the confirmed listings AND a web search finds no listing.

9. Perplexity / Web Citations — Search for queries like "best apartments ${city}" or "${city} apartment guide" or "${city} luxury apartments". COMPLETE if ${property.name} is cited in 2+ third-party blog posts/guides. PARTIAL if cited once. MISSING if no citations beyond official listings.

10. Owner Response to Reviews — ${
        responseRate !== null
          ? `See ground truth above (owner response rate ${responseRate}% from actual review data). Do NOT web-search for this item.`
          : "Ground truth couldn't capture a response rate. Web-search the property's Google reviews ONCE for visible owner/management replies. Grade per the rubric above — do NOT default to 'manual verification' when reviews clearly exist on Google."
      }

Return ONLY a JSON object, no prose before or after:
{
  "audit": [
    {"id": 1, "status": "complete" | "partial" | "missing", "evidence": "one specific sentence citing what you found, including names/numbers"},
    ... (entries for ALL 10 items, in id order)
  ],
  "recommendations": [
    {
      "priority": "QUICK WIN" | "FOUNDATIONAL" | "MAP PACK" | "STRATEGIC" | "CONTENT" | "LONG-TAIL",
      "title": "Imperative phrase, max 12 words, no period",
      "what": "1-3 sentences. Exactly what to do. Name the URL / page / system / vendor when relevant. No hedging.",
      "why": "1-2 sentences. The audit finding that triggered this + the business impact in concrete terms. Cite numbers when available.",
      "effort": "Format: '~<time> · <who>'. Examples: '~30 min · web developer', '~2 hrs · marketing manager', '~1 week · vendor + PM review'.",
      "success": "Measurable outcome. Example: 'Schema validates at schema.org/validator within 1 week' or 'Google review count reaches 30+ within 90 days'.",
      "source": "Which audit finding this addresses. Example: 'Item 2 (0/15 → target 15/15)' or 'Items 3 & 4 (review volume + quality both MISSING)'."
    },
    ... 5 cards total
  ]
}

Evidence sentences must cite SPECIFIC findings (e.g., "Found the Google listing 'View Apartments by Trion Living' at 10701 N Pecos St with 312 Google reviews at 3.8 stars, hours and photos present" — NOT generic statements like "Google listing exists").

PLAIN-ENGLISH RULE (applies to every evidence sentence — this is read by a property manager, not an SEO specialist): write the way you'd explain it to a busy property manager. NEVER use the jargon terms "NAP", "ground truth", "knowledge panel", "GBP", "ILS", "SERP", or "manual verification recommended" in evidence. Say "Google listing" not "GBP", "name/address/phone match" not "NAP", "listing sites" not "ILS". When something couldn't be checked automatically, say plainly "Couldn't verify automatically — paste the property's Google listing link in Property Settings, then re-run." — never "manual verification recommended."

${CRES_PLAYBOOK}

Recommendation rules (STRICT):
1. EXACTLY 5 recommendations. Order by highest impact first.
2. Each "title" is imperative and scannable — start with a verb (Add, Build, Claim, Launch, Audit, Publish, Fix).
3. "what" must be concrete: name the specific page/URL, vendor, plugin, or platform. Forbid generic verbs without an object ("improve SEO" is unacceptable; "Add JSON-LD ApartmentComplex schema to {property website URL}/floor-plans" is correct).
4. "why" must reference an actual audit finding (the status + score for one or more items) AND state the impact. Forbid generic statements ("important for SEO" is unacceptable; "Audit found 0/15 on Item 2 (schema); AI assistants like ChatGPT need structured data to cite specific facts" is correct).
5. "effort" must include time + role.
6. "success" must be measurable and time-boxed when possible.
7. "source" must reference specific item IDs from the audit above.
8. CRES PLAYBOOK GROUNDING: any recommendation about reviews, lead follow-up, or the tour/sales process MUST use the specific CRES tactic from the playbook above, described plainly in "what" — e.g. "text residents a direct Google review link after positive interactions", "add a review-link QR code to work-order-complete notices", "Hug a Building visits", "the $25/$200/$500 review incentive", "call + text + email daily for the first 7 days". Do NOT give generic review/lead advice when the CRES playbook covers it, and do NOT fabricate branded program names (no "CRES text-message review protocol" — that is not a real thing; only "Hug a Building" is a named program).
9. Priority assignment guide:
   - QUICK WIN: ≤ 4 hours, near-term measurable impact
   - FOUNDATIONAL: GBP, schema, NAP, website hygiene — must-have before others can compound
   - CONTENT: requires writing pages, FAQs, blog posts, social
   - STRATEGIC: > 1 week, multi-stakeholder, ongoing program (review campaigns, backlink outreach)
   - LONG-TAIL: niche query optimization with lower competition
   - MAP PACK: not used for LLM audit (SEO-only) — never apply to LLM recs.`;

  const data = await callAI({ prompt, maxTokens: 4000, useWebSearch: true });
  const text = (data.content || [])
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n");
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Audit returned no JSON.");

  const parsed = JSON.parse(match[0]) as {
    audit: { id: number; status: ChecklistStatus; evidence: string }[];
    recommendations: AuditRecommendations;
  };
  if (!Array.isArray(parsed.audit)) throw new Error("Audit data malformed.");

  const statuses: Record<string, ChecklistStatus> = {};
  const evidence: Record<string, string> = {};
  for (const a of parsed.audit) {
    if (a && typeof a.id === "number") {
      statuses[String(a.id)] = a.status;
      evidence[String(a.id)] = a.evidence || "";
    }
  }

  const recs = parsed.recommendations;
  const normalizedRecs: AuditRecommendations = isStructuredRecs(recs)
    ? recs
    : typeof recs === "string"
    ? recs
    : "";

  return { statuses, evidence, recommendations: normalizedRecs };
}

/**
 * Display-only optimization checklist: the score gauge + grouped checklist with
 * manual click-to-cycle status and audit evidence. Lifted from LLMTab's render
 * (minus the run button). Reads/writes the same Property fields LLMTab uses
 * (checklistStatuses / checklistEvidence), so a run in either place shares data.
 */
function OptimizationChecklist({
  property,
  onUpdateProperty,
}: {
  property: Property;
  onUpdateProperty: (p: Property) => void;
}) {
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

  return (
    <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 20 }}>
      <div style={{ background: "white", borderRadius: 10, padding: "24px 20px", boxShadow: "0 1px 6px rgba(0,0,0,0.07)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 13, letterSpacing: "0.1em", textTransform: "uppercase", color: B.oxford, marginBottom: 16, textAlign: "center" }}>LLM Visibility Score</div>
        <ScoreMeter score={earned} max={total} />
        <div style={{ marginTop: 14, fontFamily: "'Josefin Sans',sans-serif", fontSize: 11, color: "#aaa", textAlign: "center", lineHeight: 1.6 }}>Measures how likely AI assistants are to cite {property.name} in apartment searches</div>
      </div>
      <div style={{ background: "white", borderRadius: 10, overflow: "hidden", boxShadow: "0 1px 6px rgba(0,0,0,0.07)" }}>
        <div style={{ padding: "12px 18px", borderBottom: "1px solid #f0f0f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 13, letterSpacing: "0.1em", textTransform: "uppercase", color: B.oxford }}>Optimization Checklist</span>
        </div>
        <div style={{ maxHeight: 320, overflowY: "auto" }}>
          {LLM_GROUPS.map((group) => {
            const items = LLM_ITEMS.filter((it) => it.group === group.id);
            const groupEarned = items.reduce((s, it) => s + earnedPoints(it.pts, statusOf(property, it.id)), 0);
            const groupTotal = items.reduce((s, it) => s + it.pts, 0);
            return (
              <div key={group.id}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "7px 18px",
                    background: "#f7f9fa",
                    borderTop: "1px solid #eef1f3",
                    borderBottom: "1px solid #eef1f3",
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontFamily: "'Barlow Condensed',sans-serif",
                        fontWeight: 700,
                        fontSize: 12,
                        letterSpacing: "0.09em",
                        textTransform: "uppercase",
                        color: B.oxford,
                      }}
                    >
                      {group.label}
                    </div>
                    <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 10, color: "#aaa", marginTop: 1 }}>
                      {group.hint}
                    </div>
                  </div>
                  <span
                    style={{
                      fontFamily: "'Barlow Condensed',sans-serif",
                      fontWeight: 700,
                      fontSize: 14,
                      color: "#8a909a",
                      flexShrink: 0,
                      marginLeft: 10,
                    }}
                  >
                    {groupEarned}/{groupTotal}
                  </span>
                </div>
                {items.map((item, i) => {
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
                        borderBottom: i < items.length - 1 ? "1px solid #fafafa" : "none",
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
          Click any row to cycle status manually. Run the Marketing Audit below to populate statuses + evidence automatically via web search.
        </div>
      </div>
    </div>
  );
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

  useEffect(() => {
    setWebsite(property.website ?? "");
    setAptUrl(property.apartmentsUrl ?? "");
    setGbpUrl(property.gbpUrl ?? "");
    setResults(property.marketingAudit ?? null);
    setStage(property.marketingAudit ? "done" : "idle");
    setError(null);
    setProgress("");
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
      try {
        const serpData = await callSerp({
          query: buildGbpSearchQuery(current),
          engine: "google_maps",
          location: extractLocation(current.address),
        });
        const gbp = extractGBP(serpData, current);
        const place = serpData?.place_results;
        // Google profile photo URLs for the vision pass. Use the direct Google
        // CDN thumbnails (not the serpapi proxy) and downsize to ~512px to keep
        // vision token cost low.
        googlePhotos = (Array.isArray(place?.images) ? place.images : [])
          .map((im: any) => im?.thumbnail || "")
          .filter((u: string) => /^https?:\/\//i.test(u) && !/serpapi\.com/i.test(u))
          .map((u: string) => u.replace(/=w\d+-h\d+/i, "=w512-h512"))
          .slice(0, 8);
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
      try {
        const siteRes = await callFetch({ url: current.website || "", follow: true, maxPages: 8 });
        const sitePages = siteRes.pages || [];
        siteText = sitePages
          .map((p) => `=== ${p.url} (status ${p.status ?? "?"}) ===\n${(p.text || "").trim() || "[no content rendered]"}`)
          .join("\n\n");
        siteImages = siteRes.images || [];
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

      setProgress("Analyzing content and writing the report…");
      const prompt = `You are a senior multifamily marketing auditor producing a concise, client-facing Marketing Audit for ${current.name} at ${current.address}.${current.propertyType ? ` This is a ${current.propertyType} community.` : ""}

PROPERTY WEBSITE${current.website ? ` (${current.website})` : ""}:
${
  siteBlocked
    ? `Our headless browser was BLOCKED by the site's bot protection (Cloudflare / 403), so no page content is below. FETCH the website URL above with your web_fetch tool and report what you ACTUALLY see there (office hours, floor plans/pricing, tour scheduling, online application, concessions, amenities, photos). Treat web_fetch content as authoritative for the website columns, exactly like the Apartments.com listing. Only if web_fetch ALSO cannot access it, mark the website rows amber "could not verify; check live".`
    : `the pages below were captured with a REAL headless browser, so JavaScript-rendered pricing, floor plans, galleries, tour tools, and specials ARE included. Report ONLY what you actually see in them:\n${siteText}`
}

APARTMENTS.COM LISTING: ${current.apartmentsUrl ? `FETCH this exact URL with your web fetch tool and report what you actually see (Apartments.com is readable that way and returns the full units/pricing/specials/photos/hours): ${current.apartmentsUrl}` : "no listing URL was provided"}${aptConfirmed ? "\n[An Apartments.com listing for this property is confirmed live and indexed on Google.]" : ""}

${gbpBlock}

RULES (apply strictly):
- WEBSITE: use whichever source is available above — the headless-rendered pages OR your own web_fetch of the site if the browser was blocked. READ it and report real data: mark a feature GREEN with the actual numbers/details (real prices, unit counts, special wording, hours) when present; mark it RED only when the feature is structurally ABSENT from what you can see. Mark AMBER only if BOTH the headless browser AND your web_fetch failed to load the site (truly could not verify). Do NOT mark rows amber just because the headless browser was blocked if your web_fetch reached the site.
- APARTMENTS.COM: fetch the URL above with your tool. If it returns the listing (units, pricing, photos, specials), mark "currently advertising / active" GREEN and report the real data. Only mark "not advertising" red if it LITERALLY says "not currently advertising". If your fetch errors or returns nothing, mark the Apartments.com rows AMBER "could not verify automatically; check live" — NEVER red.
- GOOGLE SCOPE: a Google Business Profile only carries active presence, hours, photos, rating/reviews, and the website link. For rows it does NOT carry (pricing, concessions, preferred employers, online application, tour scheduling, virtual tour) set the Google status to "na" with note "Not a Google feature". Never put amber/red in those Google cells.
- OFFICE HOURS = CONSISTENCY CHECK. First, normalize the values: a day shown as "12 AM to 12 AM" (or "12:00 AM to 12:00 AM" / "00:00 to 00:00") is a ZERO-LENGTH window that means CLOSED, not open 24 hours. Treat it as Closed. Then compare the hours across platforms day by day. Only flag a genuine difference in OPEN/CLOSE TIMES on a day both platforms are open (e.g. "Google shows weekdays starting at 10 AM, but the website and Apartments.com show 9 AM, and Google shows Saturday closing at 4 PM vs 2 PM elsewhere"). Mark conflicting cells AMBER with that plain-English note. Do NOT flag "12 AM to 12 AM" as open 24 hours, a data-entry error, or a conflict — it just means Closed. Mark hours GREEN when they match (treating 12 AM-12 AM as Closed). Write plainly; never use jargon like "structurally invalid".
- PHOTOS = QUALITY, NOT PRESENCE. Mark GREEN only when the content shows genuinely professional, high-quality photos (a real gallery with sharp interior/amenity/exterior images). The mere existence of photos is NOT enough. If you can only confirm photos exist but cannot judge quality (e.g. a Google profile that "has photos", or just a count), mark AMBER "photos present, quality not assessed". Never mark photos GREEN from presence alone.
- DO NOT flag differing PHONE NUMBERS across platforms as a discrepancy. Different tracking numbers are intentional for lead-source attribution.
- Plain English, concise, no em dashes as punctuation, no "Note:" sections.

Status values are exactly "green" (found & functional), "amber" (present but unverified / could not render), "red" (confirmed absent), or "na" (not applicable to that platform).

Return ONLY this JSON object, no prose before or after:
{
  "executiveSummary": ["paragraph 1: what was audited + key strengths", "paragraph 2: most critical gaps + impact on lease conversion"],
  "websiteFindings": [
    {"label":"Leasing office hours","status":"green|amber|red","note":"one short clause"},
    {"label":"Schedule a tour","status":"...","note":"..."},
    {"label":"Apply now / online application","status":"...","note":"..."},
    {"label":"Available units & pricing","status":"...","note":"..."},
    {"label":"Concessions / specials","status":"...","note":"..."},
    {"label":"Preferred employers","status":"...","note":"..."},
    {"label":"Photos / gallery","status":"...","note":"..."},
    {"label":"Virtual tours","status":"...","note":"..."},
    {"label":"Amenities page","status":"...","note":"..."}
  ],
  "criticalIssues": [
    {"title":"short title","observed":"one sentence of what was observed","impact":"one sentence on how it hurts lease conversion"}
  ],
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
  "recommendations": [
    {
      "priority": "QUICK WIN" | "FOUNDATIONAL" | "CONTENT" | "STRATEGIC",
      "title": "Imperative phrase, max 12 words, no period",
      "what": "1-3 sentences. The concrete action. Name the page/platform/tool. No hedging.",
      "why": "1-2 sentences. The observed gap + its impact on lease conversion.",
      "effort": "Format: '~<time> · <who>'. e.g. '~30 min · marketing manager', '~1 week · web vendor'.",
      "success": "Measurable outcome with timeframe.",
      "source": "Which finding this addresses, e.g. 'Virtual tour missing on website + Apartments.com'."
    }
  ]
}

RECOMMENDATION RULES (match the rest of the app exactly):
- MUST RESOLVE THE FINDINGS: the recommendations exist to fix what THIS audit found. Every Critical Issue you listed AND every red (ISSUE) or amber (CHECK) cell in the consistency check must be addressed by at least one recommendation. Do not invent recommendations unrelated to the findings, and do not leave a critical issue without a fix.
- Order recommendations by damage: the fixes for the most harmful critical issues come first.
- "source" MUST name the exact finding each card resolves, e.g. "Resolves Critical Issue #1: office-hours conflict across platforms" or "Fixes Website + Apartments.com: Virtual tour ISSUE".
- COUNT: aim for 5 recommendations; use up to 7 ONLY if there are more distinct critical issues / red gaps than 5 to cover. Never leave a critical issue uncovered just to hit a number.
- "title" starts with a verb (Add, Build, Fix, Launch, Publish, Claim).
- "what" is concrete (name the page/platform); "why" cites the observed gap + lease impact. No generic platitudes.
- Priority: QUICK WIN (≤4 hrs, near-term), FOUNDATIONAL (must-have hygiene: hours, listing completeness, photos), CONTENT (pages/photos/virtual tour to create), STRATEGIC (>1 week / ongoing programs). Do NOT use MAP PACK or LONG-TAIL here.`;

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

      const recs: AuditRecommendations = isStructuredRecs(parsed.recommendations as AuditRecommendations)
        ? (parsed.recommendations as RecommendationCard[])
        : [];

      // --- Vision pass: actually LOOK at the website gallery photos ---
      // The text audit can only confirm photos exist; here we hand the real
      // gallery image URLs to a vision model to grade marketing quality, then
      // overwrite the website "Photos quality" cell + gallery finding with a
      // real verdict instead of "present, quality not assessed".
      const websiteFindings = parsed.websiteFindings || [];
      const consistency = parsed.consistency || [];
      if (siteImages.length >= 2) {
        try {
          setProgress("Assessing photo quality…");
          const photoPrompt = `These ${Math.min(siteImages.length, 8)} images are from the website gallery of ${current.name}, a ${current.propertyType || "multifamily apartment"} community. Grade them on MARKETING quality the way a leasing prospect would perceive them. Judge: professional vs amateur (lighting, composition, sharpness, resolution), staging/cleanliness, and coverage (do they show interiors/units, amenities, AND exterior/common areas, or just one or two things?). Return ONLY JSON, no prose: {"status":"green|amber|red","note":"one concise clause under 18 words citing what you actually see"}. Use green = genuinely professional, well-lit, good coverage; amber = adequate but some low-res/weak shots or thin coverage; red = clearly amateur/low-quality or almost no usable photos.`;
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
              const wf = websiteFindings.find((f) => /photo|gallery/i.test(f.label));
              if (wf) {
                wf.status = verdict.status;
                wf.note = verdict.note;
              }
              const row = consistency.find((c) => /photo/i.test(c.label));
              if (row) row.website = { status: verdict.status, note: verdict.note };
            }
          }
        } catch {
          /* keep the text-only "present, quality not assessed" fallback */
        }
      }

      // --- Vision pass on the Google profile photos (separate verdict) ---
      if (googlePhotos.length >= 2) {
        try {
          setProgress("Assessing Google profile photos…");
          const gPrompt = `These ${Math.min(googlePhotos.length, 8)} images are photos on the Google Business Profile of ${current.name} (a mix of owner and visitor photos a prospect sees when browsing the listing). Grade the overall visual quality a prospect would perceive: professional vs amateur, lighting/sharpness, and coverage (interiors, amenities, exterior). Return ONLY JSON, no prose: {"status":"green|amber|red","note":"one concise clause under 18 words citing what you see"}. green = mostly professional, good coverage; amber = mixed quality or thin coverage; red = mostly low-quality/amateur or almost none.`;
          const gResp = await callAI({ prompt: gPrompt, images: googlePhotos, maxTokens: 400 });
          const gText = (gResp.content || [])
            .filter((b: any) => b.type === "text")
            .map((b: any) => b.text)
            .join("");
          const gm = gText.match(/\{[\s\S]*\}/);
          if (gm) {
            const gj = JSON.parse(gm[0]) as { status?: string; note?: string };
            if (gj.status === "green" || gj.status === "amber" || gj.status === "red") {
              const row = consistency.find((c) => /photo/i.test(c.label));
              if (row) row.google = { status: gj.status, note: (gj.note || "").trim() || "Google photos assessed" };
            }
          }
        } catch {
          /* keep the text-only Google photos fallback */
        }
      }

      const result: MarketingAuditResult = {
        executiveSummary: parsed.executiveSummary || [],
        websiteFindings,
        criticalIssues: parsed.criticalIssues || [],
        consistency,
        recommendations: recs,
        summary: parsed.summary || [],
        sources: { website: current.website, apartments: current.apartmentsUrl, google: current.gbpUrl },
        timestamp: new Date().toISOString(),
      };

      current = { ...current, marketingAudit: result };
      onUpdateProperty(current);
      setResults(result);

      // --- Optimization checklist scoring (non-fatal) ---
      // One click also runs the LLM-visibility checklist and merges the
      // statuses/evidence/recommendations onto the property via the same
      // fields LLMTab reads/writes. If it throws, the consistency audit above
      // has already been saved and shown — the checklist just stays as-is.
      try {
        setProgress("Scoring the optimization checklist…");
        const checklist = await runChecklistAudit(current);
        const now = new Date().toISOString();
        current = {
          ...current,
          checklistStatuses: { ...(current.checklistStatuses ?? {}), ...checklist.statuses },
          checklistEvidence: { ...(current.checklistEvidence ?? {}), ...checklist.evidence },
          llmAuditRecommendations: checklist.recommendations,
          llmAuditTimestamp: now,
        };
        onUpdateProperty(current);
      } catch {
        /* checklist scoring is best-effort; the consistency audit still stands */
      }

      setStage("done");
      setProgress("");
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

  return (
    <div style={{ background: "white", borderRadius: 10, padding: 24, boxShadow: "0 1px 6px rgba(0,0,0,0.07)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 18, letterSpacing: "0.06em", textTransform: "uppercase", color: B.oxford }}>
          Marketing Audit
        </div>
        {results?.timestamp && (
          <span style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 11, color: "#888" }}>
            Last audited {new Date(results.timestamp).toLocaleString()}
          </span>
        )}
      </div>
      <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 12, color: "#aaa", marginBottom: 14 }}>
        Reviews the property website, Apartments.com listing, and Google Business Profile for leasing readiness and cross-platform consistency.
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
        title="Fetches the website + Apartments.com via Claude and the Google listing via SerpAPI, then writes a client-ready audit."
      >
        <span>✦</span>
        {running ? "Auditing…" : results ? "Re-run Marketing Audit" : "Run Marketing Audit"}
      </button>

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

      {/* Optimization checklist + visibility score — populated by the single
          Run Marketing Audit button above (alongside the consistency audit). */}
      <div style={{ marginTop: 24, marginBottom: 24 }}>
        <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 16, letterSpacing: "0.06em", textTransform: "uppercase", color: B.oxford, marginBottom: 10 }}>
          Optimization Checklist
        </div>
        <OptimizationChecklist property={property} onUpdateProperty={onUpdateProperty} />
      </div>

      {!results && !running && !error && (
        <div style={{ marginTop: 16, padding: "20px 16px", background: "#fafafa", borderRadius: 8, fontFamily: "'Josefin Sans',sans-serif", fontSize: 13, color: "#888", textAlign: "center", lineHeight: 1.6 }}>
          Runs ~60–90s. Reads the three platforms, flags leasing-conversion gaps, and writes an Executive Summary, color-coded findings, critical issues, an ILS/Google consistency check, and tiered recommendations.
        </div>
      )}

      {results && (
        <MarketingAuditResultView results={results} />
      )}
    </div>
  );
}

function MarketingAuditResultView({ results }: { results: MarketingAuditResult }) {
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
      {/* Executive Summary */}
      {results.executiveSummary.length > 0 && (
        <>
          <div style={sectionTitle}>Executive Summary</div>
          {results.executiveSummary.map((p, i) => (
            <p key={i} style={para}>{p}</p>
          ))}
        </>
      )}

      {/* Website Findings */}
      {results.websiteFindings.length > 0 && (
        <>
          <div style={sectionTitle}>Website Audit Findings</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {results.websiteFindings.map((f, i) => {
                const s = MK_STATUS[f.status] || MK_STATUS.amber;
                return (
                  <tr key={i}>
                    <td style={{ padding: "8px 10px", background: "#faf5ee", borderBottom: "1px solid #eef0f2", fontFamily: "'Josefin Sans',sans-serif", fontSize: 12.5, color: "#333", width: 190, fontWeight: 600 }}>
                      {f.label}
                    </td>
                    <td style={{ padding: "8px 10px", background: s.bg, borderBottom: "1px solid #eef0f2", width: 70 }}>
                      <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", color: s.fg }}>{s.label}</span>
                    </td>
                    <td style={{ padding: "8px 10px", borderBottom: "1px solid #eef0f2", fontFamily: "'Josefin Sans',sans-serif", fontSize: 12, color: "#333", lineHeight: 1.45 }}>
                      {f.note}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

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

      {/* Critical Issues — after the consistency data that surfaces them */}
      {results.criticalIssues.length > 0 && (
        <>
          <div style={sectionTitle}>Critical Issues Impacting Leasing</div>
          {results.criticalIssues.map((issue, i) => (
            <div key={i} style={{ marginBottom: 12, paddingLeft: 4 }}>
              <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 15, color: B.oxford }}>
                {i + 1}. {issue.title}
              </div>
              <div style={{ ...para, marginBottom: 4 }}>{issue.observed}</div>
              <div style={{ fontFamily: "'Josefin Sans',sans-serif", fontSize: 12.5, color: B.tangelo, lineHeight: 1.5 }}>
                <strong>Impact:</strong> {issue.impact}
              </div>
            </div>
          ))}
        </>
      )}

      {/* Recommendations — same card format as the SEO/LLM tabs */}
      {isStructuredRecs(results.recommendations) && (
        <>
          <div style={sectionTitle}>Recommendations to Drive More Leases</div>
          <RecommendationsBlock recs={results.recommendations} />
        </>
      )}
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
      let topics: { keyword: string; mentions: number }[] = [];
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
        if (pageNum === 0 && Array.isArray(resp?.topics)) {
          topics = resp.topics
            .filter((t: any) => t?.keyword)
            .map((t: any) => ({ keyword: t.keyword, mentions: t.mentions || 0 }));
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
      const topicLines = topics.length
        ? topics.map((t) => `- ${t.keyword} (${t.mentions} mentions)`).join("\n")
        : "(no keyword tags returned by Google)";

      const prompt = `You are a CRES reputation analyst writing a Resident Review Audit for ${current.name} at ${current.address}. Reporting period: ${periodDef.windowLabel}.

COMPUTED FACTS (authoritative — do NOT recompute or contradict these):
- Current Google rating: ${currentRating ?? "unknown"} (${totalReviews ?? "?"} total reviews)
- Prior rating: ${priorRating ?? "unknown"}${priorIsEstimated ? " (estimated)" : ""}
- New reviews in period: ${newReviews} (★ breakdown — 5:${star.s5} 4:${star.s4} 3:${star.s3} 2:${star.s2} 1:${star.s1})
- Owner response rate this period: ${responseRatePeriod ?? "n/a"}%

NEW REVIEWS IN PERIOD (with owner replies):
${reviewLines || "(no new reviews in this period)"}

GOOGLE KEYWORD TAGS (all-time, algorithmically generated by Google):
${topicLines}

REVIEWS WITH NO OWNER REPLY (write a suggested reply to post for each):
${gapLines}

REVIEWS WITH AN OWNER REPLY (flag ONLY the ones whose reply reads generic/templated):
${qualityLines}

${CRES_PLAYBOOK}

Return ONLY this JSON object, no prose:
{
  "narratives": {
    "breakdown": "1-2 sentences summarizing the period's new-review star mix and owner-response coverage.",
    "ratingOverview": "1-2 sentences on the current vs prior rating move and the lever to improve it.",
    "summary": "2 short sentences: the headline reputation takeaway + the single most important action."
  },
  "sentimentPeriod": [
    {"theme": "<theme from THIS period's review texts, name the staff member if a review names one>", "count": <# of period reviews on this theme>, "sentiment": "Positive|Negative|Mixed|Neutral", "recommendation": "1 sentence; if a 4/5-star review names a staff member call out the $25 incentive; if a 1/2-star, advise response review + internal escalation"}
  ],
  "sentimentHistorical": [
    {"theme": "<one of the Google keyword tags>", "count": <its mention count>, "sentiment": "Positive|Negative|Mixed|Neutral", "recommendation": "1 sentence tying it to a CRES P&P solicitation tactic"}
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
- sentimentHistorical: one row per Google keyword tag above (skip if none).
- responseGaps: one entry per [gN] review above, using its exact id. Empty array if there are none.
- responseQuality: include ONLY the [qN] reviews whose reply is genuinely generic/templated, using the exact id. Omit good replies. Empty array if none.
- recommendations: EXACTLY 5 cards, same format/rules as the other audits, grounded in the CRES playbook (text-first review link, QR touchpoints, $25/$200/$500 incentives, solicitation timing). Plain English, no em dashes, no fabricated program names.`;

      const data = await callAI({ prompt, maxTokens: 4000 });
      const text = (data.content || [])
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("\n");
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("The audit did not return a structured result. Try again.");
      const parsed = JSON.parse(match[0]) as any;

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
        sentimentHistorical: (parsed.sentimentHistorical || []) as ReviewSentimentRow[],
        sentimentPeriod: (parsed.sentimentPeriod || []) as ReviewSentimentRow[],
        reviews,
        responseGaps,
        responseQuality,
        recommendations: recs,
        narratives: {
          breakdown: parsed.narratives?.breakdown || "",
          ratingOverview: parsed.narratives?.ratingOverview || "",
          summary: parsed.narratives?.summary || "",
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

  const renderSentiment = (rows: ReviewSentimentRow[]) => (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr>
          <th style={th}>Theme</th>
          <th style={{ ...th, width: 70, textAlign: "center" }}>Mentions</th>
          <th style={{ ...th, width: 90 }}>Sentiment</th>
          <th style={th}>CRES Recommendation</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} style={{ background: i % 2 ? "#fafafa" : "white" }}>
            <td style={{ padding: "8px 10px", borderBottom: "1px solid #eef0f2", fontFamily: "'Josefin Sans',sans-serif", fontSize: 12.5, color: "#333", fontWeight: 600 }}>{row.theme}</td>
            <td style={{ padding: "8px 10px", borderBottom: "1px solid #eef0f2", textAlign: "center", fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, color: "#666" }}>{row.count}</td>
            <td style={{ padding: "8px 10px", borderBottom: "1px solid #eef0f2", fontFamily: "'Josefin Sans',sans-serif", fontSize: 12, fontWeight: 600, color: sentimentColor(row.sentiment) }}>{row.sentiment}</td>
            <td style={{ padding: "8px 10px", borderBottom: "1px solid #eef0f2", fontFamily: "'Josefin Sans',sans-serif", fontSize: 12, color: "#333", lineHeight: 1.45 }}>{row.recommendation}</td>
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

      {/* Sentiment 1: This Period (most actionable, shown first) */}
      {results.sentimentPeriod.length > 0 && (
        <>
          <div style={sectionTitle}>Sentiment Analysis 1 of 2: {results.periodLabel}</div>
          <p style={{ ...para, fontSize: 11.5, color: "#888" }}>Themes from the new reviews this period — what is driving feedback right now.</p>
          {renderSentiment(results.sentimentPeriod)}
        </>
      )}

      {/* Sentiment 2: Historical Profile */}
      {results.sentimentHistorical.length > 0 && (
        <>
          <div style={sectionTitle}>Sentiment Analysis 2 of 2: Historical Profile</div>
          <p style={{ ...para, fontSize: 11.5, color: "#888" }}>Google keyword tags across all {k.totalReviews ?? ""} reviews — the cumulative reputation prospects see.</p>
          {renderSentiment(results.sentimentHistorical)}
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
  { id: "seo", label: "SEO / LLM Rank Check" },
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
 * Merge two structured card sets (LLM audit first, then SEO audit) and drop
 * cards that repeat a topic already covered. LLM-first ordering means the
 * checklist-grounded card wins when both audits cover the same ground.
 */
function dedupeRecCards(cards: RecommendationCard[]): RecommendationCard[] {
  const seen = new Set<string>();
  const kept: RecommendationCard[] = [];
  for (const c of cards) {
    const topic = recTopicKey(c);
    if (topic) {
      if (seen.has(topic)) continue;
      seen.add(topic);
    }
    kept.push(c);
  }
  return kept;
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

  const sentTable = (rows: ReviewSentimentRow[]) => (
    <table style={{ marginBottom: 14 }}>
      <thead>
        <tr>
          <th style={th}>Theme</th>
          <th style={{ ...th, width: 60, textAlign: "center" }}>Mentions</th>
          <th style={{ ...th, width: 70 }}>Sentiment</th>
          <th style={th}>CRES Recommendation</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="pb-avoid">
            <td style={{ ...td, fontWeight: 600, color: PRINT_NAVY }}>{r.theme}</td>
            <td style={{ ...td, textAlign: "center" }}>{r.count}</td>
            <td style={{ ...td, fontWeight: 700, color: r.sentiment === "Positive" ? "#15803d" : r.sentiment === "Negative" ? "#b14a2a" : "#9a7200" }}>{r.sentiment}</td>
            <td style={td}>{r.recommendation}</td>
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
              <div style={{ marginBottom: 14 }}>
                {(["s5", "s4", "s3", "s2", "s1"] as const).map((key, idx) => {
                  const count = ra.starBreakdown[key];
                  const maxC = Math.max(1, ra.starBreakdown.s1, ra.starBreakdown.s2, ra.starBreakdown.s3, ra.starBreakdown.s4, ra.starBreakdown.s5);
                  const colors = ["#22c55e", "#86c34a", "#f59e0b", "#f08a3c", "#e0524f"];
                  return (
                    <div key={key} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                      <span style={{ width: 48, fontSize: 10, color: "#555" }}>{5 - idx} Star</span>
                      <div style={{ flex: 1, background: "#f0f2f4", height: 18, WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" }}>
                        <div style={{ width: `${(count / maxC) * 100}%`, background: colors[idx], height: "100%", minWidth: count > 0 ? 4 : 0, WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" }} />
                      </div>
                      <span style={{ width: 20, textAlign: "right", fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 13, color: PRINT_NAVY }}>{count}</span>
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

            {/* Sentiment 1: This Period */}
            {ra.sentimentPeriod.length > 0 && (
              <>
                <PrintSectionHeader>Sentiment Analysis 1 of 2: {ra.periodLabel}</PrintSectionHeader>
                <p style={{ ...bodyP, fontSize: 9.5, color: "#777" }}>Themes from the new reviews this period.</p>
                {sentTable(ra.sentimentPeriod)}
              </>
            )}

            {/* Sentiment 2: Historical */}
            {ra.sentimentHistorical.length > 0 && (
              <>
                <PrintSectionHeader>Sentiment Analysis 2 of 2: Historical Profile</PrintSectionHeader>
                <p style={{ ...bodyP, fontSize: 9.5, color: "#777" }}>Google keyword tags across all {ra.kpis.totalReviews ?? ""} reviews — the cumulative reputation prospects see.</p>
                {sentTable(ra.sentimentHistorical)}
              </>
            )}

            {/* Reviews awaiting a response */}
            {ra.responseGaps.length > 0 && (
              <>
                <PrintSectionHeader>Reviews Awaiting a Response</PrintSectionHeader>
                {ra.responseGaps.map((g, i) => (
                  <div key={i} className="pb-avoid" style={{ marginBottom: 8 }}>
                    <p style={{ ...bodyP, margin: "0 0 2px 0" }}>
                      <strong style={{ color: g.rating <= 2 ? "#b14a2a" : PRINT_NAVY }}>{g.reviewer} ({g.rating}★){g.escalate ? " — ESCALATE" : ""}:</strong>{" "}
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

            {/* Summary */}
            {ra.narratives.summary && (
              <>
                <div style={{ ...subHead, marginTop: 14 }}>Summary</div>
                <p style={bodyP}>{ra.narratives.summary}</p>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}

function PrintableReport({ property }: { property: Property }) {
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

  const earnedLLM = LLM_ITEMS.reduce(
    (s, i) => s + earnedPoints(i.pts, statusOf(property, i.id)),
    0
  );
  const totalLLM = LLM_ITEMS.reduce((s, i) => s + i.pts, 0);
  const scorePct = totalLLM > 0 ? Math.round((earnedLLM / totalLLM) * 100) : 0;

  // SEO scorecard counts only competitive (non-branded) queries, so ranking
  // #1 for the property's own name/street doesn't inflate the numbers.
  let seoMP = 0;
  let seoMPPartial = 0;
  let seoP1 = 0;
  let seoAvg: number | null = null;
  let seoCompTotal = 0;
  let seoBrandedCount = 0;
  if (seo) {
    const compRanks = seo.ranks.filter((r, i) => !isBrandedQuery(seo.queries[i], property));
    seoCompTotal = compRanks.length;
    seoBrandedCount = seo.ranks.length - compRanks.length;
    seoMP = compRanks.filter((r) => r.map_pack_rank && r.map_pack_rank <= 3).length;
    seoMPPartial = compRanks.filter(
      (r) => !(r.map_pack_rank && r.map_pack_rank <= 3) && r.expanded_map_pack_rank
    ).length;
    seoP1 = compRanks.filter((r) => r.organic_rank && r.organic_rank <= 10).length;
    const valid = compRanks.filter((r) => r.organic_rank).map((r) => r.organic_rank!);
    seoAvg = valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : null;
  }

  const cssName = property.name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const pageStyles = `
@media print {
  @page {
    size: letter;
    margin: 0.85in 0.65in 0.75in 0.65in;
    @top-left {
      content: "CRES  |  SEO / LLM Audit  |  ${cssName}  |  ${monthYear}";
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
      : "An optimization checklist audit has not yet been run for this property. Run it from the Marketing Audit tab to populate this section.";

  const seoSummaryLine = seo
    ? `Across ${seoCompTotal} competitive search ${seoCompTotal === 1 ? "query" : "queries"} representative of in-market renter intent${seoBrandedCount > 0 ? ` (plus ${seoBrandedCount} branded/navigational ${seoBrandedCount === 1 ? "query" : "queries"} excluded from these figures)` : ""}, the property appears in the Google Map Pack for ${seoMP} and on Page 1 organically for ${seoP1}${seoAvg ? ` (average organic rank #${seoAvg} among the competitive queries it ranks for)` : ", and does not rank organically for any of them"}.`
    : "A SEO Audit has not yet been run for this property. Run it from the SEO & Rank Check tab to populate this section.";

  const gapLine =
    missingHigh.length > 0 || partialHigh.length > 0
      ? `The most material gaps identified are: ${[...missingHigh, ...partialHigh]
          .slice(0, 3)
          .map((i) => i.label)
          .join("; ")}. Detailed findings and prioritized actions follow.`
      : "Detailed findings and prioritized actions follow.";

  // -- Recommendations: prefer the new structured cards; fall back to
  // legacy text + categorizer for older persisted audits.
  const structuredLlmRecs = isStructuredRecs(llmRecs) ? llmRecs : null;
  const structuredSeoRecs = isStructuredRecs(seo?.recommendations) ? seo!.recommendations as RecommendationCard[] : null;

  // Merge LLM-audit + SEO-audit cards, dropping topical duplicates (both
  // audits independently cover reviews / FAQ / schema / amenities, so the
  // raw concatenation showed each topic twice in the printed report).
  const allStructuredCards: RecommendationCard[] = dedupeRecCards([
    ...(structuredLlmRecs || []),
    ...(structuredSeoRecs || []),
  ]);

  // Group cards into priority bands for the printed report. The order
  // is intentional: foundational and quick wins come before strategic
  // multi-month work.
  const printBandOrder: { label: string; priorities: RecommendationPriority[] }[] = [
    { label: "Immediate Priority — This Week",      priorities: ["QUICK WIN"] },
    { label: "High Priority — Within 2 Weeks",      priorities: ["FOUNDATIONAL", "MAP PACK"] },
    { label: "Content & Strategy — Within 30 Days", priorities: ["CONTENT", "STRATEGIC"] },
    { label: "Long-Tail — Ongoing",                 priorities: ["LONG-TAIL"] },
  ];
  const printBands = printBandOrder
    .map((b) => ({
      label: b.label,
      cards: allStructuredCards.filter((c) => b.priorities.includes(c.priority)),
    }))
    .filter((b) => b.cards.length > 0);

  // Legacy fallback (only used when both audits are still in text form)
  const useLegacyTextRecs = !structuredLlmRecs && !structuredSeoRecs && (llmRecs || seo?.recommendations);
  const llmRecLines = useLegacyTextRecs ? splitRecommendations(typeof llmRecs === "string" ? llmRecs : "") : [];
  const seoRecLines = useLegacyTextRecs ? splitRecommendations(typeof seo?.recommendations === "string" ? seo!.recommendations : "") : [];
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
            Marketing Audit &amp; SEO / LLM Audit
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
        {mkt && (
          <section className="pb-before">
            <PrintSectionHeader>Marketing Audit</PrintSectionHeader>
            <p style={{ ...bodyP, fontSize: 10.5, color: "#555", marginBottom: 14 }}>
              Audited {new Date(mkt.timestamp).toLocaleString()}. Sources: website, Apartments.com, Google Business Profile.
            </p>

            {/* Executive Summary */}
            {mkt.executiveSummary.length > 0 && (
              <div className="pb-avoid" style={{ marginBottom: 16 }}>
                <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 12, letterSpacing: "0.06em", textTransform: "uppercase", color: PRINT_TEAL, marginBottom: 6 }}>
                  Executive Summary
                </div>
                {mkt.executiveSummary.map((p, i) => (
                  <p key={i} style={bodyP}>{p}</p>
                ))}
              </div>
            )}

            {/* Website Findings */}
            {mkt.websiteFindings.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 12, letterSpacing: "0.06em", textTransform: "uppercase", color: PRINT_TEAL, marginBottom: 6 }}>
                  Website Audit Findings
                </div>
                <table>
                  <tbody>
                    {mkt.websiteFindings.map((f, i) => {
                      const s = MK_STATUS[f.status] || MK_STATUS.amber;
                      return (
                        <tr key={i} className="pb-avoid">
                          <td style={{ ...findingsTd, background: "#faf5ee", fontWeight: 700, color: PRINT_NAVY, width: 150 }}>{f.label}</td>
                          <td style={{ ...findingsTd, background: s.bg, fontWeight: 700, color: s.fg, width: 60, textAlign: "center" }}>{s.label}</td>
                          <td style={findingsTd}>{f.note}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

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

            {/* Critical Issues — after the consistency data that surfaces them */}
            {mkt.criticalIssues.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 12, letterSpacing: "0.06em", textTransform: "uppercase", color: PRINT_TEAL, marginBottom: 6 }}>
                  Critical Issues Impacting Leasing
                </div>
                {mkt.criticalIssues.map((issue, i) => (
                  <div key={i} className="pb-avoid" style={{ marginBottom: 9 }}>
                    <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 12, color: PRINT_NAVY }}>
                      {i + 1}. {issue.title}
                    </div>
                    <p style={{ ...bodyP, margin: "2px 0 2px 0" }}>{issue.observed}</p>
                    <p style={{ ...bodyP, margin: 0, color: "#b14a2a" }}>
                      <strong style={{ color: "#b14a2a" }}>Impact:</strong> {issue.impact}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Marketing Recommendations — same card format as SEO/LLM, kept
                as its own section (not merged into the combined card block). */}
            {isStructuredRecs(mkt.recommendations) && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 12, letterSpacing: "0.06em", textTransform: "uppercase", color: PRINT_TEAL, marginBottom: 6 }}>
                  Recommendations to Drive More Leases
                </div>
                {mkt.recommendations.map((card, i) => (
                  <PrintRecCard key={i} card={card} />
                ))}
              </div>
            )}

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
                  [
                    "Map Pack Hits (top 3)",
                    `${seoMP}/${seoCompTotal}`,
                    seoMPPartial > 0 ? `+${seoMPPartial} more in pack` : "Competitive searches",
                  ],
                  ["Page 1 Organic", `${seoP1}/${seoCompTotal}`, "Competitive searches"],
                  [
                    "Avg Organic Rank",
                    seoAvg ? `#${seoAvg}` : "—",
                    seoAvg ? `Competitive queries that rank` : "Not ranking (competitive)",
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
                  <th style={{ ...findingsTh, width: 90, textAlign: "center" }}>GBP Map Pack</th>
                  <th style={{ ...findingsTh, width: 110, textAlign: "center" }}>Website in Organic</th>
                  <th style={findingsTh}>Who&rsquo;s Winning</th>
                </tr>
              </thead>
              <tbody>
                {seo.queries.map((q, i) => {
                  const r = seo.ranks[i];
                  const mapText = r.map_pack_rank
                    ? `#${r.map_pack_rank}`
                    : r.expanded_map_pack_rank
                    ? `#${r.expanded_map_pack_rank}`
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
                    : "Property not ranking";
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

        {/* ============ LLM VISIBILITY FINDINGS ============ */}
        {(llmTs || llmRecs) && (
          <section className="pb-before">
            <PrintSectionHeader>Optimization Checklist</PrintSectionHeader>
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
                {LLM_GROUPS.map((group) => {
                  const items = LLM_ITEMS.filter((it) => it.group === group.id);
                  const gEarned = items.reduce((s, it) => s + earnedPoints(it.pts, statusOf(property, it.id)), 0);
                  const gTotal = items.reduce((s, it) => s + it.pts, 0);
                  return (
                    <Fragment key={group.id}>
                      <tr className="pb-avoid">
                        <td
                          colSpan={3}
                          style={{
                            background: "#eef2f5",
                            padding: "5px 10px",
                            fontFamily: "'Barlow Condensed', sans-serif",
                            fontWeight: 700,
                            fontSize: 10.5,
                            letterSpacing: "0.08em",
                            textTransform: "uppercase",
                            color: PRINT_NAVY,
                            borderTop: "1px solid #d8dee4",
                          }}
                        >
                          {group.label}{" "}
                          <span style={{ color: "#888", fontWeight: 500 }}>· {gEarned}/{gTotal} pts</span>
                        </td>
                      </tr>
                      {items.map((item) => {
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
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}

        {/* ============ RECOMMENDATIONS ============ */}
        {(llmRecs || seo?.recommendations) && (
          <section className="pb-before">
            <PrintSectionHeader>Recommendations to Drive Visibility</PrintSectionHeader>

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Which report to print: the combined Marketing/SEO/LLM doc, or the
  // standalone Review Audit. Set just before window.print() so only the
  // targeted .printable-report is in the DOM.
  const [printTarget, setPrintTarget] = useState<"combined" | "review">("combined");
  const [printNonce, setPrintNonce] = useState(0);
  useEffect(() => {
    if (printNonce > 0) window.print();
  }, [printNonce]);
  const doPrint = (target: "combined" | "review") => {
    setPrintTarget(target);
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
            onClick={() => doPrint(tab === "reviews" ? "review" : "combined")}
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
            title={
              tab === "reviews"
                ? "Print the Resident Review Audit as its own PDF. Choose 'Save as PDF' as the destination."
                : "Open the browser print dialog. Choose 'Save as PDF' to download a PDF of the Marketing / SEO / LLM findings."
            }
          >
            <span>📄</span> {tab === "reviews" ? "Print Review Audit" : "Print Report"}
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

        {tab === "marketing" && <MarketingAuditTab property={property} onUpdateProperty={updateActive} />}
        {tab === "reviews" && <ReviewAuditTab property={property} onUpdateProperty={updateActive} />}
        {tab === "seo" && <SEOTab property={property} onUpdateProperty={updateActive} />}
      </div>

      {printTarget === "review" ? (
        <ReviewAuditReport property={property} />
      ) : (
        <PrintableReport property={property} />
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
