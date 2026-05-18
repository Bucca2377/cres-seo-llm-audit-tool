import { readFileSync, writeFileSync } from "node:fs";
import * as XLSX from "xlsx";

const SRC =
  "C:\\Users\\BrendanVanDeventer\\cre-strategies.com\\CRES - Documents\\CRES - Company Wide Access\\CRES MASTER WEEKLY & FINANCIAL SCHEDULES\\Weekly & Financial VA & Analyst Input Sheets\\Properties Master.xlsx";

const OUT = "C:\\Users\\BrendanVanDeventer\\Downloads\\cres-properties-master.json";

const wb = XLSX.read(readFileSync(SRC), { type: "buffer" });
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { defval: null, blankrows: false });

const out = [];
const skipped = [];

for (const r of rows) {
  const name = (r["Property"] || r["Alias"] || "").toString().trim();
  if (!name) {
    skipped.push({ reason: "no name", row: r });
    continue;
  }
  const street = (r["Street Address"] || "").toString().trim();
  const cityZip = (r["City, State, ZIP"] || "").toString().trim();
  const address = [street, cityZip].filter(Boolean).join(", ");

  const unitsRaw = r["Number of Units"];
  const units = typeof unitsRaw === "number" ? unitsRaw : parseInt(unitsRaw, 10) || 0;

  const ybRaw = r["Year Built / Renovated"];
  const yearBuilt =
    typeof ybRaw === "number"
      ? ybRaw
      : ybRaw
      ? parseInt(String(ybRaw).match(/\d{4}/)?.[0] || "0", 10) || 0
      : 0;

  const propMgr = (r["Manager"] || "").toString().trim();
  const cresMgr = (r["CRES Portfolio Manager"] || "").toString().trim();
  const client = (r["Client"] || "").toString().trim();

  const managerName = propMgr || cresMgr || "";

  const descParts = [];
  if (client) descParts.push(`Client: ${client}`);
  if (cresMgr) descParts.push(`CRES PM: ${cresMgr}`);
  if (units) descParts.push(`${units} units`);
  const description = descParts.join(" · ");

  out.push({
    name,
    address,
    units,
    priceMin: 0,
    priceMax: 0,
    yearBuilt,
    amenities: [],
    nearBy: "",
    description,
    managerName,
  });
}

writeFileSync(OUT, JSON.stringify(out, null, 2), "utf8");

console.log(`Read ${rows.length} rows from "${wb.SheetNames[0]}"`);
console.log(`Wrote ${out.length} properties to:`);
console.log(`  ${OUT}`);
if (skipped.length) {
  console.log(`Skipped ${skipped.length} row(s) with no name`);
}
console.log();
console.log("Sample (first 3):");
console.log(JSON.stringify(out.slice(0, 3), null, 2));
