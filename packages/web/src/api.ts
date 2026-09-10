import type {
  BulkAction,
  CreateExpenseRequest,
  CreateExpenseResponse,
  Expense,
  ExpenseEdit,
  ListExpensesQuery,
  ListExpensesResponse,
  Report,
  Settings,
} from "@simple-expenses/shared";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export type ListFilters = Partial<Omit<ListExpensesQuery, "limit">> & { limit?: number };

export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly getToken: () => Promise<string | null>,
  ) {}

  listExpenses(filters: ListFilters): Promise<ListExpensesResponse> {
    const query: Record<string, string> = {};
    for (const [k, v] of Object.entries(filters)) if (v !== undefined && v !== null && v !== "") query[k] = String(v);
    return this.request("GET", "/expenses", undefined, query);
  }

  getExpense(id: string): Promise<Expense> {
    return this.request("GET", `/expenses/${encodeURIComponent(id)}`);
  }

  createExpense(req: CreateExpenseRequest): Promise<CreateExpenseResponse> {
    return this.request("POST", "/expenses", req);
  }

  updateExpense(id: string, edit: ExpenseEdit): Promise<Expense> {
    return this.request("PATCH", `/expenses/${encodeURIComponent(id)}`, edit);
  }

  deleteExpense(id: string): Promise<void> {
    return this.request("DELETE", `/expenses/${encodeURIComponent(id)}`);
  }

  fileUrl(id: string): Promise<{ url: string; contentType: string }> {
    return this.request("GET", `/expenses/${encodeURIComponent(id)}/file`);
  }

  rescan(id: string): Promise<Expense> {
    return this.request("POST", `/expenses/${encodeURIComponent(id)}/rescan`);
  }

  bulk(action: BulkAction): Promise<{ updated: number; deleted: number; missing: string[] }> {
    return this.request("POST", "/expenses/bulk", action);
  }

  report(year: string, currency?: string): Promise<Report> {
    return this.request("GET", `/reports/${year}`, undefined, currency ? { currency } : {});
  }

  getSettings(): Promise<Settings> {
    return this.request("GET", "/settings");
  }

  putSettings(settings: Settings): Promise<Settings> {
    return this.request("PUT", "/settings", settings);
  }

  /** Fetch every non-archived expense in a year (for CSV export). */
  async allInYear(year: string): Promise<Expense[]> {
    const out: Expense[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.listExpenses({ year, limit: 500, cursor });
      out.push(...page.items);
      cursor = page.cursor ?? undefined;
    } while (cursor);
    return out;
  }

  private async request<T>(method: string, path: string, body?: unknown, query?: Record<string, string>): Promise<T> {
    const token = await this.getToken();
    if (!token) throw new ApiError(401, "Not signed in");
    const url = new URL(path, this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`);
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
    const res = await fetch(url, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      const err = (data ?? {}) as { error?: string; details?: unknown };
      throw new ApiError(res.status, err.error ?? `Request failed (${res.status})`, err.details);
    }
    return data as T;
  }
}
