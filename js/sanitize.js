// Removes anything that could help someone misuse a credit card or account, BEFORE the text is parsed.
// Runs on every piece of text that comes from a screenshot, a paste or a file.

// Only the LAST 4 digits of a card are kept (to know which card paid), as a marker: ⟦C1234⟧
const last4 = m => { const d = m.replace(/\D/g, ''); return d.length >= 4 ? ` ⟦C${d.slice(-4)}⟧ ` : ' '; };
const RULES = [
  // full card numbers: 13-19 digits, optionally split by spaces or dashes -> keep last 4
  [/(?<![\d.,:/])(?:\d[ \-]?){12,18}\d(?![\d.,:/])/g, 'card', last4],
  // other long digit runs (8-12 digits) could be account or card fragments -> remove
  [/(?<![\d.,:/\-])(?:\d ?){7,11}\d(?![\d.,:/\-])/g, 'number'],
  // masked card numbers like **** 1234, •••• 1234, xxxx-1234 -> keep last 4
  [/[*•●xX]{2,}[ \-]?\d{4}(?!\d)/g, 'card', last4],
  [/[*•●xX]{2,}[ \-]?\d{1,3}(?!\d)/g, 'card'],
  // "card ending in 1234", "כרטיס 1234", "אשראי 1234" -> keep last 4
  [/(כרטיס|אשראי|ויזה|visa|mastercard|מאסטרקארד|מסטרקארד|אמקס|amex|אמריקן אקספרס|american express|דיינרס|diners|ישראכרט|isracard|לאומי קארד|(?:^|\s)כאל|(?:^|\s)מקס|המסתיים ב|מסתיים ב|ending in|card)[^\n\d]{0,24}\d{4}(?!\d)/gi, 'card', last4],
  // expiry date next to its label
  [/(תוקף|תוקפו|(?<![a-z])valid(?![a-z])|(?<![a-z])exp(?![a-z])\.?|expiry|expires)[^\n\d]{0,8}\d{1,2}\s?[\/.\-]\s?\d{2,4}/gi, 'expiry'],
  // security code
  [/((?<![a-z])cvv2?(?![a-z])|(?<![a-z])cvc(?![a-z])|קוד אבטחה|3 ספרות)[^\n\d]{0,8}\d{3,4}/gi, 'cvv'],
  // Israeli ID number next to its label
  [/(ת\.?\s?ז\.?|תעודת זהות|מספר זהות|(?<![a-z])id(?![a-z]))[^\n\d]{0,8}\d{5,9}/gi, 'id'],
  // voucher / approval / reference numbers
  [/(שובר|אסמכתא|אסמכתה|מס['׳]?\s?אישור|קוד אישור|מספר אישור|(?<![a-z])approval(?![a-z])|(?<![a-z])reference(?![a-z])|(?<![a-z])ref(?![a-z])\.?)[^\n\d]{0,8}\d{3,}/gi, 'ref'],
  // bank account / branch numbers next to their label
  [/(חשבון|סניף|(?<![a-z])account(?![a-z]))[^\n\d]{0,8}\d[\d\-\/]{3,}/gi, 'account'],
];
// whole lines that only carry account-level information
const DROP_LINE = /בעל[ת]? הכרטיס|שם בעל|מסגרת(?:\s+(?:אשראי|פנויה|כרטיס)|[\s:]*[₪\d])|ניצול(?:\s+מסגרת|[\s:]*[₪\d])|יתרה לניצול|יתרת (זכות|חובה|חשבון)|קוד סודי|סיסמה|(?<![a-z])password(?![a-z])|(?<![a-z])pin(?![a-z])/i;

/** Returns the cleaned text and how many sensitive items were removed. */
export function redactSensitive(text) {
  let removed = 0;
  const lines = String(text || '').split(/\r?\n/).filter(l => {
    if (DROP_LINE.test(l)) { if (/\d/.test(l)) removed++; return false; }
    return true;
  });
  let out = lines.join('\n');
  const cards = new Set();
  for (const [re, kind, keep] of RULES) out = out.replace(re, m => {
    if (keep) { const r = keep(m); const c = r.match(/⟦C(\d{4})⟧/); if (c) cards.add(c[1]); if (kind === 'card' && m.replace(/\D/g, '').length > 4) removed++; return r; }
    removed++; return ' ';
  });
  return { text: out, removed, cards: [...cards] };
}

/** For single fields (merchant name, note): drops long digit runs that could be card or account numbers. */
export function cleanField(s, max = 80) {
  // a single field (a shop name) is never dropped as a whole - only number-like parts are removed
  let out = String(s || '');
  for (const [re, , keep] of RULES) out = out.replace(re, m => (keep ? keep(m) : ' '));
  return out.replace(/⟦C\d{4}⟧/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
/** Last 4 digits of the card mentioned in a text (file title, header), or ''. */
export function cardOf(text) {
  const c = redactSensitive(String(text || '')).text.match(/⟦C(\d{4})⟧/);
  return c ? c[1] : '';
}
