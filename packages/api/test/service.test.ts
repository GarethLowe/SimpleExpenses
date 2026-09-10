import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { beforeEach, describe, expect, it } from "vitest";
import { route } from "../src/handlers/http.js";
import { ExpensesRepo } from "../src/lib/repo.js";
import { ExpensesService, applyEdit } from "../src/lib/service.js";
import { ReceiptStorage } from "../src/lib/storage.js";
import { USER, event, expense, mockAwsClient, settings, stored } from "./fixtures.js";

const ddb = mockAwsClient(DynamoDBDocumentClient);
const s3 = mockAwsClient(S3Client);
const sqs = mockAwsClient(SQSClient);

function makeService() {
  const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "eu-west-2" }));
  return new ExpensesService({
    repo: new ExpensesRepo(doc, "t"),
    storage: new ReceiptStorage(new S3Client({ region: "eu-west-2" }), "bucket"),
    sqs: new SQSClient({ region: "eu-west-2" }),
    scanQueueUrl: "https://sqs/queue",
    now: () => new Date("2024-04-01T00:00:00.000Z"),
    newId: () => "NEWID",
  });
}

beforeEach(() => {
  ddb.reset();
  s3.reset();
  sqs.reset();
  ddb.on(GetCommand, { Key: { PK: `USER#${USER}`, SK: "SETTINGS" } }).resolves({ Item: settings });
});

describe("route auth", () => {
  it("rejects requests without a sub claim", async () => {
    const res = await route(makeService(), event("GET /settings", { sub: null }));
    expect(res).toMatchObject({ statusCode: 401 });
  });

  it("404s unknown routes", async () => {
    const res = await route(makeService(), event("GET /nope"));
    expect(res).toMatchObject({ statusCode: 404 });
  });
});

describe("POST /expenses", () => {
  it("creates an uploading record scoped to the user and returns a presigned URL", async () => {
    ddb.on(PutCommand).resolves({});
    const res = await route(
      makeService(),
      event("POST /expenses", { body: { filename: "r.jpg", contentType: "image/jpeg", size: 100 } }),
    );
    expect(res).toMatchObject({ statusCode: 201 });
    const body = JSON.parse((res as { body: string }).body);
    expect(body.expense).toMatchObject({
      id: "NEWID",
      userId: USER,
      status: "uploading",
      company: "Personal",
      file: { key: `users/${USER}/NEWID/original.jpg`, contentType: "image/jpeg" },
    });
    expect(body.uploadUrl).toContain(`users/${USER}/NEWID/original.jpg`);
    expect(body.uploadHeaders).toEqual({ "Content-Type": "image/jpeg" });
    const put = ddb.commandCalls(PutCommand)[0]!.args[0].input;
    expect(put.Item).toMatchObject({ PK: `USER#${USER}`, SK: "EXP#NEWID", GSI1SK: "0000-00-00#NEWID" });
  });

  it("rejects unsupported content types", async () => {
    const res = await route(
      makeService(),
      event("POST /expenses", { body: { filename: "r.gif", contentType: "image/gif", size: 100 } }),
    );
    expect(res).toMatchObject({ statusCode: 400 });
    expect(ddb.commandCalls(PutCommand)).toHaveLength(0);
  });
});

describe("GET /expenses", () => {
  it("queries GSI1 by month with filters and strips key attributes", async () => {
    ddb.on(QueryCommand).resolves({ Items: [stored(expense())] });
    const res = await route(makeService(), event("GET /expenses", { query: { month: "2024-03", company: "Personal", project: "Site A" } }));
    expect(res).toMatchObject({ statusCode: 200 });
    const body = JSON.parse((res as { body: string }).body);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).not.toHaveProperty("PK");
    expect(body.cursor).toBeNull();
    const input = ddb.commandCalls(QueryCommand)[0]!.args[0].input;
    expect(input.IndexName).toBe("GSI1");
    expect(input.KeyConditionExpression).toContain("begins_with(#sk, :prefix)");
    expect(input.ExpressionAttributeValues).toMatchObject({ ":pk": `USER#${USER}`, ":prefix": "2024-03", ":company": "Personal", ":project": "Site A", ":archived": false });
    expect(input.FilterExpression).toBe("#archived = :archived AND #company = :company AND #project = :project");
  });

  it("returns a cursor when the page is full", async () => {
    ddb.on(QueryCommand).resolves({ Items: [stored(expense({ id: "A" })), stored(expense({ id: "B" }))], LastEvaluatedKey: { PK: "x", SK: "y" } });
    const res = await route(makeService(), event("GET /expenses", { query: { limit: "2" } }));
    const body = JSON.parse((res as { body: string }).body);
    expect(body.items.map((i: { id: string }) => i.id)).toEqual(["A", "B"]);
    expect(body.cursor).toBeTypeOf("string");
    const decoded = JSON.parse(Buffer.from(body.cursor, "base64url").toString());
    expect(decoded).toMatchObject({ SK: "EXP#B" });
  });

  it("rejects a bad cursor", async () => {
    const res = await route(makeService(), event("GET /expenses", { query: { cursor: "zzz" } }));
    expect(res).toMatchObject({ statusCode: 400 });
  });
});

describe("PATCH /expenses/{id}", () => {
  it("recategorises and marks reviewed records ready", async () => {
    ddb.on(GetCommand, { Key: { PK: `USER#${USER}`, SK: "EXP#01EXP" } }).resolves({ Item: stored(expense()) });
    ddb.on(PutCommand).resolves({});
    const res = await route(makeService(), event("PATCH /expenses/{id}", { path: { id: "01EXP" }, body: { category: "Travel", date: "2024-05-01" } }));
    expect(res).toMatchObject({ statusCode: 200 });
    const body = JSON.parse((res as { body: string }).body);
    expect(body).toMatchObject({ category: "Travel", date: "2024-05-01", month: "2024-05", year: "2024", status: "ready" });
    const put = ddb.commandCalls(PutCommand)[0]!.args[0].input;
    expect(put.ConditionExpression).toBe("attribute_exists(PK)");
    expect(put.Item).toMatchObject({ GSI1SK: "2024-05-01#01EXP" });
  });

  it("404s for another user's expense", async () => {
    ddb.on(GetCommand, { Key: { PK: `USER#${USER}`, SK: "EXP#01EXP" } }).resolves({});
    const res = await route(makeService(), event("PATCH /expenses/{id}", { path: { id: "01EXP" }, body: { archived: true } }));
    expect(res).toMatchObject({ statusCode: 404 });
  });

  it("validates the body", async () => {
    const res = await route(makeService(), event("PATCH /expenses/{id}", { path: { id: "01EXP" }, body: { date: "5/3/2024" } }));
    expect(res).toMatchObject({ statusCode: 400 });
  });
});

describe("applyEdit", () => {
  it("archiving alone does not change status", () => {
    const e = applyEdit(expense({ status: "needs_review" }), { archived: true }, new Date());
    expect(e.status).toBe("needs_review");
    expect(e.archived).toBe(true);
  });
  it("refuses to mark an unuploaded expense ready", () => {
    expect(() => applyEdit(expense({ status: "uploading" }), { status: "ready" }, new Date())).toThrow();
  });
});

describe("DELETE /expenses/{id}", () => {
  it("removes the S3 object and the row", async () => {
    ddb.on(GetCommand, { Key: { PK: `USER#${USER}`, SK: "EXP#01EXP" } }).resolves({ Item: stored(expense()) });
    ddb.on(DeleteCommand).resolves({});
    s3.on(DeleteObjectCommand).resolves({});
    const res = await route(makeService(), event("DELETE /expenses/{id}", { path: { id: "01EXP" } }));
    expect(res).toMatchObject({ statusCode: 204 });
    expect(s3.commandCalls(DeleteObjectCommand)[0]!.args[0].input).toEqual({ Bucket: "bucket", Key: `users/${USER}/01EXP/original.jpg` });
    expect(ddb.commandCalls(DeleteCommand)).toHaveLength(1);
  });
});

describe("POST /expenses/{id}/rescan", () => {
  it("queues a rescan when the file exists", async () => {
    ddb.on(GetCommand, { Key: { PK: `USER#${USER}`, SK: "EXP#01EXP" } }).resolves({ Item: stored(expense({ status: "failed", error: "boom" })) });
    ddb.on(PutCommand).resolves({});
    s3.on(HeadObjectCommand).resolves({ ContentLength: 10 });
    sqs.on(SendMessageCommand).resolves({});
    const res = await route(makeService(), event("POST /expenses/{id}/rescan", { path: { id: "01EXP" } }));
    expect(res).toMatchObject({ statusCode: 202 });
    expect(JSON.parse((res as { body: string }).body)).toMatchObject({ status: "scanning", error: null });
    expect(JSON.parse(sqs.commandCalls(SendMessageCommand)[0]!.args[0].input.MessageBody!)).toEqual({ type: "rescan", userId: USER, expenseId: "01EXP" });
  });

  it("400s when the file was never uploaded", async () => {
    ddb.on(GetCommand, { Key: { PK: `USER#${USER}`, SK: "EXP#01EXP" } }).resolves({ Item: stored(expense({ status: "uploading" })) });
    s3.on(HeadObjectCommand).rejects(Object.assign(new Error("nf"), { name: "NotFound" }));
    const res = await route(makeService(), event("POST /expenses/{id}/rescan", { path: { id: "01EXP" } }));
    expect(res).toMatchObject({ statusCode: 400 });
  });
});

describe("POST /expenses/bulk", () => {
  it("moves and archives, reporting missing ids", async () => {
    ddb.on(GetCommand, { Key: { PK: `USER#${USER}`, SK: "EXP#A" } }).resolves({ Item: stored(expense({ id: "A" })) });
    ddb.on(GetCommand, { Key: { PK: `USER#${USER}`, SK: "EXP#B" } }).resolves({});
    ddb.on(PutCommand).resolves({});
    const res = await route(makeService(), event("POST /expenses/bulk", { body: { ids: ["A", "B"], action: { type: "move", company: "Acme Ltd", project: "Site A" } } }));
    expect(JSON.parse((res as { body: string }).body)).toEqual({ updated: 1, deleted: 0, missing: ["B"] });
    expect(ddb.commandCalls(PutCommand)[0]!.args[0].input.Item).toMatchObject({ id: "A", company: "Acme Ltd", project: "Site A", category: "Meals" });
  });

  it("deletes in bulk", async () => {
    ddb.on(GetCommand, { Key: { PK: `USER#${USER}`, SK: "EXP#A" } }).resolves({ Item: stored(expense({ id: "A" })) });
    ddb.on(DeleteCommand).resolves({});
    s3.on(DeleteObjectCommand).resolves({});
    const res = await route(makeService(), event("POST /expenses/bulk", { body: { ids: ["A"], action: { type: "delete" } } }));
    expect(JSON.parse((res as { body: string }).body)).toEqual({ updated: 0, deleted: 1, missing: [] });
  });
});

describe("GET /reports/{year}", () => {
  it("aggregates the year", async () => {
    ddb.on(QueryCommand).resolves({ Items: [stored(expense({ id: "A", total: 10 })), stored(expense({ id: "B", total: 5, category: "Travel", date: "2024-06-01", month: "2024-06" }))] });
    const res = await route(makeService(), event("GET /reports/{year}", { path: { year: "2024" } }));
    const body = JSON.parse((res as { body: string }).body);
    expect(body.overall).toEqual({ count: 2, total: 15, tax: 1.16 });
    expect(body.byCategory.Travel.total).toBe(5);
    expect(ddb.commandCalls(QueryCommand)[0]!.args[0].input.ExpressionAttributeValues).toMatchObject({ ":prefix": "2024" });
  });
});

describe("settings", () => {
  it("returns defaults when none stored", async () => {
    ddb.reset();
    ddb.on(GetCommand).resolves({});
    const res = await route(makeService(), event("GET /settings"));
    expect(JSON.parse((res as { body: string }).body)).toMatchObject({ companies: ["Personal"], projects: [], defaultCurrency: "GBP" });
  });

  it("dedupes and fixes the default company on save", async () => {
    ddb.on(PutCommand).resolves({});
    const res = await route(makeService(), event("PUT /settings", { body: { companies: ["Acme", "acme ", "Beta"], projects: ["P1", " p1"], categories: ["Meals"], defaultCurrency: "gbp", defaultCompany: "Nope" } }));
    expect(JSON.parse((res as { body: string }).body)).toEqual({ companies: ["Acme", "Beta"], projects: ["P1"], categories: ["Meals"], defaultCurrency: "GBP", defaultCompany: "Acme" });
  });
});
