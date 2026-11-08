import { state, catById, upsertTx, removeTx, persist, changed } from '../store.js';
import { $, esc, ic, money, num, uid, shortDate, openSheet, toast, armConfirm } from '../util.js';
import { isoOf, normMerchant } from '../calc.js';
import { cleanField } from '../sanitize.js';

export const catIcon = c => `<span class="cat-ic" style="--c:${c.color}">${ic(c.icon)}</span>`;

export function txRow(t) {
  const c = catById(t.category);
  const f = t.fixedId && state.settings.fixed.find(x => x.id === t.fixedId);
  const kind = t.kind === 'income' ? `<span class="chip good">${ic('arrow-down')}הכנסה</span>`
    : t.kind === 'card-payment' ? `<span class="chip">${ic('card')}תשלום כרטיס - לא נספר</span>` : '';
  const isIncome = t.kind === 'income';
  return `<button class="tx" data-tx="${esc(t.id)}" type="button">
    ${isIncome ? `<span class="cat-ic" style="--c:#21A38A">${ic('hand-coins')}</span>` : catIcon(c)}
    <span class="tx-mid"><span class="tx-m">${esc(t.merchant)}</span>
      <span class="tx-s"><span>${shortDate(t.date)}${t.time ? ' · ' + esc(t.time) : ''}</span>${t.place ? `<span>${esc(t.place)}</span>` : ''}${t.card ? `<span class="chip">${ic('card')}${esc(t.card)}</span>` : ''}${isIncome || t.kind === 'card-payment' ? '' : `<span>${esc(c.name)}</span>`}
      ${kind}${f ? `<span class="chip lilac">${ic('lock')}קבועה</span>` : ''}
      ${t.installment ? `<span class="chip">תשלום ${esc(t.installment)}</span>` : ''}
      ${t.foreign ? `<span class="chip peach">מט"ח</span>` : ''}</span></span>
    <span class="tx-a ${isIncome || t.amount < 0 ? 'pos' : ''} ${t.kind === 'card-payment' ? 'dim' : ''}">${isIncome ? '+' : ''}${money(t.amount, 'auto')}</span>
  </button>`;
}

export const catOptions = sel => state.settings.categories.map(c => `<option value="${esc(c.id)}" ${c.id === sel ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
export const fixedOptions = sel => `<option value="">לא, הוצאה רגילה</option>` + state.settings.fixed.map(f => `<option value="${esc(f.id)}" ${f.id === sel ? 'selected' : ''}>כן: ${esc(f.name || 'ללא שם')}</option>`).join('');
export const kindOptions = sel => [['expense', 'הוצאה'], ['income', 'הכנסה'], ['card-payment', 'תשלום חשבון אשראי (לא נספר)']]
  .map(([v, l]) => `<option value="${v}" ${v === sel ? 'selected' : ''}>${l}</option>`).join('');

export function openTxSheet(t) {
  const isNew = !t;
  t = t ? { ...t } : { id: uid(), date: isoOf(new Date()), merchant: '', amount: '', category: 'other', kind: 'expense', source: 'manual', added: Date.now() };
  openSheet(isNew ? 'הוספת תנועה' : 'עריכת תנועה', `
    <div class="field"><label for="sh-m">שם (בית עסק או תיאור)</label><input id="sh-m" type="text" value="${esc(t.merchant)}" placeholder="למשל: שופרסל דיל" maxlength="80"></div>
    <div class="row2"><div class="field"><label for="sh-a">סכום ב-₪</label><input id="sh-a" type="number" inputmode="decimal" step="0.01" value="${esc(t.amount)}"></div>
      <div class="field"><label for="sh-d">תאריך</label><input id="sh-d" type="date" value="${esc(t.date)}"></div></div>
    <div class="row2"><div class="field"><label for="sh-t">שעה (לא חובה)</label><input id="sh-t" type="time" value="${esc(t.time || '')}"></div>
      <div class="field"><label for="sh-p">מקום (לא חובה)</label><input id="sh-p" type="text" maxlength="40" value="${esc(t.place || '')}"></div></div>
    <div class="field"><label for="sh-c4">איזה כרטיס - 4 ספרות אחרונות (לא חובה)</label><input id="sh-c4" type="text" inputmode="numeric" maxlength="4" value="${esc(t.card || '')}" placeholder="למשל 1234"></div>
    <div class="field"><label for="sh-k">סוג</label><select id="sh-k">${kindOptions(t.kind)}</select></div>
    <div class="field" id="sh-cw"><label for="sh-c">קטגוריה</label><select id="sh-c">${catOptions(catById(t.category).id)}</select></div>
    ${state.settings.fixed.length ? `<div class="field" id="sh-fw"><label for="sh-f">זו הוצאה קבועה שכבר בתקציב?</label><select id="sh-f">${fixedOptions(t.fixedId)}</select></div>` : ''}
    <p class="hint">${ic('sparkle')} קטגוריה שתבחר לבית עסק נשמרת, ותשויך אוטומטית בפעם הבאה.</p>
    <div class="row2">${isNew ? '' : `<button class="btn danger" id="sh-del" type="button">${ic('trash')}מחיקה</button>`}
      <button class="btn primary" id="sh-ok" type="button">${ic('check')}שמירה</button></div>`, (sh, close) => {
    const sync = () => { const k = $('#sh-k', sh).value; $('#sh-cw', sh).hidden = k !== 'expense'; const fw = $('#sh-fw', sh); if (fw) fw.hidden = k !== 'expense'; };
    $('#sh-k', sh).onchange = sync; sync();
    if (!isNew) armConfirm($('#sh-del', sh), () => { removeTx(t.id); close(); changed(); toast('נמחק'); }, 'לחץ שוב למחיקה');
    $('#sh-ok', sh).onclick = () => {
      const merchant = $('#sh-m', sh).value.trim(), amount = num($('#sh-a', sh).value), date = $('#sh-d', sh).value;
      if (!merchant || !amount || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast('צריך למלא שם, סכום ותאריך'); return; }
      const kind = $('#sh-k', sh).value, cat = $('#sh-c', sh).value;
      if (kind === 'expense' && (isNew || cat !== t.category)) { state.settings.rules[normMerchant(merchant)] = cat; persist(); }
      const time = $('#sh-t', sh).value, place = cleanField($('#sh-p', sh).value, 40);
      const c4 = $('#sh-c4', sh).value.replace(/\D/g, '');
      if (c4 && c4.length !== 4) { toast('בכרטיס רושמים בדיוק 4 ספרות'); return; }
      upsertTx([{ ...t, card: c4 || null, merchant: cleanField(merchant), amount, date, time: time || null, place, kind, category: cat, fixedId: kind === 'expense' && $('#sh-f', sh) ? ($('#sh-f', sh).value || null) : null }]);
      close(); changed(); toast(isNew ? 'נוסף' : 'נשמר');
    };
  });
}

// One delegated click handler for every transaction row in the app.
document.addEventListener('click', e => {
  const b = e.target.closest('[data-tx]');
  if (b) openTxSheet(state.tx.find(t => t.id === b.dataset.tx));
});
