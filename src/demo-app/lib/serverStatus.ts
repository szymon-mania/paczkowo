// Globalna eskalacja błędów serwera z DOWOLNEGO wywołania komendy Tauri.
//
// Każdy ekran łapie własne błędy do lokalnego `setError`, więc awaria serwera albo wygasła
// licencja kończyły się czerwonym napisem w środku widoku — zamiast ekranu awarii/upgrade.
// Tutaj jest jedno miejsce, które rozpoznaje takie błędy i zgłasza je aplikacji (App.tsx),
// a ta weryfikuje stan konta i przełącza właściwy ekran.
//
// UWAGA: importuj `invoke` Z TEGO MODUŁU, nie z "@tauri-apps/api/core" — inaczej wywołanie
// ominie eskalację. Podmiana mostu przez devMock (`__TAURI_INTERNALS__`) działa jak dotąd.
import { invoke as tauriInvoke, type InvokeArgs, type InvokeOptions } from "@tauri-apps/api/core";

/** Rodzaj problemu rozpoznany po kodzie błędu z warstwy Rust. */
export type ServerSignal = "unavailable" | "license_inactive" | "unauthorized";

function errorText(error: unknown): string {
  if (typeof error === "string") return error;
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" ? message : String(error ?? "");
}

/**
 * Klasyfikuje błąd komendy. `null` = zwykły błąd operacji (zostaje w widoku).
 * Kody pochodzą z `src-tauri/src/server/account.rs` (`server_err`).
 */
export function classifyServerError(error: unknown): ServerSignal | null {
  const raw = errorText(error).trim();
  const code = raw.startsWith("i18n:") ? raw.slice("i18n:".length).trim() : raw;
  if (code === "err_license_inactive") return "license_inactive";
  if (code === "err_server_unauthorized" || code === "err_server_no_session") return "unauthorized";
  if (code === "err_server_unavailable" || code === "err_server_generic") return "unavailable";
  // Fallback dla starszych/nietłumaczonych komunikatów z warstwy sieciowej.
  if (/Brak połączenia|niedostępn|chwilowo|server unavailable|can't reach/i.test(code)) return "unavailable";
  return null;
}

type Listener = (signal: ServerSignal) => void;
const listeners = new Set<Listener>();

/** Subskrypcja sygnałów (App.tsx). Zwraca funkcję odsubskrybowania. */
export function onServerSignal(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Kilka równoległych wywołań pada zwykle naraz (sync = wiele kont) — jeden sygnał wystarczy.
const SIGNAL_THROTTLE_MS = 3_000;
let lastSignalAt = 0;

export function reportServerError(error: unknown): ServerSignal | null {
  const signal = classifyServerError(error);
  if (!signal) return null;
  const now = Date.now();
  if (now - lastSignalAt < SIGNAL_THROTTLE_MS) return signal;
  lastSignalAt = now;
  listeners.forEach((listener) => {
    try {
      listener(signal);
    } catch {
      /* subskrybent nie może zablokować obsługi błędu */
    }
  });
  return signal;
}

/** `invoke` z eskalacją błędów serwera. Sam błąd leci dalej — widok pokazuje go jak dotąd. */
export async function invoke<T>(cmd: string, args?: InvokeArgs, options?: InvokeOptions): Promise<T> {
  try {
    return await tauriInvoke<T>(cmd, args, options);
  } catch (error) {
    reportServerError(error);
    throw error;
  }
}
