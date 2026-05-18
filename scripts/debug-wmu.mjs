import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";

const PATH = process.argv[2];
const wb = XLSX.read(readFileSync(PATH), { type: "buffer" });
const ws = wb.Sheets["Weekly Market Updates"];
console.log("!ref:", ws["!ref"]);
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: false });
console.log(`rows.length = ${rows.length}`);
for (let i = 0; i < Math.min(rows.length, 8); i++) {
  console.log(`row ${i} (len=${rows[i]?.length}):`, JSON.stringify(rows[i]?.slice(0, 6)));
}
