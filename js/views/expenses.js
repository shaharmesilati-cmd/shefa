import { state, catById } from '../store.js';
import { monthSummary, normMerchant } from '../calc.js';
import { $, esc, ic, money } from '../util.js';
import { txRow, openTxSheet } from './parts.js';

const f = { q: '', cat: '' };

export function render(el) {
  el.innerHTML = `<section class="card">
      <div class="card-h"><h2>תנועות החודש</h2><span id="ex-total" class="muted"></span></div>
      <div class="row2">
        <div class="field"><label for="ex-q">חיפוש</label><div class="search">${ic('search')}<input id="ex-q" type="search" placeholder="שם בית עסק" value="${esc(f.q)}"></div></div>
        <div class="field"><label for="ex-cat">הצג</label><select id="ex-cat"></select></div>
      </div></section>
    <section class="card" id="ex-list"></section>
    <button class="fab" id="ex-add" type="button">${ic('plus')}הוספה ידנית</button>`;
  $('#ex-q', el).addEventListener('input', e => { f.q = e.target.value; list(el); });
  $('#ex-cat', el).addEventListener('change', e => { f.cat = e.target.value; list(el); });
  $('#ex-add', el).onclick = () => openTxSheet(null);
  update(el);
}
export function update(el) {
  const sel = $('#ex-cat', el);
  if (!sel) return render(el);
  sel.innerHTML = `<option value="">כל התנועות</option><option value="__var">הוצאות משתנות</option><option value="__fixed">הוצאות קבועות</option><option value="__income">הכנסות</option><option value="__card">תשלומי כרטיס (לא נספרים)</option>`
    + `<optgroup label="קטגוריה">${state.settings.categories.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</optgroup>`;
  sel.value = [...sel.options].some(o => o.value === f.cat) ? f.cat : '';
  list(el);
}
function list(el) {
  const C = monthSummary(state.settings, state.tx, state.ui.curKey);
  let tx = C.inPeriod.slice().sort((a, b) => b.date.localeCompare(a.date) || b.added - a.added);
  const q = normMerchant(f.q);
  if (q) tx = tx.filter(t => normMerchant(t.merchant).includes(q));
  const exp = t => t.kind === 'expense' && !t.ignored;
  if (f.cat === '__var') tx = tx.filter(t => exp(t) && !t.fixedId);
  else if (f.cat === '__fixed') tx = tx.filter(t => exp(t) && t.fixedId);
  else if (f.cat === '__income') tx = tx.filter(t => t.kind === 'income');
  else if (f.cat === '__card') tx = tx.filter(t => t.kind === 'card-payment');
  else if (f.cat) tx = tx.filter(t => exp(t) && catById(t.category).id === f.cat);
  const spend = tx.filter(exp).reduce((a, t) => a + t.amount, 0);
  $('#ex-total', el).innerHTML = `${tx.length} תנועות${spend ? ' · הוצאות ' + money(spend) : ''}`;
  const L = $('#ex-list', el);
  if (!tx.length) {
    L.innerHTML = `<div class="empty">${ic(q || f.cat ? 'search' : 'receipt', 'big')}<p>${q || f.cat ? 'לא נמצאו תנועות שמתאימות.' : 'אין תנועות בחודש הזה.'}</p>${q || f.cat ? '' : `<a class="btn small primary" href="#add">${ic('plus')}הוספת הוצאות</a>`}</div>`;
    return;
  }
  let html = '', last = '';
  for (const t of tx) {
    if (t.date !== last) { html += `<div class="day-h">${new Date(t.date + 'T00:00').toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'numeric' })}</div>`; last = t.date; }
    html += txRow(t);
  }
  L.innerHTML = `<div class="tx-list">${html}</div>`;
}
