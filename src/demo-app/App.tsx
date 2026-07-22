import { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import type { Order, Account, OrderItem, DerivedStatus } from "./lib/types";
import { carrierLabel } from "./lib/carriers";
import ShipmentForm from "./components/ShipmentForm";
import StatusPath, { type StatusPathStep } from "./components/StatusPath";
import CourierPickup from "./pages/CourierPickup";
import Dashboard from "./pages/Dashboard";
import Settings from "./pages/Settings";
import StockCore from "./pages/StockCore";
import Offers from "./pages/Offers";
import Invoices from "./pages/Invoices";
import Returns from "./pages/Returns";
import Shipping from "./pages/Shipping";
import InvoiceEditorModal, { applyInvoiceSeller, rememberInvoiceSeller } from "./components/InvoiceEditorModal";
import InvoicePdfFrame from "./components/InvoicePdfFrame";
import { getInvoiceForOrder, invoiceDraftFromOrder, issueInvoice, saveInvoice, type Invoice, type SaveInvoice } from "./lib/commerceApi";
import { downloadInvoicePdf, printInvoicePdf } from "./lib/invoicePdf";
import AccountSettings from "./components/AccountSettings";
import ProductThumbs, { ItemThumb } from "./components/ProductThumbs";
import { Settings as SettingsIcon, Pencil, LogOut, ChevronLeft, ChevronDown, Check, RefreshCw, Printer, FileText, Eye, Download, LifeBuoy, AlertTriangle } from "lucide-react";
import { CommerceModal, CommercePagination } from "./components/CommerceUi";
import { AuthScreen, UpgradeScreen, VerificationScreen, ServerDownScreen } from "./pages/Account";
import { serverIsLoggedIn, serverLicense, serverLogout, serverCheckout, setCurrentUser, getCurrentUser, getIntegrations, refreshIntegrations, verificationStatus, checkUpdate, submitSupportRequest, type License, type Integration, type UpdateManifest } from "./lib/accountApi";
import { installUpdateOrOpen } from "./lib/updater";
import { messageKey, translateMessage, useI18n, T, localeOf, type TFn } from "./lib/i18n";
import { clearSyncProgress, OFFER_SYNC_PROGRESS_KEY, ORDER_SYNC_PROGRESS_KEY, readSyncProgress, syncProgressPercent, writeSyncProgress, type SyncProgressState, type SyncProgressStep, type SyncStepStatus } from "./lib/syncProgress";

// ─── KONFIGURACJA SEGMENTÓW / KURIERÓW ───────────────────────────────────────

const STATUS_KEY: Record<DerivedStatus, T> = {
  do_wyslania: T.status_do_wyslania,
  nieoplacone: T.status_nieoplacone,
  wyslane: T.status_wyslane,
  anulowane: T.status_anulowane,
  archiwum: T.status_archiwum,
};
const SEGMENTS: { key: DerivedStatus; dot: string }[] = [
  { key: "do_wyslania", dot: "var(--accent)" },
  { key: "nieoplacone", dot: "#ca8a04" },
  { key: "wyslane", dot: "#16a34a" },
  { key: "anulowane", dot: "#dc2626" },
  { key: "archiwum", dot: "var(--muted2)" },
];

// ─── HELPERY ─────────────────────────────────────────────────────────────────

function formatDate(iso?: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pl-PL", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function formatAmount(amount?: string, currency?: string) {
  if (!amount) return "—";
  return `${Number(amount).toFixed(2)} ${currency ?? "PLN"}`;
}
function buyerName(o: Order) {
  if (o.deliveryFirstName && o.deliveryLastName) return `${o.deliveryFirstName} ${o.deliveryLastName}`;
  if (o.buyerFirstName) return `${o.buyerFirstName} ${o.buyerLastName ?? ""}`.trim();
  return o.buyerLogin ?? "Nieznany";
}
function shortId(id: string) {
  return id.slice(0, 8).toUpperCase();
}

const ALLEGRO_WZA_PROVIDER = "allegro_wza";
const allegroShipmentIds = (order: Order) =>
  order.shipments.filter((shipment) => shipment.provider === ALLEGRO_WZA_PROVIDER).map((shipment) => shipment.id);

// ─── ETYKIETY KANAŁÓW / SORTOWANIE ───────────────────────────────────────────
const CHANNEL_LABEL: Record<string, string> = {
  allegro: "Allegro", erli: "Erli", amazon: "Amazon", ebay: "eBay", inpost_merchant: "InPost Merchant",
};
const CHANNEL_KEY: Record<string, T> = { woocommerce: T.channel_own_store, shopify: T.channel_own_store };
function channelLabel(mkt: string | undefined, t: TFn) {
  if (!mkt) return "—";
  const k = mkt.toLowerCase();
  if (CHANNEL_KEY[k]) return t(CHANNEL_KEY[k]);
  return CHANNEL_LABEL[k] ?? mkt.charAt(0).toUpperCase() + mkt.slice(1);
}
type ChannelOption = {
  value: string;
  platform: string;
  platformLabel: string;
  accountName: string;
  accountDisplayName: string;
  count: number;
};
function channelAccountKey(order: Order) {
  return `${(order.marketplace ?? "").toLowerCase()}::${order.accountName ?? ""}`;
}
function channelAccountLabel(order: Order) {
  return order.accountDisplayName || order.accountName || "Konto";
}
function orderTime(o: Order): number {
  return o.orderCreatedAt ? Date.parse(o.orderCreatedAt) : 0;
}

// ─── FILTRY PRZEWOŹNIKÓW (ogólne + szczegółowe) ───────────────────────────────
const NORMC = (s?: string) => (s ?? "").toUpperCase().replace(/[\s_-]/g, "");
type CourierDef = { id: string; label: string; carrier: string; method?: string };
const COURIER_CATALOG: CourierDef[] = [
  { id: "inpost", label: "InPost", carrier: "inpost" },
  { id: "inpost-paczkomat", label: "InPost Paczkomaty", carrier: "inpost", method: "paczkomat" },
  { id: "inpost-kurier", label: "InPost Kurier", carrier: "inpost", method: "kurier" },
  { id: "dpd", label: "DPD", carrier: "dpd" },
  { id: "dpd-kurier", label: "DPD Kurier", carrier: "dpd", method: "kurier" },
  { id: "dhl", label: "DHL", carrier: "dhl" },
  { id: "dhl-kurier", label: "DHL Kurier", carrier: "dhl", method: "kurier" },
  { id: "ups", label: "UPS", carrier: "ups" },
  { id: "orlen", label: "Orlen Paczka", carrier: "orlen" },
  { id: "poczta", label: "Poczta Polska", carrier: "poczta" },
];
const DEFAULT_COURIER_IDS = ["inpost", "dpd", "dhl", "ups", "orlen"];
function matchCourierDef(o: Order, def: CourierDef): boolean {
  if (NORMC(o.carrier) !== NORMC(def.carrier)) return false;
  if (def.method) return (o.deliveryMethodName ?? "").toLowerCase().includes(def.method);
  return true;
}

// ─── KOLUMNA „OZNACZENIA": ikony statusu (konfigurowalne) ──────────────────────
type IconKey = "paid" | "shipment" | "invoice";
type IconCols = Record<IconKey, boolean>;
const ICON_META: { key: IconKey; labelKey: T }[] = [
  { key: "paid", labelKey: T.markers_payment },
  { key: "shipment", labelKey: T.markers_shipment },
  { key: "invoice", labelKey: T.markers_invoice },
];

function trackingUrl(carrier: string, waybill: string): string | null {
  const w = encodeURIComponent(waybill);
  switch (carrier) {
    case "inpost": return `https://inpost.pl/sledzenie-przesylek?number=${w}`;
    case "dpd": return `https://tracktrace.dpd.com.pl/parcelDetails?p1=${w}`;
    case "dhl": return `https://www.dhl.com/pl-pl/home/tracking/tracking-parcel.html?submit=1&tracking-id=${w}`;
    case "ups": return `https://www.ups.com/track?tracknum=${w}`;
    case "orlen": return `https://nadaj.orlenpaczka.pl/sledzenie-przesylki?number=${w}`;
    default: return null;
  }
}

type ShipmentInfo = {
  id: string;
  carrier?: string;
  transport?: string[];
  createdDate?: string;
  canceled?: boolean;
  waybills?: string[];
  error?: string;
};
function mergeItems(items: OrderItem[]) {
  const map = new Map<string, OrderItem & { quantity: number }>();
  for (const i of items) {
    const key = i.externalOfferId ?? i.productName ?? Math.random().toString();
    const ex = map.get(key);
    if (ex) ex.quantity += Number(i.quantity ?? 1);
    else map.set(key, { ...i, quantity: Number(i.quantity ?? 1) });
  }
  return Array.from(map.values());
}

function StatusBadge({ status }: { status: DerivedStatus }) {
  const { t } = useI18n();
  // Etykiety statusów w stylu Nocturne (tagi), tak jak w makiecie Ordigo.
  const cfg: Record<DerivedStatus, { cls: string; strike?: boolean }> = {
    do_wyslania: { cls: "tag tag-accent" },
    nieoplacone: { cls: "tag tag-outline" },
    wyslane: { cls: "tag tag-neutral" },
    anulowane: { cls: "tag tag-neutral", strike: true },
    archiwum: { cls: "tag tag-neutral" },
  };
  const d = cfg[status];
  return (
    <span className={d.cls} style={d.strike ? { textDecoration: "line-through", opacity: 0.65 } : undefined}>
      {t(STATUS_KEY[status])}
    </span>
  );
}

// ─── WIERSZ ZAMÓWIENIA (klik → strona szczegółów) ──────────────────────────────

// Ikony statusu w wierszu zamówienia: dolar (płatność) + dostawczak (przesyłka).
function DollarIcon({ color }: { color: string }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1.5" x2="12" y2="22.5" />
      <path d="M17 5.5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}
function VanIcon({ color }: { color: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 4h13v11H1z" />
      <path d="M14 8h3.5L21 11.5V15h-7z" />
      <circle cx="5.5" cy="17.5" r="1.9" />
      <circle cx="17.5" cy="17.5" r="1.9" />
    </svg>
  );
}
function InvoiceIcon({ color }: { color: string }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2h8l4 4v16H6z" />
      <path d="M14 2v4h4" />
      <line x1="9" y1="12" x2="15" y2="12" />
      <line x1="9" y1="16" x2="15" y2="16" />
    </svg>
  );
}
function OrderMarkIcon({ iconKey, color }: { iconKey: IconKey; color: string }) {
  switch (iconKey) {
    case "paid":
      return <DollarIcon color={color} />;
    case "shipment":
      return <VanIcon color={color} />;
    case "invoice":
      return <InvoiceIcon color={color} />;
  }
}
function statusIconColors(order: Order) {
  // Dolar: zielony = opłacone, czerwony = nieopłacone, szary = anulowane.
  const paid = order.derivedStatus === "anulowane" ? "var(--border)" : order.derivedStatus === "nieoplacone" ? "#dc2626" : "#16a34a";
  // Dostawczak: zielony = są utworzone przesyłki, szary = brak.
  const hasShip = order.shipments.length > 0;
  const van = hasShip ? "#16a34a" : "var(--border)";
  const paidTitleKey = order.derivedStatus === "anulowane" ? T.status_anulowane : order.derivedStatus === "nieoplacone" ? T.status_nieoplacone : T.od_paid;
  // Faktura: zielony = klient zażądał faktury, szary = brak.
  const invoice = order.invoiceRequired ? "#16a34a" : "var(--border)";
  return {
    paid,
    van,
    invoice,
    paidTitleKey,
    vanTitleKey: hasShip ? T.od_ship_made : T.od_ship_none,
    invoiceTitleKey: order.invoiceRequired ? T.od_inv_req : T.od_inv_none,
  };
}

function OrderRow({ order, onOpen, cols }: { order: Order; onOpen: (o: Order) => void; cols: IconCols }) {
  const { t, lang } = useI18n();
  const loc = localeOf(lang);
  const amount = order.totalToPay ? `${Number(order.totalToPay).toFixed(2)} zł` : "—";
  const ic = statusIconColors(order);
  const dt = order.orderCreatedAt ? new Date(order.orderCreatedAt) : null;
  const carrierName = order.deliveryMethodName || carrierLabel(order.carrier, t) || "—";
  const open = () => onOpen(order);

  return (
    <tr className="ord-row-click" onClick={open}>
      <td style={{ paddingLeft: "var(--space-4)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
          <ProductThumbs items={order.items ?? []} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: "var(--font-heading)", color: "var(--accent)" }}>#{shortId(order.externalOrderId)}</div>
            <div className="text-muted" style={{ fontSize: 11 }}>
              {dt ? `${dt.toLocaleDateString(loc, { day: "2-digit", month: "short" })}, ${dt.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" })}` : "—"}
            </div>
          </div>
        </div>
      </td>
      <td>
        <div style={{ maxWidth: 200, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{buyerName(order)}</div>
        <div className="text-muted" style={{ fontSize: 11 }}>{order.deliveryCity ?? order.accountName ?? ""}</div>
      </td>
      <td>
        <div className="order-channel-cell">
          <PlatformLogo platform={order.marketplace} fallback={channelLabel(order.marketplace, t)} size={22} />
          <span className="order-channel-copy">
            <strong>{channelLabel(order.marketplace, t)}</strong>
            <small>{channelAccountLabel(order)}</small>
          </span>
        </div>
      </td>
      <td className="text-muted">{carrierName}</td>
      <td><StatusBadge status={order.derivedStatus} /></td>
      <td>
        <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
          {cols.paid && <span title={`${t(T.markers_payment)}: ${t(ic.paidTitleKey)}`} style={{ display: "flex" }}><DollarIcon color={ic.paid} /></span>}
          {cols.shipment && <span title={t(ic.vanTitleKey)} style={{ display: "flex" }}><VanIcon color={ic.van} /></span>}
          {cols.invoice && <span title={t(ic.invoiceTitleKey)} style={{ display: "flex" }}><InvoiceIcon color={ic.invoice} /></span>}
        </div>
      </td>
      <td className="ord-td-num" style={{ fontWeight: 700 }}>{amount}</td>
      <td style={{ paddingRight: "var(--space-4)", textAlign: "right" }}>
        <button type="button" className="btn btn-ghost" onClick={(e) => { e.stopPropagation(); open(); }}>{t(T.common_details)}</button>
      </td>
    </tr>
  );
}

// ── Wyzwalacz filtra przewoźnika: lista z licznikami + edytor filtrów ──
function CourierFilterSelect({ value, onChange, activeIds, setActiveIds, counts }: {
  value: string; onChange: (id: string) => void;
  activeIds: string[]; setActiveIds: (ids: string[]) => void;
  counts: Record<string, number>;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(false);
  const [q, setQ] = useState("");
  const activeDefs = COURIER_CATALOG.filter((d) => activeIds.includes(d.id));
  const current = value === "all" ? t(T.ord_courier_all) : (COURIER_CATALOG.find((d) => d.id === value)?.label ?? t(T.ord_courier_all));
  const catalog = COURIER_CATALOG.filter((d) => d.label.toLowerCase().includes(q.trim().toLowerCase()));
  const close = () => { setOpen(false); setEdit(false); setQ(""); };
  const toggle = (id: string) => setActiveIds(activeIds.includes(id) ? activeIds.filter((x) => x !== id) : [...activeIds, id]);

  return (
    <div style={{ position: "relative", width: 180 }}>
      <button type="button" className="ord-select-btn" onClick={() => setOpen((o) => !o)}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{current}</span>
        <ChevronDown size={15} style={{ opacity: 0.6, flex: "none" }} />
      </button>
      {open && (
        <>
          <div className="ord-acct-overlay" onClick={close} />
          <div className="ord-pop" style={{ top: "100%", right: 0, marginTop: 6 }}>
            {!edit ? (
              <>
                <button type="button" className="ord-pop-item" aria-selected={value === "all"} onClick={() => { onChange("all"); close(); }}>
                  {t(T.ord_courier_all)} <span className="ord-pop-count">{counts.all ?? 0}</span>
                </button>
                {activeDefs.map((d) => (
                  <button key={d.id} type="button" className="ord-pop-item" aria-selected={value === d.id} onClick={() => { onChange(d.id); close(); }}>
                    {d.label} <span className="ord-pop-count">{counts[d.id] ?? 0}</span>
                  </button>
                ))}
                <div className="ord-pop-divider" />
                <button type="button" className="ord-pop-item" style={{ color: "var(--accent)", fontWeight: 500 }} onClick={() => setEdit(true)}>
                  <Pencil size={13} /> {t(T.ord_courier_more)}
                </button>
              </>
            ) : (
              <>
                <div style={{ padding: "2px 4px 8px" }}>
                  <input className="input" autoFocus placeholder={t(T.ord_courier_search_ph)} value={q} onChange={(e) => setQ(e.target.value)} />
                </div>
                <div style={{ maxHeight: 240, overflowY: "auto" }}>
                  {catalog.map((d) => {
                    const on = activeIds.includes(d.id);
                    return (
                      <button key={d.id} type="button" className="ord-pop-item" onClick={() => toggle(d.id)}>
                        <span className={"ord-check" + (on ? " on" : "")}>{on && <Check size={11} strokeWidth={3} />}</span>
                        {d.label}
                      </button>
                    );
                  })}
                  {catalog.length === 0 && <div className="text-muted" style={{ padding: "8px 9px", fontSize: 12 }}>{t(T.ord_no_results)}</div>}
                </div>
                <div className="ord-pop-divider" />
                <button type="button" className="ord-pop-item" style={{ color: "var(--accent)", fontWeight: 500 }} onClick={() => { setEdit(false); setQ(""); }}>
                  <ChevronLeft size={13} /> {t(T.ord_done)}
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// Popover renderowany w portalu (position: fixed) — nie jest obcinany przez
// przewijanie tabeli (overflow-x na karcie). Pozycja liczona z kotwicy.
function PortalPopover({ anchor, onClose, align = "left", children }: { anchor: HTMLElement | null; onClose?: () => void; align?: "left" | "right"; children: React.ReactNode }) {
  if (!anchor) return null;
  const r = anchor.getBoundingClientRect();
  const style: React.CSSProperties = { position: "fixed", top: r.bottom + 6, zIndex: 60 };
  if (align === "right") style.right = window.innerWidth - r.right; else style.left = r.left;
  return createPortal(
    <>
      {onClose && <div className="ord-acct-overlay" style={{ zIndex: 59 }} onClick={onClose} />}
      <div className="ord-pop" style={style}>{children}</div>
    </>,
    document.body
  );
}

const LEGEND_ROWS: { iconKey: T; items: [string, T][] }[] = [
  { iconKey: T.markers_payment, items: [["#16a34a", T.legend_paid], ["#dc2626", T.legend_unpaid], ["var(--muted2)", T.legend_cancelled_none]] },
  { iconKey: T.markers_shipment, items: [["#16a34a", T.legend_shipment_made], ["var(--muted2)", T.legend_none]] },
  { iconKey: T.markers_invoice, items: [["#16a34a", T.legend_invoice_required], ["var(--muted2)", T.legend_none]] },
];

// ── Nagłówek kolumny „Oznaczenia": nazwa + edycja widocznych ikon + legenda ──
function IconColHeader({ cols, setCols }: { cols: IconCols; setCols: (c: IconCols) => void }) {
  const { t } = useI18n();
  const [edit, setEdit] = useState(false);
  const [legend, setLegend] = useState(false);
  const editRef = useRef<HTMLButtonElement>(null);
  const qRef = useRef<HTMLSpanElement>(null);
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      {t(T.ord_col_markers)}
      <button ref={editRef} type="button" onClick={() => setEdit((e) => !e)} title={t(T.markers_choose)}
        style={{ border: "none", background: "transparent", color: "var(--muted)", cursor: "pointer", padding: 0, display: "flex" }}>
        <Pencil size={12} />
      </button>
      <span ref={qRef} style={{ display: "inline-flex" }} onMouseEnter={() => setLegend(true)} onMouseLeave={() => setLegend(false)}>
        <span style={{ width: 14, height: 14, borderRadius: "50%", border: "1px solid var(--color-divider)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "var(--muted)", cursor: "help" }}>?</span>
      </span>
      {legend && (
        <PortalPopover anchor={qRef.current}>
          <div style={{ minWidth: 200 }}>
            <div style={{ fontSize: 11, fontWeight: 600, padding: "2px 6px 6px" }}>{t(T.legend_title)}</div>
            {LEGEND_ROWS.map((row) => (
              <div key={row.iconKey} style={{ padding: "3px 6px 5px" }}>
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 3 }}>{t(row.iconKey)}</div>
                {row.items.map(([c, txtKey], i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "1px 0" }}>
                    <span style={{ width: 9, height: 9, borderRadius: "50%", background: c, flex: "none" }} />
                    {t(txtKey)}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </PortalPopover>
      )}
      {edit && (
        <PortalPopover anchor={editRef.current} onClose={() => setEdit(false)}>
          <div style={{ minWidth: 190 }}>
            {ICON_META.map((m) => {
              const on = cols[m.key];
              return (
                <button key={m.key} type="button" className="ord-pop-item" onClick={() => setCols({ ...cols, [m.key]: !on })}>
                  <span className={"ord-check" + (on ? " on" : "")}>{on && <Check size={11} strokeWidth={3} />}</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
                    <OrderMarkIcon iconKey={m.key} color={on ? "#16a34a" : "var(--border)"} />
                    <span style={{ color: "var(--text)" }}>{t(m.labelKey)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </PortalPopover>
      )}
    </div>
  );
}

// ─── STRONA SZCZEGÓŁÓW ZAMÓWIENIA ──────────────────────────────────────────────

function Field({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13, padding: "3px 0" }}>
      <span className="text-muted">{label}</span>
      <span style={{ textAlign: "right", color: "var(--text)" }}>{value}</span>
    </div>
  );
}
// Karta „Klient" z edytowalnym adresem dostawy. Zapis idzie do lokalnej bazy
// (tabela delivery, z której budowane są etykiety), więc poprawki trafiają na przesyłkę.
function ClientCard({ order, onSaved }: { order: Order; onSaved: () => void }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const blank = {
    firstName: order.deliveryFirstName ?? "", lastName: order.deliveryLastName ?? "",
    company: order.deliveryCompany ?? "", street: order.deliveryStreet ?? "",
    zipCode: order.deliveryZipCode ?? "", city: order.deliveryCity ?? "",
    country: order.deliveryCountry ?? "", phone: order.deliveryPhone ?? "",
  };
  const [f, setF] = useState(blank);
  const start = () => { setF(blank); setEditing(true); };
  const save = async () => {
    setBusy(true);
    try {
      await invoke("update_order_delivery", { request: { orderId: order.id, ...f } });
      setEditing(false);
      onSaved();
    } catch (e) {
      alert(`${t(T.od_addr_save_fail)}: ${translateMessage(e, t)}`);
    } finally {
      setBusy(false);
    }
  };
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  const addrLines = [
    order.deliveryCompany,
    order.deliveryStreet,
    [order.deliveryZipCode, order.deliveryCity].filter(Boolean).join(" "),
    order.deliveryCountry,
  ].filter(Boolean);

  return (
    <div className="card elev-sm">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div className="card-kicker">{t(T.ord_col_client)}</div>
        {!editing && (
          <button type="button" onClick={start} className="btn btn-ghost" style={{ fontSize: 12, gap: 5, padding: "2px 6px" }}>
            <Pencil size={13} /> {t(T.common_edit)}
          </button>
        )}
      </div>
      {editing ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
          <div style={{ display: "flex", gap: 6 }}>
            <input className="input" placeholder={t(T.auth_first_name)} value={f.firstName} onChange={set("firstName")} />
            <input className="input" placeholder={t(T.auth_last_name)} value={f.lastName} onChange={set("lastName")} />
          </div>
          <input className="input" placeholder={t(T.auth_company)} value={f.company} onChange={set("company")} />
          <input className="input" placeholder={t(T.addr_street)} value={f.street} onChange={set("street")} />
          <div style={{ display: "flex", gap: 6 }}>
            <input className="input" placeholder={t(T.addr_zip)} value={f.zipCode} onChange={set("zipCode")} style={{ maxWidth: 90 }} />
            <input className="input" placeholder={t(T.addr_city)} value={f.city} onChange={set("city")} />
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <input className="input" placeholder={t(T.addr_country)} value={f.country} onChange={set("country")} style={{ maxWidth: 90 }} />
            <input className="input" placeholder={t(T.auth_phone)} value={f.phone} onChange={set("phone")} />
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>{busy ? t(T.od_saving) : t(T.common_save)}</button>
            <button type="button" className="btn btn-secondary" onClick={() => setEditing(false)} disabled={busy}>{t(T.common_cancel)}</button>
          </div>
        </div>
      ) : (
        <>
          <div className="card-title">{buyerName(order)}</div>
          <div style={{ fontSize: 13, color: "var(--text2)" }}>
            {order.buyerEmail && <div>{order.buyerEmail}</div>}
            {(order.deliveryPhone || order.buyerPhone) && <div>{order.deliveryPhone || order.buyerPhone}</div>}
          </div>
          <div style={{ borderTop: "1px solid var(--color-divider)", marginTop: 8, paddingTop: 8, display: "flex", flexDirection: "column", gap: 2, fontSize: 13, color: "var(--muted)" }}>
            <span style={{ color: "var(--text)" }}>{`${order.deliveryFirstName ?? ""} ${order.deliveryLastName ?? ""}`.trim() || "—"}</span>
            {addrLines.map((l, i) => <span key={i}>{l}</span>)}
          </div>
        </>
      )}
    </div>
  );
}

function orderStatusPath(order: Order, lang: string): StatusPathStep[] {
  const text = lang === "en"
    ? {
        ordered: "Ordered",
        paid: "Paid",
        packing: "To ship",
        created: "Dispatched",
        transit: "In transit",
        pickup: "Pickup",
        delivered: "Delivered",
        canceled: "Canceled",
        issue: "Issue",
      }
    : {
        ordered: "Zamówione",
        paid: "Opłacone",
        packing: "Do wysyłki",
        created: "Nadane",
        transit: "W drodze",
        pickup: "Do odbioru",
        delivered: "Doręczone",
        canceled: "Anulowane",
        issue: "Problem",
      };
  const shipments = order.shipments ?? [];
  const statuses = shipments.map((shipment) => String(shipment.status ?? "").toUpperCase());
  const failed = statuses.some((status) => status === "FAILED" || status === "CANCELED");
  const paid = Boolean(order.paymentFinishedAt) || !["nieoplacone", "anulowane"].includes(order.derivedStatus);
  const shipped = shipments.length > 0 || order.derivedStatus === "wyslane" || order.derivedStatus === "archiwum";

  if (order.derivedStatus === "anulowane") {
    const labels = [text.ordered, text.paid, text.packing, text.canceled];
    const current = paid ? 3 : 1;
    return labels.map((label, index) => ({
      key: label,
      label,
      state: index < current ? "done" : index === current ? "issue" : "pending",
    }));
  }

  if (failed) {
    const labels = [text.ordered, text.paid, text.created, text.issue];
    return labels.map((label, index) => ({
      key: label,
      label,
      state: index < 3 ? "done" : index === 3 ? "issue" : "pending",
    }));
  }

  let current = 0;
  if (paid) current = 2;
  if (shipped) current = 3;
  if (statuses.includes("IN_TRANSIT")) current = 4;
  if (statuses.includes("READY_FOR_PICKUP")) current = 5;
  if (statuses.includes("DELIVERED")) current = 6;

  const labels = [text.ordered, text.paid, text.packing, text.created, text.transit, text.pickup, text.delivered];
  return labels.map((label, index) => ({
    key: label,
    label,
    state: index < current ? "done" : index === current ? "current" : "pending",
  }));
}

function OrderDetail({
  order,
  onBack,
  onRefresh,
  printers,
  defaultPrinter,
  inpostConnected,
}: {
  order: Order;
  onBack: () => void;
  onRefresh: () => void;
  printers: string[];
  defaultPrinter: string;
  inpostConnected: boolean;
}) {
  const { t, lang } = useI18n();
  // Lokalny status kanoniczny decyduje, czy zamówienie można oznaczyć jako wysłane.
  const canMarkSent = order.derivedStatus !== "wyslane" && order.derivedStatus !== "anulowane";
  const items = useMemo(() => mergeItems(order.items), [order.items]);
  const allegroIds = useMemo(() => allegroShipmentIds(order), [order.shipments]);
  const carrierShipments = useMemo(
    () => order.shipments.filter((shipment) => shipment.provider !== ALLEGRO_WZA_PROVIDER),
    [order.shipments],
  );

  const [shipments, setShipments] = useState<ShipmentInfo[]>([]);
  const [shipLoading, setShipLoading] = useState(false);
  const [invoiceDraft, setInvoiceDraft] = useState<SaveInvoice | null>(null);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [invoiceBusy, setInvoiceBusy] = useState(false);
  const [invoiceMessage, setInvoiceMessage] = useState("");
  const [invoicePreview, setInvoicePreview] = useState(false);

  async function prepareInvoice() {
    setInvoiceBusy(true); setInvoiceMessage("");
    try { setInvoiceDraft(applyInvoiceSeller(await invoiceDraftFromOrder(order.id))); }
    catch (error) { setInvoiceMessage(translateMessage(error, t)); }
    finally { setInvoiceBusy(false); }
  }

  async function loadInvoice() {
    try { setInvoice(await getInvoiceForOrder(order.id)); }
    catch (error) { setInvoiceMessage(translateMessage(error, t)); }
  }

  async function createInvoice() {
    if (!invoiceDraft) return;
    setInvoiceBusy(true); setInvoiceMessage("");
    try {
      const id = await saveInvoice(invoiceDraft);
      const result = await issueInvoice(id);
      rememberInvoiceSeller(invoiceDraft);
      setInvoiceDraft(null);
      await loadInvoice();
      const created = t(T.od_invoice_created).replace("{number}", result.invoiceNumber);
      setInvoiceMessage(result.warningCode ? `${created} · ${t(T.invoice_ksef_not_sent)}` : created);
    } catch (error) { setInvoiceMessage(translateMessage(error, t)); }
    finally { setInvoiceBusy(false); }
  }

  async function downloadInvoice() {
    if (!invoice) return;
    setInvoiceBusy(true); setInvoiceMessage("");
    try { await downloadInvoicePdf(invoice); }
    catch (error) { setInvoiceMessage(translateMessage(error, t)); }
    finally { setInvoiceBusy(false); }
  }

  async function printInvoice() {
    if (!invoice) return;
    setInvoiceBusy(true); setInvoiceMessage("");
    try { await printInvoicePdf(invoice, defaultPrinter); }
    catch (error) { setInvoiceMessage(translateMessage(error, t)); }
    finally { setInvoiceBusy(false); }
  }

  async function loadShipments() {
    if (allegroIds.length === 0) {
      setShipments([]);
      return;
    }
    setShipLoading(true);
    try {
      setShipments(await invoke<ShipmentInfo[]>("get_shipments_info", { login: order.accountName, shipmentIds: allegroIds }));
    } catch (e) {
      console.error("get_shipments_info", e);
    } finally {
      setShipLoading(false);
    }
  }
  useEffect(() => {
    loadShipments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id, allegroIds.join("|")]);
  useEffect(() => { void loadInvoice(); }, [order.id]);

  async function downloadLabel(id: string) {
    try {
      const path = await invoke<string>("get_label", { login: order.accountName, shipmentIds: [id], pageSize: "A6", fileName: `${order.externalOrderId}_${id.slice(0, 8)}` });
      await invoke("open_file", { path });
    } catch (e) {
      alert(`${t(T.od_label_fail)}: ${translateMessage(e, t)}`);
    }
  }
  async function track(carrier: string, waybill: string) {
    const url = trackingUrl(carrier, waybill);
    if (url) await invoke("open_url", { url });
  }
  async function openLabelPath(path: string) {
    try {
      await invoke("open_file", { path });
    } catch (e) {
      alert(`${t(T.od_label_open_fail)}: ${translateMessage(e, t)}`);
    }
  }
  async function printLabel(id: string) {
    try {
      const path = await invoke<string>("get_label", { login: order.accountName, shipmentIds: [id], pageSize: "A6", fileName: `${order.externalOrderId}_${id.slice(0, 8)}` });
      await invoke("print_label", { pdfPath: path, printerName: defaultPrinter || null });
    } catch (e) {
      alert(`${t(T.od_print_fail)}: ${translateMessage(e, t)}`);
    }
  }
  async function printLabelPath(path: string) {
    try {
      await invoke("print_label", { pdfPath: path, printerName: defaultPrinter || null });
    } catch (e) {
      alert(`${t(T.od_print_fail)}: ${translateMessage(e, t)}`);
    }
  }
  async function markSent() {
    if (!confirm(t(T.od_mark_sent_confirm))) return;
    try {
      await invoke("mark_order_sent", { login: order.accountName, orderId: order.externalOrderId, orderDbId: order.id });
      onRefresh();
    } catch (e) {
      alert(`${t(T.od_mark_sent_fail)}: ${translateMessage(e, t)}`);
    }
  }
  async function cancel(id: string) {
    if (!confirm(t(T.od_cancel_confirm))) return;
    try {
      await invoke("cancel_shipment", { login: order.accountName, shipmentId: id, orderId: order.externalOrderId, orderDbId: order.id });
      await loadShipments();
      onRefresh();
    } catch (e) {
      const s = String(e);
      if (s.includes("CARRIER_OPERATION_UNSUPPORTED")) {
        alert(t(T.od_cancel_unsupported));
      } else {
        alert(`${t(T.od_cancel_fail)}: ${translateMessage(e, t)}`);
      }
    }
  }
  const subtotal = items.reduce((a, it) => a + Number(it.price ?? 0) * Number(it.quantity ?? 1), 0);
  const shipCost = Number(order.deliveryCost ?? 0);
  const cur = order.currency ?? "PLN";
  const fmtPln = (n: number) => `${n.toFixed(2)} ${cur}`;
  const isPaid = order.derivedStatus !== "nieoplacone" && order.derivedStatus !== "anulowane";
  const paidVal = order.paymentAmount != null && order.paymentAmount !== "" ? Number(order.paymentAmount) : null;
  const hasLabel = order.shipments.length > 0;
  const carrierLbl = carrierLabel(order.carrier, t) ?? "—";
  const history: { label: string; date?: string }[] = [{ label: t(T.od_hist_created), date: order.orderCreatedAt }];
  if (order.paymentFinishedAt) history.push({ label: t(T.od_hist_paid), date: order.paymentFinishedAt });
  if (order.derivedStatus === "wyslane") history.push({ label: t(T.od_hist_shipped), date: order.externalUpdatedAt });
  if (order.derivedStatus === "anulowane") history.push({ label: t(T.od_hist_cancelled), date: order.externalUpdatedAt });

  return (<>
    <main style={{ flex: 1, overflow: "auto", padding: "28px 32px 60px" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        {/* Powrót */}
        <span className="ord-navlink" style={{ paddingLeft: 0 }} onClick={onBack}>
          <ChevronLeft size={14} style={{ verticalAlign: -2, marginRight: 4 }} />{t(T.od_back)}
        </span>

        {/* Nagłówek */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "14px 0 22px", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0 }}>#{shortId(order.externalOrderId)}</h2>
            <StatusBadge status={order.derivedStatus} />
            <span className="tag tag-neutral">{channelLabel(order.marketplace, t)}</span>
            <span className="text-muted" style={{ fontSize: 12 }}>{order.orderCreatedAt ? formatDate(order.orderCreatedAt) : ""}</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {canMarkSent && <button type="button" className="btn btn-primary" onClick={markSent}>{t(T.od_mark_sent)}</button>}
          </div>
        </div>

        <StatusPath steps={orderStatusPath(order, lang)} className="order-status-path" />

        <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr", gap: 16, alignItems: "start" }}>
          {/* LEWA KOLUMNA */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
            {/* Pozycje zamówienia */}
            <div className="card elev-sm">
              <div className="card-kicker">{t(T.od_items)}</div>
              <div style={{ overflowX: "auto" }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t(T.dash_col_product)}</th>
                      <th>{t(T.dash_col_sku)}</th>
                      <th className="ord-th-num">{t(T.od_col_qty)}</th>
                      <th className="ord-th-num">{t(T.od_col_price)}</th>
                      <th className="ord-th-num">{t(T.od_col_total)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, i) => (
                      <tr key={i}>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                            <ItemThumb item={it} />
                            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{it.productUrl ? <a href={it.productUrl} target="_blank" style={{ color: "var(--text)", textDecoration: "none" }}>{it.productName}</a> : (it.productName ?? "—")}</span>
                          </div>
                        </td>
                        <td className="text-muted" style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}>{it.externalOfferId ?? "—"}</td>
                        <td className="ord-td-num">{it.quantity}</td>
                        <td className="ord-td-num">{formatAmount(it.price, it.currency)}</td>
                        <td className="ord-td-num">{fmtPln(Number(it.price ?? 0) * Number(it.quantity ?? 1))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ borderTop: "1px solid var(--color-divider)", marginTop: 6, paddingTop: 12, display: "flex", flexDirection: "column", gap: 6, width: 260, marginLeft: "auto", fontSize: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span className="text-muted">{t(T.od_subtotal)}</span><span>{fmtPln(subtotal)}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span className="text-muted">{t(T.od_delivery)}</span><span>{fmtPln(shipCost)}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--font-heading)", fontSize: 17 }}><span>{t(T.od_total)}</span><span>{formatAmount(order.totalToPay, order.currency)}</span></div>
              </div>
            </div>

            {/* Przesyłki + formularz nadania */}
            <div className="card elev-sm">
              <div className="card-kicker">{t(T.od_shipments)}</div>

              {carrierShipments.length > 0 && (
                <div style={{ overflowX: "auto" }}>
                  <table className="table">
                    <thead><tr><th>{t(T.od_col_carrier)}</th><th>{t(T.od_col_waybill)}</th><th>{t(T.ord_col_status)}</th><th className="ord-th-num">{t(T.od_col_actions)}</th></tr></thead>
                    <tbody>
                      {carrierShipments.map((s) => {
                        const tracking = s.trackingNumber ?? "";
                        const carrier = s.carrier ?? order.carrier;
                        const url = tracking ? trackingUrl(carrier, tracking) : null;
                        return (
                          <tr key={s.id}>
                            <td>{s.provider === "erli" ? t(T.od_ship_erli) : s.provider === "inpost_merchant" ? t(T.od_ship_inpost_merchant) : s.provider === "inpost_shipx" ? t(T.od_ship_shipx) : (s.carrier ?? s.provider)}</td>
                            <td style={{ fontFamily: "ui-monospace, monospace", color: "var(--accent)" }}>{tracking || "—"}</td>
                            <td style={{ color: "#4ade80" }}>{t(T.od_ship_sent)}</td>
                            <td style={{ textAlign: "right" }}>
                              <div style={{ display: "inline-flex", gap: 6 }}>
                                {url && <button type="button" onClick={() => track(carrier, tracking)} style={miniBtn}>{t(T.od_track)}</button>}
                                {s.labelPath && <button type="button" onClick={() => openLabelPath(s.labelPath!)} style={miniBtn}><FileText size={13} />{t(T.od_label)}</button>}
                                {s.labelPath && <button type="button" onClick={() => printLabelPath(s.labelPath!)} style={miniBtn}><Printer size={13} />{t(T.od_print)}</button>}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {order.shipments.length === 0 ? (
                <div className="text-muted" style={{ fontSize: 13, padding: "6px 0" }}>{t(T.od_no_shipments)}</div>
              ) : allegroIds.length === 0 ? null : (
                <div style={{ overflowX: "auto", marginTop: carrierShipments.length > 0 ? 12 : 0 }}>
                  <table className="table">
                    <thead><tr><th>{t(T.od_col_date)}</th><th>{t(T.od_col_carrier)}</th><th>{t(T.od_col_waybill)}</th><th>{t(T.ord_col_status)}</th><th className="ord-th-num">{t(T.od_col_actions)}</th></tr></thead>
                    <tbody>
                      {shipLoading && <tr><td colSpan={5} className="text-muted" style={{ fontSize: 12 }}>{t(T.od_ship_loading)}</td></tr>}
                      {shipments.map((s) => {
                        const waybill = s.waybills?.[0];
                        const carrierName = s.carrier ?? s.transport?.[0] ?? carrierLabel(order.carrier, t) ?? "—";
                        const url = waybill ? trackingUrl(order.carrier, waybill) : null;
                        return (
                          <tr key={s.id}>
                            <td className="text-muted" style={{ fontSize: 12 }}>{s.createdDate ? formatDate(s.createdDate) : "—"}</td>
                            <td>{carrierName}</td>
                            <td style={{ fontFamily: "ui-monospace, monospace", color: waybill ? "var(--accent)" : "var(--muted2)" }}>{waybill ?? "—"}</td>
                            <td style={{ color: s.canceled ? "#f4515b" : "#4ade80" }}>{s.canceled ? t(T.od_ship_cancelled) : t(T.od_ship_registered)}</td>
                            <td style={{ textAlign: "right" }}>
                              <div style={{ display: "inline-flex", gap: 6 }}>
                                {url && !s.canceled && <button type="button" onClick={() => track(order.carrier, waybill!)} style={miniBtn}>{t(T.od_track)}</button>}
                                {!s.canceled && <button type="button" onClick={() => downloadLabel(s.id)} style={miniBtn}><FileText size={13} />{t(T.od_label)}</button>}
                                {!s.canceled && <button type="button" onClick={() => printLabel(s.id)} style={miniBtn}><Printer size={13} />{t(T.od_print)}</button>}
                                {!s.canceled && <button type="button" onClick={() => cancel(s.id)} style={{ ...miniBtn, color: "#f4515b" }}>{t(T.common_cancel)}</button>}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {order.derivedStatus !== "anulowane" && (
                <div style={{ marginTop: 12 }}>
                  <ShipmentForm order={order} printers={printers} defaultPrinter={defaultPrinter} inpostConnected={inpostConnected} onChanged={onRefresh} />
                </div>
              )}
            </div>
          </div>

          {/* PRAWA KOLUMNA */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
            <ClientCard order={order} onSaved={onRefresh} />

            {/* Wysyłka */}
            <div className="card elev-sm">
              <div className="card-kicker">{t(T.od_shipping)}</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 2 }}>
                <span className="tag tag-neutral">{carrierLbl}</span>
                <span className={hasLabel ? "tag tag-neutral" : "tag tag-outline"}>{hasLabel ? t(T.od_label_issued) : t(T.od_label_none)}</span>
              </div>
              {order.deliveryMethodName && <div className="text-muted" style={{ fontSize: 12, marginTop: 6 }}>{order.deliveryMethodName}</div>}
            </div>

            {/* Płatność i faktura */}
            <div className="card elev-sm">
              <div className="card-kicker">{t(T.od_payment_invoice)}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4, fontSize: 13 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span className="text-muted">{t(T.od_method)}</span><span style={{ textAlign: "right" }}>{order.paymentProvider ?? order.paymentType ?? "—"}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span className="text-muted">{t(T.od_payment)}</span><span className={isPaid ? "tag tag-neutral" : "tag tag-outline"}>{isPaid ? t(T.od_paid) : t(T.status_nieoplacone)}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span className="text-muted">{t(T.od_invoice)}</span><span className={order.invoiceRequired ? "tag tag-neutral" : "tag tag-outline"}>{order.invoiceRequired ? t(T.od_invoice) : t(T.od_receipt)}</span></div>
              </div>
              <div style={{ borderTop: "1px solid var(--color-divider)", marginTop: 10, paddingTop: 10, display: "flex", flexDirection: "column", gap: 5, fontSize: 13 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span className="text-muted">{t(T.od_products_value)}</span><span>{fmtPln(Math.max(0, Number(order.totalToPay ?? 0) - shipCost))}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span className="text-muted">{t(T.markers_shipment)}</span><span>{fmtPln(shipCost)}</span></div>
                {paidVal !== null && <div style={{ display: "flex", justifyContent: "space-between" }}><span className="text-muted">{t(T.od_paid_amount)}</span><span>{fmtPln(paidVal)}</span></div>}
              </div>
            </div>

            {/* Dane do faktury */}
            <div className="card elev-sm">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}><div className="card-kicker">{t(T.od_invoice_details)}</div>{invoice ? <span className="tag tag-neutral">{invoice.invoiceNumber ?? t(T.invoice_draft_number)}</span> : <button type="button" className="btn btn-primary" disabled={invoiceBusy} onClick={prepareInvoice}><FileText size={14} />{t(T.od_create_invoice)}</button>}</div>
              {invoiceMessage && <div className="commerce-alert" style={{ marginTop: 10 }}>{invoiceMessage}</div>}
              {invoice && <div className="invoice-order-document">
                <div><strong>{invoice.documentType === "CORRECTION" ? t(T.invoice_type_correction) : t(T.invoice_type_sales)}</strong><span>{invoice.status} | KSeF {invoice.ksefStatus}</span></div>
                <div className="commerce-actions"><button type="button" className="btn btn-ghost btn-icon" title="Podglad PDF" onClick={() => setInvoicePreview(true)}><Eye size={15} /></button><button type="button" className="btn btn-ghost btn-icon" title="Pobierz PDF" disabled={invoiceBusy} onClick={() => void downloadInvoice()}><Download size={15} /></button><button type="button" className="btn btn-ghost btn-icon" title="Drukuj" disabled={invoiceBusy} onClick={() => void printInvoice()}><Printer size={15} /></button></div>
              </div>}
              <div style={{ marginTop: 4 }}>
                <Field label={t(T.od_full_name)} value={`${order.invoiceFirstName ?? ""} ${order.invoiceLastName ?? ""}`.trim()} />
                <Field label={t(T.auth_company)} value={order.invoiceCompany} />
                <Field label={t(T.od_address)} value={order.invoiceStreet} />
                <Field label={t(T.od_zip_city)} value={[order.invoiceZipCode, order.invoiceCity].filter(Boolean).join(" ")} />
                <Field label={order.invoiceCompanyIdType ?? "NIP"} value={order.invoiceTaxId ?? order.invoiceCompanyIdValue} />
                <Field label={t(T.od_vat_status)} value={order.invoiceVatPayerStatus} />
                <Field label={t(T.od_due_date)} value={order.invoiceDueDate} />
              </div>
            </div>

            {/* Odbiór w punkcie */}
            {order.pickupPointName && (
              <div className="card elev-sm">
                <div className="card-kicker">{t(T.od_pickup_point)}</div>
                <div style={{ marginTop: 4 }}>
                  <Field label={t(T.od_pickup_name)} value={order.pickupPointName} />
                  <Field label={t(T.od_address)} value={order.pickupStreet} />
                  <Field label={t(T.od_zip_city)} value={[order.pickupZipCode, order.pickupCity].filter(Boolean).join(" ")} />
                </div>
              </div>
            )}

            {/* Historia */}
            <div className="card elev-sm">
              <div className="card-kicker">{t(T.od_history)}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
                {history.map((ev, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, fontSize: 13 }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", marginTop: 6, flex: "none" }} />
                    <div>
                      <div>{ev.label}</div>
                      <div className="text-muted" style={{ fontSize: 11 }}>{ev.date ? formatDate(ev.date) : "—"}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Wiadomość od klienta */}
            {order.messageToSeller && (
              <div className="card elev-sm">
                <div className="card-kicker">{t(T.od_message)}</div>
                <div style={{ fontSize: 13, color: "var(--text2)", marginTop: 4 }}>{order.messageToSeller}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
    {invoiceDraft && <InvoiceEditorModal value={invoiceDraft} title={t(T.od_invoice_preview)} submitLabel={t(T.od_create_invoice)} busy={invoiceBusy} onChange={setInvoiceDraft} onClose={() => setInvoiceDraft(null)} onSubmit={createInvoice} />}
    {invoicePreview && invoice && <CommerceModal title={invoice.invoiceNumber ?? t(T.invoice_draft_number)} onClose={() => setInvoicePreview(false)} wide><InvoicePdfFrame invoice={invoice} /><footer className="commerce-modal-actions"><button type="button" className="btn btn-secondary" disabled={invoiceBusy} onClick={() => void downloadInvoice()}><Download size={15} />PDF</button><button type="button" className="btn btn-primary" disabled={invoiceBusy} onClick={() => void printInvoice()}><Printer size={15} />Drukuj</button></footer></CommerceModal>}
  </>);
}

const miniBtn: React.CSSProperties = {
  border: "1px solid var(--color-divider)", background: "transparent", borderRadius: "var(--radius-sm)", padding: "5px 10px",
  fontSize: 12, fontWeight: 500, color: "var(--text)", cursor: "pointer",
  display: "inline-flex", alignItems: "center", gap: 5,
};

// ─── FORMULARZ POMOCY / KONTAKTU ───────────────────────────────────────────────
// Zgłoszenia (błąd / pytanie / prośba o integrację) lecą przez Web3Forms (Rust:
// submit_support_request). Pola użytkownik/e-mail są prefillowane z zalogowanego konta.
function SupportModal({ user, email, onClose }: { user: string; email: string; onClose: () => void }) {
  const { t } = useI18n();
  const CATEGORIES: T[] = [T.support_cat_bug, T.support_cat_question, T.support_cat_integration, T.support_cat_other];
  const [category, setCategory] = useState<T>(T.support_cat_bug);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [userField, setUserField] = useState(user);
  const [emailField, setEmailField] = useState(email);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const inputS: React.CSSProperties = { width: "100%", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 9, fontSize: 13, boxSizing: "border-box", background: "var(--bg)", color: "var(--text)" };
  const labelS: React.CSSProperties = { fontSize: 12, color: "var(--muted)", fontWeight: 600, display: "block", marginBottom: 6 };

  const send = async () => {
    if (!message.trim() || busy) return;
    setBusy(true); setError("");
    try {
      await submitSupportRequest({ category: t(category), subject, message, user: userField, email: emailField });
      setDone(true);
    } catch (e) {
      setError(translateMessage(e, t) || t(T.support_error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--surface)", color: "var(--text)", borderRadius: 16, width: 560, maxWidth: "92vw", maxHeight: "88vh", overflow: "auto", boxShadow: "0 24px 60px rgba(0,0,0,0.35)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 22px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <LifeBuoy size={18} style={{ color: "var(--accent)" }} />
            <div style={{ fontWeight: 800, fontSize: 16 }}>{t(T.support_title)}</div>
          </div>
          <button onClick={onClose} style={{ border: "none", background: "transparent", fontSize: 22, color: "var(--muted2)", cursor: "pointer" }}>×</button>
        </div>
        <div style={{ padding: 22 }}>
          {done ? (
            <div style={{ textAlign: "center", padding: "24px 8px" }}>
              <div style={{ width: 48, height: 48, borderRadius: "50%", background: "rgba(22,163,74,0.12)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
                <Check size={26} strokeWidth={3} color="#16a34a" />
              </div>
              <div style={{ fontSize: 14, marginBottom: 18 }}>{t(T.support_sent)}</div>
              <button type="button" className="btn btn-primary" onClick={onClose}>{t(T.common_close)}</button>
            </div>
          ) : (
            <>
              <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5, marginTop: 0, marginBottom: 18 }}>{t(T.support_subtitle)}</p>

              <div style={{ marginBottom: 14 }}>
                <label style={labelS}>{t(T.support_category)}</label>
                <select value={category} onChange={(e) => setCategory(e.target.value as T)} style={inputS}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{t(c)}</option>)}
                </select>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={labelS}>{t(T.support_subject)}</label>
                <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={t(T.support_subject_ph)} style={inputS} />
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={labelS}>{t(T.support_message)}</label>
                <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t(T.support_message_ph)} rows={5} style={{ ...inputS, resize: "vertical", minHeight: 110, fontFamily: "inherit" }} />
              </div>

              <div style={{ display: "flex", gap: 12, marginBottom: 4 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <label style={labelS}>{t(T.support_user)}</label>
                  <input value={userField} onChange={(e) => setUserField(e.target.value)} style={inputS} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <label style={labelS}>{t(T.support_email)}</label>
                  <input type="email" value={emailField} onChange={(e) => setEmailField(e.target.value)} style={inputS} />
                </div>
              </div>

              {error && <div style={{ marginTop: 12, fontSize: 12, color: "#b91c1c" }}>{error}</div>}

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
                <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>{t(T.common_cancel)}</button>
                <button type="button" className="btn btn-primary" onClick={send} disabled={busy || !message.trim()}>{busy ? t(T.support_sending) : t(T.support_send)}</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── GŁÓWNA APLIKACJA ──────────────────────────────────────────────────────────

// Logo: schematyczna paczka — turkusowy karton z bursztynową taśmą (oryginalne, 2-kolorowe).
export function PackLogo({ size = 100, alt = "Paczkowo", src = "/logos/logo.svg" }: { size?: number; alt?: string; src?: string }) {
  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
    />
  );
}

// Przycisk synchronizacji z 5-min blokadą i odliczaniem M:SS (własny tik co 1s,
// żeby nie re-renderować całej listy zamówień co sekundę). Auto-sync omija blokadę.
function SyncButton({ syncing, onSync }: { syncing: boolean; onSync: () => void }) {
  const { t } = useI18n();
  return (
    <button onClick={onSync} disabled={syncing}
      title={t(T.ord_sync)}
      className={`${syncing ? "btn btn-secondary" : "btn btn-primary"} ord-sync-button`}>
      <RefreshCw size={14} style={{ animation: syncing ? "spin 1s linear infinite" : "none" }} />
      {syncing ? t(T.ord_syncing) : t(T.ord_sync)}
    </button>
  );
}

const ORDER_SYNC_PLATFORMS = new Set(["allegro", "erli", "inpost_merchant"]);
type OrderSyncResult = {
  accountsSynced?: number;
  totalFetched?: number;
  totalSaved?: number;
  fetched?: number;
  saved?: number;
  failedPlatforms?: string[];
};

function syncStatusLabel(status: SyncStepStatus, lang: string) {
  if (lang === "pl") return status === "active" ? "W toku" : status === "done" ? "Gotowe" : status === "error" ? "Błąd" : "Czeka";
  return status === "active" ? "In progress" : status === "done" ? "Done" : status === "error" ? "Error" : "Waiting";
}

function syncStepDetail(saved: number, fetched: number, lang: string) {
  return lang === "pl" ? `${saved} zapis. / ${fetched} pobr.` : `${saved} saved / ${fetched} fetched`;
}

function orderSyncStepsFromIntegrations(items: Integration[], t: TFn): SyncProgressStep[] {
  return items
    .filter((item) => ORDER_SYNC_PLATFORMS.has(item.platform) && item.collectOrders !== false)
    .map((item) => {
      const accountKey = item.accountKey || item.accountName;
      const blocked = item.status === "ERROR";
      const status: SyncStepStatus = blocked ? "error" : "pending";
      return {
        key: `${item.platform}::${accountKey || item.id}`,
        platform: item.platform,
        accountKey,
        label: `${item.accountName} · ${channelLabel(item.platform, t)}`,
        status,
        detail: blocked
          ? translateMessage(item.errorMessage || "i18n:err_marketplace_authentication", t)
          : undefined,
      };
    });
}

function SyncProgress({ progress }: { progress: SyncProgressState }) {
  const { t, lang } = useI18n();
  const active = progress.steps.find((item) => item.status === "active");
  const finished = progress.steps.filter((item) => item.status === "done" || item.status === "error").length;
  const numbers = [
    `${finished} / ${progress.steps.length}`,
    lang === "pl" ? `pobrano ${progress.fetched}` : `fetched ${progress.fetched}`,
    lang === "pl" ? `zapisano ${progress.saved}` : `saved ${progress.saved}`,
  ];
  if (progress.conflicts) numbers.push(lang === "pl" ? `konflikty ${progress.conflicts}` : `conflicts ${progress.conflicts}`);
  const context = active
    ? `${lang === "pl" ? "Teraz" : "Now"}: ${active.label}`
    : progress.done
      ? (lang === "pl" ? "Zakończono" : "Done")
      : progress.title;
  const subtitle = `${context} · ${numbers.join(" · ")}`;
  return <div className="commerce-sync-progress ord-sync-progress" role="status" aria-live="polite">
    <div><strong>{t(T.ord_sync)}</strong><span>{subtitle}</span></div>
    <div className="commerce-sync-progress-track"><span style={{ width: `${syncProgressPercent(progress)}%` }} /></div>
    <div className="commerce-sync-platforms">
      {progress.steps.map((item) => {
        const status = syncStatusLabel(item.status, lang);
        const metric = item.status === "done" || item.status === "error" ? item.detail : undefined;
        return (
          <span className={`commerce-sync-platform ${item.status}`} key={item.key} title={item.detail}>
            <span className="commerce-sync-dot" />
            <strong>{item.label}</strong>
            <small>{metric ? `${status} · ${metric}` : status}</small>
          </span>
        );
      })}
    </div>
  </div>;
}

function PlatformLogo({ platform, fallback, size = 26 }: { platform: string; fallback?: string; size?: number }) {
  const key = (platform || "").toLowerCase().replace(/-/g, "_");
  const sources = key === "inpost_merchant"
    ? ["/logos/inpost-merchant.svg", "/logos/inpost-merchant.png", "/logos/inpost_merchant.svg", "/logos/inpost_merchant.png", "/logos/inpost.svg", "/logos/inpost.png"]
    : [`/logos/${key}.svg`, `/logos/${key}.png`];
  const [step, setStep] = useState(0);
  if (!key || step >= sources.length) {
    const letter = (fallback ?? platform ?? "?").trim().charAt(0).toUpperCase() || "?";
    return (
      <span style={{ width: size, height: size, borderRadius: "var(--radius-sm)", background: "var(--color-accent-800)", color: "var(--color-accent-100)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 600, fontSize: size * 0.5 }}>
        {letter}
      </span>
    );
  }
  const src = sources[step];
  return <img key={src} src={src} alt={platform} width={size} height={size} style={{ objectFit: "contain", display: "block" }} onError={() => setStep((s) => s + 1)} />;
}

function ChannelFilterSelect({ value, options, onChange }: { value: string; options: ChannelOption[]; onChange: (value: string) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const selected = options.find((option) => option.value === value) ?? null;

  const choose = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <div className="order-channel-filter">
      <button
        ref={buttonRef}
        type="button"
        id="ord-channel"
        className="order-channel-filter-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {selected ? (
          <span className="order-channel-filter-label">
            <PlatformLogo platform={selected.platform} fallback={selected.platformLabel} size={20} />
            <span className="order-channel-copy">
              <strong>{selected.platformLabel}</strong>
              <small>{selected.accountDisplayName || selected.accountName || "Konto"}</small>
            </span>
          </span>
        ) : (
          <span>{t(T.common_all)}</span>
        )}
        <ChevronDown size={15} />
      </button>
      {open && (
        <PortalPopover anchor={buttonRef.current} onClose={() => setOpen(false)}>
          <div className="order-channel-menu" role="listbox" aria-labelledby="ord-channel">
            <button type="button" className="ord-pop-item order-channel-option" aria-selected={value === "all"} onClick={() => choose("all")}>
              <span className={"ord-check" + (value === "all" ? " on" : "")}>{value === "all" && <Check size={11} strokeWidth={3} />}</span>
              <span>{t(T.common_all)}</span>
            </button>
            {options.map((option) => (
              <button key={option.value} type="button" className="ord-pop-item order-channel-option" aria-selected={value === option.value} onClick={() => choose(option.value)}>
                <span className={"ord-check" + (value === option.value ? " on" : "")}>{value === option.value && <Check size={11} strokeWidth={3} />}</span>
                <PlatformLogo platform={option.platform} fallback={option.platformLabel} size={22} />
                <span className="order-channel-copy">
                  <strong>{option.platformLabel}</strong>
                  <small>{option.accountDisplayName || option.accountName || "Konto"}</small>
                </span>
                <span className="ord-pop-count">{option.count}</span>
              </button>
            ))}
          </div>
        </PortalPopover>
      )}
    </div>
  );
}

type View = "orders" | "shipments" | "offers" | "invoices" | "returns" | "magazyn" | "kurier" | "stats" | "integracje" | "ustawienia";

export default function App() {
  const { t, lang } = useI18n();
  // Konto / licencja (bramka na starcie)
  const [authLoading, setAuthLoading] = useState(true);
  const [loggedIn, setLoggedIn] = useState(false);
  const [license, setLicense] = useState<License | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [serverUnavailable, setServerUnavailable] = useState(false);

  async function loadAccount() {
    setServerUnavailable(false); // każda próba zaczyna od czystego stanu offline
    try {
      const logged = await serverIsLoggedIn();
      setLoggedIn(logged);
      if (!logged) { setLicense(null); return; }
      try {
        const lic = await serverLicense();
        setLicense(lic);
        setSessionExpired(false); // sukces → wyczyść ewentualny komunikat
        // Konto nieaktywne (EXPIRED) może być świeże/niezweryfikowane → onboarding,
        // a nie „trial wygasł". Rozróżniamy po statusie weryfikacji email/telefon.
        if (lic.status === "EXPIRED") {
          try {
            const vs = await verificationStatus();
            setNeedsVerification(!(vs.active || vs.licenseActive) && (!vs.emailVerified || !vs.phoneVerified));
          } catch { setNeedsVerification(false); }
        } else {
          setNeedsVerification(false);
        }
        // Ustaw właściciela danych lokalnych (userId) PRZED ładowaniem list.
        if (lic.userId) await setCurrentUser(lic.userId).catch(() => {});
        // Faza 2: odśwież tokeny/konta z serwera, potem przeładuj listy (best-effort).
        invoke("sync_account_tokens").catch(() => {}).finally(() => { loadOrders(); loadAccounts(); loadErli(); loadInpostMerchant(); loadIntegrations(); });
      } catch (e) {
        // Rozróżnij: serwer nieosiągalny (offline/5xx) vs realne wygaśnięcie sesji.
        // Warstwa Rust przy braku sieci zwraca „Brak połączenia…/serwer chwilowo
        // niedostępny" i NIE czyści sesji — wtedy pokazujemy ekran „usługi niedostępne".
        // Backend zwraca klucz słownika (np. "err_server_unavailable") — regex to fallback.
        const key = messageKey(e);
        const offline = key === T.err_server_unavailable || key === T.err_server_generic
          || /Brak połączenia|niedostępn|chwilowo/i.test(String((e as { message?: string })?.message ?? e));
        const still = await serverIsLoggedIn();
        setLoggedIn(still);
        setLicense(null);
        if (offline && still) {
          setServerUnavailable(true); // zalogowany lokalnie, ale serwer nie odpowiada
        } else if (!still) {
          setSessionExpired(true); // dopiero realne wygaśnięcie → komunikat
        }
      }
    } finally {
      setAuthLoading(false);
    }
  }
  // Uruchom raz, nawet przy podwójnym montażu StrictMode (inaczej 2× równoległy
  // refresh tym samym tokenem → drugi dostaje 401 → fałszywe wylogowanie).
  const didInitAccount = useRef(false);
  useEffect(() => {
    if (didInitAccount.current) return;
    didInitAccount.current = true;
    loadAccount();
    /* eslint-disable-next-line */
  }, []);

  async function logoutAccount() {
    window.location.assign("/");
    setSessionExpired(false); // ręczne wylogowanie — bez straszenia komunikatem
  }
  async function upgradeAccount() {
    try {
      const url = await serverCheckout();
      await invoke("open_url", { url });
    } catch (e) {
      alert(`${t(T.err_payment_open_failed)} ${translateMessage(e, t)}`);
    }
  }

  // Aktywny panel zapamiętany w sessionStorage: Ctrl+R (reload webview) zostaje na tej
  // samej zakładce zamiast wracać na „Zamówienia". Czyści się przy zamknięciu aplikacji.
  const VIEWS: View[] = ["orders", "shipments", "offers", "invoices", "returns", "magazyn", "kurier", "stats", "integracje", "ustawienia"];
  const [view, setViewState] = useState<View>(() => {
    const saved = sessionStorage.getItem("view") as View | null;
    return saved && VIEWS.includes(saved) ? saved : "orders";
  });
  const setView = (v: View) => { sessionStorage.setItem("view", v); setViewState(v); };
  const activeNavRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const revealActiveTab = () => activeNavRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
    revealActiveTab();
    window.addEventListener("resize", revealActiveTab);
    return () => window.removeEventListener("resize", revealActiveTab);
  }, [view]);

  // Motyw jasny/ciemny (zmienne CSS na <html>), zapamiętany lokalnie.
  const [theme, setTheme] = useState<"light" | "dark">(() => (localStorage.getItem("theme") as "light" | "dark") || "dark");
  const [acctOpen, setAcctOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  const [orders, setOrders] = useState<Order[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [syncProgress, setSyncProgress] = useState<SyncProgressState | null>(() => readSyncProgress(ORDER_SYNC_PROGRESS_KEY));
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(() => {
    const v = Number(localStorage.getItem("lastSyncAt"));
    return v ? new Date(v) : null;
  });
  const syncingRef = useRef(false);
  // Auto-synchronizacja: interwał w minutach (5/10/15) zapamiętany lokalnie.
  const [syncIntervalMin, setSyncIntervalMinState] = useState<number>(() => {
    const v = Number(localStorage.getItem("syncIntervalMin"));
    return [5, 10, 15].includes(v) ? v : 10;
  });
  const setSyncIntervalMin = (m: number) => { localStorage.setItem("syncIntervalMin", String(m)); setSyncIntervalMinState(m); };
  const [connecting, setConnecting] = useState(false);
  const [connectMsg, setConnectMsg] = useState("");
  const integrationMessageColor = (message: string, busy = false) => message.startsWith("✓") ? "#15803d" : busy ? "var(--muted)" : "#b91c1c";

  // Aktualizacje desktopu — auto-check co 30 min; twarda blokada gdy poniżej minimum.
  const [update, setUpdate] = useState<UpdateManifest | null>(null);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateInstalling, setUpdateInstalling] = useState(false);
  const [updateInstallPct, setUpdateInstallPct] = useState(0);
  const [updateInstallErr, setUpdateInstallErr] = useState<string | null>(null);
  const runUpdateCheck = async () => {
    setUpdateChecking(true);
    try {
      setUpdate(await checkUpdate());
    } catch (e) {
      console.warn("[update] sprawdzenie nieudane:", e);
      throw e;
    } finally {
      setUpdateChecking(false);
    }
  };
  const runUpdateInstall = async () => {
    setUpdateInstalling(true); setUpdateInstallErr(null); setUpdateInstallPct(0);
    try {
      await installUpdateOrOpen((p) => setUpdateInstallPct(p.percent));
      // Po udanej instalacji nastąpi automatyczny restart (relaunch).
    } catch (e) {
      setUpdateInstallErr(`${t(T.set_install_failed)}: ${translateMessage(e, t)}`);
    } finally {
      setUpdateInstalling(false);
    }
  };
  useEffect(() => {
    if (!loggedIn) return;
    void runUpdateCheck().catch(() => undefined);
    const t = setInterval(() => { void runUpdateCheck().catch(() => undefined); }, 30 * 60 * 1000);
    return () => clearInterval(t);
  }, [loggedIn]);

  // Filtry listy zamówień (styl Ordigo): szukaj + status + kanał + kurier.
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<DerivedStatus | "all">("do_wyslania");
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [courierFilter, setCourierFilter] = useState<string>("all");
  const [orderPage, setOrderPage] = useState(1);
  const [orderPageSize, setOrderPageSize] = useState(20);
  const [openOrderId, setOpenOrderId] = useState<number | null>(null);

  // Konfigurowalne filtry przewoźników (które pozycje pojawiają się w liście) — localStorage.
  const [courierActiveIds, setCourierActiveIdsState] = useState<string[]>(() => {
    try { const v = JSON.parse(localStorage.getItem("courierFilterIds") || "null"); return Array.isArray(v) && v.length ? v : DEFAULT_COURIER_IDS; } catch { return DEFAULT_COURIER_IDS; }
  });
  const setCourierActiveIds = (ids: string[]) => { localStorage.setItem("courierFilterIds", JSON.stringify(ids)); setCourierActiveIdsState(ids); };
  // Widoczne ikony w kolumnie „Oznaczenia" — localStorage.
  const [iconCols, setIconColsState] = useState<IconCols>(() => {
    try { const v = JSON.parse(localStorage.getItem("orderIconCols") || "null"); return v && typeof v === "object" ? { paid: true, shipment: true, invoice: true, ...v } : { paid: true, shipment: true, invoice: true }; } catch { return { paid: true, shipment: true, invoice: true }; }
  });
  const setIconCols = (c: IconCols) => { localStorage.setItem("orderIconCols", JSON.stringify(c)); setIconColsState(c); };

  const [printers, setPrinters] = useState<string[]>([]);
  const [defaultPrinter, setDefaultPrinter] = useState("");

  // Integracja własnego InPost ShipX
  const [inpost, setInpost] = useState<{ connected: boolean; orgName?: string }>({ connected: false });
  const [inpostToken, setInpostToken] = useState("");
  const [inpostMsg, setInpostMsg] = useState("");
  const [inpostBusy, setInpostBusy] = useState(false);

  async function loadInpost() {
    try {
      const r = await invoke<{ connected: boolean; orgName?: string }>("get_inpost_integration");
      setInpost(r);
    } catch (e) {
      console.error("get_inpost_integration", e);
    }
  }
  async function saveInpostToken() {
    setInpostBusy(true);
    setInpostMsg("");
    try {
      const r = await invoke<{ connected: boolean; orgName?: string }>("set_inpost_token", { token: inpostToken });
      setInpost(r);
      setInpostToken("");
      setInpostMsg(r.connected ? t(T.int_shipx_connected, { org: r.orgName ? ` — ${r.orgName}` : "" }) : t(T.int_shipx_disconnected));
    } catch (e) {
      setInpostMsg(t(T.common_error_with_message, { message: translateMessage(e, t) }));
    } finally {
      setInpostBusy(false);
    }
  }

  // Integracja marketplace ERLI
  const [erli, setErli] = useState<{ connected: boolean }>({ connected: false });
  const [erliToken, setErliToken] = useState("");
  const [erliMsg, setErliMsg] = useState("");
  const [erliBusy, setErliBusy] = useState(false);
  const [erliName, setErliName] = useState("");

  // Integracja InPost Merchant (InPost Buy / inpsa) — OAuth przez serwer
  const [inpostMerchant, setInpostMerchant] = useState<{ connected: boolean }>({ connected: false });
  async function loadInpostMerchant() {
    try {
      setInpostMerchant(await invoke<{ connected: boolean }>("get_inpost_merchant_integration"));
    } catch (e) {
      console.error("get_inpost_merchant_integration", e);
    }
  }

  // Wszystkie integracje bieżącego usera (Allegro/Erli/InPost) — do listy + rozłączania.
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [userEmail, setUserEmail] = useState(() => localStorage.getItem("userEmail") || "");
  const [addOpen, setAddOpen] = useState(false);
  const [addSel, setAddSel] = useState<"allegro" | "erli" | "inpost" | "inpost-merchant" | null>(null);
  const [addSearch, setAddSearch] = useState("");
  const [settingsFor, setSettingsFor] = useState<Integration | null>(null);
  async function loadIntegrations() {
    try { setIntegrations(await getIntegrations()); } catch (e) { console.error("get_integrations", e); }
    try { const cu = await getCurrentUser(); if (cu.email) setUserEmail(cu.email); } catch { /* ignore */ }
  }
  // Odśwież wszystkie listy po zmianie/rozłączeniu konta (z panelu ustawień konta).
  function accountChanged() {
    Promise.all([loadIntegrations(), loadAccounts(), loadErli(), loadInpost(), loadOrders()]);
  }

  async function loadErli() {
    try {
      setErli(await invoke<{ connected: boolean }>("get_erli_integration"));
    } catch (e) {
      console.error("get_erli_integration", e);
    }
  }
  async function saveErliToken() {
    setErliBusy(true);
    setErliMsg("");
    try {
      const r = await invoke<{ connected: boolean }>("set_erli_token", { token: erliToken, accountName: erliName.trim() || null });
      setErli(r);
      setErliToken("");
      setErliName("");
      await Promise.all([loadIntegrations(), loadErli()]);
      if (r.connected) {
        setErliMsg(t(T.int_erli_connected_fetching));
        await sync(); // jednorazowe pobranie zamówień zaraz po podłączeniu
        setErliMsg(t(T.int_erli_connected));
      } else {
        setErliMsg(t(T.int_not_connected));
      }
    } catch (e) {
      setErliMsg(t(T.common_error_with_message, { message: translateMessage(e, t) }));
    } finally {
      setErliBusy(false);
    }
  }

  async function loadOrders() {
    try {
      const res = await invoke<{ orders: Order[] }>("get_orders");
      setOrders(res.orders);
    } catch (e) {
      console.error("get_orders", e);
    }
  }
  async function loadAccounts() {
    try {
      const res = await invoke<{ accounts: Account[] }>("get_allegro_accounts");
      setAccounts(res.accounts);
    } catch (e) {
      console.error("get_allegro_accounts", e);
    }
  }
  async function loadPrinters() {
    try {
      setPrinters(await invoke<string[]>("list_printers"));
      setDefaultPrinter((await invoke<string | null>("get_default_printer")) ?? "");
    } catch (e) {
      console.error("printers", e);
    }
  }

  useEffect(() => {
    if (!loggedIn || !license || needsVerification) {
      setLoading(false);
      return;
    }
    Promise.all([loadOrders(), loadAccounts(), loadPrinters(), loadInpost(), loadErli(), loadInpostMerchant(), loadIntegrations()]).finally(() => setLoading(false));
  }, [loggedIn, license?.userId, needsVerification]);

  async function sync() {
    if (syncingRef.current) return; // nie nakładaj synchronizacji (auto + ręczna)
    syncingRef.current = true;
    setSyncing(true);
    setSyncMsg(null);
    try {
      let progress: SyncProgressState = {
        title: t(T.ord_sync),
        startedAt: Date.now(),
        updatedAt: Date.now(),
        steps: [{
          key: "prepare",
          platform: "prepare",
          label: lang === "pl" ? "Przygotowanie synchronizacji" : "Preparing sync",
          status: "active",
        }],
        fetched: 0,
        saved: 0,
        accountsSynced: 0,
      };
      const publishProgress = (next: SyncProgressState) => {
        progress = { ...next, updatedAt: Date.now() };
        setSyncProgress(progress);
        writeSyncProgress(ORDER_SYNC_PROGRESS_KEY, progress);
      };
      const markStep = (key: string, status: SyncStepStatus, detail?: string) => {
        publishProgress({
          ...progress,
          steps: progress.steps.map((step) => step.key === key ? { ...step, status, detail } : step),
        });
      };

      publishProgress(progress);
      const freshIntegrations = await getIntegrations().catch(() => integrations);
      setIntegrations(freshIntegrations);
      const accountSteps = orderSyncStepsFromIntegrations(freshIntegrations, t);
      const runnableSteps = accountSteps.filter((step) => step.status !== "error");
      if (accountSteps.length === 0) {
        clearSyncProgress(ORDER_SYNC_PROGRESS_KEY);
        setSyncProgress(null);
        setSyncMsg({
          text: lang === "pl" ? "Brak kont do synchronizacji zamówień." : "No accounts available for order sync.",
          ok: false,
        });
        return;
      }

      const warnings: string[] = accountSteps
        .filter((step) => step.status === "error" && step.detail)
        .map((step) => `${step.label}: ${step.detail}`);
      const refreshStep: SyncProgressStep = {
        key: "refresh",
        platform: "refresh",
        label: lang === "pl" ? "Odświeżanie listy" : "Refreshing list",
        status: "pending",
      };
      progress = {
        title: t(T.ord_sync),
        startedAt: progress.startedAt,
        updatedAt: Date.now(),
        steps: runnableSteps.length > 0 ? [...accountSteps, refreshStep] : accountSteps,
        fetched: 0,
        saved: 0,
        accountsSynced: 0,
      };
      const runAccountSync = async (step: SyncProgressStep): Promise<OrderSyncResult> => {
        const args = { account: step.accountKey || null };
        if (step.platform === "allegro") return invoke<OrderSyncResult>("sync_allegro_orders", args);
        if (step.platform === "erli") return invoke<OrderSyncResult>("sync_erli_orders", args);
        return invoke<OrderSyncResult>("sync_inpost_merchant_orders", args);
      };

      publishProgress(progress);
      if (runnableSteps.length === 0) {
        publishProgress({ ...progress, done: true });
        setSyncMsg({
          text: lang === "pl"
            ? "Nie uruchomiono synchronizacji: konta wymagają ponownego połączenia albo mają wyłączone zbieranie zamówień."
            : "Sync did not start: accounts need reconnecting or have order collection disabled.",
          ok: false,
        });
        return;
      }

      for (const step of runnableSteps) {
        markStep(step.key, "active");
        try {
          const result = await runAccountSync(step);
          const fetched = Number(result.totalFetched ?? result.fetched ?? 0);
          const saved = Number(result.totalSaved ?? result.saved ?? 0);
          const accountsSynced = Number(result.accountsSynced ?? 1);
          const failedPlatforms = result.failedPlatforms ?? [];
          if (failedPlatforms.length > 0) {
            warnings.push(`${step.label}: ${failedPlatforms.join(", ")}`);
          }
          publishProgress({
            ...progress,
            fetched: progress.fetched + fetched,
            saved: progress.saved + saved,
            accountsSynced: progress.accountsSynced + accountsSynced,
            steps: progress.steps.map((item) => item.key === step.key
              ? { ...item, status: failedPlatforms.length && accountsSynced === 0 ? "error" : "done", fetched, saved, detail: syncStepDetail(saved, fetched, lang) }
              : item),
          });
        } catch (error) {
          const detail = translateMessage(error, t);
          warnings.push(`${step.label}: ${detail}`);
          publishProgress({
            ...progress,
            steps: progress.steps.map((item) => item.key === step.key ? { ...item, status: "error", detail } : item),
          });
        }
      }

      markStep(refreshStep.key, "active");
      await loadOrders();
      markStep(refreshStep.key, "done");
      publishProgress({ ...progress, done: true });

      if (progress.accountsSynced > 0) {
        const now = new Date();
        setLastSyncAt(now);
        localStorage.setItem("lastSyncAt", String(now.getTime()));
      }

      if (warnings.length > 0) {
        setSyncMsg({ text: `Synchronizacja zakończona z błędami: ${[...new Set(warnings)].join(" | ")}`, ok: false });
      } else {
        setSyncMsg({ text: `Zsync: ${progress.accountsSynced} kont | ${progress.saved} zapisanych`, ok: true });
        const finishedSyncStartedAt = progress.startedAt;
        window.setTimeout(() => {
          setSyncProgress((current) => {
            if (current?.startedAt !== finishedSyncStartedAt) return current;
            clearSyncProgress(ORDER_SYNC_PROGRESS_KEY);
            return null;
          });
        }, 8000);
      }
    } catch (e) {
      setSyncMsg({ text: t(T.common_error_with_message, { message: translateMessage(e, t) }), ok: false });
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }

  // Najświeższa referencja do sync() dla interwału (bez re-tworzenia timera co render).
  const syncRef = useRef(sync);
  useEffect(() => { syncRef.current = sync; });
  // Auto-synchronizacja co wybrany interwał (gdy zalogowany i licencja aktywna).
  useEffect(() => {
    if (!loggedIn || !license || needsVerification) return;
    const id = setInterval(() => { syncRef.current(); }, syncIntervalMin * 60_000);
    return () => clearInterval(id);
  }, [loggedIn, license?.userId, needsVerification, syncIntervalMin]);

  // Ręczna synchronizacja: 5-min blokada + odliczanie liczy `SyncButton` (własny tik 1s).

  async function connectAllegro() {
    setConnecting(true);
    setConnectMsg(t(T.int_opening_browser));
    try {
      // OAuth Allegro kończy SERWER (callback zapisuje konto). start_allegro_auth tylko
      // otwiera przeglądarkę i zwraca od razu — dlatego po nim ODPYTUJEMY serwer, aż
      // pojawi się nowe konto, zamiast zakładać, że jest już gotowe.
      const before = new Set((await getIntegrations().catch(() => [])).filter((i) => i.platform === "allegro").map((i) => i.id));
      await invoke<string>("start_allegro_auth", { lang });
      setConnectMsg(t(T.int_finish_allegro));

      const deadline = Date.now() + 180_000; // czekamy do 3 min na zakończenie OAuth
      let added: Integration | null = null;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 250));
        let list: Integration[] = [];
        try { list = await refreshIntegrations(); } catch { continue; }
        const fresh = list.find((i) => i.platform === "allegro" && !before.has(i.id));
        if (fresh) { added = fresh; break; }
      }

      if (!added) {
        setConnectMsg(t(T.int_no_new_account));
        await loadIntegrations();
        return;
      }

      setConnectMsg(t(T.int_connected_account_fetching, { account: added.accountName }));
      await Promise.all([loadAccounts(), loadIntegrations()]);
      await sync(); // jednorazowe pobranie starych zamówień (widoczny wskaźnik ładowania)
      setConnectMsg(t(T.int_connected_account, { account: added.accountName }));
    } catch (e) {
      setConnectMsg(t(T.common_error_with_message, { message: translateMessage(e, t) }));
    } finally {
      setConnecting(false);
    }
  }

  // InPost Merchant: OAuth+PKCE kończy SERWER (callback zapisuje integrację).
  // start_inpost_merchant_auth tylko otwiera przeglądarkę → odpytujemy serwer aż pojawi się konto.
  async function connectInpostMerchant() {
    setConnecting(true);
    setConnectMsg(t(T.int_opening_browser));
    try {
      const before = new Set((await getIntegrations().catch(() => [])).filter((i) => i.platform === "inpost_merchant").map((i) => i.id));
      await invoke<string>("start_inpost_merchant_auth", { lang });
      setConnectMsg(t(T.int_finish_inpost));

      const deadline = Date.now() + 180_000;
      let added: Integration | null = null;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 250));
        let list: Integration[] = [];
        try { list = await refreshIntegrations(); } catch { continue; }
        const fresh = list.find((i) => i.platform === "inpost_merchant" && !before.has(i.id));
        if (fresh) { added = fresh; break; }
      }

      if (!added) {
        setConnectMsg(t(T.int_no_new_account));
        await Promise.all([loadIntegrations(), loadInpostMerchant()]);
        return;
      }

      setConnectMsg(t(T.int_connected_inpost_merchant_fetching, { account: added.accountName }));
      await Promise.all([loadIntegrations(), loadInpostMerchant()]);
      await sync();
      setConnectMsg(t(T.int_connected_inpost_merchant, { account: added.accountName }));
    } catch (e) {
      setConnectMsg(t(T.common_error_with_message, { message: translateMessage(e, t) }));
    } finally {
      setConnecting(false);
    }
  }

  // Opcje kanału — z realnych zamówień.
  const channelOptions = useMemo(() => {
    const set = new Map<string, ChannelOption>();
    for (const order of orders) {
      if (!order.marketplace) continue;
      const value = channelAccountKey(order);
      const existing = set.get(value);
      if (existing) {
        existing.count += 1;
        continue;
      }
      set.set(value, {
        value,
        platform: order.marketplace,
        platformLabel: channelLabel(order.marketplace, t),
        accountName: order.accountName ?? "",
        accountDisplayName: channelAccountLabel(order),
        count: 1,
      });
    }
    return [...set.values()].sort((a, b) => {
      const byPlatform = a.platformLabel.localeCompare(b.platformLabel, "pl");
      if (byPlatform !== 0) return byPlatform;
      return a.accountName.localeCompare(b.accountName, "pl");
    });
  }, [orders, t]);

  // Filtrowanie + liczniki (status / kurier). Liczniki liczone przy pozostałych aktywnych filtrach.
  const { sorted, statusCounts, courierCounts } = useMemo(() => {
    const q = search.trim().toLowerCase();
    const curDef = courierFilter === "all" ? null : COURIER_CATALOG.find((d) => d.id === courierFilter) ?? null;
    const passSearch = (o: Order) => !q || [o.externalOrderId, buyerName(o), o.buyerEmail, o.deliveryCity, o.accountName].filter(Boolean).join(" ").toLowerCase().includes(q);
    const passChannel = (o: Order) => channelFilter === "all" || channelAccountKey(o) === channelFilter;
    const passStatus = (o: Order) => statusFilter === "all" || o.derivedStatus === statusFilter;
    const passCourier = (o: Order) => courierFilter === "all" ? true : !!curDef && matchCourierDef(o, curDef);

    const sorted = orders.filter((o) => passStatus(o) && passChannel(o) && passCourier(o) && passSearch(o)).sort((a, b) => orderTime(b) - orderTime(a));

    const preStatus = orders.filter((o) => passChannel(o) && passCourier(o) && passSearch(o));
    const statusCounts: Record<string, number> = { all: preStatus.length };
    for (const s of SEGMENTS) statusCounts[s.key] = preStatus.filter((o) => o.derivedStatus === s.key).length;

    const preCourier = orders.filter((o) => passStatus(o) && passChannel(o) && passSearch(o));
    const courierCounts: Record<string, number> = { all: preCourier.length };
    for (const d of COURIER_CATALOG) courierCounts[d.id] = preCourier.filter((o) => matchCourierDef(o, d)).length;

    return { sorted, statusCounts, courierCounts };
  }, [orders, statusFilter, channelFilter, courierFilter, search]);

  const openOrder = openOrderId != null ? orders.find((o) => o.id === openOrderId) ?? null : null;
  const orderPageCount = Math.max(1, Math.ceil(sorted.length / orderPageSize));
  const currentOrderPage = Math.min(orderPage, orderPageCount);
  const visibleOrders = sorted.slice((currentOrderPage - 1) * orderPageSize, currentOrderPage * orderPageSize);

  // ── Nawigacja górna (styl Ordigo) + menu konta ──
  const navLinks: { key: View; labelKey: T }[] = [
    { key: "stats", labelKey: T.nav_dashboard },
    { key: "orders", labelKey: T.nav_orders },
    { key: "shipments", labelKey: T.nav_shipments },
    { key: "offers", labelKey: T.nav_offers },
    { key: "invoices", labelKey: T.nav_invoices },
    { key: "returns", labelKey: T.nav_returns },
    { key: "kurier", labelKey: T.nav_courier },
    { key: "magazyn", labelKey: T.nav_warehouse },
    { key: "integracje", labelKey: T.nav_integrations },
  ];
  const goView = (v: View) => { setView(v); setOpenOrderId(null); setAcctOpen(false); };
  const acctLocal = userEmail.split("@")[0] || "";
  const acctInitials = (() => {
    const parts = acctLocal.split(/[._\-]+/).filter(Boolean);
    const raw = parts.length >= 2 ? parts[0][0] + parts[1][0] : acctLocal.slice(0, 2);
    return (raw || "PA").toUpperCase();
  })();
  const acctName = acctLocal
    ? acctLocal.replace(/[._\-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    : t(T.menu_account);
  const premium = license?.status === "PREMIUM";
  const trialDays = license?.daysLeft ?? 0;

  // ── BRAMKA: konto + licencja (po wszystkich hookach) ──
  if (authLoading) {
    return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "var(--muted2)", fontFamily: "system-ui" }}>{t(T.common_loading)}</div>;
  }
  if (serverUnavailable) {
    return <ServerDownScreen onRetry={() => { setAuthLoading(true); return loadAccount(); }} onLogout={logoutAccount} />;
  }
  if (!loggedIn) {
    return <AuthScreen onAuthed={loadAccount} notice={sessionExpired ? t(T.auth_session_expired) : undefined} />;
  }
  if (needsVerification) {
    return <VerificationScreen onVerified={loadAccount} onLogout={logoutAccount} />;
  }
  if (license && license.status === "EXPIRED") {
    return <UpgradeScreen license={license} onRefresh={loadAccount} onLogout={logoutAccount} />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontFamily: "var(--font-body)", background: "var(--bg)", color: "var(--text)" }}>
      {/* ── Górny pasek nawigacji (styl Ordigo) ── */}
      <nav className="nav">
        <span className="nav-brand" aria-label="Paczkowo">
          <PackLogo size={50} alt="" src="/logos/logo150.png" />
          <span>Paczkowo</span>
        </span>
        {navLinks.map((n) => {
          const active = view === n.key;
          return (
            <button
              type="button"
              key={n.key}
              ref={active ? activeNavRef : undefined}
              className="ord-navlink"
              aria-current={active ? "page" : undefined}
              onClick={() => goView(n.key)}
            >
              {t(n.labelKey)}
            </button>
          );
        })}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: 20, position: "relative" }}>
          <button type="button" className="btn btn-secondary" onClick={() => setSupportOpen(true)} aria-label={t(T.support_tooltip)} title={t(T.support_tooltip)} style={{ fontSize: 13, gap: 6 }}>
            <LifeBuoy size={16} />
            {t(T.support_tooltip)}
          </button>
          <button type="button" className="ord-avatar-btn" onClick={() => setAcctOpen((o) => !o)} aria-label={t(T.menu_account)}>{acctInitials}</button>
        </div>

        {acctOpen && (
          <>
            <div className="ord-acct-overlay" onClick={() => setAcctOpen(false)} />
            <div className="ord-acct-pop">
              <div style={{ padding: "6px 8px 10px" }}>
                <div style={{ fontFamily: "var(--font-heading)", fontSize: 14 }}>{acctName}</div>
                <div className="text-muted" style={{ fontSize: 12 }}>{userEmail || "—"}</div>
              </div>
              <div style={{ height: 1, background: "var(--color-divider)", marginBottom: 6 }} />
              {license && (
                <>
                  <div style={{ padding: "2px 8px 8px" }}>
                    <div style={{ fontSize: 10, color: "var(--muted2)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      {premium ? t(T.acct_premium) : t(T.acct_trial)}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: !premium && trialDays <= 3 ? "#f4515b" : "var(--text)", marginTop: 2 }}>
                      {premium ? t(T.acct_days_renew, { n: trialDays }) : t(T.acct_days_left, { n: trialDays })}
                    </div>
                    {!premium && (
                      <button type="button" onClick={() => { setAcctOpen(false); upgradeAccount(); }} className="btn btn-primary btn-block" style={{ marginTop: 8 }}>{t(T.acct_buy_premium)}</button>
                    )}
                  </div>
                  <div style={{ height: 1, background: "var(--color-divider)", marginBottom: 6 }} />
                </>
              )}
              <button type="button" className="ord-acct-item" onClick={() => goView("ustawienia")}>
                <SettingsIcon size={15} /> {t(T.menu_settings)}
              </button>
              <button type="button" className="ord-acct-item danger" onClick={() => { setAcctOpen(false); logoutAccount(); }}>
                <LogOut size={15} /> Zakończ demo
              </button>
            </div>
          </>
        )}
      </nav>

      {/* ── Formularz pomocy / kontaktu ── */}
      {supportOpen && <SupportModal user={acctName} email={userEmail} onClose={() => setSupportOpen(false)} />}

      {/* ── Obszar aktywnego widoku ── */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}>

      {/* ── MAGAZYN (StockCore) ── */}
      {view === "magazyn" && <StockCore />}

      {view === "offers" && <Offers />}

      {view === "invoices" && <Invoices onOpenIntegrations={() => setView("integracje")} defaultPrinter={defaultPrinter} />}

      {view === "returns" && <Returns />}

      {view === "shipments" && (
        <Shipping
          orders={orders}
          loading={loading}
          syncing={syncing}
          lastSyncAt={lastSyncAt}
          onSync={sync}
          syncProgress={syncProgress}
          syncMessage={syncMsg}
          defaultPrinter={defaultPrinter}
          onOpenOrder={(orderId) => { setOpenOrderId(orderId); setView("orders"); }}
        />
      )}

      {/* ── ZAMÓW KURIERA ── */}
      {view === "kurier" && <CourierPickup accounts={accounts} />}

      {/* ── STATYSTYKI ── */}
      {view === "stats" && <Dashboard orders={orders} />}

      {/* ── USTAWIENIA ── */}
      {view === "ustawienia" && (
        <Settings
          license={license}
          email={userEmail}
          integrationsCount={integrations.length}
          theme={theme}
          setTheme={setTheme}
          syncIntervalMin={syncIntervalMin}
          setSyncIntervalMin={setSyncIntervalMin}
          onSyncNow={sync}
          syncing={syncing}
          onUpgrade={upgradeAccount}
          onLogout={logoutAccount}
          update={update}
          updateChecking={updateChecking}
          onCheckUpdate={runUpdateCheck}
        />
      )}

      {/* ── INTEGRACJE ── */}
      {view === "integracje" && (
        <main style={{ flex: 1, overflow: "auto", padding: "28px 32px 60px" }}>
          <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 18, gap: 12, flexWrap: "wrap" }}>
            <div>
              <h2 style={{ margin: "0 0 4px" }}>{t(T.nav_integrations)}</h2>
              <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>{t(T.int_subtitle)}</p>
            </div>
            <button type="button" className="btn btn-primary" onClick={() => { setAddOpen(true); setAddSel(null); setAddSearch(""); }}>{t(T.int_add)}</button>
          </div>

          {connectMsg && (
            <div style={{ marginBottom: 16, maxWidth: 820, padding: "10px 14px", borderRadius: "var(--radius-md)", fontSize: 13, border: "1px solid var(--color-divider)", color: connectMsg.startsWith("✓") ? "#4ade80" : "#f4515b", background: "color-mix(in srgb, var(--color-text) 4%, transparent)" }}>
              {connectMsg}
            </div>
          )}

          <div className="card elev-sm" style={{ padding: 0, maxWidth: 820, overflow: "hidden" }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ paddingLeft: "var(--space-4)" }}>{t(T.int_col_account)}</th>
                  <th>{t(T.int_col_platform)}</th>
                  <th style={{ paddingRight: "var(--space-4)", textAlign: "right" }}>{t(T.int_col_action)}</th>
                </tr>
              </thead>
              <tbody>
                {integrations.length === 0 ? (
                  <tr><td colSpan={3} className="text-muted" style={{ padding: 28, textAlign: "center" }}>{t(T.int_empty)}</td></tr>
                ) : (
                  integrations.map((it) => {
                    const reconnectRequired = it.status === "ERROR" && it.errorAction === "RECONNECT_REQUIRED";
                    return (
                      <tr key={it.id}>
                        <td style={{ paddingLeft: "var(--space-4)" }}>
                          <div className="integration-account-cell">
                            <div className="integration-account-name">
                              <PlatformLogo platform={it.platform} size={22} />{it.accountName}
                            </div>
                            {reconnectRequired && (
                              <div className="integration-error-note">
                                <AlertTriangle size={13} />
                                <span>{it.errorMessage || t(T.int_reconnect_required)} {t(T.int_reconnect_required_body)}</span>
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="text-muted">{channelLabel(it.platform, t)}</td>
                        <td style={{ paddingRight: "var(--space-4)", textAlign: "right" }}>
                          <button type="button" onClick={() => setSettingsFor(it)} className="btn btn-secondary integration-settings-button">
                            <SettingsIcon size={14} /> {t(T.menu_settings)}
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>


          {settingsFor && (
            <AccountSettings integration={settingsFor} onClose={() => setSettingsFor(null)} onChanged={accountChanged} />
          )}

          {/* Modal: wybór integracji do dodania (siatka + wyszukiwarka) */}
          {addOpen && (() => {
            const tiles = [
              { key: "allegro" as const, label: "Allegro", desc: t(T.intm_desc_allegro) },
              { key: "erli" as const, label: "Erli", desc: t(T.intm_desc_erli) },
              { key: "inpost" as const, label: "InPost ShipX", desc: t(T.intm_desc_inpost) },
              { key: "inpost-merchant" as const, label: "InPost Merchant", desc: t(T.intm_desc_inpost_merchant) },
            ].filter((tile) => tile.label.toLowerCase().includes(addSearch.toLowerCase()) || tile.desc.toLowerCase().includes(addSearch.toLowerCase()));
            const inputS: React.CSSProperties = { width: "100%", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 9, fontSize: 13, boxSizing: "border-box", marginTop: 6 };
            return (
              <div onClick={() => setAddOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}>
                <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--surface)", color: "var(--text)", borderRadius: 16, width: 640, maxWidth: "92vw", maxHeight: "86vh", overflow: "auto", boxShadow: "0 24px 60px rgba(0,0,0,0.35)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 22px", borderBottom: "1px solid var(--border)" }}>
                    <div style={{ fontWeight: 800, fontSize: 16 }}>{addSel ? t(T.intm_title_connect) : t(T.intm_title_add)}</div>
                    <button onClick={() => setAddOpen(false)} style={{ border: "none", background: "transparent", fontSize: 22, color: "var(--muted2)", cursor: "pointer" }}>×</button>
                  </div>
                  <div style={{ padding: 22 }}>
                    {!addSel ? (
                      <>
                        <input autoFocus value={addSearch} onChange={(e) => setAddSearch(e.target.value)} placeholder={t(T.intm_search_ph)} style={{ ...inputS, marginTop: 0, marginBottom: 16 }} />
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12 }}>
                          {tiles.map((tile) => (
                            <button key={tile.key} onClick={() => setAddSel(tile.key)} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "20px 8px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--bg)", cursor: "pointer", textAlign: "center" }}>
                              <PlatformLogo platform={tile.key} fallback={tile.label[0]} size={42} />
                              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{tile.label}</span>
                            </button>
                          ))}
                          {tiles.length === 0 && <div style={{ gridColumn: "1 / -1", color: "var(--muted2)", fontSize: 13, textAlign: "center", padding: 20 }}>{t(T.ord_no_results)}</div>}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--muted2)", marginTop: 14 }}>{t(T.intm_soon)}</div>
                      </>
                    ) : (
                      <>
                        <button onClick={() => setAddSel(null)} style={{ border: "none", background: "transparent", color: "var(--accent)", fontSize: 13, fontWeight: 600, cursor: "pointer", marginBottom: 12 }}>{t(T.intm_all)}</button>

                        {addSel === "allegro" && (
                          <div>
                            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>Allegro</div>
                            <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>{t(T.intm_allegro_help)}</p>
                            <button onClick={async () => { await connectAllegro(); await loadIntegrations(); }} disabled={connecting} style={{ marginTop: 8, background: connecting ? "var(--border)" : "var(--accent)", color: "var(--accent-contrast)", border: "none", borderRadius: 9, padding: "11px 20px", fontSize: 14, fontWeight: 700, cursor: connecting ? "not-allowed" : "pointer" }}>{connecting ? t(T.intm_authorizing) : t(T.intm_connect_allegro)}</button>
                            {connectMsg && <div style={{ marginTop: 10, fontSize: 12, display: "flex", alignItems: "center", gap: 6, color: integrationMessageColor(connectMsg, connecting) }}>{connecting && !connectMsg.startsWith("✓") && <span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>↻</span>}{connectMsg}</div>}
                          </div>
                        )}

                        {addSel === "erli" && (
                          <div>
                            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>Erli</div>
                            <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>{t(T.intm_erli_help)}</p>
                            <label style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>{t(T.intm_account_name)}<input value={erliName} onChange={(e) => setErliName(e.target.value)} style={inputS} /></label>
                            <label style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, display: "block", marginTop: 10 }}>{t(T.intm_api_key)}<input type="password" value={erliToken} onChange={(e) => setErliToken(e.target.value)} placeholder={t(T.intm_api_key_ph)} style={inputS} /></label>
                            {erli.connected && <div style={{ marginTop: 10, fontSize: 12, color: "#15803d" }}>{t(T.intm_erli_already)}</div>}
                            <button onClick={saveErliToken} disabled={erliBusy || !erliToken} style={{ marginTop: 12, background: erliBusy || !erliToken ? "var(--border)" : "var(--accent)", color: "var(--accent-contrast)", border: "none", borderRadius: 9, padding: "11px 20px", fontSize: 14, fontWeight: 700, cursor: erliBusy || !erliToken ? "not-allowed" : "pointer" }}>{erliBusy ? t(T.intm_checking) : t(T.intm_connect_erli)}</button>
                            {erliMsg && <div style={{ marginTop: 10, fontSize: 12, display: "flex", alignItems: "center", gap: 6, color: integrationMessageColor(erliMsg, erliBusy) }}>{erliBusy && !erliMsg.startsWith("✓") && <span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>↻</span>}{erliMsg}</div>}
                          </div>
                        )}

                        {addSel === "inpost" && (
                          <div>
                            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>InPost ShipX</div>
                            <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>{t(T.intm_inpost_help)}</p>
                            <label style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, display: "block" }}>{t(T.intm_shipx_token)}<input type="password" value={inpostToken} onChange={(e) => setInpostToken(e.target.value)} placeholder={t(T.intm_shipx_token_ph)} style={inputS} /></label>
                            <button onClick={async () => { await saveInpostToken(); await loadIntegrations(); }} disabled={inpostBusy || !inpostToken} style={{ marginTop: 12, background: inpostBusy || !inpostToken ? "var(--border)" : "var(--accent)", color: "var(--accent-contrast)", border: "none", borderRadius: 9, padding: "11px 20px", fontSize: 14, fontWeight: 700, cursor: inpostBusy || !inpostToken ? "not-allowed" : "pointer" }}>{inpostBusy ? t(T.intm_checking) : t(T.intm_connect_shipx)}</button>
                            {inpostMsg && <div style={{ marginTop: 10, fontSize: 12, color: inpostMsg.startsWith("✓") ? "#15803d" : "#b91c1c" }}>{inpostMsg}</div>}
                          </div>
                        )}

                        {addSel === "inpost-merchant" && (
                          <div>
                            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>InPost Merchant</div>
                            <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>{t(T.intm_merchant_help)}</p>
                            <button onClick={async () => { await connectInpostMerchant(); await loadIntegrations(); }} disabled={connecting} style={{ marginTop: 8, background: connecting ? "var(--border)" : "var(--accent)", color: "var(--accent-contrast)", border: "none", borderRadius: 9, padding: "11px 20px", fontSize: 14, fontWeight: 700, cursor: connecting ? "not-allowed" : "pointer" }}>{connecting ? t(T.intm_authorizing) : t(T.intm_connect_merchant)}</button>
                            {inpostMerchant.connected && <div style={{ marginTop: 10, fontSize: 12, color: "#15803d" }}>{t(T.intm_merchant_already)}</div>}
                            {connectMsg && <div style={{ marginTop: 10, fontSize: 12, display: "flex", alignItems: "center", gap: 6, color: integrationMessageColor(connectMsg, connecting) }}>{connecting && !connectMsg.startsWith("✓") && <span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>↻</span>}{connectMsg}</div>}
                          </div>
                        )}

                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}
          </div>
        </main>
      )}

      {/* ── SZCZEGÓŁY ZAMÓWIENIA ── */}
      {view === "orders" && openOrder && (
        <OrderDetail order={openOrder} onBack={() => setOpenOrderId(null)} onRefresh={loadOrders} printers={printers} defaultPrinter={defaultPrinter} inpostConnected={inpost.connected} />
      )}

      {/* ── LISTA ZAMÓWIEŃ (styl Ordigo) ── */}
      {view === "orders" && !openOrder && (
        <main style={{ flex: 1, overflow: "auto", padding: "28px 32px 60px" }}>
          <div style={{ maxWidth: 1360, margin: "0 auto" }}>
            {/* Nagłówek */}
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 18, gap: 12, flexWrap: "wrap" }}>
              <div>
                <h2 style={{ margin: "0 0 4px" }}>{t(T.ord_title)}</h2>
                <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>{t(sorted.length === 1 ? T.ord_count_one : T.ord_count_many, { n: sorted.length })}</p>
              </div>
              <div className="ord-header-actions">
                {syncMsg && !syncMsg.ok && <span style={{ fontSize: 12, color: "#f4515b" }}>{syncMsg.text}</span>}
                {lastSyncAt && !syncing && (
                  <span style={{ fontSize: 11, color: "var(--muted2)" }}>
                    {t(T.ord_synced_at, { time: lastSyncAt.toLocaleTimeString(lang === "en" ? "en-GB" : "pl-PL", { hour: "2-digit", minute: "2-digit" }) })}
                  </span>
                )}
                <SyncButton syncing={syncing} onSync={sync} />
                {syncProgress && <SyncProgress progress={syncProgress} />}
              </div>
            </div>

            {/* Filtry: szukaj + status + kanał + kurier */}
            <div style={{ display: "flex", gap: 12, alignItems: "flex-end", marginBottom: 16, flexWrap: "wrap" }}>
              <div className="field" style={{ maxWidth: 280, flex: 1, minWidth: 200 }}>
                <label htmlFor="ord-search">{t(T.common_search)}</label>
                <input className="input" id="ord-search" placeholder={t(T.ord_search_ph)} value={search} onChange={(e) => { setSearch(e.target.value); setOrderPage(1); }} />
              </div>
              <div className="field">
                <label id="ord-status-label">{t(T.ord_status)}</label>
                <div className="seg" role="radiogroup" aria-labelledby="ord-status-label">
                  {SEGMENTS.map((s) => (
                    <label key={s.key} className="seg-opt">
                      <input type="radio" name="statusf" checked={statusFilter === s.key} onChange={() => { setStatusFilter(s.key); setOrderPage(1); }} />{t(STATUS_KEY[s.key])}<span className="seg-count">{statusCounts[s.key] ?? 0}</span>
                    </label>
                  ))}
                  <label className="seg-opt">
                    <input type="radio" name="statusf" checked={statusFilter === "all"} onChange={() => { setStatusFilter("all"); setOrderPage(1); }} />{t(T.common_all)}<span className="seg-count">{statusCounts.all ?? 0}</span>
                  </label>
                </div>
              </div>
              <div className="field" style={{ maxWidth: 230 }}>
                <label htmlFor="ord-channel">{t(T.ord_channel)}</label>
                <ChannelFilterSelect value={channelFilter} options={channelOptions} onChange={(next) => { setChannelFilter(next); setOrderPage(1); }} />
              </div>
              <div className="field">
                <label>{t(T.ord_courier)}</label>
                <CourierFilterSelect value={courierFilter} onChange={(value) => { setCourierFilter(value); setOrderPage(1); }} activeIds={courierActiveIds} setActiveIds={setCourierActiveIds} counts={courierCounts} />
              </div>
            </div>

            {/* Tabela */}
            <div className="card elev-sm" style={{ padding: 0, overflowX: "auto" }}>
              {loading ? (
                <Center><Spinner /></Center>
              ) : (
                <>
                  <table className="table" style={{ fontSize: 14 }}>
                    <thead>
                      <tr>
                        <th style={{ paddingLeft: "var(--space-4)" }}>{t(T.ord_col_order)}</th>
                        <th>{t(T.ord_col_client)}</th>
                        <th>{t(T.ord_col_channel)}</th>
                        <th>{t(T.ord_col_courier)}</th>
                        <th>{t(T.ord_col_status)}</th>
                        <th><IconColHeader cols={iconCols} setCols={setIconCols} /></th>
                        <th className="ord-th-num">{t(T.ord_col_amount)}</th>
                        <th style={{ paddingRight: "var(--space-4)" }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleOrders.map((o) => <OrderRow key={o.id} order={o} onOpen={(ord) => setOpenOrderId(ord.id)} cols={iconCols} />)}
                    </tbody>
                  </table>
                  {sorted.length === 0 && (
                    <div style={{ padding: 40, textAlign: "center" }} className="text-muted">{t(T.ord_empty)}</div>
                  )}
                </>
              )}
            </div>
            {!loading && <CommercePagination page={currentOrderPage} pageSize={orderPageSize} total={sorted.length} onPageChange={setOrderPage} onPageSizeChange={(value) => { setOrderPageSize(value); setOrderPage(1); }} />}
          </div>
        </main>
      )}

      </div>{/* /obszar widoku */}

      {/* ── TWARDA BLOKADA: wersja poniżej minimum ── */}
      {update?.updateRequired && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(15,23,42,0.55)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}>
          <div style={{ width: 420, maxWidth: "90vw", background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 16, padding: 28, textAlign: "center", boxShadow: "0 24px 60px rgba(0,0,0,0.4)" }}>
            <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 8 }}>{t(T.upd_required_title)}</div>
            <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6, margin: "0 0 20px" }}>
              {t(T.upd_required_body, { cur: update.currentVersion, latest: update.latestVersion, min: update.minimumRequiredVersion })}
            </p>
            <button
              onClick={runUpdateInstall}
              disabled={updateInstalling}
              style={{ width: "100%", background: updateInstalling ? "var(--border)" : "var(--accent)", color: updateInstalling ? "var(--muted)" : "var(--accent-contrast)", border: "none", borderRadius: 10, padding: "12px 16px", fontSize: 14, fontWeight: 700, cursor: updateInstalling ? "not-allowed" : "pointer" }}
            >
              {updateInstalling ? (updateInstallPct > 0 ? `${t(T.set_installing)} ${updateInstallPct}%` : t(T.set_installing)) : t(T.set_install_update)}
            </button>
            {updateInstallErr && <div style={{ fontSize: 12, color: "#fca5a5", marginTop: 10 }}>{updateInstallErr}</div>}
          </div>
        </div>
      )}

    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 220 }}>{children}</div>;
}
function Spinner() {
  return <div style={{ width: 24, height: 24, border: "3px solid var(--accent)", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />;
}
