import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as path from "node:path";

export interface SmsStackProps extends StackProps {
  /** Shared with the phone app ("Sign with HMAC-SHA-256"). Becomes a Lambda environment variable. */
  webhookSecret: string;
  /** Days a text is kept before DynamoDB deletes it. */
  retentionDays?: number;
}

/** Function URL that receives forwarded SMS, and the table the agent reads them from. */
export class SmsStack extends Stack {
  constructor(scope: Construct, id: string, props: SmsStackProps) {
    super(scope, id, props);
    if (props.webhookSecret.length < 32) throw new Error("webhookSecret must be at least 32 characters");

    // One partition per inbox (phone). Sort key "<receivedAt ms, 13 digits>#<id>" keeps texts in time order.
    const table = new dynamodb.Table(this, "Messages", {
      tableName: "agent-sms",
      partitionKey: { name: "inbox", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "expiresAt",
      removalPolicy: RemovalPolicy.DESTROY, // texts are short-lived by design
    });

    const fn = new lambda.Function(this, "Ingest", {
      functionName: "agent-sms-ingest",
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      handler: "ingest.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "..", "lambda")),
      memorySize: 128,
      timeout: Duration.seconds(10),
      reservedConcurrentExecutions: 2, // caps cost if the URL is ever flooded
      environment: {
        TABLE_NAME: table.tableName,
        INBOX: "default",
        RETENTION_DAYS: String(props.retentionDays ?? 30),
        WEBHOOK_SECRET: props.webhookSecret,
      },
      logGroup: new logs.LogGroup(this, "IngestLogs", { retention: logs.RetentionDays.TWO_WEEKS, removalPolicy: RemovalPolicy.DESTROY }),
    });
    table.grant(fn, "dynamodb:PutItem");

    const url = fn.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });

    new CfnOutput(this, "WebhookUrl", { value: url.url, description: "Paste into the phone app as the webhook URL" });
    new CfnOutput(this, "TableName", { value: table.tableName });
  }
}
