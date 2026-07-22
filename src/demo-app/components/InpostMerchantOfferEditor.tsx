import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Search, X } from "lucide-react";

import { CommerceModal, Field, StatusPill } from "./CommerceUi";
import OfferImageGallery from "./OfferImageGallery";
import { RichDescriptionEditor } from "./OfferDescriptionEditor";
import { getMarketplaceOfferCategories, getMarketplaceOfferEditorContext, type JsonObject, type OfferDetails } from "../lib/commerceApi";
import { T, useI18n } from "../lib/i18n";

type CategoryNode = { id: string; name: string; leaf: boolean; path: string; children: CategoryNode[] };

function categoryNodes(rows: JsonObject[]): CategoryNode[] {
  return rows
    .map((row) => {
      const children = Array.isArray(row.children) ? categoryNodes(row.children.map((child) => child as JsonObject)) : [];
      const leaf = typeof row.leaf === "boolean"
        ? row.leaf
        : children.length === 0;
      return {
        id: String(row.id ?? ""),
        name: String(row.name ?? ""),
        leaf,
        path: String(row.path ?? ""),
        children,
      };
    })
    .filter((row) => row.id && row.name);
}

// Picker kategorii InPost — kategorie są globalne i przeglądane po rodzicu (bez wyszukiwarki
// serwerowej), więc drążymy drzewo (korzeń → dzieci), a `query` filtruje bieżący poziom lokalnie.
// Styl (klasy offer-category-*) współdzielony z pickerem Allegro dla spójnego wyglądu.
function InpostCategoryPicker({ offerId, value, selected, onChange }: { offerId: number; value: string; selected: CategoryNode | null; onChange: (id: string) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [stack, setStack] = useState<{ id: string; name: string }[]>([]);
  const [options, setOptions] = useState<CategoryNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [localSelected, setLocalSelected] = useState<CategoryNode | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const cacheRef = useRef(new Map<string, CategoryNode[]>());
  const current = localSelected?.id === value ? localSelected : selected?.id === value ? selected : null;
  const currentParent = stack[stack.length - 1] ?? null;
  const currentPath = stack.map((node) => node.name).join(" / ");

  const loadLevel = async (parentId?: string) => {
    const cacheKey = parentId?.trim() || "__root__";
    const cached = cacheRef.current.get(cacheKey);
    if (cached) {
      setOptions(cached);
      return cached;
    }

    setLoading(true);
    setError("");
    try {
      const rows = await getMarketplaceOfferCategories(offerId, parentId || undefined);
      const next = categoryNodes(rows);
      cacheRef.current.set(cacheKey, next);
      setOptions(next);
      return next;
    } catch {
      setOptions([]);
      setError(t(T.offer_category_no_results));
      return [];
    } finally {
      setLoading(false);
    }
  };

  const close = () => {
    setOpen(false);
    setStack([]);
    setError("");
    setLoading(false);
  };
  const openRoot = () => {
    setOpen(true);
    setStack([]);
    void loadLevel();
  };
  const select = (node: CategoryNode) => {
    setLocalSelected(node);
    onChange(node.id);
    close();
  };
  const browse = async (node: CategoryNode) => {
    if (node.children.length > 0) {
      cacheRef.current.set(node.id, node.children);
      setStack((current) => [...current, node]);
      setOptions(node.children);
      return;
    }

    const next = await loadLevel(node.id);
    if (next.length === 0) {
      select(node);
      return;
    }
    setStack((current) => [...current, node]);
  };
  const back = () => {
    setError("");
    setStack((current) => {
      const nextStack = current.slice(0, -1);
      const parent = nextStack[nextStack.length - 1] ?? null;
      const cacheKey = parent?.id || "__root__";
      const cached = cacheRef.current.get(cacheKey);
      if (cached) {
        setOptions(cached);
      } else {
        void loadLevel(parent?.id);
      }
      return nextStack;
    });
  };
  const clear = () => {
    setLocalSelected(null);
    onChange("");
    close();
  };

  useEffect(() => {
    if (selected?.id === value) setLocalSelected(selected);
    if (!value) setLocalSelected(null);
  }, [selected, value]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => { if (!pickerRef.current?.contains(event.target as Node)) close(); };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [open]);
  const label = current?.name || (value ? t(T.offer_category_unavailable) : t(T.offer_category_choose));

  return <div className="offer-category-picker" ref={pickerRef}>
    <div className="offer-category-control">
      <button type="button" className="offer-category-trigger" aria-expanded={open} aria-haspopup="listbox" onClick={() => open ? close() : openRoot()}>
        <span><strong>{label}</strong>{current?.path ? <small>{current.path}</small> : currentPath ? <small>{currentPath}</small> : null}</span>
        <Search size={16} />
      </button>
      {value && <button type="button" className="offer-category-clear" title={t(T.offer_category_clear)} onClick={clear}><X size={15} /></button>}
    </div>
    {open && <div className="offer-category-popover" role="dialog">
      {currentParent && <button type="button" className="offer-category-back" onClick={back}>{t(T.offer_category_back)}</button>}
      {loading && <p className="offer-category-state">{t(T.common_loading)}</p>}
      {!loading && error && <p className="offer-category-state">{error}</p>}
      {!loading && !error && options.length === 0 && <p className="offer-category-state">{t(T.offer_category_no_results)}</p>}
      {!loading && !error && options.length > 0 && <div className="offer-category-results" role="listbox">
        {options.map((node) => <button type="button" key={node.id} className="offer-category-option" role="option" onClick={() => node.leaf ? select(node) : void browse(node)}>
          <strong>{node.name}</strong>
          <span>{node.path}{!node.leaf ? ` - ${t(T.offer_category_open_children)}` : ""}</span>
        </button>)}
      </div>}
    </div>}
  </div>;
}

type Path = (string | number)[];
type Tab = "PRODUCT" | "SALE" | "MEDIA" | "GPSR";
type Props = {
  details: OfferDetails;
  busy: boolean;
  onClose: () => void;
  onSubmit: (payload: JsonObject) => void;
  onUploadImage: (file: File) => Promise<string>;
};

const object = (value: unknown): JsonObject => value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string => typeof value === "string" ? value : "";
const number = (value: unknown): number => typeof value === "number" ? value : Number(value || 0);
const SHIPPING_TIMES = ["P1D", "P2D", "P3D", "P4D", "P5D", "P7D", "P10D", "P14D", "P21D", "P30D"];

function selectedCategory(context: JsonObject): CategoryNode | null {
  const item = object(context.selectedCategory);
  const id = text(item.id);
  const name = text(item.name);
  return id && name ? { id, name, path: text(item.path), leaf: item.leaf !== false, children: [] } : null;
}

function inpostMerchantOfferUrl(payload: JsonObject, fallbackId?: string): string {
  const directUrl = [payload.publicUrl, payload.offerUrl, payload.url]
    .map(text)
    .find((url) => /^https?:\/\//i.test(url.trim()));
  if (directUrl) return directUrl.trim();
  const id = text(fallbackId || payload.id).trim();
  return id ? `https://merchant.inpost-group.com/offers/${encodeURIComponent(id)}` : "";
}

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

function imageUrl(value: unknown): string {
  return typeof value === "string" ? value : text(object(value).fileUrl);
}

export default function InpostMerchantOfferEditor({ details, busy, onClose, onSubmit, onUploadImage }: Props) {
  const { t } = useI18n();
  const [payload, setPayload] = useState<JsonObject>(() => structuredClone(details.editablePayload));
  const [context, setContext] = useState<JsonObject>({});
  const [tab, setTab] = useState<Tab>("PRODUCT");
  const set = (path: Path, value: unknown) => setPayload((current) => write(current, path, value));
  const product = object(payload.product);
  const categoryId = text(product.categoryId).trim();
  const stock = object(payload.stock);
  const price = object(payload.price);
  const grossPrice = object(price.grossPrice);
  const taxRateInfo = object(price.taxRateInfo);
  const gpsr = object(payload.gpsr);
  const manufacturer = object(gpsr.manufacturer);
  const imageObjects = array(payload.images).map((value, index) => {
    if (typeof value === "string") return { fileName: `image-${index + 1}`, fileUrl: value, priority: index + 1 };
    return object(value);
  });
  const images = imageObjects.map(imageUrl).filter(Boolean);
  const shippingTime = text(payload.shippingTime) || "P2D";
  const externalOfferId = text(details.offer.externalOfferId).trim();
  const offerUrl = inpostMerchantOfferUrl(payload, externalOfferId);
  const currentCategory = selectedCategory(context);
  const shippingLabel = (value: string) => value === "P1D"
    ? t(T.offer_handling_one_day)
    : t(T.offer_handling_days, { n: Number(value.match(/\d+/)?.[0] ?? 0) });
  const canSave = useMemo(() => text(product.name).trim().length > 0
    && number(grossPrice.amount) >= 0
    && Number.isInteger(number(stock.quantity))
    && number(stock.quantity) >= 0, [grossPrice.amount, product.name, stock.quantity]);
  const tabs: { id: Tab; label: T }[] = [
    { id: "PRODUCT", label: T.offer_tab_product },
    { id: "SALE", label: T.offer_tab_sale },
    { id: "MEDIA", label: T.offer_tab_media },
    { id: "GPSR", label: T.offer_tab_gpsr },
  ];

  useEffect(() => {
    if (!categoryId) {
      setContext({});
      return;
    }
    let live = true;
    getMarketplaceOfferEditorContext(details.offer.id, categoryId)
      .then((value) => { if (live) setContext(value); })
      .catch(() => { if (live) setContext({}); });
    return () => { live = false; };
  }, [details.offer.id, categoryId]);

  const updateImages = (nextUrls: string[]) => {
    const available = [...imageObjects];
    const next = nextUrls.map((url, index) => {
      const found = available.findIndex((image) => imageUrl(image) === url);
      const image = found >= 0 ? available.splice(found, 1)[0] : { fileName: `image-${index + 1}`, fileUrl: url };
      return { ...image, fileUrl: url, priority: index + 1 };
    });
    set(["images"], next);
  };

  return <CommerceModal title={t(T.offer_edit_inpost)} onClose={onClose} wide>
    <div className="offer-editor-context">
      <div className="offer-editor-context-main"><strong>{details.offer.title}</strong><span>{details.offer.accountName}</span></div>
      {offerUrl ? <a className="offer-platform-link inpost" href={offerUrl} target="_blank" rel="noreferrer" title={t(T.offer_open_in_inpost)}>
        <img src="/logos/inpost.png" alt="InPost" />
        <span>{externalOfferId ? `ID ${externalOfferId}` : "InPost Merchant"}</span>
        <ExternalLink size={14} />
      </a> : externalOfferId ? <span className="offer-platform-link inpost">
        <img src="/logos/inpost.png" alt="InPost" />
        <span>ID {externalOfferId}</span>
      </span> : null}
      <StatusPill tone={details.offer.status === "ACTIVE" ? "good" : details.offer.status === "ERROR" ? "danger" : "neutral"}>{t({ ACTIVE: T.offer_status_active, READY: T.offer_status_ready, ENDED: T.offer_status_ended, ERROR: T.offer_status_error, DRAFT: T.offer_status_draft, PAUSED: T.offer_status_paused }[details.offer.status])}</StatusPill>
    </div>
    <div className="offer-editor-tabs" role="tablist">{tabs.map((item) => <button type="button" role="tab" aria-selected={tab === item.id} key={item.id} className={`commerce-seg-btn${tab === item.id ? " active" : ""}`} onClick={(event) => { setTab(item.id); (event.currentTarget.closest(".commerce-modal") as HTMLElement | null)?.scrollTo({ top: 0 }); }}>{t(item.label)}</button>)}</div>
    {details.offer.validationIssues.length > 0 && <div className="commerce-alert warn"><strong>{t(T.offer_validation_heading_inpost)}</strong>{details.offer.validationIssues.map((issue) => <span key={`${issue.code}-${issue.path}`}>{issue.code}{issue.path ? ` · ${issue.path}` : ""}</span>)}</div>}

    <div className="offer-editor-body">
      {tab === "PRODUCT" && <div className="commerce-form-grid">
        <Field label={t(T.offer_field_title)} span={2}><input className="input" value={text(product.name)} onChange={(event) => set(["product", "name"], event.target.value)} /></Field>
        <Field label={t(T.offer_field_sku)}><input className="input" value={text(product.sku)} onChange={(event) => set(["product", "sku"], event.target.value)} /></Field>
        <Field label={t(T.offer_field_ean)}><input className="input" inputMode="numeric" value={text(product.ean)} onChange={(event) => set(["product", "ean"], event.target.value)} /></Field>
        <Field label={t(T.offer_field_brand)}><input className="input" value={text(product.brand)} onChange={(event) => set(["product", "brand"], event.target.value)} /></Field>
        <Field label={t(T.offer_field_category)} span={2}><InpostCategoryPicker offerId={details.offer.id} value={categoryId} selected={currentCategory} onChange={(id) => set(["product", "categoryId"], id)} /></Field>
        <Field label={t(T.offer_inpost_model)}><input className="input" value={text(product.model)} onChange={(event) => set(["product", "model"], event.target.value)} /></Field>
        <Field label={t(T.offer_inpost_super_model)}><input className="input" value={text(product.superModel)} onChange={(event) => set(["product", "superModel"], event.target.value)} /></Field>
        <Field label={t(T.offer_inpost_mpn)}><input className="input" value={text(product.manufacturerProductNumber)} onChange={(event) => set(["product", "manufacturerProductNumber"], event.target.value)} /></Field>
        <Field label={t(T.offer_inpost_external_id)}><input className="input" value={text(payload.externalId)} disabled={Boolean(details.offer.externalOfferId)} onChange={(event) => set(["externalId"], event.target.value)} /></Field>
        <Field label={t(T.offer_field_description)} span={2}><RichDescriptionEditor value={text(product.description)} onChange={(value) => set(["product", "description"], value)} /></Field>
      </div>}

      {tab === "SALE" && <div className="commerce-form-grid">
        <Field label={t(T.offer_field_price)}><div className="offer-money"><input className="input" type="number" min="0" step="0.01" value={number(grossPrice.amount)} onChange={(event) => set(["price", "grossPrice", "amount"], Number(event.target.value))} /><input className="input" maxLength={3} value={text(grossPrice.currency) || "PLN"} onChange={(event) => set(["price", "grossPrice", "currency"], event.target.value.toUpperCase())} /></div></Field>
        <Field label={t(T.offer_field_tax)}><input className="input" value={text(taxRateInfo.taxRate) || text(taxRateInfo.rate)} onChange={(event) => set(["price", "taxRateInfo", "taxRate"], event.target.value)} /></Field>
        <Field label={t(T.offer_field_stock)}><input className="input" type="number" min="0" step="1" value={number(stock.quantity)} onChange={(event) => set(["stock", "quantity"], Number(event.target.value))} /></Field>
        <Field label={t(T.offer_stock_unit)}><select className="input" value={text(stock.unit) || "UNIT"} onChange={(event) => set(["stock", "unit"], event.target.value)}><option value="UNIT">{t(T.offer_unit_unit)}</option><option value="PAIR">{t(T.offer_unit_pair)}</option><option value="SET">{t(T.offer_unit_set)}</option><option value="OTHER">{t(T.offer_unit_other)}</option></select></Field>
        <Field label={t(T.offer_inpost_shipping_time)}><select className="input" value={shippingTime} onChange={(event) => set(["shippingTime"], event.target.value)}>{!SHIPPING_TIMES.includes(shippingTime) && <option value={shippingTime}>{shippingTime}</option>}{SHIPPING_TIMES.map((value) => <option key={value} value={value}>{shippingLabel(value)}</option>)}</select></Field>
        <Field label={t(T.offer_inpost_affiliation_url)}><input className="input" type="url" value={text(payload.affiliationProductUrl)} onChange={(event) => set(["affiliationProductUrl"], event.target.value)} /></Field>
      </div>}

      {tab === "MEDIA" && <div className="offer-editor-stack"><section><h3>{t(T.offer_images)}</h3><OfferImageGallery images={images} onChange={updateImages} onUpload={onUploadImage} onUploaded={(url, file) => set(["images"], [...imageObjects, { fileName: file.name, fileUrl: url, priority: imageObjects.length + 1 }])} /></section></div>}

      {tab === "GPSR" && <div className="commerce-form-grid">
        <label className="commerce-check offer-check-span"><input type="checkbox" checked={Boolean(gpsr.doesNotRequireGpsrInfo)} onChange={(event) => set(["gpsr", "doesNotRequireGpsrInfo"], event.target.checked)} />{t(T.offer_inpost_no_gpsr)}</label>
        <label className="commerce-check"><input type="checkbox" checked={Boolean(gpsr.ceMarking)} onChange={(event) => set(["gpsr", "ceMarking"], event.target.checked)} />{t(T.offer_inpost_ce_marking)}</label>
        <Field label={t(T.offer_inpost_batch_number)}><input className="input" value={text(gpsr.batchNumber)} onChange={(event) => set(["gpsr", "batchNumber"], event.target.value)} /></Field>
        <Field label={t(T.offer_inpost_manufacturer_name)}><input className="input" value={text(manufacturer.name)} onChange={(event) => set(["gpsr", "manufacturer", "name"], event.target.value)} /></Field>
        <Field label={t(T.offer_inpost_manufacturer_email)}><input className="input" type="email" value={text(manufacturer.email)} onChange={(event) => set(["gpsr", "manufacturer", "email"], event.target.value)} /></Field>
        <Field label={t(T.offer_inpost_manufacturer_phone)}><input className="input" type="tel" value={text(manufacturer.phone)} onChange={(event) => set(["gpsr", "manufacturer", "phone"], event.target.value)} /></Field>
        <Field label={t(T.offer_inpost_safety_info)} span={2}><textarea className="input commerce-textarea tall" value={text(gpsr.safetyInformation)} onChange={(event) => set(["gpsr", "safetyInformation"], event.target.value)} /></Field>
      </div>}
    </div>
    <footer className="commerce-modal-actions"><button type="button" className="btn btn-secondary" onClick={onClose}>{t(T.common_cancel)}</button><button type="button" className="btn btn-primary" disabled={busy || !canSave} onClick={() => onSubmit(payload)}>{busy ? t(T.common_please_wait) : t(T.common_save)}</button></footer>
  </CommerceModal>;
}
