import type { Invoice, SaveInvoice } from "./commerceApi";

export type InvoicePdfSource = Invoice | SaveInvoice;

export function invoicePdfFileName(invoice: InvoicePdfSource) {
  const number = "invoiceNumber" in invoice ? invoice.invoiceNumber : undefined;
  const fallback = "id" in invoice && invoice.id ? `faktura-${invoice.id}` : "faktura-demo";
  return (number ?? fallback).replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function demoDocument(invoice: InvoicePdfSource) {
  const number = "invoiceNumber" in invoice ? invoice.invoiceNumber : "DOKUMENT DEMO";
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><title>${number}</title><style>body{font-family:Arial,sans-serif;padding:42px;color:#1f2937}h1{color:#6c5fc7;font-size:28px}table{border-collapse:collapse;width:100%;margin-top:28px}td,th{border:1px solid #d1d5db;padding:10px;text-align:left}small{color:#6b7280}</style></head><body><h1>Faktura - podgląd demo</h1><p><strong>${number}</strong></p><p>W wersji demonstracyjnej dokument nie jest generowany ani wysyłany.</p><table><tr><th>Sprzedawca</th><td>${invoice.sellerName}</td></tr><tr><th>Nabywca</th><td>${invoice.buyerName}</td></tr><tr><th>Waluta</th><td>${invoice.currency}</td></tr></table><small>Paczkowo demo</small></body></html>`;
}

export async function createInvoicePdfBlob(invoice: InvoicePdfSource) {
  return new Blob([demoDocument(invoice)], { type: "text/html;charset=utf-8" });
}

export async function createInvoicePdfDataUrl(invoice: InvoicePdfSource) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(demoDocument(invoice))}`;
}

export async function downloadInvoicePdf(invoice: InvoicePdfSource) {
  const url = URL.createObjectURL(await createInvoicePdfBlob(invoice));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${invoicePdfFileName(invoice)}-demo.html`;
  link.click();
  URL.revokeObjectURL(url);
}

export async function printInvoicePdf(invoice: InvoicePdfSource, _printerName?: string) {
  const preview = window.open(await createInvoicePdfDataUrl(invoice), "_blank", "noopener,noreferrer");
  preview?.focus();
}
