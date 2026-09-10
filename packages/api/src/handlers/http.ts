import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import { apiEnv } from "../lib/env.js";
import { notFound } from "../lib/errors.js";
import { errorResult, json, noContent, parseBody, parseQuery, pathParam, userIdFrom, type Event, type Result } from "../lib/http.js";
import { ExpensesRepo } from "../lib/repo.js";
import {
  BulkActionSchema,
  CreateExpenseRequestSchema,
  ExpenseEditableSchema,
  ExpensesService,
  ListExpensesQuerySchema,
  SettingsSchema,
} from "../lib/service.js";
import { ReceiptStorage } from "../lib/storage.js";

const env = apiEnv();
const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region: env.region }), {
  marshallOptions: { removeUndefinedValues: true },
});
const service = new ExpensesService({
  repo: new ExpensesRepo(db, env.tableName),
  storage: new ReceiptStorage(new S3Client({ region: env.region }), env.bucketName),
  sqs: new SQSClient({ region: env.region }),
  scanQueueUrl: env.scanQueueUrl,
});

export const handler = (event: Event): Promise<Result> => route(service, event);

/** Route table for the single HTTP API Lambda. Exported for tests. */
export async function route(svc: ExpensesService, event: Event): Promise<Result> {
  try {
    const userId = userIdFrom(event);
    const key = event.routeKey;
    switch (key) {
      case "GET /expenses":
        return json(200, await svc.list(userId, parseQuery(event, ListExpensesQuerySchema)));
      case "POST /expenses":
        return json(201, await svc.create(userId, parseBody(event, CreateExpenseRequestSchema)));
      case "POST /expenses/bulk":
        return json(200, await svc.bulk(userId, parseBody(event, BulkActionSchema)));
      case "GET /expenses/{id}":
        return json(200, await svc.get(userId, pathParam(event, "id")));
      case "PATCH /expenses/{id}":
        return json(200, await svc.update(userId, pathParam(event, "id"), parseBody(event, ExpenseEditableSchema)));
      case "DELETE /expenses/{id}":
        await svc.delete(userId, pathParam(event, "id"));
        return noContent();
      case "GET /expenses/{id}/file":
        return json(200, await svc.fileUrl(userId, pathParam(event, "id")));
      case "POST /expenses/{id}/rescan":
        return json(202, await svc.rescan(userId, pathParam(event, "id")));
      case "GET /reports/{year}": {
        const q = parseQuery(event, z.object({ currency: z.string().length(3).optional() }));
        return json(200, await svc.report(userId, pathParam(event, "year"), q.currency?.toUpperCase()));
      }
      case "GET /settings":
        return json(200, await svc.getSettings(userId));
      case "PUT /settings":
        return json(200, await svc.putSettings(userId, parseBody(event, SettingsSchema)));
      default:
        throw notFound(`No route for ${key}`);
    }
  } catch (err) {
    return errorResult(err);
  }
}
