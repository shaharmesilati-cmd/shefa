// Reads Excel / CSV statements exported from Isracard or a bank website.
// Everything happens in the browser; the file never leaves the device.
import { isoOf } from './calc.js';
import { readSpreadsheet } from './xlsx.js';
import { cleanField } from './sanitize.js';

/* ---------- CSV (built in, no library) ---------- */
export function parseCSV(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const first = text.split(/\r?\n/, 1)[0] || '';
  const delim = [',', ';', '\t'].map(d => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return [rows];
}

/** Returns an array of sheets, each an array of rows (arrays of cells). */
export async function readWorkbook(file) {
  const sheets = await readSpreadsheet(file);
  if (sheets) return sheets;
  const buf = await file.arrayBuffer();
  let text = new TextDecoder('utf-8').decode(buf);
  if (text.includes('�')) text = new TextDecoder('windows-1255').decode(buf);
  return parseCSV(text);
}

/* ---------- column detection ---------- */
const H = {
  date: /תאריך\s*(רכישה|עסקה|ערך)?|^תאריך|date/i,
  chargeDate: /תאריך\s*(חיוב|ערך)/,
  merchant: /שם\s*בית\s*(ה)?עסק|בית\s*עסק|תיאור|פרטים|הפעולה|תאור|description|merchant/i,
  amountCharge: /סכום\s*(ה)?חיוב|סכום\s*בש"ח|חיוב\s*בש"ח|charged/i,
  amount: /סכום|amount|חיוב/i,
  debit: /^חובה|בחובה|debit/i,
  credit: /^זכות|בזכות|credit/i,
  details: /פירוט\s*נוסף|הערות|פרטים\s*נוספים|סוג\s*עסקה|notes/i,
  currency: /מטבע/,
};
const cellStr = c => (c instanceof Date ? isoOf(c) : String(c ?? '')).trim();

export function detectColumns(header) {
  const h = header.map(cellStr);
  const find = (re, not = []) => h.findIndex((x, i) => x && re.test(x) && !not.includes(i));
  const map = {};
  map.date = h.findIndex(x => H.date.test(x) && !H.chargeDate.test(x));
  if (map.date < 0) map.date = find(H.date);
  map.merchant = find(H.merchant);
  map.debit = find(H.debit);
  map.credit = find(H.credit);
  map.amount = find(H.amountCharge);
  if (map.amount < 0) map.amount = find(H.amount, [map.date, map.merchant, map.debit, map.credit].filter(i => i >= 0));
  map.details = find(H.details, [map.merchant]);
  map.currency = find(H.currency);
  map.type = map.debit >= 0 && map.credit >= 0 ? 'bank' : 'card';
  return map;
}
function isHeaderRow(row) {
  const s = row.map(cellStr);
  return s.some(x => H.date.test(x)) && s.some(x => H.amount.test(x) || H.debit.test(x));
}

export function toISODate(v) {
  if (v instanceof Date && !isNaN(v)) return isoOf(v);
  if (typeof v === 'number' && v > 20000 && v < 80000) { // Excel serial date
    const d = new Date(Math.round((v - 25569) * 86400000)); return isoOf(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (m) { let y = +m[3]; if (y < 100) y += 2000; const d = new Date(y, +m[2] - 1, +m[1]); if (d.getMonth() === +m[2] - 1) return isoOf(d); }
  return null;
}
export function toAmount(v) {
  if (typeof v === 'number') return v;
  let s = String(v ?? '').replace(/[₪$€\s,]/g, '').replace(/[^\d.\-]/g, '');
  if (/^\d.*-$/.test(s)) s = '-' + s.slice(0, -1);
  const n = parseFloat(s);
  return isFinite(n) ? n : null;
}

/**
 * Finds every table in every sheet and returns raw rows plus the detected mapping.
 * Isracard files often hold more than one table (Israel / abroad) - each gets its own header.
 */
export function extractRows(sheets) {
  const out = []; let mapping = null;
  for (const rows of sheets) {
    let map = null;
    for (const row of rows) {
      if (!row || !row.length) continue;
      if (isHeaderRow(row)) { map = detectColumns(row); mapping = mapping || { ...map, header: row.map(cellStr) }; continue; }
      if (!map) continue;
      const date = toISODate(row[map.date]);
      if (!date) continue;
      out.push({ row, map });
    }
  }
  return { rows: out, mapping };
}

/** Turns raw rows into transactions using a mapping (auto or user-adjusted). */
export function rowsToTx(rows, override) {
  const res = [];
  for (const { row, map: auto } of rows) {
    const map = override ? { ...auto, ...override } : auto;
    const date = toISODate(row[map.date]);
    const merchant = cleanField(cellStr(row[map.merchant])) || 'ללא שם';
    if (!date) continue;
    let amount = null, kind = 'expense';
    if (map.type === 'bank' && map.debit >= 0 && map.credit >= 0) {
      const d = toAmount(row[map.debit]) || 0, c = toAmount(row[map.credit]) || 0;
      if (d) amount = Math.abs(d); else if (c) { amount = Math.abs(c); kind = 'income'; }
    } else {
      amount = toAmount(row[map.amount]);
    }
    if (amount === null || amount === 0) continue;
    if (/סה"?כ|total/i.test(merchant)) continue;
    const details = map.details >= 0 ? cellStr(row[map.details]) : '';
    const inst = details.match(/תשלום\s*(\d+)\s*(?:מתוך|מ-?)\s*(\d+)/);
    const cur = map.currency >= 0 ? cellStr(row[map.currency]) : '';
    res.push({ date, merchant, amount: Math.round(amount * 100) / 100, kind, installment: inst ? `${inst[1]}/${inst[2]}` : null,
      foreign: !!cur && !/ש"?ח|₪|ils|nis/i.test(cur), note: details && !inst ? cleanField(details, 120) : '' });
  }
  return res;
}
