import test from "node:test";
import assert from "node:assert/strict";
import { makeHandler, sign, signatureOk, toItem, MAX_BODY_BYTES } from "../lambda/ingest.mjs";

const SECRET = "test-secret-0123456789abcdef"; // gitleaks:allow (test fixture)
const body = JSON.stringify({ from: "Telnyx", text: "Your code is 482913", sentStamp: 1795000000000, receivedStamp: 1795000001234, sim: "sim1" });

function setup() {
  const sent = [];
  const db = { send: async (cmd) => { sent.push(cmd.input); return {}; } };
  const handler = makeHandler({ db, env: { WEBHOOK_SECRET: SECRET, TABLE_NAME: "agent-sms", INBOX: "default" }, clock: () => 1795000005000 });
  return { handler, sent };
}
const event = (raw, headers = {}, method = "POST") => ({ requestContext: { http: { method } }, headers, body: raw, isBase64Encoded: false });

test("signature: matches the app's hex HMAC-SHA256 of the raw body, case-insensitive", () => {
  const sig = sign(SECRET, body);
  assert.match(sig, /^[0-9a-f]{64}$/);
  assert.ok(signatureOk(SECRET, body, sig));
  assert.ok(signatureOk(SECRET, body, sig.toUpperCase()));
  assert.ok(!signatureOk(SECRET, body + " ", sig));
  assert.ok(!signatureOk(SECRET, body, undefined));
  assert.ok(!signatureOk("", body, sign("", body)), "an unset secret never verifies");
});

test("stores a signed text with its key, times and expiry", async () => {
  const { handler, sent } = setup();
  const res = await handler(event(body, { "X-Signature": sign(SECRET, body) }));
  assert.equal(res.statusCode, 200);
  assert.equal(sent.length, 1);
  const { TableName, Item } = sent[0];
  assert.equal(TableName, "agent-sms");
  assert.equal(Item.inbox.S, "default");
  assert.match(Item.sk.S, /^1795000001234#[0-9a-f]{16}$/);
  assert.equal(Item.from.S, "Telnyx");
  assert.equal(Item.text.S, "Your code is 482913");
  assert.equal(Item.receivedAt.N, "1795000001234");
  assert.equal(Item.sentAt.N, "1795000000000");
  assert.equal(Item.arrivedAt.N, "1795000005000");
  assert.equal(Item.expiresAt.N, String(Math.floor((1795000005000 + 30 * 864e5) / 1000)));
});

test("rejects unsigned, wrongly signed, non-POST, oversized and malformed requests", async () => {
  const { handler, sent } = setup();
  assert.equal((await handler(event(body))).statusCode, 401);
  assert.equal((await handler(event(body, { "x-signature": sign("other", body) }))).statusCode, 401);
  assert.equal((await handler(event(body, { "x-signature": sign(SECRET, body) }, "GET"))).statusCode, 405);
  const big = JSON.stringify({ from: "x", text: "a".repeat(MAX_BODY_BYTES) });
  assert.equal((await handler(event(big, { "x-signature": sign(SECRET, big) }))).statusCode, 413);
  for (const bad of ["not json", "[]", JSON.stringify({ from: "x" }), JSON.stringify({ text: "y" })]) {
    assert.equal((await handler(event(bad, { "x-signature": sign(SECRET, bad) }))).statusCode, 400, bad);
  }
  assert.equal(sent.length, 0);
});

test("base64 bodies are decoded before verifying", async () => {
  const { handler, sent } = setup();
  const res = await handler({ ...event(Buffer.from(body).toString("base64"), { "x-signature": sign(SECRET, body) }), isBase64Encoded: true });
  assert.equal(res.statusCode, 200);
  assert.equal(sent.length, 1);
});

test("retries of the same body get the same key; missing stamps fall back to arrival time", () => {
  const a = toItem(body, { inbox: "default", now: 1 });
  const b = toItem(body, { inbox: "default", now: 999 });
  assert.equal(a.sk.S, b.sk.S);
  const bare = toItem(JSON.stringify({ from: "+972500000000", text: "hi" }), { inbox: "default", now: 1795000009000 });
  assert.equal(bare.receivedAt.N, "1795000009000");
  assert.equal(bare.sentAt, undefined);
  const strStamp = toItem(JSON.stringify({ from: "x", text: "y", receivedStamp: "1795000001234" }), { inbox: "default", now: 5 });
  assert.equal(strStamp.receivedAt.N, "1795000001234");
});
