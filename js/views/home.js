// Home: one calm screen. The big number is what you can safely spend today.
// Below it: ONE next step, the savings goal with your streak, top categories, last purchases.
// Everything else (charts, comparisons) lives behind "ניתוח החודש".
import { state, catById, upsertTx, persist, changed } from '../store.js';
import { monthSummary, shiftKey, normMerchant } from '../calc.js';
import { $, $$, esc, ic, money, fmt0, MONTHS, openSheet, toast, shortDate } from '../util.js';
import { txRow, catIcon } from './parts.js';
import { monthInsights, needsCategory, isGenericMerchant, budgetStreak } from '../insights.js';

function greeting() {
  const h = new Date().getHours();
  const g = h < 5 ? 'לילה טוב' : h < 12 ? 'בוקר טוב' : h < 17 ? 'צהריים טובים' : h < 21 ? 'ערב טוב' : 'לילה טוב';
  return state.settings.name ? `${g}, ${esc(state.settings.name)}` : g;
}
const R = 52, CIRC = 2 * Math.PI * R;

export function render(el) {
  const S = state.settings, key = state.ui.curKey;
  const C = monthSummary(S, state.tx, key);
  const parts = [];
  const past = C.daysLeft === 0, future = C.elapsed === 0;

  parts.push(`<p class="greet">${greeting()}</p>`);

  // first run: just the three steps
  if (!S.income && !state.tx.length) {
    parts.push(`<section class="card welcome"><span class="w-ic">${ic('wallet')}</span><h2>ברוך הבא ל-Stashwise</h2>
      <p>שני צעדים ואתה רואה כמה מותר להוציא היום, בלי לחשוב.</p>
      <a class="btn primary wide" href="#budget">${ic('hand-coins')}1. כמה נכנס לי בחודש</a>
      <a class="btn wide" href="#add">${ic('scan')}2. צילום מסך מהאשראי</a></section>`);
    el.innerHTML = parts.join(''); return;
  }

  // hero ring: share of this month's spending money that is still left
  const left = C.available > 0 ? Math.max(0, C.remaining) / C.available : 0;
  const big = past || future ? Math.abs(C.remaining) : Math.max(0, C.daily);
  const label = C.remaining < 0 ? 'חרגת החודש ב-' : past ? 'נשאר בסוף החודש' : future ? 'יהיה לך להוציא החודש' : 'אפשר להוציא היום';
  const sub = C.remaining < 0 ? 'מהיום כל שקל שנחסך מצמצם את החריגה'
    : past || future ? `${C.total} ימים · תקציב ${money(C.available)}`
    : `נשאר לחודש ${money(C.remaining)} · ${C.daysLeft} ימים`;
  const fc = C.isCurrent && C.elapsed > 2 && C.available > 0
    ? (C.projectedEnd >= 0 ? `<span class="fc ok">${ic('trend-up')}בקצב הזה תסיים עם עודף של ${money(C.projectedEnd)}</span>`
      : `<span class="fc bad">${ic('trend-down')}בקצב הזה תחרוג בכ-${money(-C.projectedEnd)}</span>`) : '';
  parts.push(`<section class="hero2 ${C.status}">
    <div class="ring-wrap">
      <svg class="ring" viewBox="0 0 120 120" aria-hidden="true"><circle class="ring-bg" cx="60" cy="60" r="${R}"></circle>
        <circle class="ring-fg" cx="60" cy="60" r="${R}" stroke-dasharray="${CIRC.toFixed(1)}" stroke-dashoffset="${(CIRC * (1 - left)).toFixed(1)}"></circle></svg>
      <div class="ring-in"><span class="h-lbl">${label}</span><b class="h-big" data-count="${Math.round(big)}">${money(big)}</b></div>
    </div>
    <p class="h-sub">${sub}</p>${fc}
  </section>`);

  // one next step
  parts.push(nextStep(S, C, key));

  // savings goal + streak
  const streak = budgetStreak(S, state.tx);
  const g = S.goals.find(x => x.target > x.saved) || S.goals[0];
  if (g || streak) {
    const p = g && g.target ? Math.min(100, g.saved / g.target * 100) : 0;
    parts.push(`<section class="card save-card">
      ${streak ? `<div class="streak"><span class="flame">${ic('flame')}</span><div><b>${streak} ${streak === 1 ? 'יום' : 'ימים'} ברצף</b><small>${streakText(streak)}</small></div></div>` : ''}
      ${g ? `<div class="goal-hero"><div class="gh-top"><span class="gh-ic">${ic('piggy')}</span><div class="grow2"><b>${esc(g.name || 'יעד החיסכון')}</b><small>${money(g.saved)} מתוך ${money(g.target)}</small></div><b class="gh-pct num">${Math.round(p)}%</b></div>
        <div class="gold-bar"><i style="width:${p.toFixed(1)}%"></i></div>
        ${g.monthly ? `<button class="btn small gold" id="dep" type="button">${ic('plus')}הפקדתי ₪${fmt0(g.monthly)}</button>` : ''}</div>`
      : `<a class="btn small ghost" href="#budget">${ic('target')}להגדיר יעד חיסכון</a>`}
    </section>`);
  }

  // top categories (compact)
  const cats = S.categories.filter(c => c.budget > 0 || C.byCat[c.id])
    .map(c => ({ c, sp: C.byCat[c.id] || 0 })).sort((a, b) => (b.c.budget ? b.sp / b.c.budget : 2) - (a.c.budget ? a.sp / a.c.budget : 2) || b.sp - a.sp);
  if (cats.length) {
    parts.push(`<section class="card"><div class="card-h"><h2>הקטגוריות שלך</h2><button class="link" id="all-cats" type="button">הכל (${cats.length})</button></div>
      <div class="cats">${cats.slice(0, 4).map(catLine).join('')}</div></section>`);
  }

  // last purchases
  const recent = C.inPeriod.slice().sort((a, b) => b.date.localeCompare(a.date) || b.added - a.added).slice(0, 3);
  if (recent.length) parts.push(`<section class="card"><div class="card-h"><h2>אחרונות</h2><a class="link" href="#expenses">כל התנועות</a></div><div class="tx-list">${recent.map(txRow).join('')}</div></section>`);

  parts.push(`<button class="analysis-btn" id="analysis" type="button">${ic('sparkle')}<span><b>ניתוח החודש</b><small>לאן הלך הכסף, השוואה לחודש שעבר ותובנות</small></span>${ic('caret-left')}</button>`);

  el.innerHTML = parts.join('');
  wire(el, cats);
  countUp(el);
}

function streakText(n) {
  if (n >= 30) return 'חודש שלם בתוך התקציב. מדהים!';
  if (n >= 14) return 'שבועיים ברצף. זה כבר הרגל.';
  if (n >= 7) return 'שבוע שלם בתוך התקציב היומי.';
  if (n >= 3) return 'ממשיך יפה. עוד יום ושומרים על הרצף.';
  return 'ימים שבהם נשארת בתוך התקציב היומי.';
}

function catLine({ c, sp }) {
  const pct = c.budget ? sp / c.budget : (sp > 0 ? 1.01 : 0), left = c.budget - sp;
  const cls = pct >= 1 ? 'bad' : pct >= .8 ? 'warn' : '';
  return `<div class="cat-line" role="button" tabindex="0" data-catd="${esc(c.id)}">${catIcon(c)}
    <div class="cl-mid"><div class="cl-top"><span class="cl-n">${esc(c.name)}</span>
      <span class="cl-v ${left < 0 ? 't-bad' : pct >= .8 ? 't-warn' : ''}">${c.budget ? (left < 0 ? 'חריגה ' + money(-left) : 'נשאר ' + money(left)) : money(sp)}</span></div>
      <div class="bar ${cls}"><i style="width:${Math.min(100, pct * 100).toFixed(1)}%;--c:${c.color}"></i></div></div></div>`;
}

/** Exactly one card: the most useful thing to do right now. */
function nextStep(S, C, key) {
  const pend = needsCategory(S, state.tx, key);
  if (pend.length) {
    const t = pend[0];
    const usage = {};
    for (const x of state.tx) if (x.kind === 'expense' && x.category && x.category !== 'other') usage[x.category] = (usage[x.category] || 0) + 1;
    const quick = S.categories.filter(c => c.id !== 'other').sort((a, b) => (usage[b.id] || 0) - (usage[a.id] || 0)).slice(0, 5);
    return `<section class="card next ask" data-ib="${esc(t.id)}">
      <div class="nx-h"><span class="nx-ic">${ic('sparkle')}</span><b>לאן זה שייך?</b><span class="nx-count">${pend.length > 1 ? `1 מתוך ${pend.length}` : ''}</span></div>
      <div class="ib-top"><b>${esc(t.merchant)}</b><b>${money(t.amount, 'auto')}</b></div>
      <div class="ib-meta">${shortDate(t.date)}${t.time ? ' · ' + esc(t.time) : ''}${t.place ? ' · ' + esc(t.place) : ''}</div>
      <div class="chips">${quick.map(c => `<button type="button" class="qchip" data-cat="${esc(c.id)}" style="--c:${c.color}">${ic(c.icon)}${esc(c.name)}</button>`).join('')}
        <button type="button" class="qchip more" data-more="1">${ic('dots')}עוד</button><button type="button" class="qchip keep" data-keep="1">דלג</button></div></section>`;
  }
  const hasSlip = C.inPeriod.some(t => t.kind === 'income' && t.source === 'payslip');
  if (C.isCurrent && !hasSlip && new Date().getDate() >= 5)
    return `<section class="card next slip"><div class="nx-h"><span class="nx-ic">${ic('hand-coins')}</span><b>הגיע תלוש המשכורת?</b></div>
      <p>צילום אחד, וההכנסה של החודש מתעדכנת לבד.</p><a class="btn small gold" href="#add" data-go="payslip">${ic('scan')}העלאת תלוש</a></section>`;
  const days = S.lastBackup ? (Date.now() - S.lastBackup) / 86400000 : Infinity;
  if (state.tx.length >= 5 && days >= 7)
    return `<section class="card next backup"><div class="nx-h"><span class="nx-ic">${ic('shield')}</span><b>${S.lastBackup ? `עברו ${Math.floor(days)} ימים מהגיבוי האחרון` : 'עוד לא גיבית'}</b></div>
      <p>הנתונים נשמרים רק בטלפון. גיבוי לדרייב או ל-iCloud שומר עליהם גם אם הטלפון יוחלף או שהדפדפן ימחק אותם.</p><a class="btn small primary" href="#more">${ic('download')}לגבות עכשיו</a></section>`;
  const over = S.categories.map(c => ({ c, sp: C.byCat[c.id] || 0 })).filter(x => x.c.budget > 0 && x.sp > x.c.budget).sort((a, b) => (b.sp - b.c.budget) - (a.sp - a.c.budget))[0];
  if (over) return `<section class="card next warnc"><div class="nx-h"><span class="nx-ic">${ic('warning')}</span><b>"${esc(over.c.name)}" עבר את התקציב</b></div>
      <p>חריגה של ${money(over.sp - over.c.budget)}. אפשר להעביר תקציב מקטגוריה אחרת, או לעצור כאן עד סוף החודש.</p><a class="btn small" href="#budget">${ic('sliders')}לעדכן תקציב</a></section>`;
  const I = monthInsights(S, state.tx, key);
  const good = I.list.find(x => x.tone === 'good' || x.tone === 'tip');
  if (good) return `<section class="card next goodc"><div class="nx-h"><span class="nx-ic">${ic(good.icon)}</span><b>${good.tone === 'tip' ? 'רעיון לחיסכון' : 'יפה מאוד'}</b></div><p>${esc(good.text)}</p></section>`;
  return `<section class="card next goodc"><div class="nx-h"><span class="nx-ic">${ic('check')}</span><b>הכל מסודר</b></div><p>אין כרגע מה לעשות. נתראה בקנייה הבאה.</p></section>`;
}

function classify(id, catId) {
  const t = state.tx.find(x => x.id === id); if (!t) return;
  const generic = isGenericMerchant(t.merchant);
  const n = normMerchant(t.merchant);
  const list = generic ? [t] : state.tx.filter(x => x.kind === 'expense' && (x.id === t.id || (normMerchant(x.merchant) === n && (x.category || 'other') === 'other' && !x.confirmed)));
  if (!generic && catId !== 'other') { state.settings.rules[n] = catId; persist(); }
  upsertTx(list.map(x => ({ ...x, category: catId, confirmed: true })));
  changed();
  toast(catId === 'other' ? 'דילגת' : `סווג ל"${catById(catId).name}"${list.length > 1 ? ` (${list.length} קניות)` : ''}${generic ? '' : ' · נלמד לפעם הבאה'}`);
}

function wire(el, cats) {
  const ask = $('.next.ask', el);
  if (ask) {
    const id = ask.dataset.ib;
    ask.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => classify(id, b.dataset.cat));
    ask.querySelector('[data-keep]').onclick = () => classify(id, 'other');
    ask.querySelector('[data-more]').onclick = () => {
      openSheet('בחירת קטגוריה', `<div class="chips big">${state.settings.categories.map(c => `<button type="button" class="qchip" data-c="${esc(c.id)}" style="--c:${c.color}">${ic(c.icon)}${esc(c.name)}</button>`).join('')}</div>`, (sh, close) => {
        sh.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { close(); classify(id, b.dataset.c); });
      });
    };
  }
  const bindCats = root => $$('[data-catd]', root).forEach(r => {
    const open = () => openCategory(r.dataset.catd);
    r.onclick = open; r.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
  });
  bindCats(el);
  const all = $('#all-cats', el);
  if (all) all.onclick = () => openSheet('כל הקטגוריות', `<div class="cats">${cats.map(catLine).join('')}</div>`, sh => bindCats(sh));
  const go = $('[data-go="payslip"]', el);
  if (go) go.onclick = () => { state.ui.addMode = 'payslip'; };
  const dep = $('#dep', el);
  if (dep) dep.onclick = () => {
    const g = state.settings.goals.find(x => x.target > x.saved) || state.settings.goals[0];
    g.saved = Math.round((g.saved + g.monthly) * 100) / 100; persist();
    try { navigator.vibrate && navigator.vibrate(30); } catch { }
    celebrate(dep); toast(g.saved >= g.target ? `הגעת ליעד "${g.name}"! 🎉` : `כל הכבוד! עוד ₪${fmt0(g.monthly)} בדרך ל"${g.name || 'יעד'}"`);
    setTimeout(changed, 650);
  };
  $('#analysis', el).onclick = openAnalysis;
}

/* small reward animation (respects reduced motion) */
function celebrate(anchor) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const r = anchor.getBoundingClientRect(), colors = ['#F6B829', '#22B573', '#3D7BFA', '#FF8A4C', '#F2559A'];
  for (let i = 0; i < 18; i++) {
    const s = document.createElement('i'); s.className = 'spark';
    s.style.cssText = `left:${r.left + r.width / 2}px;top:${r.top}px;background:${colors[i % 5]};--dx:${(Math.random() - .5) * 220}px;--dy:${-60 - Math.random() * 140}px`;
    document.body.appendChild(s); setTimeout(() => s.remove(), 900);
  }
}
/* the big number counts up once per screen visit */
let lastCounted = null;
function countUp(el) {
  const b = $('.h-big', el); if (!b || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const target = +b.dataset.count; const sig = state.ui.curKey + ':' + target;
  if (lastCounted === sig || target <= 0) return; lastCounted = sig;
  const t0 = performance.now(), dur = 700;
  const step = now => { const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3); b.innerHTML = money(Math.round(target * e)); if (p < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
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

/** Charts and comparisons, on demand only. */
function openAnalysis() {
  const S = state.settings, key = state.ui.curKey, C = monthSummary(S, state.tx, key), I = monthInsights(S, state.tx, key);
  const parts = [];
  const base = Math.max(C.income, C.fixedTotal + C.savings + Math.max(0, C.spent), 1);
  const segs = [['קבועות', C.fixedTotal, 'var(--lilac)'], ['חיסכון', C.savings, 'var(--yellow)'], ['הוצאות', Math.max(0, C.spent), C.remaining < 0 ? 'var(--bad)' : 'var(--orange)'], ['נשאר', Math.max(0, C.remaining), 'var(--green)']];
  parts.push(`<h3>חלוקת ההכנסה · ${money(C.income)}</h3><div class="split">${segs.map(s => s[1] > 0 ? `<i style="width:${(s[1] / base * 100).toFixed(2)}%;background:${s[2]}"></i>` : '').join('')}</div>
    <div class="legend">${segs.map(s => `<span><i class="dot" style="background:${s[2]}"></i>${s[0]} ${money(s[1])}</span>`).join('')}</div>`);
  if (I.stats) parts.push(`<div class="tiles"><div class="tile t-orange"><span>${ic('receipt')}הקנייה הגדולה</span><b>${money(I.stats.biggest.amount)}</b><small>${esc(I.stats.biggest.merchant)}</small></div>
    <div class="tile t-blue"><span>${ic('coins')}מובילה</span><b>${money(I.stats.topCat.amount)}</b><small>${esc(I.stats.topCat.name)}</small></div>
    <div class="tile t-green"><span>${ic('calendar')}ליום</span><b>${money(I.stats.perDay)}</b><small>${I.stats.count} קניות</small></div></div>`);
  if (I.list.length) parts.push(`<h3>שמנו לב</h3><div class="insights">${I.list.map(x => `<div class="ins ${x.tone}">${ic(x.icon)}<p>${esc(x.text)}</p></div>`).join('')}</div>`);
  const slices = S.categories.map(c => ({ c, v: Math.max(0, C.byCat[c.id] || 0) })).filter(x => x.v > 0).sort((a, b) => b.v - a.v);
  const tot = slices.reduce((a, x) => a + x.v, 0);
  if (tot > 0) {
    const Rr = 15.9155; let off = 25;
    const arcs = slices.map(x => { const p = x.v / tot * 100; const s = `<circle r="${Rr}" cx="21" cy="21" fill="none" stroke="${x.c.color}" stroke-width="5" stroke-dasharray="${Math.max(0, p - .6).toFixed(3)} ${(100 - p + .6).toFixed(3)}" stroke-dashoffset="${off.toFixed(3)}" stroke-linecap="round"></circle>`; off -= p; return s; }).join('');
    parts.push(`<h3>לאן הלך הכסף</h3><div class="donut-wrap"><svg class="donut" viewBox="0 0 42 42" role="img" aria-label="הוצאות לפי קטגוריה">${arcs}<text x="21" y="19.6" text-anchor="middle" class="d-k">הוצאות</text><text x="21" y="25" text-anchor="middle" class="d-v">₪${fmt0(tot)}</text></svg>
      <div class="dlist">${slices.slice(0, 7).map(x => `<div><i class="dot" style="background:${x.c.color}"></i><span class="grow">${esc(x.c.name)}</span><span class="muted num">${Math.round(x.v / tot * 100)}%</span>${money(x.v)}</div>`).join('')}</div></div>`);
  }
  const keys = Array.from({ length: 6 }, (_, i) => shiftKey(key, i - 5));
  const hist = keys.map(k => { const m = monthSummary(S, state.tx, k); return { k, spent: Math.max(0, m.spent), avail: Math.max(0, m.available), has: m.inPeriod.length > 0 }; });
  if (hist.filter(h => h.has).length >= 2) {
    const max = Math.max(...hist.map(h => Math.max(h.spent, h.avail)), 1);
    parts.push(`<h3>חצי שנה אחרונה</h3><div class="months">${hist.map(h => `<div class="mcol ${h.k === key ? 'cur' : ''}"><div class="mbar-wrap"><i class="mbar-b" style="height:${(h.avail / max * 100).toFixed(1)}%"></i><i class="mbar ${h.spent > h.avail && h.avail ? 'over' : ''}" style="height:${(h.spent / max * 100).toFixed(1)}%"></i></div>
      <span class="mlbl">${MONTHS[+h.k.slice(5) - 1].slice(0, 3)}</span><span class="mval num">${h.spent ? '₪' + fmt0(h.spent) : '–'}</span></div>`).join('')}</div>`);
  }
  openSheet('ניתוח החודש', `<div class="analysis">${parts.join('') || '<p class="muted">עוד אין מספיק נתונים לחודש הזה.</p>'}</div>`);
}
