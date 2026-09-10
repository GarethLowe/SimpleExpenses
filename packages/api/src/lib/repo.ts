import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  type QueryCommandInput,
} from "@aws-sdk/lib-dynamodb";
import {
  DEFAULT_SETTINGS,
  ExpenseSchema,
  SETTINGS_SK,
  SettingsSchema,
  dateSortKey,
  expenseSk,
  userPk,
  type Expense,
  type ListExpensesQuery,
  type Settings,
} from "@simple-expenses/shared";

interface StoredExpense extends Expense {
  PK: string;
  SK: string;
  GSI1PK: string;
  GSI1SK: string;
  entity: "expense";
}

export interface ListResult {
  items: Expense[];
  cursor: string | null;
}

/**
 * Data access for the single-table design. Every method is scoped by userId,
 * which is the caller's Cognito `sub`; there is no way to address another
 * user's rows through this class.
 */
export class ExpensesRepo {
  constructor(
    private readonly db: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async get(userId: string, expenseId: string): Promise<Expense | null> {
    const res = await this.db.send(
      new GetCommand({ TableName: this.tableName, Key: { PK: userPk(userId), SK: expenseSk(expenseId) } }),
    );
    return res.Item ? toExpense(res.Item) : null;
  }

  async put(expense: Expense, opts: { mustExist?: boolean } = {}): Promise<void> {
    const item: StoredExpense = {
      ...expense,
      PK: userPk(expense.userId),
      SK: expenseSk(expense.id),
      GSI1PK: userPk(expense.userId),
      GSI1SK: dateSortKey(expense.date, expense.id),
      entity: "expense",
    };
    await this.db.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
        ...(opts.mustExist ? { ConditionExpression: "attribute_exists(PK)" } : {}),
      }),
    );
  }

  async delete(userId: string, expenseId: string): Promise<void> {
    await this.db.send(
      new DeleteCommand({ TableName: this.tableName, Key: { PK: userPk(userId), SK: expenseSk(expenseId) } }),
    );
  }

  async list(userId: string, q: ListExpensesQuery): Promise<ListResult> {
    const names: Record<string, string> = { "#pk": "GSI1PK", "#sk": "GSI1SK" };
    const values: Record<string, unknown> = { ":pk": userPk(userId) };
    let keyCond = "#pk = :pk";
    if (q.month) {
      keyCond += " AND begins_with(#sk, :prefix)";
      values[":prefix"] = q.month;
    } else if (q.year) {
      keyCond += " AND begins_with(#sk, :prefix)";
      values[":prefix"] = q.year;
    } else if (q.from || q.to) {
      keyCond += " AND #sk BETWEEN :from AND :to";
      values[":from"] = q.from ?? "0000-00-00";
      values[":to"] = `${q.to ?? "9999-12-31"}#￿`;
    }

    const filters: string[] = [];
    if (q.archived !== "all") {
      names["#archived"] = "archived";
      values[":archived"] = q.archived === "true";
      filters.push("#archived = :archived");
    }
    if (q.company !== undefined) {
      names["#company"] = "company";
      values[":company"] = q.company;
      filters.push("#company = :company");
    }
    if (q.category !== undefined) {
      names["#category"] = "category";
      values[":category"] = q.category;
      filters.push("#category = :category");
    }
    if (q.status) {
      names["#status"] = "status";
      values[":status"] = q.status;
      filters.push("#status = :status");
    }

    const items: Expense[] = [];
    let exclusiveStartKey = decodeCursor(q.cursor);
    let lastKey: Record<string, unknown> | undefined;
    do {
      const input: QueryCommandInput = {
        TableName: this.tableName,
        IndexName: "GSI1",
        KeyConditionExpression: keyCond,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ScanIndexForward: false,
        Limit: Math.min(q.limit * 2, 1000),
        ...(filters.length ? { FilterExpression: filters.join(" AND ") } : {}),
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
      };
      const res = await this.db.send(new QueryCommand(input));
      for (const raw of res.Items ?? []) {
        if (items.length >= q.limit) break;
        items.push(toExpense(raw));
      }
      lastKey = res.LastEvaluatedKey;
      exclusiveStartKey = lastKey;
    } while (lastKey && items.length < q.limit);

    // If we filled the page mid-batch we may have dropped items; re-derive the cursor
    // from the last item returned so the next page starts right after it.
    const last = items[items.length - 1];
    const cursor =
      lastKey || (items.length >= q.limit && last)
        ? encodeCursor(
            last
              ? { PK: userPk(userId), SK: expenseSk(last.id), GSI1PK: userPk(userId), GSI1SK: dateSortKey(last.date, last.id) }
              : lastKey,
          )
        : null;
    return { items, cursor };
  }

  /** All expenses in a year, unpaginated (used for reports). */
  async listYear(userId: string, year: string): Promise<Expense[]> {
    const all: Expense[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.list(userId, { year, archived: "false", limit: 500, cursor });
      all.push(...page.items);
      cursor = page.cursor ?? undefined;
    } while (cursor);
    return all;
  }

  async getSettings(userId: string): Promise<Settings> {
    const res = await this.db.send(
      new GetCommand({ TableName: this.tableName, Key: { PK: userPk(userId), SK: SETTINGS_SK } }),
    );
    if (!res.Item) return { ...DEFAULT_SETTINGS };
    const parsed = SettingsSchema.safeParse(res.Item);
    return parsed.success ? parsed.data : { ...DEFAULT_SETTINGS };
  }

  async putSettings(userId: string, settings: Settings): Promise<void> {
    await this.db.send(
      new PutCommand({
        TableName: this.tableName,
        Item: { PK: userPk(userId), SK: SETTINGS_SK, entity: "settings", ...settings },
      }),
    );
  }
}

function toExpense(raw: Record<string, unknown>): Expense {
  const { PK: _pk, SK: _sk, GSI1PK: _g1, GSI1SK: _g2, entity: _e, ...rest } = raw;
  return ExpenseSchema.parse(rest);
}

function encodeCursor(key: Record<string, unknown> | undefined): string | null {
  return key ? Buffer.from(JSON.stringify(key), "utf8").toString("base64url") : null;
}

function decodeCursor(cursor: string | undefined): Record<string, unknown> | undefined {
  if (!cursor) return undefined;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (parsed && typeof parsed === "object" && "PK" in parsed && "SK" in parsed) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  throw new Error("Invalid cursor");
}
