// Run: node tests/calc.test.mjs
import assert from 'node:assert/strict';
import { monthSummary, budgetKeyOf, autoSplit, dupKey } from '../js/calc.js';
import { guessCategory, looksLikeCardPayment, matchFixed } from '../js/categorize.js';
import { toISODate, toAmount, detectColumns, rowsToTx, parseCSV, extractRows } from '../js/importers.js';
import { parsePastedText } from '../js/paste.js';

const S = { income: 12000, startDay: 1, savings: { mode: 'percent', value: 10 }, fixed: [{ id: 'f1', amount: 4000, keyword: 'נטפליקס' }],
  categories: [{ id: 'super', budget: 3000, weight: 30 }, { id: 'other', budget: 0, weight: 70 }] };
const today = new Date(2026, 10, 15);
const tx = [
  { date: '2026-11-03', merchant: 'שופרסל', amount: 1500, kind: 'expense', category: 'super' },
  { date: '2026-11-05', merchant: 'פז', amount: 500, kind: 'expense', category: 'other' },
  { date: '2026-11-06', merchant: 'נטפליקס', amount: 50, kind: 'expense', category: 'other', fixedId: 'f1' },
  { date: '2026-11-10', merchant: 'ישראכרט', amount: 9000, kind: 'card-payment' },
  { date: '2026-10-30', merchant: 'old', amount: 999, kind: 'expense' },
];
const C = monthSummary(S, tx, '2026-11', today);
assert.equal(C.available, 6800);
assert.equal(C.spent, 2000);
assert.equal(C.remaining, 4800, 'remaining = 12000-4000-1200-2000');
assert.equal(C.total, 30); assert.equal(C.elapsed, 15); assert.equal(C.daysLeft, 16);
assert.equal(Math.round(C.daily), 300);
assert.equal(C.fixedSeen.size, 1);
// income from the bank larger than planned wins
const C2 = monthSummary(S, [...tx, { date: '2026-11-09', merchant: 'משכורת', amount: 13000, kind: 'income' }], '2026-11', today);
assert.equal(C2.income, 13000);
// budget month starting on the 10th
assert.equal(budgetKeyOf('2026-11-09', 10), '2026-10');
assert.equal(budgetKeyOf('2026-11-10', 10), '2026-11');
assert.equal(budgetKeyOf('2026-01-05', 10), '2025-12');
// past / future months
assert.equal(monthSummary(S, tx, '2026-10', today).daysLeft, 0);
assert.equal(monthSummary(S, tx, '2026-12', today).elapsed, 0);
// auto split sums exactly
const split = autoSplit(S.categories, 6800);
assert.equal(split.reduce((a, c) => a + c.budget, 0), 6800);
assert.equal(split[0].budget, 2040);
// categorize
assert.equal(guessCategory('שופרסל דיל ת"א'), 'super');
assert.equal(guessCategory('WOLT'), 'food');
assert.equal(guessCategory('NETFLIX.COM'), 'subs');
assert.equal(guessCategory('משהו לא מוכר'), 'other');
assert.equal(guessCategory('משהו לא מוכר', { 'משהולאמוכר': 'fun' }), 'fun');
assert.ok(looksLikeCardPayment('ישראכרט בע"מ'));
assert.equal(matchFixed('NETFLIX נטפליקס', S.fixed)?.id, 'f1');
assert.equal(dupKey({ date: '2026-11-01', merchant: 'A B', amount: 5 }), dupKey({ date: '2026-11-01', merchant: 'ab', amount: 5.0 }));
// importers
assert.equal(toISODate('03/11/2026'), '2026-11-03');
assert.equal(toISODate('3.11.26'), '2026-11-03');
assert.equal(toISODate(46329), '2026-11-03');
assert.equal(toAmount('₪1,234.50'), 1234.5);
assert.equal(toAmount('50.00-'), -50);
const cardHeader = ['תאריך רכישה', 'שם בית עסק', 'סכום עסקה', 'מטבע עסקה', 'סכום חיוב', 'מטבע חיוב', "מס' שובר", 'פירוט נוסף'];
const m = detectColumns(cardHeader);
assert.equal(m.date, 0); assert.equal(m.merchant, 1); assert.equal(m.amount, 4); assert.equal(m.details, 7); assert.equal(m.type, 'card');
const sheet = [['פירוט עסקאות'], [], cardHeader,
  ['01/11/2026', 'שופרסל דיל', 214.9, '₪', 214.9, '₪', '123', ''],
  ['02/11/2026', 'איקאה', 1200, '₪', 400, '₪', '124', 'תשלום 1 מתוך 3'],
  ['', 'סה"כ', '', '', 614.9]];
const ex = extractRows([sheet]);
const card = rowsToTx(ex.rows);
assert.equal(card.length, 2); assert.equal(card[1].amount, 400); assert.equal(card[1].installment, '1/3');
const bank = parseCSV('תאריך,הפעולה,חובה,זכות,יתרה\n01/11/2026,משכורת,,13000,20000\n10/11/2026,ישראכרט,9000,,11000\n');
const bx = extractRows(bank); assert.equal(bx.mapping.type, 'bank');
const bt = rowsToTx(bx.rows);
assert.deepEqual(bt.map(t => [t.kind, t.amount]), [['income', 13000], ['expense', 9000]]);
// pasted screenshot text, different layouts
const p1 = parsePastedText('עסקאות אחרונות\nשופרסל דיל\n03.11.26\n₪214.90\nפז אקספרס\n02.11.26\n₪150.00\n', today);
assert.deepEqual(p1.map(r => [r.merchant, r.date, r.amount]), [['שופרסל דיל', '2026-11-03', 214.9], ['פז אקספרס', '2026-11-02', 150]]);
const p2 = parsePastedText('03.11\nארומה תל אביב 32.00 ₪\nוולט 89.90 ₪\nתשלום 2 מתוך 6\nאיקאה ₪300.00\n', today);
assert.equal(p2.length, 3); assert.equal(p2[1].date, '2026-11-03'); assert.equal(p2[1].installment, '2/6'); assert.equal(p2[2].amount, 300);
console.log('all tests passed');

// ---- v1.1: sensitive data, time/place, duplicates across screenshots ----
const { redactSensitive, cleanField } = await import('../js/sanitize.js');
const { parseStatement } = await import('../js/paste.js');
const { markDuplicates, similarity } = await import('../js/dedupe.js');
const red = redactSensitive('כרטיס 4580 1234 5678 9012\n**** 4321\nויזה המסתיים ב 1234\nתוקף 09/28\nCVV 123\nת.ז. 012345678\nמס׳ אישור 556677\nמסגרת 20,000 ₪\nשופרסל 03.11.26 ₪214.90');
assert.ok(!/4580|5678|09\/28|123\b|012345678|556677|20,000/.test(red.text), 'sensitive removed: ' + red.text);
assert.deepEqual(red.cards.sort(), ['1234', '4321', '9012'], 'only last 4 digits kept');
assert.ok(/שופרסל 03\.11\.26 ₪214\.90/.test(red.text), 'purchase kept');
assert.ok(red.removed >= 5, "removed " + red.removed);
assert.equal(cleanField('סופר 4580123456789012 רמת גן'), 'סופר רמת גן');
const st = parseStatement('14:16\nעסקאות אחרונות\nשופרסל דיל רמת גן\n03.11.26 18:42\n₪214.90\nכרטיס 4580-1234-5678-9012\nפז יילו חיפה\n02.11.26 07:05\n₪180.00', today);
assert.deepEqual(st.rows.map(r => [r.merchant, r.date, r.time, r.place, r.amount]),
  [['שופרסל דיל רמת גן', '2026-11-03', '18:42', 'רמת גן', 214.9], ['פז יילו חיפה', '2026-11-02', '07:05', 'חיפה', 180]]);
assert.equal(st.removed, 1);
assert.deepEqual(st.rows.map(r => r.card), ['9012', '9012'], 'card from the screenshot applies to its purchases');
const { cardOf } = await import('../js/sanitize.js');
assert.equal(cardOf('פירוט עסקאות לכרטיס 1234'), '1234');
assert.equal(cardOf('הזמנה 12345678'), '');
assert.ok(similarity('שופרסל דיל', 'שופרסל דיל.') === 1 && similarity('שופרסל דיל', 'שופרסל דול') > 0.55 && similarity('שופרסל', 'פז') < 0.3);
const g1 = [{ date: '2026-11-03', merchant: 'ארומה', amount: 18 }, { date: '2026-11-03', merchant: 'ארומה', amount: 18 }, { date: '2026-11-02', merchant: 'פז', amount: 180 }];
const g2 = [{ date: '2026-11-02', merchant: 'פז.', amount: 180 }, { date: '2026-11-01', merchant: 'וולט', amount: 60 }];
const saved = [{ date: '2026-11-01', merchant: 'WOLT וולט', amount: 60 }];
const all = markDuplicates([g1, g2], saved);
assert.deepEqual(all.map(r => r.dup), [null, null, null, 'batch', 'saved'], 'two coffees kept, overlap and saved removed');
console.log('v1.1 tests passed');

// ---- v1.2: salary slip, insights, inbox ----
const { parsePayslip } = await import('../js/payslip.js');
const ps = parsePayslip('טכנו-סופט בע"מ\nתלוש שכר לחודש 10/2026\nת.ז. 012345678 בנק 12 סניף 345 חשבון 1234567\nשכר יסוד 15,000.00\nסה"כ תשלומים 16,200.00\nברוטו למס 16,200.00\nנטו לתשלום 12,345.67', new Date(2026, 10, 8));
assert.deepEqual([ps.net, ps.gross, ps.monthKey, ps.employer], [12345.67, 16200, '2026-10', 'טכנו-סופט בע"מ']);
assert.ok(ps.removed >= 2);
const ps2 = parsePayslip('משכורת אוקטובר 2026\nשכר נטו\n9,870', new Date(2026, 10, 8));
assert.deepEqual([ps2.net, ps2.monthKey], [9870, '2026-10']);
const { monthInsights, needsCategory, isGenericMerchant } = await import('../js/insights.js');
const S2 = { income: 10000, startDay: 1, savings: { mode: 'fixed', value: 0 }, fixed: [], goals: [{ name: 'חופשה', target: 5000, saved: 0, monthly: 300 }],
  categories: [{ id: 'food', name: 'אוכל בחוץ', budget: 300 }, { id: 'super', name: 'סופר', budget: 2000 }, { id: 'other', name: 'שונות', budget: 0 }] };
const T2 = [
  { date: '2026-10-03', merchant: 'שופרסל', amount: 900, kind: 'expense', category: 'super' },
  { date: '2026-10-05', merchant: 'וולט', amount: 100, kind: 'expense', category: 'food' },
  { date: '2026-11-02', merchant: 'שופרסל', amount: 500, kind: 'expense', category: 'super' },
  { date: '2026-11-03', merchant: 'וולט', amount: 420, kind: 'expense', category: 'food' },
  { date: '2026-11-04', merchant: 'BIT העברה', amount: 50, kind: 'expense', category: 'other' },
  { date: '2026-11-04', merchant: 'מוכר', amount: 70, kind: 'expense', category: 'other', confirmed: true },
];
const MI = monthInsights(S2, T2, '2026-11', new Date(2026, 10, 8));
assert.ok(MI.list.some(x => x.tone === 'alert' && x.text.includes('אוכל בחוץ')), 'over budget alert');
assert.ok(MI.list.some(x => x.icon === 'trend-up'), 'increase vs last month');
assert.equal(MI.stats.biggest.amount, 500); assert.equal(MI.stats.topCat.id, 'super');
assert.deepEqual(needsCategory(S2, T2, '2026-11').map(t => t.merchant), ['BIT העברה']);
assert.ok(isGenericMerchant('BIT העברה') && !isGenericMerchant('שופרסל'));
assert.equal(parsePayslip('סה"כ תשלומים 16,200.00\n101 לתשלום 12,345.67').net, 12345.67, 'net found even when the word נטו is misread');
// real Isracard card page layout: totals, section titles, buttons and footer are not purchases
const iz = parseStatement('₪ 5 al 15:12\nQ\nאמריקן אקספרס זהב 4093\nעסקאות שאושרו וטרם נקלטו בארץ ובחו"ל. (?)\nטעינות - חבר של קבע 175.00\n06.11.26\nסה"כ עסקאות שטרם 10777 175.00\nעסקאות למועד חיוב קרוב\nטעינות "חבר" טעמים 70.00\n05.11.26\nטעינות "חבר" טעמים 77.00\n05.11.26\nסה"כ לחיוב החודש בכרטיס: 147.00\nחזרה למעלה 4“\nתנאים משפטיים:\nהנתונים נכונים לתאריך 08/11 ולא סופיים\n5 ₪ o> is', new Date(2026, 10, 8, 15));
assert.deepEqual(iz.rows.map(r => [r.merchant, r.date, r.amount, r.card]), [
  ['טעינות - חבר של קבע', '2026-11-06', 175, '4093'], ['טעינות "חבר" טעמים', '2026-11-05', 70, '4093'], ['טעינות "חבר" טעמים', '2026-11-05', 77, '4093']]);
assert.equal(guessCategory('טעינות "חבר" טעמים'), 'other'); assert.equal(guessCategory('טעינות - חבר של קבע'), 'other');
assert.equal(guessCategory('בר יין תל אביב'), 'fun'); assert.equal(guessCategory('מי אביבים'), 'home');
console.log('v1.2 tests passed');
// ---- v2: streak ----
{
  const { budgetStreak } = await import('../js/insights.js');
  const S3 = { income: 3000, startDay: 1, savings: { mode: 'fixed', value: 0 }, fixed: [], goals: [], categories: [{ id: 'other', budget: 0 }] }; // 100/day in Nov
  const T3 = [{ date: '2026-11-03', merchant: 'a', amount: 250, kind: 'expense' }, { date: '2026-11-05', merchant: 'b', amount: 80, kind: 'expense' }, { date: '2026-11-07', merchant: 'c', amount: 99, kind: 'expense' }];
  assert.equal(budgetStreak(S3, T3, new Date(2026, 10, 8)), 4, 'Nov 4-7 within 100/day, Nov 3 was over');
  assert.equal(budgetStreak(S3, [], new Date(2026, 10, 8)), 0);
    const sep = parseStatement('15:12\nאמריקן אקספרס זהב\n4093\nעסקאות למועד חיוב קרוב\nסופר יודה 120.00\n06.11.26', new Date(2026, 10, 8, 15));
  assert.deepEqual(sep.rows.map(r => r.card), ['4093'], 'card digits on their own line at the top');
  const nick = parseStatement('הכרטיס של שחר 7781\nקפה 18.00\n06.11.26', new Date(2026, 10, 8, 15));
  assert.deepEqual(nick.rows.map(r => [r.merchant, r.card]), [['קפה', '7781']], 'any card nickname ending in 4 digits');
  assert.deepEqual(parseStatement('נובמבר 2026\nקפה 18.00\n06.11.26', new Date(2026, 10, 8, 15)).rows.map(r => r.card), [null], 'a month heading is not a card');
  console.log('v2 tests passed');
}
