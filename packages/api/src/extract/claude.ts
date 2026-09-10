import Anthropic from "@anthropic-ai/sdk";
import { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { ReceiptExtractionSchema, type ExtractionMeta } from "@simple-expenses/shared";
import { SYSTEM_PROMPT, userPrompt } from "./prompt.js";
import { ExtractionError, type ExtractInput, type ReceiptExtractor } from "./types.js";

/** Anthropic's per-image limit; PDFs may be larger (32 MB request cap). */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PDF_BYTES = 30 * 1024 * 1024;

export interface ClaudeExtractorOptions {
  /** Any client exposing `messages.parse` (Anthropic, AnthropicBedrockMantle). */
  client: Pick<Anthropic, "messages">;
  model: string;
  effort: "low" | "medium" | "high";
  provider: "anthropic" | "bedrock";
}

export function createAnthropicClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, maxRetries: 3, timeout: 120_000 });
}

export function createBedrockClient(region: string): AnthropicBedrockMantle {
  return new AnthropicBedrockMantle({ awsRegion: region, maxRetries: 3, timeout: 120_000 });
}

export class ClaudeExtractor implements ReceiptExtractor {
  readonly provider: string;

  constructor(private readonly opts: ClaudeExtractorOptions) {
    this.provider = opts.provider;
  }

  async extract(input: ExtractInput): Promise<ExtractionMeta> {
    const block = toContentBlock(input);
    const started = Date.now();
    let response: Awaited<ReturnType<Anthropic["messages"]["parse"]>>;
    try {
      response = await this.opts.client.messages.parse({
        model: this.opts.model,
        max_tokens: 8192,
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        output_config: {
          effort: this.opts.effort,
          format: zodOutputFormat(ReceiptExtractionSchema),
        },
        messages: [
          {
            role: "user",
            content: [block, { type: "text", text: userPrompt(input.settings) }],
          },
        ],
      });
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError || err instanceof Anthropic.APIConnectionError) {
        throw new ExtractionError(`Claude temporarily unavailable: ${err.message}`, true);
      }
      if (err instanceof Anthropic.APIError) {
        throw new ExtractionError(`Claude request failed (${err.status}): ${err.message}`, false);
      }
      throw err;
    }

    if (response.stop_reason === "refusal") {
      throw new ExtractionError("The model declined to process this document", false);
    }
    if (response.stop_reason === "max_tokens") {
      throw new ExtractionError("Extraction output was truncated", false);
    }
    const parsed = response.parsed_output;
    if (!parsed) {
      throw new ExtractionError("Model returned output that did not match the schema", false);
    }
    return {
      provider: this.provider,
      model: response.model,
      extractedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      confidence: clamp01(parsed.confidence),
      raw: parsed,
    };
  }
}

function toContentBlock(input: ExtractInput): Anthropic.ContentBlockParam {
  const data = input.bytes.toString("base64");
  switch (input.contentType) {
    case "image/jpeg":
    case "image/png":
    case "image/webp":
      if (input.bytes.length > MAX_IMAGE_BYTES) {
        throw new ExtractionError("Image exceeds the 5 MB limit; re-upload a smaller image", false);
      }
      return { type: "image", source: { type: "base64", media_type: input.contentType, data } };
    case "application/pdf":
      if (input.bytes.length > MAX_PDF_BYTES) {
        throw new ExtractionError("PDF exceeds the size limit", false);
      }
      return { type: "document", source: { type: "base64", media_type: "application/pdf", data } };
    default:
      throw new ExtractionError(`Unsupported content type ${input.contentType}`, false);
  }
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}
