// Wspólna lista „Pobierz z integracji" (Oferty / Zwroty).
// Jeden komponent, żeby obie zakładki miały identyczny UX: konto, logo, limit
// pobrań w oknie przesuwnym i osobny przycisk pobrania dla każdego konta.
import { RefreshCw } from "lucide-react";

import { PlatformLogo } from "./ListFilters";
import { QUOTA_LIMIT, quotaState } from "../lib/syncQuota";
import { T, useI18n } from "../lib/i18n";
import type { Integration } from "../lib/accountApi";

export function platformLabel(platform: string) {
  return platform === "inpost_merchant" ? "InPost Merchant"
    : platform === "inpost" ? "InPost"
      : platform === "allegro" ? "Allegro"
        : platform === "erli" ? "ERLI"
          : platform;
}

export function IntegrationImportList({ accounts, busy, activeKey, onImport, locale, quotaVersion, scope, emptyLabel, actionLabel }: {
  accounts: Integration[];
  busy: boolean;
  activeKey: string | null;
  onImport: (account: Integration) => void;
  locale: string;
  /** Zmiana wymusza przeliczenie limitu trzymanego w localStorage. */
  quotaVersion: number;
  scope: string;
  emptyLabel: string;
  actionLabel: string;
}) {
  const { t } = useI18n();
  const time = (value: number) => new Date(value).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });

  if (accounts.length === 0) return <div className="offer-import-hint">{emptyLabel}</div>;

  return (
    <div className="offer-import-list">
      {accounts.map((account) => {
        const key = account.accountKey || account.accountName;
        const quota = quotaState(scope, key);
        void quotaVersion;
        const broken = account.status === "ERROR";
        const blocked = broken || quota.remaining === 0;
        return (
          <div className={`offer-import-row${blocked ? " blocked" : ""}`} key={account.id}>
            <PlatformLogo platform={account.platform} fallback={platformLabel(account.platform)} size={26} />
            <span className="offer-import-copy">
              <strong>{account.accountName}</strong>
              <small>{platformLabel(account.platform)}{broken ? ` · ${t(T.offer_import_account_error)}` : quota.lastAt ? ` · ${t(T.offer_import_last, { time: time(quota.lastAt) })}` : ` · ${t(T.offer_import_never)}`}</small>
            </span>
            <span className={`offer-import-quota${quota.remaining === 0 ? " spent" : ""}`}>
              {quota.remaining === 0 && quota.nextAvailableAt
                ? t(T.offer_import_quota_spent, { time: time(quota.nextAvailableAt) })
                : t(T.offer_import_quota, { n: quota.remaining, max: QUOTA_LIMIT })}
            </span>
            <button type="button" className="btn btn-secondary" disabled={busy || blocked} onClick={() => onImport(account)}>
              <RefreshCw size={14} className={activeKey === key ? "spin" : ""} />
              {actionLabel}
            </button>
          </div>
        );
      })}
    </div>
  );
}
