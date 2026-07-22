import { useEffect, useState } from "react";

import { createInvoicePdfDataUrl, type InvoicePdfSource } from "../lib/invoicePdf";

export default function InvoicePdfFrame({ invoice }: { invoice: InvoicePdfSource }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setUrl("");
    setError("");
    void createInvoicePdfDataUrl(invoice).then((value) => {
      if (active) setUrl(value);
    }).catch((value: unknown) => {
      if (active) setError(value instanceof Error ? value.message : "Nie udalo sie przygotowac podgladu PDF.");
    });
    return () => { active = false; };
  }, [invoice]);

  if (error) return <div className="invoice-pdf-error">{error}</div>;
  if (!url) return <div className="commerce-loading invoice-pdf-loading">Przygotowywanie podgladu PDF...</div>;
  return <div className="invoice-pdf-frame"><iframe title="Podglad faktury PDF" src={url} /></div>;
}
