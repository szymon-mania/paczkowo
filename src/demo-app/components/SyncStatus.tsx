// Wspólny wskaźnik synchronizacji (zamówienia / wysyłka / oferty).
// Zasada: w trakcie pracy widać TYLKO bieżące konto i pasek postępu po kontach,
// a po zakończeniu panel znika i zostaje krótkie podsumowanie.
import { useEffect } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, X } from "lucide-react";

import { channelLabel, PlatformLogo } from "./ListFilters";
import { T, useI18n } from "../lib/i18n";
import type { SyncProgressState } from "../lib/syncProgress";

/** Podsumowanie pokazywane po zakończeniu synchronizacji. */
export type SyncSummary = {
  ok: boolean;
  title: string;
  detail?: string;
  /** Znacznik czasu — odróżnia kolejne przebiegi (auto-ukrywanie). */
  at: number;
};

/** Ile trzyma się podsumowanie udanej synchronizacji (błędy czekają na zamknięcie). */
export const SYNC_SUMMARY_MS = 5000;

function stepCounts(progress: SyncProgressState) {
  const steps = progress.steps.filter((step) => step.platform !== "prepare" && step.platform !== "refresh");
  const total = steps.length || progress.steps.length;
  const finished = steps.filter((step) => step.status === "done" || step.status === "error").length;
  return { total, finished, steps };
}

export function SyncProgressPanel({ progress }: { progress: SyncProgressState }) {
  const { t, lang } = useI18n();
  const { total, finished, steps } = stepCounts(progress);
  const current = steps.find((step) => step.status === "active")
    ?? progress.steps.find((step) => step.status === "active")
    ?? steps[Math.min(finished, Math.max(0, steps.length - 1))];
  const percent = total > 0 ? Math.min(100, (finished / total) * 100) : 0;
  const accountName = current?.accountName || current?.label || "";
  const platform = current?.platform ?? "";
  const housekeeping = platform === "refresh" || platform === "prepare";
  const platformName = housekeeping
    ? (lang === "pl" ? "Odświeżanie listy" : "Refreshing list")
    : channelLabel(platform, t);

  return (
    <section className="sync-panel" role="status" aria-live="polite">
      <div className="sync-panel-head">
        <strong>{progress.title}</strong>
        <span>{Math.min(finished + (current ? 1 : 0), total)} / {total}</span>
      </div>
      <div className="sync-panel-current">
        {/* Kroki techniczne nie mają logo — zamiast litery pokazujemy ikonę odświeżania. */}
        {housekeeping
          ? <span className="sync-panel-icon"><RefreshCw size={15} /></span>
          : <PlatformLogo platform={platform} fallback={platformName} size={26} />}
        <span className="sync-panel-account">
          <strong>{accountName}</strong>
          <small>{platformName}</small>
        </span>
        <span className="sync-panel-dots" aria-hidden="true"><i /><i /><i /></span>
      </div>
      <div className="sync-panel-track"><span style={{ width: `${percent}%` }} /></div>
      <div className="sync-panel-meta">
        <span>{t(T.sync_fetched, { n: progress.fetched })}</span>
        <span>{t(T.sync_saved, { n: progress.saved })}</span>
      </div>
    </section>
  );
}

export function SyncSummaryBanner({ summary, onDismiss }: { summary: SyncSummary; onDismiss: () => void }) {
  const { t } = useI18n();

  useEffect(() => {
    if (!summary.ok) return;
    const id = window.setTimeout(onDismiss, SYNC_SUMMARY_MS);
    return () => window.clearTimeout(id);
  }, [summary.at, summary.ok, onDismiss]);

  return (
    <div className={`sync-summary ${summary.ok ? "good" : "danger"}`} role="status">
      {summary.ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
      <span className="sync-summary-copy">
        <strong>{summary.title}</strong>
        {summary.detail && <small>{summary.detail}</small>}
      </span>
      <button type="button" className="btn btn-ghost btn-icon" aria-label={t(T.common_close)} onClick={onDismiss}>
        <X size={15} />
      </button>
    </div>
  );
}
