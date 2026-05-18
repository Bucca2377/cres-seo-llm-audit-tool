"use client";

import { useCallback, useEffect, useState } from "react";

export type ChecklistStatus = "missing" | "partial" | "complete";

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
  checklistStatuses?: Record<string, ChecklistStatus>;
  checklistEvidence?: Record<string, string>;
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
    addProperty,
    deleteProperty,
    clearRoster,
    resetActiveToDemo,
    exportProperty,
    importProperty,
    hydrated,
  };
}

export async function callAI(opts: {
  prompt: string;
  system?: string;
  maxTokens?: number;
  useWebSearch?: boolean;
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
  return r.json();
}
