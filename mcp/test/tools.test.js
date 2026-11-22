import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCode } from '../src/code.js';
import { parseWhen } from '../src/when.js';
import { matches } from '../src/store.js';
import { listSms, waitForSms } from '../src/tools.js';

const NOW = Date.parse('2026-11-22T12:00:00Z');
const cfg = { table: 'agent-sms', inbox: 'default' };

// Fake table: evaluates the BETWEEN key condition and returns items newest first, in small pages.
function fakeDb(items) {
  const calls = [];
  return {
    calls,
    items,
    send: async (cmd) => {
      const v = cmd.input.ExpressionAttributeValues;
      calls.push(cmd.input);
      const rows = items
        .filter((it) => it.inbox.S === v[':i'].S && it.sk.S >= v[':lo'].S && it.sk.S <= v[':hi'].S)
        .sort((a, b) => (a.sk.S < b.sk.S ? 1 : -1));
      const start = cmd.input.ExclusiveStartKey ? rows.findIndex((r) => r.sk.S === cmd.input.ExclusiveStartKey.sk.S) + 1 : 0;
      const page = rows.slice(start, start + 2);
      return { Items: page, LastEvaluatedKey: start + 2 < rows.length ? page.at(-1) : undefined };
    },
  };
}
const item = (id, from, text, receivedAt) => ({
  inbox: { S: 'default' }, sk: { S: `${String(receivedAt).padStart(13, '0')}#${id}` }, id: { S: id },
  from: { S: from }, text: { S: text }, receivedAt: { N: String(receivedAt) },
});

test('extractCode: common verification texts', () => {
  assert.equal(extractCode('Your Telnyx verification code is 482913.'), '482913');
  assert.equal(extractCode('G-381920 is your Google verification code.'), '381920');
  assert.equal(extractCode('קוד האימות שלך הוא: 5521'), '5521');
  assert.equal(extractCode('Use code 123 456 to sign in'), '123456');
  assert.equal(extractCode('Your one-time password: 77421'), '77421');
  assert.equal(extractCode('Hi, call me on +972501234567 later'), null);
  assert.equal(extractCode('Paid ₪1250.00 on 22/11/2026'), null);
  assert.equal(extractCode('Two numbers 1234 and 5678'), null);
  assert.equal(extractCode('8841'), '8841');
  assert.equal(extractCode(''), null);
});

test('parseWhen: relative, now, ISO and epoch', () => {
  assert.equal(parseWhen('15m', NOW), NOW - 15 * 60e3);
  assert.equal(parseWhen('2h', NOW), NOW - 2 * 3600e3);
  assert.equal(parseWhen('1d', NOW), NOW - 86400e3);
  assert.equal(parseWhen('90s', NOW), NOW - 90e3);
  assert.equal(parseWhen('now', NOW), NOW);
  assert.equal(parseWhen('2026-11-22T10:00:00Z', NOW), Date.parse('2026-11-22T10:00:00Z'));
  assert.equal(parseWhen('1795000000000', NOW), 1795000000000);
  assert.equal(parseWhen(undefined, NOW), undefined);
  assert.throws(() => parseWhen('yesterday-ish', NOW), /Cannot read time/);
});

test('matches: sender ignores spaces/dashes, body is case-insensitive', () => {
  const m = { from: '+972 50-123-4567', text: 'Your CODE is 1234' };
  assert.ok(matches(m, { from: '+97250123' }));
  assert.ok(matches(m, { contains: 'code is' }));
  assert.ok(!matches(m, { from: 'Telnyx' }));
});

test('list_sms: time window, filters, newest first, paging', async () => {
  const db = fakeDb([
    item('a', 'Telnyx', 'code 111111', NOW - 3 * 3600e3),
    item('b', 'Bank', 'Paid ₪50', NOW - 2 * 3600e3),
    item('c', 'Telnyx', 'code 222222', NOW - 30 * 60e3),
    item('d', 'Telnyx', 'code 333333', NOW - 5 * 60e3),
  ]);
  const all = await listSms({}, { db, cfg, now: NOW });
  assert.deepEqual(all.messages.map((m) => m.id), ['d', 'c', 'b', 'a']);
  assert.equal(all.messages[0].code, '333333');
  assert.equal(all.messages[0].sk, undefined, 'internal key is not returned');
  const window = await listSms({ since: '1h', from: 'telnyx' }, { db, cfg, now: NOW });
  assert.deepEqual(window.messages.map((m) => m.id), ['d', 'c']);
  const until = await listSms({ since: '4h', until: '1h' }, { db, cfg, now: NOW });
  assert.deepEqual(until.messages.map((m) => m.id), ['b', 'a']);
  const limited = await listSms({ limit: 1 }, { db, cfg, now: NOW });
  assert.deepEqual(limited.messages.map((m) => m.id), ['d']);
  await assert.rejects(listSms({ since: '1h', until: '2h' }, { db, cfg, now: NOW }), /until is before since/);
});

test('wait_for_sms: a text that already arrived inside the window is returned at once', async () => {
  const db = fakeDb([item('old', 'Telnyx', 'code 999999', NOW - 10 * 60e3), item('x', 'Telnyx', 'Your code is 482913', NOW - 40e3)]);
  const r = await waitForSms({ from: 'Telnyx' }, { db, cfg, clock: () => NOW, sleep: async () => assert.fail('should not wait') });
  assert.equal(r.found, true);
  assert.equal(r.message.id, 'x');
  assert.equal(r.message.code, '482913');
  assert.equal(r.other_matches, 0, 'the 10-minute-old text is outside the default 2m window');
});

test('wait_for_sms: waits until a matching text arrives', async () => {
  const db = fakeDb([]);
  let t = NOW;
  const sleep = async (ms) => {
    t += ms;
    if (t >= NOW + 9000 && !db.items.length) db.items.push(item('new', 'Telnyx', 'code 555555', t - 500));
  };
  const r = await waitForSms({ since: 'now', from: 'Telnyx', timeout_seconds: 60 }, { db, cfg, clock: () => t, sleep });
  assert.equal(r.found, true);
  assert.equal(r.message.code, '555555');
  assert.equal(r.waited_seconds, 9);
});

test('wait_for_sms: after_id skips a code already used; timeout reports not found', async () => {
  const db = fakeDb([item('used', 'Telnyx', 'code 111111', NOW - 20e3)]);
  let t = NOW;
  const r = await waitForSms({ after_id: 'used', timeout_seconds: 6 }, { db, cfg, clock: () => t, sleep: async (ms) => { t += ms; } });
  assert.equal(r.found, false);
  assert.equal(r.waited_seconds, 6);
  const now = await waitForSms({ timeout_seconds: 0 }, { db, cfg, clock: () => NOW, sleep: async () => {} });
  assert.equal(now.found, true, 'timeout 0 just checks');
});
