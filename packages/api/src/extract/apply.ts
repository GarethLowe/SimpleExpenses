import {
  categoriseByKeywords,
  isIsoDate,
  matchToList,
  monthOf,
  normaliseDate,
  round2,
  yearOf,
  type Expense,
  type ExtractionMeta,
  type Settings,
} from "@simple-expenses/shared";

/** Below this the record is flagged for review even if everything parsed. */
export const REVIEW_THRESHOLD = 0.8;

/**
 * Merge an extraction into an expense record. Pure: returns a new object.
 * User-set values (company/category chosen at upload) are never overwritten.
 */
export function applyExtraction(expense: Expense, meta: ExtractionMeta, settings: Settings, now: Date = new Date()): Expense {
  const r = meta.raw;
  const date = r.date && isIsoDate(r.date) ? r.date : normaliseDate(r.date);
  const merchant = r.merchant?.trim() || null;

  const category =
    expense.category ??
    matchToList(r.category, settings.categories) ??
    categoriseByKeywords([merchant, ...r.line_items.map((l) => l.description)].join(" "), settings.categories);

  const company = expense.company ?? matchToList(r.company_hint, settings.companies) ?? settings.defaultCompany ?? null;
  const project = expense.project ?? matchToList(r.project_hint, settings.projects);

  const currency = (r.currency?.toUpperCase().match(/^[A-Z]{3}$/) ? r.currency.toUpperCase() : null) ?? settings.defaultCurrency;

  const total = r.total !== null ? round2(r.total) : null;
  const lineItems = r.line_items.slice(0, 200).map((l) => ({
    description: l.description.slice(0, 200),
    quantity: l.quantity,
    unit_price: l.unit_price !== null ? round2(l.unit_price) : null,
    total: l.total !== null ? round2(l.total) : null,
  }));

  return {
    ...expense,
    status: "needs_review",
    date,
    month: monthOf(date),
    year: yearOf(date),
    merchant,
    company,
    project,
    category,
    currency,
    total,
    subtotal: r.subtotal !== null ? round2(r.subtotal) : null,
    tax: r.tax !== null ? round2(r.tax) : null,
    paymentMethod: r.payment_method?.trim() || null,
    receiptNumber: r.receipt_number?.trim() || null,
    lineItems,
    notes: expense.notes ?? (r.document_type === "other" ? r.notes : null),
    extraction: meta,
    error: null,
    updatedAt: now.toISOString(),
  };
}

/** Whether an extraction is complete enough that the user could accept it in one tap. */
export function isConfident(expense: Expense): boolean {
  return (
    expense.extraction !== null &&
    expense.extraction.confidence >= REVIEW_THRESHOLD &&
    expense.date !== null &&
    expense.total !== null &&
    expense.merchant !== null
  );
}
