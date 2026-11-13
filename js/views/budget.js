import { state, persist, changed, CAT_COLORS, CAT_ICONS, addCategory } from '../store.js';
import { monthSummary, autoSplit, budgetKeyOf, isoOf } from '../calc.js';
import { $, $$, esc, ic, money, num, uid, toast, armConfirm, fmt0 } from '../util.js';
import { catIcon } from './parts.js';

const ICON_NAMES = { 'shopping-cart': 'עגלת קניות', 'fork-knife': 'אוכל', car: 'רכב', 't-shirt': 'בגדים', 'house-line': 'בית', 'first-aid': 'בריאות', popcorn: 'בילויים', wifi: 'תקשורת', gift: 'מתנה', 'dots-circle': 'שונות', coffee: 'קפה', airplane: 'טיסה', baby: 'תינוק', barbell: 'כושר', paw: 'חיות מחמד', book: 'ספר', lightning: 'חשמל', graduation: 'לימודים', gas: 'דלק', bus: 'תחבורה ציבורית', heart: 'לב', pill: 'תרופות', scissors: 'מספרה', game: 'משחקים', 'arrow-u-up-left': 'כסף שחזר', tag: 'תגית' };
const save = () => { persist(); summaries(); };
// The budget is the same for every month; numbers here are for the current month.
const nowKey = () => budgetKeyOf(isoOf(new Date()), state.settings.startDay);

function summaryHTML() {
  const C = monthSummary(state.settings, state.tx, nowKey());
  const un = C.unallocated;
  return `<div class="sumgrid">
      <div class="stat"><span>${C.actualIncome > C.plannedIncome ? 'הכנסה בפועל החודש' : 'הכנסה'}</span><b>${money(C.income)}</b></div>
      <div class="stat"><span>קבועות</span><b>${money(C.fixedTotal)}</b></div>
      <div class="stat"><span>חיסכון</span><b>${money(C.savings)}</b></div>
      <div class="stat hl"><span>פנוי להוצאות</span><b>${money(C.available)}</b></div></div>
    <div class="unalloc ${C.available <= 0 || un < 0 ? 'bad' : un > 0 ? '' : 'ok'}">${!C.income ? `${ic('info')} הזן הכנסה חודשית כדי לראות כמה פנוי להוצאות.`
      : C.available <= 0 ? `ההוצאות הקבועות והחיסכון גבוהים מההכנסה. אין סכום פנוי להוצאות.`
      : un > 0 ? `חולקו לקטגוריות ${money(C.allocated)} · <b>עוד לא חולק ${money(un)}</b>`
      : un === 0 ? `${ic('check')} כל הסכום הפנוי חולק לקטגוריות` : `חילקת ${money(-un)} יותר ממה שפנוי. הורד תקציב באחת הקטגוריות.`}</div>`;
}
function savingsLine() {
  const C = monthSummary(state.settings, state.tx, nowKey());
  const g = state.settings.goals.reduce((a, x) => a + x.monthly, 0);
  return `חיסכון חודשי: <b>${money(C.savings)}</b>${state.settings.goals.length ? ` · מתוכם ליעדים ${money(g)}${g > C.savings ? ' <span class="t-bad">(יותר מהחיסכון)</span>' : ''}` : ''}`;
}
function summaries() {
  const a = $('#bd-sum'); if (a) a.innerHTML = summaryHTML();
  const b = $('#sv-line'); if (b) b.innerHTML = savingsLine();
}

export function update(el, detail) {
  if (el.contains(document.activeElement) && detail !== 'month') return summaries();
  render(el);
}

export function render(el) {
  const S = state.settings;
  const SPENT = monthSummary(S, state.tx, nowKey());
  el.innerHTML = `
  <section class="card"><div class="card-h"><h2>${ic('hand-coins')} הכנסה</h2></div>
    <div class="row2">
      <div class="field"><label for="bd-inc">הכנסה חודשית נטו (₪)</label><input id="bd-inc" type="number" inputmode="decimal" value="${S.income || ''}" placeholder="למשל 12000"></div>
      <div class="field"><label for="bd-sd">חודש התקציב מתחיל ב-</label><select id="bd-sd">${Array.from({ length: 28 }, (_, i) => `<option value="${i + 1}" ${S.startDay === i + 1 ? 'selected' : ''}>${i + 1} לחודש</option>`).join('')}</select></div>
      <div class="field" style="grid-column:1/-1"><label for="bd-bc">קנייה באשראי נספרת</label><select id="bd-bc">
        <option value="0" ${S.byCharge ? '' : 'selected'}>בחודש שבו קניתי</option>
        <option value="1" ${S.byCharge ? 'selected' : ''}>בחודש שבו האשראי יורד (תזרים)</option></select></div>
    </div>
    <p class="hint">${ic('info')} אם נרשמה החודש הכנסה גבוהה יותר (למשל מקובץ הבנק), החישוב משתמש בה.</p>
    <div id="bd-sum">${summaryHTML()}</div></section>

  <section class="card"><div class="card-h"><h2>${ic('lock')} הוצאות קבועות</h2></div>
    <p class="hint">שכר דירה, משכנתא, ביטוחים, מנויים. "מילה לזיהוי" מסמנת את ההוצאה כשהיא מופיעה בפירוט, כדי שלא תיספר פעמיים.</p>
    <div class="elist">${S.fixed.map(f => `<div class="erow fx">
      <div class="field"><label for="fx-n-${f.id}">שם</label><input id="fx-n-${f.id}" type="text" data-fx="${f.id}" data-k="name" value="${esc(f.name)}" placeholder="שכר דירה"></div>
      <div class="field"><label for="fx-a-${f.id}">סכום</label><input id="fx-a-${f.id}" type="number" inputmode="decimal" data-fx="${f.id}" data-k="amount" value="${f.amount || ''}"></div>
      <div class="field kw"><label for="fx-k-${f.id}">מילה לזיהוי</label><input id="fx-k-${f.id}" type="text" data-fx="${f.id}" data-k="keyword" value="${esc(f.keyword)}" placeholder="לא חובה, למשל: נטפליקס"></div>
      <button class="icon-btn del" data-del-fx="${f.id}" aria-label="מחיקת ${esc(f.name || 'הוצאה')}" type="button">${ic('trash')}</button></div>`).join('') || `<p class="muted">עוד אין הוצאות קבועות.</p>`}</div>
    <button class="btn small" id="fx-add" type="button">${ic('plus')}הוצאה קבועה</button></section>

  <section class="card"><div class="card-h"><h2>${ic('piggy')} חיסכון</h2>
      <div class="seg" role="group" aria-label="סוג החיסכון"><button type="button" data-svm="percent" class="${S.savings.mode === 'percent' ? 'on' : ''}">אחוז</button><button type="button" data-svm="fixed" class="${S.savings.mode === 'fixed' ? 'on' : ''}">סכום</button></div></div>
    <div class="field"><label for="sv-v">${S.savings.mode === 'percent' ? 'אחוז מההכנסה לחיסכון' : 'סכום לחיסכון בכל חודש (₪)'}</label><input id="sv-v" type="number" inputmode="decimal" value="${S.savings.value || ''}"></div>
    <p id="sv-line" class="sv-line">${savingsLine()}</p>
    <div class="elist">${S.goals.map(g => { const p = g.target ? Math.min(100, g.saved / g.target * 100) : 0; const months = g.monthly && g.target > g.saved ? Math.ceil((g.target - g.saved) / g.monthly) : 0; return `<div class="goal">
      <div class="erow"><div class="field"><label for="g-n-${g.id}">יעד</label><input id="g-n-${g.id}" type="text" data-g="${g.id}" data-k="name" value="${esc(g.name)}" placeholder="קרן חירום"></div>
        <div class="field"><label for="g-t-${g.id}">סכום היעד</label><input id="g-t-${g.id}" type="number" inputmode="decimal" data-g="${g.id}" data-k="target" value="${g.target || ''}"></div>
        <button class="icon-btn del" data-del-g="${g.id}" aria-label="מחיקת היעד" type="button">${ic('trash')}</button></div>
      <div class="row2"><div class="field"><label for="g-m-${g.id}">הפרשה בחודש</label><input id="g-m-${g.id}" type="number" inputmode="decimal" data-g="${g.id}" data-k="monthly" value="${g.monthly || ''}"></div>
        <div class="field"><label for="g-s-${g.id}">נצבר עד היום</label><input id="g-s-${g.id}" type="number" inputmode="decimal" data-g="${g.id}" data-k="saved" value="${g.saved || ''}"></div></div>
      <div class="gold-bar"><i style="width:${p.toFixed(1)}%"></i></div>
      <div class="goal-foot"><span class="muted">${Math.round(p)}% מהיעד${months ? ` · עוד כ-${months} חודשים` : ''}</span>
        <button class="btn small" data-dep="${g.id}" type="button" ${g.monthly ? '' : 'disabled'}>${ic('piggy')}הפקדתי ₪${fmt0(g.monthly)}</button></div></div>`; }).join('')}</div>
    <button class="btn small" id="g-add" type="button">${ic('target')}יעד חיסכון</button></section>

  <section class="card"><div class="card-h"><h2>${ic('sliders')} תקציב לקטגוריות</h2><button class="btn small primary" id="auto" type="button">${ic('sparkle')}חלוקה אוטומטית</button></div>
    <p class="hint">החלוקה האוטומטית מחלקת את הפנוי לפי יחס מקובל (סופר 30%, רכב 14%, אוכל בחוץ 10%...). אחר כך משנים כל סכום כרצונך.</p>
    ${(() => {
      const row = c => { const sp = SPENT.byCat[c.id] || 0; return `<div class="crow">${catIcon(c)}
      <div class="crow-n"><input type="text" id="c-n-${c.id}" data-c="${c.id}" data-k="name" value="${esc(c.name)}" aria-label="שם הקטגוריה">
        <small class="${c.budget && sp > c.budget ? 't-bad' : ''}">${sp ? `יצא החודש ${money(sp)}` : 'עוד לא יצא החודש'}</small></div>
      <input type="number" inputmode="decimal" id="c-b-${c.id}" data-c="${c.id}" data-k="budget" value="${c.budget || ''}" placeholder="0" aria-label="תקציב ל${esc(c.name)}">
      ${c.id === 'other' ? '<span></span>' : `<button class="icon-btn del" data-del-c="${c.id}" aria-label="מחיקת ${esc(c.name)}" type="button">${ic('trash')}</button>`}</div>`; };
      const all = S.categories.filter(c => c.id !== 'refund'), used = all.filter(c => c.budget > 0 || SPENT.byCat[c.id] > 0), rest = all.filter(c => !used.includes(c));
      // a new user sees everything; after that, only categories with a budget or with spending this month
      if (!used.length || rest.length < 3) return `<div class="elist">${all.map(row).join('')}</div>`;
      return `<div class="elist">${used.map(row).join('')}</div>
        <details class="morecats"><summary>${ic('caret-down')}עוד ${rest.length} קטגוריות בלי תקציב</summary><div class="elist">${rest.map(row).join('')}</div></details>`;
    })()}
    <details class="newcat"><summary>${ic('plus')} קטגוריה חדשה</summary>
      <div class="field"><label for="nc-n">שם</label><input id="nc-n" type="text" placeholder="למשל: חיות מחמד" maxlength="40"></div>
      <div class="icon-pick" role="radiogroup" aria-label="סמל">${CAT_ICONS.map((n, i) => `<button type="button" role="radio" aria-checked="${i === CAT_ICONS.length - 1}" data-ico="${n}" class="${i === CAT_ICONS.length - 1 ? 'on' : ''}" aria-label="${ICON_NAMES[n] || 'סמל'}">${ic(n)}</button>`).join('')}</div>
      <button class="btn small primary" id="nc-add" type="button">${ic('plus')}הוספה</button></details></section>

  <details class="card explain"><summary><h2>${ic('question')} איך מחושב "אפשר להוציא היום"?</h2></summary>
    <p>הכנסה, פחות הוצאות קבועות, פחות חיסכון = <b>הפנוי להוצאות</b>. ממנו מורידים כל הוצאה משתנה שנרשמה בחודש. הוצאה שמזוהה כקבועה לא נספרת פעמיים, ותשלום חשבון האשראי מהבנק לא נספר בכלל (העסקאות עצמן כבר נספרו). קנייה שסיווגת ל"כסף שחזר" (החזרת מוצר, זיכוי) נשארת ברשימה אבל לא נספרת כהוצאה. אם בחרת "בחודש שבו האשראי יורד", קנייה באשראי נספרת בחודש של החיוב (בדרך כלל החודש הבא, או לפי "תאריך חיוב" מקובץ האקסל).</p>
    <p>כל יום מקבלים אותו סכום יומי, ומה שלא הוצאת עובר למחר. אם הוצאת מהר מהקצב, מה שנשאר לחודש מתחלק מחדש על הימים שנותרו. כסף שנעלת בכספת יוצא מהיומי.</p></details>`;
  wire(el);
}

function wire(el) {
  const S = state.settings;
  $('#bd-inc', el).oninput = e => { S.income = num(e.target.value); save(); };
  $('#bd-bc', el).onchange = e => { S.byCharge = e.target.value === '1'; persist(); changed('month'); toast(S.byCharge ? 'מעכשיו קנייה באשראי נספרת בחודש שבו הכסף יורד מהחשבון.' : 'מעכשיו קנייה נספרת בחודש שבו קנית.'); };
  $('#bd-sd', el).onchange = e => { S.startDay = +e.target.value; state.ui.curKey = budgetKeyOf(isoOf(new Date()), S.startDay); persist(); changed('month'); };
  $('#sv-v', el).oninput = e => { S.savings.value = num(e.target.value); save(); };
  $$('[data-svm]', el).forEach(b => b.onclick = () => {
    const to = b.dataset.svm; if (to === S.savings.mode) return;
    const inc = monthSummary(S, state.tx, nowKey()).income, v = S.savings.value || 0;
    S.savings.value = to === 'fixed' ? Math.round(inc * v / 100) : (inc ? Math.round(v / inc * 1000) / 10 : 0);
    S.savings.mode = to; persist(); render(el);
  });
  $$('[data-fx]', el).forEach(i => i.oninput = () => { const f = S.fixed.find(x => x.id === i.dataset.fx); f[i.dataset.k] = i.dataset.k === 'amount' ? num(i.value) : i.value; save(); });
  $$('[data-g]', el).forEach(i => i.oninput = () => { const g = S.goals.find(x => x.id === i.dataset.g); g[i.dataset.k] = i.dataset.k === 'name' ? i.value : num(i.value); save(); });
  $$('[data-c]', el).forEach(i => i.oninput = () => { const c = S.categories.find(x => x.id === i.dataset.c); c[i.dataset.k] = i.dataset.k === 'budget' ? num(i.value) : i.value; save(); });
  $$('[data-del-fx]', el).forEach(b => armConfirm(b, () => { S.fixed = S.fixed.filter(x => x.id !== b.dataset.delFx); persist(); render(el); }));
  $$('[data-del-g]', el).forEach(b => armConfirm(b, () => { S.goals = S.goals.filter(x => x.id !== b.dataset.delG); persist(); render(el); }));
  $$('[data-del-c]', el).forEach(b => armConfirm(b, () => { const gone = b.dataset.delC; S.categories = S.categories.filter(x => x.id !== gone); state.tx.forEach(t => { if (t.category === gone) t.category = 'other'; }); for (const k in S.rules) if (S.rules[k] === gone) delete S.rules[k]; persist(); render(el); toast('נמחקה. ההוצאות שלה עברו ל"שונות".'); }));
  $$('[data-dep]', el).forEach(b => b.onclick = () => { const g = S.goals.find(x => x.id === b.dataset.dep); g.saved = Math.round((g.saved + g.monthly) * 100) / 100; persist(); render(el); toast(`כל הכבוד! ${fmt0(g.monthly)} ₪ נוספו ל"${g.name || 'יעד'}"`); });
  $('#fx-add', el).onclick = () => { const f = { id: uid(), name: '', amount: 0, keyword: '' }; S.fixed.push(f); persist(); render(el); $('#fx-n-' + f.id).focus(); };
  $('#g-add', el).onclick = () => { const g = { id: uid(), name: '', target: 0, monthly: 0, saved: 0 }; S.goals.push(g); persist(); render(el); $('#g-n-' + g.id).focus(); };
  $('#auto', el).onclick = () => {
    const C = monthSummary(S, state.tx, nowKey());
    if (C.available <= 0) { toast('אין סכום פנוי לחלוקה. בדוק הכנסה, קבועות וחיסכון.'); return; }
    S.categories = autoSplit(S.categories, C.available); persist(); render(el); toast('התקציב חולק. אפשר לשנות כל סכום.');
  };
  let icon = CAT_ICONS[CAT_ICONS.length - 1];
  $$('[data-ico]', el).forEach(b => b.onclick = () => { icon = b.dataset.ico; $$('[data-ico]', el).forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); }); });
  $('#nc-add', el).onclick = () => {
    const name = $('#nc-n', el).value.trim(); if (!name) { toast('תן שם לקטגוריה'); return; }
    addCategory(name, icon); render(el); toast('הקטגוריה נוספה');
  };
}
