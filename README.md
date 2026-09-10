# Simple Expenses

A personal expenses app that runs entirely on AWS serverless services: snap or
upload receipts (JPEG, PNG, WebP, PDF), have them read automatically, then keep
everything catalogued by month, year, company, project and type, with reports
and CSV export. Installable as a PWA on a phone for capture, and a normal web app on a
desktop for reviewing and managing many expenses at once.

There is no server to run. Idle cost is close to zero; the only meaningful
per-use cost is the receipt extraction call (a few cents a receipt with Claude,
or ~1 cent a page with Textract). See
[docs/receipt-scanning-options.md](docs/receipt-scanning-options.md) for the
comparison of scanning approaches and why Claude with structured outputs is the
default.

## How it works

```
 phone / desktop PWA (React, S3 + CloudFront)
        │  OIDC (PKCE) via Cognito hosted UI  ── Google / Apple / email
        ▼
 API Gateway (HTTP API, JWT authoriser) ── Lambda "api" ── DynamoDB (single table)
        │                                        │
        │ presigned PUT                          │ presigned GET
        ▼                                        ▼
 S3 receipts bucket  (users/<sub>/<expenseId>/original.<ext>)
        │  ObjectCreated
        ▼
 SQS ── Lambda "scan" ── Claude (Anthropic API or Bedrock) | Textract | none
        │                       ▼
        └── DLQ            DynamoDB: status needs_review, fields filled
```

- **Per-user isolation.** Every API call is scoped to the caller's Cognito `sub`.
  Table keys and S3 object keys embed it; the API only ever signs URLs for the
  caller's own objects. Sign-up can be restricted to an email allowlist.
- **Upload flow.** `POST /expenses` creates a record in status `uploading` and
  returns a presigned URL; the browser downsizes photos, PUTs the bytes, and the
  S3 event drives extraction. Records move `scanning` → `needs_review` →
  `ready` (or `failed`, with a Retry button).
- **Cataloguing.** Date, month and year come from the receipt; company,
  project and type come from your lists in Settings, chosen by the model and
  validated against them, with a keyword fallback for type. Projects are
  optional tags (a job, client or trip); a receipt is linked to one when the
  model spots a matching reference, when you pick one at capture time, or
  later by hand. Everything is editable; bulk move (company, project, type),
  archive, delete and mark-ready work from the Expenses view.
- **Reports.** Per year: totals by month, by company, by project, by type, and
  company/project/type × month matrices, plus CSV export.

## Repository layout

| Package | What |
|---|---|
| `packages/shared` | Types and zod schemas, key layout, date/money parsing, categoriser, report aggregation. Used by API and web. |
| `packages/api` | Lambda handlers (`http`, `scan`, `preSignUp`), DynamoDB repo, S3 helpers, extractors (`claude`, `textract`). |
| `packages/infra` | AWS CDK stack: S3, DynamoDB, SQS, Lambdas, Cognito, HTTP API, CloudFront, site deployment. |
| `packages/web` | Vite + React PWA. |
| `docs/` | Design notes. |

## Prerequisites

- Node 22+, npm 10+
- An AWS account with credentials configured locally, and the CDK bootstrapped
  in your target region (`npx cdk bootstrap aws://ACCOUNT/REGION`)
- For the default extractor: an Anthropic API key

## Deploy

```bash
npm ci
npm run build                      # builds shared + web (web assets are deployed by CDK)
npm run deploy -- \
  -c allowedEmails=you@example.com \
  -c cognitoDomainPrefix=my-expenses-unique-prefix
```

Outputs include `WebUrl`, `ApiUrl`, `UserPoolId`, `UserPoolClientId`,
`CognitoDomain` and `AnthropicApiKeySecretArn`.

Then store your Anthropic key in the secret the stack created (its initial
value is a random placeholder):

```bash
aws secretsmanager put-secret-value --secret-id <AnthropicApiKeySecretArn> --secret-string 'sk-ant-...'
```

Open `WebUrl`, sign in, set up your companies and types under Settings, and
start capturing.

### Configuration (CDK context)

Pass with `-c key=value` on `deploy`/`synth`, or put them in
`packages/infra/cdk.context.json`.

| Key | Default | Meaning |
|---|---|---|
| `extractorProvider` | `anthropic` | `anthropic` (API key in Secrets Manager), `bedrock` (IAM, no key), `textract`, or `none` (manual entry). |
| `claudeModel` | `claude-opus-5` (`anthropic.claude-opus-5` on Bedrock) | Any Claude model ID. `claude-sonnet-5` or `claude-haiku-4-5` are cheaper. |
| `claudeEffort` | `medium` | `low`, `medium` or `high`. |
| `allowedEmails` | *(empty: anyone)* | Comma-separated emails allowed to sign up. Set this. |
| `cognitoDomainPrefix` | `simple-expenses-<account id>` | Hosted UI domain prefix; must be unique in the region. |
| `googleSecretName` | *(off)* | Name of a Secrets Manager secret `{"clientId":"...","clientSecret":"..."}`; enables "Sign in with Google". |
| `appleSecretName` | *(off)* | Secret `{"clientId":"...","teamId":"...","keyId":"...","privateKey":"-----BEGIN PRIVATE KEY-----..."}`; enables "Sign in with Apple". |
| `devOrigins` | `http://localhost:5173` | Extra origins allowed for OAuth callbacks and CORS (local dev). |

Without Google/Apple secrets the hosted UI offers email + password; because
self-sign-up is disabled you create that user in the Cognito console (or with
`aws cognito-idp admin-create-user`). Federated users are created on first
sign-in, subject to the allowlist.

#### Google sign-in

1. Google Cloud console → APIs & Services → Credentials → OAuth client ID (Web).
2. Authorised redirect URI: `https://<cognitoDomainPrefix>.auth.<region>.amazoncognito.com/oauth2/idpresponse`.
3. `aws secretsmanager create-secret --name simple-expenses/google --secret-string '{"clientId":"...","clientSecret":"..."}'`
4. Redeploy with `-c googleSecretName=simple-expenses/google`.

#### Apple sign-in

1. Apple developer portal: create a Services ID with Sign in with Apple, return
   URL as above; create a Sign in with Apple key and download the `.p8`.
2. Store `{"clientId":"<services id>","teamId":"...","keyId":"...","privateKey":"<contents of .p8>"}` as a secret.
3. Redeploy with `-c appleSecretName=...`.

### Using Bedrock instead of an API key

Enable the Claude model in the Bedrock console for your region, then deploy
with `-c extractorProvider=bedrock`. The scan Lambda gets `bedrock:InvokeModel`
and no secret is needed.

## Local development

```bash
npm ci && npm run build -w @simple-expenses/shared
cp packages/web/.env.example packages/web/.env.local   # fill in from stack outputs
npm run dev -w @simple-expenses/web                    # http://localhost:5173
```

`http://localhost:5173` is in the default `devOrigins`, so the deployed Cognito
client and API accept it.

Checks:

```bash
npm run typecheck
npm test
npm run synth
```

The API and scan handlers are unit-tested with mocked AWS clients; the CDK stack
has assertion tests; the extractor mapping and apply logic are pure functions
with their own tests.

## Operational notes

- Receipt bucket and table are `RETAIN` on stack deletion; versioning and
  point-in-time recovery are on.
- Failed extractions go to a DLQ after three attempts (`ScanDlqUrl` output);
  the record itself shows `failed` with a Retry button for non-retryable errors.
- Uploads are capped at 20 MB; images are downscaled client-side to stay under
  Claude's 5 MB image limit.
- Log groups are kept for 30 days.

## Limitations and ideas

- Reports sum only the dominant currency; other currencies are listed
  separately rather than converted.
- No offline queueing of captures yet (the PWA needs connectivity to upload).
- Multi-page PDFs are sent whole to Claude; Textract's synchronous API reads
  the first page only.
- A Web Share Target entry in the manifest would let you share a photo straight
  from the camera roll.
