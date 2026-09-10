/**
 * Parse an amount string as found on receipts ("£1,234.56", "1.234,56 €",
 * "(12.34)", "12.34-", "USD 5") into a number. Returns null when unparseable.
 */
export function parseAmount(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") return Number.isFinite(input) ? round2(input) : null;
  let s = input.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (/-\s*$/.test(s)) {
    negative = true;
    s = s.replace(/-\s*$/, "");
  }
  if (/^\s*-/.test(s)) {
    negative = true;
    s = s.replace(/^\s*-/, "");
  }
  // keep digits and separators only
  const cleaned = s.replace(/[^\d.,]/g, "");
  if (!cleaned) return null;
  const lastDot = cleaned.lastIndexOf(".");
  const lastComma = cleaned.lastIndexOf(",");
  let normalised: string;
  if (lastDot >= 0 && lastComma >= 0) {
    // whichever comes last is the decimal separator
    normalised =
      lastDot > lastComma
        ? cleaned.replace(/,/g, "")
        : cleaned.replace(/\./g, "").replace(",", ".");
  } else if (lastComma >= 0) {
    // "12,34" -> decimal; "1,234" -> thousands (exactly 3 digits after comma and only one comma)
    const parts = cleaned.split(",");
    const isThousands = parts.length > 1 && parts.slice(1).every((p) => p.length === 3);
    normalised = isThousands ? cleaned.replace(/,/g, "") : cleaned.replace(/,/g, ".");
  } else {
    const parts = cleaned.split(".");
    const isThousands = parts.length > 2 && parts.slice(1).every((p) => p.length === 3);
    normalised = isThousands ? cleaned.replace(/\./g, "") : cleaned;
  }
  const n = Number(normalised);
  if (!Number.isFinite(n)) return null;
  return round2(negative ? -n : n);
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  "£": "GBP",
  "€": "EUR",
  $: "USD",
  "¥": "JPY",
  "₹": "INR",
  "₩": "KRW",
  "₪": "ILS",
  "₺": "TRY",
  "zł": "PLN",
  kr: "SEK",
  "R$": "BRL",
  "A$": "AUD",
  "C$": "CAD",
};

/** Guess an ISO 4217 code from free text such as "£12.34" or "Total EUR 5". */
export function detectCurrency(text: string | null | undefined): string | null {
  if (!text) return null;
  const iso = /\b(GBP|EUR|USD|AUD|CAD|NZD|CHF|JPY|SEK|NOK|DKK|PLN|CZK|HUF|INR|ZAR|SGD|HKD|AED|BRL|MXN)\b/i.exec(text);
  if (iso) return iso[1]!.toUpperCase();
  for (const [symbol, code] of Object.entries(CURRENCY_SYMBOLS)) {
    if (text.includes(symbol)) return code;
  }
  return null;
}

export function formatMoney(amount: number | null | undefined, currency: string | null | undefined, locale = "en-GB"): string {
  if (amount === null || amount === undefined) return "—";
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: currency ?? "GBP" }).format(amount);
  } catch {
    return `${currency ?? ""} ${amount.toFixed(2)}`.trim();
  }
}
