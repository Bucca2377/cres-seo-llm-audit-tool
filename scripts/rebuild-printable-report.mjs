import { readFileSync, writeFileSync } from "node:fs";

const PATH = "app/page.tsx";
const SNIPPET_PATH = "scripts/printable-report-snippet.txt";

const src = readFileSync(PATH, "utf8");
const snippet = readFileSync(SNIPPET_PATH, "utf8");

const startMarker = "/* ================= PRINTABLE REPORT =============================== */";
const endMarker = "export default function MarketingHub() {";

const startIdx = src.indexOf(startMarker);
const endIdx = src.indexOf(endMarker);
if (startIdx < 0 || endIdx < 0) {
  console.error("Could not find PrintableReport markers");
  process.exit(1);
}

const newSrc = src.slice(0, startIdx) + snippet + src.slice(endIdx);
writeFileSync(PATH, newSrc, "utf8");
console.log("Replaced PrintableReport:", endIdx - startIdx, "→", snippet.length, "chars");
