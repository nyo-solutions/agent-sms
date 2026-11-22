// Reads texts from the agent-sms DynamoDB table with the caller's own AWS credentials.
import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { extractCode } from './code.js';
import { iso } from './when.js';

const pad = (ms) => String(Math.max(0, Math.trunc(ms))).padStart(13, '0');

export function config(env = process.env) {
  return {
    table: env.AGENT_SMS_TABLE || 'agent-sms',
    inbox: env.AGENT_SMS_INBOX || 'default',
    region: env.AGENT_SMS_REGION || env.AWS_REGION || 'us-east-1',
  };
}

export function toMessage(item, now = Date.now()) {
  const receivedAt = Number(item.receivedAt?.N);
  return {
    id: item.id?.S,
    from: item.from?.S,
    text: item.text?.S,
    code: extractCode(item.text?.S),
    received_at: iso(receivedAt),
    age_seconds: Math.max(0, Math.round((now - receivedAt) / 1000)),
    sk: item.sk?.S,
  };
}

const norm = (s) => String(s ?? '').toLowerCase().replace(/[\s()-]/g, '');

/** Case-insensitive substring filters; `from` also ignores spaces, dashes and brackets in numbers. */
export function matches(msg, { from, contains } = {}) {
  if (from && !norm(msg.from).includes(norm(from))) return false;
  if (contains && !String(msg.text ?? '').toLowerCase().includes(String(contains).toLowerCase())) return false;
  return true;
}

/** Texts received in [since, until], newest first, after applying the filters. */
export async function queryMessages(db, cfg, { since, until, from, contains, limit = 20, now = Date.now() }) {
  const lo = `${pad(since ?? 0)}#`;
  const hi = `${pad(until ?? now + 60_000)}$`; // '$' sorts after '#', so the until millisecond is included
  const out = [];
  let ExclusiveStartKey;
  do {
    const res = await db.send(new QueryCommand({
      TableName: cfg.table,
      KeyConditionExpression: 'inbox = :i AND sk BETWEEN :lo AND :hi',
      ExpressionAttributeValues: { ':i': { S: cfg.inbox }, ':lo': { S: lo }, ':hi': { S: hi } },
      ScanIndexForward: false,
      ExclusiveStartKey,
    }));
    for (const item of res.Items ?? []) {
      const m = toMessage(item, now);
      if (matches(m, { from, contains })) out.push(m);
      if (out.length >= limit) return out;
    }
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out;
}

export const makeDb = (cfg) => new DynamoDBClient({ region: cfg.region });
