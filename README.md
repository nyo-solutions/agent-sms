# agent-sms

Give an AI agent its own phone number. An Android phone forwards every text it receives to your
AWS account; an MCP server lets the agent read them, for example to finish a sign-up with an SMS
verification code.

```
SMS ──▶ Android phone ──HTTPS + HMAC──▶ Lambda function URL ──▶ DynamoDB (30-day TTL)
        (SMS to URL Forwarder)                                     ▲
                                              agent ◀── MCP server ┘ (your AWS credentials)
```

- **Real number, real SMS.** Any SIM or eSIM in an Android phone: sites that refuse VoIP numbers accept it.
- **Nothing to read from the internet.** The function URL only accepts texts signed with your secret;
  reading goes straight to DynamoDB with your own AWS credentials.
- **Costs pennies.** Lambda + DynamoDB on demand; texts expire after 30 days.

| Folder | What |
|---|---|
| `aws/` | CDK stack `AgentSms` (function URL + table), `setup-github.sh`, `phone-config.sh` |
| `mcp/` | MCP server with `list_sms` and `wait_for_sms` |
| `ops-template/` | Deploy workflow to copy into your private ops repo |
| `docs/phone-setup.md` | Installing and configuring the Android app |

## Set up

1. **Deploy** (from a private ops repo, so run logs stay private): follow
   [`ops-template/README.md`](ops-template/README.md). It creates a GitHub OIDC deploy role, the
   `SMS_WEBHOOK_SECRET` repo secret, and runs the reusable workflow
   [`sms-deploy.yml`](.github/workflows/sms-deploy.yml).
2. **Phone:** see [`docs/phone-setup.md`](docs/phone-setup.md).
3. **Agent:** add the MCP server (needs AWS credentials that can `dynamodb:Query` the `agent-sms` table):
   ```bash
   cd mcp && npm ci
   claude mcp add --scope user agent-sms -- node "$PWD/src/server.js"
   ```
   Settings via environment: `AWS_PROFILE`, `AGENT_SMS_REGION` (default `us-east-1`),
   `AGENT_SMS_TABLE` (default `agent-sms`), `AGENT_SMS_INBOX` (default `default`).

## The tools

Both return each text with `from`, `text`, `received_at`, `age_seconds`, `id` and `code`: the
one-time code picked out of the text (`null` if there is no clear one).

**`list_sms`**: texts in a time window, newest first. `since` (default `24h`), `until` (default now),
`from` and `contains` filters, `limit`.

**`wait_for_sms`**: returns the newest text that matches, waiting for one if needed.
- **Texts that already arrived count.** It looks back to `since` (default `2m`) before waiting,
  so it doesn't matter whether the text landed before or after the call. Use `since: "now"` to
  accept only new texts, or a longer window (`"30m"`, an ISO time) to pick up an older one.
- **Waiting:** checks every `poll_seconds` (3) for up to `timeout_seconds` (120, max 900; `0` just
  checks once). On timeout it returns `found: false`; call again to keep waiting.
- **A fresh code after a used one:** pass the used text's `id` as `after_id`; it and anything older
  are ignored.
- **Filters:** `from` (sender contains, ignoring spaces/dashes) and `contains` (body contains).

Times are relative (`"90s"`, `"15m"`, `"2h"`, `"1d"` = that long ago, `"now"`), ISO, or epoch ms.
The window is based on when the phone received the text.

## Security

See [SECURITY.md](SECURITY.md). In short: the webhook secret authenticates the phone; anyone with
read access to your AWS account can read the texts and see the secret in the Lambda settings.

## License

Apache-2.0
