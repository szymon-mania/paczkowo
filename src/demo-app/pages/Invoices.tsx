import { invoke } from "../lib/serverStatus";
import { useEffect, useMemo, useState } from "react";
import { CircleDollarSign, Download, ExternalLink, Eye, FilePenLine, Plus, Printer, RefreshCw, Search, Send, Settings2, ShieldCheck, Trash2 } from "lucide-react";

import InvoiceEditorModal, { blankInvoice, editInvoiceInput } from "../components/InvoiceEditorModal";
import InvoicePdfFrame from "../components/InvoicePdfFrame";
import InvoiceSettingsModal from "../components/InvoiceSettingsModal";
import { CommerceHeader, CommerceModal, CommercePage, EmptyTable, Field, KpiStrip, StatusPill } from "../components/CommerceUi";
import {
  archiveKsefUpo, createInvoiceCorrection, deleteInvoiceDraft, getInvoiceFa3Xml, issueInvoice,
  listInvoiceSellerProfiles, listInvoices, listKsefSubmissions, markInvoicePaid, queueInvoiceToKsef,
  refreshInvoiceProviderStatus, recoverInvoiceProviderIssue, saveInvoice,
  type Invoice, type InvoiceSellerProfile, type InvoiceStatus, type SaveInvoice,
} from "../lib/commerceApi";
import { formatCurrencyTotals, formatMoney } from "../lib/commerceFormat";
import { downloadInvoicePdf, printInvoicePdf } from "../lib/invoicePdf";
import { T, translateMessage, useI18n } from "../lib/i18n";

export default function Invoices({ onOpenIntegrations: _onOpenIntegrations, defaultPrinter }: { onOpenIntegrations: () => void; defaultPrinter: string }) {
  const { t, lang } = useI18n();
  const locale = lang === "pl" ? "pl-PL" : "en-GB";
  const [rows, setRows] = useState<Invoice[]>([]);
  const [profiles, setProfiles] = useState<InvoiceSellerProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<InvoiceStatus | "ALL">("ALL");
  const [editing, setEditing] = useState<SaveInvoice | null>(null);
  const [preview, setPreview] = useState<Invoice | null>(null);
  const [correcting, setCorrecting] = useState<Invoice | null>(null);
  const [correctionReason, setCorrectionReason] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleting, setDeleting] = useState<Invoice | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [invoices, sellerProfiles] = await Promise.all([listInvoices(), listInvoiceSellerProfiles()]);
      setRows(invoices);
      setProfiles(sellerProfiles);
    } catch (value) { setError(translateMessage(value, t)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((invoice) => (status === "ALL" || invoice.status === status)
      && (!q || `${invoice.invoiceNumber ?? ""} ${invoice.buyerName} ${invoice.buyerTaxId ?? ""} ${invoice.externalOrderId ?? ""}`.toLowerCase().includes(q)));
  }, [rows, search, status]);
  const issuedRows = rows.filter((row) => !["DRAFT", "CANCELLED"].includes(row.status));
  const unpaidRows = rows.filter((row) => row.status === "ISSUED" && row.grossTotal > row.paidAmount);
  const issuedValue = formatCurrencyTotals(issuedRows, locale, (row) => row.grossTotal, (row) => row.currency);
  const unpaid = formatCurrencyTotals(unpaidRows, locale, (row) => Math.max(0, row.grossTotal - row.paidAmount), (row) => row.currency);
  const ksefQueue = rows.filter((row) => row.status !== "DRAFT" && ["NOT_SENT", "PENDING", "REJECTED", "OFFLINE"].includes(row.ksefStatus)).length;
  const activeProfile = profiles.find((profile) => profile.active);

  const money = (value: number, currency = "PLN") => formatMoney(locale, value, currency);
  const statusLabel = (value: InvoiceStatus) => t({ DRAFT: T.invoice_status_draft, ISSUED: T.invoice_status_issued, PAID: T.invoice_status_paid, CANCELLED: T.invoice_status_cancelled }[value]);
  const ksefLabel = (value: Invoice["ksefStatus"]) => t({ NOT_SENT: T.invoice_ksef_not_sent, PENDING: T.invoice_ksef_pending, ACCEPTED: T.invoice_ksef_accepted, REJECTED: T.invoice_ksef_rejected, OFFLINE: T.invoice_ksef_offline, NOT_REQUIRED: T.invoice_ksef_not_required }[value]);

  const act = async (action: () => Promise<unknown>) => {
    setBusy(true); setError("");
    try { await action(); } catch (value) { setError(translateMessage(value, t)); }
    finally { await load(); setBusy(false); }
  };
  const submit = async () => {
    if (!editing) return;
    setBusy(true); setError("");
    try { await saveInvoice(editing); setEditing(null); await load(); }
    catch (value) { setError(translateMessage(value, t)); }
    finally { setBusy(false); }
  };
  const correction = async () => {
    if (!correcting || !correctionReason.trim()) return;
    setBusy(true); setError("");
    try {
      const id = await createInvoiceCorrection(correcting.id, correctionReason.trim());
      const all = await listInvoices();
      setRows(all); setCorrecting(null); setCorrectionReason("");
      const draft = all.find((row) => row.id === id);
      if (draft) setEditing(editInvoiceInput(draft));
    } catch (value) { setError(translateMessage(value, t)); }
    finally { setBusy(false); }
  };
  const refreshQueue = () => act(async () => { await listKsefSubmissions(); });
  const downloadPdf = async (invoice: Invoice) => downloadInvoicePdf(invoice);
  const printPdf = async (invoice: Invoice) => printInvoicePdf(invoice, defaultPrinter);
  const downloadXml = async (invoice: Invoice) => {
    const xml = await getInvoiceFa3Xml(invoice.id);
    const url = URL.createObjectURL(new Blob([xml], { type: "application/xml;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${(invoice.invoiceNumber ?? `faktura-${invoice.id}`).replace(/[^a-zA-Z0-9._-]+/g, "-")}.xml`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const openUrl = (url?: string) => url && invoke("open_url", { url });

  return <CommercePage>
    <CommerceHeader title={t(T.nav_invoices)} subtitle={t(T.invoice_subtitle)} action={<><button type="button" className="btn btn-secondary" onClick={() => setSettingsOpen(true)}><Settings2 size={15} />{t(T.invoice_settings)}</button><button type="button" className="btn btn-primary" disabled={!activeProfile} onClick={() => setEditing(blankInvoice())}><Plus size={15} />{t(T.invoice_add)}</button></>} />
    <KpiStrip items={[
      { label: t(T.invoice_kpi_documents), value: rows.length },
      { label: t(T.invoice_kpi_sales), value: issuedValue, tone: "good" },
      { label: t(T.invoice_kpi_unpaid), value: unpaid, tone: unpaidRows.length ? "warn" : "default" },
      { label: t(T.invoice_kpi_ksef), value: ksefQueue, tone: ksefQueue ? "danger" : "good" },
    ]} />
    <section className="invoice-provider-bar">
      <div>
        <ShieldCheck size={17} />
        <span><strong>{t(T.invoice_local_module)}</strong><small className="commerce-subline">{t(T.invoice_local_module_detail)}</small></span>
        {activeProfile && <StatusPill tone={activeProfile.ksefConnectionStatus === "VERIFIED" ? "good" : "warn"}>{activeProfile.displayName} · KSeF {activeProfile.ksefConnectionStatus}</StatusPill>}
      </div>
      <div className="invoice-provider-controls">
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={refreshQueue}><RefreshCw size={14} />{t(T.invoice_refresh_queue)}</button>
      </div>
    </section>
    {profiles.length === 0 && <div className="commerce-alert warn invoice-provider-missing"><span>{t(T.invoice_seller_profile)}</span><button type="button" className="btn btn-secondary" onClick={() => setSettingsOpen(true)}>{t(T.invoice_profile_add)}</button></div>}
    {error && <div className="commerce-alert danger">{error}</div>}
    <section className="commerce-toolbar">
      <div className="commerce-search"><Search size={15} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t(T.invoice_search)} /></div>
      <div className="seg">{(["ALL", "DRAFT", "ISSUED", "PAID"] as const).map((value) => <button type="button" key={value} className={`commerce-seg-btn${status === value ? " active" : ""}`} onClick={() => setStatus(value)}>{value === "ALL" ? t(T.common_all) : statusLabel(value)}</button>)}</div>
    </section>
    <section className="commerce-table-wrap">
      {loading ? <div className="commerce-loading">{t(T.common_loading)}</div> : filtered.length === 0 ? <EmptyTable title={t(T.invoice_empty)} detail={t(T.invoice_empty_detail)} /> : <table className="table commerce-table">
        <thead><tr><th>{t(T.invoice_col_number)}</th><th>{t(T.invoice_col_buyer)}</th><th>{t(T.invoice_col_status)}</th><th>{t(T.invoice_col_ksef)}</th><th>{t(T.invoice_provider_status)}</th><th>{t(T.invoice_col_date)}</th><th>{t(T.invoice_col_amount)}</th><th /></tr></thead>
        <tbody>{filtered.map((invoice) => <tr key={invoice.id}>
          <td><strong>{invoice.invoiceNumber ?? t(T.invoice_draft_number)}</strong><span className="commerce-subline">{invoice.documentType === "CORRECTION" ? t(T.invoice_type_correction) : t(T.invoice_type_sales)}</span></td>
          <td><strong>{invoice.buyerName}</strong><span className="commerce-subline">{invoice.buyerTaxId ?? invoice.externalOrderId ?? "-"}</span></td>
          <td><StatusPill tone={invoice.status === "PAID" ? "good" : invoice.status === "ISSUED" ? "accent" : "neutral"}>{statusLabel(invoice.status)}</StatusPill></td>
          <td><StatusPill tone={invoice.ksefStatus === "ACCEPTED" ? "good" : invoice.ksefStatus === "REJECTED" ? "danger" : invoice.ksefStatus === "NOT_SENT" && invoice.status !== "DRAFT" ? "warn" : "neutral"}>{ksefLabel(invoice.ksefStatus)}</StatusPill></td>
          <td><StatusPill tone={invoice.providerError ? "danger" : invoice.providerStatus.includes("ACCEPTED") ? "good" : invoice.providerStatus === "LOCAL" ? "neutral" : "accent"}>{invoice.providerStatus}</StatusPill>{invoice.providerError && <span className="commerce-subline commerce-danger-text" title={invoice.providerError}>{invoice.providerError}</span>}</td>
          <td>{new Date(`${invoice.issueDate}T00:00:00`).toLocaleDateString(locale)}</td>
          <td className="commerce-num"><strong>{money(invoice.grossTotal, invoice.currency)}</strong></td>
          <td><div className="commerce-actions">
            <button type="button" className="btn btn-ghost btn-icon" title={t(T.common_details)} onClick={() => setPreview(invoice)}><Eye size={15} /></button>
            {invoice.status === "DRAFT" && <button type="button" className="btn btn-ghost btn-icon" title={t(T.common_edit)} onClick={() => setEditing(editInvoiceInput(invoice))}><FilePenLine size={15} /></button>}
            {invoice.status === "DRAFT" && <button type="button" className="btn btn-ghost btn-icon" title={t(T.invoice_action_issue)} disabled={busy} onClick={() => act(() => issueInvoice(invoice.id))}><Send size={15} /></button>}
            {invoice.status !== "DRAFT" && invoice.ksefStatus === "NOT_SENT" && <button type="button" className="btn btn-ghost btn-icon" title={t(T.invoice_queue_ksef)} disabled={busy} onClick={() => act(() => queueInvoiceToKsef(invoice.id))}><ShieldCheck size={15} /></button>}
            {invoice.ksefStatus === "ACCEPTED" && invoice.ksefSubmissionId && <button type="button" className="btn btn-ghost btn-icon" title="UPO" disabled={busy} onClick={() => act(() => archiveKsefUpo(invoice.ksefSubmissionId!, invoice.id))}><Download size={15} /></button>}
            {invoice.status !== "CANCELLED" && <button type="button" className="btn btn-ghost btn-icon" title="Pobierz PDF" disabled={busy} onClick={() => act(() => downloadPdf(invoice))}><Download size={15} /></button>}
            {invoice.status !== "CANCELLED" && <button type="button" className="btn btn-ghost btn-icon" title="Drukuj" disabled={busy} onClick={() => act(() => printPdf(invoice))}><Printer size={15} /></button>}
            {invoice.fa3XmlHash && <button type="button" className="btn btn-ghost btn-icon" title="XML FA(3)" disabled={busy} onClick={() => act(() => downloadXml(invoice))}><Download size={15} /></button>}
            {invoice.providerStatus === "ERROR" && invoice.provider && <button type="button" className="btn btn-ghost btn-icon" title={t(T.invoice_provider_recover)} disabled={busy} onClick={() => act(() => recoverInvoiceProviderIssue(invoice.id))}><RefreshCw size={15} /></button>}
            {invoice.providerStatus !== "ERROR" && invoice.status !== "DRAFT" && invoice.provider === "fakturownia" && <button type="button" className="btn btn-ghost btn-icon" title={t(T.invoice_provider_refresh)} disabled={busy} onClick={() => act(() => refreshInvoiceProviderStatus(invoice.id))}><RefreshCw size={15} /></button>}
            {invoice.providerViewUrl && <button type="button" className="btn btn-ghost btn-icon" title={t(T.invoice_provider_open)} onClick={() => openUrl(invoice.providerViewUrl)}><ExternalLink size={15} /></button>}
            {invoice.status === "ISSUED" && <button type="button" className="btn btn-ghost btn-icon" title={t(T.invoice_action_paid)} onClick={() => act(() => markInvoicePaid(invoice.id))}><CircleDollarSign size={16} /></button>}
            {invoice.status !== "DRAFT" && invoice.documentType === "INVOICE" && <button type="button" className="btn btn-ghost btn-icon" title={t(T.invoice_action_correct)} onClick={() => { setCorrecting(invoice); setCorrectionReason(""); }}><FilePenLine size={15} /></button>}
            {invoice.status === "DRAFT" && <button type="button" className="btn btn-ghost btn-icon danger" title={t(T.invoice_action_delete)} onClick={() => setDeleting(invoice)}><Trash2 size={15} /></button>}
          </div></td>
        </tr>)}</tbody>
      </table>}
    </section>

    {editing && <InvoiceEditorModal value={editing} title={editing.id ? t(T.invoice_edit) : t(T.invoice_add)} submitLabel={t(T.common_save)} busy={busy} onChange={setEditing} onClose={() => setEditing(null)} onSubmit={submit} />}
    {settingsOpen && <InvoiceSettingsModal onClose={() => setSettingsOpen(false)} onChanged={() => void load()} />}

    {correcting && <CommerceModal title={t(T.invoice_action_correct)} onClose={() => setCorrecting(null)}><div className="commerce-form-grid"><Field label={t(T.invoice_correction_prompt)} span={2}><textarea className="input commerce-textarea" autoFocus value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} /></Field></div><footer className="commerce-modal-actions"><button type="button" className="btn btn-secondary" onClick={() => setCorrecting(null)}>{t(T.common_cancel)}</button><button type="button" className="btn btn-primary" disabled={busy || !correctionReason.trim()} onClick={correction}>{busy ? t(T.common_please_wait) : t(T.invoice_action_correct)}</button></footer></CommerceModal>}

    {preview && <CommerceModal title={preview.invoiceNumber ?? t(T.invoice_draft_number)} onClose={() => setPreview(null)} wide><InvoicePdfFrame invoice={preview} /><footer className="commerce-modal-actions"><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => act(() => downloadPdf(preview))}><Download size={15} />PDF</button><button type="button" className="btn btn-primary" disabled={busy} onClick={() => act(() => printPdf(preview))}><Printer size={15} />Drukuj</button></footer></CommerceModal>}

    {deleting && <CommerceModal title={t(T.invoice_action_delete)} onClose={() => setDeleting(null)}><div className="invoice-delete-confirm"><p>{t(T.invoice_delete_confirm)}</p><strong>{deleting.invoiceNumber ?? t(T.invoice_draft_number)}</strong></div><footer className="commerce-modal-actions"><button type="button" className="btn btn-secondary" onClick={() => setDeleting(null)}>{t(T.common_cancel)}</button><button type="button" className="btn btn-danger" disabled={busy} onClick={() => { const target = deleting; setDeleting(null); void act(() => deleteInvoiceDraft(target.id)); }}>{t(T.common_delete)}</button></footer></CommerceModal>}
  </CommercePage>;
}
