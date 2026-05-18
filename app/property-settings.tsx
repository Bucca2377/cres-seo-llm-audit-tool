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
  onClose: () => void;
}

export default function PropertySettings({
  open,
  property,
  canDelete,
  rosterSize,
  onSave,
  onReset,
  onDelete,
  onClearAll,
  onExport,
  onImport,
  onClose,
}: Props) {
  const [draft, setDraft] = useState<Property>(property);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [importMode, setImportMode] = useState<"append" | "merge" | "replace">("append");
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      const safeName = (draft.name || "property").replace(/[^a-z0-9-_]+/gi, "-").toLowerCase();
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cres-property-${safeName}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setNotice({ kind: "ok", text: "Property JSON downloaded." });
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
              title="Download this property as a .json file"
            >
              ⬇ Export JSON
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
