// Guesses a category from a merchant name. Runs on the device only.
import { normMerchant } from './calc.js';

const DICT = [
  ['super', /שופרסל|רמי ?לוי|ויקטורי|יוחננוף|מחסני השוק|אושר עד|טיב טעם|יינות ביתן|חצי חינם|קרפור|carrefour|am:pm|ampm|סופר|מכולת|מינימרקט|קואופ|פרש מרקט|freshmarket|שוק|מעדני|מאפיי|ירקות|פירות|קצביי|זול סטוק|נתיב החסד|קשת טעמים|סטופ מרקט|מגה/i],
  ['food', /ארומה|aroma|קפה|cafe|coffee|לנדוור|גרג|מקדונלד|mcdonald|בורגר|burger|פיצה|pizza|דומינו|wolt|וולט|תן ביס|10bis|סושי|sushi|מסעד|שווארמה|פלאפל|חומוס|גלידה|cofix|קופיקס|ג'ויה|רולדין|בייגל|מקסים|אגאדיר|שגב|נאפיס|starbucks/i],
  ['transport', /פז |^פז|paz|דלק|delek|סונול|sonol|ten |טן |yellow|ילו|דור אלון|אלון|רב ?קו|rav ?kav|מוביט|moovit|רכבת|אגד|דן |מטרופולין|אקסטרה|גט |gett|yango|יאנגו|חניון|חניה|פנגו|pango|סלופארק|cellopark|כביש 6|דרך ארץ|מנהרות|טסט|מוסך|צמיגים|ביטוח רכב|uber|bolt/i],
  ['shopping', /זארה|zara|h&m|hm |קסטרו|castro|פוקס|fox|אמריקן איגל|גולף|golf|טרמינל|terminal x|ניקה|nike|אדידס|adidas|עלי ?אקספרס|aliexpress|אמזון|amazon|שיין|shein|temu|טמו|ksp|באג|bug|איבורי|ivory|מחסני חשמל|ליידי|הום סנטר|next|נקסט|רנואר|מנגו|mango|קרוקס|נעלי/i],
  ['home', /איקאה|ikea|ace|אייס|הום סנטר|home center|ביתילי|עמינח|כתר|שטיח|ניקיון|אינסטלטור|חשמלאי|ארנונה|ועד בית|(?:^|\s)מי(?:ם)?(?:\s|$)|חברת החשמל|iec|סופרגז|אמישראגז|פזגז|(?:^|\s)גז(?:\s|$)/i],
  ['health', /סופר ?פארם|super ?pharm|be |בי פארם|good ?pharm|גוד פארם|מכבי|כללית|מאוחדת|לאומית|פארם|רופא|מרפאה|קופת חולים|אופטיק|משקפ|שיניים|רוקח/i],
  ['fun', /סינמה|cinema|יס פלאנט|yes planet|רב חן|הופעה|לאן|eventim|כרטיס|תיאטרון|מוזיאון|ספא|spa|באולינג|לונה|steam|playstation|xbox|nintendo|(?:^|\s)בר(?:\s|$)|פאב|pub/i],
  ['subs', /netflix|נטפליקס|spotify|ספוטיפיי|apple\.com|icloud|google|youtube|disney|דיסני|hbo|amazon prime|פרטנר|partner|סלקום|cellcom|פלאפון|pelephone|הוט|hot |yes |בזק|bezeq|גולן|golan|019|012|we4g|רמי לוי תקשורת|chatgpt|openai|anthropic|claude|adobe|microsoft|dropbox/i],
  ['gifts', /מתנ|gift|פרחים|זר |צעצוע|toys|שילב|כפר השעשועים/i],
  ['health', /ביטוח בריאות|הראל|מגדל|כלל ביטוח|הפניקס|מנורה|איילון/i],
];

export function guessCategory(merchant, rules = {}, categoryIds = new Set()) {
  const n = normMerchant(merchant);
  if (rules[n] && (!categoryIds.size || categoryIds.has(rules[n]))) return rules[n];
  const raw = String(merchant || '') + ' ';
  for (const [cat, re] of DICT) if (re.test(raw) && (!categoryIds.size || categoryIds.has(cat))) return cat;
  return 'other';
}

// Rows in a bank statement that pay a credit card bill. The card's own transactions
// are imported separately, so these would be counted twice.
const CARD_PAYMENT = /ישראכרט|isracard|כרטיסי אשראי|כ\.א\.ל|כאל|cal |מקס איט|max it|לאומי קארד|אמריקן אקספרס|american express|דיינרס|diners|חיוב כרטיס|כרטיס אשראי/i;
export const looksLikeCardPayment = s => CARD_PAYMENT.test(String(s || ''));

// Matches a fixed expense by its keyword (for example "נטפליקס").
export function matchFixed(merchant, fixed = []) {
  const n = normMerchant(merchant);
  return fixed.find(f => f.keyword && n.includes(normMerchant(f.keyword))) || null;
}
