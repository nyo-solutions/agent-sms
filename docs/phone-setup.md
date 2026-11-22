# Phone setup

Any Android phone (4.4 or newer) with the SIM or eSIM whose texts the agent should read.

## 1. Install the forwarder

Install **SMS to URL Forwarder** (open source, MIT) from F-Droid:
<https://f-droid.org/packages/tech.bogomolov.incomingsmsgateway/>.
It is not on Google Play; Play Protect may warn about it because it reads SMS.
Source: <https://github.com/bogkonstantin/android_income_sms_gateway_webhook>.

Open it once and allow **SMS** and **notifications**.

## 2. Add the forwarding rule

**Easiest: import.** On your Mac run `aws/phone-config.sh` (add `1` or `2` to forward only that SIM
on a dual-SIM phone). Send the file it writes to the phone, then in the app open
**Settings → Import** and pick it. Delete the file from both devices afterwards: it holds the secret.

**Or by hand:** tap **+** and set
- **Sender:** `*` (all senders)
- **Webhook URL:** the `WebhookUrl` from the deploy run summary
- **Template / headers:** leave the defaults (`from`, `text`, `sentStamp`, `receivedStamp`, `sim`)
- **Sign with HMAC-SHA-256:** on, with the webhook secret (`~/.config/agent-sms/webhook-secret`)
- **Chunked mode:** off

Requests without a valid signature are rejected, so the URL alone is useless to anyone else.

## 3. Keep it alive

- Settings → Apps → SMS to URL Forwarder → Battery → **Unrestricted** (no battery optimisation).
- On Xiaomi/Huawei/Samsung also allow **Autostart** / exclude it from "sleeping apps".
- Keep the phone on Wi-Fi or data and charging.

## 4. Test

Send a text to the phone, then ask your agent to call `list_sms`, or run
`aws dynamodb query --table-name agent-sms --key-condition-expression "inbox = :i" --expression-attribute-values '{":i":{"S":"default"}}' --no-scan-index-forward --max-items 1`.
If nothing arrives, the app's log screen shows the HTTP status of each attempt (401 = wrong secret).
