#!/bin/bash
# Writes a rules file for the phone app ("SMS to URL Forwarder" → Settings → Import), so the
# webhook URL and HMAC secret don't have to be typed on the phone.
# Usage: ./phone-config.sh [sim-slot]   (sim-slot: 0 = any SIM (default), 1 or 2 = only that SIM)
# Reads the URL from the deployed AgentSms stack and the secret from ~/.config/agent-sms/webhook-secret.
# The output file holds the secret in plain text: delete it from the phone and Mac after importing.
set -euo pipefail
export AWS_REGION=us-east-1 AWS_DEFAULT_REGION=us-east-1
DIR="$HOME/.config/agent-sms"
SECRET_FILE="$DIR/webhook-secret"
[ -s "$SECRET_FILE" ] || { echo "No $SECRET_FILE (run setup-github.sh --new-secret first)" >&2; exit 1; }
URL=$(aws cloudformation describe-stacks --stack-name AgentSms --query "Stacks[0].Outputs[?OutputKey=='WebhookUrl'].OutputValue | [0]" --output text)
[ -n "$URL" ] && [ "$URL" != "None" ] || { echo "AgentSms stack has no WebhookUrl output (deploy it first)" >&2; exit 1; }
OUT="$DIR/sms-gateway-backup.json"
( umask 077
  URL="$URL" SIM="${1:-0}" node -e '
    const fs = require("fs");
    const secret = fs.readFileSync(process.argv[1], "utf8").trim();
    const rule = {
      key: "agent-sms", sender: "*", is_sender_regex: false, sms_filter: "", url: process.env.URL,
      sim_slot: Number(process.env.SIM) || 0,
      template: "{\n  \"from\":\"%from%\",\n  \"text\":\"%text%\",\n  \"sentStamp\":%sentStamp%,\n  \"receivedStamp\":%receivedStamp%,\n  \"sim\":\"%sim%\"\n}",
      headers: "{\"User-agent\":\"SMS Forwarder App\"}",
      retries_number: 10, ignore_ssl: false, chunked_mode: false, // fixed Content-Length is_sms_enabled: true,
      sign_hmac_sha256: true, sign_hmac_sha256_secret: secret, store_failed: true, local_mode: false,
    };
    fs.writeFileSync(process.argv[2], JSON.stringify([rule], null, 2) + "\n");
  ' "$SECRET_FILE" "$OUT" )
echo "Wrote $OUT. Send it to the phone, import it in the app (Settings → Import), then delete it."
