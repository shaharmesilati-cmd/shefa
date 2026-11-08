import { state, catById, upsertTx, persist, changed } from '../store.js';
import { monthSummary, shiftKey, budgetKeyOf, isoOf, normMerchant } from '../calc.js';
import { $, $$, esc, ic, money, fmt0, MONTHS, openSheet, toast, shortDate } from '../util.js';
import { txRow, catIcon } from './parts.js';
import { monthInsights, needsCategory, isGenericMerchant } from '../insights.js';

function greeting() {
  const h = new Date().getHours();
  const g = h < 5 ? 'לילה טוב' : h < 12 ? 'בוקר טוב' : h < 17 ? 'צהריים טובים' : h < 21 ? 'ערב טוב' : 'לילה טוב';
  return state.settings.name ? `${g}, ${esc(state.settings.name)}` : g;
}

export function render(el) {
  const S = state.settings, key = state.ui.curKey;
  const C = monthSummary(S, state.tx, key);
  const parts = [];
  const hasTx = state.tx.length > 0;

  parts.push(`<p class="greet">${greeting()}</p>`);

  if (!S.income || !hasTx) {
    parts.push(`<section class="card onboard"><h2>שלושה צעדים ומתחילים</h2>
      <ol class="steps">
        <li class="${S.income ? 'done' : ''}"><span>מזינים הכנסה חודשית</span><a class="btn small" href="#budget">לתקציב</a></li>
        <li class="${S.fixed.length ? 'done' : ''}"><span>מוסיפים הוצאות קבועות וחיסכון</span><a class="btn small" href="#budget">לתקציב</a></li>
        <li class="${hasTx ? 'done' : ''}"><span>מוסיפים הוצאות מישראכרט או מהבנק</span><a class="btn small primary" href="#add">הוספה</a></li>
      </ol></section>`);
  }

  // hero
  const past = C.daysLeft === 0, future = C.elapsed === 0;
  const statusChip = C.status === 'over' ? `<span class="pill bad">${ic('flame')}חריגה מהתקציב</span>`
    : C.status === 'watch' ? `<span class="pill warn">${ic('warning')}הקצב מהיר מהתכנון</span>`
    : past ? `<span class="pill">${ic('check')}החודש נסגר</span>` : `<span class="pill ok">${ic('smiley')}בדרך הנכונה</span>`;
  parts.push(`<section class="hero ${C.status}">
    <div class="hero-top"><span class="hero-lbl">${C.remaining < 0 ? 'חרגת החודש ב-' : past ? 'נשאר בסוף החודש' : 'נשאר לך להוציא החודש'}</span>${statusChip}</div>
    <div class="hero-big">${money(Math.abs(C.remaining), false)}</div>
    ${past || future ? `<div class="hero-sub">${past ? `תקציב ההוצאות היה ${money(C.available)}` : `החודש מתחיל עוד ${C.daysLeft} ימים`}</div>`
      : `<div class="hero-grid">
        <div><span>להיום</span><b>${money(Math.max(0, C.daily), false)}</b></div>
        <div><span>לשבוע</span><b>${money(Math.max(0, C.weekly), false)}</b></div>
        <div><span>ימים שנשארו</span><b class="num">${C.daysLeft}</b></div></div>
      <div class="hero-track" aria-hidden="true"><i style="width:${Math.min(100, C.available > 0 ? C.spent / C.available * 100 : 0).toFixed(1)}%"></i><b style="inset-inline-start:${(C.elapsed / C.total * 100).toFixed(1)}%"></b></div>
      <div class="hero-sub">${C.available > 0 ? `יצא ${money(C.spent)} מתוך ${money(C.available)} · הקו מסמן איפה "צריך" להיות היום` : 'הגדר הכנסה בתקציב כדי לראות כמה נשאר'}</div>`}
  </section>`);

  // forecast (Riseup-style "look forward")
  if (C.isCurrent && C.elapsed > 2 && C.available > 0) {
    const good = C.projectedEnd >= 0;
    parts.push(`<section class="card forecast ${good ? 'ok' : 'bad'}">
      <span class="fc-ic">${ic(good ? 'trend-up' : 'trend-down')}</span>
      <div><b>${good ? `בקצב הנוכחי תסיים את החודש עם עודף של ${money(C.projectedEnd)}` : `בקצב הנוכחי תחרוג בסוף החודש בכ-${money(-C.projectedEnd)}`}</b>
      <p>${good ? 'עודף בסוף החודש אפשר להעביר לחיסכון או ליעד.' : `כדי לסיים מאוזן, נסה לשמור על ${money(Math.max(0, C.daily))} ביום.`}</p></div></section>`);
  }

  // monthly salary slip reminder (current month only, after the 5th)
  const hasSlip = C.inPeriod.some(t => t.kind === 'income' && t.source === 'payslip');
  if (C.isCurrent && !hasSlip && new Date().getDate() >= 5) {
    parts.push(`<section class="card remind"><span class="r-ic">${ic('hand-coins')}</span><div class="grow2"><b>הגיע תלוש המשכורת?</b><p>צלם אותו ושלח לכאן - ההכנסה של החודש תתעדכן לבד.</p></div>
      <a class="btn small primary" href="#add" data-go="payslip">${ic('scan')}העלאה</a></section>`);
  }

  // needs your attention: purchases that stayed in "other"
  const pend = needsCategory(S, state.tx, key);
  if (pend.length) {
    const usage = {};
    for (const t of state.tx) if (t.kind === 'expense' && t.category && t.category !== 'other') usage[t.category] = (usage[t.category] || 0) + 1;
    const quick = S.categories.filter(c => c.id !== 'other').sort((a, b) => (usage[b.id] || 0) - (usage[a.id] || 0)).slice(0, 5);
    parts.push(`<section class="card inbox"><div class="card-h"><h2>${ic('sparkle')} לאן זה שייך? <span class="count">${pend.length}</span></h2></div>
      <p class="hint">בחירה אחת מלמדת את האפליקציה, והפעם הבאה תסווג לבד.</p>
      <div class="inbox-list">${pend.slice(0, 4).map(t => `<div class="ib-row" data-ib="${esc(t.id)}">
        <div class="ib-top"><b>${esc(t.merchant)}</b><b>${money(t.amount, 'auto')}</b></div>
        <div class="ib-meta">${shortDate(t.date)}${t.time ? ' · ' + esc(t.time) : ''}${t.place ? ' · ' + esc(t.place) : ''}</div>
        <div class="chips">${quick.map(c => `<button type="button" class="qchip" data-cat="${esc(c.id)}" style="--c:${c.color}">${ic(c.icon)}${esc(c.name)}</button>`).join('')}
          <button type="button" class="qchip more" data-more="1">${ic('dots')}עוד</button>
          <button type="button" class="qchip keep" data-keep="1">להשאיר בשונות</button></div></div>`).join('')}</div>
      ${pend.length > 4 ? `<p class="muted small">ועוד ${pend.length - 4}...</p>` : ''}</section>`);
  }

  // insights + quick stats
  const I = monthInsights(S, state.tx, key);
  if (I.stats) {
    parts.push(`<section class="tiles">
      <div class="tile t-orange"><span>${ic('receipt')}הקנייה הגדולה</span><b>${money(I.stats.biggest.amount)}</b><small>${esc(I.stats.biggest.merchant)}</small></div>
      <div class="tile t-blue"><span>${ic('coins')}קטגוריה מובילה</span><b>${money(I.stats.topCat.amount)}</b><small>${esc(I.stats.topCat.name)}</small></div>
      <div class="tile t-green"><span>${ic('calendar')}ממוצע ליום</span><b>${money(I.stats.perDay)}</b><small>${I.stats.count} קניות</small></div>
    </section>`);
  }
  if (I.list.length) {
    parts.push(`<section class="card"><div class="card-h"><h2>${ic('sparkle')} שמנו לב</h2></div>
      <div class="insights">${I.list.map(x => `<div class="ins ${x.tone}">${ic(x.icon)}<p>${esc(x.text)}</p></div>`).join('')}</div></section>`);
  }

  // where the income goes
  const base = Math.max(C.income, C.fixedTotal + C.savings + Math.max(0, C.spent), 1);
  const segs = [['קבועות', C.fixedTotal, 'var(--lilac)'], ['חיסכון', C.savings, 'var(--sky)'],
    ['הוצאות', Math.max(0, C.spent), C.remaining < 0 ? 'var(--bad)' : 'var(--peach)'], ['נשאר', Math.max(0, C.remaining), 'var(--primary)']];
  parts.push(`<section class="card"><div class="card-h"><h2>חלוקת ההכנסה</h2><span class="muted">${money(C.income)}${C.actualIncome > C.plannedIncome ? ' בפועל' : ''}</span></div>
    <div class="split" role="img" aria-label="חלוקת ההכנסה">${segs.map(s => s[1] > 0 ? `<i style="width:${(s[1] / base * 100).toFixed(2)}%;background:${s[2]}"></i>` : '').join('')}</div>
    <div class="legend">${segs.map(s => `<span><i class="dot" style="background:${s[2]}"></i>${s[0]} ${money(s[1])}</span>`).join('')}</div>
    ${S.fixed.length ? `<p class="hint">${ic('lock')} ${C.fixedSeen.size} מתוך ${S.fixed.length} ההוצאות הקבועות כבר הופיעו בתנועות החודש.</p>` : ''}</section>`);

  // envelopes
  const cats = S.categories.filter(c => c.budget > 0 || C.byCat[c.id]);
  parts.push(`<section class="card"><div class="card-h"><h2>תקציב לפי קטגוריה</h2><a class="btn small ghost" href="#budget">${ic('pencil')}עריכה</a></div>
    ${cats.length ? `<div class="env">${cats.map(c => {
      const sp = C.byCat[c.id] || 0, left = c.budget - sp, pct = c.budget ? sp / c.budget : (sp > 0 ? 1.01 : 0);
      const cls = pct >= 1 ? 'bad' : pct >= .8 ? 'warn' : '';
      return `<div class="env-row" role="button" tabindex="0" data-catd="${esc(c.id)}">${catIcon(c)}<span class="env-n">${esc(c.name)}</span>
        <span class="env-v">${c.budget ? `<b class="${left < 0 ? 't-bad' : pct >= .8 ? 't-warn' : 't-ok'}">${left < 0 ? 'חריגה ' + money(-left) : 'נשאר ' + money(left)}</b><small>${money(sp)} / ${money(c.budget)}</small>` : `<b class="t-warn">${money(sp)}</b><small>ללא תקציב</small>`}</span>
        <div class="bar ${cls}"><i style="width:${Math.min(100, pct * 100).toFixed(1)}%;--c:${c.color}"></i></div></div>`;
    }).join('')}</div>`
      : `<div class="empty">${ic('piggy', 'big')}<p>עוד לא חילקת תקציב לקטגוריות.</p><a class="btn small primary" href="#budget">חלוקת תקציב</a></div>`}</section>`);

  // donut
  const slices = S.categories.map(c => ({ c, v: Math.max(0, C.byCat[c.id] || 0) })).filter(x => x.v > 0).sort((a, b) => b.v - a.v);
  const tot = slices.reduce((a, x) => a + x.v, 0);
  if (tot > 0) {
    const R = 15.9155; let off = 25;
    const arcs = slices.map(x => { const p = x.v / tot * 100; const s = `<circle r="${R}" cx="21" cy="21" fill="none" stroke="${x.c.color}" stroke-width="5" stroke-dasharray="${Math.max(0, p - .6).toFixed(3)} ${(100 - p + .6).toFixed(3)}" stroke-dashoffset="${off.toFixed(3)}" stroke-linecap="round"></circle>`; off -= p; return s; }).join('');
    parts.push(`<section class="card"><div class="card-h"><h2>לאן הלך הכסף</h2></div><div class="donut-wrap">
      <svg class="donut" viewBox="0 0 42 42" role="img" aria-label="הוצאות לפי קטגוריה">${arcs}
        <text x="21" y="19.6" text-anchor="middle" class="d-k">הוצאות</text><text x="21" y="25" text-anchor="middle" class="d-v">₪${fmt0(tot)}</text></svg>
      <div class="dlist">${slices.slice(0, 7).map(x => `<div><i class="dot" style="background:${x.c.color}"></i><span class="grow">${esc(x.c.name)}</span><span class="muted num">${Math.round(x.v / tot * 100)}%</span>${money(x.v)}</div>`).join('')}</div>
    </div></section>`);
  }

  // last 6 months
  const keys = Array.from({ length: 6 }, (_, i) => shiftKey(key, i - 5));
  const hist = keys.map(k => { const m = monthSummary(S, state.tx, k); return { k, spent: Math.max(0, m.spent), avail: Math.max(0, m.available), has: m.inPeriod.length > 0 }; });
  if (hist.filter(h => h.has).length >= 2) {
    const max = Math.max(...hist.map(h => Math.max(h.spent, h.avail)), 1);
    parts.push(`<section class="card"><div class="card-h"><h2>חצי שנה אחרונה</h2><span class="legend tight"><span><i class="dot" style="background:var(--peach)"></i>הוצאות</span><span><i class="dot ring"></i>תקציב</span></span></div>
      <div class="months">${hist.map(h => `<div class="mcol ${h.k === key ? 'cur' : ''}"><div class="mbar-wrap">
        <i class="mbar-b" style="height:${(h.avail / max * 100).toFixed(1)}%"></i><i class="mbar ${h.spent > h.avail && h.avail ? 'over' : ''}" style="height:${(h.spent / max * 100).toFixed(1)}%"></i></div>
        <span class="mlbl">${MONTHS[+h.k.slice(5) - 1].slice(0, 3)}</span><span class="mval num">${h.spent ? '₪' + fmt0(h.spent) : '–'}</span></div>`).join('')}</div></section>`);
  }

  // goals
  if (S.goals.length) {
    parts.push(`<section class="card"><div class="card-h"><h2>יעדי חיסכון</h2><a class="btn small ghost" href="#budget">${ic('pencil')}עריכה</a></div>
      <div class="goals">${S.goals.map(g => { const p = g.target ? Math.min(100, g.saved / g.target * 100) : 0; return `<div class="goal-mini">
        <div class="goal-top"><b>${esc(g.name || 'יעד')}</b><span class="muted">${money(g.saved)} / ${money(g.target)}</span></div>
        <div class="bar"><i style="width:${p.toFixed(1)}%;--c:var(--sky)"></i></div></div>`; }).join('')}</div></section>`);
  }

  // recent
  const recent = C.inPeriod.slice().sort((a, b) => b.date.localeCompare(a.date) || b.added - a.added).slice(0, 6);
  parts.push(`<section class="card"><div class="card-h"><h2>תנועות אחרונות</h2><a class="btn small ghost" href="#expenses">הכל</a></div>
    ${recent.length ? `<div class="tx-list">${recent.map(txRow).join('')}</div>`
      : `<div class="empty">${ic('receipt', 'big')}<p>אין עדיין תנועות בחודש הזה.</p><a class="btn small primary" href="#add">${ic('plus')}הוספת הוצאות</a></div>`}</section>`);

  el.innerHTML = parts.join('');
  wire(el, key);
}

function classify(id, catId) {
  const t = state.tx.find(x => x.id === id); if (!t) return;
  const generic = isGenericMerchant(t.merchant);
  const n = normMerchant(t.merchant);
  const list = generic ? [t] : state.tx.filter(x => x.kind === 'expense' && (x.id === t.id || (normMerchant(x.merchant) === n && (x.category || 'other') === 'other' && !x.confirmed)));
  if (!generic && catId !== 'other') { state.settings.rules[n] = catId; persist(); }
  upsertTx(list.map(x => ({ ...x, category: catId, confirmed: true })));
  changed();
  toast(catId === 'other' ? 'נשאר בשונות' : `סווג ל"${catById(catId).name}"${list.length > 1 ? ` (${list.length} קניות)` : ''}${generic ? '' : ' · נלמד לפעם הבאה'}`);
}

function wire(el) {
  $$('.ib-row', el).forEach(row => {
    const id = row.dataset.ib;
    row.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => classify(id, b.dataset.cat));
    row.querySelector('[data-keep]').onclick = () => classify(id, 'other');
    row.querySelector('[data-more]').onclick = () => {
      const S = state.settings;
      openSheet('בחירת קטגוריה', `<div class="chips big">${S.categories.map(c => `<button type="button" class="qchip" data-c="${esc(c.id)}" style="--c:${c.color}">${ic(c.icon)}${esc(c.name)}</button>`).join('')}</div>`, (sh, close) => {
        sh.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { close(); classify(id, b.dataset.c); });
      });
    };
  });
  $$('[data-catd]', el).forEach(r => {
    const open = () => openCategory(r.dataset.catd);
    r.onclick = open; r.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
  });
  const go = $('[data-go="payslip"]', el);
  if (go) go.onclick = () => { state.ui.addMode = 'payslip'; };
}

function openCategory(id) {
  const c = catById(id), C = monthSummary(state.settings, state.tx, state.ui.curKey);
  const list = C.variable.filter(t => (t.category || 'other') === c.id).sort((a, b) => b.date.localeCompare(a.date));
  const sp = list.reduce((a, t) => a + t.amount, 0);
  openSheet(c.name, `<div class="cat-head">${catIcon(c)}<div><b>${money(sp)}</b><span class="muted"> ${c.budget ? `מתוך ${money(c.budget)}` : 'ללא תקציב'} · ${list.length} קניות</span></div></div>
    ${c.budget ? `<div class="bar ${sp > c.budget ? 'bad' : sp > c.budget * .8 ? 'warn' : ''}"><i style="width:${Math.min(100, sp / c.budget * 100).toFixed(1)}%;--c:${c.color}"></i></div>` : ''}
    <div class="tx-list">${list.map(txRow).join('') || '<p class="muted">אין קניות בקטגוריה הזו החודש.</p>'}</div>`, (sh, close) => {
    sh.addEventListener('click', e => { if (e.target.closest('[data-tx]')) close(); }, true);
  });
}
