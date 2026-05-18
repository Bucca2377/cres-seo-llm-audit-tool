import { readFileSync, writeFileSync } from "node:fs";

const PATH = "app/page.tsx";
let src = readFileSync(PATH, "utf8");

// 1. Replace the entire SEO TAB section with a thin wrapper around RankCheck
{
  const startMarker = "/* ================= SEO TAB ======================================== */";
  const endMarker = "/* ================= PPC TAB ======================================== */";
  const startIdx = src.indexOf(startMarker);
  const endIdx = src.indexOf(endMarker);
  if (startIdx < 0 || endIdx < 0) throw new Error("SEO/PPC markers not found");

  const replacement = `/* ================= SEO TAB ======================================== */
function SEOTab({ property }: { property: Property }) {
  return <RankCheck property={property} />;
}

`;
  src = src.slice(0, startIdx) + replacement + src.slice(endIdx);
  console.log("[1] SEOTab simplified");
}

// 2. Delete PPC TAB and ILS TAB sections entirely
{
  const startMarker = "/* ================= PPC TAB ======================================== */";
  const endMarker = "/* ================= CONTENT GENERATOR TAB ========================== */";
  const startIdx = src.indexOf(startMarker);
  const endIdx = src.indexOf(endMarker);
  if (startIdx < 0 || endIdx < 0) throw new Error("PPC/Content markers not found");
  src = src.slice(0, startIdx) + src.slice(endIdx);
  console.log("[2] PPC + ILS tabs removed");
}

// 3. Delete LEAD ATTRIBUTION TAB section and its constants entirely
{
  const startMarker = "/* ================= LEAD ATTRIBUTION TAB =========================== */";
  const endMarker = "/* ================= MAIN APP ======================================= */";
  const startIdx = src.indexOf(startMarker);
  const endIdx = src.indexOf(endMarker);
  if (startIdx < 0 || endIdx < 0) throw new Error("LeadAttr/MainApp markers not found");
  src = src.slice(0, startIdx) + src.slice(endIdx);
  console.log("[3] Lead Attribution tab removed");
}

// 4. Update the TABS array (and the per-tab rendering switch)
{
  src = src.replace(
    /const TABS = \[[\s\S]*?\];/,
    `const TABS = [
  { id: "llm", label: "LLM Visibility" },
  { id: "seo", label: "SEO & Rank Check" },
  { id: "content", label: "Content Generator" },
];`
  );
  console.log("[4] TABS array updated to 3 tabs");
}

// 5. Remove the routing for deleted tabs
{
  src = src.replace(/\s*\{tab === "attribution" && <LeadAttributionTab property={property} \/>\}/g, "");
  src = src.replace(/\s*\{tab === "ppc" && <PPCTab property={property} \/>\}/g, "");
  src = src.replace(/\s*\{tab === "ils" && <ILSTab \/>\}/g, "");
  console.log("[5] Tab routing trimmed");
}

// 6. Remove unused recharts imports (no charts left anywhere)
{
  src = src.replace(
    /import \{[\s\S]*?\} from "recharts";\s*\n/,
    ""
  );
  console.log("[6] Recharts import removed");
}

// 7. Adjust default active tab if it was "attribution" or "ppc" or "ils"
{
  src = src.replace(
    /const \[tab, setTab\] = useState\("(?:attribution|ppc|ils)"\);/,
    'const [tab, setTab] = useState("llm");'
  );
  console.log("[7] Default tab set to LLM");
}

writeFileSync(PATH, src, "utf8");
console.log("\nDone. New file size:", src.length, "chars");
