import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Order } from "../lib/types";
import { useI18n, T, translateMessage } from "../lib/i18n";
import "./ShipmentForm.css";

type Method = "allegro" | "inpost_paczkomat" | "inpost_kurier" | "inne" | "manual" | "erli";
type PostingPoint = { id: number; groupId?: string; isDefault?: boolean };
type Service = { deliveryMethodId?: string; name?: string; carrierId?: string; realCarrier?: string; owner?: string };
type ShipmentModule = { key: Method; label: string; kind: "marketplace" | "carrier" | "manual" };

// Przewoźnicy ERLI (deliveryTracking.vendor) — do ręcznego oznaczenia wysyłki.
const ERLI_VENDORS = [
  { v: "inpost", label: "InPost" },
  { v: "dpd", label: "DPD" },
  { v: "dhl", label: "DHL" },
  { v: "ups", label: "UPS" },
  { v: "gls", label: "GLS" },
  { v: "pocztaPolska", label: "Poczta Polska" },
  { v: "ruch", label: "ORLEN Paczka / Ruch" },
  { v: "fedex", label: "FedEx" },
  { v: "ownTransport", label: "" },
  { v: "selfPickup", label: "" },
  { v: "other", label: "" },
];

type Props = {
  order: Order;
  printers: string[];
  defaultPrinter: string;
  inpostConnected: boolean;
  onChanged: () => void;
};

// Gabaryt → wymiary (Dł × Szer × Wys w cm). Wybór gabarytu uzupełnia pola po prawej.
const LOCKER_SIZES = [
  { v: "small", labelKey: T.ship_size_a, l: "64", w: "38", h: "8" },
  { v: "medium", labelKey: T.ship_size_b, l: "64", w: "38", h: "19" },
  { v: "large", labelKey: T.ship_size_c, l: "64", w: "38", h: "41" },
];

// InPost Kurier (ShipX) — usługi kurierskie do drzwi.
const KURIER_SERVICES = [
  { v: "inpost_courier_standard", label: "Przesyłka kurierska standardowa" },
  { v: "inpost_courier_express_1000", label: "Przesyłka kurierska z doręczeniem do 10:00" },
  { v: "inpost_courier_express_1200", label: "Przesyłka kurierska z doręczeniem do 12:00" },
  { v: "inpost_courier_express_1700", label: "Przesyłka kurierska z doręczeniem do 17:00" },
  { v: "inpost_courier_palette", label: "Przesyłka kurierska Paleta Standard" },
  { v: "inpost_courier_esmartmix", label: "Przesyłka kurierska eSmartMIX" },
];

// InPost Paczkomaty (ShipX) — paczkomatowe + warianty Allegro InPost (etykieta 62).
const PACZKOMAT_GROUPS: { group: string; items: { v: string; label: string }[] }[] = [
  {
    group: "Paczkomaty 24/7",
    items: [
      { v: "inpost_locker_standard", label: "Paczkomaty 24/7 — Przesyłka standardowa" },
      { v: "inpost_locker_economy", label: "Paczkomaty 24/7 — Przesyłka ekonomiczna" },
    ],
  },
  {
    group: "Przesyłki Allegro InPost",
    items: [
      { v: "inpost_locker_allegro", label: "Allegro Paczkomaty 24/7 InPost" },
      { v: "allegro_inpost_mini", label: "Allegro miniKurier24 InPost" },
      { v: "inpost_courier_allegro", label: "Allegro Kurier24 InPost" },
      { v: "inpost_courier_c2c", label: "InPost Kurier Standard (C2C)" },
      { v: "inpost_locker_pass_thru", label: "Przesyłka paczkomatowa 'Podaj Dalej'" },
      { v: "inpost_returns_standard", label: "InPost Szybkie Zwroty" },
    ],
  },
];

const isLockerService = (s: string) => /locker|pass_thru/.test(s);

// Metody przesyłki ERLI (shipping.typeId) — Erli nadaje paczkę u tego przewoźnika.
const ERLI_SHIPPING_GROUPS: { group: string; items: { v: string; label: string }[] }[] = [
  { group: "InPost", items: [
    { v: "erliPaczkomat", label: "Paczkomat InPost 24/7" },
    { v: "erliKurier24InPost10kg", label: "Kurier24 InPost do 10 kg" },
    { v: "erliKurier24InPost15kg", label: "Kurier24 InPost do 15 kg" },
    { v: "erliKurier24InPost20kg", label: "Kurier24 InPost do 20 kg" },
    { v: "erliKurier24InPost30kg", label: "Kurier24 InPost do 30 kg" },
    { v: "erliKurier24InPost40kg", label: "Kurier24 InPost do 40 kg" },
    { v: "erliKurier24InPost50kg", label: "Kurier24 InPost do 50 kg" },
  ]},
  { group: "ORLEN Paczka", items: [
    { v: "erliOrlenPaczkaS", label: "ORLEN Paczka S" },
    { v: "erliOrlenPaczkaM", label: "ORLEN Paczka M" },
    { v: "erliOrlenPaczkaL", label: "ORLEN Paczka L" },
  ]},
  { group: "DHL", items: [
    { v: "erliDHLPunktyOdbioru5kg", label: "DHL Punkty Odbioru do 5 kg" },
    { v: "erliDHLPunktyOdbioru10kg", label: "DHL Punkty Odbioru do 10 kg" },
    { v: "erliDHLPunktyOdbioru25kg", label: "DHL Punkty Odbioru do 25 kg" },
    { v: "erliDHL5kg", label: "DHL Kurier do 5 kg" },
    { v: "erliDHL10kg", label: "DHL Kurier do 10 kg" },
    { v: "erliDHL20kg", label: "DHL Kurier do 20 kg" },
    { v: "erliDHL32kg", label: "DHL Kurier do 32 kg" },
  ]},
  { group: "DPD", items: [
    { v: "erliDPDKurier5kg", label: "DPD Kurier do 5 kg" },
    { v: "erliDPDKurier10kg", label: "DPD Kurier do 10 kg" },
    { v: "erliDPDKurier15kg", label: "DPD Kurier do 15 kg" },
    { v: "erliDPDKurier20kg", label: "DPD Kurier do 20 kg" },
    { v: "erliDPDKurier25kg", label: "DPD Kurier do 25 kg" },
    { v: "erliDPDKurier31,5kg", label: "DPD Kurier do 31,5 kg" },
    { v: "erliDPDKurier40kg", label: "DPD Kurier do 40 kg" },
    { v: "erliDPDKurier50kg", label: "DPD Kurier do 50 kg" },
  ]},
  { group: "Pocztex – punkty", items: [
    { v: "erliPocztexPunktyS", label: "Pocztex Punkty S" },
    { v: "erliPocztexPunktyM", label: "Pocztex Punkty M" },
    { v: "erliPocztexPunktyL", label: "Pocztex Punkty L" },
    { v: "erliPocztexPunktyXL", label: "Pocztex Punkty XL" },
  ]},
  { group: "Pocztex – kurier", items: [
    { v: "erliPocztexKurierS", label: "Pocztex Kurier S" },
    { v: "erliPocztexKurierM", label: "Pocztex Kurier M" },
    { v: "erliPocztexKurierL", label: "Pocztex Kurier L" },
    { v: "erliPocztexKurierXL", label: "Pocztex Kurier XL" },
    { v: "erliPocztexKurier2XL", label: "Pocztex Kurier 2XL" },
  ]},
];

function defaultErliType(o: Order): string {
  const point = !!o.pickupPointId;
  const c = o.carrier;
  if (point) {
    if (c === "inpost") return "erliPaczkomat";
    if (c === "orlen") return "erliOrlenPaczkaM";
    if (c === "dhl") return "erliDHLPunktyOdbioru10kg";
    return "erliPaczkomat";
  }
  if (c === "inpost") return "erliKurier24InPost10kg";
  if (c === "dhl") return "erliDHL10kg";
  if (c === "dpd") return "erliDPDKurier10kg";
  return "erliPocztexKurierM";
}

function Chk({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text2)", cursor: "pointer" }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export default function ShipmentForm({ order, printers, defaultPrinter, inpostConnected, onChanged }: Props) {
  const { t } = useI18n();
  const login = order.accountName ?? "";
  const isInpost = order.carrier === "inpost";
  const hasPoint = !!order.pickupPointId;
  const isErli = order.marketplace === "erli";
  const isInpostMerchant = order.marketplace === "inpost_merchant";

  // ERLI: przesyłki nadaje się w pełni w obiegu Erli (POST /shipping/parcels) —
  // bez InPost ShipX. Erli generuje przesyłkę u przewoźnika wybranego przez kupującego.
  // Deklaracja modułów oddziela możliwości platformy od wspólnego układu formularza.
  // Kolejna integracja dodaje tu swoje warianty, zamiast kopiować cały widok.
  const shipmentModules: ShipmentModule[] = isErli
    ? [
        { key: "erli", label: t(T.ship_tab_erli), kind: "marketplace" },
        { key: "manual", label: t(T.ship_tab_manual), kind: "manual" },
      ]
    : isInpostMerchant
    ? [
        { key: "inpost_paczkomat", label: "InPost Paczkomaty", kind: "carrier" },
        { key: "inpost_kurier", label: "InPost Kurier", kind: "carrier" },
      ]
    : [
        { key: "allegro", label: t(T.ship_tab_allegro), kind: "marketplace" },
        { key: "inpost_paczkomat", label: "InPost Paczkomaty", kind: "carrier" },
        { key: "inpost_kurier", label: "InPost Kurier", kind: "carrier" },
        { key: "inne", label: t(T.ship_tab_other), kind: "marketplace" },
      ];
  const defaultMethod: Method = isErli
    ? "erli"
    : (isInpost || isInpostMerchant)
    ? (hasPoint ? "inpost_paczkomat" : "inpost_kurier")
    : "allegro";

  const [method, setMethod] = useState<Method>(defaultMethod);
  // InPost Merchant nadaje na WŁASNEJ umowie (usługi *_standard), nie przez Allegro Smart (*_allegro).
  const [shipxService, setShipxService] = useState(
    defaultMethod === "inpost_kurier" ? "inpost_courier_standard" : isInpostMerchant ? "inpost_locker_standard" : "inpost_locker_allegro"
  );

  const [suggestedInput, setSuggestedInput] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Pełna lista usług „Wysyłam z Allegro" (METODYXYZ) + wybrana (deliveryMethodId).
  const [services, setServices] = useState<Service[]>([]);
  const [allegroService, setAllegroService] = useState<string>("");

  const [lockerSize, setLockerSize] = useState("medium");
  const [length, setLength] = useState("20");
  const [width, setWidth] = useState("15");
  const [height, setHeight] = useState("10");
  const [weight, setWeight] = useState("1");
  const [printer, setPrinter] = useState(defaultPrinter);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  // Pobranie (COD) / ubezpieczenie / usługi dodatkowe / opis — dla InPost ShipX.
  const isCod = order.paymentType === "CASH_ON_DELIVERY" || /pobrani/i.test(order.deliveryMethodName ?? "");
  const [cod, setCod] = useState(isCod ? (order.totalToPay ?? "") : "");
  const [insurance, setInsurance] = useState("");
  const [content, setContent] = useState("");
  const [addSms, setAddSms] = useState(false);
  const [addEmail, setAddEmail] = useState(false);
  const [addSaturday, setAddSaturday] = useState(false);
  const [addRod, setAddRod] = useState(false);
  const [addReturnLabel, setAddReturnLabel] = useState(false);

  // ERLI — ręczne oznaczenie wysyłki innym przewoźnikiem.
  const [manualVendor, setManualVendor] = useState("dpd");
  const [manualTracking, setManualTracking] = useState("");

  // ERLI — metoda przesyłki + punkty nadania.
  const [erliShippingType, setErliShippingType] = useState<string>(() => defaultErliType(order));
  const [erliPoints, setErliPoints] = useState<PostingPoint[]>([]);
  const [erliPostingPoint, setErliPostingPoint] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (isErli) {
        // ERLI: tylko punkty nadania (reszta to obieg Erli).
        try {
          const pts = await invoke<PostingPoint[]>("get_erli_posting_points", { account: order.accountName });
          if (!cancelled) {
            setErliPoints(pts);
            // NIE wymuszamy punktu — punkt nadania musi pasować do GRUPY metody dostawy
            // (np. paczkomatowy punkt nie zadziała dla DHL Kurier → błąd 1212).
            // Domyślnie zostawiamy puste = Erli dobiera właściwy punkt dla wybranej metody.
            setErliPostingPoint("");
          }
        } catch { /* punkty opcjonalne */ }
        if (!cancelled) setLoading(false);
        return;
      }

      if (isInpostMerchant) {
        // InPost Merchant: brak propozycji/usług „Wysyłam z Allegro" — używamy własnego ShipX v2.
        if (!cancelled) setLoading(false);
        return;
      }

      try {
        const proposal = await invoke<any>("get_delivery_proposal", { login, orderId: order.externalOrderId });
        if (!cancelled) {
          const si = proposal?.suggestedInput ?? null;
          setSuggestedInput(si);
          const p = Array.isArray(si?.packages) && si.packages[0] ? si.packages[0] : null;
          if (p) {
            if (p.length?.value != null) setLength(String(p.length.value));
            if (p.width?.value != null) setWidth(String(p.width.value));
            if (p.height?.value != null) setHeight(String(p.height.value));
            if (p.weight?.value != null) setWeight(String(p.weight.value));
          }
        }
      } catch { /* propozycja opcjonalna */ }

      try {
        const svc = await invoke<Service[]>("get_delivery_services", { login });
        if (!cancelled) {
          const serviceList = Array.isArray(svc) ? svc : [];
          setServices(serviceList);
          const match = order.deliveryMethodId
            ? serviceList.find((s) => s.deliveryMethodId && s.deliveryMethodId === order.deliveryMethodId)
            : undefined;
          setAllegroService(match?.deliveryMethodId ?? order.deliveryMethodId ?? "");
        }
      } catch { /* lista opcjonalna */ }

      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [login, order.externalOrderId]);

  // Auto-dobór punktu nadania dla metody Erli: punkt, którego `groupId` jest
  // prefiksem `typeId` metody (np. groupId "erliDHL" pasuje do "erliDHL20kg",
  // "erliPaczkomat" do "erliPaczkomat"). Brak pasującego = konto nie obsługuje tej grupy.
  const matchedPoint = useMemo(
    () => erliPoints.find((p) => p.groupId && erliShippingType.startsWith(p.groupId)) ?? null,
    [erliPoints, erliShippingType]
  );
  // Przy zmianie metody (lub po załadowaniu punktów) automatycznie zaznacz właściwy punkt.
  useEffect(() => {
    setErliPostingPoint(matchedPoint ? String(matchedPoint.id) : "");
  }, [matchedPoint]);

  const groupedServices = useMemo(() => {
    const m = new Map<string, { id: string; name: string }[]>();
    const seen = new Set<string>();
    services.forEach((s) => {
      const id = s.deliveryMethodId || "";
      if (!id) return;
      const carrier = s.carrierId || "—";
      const name = s.name || id;
      const key = `${carrier}|${name}`;
      if (seen.has(key)) return;
      seen.add(key);
      if (!m.has(carrier)) m.set(carrier, []);
      m.get(carrier)!.push({ id, name });
    });
    return Array.from(m.entries());
  }, [services]);

  function selectTab(m: Method) {
    setMethod(m);
    setMsg(null);
    if (m === "inpost_paczkomat") setShipxService(isInpostMerchant ? "inpost_locker_standard" : "inpost_locker_allegro");
    else if (m === "inpost_kurier") setShipxService("inpost_courier_standard");
  }
  function chooseGabaryt(v: string) {
    setLockerSize(v);
    const g = LOCKER_SIZES.find((s) => s.v === v);
    if (g) { setLength(g.l); setWidth(g.w); setHeight(g.h); }
  }

  const isInpostTab = method === "inpost_paczkomat" || method === "inpost_kurier";
  const isAllegroTab = method === "allegro" || method === "inne";
  const showGabaryt = method === "inpost_paczkomat" && isLockerService(shipxService);

  async function nadajErli(doPrint: boolean) {
    if (!erliShippingType) { setMsg({ text: t(T.ship_choose_method), ok: false }); return; }
    setBusy(true);
    setMsg(null);
    try {
      setMsg({ text: t(T.ship_creating_erli), ok: true });
      const res = await invoke<{ parcelId: string; status: string; trackingNumber: string; labelPath: string }>("create_erli_parcel", { request: {
        account: order.accountName,
        orderId: order.externalOrderId,
        orderDbId: order.id,
        shippingTypeId: erliShippingType,
        lengthCm: Number(length),
        widthCm: Number(width),
        heightCm: Number(height),
        weightKg: Number(weight),
        postingPointId: erliPostingPoint ? Number(erliPostingPoint) : null,
      } });
      if (doPrint && res.labelPath) {
        setMsg({ text: t(T.ship_printing), ok: true });
        await invoke("print_label", { pdfPath: res.labelPath, printerName: printer || null });
      }
      const note = res.labelPath
        ? t(T.ship_waybill_note, { n: res.trackingNumber || "—" })
        : t(T.ship_label_generating_erli);
      setMsg({ text: t(T.ship_sent_erli, { status: res.status, note }), ok: true });
      onChanged();
    } catch (e) {
      setMsg({ text: t(T.common_error_with_message, { message: translateMessage(e, t) }), ok: false });
    } finally {
      setBusy(false);
    }
  }

  async function markShippedErli() {
    if (!manualTracking.trim()) { setMsg({ text: t(T.ship_enter_waybill), ok: false }); return; }
    setBusy(true);
    setMsg(null);
    try {
      await invoke("erli_mark_shipped", { account: order.accountName, orderId: order.externalOrderId, orderDbId: order.id, vendor: manualVendor, trackingNumber: manualTracking.trim() });
      setMsg({ text: t(T.ship_marked_erli, { vendor: manualVendor }), ok: true });
      onChanged();
    } catch (e) {
      setMsg({ text: t(T.common_error_with_message, { message: translateMessage(e, t) }), ok: false });
    } finally {
      setBusy(false);
    }
  }

  async function nadaj(doPrint: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      if (isInpostTab) {
        const additionalServices = [
          addSms && "sms",
          addEmail && "email",
          addSaturday && "saturday",
          addRod && "rod",
          addReturnLabel && "rl",
        ].filter(Boolean) as string[];
        const commonArgs = {
          template: isLockerService(shipxService) ? lockerSize : null,
          lengthCm: Number(length),
          widthCm: Number(width),
          heightCm: Number(height),
          weightKg: Number(weight),
          sendingMethod: null,
          serviceOverride: shipxService,
          codAmount: cod && Number(cod) > 0 ? Number(cod) : null,
          insuranceAmount: insurance && Number(insurance) > 0 ? Number(insurance) : null,
          comments: content || null,
        };
        let res: { trackingNumber: string; labelPath: string; service: string };
        if (isInpostMerchant) {
          setMsg({ text: t(T.ship_creating_inpost_v2), ok: true });
          res = await invoke<{ trackingNumber: string; labelPath: string; service: string }>("create_inpost_merchant_shipment", { request: {
            account: order.accountName, // = organizationId
            orderId: order.externalOrderId,
            orderDbId: order.id,
            ...commonArgs,
          } });
        } else {
          setMsg({ text: t(T.ship_creating_shipx), ok: true });
          res = await invoke<{ shipmentId: string; trackingNumber: string; labelPath: string; service: string }>("create_inpost_shipment", { request: {
            login,
            orderId: order.externalOrderId,
            orderDbId: order.id,
            ...commonArgs,
            additionalServices,
          } });
        }
        if (doPrint && res.labelPath) {
          setMsg({ text: t(T.ship_printing), ok: true });
          await invoke("print_label", { pdfPath: res.labelPath, printerName: printer || null });
        }
        const note = res.labelPath ? "" : t(T.ship_label_generating);
        setMsg({ text: t(T.ship_sent, { service: res.service, n: res.trackingNumber, note }), ok: true });
        onChanged();
      } else {
        // „Wysyłam z Allegro" / „Inne": suggestedInput + ręcznie wybrana usługa.
        const input: any = {
          ...(suggestedInput ?? {}),
          packages: [{
            type: "PACKAGE",
            length: { value: Number(length), unit: "CENTIMETER" },
            width: { value: Number(width), unit: "CENTIMETER" },
            height: { value: Number(height), unit: "CENTIMETER" },
            weight: { value: Number(weight), unit: "KILOGRAMS" },
          }],
        };
        if (order.carrier === "inpost") {
          input.additionalServices = Array.from(new Set([...(input.additionalServices || []), "sendingAtPoint"]));
        }
        setMsg({ text: t(T.ship_creating_allegro), ok: true });
        const res = await invoke<{ shipmentId: string; shipmentIds: string[] }>("create_shipment", { login, orderId: order.externalOrderId, orderDbId: order.id, input, deliveryMethodId: allegroService || null });
        setMsg({ text: t(T.ship_getting_label), ok: true });
        const pdf = await invoke<string>("get_label", { login, shipmentIds: [res.shipmentId], pageSize: "A6", fileName: `${order.externalOrderId}_${res.shipmentId.slice(0, 8)}` });
        if (doPrint) await invoke("print_label", { pdfPath: pdf, printerName: printer || null });
        await invoke("mark_order_sent", { login, orderId: order.externalOrderId, orderDbId: order.id });
        setMsg({ text: t(T.ship_sent_allegro, { id: res.shipmentId }), ok: true });
        onChanged();
      }
    } catch (e) {
      console.error("create-error:", e);
      setMsg({ text: t(T.common_error_with_message, { message: translateMessage(e, t) }), ok: false });
    } finally {
      setBusy(false);
    }
  }

  const inputStyle: React.CSSProperties = {};
  const dimStyle: React.CSSProperties = {};
  const labelStyle: React.CSSProperties = {};

  return (
    <section className="shipment-form" aria-label="Nadanie przesyłki">
      {/* Zakładki kategorii — zawsze wszystkie cztery */}
      <header className="shipment-form__header">
        <div>
          <div className="shipment-form__eyebrow">Nadanie przesyłki</div>
          <div className="shipment-form__title">Wybierz sposób nadania</div>
        </div>
        <span className="shipment-form__source">{isErli ? "Erli" : isInpostMerchant ? "InPost Merchant" : "Allegro"}</span>
      </header>
      <div className="shipment-form__tabs" role="tablist" aria-label="Sposób nadania">
        {shipmentModules.map((tab) => (
          <button
            key={tab.key}
            onClick={() => selectTab(tab.key)}
            className={`shipment-form__tab${method === tab.key ? " is-active" : ""}`}
            role="tab"
            aria-selected={method === tab.key}
          >
            {tab.label}{tab.key === defaultMethod ? " ★" : ""}
          </button>
        ))}
      </div>

      <div className="shipment-form__body">
        {method === "manual" && (
          <div style={{ fontSize: 12, color: "var(--muted2)", marginBottom: 12 }}>
            {t(T.ship_manual_hint)}
          </div>
        )}

        {method === "erli" && (
          <div style={{ maxWidth: 640 }}>
            <label style={{ ...labelStyle, marginBottom: 12, display: "block" }}>
              {t(T.ship_method)}
              <select value={erliShippingType} onChange={(e) => setErliShippingType(e.target.value)} style={{ ...inputStyle, marginTop: 4, fontWeight: 600 }}>
                {ERLI_SHIPPING_GROUPS.map((g) => (
                  <optgroup key={g.group} label={g.group}>
                    {g.items.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, maxWidth: 440 }}>
              <label style={labelStyle}>{t(T.ship_weight)}<input value={weight} onChange={(e) => setWeight(e.target.value)} style={{ ...dimStyle, marginTop: 4 }} /></label>
              <label style={labelStyle}>{t(T.ship_length)}<input value={length} onChange={(e) => setLength(e.target.value)} style={{ ...dimStyle, marginTop: 4 }} /></label>
              <label style={labelStyle}>{t(T.ship_width)}<input value={width} onChange={(e) => setWidth(e.target.value)} style={{ ...dimStyle, marginTop: 4 }} /></label>
              <label style={labelStyle}>{t(T.ship_height)}<input value={height} onChange={(e) => setHeight(e.target.value)} style={{ ...dimStyle, marginTop: 4 }} /></label>
            </div>
            <div style={{ display: "flex", gap: 12, marginTop: 12, maxWidth: 560, flexWrap: "wrap" }}>
              <label style={{ ...labelStyle, flex: "1 1 220px" }}>
                {t(T.ship_posting_point)} {erliPoints.length === 0 && !loading ? t(T.ship_posting_point_note) : ""}
                <select value={erliPostingPoint} onChange={(e) => setErliPostingPoint(e.target.value)} style={{ ...inputStyle, marginTop: 4 }}>
                  <option value="">{t(T.ship_posting_point_default)}</option>
                  {erliPoints.map((p) => (
                    <option key={p.id} value={p.id}>#{p.id}{p.groupId ? ` · ${p.groupId}` : ""}{p.isDefault ? ` ${t(T.ship_point_default_suffix)}` : ""}</option>
                  ))}
                </select>
              </label>
              <label style={{ ...labelStyle, flex: "1 1 220px" }}>
                {t(T.ship_printer)}
                <select value={printer} onChange={(e) => setPrinter(e.target.value)} style={{ ...inputStyle, marginTop: 4 }}>
                  <option value="">{t(T.ship_printer_default)}</option>
                  {printers.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
            </div>
          </div>
        )}

        {method === "manual" && (
          <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 14, alignItems: "end", maxWidth: 560 }}>
            <label style={labelStyle}>
              {t(T.od_col_carrier)}
              <select value={manualVendor} onChange={(e) => setManualVendor(e.target.value)} style={{ ...inputStyle, marginTop: 4, fontWeight: 600 }}>
                {ERLI_VENDORS.map((v) => <option key={v.v} value={v.v}>{v.v === "ownTransport" ? t(T.ship_vendor_own) : v.v === "selfPickup" ? t(T.ship_vendor_pickup) : v.v === "other" ? t(T.ship_vendor_other) : v.label}</option>)}
              </select>
            </label>
            <label style={labelStyle}>
              {t(T.od_col_waybill)}
              <input value={manualTracking} onChange={(e) => setManualTracking(e.target.value)} style={{ ...inputStyle, marginTop: 4 }} />
            </label>
          </div>
        )}

        {method !== "manual" && method !== "erli" && (<>
        {/* Usługa — dla każdej kategorii pełna lista możliwości */}
        {method === "inpost_kurier" && (
          <label style={{ ...labelStyle, marginBottom: 14 }}>
            {t(T.ship_service)}
            <select value={shipxService} onChange={(e) => setShipxService(e.target.value)} style={{ ...inputStyle, marginTop: 4, fontWeight: 600 }}>
              {KURIER_SERVICES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
            </select>
          </label>
        )}
        {method === "inpost_paczkomat" && (
          <label style={{ ...labelStyle, marginBottom: 14 }}>
            {t(T.ship_service)}
            <select value={shipxService} onChange={(e) => setShipxService(e.target.value)} style={{ ...inputStyle, marginTop: 4, fontWeight: 600 }}>
              {PACZKOMAT_GROUPS.map((g) => (
                <optgroup key={g.group} label={g.group}>
                  {g.items.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
        )}
        {isAllegroTab && (
          <label style={{ ...labelStyle, marginBottom: 14 }}>
            {t(T.ship_service_delivery)} {services.length ? `(${services.length})` : loading ? t(T.ship_loading_paren) : ""}
            <select value={allegroService} onChange={(e) => setAllegroService(e.target.value)} style={{ ...inputStyle, marginTop: 4, fontWeight: 600 }}>
              {order.deliveryMethodId && !services.some((s) => s.deliveryMethodId === order.deliveryMethodId) && (
                <option value={order.deliveryMethodId}>{order.deliveryMethodName || t(T.ship_method_from_order)} {t(T.ship_from_order_suffix)}</option>
              )}
              {groupedServices.map(([carrier, list]) => (
                <optgroup key={carrier} label={carrier}>
                  {list.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
          {/* Lewa kolumna — info / gabaryt */}
          <div>
            {showGabaryt && (
              <div>
                <span style={labelStyle}>{t(T.ship_locker_size)}</span>
                <div style={{ marginTop: 5 }}>
                  {LOCKER_SIZES.map((s) => (
                    <label key={s.v} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text2)", marginBottom: 4, cursor: "pointer" }}>
                      <input type="radio" name="lockerSize" checked={lockerSize === s.v} onChange={() => chooseGabaryt(s.v)} />
                      {t(s.labelKey)}
                    </label>
                  ))}
                </div>
              </div>
            )}
            {isInpostTab && (
              <div style={{ marginTop: showGabaryt ? 14 : 0 }}>
                <div style={{ display: "flex", gap: 10 }}>
                  <label style={labelStyle}>
                    {t(T.ship_cod)}{isCod && <span style={{ color: "#16a34a", fontWeight: 700 }}> • {t(T.ship_cod_flag)}</span>}
                    <input value={cod} onChange={(e) => setCod(e.target.value)} placeholder="0.00" style={{ ...inputStyle, marginTop: 4 }} />
                  </label>
                  <label style={labelStyle}>
                    {t(T.ship_insurance)}
                    <input value={insurance} onChange={(e) => setInsurance(e.target.value)} placeholder="0.00" style={{ ...inputStyle, marginTop: 4 }} />
                  </label>
                </div>
                <div style={{ marginTop: 12 }}>
                  <span style={labelStyle}>{t(T.ship_extra_services)}</span>
                  <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 5 }}>
                    <Chk checked={addSms} onChange={setAddSms} label={t(T.ship_sms)} />
                    <Chk checked={addEmail} onChange={setAddEmail} label={t(T.ship_email)} />
                    {method === "inpost_kurier" && <Chk checked={addSaturday} onChange={setAddSaturday} label={t(T.ship_saturday)} />}
                    {method === "inpost_kurier" && <Chk checked={addRod} onChange={setAddRod} label={t(T.ship_rod)} />}
                    <Chk checked={addReturnLabel} onChange={setAddReturnLabel} label={t(T.ship_return_label)} />
                  </div>
                </div>
                <label style={{ ...labelStyle, marginTop: 12 }}>
                  {t(T.ship_content)}
                  <input value={content} onChange={(e) => setContent(e.target.value)} style={{ ...inputStyle, marginTop: 4 }} />
                </label>
              </div>
            )}
            {method === "inpost_kurier" && (
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{t(T.ship_courier_note)}</div>
            )}
          </div>

          {/* Prawa kolumna — wymiary i waga */}
          <div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>{t(T.ship_package_dims)}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
              <label style={labelStyle}>{t(T.ship_weight)}<input value={weight} onChange={(e) => setWeight(e.target.value)} style={{ ...dimStyle, marginTop: 4 }} /></label>
              <label style={labelStyle}>{t(T.ship_length)}<input value={length} onChange={(e) => setLength(e.target.value)} style={{ ...dimStyle, marginTop: 4 }} /></label>
              <label style={labelStyle}>{t(T.ship_width)}<input value={width} onChange={(e) => setWidth(e.target.value)} style={{ ...dimStyle, marginTop: 4 }} /></label>
              <label style={labelStyle}>{t(T.ship_height)}<input value={height} onChange={(e) => setHeight(e.target.value)} style={{ ...dimStyle, marginTop: 4 }} /></label>
            </div>
            <label style={{ ...labelStyle, marginTop: 14 }}>
              {t(T.ship_printer)}
              <select value={printer} onChange={(e) => setPrinter(e.target.value)} style={{ ...inputStyle, marginTop: 4 }}>
                <option value="">{t(T.ship_printer_default)}</option>
                {printers.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
          </div>
        </div>
        </>)}

        {msg && (
          <div style={{ marginTop: 14, padding: "9px 12px", borderRadius: "var(--radius-md)", fontSize: 12, border: "1px solid var(--color-divider)", background: "color-mix(in srgb, var(--color-text) 4%, transparent)", color: msg.ok ? "#4ade80" : "#f4515b" }}>
            {msg.text}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          {method === "erli" ? (
            <>
              <button disabled={busy || loading} onClick={() => nadajErli(true)} className="shipment-form__action shipment-form__action--primary">
                {busy ? t(T.ship_processing) : t(T.ship_send_print)}
              </button>
              <button disabled={busy || loading} onClick={() => nadajErli(false)} className="shipment-form__action shipment-form__action--secondary">
                {t(T.ship_send_noprint)}
              </button>
            </>
          ) : method === "manual" ? (
            <button disabled={busy} onClick={markShippedErli} className="shipment-form__action shipment-form__action--primary">
              {busy ? t(T.ship_processing) : t(T.ship_mark_erli)}
            </button>
          ) : (
            <>
              <button disabled={busy || loading} onClick={() => nadaj(true)} className="shipment-form__action shipment-form__action--primary">
                {busy ? t(T.ship_processing) : t(T.ship_send_print)}
              </button>
              <button disabled={busy || loading} onClick={() => nadaj(false)} className="shipment-form__action shipment-form__action--secondary">
                {t(T.ship_send_noprint)}
              </button>
            </>
          )}
        </div>

        {isInpostTab && !isInpostMerchant && !inpostConnected && (
          <div style={{ marginTop: 12, background: "color-mix(in srgb, var(--accent2) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--accent2) 40%, transparent)", borderRadius: "var(--radius-md)", padding: "9px 12px", fontSize: 12, color: "var(--text2)" }}>
            {t(T.ship_shipx_warning)}
          </div>
        )}
      </div>
    </section>
  );
}
