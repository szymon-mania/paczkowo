import { useEffect, useRef, useState, type ComponentType } from "react";
import PhoneInput, { getCountryCallingCode } from "react-phone-number-input";
import plLabels from "react-phone-number-input/locale/pl.json";
import enLabels from "react-phone-number-input/locale/en.json";
import { useI18n } from "../lib/i18n";
import "react-phone-number-input/style.css";
import "./PhoneField.css";

type CountryOption = {
  value?: string;
  label: string;
  divider?: boolean;
};

type CountryIcon = ComponentType<{
  country?: string;
  label?: string;
  "aria-hidden"?: boolean;
}>;

function callingCode(country: string) {
  return getCountryCallingCode(
    country as Parameters<typeof getCountryCallingCode>[0],
  );
}

function CountrySelect({
  value,
  onChange,
  options,
  iconComponent: Icon,
  name,
  disabled,
}: {
  value?: string;
  onChange: (value?: string) => void;
  options: CountryOption[];
  iconComponent?: CountryIcon;
  name?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value);
  const visibleOptions = options.filter(
    (option): option is CountryOption & { value: string } =>
      !option.divider && !!option.value,
  );
  const filteredOptions = visibleOptions.filter((option) => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return true;
    const code = `+${callingCode(option.value)}`;
    return (
      option.label.toLowerCase().includes(normalizedQuery) ||
      code.includes(normalizedQuery) ||
      code.replace("+", "").includes(normalizedQuery.replace("+", ""))
    );
  });

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  return (
    <div className="PhoneInputCountry pp-phone-country" ref={wrapRef}>
      <input type="hidden" name={name} value={value || ""} />
      <button
        type="button"
        disabled={disabled}
        className="pp-phone-country-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={selected?.label}
        onClick={() => setOpen((next) => !next)}
      >
        {selected && Icon ? (
          <Icon aria-hidden country={value} label={selected.label} />
        ) : null}
        <span className="PhoneInputCountrySelectArrow" />
      </button>

      {open && (
        <div className="pp-phone-country-menu" role="listbox">
          <div className="pp-phone-country-search">
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Szukaj kraju lub kodu"
              onKeyDown={(event) => event.stopPropagation()}
            />
          </div>
          {filteredOptions.map((option) => {
            const active = option.value === value;
            return (
              <button
                type="button"
                key={option.value}
                className={`pp-phone-country-option${active ? " active" : ""}`}
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                {Icon ? (
                  <Icon aria-hidden country={option.value} label={option.label} />
                ) : null}
                <span className="pp-phone-country-option-code">
                  +{callingCode(option.value)}
                </span>
                <span className="pp-phone-country-option-label">
                  {option.label}
                </span>
              </button>
            );
          })}
          {filteredOptions.length === 0 && (
            <div className="pp-phone-country-empty">Brak wynikow</div>
          )}
        </div>
      )}
    </div>
  );
}

export function PhoneField({
  value,
  onChange,
  required,
}: {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  const { lang } = useI18n();
  return (
    <div className="pp-phone">
      <PhoneInput
        international
        defaultCountry="PL"
        countryCallingCodeEditable={false}
        labels={lang === "en" ? enLabels : plLabels}
        countrySelectComponent={CountrySelect as never}
        value={value || undefined}
        onChange={(nextValue) => onChange(nextValue ?? "")}
        numberInputProps={{ required }}
      />
    </div>
  );
}
