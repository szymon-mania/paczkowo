// Limit ręcznych pobrań per konto (okno przesuwne). Chroni API marketplace'ów przed
// zalewaniem żądaniami z klikania „Pobierz" — to zabezpieczenie UX, nie egzekucja:
// twardy limit i tak musi stać po stronie serwera/integracji.
const STORAGE_PREFIX = "syncQuota:";

export const QUOTA_WINDOW_MS = 5 * 60 * 60 * 1000; // 5 godzin
export const QUOTA_LIMIT = 3; // pobrania na konto w oknie

type QuotaStore = Record<string, number[]>;

function storageKey(scope: string) {
  return `${STORAGE_PREFIX}${scope}`;
}

function readStore(scope: string): QuotaStore {
  try {
    const raw = localStorage.getItem(storageKey(scope));
    if (!raw) return {};
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const now = Date.now();
    const store: QuotaStore = {};
    for (const [key, stamps] of Object.entries(value as Record<string, unknown>)) {
      if (!Array.isArray(stamps)) continue;
      const fresh = stamps
        .filter((stamp): stamp is number => typeof stamp === "number" && now - stamp < QUOTA_WINDOW_MS)
        .sort((a, b) => a - b);
      if (fresh.length > 0) store[key] = fresh;
    }
    return store;
  } catch {
    localStorage.removeItem(storageKey(scope));
    return {};
  }
}

function writeStore(scope: string, store: QuotaStore) {
  localStorage.setItem(storageKey(scope), JSON.stringify(store));
}

export type QuotaState = {
  used: number;
  remaining: number;
  /** Kiedy zwolni się najstarsze zużycie (gdy limit wyczerpany). */
  nextAvailableAt: number | null;
  /** Ostatnie pobranie w oknie — do pokazania „Ostatnio: …". */
  lastAt: number | null;
};

export function quotaState(scope: string, account: string): QuotaState {
  const stamps = readStore(scope)[account] ?? [];
  const used = Math.min(stamps.length, QUOTA_LIMIT);
  const remaining = Math.max(0, QUOTA_LIMIT - stamps.length);
  return {
    used,
    remaining,
    nextAvailableAt: remaining > 0 || stamps.length === 0 ? null : stamps[0] + QUOTA_WINDOW_MS,
    lastAt: stamps.length > 0 ? stamps[stamps.length - 1] : null,
  };
}

/** Rezerwuje jedno pobranie. Zwraca `false`, gdy limit jest już wyczerpany. */
export function consumeQuota(scope: string, account: string): boolean {
  const store = readStore(scope);
  const stamps = store[account] ?? [];
  if (stamps.length >= QUOTA_LIMIT) return false;
  store[account] = [...stamps, Date.now()];
  writeStore(scope, store);
  return true;
}

/** Zwraca zużycie po nieudanej próbie — nie karzemy użytkownika za błąd integracji. */
export function refundQuota(scope: string, account: string) {
  const store = readStore(scope);
  const stamps = store[account] ?? [];
  if (stamps.length === 0) return;
  store[account] = stamps.slice(0, -1);
  if (store[account].length === 0) delete store[account];
  writeStore(scope, store);
}
