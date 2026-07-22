import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  ExternalLink,
  Eye,
  FileText,
  PackageCheck,
  PackageOpen,
  Printer,
  RefreshCw,
  Search,
  Truck,
} from "lucide-react";

import { CommerceHeader, CommerceModal, CommercePage, CommercePagination, EmptyTable, KpiStrip, StatusPill } from "../components/CommerceUi";
import ProductThumbs from "../components/ProductThumbs";
import StatusPath, { type StatusPathStep } from "../components/StatusPath";
import { carrierLabel } from "../lib/carriers";
import { T, translateMessage, useI18n } from "../lib/i18n";
import { syncProgressPercent, type SyncProgressState, type SyncStepStatus } from "../lib/syncProgress";
import type { Order, Shipment } from "../lib/types";

type StatusFilter = "ALL" | "CREATED" | "IN_TRANSIT" | "READY_FOR_PICKUP" | "DELIVERED" | "ISSUES";

type ShipmentRow = {
  key: string;
  order: Order;
  shipment: Shipment;
  tracking: string;
  carrierKey: string;
  carrierName: string;
  providerName: string;
  platformName: string;
  customerName: string;
  destination: string;
  createdAt?: string;
  ageDays: number | null;
  stale: boolean;
};

type AllegroShipmentInfo = {
  id: string;
  carrier?: string;
  transport?: string[];
  createdDate?: string;
  canceled?: boolean;
  waybills?: string[];
  error?: string;
};

type SyncNotice = { text: string; ok: boolean };

type Copy = {
  title: string;
  subtitle: string;
  refresh: string;
  lastSync: string;
  neverSynced: string;
  search: string;
  allCarriers: string;
  allAccounts: string;
  allPlatforms: string;
  allStatuses: string;
  created: string;
  inTransit: string;
  ready: string;
  delivered: string;
  issues: string;
  shippedTotal: string;
  movingNow: string;
  readyForPickup: string;
  deliveredTotal: string;
  noShipments: string;
  noShipmentsDetail: string;
  operations: string;
  operationsDetail: string;
  staleTitle: string;
  staleDetail: string;
  missingTitle: string;
  missingDetail: string;
  carrierLoad: string;
  carrierLoadDetail: string;
  colShipment: string;
  colCustomer: string;
  colCarrier: string;
  colTracking: string;
  colStatus: string;
  colCreated: string;
  colActions: string;
  order: string;
  account: string;
  destination: string;
  noTracking: string;
  trackingUnavailable: string;
  openTracking: string;
  copyTracking: string;
  label: string;
  print: string;
  openOrder: string;
  details: string;
  detailsTitle: string;
  source: string;
  service: string;
  provider: string;
  externalStatus: string;
  labelPath: string;
  labelMissing: string;
  timeline: string;
  orderCreated: string;
  paid: string;
  shipmentCreated: string;
  currentStatus: string;
  products: string;
  logistics: string;
  copied: string;
  copiedFallback: string;
  actionFailed: string;
  labelUnavailable: string;
  days: string;
};

const ALLEGRO_WZA_PROVIDER = "allegro_wza";
const ALLEGRO_ORDER_TRACKING_PROVIDER = "allegro_order_tracking";

function allegroDetailKey(login: string, shipmentId: string) {
  return `${login}::${shipmentId}`;
}

const COPY: Record<"pl" | "en", Copy> = {
  pl: {
    title: "Wysyłka",
    subtitle: "Panel nadanych przesyłek: śledzenie, etykiety, przewoźnicy i szybki wgląd w zamówienie.",
    refresh: "Synchronizuj",
    lastSync: "Ostatnia synchronizacja: {time}",
    neverSynced: "Brak synchronizacji w tej sesji",
    search: "Szukaj po numerze, kliencie, przesyłce, mieście...",
    allCarriers: "Wszyscy przewoźnicy",
    allAccounts: "Wszystkie konta",
    allPlatforms: "Wszystkie kanały",
    allStatuses: "Wszystkie",
    created: "Utworzone",
    inTransit: "W drodze",
    ready: "Do odbioru",
    delivered: "Doręczone",
    issues: "Do sprawdzenia",
    shippedTotal: "Nadane przesyłki",
    movingNow: "W trasie",
    readyForPickup: "Czekają na odbiór",
    deliveredTotal: "Doręczone",
    noShipments: "Brak nadanych przesyłek",
    noShipmentsDetail: "Nadaj paczki z poziomu szczegółów zamówienia, a pojawią się tutaj z numerami śledzenia.",
    operations: "Centrum operacyjne",
    operationsDetail: "Najważniejsze rzeczy do dopilnowania po nadaniu paczek.",
    staleTitle: "Dłużej niż 3 dni w ruchu",
    staleDetail: "Sprawdź przesyłki bez doręczenia lub odbioru.",
    missingTitle: "Bez numeru śledzenia",
    missingDetail: "Etykieta mogła być jeszcze generowana przez przewoźnika.",
    carrierLoad: "Obciążenie przewoźników",
    carrierLoadDetail: "Rozkład nadanych paczek według przewoźnika.",
    colShipment: "Przesyłka",
    colCustomer: "Klient",
    colCarrier: "Przewoźnik",
    colTracking: "Tracking",
    colStatus: "Status",
    colCreated: "Nadano",
    colActions: "",
    order: "Zamówienie",
    account: "Konto",
    destination: "Cel",
    noTracking: "brak numeru",
    trackingUnavailable: "Brak linku śledzenia dla tego przewoźnika",
    openTracking: "Otwórz tracking",
    copyTracking: "Kopiuj numer",
    label: "Etykieta",
    print: "Drukuj",
    openOrder: "Otwórz zamówienie",
    details: "Szczegóły",
    detailsTitle: "Szczegóły przesyłki",
    source: "Kanał",
    service: "Usługa",
    provider: "Moduł nadania",
    externalStatus: "Status źródłowy",
    labelPath: "Plik etykiety",
    labelMissing: "Brak lokalnej etykiety",
    timeline: "Oś śledzenia",
    orderCreated: "Zamówienie złożone",
    paid: "Płatność zaksięgowana",
    shipmentCreated: "Przesyłka utworzona",
    currentStatus: "Aktualny status",
    products: "Produkty",
    logistics: "Logistyka",
    copied: "Skopiowano numer nadawczy.",
    copiedFallback: "Nie udało się skopiować numeru automatycznie.",
    actionFailed: "Operacja nie powiodła się",
    labelUnavailable: "Dla tej przesyłki nie ma jeszcze etykiety do otwarcia.",
    days: "{n} dni",
  },
  en: {
    title: "Shipping",
    subtitle: "Dispatched shipment control: tracking, labels, carriers and quick order context.",
    refresh: "Sync",
    lastSync: "Last sync: {time}",
    neverSynced: "No sync in this session",
    search: "Search by number, customer, shipment, city...",
    allCarriers: "All carriers",
    allAccounts: "All accounts",
    allPlatforms: "All channels",
    allStatuses: "All",
    created: "Created",
    inTransit: "In transit",
    ready: "Ready for pickup",
    delivered: "Delivered",
    issues: "Needs review",
    shippedTotal: "Dispatched shipments",
    movingNow: "Moving now",
    readyForPickup: "Awaiting pickup",
    deliveredTotal: "Delivered",
    noShipments: "No dispatched shipments",
    noShipmentsDetail: "Create parcels from order details and they will appear here with tracking numbers.",
    operations: "Operations center",
    operationsDetail: "The most important follow-ups after dispatch.",
    staleTitle: "Moving for over 3 days",
    staleDetail: "Check parcels without delivery or pickup confirmation.",
    missingTitle: "Missing tracking number",
    missingDetail: "The label may still be generated by the carrier.",
    carrierLoad: "Carrier workload",
    carrierLoadDetail: "Dispatched parcel distribution by carrier.",
    colShipment: "Shipment",
    colCustomer: "Customer",
    colCarrier: "Carrier",
    colTracking: "Tracking",
    colStatus: "Status",
    colCreated: "Created",
    colActions: "",
    order: "Order",
    account: "Account",
    destination: "Destination",
    noTracking: "no number",
    trackingUnavailable: "No tracking link for this carrier",
    openTracking: "Open tracking",
    copyTracking: "Copy number",
    label: "Label",
    print: "Print",
    openOrder: "Open order",
    details: "Details",
    detailsTitle: "Shipment details",
    source: "Channel",
    service: "Service",
    provider: "Shipping module",
    externalStatus: "Source status",
    labelPath: "Label file",
    labelMissing: "No local label",
    timeline: "Tracking timeline",
    orderCreated: "Order placed",
    paid: "Payment captured",
    shipmentCreated: "Shipment created",
    currentStatus: "Current status",
    products: "Products",
    logistics: "Logistics",
    copied: "Tracking number copied.",
    copiedFallback: "Could not copy the number automatically.",
    actionFailed: "Action failed",
    labelUnavailable: "This shipment does not have a label available yet.",
    days: "{n} days",
  },
};

function shortId(id: string) {
  return id.slice(0, 8).toUpperCase();
}

function buyerName(order: Order) {
  if (order.deliveryFirstName && order.deliveryLastName) return `${order.deliveryFirstName} ${order.deliveryLastName}`;
  if (order.buyerFirstName) return `${order.buyerFirstName} ${order.buyerLastName ?? ""}`.trim();
  return order.buyerLogin ?? order.buyerCompanyName ?? "-";
}

function destination(order: Order) {
  return [order.deliveryZipCode, order.deliveryCity].filter(Boolean).join(" ") || order.pickupPointId || "-";
}

function channelLabel(value?: string) {
  const key = (value ?? "").toLowerCase();
  if (key === "allegro") return "Allegro";
  if (key === "erli") return "ERLI";
  if (key === "inpost_merchant") return "InPost Merchant";
  if (key === "amazon") return "Amazon";
  if (key === "ebay") return "eBay";
  return value || "-";
}

function providerLabel(provider: string) {
  switch (provider) {
    case "allegro_wza":
      return "Wysyłam z Allegro";
    case ALLEGRO_ORDER_TRACKING_PROVIDER:
      return "Allegro tracking";
    case "inpost_shipx":
      return "InPost ShipX";
    case "inpost_merchant":
      return "InPost Merchant";
    case "erli":
      return "ERLI";
    default:
      return provider || "-";
  }
}

function normalizeCarrier(value?: string) {
  const raw = (value ?? "").trim().toLowerCase();
  if (!raw) return "";
  if (raw.includes("inpost")) return "inpost";
  if (raw.includes("dpd")) return "dpd";
  if (raw.includes("dhl")) return "dhl";
  if (raw.includes("ups")) return "ups";
  if (raw.includes("orlen") || raw.includes("ruch")) return "orlen";
  if (raw.includes("poczta") || raw.includes("pocztex")) return "poczta";
  if (raw.includes("gls")) return "gls";
  if (raw.includes("fedex")) return "fedex";
  return raw.replace(/[\s_-]+/g, "");
}

function prettyCarrier(value: string | undefined, t: (key: T, vars?: Record<string, string | number>) => string) {
  const key = normalizeCarrier(value);
  const extra: Record<string, string> = {
    poczta: "Poczta Polska",
    gls: "GLS",
    fedex: "FedEx",
    orlen: "ORLEN Paczka",
  };
  if (extra[key]) return extra[key];
  return carrierLabel(key || value, t) ?? value ?? "-";
}

function trackingUrl(carrier: string, tracking: string): string | null {
  const w = encodeURIComponent(tracking);
  switch (normalizeCarrier(carrier)) {
    case "inpost":
      return `https://inpost.pl/sledzenie-przesylek?number=${w}`;
    case "dpd":
      return `https://tracktrace.dpd.com.pl/parcelDetails?p1=${w}`;
    case "dhl":
      return `https://www.dhl.com/pl-pl/home/tracking/tracking-parcel.html?submit=1&tracking-id=${w}`;
    case "ups":
      return `https://www.ups.com/track?tracknum=${w}`;
    case "orlen":
      return `https://nadaj.orlenpaczka.pl/sledzenie-przesylki?number=${w}`;
    case "poczta":
      return `https://emonitoring.poczta-polska.pl/?numer=${w}`;
    case "gls":
      return `https://gls-group.eu/PL/pl/sledzenie-paczek?match=${w}`;
    case "fedex":
      return `https://www.fedex.com/fedextrack/?trknbr=${w}`;
    default:
      return null;
  }
}

function parseTime(value?: string) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function ageDays(value?: string) {
  const time = parseTime(value);
  if (!time) return null;
  return Math.max(0, Math.floor((Date.now() - time) / 86_400_000));
}

function formatDate(value: string | undefined, locale: string) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(locale, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function statusLabel(status: Shipment["status"], copy: Copy) {
  switch (status) {
    case "CREATED":
      return copy.created;
    case "IN_TRANSIT":
      return copy.inTransit;
    case "READY_FOR_PICKUP":
      return copy.ready;
    case "DELIVERED":
      return copy.delivered;
    case "CANCELED":
      return "Anulowana";
    case "FAILED":
      return "Błąd";
    default:
      return status || "-";
  }
}

function statusTone(status: Shipment["status"]): "neutral" | "accent" | "good" | "warn" | "danger" {
  if (status === "DELIVERED") return "good";
  if (status === "READY_FOR_PICKUP") return "warn";
  if (status === "IN_TRANSIT") return "accent";
  if (status === "CANCELED" || status === "FAILED") return "danger";
  return "neutral";
}

function shipmentStatusPath(status: Shipment["status"], lang: string): StatusPathStep[] {
  const text = lang === "en"
    ? { created: "Created", transit: "In transit", pickup: "Pickup", delivered: "Delivered", canceled: "Canceled", issue: "Issue" }
    : { created: "Utworzona", transit: "W drodze", pickup: "Do odbioru", delivered: "Doręczona", canceled: "Anulowana", issue: "Problem" };
  const normalized = String(status ?? "").toUpperCase();
  if (normalized === "CANCELED" || normalized === "FAILED") {
    const labels = [text.created, normalized === "CANCELED" ? text.canceled : text.issue, text.pickup, text.delivered];
    return labels.map((label, index) => ({
      key: label,
      label,
      state: index === 0 ? "done" : index === 1 ? "issue" : "pending",
    }));
  }
  const current = normalized === "DELIVERED"
    ? 3
    : normalized === "READY_FOR_PICKUP"
      ? 2
      : normalized === "IN_TRANSIT"
        ? 1
        : 0;
  const labels = [text.created, text.transit, text.pickup, text.delivered];
  return labels.map((label, index) => ({
    key: label,
    label,
    state: index < current ? "done" : index === current ? "current" : "pending",
  }));
}

function matchesStatus(row: ShipmentRow, filter: StatusFilter) {
  if (filter === "ALL") return true;
  if (filter === "ISSUES") return !row.tracking || row.stale || row.shipment.status === "FAILED" || row.shipment.status === "CANCELED";
  return row.shipment.status === filter;
}

function accountKey(order: Order) {
  return `${order.marketplace}::${order.accountName}`;
}

function labelForAccount(order: Order) {
  return `${channelLabel(order.marketplace)} - ${order.accountDisplayName || order.accountName || "-"}`;
}

function syncStatusLabel(status: SyncStepStatus, lang: string) {
  if (lang === "pl") return status === "active" ? "W toku" : status === "done" ? "Gotowe" : status === "error" ? "Błąd" : "Czeka";
  return status === "active" ? "In progress" : status === "done" ? "Done" : status === "error" ? "Error" : "Waiting";
}

function ShippingSyncProgress({ progress, message }: { progress: SyncProgressState; message?: SyncNotice | null }) {
  const { t, lang } = useI18n();
  const active = progress.steps.find((item) => item.status === "active");
  const finished = progress.steps.filter((item) => item.status === "done" || item.status === "error").length;
  const context = active
    ? `${lang === "pl" ? "Teraz" : "Now"}: ${active.label}`
    : progress.done
      ? (lang === "pl" ? "Zakończono" : "Done")
      : progress.title;
  const numbers = [
    `${finished} / ${progress.steps.length}`,
    lang === "pl" ? `pobrano ${progress.fetched}` : `fetched ${progress.fetched}`,
    lang === "pl" ? `zapisano ${progress.saved}` : `saved ${progress.saved}`,
  ];
  return (
    <section className="commerce-sync-progress shipping-sync-progress" role="status" aria-live="polite">
      <div><strong>{t(T.ord_sync)}</strong><span>{context} / {numbers.join(" / ")}</span></div>
      <div className="commerce-sync-progress-track"><span style={{ width: `${syncProgressPercent(progress)}%` }} /></div>
      <div className="commerce-sync-platforms">
        {progress.steps.map((item) => {
          const status = syncStatusLabel(item.status, lang);
          const detail = item.status === "done" || item.status === "error" ? item.detail : undefined;
          return (
            <span className={`commerce-sync-platform ${item.status}`} key={item.key} title={item.detail}>
              <span className="commerce-sync-dot" />
              <strong>{item.label}</strong>
              <small>{detail ? `${status} / ${detail}` : status}</small>
            </span>
          );
        })}
      </div>
      {message && <div className={`shipping-sync-message ${message.ok ? "good" : "danger"}`}>{message.text}</div>}
    </section>
  );
}

export default function Shipping({
  orders,
  loading,
  syncing,
  lastSyncAt,
  onSync,
  syncProgress,
  syncMessage,
  defaultPrinter,
  onOpenOrder,
}: {
  orders: Order[];
  loading: boolean;
  syncing: boolean;
  lastSyncAt: Date | null;
  onSync: () => Promise<void> | void;
  syncProgress?: SyncProgressState | null;
  syncMessage?: SyncNotice | null;
  defaultPrinter: string;
  onOpenOrder?: (orderId: number) => void;
}) {
  const { t, lang } = useI18n();
  const locale = lang === "pl" ? "pl-PL" : "en-GB";
  const copy = COPY[lang === "en" ? "en" : "pl"];
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [carrier, setCarrier] = useState("ALL");
  const [account, setAccount] = useState("ALL");
  const [platform, setPlatform] = useState("ALL");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selected, setSelected] = useState<ShipmentRow | null>(null);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [allegroDetails, setAllegroDetails] = useState<Record<string, AllegroShipmentInfo>>({});

  const allegroLookup = useMemo(() => {
    const grouped: Record<string, string[]> = {};
    for (const order of orders) {
      for (const shipment of order.shipments ?? []) {
        if (shipment.provider !== ALLEGRO_WZA_PROVIDER || !shipment.id) continue;
        const login = order.accountName || "";
        if (!login) continue;
        grouped[login] = grouped[login] ?? [];
        grouped[login].push(shipment.id);
      }
    }
    for (const login of Object.keys(grouped)) {
      grouped[login] = Array.from(new Set(grouped[login])).sort();
    }
    return grouped;
  }, [orders]);

  useEffect(() => {
    let cancelled = false;
    const entries = Object.entries(allegroLookup).filter(([, shipmentIds]) => shipmentIds.length > 0);
    if (entries.length === 0) return () => { cancelled = true; };

    void (async () => {
      const next: Record<string, AllegroShipmentInfo> = {};
      await Promise.all(entries.map(async ([login, shipmentIds]) => {
        try {
          const details = await invoke<AllegroShipmentInfo[]>("get_shipments_info", { login, shipmentIds });
          for (const detail of details) {
            if (detail.id) next[allegroDetailKey(login, detail.id)] = detail;
          }
        } catch (error) {
          console.warn("get_shipments_info", login, error);
        }
      }));
      if (!cancelled) setAllegroDetails((previous) => ({ ...previous, ...next }));
    })();

    return () => { cancelled = true; };
  }, [allegroLookup]);

  const rows = useMemo<ShipmentRow[]>(() => {
    const all: ShipmentRow[] = [];
    for (const order of orders) {
      for (const shipment of order.shipments ?? []) {
        const detail = shipment.provider === ALLEGRO_WZA_PROVIDER
          ? allegroDetails[allegroDetailKey(order.accountName || "", shipment.id)]
          : undefined;
        const detailTracking = detail?.waybills?.find((waybill) => waybill.trim())?.trim();
        const effectiveShipment: Shipment = {
          ...shipment,
          trackingNumber: shipment.trackingNumber?.trim() || detailTracking || undefined,
          carrier: shipment.carrier || detail?.carrier || detail?.transport?.[0],
          createdAt: shipment.createdAt || detail?.createdDate,
          status: detail?.canceled ? "CANCELED" : shipment.status,
          externalStatus: shipment.externalStatus || detail?.error,
        };
        const carrierValue = effectiveShipment.carrier || order.carrier;
        const carrierKey = normalizeCarrier(carrierValue);
        const createdAt = effectiveShipment.createdAt || order.externalUpdatedAt || order.orderCreatedAt;
        const days = ageDays(createdAt);
        const active = !["DELIVERED", "CANCELED", "FAILED"].includes(effectiveShipment.status);
        all.push({
          key: `${order.id}:${effectiveShipment.provider}:${effectiveShipment.id}`,
          order,
          shipment: effectiveShipment,
          tracking: effectiveShipment.trackingNumber?.trim() ?? "",
          carrierKey,
          carrierName: prettyCarrier(carrierValue, t),
          providerName: providerLabel(effectiveShipment.provider),
          platformName: channelLabel(effectiveShipment.marketplace || order.marketplace),
          customerName: buyerName(order),
          destination: destination(order),
          createdAt,
          ageDays: days,
          stale: Boolean(active && days != null && days >= 3),
        });
      }
    }
    const priority = (row: ShipmentRow) => {
      if (row.shipment.provider === ALLEGRO_WZA_PROVIDER) return 2;
      if (row.shipment.labelPath) return 1;
      return 0;
    };
    const deduped: ShipmentRow[] = [];
    const seenTracking = new Set<string>();
    for (const row of all.sort((a, b) => priority(b) - priority(a) || parseTime(b.createdAt) - parseTime(a.createdAt))) {
      const trackingKey = row.tracking ? `${row.order.id}:${row.tracking.toLowerCase()}` : "";
      if (trackingKey && seenTracking.has(trackingKey)) continue;
      if (trackingKey) seenTracking.add(trackingKey);
      deduped.push(row);
    }
    return deduped.sort((a, b) => parseTime(b.createdAt) - parseTime(a.createdAt));
  }, [orders, allegroDetails, t]);

  const carriers = useMemo(() => {
    const map = new Map<string, { key: string; label: string; count: number }>();
    rows.forEach((row) => {
      const key = row.carrierKey || "other";
      const current = map.get(key);
      if (current) current.count += 1;
      else map.set(key, { key, label: row.carrierName, count: 1 });
    });
    return [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, locale));
  }, [rows, locale]);

  const accounts = useMemo(() => {
    const map = new Map<string, { key: string; label: string; count: number }>();
    rows.forEach((row) => {
      const key = accountKey(row.order);
      const current = map.get(key);
      if (current) current.count += 1;
      else map.set(key, { key, label: labelForAccount(row.order), count: 1 });
    });
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, locale));
  }, [rows, locale]);

  const platforms = useMemo(() => {
    const map = new Map<string, { key: string; label: string; count: number }>();
    rows.forEach((row) => {
      const key = row.order.marketplace || row.shipment.marketplace || "unknown";
      const current = map.get(key);
      if (current) current.count += 1;
      else map.set(key, { key, label: channelLabel(key), count: 1 });
    });
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, locale));
  }, [rows, locale]);

  const statusCounts = useMemo(() => {
    const counts: Record<StatusFilter, number> = { ALL: rows.length, CREATED: 0, IN_TRANSIT: 0, READY_FOR_PICKUP: 0, DELIVERED: 0, ISSUES: 0 };
    rows.forEach((row) => {
      if (row.shipment.status in counts) counts[row.shipment.status as StatusFilter] += 1;
      if (matchesStatus(row, "ISSUES")) counts.ISSUES += 1;
    });
    return counts;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      const haystack = [
        row.shipment.id,
        row.tracking,
        row.order.externalOrderId,
        row.customerName,
        row.order.buyerEmail,
        row.destination,
        row.carrierName,
        row.providerName,
        row.platformName,
        row.order.accountName,
      ].filter(Boolean).join(" ").toLowerCase();
      return (!q || haystack.includes(q))
        && matchesStatus(row, status)
        && (carrier === "ALL" || row.carrierKey === carrier)
        && (account === "ALL" || accountKey(row.order) === account)
        && (platform === "ALL" || row.order.marketplace === platform || row.shipment.marketplace === platform);
    });
  }, [rows, search, status, carrier, account, platform]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const moving = rows.filter((row) => row.shipment.status === "CREATED" || row.shipment.status === "IN_TRANSIT").length;
  const ready = rows.filter((row) => row.shipment.status === "READY_FOR_PICKUP").length;
  const delivered = rows.filter((row) => row.shipment.status === "DELIVERED").length;
  const staleRows = rows.filter((row) => row.stale);
  const missingTracking = rows.filter((row) => !row.tracking);
  const maxCarrierCount = Math.max(1, ...carriers.map((item) => item.count));
  const lastSyncLabel = lastSyncAt
    ? copy.lastSync.replace("{time}", lastSyncAt.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }))
    : copy.neverSynced;

  const resetPage = () => setPage(1);
  const setFilter = (next: StatusFilter) => { setStatus(next); resetPage(); };
  const canOpenTracking = (row: ShipmentRow) => Boolean(row.tracking && trackingUrl(row.carrierKey, row.tracking));
  const canOpenLabel = (row: ShipmentRow) => Boolean(row.shipment.labelPath || row.shipment.provider === ALLEGRO_WZA_PROVIDER);

  async function withAction(key: string, action: () => Promise<void>) {
    setBusyKey(key);
    setActionError("");
    setNotice("");
    try {
      await action();
    } catch (error) {
      setActionError(`${copy.actionFailed}: ${translateMessage(error, t)}`);
    } finally {
      setBusyKey("");
    }
  }

  async function openTracking(row: ShipmentRow) {
    const url = row.tracking ? trackingUrl(row.carrierKey, row.tracking) : null;
    if (!url) {
      setActionError(copy.trackingUnavailable);
      return;
    }
    await invoke("open_url", { url });
  }

  async function copyTracking(row: ShipmentRow) {
    if (!row.tracking) return;
    try {
      await navigator.clipboard.writeText(row.tracking);
      setNotice(copy.copied);
      setActionError("");
    } catch {
      setActionError(copy.copiedFallback);
    }
  }

  async function resolveLabelPath(row: ShipmentRow) {
    if (row.shipment.labelPath) return row.shipment.labelPath;
    if (row.shipment.provider !== ALLEGRO_WZA_PROVIDER) throw new Error(copy.labelUnavailable);
    return invoke<string>("get_label", {
      login: row.order.accountName,
      shipmentIds: [row.shipment.id],
      pageSize: "A6",
      fileName: `${row.order.externalOrderId}_${row.shipment.id.slice(0, 8)}`,
    });
  }

  async function openLabel(row: ShipmentRow) {
    const path = await resolveLabelPath(row);
    await invoke("open_file", { path });
  }

  async function printLabel(row: ShipmentRow) {
    const pdfPath = await resolveLabelPath(row);
    await invoke("print_label", { pdfPath, printerName: defaultPrinter || null });
  }

  const statusFilters: { key: StatusFilter; label: string }[] = [
    { key: "ALL", label: copy.allStatuses },
    { key: "CREATED", label: copy.created },
    { key: "IN_TRANSIT", label: copy.inTransit },
    { key: "READY_FOR_PICKUP", label: copy.ready },
    { key: "DELIVERED", label: copy.delivered },
    { key: "ISSUES", label: copy.issues },
  ];

  return (
    <CommercePage>
      <CommerceHeader
        title={copy.title}
        subtitle={copy.subtitle}
        action={(
          <div className="commerce-header-actions shipping-header-actions">
            <span className="shipping-sync-note">{lastSyncLabel}</span>
            <button type="button" className="btn btn-secondary" disabled={syncing} onClick={() => void onSync()}>
              <RefreshCw size={15} className={syncing ? "spin" : ""} />
              {copy.refresh}
            </button>
          </div>
        )}
      />

      {syncProgress && <ShippingSyncProgress progress={syncProgress} message={syncMessage} />}
      {!syncProgress && syncMessage && (
        <div className={`commerce-alert ${syncMessage.ok ? "good" : "danger"}`}>{syncMessage.text}</div>
      )}

      <KpiStrip items={[
        { label: copy.shippedTotal, value: rows.length },
        { label: copy.movingNow, value: moving },
        { label: copy.readyForPickup, value: ready, tone: ready ? "warn" : "default" },
        { label: copy.deliveredTotal, value: delivered, tone: delivered ? "good" : "default" },
      ]} />

      <section className="shipping-ops">
        <div className="shipping-ops-main">
          <div className="shipping-section-head">
            <div>
              <h3>{copy.operations}</h3>
              <p>{copy.operationsDetail}</p>
            </div>
          </div>
          <div className="shipping-watch-grid">
            <button type="button" className="shipping-watch-tile" onClick={() => { setStatus("ISSUES"); resetPage(); }}>
              <AlertTriangle size={18} />
              <span><strong>{staleRows.length}</strong>{copy.staleTitle}</span>
              <small>{copy.staleDetail}</small>
            </button>
            <button type="button" className="shipping-watch-tile" onClick={() => { setStatus("ISSUES"); resetPage(); }}>
              <PackageOpen size={18} />
              <span><strong>{missingTracking.length}</strong>{copy.missingTitle}</span>
              <small>{copy.missingDetail}</small>
            </button>
          </div>
        </div>
        <div className="shipping-carriers">
          <div className="shipping-section-head compact">
            <div>
              <h3>{copy.carrierLoad}</h3>
              <p>{copy.carrierLoadDetail}</p>
            </div>
          </div>
          <div className="shipping-carrier-list">
            {carriers.slice(0, 6).map((item) => (
              <button type="button" key={item.key} className="shipping-carrier-row" onClick={() => { setCarrier(item.key); resetPage(); }}>
                <span>{item.label}</span>
                <strong>{item.count}</strong>
                <i style={{ width: `${Math.max(8, (item.count / maxCarrierCount) * 100)}%` }} />
              </button>
            ))}
            {carriers.length === 0 && <div className="shipping-mini-empty">-</div>}
          </div>
        </div>
      </section>

      {actionError && <div className="commerce-alert danger">{actionError}</div>}
      {notice && <div className="commerce-alert good">{notice}</div>}

      <section className="commerce-toolbar shipping-toolbar">
        <div className="commerce-search shipping-search">
          <Search size={15} />
          <input value={search} onChange={(event) => { setSearch(event.target.value); resetPage(); }} placeholder={copy.search} />
        </div>
        <div className="seg shipping-status-seg">
          {statusFilters.map((item) => (
            <button type="button" key={item.key} className={`commerce-seg-btn${status === item.key ? " active" : ""}`} onClick={() => setFilter(item.key)}>
              {item.label}<span>{statusCounts[item.key]}</span>
            </button>
          ))}
        </div>
        <div className="shipping-filter-selects">
          <select className="input" value={platform} onChange={(event) => { setPlatform(event.target.value); resetPage(); }}>
            <option value="ALL">{copy.allPlatforms}</option>
            {platforms.map((item) => <option key={item.key} value={item.key}>{item.label} ({item.count})</option>)}
          </select>
          <select className="input" value={account} onChange={(event) => { setAccount(event.target.value); resetPage(); }}>
            <option value="ALL">{copy.allAccounts}</option>
            {accounts.map((item) => <option key={item.key} value={item.key}>{item.label} ({item.count})</option>)}
          </select>
          <select className="input" value={carrier} onChange={(event) => { setCarrier(event.target.value); resetPage(); }}>
            <option value="ALL">{copy.allCarriers}</option>
            {carriers.map((item) => <option key={item.key} value={item.key}>{item.label} ({item.count})</option>)}
          </select>
        </div>
      </section>

      <section className="commerce-table-wrap shipping-table-wrap">
        {loading ? (
          <div className="commerce-loading">{t(T.common_loading)}</div>
        ) : filtered.length === 0 ? (
          <EmptyTable title={copy.noShipments} detail={copy.noShipmentsDetail} />
        ) : (
          <table className="table commerce-table shipping-table">
            <thead>
              <tr>
                <th>{copy.colShipment}</th>
                <th>{copy.colCustomer}</th>
                <th>{copy.colCarrier}</th>
                <th>{copy.colTracking}</th>
                <th>{copy.colStatus}</th>
                <th>{copy.colCreated}</th>
                <th>{copy.colActions}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const trackable = canOpenTracking(row);
                const labelAvailable = canOpenLabel(row);
                const rowBusy = busyKey.startsWith(row.key);
                return (
                  <tr key={row.key} className={row.stale || !row.tracking ? "shipping-row-attention" : undefined}>
                    <td>
                      <div className="shipping-order-cell">
                        <ProductThumbs items={row.order.items ?? []} />
                        <div>
                          <strong>#{shortId(row.order.externalOrderId)}</strong>
                          <span className="commerce-subline">{row.platformName} / {row.order.accountDisplayName || row.order.accountName}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <strong>{row.customerName}</strong>
                      <span className="commerce-subline">{copy.destination}: {row.destination}</span>
                    </td>
                    <td>
                      <strong>{row.carrierName}</strong>
                      <span className="commerce-subline">{row.providerName}</span>
                    </td>
                    <td>
                      <button type="button" className="shipping-tracking-code" disabled={!row.tracking} onClick={() => void copyTracking(row)}>
                        {row.tracking || copy.noTracking}
                      </button>
                    </td>
                    <td>
                      <div className="shipping-status-cell">
                        <StatusPill tone={row.stale ? "warn" : statusTone(row.shipment.status)}>{statusLabel(row.shipment.status, copy)}</StatusPill>
                        {row.shipment.externalStatus && <span className="commerce-subline">{row.shipment.externalStatus}</span>}
                        <StatusPath steps={shipmentStatusPath(row.shipment.status, lang)} compact className="shipping-row-status-path" />
                      </div>
                    </td>
                    <td>
                      <strong>{formatDate(row.createdAt, locale)}</strong>
                      {row.ageDays != null && <span className="commerce-subline">{copy.days.replace("{n}", String(row.ageDays))}</span>}
                    </td>
                    <td>
                      <div className="commerce-actions shipping-actions">
                        <button type="button" className="btn btn-ghost btn-icon" disabled={!trackable || rowBusy} title={trackable ? copy.openTracking : copy.trackingUnavailable} onClick={() => void withAction(`${row.key}:track`, () => openTracking(row))}><ExternalLink size={15} /></button>
                        <button type="button" className="btn btn-ghost btn-icon" disabled={!row.tracking || rowBusy} title={copy.copyTracking} onClick={() => void copyTracking(row)}><Clipboard size={15} /></button>
                        <button type="button" className="btn btn-ghost btn-icon" disabled={!labelAvailable || rowBusy} title={copy.label} onClick={() => void withAction(`${row.key}:label`, () => openLabel(row))}><FileText size={15} /></button>
                        <button type="button" className="btn btn-ghost btn-icon" disabled={!labelAvailable || rowBusy} title={copy.print} onClick={() => void withAction(`${row.key}:print`, () => printLabel(row))}><Printer size={15} /></button>
                        {onOpenOrder && <button type="button" className="btn btn-ghost btn-icon" title={copy.openOrder} onClick={() => onOpenOrder(row.order.id)}><Truck size={15} /></button>}
                        <button type="button" className="btn btn-ghost btn-icon" title={copy.details} onClick={() => setSelected(row)}><Eye size={15} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {!loading && <CommercePagination page={currentPage} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={(value) => { setPageSize(value); resetPage(); }} />}

      {selected && (
        <CommerceModal title={copy.detailsTitle} onClose={() => setSelected(null)} wide>
          <div className="shipping-detail">
            <div className="shipping-detail-hero">
              <div>
                <span>{selected.providerName}</span>
                <h4>#{selected.order.externalOrderId}</h4>
                <p>{selected.customerName} / {selected.destination}</p>
              </div>
              <StatusPill tone={selected.stale ? "warn" : statusTone(selected.shipment.status)}>{statusLabel(selected.shipment.status, copy)}</StatusPill>
            </div>

            <StatusPath steps={shipmentStatusPath(selected.shipment.status, lang)} className="shipping-detail-status-path" />

            <div className="shipping-detail-grid">
              <section className="shipping-detail-panel">
                <h4>{copy.logistics}</h4>
                <dl className="shipping-facts">
                  <div><dt>{copy.colTracking}</dt><dd>{selected.tracking || copy.noTracking}</dd></div>
                  <div><dt>{copy.colCarrier}</dt><dd>{selected.carrierName}</dd></div>
                  <div><dt>{copy.service}</dt><dd>{selected.shipment.service || selected.order.deliveryMethodName || "-"}</dd></div>
                  <div><dt>{copy.provider}</dt><dd>{selected.providerName}</dd></div>
                  <div><dt>{copy.source}</dt><dd>{selected.platformName}</dd></div>
                  <div><dt>{copy.account}</dt><dd>{selected.order.accountDisplayName || selected.order.accountName || "-"}</dd></div>
                  <div><dt>{copy.externalStatus}</dt><dd>{selected.shipment.externalStatus || "-"}</dd></div>
                  <div><dt>{copy.labelPath}</dt><dd>{selected.shipment.labelPath || copy.labelMissing}</dd></div>
                </dl>
                <div className="shipping-detail-actions">
                  <button type="button" className="btn btn-secondary" disabled={!canOpenTracking(selected)} onClick={() => void withAction(`${selected.key}:detail-track`, () => openTracking(selected))}><ExternalLink size={15} />{copy.openTracking}</button>
                  <button type="button" className="btn btn-secondary" disabled={!canOpenLabel(selected)} onClick={() => void withAction(`${selected.key}:detail-label`, () => openLabel(selected))}><FileText size={15} />{copy.label}</button>
                  <button type="button" className="btn btn-secondary" disabled={!canOpenLabel(selected)} onClick={() => void withAction(`${selected.key}:detail-print`, () => printLabel(selected))}><Printer size={15} />{copy.print}</button>
                </div>
              </section>

              <section className="shipping-detail-panel">
                <h4>{copy.timeline}</h4>
                <div className="shipping-timeline">
                  {[
                    { icon: PackageOpen, label: copy.orderCreated, date: selected.order.orderCreatedAt },
                    { icon: CheckCircle2, label: copy.paid, date: selected.order.paymentFinishedAt },
                    { icon: PackageCheck, label: copy.shipmentCreated, date: selected.createdAt },
                    { icon: Truck, label: `${copy.currentStatus}: ${statusLabel(selected.shipment.status, copy)}`, date: selected.order.externalUpdatedAt },
                  ].filter((event) => event.date || event.label.includes(copy.currentStatus)).map((event, index) => {
                    const Icon = event.icon;
                    return (
                      <div className="shipping-timeline-event" key={`${event.label}-${index}`}>
                        <span><Icon size={14} /></span>
                        <div>
                          <time>{formatDate(event.date, locale)}</time>
                          <strong>{event.label}</strong>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="shipping-detail-panel shipping-detail-products">
                <h4>{copy.products}</h4>
                <div className="shipping-products">
                  <ProductThumbs items={selected.order.items ?? []} />
                  <div>
                    <strong>{selected.order.items.map((item) => item.productName).filter(Boolean).slice(0, 3).join(", ") || "-"}</strong>
                    <span>{selected.order.items.reduce((sum, item) => sum + Number(item.quantity ?? 1), 0)} {lang === "en" ? "pcs" : "szt."}</span>
                  </div>
                </div>
              </section>
            </div>
          </div>
          <footer className="commerce-modal-actions">
            {onOpenOrder && <button type="button" className="btn btn-secondary" onClick={() => onOpenOrder(selected.order.id)}><Truck size={15} />{copy.openOrder}</button>}
            <button type="button" className="btn btn-primary" onClick={() => setSelected(null)}>{t(T.common_close)}</button>
          </footer>
        </CommerceModal>
      )}
    </CommercePage>
  );
}
