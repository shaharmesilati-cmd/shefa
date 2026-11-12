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
/** A purchase the card company has not "received" yet shows no shop name - the real name comes later. */
export const isPlaceholder = m => /טרם\s*נקלט|בתהליך\s*קליטה|^\s*pending\s*$/i.test(String(m || ''));
const DAY = 86400000;
const daysApart = (x, y) => Math.abs(new Date(x + 'T12:00') - new Date(y + 'T12:00')) / DAY;

/** A name the screen reader mangled: Latin letters mixed with digits or quote marks, or hardly any letters at all. */
const looksGarbled = m => { m = String(m || ''); return !m.trim() || (/[A-Za-z]/.test(m) && /[\d'’"`|\\]/.test(m)) || !/[\u0590-\u05FFA-Za-z]{3}/.test(m); };
/** Two card numbers that are the same, or differ in one digit (a misread), or one is missing. */
const cardsAgree = (x, y) => !x || !y || x === y || [...x].filter((c, i) => c !== y[i]).length <= 1;

export function samePurchase(a, b, ignoreCard = false) {
  if (Math.abs(Number(a.amount) - Number(b.amount)) > 0.009) return false;
  if (a.time && b.time && a.time !== b.time) return false;
  // same shop and amount on two different cards = two purchases. Against saved purchases a missing or misread card still matches.
  if (ignoreCard ? !cardsAgree(a.card, b.card) : (a.card && b.card && a.card !== b.card)) return false;
  const sim = similarity(a.merchant, b.merchant);
  // a row whose date could not be read got a guessed date: compare the shop name strictly instead, within a week
  if (a.date !== b.date) return !!(a.dateGuessed || b.dateGuessed) && daysApart(a.date, b.date) <= 7 && sim >= 0.8;
  // "טרם נקלט" on one side: the same day and the same amount is the same purchase
  if (isPlaceholder(a.merchant) || isPlaceholder(b.merchant)) return true;
  if (sim >= 0.55) return true;
  // the screen reader may garble a name differently in two screenshots. Same day + same exact amount with agorot
  // (278.01) is practically never a coincidence; a round amount (12.00) still needs the names to look somewhat alike.
  if (sim >= 0.35) return true;
  // only when one of the names really looks like a bad reading, the amount has agorot, and the card does not disagree
  const cents = Math.round(Number(a.amount) * 100) % 100 !== 0;
  const garbled = looksGarbled(a.merchant) || looksGarbled(b.merchant);
  return cents && garbled && (!a.card || !b.card || a.card === b.card);
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
      // against what is already saved, the card may have been missing or wrong before: match anyway, the card gets corrected
      const s = pool.find(p => !p.used && samePurchase(p.t, r, true));
      if (s) { s.used = true; r.dup = 'saved'; r.dupOf = s.t.id; continue; }
      // the same purchase in several overlapping screenshots: each accepted purchase can absorb one row per screenshot
      const b = accepted.find(p => !usedHere.has(p) && p.group !== group && samePurchase(p.r, r));
      if (b) { usedHere.add(b); r.dup = 'batch'; if (!b.r.time && r.time) b.r.time = r.time; continue; }
      const entry = { r, group };
      accepted.push(entry); usedHere.add(entry);
    }
  }
  return groups.flat();
}
