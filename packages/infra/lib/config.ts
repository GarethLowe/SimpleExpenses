import type { App } from "aws-cdk-lib";

export type ExtractorProvider = "anthropic" | "bedrock" | "textract" | "none";

/**
 * Deployment configuration, read from CDK context (`-c key=value` or cdk.context.json).
 * Everything has a default so `cdk synth` works with no configuration.
 */
export interface StackConfig {
  /** Which receipt extractor the scan worker uses. */
  extractorProvider: ExtractorProvider;
  /** Claude model ID. Bedrock IDs carry the `anthropic.` prefix. */
  claudeModel: string | undefined;
  /** Claude effort level for extraction. */
  claudeEffort: "low" | "medium" | "high";
  /** Comma-separated emails allowed to sign up; empty allows anyone. */
  allowedEmails: string;
  /** Secrets Manager secret holding {"clientId","clientSecret"} for Google sign-in. */
  googleSecretName: string | undefined;
  /** Secrets Manager secret holding {"clientId","teamId","keyId","privateKey"} for Apple sign-in. */
  appleSecretName: string | undefined;
  /** Cognito hosted-UI domain prefix; must be globally unique in the region. */
  cognitoDomainPrefix: string | undefined;
  /** Extra OAuth callback origins (e.g. http://localhost:5173) for local development. */
  devOrigins: string[];
}

export function readConfig(app: App): StackConfig {
  const ctx = (key: string): string | undefined => {
    const v = app.node.tryGetContext(key) as unknown;
    return v === undefined || v === null || v === "" ? undefined : String(v);
  };
  const provider = (ctx("extractorProvider") ?? "anthropic") as ExtractorProvider;
  if (!["anthropic", "bedrock", "textract", "none"].includes(provider)) {
    throw new Error(`extractorProvider must be one of anthropic|bedrock|textract|none, got ${provider}`);
  }
  const effort = (ctx("claudeEffort") ?? "medium") as StackConfig["claudeEffort"];
  if (!["low", "medium", "high"].includes(effort)) throw new Error(`claudeEffort must be low|medium|high`);
  return {
    extractorProvider: provider,
    claudeModel: ctx("claudeModel"),
    claudeEffort: effort,
    allowedEmails: ctx("allowedEmails") ?? "",
    googleSecretName: ctx("googleSecretName"),
    appleSecretName: ctx("appleSecretName"),
    cognitoDomainPrefix: ctx("cognitoDomainPrefix"),
    devOrigins: (ctx("devOrigins") ?? "http://localhost:5173").split(",").map((s) => s.trim()).filter(Boolean),
  };
}
