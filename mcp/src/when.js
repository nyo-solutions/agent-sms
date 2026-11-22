// Time arguments for the tools: relative ("90s", "15m", "2h", "1d" = that long ago, "now"),
// an ISO date/time ("2026-11-22T10:00:00Z", "2026-11-22"), or epoch milliseconds.
const UNITS = { s: 1e3, m: 60e3, h: 3600e3, d: 86400e3 };

export function parseWhen(value, now = Date.now()) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  const v = String(value).trim();
  if (v.toLowerCase() === 'now') return now;
  const rel = /^(\d+(?:\.\d+)?)\s*([smhd])$/i.exec(v);
  if (rel) return now - Math.round(Number(rel[1]) * UNITS[rel[2].toLowerCase()]);
  if (/^\d{12,14}$/.test(v)) return Number(v);
  const t = Date.parse(v);
  if (Number.isNaN(t)) throw new Error(`Cannot read time "${value}": use e.g. "15m", "2h", "1d", "now", an ISO time, or epoch ms`);
  return t;
}

export const iso = (ms) => new Date(ms).toISOString();
