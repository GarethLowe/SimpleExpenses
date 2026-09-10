import { mockClient } from "aws-sdk-client-mock";
import type { Expense, Settings } from "@simple-expenses/shared";
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";

export const USER = "user-123";

export const settings: Settings = {
  companies: ["Acme Ltd", "Personal"],
  projects: ["Site A", "Website rebuild"],
  categories: ["Meals", "Travel", "Software & Subscriptions", "Other"],
  defaultCurrency: "GBP",
  defaultCompany: "Personal",
};

export function expense(partial: Partial<Expense> = {}): Expense {
  return {
    id: "01EXP",
    userId: USER,
    status: "needs_review",
    archived: false,
    date: "2024-03-05",
    month: "2024-03",
    year: "2024",
    merchant: "Costa",
    company: "Personal",
    project: null,
    category: "Meals",
    currency: "GBP",
    total: 3.5,
    subtotal: null,
    tax: 0.58,
    paymentMethod: null,
    receiptNumber: null,
    lineItems: [],
    notes: null,
    file: { key: `users/${USER}/01EXP/original.jpg`, contentType: "image/jpeg", size: 1234, originalFilename: "IMG_1.jpg", thumbnailKey: null },
    extraction: null,
    error: null,
    createdAt: "2024-03-05T10:00:00.000Z",
    updatedAt: "2024-03-05T10:00:00.000Z",
    ...partial,
  };
}

export function stored(e: Expense): Record<string, unknown> {
  return {
    ...e,
    PK: `USER#${e.userId}`,
    SK: `EXP#${e.id}`,
    GSI1PK: `USER#${e.userId}`,
    GSI1SK: `${e.date ?? "0000-00-00"}#${e.id}`,
    entity: "expense",
  };
}

export function event(
  routeKey: string,
  opts: { body?: unknown; path?: Record<string, string>; query?: Record<string, string>; sub?: string | null } = {},
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const [method, rawPath] = routeKey.split(" ") as [string, string];
  return {
    version: "2.0",
    routeKey,
    rawPath,
    rawQueryString: "",
    headers: {},
    ...(opts.query ? { queryStringParameters: opts.query } : {}),
    ...(opts.path ? { pathParameters: opts.path } : {}),
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    isBase64Encoded: false,
    requestContext: {
      accountId: "1",
      apiId: "a",
      domainName: "d",
      domainPrefix: "d",
      http: { method, path: rawPath, protocol: "HTTP/1.1", sourceIp: "1.1.1.1", userAgent: "t" },
      requestId: "r",
      routeKey,
      stage: "$default",
      time: "",
      timeEpoch: 0,
      authorizer: {
        principalId: "p",
        integrationLatency: 0,
        jwt: { claims: opts.sub === null ? {} : { sub: opts.sub ?? USER }, scopes: [] },
      },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

/**
 * aws-sdk-client-mock 4.x's generics don't line up with the current smithy
 * middleware types. The runtime behaviour is fine, so expose the small
 * surface the tests use behind our own types.
 */
type AnyCommand = new (input: never) => unknown;

export interface StubResponder {
  resolves(output: unknown): StubResponder;
  rejects(error: unknown): StubResponder;
}

export interface AwsClientStub {
  on(command: AnyCommand, input?: Record<string, unknown>): StubResponder;
  reset(): void;
  commandCalls(command: AnyCommand): Array<{ args: [{ input: Record<string, any> }] }>;
}

export function mockAwsClient(client: unknown): AwsClientStub {
  return mockClient(client as never) as unknown as AwsClientStub;
}
