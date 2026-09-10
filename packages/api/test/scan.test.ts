import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { SQSRecord } from "aws-lambda";
import { beforeEach, describe, expect, it } from "vitest";
import { ExtractionError, type ReceiptExtractor } from "../src/extract/index.js";
import { processRecords, targetsFromRecord } from "../src/handlers/scan.js";
import { ExpensesRepo } from "../src/lib/repo.js";
import { ReceiptStorage } from "../src/lib/storage.js";
import { USER, expense, mockAwsClient, settings, stored } from "./fixtures.js";

const ddb = mockAwsClient(DynamoDBDocumentClient);
const s3 = mockAwsClient(S3Client);

function deps(extractor: ReceiptExtractor | null) {
  return {
    repo: new ExpensesRepo(DynamoDBDocumentClient.from(new DynamoDBClient({ region: "eu-west-2" })), "t"),
    storage: new ReceiptStorage(new S3Client({ region: "eu-west-2" }), "bucket"),
    extractor,
    now: () => new Date("2024-03-06T00:00:00Z"),
  };
}

function sqsRecord(body: unknown, id = "m1"): SQSRecord {
  return { messageId: id, body: JSON.stringify(body) } as SQSRecord;
}

const s3Notification = (key: string) => ({ Records: [{ s3: { object: { key } } }] });

const okExtractor: ReceiptExtractor = {
  provider: "fake",
  extract: async () => ({
    provider: "fake",
    model: "m",
    extractedAt: "x",
    durationMs: 1,
    confidence: 0.9,
    raw: {
      document_type: "receipt", merchant: "Costa", merchant_address: null, date: "2024-03-05", currency: "GBP", total: 3.5,
      subtotal: null, tax: null, tip: null, payment_method: null, card_last4: null, receipt_number: null, vat_number: null,
      category: "Meals", company_hint: null, project_hint: null, line_items: [], notes: null, confidence: 0.9,
    },
  }),
};

beforeEach(() => {
  ddb.reset();
  s3.reset();
  ddb.on(GetCommand, { Key: { PK: `USER#${USER}`, SK: "SETTINGS" } }).resolves({ Item: settings });
  ddb.on(GetCommand, { Key: { PK: `USER#${USER}`, SK: "EXP#01EXP" } }).resolves({ Item: stored(expense({ status: "uploading", merchant: null, total: null, date: null, month: null, year: null, category: null })) });
  ddb.on(PutCommand).resolves({});
  s3.on(HeadObjectCommand).resolves({ ContentLength: 999 });
  s3.on(GetObjectCommand).resolves({ Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } as never, ContentLength: 3 });
});

describe("targetsFromRecord", () => {
  it("parses S3 notifications and rescan messages, ignoring the rest", () => {
    expect(targetsFromRecord(sqsRecord(s3Notification(`users/${USER}/01EXP/original.jpg`)))).toEqual([{ userId: USER, expenseId: "01EXP" }]);
    expect(targetsFromRecord(sqsRecord(s3Notification("users/u%2B1/e/original.jpg")))).toEqual([{ userId: "u+1", expenseId: "e" }]);
    expect(targetsFromRecord(sqsRecord({ type: "rescan", userId: "u", expenseId: "e" }))).toEqual([{ userId: "u", expenseId: "e" }]);
    expect(targetsFromRecord(sqsRecord(s3Notification(`users/${USER}/01EXP/thumb.jpg`)))).toEqual([]);
    expect(targetsFromRecord(sqsRecord({ Event: "s3:TestEvent" }))).toEqual([]);
    expect(targetsFromRecord(sqsRecord(s3Notification("somewhere/else")))).toEqual([]);
    expect(targetsFromRecord({ messageId: "x", body: "not json" } as SQSRecord)).toEqual([]);
  });
});

describe("processRecords", () => {
  it("marks scanning then needs_review with extracted data", async () => {
    const res = await processRecords([sqsRecord(s3Notification(`users/${USER}/01EXP/original.jpg`))], deps(okExtractor));
    expect(res.batchItemFailures).toEqual([]);
    const puts = ddb.commandCalls(PutCommand).map((c) => c.args[0].input.Item);
    expect(puts[0]).toMatchObject({ status: "scanning", file: { size: 999 } });
    expect(puts[1]).toMatchObject({ status: "needs_review", merchant: "Costa", total: 3.5, category: "Meals", GSI1SK: "2024-03-05#01EXP" });
  });

  it("records non-retryable failures on the expense", async () => {
    const failing: ReceiptExtractor = { provider: "f", extract: async () => { throw new ExtractionError("bad doc", false); } };
    const res = await processRecords([sqsRecord(s3Notification(`users/${USER}/01EXP/original.jpg`))], deps(failing));
    expect(res.batchItemFailures).toEqual([]);
    const last = ddb.commandCalls(PutCommand).at(-1)!.args[0].input.Item;
    expect(last).toMatchObject({ status: "failed", error: "bad doc" });
  });

  it("drops cached credentials on an auth failure", async () => {
    const bad: ReceiptExtractor = { provider: "f", extract: async () => { throw new ExtractionError("401", false, "auth"); } };
    let reset = 0;
    const res = await processRecords([sqsRecord({ type: "rescan", userId: USER, expenseId: "01EXP" })], { ...deps(bad), onAuthError: () => reset++ });
    expect(res.batchItemFailures).toEqual([]);
    expect(reset).toBe(1);
    expect(ddb.commandCalls(PutCommand).at(-1)!.args[0].input.Item).toMatchObject({ status: "failed", error: "401" });
  });

  it("reports retryable failures back to SQS", async () => {
    const flaky: ReceiptExtractor = { provider: "f", extract: async () => { throw new ExtractionError("429", true); } };
    const res = await processRecords([sqsRecord(s3Notification(`users/${USER}/01EXP/original.jpg`), "m9")], deps(flaky));
    expect(res.batchItemFailures).toEqual([{ itemIdentifier: "m9" }]);
  });

  it("skips to needs_review when no extractor is configured", async () => {
    await processRecords([sqsRecord({ type: "rescan", userId: USER, expenseId: "01EXP" })], deps(null));
    const last = ddb.commandCalls(PutCommand).at(-1)!.args[0].input.Item;
    expect(last).toMatchObject({ status: "needs_review" });
  });

  it("ignores objects without a record or a file", async () => {
    ddb.on(GetCommand, { Key: { PK: `USER#${USER}`, SK: "EXP#missing" } }).resolves({});
    s3.on(HeadObjectCommand).rejects(Object.assign(new Error("nf"), { name: "NotFound" }));
    const res = await processRecords([
      sqsRecord({ type: "rescan", userId: USER, expenseId: "missing" }),
      sqsRecord({ type: "rescan", userId: USER, expenseId: "01EXP" }, "m2"),
    ], deps(okExtractor));
    expect(res.batchItemFailures).toEqual([]);
    expect(ddb.commandCalls(PutCommand)).toHaveLength(0);
  });

  it("fails oversized files without calling the extractor", async () => {
    s3.on(HeadObjectCommand).resolves({ ContentLength: 100 * 1024 * 1024 });
    await processRecords([sqsRecord({ type: "rescan", userId: USER, expenseId: "01EXP" })], deps(okExtractor));
    const last = ddb.commandCalls(PutCommand).at(-1)!.args[0].input.Item;
    expect(last).toMatchObject({ status: "failed" });
    expect((last as { error: string }).error).toMatch(/too large/);
  });
});
