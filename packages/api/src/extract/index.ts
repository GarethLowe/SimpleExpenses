import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { TextractClient } from "@aws-sdk/client-textract";
import type { ScanEnv } from "../lib/env.js";
import { ClaudeExtractor, createAnthropicClient, createBedrockClient } from "./claude.js";
import { TextractExtractor } from "./textract.js";
import type { ReceiptExtractor } from "./types.js";

export * from "./types.js";
export * from "./apply.js";
export { ClaudeExtractor } from "./claude.js";
export { TextractExtractor, mapTextractDocuments } from "./textract.js";

export async function createExtractor(env: ScanEnv): Promise<ReceiptExtractor | null> {
  switch (env.provider) {
    case "none":
      return null;
    case "textract":
      return new TextractExtractor(new TextractClient({ region: env.region }));
    case "bedrock":
      return new ClaudeExtractor({
        client: createBedrockClient(env.region),
        model: env.claudeModel,
        effort: env.claudeEffort,
        provider: "bedrock",
      });
    case "anthropic": {
      const apiKey = await resolveAnthropicApiKey(env);
      return new ClaudeExtractor({
        client: createAnthropicClient(apiKey),
        model: env.claudeModel,
        effort: env.claudeEffort,
        provider: "anthropic",
      });
    }
  }
}

let cachedKey: string | null = null;

async function resolveAnthropicApiKey(env: ScanEnv): Promise<string> {
  if (cachedKey) return cachedKey;
  const fromEnv = process.env["ANTHROPIC_API_KEY"];
  if (fromEnv) return (cachedKey = fromEnv);
  if (!env.anthropicApiKeySecretArn) {
    throw new Error("EXTRACTOR_PROVIDER=anthropic requires ANTHROPIC_API_KEY_SECRET_ARN");
  }
  const sm = new SecretsManagerClient({ region: env.region });
  const res = await sm.send(new GetSecretValueCommand({ SecretId: env.anthropicApiKeySecretArn }));
  const value = res.SecretString?.trim();
  if (!value) throw new Error("Anthropic API key secret is empty");
  // Accept either a bare key or {"apiKey": "..."}.
  try {
    const parsed = JSON.parse(value) as { apiKey?: string };
    cachedKey = parsed.apiKey ?? value;
  } catch {
    cachedKey = value;
  }
  return cachedKey;
}
