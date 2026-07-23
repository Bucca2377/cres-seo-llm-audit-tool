/**
 * Deterministic office-hours reconciliation for the marketing-audit consistency
 * table. Office hours were entirely model-judged and unreliable — the model
 * flip-flopped, flagged the CONSENSUS instead of the outlier, and even fabricated
 * per-page website differences (a property's hours live in one footer, identical
 * site-wide). This compares the STRUCTURED hours we already have per platform
 * (website parsed from the crawl footer, Google from SerpAPI, Apartments.com from
 * the dedicated reader), finds the real outlier by majority vote per day, and
 * returns the cell verdicts.
 *
 * Severity by source confidence: the property's own website and its Google profile
 * are high-confidence, so a genuine disagreement between them is a RED operational
 * conflict. A third-party ILS listing (Apartments.com) is reader-derived and can be
 * stale/misread, so when IT is the lone outlier we surface AMBER "verify & align",
 * not a hard issue — avoiding a scary false ISSUE from a listing we can't fully trust.
 *
 * Framework-free; covered by tests/detectors.test.ts.
 */

const DAY_ABBR = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Parse a single hours string into a comparable form. */
export function parseHoursToken(s: string): "closed" | "24h" | { open: number; close: number } | null {
  const t = (s || "").trim().toLowerCase();
  if (!t) return null;
  if (/^clos/.test(t)) return "closed";
  if (t.includes("24 hour") || t.includes("open 24")) return "24h";
  const parts = t.split(/[–—-]/).map((x) => x.trim());
  if (parts.length !== 2) return null;
  const toMin = (x: string): number | null => {
    const m = x.match(/(\d{1,2})(?::(\d{2}))?\s*(a|p)\.?m/i);
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
  if (open === close) return "closed";
  return { open, close };
}

function canonOf(s: string | undefined | null): string | null {
  const p = parseHoursToken(s || "");
  if (p === null) return null;
  if (p === "closed") return "closed";
  if (p === "24h") return "24h";
  return `${p.open}-${p.close}`;
}

function dayIndex(key: string): number {
  const k = (key || "").trim().toLowerCase().slice(0, 3);
  return ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].indexOf(k);
}

function minToDisp(m: number): string {
  const h24 = Math.floor(m / 60);
  const mm = m % 60;
  const ap = h24 >= 12 ? "PM" : "AM";
  let hh = h24 % 12;
  if (hh === 0) hh = 12;
  return mm ? `${hh}:${String(mm).padStart(2, "0")} ${ap}` : `${hh} ${ap}`;
}

function displayCanon(c: string | null): string {
  if (!c) return "";
  if (c === "closed") return "closed";
  if (c === "24h") return "24 hours";
  const [o, cl] = c.split("-").map(Number);
  return `${minToDisp(o)}–${minToDisp(cl)}`;
}

/** Clean a raw hours string for display in a note. */
function normalizeDisplay(v: string): string {
  const t = (v || "").trim();
  if (/^clos/i.test(t)) return "closed";
  if (/24\s*hour|open 24/i.test(t)) return "24 hours";
  return t.replace(/\s*[–—-]\s*/, "–").replace(/\s+/g, " ");
}

/**
 * Pull a day→hours map out of free text (e.g. a site footer). Only returns a day
 * when its label is immediately followed by a hours-like value, so day names in
 * prose ("move in by Monday") don't produce false entries. Keys are full lowercase
 * day names to match the Google / Apartments.com maps.
 */
export function parseWeekHours(text: string): Record<string, string> {
  const flat = (text || "").replace(/\s+/g, " ");
  const days: [string, string][] = [
    ["monday", "monday|mon"],
    ["tuesday", "tuesday|tues|tue"],
    ["wednesday", "wednesday|weds|wed"],
    ["thursday", "thursday|thurs|thur|thu"],
    ["friday", "friday|fri"],
    ["saturday", "saturday|sat"],
    ["sunday", "sunday|sun"],
  ];
  const VAL =
    "(closed|open 24 hours|24 hours|\\d{1,2}(?::\\d{2})?\\s*[ap]\\.?m\\.?\\s*[–—-]\\s*\\d{1,2}(?::\\d{2})?\\s*[ap]\\.?m\\.?)";
  const out: Record<string, string> = {};
  const dayTok = (s: string) => ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].indexOf((s || "").trim().toLowerCase().slice(0, 3));
  // Pass 1 — day RANGES first ("Mon-Fri 8:30 AM - 5:30 PM", "Monday - Thursday 9-5"),
  // the common Contact-page format. Expand the range across every day it spans.
  const dayAlt = days.map(([, alt]) => alt).join("|");
  const rangeRe = new RegExp(`\\b(${dayAlt})\\s*[-–—]\\s*(${dayAlt})\\b[^\\dA-Za-z]{0,8}${VAL}`, "gi");
  for (const m of flat.matchAll(rangeRe)) {
    const a = dayTok(m[1]);
    const b = dayTok(m[2]);
    const val = (m[3] || "").trim();
    if (a >= 0 && b >= 0 && a <= b && val) for (let i = a; i <= b; i++) if (!out[days[i][0]]) out[days[i][0]] = val;
  }
  // Pass 2 — individual days ("Sat 10 AM - 4 PM", "Sunday Closed"), filling any day a
  // range didn't already cover.
  for (const [full, alt] of days) {
    if (out[full]) continue;
    const re = new RegExp(`\\b(?:${alt})\\b[^\\dA-Za-z]{0,6}${VAL}`, "i");
    const m = flat.match(re);
    if (m && m[1]) out[full] = m[1].trim();
  }
  return out;
}

const FULL_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
function fullDayIndex(s: string): number {
  return FULL_DAYS.indexOf((s || "").trim().toLowerCase());
}
function to12h(hh: number, mm: number): string {
  const ap = hh >= 12 ? "PM" : "AM";
  let h = hh % 12;
  if (h === 0) h = 12;
  return mm ? `${h}:${String(mm).padStart(2, "0")} ${ap}` : `${h} ${ap}`;
}

/**
 * Parse Apartments.com office hours out of its RAW HTML (via Bright Data). The
 * visible listing collapses hours behind a "View All Hours" expander, so the model
 * reader only sees "open today" and wrongly infers the rest (e.g. Monday 9-5 when
 * the listing actually says Monday CLOSED). The full weekly schedule IS in the raw
 * HTML — the "daysHoursContainer" spans ("Monday, Closed" / "Tuesday - Friday, 9am -
 * 5pm" / ...), with a JSON-LD OpeningHoursSpecification fallback. Returns a full
 * 7-day map (unlisted days = Closed) or null when the block isn't present this fetch
 * (Apartments.com's raw HTML varies run-to-run) — null means "couldn't verify", so
 * the caller must NOT fall back to the model's unreliable guess.
 */
export function aptOfficeHoursFromRawHtml(html: string): Record<string, string> | null {
  if (!html) return null;
  const out: Record<string, string> = {};
  let found = false;

  // Primary: the visible "daysHoursContainer" spans (display text incl. closed days).
  for (const m of html.matchAll(/daysHoursContainer[^>]*>([\s\S]*?)<\/span>/gi)) {
    const txt = m[1].replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
    const mm = txt.match(/^([A-Za-z]+(?:\s*[-–—]\s*[A-Za-z]+)?)\s*[,:]\s*(.+)$/);
    if (!mm) continue;
    const hours = /clos/i.test(mm[2]) ? "Closed" : mm[2].trim();
    const range = mm[1].split(/\s*[-–—]\s*/);
    if (range.length === 2) {
      const a = fullDayIndex(range[0]);
      const b = fullDayIndex(range[1]);
      if (a >= 0 && b >= 0 && a <= b) for (let i = a; i <= b; i++) { out[FULL_DAYS[i]] = hours; found = true; }
    } else {
      const i = fullDayIndex(mm[1]);
      if (i >= 0) { out[FULL_DAYS[i]] = hours; found = true; }
    }
  }

  // Fallback: JSON-LD OpeningHoursSpecification (listed days = open; absent = closed).
  if (!found) {
    for (const s of html.matchAll(
      /"OpeningHoursSpecification"[\s\S]{0,300}?"dayOfWeek":\s*\[([^\]]*)\][\s\S]{0,160}?"opens":"(\d{1,2}):(\d{2})"[\s\S]{0,60}?"closes":"(\d{1,2}):(\d{2})"/gi
    )) {
      const days = [...s[1].matchAll(/"([A-Za-z]+)"/g)].map((x) => x[1]);
      const disp = `${to12h(+s[2], +s[3])} - ${to12h(+s[4], +s[5])}`;
      for (const d of days) {
        const i = fullDayIndex(d);
        if (i >= 0) { out[FULL_DAYS[i]] = disp; found = true; }
      }
    }
  }

  if (!found) return null;
  for (const d of FULL_DAYS) if (!out[d]) out[d] = "Closed"; // a day the listing omits = closed
  return out;
}

export interface HoursCellVerdict {
  status: "green" | "amber" | "red";
  note: string;
}

interface HoursPlatform {
  key: string;
  label: string;
  hours?: Record<string, string> | null;
  /** website + Google are high-confidence; an ILS listing is reader-derived. */
  authoritative?: boolean;
}

/** Compact a day→display map into "Mon–Fri 9 AM–5 PM · Sat 10 AM–4 PM · Sun closed". */
function formatWeek(rawDay: (string | null)[], canonDay: (string | null)[]): string {
  const groups: { start: number; end: number; disp: string }[] = [];
  let prevIdx = -2;
  let prevCanon: string | null = null;
  for (let d = 0; d < 7; d++) {
    if (canonDay[d] === null) continue;
    const disp = rawDay[d] || displayCanon(canonDay[d]);
    if (groups.length && prevCanon === canonDay[d] && prevIdx === d - 1) {
      groups[groups.length - 1].end = d;
    } else {
      groups.push({ start: d, end: d, disp });
    }
    prevIdx = d;
    prevCanon = canonDay[d];
  }
  return groups
    .map((g) => (g.start === g.end ? `${DAY_ABBR[g.start]} ${g.disp}` : `${DAY_ABBR[g.start]}–${DAY_ABBR[g.end]} ${g.disp}`))
    .join(" · ");
}

/**
 * Reconcile office hours across platforms. Returns a verdict for each platform that
 * has parseable hours; returns null when fewer than two do (nothing to compare, so
 * the caller keeps the model's row). Flags the OUTLIER (minority) per day.
 */
export function reconcileOfficeHours(platforms: HoursPlatform[]): Record<string, HoursCellVerdict> | null {
  interface P {
    key: string;
    label: string;
    authoritative: boolean;
    canonDay: (string | null)[];
    rawDay: (string | null)[];
  }
  const parsed: P[] = [];
  for (const pl of platforms) {
    const canonDay: (string | null)[] = new Array(7).fill(null);
    const rawDay: (string | null)[] = new Array(7).fill(null);
    for (const [k, v] of Object.entries(pl.hours || {})) {
      const idx = dayIndex(k);
      if (idx < 0) continue;
      const c = canonOf(v);
      if (c) {
        canonDay[idx] = c;
        rawDay[idx] = normalizeDisplay(v);
      }
    }
    if (canonDay.some((x) => x !== null)) {
      parsed.push({ key: pl.key, label: pl.label, authoritative: !!pl.authoritative, canonDay, rawDay });
    }
  }
  if (parsed.length < 2) return null;

  const outlierDays: Record<string, number[]> = {};
  const tieDays: Record<string, number[]> = {};
  const consensusByDay: (string | null)[] = new Array(7).fill(null);
  for (const p of parsed) {
    outlierDays[p.key] = [];
    tieDays[p.key] = [];
  }

  for (let d = 0; d < 7; d++) {
    const entries = parsed.filter((p) => p.canonDay[d] !== null);
    if (entries.length < 2) continue;
    const counts = new Map<string, number>();
    for (const p of entries) counts.set(p.canonDay[d]!, (counts.get(p.canonDay[d]!) || 0) + 1);
    let best: string | null = null;
    let bestN = 0;
    let tie = false;
    for (const [val, n] of counts) {
      if (n > bestN) {
        best = val;
        bestN = n;
        tie = false;
      } else if (n === bestN) {
        tie = true;
      }
    }
    if (tie) {
      if (counts.size > 1) for (const p of entries) tieDays[p.key].push(d);
      continue;
    }
    consensusByDay[d] = best;
    for (const p of entries) if (p.canonDay[d] !== best) outlierDays[p.key].push(d);
  }

  const result: Record<string, HoursCellVerdict> = {};
  for (const p of parsed) {
    const outs = outlierDays[p.key];
    const ties = tieDays[p.key];
    if (outs.length) {
      const others = parsed.filter((q) => q.key !== p.key);
      const mineTxt = outs.map((d) => `${DAY_ABBR[d]} ${p.rawDay[d]}`).join(", ");
      const consTxt = outs
        .map((d) => {
          const cp = others.find((q) => q.canonDay[d] === consensusByDay[d]);
          return `${DAY_ABBR[d]} ${cp ? cp.rawDay[d] : displayCanon(consensusByDay[d])}`;
        })
        .join(", ");
      const otherLabels = others
        .filter((q) => outs.some((d) => q.canonDay[d] === consensusByDay[d]))
        .map((q) => q.label);
      const others2 = otherLabels.length ? otherLabels.join(" and ") : "the other listings";
      // High-confidence source (website/Google) out of step = a real operational
      // conflict (RED). A reader-derived ILS listing as the outlier = verify (AMBER).
      const status: "red" | "amber" = p.authoritative ? "red" : "amber";
      result[p.key] =
        status === "red"
          ? { status, note: `Lists ${mineTxt}, but ${others2} show ${consTxt}. This conflict misleads prospects — align it.` }
          : { status, note: `Lists ${mineTxt}, while ${others2} show ${consTxt}. Verify the listing and align it.` };
    } else if (ties.length) {
      result[p.key] = {
        status: "amber",
        note: `Hours for ${ties.map((d) => DAY_ABBR[d]).join(", ")} differ between listings — verify which is correct and align them.`,
      };
    } else {
      result[p.key] = { status: "green", note: formatWeek(p.rawDay, p.canonDay) || "Hours consistent across listings." };
    }
  }
  return result;
}
