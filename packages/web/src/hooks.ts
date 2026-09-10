import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BulkAction, Expense, ExpenseEdit, ExpenseStatus, Settings } from "@simple-expenses/shared";
import { useApi, type ListFilters } from "./api-context";

export const keys = {
  expenses: (f: ListFilters) => ["expenses", f] as const,
  expense: (id: string) => ["expense", id] as const,
  file: (id: string) => ["file", id] as const,
  settings: ["settings"] as const,
  report: (year: string) => ["report", year] as const,
};

const ACTIVE: ExpenseStatus[] = ["uploading", "scanning"];

export function useSettings() {
  const api = useApi();
  return useQuery({ queryKey: keys.settings, queryFn: () => api.getSettings(), staleTime: 5 * 60_000 });
}

export function useSaveSettings() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (s: Settings) => api.putSettings(s),
    onSuccess: (s) => qc.setQueryData(keys.settings, s),
  });
}

export function useExpenses(filters: ListFilters) {
  const api = useApi();
  return useQuery({
    queryKey: keys.expenses(filters),
    queryFn: () => api.listExpenses(filters),
    refetchInterval: (q) => (q.state.data?.items.some((e) => ACTIVE.includes(e.status)) ? 3000 : false),
  });
}

const INBOX_STATUSES: ExpenseStatus[] = ["needs_review", "failed", "scanning", "uploading"];
const inboxFilters = (status: ExpenseStatus): ListFilters => ({ status, archived: "false", limit: 200 });

/**
 * Inbox: everything that isn't settled, across several statuses. The
 * in-progress statuses poll, but only while they have items and only while
 * the last fetch succeeded, so an idle inbox costs one request per status.
 */
export function useInbox() {
  const api = useApi();
  const results = useQueries({
    queries: INBOX_STATUSES.map((status) => ({
      queryKey: keys.expenses(inboxFilters(status)),
      queryFn: () => api.listExpenses(inboxFilters(status)),
      refetchInterval: (q: { state: { status: string; data?: { items: unknown[] } } }) =>
        ACTIVE.includes(status) && q.state.status === "success" && (q.state.data?.items.length ?? 0) > 0 ? 4000 : false,
    })),
  });
  const items = results.flatMap((r) => r.data?.items ?? []);
  return {
    items,
    isLoading: results.some((r) => r.isLoading),
    error: results.find((r) => r.error)?.error ?? null,
    refetch: () => Promise.all(results.map((r) => r.refetch())),
  };
}

/** Badge count for the nav: review/failed only, no polling, tolerant of errors. */
export function useInboxCount(): number {
  const api = useApi();
  const statuses: ExpenseStatus[] = ["needs_review", "failed"];
  const results = useQueries({
    queries: statuses.map((status) => ({
      queryKey: keys.expenses(inboxFilters(status)),
      queryFn: () => api.listExpenses(inboxFilters(status)),
      staleTime: 60_000,
      retry: false,
    })),
  });
  return results.reduce((n, r) => n + (r.data?.items.length ?? 0), 0);
}

export function useExpense(id: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: keys.expense(id ?? ""),
    queryFn: () => api.getExpense(id!),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data && ACTIVE.includes(q.state.data.status) ? 2500 : false),
  });
}

export function useFileUrl(id: string | undefined) {
  const api = useApi();
  return useQuery({ queryKey: keys.file(id ?? ""), queryFn: () => api.fileUrl(id!), enabled: !!id, staleTime: 10 * 60_000 });
}

function useInvalidateExpenses() {
  const qc = useQueryClient();
  return (expense?: Expense) => {
    void qc.invalidateQueries({ queryKey: ["expenses"] });
    void qc.invalidateQueries({ queryKey: ["report"] });
    if (expense) qc.setQueryData(keys.expense(expense.id), expense);
  };
}

export function useUpdateExpense() {
  const api = useApi();
  const invalidate = useInvalidateExpenses();
  return useMutation({
    mutationFn: ({ id, edit }: { id: string; edit: ExpenseEdit }) => api.updateExpense(id, edit),
    onSuccess: (e) => invalidate(e),
  });
}

export function useDeleteExpense() {
  const api = useApi();
  const invalidate = useInvalidateExpenses();
  return useMutation({ mutationFn: (id: string) => api.deleteExpense(id), onSuccess: () => invalidate() });
}

export function useRescan() {
  const api = useApi();
  const invalidate = useInvalidateExpenses();
  return useMutation({ mutationFn: (id: string) => api.rescan(id), onSuccess: (e) => invalidate(e) });
}

export function useBulk() {
  const api = useApi();
  const invalidate = useInvalidateExpenses();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (action: BulkAction) => api.bulk(action),
    onSuccess: (_r, action) => {
      invalidate();
      for (const id of action.ids) void qc.invalidateQueries({ queryKey: keys.expense(id) });
    },
  });
}

export function useReport(year: string) {
  const api = useApi();
  return useQuery({ queryKey: keys.report(year), queryFn: () => api.report(year) });
}
