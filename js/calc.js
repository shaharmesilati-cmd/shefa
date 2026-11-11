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
/** "כסף שחזר": a purchase whose money came back (a return, a refund). It stays in the list but is not counted as spent. */
export const REFUND = 'refund';
export const isRefund = t => t.category === REFUND && t.kind !== 'income' && t.kind !== 'card-payment';
/** A credit-card purchase (it is paid on next month's charge day). */
export const isCardTx = t => t.kind === 'expense' && (/^\d{4}$/.test(t.card || '') || ['shots', 'card', 'pdf', 'paste'].includes(t.source));
/** The budget month a transaction counts in. With "byCharge", card purchases count when the card is charged. */
export function txKey(t, settings = {}) {
  const sd = settings.startDay || 1;
  if (settings.byCharge && isCardTx(t)) return t.chargeDate ? budgetKeyOf(t.chargeDate, sd) : shiftKey(budgetKeyOf(t.date, sd), 1);
  return budgetKeyOf(t.date, sd);
}
export const isCounted = t => !t.ignored && t.kind !== 'income' && t.kind !== 'card-payment' && t.category !== REFUND;
const sum = (list, f = t => t.amount) => list.reduce((a, t) => a + (Number(f(t)) || 0), 0);

/**
 * Everything the screens need about one budget month.
 * income  = the larger of planned income and income actually recorded in the month
 * remaining = income - fixed - savings - variable spending
 */
export function monthSummary(settings, allTx, key, today = new Date()) {
  const sd = settings.startDay || 1;
  const inPeriod = allTx.filter(t => t.date && txKey(t, settings) === key);
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
  const allocated = sum((settings.categories || []).filter(c => c.id !== REFUND), c => c.budget);
  const fixedSeen = new Set(counted.filter(t => t.fixedId).map(t => t.fixedId));
  const back = inPeriod.filter(t => isRefund(t) && !t.ignored);
  const refunded = sum(back.filter(t => t.amount > 0));

  return {
    key, inPeriod, variable, plannedIncome, actualIncome, income, fixedTotal, savings, available, spent, remaining,
    start, end, total, elapsed, daysLeft, daily, weekly, expectedByNow, status, isCurrent, projectedEnd,
    byCat, allocated, unallocated: available - allocated, fixedSeen, refunded, refundCount: back.length,
  };
}

/**
 * The daily "bank". Every day of the month adds the same daily amount (the month's spending money / days).
 * What you did not spend stays and rolls to the next day; spending more than you have puts the bank in minus.
 * Returns null when the month is not the current one or there is no spending money.
 */
export function dailyBank(settings, allTx, key, today = new Date()) {
  const C = monthSummary(settings, allTx, key, today);
  if (!C.isCurrent || !(C.available > 0)) return null;
  const base = C.available / C.total;
  const startIso = isoOf(C.start), todayIso = isoOf(new Date(today.getFullYear(), today.getMonth(), today.getDate()));
  const byDay = {};
  for (const t of C.variable) {
    // purchases dated outside the days that already passed (charge-month mode, a future date) sit on the nearest day
    const d = t.date < startIso ? startIso : t.date > todayIso ? todayIso : t.date;
    byDay[d] = (byDay[d] || 0) + t.amount;
  }
  const days = []; let cum = 0, zeroDays = 0;
  for (let i = 1; i <= C.elapsed; i++) {
    const iso = isoOf(new Date(C.start.getFullYear(), C.start.getMonth(), C.start.getDate() + i - 1));
    const spent = byDay[iso] || 0, opened = base * i - cum;
    cum += spent;
    if (!spent && iso !== todayIso) zeroDays++;
    days.push({ iso, spent, opened, closed: base * i - cum, net: base - spent });
  }
  const t = days[days.length - 1], prev = days[days.length - 2];
  const r2 = v => Math.round(v * 100) / 100;
  return {
    base: r2(base), balance: r2(t.closed), morning: r2(t.opened), spentToday: r2(t.spent),
    rolled: r2(t.opened - base), yesterday: prev ? r2(prev.closed) : 0, yesterdaySpent: prev ? r2(prev.spent) : null,
    tomorrow: C.daysLeft > 1 ? r2(t.closed + base) : null,
    recoverDays: t.closed < 0 ? Math.ceil(-t.closed / base) : 0, recoverable: t.closed >= 0 || Math.ceil(-t.closed / base) < C.daysLeft,
    zeroDays, days, daysLeft: C.daysLeft, day: C.elapsed, total: C.total,
    maxEnd: r2(t.closed + base * (C.daysLeft - 1)), // the most the bank can reach by the end of the month
  };
}
const BANK_STEPS = [250, 500, 1000, 1500, 2000, 3000, 4000, 5000, 7500, 10000, 15000, 20000, 30000, 50000];
/** The next round number the bank can reach, and how far along it is. */
export function bankMilestone(balance, maxEnd, base) {
  const next = BANK_STEPS.find(s => s > balance) || null;
  const prev = [...BANK_STEPS].reverse().find(s => s <= balance) || 0;
  const pct = next ? Math.max(0, Math.min(1, (balance - prev) / (next - prev))) : 1;
  return { prev, next, pct, reachable: next != null && next <= maxEnd + 0.5, days: next && base > 0 ? Math.ceil((next - balance) / base) : null };
}

/** Split `available` across categories by their weights, in round tens; the rounding rest goes to `other`. */
export function autoSplit(categories, available) {
  if (!(available > 0)) return categories.map(c => ({ ...c }));
  let w = categories.map(c => (c.id === REFUND ? 0 : Number(c.weight) || 0));
  let W = w.reduce((a, b) => a + b, 0);
  if (!W) { w = categories.map(c => (c.id === REFUND ? 0 : 1)); W = w.reduce((a, b) => a + b, 0) || 1; }
  const out = categories.map((c, i) => ({ ...c, budget: Math.floor(available * w[i] / W / 10) * 10 }));
  const used = out.reduce((a, c) => a + c.budget, 0);
  const rest = out.find(c => c.id === 'other') || out[out.length - 1];
  rest.budget += Math.round(available - used);
  return out;
}

export const normMerchant = s => String(s || '').toLowerCase().replace(/[\s"'`׳״.,\-_*()\/\\|#]/g, '');
export const dupKey = t => `${t.date}|${normMerchant(t.merchant)}|${Number(t.amount).toFixed(2)}`;
