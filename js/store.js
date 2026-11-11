// App state in memory while unlocked; persisted encrypted through vault.js.
import * as vault from './vault.js';
import { budgetKeyOf, isoOf, REFUND } from './calc.js';
import { uid, num, toast } from './util.js';

export const CAT_COLORS = ['#22B573', '#FF8A4C', '#3D7BFA', '#F6B829', '#8B6CF6', '#F2559A', '#14B8C9', '#F15B5B', '#5B6CFF', '#E5A00D', '#7E8AA3', '#84C341'];
const OLD_COLORS = ['#21A38A', '#F2865E', '#5B8DEF', '#E9B23C', '#9C7FE3', '#E35D7A', '#4CAF7D', '#2AA7C9', '#D46FB5', '#A98467', '#7D8C99', '#F0A04B'];
export const CAT_ICONS = ['shopping-cart', 'fork-knife', 'car', 't-shirt', 'house-line', 'first-aid', 'popcorn', 'wifi', 'gift', 'dots-circle', 'coffee', 'airplane', 'baby', 'barbell', 'paw', 'book', 'lightning', 'graduation', 'gas', 'bus', 'heart', 'pill', 'scissors', 'game', 'arrow-u-up-left', 'tag'];
const DEFAULT_CATS = [
  ['super', 'סופר ומכולת', 'shopping-cart', 30], ['food', 'אוכל בחוץ וקפה', 'fork-knife', 10], ['transport', 'רכב ותחבורה', 'car', 14],
  ['shopping', 'קניות וביגוד', 't-shirt', 9], ['home', 'בית', 'house-line', 8], ['health', 'בריאות ופארם', 'first-aid', 6],
  ['fun', 'בילויים ופנאי', 'popcorn', 8], ['subs', 'מנויים ותקשורת', 'wifi', 4], ['gifts', 'מתנות', 'gift', 3], ['refund', 'כסף שחזר', 'arrow-u-up-left', 0], ['other', 'שונות', 'dots-circle', 8],
];
export function defaultSettings() {
  return {
    name: '', income: 0, startDay: 1, savings: { mode: 'percent', value: 10 }, goals: [], fixed: [], rules: {}, autoLockMin: 5,
    categories: DEFAULT_CATS.map(([id, name, icon, weight], i) => ({ id, name, icon, weight, budget: 0, color: id === 'refund' ? '#14B8C9' : CAT_COLORS[i] })),
  };
}
const str = (v, max = 80) => String(v ?? '').slice(0, max);
export function normalizeSettings(d) {
  const s = defaultSettings();
  if (!d || typeof d !== 'object') return s;
  s.name = str(d.name, 30);
  s.income = num(d.income);
  s.startDay = Math.min(28, Math.max(1, parseInt(d.startDay) || 1));
  s.autoLockMin = [1, 5, 15, 30].includes(+d.autoLockMin) ? +d.autoLockMin : 5;
  s.lastBackup = Number(d.lastBackup) || 0;
  s.byCharge = d.byCharge === true;
  const bk = d.bank && typeof d.bank === 'object' ? d.bank : {};
  s.bank = { key: /^\d{4}-\d{2}$/.test(bk.key || '') ? bk.key : '', best: Number(bk.best) || 0, hit: Array.isArray(bk.hit) ? bk.hit.map(Number).filter(n => n > 0).slice(0, 20) : [],
    pledge: validISO(bk.pledge) ? bk.pledge : null, wins: Math.max(0, Math.floor(Number(bk.wins) || 0)) };
  const w = d.wish && typeof d.wish === 'object' ? d.wish : null;
  s.wish = w && Number(w.price) > 0 ? { name: String(w.name || '').trim().slice(0, 40) || 'המשאלה שלי', price: Math.round(Number(w.price)) } : null;
  if (d.savings) s.savings = { mode: d.savings.mode === 'fixed' ? 'fixed' : 'percent', value: num(d.savings.value) };
  if (Array.isArray(d.goals)) s.goals = d.goals.map(g => ({ id: str(g.id) || uid(), name: str(g.name), target: num(g.target), monthly: num(g.monthly), saved: num(g.saved) }));
  if (Array.isArray(d.fixed)) s.fixed = d.fixed.map(f => ({ id: str(f.id) || uid(), name: str(f.name), amount: num(f.amount), keyword: str(f.keyword, 40) }));
  if (Array.isArray(d.categories) && d.categories.length) s.categories = d.categories.map((c, i) => ({
    id: str(c.id) || uid(), name: str(c.name, 40), icon: CAT_ICONS.includes(c.icon) ? c.icon : 'tag',
    budget: num(c.budget), weight: num(c.weight), color: OLD_COLORS.includes(String(c.color).toUpperCase()) ? CAT_COLORS[OLD_COLORS.indexOf(String(c.color).toUpperCase())] : /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : CAT_COLORS[i % CAT_COLORS.length],
  }));
  if (!s.categories.some(c => c.id === REFUND)) {
    // added in 2.7 for existing users: sits just before "שונות"
    const at = s.categories.findIndex(c => c.id === 'other');
    s.categories.splice(at < 0 ? s.categories.length : at, 0, { id: REFUND, name: 'כסף שחזר', icon: 'arrow-u-up-left', budget: 0, weight: 0, color: '#14B8C9' });
  }
  for (const c of s.categories) if (c.id === REFUND) { c.budget = 0; c.weight = 0; c.color = '#14B8C9'; }
  if (!s.categories.some(c => c.id === 'other')) s.categories.push({ id: 'other', name: 'שונות', icon: 'dots-circle', budget: 0, weight: 0, color: '#7E8AA3' });
  if (d.rules && typeof d.rules === 'object') for (const [k, v] of Object.entries(d.rules)) s.rules[str(k, 80)] = str(v, 40);
  return s;
}
const validISO = d => { if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) return false; const [y, m, dd] = d.split('-').map(Number); const x = new Date(y, m - 1, dd); return x.getFullYear() === y && x.getMonth() === m - 1 && x.getDate() === dd; };
export function normalizeTx(t) {
  if (!t || !validISO(t.date)) return null;
  return {
    id: str(t.id) || uid(), date: t.date, chargeDate: validISO(t.chargeDate) ? t.chargeDate : undefined, dateGuessed: t.dateGuessed === true || undefined, time: /^\d{2}:\d{2}$/.test(t.time || '') ? t.time : null, place: str(t.place, 40), card: /^\d{4}$/.test(t.card || '') ? t.card : null,
    merchant: str(t.merchant) || 'ללא שם', amount: Math.round(num(t.amount) * 100) / 100,
    category: str(t.category, 40) || 'other', kind: ['expense', 'income', 'card-payment'].includes(t.kind) ? t.kind : 'expense',
    fixedId: t.fixedId ? str(t.fixedId) : null, installment: t.installment ? str(t.installment, 12) : null, foreign: !!t.foreign,
    note: str(t.note, 120), source: str(t.source, 12) || 'manual', confirmed: !!t.confirmed, added: Number(t.added) || Date.now(), ignored: !!t.ignored,
  };
}

export const state = {
  settings: defaultSettings(), tx: [],
  ui: { curKey: budgetKeyOf(isoOf(new Date()), 1) },
};

export async function loadState() {
  const d = await vault.load();
  state.settings = normalizeSettings(d && d.settings);
  state.tx = Array.isArray(d && d.tx) ? d.tx.map(normalizeTx).filter(Boolean) : [];
  state.ui.curKey = budgetKeyOf(isoOf(new Date()), state.settings.startDay);
}
export function replaceAll(d) {
  state.settings = normalizeSettings(d && d.settings);
  state.tx = Array.isArray(d && d.tx) ? d.tx.map(normalizeTx).filter(Boolean) : [];
  state.ui.curKey = budgetKeyOf(isoOf(new Date()), state.settings.startDay);
  return persist(true);
}

// Saves run one after another (never overlapping), always with the newest data; flushNow waits for all of them.
let timer = null, pendingSave = false, chain = Promise.resolve();
function runSave() {
  pendingSave = false;
  const snapshot = JSON.parse(JSON.stringify({ v: 1, settings: state.settings, tx: state.tx }));
  chain = chain.then(() => vault.save(snapshot)).catch(() => {
    pendingSave = true; // try again on the next change or flush
    toast('השמירה לא הצליחה. נסה שוב, ואם זה חוזר - גבה את הנתונים.');
  });
  return chain;
}
export function persist(now) {
  pendingSave = true;
  clearTimeout(timer);
  if (now) return runSave();
  timer = setTimeout(runSave, 120);
}
export async function flushNow() {
  clearTimeout(timer);
  if (pendingSave && vault.isUnlocked()) runSave();
  await chain;
}

export const catById = id => state.settings.categories.find(c => c.id === id) || state.settings.categories.find(c => c.id === 'other');
/** Creates a category (or returns the one with the same name) and returns its id. It is placed before "כסף שחזר" and "שונות". */
export function addCategory(name, icon = 'tag') {
  name = String(name || '').trim().slice(0, 40); if (!name) return null;
  const S = state.settings, same = S.categories.find(c => c.name.trim() === name);
  if (same) return same.id;
  const at = S.categories.findIndex(c => c.id === REFUND || c.id === 'other');
  const c = { id: uid(), name, icon: CAT_ICONS.includes(icon) ? icon : 'tag', budget: 0, weight: 0, color: CAT_COLORS[S.categories.length % CAT_COLORS.length] };
  S.categories.splice(at < 0 ? S.categories.length : at, 0, c);
  persist();
  return c.id;
}
export function upsertTx(list) {
  for (const t of list) {
    const n = normalizeTx(t); if (!n) continue;
    const i = state.tx.findIndex(x => x.id === n.id);
    if (i >= 0) state.tx[i] = n; else state.tx.push(n);
  }
  persist();
}
export function removeTx(id) { state.tx = state.tx.filter(t => t.id !== id); persist(); }

// Simple change notifications for re-rendering.
export const bus = new EventTarget();
export const changed = (what = 'data') => bus.dispatchEvent(new CustomEvent('change', { detail: what }));
