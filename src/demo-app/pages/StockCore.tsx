// StockCore — prosty magazyn dla sprzedawcy.
// Produkt = jedna liczba „na stanie". Schodzi sam przy wysyłce, rośnie przy dostawie.
// Katalog zaciągasz z ofert Allegro / z historii zamówień — bez ręcznego wpisywania.
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ChangeEvent, ReactNode } from "react";
import {
  listProducts, getProduct, upsertProduct, adjustQty, setQty, archiveProduct,
  importCandidates, importAllegroOffers, importErliOffers, importOffers,
  bulkReceive, syncWarehouse, getWarehouseMap, pickableCodes,
  getAlerts, getDashboard,
  type StockProduct, type ProductCard, type Candidate, type Alerts, type Dashboard, type SyncResult, type BulkResult, type WarehouseNode,
} from "../lib/stockApi";
import LocationMiniMap from "../components/LocationMiniMap";
import { getIntegrations, type Integration } from "../lib/accountApi";
import { T, localeOf, translateMessage, useI18n } from "../lib/i18n";
import { Download, Plus, RefreshCw, ScanLine } from "lucide-react";
import WarehouseMap from "../components/WarehouseMap";
import { CommercePagination } from "../components/CommerceUi";

// Wycena: ilość × cena jedn.
function valueOf(p: { qty: number; unitValue: string | null }): number {
  const u = parseFloat((p.unitValue ?? "").replace(",", "."));
  return Number.isFinite(u) ? p.qty * u : 0;
}
function fmtPln(n: number) {
  return fmtGrouped(n, 2, "pl-PL");
}
function fmtGrouped(n: number, fractionDigits = 0, locale = "pl-PL") {
  const [whole, fraction] = Math.abs(n).toFixed(fractionDigits).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const sign = n < 0 ? "−" : "";
  const decimal = locale.startsWith("pl") ? "," : ".";
  return `${sign}${grouped}${fractionDigits > 0 ? `${decimal}${fraction}` : ""}`;
}

const SYNC_COOLDOWN_MS = 5 * 60 * 1000;

type Tab = "produkty" | "mapa" | "alerty" | "podsumowanie";

const REASON_KEY: Record<string, T> = {
  sale: T.wh_reason_sale, receipt: T.wh_reason_receipt, adjust: T.wh_reason_adjust, count: T.wh_reason_count, import: T.wh_reason_import,
};
function fmtDate(iso: string | null | undefined, locale: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(locale, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

const card: CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10 };
const btn: CSSProperties = { padding: "7px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", cursor: "pointer", fontSize: 13 };
const btnPrimary: CSSProperties = { ...btn, background: "var(--accent)", color: "#fff", border: "none", fontWeight: 600 };
const input: CSSProperties = { padding: "7px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13, width: "100%" };

export default function StockCore() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("produkty");
  const [alertCount, setAlertCount] = useState(0);
  const [syncTick, setSyncTick] = useState(0);
  useEffect(() => { getAlerts().then((a) => setAlertCount(a.counts.out + a.counts.unmatched)).catch(() => {}); }, [tab, syncTick]);

  return (
    <main style={{ flex: 1, overflowY: "auto", padding: "28px 32px 60px", fontFamily: "var(--font-body)" }}>
      <div style={{ maxWidth: 1360, margin: "0 auto" }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0 }}>{t(T.nav_warehouse)}</h2>
            <SyncControls onSynced={() => setSyncTick((t) => t + 1)} />
          </div>
          <div className="seg" role="radiogroup" aria-label={t(T.nav_warehouse)} style={{ marginTop: 14 }}>
            {([["produkty", T.wh_tab_products], ["mapa", T.wh_tab_map], ["alerty", T.wh_tab_alerts], ["podsumowanie", T.wh_tab_summary]] as [Tab, T][]).map(([tb, labelKey]) => (
              <label key={tb} className="seg-opt">
                <input type="radio" name="whtab" checked={tab === tb} onChange={() => setTab(tb)} />
                {t(labelKey)}{tb === "alerty" && alertCount > 0 ? <span className="seg-count" style={{ background: "#dc2626", color: "#fff" }}>{alertCount}</span> : null}
              </label>
            ))}
          </div>
        </div>
        {tab === "produkty" && <ProductsTab refreshSignal={syncTick} />}
        {tab === "mapa" && <WarehouseMap onStockChanged={() => setSyncTick((t) => t + 1)} />}
        {tab === "alerty" && <AlertsTab key={syncTick} onImported={() => setTab("produkty")} />}
        {tab === "podsumowanie" && <DashboardTab key={syncTick} />}
      </div>
    </main>
  );
}

// ─── SYNCHRONIZACJA ──────────────────────────────────────────────────────────
function mmss(ms: number) {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
function SyncControls({ onSynced }: { onSynced: () => void }) {
  const { t, lang } = useI18n();
  const [last, setLast] = useState<number>(() => Number(localStorage.getItem("stockLastSync") || 0));
  const [autoMin, setAutoMin] = useState<number>(() => Number(localStorage.getItem("stockSyncInterval") || 0));
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState<{ text: string; err: boolean } | null>(null);
  const [, tick] = useState(0); // odliczanie cooldownu (1s)

  const doSync = async () => {
    if (syncing) return;
    setSyncing(true); setMsg(null);
    try {
      const r: SyncResult = await syncWarehouse();
      const now = Date.now();
      setLast(now); localStorage.setItem("stockLastSync", String(now));
      setMsg({
        text: r.errors > 0
          ? `${t(T.wh_sync_errors, { n: r.errors })}${r.lastError ? `: ${r.lastError}` : ""}`
          : t(T.wh_sync_ok, { n: r.pushed }),
        err: false,
      });
      onSynced();
    } catch (e) { setMsg({ text: `${t(T.wh_sync_fail)}: ${translateMessage(e, t)}`, err: true }); }
    finally { setSyncing(false); }
  };
  // ref do najświeższego doSync — używane przez interwał (omija stale closure)
  const doSyncRef = useRef(doSync);
  doSyncRef.current = doSync;

  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(id); }, []);
  useEffect(() => {
    if (!autoMin) return;
    const id = setInterval(() => { doSyncRef.current(); }, autoMin * 60 * 1000);
    return () => clearInterval(id);
  }, [autoMin]);

  const remaining = Math.max(0, SYNC_COOLDOWN_MS - (Date.now() - last));
  const onCooldown = remaining > 0;
  const setInt = (m: number) => { setAutoMin(m); localStorage.setItem("stockSyncInterval", String(m)); };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <select value={autoMin} onChange={(e) => setInt(Number(e.target.value))} style={{ ...input, width: "auto", fontSize: 12, padding: "6px 8px" }}>
          <option value={0}>{t(T.wh_auto_off)}</option>
          <option value={5}>{t(T.wh_auto_every, { n: 5 })}</option>
          <option value={10}>{t(T.wh_auto_every, { n: 10 })}</option>
          <option value={15}>{t(T.wh_auto_every, { n: 15 })}</option>
        </select>
        <button disabled={syncing || onCooldown} onClick={doSync}
          style={{ ...btnPrimary, display: "inline-flex", alignItems: "center", gap: 6, opacity: syncing || onCooldown ? 0.55 : 1, cursor: syncing || onCooldown ? "default" : "pointer" }}>
          <RefreshCw size={14} style={{ animation: syncing ? "spin 1s linear infinite" : "none" }} />
          {syncing ? t(T.set_syncing) : onCooldown ? t(T.ord_sync_wait, { time: mmss(remaining) }) : t(T.ord_sync)}
        </button>
      </div>
      {(msg || last > 0) && (
        <div style={{ fontSize: 11, color: msg?.err ? "#dc2626" : "var(--muted2)" }}>
          {msg?.text ?? t(T.wh_last_sync, { time: new Date(last).toLocaleTimeString(localeOf(lang)) })}
        </div>
      )}
    </div>
  );
}

// ─── PRODUKTY ────────────────────────────────────────────────────────────────
function ProductsTab({ refreshSignal }: { refreshSignal: number }) {
  const { t, lang } = useI18n();
  const [products, setProducts] = useState<StockProduct[]>([]);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [openId, setOpenId] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const [bulk, setBulk] = useState(false);
  const [editing, setEditing] = useState<StockProduct | null>(null);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reload = () => listProducts().then(setProducts).catch((e) => setErr(translateMessage(e, t)));
  useEffect(() => { reload(); }, [refreshSignal]);

  const filtered = useMemo(() => {
    const v = q.trim().toLowerCase();
    if (!v) return products;
    return products.filter((p) => `${p.sku} ${p.name} ${p.ean ?? ""} ${p.location ?? ""}`.toLowerCase().includes(v));
  }, [products, q]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const totalValue = useMemo(() => products.reduce((s, p) => s + valueOf(p), 0), [products]);
  const totalUnits = useMemo(() => products.reduce((s, p) => s + Math.max(0, p.qty), 0), [products]);

  return (
    <div>
      {/* Pasek podsumowania */}
      <div style={{ display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <MiniStat label={t(T.wh_stock_value)} value={`${fmtPln(totalValue)} zł`} />
        <MiniStat label={t(T.wh_tab_products)} value={fmtGrouped(products.length, 0, localeOf(lang))} />
        <MiniStat label={t(T.wh_units_total)} value={fmtGrouped(totalUnits, 0, localeOf(lang))} />
      </div>

      <div className="wh-products-toolbar">
        <div className="wh-products-search">
          <input style={input} placeholder={t(T.wh_search_ph)} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </div>
        <div className="wh-products-actions">
          <button className="wh-product-action" onClick={() => { setEditing(null); setCreating(true); }}><Plus size={15} />{t(T.wh_manual)}</button>
          <button className="wh-product-action wh-product-action-primary" onClick={() => setBulk(true)}><ScanLine size={15} />{t(T.wh_quick_receive)}</button>
          <button className="wh-product-action" onClick={() => setImporting(true)}><Download size={15} />{t(T.wh_import_products)}</button>
        </div>
      </div>
      {err && <div style={{ color: "#dc2626", fontSize: 13, marginBottom: 10 }}>{err}</div>}

      <div style={{ ...card, overflow: "hidden" }}>
        <div style={{ display: "flex", padding: "9px 14px", fontSize: 11, color: "var(--muted2)", borderBottom: "1px solid var(--border2)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
          <div style={{ flex: 2 }}>{t(T.wh_col_product)}</div>
          <div style={{ flex: 1 }}>SKU</div>
          <div style={{ width: 80 }}>{t(T.wh_col_location)}</div>
          <div style={{ width: 100, textAlign: "right" }}>{t(T.wh_col_value)}</div>
          <div style={{ width: 100, textAlign: "right" }}>{t(T.wh_col_stock)}</div>
        </div>
        {filtered.length === 0 && (
          <div style={{ padding: 24, color: "var(--muted2)", fontSize: 13, textAlign: "center" }}>
            {t(T.wh_empty)}
          </div>
        )}
        {visible.map((p) => (
          <div key={p.id} onClick={() => setOpenId(p.id)}
            style={{ display: "flex", alignItems: "center", padding: "10px 14px", borderBottom: "1px solid var(--border2)", cursor: "pointer", fontSize: 13 }}>
            <div style={{ flex: 2, display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <div style={{ width: 34, height: 34, borderRadius: 6, background: "var(--bg)", border: "1px solid var(--border2)", flexShrink: 0, backgroundImage: p.imageUrl ? `url(${p.imageUrl})` : undefined, backgroundSize: "cover", backgroundPosition: "center" }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
                {p.ean && <div style={{ fontSize: 11, color: "var(--muted2)" }}>EAN {p.ean}</div>}
              </div>
            </div>
            <div style={{ flex: 1, color: "var(--text2)", fontFamily: "ui-monospace, monospace", fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.sku}</div>
            <div style={{ width: 80, color: "var(--muted2)", fontSize: 12 }}>{p.location ?? "—"}</div>
            <div style={{ width: 100, textAlign: "right", color: "var(--text2)", fontVariantNumeric: "tabular-nums" }}>{p.unitValue ? `${fmtPln(valueOf(p))} zł` : "—"}</div>
            <div style={{ width: 100, textAlign: "right", display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
              <StockBadge p={p} />
            </div>
          </div>
        ))}
      </div>
      <CommercePagination page={currentPage} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={(value) => { setPageSize(value); setPage(1); }} />

      {importing && <ImportModal onClose={() => setImporting(false)} onDone={() => { setImporting(false); reload(); }} />}
      {bulk && <ReceiveModal onClose={() => setBulk(false)} onDone={reload} />}
      {openId != null && <ProductDrawer id={openId} onClose={() => setOpenId(null)} onChanged={reload}
        onEdit={(p) => { setOpenId(null); setEditing(p); setCreating(true); }} />}
      {creating && <ProductForm initial={editing} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload(); }} />}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ ...card, padding: "8px 14px", minWidth: 120 }}>
      <div style={{ fontSize: 10.5, color: "var(--muted2)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, marginTop: 1 }}>{value}</div>
    </div>
  );
}

// ─── PRZYJĘCIE DOSTAWY ────────────────────────────────────────────────────────
// Dokument przyjęcia: skanujesz kod po kodzie (SKU/EAN), pozycje same się zliczają,
// każdej możesz nadać miejsce z mapy. Zatwierdzenie dolicza stan i wypycha go na kanały.
type ReceiptLine = { key: string; sku: string; name: string | null; qty: number; location: string };

function ReceiveModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [catalog, setCatalog] = useState<StockProduct[]>([]);
  const [mapNodes, setMapNodes] = useState<WarehouseNode[]>([]);
  const [lines, setLines] = useState<ReceiptLine[]>([]);
  const [scan, setScan] = useState("");
  const [defLoc, setDefLoc] = useState("");
  // Do którego pola miejsca podpięta jest minimapa: null = domyślne, inaczej klucz pozycji.
  const [locTarget, setLocTarget] = useState<string | null>(null);
  const [yardId, setYardId] = useState<number | null>(null);   // podwórko pokazywane na minimapie
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listProducts().then(setCatalog).catch(() => {});
    getWarehouseMap().then((m) => {
      setMapNodes(m.nodes);
      setYardId((id) => id ?? m.nodes.find((n) => n.kind === "building")?.id ?? null);
    }).catch(() => {});
  }, []);

  const places = pickableCodes(mapNodes);
  const activeLoc = locTarget ? (lines.find((l) => l.key === locTarget)?.location ?? "") : defLoc;
  const pickLoc = (code: string) => {
    if (locTarget) setLines((ls) => ls.map((l) => (l.key === locTarget ? { ...l, location: code } : l)));
    else setDefLoc(code);
  };

  const findProduct = (code: string) => {
    const v = code.trim().toLowerCase();
    return catalog.find((p) => p.sku.toLowerCase() === v || (p.ean ?? "").toLowerCase() === v) ?? null;
  };

  // Skan: znany kod dokłada +1 do istniejącej pozycji, nowy zakłada wiersz.
  const addScan = (raw: string) => {
    const code = raw.trim();
    if (!code) return;
    const found = findProduct(code);
    const sku = found?.sku ?? code;
    setLines((ls) => {
      const i = ls.findIndex((l) => l.sku.toLowerCase() === sku.toLowerCase());
      if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, qty: l.qty + 1 } : l));
      return [...ls, { key: `${sku}-${Date.now()}`, sku, name: found?.name ?? null, qty: 1, location: defLoc }];
    });
    setScan("");
    scanRef.current?.focus();
  };

  const patch = (key: string, p: Partial<ReceiptLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));
  const drop = (key: string) => setLines((ls) => ls.filter((l) => l.key !== key));

  const totalUnits = lines.reduce((s, l) => s + (Number.isFinite(l.qty) ? l.qty : 0), 0);
  const unknown = lines.filter((l) => !l.name).length;

  const submit = async () => {
    const items = lines
      .filter((l) => l.sku.trim() && l.qty > 0)
      .map((l) => ({ sku: l.sku.trim(), qty: l.qty, location: l.location.trim() || null }));
    if (items.length === 0) { setErr("Zeskanuj przynajmniej jedną pozycję."); return; }
    setBusy(true); setErr(null);
    try { setResult(await bulkReceive(items)); onDone(); }
    catch (e) { setErr(translateMessage(e, t)); }
    finally { setBusy(false); }
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...card, width: 720, maxWidth: "96vw", maxHeight: "88vh", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "16px 22px 12px", borderBottom: "1px solid var(--border2)" }}>
          <div style={{ fontWeight: 800, fontSize: 17 }}>Przyjęcie dostawy</div>
        </div>

        {result ? (
          <ReceiptSummary result={result} onClose={onClose} onAgain={() => { setResult(null); setLines([]); setTimeout(() => scanRef.current?.focus(), 0); }} />
        ) : (
          <>
            <div style={{ padding: "14px 22px", display: "flex", gap: 16, borderBottom: "1px solid var(--border2)" }}>
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                <div>
                  <div style={{ fontSize: 11, color: "var(--muted2)", marginBottom: 4 }}>Skan (SKU / EAN)</div>
                  <input ref={scanRef} autoFocus style={{ ...input, fontFamily: "ui-monospace, monospace", fontSize: 15 }}
                    placeholder="Zeskanuj kod…" value={scan}
                    onChange={(e) => setScan(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addScan(scan); } }} />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "var(--muted2)", marginBottom: 4 }}>
                    {locTarget ? "Miejsce pozycji" : "Miejsce domyślne"}
                  </div>
                  <input style={{ ...input, fontFamily: "ui-monospace, monospace" }} list="wh-places" placeholder="np. H1-S01-P01"
                    value={activeLoc} onFocus={() => setLocTarget(null)}
                    onChange={(e) => pickLoc(e.target.value)} />
                </div>
              </div>
              <div style={{ width: 320, flex: "none" }}>
                <LocationMiniMap nodes={mapNodes} value={activeLoc} onPick={pickLoc}
                  buildingId={yardId} onBuildingChange={setYardId} />
              </div>
              <datalist id="wh-places">{places.map((p) => <option key={p} value={p} />)}</datalist>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "6px 22px 12px" }}>
              {lines.length === 0 ? (
                <div style={{ padding: "34px 0", textAlign: "center", color: "var(--muted2)", fontSize: 13 }}>
                  Zeskanuj pierwszy kod.
                </div>
              ) : (
                <>
                  <div style={{ display: "flex", gap: 10, fontSize: 11, color: "var(--muted2)", padding: "8px 2px 6px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    <div style={{ flex: 1 }}>Produkt</div>
                    <div style={{ width: 96 }}>Ilość</div>
                    <div style={{ width: 190 }}>Miejsce</div>
                    <div style={{ width: 28 }} />
                  </div>
                  {lines.map((l) => (
                    <div key={l.key} style={{ display: "flex", gap: 10, alignItems: "center", padding: "7px 2px", borderBottom: "1px solid var(--border2)" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: l.name ? "var(--text)" : "#dc2626" }}>
                          {l.name ?? "Nieznany kod — pominięty"}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--muted2)", fontFamily: "ui-monospace, monospace" }}>{l.sku}</div>
                      </div>
                      <div style={{ width: 96, display: "flex", alignItems: "center", gap: 4 }}>
                        <button style={{ ...btn, padding: "4px 8px" }} onClick={() => patch(l.key, { qty: Math.max(1, l.qty - 1) })}>−</button>
                        <input style={{ ...input, width: 44, textAlign: "center", padding: "6px 2px" }} value={l.qty}
                          onChange={(e) => patch(l.key, { qty: Math.max(0, parseInt(e.target.value, 10) || 0) })} />
                        <button style={{ ...btn, padding: "4px 8px" }} onClick={() => patch(l.key, { qty: l.qty + 1 })}>+</button>
                      </div>
                      <input style={{ ...input, width: 190, fontFamily: "ui-monospace, monospace", fontSize: 12, borderColor: locTarget === l.key ? "var(--accent)" : undefined }}
                        list="wh-places" placeholder="bez miejsca" value={l.location}
                        onFocus={() => setLocTarget(l.key)}
                        onChange={(e) => patch(l.key, { location: e.target.value })} />
                      <button style={{ ...btn, padding: "4px 8px", color: "#dc2626", width: 28 }} title="Usuń pozycję" onClick={() => drop(l.key)}>×</button>
                    </div>
                  ))}
                </>
              )}
            </div>

            {err && <div style={{ color: "#dc2626", fontSize: 13, padding: "0 22px 8px" }}>{err}</div>}

            <div style={{ padding: "12px 22px 18px", borderTop: "1px solid var(--border2)", display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ fontSize: 12.5, color: "var(--muted2)" }}>
                <b style={{ color: "var(--text)" }}>{lines.length}</b> pozycji · <b style={{ color: "var(--text)" }}>{totalUnits}</b> szt.
                {unknown > 0 && <span style={{ color: "#dc2626" }}> · {unknown} nieznanych</span>}
              </div>
              <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                <button style={btn} onClick={onClose}>Anuluj</button>
                <button style={{ ...btnPrimary, opacity: busy || lines.length === 0 ? 0.6 : 1 }} disabled={busy || lines.length === 0} onClick={submit}>
                  {busy ? "Zapisuję…" : "Zatwierdź przyjęcie"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ReceiptSummary({ result, onClose, onAgain }: { result: BulkResult; onClose: () => void; onAgain: () => void }) {
  const units = result.applied.reduce((s, a) => s + a.added, 0);
  return (
    <>
      <div style={{ flex: 1, overflowY: "auto", padding: "18px 22px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <div style={{ width: 38, height: 38, borderRadius: "50%", display: "grid", placeItems: "center", background: "color-mix(in srgb, #16a34a 14%, transparent)", color: "#16a34a" }}>✓</div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15 }}>Przyjęto {result.applied.length} pozycji ({units} szt.)</div>
            <div style={{ fontSize: 12, color: "var(--muted2)" }}>
              {result.pushed > 0 ? `Nowy stan wysłany do ${result.pushed} ofert.` : "Stan zapisany lokalnie."}
            </div>
          </div>
        </div>

        {result.applied.map((a) => (
          <div key={a.productId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 2px", borderBottom: "1px solid var(--border2)", fontSize: 13 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.name}</div>
              <div style={{ fontSize: 11, color: "var(--muted2)", fontFamily: "ui-monospace, monospace" }}>{a.sku}{a.location ? ` · ${a.location}` : ""}</div>
            </div>
            <div style={{ color: "#16a34a", fontWeight: 700 }}>+{a.added}</div>
            <div style={{ width: 64, textAlign: "right", color: "var(--muted2)", fontVariantNumeric: "tabular-nums" }}>= {a.qty}</div>
          </div>
        ))}

        {result.notFound.length > 0 && (
          <div style={{ marginTop: 14, padding: 12, borderRadius: 8, background: "color-mix(in srgb, #dc2626 8%, transparent)", color: "#dc2626", fontSize: 12.5 }}>
            Nieznane kody: {result.notFound.join(", ")}. Dodaj je do katalogu (Import / Nowy produkt).
          </div>
        )}
        {result.badLocations.length > 0 && (
          <div style={{ marginTop: 10, padding: 12, borderRadius: 8, background: "color-mix(in srgb, #ca8a04 10%, transparent)", color: "#ca8a04", fontSize: 12.5 }}>
            Miejsca spoza mapy (ilości doliczone): {result.badLocations.join(", ")}.
          </div>
        )}
      </div>
      <div style={{ padding: "12px 22px 18px", borderTop: "1px solid var(--border2)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button style={btn} onClick={onAgain}>Kolejna dostawa</button>
        <button style={btnPrimary} onClick={onClose}>Gotowe</button>
      </div>
    </>
  );
}

function StockBadge({ p }: { p: StockProduct }) {
  const { t } = useI18n();
  const color = p.out ? "#dc2626" : p.low ? "#ca8a04" : "var(--text)";
  return (
    <span style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums", color, fontSize: 15 }}>
      {p.qty}
      {p.out && <span style={{ marginLeft: 6, fontSize: 10, color: "#dc2626", fontWeight: 700 }}>{t(T.wh_badge_out)}</span>}
      {!p.out && p.low && <span style={{ marginLeft: 6, fontSize: 10, color: "#ca8a04", fontWeight: 700 }}>{t(T.wh_badge_low)}</span>}
    </span>
  );
}

function ProductDrawer({ id, onClose, onChanged, onEdit }: { id: number; onClose: () => void; onChanged: () => void; onEdit: (p: StockProduct) => void }) {
  const { t, lang } = useI18n();
  const [c, setC] = useState<ProductCard | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<{ text: string; warn: boolean } | null>(null);

  const [mapNodes, setMapNodes] = useState<WarehouseNode[]>([]);
  const [yardId, setYardId] = useState<number | null>(null);
  const [locDraft, setLocDraft] = useState("");

  const reload = () => getProduct(id).then(setC).catch((e) => setErr(translateMessage(e, t)));
  useEffect(() => { reload(); }, [id]);
  useEffect(() => {
    getWarehouseMap().then((m) => {
      setMapNodes(m.nodes);
      setYardId((y) => y ?? m.nodes.find((n) => n.kind === "building")?.id ?? null);
    }).catch(() => {});
  }, []);
  useEffect(() => { setLocDraft(c?.location ?? ""); }, [c?.location]);

  const run = async (fn: () => Promise<{ pushed: number; pushError: string | null }>) => {
    setBusy(true); setErr(null); setInfo(null);
    try {
      const r = await fn();
      setAmount(""); await reload(); onChanged();
      if (r.pushError) setInfo({ text: t(T.wh_push_warn, { e: r.pushError }), warn: true });
      else if (r.pushed > 0) setInfo({ text: t(T.wh_push_ok, { n: r.pushed }), warn: false });
    } catch (e) { setErr(translateMessage(e, t)); } finally { setBusy(false); }
  };
  const n = parseInt(amount, 10);

  // Przypisanie produktu do miejsca z mapy (pusty kod = zdejmij przypisanie).
  const saveLocation = async (code: string) => {
    if (!c) return;
    const clean = code.trim();
    setBusy(true); setErr(null); setInfo(null);
    try {
      await upsertProduct({
        id: c.id, sku: c.sku, ean: c.ean, name: c.name, imageUrl: c.imageUrl,
        unitValue: c.unitValue, minQty: c.minQty, location: clean || null,
      });
      await reload(); onChanged();
      setInfo({ text: clean ? `Przypisano do ${clean}` : "Zdjęto przypisanie do miejsca", warn: false });
    } catch (e) { setErr(translateMessage(e, t)); } finally { setBusy(false); }
  };
  const places = pickableCodes(mapNodes);
  const locChanged = (c?.location ?? "") !== locDraft.trim();

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 50, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 460, maxWidth: "92vw", height: "100%", background: "var(--bg)", borderLeft: "1px solid var(--border)", overflowY: "auto", padding: 22 }}>
        {!c ? <div style={{ color: "var(--muted2)" }}>{t(T.common_loading)}</div> : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, gap: 10 }}>
              <div style={{ display: "flex", gap: 12, minWidth: 0 }}>
                <div style={{ width: 48, height: 48, borderRadius: 8, background: "var(--surface)", border: "1px solid var(--border2)", flexShrink: 0, backgroundImage: c.imageUrl ? `url(${c.imageUrl})` : undefined, backgroundSize: "cover", backgroundPosition: "center" }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 17 }}>{c.name}</div>
                  <div style={{ fontSize: 12, color: "var(--muted2)", fontFamily: "ui-monospace, monospace" }}>{c.sku}{c.ean ? ` · EAN ${c.ean}` : ""}{c.location ? ` · ${c.location}` : ""}</div>
                </div>
              </div>
              <button style={btn} onClick={onClose}>×</button>
            </div>

            <div style={{ ...card, padding: "16px 18px", marginBottom: 16, textAlign: "center" }}>
              <div style={{ fontSize: 11, color: "var(--muted2)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{t(T.wh_in_stock)}</div>
              <div style={{ fontSize: 40, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: c.qty <= 0 ? "#dc2626" : c.minQty > 0 && c.qty <= c.minQty ? "#ca8a04" : "var(--text)" }}>{c.qty}</div>
              {c.minQty > 0 && <div style={{ fontSize: 11, color: "var(--muted2)" }}>{t(T.wh_alert_threshold, { n: c.minQty })}</div>}
            </div>

            {err && <div style={{ color: "#dc2626", fontSize: 13, marginBottom: 10 }}>{err}</div>}
            {info && <div style={{ color: info.warn ? "#ca8a04" : "#16a34a", fontSize: 12.5, marginBottom: 10 }}>{info.text}</div>}

            {/* Zmiana stanu */}
            <div style={{ ...card, padding: 12, marginBottom: 14 }}>
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <input style={{ ...input, width: 90 }} placeholder={t(T.wh_qty_ph)} value={amount} onChange={(e) => setAmount(e.target.value)} />
                <button style={{ ...btn, color: "#16a34a", flex: 1 }} disabled={busy || !n} onClick={() => run(() => adjustQty(id, Math.abs(n), "receipt", "dostawa"))}>{t(T.wh_receive_btn)}</button>
                <button style={{ ...btn, color: "#dc2626", flex: 1 }} disabled={busy || !n} onClick={() => run(() => adjustQty(id, -Math.abs(n), "adjust", "ubytek"))}>{t(T.wh_loss_btn)}</button>
              </div>
              <button style={{ ...btn, width: "100%", fontSize: 12, color: "var(--muted2)" }} disabled={busy || amount === "" || Number.isNaN(n)} onClick={() => run(() => setQty(id, n, "inwentaryzacja"))}>{t(T.wh_set_stock, { n: Number.isNaN(n) ? "…" : n })}</button>
            </div>

            {/* Miejsce na mapie */}
            <div style={{ ...card, padding: 12, marginBottom: 18 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700 }}>Miejsce</div>
                {c.location ? (
                  <code style={{ fontSize: 11.5, color: "#16a34a", fontWeight: 700 }}>{c.location}</code>
                ) : (
                  <span style={{ fontSize: 11.5, color: "#ca8a04", fontWeight: 700 }}>Nieprzypisany</span>
                )}
                {c.location && (
                  <button style={{ ...btn, marginLeft: "auto", padding: "3px 8px", fontSize: 11.5, color: "var(--muted2)" }}
                    disabled={busy} onClick={() => saveLocation("")}>Zdejmij</button>
                )}
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <input style={{ ...input, fontFamily: "ui-monospace, monospace", fontSize: 12 }} list="wh-drawer-places"
                  placeholder="Kod miejsca, np. H1-S01-P01" value={locDraft}
                  onChange={(e) => setLocDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") saveLocation(locDraft); }} />
                <button style={{ ...btnPrimary, opacity: busy || !locChanged ? 0.5 : 1, whiteSpace: "nowrap" }}
                  disabled={busy || !locChanged} onClick={() => saveLocation(locDraft)}>Przypisz</button>
              </div>
              <datalist id="wh-drawer-places">{places.map((p) => <option key={p} value={p} />)}</datalist>
              <LocationMiniMap nodes={mapNodes} value={locDraft} onPick={(code) => saveLocation(code)}
                buildingId={yardId} onBuildingChange={setYardId} />
            </div>

            {/* Historia */}
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text2)", marginBottom: 8 }}>{t(T.wh_history, { n: c.history.length })}</div>
            <div style={{ ...card, overflow: "hidden", marginBottom: 16 }}>
              {c.history.length === 0 && <div style={{ padding: 14, color: "var(--muted2)", fontSize: 13 }}>{t(T.wh_no_changes)}</div>}
              {c.history.map((h, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", borderBottom: "1px solid var(--border2)", fontSize: 12.5 }}>
                  <div style={{ width: 48, textAlign: "right", fontWeight: 800, fontVariantNumeric: "tabular-nums", color: h.delta >= 0 ? "#16a34a" : "#dc2626" }}>{h.delta >= 0 ? `+${h.delta}` : h.delta}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>{REASON_KEY[h.reason] ? t(REASON_KEY[h.reason]) : h.reason}</div>
                    <div style={{ color: "var(--muted2)", fontSize: 11 }}>{fmtDate(h.createdAt, localeOf(lang))}{h.refId ? ` · ${h.refId.slice(0, 10)}` : ""}{h.note ? ` · ${h.note}` : ""}</div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button style={{ ...btn, flex: 1 }} onClick={() => onEdit(c as unknown as StockProduct)}>{t(T.wh_edit_data)}</button>
              <button style={{ ...btn, color: "#dc2626" }} onClick={async () => { await archiveProduct(id, !c.archived); onChanged(); onClose(); }}>{c.archived ? t(T.wh_restore) : t(T.wh_archive)}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ProductForm({ initial, onClose, onSaved }: { initial: StockProduct | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [f, setF] = useState({
    sku: initial?.sku ?? "", ean: initial?.ean ?? "", name: initial?.name ?? "",
    location: initial?.location ?? "", unitValue: initial?.unitValue ?? "",
    minQty: String(initial?.minQty ?? 0), initialQty: "0", imageUrl: initial?.imageUrl ?? "",
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      await upsertProduct({
        id: initial?.id ?? null, sku: f.sku, ean: f.ean || null, name: f.name,
        imageUrl: f.imageUrl || null, unitValue: f.unitValue || null,
        minQty: Number(f.minQty) || 0, location: f.location || null,
        initialQty: initial ? null : Number(f.initialQty) || 0,
      });
      onSaved();
    } catch (e) { setErr(translateMessage(e, t)); setBusy(false); }
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...card, width: 460, maxWidth: "92vw", padding: 22 }}>
        <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 16 }}>{initial ? t(T.wh_form_edit) : t(T.wh_form_new)}</div>
        <div style={{ display: "grid", gap: 10 }}>
          <Field label="SKU *"><input style={input} value={f.sku} onChange={set("sku")} /></Field>
          <Field label={t(T.wh_form_name)}><input style={input} value={f.name} onChange={set("name")} /></Field>
          <div style={{ display: "flex", gap: 10 }}>
            <Field label="EAN"><input style={input} value={f.ean} onChange={set("ean")} /></Field>
            <Field label={t(T.wh_form_location)}><input style={input} value={f.location} onChange={set("location")} placeholder="A3" /></Field>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            {!initial && <Field label={t(T.wh_form_initial)}><input style={input} value={f.initialQty} onChange={set("initialQty")} /></Field>}
            <Field label={t(T.wh_form_alert_below)}><input style={input} value={f.minQty} onChange={set("minQty")} /></Field>
            <Field label={t(T.wh_form_unit_value)}><input style={input} value={f.unitValue} onChange={set("unitValue")} placeholder="0.00" /></Field>
          </div>
        </div>
        {err && <div style={{ color: "#dc2626", fontSize: 13, marginTop: 12 }}>{err}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          <button style={btn} onClick={onClose}>{t(T.common_cancel)}</button>
          <button style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={save}>{t(T.common_save)}</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label style={{ flex: 1, display: "block" }}><div style={{ fontSize: 11, color: "var(--muted2)", marginBottom: 4 }}>{label}</div>{children}</label>;
}

// ─── IMPORT ──────────────────────────────────────────────────────────────────
function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [sel, setSel] = useState<string>("orders"); // 'orders' albo integration.id
  const [items, setItems] = useState<Candidate[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    getIntegrations().then((ints) => {
      setIntegrations(ints);
      const allegro = ints.find((i) => i.platform === "allegro");
      if (allegro) setSel(allegro.id);
    }).catch(() => {});
  }, []);

  const chosenInt = integrations.find((i) => i.id === sel);

  const load = async () => {
    setLoading(true); setErr(null); setResult(null); setItems([]); setPicked(new Set());
    try {
      let cands: Candidate[];
      if (sel === "orders") {
        cands = await importCandidates();
      } else if (chosenInt?.platform === "allegro") {
        cands = await importAllegroOffers(chosenInt.accountName);
      } else if (chosenInt?.platform === "erli") {
        cands = await importErliOffers(chosenInt.accountName);
      } else {
        // inne platformy — z historii zamówień, tylko to konto
        const all = await importCandidates();
        cands = all.filter((c) => c.account === chosenInt?.accountName && c.marketplace === chosenInt?.platform);
      }
      setItems(cands);
      setPicked(new Set(cands.map((c) => c.offerId)));
    } catch (e) { setErr(translateMessage(e, t)); } finally { setLoading(false); }
  };

  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const doImport = async () => {
    const chosen = items.filter((c) => picked.has(c.offerId));
    if (chosen.length === 0) return;
    setLoading(true); setErr(null);
    try {
      const r = await importOffers(chosen);
      setResult(t(T.wh_import_done, { c: r.created, m: r.mapped }));
      setTimeout(onDone, 900);
    } catch (e) { setErr(translateMessage(e, t)); setLoading(false); }
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...card, width: 560, maxWidth: "94vw", maxHeight: "86vh", display: "flex", flexDirection: "column", padding: 22 }}>
        <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4 }}>{t(T.wh_import_products)}</div>
        <div style={{ fontSize: 12, color: "var(--muted2)", marginBottom: 14 }}>{t(T.wh_import_desc)}</div>

        <div style={{ fontSize: 11, color: "var(--muted2)", marginBottom: 6 }}>{t(T.wh_account_platform)}</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <select style={{ ...input, maxWidth: 320 }} value={sel} onChange={(e) => { setSel(e.target.value); setItems([]); }}>
            <option value="orders">{t(T.wh_all_accounts_orders)}</option>
            {integrations.map((i) => (
              <option key={i.id} value={i.id}>
                {i.platform} — {i.accountName}{i.platform === "allegro" || i.platform === "erli" || i.platform === "inpost_merchant" ? ` ${t(T.wh_offers_with_stock)}` : ` ${t(T.wh_from_orders)}`}
              </option>
            ))}
          </select>
          <button style={btnPrimary} disabled={loading} onClick={load}>{loading ? t(T.wh_fetching) : t(T.wh_fetch_list)}</button>
        </div>

        {err && <div style={{ color: "#dc2626", fontSize: 13, marginBottom: 10 }}>{err}</div>}
        {result && <div style={{ color: "#16a34a", fontSize: 13, marginBottom: 10 }}>{result}</div>}

        {items.length > 0 && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, fontSize: 12, color: "var(--muted2)" }}>
              <span>{t(T.wh_found_selected, { n: items.length, m: picked.size })}</span>
              <button style={{ ...btn, padding: "3px 8px", fontSize: 12 }} onClick={() => setPicked(picked.size === items.length ? new Set() : new Set(items.map((c) => c.offerId)))}>
                {picked.size === items.length ? t(T.wh_deselect_all) : t(T.wh_select_all)}
              </button>
            </div>
            <div style={{ ...card, overflow: "auto", flex: 1, marginBottom: 12 }}>
              {items.map((c) => (
                <label key={c.offerId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: "1px solid var(--border2)", fontSize: 13, cursor: "pointer" }}>
                  <input type="checkbox" checked={picked.has(c.offerId)} onChange={() => toggle(c.offerId)} />
                  <div style={{ width: 30, height: 30, borderRadius: 5, background: "var(--bg)", border: "1px solid var(--border2)", flexShrink: 0, backgroundImage: c.imageUrl ? `url(${c.imageUrl})` : undefined, backgroundSize: "cover", backgroundPosition: "center" }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name ?? c.offerId}</div>
                    <div style={{ fontSize: 11, color: "var(--muted2)" }}>{c.sku ?? c.offerId}{c.ordersCount ? ` · ${t(T.wh_sold_times, { n: c.ordersCount })}` : ""}</div>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted2)", fontVariantNumeric: "tabular-nums", textAlign: "right" }}>
                    <div>{t(T.wh_stock_n, { n: c.qty })}</div>
                    {c.unitValue && <div style={{ fontSize: 11 }}>{fmtPln(parseFloat(c.unitValue.replace(",", ".")))} zł</div>}
                  </div>
                </label>
              ))}
            </div>
            <button style={{ ...btnPrimary, opacity: loading || picked.size === 0 ? 0.6 : 1 }} disabled={loading || picked.size === 0} onClick={doImport}>
              {t(T.wh_add_n, { n: picked.size })}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── ALERTY ──────────────────────────────────────────────────────────────────
function AlertsTab({ onImported }: { onImported: () => void }) {
  const { t } = useI18n();
  const [a, setA] = useState<Alerts | null>(null);
  const reload = () => getAlerts().then(setA).catch(() => {});
  useEffect(() => { reload(); }, []);

  const addUnmatched = async (offerId: string, marketplace: string | null, name: string | null) => {
    await importOffers([{ offerId, marketplace, name, imageUrl: null, sku: null, qty: 0, account: null }]);
    reload(); onImported();
  };

  if (!a) return <div style={{ color: "var(--muted2)" }}>{t(T.common_loading)}</div>;
  const empty = a.out.length === 0 && a.low.length === 0 && a.unmatched.length === 0;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {empty && <div style={{ ...card, padding: 24, color: "var(--muted2)", textAlign: "center" }}>{t(T.wh_no_alerts)}</div>}

      {a.out.length > 0 && (
        <AlertSection title={t(T.wh_out_of_stock_n, { n: a.out.length })} color="#dc2626">
          {a.out.map((p) => <Row key={p.id} left={p.name} sub={p.sku} right={t(T.wh_pcs_n, { n: p.qty })} rightColor="#dc2626" />)}
        </AlertSection>
      )}
      {a.low.length > 0 && (
        <AlertSection title={t(T.wh_running_low_n, { n: a.low.length })} color="#ca8a04">
          {a.low.map((p) => <Row key={p.id} left={p.name} sub={p.sku} right={t(T.wh_qty_threshold, { q: p.qty, m: p.minQty })} rightColor="#ca8a04" />)}
        </AlertSection>
      )}
      {a.unmatched.length > 0 && (
        <AlertSection title={t(T.wh_unmatched_n, { n: a.unmatched.length })} color="var(--muted2)">
          <div style={{ fontSize: 12, color: "var(--muted2)", padding: "0 14px 8px" }}>{t(T.wh_unmatched_desc)}</div>
          {a.unmatched.map((u) => (
            <div key={u.offerId + (u.marketplace ?? "")} style={{ display: "flex", alignItems: "center", padding: "8px 14px", borderBottom: "1px solid var(--border2)", fontSize: 13, gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{u.name ?? u.offerId}</div>
                <div style={{ fontSize: 11, color: "var(--muted2)" }}>{t(T.wh_orders_pcs, { mkt: u.marketplace ?? "", n: u.orders, q: u.qty ?? 0 })}</div>
              </div>
              <button style={{ ...btn, padding: "4px 10px", fontSize: 12 }} onClick={() => addUnmatched(u.offerId, u.marketplace, u.name)}>{t(T.wh_add_btn)}</button>
            </div>
          ))}
        </AlertSection>
      )}
    </div>
  );
}

function AlertSection({ title, color, children }: { title: string; color: string; children: ReactNode }) {
  return (
    <div style={{ ...card, overflow: "hidden" }}>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border2)", fontWeight: 700, fontSize: 13, color, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: 4, background: color }} />{title}
      </div>
      {children}
    </div>
  );
}
function Row({ left, sub, right, rightColor }: { left: string; sub?: string; right: string; rightColor?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", padding: "8px 14px", borderBottom: "1px solid var(--border2)", fontSize: 13 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{left}</div>
        {sub && <div style={{ fontSize: 11, color: "var(--muted2)", fontFamily: "ui-monospace, monospace" }}>{sub}</div>}
      </div>
      <div style={{ fontWeight: 700, color: rightColor ?? "var(--text)", fontVariantNumeric: "tabular-nums" }}>{right}</div>
    </div>
  );
}

// ─── PODSUMOWANIE ─────────────────────────────────────────────────────────────
function DashboardTab() {
  const { t, lang } = useI18n();
  const [d, setD] = useState<Dashboard | null>(null);
  useEffect(() => { getDashboard().then(setD).catch(() => {}); }, []);
  if (!d) return <div style={{ color: "var(--muted2)" }}>{t(T.common_loading)}</div>;
  const locale = localeOf(lang);
  const amount = Number.parseFloat(d.stockValue.replace(/[\s\u00a0\u202f]/g, "").replace(",", "."));
  const formattedValue = `${fmtGrouped(Number.isFinite(amount) ? amount : 0, 2, locale)} ${d.currency}`;
  const sourceByDay = new Map(d.series.map((item) => [item.date, item]));
  const chartSeries = Array.from({ length: 30 }, (_, index) => {
    const date = new Date();
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - (29 - index));
    const key = date.toISOString().slice(0, 10);
    return sourceByDay.get(key) ?? { date: key, inbound: 0, outbound: 0 };
  });
  const maxBar = Math.max(1, ...chartSeries.map((s) => Math.max(s.inbound, s.outbound)));
  const formatInt = (value: number) => fmtGrouped(value, 0, locale);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <Stat label={t(T.wh_stock_value)} value={formattedValue} />
        <Stat label={t(T.wh_tab_products)} value={formatInt(d.products)} />
        <Stat label={t(T.wh_units_in_stock)} value={formatInt(d.units)} />
        <Stat label={t(T.wh_running_low)} value={formatInt(d.low)} color={d.low ? "#ca8a04" : undefined} />
        <Stat label={t(T.wh_out)} value={formatInt(d.out)} color={d.out ? "#dc2626" : undefined} />
        <Stat label={t(T.wh_sold_30)} value={formatInt(d.sold30)} />
      </div>

      <div style={{ ...card, padding: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text2)", marginBottom: 12 }}>{t(T.wh_movements)}</div>
        {d.series.length === 0 ? <div style={{ color: "var(--muted2)", fontSize: 13 }}>{t(T.wh_no_movements)}</div> : (
          <div style={{ height: 154, display: "flex", alignItems: "stretch", gap: 4, borderBottom: "1px solid var(--border2)", padding: "4px 2px 0" }}>
            {chartSeries.map((s, index) => (
              <div key={s.date} title={`${s.date}: +${s.inbound} / −${s.outbound}`} style={{ flex: 1, minWidth: 7, display: "flex", flexDirection: "column" }}>
                <div style={{ height: 126, display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 2 }}>
                  <div style={{ width: "42%", minWidth: 2, height: s.inbound > 0 ? Math.max(4, (s.inbound / maxBar) * 120) : 0, background: "#16a34a", borderRadius: "3px 3px 0 0" }} />
                  <div style={{ width: "42%", minWidth: 2, height: s.outbound > 0 ? Math.max(4, (s.outbound / maxBar) * 120) : 0, background: "#dc2626", borderRadius: "3px 3px 0 0" }} />
                </div>
                <div style={{ height: 22, paddingTop: 5, textAlign: "center", fontSize: 9, color: "var(--muted2)", whiteSpace: "nowrap" }}>
                  {(index === 0 || index === chartSeries.length - 1 || index % 5 === 4) ? new Date(`${s.date}T00:00:00Z`).toLocaleDateString(locale, { day: "2-digit", month: "2-digit" }) : ""}
                </div>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 16, marginTop: 10, fontSize: 11, color: "var(--muted2)" }}>
          <span><span style={{ display: "inline-block", width: 9, height: 9, background: "#16a34a", borderRadius: 2, marginRight: 5 }} />{t(T.wh_legend_deliveries)}</span>
          <span><span style={{ display: "inline-block", width: 9, height: 9, background: "#dc2626", borderRadius: 2, marginRight: 5 }} />{t(T.wh_legend_sales)}</span>
        </div>
      </div>

      <div style={{ ...card, overflow: "hidden" }}>
        <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border2)", fontWeight: 700, fontSize: 13 }}>{t(T.wh_bestsellers)}</div>
        {d.topSellers.length === 0 && <div style={{ padding: 14, color: "var(--muted2)", fontSize: 13 }}>{t(T.wh_no_sales)}</div>}
        {d.topSellers.map((seller, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", padding: "8px 14px", borderBottom: "1px solid var(--border2)", fontSize: 13 }}>
            <div style={{ width: 22, color: "var(--muted2)", fontWeight: 700 }}>{i + 1}.</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{seller.name}</div>
              <div style={{ fontSize: 11, color: "var(--muted2)", fontFamily: "ui-monospace, monospace" }}>{seller.sku}</div>
            </div>
            <div style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{t(T.wh_pcs_n, { n: seller.sold })}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ ...card, padding: "12px 14px" }}>
      <div style={{ fontSize: 11, color: "var(--muted2)" }}>{label}</div>
      <div style={{ fontSize: 21, fontWeight: 800, marginTop: 2, color: color ?? "var(--text)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{value}</div>
    </div>
  );
}
