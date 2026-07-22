import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ExternalLink, ImagePlus, Pencil, Plus, Search, Sparkles, Trash2, X } from "lucide-react";

import { CommerceModal, Field } from "./CommerceUi";
import OfferImageGallery from "./OfferImageGallery";
import { DescriptionSectionsEditor, descriptionHasContent } from "./OfferDescriptionEditor";
import { getMarketplaceOfferCategories, getMarketplaceOfferEditorContext, saveMarketplaceGpsrParty, saveMarketplaceSizeTable, uploadMarketplaceOfferAttachment, type JsonObject, type OfferDetails, type OfferEditorContext } from "../lib/commerceApi";
import { T, type TFn, useI18n } from "../lib/i18n";

type Path = (string | number)[];
type Tab = "MAIN" | "MEDIA" | "PRODUCT" | "GPSR" | "SALE" | "DELIVERY" | "MARKETS" | "ADVANCED";
type Props = {
  details: OfferDetails;
  busy: boolean;
  onClose: () => void;
  onSaveDraft: (payload: JsonObject) => void;
  onSubmit: (payload: JsonObject) => void;
  onUploadImage: (file: File) => Promise<string>;
};
type ParameterScope = "PRODUCT" | "OFFER";
type MarketplaceOption = { id: string; label: string; currency: string };
type ContextOption = { id: string; name: string };
type CategorySuggestion = { id: string; name: string; path: string; leaf: boolean };
type GpsrPartyKind = "PERSON" | "PRODUCER";
type GpsrDialogState = { kind: GpsrPartyKind; productIndex: number; value?: JsonObject };

const object = (value: unknown): JsonObject => value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string => typeof value === "string" ? value : "";
const number = (value: unknown): number => typeof value === "number" ? value : Number(value || 0);

function write(root: JsonObject, path: Path, value: unknown): JsonObject {
  const next = structuredClone(root);
  let current: unknown = next;
  path.forEach((key, index) => {
    const last = index === path.length - 1;
    if (Array.isArray(current)) {
      if (last) current[Number(key)] = value;
      else {
        current[Number(key)] ??= typeof path[index + 1] === "number" ? [] : {};
        current = current[Number(key)];
      }
    } else {
      const target = current as JsonObject;
      if (last) target[String(key)] = value;
      else {
        target[String(key)] ??= typeof path[index + 1] === "number" ? [] : {};
        current = target[String(key)];
      }
    }
  });
  return next;
}

function withoutAt<T>(items: T[], index: number): T[] {
  return items.filter((_, itemIndex) => itemIndex !== index);
}

function commaList(value: unknown): string {
  return array(value).map(text).filter(Boolean).join(", ");
}

const HANDLING_TIMES = ["PT0S", "PT24H", "P2D", "P3D", "P4D", "P5D", "P7D", "P10D", "P14D", "P21D", "P30D", "P60D"];
const PROVINCES = ["DOLNOSLASKIE", "KUJAWSKO_POMORSKIE", "LUBELSKIE", "LUBUSKIE", "LODZKIE", "MALOPOLSKIE", "MAZOWIECKIE", "OPOLSKIE", "PODKARPACKIE", "PODLASKIE", "POMORSKIE", "SLASKIE", "SWIETOKRZYSKIE", "WARMINSKO_MAZURSKIE", "WIELKOPOLSKIE", "ZACHODNIOPOMORSKIE"];
const VAT_COUNTRIES = ["PL", "CZ", "SK", "HU", "DE", "AT", "BE", "BG", "HR", "CY", "DK", "EE", "FI", "FR", "GR", "ES", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PT", "RO", "SE", "SI"];
const OFFER_CURRENCIES = ["PLN", "CZK", "EUR", "HUF"];
const FALLBACK_MARKETS: MarketplaceOption[] = [
  { id: "allegro-cz", label: "Allegro Czechy", currency: "CZK" },
  { id: "allegro-sk", label: "Allegro Słowacja", currency: "EUR" },
  { id: "allegro-hu", label: "Allegro Węgry", currency: "HUF" },
  { id: "allegro-business-pl", label: "Allegro Business Polska", currency: "PLN" },
  { id: "allegro-business-cz", label: "Allegro Business Czechy", currency: "CZK" },
  { id: "allegro-business-sk", label: "Allegro Business Słowacja", currency: "EUR" },
];

function codeLabel(value: string): string {
  const label = value.toLocaleLowerCase("pl-PL").replace(/_/g, " ");
  return label.charAt(0).toLocaleUpperCase("pl-PL") + label.slice(1);
}

function countryLabel(value: string): string {
  try {
    return `${new Intl.DisplayNames(["pl-PL"], { type: "region" }).of(value) ?? value} (${value})`;
  } catch {
    return value;
  }
}

function CountrySelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useI18n();
  const options = value && !VAT_COUNTRIES.includes(value) ? [value, ...VAT_COUNTRIES] : VAT_COUNTRIES;
  return <select className="input" value={value} onChange={(event) => onChange(event.target.value)}>
    {!value && <option value="">{t(T.offer_not_selected)}</option>}
    {options.map((country) => <option key={country} value={country}>{countryLabel(country)}</option>)}
  </select>;
}

function CurrencySelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useI18n();
  const options = value && !OFFER_CURRENCIES.includes(value) ? [value, ...OFFER_CURRENCIES] : OFFER_CURRENCIES;
  return <select className="input" value={value} onChange={(event) => onChange(event.target.value)}>
    {!value && <option value="">{t(T.offer_not_selected)}</option>}
    {options.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
  </select>;
}

function allegroOfferUrl(offerId?: string): string {
  const id = text(offerId).trim();
  return id ? `https://allegro.pl/oferta/${encodeURIComponent(id)}` : "";
}


function parameterDefinitions(context: OfferEditorContext, scope: ParameterScope): JsonObject[] {
  return array(context.categoryParameters)
    .map(object)
    .filter((definition) => {
      const describesProduct = object(definition.options).describesProduct;
      if (scope === "PRODUCT") return describesProduct !== false;
      return describesProduct !== true;
    });
}

function dictionaryOptions(definition: JsonObject): { id: string; label: string }[] {
  const values = array(definition.dictionary).length > 0 ? array(definition.dictionary) : array(definition.values);
  return values.map(object).map((item) => ({
    id: text(item.id),
    label: text(item.value) || text(item.name) || text(item.label) || text(item.id),
  })).filter((item) => item.id && item.label);
}

function isMultipleChoice(definition: JsonObject, row: JsonObject): boolean {
  return Boolean(object(definition.restrictions).multipleChoices)
    || Boolean(object(definition.options).multipleChoices)
    || array(row.valuesIds).length > 1;
}

function updateParameterValue(row: JsonObject, patch: JsonObject): JsonObject {
  return { ...row, ...patch };
}

function hasParameterValue(row: JsonObject): boolean {
  const range = object(row.rangeValue);
  return array(row.values).some((value) => text(value).trim())
    || array(row.valuesIds).some((value) => text(value).trim())
    || text(range.from).trim() !== ""
    || text(range.to).trim() !== "";
}

function missingRequiredParameters(rowsValue: unknown, definitions: JsonObject[], prefix = ""): string[] {
  const rows = array(rowsValue).map(object);
  return definitions
    .filter((definition) => definition.required === true)
    .filter((definition) => {
      const row = rows.find((item) => text(item.id) === text(definition.id));
      return !row || !hasParameterValue(row);
    })
    .map((definition) => `${prefix}${text(definition.name) || text(definition.id)}`);
}


function firstMissingAllegroFields(
  payload: JsonObject,
  context: OfferEditorContext,
  t: (key: T) => string,
): string[] {
  const fields: string[] = [];
  const category = text(object(payload.category).id).trim();
  const price = Number(text(object(object(payload.sellingMode).price).amount) || object(object(payload.sellingMode).price).amount);
  const currency = text(object(object(payload.sellingMode).price).currency).trim();
  const sellingFormat = text(object(payload.sellingMode).format) || "BUY_NOW";
  const startingPrice = Number(text(object(object(payload.sellingMode).startingPrice).amount) || object(object(payload.sellingMode).startingPrice).amount);
  const stock = number(object(payload.stock).available);
  const location = object(payload.location);
  const afterSales = object(payload.afterSalesServices);
  const products = array(payload.productSet).map(object);
  const sections = array(object(payload.description).sections).map(object);

  if (text(payload.name).trim().length < 12) fields.push(t(T.offer_field_title));
  if (!category) fields.push(t(T.offer_field_category));
  if (!Number.isFinite(price) || price < 1) fields.push(t(T.offer_field_price));
  if (!currency) fields.push(t(T.offer_field_currency));
  if (!Number.isInteger(stock) || stock < 0) fields.push(t(T.offer_field_stock));
  const imageCount = array(payload.images).map(text).filter(Boolean).length;
  if (imageCount === 0 || imageCount > 16) fields.push(t(T.offer_images));
  if (!descriptionHasContent(sections)) fields.push(t(T.offer_field_description));
  if (products.length === 0 || !products.every((item) => text(object(item.product).id).trim() || text(object(item.product).name).trim())) fields.push(t(T.offer_product_name));
  if (!products.every((item) => Number(object(item.quantity).value) >= 1)) fields.push(t(T.offer_product_quantity));
  if (sellingFormat === "AUCTION" && (!Number.isFinite(startingPrice) || startingPrice <= 0)) fields.push(t(T.offer_starting_price));
  if (!products.every((item) => {
    const safety = object(item.safetyInformation);
    return text(safety.type) === "ATTACHMENTS"
      ? array(safety.attachments).map(object).some((attachment) => text(attachment.id).trim())
      : text(safety.description).trim().length > 0;
  })) fields.push(t(T.offer_safety_description));
  if (!text(object(object(payload.delivery).shippingRates).id).trim()) fields.push(t(T.offer_shipping_rate_name));
  if (!text(object(afterSales.returnPolicy).id).trim()) fields.push(t(T.offer_return_policy));
  if (!text(object(afterSales.impliedWarranty).id).trim()) fields.push(t(T.offer_implied_warranty));
  if (!text(location.city).trim()) fields.push(t(T.offer_location_city));
  if (!text(location.postCode).trim()) fields.push(t(T.offer_location_post_code));
  if (!text(location.countryCode).trim()) fields.push(t(T.offer_location_country));
  if (!text(location.province).trim()) fields.push(t(T.offer_location_province));

  const productDefinitions = parameterDefinitions(context, "PRODUCT");
  const offerDefinitions = parameterDefinitions(context, "OFFER");
  for (const [index, setItem] of products.entries()) {
    fields.push(...missingRequiredParameters(object(setItem.product).parameters, productDefinitions, products.length > 1 ? `${t(T.offer_product)} ${index + 1}: ` : ""));
  }
  fields.push(...missingRequiredParameters(payload.parameters, offerDefinitions));
  return [...new Set(fields)];
}


function parameterSummary(row: JsonObject): string {
  const range = object(row.rangeValue);
  if (Object.keys(range).length > 0) return [text(range.from), text(range.to)].filter(Boolean).join(" - ");
  return commaList(row.values) || commaList(row.valuesIds) || "";
}

function parameterDraft(definition: JsonObject, source?: JsonObject): JsonObject {
  const next: JsonObject = {
    id: text(definition.id),
    name: text(definition.name),
    values: array(source?.values).map(text).filter(Boolean),
  };
  const sourceIds = array(source?.valuesIds).map(text).filter(Boolean);
  if (dictionaryOptions(definition).length > 0 || sourceIds.length > 0) next.valuesIds = sourceIds;
  const range = object(source?.rangeValue);
  if (Object.keys(range).length > 0) next.rangeValue = range;
  return next;
}

function technicalChoiceLabel(value: unknown, t: TFn): string {
  const item = object(value);
  return text(item.name) || (text(item.id) ? t(T.offer_selected_in_allegro) : t(T.offer_not_selected));
}

function contextOptions(context: OfferEditorContext, key: string): ContextOption[] {
  return array(context[key]).map(object).map((item) => ({
    id: text(item.id),
    name: text(item.name) || text(item.label) || text(item.id),
  })).filter((item) => item.id && item.name);
}

function categorySuggestions(context: OfferEditorContext): CategorySuggestion[] {
  return array(context.categorySuggestions).map(object).map((item) => ({
    id: text(item.id),
    name: text(item.name),
    path: text(item.path),
    leaf: item.leaf !== false,
  })).filter((item) => item.id && item.name);
}

function selectedCategory(context: OfferEditorContext): CategorySuggestion | null {
  const item = object(context.selectedCategory);
  const id = text(item.id);
  const name = text(item.name);
  return id && name ? { id, name, path: text(item.path), leaf: item.leaf !== false } : null;
}

function CategoryPicker({ value, selected, query, parentId, suggestions, loading, error, onQuery, onParentChange, onChange }: { value: string; selected: CategorySuggestion | null; query: string; parentId: string; suggestions: CategorySuggestion[]; loading: boolean; error: string; onQuery: (value: string) => void; onParentChange: (value: string) => void; onChange: (value: string) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [localSelected, setLocalSelected] = useState<CategorySuggestion | null>(null);
  const [parentStack, setParentStack] = useState<CategorySuggestion[]>([]);
  const pickerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const current = localSelected?.id === value ? localSelected : selected?.id === value ? selected : null;

  useEffect(() => {
    if (selected?.id === value) setLocalSelected(selected);
    if (!value) setLocalSelected(null);
  }, [selected, value]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) {
        setOpen(false);
        onQuery("");
        onParentChange("");
        setParentStack([]);
      }
    };
    window.addEventListener("mousedown", onPointerDown);
    requestAnimationFrame(() => searchRef.current?.focus());
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [onParentChange, onQuery, open]);

  const close = () => {
    setOpen(false);
    onQuery("");
    onParentChange("");
    setParentStack([]);
  };
  const openRoot = () => {
    setOpen(true);
    onQuery("");
    onParentChange("");
    setParentStack([]);
  };
  const select = (suggestion: CategorySuggestion) => {
    setLocalSelected(suggestion);
    onChange(suggestion.id);
    close();
  };
  const browse = (suggestion: CategorySuggestion) => {
    setParentStack((current) => [...current, suggestion]);
    onQuery("");
    onParentChange(suggestion.id);
  };
  const back = () => {
    setParentStack((current) => {
      const next = current.slice(0, -1);
      onParentChange(next[next.length - 1]?.id ?? "");
      return next;
    });
  };
  const clear = () => {
    setLocalSelected(null);
    onChange("");
    close();
  };
  return <div className="offer-category-picker" ref={pickerRef}>
    <div className="offer-category-control">
      <button type="button" className="offer-category-trigger" aria-expanded={open} aria-haspopup="listbox" onClick={() => open ? close() : openRoot()}>
        <span><strong>{current?.name || (value ? t(T.offer_category_unavailable) : t(T.offer_category_choose))}</strong>{current?.path && <small>{current.path}</small>}</span>
        <Search size={16} />
      </button>
      {value && <button type="button" className="offer-category-clear" title={t(T.offer_category_clear)} onClick={clear}><X size={15} /></button>}
    </div>
    {open && <div className="offer-category-popover" role="dialog">
      <div className="offer-category-search"><Search size={16} /><input ref={searchRef} className="input" value={query} placeholder={t(T.offer_category_search)} onChange={(event) => onQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") close(); }} /></div>
      {parentStack.length > 0 && !query.trim() && <button type="button" className="offer-category-back" onClick={back}>{t(T.offer_category_back)}</button>}
      {loading && <p className="offer-category-state">{t(T.common_loading)}</p>}
      {!loading && error && <p className="offer-category-state">{error}</p>}
      {!loading && !error && suggestions.length === 0 && <p className="offer-category-state">{t(T.offer_category_no_results)}</p>}
      {!loading && !error && suggestions.length > 0 && <div className="offer-category-results" role="listbox" data-parent-id={parentId}>
        {suggestions.map((suggestion) => <button type="button" key={suggestion.id} className="offer-category-option" role="option" onClick={() => suggestion.leaf ? select(suggestion) : browse(suggestion)}>
          <strong>{suggestion.name}</strong>
          <span>{suggestion.path}{!suggestion.leaf ? ` - ${t(T.offer_category_open_children)}` : ""}</span>
        </button>)}
      </div>}
    </div>}
  </div>;
}

function NamedChoiceSelect({ value, options, onChange }: { value: unknown; options: ContextOption[]; onChange: (value: JsonObject | null) => void }) {
  const { t } = useI18n();
  const current = object(value);
  const currentId = text(current.id);
  const choices = currentId && !options.some((item) => item.id === currentId)
    ? [{ id: currentId, name: technicalChoiceLabel(current, t) }, ...options]
    : options;
  if (choices.length === 0) return <div className="offer-empty-choice">
    <input className="input" readOnly value={technicalChoiceLabel(current, t)} />
    <small className="offer-technical-note">{t(T.offer_no_account_options)}</small>
  </div>;
  return <select className="input" value={currentId} onChange={(event) => onChange(event.target.value ? { id: event.target.value } : null)}>
    <option value="">{t(T.offer_not_selected)}</option>
    {choices.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
  </select>;
}

type ParameterDialogState = { mode: "add" | "edit"; index: number | null; row: JsonObject; paramQuery: string; valueQuery: string; paramOpen: boolean; valueOpen: boolean };

function ParameterRows({ value, definitions, onChange }: { value: unknown; definitions: JsonObject[]; onChange: (value: unknown[]) => void }) {
  const { t } = useI18n();
  const [dialog, setDialog] = useState<ParameterDialogState | null>(null);
  const [deleteIndex, setDeleteIndex] = useState<number | null>(null);
  const rows = array(value).map(object);
  const byId = new Map(definitions.map((definition) => [text(definition.id), definition]));
  const selectedIds = new Set(rows.map((row) => text(row.id)).filter(Boolean));
  const displayRows = rows
    .map((row, index) => ({ row, index, definition: byId.get(text(row.id)) ?? {} }))
    .sort((left, right) => Number(right.definition.required === true) - Number(left.definition.required === true));
  const startAdd = () => setDialog({ mode: "add", index: null, row: {}, paramQuery: "", valueQuery: "", paramOpen: true, valueOpen: false });
  const startEdit = (index: number) => {
    const row = rows[index];
    const definition = byId.get(text(row.id)) ?? {};
    setDialog({ mode: "edit", index, row: parameterDraft(definition, row), paramQuery: "", valueQuery: "", paramOpen: false, valueOpen: false });
  };
  const dialogDefinition = dialog ? byId.get(text(dialog.row.id)) ?? {} : {};
  const selectDialogDefinition = (definition: JsonObject) => {
    if (!dialog) return;
    const existingIndex = rows.findIndex((row) => text(row.id) === text(definition.id));
    if (dialog.mode === "add" && existingIndex >= 0) {
      setDialog({
        mode: "edit",
        index: existingIndex,
        row: parameterDraft(definition, rows[existingIndex]),
        paramQuery: dialog.paramQuery,
        valueQuery: "",
        paramOpen: false,
        valueOpen: dictionaryOptions(definition).length > 0,
      });
      return;
    }
    const same = text(dialog.row.id) === text(definition.id);
    setDialog({
      ...dialog,
      row: same ? parameterDraft(definition, dialog.row) : parameterDraft(definition),
      paramOpen: false,
      paramQuery: "",
      valueOpen: dictionaryOptions(definition).length > 0,
      valueQuery: "",
    });
  };
  const updateDialogRow = (patch: JsonObject) => {
    if (!dialog) return;
    setDialog({ ...dialog, row: updateParameterValue(dialog.row, patch) });
  };
  const toggleDialogValue = (option: { id: string; label: string }) => {
    if (!dialog) return;
    const options = dictionaryOptions(dialogDefinition);
    const selectedIds = array(dialog.row.valuesIds).map(text).filter(Boolean);
    const multiple = isMultipleChoice(dialogDefinition, dialog.row);
    const exists = selectedIds.includes(option.id);
    const nextIds = multiple
      ? exists ? selectedIds.filter((id) => id !== option.id) : [...selectedIds, option.id]
      : exists ? [] : [option.id];
    const nextLabels = nextIds.map((id) => options.find((candidate) => candidate.id === id)?.label).filter(Boolean) as string[];
    setDialog({ ...dialog, row: updateParameterValue(dialog.row, { valuesIds: nextIds, values: nextLabels, rangeValue: undefined }), valueOpen: multiple });
  };
  const saveDialog = () => {
    if (!dialog || !text(dialog.row.id)) return;
    if (dialog.mode === "add") onChange([...rows, dialog.row]);
    else if (dialog.index != null) onChange(rows.map((row, rowIndex) => rowIndex === dialog.index ? dialog.row : row));
    setDialog(null);
  };
  const confirmDelete = () => {
    if (deleteIndex == null) return;
    onChange(withoutAt(rows, deleteIndex));
    setDeleteIndex(null);
  };
  const filteredDefinitions = dialog
    ? definitions
      .filter((definition) => `${text(definition.name)} ${text(definition.id)}`.toLocaleLowerCase("pl-PL").includes(dialog.paramQuery.toLocaleLowerCase("pl-PL")))
      .sort((left, right) => Number(right.required === true) - Number(left.required === true) || text(left.name).localeCompare(text(right.name), "pl-PL"))
    : [];
  const dialogOptions = dictionaryOptions(dialogDefinition);
  const filteredValues = dialogOptions
    .filter((option) => `${option.label} ${option.id}`.toLocaleLowerCase("pl-PL").includes(dialog?.valueQuery.toLocaleLowerCase("pl-PL") ?? ""))
    .slice(0, 80);
  const selectedDialogIds = dialog ? array(dialog.row.valuesIds).map(text).filter(Boolean) : [];
  const dialogRange = object(dialog?.row.rangeValue);
  const dialogType = text(dialogDefinition.type).toLocaleLowerCase("pl-PL");
  return <div className="offer-parameter-list">
    <div className="offer-parameter-add-row">
      <button type="button" className="btn btn-secondary compact" onClick={startAdd}><Plus size={14} />{t(T.offer_add_parameter)}</button>
    </div>
    {displayRows.map(({ row: parameter, index, definition }) => {
      const name = text(definition.name) || text(parameter.name) || t(T.offer_parameter_name);
      const unit = text(definition.unit);
      const summary = parameterSummary(parameter);
      const required = definition.required === true;
      return <div className="offer-parameter-card" key={`${text(parameter.id)}-${index}`}>
        <div className="offer-parameter-head">
          <div>
            <strong>{name}</strong>
            <span>{summary || t(T.offer_parameter_values)}{unit ? ` ${unit}` : ""}</span>
          </div>
          <div className="offer-parameter-meta">
            {required && <span>{t(T.offer_parameter_required)}</span>}
            <button type="button" className="btn btn-ghost compact" onClick={() => startEdit(index)}>{t(T.common_edit)}</button>
            {!required && <button type="button" className="btn btn-ghost btn-icon danger" title={t(T.common_delete)} onClick={() => setDeleteIndex(index)}><Trash2 size={15} /></button>}
          </div>
        </div>
      </div>;
    })}
    {dialog && <div className="offer-overlay-backdrop" role="dialog" aria-modal="true">
      <div className="offer-parameter-dialog">
        <header><h3>{dialog.mode === "add" ? t(T.offer_add_parameter) : t(T.common_edit)}</h3><button type="button" className="btn btn-ghost btn-icon" title={t(T.common_cancel)} onClick={() => setDialog(null)}><X size={16} /></button></header>
        <div className="offer-parameter-dialog-grid">
          <label className="offer-select-box">
            <span>{t(T.offer_parameter_name)}</span>
            <button type="button" className="input offer-overlay-select" onClick={() => setDialog({ ...dialog, paramOpen: !dialog.paramOpen, valueOpen: false })}>{text(dialogDefinition.name) || text(dialog.row.name) || t(T.offer_parameter_choose)}</button>
            {dialog.paramOpen && <div className="offer-select-popover">
              <div className="commerce-search compact"><Search size={15} /><input value={dialog.paramQuery} onChange={(event) => setDialog({ ...dialog, paramQuery: event.target.value })} placeholder={t(T.offer_parameter_search)} /></div>
              <div className="offer-select-list">
                {filteredDefinitions.map((definition) => <button type="button" key={text(definition.id)} className="offer-select-option" onClick={() => selectDialogDefinition(definition)}>
                  <span>{text(definition.name) || text(definition.id)}</span>
                  {selectedIds.has(text(definition.id)) && <small>{t(T.offer_parameter_added)}</small>}
                  {definition.required === true && <small>{t(T.offer_parameter_required)}</small>}
                </button>)}
              </div>
            </div>}
          </label>
          <label className="offer-select-box">
            <span>{t(T.offer_parameter_values)}</span>
            {dialogOptions.length > 0 ? <>
              <button type="button" className="input offer-overlay-select" disabled={!text(dialog.row.id)} onClick={() => setDialog({ ...dialog, valueOpen: !dialog.valueOpen, paramOpen: false })}>{parameterSummary(dialog.row) || t(T.offer_parameter_value_search)}</button>
              {dialog.valueOpen && <div className="offer-select-popover">
                <div className="commerce-search compact"><Search size={15} /><input value={dialog.valueQuery} onChange={(event) => setDialog({ ...dialog, valueQuery: event.target.value })} placeholder={t(T.offer_parameter_value_search)} /></div>
                <div className="offer-select-list">
                  {filteredValues.map((option) => {
                    const checked = selectedDialogIds.includes(option.id);
                    return <button type="button" key={option.id} className={`offer-select-option${checked ? " selected" : ""}`} onClick={() => toggleDialogValue(option)}>
                      <span>{checked && <Check size={13} />}{option.label}</span>
                    </button>;
                  })}
                </div>
              </div>}
            </> : Object.keys(dialogRange).length > 0 || Boolean(object(dialogDefinition.restrictions).range) ? <div className="offer-dialog-range">
              <input className="input" value={text(dialogRange.from)} placeholder={t(T.offer_parameter_range_from)} onChange={(event) => updateDialogRow({ rangeValue: { ...dialogRange, from: event.target.value }, values: [], valuesIds: [] })} />
              <input className="input" value={text(dialogRange.to)} placeholder={t(T.offer_parameter_range_to)} onChange={(event) => updateDialogRow({ rangeValue: { ...dialogRange, to: event.target.value }, values: [], valuesIds: [] })} />
            </div> : <input className="input" type={["integer", "float", "number"].includes(dialogType) ? "number" : "text"} value={commaList(dialog.row.values)} disabled={!text(dialog.row.id)} onChange={(event) => updateDialogRow({ values: event.target.value.split(",").map((item) => item.trim()).filter(Boolean), valuesIds: [], rangeValue: undefined })} />}
          </label>
        </div>
        <footer><button type="button" className="btn btn-secondary" onClick={() => setDialog(null)}>{t(T.common_cancel)}</button><button type="button" className="btn btn-primary" disabled={!text(dialog.row.id)} onClick={saveDialog}>{t(T.common_save)}</button></footer>
      </div>
    </div>}
    {deleteIndex != null && <div className="offer-overlay-backdrop" role="dialog" aria-modal="true">
      <div className="offer-confirm-dialog">
        <h3>{t(T.offer_delete_parameter_confirm, { name: text(byId.get(text(rows[deleteIndex].id))?.name) || text(rows[deleteIndex].name) || t(T.offer_parameter_name) })}</h3>
        <footer><button type="button" className="btn btn-secondary" onClick={() => setDeleteIndex(null)}>{t(T.common_cancel)}</button><button type="button" className="btn btn-primary" onClick={confirmDelete}>{t(T.common_delete)}</button></footer>
      </div>
    </div>}
  </div>;
}

function GpsrPartySelect({ kind, value, entries, onChange, onCreate, onEdit }: {
  kind: GpsrPartyKind; value: unknown; entries: JsonObject[]; onChange: (id: string) => void;
  onCreate: () => void; onEdit: (value: JsonObject) => void;
}) {
  const { t } = useI18n();
  const currentId = text(object(value).id);
  const current = entries.find((entry) => text(entry.id) === currentId);
  const addLabel = kind === "PERSON" ? t(T.offer_gpsr_add_person) : t(T.offer_gpsr_add_producer);
  return <div className="offer-choice-with-action">
    <select className="input" value={currentId} onChange={(event) => onChange(event.target.value)}>
      <option value="">{t(T.offer_not_selected)}</option>
      {entries.map((entry) => <option key={text(entry.id)} value={text(entry.id)}>{text(entry.name) || t(T.offer_gpsr_no_party)}</option>)}
    </select>
    {current && <button type="button" className="btn btn-ghost btn-icon" title={t(T.common_edit)} onClick={() => onEdit(current)}><Pencil size={15} /></button>}
    <button type="button" className="btn btn-secondary compact" onClick={onCreate}><Plus size={14} />{addLabel}</button>
  </div>;
}

function GpsrPartyDialog({ state, offerId, onClose, onSaved }: {
  state: GpsrDialogState; offerId: number; onClose: () => void; onSaved: (kind: GpsrPartyKind, productIndex: number, value: JsonObject) => void;
}) {
  const { t } = useI18n();
  const sectionKey = state.kind === "PERSON" ? "personalData" : "producerData";
  const [value, setValue] = useState<JsonObject>(() => structuredClone(state.value ?? {
    name: "",
    [sectionKey]: { name: "", address: { countryCode: "PL", street: "", postalCode: "", city: "" }, contact: { email: "", phoneNumber: "", formUrl: "" } },
  }));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    setValue(structuredClone(state.value ?? {
      name: "",
      [sectionKey]: { name: "", address: { countryCode: "PL", street: "", postalCode: "", city: "" }, contact: { email: "", phoneNumber: "", formUrl: "" } },
    }));
  }, [state, sectionKey]);

  const data = object(value[sectionKey]);
  const address = object(data.address);
  const contact = object(data.contact);
  const update = (path: Path, next: unknown) => setValue((current) => write(current, path, next));
  const title = state.kind === "PERSON" ? (text(value.id) ? t(T.offer_gpsr_edit_person) : t(T.offer_gpsr_add_person)) : (text(value.id) ? t(T.offer_gpsr_edit_producer) : t(T.offer_gpsr_add_producer));
  const submit = async () => {
    setSaving(true); setSaveError(false);
    try {
      const saved = await saveMarketplaceGpsrParty({ id: offerId, kind: state.kind, value });
      onSaved(state.kind, state.productIndex, saved);
    } catch { setSaveError(true); }
    finally { setSaving(false); }
  };
  const valid = text(value.name).trim() && text(data.name).trim() && text(address.countryCode).trim() && text(address.street).trim() && text(address.postalCode).trim() && text(address.city).trim() && (text(contact.email).trim() || text(contact.formUrl).trim());
  return <div className="offer-overlay-backdrop" role="dialog" aria-modal="true">
    <div className="offer-resource-dialog">
      <header><h3>{title}</h3><button type="button" className="btn btn-ghost btn-icon" title={t(T.common_close)} onClick={onClose}><X size={16} /></button></header>
      <div className="commerce-form-grid">
        <Field label={t(T.offer_gpsr_internal_name)}><input className="input" maxLength={50} value={text(value.name)} onChange={(event) => update(["name"], event.target.value)} /></Field>
        <Field label={t(T.offer_gpsr_legal_name)}><input className="input" value={text(data.name)} onChange={(event) => update([sectionKey, "name"], event.target.value)} /></Field>
        <Field label={t(T.offer_gpsr_country)}><CountrySelect value={text(address.countryCode)} onChange={(countryCode) => update([sectionKey, "address", "countryCode"], countryCode)} /></Field>
        <Field label={t(T.offer_gpsr_street)}><input className="input" value={text(address.street)} onChange={(event) => update([sectionKey, "address", "street"], event.target.value)} /></Field>
        <Field label={t(T.offer_gpsr_post_code)}><input className="input" value={text(address.postalCode)} onChange={(event) => update([sectionKey, "address", "postalCode"], event.target.value)} /></Field>
        <Field label={t(T.offer_gpsr_city)}><input className="input" value={text(address.city)} onChange={(event) => update([sectionKey, "address", "city"], event.target.value)} /></Field>
        <Field label={t(T.offer_gpsr_email)}><input className="input" type="email" value={text(contact.email)} onChange={(event) => update([sectionKey, "contact", "email"], event.target.value)} /></Field>
        <Field label={t(T.offer_gpsr_form_url)}><input className="input" type="url" value={text(contact.formUrl)} onChange={(event) => update([sectionKey, "contact", "formUrl"], event.target.value)} /></Field>
        <Field label={t(T.offer_gpsr_phone)} span={2}><input className="input" value={text(contact.phoneNumber)} onChange={(event) => update([sectionKey, "contact", "phoneNumber"], event.target.value)} /></Field>
      </div>
      {saveError && <div className="commerce-alert danger">{t(T.offer_gpsr_save_failed)}</div>}
      <footer><button type="button" className="btn btn-secondary" onClick={onClose}>{t(T.common_cancel)}</button><button type="button" className="btn btn-primary" disabled={!valid || saving} onClick={() => void submit()}>{saving ? t(T.common_please_wait) : t(T.common_save)}</button></footer>
    </div>
  </div>;
}

function SafetyAttachmentList({ offerId, value, onChange }: { offerId: number; value: unknown; onChange: (value: unknown[]) => void }) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const rows = array(value).map(object);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(false);
  const upload = async (file: File) => {
    setUploading(true); setUploadError(false);
    try {
      const uploaded = await uploadMarketplaceOfferAttachment({ id: offerId, fileName: file.name, contentType: file.type, bytes: Array.from(new Uint8Array(await file.arrayBuffer())) });
      onChange([...rows, { id: uploaded.id }]);
    } catch { setUploadError(true); }
    finally { setUploading(false); if (inputRef.current) inputRef.current.value = ""; }
  };
  return <div className="offer-safety-attachments">
    {rows.map((row, index) => <div className="offer-safety-attachment" key={`${text(row.id)}-${index}`}><span>{t(T.offer_gpsr_attachment_file, { n: index + 1 })}</span><button type="button" className="btn btn-ghost btn-icon danger" title={t(T.common_delete)} onClick={() => onChange(withoutAt(rows, index))}><Trash2 size={14} /></button></div>)}
    <input ref={inputRef} className="visually-hidden" type="file" accept="application/pdf,image/jpeg,image/png" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
    <button type="button" className="btn btn-secondary compact" disabled={uploading} onClick={() => inputRef.current?.click()}><ImagePlus size={14} />{uploading ? t(T.common_please_wait) : t(T.offer_gpsr_attachment_upload)}</button>
    {uploadError && <small className="offer-technical-note">{t(T.offer_gpsr_attachment_upload_failed)}</small>}
  </div>;
}

function SizeTableDialog({ value, templates, offerId, onClose, onSaved }: { value?: JsonObject; templates: JsonObject[]; offerId: number; onClose: () => void; onSaved: (value: JsonObject) => void }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<JsonObject>(() => structuredClone(value ?? { name: "", template: { id: text(templates[0]?.id) }, headers: array(templates[0]?.headers), values: array(templates[0]?.values) }));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const existing = Boolean(text(draft.id));
  const headers = array(draft.headers).map(object);
  const values = array(draft.values).map(object);
  const changeTemplate = (templateId: string) => {
    const template = templates.find((item) => text(item.id) === templateId) ?? {};
    setDraft((current) => ({ ...current, template: { id: templateId }, headers: structuredClone(array(template.headers)), values: structuredClone(array(template.values)) }));
  };
  const setHeader = (index: number, name: string) => setDraft((current) => write(current, ["headers", index, "name"], name));
  const setCell = (row: number, column: number, cell: string) => setDraft((current) => {
    const currentRow = object(array(current.values)[row]);
    const cells = array(currentRow.cells).map(text);
    cells[column] = cell;
    return write(current, ["values", row], { ...currentRow, cells });
  });
  const addRow = () => setDraft((current) => ({ ...current, values: [...array(current.values), { cells: headers.map(() => "") }] }));
  const submit = async () => {
    setSaving(true); setSaveError(false);
    try { onSaved(await saveMarketplaceSizeTable({ id: offerId, value: draft })); }
    catch { setSaveError(true); }
    finally { setSaving(false); }
  };
  const valid = text(draft.name).trim() && headers.length > 0 && values.length > 0 && (existing || text(object(draft.template).id));
  return <div className="offer-overlay-backdrop" role="dialog" aria-modal="true">
    <div className="offer-resource-dialog offer-size-table-dialog">
      <header><h3>{existing ? t(T.offer_size_table_edit) : t(T.offer_size_table_create)}</h3><button type="button" className="btn btn-ghost btn-icon" title={t(T.common_close)} onClick={onClose}><X size={16} /></button></header>
      <div className="offer-size-table-body">
        <div className="commerce-form-grid">
          <Field label={t(T.offer_size_table_name)}><input className="input" value={text(draft.name)} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></Field>
          <Field label={t(T.offer_size_table_template)}><select className="input" disabled={existing || templates.length === 0} value={text(object(draft.template).id)} onChange={(event) => changeTemplate(event.target.value)}><option value="">{t(T.offer_not_selected)}</option>{templates.map((template) => <option key={text(template.id)} value={text(template.id)}>{text(template.name) || text(template.id)}</option>)}</select>{!existing && templates.length === 0 && <small className="offer-technical-note">{t(T.offer_size_table_no_templates)}</small>}</Field>
        </div>
        {headers.length > 0 && <div className="offer-size-table-grid"><div className="offer-size-table-row headers" style={{ gridTemplateColumns: `repeat(${headers.length}, minmax(130px, 1fr))` }}>{headers.map((header, index) => <input className="input" key={index} value={text(header.name)} onChange={(event) => setHeader(index, event.target.value)} />)}</div>{values.map((row, rowIndex) => <div className="offer-size-table-row" key={rowIndex} style={{ gridTemplateColumns: `repeat(${headers.length}, minmax(130px, 1fr))` }}>{headers.map((_, columnIndex) => <input className="input" key={columnIndex} value={text(array(row.cells)[columnIndex])} onChange={(event) => setCell(rowIndex, columnIndex, event.target.value)} />)}</div>)}<button type="button" className="btn btn-secondary compact" onClick={addRow}><Plus size={14} />{t(T.offer_size_table_add_row)}</button></div>}
      </div>
      {saveError && <div className="commerce-alert danger">{t(T.offer_size_table_save_failed)}</div>}
      <footer><button type="button" className="btn btn-secondary" onClick={onClose}>{t(T.common_cancel)}</button><button type="button" className="btn btn-primary" disabled={!valid || saving} onClick={() => void submit()}>{saving ? t(T.common_please_wait) : t(T.common_save)}</button></footer>
    </div>
  </div>;
}

function normalizeMarketOptions(context: OfferEditorContext, activeIds: string[]): MarketplaceOption[] {
  const fromContext = array(context.marketplaces).map(object).map((item) => ({
    id: text(item.id),
    label: text(item.label) || text(item.name) || text(item.id),
    currency: text(item.currency) || "PLN",
  })).filter((item) => item.id);
  const merged = [...fromContext, ...FALLBACK_MARKETS];
  for (const id of activeIds) {
    if (!merged.some((item) => item.id === id)) merged.push({ id, label: id, currency: "PLN" });
  }
  return merged.filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index);
}

function marketplaceHasData(value: JsonObject): boolean {
  const price = object(object(value.sellingMode).price);
  return text(price.amount).trim() !== "" || text(price.currency).trim() !== "" || Object.keys(object(value.publication)).length > 0;
}

function AdditionalMarketplacesEditor({ payload, context, set }: { payload: JsonObject; context: OfferEditorContext; set: (path: Path, value: unknown) => void }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState("");
  const additional = object(payload.additionalMarketplaces);
  const activeIds = Object.entries(additional).filter(([, raw]) => marketplaceHasData(object(raw))).map(([id]) => id);
  const options = normalizeMarketOptions(context, activeIds);
  const active = activeIds.map((id) => [id, object(additional[id])] as const);
  const unused = options.filter((option) => !activeIds.includes(option.id));
  const addMarket = () => {
    const option = options.find((item) => item.id === draft) ?? unused[0];
    if (!option) return;
    set(["additionalMarketplaces"], {
      ...Object.fromEntries(active),
      [option.id]: { sellingMode: { price: { amount: "0.00", currency: option.currency } } },
    });
    setDraft("");
  };
  return <section>
    <h3>{t(T.offer_additional_marketplaces)}</h3>
    <div className="offer-market-list">
      {active.map(([marketplace, raw]) => {
        const option = options.find((item) => item.id === marketplace);
        const price = object(object(raw.sellingMode).price);
        return <div className="offer-market-row" key={marketplace}>
          <div className="offer-market-name"><strong>{option?.label ?? t(T.offer_selected_in_allegro)}</strong><span>{text(price.currency) || option?.currency || "PLN"}</span></div>
          <input className="input" type="number" min="0" step="0.01" value={text(price.amount)} onChange={(event) => set(["additionalMarketplaces", marketplace, "sellingMode", "price", "amount"], event.target.value)} />
          <select className="input offer-currency-short" value={text(price.currency) || option?.currency || "PLN"} onChange={(event) => set(["additionalMarketplaces", marketplace, "sellingMode", "price", "currency"], event.target.value)}>
            {["PLN", "CZK", "EUR", "HUF"].map((currency) => <option key={currency} value={currency}>{currency}</option>)}
          </select>
          <button type="button" className="btn btn-ghost btn-icon danger" title={t(T.common_delete)} onClick={() => set(["additionalMarketplaces"], Object.fromEntries(active.filter(([id]) => id !== marketplace)))}><Trash2 size={14} /></button>
        </div>;
      })}
      {unused.length > 0 && <div className="offer-market-add">
        <select className="input" value={draft || unused[0]?.id || ""} onChange={(event) => setDraft(event.target.value)}>
          {unused.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
        <button type="button" className="btn btn-secondary" onClick={addMarket}><Plus size={14} />{t(T.offer_add_marketplace)}</button>
      </div>}
    </div>
  </section>;
}

function AiImageMarks({ payload, images, set }: { payload: JsonObject; images: string[]; set: (path: Path, value: unknown) => void }) {
  const { t } = useI18n();
  const ai = object(payload.aiCoCreatedContent);
  const markedUrls = new Set(array(ai.images).map(object).map((item) => text(item.url)).filter(Boolean));
  const toggle = (url: string) => {
    const next = new Set(markedUrls);
    if (next.has(url)) next.delete(url);
    else next.add(url);
    const paths = array(ai.paths).map(text).filter((path) => path && path !== "images" && path !== "/images");
    if (next.size > 0) paths.push("images");
    set(["aiCoCreatedContent"], {
      ...ai,
      paths,
      images: [...next].map((item) => ({ url: item })),
    });
  };
  return <section>
    <h3>{t(T.offer_ai_images)}</h3>
    <div className="offer-ai-image-grid">
      {images.map((url, index) => {
        const marked = markedUrls.has(url);
        return <button type="button" key={`${url}-${index}`} className={`offer-ai-image ${marked ? "selected" : ""}`} onClick={() => toggle(url)}>
          <img src={url} alt="" />
          <span><Sparkles size={14} />{marked ? t(T.offer_ai_unmark_image) : t(T.offer_ai_mark_image)}</span>
        </button>;
      })}
    </div>
  </section>;
}

export default function AllegroOfferEditor({ details, busy, onClose, onSaveDraft, onSubmit, onUploadImage }: Props) {
  const { t } = useI18n();
  const [payload, setPayload] = useState<JsonObject>(() => structuredClone(details.editablePayload));
  const [context, setContext] = useState<OfferEditorContext>({});
  const [contextError, setContextError] = useState("");
  const [tab, setTab] = useState<Tab>("MAIN");
  const [categoryQuery, setCategoryQuery] = useState("");
  const [categoryParentId, setCategoryParentId] = useState("");
  const [categoryOptions, setCategoryOptions] = useState<CategorySuggestion[]>([]);
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [categoryError, setCategoryError] = useState("");
  const [contextRevision, setContextRevision] = useState(0);
  const [gpsrDialog, setGpsrDialog] = useState<GpsrDialogState | null>(null);
  const [sizeTableDialog, setSizeTableDialog] = useState<JsonObject | null>(null);
  const set = (path: Path, value: unknown) => setPayload((current) => write(current, path, value));
  const images = array(payload.images).map(text).filter(Boolean);
  const productSet = array(payload.productSet).map(object);
  const descriptionSections = array(object(payload.description).sections).map(object);
  const categoryId = text(object(payload.category).id).trim();
  const productParameterDefinitions = parameterDefinitions(context, "PRODUCT");
  const offerParameterDefinitions = parameterDefinitions(context, "OFFER");
  const currentCategory = selectedCategory(context);
  const shippingRateOptions = contextOptions(context, "shippingRates");
  const returnPolicyOptions = contextOptions(context, "returnPolicies");
  const warrantyOptions = contextOptions(context, "warranties");
  const impliedWarrantyOptions = contextOptions(context, "impliedWarranties");
  const sizeTableOptions = contextOptions(context, "sizeTables");
  const responsiblePersonEntries = array(context.responsiblePersons).map(object);
  const responsibleProducerEntries = array(context.responsibleProducers).map(object);
  const sizeTableTemplates = array(context.sizeTableTemplates).map(object);
  const handlingLabel = (value: string) => value === "PT0S"
    ? t(T.offer_handling_immediate)
    : value === "PT24H"
      ? t(T.offer_handling_one_day)
      : t(T.offer_handling_days, { n: Number(value.match(/\d+/)?.[0] ?? 0) });
  const missingFields = useMemo(() => firstMissingAllegroFields(payload, context, t), [payload, context, t]);
  const canSave = missingFields.length === 0;
  const setCategory = (value: string) => setPayload((current) => {
    let next = write(current, ["category", "id"], value);
    if (array(next.productSet).length > 0) next = write(next, ["productSet", 0, "product", "category", "id"], value);
    return next;
  });
  const tabs: { id: Tab; label: T }[] = [
    { id: "MAIN", label: T.offer_tab_main },
    { id: "MEDIA", label: T.offer_tab_media },
    { id: "PRODUCT", label: T.offer_tab_product },
    { id: "GPSR", label: T.offer_tab_gpsr },
    { id: "SALE", label: T.offer_tab_sale },
    { id: "DELIVERY", label: T.offer_tab_delivery },
    { id: "MARKETS", label: T.offer_tab_markets },
    { id: "ADVANCED", label: T.offer_tab_advanced },
  ];
  const offerUrl = allegroOfferUrl(details.offer.externalOfferId);

  useEffect(() => {
    let live = true;
    getMarketplaceOfferEditorContext(details.offer.id, categoryId)
      .then((value) => { if (live) { setContext(value); setContextError(""); } })
      .catch((error) => { if (live) setContextError(error instanceof Error ? error.message : String(error)); });
    return () => { live = false; };
  }, [details.offer.id, categoryId, contextRevision]);

  useEffect(() => {
    let live = true;
    setCategoryLoading(true);
    getMarketplaceOfferCategories(details.offer.id, categoryParentId, categoryQuery)
      .then((value) => {
        if (!live) return;
        setCategoryOptions(categorySuggestions({ categorySuggestions: value }));
        setCategoryError("");
      })
      .catch((error) => {
        if (!live) return;
        setCategoryOptions([]);
        setCategoryError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => { if (live) setCategoryLoading(false); });
    return () => { live = false; };
  }, [details.offer.id, categoryParentId, categoryQuery]);

  return <CommerceModal title={t(T.offer_edit_allegro)} onClose={onClose} wide>
    <div className="offer-editor-context">
      <div className="offer-editor-context-main"><strong>{details.offer.title}</strong><span>{details.offer.accountName}</span></div>
      {offerUrl ? <a className="offer-platform-link allegro" href={offerUrl} target="_blank" rel="noreferrer" title={t(T.offer_open_in_allegro)}>
        <img src="/logos/allegro.svg" alt="Allegro" />
        <span>ID {details.offer.externalOfferId}</span>
        <ExternalLink size={14} />
      </a> : <span className="commerce-subline">ID {details.offer.externalOfferId}</span>}
    </div>
    <div className="offer-editor-tabs" role="tablist">{tabs.map((item) => <button type="button" role="tab" aria-selected={tab === item.id} key={item.id} className={`commerce-seg-btn${tab === item.id ? " active" : ""}`} onClick={(event) => { setTab(item.id); (event.currentTarget.closest(".commerce-modal") as HTMLElement | null)?.scrollTo({ top: 0 }); }}>{t(item.label)}</button>)}</div>
    {details.offer.validationIssues.length > 0 && <div className="commerce-alert warn"><strong>{t(T.offer_validation_heading)}</strong>{details.offer.validationIssues.map((issue) => <span key={`${issue.code}-${issue.path}`}>{issue.code}{issue.path ? ` · ${issue.path}` : ""}</span>)}</div>}
    {missingFields.length > 0 && <div className="commerce-alert warn"><strong>{t(T.offer_required_missing)}</strong>{missingFields.slice(0, 8).map((field) => <span key={field}>{field}</span>)}{missingFields.length > 8 && <span>{t(T.offer_required_more, { n: missingFields.length - 8 })}</span>}</div>}
    {contextError && <div className="commerce-alert warn">{t(T.offer_context_unavailable)}</div>}

    <div className="offer-editor-body">
      {tab === "MAIN" && <div className="commerce-form-grid">
        <Field label={t(T.offer_field_title)} span={2}><input className="input" maxLength={75} value={text(payload.name)} onChange={(event) => set(["name"], event.target.value)} /></Field>
        <Field label={t(T.offer_field_sku)}><input className="input" maxLength={100} value={text(object(payload.external).id)} onChange={(event) => set(["external", "id"], event.target.value)} /></Field>
        <Field label={t(T.offer_field_category)}><CategoryPicker value={categoryId} selected={currentCategory} query={categoryQuery} parentId={categoryParentId} suggestions={categoryOptions} loading={categoryLoading} error={categoryError} onQuery={setCategoryQuery} onParentChange={setCategoryParentId} onChange={setCategory} /></Field>
        <Field label={t(T.offer_field_language)}><select className="input" value={text(payload.language) || "pl-PL"} onChange={(event) => set(["language"], event.target.value)}>{["pl-PL", "en-US", "cs-CZ", "sk-SK", "hu-HU", "uk-UA"].map((language) => <option key={language} value={language}>{language}</option>)}</select></Field>
        <Field label={t(T.offer_message_mode)}><select className="input" value={text(object(payload.messageToSellerSettings).mode) || "OPTIONAL"} onChange={(event) => set(["messageToSellerSettings", "mode"], event.target.value)}><option value="OPTIONAL">{t(T.offer_message_optional)}</option><option value="REQUIRED">{t(T.offer_message_required)}</option><option value="HIDDEN">{t(T.offer_message_hidden)}</option></select></Field>
        <Field label={t(T.offer_message_hint)} span={2}><input className="input" value={text(object(payload.messageToSellerSettings).hint)} onChange={(event) => set(["messageToSellerSettings", "hint"], event.target.value)} /></Field>
        <label className="commerce-check"><input type="checkbox" checked={Boolean(object(payload.b2b).buyableOnlyByBusiness)} onChange={(event) => set(["b2b", "buyableOnlyByBusiness"], event.target.checked)} />{t(T.offer_b2b_only)}</label>
      </div>}

      {tab === "MEDIA" && <div className="offer-editor-stack">
        <section><h3>{t(T.offer_images)}</h3><OfferImageGallery images={images} onChange={(value) => set(["images"], value)} onUpload={onUploadImage} /></section>
        <DescriptionSectionsEditor sections={descriptionSections} images={images} set={set} />
      </div>}

      {tab === "PRODUCT" && <div className="offer-editor-stack parameter-tab">
        {productSet.map((setItem, index) => {
          const product = object(setItem.product);
          return <section key={index} className="offer-parameter-group">
            <div className="offer-parameter-group-head">
              <div><h3>{t(T.offer_product_parameters)}{productSet.length > 1 ? ` ${index + 1}` : ""}</h3>{text(product.name) && <span>{text(product.name)}</span>}</div>
            </div>
            <ParameterRows value={product.parameters} definitions={productParameterDefinitions} onChange={(value) => set(["productSet", index, "product", "parameters"], value)} />
          </section>;
        })}
        <section className="offer-parameter-group">
          <div className="offer-parameter-group-head"><div><h3>{t(T.offer_offer_parameters)}</h3></div></div>
          <ParameterRows value={payload.parameters} definitions={offerParameterDefinitions} onChange={(value) => set(["parameters"], value)} />
        </section>
      </div>}

      {tab === "GPSR" && <div className="offer-editor-stack">
        {productSet.map((setItem, index) => { const product = object(setItem.product); const safety = object(setItem.safetyInformation); return <section key={index} className="offer-product-section"><div className="offer-section-title"><h3>{t(T.offer_product)} {index + 1}</h3><button type="button" className="btn btn-ghost btn-icon danger" title={t(T.common_delete)} onClick={() => set(["productSet"], withoutAt(productSet, index))}><Trash2 size={15} /></button></div><div className="commerce-form-grid">
          <Field label={t(T.offer_product_name)} span={2}><input className="input" value={text(product.name)} onChange={(event) => set(["productSet", index, "product", "name"], event.target.value)} />{text(product.id) && <small className="offer-technical-note">{t(T.offer_product_catalog_linked)}</small>}</Field>
          <Field label={t(T.offer_product_quantity)}><input className="input" type="number" min="1" value={number(object(setItem.quantity).value) || 1} onChange={(event) => set(["productSet", index, "quantity", "value"], Number(event.target.value))} /></Field>
          {index === 0 && <Field label={t(T.offer_responsible_person)}><GpsrPartySelect kind="PERSON" value={setItem.responsiblePerson} entries={responsiblePersonEntries} onChange={(partyId) => set(["productSet", index, "responsiblePerson"], partyId ? { id: partyId } : null)} onCreate={() => setGpsrDialog({ kind: "PERSON", productIndex: index })} onEdit={(value) => setGpsrDialog({ kind: "PERSON", productIndex: index, value })} /></Field>}
          <Field label={t(T.offer_responsible_producer)}><GpsrPartySelect kind="PRODUCER" value={setItem.responsibleProducer} entries={responsibleProducerEntries} onChange={(partyId) => set(["productSet", index, "responsibleProducer"], partyId ? { type: "ID", id: partyId } : null)} onCreate={() => setGpsrDialog({ kind: "PRODUCER", productIndex: index })} onEdit={(value) => setGpsrDialog({ kind: "PRODUCER", productIndex: index, value })} /></Field>
          <Field label={t(T.offer_safety_type)}><select className="input" value={text(safety.type) || "TEXT"} onChange={(event) => set(["productSet", index, "safetyInformation"], event.target.value === "ATTACHMENTS" ? { type: "ATTACHMENTS", attachments: [] } : { type: "TEXT", description: "" })}><option value="TEXT">{t(T.offer_safety_text)}</option><option value="ATTACHMENTS">{t(T.offer_safety_attachments)}</option></select></Field>
          {text(safety.type) === "ATTACHMENTS" ? <Field label={t(T.offer_attachments)}><SafetyAttachmentList offerId={details.offer.id} value={safety.attachments} onChange={(value) => set(["productSet", index, "safetyInformation", "attachments"], value)} /></Field> : <Field label={t(T.offer_safety_description)} span={2}><textarea className="input commerce-textarea" maxLength={5000} value={text(safety.description)} onChange={(event) => set(["productSet", index, "safetyInformation", "description"], event.target.value)} /></Field>}
          <label className="commerce-check"><input type="checkbox" checked={Boolean(setItem.marketedBeforeGPSRObligation)} onChange={(event) => set(["productSet", index, "marketedBeforeGPSRObligation"], event.target.checked)} />{t(T.offer_marketed_before_gpsr)}</label>
        </div></section>; })}
        <button type="button" className="btn btn-secondary offer-add-product-button" onClick={() => set(["productSet"], [...productSet, { quantity: { value: 1 }, product: { id: "", parameters: [] }, safetyInformation: { type: "TEXT", description: "" } }])}><Plus size={15} />{t(T.offer_add_product)}</button>
      </div>}

      {tab === "SALE" && <div className="commerce-form-grid">
        <Field label={t(T.offer_selling_format)}><select className="input" value={text(object(payload.sellingMode).format) || "BUY_NOW"} onChange={(event) => set(["sellingMode", "format"], event.target.value)}><option value="BUY_NOW">{t(T.offer_format_buy_now)}</option><option value="AUCTION">{t(T.offer_format_auction)}</option><option value="ADVERTISEMENT">{t(T.offer_format_advertisement)}</option></select></Field>
        <Field label={t(T.offer_field_price)}><div className="offer-money"><input className="input" type="number" min="1" step="0.01" value={number(object(object(payload.sellingMode).price).amount)} onChange={(event) => set(["sellingMode", "price", "amount"], event.target.value)} /><CurrencySelect value={text(object(object(payload.sellingMode).price).currency)} onChange={(currency) => set(["sellingMode", "price", "currency"], currency)} /></div></Field>
        <Field label={t(T.offer_starting_price)}><input className="input" type="number" min="0" step="0.01" value={text(object(object(payload.sellingMode).startingPrice).amount)} onChange={(event) => set(["sellingMode", "startingPrice", "amount"], event.target.value)} /></Field>
        <Field label={t(T.offer_minimal_price)}><input className="input" type="number" min="0" step="0.01" value={text(object(object(payload.sellingMode).minimalPrice).amount)} onChange={(event) => set(["sellingMode", "minimalPrice", "amount"], event.target.value)} /></Field>
        <Field label={t(T.offer_field_stock)}><input className="input" type="number" min="0" value={number(object(payload.stock).available)} onChange={(event) => set(["stock", "available"], Number(event.target.value))} /></Field>
        <Field label={t(T.offer_stock_unit)}><select className="input" value={text(object(payload.stock).unit) || "UNIT"} onChange={(event) => set(["stock", "unit"], event.target.value)}><option value="UNIT">{t(T.offer_unit_unit)}</option><option value="PAIR">{t(T.offer_unit_pair)}</option><option value="SET">{t(T.offer_unit_set)}</option></select></Field>
        <Field label={t(T.offer_invoice_type)}><select className="input" value={text(object(payload.payments).invoice) || "VAT"} onChange={(event) => set(["payments", "invoice"], event.target.value)}><option value="VAT">{t(T.offer_invoice_vat)}</option><option value="VAT_MARGIN">{t(T.offer_invoice_vat_margin)}</option><option value="WITHOUT_VAT">{t(T.offer_invoice_without_vat)}</option><option value="NO_INVOICE">{t(T.offer_invoice_none)}</option></select></Field>
        <Field label={t(T.offer_publication_status)}><select className="input" value={text(object(payload.publication).status) || "INACTIVE"} onChange={(event) => set(["publication", "status"], event.target.value)}><option value="INACTIVE">{t(T.offer_publication_inactive)}</option><option value="ACTIVE">{t(T.offer_publication_active)}</option><option value="ENDED">{t(T.offer_publication_ended)}</option></select></Field>
        <Field label={t(T.offer_publication_duration)}><select className="input" value={text(object(payload.publication).duration)} onChange={(event) => set(["publication", "duration"], event.target.value || null)}><option value="">{t(T.offer_duration_until_ended)}</option>{[3, 5, 7, 10, 20, 30].map((days) => <option key={days} value={`P${days}D`}>{t(T.offer_duration_days, { n: days })}</option>)}</select></Field>
        <Field label={t(T.offer_publication_start)}><input className="input" type="datetime-local" value={text(object(payload.publication).startingAt).slice(0, 16)} onChange={(event) => set(["publication", "startingAt"], event.target.value ? new Date(event.target.value).toISOString() : null)} /></Field>
        <label className="commerce-check"><input type="checkbox" checked={Boolean(object(payload.publication).republish)} onChange={(event) => set(["publication", "republish"], event.target.checked)} />{t(T.offer_republish)}</label>
        <Field label={t(T.offer_tax_subject)}><select className="input" value={text(object(payload.taxSettings).subject) || "GOODS"} onChange={(event) => set(["taxSettings", "subject"], event.target.value)}><option value="GOODS">{t(T.offer_tax_goods)}</option><option value="SERVICES">{t(T.offer_tax_services)}</option></select></Field>
        <Field label={t(T.offer_tax_exemption)}><input className="input" value={text(object(payload.taxSettings).exemption)} onChange={(event) => set(["taxSettings", "exemption"], event.target.value)} /></Field>
        <Field label={t(T.offer_tax_rates)} span={2}><div className="offer-simple-list">{array(object(payload.taxSettings).rates).map(object).map((rate, index) => <div className="offer-simple-row" key={index}><CountrySelect value={text(rate.countryCode)} onChange={(countryCode) => set(["taxSettings", "rates", index, "countryCode"], countryCode)} /><input className="input" type="number" min="0" step="0.01" value={text(rate.rate)} onChange={(event) => set(["taxSettings", "rates", index, "rate"], event.target.value)} /><button type="button" className="btn btn-ghost btn-icon danger" title={t(T.common_delete)} onClick={() => set(["taxSettings", "rates"], withoutAt(array(object(payload.taxSettings).rates), index))}><Trash2 size={14} /></button></div>)}<button type="button" className="btn btn-secondary" onClick={() => set(["taxSettings", "rates"], [...array(object(payload.taxSettings).rates), { countryCode: "PL", rate: "23.00" }])}><Plus size={14} />{t(T.offer_add_tax_rate)}</button></div></Field>
      </div>}

      {tab === "DELIVERY" && <div className="offer-editor-stack">
        <section><h3>{t(T.offer_delivery)}</h3><div className="commerce-form-grid"><Field label={t(T.offer_handling_time)}><select className="input" value={text(object(payload.delivery).handlingTime) || "PT24H"} onChange={(event) => set(["delivery", "handlingTime"], event.target.value)}>{HANDLING_TIMES.map((value) => <option key={value} value={value}>{handlingLabel(value)}</option>)}</select></Field><Field label={t(T.offer_shipment_date)}><input className="input" type="datetime-local" value={text(object(payload.delivery).shipmentDate).slice(0, 16)} onChange={(event) => set(["delivery", "shipmentDate"], event.target.value ? new Date(event.target.value).toISOString() : null)} /></Field><Field label={t(T.offer_shipping_rate_name)} span={2}><NamedChoiceSelect value={object(payload.delivery).shippingRates} options={shippingRateOptions} onChange={(value) => set(["delivery", "shippingRates"], value)} /></Field></div></section>
        <section><h3>{t(T.offer_location)}</h3><div className="commerce-form-grid"><Field label={t(T.offer_location_city)}><input className="input" value={text(object(payload.location).city)} onChange={(event) => set(["location", "city"], event.target.value)} /></Field><Field label={t(T.offer_location_post_code)}><input className="input" value={text(object(payload.location).postCode)} onChange={(event) => set(["location", "postCode"], event.target.value)} /></Field><Field label={t(T.offer_location_country)}><CountrySelect value={text(object(payload.location).countryCode)} onChange={(countryCode) => set(["location", "countryCode"], countryCode)} /></Field><Field label={t(T.offer_location_province)}><select className="input" value={text(object(payload.location).province)} onChange={(event) => set(["location", "province"], event.target.value)}><option value="" />{PROVINCES.map((value) => <option key={value} value={value}>{codeLabel(value)}</option>)}</select></Field></div></section>
        <section><h3>{t(T.offer_policies)}</h3><div className="commerce-form-grid"><Field label={t(T.offer_return_policy)}><NamedChoiceSelect value={object(object(payload.afterSalesServices).returnPolicy)} options={returnPolicyOptions} onChange={(value) => set(["afterSalesServices", "returnPolicy"], value)} /></Field><Field label={t(T.offer_warranty)}><NamedChoiceSelect value={object(object(payload.afterSalesServices).warranty)} options={warrantyOptions} onChange={(value) => set(["afterSalesServices", "warranty"], value)} /></Field><Field label={t(T.offer_implied_warranty)}><NamedChoiceSelect value={object(object(payload.afterSalesServices).impliedWarranty)} options={impliedWarrantyOptions} onChange={(value) => set(["afterSalesServices", "impliedWarranty"], value)} /></Field><Field label={t(T.offer_size_table)}><div className="offer-choice-with-action"><NamedChoiceSelect value={object(payload.sizeTable)} options={sizeTableOptions} onChange={(value) => set(["sizeTable"], value)} /><button type="button" className="btn btn-secondary compact" onClick={() => { const selected = sizeTableOptions.find((option) => option.id === text(object(payload.sizeTable).id)); const full = array(context.sizeTables).map(object).find((item) => text(item.id) === selected?.id); setSizeTableDialog(full ?? {}); }}><Plus size={14} />{text(object(payload.sizeTable).id) ? t(T.offer_size_table_edit) : t(T.offer_size_table_create)}</button></div></Field></div></section>
      </div>}

      {tab === "MARKETS" && <div className="offer-editor-stack">
        <AdditionalMarketplacesEditor payload={payload} context={context} set={set} />
      </div>}

      {tab === "ADVANCED" && <div className="offer-editor-stack">
        <AiImageMarks payload={payload} images={images} set={set} />
      </div>}
    </div>
    {gpsrDialog && <GpsrPartyDialog state={gpsrDialog} offerId={details.offer.id} onClose={() => setGpsrDialog(null)} onSaved={(kind, productIndex, saved) => { set(["productSet", productIndex, kind === "PERSON" ? "responsiblePerson" : "responsibleProducer"], kind === "PERSON" ? { id: text(saved.id) } : { type: "ID", id: text(saved.id) }); setGpsrDialog(null); setContextRevision((current) => current + 1); }} />}
    {sizeTableDialog && <SizeTableDialog value={sizeTableDialog} templates={sizeTableTemplates} offerId={details.offer.id} onClose={() => setSizeTableDialog(null)} onSaved={(saved) => { set(["sizeTable"], { id: text(saved.id) }); setSizeTableDialog(null); setContextRevision((current) => current + 1); }} />}
    <footer className="commerce-modal-actions"><button type="button" className="btn btn-secondary" onClick={onClose}>{t(T.common_cancel)}</button><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => onSaveDraft(payload)}>{busy ? t(T.common_please_wait) : t(T.offer_save_draft)}</button><button type="button" className="btn btn-primary" disabled={busy || !canSave} onClick={() => onSubmit(payload)}>{busy ? t(T.common_please_wait) : t(T.offer_send_to_allegro)}</button></footer>
  </CommerceModal>;
}
