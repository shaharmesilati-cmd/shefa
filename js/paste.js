// Turns the text of a transactions screen (from on-device OCR, or text the user copied from a screenshot)
// into purchases: date, time, merchant, place, amount, installments.
// Sensitive details (card numbers, IDs, approval codes...) are removed first, see sanitize.js.
import { toAmount } from './importers.js';
import { isoOf } from './calc.js';
import { redactSensitive } from './sanitize.js';

const SKIP = /סה"?כ|יתרה|מסגרת|לחיוב ב|החיוב הבא|חיוב הבא|ניצול|נקודות|הטבה|מבצע|כל העסקאות|עסקאות אחרונות|הצג עוד|הצג הכל|ישראכרט|isracard|דף הבית|פירוט|חיפוש|סינון|הגדרות|(?:^|\s)שלום(?:\s|,|!|$)|ערב טוב|בוקר טוב|צהריים טובים/i;
const DATE_G = /(?<![\d₪.,])(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?(?![\d,])/g;
const TIME = /(?<![\d.,])([01]?\d|2[0-3]):([0-5]\d)(?![\d.,])/;
// "₪1,200.00" or "1,200.00 ₪" - but not "26 ₪1,200" (a date's year followed by a shekel price)
const SHEKEL = /-?₪\s?-?\d[\d,]*(?:\.\d{1,2})?|(?<![\d\/.,])-?\d[\d,]*(?:\.\d{1,2})?\s?(?:₪|ש"ח|ש״ח)(?!\s?-?\d)/;
const PLAIN = /-?\d{1,3}(?:,\d{3})+(?:\.\d{2})?(?!\d)|-?\d+\.\d{2}(?!\d)/;
const INST = /תשלום\s*(\d+)\s*(?:מתוך|מ)\s*(\d+)/;
// A real name has at least 2 Hebrew letters or one Latin word of 3+ letters (status-bar noise like "al" or "o is" does not)
const hasWords = s => (s.match(/[\u0590-\u05FF]/g) || []).length >= 2 || /[a-z]{3,}/i.test(s);
// Summary lines carry a TOTAL, not a purchase: skip them together with their amount
const TOTAL = /סה["״']?\s?כ|סך\s*הכל|סך\s*חיוב|לחיוב\s*החודש|יתרה|total/i;
// Section titles, buttons and footers of the card app
const HEADING = /^(עסקאות|חיובים|תנועות)(\s|$)|עסקאות\s+(שאושרו|למועד|בחו|בארץ|אחרונות)|חזרה למעלה|למועד חיוב|טרם נקלטו/;
const STOP = /תנאים משפטיים|הנתונים נכונים|הנתונים לא כוללים/;

const CITIES = ['תל אביב', 'ת"א', 'ירושלים', 'חיפה', 'ראשון לציון', 'ראשל"צ', 'פתח תקווה', 'פ"ת', 'אשדוד', 'נתניה', 'באר שבע', 'ב"ש', 'בני ברק', 'חולון', 'רמת גן', 'אשקלון', 'רחובות', 'בת ים', 'בית שמש', 'כפר סבא', 'הרצליה', 'חדרה', 'מודיעין', 'נצרת', 'לוד', 'רמלה', 'רעננה', 'הוד השרון', 'גבעתיים', 'קריית גת', 'קרית גת', 'נהריה', 'עפולה', 'אילת', 'קריית אתא', 'קרית אתא', 'קריית ביאליק', 'קרית ביאליק', 'קריית מוצקין', 'קרית מוצקין', 'קריית ים', 'קרית ים', 'קריית אונו', 'קרית אונו', 'קריית שמונה', 'קרית שמונה', 'יבנה', 'אור יהודה', 'נס ציונה', 'ראש העין', 'טבריה', 'צפת', 'דימונה', 'אופקים', 'שדרות', 'נתיבות', 'יהוד', 'גבעת שמואל', 'אריאל', 'מעלה אדומים', 'זכרון יעקב', 'כרמיאל', 'עכו', 'טירת כרמל', 'יקנעם', 'סביון', 'כפר יונה', 'אבן יהודה', 'שוהם', 'גדרה', 'קיסריה', 'פרדס חנה', 'רמת השרון', 'הרצליה פיתוח', 'מבשרת', 'אום אל פחם', 'רהט', 'טייבה', 'שפרעם', 'ערד', 'מצפה רמון', 'יוקנעם', 'קצרין', 'בית שאן', 'מגדל העמק', 'נוף הגליל', 'עתלית', 'tel aviv', 'jerusalem', 'haifa'];
const CITY_RE = new RegExp(`(?:^|\\s|-)(${CITIES.map(c => c.replace(/[.*+?^${}()|[\]\\"]/g, m => '\\' + m)).join('|')})(?=$|\\s|-|,)`, 'i');
// "נובמבר 2026" or a lone "2026" at the top is a year, not a card
const MONTH_WORD = /ינואר|פברואר|מרץ|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר|חודש|שנת/;
const isYearLine = (line, n) => n >= 1990 && n <= 2099 && (MONTH_WORD.test(line) || /^\s*\d{4}\s*$/.test(line));
export function placeOf(merchant) { const m = String(merchant || '').match(CITY_RE); return m ? m[1] : ''; }

function dateFrom(m, today) {
  let y = m[3] ? +m[3] : today.getFullYear(); if (y < 100) y += 2000;
  let d = new Date(y, +m[2] - 1, +m[1]);
  if (d.getMonth() !== +m[2] - 1 || +m[2] > 12) return null;
  if (!m[3] && d > today) d = new Date(y - 1, +m[2] - 1, +m[1]);
  return isoOf(d);
}
const cleanName = s => s.replace(/₪|ש"ח|ש״ח|\bILS\b/g, ' ').replace(/[^֐-׿a-z0-9&'".\- ]/gi, ' ').replace(/\s+/g, ' ').replace(/^[\s\-.]+|[\s\-.]+$/g, '').trim();

/** Returns { rows, removed } - rows are purchases, removed is the number of sensitive items that were wiped. */
export function parseStatement(text, today = new Date()) {
  const { text: safe, removed } = redactSensitive(text);
  const tokens = [];
  let seenContent = false, seenAmount = false;
  for (let line of safe.split(/\n+/)) {
    line = line.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/[|_~^«»]/g, ' ').replace(/\s+/g, ' ').trim();
    if (STOP.test(line)) break; // legal footer: nothing after it is a purchase
    if (TOTAL.test(line)) continue;
    // top of the screen: a line that ends with 4 digits and has no other numbers is the card (e.g. "זהב 4093" or just "4093")
    if (!seenAmount && !/⟦C/.test(line)) {
      const m4 = line.match(/(?<![\d.,:\/₪-])(\d{4})\s*$/);
      if (m4 && !/\d/.test(line.slice(0, m4.index)) && !SKIP.test(line) && !isYearLine(line, +m4[1])) { tokens.push({ t: 'cardctx', v: m4[1] }); continue; }
    }
    const inc = line.includes('⟦IN⟧'); if (inc) line = line.replace(/⟦IN⟧/g, ' ').trim(); // money that came IN (bank 'זכות' column)
    const cm = [...line.matchAll(/⟦C(\d{4})⟧/g)];
    if (cm.length) { tokens.push({ t: 'cardctx', v: cm[cm.length - 1][1] }); line = line.replace(/⟦C\d{4}⟧/g, ' ').trim(); }
    if (!line) continue;
    let rest = line;
    const inst = rest.match(INST);
    if (inst) rest = rest.replace(inst[0], ' ');
    let a = (rest.match(SHEKEL) || [])[0] || null;
    if (a) rest = rest.replace(a, ' ');
    const tm = rest.match(TIME);
    if (tm) rest = rest.replace(tm[0], ' ');
    let date = null;
    let dateTxt = null, dateHasYear = false;
    for (const dm of rest.matchAll(DATE_G)) { const d = dateFrom(dm, today); if (d) { date = d; dateTxt = dm[0]; dateHasYear = !!dm[3]; rest = rest.replace(dm[0], ' '); break; } }
    if (!a) { a = (rest.match(PLAIN) || [])[0] || null; if (a) rest = rest.replace(a, ' '); }
    // "קפה 15.10" - a name with one d.mm number and no year is a price, not a date
    if (!a && date && !dateHasYear && /^\d{1,3}\.\d{2}$/.test(dateTxt) && hasWords(cleanName(rest))) { a = dateTxt; date = null; }
    const name = cleanName(rest);
    const isName = hasWords(name) && !SKIP.test(name) && !HEADING.test(name);
    if ((SKIP.test(line) || HEADING.test(name)) && !a) continue;
    // an amount with no name before any purchase appeared is screen chrome (status bar "5G", battery), not a purchase
    if (a && !isName && !seenContent) a = null;
    // a lone clock before any purchase is the phone's status bar - ignore it
    if (tm && !seenContent && !a && !date && !isName) continue;
    if (a || isName) tokens.push({ t: 'line' });
    if (date) tokens.push({ t: 'date', v: date });
    if (tm) tokens.push({ t: 'time', v: `${tm[1].padStart(2, '0')}:${tm[2]}` });
    if (inst) tokens.push({ t: 'inst', v: `${inst[1]}/${inst[2]}` });
    if (isName) { tokens.push({ t: 'name', v: name }); seenContent = true; }
    if (a) {
      const n = toAmount(a);
      if (n !== null && Math.abs(n) >= 0.5 && Math.abs(n) < 200000) {
        seenAmount = true;
        tokens.push({ t: 'amount', v: Math.abs(n) * (/-/.test(a) || /זיכוי|החזר/.test(line) ? -1 : 1), fx: /\$|€|£|USD|EUR|GBP|דולר|יורו/.test(line), inc });
        seenContent = true;
      }
    }
  }
  // group tokens into rows: a row closes when a slot that is already filled appears again
  const rows = []; let cur = {}, lastDate = null, card = null, firstCard = null;
  const close = () => { if (cur.amount !== undefined && cur.name) rows.push({ ...cur, card: cur.card || card }); cur = {}; };
  for (const k of tokens) {
    if (k.t === 'cardctx') { if (cur.name && cur.amount !== undefined) close(); card = k.v; firstCard = firstCard || k.v; continue; }
    if (k.t === 'line') { if (cur.name && cur.amount !== undefined) close(); continue; }
    if (cur[k.t] !== undefined) close();
    if (k.t === 'amount') { cur.amount = k.v; cur.fx = k.fx; cur.inc = k.inc; } else cur[k.t] = k.v;
  }
  close();
  return {
    removed,
    rows: rows.map(r => {
      if (r.date) lastDate = r.date;
      return { card: r.card || firstCard || null, date: r.date || lastDate || isoOf(today), time: r.time || null, merchant: r.name, place: placeOf(r.name), amount: r.amount,
        installment: r.inst || null, foreign: !!r.fx, kind: r.inc ? 'income' : undefined, amount: r.inc ? Math.abs(r.amount) : r.amount, dateGuessed: !r.date && !lastDate };
    }),
  };
}
export const parsePastedText = (text, today) => parseStatement(text, today).rows;
