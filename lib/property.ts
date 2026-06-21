"use client";

import { useCallback, useEffect, useState } from "react";

export type ChecklistStatus = "missing" | "partial" | "complete";

/**
 * Six standardized priority tags for audit recommendations. Used as the
 * colored chip on each card and to group recommendations when rendered.
 *
 * QUICK WIN     — low effort, immediate / near-term impact
 * FOUNDATIONAL  — hygiene that everything else depends on (must-have)
 * MAP PACK      — local 3-pack / GBP-driven visibility (SEO-specific)
 * STRATEGIC     — multi-month positioning work, higher effort
 * CONTENT       — requires writing or producing content
 * LONG-TAIL     — niche / low-competition queries
 */
export type RecommendationPriority =
  | "QUICK WIN"
  | "FOUNDATIONAL"
  | "MAP PACK"
  | "STRATEGIC"
  | "CONTENT"
  | "LONG-TAIL";

/**
 * Structured audit recommendation — the format produced by both the LLM
 * Visibility audit and the SEO audit. Renders as a scannable card with a
 * colored priority chip, an imperative title, and five labeled fields.
 */
export interface RecommendationCard {
  priority: RecommendationPriority;
  title: string;   // Imperative, ≤ 12 words. e.g. "Add JSON-LD schema to homepage"
  what: string;    // The specific concrete action (1-3 sentences)
  why: string;     // Rationale with metrics from the audit (1-2 sentences)
  effort: string;  // "~30 min · web developer" / "~4 hrs · marketing manager"
  success: string; // Measurable outcome / how to know it worked
  source: string;  // Which audit finding triggered this (e.g. "LLM Audit item #2 (0/15 → 15/15)")
}

/** Legacy string format (numbered list) or new structured array. */
export type AuditRecommendations = string | RecommendationCard[];

/**
 * Type guard — true when recommendations are in the new structured format,
 * false when they are the legacy plain-text format. Used by all renderers
 * to switch between card layout and the old numbered-list fallback.
 */
export function isStructuredRecs(r: AuditRecommendations | undefined | null): r is RecommendationCard[] {
  return Array.isArray(r) && r.length > 0 && typeof (r[0] as RecommendationCard).title === "string";
}

export interface Property {
  id: string;
  name: string;
  address: string;
  units: number;
  priceMin: number;
  priceMax: number;
  yearBuilt: number;
  amenities: string[];
  nearBy: string;
  description: string;
  managerName: string;
  /**
   * What kind of community this is in plain words — e.g. "Townhomes",
   * "Apartments", "Townhomes & apartments", "Garden-style apartments".
   * Google often categorizes everything as "Apartment complex", so this is
   * the user's source of truth. Feeds query generation, the audit, and
   * content so searches/recommendations match the real product.
   */
  propertyType?: string;
  /**
   * Bedroom / unit types offered, in plain words — e.g. "1, 2 & 3 bedroom"
   * or "Studio–3BR". Used to generate bedroom-specific search queries
   * (e.g. "3 bedroom townhomes for rent in Salisbury").
   */
  bedroomTypes?: string;
  /**
   * The property's primary website (e.g. "villageatsnowfield.com" or
   * "https://www.villageatsnowfield.com"). When set, rank checks and
   * GBP detection match by domain — far more reliable than fuzzy name
   * matching. Highly recommended for accurate audits.
   */
  website?: string;
  /**
   * The property's Google Business Profile / Google Maps URL. Pasted
   * from the address bar after searching on Google Maps. Locks GBP
   * identity to avoid name-matching ambiguity (e.g. "Village Pizzeria"
   * vs. "Village at Snowfield").
   */
  gbpUrl?: string;
  /**
   * The property's Apartments.com listing URL. Used by the Marketing Audit to
   * check the ILS listing (active vs shell, hours, photos, tour/apply tools).
   */
  apartmentsUrl?: string;
  /**
   * "Must-check" SEO search queries the user has pinned for this property.
   * These are always included in every SEO audit run alongside the freshly
   * auto-generated queries, so a query the user cares about (e.g. "3 bed
   * apartments in Salisbury") never disappears between runs.
   */
  pinnedQueries?: string[];
  checklistStatuses?: Record<string, ChecklistStatus>;
  checklistEvidence?: Record<string, string>;
  llmAuditRecommendations?: AuditRecommendations;
  llmAuditTimestamp?: string;
  seoAudit?: {
    queries: string[];
    ranks: Array<{
      map_pack_appeared: boolean;
      map_pack_rank: number | null;
      expanded_map_pack_rank?: number | null;
      top_map_pack: string[];
      organic_rank: number | null;
      organic_page: number | null;
      top_organic: Array<{ name: string; domain: string }>;
      diagnosis: string;
    }>;
    recommendations: AuditRecommendations;
    timestamp: string;
  };
  marketingAudit?: MarketingAuditResult;
}

/**
 * green = found & functional, amber = present/unverified/requires verification,
 * red = absent/broken, na = not applicable to this platform (e.g. a Google
 * Business Profile does not carry concessions, preferred employers, or an
 * online application — those rows should read N/A, not a warning).
 */
export type MarketingStatus = "green" | "amber" | "red" | "na";

export interface MarketingFinding {
  label: string;
  status: MarketingStatus;
  note: string;
}

export interface MarketingSourceCell {
  status: MarketingStatus;
  note: string;
}

export interface MarketingConsistencyRow {
  label: string;
  apartments: MarketingSourceCell;
  google: MarketingSourceCell;
  website: MarketingSourceCell;
}

export interface MarketingCriticalIssue {
  title: string;
  observed: string;
  impact: string;
}

/**
 * Structured result of the Marketing Audit (website + Apartments.com + Google
 * consistency). Persisted on the property so the tab and the printable report
 * can read it after a run.
 */
export interface MarketingAuditResult {
  executiveSummary: string[];
  websiteFindings: MarketingFinding[];
  criticalIssues: MarketingCriticalIssue[];
  consistency: MarketingConsistencyRow[];
  /** Same structured-card format as the SEO/LLM audits, for visual consistency. */
  recommendations: AuditRecommendations;
  summary: string[];
  /** Echoes the URLs audited, for the report header. */
  sources: { website?: string; apartments?: string; google?: string };
  timestamp: string;
}

const ROSTER_KEY = "cres-roster";
const LEGACY_PROPERTY_KEY = "cres-property";

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const meridianDefaults: Omit<Property, "id"> = {
  name: "The Meridian",
  address: "4821 Harbor View Dr, Miami FL 33131",
  units: 120,
  priceMin: 2400,
  priceMax: 3400,
  yearBuilt: 2018,
  amenities: [
    "Rooftop pool",
    "Fitness center",
    "Concierge",
    "EV charging",
    "Pet-friendly (2 pet max, 50lb limit)",
    "In-unit W/D",
    "Private balconies",
    "Co-working lounge",
    "Gated parking",
    "Package lockers",
  ],
  nearBy:
    "0.4mi to Brickell City Centre, 0.8mi to Brickell Metro, walkable to Whole Foods",
  description:
    "Modern luxury multifamily community in the heart of Miami's Brickell neighborhood. Studios to 3-bedrooms, open floor plans, floor-to-ceiling windows, city and bay views.",
  managerName: "Sarah Chen",
};

export const blankProperty: Omit<Property, "id"> = {
  name: "New Property",
  address: "",
  units: 0,
  priceMin: 0,
  priceMax: 0,
  yearBuilt: new Date().getFullYear(),
  amenities: [],
  nearBy: "",
  description: "",
  managerName: "",
  website: "",
  gbpUrl: "",
};

export function makeDefaultProperty(): Property {
  return { id: newId(), ...meridianDefaults };
}

export const defaultProperty: Property = { id: "demo-meridian", ...meridianDefaults };

interface Roster {
  properties: Property[];
  activeId: string;
}

function makeInitialRoster(): Roster {
  const p = makeDefaultProperty();
  return { properties: [p], activeId: p.id };
}

function loadRoster(): Roster {
  try {
    const raw = localStorage.getItem(ROSTER_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Roster;
      if (parsed && Array.isArray(parsed.properties) && parsed.properties.length > 0) {
        const hasActive = parsed.properties.some((p) => p.id === parsed.activeId);
        return {
          properties: parsed.properties,
          activeId: hasActive ? parsed.activeId : parsed.properties[0].id,
        };
      }
    }
    const legacy = localStorage.getItem(LEGACY_PROPERTY_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy) as Partial<Property>;
      const migrated: Property = { id: newId(), ...meridianDefaults, ...parsed };
      const roster: Roster = { properties: [migrated], activeId: migrated.id };
      localStorage.setItem(ROSTER_KEY, JSON.stringify(roster));
      localStorage.removeItem(LEGACY_PROPERTY_KEY);
      return roster;
    }
  } catch {
    /* ignore corrupted storage */
  }
  return makeInitialRoster();
}

function saveRoster(r: Roster) {
  try {
    localStorage.setItem(ROSTER_KEY, JSON.stringify(r));
  } catch {
    /* ignore quota errors */
  }
}

export function buildSystemPrompt(p: Property): string {
  const amenities = p.amenities.length ? p.amenities.join(", ") : "(none specified)";
  return `You are a marketing AI assistant for CRES Property Management. The property is ${p.name}, a ${p.units}-unit luxury multifamily at ${p.address}. Units: studios to 3BR, $${p.priceMin.toLocaleString()}–$${p.priceMax.toLocaleString()}/mo. Amenities: ${amenities}. Location: ${p.nearBy}. Built ${p.yearBuilt}. Manager: ${p.managerName}. Be professional, specific, and compelling. No em dashes or hyphens as punctuation in flowing text.`;
}

export function buildPropContext(p: Property): string {
  const amenities = p.amenities.slice(0, 8).join(", ");
  return `The property is ${p.name}, ${p.address}. ${p.units}-unit luxury multifamily. $${p.priceMin.toLocaleString()}–$${p.priceMax.toLocaleString()}/mo. Amenities: ${amenities}. Location: ${p.nearBy}.`;
}

export function useRoster() {
  const initial = makeInitialRoster();
  const [roster, setRoster] = useState<Roster>(initial);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setRoster(loadRoster());
    setHydrated(true);
  }, []);

  const persist = useCallback((next: Roster) => {
    setRoster(next);
    saveRoster(next);
  }, []);

  const activeProperty =
    roster.properties.find((p) => p.id === roster.activeId) || roster.properties[0];

  const setActive = useCallback(
    (id: string) => {
      if (!roster.properties.some((p) => p.id === id)) return;
      persist({ ...roster, activeId: id });
    },
    [persist, roster]
  );

  const updateActive = useCallback(
    (p: Property) => {
      const updated = { ...p, id: activeProperty.id };
      persist({
        ...roster,
        properties: roster.properties.map((x) => (x.id === activeProperty.id ? updated : x)),
      });
    },
    [persist, roster, activeProperty.id]
  );

  /**
   * Apply a partial update to a property by id. Used by batch enrichment
   * and audit-time auto-capture. Patches are shallow-merged — existing
   * fields not present in the patch are preserved.
   */
  const updatePropertyById = useCallback(
    (id: string, patch: Partial<Property>) => {
      const target = roster.properties.find((p) => p.id === id);
      if (!target) return;
      const merged: Property = { ...target, ...patch, id: target.id };
      persist({
        ...roster,
        properties: roster.properties.map((x) => (x.id === id ? merged : x)),
      });
    },
    [persist, roster]
  );

  const addProperty = useCallback(
    (seed?: Partial<Omit<Property, "id">>) => {
      const created: Property = { id: newId(), ...blankProperty, ...seed };
      const next: Roster = {
        properties: [...roster.properties, created],
        activeId: created.id,
      };
      persist(next);
      return created;
    },
    [persist, roster]
  );

  const deleteProperty = useCallback(
    (id: string) => {
      if (roster.properties.length <= 1) return;
      const remaining = roster.properties.filter((p) => p.id !== id);
      const nextActive = roster.activeId === id ? remaining[0].id : roster.activeId;
      persist({ properties: remaining, activeId: nextActive });
    },
    [persist, roster]
  );

  const clearRoster = useCallback(() => {
    const fresh = makeInitialRoster();
    persist(fresh);
  }, [persist]);

  const resetActiveToDemo = useCallback(() => {
    const reset: Property = { id: activeProperty.id, ...meridianDefaults };
    persist({
      ...roster,
      properties: roster.properties.map((x) => (x.id === activeProperty.id ? reset : x)),
    });
  }, [persist, roster, activeProperty.id]);

  const exportProperty = useCallback((id?: string): string => {
    const target = roster.properties.find((p) => p.id === (id ?? activeProperty.id));
    if (!target) return "{}";
    const { id: _omit, ...rest } = target;
    return JSON.stringify(rest, null, 2);
  }, [roster, activeProperty.id]);

  const importProperty = useCallback(
    (
      json: string,
      opts?: { mode?: "append" | "merge" | "replace" }
    ): { added: number; updated: number; removed: number; first: Property } => {
      const parsed = JSON.parse(json);
      const items: Partial<Property>[] = Array.isArray(parsed) ? parsed : [parsed];
      if (items.length === 0) throw new Error("File contains no properties");

      items.forEach((item, i) => {
        if (!item || typeof item !== "object") {
          throw new Error(`Entry ${i + 1} is not an object`);
        }
        if (typeof item.name !== "string" || !item.name.trim()) {
          throw new Error(`Entry ${i + 1} is missing a "name" field`);
        }
      });

      const mode = opts?.mode ?? "append";

      // REPLACE mode: discard current roster, build fresh from file
      if (mode === "replace") {
        const created: Property[] = items.map(
          (item) =>
            ({
              ...blankProperty,
              ...item,
              amenities: Array.isArray(item.amenities) ? item.amenities : [],
              id: newId(),
            }) as Property
        );
        const removed = roster.properties.length;
        persist({ properties: created, activeId: created[0].id });
        return { added: created.length, updated: 0, removed, first: created[0] };
      }

      // APPEND / MERGE
      const norm = (s: string) => s.trim().toLowerCase();
      const nextProperties = [...roster.properties];
      const indexByName = new Map<string, number>();
      nextProperties.forEach((p, i) => indexByName.set(norm(p.name), i));

      let added = 0;
      let updated = 0;
      let firstId: string | null = null;

      for (const item of items) {
        const key = norm(item.name as string);
        const existingIdx = mode === "merge" ? indexByName.get(key) : undefined;

        if (existingIdx !== undefined) {
          const keepId = nextProperties[existingIdx].id;
          const replaced: Property = {
            ...blankProperty,
            ...item,
            amenities: Array.isArray(item.amenities) ? item.amenities : [],
            id: keepId,
          } as Property;
          nextProperties[existingIdx] = replaced;
          if (!firstId) firstId = keepId;
          updated++;
        } else {
          const created: Property = {
            ...blankProperty,
            ...item,
            amenities: Array.isArray(item.amenities) ? item.amenities : [],
            id: newId(),
          } as Property;
          nextProperties.push(created);
          indexByName.set(key, nextProperties.length - 1);
          if (!firstId) firstId = created.id;
          added++;
        }
      }

      persist({ properties: nextProperties, activeId: firstId || roster.activeId });
      const first =
        nextProperties.find((p) => p.id === firstId) || nextProperties[0];
      return { added, updated, removed: 0, first };
    },
    [persist, roster]
  );

  return {
    properties: roster.properties,
    property: activeProperty,
    setActive,
    updateActive,
    updatePropertyById,
    addProperty,
    deleteProperty,
    clearRoster,
    resetActiveToDemo,
    exportProperty,
    importProperty,
    hydrated,
  };
}

function emitSpend(detail: {
  source: "anthropic" | "serpapi";
  cost: number;
  searches?: number;
  webSearches?: number;
  inputTokens?: number;
  outputTokens?: number;
}) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("cres-spend", { detail }));
  }
}

export async function callSerp(opts: {
  query?: string;
  location?: string;
  engine?: "google" | "google_maps" | "google_maps_reviews";
  data_id?: string;
}) {
  const r = await fetch("/api/serp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: "SerpAPI request failed" }));
    throw new Error(err.error || `SerpAPI failed (${r.status})`);
  }
  const data = await r.json();
  if (data?._meta) {
    emitSpend({
      source: "serpapi",
      cost: data._meta.cost || 0,
      searches: data._meta.searches || 1,
    });
  }
  return data;
}

export async function callAI(opts: {
  prompt: string;
  system?: string;
  maxTokens?: number;
  useWebSearch?: boolean;
  webFetch?: boolean;
}) {
  const r = await fetch("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || `Request failed (${r.status})`);
  }
  const data = await r.json();
  if (data?._meta) {
    emitSpend({
      source: "anthropic",
      cost: data._meta.cost || 0,
      inputTokens: data._meta.input_tokens || 0,
      outputTokens: data._meta.output_tokens || 0,
      webSearches: data._meta.web_searches || 0,
    });
  }
  return data;
}

interface SpendState {
  anthropicCost: number;
  serpCost: number;
  anthropicCalls: number;
  serpCalls: number;
  inputTokens: number;
  outputTokens: number;
  webSearches: number;
  totalSearches: number;
}

const EMPTY_SPEND: SpendState = {
  anthropicCost: 0,
  serpCost: 0,
  anthropicCalls: 0,
  serpCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
  webSearches: 0,
  totalSearches: 0,
};

const SPEND_KEY = "cres-session-spend";

export function useSessionSpend() {
  const [spend, setSpend] = useState<SpendState>(EMPTY_SPEND);

  useEffect(() => {
    // Restore from sessionStorage on mount
    try {
      const raw = sessionStorage.getItem(SPEND_KEY);
      if (raw) setSpend(JSON.parse(raw));
    } catch {
      /* ignore */
    }

    const handler = (e: Event) => {
      const ev = e as CustomEvent;
      const d = ev.detail || {};
      setSpend((prev) => {
        const next: SpendState =
          d.source === "anthropic"
            ? {
                ...prev,
                anthropicCost: prev.anthropicCost + (d.cost || 0),
                anthropicCalls: prev.anthropicCalls + 1,
                inputTokens: prev.inputTokens + (d.inputTokens || 0),
                outputTokens: prev.outputTokens + (d.outputTokens || 0),
                webSearches: prev.webSearches + (d.webSearches || 0),
              }
            : {
                ...prev,
                serpCost: prev.serpCost + (d.cost || 0),
                serpCalls: prev.serpCalls + 1,
                totalSearches: prev.totalSearches + (d.searches || 1),
              };
        try {
          sessionStorage.setItem(SPEND_KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    };
    window.addEventListener("cres-spend", handler);
    return () => window.removeEventListener("cres-spend", handler);
  }, []);

  const reset = useCallback(() => {
    setSpend(EMPTY_SPEND);
    try {
      sessionStorage.removeItem(SPEND_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  return { spend, reset };
}
