import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { beforeAll, describe, expect, it } from "vitest";
import { readConfig } from "../lib/config.js";
import { SimpleExpensesStack } from "../lib/simple-expenses-stack.js";

function synth(context: Record<string, string> = {}) {
  const app = new App({ context: { ...context, "aws:cdk:bundling-stacks": [] } });
  const stack = new SimpleExpensesStack(app, "Test", {
    config: readConfig(app),
    env: { account: "123456789012", region: "eu-west-2" },
  });
  return Template.fromStack(stack);
}

describe("SimpleExpensesStack", () => {
  let template: Template;
  beforeAll(() => {
    template = synth({ allowedEmails: "me@example.com" });
  });

  it("stores receipts privately with SSL enforced and versioning", () => {
    template.hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: { BlockPublicAcls: true, RestrictPublicBuckets: true },
      VersioningConfiguration: { Status: "Enabled" },
      CorsConfiguration: Match.objectLike({ CorsRules: [Match.objectLike({ AllowedMethods: ["PUT", "GET", "HEAD"] })] }),
    });
    template.hasResourceProperties("AWS::S3::BucketPolicy", {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([Match.objectLike({ Effect: "Deny", Condition: { Bool: { "aws:SecureTransport": "false" } } })]),
      }),
    });
  });

  it("creates the single table with GSI1 and PITR", () => {
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      BillingMode: "PAY_PER_REQUEST",
      KeySchema: [
        { AttributeName: "PK", KeyType: "HASH" },
        { AttributeName: "SK", KeyType: "RANGE" },
      ],
      GlobalSecondaryIndexes: [Match.objectLike({ IndexName: "GSI1" })],
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
    });
    template.hasResource("AWS::DynamoDB::Table", { DeletionPolicy: "Retain" });
  });

  it("wires S3 uploads to the scan queue with a DLQ and partial batch failures", () => {
    template.resourceCountIs("AWS::SQS::Queue", 2);
    template.hasResourceProperties("AWS::SQS::Queue", { RedrivePolicy: Match.objectLike({ maxReceiveCount: 3 }) });
    template.hasResourceProperties("AWS::Lambda::EventSourceMapping", {
      BatchSize: 1,
      FunctionResponseTypes: ["ReportBatchItemFailures"],
      ScalingConfig: { MaximumConcurrency: 5 },
    });
    template.hasResourceProperties("Custom::S3BucketNotifications", {
      NotificationConfiguration: Match.objectLike({
        QueueConfigurations: [Match.objectLike({ Events: ["s3:ObjectCreated:*"], Filter: { Key: { FilterRules: [{ Name: "prefix", Value: "users/" }] } } })],
      }),
    });
  });

  it("protects every API route with the Cognito JWT authorizer", () => {
    template.hasResourceProperties("AWS::ApiGatewayV2::Authorizer", { AuthorizerType: "JWT" });
    const routes = template.findResources("AWS::ApiGatewayV2::Route");
    const keys = Object.values(routes).map((r) => (r["Properties"] as { RouteKey: string }).RouteKey);
    expect(keys).toEqual(
      expect.arrayContaining(["GET /expenses", "POST /expenses", "PATCH /expenses/{id}", "POST /expenses/bulk", "GET /reports/{year}", "PUT /settings"]),
    );
    for (const r of Object.values(routes)) {
      expect((r["Properties"] as { AuthorizationType: string }).AuthorizationType).toBe("JWT");
    }
  });

  it("configures Cognito with the allowlist trigger and PKCE web client", () => {
    template.hasResourceProperties("AWS::Cognito::UserPool", {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
      LambdaConfig: Match.objectLike({ PreSignUp: Match.anyValue() }),
    });
    template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      GenerateSecret: false,
      AllowedOAuthFlows: ["code"],
      AllowedOAuthScopes: Match.arrayWith(["openid", "email", "profile"]),
      SupportedIdentityProviders: ["COGNITO"],
    });
    template.hasResourceProperties("AWS::Lambda::Function", {
      Environment: { Variables: Match.objectLike({ ALLOWED_EMAILS: "me@example.com" }) },
    });
  });

  it("gives the scan worker the Anthropic secret by default and nothing else", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Timeout: 360,
      Environment: { Variables: Match.objectLike({ EXTRACTOR_PROVIDER: "anthropic", CLAUDE_EFFORT: "medium" }) },
    });
    const policies = JSON.stringify(template.findResources("AWS::IAM::Policy"));
    expect(policies).toContain("secretsmanager:GetSecretValue");
    expect(policies).not.toContain("bedrock:InvokeModel");
    expect(policies).not.toContain("textract:AnalyzeExpense");
  });

  it("serves the SPA from a private bucket behind CloudFront with SPA fallbacks", () => {
    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        DefaultRootObject: "index.html",
        CustomErrorResponses: Match.arrayWith([Match.objectLike({ ErrorCode: 404, ResponseCode: 200, ResponsePagePath: "/index.html" })]),
        DefaultCacheBehavior: Match.objectLike({ ViewerProtocolPolicy: "redirect-to-https" }),
      }),
    });
    template.resourceCountIs("AWS::CloudFront::OriginAccessControl", 1);
  });
});

describe("provider variants", () => {
  it("grants Bedrock when selected", () => {
    const t = synth({ extractorProvider: "bedrock" });
    expect(JSON.stringify(t.findResources("AWS::IAM::Policy"))).toContain("bedrock:InvokeModel");
    t.hasResourceProperties("AWS::Lambda::Function", {
      Environment: { Variables: Match.objectLike({ EXTRACTOR_PROVIDER: "bedrock" }) },
    });
  });

  it("grants Textract when selected", () => {
    const t = synth({ extractorProvider: "textract" });
    expect(JSON.stringify(t.findResources("AWS::IAM::Policy"))).toContain("textract:AnalyzeExpense");
  });

  it("adds Google as an identity provider when a secret is named", () => {
    const t = synth({ googleSecretName: "simple-expenses/google" });
    t.hasResourceProperties("AWS::Cognito::UserPoolIdentityProvider", { ProviderType: "Google" });
    t.hasResourceProperties("AWS::Cognito::UserPoolClient", { SupportedIdentityProviders: ["COGNITO", "Google"] });
  });

  it("rejects an unknown provider", () => {
    expect(() => synth({ extractorProvider: "magic" })).toThrow(/extractorProvider/);
  });
});
