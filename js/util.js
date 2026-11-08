export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const ic = (n, cls = '') => `<svg class="ic ${cls}" aria-hidden="true" focusable="false"><use href="assets/icons.svg#${n}"></use></svg>`;
export const uid = () => [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, '0')).join('');

const nf0 = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmt0 = v => nf0.format(Math.round(Number(v) || 0));
/** Money as HTML. Whole shekels by default; 'auto' shows agorot when the amount has them (single transactions). */
export function money(v, exact) {
  v = Number(v) || 0;
  const a = Math.abs(v);
  const s = (exact === true || (exact === 'auto' && Math.round(a * 100) % 100 !== 0)) ? nf2.format(a) : nf0.format(Math.round(a));
  return `<span class="num">${v < 0 ? '-' : ''}₪${s}</span>`;
}
export const num = v => { const n = parseFloat(String(v ?? '').replace(/[,₪\s]/g, '')); return isFinite(n) ? n : 0; };
export const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
export const monthName = key => { const [y, m] = key.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };
export const shortDate = iso => { const [, m, d] = iso.split('-'); return `${+d}.${+m}`; };

let toastTimer;
export function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3200);
}

/** Two-tap confirm for destructive buttons (no browser dialogs). */
export function armConfirm(btn, fn, label = 'לחץ שוב לאישור') {
  btn.addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation();
    if (btn.classList.contains('armed')) { btn.classList.remove('armed'); fn(); return; }
    btn.classList.add('armed');
    const old = btn.innerHTML;
    if (btn.classList.contains('btn')) btn.innerHTML = ic('warning') + esc(label);
    setTimeout(() => { if (btn.isConnected) { btn.classList.remove('armed'); btn.innerHTML = old; } }, 3500);
  });
}

/** Bottom sheet. Returns close(). */
export function openSheet(title, bodyHtml, onMount) {
  const root = $('#sheet-root');
  const prevFocus = document.activeElement;
  root.innerHTML = `<div class="sheet-bg"><div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="sheet-h"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="סגירה">${ic('x')}</button></div>
    ${bodyHtml}</div></div>`;
  const close = () => { root.innerHTML = ''; document.removeEventListener('keydown', onKey); prevFocus && prevFocus.focus && prevFocus.focus(); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  root.querySelector('.sheet-bg').addEventListener('click', e => { if (e.target.classList.contains('sheet-bg')) close(); });
  root.querySelector('[data-close]').onclick = close;
  onMount && onMount(root.querySelector('.sheet'), close);
  const first = root.querySelector('input,select,button:not([data-close])');
  setTimeout(() => first && first.focus(), 60);
  return close;
}

export function download(filename, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
}
