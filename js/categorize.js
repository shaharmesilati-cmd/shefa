// Decides the category of a purchase ON THE DEVICE (nothing is sent anywhere).
// It learns from your own choices, recognises names that look alike, and knows hundreds of Israeli businesses.
import { normMerchant } from './calc.js';

const DICT = [
  ['super', /שופרסל|רמי ?לוי|ויקטורי|יוחננוף|מחסני השוק|מחסני להב|אושר עד|טיב טעם|יינות ביתן|חצי חינם|קרפור|carrefour|am:pm|ampm|סופר|מכולת|מינימרקט|מרקט|קואופ|פרש מרקט|freshmarket|(?:^|\s)שוק(?:\s|$)|מעדני|מאפיי|מאפה|ירקות|ירקן|פירות|קצביי|אטליז|זול סטוק|נתיב החסד|קשת טעמים|סטופ מרקט|(?:^|\s)מגה(?:\s|$)|יש חסד|יש בשכונה|good market|גוד מרקט|קינג סטור|פיצוחי|ממתקי|טבע קסטל|nature ?shop|בית הטבע|חנות טבע|קיוסק|יינות|wine/i],
  ['food', /ארומה|aroma|קפה|cafe|caffe|coffee|לנדוור|גרג|מקדונלד|mcdonald|בורגר|burger|פיצה|pizza|דומינו|wolt|וולט|תן ביס|10bis|cibus|סיבוס|סושי|sushi|מסעד|שווארמה|פלאפל|חומוס|גלידה|cofix|קופיקס|ג'ויה|רולדין|בייגל|מקסים|אגאדיר|שגב|נאפיס|starbucks|קפולסקי|בנדיקט|ביסטרו|bistro|מזנון|דליקטסן|(?:^|\s)deli|kfc|subway|סאבוואי|שיפודי|גריל|grill|נודלס|noodles|ראמן|טאקו|בורקס|לחמים|אבולעפיה|ג'חנון|קונדיטוריה|פטיסרי|יוגורט|גלאטו|אמורינו/i],
  ['transport', /(?:^|\s)פז(?:\s|$)|paz|דלק|delek|סונול|sonol|(?:^|\s)ten(?:\s|$)|(?:^|\s)טן(?:\s|$)|yellow|(?:^|\s)ילו(?:\s|$)|דור אלון|רב ?קו|rav ?kav|מוביט|moovit|רכבת|(?:^|\s)אגד|(?:^|\s)דן(?:\s|$)|מטרופולין|אקסטרה|(?:^|\s)גט(?:\s|$)|gett|yango|יאנגו|חניון|חניה|חנייה|פנגו|pango|סלופארק|cellopark|כביש 6|כביש חוצה|דרך ארץ|מנהרות|נתיבים מהירים|(?:^|\s)טסט|מוסך|צמיגים|ביטוח רכב|uber|bolt|ליסינג|שלמה סיקסט|אלדן|(?:^|\s)הרץ|avis|שטיפת רכב|רחיצת רכב|מצברים|רישוי|משרד התחבורה|מונית|taxi|(?:^|\s)lime(?:\s|$)/i],
  ['shopping', /זארה|zara|h&m|(?:^|\s)hm(?:\s|$)|קסטרו|castro|(?:^|\s)פוקס|(?:^|\s)fox(?:\s|$)|אמריקן איגל|(?:^|\s)גולף|(?:^|\s)golf|טרמינל|terminal x|ניקה|nike|אדידס|adidas|עלי ?אקספרס|aliexpress|אמזון|amazon|שיין|shein|temu|טמו|(?:^|\s)ksp|(?:^|\s)באג(?:\s|$)|(?:^|\s)bug(?:\s|$)|איבורי|ivory|מחסני חשמל|ליידי|(?:^|\s)next(?:\s|$)|נקסט|רנואר|מנגו|mango|קרוקס|נעלי|הודיס|הוניגמן|טוונטי פור סבן|מגה ספורט|דקטלון|decathlon|ספורט|בגדי|הלבשה|אופנה|תכשיט|פנדורה|pandora|סטימצקי|צומת ספרים|ebay|איביי|istore|איסטור|מחשבים|סלולר|אלקטרה|מקס סטוק|max stock|דולר סטור/i],
  ['home', /איקאה|ikea|(?:^|\s)ace(?:\s|$)|אייס|הום סנטר|home center|ביתילי|עמינח|(?:^|\s)כתר|שטיח|ניקיון|אינסטלטור|חשמלאי|ארנונה|ועד בית|(?:^|\s)מי(?:ם)?(?:\s|$)|תאגיד מים|מי אביבים|הגיחון|חברת החשמל|(?:^|\s)iec|סופרגז|אמישראגז|פזגז|(?:^|\s)גז(?:\s|$)|שכירות|שכר דירה|משכנתא|גינון|משתלה|טמבור|כלי בית|נגר|מנעולן|הדברה|מכבסה|כביסה/i],
  ['health', /סופר ?פארם|super ?pharm|(?:^|\s)be(?:\s|$)|בי פארם|good ?pharm|גוד פארם|מכבי|כללית|מאוחדת|לאומית|פארם|רופא|מרפאה|קופת חולים|אופטיק|משקפ|שיניים|רוקח|מרקחת|דנטל|dental|פיזיותרפ|פסיכולוג|מעבדה|קליניקה|clinic|בית חולים|איכילוב|שיבא|הדסה|תרופות|ויטמין|ביטוח בריאות|(?:^|\s)הראל|(?:^|\s)מגדל|כלל ביטוח|הפניקס|(?:^|\s)מנורה|איילון|ביטוח ישיר|wesure|ליברה|libra/i],
  ['fun', /סינמה|cinema|יס פלאנט|yes planet|רב חן|הופעה|(?:^|\s)לאן(?:\s|$)|eventim|tickets|תיאטרון|מוזיאון|(?:^|\s)ספא(?:\s|$)|(?:^|\s)spa(?:\s|$)|באולינג|לונה|steam|playstation|xbox|nintendo|(?:^|\s)בר(?:\s|$)|פאב|(?:^|\s)pub|מועדון|קאנטרי|הולמס|holmes|ספורטן|חדר כושר|(?:^|\s)gym|פילאטיס|יוגה|בריכה|גן חיות|ספארי|לונה פארק|אטרקציות|escape|חדר בריחה|זאפה|בארבי|מלון|hotel|booking|airbnb|צימר|נופש|טיסה|טיסות|אל על|el ?al|ישראייר|ארקיע|wizz|ryanair|easyjet|duty ?free|דיוטי|expedia|agoda/i],
  ['subs', /netflix|נטפליקס|spotify|ספוטיפיי|apple\.com|icloud|google|youtube|disney|דיסני|(?:^|\s)hbo|amazon prime|פרטנר|partner|סלקום|cellcom|פלאפון|pelephone|(?:^|\s)הוט|(?:^|\s)hot(?:\s|$)|(?:^|\s)yes(?:\s|$)|בזק|bezeq|גולן טלקום|golan|(?:^|\s)019|(?:^|\s)012|we4g|רמי לוי תקשורת|chatgpt|openai|anthropic|claude|adobe|microsoft|dropbox|canva|notion|zoom|linkedin|patreon|audible|kindle|(?:^|\s)wix|godaddy|(?:^|\s)סטינג|(?:^|\s)sting|apple music|deezer|tidal|אקספון|xfone|nordvpn|surfshark/i],
  ['gifts', /מתנ|gift|פרחים|(?:^|\s)זר(?:\s|$)|צעצוע|toys|שילב|כפר השעשועים|תרומה|תרומות|עמותה|עמותת|ויצו|גלויה|חתונה/i],
];

// Words that never identify a business on their own
const STOP = new Set(['טעינות', 'טעינה', 'תשלום', 'תשלומים', 'הוראת', 'קבע', 'העברה', 'העברת', 'בעמ', 'בע"מ', 'בע״מ', 'סניף', 'חנות', 'של', 'את', 'עם', 'בע', 'ltd', 'inc', 'com', 'www', 'il', 'co', 'the', 'מרכז', 'קניון', 'תל', 'אביב', 'ירושלים', 'חיפה', 'רמת', 'גן']);
/** The word that names the business: "טעינות - חבר של קבע" -> "חבר", "שופרסל דיל רמת גן" -> "שופרסל". */
export function brandOf(merchant) {
  const words = String(merchant || '').toLowerCase().replace(/["'`׳״.,*()\/\\|#\-_:]/g, ' ').split(/\s+/).filter(Boolean);
  return words.find(w => w.length >= 2 && !STOP.has(w) && !/^\d+$/.test(w)) || '';
}
function bigrams(s) { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; }
function sim(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a))) return 0.92;
  const A = bigrams(a), B = bigrams(b); let i = 0, t = 0;
  for (const [g, n] of A) { i += Math.min(n, B.get(g) || 0); t += n; }
  for (const n of B.values()) t += n;
  return t ? (2 * i) / t : 0;
}
const sameBrand = (a, b) => { const x = brandOf(a); return x.length >= 3 && x === brandOf(b); };

// Payment apps and cash: the name says nothing about what was bought
const GENERIC = /(?:^|\s)bit(?:\s|$)|(?:^|\s)ביט(?:\s|$)|paybox|פייבוקס|paypal|פייפאל|apple ?pay|google ?pay|העברה|העברת|pepper ?pay|כספומט|משיכת מזומן|(?:^|\s)atm(?:\s|$)/i;
export const isGeneric = m => GENERIC.test(String(m || ''));

export const AUTO = 0.7;
/**
 * Returns {cat, conf, why}. conf >= AUTO means "sure enough to assign without asking".
 *   rule     1.0  you chose a category for this exact business
 *   similar  0.9  you chose one for a business with the same brand word or a very similar name
 *   history  0.8  purchases with a similar name already have a category
 *   known    0.85 the built-in list of Israeli businesses and keywords
 */
export function classify(merchant, ctx = {}) {
  const { rules = {}, ids = new Set(), history = [] } = ctx;
  const ok = c => c && c !== 'other' && (!ids.size || ids.has(c));
  const raw = String(merchant || ''), n = normMerchant(raw);
  if (isGeneric(raw)) return { cat: 'other', conf: 0, why: 'generic' };
  if (ok(rules[n])) return { cat: rules[n], conf: 1, why: 'rule' };
  let best = null;
  for (const [k, c] of Object.entries(rules)) {
    if (!ok(c)) continue;
    const sc = Math.max(sim(n, k), brandOf(raw).length >= 3 && k.includes(normMerchant(brandOf(raw))) ? 0.88 : 0);
    if (!best || sc > best.sc) best = { c, sc };
  }
  if (best && best.sc >= 0.72) return { cat: best.c, conf: 0.9, why: 'similar' };
  const votes = {};
  for (const h of history) {
    if (!ok(h.category)) continue;
    const sc = Math.max(sim(n, normMerchant(h.merchant)), sameBrand(raw, h.merchant) ? 0.9 : 0);
    if (sc >= 0.72) votes[h.category] = (votes[h.category] || 0) + sc * (h.confirmed ? 2 : 1);
  }
  const top = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
  if (top) return { cat: top[0], conf: 0.8, why: 'history' };
  const padded = raw + ' ';
  for (const [cat, re] of DICT) if (re.test(padded) && ok(cat)) return { cat, conf: 0.85, why: 'known' };
  return { cat: 'other', conf: 0, why: 'unknown' };
}

/** Purchases (already categorised) that the classifier can learn from. */
export const historyOf = tx => tx.filter(t => t.kind === 'expense' && t.category && t.category !== 'other' && !t.ignored).slice(-800);

export function guessCategory(merchant, rules = {}, categoryIds = new Set(), history = []) {
  const r = classify(merchant, { rules, ids: categoryIds, history });
  return r.conf >= AUTO ? r.cat : 'other';
}
/** Are two names the same business (for applying one choice to all of them)? */
export const sameBusiness = (a, b) => normMerchant(a) === normMerchant(b) || sameBrand(a, b) || sim(normMerchant(a), normMerchant(b)) >= 0.72;

// Rows in a bank statement that pay a credit card bill. The card's own transactions
// are imported separately, so these would be counted twice.
const CARD_PAYMENT = /ישראכרט|isracard|כרטיסי אשראי|כ\.א\.ל|כאל|cal |מקס איט|max it|לאומי קארד|אמריקן אקספרס|american express|דיינרס|diners|חיוב כרטיס|כרטיס אשראי/i;
export const looksLikeCardPayment = s => CARD_PAYMENT.test(String(s || ''));

// Matches a fixed expense by its keyword (for example "נטפליקס").
export function matchFixed(merchant, fixed = []) {
  const n = normMerchant(merchant);
  return fixed.find(f => f.keyword && n.includes(normMerchant(f.keyword))) || null;
}
