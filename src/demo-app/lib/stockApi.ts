// StockCore — prosty magazyn. Produkt = jedna liczba „na stanie" (qty).
// Stan schodzi sam przy wysyłce, rośnie przy dostawie/korekcie. Katalog zaciągasz
// z ofert Allegro/Erli i z historii zamówień — bez ręcznego wpisywania.
import { invoke } from "@tauri-apps/api/core";

export type StockProduct = {
  id: number;
  sku: string;
  ean: string | null;
  name: string;
  imageUrl: string | null;
  unitValue: string | null;
  currency: string | null;
  qty: number;       // stan na ręku
  minQty: number;    // próg „kończy się"
  location: string | null;
  archived: boolean;
  low: boolean;
  out: boolean;
};

export type HistoryEntry = {
  delta: number;
  reason: string;    // sale|receipt|adjust|count|import
  note: string | null;
  refId: string | null;
  createdAt: string;
};

export type ProductCard = Omit<StockProduct, "low" | "out"> & {
  createdAt: string;
  history: HistoryEntry[];
};

export type Candidate = {
  offerId: string;
  name: string | null;
  imageUrl: string | null;
  marketplace: string | null;
  account: string | null;
  ordersCount?: number;
  totalQty?: number | null;
  sku?: string | null;
  ean?: string | null;
  unitValue?: string | null; // cena jednostkowa (z oferty Allegro/Erli lub ostatniej sprzedaży)
  qty: number;       // stan startowy (z oferty Allegro/Erli; z zamówień = 0)
};

export type Alerts = {
  low: { id: number; sku: string; name: string; qty: number; minQty: number }[];
  out: { id: number; sku: string; name: string; qty: number; minQty: number }[];
  unmatched: { offerId: string; name: string | null; marketplace: string | null; orders: number; qty: number | null }[];
  counts: { low: number; out: number; unmatched: number };
};

export type Dashboard = {
  stockValue: string;
  currency: string;
  products: number;
  units: number;
  low: number;
  out: number;
  sold30: number;
  topSellers: { name: string; sku: string; sold: number }[];
  series: { date: string; inbound: number; outbound: number }[];
};

// ── Katalog / stan ──────────────────────────────────────────────────────────────
export function listProducts(includeArchived = false) {
  return invoke<StockProduct[]>("stock_list_products", { includeArchived });
}
export function getProduct(id: number) {
  return invoke<ProductCard>("stock_get_product", { id });
}
export function upsertProduct(p: {
  id?: number | null;
  sku: string;
  ean?: string | null;
  name: string;
  imageUrl?: string | null;
  unitValue?: string | null;
  minQty?: number | null;
  location?: string | null;
  initialQty?: number | null;
}) {
  return invoke<number>("stock_upsert_product", {
    id: p.id ?? null,
    sku: p.sku,
    ean: p.ean ?? null,
    name: p.name,
    imageUrl: p.imageUrl ?? null,
    unitValue: p.unitValue ?? null,
    minQty: p.minQty ?? null,
    location: p.location ?? null,
    initialQty: p.initialQty ?? null,
  });
}
// Zmiana stanu zwraca też wynik wypchnięcia na Allegro (anty-oversprzedaż).
export type StockChange = { qty: number; pushed: number; pushError: string | null };

/** Korekta względna: +dostawa / −ubytek. */
export function adjustQty(id: number, delta: number, reason?: string, note?: string) {
  return invoke<StockChange>("stock_adjust_qty", { id, delta, reason: reason ?? null, note: note ?? null });
}
/** Ustaw stan na konkretną wartość (inwentaryzacja). */
export function setQty(id: number, qty: number, note?: string) {
  return invoke<StockChange>("stock_set_qty", { id, qty, note: note ?? null });
}
export function archiveProduct(id: number, archived: boolean) {
  return invoke<void>("stock_archive_product", { id, archived });
}

// ── Zaciąganie katalogu ──────────────────────────────────────────────────────────
export function importCandidates() {
  return invoke<Candidate[]>("stock_import_candidates");
}
export function importAllegroOffers(account: string) {
  return invoke<Candidate[]>("stock_import_allegro_offers", { account });
}
export function importErliOffers(account: string) {
  return invoke<Candidate[]>("stock_import_erli_offers", { account });
}
export function importOffers(items: Candidate[]) {
  return invoke<{ created: number; mapped: number }>("stock_import_offers", {
    items: items.map((c) => ({
      offerId: c.offerId,
      marketplace: c.marketplace ?? "allegro",
      name: c.name,
      imageUrl: c.imageUrl,
      sku: c.sku ?? null,
      ean: c.ean ?? null,
      qty: c.qty,
      account: c.account ?? null,
      unitValue: c.unitValue ?? null,
    })),
  });
}

// ── Przyjęcie dostawy (SKU + ilość + opcjonalne miejsce) ──────────────────────
export type ReceiveLine = { sku: string; qty: number; location?: string | null };
export type BulkResult = {
  applied: { sku: string; productId: number; name: string; qty: number; added: number; location: string | null }[];
  notFound: string[];
  /** Kody miejsc, których nie ma na mapie albo nie są odkładcze — ilość doliczona, miejsce pominięte. */
  badLocations: string[];
  pushed: number;
};
export function bulkReceive(items: ReceiveLine[]) {
  return invoke<BulkResult>("stock_bulk_receive", { items });
}

/** Wszystkie adresy, pod które da się odłożyć towar — z rozwinięciem półek regału
 *  (regał `H1-R01` z 4 półkami daje `H1-R01` oraz `H1-R01-1…4`). */
export function pickableCodes(nodes: WarehouseNode[]): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    const canStoreHere = n.pickable || n.kind === "zone";
    if (!canStoreHere || n.shape === "wall" || n.shape === "text") continue;
    out.push(n.code);
    const shelves = n.kind === "rack" ? Math.min(40, n.meta?.shelves ?? 0) : 0;
    for (let i = 1; i <= shelves; i++) out.push(`${n.code}-${i}`);
  }
  return out;
}

// ── Synchronizacja stanu ──────────────────────────────────────────────────────────
export type SyncResult = { products: number; pushed: number; errors: number; lastError: string | null };
/** Rozlicza wysyłki na stan + wypycha rozjechane stany na Allegro. */
export function stockSync() {
  return invoke<SyncResult>("stock_sync");
}
/** Pełna synchronizacja: świeże zamówienia (best-effort) → rozliczenie/push stanu. */
export async function syncWarehouse(): Promise<SyncResult> {
  try { await invoke("sync_allegro_orders", { account: null }); } catch { /* brak konta/licencji — pomijamy */ }
  try { await invoke("sync_erli_orders", { account: null }); } catch { /* j.w. */ }
  try { await invoke("sync_inpost_merchant_orders", { account: null }); } catch { /* j.w. */ }
  return stockSync();
}

// ── Alerty / dashboard ────────────────────────────────────────────────────────────
export function getAlerts() {
  return invoke<Alerts>("stock_alerts");
}
export function getDashboard() {
  return invoke<Dashboard>("stock_dashboard");
}

// ── Mapa i terminal magazynowy ─────────────────────────────────────────────
export type LocationKind = "warehouse" | "building" | "zone" | "rack" | "bin";
/** Rodzaj bryły na planie. `wall` = ściana (łamana z rogami, punkty w meta.pts). */
export type LocationShape = "rect" | "round" | "circle" | "triangle" | "diamond" | "hexagon" | "l-shape" | "wall" | "text";
/** Dane zależne od kształtu: punkty ściany, liczba półek regału, piętra palety. */
export type LocationMeta = {
  pts?: [number, number][];  // ściana: łamana w px świata
  closed?: boolean;          // ściana: zamknięty kształt (wielokąt)
  shelves?: number;          // regał: liczba półek
  tiers?: number;            // paleta: liczba pięter (spiętrowanie)
} | null;
export type WarehouseNode = {
  id: number;
  parentId: number | null;
  kind: LocationKind;
  name: string;
  code: string;
  color: string;
  capacity: number;
  pickable: boolean;
  priority: number;
  x: number;
  y: number;
  width: number;
  height: number;
  shape: LocationShape;
  rotation: number;
  meta: LocationMeta;
  productCount: number;
  units: number;
};
export type WarehouseMap = {
  nodes: WarehouseNode[];
  unassignedProducts: number;
  unassignedUnits: number;
};
export type LocationInput = Omit<WarehouseNode, "id" | "productCount" | "units" | "meta"> & { id?: number | null; meta?: LocationMeta };

export function getWarehouseMap() {
  return invoke<WarehouseMap>("stock_location_map");
}
export function upsertLocation(input: LocationInput) {
  return invoke<number>("stock_upsert_location", { input });
}
export function deleteLocation(id: number) {
  return invoke<void>("stock_delete_location", { id });
}
export function createStarterLayout() {
  return invoke<void>("stock_create_starter_layout");
}
export function scanReceive(productCode: string, locationCode: string, qty: number) {
  return invoke<{ productId: number; sku: string; name: string; location: string; qty: number; added: number }>(
    "stock_scan_receive",
    { productCode, locationCode, qty },
  );
}
