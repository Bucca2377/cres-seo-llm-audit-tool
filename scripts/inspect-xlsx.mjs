import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";

const PATH =
  "C:\\Users\\BrendanVanDeventer\\cre-strategies.com\\CRES - Documents\\CRES - Company Wide Access\\CRES MASTER WEEKLY & FINANCIAL SCHEDULES\\Weekly & Financial VA & Analyst Input Sheets\\Properties Master.xlsx";

const buf = readFileSync(PATH);
const wb = XLSX.read(buf, { type: "buffer" });

console.log("SHEETS:", wb.SheetNames);
console.log();

for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  const ref = ws["!ref"];
  console.log(`=== Sheet: ${name} (range ${ref}) ===`);
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: false });
  console.log(`Rows: ${rows.length}`);
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    console.log(`Row ${i}:`, JSON.stringify(rows[i]));
  }
  console.log();
}
