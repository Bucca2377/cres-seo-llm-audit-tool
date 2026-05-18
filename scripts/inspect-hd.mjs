import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";

const PATH = process.argv[2];
if (!PATH) {
  console.error("Usage: node inspect-hd.mjs <path>");
  process.exit(1);
}

const wb = XLSX.read(readFileSync(PATH), { type: "buffer" });
console.log("SHEETS:", wb.SheetNames);
console.log();

for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  const ref = ws["!ref"];
  console.log(`=== "${name}" (range ${ref}) ===`);
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: false });
  console.log(`Rows: ${rows.length}`);
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const r = rows[i];
    const trimmed = r.slice(0, 8).map((v) => (v === null ? "" : String(v).slice(0, 40)));
    console.log(`  ${i}:`, trimmed.join(" | "));
  }
  console.log();
}
