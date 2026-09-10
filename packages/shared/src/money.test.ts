import { describe, expect, it } from "vitest";
import { detectCurrency, formatMoney, parseAmount } from "./money.js";

describe("parseAmount", () => {
  it("parses common formats", () => {
    expect(parseAmount("£1,234.56")).toBe(1234.56);
    expect(parseAmount("1.234,56 €")).toBe(1234.56);
    expect(parseAmount("12,34")).toBe(12.34);
    expect(parseAmount("1,234")).toBe(1234);
    expect(parseAmount("1.234.567")).toBe(1234567);
    expect(parseAmount("USD 5")).toBe(5);
    expect(parseAmount(" 7.5 ")).toBe(7.5);
    expect(parseAmount(3.14159)).toBe(3.14);
  });

  it("handles negatives", () => {
    expect(parseAmount("(12.34)")).toBe(-12.34);
    expect(parseAmount("12.34-")).toBe(-12.34);
    expect(parseAmount("-£5.00")).toBe(-5);
  });

  it("returns null for junk", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount(null)).toBeNull();
    expect(parseAmount(Number.NaN)).toBeNull();
  });
});

describe("detectCurrency", () => {
  it("finds ISO codes and symbols", () => {
    expect(detectCurrency("Total GBP 12.00")).toBe("GBP");
    expect(detectCurrency("€ 4,50")).toBe("EUR");
    expect(detectCurrency("$9.99")).toBe("USD");
    expect(detectCurrency("nothing")).toBeNull();
  });
});

describe("formatMoney", () => {
  it("formats with currency", () => {
    expect(formatMoney(12.5, "GBP")).toBe("£12.50");
    expect(formatMoney(null, "GBP")).toBe("—");
  });
});
