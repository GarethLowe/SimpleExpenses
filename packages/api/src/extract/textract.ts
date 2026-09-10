import {
  AnalyzeExpenseCommand,
  TextractClient,
  type ExpenseDocument,
  type ExpenseField,
} from "@aws-sdk/client-textract";
import {
  categoriseByKeywords,
  detectCurrency,
  normaliseDate,
  parseAmount,
  type ExtractionMeta,
  type LineItem,
  type ReceiptExtraction,
} from "@simple-expenses/shared";
import { ExtractionError, type ExtractInput, type ReceiptExtractor } from "./types.js";

/**
 * Amazon Textract AnalyzeExpense. Purpose-built, no prompt, but no
 * categorisation, so we fall back to the keyword categoriser.
 */
export class TextractExtractor implements ReceiptExtractor {
  readonly provider = "textract";

  constructor(private readonly client: Pick<TextractClient, "send">) {}

  async extract(input: ExtractInput): Promise<ExtractionMeta> {
    const started = Date.now();
    let docs: ExpenseDocument[];
    try {
      const res = await this.client.send(
        new AnalyzeExpenseCommand({ Document: { S3Object: { Bucket: input.s3.bucket, Name: input.s3.key } } }),
      );
      docs = res.ExpenseDocuments ?? [];
    } catch (err) {
      const name = (err as { name?: string }).name ?? "";
      const retryable = ["ThrottlingException", "ProvisionedThroughputExceededException", "InternalServerError"].includes(name);
      throw new ExtractionError(`Textract failed: ${name || String(err)}`, retryable);
    }
    const raw = mapTextractDocuments(docs, input.settings.categories);
    return {
      provider: this.provider,
      model: "analyze-expense",
      extractedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      confidence: raw.confidence,
      raw,
    };
  }
}

/** Pure mapping from Textract's response to our extraction schema (exported for tests). */
export function mapTextractDocuments(docs: ExpenseDocument[], categories: readonly string[]): ReceiptExtraction {
  const doc = docs[0];
  const fields = doc?.SummaryFields ?? [];
  const get = (type: string): ExpenseField | undefined => fields.find((f) => f.Type?.Text === type);
  const text = (type: string): string | null => get(type)?.ValueDetection?.Text?.trim() || null;

  const merchant = text("VENDOR_NAME") ?? text("NAME");
  const totalField = get("TOTAL") ?? get("AMOUNT_PAID");
  const total = parseAmount(totalField?.ValueDetection?.Text);
  const currency =
    totalField?.Currency?.Code ??
    detectCurrency(totalField?.ValueDetection?.Text) ??
    detectCurrency(fields.map((f) => f.ValueDetection?.Text ?? "").join(" "));

  const confidences = fields
    .filter((f) => ["VENDOR_NAME", "TOTAL", "INVOICE_RECEIPT_DATE"].includes(f.Type?.Text ?? ""))
    .map((f) => (f.ValueDetection?.Confidence ?? 0) / 100);
  const confidence = confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0;

  const line_items: LineItem[] = [];
  for (const group of doc?.LineItemGroups ?? []) {
    for (const item of group.LineItems ?? []) {
      const f = (type: string) => item.LineItemExpenseFields?.find((x) => x.Type?.Text === type)?.ValueDetection?.Text;
      const description = f("ITEM") ?? f("PRODUCT_CODE") ?? f("EXPENSE_ROW");
      if (!description) continue;
      line_items.push({
        description: description.trim(),
        quantity: parseAmount(f("QUANTITY")),
        unit_price: parseAmount(f("UNIT_PRICE")),
        total: parseAmount(f("PRICE")),
      });
    }
  }

  const keywordText = [merchant, ...line_items.map((l) => l.description)].filter(Boolean).join(" ");
  return {
    document_type: docs.length ? "receipt" : "other",
    merchant,
    merchant_address: text("VENDOR_ADDRESS") ?? text("ADDRESS"),
    date: normaliseDate(text("INVOICE_RECEIPT_DATE")),
    currency: currency ?? null,
    total,
    subtotal: parseAmount(text("SUBTOTAL")),
    tax: parseAmount(text("TAX")),
    tip: parseAmount(text("GRATUITY")),
    payment_method: text("PAYMENT_TERMS"),
    card_last4: null,
    receipt_number: text("INVOICE_RECEIPT_ID"),
    vat_number: text("VENDOR_VAT_NUMBER") ?? text("TAX_PAYER_ID"),
    category: categoriseByKeywords(keywordText, categories),
    company_hint: null,
    project_hint: null,
    line_items,
    notes: docs.length ? null : "Textract found no expense document",
    confidence,
  };
}
