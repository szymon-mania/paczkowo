import { useEffect, useState } from "react";
import { CheckCircle2, CirclePause, CircleStop, DownloadCloud, Pencil, Play, Plus, RefreshCw, Trash2 } from "lucide-react";

import AllegroOfferEditor from "../components/AllegroOfferEditor";
import InpostMerchantOfferEditor from "../components/InpostMerchantOfferEditor";
import ErliOfferEditor from "../components/ErliOfferEditor";
import { CommerceHeader, CommerceModal, CommercePage, CommercePagination, EmptyTable, Field, KpiStrip, StatusPill } from "../components/CommerceUi";
import { IntegrationImportList, platformLabel } from "../components/IntegrationImport";
import { AccountFilterMulti, type ChannelOption } from "../components/ListFilters";
import { SyncProgressPanel, SyncSummaryBanner, type SyncSummary } from "../components/SyncStatus";
import { consumeQuota, quotaState, refundQuota, QUOTA_LIMIT, QUOTA_WINDOW_MS } from "../lib/syncQuota";
import { createMarketplaceOfferDraft, changeOfferStatus, deleteOffer, getMarketplaceOfferDetails, listOffers, pushMarketplaceOffer, saveMarketplaceOfferDetails, saveOffer, syncMarketplaceOfferPlatform, uploadMarketplaceOfferImage, type JsonObject, type Offer, type OfferDetails, type OfferListResponse, type OfferStatus, type OfferSyncResult, type SaveOffer } from "../lib/commerceApi";
import { getIntegrations, type Integration } from "../lib/accountApi";
import { formatCurrencyTotals } from "../lib/commerceFormat";
import { T, translateMessage, useI18n } from "../lib/i18n";
import { classifyServerError } from "../lib/serverStatus";
import { clearSyncProgress, OFFER_SYNC_PROGRESS_KEY, readSyncProgress, writeSyncProgress, type SyncProgressState, type SyncProgressStep, type SyncStepStatus } from "../lib/syncProgress";

/** Zakres limitu pobrań ofert (klucz w localStorage). */
const OFFER_IMPORT_SCOPE = "offers";

// VAT column: pokaż tylko poprawne stawki (cyfra, cyfra z %, np. 0.23).
// UNKNOWN / pusta / nierozpoznana wartość => "-".
const formatTaxRate = (raw: string): string => {
  const value = (raw ?? "").trim();
  if (!value || value.toUpperCase() === "UNKNOWN") return "-";
  if (/^\d+(\.\d+)?%?$/.test(value)) return value.endsWith("%") ? value : `${value}%`;
  return value;
};

const OFFER_SYNC_PLATFORMS = new Set(["allegro", "erli", "inpost_merchant"]);

/** Oferty bez konta (ręczne) mają pusty klucz — w filtrze potrzebują własnej wartości. */
const MANUAL_ACCOUNT_KEY = "__manual";
const accountFilterValues = (selected: Set<string>) =>
  [...selected].map((value) => (value === MANUAL_ACCOUNT_KEY ? "" : value));
/** Kolejność statusów jest stała — segmenty nie mogą znikać przy zawężeniu filtrów. */
const STATUS_SEGMENTS: OfferStatus[] = ["DRAFT", "READY", "ACTIVE", "PAUSED", "ENDED", "ERROR"];

// ─── PODRĘCZNA PAMIĘĆ LISTY ───────────────────────────────────────────────────
// Wejście na zakładkę pokazuje ostatni wynik od razu (bez spinnera); świeże dane
// dociągają się w tle, a odpowiedź młodsza niż TTL nie generuje zapytania w ogóle.
const EMPTY_OFFERS: OfferListResponse = { offers: [], total: 0, page: 1, pageSize: 20, platformFacets: [], accountFacets: [], statusCounts: {}, activeStockValues: [] };
const OFFERS_TTL_MS = 60_000;
const OFFERS_CACHE_LIMIT = 12;
type OffersView = { page: number; pageSize: number; search: string; status: OfferStatus | "ALL"; accounts: string[] };
const DEFAULT_VIEW: OffersView = { page: 1, pageSize: 20, search: "", status: "ALL", accounts: [] };
const offersQueryKey = (view: OffersView) => JSON.stringify([view.page, view.pageSize, view.search.trim(), view.status, [...view.accounts].sort()]);
const offersCache = new Map<string, { data: OfferListResponse; at: number }>();
function rememberOffers(key: string, data: OfferListResponse) {
  offersCache.delete(key);
  offersCache.set(key, { data, at: Date.now() });
  while (offersCache.size > OFFERS_CACHE_LIMIT) offersCache.delete(offersCache.keys().next().value!);
}
let integrationsCache: Integration[] | null = null;

const emptyOfferSyncResult = (): OfferSyncResult => ({ accountsSynced: 0, fetched: 0, saved: 0, conflicts: 0, failedPlatforms: [] });
const mergeOfferSyncResult = (left: OfferSyncResult, right: OfferSyncResult): OfferSyncResult => ({
  accountsSynced: left.accountsSynced + right.accountsSynced,
  fetched: left.fetched + right.fetched,
  saved: left.saved + right.saved,
  conflicts: left.conflicts + right.conflicts,
  failedPlatforms: [...left.failedPlatforms, ...right.failedPlatforms],
});

function createOfferSyncSteps(items: Integration[]): SyncProgressStep[] {
  return items
    .filter((item) => OFFER_SYNC_PLATFORMS.has(item.platform) && item.status !== "ERROR")
    .map((item) => {
      const accountKey = item.accountKey || item.accountName;
      return {
        key: `${item.platform}::${accountKey || item.id}`,
        platform: item.platform,
        accountKey,
        accountName: item.accountName,
        label: `${item.accountName} · ${platformLabel(item.platform)}`,
        status: "pending" as const,
      };
    });
}

function offerStepDetail(result: OfferSyncResult, lang: string) {
  const base = lang === "pl" ? `${result.saved} zapis. / ${result.fetched} pobr.` : `${result.saved} saved / ${result.fetched} fetched`;
  return result.conflicts > 0 ? `${base} · ${lang === "pl" ? "konfl." : "conf."} ${result.conflicts}` : base;
}

export default function Offers() {
  const { t, lang } = useI18n();
  const locale = lang === "pl" ? "pl-PL" : "en-GB";
  const [result, setResult] = useState<OfferListResponse>(() => offersCache.get(offersQueryKey(DEFAULT_VIEW))?.data ?? EMPTY_OFFERS);
  const rows = result.offers;
  const [integrations, setIntegrations] = useState<Integration[]>(() => integrationsCache ?? []);
  const [loading, setLoading] = useState(() => !offersCache.has(offersQueryKey(DEFAULT_VIEW)));
  const [busy, setBusy] = useState(false);
  const [syncingOffers, setSyncingOffers] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgressState | null>(() => readSyncProgress(OFFER_SYNC_PROGRESS_KEY));
  const [syncSummary, setSyncSummary] = useState<SyncSummary | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [activeImportKey, setActiveImportKey] = useState<string | null>(null);
  // Zużycie limitu trzymane jest w localStorage — ta wersja wymusza przeliczenie widoku.
  const [quotaVersion, setQuotaVersion] = useState(0);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<OfferStatus | "ALL">("ALL");
  // Filtr kont: wielokrotny wybór (pusty zbiór = wszystkie konta).
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

  // Zmiana danych (zapis/import/usunięcie) unieważnia cache — inaczej wróciłby stary wynik.
  const reload = () => { offersCache.clear(); setReloadVersion((value) => value + 1); };
  const loadIntegrations = () => getIntegrations()
    .then((list) => { integrationsCache = list; setIntegrations(list); })
    .catch(() => setIntegrations(integrationsCache ?? []));
  const queryKey = offersQueryKey({ page, pageSize, search, status, accounts: [...selAccounts] });
  useEffect(() => {
    let cancelled = false;
    const cached = offersCache.get(queryKey);
    if (cached) { setResult(cached.data); setLoading(false); }
    if (cached && Date.now() - cached.at < OFFERS_TTL_MS) return;
    const timer = window.setTimeout(() => {
      if (!cached) setLoading(true);
      listOffers({ page, pageSize, search, status: status === "ALL" ? null : status, platforms: [], accounts: accountFilterValues(selAccounts) })
        .then((next) => {
          if (cancelled) return;
          const maxPage = Math.max(1, Math.ceil(next.total / pageSize));
          if (page > maxPage) {
            setPage(maxPage);
            return;
          }
          rememberOffers(queryKey, next);
          setResult(next);
        })
        .catch((value) => { if (!cancelled) setError(translateMessage(value, t)); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, search.trim() ? 250 : 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [queryKey, reloadVersion]);
  useEffect(() => {
    void loadIntegrations();
  }, []);

  const count = (value: OfferStatus) => result.statusCounts[value] ?? 0;
  const totalOffers = Object.values(result.statusCounts).reduce((sum, value) => sum + (value ?? 0), 0);
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

  // Pobranie ofert z wybranych kont. Każde konto kosztuje jedno „użycie" z limitu —
  // nieudana próba jest zwracana, żeby błąd integracji nie zjadał puli użytkownika.
  const runImport = async (accounts: Integration[]) => {
    const steps = createOfferSyncSteps(accounts).filter((step) => quotaState(OFFER_IMPORT_SCOPE, step.accountKey || "").remaining > 0);
    if (steps.length === 0) return;

    const finishImport = (summary: SyncSummary | null) => {
      clearSyncProgress(OFFER_SYNC_PROGRESS_KEY);
      setSyncProgress(null);
      setSyncSummary(summary);
      setQuotaVersion((value) => value + 1);
    };

    setBusy(true); setSyncingOffers(true); setError(""); setNotice(""); setNoticeWarning(false); setSyncSummary(null);
    try {
      let result = emptyOfferSyncResult();
      const failures: string[] = [];
      let progress: SyncProgressState = {
        title: t(T.sync_offers_title),
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
        const account = step.accountKey || "";
        if (!consumeQuota(OFFER_IMPORT_SCOPE, account)) continue;
        setActiveImportKey(account);
        markStep(step.key, "active");
        try {
          const platformResult = await syncMarketplaceOfferPlatform(step.platform, step.accountKey);
          result = mergeOfferSyncResult(result, platformResult);
          const failed = platformResult.failedPlatforms.length > 0;
          if (failed) {
            refundQuota(OFFER_IMPORT_SCOPE, account);
            failures.push(`${step.label}: ${platformResult.failedPlatforms.map(platformLabel).join(", ")}`);
          }
          publishProgress({
            ...progress,
            fetched: result.fetched,
            saved: result.saved,
            accountsSynced: result.accountsSynced,
            conflicts: result.conflicts,
            steps: progress.steps.map((item) => item.key === step.key
              ? { ...item, status: failed ? "error" : "done", detail: offerStepDetail(platformResult, lang) }
              : item),
          });
        } catch (value) {
          refundQuota(OFFER_IMPORT_SCOPE, account);
          // Padnięty serwer obsługuje ekran awarii (App.tsx / onServerSignal) — nie
          // dobijamy kolejnych kont ani nie pokazujemy błędów, których user nie naprawi.
          if (classifyServerError(value) === "unavailable") {
            finishImport(null);
            return;
          }
          const detail = translateMessage(value, t);
          failures.push(`${step.label}: ${detail}`);
          markStep(step.key, "error", detail);
        }
      }

      const failedPlatforms = [...new Set([...result.failedPlatforms.map(platformLabel), ...failures])];
      finishImport(failedPlatforms.length > 0
        ? { ok: false, title: t(T.sync_failed_title), detail: failedPlatforms.join(" | "), at: Date.now() }
        : {
            ok: true,
            title: t(T.sync_done_title),
            detail: t(T.sync_done_detail, { accounts: steps.length, fetched: result.fetched, saved: result.saved }),
            at: Date.now(),
          });
      reload();
    } catch (value) {
      if (classifyServerError(value) === "unavailable") {
        finishImport(null);
        return;
      }
      finishImport({ ok: false, title: t(T.sync_failed_title), detail: translateMessage(value, t), at: Date.now() });
    }
    finally { setActiveImportKey(null); setSyncingOffers(false); setBusy(false); }
  };

  const importAll = async () => {
    const fresh = await getIntegrations().catch(() => integrations);
    setIntegrations(fresh);
    await runImport(fresh.filter((item) => OFFER_SYNC_PLATFORMS.has(item.platform)));
  };

  const statusLabel = (value: OfferStatus) => t({ DRAFT: T.offer_status_draft, READY: T.offer_status_ready, ACTIVE: T.offer_status_active, PAUSED: T.offer_status_paused, ENDED: T.offer_status_ended, ERROR: T.offer_status_error }[value]);
  const tone = (value: OfferStatus): "neutral" | "accent" | "good" | "warn" | "danger" => value === "ACTIVE" ? "good" : value === "ERROR" ? "danger" : value === "READY" ? "accent" : value === "PAUSED" ? "warn" : "neutral";
  const syncLabel = (offer: Offer) => offer.syncStatus === "SYNCED" ? t(T.offer_sync_synced)
    : offer.syncStatus === "PENDING" ? t(T.offer_sync_pending)
      : offer.syncStatus === "CONFLICT" ? t(T.offer_sync_conflict)
        : offer.syncStatus === "ERROR" ? t(T.offer_sync_error)
          : t(T.offer_sync_local);
  const importAccounts = integrations.filter((integration) => OFFER_SYNC_PLATFORMS.has(integration.platform));
  const importableNow = importAccounts.filter((integration) => integration.status !== "ERROR"
    && quotaState(OFFER_IMPORT_SCOPE, integration.accountKey || integration.accountName).remaining > 0);
  // „Pusty start" = brak ofert w ogóle (nie: pusty wynik filtrowania).
  const nothingImportedYet = result.total === 0 && !search.trim() && status === "ALL" && selAccounts.size === 0;
  const accountLabelByKey = new Map(integrations.map((integration) => [integration.accountKey || integration.accountName, integration.accountName]));
  const accountPlatformByKey = new Map(integrations.map((integration) => [integration.accountKey || integration.accountName, integration.platform]));
  const accountLabel = (key: string, label?: string) => label || accountLabelByKey.get(key) || key || t(T.offer_manual);
  // Opcje filtra konta w formacie wspólnego selecta (logo platformy + nazwa konta).
  const accountOptions: ChannelOption[] = result.accountFacets.map((facet) => {
    const platforms = facet.platforms?.length ? facet.platforms : [accountPlatformByKey.get(facet.key)].filter(Boolean) as string[];
    const manual = !facet.key;
    return {
      value: facet.key || MANUAL_ACCOUNT_KEY,
      platform: manual ? "manual" : platforms[0] ?? "manual",
      platformLabel: manual || !platforms.length ? t(T.offer_manual) : platforms.map(platformLabel).join(" · "),
      accountName: facet.key,
      accountDisplayName: manual ? "—" : accountLabel(facet.key, facet.label),
      count: facet.count,
    };
  });
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
        <button type="button" className="btn btn-secondary ord-sync-button" disabled={busy} onClick={() => setImportOpen(true)}>
          <DownloadCloud size={15} className={syncingOffers ? "spin" : ""} />{t(T.offer_import_open)}
        </button>
        <button type="button" className="btn btn-primary" onClick={() => setNewOfferOpen(true)}><Plus size={15} />{t(T.offer_add)}</button>
        {syncProgress && <SyncProgressPanel progress={syncProgress} />}
      </div>} />
      {syncSummary && <SyncSummaryBanner summary={syncSummary} onDismiss={() => setSyncSummary(null)} />}
      <KpiStrip items={[
        { label: t(T.offer_kpi_all), value: Object.values(result.statusCounts).reduce((sum, value) => sum + (value ?? 0), 0) },
        { label: t(T.offer_kpi_active), value: count("ACTIVE"), tone: "good" },
        { label: t(T.offer_kpi_attention), value: count("ERROR") + count("READY"), tone: count("ERROR") ? "danger" : "warn" },
        { label: t(T.offer_kpi_value), value: stockValue },
      ]} />
      {error && <div className="commerce-alert danger">{error}</div>}
      {notice && <div className={`commerce-alert ${noticeWarning ? "warn" : "good"}`}>{notice}</div>}
      {/* Filtry: szukaj + status + konto — układ wspólny z Zamówieniami/Wysyłką */}
      <div style={{ display: "flex", gap: 12, alignItems: "flex-end", marginBottom: 16, flexWrap: "wrap" }}>
        <div className="field" style={{ maxWidth: 280, flex: 1, minWidth: 200 }}>
          <label htmlFor="offer-search">{t(T.common_search)}</label>
          <input className="input" id="offer-search" placeholder={t(T.offer_search)} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <div className="field">
          <label id="offer-status-label">{t(T.ord_status)}</label>
          <div className="seg" role="radiogroup" aria-labelledby="offer-status-label">
            {STATUS_SEGMENTS.map((value) => (
              <label key={value} className="seg-opt">
                <input type="radio" name="offerstatusf" checked={status === value} onChange={() => { setStatus(value); setPage(1); }} />
                {statusLabel(value)}<span className="seg-count">{count(value)}</span>
              </label>
            ))}
            <label className="seg-opt">
              <input type="radio" name="offerstatusf" checked={status === "ALL"} onChange={() => { setStatus("ALL"); setPage(1); }} />
              {t(T.common_all)}<span className="seg-count">{totalOffers}</span>
            </label>
          </div>
        </div>
        <div className="field" style={{ maxWidth: 230 }}>
          <label htmlFor="offer-account">{t(T.dash_by_account)}</label>
          <AccountFilterMulti id="offer-account" selected={selAccounts} options={accountOptions} onChange={(next) => { setSelAccounts(next); setPage(1); }} />
        </div>
      </div>

      {/* Tabela */}
      <div className="card elev-sm" style={{ padding: 0, overflowX: "auto" }}>
        {loading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 220 }}>
            <div style={{ width: 24, height: 24, border: "3px solid var(--accent)", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
          </div>
        ) : rows.length === 0 ? (
          // Pusty start: zamiast samego komunikatu pokazujemy konta, z których można pobrać oferty.
          nothingImportedYet ? (
            <div className="offer-import-empty">
              <header>
                <strong>{t(T.offer_import_empty_title)}</strong>
                <span>{t(T.offer_import_empty_detail)}</span>
              </header>
              <IntegrationImportList
                accounts={importAccounts}
                busy={busy}
                activeKey={activeImportKey}
                onImport={(account) => void runImport([account])}
                locale={locale}
                quotaVersion={quotaVersion}
                scope={OFFER_IMPORT_SCOPE}
                emptyLabel={t(T.offer_import_no_accounts)}
                actionLabel={t(T.offer_import_account)}
              />
              <div className="offer-import-hint">{t(T.offer_import_quota_hint, { max: QUOTA_LIMIT, hours: QUOTA_WINDOW_MS / 3_600_000 })}</div>
            </div>
          ) : <EmptyTable title={t(T.offer_empty)} detail={t(T.offer_empty_detail)} />
        ) : (
          <table className="table commerce-table" style={{ fontSize: 14 }}>
            <thead><tr><th style={{ paddingLeft: "var(--space-4)" }}>{t(T.offer_col_product)}</th><th>{t(T.offer_col_status)}</th><th className="ord-th-num">{t(T.offer_col_price)}</th><th className="ord-th-num">{t(T.offer_col_stock)}</th><th>{t(T.offer_col_tax)}</th><th>{t(T.offer_col_updated)}</th><th style={{ paddingRight: "var(--space-4)" }} /></tr></thead>
            <tbody>{rows.map((offer) => (
              <tr key={offer.id}>
                <td><div className="offer-list-product">{offer.primaryImageUrl ? <img src={offer.primaryImageUrl} alt="" /> : <div className="offer-list-image-placeholder" />}<span><strong>{offer.title}</strong><span className="commerce-subline">SKU {offer.sku}{offer.brand ? ` · ${offer.brand}` : ""}</span></span></div></td>
                <td><span title={offer.validationIssues.map((issue) => issue.code).join(", ") || undefined}><StatusPill tone={offer.syncStatus === "ERROR" || offer.syncStatus === "CONFLICT" ? "danger" : tone(offer.status)}>{statusLabel(offer.status)}</StatusPill></span><span className="commerce-subline">{offer.sourcePlatform !== "manual" ? `${platformLabel(offer.sourcePlatform)} · ${syncLabel(offer)}` : t(T.offer_manual)}</span></td>
                <td className="ord-td-num">{new Intl.NumberFormat(lang === "pl" ? "pl-PL" : "en-GB", { style: "currency", currency: offer.currency }).format(offer.priceAmount)}</td>
                <td className="ord-td-num">{offer.availableQuantity}</td>
                <td>{formatTaxRate(offer.taxRate)}</td>
                <td>{new Date(offer.updatedAt).toLocaleDateString(lang === "pl" ? "pl-PL" : "en-GB")}</td>
                <td style={{ paddingRight: "var(--space-4)" }}><div className="commerce-actions" style={{ justifyContent: "flex-end" }}>
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
      </div>
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
      {importOpen && <CommerceModal title={t(T.offer_import_title)} onClose={() => setImportOpen(false)}>
        <div className="offer-create-panel">
          <p>{t(T.offer_import_subtitle)}</p>
          <IntegrationImportList
            accounts={importAccounts}
            busy={busy}
            activeKey={activeImportKey}
            onImport={(account) => void runImport([account])}
            locale={locale}
            quotaVersion={quotaVersion}
            scope={OFFER_IMPORT_SCOPE}
            emptyLabel={t(T.offer_import_no_accounts)}
            actionLabel={t(T.offer_import_account)}
          />
          <div className="offer-import-hint">{t(T.offer_import_quota_hint, { max: QUOTA_LIMIT, hours: QUOTA_WINDOW_MS / 3_600_000 })}</div>
        </div>
        <footer className="commerce-modal-actions">
          <button type="button" className="btn btn-secondary" onClick={() => setImportOpen(false)}>{t(T.common_close)}</button>
          <button type="button" className="btn btn-primary" disabled={busy || importableNow.length === 0} onClick={() => void importAll()}>
            <DownloadCloud size={15} />{t(T.offer_import_all, { n: importableNow.length })}
          </button>
        </footer>
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
