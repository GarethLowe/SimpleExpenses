import { describe, expect, it } from "vitest";
import { applyExtraction, isConfident, mapTextractDocuments } from "../src/extract/index.js";
import { ClaudeExtractor } from "../src/extract/claude.js";
import type { ExtractionMeta, ReceiptExtraction } from "@simple-expenses/shared";
import { expense, settings } from "./fixtures.js";

function raw(partial: Partial<ReceiptExtraction> = {}): ReceiptExtraction {
  return {
    document_type: "receipt",
    merchant: "Pret A Manger",
    merchant_address: null,
    date: "2024-03-05",
    currency: "gbp",
    total: 7.85,
    subtotal: 6.54,
    tax: 1.31,
    tip: null,
    payment_method: "Visa",
    card_last4: "1234",
    receipt_number: "R-1",
    vat_number: null,
    category: "meals",
    company_hint: "acme ltd",
    line_items: [{ description: "Latte", quantity: 1, unit_price: 3.3, total: 3.3 }],
    notes: null,
    confidence: 0.95,
    ...partial,
  };
}

function meta(r: ReceiptExtraction): ExtractionMeta {
  return { provider: "anthropic", model: "m", extractedAt: "2024-03-05T00:00:00Z", durationMs: 1, confidence: r.confidence, raw: r };
}

describe("applyExtraction", () => {
  const base = expense({ status: "scanning", merchant: null, company: null, category: null, date: null, month: null, year: null, total: null });

  it("fills the record and matches category/company to the user's lists", () => {
    const r = raw();
    const e = applyExtraction(base, meta(r), settings, new Date("2024-03-06T00:00:00Z"));
    expect(e).toMatchObject({
      status: "needs_review",
      merchant: "Pret A Manger",
      date: "2024-03-05",
      month: "2024-03",
      year: "2024",
      currency: "GBP",
      total: 7.85,
      tax: 1.31,
      category: "Meals",
      company: "Acme Ltd",
      paymentMethod: "Visa",
      receiptNumber: "R-1",
      updatedAt: "2024-03-06T00:00:00.000Z",
    });
    expect(e.extraction?.raw).toEqual(r);
    expect(isConfident(e)).toBe(true);
  });

  it("keeps values the user already set", () => {
    const e = applyExtraction({ ...base, company: "Personal", category: "Travel" }, meta(raw()), settings);
    expect(e.company).toBe("Personal");
    expect(e.category).toBe("Travel");
  });

  it("falls back to keyword categorisation and the default company", () => {
    const e = applyExtraction(base, meta(raw({ category: "Nonsense", company_hint: null, merchant: "Trainline" })), settings);
    expect(e.category).toBe("Travel");
    expect(e.company).toBe("Personal");
  });

  it("normalises odd dates and bad currencies", () => {
    const e = applyExtraction(base, meta(raw({ date: "05/03/2024", currency: "pounds" })), settings);
    expect(e.date).toBe("2024-03-05");
    expect(e.currency).toBe("GBP");
  });

  it("is not confident when key fields are missing or confidence is low", () => {
    expect(isConfident(applyExtraction(base, meta(raw({ total: null })), settings))).toBe(false);
    expect(isConfident(applyExtraction(base, meta(raw({ confidence: 0.4 })), settings))).toBe(false);
  });
});

describe("mapTextractDocuments", () => {
  it("maps summary fields and line items", () => {
    const r = mapTextractDocuments(
      [
        {
          SummaryFields: [
            { Type: { Text: "VENDOR_NAME" }, ValueDetection: { Text: "Shell Garage", Confidence: 98 } },
            { Type: { Text: "TOTAL" }, ValueDetection: { Text: "£45.10", Confidence: 96 }, Currency: { Code: "GBP" } },
            { Type: { Text: "INVOICE_RECEIPT_DATE" }, ValueDetection: { Text: "05/03/2024", Confidence: 90 } },
            { Type: { Text: "TAX" }, ValueDetection: { Text: "7.52", Confidence: 90 } },
          ],
          LineItemGroups: [
            {
              LineItems: [
                {
                  LineItemExpenseFields: [
                    { Type: { Text: "ITEM" }, ValueDetection: { Text: "Unleaded" } },
                    { Type: { Text: "QUANTITY" }, ValueDetection: { Text: "30.5" } },
                    { Type: { Text: "PRICE" }, ValueDetection: { Text: "45.10" } },
                  ],
                },
              ],
            },
          ],
        },
      ],
      settings.categories.concat("Fuel"),
    );
    expect(r).toMatchObject({
      merchant: "Shell Garage",
      total: 45.1,
      currency: "GBP",
      date: "2024-03-05",
      tax: 7.52,
      category: "Fuel",
      line_items: [{ description: "Unleaded", quantity: 30.5, total: 45.1, unit_price: null }],
    });
    expect(r.confidence).toBeCloseTo(0.9467, 3);
  });

  it("reports no document", () => {
    const r = mapTextractDocuments([], settings.categories);
    expect(r.document_type).toBe("other");
    expect(r.confidence).toBe(0);
  });
});

describe("ClaudeExtractor", () => {
  const input = (contentType: string, size = 10) => ({
    bytes: Buffer.alloc(size, 1),
    contentType,
    s3: { bucket: "b", key: "k" },
    settings,
  });

  it("sends an image block plus structured output and returns the parsed result", async () => {
    const calls: unknown[] = [];
    const client = {
      messages: {
        parse: async (params: unknown) => {
          calls.push(params);
          return { model: "claude-opus-5", stop_reason: "end_turn", parsed_output: raw() };
        },
      },
    };
    const ex = new ClaudeExtractor({ client: client as never, model: "claude-opus-5", effort: "low", provider: "anthropic" });
    const meta = await ex.extract(input("image/jpeg"));
    expect(meta).toMatchObject({ provider: "anthropic", model: "claude-opus-5", confidence: 0.95 });
    const params = calls[0] as { model: string; output_config: { effort: string; format: { type: string } }; messages: Array<{ content: Array<{ type: string }> }> };
    expect(params.model).toBe("claude-opus-5");
    expect(params.output_config.effort).toBe("low");
    expect(params.output_config.format.type).toBe("json_schema");
    expect(params.messages[0]!.content[0]!.type).toBe("image");
    expect(params.messages[0]!.content[1]!.type).toBe("text");
  });

  it("uses a document block for PDFs", async () => {
    let block: { type: string } | undefined;
    const client = { messages: { parse: async (p: { messages: Array<{ content: Array<{ type: string }> }> }) => { block = p.messages[0]!.content[0]; return { model: "m", stop_reason: "end_turn", parsed_output: raw() }; } } };
    const ex = new ClaudeExtractor({ client: client as never, model: "m", effort: "medium", provider: "bedrock" });
    await ex.extract(input("application/pdf"));
    expect(block?.type).toBe("document");
  });

  it("fails non-retryably on refusal, schema mismatch and oversized images", async () => {
    const mk = (res: unknown) => new ClaudeExtractor({ client: { messages: { parse: async () => res } } as never, model: "m", effort: "low", provider: "anthropic" });
    await expect(mk({ model: "m", stop_reason: "refusal", parsed_output: null }).extract(input("image/png"))).rejects.toMatchObject({ retryable: false });
    await expect(mk({ model: "m", stop_reason: "end_turn", parsed_output: null }).extract(input("image/png"))).rejects.toMatchObject({ retryable: false });
    await expect(mk({}).extract(input("image/png", 6 * 1024 * 1024))).rejects.toThrow(/5 MB/);
  });
});
