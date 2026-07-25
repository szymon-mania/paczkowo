// Wspólne filtry list (Zamówienia / Wysyłka): kanał + kurier + logotypy.
// Jeden zestaw komponentów, żeby obie strony wyglądały i działały identycznie.
import { useState, useRef } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { T, useI18n, type TFn } from "../lib/i18n";
import type { Order } from "../lib/types";

// ─── ETYKIETY KANAŁÓW ────────────────────────────────────────────────────────
const CHANNEL_LABEL: Record<string, string> = {
  allegro: "Allegro", erli: "Erli", amazon: "Amazon", ebay: "eBay", inpost_merchant: "InPost Merchant",
};
const CHANNEL_KEY: Record<string, T> = { woocommerce: T.channel_own_store, shopify: T.channel_own_store };

export function channelLabel(mkt: string | undefined, t: TFn) {
  if (!mkt) return "—";
  const k = mkt.toLowerCase();
  if (CHANNEL_KEY[k]) return t(CHANNEL_KEY[k]);
  return CHANNEL_LABEL[k] ?? mkt.charAt(0).toUpperCase() + mkt.slice(1);
}

export type ChannelOption = {
  value: string;
  platform: string;
  platformLabel: string;
  accountName: string;
  accountDisplayName: string;
  count: number;
};

export function channelAccountKey(order: Order) {
  return `${(order.marketplace ?? "").toLowerCase()}::${order.accountName ?? ""}`;
}
export function channelAccountLabel(order: Order) {
  return order.accountDisplayName || order.accountName || "Konto";
}

// Opcje kanału budowane z realnych rekordów (zamówienia albo przesyłki).
export function buildChannelOptions(orders: Order[], t: TFn): ChannelOption[] {
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
}

// ─── FILTRY PRZEWOŹNIKÓW (ogólne + szczegółowe) ───────────────────────────────
export const NORMC = (s?: string) => (s ?? "").toUpperCase().replace(/[\s_-]/g, "");
export type CourierDef = { id: string; label: string; carrier: string; aliases?: string[]; method?: string; logoSrc?: string };
export const COURIER_CATALOG: CourierDef[] = [
  { id: "inpost", label: "InPost", carrier: "inpost", logoSrc: "/logos/inpost.png" },
  { id: "dpd", label: "DPD", carrier: "dpd", logoSrc: "/logos/dpd.svg" },
  { id: "dhl", label: "DHL", carrier: "dhl", logoSrc: "/logos/dhl.svg" },
  { id: "ups", label: "UPS", carrier: "ups", logoSrc: "/logos/ups.svg" },
  { id: "orlen", label: "ORLEN Paczka", carrier: "orlen", aliases: ["ruch"], logoSrc: "/logos/orlen.svg" },
  { id: "poczta-polska", label: "Poczta Polska", carrier: "poczta_polska", aliases: ["poczta", "pocztex"], logoSrc: "/logos/poczta-polska.svg" },
  { id: "gls", label: "GLS", carrier: "gls", logoSrc: "/logos/gls.svg" },
  { id: "fedex", label: "FedEx", carrier: "fedex", logoSrc: "/logos/fedex.svg" },
  { id: "packeta", label: "Packeta", carrier: "packeta", logoSrc: "/logos/packeta.svg" },
  { id: "wedo", label: "WeDo", carrier: "wedo", logoSrc: "/logos/wedo.svg" },
  { id: "express-one", label: "Express One", carrier: "express_one", logoSrc: "/logos/express-one.svg" },
  { id: "allegro-one", label: "Allegro One", carrier: "allegro_one", logoSrc: "/logos/allegro-one.svg" },
  { id: "other", label: "Inny", carrier: "other" },
];

export function matchCourierDef(o: Order, def: CourierDef): boolean {
  const carrierKeys = [def.carrier, ...(def.aliases ?? [])].map(NORMC);
  if (!carrierKeys.includes(NORMC(o.carrier))) return false;
  if (def.method) return (o.deliveryMethodName ?? "").toLowerCase().includes(def.method);
  return true;
}

// Kurier przesyłki bywa zapisany opisowo („Allegro Paczkomaty InPost”, „ALLEGRO_INPOST”),
// więc poza dopasowaniem dokładnym sprawdzamy też, czy nazwa zawiera klucz przewoźnika.
export function courierIdForCarrier(carrier?: string): string {
  const key = NORMC(carrier);
  if (!key) return "other";
  const keysOf = (def: CourierDef) => [def.carrier, ...(def.aliases ?? [])].map(NORMC);
  const exact = COURIER_CATALOG.find((def) => keysOf(def).includes(key));
  if (exact) return exact.id;
  const partial = COURIER_CATALOG.find((def) => keysOf(def).some((k) => k.length >= 3 && key.includes(k)));
  return partial?.id ?? "other";
}

export function courierDefById(id: string) {
  return COURIER_CATALOG.find((def) => def.id === id) ?? null;
}

// ─── LOGOTYPY ────────────────────────────────────────────────────────────────
// Pliki z public/logos wypisane wprost — inaczej każdy render kończył się próbą
// pobrania nieistniejącego .svg (np. Erli ma tylko PNG) i zbędnym 404.
const PLATFORM_LOGO_SOURCES: Record<string, string[]> = {
  allegro: ["/logos/allegro.svg", "/logos/allegro.png"],
  erli: ["/logos/erli.png"],
  amazon: ["/logos/amazon.svg"],
  inpost: ["/logos/inpost.png"],
  inpost_merchant: ["/logos/inpost_merchant.png", "/logos/inpost.png"],
};

export function PlatformLogo({ platform, fallback, size = 26 }: { platform: string; fallback?: string; size?: number }) {
  const key = (platform || "").toLowerCase().replace(/-/g, "_");
  const sources = PLATFORM_LOGO_SOURCES[key] ?? [`/logos/${key}.svg`, `/logos/${key}.png`];
  // Licznik nieudanych źródeł jest wiązany z platformą: panel synchronizacji
  // podmienia platformę w tym samym komponencie (prepare → allegro → erli),
  // więc bez resetu logo raz „przepalone" na kroku bez pliku nigdy by nie wróciło.
  const [tried, setTried] = useState({ key, step: 0 });
  const step = tried.key === key ? tried.step : 0;
  const setStep = (next: number) => setTried({ key, step: next });
  if (!key || step >= sources.length) {
    const letter = (fallback ?? platform ?? "?").trim().charAt(0).toUpperCase() || "?";
    return (
      <span style={{ width: size, height: size, borderRadius: "var(--radius-sm)", background: "var(--color-accent-800)", color: "var(--color-accent-100)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 600, fontSize: size * 0.5 }}>
        {letter}
      </span>
    );
  }
  const src = sources[step];
  return <img key={`${key}:${src}`} src={src} alt={platform} width={size} height={size} style={{ objectFit: "contain", display: "block" }} onError={() => setStep(step + 1)} />;
}

export function CourierLogo({ courier }: { courier: CourierDef }) {
  const [failed, setFailed] = useState(false);
  if (!courier.logoSrc || failed) return <span className="ord-courier-logo-fallback">{courier.label.slice(0, 3).toUpperCase()}</span>;
  return <img src={courier.logoSrc} alt={`${courier.label} logo`} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}

// Popover renderowany w portalu (position: fixed) — nie jest obcinany przez
// przewijanie tabeli (overflow-x na karcie). Pozycja liczona z kotwicy.
export function PortalPopover({ anchor, onClose, align = "left", children }: { anchor: HTMLElement | null; onClose?: () => void; align?: "left" | "right"; children: React.ReactNode }) {
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

// ── Wyzwalacz filtra przewoźnika: kafle z logotypami + licznikami ──
export function CourierFilterPanel({ value, onChange, counts }: {
  value: string; onChange: (id: string) => void;
  counts: Record<string, number>;
}) {
  const { t } = useI18n();
  const activeDefs = COURIER_CATALOG.filter((d) => (counts[d.id] ?? 0) > 0);

  return (
    <div className="ord-courier-filter">
      <div className="ord-courier-grid">
        <button type="button" className="ord-courier-tile all" aria-label={t(T.ord_courier_all)} aria-pressed={value === "all"} onClick={() => onChange("all")}>
          <span className="ord-courier-all-mark">{t(T.ord_courier_all)}</span>
          <span className="ord-courier-count">{counts.all ?? 0}</span>
        </button>
        {activeDefs.map((d) => (
          <button key={d.id} type="button" className="ord-courier-tile" aria-label={d.label} aria-pressed={value === d.id} title={d.label} onClick={() => onChange(d.id)}>
            <span className="ord-courier-logo"><CourierLogo courier={d} /></span>
            <span className="ord-courier-count">{counts[d.id] ?? 0}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Filtr kont z wielokrotnym wyborem (ten sam wygląd co filtr kanału) ──
// Lista pozycji jest stała — konta bez wyników zostają widoczne z licznikiem 0,
// żeby filtr nie „skakał" przy zmianie innych filtrów.
export function AccountFilterMulti({ selected, options, onChange, id = "ord-accounts" }: {
  selected: Set<string>; options: ChannelOption[]; onChange: (next: Set<string>) => void; id?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const chosen = options.filter((option) => selected.has(option.value));
  const single = chosen.length === 1 ? chosen[0] : null;

  const toggle = (value: string) => {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value); else next.add(value);
    onChange(next);
  };

  return (
    <div className="order-channel-filter">
      <button
        ref={buttonRef}
        type="button"
        id={id}
        className="order-channel-filter-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {single ? (
          <span className="order-channel-filter-label">
            <PlatformLogo platform={single.platform} fallback={single.platformLabel} size={20} />
            <span className="order-channel-copy">
              <strong>{single.platformLabel}</strong>
              <small>{single.accountDisplayName || single.accountName || "Konto"}</small>
            </span>
          </span>
        ) : (
          <span>{chosen.length === 0 ? t(T.common_all) : t(T.filter_accounts_n, { n: chosen.length })}</span>
        )}
        <ChevronDown size={15} />
      </button>
      {open && (
        <PortalPopover anchor={buttonRef.current} onClose={() => setOpen(false)}>
          <div className="order-channel-menu" role="listbox" aria-multiselectable="true" aria-labelledby={id}>
            <button type="button" className="ord-pop-item order-channel-option" aria-selected={chosen.length === 0} onClick={() => onChange(new Set())}>
              <span className={"ord-check" + (chosen.length === 0 ? " on" : "")}>{chosen.length === 0 && <Check size={11} strokeWidth={3} />}</span>
              <span>{t(T.common_all)}</span>
            </button>
            {options.map((option) => {
              const on = selected.has(option.value);
              return (
                <button key={option.value} type="button" className={"ord-pop-item order-channel-option" + (option.count === 0 ? " empty" : "")} aria-selected={on} onClick={() => toggle(option.value)}>
                  <span className={"ord-check" + (on ? " on" : "")}>{on && <Check size={11} strokeWidth={3} />}</span>
                  <PlatformLogo platform={option.platform} fallback={option.platformLabel} size={22} />
                  <span className="order-channel-copy">
                    <strong>{option.platformLabel}</strong>
                    <small>{option.accountDisplayName || option.accountName || "Konto"}</small>
                  </span>
                  <span className="ord-pop-count">{option.count}</span>
                </button>
              );
            })}
          </div>
        </PortalPopover>
      )}
    </div>
  );
}

// ── Filtr kanału: platforma + konto w jednym wyborze ──
export function ChannelFilterSelect({ value, options, onChange, id = "ord-channel" }: {
  value: string; options: ChannelOption[]; onChange: (value: string) => void; id?: string;
}) {
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
        id={id}
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
          <div className="order-channel-menu" role="listbox" aria-labelledby={id}>
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
