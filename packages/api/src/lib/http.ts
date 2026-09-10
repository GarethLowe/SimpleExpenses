import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from "aws-lambda";
import type { ZodType } from "zod";
import { HttpError, badRequest } from "./errors.js";

export type Event = APIGatewayProxyEventV2WithJWTAuthorizer;
export type Result = APIGatewayProxyResultV2;

export function json(status: number, body: unknown): Result {
  return {
    statusCode: status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
    body: JSON.stringify(body),
  };
}

export function noContent(): Result {
  return { statusCode: 204, headers: { "cache-control": "no-store" } };
}

/** The authenticated user's stable id (Cognito `sub`), taken from the JWT authorizer. */
export function userIdFrom(event: Event): string {
  const sub = event.requestContext.authorizer?.jwt?.claims?.["sub"];
  if (typeof sub !== "string" || !sub) throw new HttpError(401, "Unauthenticated");
  return sub;
}

export function parseBody<T>(event: Event, schema: ZodType<T>): T {
  if (!event.body) throw badRequest("Missing request body");
  let raw: unknown;
  try {
    raw = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body);
  } catch {
    throw badRequest("Body is not valid JSON");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw badRequest("Invalid request body", parsed.error.issues);
  return parsed.data;
}

export function parseQuery<T>(event: Event, schema: ZodType<T>): T {
  const parsed = schema.safeParse(event.queryStringParameters ?? {});
  if (!parsed.success) throw badRequest("Invalid query string", parsed.error.issues);
  return parsed.data;
}

export function pathParam(event: Event, name: string): string {
  const v = event.pathParameters?.[name];
  if (!v) throw badRequest(`Missing path parameter ${name}`);
  return decodeURIComponent(v);
}

export function errorResult(err: unknown): Result {
  if (err instanceof HttpError) {
    return json(err.status, { error: err.message, ...(err.details !== undefined ? { details: err.details } : {}) });
  }
  if ((err as { name?: string }).name === "ConditionalCheckFailedException") {
    return json(409, { error: "Conflict" });
  }
  console.error("Unhandled error", err);
  return json(500, { error: "Internal error" });
}
