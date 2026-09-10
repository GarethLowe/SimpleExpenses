import type { Expense } from "@simple-expenses/shared";
import { formatMoney } from "@simple-expenses/shared";
import { Link } from "react-router-dom";
import { STATUS_LABEL, shortDate } from "../utils";

export function StatusPill({ status }: { status: Expense["status"] }) {
  return <span className={`pill status-${status}`}>{STATUS_LABEL[status]}</span>;
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="error">{error instanceof Error ? error.message : String(error)}</p>;
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return <p className="muted">{label}</p>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function ExpenseRow({
  expense,
  selected,
  onSelect,
}: {
  expense: Expense;
  selected?: boolean;
  onSelect?: (checked: boolean) => void;
}) {
  const e = expense;
  return (
    <li className={`row ${selected ? "selected" : ""}`}>
      {onSelect && (
        <input type="checkbox" checked={!!selected} onChange={(ev) => onSelect(ev.target.checked)} aria-label={`Select ${e.merchant ?? e.file.originalFilename}`} />
      )}
      <Link to={`/expenses/${e.id}`} className="row-main">
        <Thumb expense={e} />
        <div className="row-title">
          <strong>{e.merchant ?? e.file.originalFilename}</strong>
          {e.status !== "ready" && <StatusPill status={e.status} />}
          {e.archived && <span className="pill">Archived</span>}
        </div>
        <div className="row-sub muted">
          {shortDate(e.date)} · {e.company ?? "No company"}{e.project ? ` · ${e.project}` : ""} · {e.category ?? "Uncategorised"}
        </div>
      </Link>
      <div className="row-amount">{formatMoney(e.total, e.currency)}</div>
    </li>
  );
}

export function Thumb({ expense }: { expense: Expense }) {
  const isPdf = expense.file.contentType === "application/pdf";
  return expense.thumbnailUrl ? (
    <img className="thumb" src={expense.thumbnailUrl} alt="" loading="lazy" />
  ) : (
    <span className={`thumb placeholder ${isPdf ? "pdf" : "img"}`} aria-hidden>{isPdf ? "PDF" : "IMG"}</span>
  );
}

export function Confirm({ message, onConfirm, children, className = "btn danger" }: { message: string; onConfirm: () => void; children: React.ReactNode; className?: string }) {
  return (
    <button className={className} onClick={() => window.confirm(message) && onConfirm()}>
      {children}
    </button>
  );
}
