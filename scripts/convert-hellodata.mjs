import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as XLSX from "xlsx";

const DIR =
  "C:\\Users\\BrendanVanDeventer\\cre-strategies.com\\CRES - Documents\\CRES - Company Wide Access\\Market Surveys\\Data\\5.10.26";
const OUT = "C:\\Users\\BrendanVanDeventer\\Downloads\\cres-properties-hellodata.json";

const files = readdirSync(DIR).filter(
  (f) => /^HelloData\s*-\s*Full\s*-\s*/i.test(f) && f.toLowerCase().endsWith(".xlsx")
);

function extractName(filename) {
  return filename
    .replace(/^HelloData\s*-\s*Full\s*-\s*/i, "")
    .replace(/\.xlsx$/i, "")
    .trim();
}

function rowsOf(ws) {
  return ws ? XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: false }) : [];
}

function extractAmenities(ws) {
  const rows = rowsOf(ws);
  const amenities = [];
  for (const r of rows) {
    const label = r[1]; // col B
    const subjectMark = r[2]; // col C is subject
    if (
      typeof label === "string" &&
      label.trim() &&
      String(subjectMark).trim().toUpperCase() === "X"
    ) {
      amenities.push(label.trim());
    }
  }
  return amenities;
}

function extractUnitMix(ws, subjectName) {
  const rows = rowsOf(ws);
  let totalUnits = 0;
  const rents = [];
  const lowerSubject = subjectName.toLowerCase();
  for (const r of rows) {
    const propName = (r[0] || "").toString().trim();
    if (!propName) continue;
    if (propName.toLowerCase() !== lowerSubject) continue;
    const units = parseInt(r[5], 10) || 0;
    const rent = parseFloat(r[8]) || 0;
    totalUnits += units;
    if (rent > 0) rents.push(rent);
  }
  return { units: totalUnits, rents };
}

const out = [];
const errors = [];

for (const file of files) {
  try {
    const path = join(DIR, file);
    const filenameSubject = extractName(file);
    const wb = XLSX.read(readFileSync(path), { type: "buffer" });

    const wmuRows = rowsOf(wb.Sheets["Weekly Market Updates"]);
    const wmuSubjectName = (wmuRows[3]?.[1] || "").toString().trim();
    const subjectName = wmuSubjectName || filenameSubject;

    const address = (wmuRows[4]?.[1] || "").toString().trim();
    const owner = (wmuRows[5]?.[1] || "").toString().trim();
    const website = (wmuRows[6]?.[1] || "").toString().trim();

    const amenities = extractAmenities(wb.Sheets["Fees & Amenities"]);
    const { units, rents } = extractUnitMix(wb.Sheets["Unit Mix"], subjectName);
    const priceMin = rents.length ? Math.round(Math.min(...rents)) : 0;
    const priceMax = rents.length ? Math.round(Math.max(...rents)) : 0;

    const descParts = [];
    if (owner) descParts.push(`Owner: ${owner}`);
    if (units) descParts.push(`${units} units`);
    if (website) descParts.push(website);
    descParts.push("Source: HelloData survey");
    const description = descParts.join(" · ");

    out.push({
      name: filenameSubject,
      address,
      units,
      priceMin,
      priceMax,
      yearBuilt: 0,
      amenities,
      nearBy: "",
      description,
      managerName: owner || "",
    });
  } catch (e) {
    errors.push({ file, error: e instanceof Error ? e.message : String(e) });
  }
}

writeFileSync(OUT, JSON.stringify(out, null, 2), "utf8");
console.log(`Processed ${files.length} HD files. Wrote ${out.length} properties to:`);
console.log(`  ${OUT}`);
if (errors.length) {
  console.log(`\nErrors (${errors.length}):`);
  for (const e of errors) console.log(`  ${e.file}: ${e.error}`);
}
console.log("\nSample (first 2):");
console.log(JSON.stringify(out.slice(0, 2), null, 2));
console.log("\nNames extracted:");
for (const p of out) {
  console.log(`  ${p.name.padEnd(50)} units=${p.units}  rent=$${p.priceMin}-${p.priceMax}  amenities=${p.amenities.length}`);
}
