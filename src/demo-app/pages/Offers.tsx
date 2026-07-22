import { useEffect, useState } from "react";
import { CheckCircle2, CirclePause, CircleStop, Pencil, Play, Plus, RefreshCw, Search, SlidersHorizontal, Trash2 } from "lucide-react";

import AllegroOfferEditor from "../components/AllegroOfferEditor";
import InpostMerchantOfferEditor from "../components/InpostMerchantOfferEditor";
import ErliOfferEditor from "../components/ErliOfferEditor";
import { CommerceHeader, CommerceModal, CommercePage, CommercePagination, EmptyTable, Field, KpiStrip, StatusPill } from "../components/CommerceUi";
import { createMarketplaceOfferDraft, changeOfferStatus, deleteOffer, getMarketplaceOfferDetails, listOffers, pushMarketplaceOffer, saveMarketplaceOfferDetails, saveOffer, syncMarketplaceOfferPlatform, uploadMarketplaceOfferImage, type JsonObject, type Offer, type OfferDetails, type OfferListResponse, type OfferStatus, type OfferSyncResult, type SaveOffer } from "../lib/commerceApi";
import { getIntegrations, type Integration } from "../lib/accountApi";
import { formatCurrencyTotals } from "../lib/commerceFormat";
import { T, translateMessage, useI18n } from "../lib/i18n";
import { clearSyncProgress, OFFER_SYNC_PROGRESS_KEY, readSyncProgress, syncProgressPercent, writeSyncProgress, type SyncProgressState, type SyncProgressStep, type SyncStepStatus } from "../lib/syncProgress";

// VAT column: pokaż tylko poprawne stawki (cyfra, cyfra z %, np. 0.23).
// UNKNOWN / pusta / nierozpoznana wartość => "-".
const formatTaxRate = (raw: string): string => {
  const value = (raw ?? "").trim();
  if (!value || value.toUpperCase() === "UNKNOWN") return "-";
  if (/^\d+(\.\d+)?%?$/.test(value)) return value.endsWith("%") ? value : `${value}%`;
  return value;
};

const OFFER_SYNC_PLATFORMS = new Set(["allegro", "erli", "inpost_merchant"]);

const LOGO_SOURCES: Record<string, string[]> = {
  allegro: ["/logos/allegro.svg", "/logos/allegro.png"],
  erli: ["/logos/erli.svg", "/logos/erli.png"],
  inpost_merchant: ["/logos/inpost-merchant.svg", "/logos/inpost-merchant.png", "/logos/inpost_merchant.svg", "/logos/inpost_merchant.png", "/logos/inpost.svg", "/logos/inpost.png"],
  inpost: ["/logos/inpost.svg", "/logos/inpost.png"],
  amazon: ["/logos/amazon.svg", "/logos/amazon.png"],
};

function OfferPlatformLogo({ platform, label }: { platform: string; label: string }) {
  const sources = LOGO_SOURCES[platform] ?? [`/logos/${platform}.svg`, `/logos/${platform}.png`];
  const [index, setIndex] = useState(0);
  const src = sources[index];
  if (!src) {
    return <span className="offer-filter-logo-fallback" title={label}>{label.charAt(0).toUpperCase()}</span>;
  }
  return <img className="offer-filter-logo" src={src} alt={label} title={label} onError={() => setIndex((value) => value + 1)} />;
}

const emptyOfferSyncResult = (): OfferSyncResult => ({ accountsSynced: 0, fetched: 0, saved: 0, conflicts: 0, failedPlatforms: [] });
const mergeOfferSyncResult = (left: OfferSyncResult, right: OfferSyncResult): OfferSyncResult => ({
  accountsSynced: left.accountsSynced + right.accountsSynced,
  fetched: left.fetched + right.fetched,
  saved: left.saved + right.saved,
  conflicts: left.conflicts + right.conflicts,
  failedPlatforms: [...left.failedPlatforms, ...right.failedPlatforms],
});

function platformLabel(platform: string) {
  return platform === "inpost_merchant" ? "InPost Merchant" : platform === "inpost" ? "InPost" : platform === "allegro" ? "Allegro" : platform === "erli" ? "ERLI" : platform;
}

function createOfferSyncSteps(items: Integration[]): SyncProgressStep[] {
  return items
    .filter((item) => OFFER_SYNC_PLATFORMS.has(item.platform) && item.status !== "ERROR")
    .map((item) => {
      const accountKey = item.accountKey || item.accountName;
      return {
        key: `${item.platform}::${accountKey || item.id}`,
        platform: item.platform,
        accountKey,
        label: `${item.accountName} · ${platformLabel(item.platform)}`,
        status: "pending" as const,
      };
    });
}

function offerSyncStatusLabel(status: SyncStepStatus, lang: string) {
  if (lang === "pl") {
    return status === "active" ? "W toku" : status === "done" ? "Gotowe" : status === "error" ? "Błąd" : "Czeka";
  }
  return status === "active" ? "In progress" : status === "done" ? "Done" : status === "error" ? "Error" : "Waiting";
}

function offerStepDetail(result: OfferSyncResult, lang: string) {
  const base = lang === "pl" ? `${result.saved} zapis. / ${result.fetched} pobr.` : `${result.saved} saved / ${result.fetched} fetched`;
  return result.conflicts > 0 ? `${base} · ${lang === "pl" ? "konfl." : "conf."} ${result.conflicts}` : base;
}

function OfferSyncProgress({ progress, lang }: { progress: SyncProgressState; lang: string }) {
  const active = progress.steps.find((step) => step.status === "active");
  const finished = progress.steps.filter((step) => step.status === "done" || step.status === "error").length;
  const numbers = [
    `${finished} / ${progress.steps.length}`,
    lang === "pl" ? `pobrano ${progress.fetched}` : `fetched ${progress.fetched}`,
    lang === "pl" ? `zapisano ${progress.saved}` : `saved ${progress.saved}`,
    lang === "pl" ? `konflikty ${progress.conflicts ?? 0}` : `conflicts ${progress.conflicts ?? 0}`,
  ];
  const context = active
    ? `${lang === "pl" ? "Pobieram" : "Fetching"}: ${active.label}`
    : progress.done
      ? (lang === "pl" ? "Zakończono" : "Done")
      : progress.title;
  const subtitle = `${context} · ${numbers.join(" · ")}`;
  return (
    <div className="commerce-sync-progress" role="status" aria-live="polite">
      <div><strong>{progress.title}</strong><span>{subtitle}</span></div>
      <div className="commerce-sync-progress-track"><span style={{ width: `${syncProgressPercent(progress)}%` }} /></div>
      <div className="commerce-sync-platforms">
        {progress.steps.map((step) => (
          <span className={`commerce-sync-platform ${step.status}`} key={step.key} title={step.detail}>
            <span className="commerce-sync-dot" />
            <strong>{step.label}</strong>
            <small>{step.detail ? `${offerSyncStatusLabel(step.status, lang)} · ${step.detail}` : offerSyncStatusLabel(step.status, lang)}</small>
          </span>
        ))}
      </div>
    </div>
  );
}

export default function Offers() {
  const { t, lang } = useI18n();
  const locale = lang === "pl" ? "pl-PL" : "en-GB";
  const [result, setResult] = useState<OfferListResponse>({ offers: [], total: 0, page: 1, pageSize: 20, platformFacets: [], accountFacets: [], statusCounts: {}, activeStockValues: [] });
  const rows = result.offers;
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [syncingOffers, setSyncingOffers] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgressState | null>(() => readSyncProgress(OFFER_SYNC_PROGRESS_KEY));
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<OfferStatus | "ALL">("ALL");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selPlatforms, setSelPlatforms] = useState<Set<string>>(new Set());
  const [selAccounts, setSelAccounts] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [editing, setEditing] = useState<SaveOffer | null>(null);
  const [newOfferOpen, setNewOfferOpen] = useState(false);
  const [marketplaceEditing, setMarketplaceEditing] = useState<OfferDetails | null>(null);
  const [loadingDetailsId, setLoadingDetailsId] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const [noticeWarning, setNoticeWarning] = useState(false);
  const [endingOffer, setEndingOffer] = useState<Offer | null>(null);
  const [deletingOffer, setDeletingOffer] = useState<Offer | null>(null);

  const reload = () => setReloadVersion((value) => value + 1);
  const loadIntegrations = () => getIntegrations().then(setIntegrations).catch(() => setIntegrations([]));
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      listOffers({ page, pageSize, search, status: status === "ALL" ? null : status, platforms: [...selPlatforms], accounts: [...selAccounts] })
        .then((next) => {
          if (cancelled) return;
          const maxPage = Math.max(1, Math.ceil(next.total / pageSize));
          if (page > maxPage) {
            setPage(maxPage);
            return;
          }
          setResult(next);
        })
        .catch((value) => { if (!cancelled) setError(translateMessage(value, t)); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, search.trim() ? 250 : 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [page, pageSize, search, status, selPlatforms, selAccounts, reloadVersion]);
  useEffect(() => {
    void loadIntegrations();
  }, []);

  // Fasety filtrów (platforma / konto) z licznikami — jak w Dashboardzie.
  const activeFilters = selPlatforms.size + selAccounts.size;
  const toggleInSet = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, key: string) => {
    setPage(1);
    setter((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  };

  const count = (value: OfferStatus) => result.statusCounts[value] ?? 0;
  const stockValue = formatCurrencyTotals(result.activeStockValues, locale, (row) => row.amount, (row) => row.currency);

  const editManual = (offer: Offer) => setEditing({
    id: offer.id, expectedRevision: offer.revision, title: offer.title, sku: offer.sku,
    ean: offer.ean ?? "", priceAmount: offer.priceAmount, currency: offer.currency,
    availableQuantity: offer.availableQuantity, taxRate: offer.taxRate, category: offer.category ?? "",
    brand: offer.brand ?? "", conditionCode: offer.conditionCode, description: offer.description ?? "",
  });

  const edit = async (offer: Offer) => {
    if (offer.sourcePlatform === "manual") {
      editManual(offer);
      return;
    }
    setLoadingDetailsId(offer.id); setError("");
    try { setMarketplaceEditing(await getMarketplaceOfferDetails(offer.id)); }
    catch (value) { setError(translateMessage(value, t)); }
    finally { setLoadingDetailsId(null); }
  };

  const submit = async () => {
    if (!editing) return;
    setBusy(true); setError("");
    try {
      await saveOffer(editing);
      setEditing(null); reload();
    }
    catch (value) { setError(translateMessage(value, t)); }
    finally { setBusy(false); }
  };

  const submitMarketplace = async (editablePayload: JsonObject) => {
    if (!marketplaceEditing) return;
    setBusy(true); setError("");
    try {
      await saveMarketplaceOfferDetails({
        id: marketplaceEditing.offer.id,
        expectedRevision: marketplaceEditing.offer.revision,
        editablePayload,
      });
      await pushMarketplaceOffer(marketplaceEditing.offer.id);
      setMarketplaceEditing(null);
      reload();
    } catch (value) { setError(translateMessage(value, t)); }
    finally { setBusy(false); }
  };

  const saveMarketplaceDraft = async (editablePayload: JsonObject) => {
    if (!marketplaceEditing) return;
    setBusy(true); setError("");
    try {
      await saveMarketplaceOfferDetails({
        id: marketplaceEditing.offer.id,
        expectedRevision: marketplaceEditing.offer.revision,
        editablePayload,
      });
      setMarketplaceEditing(await getMarketplaceOfferDetails(marketplaceEditing.offer.id));
      reload();
    } catch (value) { setError(translateMessage(value, t)); }
    finally { setBusy(false); }
  };

  const startMarketplaceDraft = async (integration: Integration) => {
    setBusy(true); setError("");
    try {
      const details = await createMarketplaceOfferDraft({
        platform: integration.platform,
        accountName: integration.accountKey || integration.accountName,
      });
      setNewOfferOpen(false);
      setMarketplaceEditing(details);
      reload();
    } catch (value) { setError(translateMessage(value, t)); }
    finally { setBusy(false); }
  };

  const uploadMarketplaceImage = async (file: File) => {
    if (!marketplaceEditing) throw new Error("No offer is being edited");
    const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
    return uploadMarketplaceOfferImage({
      id: marketplaceEditing.offer.id,
      fileName: file.name,
      contentType: file.type,
      bytes,
    });
  };

  const transition = async (id: number, next: OfferStatus) => {
    setBusy(true); setError("");
    try {
      await changeOfferStatus(id, next);
      if (rows.find((row) => row.id === id)?.sourcePlatform !== "manual") await pushMarketplaceOffer(id);
      reload();
    }
    catch (value) { setError(translateMessage(value, t)); }
    finally { setBusy(false); }
  };

  const remove = async (id: number) => {
    setBusy(true); setError("");
    try { await deleteOffer(id); setDeletingOffer(null); reload(); } catch (value) { setError(translateMessage(value, t)); }
    finally { setBusy(false); }
  };

  const sync = async () => {
    setBusy(true); setSyncingOffers(true); setError(""); setNotice(""); setNoticeWarning(false);
    try {
      const freshIntegrations = await getIntegrations().catch(() => integrations);
      setIntegrations(freshIntegrations);
      const steps = createOfferSyncSteps(freshIntegrations);
      if (steps.length === 0) {
        clearSyncProgress(OFFER_SYNC_PROGRESS_KEY);
        setSyncProgress(null);
        setError(lang === "pl" ? "Brak kont do synchronizacji ofert." : "No accounts available for offer sync.");
        return;
      }

      let result = emptyOfferSyncResult();
      const failures: string[] = [];
      let progress: SyncProgressState = {
        title: t(T.offer_sync),
        startedAt: Date.now(),
        updatedAt: Date.now(),
        steps,
        fetched: 0,
        saved: 0,
        accountsSynced: 0,
        conflicts: 0,
      };
      const publishProgress = (next: SyncProgressState) => {
        progress = { ...next, updatedAt: Date.now() };
        setSyncProgress(progress);
        writeSyncProgress(OFFER_SYNC_PROGRESS_KEY, progress);
      };
      const markStep = (key: string, status: SyncStepStatus, detail?: string) => {
        publishProgress({
          ...progress,
          steps: progress.steps.map((step) => step.key === key ? { ...step, status, detail } : step),
        });
      };

      publishProgress(progress);
      for (const step of steps) {
        markStep(step.key, "active");
        try {
          const platformResult = await syncMarketplaceOfferPlatform(step.platform, step.accountKey);
          result = mergeOfferSyncResult(result, platformResult);
          if (platformResult.failedPlatforms.length > 0) {
            failures.push(`${step.label}: ${platformResult.failedPlatforms.map(platformLabel).join(", ")}`);
            publishProgress({
              ...progress,
              fetched: result.fetched,
              saved: result.saved,
              accountsSynced: result.accountsSynced,
              conflicts: result.conflicts,
              steps: progress.steps.map((item) => item.key === step.key ? { ...item, status: "error", detail: offerStepDetail(platformResult, lang) } : item),
            });
          } else {
            publishProgress({
              ...progress,
              fetched: result.fetched,
              saved: result.saved,
              accountsSynced: result.accountsSynced,
              conflicts: result.conflicts,
              steps: progress.steps.map((item) => item.key === step.key ? { ...item, status: "done", detail: offerStepDetail(platformResult, lang) } : item),
            });
          }
        } catch (value) {
          const detail = translateMessage(value, t);
          failures.push(`${step.label}: ${detail}`);
          markStep(step.key, "error", detail);
        }
      }
      publishProgress({ ...progress, done: true });
      const failedPlatforms = [...new Set([...result.failedPlatforms.map(platformLabel), ...failures])];
      if (failedPlatforms.length > 0) {
        setNoticeWarning(true);
        setError(failedPlatforms.length === steps.length
          ? (lang === "pl" ? `Nie udało się odświeżyć kont: ${failedPlatforms.join(", ")}.` : `Could not refresh accounts: ${failedPlatforms.join(", ")}.`)
          : t(T.offer_sync_partial, { platforms: failedPlatforms.join(", ") }));
      } else {
        setNotice(t(T.offer_sync_result).replace("{saved}", String(result.saved)).replace("{conflicts}", String(result.conflicts)));
        const finishedSyncStartedAt = progress.startedAt;
        window.setTimeout(() => {
          setSyncProgress((current) => {
            if (current?.startedAt !== finishedSyncStartedAt) return current;
            clearSyncProgress(OFFER_SYNC_PROGRESS_KEY);
            return null;
          });
        }, 8000);
      }
      reload();
    } catch (value) { setError(translateMessage(value, t)); }
    finally { setSyncingOffers(false); setBusy(false); }
  };

  const statusLabel = (value: OfferStatus) => t({ DRAFT: T.offer_status_draft, READY: T.offer_status_ready, ACTIVE: T.offer_status_active, PAUSED: T.offer_status_paused, ENDED: T.offer_status_ended, ERROR: T.offer_status_error }[value]);
  const tone = (value: OfferStatus): "neutral" | "accent" | "good" | "warn" | "danger" => value === "ACTIVE" ? "good" : value === "ERROR" ? "danger" : value === "READY" ? "accent" : value === "PAUSED" ? "warn" : "neutral";
  const syncLabel = (offer: Offer) => offer.syncStatus === "SYNCED" ? t(T.offer_sync_synced)
    : offer.syncStatus === "PENDING" ? t(T.offer_sync_pending)
      : offer.syncStatus === "CONFLICT" ? t(T.offer_sync_conflict)
        : offer.syncStatus === "ERROR" ? t(T.offer_sync_error)
          : t(T.offer_sync_local);
  const accountLabelByKey = new Map(integrations.map((integration) => [integration.accountKey || integration.accountName, integration.accountName]));
  const accountLabel = (key: string, label?: string) => label || accountLabelByKey.get(key) || key || t(T.offer_manual);
  const createSupportedPlatforms = new Set(["allegro", "inpost_merchant"]);
  const createSupportedIntegrations = integrations.filter((integration) => createSupportedPlatforms.has(integration.platform));
  const createUnsupportedIntegrations = integrations.filter((integration) => !createSupportedPlatforms.has(integration.platform));
  const canSave = Boolean(editing
    && editing.title.trim()
    && editing.sku.trim()
    && Number.isFinite(editing.priceAmount)
    && editing.priceAmount >= 0
    && Number.isInteger(editing.availableQuantity)
    && editing.availableQuantity >= 0
    && /^[A-Z]{3}$/.test(editing.currency));

  return (
    <CommercePage>
      <CommerceHeader title={t(T.nav_offers)} subtitle={t(T.offer_subtitle)} action={<div className="commerce-header-actions">
        <button type="button" className="btn btn-secondary ord-sync-button" disabled={busy} onClick={sync}><RefreshCw size={14} className={syncingOffers ? "spin" : ""} />{syncingOffers ? t(T.common_loading) : t(T.offer_sync)}</button>
        <button type="button" className="btn btn-primary" onClick={() => setNewOfferOpen(true)}><Plus size={15} />{t(T.offer_add)}</button>
      </div>} />
      {syncProgress && <OfferSyncProgress progress={syncProgress} lang={lang} />}
      <KpiStrip items={[
        { label: t(T.offer_kpi_all), value: Object.values(result.statusCounts).reduce((sum, value) => sum + (value ?? 0), 0) },
        { label: t(T.offer_kpi_active), value: count("ACTIVE"), tone: "good" },
        { label: t(T.offer_kpi_attention), value: count("ERROR") + count("READY"), tone: count("ERROR") ? "danger" : "warn" },
        { label: t(T.offer_kpi_value), value: stockValue },
      ]} />
      {error && <div className="commerce-alert danger">{error}</div>}
      {notice && <div className={`commerce-alert ${noticeWarning ? "warn" : "good"}`}>{notice}</div>}
      <section className="commerce-toolbar">
        <div className="commerce-search"><Search size={15} /><input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder={t(T.offer_search)} /></div>
        <div className="seg" role="group">
          {(["ALL", "DRAFT", "READY", "ACTIVE", "PAUSED", "ENDED"] as const).map((value) => (
            <button type="button" key={value} className={`commerce-seg-btn${status === value ? " active" : ""}`} onClick={() => { setStatus(value); setPage(1); }}>
              {value === "ALL" ? t(T.common_all) : statusLabel(value)}
            </button>
          ))}
        </div>
        {/* Filtry: platforma / konto — popover w stylu Dashboardu */}
        <div style={{ position: "relative" }}>
          <button type="button" className="btn btn-secondary" onClick={() => setFiltersOpen((v) => !v)} aria-expanded={filtersOpen}
            style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <SlidersHorizontal size={13} />
            {t(T.dash_filters)}
            {activeFilters > 0 && <span className="seg-count">{activeFilters}</span>}
          </button>
          {filtersOpen && (
            <>
              <div onClick={() => setFiltersOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
              <div className="card elev-sm" style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 41, width: 264, padding: 12, maxHeight: 400, overflowY: "auto" }}>
                <div className="card-kicker" style={{ marginBottom: 4 }}>{t(T.int_col_platform)}</div>
                {result.platformFacets.map((f) => (
                  <label key={f.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 2px", fontSize: 13, cursor: "pointer" }}>
                    <input type="checkbox" checked={selPlatforms.has(f.key)} onChange={() => toggleInSet(setSelPlatforms, f.key)} />
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{platformLabel(f.key)}</span>
                    <span className="text-muted" style={{ fontSize: 11, fontVariantNumeric: "tabular-nums" }}>{f.count}</span>
                  </label>
                ))}
                <div className="card-kicker" style={{ margin: "10px 0 4px" }}>{t(T.dash_by_account)}</div>
                {result.accountFacets.map((f) => (
                  <label key={f.key || "__manual"} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 2px", fontSize: 13, cursor: "pointer" }}>
                    <input type="checkbox" checked={selAccounts.has(f.key)} onChange={() => toggleInSet(setSelAccounts, f.key)} />
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0, flex: 1 }}>
                      {f.platforms?.slice(0, 3).map((platform) => <OfferPlatformLogo key={platform} platform={platform} label={platformLabel(platform)} />)}
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{accountLabel(f.key, f.label)}</span>
                    </span>
                    <span className="text-muted" style={{ fontSize: 11, fontVariantNumeric: "tabular-nums" }}>{f.count}</span>
                  </label>
                ))}
                {activeFilters > 0 && (
                  <button type="button" className="btn btn-secondary" style={{ width: "100%", marginTop: 10, fontSize: 12 }}
                    onClick={() => { setSelPlatforms(new Set()); setSelAccounts(new Set()); }}>
                    {t(T.dash_clear_filters)}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </section>
      <section className="commerce-table-wrap">
        {loading ? <div className="commerce-loading">{t(T.common_loading)}</div> : rows.length === 0 ? <EmptyTable title={t(T.offer_empty)} detail={t(T.offer_empty_detail)} /> : (
          <table className="table commerce-table">
            <thead><tr><th>{t(T.offer_col_product)}</th><th>{t(T.offer_col_status)}</th><th>{t(T.offer_col_price)}</th><th>{t(T.offer_col_stock)}</th><th>{t(T.offer_col_tax)}</th><th>{t(T.offer_col_updated)}</th><th /></tr></thead>
            <tbody>{rows.map((offer) => (
              <tr key={offer.id}>
                <td><div className="offer-list-product">{offer.primaryImageUrl ? <img src={offer.primaryImageUrl} alt="" /> : <div className="offer-list-image-placeholder" />}<span><strong>{offer.title}</strong><span className="commerce-subline">SKU {offer.sku}{offer.brand ? ` · ${offer.brand}` : ""}</span></span></div></td>
                <td><span title={offer.validationIssues.map((issue) => issue.code).join(", ") || undefined}><StatusPill tone={offer.syncStatus === "ERROR" || offer.syncStatus === "CONFLICT" ? "danger" : tone(offer.status)}>{statusLabel(offer.status)}</StatusPill></span><span className="commerce-subline">{offer.sourcePlatform !== "manual" ? `${platformLabel(offer.sourcePlatform)} · ${syncLabel(offer)}` : t(T.offer_manual)}</span></td>
                <td className="commerce-num">{new Intl.NumberFormat(lang === "pl" ? "pl-PL" : "en-GB", { style: "currency", currency: offer.currency }).format(offer.priceAmount)}</td>
                <td className="commerce-num">{offer.availableQuantity}</td>
                <td>{formatTaxRate(offer.taxRate)}</td>
                <td>{new Date(offer.updatedAt).toLocaleDateString(lang === "pl" ? "pl-PL" : "en-GB")}</td>
                <td><div className="commerce-actions">
                  {offer.status !== "ENDED" && <button type="button" className="btn btn-ghost btn-icon" disabled={loadingDetailsId === offer.id} title={loadingDetailsId === offer.id ? t(T.offer_loading_details) : t(T.common_edit)} onClick={() => edit(offer)}><Pencil size={15} className={loadingDetailsId === offer.id ? "spin" : ""} /></button>}
                  {offer.status === "DRAFT" && <button type="button" className="btn btn-ghost btn-icon" title={t(T.offer_action_ready)} onClick={() => transition(offer.id, "READY")}><CheckCircle2 size={15} /></button>}
                  {(offer.status === "READY" || offer.status === "PAUSED") && <button type="button" className="btn btn-ghost btn-icon" title={t(T.offer_action_activate)} onClick={() => transition(offer.id, "ACTIVE")}><Play size={15} /></button>}
                  {offer.status === "ACTIVE" && offer.sourcePlatform === "manual" && <button type="button" className="btn btn-ghost btn-icon" title={t(T.offer_action_pause)} onClick={() => transition(offer.id, "PAUSED")}><CirclePause size={15} /></button>}
                  {offer.status === "ACTIVE" && offer.sourcePlatform !== "manual" && <button type="button" className="btn btn-ghost btn-icon" title={t(T.offer_action_end)} onClick={() => setEndingOffer(offer)}><CircleStop size={15} /></button>}
                  {offer.status === "DRAFT" && !offer.externalOfferId && <button type="button" className="btn btn-ghost btn-icon danger" title={t(T.offer_action_delete)} onClick={() => setDeletingOffer(offer)}><Trash2 size={15} /></button>}
                </div></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </section>
      {!loading && <CommercePagination page={page} pageSize={pageSize} total={result.total} onPageChange={setPage} onPageSizeChange={(value) => { setPageSize(value); setPage(1); }} />}

      {editing && <CommerceModal title={editing.id ? t(T.offer_edit) : t(T.offer_add)} onClose={() => setEditing(null)} wide>
        <div className="commerce-form-grid">
          <Field label={t(T.offer_field_title)} span={2}><input className="input" value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} /></Field>
          <Field label={t(T.offer_field_sku)}><input className="input" value={editing.sku} onChange={(e) => setEditing({ ...editing, sku: e.target.value })} /></Field>
          <Field label={t(T.offer_field_ean)}><input className="input" value={editing.ean ?? ""} onChange={(e) => setEditing({ ...editing, ean: e.target.value })} /></Field>
          <Field label={t(T.offer_field_price)}><input className="input" type="number" min="0" step="0.01" value={editing.priceAmount} onChange={(e) => setEditing({ ...editing, priceAmount: Number(e.target.value) })} /></Field>
          <Field label={t(T.offer_field_currency)}><select className="input" value={editing.currency} onChange={(e) => setEditing({ ...editing, currency: e.target.value })}><option>PLN</option><option>EUR</option><option>USD</option><option>GBP</option></select></Field>
          <Field label={t(T.offer_field_stock)}><input className="input" type="number" min="0" value={editing.availableQuantity} onChange={(e) => setEditing({ ...editing, availableQuantity: Number(e.target.value) })} /></Field>
          <Field label={t(T.offer_field_tax)}><select className="input" value={editing.taxRate} onChange={(e) => setEditing({ ...editing, taxRate: e.target.value })}><option>23</option><option>8</option><option>5</option><option>0</option><option>ZW</option><option>NP</option></select></Field>
          <Field label={t(T.offer_field_category)}><input className="input" value={editing.category ?? ""} onChange={(e) => setEditing({ ...editing, category: e.target.value })} /></Field>
          <Field label={t(T.offer_field_brand)}><input className="input" value={editing.brand ?? ""} onChange={(e) => setEditing({ ...editing, brand: e.target.value })} /></Field>
          <Field label={t(T.offer_field_condition)}><select className="input" value={editing.conditionCode} onChange={(e) => setEditing({ ...editing, conditionCode: e.target.value })}><option value="NEW">{t(T.offer_condition_new)}</option><option value="USED">{t(T.offer_condition_used)}</option><option value="REFURBISHED">{t(T.offer_condition_refurbished)}</option></select></Field>
          <Field label={t(T.offer_field_description)} span={2}><textarea className="input commerce-textarea" value={editing.description ?? ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></Field>
        </div>
        <footer className="commerce-modal-actions"><button type="button" className="btn btn-secondary" onClick={() => setEditing(null)}>{t(T.common_cancel)}</button><button type="button" className="btn btn-primary" disabled={busy || !canSave} onClick={submit}>{busy ? t(T.common_please_wait) : t(T.common_save)}</button></footer>
      </CommerceModal>}
      {newOfferOpen && <CommerceModal title={t(T.offer_choose_integration)} onClose={() => setNewOfferOpen(false)}>
        <div className="offer-create-panel">
          <p>{t(T.offer_choose_integration_detail)}</p>
          {createSupportedIntegrations.length === 0 ? <div className="commerce-alert warn">{t(T.offer_no_supported_integrations)}</div> : <div className="offer-create-list">
            {createSupportedIntegrations.map((integration) => (
              <button type="button" className="offer-create-option" key={integration.id} disabled={busy} onClick={() => startMarketplaceDraft(integration)}>
                <span><strong>{platformLabel(integration.platform)}</strong><small>{integration.accountName}</small></span>
                <span>{busy ? t(T.common_please_wait) : t(T.offer_create_for_account)}</span>
              </button>
            ))}
          </div>}
          {createUnsupportedIntegrations.length > 0 && <div className="offer-create-unsupported">
            {createUnsupportedIntegrations.map((integration) => (
              <span key={integration.id}>{platformLabel(integration.platform)} · {integration.accountName} · {t(T.offer_platform_unsupported_create)}</span>
            ))}
          </div>}
        </div>
        <footer className="commerce-modal-actions"><button type="button" className="btn btn-secondary" onClick={() => setNewOfferOpen(false)}>{t(T.common_cancel)}</button></footer>
      </CommerceModal>}
      {marketplaceEditing?.offer.sourcePlatform === "allegro" && <AllegroOfferEditor details={marketplaceEditing} busy={busy} onClose={() => setMarketplaceEditing(null)} onSaveDraft={saveMarketplaceDraft} onSubmit={submitMarketplace} onUploadImage={uploadMarketplaceImage} />}
      {marketplaceEditing?.offer.sourcePlatform === "inpost_merchant" && <InpostMerchantOfferEditor details={marketplaceEditing} busy={busy} onClose={() => setMarketplaceEditing(null)} onSubmit={submitMarketplace} onUploadImage={uploadMarketplaceImage} />}
      {marketplaceEditing?.offer.sourcePlatform === "erli" && <ErliOfferEditor details={marketplaceEditing} busy={busy} onClose={() => setMarketplaceEditing(null)} onSaveDraft={saveMarketplaceDraft} onSubmit={submitMarketplace} />}
      {endingOffer && <CommerceModal title={t(T.offer_end_confirm_title)} onClose={() => setEndingOffer(null)}>
        <p style={{ margin: "4px 0 0", lineHeight: 1.5 }}>{t(T.offer_end_confirm, { name: endingOffer.title })}</p>
        <footer className="commerce-modal-actions"><button type="button" className="btn btn-secondary" onClick={() => setEndingOffer(null)}>{t(T.common_cancel)}</button><button type="button" className="btn btn-primary" disabled={busy} onClick={async () => { const id = endingOffer.id; setEndingOffer(null); await transition(id, "ENDED"); }}>{busy ? t(T.common_please_wait) : t(T.offer_action_end)}</button></footer>
      </CommerceModal>}
      {deletingOffer && <CommerceModal title={t(T.offer_action_delete)} onClose={() => setDeletingOffer(null)}>
        <div className="return-confirm">
          <div className="return-confirm-icon delete"><Trash2 size={20} /></div>
          <h4>{t(T.offer_action_delete)}</h4>
          <p>{t(T.offer_delete_confirm)}</p>
        </div>
        <footer className="commerce-modal-actions"><button type="button" className="btn btn-secondary" onClick={() => setDeletingOffer(null)} disabled={busy}>{t(T.common_cancel)}</button><button type="button" className="btn btn-primary" disabled={busy} onClick={() => remove(deletingOffer.id)}>{busy ? t(T.common_please_wait) : t(T.common_confirm)}</button></footer>
      </CommerceModal>}
    </CommercePage>
  );
}
