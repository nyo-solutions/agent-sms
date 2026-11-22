// Receives one SMS from the phone (SMS to URL Forwarder app) and stores it in DynamoDB.
// Runs as a Lambda function URL. Every request must carry X-Signature: hex HMAC-SHA256 of the raw
// body, keyed with the webhook secret (the app's "Sign with HMAC-SHA-256" option).
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";

export const MAX_BODY_BYTES = 16 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;

export function sign(secret, body) {
  return createHmac("sha256", Buffer.from(secret, "utf8")).update(body).digest("hex");
}

export function signatureOk(secret, body, header) {
  if (!secret || typeof header !== "string") return false;
  const want = Buffer.from(sign(secret, body), "utf8");
  const got = Buffer.from(header.trim().toLowerCase(), "utf8");
  return want.length === got.length && timingSafeEqual(want, got);
}

// Stamps from the app are epoch milliseconds (numbers or numeric strings).
function stamp(v) {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : undefined;
}

/** Turns the posted JSON into the stored item. Throws on anything unusable. */
export function toItem(rawBody, { inbox, now = Date.now(), retentionDays = 30 }) {
  let msg;
  try { msg = JSON.parse(rawBody); } catch { throw new Error("body is not JSON"); }
  if (!msg || typeof msg !== "object") throw new Error("body is not a JSON object");
  const from = typeof msg.from === "string" ? msg.from.trim() : "";
  const text = typeof msg.text === "string" ? msg.text : "";
  if (!from || !text) throw new Error("from and text are required");
  const receivedAt = stamp(msg.receivedStamp) ?? now;
  const sentAt = stamp(msg.sentStamp);
  // The same body always gets the same key, so the app's retries never store a text twice.
  const id = createHash("sha256").update(rawBody).digest("hex").slice(0, 16);
  const item = {
    inbox: { S: inbox },
    sk: { S: `${String(receivedAt).padStart(13, "0")}#${id}` },
    id: { S: id },
    from: { S: from.slice(0, 64) },
    text: { S: text.slice(0, 4000) },
    receivedAt: { N: String(receivedAt) },
    arrivedAt: { N: String(now) },
    expiresAt: { N: String(Math.floor((now + retentionDays * DAY_MS) / 1000)) },
  };
  if (sentAt) item.sentAt = { N: String(sentAt) };
  if (typeof msg.sim === "string" && msg.sim) item.sim = { S: msg.sim.slice(0, 64) };
  return item;
}

const reply = (statusCode, message) => ({ statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify({ message }) });

export function makeHandler({ db = new DynamoDBClient({}), env = process.env, clock = Date.now } = {}) {
  return async (event) => {
    if (event?.requestContext?.http?.method !== "POST") return reply(405, "POST only");
    const raw = event.isBase64Encoded ? Buffer.from(event.body ?? "", "base64").toString("utf8") : (event.body ?? "");
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return reply(413, "too large");
    const headers = Object.fromEntries(Object.entries(event.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    if (!signatureOk(env.WEBHOOK_SECRET, raw, headers["x-signature"])) return reply(401, "bad signature");
    let item;
    try {
      item = toItem(raw, { inbox: env.INBOX || "default", now: clock(), retentionDays: Number(env.RETENTION_DAYS) || 30 });
    } catch (e) {
      return reply(400, e.message); // 4xx: the app gives up instead of retrying a body that will never work
    }
    await db.send(new PutItemCommand({ TableName: env.TABLE_NAME, Item: item }));
    return reply(200, "stored");
  };
}

export const handler = makeHandler();
