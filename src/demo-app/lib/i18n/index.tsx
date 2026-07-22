import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { T } from "./keys";
import { pl } from "./pl";
import { en } from "./en";

export type Lang = "pl" | "en";
export type Vars = Record<string, string | number>;
export type TFn = (key: T, vars?: Vars) => string;

const DICTS: Record<Lang, Record<T, string>> = { pl, en };
const MESSAGE_KEYS = new Set<string>(Object.values(T));
const LANGS: { code: Lang; key: T; flag: string }[] = [
  { code: "pl", key: T.lang_polish, flag: "🇵🇱" },
  { code: "en", key: T.lang_english, flag: "🇬🇧" },
];
export { T, LANGS };

/** Locale BCP-47 dla formatowania dat/liczb w bieżącym języku. */
export const localeOf = (l: Lang): string => (l === "en" ? "en-GB" : "pl-PL");

function interpolate(s: string, vars?: Vars): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}

function cleanMessage(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value ?? "");
  return raw.replace(/^Error:\s*/i, "").trim();
}

export function messageKey(value: unknown): T | null {
  const raw = cleanMessage(value);
  const key = raw.startsWith("i18n:") ? raw.slice("i18n:".length).trim() : raw;
  return MESSAGE_KEYS.has(key) ? (key as T) : null;
}

export function translateMessage(value: unknown, t: TFn): string {
  const key = messageKey(value);
  return key ? t(key) : cleanMessage(value);
}

type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: TFn };
const I18nContext = createContext<Ctx>({ lang: "pl", setLang: () => {}, t: (k) => String(k) });

function readLang(): Lang {
  const v = localStorage.getItem("lang");
  return v === "en" || v === "pl" ? v : "pl";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readLang);
  const value = useMemo<Ctx>(() => {
    const setLang = (l: Lang) => { localStorage.setItem("lang", l); setLangState(l); };
    const t: TFn = (key, vars) => interpolate(DICTS[lang][key] ?? pl[key] ?? String(key), vars);
    return { lang, setLang, t };
  }, [lang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): Ctx {
  return useContext(I18nContext);
}
