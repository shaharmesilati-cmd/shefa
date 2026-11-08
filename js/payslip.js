// Reads the important numbers from a salary slip (תלוש שכר): net pay, gross pay, which month, employer.
// Everything else on the slip (ID, bank account, address, tax details) is wiped first and never kept.
import { redactSensitive } from './sanitize.js';
import { toAmount } from './importers.js';

const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const NUM = /\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+\.\d{1,2}|\d{4,6}/g;
const NET = /נטו\s*לתשלום|לתשלום\s*נטו|שכר\s*נטו|סה["״]?כ\s*נטו|נטו\s*בבנק|נטו/;
const GROSS = /סה["״]?כ\s*ברוטו|שכר\s*ברוטו|סה["״]?כ\s*תשלומים|ברוטו\s*לתשלום|ברוטו/;
const NOT_GROSS = /ברוטו\s*למס|ברוטו\s*לב\.?ל|ברוטו\s*שוטף|מצטבר/;

function amountsIn(line) {
  return [...line.replace(/[₪]/g, ' ').matchAll(NUM)].map(m => toAmount(m[0]))
    .filter(n => n !== null && n >= 500 && n <= 200000 && !(n >= 1990 && n <= 2099 && Number.isInteger(n)));
}
function findAmount(lines, re, not) {
  for (let i = 0; i < lines.length; i++) {
    if (!re.test(lines[i]) || (not && not.test(lines[i]))) continue;
    const here = amountsIn(lines[i]);
    if (here.length) return here[here.length - 1];
    const next = lines[i + 1] ? amountsIn(lines[i + 1]) : [];
    if (next.length) return next[0];
  }
  return null;
}
function findMonth(text, today) {
  let m = text.match(/(?:תלוש|משכורת|שכר|לחודש|חודש|עבור|לתקופה)[^\n\d]{0,20}?(\d{1,2})\s*[\/.\-]\s*(20\d{2}|\d{2})(?!\d)/);
  if (m) { let y = +m[2]; if (y < 100) y += 2000; const mo = +m[1]; if (mo >= 1 && mo <= 12) return `${y}-${String(mo).padStart(2, '0')}`; }
  const re = new RegExp(`(${MONTHS.join('|')})\\s*(20\\d{2})`);
  m = text.match(re);
  if (m) return `${m[2]}-${String(MONTHS.indexOf(m[1]) + 1).padStart(2, '0')}`;
  m = text.match(/(?<![\d.\/])(\d{1,2})\s*\/\s*(20\d{2})(?!\d)/);
  if (m && +m[1] >= 1 && +m[1] <= 12) return `${m[2]}-${String(+m[1]).padStart(2, '0')}`;
  // default: the previous calendar month (slips usually arrive after the month ends)
  const d = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function findEmployer(lines) {
  const l = lines.find(x => /בע["״]?מ|בעמ\b|ltd|inc\.?|עמותת|עיריית|משרד ה/i.test(x));
  if (!l) return '';
  return l.replace(/(שם\s*)?(המעסיק|מעסיק|מעביד)\s*:?/g, ' ').replace(/[^֐-׿a-z0-9"״'&.\- ]/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
}

export function parsePayslip(text, today = new Date()) {
  const { text: safe, removed } = redactSensitive(text);
  const lines = safe.split(/\n+/).map(l => l.replace(/[‎‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const net = findAmount(lines, /נטו\s*לתשלום|לתשלום\s*נטו|נטו\s*בבנק/) ?? findAmount(lines, NET, /ברוטו/);
  let gross = findAmount(lines, GROSS, NOT_GROSS);
  if (gross !== null && net !== null && gross < net) gross = null;
  return { net, gross, monthKey: findMonth(safe, today), employer: findEmployer(lines), removed };
}
