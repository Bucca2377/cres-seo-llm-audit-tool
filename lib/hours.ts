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
  // Split on a dash OR the word "to" ("9:00 am to 5:00 pm" is as common as a dash).
  const parts = t.split(/\s+to\s+|[–—-]/).map((x) => x.trim());
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

/**
 * Map a day token to its index (0=Mon..6=Sun), tolerating the COMPACT
 * abbreviations real footers use — "M-F", "M-Th", "Sa", "Su" — not just full
 * names / 3-letter forms. Deliberately omits bare "t" and "s" (ambiguous between
 * Tue/Thu and Sat/Sun); those must be written "tu"/"th"/"sa"/"su".
 */
function abbrevDayIndex(s: string): number {
  const t = (s || "").trim().toLowerCase().replace(/[^a-z]/g, "");
  const MAP: Record<string, number> = {
    m: 0, mo: 0, mon: 0, monday: 0,
    tu: 1, tue: 1, tues: 1, tuesday: 1,
    w: 2, we: 2, wed: 2, weds: 2, wednesday: 2,
    th: 3, thu: 3, thur: 3, thurs: 3, thursday: 3,
    f: 4, fr: 4, fri: 4, friday: 4,
    sa: 5, sat: 5, saturday: 5,
    su: 6, sun: 6, sunday: 6,
  };
  if (t in MAP) return MAP[t];
  return ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].indexOf(t.slice(0, 3));
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
  // Longest form first in each alternation so "monday" wins over "mon"/"m". The
  // single-letter forms (m/w/f + tu/th/sa/su) let "M-F 9-5" footers parse; bare
  // "t"/"s" are intentionally excluded (ambiguous), and every match is gated on a
  // real hours VALUE right after, so a stray letter in prose can't produce a day.
  const days: [string, string][] = [
    ["monday", "monday|mon|mo|m"],
    ["tuesday", "tuesday|tues|tue|tu"],
    ["wednesday", "wednesday|weds|wed|we|w"],
    ["thursday", "thursday|thurs|thur|thu|th"],
    ["friday", "friday|fri|fr|f"],
    ["saturday", "saturday|sat|sa"],
    ["sunday", "sunday|sun|su"],
  ];
  // A time range separated by a dash OR the word "to" ("9:00 AM to 5:00 PM").
  const VAL =
    "(closed|open 24 hours|24 hours|\\d{1,2}(?::\\d{2})?\\s*[ap]\\.?m\\.?\\s*(?:[–—-]|to)\\s*\\d{1,2}(?::\\d{2})?\\s*[ap]\\.?m\\.?)";
  const out: Record<string, string> = {};
  const dayTok = (s: string) => abbrevDayIndex(s);
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

/**
 * Expand an Apartments.com day-spec into day indices. Handles a single day
 * ("Wednesday"), a dash range ("Tuesday - Friday"), an "&"/"and"/comma group
 * ("Monday & Tuesday", "Sat & Sun", "Monday, Wednesday & Friday"), and combinations.
 * Missing this is what made "Monday & Tuesday, 9am - 5pm" parse as BOTH days Closed.
 */
function expandDaySpec(spec: string): number[] {
  const s = (spec || "").trim();
  if (/\b(daily|every\s*day|7\s*days)\b/i.test(s)) return [0, 1, 2, 3, 4, 5, 6];
  const out = new Set<number>();
  // Segments split on & / , / "and" / "/". abbrevDayIndex accepts full OR abbreviated
  // day names ("Monday", "Mon", "Tue"), so grouped/abbreviated listings all parse.
  for (const seg of s.split(/\s*(?:&|,|\/|\band\b)\s*/i).map((x) => x.trim()).filter(Boolean)) {
    const range = seg.split(/\s*[-–—]\s*/);
    if (range.length === 2) {
      const a = abbrevDayIndex(range[0]);
      const b = abbrevDayIndex(range[1]);
      if (a >= 0 && b >= 0 && a <= b) for (let i = a; i <= b; i++) out.add(i);
    } else {
      const i = abbrevDayIndex(seg);
      if (i >= 0) out.add(i);
    }
  }
  return [...out];
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
  let sawUnparsedDays = false;
  for (const m of html.matchAll(/daysHoursContainer[^>]*>([\s\S]*?)<\/span>/gi)) {
    const txt = m[1]
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&") // decode so "Monday &amp; Tuesday" reads as an & group
      .replace(/\s+/g, " ")
      .trim();
    // "<days>, <hours>": days can be a single day, a dash range ("Tue - Fri"), an
    // "&"/"and"/"/"/comma group ("Monday & Tuesday"), or "Daily". Anchor the split on the
    // hours (start with a digit or Closed/Open/24) so a comma INSIDE the day list can't
    // split wrong — and so "Monday & Tuesday, 9am - 5pm" no longer reads as both Closed.
    const mm = txt.match(/^(.+?)\s*[,:]\s*((?:\d|clos|open\b|24).*)$/i);
    if (!mm) continue;
    const hours = /clos/i.test(mm[2]) ? "Closed" : mm[2].trim();
    const idxs = expandDaySpec(mm[1]);
    if (idxs.length === 0) {
      sawUnparsedDays = true; // real hours row, but a day-spec we don't recognize
      continue;
    }
    for (const idx of idxs) {
      out[FULL_DAYS[idx]] = hours;
      found = true;
    }
  }
  // FAIL-SAFE: if any real hours row had a day-spec we couldn't parse, the listing uses a
  // layout variant we don't recognize. Do NOT emit a partial map — the unparsed days would
  // default to a false "Closed" and manufacture a conflict (the exact bug this guards). Drop
  // the daysHoursContainer result and let JSON-LD try; if that also fails we return null.
  if (sawUnparsedDays) {
    found = false;
    for (const k of Object.keys(out)) delete out[k];
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

/**
 * JSON-LD `OpeningHoursSpecification` (schema.org) → day map. Split on the type
 * token so each spec's own dayOfWeek/opens/closes are read from the slice that
 * follows it (they always sit inside the same object). Handles the array form
 * (`"dayOfWeek":["Monday","Tuesday"]`) and the string form (`"dayOfWeek":"Monday"`),
 * pretty-printed or minified, and "HH:MM" or "HH:MM:SS" times. A spec whose opens
 * equals its closes (the common `00:00`→`00:00` "closed" encoding) → "Closed".
 * Days not listed = "Closed". Null when no spec yields a day.
 */
function officeHoursFromJsonLd(html: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  let found = false;
  for (const seg of html.split(/"OpeningHoursSpecification"/i).slice(1)) {
    const dayM = seg.match(/"dayOfWeek"\s*:\s*(\[[^\]]*\]|"[^"]*")/i);
    if (!dayM) continue;
    const days = [...dayM[1].matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1]);
    if (!days.length) continue;
    const opens = seg.match(/"opens"\s*:\s*"(\d{1,2}):(\d{2})(?::\d{2})?"/i);
    const closes = seg.match(/"closes"\s*:\s*"(\d{1,2}):(\d{2})(?::\d{2})?"/i);
    let disp = "Closed";
    if (opens && closes) {
      const o = +opens[1] * 60 + +opens[2];
      const c = +closes[1] * 60 + +closes[2];
      disp = o === c ? "Closed" : `${to12h(+opens[1], +opens[2])} - ${to12h(+closes[1], +closes[2])}`;
    }
    for (const d of days) {
      const i = fullDayIndex(d);
      if (i >= 0) { out[FULL_DAYS[i]] = disp; found = true; }
    }
  }
  if (!found) return null;
  for (const d of FULL_DAYS) if (!out[d]) out[d] = "Closed"; // schema omits a day => closed
  return out;
}

/**
 * DoubleMap-style widget markup (Cambridge / liveatcf):
 *   <dt day="0">Monday</dt> <dd> <time>9:00 am</time> - <time>6:00 pm</time> </dd>
 * For each <dt>DayName</dt> immediately followed by its <dd>, pull the <time>
 * values (two → "9:00 am - 6:00 pm", one → that single value) or read "Closed"
 * when the <dd> text says so. Non-day <dt>s (other <dl> lists on the page) are
 * skipped via fullDayIndex. Null when no day row is found.
 */
function officeHoursFromDoubleMap(html: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  let found = false;
  const strip = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
  for (const m of html.matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi)) {
    const i = fullDayIndex(strip(m[1]));
    if (i < 0) continue;
    if (/closed/i.test(strip(m[2]))) {
      out[FULL_DAYS[i]] = "Closed";
      found = true;
      continue;
    }
    const times = [...m[2].matchAll(/<time\b[^>]*>([\s\S]*?)<\/time>/gi)].map((t) => strip(t[1])).filter(Boolean);
    if (times.length >= 2) { out[FULL_DAYS[i]] = `${times[0]} - ${times[1]}`; found = true; }
    else if (times.length === 1) { out[FULL_DAYS[i]] = times[0]; found = true; }
  }
  return found ? out : null;
}

/**
 * Read office hours from a website's RAW rendered HTML (the DOM), not the
 * crawler's visible text. The visible-text read misses hours that live only in a
 * footer <dl> widget, a JSON-LD block, or late-hydrated markup. Tries three real
 * sources IN ORDER — schema.org JSON-LD, a DoubleMap-style <dt>/<dd><time> widget,
 * then a plain-text footer fallback via parseWeekHours — and the FIRST that yields
 * at least one day wins. Returns a day→hours map (keys "monday".."sunday", values
 * like "9 AM - 6 PM" or "Closed") or null when none yield a day.
 */
export function officeHoursFromHtml(html: string): Record<string, string> | null {
  if (!html) return null;

  const jsonLd = officeHoursFromJsonLd(html);
  if (jsonLd) return jsonLd;

  const doubleMap = officeHoursFromDoubleMap(html);
  if (doubleMap) return doubleMap;

  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
  const parsed = parseWeekHours(text);
  return Object.keys(parsed).length ? parsed : null;
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
      // Two listings disagree with no majority to pick a winner. SHOW each side's
      // ACTUAL hours for the differing days (not just "they differ") so the user can
      // resolve it at a glance instead of opening both listings to compare.
      const others = parsed.filter((q) => q.key !== p.key);
      const mineTxt = ties.map((d) => `${DAY_ABBR[d]} ${p.rawDay[d] ?? displayCanon(p.canonDay[d])}`).join(", ");
      const otherTxt = others
        .map((q) => {
          const vals = ties
            .filter((d) => q.canonDay[d] !== null)
            .map((d) => `${DAY_ABBR[d]} ${q.rawDay[d]}`)
            .join(", ");
          return vals ? `${q.label} shows ${vals}` : "";
        })
        .filter(Boolean)
        .join("; ");
      // A genuine both-listed hours conflict with no majority to name a "winner"
      // (e.g. Google says Sat closed, the website says Sat 10–5). When THIS
      // platform is an authoritative, prospect-facing source (website/Google),
      // the mismatch is a CONFIRMED operational conflict that misleads prospects
      // -> RED, exactly like the outlier case. Not knowing which side is right
      // doesn't lessen the conflict. A lower-confidence ILS read stays AMBER.
      const status: "red" | "amber" = p.authoritative ? "red" : "amber";
      const tail =
        status === "red"
          ? "This conflict misleads prospects — decide the correct hours and align them."
          : "Verify which is correct and align them.";
      result[p.key] = {
        status,
        note: otherTxt
          ? `Lists ${mineTxt}, while ${otherTxt}. ${tail}`
          : `Hours for ${ties.map((d) => DAY_ABBR[d]).join(", ")} differ between listings. ${tail}`,
      };
    } else {
      result[p.key] = { status: "green", note: formatWeek(p.rawDay, p.canonDay) || "Hours consistent across listings." };
    }
  }
  return result;
}
