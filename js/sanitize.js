// Removes anything that could help someone misuse a credit card or account, BEFORE the text is parsed.
// Runs on every piece of text that comes from a screenshot, a paste or a file.

const RULES = [
  // full or partial card numbers: 8-19 digits, optionally split by spaces or dashes
  [/(?<![\d.,:/])(?:\d[ \-]?){7,18}\d(?![\d.,:/])/g, 'card'],
  // masked card numbers like **** 1234, •••• 1234, xxxx-1234
  [/[*•●xX]{2,}[ \-]?\d{2,4}/g, 'card'],
  // "card ending in 1234", "כרטיס 1234", "אשראי 1234"
  [/(כרטיס|אשראי|ויזה|visa|mastercard|מאסטרקארד|אמקס|amex|דיינרס|המסתיים ב|מסתיים ב|ending in|card)[^\n\d]{0,12}\d{4}\b/gi, 'card'],
  // expiry date next to its label
  [/(תוקף|תוקפו|valid|exp\.?|expiry|expires)[^\n\d]{0,8}\d{1,2}\s?[\/.\-]\s?\d{2,4}/gi, 'expiry'],
  // security code
  [/(cvv2?|cvc|קוד אבטחה|3 ספרות)[^\n\d]{0,8}\d{3,4}/gi, 'cvv'],
  // Israeli ID number next to its label
  [/(ת\.?\s?ז\.?|תעודת זהות|מספר זהות|id)[^\n\d]{0,8}\d{5,9}/gi, 'id'],
  // voucher / approval / reference numbers
  [/(שובר|אסמכתא|אסמכתה|מס['׳]?\s?אישור|קוד אישור|מספר אישור|approval|reference|ref\.?)[^\n\d]{0,8}\d{3,}/gi, 'ref'],
  // bank account / branch numbers next to their label
  [/(חשבון|סניף|account)[^\n\d]{0,8}\d[\d\-\/]{3,}/gi, 'account'],
];
// whole lines that only carry account-level information
const DROP_LINE = /בעל[ת]? הכרטיס|שם בעל|מסגרת|ניצול|יתרה לניצול|יתרת|קוד סודי|סיסמה|password|pin/i;

/** Returns the cleaned text and how many sensitive items were removed. */
export function redactSensitive(text) {
  let removed = 0;
  const lines = String(text || '').split(/\r?\n/).filter(l => {
    if (DROP_LINE.test(l)) { if (/\d/.test(l)) removed++; return false; }
    return true;
  });
  let out = lines.join('\n');
  for (const [re] of RULES) out = out.replace(re, () => { removed++; return ' '; });
  return { text: out, removed };
}

/** For single fields (merchant name, note): drops long digit runs that could be card or account numbers. */
export function cleanField(s, max = 80) {
  return redactSensitive(String(s || '')).text.replace(/\s+/g, ' ').trim().slice(0, max);
}
