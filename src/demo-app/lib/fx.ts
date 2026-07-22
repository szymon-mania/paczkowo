// Kursy walut do przeliczania kwot na dashboardzie (źródło: NBP, komenda `get_fx_rates`).
// `rates[x]` = ile PLN za 1 jednostkę waluty x (baza PLN, rates["PLN"] = 1).
// Przelicznik: value_from → value_to = value * rates[from] / rates[to].
import { invoke } from "@tauri-apps/api/core";

export type FxRates = { base: string; date: string; rates: Record<string, number> };

const CACHE_KEY = "fxRates";
const TTL_MS = 12 * 60 * 60 * 1000; // 12 h — kursy NBP zmieniają się raz dziennie

type Cached = { ts: number; data: FxRates };

function readCache(): Cached | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Cached) : null;
  } catch {
    return null;
  }
}

/** Pobiera kursy (świeże z cache < 12 h, inaczej z backendu). Przy błędzie sieci
 *  zwraca ostatnie znane kursy z cache, a gdy ich brak — null. */
export async function getFxRates(): Promise<FxRates | null> {
  const cached = readCache();
  if (cached && Date.now() - cached.ts < TTL_MS) return cached.data;
  try {
    const data = await invoke<FxRates>("get_fx_rates");
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
    return data;
  } catch {
    return cached?.data ?? null; // offline → stare kursy lepsze niż brak
  }
}

/** Przelicza kwotę między walutami. Zwraca null, gdy brak kursu (nieznana waluta,
 *  kursy jeszcze się nie załadowały) — ta sama waluta nie wymaga kursów. */
export function convertAmount(value: number, from: string, to: string, fx: FxRates | null): number | null {
  if (from === to) return value;
  if (!fx) return null;
  const rf = fx.rates[from.toUpperCase()];
  const rt = fx.rates[to.toUpperCase()];
  if (!rf || !rt) return null;
  return (value * rf) / rt;
}
