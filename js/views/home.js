// Home: one calm screen. The big number is what you can safely spend today.
// Below it: ONE next step, the savings goal with your streak, top categories, last purchases.
// Everything else (charts, comparisons) lives behind "ניתוח החודש".
import { state, catById, upsertTx, persist, changed, addCategory } from '../store.js';
import { monthSummary, shiftKey, normMerchant, dailyBank, isoOf } from '../calc.js';
import { $, $$, esc, ic, money, fmt0, MONTHS, openSheet, toast, shortDate } from '../util.js';
import { txRow, catIcon } from './parts.js';
import { monthInsights, needsCategory, isGenericMerchant } from '../insights.js';
import { sameBusiness } from '../categorize.js';

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


  // first run: just the three steps
  if (!S.income && !state.tx.length && !S.fixed.length && !S.goals.length && !S.categories.some(c => c.budget > 0)) {
    parts.push(`<section class="card welcome"><span class="w-ic">${ic('wallet')}</span><h2>ברוך הבא ל-Stashwise</h2>
      <p>שני צעדים ואתה רואה כמה מותר להוציא היום, בלי לחשוב.</p>
      <a class="btn primary wide" href="#budget">${ic('hand-coins')}1. כמה נכנס לי בחודש</a>
      <a class="btn wide" href="#add">${ic('plus')}2. הוספת ההוצאות של החודש</a></section>`);
    el.innerHTML = parts.join(''); return;
  }

  if (!C.isCurrent && !C.inPeriod.length) {
    parts.push(`<section class="card empty-month">${ic('calendar', 'big')}<h2>אין נתונים ל${past ? 'חודש הזה' : 'חודש שעוד לא התחיל'}</h2>
      <p>${past ? 'אפשר להוסיף הוצאות של החודש הזה מקובץ, מצילום או ידנית.' : 'כשהחודש יתחיל, תראה כאן כמה מותר להוציא בכל יום.'}</p>
      ${past ? `<a class="btn small primary" href="#add">${ic('plus')}הוספת הוצאות</a>` : ''}</section>`);
    el.innerHTML = parts.join(''); return;
  }

  // hero ring: share of this month's spending money that is still left
  const left = C.available > 0 ? Math.max(0, C.remaining) / C.available : 0;
  const B = dailyBank(S, state.tx, key);
  let hb;
  if (B) {
    const over = B.balance < 0;
    hb = { label: over ? 'עברת את היומי ב-' : 'אפשר להוציא היום', big: Math.abs(B.balance), cls: over ? 'watch' : C.status === 'over' ? 'watch' : C.status, from: null, fresh: false, sub: '',
      chip: B.tomorrow != null ? `<div class="fc-row"><span class="fc ok">${ic('sun')}${over ? 'מחר מתחילים מחדש:' : 'מחר:'} ${money(B.tomorrow)}</span><span class="fc soft">לחודש: ${money(C.remaining)}</span></div>`
        : `<span class="fc ok">${ic('piggy')}היום האחרון של החודש</span>` };
    // first look today: the number climbs from where yesterday ended
    const todayIso = isoOf(new Date()); let seen = null;
    try { seen = localStorage.getItem('stashwise-bank-day'); } catch { }
    if (seen !== todayIso && B.day > 1 && !B.spentToday && !over) {
      hb.from = Math.max(0, B.days[B.days.length - 2].left); hb.fresh = true;
      try { localStorage.setItem('stashwise-bank-day', todayIso); } catch { }
    }
  } else {
    hb = { label: C.remaining < 0 ? 'חרגת החודש ב-' : past ? 'נשאר בסוף החודש' : future ? 'יהיה לך להוציא החודש' : 'נשאר לחודש', big: Math.abs(C.remaining), cls: C.status, from: null, fresh: false,
      sub: C.remaining < 0 ? 'כל שקל שלא יוצא מקטין את החריגה' : `${C.total} ימים · תקציב ${money(C.available)}`, chip: '' };
  }
  parts.push(`<section class="hero2 ${hb.cls}">
    <${B ? 'button type="button" id="why" aria-label="איך המספר מחושב"' : 'div'} class="ring-wrap">
      <svg class="ring" viewBox="0 0 120 120" aria-hidden="true"><defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--rc1)"/><stop offset="1" stop-color="var(--rc2)"/></linearGradient></defs>
        <circle class="ring-bg" cx="60" cy="60" r="${R}"></circle>
        <circle class="ring-fg" cx="60" cy="60" r="${R}" stroke="url(#rg)" stroke-dasharray="${CIRC.toFixed(1)}" stroke-dashoffset="${(CIRC * (1 - left)).toFixed(1)}" data-off="${(CIRC * (1 - left)).toFixed(1)}"></circle></svg>
      <span class="ring-in"><span class="h-lbl">${hb.label}</span><b class="h-big" data-count="${Math.round(hb.big)}"${hb.from != null ? ` data-from="${Math.round(hb.from)}"` : ''}>${money(hb.big)}</b>
        ${hb.fresh ? `<span class="h-plus">+${money(B.todayBase)} הבוקר</span>` : B ? `<span class="h-why">${ic('question')}</span>` : ''}</span>
    </${B ? 'button' : 'div'}>
    ${hb.sub ? `<p class="h-sub">${hb.sub}</p>` : ''}${hb.chip}
  </section>`);
  if (B) parts.push(vaultCard(B, S));

  // one next step
  parts.push(nextStep(S, C, key));

  // savings goal
  const g = S.goals.find(x => x.target > x.saved) || S.goals[0];
  if (g) {
    const p = g.target ? Math.min(100, g.saved / g.target * 100) : 0;
    parts.push(`<section class="card save-card">
      <div class="goal-hero"><div class="gh-top"><span class="gh-ic">${ic('piggy')}</span><div class="grow2"><b>${esc(g.name || 'יעד החיסכון')}</b><small>${money(g.saved)} מתוך ${money(g.target)}</small></div><b class="gh-pct num">${Math.round(p)}%</b></div>
        <div class="gold-bar"><i style="width:${p.toFixed(1)}%"></i></div>
        ${g.monthly ? `<button class="btn small gold" id="dep" type="button">${ic('plus')}הפקדתי ₪${fmt0(g.monthly)}</button>` : ''}</div>
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

  parts.push(`<button class="analysis-btn" id="analysis" type="button">${ic('sparkle')}<span><b>ניתוח החודש</b></span>${ic('caret-left')}</button>`);

  el.innerHTML = parts.join('');
  wire(el, cats);
  wireBank(el, B, C);
  enter(el);
  countUp(el);
}

const WD = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
const wdOf = iso => WD[new Date(iso + 'T12:00').getDay()];
const JAR_MAX = 25;
const daysWord = n => (n === 1 ? 'יום אחד' : `${n} ימים`);
const vaultTotal = S => (S.locks || []).reduce((a, l) => a + l.amount, 0);
let justLocked = 0; // how many coins should drop into the jar on the next paint

/** Coins in the jar. The jar is the vault: it only holds money that was locked away, so it only grows. */
function jarCoins(total, coin, fresh) {
  const n = Math.max(0, total) / coin, full = Math.min(JAR_MAX, Math.floor(n + 1e-9)), frac = n - Math.floor(n + 1e-9);
  const out = [];
  for (let i = 0; i < full; i++) out.push(`<i class="coin${i >= full - fresh ? ' drop' : ''}" style="--i:${i};--d:${Math.max(0, i - (full - fresh))}"></i>`);
  if (frac > 0.08 && full < JAR_MAX) out.push(`<i class="coin part${fresh && !full ? ' drop' : ''}" style="--i:${full};--d:${fresh};--p:${Math.round(frac * 100)}%"></i>`);
  return out.join('');
}
/** How much can be locked now: everything above one full day, and in the evening also what is left of today. */
const lockableNow = B => Math.max(0, Math.floor(new Date().getHours() >= 20 ? B.balance : B.balance - B.base));

/** The home card: a jar that fills with what you locked away, and one button. */
function vaultCard(B, S) {
  const vault = vaultTotal(S), w = S.wish, coin = Math.max(1, Math.round(B.base)), can = lockableNow(B);
  const wp = w ? Math.max(0, Math.min(100, vault / w.price * 100)) : 0, fresh = justLocked; justLocked = 0;
  return `<section class="card bank">
    <div class="jar-row">
      <button type="button" class="jar${vault ? '' : ' empty'}" id="bk-vault" aria-label="הכספת: ${fmt0(vault)} שקלים"><span class="jar-lid"></span><span class="jar-shine"></span><span class="jar-in" id="bk-coins">${jarCoins(vault, coin, fresh)}</span>${vault / coin > JAR_MAX ? `<span class="jar-x num">×${Math.floor(vault / coin)}</span>` : ''}</button>
      <div class="jar-side"><small class="muted">${w ? esc(w.name) : 'נעלתי בצד'}</small><b class="jr-sum num" id="bk-vsum" data-v="${vault}">${money(vault)}</b>
        ${w ? `<span class="gold-bar"><i style="width:${wp.toFixed(1)}%"></i></span><small class="muted num">${Math.floor(wp)}% מתוך ${money(w.price)}</small>` : ''}
        ${can >= 20 ? `<button class="pill-btn gold" id="bk-lock" type="button" data-amt="${can}">${ic('lock-key')}לנעול ${money(can)}</button>`
          : !vault ? `<small class="muted">מה שלא תוציא, תוכל לנעול כאן</small>` : ''}</div>
    </div>
  </section>`;
}
const buzz = ms => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch { } };
function wireBank(el, B, C) {
  const why = $('#why', el); if (why && B) why.onclick = () => openWhy(B, C);
  const card = $('.bank', el); if (!card || !B) return;
  const S = state.settings, jar = $('#bk-vault', card);
  jar.onclick = () => openVault();
  if (card.querySelector('.coin.drop')) setTimeout(() => { const j = $('#bk-vault'); if (j) { j.classList.add('land'); confetti(j, 36); } }, 520);
  const lb = $('#bk-lock', card);
  if (lb) lb.onclick = () => {
    const amount = +lb.dataset.amt, id = 'l' + Date.now().toString(36), n = Math.min(6, Math.max(1, Math.round(amount / B.base)));
    lb.disabled = true; lb.classList.add('done'); buzz([15, 30, 15]);
    flyCoins($('.ring-wrap', el), jar, n, () => {
      S.locks.push({ id, date: isoOf(new Date()), amount }); justLocked = n; persist(); changed('settings');
      toast(`₪${fmt0(amount)} ננעלו בכספת`, { label: 'ביטול', fn: () => { S.locks = S.locks.filter(l => l.id !== id); persist(); changed('settings'); } });
    });
  };
}

/** "How is the number calculated?" - the sum as a picture, the last days, and a what-if slider. */
function openWhy(B, C) {
  const row = (label, val, cls = '') => `<div class="eq ${cls}"><span>${label}</span><b class="num">${val}</b></div>`;
  const body = B.mode === 'saved'
    ? row('כל יום מקבלים', money(B.base)) + (B.extra > 0.5 ? row('נשאר מימים קודמים', '+' + money(B.extra), 'plus') : '')
    : row('נשאר לחודש', money(B.remaining + B.spentToday + B.lockedToday)) + row('ימים שנשארו', '÷ ' + B.daysLeft, 'div');
  const days = B.days.slice(-7), top = Math.max(...days.map(d => Math.max(d.allow, d.spent)), 1);
  const max = Math.max(50, Math.ceil(Math.max(B.balance, B.base) * 1.5 / 10) * 10);
  openSheet('איך המספר מחושב', `<div class="eqs">${body}
      ${B.spentToday ? row('הוצאת היום', '-' + money(B.spentToday, 'auto'), 'minus') : ''}${B.lockedToday ? row('נעלת בכספת', '-' + money(B.lockedToday), 'minus') : ''}
      ${row(B.balance >= 0 ? 'אפשר להוציא היום' : 'מעבר ליומי', money(Math.abs(B.balance)), 'total')}</div>
    ${B.mode === 'spread' ? `<p class="why-note">${ic('info')}הוצאת מהר מהקצב, אז מה שנשאר מתחלק על ${daysWord(B.daysLeft)}. יום בלי הוצאות מעלה את היומי.</p>` : ''}
    <div class="why-month"><span class="soft-bar big"><i style="width:${Math.max(2, Math.min(100, C.spent / C.available * 100)).toFixed(1)}%"></i><em style="inset-inline-start:${(C.elapsed / C.total * 100).toFixed(1)}%"></em></span>
      <small>החודש: יצאו ${money(C.spent)} מתוך ${money(C.available)} · הקו = היום</small></div>
    <div class="bk-days" role="list">${days.map((d, i) => {
      const today = i === days.length - 1, cls = !d.spent ? 'zero' : d.left >= 0 ? 'under' : 'over';
      return `<button type="button" class="bk-day ${cls}${today ? ' is-today' : ''}" role="listitem" data-day="${d.iso}" aria-label="יום ${wdOf(d.iso)} ${shortDate(d.iso)}">
        <span class="bk-col"><i style="--h:${Math.max(6, Math.min(100, d.spent / top * 100)).toFixed(0)}%;--i:${i}"></i><em style="bottom:${Math.min(100, d.allow / top * 100).toFixed(0)}%"></em></span>
        <small>${today ? 'היום' : wdOf(d.iso) + "'"}</small></button>`; }).join('')}</div>
    <p class="bk-info" id="bk-info" aria-live="polite">עמודה = כמה יצא · קו = כמה היה אפשר</p>
    ${B.tomorrow != null ? `<div class="bk-sim"><label for="bk-range">ואם אוציא היום ${B.spentToday ? 'עוד ' : ''}<b id="bk-x" class="num">₪0</b>?</label>
      <input type="range" id="bk-range" min="0" max="${max}" step="5" value="0" style="--f:0%">
      <p id="bk-out" class="bk-out"></p></div>` : ''}`, sh => {
    const info = $('#bk-info', sh);
    sh.querySelectorAll('[data-day]').forEach(b => b.onclick = () => {
      const d = B.days.find(x => x.iso === b.dataset.day); if (!d) return;
      sh.querySelectorAll('.bk-day').forEach(x => x.classList.toggle('sel', x === b));
      info.innerHTML = `<b>${b.classList.contains('is-today') ? 'היום' : `יום ${wdOf(d.iso)}' ${shortDate(d.iso)}`}</b> · יצאו ${money(d.spent, 'auto')} מתוך ${money(d.allow)}${d.locked ? ` · ננעלו ${money(d.locked)}` : ''}`;
    });
    const r = $('#bk-range', sh); if (!r) return;
    const out = $('#bk-out', sh), x = $('#bk-x', sh);
    const show = () => {
      const v = +r.value, today = B.balance - v, tom = Math.max(0, B.pace - v + B.base, (B.remaining - v) / (B.daysLeft - 1));
      r.style.setProperty('--f', (v / +r.max * 100).toFixed(1) + '%');
      x.textContent = '₪' + fmt0(v);
      out.className = 'bk-out ' + (v === 0 ? 'good' : today < 0 ? 'warn' : '');
      out.innerHTML = `<span><small>היום נשאר</small><b class="num">${today >= 0 ? money(today) : '-' + money(-today)}</b></span><span><small>מחר</small><b class="num">${money(tom)}</b></span>`;
    };
    r.oninput = show; show();
  });
}

/** The vault: money locked away, and the one thing it is for. */
function openVault() {
  const S = state.settings, w = S.wish, total = vaultTotal(S), last = (S.locks || []).slice(-5).reverse();
  openSheet('הכספת', `<div class="vault-big"><span class="vault-ic big">${ic('lock-key')}</span><b class="num">₪${fmt0(total)}</b></div>
    <p class="hint">כסף שנעלת יוצא מהיומי ונשמר בצד. כדי שהוא באמת ייחסך, העבר אותו בבנק לחיסכון.</p>
    ${last.length ? `<div class="vl-list">${last.map(l => `<div class="vl-row"><span>${shortDate(l.date)}</span><b class="num">₪${fmt0(l.amount)}</b><button class="btn small ghost" type="button" data-unlock="${esc(l.id)}">החזרה ליומי</button></div>`).join('')}</div>` : ''}
    <h3>בשביל מה?</h3>
    <div class="row2"><div class="field"><label for="ws-n">משאלה</label><input id="ws-n" type="text" maxlength="40" value="${esc(w ? w.name : '')}" placeholder="אוזניות, חופשה"></div>
      <div class="field"><label for="ws-p">מחיר (₪)</label><input id="ws-p" type="number" inputmode="numeric" min="1" step="1" value="${w ? w.price : ''}"></div></div>
    <div class="row2"><button class="btn primary" id="ws-ok" type="button">${ic('check')}שמירה</button>${w ? `<button class="btn ghost" id="ws-del" type="button">${ic('trash')}הסרת המשאלה</button>` : ''}</div>`, (sh, close) => {
    sh.querySelectorAll('[data-unlock]').forEach(b => b.onclick = () => { S.locks = S.locks.filter(l => l.id !== b.dataset.unlock); persist(); close(); changed('settings'); toast('הוחזר ליומי'); });
    $('#ws-ok', sh).onclick = () => {
      const price = Math.round(parseFloat($('#ws-p', sh).value)), name = $('#ws-n', sh).value.trim();
      if (!name && !(price > 0)) { close(); return; }
      if (!(price > 0)) { $('#ws-p', sh).focus(); return; }
      S.wish = { name: name.slice(0, 40) || 'המשאלה שלי', price }; persist(); close(); changed('settings');
    };
    const del = $('#ws-del', sh); if (del) del.onclick = () => { S.wish = null; persist(); close(); changed('settings'); };
  });
}

function catLine({ c, sp }) {
  const pct = c.budget ? sp / c.budget : 0, left = c.budget - sp;
  const cls = !c.budget ? 'nobudget' : pct >= 1 ? 'bad' : pct >= .8 ? 'warn' : '';
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
      <div class="ib-meta">${shortDate(t.date)}${t.time ? ' · ' + esc(t.time) : ''}${t.place ? ' · ' + esc(t.place) : ''} · <a href="https://www.google.com/search?q=${encodeURIComponent(t.merchant)}" target="_blank" rel="noopener noreferrer">מה זה?</a></div>
      <div class="chips">${quick.map(c => `<button type="button" class="qchip" data-cat="${esc(c.id)}" style="--c:${c.color}">${ic(c.icon)}${esc(c.name)}</button>`).join('')}
        <button type="button" class="qchip more" data-more="1">${ic('dots')}כל הקטגוריות</button><button type="button" class="qchip keep" data-keep="1">דלג</button></div></section>`;
  }
  const hasSlip = C.inPeriod.some(t => t.kind === 'income' && t.source === 'payslip');
  if (C.isCurrent && !hasSlip && new Date().getDate() >= 5)
    return `<section class="card next slip"><div class="nx-h"><span class="nx-ic">${ic('hand-coins')}</span><b>הגיע תלוש המשכורת?</b></div><a class="btn small gold" href="#add" data-go="payslip">${ic('scan')}העלאת תלוש</a></section>`;
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

function classify(id, catId, skipped = false) {
  const t = state.tx.find(x => x.id === id); if (!t) return;
  const generic = isGenericMerchant(t.merchant);
  const n = normMerchant(t.merchant);
  // "כסף שחזר" is about this one purchase - never spread to other purchases or learned for the shop
  const one = generic || catId === 'refund';
  const list = one ? [t] : state.tx.filter(x => x.kind === 'expense' && (x.id === t.id || ((x.category || 'other') === 'other' && !x.confirmed && sameBusiness(x.merchant, t.merchant))));
  if (!one && catId !== 'other') { state.settings.rules[n] = catId; persist(); }
  upsertTx(list.map(x => ({ ...x, category: catId, confirmed: true })));
  changed();
  toast(skipped ? 'נשאר בשונות. אפשר לשנות בכל רגע ברשימת התנועות.' : catId === 'other' ? 'סווג ל"שונות"' : catId === 'refund' ? `סומן ככסף שחזר. ₪${fmt0(t.amount)} לא נספרים יותר כהוצאה.` : `סווג ל"${catById(catId).name}"${list.length > 1 ? ` (${list.length} קניות)` : ''}${generic ? '' : ' · נלמד לפעם הבאה'}`);
}

function wire(el, cats) {
  const ask = $('.next.ask', el);
  if (ask) {
    const id = ask.dataset.ib;
    ask.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => classify(id, b.dataset.cat));
    ask.querySelector('[data-keep]').onclick = () => classify(id, 'other', true);
    ask.querySelector('[data-more]').onclick = () => {
      openSheet('בחירת קטגוריה', `<div class="chips big">${state.settings.categories.map(c => `<button type="button" class="qchip" data-c="${esc(c.id)}" style="--c:${c.color}">${ic(c.icon)}${esc(c.name)}</button>`).join('')}<button type="button" class="qchip new" data-new style="--c:#3D7BFA">${ic('plus')}קטגוריה חדשה</button></div>
        <div class="nc-inline" hidden><input type="text" maxlength="40" placeholder="שם הקטגוריה, למשל: כרטיס נטען" aria-label="שם הקטגוריה החדשה"><button class="btn small primary" type="button" data-nc-ok>הוספה וסיווג</button></div>`, (sh, close) => {
        sh.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { close(); classify(id, b.dataset.c); });
        const box = sh.querySelector('.nc-inline'), inp = box.querySelector('input');
        sh.querySelector('[data-new]').onclick = () => { box.hidden = false; inp.focus(); };
        const add = () => { const nid = addCategory(inp.value); if (!nid) { inp.focus(); return; } close(); classify(id, nid); };
        box.querySelector('[data-nc-ok]').onclick = add; inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
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

/* reward animations (all respect reduced motion) */
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const CONF = ['#F6B829', '#22B573', '#3D8BFA', '#FF8A4C', '#F2559A', '#8B6CF6', '#34C6D3'];
/** A burst of colorful confetti (strips, dots and coins) that rises and falls with gravity. */
function confetti(anchor, n = 28) {
  if (calm() || !anchor || !anchor.animate) return;
  const r = anchor.getBoundingClientRect(), x0 = r.left + r.width / 2, y0 = r.top + r.height * .35;
  for (let i = 0; i < n; i++) {
    const s = document.createElement('i'), kind = i % 5 === 0 ? 'coin' : i % 3 === 0 ? 'dot' : 'strip';
    s.className = 'confetti ' + kind; s.style.left = x0 + 'px'; s.style.top = y0 + 'px';
    if (kind !== 'coin') s.style.background = CONF[i % CONF.length];
    document.body.appendChild(s);
    const a = -Math.PI / 2 + (Math.random() - .5) * 2.2, v = 110 + Math.random() * 170;
    const dx = Math.cos(a) * v, up = Math.sin(a) * v, rot = (Math.random() - .5) * 900, dur = 1100 + Math.random() * 700;
    s.animate([
      { transform: 'translate(-50%,-50%) scale(.3)', opacity: 1 },
      { transform: `translate(calc(-50% + ${dx * .6}px), calc(-50% + ${up}px)) rotate(${rot * .4}deg) scale(1)`, opacity: 1, offset: .35, easing: 'cubic-bezier(.3,0,.7,1)' },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${up + 260 + Math.random() * 120}px)) rotate(${rot}deg) scale(.9)`, opacity: 0 },
    ], { duration: dur, easing: 'cubic-bezier(.15,.7,.3,1)', fill: 'forwards' }).onfinish = () => s.remove();
  }
}
const celebrate = a => confetti(a, 26);
/** Coins pop out of the big number and fly in an arc into the jar. */
function flyCoins(from, to, n, done) {
  if (calm() || !from || !to || !from.animate) { done(); return; }
  const fr = from.getBoundingClientRect(), tr = to.getBoundingClientRect(); let left = n;
  for (let i = 0; i < n; i++) {
    const f = document.createElement('i'), x = fr.left + fr.width / 2 - 10 + (i - (n - 1) / 2) * 16, y = fr.top + fr.height * .55;
    f.className = 'coin flying'; f.style.cssText = `position:fixed;z-index:80;left:${x}px;top:${y}px;margin:0`;
    document.body.appendChild(f);
    const dx = tr.left + tr.width / 2 - 10 - x, dy = tr.top + 14 - y;
    f.animate([
      { transform: 'translate(0,0) scale(.2)', opacity: 0 },
      { transform: 'translate(0,-26px) scale(1.5)', opacity: 1, offset: .22, easing: 'cubic-bezier(.3,0,.5,1)' },
      { transform: `translate(${dx * .55}px, ${dy * .35 - 60}px) scale(1.2) rotate(200deg)`, opacity: 1, offset: .6 },
      { transform: `translate(${dx}px, ${dy}px) scale(.9) rotate(420deg)`, opacity: 1 },
    ], { duration: 780, delay: i * 90, easing: 'cubic-bezier(.4,0,.3,1)', fill: 'forwards' }).onfinish = () => { f.remove(); buzz(6); if (--left === 0) done(); };
  }
}
/** Soft entrance when you arrive at the screen (not on every small update). */
let entering = true;
addEventListener('hashchange', () => { entering = true; });
function enter(el) {
  const ring = $('.ring-fg', el);
  if (!entering || calm()) return;
  entering = false;
  el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter');
  if (ring) { const off = ring.dataset.off; ring.style.transition = 'none'; ring.setAttribute('stroke-dashoffset', CIRC.toFixed(1)); void ring.getBoundingClientRect(); ring.style.transition = ''; requestAnimationFrame(() => ring.setAttribute('stroke-dashoffset', off)); }
}
/* the big number counts up once per screen visit */
let lastShown = null;
let lastCounted = null;
function countUp(el) {
  const b = $('.h-big', el); if (!b || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const target = +b.dataset.count, sig = state.ui.curKey + ':' + target;
  const from = b.dataset.from != null ? +b.dataset.from : lastShown && lastShown.key === state.ui.curKey ? lastShown.v : 0;
  lastShown = { key: state.ui.curKey, v: target };
  if (lastCounted === sig || target === from || calm()) return; lastCounted = sig;
  const t0 = performance.now(), dur = 650;
  const step = now => { const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 5); b.innerHTML = money(Math.round(from + (target - from) * e)); if (p < 1) requestAnimationFrame(step); else { b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); } };
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
  if (C.refunded > 0) parts.push(`<div class="ins good">${ic('arrow-u-up-left')}<p>חזרו לך החודש ${money(C.refunded, 'auto')} (${C.refundCount === 1 ? 'קנייה אחת' : C.refundCount + ' קניות'}). הן מופיעות ברשימה אבל לא נספרות כהוצאה.</p></div>`);
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
