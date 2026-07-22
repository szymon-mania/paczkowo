import { useI18n, LANGS, T } from "../lib/i18n";

// Wybór języka (flaga + nazwa) w spójnym, „segmentowym" stylu reszty aplikacji.
// Używany na ekranie logowania i w Ustawieniach.
export function LanguageSelect({ size = "md" }: { size?: "sm" | "md" }) {
  const { lang, setLang, t } = useI18n();
  const pad = size === "sm" ? "5px 9px" : "7px 12px";
  return (
    <div className="seg" role="radiogroup" aria-label={t(T.lang_label)}>
      {LANGS.map((l) => (
        <label key={l.code} className="seg-opt" style={{ padding: pad, gap: 7 }}>
          <input type="radio" name="lang-select" checked={lang === l.code} onChange={() => setLang(l.code)} />
          <span style={{ fontSize: size === "sm" ? 13 : 15, lineHeight: 1 }} aria-hidden>{l.flag}</span>
          {t(l.key)}
        </label>
      ))}
    </div>
  );
}
