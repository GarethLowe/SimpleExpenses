# Receipt scanning: options and recommendation

Goal: robust extraction of merchant, date, total, tax, currency, line items and a
category from phone photos and PDFs of receipts, for one user, at low cost.

Volume assumption: a personal app sees tens to a few hundred receipts a month.
At that scale per-receipt cost differences of a cent or two are irrelevant;
accuracy, effort to run, and how well the output maps onto the app's data model
matter far more. Prices below are list prices found in September 2026 (see
sources at the end); check the vendor pages before relying on them.

## Options

### 1. Cloud document-AI services (purpose-built, no prompt)

| Service | Price | Free tier | Output | Notes |
|---|---|---|---|---|
| AWS Textract AnalyzeExpense | ~$0.01/page | 100 pages/month for 3 months | Standardised fields (VENDOR_NAME, TOTAL, TAX, INVOICE_RECEIPT_DATE, line items, currency) | Native IAM, reads straight from S3, synchronous for single pages. No categorisation. Weak on faint thermal paper and handwriting. |
| Google Document AI Expense Parser | ~$0.01/page | Trial credits only | Similar field set | Needs a GCP project plus a service-account key stored in AWS. Reported accuracy slightly better than Textract on receipts. |
| Azure Document Intelligence (prebuilt receipt) | ~$0.01/page | 500 pages/month | Similar field set, good line items | Needs an Azure resource plus key in AWS. Best free tier of the three. |

Strengths: deterministic, no prompt engineering, bounded latency, and they
never invent values. Weaknesses: no categorisation or "which company is this
for" reasoning, mediocre on crumpled or poorly lit photos, and every one still
needs a mapping layer plus a keyword categoriser to reach the app's schema.

### 2. Multimodal LLMs with structured output

Approximate cost per receipt assumes ~1,500 input tokens for a phone photo
(Claude and OpenAI charge images by pixel area; a 1600x1200 photo is about
1,600 tokens) plus ~400 output tokens for the JSON.

| Model | Input / output per 1M tokens | Cost per receipt | Notes |
|---|---|---|---|
| Claude Opus 5 (Anthropic API) | $5 / $25 | ~$0.02 | Best reasoning: reads faint text, infers currency and category, resolves ambiguous dates. Structured outputs guarantee schema-valid JSON. PDFs accepted natively. |
| Claude Sonnet 5 | $2 / $10 | ~$0.007 | Very close to Opus on receipts. |
| Claude Haiku 4.5 | $1 / $5 | ~$0.004 | Adequate for clean receipts, weaker on damaged ones. |
| Claude on Amazon Bedrock | Bedrock pricing, roughly the same tiers | similar | Stays inside AWS: IAM instead of an API key, billed on the AWS account. Structured outputs supported. |
| Amazon Nova Lite (Bedrock) | $0.06 / $0.24 | ~$0.0002 | Cheapest by far. Usable on clean receipts; noticeably worse on hard ones. No structured-output guarantee, so JSON must be validated and retried. |
| Gemini 2.5 Flash-Lite | $0.10 / $0.40 | ~$0.0003 | Cheap and decent. Needs a Google API key stored in AWS. The 2.5 line is being deprecated in October 2026, so pin to a successor. |
| OpenAI GPT-5 mini / nano | $0.25 / $2 and $0.05 / $0.40 | ~$0.001 to $0.002 | Decent. Another external key to manage. |

Strengths: one call does OCR, field extraction, currency and date
normalisation, categorisation against the user's own list, and can flag which
company a receipt belongs to. Handles PDFs and photos alike. Weaknesses: can
hallucinate under pressure (mitigated by asking for nulls and a confidence
score, and by keeping the human review step), higher and more variable latency
(seconds), and rate limits.

### 3. Receipt-specific SaaS APIs

| Service | Price | Notes |
|---|---|---|
| Mindee (receipt API) | Free 250 pages/month, then from ~€44/month | Good accuracy, clean JSON, generous free tier. Another vendor holding your receipts. |
| Veryfi | From $500/month | Best-in-class accuracy but enterprise pricing; not sensible for one user. |
| Taggun | From ~$4/month (quote-based) | Cheap, less proven. |

### 4. Self-hosted OCR (Tesseract in Lambda, PaddleOCR, docTR)

Free per page, but receipt photos are exactly where classical OCR is worst
(thermal paper, skew, low contrast), you still need a parser to turn text into
fields, and packaging the runtime into Lambda is a maintenance chore. Not worth
it when the alternatives cost pennies.

## Recommendation

Use a Claude model with structured outputs as the primary extractor, with the
provider selectable at deploy time:

- `anthropic` (default): Anthropic API with the key in Secrets Manager. Full
  feature parity, simplest to set up.
- `bedrock`: same code through `AnthropicBedrockMantle`, no API key, IAM only,
  billed to the AWS account. Pick this if you want everything on one bill.
- `textract`: purpose-built fallback with no LLM involved, mapped onto the same
  schema and paired with the keyword categoriser. Useful if you ever want to
  eliminate model nondeterminism, or as a comparison baseline.
- `none`: skip extraction; every upload lands in the inbox for manual entry.

The default model is `claude-opus-5` at `medium` effort. For a few hundred
receipts a month that is a couple of dollars, and Opus is the most reliable on
bad photos. Set `-c claudeModel=claude-sonnet-5` or `claude-haiku-4-5` (or the
`anthropic.`-prefixed IDs on Bedrock) to trade a little accuracy for cost.

Robustness measures in the implementation:

- The prompt forbids guessing and asks for nulls and a 0-1 confidence; records
  below 0.8 confidence or missing date/total/merchant are not "one-tap
  acceptable" in the inbox.
- Category and company suggestions are matched against the user's lists; a
  keyword categoriser fills gaps.
- Dates are normalised (day-first default), currencies validated as ISO codes.
- Retryable failures (rate limits, 5xx) go back to SQS and then a dead-letter
  queue; everything else is recorded on the expense with a Retry button.
- Photos are downscaled on the device to stay under the 5 MB image limit.
- The stable system prompt is cached (prompt caching) to shave input cost.

## Sources

- AWS Textract pricing: https://aws.amazon.com/textract/pricing/ (also summarised by https://lenscopy.com/compare/aws-textract/ and https://www.braincuber.com/blog/aws-textract-pricing-what-ocr-actually-costs)
- Google Document AI pricing: https://cloud.google.com/document-ai/pricing
- Azure Document Intelligence pricing: https://azure.microsoft.com/en-us/pricing/details/document-intelligence/
- Anthropic model pricing: https://docs.anthropic.com/en/docs/about-claude/pricing
- Amazon Bedrock pricing: https://aws.amazon.com/bedrock/pricing/ (Nova Lite figures via https://www.cloudzero.com/blog/amazon-bedrock-pricing/)
- Gemini pricing: https://ai.google.dev/gemini-api/docs/pricing (summarised by https://www.cloudzero.com/blog/gemini-pricing/)
- OpenAI pricing: https://openai.com/api/pricing/ (summarised by https://www.morphllm.com/openai-api-pricing)
- Mindee vs Veryfi: https://www.erpresearch.com/erp-add-ons/ocr/mindee-vs-veryfi
- Receipt OCR API comparison: https://invoicedataextraction.com/blog/receipt-ocr-api
