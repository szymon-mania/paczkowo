export type SyncStepStatus = "pending" | "active" | "done" | "error";

export type SyncProgressStep = {
  key: string;
  platform: string;
  accountKey?: string;
  label: string;
  status: SyncStepStatus;
  detail?: string;
  fetched?: number;
  saved?: number;
  conflicts?: number;
};

export type SyncProgressState = {
  title: string;
  startedAt: number;
  updatedAt: number;
  steps: SyncProgressStep[];
  fetched: number;
  saved: number;
  accountsSynced: number;
  conflicts?: number;
  done?: boolean;
};

export const ORDER_SYNC_PROGRESS_KEY = "orderSyncProgress";
export const OFFER_SYNC_PROGRESS_KEY = "offerSyncProgress";

const ACTIVE_TTL_MS = 30 * 60 * 1000;
const DONE_TTL_MS = 8 * 1000;

function isProgressState(value: unknown): value is SyncProgressState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SyncProgressState>;
  return typeof candidate.title === "string"
    && typeof candidate.startedAt === "number"
    && typeof candidate.updatedAt === "number"
    && Array.isArray(candidate.steps);
}

export function readSyncProgress(storageKey: string): SyncProgressState | null {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (!isProgressState(value)) {
      localStorage.removeItem(storageKey);
      return null;
    }
    const age = Date.now() - value.updatedAt;
    const hasError = value.steps.some((step) => step.status === "error");
    if (age > ACTIVE_TTL_MS || (value.done && !hasError && age > DONE_TTL_MS)) {
      localStorage.removeItem(storageKey);
      return null;
    }
    return value;
  } catch {
    localStorage.removeItem(storageKey);
    return null;
  }
}

export function writeSyncProgress(storageKey: string, progress: SyncProgressState) {
  localStorage.setItem(storageKey, JSON.stringify({ ...progress, updatedAt: Date.now() }));
}

export function clearSyncProgress(storageKey: string) {
  localStorage.removeItem(storageKey);
}

export function syncProgressPercent(progress: SyncProgressState) {
  const total = Math.max(1, progress.steps.length);
  const finished = progress.steps.filter((step) => step.status === "done" || step.status === "error").length;
  const active = progress.steps.some((step) => step.status === "active");
  return Math.min(100, ((finished + (active ? 0.45 : 0)) / total) * 100);
}
