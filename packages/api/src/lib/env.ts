function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

export type ExtractorProvider = "anthropic" | "bedrock" | "textract" | "none";

export interface ApiEnv {
  tableName: string;
  bucketName: string;
  scanQueueUrl: string;
  region: string;
}

export interface ScanEnv extends ApiEnv {
  provider: ExtractorProvider;
  claudeModel: string;
  claudeEffort: "low" | "medium" | "high";
  anthropicApiKeySecretArn: string | null;
}

export function apiEnv(): ApiEnv {
  return {
    tableName: required("TABLE_NAME"),
    bucketName: required("BUCKET_NAME"),
    scanQueueUrl: required("SCAN_QUEUE_URL"),
    region: process.env["AWS_REGION"] ?? "eu-west-2",
  };
}

export function scanEnv(): ScanEnv {
  const provider = (process.env["EXTRACTOR_PROVIDER"] ?? "anthropic") as ExtractorProvider;
  if (!["anthropic", "bedrock", "textract", "none"].includes(provider)) {
    throw new Error(`Unknown EXTRACTOR_PROVIDER ${provider}`);
  }
  const effort = (process.env["CLAUDE_EFFORT"] ?? "medium") as ScanEnv["claudeEffort"];
  return {
    ...apiEnv(),
    provider,
    // Bedrock model IDs carry an `anthropic.` prefix; the first-party API uses the bare ID.
    claudeModel: process.env["CLAUDE_MODEL"] ?? (provider === "bedrock" ? "anthropic.claude-opus-5" : "claude-opus-5"),
    claudeEffort: ["low", "medium", "high"].includes(effort) ? effort : "medium",
    anthropicApiKeySecretArn: process.env["ANTHROPIC_API_KEY_SECRET_ARN"] ?? null,
  };
}
