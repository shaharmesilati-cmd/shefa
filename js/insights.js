// Short, friendly observations about the month (in the spirit of "we noticed..."). Pure functions, tested.
import { monthSummary, shiftKey, periodOf, isCounted, isoOf } from './calc.js';

const FOOD = new Set(['food']);

/** Spending per category in the previous month, up to the same day of the month (fair comparison). */
function prevSameDay(settings, tx, key, elapsed) {
  const pk = shiftKey(key, -1), sd = settings.startDay || 1;
  const { start } = periodOf(pk, sd);
  const cut = isoOf(new Date(start.getFullYear(), start.getMonth(), start.getDate() + Math.max(0, elapsed - 1)));
  const P = monthSummary(settings, tx, pk);
  const by = {};
  for (const t of P.variable) if (t.date <= cut) by[t.category || 'other'] = (by[t.category || 'other'] || 0) + t.amount;
  return { by, has: P.variable.length > 0 };
}

export function monthInsights(settings, tx, key, today = new Date()) {
  const C = monthSummary(settings, tx, key, today);
  const name = id => (settings.categories.find(c => c.id === id) || { name: 'שונות' }).name;
  const out = [];
  if (!C.variable.length) return { list: out, stats: null };

  // over budget categories
  for (const c of settings.categories) {
    const sp = C.byCat[c.id] || 0;
    if (c.budget > 0 && sp > c.budget) out.push({ tone: 'alert', icon: 'flame', text: `ב"${c.name}" עברת את התקציב ב-₪${Math.round(sp - c.budget).toLocaleString('he-IL')}.` });
  }

  // compared with last month, same point in the month
  const elapsed = C.isCurrent ? C.elapsed : C.total;
  const prev = prevSameDay(settings, tx, key, elapsed);
  if (prev.has) {
    let up = null, down = null;
    const ids = new Set([...Object.keys(C.byCat), ...Object.keys(prev.by)]);
    for (const id of ids) {
      if (id === 'other') continue;
      const a = C.byCat[id] || 0, b = prev.by[id] || 0, d = a - b;
      if (b > 0 && d >= 150 && d / b >= 0.25 && (!up || d > up.d)) up = { id, d, p: d / b };
      if (b > 0 && -d >= 100 && -d / b >= 0.15 && (!down || -d > down.d)) down = { id, d: -d, p: -d / b };
    }
    if (up) out.push({ tone: 'alert', icon: 'trend-up', text: `על "${name(up.id)}" הוצאת עד עכשיו ₪${Math.round(up.d).toLocaleString('he-IL')} יותר מבאותה נקודה בחודש שעבר (${Math.round(up.p * 100)}%+).` });
    if (down) out.push({ tone: 'good', icon: 'trend-down', text: `ההוצאות על "${name(down.id)}" ירדו ב-${Math.round(down.p * 100)}% לעומת החודש שעבר. כל הכבוד!` });
  }

  // eating out tip
  const food = Object.entries(C.byCat).filter(([id]) => FOOD.has(id)).reduce((a, [, v]) => a + v, 0);
  if (food >= 300 && C.spent > 0 && food / C.spent >= 0.12) {
    const half = Math.round(food / 2 / 10) * 10;
    out.push({ tone: 'tip', icon: 'piggy', text: `החודש יצאו ₪${Math.round(food).toLocaleString('he-IL')} על אוכל בחוץ. חצי מזה (בערך ₪${half.toLocaleString('he-IL')}) יכול לעבור לחיסכון.` });
  }

  // expected surplus -> goal
  if (C.isCurrent && C.elapsed >= 5 && C.projectedEnd > 200 && settings.goals.length) {
    const g = settings.goals.find(x => x.target > x.saved) || settings.goals[0];
    out.push({ tone: 'good', icon: 'target', text: `צפוי לך עודף של כ-₪${Math.round(C.projectedEnd).toLocaleString('he-IL')} בסוף החודש. אפשר להעביר אותו ל"${g.name || 'יעד החיסכון'}".` });
  }

  const order = { alert: 0, tip: 1, good: 2 };
  out.sort((a, b) => order[a.tone] - order[b.tone]);

  const biggest = C.variable.reduce((m, t) => (t.amount > m.amount ? t : m), C.variable[0]);
  const top = Object.entries(C.byCat).sort((a, b) => b[1] - a[1])[0];
  const days = Math.max(1, C.isCurrent ? C.elapsed : C.total);
  return {
    list: out.slice(0, 3),
    stats: { biggest, topCat: top ? { id: top[0], name: name(top[0]), amount: top[1] } : null, perDay: C.spent / days, count: C.variable.length },
  };
}

/** Purchases that still sit in "other" and were never confirmed - the "needs your attention" list. */
export function needsCategory(settings, tx, key) {
  const C = monthSummary(settings, tx, key);
  const known = new Set((settings.categories || []).map(c => c.id));
  // a category that was deleted counts as "שונות" too
  return C.inPeriod.filter(t => isCounted(t) && t.kind === 'expense' && (!t.category || t.category === 'other' || !known.has(t.category)) && !t.confirmed && !t.fixedId && !/טרם\s*נקלט/.test(t.merchant || ''))
    .sort((a, b) => b.amount - a.amount);
}

// Payment apps: the name says nothing about what was bought, so a choice applies only to that one purchase.
export const isGenericMerchant = m => /bit|ביט|paybox|פייבוקס|paypal|פייפאל|apple ?pay|google ?pay|העברה|העברת|pepper ?pay/i.test(String(m || ''));

/**
 * Days in a row (ending yesterday) where spending stayed within the daily allowance of that month.
 * Counting starts only from the first day the user has any purchase, so an empty app has no streak.
 */
export function budgetStreak(settings, tx, today = new Date()) {
  const exp = tx.filter(t => t.kind === 'expense' && !t.ignored && !t.fixedId && t.date && t.category !== 'refund');
  if (!exp.length) return 0;
  const first = exp.reduce((m, t) => (t.date < m ? t.date : m), exp[0].date);
  const byDay = {};
  for (const t of exp) byDay[t.date] = (byDay[t.date] || 0) + t.amount;
  const cache = {};
  const allowance = iso => {
    const k = budgetKeyOfLocal(iso, settings.startDay || 1);
    if (!(k in cache)) { const C = monthSummary(settings, tx, k, today); cache[k] = C.total ? Math.max(0, C.available) / C.total : 0; }
    return cache[k];
  };
  let n = 0;
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  for (let i = 0; i < 366; i++, d.setDate(d.getDate() - 1)) {
    const iso = isoOf(d);
    if (iso < first) break;
    const a = allowance(iso);
    if (a <= 0 || (byDay[iso] || 0) > a) break;
    n++;
  }
  return n;
}
function budgetKeyOfLocal(iso, sd) { const [y, m, dd] = iso.split('-').map(Number); const t = dd >= sd ? new Date(y, m - 1, 1) : new Date(y, m - 2, 1); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`; }
