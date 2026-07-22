// Edytor oferty Erli. Erli traktuje ofertę jako „produkt" — model jest płaski i
// prostszy niż Allegro (name, sku, ean, cena w groszach, stan, opis, zdjęcia).
// Świadomie używa TYCH SAMYCH komponentów co Allegro (edytor opisu z paskiem
// narzędzi i galeria zdjęć), żeby edytory obu platform wyglądały jednakowo.
// Różnice pod Erli: cena PLN↔grosze, zdjęcia to obiekty {url,internalUrl} (nie
// stringi). Erli NIE wspiera uploadu plików (API przyjmuje tylko URL) — nie
// udajemy tego, tylko pokazujemy info i „Edytuj w Erli". Zdjęcia po URL działają.
import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";

import { CommerceModal, Field } from "./CommerceUi";
import OfferImageGallery from "./OfferImageGallery";
import { DescriptionSectionsEditor, descriptionSectionsFrom, type Path } from "./OfferDescriptionEditor";
import type { JsonObject, OfferDetails } from "../lib/commerceApi";
import { T, useI18n } from "../lib/i18n";

type Props = {
  details: OfferDetails;
  busy: boolean;
  onClose: () => void;
  onSaveDraft: (payload: JsonObject) => void;
  onSubmit: (payload: JsonObject) => void;
};

// Publiczny adres oferty Erli: https://erli.pl/produkt/<slug>,<marketplaceId>
// (oba pola są w domyślnej odpowiedzi GET /products/{externalId}).
function erliOfferSlug(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .trim()
    .toLocaleLowerCase("pl-PL")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ł/g, "l")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function erliOfferUrl(payload: JsonObject, fallbackId?: string, fallbackTitle?: string): string {
  const slug = erliOfferSlug(payload.slug) || erliOfferSlug(fallbackTitle);
  const rawMarketplaceId = payload.marketplaceId ?? payload.externalId ?? fallbackId;
  const marketplaceId = typeof rawMarketplaceId === "number" ? rawMarketplaceId : Number(rawMarketplaceId);
  return slug && Number.isFinite(marketplaceId) && marketplaceId > 0
    ? `https://erli.pl/produkt/${encodeURI(slug)},${marketplaceId}`
    : "";
}

const object = (value: unknown): JsonObject => value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string => typeof value === "string" ? value : "";
const number = (value: unknown): number => typeof value === "number" ? value : Number(value || 0);

// Zdjęcie Erli: preferuj url (adres, który edytujemy), potem internalUrl (hostowane u Erli).
function erliImageSrc(value: unknown): string {
  if (typeof value === "string") return value;
  const image = object(value);
  return text(image.url) || text(image.internalUrl);
}

export default function ErliOfferEditor({ details, busy, onClose, onSaveDraft, onSubmit }: Props) {
  const { t } = useI18n();
  const [payload, setPayload] = useState<JsonObject>(() => structuredClone(details.editablePayload));

  // Erli nie zwraca slug/marketplaceId w każdej odpowiedzi. Wtedy korzystamy
  // z danych oferty z listy, żeby nagłówek nadal był klikalny jak w Allegro.
  const offerUrl = erliOfferUrl(payload, details.offer.externalOfferId, details.offer.title);
  const priceGrosze = number(payload.price);
  const images = array(payload.images).map(erliImageSrc).filter(Boolean);
  const descriptionSections = descriptionSectionsFrom(payload.description);

  const setField = (key: string, value: unknown) => setPayload((current) => ({ ...current, [key]: value }));

  // Zdjęcia edytujemy jako listę URL-i; przy zmianie odtwarzamy obiekty Erli, zachowując
  // znaczniki wariantu/lifestyle z oryginału (internalUrl doda Erli po pobraniu).
  const setImages = (urls: string[]) => setPayload((current) => {
    const bySource = new Map<string, JsonObject>();
    array(current.images).map(object).forEach((image) => {
      const source = text(image.url) || text(image.internalUrl);
      if (source) bySource.set(source, image);
    });
    const next = urls.map((url) => {
      const original = bySource.get(url);
      if (!original) return { url };
      const kept: JsonObject = { url: text(original.url) || url };
      if (typeof original.isVariantImage === "boolean") kept.isVariantImage = original.isVariantImage;
      if (typeof original.isLifestyleImage === "boolean") kept.isLifestyleImage = original.isLifestyleImage;
      return kept;
    });
    return { ...current, images: next };
  });

  // DescriptionSectionsEditor zapisuje wyłącznie ścieżkę ["description","sections"].
  const setDescription = (_path: Path, value: unknown) => setPayload((current) => ({ ...current, description: { sections: value } }));

  const canSave = useMemo(
    () => text(payload.name).trim().length > 0 && priceGrosze >= 0
      && Number.isInteger(number(payload.stock)) && number(payload.stock) >= 0,
    [payload.name, priceGrosze, payload.stock],
  );

  return (
    <CommerceModal title={t(T.offer_edit_erli)} onClose={onClose} wide>
      <div className="offer-editor-context">
        <div className="offer-editor-context-main"><strong>{details.offer.title}</strong><span>{details.offer.accountName}</span></div>
        {offerUrl ? <a className="offer-platform-link erli" href={offerUrl} target="_blank" rel="noreferrer" title={t(T.offer_open_in_erli)}>
          <img src="/logos/erli.png" alt="Erli" />
          <span>ID {details.offer.externalOfferId}</span>
          <ExternalLink size={14} />
        </a> : <span className="offer-platform-link erli">
          <img src="/logos/erli.png" alt="Erli" />
          <span>ID {details.offer.externalOfferId}</span>
        </span>}
      </div>

      <div className="offer-editor-body">
        <div className="commerce-form-grid">
          <Field label={t(T.offer_field_title)} span={2}>
            <input className="input" maxLength={150} value={text(payload.name)} onChange={(e) => setField("name", e.target.value)} />
          </Field>
          <Field label={t(T.offer_field_sku)}>
            <input className="input" maxLength={200} value={text(payload.sku)} onChange={(e) => setField("sku", e.target.value)} />
          </Field>
          <Field label={t(T.offer_field_ean)}>
            <input className="input" inputMode="numeric" value={text(payload.ean)} onChange={(e) => setField("ean", e.target.value)} />
          </Field>
          <Field label={t(T.offer_field_price)}>
            <div className="offer-money">
              <input className="input" type="number" min="0" step="0.01"
                value={(priceGrosze / 100).toFixed(2)}
                onChange={(e) => setField("price", Math.max(0, Math.round(Number(e.target.value) * 100)))} />
              <input className="input offer-currency-short" value="PLN" disabled />
            </div>
          </Field>
          <Field label={t(T.offer_field_stock)}>
            <input className="input" type="number" min="0" step="1" value={number(payload.stock)}
              onChange={(e) => setField("stock", Math.max(0, Math.trunc(Number(e.target.value))))} />
          </Field>
        </div>

        <div className="offer-editor-stack">
          <section>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <h3 style={{ margin: 0 }}>{t(T.offer_images)}</h3>
              {offerUrl && <a className="btn btn-secondary compact" href={offerUrl} target="_blank" rel="noreferrer" title={t(T.offer_edit_in_erli)}><ExternalLink size={14} />{t(T.offer_edit_in_erli)}</a>}
            </div>
            <p className="text-muted" style={{ fontSize: 12, margin: "6px 0 10px" }}>{t(T.offer_erli_images_note)}</p>
            <OfferImageGallery images={images} onChange={setImages} allowUpload={false} />
          </section>
          <DescriptionSectionsEditor sections={descriptionSections} images={images} set={setDescription} />
        </div>
      </div>

      <footer className="commerce-modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose}>{t(T.common_cancel)}</button>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => onSaveDraft(payload)}>
          {busy ? t(T.common_please_wait) : t(T.offer_save_draft)}
        </button>
        <button type="button" className="btn btn-primary" disabled={busy || !canSave} onClick={() => onSubmit(payload)}>
          {busy ? t(T.common_please_wait) : t(T.offer_save_to_erli)}
        </button>
      </footer>
    </CommerceModal>
  );
}
