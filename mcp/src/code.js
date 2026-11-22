// Picks the one-time code out of a verification text, or returns null.
// Prefers a number right after a word like "code"/"OTP"/"קוד", then a G-123456 style code,
// then the only 4-8 digit number in the text. Phone numbers, amounts and dates are skipped.
const KEYWORD = /(?:code|otp|pin|passcode|password|verification|verify|token|קוד|סיסמ[הא]|código|codice|code de|kod)\D{0,20}?(\d(?:[ -]?\d){3,7})(?!\d)/iu;
const PREFIXED = /\b[A-Z]{1,3}-(\d{4,8})\b/;
const STANDALONE = /(?<![\d.,:/+$€£₪-])\d{4,8}(?![\d.,:/%])/g;

const digits = (s) => s.replace(/\D/g, '');

export function extractCode(text) {
  if (typeof text !== 'string' || !text) return null;
  const k = KEYWORD.exec(text);
  if (k) return digits(k[1]);
  const p = PREFIXED.exec(text);
  if (p) return p[1];
  const all = [...new Set(text.match(STANDALONE) ?? [])];
  return all.length === 1 ? all[0] : null;
}
