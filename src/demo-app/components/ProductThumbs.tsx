// Miniatury produktów w wierszu zamówienia. Zwięzły kolaż (1 / 2 / 3 / 2×2 jak
// w albumach) z małą cyferką ilości na każdym zdjęciu i „+N" przy nadmiarze.
// Po najechaniu rozwija się TRWAŁY (najeżdżalny) popover z listą produktów, a
// najechanie na pojedyncze zdjęcie powiększa je ~2,5× w boxie ze strzałką-linkiem.
import { useRef, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { OrderItem } from "../lib/types";
import { useI18n, T } from "../lib/i18n";
import { Package, ArrowUpRight } from "lucide-react";

const SIZE = 46; // bok kafelka w wierszu

// Układy kolażu wg liczby kafelków (grid-template-areas — jak albumy zdjęć).
const LAYOUTS: Record<number, { cols: string; rows: string; template: string; areas: string[] }> = {
  1: { cols: "1fr", rows: "1fr", template: `"a"`, areas: ["a"] },
  2: { cols: "1fr 1fr", rows: "1fr", template: `"a b"`, areas: ["a", "b"] },
  3: { cols: "1fr 1fr", rows: "1fr 1fr", template: `"a b" "a c"`, areas: ["a", "b", "c"] },
  4: { cols: "1fr 1fr", rows: "1fr 1fr", template: `"a b" "c d"`, areas: ["a", "b", "c", "d"] },
};

// Karta hover z intencją: zostaje otwarta dopóki mysz jest nad kotwicą LUB panelem
// (krótkie opóźnienie zamknięcia pozwala przejechać myszką przez lukę między nimi).
function useHoverCard() {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const open = (el: HTMLElement) => {
    if (timer.current) clearTimeout(timer.current);
    setRect(el.getBoundingClientRect());
  };
  const scheduleClose = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setRect(null), 160);
  };
  const cancelClose = () => { if (timer.current) clearTimeout(timer.current); };
  return { rect, open, scheduleClose, cancelClose };
}

// Zdjęcie z fallbackiem: przy błędzie/braku URL pokazuje inicjał nazwy lub ikonę.
function Photo({ item, iconSize, fit = "cover" }: { item: OrderItem; iconSize: number; fit?: "cover" | "contain" }) {
  const [err, setErr] = useState(false);
  const show = item.imageUrl && !err;
  if (show) {
    return <img src={item.imageUrl} alt={item.productName ?? ""} loading="lazy" onError={() => setErr(true)}
      style={{ width: "100%", height: "100%", objectFit: fit, display: "block" }} />;
  }
  const ch = (item.productName ?? "").trim().charAt(0).toUpperCase();
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--color-neutral-900)", color: "var(--muted)" }}>
      {ch ? <span style={{ fontWeight: 700, fontSize: iconSize }}>{ch}</span> : <Package size={iconSize} />}
    </div>
  );
}

// Strzałka-link do aukcji, wbudowana w róg boxu ze zdjęciem.
function AuctionArrow({ href, size = 26 }: { href: string; size?: number }) {
  const { t } = useI18n();
  return (
    <a href={href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
      title={t(T.od_open_auction)} aria-label={t(T.od_open_auction)}
      style={{
        position: "absolute", top: 7, right: 7, width: size, height: size, borderRadius: 8,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(20,20,28,0.72)", color: "#fff", backdropFilter: "blur(2px)",
        border: "1px solid rgba(255,255,255,0.18)",
      }}>
      <ArrowUpRight size={Math.round(size * 0.62)} strokeWidth={2.4} />
    </a>
  );
}

// Zdjęcie produktu, które po najechaniu pokazuje powiększony (~2,5×) box ze strzałką
// linkującą do aukcji. Sam box też jest „najeżdżalny", więc strzałka jest klikalna.
export function ImageZoom({ item, size = 40, radius = 8, fit = "cover" }: { item: OrderItem; size?: number; radius?: number; fit?: "cover" | "contain" }) {
  const card = useHoverCard();
  const ref = useRef<HTMLDivElement>(null);
  const preview = Math.max(200, Math.round(size * 2.5));
  const href = item.productUrl ?? undefined;

  // Pozycja boxu: obok kotwicy (prawo, a jak brak miejsca — lewo), spionowana i przycięta.
  const pos = (() => {
    const r = card.rect!;
    let left = r.right + 12;
    if (left + preview > window.innerWidth - 12) left = r.left - preview - 12;
    if (left < 12) left = Math.max(12, Math.min(r.left, window.innerWidth - preview - 12));
    const top = Math.max(12, Math.min(r.top + r.height / 2 - preview / 2, window.innerHeight - preview - 12));
    return { top, left };
  });

  return (
    <>
      <div ref={ref}
        onMouseEnter={(e) => card.open(e.currentTarget)} onMouseLeave={card.scheduleClose}
        style={{ width: size, height: size, flexShrink: 0, borderRadius: radius, overflow: "hidden", border: "1px solid var(--color-divider)", background: "var(--color-surface)", cursor: item.imageUrl ? "zoom-in" : "default" }}>
        <Photo item={item} iconSize={Math.round(size * 0.42)} fit={fit} />
      </div>

      {card.rect && item.imageUrl && createPortal(
        <div onMouseEnter={card.cancelClose} onMouseLeave={card.scheduleClose}
          style={{ position: "fixed", ...pos(), zIndex: 95, width: preview, borderRadius: 14, overflow: "hidden", border: "1px solid var(--color-divider)", background: "var(--color-surface)", boxShadow: "0 18px 44px rgba(0,0,0,0.5)" }}>
          <div style={{ position: "relative", width: preview, height: preview }}>
            <img src={item.imageUrl} alt={item.productName ?? ""} style={{ width: "100%", height: "100%", objectFit: fit, display: "block" }} />
            {href && <AuctionArrow href={href} />}
          </div>
          {item.productName && (
            <div style={{ padding: "8px 10px", fontSize: 12.5, fontWeight: 600, color: "var(--color-text)", borderTop: "1px solid var(--color-divider)" }}>
              {href
                ? <a href={href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: "var(--color-text)", textDecoration: "none" }}>{item.productName}</a>
                : item.productName}
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

// Pojedyncza miniatura produktu (np. w tabeli pozycji w szczegółach zamówienia) —
// z powiększeniem po najechaniu i strzałką-linkiem do aukcji.
export function ItemThumb({ item, size = 40, fit = "cover" }: { item: OrderItem; size?: number; fit?: "cover" | "contain" }) {
  return <ImageZoom item={item} size={size} radius={7} fit={fit} />;
}

const qtyBadge: CSSProperties = {
  position: "absolute", right: 2, bottom: 2, minWidth: 15, height: 15, padding: "0 3px",
  borderRadius: 8, background: "var(--color-accent)", color: "#fff", fontSize: 10, fontWeight: 800,
  lineHeight: "15px", textAlign: "center", boxShadow: "0 0 0 1.5px var(--color-surface)",
  fontVariantNumeric: "tabular-nums",
};

export default function ProductThumbs({ items, fit = "cover" }: { items: OrderItem[]; fit?: "cover" | "contain" }) {
  const { t } = useI18n();
  const card = useHoverCard();

  if (!items || items.length === 0) {
    return (
      <div style={{ width: SIZE, height: SIZE, borderRadius: 9, border: "1px solid var(--color-divider)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", flexShrink: 0 }}>
        <Package size={18} />
      </div>
    );
  }

  // Do 4 kafelków; przy >4 ostatni to „+N".
  const overflow = items.length > 4 ? items.length - 3 : 0;
  const shown = overflow ? items.slice(0, 3) : items.slice(0, 4);
  const nCells = shown.length + (overflow ? 1 : 0);
  const layout = LAYOUTS[nCells] ?? LAYOUTS[4];
  const cellIcon = nCells === 1 ? 20 : 13;

  // Pozycja listy: pod kafelkiem, przycięta do ekranu.
  const popTop = card.rect ? Math.min(card.rect.bottom + 8, window.innerHeight - 12) : 0;
  const popLeft = card.rect ? Math.max(12, Math.min(card.rect.left, window.innerWidth - 320)) : 0;

  return (
    <>
      <div
        onMouseEnter={(e) => card.open(e.currentTarget)}
        onMouseLeave={card.scheduleClose}
        style={{
          width: SIZE, height: SIZE, flexShrink: 0, borderRadius: 9, overflow: "hidden",
          border: "1px solid var(--color-divider)", display: "grid", gap: 2,
          gridTemplateColumns: layout.cols, gridTemplateRows: layout.rows, gridTemplateAreas: layout.template,
          background: "var(--color-divider)", cursor: "pointer",
        }}
      >
        {shown.map((it, i) => {
          const qty = Number(it.quantity ?? 1);
          return (
            <div key={i} style={{ gridArea: layout.areas[i], position: "relative", overflow: "hidden", background: "var(--color-surface)" }}>
              <Photo item={it} iconSize={cellIcon} fit={fit} />
              {qty > 1 && <span style={qtyBadge}>{qty}</span>}
            </div>
          );
        })}
        {overflow > 0 && (
          <div style={{ gridArea: layout.areas[shown.length], display: "flex", alignItems: "center", justifyContent: "center", background: "var(--color-accent-800)", color: "var(--color-accent-100)", fontSize: 12, fontWeight: 800 }}>
            +{overflow}
          </div>
        )}
      </div>

      {/* Trwały, najeżdżalny popover — portal (fixed), nieobcinany przez tabelę. */}
      {card.rect && createPortal(
        <div
          onMouseEnter={card.cancelClose}
          onMouseLeave={card.scheduleClose}
          style={{
            position: "fixed", top: popTop, left: popLeft,
            zIndex: 80, width: 320, maxHeight: 380, overflowY: "auto",
            background: "var(--color-surface)", border: "1px solid var(--color-divider)",
            borderRadius: 12, boxShadow: "0 12px 32px rgba(0,0,0,0.45)", padding: 10,
          }}
        >
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", padding: "2px 4px 8px" }}>
            {t(T.od_items)} · {items.length}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {items.map((it, i) => {
              const qty = Number(it.quantity ?? 1);
              const href = it.productUrl ?? undefined;
              return (
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <ImageZoom item={it} size={52} fit={fit} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)", overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                      {href
                        ? <a href={href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: "var(--color-text)", textDecoration: "none" }}>{it.productName ?? "—"}</a>
                        : (it.productName ?? "—")}
                    </div>
                    {it.externalOfferId && <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "ui-monospace, monospace" }}>{it.externalOfferId}</div>}
                  </div>
                  <span style={{ flexShrink: 0, padding: "2px 8px", borderRadius: 999, background: "var(--color-accent-900)", color: "var(--color-accent-200)", fontSize: 12, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                    × {qty}
                  </span>
                </div>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
