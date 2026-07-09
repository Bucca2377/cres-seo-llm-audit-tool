"use client";

import { useEffect, useRef, useState } from "react";
import type { Property } from "@/lib/property";

const B = {
  oxford: "#062347",
  caribbean: "#006a6a",
  cambridge: "#93b2ab",
  tangelo: "#f25620",
};

interface Props {
  open: boolean;
  property: Property;
  properties: Property[];
  canDelete: boolean;
  rosterSize: number;
  onSave: (p: Property) => void;
  onReset: () => void;
  onDelete: () => void;
  onClearAll: () => void;
  onExport: () => string;
  onImport: (
    json: string,
    opts?: { mode?: "append" | "merge" | "replace" }
  ) => { added: number; updated: number; removed: number; first: Property };
  /** Apply a partial update to a specific property by id. Used by batch enrichment. */
  onUpdateProperty: (id: string, patch: Partial<Property>) => void;
  /** Look up a property's website + GBP URL via SerpAPI. */
  onEnrich: (
    property: Property
  ) => Promise<
    | { patch: Partial<Pick<Property, "website" | "gbpUrl" | "apartmentsUrl">>; gbp: unknown }
    | null
  >;
  onClose: () => void;
}

export default function PropertySettings({
  open,
  property,
  properties,
  canDelete,
  rosterSize,
  onSave,
  onReset,
  onDelete,
  onClearAll,
  onExport,
  onImport,
  onUpdateProperty,
  onEnrich,
  onClose,
}: Props) {
  const [draft, setDraft] = useState<Property>(property);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [importMode, setImportMode] = useState<"append" | "merge" | "replace">("append");
  const [enrichProgress, setEnrichProgress] = useState<{
    running: boolean;
    current: number;
    total: number;
    label: string;
    enrichedWebsite: number;
    enrichedGbp: number;
    skipped: number;
    failed: number;
  } | null>(null);
  const enrichCancelRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [redetecting, setRedetecting] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft(property);
      setNotice(null);
    }
  }, [open, property]);

  if (!open) return null;

  const handleExport = () => {
    try {
      const json = onExport();
      const count = (() => {
        try {
          const parsed = JSON.parse(json);
          return Array.isArray(parsed) ? parsed.length : 1;
        } catch {
          return 1;
        }
      })();
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "cres-roster-backup.json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setNotice({ kind: "ok", text: `Backup downloaded — ${count} propert${count === 1 ? "y" : "ies"} with full audit history.` });
    } catch (e) {
      setNotice({ kind: "error", text: e instanceof Error ? e.message : "Export failed." });
    }
  };

  const handleImportClick = () => fileInputRef.current?.click();

  const handleFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    try {
      if (importMode === "replace") {
        const ok = window.confirm(
          "Replace entire roster with the contents of this file? Your current properties will be deleted. This cannot be undone."
        );
        if (!ok) return;
      }
      const text = await file.text();
      const result = onImport(text, { mode: importMode });
      const parts: string[] = [];
      if (result.removed > 0) parts.push(`removed ${result.removed}`);
      if (result.added > 0) parts.push(`added ${result.added}`);
      if (result.updated > 0) parts.push(`updated ${result.updated}`);
      setNotice({
        kind: "ok",
        text: `Import complete: ${parts.join(", ") || "no changes"}. Switched to "${result.first.name}".`,
      });
    } catch (err) {
      setNotice({
        kind: "error",
        text: err instanceof Error ? err.message : "Could not parse the JSON file.",
      });
    }
  };

  const handleDelete = () => {
    if (!canDelete) return;
    const ok = window.confirm(
      `Delete "${draft.name}" from your property roster? This cannot be undone.`
    );
    if (ok) {
      onDelete();
      onClose();
    }
  };

  const handleClearAll = () => {
    const ok = window.confirm(
      `Delete ALL ${rosterSize} properties from your roster? This cannot be undone. After clearing you can re-import a JSON file.`
    );
    if (!ok) return;
    onClearAll();
    setNotice({ kind: "ok", text: `Cleared roster. Now showing 1 fresh property.` });
  };

  const handleEnrichAll = async () => {
    const candidates = properties.filter(
      (p) => !p.website || !p.gbpUrl || !p.apartmentsUrl
    );
    if (candidates.length === 0) {
      setNotice({
        kind: "ok",
        text: "All properties already have website, Google, and Apartments.com URLs set. Nothing to enrich.",
      });
      return;
    }
    const ok = window.confirm(
      `Auto-fill Website, Google Business Profile, and Apartments.com URLs for ${candidates.length} of ${properties.length} properties? This runs up to 2 SerpAPI calls per property. Properties that already have all three are skipped, and existing values are never overwritten.`
    );
    if (!ok) return;

    enrichCancelRef.current = false;
    setEnrichProgress({
      running: true,
      current: 0,
      total: candidates.length,
      label: candidates[0].name,
      enrichedWebsite: 0,
      enrichedGbp: 0,
      skipped: 0,
      failed: 0,
    });
    setNotice(null);

    let enrichedWebsite = 0;
    let enrichedGbp = 0;
    let enrichedApts = 0;
    let skipped = 0;
    let failed = 0;

    for (let i = 0; i < candidates.length; i++) {
      if (enrichCancelRef.current) break;
      const target = candidates[i];
      setEnrichProgress((prev) =>
        prev ? { ...prev, current: i + 1, label: target.name } : prev
      );
      try {
        const result = await onEnrich(target);
        if (!result) {
          failed++;
        } else if (
          Object.keys(result.patch).length === 0
        ) {
          skipped++;
        } else {
          onUpdateProperty(target.id, result.patch);
          if (result.patch.website) enrichedWebsite++;
          if (result.patch.gbpUrl) enrichedGbp++;
          if (result.patch.apartmentsUrl) enrichedApts++;
        }
      } catch {
        failed++;
      }
      // Small delay between requests to be polite to SerpAPI
      await new Promise((res) => setTimeout(res, 300));
    }

    setEnrichProgress(null);
    setNotice({
      kind: "ok",
      text: `Enrichment complete. Website set on ${enrichedWebsite}, Google URL on ${enrichedGbp}, Apartments.com on ${enrichedApts}. ${skipped} already complete. ${failed} not found via SerpAPI.${
        enrichCancelRef.current ? " (Cancelled before finishing.)" : ""
      }`,
    });
  };

  const handleCancelEnrich = () => {
    enrichCancelRef.current = true;
  };

  const handleRedetect = async () => {
    setRedetecting(true);
    setNotice(null);
    try {
      // Use the current DRAFT (so address edits in the form are honored
      // immediately, without requiring a save first). We pass it as a
      // Property; onEnrich only reads name + address + website + gbpUrl.
      const result = await onEnrich(draft);
      if (!result) {
        setNotice({
          kind: "error",
          text: "Google didn't return a confident match. Check the property name + address, or paste the Google Maps URL into the GBP field manually.",
        });
        return;
      }
      // computeEnrichment only returns fields that aren't already set, so
      // for re-detect we need to overwrite explicitly. Read .gbp instead.
      const gbp = result.gbp as {
        website?: string;
        dataId?: string;
        placeId?: string;
        name?: string;
        address?: string;
      } | null;
      if (!gbp) {
        setNotice({
          kind: "error",
          text: "GBP found but data was incomplete. Try again or paste the values manually.",
        });
        return;
      }
      const newWebsite = gbp.website || draft.website || "";
      const newGbpUrl =
        gbp.placeId || gbp.dataId
          ? `https://www.google.com/maps/place/?q=place_id:${gbp.placeId || gbp.dataId}`
          : draft.gbpUrl || "";
      setDraft({ ...draft, website: newWebsite, gbpUrl: newGbpUrl });
      setNotice({
        kind: "ok",
        text: `Detected: ${gbp.name || "(unnamed)"} at ${gbp.address || "(no address)"}. Review the values below and click Save to commit.`,
      });
    } catch (e) {
      setNotice({
        kind: "error",
        text: e instanceof Error ? e.message : "Re-detect failed.",
      });
    } finally {
      setRedetecting(false);
    }
  };

  const field = (label: string, child: React.ReactNode, hint?: string) => (
    <div style={{ marginBottom: 14 }}>
      <div
        style={{
          fontFamily: "'Josefin Sans',sans-serif",
          fontSize: 11,
          fontWeight: 400,
          color: "#666",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      {child}
      {hint && (
        <div
          style={{
            fontFamily: "'Josefin Sans',sans-serif",
            fontSize: 10,
            color: "#aaa",
            marginTop: 4,
          }}
        >
          {hint}
        </div>
      )}
    </div>
  );

  const inputStyle: React.CSSProperties = {
    width: "100%",
    border: "1px solid #e0e0e0",
    borderRadius: 6,
    padding: "8px 12px",
    fontFamily: "'Josefin Sans',sans-serif",
    fontSize: 13,
    color: "#333",
    background: "#fafafa",
    outline: "none",
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(6,35,71,0.45)",
        zIndex: 100,
        display: "flex",
        justifyContent: "flex-end",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 460,
          maxWidth: "90vw",
          height: "100vh",
          background: "white",
          overflowY: "auto",
          padding: "24px 28px",
          boxShadow: "-8px 0 24px rgba(0,0,0,0.15)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 4,
          }}
        >
          <div
            style={{
              fontFamily: "'Barlow Condensed',sans-serif",
              fontWeight: 700,
              fontSize: 18,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: B.oxford,
            }}
          >
            Property Settings
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "#aaa",
              fontSize: 22,
              cursor: "pointer",
              lineHeight: 1,
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div
          style={{
            fontFamily: "'Josefin Sans',sans-serif",
            fontSize: 12,
            color: "#888",
            marginBottom: 16,
          }}
        >
          Every AI prompt uses these values. Saved to your browser only.
        </div>

        {notice && (
          <div
            style={{
              padding: "8px 12px",
              borderRadius: 6,
              marginBottom: 14,
              background: notice.kind === "ok" ? "#f0fdf4" : "#feeee7",
              color: notice.kind === "ok" ? "#15803d" : B.tangelo,
              fontFamily: "'Josefin Sans',sans-serif",
              fontSize: 12,
              border: `1px solid ${notice.kind === "ok" ? "#bbf7d0" : "#fecaca"}`,
            }}
          >
            {notice.text}
          </div>
        )}

        {field(
          "Property name",
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            style={inputStyle}
          />
        )}

        {field(
          "Address",
          <input
            value={draft.address}
            onChange={(e) => setDraft({ ...draft, address: e.target.value })}
            style={inputStyle}
          />
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {field(
            "Property type",
            <input
              value={draft.propertyType ?? ""}
              onChange={(e) => setDraft({ ...draft, propertyType: e.target.value })}
              style={inputStyle}
              placeholder="e.g. Townhomes"
            />,
            "What it actually is — drives search queries"
          )}
          {field(
            "Bedroom types",
            <input
              value={draft.bedroomTypes ?? ""}
              onChange={(e) => setDraft({ ...draft, bedroomTypes: e.target.value })}
              style={inputStyle}
              placeholder="e.g. 2 & 3 bedroom"
            />,
            "Used for bedroom-specific queries"
          )}
        </div>

        {field(
          "Website URL",
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={draft.website ?? ""}
              onChange={(e) => setDraft({ ...draft, website: e.target.value })}
              style={{ ...inputStyle, flex: 1 }}
              placeholder="https://www.villageatsnowfield.com"
            />
            <button
              onClick={handleRedetect}
              disabled={redetecting}
              style={{
                background: redetecting ? "#ddd" : "white",
                border: `1px solid ${B.caribbean}`,
                borderRadius: 6,
                padding: "6px 12px",
                color: redetecting ? "#999" : B.caribbean,
                fontFamily: "'Josefin Sans',sans-serif",
                fontSize: 11,
                fontWeight: 600,
                cursor: redetecting ? "not-allowed" : "pointer",
                whiteSpace: "nowrap",
                letterSpacing: "0.04em",
              }}
              title="Run a fresh SerpAPI lookup using the current property name + address to detect website + GBP URL. Overwrites the values below; you still need to click Save to commit."
            >
              {redetecting ? "Detecting…" : "🔄 Re-detect"}
            </button>
          </div>,
          "Used as the primary match for SEO rank checks (much more reliable than name matching). Use Re-detect to refresh from Google if the value looks wrong."
        )}

        {field(
          "Google Business Profile URL",
          <input
            value={draft.gbpUrl ?? ""}
            onChange={(e) => setDraft({ ...draft, gbpUrl: e.target.value })}
            style={inputStyle}
            placeholder="https://www.google.com/maps/place/..."
          />,
          "Search the property on Google Maps and copy the URL. Locks GBP identity for audits and review checks. Filled automatically by Re-detect."
        )}

        {field(
          "Apartments.com listing URL",
          <input
            value={draft.apartmentsUrl ?? ""}
            onChange={(e) => setDraft({ ...draft, apartmentsUrl: e.target.value })}
            style={inputStyle}
            placeholder="https://www.apartments.com/<slug>/<id>/"
          />,
          "Used by the Marketing Audit to check the ILS listing (active vs shell, hours, photos, tour/apply tools)."
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          {field(
            "Units",
            <input
              type="number"
              value={draft.units}
              onChange={(e) =>
                setDraft({ ...draft, units: parseInt(e.target.value, 10) || 0 })
              }
              style={inputStyle}
            />
          )}
          {field(
            "Year built",
            <input
              type="number"
              value={draft.yearBuilt}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  yearBuilt: parseInt(e.target.value, 10) || 0,
                })
              }
              style={inputStyle}
            />
          )}
          {field(
            "Manager",
            <input
              value={draft.managerName}
              onChange={(e) =>
                setDraft({ ...draft, managerName: e.target.value })
              }
              style={inputStyle}
            />
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {field(
            "Rent min ($/mo)",
            <input
              type="number"
              value={draft.priceMin}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  priceMin: parseInt(e.target.value, 10) || 0,
                })
              }
              style={inputStyle}
            />
          )}
          {field(
            "Rent max ($/mo)",
            <input
              type="number"
              value={draft.priceMax}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  priceMax: parseInt(e.target.value, 10) || 0,
                })
              }
              style={inputStyle}
            />
          )}
        </div>

        {field(
          "Amenities",
          <textarea
            value={draft.amenities.join("\n")}
            onChange={(e) =>
              setDraft({
                ...draft,
                amenities: e.target.value
                  .split("\n")
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
            style={{ ...inputStyle, height: 140, resize: "vertical" }}
          />,
          "One per line"
        )}

        {field(
          "Nearby / location context",
          <textarea
            value={draft.nearBy}
            onChange={(e) => setDraft({ ...draft, nearBy: e.target.value })}
            style={{ ...inputStyle, height: 70, resize: "vertical" }}
          />,
          "Walkability, transit, landmarks"
        )}

        {field(
          "Property description",
          <textarea
            value={draft.description}
            onChange={(e) =>
              setDraft({ ...draft, description: e.target.value })
            }
            style={{ ...inputStyle, height: 100, resize: "vertical" }}
          />
        )}

        <div
          style={{
            display: "flex",
            gap: 8,
            marginTop: 24,
            paddingTop: 16,
            borderTop: "1px solid #eee",
          }}
        >
          <button
            onClick={() => {
              onSave(draft);
              setNotice({ kind: "ok", text: "Saved." });
            }}
            style={{
              flex: 1,
              background: B.caribbean,
              border: "none",
              borderRadius: 7,
              padding: "10px 0",
              color: "white",
              fontFamily: "'Barlow Condensed',sans-serif",
              fontWeight: 700,
              fontSize: 14,
              letterSpacing: "0.08em",
              cursor: "pointer",
            }}
          >
            Save
          </button>
          <button
            onClick={() => {
              onReset();
              setNotice({ kind: "ok", text: "Reset to The Meridian demo data." });
            }}
            style={{
              background: "transparent",
              border: `1px solid ${B.cambridge}`,
              borderRadius: 7,
              padding: "10px 16px",
              color: B.caribbean,
              fontFamily: "'Josefin Sans',sans-serif",
              fontSize: 12,
              cursor: "pointer",
            }}
            title="Reset this property to The Meridian demo values"
          >
            Reset to demo
          </button>
        </div>

        <div
          style={{
            marginTop: 24,
            paddingTop: 16,
            borderTop: "1px solid #eee",
          }}
        >
          <div
            style={{
              fontFamily: "'Barlow Condensed',sans-serif",
              fontWeight: 700,
              fontSize: 11,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "#666",
              marginBottom: 10,
            }}
          >
            Data
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              onClick={handleExport}
              style={{
                background: "white",
                border: `1px solid ${B.cambridge}`,
                borderRadius: 6,
                padding: "7px 14px",
                color: B.caribbean,
                fontFamily: "'Josefin Sans',sans-serif",
                fontSize: 12,
                cursor: "pointer",
              }}
              title="Download ALL properties + their audit history as one backup .json file"
            >
              ⬇ Export All (backup)
            </button>
            <button
              onClick={handleImportClick}
              style={{
                background: "white",
                border: `1px solid ${B.cambridge}`,
                borderRadius: 6,
                padding: "7px 14px",
                color: B.caribbean,
                fontFamily: "'Josefin Sans',sans-serif",
                fontSize: 12,
                cursor: "pointer",
              }}
              title="Add a property from a .json file"
            >
              ⬆ Import JSON
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              onChange={handleFileChosen}
              style={{ display: "none" }}
            />
            <button
              onClick={handleDelete}
              disabled={!canDelete}
              style={{
                background: "white",
                border: `1px solid ${canDelete ? B.tangelo : "#ddd"}`,
                borderRadius: 6,
                padding: "7px 14px",
                color: canDelete ? B.tangelo : "#bbb",
                fontFamily: "'Josefin Sans',sans-serif",
                fontSize: 12,
                cursor: canDelete ? "pointer" : "not-allowed",
              }}
              title={
                canDelete
                  ? "Remove this property from your roster"
                  : "Can't delete the only property"
              }
            >
              🗑 Delete property
            </button>
            <button
              onClick={handleEnrichAll}
              disabled={!!enrichProgress?.running}
              style={{
                background: enrichProgress?.running ? "#ddd" : B.caribbean,
                border: "none",
                borderRadius: 6,
                padding: "7px 14px",
                color: "white",
                fontFamily: "'Josefin Sans',sans-serif",
                fontSize: 12,
                cursor: enrichProgress?.running ? "not-allowed" : "pointer",
                fontWeight: 600,
              }}
              title="Auto-fill Website, Google Business Profile, and Apartments.com URLs for every property in your roster (up to 2 SerpAPI calls each). Skips properties that already have all three. Never overwrites existing values."
            >
              ✨ Enrich all ({properties.filter((p) => !p.website || !p.gbpUrl || !p.apartmentsUrl).length} missing)
            </button>
            <button
              onClick={handleClearAll}
              style={{
                background: B.tangelo,
                border: "none",
                borderRadius: 6,
                padding: "7px 14px",
                color: "white",
                fontFamily: "'Josefin Sans',sans-serif",
                fontSize: 12,
                cursor: "pointer",
                fontWeight: 600,
              }}
              title={`Delete all ${rosterSize} properties and start fresh`}
            >
              🧹 Clear all ({rosterSize})
            </button>
          </div>

          {enrichProgress?.running && (
            <div
              style={{
                marginTop: 12,
                padding: "10px 12px",
                borderRadius: 6,
                background: "#f5fbfb",
                border: "1px solid #cce7e7",
                fontFamily: "'Josefin Sans',sans-serif",
                fontSize: 12,
                color: "#333",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontWeight: 600 }}>
                  Enriching {enrichProgress.current} / {enrichProgress.total}
                </span>
                <button
                  onClick={handleCancelEnrich}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: B.tangelo,
                    fontFamily: "'Josefin Sans',sans-serif",
                    fontSize: 11,
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  Cancel
                </button>
              </div>
              <div
                style={{
                  height: 6,
                  background: "#e0eded",
                  borderRadius: 3,
                  overflow: "hidden",
                  marginBottom: 6,
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${(enrichProgress.current / enrichProgress.total) * 100}%`,
                    background: B.caribbean,
                    transition: "width 0.2s",
                  }}
                />
              </div>
              <div style={{ fontSize: 11, color: "#666", fontStyle: "italic" }}>
                {enrichProgress.label}
              </div>
            </div>
          )}
          <div style={{ marginTop: 12 }}>
            <div
              style={{
                fontFamily: "'Josefin Sans',sans-serif",
                fontSize: 11,
                color: "#666",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                marginBottom: 8,
              }}
            >
              Import mode
            </div>
            {(
              [
                ["append", "Append", "Add every entry as a new property"],
                ["merge", "Merge by name", "Update entries that match an existing name; add the rest"],
                ["replace", "Replace entire roster", "Delete current properties and load only the file's contents"],
              ] as const
            ).map(([id, label, hint]) => (
              <label
                key={id}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  marginBottom: 6,
                  cursor: "pointer",
                  fontFamily: "'Josefin Sans',sans-serif",
                  fontSize: 12,
                  color: "#333",
                }}
              >
                <input
                  type="radio"
                  name="import-mode"
                  checked={importMode === id}
                  onChange={() => setImportMode(id)}
                  style={{ cursor: "pointer", marginTop: 2 }}
                />
                <span>
                  <span style={{ color: id === "replace" ? B.tangelo : "#333", fontWeight: 400 }}>{label}</span>
                  <span style={{ display: "block", fontSize: 11, color: "#aaa" }}>{hint}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
