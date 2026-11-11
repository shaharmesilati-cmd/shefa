import * as vault from '../vault.js';
import { state, persist, replaceAll, flushNow, changed } from '../store.js';
import { $, esc, ic, toast, openSheet, download, armConfirm, monthName } from '../util.js';
import { budgetKeyOf, normMerchant, txKey } from '../calc.js';
import { catById } from '../store.js';
import { install, lockNow, session, startAutoLock, stopAutoLock } from '../app.js';

const VERSION = '3.0.0';
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

export function update(el, detail) { if (detail === 'install' || !el.contains(document.activeElement)) render(el); }

const monthsWithData = () => [...new Set(state.tx.map(t => txKey(t, state.settings)))].sort().reverse();

/** "What Stashwise learned": every shop -> category it remembers, with fix and delete. */
function ruleRows() {
  const S = state.settings, names = {};
  for (const t of state.tx) { const k = normMerchant(t.merchant); if (!names[k] || t.added > names[k].added) names[k] = t; }
  return Object.entries(S.rules).map(([k, cat]) => ({ k, cat, name: names[k] ? names[k].merchant : k, count: state.tx.filter(t => normMerchant(t.merchant) === k).length }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'he'));
}
function rulesCard() {
  const rows = ruleRows(), cats = state.settings.categories.filter(c => c.id !== 'refund');
  return `<details class="card rules"><summary><h2>${ic('sparkle')} מה Stashwise למדה <span class="muted num">(${rows.length})</span></h2></summary>
    <p class="hint">כשאתה מסווג חנות, Stashwise זוכרת את זה לפעם הבאה. אם משהו נלמד לא נכון, תקן כאן. שינוי מעביר גם את הקניות הקיימות מהחנות הזו לקטגוריה החדשה.</p>
    ${rows.length ? `<input type="search" id="rl-q" placeholder="חיפוש חנות" aria-label="חיפוש חנות">
    <div class="rl-list">${rows.map(r => `<div class="rl-row" data-k="${esc(r.k)}"><div class="rl-n"><b>${esc(r.name)}</b><small class="muted">${r.count ? `${r.count} קניות` : 'אין קניות שמורות'}</small></div>
      <select data-rl="${esc(r.k)}" aria-label="קטגוריה ל${esc(r.name)}">${cats.map(c => `<option value="${esc(c.id)}" ${c.id === catById(r.cat).id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <button class="icon-btn del" data-rl-del="${esc(r.k)}" type="button" aria-label="לשכוח את ${esc(r.name)}">${ic('trash')}</button></div>`).join('')}</div>`
    : '<p class="muted">עוד לא נלמד כלום. ברגע שתסווג קנייה, היא תופיע כאן.</p>'}</details>`;
}
function wireRules(el) {
  const S = state.settings;
  const q = $('#rl-q', el); if (q) q.oninput = () => { const v = normMerchant(q.value); el.querySelectorAll('.rl-row').forEach(r => { r.hidden = !!v && !r.dataset.k.includes(v) && !r.textContent.toLowerCase().includes(q.value.trim().toLowerCase()); }); };
  el.querySelectorAll('[data-rl]').forEach(s => s.onchange = () => {
    const k = s.dataset.rl, old = S.rules[k], to = s.value;
    S.rules[k] = to;
    let n = 0;
    for (const t of state.tx) if (t.kind === 'expense' && normMerchant(t.merchant) === k && t.category !== 'refund' && (t.category === old || !t.category || t.category === 'other')) { t.category = to; n++; }
    persist(); changed('tx');
    toast(`מעכשיו: ${catById(to).name}${n ? ` · ${n} קניות עודכנו` : ''}`);
  });
  el.querySelectorAll('[data-rl-del]').forEach(b => armConfirm(b, () => {
    delete S.rules[b.dataset.rlDel]; persist(); b.closest('.rl-row').remove();
    toast('נשכח. בפעם הבאה Stashwise תשאל או תנחש מחדש.');
  }, 'לחץ שוב כדי לשכוח'));
}

export function render(el) {
  const S = state.settings;
  el.innerHTML = `
  <section class="card"><div class="card-h"><h2>${ic('device')} התקנה בטלפון</h2></div>
    ${standalone() ? `<p class="ok-line">${ic('check')} Stashwise מותקנת כאפליקציה במכשיר הזה.</p>`
      : install.prompt ? `<p>אפשר להתקין את Stashwise כאפליקציה על מסך הבית. היא תיפתח במסך מלא ותעבוד גם בלי אינטרנט.</p><button class="btn primary" id="inst" type="button">${ic('download')}התקנה</button>`
      : isIOS() ? `<ol class="how"><li>ב-Safari, לחץ על כפתור השיתוף ${ic('share')} בתחתית.</li><li>בחר "הוסף למסך הבית".</li><li>לחץ "הוסף". מעכשיו Stashwise נפתחת כמו אפליקציה.</li></ol>`
      : `<ol class="how"><li>בתפריט הדפדפן (שלוש הנקודות) בחר "התקנת אפליקציה" או "הוספה למסך הבית".</li><li>אשר. Stashwise תופיע על מסך הבית ותיפתח במסך מלא.</li></ol>`}</section>

  <section class="card"><div class="card-h"><h2>${ic('shield')} פרטיות ואבטחה</h2></div>
    <ul class="facts">
      <li>${ic('lock-key')}<span>כל הנתונים מוצפנים בהצפנה חזקה ונשמרים רק במכשיר הזה. הקוד שלך הוא המפתח.</span></li>
      <li>${ic('x')}<span>אין חשבון, אין שרת ואין מעקב. האפליקציה חסומה טכנית מלשלוח מידע לאינטרנט.</span></li>
      <li>${ic('bank')}<span>Stashwise לא מבקשת סיסמאות של הבנק או של האשראי, אף פעם. את הקבצים אתה מוריד בעצמך.</span></li>
    </ul>
    <div class="field"><label for="rem">כניסה לאפליקציה</label><select id="rem">
      <option value="1" ${session.remembered ? 'selected' : ''}>בלי קוד במכשיר הזה (מומלץ לטלפון אישי)</option>
      <option value="0" ${session.remembered ? '' : 'selected'}>לבקש קוד בכל פתיחה</option></select></div>
    <p class="hint" id="persist-line">${ic('check')} הנתונים נשמרים במכשיר עד שתמחק אותם בעצמך.</p>
    <div class="row2">
      <div class="field" ${session.remembered ? 'hidden' : ''}><label for="al">נעילה אוטומטית אחרי</label><select id="al">${[1, 5, 15, 30].map(m => `<option value="${m}" ${S.autoLockMin === m ? 'selected' : ''}>${m === 1 ? 'דקה' : m + ' דקות'} ללא שימוש</option>`).join('')}</select></div>
      <div class="field"><label for="nm">השם שלך</label><input id="nm" type="text" maxlength="30" value="${esc(S.name)}"></div>
    </div>
    <div class="btn-row"><button class="btn" id="chg" type="button">${ic('lock-key')}החלפת קוד</button><button class="btn" id="lock-btn" type="button">${ic('lock')}${session.remembered ? 'נעילה (לבקש קוד מעכשיו)' : 'נעילה עכשיו'}</button></div></section>

  ${rulesCard()}

  <section class="card"><div class="card-h"><h2>${ic('download')} גיבוי והעברה למכשיר אחר</h2></div>
    <p class="hint">הגיבוי הוא קובץ מוצפן בסיסמה שתבחר. שמור אותו במקום בטוח (למשל בכונן שלך). כדי לעבור לטלפון אחר - שחזר בו את הקובץ.</p>
    <div class="btn-row"><button class="btn primary" id="bk" type="button">${ic('download')}יצירת גיבוי</button>
      <label class="btn" for="rs">${ic('upload')}שחזור מגיבוי</label><input id="rs" type="file" accept=".stash,.kis,.shefa,application/json" hidden></div>
    <p class="muted small">${state.tx.length} תנועות שמורות כרגע · ${state.settings.lastBackup ? `גיבוי אחרון: ${new Date(state.settings.lastBackup).toLocaleDateString('he-IL')}` : 'עוד לא נוצר גיבוי'}</p></section>

  <section class="card"><div class="card-h"><h2>${ic('info')} על Stashwise</h2><span class="muted num">גרסה ${VERSION}</span></div>
    <p class="hint">עדכונים לא נכנסים לבד: כשיש גרסה חדשה תופיע הודעה ותבחר אם לעדכן. כך אף אחד לא יכול להחליף לך את האפליקציה בלי שתדע.</p>
    <div class="btn-row"><button class="btn" id="upd" type="button">${ic('refresh')}בדיקת עדכונים</button></div></section>

  <section class="card"><div class="card-h"><h2>${ic('calendar')} ניקוי חודש</h2></div>
    <p class="hint">מוחק רק את התנועות של החודש שתבחר (ההגדרות והתקציב נשארים). שימושי אם העלית קובץ לא נכון.</p>
    ${monthsWithData().length ? `<div class="field"><label for="wm-k">איזה חודש</label><select id="wm-k">${monthsWithData().map(k => `<option value="${k}">${monthName(k)} (${state.tx.filter(t => budgetKeyOf(t.date, state.settings.startDay) === k).length} תנועות)</option>`).join('')}</select></div>
    <button class="btn danger" id="wipe-month" type="button">${ic('trash')}מחיקת התנועות של החודש</button>` : '<p class="muted small">אין עדיין תנועות.</p>'}</section>

  <section class="card danger-zone"><div class="card-h"><h2>${ic('warning')} מחיקת כל הנתונים</h2></div>
    <p class="hint">מוחק מהמכשיר הזה את כל התנועות, ההגדרות והקוד. אי אפשר לבטל, לכן כדאי לגבות קודם.</p>
    <button class="btn danger" id="wipe" type="button">${ic('trash')}מחיקת הכל</button></section>`;

  const inst = $('#inst', el);
  if (inst) inst.onclick = async () => { install.prompt.prompt(); await install.prompt.userChoice.catch(() => { }); install.prompt = null; render(el); };
  $('#rem', el).onchange = async e => {
    const on = e.target.value === '1';
    try { await vault.setRemember(on); session.remembered = on; $('#lock-now').hidden = on; on ? stopAutoLock() : startAutoLock();
      toast(on ? 'מעכשיו האפליקציה נפתחת בלי קוד במכשיר הזה' : 'מעכשיו יתבקש קוד בכל פתיחה'); render(el);
    } catch { toast('לא הצלחתי לשמור את ההגדרה'); }
  };
  if (navigator.storage && navigator.storage.persisted) navigator.storage.persisted().then(ok => {
    const l = $('#persist-line', el); if (!l) return;
    if (!ok) navigator.storage.persist && navigator.storage.persist().then(g => { if (!g && l.isConnected) l.innerHTML = `${ic('info')} כדי שהדפדפן לא ינקה את הנתונים לעולם, התקן את האפליקציה למסך הבית, ומדי פעם צור גיבוי.`; }).catch(() => { });
  }).catch(() => { });
  $('#al', el).onchange = e => { S.autoLockMin = +e.target.value; persist(); toast('נשמר'); };
  $('#nm', el).oninput = e => { S.name = e.target.value.slice(0, 30); persist(); };
  wireRules(el);
  $('#lock-btn', el).onclick = async () => { if (session.remembered) { await vault.setRemember(false).catch(() => { }); } lockNow(); };
  $('#upd', el).onclick = async () => { if (install.checkUpdate) { await install.checkUpdate().catch(() => { }); toast('בדקתי. אם יש גרסה חדשה תופיע הודעה למעלה.'); } else toast('בדיקת עדכונים פועלת רק כשהאתר פתוח מהאינטרנט.'); };
  $('#chg', el).onclick = changeCode;
  $('#bk', el).onclick = backup;
  $('#rs', el).onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) restore(f); };
  $('#wipe', el).onclick = wipe;
  if ($('#wipe-month', el)) armConfirm($('#wipe-month', el), () => {
    const sd = state.settings.startDay, k = $('#wm-k', el).value;
    const removed = state.tx.filter(t => txKey(t, state.settings) === k);
    state.tx = state.tx.filter(t => txKey(t, state.settings) !== k); persist(true); changed(); render(el);
    toast(`נמחקו ${removed.length} תנועות של ${monthName(k)}`, { label: 'ביטול', fn: () => { state.tx = state.tx.concat(removed); persist(true); changed(); render(el); toast('התנועות הוחזרו'); } });
  }, 'לחץ שוב כדי למחוק');
}

function passFields(prefix, labels) {
  return labels.map(([id, l, ac]) => `<div class="field"><label for="${prefix}-${id}">${l}</label><input id="${prefix}-${id}" type="password" autocomplete="${ac}"></div>`).join('');
}

function changeCode() {
  openSheet('החלפת קוד', passFields('cc', [['old', 'הקוד הנוכחי', 'current-password'], ['n1', 'קוד חדש (6 תווים לפחות)', 'new-password'], ['n2', 'שוב את הקוד החדש', 'new-password']])
    + `<button class="btn primary wide" id="cc-go" type="button">${ic('check')}החלפה</button>`, (sh, close) => {
    $('#cc-go', sh).onclick = async () => {
      const o = $('#cc-old', sh).value, a = $('#cc-n1', sh).value, b = $('#cc-n2', sh).value;
      if (a.length < 6) return toast('הקוד החדש קצר מדי');
      if (a !== b) return toast('הקודים החדשים לא זהים');
      try { await vault.changePass(o, a); close(); toast('הקוד הוחלף'); } catch { toast('הקוד הנוכחי שגוי'); }
    };
  });
}

function backup() {
  openSheet('יצירת גיבוי מוצפן', `<p class="hint">בחר סיסמה לקובץ הגיבוי. בלי הסיסמה אי אפשר לפתוח אותו - גם לא אנחנו.</p>`
    + passFields('bk', [['p1', 'סיסמה לגיבוי (8 תווים לפחות)', 'new-password'], ['p2', 'שוב את הסיסמה', 'new-password']])
    + `<p class="hint">${ic('info')} בטלפון ייפתח חלון שיתוף: בחר "שמירה בקבצים", Google Drive או iCloud. אפשר להשתמש באותו קוד של האפליקציה.</p><button class="btn primary wide" id="bk-go" type="button">${ic('download')}שמירת הגיבוי</button>`, (sh, close) => {
    $('#bk-go', sh).onclick = async () => {
      const a = $('#bk-p1', sh).value, b = $('#bk-p2', sh).value;
      if (a.length < 8) return toast('הסיסמה קצרה מדי');
      if (a !== b) return toast('הסיסמאות לא זהות');
      const btn = $('#bk-go', sh); btn.disabled = true; btn.innerHTML = `<span class="spin"></span>מצפין…`;
      const text = await vault.exportBackup({ v: 1, settings: state.settings, tx: state.tx, at: new Date().toISOString() }, a);
      const name = `stashwise-backup-${new Date().toISOString().slice(0, 10)}.stash`;
      const file = new File([text], name, { type: 'application/octet-stream' });
      let shared = false;
      try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'גיבוי Stashwise' }); shared = true; } } catch (e) { if (e && e.name === 'AbortError') { btn.disabled = false; btn.innerHTML = `${ic('download')}שמירת הגיבוי`; return; } }
      if (!shared) download(name, text);
      state.settings.lastBackup = Date.now(); persist(true); changed('backup');
      close(); toast(shared ? 'הגיבוי נשמר. כל הכבוד!' : 'קובץ הגיבוי ירד. שמור אותו במקום בטוח (למשל דרייב או iCloud).');
    };
  });
}

function restore(file) {
  openSheet('שחזור מגיבוי', `<p class="hint">השחזור מחליף את כל מה שיש כרגע במכשיר בנתונים שבקובץ <b>${esc(file.name)}</b>.</p>`
    + passFields('rs', [['p', 'סיסמת הגיבוי', 'current-password']])
    + `<button class="btn primary wide" id="rs-go" type="button">${ic('upload')}שחזור</button>`, (sh, close) => {
    $('#rs-go', sh).onclick = async () => {
      const btn = $('#rs-go', sh); btn.disabled = true; btn.innerHTML = `<span class="spin"></span>פותח…`;
      try {
        if (file.size > 30 * 1024 * 1024) throw { code: 'format' };
        const d = await vault.importBackup(await file.text(), $('#rs-p', sh).value);
        await replaceAll(d); await flushNow(); close(); changed(); toast(`שוחזרו ${state.tx.length} תנועות`);
      } catch (e) {
        btn.disabled = false; btn.innerHTML = `${ic('upload')}שחזור`;
        toast(e && e.code === 'wrong' ? 'הסיסמה שגויה' : 'זה לא קובץ גיבוי של Stashwise');
      }
    };
  });
}

function wipe() {
  openSheet('מחיקת כל הנתונים', `<p>כל התנועות, ההגדרות והקוד יימחקו מהמכשיר הזה. אי אפשר לבטל.</p>
    <div class="field"><label for="wp">כדי לאשר, הקלד: מחק</label><input id="wp" type="text"></div>
    <button class="btn danger wide" id="wp-go" type="button">${ic('trash')}מחיקה סופית</button>`, (sh) => {
    $('#wp-go', sh).onclick = async () => {
      if ($('#wp', sh).value.trim() !== 'מחק') return toast('הקלד "מחק" כדי לאשר');
      await vault.wipe(); location.reload();
    };
  });
}
