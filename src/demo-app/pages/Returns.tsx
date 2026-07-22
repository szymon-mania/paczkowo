import { useEffect, useMemo, useState } from "react";
import { Check, CircleDollarSign, ClipboardCheck, Eye, PackageCheck, Pencil, Plus, RefreshCw, Search, Send, Trash2, X } from "lucide-react";

import { CommerceHeader, CommerceModal, CommercePage, CommercePagination, EmptyTable, Field, KpiStrip, StatusPill } from "../components/CommerceUi";
import ProductThumbs, { ItemThumb } from "../components/ProductThumbs";
import { deleteReturn, executeReturnRefund, listOrders, listReturns, rejectMarketplaceReturn, saveReturn, syncMarketplaceReturns, transitionReturn, type ReturnCase, type ReturnItem, type ReturnResolution, type ReturnStatus, type SaveReturn } from "../lib/commerceApi";
import { formatCurrencyTotals, formatMoney } from "../lib/commerceFormat";
import { T, translateMessage, useI18n } from "../lib/i18n";
import type { Order, OrderItem } from "../lib/types";

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (value: string, days: number) => new Date(new Date(`${value}T12:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10);
const blankItem = (): ReturnItem => ({ name: "", sku: "", quantity: 1, itemCondition: "UNKNOWN", resolution: "REFUND" });
const asOrderItem = (item: ReturnItem) => ({
  externalOfferId: item.sku ?? item.orderItemId,
  productName: item.name,
  quantity: item.quantity,
  imageUrl: item.imageUrl,
});
const blank = (): SaveReturn => {
  const requestedAt = today();
  return {
    externalOrderId: "", customerName: "", customerEmail: "", returnType: "WITHDRAWAL",
    resolution: "REFUND", reasonCode: "OTHER", reasonDetails: "", requestedAt,
    refundDueAt: addDays(requestedAt, 14), refundAmount: 0, currency: "PLN",
    returnCarrier: "", trackingNumber: "", restockPolicy: "INSPECT", notes: "",
    items: [blankItem()],
  };
};
const editInput = (value: ReturnCase): SaveReturn => ({
  id: value.id, expectedRevision: value.revision, orderDbId: value.orderDbId,
  externalOrderId: value.externalOrderId, customerName: value.customerName,
  customerEmail: value.customerEmail, returnType: value.returnType, resolution: value.resolution,
  reasonCode: value.reasonCode, reasonDetails: value.reasonDetails, requestedAt: value.requestedAt,
  refundDueAt: value.refundDueAt, refundAmount: value.refundAmount, currency: value.currency,
  returnCarrier: value.returnCarrier, trackingNumber: value.trackingNumber,
  restockPolicy: value.restockPolicy, notes: value.notes,
  items: value.items.map((item) => ({ orderItemId: item.orderItemId, sku: item.sku, name: item.name, quantity: item.quantity, itemCondition: item.itemCondition, resolution: item.resolution })),
});

export default function Returns() {
  const { t, lang } = useI18n();
  const locale = lang === "pl" ? "pl-PL" : "en-GB";
  const [rows, setRows] = useState<ReturnCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ReturnStatus | "ALL">("ALL");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [editing, setEditing] = useState<SaveReturn | null>(null);
  const [details, setDetails] = useState<ReturnCase | null>(null);
  const [orderDetails, setOrderDetails] = useState<Order | null>(null);
  const [orderDetailsLoading, setOrderDetailsLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [rejecting, setRejecting] = useState<{ row: ReturnCase; code: string; reason: string } | null>(null);
  const [confirming, setConfirming] = useState<{ row: ReturnCase; action: "refund" | "close" | "reject" | "delete" } | null>(null);

  const load = () => { setLoading(true); listReturns().then(setRows).catch((value) => setError(translateMessage(value, t))).finally(() => setLoading(false)); };
  useEffect(load, []);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => (status === "ALL" || row.status === status)
      && (!q || `${row.externalOrderId ?? ""} ${row.customerName} ${row.customerEmail ?? ""} ${row.items.map((item) => item.sku ?? item.name).join(" ")}`.toLowerCase().includes(q)));
  }, [rows, search, status]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const open = rows.filter((row) => !["CLOSED", "REJECTED", "REFUNDED"].includes(row.status)).length;
  const received = rows.filter((row) => ["RECEIVED", "INSPECTING"].includes(row.status)).length;
  const overdue = rows.filter((row) => row.refundStatus === "PENDING" && row.refundDueAt && row.refundDueAt < today()).length;
  const pendingRefunds = rows.filter((row) => row.refundStatus === "PENDING");
  const pendingRefund = formatCurrencyTotals(pendingRefunds, locale, (row) => row.refundAmount, (row) => row.currency);
  const money = (value: number, currency = "PLN") => formatMoney(locale, value, currency);

  const statusLabel = (value: ReturnStatus) => t({
    REQUESTED: T.return_status_requested, AUTHORIZED: T.return_status_authorized,
    IN_TRANSIT: T.return_status_in_transit, RECEIVED: T.return_status_received,
    INSPECTING: T.return_status_inspecting, ACCEPTED: T.return_status_accepted,
    REJECTED: T.return_status_rejected, REFUNDED: T.return_status_refunded, CLOSED: T.return_status_closed,
  }[value]);
  const resolutionLabel = (value: ReturnResolution) => t({
    PENDING: T.return_resolution_pending, REFUND: T.return_resolution_refund,
    PARTIAL_REFUND: T.return_resolution_partial, REPLACEMENT: T.return_resolution_replacement,
    REPAIR: T.return_resolution_repair, STORE_CREDIT: T.return_resolution_credit,
  }[value]);
  const typeLabel = (value: ReturnCase["returnType"]) => t({
    WITHDRAWAL: T.return_type_withdrawal, COMPLAINT: T.return_type_complaint,
    MARKETPLACE_RETURN: T.return_type_marketplace,
  }[value]);
  const reasonLabel = (value: string) => t({
    CHANGED_MIND: T.return_reason_changed, DAMAGED: T.return_reason_damaged,
    NOT_AS_DESCRIBED: T.return_reason_description, WRONG_ITEM: T.return_reason_wrong,
    OTHER: T.return_reason_other,
  }[value as "CHANGED_MIND" | "DAMAGED" | "NOT_AS_DESCRIBED" | "WRONG_ITEM" | "OTHER"] ?? T.return_reason_other);
  const conditionLabel = (value: string) => t({
    UNKNOWN: T.return_condition_unknown, NEW: T.return_condition_new,
    OPENED: T.return_condition_opened, USED: T.return_condition_used,
    DAMAGED: T.return_condition_damaged,
  }[value as "UNKNOWN" | "NEW" | "OPENED" | "USED" | "DAMAGED"] ?? T.return_condition_unknown);
  const restockLabel = (value: ReturnCase["restockPolicy"]) => t({
    INSPECT: T.return_restock_inspect, RESTOCK: T.return_restock_stock,
    QUARANTINE: T.return_restock_quarantine, DISPOSE: T.return_restock_dispose,
    RETURN_TO_SUPPLIER: T.return_restock_supplier,
  }[value]);
  const platformLabel = (value: string) => value === "manual" ? t(T.return_manual) : value === "allegro" ? "Allegro" : value === "erli" ? "ERLI" : value;
  const date = (value?: string, withTime = false) => {
    if (!value) return "-";
    const parsed = new Date(value.length === 10 ? `${value}T12:00:00` : value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleString(locale, withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" });
  };
  const tone = (value: ReturnStatus): "neutral" | "accent" | "good" | "warn" | "danger" => value === "REJECTED" ? "danger" : value === "REFUNDED" || value === "CLOSED" ? "good" : value === "RECEIVED" || value === "INSPECTING" ? "warn" : value === "AUTHORIZED" ? "accent" : "neutral";
  const canSave = Boolean(editing
    && editing.customerName.trim()
    && editing.reasonCode.trim()
    && editing.requestedAt
    && Number.isFinite(editing.refundAmount)
    && editing.refundAmount >= 0
    && /^[A-Z]{3}$/.test(editing.currency)
    && editing.items.length > 0
    && editing.items.every((item) => item.name.trim() && Number.isInteger(item.quantity) && item.quantity > 0));

  const submit = async () => {
    if (!editing) return;
    setBusy(true); setError("");
    try { await saveReturn(editing); setEditing(null); load(); }
    catch (value) { setError(translateMessage(value, t)); }
    finally { setBusy(false); }
  };
  const act = async (id: number, next: ReturnStatus) => {
    setBusy(true); setError("");
    try { await transitionReturn(id, next); load(); }
    catch (value) { setError(translateMessage(value, t)); }
    finally { setBusy(false); }
  };
  const sync = async () => {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await syncMarketplaceReturns();
      setNotice(t(T.return_sync_result).replace("{saved}", String(result.saved)).replace("{pending}", String(result.pendingRefunds)));
      load();
    } catch (value) { setError(translateMessage(value, t)); }
    finally { setBusy(false); }
  };
  const refund = async (row: ReturnCase) => {
    setBusy(true); setError("");
    try { await executeReturnRefund(row.id); load(); }
    catch (value) { setError(translateMessage(value, t)); }
    finally { setBusy(false); }
  };
  const runConfirmed = async () => {
    if (!confirming) return;
    const current = confirming;
    setConfirming(null);
    if (current.action === "refund") await refund(current.row);
    else if (current.action === "close") await act(current.row.id, "CLOSED");
    else if (current.row.sourcePlatform === "allegro") setRejecting({ row: current.row, code: "REFUND_REJECTED", reason: current.row.reasonDetails ?? "" });
    else if (current.action === "reject") await act(current.row.id, "REJECTED");
    else {
      setBusy(true); setError("");
      try { await deleteReturn(current.row.id); load(); }
      catch (value) { setError(translateMessage(value, t)); }
      finally { setBusy(false); }
    }
  };
  const reject = async () => {
    if (!rejecting) return;
    setBusy(true); setError("");
    try { await rejectMarketplaceReturn(rejecting.row.id, rejecting.code, rejecting.reason || undefined); setRejecting(null); load(); }
    catch (value) { setError(translateMessage(value, t)); }
    finally { setBusy(false); }
  };

  const openDetails = (row: ReturnCase) => {
    setDetails(row);
    setOrderDetails(null);
    if (!row.orderDbId && !row.externalOrderId) return;
    setOrderDetailsLoading(true);
    listOrders()
      .then((orders) => setOrderDetails(orders.find((order) => order.id === row.orderDbId || order.externalOrderId === row.externalOrderId) ?? null))
      .catch(() => setOrderDetails(null))
      .finally(() => setOrderDetailsLoading(false));
  };

  const actions = (row: ReturnCase) => {
    const buttons: { next: ReturnStatus; icon: typeof Check; label: T }[] = [];
    if (row.status === "REQUESTED") buttons.push({ next: "AUTHORIZED", icon: Check, label: T.return_action_authorize });
    if (row.status === "AUTHORIZED") buttons.push({ next: "IN_TRANSIT", icon: Send, label: T.return_action_in_transit }, { next: "RECEIVED", icon: PackageCheck, label: T.return_action_receive });
    if (row.status === "IN_TRANSIT") buttons.push({ next: "RECEIVED", icon: PackageCheck, label: T.return_action_receive });
    if (row.status === "RECEIVED") buttons.push({ next: "INSPECTING", icon: ClipboardCheck, label: T.return_action_inspect }, { next: "ACCEPTED", icon: Check, label: T.return_action_accept });
    if (row.status === "INSPECTING") buttons.push({ next: "ACCEPTED", icon: Check, label: T.return_action_accept });
    if (row.status === "ACCEPTED" && row.sourcePlatform !== "allegro") buttons.push({ next: ["REFUND", "PARTIAL_REFUND"].includes(row.resolution) ? "REFUNDED" : "CLOSED", icon: CircleDollarSign, label: ["REFUND", "PARTIAL_REFUND"].includes(row.resolution) ? T.return_action_refund : T.return_action_close });
    if (row.status === "REFUNDED" || row.status === "REJECTED") buttons.push({ next: "CLOSED", icon: Check, label: T.return_action_close });
    return buttons;
  };
  const detailTimeline = (row: ReturnCase, order?: Order | null) => {
    const products = row.items.map((item) => item.name + (item.quantity > 1 ? " x" + item.quantity : "")).join(", ");
    const events: { at?: string; title: string; detail?: string }[] = [];
    if (order?.orderCreatedAt) events.push({ at: order.orderCreatedAt, title: t(T.od_hist_created) });
    if (order?.paymentFinishedAt) events.push({ at: order.paymentFinishedAt, title: t(T.od_hist_paid) });
    const shipmentDate = order?.shipments.find((shipment) => shipment.createdAt)?.createdAt;
    if (shipmentDate || order?.derivedStatus === "wyslane") events.push({ at: shipmentDate ?? order?.externalUpdatedAt, title: t(T.od_hist_shipped) });
    if (order?.derivedStatus === "anulowane") events.push({ at: order.externalUpdatedAt, title: t(T.od_hist_cancelled) });
    events.push({ at: row.requestedAt, title: t(T.return_timeline_reported), detail: products ? `${t(T.return_timeline_product)}: ${products}` : undefined });
    if (row.returnCarrier || row.trackingNumber) events.push({
      at: row.status === "IN_TRANSIT" ? row.updatedAt : undefined,
      title: t(T.return_timeline_shipped),
      detail: [row.returnCarrier, row.trackingNumber].filter(Boolean).join(" / "),
    });
    if (row.receivedAt) events.push({ at: row.receivedAt, title: t(T.return_timeline_received) });
    if (["INSPECTING", "ACCEPTED", "REFUNDED", "CLOSED"].includes(row.status)) events.push({
      at: row.status === "INSPECTING" ? row.updatedAt : row.receivedAt,
      title: t(T.return_timeline_inspecting),
      detail: row.items.map((item) => `${item.name}: ${conditionLabel(item.itemCondition)}`).join(" · "),
    });
    if (["ACCEPTED", "REFUNDED", "CLOSED"].includes(row.status)) events.push({
      at: row.status === "ACCEPTED" ? row.updatedAt : row.refundedAt,
      title: t(T.return_timeline_accepted), detail: resolutionLabel(row.resolution),
    });
    if (row.refundedAt || row.status === "REFUNDED") events.push({
      at: row.refundedAt ?? row.updatedAt,
      title: t(T.return_timeline_refunded),
      detail: row.refundStatus === "COMPLETED" ? money(row.refundAmount, row.currency) : resolutionLabel(row.resolution),
    });
    return events;
  };
  const linkedOrder = details && orderDetails && (orderDetails.id === details.orderDbId || orderDetails.externalOrderId === details.externalOrderId) ? orderDetails : null;
  const detailItems = linkedOrder?.items?.length ? linkedOrder.items : details ? details.items.map(asOrderItem) : [];
  const returnedItemFor = (item: OrderItem, row: ReturnCase) => row.items.find((returnItem) => {
    const sameOffer = Boolean(item.externalOfferId && (item.externalOfferId === returnItem.orderItemId || item.externalOfferId === returnItem.sku));
    const sameProduct = Boolean(item.productName && returnItem.name && item.productName.trim().toLocaleLowerCase() === returnItem.name.trim().toLocaleLowerCase());
    return sameOffer || sameProduct;
  });
  const confirmTitle = confirming ? confirming.action === "refund" ? t(T.return_action_refund) : confirming.action === "reject" ? t(T.return_action_reject) : confirming.action === "delete" ? t(T.return_action_delete) : t(T.return_action_close) : "";
  const confirmRef = confirming ? confirming.row.externalOrderId ?? "#" + confirming.row.id : "";
  const confirmBody = confirming ? confirming.action === "refund"
    ? `Czy na pewno chcesz potwierdzić refundację dla sprawy ${confirmRef}?`
    : confirming.action === "reject"
      ? `Czy na pewno chcesz odrzucić sprawę ${confirmRef}?`
      : confirming.action === "delete"
        ? t(T.return_delete_confirm)
        : `Czy na pewno chcesz zamknąć sprawę ${confirmRef}?` : "";

  return (
    <CommercePage>
      <CommerceHeader title={t(T.nav_returns)} subtitle={t(T.return_subtitle)} action={<div className="commerce-header-actions"><button type="button" className="btn btn-secondary" disabled={busy} onClick={sync}><RefreshCw size={15} className={busy ? "spin" : ""} />{t(T.return_sync)}</button><button type="button" className="btn btn-primary" onClick={() => setEditing(blank())}><Plus size={15} />{t(T.return_add)}</button></div>} />
      <KpiStrip items={[
        { label: t(T.return_kpi_open), value: open },
        { label: t(T.return_kpi_received), value: received, tone: received ? "warn" : "default" },
        { label: t(T.return_kpi_overdue), value: overdue, tone: overdue ? "danger" : "good" },
        { label: t(T.return_kpi_refunds), value: pendingRefund, tone: pendingRefunds.length ? "warn" : "default" },
      ]} />
      {error && <div className="commerce-alert danger">{error}</div>}
      {notice && <div className="commerce-alert good">{notice}</div>}
      <section className="commerce-toolbar">
        <div className="commerce-search"><Search size={15} /><input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder={t(T.return_search)} /></div>
        <div className="seg">{(["ALL", "REQUESTED", "AUTHORIZED", "RECEIVED", "ACCEPTED", "REFUNDED", "CLOSED"] as const).map((value) => <button type="button" key={value} className={`commerce-seg-btn${status === value ? " active" : ""}`} onClick={() => { setStatus(value); setPage(1); }}>{value === "ALL" ? t(T.common_all) : statusLabel(value)}</button>)}</div>
      </section>
      <section className="commerce-table-wrap">
        {loading ? <div className="commerce-loading">{t(T.common_loading)}</div> : filtered.length === 0 ? <EmptyTable title={t(T.return_empty)} detail={t(T.return_empty_detail)} /> : (
          <table className="table commerce-table"><thead><tr><th>{t(T.return_col_case)}</th><th>{t(T.return_col_customer)}</th><th>{t(T.return_col_status)}</th><th>{t(T.return_col_resolution)}</th><th>{t(T.return_col_deadline)}</th><th>{t(T.return_col_amount)}</th><th /></tr></thead>
            <tbody>{visible.map((row) => <tr key={row.id}>
              <td><strong>{platformLabel(row.sourcePlatform)}</strong><span className="commerce-subline">{t(T.return_field_requested)}: {date(row.requestedAt)}</span></td>
              <td><div className="return-list-products"><ProductThumbs items={row.items.map(asOrderItem)} fit="contain" /><div><strong>{row.customerName}</strong><span className="commerce-subline">{row.items.map((item) => item.name).slice(0, 2).join(", ")}</span></div></div></td>
              <td><StatusPill tone={row.refundStatus === "FAILED" ? "danger" : tone(row.status)}>{statusLabel(row.status)}</StatusPill>{row.refundStatus === "FAILED" && <span className="commerce-subline commerce-danger-text" title={row.refundError}>{t(T.return_refund_attention)}</span>}</td>
              <td>{resolutionLabel(row.resolution)}</td>
              <td className={row.refundStatus === "PENDING" && row.refundDueAt && row.refundDueAt < today() ? "commerce-danger-text" : ""}>{date(row.refundDueAt)}</td>
              <td className="commerce-num">{money(row.refundAmount, row.currency)}</td>
              <td><div className="commerce-actions">
                <button type="button" className="btn btn-ghost btn-icon" title={t(T.return_details)} onClick={() => openDetails(row)}><Eye size={15} /></button>
                {(row.status === "REQUESTED" && row.sourcePlatform === "manual" || ["RECEIVED", "INSPECTING"].includes(row.status)) && <button type="button" className="btn btn-ghost btn-icon" title={t(T.common_edit)} onClick={() => setEditing(editInput(row))}><Pencil size={15} /></button>}
                {actions(row).map(({ next, icon: Icon, label }) => <button type="button" key={next} className="btn btn-ghost btn-icon" title={t(label)} disabled={busy} onClick={() => next === "CLOSED" ? setConfirming({ row, action: "close" }) : act(row.id, next)}><Icon size={15} /></button>)}
                {["REQUESTED", "INSPECTING"].includes(row.status) && <button type="button" className="btn btn-ghost btn-icon danger" title={t(T.return_action_reject)} onClick={() => setConfirming({ row, action: "reject" })}><X size={15} /></button>}
                {row.sourcePlatform === "allegro" && row.status === "ACCEPTED" && ["REFUND", "PARTIAL_REFUND"].includes(row.resolution) && row.refundStatus === "PENDING" && <button type="button" className="btn btn-ghost btn-icon" title={t(T.return_action_refund)} disabled={busy} onClick={() => setConfirming({ row, action: "refund" })}><CircleDollarSign size={15} /></button>}
                {row.status === "REQUESTED" && row.sourcePlatform === "manual" && <button type="button" className="btn btn-ghost btn-icon danger" title={t(T.return_action_delete)} onClick={() => setConfirming({ row, action: "delete" })}><Trash2 size={15} /></button>}
              </div></td>
            </tr>)}</tbody></table>
        )}
      </section>
      {!loading && <CommercePagination page={currentPage} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={(value) => { setPageSize(value); setPage(1); }} />}

      {confirming && (
        <CommerceModal title={confirmTitle} onClose={() => setConfirming(null)}>
          <div className="return-confirm">
            <div className={`return-confirm-icon ${confirming.action}`}>{confirming.action === "refund" ? <CircleDollarSign size={20} /> : confirming.action === "reject" ? <X size={20} /> : confirming.action === "delete" ? <Trash2 size={20} /> : <Check size={20} />}</div>
            <h4>{confirmTitle}</h4>
            <p>{confirmBody}</p>
            {confirming.action === "refund" && <strong>{money(confirming.row.refundAmount, confirming.row.currency)}</strong>}
          </div>
          <footer className="commerce-modal-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setConfirming(null)} disabled={busy}>{t(T.common_cancel)}</button>
            <button type="button" className="btn btn-primary" onClick={runConfirmed} disabled={busy}>{busy ? t(T.common_please_wait) : t(T.common_confirm)}</button>
          </footer>
        </CommerceModal>
      )}

      {details && <CommerceModal title={t(T.return_details)} onClose={() => { setDetails(null); setOrderDetails(null); }} wide>
        <div className="return-detail">
          <div className="return-detail-hero">
            <div><span>{platformLabel(details.sourcePlatform)}</span><h4>{linkedOrder ? "#" + linkedOrder.externalOrderId : details.items.length === 1 ? details.items[0].name : String(details.items.length) + " " + t(T.return_section_items).toLowerCase()}</h4><p>{details.customerName}</p></div>
            <StatusPill tone={details.refundStatus === "FAILED" ? "danger" : tone(details.status)}>{statusLabel(details.status)}</StatusPill>
          </div>
          <div className="return-order-layout">
            <div className="return-order-main">
              <section className="return-detail-panel return-order-items">
                <h4>{linkedOrder ? t(T.od_items) : t(T.return_section_items)}</h4>
                {orderDetailsLoading ? <div className="commerce-loading">{t(T.common_loading)}</div> : <div className="return-detail-products">{detailItems.map((item, index) => {
                  const returnedItem = returnedItemFor(item, details);
                  return <div className={`return-detail-product${returnedItem ? " is-returned" : ""}`} key={item.externalOfferId ?? item.productName ?? index}>
                    <ItemThumb item={item} size={64} fit="contain" />
                    <div><strong>{item.productName ?? "-"}</strong><span>{item.externalOfferId && "SKU: " + item.externalOfferId}{item.externalOfferId && " / "}{t(T.return_item_qty)}: {item.quantity ?? 1}</span>{returnedItem && <small>{t(T.return_timeline_product)}: {returnedItem.quantity} / {conditionLabel(returnedItem.itemCondition)}</small>}</div>
                  </div>;
                })}</div>}
              </section>
              <section className="return-detail-panel return-detail-facts">
                <h4>{t(T.return_section_case)}</h4>
                <div><span>{t(T.return_field_type)}</span><strong>{typeLabel(details.returnType)}</strong></div>
                <div><span>{t(T.return_field_reason)}</span><strong>{reasonLabel(details.reasonCode)}</strong></div>
                <div><span>{t(T.return_field_resolution)}</span><strong>{resolutionLabel(details.resolution)}</strong></div>
                <div><span>{t(T.return_field_amount)}</span><strong>{money(details.refundAmount, details.currency)}</strong></div>
                <div><span>{t(T.return_field_restock)}</span><strong>{restockLabel(details.restockPolicy)}</strong></div>
                {details.reasonDetails && <p>{details.reasonDetails}</p>}
              </section>
            </div>
            <aside className="return-order-aside">
              <section className="return-detail-panel return-detail-facts">
                <h4>{t(T.nav_orders)}</h4>
                <div><span>{t(T.return_field_order)}</span><strong>{linkedOrder?.externalOrderId ?? details.externalOrderId ?? "-"}</strong></div>
                <div><span>{t(T.return_field_requested)}</span><strong>{date(linkedOrder?.orderCreatedAt ?? details.requestedAt, true)}</strong></div>
                {linkedOrder && <><div><span>{t(T.od_total)}</span><strong>{money(Number(linkedOrder.totalToPay ?? 0), linkedOrder.currency ?? details.currency)}</strong></div><div><span>{t(T.od_payment)}</span><strong>{linkedOrder.paymentFinishedAt ? t(T.od_hist_paid) : linkedOrder.paymentProvider ?? linkedOrder.paymentType ?? "-"}</strong></div><div><span>{t(T.od_delivery)}</span><strong>{linkedOrder.deliveryMethodName ?? linkedOrder.carrier ?? t(T.return_detail_no_tracking)}</strong></div></>}
              </section>
              <section className="return-detail-panel return-detail-facts">
                <h4>{t(T.return_section_customer)}</h4>
                <div><span>{t(T.return_field_customer)}</span><strong>{details.customerName}</strong></div>
                <div><span>{t(T.return_field_email)}</span><strong>{linkedOrder?.buyerEmail ?? details.customerEmail ?? "-"}</strong></div>
                <div><span>{t(T.return_detail_logistics)}</span><strong>{[details.returnCarrier, details.trackingNumber].filter(Boolean).join(" / ") || t(T.return_detail_no_tracking)}</strong></div>
                {details.notes && <p>{details.notes}</p>}
              </section>
              <section className="return-detail-panel return-detail-timeline">
                <h4>{t(T.od_history)}</h4>
                <div>{detailTimeline(details, linkedOrder).map((event, index) => <div className="return-timeline-event" key={event.title + "-" + index}>
                  <div className="return-timeline-rail"><i /></div>
                  <div><time>{date(event.at, Boolean(event.at && event.at.length > 10))}</time><strong>{event.title}</strong>{event.detail && <span>{event.detail}</span>}</div>
                </div>)}</div>
              </section>
            </aside>
          </div>
        </div>
        <footer className="commerce-modal-actions">
          {(details.status === "REQUESTED" && details.sourcePlatform === "manual" || ["RECEIVED", "INSPECTING"].includes(details.status)) && <button type="button" className="btn btn-secondary" onClick={() => { setDetails(null); setOrderDetails(null); setEditing(editInput(details)); }}><Pencil size={15} />{t(T.common_edit)}</button>}
          <button type="button" className="btn btn-primary" onClick={() => { setDetails(null); setOrderDetails(null); }}>{t(T.common_close)}</button>
        </footer>
      </CommerceModal>}

      {editing && <CommerceModal title={editing.id ? t(T.return_edit) : t(T.return_add)} onClose={() => setEditing(null)} wide>
        <div className="commerce-form-grid">
          <div className="commerce-form-section">{t(T.return_section_case)}</div>
          <Field label={t(T.return_field_order)}><input className="input" value={editing.externalOrderId ?? ""} onChange={(e) => setEditing({ ...editing, externalOrderId: e.target.value })} /></Field>
          <Field label={t(T.return_field_type)}><select className="input" value={editing.returnType} onChange={(e) => setEditing({ ...editing, returnType: e.target.value as SaveReturn["returnType"] })}><option value="WITHDRAWAL">{t(T.return_type_withdrawal)}</option><option value="COMPLAINT">{t(T.return_type_complaint)}</option><option value="MARKETPLACE_RETURN">{t(T.return_type_marketplace)}</option></select></Field>
          <Field label={t(T.return_field_requested)}><input className="input" type="date" value={editing.requestedAt} onChange={(e) => setEditing({ ...editing, requestedAt: e.target.value, refundDueAt: ["REFUND", "PARTIAL_REFUND"].includes(editing.resolution) && e.target.value ? addDays(e.target.value, 14) : undefined })} /></Field>
          <Field label={t(T.return_field_resolution)}><select className="input" value={editing.resolution} onChange={(e) => { const resolution = e.target.value as ReturnResolution; setEditing({ ...editing, resolution, refundDueAt: ["REFUND", "PARTIAL_REFUND"].includes(resolution) ? editing.refundDueAt ?? addDays(editing.requestedAt, 14) : undefined }); }}><option value="REFUND">{t(T.return_resolution_refund)}</option><option value="PARTIAL_REFUND">{t(T.return_resolution_partial)}</option><option value="REPLACEMENT">{t(T.return_resolution_replacement)}</option><option value="REPAIR">{t(T.return_resolution_repair)}</option><option value="STORE_CREDIT">{t(T.return_resolution_credit)}</option><option value="PENDING">{t(T.return_resolution_pending)}</option></select></Field>
          <Field label={t(T.return_field_reason)}><select className="input" value={editing.reasonCode} onChange={(e) => setEditing({ ...editing, reasonCode: e.target.value })}><option value="CHANGED_MIND">{t(T.return_reason_changed)}</option><option value="DAMAGED">{t(T.return_reason_damaged)}</option><option value="NOT_AS_DESCRIBED">{t(T.return_reason_description)}</option><option value="WRONG_ITEM">{t(T.return_reason_wrong)}</option><option value="OTHER">{t(T.return_reason_other)}</option></select></Field>
          <Field label={t(T.return_field_amount)}><input className="input" type="number" min="0" step="0.01" value={editing.refundAmount} onChange={(e) => setEditing({ ...editing, refundAmount: Number(e.target.value) })} /></Field>
          <Field label={t(T.return_field_currency)}><select className="input" value={editing.currency} onChange={(e) => setEditing({ ...editing, currency: e.target.value })}><option>PLN</option><option>EUR</option><option>USD</option><option>GBP</option><option>CZK</option></select></Field>
          {["REFUND", "PARTIAL_REFUND"].includes(editing.resolution) && <Field label={t(T.return_field_refund_due)}><input className="input" type="date" value={editing.refundDueAt ?? ""} onChange={(e) => setEditing({ ...editing, refundDueAt: e.target.value })} /></Field>}
          <Field label={t(T.return_field_details)} span={2}><textarea className="input commerce-textarea" value={editing.reasonDetails ?? ""} onChange={(e) => setEditing({ ...editing, reasonDetails: e.target.value })} /></Field>
          <div className="commerce-form-section">{t(T.return_section_customer)}</div>
          <Field label={t(T.return_field_customer)}><input className="input" value={editing.customerName} onChange={(e) => setEditing({ ...editing, customerName: e.target.value })} /></Field>
          <Field label={t(T.return_field_email)}><input className="input" type="email" value={editing.customerEmail ?? ""} onChange={(e) => setEditing({ ...editing, customerEmail: e.target.value })} /></Field>
          <Field label={t(T.return_field_carrier)}><input className="input" value={editing.returnCarrier ?? ""} onChange={(e) => setEditing({ ...editing, returnCarrier: e.target.value })} /></Field>
          <Field label={t(T.return_field_tracking)}><input className="input" value={editing.trackingNumber ?? ""} onChange={(e) => setEditing({ ...editing, trackingNumber: e.target.value })} /></Field>
          <Field label={t(T.return_field_restock)}><select className="input" value={editing.restockPolicy} onChange={(e) => setEditing({ ...editing, restockPolicy: e.target.value as SaveReturn["restockPolicy"] })}><option value="INSPECT">{t(T.return_restock_inspect)}</option><option value="RESTOCK">{t(T.return_restock_stock)}</option><option value="QUARANTINE">{t(T.return_restock_quarantine)}</option><option value="DISPOSE">{t(T.return_restock_dispose)}</option><option value="RETURN_TO_SUPPLIER">{t(T.return_restock_supplier)}</option></select></Field>
          <Field label={t(T.return_field_notes)} span={2}><textarea className="input commerce-textarea" value={editing.notes ?? ""} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></Field>
          <div className="commerce-form-section row"><span>{t(T.return_section_items)}</span><button type="button" className="btn btn-secondary" onClick={() => setEditing({ ...editing, items: [...editing.items, blankItem()] })}><Plus size={14} />{t(T.return_add_item)}</button></div>
          <div className="return-items" style={{ gridColumn: "1 / -1" }}>{editing.items.map((item, index) => <div className="return-item-row" key={index}>
            <input className="input" placeholder={t(T.return_item_name)} value={item.name} onChange={(e) => { const items = [...editing.items]; items[index] = { ...item, name: e.target.value }; setEditing({ ...editing, items }); }} />
            <input className="input" placeholder="SKU" value={item.sku ?? ""} onChange={(e) => { const items = [...editing.items]; items[index] = { ...item, sku: e.target.value }; setEditing({ ...editing, items }); }} />
            <input className="input" aria-label={t(T.return_item_qty)} type="number" min="1" value={item.quantity} onChange={(e) => { const items = [...editing.items]; items[index] = { ...item, quantity: Number(e.target.value) }; setEditing({ ...editing, items }); }} />
            <select className="input" aria-label={t(T.return_item_condition)} value={item.itemCondition} onChange={(e) => { const items = [...editing.items]; items[index] = { ...item, itemCondition: e.target.value }; setEditing({ ...editing, items }); }}><option value="UNKNOWN">{t(T.return_condition_unknown)}</option><option value="NEW">{t(T.return_condition_new)}</option><option value="OPENED">{t(T.return_condition_opened)}</option><option value="USED">{t(T.return_condition_used)}</option><option value="DAMAGED">{t(T.return_condition_damaged)}</option></select>
            <button type="button" className="btn btn-ghost btn-icon" disabled={editing.items.length === 1} onClick={() => setEditing({ ...editing, items: editing.items.filter((_, i) => i !== index) })}><X size={15} /></button>
          </div>)}</div>
        </div>
        <footer className="commerce-modal-actions"><button type="button" className="btn btn-secondary" onClick={() => setEditing(null)}>{t(T.common_cancel)}</button><button type="button" className="btn btn-primary" disabled={busy || !canSave} onClick={submit}>{busy ? t(T.common_please_wait) : t(T.common_save)}</button></footer>
      </CommerceModal>}

      {rejecting && <CommerceModal title={t(T.return_action_reject)} onClose={() => setRejecting(null)}>
        <div className="commerce-form-grid">
          <Field label={t(T.return_rejection_code)} span={2}><select className="input" value={rejecting.code} onChange={(event) => setRejecting({ ...rejecting, code: event.target.value })}>
            <option value="REFUND_REJECTED">{t(T.return_reject_refund)}</option><option value="NEW_ITEM_SENT">{t(T.return_reject_replaced)}</option><option value="ITEM_FIXED">{t(T.return_reject_fixed)}</option><option value="MISSING_PART_SENT">{t(T.return_reject_part)}</option><option value="ITEM_MISMATCH">{t(T.return_reject_mismatch)}</option><option value="BUSINESS_PURCHASE">{t(T.return_reject_business)}</option><option value="NO_RETURN_RIGHT">{t(T.return_reject_no_right)}</option>
          </select></Field>
          <Field label={t(T.return_field_details)} span={2}><textarea className="input commerce-textarea" value={rejecting.reason} onChange={(event) => setRejecting({ ...rejecting, reason: event.target.value })} /></Field>
        </div>
        <footer className="commerce-modal-actions"><button type="button" className="btn btn-secondary" onClick={() => setRejecting(null)}>{t(T.common_cancel)}</button><button type="button" className="btn btn-primary" disabled={busy || (rejecting.code === "REFUND_REJECTED" && !rejecting.reason.trim())} onClick={reject}>{busy ? t(T.common_please_wait) : t(T.return_action_reject)}</button></footer>
      </CommerceModal>}
    </CommercePage>
  );
}
