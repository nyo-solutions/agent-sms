#!/usr/bin/env node
import { App, Tags } from "aws-cdk-lib";
import { SmsStack } from "../lib/sms-stack";
import { GithubStack } from "../lib/github-stack";

const app = new App();
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: "us-east-1" };
Tags.of(app).add("project", "agent-sms");

// The webhook secret comes from the environment (the deploy workflow passes the ops repo's secret).
const webhookSecret = process.env.SMS_WEBHOOK_SECRET;
if (webhookSecret) {
  new SmsStack(app, "AgentSms", {
    env,
    description: "agent-sms: function URL that stores forwarded SMS, and the table agents read",
    webhookSecret,
    retentionDays: Number(app.node.tryGetContext("retentionDays")) || undefined,
  });
}

// Only synthesised when a repo is given (setup-github.sh does that).
const githubRepo: string | undefined = app.node.tryGetContext("githubRepo") || process.env.GITHUB_REPO;
if (githubRepo) {
  new GithubStack(app, "AgentSmsGithub", {
    env,
    description: "agent-sms: GitHub Actions OIDC deploy role",
    repo: githubRepo,
    subPrefix: app.node.tryGetContext("githubSubPrefix") || undefined,
    existingProviderArn: app.node.tryGetContext("oidcProviderArn") || undefined,
  });
}

if (!webhookSecret && !githubRepo) {
  throw new Error("Nothing to synthesise: set SMS_WEBHOOK_SECRET (deploy) or GITHUB_REPO (setup-github.sh)");
}
