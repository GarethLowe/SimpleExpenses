import * as path from "node:path";
import * as fs from "node:fs";
import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  SecretValue,
  Stack,
  type StackProps,
} from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import { HttpJwtAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";
import type { StackConfig } from "./config.js";

export interface SimpleExpensesStackProps extends StackProps {
  config: StackConfig;
}

const REPO_ROOT = path.resolve(__dirname, "../../..");
const API_SRC = path.join(REPO_ROOT, "packages/api/src/handlers");
const WEB_DIST = path.join(REPO_ROOT, "packages/web/dist");

export class SimpleExpensesStack extends Stack {
  constructor(scope: Construct, id: string, props: SimpleExpensesStackProps) {
    super(scope, id, props);
    const { config } = props;

    // ---------------------------------------------------------------- storage
    const receipts = new s3.Bucket(this, "Receipts", {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [
        { abortIncompleteMultipartUploadAfter: Duration.days(2) },
        { noncurrentVersionExpiration: Duration.days(30) },
      ],
      cors: [
        {
          // Uploads and downloads go through short-lived presigned URLs, so the
          // origin check is not the access control; it just has to let the
          // browser make the request.
          allowedOrigins: ["*"],
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET, s3.HttpMethods.HEAD],
          allowedHeaders: ["*"],
          exposedHeaders: ["ETag"],
          maxAge: 3600,
        },
      ],
    });

    const table = new dynamodb.Table(this, "Table", {
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.RETAIN,
    });
    table.addGlobalSecondaryIndex({
      indexName: "GSI1",
      partitionKey: { name: "GSI1PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "GSI1SK", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ------------------------------------------------------------ scan queue
    const scanDlq = new sqs.Queue(this, "ScanDlq", { retentionPeriod: Duration.days(14) });
    const scanQueue = new sqs.Queue(this, "ScanQueue", {
      visibilityTimeout: Duration.minutes(6 * 6), // >= 6x the worker timeout
      deadLetterQueue: { queue: scanDlq, maxReceiveCount: 3 },
    });
    receipts.addEventNotification(s3.EventType.OBJECT_CREATED, new s3n.SqsDestination(scanQueue), { prefix: "users/" });

    // --------------------------------------------------------------- secrets
    const anthropicSecret = new secretsmanager.Secret(this, "AnthropicApiKey", {
      description: "Anthropic API key for receipt extraction. Set the value after deploy.",
      generateSecretString: { excludePunctuation: true, passwordLength: 8 }, // placeholder; replaced by the user
    });

    // ------------------------------------------------------------------ auth
    const preSignUp = new NodejsFunction(this, "PreSignUp", {
      entry: path.join(API_SRC, "preSignUp.ts"),
      ...lambdaDefaults(this, "PreSignUp"),
      environment: { ALLOWED_EMAILS: config.allowedEmails },
    });

    const userPool = new cognito.UserPool(this, "Users", {
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: true } },
      passwordPolicy: { minLength: 12 },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { sms: false, otp: true },
      removalPolicy: RemovalPolicy.RETAIN,
      lambdaTriggers: { preSignUp },
      featurePlan: cognito.FeaturePlan.ESSENTIALS,
    });

    const domain = userPool.addDomain("Domain", {
      cognitoDomain: {
        domainPrefix: config.cognitoDomainPrefix ?? `simple-expenses-${this.account}`,
      },
    });

    const providers: cognito.UserPoolClientIdentityProvider[] = [cognito.UserPoolClientIdentityProvider.COGNITO];
    if (config.googleSecretName) {
      const google = new cognito.UserPoolIdentityProviderGoogle(this, "Google", {
        userPool,
        clientId: SecretValue.secretsManager(config.googleSecretName, { jsonField: "clientId" }).unsafeUnwrap(),
        clientSecretValue: SecretValue.secretsManager(config.googleSecretName, { jsonField: "clientSecret" }),
        scopes: ["openid", "email", "profile"],
        attributeMapping: {
          email: cognito.ProviderAttribute.GOOGLE_EMAIL,
          givenName: cognito.ProviderAttribute.GOOGLE_GIVEN_NAME,
          familyName: cognito.ProviderAttribute.GOOGLE_FAMILY_NAME,
        },
      });
      providers.push(cognito.UserPoolClientIdentityProvider.GOOGLE);
      userPool.registerIdentityProvider(google);
    }
    if (config.appleSecretName) {
      const apple = new cognito.UserPoolIdentityProviderApple(this, "Apple", {
        userPool,
        clientId: SecretValue.secretsManager(config.appleSecretName, { jsonField: "clientId" }).unsafeUnwrap(),
        teamId: SecretValue.secretsManager(config.appleSecretName, { jsonField: "teamId" }).unsafeUnwrap(),
        keyId: SecretValue.secretsManager(config.appleSecretName, { jsonField: "keyId" }).unsafeUnwrap(),
        privateKeyValue: SecretValue.secretsManager(config.appleSecretName, { jsonField: "privateKey" }),
        scopes: ["email", "name"],
        attributeMapping: {
          email: cognito.ProviderAttribute.APPLE_EMAIL,
          givenName: cognito.ProviderAttribute.APPLE_FIRST_NAME,
          familyName: cognito.ProviderAttribute.APPLE_LAST_NAME,
        },
      });
      providers.push(cognito.UserPoolClientIdentityProvider.APPLE);
      userPool.registerIdentityProvider(apple);
    }

    // ------------------------------------------------------------ web hosting
    const webBucket = new s3.Bucket(this, "Web", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
    const distribution = new cloudfront.Distribution(this, "Cdn", {
      defaultRootObject: "index.html",
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(webBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: "/index.html", ttl: Duration.seconds(0) },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: "/index.html", ttl: Duration.seconds(0) },
      ],
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    });
    const webOrigin = `https://${distribution.distributionDomainName}`;
    const allOrigins = [webOrigin, ...config.devOrigins];

    const client = userPool.addClient("WebClient", {
      generateSecret: false,
      supportedIdentityProviders: providers,
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls: allOrigins.map((o) => `${o}/auth/callback`),
        logoutUrls: allOrigins.map((o) => `${o}/`),
      },
      preventUserExistenceErrors: true,
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
    });

    // ------------------------------------------------------------------- api
    const apiFn = new NodejsFunction(this, "Api", {
      entry: path.join(API_SRC, "http.ts"),
      ...lambdaDefaults(this, "Api"),
      timeout: Duration.seconds(29),
      memorySize: 512,
      environment: {
        TABLE_NAME: table.tableName,
        BUCKET_NAME: receipts.bucketName,
        SCAN_QUEUE_URL: scanQueue.queueUrl,
      },
    });
    table.grantReadWriteData(apiFn);
    receipts.grantReadWrite(apiFn);
    receipts.grantDelete(apiFn);
    scanQueue.grantSendMessages(apiFn);

    const issuer = `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`;
    const authorizer = new HttpJwtAuthorizer("Jwt", issuer, { jwtAudience: [client.userPoolClientId] });
    const api = new apigwv2.HttpApi(this, "HttpApi", {
      defaultAuthorizer: authorizer,
      corsPreflight: {
        allowOrigins: allOrigins,
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.PATCH,
          apigwv2.CorsHttpMethod.PUT,
          apigwv2.CorsHttpMethod.DELETE,
          apigwv2.CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ["authorization", "content-type"],
        maxAge: Duration.hours(1),
      },
    });
    const integration = new HttpLambdaIntegration("ApiIntegration", apiFn);
    const routes: Array<[apigwv2.HttpMethod, string]> = [
      [apigwv2.HttpMethod.GET, "/expenses"],
      [apigwv2.HttpMethod.POST, "/expenses"],
      [apigwv2.HttpMethod.POST, "/expenses/bulk"],
      [apigwv2.HttpMethod.GET, "/expenses/{id}"],
      [apigwv2.HttpMethod.PATCH, "/expenses/{id}"],
      [apigwv2.HttpMethod.DELETE, "/expenses/{id}"],
      [apigwv2.HttpMethod.GET, "/expenses/{id}/file"],
      [apigwv2.HttpMethod.POST, "/expenses/{id}/rescan"],
      [apigwv2.HttpMethod.GET, "/reports/{year}"],
      [apigwv2.HttpMethod.GET, "/settings"],
      [apigwv2.HttpMethod.PUT, "/settings"],
    ];
    for (const [method, p] of routes) api.addRoutes({ path: p, methods: [method], integration });

    // ----------------------------------------------------------- scan worker
    const scanFn = new NodejsFunction(this, "Scan", {
      entry: path.join(API_SRC, "scan.ts"),
      ...lambdaDefaults(this, "Scan"),
      timeout: Duration.minutes(6),
      memorySize: 1024,
      environment: {
        TABLE_NAME: table.tableName,
        BUCKET_NAME: receipts.bucketName,
        SCAN_QUEUE_URL: scanQueue.queueUrl,
        EXTRACTOR_PROVIDER: config.extractorProvider,
        CLAUDE_EFFORT: config.claudeEffort,
        ...(config.claudeModel ? { CLAUDE_MODEL: config.claudeModel } : {}),
        ANTHROPIC_API_KEY_SECRET_ARN: anthropicSecret.secretArn,
      },
    });
    table.grantReadWriteData(scanFn);
    receipts.grantRead(scanFn);
    scanFn.addEventSource(new SqsEventSource(scanQueue, { batchSize: 1, reportBatchItemFailures: true, maxConcurrency: 5 }));
    if (config.extractorProvider === "anthropic") anthropicSecret.grantRead(scanFn);
    if (config.extractorProvider === "bedrock") {
      scanFn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
          resources: ["*"],
        }),
      );
    }
    if (config.extractorProvider === "textract") {
      scanFn.addToRolePolicy(new iam.PolicyStatement({ actions: ["textract:AnalyzeExpense"], resources: ["*"] }));
    }

    // -------------------------------------------------------- web deployment
    const runtimeConfig = {
      region: this.region,
      apiUrl: api.apiEndpoint,
      userPoolId: userPool.userPoolId,
      clientId: client.userPoolClientId,
      cognitoDomain: domain.baseUrl(),
      issuer,
    };
    if (fs.existsSync(path.join(WEB_DIST, "index.html"))) {
      new s3deploy.BucketDeployment(this, "WebDeploy", {
        destinationBucket: webBucket,
        distribution,
        distributionPaths: ["/*"],
        sources: [s3deploy.Source.asset(WEB_DIST), s3deploy.Source.jsonData("config.json", runtimeConfig)],
        prune: true,
        memoryLimit: 512,
      });
    } else {
      this.node.addMetadata("web-dist-missing", `No web build found at ${WEB_DIST}; skipping site deployment.`);
    }

    // --------------------------------------------------------------- outputs
    new CfnOutput(this, "WebUrl", { value: webOrigin });
    new CfnOutput(this, "ApiUrl", { value: api.apiEndpoint });
    new CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new CfnOutput(this, "UserPoolClientId", { value: client.userPoolClientId });
    new CfnOutput(this, "CognitoDomain", { value: domain.baseUrl() });
    new CfnOutput(this, "ReceiptsBucket", { value: receipts.bucketName });
    new CfnOutput(this, "TableName", { value: table.tableName });
    new CfnOutput(this, "ScanQueueUrl", { value: scanQueue.queueUrl });
    new CfnOutput(this, "ScanDlqUrl", { value: scanDlq.queueUrl });
    new CfnOutput(this, "AnthropicApiKeySecretArn", { value: anthropicSecret.secretArn });
  }
}

function lambdaDefaults(scope: Construct, id: string) {
  return {
    runtime: lambda.Runtime.NODEJS_22_X,
    architecture: lambda.Architecture.ARM_64,
    logGroup: new logs.LogGroup(scope, `${id}Logs`, { retention: logs.RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.DESTROY }),
    projectRoot: REPO_ROOT,
    depsLockFilePath: path.join(REPO_ROOT, "package-lock.json"),
    bundling: {
      format: OutputFormat.ESM,
      target: "node22",
      minify: true,
      sourceMap: true,
      sourcesContent: false,
      mainFields: ["module", "main"],
      // ESM bundles of some AWS SDK deps still call require(); shim it.
      banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
    },
    environment: { NODE_OPTIONS: "--enable-source-maps" },
  } satisfies Partial<ConstructorParameters<typeof NodejsFunction>[2]>;
}
