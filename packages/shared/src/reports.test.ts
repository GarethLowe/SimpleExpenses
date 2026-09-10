import { describe, expect, it } from "vitest";
import { buildReport, expensesToCsv } from "./reports.js";
import type { Expense } from "./schemas.js";

function exp(partial: Partial<Expense>): Expense {
  const date = partial.date ?? "2024-03-05";
  return {
    id: partial.id ?? Math.random().toString(36).slice(2),
    userId: "u",
    status: "ready",
    archived: false,
    date,
    month: date.slice(0, 7),
    year: date.slice(0, 4),
    merchant: "M",
    company: "Acme",
    project: null,
    category: "Meals",
    currency: "GBP",
    total: 10,
    subtotal: null,
    tax: 2,
    paymentMethod: null,
    receiptNumber: null,
    lineItems: [],
    notes: null,
    file: { key: "k", contentType: "image/jpeg", size: 1, originalFilename: "a.jpg" },
    extraction: null,
    error: null,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...partial,
  };
}

describe("buildReport", () => {
  it("aggregates by month, company and category", () => {
    const r = buildReport("2024", [
      exp({ total: 10, tax: 2 }),
      exp({ total: 5.5, tax: 1.1, category: "Travel", date: "2024-04-01" }),
      exp({ total: 100, company: "Other", project: "Site A", date: "2024-04-02" }),
      exp({ total: 999, archived: true }),
      exp({ total: 999, date: "2023-12-31" }),
      exp({ total: 7, currency: "EUR" }),
    ]);
    expect(r.currency).toBe("GBP");
    expect(r.overall).toEqual({ count: 3, total: 115.5, tax: 5.1 });
    expect(r.byMonth["2024-03"]).toEqual({ count: 1, total: 10, tax: 2 });
    expect(r.byMonth["2024-04"]).toEqual({ count: 2, total: 105.5, tax: 3.1 });
    expect(r.byMonth["2024-01"]).toEqual({ count: 0, total: 0, tax: 0 });
    expect(r.byCompany["Acme"]?.total).toBe(15.5);
    expect(r.byCompany["Other"]?.total).toBe(100);
    expect(r.byCategory["Travel"]?.count).toBe(1);
    expect(r.byProject["Site A"]?.total).toBe(100);
    expect(r.byProject["No project"]?.count).toBe(2);
    expect(r.byProjectAndMonth["Site A"]?.["2024-04"]?.count).toBe(1);
    expect(r.byCompanyAndMonth["Acme"]?.["2024-04"]?.total).toBe(5.5);
    expect(r.otherCurrencies["EUR"]).toEqual({ count: 1, total: 7, tax: 2 });
  });

  it("handles an empty year", () => {
    const r = buildReport("2024", []);
    expect(r.currency).toBeNull();
    expect(r.overall.count).toBe(0);
  });
});

describe("expensesToCsv", () => {
  it("quotes fields containing commas and quotes", () => {
    const csv = expensesToCsv([exp({ id: "1", merchant: 'Bob "The" Builder, Ltd', notes: "line\nbreak" })]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toMatch(/^id,date,merchant,company,project,category/);
    expect(lines[1]).toContain('"Bob ""The"" Builder, Ltd"');
    expect(csv).toContain('"line\nbreak"');
  });
});
