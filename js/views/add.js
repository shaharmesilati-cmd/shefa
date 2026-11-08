import { state, upsertTx, persist, changed } from '../store.js';
import { normMerchant, budgetKeyOf } from '../calc.js';
import { $, $$, esc, ic, money, num, uid, toast, shortDate } from '../util.js';
import { readWorkbook, extractRows, rowsToTx } from '../importers.js';
import { parseStatement, placeOf } from '../paste.js';
import { readImage, stopOcr } from '../ocr.js';
import { markDuplicates } from '../dedupe.js';
import { parsePayslip } from '../payslip.js';
import { isoOf } from '../calc.js';
import { cleanField, cardOf } from '../sanitize.js';
import { classify, historyOf, AUTO, looksLikeCardPayment, matchFixed } from '../categorize.js';
import { catOptions, kindOptions, openTxSheet } from './parts.js';

let mode = null;          // null | 'paste' | 'review'
let review = null;        // { rows, source, removed, file? }
let fileCtx = null;
let pasted = '';
let busy = null;          // { ctl:{stop:boolean} } while reading screenshots
let host = null;
let review0card = null;   // card of the file being imported (from its title), if any

const IMG_TYPES = /^image\/(png|jpe?g|webp|gif|heic|heif|bmp)$/i;

export function render(el) {
  host = el;
  if (busy) return; // progress UI is drawn by readShots
  if (state.ui.addMode === 'payslip') { state.ui.addMode = null; mode = 'payslip'; }
  if (mode === 'review' && review) return renderReview(el);
  if (mode === 'paste') return renderPaste(el);
  if (mode === 'payslip') return renderPayslip(el);
  el.innerHTML = `
    <section class="card intro"><h2>הוספת הוצאות</h2><p class="muted">הכל נקרא כאן, על המכשיר. לפני שמירה רואים הכל, ומה שכבר נשמר מסונן לבד.</p></section>
    <label class="option drop" id="shots-drop" for="shots-in">
      <span class="opt-ic" style="--c:#14967C">${ic('images')}</span>
      <span class="opt-t"><b>צילומי מסך מהאשראי</b><small>בוחרים צילום אחד או כמה מאפליקציית ישראכרט. Stashwise קוראת תאריך, שעה, בית עסק, מקום וסכום.</small></span>
      <span class="badge">הכי קל</span>
      <input id="shots-in" type="file" accept="image/*" multiple hidden>
    </label>
    <button class="option" id="opt-slip" type="button">
      <span class="opt-ic" style="--c:#F6B829">${ic('hand-coins')}</span>
      <span class="opt-t"><b>תלוש משכורת</b><small>פעם בחודש: צילום של התלוש, והמשכורת נרשמת כהכנסה של החודש.</small></span>
      ${ic('caret-left', 'go')}</button>
    <label class="option" for="file-in">
      <span class="opt-ic" style="--c:#5B8DEF">${ic('file-xls')}</span>
      <span class="opt-t"><b>קובץ מישראכרט או מהבנק</b><small>אקסל, CSV או PDF. הכי מדויק לחודש שלם: מורידים מהאתר או מהאפליקציה ובוחרים כאן.</small></span>
      ${ic('caret-left', 'go')}
      <input id="file-in" type="file" accept=".xlsx,.xls,.csv,.html,.pdf,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" hidden>
    </label>
    <button class="option" id="opt-paste" type="button">
      <span class="opt-ic" style="--c:#9C7FE3">${ic('copy')}</span>
      <span class="opt-t"><b>הדבקת טקסט</b><small>טקסט שהעתקת מהטלפון ("טקסט חי" או Google Lens).</small></span>
      ${ic('caret-left', 'go')}</button>
    <button class="option" id="opt-manual" type="button">
      <span class="opt-ic" style="--c:#F2865E">${ic('note')}</span>
      <span class="opt-t"><b>הוספה ידנית</b><small>מזומן, הכנסה, או כל דבר אחר.</small></span>
      ${ic('caret-left', 'go')}</button>
    <div id="add-status"></div>
    <p class="hint center">${ic('shield')} הכל נקרא בתוך הטלפון. מספרי כרטיס (מלבד 4 אחרונות), ת"ז ומספרי אישור נמחקים, והתמונה לא נשמרת.</p>
    <details class="card help"><summary>${ic('question')} טיפים לצילום טוב</summary>
      <ul class="how"><li>צלם את מסך רשימת העסקאות, כשהשמות והסכומים נראים בבירור.</li>
      <li>אפשר לגלול ולצלם כמה צילומים ברצף ולבחור את כולם יחד. עסקאות שמופיעות בשני צילומים יסומנו ככפילות.</li>
      <li>באנדרואיד אפשר גם לשתף צילום ישירות מהגלריה ל-Stashwise (אחרי שמתקינים אותה).</li>
      <li>לחודש שלם, קובץ האקסל מאתר ישראכרט מדויק יותר.</li></ul></details>`;
  const si = $('#shots-in', el);
  si.onchange = () => { const files = [...si.files]; si.value = ''; if (files.length) readShots(files); };
  const drop = $('#shots-drop', el);
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); const f = [...e.dataTransfer.files].filter(x => IMG_TYPES.test(x.type)); if (f.length) readShots(f); };
  const fi = $('#file-in', el);
  fi.onchange = () => { const file = fi.files[0]; fi.value = ''; if (file) readFile(el, file); };
  $('#opt-paste', el).onclick = () => { mode = 'paste'; render(el); };
  $('#opt-slip', el).onclick = () => { mode = 'payslip'; render(el); };
  $('#opt-manual', el).onclick = () => openTxSheet(null);
}

// Paste an image (desktop: Ctrl+V a screenshot) while on the add screen.
document.addEventListener('paste', e => {
  if (!host || host.hidden || busy || mode) return;
  const files = [...(e.clipboardData?.files || [])].filter(f => IMG_TYPES.test(f.type));
  if (files.length) { e.preventDefault(); readShots(files); }
});

/* ---------------- screenshots ---------------- */
export async function readShots(files) {
  const el = host || $('#view-add');
  files = files.filter(f => IMG_TYPES.test(f.type) || /\.(png|jpe?g|webp|heic)$/i.test(f.name || '')).slice(0, 20);
  if (!files.length) { toast('לא נמצאו תמונות'); return; }
  if (location.hash !== '#add') location.hash = 'add';
  const ctl = { stop: false };
  busy = { ctl };
  const total = files.length;
  el.innerHTML = `<section class="card reading">
      <div class="read-ic">${ic('scan')}</div>
      <h2 id="rd-title">קורא ${total === 1 ? 'את הצילום' : `${total} צילומים`}…</h2>
      <p class="muted" id="rd-sub">זה קורה בתוך הטלפון. לוקח כמה שניות לצילום.</p>
      <div class="progress"><i id="rd-bar" style="width:3%"></i></div>
      <button class="btn small ghost" id="rd-stop" type="button">${ic('x')}עצירה</button></section>`;
  $('#rd-stop', el).onclick = () => { ctl.stop = true; $('#rd-sub', el).textContent = 'עוצר…'; };
  const groups = []; let removed = 0, failed = 0;
  const setBar = (i, p) => { const b = $('#rd-bar', el); if (b) b.style.width = `${Math.max(3, ((i + (p || 0)) / total) * 100).toFixed(1)}%`; };
  try {
    for (let i = 0; i < files.length && !ctl.stop; i++) {
      const t = $('#rd-title', el); if (t && total > 1) t.textContent = `קורא צילום ${i + 1} מתוך ${total}…`;
      let text = '';
      try {
        text = await readImage(files[i], (msg, p) => { if (msg) { const s = $('#rd-sub', el); if (s) s.textContent = msg; } else setBar(i, p); });
      } catch (e) {
        if (i === 0 && !groups.length) throw e;
        failed++; continue;
      } finally {
        files[i] = null; // drop our reference to the image right away
      }
      const res = parseStatement(text, new Date());
      text = ''; // the raw text is not kept either
      removed += res.removed;
      groups.push(res.rows);
      setBar(i + 1, 0);
    }
  } catch (e) {
    busy = null; files.length = 0; await stopOcr();
    el.innerHTML = '';
    mode = null; render(el);
    $('#add-status', el).innerHTML = `<div class="notice bad">${ic('warning')}<span>${location.protocol === 'file:' || location.hostname === 'localhost'
      ? 'קריאת צילומים לא זמינה כאן. אפשר להדביק טקסט או לטעון קובץ אקסל.'
      : 'לא הצלחתי להפעיל את קורא הצילומים. ודא שיש חיבור לאינטרנט בפעם הראשונה (כדי להוריד את מנוע הקריאה), ונסה שוב.'}</span></div>`;
    return;
  }
  files.length = 0;
  await stopOcr(); // frees the engine and any image data it still held
  busy = null;
  const rows = groups.flat();
  if (!rows.length) {
    mode = null; render(el);
    $('#add-status', el).innerHTML = `<div class="notice bad">${ic('warning')}<span>לא מצאתי עסקאות בצילומים. ודא שרואים בהם את רשימת העסקאות עם הסכומים, או נסה צילום חד יותר.</span></div>`;
    return;
  }
  review0card = null; buildReview(groups, 'screenshot');
  review.removed = removed; review.failed = failed; review.shots = groups.length;
  mode = 'review'; render(el);
}

/* ---------------- salary slip ---------------- */
function renderPayslip(el, err) {
  el.innerHTML = `<section class="card">
      <div class="card-h"><h2>${ic('hand-coins')} תלוש משכורת</h2><button class="btn small ghost" id="back" type="button">${ic('caret-right')}חזרה</button></div>
      <p class="muted">צלם את התלוש (או בחר צילום/סריקה שלו). Stashwise מוצאת את השכר נטו, הברוטו, החודש והמעסיק.</p>
      <label class="option drop slip" for="slip-in">
        <span class="opt-ic" style="--c:#F6B829">${ic('scan')}</span>
        <span class="opt-t"><b>בחירת צילום של התלוש</b><small>קורא על המכשיר. ת"ז, מספר חשבון, כתובת ונתוני מס נמחקים ולא נשמרים.</small></span>
        <input id="slip-in" type="file" accept="image/*" hidden></label>
      ${err ? `<div class="notice bad">${ic('warning')}<span>${esc(err)}</span></div>` : ''}
      <button class="btn wide" id="slip-manual" type="button">${ic('pencil')}להקליד את המשכורת בעצמי</button>
      <p class="hint">${ic('info')} התלוש עצמו לא נשמר. נשמרים רק נטו, ברוטו, החודש ושם המעסיק.</p></section>`;
  $('#back', el).onclick = () => { mode = null; render(el); };
  $('#slip-manual', el).onclick = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); showSlipResult(el, { net: null, gross: null, monthKey: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, employer: '', removed: 0, manual: true }); };
  const inp = $('#slip-in', el);
  inp.onchange = () => { const f = inp.files[0]; inp.value = ''; if (f) readSlip(el, f); };
}

async function readSlip(el, file) {
  busy = { ctl: { stop: false } };
  el.innerHTML = `<section class="card reading"><div class="read-ic">${ic('scan')}</div><h2>קורא את התלוש…</h2>
    <p class="muted" id="rd-sub">זה קורה בתוך הטלפון.</p><div class="progress"><i id="rd-bar" style="width:3%"></i></div></section>`;
  let res = null, failed = false;
  try {
    let text = await readImage(file, (msg, p) => { if (msg) { const s = $('#rd-sub', el); if (s) s.textContent = msg; } else { const b = $('#rd-bar', el); if (b) b.style.width = `${Math.max(3, (p || 0) * 100).toFixed(0)}%`; } });
    file = null;
    res = parsePayslip(text, new Date());
    text = '';
  } catch { failed = true; }
  await stopOcr();
  busy = null;
  if (failed) { mode = 'payslip'; return renderPayslip(el, location.hostname === 'localhost' ? 'קריאת צילומים לא זמינה כאן. אפשר להקליד את המשכורת בעצמך.' : 'לא הצלחתי לקרוא את הצילום. נסה צילום חד וישר של התלוש.'); }
  showSlipResult(el, res);
}

function showSlipResult(el, r) {
  const S = state.settings;
  const months = Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 12 + i); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }).reverse();
  if (!months.includes(r.monthKey)) months.unshift(r.monthKey);
  const MN = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  const label = k => `${MN[+k.slice(5) - 1]} ${k.slice(0, 4)}`;
  el.innerHTML = `<section class="card slip-card">
      <div class="card-h"><h2>${ic('hand-coins')} מה מצאתי בתלוש</h2><button class="btn small ghost" id="sl-cancel" type="button">${ic('x')}ביטול</button></div>
      ${r.net || r.manual ? '' : `<div class="notice">${ic('warning')}<span>לא הצלחתי למצוא את השכר נטו. אפשר להקליד אותו.</span></div>`}
      <div class="slip-big"><span>נטו לתשלום</span><div class="field"><label for="sl-net" class="sr">נטו</label><input id="sl-net" type="number" inputmode="decimal" step="0.01" value="${r.net ?? ''}" placeholder="0"></div></div>
      <div class="row2">
        <div class="field"><label for="sl-gross">ברוטו</label><input id="sl-gross" type="number" inputmode="decimal" step="0.01" value="${r.gross ?? ''}"></div>
        <div class="field"><label for="sl-month">תלוש של חודש</label><select id="sl-month">${months.map(k => `<option value="${k}" ${k === r.monthKey ? 'selected' : ''}>${label(k)}</option>`).join('')}</select></div>
      </div>
      <div class="row2">
        <div class="field"><label for="sl-date">התקבל בחשבון בתאריך</label><input id="sl-date" type="date" value="${isoOf(new Date())}"></div>
        <div class="field"><label for="sl-emp">מעסיק</label><input id="sl-emp" type="text" maxlength="40" value="${esc(r.employer || '')}" placeholder="לא חובה"></div>
      </div>
      <label class="check"><input type="checkbox" id="sl-upd" ${S.income ? '' : 'checked'}> <span>לעדכן גם את "הכנסה חודשית" בתקציב לסכום הזה (כרגע ${S.income ? money(S.income) : 'לא הוגדרה'})</span></label>
      ${r.removed ? `<p class="hint">${ic('shield')} ${r.removed} פרטים אישיים מהתלוש נמחקו ולא נשמרו.</p>` : ''}
      <p class="hint">${ic('info')} המשכורת נספרת בחודש התקציב שבו היא נכנסה לחשבון.</p>
      <button class="btn primary wide" id="sl-save" type="button">${ic('check')}שמירת המשכורת</button></section>`;
  $('#sl-cancel', el).onclick = () => { mode = null; render(el); };
  $('#sl-save', el).onclick = () => {
    const net = num($('#sl-net', el).value), gross = num($('#sl-gross', el).value), date = $('#sl-date', el).value;
    const monthKey = $('#sl-month', el).value, emp = cleanField($('#sl-emp', el).value, 40);
    if (!(net > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast('צריך סכום נטו ותאריך'); return; }
    const dup = state.tx.find(t => t.kind === 'income' && t.source === 'payslip' && t.note && t.note.includes(`חודש ${monthKey}`));
    if (dup && !$('#sl-save', el).classList.contains('armed')) {
      $('#sl-save', el).classList.add('armed'); $('#sl-save', el).innerHTML = `${ic('warning')}כבר נשמר תלוש לחודש הזה. לחץ שוב כדי לשמור בכל זאת`; return;
    }
    upsertTx([{ id: uid(), date, merchant: emp ? `משכורת - ${emp}` : 'משכורת', amount: net, kind: 'income', category: 'other', source: 'payslip',
      note: `תלוש חודש ${monthKey}${gross ? ` · ברוטו ${Math.round(gross)}` : ''}`, added: Date.now(), confirmed: true }]);
    if ($('#sl-upd', el).checked) { state.settings.income = Math.round(net); persist(); }
    const k = budgetKeyOf(date, state.settings.startDay); state.ui.curKey = k;
    mode = null; toast('המשכורת נשמרה'); location.hash = 'home'; changed();
  };
}

/* ---------------- files ---------------- */
async function readFile(el, file) {
  if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') return readPdfFile(el, file);
  const st = $('#add-status', el);
  st.innerHTML = `<div class="card status"><span class="spin"></span>קורא את ${esc(file.name)}…</div>`;
  try {
    if (file.size > 15 * 1024 * 1024) throw { code: 'big' };
    const sheets = await readWorkbook(file);
    const { rows, mapping } = extractRows(sheets);
    if (!rows.length || !mapping) throw { code: 'empty' };
    fileCtx = { rows, mapping, type: mapping.type, name: file.name };
    // the card number lives in the file name or the title rows ABOVE the table - never in the rows themselves (those hold amounts)
    const titleRows = sheets.map(sh => { const out = []; for (const r of sh.slice(0, 12)) { const t = r.map(c => String(c ?? '')).join(' '); if (/תאריך|date/i.test(t)) break; out.push(t); } return out.join('\n'); }).join('\n');
    review0card = mapping.type === 'bank' ? null : (cardOf(file.name + '\n' + titleRows) || null);
    buildReview([rowsToTx(rows, { type: fileCtx.type })], fileCtx.type === 'bank' ? 'bank' : 'card');
    review.file = true;
    mode = 'review'; render(el);
  } catch (e) {
    const msg = e && e.code === 'old-xls' ? 'זה קובץ Excel בפורמט ישן. פתח אותו ב-Excel ושמור בשם כ-xlsx, ואז נסה שוב.'
      : e && e.code === 'empty' ? 'לא מצאתי בקובץ טבלת תנועות (עמודות של תאריך וסכום). ודא שזה קובץ פירוט העסקאות.'
      : e && e.code === 'big' ? 'הקובץ גדול מדי. נסה קובץ של חודש או שניים.'
      : 'לא הצלחתי לקרוא את הקובץ. נסה לשמור אותו מחדש כ-xlsx או CSV.';
    st.innerHTML = `<div class="notice bad">${ic('warning')}<span>${esc(msg)}</span></div>`;
  }
}

/* ---------------- PDF ---------------- */
async function readPdfFile(el, file) {
  if (file.size > 25 * 1024 * 1024) { $('#add-status', el).innerHTML = `<div class="notice bad">${ic('warning')}<span>הקובץ גדול מדי. נסה PDF של חודש או שניים.</span></div>`; return; }
  busy = { ctl: { stop: false } };
  el.innerHTML = `<section class="card reading"><div class="read-ic">${ic('file-xls')}</div><h2>קורא את ה-PDF…</h2>
    <p class="muted" id="rd-sub">זה קורה בתוך הטלפון. הקובץ לא נשלח לשום מקום.</p><div class="progress"><i id="rd-bar" style="width:3%"></i></div></section>`;
  let r = null, err = null;
  try {
    const { readPdf } = await import('../pdf.js');
    r = await readPdf(file, (msg, p) => { const s = $('#rd-sub', el); if (s && msg) s.textContent = msg; const b = $('#rd-bar', el); if (b && p != null) b.style.width = `${Math.max(3, p * 100).toFixed(0)}%`; });
  } catch (e) { console.error('pdf', e && (e.stack || e.message || e)); err = e && e.name === 'PasswordException' ? 'הקובץ נעול בסיסמה. פתח אותו, שמור עותק בלי סיסמה ונסה שוב.' : 'לא הצלחתי לקרוא את ה-PDF. נסה קובץ אחר, או אקסל מאותו אתר.'; }
  busy = null; file = null;
  if (err) { mode = null; render(el); $('#add-status', el).innerHTML = `<div class="notice bad">${ic('warning')}<span>${esc(err)}</span></div>`; return; }
  const res = parseStatement(r.text, new Date()); r.text = '';
  if (!res.rows.length) { mode = null; render(el); $('#add-status', el).innerHTML = `<div class="notice bad">${ic('warning')}<span>לא מצאתי עסקאות ב-PDF. ודא שזה פירוט העסקאות או תנועות החשבון.</span></div>`; return; }
  review0card = null;
  buildReview([res.rows], r.bank ? 'bank' : 'pdf');
  review.removed = res.removed; review.pdf = { pages: r.pages, scanned: r.scanned };
  mode = 'review'; render(el);
}

/* ---------------- paste ---------------- */
function renderPaste(el) {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  el.innerHTML = `<section class="card">
      <div class="card-h"><h2>הדבקת טקסט</h2><button class="btn small ghost" id="back" type="button">${ic('caret-right')}חזרה</button></div>
      <ol class="how">
        ${ios ? `<li>פתח את צילום המסך באפליקציית התמונות ולחץ על כפתור "טקסט חי".</li><li>לחץ "העתק הכל" וחזור לכאן.</li>`
          : `<li>פתח את צילום המסך ב-Google Photos, לחץ על Lens ואז "טקסט".</li><li>בחר את כל הטקסט, העתק וחזור לכאן.</li>`}
        <li>הדבק בתיבה. אפשר להדביק כמה צילומים ברצף.</li></ol>
      <div class="field"><label for="paste-t">הטקסט שהעתקת</label><textarea id="paste-t" rows="9" placeholder="שופרסל דיל&#10;03.11.26 14:32&#10;₪214.90">${esc(pasted)}</textarea></div>
      <button class="btn primary wide" id="paste-go" type="button">${ic('sparkle')}מצא את העסקאות</button>
      <div id="paste-err"></div></section>`;
  $('#back', el).onclick = () => { mode = null; pasted = ''; render(el); };
  const ta = $('#paste-t', el);
  ta.oninput = () => { pasted = ta.value; };
  $('#paste-go', el).onclick = () => {
    const res = parseStatement(ta.value);
    if (!res.rows.length) { $('#paste-err', el).innerHTML = `<div class="notice bad">${ic('warning')}<span>לא מצאתי עסקאות בטקסט. ודא שהעתקת את רשימת העסקאות עם הסכומים.</span></div>`; return; }
    pasted = ''; ta.value = '';
    review0card = null; buildReview([res.rows], 'paste'); review.removed = res.removed; mode = 'review'; render(el);
  };
}

/* ---------------- review ---------------- */
function toRow(x, source) {
  const S = state.settings, ids = new Set(S.categories.map(c => c.id));
  let kind = x.kind || 'expense';
  const merchant = cleanField(x.merchant) || 'ללא שם';
  if (kind === 'expense' && source === 'bank' && looksLikeCardPayment(merchant)) kind = 'card-payment';
  const fx = kind === 'expense' ? matchFixed(merchant, S.fixed) : null;
  const cls = classify(merchant, { rules: S.rules, ids, history: HIST || (HIST = historyOf(state.tx)) });
  return { id: uid(), card: /^\d{4}$/.test(x.card || '') ? x.card : (review0card || null), date: x.date, time: x.time || null, merchant, place: x.place || placeOf(merchant), amount: x.amount, kind,
    category: cls.conf >= AUTO ? cls.cat : 'other', auto: cls.conf >= AUTO && cls.why !== 'rule' ? cls.why : null, installment: x.installment || null, foreign: !!x.foreign,
    note: cleanField(x.note, 120), fixedId: fx ? fx.id : null, on: true, dup: null, guessed: !!x.dateGuessed };
}
let HIST = null;
function buildReview(groupsRaw, source) {
  HIST = historyOf(state.tx);
  const groups = groupsRaw.map((g, gi) => g.map(x => ({ ...toRow(x, source), g: gi })));
  const rows = markDuplicates(groups, state.tx.filter(t => !t.ignored));
  rows.forEach(r => { if (r.dup) r.on = false; });
  rows.sort((a, b) => a.g - b.g || (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')));
  // purchases already saved without a card (or with another card) get the card this screenshot shows
  const fixes = rows.filter(r => r.dup === 'saved' && r.card && state.tx.find(t => t.id === r.dupOf && t.card !== r.card)).length;
  review = { rows, source, removed: 0, cardFixes: fixes, groups: groupsRaw.length };
}

function renderReview(el) {
  const R = review.rows;
  const dups = R.filter(r => r.dup).length;
  const fileBar = review.file && fileCtx ? `<div class="filebar">
      <div class="field"><label for="rv-type">זה קובץ של</label><select id="rv-type">
        <option value="card" ${fileCtx.type === 'card' ? 'selected' : ''}>פירוט כרטיס אשראי</option>
        <option value="bank" ${fileCtx.type === 'bank' ? 'selected' : ''}>תנועות חשבון בנק</option></select></div>
      <details><summary>הסכומים או השמות לא נקראו נכון? לתיקון</summary><div class="map-grid">${mapSelects()}</div></details></div>` : '';
  el.innerHTML = `<section class="card">
      <div class="card-h"><h2>בדיקה לפני שמירה</h2><button class="btn small ghost" id="rv-cancel" type="button">${ic('x')}ביטול</button></div>
      <div class="rv-stats">
        ${R.length - dups ? `<span class="chip good">${ic('check')}${R.length - dups} חדשות</span>` : `<span class="chip">אין עסקאות חדשות</span>`}
        ${dups ? `<span class="chip warn">${ic('copy')}${dups} כבר קיימות - סוננו</span>` : ''}
        ${review.removed ? `<span class="chip lilac">${ic('shield')}${review.removed} פרטים רגישים נמחקו</span>` : ''}
        ${review.failed ? `<span class="chip">${review.failed} צילומים לא נקראו</span>` : ''}
      </div>
      ${review.cardFixes ? `<p class="hint">${ic('card')} ${review.cardFixes} עסקאות שכבר שמורות יקבלו את הכרטיס שמופיע בצילום.</p>` : ''}
      ${review.pdf ? `<p class="hint">${ic('info')} נקראו ${review.pdf.pages} עמודים${review.pdf.scanned ? ` (${review.pdf.scanned} סרוקים - בדוק את הסכומים)` : ''}. הקובץ עצמו לא נשמר.</p>` : ''}
      ${review.source === 'screenshot' ? `<p class="hint">${ic('shield')} הצילומים כבר נמחקו מהזיכרון. בדוק שהשמות והסכומים נכונים - הקריאה מצילום לא תמיד מושלמת.</p>` : ''}
      ${fileBar}
      ${dups ? `<button class="link-btn left" id="rv-showdup" type="button">${review.showDup ? 'הסתר' : 'הצג'} את מה שסונן</button>` : ''}
    </section>
    <div class="rev">${R.map((r, i) => groupHead(R, i) + ((r.dup && !review.showDup) ? '' : `<div class="rev-row ${r.on ? '' : 'off'}" data-i="${i}">
      <input type="checkbox" data-k="on" ${r.on ? 'checked' : ''} aria-label="לשמור את ${esc(r.merchant)}">
      <div class="rev-main">
        <div class="rev-top"><b class="rev-name">${esc(r.merchant)}</b><b class="rev-amt">${money(r.amount, 'auto')}</b></div>
        <div class="rev-meta">${ic('calendar')}<span>${shortDate(r.date)}${r.time ? ' · ' + esc(r.time) : ''}</span>${r.place ? `<span>· ${esc(r.place)}</span>` : ''}${r.card ? `<span class="chip">${ic('card')}${esc(r.card)}</span>` : ''}
          ${r.dup ? `<span class="chip warn">${r.dup === 'saved' ? 'כבר שמורה' : 'בצילום אחר'}</span>` : ''}
          ${r.fixedId ? `<span class="chip lilac">${ic('lock')}קבועה</span>` : ''}${r.kind === 'card-payment' ? `<span class="chip">${ic('card')}חיוב האשראי - לא נספר</span>` : ''}${r.kind === 'income' ? `<span class="chip good">הכנסה</span>` : ''}${r.kind === 'expense' && r.category === 'other' ? `<span class="chip warn">${ic('question')}בחר קטגוריה</span>` : r.auto ? `<span class="chip good">${ic('sparkle')}סווג לבד</span>` : ''}${r.installment ? `<span class="chip">תשלום ${esc(r.installment)}</span>` : ''}
          ${r.foreign ? `<span class="chip peach">מט"ח</span>` : ''}${r.guessed ? `<span class="chip warn">בדוק תאריך</span>` : ''}${r.amount < 0 ? `<span class="chip good">זיכוי</span>` : ''}</div>
        <div class="rev-cat" ${r.kind === 'expense' ? '' : 'hidden'}><select data-k="category" aria-label="קטגוריה">${catOptions(r.category)}</select></div>
        <details class="rev-edit"><summary>${ic('pencil')}תיקון</summary><div class="rev-f">
          <div class="field wide"><label for="rv-m-${i}">שם</label><input id="rv-m-${i}" type="text" data-k="merchant" value="${esc(r.merchant)}"></div>
          <div class="field"><label for="rv-a-${i}">סכום</label><input id="rv-a-${i}" type="number" step="0.01" inputmode="decimal" data-k="amount" value="${r.amount}"></div>
          <div class="field"><label for="rv-d-${i}">תאריך</label><input id="rv-d-${i}" type="date" data-k="date" value="${esc(r.date)}"></div>
          <div class="field"><label for="rv-t-${i}">שעה</label><input id="rv-t-${i}" type="time" data-k="time" value="${esc(r.time || '')}"></div>
          <div class="field"><label for="rv-p-${i}">מקום</label><input id="rv-p-${i}" type="text" data-k="place" value="${esc(r.place || '')}"></div>
          <div class="field"><label for="rv-c4-${i}">כרטיס (4 ספרות)</label><input id="rv-c4-${i}" type="text" inputmode="numeric" maxlength="4" pattern="\\d{4}" data-k="card" value="${esc(r.card || '')}"></div>
          <div class="field"><label for="rv-k-${i}">סוג</label><select id="rv-k-${i}" data-k="kind">${kindOptions(r.kind)}</select></div>
        </div></details>
      </div></div>`)).join('')}</div>
    <div class="savebar"><span id="rv-sum"></span><button class="btn primary" id="rv-save" type="button">${ic('check')}שמירה</button></div>`;
  sum(el);
  $('#rv-cancel', el).onclick = () => { review = null; mode = null; render(el); };
  $$('[data-gcard]', el).forEach(inp => inp.addEventListener('change', () => {
    const g = +inp.dataset.gcard, v = inp.value.replace(/\D/g, '');
    if (v && v.length !== 4) { toast('רושמים בדיוק 4 ספרות'); return; }
    R.filter(r => r.g === g).forEach(r => (r.card = v || null)); renderReview(el);
    toast(v ? `העסקאות ${review.groups > 1 ? 'בצילום הזה ' : ''}סומנו בכרטיס ${v}` : 'הכרטיס הוסר');
  }));
  const sd = $('#rv-showdup', el); if (sd) sd.onclick = () => { review.showDup = !review.showDup; renderReview(el); };
  $('#rv-save', el).onclick = () => save(el);
  if ($('#rv-type', el)) $('#rv-type', el).onchange = e => { fileCtx.type = e.target.value; rebuildFromFile(el); };
  $$('.map-grid select', el).forEach(s => s.onchange = () => { fileCtx.override = fileCtx.override || {}; fileCtx.override[s.dataset.col] = +s.value; rebuildFromFile(el); });
  $$('.rev-row', el).forEach(row => {
    const r = R[+row.dataset.i];
    row.querySelectorAll('[data-k]').forEach(inp => inp.addEventListener(inp.type === 'checkbox' || inp.tagName === 'SELECT' ? 'change' : 'input', () => {
      const k = inp.dataset.k;
      if (k === 'on') { r.on = inp.checked; row.classList.toggle('off', !r.on); }
      else if (k === 'amount') { r.amount = num(inp.value); row.querySelector('.rev-amt').innerHTML = money(r.amount, 'auto'); }
      else if (k === 'category') { r.category = inp.value; r.touched = true; }
      else if (k === 'kind') { r.kind = inp.value; row.querySelector('.rev-cat').hidden = r.kind !== 'expense'; }
      else if (k === 'merchant') { r.merchant = inp.value; row.querySelector('.rev-name').textContent = inp.value; }
      else r[k] = inp.value;
      sum(el);
    }));
  });
}
/** Header before the first row of each screenshot: which card paid, editable for that screenshot only. */
function groupHead(R, i) {
  if (review.source === 'bank') return '';
  const r = R[i]; if (i > 0 && R[i - 1].g === r.g) return '';
  const rows = R.filter(x => x.g === r.g), card = mainCard(rows), shown = rows.filter(x => !x.dup || review.showDup).length;
  return `<div class="grp-h"><span class="c4-ic">${ic('card')}</span><div class="grp-t"><b>${review.groups > 1 ? `צילום ${r.g + 1}` : 'הכרטיס ששילם'}</b><small>${shown} עסקאות${rows.length > shown ? ` · ${rows.length - shown} כבר שמורות` : ''}</small></div>
    <div class="field"><label for="g-card-${r.g}">4 ספרות</label><input id="g-card-${r.g}" data-gcard="${r.g}" type="text" inputmode="numeric" maxlength="4" value="${esc(card)}" placeholder="${card ? '' : '----'}"></div></div>`;
}
/** The card most of the rows were read with (from the top of the screenshot or the file title). */
function mainCard(rows) {
  const n = {}; for (const r of rows) if (r.card) n[r.card] = (n[r.card] || 0) + 1;
  return Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}
function mapSelects() {
  const h = fileCtx.mapping.header || [];
  const cur = { ...fileCtx.mapping, ...(fileCtx.override || {}) };
  const opts = sel => `<option value="-1">ללא</option>` + h.map((x, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${esc(x || 'עמודה ' + (i + 1))}</option>`).join('');
  const cols = fileCtx.type === 'bank' ? [['date', 'תאריך'], ['merchant', 'תיאור'], ['debit', 'חובה (הוצאה)'], ['credit', 'זכות (הכנסה)']]
    : [['date', 'תאריך'], ['merchant', 'בית עסק'], ['amount', 'סכום חיוב'], ['details', 'פירוט נוסף']];
  return cols.map(([k, l]) => `<div class="field"><label>${l}</label><select data-col="${k}" aria-label="${l}">${opts(cur[k])}</select></div>`).join('');
}
function rebuildFromFile(el) {
  buildReview([rowsToTx(fileCtx.rows, { type: fileCtx.type, ...(fileCtx.override || {}) })], fileCtx.type === 'bank' ? 'bank' : 'card');
  review.file = true; renderReview(el);
}
function sum(el) {
  const on = review.rows.filter(r => r.on);
  const exp = on.filter(r => r.kind === 'expense').reduce((a, r) => a + num(r.amount), 0);
  const inc = on.filter(r => r.kind === 'income').reduce((a, r) => a + num(r.amount), 0);
  const skip = on.filter(r => r.kind === 'card-payment').length;
  $('#rv-sum', el).innerHTML = `<b>${on.length}</b> לשמירה${exp ? ` · הוצאות ${money(exp)}` : ''}${inc ? ` · הכנסות ${money(inc)}` : ''}${skip ? ` · ${skip} לא נספרות` : ''}`;
  $('#rv-save', el).disabled = !on.length && !review.cardFixes;
}
function save(el) {
  const now = Date.now();
  const chosen = review.rows.filter(r => r.on && r.merchant && num(r.amount) && /^\d{4}-\d{2}-\d{2}$/.test(r.date));
  let learned = false;
  for (const r of chosen) if (r.touched && r.kind === 'expense') { state.settings.rules[normMerchant(r.merchant)] = r.category; learned = true; }
  if (learned) persist();
  upsertTx(chosen.map((r, i) => ({ id: r.id, date: r.date, time: /^\d{2}:\d{2}$/.test(r.time || '') ? r.time : null, merchant: cleanField(r.merchant), place: cleanField(r.place, 40),
    card: /^\d{4}$/.test(r.card || '') ? r.card : null, amount: num(r.amount), kind: r.kind, category: r.category, fixedId: r.kind === 'expense' ? r.fixedId : null, installment: r.installment,
    foreign: r.foreign, note: r.note, source: review.source, added: now + i })));
  const fix = review.rows.filter(r => r.dup === 'saved' && /^\d{4}$/.test(r.card || '')).map(r => { const t = state.tx.find(x => x.id === r.dupOf); return t && t.card !== r.card ? { ...t, card: r.card } : null; }).filter(Boolean);
  if (fix.length) upsertTx(fix);
  const keys = [...new Set(chosen.map(r => budgetKeyOf(r.date, state.settings.startDay)))].sort();
  if (keys.length && !keys.includes(state.ui.curKey)) state.ui.curKey = keys[keys.length - 1];
  review = null; mode = null; fileCtx = null;
  toast(`נשמרו ${chosen.length} תנועות${fix.length ? ` · ${fix.length} קיבלו כרטיס` : ''}`);
  location.hash = 'home';
  changed();
}
