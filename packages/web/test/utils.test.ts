import type { Expense } from "@simple-expenses/shared";
import { describe, expect, it } from "vitest";
import { groupByMonth, monthLabel, shortDate, yearsAround } from "../src/utils";

function e(p: Partial<Expense>): Expense {
  return {
    id: "x", userId: "u", status: "ready", archived: false, date: "2024-03-05", month: "2024-03", year: "2024",
    merchant: "M", company: "C", project: null, category: "T", currency: "GBP", total: 1, subtotal: null, tax: null, paymentMethod: null,
    receiptNumber: null, lineItems: [], notes: null, file: { key: "k", contentType: "image/jpeg", size: 1, originalFilename: "a.jpg", thumbnailKey: null },
    extraction: null, error: null, createdAt: "", updatedAt: "", ...p,
  };
}

describe("groupByMonth", () => {
  it("groups in input order and totals the dominant currency", () => {
    const groups = groupByMonth([
      e({ id: "1", total: 10 }),
      e({ id: "2", total: 5, currency: "EUR" }),
      e({ id: "3", total: 2.5 }),
      e({ id: "4", month: "2024-02", date: "2024-02-01", total: 7 }),
      e({ id: "5", month: null, date: null, total: 1 }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["March 2024", "February 2024", "No date"]);
    expect(groups[0]).toMatchObject({ total: 12.5, currency: "GBP" });
    expect(groups[0]!.items).toHaveLength(3);
  });
});

describe("formatting", () => {
  it("labels months and dates", () => {
    expect(monthLabel("2024-12")).toBe("December 2024");
    expect(monthLabel(null)).toBe("No date");
    expect(shortDate("2024-03-05")).toBe("05/03/2024");
    expect(yearsAround("2024", 2)).toEqual(["2025", "2024", "2023", "2022"]);
  });
});
