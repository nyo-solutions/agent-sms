#!/bin/bash
# One-time: let GitHub Actions in your PRIVATE ops repo deploy agent-sms with short-lived AWS
# credentials (OIDC, no stored keys), and set the repo variable/secret the deploy workflow needs.
# Needs: admin AWS credentials and `gh auth login` with access to the ops repo.
# Usage: GITHUB_REPO=your-org/agent-sms-ops ./setup-github.sh [--new-secret]
#   --new-secret  generate SMS_WEBHOOK_SECRET, store it as a repo secret, and keep a copy in
#                 ~/.config/agent-sms/webhook-secret (mode 600) for setting up the phone app.
set -euo pipefail
cd "$(dirname "$0")"
export AWS_REGION=us-east-1 AWS_DEFAULT_REGION=us-east-1
REPO=${GITHUB_REPO:?set GITHUB_REPO=owner/repo (the private repo whose workflow deploys)}
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
[ -d node_modules ] || npm ci --no-audit --no-fund

# CDK bootstrap (no-op if the account is already bootstrapped in us-east-1).
aws cloudformation describe-stacks --stack-name CDKToolkit >/dev/null 2>&1 || npx cdk bootstrap "aws://$ACCOUNT/us-east-1"

PROVIDER=$(aws iam list-open-id-connect-providers --query "OpenIDConnectProviderList[?ends_with(Arn, 'token.actions.githubusercontent.com')].Arn | [0]" --output text | grep -v '^None$' || true)
# GitHub may send an immutable subject (repo:org@id/repo@id); trust exactly what it sends.
SUB=$(gh api "repos/$REPO/actions/oidc/customization/sub" --jq 'if .use_immutable_subject then .sub_claim_prefix else empty end' 2>/dev/null || true)
SUB=${SUB:-repo:$REPO}; echo "GitHub OIDC subject: $SUB:ref:refs/heads/main"
CTX=(-c githubRepo="$REPO" -c githubSubPrefix="$SUB"); [ -n "$PROVIDER" ] && { echo "Reusing GitHub OIDC provider"; CTX+=(-c oidcProviderArn="$PROVIDER"); }
CDK_DEFAULT_ACCOUNT=$ACCOUNT npx cdk deploy AgentSmsGithub "${CTX[@]}" --require-approval never

ROLE=$(aws cloudformation describe-stacks --stack-name AgentSmsGithub --query "Stacks[0].Outputs[?OutputKey=='RoleArn'].OutputValue | [0]" --output text)
gh variable set AWS_ROLE_ARN --repo "$REPO" --body "$ROLE"

if [ "${1:-}" = "--new-secret" ]; then
  DIR="$HOME/.config/agent-sms"; mkdir -p "$DIR"; chmod 700 "$DIR"
  ( umask 077; openssl rand -hex 32 > "$DIR/webhook-secret" )
  gh secret set SMS_WEBHOOK_SECRET --repo "$REPO" < "$DIR/webhook-secret"
  echo "New SMS_WEBHOOK_SECRET stored in $REPO and in $DIR/webhook-secret (redeploy, then update the phone app)."
fi
echo "GitHub Actions in $REPO can now deploy agent-sms. Run its 'Deploy agent-sms' workflow."
