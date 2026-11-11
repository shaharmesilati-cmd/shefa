// Home: one calm screen. The big number is what you can safely spend today.
// Below it: ONE next step, the savings goal with your streak, top categories, last purchases.
// Everything else (charts, comparisons) lives behind "ניתוח החודש".
import { state, catById, upsertTx, persist, changed, addCategory } from '../store.js';
import { monthSummary, shiftKey, normMerchant, dailyBank, bankMilestone, isoOf } from '../calc.js';
import { $, $$, esc, ic, money, fmt0, MONTHS, openSheet, toast, shortDate } from '../util.js';
import { txRow, catIcon } from './parts.js';
import { monthInsights, needsCategory, isGenericMerchant, budgetStreak } from '../insights.js';
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

  parts.push(`<p class="greet">${greeting()}</p>`);

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
  const big = C.remaining < 0 || past || future ? Math.abs(C.remaining) : Math.max(0, C.daily);
  const label = C.remaining < 0 ? 'חרגת החודש ב-' : past ? 'נשאר בסוף החודש' : future ? 'יהיה לך להוציא החודש' : 'אפשר להוציא היום';
  const sub = C.remaining < 0 ? 'מהיום כל שקל שנחסך מצמצם את החריגה'
    : past || future ? `${C.total} ימים · תקציב ${money(C.available)}`
    : `נשאר לחודש ${money(C.remaining)} · ${C.daysLeft} ימים`;
  let fc = C.isCurrent && C.elapsed >= 5 && C.available > 0
    ? (C.projectedEnd >= 0 ? `<span class="fc ok">${ic('trend-up')}בקצב הזה תסיים עם עודף של ${money(C.projectedEnd)}</span>`
      : `<span class="fc bad">${ic('trend-down')}בקצב הזה תחרוג בכ-${money(-C.projectedEnd)}</span>`) : '';
  // the daily bank: today's number is what piled up until today, minus what was already spent
  const B = C.remaining >= 0 ? dailyBank(S, state.tx, key) : null;
  let hb = { label, big, sub, cls: C.status, from: null, fresh: false };
  if (B) {
    const minus = B.balance < 0;
    hb.big = B.balance; hb.label = minus ? 'הקופה היומית במינוס' : 'אפשר להוציא היום';
    hb.cls = minus ? 'watch minus' : C.status;
    hb.sub = minus
      ? (B.recoverable ? `בלי הוצאות, חוזרים לפלוס בעוד ${B.recoverDays === 1 ? 'יום אחד' : B.recoverDays + ' ימים'} · כל יום מוסיף ${money(B.base)}`
        : `כל יום מוסיף ${money(B.base)} · כל שקל שלא יוצא מקטין את המינוס`)
      : B.rolled > 0.5 ? `${money(B.base)} של היום + ${money(B.rolled)} שצברת מימים קודמים`
      : B.rolled < -0.5 ? `${money(B.base)} של היום, פחות ${money(-B.rolled)} שיצאו מעבר בימים קודמים`
      : `${money(B.base)} נכנסים לקופה בכל יום`;
    fc = B.tomorrow != null ? `<span class="fc ${B.tomorrow >= 0 ? 'ok' : 'bad'}">${ic('sun')}${B.spentToday ? 'בלי עוד הוצאות היום,' : 'לא מוציא היום?'} מחר ${B.tomorrow >= 0 ? `יהיו לך ${money(B.tomorrow)}` : `המינוס יירד ל-${money(-B.tomorrow)}`}</span>`
      : `<span class="fc ok">${ic('piggy')}היום האחרון של החודש. מה שנשאר, נשאר אצלך.</span>`;
    // first look today: the number climbs from where yesterday ended
    const todayIso = isoOf(new Date()); let seen = null;
    try { seen = localStorage.getItem('stashwise-bank-day'); localStorage.setItem('stashwise-bank-day', todayIso); } catch { }
    if (seen !== todayIso && B.day > 1 && !B.spentToday) { hb.from = B.yesterday; hb.fresh = true; }
  }
  parts.push(`<section class="hero2 ${hb.cls}">
    <div class="ring-wrap">
      <svg class="ring" viewBox="0 0 120 120" aria-hidden="true"><circle class="ring-bg" cx="60" cy="60" r="${R}"></circle>
        <circle class="ring-fg" cx="60" cy="60" r="${R}" stroke-dasharray="${CIRC.toFixed(1)}" stroke-dashoffset="${(CIRC * (1 - left)).toFixed(1)}"></circle></svg>
      <div class="ring-in"><span class="h-lbl">${hb.label}</span><b class="h-big" data-count="${Math.round(hb.big)}"${hb.from != null ? ` data-from="${Math.round(hb.from)}"` : ''}>${money(hb.big)}</b>
        ${hb.fresh ? `<span class="h-plus">+${money(B.base)} הבוקר</span>` : B ? `<span class="h-day">יום ${B.day} מתוך ${B.total}</span>` : ''}</div>
    </div>
    <p class="h-sub">${hb.sub}</p>${fc}
    ${B ? `<p class="h-month">נשאר לחודש ${money(C.remaining)} · ${C.daysLeft} ימים</p>` : ''}
  </section>`);
  const bev = B ? bankEvents(S, B, key) : null;
  if (B) parts.push(bankCard(B, S, hb.fresh));

  // one next step
  parts.push(nextStep(S, C, key));

  // savings goal + streak
  const streak = C.isCurrent && C.status !== 'over' ? budgetStreak(S, state.tx) : 0;
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
  wireBank(el, B, bev, hb.fresh);
  countUp(el);
}

const WD = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
const wdOf = iso => WD[new Date(iso + 'T12:00').getDay()];
const JAR_MAX = 25;
const daysWord = n => (n === 1 ? 'יום אחד' : `${n} ימים`);

/** Coins in the jar: one coin = one day's amount. `was` shows what a planned spend would take out. */
function jarCoins(balance, base, was, tomorrow) {
  const n = balance / base, w = was != null ? was / base : n;
  const have = Math.max(0, n), had = Math.max(0, w);
  const full = Math.min(JAR_MAX, Math.floor(have + 1e-9)), frac = have - Math.floor(have + 1e-9);
  const out = [];
  for (let i = 0; i < full; i++) out.push('<i class="coin"></i>');
  if (frac > 0.04 && full < JAR_MAX) out.push(`<i class="coin part" style="--p:${Math.round(frac * 100)}%"></i>`);
  const gone = Math.min(JAR_MAX, Math.ceil(had - 1e-9)) - out.length;
  for (let i = 0; i < gone; i++) out.push('<i class="coin gone"></i>');
  if (n < 0) for (let i = 0, d = Math.min(10, Math.ceil(-n - 1e-9)); i < d; i++) out.push('<i class="coin debt"></i>');
  else if (tomorrow && was == null && out.length < JAR_MAX) out.push('<i class="coin next" title="המטבע של מחר"></i>');
  return out.join('');
}

/** Updates what the app remembers about the bank (record, milestones, yesterday's pledge) and says what just happened. */
function bankEvents(S, B, key) {
  const ev = { milestone: 0, pledgeWon: false, pledgeLost: false };
  const st = S.bank || (S.bank = { key: '', best: 0, hit: [], pledge: null, wins: 0 });
  let dirty = false;
  if (st.key !== key) { st.key = key; st.best = 0; st.hit = []; dirty = true; }
  const M = bankMilestone(B.balance, B.maxEnd, B.base);
  if (M.prev > 0 && !st.hit.includes(M.prev)) { if (st.best > 0) ev.milestone = M.prev; st.hit.push(M.prev); dirty = true; }
  if (B.balance > st.best) { st.best = B.balance; dirty = true; }
  const todayIso = isoOf(new Date());
  if (st.pledge && st.pledge < todayIso) {
    const d = B.days.find(x => x.iso === st.pledge);
    if (d && !d.spent) { st.wins++; ev.pledgeWon = true; } else if (d) ev.pledgeLost = true;
    st.pledge = null; dirty = true;
  }
  if (dirty) persist();
  return ev;
}

/** The jar, the next milestone, the pledge, the last days, the "what if" slider and the wish. */
function bankCard(B, S, fresh) {
  const st = S.bank, todayIso = isoOf(new Date());
  const days = B.days.slice(-7), top = Math.max(B.base, ...days.map(d => d.spent)) || 1;
  const max = Math.max(50, Math.ceil(Math.max(B.balance, B.base) * 1.5 / 10) * 10);
  const M = bankMilestone(B.balance, B.maxEnd, B.base);
  const coins = B.balance / B.base;
  const head = B.balance < 0 ? `חסרים ${(-coins).toFixed(1).replace('.0', '')} מטבעות`
    : `${coins >= 10 ? Math.floor(coins) : coins.toFixed(1).replace('.0', '')} מטבעות בצנצנת`;
  const mile = B.balance < 0 ? `<p class="jr-line">${ic('plant')}כל יום בלי הוצאות ממלא מטבע אחד. ${B.recoverable ? `עוד ${daysWord(B.recoverDays)} והצנצנת חוזרת להתמלא.` : ''}</p>`
    : M.next && M.reachable ? `<p class="jr-line">${ic('target')}עוד ${money(M.next - B.balance)} ל-${money(M.next)}${M.days ? ` · ${daysWord(M.days)} בלי הוצאות` : ''}</p>
      <div class="gold-bar"><i style="width:${(M.pct * 100).toFixed(1)}%"></i></div>`
    : `<p class="jr-line">${ic('piggy')}אם לא תוציא עד סוף החודש, יישארו לך ${money(B.maxEnd)}.</p>`;
  const yday = B.days[B.days.length - 2];
  const morning = fresh && yday ? (!yday.spent ? `${ic('sparkle')}<b>אתמול לא הוצאת כלום.</b> כל ה-${money(B.base)} עברו להיום, ומטבע חדש נפל לצנצנת.`
    : yday.net > 0 ? `${ic('sparkle')}<b>אתמול נשארו לך ${money(yday.net)}.</b> הם עברו להיום, יחד עם מטבע חדש.`
    : `אתמול יצאו ${money(-yday.net)} מעבר ליומי. היום נכנס מטבע חדש, ואפשר להתחיל למלא מחדש.`) : '';
  const pledged = st.pledge === todayIso;
  const pledge = B.tomorrow == null ? ''
    : pledged ? (B.spentToday ? `<div class="pledge off">${ic('info')}<span>התחייבת ליום בלי הוצאות, והיום כבר יצאו ${money(B.spentToday, 'auto')}. לא נורא, מחר יום חדש.</span></div>`
      : `<div class="pledge on">${ic('shield')}<span><b>התחייבת: היום לא מוציאים.</b> מחר יחכו לך ${money(B.tomorrow)}.</span></div>`)
    : !B.spentToday ? `<button class="btn small pledge-btn" id="bk-pledge" type="button">${ic('lock')}היום אני לא מוציא</button>` : '';
  const w = S.wish;
  const wish = w ? `<button type="button" class="wish" id="bk-wish"><span class="wish-ic">${ic('gift')}</span><span class="wish-mid"><b>${esc(w.name)} · ${money(w.price)}</b>
      <small>${B.balance >= w.price ? `הקופה כבר מכסה את זה, ויישארו ${money(B.balance - w.price)}` : B.balance > 0 ? `יש ${Math.floor(B.balance / w.price * 100)}% · חסרים ${money(w.price - B.balance)}${w.price <= B.maxEnd ? ` · ${daysWord(Math.ceil((w.price - B.balance) / B.base))} בלי הוצאות` : ''}` : `חסרים ${money(w.price - B.balance)}`}</small>
      <span class="gold-bar"><i style="width:${Math.max(0, Math.min(100, B.balance / w.price * 100)).toFixed(1)}%"></i></span></span></button>`
    : `<button type="button" class="link wish-add" id="bk-wish">${ic('gift')}בשביל מה אני צובר? להוסיף משאלה</button>`;
  return `<section class="card bank">
    <div class="card-h"><h2>${ic('coins')}הקופה היומית</h2>${st.wins ? `<span class="badge zero">${ic('shield')}${st.wins === 1 ? 'התחייבות אחת שעמדת בה' : st.wins + ' התחייבויות שעמדת בהן'}</span>` : B.zeroDays ? `<span class="badge zero">${ic('plant')}${daysWord(B.zeroDays)} בלי הוצאה</span>` : ''}</div>
    <div class="jar-row">
      <button type="button" class="jar${B.balance < 0 ? ' empty' : ''}${fresh ? ' fresh' : ''}" id="bk-jar" aria-label="הצנצנת: ${head}. כל מטבע הוא יום אחד"><span class="jar-lid"></span><span class="jar-in" id="bk-coins">${jarCoins(B.balance, B.base, null, B.tomorrow != null)}</span>${coins > JAR_MAX ? `<span class="jar-x num">×${Math.floor(coins)}</span>` : ''}</button>
      <div class="jar-side"><b class="jr-head" id="bk-head">${head}</b><small class="muted">כל מטבע = יום אחד של ${money(B.base)}</small>${mile}
        ${st.best > B.balance + 1 && B.balance >= 0 ? `<small class="muted">שיא החודש: ${money(st.best)}</small>` : ''}</div>
    </div>
    ${pledge}
    <div class="bk-days" role="list">${days.map((d, i) => {
      const today = i === days.length - 1, cls = !d.spent ? (today ? 'today' : 'zero') : d.spent <= B.base ? 'under' : 'over';
      return `<button type="button" class="bk-day ${cls}${today ? ' is-today' : ''}" role="listitem" data-day="${d.iso}" aria-label="יום ${wdOf(d.iso)} ${shortDate(d.iso)}">
        <span class="bk-col"><i style="height:${Math.max(6, Math.min(100, d.spent / top * 100)).toFixed(0)}%"></i></span>
        <b class="num">${!d.spent ? (today ? '·' : '+' + fmt0(B.base)) : (d.net >= 0 ? '+' : '-') + fmt0(Math.abs(d.net))}</b><small>${today ? 'היום' : wdOf(d.iso) + "'"}</small></button>`; }).join('')}</div>
    <p class="bk-info${morning ? ' morning' : ''}" id="bk-info" aria-live="polite">${morning || 'מה שלא הוצאת נשאר בצנצנת ועובר ליום הבא. לחץ על יום או על הצנצנת.'}</p>
    ${B.tomorrow != null ? `<div class="bk-sim"><label for="bk-range">ואם אוציא היום ${B.spentToday ? 'עוד ' : ''}<b id="bk-x" class="num">₪0</b>?</label>
      <input type="range" id="bk-range" min="0" max="${max}" step="5" value="0">
      <p id="bk-out" class="bk-out"></p></div>` : ''}
    ${wish}
  </section>`;
}
const buzz = ms => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch { } };
function wireBank(el, B, ev, fresh) {
  const card = $('.bank', el); if (!card || !B) return;
  const S = state.settings, info = $('#bk-info', card), jar = $('#bk-jar', card), coinsEl = $('#bk-coins', card), headEl = $('#bk-head', card);
  const head0 = headEl.textContent;
  jar.onclick = () => {
    jar.classList.remove('shake'); void jar.offsetWidth; jar.classList.add('shake'); buzz(12);
    info.classList.remove('morning');
    info.innerHTML = B.balance < 0 ? `הצנצנת ריקה, וחסרים ${money(-B.balance)}. כל יום בלי הוצאות מחזיר מטבע של ${money(B.base)}.`
      : `בצנצנת ${money(B.balance)}. המטבע המקווקו הוא של מחר: הוא נכנס גם אם תוציא היום, אבל רק מה שלא תוציא נשאר לידו.`;
  };
  card.querySelectorAll('[data-day]').forEach(b => b.onclick = () => {
    const d = B.days.find(x => x.iso === b.dataset.day); if (!d) return;
    card.querySelectorAll('.bk-day').forEach(x => x.classList.toggle('sel', x === b));
    const isT = b.classList.contains('is-today'), when = isT ? 'היום' : `יום ${wdOf(d.iso)}' ${shortDate(d.iso)}`, end = isT ? 'עומדת על' : 'נסגרה על';
    info.classList.remove('morning');
    info.innerHTML = !d.spent ? `<b>${when}:</b> ${isT ? 'עוד לא הוצאת כלום.' : 'לא הוצאת כלום.'} כל ה-${money(B.base)} ${isT ? 'עדיין' : 'נשארו'} בקופה. הקופה ${end} ${money(d.closed)}.`
      : d.net >= 0 ? `<b>${when}:</b> הוצאת ${money(d.spent, 'auto')} מתוך ${money(B.base)}. ${money(d.net)} נשארו ועברו הלאה. הקופה ${end} ${money(d.closed)}.`
      : `<b>${when}:</b> הוצאת ${money(d.spent, 'auto')}, שזה ${money(-d.net)} מעבר ליומי. הקופה ${end} ${money(d.closed)}.`;
  });
  const pb = $('#bk-pledge', card);
  if (pb) pb.onclick = () => { S.bank.pledge = isoOf(new Date()); persist(); buzz(20); celebrate(pb); changed('settings'); toast('התחייבת. מחר נבדוק ביחד.'); };
  $('#bk-wish', card).onclick = () => openWish();
  const r = $('#bk-range', card);
  if (r) {
    const out = $('#bk-out', card), x = $('#bk-x', card); let lastCoins = -1;
    const show = () => {
      const v = +r.value, tom = B.balance - v + B.base, today = B.balance - v;
      x.textContent = '₪' + fmt0(v);
      coinsEl.innerHTML = jarCoins(today, B.base, v ? B.balance : null, true);
      const lost = v / B.base, c = Math.floor(lost);
      headEl.textContent = v ? `יוצאים ${lost >= 10 ? Math.round(lost) : lost.toFixed(1).replace('.0', '')} מטבעות` : head0;
      headEl.classList.toggle('t-warn', !!v);
      if (c !== lastCoins && lastCoins >= 0) buzz(6); lastCoins = c;
      out.className = 'bk-out ' + (tom < 0 ? 'bad' : v === 0 ? 'good' : today < 0 ? 'warn' : '');
      out.innerHTML = v === 0 ? `${ic('sun')}מחר ${tom >= 0 ? `יחכו לך ${money(tom)}` : `המינוס יירד ל-${money(-tom)}`}. ${tom >= 0 && B.balance >= 0 ? 'ככה הקופה גדלה.' : 'ככה חוזרים לפלוס.'}`
        : tom < 0 ? `${ic('warning')}מחר תתחיל במינוס של ${money(-tom)}, ויידרשו ${Math.ceil(-tom / B.base) + 1} ימים בלי הוצאות כדי לחזור לפלוס.`
        : today < 0 ? `${ic('info')}זה ${money(-today)} יותר ממה שיש בקופה היום. מחר יישארו לך רק ${money(tom)}.`
        : `${ic('check')}נשאר בקופה ${money(today)}, ומחר יהיו לך ${money(tom)}`;
    };
    r.oninput = show; show();
  }
  // one small celebration per visit, the most important first
  const key = `${state.ui.curKey}:${ev.pledgeWon}:${ev.milestone}:${fresh}`;
  if (wireBank.done === key) return; wireBank.done = key;
  if (ev.pledgeWon) { toast(`עמדת בהתחייבות! יום שלם בלי הוצאות, ו-₪${fmt0(B.base)} נשארו בצנצנת.`); celebrate(jar); buzz([20, 40, 20]); }
  else if (ev.milestone) { toast(`הקופה עברה את ₪${fmt0(ev.milestone)}!`); celebrate(jar); buzz([20, 40, 20]); }
  else if (fresh && B.yesterdaySpent === 0) { celebrate(jar); buzz(15); }
  else if (ev.pledgeLost) toast('אתמול ההתחייבות לא החזיקה. לא נורא, היום מתחילים מחדש.');
}
function openWish() {
  const S = state.settings, w = S.wish;
  openSheet('בשביל מה אני צובר?', `<p class="hint">דבר אחד שאתה רוצה. הקופה תראה לך כמה קרוב אתה אליו, וכל יום בלי הוצאות מקרב אותך.</p>
    <div class="field"><label for="ws-n">מה זה?</label><input id="ws-n" type="text" maxlength="40" value="${esc(w ? w.name : '')}" placeholder="למשל: אוזניות, סופ״ש בצפון"></div>
    <div class="field"><label for="ws-p">כמה זה עולה? (₪)</label><input id="ws-p" type="number" inputmode="numeric" min="1" step="1" value="${w ? w.price : ''}"></div>
    <div class="row2"><button class="btn primary" id="ws-ok" type="button">${ic('check')}שמירה</button>${w ? `<button class="btn ghost" id="ws-del" type="button">${ic('trash')}הסרה</button>` : ''}</div>`, (sh, close) => {
    $('#ws-ok', sh).onclick = () => {
      const price = Math.round(parseFloat($('#ws-p', sh).value)); if (!(price > 0)) { $('#ws-p', sh).focus(); return; }
      S.wish = { name: $('#ws-n', sh).value.trim().slice(0, 40) || 'המשאלה שלי', price }; persist(); close(); changed('settings');
    };
    const del = $('#ws-del', sh); if (del) del.onclick = () => { S.wish = null; persist(); close(); changed('settings'); };
  });
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
      <div class="ib-meta">${shortDate(t.date)}${t.time ? ' · ' + esc(t.time) : ''}${t.place ? ' · ' + esc(t.place) : ''} · <a href="https://www.google.com/search?q=${encodeURIComponent(t.merchant)}" target="_blank" rel="noopener noreferrer">מה זה?</a></div>
      <div class="chips">${quick.map(c => `<button type="button" class="qchip" data-cat="${esc(c.id)}" style="--c:${c.color}">${ic(c.icon)}${esc(c.name)}</button>`).join('')}
        <button type="button" class="qchip more" data-more="1">${ic('dots')}כל הקטגוריות</button><button type="button" class="qchip keep" data-keep="1">דלג</button></div></section>`;
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
  const target = +b.dataset.count, from = b.dataset.from != null ? +b.dataset.from : 0; const sig = state.ui.curKey + ':' + target;
  if (lastCounted === sig || target === from || (target <= 0 && b.dataset.from == null)) return; lastCounted = sig;
  const t0 = performance.now(), dur = b.dataset.from != null ? 1300 : 700;
  const step = now => { const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3); b.innerHTML = money(Math.round(from + (target - from) * e)); if (p < 1) requestAnimationFrame(step); };
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
