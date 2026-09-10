import { describe, expect, it } from "vitest";
import {
  dateSortKey,
  expenseIdFromSk,
  expenseSk,
  parseReceiptObjectKey,
  receiptObjectKey,
  userPk,
} from "./keys.js";

describe("keys", () => {
  it("builds table keys", () => {
    expect(userPk("abc")).toBe("USER#abc");
    expect(expenseSk("01H")).toBe("EXP#01H");
    expect(expenseIdFromSk("EXP#01H")).toBe("01H");
    expect(expenseIdFromSk("SETTINGS")).toBeNull();
  });

  it("rejects ids containing separators", () => {
    expect(() => userPk("a#b")).toThrow();
    expect(() => expenseSk("a/b")).toThrow();
    expect(() => userPk("")).toThrow();
  });

  it("sorts undated expenses first", () => {
    expect(dateSortKey(null, "x") < dateSortKey("2024-01-01", "x")).toBe(true);
    expect(dateSortKey("2024-01-01", "b")).toBe("2024-01-01#b");
  });

  it("round-trips object keys", () => {
    const key = receiptObjectKey("user1", "exp1", "image/jpeg");
    expect(key).toBe("users/user1/exp1/original.jpg");
    expect(parseReceiptObjectKey(key)).toEqual({ userId: "user1", expenseId: "exp1", filename: "original.jpg" });
    expect(parseReceiptObjectKey("other/thing")).toBeNull();
    expect(parseReceiptObjectKey("users/a/b")).toBeNull();
    expect(() => receiptObjectKey("u", "e", "text/plain")).toThrow();
  });
});
