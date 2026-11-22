// Tool logic, separate from the MCP wiring so it can be tested with a fake table.
import { queryMessages } from './store.js';
import { iso, parseWhen } from './when.js';

const strip = ({ sk, ...m }) => m;
const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function listSms(args, { db, cfg, now = Date.now() }) {
  const since = parseWhen(args.since ?? '24h', now);
  const until = parseWhen(args.until, now);
  if (until !== undefined && until < since) throw new Error('until is before since');
  const limit = Math.min(Math.max(args.limit ?? 20, 1), 100);
  const msgs = await queryMessages(db, cfg, { since, until, from: args.from, contains: args.contains, limit, now });
  return { since: iso(since), until: iso(until ?? now), count: msgs.length, messages: msgs.map(strip) };
}

/** Texts newer than the one with id `afterId` (newest-first list). Unknown id: keep all. */
function newerThan(msgs, afterId) {
  if (!afterId) return msgs;
  const i = msgs.findIndex((m) => m.id === afterId);
  return i === -1 ? msgs : msgs.slice(0, i);
}

export async function waitForSms(args, { db, cfg, clock = Date.now, sleep = realSleep }) {
  const start = clock();
  const since = parseWhen(args.since ?? '2m', start);
  const timeoutMs = Math.min(Math.max(args.timeout_seconds ?? 120, 0), 900) * 1000;
  const pollMs = Math.min(Math.max(args.poll_seconds ?? 3, 1), 30) * 1000;
  for (;;) {
    const now = clock();
    const msgs = newerThan(
      await queryMessages(db, cfg, { since, from: args.from, contains: args.contains, limit: 50, now }),
      args.after_id,
    );
    if (msgs.length) {
      return { found: true, message: strip(msgs[0]), other_matches: msgs.length - 1, searched_from: iso(since), waited_seconds: Math.round((now - start) / 1000) };
    }
    if (now - start >= timeoutMs) {
      return {
        found: false,
        searched_from: iso(since),
        waited_seconds: Math.round((now - start) / 1000),
        hint: 'No matching text yet. Check the from/contains filters, widen since, or call again to keep waiting.',
      };
    }
    await sleep(Math.min(pollMs, timeoutMs - (now - start)));
  }
}
