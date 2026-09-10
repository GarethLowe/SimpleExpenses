import type { Settings } from "@simple-expenses/shared";

/**
 * Stable system prompt (cacheable). Anything user-specific goes in the user
 * turn so the prefix stays identical across requests.
 */
export const SYSTEM_PROMPT = `You extract structured data from photographs and PDFs of receipts and invoices for a personal expenses tracker.

Rules:
- Read the document carefully, including faint or skewed text. Prefer values printed on the document over guesses.
- "total" is the final amount actually paid, including tax, tip and service charges.
- "date" is the transaction date (not a due date or print date) in YYYY-MM-DD. Day-first order (DD/MM/YYYY) is the default for ambiguous numeric dates unless the document is clearly from the US.
- "currency" is the ISO 4217 code. Infer it from symbols, the merchant's country or the language when it is not printed.
- Pick "category" from the user's category list only; choose the closest match, or null if nothing fits.
- Set "company_hint" only when the document itself makes clear which of the user's companies it belongs to (for example the billing name). Otherwise null.
- If the document is not a receipt or invoice, set document_type to "other", leave amounts null and explain in notes.
- "confidence" is your honest 0-1 estimate that merchant, date and total are all correct.
- Never invent values. Use null for anything you cannot read.`;

export function userPrompt(settings: Settings): string {
  return [
    "Extract this receipt.",
    `User's categories: ${settings.categories.join("; ")}.`,
    `User's companies: ${settings.companies.join("; ")}.`,
    `Default currency if none can be determined: ${settings.defaultCurrency}.`,
  ].join("\n");
}
