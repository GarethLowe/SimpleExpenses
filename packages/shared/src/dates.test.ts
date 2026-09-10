import { describe, expect, it } from "vitest";
import { isIsoDate, monthOf, normaliseDate, yearOf } from "./dates.js";

describe("dates", () => {
  it("validates ISO dates", () => {
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2023-02-29")).toBe(false);
    expect(isIsoDate("2024-13-01")).toBe(false);
    expect(isIsoDate("24-01-01")).toBe(false);
  });

  it("derives month and year", () => {
    expect(monthOf("2024-03-05")).toBe("2024-03");
    expect(yearOf("2024-03-05")).toBe("2024");
    expect(monthOf(null)).toBeNull();
    expect(yearOf("garbage")).toBeNull();
  });

  it("normalises common receipt formats (day-first by default)", () => {
    expect(normaliseDate("05/03/2024")).toBe("2024-03-05");
    expect(normaliseDate("5.3.24")).toBe("2024-03-05");
    expect(normaliseDate("2024/03/05 10:22")).toBe("2024-03-05");
    expect(normaliseDate("2024-03-05T10:22:00Z")).toBe("2024-03-05");
    expect(normaliseDate("5 Mar 2024")).toBe("2024-03-05");
    expect(normaliseDate("05 March 24")).toBe("2024-03-05");
    expect(normaliseDate("March 5, 2024")).toBe("2024-03-05");
    expect(normaliseDate("13/02/2024")).toBe("2024-02-13");
    expect(normaliseDate("02/13/2024")).toBe("2024-02-13"); // first number can't be a month
  });

  it("honours monthFirst", () => {
    expect(normaliseDate("03/05/2024", { monthFirst: true })).toBe("2024-03-05");
  });

  it("returns null for junk", () => {
    expect(normaliseDate("")).toBeNull();
    expect(normaliseDate("no date here")).toBeNull();
    expect(normaliseDate("31/02/2024")).toBeNull();
  });
});
