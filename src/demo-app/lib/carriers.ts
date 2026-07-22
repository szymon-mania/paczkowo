import { T, type TFn } from "./i18n";

// Gabaryty / sugerowane rozmiary paczek per przewoźnik.
// Etykiety presetów są neutralne językowo (kod · wymiary · ≤ waga) — bez tłumaczeń.
// value w cm / kg. To sugestie maksymalnych wymiarów — użytkownik może doedytować.

export type SizePreset = {
  code: string;       // np. "A", "S", "M", "L"
  label: string;      // opis z maks. wymiarami
  length: string;     // cm
  width: string;      // cm
  height: string;     // cm
  weight: string;     // kg (sugerowana maks. dla gabarytu)
};

// InPost Paczkomat — oficjalne gabaryty A/B/C (maks 25 kg).
const INPOST: SizePreset[] = [
  { code: "A", label: "A · 8×38×64 cm · ≤ 25 kg", length: "64", width: "38", height: "8", weight: "25" },
  { code: "B", label: "B · 19×38×64 cm · ≤ 25 kg", length: "64", width: "38", height: "19", weight: "25" },
  { code: "C", label: "C · 41×38×64 cm · ≤ 25 kg", length: "64", width: "38", height: "41", weight: "25" },
];

const DPD: SizePreset[] = [
  { code: "S", label: "S · 30×20×10 cm · ≤ 5 kg", length: "30", width: "20", height: "10", weight: "5" },
  { code: "M", label: "M · 50×35×25 cm · ≤ 15 kg", length: "50", width: "35", height: "25", weight: "15" },
  { code: "L", label: "L · 80×60×40 cm · ≤ 31,5 kg", length: "80", width: "60", height: "40", weight: "31.5" },
];

const DHL: SizePreset[] = [
  { code: "S", label: "S · 30×20×10 cm · ≤ 5 kg", length: "30", width: "20", height: "10", weight: "5" },
  { code: "M", label: "M · 50×40×30 cm · ≤ 15 kg", length: "50", width: "40", height: "30", weight: "15" },
  { code: "L", label: "L · 80×60×40 cm · ≤ 31,5 kg", length: "80", width: "60", height: "40", weight: "31.5" },
];

const UPS: SizePreset[] = [
  { code: "S", label: "S · 30×20×10 cm · ≤ 10 kg", length: "30", width: "20", height: "10", weight: "10" },
  { code: "M", label: "M · 60×40×30 cm · ≤ 30 kg", length: "60", width: "40", height: "30", weight: "30" },
  { code: "L", label: "L · 100×60×60 cm · ≤ 70 kg", length: "100", width: "60", height: "60", weight: "70" },
];

// ORLEN Paczka (dawniej Paczka w Ruchu) — gabaryty A/B/C, maks 25 kg.
const ORLEN: SizePreset[] = [
  { code: "A", label: "A · 8×38×64 cm · ≤ 25 kg", length: "64", width: "38", height: "8", weight: "25" },
  { code: "B", label: "B · 19×38×64 cm · ≤ 25 kg", length: "64", width: "38", height: "19", weight: "25" },
  { code: "C", label: "C · 41×38×64 cm · ≤ 25 kg", length: "64", width: "38", height: "41", weight: "25" },
];

const GENERIC: SizePreset[] = [
  { code: "S", label: "S · 30×20×10 cm · ≤ 5 kg", length: "30", width: "20", height: "10", weight: "5" },
  { code: "M", label: "M · 50×40×30 cm · ≤ 15 kg", length: "50", width: "40", height: "30", weight: "15" },
  { code: "L", label: "L · 80×60×40 cm · ≤ 30 kg", length: "80", width: "60", height: "40", weight: "30" },
];

export function presetsForCarrier(carrier: string): SizePreset[] {
  switch (carrier) {
    case "inpost": return INPOST;
    case "dpd": return DPD;
    case "dhl": return DHL;
    case "ups": return UPS;
    case "orlen": return ORLEN;
    default: return GENERIC;
  }
}

export const CARRIER_LABEL: Record<string, string> = {
  inpost: "InPost",
  dpd: "DPD",
  dhl: "DHL",
  ups: "UPS",
  orlen: "Orlen",
};

/** Etykieta przewoźnika; „other" tłumaczone przez słownik, marki bez zmian. */
export function carrierLabel(carrier: string | null | undefined, t: TFn): string | null {
  if (!carrier) return null;
  if (carrier === "other") return t(T.carrier_other);
  return CARRIER_LABEL[carrier] ?? carrier;
}
