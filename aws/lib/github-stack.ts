import { Arn, CfnOutput, Duration, Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as iam from "aws-cdk-lib/aws-iam";

export interface GithubStackProps extends StackProps {
  repo: string; // "your-org/your-ops-repo"
  /** OIDC sub prefix GitHub actually sends, e.g. "repo:org@123/repo@456" when the repo uses immutable subjects. */
  subPrefix?: string;
  existingProviderArn?: string; // reuse an account-wide GitHub OIDC provider if one exists
}

/** Lets GitHub Actions (main branch of one private ops repo) deploy agent-sms. No stored keys. */
export class GithubStack extends Stack {
  constructor(scope: Construct, id: string, props: GithubStackProps) {
    super(scope, id, props);
    const provider = props.existingProviderArn
      ? iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(this, "Provider", props.existingProviderArn)
      : new iam.OpenIdConnectProvider(this, "Provider", { url: "https://token.actions.githubusercontent.com", clientIds: ["sts.amazonaws.com"] });

    const role = new iam.Role(this, "Role", {
      roleName: "agent-sms-github",
      maxSessionDuration: Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": `${props.subPrefix ?? `repo:${props.repo}`}:ref:refs/heads/main`,
        },
      }),
    });
    // Deploys go through the CDK bootstrap roles.
    role.addToPolicy(new iam.PolicyStatement({
      actions: ["sts:AssumeRole"],
      resources: [`arn:aws:iam::${this.account}:role/cdk-hnb659fds-*-${this.account}-${this.region}`],
    }));
    // Read the stack outputs for the run summary.
    role.addToPolicy(new iam.PolicyStatement({
      actions: ["cloudformation:DescribeStacks"],
      resources: [Arn.format({ service: "cloudformation", resource: "stack", resourceName: "AgentSms/*" }, this)],
    }));

    new CfnOutput(this, "RoleArn", { value: role.roleArn });
  }
}
