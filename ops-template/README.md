# agent-sms ops repo template

Keep deployments in a small **private** repo so run logs (which show the webhook URL) are never
public. Its workflow calls the reusable one in `nyo-solutions/agent-sms`.

1. Create a private repo, e.g. `your-org/agent-sms-ops`, and copy `.github/` from here into it.
2. On your Mac, with admin AWS credentials and `gh auth login`:
   ```bash
   GITHUB_REPO=your-org/agent-sms-ops aws/setup-github.sh --new-secret
   ```
   It creates the OIDC role that only that repo's `main` branch can assume, sets the repo variable
   `AWS_ROLE_ARN`, and (with `--new-secret`) generates `SMS_WEBHOOK_SECRET`, stores it as a repo
   secret and keeps a copy in `~/.config/agent-sms/webhook-secret` for setting up the phone.
3. Run **Deploy agent-sms** from the ops repo's Actions tab. The run summary shows the webhook URL.

Pin `@main` in the workflow to a tag or commit SHA if you want deployments to change only when you choose.
To rotate the secret, run step 2 again with `--new-secret`, redeploy, and update the phone app.
