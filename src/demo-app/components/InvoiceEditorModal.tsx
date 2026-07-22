import { useEffect, useMemo, useState } from "react";
import { Plus, X } from "lucide-react";

import { CommerceModal, Field } from "./CommerceUi";
import InvoicePdfFrame from "./InvoicePdfFrame";
import { listInvoiceSellerProfiles, type Invoice, type InvoiceItem, type InvoiceSellerProfile, type SaveInvoice } from "../lib/commerceApi";
import { formatMoney } from "../lib/commerceFormat";
import { T, useI18n } from "../lib/i18n";

const date = (daysFromToday = 0) => new Date(Date.now() + daysFromToday * 86400000).toISOString().slice(0, 10);

export const emptyInvoiceItem = (): InvoiceItem => ({
  name: "", sku: "", quantity: 1, unit: "szt.", unitNet: 0, taxRate: "23",
  ean: "", pkwiu: "", cn: "", pkob: "", gtu: "", discount: undefined,
});

type SellerProfile = Pick<SaveInvoice,
  "sellerName" | "sellerTaxId" | "sellerAddress" | "sellerStreet" | "sellerPostCode" |
  "sellerCity" | "sellerEmail" | "sellerPhone" | "sellerCountry"
>;

export function invoiceSellerProfile(): Partial<SellerProfile> {
  try { return JSON.parse(localStorage.getItem("invoiceSeller") ?? "{}"); } catch { return {}; }
}

export function rememberInvoiceSeller(invoice: SaveInvoice) {
  const profile: SellerProfile = {
    sellerName: invoice.sellerName,
    sellerTaxId: invoice.sellerTaxId,
    sellerAddress: invoice.sellerAddress,
    sellerStreet: invoice.sellerStreet,
    sellerPostCode: invoice.sellerPostCode,
    sellerCity: invoice.sellerCity,
    sellerEmail: invoice.sellerEmail,
    sellerPhone: invoice.sellerPhone,
    sellerCountry: invoice.sellerCountry,
  };
  localStorage.setItem("invoiceSeller", JSON.stringify(profile));
}

export function applyInvoiceSeller(invoice: SaveInvoice): SaveInvoice {
  const seller = invoiceSellerProfile();
  return {
    ...invoice,
    sellerName: invoice.sellerName || seller.sellerName || "",
    sellerTaxId: invoice.sellerTaxId || seller.sellerTaxId || "",
    sellerAddress: invoice.sellerAddress || seller.sellerAddress || "",
    sellerStreet: invoice.sellerStreet || seller.sellerStreet || "",
    sellerPostCode: invoice.sellerPostCode || seller.sellerPostCode || "",
    sellerCity: invoice.sellerCity || seller.sellerCity || "",
    sellerEmail: invoice.sellerEmail || seller.sellerEmail || "",
    sellerPhone: invoice.sellerPhone || seller.sellerPhone || "",
    sellerCountry: invoice.sellerCountry || seller.sellerCountry || "PL",
  };
}

export function blankInvoice(): SaveInvoice {
  return applyInvoiceSeller({
    documentType: "INVOICE", invoiceKind: "VAT", sellerProfileId: undefined,
    issueDate: date(), issuePlace: "", saleDate: date(), periodFrom: undefined, periodTo: undefined, dueDate: date(14),
    sellerName: "", sellerTaxId: "", sellerAddress: "", sellerStreet: "", sellerPostCode: "",
    sellerCity: "", sellerEmail: "", sellerPhone: "", sellerCountry: "PL",
    buyerName: "", buyerTaxId: "", buyerAddress: "", buyerStreet: "", buyerPostCode: "",
    buyerCity: "", buyerEmail: "", buyerPhone: "", buyerCompany: false, buyerTaxNoKind: "NIP",
    buyerCountry: "PL", currency: "PLN", currencyRate: undefined, currencyRateDate: undefined,
    paymentMethod: "TRANSFER", paymentState: "UNPAID",
    paymentDate: undefined, bankAccount: "", bankSwift: "", splitPayment: false,
    cashAccounting: false, selfBilling: false, reverseCharge: false, marginScheme: undefined,
    correctionEffect: undefined, fa3PayloadJson: "{}", ksefOfflineMode: false, taxTreatment: "DOMESTIC",
    exemptTaxKind: "", npTaxKind: "", notes: "", items: [emptyInvoiceItem()],
  });
}

export function editInvoiceInput(invoice: Invoice): SaveInvoice {
  return {
    id: invoice.id, expectedRevision: invoice.revision, documentType: invoice.documentType,
    invoiceKind: invoice.invoiceKind, sellerProfileId: invoice.sellerProfileId,
    orderDbId: invoice.orderDbId, externalOrderId: invoice.externalOrderId,
    correctedInvoiceId: invoice.correctedInvoiceId, correctionReason: invoice.correctionReason,
    issueDate: invoice.issueDate, issuePlace: invoice.issuePlace, saleDate: invoice.saleDate,
    periodFrom: invoice.periodFrom, periodTo: invoice.periodTo, dueDate: invoice.dueDate,
    sellerName: invoice.sellerName, sellerTaxId: invoice.sellerTaxId, sellerAddress: invoice.sellerAddress,
    sellerStreet: invoice.sellerStreet, sellerPostCode: invoice.sellerPostCode, sellerCity: invoice.sellerCity,
    sellerEmail: invoice.sellerEmail, sellerPhone: invoice.sellerPhone, sellerCountry: invoice.sellerCountry,
    buyerName: invoice.buyerName, buyerTaxId: invoice.buyerTaxId, buyerAddress: invoice.buyerAddress,
    buyerStreet: invoice.buyerStreet, buyerPostCode: invoice.buyerPostCode, buyerCity: invoice.buyerCity,
    buyerEmail: invoice.buyerEmail, buyerPhone: invoice.buyerPhone, buyerCompany: invoice.buyerCompany,
    buyerTaxNoKind: invoice.buyerTaxNoKind, buyerCountry: invoice.buyerCountry, currency: invoice.currency,
    currencyRate: invoice.currencyRate, currencyRateDate: invoice.currencyRateDate,
    paymentMethod: invoice.paymentMethod, paymentState: invoice.paymentState, paymentDate: invoice.paymentDate,
    bankAccount: invoice.bankAccount, bankSwift: invoice.bankSwift, splitPayment: invoice.splitPayment,
    cashAccounting: invoice.cashAccounting, selfBilling: invoice.selfBilling, reverseCharge: invoice.reverseCharge,
    marginScheme: invoice.marginScheme, correctionEffect: invoice.correctionEffect,
    fa3PayloadJson: invoice.fa3PayloadJson, ksefOfflineMode: false, taxTreatment: invoice.taxTreatment,
    exemptTaxKind: invoice.exemptTaxKind, npTaxKind: invoice.npTaxKind, notes: invoice.notes,
    items: invoice.items.map((item) => ({
      name: item.name, sku: item.sku, quantity: item.quantity, unit: item.unit,
      unitNet: item.unitNet, taxRate: item.taxRate, ean: item.ean, pkwiu: item.pkwiu,
      cn: item.cn, pkob: item.pkob, gtu: item.gtu, discount: item.discount,
    })),
  };
}

type Props = {
  value: SaveInvoice;
  title: string;
  submitLabel: string;
  busy?: boolean;
  onChange: (value: SaveInvoice) => void;
  onClose: () => void;
  onSubmit: () => void;
};

function address(street?: string, postCode?: string, city?: string) {
  return [street?.trim(), [postCode?.trim(), city?.trim()].filter(Boolean).join(" ")]
    .filter(Boolean).join(", ");
}

export default function InvoiceEditorModal({ value, title, submitLabel, busy, onChange, onClose, onSubmit }: Props) {
  const { t, lang } = useI18n();
  const [profiles, setProfiles] = useState<InvoiceSellerProfile[]>([]);
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const locale = lang === "pl" ? "pl-PL" : "en-GB";
  const set = <K extends keyof SaveInvoice>(key: K, next: SaveInvoice[K]) => onChange({ ...value, [key]: next });
  const applyProfile = (profile: InvoiceSellerProfile) => onChange({
    ...value,
    sellerProfileId: profile.id,
    sellerName: profile.legalName,
    sellerTaxId: profile.nip,
    sellerAddress: address(profile.street, profile.postCode, profile.city),
    sellerStreet: profile.street,
    sellerPostCode: profile.postCode,
    sellerCity: profile.city,
    sellerEmail: profile.email,
    sellerPhone: profile.phone,
    sellerCountry: profile.country,
    issuePlace: profile.issuePlace,
    bankAccount: profile.bankAccount,
    bankSwift: profile.bankSwift,
  });
  useEffect(() => {
    let active = true;
    void listInvoiceSellerProfiles().then((loaded) => {
      if (!active) return;
      setProfiles(loaded);
      if (!value.sellerProfileId && !value.id) {
        const selected = loaded.find((profile) => profile.active);
        if (selected) applyProfile(selected);
      }
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  const setSellerAddress = (next: Partial<Pick<SaveInvoice, "sellerStreet" | "sellerPostCode" | "sellerCity">>) => {
    const updated = { ...value, ...next };
    updated.sellerAddress = address(updated.sellerStreet, updated.sellerPostCode, updated.sellerCity);
    onChange(updated);
  };
  const setBuyerAddress = (next: Partial<Pick<SaveInvoice, "buyerStreet" | "buyerPostCode" | "buyerCity">>) => {
    const updated = { ...value, ...next };
    updated.buyerAddress = address(updated.buyerStreet, updated.buyerPostCode, updated.buyerCity);
    onChange(updated);
  };
  const setItem = (index: number, item: InvoiceItem) => {
    const items = [...value.items];
    items[index] = item;
    set("items", items);
  };
  const totals = useMemo(() => value.items.reduce((sum, item) => {
    const net = item.quantity * item.unitNet - (item.discount ?? 0);
    const tax = net * (Number(item.taxRate) || 0) / 100;
    return { net: sum.net + net, tax: sum.tax + tax, gross: sum.gross + net + tax };
  }, { net: 0, tax: 0, gross: 0 }), [value.items]);
  const canSubmit = Boolean(
    value.sellerProfileId && value.issueDate && value.saleDate && value.sellerName.trim() && value.sellerTaxId?.trim()
    && value.sellerStreet?.trim() && value.sellerPostCode?.trim() && value.sellerCity?.trim()
    && /^[A-Z]{2}$/.test(value.sellerCountry) && value.buyerName.trim()
    && value.buyerStreet?.trim() && value.buyerPostCode?.trim() && value.buyerCity?.trim()
    && /^[A-Z]{2}$/.test(value.buyerCountry) && /^[A-Z]{3}$/.test(value.currency)
    && (value.currency === "PLN" || (Boolean(value.currencyRateDate) && Number(value.currencyRate) > 0))
    && (!value.buyerCompany || value.buyerTaxId?.trim())
    && (!value.items.some((item) => item.taxRate === "ZW") || value.exemptTaxKind?.trim())
    && (!value.items.some((item) => item.taxRate === "NP") || value.npTaxKind?.trim())
    && (value.documentType !== "CORRECTION" || value.correctionReason?.trim())
    && (Boolean(value.periodFrom) === Boolean(value.periodTo))
    && (value.paymentState !== "PAID" || value.paymentDate)
    && value.items.length > 0 && value.items.every((item) => item.name.trim() && item.unit.trim()
      && Number.isFinite(item.quantity) && item.quantity !== 0
      && (value.documentType === "CORRECTION" || item.quantity > 0)
      && Number.isFinite(item.unitNet) && item.unitNet >= 0)
  );
  const money = (amount: number) => formatMoney(locale, amount, value.currency);

  return <CommerceModal title={title} onClose={onClose} wide>
    <div className="invoice-editor-tabs seg" role="tablist" aria-label="Widok faktury">
      <button type="button" className={`commerce-seg-btn${tab === "edit" ? " active" : ""}`} onClick={() => setTab("edit")} role="tab" aria-selected={tab === "edit"}>Edycja</button>
      <button type="button" className={`commerce-seg-btn${tab === "preview" ? " active" : ""}`} onClick={() => setTab("preview")} role="tab" aria-selected={tab === "preview"}>Podglad PDF</button>
    </div>
    {tab === "preview" ? <InvoicePdfFrame invoice={value} /> : <div className="commerce-form-grid">
      <div className="commerce-form-section">{t(T.invoice_section_document)}</div>
      <Field label={t(T.invoice_seller_profile)}><select className="input" value={value.sellerProfileId ?? ""} onChange={(event) => {
        const profile = profiles.find((item) => item.id === event.target.value);
        if (profile) applyProfile(profile);
      }}><option value="">—</option>{profiles.map((profile) => <option value={profile.id} key={profile.id}>{profile.displayName} · {profile.nip}</option>)}</select></Field>
      <Field label={t(T.invoice_field_kind)}><select className="input" value={value.invoiceKind} disabled={value.documentType === "CORRECTION"} onChange={(event) => set("invoiceKind", event.target.value as SaveInvoice["invoiceKind"])}><option value="VAT">VAT</option><option value="UPR">UPR</option></select></Field>
      <Field label={t(T.invoice_field_issue_date)}><input className="input" type="date" value={value.issueDate} onChange={(e) => set("issueDate", e.target.value)} /></Field>
      <Field label={t(T.invoice_field_issue_place)}><input className="input" value={value.issuePlace ?? ""} onChange={(e) => set("issuePlace", e.target.value)} /></Field>
      <Field label={t(T.invoice_field_sale_date)}><input className="input" type="date" value={value.saleDate} onChange={(e) => set("saleDate", e.target.value)} /></Field>
      <Field label={t(T.invoice_field_due_date)}><input className="input" type="date" value={value.dueDate ?? ""} onChange={(e) => set("dueDate", e.target.value)} /></Field>
      <Field label={t(T.invoice_field_period_from)}><input className="input" type="date" value={value.periodFrom ?? ""} onChange={(e) => set("periodFrom", e.target.value || undefined)} /></Field>
      <Field label={t(T.invoice_field_period_to)}><input className="input" type="date" value={value.periodTo ?? ""} onChange={(e) => set("periodTo", e.target.value || undefined)} /></Field>
      <Field label={t(T.invoice_field_order)}><input className="input" value={value.externalOrderId ?? ""} onChange={(e) => set("externalOrderId", e.target.value)} /></Field>
      <Field label={t(T.invoice_field_payment)}><select className="input" value={value.paymentMethod} onChange={(e) => set("paymentMethod", e.target.value)}><option value="TRANSFER">{t(T.invoice_payment_transfer)}</option><option value="CARD">{t(T.invoice_payment_card)}</option><option value="CASH">{t(T.invoice_payment_cash)}</option><option value="MARKETPLACE">{t(T.invoice_payment_marketplace)}</option></select></Field>
      <Field label={t(T.invoice_field_payment_state)}><select className="input" value={value.paymentState} onChange={(e) => set("paymentState", e.target.value as SaveInvoice["paymentState"])}><option value="UNPAID">UNPAID</option><option value="PARTIAL">PARTIAL</option><option value="PAID">PAID</option></select></Field>
      {value.paymentState === "PAID" && <Field label={t(T.invoice_field_payment_date)}><input className="input" type="date" value={value.paymentDate ?? ""} onChange={(e) => set("paymentDate", e.target.value || undefined)} /></Field>}
      <Field label={t(T.invoice_field_tax_treatment)}><select className="input" value={value.taxTreatment} onChange={(e) => set("taxTreatment", e.target.value as SaveInvoice["taxTreatment"])}><option value="DOMESTIC">{t(T.invoice_tax_domestic)}</option><option value="EU_B2B">{t(T.invoice_tax_eu_b2b)}</option><option value="OSS">{t(T.invoice_tax_oss)}</option><option value="EXPORT">{t(T.invoice_tax_export)}</option><option value="EXEMPT">{t(T.invoice_tax_exempt)}</option></select></Field>
      <Field label={t(T.invoice_field_currency)}><select className="input" value={value.currency} onChange={(event) => onChange({ ...value, currency: event.target.value, ...(event.target.value === "PLN" ? { currencyRate: undefined, currencyRateDate: undefined } : {}) })}><option>PLN</option><option>EUR</option><option>USD</option><option>GBP</option><option>CZK</option></select></Field>
      {value.currency !== "PLN" && <><Field label={t(T.invoice_field_currency_rate)}><input className="input" type="number" min="0.000001" step="0.000001" value={value.currencyRate ?? ""} onChange={(event) => set("currencyRate", event.target.value ? Number(event.target.value) : undefined)} /></Field><Field label={t(T.invoice_field_currency_rate_date)}><input className="input" type="date" value={value.currencyRateDate ?? ""} onChange={(event) => set("currencyRateDate", event.target.value || undefined)} /></Field></>}
      {value.items.some((item) => item.taxRate === "ZW") && <Field label={t(T.invoice_field_exempt_basis)} span={2}><input className="input" value={value.exemptTaxKind ?? ""} onChange={(e) => set("exemptTaxKind", e.target.value)} /></Field>}
      {value.items.some((item) => item.taxRate === "NP") && <Field label={t(T.invoice_field_np_basis)} span={2}><input className="input" value={value.npTaxKind ?? ""} onChange={(e) => set("npTaxKind", e.target.value)} /></Field>}
      {value.documentType === "CORRECTION" && <Field label={t(T.invoice_correction_prompt)} span={2}><textarea className="input commerce-textarea" value={value.correctionReason ?? ""} onChange={(e) => set("correctionReason", e.target.value)} /></Field>}

      <div className="commerce-form-section">{t(T.invoice_section_tax_flags)}</div>
      <Field label={t(T.invoice_field_bank_account)}><input className="input" value={value.bankAccount ?? ""} onChange={(e) => set("bankAccount", e.target.value)} /></Field>
      <Field label={t(T.invoice_field_bank_swift)}><input className="input" value={value.bankSwift ?? ""} onChange={(e) => set("bankSwift", e.target.value.toUpperCase())} /></Field>
      <div className="invoice-flags" style={{ gridColumn: "1 / -1" }}>
        {([["splitPayment", T.invoice_flag_split_payment], ["cashAccounting", T.invoice_flag_cash_accounting], ["selfBilling", T.invoice_flag_self_billing], ["reverseCharge", T.invoice_flag_reverse_charge]] as const).map(([key, label]) => <label className="commerce-check" key={key}><input type="checkbox" checked={Boolean(value[key])} onChange={(event) => set(key, event.target.checked)} />{t(label)}</label>)}
      </div>

      <div className="commerce-form-section">{t(T.invoice_section_seller)}</div>
      <Field label={t(T.invoice_field_name)}><input className="input" value={value.sellerName} onChange={(e) => set("sellerName", e.target.value)} /></Field>
      <Field label={t(T.invoice_field_tax_id)}><input className="input" value={value.sellerTaxId ?? ""} onChange={(e) => set("sellerTaxId", e.target.value)} /></Field>
      <Field label={t(T.invoice_field_street)} span={2}><input className="input" value={value.sellerStreet ?? ""} onChange={(e) => setSellerAddress({ sellerStreet: e.target.value })} /></Field>
      <Field label={t(T.invoice_field_post_code)}><input className="input" value={value.sellerPostCode ?? ""} onChange={(e) => setSellerAddress({ sellerPostCode: e.target.value })} /></Field>
      <Field label={t(T.invoice_field_city)}><input className="input" value={value.sellerCity ?? ""} onChange={(e) => setSellerAddress({ sellerCity: e.target.value })} /></Field>
      <Field label={t(T.invoice_field_email)}><input className="input" type="email" value={value.sellerEmail ?? ""} onChange={(e) => set("sellerEmail", e.target.value)} /></Field>
      <Field label={t(T.invoice_field_phone)}><input className="input" value={value.sellerPhone ?? ""} onChange={(e) => set("sellerPhone", e.target.value)} /></Field>
      <Field label={t(T.invoice_field_country)}><input className="input" maxLength={2} value={value.sellerCountry} onChange={(e) => set("sellerCountry", e.target.value.toUpperCase())} /></Field>

      <div className="commerce-form-section">{t(T.invoice_section_buyer)}</div>
      <Field label={t(T.invoice_field_name)}><input className="input" value={value.buyerName} onChange={(e) => set("buyerName", e.target.value)} /></Field>
      <Field label={t(T.invoice_field_tax_id)}><input className="input" value={value.buyerTaxId ?? ""} onChange={(e) => set("buyerTaxId", e.target.value)} /></Field>
      <Field label={t(T.invoice_field_street)} span={2}><input className="input" value={value.buyerStreet ?? ""} onChange={(e) => setBuyerAddress({ buyerStreet: e.target.value })} /></Field>
      <Field label={t(T.invoice_field_post_code)}><input className="input" value={value.buyerPostCode ?? ""} onChange={(e) => setBuyerAddress({ buyerPostCode: e.target.value })} /></Field>
      <Field label={t(T.invoice_field_city)}><input className="input" value={value.buyerCity ?? ""} onChange={(e) => setBuyerAddress({ buyerCity: e.target.value })} /></Field>
      <Field label={t(T.invoice_field_email)}><input className="input" type="email" value={value.buyerEmail ?? ""} onChange={(e) => set("buyerEmail", e.target.value)} /></Field>
      <Field label={t(T.invoice_field_phone)}><input className="input" value={value.buyerPhone ?? ""} onChange={(e) => set("buyerPhone", e.target.value)} /></Field>
      <Field label={t(T.invoice_field_country)}><input className="input" maxLength={2} value={value.buyerCountry} onChange={(e) => set("buyerCountry", e.target.value.toUpperCase())} /></Field>
      <Field label={t(T.invoice_field_company)}><label className="commerce-check"><input type="checkbox" checked={value.buyerCompany} onChange={(e) => set("buyerCompany", e.target.checked)} />{t(T.invoice_field_company)}</label></Field>

      <div className="commerce-form-section row"><span>{t(T.invoice_section_items)}</span><button type="button" className="btn btn-secondary" onClick={() => set("items", [...value.items, emptyInvoiceItem()])}><Plus size={14} />{t(T.invoice_add_item)}</button></div>
      <div className="invoice-items" style={{ gridColumn: "1 / -1" }}>{value.items.map((item, index) => <div className="invoice-item-card" key={index}><div className="invoice-item-row">
          <input className="input" placeholder={t(T.invoice_item_name)} value={item.name} onChange={(e) => setItem(index, { ...item, name: e.target.value })} />
          <input className="input" placeholder="SKU" value={item.sku ?? ""} onChange={(e) => setItem(index, { ...item, sku: e.target.value })} />
          <input className="input" aria-label={t(T.invoice_item_qty)} type="number" step="0.01" value={item.quantity} onChange={(e) => setItem(index, { ...item, quantity: Number(e.target.value) })} />
          <input className="input" aria-label={t(T.invoice_item_unit)} value={item.unit} onChange={(e) => setItem(index, { ...item, unit: e.target.value })} />
          <input className="input" aria-label={t(T.invoice_item_price)} type="number" min="0" step="0.01" value={item.unitNet} onChange={(e) => setItem(index, { ...item, unitNet: Number(e.target.value) })} />
          <select className="input" aria-label={t(T.invoice_item_tax)} value={item.taxRate} onChange={(e) => setItem(index, { ...item, taxRate: e.target.value })}><option>23</option><option>22</option><option>8</option><option>7</option><option>5</option><option>4</option><option>3</option><option>0</option><option>ZW</option><option>NP</option></select>
          <button type="button" className="btn btn-ghost btn-icon" title={t(T.common_delete)} disabled={value.items.length === 1} onClick={() => set("items", value.items.filter((_, itemIndex) => itemIndex !== index))}><X size={15} /></button>
        </div><details className="invoice-item-codes"><summary>{t(T.invoice_item_codes)}</summary><div>
          <input className="input" placeholder="EAN / GTIN" value={item.ean ?? ""} onChange={(e) => setItem(index, { ...item, ean: e.target.value })} />
          <input className="input" placeholder="PKWiU" value={item.pkwiu ?? ""} onChange={(e) => setItem(index, { ...item, pkwiu: e.target.value })} />
          <input className="input" placeholder="CN" value={item.cn ?? ""} onChange={(e) => setItem(index, { ...item, cn: e.target.value })} />
          <input className="input" placeholder="PKOB" value={item.pkob ?? ""} onChange={(e) => setItem(index, { ...item, pkob: e.target.value })} />
          <input className="input" placeholder="GTU_01…GTU_13" value={item.gtu ?? ""} onChange={(e) => setItem(index, { ...item, gtu: e.target.value.toUpperCase() })} />
          <input className="input" placeholder="Rabat" type="number" min="0" step="0.01" value={item.discount ?? ""} onChange={(e) => setItem(index, { ...item, discount: e.target.value === "" ? undefined : Number(e.target.value) })} />
        </div></details></div>)}</div>
      <div className="invoice-totals"><span>{t(T.invoice_total_net)} <strong>{money(totals.net)}</strong></span><span>{t(T.invoice_total_tax)} <strong>{money(totals.tax)}</strong></span><span>{t(T.invoice_total_gross)} <strong>{money(totals.gross)}</strong></span></div>
      <Field label={t(T.invoice_field_notes)} span={2}><textarea className="input commerce-textarea" value={value.notes ?? ""} onChange={(e) => set("notes", e.target.value)} /></Field>
    </div>}
    <footer className="commerce-modal-actions"><button type="button" className="btn btn-secondary" onClick={onClose}>{t(T.common_cancel)}</button><button type="button" className="btn btn-primary" disabled={busy || !canSubmit} onClick={onSubmit}>{busy ? t(T.common_please_wait) : submitLabel}</button></footer>
  </CommerceModal>;
}
