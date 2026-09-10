import { describe, expect, it } from "vitest";
import { categoriseByKeywords, matchToList } from "./categories.js";

describe("categoriseByKeywords", () => {
  it("maps merchants to categories", () => {
    expect(categoriseByKeywords("Shell Service Station")).toBe("Fuel");
    expect(categoriseByKeywords("Premier Inn London")).toBe("Accommodation");
    expect(categoriseByKeywords("Costa Coffee")).toBe("Meals");
    expect(categoriseByKeywords("Tesco Express")).toBe("Groceries");
    expect(categoriseByKeywords("Unknown Ltd")).toBeNull();
  });

  it("only returns allowed categories", () => {
    expect(categoriseByKeywords("Shell", ["Meals"])).toBeNull();
  });
});

describe("matchToList", () => {
  const list = ["Meals", "Software & Subscriptions", "Travel"];
  it("matches exactly ignoring case and punctuation", () => {
    expect(matchToList("meals", list)).toBe("Meals");
    expect(matchToList("software and subscriptions", list)).toBeNull(); // 'and' vs '&' differ, no contains match
    expect(matchToList("Software & subscriptions ", list)).toBe("Software & Subscriptions");
  });
  it("falls back to contains", () => {
    expect(matchToList("Business travel", list)).toBe("Travel");
    expect(matchToList("Software", list)).toBe("Software & Subscriptions");
    expect(matchToList("Nothing", list)).toBeNull();
    expect(matchToList(null, list)).toBeNull();
  });
});
