import { useEffect, useMemo, useState } from "react";
import type { Order } from "../lib/types";
import { getDashboard } from "../lib/stockApi";
import { carrierLabel } from "../lib/carriers";
import { useI18n, T, localeOf, type TFn } from "../lib/i18n";
import { SlidersHorizontal } from "lucide-react";
import { getFxRates, convertAmount, type FxRates } from "../lib/fx";

// ─── Dashboard (styl Ordigo / YouTube Studio) — liczony z realnych zamówień.
// Główny panel: 4 metryki-zakładki (przychód / zamówienia / sztuki / śr. wartość),
// wybrana metryka steruje wykresem. Delta porównuje bieżący zakres z poprzednim
// okresem tej samej długości. Niski stan magazynu: dyskretny pasek ostrzeżenia.

const CHANNEL_LABEL: Record<string, string> = {
  allegro: "Allegro",
  erli: "Erli",
  amazon: "Amazon",
  ebay: "eBay",
  inpost_merchant: "InPost",
};
// Kanały tłumaczone (nie-marki) — reszta to nazwy własne.
const CHANNEL_KEY: Record<string, T> = { woocommerce: T.channel_own_store, shopify: T.channel_own_store };
function channelLabel(mkt: string | undefined, t: TFn) {
  if (!mkt) return t(T.channel_other);
  const k = mkt.toLowerCase();
  if (CHANNEL_KEY[k]) return t(CHANNEL_KEY[k]);
  return CHANNEL_LABEL[k] ?? mkt.charAt(0).toUpperCase() + mkt.slice(1);
}
// Kwota w wybranej walucie (Intl); nieznany kod ISO → liczba + kod.
function fmtMoney(n: number, locale: string, currency: string) {
  try {
    return n.toLocaleString(locale, { style: "currency", currency });
  } catch {
    return `${n.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
  }
}
function fmtChartAxis(n: number, locale: string, t: TFn) {
  if (n >= 1_000_000) {
    return t(T.dash_axis_mln, { v: (n / 1_000_000).toLocaleString(locale, { maximumFractionDigits: 1 }) });
  }
  return Math.round(n).toLocaleString(locale);
}
function fmtDayMonth(d: Date, locale: string) {
  return d.toLocaleDateString(locale, { day: "2-digit", month: "short" });
}
function dayKey(d: Date) {
  return d.toISOString().slice(0, 10);
}
function orderDate(o: Order): Date | null {
  if (!o.orderCreatedAt) return null;
  const d = new Date(o.orderCreatedAt);
  return isNaN(d.getTime()) ? null : d;
}
function accountLabel(o: Order) {
  return o.accountDisplayName || o.accountName || null;
}
// Popularne waluty e-commerce — do wyboru nawet bez zamówień w danej walucie.
const COMMON_CURRENCIES = ["PLN", "EUR", "USD", "GBP", "CZK", "SEK", "NOK", "DKK", "HUF", "RON", "BGN", "CHF", "UAH"];

const RANGES = [7, 30, 90] as const;
type Range = (typeof RANGES)[number];

// ── Metryki panelu głównego (styl YT Studio: karta = zakładka wykresu) ──
type MetricKey = "revenue" | "orders" | "units" | "aov";
type MetricData = { series: number[]; total: number; prev: number | null };
const METRICS: { key: MetricKey; labelKey: T; money: boolean }[] = [
  { key: "revenue", labelKey: T.dash_metric_revenue, money: true },
  { key: "orders", labelKey: T.dash_metric_orders, money: false },
  { key: "units", labelKey: T.dash_metric_units, money: false },
  { key: "aov", labelKey: T.dash_metric_aov, money: true },
];

// Delta vs poprzedni okres: ↑/↓/≈ + tekst (kierunek niesie glif, nie sam kolor).
function deltaInfo(total: number, prev: number | null, range: number, t: TFn): { text: string; color: string } {
  if (prev === null || prev === 0) return { text: t(T.dash_no_prev), color: "var(--muted)" };
  const pct = Math.round(((total - prev) / prev) * 100);
  if (Math.abs(pct) < 5) return { text: `≈ ${t(T.dash_about_same)}`, color: "var(--muted)" };
  if (pct > 0) return { text: `↑ ${t(T.dash_up_vs_prev, { p: pct, n: range })}`, color: "#4ade80" };
  return { text: `↓ ${t(T.dash_down_vs_prev, { p: Math.abs(pct), n: range })}`, color: "#f4515b" };
}

// Wymiar rozbicia sprzedaży (przeniesione ze „Statystyk"): kanał / kurier / konto.
type BreakdownBy = "channel" | "carrier" | "account";
const BREAKDOWN: { key: BreakdownBy; tabKey: T; nounKey: T }[] = [
  { key: "channel", tabKey: T.dash_by_channel, nounKey: T.dash_by_channel_noun },
  { key: "carrier", tabKey: T.dash_by_carrier, nounKey: T.dash_by_carrier_noun },
  { key: "account", tabKey: T.dash_by_account, nounKey: T.dash_by_account_noun },
];

export default function Dashboard({ orders }: { orders: Order[] }) {
  const { t, lang } = useI18n();
  const loc = localeOf(lang);
  const [range, setRange] = useState<Range>(30);
  const [metric, setMetric] = useState<MetricKey>("revenue");
  const [lowStock, setLowStock] = useState<number | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [breakdownBy, setBreakdownBy] = useState<BreakdownBy>("channel");
  // Filtry: kanały / konta (pusty zbiór = wszystkie) + waluta wyświetlania.
  // Kwoty w innych walutach są przeliczane po kursie NBP na wybraną walutę (lib/fx).
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selChannels, setSelChannels] = useState<Set<string>>(new Set());
  const [selAccounts, setSelAccounts] = useState<Set<string>>(new Set());
  const [currency, setCurrency] = useState<string>(() => localStorage.getItem("dashCurrency") ?? "");
  const [fx, setFx] = useState<FxRates | null>(null);

  const currencies = useMemo(() => {
    const cnt = new Map<string, number>();
    for (const o of orders) { const c = o.currency ?? "PLN"; cnt.set(c, (cnt.get(c) ?? 0) + 1); }
    return [...cnt.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  }, [orders]);
  const cur = currency || currencies[0] || "PLN";
  const extraCurrencies = COMMON_CURRENCIES.filter((c) => !currencies.includes(c));

  const toggleChannel = (k: string) => setSelChannels((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const toggleAccount = (k: string) => setSelAccounts((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const activeFilters = selChannels.size + selAccounts.size;

  useEffect(() => {
    getDashboard().then((d) => setLowStock(d.low)).catch(() => setLowStock(null));
    getFxRates().then(setFx).catch(() => setFx(null));
  }, []);

  const d = useMemo(() => {
    const now = new Date();
    const rangeStart = new Date(now.getTime() - (range - 1) * 86400000);
    rangeStart.setHours(0, 0, 0, 0);
    const prevStart = new Date(rangeStart.getTime() - range * 86400000);

    const live = orders.filter((o) => o.derivedStatus !== "anulowane");
    // Kwota zamówienia przeliczona na wybraną walutę (0, gdy brak kursu — rzadkie).
    const conv = (o: Order) => convertAmount(Number(o.totalToPay) || 0, o.currency ?? "PLN", cur, fx) ?? 0;
    const allRange: Order[] = [];
    const allPrev: Order[] = [];
    for (const o of live) {
      const od = orderDate(o);
      if (!od) continue;
      if (od >= rangeStart) allRange.push(o);
      else if (od >= prevStart) allPrev.push(o);
    }

    // Fasety do popovera filtrów — liczone przed zawężeniem (standardowe zachowanie filtrów).
    const chanCnt = new Map<string, number>();
    const acctCnt = new Map<string, { label: string; count: number }>();
    for (const o of allRange) {
      const mk = (o.marketplace ?? "").toLowerCase();
      chanCnt.set(mk, (chanCnt.get(mk) ?? 0) + 1);
      const ac = o.accountName ?? "";
      const label = accountLabel(o);
      if (ac && label) {
        const existing = acctCnt.get(ac);
        acctCnt.set(ac, { label, count: (existing?.count ?? 0) + 1 });
      }
    }
    const facetChannels = [...chanCnt.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, label: channelLabel(key, t), count }));
    const facetAccounts = [...acctCnt.entries()].sort((a, b) => b[1].count - a[1].count).map(([key, value]) => ({ key, label: value.label, count: value.count }));

    const pass = (o: Order) =>
      (selChannels.size === 0 || selChannels.has((o.marketplace ?? "").toLowerCase())) &&
      (selAccounts.size === 0 || selAccounts.has(o.accountName ?? ""));
    const inRange = allRange.filter(pass);
    const inPrev = allPrev.filter(pass);

    const unitsOf = (o: Order) => (o.items ?? []).reduce((s, it) => s + (Number(it.quantity ?? 1) || 0), 0);

    // Szeregi dzienne: przychód / liczba zamówień / sztuki (AOV pochodna).
    const seriesKeys: string[] = [];
    const idxOf = new Map<string, number>();
    for (let i = 0; i < range; i++) {
      const k = dayKey(new Date(rangeStart.getTime() + i * 86400000));
      idxOf.set(k, i);
      seriesKeys.push(k);
    }
    const revSeries = new Array<number>(range).fill(0);
    const ordSeries = new Array<number>(range).fill(0);
    const unitSeries = new Array<number>(range).fill(0);
    for (const o of inRange) {
      const od = orderDate(o);
      if (!od) continue;
      const i = idxOf.get(dayKey(od));
      if (i === undefined) continue;
      revSeries[i] += conv(o);
      ordSeries[i] += 1;
      unitSeries[i] += unitsOf(o);
    }
    const aovSeries = revSeries.map((v, i) => (ordSeries[i] ? v / ordSeries[i] : 0));

    // Sumy bieżące i poprzedniego okresu (delta na kartach).
    const revTotal = revSeries.reduce((a, b) => a + b, 0);
    const unitTotal = unitSeries.reduce((a, b) => a + b, 0);
    const prevRev = inPrev.reduce((a, o) => a + conv(o), 0);
    const prevUnits = inPrev.reduce((a, o) => a + unitsOf(o), 0);
    const hasPrev = inPrev.length > 0;

    const metrics: Record<MetricKey, MetricData> = {
      revenue: { series: revSeries, total: revTotal, prev: hasPrev ? prevRev : null },
      orders: { series: ordSeries, total: inRange.length, prev: hasPrev ? inPrev.length : null },
      units: { series: unitSeries, total: unitTotal, prev: hasPrev ? prevUnits : null },
      aov: {
        series: aovSeries,
        total: inRange.length ? revTotal / inRange.length : 0,
        prev: hasPrev ? prevRev / inPrev.length : null,
      },
    };

    // Sprzedaż wg wymiaru (kanał / kurier / konto) — z realnych zamówień.
    const mkBreakdown = (keyFn: (o: Order) => string | null) => {
      const m = new Map<string, number>();
      for (const o of inRange) {
        const k = keyFn(o);
        if (!k) continue;
        m.set(k, (m.get(k) ?? 0) + conv(o));
      }
      return [...m.entries()].map(([name, amt]) => ({ name, amt })).sort((a, b) => b.amt - a.amt);
    };
    const byChannel = mkBreakdown((o) => channelLabel(o.marketplace, t));
    const byCarrier = mkBreakdown((o) => carrierLabel(o.carrier, t));
    const byAccount = mkBreakdown(accountLabel);

    // Top produkty (przychód + sztuki)
    const byProduct = new Map<string, { name: string; sku: string; sold: number; revenue: number }>();
    for (const o of inRange) {
      const oc = o.currency ?? "PLN";
      for (const it of o.items ?? []) {
        const sku = it.externalOfferId ?? it.productName ?? "—";
        const qty = Number(it.quantity ?? 1);
        const price = convertAmount(Number(it.price ?? 0), oc, cur, fx) ?? 0;
        const ex = byProduct.get(sku);
        if (ex) { ex.sold += qty; ex.revenue += price * qty; }
        else byProduct.set(sku, { name: it.productName ?? "—", sku: it.externalOfferId ?? "—", sold: qty, revenue: price * qty });
      }
    }
    const topProducts = [...byProduct.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 5);

    return { seriesKeys, metrics, byChannel, byCarrier, byAccount, topProducts, facetChannels, facetAccounts };
  }, [orders, range, t, cur, selChannels, selAccounts, fx]);

  const selMeta = METRICS.find((m) => m.key === metric)!;
  const sel = d.metrics[metric];
  const fmtMetric = (v: number, money: boolean) => (money ? fmtMoney(v, loc, cur) : Math.round(v).toLocaleString(loc));

  // Aktywne rozbicie sprzedaży
  const breakdownRows = breakdownBy === "carrier" ? d.byCarrier : breakdownBy === "account" ? d.byAccount : d.byChannel;
  const breakdownTotal = breakdownRows.reduce((a, r) => a + r.amt, 0);
  const breakdownMax = Math.max(1, ...breakdownRows.map((r) => r.amt));
  const breakdownNoun = t(BREAKDOWN.find((b) => b.key === breakdownBy)?.nounKey ?? T.dash_by_channel_noun);

  // Punkty wykresu (area + line) — pełna szerokość panelu.
  const W = 1100, H = 150;
  // Szersza oś dla metryk pieniężnych — etykiety z kodem waluty (jak w YT Studio).
  const AXIS_W = selMeta.money ? 88 : 54;
  const SVG_W = W + AXIS_W;
  const max = Math.max(1, ...sel.series);
  const n = Math.max(1, sel.series.length - 1);
  const dots = sel.series.map((v, i) => ({
    x: AXIS_W + Math.round((i / n) * W),
    y: Math.round(H - (v / max) * (H - 12)),
  }));
  const linePts = dots.map((p) => `${p.x},${p.y}`).join(" ");
  const areaPts = `${AXIS_W},${H} ${linePts} ${AXIS_W + W},${H}`;
  const yTicks = [max, max / 2, 0].map((value) => ({
    value,
    y: H - (value / max) * (H - 12),
  }));
  const rangeStartLabel = d.seriesKeys.length ? fmtDayMonth(new Date(d.seriesKeys[0] + "T00:00:00"), loc) : "";
  const rangeEndLabel = d.seriesKeys.length ? fmtDayMonth(new Date(d.seriesKeys[d.seriesKeys.length - 1] + "T00:00:00"), loc) : "";

  return (
    <main style={{ flex: 1, overflow: "auto", padding: "28px 32px 60px" }}>
      <div style={{ maxWidth: 1360, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 18 }}>
          <div>
            <h2 style={{ margin: "0 0 4px" }}>{t(T.nav_dashboard)}</h2>
            <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>{t(T.dash_subtitle)}</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, position: "relative" }}>
            {/* Filtry: kanał / konto */}
            <button type="button" className="btn btn-secondary" onClick={() => setFiltersOpen((v) => !v)} aria-expanded={filtersOpen}
              style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}>
              <SlidersHorizontal size={13} />
              {t(T.dash_filters)}
              {activeFilters > 0 && <span className="seg-count">{activeFilters}</span>}
            </button>
            {/* Waluta agregacji */}
            <select className="input" aria-label={t(T.dash_currency)} value={cur}
              onChange={(e) => { setCurrency(e.target.value); localStorage.setItem("dashCurrency", e.target.value); }}
              style={{ width: "auto", fontSize: 12, padding: "7px 8px" }}>
              {currencies.length > 0 && (
                <optgroup label={t(T.dash_cur_in_orders)}>
                  {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
                </optgroup>
              )}
              <optgroup label={t(T.dash_cur_other)}>
                {extraCurrencies.map((c) => <option key={c} value={c}>{c}</option>)}
              </optgroup>
            </select>
            <div className="seg" role="radiogroup" aria-label={t(T.dash_last_n_days, { n: range })}>
              {RANGES.map((r) => (
                <label key={r} className="seg-opt">
                  <input type="radio" name="range" checked={range === r} onChange={() => setRange(r)} />
                  {t(T.dash_range_days, { n: r })}
                </label>
              ))}
            </div>

            {/* Popover filtrów */}
            {filtersOpen && (
              <>
                <div onClick={() => setFiltersOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
                <div className="card elev-sm" style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 41, width: 264, padding: 12, maxHeight: 400, overflowY: "auto" }}>
                  <div className="card-kicker" style={{ marginBottom: 4 }}>{t(T.dash_by_channel)}</div>
                  {d.facetChannels.map((c) => (
                    <label key={c.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 2px", fontSize: 13, cursor: "pointer" }}>
                      <input type="checkbox" checked={selChannels.has(c.key)} onChange={() => toggleChannel(c.key)} />
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.label}</span>
                      <span className="text-muted" style={{ fontSize: 11, fontVariantNumeric: "tabular-nums" }}>{c.count}</span>
                    </label>
                  ))}
                  <div className="card-kicker" style={{ margin: "10px 0 4px" }}>{t(T.dash_by_account)}</div>
                  {d.facetAccounts.map((a) => (
                    <label key={a.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 2px", fontSize: 13, cursor: "pointer" }}>
                      <input type="checkbox" checked={selAccounts.has(a.key)} onChange={() => toggleAccount(a.key)} />
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.label}</span>
                      <span className="text-muted" style={{ fontSize: 11, fontVariantNumeric: "tabular-nums" }}>{a.count}</span>
                    </label>
                  ))}
                  {activeFilters > 0 && (
                    <button type="button" className="btn btn-secondary" style={{ width: "100%", marginTop: 10, fontSize: 12 }}
                      onClick={() => { setSelChannels(new Set()); setSelAccounts(new Set()); }}>
                      {t(T.dash_clear_filters)}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Dyskretny pasek: niski stan magazynu (tylko gdy jest co pokazać) */}
        {lowStock !== null && lowStock > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 14px", borderRadius: "var(--radius-md)", border: "1px solid color-mix(in srgb, #ca8a04 35%, transparent)", background: "color-mix(in srgb, #ca8a04 7%, transparent)", color: "#ca8a04", fontSize: 12.5, marginBottom: 14 }}>
            <span style={{ width: 7, height: 7, borderRadius: 4, background: "#ca8a04", flexShrink: 0 }} />
            {t(T.dash_low_stock_alert, { n: lowStock })}
          </div>
        )}

        {/* ── Panel główny: metryki-zakładki + wykres (styl YT Studio) ── */}
        <div className="card elev-sm" style={{ padding: 0, overflow: "hidden", marginBottom: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${METRICS.length}, 1fr)`, borderBottom: "1px solid var(--color-divider)" }}>
            {METRICS.map((m, i) => {
              const md = d.metrics[m.key];
              const active = metric === m.key;
              const delta = deltaInfo(md.total, md.prev, range, t);
              return (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => { setMetric(m.key); setHoverIdx(null); }}
                  aria-pressed={active}
                  style={{
                    background: active ? "transparent" : "color-mix(in srgb, var(--color-text) 3.5%, transparent)",
                    border: "none",
                    borderRight: i < METRICS.length - 1 ? "1px solid var(--color-divider)" : "none",
                    boxShadow: active ? "inset 0 2px 0 var(--color-accent)" : "none",
                    padding: "14px 10px 12px",
                    cursor: "pointer",
                    textAlign: "center",
                    color: "var(--color-text)",
                  }}
                >
                  <div className="card-kicker" style={{ marginBottom: 4 }}>{t(m.labelKey)}</div>
                  <div style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: "tabular-nums", lineHeight: 1.15 }}>
                    {fmtMetric(md.total, m.money)}
                  </div>
                  <div style={{ fontSize: 11, marginTop: 4, color: delta.color }}>{delta.text}</div>
                </button>
              );
            })}
          </div>

          <div style={{ padding: "16px 18px 12px" }}>
            <svg viewBox={`0 0 ${SVG_W} 170`} style={{ width: "100%", height: 200, overflow: "visible" }} onMouseLeave={() => setHoverIdx(null)}>
              {/* pionowa oś wartości + poziome linie pomocnicze */}
              <line x1={AXIS_W} y1="12" x2={AXIS_W} y2={H} stroke="var(--color-divider)" strokeWidth="1" opacity="0.8" />
              {yTicks.map((tick, i) => (
                <g key={i}>
                  <line x1={AXIS_W - 5} y1={tick.y} x2={AXIS_W} y2={tick.y} stroke="var(--color-divider)" strokeWidth="1" opacity="0.9" />
                  <line x1={AXIS_W} y1={tick.y} x2={AXIS_W + W} y2={tick.y} stroke="var(--color-divider)" strokeWidth="1" opacity={i === yTicks.length - 1 ? 1 : 0.4} />
                  <text x={AXIS_W - 10} y={tick.y + 4} textAnchor="end" fontSize="10" fill="var(--muted)" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {fmtChartAxis(tick.value, loc, t)}{selMeta.money ? ` ${cur}` : ""}
                  </text>
                </g>
              ))}
              <polygon points={areaPts} fill="var(--chart-area)" opacity="0.4" />
              <polyline points={linePts} fill="none" stroke="var(--color-accent)" strokeWidth="2" />
              {/* pionowa miara + podświetlony punkt przy najechaniu */}
              {hoverIdx !== null && dots[hoverIdx] && (
                <>
                  <line x1={dots[hoverIdx].x} y1="12" x2={dots[hoverIdx].x} y2={H} stroke="var(--color-accent)" strokeWidth="1" strokeDasharray="3 3" opacity="0.7" />
                  <circle cx={dots[hoverIdx].x} cy={dots[hoverIdx].y} r="4.5" fill="var(--color-accent)" stroke="var(--color-bg)" strokeWidth="2" />
                </>
              )}
              {/* przezroczyste strefy trafień */}
              {dots.map((p, i) => {
                const band = W / Math.max(1, dots.length - 1);
                return <rect key={`h${i}`} x={p.x - band / 2} y="12" width={band} height={H - 12} fill="transparent" onMouseEnter={() => setHoverIdx(i)} style={{ cursor: "crosshair" }} />;
              })}
              {/* etykieta z datą i wartością wybranej metryki */}
              {hoverIdx !== null && dots[hoverIdx] && (() => {
                const px = Math.min(AXIS_W + W - 62, Math.max(AXIS_W + 62, dots[hoverIdx].x));
                const py = Math.max(30, dots[hoverIdx].y - 14);
                const dateLbl = d.seriesKeys[hoverIdx] ? fmtDayMonth(new Date(d.seriesKeys[hoverIdx] + "T00:00:00"), loc) : "";
                return (
                  <g transform={`translate(${px}, ${py})`} style={{ pointerEvents: "none" }}>
                    <rect x="-60" y="-30" width="120" height="34" rx="6" fill="var(--color-surface)" stroke="var(--color-divider)" />
                    <text x="0" y="-16" textAnchor="middle" fontSize="10" fill="var(--color-text)" opacity="0.6">{dateLbl}</text>
                    <text x="0" y="-3" textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--color-text)">
                      {fmtMetric(sel.series[hoverIdx], selMeta.money)}
                    </text>
                  </g>
                );
              })()}
            </svg>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, padding: "0 2px" }} className="text-muted">
              <span>{rangeStartLabel}</span>
              <span>{rangeEndLabel}</span>
            </div>
          </div>
        </div>

        {/* Rozbicie sprzedaży + top produkty */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr", gap: 14 }}>
          <div className="card elev-sm">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <div className="card-kicker">{t(T.dash_sales_by, { noun: breakdownNoun })}</div>
              <div className="seg" role="radiogroup" aria-label={t(T.dash_sales_by, { noun: breakdownNoun })}>
                {BREAKDOWN.map((b) => (
                  <label key={b.key} className="seg-opt" style={{ padding: "5px 9px", fontSize: 12 }}>
                    <input type="radio" name="breakdown" checked={breakdownBy === b.key} onChange={() => setBreakdownBy(b.key)} />{t(b.tabKey)}
                  </label>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 11, marginTop: 12 }}>
              {breakdownRows.length === 0 && <div className="text-muted" style={{ fontSize: 13 }}>{t(T.dash_no_data_range)}</div>}
              {breakdownRows.map((c) => {
                const share = breakdownTotal ? Math.round((c.amt / breakdownTotal) * 100) : 0;
                return (
                  <div key={c.name}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 5, gap: 8 }}>
                      <span className="tag tag-neutral" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 160 }}>{c.name}</span>
                      <span style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{fmtMoney(c.amt, loc, cur)} <span className="text-muted">· {share}%</span></span>
                    </div>
                    <div style={{ height: 6, borderRadius: 4, background: "var(--color-neutral-900)", overflow: "hidden" }}>
                      <div style={{ height: "100%", borderRadius: 4, background: "var(--color-accent)", width: `${Math.round((c.amt / breakdownMax) * 100)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Top produkty */}
          <div className="card elev-sm" style={{ alignSelf: "start" }}>
            <div className="card-kicker">{t(T.dash_top_products)}</div>
            <div style={{ overflowX: "auto" }}>
              <table className="table" style={{ width: "100%", tableLayout: "fixed" }}>
                <colgroup>
                  <col style={{ width: "46%" }} />
                  <col style={{ width: "18%" }} />
                  <col style={{ width: "16%" }} />
                  <col style={{ width: "20%" }} />
                </colgroup>
                <thead>
                  <tr>
                    <th style={{ paddingLeft: "var(--space-4)" }}>{t(T.dash_col_product)}</th>
                    <th>{t(T.dash_col_sku)}</th>
                    <th className="ord-th-num" style={{ textAlign: "center" }}>{t(T.dash_col_sold)}</th>
                    <th className="ord-th-num" style={{ paddingRight: "var(--space-4)", textAlign: "right" }}>{t(T.dash_col_revenue)}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.topProducts.length === 0 ? (
                    <tr><td colSpan={4} className="text-muted" style={{ padding: 24, textAlign: "center" }}>{t(T.dash_no_sales_range)}</td></tr>
                  ) : (
                    d.topProducts.map((p, i) => (
                      <tr key={i}>
                        <td style={{ paddingLeft: "var(--space-4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</td>
                        <td className="text-muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.sku}</td>
                        <td className="ord-td-num" style={{ textAlign: "center" }}>{p.sold}</td>
                        <td className="ord-td-num" style={{ paddingRight: "var(--space-4)" }}>{fmtMoney(p.revenue, loc, cur)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
