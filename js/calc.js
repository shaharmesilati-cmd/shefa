// Pure budget math. No DOM, no storage - tested in tests/calc.test.mjs.

export const pad = n => String(n).padStart(2, '0');
export const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const DAY = 86400000;

export function keyOf(y, m) {
  const d = new Date(y, m - 1, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
export function shiftKey(key, n) {
  const [y, m] = key.split('-').map(Number);
  return keyOf(y, m + n);
}
/** Budget month a date belongs to, when the budget month starts on `startDay`. */
export function budgetKeyOf(iso, startDay = 1) {
  const [y, m, d] = iso.split('-').map(Number);
  return d >= startDay ? keyOf(y, m) : keyOf(y, m - 1);
}
export function periodOf(key, startDay = 1) {
  const [y, m] = key.split('-').map(Number);
  return { start: new Date(y, m - 1, startDay), end: new Date(y, m, startDay - 1) };
}
export function savingsAmount(settings, income) {
  const s = settings.savings || { mode: 'percent', value: 0 };
  return s.mode === 'percent' ? Math.round(income * (Number(s.value) || 0) / 100) : (Number(s.value) || 0);
}
export const isCounted = t => !t.ignored && t.kind !== 'income' && t.kind !== 'card-payment';
const sum = (list, f = t => t.amount) => list.reduce((a, t) => a + (Number(f(t)) || 0), 0);

/**
 * Everything the screens need about one budget month.
 * income  = the larger of planned income and income actually recorded in the month
 * remaining = income - fixed - savings - variable spending
 */
export function monthSummary(settings, allTx, key, today = new Date()) {
  const sd = settings.startDay || 1;
  const inPeriod = allTx.filter(t => t.date && budgetKeyOf(t.date, sd) === key);
  const counted = inPeriod.filter(isCounted);
  const variable = counted.filter(t => !t.fixedId);
  const actualIncome = sum(inPeriod.filter(t => t.kind === 'income' && !t.ignored));
  const plannedIncome = Number(settings.income) || 0;
  const income = Math.max(plannedIncome, actualIncome);
  const fixedTotal = sum(settings.fixed || []);
  const savings = savingsAmount(settings, income);
  const available = income - fixedTotal - savings;
  const spent = sum(variable);
  const remaining = available - spent;

  const { start, end } = periodOf(key, sd);
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const total = Math.round((end - start) / DAY) + 1;
  let elapsed, daysLeft;
  if (t0 > end) { elapsed = total; daysLeft = 0; }
  else if (t0 < start) { elapsed = 0; daysLeft = total; }
  else { elapsed = Math.round((t0 - start) / DAY) + 1; daysLeft = total - elapsed + 1; }

  const daily = daysLeft > 0 ? remaining / daysLeft : 0;
  const weekly = daysLeft >= 7 ? daily * 7 : remaining;
  const expectedByNow = available * (elapsed / total);
  const isCurrent = elapsed > 0 && daysLeft > 0;
  let status = 'good';
  if (remaining < 0) status = 'over';
  else if (isCurrent && available > 0 && spent > expectedByNow * 1.15 && spent - expectedByNow > 50) status = 'watch';
  // big one-off purchases (a quarter of the month's money or more) are not projected forward
  const oneOff = available > 0 ? variable.filter(t => t.amount >= available * 0.25).reduce((a, t) => a + t.amount, 0) : 0;
  const projectedSpend = isCurrent && elapsed >= 5 ? oneOff + (spent - oneOff) / elapsed * total : spent;
  const projectedEnd = available - projectedSpend;

  const byCat = {};
  const known = new Set((settings.categories || []).map(c => c.id));
  const catOf = t => (t.category && (!known.size || known.has(t.category)) ? t.category : 'other');
  for (const t of variable) byCat[catOf(t)] = (byCat[catOf(t)] || 0) + t.amount;
  const allocated = sum(settings.categories || [], c => c.budget);
  const fixedSeen = new Set(counted.filter(t => t.fixedId).map(t => t.fixedId));

  return {
    key, inPeriod, variable, plannedIncome, actualIncome, income, fixedTotal, savings, available, spent, remaining,
    start, end, total, elapsed, daysLeft, daily, weekly, expectedByNow, status, isCurrent, projectedEnd,
    byCat, allocated, unallocated: available - allocated, fixedSeen,
  };
}

/** Split `available` across categories by their weights, in round tens; the rounding rest goes to `other`. */
export function autoSplit(categories, available) {
  if (!(available > 0)) return categories.map(c => ({ ...c }));
  let w = categories.map(c => Number(c.weight) || 0);
  let W = w.reduce((a, b) => a + b, 0);
  if (!W) { w = w.map(() => 1); W = w.length; }
  const out = categories.map((c, i) => ({ ...c, budget: Math.floor(available * w[i] / W / 10) * 10 }));
  const used = out.reduce((a, c) => a + c.budget, 0);
  const rest = out.find(c => c.id === 'other') || out[out.length - 1];
  rest.budget += Math.round(available - used);
  return out;
}

export const normMerchant = s => String(s || '').toLowerCase().replace(/[\s"'`׳״.,\-_*()\/\\|#]/g, '');
export const dupKey = t => `${t.date}|${normMerchant(t.merchant)}|${Number(t.amount).toFixed(2)}`;
