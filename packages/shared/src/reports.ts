import type { Expense, Report, ReportTotals } from "./schemas.js";
import { round2 } from "./money.js";

function empty(): ReportTotals {
  return { count: 0, total: 0, tax: 0 };
}

function add(t: ReportTotals, e: Expense): void {
  t.count += 1;
  t.total = round2(t.total + (e.total ?? 0));
  t.tax = round2(t.tax + (e.tax ?? 0));
}

function bump(map: Record<string, ReportTotals>, key: string, e: Expense): void {
  const t = map[key] ?? (map[key] = empty());
  add(t, e);
}

function bump2(map: Record<string, Record<string, ReportTotals>>, k1: string, k2: string, e: Expense): void {
  const inner = map[k1] ?? (map[k1] = {});
  bump(inner, k2, e);
}

/**
 * Aggregate a year's expenses. Amounts are only summed for the dominant
 * currency (or `currency`, if given); other currencies are counted separately
 * so totals stay meaningful without exchange rates.
 */
export function buildReport(year: string, expenses: Expense[], currency?: string | null): Report {
  const active = expenses.filter((e) => !e.archived && e.year === year && e.status !== "failed" && e.status !== "uploading");
  const counts = new Map<string, number>();
  for (const e of active) {
    const c = e.currency ?? "";
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const dominant =
    currency ??
    [...counts.entries()].sort((a, b) => b[1] - a[1]).find(([c]) => c !== "")?.[0] ??
    null;

  const report: Report = {
    year,
    currency: dominant,
    overall: empty(),
    byMonth: {},
    byCompany: {},
    byCategory: {},
    byCompanyAndMonth: {},
    byCategoryAndMonth: {},
    otherCurrencies: {},
  };
  for (let m = 1; m <= 12; m++) report.byMonth[`${year}-${String(m).padStart(2, "0")}`] = empty();

  for (const e of active) {
    if (dominant && e.currency && e.currency !== dominant) {
      bump(report.otherCurrencies, e.currency, e);
      continue;
    }
    const month = e.month ?? `${year}-00`;
    const company = e.company ?? "Unassigned";
    const category = e.category ?? "Uncategorised";
    add(report.overall, e);
    bump(report.byMonth, month, e);
    bump(report.byCompany, company, e);
    bump(report.byCategory, category, e);
    bump2(report.byCompanyAndMonth, company, month, e);
    bump2(report.byCategoryAndMonth, category, month, e);
  }
  return report;
}

/** CSV export of expenses (RFC 4180 quoting). */
export function expensesToCsv(expenses: Expense[]): string {
  const header = [
    "id", "date", "merchant", "company", "category", "currency", "total", "tax", "subtotal",
    "paymentMethod", "receiptNumber", "status", "archived", "notes", "filename",
  ];
  const rows = expenses.map((e) => [
    e.id, e.date ?? "", e.merchant ?? "", e.company ?? "", e.category ?? "", e.currency ?? "",
    e.total ?? "", e.tax ?? "", e.subtotal ?? "", e.paymentMethod ?? "", e.receiptNumber ?? "",
    e.status, e.archived ? "yes" : "no", e.notes ?? "", e.file.originalFilename,
  ]);
  const quote = (v: string | number) => {
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(quote).join(",")).join("\r\n") + "\r\n";
}
