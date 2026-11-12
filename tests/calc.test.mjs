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
assert.equal(guessCategory('טעינות "חבר" טעמים'), 'other');
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
    {
    const { markDuplicates } = await import('../js/dedupe.js');
    const a = [{ date: '2026-11-05', merchant: 'טעינות חבר', amount: 70, card: '4093' }];
    const b = [{ date: '2026-11-05', merchant: 'טעינות חבר', amount: 70, card: '5512' }, { date: '2026-11-05', merchant: 'טעינות חבר', amount: 70, card: '4093' }];
    assert.deepEqual(markDuplicates([a, b], []).map(r => r.dup), [null, null, 'batch'], 'same purchase on another card is not a duplicate');
    const saved = [{ id: 's1', date: '2026-11-05', merchant: 'טעינות חבר', amount: 70, card: '4093' }];
    const again = markDuplicates([[{ date: '2026-11-05', merchant: 'טעינות חבר', amount: 70, card: '4098' }]], saved);
    assert.deepEqual([again[0].dup, again[0].dupOf], ['saved', 's1'], 'saved purchase with a misread card is matched so its card can be fixed');
    const noCard = markDuplicates([[{ date: '2026-11-05', merchant: 'טעינות חבר', amount: 70, card: '5512' }]], [{ ...saved[0], card: null }]);
    assert.equal(noCard[0].dup, 'saved', 'a saved purchase without a card gets the card from the screenshot');
    assert.equal(markDuplicates([[{ date: '2026-11-05', merchant: 'טעינות חבר', amount: 70, card: '5512' }]], saved)[0].dup, null, 'the same shop and amount on another card is another purchase');
  }
  {
    const { classify, sameBusiness, brandOf } = await import('../js/categorize.js');
    const { normMerchant } = await import('../js/calc.js');
    const ids = new Set(['super', 'food', 'shopping', 'fun', 'other']);
    assert.equal(brandOf('טעינות - חבר של קבע'), 'חבר');
    const rules = { [normMerchant('טעינות - חבר של קבע')]: 'shopping' };
    assert.deepEqual([classify('טעינות "חבר" טעמים', { rules, ids }).cat, classify('טעינות "חבר" טעמים', { rules, ids }).why], ['shopping', 'similar'], 'same brand word -> same category');
    assert.equal(classify('שופרסל דיל רמת גן', { ids }).cat, 'super');
    assert.equal(classify('קפה גרג בע"מ', { ids }).cat, 'food');
    assert.equal(classify('נגריית יוסי', { ids, history: [{ merchant: 'נגריית יוסי בעמ', category: 'fun', confirmed: true }] }).cat, 'fun', 'similar name in history');
    assert.equal(classify('BIT העברה', { rules, ids }).conf, 0, 'payment apps are always asked');
    assert.equal(classify('מספרת דנה', { ids }).cat, 'other', 'unknown -> ask');
    assert.ok(sameBusiness('טעינות - חבר של קבע', 'טעינות "חבר" טעמים') && !sameBusiness('שופרסל', 'רמי לוי'));
  }
  {
    const { cleanField } = await import('../js/sanitize.js');
    for (const n of ['Shopping Mall', 'Spinneys', 'Pinkberry', 'מסגרת תמונות', "Gold's Gym 2024"]) assert.equal(cleanField(n), n, 'shop names are kept: ' + n);
    assert.equal(toAmount('1.234,56'), 1234.56); assert.equal(toAmount('(123.45)'), -123.45);
    assert.deepEqual(parseStatement('קפה ג\'ו 15.10\n06.11.26', new Date(2026, 10, 8)).rows.map(r => [r.amount, r.date]), [[15.1, '2026-11-06']], 'a d.mm number after a name is a price');
    const { normalizeTx } = await import('../js/store.js').catch(() => ({}));
  }
  console.log('v2 tests passed');
}

// v2.6 - nothing that could open an account survives (bank PDFs, transfers, IBAN)
{
  const { parseStatement } = await import('../js/paste.js');
  const { cleanField, redactSensitive } = await import('../js/sanitize.js');
  const today = new Date(2026, 9, 20);
  const BAD = /\d{5,}|\d{2,3}-\d{3}-\d{4,}|\d{4}[ -]\d{4}[ -]\d{4}/;
  const samples = ['IBAN IL62 0108 0000 0009 9999 999', 'IL620108000000099999999', 'העברה ל 12-645-123456 15/10/26 500.00',
    'העברה מ-10-800-12345678 01/10/26 ₪1,200.00', 'בנק 12 סניף 645 ח-ן 123456', "מס' לקוח 9876543 שופרסל 05/10/26 120.50",
    'כרטיס 4580-1234-5678-9012 רמי לוי 03/10/26 89.90', 'ת.ז 012345678', '4580 1234 5678 9012 תוקף 12/28 cvv 123',
    'שובר 77812345 פז 02/10/26 210.00', 'חיוב בנקאי מחשבון 123-456789 08/10/26 99.00', 'bit העברה 054-1234567 07/10/26 50.00'];
  for (const s of samples) {
    const rows = JSON.stringify(parseStatement(s, today).rows.map(r => [r.merchant, r.place, r.card]));
    assert.ok(!BAD.test(redactSensitive(s).text.replace(/⟦C\d{4}⟧/g, '')), 'redacted: ' + s);
    assert.ok(!BAD.test(cleanField(s)), 'field: ' + s);
    assert.ok(!BAD.test(rows), 'rows: ' + s);
  }
  assert.equal(parseStatement('כרטיס 4580-1234-5678-9012 רמי לוי 03/10/26 89.90', today).rows[0].card, '9012', 'a dashed card keeps its last 4');
  assert.equal(parseStatement('העברה 01/10/26 ₪1,200.00', today).rows[0].amount, 1200, '₪ before the number');
  assert.ok(redactSensitive('פגישה 15-10-2026 ב-14:00').text.includes('15-10-2026'), 'a dashed date is not an account');
  console.log('v2.6 privacy tests passed');
}

// v2.7 - "כסף שחזר": stays in the list, not counted as spent, never learned for the shop
{
  const { monthSummary, isCounted, autoSplit } = await import('../js/calc.js');
  const { normalizeSettings, defaultSettings } = await import('../js/store.js').catch(() => ({}));
  const { classify, historyOf } = await import('../js/categorize.js');
  const S = { income: 10000, startDay: 1, savings: { mode: 'fixed', value: 0 }, fixed: [], categories: [{ id: 'shopping', budget: 0, weight: 1 }, { id: 'refund', budget: 0, weight: 0 }, { id: 'other', budget: 0, weight: 1 }] };
  const tx = [
    { id: 'a', date: '2026-11-03', merchant: 'זארה', amount: 400, kind: 'expense', category: 'shopping' },
    { id: 'b', date: '2026-11-04', merchant: 'זארה', amount: 250, kind: 'expense', category: 'refund' },
  ];
  const C = monthSummary(S, tx, '2026-11', new Date(2026, 10, 10));
  assert.equal(C.spent, 400, 'a refunded purchase is not spent');
  assert.equal(C.refunded, 250); assert.equal(C.refundCount, 1);
  assert.equal(C.inPeriod.length, 2, 'it stays in the month');
  assert.equal(C.byCat.refund, undefined, 'no category total for refunds');
  assert.equal(isCounted(tx[1]), false);
  const split = autoSplit(S.categories, 1000);
  assert.equal(split.find(c => c.id === 'refund').budget, 0, 'auto split gives refund nothing');
  assert.equal(split.reduce((a, c) => a + c.budget, 0), 1000);
  const r = classify('זארה', { rules: { 'זארה': 'refund' }, ids: new Set(['shopping', 'refund', 'other']), history: historyOf(tx) });
  assert.notEqual(r.cat, 'refund', 'refund is never guessed automatically');
  if (normalizeSettings) {
    const old = normalizeSettings({ categories: [{ id: 'super', name: 'סופר', icon: 'shopping-cart' }, { id: 'other', name: 'שונות', icon: 'dots-circle' }] });
    assert.deepEqual(old.categories.map(c => c.id), ['super', 'refund', 'other'], 'existing users get the new category before שונות');
    assert.equal(old.categories[1].icon, 'arrow-u-up-left');
  }
  console.log('v2.7 refund tests passed');
}

// v2.8 - screenshots: limit lines, card titles, "טרם נקלט", garbled names, unread dates
{
  const { parseStatement } = await import('../js/paste.js');
  const { markDuplicates } = await import('../js/dedupe.js');
  const today = new Date(2026, 10, 10, 16, 30);
  const gold = parseStatement('16:28\nגולד - מסטרקארד 3314\nWINN מסגרת של: 30,000\nיתרה פנויה: 29,606.98\nעם שירות אשראי מתגלגל אפשר\nלקבוע את סכום החיוב החודשי,\nעסקאות שאושרו וטרם נקלטו\nטעינות - חבר של קבע 175.00\n10.11.26\nסה"כ עסקאות שטרם נקלטו 175.00\nמתנה קסומה 218.00\n08.11.26', today).rows;
  assert.deepEqual(gold.map(r => [r.card, r.merchant, r.amount]), [['3314', 'טעינות - חבר של קבע', 175], ['3314', 'מתנה קסומה', 218]], 'no credit limit, no card title as a shop');
  const fly = parseStatement('3315 CARD FLY\nטרם נקלט 150.00\n10.11.26\nספק משיכות atm 508.90\n10.11.26\nביטוח ישיר-חיים 136.25\n26 הוראת קבע\nTD YELLOW-N\'yj7\'79N 278.01\n07.11.26\nחוף המגדלור בע"מ 12.00\n07.11.26', today).rows;
  assert.ok(fly.every(r => r.card === '3315'), 'card digits read before the card name');
  const { normalizeTx } = await import('../js/store.js');
  const saved = fly.map((r, i) => normalizeTx({ ...r, id: 's' + i, kind: 'expense' }));
  assert.equal(saved[2].dateGuessed, true, 'an unread date is remembered as a guess');
  // next day: the pending one got its name, names read differently, the date of the insurance was read this time
  const next = parseStatement('3315 CARD FLY\nשופרסל דיל 150.00\n10.11.26\nספק משיכות atm 508.90\n10.11.26\nביטוח ישיר-חיים 136.25\n08.11.26 הוראת קבע\nפז אפליקצית-YELLOW 278.01\n07.11.26\nחוף המגדלור בע"מ 12.00\n07.11.26\nקפה ג\'ו 12.00\n07.11.26', new Date(2026, 10, 11)).rows;
  const rows = markDuplicates([next], saved);
  assert.deepEqual(rows.map(r => r.dup ? 'dup' : 'new'), ['dup', 'dup', 'dup', 'dup', 'dup', 'new'], 'only the really new purchase is new');
  assert.equal(rows[0].dupOf, 's0', '"טרם נקלט" matched to its real name');
  console.log('v2.8 screenshot tests passed');
}

// v2.9 - prepaid cards, charge month, new categories, several files
{
  const { classify } = await import('../js/categorize.js');
  const { monthSummary, txKey } = await import('../js/calc.js');
  const { detectColumns, rowsToTx } = await import('../js/importers.js');
  const cats = [{ id: 'super', name: 'סופר' }, { id: 'pp', name: 'כרטיס נטען' }, { id: 'other', name: 'שונות' }];
  const ids = new Set(cats.map(c => c.id));
  assert.equal(classify('טעינות - חבר של קבע', { ids, cats }).cat, 'pp', 'a Hever load goes to the user\'s prepaid category');
  assert.equal(classify('חבר כללי', { ids, cats }).cat, 'pp');
  assert.equal(classify('טעינות - חבר של קבע', { ids, cats, rules: { 'טעינותחברשלקבע': 'super' } }).cat, 'super', 'the user\'s own rule wins');
  assert.notEqual(classify('טעינות - חבר של קבע', { ids: new Set(['super', 'other']), cats: cats.filter(c => c.id !== 'pp') }).cat, 'pp');
  // charge month
  const card = { date: '2026-10-28', kind: 'expense', card: '3314', amount: 100 };
  const cash = { date: '2026-10-28', kind: 'expense', source: 'manual', amount: 50 };
  assert.equal(txKey(card, { startDay: 1 }), '2026-10');
  assert.equal(txKey(card, { startDay: 1, byCharge: true }), '2026-11', 'a card purchase counts when it is charged');
  assert.equal(txKey({ ...card, chargeDate: '2026-12-02' }, { startDay: 1, byCharge: true }), '2026-12', 'the file\'s charge date wins');
  assert.equal(txKey(cash, { startDay: 1, byCharge: true }), '2026-10', 'cash stays in its month');
  const S = { income: 0, startDay: 1, savings: { mode: 'fixed', value: 0 }, fixed: [], categories: [], byCharge: true };
  assert.equal(monthSummary(S, [card, cash], '2026-11', new Date(2026, 10, 5)).spent, 100);
  // Excel with a charge date column
  const map = detectColumns(['תאריך רכישה', 'שם בית עסק', 'סכום חיוב', 'תאריך חיוב']);
  assert.equal(map.chargeDate, 3);
  const tx = rowsToTx([{ row: ['28/10/2026', 'זארה', '120.00', '10/11/2026'], map }]);
  assert.equal(tx[0].chargeDate, '2026-11-10');
  console.log('v2.9 tests passed');
}

// v3.0 - the daily bank: unspent money rolls to the next day; spending fast never shows a scary minus
{
  const { dailyBank, monthSummary } = await import('../js/calc.js');
  const S = { income: 3000, startDay: 1, savings: { mode: 'fixed', value: 0 }, fixed: [], categories: [] }; // November: 30 days -> 100 a day
  const at = d => new Date(2026, 10, d, 9);
  let B = dailyBank(S, [], '2026-11', at(1));
  assert.equal(B.base, 100); assert.equal(B.balance, 100); assert.equal(B.extra, 0); assert.equal(B.tomorrow, 200); assert.equal(B.mode, 'saved');
  B = dailyBank(S, [], '2026-11', at(4));
  assert.equal(B.balance, 400, 'four days without spending = four daily amounts'); assert.equal(B.extra, 300); assert.equal(B.zeroDays, 3);
  assert.equal(B.lockable, 300, 'everything above one full day can be locked');
  // spent 1,500 in the first days: the rolled bank would be -1,100 on day 4, but 1,500 is still left for 27 days
  const fast = [{ date: '2026-11-02', amount: 1500, kind: 'expense' }];
  B = dailyBank(S, fast, '2026-11', at(4));
  assert.equal(B.mode, 'spread'); assert.equal(B.pace, -1100);
  assert.equal(B.balance, 55.56, 'never a minus while the month still has money: 1,500 / 27 days');
  assert.equal(B.todayBase, 55.56); assert.equal(B.lockable, 0);
  assert.equal(B.tomorrow, 57.69, 'a day without spending raises tomorrow: 1,500 / 26');
  // spending today more than today's amount shows a small minus for today only
  B = dailyBank(S, [...fast, { date: '2026-11-04', amount: 80, kind: 'expense' }], '2026-11', at(4));
  assert.equal(B.balance, -24.44); assert.equal(B.tomorrow, 54.62);
  // back above the even pace -> rolls again
  B = dailyBank(S, [{ date: '2026-11-02', amount: 150, kind: 'expense' }], '2026-11', at(3));
  assert.equal(B.mode, 'saved'); assert.equal(B.balance, 150);
  B = dailyBank(S, [{ date: '2026-11-02', amount: 60, kind: 'expense' }, { date: '2026-11-03', amount: 20, kind: 'expense' }], '2026-11', at(30));
  assert.equal(B.balance, monthSummary(S, [{ amount: 80, date: '2026-11-02', kind: 'expense' }], '2026-11', at(30)).remaining, 'on the last day the bank equals what is left for the month');
  assert.equal(B.tomorrow, null);
  assert.equal(dailyBank(S, [], '2026-10', at(4)), null, 'only for the current month');
  assert.equal(dailyBank({ ...S, income: 0 }, [], '2026-11', at(4)), null);
  assert.equal(dailyBank(S, [{ date: '2026-11-02', amount: 3500, kind: 'expense' }], '2026-11', at(4)), null, 'month overspent: the month view takes over');
  // a refunded purchase and a fixed expense do not touch the bank
  B = dailyBank(S, [{ date: '2026-11-02', amount: 500, kind: 'expense', category: 'refund' }, { date: '2026-11-02', amount: 500, kind: 'expense', fixedId: 'f1' }], '2026-11', at(2));
  assert.equal(B.balance, 200);
  // locking money into the vault takes it out of the spendable number but it is not an expense
  const L = { ...S, locks: [{ date: '2026-11-04', amount: 300 }] };
  B = dailyBank(L, [], '2026-11', at(4));
  assert.equal(B.balance, 100); assert.equal(B.lockedToday, 300); assert.equal(B.tomorrow, 200);
  const C = monthSummary(L, [], '2026-11', at(4));
  assert.equal(C.spent, 0); assert.equal(C.locked, 300); assert.equal(C.remaining, 2700);
  console.log('v3.0 daily bank tests passed');
}

// v3.1 - bank milestones and what the app remembers about the bank
{
  const { bankMilestone, dailyBank } = await import('../js/calc.js');
  const { normalizeSettings } = await import('../js/store.js');
  let M = bankMilestone(620, 3000, 100);
  assert.deepEqual([M.prev, M.next, M.reachable, M.days], [500, 1000, true, 4]);
  assert.equal(Math.round(M.pct * 100), 24);
  assert.equal(bankMilestone(620, 900, 100).reachable, false, 'a milestone the month cannot reach is not promised');
  assert.equal(bankMilestone(-50, 900, 100).prev, 0);
  const B = dailyBank({ income: 3000, startDay: 1, savings: { mode: 'fixed', value: 0 }, fixed: [], categories: [] }, [], '2026-11', new Date(2026, 10, 4, 9));
  assert.equal(B.maxEnd, 3000, 'without spending, the whole month stays');
  const s = normalizeSettings({ bank: { key: '2026-11', best: 620, hit: [250, 500, 'x'], pledge: '2026-11-10', wins: 2 }, wish: { name: ' אוזניות ', price: '600' } });
  assert.deepEqual(s.bank, { key: '2026-11', best: 620, hit: [250, 500], pledge: '2026-11-10', wins: 2 });
  assert.deepEqual(s.wish, { name: 'אוזניות', price: 600 });
  assert.deepEqual(normalizeSettings({ locks: [{ id: 'a', date: '2026-11-04', amount: '120.4' }, { date: 'x', amount: 5 }, { date: '2026-11-05', amount: -3 }] }).locks, [{ id: 'a', date: '2026-11-04', amount: 120 }]);
  assert.equal(normalizeSettings({ wish: { name: 'x', price: 0 } }).wish, null);
  console.log('v3.1 bank extras tests passed');
}

// v3.2 - red team findings
{
  const { markDuplicates, samePurchase } = await import('../js/dedupe.js');
  const { budgetStreak } = await import('../js/insights.js');
  const row = (m, a, extra = {}) => ({ date: '2026-11-05', merchant: m, amount: a, ...extra });
  // the same purchase in three overlapping screenshots is imported once
  let r = markDuplicates([[row('שופרסל', 50)], [row('שופרסל', 50)], [row('שופרסל', 50)]], []);
  assert.deepEqual(r.map(x => x.dup), [null, 'batch', 'batch']);
  // two identical purchases inside one screenshot are both real, also when a second screenshot repeats them
  r = markDuplicates([[row('קפה', 12), row('קפה', 12)], [row('קפה', 12), row('קפה', 12)]], []);
  assert.deepEqual(r.map(x => x.dup), [null, null, 'batch', 'batch']);
  // different shops with the same .90 price on the same day are two purchases
  assert.equal(samePurchase(row('שופרסל דיל', 19.9), row('רמי לוי', 19.9)), false);
  assert.equal(samePurchase(row('סופר פארם', 19.9), row('שופרסל', 19.9)), false);
  // a mangled reading of the same purchase still matches
  assert.equal(samePurchase(row("TD YELLOW-N'yj7'79N", 278.01, { card: '3315' }), row('פז אפליקצית-YELLOW', 278.01, { card: '3315' })), true);
  // against saved purchases: a different card is a different purchase, a missing or misread card is not
  assert.equal(samePurchase(row('קפה ג׳ו', 30, { card: '2222' }), row('קפה ג׳ו', 30, { card: '1111' }), true), false);
  assert.equal(samePurchase(row('קפה ג׳ו', 30, { card: '3314' }), row('קפה ג׳ו', 30, { card: '3814' }), true), true);
  assert.equal(samePurchase(row('קפה ג׳ו', 30), row('קפה ג׳ו', 30, { card: '1111' }), true), true);
  // money that came back does not break the streak
  const S = { income: 10000, startDay: 1, savings: { mode: 'fixed', value: 0 }, fixed: [], categories: [] };
  const base = [{ date: '2026-11-01', amount: 10, kind: 'expense' }];
  const today = new Date(2026, 10, 11, 9);
  assert.equal(budgetStreak(S, [...base, { date: '2026-11-09', amount: 900, kind: 'expense', category: 'refund' }], today), budgetStreak(S, base, today));
  console.log('v3.2 red team tests passed');
}
