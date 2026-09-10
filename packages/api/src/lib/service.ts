import { SendMessageCommand, type SQSClient } from "@aws-sdk/client-sqs";
import {
  BulkActionSchema,
  CreateExpenseRequestSchema,
  ExpenseEditableSchema,
  ListExpensesQuerySchema,
  SettingsSchema,
  buildReport,
  monthOf,
  receiptObjectKey,
  yearOf,
  type BulkAction,
  type CreateExpenseRequest,
  type CreateExpenseResponse,
  type Expense,
  type ExpenseEdit,
  type ListExpensesQuery,
  type ListExpensesResponse,
  type Report,
  type Settings,
} from "@simple-expenses/shared";
import { ulid } from "ulid";
import { badRequest, notFound } from "./errors.js";
import type { ExpensesRepo } from "./repo.js";
import type { ReceiptStorage } from "./storage.js";

export { BulkActionSchema, CreateExpenseRequestSchema, ExpenseEditableSchema, ListExpensesQuerySchema, SettingsSchema };

export interface ScanMessage {
  type: "rescan";
  userId: string;
  expenseId: string;
}

export interface ServiceDeps {
  repo: ExpensesRepo;
  storage: ReceiptStorage;
  sqs: Pick<SQSClient, "send">;
  scanQueueUrl: string;
  now?: () => Date;
  newId?: () => string;
}

/** All business operations, scoped to one authenticated user per call. */
export class ExpensesService {
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(private readonly deps: ServiceDeps) {
    this.now = deps.now ?? (() => new Date());
    this.newId = deps.newId ?? (() => ulid());
  }

  async create(userId: string, req: CreateExpenseRequest): Promise<CreateExpenseResponse> {
    const id = this.newId();
    const key = receiptObjectKey(userId, id, req.contentType);
    const ts = this.now().toISOString();
    const settings = await this.deps.repo.getSettings(userId);
    const expense: Expense = {
      id,
      userId,
      status: "uploading",
      archived: false,
      date: null,
      month: null,
      year: null,
      merchant: null,
      company: req.company ?? settings.defaultCompany,
      category: req.category ?? null,
      currency: null,
      total: null,
      subtotal: null,
      tax: null,
      paymentMethod: null,
      receiptNumber: null,
      lineItems: [],
      notes: null,
      file: { key, contentType: req.contentType, size: req.size, originalFilename: req.filename },
      extraction: null,
      error: null,
      createdAt: ts,
      updatedAt: ts,
    };
    await this.deps.repo.put(expense);
    const upload = await this.deps.storage.presignUpload(key, req.contentType);
    return { expense, uploadUrl: upload.url, uploadHeaders: upload.headers };
  }

  async get(userId: string, id: string): Promise<Expense> {
    const e = await this.deps.repo.get(userId, id);
    if (!e) throw notFound("Expense not found");
    return e;
  }

  async list(userId: string, q: ListExpensesQuery): Promise<ListExpensesResponse> {
    if (q.month && q.year && !q.month.startsWith(q.year)) throw badRequest("month does not fall in year");
    try {
      return await this.deps.repo.list(userId, q);
    } catch (err) {
      if ((err as Error).message === "Invalid cursor") throw badRequest("Invalid cursor");
      throw err;
    }
  }

  async update(userId: string, id: string, edit: ExpenseEdit): Promise<Expense> {
    const existing = await this.get(userId, id);
    const updated = applyEdit(existing, edit, this.now());
    await this.deps.repo.put(updated, { mustExist: true });
    return updated;
  }

  async delete(userId: string, id: string): Promise<void> {
    const existing = await this.deps.repo.get(userId, id);
    if (!existing) return;
    await this.deps.storage.delete(existing.file.key);
    await this.deps.repo.delete(userId, id);
  }

  async fileUrl(userId: string, id: string): Promise<{ url: string; contentType: string }> {
    const e = await this.get(userId, id);
    const url = await this.deps.storage.presignDownload(e.file.key, e.file.originalFilename);
    return { url, contentType: e.file.contentType };
  }

  async rescan(userId: string, id: string): Promise<Expense> {
    const e = await this.get(userId, id);
    const head = await this.deps.storage.head(e.file.key);
    if (!head) throw badRequest("Receipt file has not been uploaded yet");
    const updated: Expense = { ...e, status: "scanning", error: null, updatedAt: this.now().toISOString() };
    await this.deps.repo.put(updated, { mustExist: true });
    const msg: ScanMessage = { type: "rescan", userId, expenseId: id };
    await this.deps.sqs.send(new SendMessageCommand({ QueueUrl: this.deps.scanQueueUrl, MessageBody: JSON.stringify(msg) }));
    return updated;
  }

  async bulk(userId: string, req: BulkAction): Promise<{ updated: number; deleted: number; missing: string[] }> {
    let updated = 0;
    let deleted = 0;
    const missing: string[] = [];
    for (const id of new Set(req.ids)) {
      const e = await this.deps.repo.get(userId, id);
      if (!e) {
        missing.push(id);
        continue;
      }
      if (req.action.type === "delete") {
        await this.deps.storage.delete(e.file.key);
        await this.deps.repo.delete(userId, id);
        deleted++;
        continue;
      }
      const edit: ExpenseEdit =
        req.action.type === "archive"
          ? { archived: true }
          : req.action.type === "unarchive"
            ? { archived: false }
            : req.action.type === "mark_ready"
              ? { status: "ready" }
              : {
                  ...(req.action.company !== undefined ? { company: req.action.company } : {}),
                  ...(req.action.category !== undefined ? { category: req.action.category } : {}),
                };
      await this.deps.repo.put(applyEdit(e, edit, this.now()), { mustExist: true });
      updated++;
    }
    return { updated, deleted, missing };
  }

  async report(userId: string, year: string, currency?: string): Promise<Report> {
    if (!/^\d{4}$/.test(year)) throw badRequest("year must be YYYY");
    const expenses = await this.deps.repo.listYear(userId, year);
    return buildReport(year, expenses, currency ?? null);
  }

  getSettings(userId: string): Promise<Settings> {
    return this.deps.repo.getSettings(userId);
  }

  async putSettings(userId: string, settings: Settings): Promise<Settings> {
    const cleaned: Settings = {
      ...settings,
      companies: dedupe(settings.companies),
      categories: dedupe(settings.categories),
      defaultCurrency: settings.defaultCurrency.toUpperCase(),
      defaultCompany: settings.defaultCompany && settings.companies.includes(settings.defaultCompany) ? settings.defaultCompany : settings.companies[0] ?? null,
    };
    if (cleaned.companies.length === 0) throw badRequest("At least one company is required");
    await this.deps.repo.putSettings(userId, cleaned);
    return cleaned;
  }
}

export function applyEdit(existing: Expense, edit: ExpenseEdit, now: Date): Expense {
  if (edit.status === "ready" && existing.status === "uploading") {
    throw badRequest("Cannot mark an expense ready before its file is uploaded");
  }
  const next: Expense = { ...existing, ...stripUndefined(edit), updatedAt: now.toISOString() };
  if (edit.date !== undefined) {
    next.month = monthOf(next.date);
    next.year = yearOf(next.date);
  }
  // Editing fields of a failed or reviewed record implies the user has looked at it.
  if (edit.status === undefined && (existing.status === "failed" || existing.status === "needs_review") && touchesData(edit)) {
    next.status = "ready";
    next.error = null;
  }
  return next;
}

const DATA_FIELDS: Array<keyof ExpenseEdit> = ["date", "merchant", "company", "category", "currency", "total", "subtotal", "tax", "paymentMethod", "receiptNumber", "lineItems", "notes"];

function touchesData(edit: ExpenseEdit): boolean {
  return DATA_FIELDS.some((f) => edit[f] !== undefined);
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const t = v.trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out;
}
