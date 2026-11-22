# Security

## Reporting a vulnerability

Please report security issues privately through GitHub's **Report a vulnerability** button on this
repository (Security tab), not in public issues.

## Threat model

**Protects against**
- Strangers posting fake texts: every request needs `X-Signature`, a hex HMAC-SHA256 of the exact
  body keyed with your secret, compared in constant time. Unsigned or altered requests get 401.
- Strangers reading texts: there is no read endpoint. Texts are read from DynamoDB with your own
  AWS credentials.
- Floods running up a bill: the function has a reserved concurrency of 2 and a 16 KB body limit.
- Texts piling up: DynamoDB deletes them after 30 days (TTL).

**Does not protect against**
- Anyone with read access to your AWS account: they can read texts and see the secret in the Lambda
  environment and the CloudFormation template.
- A replayed signed request: the app's signature has no timestamp. A replay can only re-store the
  same text (same key), not create a new one.
- Someone with your phone: they can read its texts and the secret in the app's settings.
- An agent you give these tools to: it can read every text on the number, including codes for
  accounts that aren't its own. Use a number dedicated to the agent.
