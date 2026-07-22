import type { ReactNode } from "react";
import { useEffect } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { T, useI18n } from "../lib/i18n";

export function CommercePage({ children }: { children: ReactNode }) {
  return <main className="commerce-page"><div className="commerce-inner">{children}</div></main>;
}

export function CommerceHeader({ title, subtitle, action }: { title: string; subtitle: string; action?: ReactNode }) {
  return (
    <header className="commerce-header">
      <div><h2>{title}</h2><p>{subtitle}</p></div>
      {action}
    </header>
  );
}

export function KpiStrip({ items }: { items: { label: string; value: string | number; tone?: "default" | "warn" | "danger" | "good" }[] }) {
  return (
    <section className="commerce-kpis">
      {items.map((item) => (
        <div className={`commerce-kpi ${item.tone ?? "default"}`} key={item.label}>
          <span>{item.label}</span><strong>{item.value}</strong>
        </div>
      ))}
    </section>
  );
}

export function CommerceModal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="commerce-modal-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={`commerce-modal${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <header><h3>{title}</h3><button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label={t(T.common_close)}><X size={17} /></button></header>
        {children}
      </section>
    </div>
  );
}

export function StatusPill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "good" | "warn" | "danger" }) {
  return <span className={`commerce-status ${tone}`}>{children}</span>;
}

export function EmptyTable({ title, detail }: { title: string; detail: string }) {
  return <div className="commerce-empty"><strong>{title}</strong><span>{detail}</span></div>;
}

export function CommercePagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  const { t } = useI18n();
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    if (page > pageCount) onPageChange(pageCount);
  }, [page, pageCount, onPageChange]);

  if (total === 0) return null;
  const currentPage = Math.min(page, pageCount);
  const from = (currentPage - 1) * pageSize + 1;
  const to = Math.min(currentPage * pageSize, total);

  return (
    <div className="commerce-pagination">
      <span>{t(T.offer_pagination_info, { from, to, total })}</span>
      <label>{t(T.offer_pagination_size)} <select className="input" value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
        <option value={20}>20</option><option value={50}>50</option><option value={100}>100</option>
      </select></label>
      <div className="commerce-pagination-nav">
        <button type="button" className="btn btn-secondary btn-icon" disabled={currentPage <= 1} aria-label={t(T.offer_pagination_previous)} onClick={() => onPageChange(Math.max(1, currentPage - 1))}><ChevronLeft size={15} /></button>
        <span>{currentPage} / {pageCount}</span>
        <button type="button" className="btn btn-secondary btn-icon" disabled={currentPage >= pageCount} aria-label={t(T.offer_pagination_next)} onClick={() => onPageChange(Math.min(pageCount, currentPage + 1))}><ChevronRight size={15} /></button>
      </div>
    </div>
  );
}

export function Field({ label, children, span = 1 }: { label: string; children: ReactNode; span?: 1 | 2 }) {
  return <label className="commerce-field" style={{ gridColumn: span === 2 ? "1 / -1" : undefined }}><span>{label}</span>{children}</label>;
}
