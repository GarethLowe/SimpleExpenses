import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { MAX_UPLOAD_BYTES, parseReceiptObjectKey, type Expense } from "@simple-expenses/shared";
import type { S3Event, SQSBatchResponse, SQSEvent, SQSRecord } from "aws-lambda";
import { ExtractionError, applyExtraction, createExtractor, type ReceiptExtractor } from "../extract/index.js";
import { scanEnv } from "../lib/env.js";
import { ExpensesRepo } from "../lib/repo.js";
import type { ScanMessage } from "../lib/service.js";
import { ReceiptStorage } from "../lib/storage.js";

const env = scanEnv();
const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region: env.region }), {
  marshallOptions: { removeUndefinedValues: true },
});
const repo = new ExpensesRepo(db, env.tableName);
const storage = new ReceiptStorage(new S3Client({ region: env.region }), env.bucketName);
let extractorPromise: Promise<ReceiptExtractor | null> | undefined;

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  extractorPromise ??= createExtractor(env);
  const extractor = await extractorPromise;
  return processRecords(event.Records, { repo, storage, extractor });
};

export interface ScanDeps {
  repo: ExpensesRepo;
  storage: ReceiptStorage;
  extractor: ReceiptExtractor | null;
  now?: () => Date;
}

export interface ScanTarget {
  userId: string;
  expenseId: string;
}

/** Each SQS record may carry an S3 event notification (with N records) or a rescan message. */
export function targetsFromRecord(record: SQSRecord): ScanTarget[] {
  let body: unknown;
  try {
    body = JSON.parse(record.body);
  } catch {
    console.warn("Skipping non-JSON message", record.messageId);
    return [];
  }
  if (!body || typeof body !== "object") return [];
  if ("type" in body && (body as ScanMessage).type === "rescan") {
    const m = body as ScanMessage;
    return m.userId && m.expenseId ? [{ userId: m.userId, expenseId: m.expenseId }] : [];
  }
  if ("Records" in body) {
    const targets: ScanTarget[] = [];
    for (const rec of (body as S3Event).Records ?? []) {
      const key = decodeURIComponent((rec.s3?.object?.key ?? "").replace(/\+/g, " "));
      const parsed = parseReceiptObjectKey(key);
      if (parsed?.isOriginal) targets.push({ userId: parsed.userId, expenseId: parsed.expenseId });
      else if (!parsed) console.warn("Ignoring object with unexpected key", key);
      // thumbnails and other companions are silently ignored
    }
    return targets;
  }
  // S3 test events and anything else
  return [];
}

export async function processRecords(records: SQSRecord[], deps: ScanDeps): Promise<SQSBatchResponse> {
  const failures: SQSBatchResponse["batchItemFailures"] = [];
  for (const record of records) {
    try {
      for (const target of targetsFromRecord(record)) {
        await scanOne(target, deps);
      }
    } catch (err) {
      console.error("Record failed, will retry", record.messageId, err);
      failures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures: failures };
}

/**
 * Runs extraction for one expense. Throws only for retryable failures so SQS
 * redelivers; everything else is recorded on the expense as `failed`.
 */
export async function scanOne(target: ScanTarget, deps: ScanDeps): Promise<Expense | null> {
  const now = deps.now ?? (() => new Date());
  const expense = await deps.repo.get(target.userId, target.expenseId);
  if (!expense) {
    console.warn("No expense record for object; ignoring", target);
    return null;
  }
  const head = await deps.storage.head(expense.file.key);
  if (!head) {
    console.warn("Object missing for expense; ignoring", target);
    return null;
  }
  const settings = await deps.repo.getSettings(target.userId);
  const fail = async (message: string): Promise<Expense> => {
    const failed: Expense = { ...expense, status: "failed", error: message, updatedAt: now().toISOString() };
    await deps.repo.put(failed, { mustExist: true });
    return failed;
  };

  if (head.size > MAX_UPLOAD_BYTES) return fail(`File is too large (${head.size} bytes)`);

  const scanning: Expense = { ...expense, status: "scanning", file: { ...expense.file, size: head.size }, error: null, updatedAt: now().toISOString() };
  await deps.repo.put(scanning, { mustExist: true });

  if (!deps.extractor) {
    const manual: Expense = { ...scanning, status: "needs_review", updatedAt: now().toISOString() };
    await deps.repo.put(manual, { mustExist: true });
    return manual;
  }

  try {
    const object = await deps.storage.get(expense.file.key);
    const meta = await deps.extractor.extract({
      bytes: object.bytes,
      contentType: expense.file.contentType,
      s3: { bucket: deps.storage.bucketName, key: expense.file.key },
      settings,
    });
    const result = applyExtraction(scanning, meta, settings, now());
    await deps.repo.put(result, { mustExist: true });
    return result;
  } catch (err) {
    if (err instanceof ExtractionError && err.retryable) {
      // Leave it in `scanning`; SQS will redeliver, then DLQ.
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    return fail(message);
  }
}
