import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as XLSX from "xlsx";

const MASTER_PATH =
  "C:\\Users\\BrendanVanDeventer\\cre-strategies.com\\CRES - Documents\\CRES - Company Wide Access\\CRES MASTER WEEKLY & FINANCIAL SCHEDULES\\Weekly & Financial VA & Analyst Input Sheets\\Properties Master.xlsx";

const HD_DIR =
  "C:\\Users\\BrendanVanDeventer\\cre-strategies.com\\CRES - Documents\\CRES - Company Wide Access\\Market Surveys\\Data\\5.10.26";

const OUT = "C:\\Users\\BrendanVanDeventer\\Downloads\\cres-roster-clean.json";

/* ---------- name normalization & matching ---------- */

const STOPWORDS = new Set(["the", "a", "an", "at", "on", "of", "and"]);
const SUFFIX_RE = /\s*\((affordable|market|market\s*comps|internal)\)\s*$/i;

function normalize(s) {
  return s
    .toString()
    .toLowerCase()
    .replace(SUFFIX_RE, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => !STOPWORDS.has(t))
    .join(" ");
}

function tokens(s) {
  return normalize(s).split(" ").filter(Boolean);
}

function tokensSubset(small, big) {
  const setBig = new Set(big);
  return small.every((t) => setBig.has(t));
}

/* ---------- read master ---------- */

const masterWb = XLSX.read(readFileSync(MASTER_PATH), { type: "buffer" });
const masterRows = XLSX.utils.sheet_to_json(masterWb.Sheets["Master"], {
  defval: null,
  blankrows: false,
});

const masterEntries = [];
for (const r of masterRows) {
  const name = (r["Property"] || r["Alias"] || "").toString().trim();
  if (!name) continue;
  const street = (r["Street Address"] || "").toString().trim();
  const cityZip = (r["City, State, ZIP"] || "").toString().trim();
  const address = [street, cityZip].filter(Boolean).join(", ");
  const units =
    typeof r["Number of Units"] === "number"
      ? r["Number of Units"]
      : parseInt(r["Number of Units"], 10) || 0;
  const client = (r["Client"] || "").toString().trim();
  const cresMgr = (r["CRES Portfolio Manager"] || "").toString().trim();
  const propMgr = (r["Manager"] || "").toString().trim();
  masterEntries.push({
    name,
    address,
    units,
    priceMin: 0,
    priceMax: 0,
    yearBuilt: 0,
    amenities: [],
    nearBy: "",
    description: [
      client && `Client: ${client}`,
      cresMgr && `CRES PM: ${cresMgr}`,
      units && `${units} units`,
    ]
      .filter(Boolean)
      .join(" · "),
    managerName: propMgr || cresMgr || "",
  });
}

/* ---------- read HD ---------- */

function rowsOf(ws) {
  return ws
    ? XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: false })
    : [];
}

function extractAmenities(ws) {
  const rows = rowsOf(ws);
  const out = [];
  for (const r of rows) {
    const label = r[1];
    const subject = r[2];
    if (
      typeof label === "string" &&
      label.trim() &&
      String(subject).trim().toUpperCase() === "X"
    ) {
      out.push(label.trim());
    }
  }
  return out;
}

function extractUnitMix(ws, subjectName) {
  const rows = rowsOf(ws);
  let units = 0;
  const rents = [];
  const target = subjectName.trim().toLowerCase();
  for (const r of rows) {
    const propName = (r[0] || "").toString().trim().toLowerCase();
    if (propName !== target) continue;
    units += parseInt(r[5], 10) || 0;
    const rent = parseFloat(r[8]) || 0;
    if (rent > 0) rents.push(rent);
  }
  return { units, rents };
}

const hdFiles = readdirSync(HD_DIR).filter(
  (f) => /^HelloData\s*-\s*Full\s*-\s*/i.test(f) && f.toLowerCase().endsWith(".xlsx")
);

const hdEntries = [];
const hdErrors = [];

for (const file of hdFiles) {
  try {
    const wb = XLSX.read(readFileSync(join(HD_DIR, file)), { type: "buffer" });
    const filenameSubject = file
      .replace(/^HelloData\s*-\s*Full\s*-\s*/i, "")
      .replace(/\.xlsx$/i, "")
      .trim();
    const wmu = rowsOf(wb.Sheets["Weekly Market Updates"]);
    // WMU sheet's !ref starts at column B, so sheet_to_json shifts: r[0] = column B.
    const wmuSubject = (wmu[3]?.[0] || "").toString().trim();
    const subjectName = wmuSubject || filenameSubject;
    const address = (wmu[4]?.[0] || "").toString().trim();
    const owner = (wmu[5]?.[0] || "").toString().trim();
    const website = (wmu[6]?.[0] || "").toString().trim();
    const amenities = extractAmenities(wb.Sheets["Fees & Amenities"]);
    const { units, rents } = extractUnitMix(wb.Sheets["Unit Mix"], subjectName);
    const priceMin = rents.length ? Math.round(Math.min(...rents)) : 0;
    const priceMax = rents.length ? Math.round(Math.max(...rents)) : 0;
    hdEntries.push({
      sourceFile: file,
      name: filenameSubject,
      subjectName,
      address,
      units,
      priceMin,
      priceMax,
      yearBuilt: 0,
      amenities,
      nearBy: "",
      description: [
        owner && `Owner: ${owner}`,
        units && `${units} units`,
        website,
        "Source: HelloData survey",
      ]
        .filter(Boolean)
        .join(" · "),
      managerName: owner || "",
    });
  } catch (e) {
    hdErrors.push({ file, error: e.message });
  }
}

/* ---------- dedup HD by normalized name (keep richest) ---------- */

function richness(p) {
  return (
    (p.amenities?.length || 0) * 10 +
    (p.units > 0 ? 5 : 0) +
    (p.priceMin > 0 ? 5 : 0) +
    (p.address ? 3 : 0)
  );
}

const hdByKey = new Map();
for (const e of hdEntries) {
  const key = normalize(e.name);
  if (!key) continue;
  const prev = hdByKey.get(key);
  if (!prev || richness(e) > richness(prev)) {
    hdByKey.set(key, e);
  }
}
const hdDeduped = Array.from(hdByKey.values());

/* ---------- match master <-> HD ---------- */

const masterTokensList = masterEntries.map((m) => ({ entry: m, tokens: tokens(m.name) }));
const hdTokensList = hdDeduped.map((h) => ({ entry: h, tokens: tokens(h.name) }));

const matchedHdKeys = new Set();
const final = [];
const matchLog = [];

for (const m of masterTokensList) {
  if (m.tokens.length === 0) {
    final.push(m.entry);
    continue;
  }
  let bestMatch = null;
  let bestScore = 0;
  for (const h of hdTokensList) {
    if (matchedHdKeys.has(h.entry.name)) continue;
    if (h.tokens.length === 0) continue;
    const masterIsSubset = tokensSubset(m.tokens, h.tokens);
    const hdIsSubset = tokensSubset(h.tokens, m.tokens);
    if (!masterIsSubset && !hdIsSubset) continue;
    const overlap = m.tokens.filter((t) => h.tokens.includes(t)).length;
    const score = overlap * 100 - Math.abs(m.tokens.length - h.tokens.length);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = h;
    }
  }
  if (bestMatch) {
    matchedHdKeys.add(bestMatch.entry.name);
    matchLog.push({ master: m.entry.name, hd: bestMatch.entry.name });
    // Merge: prefer HD's data for richness, but fall back to Master's when HD is empty
    final.push({
      ...bestMatch.entry,
      name: m.entry.name, // keep CRES canonical name
      address: bestMatch.entry.address || m.entry.address,
      units: bestMatch.entry.units || m.entry.units,
      managerName: bestMatch.entry.managerName || m.entry.managerName,
      description:
        bestMatch.entry.description +
        (m.entry.description ? ` · CRES: ${m.entry.description.replace(/^Client: /, "")}` : ""),
    });
  } else {
    final.push(m.entry);
  }
}

/* ---------- add unmatched HD entries (comp properties) ---------- */

for (const h of hdTokensList) {
  if (!matchedHdKeys.has(h.entry.name)) {
    final.push(h.entry);
  }
}

/* ---------- strip helper fields not in Property type ---------- */

const clean = final.map((p) => {
  const { sourceFile, subjectName, ...rest } = p;
  return rest;
});

writeFileSync(OUT, JSON.stringify(clean, null, 2), "utf8");

console.log(`Master entries: ${masterEntries.length}`);
console.log(`HD files: ${hdFiles.length} → ${hdEntries.length} parsed → ${hdDeduped.length} after dedup`);
console.log(`Matched (Master ↔ HD): ${matchLog.length}`);
console.log(`Final roster: ${clean.length} (target: ${masterEntries.length} + ${hdDeduped.length - matchLog.length} comps = ${masterEntries.length + hdDeduped.length - matchLog.length})`);
console.log(`Wrote to: ${OUT}`);
console.log();
console.log("Match log:");
for (const m of matchLog) console.log(`  ${m.master.padEnd(40)} <- ${m.hd}`);
console.log();
console.log("Unmatched Master entries (will keep sparse data):");
for (const m of masterTokensList) {
  const wasMatched = matchLog.some((x) => x.master === m.entry.name);
  if (!wasMatched) console.log(`  ${m.entry.name}`);
}
if (hdErrors.length) {
  console.log("\nHD parse errors:");
  for (const e of hdErrors) console.log(`  ${e.file}: ${e.error}`);
}
