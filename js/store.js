// App state in memory while unlocked; persisted encrypted through vault.js.
import * as vault from './vault.js';
import { budgetKeyOf, isoOf } from './calc.js';
import { uid, num, toast } from './util.js';

export const CAT_COLORS = ['#21A38A', '#F2865E', '#5B8DEF', '#E9B23C', '#9C7FE3', '#E35D7A', '#4CAF7D', '#2AA7C9', '#D46FB5', '#A98467', '#7D8C99', '#F0A04B'];
export const CAT_ICONS = ['shopping-cart', 'fork-knife', 'car', 't-shirt', 'house-line', 'first-aid', 'popcorn', 'wifi', 'gift', 'dots-circle', 'coffee', 'airplane', 'baby', 'barbell', 'paw', 'book', 'lightning', 'graduation', 'gas', 'bus', 'heart', 'pill', 'scissors', 'game', 'tag'];
const DEFAULT_CATS = [
  ['super', 'סופר ומכולת', 'shopping-cart', 30], ['food', 'אוכל בחוץ וקפה', 'fork-knife', 10], ['transport', 'רכב ותחבורה', 'car', 14],
  ['shopping', 'קניות וביגוד', 't-shirt', 9], ['home', 'בית', 'house-line', 8], ['health', 'בריאות ופארם', 'first-aid', 6],
  ['fun', 'בילויים ופנאי', 'popcorn', 8], ['subs', 'מנויים ותקשורת', 'wifi', 4], ['gifts', 'מתנות', 'gift', 3], ['other', 'שונות', 'dots-circle', 8],
];
export function defaultSettings() {
  return {
    name: '', income: 0, startDay: 1, savings: { mode: 'percent', value: 10 }, goals: [], fixed: [], rules: {}, autoLockMin: 5,
    categories: DEFAULT_CATS.map(([id, name, icon, weight], i) => ({ id, name, icon, weight, budget: 0, color: CAT_COLORS[i] })),
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
  if (d.savings) s.savings = { mode: d.savings.mode === 'fixed' ? 'fixed' : 'percent', value: num(d.savings.value) };
  if (Array.isArray(d.goals)) s.goals = d.goals.map(g => ({ id: str(g.id) || uid(), name: str(g.name), target: num(g.target), monthly: num(g.monthly), saved: num(g.saved) }));
  if (Array.isArray(d.fixed)) s.fixed = d.fixed.map(f => ({ id: str(f.id) || uid(), name: str(f.name), amount: num(f.amount), keyword: str(f.keyword, 40) }));
  if (Array.isArray(d.categories) && d.categories.length) s.categories = d.categories.map((c, i) => ({
    id: str(c.id) || uid(), name: str(c.name, 40), icon: CAT_ICONS.includes(c.icon) ? c.icon : 'tag',
    budget: num(c.budget), weight: num(c.weight), color: /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : CAT_COLORS[i % CAT_COLORS.length],
  }));
  if (!s.categories.some(c => c.id === 'other')) s.categories.push({ id: 'other', name: 'שונות', icon: 'dots-circle', budget: 0, weight: 0, color: '#7D8C99' });
  if (d.rules && typeof d.rules === 'object') for (const [k, v] of Object.entries(d.rules)) s.rules[str(k, 80)] = str(v, 40);
  return s;
}
export function normalizeTx(t) {
  if (!t || !/^\d{4}-\d{2}-\d{2}$/.test(t.date)) return null;
  return {
    id: str(t.id) || uid(), date: t.date, time: /^\d{2}:\d{2}$/.test(t.time || '') ? t.time : null, place: str(t.place, 40), card: /^\d{4}$/.test(t.card || '') ? t.card : null,
    merchant: str(t.merchant) || 'ללא שם', amount: Math.round(num(t.amount) * 100) / 100,
    category: str(t.category, 40) || 'other', kind: ['expense', 'income', 'card-payment'].includes(t.kind) ? t.kind : 'expense',
    fixedId: t.fixedId ? str(t.fixedId) : null, installment: t.installment ? str(t.installment, 12) : null, foreign: !!t.foreign,
    note: str(t.note, 120), source: str(t.source, 12) || 'manual', added: Number(t.added) || Date.now(), ignored: !!t.ignored,
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
  persist(true);
}

let timer = null, pendingSave = false;
export function persist(now) {
  pendingSave = true;
  clearTimeout(timer);
  const go = () => {
    pendingSave = false;
    vault.save({ v: 1, settings: state.settings, tx: state.tx }).catch(() => toast('השמירה לא הצליחה. נסה שוב, ואם זה חוזר - גבה את הנתונים.'));
  };
  now ? go() : (timer = setTimeout(go, 350));
}
export async function flushNow() {
  clearTimeout(timer);
  if (!pendingSave || !vault.isUnlocked()) return;
  pendingSave = false;
  await vault.save({ v: 1, settings: state.settings, tx: state.tx });
}

export const catById = id => state.settings.categories.find(c => c.id === id) || state.settings.categories.find(c => c.id === 'other');
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
