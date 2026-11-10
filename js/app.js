import * as vault from './vault.js';
import { state, loadState, replaceAll, flushNow, bus, changed, persist, upsertTx } from './store.js';
import { budgetKeyOf, isoOf, shiftKey, periodOf } from './calc.js';
import { $, $$, esc, ic, toast, openSheet, monthName } from './util.js';
import * as home from './views/home.js';
import * as expenses from './views/expenses.js';
import * as add from './views/add.js';
import * as budget from './views/budget.js';
import * as more from './views/more.js';
import { readShots } from './views/add.js';
import { classify, historyOf, AUTO } from './categorize.js';

const VIEWS = { home, expenses, add, budget, more };
const MONTH_VIEWS = ['home', 'expenses'];
let view = 'home';

/* ---------------- lock screen ---------------- */
const MARK = 'stashwise-had-data';
const markSet = () => { try { localStorage.setItem(MARK, String(Date.now())); } catch { } };
const markGet = () => { try { return localStorage.getItem(MARK); } catch { return null; } };
function lockScreen(mode) {
  const el = $('#lock');
  el.hidden = false; $('#app').hidden = true;
  const setup = mode === 'setup';
  el.innerHTML = `<div class="lock-card">
    <div class="lock-logo">${ic('wallet', 'big')}</div>
    <h1>Stashwise</h1>
    <p class="lock-sub">${setup ? 'התקציב החודשי שלך, נעול ומוצפן על המכשיר הזה בלבד.' : 'הזן את הקוד כדי לפתוח'}</p>
    ${setup && markGet() ? `<div class="notice">${ic('warning')}<span>נראה שהדפדפן מחק את הנתונים שהיו כאן (עדכון של האפליקציה לא מוחק נתונים). אם יש לך קובץ גיבוי, בחר קוד ולחץ "שחזור מקובץ גיבוי".</span></div>` : ''}
    <form id="lock-form" class="lock-form" autocomplete="off" novalidate>
      ${setup ? `<div class="field"><label for="lk-name">איך לקרוא לך? (לא חובה)</label><input id="lk-name" type="text" maxlength="30" autocomplete="given-name"></div>` : ''}
      <div class="field"><label for="lk-pass">${setup ? 'בחר קוד פתיחה (לפחות 6 תווים)' : 'קוד פתיחה'}</label>
        <div class="pass-wrap"><input id="lk-pass" type="password" inputmode="text" autocomplete="${setup ? 'new-password' : 'current-password'}" required minlength="6">
        <button type="button" class="icon-btn" id="lk-eye" aria-label="הצג קוד">${ic('eye')}</button></div></div>
      ${setup ? `<div class="field"><label for="lk-pass2">שוב את אותו קוד</label><input id="lk-pass2" type="password" autocomplete="new-password" required></div>
        <label class="check"><input type="checkbox" id="lk-ok"> <span>הבנתי: אין שום דרך לשחזר קוד שנשכח. בלי הקוד הנתונים לא נפתחים, ולכן כדאי לגבות מדי פעם.</span></label>` : ''}
      <label class="check"><input type="checkbox" id="lk-rem" ${setup ? 'checked' : ''}> <span>להישאר מחובר במכשיר הזה - בלי קוד בכל פתיחה (נעילת הטלפון שומרת עליו). אפשר לשנות במסך "עוד".</span></label>
      <div id="lk-err" class="form-err" role="alert" hidden></div>
      <button class="btn primary wide" id="lk-go" type="submit">${setup ? ic('lock-key') + 'בואו נתחיל' : ic('lock') + 'פתיחה'}</button>
      ${setup ? `<label class="btn wide" for="lk-file">${ic('upload')}יש לי קובץ גיבוי - שחזור</label><input id="lk-file" type="file" accept=".stash,.kis,.shefa,application/json" hidden>` : `<button class="link-btn" type="button" id="lk-forgot">שכחתי את הקוד</button>`}
    </form>
    <p class="lock-foot">${ic('shield')} בלי חשבון, בלי שרת. הנתונים לא יוצאים מהמכשיר.</p></div>`;
  const pass = $('#lk-pass'), err = $('#lk-err'), go = $('#lk-go');
  const showErr = m => { err.textContent = m; err.hidden = !m; };
  $('#lk-eye').onclick = () => { pass.type = pass.type === 'password' ? 'text' : 'password'; };
  setTimeout(() => (setup ? $('#lk-name') : pass).focus(), 50);
  if (!setup) $('#lk-forgot').onclick = forgotFlow;
  if (setup) $('#lk-file').onchange = e => {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return;
    const p = pass.value;
    if (p.length < 6 || p !== $('#lk-pass2').value) return showErr('קודם בחר קוד פתיחה חדש (פעמיים), ואז בחר את קובץ הגיבוי.');
    openSheet('שחזור מגיבוי', `<p class="hint">הקובץ ${esc(file.name)} ייפתח עם הסיסמה שבחרת כשיצרת אותו.</p>
      <div class="field"><label for="rb-p">סיסמת הגיבוי</label><input id="rb-p" type="password" autocomplete="current-password"></div>
      <button class="btn primary wide" id="rb-go" type="button">${ic('upload')}שחזור</button>`, (sh, close) => {
      $('#rb-go', sh).onclick = async () => {
        const b = $('#rb-go', sh); b.disabled = true; b.innerHTML = '<span class="spin"></span>פותח…';
        try {
          const d = await vault.importBackup(await file.text(), $('#rb-p', sh).value);
          await vault.create(p); await replaceAll(d); await flushNow();
          try { await vault.setRemember($('#lk-rem').checked); } catch { }
          close(); markSet(); startApp(false); toast(`שוחזרו ${state.tx.length} תנועות`);
        } catch (x) { b.disabled = false; b.innerHTML = `${ic('upload')}שחזור`; toast(x && x.code === 'wrong' ? 'הסיסמה שגויה' : 'זה לא קובץ גיבוי של Stashwise'); }
      };
    });
  };
  $('#lock-form').onsubmit = async e => {
    e.preventDefault(); showErr('');
    const p = pass.value;
    if (setup) {
      if (p.length < 6) return showErr('הקוד צריך להיות באורך 6 תווים לפחות.');
      if (p !== $('#lk-pass2').value) return showErr('שני הקודים לא זהים.');
      if (!$('#lk-ok').checked) return showErr('צריך לסמן שהבנת שאי אפשר לשחזר קוד.');
    }
    go.disabled = true; go.innerHTML = `<span class="spin"></span>${setup ? 'מכין…' : 'פותח…'}`;
    try {
      if (setup) {
        await vault.create(p);
        state.settings.name = $('#lk-name').value.trim().slice(0, 30);
        persist(true);
      } else {
        await vault.unlock(p);
        await loadState();
      }
      pass.value = '';
      try { await vault.setRemember($('#lk-rem').checked); } catch { }
      markSet();
      startApp(setup);
    } catch (x) {
      go.disabled = false; go.innerHTML = setup ? ic('lock-key') + 'בואו נתחיל' : ic('lock') + 'פתיחה';
      if (x && x.code === 'wrong') showErr(x.fails >= 5 ? 'קוד שגוי. בגלל כמה ניסיונות שגויים צריך לחכות לפני הניסיון הבא.' : 'הקוד שגוי. נסה שוב.');
      else if (x && x.code === 'wait') {
        let n = x.seconds; go.disabled = true;
        const tick = () => { if (!err.isConnected) return clearInterval(iv); if (n <= 0) { clearInterval(iv); showErr(''); go.disabled = false; return; } showErr(`יותר מדי ניסיונות שגויים. אפשר לנסות שוב בעוד ${n} שניות.`); n--; };
        const iv = setInterval(tick, 1000); tick();
      }
      else showErr('משהו לא עבד. ודא שהדפדפן לא במצב גלישה פרטית ונסה שוב.');
      pass.select();
    }
  };
}

function forgotFlow() {
  openSheet('שכחתי את הקוד', `<p>הנתונים מוצפנים בקוד שלך, ואין לאף אחד - גם לא לאפליקציה - דרך לפתוח אותם בלעדיו.</p>
    <p>אם יש לך קובץ גיבוי, אפשר למחוק הכל, ליצור קוד חדש ולשחזר את הגיבוי (צריך את הסיסמה של הגיבוי).</p>
    <div class="field"><label for="wipe-word">כדי למחוק הכל, הקלד: מחק</label><input id="wipe-word" type="text"></div>
    <button class="btn danger wide" id="wipe-go">${ic('trash')}מחיקת כל הנתונים במכשיר</button>`, (sh, close) => {
    $('#wipe-go', sh).onclick = async () => {
      if ($('#wipe-word', sh).value.trim() !== 'מחק') { toast('הקלד "מחק" כדי לאשר'); return; }
      await vault.wipe(); close(); location.reload();
    };
  });
}

/* ---------------- app shell ---------------- */
export const session = { remembered: false };
async function startApp(firstRun) {
  $('#lock').hidden = true; $('#lock').innerHTML = '';
  $('#app').hidden = false;
  session.remembered = await vault.isRemembered().catch(() => false);
  $('#lock-now').hidden = session.remembered;
  if (!session.remembered) startAutoLock();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => { });
  show(firstRun ? 'budget' : (location.hash.slice(1) || 'home'));
  if (firstRun) toast('מוכן! נתחיל בכמה נכנס לך בחודש.');
  takeShared();
  autoClassify();
}

/* Purchases still waiting in "other" get another try with everything learned so far. */
function autoClassify() {
  const ids = new Set(state.settings.categories.map(c => c.id));
  const history = historyOf(state.tx);
  const upd = [];
  for (const t of state.tx) {
    if (t.kind !== 'expense' || (t.category || 'other') !== 'other' || t.confirmed) continue;
    const r = classify(t.merchant, { rules: state.settings.rules, ids, history, cats: state.settings.categories });
    if (r.conf >= AUTO) upd.push({ ...t, category: r.cat });
  }
  if (upd.length) { upsertTx(upd); changed(); toast(`${upd.length} קניות סווגו לבד לפי מה שלמדתי`); }
}

/* Screenshots shared to the app from the gallery wait in a temporary cache. Read them once, then delete. */
const INBOX = 'shefa-inbox';
async function takeShared() {
  if (!('caches' in window)) return;
  try {
    if (!(await caches.has(INBOX))) return;
    const c = await caches.open(INBOX);
    const files = [];
    for (const req of await c.keys()) {
      const res = await c.match(req);
      if (res) { const b = await res.blob(); files.push(new File([b], 'shared.png', { type: b.type || 'image/png' })); }
    }
    await caches.delete(INBOX); // gone from storage before we even start reading
    if (files.length) { show('add'); readShots(files); }
  } catch { try { await caches.delete(INBOX); } catch { } }
}
// Shared screenshots that were never opened (app left locked) are deleted after 10 minutes.
(async () => {
  try {
    if (!('caches' in window) || !(await caches.has(INBOX))) return;
    const c = await caches.open(INBOX);
    for (const req of await c.keys()) { const r = await c.match(req); if (!r || Date.now() - +(r.headers.get('x-at') || 0) > 600000) await c.delete(req); }
  } catch { }
})();

function renderHeader() {
  const k = state.ui.curKey, sd = state.settings.startDay;
  $('#m-label').textContent = monthName(k);
  const { start, end } = periodOf(k, sd);
  $('#m-range').textContent = sd === 1 ? '' : `${start.getDate()}.${start.getMonth() + 1} – ${end.getDate()}.${end.getMonth() + 1}`;
  $('#month-bar').hidden = !MONTH_VIEWS.includes(view);
  const thisKey = budgetKeyOf(isoOf(new Date()), sd);
  $('#m-today').hidden = k === thisKey;
}

export function show(v) {
  const tt = document.getElementById('toast'); if (tt && !tt.dataset.keep) tt.hidden = true;
  view = VIEWS[v] ? v : 'home';
  if (location.hash.slice(1) !== view) history.replaceState(null, '', '#' + view);
  for (const id of Object.keys(VIEWS)) $('#view-' + id).hidden = id !== view;
  $$('nav.tabs a').forEach(a => { const on = a.dataset.v === view; a.classList.toggle('on', on); a.setAttribute('aria-current', on ? 'page' : 'false'); });
  renderHeader();
  VIEWS[view].render($('#view-' + view));
  window.scrollTo(0, 0);
}
function rerender(detail) {
  if (!vault.isUnlocked()) return;
  renderHeader();
  const v = VIEWS[view];
  if (v.update) v.update($('#view-' + view), detail); else v.render($('#view-' + view));
}
bus.addEventListener('change', e => rerender(e.detail));
window.addEventListener('hashchange', () => { if (vault.isUnlocked()) show(location.hash.slice(1)); });
$('#m-prev').onclick = () => { state.ui.curKey = shiftKey(state.ui.curKey, -1); changed('month'); };
$('#m-next').onclick = () => { state.ui.curKey = shiftKey(state.ui.curKey, 1); changed('month'); };
$('#m-today').onclick = () => { state.ui.curKey = budgetKeyOf(isoOf(new Date()), state.settings.startDay); changed('month'); };
$('#lock-now').onclick = () => lockNow();

/* ---------------- auto lock ---------------- */
let lastActive = Date.now(), hiddenAt = 0, lockTimer = null;
export async function lockNow() {
  try { await flushNow(); } catch { }
  vault.lock();
  location.reload(); // drops everything that was in memory
}
export function stopAutoLock() { clearInterval(lockTimer); lockTimer = null; }
export { startAutoLock };
function startAutoLock() {
  const bump = () => { lastActive = Date.now(); };
  ['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach(ev => addEventListener(ev, bump, { passive: true }));
  clearInterval(lockTimer);
  lockTimer = setInterval(() => {
    if (Date.now() - lastActive > state.settings.autoLockMin * 60000) lockNow();
  }, 15000);
}
document.addEventListener('visibilitychange', () => {
  if (!vault.isUnlocked()) return;
  if (document.hidden) { hiddenAt = Date.now(); flushNow().catch(() => { }); }
  else if (!session.remembered && hiddenAt && Date.now() - hiddenAt > 60000) lockNow();
});
addEventListener('pagehide', () => { flushNow().catch(() => { }); });

/* ---------------- install + updates ---------------- */
export const install = { prompt: null };
addEventListener('beforeinstallprompt', e => { e.preventDefault(); install.prompt = e; changed('install'); });
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').then(reg => {
    const offer = w => {
      const b = $('#update-bar'); b.hidden = false;
      $('#update-go').onclick = async () => { try { await flushNow(); } catch { } w.postMessage('skip-waiting'); };
    };
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
    });
    install.checkUpdate = () => reg.update();
  }).catch(() => { });
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading) { reloading = true; location.reload(); } });
}

/* ---------------- boot ---------------- */
(async () => {
  try {
    if (!window.crypto || !crypto.subtle || !window.indexedDB) throw new Error('unsupported');
    if (await vault.exists()) {
      if (await vault.openRemembered()) { await loadState(); markSet(); startApp(false); return; }
      lockScreen('unlock');
    } else lockScreen('setup');
  } catch {
    $('#lock').hidden = false;
    $('#lock').innerHTML = `<div class="lock-card"><h1>Stashwise</h1><p>הדפדפן הזה לא תומך בהצפנה ובשמירה מקומית (אולי זו גלישה פרטית). פתח את האתר בדפדפן רגיל - Chrome או Safari.</p></div>`;
  }
})();
