import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";

const PATH = process.argv[2];
const TARGET = process.argv[3]; // optional sheet filter
if (!PATH) {
  console.error("Usage: node inspect-hd-detail.mjs <path> [sheet]");
  process.exit(1);
}

const wb = XLSX.read(readFileSync(PATH), { type: "buffer" });
const sheets = TARGET ? [TARGET] : wb.SheetNames;

for (const name of sheets) {
  const ws = wb.Sheets[name];
  if (!ws) {
    console.log(`(no sheet "${name}")`);
    continue;
  }
  console.log(`=== "${name}" ===`);
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: false });
  for (let i = 0; i < rows.length; i++) {
    const r = (rows[i] || []).map((v) => (v === null ? "" : String(v).slice(0, 60)));
    console.log(`  ${i}:`, r.slice(0, 12).join(" | "));
  }
  console.log();
}
