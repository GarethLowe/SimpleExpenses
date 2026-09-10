import type { ExtractionMeta, Settings } from "@simple-expenses/shared";

export interface ExtractInput {
  bytes: Buffer;
  contentType: string;
  /** Location of the same object in S3, for extractors that read from there (Textract). */
  s3: { bucket: string; key: string };
  settings: Settings;
}

export interface ReceiptExtractor {
  readonly provider: string;
  extract(input: ExtractInput): Promise<ExtractionMeta>;
}

export type ExtractionErrorKind = "auth" | "input" | "model" | "unavailable";

export class ExtractionError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly kind: ExtractionErrorKind = retryable ? "unavailable" : "model",
  ) {
    super(message);
    this.name = "ExtractionError";
  }
}
