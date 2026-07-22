import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CalendarClock, Check, MapPin, PackageCheck, Truck } from "lucide-react";
import type { Account } from "../lib/types";
import CourierAccounts from "../components/CourierAccounts";
import { CommerceHeader, CommercePage } from "../components/CommerceUi";
import { getIntegrations, type Integration } from "../lib/accountApi";
import { T, localeOf, translateMessage, useI18n } from "../lib/i18n";

type Pickup = { login: string; pickupId?: string; date?: string; minTime?: string; maxTime?: string; count?: number; createdAt?: string };
type PickupTime = { date: string; minTime?: string; maxTime?: string };
type CarrierGroup = { carrier: string; program?: string; label?: string; shipmentIds: string[]; count: number };
type Prep = { groups: CarrierGroup[]; carriers: string[]; address: any };
type Created = { orderId: string; shipmentId: string; carrier: string; program?: string; waybill?: string; createdDate?: string; canceled: boolean; pickupAvailable: boolean; status: string };
type Service = { deliveryMethodId?: string; name?: string; carrierId?: string; realCarrier?: string; owner?: string };

const norm = (s: string) => (s ?? "").toUpperCase().replace(/[\s_]/g, "");
const isInpostCarrier = (s: string) => /INPOST|PACZKOMAT/.test(norm(s));
function nextBusinessDate() {
  const date = new Date();
  const day = date.getDay();
  if (day === 6) date.setDate(date.getDate() + 2);
  if (day === 0) date.setDate(date.getDate() + 1);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// Cache modułowy (przeżywa odmontowanie zakładki) — klucz = login konta Allegro.
type CourierCacheEntry = { created?: Created[]; services?: Service[]; prep?: Prep | null };
const courierCache: Record<string, CourierCacheEntry> = {};
let pickupsCache: Pickup[] | null = null;
function putCache(login: string, patch: CourierCacheEntry) {
  courierCache[login] = { ...(courierCache[login] ?? {}), ...patch };
}

function fmt(iso: string | undefined, locale: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(locale, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
/** „2026-07-15" → „śr, 15.07" (przy nieznanym formacie zwraca surową wartość). */
function dateLabel(date: string, locale: string) {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString(locale, { weekday: "short", day: "2-digit", month: "2-digit" });
}
const windowLabel = (slot: PickupTime, allDay: string) => (slot.minTime && slot.maxTime ? `${slot.minTime} – ${slot.maxTime}` : allDay);

// ─── ŹRÓDŁA ZAMAWIANIA KURIERA ────────────────────────────────────────────────
type SourceKind = "allegro" | "erli" | "inpost";
type Source = { key: string; kind: SourceKind; label: string; account?: string; available: boolean };

const SOURCE_META: Record<SourceKind, { name: string; noteKey: T }> = {
  allegro: { name: "Allegro", noteKey: T.cp_src_allegro_note },
  erli: { name: "Erli", noteKey: T.cp_src_erli_note },
  inpost: { name: "InPost ShipX", noteKey: T.cp_src_inpost_note },
};

// Małe logo źródła: /logos/<kind>.svg → .png → litera na tle akcentu.
function SrcLogo({ kind, size = 34 }: { kind: SourceKind; size?: number }) {
  const [step, setStep] = useState(0);
  const meta = SOURCE_META[kind];
  if (step >= 2) {
    return (
      <span style={{ width: size, height: size, borderRadius: 8, background: "var(--color-accent-800)", color: "var(--color-accent-100)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 600, fontSize: size * 0.5 }}>
        {meta.name[0]}
      </span>
    );
  }
  const src = step === 0 ? `/logos/${kind}.svg` : `/logos/${kind}.png`;
  return <img key={src} src={src} alt={meta.name} width={size} height={size} style={{ objectFit: "contain", display: "block" }} onError={() => setStep((s) => s + 1)} />;
}

// ─── ZNACZNIK PRZEWOŹNIKA ─────────────────────────────────────────────────────
// Skrót + barwa marki. Kolor wchodzi do CSS jako --brand i jest mieszany z kolorem
// tekstu, więc znaczek pozostaje czytelny w obu motywach (np. żółć InPostu na bieli).
const CARRIER_BRANDS: { match: RegExp; short: string; color: string }[] = [
  { match: /INPOST|PACZKOMAT/, short: "InPost", color: "#ffcc00" },
  { match: /DPD/, short: "DPD", color: "#dc0032" },
  { match: /DHL/, short: "DHL", color: "#fecc00" },
  { match: /UPS/, short: "UPS", color: "#c8922f" },
  { match: /POCZTA/, short: "Poczta", color: "#e30613" },
  { match: /ORLEN|RUCH/, short: "ORLEN", color: "#e2231a" },
  { match: /GLS/, short: "GLS", color: "#f5c400" },
  { match: /FEDEX/, short: "FedEx", color: "#8e5bd6" },
  { match: /PACKETA|ZASILKOVNA/, short: "Packeta", color: "#e2495b" },
  { match: /WEDO/, short: "WeDo", color: "#00a0e3" },
  { match: /EXPRESSONE/, short: "ExpressOne", color: "#e2001a" },
  { match: /ALLEGROONE/, short: "One", color: "#ff5a00" },
  { match: /ALLEGRO/, short: "Allegro", color: "#ff5a00" },
];
function brandOf(carrier: string) {
  const key = norm(carrier);
  return CARRIER_BRANDS.find((b) => b.match.test(key));
}
const brandStyle = (carrier: string) => {
  const brand = brandOf(carrier);
  return brand ? { ["--brand" as any]: brand.color } : undefined;
};
function CarrierMark({ carrier }: { carrier: string }) {
  const text = brandOf(carrier)?.short ?? (carrier || "—").slice(0, 8);
  return <span className="cp-mark" style={brandStyle(carrier)}>{text}</span>;
}

export default function CourierPickup({ accounts }: { accounts: Account[] }) {
  const { t } = useI18n();
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  useEffect(() => { getIntegrations().then(setIntegrations).catch(() => {}); }, []);

  const accountLabels = useMemo(() => {
    const map = new Map<string, string>();
    integrations.forEach((integration) => {
      if (integration.accountKey) map.set(integration.accountKey, integration.accountName);
    });
    accounts.forEach((account) => {
      const integration = integrations.find((item) => item.id === account.integrationId);
      if (integration) map.set(account.login, integration.accountName);
    });
    return map;
  }, [accounts, integrations]);
  const accountLabel = (login: string) => accountLabels.get(login) || login;

  const sources: Source[] = useMemo(() => {
    const list: Source[] = [];
    accounts.forEach((a) => list.push({ key: `allegro:${a.login}`, kind: "allegro", label: accountLabel(a.login), account: a.login, available: true }));
    integrations.filter((i) => i.platform === "erli").forEach((i) => list.push({ key: `erli:${i.accountKey ?? i.accountName}`, kind: "erli", label: i.accountName, account: i.accountKey ?? i.accountName, available: true }));
    if (integrations.some((i) => i.platform === "inpost")) list.push({ key: "inpost", kind: "inpost", label: "InPost ShipX", available: true });
    return list;
  }, [accounts, integrations, accountLabels]);

  const [selKey, setSelKey] = useState<string | null>(() => localStorage.getItem("courierSource"));
  const [choosing, setChoosing] = useState(false);
  const sel = sources.find((s) => s.key === selKey && s.available) ?? null;
  const pick = (key: string) => { setSelKey(key); localStorage.setItem("courierSource", key); setChoosing(false); };

  // Pierwsza konfiguracja: brak wyboru (lub niedostępny) → ekran wyboru źródła.
  const showChooser = choosing || !sel;

  return (
    <CommercePage>
        <CommerceHeader title={t(T.nav_courier)} subtitle={t(T.cp_subtitle)} />

        {showChooser ? (
          <SourceChooser sources={sources} current={selKey} onPick={pick} />
        ) : (
          <>
            <SourceBar source={sel!} onChange={() => setChoosing(true)} />
            {sel!.kind === "allegro" && <AllegroPickupPanel login={sel!.account!} accountName={sel!.label} accountLabels={accountLabels} />}
            {sel!.kind === "erli" && <SourcePlaceholder kind="erli" />}
            {sel!.kind === "inpost" && <SourcePlaceholder kind="inpost" />}
          </>
        )}

        {/* Konta w systemach kurierskich (połączenia) */}
        <CourierAccounts accounts={accounts} accountLabels={accountLabels} />
    </CommercePage>
  );
}

// ─── Ekran wyboru źródła ──────────────────────────────────────────────────────
function SourceChooser({ sources, current, onPick }: { sources: Source[]; current: string | null; onPick: (key: string) => void }) {
  const { t } = useI18n();
  return (
    <div className="card elev-sm" style={{ marginBottom: 22 }}>
      <div className="card-kicker">{t(T.cp_source_kicker)}</div>
      <div className="card-title">{t(T.cp_source_title)}</div>
      <div className="courier-source-grid">
        {sources.map((s) => {
          const meta = SOURCE_META[s.kind];
          const active = s.key === current && s.available;
          return (
            <button key={s.key} type="button" disabled={!s.available} onClick={() => onPick(s.key)}
              className={`courier-source-tile${active ? " active" : ""}`}>
              <SrcLogo kind={s.kind} size={36} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{meta.name}</div>
                {(s.kind === "allegro" || s.kind === "erli") && <div className="text-muted" style={{ fontSize: 11 }}>{t(T.cp_account_label, { name: s.label })}</div>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Pasek aktywnego źródła ───────────────────────────────────────────────────
function SourceBar({ source, onChange }: { source: Source; onChange: () => void }) {
  const { t } = useI18n();
  const meta = SOURCE_META[source.kind];
  return (
    <div className="courier-source-bar">
      <SrcLogo kind={source.kind} size={30} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="card-kicker" style={{ marginBottom: 2 }}>{t(T.cp_source_kicker)}</div>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{meta.name}{source.label ? ` - ${source.label}` : ""}</div>
      </div>
      <button type="button" onClick={onChange} className="btn btn-secondary" style={{ fontSize: 12 }}>{t(T.cp_change_source)}</button>
    </div>
  );
}

// ─── Placeholder dla źródeł bez odbioru przez API ─────────────────────────────
function SourcePlaceholder({ kind }: { kind: SourceKind }) {
  const { t } = useI18n();
  const meta = SOURCE_META[kind];
  const body: Partial<Record<SourceKind, T>> = {
    erli: T.cp_ph_erli,
    inpost: T.cp_ph_inpost,
  };
  return (
    <div className="card elev-sm" style={{ marginBottom: 22 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 6 }}>
        <SrcLogo kind={kind} size={32} />
        <div style={{ fontWeight: 600, fontSize: 15 }}>{meta.name}</div>
      </div>
      <div className="text-muted" style={{ fontSize: 13, lineHeight: 1.5, background: "color-mix(in srgb, var(--color-text) 4%, transparent)", border: "1px solid var(--color-divider)", borderRadius: "var(--radius-md)", padding: "12px 14px" }}>{body[kind] ? t(body[kind]!) : ""}</div>
    </div>
  );
}

// ─── Panel odbioru Allegro (Wysyłam z Allegro) ────────────────────────────────
function AllegroPickupPanel({ login, accountName, accountLabels }: { login: string; accountName: string; accountLabels: Map<string, string> }) {
  const { t, lang } = useI18n();
  const locale = localeOf(lang);
  const initCache = courierCache[login];
  const [created, setCreated] = useState<Created[]>(initCache?.created ?? []);
  const [createdLoading, setCreatedLoading] = useState(!initCache?.created);
  const [pickups, setPickups] = useState<Pickup[]>(pickupsCache ?? []);

  const [services, setServices] = useState<Service[]>(initCache?.services ?? []);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [prep, setPrep] = useState<Prep | null>(initCache?.prep ?? null);
  const [prepLoading, setPrepLoading] = useState(false);

  // Wybór: przewoźnik (klucz znormalizowany) + zaznaczone przesyłki tego przewoźnika.
  const [carrierKey, setCarrierKey] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [times, setTimes] = useState<PickupTime[]>([]);
  const [dateIdx, setDateIdx] = useState(0);
  const [slotIdx, setSlotIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  async function loadCourierData() {
    if (!login) return;
    const c = courierCache[login];
    if (!c?.created) setCreatedLoading(true);
    if (!c?.prep) setPrepLoading(true);
    try {
      const d = await invoke<{ created: Created[]; prep: Prep }>("get_courier_data", { login });
      setCreated(d.created); setPrep(d.prep);
      putCache(login, { created: d.created, prep: d.prep });
    } catch (e) {
      setMsg({ text: t(T.cp_err_load, { e: translateMessage(e, t) }), ok: false });
    } finally {
      setCreatedLoading(false); setPrepLoading(false);
    }
  }
  async function loadPickups() {
    try { const p = await invoke<Pickup[]>("get_pickups"); setPickups(p ?? []); pickupsCache = p ?? []; } catch (e) { console.error("get_pickups", e); }
  }
  async function loadServices() {
    if (!login) return;
    if (!courierCache[login]?.services?.length) setServicesLoading(true);
    try {
      const s = await invoke<Service[]>("get_delivery_services", { login });
      setServices(s); putCache(login, { services: s });
    } catch (e) { console.error("get_delivery_services", e); } finally { setServicesLoading(false); }
  }

  useEffect(() => {
    const c = courierCache[login];
    setCreated(c?.created ?? []); setServices(c?.services ?? []); setPrep(c?.prep ?? null);
    setCarrierKey(null); setPicked(new Set()); setTimes([]); setMsg(null);
    loadCourierData(); loadServices(); loadPickups();
    /* eslint-disable-next-line */
  }, [login]);

  // Przesyłki czekające na odbiór — z grup przygotowania, wzbogacone o nr zamówienia
  // i list przewozowy z listy utworzonych przesyłek (te same metadane po stronie backendu).
  const metaById = useMemo(() => new Map(created.map((c) => [c.shipmentId, c])), [created]);
  const rows = useMemo(() => {
    const list = (prep?.groups ?? []).flatMap((g) =>
      g.shipmentIds.map((shipmentId) => {
        const meta = metaById.get(shipmentId);
        return { shipmentId, carrier: g.carrier, program: g.program, orderId: meta?.orderId, waybill: meta?.waybill };
      }),
    );
    return list.sort((a, b) => a.carrier.localeCompare(b.carrier) || (a.orderId ?? "").localeCompare(b.orderId ?? ""));
  }, [prep, metaById]);

  // Przewoźnicy: ci z paczkami do odbioru + wszyscy dostępni na koncie (usługi dostawy).
  const carriers = useMemo(() => {
    const map = new Map<string, { key: string; label: string; count: number }>();
    const add = (label: string, count = 0) => {
      const key = norm(label);
      if (!key || key === "—") return;
      const cur = map.get(key);
      if (cur) { cur.count += count; if (count && cur.label.length > label.length) cur.label = label; }
      else map.set(key, { key, label, count });
    };
    (prep?.groups ?? []).forEach((g) => add(g.carrier, g.count));
    services.forEach((s) => add(s.realCarrier || s.carrierId || ""));
    (prep?.carriers ?? []).forEach((c) => add(c));
    return Array.from(map.values()).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [prep, services]);

  const carrierRows = useMemo(() => rows.filter((r) => norm(r.carrier) === carrierKey), [rows, carrierKey]);
  const selCarrier = carriers.find((c) => c.key === carrierKey) ?? null;
  const pickedIds = useMemo(() => carrierRows.filter((r) => picked.has(r.shipmentId)).map((r) => r.shipmentId), [carrierRows, picked]);

  /** Wybór przewoźnika = zaznaczenie wszystkich jego przesyłek (odbiór dotyczy jednego przewoźnika). */
  function selectCarrier(key: string) {
    setCarrierKey(key);
    setPicked(new Set(rows.filter((r) => norm(r.carrier) === key).map((r) => r.shipmentId)));
    setMsg(null);
  }
  function toggleRow(shipmentId: string, carrier: string) {
    const key = norm(carrier);
    if (key !== carrierKey) { setCarrierKey(key); setPicked(new Set([shipmentId])); setMsg(null); return; }
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(shipmentId)) next.delete(shipmentId); else next.add(shipmentId);
      return next;
    });
  }

  // Pierwszy przewoźnik z paczkami wybiera się sam — ekran jest od razu gotowy do zamówienia.
  useEffect(() => {
    if (carrierKey || rows.length === 0) return;
    selectCarrier(norm(rows[0].carrier));
    /* eslint-disable-next-line */
  }, [rows, carrierKey]);

  // Terminy pobieramy dla całego zestawu przewoźnika (propozycje nie zależą od podzbioru paczek).
  useEffect(() => {
    let alive = true;
    const ids = rows.filter((r) => norm(r.carrier) === carrierKey).map((r) => r.shipmentId);
    if (!prep || !carrierKey || ids.length === 0) { setTimes([]); return; }
    setBusy(true); setTimes([]);
    invoke<PickupTime[]>("get_pickup_times", { login, shipmentIds: ids, address: prep.address })
      .then((slots) => {
        if (!alive) return;
        const nextSlots = slots?.length ? slots : selCarrier && isInpostCarrier(selCarrier.label) ? [{ date: nextBusinessDate() }] : [];
        setTimes(nextSlots); setDateIdx(0); setSlotIdx(0);
        if (nextSlots.length === 0) setMsg({ text: t(T.cp_no_slots), ok: false });
      })
      .catch((e) => { if (alive) setMsg({ text: t(T.cp_err_slots, { e: translateMessage(e, t) }), ok: false }); })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
    /* eslint-disable-next-line */
  }, [carrierKey, prep, selCarrier?.label]);

  const dates = useMemo(() => Array.from(new Set(times.map((s) => s.date))), [times]);
  const dIdx = Math.min(dateIdx, Math.max(0, dates.length - 1));
  const daySlots = useMemo(() => times.filter((s) => s.date === dates[dIdx]), [times, dates, dIdx]);
  const slot = daySlots[Math.min(slotIdx, Math.max(0, daySlots.length - 1))];

  async function order() {
    if (!prep || !selCarrier || !slot || pickedIds.length === 0) return;
    const carrier = selCarrier.label;
    setBusy(true); setMsg(null);
    try {
      const res = await invoke<{ pickupId: string; pickups?: number }>("create_pickup", { request: {
        login, carrier, shipmentIds: pickedIds, date: slot.date, minTime: slot.minTime ?? null, maxTime: slot.maxTime ?? null, address: prep.address,
      } });
      const extra = res.pickups && res.pickups > 1 ? t(T.cp_ordered_split, { n: res.pickups }) : "";
      setMsg({ text: t(T.cp_ordered, { carrier, extra, id: res.pickupId }), ok: true });
      setPicked(new Set());
      loadPickups(); loadCourierData();
    } catch (e) { setMsg({ text: t(T.common_error_with_message, { message: translateMessage(e, t) }), ok: false }); } finally { setBusy(false); }
  }

  const a = prep?.address ?? {};
  const addrLine = [a.name || a.company, a.street, [a.postalCode, a.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || "—";
  const allPicked = carrierRows.length > 0 && pickedIds.length === carrierRows.length;
  const canOrder = !busy && !!selCarrier && pickedIds.length > 0 && !!slot;

  return (
    <>
      <div className="cp-layout">
        {/* Lista przesyłek czekających na odbiór */}
        <div className="card elev-sm cp-card">
          <div className="cp-head">
            <Truck size={15} />
            <h3>{t(T.cp_suggested)}</h3>
            <span className="cp-count">
              {prepLoading ? t(T.cp_checking_parcels) : t(T.cp_selected_of, { n: pickedIds.length, total: rows.length })}
            </span>
            <button type="button" className="cp-linkbtn" disabled={carrierRows.length === 0}
              onClick={() => setPicked(allPicked ? new Set() : new Set(carrierRows.map((r) => r.shipmentId)))}>
              {allPicked ? t(T.cp_clear_sel) : t(T.cp_select_all)}
            </button>
          </div>

          {rows.length === 0 ? (
            <div className="cp-empty">{prepLoading ? t(T.cp_checking_parcels) : t(T.cp_no_ready)}</div>
          ) : (
            <div className="cp-rows">
              {rows.map((r) => {
                const active = norm(r.carrier) === carrierKey;
                const on = active && picked.has(r.shipmentId);
                return (
                  <button key={r.shipmentId} type="button" onClick={() => toggleRow(r.shipmentId, r.carrier)}
                    className={`cp-row${on ? " on" : ""}${active ? "" : " dim"}`}>
                    <span className="cp-box">{on && <Check size={12} strokeWidth={3} />}</span>
                    <span className="cp-oid">#{(r.orderId ?? r.shipmentId).slice(0, 8).toUpperCase()}</span>
                    <span className="cp-way">{r.waybill || r.program || "—"}</span>
                    <CarrierMark carrier={r.carrier} />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Szczegóły odbioru */}
        <aside className="card elev-sm cp-side">
          <div className="cp-kicker">{t(T.cp_details_kicker)}</div>

          <div className="cp-field">
            <label>{t(T.cp_col_carrier)}{servicesLoading && carriers.length === 0 ? t(T.cp_loading_suffix) : ""}</label>
            <div className="cp-carriers">
              {carriers.map((c) => (
                <button key={c.key} type="button" onClick={() => selectCarrier(c.key)}
                  className={`cp-carrier${c.key === carrierKey ? " on" : ""}`} style={brandStyle(c.label)}>
                  <i className="cp-dot" />
                  <b>{c.label}</b>
                  {c.count > 0 && <span>{c.count}</span>}
                </button>
              ))}
              {carriers.length === 0 && <div className="cp-hint">{prepLoading || servicesLoading ? t(T.cp_checking_parcels) : "—"}</div>}
            </div>
          </div>

          <div className="cp-field">
            <label>{t(T.cp_date_label)}</label>
            <select className="input" value={dIdx} disabled={dates.length === 0}
              onChange={(e) => { setDateIdx(Number(e.target.value)); setSlotIdx(0); }}>
              {dates.length === 0 && <option value={0}>{busy ? t(T.cp_fetching_slots) : "—"}</option>}
              {dates.map((d, i) => <option key={d} value={i}>{dateLabel(d, locale)}</option>)}
            </select>
          </div>

          <div className="cp-field">
            <label>{t(T.cp_col_hours)}</label>
            <select className="input" value={Math.min(slotIdx, Math.max(0, daySlots.length - 1))} disabled={daySlots.length === 0}
              onChange={(e) => setSlotIdx(Number(e.target.value))}>
              {daySlots.length === 0 && <option value={0}>{busy ? t(T.cp_fetching_slots) : "—"}</option>}
              {daySlots.map((s, i) => <option key={`${s.minTime}-${s.maxTime}-${i}`} value={i}>{windowLabel(s, t(T.cp_slot_all_day))}</option>)}
            </select>
          </div>

          <div className="cp-addr"><MapPin size={14} /><span>{t(T.cp_pickup_address, { addr: addrLine })}</span></div>

          <button type="button" onClick={order} disabled={!canOrder} className="btn btn-primary cp-cta">
            {busy ? t(T.cp_processing) : t(T.cp_order_cta, { n: pickedIds.length })}
          </button>

          {!carrierKey && <div className="cp-hint">{t(T.cp_pick_carrier_hint)}</div>}
          {selCarrier && carrierRows.length === 0 && !prepLoading && (
            <div className="cp-note">{t(T.cp_no_parcels_warn, { carrier: selCarrier.label })}</div>
          )}
          {carrierRows.length > 0 && <div className="cp-hint">{t(T.cp_one_carrier_note)}</div>}
          {msg && <div className={`cp-note ${msg.ok ? "good" : "bad"}`}>{msg.text}</div>}
        </aside>
      </div>

      {/* Utworzone przesyłki */}
      <div className="card elev-sm courier-table-card">
        <div className="courier-table-title"><PackageCheck size={15} /><span>{t(T.cp_created_title, { login: accountName })}</span></div>
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ paddingLeft: "var(--space-4)" }}>{t(T.cp_col_created)}</th>
                <th>{t(T.cp_col_order)}</th>
                <th>{t(T.cp_col_waybill)}</th>
                <th>{t(T.cp_col_carrier)}</th>
                <th style={{ paddingRight: "var(--space-4)" }}>{t(T.cp_col_status)}</th>
              </tr>
            </thead>
            <tbody>
              {createdLoading ? (
                <tr><td colSpan={5} className="text-muted" style={{ padding: 22, textAlign: "center" }}>{t(T.cp_loading_shipments)}</td></tr>
              ) : created.length === 0 ? (
                <tr><td colSpan={5} className="text-muted" style={{ padding: 22, textAlign: "center" }}>{t(T.cp_no_created)}</td></tr>
              ) : (
                created.map((s, i) => (
                  <tr key={i}>
                    <td className="text-muted" style={{ paddingLeft: "var(--space-4)", fontSize: 12 }}>{fmt(s.createdDate, locale)}</td>
                    <td style={{ color: "var(--accent)" }}>#{s.orderId.slice(0, 8).toUpperCase()}</td>
                    <td style={{ fontFamily: "ui-monospace, monospace", color: s.waybill ? "var(--text)" : "var(--muted2)" }}>{s.waybill || "—"}</td>
                    <td><CarrierMark carrier={s.carrier} /></td>
                    <td style={{ paddingRight: "var(--space-4)", color: s.canceled ? "#f4515b" : "#4ade80" }}>{s.status}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Historia zleceń kuriera */}
      <div className="card elev-sm courier-table-card">
        <div className="courier-table-title"><CalendarClock size={15} /><span>{t(T.cp_pickups_title)}</span></div>
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ paddingLeft: "var(--space-4)" }}>{t(T.cp_col_pickup_date)}</th>
                <th>{t(T.cp_col_account)}</th>
                <th>{t(T.cp_col_hours)}</th>
                <th>{t(T.cp_col_pickup_id)}</th>
                <th className="ord-th-num" style={{ paddingRight: "var(--space-4)" }}>{t(T.cp_col_count)}</th>
              </tr>
            </thead>
            <tbody>
              {pickups.length === 0 ? (
                <tr><td colSpan={5} className="text-muted" style={{ padding: 22, textAlign: "center" }}>{t(T.cp_no_pickups)}</td></tr>
              ) : (
                pickups.map((p, i) => (
                  <tr key={i}>
                    <td className="text-muted" style={{ paddingLeft: "var(--space-4)" }}>{fmt(p.createdAt, locale)}</td>
                    <td>{accountLabels.get(p.login) || p.login}</td>
                    <td>{p.date}{p.minTime && p.maxTime ? ` · ${p.minTime}–${p.maxTime}` : ""}</td>
                    <td style={{ fontFamily: "ui-monospace, monospace", color: "var(--accent)" }}>{p.pickupId || "—"}</td>
                    <td className="ord-td-num" style={{ paddingRight: "var(--space-4)" }}>{p.count ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
