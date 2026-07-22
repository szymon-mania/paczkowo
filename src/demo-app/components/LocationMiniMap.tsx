import { useEffect } from "react";
import type { CSSProperties } from "react";
import type { WarehouseNode } from "../lib/stockApi";

// Mini-podgląd planu do wybierania miejsca. Wpisywany kod podświetla się progresywnie
// („H1" → podwórko, „H1-S01" → strefa, „…-P02" → miejsce). Wpisanie kodu innego
// podwórka przełącza podgląd; można też wybrać podwórko z listy albo kliknąć kafelek.

const BOX_H = 168;
const PAD = 10;

export default function LocationMiniMap({
  nodes, value, onPick, buildingId, onBuildingChange,
}: {
  nodes: WarehouseNode[];
  value: string;
  onPick: (code: string) => void;
  buildingId: number | null;
  onBuildingChange: (id: number) => void;
}) {
  const buildings = nodes.filter((n) => n.kind === "building");
  const typed = value.trim().toUpperCase();
  const seg0 = typed.split("-")[0];

  // Wpisany kod podwórka przełącza podgląd na to podwórko.
  useEffect(() => {
    const hit = buildings.find((b) => b.code.toUpperCase() === seg0);
    if (hit && hit.id !== buildingId) onBuildingChange(hit.id);
  }, [seg0, buildingId, buildings.length]);

  // Ręczny wybór z listy = „chcę wskazać gdzie indziej": czyścimy kod, żeby wpisany
  // prefiks nie przeciągał podglądu z powrotem. Miejsce wybierasz wtedy klikiem.
  const switchYard = (id: number) => { onPick(""); onBuildingChange(id); };

  const building = buildings.find((b) => b.id === buildingId) ?? buildings[0] ?? null;
  const select: CSSProperties = {
    width: "100%", marginBottom: 6, padding: "6px 8px", borderRadius: 8,
    border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12,
  };
  const shell: CSSProperties = {
    position: "relative", width: "100%", height: BOX_H, borderRadius: 8,
    border: "1px solid var(--border)", background: "var(--bg)", overflow: "hidden",
  };
  const note = (text: string) => (
    <div>
      {buildings.length > 0 && (
        <select style={select} value={building?.id ?? ""} onChange={(e) => switchYard(Number(e.target.value))}>
          {buildings.map((b) => <option key={b.id} value={b.id}>{b.name} · {b.code}</option>)}
        </select>
      )}
      <div style={{ ...shell, display: "grid", placeItems: "center", color: "var(--muted2)", fontSize: 12 }}>{text}</div>
    </div>
  );

  if (!building) return note("Brak podwórka");

  const kids: WarehouseNode[] = [];
  const walk = (pid: number) => { for (const n of nodes.filter((x) => x.parentId === pid)) { kids.push(n); walk(n.id); } };
  walk(building.id);
  const shapes = kids.filter((n) => n.shape !== "text");
  if (shapes.length === 0) return note("Puste podwórko");

  const minX = Math.min(...shapes.map((n) => n.x));
  const minY = Math.min(...shapes.map((n) => n.y));
  const maxX = Math.max(...shapes.map((n) => n.x + n.width));
  const maxY = Math.max(...shapes.map((n) => n.y + n.height));
  const boxW = 320;
  const scale = Math.min((boxW - PAD * 2) / Math.max(1, maxX - minX), (BOX_H - PAD * 2) / Math.max(1, maxY - minY));
  const place = (n: WarehouseNode): CSSProperties => ({
    position: "absolute",
    left: PAD + (n.x - minX) * scale,
    top: PAD + (n.y - minY) * scale,
    width: Math.max(3, n.width * scale),
    height: Math.max(3, n.height * scale),
  });

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const exactRaw = shapes.find((n) => n.code.toUpperCase() === typed) ?? null;
  // Adres półki (`REGAŁ-N`) nie ma własnego kafelka — trafiamy w regał-rodzica.
  const shelfHit = (() => {
    if (exactRaw) return null;
    const m = typed.match(/^(.*)-(\d+)$/);
    if (!m) return null;
    const rack = shapes.find((n) => n.kind === "rack" && n.code.toUpperCase() === m[1]);
    return rack ? { rack, shelf: Number(m[2]) } : null;
  })();
  const exact = exactRaw ?? shelfHit?.rack ?? null;
  const shelfRack = exact?.kind === "rack" ? exact : null;
  const shelfCount = shelfRack ? Math.min(40, shelfRack.meta?.shelves ?? 0) : 0;
  const activeShelf = shelfHit && shelfRack?.id === shelfHit.rack.id ? shelfHit.shelf : null;
  const under = (n: WarehouseNode, ancestor: WarehouseNode) => {
    let p = n.parentId;
    while (p) { if (p === ancestor.id) return true; p = byId.get(p)?.parentId ?? null; }
    return false;
  };
  const hot = (n: WarehouseNode) => {
    if (!typed) return false;
    const c = n.code.toUpperCase();
    if (c === typed) return true;
    if (c.startsWith(`${typed}-`)) return true;
    return !!exact && under(n, exact);
  };

  const isSection = (n: WarehouseNode) => n.kind === "zone" && n.shape !== "wall" && n.shape !== "text";
  const isPickable = (n: WarehouseNode) => (n.kind === "rack" || n.kind === "bin") && n.shape !== "wall";

  return (
    <div>
      <select style={select} value={building.id} onChange={(e) => switchYard(Number(e.target.value))}>
        {buildings.map((b) => <option key={b.id} value={b.id}>{b.name} · {b.code}</option>)}
      </select>
      <div style={shell}>
        {shapes.filter((n) => n.shape === "wall").map((n) => (
          <div key={n.id} style={{ ...place(n), background: "#3a4250", borderRadius: 1 }} />
        ))}
        {shapes.filter(isSection).map((n) => {
          const on = hot(n);
          const box = place(n);
          const style: CSSProperties = {
            ...box, borderRadius: 3, padding: 0, overflow: "hidden",
            display: "grid", placeItems: "center", textAlign: "center",
            border: `1.5px dashed ${on ? "#16a34a" : "color-mix(in srgb, var(--text) 26%, transparent)"}`,
            background: on ? "color-mix(in srgb, #16a34a 10%, transparent)" : "transparent",
            cursor: "pointer",
          };
          const label = (
            <span style={{
              fontSize: 9, fontWeight: 800, lineHeight: 1.1, letterSpacing: ".02em",
              color: on ? "#16a34a" : "var(--muted2)", padding: "0 2px",
              maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>{n.name}</span>
          );
          return (
            <button key={n.id} type="button" title={`${n.name} - ${n.code}`} onClick={() => onPick(n.code)} style={style}>
              {label}
            </button>
          );
        })}
        {shapes.filter(isPickable).map((n) => {
          const on = hot(n);
          const isExact = exact?.id === n.id;
          return (
            <button key={n.id} type="button" title={`${n.name} · ${n.code}`} onClick={() => onPick(n.code)} style={{
              ...place(n), padding: 0, cursor: "pointer", borderRadius: 2,
              border: `1px solid ${on ? "#16a34a" : "color-mix(in srgb, var(--text) 30%, transparent)"}`,
              background: isExact ? "#16a34a" : on ? "color-mix(in srgb, #16a34a 42%, var(--surface))" : "color-mix(in srgb, var(--text) 10%, var(--surface))",
              boxShadow: isExact ? "0 0 0 2px color-mix(in srgb, #16a34a 45%, transparent)" : "none",
            }} />
          );
        })}
        {exact && (
          <div style={{
            position: "absolute", left: 8, bottom: 6, padding: "2px 7px", borderRadius: 5,
            background: "color-mix(in srgb, var(--surface) 90%, transparent)", fontSize: 10.5, fontWeight: 700,
            color: "#16a34a", pointerEvents: "none", maxWidth: "88%",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{shelfHit ? `${shelfHit.rack.code} · półka ${shelfHit.shelf}` : exact.code}</div>
        )}
      </div>
      {shelfRack && shelfCount > 1 && (
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
          <span style={{ fontSize: 10, color: "var(--muted2)", fontWeight: 800 }}>{shelfRack.code}</span>
          {Array.from({ length: shelfCount }).map((_, index) => {
            const shelf = index + 1;
            const selected = activeShelf === shelf;
            return (
              <button
                key={shelf}
                type="button"
                onClick={() => onPick(`${shelfRack.code}-${shelf}`)}
                title={`${shelfRack.name} - ${shelf}`}
                style={{
                  minWidth: 26,
                  height: 24,
                  padding: "0 7px",
                  borderRadius: 6,
                  border: `1px solid ${selected ? "#16a34a" : "var(--border)"}`,
                  background: selected ? "#16a34a" : "var(--surface)",
                  color: selected ? "#fff" : "var(--text)",
                  fontSize: 11,
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                {shelf}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
