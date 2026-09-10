import { z } from "zod";

/** Lifecycle of an expense record. */
export const ExpenseStatus = z.enum([
  "uploading", // record created, file not yet in S3
  "scanning", // file received, extraction in progress
  "needs_review", // extraction done, awaiting user confirmation
  "ready", // confirmed by the user
  "failed", // extraction failed; user can retry or fill in by hand
]);
export type ExpenseStatus = z.infer<typeof ExpenseStatus>;

export const ALLOWED_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;
export type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number];
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/**
 * What a receipt extractor (Claude, Textract, ...) produces.
 * Every field is nullable rather than optional so the schema can be used
 * directly as a structured-output format.
 */
export const LineItemSchema = z.object({
  description: z.string(),
  quantity: z.number().nullable(),
  unit_price: z.number().nullable(),
  total: z.number().nullable(),
});
export type LineItem = z.infer<typeof LineItemSchema>;

export const ReceiptExtractionSchema = z.object({
  document_type: z.enum(["receipt", "invoice", "other"]),
  merchant: z.string().nullable(),
  merchant_address: z.string().nullable(),
  date: z.string().nullable().describe("Transaction date as YYYY-MM-DD"),
  currency: z.string().nullable().describe("ISO 4217 code, e.g. GBP"),
  total: z.number().nullable().describe("Grand total paid, including tax"),
  subtotal: z.number().nullable(),
  tax: z.number().nullable().describe("Total VAT/sales tax"),
  tip: z.number().nullable(),
  payment_method: z.string().nullable().describe("e.g. Visa, cash, Amex"),
  card_last4: z.string().nullable(),
  receipt_number: z.string().nullable(),
  vat_number: z.string().nullable(),
  category: z.string().nullable().describe("One of the user's categories"),
  company_hint: z
    .string()
    .nullable()
    .describe("One of the user's companies if the receipt clearly belongs to it"),
  project_hint: z
    .string()
    .nullable()
    .describe("One of the user's projects if the receipt clearly relates to it (e.g. a job reference)"),
  line_items: z.array(LineItemSchema),
  notes: z.string().nullable().describe("Anything notable, e.g. unreadable areas"),
  confidence: z.number().describe("0-1 overall confidence in the extraction"),
});
export type ReceiptExtraction = z.infer<typeof ReceiptExtractionSchema>;

export const ExtractionMetaSchema = z.object({
  provider: z.string(),
  model: z.string(),
  extractedAt: z.string(),
  durationMs: z.number(),
  confidence: z.number(),
  raw: ReceiptExtractionSchema,
});
export type ExtractionMeta = z.infer<typeof ExtractionMetaSchema>;

export const FileInfoSchema = z.object({
  key: z.string(),
  contentType: z.enum(ALLOWED_CONTENT_TYPES),
  size: z.number().int().nonnegative(),
  originalFilename: z.string(),
});
export type FileInfo = z.infer<typeof FileInfoSchema>;

export const ExpenseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  status: ExpenseStatus,
  archived: z.boolean(),
  date: z.string().nullable(),
  month: z.string().nullable(),
  year: z.string().nullable(),
  merchant: z.string().nullable(),
  company: z.string().nullable(),
  project: z.string().nullable().default(null),
  category: z.string().nullable(),
  currency: z.string().nullable(),
  total: z.number().nullable(),
  subtotal: z.number().nullable(),
  tax: z.number().nullable(),
  paymentMethod: z.string().nullable(),
  receiptNumber: z.string().nullable(),
  lineItems: z.array(LineItemSchema),
  notes: z.string().nullable(),
  file: FileInfoSchema,
  extraction: ExtractionMetaSchema.nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Expense = z.infer<typeof ExpenseSchema>;

/** Fields the user may edit directly. */
export const ExpenseEditableSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    merchant: z.string().max(200).nullable(),
    company: z.string().max(100).nullable(),
    project: z.string().max(100).nullable(),
    category: z.string().max(100).nullable(),
    currency: z.string().length(3).nullable(),
    total: z.number().nullable(),
    subtotal: z.number().nullable(),
    tax: z.number().nullable(),
    paymentMethod: z.string().max(100).nullable(),
    receiptNumber: z.string().max(100).nullable(),
    lineItems: z.array(LineItemSchema).max(200),
    notes: z.string().max(2000).nullable(),
    archived: z.boolean(),
    status: z.enum(["needs_review", "ready"]),
  })
  .partial();
export type ExpenseEdit = z.infer<typeof ExpenseEditableSchema>;

export const CreateExpenseRequestSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.enum(ALLOWED_CONTENT_TYPES),
  size: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  company: z.string().max(100).nullable().optional(),
  project: z.string().max(100).nullable().optional(),
  category: z.string().max(100).nullable().optional(),
});
export type CreateExpenseRequest = z.infer<typeof CreateExpenseRequestSchema>;

export const CreateExpenseResponseSchema = z.object({
  expense: ExpenseSchema,
  uploadUrl: z.string(),
  uploadHeaders: z.record(z.string(), z.string()),
});
export type CreateExpenseResponse = z.infer<typeof CreateExpenseResponseSchema>;

export const BulkActionSchema = z.object({
  ids: z.array(z.string()).min(1).max(200),
  action: z.discriminatedUnion("type", [
    z.object({ type: z.literal("archive") }),
    z.object({ type: z.literal("unarchive") }),
    z.object({ type: z.literal("delete") }),
    z.object({ type: z.literal("mark_ready") }),
    z.object({
      type: z.literal("move"),
      company: z.string().max(100).nullable().optional(),
      project: z.string().max(100).nullable().optional(),
      category: z.string().max(100).nullable().optional(),
    }),
  ]),
});
export type BulkAction = z.infer<typeof BulkActionSchema>;

export const ListExpensesQuerySchema = z.object({
  year: z.string().regex(/^\d{4}$/).optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  company: z.string().optional(),
  project: z.string().optional(),
  category: z.string().optional(),
  status: ExpenseStatus.optional(),
  archived: z.enum(["true", "false", "all"]).default("false"),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  cursor: z.string().optional(),
});
export type ListExpensesQuery = z.infer<typeof ListExpensesQuerySchema>;

export const ListExpensesResponseSchema = z.object({
  items: z.array(ExpenseSchema),
  cursor: z.string().nullable(),
});
export type ListExpensesResponse = z.infer<typeof ListExpensesResponseSchema>;

export const SettingsSchema = z.object({
  companies: z.array(z.string().min(1).max(100)).max(50),
  projects: z.array(z.string().min(1).max(100)).max(200).default([]),
  categories: z.array(z.string().min(1).max(100)).max(100),
  defaultCurrency: z.string().length(3),
  defaultCompany: z.string().max(100).nullable(),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const ReportTotalsSchema = z.object({
  count: z.number(),
  total: z.number(),
  tax: z.number(),
});
export type ReportTotals = z.infer<typeof ReportTotalsSchema>;

export const ReportSchema = z.object({
  year: z.string(),
  currency: z.string().nullable(),
  overall: ReportTotalsSchema,
  byMonth: z.record(z.string(), ReportTotalsSchema),
  byCompany: z.record(z.string(), ReportTotalsSchema),
  byProject: z.record(z.string(), ReportTotalsSchema),
  byCategory: z.record(z.string(), ReportTotalsSchema),
  byCompanyAndMonth: z.record(z.string(), z.record(z.string(), ReportTotalsSchema)),
  byProjectAndMonth: z.record(z.string(), z.record(z.string(), ReportTotalsSchema)),
  byCategoryAndMonth: z.record(z.string(), z.record(z.string(), ReportTotalsSchema)),
  otherCurrencies: z.record(z.string(), ReportTotalsSchema),
});
export type Report = z.infer<typeof ReportSchema>;
