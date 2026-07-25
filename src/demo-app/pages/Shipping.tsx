import { invoke } from "../lib/serverStatus";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  ExternalLink,
  FileText,
  PackageCheck,
  PackageOpen,
  Printer,
  RefreshCw,
  Truck,
} from "lucide-react";

import { CommerceModal, CommercePagination, KpiStrip, StatusPill } from "../components/CommerceUi";
import {
  AccountFilterMulti,
  buildChannelOptions,
  channelAccountKey,
  channelLabel,
  CourierFilterPanel,
  courierIdForCarrier,
  PlatformLogo,
} from "../components/ListFilters";
import ProductThumbs from "../components/ProductThumbs";
import StatusPath, { type StatusPathStep } from "../components/StatusPath";
import { SyncProgressPanel, SyncSummaryBanner, type SyncSummary } from "../components/SyncStatus";
import { carrierLabel } from "../lib/carriers";
import { T, localeOf, translateMessage, useI18n } from "../lib/i18n";
import { type SyncProgressState } from "../lib/syncProgress";
import type { Order, Shipment } from "../lib/types";

type StatusFilter = "ALL" | "CREATED" | "IN_TRANSIT" | "READY_FOR_PICKUP" | "DELIVERED" | "ISSUES";

// Segmenty statusu w kolejności jak w Zamówieniach: konkretne stany, „Wszystkie" na końcu.
const SHIPMENT_SEGMENTS: Exclude<StatusFilter, "ALL">[] = ["CREATED", "IN_TRANSIT", "READY_FOR_PICKUP", "DELIVERED", "ISSUES"];

const SHIP_FILTER_STATUS_KEY = "shipmentStatusFilter";
const SHIP_FILTER_CHANNEL_KEY = "shipmentChannelFilter";
const SHIP_FILTER_COURIER_KEY = "shipmentCourierFilter";

/** Zapamiętane kanały: tablica kluczy. Stary format (jeden klucz albo „all") wciąż się wczytuje. */
function readSavedChannels(): Set<string> {
  const raw = localStorage.getItem(SHIP_FILTER_CHANNEL_KEY);
  if (!raw || raw === "all") return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set(parsed.filter((value): value is string => typeof value === "string"));
  } catch { /* stary format: pojedynczy klucz kanału */ }
  return new Set([raw]);
}

type ShipmentRow = {
  key: string;
  order: Order;
  shipment: Shipment;
  tracking: string;
  courierId: string;
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

type Copy = {
  title: string;
  countOne: string;
  countMany: string;
  refresh: string;
  syncing: string;
  lastSync: string;
  neverSynced: string;
  search: string;
  searchPlaceholder: string;
  status: string;
  channel: string;
  courier: string;
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
  colShipment: string;
  colCustomer: string;
  colChannel: string;
  colCarrier: string;
  colTracking: string;
  colStatus: string;
  colCreated: string;
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
    countOne: "{n} przesyłka",
    countMany: "{n} przesyłek",
    refresh: "Synchronizuj",
    syncing: "Synchronizacja...",
    lastSync: "Zsync. {time}",
    neverSynced: "Brak synchronizacji w tej sesji",
    search: "Szukaj",
    searchPlaceholder: "Nr przesyłki, zamówienia, klient, miasto...",
    status: "Status",
    channel: "Kanał",
    courier: "Przewoźnik",
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
    colShipment: "Przesyłka",
    colCustomer: "Klient",
    colChannel: "Kanał",
    colCarrier: "Przewoźnik",
    colTracking: "Tracking",
    colStatus: "Status",
    colCreated: "Nadano",
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
    countOne: "{n} shipment",
    countMany: "{n} shipments",
    refresh: "Sync",
    syncing: "Syncing...",
    lastSync: "Synced {time}",
    neverSynced: "No sync in this session",
    search: "Search",
    searchPlaceholder: "Shipment no., order, customer, city...",
    status: "Status",
    channel: "Channel",
    courier: "Carrier",
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
    colShipment: "Shipment",
    colCustomer: "Customer",
    colChannel: "Channel",
    colCarrier: "Carrier",
    colTracking: "Tracking",
    colStatus: "Status",
    colCreated: "Created",
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

function formatShortDate(value: string | undefined, locale: string) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return `${parsed.toLocaleDateString(locale, { day: "2-digit", month: "short" })}, ${parsed.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}`;
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

// Tagi statusu w stylu tabeli zamówień (te same klasy `tag`).
function ShipmentStatusBadge({ status, copy }: { status: Shipment["status"]; copy: Copy }) {
  const cfg: Record<string, { cls: string; strike?: boolean }> = {
    CREATED: { cls: "tag tag-accent" },
    IN_TRANSIT: { cls: "tag tag-accent" },
    READY_FOR_PICKUP: { cls: "tag tag-outline" },
    DELIVERED: { cls: "tag tag-neutral" },
    CANCELED: { cls: "tag tag-neutral", strike: true },
    FAILED: { cls: "tag tag-outline" },
  };
  const d = cfg[String(status ?? "")] ?? { cls: "tag tag-neutral" };
  return (
    <span className={d.cls} style={d.strike ? { textDecoration: "line-through", opacity: 0.65 } : undefined}>
      {statusLabel(status, copy)}
    </span>
  );
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

export default function Shipping({
  orders,
  loading,
  syncing,
  lastSyncAt,
  onSync,
  syncProgress,
  syncSummary,
  onDismissSummary,
  defaultPrinter,
  onOpenOrder,
}: {
  orders: Order[];
  loading: boolean;
  syncing: boolean;
  lastSyncAt: Date | null;
  onSync: () => Promise<void> | void;
  syncProgress?: SyncProgressState | null;
  syncSummary?: SyncSummary | null;
  onDismissSummary?: () => void;
  defaultPrinter: string;
  onOpenOrder?: (orderId: number) => void;
}) {
  const { t, lang } = useI18n();
  const locale = localeOf(lang);
  const copy = COPY[lang === "en" ? "en" : "pl"];
  const [search, setSearch] = useState("");
  const [status, setStatusState] = useState<StatusFilter>(() => {
    const saved = localStorage.getItem(SHIP_FILTER_STATUS_KEY) as StatusFilter | null;
    return saved && (saved === "ALL" || SHIPMENT_SEGMENTS.includes(saved as Exclude<StatusFilter, "ALL">)) ? saved : "ALL";
  });
  const [selChannels, setSelChannelsState] = useState<Set<string>>(readSavedChannels);
  const [courierFilter, setCourierFilterState] = useState(() => localStorage.getItem(SHIP_FILTER_COURIER_KEY) || "all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selected, setSelected] = useState<ShipmentRow | null>(null);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [allegroDetails, setAllegroDetails] = useState<Record<string, AllegroShipmentInfo>>({});

  const resetPage = () => setPage(1);
  const setStatus = (value: StatusFilter) => { localStorage.setItem(SHIP_FILTER_STATUS_KEY, value); setStatusState(value); resetPage(); };
  const setSelChannels = (next: Set<string>) => {
    localStorage.setItem(SHIP_FILTER_CHANNEL_KEY, JSON.stringify([...next]));
    setSelChannelsState(next);
    resetPage();
  };
  const setCourierFilter = (value: string) => { localStorage.setItem(SHIP_FILTER_COURIER_KEY, value); setCourierFilterState(value); resetPage(); };

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
        const createdAt = effectiveShipment.createdAt || order.externalUpdatedAt || order.orderCreatedAt;
        const days = ageDays(createdAt);
        const active = !["DELIVERED", "CANCELED", "FAILED"].includes(effectiveShipment.status);
        all.push({
          key: `${order.id}:${effectiveShipment.provider}:${effectiveShipment.id}`,
          order,
          shipment: effectiveShipment,
          tracking: effectiveShipment.trackingNumber?.trim() ?? "",
          courierId: courierIdForCarrier(carrierValue || order.deliveryMethodName),
          carrierName: prettyCarrier(carrierValue, t),
          providerName: providerLabel(effectiveShipment.provider),
          platformName: channelLabel(effectiveShipment.marketplace || order.marketplace, t),
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

  // Filtrowanie + liczniki (status / kurier / kanał). Każdy licznik pomija własny filtr,
  // a lista kanałów jest pełna — pozycje bez trafień zostają widoczne z zerem.
  const { filtered, statusCounts, courierCounts, channelOptions } = useMemo(() => {
    const q = search.trim().toLowerCase();
    const passSearch = (row: ShipmentRow) => {
      if (!q) return true;
      return [
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
      ].filter(Boolean).join(" ").toLowerCase().includes(q);
    };
    const passChannel = (row: ShipmentRow) => selChannels.size === 0 || selChannels.has(channelAccountKey(row.order));
    const passStatus = (row: ShipmentRow) => matchesStatus(row, status);
    const passCourier = (row: ShipmentRow) => courierFilter === "all" || row.courierId === courierFilter;

    const filtered = rows.filter((row) => passStatus(row) && passChannel(row) && passCourier(row) && passSearch(row));

    const preStatus = rows.filter((row) => passChannel(row) && passSearch(row));
    const statusCounts: Record<string, number> = { ALL: preStatus.length };
    for (const segment of SHIPMENT_SEGMENTS) statusCounts[segment] = preStatus.filter((row) => matchesStatus(row, segment)).length;

    const preCourier = rows.filter((row) => passStatus(row) && passChannel(row) && passSearch(row));
    const courierCounts: Record<string, number> = { all: preCourier.length };
    for (const row of preCourier) courierCounts[row.courierId] = (courierCounts[row.courierId] ?? 0) + 1;

    // Kanały: lista ze wszystkich przesyłek, liczniki z zakresu bez filtra kanału.
    const preChannel = rows.filter((row) => passStatus(row) && passCourier(row) && passSearch(row));
    const channelCounts = new Map<string, number>();
    for (const row of preChannel) {
      const key = channelAccountKey(row.order);
      channelCounts.set(key, (channelCounts.get(key) ?? 0) + 1);
    }
    const channelOptions = buildChannelOptions(rows.map((row) => row.order), t)
      .map((option) => ({ ...option, count: channelCounts.get(option.value) ?? 0 }));

    return { filtered, statusCounts, courierCounts, channelOptions };
  }, [rows, search, status, selChannels, courierFilter, t]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const moving = rows.filter((row) => row.shipment.status === "CREATED" || row.shipment.status === "IN_TRANSIT").length;
  const ready = rows.filter((row) => row.shipment.status === "READY_FOR_PICKUP").length;
  const delivered = rows.filter((row) => row.shipment.status === "DELIVERED").length;
  const staleRows = rows.filter((row) => row.stale);
  const missingTracking = rows.filter((row) => !row.tracking);
  const lastSyncLabel = lastSyncAt
    ? copy.lastSync.replace("{time}", lastSyncAt.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }))
    : copy.neverSynced;

  const canOpenTracking = (row: ShipmentRow) => Boolean(row.tracking && trackingUrl(row.courierId, row.tracking));
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
    const url = row.tracking ? trackingUrl(row.courierId, row.tracking) : null;
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

  const statusSegments: { key: Exclude<StatusFilter, "ALL">; label: string }[] = [
    { key: "CREATED", label: copy.created },
    { key: "IN_TRANSIT", label: copy.inTransit },
    { key: "READY_FOR_PICKUP", label: copy.ready },
    { key: "DELIVERED", label: copy.delivered },
    { key: "ISSUES", label: copy.issues },
  ];

  return (
    <main style={{ flex: 1, overflow: "auto", padding: "28px 32px 60px" }}>
      <div style={{ maxWidth: 1360, margin: "0 auto" }}>
        {/* Nagłówek */}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 18, gap: 12, flexWrap: "wrap" }}>
          <div>
            <h2 style={{ margin: "0 0 4px" }}>{copy.title}</h2>
            <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>
              {(filtered.length === 1 ? copy.countOne : copy.countMany).replace("{n}", String(filtered.length))}
            </p>
          </div>
          <div className="ord-header-actions">
            <span style={{ fontSize: 11, color: "var(--muted2)" }}>{lastSyncLabel}</span>
            <button type="button" className={`${syncing ? "btn btn-secondary" : "btn btn-primary"} ord-sync-button`} disabled={syncing} onClick={() => void onSync()}>
              <RefreshCw size={14} style={{ animation: syncing ? "spin 1s linear infinite" : "none" }} />
              {syncing ? copy.syncing : copy.refresh}
            </button>
            {syncProgress && <SyncProgressPanel progress={syncProgress} />}
          </div>
        </div>

        {syncSummary && onDismissSummary && <SyncSummaryBanner summary={syncSummary} onDismiss={onDismissSummary} />}

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
              <button type="button" className="shipping-watch-tile" onClick={() => setStatus("ISSUES")}>
                <AlertTriangle size={18} />
                <span><strong>{staleRows.length}</strong>{copy.staleTitle}</span>
                <small>{copy.staleDetail}</small>
              </button>
              <button type="button" className="shipping-watch-tile" onClick={() => setStatus("ISSUES")}>
                <PackageOpen size={18} />
                <span><strong>{missingTracking.length}</strong>{copy.missingTitle}</span>
                <small>{copy.missingDetail}</small>
              </button>
            </div>
          </div>
        </section>

        {actionError && <div className="commerce-alert danger">{actionError}</div>}
        {notice && <div className="commerce-alert good">{notice}</div>}

        {/* Filtry: szukaj + status + kanał + przewoźnik (model jak w zamówieniach) */}
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", marginBottom: 16, flexWrap: "wrap" }}>
          <div className="field" style={{ maxWidth: 280, flex: 1, minWidth: 200 }}>
            <label htmlFor="ship-search">{copy.search}</label>
            <input className="input" id="ship-search" placeholder={copy.searchPlaceholder} value={search} onChange={(event) => { setSearch(event.target.value); resetPage(); }} />
          </div>
          <div className="field">
            <label id="ship-status-label">{copy.status}</label>
            <div className="seg" role="radiogroup" aria-labelledby="ship-status-label">
              {statusSegments.map((segment) => (
                <label key={segment.key} className="seg-opt">
                  <input type="radio" name="shipstatusf" checked={status === segment.key} onChange={() => setStatus(segment.key)} />
                  {segment.label}<span className="seg-count">{statusCounts[segment.key] ?? 0}</span>
                </label>
              ))}
              <label className="seg-opt">
                <input type="radio" name="shipstatusf" checked={status === "ALL"} onChange={() => setStatus("ALL")} />
                {copy.allStatuses}<span className="seg-count">{statusCounts.ALL ?? 0}</span>
              </label>
            </div>
          </div>
          <div className="field" style={{ maxWidth: 230 }}>
            <label htmlFor="ship-channel">{copy.channel}</label>
            <AccountFilterMulti id="ship-channel" selected={selChannels} options={channelOptions} onChange={setSelChannels} />
          </div>
          <div className="field ord-courier-field">
            <label>{copy.courier}</label>
            <CourierFilterPanel value={courierFilter} onChange={setCourierFilter} counts={courierCounts} />
          </div>
        </div>

        {/* Tabela */}
        <div className="card elev-sm" style={{ padding: 0, overflowX: "auto" }}>
          {loading ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 220 }}>
              <div style={{ width: 24, height: 24, border: "3px solid var(--accent)", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
            </div>
          ) : (
            <>
              <table className="table" style={{ fontSize: 14 }}>
                <thead>
                  <tr>
                    <th style={{ paddingLeft: "var(--space-4)" }}>{copy.colShipment}</th>
                    <th>{copy.colCustomer}</th>
                    <th>{copy.colChannel}</th>
                    <th>{copy.colCarrier}</th>
                    <th>{copy.colTracking}</th>
                    <th>{copy.colStatus}</th>
                    <th>{copy.colCreated}</th>
                    <th style={{ paddingRight: "var(--space-4)" }}></th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => {
                    const trackable = canOpenTracking(row);
                    const labelAvailable = canOpenLabel(row);
                    const rowBusy = busyKey.startsWith(row.key);
                    return (
                      <tr key={row.key} className={`ord-row-click${row.stale || !row.tracking ? " shipping-row-attention" : ""}`} onClick={() => setSelected(row)}>
                        <td style={{ paddingLeft: "var(--space-4)" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                            <ProductThumbs items={row.order.items ?? []} />
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontFamily: "var(--font-heading)", color: "var(--accent)" }}>#{shortId(row.order.externalOrderId)}</div>
                              <div className="text-muted" style={{ fontSize: 11 }}>{row.providerName}</div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <div style={{ maxWidth: 200, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.customerName}</div>
                          <div className="text-muted" style={{ fontSize: 11 }}>{row.destination}</div>
                        </td>
                        <td>
                          <div className="order-channel-cell">
                            <PlatformLogo platform={row.order.marketplace} fallback={row.platformName} size={22} />
                            <span className="order-channel-copy">
                              <strong>{row.platformName}</strong>
                              <small>{row.order.accountDisplayName || row.order.accountName || "Konto"}</small>
                            </span>
                          </div>
                        </td>
                        <td className="text-muted">{row.carrierName}</td>
                        <td>
                          <button type="button" className="shipping-tracking-code" disabled={!row.tracking} title={copy.copyTracking} onClick={(event) => { event.stopPropagation(); void copyTracking(row); }}>
                            {row.tracking || copy.noTracking}
                          </button>
                        </td>
                        <td><ShipmentStatusBadge status={row.shipment.status} copy={copy} /></td>
                        <td className="text-muted" style={{ fontSize: 12 }}>
                          {formatShortDate(row.createdAt, locale)}
                          {row.ageDays != null && <div style={{ fontSize: 11 }}>{copy.days.replace("{n}", String(row.ageDays))}</div>}
                        </td>
                        <td style={{ paddingRight: "var(--space-4)", textAlign: "right" }} onClick={(event) => event.stopPropagation()}>
                          <div className="commerce-actions shipping-actions" style={{ justifyContent: "flex-end" }}>
                            <button type="button" className="btn btn-ghost btn-icon" disabled={!trackable || rowBusy} title={trackable ? copy.openTracking : copy.trackingUnavailable} onClick={() => void withAction(`${row.key}:track`, () => openTracking(row))}><ExternalLink size={15} /></button>
                            <button type="button" className="btn btn-ghost btn-icon" disabled={!row.tracking || rowBusy} title={copy.copyTracking} onClick={() => void copyTracking(row)}><Clipboard size={15} /></button>
                            <button type="button" className="btn btn-ghost btn-icon" disabled={!labelAvailable || rowBusy} title={copy.label} onClick={() => void withAction(`${row.key}:label`, () => openLabel(row))}><FileText size={15} /></button>
                            <button type="button" className="btn btn-ghost btn-icon" disabled={!labelAvailable || rowBusy} title={copy.print} onClick={() => void withAction(`${row.key}:print`, () => printLabel(row))}><Printer size={15} /></button>
                            {onOpenOrder && <button type="button" className="btn btn-ghost btn-icon" title={copy.openOrder} onClick={() => onOpenOrder(row.order.id)}><Truck size={15} /></button>}
                            <button type="button" className="btn btn-ghost" onClick={() => setSelected(row)}>{copy.details}</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filtered.length === 0 && (
                <div style={{ padding: 40, textAlign: "center" }} className="text-muted">
                  <div>{copy.noShipments}</div>
                  <div style={{ fontSize: 12, marginTop: 4 }}>{copy.noShipmentsDetail}</div>
                </div>
              )}
            </>
          )}
        </div>
        {!loading && <CommercePagination page={currentPage} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={(value) => { setPageSize(value); resetPage(); }} />}
      </div>

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
    </main>
  );
}
