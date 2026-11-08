import * as vault from '../vault.js';
import { state, persist, replaceAll, flushNow, changed } from '../store.js';
import { $, esc, ic, toast, openSheet, download, armConfirm, monthName } from '../util.js';
import { budgetKeyOf } from '../calc.js';
import { install, lockNow } from '../app.js';

const VERSION = '2.0.0';
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

export function update(el, detail) { if (detail === 'install' || !el.contains(document.activeElement)) render(el); }

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
      <li>${ic('lock-key')}<span>כל הנתונים מוצפנים (AES-256) ונשמרים רק במכשיר הזה. הקוד שלך הוא המפתח.</span></li>
      <li>${ic('x')}<span>אין חשבון, אין שרת ואין מעקב. האפליקציה חסומה טכנית מלשלוח מידע לאינטרנט.</span></li>
      <li>${ic('bank')}<span>Stashwise לא מבקשת סיסמאות של הבנק או של האשראי, אף פעם. את הקבצים אתה מוריד בעצמך.</span></li>
    </ul>
    <div class="row2">
      <div class="field"><label for="al">נעילה אוטומטית אחרי</label><select id="al">${[1, 5, 15, 30].map(m => `<option value="${m}" ${S.autoLockMin === m ? 'selected' : ''}>${m === 1 ? 'דקה' : m + ' דקות'} ללא שימוש</option>`).join('')}</select></div>
      <div class="field"><label for="nm">השם שלך</label><input id="nm" type="text" maxlength="30" value="${esc(S.name)}"></div>
    </div>
    <div class="btn-row"><button class="btn" id="chg" type="button">${ic('lock-key')}החלפת קוד</button><button class="btn" id="lock" type="button">${ic('lock')}נעילה עכשיו</button></div></section>

  <section class="card"><div class="card-h"><h2>${ic('download')} גיבוי והעברה למכשיר אחר</h2></div>
    <p class="hint">הגיבוי הוא קובץ מוצפן בסיסמה שתבחר. שמור אותו במקום בטוח (למשל בכונן שלך). כדי לעבור לטלפון אחר - שחזר בו את הקובץ.</p>
    <div class="btn-row"><button class="btn primary" id="bk" type="button">${ic('download')}יצירת גיבוי</button>
      <label class="btn" for="rs">${ic('upload')}שחזור מגיבוי</label><input id="rs" type="file" accept=".stash,.kis,.shefa,application/json" hidden></div>
    <p class="muted small">${state.tx.length} תנועות שמורות כרגע.</p></section>

  <section class="card"><div class="card-h"><h2>${ic('info')} על Stashwise</h2><span class="muted num">גרסה ${VERSION}</span></div>
    <p class="hint">עדכונים לא נכנסים לבד: כשיש גרסה חדשה תופיע הודעה ותבחר אם לעדכן. כך אף אחד לא יכול להחליף לך את האפליקציה בלי שתדע.</p>
    <div class="btn-row"><button class="btn" id="upd" type="button">${ic('refresh')}בדיקת עדכונים</button></div></section>

  <section class="card"><div class="card-h"><h2>${ic('calendar')} ניקוי חודש</h2></div>
    <p class="hint">מוחק רק את התנועות של ${monthName(state.ui.curKey)} (ההגדרות והתקציב נשארים). שימושי אם העלית קובץ לא נכון.</p>
    <button class="btn danger" id="wipe-month" type="button">${ic('trash')}מחיקת התנועות של ${monthName(state.ui.curKey)}</button></section>

  <section class="card danger-zone"><div class="card-h"><h2>${ic('warning')} מחיקת כל הנתונים</h2></div>
    <p class="hint">מוחק את הכספת מהמכשיר הזה. אי אפשר לבטל. כדאי לגבות קודם.</p>
    <button class="btn danger" id="wipe" type="button">${ic('trash')}מחיקת הכל</button></section>`;

  const inst = $('#inst', el);
  if (inst) inst.onclick = async () => { install.prompt.prompt(); await install.prompt.userChoice.catch(() => { }); install.prompt = null; render(el); };
  $('#al', el).onchange = e => { S.autoLockMin = +e.target.value; persist(); toast('נשמר'); };
  $('#nm', el).oninput = e => { S.name = e.target.value.slice(0, 30); persist(); };
  $('#lock', el).onclick = () => lockNow();
  $('#upd', el).onclick = async () => { if (install.checkUpdate) { await install.checkUpdate().catch(() => { }); toast('בדקתי. אם יש גרסה חדשה תופיע הודעה למעלה.'); } else toast('בדיקת עדכונים פועלת רק כשהאתר פתוח מהאינטרנט.'); };
  $('#chg', el).onclick = changeCode;
  $('#bk', el).onclick = backup;
  $('#rs', el).onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) restore(f); };
  $('#wipe', el).onclick = wipe;
  armConfirm($('#wipe-month', el), () => {
    const sd = state.settings.startDay, k = state.ui.curKey, before = state.tx.length;
    state.tx = state.tx.filter(t => budgetKeyOf(t.date, sd) !== k); persist(true); changed();
    toast(`נמחקו ${before - state.tx.length} תנועות`); render(el);
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
    + `<button class="btn primary wide" id="bk-go" type="button">${ic('download')}הורדת קובץ הגיבוי</button>`, (sh, close) => {
    $('#bk-go', sh).onclick = async () => {
      const a = $('#bk-p1', sh).value, b = $('#bk-p2', sh).value;
      if (a.length < 8) return toast('הסיסמה קצרה מדי');
      if (a !== b) return toast('הסיסמאות לא זהות');
      const btn = $('#bk-go', sh); btn.disabled = true; btn.innerHTML = `<span class="spin"></span>מצפין…`;
      const text = await vault.exportBackup({ v: 1, settings: state.settings, tx: state.tx, at: new Date().toISOString() }, a);
      download(`stashwise-backup-${new Date().toISOString().slice(0, 10)}.stash`, text);
      close(); toast('קובץ הגיבוי ירד. שמור אותו במקום בטוח.');
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
        replaceAll(d); await flushNow(); close(); changed(); toast(`שוחזרו ${state.tx.length} תנועות`);
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
