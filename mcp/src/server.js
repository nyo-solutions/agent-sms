#!/usr/bin/env node
// MCP server: lets an AI agent read the SMS your phone forwards to agent-sms.
// Uses your own AWS credentials (AWS_PROFILE etc.) to read the DynamoDB table.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { config, makeDb } from './store.js';
import { listSms, waitForSms } from './tools.js';

const cfg = config();
const db = makeDb(cfg);
const server = new McpServer({ name: 'agent-sms', version: '0.1.0' });

const ok = (v) => ({ content: [{ type: 'text', text: JSON.stringify(v, null, 2) }] });
const fail = (e) => ({ isError: true, content: [{ type: 'text', text: String(e?.message || e) }] });
const wrap = (fn) => async (args) => { try { return ok(await fn(args)); } catch (e) { return fail(e); } };

const TIME = 'Relative ("30s", "15m", "2h", "1d" = that long ago, "now"), an ISO time, or epoch ms';

server.registerTool('list_sms', {
  title: 'List received SMS',
  description:
    'List text messages received on the agent\'s phone number, newest first, with any one-time code already extracted (field "code"). ' +
    'Use it to find a text that already arrived. Texts are kept for 30 days.',
  inputSchema: {
    since: z.string().optional().describe(`Start of the time window (default "24h"). ${TIME}`),
    until: z.string().optional().describe(`End of the time window (default now). ${TIME}`),
    from: z.string().optional().describe('Only texts whose sender contains this (case-insensitive), e.g. "Telnyx" or "+1555"'),
    contains: z.string().optional().describe('Only texts whose body contains this (case-insensitive)'),
    limit: z.number().int().min(1).max(100).optional().describe('Most texts to return (default 20)'),
  },
}, wrap((a) => listSms(a, { db, cfg })));

server.registerTool('wait_for_sms', {
  title: 'Wait for an SMS (e.g. a verification code)',
  description:
    'Return the newest text received since `since` that matches the filters, waiting for one to arrive if there is none yet. ' +
    'Texts that arrived before you called still count, as long as they are inside the window, so call this right after triggering the code (or just before). ' +
    'The result has the text and the extracted one-time code ("code"). To wait for a fresh code after one you already used, pass its id as after_id.',
  inputSchema: {
    since: z.string().optional().describe(`Count texts received from this time on (default "2m": the last 2 minutes). Use "now" for only new texts. ${TIME}`),
    from: z.string().optional().describe('Only texts whose sender contains this (case-insensitive)'),
    contains: z.string().optional().describe('Only texts whose body contains this (case-insensitive)'),
    after_id: z.string().optional().describe('Ignore this text and anything older (id from an earlier result)'),
    timeout_seconds: z.number().int().min(0).max(900).optional().describe('How long to wait if nothing matches yet (default 120, max 900; 0 = just check)'),
    poll_seconds: z.number().int().min(1).max(30).optional().describe('How often to check while waiting (default 3)'),
  },
}, wrap((a) => waitForSms(a, { db, cfg })));

await server.connect(new StdioServerTransport());
