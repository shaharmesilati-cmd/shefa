// Finds purchases that were already saved, or that appear again in another screenshot.
// Screenshots usually overlap (you scroll and take another one), and OCR can read a name slightly differently,
// so names are compared loosely. Two identical purchases inside ONE screenshot are both kept (two coffees are real).
import { normMerchant } from './calc.js';

function bigrams(s) { const out = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); out.set(g, (out.get(g) || 0) + 1); } return out; }
export function similarity(a, b) {
  a = normMerchant(a); b = normMerchant(b);
  if (!a || !b) return 0;
  if (a === b || a.includes(b) || b.includes(a)) return 1;
  const A = bigrams(a), B = bigrams(b); let inter = 0, total = 0;
  for (const [g, n] of A) { inter += Math.min(n, B.get(g) || 0); total += n; }
  for (const n of B.values()) total += n;
  return total ? (2 * inter) / total : 0;
}
export function samePurchase(a, b) {
  if (a.date !== b.date) return false;
  if (Math.abs(Number(a.amount) - Number(b.amount)) > 0.009) return false;
  if (a.time && b.time && a.time !== b.time) return false;
  return similarity(a.merchant, b.merchant) >= 0.55;
}

/**
 * groups: array of arrays (one per screenshot or file). Marks each row with dup = 'saved' | 'batch' | null.
 * Each existing purchase can cancel at most one new row, so real repeats are not lost.
 */
export function markDuplicates(groups, saved) {
  const pool = saved.map(t => ({ t, used: false }));
  const accepted = [];
  for (const group of groups) {
    const usedHere = new Set();
    for (const r of group) {
      r.dup = null;
      const s = pool.find(p => !p.used && samePurchase(p.t, r));
      if (s) { s.used = true; r.dup = 'saved'; continue; }
      const b = accepted.find(p => !p.used && !usedHere.has(p) && p.group !== group && samePurchase(p.r, r));
      if (b) { b.used = true; r.dup = 'batch'; if (!b.r.time && r.time) b.r.time = r.time; continue; }
      const entry = { r, group, used: false };
      accepted.push(entry); usedHere.add(entry);
    }
  }
  return groups.flat();
}
