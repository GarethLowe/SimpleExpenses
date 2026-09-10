import type { Expense, ExpenseStatus } from "@simple-expenses/shared";

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function monthLabel(month: string | null): string {
  if (!month) return "No date";
  const [y, m] = month.split("-");
  const idx = Number(m) - 1;
  return MONTHS[idx] ? `${MONTHS[idx]} ${y}` : month;
}

export interface MonthGroup {
  month: string | null;
  label: string;
  items: Expense[];
  total: number;
  currency: string | null;
}

/** Group a date-descending list by month, keeping order and summing the dominant currency. */
export function groupByMonth(expenses: Expense[]): MonthGroup[] {
  const groups: MonthGroup[] = [];
  const index = new Map<string, MonthGroup>();
  for (const e of expenses) {
    const key = e.month ?? "";
    let g = index.get(key);
    if (!g) {
      g = { month: e.month, label: monthLabel(e.month), items: [], total: 0, currency: null };
      index.set(key, g);
      groups.push(g);
    }
    g.items.push(e);
  }
  for (const g of groups) {
    const counts = new Map<string, number>();
    for (const e of g.items) if (e.currency) counts.set(e.currency, (counts.get(e.currency) ?? 0) + 1);
    g.currency = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    g.total = Math.round(g.items.filter((e) => e.currency === g.currency).reduce((s, e) => s + (e.total ?? 0), 0) * 100) / 100;
  }
  return groups;
}

export const STATUS_LABEL: Record<ExpenseStatus, string> = {
  uploading: "Uploading",
  scanning: "Scanning",
  needs_review: "Needs review",
  ready: "Ready",
  failed: "Failed",
};

export function currentYear(): string {
  return String(new Date().getFullYear());
}

export function yearsAround(year: string, back = 5): string[] {
  const y = Number(year);
  const out: string[] = [];
  for (let i = y + 1; i >= y - back; i--) out.push(String(i));
  return out;
}

export function shortDate(date: string | null): string {
  if (!date) return "—";
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y}`;
}

export function downloadText(filename: string, text: string, type = "text/csv"): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
