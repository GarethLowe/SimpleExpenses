/**
 * Key layout for the single DynamoDB table and the receipts bucket.
 *
 * Table:  PK = USER#<sub>      SK = EXP#<id>   (expense records)
 *         PK = USER#<sub>      SK = SETTINGS   (user settings)
 * GSI1:   GSI1PK = USER#<sub>  GSI1SK = <date|0000-00-00>#<id>  (date-ordered listing)
 * Bucket: users/<sub>/<id>/original.<ext>
 */

export const USER_PREFIX = "USER#";
export const EXPENSE_PREFIX = "EXP#";
export const SETTINGS_SK = "SETTINGS";
export const NO_DATE_SORT = "0000-00-00";

export function userPk(userId: string): string {
  assertNoSeparator(userId, "userId");
  return `${USER_PREFIX}${userId}`;
}

export function expenseSk(expenseId: string): string {
  assertNoSeparator(expenseId, "expenseId");
  return `${EXPENSE_PREFIX}${expenseId}`;
}

export function dateSortKey(date: string | null, expenseId: string): string {
  return `${date ?? NO_DATE_SORT}#${expenseId}`;
}

export function expenseIdFromSk(sk: string): string | null {
  return sk.startsWith(EXPENSE_PREFIX) ? sk.slice(EXPENSE_PREFIX.length) : null;
}

const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export function extensionFor(contentType: string): string {
  const ext = EXT_BY_TYPE[contentType];
  if (!ext) throw new Error(`Unsupported content type: ${contentType}`);
  return ext;
}

export function receiptObjectKey(userId: string, expenseId: string, contentType: string): string {
  assertNoSeparator(userId, "userId");
  assertNoSeparator(expenseId, "expenseId");
  return `users/${userId}/${expenseId}/original.${extensionFor(contentType)}`;
}

export interface ParsedObjectKey {
  userId: string;
  expenseId: string;
  filename: string;
}

/** Parse `users/<sub>/<id>/<file>`; returns null for anything else. */
export function parseReceiptObjectKey(key: string): ParsedObjectKey | null {
  const parts = key.split("/");
  if (parts.length !== 4 || parts[0] !== "users") return null;
  const [, userId, expenseId, filename] = parts;
  if (!userId || !expenseId || !filename) return null;
  return { userId, expenseId, filename };
}

function assertNoSeparator(value: string, name: string): void {
  if (!value || /[#/]/.test(value)) {
    throw new Error(`Invalid ${name}: ${JSON.stringify(value)}`);
  }
}
